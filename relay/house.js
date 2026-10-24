// ============================================================
// orOS Mail relay — Household boxes (shared apps between people,
// household/engine.js). One SQLite Durable Object per household holds
// what its members share, as ciphertext only: the browser encrypts
// every document with the household key (AES-256-GCM), which never
// leaves the members' devices. See relay/README.md "Household".
//
// In clear the box keeps: document ids (random), their revisions and
// sizes, SHA-256 of the write token (current + the last 20), of the
// admin token and of each invite secret, the time of the last request,
// and short encrypted join requests, answers and key envelopes.
//
// Routes (origin-gated, own CORS and rate limit), <box> = 22 base64url:
//   POST   /h/<box>            { act:"new", wh, ah }  create (hex SHA-256 of W and A)
//   GET    /h/<box>            W   → { epoch, revs{k:rev}, size, reqs[rid], last }
//                                    (a past W: { moved:true, epoch })
//   DELETE /h/<box>            W+A delete the household
//   GET    /h/<box>/d/<k>      W   one document (bytes), X-Rev header
//   PUT    /h/<box>/d/<k>      W   If-Match: <rev> (0 = new) → { rev } | 412 { rev }
//   DELETE /h/<box>/d/<k>      W   If-Match: <rev>
//   POST   /h/<box>/i          W   { ih, exp, n } an invite (n join requests allowed)
//   DELETE /h/<box>/i/<ih>     W   withdraw an invite
//   POST   /h/<box>/j          I   a join request (bytes ≤ 4 KB) → { rid }
//   GET    /h/<box>/a/<rid>    I   the answer: 200 bytes | 202 waiting | 410 refused
//   GET    /h/<box>/r/<rid>    W   a join request (bytes)
//   PUT    /h/<box>/r/<rid>    W   accept: the answer (bytes ≤ 8 KB)
//   DELETE /h/<box>/r/<rid>    W   refuse
//   POST   /h/<box>/rot        W+A { epoch, wh, ah?, env{mid:b64url} } new key epoch
//   GET    /h/<box>/e/<mid>    W (current or past) this member's key envelope
//   PUT    /h/<box>/e/<mid>    W+A one envelope (bytes ≤ 8 KB)
//   GET    /h/<box>/ws         WebSocket, subprotocols ["hh1", "w.<W>"]; notices
//                              {k,r} a document changed, {q:1} a join request,
//                              {e} a new key epoch, {x:1} the household is gone
// W = "Authorization: Bearer <43>", A = "X-HH-Admin: <43>",
// I = "Authorization: Invite <43>". A wrong token and a missing box get
// the same answer (404 "gone"). Nothing is logged; storage failures are
// a 503 with fixed text.
// ============================================================

export const HOUSE_LIMITS = {
  docs: 64,                    // documents per box
  docBytes: 300 * 1024,        // one encrypted document
  boxBytes: 5 * 1048576,       // all documents of a box
  reqBytes: 4096,              // one join request
  ansBytes: 8192,              // one answer / key envelope
  envs: 12,                    // members with a key envelope
  invites: 5,                  // open invites
  pending: 10,                 // join requests waiting
  reqMs: 7 * 86400000,         // a request (and its answer) lives this long
  inviteMaxMs: 30 * 86400000,  // longest invite
  inviteUses: 20,
  past: 20,                    // older write tokens still allowed to read their envelope
  sockets: 40,
  writesPerMin: 120,           // per box
  idleMs: 180 * 86400000,      // no member request for this long: the box deletes itself
  touchMs: 6 * 3600000,        // `last` is written at most this often
  perIpMin: 240,               // requests under /h/ per client IP per minute (per isolate)
  newPerIpDay: 10              // new boxes per client IP per UTC day (per isolate)
};

export const HOUSE_RE = /^\/h\/([A-Za-z0-9_-]{22})(?:\/(d|i|j|a|r|e|rot|ws)(?:\/([A-Za-z0-9_-]{1,64}))?)?$/;
const TOK_RE = /^[A-Za-z0-9_-]{43}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
const KEY_RE = /^[A-Za-z0-9_-]{1,32}$/;
const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const B64U_RE = /^[A-Za-z0-9_-]+$/;
const DAY = 86400000;

// ---------- small helpers ----------
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
// SQLite hands a BLOB back as an ArrayBuffer (a typed array in tests).
function bytesOf(v) {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  return null;
}
function buf(bytes) { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); }

// Reads a body of at most `max` bytes; null when it is bigger.
async function readBytes(request, max) {
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

// ---------- HTTP side (core.js calls it for every path under /h/) ----------
function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, If-Match, X-HH-Admin",
    "Access-Control-Expose-Headers": "X-Rev",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin"
  };
}
function baseHeaders(type) {
  return { "Content-Type": type || "application/json; charset=utf-8", "Cache-Control": "no-store",
           "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
}
function jsonRes(status, body) {
  return new Response(JSON.stringify(body), { status, headers: baseHeaders() });
}
function err(status, code, extra) {
  return jsonRes(status, Object.assign({ ok: false, error: { code: code } }, extra || {}));
}
function ok(data) { return jsonRes(200, { ok: true, data: data }); }
function bin(status, bytes, rev) {
  const h = baseHeaders("application/octet-stream");
  h["Content-Disposition"] = "attachment";
  h["Content-Security-Policy"] = "sandbox";
  if (rev !== undefined) h["X-Rev"] = String(rev);
  return new Response(bytes, { status, headers: h });
}
function withCors(res, origin) {
  if (!origin || res.status === 101) return res;
  const h = new Headers(res.headers);
  const c = cors(origin);
  Object.keys(c).forEach((k) => h.set(k, c[k]));
  return new Response(res.body, { status: res.status, headers: h });
}

const mins = new Map();
function ipLimited(ip, now) {
  if (!ip) return false;
  let h = mins.get(ip);
  if (!h || now - h.t > 60000) { h = { t: now, n: 0 }; if (mins.size > 5000) mins.clear(); mins.set(ip, h); }
  return ++h.n > HOUSE_LIMITS.perIpMin;
}
const days = new Map();
function newLimited(ip, now) {
  if (!ip) return false;
  const day = Math.floor(now / DAY);
  let h = days.get(ip);
  if (!h || h.day !== day) { h = { day, n: 0 }; if (days.size > 5000) days.clear(); days.set(ip, h); }
  return ++h.n > HOUSE_LIMITS.newPerIpDay;
}

// The operation a request asks for, or "" when the route is unknown.
export function houseOp(method, part, arg) {
  if (!part) return method === "POST" ? "new" : method === "GET" ? "info" : method === "DELETE" ? "wipe" : "";
  if (part === "d" && arg && KEY_RE.test(arg)) return { GET: "dget", PUT: "dput", DELETE: "ddel" }[method] || "";
  if (part === "i") return !arg && method === "POST" ? "inv" : (arg && HEX64_RE.test(arg) && method === "DELETE" ? "invdel" : "");
  if (part === "j") return !arg && method === "POST" ? "join" : "";
  if (part === "a") return arg && ID_RE.test(arg) && method === "GET" ? "aget" : "";
  if (part === "r" && arg && ID_RE.test(arg)) return { GET: "rget", PUT: "ans", DELETE: "refuse" }[method] || "";
  if (part === "e" && arg && ID_RE.test(arg)) return { GET: "eget", PUT: "eput" }[method] || "";
  if (part === "rot") return !arg && method === "POST" ? "rot" : "";
  if (part === "ws") return !arg && method === "GET" ? "ws" : "";
  return "";
}

export function validRot(b) {
  if (!b || typeof b !== "object") return "body";
  if (!(Number.isSafeInteger(b.epoch) && b.epoch >= 2 && b.epoch < 1e9)) return "epoch";
  if (!HEX64_RE.test(b.wh || "")) return "wh";
  if (b.ah !== undefined && !HEX64_RE.test(b.ah || "")) return "ah";
  if (!b.env || typeof b.env !== "object" || Array.isArray(b.env)) return "env";
  const ids = Object.keys(b.env);
  if (!ids.length || ids.length > HOUSE_LIMITS.envs) return "env";
  for (const id of ids) {
    const v = b.env[id];
    if (!ID_RE.test(id) || typeof v !== "string" || !B64U_RE.test(v) || v.length < 24 ||
        v.length > Math.ceil(HOUSE_LIMITS.ansBytes * 4 / 3)) return "env";
  }
  return "";
}

// Every request under /h/. Never throws.
export async function handleHouse(request, env, url, okOrigin, ip, now) {
  try {
    if (request.method === "OPTIONS") {
      if (!okOrigin) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors(okOrigin) });
    }
    const m = HOUSE_RE.exec(url.pathname);
    const op = m ? houseOp(request.method, m[2], m[3]) : "";
    if (!op) return withCors(err(404, "bad-request"), okOrigin);
    if (!okOrigin) return err(403, "origin");
    if (ipLimited(ip, now)) return withCors(err(429, "rate"), okOrigin);
    if (!env || !env.HOUSE) return withCors(err(503, "nostore"), okOrigin);

    const h = { "X-Op": op, "X-Now": String(now) };
    if (m[3]) h["X-Arg"] = m[3];
    let body = null;
    if (op === "ws") {
      if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return withCors(err(426, "bad-request"), okOrigin);
      const protos = (request.headers.get("Sec-WebSocket-Protocol") || "").split(",").map((s) => s.trim());
      const w = protos.filter((p) => p.indexOf("w.") === 0)[0];
      if (protos.indexOf("hh1") < 0 || !w || !TOK_RE.test(w.slice(2))) return err(400, "bad-request");
      h["X-W"] = w.slice(2);
    } else {
      const auth = request.headers.get("Authorization") || "";
      const bw = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(auth), bi = /^Invite ([A-Za-z0-9_-]{43})$/.exec(auth);
      if (op === "join" || op === "aget") {
        if (!bi) return withCors(err(404, "gone"), okOrigin);
        h["X-I"] = bi[1];
      } else if (op !== "new") {
        if (!bw) return withCors(err(404, "gone"), okOrigin);
        h["X-W"] = bw[1];
      }
      if (op === "wipe" || op === "rot" || op === "eput") {
        const a = request.headers.get("X-HH-Admin") || "";
        if (!TOK_RE.test(a)) return withCors(err(404, "gone"), okOrigin);
        h["X-A"] = a;
      }
      if (op === "dput" || op === "ddel") {
        const im = /^"?(\d{1,12})"?$/.exec(request.headers.get("If-Match") || "");
        if (!im) return withCors(err(428, "bad-request"), okOrigin);
        h["X-Rev"] = im[1];
      }
      const max = op === "dput" ? HOUSE_LIMITS.docBytes : op === "join" ? HOUSE_LIMITS.reqBytes :
                  (op === "ans" || op === "eput") ? HOUSE_LIMITS.ansBytes :
                  (op === "new" || op === "inv" || op === "rot") ? 16384 : 0;
      if (max) {
        const bytes = await readBytes(request, max);
        if (bytes === null) return withCors(err(413, "too-large"), okOrigin);
        if (op === "new" || op === "inv" || op === "rot") {
          let j;
          try { j = JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { return withCors(err(400, "bad-request"), okOrigin); }
          let bad = "";
          if (op === "new") bad = j && j.act === "new" && HEX64_RE.test(j.wh || "") && HEX64_RE.test(j.ah || "") ? "" : "body";
          if (op === "inv") {
            bad = j && HEX64_RE.test(j.ih || "") && Number.isSafeInteger(j.exp) && j.exp > now &&
                  j.exp <= now + HOUSE_LIMITS.inviteMaxMs + 60000 &&
                  Number.isSafeInteger(j.n) && j.n >= 1 && j.n <= HOUSE_LIMITS.inviteUses ? "" : "body";
          }
          if (op === "rot") bad = validRot(j);
          if (bad) return withCors(err(400, "bad-request"), okOrigin);
          if (op === "new" && newLimited(ip, now)) return withCors(err(429, "rate"), okOrigin);
          body = JSON.stringify(j);
        } else {
          if (!bytes.length) return withCors(err(400, "bad-request"), okOrigin);
          body = bytes;
        }
      }
    }
    const stub = env.HOUSE.get(env.HOUSE.idFromName(m[1]));
    let res;
    if (op === "ws") {
      const hh = new Headers(request.headers);
      Object.keys(h).forEach((k) => hh.set(k, h[k]));
      res = await stub.fetch(new Request("https://house.box/", { method: "GET", headers: hh }));
    } else {
      res = await stub.fetch("https://house.box/", { method: "POST", headers: h, body: body });
    }
    return withCors(res, okOrigin);
  } catch (e) {
    return withCors(err(503, "nostore"), okOrigin);
  }
}

// ---------- the box ----------
const SQL = {
  meta: "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)",
  docs: "CREATE TABLE IF NOT EXISTS docs (k TEXT PRIMARY KEY, rev INTEGER NOT NULL, len INTEGER NOT NULL, data BLOB NOT NULL)",
  inv: "CREATE TABLE IF NOT EXISTS inv (ih TEXT PRIMARY KEY, exp INTEGER NOT NULL, n INTEGER NOT NULL)",
  req: "CREATE TABLE IF NOT EXISTS req (rid TEXT PRIMARY KEY, ih TEXT NOT NULL, at INTEGER NOT NULL, st INTEGER NOT NULL, data BLOB NOT NULL, ans BLOB)",
  env: "CREATE TABLE IF NOT EXISTS env (mid TEXT PRIMARY KEY, data BLOB NOT NULL)",
  getMeta: "SELECT v FROM meta WHERE k = 'box'",
  putMeta: "INSERT OR REPLACE INTO meta (k, v) VALUES ('box', ?)",
  revs: "SELECT k, rev FROM docs",
  size: "SELECT COALESCE(SUM(len), 0) AS s, COUNT(*) AS n FROM docs",
  getDoc: "SELECT rev, data FROM docs WHERE k = ?",
  revOf: "SELECT rev, len FROM docs WHERE k = ?",
  putDoc: "INSERT OR REPLACE INTO docs (k, rev, len, data) VALUES (?, ?, ?, ?)",
  delDoc: "DELETE FROM docs WHERE k = ?",
  invCount: "SELECT COUNT(*) AS n FROM inv WHERE exp > ?",
  getInv: "SELECT exp, n FROM inv WHERE ih = ?",
  putInv: "INSERT OR REPLACE INTO inv (ih, exp, n) VALUES (?, ?, ?)",
  useInv: "UPDATE inv SET n = n - 1 WHERE ih = ?",
  delInv: "DELETE FROM inv WHERE ih = ?",
  oldInv: "DELETE FROM inv WHERE exp <= ? OR n <= 0",
  pending: "SELECT rid FROM req WHERE st = 0 AND at > ? ORDER BY at",
  addReq: "INSERT INTO req (rid, ih, at, st, data) VALUES (?, ?, ?, 0, ?)",
  getReq: "SELECT ih, at, st, data, ans FROM req WHERE rid = ?",
  ansReq: "UPDATE req SET st = 1, ans = ? WHERE rid = ? AND st = 0",
  noReq: "UPDATE req SET st = 2, data = ? WHERE rid = ? AND st = 0",
  oldReq: "DELETE FROM req WHERE at <= ?",
  clearEnv: "DELETE FROM env",
  putEnv: "INSERT OR REPLACE INTO env (mid, data) VALUES (?, ?)",
  getEnv: "SELECT data FROM env WHERE mid = ?",
  envCount: "SELECT COUNT(*) AS n FROM env"
};

export class HouseBox {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sql = state.storage.sql;
    if (typeof state.setWebSocketAutoResponse === "function" && typeof WebSocketRequestResponsePair === "function") {
      state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    }
    this.schema();
  }
  schema() {
    this.sql.exec(SQL.meta); this.sql.exec(SQL.docs); this.sql.exec(SQL.inv);
    this.sql.exec(SQL.req); this.sql.exec(SQL.env);
  }
  meta() {
    const r = this.sql.exec(SQL.getMeta).toArray()[0];
    if (!r) return null;
    try { return JSON.parse(r.v); } catch (e) { return null; }
  }
  saveMeta(m) { this.sql.exec(SQL.putMeta, JSON.stringify(m)); }
  one(q, ...v) { return this.sql.exec(q, ...v).toArray()[0] || null; }

  async wipe() {
    for (const s of this.sockets()) { try { s.send('{"x":1}'); s.close(4004, "gone"); } catch (e) {} }
    await this.state.storage.deleteAlarm();
    await this.state.storage.deleteAll();
    this.schema();
  }
  sockets() { return typeof this.state.getWebSockets === "function" ? this.state.getWebSockets() : []; }
  notice(o) {
    const s = JSON.stringify(o);
    for (const ws of this.sockets()) { try { ws.send(s); } catch (e) {} }
  }

  async fetch(request) {
    try {
      return await this.act(request);
    } catch (e) {
      return err(503, "nostore");       // never the text
    }
  }

  // A member request: refreshes `last` (at most every touchMs) and the alarm.
  async touch(m, now) {
    if (now - (m.last || 0) < HOUSE_LIMITS.touchMs) return;
    m.last = now;
    this.saveMeta(m);
    await this.state.storage.setAlarm(now + HOUSE_LIMITS.idleMs);
  }
  wrote(m, now) {   // per-box write budget; false when it is used up
    if (!Array.isArray(m.wr) || now - m.wr[0] > 60000) m.wr = [now, 0];
    return ++m.wr[1] <= HOUSE_LIMITS.writesPerMin;
  }

  async act(request) {
    const op = request.headers.get("X-Op") || "";
    const now = +(request.headers.get("X-Now") || 0) || Date.now();
    const arg = request.headers.get("X-Arg") || "";
    let m = this.meta();

    if (op === "new") {
      if (m) return err(409, "exists");
      const b = JSON.parse(await request.text());
      m = { epoch: 1, wh: b.wh, ah: b.ah, past: [], created: now, last: now, wr: [now, 0] };
      this.saveMeta(m);
      await this.state.storage.setAlarm(now + HOUSE_LIMITS.idleMs);
      return ok({ epoch: 1 });
    }
    if (!m) return err(404, "gone");

    // The invite side: a person who is not a member yet.
    if (op === "join" || op === "aget") {
      const ih = await sha256hex(request.headers.get("X-I") || "");
      if (op === "aget") {
        const r = this.one(SQL.getReq, arg);
        if (!r || !sameText(r.ih, ih) || now - r.at > HOUSE_LIMITS.reqMs) return err(404, "gone");
        if (r.st === 2) return err(410, "refused");
        if (r.st !== 1) return jsonRes(202, { ok: true, data: { wait: true } });
        return bin(200, bytesOf(r.ans));
      }
      this.sql.exec(SQL.oldInv, now);
      this.sql.exec(SQL.oldReq, now - HOUSE_LIMITS.reqMs);
      const inv = this.one(SQL.getInv, ih);
      if (!inv || inv.exp <= now || inv.n <= 0) return err(404, "gone");
      if (this.sql.exec(SQL.pending, now - HOUSE_LIMITS.reqMs).toArray().length >= HOUSE_LIMITS.pending) return err(429, "rate");
      const data = new Uint8Array(await request.arrayBuffer());
      const rid = b64u(crypto.getRandomValues(new Uint8Array(16)));
      this.state.storage.transactionSync(() => {
        this.sql.exec(SQL.addReq, rid, ih, now, buf(data));
        this.sql.exec(SQL.useInv, ih);
      });
      this.notice({ q: 1 });
      return ok({ rid: rid });
    }

    // Everything else: a member's write token.
    const wh = await sha256hex(request.headers.get("X-W") || "");
    const current = sameText(m.wh, wh);
    const past = !current && (m.past || []).some((p) => sameText(p, wh));
    if (!current) {
      if (past && op === "info") return ok({ moved: true, epoch: m.epoch });
      if (past && op === "eget") { /* allowed below */ } else return err(404, "gone");
    }
    if ((op === "wipe" || op === "rot" || op === "eput") && !sameText(m.ah, await sha256hex(request.headers.get("X-A") || ""))) {
      return err(404, "gone");
    }
    if (op === "ws") return this.accept(request, wh, m, now);

    await this.touch(m, now);
    const isWrite = op === "dput" || op === "ddel" || op === "inv" || op === "invdel" || op === "ans" ||
                    op === "refuse" || op === "rot" || op === "eput";
    if (isWrite) {
      if (!this.wrote(m, now)) { this.saveMeta(m); return err(429, "rate"); }
      this.saveMeta(m);
    }

    switch (op) {
      case "info": {
        const revs = {};
        for (const r of this.sql.exec(SQL.revs).toArray()) revs[r.k] = r.rev;
        const sz = this.one(SQL.size);
        const reqs = this.sql.exec(SQL.pending, now - HOUSE_LIMITS.reqMs).toArray().map((r) => r.rid);
        return ok({ epoch: m.epoch, revs: revs, size: sz ? sz.s : 0, reqs: reqs, last: m.last });
      }
      case "wipe":
        await this.wipe();
        return ok({ ok: true });
      case "dget": {
        const r = this.one(SQL.getDoc, arg);
        if (!r) return err(404, "none");
        return bin(200, bytesOf(r.data), r.rev);
      }
      case "dput": case "ddel": {
        const want = +(request.headers.get("X-Rev") || 0);
        const cur = this.one(SQL.revOf, arg);
        const have = cur ? cur.rev : 0;
        if (want !== have) return err(412, "stale", { rev: have });
        if (op === "ddel") {
          if (!cur) return ok({ rev: 0 });
          this.sql.exec(SQL.delDoc, arg);
          this.notice({ k: arg, r: 0 });
          return ok({ rev: 0 });
        }
        const data = new Uint8Array(await request.arrayBuffer());
        const sz = this.one(SQL.size) || { s: 0, n: 0 };
        if (!cur && sz.n >= HOUSE_LIMITS.docs) return err(413, "full");
        if (sz.s - (cur ? cur.len : 0) + data.length > HOUSE_LIMITS.boxBytes) return err(413, "full");
        const rev = have + 1;
        this.sql.exec(SQL.putDoc, arg, rev, data.length, buf(data));
        this.notice({ k: arg, r: rev });
        return ok({ rev: rev });
      }
      case "inv": {
        const b = JSON.parse(await request.text());
        this.sql.exec(SQL.oldInv, now);
        const n = this.one(SQL.invCount, now);
        if (!this.one(SQL.getInv, b.ih) && n && n.n >= HOUSE_LIMITS.invites) return err(429, "rate");
        this.sql.exec(SQL.putInv, b.ih, b.exp, b.n);
        return ok({ ok: true });
      }
      case "invdel":
        this.sql.exec(SQL.delInv, arg);
        return ok({ ok: true });
      case "rget": {
        const r = this.one(SQL.getReq, arg);
        if (!r || r.st !== 0 || now - r.at > HOUSE_LIMITS.reqMs) return err(404, "none");
        return bin(200, bytesOf(r.data));
      }
      case "ans": case "refuse": {
        const r = this.one(SQL.getReq, arg);
        if (!r || r.st !== 0 || now - r.at > HOUSE_LIMITS.reqMs) return err(404, "none");
        if (op === "ans") {
          const data = new Uint8Array(await request.arrayBuffer());
          this.sql.exec(SQL.ansReq, buf(data), arg);
        } else {
          this.sql.exec(SQL.noReq, new ArrayBuffer(1), arg);   // the request itself is dropped
        }
        return ok({ ok: true });
      }
      case "rot": {
        const b = JSON.parse(await request.text());
        if (b.epoch !== m.epoch + 1) return err(412, "stale", { epoch: m.epoch });
        m.past = [m.wh].concat(m.past || []).slice(0, HOUSE_LIMITS.past);
        m.wh = b.wh;
        if (b.ah) m.ah = b.ah;
        m.epoch = b.epoch;
        this.state.storage.transactionSync(() => {
          this.sql.exec(SQL.clearEnv);
          for (const id of Object.keys(b.env)) this.sql.exec(SQL.putEnv, id, buf(unb64u(b.env[id])));
          this.saveMeta(m);
        });
        // Sockets opened with another token are closed; the others hear of it.
        for (const ws of this.sockets()) {
          const a = ws.deserializeAttachment && ws.deserializeAttachment();
          try {
            ws.send(JSON.stringify({ e: m.epoch }));
            if (!a || !sameText(a.wh, m.wh)) ws.close(4001, "epoch");
          } catch (e) {}
        }
        return ok({ epoch: m.epoch });
      }
      case "eget": {
        const r = this.one(SQL.getEnv, arg);
        if (!r) return err(404, "none");
        return bin(200, bytesOf(r.data), m.epoch);
      }
      case "eput": {
        const data = new Uint8Array(await request.arrayBuffer());
        const n = this.one(SQL.envCount);
        if (!this.one(SQL.getEnv, arg) && n && n.n >= HOUSE_LIMITS.envs) return err(413, "full");
        this.sql.exec(SQL.putEnv, arg, buf(data));
        return ok({ ok: true });
      }
    }
    return err(404, "bad-request");
  }

  async accept(request, wh, m, now) {
    if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return err(426, "bad-request");
    if (this.sockets().length >= HOUSE_LIMITS.sockets) return err(429, "rate");
    await this.touch(m, now);
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ wh: wh });
    return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": "hh1" } });
  }

  // Members never send anything but "ping" (answered by the runtime);
  // any other frame closes the socket.
  async webSocketMessage(ws, msg) {
    if (msg === "ping") { try { ws.send("pong"); } catch (e) {} return; }
    try { ws.close(1003, "notices only"); } catch (e) {}
  }
  async webSocketClose(ws) { try { ws.close(1000, "bye"); } catch (e) {} }
  async webSocketError(ws) { await this.webSocketClose(ws); }

  // The idle deadline: deletes the box when no member asked for
  // anything for idleMs.
  async alarm() {
    const now = Date.now(), m = this.meta();
    if (!m) { await this.wipe(); return; }
    if (now - (m.last || 0) >= HOUSE_LIMITS.idleMs) { await this.wipe(); return; }
    await this.state.storage.setAlarm((m.last || now) + HOUSE_LIMITS.idleMs);
  }
}
