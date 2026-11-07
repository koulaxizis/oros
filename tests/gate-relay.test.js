// orOS Gate on the relay (relay/gate.js through relay/core.js): OAuth
// metadata, registration, authorize redirect, the device's code, the
// token exchange with PKCE, refresh rotation, revoke, the MCP methods
// and a tool call passed to the device's socket and back. The Durable
// Object's storage and its WebSockets are stand-ins.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
let handle, G;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  G = await import("../relay/gate.js");
});

const ORIGIN = "https://useoros.online";
const BASE = "https://relay.example";
const ID = "GaTeBoX0123456789_-abc";
const TOK = "T".repeat(43);
const CB = "https://claude.ai/api/mcp/auth_callback";
const hex = (s) => crypto.createHash("sha256").update(s).digest("hex");
const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const VERIFIER = "v".repeat(50);
const CHALLENGE = b64u(crypto.createHash("sha256").update(VERIFIER).digest());

function fakeStorage() {
  const kv = new Map();
  const st = { kv, alarm: null };
  st.storage = {
    get: async (k) => (kv.has(k) ? JSON.parse(JSON.stringify(kv.get(k))) : undefined),
    put: async (k, v) => { kv.set(k, JSON.parse(JSON.stringify(v))); },
    delete: async (k) => { (Array.isArray(k) ? k : [k]).forEach((x) => kv.delete(x)); },
    list: async (o) => { const m = new Map(); kv.forEach((v, k) => { if (!o || !o.prefix || k.indexOf(o.prefix) === 0) m.set(k, v); }); return m; },
    setAlarm: async (t) => { st.alarm = t; },
    deleteAlarm: async () => { st.alarm = null; },
    deleteAll: async () => { kv.clear(); }
  };
  return st;
}
function world() {
  const boxes = new Map();
  const env = { ALLOWED_ORIGINS: ORIGIN };
  env.GATE = {
    idFromName: (n) => n,
    get(id) {
      if (!boxes.has(id)) {
        const st = fakeStorage(), socks = [];
        const state = { storage: st.storage, getWebSockets: () => socks.filter((s) => !s.closed) };
        boxes.set(id, { st, socks, box: new G.GateBox(state, env) });
      }
      const b = boxes.get(id);
      return { fetch: (r) => b.box.fetch(r) };
    }
  };
  return { env, boxes };
}
let ipn = 0;
function call(w, method, path, opts) {
  opts = opts || {};
  const h = Object.assign({ "CF-Connecting-IP": "10.1.0." + (++ipn % 250) }, opts.headers || {});
  if (opts.origin) h.Origin = opts.origin;
  if (opts.bearer) h.Authorization = "Bearer " + opts.bearer;
  let body = opts.body;
  if (opts.json) { body = JSON.stringify(opts.json); h["Content-Type"] = "application/json"; }
  if (opts.form) { body = new URLSearchParams(opts.form).toString(); h["Content-Type"] = "application/x-www-form-urlencoded"; }
  return handle(new Request(BASE + path, { method, headers: h, body, redirect: "manual" }), w.env, null, opts.now || 1e12);
}
const dev = (w, json, now) => call(w, "POST", "/gate/dev", { origin: ORIGIN, json: Object.assign({ id: ID }, json), now });
async function newGate(w) {
  const r = await dev(w, { act: "new", th: hex(TOK) });
  assert.equal(r.status, 200);
}
async function codeFor(w) {
  const r = await dev(w, { act: "code", tok: TOK, c: CHALLENGE, r: CB });
  assert.equal(r.status, 200);
  return ID + "." + (await r.json()).data.code;
}
async function tokens(w, now) {
  const code = await codeFor(w);
  const r = await call(w, "POST", "/gate/token", { form: { grant_type: "authorization_code", code, code_verifier: VERIFIER, redirect_uri: CB }, now });
  assert.equal(r.status, 200);
  return r.json();
}
const rpc = (w, bearer, body, now) => call(w, "POST", "/mcp", { bearer, json: body, now });

test("metadata: protected resource and authorization server", async () => {
  const w = world();
  const pr = await (await call(w, "GET", "/.well-known/oauth-protected-resource")).json();
  assert.equal(pr.resource, BASE + "/mcp");
  assert.deepEqual(pr.authorization_servers, [BASE]);
  const as = await (await call(w, "GET", "/.well-known/oauth-authorization-server")).json();
  assert.equal(as.token_endpoint, BASE + "/gate/token");
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
});

test("register: only Claude's callbacks, nothing stored", async () => {
  const w = world();
  const ok = await call(w, "POST", "/gate/register", { json: { redirect_uris: [CB], client_name: "Claude" } });
  assert.equal(ok.status, 201);
  assert.match((await ok.json()).client_id, /^oros-gate-/);
  const bad = await call(w, "POST", "/gate/register", { json: { redirect_uris: ["https://evil.example/cb"] } });
  assert.equal(bad.status, 400);
  assert.equal(w.boxes.size, 0);
});

test("authorize sends the browser to orOS with redirect, state and challenge", async () => {
  const w = world();
  const q = "?response_type=code&client_id=x&redirect_uri=" + encodeURIComponent(CB) + "&state=st1&code_challenge=" + CHALLENGE + "&code_challenge_method=S256";
  const r = await call(w, "GET", "/gate/authorize" + q);
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get("Location"));
  assert.equal(loc.origin, ORIGIN);
  const p = JSON.parse(Buffer.from(loc.searchParams.get("gate"), "base64url").toString());
  assert.deepEqual(p, { r: CB, s: "st1", c: CHALLENGE });
  const plain = await call(w, "GET", "/gate/authorize" + q.replace("S256", "plain"));
  assert.match(plain.headers.get("Location"), /^https:\/\/claude\.ai\/api\/mcp\/auth_callback\?error=invalid_request&state=st1$/);
  const evil = await call(w, "GET", "/gate/authorize" + q.replace(encodeURIComponent(CB), encodeURIComponent("https://evil.example/")));
  assert.equal(evil.status, 400);
});

test("device calls need an allowed origin and the device token", async () => {
  const w = world();
  assert.equal((await call(w, "POST", "/gate/dev", { json: { id: ID, act: "new", th: hex(TOK) } })).status, 403);
  await newGate(w);
  assert.equal((await dev(w, { act: "new", th: hex(TOK) })).status, 409);
  assert.equal((await dev(w, { act: "code", tok: "X".repeat(43), c: CHALLENGE, r: CB })).status, 404);
  assert.equal((await dev(w, { act: "code", tok: TOK, c: CHALLENGE, r: "https://evil.example/" })).status, 400);
  const info = await (await dev(w, { act: "info", tok: TOK })).json();
  assert.deepEqual(info.data, { links: 0, last: 0 });
});

test("token: code once, PKCE and redirect checked, refresh rotates", async () => {
  const w = world();
  await newGate(w);
  const code = await codeFor(w);
  const wrong = await call(w, "POST", "/gate/token", { form: { grant_type: "authorization_code", code, code_verifier: "w".repeat(50), redirect_uri: CB } });
  assert.equal(wrong.status, 400);
  // A failed try still used the code up.
  const again = await call(w, "POST", "/gate/token", { form: { grant_type: "authorization_code", code, code_verifier: VERIFIER, redirect_uri: CB } });
  assert.equal(again.status, 400);
  const t = await tokens(w);
  assert.equal(t.token_type, "Bearer");
  assert.match(t.access_token, new RegExp("^" + ID + "\\.[A-Za-z0-9_-]{43}$"));
  const r1 = await call(w, "POST", "/gate/token", { form: { grant_type: "refresh_token", refresh_token: t.refresh_token } });
  assert.equal(r1.status, 200);
  const r2 = await call(w, "POST", "/gate/token", { form: { grant_type: "refresh_token", refresh_token: t.refresh_token } });
  assert.equal(r2.status, 400);
  const info = await (await dev(w, { act: "info", tok: TOK })).json();
  assert.equal(info.data.links, 1);
  // Stored: hashes only, never a token.
  const kv = w.boxes.get(ID).st.kv;
  kv.forEach((v, k) => { assert.ok(k === "meta" || /^t:[0-9a-f]{64}$/.test(k)); });
  assert.ok(JSON.stringify(Array.from(kv)).indexOf(t.access_token.split(".")[1]) < 0);
});

test("mcp: 401 with resource metadata, then initialize and tools/list", async () => {
  const w = world();
  await newGate(w);
  const no = await rpc(w, null, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.equal(no.status, 401);
  assert.match(no.headers.get("WWW-Authenticate"), /resource_metadata="https:\/\/relay\.example\/\.well-known\/oauth-protected-resource"/);
  const t = await tokens(w);
  const init = await (await rpc(w, t.access_token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } })).json();
  assert.equal(init.result.protocolVersion, "2025-03-26");
  assert.equal(init.result.serverInfo.name, "orOS Gate");
  const note = await rpc(w, t.access_token, { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(note.status, 202);
  const list = await (await rpc(w, t.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
  assert.deepEqual(list.result.tools.map((x) => x.name), ["list_apps", "search_data", "app_summary", "budget_lines",
    "invoice_list", "stock_items", "publish_titles", "budget_add", "budget_change", "budget_delete"]);
  const ro = list.result.tools.filter((x) => x.annotations.readOnlyHint).map((x) => x.name);
  assert.equal(ro.length, 7, "only the three budget_* writers are not read-only");
  assert.equal(list.result.tools.find((x) => x.name === "budget_delete").annotations.destructiveHint, true);
  const unk = await (await rpc(w, t.access_token, { jsonrpc: "2.0", id: 3, method: "resources/list" })).json();
  assert.equal(unk.error.code, -32601);
  // An expired access token is refused.
  const late = await rpc(w, t.access_token, { jsonrpc: "2.0", id: 4, method: "ping" }, 1e12 + 3600001);
  assert.equal(late.status, 401);
});

test("tools/call: closed device, then a call answered by the device", async () => {
  const w = world();
  await newGate(w);
  const t = await tokens(w);
  const closed = await (await rpc(w, t.access_token, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "list_apps", arguments: {} } })).json();
  assert.equal(closed.result.isError, true);
  assert.match(closed.result.content[0].text, /not open/);
  const b = w.boxes.get(ID);
  const sock = { sent: [], closed: null, send(m) { this.sent.push(m); setTimeout(() => {
    const q = JSON.parse(m);
    assert.equal(q.n, "budget_lines");
    assert.deepEqual(q.a, { from: "2026-12-01", to: "2026-12-31" });
    b.box.webSocketMessage(sock, JSON.stringify({ r: q.q, ok: true, c: '{"lines":[]}' }));
  }, 1); }, close(c) { this.closed = c; } };
  b.socks.push(sock);
  const res = await (await rpc(w, t.access_token, { jsonrpc: "2.0", id: 6, method: "tools/call",
    params: { name: "budget_lines", arguments: { from: "2026-12-01", to: "2026-12-31" } } })).json();
  assert.equal(res.result.isError, false);
  assert.equal(res.result.content[0].text, '{"lines":[]}');
  const bad = await (await rpc(w, t.access_token, { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "drop_all" } })).json();
  assert.equal(bad.error.code, -32602);
});

test("revoke and delete end every link at once", async () => {
  const w = world();
  await newGate(w);
  const t = await tokens(w);
  assert.equal((await dev(w, { act: "revoke", tok: TOK })).status, 200);
  assert.equal((await rpc(w, t.access_token, { jsonrpc: "2.0", id: 1, method: "ping" })).status, 401);
  assert.equal((await dev(w, { act: "del", tok: TOK })).status, 200);
  assert.equal((await dev(w, { act: "info", tok: TOK })).status, 404);
});

test("wrangler.toml declares the box and the worker exports it", () => {
  const fs = require("node:fs"), path = require("node:path");
  const toml = fs.readFileSync(path.join(__dirname, "..", "relay", "wrangler.toml"), "utf8");
  assert.match(toml, /name = "GATE"\s+class_name = "GateBox"/);
  assert.match(toml, /tag = "gate-v1"\s+new_sqlite_classes = \["GateBox"\]/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "relay", "worker.js"), "utf8"), /export \{ GateBox \} from "\.\/gate\.js";/);
});
