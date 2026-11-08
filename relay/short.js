// ============================================================
// orOS Mail relay — short links for shared songs (BR-SHARE-SHORT,
// Music share, 2026-11-08): POST /v1 { op:"shl", code } and
// GET /p/s.<id>.
//
// A song's preview link (/p/1.<code>, relay/preview.js) carries the
// whole song in its path: a Jamendo track is ~500 characters. With a
// short link the relay keeps the song's PUBLIC details (the same
// normalized fields the preview page shows and forwards: title,
// artist, album, licence, the open source's addresses) in D1 (binding
// SHR_DB, table shl_link) under
//   id = "s." + the first 10 base64url characters of SHA-256 of the
//        normalized JSON
// so the same song always gets the same link and nothing says who
// sent it. Rules (Mail thread, 2026-11-08):
//  - only "1." codes, read by preview.js songOf() (16 KB inflate cap,
//    kinds track / tracks, ≤ 200 songs, locked codes refused); the
//    NORMALIZED JSON is stored (≤ 16 KB), never the sender's bytes;
//  - nothing about the sender: no IP, user agent or time beyond the
//    row's `at` (made) and `last` (opened, updated once a day at most);
//  - an id already held by other content is a "conflict", never
//    overwritten; the same content answers the same id;
//  - rows nobody opened for SHL_LIMITS.idleDays go in the hourly cron
//    (purgeShort); the totals live in one row (shl_tot), moved in the
//    same batch as each insert and removal, so no statement counts or
//    sums the whole table (D1 bills rows read); at the row cap, the byte cap or the share store's
//    total (shared with links with an expiry, SHR_LIMITS.store) the
//    answer is 507 "full", nothing is evicted early;
//  - per-IP limits on their own counters (per isolate, best effort) and
//    a global daily insert cap kept in D1 (table shl_day);
//  - on GET the stored JSON goes through the normalizers again, the
//    forward "1." code is rebuilt from it and the page is made by
//    preview.js pageFor() (same escaping); an unknown or expired id
//    is a plain 302 to /share/.
// A short link cannot be taken back: the share dialog says so.
// Fixed error codes, nothing logged, nothing throws out of runShl().
// ============================================================

import { songOf, normTrack, normTracks } from "./preview.js";
import { shareDb, SHR_SQL, SHR_LIMITS } from "./share.js";

const DAY = 86400000;
export const SHL_LIMITS = {
  code: 4000,            // characters of the "1." code sent
  json: 16384,           // bytes of the normalized JSON kept (= PV_LIMITS.json)
  rows: 200000,          // short links held in all
  bytes: 64 * 1048576,   // bytes of JSON held in all (also inside SHR_LIMITS.store)
  perMin: 10,            // new short links per client IP per minute
  perDay: 100,           // ... per client IP per UTC day
  dayAll: 5000,          // new rows per UTC day, all senders (kept in D1)
  idleDays: 365,         // a link nobody opened for this long goes
  purgeBatch: 500        // rows deleted per purge round
};
export const SHORT_RE = /^s\.[A-Za-z0-9_-]{10}$/;
const CODE_RE = /^1\.[A-Za-z0-9_-]{4,4090}$/;      // = preview.js

export const SHL_SQL = {
  get: "SELECT k, d, last FROM shl_link WHERE id = ?1",
  stats: "SELECT c, s FROM shl_tot WHERE id = 1",
  add: "INSERT OR IGNORE INTO shl_link (id, k, d, size, at, last) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
  // in the same batch as add: counts only when add made a row
  totAdd: "UPDATE shl_tot SET c = c + 1, s = s + ?1 WHERE id = 1 AND changes() > 0",
  // in the same batch as drop, before it: only a row that is there
  totDrop: "UPDATE shl_tot SET c = c - 1, s = s - (SELECT size FROM shl_link WHERE id = ?1) WHERE id = 1 AND EXISTS (SELECT 1 FROM shl_link WHERE id = ?1)",
  touch: "UPDATE shl_link SET last = ?2 WHERE id = ?1 AND last < ?3",
  dayGet: "SELECT n FROM shl_day WHERE day = ?1",
  dayBump: "INSERT INTO shl_day (day, n) VALUES (?1, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1",
  dayOld: "DELETE FROM shl_day WHERE day < ?1",
  stale: "SELECT id FROM shl_link WHERE last < ?1 LIMIT ?2",
  drop: "DELETE FROM shl_link WHERE id = ?1"
};

export class ShlError extends Error {
  constructor(code, status, msg) { super(msg || code); this.code = code; this.status = status || 200; }
}
function q(d, sql, ...args) { return d.prepare(sql).bind(...args); }

// ---------- encoding ----------
function b64u(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function deflate(bytes) {
  const cs = new CompressionStream("deflate-raw");
  const w = cs.writable.getWriter();
  w.write(bytes).catch(() => {});
  w.close().catch(() => {});
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
// The normalized item → its "1." code (what the share page reads), or
// "" when it does not pass the preview's code check.
export async function codeOf(item) {
  const json = JSON.stringify({ v: 1, k: item.k, d: item.d });
  const code = "1." + b64u(await deflate(new TextEncoder().encode(json)));
  return CODE_RE.test(code) ? code : "";
}
// Stored JSON → { k, d } through the normalizers again, or null.
export function itemOf(k, text) {
  try {
    if (k !== "track" && k !== "tracks") return null;
    const raw = JSON.parse(text);
    if (k === "tracks" && !(raw && Array.isArray(raw.i) && raw.i.length <= 200)) return null;
    const d = k === "track" ? normTrack(raw) : normTracks(raw);
    return d ? { k, d } : null;
  } catch (e) { return null; }
}

// ---------- per-IP counters (per isolate, best effort) ----------
const ips = new Map();
function ipLimited(ip, now) {
  if (!ip) return false;
  const day = Math.floor(now / DAY);
  let h = ips.get(ip);
  if (!h || h.day !== day) h = { day, n: 0, t: now, m: 0 };
  if (now - h.t > 60000) { h.t = now; h.m = 0; }
  if (h.m + 1 > SHL_LIMITS.perMin || h.n + 1 > SHL_LIMITS.perDay) return true;
  h.m++; h.n++;
  if (ips.size > 5000) ips.clear();
  ips.set(ip, h);
  return false;
}
export function resetShortLimits() { ips.clear(); }

// ---------- the app's op ----------
export function validShl(b) {
  if (typeof b.code !== "string" || b.code.length > SHL_LIMITS.code || !CODE_RE.test(b.code)) return "code";
  return "";
}

export async function runShl(b, env, now, ip) {
  if (ipLimited(ip, now)) throw new ShlError("rate", 429, "too many short links");
  const item = await songOf(b.code);
  if (!item) throw new ShlError("song", 400, "not a song");
  const json = JSON.stringify(item.d);
  const size = new TextEncoder().encode(json).length;
  if (size > SHL_LIMITS.json) throw new ShlError("big", 413, "too large");
  if (!(await codeOf(item))) throw new ShlError("big", 413, "too large");
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(item.k + "\n" + json)));
  const id = "s." + b64u(h).slice(0, 10);
  const d = await shareDb(env);
  const old = await q(d, SHL_SQL.get, id).first();
  if (old) {
    if (old.k === item.k && old.d === json) return { id };
    throw new ShlError("conflict", 409, "id in use");
  }
  const st = await q(d, SHL_SQL.stats).first();
  if (st && (st.c + 1 > SHL_LIMITS.rows || st.s + size > SHL_LIMITS.bytes)) throw new ShlError("full", 507, "no room right now");
  const used = await q(d, SHR_SQL.used).first();
  if (used && used.s + size > SHR_LIMITS.store) throw new ShlError("full", 507, "no room right now");
  const day = Math.floor(now / DAY);
  const dn = await q(d, SHL_SQL.dayGet, day).first();
  if (dn && dn.n >= SHL_LIMITS.dayAll) throw new ShlError("rate", 429, "too many short links today");
  const [r] = await d.batch([q(d, SHL_SQL.add, id, item.k, json, size, now), q(d, SHL_SQL.totAdd, size)]);
  if (!(r && r.meta && r.meta.changes)) {
    // made at the same moment elsewhere: the same content is fine
    const again = await q(d, SHL_SQL.get, id).first();
    if (again && again.k === item.k && again.d === json) return { id };
    throw new ShlError("conflict", 409, "id in use");
  }
  await q(d, SHL_SQL.dayBump, day).run();
  return { id };
}

// ---------- GET /p/s.<id> ----------
// → { item, code } for preview.js, or null (unknown, expired, bad).
export async function shortItem(id, env, now) {
  if (typeof id !== "string" || !SHORT_RE.test(id)) return null;
  let d;
  try { d = await shareDb(env); } catch (e) { return null; }
  const row = await q(d, SHL_SQL.get, id).first();
  if (!row || !(row.last >= now - SHL_LIMITS.idleDays * DAY)) return null;
  const item = itemOf(row.k, row.d);
  if (!item) return null;
  const code = await codeOf(item);
  if (!code) return null;
  try { if (now - row.last > DAY) await q(d, SHL_SQL.touch, id, now, now - DAY).run(); } catch (e) { /* next open tries again */ }
  return { item, code };
}

// Rows nobody opened for idleDays, and old day counters. Used by the
// cron (worker.js). Never throws; returns how many links went.
export async function purgeShort(env, now, rounds) {
  let gone = 0;
  try {
    const d = await shareDb(env);
    await q(d, SHL_SQL.dayOld, Math.floor(now / DAY) - 2).run();
    for (let r = 0; r < (rounds || 10); r++) {
      const res = await q(d, SHL_SQL.stale, now - SHL_LIMITS.idleDays * DAY, SHL_LIMITS.purgeBatch).all();
      const ids = ((res && res.results) || []).map((x) => x.id);
      if (!ids.length) break;
      const st = [];
      for (const id of ids) st.push(q(d, SHL_SQL.totDrop, id), q(d, SHL_SQL.drop, id));
      await d.batch(st);
      gone += ids.length;
      if (ids.length < SHL_LIMITS.purgeBatch) break;
    }
  } catch (e) { /* storage trouble: the next run tries again */ }
  return gone;
}
