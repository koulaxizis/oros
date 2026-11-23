// KB-CLOSED, KB-LIST, KB-FIND, KB-WAIT, KB-HIST, KB-AGE (Chris
// 2026-11-23, Kanban/Gate gaps from the routines of every Project):
// with orOS closed a Kanban change to a board (or column) the copy and
// the queue do not know is refused at once; a second kanban_add_board of
// a waiting name answers with the first; boards_only lists the boards
// alone; search_data finds boards and columns; waiting changes say what
// they target; change_history filters the copy; every closed answer
// says how old the copy is.
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
global.window = global.window || {};
const S = require("../assistant/summary.js");

const BOARDS = { app: "kanban", boards_only: true, boards: [
  { name: "Βιβλία", id: "b1", cards: 2, columns: [{ name: "Αναμονή", id: "c1", cards: 2 }, { name: "Έγινε", id: "c2", cards: 0 }], labels: ["Παιδικά"] },
  { name: "Μουσική", id: "b2", cards: 0, columns: [{ name: "Ιδέες", id: "c3", cards: 0 }] }
], archived_boards: ["Παλιό"] };
const LIST = () => ({ boards: JSON.parse(JSON.stringify(BOARDS.boards)), archived: ["Παλιό"] });

test("kbClosedCheck: boards and columns by id or name; unknown ones refused with the boards named", () => {
  const ok = (n, a, q) => G.kbClosedCheck(n, a, LIST(), q || [], "W");
  assert.equal(ok("kanban_add_cards", { board: "βιβλια", cards: [{ column: "ΑΝΑΜΟΝΗ", text: "x" }, { column: "c2", text: "y" }] }), null);
  assert.equal(ok("kanban_move_cards", { board: "b2", moves: [{ card: "k", column: "Ιδέες" }] }), null);
  assert.equal(ok("kanban_change_card", { board: "Βιβλία", card: "zz" }), null);
  let r = ok("kanban_add_columns", { board: "Babyland", columns: [{ name: "Νέο" }] });
  assert.match(r.err, /^Board not found: there is no board "Babyland" in the copy of W/);
  assert.match(r.err, /The boards: Βιβλία, Μουσική\. Archived: Παλιό\./);
  assert.match(r.err, /kanban_add_board/);
  assert.match(ok("kanban_add_cards", { board: "παλιο", cards: [] }).err, /is archived/);
  r = ok("kanban_add_cards", { board: "Βιβλία", cards: [{ column: "Νέο", text: "x" }] });
  assert.match(r.err, /Column not found on "Βιβλία": "Νέο".*Its columns: Αναμονή, Έγινε\./);
  // add_columns: after a new column of the same call, and portal steps on it
  assert.equal(ok("kanban_add_columns", { board: "Βιβλία", columns: [{ name: "Α" }, { name: "Β", after: "Α" }], portal_columns: [{ column: "Β", step: true }] }), null);
  assert.match(ok("kanban_add_columns", { board: "Βιβλία", rename_columns: [{ column: "Χ", name: "Ψ" }] }).err, /Column not found/);
  // no board list in the copy (an older orOS): nothing is checked
  assert.equal(G.kbClosedCheck("kanban_add_cards", { board: "Babyland" }, null, [], "W"), null);
});

test("kbClosedCheck: boards and columns waiting in the queue count; a waiting board is not asked twice", () => {
  const q = [{ id: "Q1", kb: "Babyland", add: 1, cols: ["Νέο", "Έγινε"], ren: [] },
             { id: "Q2", kb: "babyland", cols: ["Περιμένει Chris"], ren: [["Νέο", "Νέα"]] },
             { id: "Q3", kb: "Βιβλία", cols: ["Έλεγχος"], ren: [] }];
  const ck = (n, a) => G.kbClosedCheck(n, a, LIST(), q, "W");
  assert.equal(ck("kanban_add_cards", { board: "BABYLAND", cards: [{ column: "Νέο", text: "a" }, { column: "περιμενει chris", text: "b" }, { column: "Νέα", text: "c" }] }), null);
  assert.equal(ck("kanban_move_cards", { board: "b1", moves: [{ card: "k", column: "Έλεγχος" }] }), null, "by board id, a column waiting on it");
  assert.match(ck("kanban_add_cards", { board: "Babyland", cards: [{ column: "Άλλη", text: "a" }] }).err, /Column not found on "Babyland"/);
  const d = ck("kanban_add_board", { name: " babyland ", columns: [{ name: "Νέο" }] });
  assert.deepEqual([d.dup.already_waiting, d.dup.change_id, d.dup.board], [true, "Q1", "Babyland"]);
  assert.match(ck("kanban_add_board", { name: "ΒΙΒΛΙΑ", columns: [{ name: "x" }] }).err, /already there \(id b1/);
  assert.match(ck("kanban_add_board", { name: "Παλιό", columns: [{ name: "x" }] }).err, /archived/);
  assert.equal(ck("kanban_add_board", { name: "Noxpress", columns: [{ name: "x" }] }), null);
  assert.match(G.kbClosedCheck("kanban_add_cards", { board: "Noxpress" }, LIST(), q, "W").err, /Babyland \(waiting to be made\)/);
});

test("kbClosedList / kbNameHits / pendSum / copyWhen", () => {
  const q = [{ id: "Q1", kb: "Babyland", add: 1, cols: ["Νέο"], ren: [] }, { id: "Q2", kb: "Βιβλία", cols: ["Έλεγχος"], ren: [["Αναμονή", "Σε αναμονή"]] }];
  const l = G.kbClosedList(LIST(), q, "");
  assert.deepEqual(l.boards.map((b) => b.name), ["Βιβλία", "Μουσική", "Babyland"]);
  assert.equal(l.boards[2].pending, true);
  assert.equal(l.boards[2].change_id, "Q1");
  assert.deepEqual(l.boards[0].columns.map((c) => c.name), ["Αναμονή", "Έγινε", "Έλεγχος"]);
  assert.deepEqual(l.boards[0].waiting_renames, [{ column: "Αναμονή", to: "Σε αναμονή", change_id: "Q2" }]);
  assert.deepEqual(l.archived_boards, ["Παλιό"]);
  assert.deepEqual(G.kbClosedList(LIST(), q, "baby").boards.map((b) => b.name), ["Babyland"]);
  assert.match(G.kbClosedList(LIST(), [], "zzz").note, /No board's name holds/);
  const h = G.kbNameHits(LIST(), q, ["αναμονη"]);
  assert.deepEqual(h.map((x) => [x.kind, x.board, x.column || ""]), [["column", "Βιβλία", "Αναμονή"]]);
  assert.deepEqual(G.kbNameHits(LIST(), q, ["baby"]).map((x) => [x.kind, x.pending]), [["board", true]]);
  assert.deepEqual(G.kbNameHits(LIST(), q, ["παλιο"]).map((x) => x.archived), [true]);
  assert.match(G.pendSum("kanban_add_cards", { board: "Βιβλία", cards: [{ column: "Α", text: "one", key: "rc-1" }, { column: "Α", text: "two" }] }), /^add 2 card\(s\) on Βιβλία: one \[rc-1\]; two$/);
  assert.match(G.pendSum("kanban_add_board", { name: "orOS", columns: [{ name: "Νέο" }, { name: "Έγινε" }] }), /^make board orOS \(Νέο; Έγινε\)$/);
  assert.match(G.pendSum("kanban_add_columns", { board: "B", columns: [{ name: "X" }], rename_columns: [{ column: "Y", name: "Z" }] }), /add X, rename Y → Z/);
  assert.equal(G.pendSum("change_item", { ref: "r1" }), "");
  const T = Date.UTC(2026, 10, 23, 9, 7);
  assert.equal(G.copyWhen(T, T + 34 * 60000), "2026-11-23T09:07:00.000Z, 34 min old");
  assert.equal(G.ageText(30000), "under a minute");
  assert.equal(G.ageText(5 * 3600000), "5 h");
  assert.equal(G.ageText(3 * 86400000), "3 days");
  const hd = G.pendHead("kanban_add_board", { name: "orOS", columns: [{ name: "Νέο" }] }, 1);
  assert.deepEqual(hd.f, { kb: "orOS", add: 1, cols: ["Νέο"] });
  assert.match(hd.a.sum, /make board orOS/);
  const hc = G.pendHead("kanban_add_cards", { board: "orOS", cards: [{ column: "Νέο", text: "x" }] }, 1);
  assert.equal(hc.a.kb, "orOS");
  assert.equal(hc.f, undefined);
});

test("closedHist: app / from / to over the copy's list", () => {
  const list = [{ when: "2026-11-23 10:00", app: "kanban", what: "add", items: ["a"] }, { when: "2026-11-22 09:00", app: "kanban", what: "change", items: ["b"] },
                { when: "2026-11-20 08:00", app: "todo", what: "add", items: ["c"] }];
  const cp = { ans: { __hist: JSON.stringify(list) } };
  const get = (a) => JSON.parse(G.closedHist(cp, a, "W").c.split("\n")[1]);
  assert.deepEqual(get({ app: "kanban", from: "2026-11-22" }).changes.map((x) => x.items[0]), ["a", "b"]);
  assert.deepEqual(get({ to: "2026-11-21" }).changes.map((x) => x.items[0]), ["c"]);
  assert.deepEqual(get({ app: "kanban", from: "2026-11-22" }).filters, { app: "kanban", from: "2026-11-22" });
  assert.match(get({ app: "notes" }).note, /Nothing matched/);
  assert.equal(G.closedHist(cp, { from: "22/11" }, "W").ok, false);
  assert.equal(G.closedHist(cp, { from: "2026-11-23", to: "2026-11-01" }, "W").ok, false);
  assert.equal(G.closedHist({ ans: { __hist: "x" } }, {}, "W"), null);
});

test("summary: boards_only lists boards, columns with ids, labels, no cards; name hits", () => {
  const T0 = 1760000000000;
  const raw = { ver: 5, om: 1, boardDeleted: { gone: T0 + 5 }, boards: [
    { id: "b1", name: "Βιβλία", mtime: T0, deleted: { l2: T0 + 1 }, labels: [{ id: "l1", name: "Παιδικά", mtime: T0 }, { id: "l2", name: "Σβησμένη", mtime: T0 }],
      columns: [{ id: "c1", name: "Αναμονή", cards: [{ id: "k1", text: "Η Κατερίνα" }, { id: "k2", text: "x" }] }, { id: "c2", name: "Έγινε", cards: [] }] },
    { id: "b2", name: "Παλιό", archived: true, mtime: T0, columns: [] },
    { id: "tpl-1", name: "Πρότυπο", archived: true, mtime: T0, columns: [] },
    { id: "gone", name: "Σβησμένο", mtime: T0, columns: [] }
  ] };
  const o = S.kanbanBoards(raw, { boardsOnly: true, today: "2026-11-23" });
  assert.equal(o.items, undefined);
  assert.deepEqual(o.boards, [{ name: "Βιβλία", id: "b1", cards: 2, columns: [{ name: "Αναμονή", id: "c1", cards: 2 }, { name: "Έγινε", id: "c2", cards: 0 }], labels: ["Παιδικά"] }]);
  assert.deepEqual(o.archived_boards, ["Παλιό"]);
  assert.deepEqual(S.kanbanBoards(raw, { boardsOnly: true, board: "βιβλ" }).boards.map((b) => b.id), ["b1"]);
  assert.match(S.kanbanBoards(raw, { boardsOnly: true, board: "zzz" }).note, /No open board/);
  assert.deepEqual(S.kanbanNameHits(raw, "εγινε").map((x) => [x.kind, x.column, x.board_id]), [["column", "Έγινε", "b1"]]);
  assert.deepEqual(S.kanbanNameHits(raw, "παλιο").map((x) => [x.kind, x.archived]), [["board", true]]);
  assert.deepEqual(S.kanbanNameHits(raw, "πρότυπο"), [], "templates stay out");
  assert.deepEqual(S.kanbanNameHits(raw, ""), []);
});

test("relay with orOS closed: refused, deduplicated, listed, found, aged, history filtered", async () => {
  const w = world();
  await newGate(w);
  const b = w.boxes.get(ID);
  const K = crypto.randomBytes(32), KS = b64u(K);
  const sock = { sent: [], closed: false, __g: { th: hex(TOK), v: 1, at: 1 }, send(x) { this.sent.push(x); const q = JSON.parse(x); if (q.q && q.n === "_key") setTimeout(() => b.box.webSocketMessage(sock, JSON.stringify({ r: q.q, ok: true, c: KS })), 1); }, close() {} };
  b.socks.push(sock);
  const t = await tokens(w);
  await b.st.storage.put("devtools", [{ name: "change_history", description: "h", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } }]);
  const hist = [{ when: "2001-09-09 01:00", app: "kanban", what: "add", items: ["a"] }, { when: "2001-09-01 01:00", app: "todo", what: "add", items: ["b"] }];
  const copy = { at: 1e12 - 34 * 60000, lv: { kanban: "write", todo: "write" }, hold: 0,
                 ans: { __index: JSON.stringify([{ r: "r1", a: "kanban", t: "Κάρτα" }]), [G.KB_LIST_KEY]: JSON.stringify(BOARDS), __hist: JSON.stringify(hist), 'change_history {}': '{"changes":[]}' } };
  await b.box.webSocketMessage(sock, JSON.stringify({ snap: await G.sealText(K, JSON.stringify(copy)) }));
  sock.closed = true;
  const tc = async (name, args) => (await (await rpc(w, t.access_token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } })).json()).result;
  let r = await tc("kanban_add_columns", { board: "Babyland", columns: [{ name: "Νέο" }] });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /Board not found.*copy of .*, 34 min old/);
  assert.equal((await b.st.storage.list({ prefix: "q:" })).size, 0, "nothing queued");
  r = await tc("kanban_add_board", { name: "Babyland", columns: [{ name: "Νέο" }, { name: "Έγινε" }] });
  assert.match(r.content[0].text, /"queued":true/);
  const first = JSON.parse(r.content[0].text).change_id;
  r = await tc("kanban_add_board", { name: "BABYLAND", columns: [{ name: "Νέο" }] });
  assert.equal(r.isError, false);
  assert.deepEqual([JSON.parse(r.content[0].text).already_waiting, JSON.parse(r.content[0].text).change_id], [true, first]);
  assert.equal((await b.st.storage.list({ prefix: "q:" })).size, 1, "no second board waits");
  assert.match((await tc("kanban_add_cards", { board: "babyland", cards: [{ column: "Νέο", text: "Εύρημα 1" }] })).content[0].text, /"queued":true/);
  assert.match((await tc("kanban_add_cards", { board: "Babyland", cards: [{ column: "Άλλη", text: "x" }] })).content[0].text, /Column not found/);
  // boards_only from the copy and the queue
  r = await tc("app_summary", { app: "kanban", boards_only: true });
  assert.match(r.content[0].text, /^\[orOS is closed: this is the copy of .*34 min old\]\n/);
  const lst = JSON.parse(r.content[0].text.split("\n")[1]);
  assert.deepEqual(lst.boards.map((x) => x.name), ["Βιβλία", "Μουσική", "Babyland"]);
  // the waiting changes say what they target
  assert.match(r.content[0].text, /"tool":"kanban_add_board","app":"kanban","summary":"make board Babyland \(Νέο; Έγινε\)"/);
  assert.match(r.content[0].text, /"board":"babyland","summary":"add 1 card\(s\) on babyland: Εύρημα 1"/);
  // search_data finds boards (and the one waiting)
  r = await tc("search_data", { query: "babyland" });
  assert.deepEqual(JSON.parse(r.content[0].text.split("\n")[1]).kanban_boards.map((x) => [x.kind, x.board, !!x.pending]), [["board", "Babyland", true]]);
  r = await tc("search_data", { query: "ιδεες" });
  assert.deepEqual(JSON.parse(r.content[0].text.split("\n")[1]).kanban_boards.map((x) => [x.kind, x.column]), [["column", "Ιδέες"]]);
  // change_history's filters on the copy
  r = await tc("change_history", { app: "kanban", from: "2001-09-05" });
  assert.match(r.content[0].text, /"filters":\{"app":"kanban","from":"2001-09-05"\}/);
  assert.deepEqual(JSON.parse(r.content[0].text.split("\n")[1]).changes.map((x) => x.items[0]), ["a"]);
});
