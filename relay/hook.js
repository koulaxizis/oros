// Incoming webhooks for Automations (wave A5, item 23). Optional and off
// by default: a device that turns it on in Automations gets a box here
// (one SQLite Durable Object, HookBox) and a secret address
//   POST /wh/<id>.<sec>      id: 22 base64url (the box), sec: 43 base64url
// that any service (n8n, Home Assistant, a form, a script) can post a
// small JSON object to. The relay encrypts it at once to the device's
// own public key (RFC 8291 aes128gcm, the same scheme as webpush.js) and
// keeps only that ciphertext until the device pulls and acks it. The
// relay does see the JSON as it arrives (the sender posts it in plain
// text); it never stores it in clear and never logs it.
//
// Ingress (no Origin check, no CORS, nothing in the answer):
//   POST only, body ≤ 4 KB read with a streaming cap, a JSON object only.
//   202 empty (stored) | 400 bad | 404 gone (no box, wrong sec, expired)
//   | 405 method | 413 too big | 429 rate or queue full (never drops).
//
// Management: POST /v1 { op:"hook", act, id, tok, ... } (read token tok,
// 43 base64url, never the URL secret):
//   new   { wh, key, auth }  create the box: wh = SHA-256 hex of sec,
//                            key = the device's P-256 public key (65
//                            bytes, base64url), auth = 16 bytes base64url
//   pull  {}                 → { items:[{ i, at, ct }], exp }
//   ack   { ids:[i…] }       delete what the device has handled
//   renew {}                 → { exp } another 7 days
//   rot   { wh }             a new address: the old one is gone, the queue wiped
//   del   {}                 forget the box
// tok and sec are kept only as SHA-256 and compared in constant time.
// A wrong tok, a missing box and an expired box all answer "gone".

export const HOOK_LIMITS = {
  bodyBytes: 4096,               // one incoming JSON
  queueItems: 100,               // items waiting per box
  queueBytes: 256 * 1024,        // ciphertext waiting per box
  lifeMs: 7 * 86400000,          // the box expires 7 days after new / renew
  boxPerMin: 30, boxPerDay: 500, // incoming per box
  ipPerMin: 30,                  // incoming per sender IP (per isolate, best effort)
  newPerDay: 5,                  // `new` per IP per day (per isolate)
  pull: 50                       // items per pull
};

const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const TOK_RE = /^[A-Za-z0-9_-]{43}$/;
const WH_RE = /^[0-9a-f]{64}$/;
const KEY_RE = /^[A-Za-z0-9_-]{87}$/;     // 65 bytes
const AUTH_RE = /^[A-Za-z0-9_-]{22}$/;    // 16 bytes
export const ROUTE_RE = /^\/wh\/([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;
const RS = 4096;

export class HookError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

// ---------- validation of the op ----------
export function validHookIn(b) {
  if (["new", "pull", "ack", "renew", "rot", "del"].indexOf(b.act) < 0) return "act";
  if (!ID_RE.test(b.id || "")) return "id";
  if (!TOK_RE.test(b.tok || "")) return "tok";
  if ((b.act === "new" || b.act === "rot") && !WH_RE.test(b.wh || "")) return "wh";
  if (b.act === "new" && (!KEY_RE.test(b.key || "") || !AUTH_RE.test(b.auth || ""))) return "key";
  if (b.act === "ack") {
    if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > HOOK_LIMITS.pull) return "ids";
    if (b.ids.some((i) => !Number.isInteger(i) || i <= 0)) return "ids";
  }
  return "";
}

// ---------- rate counters (per isolate, best effort) ----------
const ipHits = new Map(), newHits = new Map();
function over(map, key, now, win, max) {
  if (!key) return false;
  const h = map.get(key);
  if (!h || now - h.t > win) { map.set(key, { t: now, n: 1 }); if (map.size > 5000) map.clear(); return false; }
  return ++h.n > max;
}

// ---------- the op (core.js hands it over after origin, rate and validation) ----------
export async function runHookIn(b, env, now, ip) {
  if (!env || !env.HOOK) throw new HookError(503, "nohook");
  if (b.act === "new" && over(newHits, ip, now, 86400000, HOOK_LIMITS.newPerDay)) throw new HookError(429, "rate");
  const inner = { act: b.act, tok: b.tok, now: now };
  if (b.act === "new" || b.act === "rot") inner.wh = b.wh;
  if (b.act === "new") { inner.key = b.key; inner.auth = b.auth; }
  if (b.act === "ack") inner.ids = b.ids.slice();
  const res = await toBox(env, b.id, inner);
  if (!res || res.ok !== true) {
    const code = res && typeof res.code === "string" && STATUS[res.code] ? res.code : "nostore";
    throw new HookError(STATUS[code], code);
  }
  return res.data;
}
const STATUS = { gone: 404, rate: 429, full: 429, "bad-request": 400, nohook: 503, nostore: 503 };

async function toBox(env, id, inner) {
  try {
    const stub = env.HOOK.get(env.HOOK.idFromName(id));
    const r = await stub.fetch("https://hook.box/", { method: "POST", headers: { "Content-Type": "application/json" },
                                                     body: JSON.stringify(inner) });
    return await r.json();
  } catch (e) { return null; }
}

// ---------- ingress: POST /wh/<id>.<sec> ----------
function bare(status) {
  return new Response(null, { status: status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
// The body, but never more than max + 1 bytes of it (a longer one is refused
// without reading the rest). → string or null when too big.
async function capped(request, max) {
  const len = +(request.headers.get("Content-Length") || 0);
  if (len > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader(), parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { try { await reader.cancel(); } catch (e) {} return null; }
    parts.push(value);
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return new TextDecoder("utf-8", { fatal: true }).decode(all);
}

export async function handleHookIn(request, env, url, ip, now) {
  try {
    const m = ROUTE_RE.exec(url.pathname);
    if (!m) return bare(404);
    if (request.method !== "POST") return bare(405);
    if (over(ipHits, ip, now, 60000, HOOK_LIMITS.ipPerMin)) return bare(429);
    if (!env || !env.HOOK) return bare(503);
    let text;
    try { text = await capped(request, HOOK_LIMITS.bodyBytes); } catch (e) { return bare(400); }
    if (text === null) return bare(413);
    let o;
    try { o = JSON.parse(text); } catch (e) { return bare(400); }
    if (!o || typeof o !== "object" || Array.isArray(o)) return bare(400);
    const res = await toBox(env, m[1], { act: "in", wh: await sha256hex(m[2]), body: JSON.stringify(o), now: now });
    if (res && res.ok === true) return bare(202);
    const code = res && res.code;
    return bare(code === "gone" ? 404 : code === "rate" || code === "full" ? 429 : code === "bad-request" ? 400 : 503);
  } catch (e) {
    return bare(503);   // never the text, never the address
  }
}

// ---------- bytes, SHA-256, RFC 8291 (as webpush.js encrypt) ----------
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
function cat(...a) {
  const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of a) { out.set(x, o); o += x.length; }
  return out;
}
const utf8 = (s) => new TextEncoder().encode(s);
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
async function sha256hex(s) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(s)));
  return Array.from(d, (x) => (x < 16 ? "0" : "") + x.toString(16)).join("");
}
function sameText(a, b) {   // constant time for equal lengths
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
// RFC 8291 + RFC 8188, one record; the receiver's P-256 key and auth secret
// (base64url). Same steps as webpush.js encrypt(), which the shell uses for
// Web Push; the device decrypts with automations/hookin.js.
export async function encrypt(plain, p256dh, auth) {
  const ua = unb64u(p256dh), secret = unb64u(auth), salt = crypto.getRandomValues(new Uint8Array(16));
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, kp.privateKey, 256));
  const prkKey = await hmac(secret, ecdh);
  const ikm = await hmac(prkKey, cat(utf8("WebPush: info\0"), ua, asPub, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(utf8("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(utf8("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const k = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, k, cat(utf8(plain), new Uint8Array([2]))));
  const head = new Uint8Array(21);
  head.set(salt, 0);
  head[16] = (RS >>> 24) & 255; head[17] = (RS >>> 16) & 255; head[18] = (RS >>> 8) & 255; head[19] = RS & 255;
  head[20] = asPub.length;
  return b64u(cat(head, asPub, ct));
}

// ---------- the box ----------
const SQL = {
  meta: "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)",
  items: "CREATE TABLE IF NOT EXISTS items (i INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, ct TEXT NOT NULL)",
  getMeta: "SELECT v FROM meta WHERE k = 'box'",
  putMeta: "INSERT OR REPLACE INTO meta (k, v) VALUES ('box', ?)",
  clear: "DELETE FROM items",
  insert: "INSERT INTO items (at, ct) VALUES (?, ?)",
  size: "SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(ct)), 0) AS b FROM items",
  list: "SELECT i, at, ct FROM items ORDER BY i LIMIT ?",
  drop: "DELETE FROM items WHERE i = ?"
};

export class HookBox {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sql = state.storage.sql;
    this.sql.exec(SQL.meta);
    this.sql.exec(SQL.items);
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
    this.sql.exec(SQL.meta);
    this.sql.exec(SQL.items);
  }
  async fetch(request) {
    let b;
    try { b = await request.json(); } catch (e) { return reply({ ok: false, code: "bad-request" }); }
    try { return reply(await this.act(b)); }
    catch (e) { return reply({ ok: false, code: "nostore" }); }   // never the text
  }

  async act(b) {
    const now = b.now;
    let m = this.meta();
    if (m && now >= m.exp) { await this.wipe(); m = null; }        // expired: as if it never was
    if (b.act === "in") return this.take(m, b, now);
    const th = await sha256hex(String(b.tok || ""));
    if (b.act === "new") {
      if (m && !sameText(m.th, th)) return { ok: false, code: "gone" };
      const nm = { th: th, wh: b.wh, key: b.key, auth: b.auth, exp: now + HOOK_LIMITS.lifeMs, min: [now, 0], day: [now, 0] };
      this.state.storage.transactionSync(() => { this.sql.exec(SQL.clear); this.saveMeta(nm); });
      await this.state.storage.setAlarm(nm.exp);
      return { ok: true, data: { exp: nm.exp } };
    }
    if (!m || !sameText(m.th, th)) return { ok: false, code: "gone" };
    if (b.act === "del") { await this.wipe(); return { ok: true, data: { ok: true } }; }
    if (b.act === "rot") {
      m.wh = b.wh;
      this.state.storage.transactionSync(() => { this.sql.exec(SQL.clear); this.saveMeta(m); });
      return { ok: true, data: { ok: true } };
    }
    if (b.act === "renew") {
      m.exp = now + HOOK_LIMITS.lifeMs;
      this.saveMeta(m);
      await this.state.storage.setAlarm(m.exp);
      return { ok: true, data: { exp: m.exp } };
    }
    if (b.act === "ack") {
      this.state.storage.transactionSync(() => { for (const i of b.ids) this.sql.exec(SQL.drop, i); });
      return { ok: true, data: { ok: true } };
    }
    // pull: the oldest items, still encrypted; they stay until acked
    const items = this.sql.exec(SQL.list, HOOK_LIMITS.pull).toArray().map((r) => ({ i: r.i, at: r.at, ct: r.ct }));
    return { ok: true, data: { items: items, exp: m.exp } };
  }

  // One incoming JSON: right address, within the rate, room in the queue.
  async take(m, b, now) {
    if (!m || typeof b.wh !== "string" || !sameText(m.wh, b.wh)) return { ok: false, code: "gone" };
    if (typeof b.body !== "string" || b.body.length > HOOK_LIMITS.bodyBytes) return { ok: false, code: "bad-request" };
    if (now - m.min[0] > 60000) m.min = [now, 0];
    if (now - m.day[0] > 86400000) m.day = [now, 0];
    if (m.min[1] >= HOOK_LIMITS.boxPerMin || m.day[1] >= HOOK_LIMITS.boxPerDay) return { ok: false, code: "rate" };
    const sz = this.sql.exec(SQL.size).toArray()[0] || { n: 0, b: 0 };
    if (sz.n >= HOOK_LIMITS.queueItems || sz.b >= HOOK_LIMITS.queueBytes) return { ok: false, code: "full" };
    const ct = await encrypt(b.body, m.key, m.auth);
    m.min[1]++;
    m.day[1]++;
    this.state.storage.transactionSync(() => { this.sql.exec(SQL.insert, now, ct); this.saveMeta(m); });
    return { ok: true, data: { ok: true } };
  }

  async alarm() {
    const m = this.meta();
    if (!m || Date.now() >= m.exp) { await this.wipe(); return; }
    await this.state.storage.setAlarm(m.exp);      // renewed since: wait for the new expiry
  }
}

function reply(o) {
  return new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
}
