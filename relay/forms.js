// ============================================================
// orOS Mail relay — Forms (FORMS-2): a form people fill in at
// useoros.online/forms/f/, its answers waiting in Cloudflare D1
// (binding NL_DB, tables frm_form / frm_q / frm_rep / frm_tot) until
// the owner's Forms app picks them up. See relay/README.md "Forms".
//
// The relay reads nothing it keeps. The form ("def") is AES-256-GCM
// ciphertext made by the owner's device with a key that lives only in
// the link's #fragment; each answer ("v") is sealed in the
// respondent's browser for the form's own RSA key (the hybrid seal of
// relay/newsletter.js). In clear: the form key k, SHA-256 of its
// secret, times, sizes, counters, open/closed, an optional seat count
// (Calendar RSVP: cap / taken, "yes" and seats of one answer) and the
// owner device's push wake token { pid, wt, ct }.
//
// Public (only from FORM_ORIGINS; JSON; nothing logged):
//   GET  /fm/<k>          → { def, open, cap?, taken?, maxSeats? } | 404 { e:"gone" }
//   POST /fm/<k>          { v, hp?, yes?, seats? } → { ok } | { ok, wait }
//   POST /fm/<k>/report   → { ok } (same answer for every k)
// App (POST /v1, origin-gated): { op:"frm", act, k, sec, ... }
//   put  { def, open?, close?, cap?, maxSeats? }  create or replace → { ok }
//   upd  { open?, close?, cap?, maxSeats?, taken?, push? }    → { ok }
// Seats: a "yes" takes 1..maxSeats (default 4, at most 21) with one
// conditional UPDATE, so the cap holds under racing answers; taken stays
// within 0..cap; one IP gives at most 3 "yes" a day per seat form.
//   peek {}                → { n, open, rep }      (waiting answers)
//   pull { after }         → { rows:[{id,v,at,w?}], more, open, rep, taken }
//   ack  { upto }          → { n }                 (deleted)
//   drop {}                → { ok }
// Limits (Mail thread review 2026-11-13, /mnt/project-files/forms/
// w2-relay-review.md): def ≤ 64 KB, one answer ≤ 16 KB, all Forms
// data ≤ 150 MB (507 "full"), per form ≤ 5 MB / 1000 answers waiting
// and 500 a day, 5000 forms. Per client IP (per isolate, best effort):
// GET 60 a minute, POST 5 a minute and 20 a day per form. Caps are
// counter rows (frm_tot, the form row), never COUNT on a public path.
// TTLs (hourly cron, purgeForms): answers not picked up in 30 days;
// a form 30 days after its closing time or 90 days without a pull.
// Reports: one per IP per form per UTC day (only a salted hash is
// kept, two days); the third report of a day closes the form until
// the owner opens it again (upd open). A new answer or a report wakes
// the owner's device through its push box (relay/push.js "wake"),
// at most once per form per 15 minutes.
// A wrong secret and a missing form get the same answer ("gone").
// Every D1 call is inside a try: storage trouble is a 503 with a fixed
// code, never an exception out of handle().
// ============================================================

import { sha256Hex, sameHex, K_RE, SEC_RE } from "./newsletter.js";
import { validCt } from "./push.js";

export const FRM_LIMITS = {
  def: 65536,             // characters of the encrypted form (base64url)
  answer: 16384,          // characters of one sealed answer (base64)
  body: 20480,            // bytes of a public POST body
  store: 150 * 1048576,   // bytes of all forms and answers held
  waitBytes: 5 * 1048576, // bytes of answers waiting per form
  waiting: 1000,          // answers waiting per form
  perDay: 500,            // answers stored per form per UTC day
  forms: 5000,            // forms in all
  pull: 100,              // answers per pull
  ttlDays: 30,            // an answer not picked up by then is deleted
  closedDays: 30,         // a form this long after its closing time is deleted
  idleDays: 90,           // a form nobody pulled this long is deleted
  getPerMin: 60,          // GET /fm per client IP per minute
  postPerMin: 5,          // answers per client IP per form per minute
  postPerDay: 20,         // answers per client IP per form per UTC day
  reports: 3,             // distinct reports in a day that close a form
  seats: 21,              // most seats one answer may take (the owner's maxSeats, default 4)
  seatsDefault: 4,
  yesPerDay: 3,           // yes answers per client IP per form per UTC day (seat forms)
  capMax: 100000,         // largest seat cap
  wakeGapMs: 15 * 60000,  // one wake per form per 15 minutes
  purgeBatch: 200
};
const DAY = 86400000;
const DEF_RE = /^[A-Za-z0-9_-]{40,65536}$/;
const V_RE = /^[A-Za-z0-9+/]{40,16384}={0,2}$/;
const PID_RE = /^[A-Za-z0-9_-]{22}$/;
const WT_RE = /^[A-Za-z0-9_-]{43}$/;
export const FM_RE = /^\/fm\/([a-z0-9]{16})(\/report)?$/;
// The public page lives here only (env.FORMS_ORIGINS may replace it).
const FORM_ORIGINS = ["https://useoros.online"];

export class FrmError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status || 200; }
}

export const FRM_SQL = {
  form: "CREATE TABLE IF NOT EXISTS frm_form (k TEXT PRIMARY KEY, sec TEXT NOT NULL, def TEXT NOT NULL, dlen INTEGER NOT NULL, " +
        "open INTEGER NOT NULL DEFAULT 1, close INTEGER NOT NULL DEFAULT 0, cap INTEGER NOT NULL DEFAULT 0, taken INTEGER NOT NULL DEFAULT 0, " +
        "at INTEGER NOT NULL, pulled INTEGER NOT NULL, day INTEGER NOT NULL DEFAULT 0, dn INTEGER NOT NULL DEFAULT 0, " +
        "wn INTEGER NOT NULL DEFAULT 0, wb INTEGER NOT NULL DEFAULT 0, rday INTEGER NOT NULL DEFAULT 0, rn INTEGER NOT NULL DEFAULT 0, " +
        "rep INTEGER NOT NULL DEFAULT 0, pid TEXT, wt TEXT, ct TEXT, woke INTEGER NOT NULL DEFAULT 0, ms INTEGER NOT NULL DEFAULT 4)",
  queue: "CREATE TABLE IF NOT EXISTS frm_q (id INTEGER PRIMARY KEY AUTOINCREMENT, k TEXT NOT NULL, v TEXT NOT NULL, n INTEGER NOT NULL, w INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL)",
  rep: "CREATE TABLE IF NOT EXISTS frm_rep (k TEXT NOT NULL, h TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (k, h))",
  // one row (id 1): how many forms and how many bytes (defs + waiting
  // answers), kept in step by every write and purge
  tot: "CREATE TABLE IF NOT EXISTS frm_tot (id INTEGER PRIMARY KEY CHECK (id = 1), c INTEGER NOT NULL, b INTEGER NOT NULL)",
  tot1: "INSERT OR IGNORE INTO frm_tot (id, c, b) VALUES (1, 0, 0)",
  iq: "CREATE INDEX IF NOT EXISTS frm_q_k ON frm_q (k, id)",
  iqAt: "CREATE INDEX IF NOT EXISTS frm_q_at ON frm_q (at)",
  iPulled: "CREATE INDEX IF NOT EXISTS frm_form_pulled ON frm_form (pulled)",
  iClose: "CREATE INDEX IF NOT EXISTS frm_form_close ON frm_form (close)",
  iRep: "CREATE INDEX IF NOT EXISTS frm_rep_at ON frm_rep (at)",

  getTot: "SELECT c, b FROM frm_tot WHERE id = 1",
  addTot: "UPDATE frm_tot SET c = c + ?1, b = b + ?2 WHERE id = 1",
  getForm: "SELECT sec, dlen, open, close, cap, taken, ms, day, dn, wn, wb, rday, rn, rep, pid, wt, ct, woke FROM frm_form WHERE k = ?1",
  getPublic: "SELECT def, open, close, cap, taken, ms FROM frm_form WHERE k = ?1",
  addForm: "INSERT OR IGNORE INTO frm_form (k, sec, def, dlen, open, close, cap, taken, at, pulled, ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?8, ?9)",
  setDef: "UPDATE frm_form SET def = ?2, dlen = ?3, open = ?4, close = ?5, cap = ?6, ms = ?7, taken = MIN(taken, CASE WHEN ?6 > 0 THEN ?6 ELSE taken END), rep = CASE WHEN ?4 = 1 THEN 0 ELSE rep END, rn = CASE WHEN ?4 = 1 THEN 0 ELSE rn END WHERE k = ?1",
  // taken: ?5 < 0 keeps the counter (so a seat taken meanwhile is not lost);
  // either way it stays within 0..cap when there is a cap
  setState: "UPDATE frm_form SET open = ?2, close = ?3, cap = ?4, " +
            "taken = CASE WHEN ?4 > 0 THEN MIN(CASE WHEN ?5 >= 0 THEN ?5 ELSE taken END, ?4) ELSE CASE WHEN ?5 >= 0 THEN ?5 ELSE taken END END, " +
            "rep = ?6, rn = ?7, ms = ?8 WHERE k = ?1",
  // Seats are taken by one conditional UPDATE, so two answers racing
  // for the last seat cannot both get it (changes() = 0 → waiting list).
  take: "UPDATE frm_form SET taken = taken + ?2 WHERE k = ?1 AND cap > 0 AND taken + ?2 <= cap",
  untake: "UPDATE frm_form SET taken = MAX(0, taken - ?2) WHERE k = ?1",
  setPush: "UPDATE frm_form SET pid = ?2, wt = ?3, ct = ?4 WHERE k = ?1",
  setWoke: "UPDATE frm_form SET woke = ?2 WHERE k = ?1",
  pulled: "UPDATE frm_form SET pulled = ?2 WHERE k = ?1",
  addRow: "INSERT INTO frm_q (k, v, n, w, at) VALUES (?1, ?2, ?3, ?4, ?5)",
  bump: "UPDATE frm_form SET day = ?2, dn = ?3, wn = wn + 1, wb = wb + ?4 WHERE k = ?1",
  pull: "SELECT id, v, w, at FROM frm_q WHERE k = ?1 AND id > ?2 ORDER BY id LIMIT ?3",
  // the rows an ack removes: at most `waiting` of one form, by index
  acked: "SELECT COUNT(*) AS c, COALESCE(SUM(n), 0) AS b FROM frm_q WHERE k = ?1 AND id <= ?2",
  ack: "DELETE FROM frm_q WHERE k = ?1 AND id <= ?2",
  unwait: "UPDATE frm_form SET wn = MAX(0, wn - ?2), wb = MAX(0, wb - ?3) WHERE k = ?1",
  dropRows: "DELETE FROM frm_q WHERE k = ?1",
  dropForm: "DELETE FROM frm_form WHERE k = ?1",
  addRep: "INSERT OR IGNORE INTO frm_rep (k, h, at) VALUES (?1, ?2, ?3)",
  setRep: "UPDATE frm_form SET rday = ?2, rn = ?3, open = ?4, rep = ?5 WHERE k = ?1",
  oldRows: "SELECT id, k, n FROM frm_q WHERE at < ?1 ORDER BY at LIMIT ?2",
  dropRow: "DELETE FROM frm_q WHERE id = ?1",
  oldForms: "SELECT k, dlen, wb FROM frm_form WHERE pulled < ?1 OR (close > 0 AND close < ?2) LIMIT ?3",
  oldReps: "DELETE FROM frm_rep WHERE at < ?1"
};

// ---------- storage ----------
let schemaFor = null, schemaP = null;
function db(env) {
  const d = env && env.NL_DB;
  if (!d || typeof d.prepare !== "function") throw new FrmError("nostore", 503);
  if (schemaFor !== d || !schemaP) {
    schemaFor = d;
    const S = FRM_SQL;
    schemaP = d.batch([S.form, S.queue, S.rep, S.tot, S.tot1, S.iq, S.iqAt, S.iPulled, S.iClose, S.iRep].map((s) => d.prepare(s)))
      .catch((e) => { schemaP = null; throw e; });
  }
  return schemaP.then(() => d);
}
function q(d, sql, ...args) { return d.prepare(sql).bind(...args); }
function changes(r) { return (r && r.meta && r.meta.changes) || 0; }

// Answers not picked up within ttlDays, forms past their time and old
// report hashes leave, at most `rounds` batches each. The Worker's cron
// (worker.js) runs it. Never throws; → rows + forms gone.
export async function purgeForms(env, now, rounds) {
  let gone = 0;
  try {
    const d = await db(env);
    const B = FRM_LIMITS.purgeBatch;
    for (let r = 0; r < (rounds || 10); r++) {
      const res = await q(d, FRM_SQL.oldRows, now - FRM_LIMITS.ttlDays * DAY, B).all();
      const rows = (res && res.results) || [];
      if (!rows.length) break;
      const per = new Map();
      let bytes = 0;
      const st = [];
      for (const x of rows) {
        st.push(q(d, FRM_SQL.dropRow, x.id));
        const p = per.get(x.k) || { c: 0, b: 0 };
        p.c++; p.b += x.n; bytes += x.n;
        per.set(x.k, p);
      }
      for (const [k, p] of per) st.push(q(d, FRM_SQL.unwait, k, p.c, p.b));
      st.push(q(d, FRM_SQL.addTot, 0, -bytes));
      await d.batch(st);
      gone += rows.length;
      if (rows.length < B) break;
    }
    for (let r = 0; r < (rounds || 10); r++) {
      const res = await q(d, FRM_SQL.oldForms, now - FRM_LIMITS.idleDays * DAY, now - FRM_LIMITS.closedDays * DAY, 50).all();
      const forms = (res && res.results) || [];
      if (!forms.length) break;
      const st = [];
      let bytes = 0;
      for (const f of forms) {
        st.push(q(d, FRM_SQL.dropRows, f.k), q(d, FRM_SQL.dropForm, f.k));
        bytes += (f.dlen | 0) + (f.wb | 0);
      }
      st.push(q(d, FRM_SQL.addTot, -forms.length, -bytes));
      await d.batch(st);
      gone += forms.length;
      if (forms.length < 50) break;
    }
    await q(d, FRM_SQL.oldReps, now - 2 * DAY).run();
  } catch (e) { /* storage trouble: the next run tries again */ }
  return gone;
}

// ---------- per-IP counters (per isolate, best effort) ----------
const gets = new Map(), posts = new Map(), yeses = new Map();
function getLimited(ip, now) {
  if (!ip) return false;
  let h = gets.get(ip);
  if (!h || now - h.t > 60000) { h = { t: now, n: 0 }; if (gets.size > 5000) gets.clear(); gets.set(ip, h); }
  return ++h.n > FRM_LIMITS.getPerMin;
}
function postLimited(ip, k, now) {
  if (!ip) return false;
  const key = ip + "|" + k, day = Math.floor(now / DAY);
  let h = posts.get(key);
  if (!h || h.day !== day) h = { day, dn: 0, t: now, mn: 0 };
  if (now - h.t > 60000) { h.t = now; h.mn = 0; }
  if (h.mn + 1 > FRM_LIMITS.postPerMin || h.dn + 1 > FRM_LIMITS.postPerDay) return true;
  h.mn++; h.dn++;
  if (posts.size > 5000) posts.clear();
  posts.set(key, h);
  return false;
}

// A seat form takes at most yesPerDay "yes" answers from one IP a day.
function yesLimited(ip, k, now) {
  if (!ip) return false;
  const key = ip + "|" + k, day = Math.floor(now / DAY);
  let h = yeses.get(key);
  if (!h || h.day !== day) h = { day, n: 0 };
  if (h.n + 1 > FRM_LIMITS.yesPerDay) return true;
  h.n++;
  if (yeses.size > 5000) yeses.clear();
  yeses.set(key, h);
  return false;
}

// ---------- the app's op ----------
function int(v, lo, hi) { return Number.isSafeInteger(v) && v >= lo && v <= hi; }
export function validFrm(b) {
  if (["put", "upd", "peek", "pull", "ack", "drop"].indexOf(b.act) < 0) return "act";
  if (typeof b.k !== "string" || !K_RE.test(b.k)) return "k";
  if (typeof b.sec !== "string" || !SEC_RE.test(b.sec)) return "sec";
  if (b.act === "put" && !(typeof b.def === "string" && DEF_RE.test(b.def))) return "def";
  if (b.act === "put" || b.act === "upd") {
    if (b.open !== undefined && b.open !== 0 && b.open !== 1) return "open";
    if (b.close !== undefined && !int(b.close, 0, 9e15)) return "close";
    if (b.cap !== undefined && !int(b.cap, 0, FRM_LIMITS.capMax)) return "cap";
    if (b.maxSeats !== undefined && !int(b.maxSeats, 1, FRM_LIMITS.seats)) return "maxSeats";
  }
  if (b.act === "upd") {
    if (b.taken !== undefined && !int(b.taken, 0, FRM_LIMITS.capMax * 2)) return "taken";
    if (b.push !== undefined && b.push !== null) {
      const p = b.push;
      if (!p || typeof p !== "object" || !PID_RE.test(p.pid || "") || !WT_RE.test(p.wt || "") || !validCt(p.ct)) return "push";
    }
  }
  if (b.act === "pull" && !int(b.after, 0, Number.MAX_SAFE_INTEGER)) return "after";
  if (b.act === "ack" && !int(b.upto, 0, Number.MAX_SAFE_INTEGER)) return "upto";
  return "";
}

// The form, or "gone" for a missing one and a wrong secret alike.
async function owned(d, k, sec) {
  const row = await q(d, FRM_SQL.getForm, k).first();
  const hash = await sha256Hex(sec);
  if (!row || !sameHex(row.sec, hash)) throw new FrmError("gone", 404);
  return row;
}
function isOpen(row, now) { return row.open === 1 && !(row.close > 0 && row.close <= now); }

export async function runFrm(b, env, now) {
  const d = await db(env);
  if (b.act === "put") {
    const len = b.def.length;
    const open = b.open === 0 ? 0 : 1, close = b.close || 0, cap = b.cap || 0;
    const row = await q(d, FRM_SQL.getForm, b.k).first();
    const tot = await q(d, FRM_SQL.getTot).first();
    const hash = await sha256Hex(b.sec);
    if (row) {
      if (!sameHex(row.sec, hash)) throw new FrmError("gone", 404);
      if (tot && tot.b + len - row.dlen > FRM_LIMITS.store && len > row.dlen) throw new FrmError("full", 507);
      await d.batch([q(d, FRM_SQL.setDef, b.k, b.def, len, open, close, cap, b.maxSeats || row.ms || FRM_LIMITS.seatsDefault), q(d, FRM_SQL.addTot, 0, len - row.dlen)]);
      return { ok: true };
    }
    if (tot && tot.c >= FRM_LIMITS.forms) throw new FrmError("full", 507);
    if (tot && tot.b + len > FRM_LIMITS.store) throw new FrmError("full", 507);
    const r = await q(d, FRM_SQL.addForm, b.k, hash, b.def, len, open, close, cap, now, b.maxSeats || FRM_LIMITS.seatsDefault).run();
    if (!changes(r)) throw new FrmError("gone", 404);        // made a moment ago with another secret
    await q(d, FRM_SQL.addTot, 1, len).run();
    return { ok: true };
  }
  const row = await owned(d, b.k, b.sec);
  if (b.act === "upd") {
    const open = b.open === undefined ? row.open : b.open;
    const reopened = b.open === 1;
    await q(d, FRM_SQL.setState, b.k, open, b.close === undefined ? row.close : b.close,
            b.cap === undefined ? row.cap : b.cap, b.taken === undefined ? -1 : b.taken,
            reopened ? 0 : row.rep, reopened ? 0 : row.rn, b.maxSeats || row.ms || FRM_LIMITS.seatsDefault).run();
    if (b.push !== undefined) {
      const p = b.push;
      await q(d, FRM_SQL.setPush, b.k, p ? p.pid : null, p ? p.wt : null, p ? p.ct : null).run();
    }
    return { ok: true };
  }
  if (b.act === "peek") return { n: row.wn, open: isOpen(row, now) ? 1 : 0, rep: row.rep };
  if (b.act === "pull") {
    await q(d, FRM_SQL.pulled, b.k, now).run();
    const res = await q(d, FRM_SQL.pull, b.k, b.after, FRM_LIMITS.pull + 1).all();
    const rows = (res && res.results) || [];
    return { rows: rows.slice(0, FRM_LIMITS.pull).map((r) => (r.w ? { id: r.id, v: r.v, at: r.at, w: 1 } : { id: r.id, v: r.v, at: r.at })),
             more: rows.length > FRM_LIMITS.pull, open: isOpen(row, now) ? 1 : 0, rep: row.rep, taken: row.taken };
  }
  if (b.act === "ack") {
    const n = await q(d, FRM_SQL.acked, b.k, b.upto).first();
    const c = (n && n.c) | 0, bytes = (n && n.b) | 0;
    if (!c) return { n: 0 };
    await d.batch([q(d, FRM_SQL.ack, b.k, b.upto), q(d, FRM_SQL.unwait, b.k, c, bytes), q(d, FRM_SQL.addTot, 0, -bytes)]);
    return { n: c };
  }
  // drop
  await d.batch([q(d, FRM_SQL.dropRows, b.k), q(d, FRM_SQL.dropForm, b.k), q(d, FRM_SQL.addTot, -1, -((row.dlen | 0) + (row.wb | 0)))]);
  return { ok: true };
}

// ---------- waking the owner's device ----------
// relay/push.js "wake" (stub to stub, as relay/house.js does). No retry
// loop; a box that answers "gone" is forgotten.
async function wake(d, env, k, row, now) {
  if (!row.pid || !row.wt || !row.ct || now - (row.woke || 0) < FRM_LIMITS.wakeGapMs) return;
  try {
    await q(d, FRM_SQL.setWoke, k, now).run();
    if (!env || !env.PUSH) return;
    const stub = env.PUSH.get(env.PUSH.idFromName(row.pid));
    const x = await stub.fetch("https://push.box/", { method: "POST", headers: { "Content-Type": "application/json" },
                                                     body: JSON.stringify({ act: "wake", wt: row.wt, ct: row.ct, now: now }) });
    const res = await x.json();
    if (res && res.ok === false && res.code === "gone") await q(d, FRM_SQL.setPush, k, null, null, null).run();
  } catch (e) { /* the next answer tries again */ }
}

// ---------- the public routes ----------
function formOrigins(env) {
  const raw = env && typeof env.FORMS_ORIGINS === "string" && env.FORMS_ORIGINS ? env.FORMS_ORIGINS.split(",") : FORM_ORIGINS;
  return raw.map((s) => s.trim()).filter(Boolean);
}
function corsOf(origin) {
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
           "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600", "Vary": "Origin" };
}
function out(status, body, origin) {
  const h = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
  if (origin) Object.assign(h, corsOf(origin));
  return new Response(JSON.stringify(body), { status, headers: h });
}
async function readBody(request, max) {
  const len = +(request.headers.get("Content-Length") || 0);
  if (len > max) return null;
  const reader = request.body ? request.body.getReader() : null;
  if (!reader) return "";
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
  return new TextDecoder().decode(all);
}

// Every request under /fm/ (core.js calls it before its own routes).
// Never throws.
export async function handleForms(request, env, url, origin, ip, now) {
  const okOrigin = formOrigins(env).indexOf(origin) >= 0 ? origin : "";
  try {
    if (request.method === "OPTIONS") {
      if (!okOrigin) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsOf(okOrigin) });
    }
    const m = FM_RE.exec(url.pathname);
    if (!m) return out(404, { e: "gone" }, okOrigin);
    if (!okOrigin) return out(403, { e: "origin" }, "");
    const k = m[1], report = !!m[2];
    if (request.method === "GET" && !report) {
      if (getLimited(ip, now)) return out(429, { e: "busy" }, okOrigin);
      const d = await db(env);
      const row = await q(d, FRM_SQL.getPublic, k).first();
      if (!row) return out(404, { e: "gone" }, okOrigin);
      const o = { def: row.def, open: isOpen(row, now) ? 1 : 0 };
      if (row.cap > 0) { o.cap = row.cap; o.taken = row.taken; o.maxSeats = row.ms; }
      return out(200, o, okOrigin);
    }
    if (request.method !== "POST") {
      const r = out(405, { e: "method" }, okOrigin);
      r.headers.set("Allow", "GET, POST, OPTIONS");
      return r;
    }
    if (report) return await doReport(env, k, ip, now, okOrigin);
    const text = await readBody(request, FRM_LIMITS.body);
    if (text === null) return out(413, { e: "big" }, okOrigin);
    let b;
    try { b = JSON.parse(text); } catch (e) { return out(400, { e: "bad" }, okOrigin); }
    if (!b || typeof b !== "object" || Array.isArray(b)) return out(400, { e: "bad" }, okOrigin);
    const d = await db(env);
    const row = await q(d, FRM_SQL.getForm, k).first();
    if (!row) return out(404, { e: "gone" }, okOrigin);
    if (!isOpen(row, now)) return out(200, { e: "closed" }, okOrigin);
    // A robot filled the hidden field: it sees the usual answer, nothing is kept.
    if (b.hp) return out(200, { ok: true }, okOrigin);
    if (typeof b.v !== "string" || !V_RE.test(b.v)) return out(400, { e: "bad" }, okOrigin);
    if (b.yes !== undefined && b.yes !== 0 && b.yes !== 1) return out(400, { e: "bad" }, okOrigin);
    if (b.seats !== undefined && !int(b.seats, 1, row.ms || FRM_LIMITS.seatsDefault)) return out(400, { e: "bad" }, okOrigin);
    if (postLimited(ip, k, now)) return out(429, { e: "busy" }, okOrigin);
    if (row.cap > 0 && b.yes === 1 && yesLimited(ip, k, now)) return out(429, { e: "busy" }, okOrigin);
    const today = Math.floor(now / DAY);
    const used = row.day === today ? (row.dn | 0) : 0;
    const len = b.v.length;
    if (used >= FRM_LIMITS.perDay || row.wn >= FRM_LIMITS.waiting || row.wb + len > FRM_LIMITS.waitBytes) {
      return out(200, { e: "busy" }, okOrigin);
    }
    const tot = await q(d, FRM_SQL.getTot).first();
    if (tot && tot.b + len > FRM_LIMITS.store) return out(507, { e: "full" }, okOrigin);
    // Seats (Calendar RSVP): a "yes" takes its seats with one conditional
    // UPDATE (atomic, so two answers cannot both get the last seat);
    // when they do not fit it is kept on the waiting list.
    let take = 0, wait = 0;
    if (row.cap > 0 && b.yes === 1) {
      const seats = b.seats || 1;
      if (changes(await q(d, FRM_SQL.take, k, seats).run())) take = seats; else wait = 1;
    }
    try {
      await d.batch([q(d, FRM_SQL.addRow, k, b.v, len, wait, now), q(d, FRM_SQL.bump, k, today, used + 1, len),
                     q(d, FRM_SQL.addTot, 0, len)]);
    } catch (e) {
      if (take) { try { await q(d, FRM_SQL.untake, k, take).run(); } catch (e2) { /* the owner can correct taken */ } }
      throw e;
    }
    await wake(d, env, k, row, now);
    return out(200, wait ? { ok: true, wait: true } : { ok: true }, okOrigin);
  } catch (e) {
    return out(503, { e: "off" }, okOrigin);              // a D1 failure; never its text
  }
}

async function doReport(env, k, ip, now, okOrigin) {
  const d = await db(env);
  const row = await q(d, FRM_SQL.getForm, k).first();
  if (!row) return out(200, { ok: true }, okOrigin);
  const day = Math.floor(now / DAY);
  // Only a hash that cannot be turned back into the address, per day.
  const h = await sha256Hex("frm-report|" + day + "|" + k + "|" + (ip || "-"));
  const r = await q(d, FRM_SQL.addRep, k, h, now).run();
  if (!changes(r)) return out(200, { ok: true }, okOrigin);
  const rn = (row.rday === day ? (row.rn | 0) : 0) + 1;
  const shut = rn >= FRM_LIMITS.reports;
  await q(d, FRM_SQL.setRep, k, day, rn, shut ? 0 : row.open, shut ? 1 : row.rep).run();
  await wake(d, env, k, row, now);
  return out(200, { ok: true }, okOrigin);
}
