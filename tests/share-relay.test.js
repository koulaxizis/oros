// Send to someone links with an expiry, relay side: op "shr" and the
// pieces under /s/<id>/<i> (relay/share.js through relay/core.js),
// against an in-memory D1 that knows exactly the statements in SHR_SQL.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
let handle, S, worker;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  S = await import("../relay/share.js");
});

const ORIGIN = "https://useoros.online";
const DAY = 86400000;
const T0 = Date.UTC(2026, 9, 17, 10, 0, 0);

function fakeD1() {
  const objs = new Map(), chunks = new Map();     // chunks: "id|i" → {id,i,len,data}
  const log = [];
  function chunksOf(id) { return [...chunks.values()].filter((c) => c.id === id); }
  function exec(sql, a) {
    const Q = S.SHR_SQL;
    log.push(sql);
    switch (sql) {
      case Q.obj: case Q.chunk: case Q.indexExp: case Q.indexOpen: return { meta: {} };
      case Q.getObj: { const o = objs.get(a[0]); return { first: o ? { ...o } : null }; }
      case Q.used: return { first: { s: [...objs.values()].reduce((x, o) => x + o.size, 0) } };
      case Q.addObj:
        if (objs.has(a[0])) return { meta: { changes: 0 } };
        objs.set(a[0], { exp: a[1], size: a[2], n: a[3], delh: a[4], tokh: a[5], at: a[6], fin: 0 });
        return { meta: { changes: 1 } };
      case Q.got: { const cs = chunksOf(a[0]); return { first: { c: cs.length, s: cs.reduce((x, c) => x + c.len, 0) } }; }
      case Q.addChunk: {
        const k = a[0] + "|" + a[1];
        if (chunks.has(k)) return { meta: { changes: 0 } };
        assert.ok(a[3] instanceof ArrayBuffer, "pieces are stored as BLOB");
        chunks.set(k, { id: a[0], i: a[1], len: a[2], data: a[3] });
        return { meta: { changes: 1 } };
      }
      case Q.dropChunk: chunks.delete(a[0] + "|" + a[1]); return { meta: {} };
      case Q.fin: { const o = objs.get(a[0]); if (o && !o.fin) { o.fin = 1; return { meta: { changes: 1 } }; } return { meta: { changes: 0 } }; }
      case Q.read: {
        const o = objs.get(a[0]), c = chunks.get(a[0] + "|" + a[1]);
        return { first: o && c && o.fin === 1 && o.exp > a[2] ? { data: Array.from(new Uint8Array(c.data)) } : null };
      }
      case Q.dropChunks: for (const c of chunksOf(a[0])) chunks.delete(c.id + "|" + c.i); return { meta: {} };
      case Q.dropObj: objs.delete(a[0]); return { meta: {} };
      case Q.stale: return { all: [...objs.entries()].filter(([, o]) => o.exp <= a[0] || (o.fin === 0 && o.at < a[1])).slice(0, a[2]).map(([id]) => ({ id })) };
    }
    throw new Error("unknown SQL " + sql);
  }
  function stmt(sql, args) {
    return { bind: (...b) => stmt(sql, b), first: async () => exec(sql, args || []).first,
             all: async () => ({ results: exec(sql, args || []).all }), run: async () => exec(sql, args || []),
             _run: () => exec(sql, args || []) };
  }
  return { objs, chunks, log, prepare: (sql) => stmt(sql), batch: async (ss) => ss.map((s) => s._run()) };
}

let ipN = 0;
function nextIp() { return "10.9." + (ipN >> 8 & 255) + "." + (ipN++ & 255); }
const b64u = (u) => Buffer.from(u).toString("base64url");
const rnd = (n) => {                     // getRandomValues fills at most 64 KiB a call
  const u = new Uint8Array(n);
  for (let o = 0; o < n; o += 65536) crypto.getRandomValues(u.subarray(o, Math.min(n, o + 65536)));
  return u;
};
const newId = () => b64u(rnd(16));
const hex = async (s) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))).toString("hex");

async function op(env, body, now, ip) {
  const r = new Request("https://relay.example/v1", { method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": ip || nextIp() },
    body: JSON.stringify(Object.assign({ op: "shr" }, body)) });
  const res = await handle(r, env, null, now || T0);
  return { status: res.status, body: await res.json() };
}
async function piece(env, method, id, i, opts) {
  opts = opts || {};
  const h = { "CF-Connecting-IP": opts.ip || nextIp() };
  if (opts.origin !== null) h.Origin = opts.origin || ORIGIN;
  if (opts.tok) h.Authorization = "Bearer " + opts.tok;
  const init = { method, headers: h };
  if (opts.body) init.body = opts.body;
  const res = await handle(new Request("https://relay.example/s/" + id + "/" + i, init), env, null, opts.now || T0);
  return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()), headers: res.headers };
}
// A whole item: new → every piece → fin.
async function upload(env, parts, o) {
  o = o || {};
  const id = o.id || newId(), del = b64u(rnd(32));
  const size = parts.reduce((x, p) => x + p.length, 0);
  const n = await op(env, { act: "new", id, delh: await hex(del), exp: o.exp || T0 + 7 * DAY, n: parts.length, size }, o.now);
  assert.equal(n.status, 200, JSON.stringify(n.body));
  const tok = n.body.data.tok;
  for (let i = 0; i < parts.length; i++) {
    const p = await piece(env, "PUT", id, i, { tok, body: parts[i], now: o.now });
    assert.equal(p.status, 200);
  }
  const f = await op(env, { act: "fin", id, tok }, o.now);
  assert.equal(f.status, 200, JSON.stringify(f.body));
  return { id, del, tok };
}

test("an item goes up in pieces and comes back byte for byte", async () => {
  const D = fakeD1(), env = { SHR_DB: D };
  const parts = [rnd(1000), rnd(262144), rnd(17)];
  const { id } = await upload(env, parts);
  for (let i = 0; i < parts.length; i++) {
    const g = await piece(env, "GET", id, i);
    assert.equal(g.status, 200);
    assert.deepEqual(g.bytes, parts[i]);
  }
  // only hashes of the secrets are stored
  const o = D.objs.get(id);
  assert.match(o.tokh, /^[0-9a-f]{64}$/);
  assert.match(o.delh, /^[0-9a-f]{64}$/);
  assert.equal(Object.keys(o).sort().join(","), "at,delh,exp,fin,n,size,tokh");
});

test("GET headers: attachment, sandbox, nosniff, no-store; CORS only for orOS", async () => {
  const env = { SHR_DB: fakeD1() };
  const { id } = await upload(env, [rnd(10)]);
  const g = await piece(env, "GET", id, 0);
  assert.equal(g.headers.get("Content-Type"), "application/octet-stream");
  assert.equal(g.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(g.headers.get("Content-Disposition"), "attachment");
  assert.equal(g.headers.get("Content-Security-Policy"), "sandbox");
  assert.equal(g.headers.get("Cache-Control"), "no-store");
  assert.equal(g.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  const other = await piece(env, "GET", id, 0, { origin: "https://evil.example" });
  assert.equal(other.headers.get("Access-Control-Allow-Origin"), null);
  const pre = await handle(new Request("https://relay.example/s/" + id + "/0", { method: "OPTIONS", headers: { Origin: ORIGIN } }), env, null, T0);
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get("Access-Control-Allow-Headers"), /Authorization/);
  const preBad = await handle(new Request("https://relay.example/s/" + id + "/0", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), env, null, T0);
  assert.equal(preBad.status, 403);
});

test("one 404 for missing, unfinished, expired and revoked", async () => {
  const env = { SHR_DB: fakeD1() };
  const missing = await piece(env, "GET", newId(), 0);
  // unfinished
  const id = newId(), del = b64u(rnd(32));
  const n = await op(env, { act: "new", id, delh: await hex(del), exp: T0 + DAY, n: 1, size: 5 });
  await piece(env, "PUT", id, 0, { tok: n.body.data.tok, body: rnd(5) });
  const unfinished = await piece(env, "GET", id, 0);
  // expired
  const a = await upload(env, [rnd(5)], { exp: T0 + DAY });
  const expired = await piece(env, "GET", a.id, 0, { now: T0 + DAY });
  // revoked
  const b = await upload(env, [rnd(5)]);
  const r = await op(env, { act: "del", id: b.id, del: b.del });
  assert.deepEqual(r.body, { ok: true, data: { ok: true } });
  const revoked = await piece(env, "GET", b.id, 0);
  for (const x of [missing, unfinished, expired, revoked]) {
    assert.equal(x.status, 404);
    assert.equal(new TextDecoder().decode(x.bytes), "not found");
  }
  assert.equal(env.SHR_DB.objs.has(b.id), false);
  assert.equal([...env.SHR_DB.chunks.values()].some((c) => c.id === b.id), false);
});

test("revoke: wrong secret changes nothing and answers the same", async () => {
  const env = { SHR_DB: fakeD1() };
  const a = await upload(env, [rnd(5)]);
  const wrong = await op(env, { act: "del", id: a.id, del: b64u(rnd(32)) });
  const none = await op(env, { act: "del", id: newId(), del: b64u(rnd(32)) });
  assert.deepEqual(wrong.body, none.body);
  assert.equal((await piece(env, "GET", a.id, 0)).status, 200);
  // the upload token is not the revoke secret
  const byTok = await op(env, { act: "del", id: a.id, del: a.tok });
  assert.equal(byTok.status, 200);
  assert.equal((await piece(env, "GET", a.id, 0)).status, 200);
});

test("PUT: token, origin, range, double piece, size", async () => {
  const env = { SHR_DB: fakeD1() };
  const id = newId();
  const n = await op(env, { act: "new", id, delh: "a".repeat(64), exp: T0 + DAY, n: 2, size: 10 });
  const tok = n.body.data.tok;
  assert.equal((await piece(env, "PUT", id, 0, { tok: b64u(rnd(32)), body: rnd(5) })).status, 403);
  assert.equal((await piece(env, "PUT", id, 0, { body: rnd(5) })).status, 403);
  assert.equal((await piece(env, "PUT", id, 0, { tok, body: rnd(5), origin: "https://evil.example" })).status, 403);
  assert.equal((await piece(env, "PUT", id, 0, { tok, body: rnd(5), origin: null })).status, 403);
  assert.equal((await piece(env, "PUT", id, 2, { tok, body: rnd(5) })).status, 400);
  assert.equal((await piece(env, "PUT", id, 0, { tok, body: new Uint8Array(0) })).status, 400);
  assert.equal((await piece(env, "PUT", id, 0, { tok, body: rnd(11) })).status, 413);
  assert.equal((await piece(env, "PUT", id, 0, { tok, body: rnd(6) })).status, 200);
  assert.equal((await piece(env, "PUT", id, 0, { tok, body: rnd(4) })).status, 409);
  assert.equal((await piece(env, "PUT", id, 1, { tok, body: rnd(5) })).status, 413);   // 6 + 5 > 10
  assert.equal((await piece(env, "PUT", id, 1, { tok, body: rnd(4) })).status, 200);
  // a piece over the cap never reaches storage
  const big = await piece(env, "PUT", newId(), 0, { tok, body: rnd(S.SHR_LIMITS.chunk + 1) });
  assert.equal(big.status, 404);           // unknown id is checked first
  const id2 = newId();
  const n2 = await op(env, { act: "new", id: id2, delh: "b".repeat(64), exp: T0 + DAY, n: 2, size: 2 * S.SHR_LIMITS.chunk });
  assert.equal((await piece(env, "PUT", id2, 0, { tok: n2.body.data.tok, body: rnd(S.SHR_LIMITS.chunk + 1) })).status, 413);
  // the token in the URL is never accepted
  const q = await handle(new Request("https://relay.example/s/" + id + "/1?tok=" + tok, { method: "PUT", headers: { Origin: ORIGIN }, body: rnd(1) }), env, null, T0);
  assert.equal(q.status, 403);
});

test("fin: needs every piece and the exact size; GET before fin is 404", async () => {
  const env = { SHR_DB: fakeD1() };
  const id = newId();
  const n = await op(env, { act: "new", id, delh: "c".repeat(64), exp: T0 + DAY, n: 2, size: 8 });
  const tok = n.body.data.tok;
  await piece(env, "PUT", id, 0, { tok, body: rnd(4) });
  let f = await op(env, { act: "fin", id, tok });
  assert.equal(f.status, 409);
  assert.equal(f.body.error.code, "incomplete");
  await piece(env, "PUT", id, 1, { tok, body: rnd(3) });
  f = await op(env, { act: "fin", id, tok });
  assert.equal(f.body.error.code, "incomplete");                 // 7 of 8 bytes
  assert.equal((await piece(env, "GET", id, 0)).status, 404);
  f = await op(env, { act: "fin", id, tok: b64u(rnd(32)) });
  assert.equal(f.status, 403);
  // after fin no more pieces and no second fin
  const id2 = newId();
  const n2 = await op(env, { act: "new", id: id2, delh: "d".repeat(64), exp: T0 + DAY, n: 1, size: 3 });
  await piece(env, "PUT", id2, 0, { tok: n2.body.data.tok, body: rnd(3) });
  f = await op(env, { act: "fin", id: id2, tok: n2.body.data.tok });
  assert.deepEqual(f.body, { ok: true, data: { exp: T0 + DAY } });
  assert.equal((await op(env, { act: "fin", id: id2, tok: n2.body.data.tok })).status, 404);
  // an upload left for more than an hour is gone
  const id3 = newId();
  const n3 = await op(env, { act: "new", id: id3, delh: "e".repeat(64), exp: T0 + DAY, n: 1, size: 3 });
  assert.equal((await piece(env, "PUT", id3, 0, { tok: n3.body.data.tok, body: rnd(3), now: T0 + 3600001 })).status, 404);
});

test("new: validation", async () => {
  const env = { SHR_DB: fakeD1() };
  const ok = { act: "new", id: newId(), delh: "f".repeat(64), exp: T0 + DAY, n: 1, size: 10 };
  const bad = [
    { id: "short" }, { id: "x".repeat(23) }, { id: "a/b".padEnd(22, "c") },
    { delh: "F".repeat(64) }, { delh: "f".repeat(63) },
    { n: 0 }, { n: 201 }, { n: 1.5 },
    { size: 0 }, { size: S.SHR_LIMITS.size + 1 }, { size: S.SHR_LIMITS.chunk + 1 },
    { exp: T0 }, { exp: T0 + 31 * DAY }, { exp: "soon" },
    { act: "put" }
  ];
  for (const b of bad) {
    const r = await op(env, Object.assign({}, ok, b));
    assert.equal(r.status, 400, JSON.stringify(b));
  }
  assert.equal((await op(env, { act: "fin", id: newId(), tok: "x" })).status, 400);
  assert.equal((await op(env, { act: "del", id: newId(), del: "x" })).status, 400);
  assert.equal((await op(env, ok)).status, 200);
  assert.equal((await op(env, ok)).status, 409);                   // the id is taken
  assert.equal((await op(env, Object.assign({}, ok, { id: newId(), exp: T0 + 30 * DAY }))).status, 200);
});

test("the global cap counts declared sizes at new", async () => {
  const env = { SHR_DB: fakeD1() };
  const size = S.SHR_LIMITS.size;
  const n = Math.ceil(size / S.SHR_LIMITS.chunk);
  let full = null;
  for (let k = 0; k < 20 && !full; k++) {
    const r = await op(env, { act: "new", id: newId(), delh: "a".repeat(64), exp: T0 + DAY, n, size });
    if (r.status !== 200) full = r;
  }
  assert.equal(full.status, 507);
  assert.equal(full.body.error.code, "full");
  assert.equal(env.SHR_DB.objs.size, Math.floor(S.SHR_LIMITS.store / size));
});

test("per-IP day limit on new", async () => {
  const env = { SHR_DB: fakeD1() };
  const ip = "10.99.0.1";
  for (let k = 0; k < S.SHR_LIMITS.perIpDay; k++) {
    assert.equal((await op(env, { act: "new", id: newId(), delh: "a".repeat(64), exp: T0 + DAY, n: 1, size: 1 }, T0 + k * 1000 + 61000 * k, ip)).status, 200);
  }
  const r = await op(env, { act: "new", id: newId(), delh: "a".repeat(64), exp: T0 + 2 * DAY, n: 1, size: 1 }, T0 + DAY / 2, ip);
  assert.equal(r.status, 429);
  assert.equal(r.body.error.code, "rate");
  const next = await op(env, { act: "new", id: newId(), delh: "a".repeat(64), exp: T0 + 3 * DAY, n: 1, size: 1 }, T0 + DAY + 1000, ip);
  assert.equal(next.status, 200);
});

test("pieces have their own per-minute limit, apart from /v1", async () => {
  const env = { SHR_DB: fakeD1() };
  const ip = "10.98.0.1";
  const id = newId();
  let last;
  for (let k = 0; k <= S.SHR_LIMITS.getPerMin; k++) last = await piece(env, "GET", id, 0, { ip });
  assert.equal(last.status, 429);
  // /v1 from the same IP is not affected
  const r = await op(env, { act: "del", id, del: b64u(rnd(32)) }, T0, ip);
  assert.equal(r.status, 200);
  // a new minute starts over
  assert.equal((await piece(env, "GET", id, 0, { ip, now: T0 + 60001 })).status, 404);
  // PUT counts apart from GET
  const ip2 = "10.98.0.2";
  for (let k = 0; k < S.SHR_LIMITS.putPerMin; k++) await piece(env, "PUT", id, 0, { ip: ip2, tok: b64u(rnd(32)), body: rnd(1) });
  assert.equal((await piece(env, "PUT", id, 0, { ip: ip2, tok: b64u(rnd(32)), body: rnd(1) })).status, 429);
  assert.equal((await piece(env, "GET", id, 0, { ip: ip2 })).status, 404);
});

test("purge deletes expired items and stale uploads, in batches", async () => {
  const D = fakeD1(), env = { SHR_DB: D };
  const keep = await upload(env, [rnd(3)], { exp: T0 + 10 * DAY });
  const olds = [];
  for (let k = 0; k < 120; k++) olds.push((await upload(env, [rnd(2)], { exp: T0 + DAY })).id);
  const stale = newId();
  await op(env, { act: "new", id: stale, delh: "a".repeat(64), exp: T0 + 10 * DAY, n: 1, size: 1 });
  const gone = await S.purgeShares(env, T0 + DAY);
  assert.equal(gone, 121);
  assert.deepEqual([...D.objs.keys()], [keep.id]);
  assert.equal(D.chunks.size, 1);
  // batches of purgeBatch
  const stales = D.log.filter((s) => s === S.SHR_SQL.stale).length;
  assert.ok(stales >= Math.ceil(121 / S.SHR_LIMITS.purgeBatch));
  // the cron entry calls it
  assert.equal(await S.purgeShares({}, T0), 0);                   // no database: no throw
});

test("no database: 503 nostore; a D1 failure: 503 with fixed text", async () => {
  const r = await op({}, { act: "new", id: newId(), delh: "a".repeat(64), exp: T0 + DAY, n: 1, size: 1 });
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, "nostore");
  const g = await piece({}, "GET", newId(), 0);
  assert.equal(g.status, 503);
  const D = fakeD1();
  const env = { SHR_DB: D };
  await op(env, { act: "del", id: newId(), del: b64u(rnd(32)) });    // schema made
  const prep = D.prepare;
  D.prepare = (sql) => {
    if (sql === S.SHR_SQL.getObj || sql === S.SHR_SQL.read) return { bind: () => ({ first: async () => { throw new Error("D1 secret detail"); } }) };
    return prep(sql);
  };
  const f = await op(env, { act: "del", id: newId(), del: b64u(rnd(32)) });
  assert.equal(f.status, 503);
  assert.equal(JSON.stringify(f.body).includes("secret detail"), false);
  const p = await piece(env, "GET", newId(), 0);
  assert.equal(p.status, 503);
  assert.equal(new TextDecoder().decode(p.bytes).includes("secret detail"), false);
  D.prepare = prep;
});

test("routing: other paths and methods under /s/", async () => {
  const env = { SHR_DB: fakeD1() };
  for (const path of ["/s/", "/s/abc/0", "/s/" + newId() + "/x", "/s/" + newId() + "/1234", "/s/" + newId() + "/0/x"]) {
    const r = await handle(new Request("https://relay.example" + path, { headers: { Origin: ORIGIN } }), env, null, T0);
    assert.equal(r.status, 404, path);
  }
  const del = await handle(new Request("https://relay.example/s/" + newId() + "/0", { method: "DELETE", headers: { Origin: ORIGIN } }), env, null, T0);
  assert.equal(del.status, 405);
});
