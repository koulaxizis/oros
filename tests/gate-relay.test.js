// orOS Gate on the relay (relay/gate.js through relay/core.js): OAuth
// metadata, registration, the authorize page and pairing code, the device's code, the
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
        // The platform's ping answer time (6.01.02): a socket without pongAt has just answered one.
        const state = { storage: st.storage, getWebSockets: () => socks.filter((s) => !s.closed),
                        getWebSocketAutoResponseTimestamp: (s) => (s.pongAt === undefined ? new Date(8.64e15) : s.pongAt === null ? null : new Date(s.pongAt)) };
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

const AUTH_Q = "?response_type=code&client_id=x&redirect_uri=" + encodeURIComponent(CB) + "&state=st1&code_challenge=" + CHALLENGE + "&code_challenge_method=S256";
async function authPage(w) {
  const r = await call(w, "GET", "/gate/authorize" + AUTH_Q);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("Content-Type"), /text\/html/);
  assert.match(r.headers.get("Content-Security-Policy"), /default-src 'none'/);
  const html = await r.text();
  const code = /class="code"[^>]*>([A-Z0-9]{4})-([A-Z0-9]{4})</.exec(html);
  const self = /url=([^"]+)"/.exec(html);
  const web = /class="btn" href="([^"]+)"/.exec(html);
  assert.ok(code && self && web, "page has the code, its refresh and the web link");
  return { html, pc: code[1] + code[2], self: self[1].replace(/&amp;/g, "&"), web: web[1].replace(/&amp;/g, "&") };
}

test("authorize shows a pairing page with a link to orOS on the web", async () => {
  const w = world();
  const pg = await authPage(w);
  const loc = new URL(pg.web);
  assert.equal(loc.origin, ORIGIN);
  const p = JSON.parse(Buffer.from(loc.searchParams.get("gate"), "base64url").toString());
  assert.deepEqual(p, { r: CB, s: "st1", c: CHALLENGE });
  for (const ch of pg.pc) assert.ok(G.PAIR_ABC.indexOf(ch) >= 0);
  assert.ok(w.boxes.has("pair:" + pg.pc), "the pairing box holds the sign-in");
  const plain = await call(w, "GET", "/gate/authorize" + AUTH_Q.replace("S256", "plain"));
  assert.match(plain.headers.get("Location"), /^https:\/\/claude\.ai\/api\/mcp\/auth_callback\?error=invalid_request&state=st1$/);
  const evil = await call(w, "GET", "/gate/authorize" + AUTH_Q.replace(encodeURIComponent(CB), encodeURIComponent("https://evil.example/")));
  assert.equal(evil.status, 400);
});

test("pairing: the code typed in orOS sends the waiting page back to Claude", async () => {
  const w = world();
  await newGate(w);
  const pg = await authPage(w);
  const path = pg.self.slice(BASE.length);
  // still waiting: the same page again
  const wait = await call(w, "GET", path);
  assert.equal(wait.status, 200);
  assert.match(await wait.text(), new RegExp(pg.pc.slice(0, 4) + "-" + pg.pc.slice(4)));
  // a wrong secret on the page gets nothing
  assert.equal((await call(w, "GET", path.replace(/k=[^&]+/, "k=" + "Z".repeat(43)))).status, 410);
  // wrong codes count, the device token is needed
  assert.equal((await dev(w, { act: "pair", tok: "X".repeat(43), pc: pg.pc })).status, 404);
  assert.equal((await dev(w, { act: "pair", tok: TOK, pc: "bad" })).status, 400);
  assert.equal((await dev(w, { act: "pair", tok: TOK, pc: "AAAAAAAA" })).status, 404);
  // the right code, lower case with a dash, as a person types it
  const ok = await dev(w, { act: "pair", tok: TOK, pc: (pg.pc.slice(0, 4) + "-" + pg.pc.slice(4)).toLowerCase() });
  assert.equal(ok.status, 200);
  assert.equal((await dev(w, { act: "pair", tok: TOK, pc: pg.pc })).status, 404, "one use");
  const done = await call(w, "GET", path);
  assert.equal(done.status, 302);
  const back = new URL(done.headers.get("Location"));
  assert.equal(back.origin + back.pathname, CB);
  assert.equal(back.searchParams.get("state"), "st1");
  const code = back.searchParams.get("code");
  assert.ok(code.indexOf(ID + ".") === 0);
  const tk = await call(w, "POST", "/gate/token", { form: { grant_type: "authorization_code", code, code_verifier: VERIFIER, redirect_uri: CB } });
  assert.equal(tk.status, 200);
  assert.ok((await tk.json()).access_token);
  assert.equal((await call(w, "GET", path)).status, 410, "the page is gone after use");
});

test("pairing: at most 5 wrong codes per gate in 10 minutes", async () => {
  const w = world();
  await newGate(w);
  for (let i = 0; i < 5; i++) assert.equal((await dev(w, { act: "pair", tok: TOK, pc: "AAAAAAA" + "BCDEF"[i] })).status, 404);
  assert.equal((await dev(w, { act: "pair", tok: TOK, pc: "AAAAAAAG" })).status, 429);
  assert.equal((await dev(w, { act: "pair", tok: TOK, pc: "AAAAAAAG" }, 1e12 + 11 * 60000)).status, 404);
});

test("pairing: an expired code is refused and the page says so", async () => {
  const w = world();
  await newGate(w);
  const pg = await authPage(w);
  const later = 1e12 + 11 * 60000;
  assert.equal((await dev(w, { act: "pair", tok: TOK, pc: pg.pc }, later)).status, 404);
  assert.equal((await call(w, "GET", pg.self.slice(BASE.length), { now: later })).status, 410);
});

test("the installed orOS (localhost:47800) may call /gate/dev, other pages may not", async () => {
  const w = world();
  const local = await call(w, "POST", "/gate/dev", { origin: "http://localhost:47800", json: { id: ID, act: "new", th: hex(TOK) } });
  assert.equal(local.status, 200);
  assert.equal(local.headers.get("Access-Control-Allow-Origin"), "http://localhost:47800");
  const pre = await call(w, "OPTIONS", "/gate/dev", { origin: "http://localhost:47800" });
  assert.equal(pre.status, 204);
  for (const o of ["http://localhost:8080", "http://127.0.0.1:47800", "https://evil.example"]) {
    assert.equal((await call(w, "POST", "/gate/dev", { origin: o, json: { id: ID, act: "info", tok: TOK } })).status, 403, o);
  }
});

test("device calls need an allowed origin and the device token", async () => {
  const w = world();
  assert.equal((await call(w, "POST", "/gate/dev", { json: { id: ID, act: "new", th: hex(TOK) } })).status, 403);
  await newGate(w);
  assert.equal((await dev(w, { act: "new", th: hex(TOK) })).status, 409);
  assert.equal((await dev(w, { act: "code", tok: "X".repeat(43), c: CHALLENGE, r: CB })).status, 404);
  assert.equal((await dev(w, { act: "code", tok: TOK, c: CHALLENGE, r: "https://evil.example/" })).status, 400);
  const info = await (await dev(w, { act: "info", tok: TOK })).json();
  assert.deepEqual(info.data, { links: 0, last: 0, devices: 1 });
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
    "invoice_list", "stock_items", "publish_titles", "budget_add", "budget_change", "budget_areas", "budget_categories", "budget_transfer", "budget_balances", "budget_delete",
    "kanban_add_cards", "kanban_move_cards", "kanban_change_card", "kanban_add_columns"]);
  const ro = list.result.tools.filter((x) => x.annotations.readOnlyHint).map((x) => x.name);
  assert.equal(ro.length, 7, "only the budget_* and kanban_* writers are not read-only");
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
  assert.match(closed.result.content[0].text, /orOS is closed and there is no copy/);
  assert.ok(closed.result.content[0].text.indexOf("the gate " + ID.slice(0, 6) + ";") > 0, "names the gate the link points to (5.90.00)");
  const b = w.boxes.get(ID);
  const sock = { sent: [], closed: null, send(m) { this.sent.push(m); setTimeout(() => {
    const q = JSON.parse(m);
    if (q.n === "_key") { b.box.webSocketMessage(sock, JSON.stringify({ r: q.q, ok: false, c: "" })); return; }
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

const TOK2 = "U".repeat(43), TOK3 = "V".repeat(43);
async function join(w, code, tok, origin) {
  return call(w, "POST", "/gate/dev", { origin: origin || ORIGIN, json: { act: "join", jc: code, th: hex(tok) } });
}

test("another device joins with a code: once, levels passed on, up to 5 devices", async () => {
  const w = world();
  await newGate(w);
  const inv = await dev(w, { act: "invite", tok: TOK, lv: { budget: "read", kanban: "write", diary: "maybe", "Bad Key": "read" } });
  assert.equal(inv.status, 200);
  const code = (await inv.json()).data.code;
  assert.ok(G.normPair(code));
  assert.equal((await join(w, "AAAAAAAA", TOK2)).status, 404);
  const j = await join(w, code.slice(0, 4) + "-" + code.slice(4), TOK2, "http://localhost:47800");
  assert.equal(j.status, 200);
  const jd = (await j.json()).data;
  assert.equal(jd.id, ID);
  assert.deepEqual(jd.lv, { budget: "read", kanban: "write" });
  assert.equal((await join(w, code, TOK3)).status, 404, "one use");
  // the new device is a device of this gate now
  const info = await (await dev(w, { act: "info", tok: TOK2 })).json();
  assert.equal(info.data.devices, 2);
  // a full gate refuses more devices
  for (const t of ["W", "X", "Y"]) {
    const c = (await (await dev(w, { act: "invite", tok: TOK })).json()).data.code;
    assert.equal((await join(w, c, t.repeat(43))).status, 200);
  }
  assert.equal((await dev(w, { act: "invite", tok: TOK })).status, 429);
});

test("a device that leaves keeps the gate for the others; the last one wipes it", async () => {
  const w = world();
  await newGate(w);
  const code = (await (await dev(w, { act: "invite", tok: TOK })).json()).data.code;
  await join(w, code, TOK2);
  const t = await tokens(w);
  const b = w.boxes.get(ID);
  const s2 = { closed: null, __g: { th: hex(TOK2), v: 1, at: 1 }, send() {}, close(c) { this.closed = c; } };
  b.socks.push(s2);
  assert.equal((await dev(w, { act: "del", tok: TOK })).status, 200);
  assert.equal(s2.closed, null, "the other device's socket stays");
  assert.equal((await dev(w, { act: "info", tok: TOK })).status, 404, "the first device is out");
  const r = await rpc(w, t.access_token, { jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(r.status, 200, "Claude's link still works");
  assert.equal((await dev(w, { act: "del", tok: TOK2 })).status, 200);
  assert.equal(s2.closed, 4004);
  assert.equal((await dev(w, { act: "info", tok: TOK2 })).status, 404);
});

test("which device answers: one on screen first, then the one that connected last", () => {
  const s = (v, at, n) => ({ n, __g: { v, at } });
  const order = G.pickOrder([s(0, 30, "pc hidden"), s(1, 10, "phone shown"), s(1, 20, "pc shown"), s(0, 40, "tab hidden")]);
  assert.deepEqual(order.map((x) => x.n), ["pc shown", "phone shown", "tab hidden", "pc hidden"]);
});

test("a gate made before 5.70.00 (meta.th) still works and can take a second device", async () => {
  const w = world();
  w.env.GATE.get(ID);
  const b = w.boxes.get(ID);
  await b.st.storage.put("meta", { th: hex(TOK), at: 5, last: 1e12 });
  assert.equal((await dev(w, { act: "info", tok: TOK })).status, 200);
  const code = (await (await dev(w, { act: "invite", tok: TOK })).json()).data.code;
  assert.equal((await join(w, code, TOK2)).status, 200);
  const m = await b.st.storage.get("meta");
  assert.deepEqual(m.devs.map((d) => d.th), [hex(TOK), hex(TOK2)]);
  assert.equal(m.th, undefined);
});

// GATE-ACT (2026-11-08): the open device adds its own tools; they are
// kept for when the device is closed, and calls to them go through.
test("tools/list asks the device for its tools, keeps them, and passes their calls", async () => {
  const w = world();
  await newGate(w);
  const t = await tokens(w);
  const b = w.boxes.get(ID);
  const devList = [
    { name: "change_item", description: "Change an item by ref.", inputSchema: { type: "object", properties: { ref: { type: "string" } } }, annotations: { destructiveHint: true } },
    { name: "search_data", description: "Search, with refs.", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
    { name: "budget_add", description: "clash", inputSchema: { type: "object" } }
  ];
  const sock = { sent: [], closed: null, send(m) { this.sent.push(m); setTimeout(() => {
    const q = JSON.parse(m);
    const c = q.n === "__tools" ? JSON.stringify(devList) : JSON.stringify({ did: q.n, ref: q.a.ref });
    b.box.webSocketMessage(sock, JSON.stringify({ r: q.q, ok: true, c }));
  }, 1); }, close(c) { this.closed = c; } };
  b.socks.push(sock);
  const list = await (await rpc(w, t.access_token, { jsonrpc: "2.0", id: 1, method: "tools/list" })).json();
  const names = list.result.tools.map((x) => x.name);
  assert.equal(names[names.length - 1], "change_item");
  assert.equal(names.filter((n) => n === "budget_add").length, 1);
  assert.notEqual(list.result.tools.find((x) => x.name === "search_data").description, "Search, with refs.", "ours stays");
  const nv = await (await rpc(w, t.access_token, { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "change_item", arguments: { app: "passwords" } } })).json();
  assert.equal(nv.result.isError, true, "a never-app is refused on the relay too");
  const res = await (await rpc(w, t.access_token, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "change_item", arguments: { ref: "r1" } } })).json();
  assert.equal(res.result.isError, false);
  assert.deepEqual(JSON.parse(res.result.content[0].text), { did: "change_item", ref: "r1" });
  // The device goes away: the kept list is still listed.
  sock.closed = 1000;
  const later = await (await rpc(w, t.access_token, { jsonrpc: "2.0", id: 3, method: "tools/list" })).json();
  assert.ok(later.result.tools.some((x) => x.name === "change_item"));
  const unk = await (await rpc(w, t.access_token, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "drop_all" } })).json();
  assert.equal(unk.error.code, -32602);
});

test("app switches are shared: a device's change is kept and passed to the others (5.77.00)", async () => {
  const w = world();
  await newGate(w);
  const inv = await (await dev(w, { act: "invite", tok: TOK })).json();
  assert.equal(inv.data.devices, 1, "invite says how many devices there are");
  await join(w, inv.data.code, TOK2);
  const b = w.boxes.get(ID);
  const s1 = { sent: [], __g: { th: hex(TOK), v: 1, at: 1 }, send(m) { this.sent.push(m); }, close() {} };
  const s2 = { sent: [], __g: { th: hex(TOK2), v: 1, at: 2 }, send(m) { this.sent.push(m); }, close() {} };
  const stranger = { sent: [], __g: { th: hex("Z".repeat(43)), v: 1, at: 3 }, send(m) { this.sent.push(m); }, close() {} };
  b.socks.push(s1, s2, stranger);
  await b.box.webSocketMessage(s1, JSON.stringify({ lv: { budget: "write", kanban: "read", "Bad Key": "read", x: "maybe" } }));
  assert.equal(s1.sent.length, 0, "not echoed to the sender");
  assert.equal(s2.sent.length, 1);
  assert.deepEqual(JSON.parse(s2.sent[0]).lv, { budget: "write", kanban: "read" });
  const m = await b.st.storage.get("meta");
  assert.deepEqual(m.lv, { budget: "write", kanban: "read" });
  // a socket that is not a device of this gate cannot set them
  await b.box.webSocketMessage(stranger, JSON.stringify({ lv: { invoices: "read" } }));
  assert.deepEqual((await b.st.storage.get("meta")).lv, { budget: "write", kanban: "read" });
  // not an object: ignored
  await b.box.webSocketMessage(s1, JSON.stringify({ lv: ["budget"] }));
  assert.deepEqual((await b.st.storage.get("meta")).lv, { budget: "write", kanban: "read" });
});

test("a synced device sits in the gate with its seat secret, no code (5.77.00)", async () => {
  const w = world();
  await newGate(w);
  const SS = "S".repeat(43);
  assert.equal((await dev(w, { act: "seat", tok: TOK, sh: "nothex" })).status, 400);
  assert.equal((await dev(w, { act: "seat", tok: TOK, sh: hex(SS) })).status, 200);
  const b = w.boxes.get(ID);
  const m = await b.st.storage.get("meta");
  m.lv = { budget: "read" }; await b.st.storage.put("meta", m);
  const sit = (ss, tok) => call(w, "POST", "/gate/dev", { origin: ORIGIN, json: { act: "sit", id: ID, ss, th: hex(tok) } });
  assert.equal((await sit("T".repeat(43), TOK2)).status, 404, "wrong secret");
  const ok = await sit(SS, TOK2);
  assert.equal(ok.status, 200);
  const d = (await ok.json()).data;
  assert.deepEqual(d.lv, { budget: "read" });
  assert.equal(d.devices, 2);
  assert.equal((await dev(w, { act: "info", tok: TOK2 })).status, 200, "the seated device is a device of the gate");
  assert.equal((await (await sit(SS, TOK2)).json()).data.devices, 2, "sitting again adds no device");
  // wrong secrets are limited like pairing codes
  for (let i = 0; i < 5; i++) await sit("U".repeat(43), TOK3);
  assert.equal((await sit(SS, TOK3)).status, 429);
});

test("after a change the owner's devices are woken: one generic push per 15 minutes (5.78.00)", async () => {
  const w = world();
  const wakes = [];
  w.env.PUSH = { idFromName: (n) => n, get: (pid) => ({ fetch: async (url, o) => {
    const j = JSON.parse(o.body); wakes.push([pid, j]);
    return new Response(JSON.stringify(pid === "GoneGoneGoneGoneGone12" ? { ok: false, code: "gone" } : { ok: true }));
  } }) };
  await newGate(w);
  const PID = "PushBoxPushBoxPushBox1", WT = "W".repeat(43), CT = "C".repeat(40);
  assert.equal((await dev(w, { act: "ping", tok: TOK, pid: PID, wt: WT, ct: "short" })).status, 400, "a packet the push box would refuse");
  assert.equal((await dev(w, { act: "ping", tok: TOK, pid: "x", wt: WT, ct: CT })).status, 400);
  assert.equal((await dev(w, { act: "ping", tok: "X".repeat(43), pid: PID, wt: WT, ct: CT })).status, 404, "only a device of the gate");
  assert.equal((await dev(w, { act: "ping", tok: TOK, pid: PID, wt: WT, ct: CT })).status, 200);
  assert.equal((await dev(w, { act: "ping", tok: TOK, pid: PID, wt: WT, ct: CT })).status, 200, "one row per device");
  const b = w.boxes.get(ID);
  const m = await b.st.storage.get("meta");
  m.pg.push({ th: "f".repeat(64), pid: "GoneGoneGoneGoneGone12", wt: WT, ct: CT });
  await b.st.storage.put("meta", m);
  const t = await tokens(w);
  const sock = { sent: [], closed: null, send(x) { this.sent.push(x); setTimeout(() => {
    const q = JSON.parse(x);
    b.box.webSocketMessage(sock, JSON.stringify({ r: q.q, ok: true, c: "{}" }));
  }, 1); }, close(c) { this.closed = c; } };
  b.socks.push(sock);
  const callTool = (name, now) => rpc(w, t.access_token, { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: {} } }, now);
  await callTool("budget_lines", 1e12);
  assert.equal(wakes.length, 0, "reading wakes nobody");
  await callTool("budget_add", 1e12);
  assert.deepEqual(wakes.map((x) => x[0]).sort(), [PID, "GoneGoneGoneGoneGone12"].sort());
  assert.deepEqual(wakes.find((x) => x[0] === PID)[1], { act: "wake", wt: WT, ct: CT, now: 1e12 });
  assert.equal((await b.st.storage.get("meta")).pg.length, 1, "a push box that is gone is dropped");
  await callTool("kanban_move_cards", 1e12 + 60000);
  assert.equal(wakes.length, 2, "not again within 15 minutes");
  await callTool("kanban_move_cards", 1e12 + 16 * 60000);
  assert.equal(wakes.length, 3);
  assert.equal((await dev(w, { act: "ping", tok: TOK, pid: "" })).status, 200, "taken back");
  assert.equal((await b.st.storage.get("meta")).pg.length, 0);
});

test("orOS closed: the copy answers reads, changes wait encrypted, deletions wait, the key lives only in token wraps (5.80.00)", async () => {
  const w = world();
  await newGate(w);
  const b = w.boxes.get(ID);
  const K = crypto.randomBytes(32), KS = b64u(K);
  const sock = { sent: [], closed: false, __g: { th: hex(TOK), v: 1, at: 1 }, send(x) { this.sent.push(x); const q = JSON.parse(x); if (q.q && q.n === "_key") setTimeout(() => b.box.webSocketMessage(sock, JSON.stringify({ r: q.q, ok: true, c: KS })), 1); }, close() {} };
  b.socks.push(sock);
  const t = await tokens(w);
  const access = t.access_token.split(".")[1];
  const kw = await b.st.storage.get("kw:" + hex(access));
  assert.ok(kw && kw.w, "the key is wrapped for the new access token");
  assert.doesNotMatch(JSON.stringify([...b.st.kv.entries()]), new RegExp(KS), "the key itself is never stored");
  const copy = { at: 1e12, lv: { budget: "write" }, hold: 0, ans: {
    "list_apps {}": '{"apps":["budget"]}', "budget_lines {}": '{"lines":[1]}', 'app_summary {"app":"budget","month":"2026-11"}': '{"m":"nov"}' } };
  await b.box.webSocketMessage(sock, JSON.stringify({ snap: await G.sealText(K, JSON.stringify(copy)) }));
  assert.match(sock.sent[sock.sent.length - 1], /snapok/);
  assert.equal((await b.st.storage.get("meta")).cp, 1);
  sock.closed = true;                                       // orOS closes
  const tc = async (name, args) => (await (await rpc(w, t.access_token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } })).json()).result;
  let r = await tc("list_apps");
  assert.equal(r.isError, false);
  assert.match(r.content[0].text, /^\[orOS is closed: this is the copy of .*\]\n\{"apps":\["budget"\]\}$/);
  assert.match((await tc("app_summary", { month: "2026-11", app: "budget" })).content[0].text, /\{"m":"nov"\}$/, "the arguments match in any order");
  r = await tc("budget_lines", { from: "2026-01-01" });
  assert.match(r.content[0].text, /with its own filters[\s\S]*\{"lines":\[1\]\}/);
  assert.equal((await tc("search_data", { query: "x" })).isError, true);
  r = await tc("budget_add", { entries: [{ date: "2026-11-08", kind: "out", amount: 5 }] });
  assert.equal(r.isError, false);
  assert.match(r.content[0].text, /"queued":true/);
  const q = await b.st.storage.list({ prefix: "q:" });
  assert.equal(q.size, 1);
  const item = [...q.values()][0];
  assert.doesNotMatch(item.c, /2026-11-08/, "the waiting change is encrypted");
  assert.equal(JSON.parse(await G.openText(K, item.c)).n, "budget_add");
  // 6.05.00: a deletion waits too (over 5, the owner confirms when orOS opens)
  assert.match((await tc("budget_delete", { ids: ["a"] })).content[0].text, /"queued":true/);
  assert.equal(JSON.parse(await G.openText(K, [...(await b.st.storage.list({ prefix: "q:" })).values()].find((x) => x !== item).c)).n, "budget_delete");
  assert.match((await tc("kanban_add_cards", { board: "x", cards: [] })).content[0].text, /may not change kanban/);
  // a refresh carries the key to the new tokens, with orOS still closed
  const rf = await (await call(w, "POST", "/gate/token", { form: { grant_type: "refresh_token", refresh_token: t.refresh_token } })).json();
  assert.ok(await b.st.storage.get("kw:" + hex(rf.access_token.split(".")[1])));
  assert.equal(await b.st.storage.get("kw:" + hex(t.refresh_token.split(".")[1])), undefined, "the old wrap goes with the old token");
  assert.match((await (await rpc(w, rf.access_token, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_apps", arguments: {} } })).json()).result.content[0].text, /copy of/);
  // the device applied it and says so
  await b.box.webSocketMessage(sock, JSON.stringify({ cqa: [...(await b.st.storage.list({ prefix: "q:" })).keys()].map((k) => k.slice(2)) }));
  assert.equal((await b.st.storage.list({ prefix: "q:" })).size, 0);
  // 7 days without an open device: the copy goes
  const m = await b.st.storage.get("meta");
  m.seen = Date.now() - 8 * 86400000; m.last = Date.now(); await b.st.storage.put("meta", m);
  await b.box.alarm();
  assert.equal(await b.st.storage.get("copy"), undefined);
  assert.equal((await b.st.storage.list({ prefix: "kw:" })).size, 0);
  assert.equal((await b.st.storage.get("meta")).cp, undefined);
});

test("revoking the links drops the key wraps and the copy (5.80.00)", async () => {
  const w = world();
  await newGate(w);
  const b = w.boxes.get(ID);
  const K = crypto.randomBytes(32);
  const sock = { sent: [], __g: { th: hex(TOK), v: 1, at: 1 }, send(x) { const q = JSON.parse(x); if (q.q) setTimeout(() => b.box.webSocketMessage(sock, JSON.stringify({ r: q.q, ok: true, c: b64u(K) })), 1); }, close() {} };
  b.socks.push(sock);
  await tokens(w);
  await b.box.webSocketMessage(sock, JSON.stringify({ snap: await G.sealText(K, '{"at":1,"ans":{}}') }));
  assert.ok((await b.st.storage.list({ prefix: "kw:" })).size >= 2);
  assert.equal((await dev(w, { act: "revoke", tok: TOK })).status, 200);
  assert.equal((await b.st.storage.list({ prefix: "kw:" })).size, 0);
  assert.equal(await b.st.storage.get("copy"), undefined);
  assert.equal(G.stableArgs({ b: 1, a: "", c: null, d: [2] }), '{"b":1,"d":[2]}');
});

test("orOS closed, the device's own tools (GATE-ACT): reads from the copy, create_items waits, the rest needs orOS open", async () => {
  const w = world();
  await newGate(w);
  const b = w.boxes.get(ID);
  const K = crypto.randomBytes(32), KS = b64u(K);
  const sock = { sent: [], closed: false, __g: { th: hex(TOK), v: 1, at: 1 }, send(x) { this.sent.push(x); const q = JSON.parse(x); if (q.q && q.n === "_key") setTimeout(() => b.box.webSocketMessage(sock, JSON.stringify({ r: q.q, ok: true, c: KS })), 1); }, close() {} };
  b.socks.push(sock);
  const t = await tokens(w);
  const obj = { type: "object", properties: {} };
  await b.st.storage.put("devtools", [
    { name: "read_item", description: "r", inputSchema: obj, annotations: { readOnlyHint: true, destructiveHint: false } },
    { name: "create_items", description: "c", inputSchema: obj, annotations: { readOnlyHint: false, destructiveHint: false } },
    { name: "change_item", description: "c", inputSchema: obj, annotations: { readOnlyHint: false, destructiveHint: true } },
    { name: "edit_in_app", description: "e", inputSchema: obj, annotations: { readOnlyHint: false, destructiveHint: true } }
  ]);
  const copy = { at: 1e12, lv: { todo: "write", crm: "write", notes: "read" }, hold: 0, ans: { 'read_item {"ref":"r1"}': '{"t":1}', 'app_summary {"app":"todo"}': '{"todo":1}' } };
  await b.box.webSocketMessage(sock, JSON.stringify({ snap: await G.sealText(K, JSON.stringify(copy)) }));
  sock.closed = true;
  const tc = async (name, args) => (await (await rpc(w, t.access_token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } })).json()).result;
  assert.match((await tc("read_item", { ref: "r1" })).content[0].text, /copy of[\s\S]*\{"t":1\}$/);
  assert.match((await tc("read_item", { ref: "r9" })).content[0].text, /needs orOS open/);
  assert.match((await tc("app_summary", { app: "todo" })).content[0].text, /\{"todo":1\}$/, "an everyday app's summary from the copy");
  let r = await tc("create_items", { app: "todo", items: [{ text: "x" }] });
  assert.equal(r.isError, false);
  assert.match(r.content[0].text, /"queued":true/);
  assert.match((await tc("create_items", { app: "crm_activity", items: [{ text: "x" }] })).content[0].text, /"queued":true/, "crm_* is CRM");
  assert.match((await tc("create_items", { app: "notes", items: [{ text: "x" }] })).content[0].text, /may not change notes/);
  assert.match((await tc("change_item", { ref: "r1" })).content[0].text, /needs orOS open/);
  assert.match((await tc("edit_in_app", { app: "writer", steps: [] })).content[0].text, /needs orOS open/);
  assert.equal((await b.st.storage.list({ prefix: "q:" })).size, 2);
});

test("orOS closed, full work (5.96.00): search over the copy's index, a board by name, changes and links by ref wait", async () => {
  const w = world();
  await newGate(w);
  const b = w.boxes.get(ID);
  const K = crypto.randomBytes(32), KS = b64u(K);
  const sock = { sent: [], closed: false, __g: { th: hex(TOK), v: 1, at: 1 }, send(x) { this.sent.push(x); const q = JSON.parse(x); if (q.q && q.n === "_key") setTimeout(() => b.box.webSocketMessage(sock, JSON.stringify({ r: q.q, ok: true, c: KS })), 1); }, close() {} };
  b.socks.push(sock);
  const t = await tokens(w);
  const obj = { type: "object", properties: {} };
  await b.st.storage.put("devtools", ["change_item", "link_items", "link_contact"].map((n) => ({ name: n, description: n, inputSchema: obj, annotations: { readOnlyHint: false, destructiveHint: n === "change_item" } })));
  const index = [{ r: "r1", a: "crm", t: "Στέφανος Ξεφτέρης" }, { r: "r2", a: "kanban", t: "Η Κατερίνα και η Λαμπιτώ", x: "Βιβλία · Σε παραγωγή", l: ["Παιδικά"] },
                 { r: "r3", a: "notes", t: "Σημειώσεις Λαμπιτώ" }, { r: "r4", a: "contacts", t: "Άννα" }];
  const copy = { at: 1e12, lv: { crm: "write", kanban: "write", notes: "write", contacts: "read" }, hold: 0,
                 ans: { __index: JSON.stringify(index), 'app_summary {"app":"kanban","board":"Βιβλία"}': '{"board":"Βιβλία"}' } };
  await b.box.webSocketMessage(sock, JSON.stringify({ snap: await G.sealText(K, JSON.stringify(copy)) }));
  sock.closed = true;
  const tc = async (name, args) => (await (await rpc(w, t.access_token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } })).json()).result;
  let r = await tc("search_data", { query: "λαμπιτω" });
  assert.equal(r.isError, false);
  const found = JSON.parse(r.content[0].text.split("\n").slice(1).join("\n"));
  assert.deepEqual(found.results.map((x) => x.ref), ["r2", "r3"], "words match without accents or case");
  assert.deepEqual(JSON.parse((await tc("search_data", { query: "λαμπιτω", apps: ["notes"] })).content[0].text.split("\n")[1]).results.map((x) => x.ref), ["r3"]);
  assert.deepEqual(JSON.parse((await tc("search_data", { label: "παιδικα" })).content[0].text.split("\n")[1]).results.map((x) => x.ref), ["r2"]);
  assert.match((await tc("app_summary", { app: "kanban", board: "βιβλια" })).content[0].text, /\{"board":"Βιβλία"\}$/, "a board's name in other case");
  r = await tc("link_items", { links: [{ customer: "r1", item: "r2" }] });
  assert.equal(r.isError, false);
  assert.match(r.content[0].text, /"queued":true/);
  assert.match((await tc("change_item", { ref: "r3", action: "update", text_add: "x" })).content[0].text, /"queued":true/);
  assert.match((await tc("change_item", { ref: "r3", action: "delete" })).content[0].text, /Deleting waits/);
  assert.match((await tc("link_items", { links: [{ customer: "r1", item: "r2" }], unlink: true })).content[0].text, /Deleting waits/);
  assert.match((await tc("link_contact", { links: [{ customer: "r1", contact: "r4" }] })).content[0].text, /may not change contacts/);
  assert.match((await tc("change_item", { ref: "r99", action: "update" })).content[0].text, /Unknown ref r99/);
  assert.equal((await b.st.storage.list({ prefix: "q:" })).size, 2);
  assert.deepEqual(G.refsIn({ ref: "oros:r1", refs: ["r2", "x"], changes: [{ ref: "r3" }], links: [{ customer: "r4", item: "r5" }] }), ["r1", "r2", "r3", "r4", "r5"]);
});

test("switches set before 5.77.00 reach the box once: a device's base is kept only while the box has none (5.82.00)", async () => {
  const w = world();
  await newGate(w);
  const inv = await (await dev(w, { act: "invite", tok: TOK })).json();
  await join(w, inv.data.code, TOK2);
  const b = w.boxes.get(ID);
  const s1 = { sent: [], __g: { th: hex(TOK), v: 1, at: 1 }, send(m) { this.sent.push(m); }, close() {} };
  const s2 = { sent: [], __g: { th: hex(TOK2), v: 1, at: 2 }, send(m) { this.sent.push(m); }, close() {} };
  b.socks.push(s1, s2);
  await b.box.webSocketMessage(s2, JSON.stringify({ lv: {}, base: 1 }));
  assert.equal((await b.st.storage.get("meta")).lv, undefined, "an empty base never claims it");
  await b.box.webSocketMessage(s1, JSON.stringify({ lv: { budget: "write", kanban: "read" }, base: 1 }));
  assert.deepEqual((await b.st.storage.get("meta")).lv, { budget: "write", kanban: "read" });
  assert.deepEqual(JSON.parse(s2.sent[0]).lv, { budget: "write", kanban: "read" }, "passed to the other device");
  await b.box.webSocketMessage(s2, JSON.stringify({ lv: { invoices: "read" }, base: 1 }));
  assert.deepEqual((await b.st.storage.get("meta")).lv, { budget: "write", kanban: "read" }, "a later base does not win");
  await b.box.webSocketMessage(s2, JSON.stringify({ lv: { invoices: "read" } }));
  assert.deepEqual((await b.st.storage.get("meta")).lv, { invoices: "read" }, "a real change does");
});

test("a device asleep in the background (6.01.02): skipped at once, a change that times out waits under its call id, a late answer takes it back", async () => {
  const w = world();
  await newGate(w);
  const b = w.boxes.get(ID);
  const K = crypto.randomBytes(32), KS = b64u(K);
  const calls = [];
  const sock = { sent: [], closed: false, __g: { th: hex(TOK), v: 1, at: 1 }, send(x) {
    this.sent.push(x);
    const q = JSON.parse(x);
    if (q.q && q.n === "_key") { setTimeout(() => b.box.webSocketMessage(sock, JSON.stringify({ r: q.q, ok: true, c: KS })), 1); return; }
    if (q.q) calls.push(q);                                  // busy: never answers in time
  }, close() {} };
  b.socks.push(sock);
  const t = await tokens(w);
  const obj = { type: "object", properties: {} };
  await b.st.storage.put("devtools", [{ name: "create_items", description: "c", inputSchema: obj, annotations: { readOnlyHint: false, destructiveHint: false } }]);
  const copy = { at: 1e12, lv: { todo: "write", budget: "read" }, hold: 0, ans: { "list_apps {}": '{"apps":["todo"]}' } };
  await b.box.webSocketMessage(sock, JSON.stringify({ snap: await G.sealText(K, JSON.stringify(copy)) }));
  const tc = async (name, args) => (await (await rpc(w, t.access_token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } })).json()).result;
  const was = G.GATE_LIMITS.callMs;
  G.GATE_LIMITS.callMs = 30;
  try {
    // awake but busy: the call goes to it with a deadline, then waits in the queue under its own id
    let r = await tc("create_items", { app: "todo", items: [{ title: "x", date: "2026-11-10" }] });
    assert.equal(r.isError, false);
    assert.match(r.content[0].text, /"queued":true/);
    assert.match(r.content[0].text, /did not answer in time \(asleep in the background or busy\)/);
    assert.equal(calls.length, 1);
    assert.equal(typeof calls[0].dl, "number", "each call carries the box's deadline");
    const q = await b.st.storage.list({ prefix: "q:" });
    assert.deepEqual([...q.keys()], ["q:" + calls[0].q]);
    assert.equal(JSON.parse(await G.openText(K, [...q.values()][0].c)).n, "create_items");
    // a read that times out answers from the copy
    r = await tc("list_apps");
    assert.equal(r.isError, false);
    assert.match(r.content[0].text, /^\[orOS did not answer in time \(asleep in the background or busy\): this is the copy of/);
    // the device answers the change late, done: it waits no more
    await b.box.webSocketMessage(sock, JSON.stringify({ r: calls[0].q, ok: true, c: "{}" }));
    assert.equal((await b.st.storage.list({ prefix: "q:" })).size, 0);
    // "late" (never started) keeps it waiting; held back from other devices for lateMs
    const t0 = Date.now();
    await tc("create_items", { app: "todo", items: [{ title: "y" }] });
    await b.box.webSocketMessage(sock, JSON.stringify({ r: calls[2].q, ok: false, c: "late" }));
    let held = await b.st.storage.list({ prefix: "q:" });
    assert.equal(held.size, 1);
    const nb = [...held.values()][0].nb;
    assert.ok(nb >= t0 + G.GATE_LIMITS.lateMs && nb <= Date.now() + G.GATE_LIMITS.lateMs, "nb = when it timed out + lateMs");
    assert.deepEqual(G.queueFor(held, nb - 1), [], "another device connecting before nb does not get it");
    assert.deepEqual(G.queueFor(held, nb).map((x) => x.id), [calls[2].q], "after nb it does");
    // a late refusal (the app off, paused) ends it: it never runs later
    await tc("create_items", { app: "todo", items: [{ title: "w" }] });
    await b.box.webSocketMessage(sock, JSON.stringify({ r: calls[3].q, ok: false, c: "Claude may not change To-Do." }));
    held = await b.st.storage.list({ prefix: "q:" });
    assert.deepEqual([...held.keys()], ["q:" + calls[2].q]);
    // no ping answered for 150 s: the socket is asleep and gets nothing; the change waits at once
    sock.pongAt = Date.now() - 200000;
    const n = sock.sent.length;
    r = await tc("create_items", { app: "todo", items: [{ title: "z" }] });
    assert.match(r.content[0].text, /"queued":true/);
    assert.match(r.content[0].text, /orOS is asleep in the background/);
    assert.equal(sock.sent.length, n, "nothing sent to the sleeping socket");
    const all = await b.st.storage.list({ prefix: "q:" });
    assert.equal(all.size, 2);
    assert.equal([...all.values()].filter((v) => v.nb).length, 1, "a change queued with orOS asleep (not a timeout) goes to the next device at once");
    // any message wakes it again
    await b.box.webSocketMessage(sock, "v1");
    assert.equal(b.box.awake(Date.now()).length, 1);
  } finally { G.GATE_LIMITS.callMs = was; }
});
