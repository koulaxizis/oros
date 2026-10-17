// Notifications with orOS closed (Web Push). Optional and off by
// default: a device that turns it on in Settings gets a box here (one
// SQLite Durable Object per device) holding its push endpoint and the
// next reminders. The page encrypts every reminder itself (RFC 8291,
// with the subscription's own keys), so a box keeps only an opaque key,
// a time and a packet it cannot read. At that time the box signs a VAPID
// token (RFC 8292, ES256) and hands the packet to the browser's push
// service, which wakes the device's service worker.
//
// POST /v1 { op:"push", act, id, tok, ... }
//   sub  { endpoint }        create the box (or change its endpoint)
//   set  { items:[{k,at,ct,ttl?}] }  replace the whole schedule
//   test { ct }              send one packet now
//   del  {}                  forget the box
//   key  (no id, no tok)     the VAPID public key; 503 "nopush" when unset
// id: 22 base64url chars (16 random bytes, made by the page); tok: 43
// base64url chars (32 random bytes), kept here only as its SHA-256.
// A wrong tok and a missing box get the same answer ("gone").

export const PUSH_LIMITS = {
  rows: 300,                    // reminders per box
  ctChars: 4096,                // one packet, base64url (≈ 3 KB)
  horizonMs: 8 * 86400000,      // furthest reminder from now
  lateMs: 10 * 60000,           // older than this when the alarm runs: dropped, never rung late
  idleMs: 30 * 86400000,        // no `set` for this long: the box deletes itself
  ttl: 900, ttlMin: 60, ttlMax: 3600,   // seconds the push service may hold a packet
  subPerDay: 5,                 // `sub` per IP per day (per isolate, best effort)
  testGapMs: 30000,             // one `test` per box per 30 s
  setPerHour: 60,               // `set` per box per hour
  retries: [30000, 120000],     // after a 429 / 5xx: again in 30 s, then 2 min, then dropped
  batch: 20                     // reminders sent per alarm run
};

// Push services a subscription may point at: exact hosts, or a suffix
// (starting with "."). Nothing else is ever fetched (no SSRF).
const PUSH_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com",
                    ".push.services.mozilla.com", ".notify.windows.com", ".push.apple.com"];

const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const TOK_RE = /^[A-Za-z0-9_-]{43}$/;
const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const B64U_RE = /^[A-Za-z0-9_-]+$/;
const PATH_RE = /^\/[A-Za-z0-9._~:/%-]+$/;

export class PushError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

// ---------- validation ----------
export function validEndpoint(s) {
  if (typeof s !== "string" || s.length > 1200 || /[\s\\]/.test(s)) return false;
  let u;
  try { u = new URL(s); } catch (e) { return false; }
  if (u.protocol !== "https:" || u.port || u.username || u.password || u.hash) return false;
  if (u.pathname.length > 1024 || !PATH_RE.test(u.pathname)) return false;
  if (u.search && !/^\?[A-Za-z0-9._~=&%-]{1,512}$/.test(u.search)) return false;
  const h = u.hostname.toLowerCase();
  return PUSH_HOSTS.some((p) => p.charAt(0) === "." ? h.length > p.length && h.slice(-p.length) === p : h === p);
}

function validCt(c) { return typeof c === "string" && c.length >= 24 && c.length <= PUSH_LIMITS.ctChars && B64U_RE.test(c); }

export function validPush(b) {
  if (["sub", "set", "test", "del", "key"].indexOf(b.act) < 0) return "act";
  if (b.act === "key") return "";
  if (!ID_RE.test(b.id || "")) return "id";
  if (!TOK_RE.test(b.tok || "")) return "tok";
  if (b.act === "sub" && !validEndpoint(b.endpoint)) return "endpoint";
  if (b.act === "test" && !validCt(b.ct)) return "ct";
  if (b.act === "set") {
    if (!Array.isArray(b.items) || b.items.length > PUSH_LIMITS.rows) return "items";
    const seen = new Set();
    for (const it of b.items) {
      if (!it || typeof it !== "object" || !KEY_RE.test(it.k || "") || seen.has(it.k)) return "items";
      seen.add(it.k);
      if (!Number.isInteger(it.at) || it.at <= 0) return "at";
      if (!validCt(it.ct)) return "ct";
      if (it.ttl !== undefined && !(Number.isInteger(it.ttl) && it.ttl >= PUSH_LIMITS.ttlMin && it.ttl <= PUSH_LIMITS.ttlMax)) return "ttl";
    }
  }
  return "";
}

// ---------- the op (core.js hands it over after origin, rate and validation) ----------
const subHits = new Map();
function subLimited(ip, now) {
  if (!ip) return false;
  const h = subHits.get(ip);
  if (!h || now - h.t > 86400000) { subHits.set(ip, { t: now, n: 1 }); return false; }
  if (subHits.size > 5000) subHits.clear();
  return ++h.n > PUSH_LIMITS.subPerDay;
}

export async function runPush(b, env, now, ip) {
  if (!env || !env.PUSH || !vapidReady(env)) throw new PushError(503, "nopush");
  if (b.act === "key") return { key: vapidPublicKey(env) };
  if (b.act === "set" && b.items.some((it) => it.at > now + PUSH_LIMITS.horizonMs)) throw new PushError(400, "bad-request");
  if (b.act === "sub" && subLimited(ip, now)) throw new PushError(429, "rate");
  // Only the fields the box needs; nothing else from the request reaches it.
  const inner = { act: b.act, tok: b.tok, now: now };
  if (b.act === "sub") inner.endpoint = b.endpoint;
  if (b.act === "test") inner.ct = b.ct;
  if (b.act === "set") inner.items = b.items.map((it) => ({ k: it.k, at: it.at, ct: it.ct, ttl: it.ttl || PUSH_LIMITS.ttl }));
  let res;
  try {
    const stub = env.PUSH.get(env.PUSH.idFromName(b.id));
    const r = await stub.fetch("https://push.box/", { method: "POST", headers: { "Content-Type": "application/json" },
                                                     body: JSON.stringify(inner) });
    res = await r.json();
  } catch (e) { throw new PushError(503, "nostore"); }
  if (!res || res.ok !== true) {
    const code = res && typeof res.code === "string" ? res.code : "nostore";
    throw new PushError(STATUS[code] || 503, STATUS[code] ? code : "nostore");
  }
  return res.data;
}
const STATUS = { gone: 404, rate: 429, "bad-request": 400, nopush: 503, nostore: 503 };

// ---------- base64url, SHA-256, VAPID ----------
function b64u(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64u(s) {
  const t = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(t.length);
  for (let i = 0; i < t.length; i++) out[i] = t.charCodeAt(i);
  return out;
}
async function sha256hex(s) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(d, (x) => (x < 16 ? "0" : "") + x.toString(16)).join("");
}
function sameText(a, b) {   // constant time for equal lengths
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

// VAPID_PRIVATE: the P-256 private key as a JWK (JSON with d, x, y).
// VAPID_SUBJECT: "mailto:…" or "https://…", the contact push services see.
function vapidJwk(env) {
  try {
    const j = JSON.parse(env.VAPID_PRIVATE || "");
    if (j && j.kty === "EC" && j.crv === "P-256" && [j.d, j.x, j.y].every((v) => typeof v === "string" && B64U_RE.test(v))) return j;
  } catch (e) {}
  return null;
}
function vapidReady(env) {
  return !!vapidJwk(env) && typeof env.VAPID_SUBJECT === "string" && /^(mailto:|https:\/\/)\S{3,200}$/.test(env.VAPID_SUBJECT);
}
export function vapidPublicKey(env) {   // what the page passes to pushManager.subscribe
  const j = vapidJwk(env);
  if (!j) return "";
  const x = unb64u(j.x), y = unb64u(j.y), raw = new Uint8Array(65);
  raw[0] = 4; raw.set(x, 1); raw.set(y, 33);
  return b64u(raw);
}
export async function vapidToken(env, aud, nowMs) {
  const j = vapidJwk(env);
  const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", d: j.d, x: j.x, y: j.y, ext: true },
                                            { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const enc = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const exp = Math.floor(nowMs / 1000) + 12 * 3600;
  const head = enc({ typ: "JWT", alg: "ES256" }) + "." + enc({ aud: aud, exp: exp, sub: env.VAPID_SUBJECT });
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(head)));
  return { jwt: head + "." + b64u(sig), exp: exp * 1000 };
}

// ---------- the box ----------
const SQL = {
  meta: "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)",
  rows: "CREATE TABLE IF NOT EXISTS rows (k TEXT PRIMARY KEY, at INTEGER NOT NULL, ct TEXT NOT NULL, ttl INTEGER NOT NULL, tries INTEGER NOT NULL)",
  getMeta: "SELECT v FROM meta WHERE k = 'box'",
  putMeta: "INSERT OR REPLACE INTO meta (k, v) VALUES ('box', ?)",
  clear: "DELETE FROM rows",
  insert: "INSERT INTO rows (k, at, ct, ttl, tries) VALUES (?, ?, ?, ?, 0)",
  next: "SELECT at FROM rows ORDER BY at LIMIT 1",
  due: "SELECT k, at, ct, ttl, tries FROM rows WHERE at <= ? ORDER BY at LIMIT ?",
  drop: "DELETE FROM rows WHERE k = ?",
  retry: "UPDATE rows SET at = ?, tries = ? WHERE k = ?",
  count: "SELECT COUNT(*) AS n FROM rows"
};

export class PushBox {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sql = state.storage.sql;
    this.fetchFn = (u, o) => fetch(u, o);
    this.jwts = new Map();     // aud → { jwt, exp }, in memory only
    this.sql.exec(SQL.meta);
    this.sql.exec(SQL.rows);
  }

  meta() {
    const r = this.sql.exec(SQL.getMeta).toArray()[0];
    if (!r) return null;
    try { return JSON.parse(r.v); } catch (e) { return null; }
  }
  saveMeta(m) { this.sql.exec(SQL.putMeta, JSON.stringify(m)); }

  async wipe() {
    await this.state.storage.deleteAlarm();
    await this.state.storage.deleteAll();
    this.jwts.clear();
    this.sql.exec(SQL.meta);   // empty tables again, so a new `sub` on this instance works
    this.sql.exec(SQL.rows);
  }

  // One alarm: the next reminder, or the idle deadline when that is sooner.
  async arm(m) {
    const n = this.sql.exec(SQL.next).toArray()[0];
    const idle = m.last + PUSH_LIMITS.idleMs;
    await this.state.storage.setAlarm(n ? Math.min(n.at, idle) : idle);
  }

  async fetch(request) {
    let b;
    try { b = await request.json(); } catch (e) { return reply({ ok: false, code: "bad-request" }); }
    try {
      return reply(await this.act(b));
    } catch (e) {
      return reply({ ok: false, code: "nostore" });   // never the text
    }
  }

  async act(b) {
    const now = b.now, m = this.meta();
    const th = await sha256hex(b.tok);
    if (b.act === "sub") {
      if (m && !sameText(m.th, th)) return { ok: false, code: "gone" };
      if (!validEndpoint(b.endpoint)) return { ok: false, code: "bad-request" };
      const nm = m || { th: th, sets: [now, 0], test: 0 };
      nm.ep = b.endpoint;
      nm.last = now;
      this.saveMeta(nm);
      await this.arm(nm);
      return { ok: true, data: { ok: true } };
    }
    if (!m || !sameText(m.th, th)) return { ok: false, code: "gone" };
    if (b.act === "del") { await this.wipe(); return { ok: true, data: { ok: true } }; }
    if (b.act === "test") {
      if (now - (m.test || 0) < PUSH_LIMITS.testGapMs) return { ok: false, code: "rate" };
      m.test = now;
      this.saveMeta(m);
      const st = await this.send(m, b.ct, 60, now);
      if (st === "gone") { await this.wipe(); return { ok: false, code: "gone" }; }
      return { ok: true, data: { sent: st === "sent" } };
    }
    // set: the whole schedule, replaced in one transaction
    if (!Array.isArray(m.sets) || now - m.sets[0] > 3600000) m.sets = [now, 0];
    if (++m.sets[1] > PUSH_LIMITS.setPerHour) return { ok: false, code: "rate" };
    m.last = now;
    this.state.storage.transactionSync(() => {
      this.sql.exec(SQL.clear);
      for (const it of b.items) this.sql.exec(SQL.insert, it.k, it.at, it.ct, it.ttl);
      this.saveMeta(m);
    });
    await this.arm(m);
    return { ok: true, data: { n: b.items.length } };
  }

  async alarm() {
    const now = Date.now(), m = this.meta();
    if (!m) { await this.wipe(); return; }
    if (now - m.last >= PUSH_LIMITS.idleMs) { await this.wipe(); return; }
    if (!vapidReady(this.env)) {          // secrets missing: keep everything, look again in an hour
      await this.state.storage.setAlarm(now + 3600000);
      return;
    }
    const due = this.sql.exec(SQL.due, now, PUSH_LIMITS.batch).toArray();
    for (const r of due) {
      if (now - r.at > PUSH_LIMITS.lateMs) { this.sql.exec(SQL.drop, r.k); continue; }
      const st = await this.send(m, r.ct, r.ttl, now);
      if (st === "gone") { await this.wipe(); return; }
      if (st === "retry" && r.tries < PUSH_LIMITS.retries.length) {
        this.sql.exec(SQL.retry, now + PUSH_LIMITS.retries[r.tries], r.tries + 1, r.k);
      } else {
        this.sql.exec(SQL.drop, r.k);
      }
    }
    await this.arm(m);
  }

  // "sent" | "gone" (the subscription is dead) | "retry" | "drop"
  async send(m, ct, ttl, now) {
    if (!validEndpoint(m.ep)) return "gone";
    const aud = new URL(m.ep).origin;
    let t = this.jwts.get(aud);
    if (!t || t.exp - now < 3600000) {
      t = await vapidToken(this.env, aud, now);
      this.jwts.set(aud, t);
    }
    let r;
    try {
      r = await this.fetchFn(m.ep, {
        method: "POST",
        redirect: "manual",
        headers: {
          "Authorization": "vapid t=" + t.jwt + ", k=" + vapidPublicKey(this.env),
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          "TTL": String(ttl),
          "Urgency": "high"
        },
        body: unb64u(ct)
      });
    } catch (e) { return "retry"; }
    const s = r.status;
    try { if (r.body && typeof r.body.cancel === "function") r.body.cancel(); } catch (e) {}   // never read
    if (s >= 200 && s < 300) return "sent";
    if (s === 404 || s === 410) return "gone";
    if (s === 429 || s >= 500) return "retry";
    return "drop";   // 413, other 4xx, a redirect (never followed)
  }
}

function reply(o) {
  return new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
}
