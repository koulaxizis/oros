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
    "invoice_list", "stock_items", "publish_titles", "budget_add", "budget_change", "budget_areas", "budget_categories", "budget_transfer", "budget_balances", "budget_refresh", "budget_delete",
    "kanban_add_cards", "kanban_move_cards", "kanban_change_card", "kanban_add_columns", "kanban_add_board", "invoices_record", "files_link", "files_upload", "local_folders_request", "claude_folders_request", "studio_import", "montage_import", "photolab_import", "oros_update", "gate_tools", "gate_call"]);
  const ro = list.result.tools.filter((x) => x.annotations.readOnlyHint).map((x) => x.name);
  assert.equal(ro.length, 11, "only the budget_*, kanban_* and invoices_record writers are not read-only (+ files_link, GATE-FILES F2; gate_tools GL-5; oros_update GL-7; files_upload GL-8)");
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
  assert.match(closed.result.content[1].text, new RegExp("^\\[orOS Gate " + ID.slice(0, 6) + ": "), "GATE-WHO: its own part names the gate and the last device");
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
  // 6.05.02: a deletion waits too (over 5, the owner confirms when orOS opens)
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
  // GATE-SCREEN (2026-11-19): edit_in_app waits for a screen now, by the copy's switches (writer is not allowed here)
  assert.match((await tc("edit_in_app", { app: "writer", steps: [] })).content[0].text, /may not use writer/);
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
  // 7.43.00 (Chris 2026-11-11): deletions wait too, for the owner's Delete on the device
  const del = (await tc("change_item", { ref: "r3", action: "delete" })).content[0].text;
  assert.match(del, /"queued":true|this deletion waits/);
  assert.match(del, /nothing is deleted without their Delete/);
  assert.match((await tc("link_items", { links: [{ customer: "r1", item: "r2" }], unlink: true })).content[0].text, /waits/);
  assert.equal(G.isDeletion("change_item", { refs: ["r116155"], action: "delete" }), true);
  assert.equal(G.isDeletion("budget_delete", { ids: ["a"] }), true);
  assert.equal(G.isDeletion("link_items", { unlink: true }), false, "an unlink deletes no item");
  assert.deepEqual(G.refsIn({ refs: ["r116155", "r110954"] }), ["r116155", "r110954"], "refs of 6 digits");
  assert.match((await tc("link_contact", { links: [{ customer: "r1", contact: "r4" }] })).content[0].text, /may not change contacts/);
  assert.match((await tc("change_item", { ref: "r99", action: "update" })).content[0].text, /Unknown ref r99/);
  assert.equal((await b.st.storage.list({ prefix: "q:" })).size, 4);
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

test("orOS closed, waiting changes shown as made (PEND-1): p- refs, search, summaries, history, cancel, order, daily reminder", async () => {
  const w = world();
  const woke = [];
  w.env.PUSH = { idFromName: (n) => n, get: (id) => ({ fetch: async (u, o) => { woke.push(Object.assign({ pid: id }, JSON.parse(o.body))); return new Response('{"ok":true}'); } }) };
  await newGate(w);
  const b = w.boxes.get(ID);
  const K = crypto.randomBytes(32), KS = b64u(K);
  const sock = { sent: [], closed: false, __g: { th: hex(TOK), v: 1, at: 1 }, send(x) { this.sent.push(x); const q = JSON.parse(x); if (q.q && q.n === "_key") setTimeout(() => b.box.webSocketMessage(sock, JSON.stringify({ r: q.q, ok: true, c: KS })), 1); }, close() {} };
  b.socks.push(sock);
  const t = await tokens(w);
  const obj = { type: "object", properties: {} };
  await b.st.storage.put("devtools", ["create_items", "change_item", "link_contact", "undo_change", "change_history"].map((n) => ({ name: n, description: n, inputSchema: obj, annotations: { readOnlyHint: n === "change_history", destructiveHint: false } })));
  const index = [{ r: "r1", a: "contacts", t: "Άννα Παππά" }, { r: "r2", a: "crm", t: "Εκδόσεις Χ" }];
  const copy = { at: 1e12, lv: { contacts: "write", crm: "write", todo: "read" }, hold: 0,
                 ans: { __index: JSON.stringify(index), 'app_summary {"app":"contacts"}': '{"contacts":2}', 'app_summary {"app":"todo"}': '{"todo":0}', "change_history {}": '{"changes":[]}' } };
  await b.box.webSocketMessage(sock, JSON.stringify({ snap: await G.sealText(K, JSON.stringify(copy)) }));
  sock.closed = true;
  const tc = async (name, args) => (await (await rpc(w, t.access_token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } })).json()).result;
  const body = (r) => JSON.parse(r.content[0].text);
  // the contact of 16/11: a ref at once
  let r = await tc("create_items", { app: "contacts", items: [{ first: "Νίκος", last: "Δημητρίου", phone: "6900000000" }, { name: "Μαρία" }] });
  assert.equal(r.isError, false);
  const made = body(r);
  assert.equal(made.pending, true);
  assert.match(made.change_id, /^[A-Za-z0-9_-]{16}$/);
  assert.deepEqual(made.refs.map((x) => x.ref), ["p-" + made.change_id + ".0", "p-" + made.change_id + ".1"]);
  assert.equal(made.refs[0].title, "Νίκος Δημητρίου");
  // search finds it, marked pending; words in any field
  let s = JSON.parse((await tc("search_data", { query: "δημητριου" })).content[0].text.split("\n").slice(1).join("\n"));
  assert.equal(s.results.length, 1);
  assert.equal(s.results[0].ref, made.refs[0].ref);
  assert.match(s.results[0].pending, /added while orOS was closed/);
  assert.equal(JSON.parse((await tc("search_data", { query: "6900000000" })).content[0].text.split("\n")[1]).results.length, 1, "phone matches");
  assert.equal(JSON.parse((await tc("search_data", { query: "δημητριου", apps: ["crm"] })).content[0].text.split("\n")[1]).note, "Nothing found.");
  // a change to the new item and a link to it wait too, after the add
  r = await tc("change_item", { ref: made.refs[0].ref, action: "update", note: "από την έκθεση" });
  assert.equal(r.isError, false);
  const ch = body(r);
  r = await tc("link_contact", { links: [{ customer: "r2", contact: made.refs[1].ref }] });
  assert.equal(r.isError, false);
  const ln = body(r);
  assert.match((await tc("change_item", { ref: "p-" + "A".repeat(16) + ".0", action: "update" })).content[0].text, /Unknown ref p-A{16}\.0/);
  // the summaries and the history say what waits
  const sum = (await tc("app_summary", { app: "contacts" })).content[0].text;
  assert.match(sum, /\{"contacts":2\}\n\[Waiting until orOS opens/);
  const wt = JSON.parse(sum.split("\n").pop());
  assert.deepEqual(wt.waiting_added.map((x) => x.ref), made.refs.map((x) => x.ref));
  assert.deepEqual(wt.waiting_changes.map((x) => x.change_id), [ch.change_id, ln.change_id]);
  assert.doesNotMatch((await tc("app_summary", { app: "todo" })).content[0].text, /Waiting/, "another app's summary has none");
  assert.match((await tc("change_history", {})).content[0].text, /waiting_added/);
  // the queue goes to a device in the order asked
  const q = await b.st.storage.list({ prefix: "q:" });
  assert.deepEqual(G.queueFor(q, Date.now()).map((x) => x.id), [made.change_id, ch.change_id, ln.change_id]);
  // undo_change cancels the add and everything that names its items
  r = await tc("undo_change", { ids: [made.change_id] });
  assert.equal(r.isError, false);
  assert.deepEqual(body(r).ids.sort(), [made.change_id, ch.change_id, ln.change_id].sort());
  assert.equal((await b.st.storage.list({ prefix: "q:" })).size, 0);
  assert.match((await tc("undo_change", { ids: ["abcd1234"] })).content[0].text, /needs orOS open/);
  // e3: a change waiting 6 hours wakes the devices with their "waiting" packet, once a day
  const CT = "c".repeat(30), CW = "w".repeat(30), PID = "PiD0123456789_-abcdefg".slice(0, 22);
  assert.equal((await dev(w, { act: "ping", tok: TOK, pid: PID, wt: "W".repeat(43), ct: CT, cw: CW })).status, 200);
  assert.equal((await dev(w, { act: "ping", tok: TOK, pid: PID, wt: "W".repeat(43), ct: CT, cw: "bad!" })).status, 400);
  await tc("create_items", { app: "contacts", items: [{ name: "Γιώργος" }] });
  const [qk] = [...(await b.st.storage.list({ prefix: "q:" })).keys()];
  const row = await b.st.storage.get(qk);
  row.t = Date.now() - 7 * 3600000; await b.st.storage.put(qk, row);
  const m = await b.st.storage.get("meta"); m.last = Date.now(); m.seen = Date.now(); await b.st.storage.put("meta", m);
  assert.deepEqual(woke.map((x) => x.ct), [CT], "the change itself: the usual packet");
  await b.box.alarm();
  assert.deepEqual(woke.map((x) => x.ct), [CT, CW], "then the waiting packet");
  assert.ok(b.st.alarm > Date.now() + 23 * 3600000, "the next reminder is a day later");
  await b.box.alarm();
  assert.equal(woke.length, 2, "not twice the same day");
});

test("a deletion nobody could answer on screen waits for a screen, it is not refused (7.48.00)", async () => {
  // Chris 2026-11-17 «Η ερώτηση δεν εμφανίστηκε ποτέ»: 73 Calendar events, orOS open, no question shown
  const w = world();
  await newGate(w);
  const b = w.boxes.get(ID);
  const K = crypto.randomBytes(32), KS = b64u(K);
  const sock = { sent: [], __g: { th: hex(TOK), v: 1, at: 1 }, send(x) {
    this.sent.push(x);
    const q = JSON.parse(x);
    if (q.q && q.n === "_key") setTimeout(() => b.box.webSocketMessage(sock, JSON.stringify({ r: q.q, ok: true, c: KS })), 1);
    else if (q.q && q.n === "change_item") setTimeout(() => b.box.webSocketMessage(sock, JSON.stringify({ r: q.q, ok: false, c: "__held" })), 1);
  }, close() {} };
  b.socks.push(sock);
  const t = await tokens(w);
  const obj = { type: "object", properties: {} };
  await b.st.storage.put("devtools", [{ name: "change_item", description: "c", inputSchema: obj, annotations: { readOnlyHint: false, destructiveHint: true } }]);
  const r = (await (await rpc(w, t.access_token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "change_item", arguments: { refs: ["r85148", "r85149"], action: "delete" } } })).json()).result;
  assert.equal(r.isError, false, r.content[0].text);
  const out = JSON.parse(r.content[0].text);
  assert.equal(out.queued, true);
  assert.match(out.note, /Nothing is deleted without it/);
  const rows = [...(await b.st.storage.list({ prefix: "q:" })).values()];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hd, 1, "marked as waiting for a screen");
  const cqs = () => sock.sent.map((x) => { try { return JSON.parse(x); } catch (e) { return {}; } }).filter((o) => Array.isArray(o.cq));
  assert.equal(cqs().length, 1, "offered at once to the device on screen");
  assert.equal(cqs()[0].cq[0].id, out.change_id);
  await b.box.webSocketMessage(sock, "v0");
  await b.box.webSocketMessage(sock, "v1");
  assert.equal(cqs().length, 2, "offered again when a device comes on screen");
  await b.box.webSocketMessage(sock, "v1");
  assert.equal(cqs().length, 2, "not again while it stays on screen");
  // a device reports a queued deletion held (cqh): kept, not acknowledged
  await b.box.webSocketMessage(sock, JSON.stringify({ cqa: [], cqh: [out.change_id] }));
  assert.equal((await b.st.storage.list({ prefix: "q:" })).size, 1);
  await b.box.webSocketMessage(sock, JSON.stringify({ cqa: [out.change_id] }));
  assert.equal((await b.st.storage.list({ prefix: "q:" })).size, 0, "gone once a device decided it");
});

test("GATE-SCREEN: Layout's work with nobody at a screen waits for one, live or closed (Chris 2026-11-19)", async () => {
  // «Τα εγκρίνω και τα 3»: a hidden tab or the background host answers __screen; orOS closed queues it from the copy
  const w = world();
  await newGate(w);
  const b = w.boxes.get(ID);
  const K = crypto.randomBytes(32), KS = b64u(K);
  const sock = { sent: [], closed: false, __g: { th: hex(TOK), v: 0, at: 1 }, send(x) {
    this.sent.push(x);
    const q = JSON.parse(x);
    if (q.q && q.n === "_key") setTimeout(() => b.box.webSocketMessage(sock, JSON.stringify({ r: q.q, ok: true, c: KS })), 1);
    else if (q.q && q.n === "rebuild_in_layout") setTimeout(() => b.box.webSocketMessage(sock, JSON.stringify({ r: q.q, ok: false, c: "__screen" })), 1);
  }, close() {} };
  b.socks.push(sock);
  const t = await tokens(w);
  const obj = { type: "object", properties: {} };
  await b.st.storage.put("devtools", ["rebuild_in_layout", "export_pdf", "edit_in_app", "do_action"].map((name) => ({ name, description: "c", inputSchema: obj, annotations: { readOnlyHint: false } })));
  const tc = async (name, args) => (await (await rpc(w, t.access_token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } })).json()).result;
  const cqs = () => sock.sent.map((x) => { try { return JSON.parse(x); } catch (e) { return {}; } }).filter((o) => Array.isArray(o.cq));
  // live, hidden: kept for a screen, not refused
  let r = await tc("rebuild_in_layout", { document: "Κύκλοι" });
  assert.equal(r.isError, false, r.content[0].text);
  let out = JSON.parse(r.content[0].text);
  assert.equal(out.queued, true);
  assert.match(out.note, /open but not on screen[\s\S]*next time orOS is on screen/);
  let rows = [...(await b.st.storage.list({ prefix: "q:" })).values()];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hd, 1);
  assert.equal(JSON.parse(await G.openText(K, rows[0].c)).n, "rebuild_in_layout");
  assert.equal(cqs().length, 0, "not sent to a device that is not on screen");
  await b.box.webSocketMessage(sock, "v1");
  assert.equal(cqs().length, 1, "sent once a device shows orOS");
  await b.box.webSocketMessage(sock, JSON.stringify({ cqa: [out.change_id] }));
  // orOS closed: the copy's switches decide
  await b.box.webSocketMessage(sock, JSON.stringify({ snap: await G.sealText(K, JSON.stringify({ at: 1e12, lv: { layout: "write", budget: "read" }, hold: 0, ans: {} })) }));
  sock.closed = true;
  r = await tc("export_pdf", { document: "Κύκλοι", proof: true });
  assert.equal(r.isError, false, r.content[0].text);
  assert.match(JSON.parse(r.content[0].text).note, /^orOS is closed\. [\s\S]*proofs and previews come only then/);
  rows = [...(await b.st.storage.list({ prefix: "q:" })).values()];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hd, 1);
  assert.match((await tc("edit_in_app", { app: "budget", commands: [] })).content[0].text, /may not change budget/);
  assert.match((await tc("edit_in_app", { app: "layout", dry_run: true, commands: [] })).content[0].text, /dry run with orOS closed needs a copy made by a newer orOS/, "GATE-PL11: a copy without the commands");
  assert.match((await tc("do_action", { app: "music" })).content[0].text, /needs orOS open/, "do_action is never kept for later");
  assert.equal((await b.st.storage.list({ prefix: "q:" })).size, 1);
  assert.equal((await tc("edit_in_app", { app: "layout", commands: [{ op: "set" }] })).isError, false);
  assert.equal((await b.st.storage.list({ prefix: "q:" })).size, 2);
});

test("GATE-SCREEN: the copy's switches and pause refuse a screen call before it is kept", () => {
  const when = "2026-11-19T08:00:00.000Z";
  assert.equal(G.isScreenTool("layout_book", {}), true);
  assert.equal(G.isScreenTool("edit_in_app", { dry_run: true }), false);
  assert.equal(G.isScreenTool("do_action", {}), false);
  assert.equal(G.screenRefusal("rebuild_in_layout", {}, { layout: "write" }, 0, 1, when), "");
  assert.equal(G.screenRefusal("propose_entry", { kind: "todo" }, { todo: "write" }, 0, 1, when), "");
  assert.match(G.screenRefusal("rebuild_in_layout", {}, { layout: "read" }, 0, 1, when), /change no app/);
  assert.match(G.screenRefusal("export_epub", {}, { budget: "write" }, 0, 1, when), /may not use layout/);
  assert.match(G.screenRefusal("rebuild_in_layout", {}, { layout: "write" }, 5, 1, when), /paused/);
  assert.equal(G.pendApp("export_pdf", {}), "layout");
  assert.equal(G.pendApp("edit_in_app", { app: "Writer" }), "writer");
});

test("KB-SUBDEL: removing Kanban subtasks is a deletion for the box (it waits for the owner's Delete)", () => {
  assert.equal(G.isDeletion("kanban_change_card", { remove_subtasks: ["s1"] }), true);
  assert.equal(G.isDeletion("kanban_change_card", { add_subtasks: ["x"] }), false);
  assert.equal(G.isDeletion("kanban_change_card", { remove_subtasks: [] }), false);
  const t = G.TOOLS.find((x) => x.name === "kanban_change_card");
  assert.ok(t.inputSchema.properties.remove_subtasks);
  assert.match(t.description, /remove_subtasks: a deletion/);
});

test("KB-COLREN: kanban_add_columns also renames columns (not a deletion)", () => {
  const t = G.TOOLS.find((x) => x.name === "kanban_add_columns");
  assert.ok(t.inputSchema.properties.rename_columns);
  assert.deepEqual(t.inputSchema.required, ["board"]);
  assert.deepEqual(t.inputSchema.properties.rename_columns.items.required, ["column", "name"]);
  assert.match(t.description, /renames columns/);
  assert.equal(G.isDeletion("kanban_add_columns", { board: "b", rename_columns: [{ column: "c", name: "ISBN" }] }), false);
});

test("KB-COLAP: kanban_add_columns also sets Author Portal steps (not a deletion), same keys in the Assistant", () => {
  const t = G.TOOLS.find((x) => x.name === "kanban_add_columns");
  const pc = t.inputSchema.properties.portal_columns;
  assert.ok(pc);
  assert.deepEqual(pc.items.required, ["column"]);
  assert.deepEqual(Object.keys(pc.items.properties).sort(), ["about", "about_en", "column", "finish", "name", "name_en", "step"]);
  assert.equal(pc.items.additionalProperties, false);
  assert.match(t.description, /portal_columns/);
  assert.equal(G.isDeletion("kanban_add_columns", { board: "b", portal_columns: [{ column: "c", step: false }] }), false);
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "assistant", "core.js"), "utf8");
  const at = src.indexOf("var TOOL_KB_COLS"), seg = src.slice(at, src.indexOf("var TOOL_OPEN_FILE", at));
  ["portal_columns", "step:", "finish:", "name_en:", "about:", "about_en:"].forEach((k) => assert.ok(seg.indexOf(k) > 0, "Assistant has " + k));
});

test("TRAY-1/2: b1 gets the calls kept for a screen; lf is kept sealed and passed on; a folder request waits for a screen", async () => {
  // Chris 2026-11-21 «να δουλεύεις με το orOS κλειστό στο tray … και πρόσβαση στους φακέλους ακόμη και με έγκριση από κινητό»
  const w = world();
  await newGate(w);
  const b = w.boxes.get(ID);
  const K = crypto.randomBytes(32), KS = b64u(K);
  // (ver: an orOS that knows local_folders_request, GQ-VER)
  const mk = (th) => ({ sent: [], closed: false, __g: { th, v: 0, at: 1, ver: 85200 }, send(x) {
    this.sent.push(x);
    let q = {};
    try { q = JSON.parse(x); } catch (e) {}
    if (q.q && q.n === "_key") setTimeout(() => b.box.webSocketMessage(this, JSON.stringify({ r: q.q, ok: true, c: KS })), 1);
    else if (q.q && q.n === "local_folders_request") setTimeout(() => b.box.webSocketMessage(this, JSON.stringify({ r: q.q, ok: false, c: "__held" })), 1);
  }, close() {} });
  const sock = mk(hex(TOK));
  b.socks.push(sock);
  const t = await tokens(w);
  const tc = async (name, args) => (await (await rpc(w, t.access_token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } })).json()).result;
  const cqs = (s) => s.sent.map((x) => { try { return JSON.parse(x); } catch (e) { return {}; } }).filter((o) => Array.isArray(o.cq));
  // live, nobody at a screen: the question is kept for one
  let r = await tc("local_folders_request", { path: "C:\\Users\\Chris\\Books\\Vythos", reason: "pictures" });
  assert.equal(r.isError, false, r.content[0].text);
  let out = JSON.parse(r.content[0].text);
  assert.equal(out.queued, true);
  assert.match(out.note, /asked the next time orOS is on screen on one of the owner's devices \(the phone too\)/);
  let rows = [...(await b.st.storage.list({ prefix: "q:" })).values()];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hd, 1);
  assert.equal(JSON.parse(await G.openText(K, rows[0].c)).n, "local_folders_request");
  assert.equal(cqs(sock).length, 0);
  // b1 (tray host / desktop window): it is offered the kept calls
  await b.box.webSocketMessage(sock, "b1");
  assert.equal(cqs(sock).length, 1, "offered to a device that runs unseen work");
  await b.box.webSocketMessage(sock, "b1");
  assert.equal(cqs(sock).length, 1, "once");
  await b.box.webSocketMessage(sock, JSON.stringify({ cqa: [out.change_id] }));
  // lf: kept as is, passed to the others, given to a device as it connects
  const other = mk("ff".repeat(32));
  b.socks.push(other);
  const sealed = await G.sealText(K, JSON.stringify({ v: 1, l: [] }));
  await b.box.webSocketMessage(sock, JSON.stringify({ lf: sealed }));
  assert.equal((await b.st.storage.get("meta")).lf, sealed);
  assert.ok(other.sent.indexOf(JSON.stringify({ lf: sealed })) >= 0, "passed to the other device");
  assert.ok(sock.sent.indexOf(JSON.stringify({ lf: sealed })) < 0, "not back to the sender");
  await b.box.webSocketMessage(sock, JSON.stringify({ lf: "not sealed!" }));
  assert.equal((await b.st.storage.get("meta")).lf, sealed, "junk is ignored");
  await b.box.webSocketMessage(sock, JSON.stringify({ lf: "a.b" + "x".repeat(70000) }));
  assert.equal((await b.st.storage.get("meta")).lf, sealed, "too big is ignored");
  // orOS closed: the question waits too, unless Claude's changes are paused
  await b.box.webSocketMessage(sock, JSON.stringify({ snap: await G.sealText(K, JSON.stringify({ at: 1e12, lv: {}, hold: 0, ans: {} })) }));
  sock.closed = true; other.closed = true;
  r = await tc("local_folders_request", { path: "C:\\Users\\Chris\\Books\\Vythos" });
  assert.equal(r.isError, false, r.content[0].text);
  rows = [...(await b.st.storage.list({ prefix: "q:" })).values()];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hd, 1);
  const tool = G.TOOLS.find((x) => x.name === "local_folders_request");
  assert.deepEqual(tool.inputSchema.required, ["path"]);
  assert.deepEqual(tool.inputSchema.properties.access.enum, ["read", "write"]);
  // CF-ASK (Chris 2026-11-22): a folder of the orOS disk for Claude's folders waits for a screen the same way
  r = await tc("claude_folders_request", { path: "Studio/Podcasts", access: "write", reason: "studio_import" });
  assert.equal(r.isError, false, r.content[0].text);
  out = JSON.parse(r.content[0].text);
  assert.equal(out.queued, true);
  assert.match(out.note, /Nothing is opened before the owner allows it/);
  rows = [...(await b.st.storage.list({ prefix: "q:" })).values()];
  assert.equal(rows.length, 2);
  const cf = await Promise.all(rows.map(async (x) => JSON.parse(await G.openText(K, x.c))));
  assert.deepEqual(cf.map((x) => x.n).sort(), ["claude_folders_request", "local_folders_request"]);
  assert.ok(rows.every((x) => x.hd === 1));
  const ct = G.TOOLS.find((x) => x.name === "claude_folders_request");
  assert.deepEqual(ct.inputSchema.required, ["path"]);
  assert.equal(ct.annotations.readOnlyHint, false);
});

test("GL-7: oros_update asks every open orOS to update; a device's Update asks the others", async () => {
  const w = world();
  await newGate(w);
  const t = await tokens(w);
  const tc = async () => (await (await rpc(w, t.access_token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "oros_update", arguments: {} } })).json()).result;
  const none = await tc();
  assert.equal(none.isError, true);
  assert.match(none.content[0].text, /No orOS is open/);
  const b = w.boxes.get(ID);
  const mk = () => ({ sent: [], closed: null, send(m) { this.sent.push(m); }, close(c) { this.closed = c; } });
  const pc = mk(), phone = mk();
  b.socks.push(pc, phone);
  const two = await tc();
  assert.equal(two.isError, false);
  assert.match(two.content[0].text, /Asked 2 open orOS/);
  assert.deepEqual([pc.sent.pop(), phone.sent.pop()], ['{"upd":1}', '{"upd":1}']);
  await b.box.webSocketMessage(phone, '{"upd":1}');
  assert.deepEqual(pc.sent, ['{"upd":1}']);
  assert.deepEqual(phone.sent, [], "the asking device is not asked back");
  const g = require("fs").readFileSync(require("path").join(__dirname, "..", "gate/gate.js"), "utf8");
  assert.match(g, /fetch\("\/__oros\/update", \{ method: "POST"/);
  assert.match(g, /if \(ev\.data\.indexOf\('\{"upd"'\) === 0\) \{ onUpd\(\); return; \}/);
});

// GATE-PL11 (Chris 2026-11-22, «Πλανόδιο» item 11): with every orOS closed
// a dry run is checked against the copy's pack, and so is every edit_in_app
// (studio_import too) before it waits, so a mistake shows at once.
test("GATE-PL11: edit_in_app and studio_import are checked against the copy with orOS closed", async () => {
  const w = world();
  await newGate(w);
  const b = w.boxes.get(ID);
  const K = crypto.randomBytes(32), KS = b64u(K);
  const sock = { sent: [], closed: false, __g: { th: hex(TOK), v: 0, at: 1 }, send(x) {
    this.sent.push(x);
    const q = JSON.parse(x);
    if (q.q && q.n === "_key") setTimeout(() => b.box.webSocketMessage(sock, JSON.stringify({ r: q.q, ok: true, c: KS })), 1);
  }, close() {} };
  b.socks.push(sock);
  const t = await tokens(w);
  const obj = { type: "object", properties: {} };
  await b.st.storage.put("devtools", ["edit_in_app", "undo_change", "files_write"].map((name) => ({ name, description: "c", inputSchema: obj, annotations: { readOnlyHint: false } })));
  const tc = async (name, args) => (await (await rpc(w, t.access_token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } })).json()).result;
  const SC = require("../studio/commands.js"), ops = {};
  Object.keys(SC.CATALOG).forEach((op) => { ops[op] = JSON.parse(JSON.stringify(SC.CATALOG[op].args || {})); });
  const pack = { studio: { max: SC.MAX_STEPS, ops, docs: ["Πλανόδιο 1", "Πλανόδιο 2", "Demo"], open: "Demo" } };
  // a live call first, so the box keeps a key for this link
  sock.send = function (x) { this.sent.push(x); const q = JSON.parse(x); if (q.q) setTimeout(() => b.box.webSocketMessage(sock, JSON.stringify({ r: q.q, ok: true, c: q.n === "_key" ? KS : "ok" })), 1); };
  await tc("edit_in_app", { app: "studio", dry_run: true, steps: [{ op: "project", bpm: 90 }] });
  await b.box.webSocketMessage(sock, JSON.stringify({ snap: await G.sealText(K, JSON.stringify({ at: 1e12, lv: { studio: "write", files: "write" }, hold: 0, ans: { __edit: JSON.stringify(pack) } })) }));
  sock.closed = true;
  b.socks.length = 0;
  // a good dry run: checked, nothing kept
  let r = await tc("edit_in_app", { app: "studio", dry_run: true, designs: "named", name: "πλανοδιο 2", steps: [{ op: "project", bpm: 96 }] });
  assert.equal(r.isError, false, r.content[0].text);
  let o = JSON.parse(r.content[0].text);
  assert.equal(o.checked_with_oros_closed, true);
  assert.deepEqual(o.documents, ["Πλανόδιο 2"]);
  assert.equal((await b.st.storage.list({ prefix: "q:" })).size, 0, "a dry run is never kept");
  // mistakes show at once, for a dry run and a real call alike
  r = await tc("edit_in_app", { app: "studio", dry_run: true, steps: [{ op: "project", bpm: 9999 }, { op: "nope" }] });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /command 1 project: bpm 9999 is not allowed[\s\S]*command 2 unknown command "nope"/);
  r = await tc("edit_in_app", { app: "studio", designs: "named", name: "Ballads", steps: [{ op: "project", bpm: 96 }] });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /no document is called "Ballads"[\s\S]*Nothing was kept/);
  assert.equal((await b.st.storage.list({ prefix: "q:" })).size, 0);
  // studio_import without a copy of Claude's folders: the file is looked for when it runs
  r = await tc("studio_import", { path: "/internal/Studio/Podcasts/Ep0.orosstudio" });
  assert.equal(r.isError, false, r.content[0].text);
  assert.equal((await b.st.storage.list({ prefix: "q:" })).size, 1);
  await tc("undo_change", { ids: [JSON.parse(r.content[0].text).change_id] });
  assert.equal((await b.st.storage.list({ prefix: "q:" })).size, 0);
  // with the copy: the file must be in it or waiting in a files_write
  const idx = { v: 1, at: 1e12, w: 1, f: ["/internal/Studio/Podcasts"], files: [{ p: "/internal/Studio/Podcasts/Ep1.orosstudio", s: 10, m: 1, v: "0123456789abcdef" }] };
  await b.st.storage.put("x:0", await G.sealText(K, JSON.stringify(idx)));
  await b.st.storage.put("fidx", { n: 1, at: 1e12 });
  r = await tc("studio_import", { path: "/internal/Studio/Podcasts/Ep3.orosstudio" });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /"Studio\/Podcasts\/Ep3\.orosstudio" is neither in the copy of Claude's folders nor waiting in a files_write/);
  r = await tc("files_write", { path: "Studio/Podcasts/Ep3.orosstudio", text: "{}" });
  assert.equal(r.isError, false, r.content[0].text);
  r = await tc("studio_import", { path: "/internal/Studio/Podcasts/Ep3.orosstudio", title: "Πλανόδιο 3" });
  assert.equal(r.isError, false, r.content[0].text);
  r = await tc("studio_import", { path: "/internal/Studio/Podcasts/Ep1.orosstudio" });
  assert.equal(r.isError, false, r.content[0].text);
  assert.equal((await b.st.storage.list({ prefix: "q:" })).size, 3);
  // the project a waiting import makes can be named already
  r = await tc("edit_in_app", { app: "studio", dry_run: true, designs: "named", name: "Πλανόδιο 3", steps: [{ op: "project", bpm: 96 }] });
  assert.equal(r.isError, false, r.content[0].text);
  // Mail thread review: the closed checks read only the small header h (f), never the whole row
  const rows = [...(await b.st.storage.list({ prefix: "q:" })).entries()], fs = [];
  for (const [k, v] of rows) {
    const h = JSON.parse(await G.openText(K, v.h)), x = JSON.parse(await G.openText(K, v.c));
    fs.push(h.f);
    assert.equal(JSON.stringify(h.a).indexOf("Podcasts"), -1, "f is kept apart from a");
    // an old row (h without f) falls back to c; a new one never opens c
    if (x.a && x.a.title === "Πλανόδιο 3") { delete h.f; await b.st.storage.put(k, Object.assign({}, v, { h: await G.sealText(K, JSON.stringify(h)) })); }
    else await b.st.storage.put(k, Object.assign({}, v, { c: "not-a-sealed-row" }));
  }
  assert.deepEqual(fs.filter(Boolean).map((f) => f.p || f.app + ":" + f.d).sort(), ["/internal/Studio/Podcasts/Ep3.orosstudio", "studio:Ep1", "studio:Πλανόδιο 3"]);
  assert.equal(G.pendHead("files_write", { path: "../x" }, 1).f, null, "nothing named: null, c never opened");
  assert.equal(G.pendHead("budget_add", {}, 1).f, undefined);
  const qn = await b.box.queuedNames(K);
  assert.deepEqual(qn.paths, ["/internal/Studio/Podcasts/Ep3.orosstudio"]);
  assert.deepEqual(Object.keys(qn.docs), ["studio"]);
  assert.deepEqual(qn.docs.studio.slice().sort(), ["Ep1", "Πλανόδιο 3"]);
  // other apps and old copies
  r = await tc("edit_in_app", { app: "layout", dry_run: true, steps: [{ op: "set" }] });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /may not use layout|may not change layout/);
});

test("GQ-VER: a waiting change that needs a newer orOS goes only to a device that has it (Chris 2026-11-22)", async () => {
  // the phone's cached older orOS dropped a folder question it did not know
  assert.equal(G.minVer("claude_folders_request", {}), 84500);
  assert.equal(G.minVer("local_folders_request", {}), 81100);
  assert.equal(G.minVer("edit_in_app", { app: "mockups", steps: [] }), 84600);
  assert.equal(G.minVer("edit_in_app", { app: "photolab", steps: [{ op: "fill" }] }), 84600);
  assert.equal(G.minVer("edit_in_app", { app: "photolab", steps: [{ op: "tone" }] }), 0);
  assert.equal(G.minVer("create_items", { app: "timesheet_project", items: [] }), 85500);
  assert.equal(G.minVer("create_items", { app: "timesheet", items: [] }), 0);
  assert.equal(G.minVer("edit_in_app", { app: "atelier", steps: [{ op: "create" }] }), 0);
  assert.equal(G.minVer("budget_add", {}), 0);
  const q = new Map([["q:AAAAAAAAAAAAAAAA", { c: "a", t: 1, s: 1 }], ["q:BBBBBBBBBBBBBBBB", { c: "b", t: 2, s: 2, mv: 84500 }]]);
  assert.deepEqual(G.queueFor(q, 10).map((x) => x.id), ["AAAAAAAAAAAAAAAA", "BBBBBBBBBBBBBBBB"], "no version given: every row, as before");
  assert.deepEqual(G.queueFor(q, 10, 0).map((x) => x.id), ["AAAAAAAAAAAAAAAA"], "version not said yet");
  assert.deepEqual(G.queueFor(q, 10, 84401).map((x) => x.id), ["AAAAAAAAAAAAAAAA"]);
  assert.deepEqual(G.queueFor(q, 10, 84500).map((x) => x.id), ["AAAAAAAAAAAAAAAA", "BBBBBBBBBBBBBBBB"]);

  const w = world();
  await newGate(w);
  const b = w.boxes.get(ID);
  const sock = { sent: [], __g: { th: hex(TOK), v: 1, at: 1 }, send(x) { this.sent.push(x); }, close() {} };
  b.socks.push(sock);
  const K = crypto.randomBytes(32);
  const r1 = JSON.parse((await b.box.queueChange("claude_folders_request", { path: "/internal/Studio/Podcasts", access: "write" }, K, Date.now(), null, "n", 1)).c);
  const r2 = JSON.parse((await b.box.queueChange("budget_add", { lines: [] }, K, Date.now(), null, "n")).c);
  const rows = await b.st.storage.list({ prefix: "q:" });
  assert.equal(rows.get("q:" + r1.change_id).mv, 84500, "the folder question needs 8.45.00");
  assert.equal(rows.get("q:" + r2.change_id).mv, undefined);
  const cqs = () => sock.sent.map((x) => { try { return JSON.parse(x); } catch (e) { return {}; } }).filter((o) => Array.isArray(o.cq));
  await b.box.webSocketMessage(sock, "ver:8.44.01");
  assert.equal(cqs().length, 0, "an older orOS is not offered it");
  await b.box.sendHeld([sock]);
  assert.equal(cqs().length, 0, "not as a held one either");
  await b.box.webSocketMessage(sock, "ver:8.51.00");
  assert.equal(cqs().length, 1, "offered once the device runs an orOS that knows it");
  assert.deepEqual(cqs()[0].cq.map((x) => x.id), [r1.change_id]);
  await b.box.webSocketMessage(sock, "ver:8.51.00");
  assert.equal(cqs().length, 1, "not again for the same version");
});
