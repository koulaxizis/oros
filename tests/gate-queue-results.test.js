// KB-WAITNAME, KB-QRES (Chris 2026-11-27, Noxpress routines' gaps 10
// and 11): a waiting Kanban change names its board by name (also when it
// was given by id or p- ref) and a label-only kanban_add_columns says
// which labels, rows from before 8.93.00 included; change_history says
// what became of every change that waited (applied, refused, the owner's
// Keep, cancelled), with its change_id.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
let handle, G;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  G = await import("../relay/gate.js");
});
const GD = require("../gate/gate.js");

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

const BOARDS = { app: "kanban", boards_only: true, boards: [{ name: "Noxpress", id: "b7", cards: 0, columns: [{ name: "Νέο", id: "c1", cards: 0 }], labels: [] }], archived_boards: [] };

test("pendingOf: a board given by id or p- ref shows by name; the summary names it", () => {
  const T = 1763900000000;
  const kbl = { boards: BOARDS.boards, archived: [] };
  const rows = [
    { id: "AAAAAAAAAAAAAAAA", n: "kanban_add_columns", a: G.pendHead("kanban_add_columns", { board: "b7", add_labels: [{ name: "κρίσιμο", color: "red" }, { name: "μέτριο" }] }, T).a, t: T, s: 1 },
    Object.assign({ id: "BBBBBBBBBBBBBBBB", t: T + 1, s: 2 }, (() => { const h = G.pendHead("kanban_add_board", { name: "Babyland", columns: [{ name: "Νέο" }] }, T); return { n: h.n, a: h.a, f: h.f }; })()),
    { id: "CCCCCCCCCCCCCCCC", n: "kanban_add_cards", a: G.pendHead("kanban_add_cards", { board: "p-BBBBBBBBBBBBBBBB.0", cards: [{ column: "Νέο", text: "x" }] }, T).a, t: T + 2, s: 3 }
  ];
  const p = G.pendingOf(rows, [], kbl);
  assert.deepEqual(p.changes.map((c) => [c.board, c.board_id]), [["Noxpress", "b7"], [undefined, undefined], ["Babyland", "p-BBBBBBBBBBBBBBBB.0"]]);
  assert.equal(p.changes[0].sum, "labels on Noxpress: κρίσιμο (red); μέτριο");
  assert.equal(p.changes[2].sum, "add 1 card(s) on Babyland: x");
  const note = JSON.parse(G.pendNote(p, ["kanban"]).split("\n").pop());
  const w0 = note.waiting_changes.find((x) => x.change_id === "AAAAAAAAAAAAAAAA");
  assert.deepEqual([w0.board, w0.board_id, w0.summary], ["Noxpress", "b7", "labels on Noxpress: κρίσιμο (red); μέτριο"]);
  // without the copy's board list: as before
  assert.equal(G.pendingOf(rows, []).changes[0].board, "b7");
});

test("qrList: results by change_id, newest first, filtered by app and dates", () => {
  const h = (n, a) => { const x = G.pendHead(n, a, 1); return { n: x.n, a: x.a, f: x.f }; };
  const D = (s) => Date.parse(s + "T12:00:00Z");
  const rows = [
    { id: "YQjqtMjLmfoSuu1t", t: D("2026-11-23"), qt: D("2026-11-23") - 60000, h: h("kanban_add_board", { name: "Noxpress", columns: [{ name: "Νέο" }] }), r: { how: "refused", c: "A board called \"Noxpress\" is already there (id b7)." } },
    { id: "BBBBBBBBBBBBBBBB", t: D("2026-11-25"), qt: D("2026-11-24"), h: h("kanban_add_cards", { board: "Noxpress", cards: [{ column: "Νέο", text: "a" }] }), r: { how: "applied", c: "{\"ids\":[\"k1\"]}" } },
    { id: "CCCCCCCCCCCCCCCC", t: D("2026-11-26"), qt: D("2026-11-26"), h: h("create_items", { app: "todo", items: [{ title: "t" }] }), r: { how: "cancelled" } },
    { id: "DDDDDDDDDDDDDDDD", t: D("2026-11-26"), qt: D("2026-11-26"), h: h("change_item", { ref: "r1" }), r: null },
    { id: "EEEEEEEEEEEEEEEE", t: D("2026-11-20"), qt: D("2026-11-20"), h: h("change_item", { ref: "r2" }), r: null, ok: 1 }
  ];
  const all = G.qrList(rows, {});
  assert.deepEqual(all.map((x) => x.change_id), ["CCCCCCCCCCCCCCCC", "DDDDDDDDDDDDDDDD", "BBBBBBBBBBBBBBBB", "YQjqtMjLmfoSuu1t", "EEEEEEEEEEEEEEEE"]);
  const nox = all.find((x) => x.change_id === "YQjqtMjLmfoSuu1t");
  assert.deepEqual([nox.tool, nox.app, nox.board, nox.summary, nox.result], ["kanban_add_board", "kanban", "Noxpress", "make board Noxpress (Νέο)", "not applied: refused"]);
  assert.match(nox.why, /already there \(id b7\)/);
  assert.equal(nox.asked, "2026-11-23T11:59:00.000Z");
  assert.equal(all.find((x) => x.change_id === "BBBBBBBBBBBBBBBB").answer, "{\"ids\":[\"k1\"]}");
  assert.equal(all.find((x) => x.change_id === "CCCCCCCCCCCCCCCC").result, "cancelled with undo_change before orOS opened");
  assert.match(all.find((x) => x.change_id === "DDDDDDDDDDDDDDDD").result, /sent no details/);
  assert.equal(all.find((x) => x.change_id === "EEEEEEEEEEEEEEEE").result, "applied");
  assert.deepEqual(G.qrList(rows, { app: "kanban" }).map((x) => x.change_id), ["BBBBBBBBBBBBBBBB", "YQjqtMjLmfoSuu1t"]);
  assert.deepEqual(G.qrList(rows, { from: "2026-11-24", to: "2026-11-25" }).map((x) => x.change_id), ["BBBBBBBBBBBBBBBB"]);
  assert.equal(G.qrNote([]), "");
  assert.match(G.qrNote(all), /^\n\[Changes that waited for orOS to open and what became of them/);
});

test("device: a queued change's outcome", () => {
  assert.deepEqual(GD.qOutcome({ ok: true, c: "{\"board\":\"b7\"}" }), { how: "applied", c: "{\"board\":\"b7\"}" });
  assert.deepEqual(GD.qOutcome({ ok: false, c: "A board called \"Noxpress\" is already there." }), { how: "refused", c: "A board called \"Noxpress\" is already there." });
  assert.deepEqual(GD.qOutcome({ ok: false, late: 1, c: "long text" }), { how: "late" });
  assert.equal(GD.qOutcome({ ok: false, c: "x".repeat(900) }).c.length, 300);
  // applyQueue sends them sealed with the acknowledgement
  const src = require("fs").readFileSync(require("path").join(__dirname, "../gate/gate.js"), "utf8");
  assert.match(src, /outs\[it\.id\] = qOutcome\(res\);/);
  assert.match(src, /if \(Object\.keys\(cqr\)\.length\) msg\.cqr = cqr;/);
});

test("relay: label-only waiting change by board id, an old row's empty summary, and change_history's queued_results", async () => {
  const w = world();
  await newGate(w);
  const b = w.boxes.get(ID);
  const K = crypto.randomBytes(32), KS = b64u(K);
  const sock = { sent: [], closed: false, __g: { th: hex(TOK), v: 1, at: 1 }, send(x) { this.sent.push(x); const q = JSON.parse(x); if (q.q && q.n === "_key") setTimeout(() => b.box.webSocketMessage(sock, JSON.stringify({ r: q.q, ok: true, c: KS })), 1); }, close() {} };
  b.socks.push(sock);
  const t = await tokens(w);
  await b.st.storage.put("devtools", ["change_history", "undo_change"].map((name) => ({ name, description: "h", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: name === "change_history" } })));
  const copy = { at: 1e12, lv: { kanban: "write" }, hold: 0,
                 ans: { __index: "[]", [G.KB_LIST_KEY]: JSON.stringify(BOARDS), __hist: "[]", "change_history {}": '{"changes":[]}' } };
  await b.box.webSocketMessage(sock, JSON.stringify({ snap: await G.sealText(K, JSON.stringify(copy)) }));
  sock.closed = true;
  const tc = async (name, args) => (await (await rpc(w, t.access_token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } })).json()).result;
  // gap 10: labels on a board given by its id
  let r = await tc("kanban_add_columns", { board: "b7", add_labels: [{ name: "κρίσιμο", color: "red" }, { name: "μέτριο", color: "yellow" }] });
  assert.equal(r.isError, false, r.content[0].text);
  const lab = JSON.parse(r.content[0].text).change_id;
  // a row queued by 8.92 kept "columns on b7: " (no labels) in its header
  const OLD = "OOOOOOOOOOOOOOOO";
  await b.st.storage.put("q:" + OLD, { t: 1e12 - 1000, s: 0,
    c: await G.sealText(K, JSON.stringify({ n: "kanban_add_columns", a: { board: "b7", add_labels: [{ name: "χαμηλό" }] }, t: 1e12 - 1000 })),
    h: await G.sealText(K, JSON.stringify({ n: "kanban_add_columns", t: 1e12 - 1000, a: { refs: [], kb: "b7", sum: "columns on b7: " } })) });
  r = await tc("app_summary", { app: "kanban", boards_only: true });
  const wt = JSON.parse(r.content[0].text.split("\n").pop()).waiting_changes;
  const byId = (id) => wt.find((x) => x.change_id === id);
  assert.deepEqual([byId(lab).board, byId(lab).board_id, byId(lab).summary], ["Noxpress", "b7", "labels on Noxpress: κρίσιμο (red); μέτριο (yellow)"]);
  assert.deepEqual([byId(OLD).board, byId(OLD).summary], ["Noxpress", "labels on Noxpress: χαμηλό"]);
  // gap 11: a board that waits, then a device refuses it (duplicate) and says so
  r = await tc("kanban_add_board", { name: "Babyland", columns: [{ name: "Νέο" }] });
  const nb = JSON.parse(r.content[0].text).change_id;
  r = await tc("kanban_add_cards", { board: "Noxpress", cards: [{ column: "Νέο", text: "Εύρημα" }] });
  const cards = JSON.parse(r.content[0].text).change_id;
  r = await tc("undo_change", { ids: [cards] });
  assert.equal(r.isError, false, r.content[0].text);
  const ds = { sent: [], closed: false, __g: { th: hex(TOK), v: 1, at: 1 }, send(x) { this.sent.push(x); }, close() {} };
  b.socks.push(ds);
  const why = "A board called \"Babyland\" is already there (id b9); add columns to it with kanban_add_columns.";
  await b.box.webSocketMessage(ds, JSON.stringify({ cqa: [nb, lab, OLD], cqr: { [nb]: await G.sealText(K, JSON.stringify({ how: "refused", c: why })), [lab]: await G.sealText(K, JSON.stringify({ how: "applied", c: "Done." })) } }));
  assert.equal((await b.st.storage.list({ prefix: "q:" })).size, 0, "all left the queue");
  assert.equal((await b.st.storage.list({ prefix: "qr:" })).size, 4);
  ds.closed = true;
  r = await tc("change_history", {});
  assert.equal(r.isError, false, r.content[0].text);
  const txt = r.content.map((c) => c.text).join("\n");
  const qr = JSON.parse(txt.split("\n").find((l) => l.indexOf('{"queued_results"') === 0)).queued_results;
  const res = (id) => qr.find((x) => x.change_id === id);
  assert.deepEqual([res(nb).result, res(nb).why, res(nb).board], ["not applied: refused", why, "Babyland"]);
  assert.equal(res(lab).result, "applied");
  assert.equal(res(cards).result, "cancelled with undo_change before orOS opened");
  assert.match(res(OLD).result, /sent no details/);
  // filtered like the history; nothing for another app
  r = await tc("change_history", { app: "todo" });
  assert.doesNotMatch(r.content.map((c) => c.text).join("\n"), /queued_results/);
  // the results stay 30 days at most
  for (const [k, v] of await b.st.storage.list({ prefix: "qr:" })) { v.t = Date.now() - 31 * 86400000; await b.st.storage.put(k, v); }
  r = await tc("change_history", {});
  assert.doesNotMatch(r.content.map((c) => c.text).join("\n"), /queued_results/);
});
