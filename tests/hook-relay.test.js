// Incoming webhooks for Automations (relay/hook.js through relay/core.js,
// device side automations/hookin.js): the URL secret and read token,
// expiry, the 4 KB and queue caps, rate limits, pull/ack, and that what
// arrives is stored only encrypted to the device's key.
// The Durable Object's SQLite storage is a stand-in.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../automations/hookin.js");
let handle, K;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  K = await import("../relay/hook.js");
});

const ORIGIN = "https://useoros.online";
const b64u = (u) => Buffer.from(u).toString("base64url");

function fakeStorage() {
  const st = { meta: new Map(), items: new Map(), seq: 0, alarm: null, wiped: 0, tables: new Set(), writes: 0 };
  const res = (a) => ({ toArray: () => a });
  st.sql = {
    exec(q, ...v) {
      if (q.startsWith("SELECT name FROM sqlite_master")) return res(st.tables.has("meta") ? [{ name: "meta" }] : []);
      st.writes += /^(CREATE|INSERT|DELETE)/.test(q) ? 1 : 0;
      if (q.startsWith("CREATE")) { st.tables.add(/TABLE IF NOT EXISTS (\w+)/.exec(q)[1]); return res([]); }
      const tb = /(?:FROM|INTO) (\w+)/.exec(q);
      if (tb && !st.tables.has(tb[1])) throw new Error("no such table: " + tb[1]);
      if (q.startsWith("SELECT v FROM meta")) return res(st.meta.has("box") ? [{ v: st.meta.get("box") }] : []);
      if (q.startsWith("INSERT OR REPLACE INTO meta")) { st.meta.set("box", v[0]); return res([]); }
      if (q === "DELETE FROM items") { st.items.clear(); return res([]); }
      if (q.startsWith("INSERT INTO items")) { const i = ++st.seq; st.items.set(i, { i, at: v[0], ct: v[1] }); return res([]); }
      if (q.startsWith("SELECT COUNT")) { let b = 0; st.items.forEach((x) => { b += x.ct.length; }); return res([{ n: st.items.size, b }]); }
      if (q.startsWith("SELECT i, at, ct")) return res(Array.from(st.items.values()).sort((a, b) => a.i - b.i).slice(0, v[0]).map((x) => Object.assign({}, x)));
      if (q.startsWith("DELETE FROM items WHERE")) { st.items.delete(v[0]); return res([]); }
      throw new Error("unknown SQL " + q);
    }
  };
  st.storage = {
    sql: st.sql,
    setAlarm(t) { st.alarm = t; st.writes++; },
    deleteAlarm() { st.alarm = null; },
    deleteAll() { st.meta.clear(); st.items.clear(); st.tables.clear(); st.seq = 0; st.wiped++; },
    transactionSync(fn) { return fn(); }
  };
  return st;
}
function world() {
  const boxes = new Map(), env = { ALLOWED_ORIGINS: ORIGIN };
  env.HOOK = {
    idFromName: (n) => n,
    get(id) {
      if (!boxes.has(id)) { const st = fakeStorage(); boxes.set(id, { st, box: new K.HookBox({ storage: st.storage }, env) }); }
      const b = boxes.get(id);
      return { fetch: (u, o) => b.box.fetch(new Request(u, o)) };
    }
  };
  return { env, boxes };
}
async function device() {
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const d = { id: b64u(crypto.getRandomValues(new Uint8Array(16))), tok: b64u(crypto.getRandomValues(new Uint8Array(32))),
              sec: b64u(crypto.getRandomValues(new Uint8Array(32))), kp, pub, auth };
  d.wh = await D.sha256hex(d.sec);
  return d;
}
let ipN = 0;
function op(w, body, now) {
  return handle(new Request("https://relay/v1", { method: "POST", headers: { Origin: ORIGIN, "CF-Connecting-IP": "10.0.0." + (++ipN % 250) },
    body: JSON.stringify(Object.assign({ op: "hook" }, body)) }), w.env, null, now).then(async (r) => ({ status: r.status, j: await r.json() }));
}
function post(w, d, body, now, opts) {
  opts = opts || {};
  const url = "https://relay/wh/" + d.id + "." + (opts.sec || d.sec);
  return handle(new Request(url, { method: opts.method || "POST", headers: { "CF-Connecting-IP": opts.ip || "192.0.2." + (++ipN % 250) },
    body: opts.method === "GET" ? undefined : (typeof body === "string" ? body : JSON.stringify(body)) }), w.env, null, now);
}
async function start(w, d, now) {
  return op(w, { act: "new", id: d.id, tok: d.tok, wh: d.wh, key: b64u(d.pub), auth: b64u(d.auth) }, now);
}

test("a posted JSON is stored only encrypted, the device decrypts it, ack removes it", async () => {
  const w = world(), d = await device(), T = 1.8e12;
  assert.equal((await start(w, d, T)).status, 200);
  const r = await post(w, d, { text: "Πόρτα ανοιχτή", n: 3 }, T + 1);
  assert.equal(r.status, 202);
  assert.equal(await r.text(), "");
  assert.equal(r.headers.get("Cache-Control"), "no-store");
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), null);
  const st = w.boxes.get(d.id).st;
  const stored = JSON.stringify([...st.meta.values(), ...[...st.items.values()].map((x) => x.ct)]);
  assert.ok(!/Πόρτα|ανοιχτή/.test(stored) && !stored.includes(d.sec) && !stored.includes(d.tok), "no plain text, no secrets");
  const p = await op(w, { act: "pull", id: d.id, tok: d.tok }, T + 2);
  assert.equal(p.j.data.items.length, 1);
  const plain = await D.decrypt(p.j.data.items[0].ct, d.kp.privateKey, d.pub, d.auth);
  assert.deepEqual(JSON.parse(plain), { text: "Πόρτα ανοιχτή", n: 3 });
  assert.equal(D.textOf(JSON.parse(plain)), "Πόρτα ανοιχτή");
  // a lost pull loses nothing: still there until acked
  assert.equal((await op(w, { act: "pull", id: d.id, tok: d.tok }, T + 3)).j.data.items.length, 1);
  await op(w, { act: "ack", id: d.id, tok: d.tok, ids: [p.j.data.items[0].i] }, T + 4);
  assert.equal((await op(w, { act: "pull", id: d.id, tok: d.tok }, T + 5)).j.data.items.length, 0);
});

test("wrong address, wrong token, no box and expiry all look the same", async () => {
  const w = world(), d = await device(), T = 1.8e12;
  assert.equal((await post(w, d, { a: 1 }, T)).status, 404);                       // no box
  await start(w, d, T);
  assert.equal((await post(w, d, { a: 1 }, T, { sec: "x".repeat(43) })).status, 404);
  const bad = await op(w, { act: "pull", id: d.id, tok: "y".repeat(43) }, T);
  assert.equal(bad.status, 404);
  assert.equal(bad.j.error.code, "gone");
  const later = T + K.HOOK_LIMITS.lifeMs + 1;
  assert.equal((await post(w, d, { a: 1 }, later)).status, 404);
  assert.equal((await op(w, { act: "pull", id: d.id, tok: d.tok }, later)).j.error.code, "gone");
  // renew keeps it alive
  const d2 = await device();
  await start(w, d2, T);
  const rn = await op(w, { act: "renew", id: d2.id, tok: d2.tok }, T + 6 * 86400000);
  assert.equal(rn.j.data.exp, T + 6 * 86400000 + K.HOOK_LIMITS.lifeMs);
  assert.equal((await post(w, d2, { a: 1 }, T + 8 * 86400000)).status, 202);
});

test("only POST, only a JSON object, at most 4 KB", async () => {
  const w = world(), d = await device(), T = 1.8e12;
  await start(w, d, T);
  assert.equal((await post(w, d, null, T, { method: "GET" })).status, 405);
  assert.equal((await post(w, d, "[1,2]", T)).status, 400);
  assert.equal((await post(w, d, "not json", T)).status, 400);
  assert.equal((await post(w, d, { t: "x".repeat(5000) }, T)).status, 413);
  assert.equal((await post(w, d, { t: "x".repeat(4000) }, T)).status, 202);
  const r = await handle(new Request("https://relay/wh/short.x", { method: "POST", body: "{}" }), w.env, null, T);
  assert.equal(r.status, 404);
});

test("a full queue answers 429 and keeps every old item; a box is rate-limited", async () => {
  const w = world(), d = await device();
  let T = 1.8e12;
  await start(w, d, T);
  for (let i = 0; i < K.HOOK_LIMITS.queueItems; i++) {
    if (i % K.HOOK_LIMITS.boxPerMin === 0) T += 61000;
    assert.equal((await post(w, d, { i }, T)).status, 202, "item " + i);
  }
  T += 61000;
  assert.equal((await post(w, d, { i: "one more" }, T)).status, 429);
  assert.equal(w.boxes.get(d.id).st.items.size, K.HOOK_LIMITS.queueItems);
  const d2 = await device();
  await start(w, d2, T);
  for (let i = 0; i < K.HOOK_LIMITS.boxPerMin; i++) assert.equal((await post(w, d2, { i }, T)).status, 202);
  assert.equal((await post(w, d2, { i: "x" }, T)).status, 429);
  assert.equal((await post(w, d2, { i: "x" }, T + 61000)).status, 202);
});

test("a sender IP is rate-limited on its own", async () => {
  const w = world(), d = await device(), T = 1.9e12;
  await start(w, d, T);
  let last;
  for (let i = 0; i <= K.HOOK_LIMITS.ipPerMin; i++) last = await post(w, d, { i }, T, { ip: "198.51.100.7" });
  assert.equal(last.status, 429);
});

test("rot gives a new address and wipes the queue; del forgets the box", async () => {
  const w = world(), d = await device(), T = 1.8e12;
  await start(w, d, T);
  await post(w, d, { a: 1 }, T);
  const sec2 = b64u(crypto.getRandomValues(new Uint8Array(32)));
  assert.equal((await op(w, { act: "rot", id: d.id, tok: d.tok, wh: await D.sha256hex(sec2) }, T)).status, 200);
  assert.equal(w.boxes.get(d.id).st.items.size, 0);
  assert.equal((await post(w, d, { a: 1 }, T)).status, 404);
  assert.equal((await post(w, d, { a: 1 }, T, { sec: sec2 })).status, 202);
  assert.equal((await op(w, { act: "del", id: d.id, tok: d.tok }, T)).status, 200);
  assert.equal((await post(w, d, { a: 1 }, T, { sec: sec2 })).status, 404);
});

test("the op is checked before the box sees it, and no answer carries a secret", async () => {
  const w = world(), d = await device(), T = 1.8e12;
  assert.equal((await op(w, { act: "pull", id: "short", tok: d.tok }, T)).status, 400);
  assert.equal((await op(w, { act: "new", id: d.id, tok: d.tok, wh: "nothex", key: b64u(d.pub), auth: b64u(d.auth) }, T)).status, 400);
  assert.equal((await op(w, { act: "ack", id: d.id, tok: d.tok, ids: [] }, T)).status, 400);
  const s = await start(w, d, T);
  assert.ok(!JSON.stringify(s.j).includes(d.tok) && !JSON.stringify(s.j).includes(d.wh));
  const none = await op({ env: { ALLOWED_ORIGINS: ORIGIN } }, { act: "pull", id: d.id, tok: d.tok }, T);
  assert.equal(none.status, 503);
  assert.equal(none.j.error.code, "nohook");
});

test("an unknown or expired box writes nothing: in, pull, renew, ack, rot, del, alarm", async () => {
  const w = world(), d = await device(), now = Date.UTC(2026, 10, 5, 12);
  assert.equal((await post(w, d, { text: "x" }, now)).status, 404);
  for (const act of ["pull", "renew", "ack", "rot", "del"]) {
    const r = await op(w, { act, id: d.id, tok: d.tok, wh: d.wh, ids: [1] }, now);
    assert.equal(r.j.error && r.j.error.code, "gone", act);
  }
  const b = w.boxes.get(d.id);
  await b.box.alarm();
  assert.equal(b.st.writes, 0);
  assert.equal(b.st.tables.size, 0);
  assert.equal(b.st.alarm, null);
  // A real box made and then deleted leaves no schema behind.
  assert.equal((await start(w, d, now)).j.ok, true);
  assert.ok(b.st.tables.has("meta"));
  assert.equal((await op(w, { act: "del", id: d.id, tok: d.tok }, now)).j.ok, true);
  assert.equal(b.st.tables.size, 0);
  const n = b.st.writes;
  assert.equal((await post(w, d, { text: "x" }, now)).status, 404);
  assert.equal((await op(w, { act: "pull", id: d.id, tok: d.tok }, now)).j.error.code, "gone");
  assert.equal(b.st.writes, n);
  // An expired box is wiped once and then stays empty.
  const e = await device();
  assert.equal((await start(w, e, now)).j.ok, true);
  const late = now + K.HOOK_LIMITS.lifeMs + 1;
  assert.equal((await post(w, e, { text: "x" }, late)).status, 404);
  const eb = w.boxes.get(e.id);
  assert.equal(eb.st.tables.size, 0);
});
