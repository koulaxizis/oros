// Household boxes on the relay (relay/house.js through relay/core.js):
// routes, tokens, revisions (412), invites and join requests, key
// rotation, limits, notices and the idle deadline. The Durable Object's
// SQLite storage and its WebSockets are stand-ins.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
let handle, H;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  H = await import("../relay/house.js");
  await require("./house-fake.js").load();
});

const ORIGIN = "https://useoros.online";
const BOX = "HoUsEbOx0123456789_-ab";
const tok = (c) => c.repeat(43);
const W = tok("W"), A = tok("A"), I = tok("I"), W2 = tok("V");
const hex = (s) => crypto.createHash("sha256").update(s).digest("hex");

const { fakeSocket, world } = require("./house-fake.js");

let ipn = 0;
function call(w, method, path, opts) {
  opts = opts || {};
  const h = Object.assign({ Origin: ORIGIN, "CF-Connecting-IP": opts.ip || "10.0.0." + (++ipn % 250) }, opts.headers || {});
  if (opts.w) h.Authorization = "Bearer " + opts.w;
  if (opts.inv) h.Authorization = "Invite " + opts.inv;
  if (opts.a) h["X-HH-Admin"] = opts.a;
  if (opts.rev !== undefined) h["If-Match"] = '"' + opts.rev + '"';
  let body = opts.body;
  if (opts.json) { body = JSON.stringify(opts.json); h["Content-Type"] = "application/json"; }
  return handle(new Request("https://relay.example" + path, { method, headers: h, body }), w.env, null, opts.now || 1e12);
}
async function newBox(w) {
  const r = await call(w, "POST", "/h/" + BOX, { json: { act: "new", wh: hex(W), ah: hex(A) } });
  assert.equal(r.status, 200);
  return r;
}
const bytes = (n, v) => new Uint8Array(n).fill(v || 7);

test("routes: unknown paths, origin, OPTIONS and CORS", async () => {
  const w = world();
  assert.equal((await call(w, "GET", "/h/short")).status, 404);
  assert.equal((await call(w, "PATCH", "/h/" + BOX)).status, 404);
  assert.equal((await call(w, "GET", "/h/" + BOX + "/d/bad.key", { w: W })).status, 404);
  const pre = await handle(new Request("https://relay.example/h/" + BOX, { method: "OPTIONS", headers: { Origin: ORIGIN } }), w.env);
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get("Access-Control-Allow-Headers"), /If-Match/);
  const bad = await handle(new Request("https://relay.example/h/" + BOX, { method: "GET", headers: { Origin: "https://evil.example", Authorization: "Bearer " + W } }), w.env);
  assert.equal(bad.status, 403);
  const nob = await call({ env: { ALLOWED_ORIGINS: ORIGIN } }, "GET", "/h/" + BOX, { w: W });
  assert.equal(nob.status, 503);
});

test("create once, then info needs the write token", async () => {
  const w = world();
  await newBox(w);
  assert.equal((await call(w, "POST", "/h/" + BOX, { json: { act: "new", wh: hex(W), ah: hex(A) } })).status, 409);
  assert.equal((await call(w, "GET", "/h/" + BOX)).status, 404);
  assert.equal((await call(w, "GET", "/h/" + BOX, { w: W2 })).status, 404);
  const r = await call(w, "GET", "/h/" + BOX, { w: W });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  const j = await r.json();
  assert.deepEqual(j.data.revs, {});
  assert.equal(j.data.epoch, 1);
  assert.equal(w.boxes.get(BOX).st.alarm, 1e12 + H.HOUSE_LIMITS.idleMs);
  // a box that does not exist answers like a wrong token
  assert.equal((await call(w, "GET", "/h/AAAAAAAAAAAAAAAAAAAAAA", { w: W })).status, 404);
  assert.equal((await call(w, "POST", "/h/" + BOX, { json: { act: "new", wh: "nothex", ah: hex(A) } })).status, 400);
});

test("documents: If-Match revisions, 412 with the current one, delete", async () => {
  const w = world();
  await newBox(w);
  const p = "/h/" + BOX + "/d/m";
  assert.equal((await call(w, "PUT", p, { w: W, body: bytes(10) })).status, 428);
  let r = await call(w, "PUT", p, { w: W, rev: 0, body: bytes(10) });
  assert.deepEqual((await r.json()).data, { rev: 1 });
  r = await call(w, "PUT", p, { w: W, rev: 0, body: bytes(10) });
  assert.equal(r.status, 412);
  assert.equal((await r.json()).rev, 1);
  r = await call(w, "PUT", p, { w: W, rev: 1, body: bytes(12, 9) });
  assert.deepEqual((await r.json()).data, { rev: 2 });
  r = await call(w, "GET", p, { w: W });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("X-Rev"), "2");
  assert.equal(r.headers.get("Access-Control-Expose-Headers"), "X-Rev");
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), bytes(12, 9));
  const info = await (await call(w, "GET", "/h/" + BOX, { w: W })).json();
  assert.deepEqual(info.data.revs, { m: 2 });
  assert.equal(info.data.size, 12);
  assert.equal((await call(w, "DELETE", p, { w: W, rev: 1 })).status, 412);
  assert.equal((await call(w, "DELETE", p, { w: W, rev: 2 })).status, 200);
  assert.equal((await call(w, "GET", p, { w: W })).status, 404);
  assert.equal((await call(w, "PUT", p, { w: W, rev: 0, body: new Uint8Array(0) })).status, 400);
});

test("limits: document size, box size, document count, writes per minute", async () => {
  const w = world();
  await newBox(w);
  assert.equal((await call(w, "PUT", "/h/" + BOX + "/d/big", { w: W, rev: 0, body: bytes(H.HOUSE_LIMITS.docBytes + 1) })).status, 413);
  const fit = Math.floor(H.HOUSE_LIMITS.boxBytes / H.HOUSE_LIMITS.docBytes);
  for (let i = 0; i <= fit; i++) {
    const r = await call(w, "PUT", "/h/" + BOX + "/d/k" + i, { w: W, rev: 0, body: bytes(H.HOUSE_LIMITS.docBytes) });
    assert.equal(r.status, i < fit ? 200 : 413);
  }
  const w2 = world();
  await newBox(w2);
  let last;
  for (let i = 0; i <= H.HOUSE_LIMITS.docs; i++) last = await call(w2, "PUT", "/h/" + BOX + "/d/n" + i, { w: W, rev: 0, body: bytes(1) });
  assert.equal(last.status, 413);
  const w3 = world();
  await newBox(w3);
  let st;
  for (let i = 0; i <= H.HOUSE_LIMITS.writesPerMin; i++) st = (await call(w3, "PUT", "/h/" + BOX + "/d/a", { w: W, rev: i, body: bytes(1) })).status;
  assert.equal(st, 429);
});

test("invites and join requests: accept, refuse, answers only with the invite", async () => {
  const w = world();
  await newBox(w);
  const now = 1e12;
  assert.equal((await call(w, "POST", "/h/" + BOX + "/i", { w: W, json: { ih: hex(I), exp: now + H.HOUSE_LIMITS.inviteMaxMs * 2, n: 1 } })).status, 400);
  assert.equal((await call(w, "POST", "/h/" + BOX + "/i", { w: W, json: { ih: hex(I), exp: now + 86400000, n: 2 } })).status, 200);
  assert.equal((await call(w, "POST", "/h/" + BOX + "/j", { inv: tok("X"), body: bytes(50) })).status, 404);
  assert.equal((await call(w, "POST", "/h/" + BOX + "/j", { inv: I, body: bytes(H.HOUSE_LIMITS.reqBytes + 1) })).status, 413);
  const sock = fakeSocket(hex(W));
  w.boxes.get(BOX).socks.push(sock);
  const r1 = await (await call(w, "POST", "/h/" + BOX + "/j", { inv: I, body: bytes(50, 1) })).json();
  const r2 = await (await call(w, "POST", "/h/" + BOX + "/j", { inv: I, body: bytes(50, 2) })).json();
  assert.equal((await call(w, "POST", "/h/" + BOX + "/j", { inv: I, body: bytes(50, 3) })).status, 404);   // n used up
  assert.ok(sock.sent.includes('{"q":1}'));
  const info = await (await call(w, "GET", "/h/" + BOX, { w: W })).json();
  assert.deepEqual(info.data.reqs.sort(), [r1.data.rid, r2.data.rid].sort());
  const rq = await call(w, "GET", "/h/" + BOX + "/r/" + r1.data.rid, { w: W });
  assert.deepEqual(new Uint8Array(await rq.arrayBuffer()), bytes(50, 1));
  // waiting, then answered
  assert.equal((await call(w, "GET", "/h/" + BOX + "/a/" + r1.data.rid, { inv: I })).status, 202);
  assert.equal((await call(w, "GET", "/h/" + BOX + "/a/" + r1.data.rid, { inv: tok("X") })).status, 404);
  assert.equal((await call(w, "PUT", "/h/" + BOX + "/r/" + r1.data.rid, { w: W, body: bytes(40, 5) })).status, 200);
  const an = await call(w, "GET", "/h/" + BOX + "/a/" + r1.data.rid, { inv: I });
  assert.equal(an.status, 200);
  assert.deepEqual(new Uint8Array(await an.arrayBuffer()), bytes(40, 5));
  assert.equal((await call(w, "PUT", "/h/" + BOX + "/r/" + r1.data.rid, { w: W, body: bytes(40, 6) })).status, 404);   // once
  // refused: the request text is dropped
  assert.equal((await call(w, "DELETE", "/h/" + BOX + "/r/" + r2.data.rid, { w: W })).status, 200);
  assert.equal((await call(w, "GET", "/h/" + BOX + "/a/" + r2.data.rid, { inv: I })).status, 410);
  assert.equal(w.boxes.get(BOX).st.req.get(r2.data.rid).data.length, 1);
  // after seven days the request and its answer are gone
  const late = now + H.HOUSE_LIMITS.reqMs + 1;
  assert.equal((await call(w, "GET", "/h/" + BOX + "/a/" + r1.data.rid, { inv: I, now: late })).status, 404);
  // withdraw an invite
  assert.equal((await call(w, "POST", "/h/" + BOX + "/i", { w: W, json: { ih: hex(tok("J")), exp: now + 86400000, n: 5 } })).status, 200);
  assert.equal((await call(w, "DELETE", "/h/" + BOX + "/i/" + hex(tok("J")), { w: W })).status, 200);
  assert.equal((await call(w, "POST", "/h/" + BOX + "/j", { inv: tok("J"), body: bytes(5) })).status, 404);
});

test("pending requests and open invites are capped", async () => {
  const w = world();
  await newBox(w);
  for (let i = 0; i < H.HOUSE_LIMITS.invites; i++) {
    assert.equal((await call(w, "POST", "/h/" + BOX + "/i", { w: W, json: { ih: hex(tok(String.fromCharCode(97 + i))), exp: 1e12 + 86400000, n: 20 } })).status, 200);
  }
  assert.equal((await call(w, "POST", "/h/" + BOX + "/i", { w: W, json: { ih: hex(tok("z")), exp: 1e12 + 86400000, n: 20 } })).status, 429);
  let st;
  for (let i = 0; i <= H.HOUSE_LIMITS.pending; i++) st = (await call(w, "POST", "/h/" + BOX + "/j", { inv: tok("a"), body: bytes(5) })).status;
  assert.equal(st, 429);
});

test("rotation: new token, envelopes, past tokens read only their envelope", async () => {
  const w = world();
  await newBox(w);
  const env = { AbCdEfGhIjKlMnOpQrStUv: Buffer.from(bytes(30, 4)).toString("base64url") };
  const body = { epoch: 2, wh: hex(W2), env };
  assert.equal((await call(w, "POST", "/h/" + BOX + "/rot", { w: W, json: body })).status, 404);            // no admin
  assert.equal((await call(w, "POST", "/h/" + BOX + "/rot", { w: W, a: tok("B"), json: body })).status, 404);
  assert.equal((await call(w, "POST", "/h/" + BOX + "/rot", { w: W, a: A, json: Object.assign({}, body, { epoch: 3 }) })).status, 412);
  const old = fakeSocket(hex(W)), other = fakeSocket(hex(W2));
  w.boxes.get(BOX).socks.push(old, other);
  assert.equal((await call(w, "POST", "/h/" + BOX + "/rot", { w: W, a: A, json: body })).status, 200);
  assert.equal(old.closed, 4001);
  assert.equal(other.closed, null);
  assert.ok(other.sent.includes('{"e":2}'));
  const moved = await (await call(w, "GET", "/h/" + BOX, { w: W })).json();
  assert.deepEqual(moved.data, { moved: true, epoch: 2 });
  assert.equal((await call(w, "GET", "/h/" + BOX + "/d/m", { w: W })).status, 404);
  const e = await call(w, "GET", "/h/" + BOX + "/e/AbCdEfGhIjKlMnOpQrStUv", { w: W });
  assert.equal(e.status, 200);
  assert.deepEqual(new Uint8Array(await e.arrayBuffer()), bytes(30, 4));
  assert.equal((await call(w, "GET", "/h/" + BOX + "/e/ZZZZZZZZZZZZZZZZZZZZZZ", { w: W })).status, 404);
  assert.equal((await call(w, "GET", "/h/" + BOX, { w: W2 })).status, 200);
  // one more envelope (a member made admin), then delete the household
  assert.equal((await call(w, "PUT", "/h/" + BOX + "/e/ZZZZZZZZZZZZZZZZZZZZZZ", { w: W2, a: A, body: bytes(20) })).status, 200);
  assert.equal((await call(w, "DELETE", "/h/" + BOX, { w: W2 })).status, 404);
  assert.equal((await call(w, "DELETE", "/h/" + BOX, { w: W2, a: A })).status, 200);
  assert.ok(other.sent.includes('{"x":1}'));
  assert.equal((await call(w, "GET", "/h/" + BOX, { w: W2 })).status, 404);
  assert.equal(H.validRot({ epoch: 2, wh: hex(W2), env: {} }), "env");
});

test("notices go to every open socket; the WebSocket route checks its token", async () => {
  const w = world();
  await newBox(w);
  const s = fakeSocket(hex(W));
  w.boxes.get(BOX).socks.push(s);
  await call(w, "PUT", "/h/" + BOX + "/d/x", { w: W, rev: 0, body: bytes(3) });
  assert.deepEqual(JSON.parse(s.sent[0]), { k: "x", r: 1 });
  const ws = (protos) => handle(new Request("https://relay.example/h/" + BOX + "/ws", {
    headers: { Origin: ORIGIN, Upgrade: "websocket", "Sec-WebSocket-Protocol": protos } }), w.env, null, 1e12);
  assert.equal((await ws("hh1")).status, 400);
  assert.equal((await ws("hh1, w." + W2)).status, 404);
  const noUp = await call(w, "GET", "/h/" + BOX + "/ws", { w: W });
  assert.equal(noUp.status, 426);
});

test("idle deadline: the alarm deletes a box nobody used for 180 days", async () => {
  const w = world();
  await newBox(w);
  const b = w.boxes.get(BOX);
  const realNow = Date.now;
  try {
    Date.now = () => 1e12 + 10;
    await b.box.alarm();
    assert.equal(b.st.wiped, 0);
    assert.equal(b.st.alarm, 1e12 + H.HOUSE_LIMITS.idleMs);
    Date.now = () => 1e12 + H.HOUSE_LIMITS.idleMs;
    await b.box.alarm();
    assert.equal(b.st.wiped, 1);
  } finally { Date.now = realNow; }
  // a member request moves the deadline (at most every touchMs)
  const w2 = world();
  await newBox(w2);
  const later = 1e12 + H.HOUSE_LIMITS.touchMs + 1;
  await call(w2, "GET", "/h/" + BOX, { w: W, now: later });
  assert.equal(w2.boxes.get(BOX).st.alarm, later + H.HOUSE_LIMITS.idleMs);
});

test("new boxes per IP per day are limited", async () => {
  const w = world();
  let st;
  for (let i = 0; i <= H.HOUSE_LIMITS.newPerIpDay; i++) {
    const id = ("Bx" + i).padEnd(22, "q");
    st = (await call(w, "POST", "/h/" + id, { ip: "9.9.9.9", now: 2e12, json: { act: "new", wh: hex(W), ah: hex(A) } })).status;
  }
  assert.equal(st, 429);
});
