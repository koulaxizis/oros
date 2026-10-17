// ============================================================
// orOS Mail relay — "Send to someone" links with an expiry: the
// encrypted pieces of one shared item wait in Cloudflare D1 (binding
// SHR_DB, database "oros-share", tables shr_obj / shr_chunk) until
// they expire or the sender revokes them. See relay/README.md.
//
// The relay never sees a key: every piece is AES-256-GCM ciphertext
// made in the sender's browser, and the key lives only in the link's
// #fragment. In clear the relay keeps only the id, the expiry, the
// declared size, the number of pieces, the time, and SHA-256 of two
// secrets (the upload token and the sender's revoke secret).
//
// App (POST /v1, origin-gated):
//   { op:"shr", act:"new", id, delh, exp, n, size } → { tok }
//   { op:"shr", act:"fin", id, tok }                → { exp }
//   { op:"shr", act:"del", id, del }                → { ok }  (same answer
//                                                     whether the id exists)
// Pieces:
//   PUT /s/<id>/<i>   Authorization: Bearer <tok>, body = the piece
//                     (only from ALLOWED_ORIGINS; until fin, 1 hour)
//   GET /s/<id>/<i>   the piece as an attachment; one 404 for missing,
//                     expired, revoked and not yet finished
// Expired objects and unfinished ones older than an hour are deleted
// by purgeShares(), from the Worker's cron and on every "new".
// Nothing is logged. Every D1 call is inside a try: a storage
// failure is a 503 with fixed text, never an exception out of handle().
// ============================================================

import { sha256Hex, sameHex } from "./newsletter.js";

export const SHR_LIMITS = {
  chunk: 262144 + 64,    // bytes of one piece (256 KiB of data + IV/tag slack)
  pieces: 200,           // pieces per shared item
  size: 25 * 1048576,    // bytes per shared item
  store: 400 * 1048576,  // bytes held in all (declared sizes; Free D1 = 500 MB per database)
  maxDays: 30,           // longest expiry
  uploadMs: 3600000,     // an unfinished upload is deleted after this
  perIpDay: 20,          // new items per client IP per UTC day (per isolate, best effort)
  perIpBytes: 100 * 1048576,
  putPerMin: 300,        // PUT /s/ per client IP per minute (separate from /v1 and /nl/)
  getPerMin: 600,        // GET /s/ per client IP per minute
  purgeBatch: 50         // objects deleted per purge round
};
const DAY = 86400000;
export const ID_RE = /^[A-Za-z0-9_-]{22}$/;          // 16 random bytes, base64url
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;             // 32 random bytes, base64url
const HEX64_RE = /^[0-9a-f]{64}$/;
export const PIECE_RE = /^\/s\/([A-Za-z0-9_-]{22})\/(\d{1,3})$/;

export class ShrError extends Error {
  constructor(code, status, msg) { super(msg || code); this.code = code; this.status = status || 200; }
}

export const SHR_SQL = {
  obj: "CREATE TABLE IF NOT EXISTS shr_obj (id TEXT PRIMARY KEY, exp INTEGER NOT NULL, size INTEGER NOT NULL, n INTEGER NOT NULL, delh TEXT NOT NULL, tokh TEXT NOT NULL, at INTEGER NOT NULL, fin INTEGER NOT NULL DEFAULT 0)",
  chunk: "CREATE TABLE IF NOT EXISTS shr_chunk (id TEXT NOT NULL, i INTEGER NOT NULL, len INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (id, i))",
  indexExp: "CREATE INDEX IF NOT EXISTS shr_obj_exp ON shr_obj (exp)",
  indexOpen: "CREATE INDEX IF NOT EXISTS shr_obj_open ON shr_obj (fin, at)",
  getObj: "SELECT exp, size, n, delh, tokh, at, fin FROM shr_obj WHERE id = ?1",
  used: "SELECT COALESCE(SUM(size), 0) AS s FROM shr_obj",
  addObj: "INSERT OR IGNORE INTO shr_obj (id, exp, size, n, delh, tokh, at, fin) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
  got: "SELECT COUNT(*) AS c, COALESCE(SUM(len), 0) AS s FROM shr_chunk WHERE id = ?1",
  addChunk: "INSERT OR IGNORE INTO shr_chunk (id, i, len, data) VALUES (?1, ?2, ?3, ?4)",
  dropChunk: "DELETE FROM shr_chunk WHERE id = ?1 AND i = ?2",
  fin: "UPDATE shr_obj SET fin = 1 WHERE id = ?1 AND fin = 0",
  read: "SELECT c.data AS data FROM shr_chunk c JOIN shr_obj o ON o.id = c.id WHERE c.id = ?1 AND c.i = ?2 AND o.fin = 1 AND o.exp > ?3",
  dropChunks: "DELETE FROM shr_chunk WHERE id = ?1",
  dropObj: "DELETE FROM shr_obj WHERE id = ?1",
  stale: "SELECT id FROM shr_obj WHERE exp <= ?1 OR (fin = 0 AND at < ?2) LIMIT ?3"
};

// ---------- storage ----------
let schemaFor = null, schemaP = null;
function db(env) {
  const d = env && env.SHR_DB;
  if (!d || typeof d.prepare !== "function") throw new ShrError("nostore", 503, "sharing is not set up on this relay");
  if (schemaFor !== d || !schemaP) {
    schemaFor = d;
    schemaP = d.batch([d.prepare(SHR_SQL.obj), d.prepare(SHR_SQL.chunk), d.prepare(SHR_SQL.indexExp), d.prepare(SHR_SQL.indexOpen)])
      .catch((e) => { schemaP = null; throw e; });
  }
  return schemaP.then(() => d);
}
function q(d, sql, ...args) { return d.prepare(sql).bind(...args); }
async function drop(d, id) { await d.batch([q(d, SHR_SQL.dropChunks, id), q(d, SHR_SQL.dropObj, id)]); }

// Deletes expired objects and unfinished uploads older than an hour,
// at most `rounds` batches. Used by the cron (worker.js) and on "new".
// Never throws; returns how many objects went.
export async function purgeShares(env, now, rounds) {
  let gone = 0;
  try {
    const d = await db(env);
    for (let r = 0; r < (rounds || 10); r++) {
      const res = await q(d, SHR_SQL.stale, now, now - SHR_LIMITS.uploadMs, SHR_LIMITS.purgeBatch).all();
      const ids = ((res && res.results) || []).map((x) => x.id);
      if (!ids.length) break;
      const st = [];
      for (const id of ids) st.push(q(d, SHR_SQL.dropChunks, id), q(d, SHR_SQL.dropObj, id));
      await d.batch(st);
      gone += ids.length;
      if (ids.length < SHR_LIMITS.purgeBatch) break;
    }
  } catch (e) { /* storage trouble: the next run tries again */ }
  return gone;
}

// ---------- per-IP counters (per isolate, best effort) ----------
const days = new Map();
function dayFull(ip, now, size) {
  if (!ip) return false;
  const day = Math.floor(now / DAY);
  let h = days.get(ip);
  if (!h || h.day !== day) h = { day, n: 0, b: 0 };
  if (h.n + 1 > SHR_LIMITS.perIpDay || h.b + size > SHR_LIMITS.perIpBytes) return true;
  h.n++; h.b += size;
  if (days.size > 5000) days.clear();
  days.set(ip, h);
  return false;
}
const mins = new Map();
export function pieceLimited(ip, now, put) {
  if (!ip) return false;
  let h = mins.get(ip);
  if (!h || now - h.t > 60000) { h = { t: now, p: 0, g: 0 }; if (mins.size > 5000) mins.clear(); mins.set(ip, h); }
  if (put) return ++h.p > SHR_LIMITS.putPerMin;
  return ++h.g > SHR_LIMITS.getPerMin;
}

// ---------- the app's op ----------
export function validShr(b, now) {
  if (["new", "fin", "del"].indexOf(b.act) < 0) return "act";
  if (typeof b.id !== "string" || !ID_RE.test(b.id)) return "id";
  if (b.act === "new") {
    if (typeof b.delh !== "string" || !HEX64_RE.test(b.delh)) return "delh";
    if (!(Number.isSafeInteger(b.n) && b.n >= 1 && b.n <= SHR_LIMITS.pieces)) return "n";
    if (!(Number.isSafeInteger(b.size) && b.size >= b.n && b.size <= SHR_LIMITS.size &&
          b.size <= b.n * SHR_LIMITS.chunk)) return "size";
    const t = now || Date.now();
    if (!(Number.isSafeInteger(b.exp) && b.exp > t && b.exp <= t + SHR_LIMITS.maxDays * DAY + 60000)) return "exp";
  }
  if (b.act === "fin" && !(typeof b.tok === "string" && SECRET_RE.test(b.tok))) return "tok";
  if (b.act === "del" && !(typeof b.del === "string" && SECRET_RE.test(b.del))) return "del";
  return "";
}

function b64url(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function runShr(b, env, now, ip) {
  const d = await db(env);
  if (b.act === "new") {
    await purgeShares(env, now, 1);
    const used = await q(d, SHR_SQL.used).first();
    if (used && used.s + b.size > SHR_LIMITS.store) throw new ShrError("full", 507, "no room right now");
    if (dayFull(ip, now, b.size)) throw new ShrError("rate", 429, "too many shared items today");
    const tok = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const r = await q(d, SHR_SQL.addObj, b.id, b.exp, b.size, b.n, b.delh, await sha256Hex(tok), now).run();
    if (!(r && r.meta && r.meta.changes)) throw new ShrError("exists", 409, "id in use");
    return { tok };
  }
  const row = await q(d, SHR_SQL.getObj, b.id).first();
  if (b.act === "del") {
    if (row && sameHex(row.delh, await sha256Hex(b.del))) await drop(d, b.id);
    return { ok: true };
  }
  // fin
  if (!row || row.fin || now - row.at > SHR_LIMITS.uploadMs) throw new ShrError("gone", 404, "unknown upload");
  if (!sameHex(row.tokh, await sha256Hex(b.tok))) throw new ShrError("auth", 403, "wrong token");
  const got = await q(d, SHR_SQL.got, b.id).first();
  if (!got || got.c !== row.n || got.s !== row.size) throw new ShrError("incomplete", 409, "pieces missing");
  await q(d, SHR_SQL.fin, b.id).run();
  return { exp: row.exp };
}

// ---------- the pieces: PUT / GET /s/<id>/<i> ----------
function pieceHeaders(origin) {
  const h = { "Content-Type": "application/octet-stream", "X-Content-Type-Options": "nosniff",
              "Content-Disposition": "attachment", "Content-Security-Policy": "sandbox",
              "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  if (origin) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "GET, PUT, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    h["Access-Control-Max-Age"] = "600";
    h["Vary"] = "Origin";
  }
  return h;
}
function answer(status, text, origin) {
  return new Response(text, { status, headers: pieceHeaders(origin) });
}
const NOT_FOUND = "not found";

// Reads a body of at most `max` bytes; null when it is bigger.
export async function readBytes(request, max) {
  const len = +(request.headers.get("Content-Length") || 0);
  if (len > max) return null;
  const reader = request.body ? request.body.getReader() : null;
  if (!reader) return new Uint8Array(0);
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { try { await reader.cancel(); } catch (e) {} return null; }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return all;
}

// D1 may hand a BLOB back as an ArrayBuffer, a typed array or an array of numbers.
function bytesOf(v) {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  if (Array.isArray(v)) return Uint8Array.from(v);
  return null;
}

// Every request under /s/ (core.js calls it before its own routes).
// Never throws.
export async function handlePiece(request, env, url, okOrigin, ip, now) {
  try {
    if (request.method === "OPTIONS") {
      if (!okOrigin) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: pieceHeaders(okOrigin) });
    }
    const m = PIECE_RE.exec(url.pathname);
    if (!m) return answer(404, NOT_FOUND, okOrigin);
    const id = m[1], i = +m[2];
    if (request.method === "GET") {
      if (pieceLimited(ip, now, false)) return answer(429, "too many requests", okOrigin);
      const d = await db(env);
      const row = await q(d, SHR_SQL.read, id, i, now).first();
      const data = row && bytesOf(row.data);
      if (!data) return answer(404, NOT_FOUND, okOrigin);
      return answer(200, data, okOrigin);
    }
    if (request.method !== "PUT") {
      const r = answer(405, "method not allowed", okOrigin);
      r.headers.set("Allow", "GET, PUT, OPTIONS");
      return r;
    }
    if (!okOrigin) return answer(403, "origin not allowed", "");
    if (pieceLimited(ip, now, true)) return answer(429, "too many requests", okOrigin);
    const auth = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get("Authorization") || "");
    if (!auth) return answer(403, "wrong token", okOrigin);
    const d = await db(env);
    const row = await q(d, SHR_SQL.getObj, id).first();
    if (!row || row.fin || now - row.at > SHR_LIMITS.uploadMs) return answer(404, NOT_FOUND, okOrigin);
    if (!sameHex(row.tokh, await sha256Hex(auth[1]))) return answer(403, "wrong token", okOrigin);
    if (i >= row.n) return answer(400, "piece out of range", okOrigin);
    const body = await readBytes(request, SHR_LIMITS.chunk);
    if (body === null) return answer(413, "piece too large", okOrigin);
    if (!body.length) return answer(400, "empty piece", okOrigin);
    const before = await q(d, SHR_SQL.got, id).first();
    if (before && before.s + body.length > row.size) return answer(413, "more than the declared size", okOrigin);
    const r = await q(d, SHR_SQL.addChunk, id, i, body.length, body.buffer.slice(body.byteOffset, body.byteOffset + body.length)).run();
    if (!(r && r.meta && r.meta.changes)) return answer(409, "piece already sent", okOrigin);
    // Two pieces sent side by side could both pass the check above.
    const after = await q(d, SHR_SQL.got, id).first();
    if (after && after.s > row.size) {
      await q(d, SHR_SQL.dropChunk, id, i).run();
      return answer(413, "more than the declared size", okOrigin);
    }
    return answer(200, "ok", okOrigin);
  } catch (e) {
    if (e instanceof ShrError) return answer(e.status, e.message, okOrigin);
    return answer(503, "storage failed", okOrigin);          // a D1 failure; never its text
  }
}
