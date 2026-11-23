// KB-PREF, KB-NOBOARD, GL-NEW (Chris 2026-11-23, round 2 of the
// Kanban/Gate gaps from Noxpress, koulaxizis.gr and NULL JSFX): with orOS
// closed a new board, its columns and new cards get p- refs at once that
// the other kanban_* tools take; app_summary for a board the copy does not
// have says so with the boards; the instructions name the newest tools.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
global.window = global.window || {};
const GD = require("../gate/gate.js");
const M = require("../kanban/model.js");
let G;
test.before(async () => { G = await import("../relay/gate.js"); });

const Q = "AbW0jkB_P2bjo402", Q2 = "s0utuT3ZOQiENE4P";
const LIST = () => ({ boards: [{ name: "Βιβλία", id: "b1", cards: 2, columns: [{ name: "Αναμονή", id: "c1", cards: 2 }] }], archived: ["Παλιό"] });
const QUEUE = () => [{ id: Q, kb: "orOS", add: 1, cols: ["Νέο", "Σε εξέλιξη", "Έγινε"], ren: [] }, { id: Q2, kb: "Βιβλία", cols: ["Έλεγχος"], ren: [] }];

test("a queued add answers with p- refs: board .0 and columns .1…, added columns .0…, cards by position", () => {
  const b = G.kbQueuedRefs("kanban_add_board", { name: "orOS", columns: [{ name: "Νέο" }, { name: "Έγινε" }] }, Q);
  assert.deepEqual(b, { ref: "p-" + Q + ".0", columns: [{ name: "Νέο", ref: "p-" + Q + ".1" }, { name: "Έγινε", ref: "p-" + Q + ".2" }] });
  assert.deepEqual(G.kbQueuedRefs("kanban_add_columns", { board: "Βιβλία", columns: [{ name: "Έλεγχος" }] }, Q2).columns, [{ name: "Έλεγχος", ref: "p-" + Q2 + ".0" }]);
  assert.deepEqual(G.kbQueuedRefs("kanban_add_cards", { board: "orOS", cards: [{ column: "Νέο", text: "a", key: "rc-1" }, { column: "Νέο", text: "b" }] }, Q).refs,
    [{ ref: "p-" + Q + ".0", text: "a", key: "rc-1" }, { ref: "p-" + Q + ".1", text: "b" }]);
  assert.deepEqual(G.kbQueuedRefs("kanban_move_cards", {}, Q), {});
  // every ref the relay gives fits the device's pattern
  [b.ref].concat(b.columns.map((c) => c.ref)).forEach((r) => assert.match(r, GD.P_REF));
  // the waiting board in boards_only and in a second add of the same name carries them
  const l = G.kbClosedList(LIST(), QUEUE(), "oros");
  assert.equal(l.boards[0].ref, "p-" + Q + ".0");
  assert.deepEqual(l.boards[0].columns.map((c) => c.ref), [1, 2, 3].map((i) => "p-" + Q + "." + i));
  const d = G.kbClosedCheck("kanban_add_board", { name: "OROS", columns: [{ name: "x" }] }, LIST(), QUEUE(), "W");
  assert.equal(d.dup.ref, "p-" + Q + ".0");
  assert.equal(d.dup.columns[0].ref, "p-" + Q + ".1");
  assert.equal(G.kbClosedList(LIST(), QUEUE(), "βιβλ").boards[0].columns[1].ref, "p-" + Q2 + ".0");
});

test("closed checks take p- refs as board and column", () => {
  const ck = (n, a) => G.kbClosedCheck(n, a, LIST(), QUEUE(), "W");
  assert.equal(ck("kanban_add_cards", { board: "p-" + Q + ".0", cards: [{ column: "p-" + Q + ".2", text: "a" }, { column: "Έγινε", text: "b" }] }), null);
  assert.equal(ck("kanban_move_cards", { board: "b1", moves: [{ card: "k", column: "p-" + Q2 + ".0" }] }), null, "a waiting added column");
  assert.match(ck("kanban_add_cards", { board: "p-" + Q + ".0", cards: [{ column: "p-" + Q + ".9", text: "a" }] }).err, /Column not found on "orOS"/);
  assert.match(ck("kanban_add_cards", { board: "p-" + Q2 + ".0", cards: [] }).err, /not a board's ref/);
  assert.match(ck("kanban_add_cards", { board: "p-" + Q + ".1", cards: [] }).err, /not a board's ref/);
  // a ref whose add is no longer waiting (applied, the copy older): left to the device
  assert.equal(ck("kanban_add_cards", { board: "p-ZZZZZZZZZZZZZZZZ.0", cards: [{ column: "Νέο", text: "a" }] }), null);
  assert.equal(ck("kanban_add_cards", { board: "Βιβλία", cards: [{ column: "p-ZZZZZZZZZZZZZZZZ.3", text: "a" }] }), null);
  // only an orOS that maps them gets such a call
  assert.equal(G.minVer("kanban_add_cards", { board: "p-" + Q + ".0", cards: [] }), G.KB_PREF_MV);
  assert.equal(G.minVer("kanban_move_cards", { board: "orOS", moves: [{ card: "p-" + Q + ".4", column: "Έγινε" }] }), G.KB_PREF_MV);
  assert.equal(G.minVer("kanban_add_cards", { board: "orOS", cards: [{ column: "Νέο", text: "p- refs are words here" }] }), 0);
});

test("the device: an applied add records its ids by position, later calls with its p- refs reach them", () => {
  let n = 0;
  const nid = () => "id" + (++n), T = 1760000000000;
  const r = GD.kanbanWrite(M, "add_board", null, { name: "orOS", columns: [{ name: "Νέο" }, { name: "Έγινε" }] }, T, nid);
  assert.equal(r.ok, true, r.err);
  const made = GD.kbMade("add_board", {}, r);
  assert.deepEqual(made.map((m) => m.i), [0, 1, 2]);
  const rec = {};
  made.forEach((m) => { rec["p-" + Q + "." + m.i] = m.rec; });
  const find = (ref) => rec[ref] || null;
  const mp = GD.kbMapP({ board: "p-" + Q + ".0", cards: [{ column: "p-" + Q + ".2", text: "Audit #1", key: "rc-1" }, { column: "Νέο", text: "two" }] }, find);
  assert.equal(mp.a.board, r.ids[0]);
  assert.equal(mp.a.cards[0].column, r.ids[2]);
  assert.equal(mp.a.cards[1].column, "Νέο");
  const c = GD.kanbanWrite(M, "add_cards", r.data, mp.a, T + 1, nid);
  assert.equal(c.ok, true, c.err);
  // cards by position, also when a key repeats in the call
  const c2 = GD.kanbanWrite(M, "add_cards", c.data, { board: r.ids[0], cards: [{ column: "Νέο", text: "x", key: "k" }, { column: "Έγινε", text: "y", key: "k", move: true }, { column: "Νέο", text: "z" }] }, T + 2, nid);
  const m2 = GD.kbMade("add_cards", {}, c2);
  assert.deepEqual(m2.map((m) => m.i), [0, 1, 2]);
  assert.equal(m2[0].rec.kb, m2[1].rec.kb, "the same key: the same card");
  m2.forEach((m) => { rec["p-" + Q2 + "." + m.i] = m.rec; });
  const mv = GD.kbMapP({ board: r.ids[0], moves: [{ card: "p-" + Q2 + ".2", column: "Έγινε" }] }, find);
  assert.equal(GD.kanbanWrite(M, "move_cards", c2.data, mv.a, T + 3, nid).ok, true);
  // added columns: their ids in order; other tools make nothing
  const ac = GD.kanbanWrite(M, "add_columns", c2.data, { board: r.ids[0], columns: [{ name: "Περιμένει Chris" }] }, T + 4, nid);
  assert.equal(GD.kbMade("add_columns", { columns: [{}] }, ac)[0].rec.kb, ac.ids[0]);
  assert.deepEqual(GD.kbMade("add_columns", { rename_columns: [] }, ac), []);
  assert.deepEqual(GD.kbMade("move_cards", {}, ac), []);
  // a ref whose add has not been applied: named, nothing done
  assert.deepEqual(GD.kbMapP({ board: "p-ZZZZZZZZZZZZZZZZ.0" }, find), { miss: ["p-ZZZZZZZZZZZZZZZZ.0"] });
  // the device wires it: kanbanChange maps with pFind and returns made for chgTag
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "gate", "gate.js"), "utf8");
  assert.match(src, /var mp = kbMapP\(args, pFind\);/);
  assert.match(src, /made: made\.length \? made : undefined/);
  assert.match(src, /chgTag\(res\.u, it\.id, at, res\.made\)/);
});

test("app_summary for a board the copy does not have: said plainly, with the boards; a waiting one shown pending", () => {
  const nb = G.kbNoBoard(LIST(), QUEUE(), "Koulaxizis", "W");
  assert.equal(nb.board_found, false);
  assert.match(nb.note, /^No board named "Koulaxizis" in the copy of W, nor one waiting to be made/);
  assert.deepEqual(nb.boards.map((b) => [b.name, !!b.pending]), [["Βιβλία", false], ["orOS", true]]);
  assert.equal(nb.boards[1].ref, "p-" + Q + ".0");
  assert.match(G.kbNoBoard(LIST(), [], "ΠΑΛΙΟ", "W").note, /is archived/);
  const w = G.kbNoBoard(LIST(), QUEUE(), "oros", "W");
  assert.deepEqual([w.board, w.pending, w.cards, w.ref], ["orOS", true, 0, "p-" + Q + ".0"]);
  assert.deepEqual(G.kbNoBoard(LIST(), QUEUE(), "p-" + Q + ".0", "W").board, "orOS");
  assert.equal(G.kbNoBoard(LIST(), QUEUE(), "βιβλια", "W"), null, "the copy has it: answered as before");
  assert.equal(G.kbNoBoard(LIST(), QUEUE(), "b1", "W"), null);
  assert.equal(G.kbNoBoard(null, QUEUE(), "x", "W"), null, "an older copy without the list");
});

test("the instructions name the newest tools and gate_tools / gate_call; each is a real tool", () => {
  const names = new Set(G.TOOLS.map((t) => t.name));
  assert.ok(G.NEW_TOOLS.length >= 1 && G.NEW_TOOLS.length <= 8);
  G.NEW_TOOLS.forEach((n) => { assert.ok(names.has(n), n + " is a gate tool"); assert.ok(G.INSTRUCTIONS.indexOf(n) >= 0, n + " in the instructions"); });
  assert.match(G.INSTRUCTIONS, /gate_tools shows it and gate_call runs it by name/);
  assert.match(G.INSTRUCTIONS, /p- refs at once too/);
  assert.match(G.TOOLS.find((t) => t.name === "kanban_add_board").description, /with orOS closed, p- refs/);
});

test("undo_change of a waiting board takes the calls on its p- refs with it (Mail-thread review)", () => {
  const B = "AAAAAAAAAAAAAAAA", C = "BBBBBBBBBBBBBBBB", D = "CCCCCCCCCCCCCCCC", E = "DDDDDDDDDDDDDDDD";
  const rows = [
    { id: B, n: "kanban_add_board", a: G.pendHead("kanban_add_board", { name: "orOS", columns: [{ name: "Νέο" }] }, 1).a, t: 1 },
    { id: C, n: "kanban_add_cards", a: G.pendHead("kanban_add_cards", { board: "p-" + B + ".0", cards: [{ column: "p-" + B + ".1", text: "a" }] }, 2).a, t: 2 },
    { id: D, n: "kanban_move_cards", a: G.pendHead("kanban_move_cards", { board: "Βιβλία", moves: [{ card: "p-" + C + ".0", column: "Έγινε" }] }, 3).a, t: 3 },
    { id: E, n: "kanban_add_cards", a: G.pendHead("kanban_add_cards", { board: "Βιβλία", cards: [{ column: "Νέο", text: "b" }] }, 4).a, t: 4 }
  ];
  assert.deepEqual(rows[1].a.refs, ["p-" + B + ".0", "p-" + B + ".1"]);
  const pend = G.pendingOf(rows, []);
  assert.deepEqual(G.cancelPlan(pend, { ids: [B] }, 10).ids, [B, C, D], "the board, the cards on it, the move of one of them");
  assert.deepEqual(G.cancelPlan(pend, { ids: [E] }, 10).ids, [E]);
  assert.deepEqual(G.kbRefsIn({ board: "x", cards: [{ column: "p-" + B + ".1", text: "p- not a ref" }] }), ["p-" + B + ".1"]);
});
