// Studio Remote's meeting rooms on the relay (relay/remote.js through
// relay/core.js): origin and route checks, two sockets per room, frames
// forwarded as is, limits and the idle close. Durable Object state,
// WebSocketPair and the 101 response are stand-ins.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
let handle, R;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  R = await import("../relay/remote.js");
});

const ORIGIN = "https://useoros.online";
const ROOM = "ab".repeat(32);

class FakeWS {
  constructor() { this.sent = []; this.closed = null; this.att = null; }
  send(m) { if (this.closed) throw new Error("closed"); this.sent.push(m); }
  close(code, why) { this.closed = { code, why }; }
  serializeAttachment(a) { this.att = JSON.parse(JSON.stringify(a)); }
  deserializeAttachment() { return this.att && JSON.parse(JSON.stringify(this.att)); }
}
function fakeState() {
  const socks = [];
  return {
    socks, alarm: 0,
    getWebSockets() { return socks.filter((s) => !s.closed); },
    acceptWebSocket(ws) { socks.push(ws); },
    storage: { setAlarm(t) { this._t = t; }, get t() { return this._t; } }
  };
}
// Node's Response refuses status 101; the Workers runtime needs it.
function withWorkerGlobals(fn) {
  const saved = { Pair: globalThis.WebSocketPair, Resp: globalThis.Response };
  globalThis.WebSocketPair = function () { const a = new FakeWS(), b = new FakeWS(); return { 0: a, 1: b }; };
  globalThis.Response = class { constructor(body, init) { this.body = body; this.status = init.status; this.webSocket = init.webSocket; } };
  return Promise.resolve().then(fn).finally(() => { globalThis.WebSocketPair = saved.Pair; globalThis.Response = saved.Resp; });
}
function upgrade(path, origin, extra) {
  const h = new Headers(Object.assign({ Upgrade: "websocket" }, origin ? { Origin: origin } : {}, extra || {}));
  return new Request("https://relay.example" + path, { method: "GET", headers: h });
}
const env = (ns) => ({ ALLOWED_ORIGINS: ORIGIN, REMOTE: ns });

test("route: only orOS, only a 64-hex room, only a WebSocket", async () => {
  let asked = null;
  const ns = { idFromName: (n) => "id:" + n, get: (id) => ({ fetch: () => { asked = id; return new Response("ok", { status: 200 }); } }) };
  assert.equal((await handle(upgrade("/rt/" + ROOM, "https://evil.example"), env(ns), null, Date.now())).status, 403);
  assert.equal((await handle(upgrade("/rt/" + ROOM.slice(2)), env(ns), null, Date.now())).status, 404);
  assert.equal((await handle(upgrade("/rt/" + ROOM.toUpperCase(), ORIGIN), env(ns), null, Date.now())).status, 404);
  const noUp = new Request("https://relay.example/rt/" + ROOM, { headers: { Origin: ORIGIN } });
  assert.equal((await handle(noUp, env(ns), null, Date.now())).status, 426);
  assert.equal((await handle(upgrade("/rt/" + ROOM, ORIGIN), { ALLOWED_ORIGINS: ORIGIN }, null, Date.now())).status, 503);
  const r = await handle(upgrade("/rt/" + ROOM, ORIGIN, { "CF-Connecting-IP": "203.0.113.9" }), env(ns), null, Date.now());
  assert.equal(r.status, 200);
  assert.equal(asked, "id:" + ROOM);
});

test("room: two sockets meet, frames go across as is, a third is refused", () => withWorkerGlobals(async () => {
  const st = fakeState(), room = new R.RemoteRoom(st, {});
  const r1 = await room.fetch(upgrade("/rt/" + ROOM, ORIGIN));
  assert.equal(r1.status, 101);
  const a = st.socks[0];
  assert.deepEqual(a.sent.map((m) => JSON.parse(m)), [{ sys: "wait" }]);
  await room.fetch(upgrade("/rt/" + ROOM, ORIGIN));
  const b = st.socks[1];
  assert.deepEqual(JSON.parse(a.sent[1]), { sys: "peer" });
  assert.deepEqual(JSON.parse(b.sent[0]), { sys: "peer" });
  assert.equal((await room.fetch(upgrade("/rt/" + ROOM, ORIGIN))).status, 409);
  await room.webSocketMessage(a, "Zm9vYmFy.ciphertext");
  assert.equal(b.sent[b.sent.length - 1], "Zm9vYmFy.ciphertext");
  assert.equal(a.sent.length, 2, "not echoed back");
  await room.webSocketMessage(b, new ArrayBuffer(4));
  assert.equal(b.closed.code, 1009, "binary frames close the socket");
  await room.webSocketClose(b);
  assert.deepEqual(JSON.parse(a.sent[a.sent.length - 1]), { sys: "left" });
  assert.ok(st.storage.t > Date.now(), "idle alarm armed");
}));

test("room: oversize frames, bursts and idle rooms are closed", () => withWorkerGlobals(async () => {
  const st = fakeState(), room = new R.RemoteRoom(st, {});
  await room.fetch(upgrade("/rt/" + ROOM, ORIGIN));
  await room.fetch(upgrade("/rt/" + ROOM, ORIGIN));
  const [a, b] = st.socks;
  await room.webSocketMessage(a, "x".repeat(R.REMOTE_LIMITS.frameBytes + 1));
  assert.equal(a.closed.code, 1009);
  for (let i = 0; i <= R.REMOTE_LIMITS.burst; i++) await room.webSocketMessage(b, "m" + i);
  assert.equal(b.closed.code, 1008);

  const st2 = fakeState(), room2 = new R.RemoteRoom(st2, {});
  await room2.fetch(upgrade("/rt/" + ROOM, ORIGIN));
  const c = st2.socks[0];
  await room2.alarm();
  assert.equal(c.closed, null, "fresh room stays");
  c.att.at = Date.now() - R.REMOTE_LIMITS.idleMs - 1;
  await room2.alarm();
  assert.equal(c.closed.code, 1001);
}));

test("worker exports the Durable Object class and wrangler binds it", async () => {
  const fs = require("fs"), path = require("path");
  const w = fs.readFileSync(path.join(__dirname, "../relay/worker.js"), "utf8");
  assert.match(w, /export \{ RemoteRoom \} from "\.\/remote\.js"/);
  const toml = fs.readFileSync(path.join(__dirname, "../relay/wrangler.toml"), "utf8");
  assert.match(toml, /\[\[durable_objects\.bindings\]\]\s*\nname = "REMOTE"\s*\nclass_name = "RemoteRoom"/);
  assert.match(toml, /new_sqlite_classes = \["RemoteRoom"\]/);
});
