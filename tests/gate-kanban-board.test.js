// KB-BOARD (Chris 2026-11-23, card «Νέο εργαλείο Gate»): kanban_add_board
// makes a new board with its columns through the Gate and the Assistant;
// one board per name; Undo takes it away only while it is as made.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
global.window = global.window || {};
const G = require("../gate/gate.js");
const M = require("../kanban/model.js");
const C = require("../assistant/core.js");

const T0 = 1760000000000, NOW = T0 + 1000;
function data() {
  return M.canonState({
    ver: 5, om: 1, boardDeleted: { gone: T0 + 5 },
    boards: [
      { id: "b1", name: "Βιβλία", mtime: T0, om: T0, deleted: {}, labels: [], columns: [{ id: "c1", name: "Αναμονή", mtime: T0, om: T0, cards: [] }] },
      { id: "b2", name: "Παλιό", archived: true, mtime: T0, deleted: {}, labels: [], columns: [] },
      { id: "tpl-x", name: "Πρότυπο", archived: true, mtime: T0, deleted: {}, labels: [], columns: [] },
      { id: "gone", name: "Σβησμένο", mtime: T0, deleted: {}, labels: [], columns: [] }
    ]
  }, T0);
}
let n = 0;
const nid = () => "nb" + (++n);
const COLS = [{ name: "Νέο" }, { name: "Σε εξέλιξη" }, { name: "Περιμένει Chris" }, { name: "Έγινε" }];

test("makes the board with its columns in order, fresh stamps, input untouched", () => {
  const raw = data(), before = JSON.stringify(raw);
  const r = G.kanbanWrite(M, "add_board", raw, { name: "  orOS ", columns: COLS }, NOW, nid);
  assert.equal(r.ok, true, r.err);
  assert.equal(JSON.stringify(raw), before);
  const b = r.data.boards.find((x) => x.name === "orOS");
  assert.ok(b);
  assert.equal(r.ids[0], b.id);
  assert.deepEqual(b.columns.map((c) => c.name), COLS.map((c) => c.name));
  assert.deepEqual(r.ids.slice(1), b.columns.map((c) => c.id));
  assert.equal(b.mtime, NOW);
  assert.equal(b.archived, false);
  assert.ok(b.columns.every((c) => c.mtime === NOW && c.cards.length === 0));
  assert.equal(r.data.om, NOW);
  assert.match(r.text, /Made the board "orOS"/);
  // cards then go to it by name
  const c = G.kanbanWrite(M, "add_cards", r.data, { board: "OROS", cards: [{ column: "Νέο", text: "Audit #1: κάτι" }] }, NOW + 1, nid);
  assert.equal(c.ok, true, c.err);
  // and it survives a merge with an older copy (a device that never saw it)
  const merged = M.mergeKanbanStates(raw, r.data, NOW + 2);
  assert.ok(merged.boards.some((x) => x.id === b.id));
});

test("works with no Kanban data yet", () => {
  const r = G.kanbanWrite(M, "add_board", null, { name: "Πρώτος", columns: [{ name: "Α" }] }, NOW, nid);
  assert.equal(r.ok, true, r.err);
  assert.equal(r.data.boards.length, 1);
});

test("one board per name: an open or archived board refuses; a deleted one or a template does not", () => {
  for (const name of ["βιβλια", "ΠΑΛΙΟ"]) {
    const r = G.kanbanWrite(M, "add_board", data(), { name, columns: COLS }, NOW, nid);
    assert.equal(r.ok, false, name);
    assert.match(r.err, /already there/);
  }
  assert.match(G.kanbanWrite(M, "add_board", data(), { name: "Παλιό", columns: COLS }, NOW, nid).err, /archived/);
  assert.equal(G.kanbanWrite(M, "add_board", data(), { name: "Σβησμένο", columns: COLS }, NOW, nid).ok, true);
  assert.equal(G.kanbanWrite(M, "add_board", data(), { name: "Πρότυπο", columns: COLS }, NOW, nid).ok, true);
});

test("bad calls change nothing", () => {
  const bad = [
    {}, { name: "", columns: COLS }, { name: "x".repeat(61), columns: COLS }, { name: "A" }, { name: "A", columns: [] },
    { name: "A", columns: Array.from({ length: 21 }, (v, i) => ({ name: "c" + i })) }, { name: "A", columns: [{ name: "" }] },
    { name: "A", columns: [{ name: "Νέο" }, { name: "νεο" }] }, { name: "A", columns: [{ name: "y".repeat(61) }] }
  ];
  bad.forEach((a, i) => assert.equal(G.kanbanWrite(M, "add_board", data(), a, NOW, nid).ok, false, "case " + i));
});

test("undo takes the board away while it is as made, with a tombstone that beats the copies", () => {
  const r = G.kanbanWrite(M, "add_board", data(), { name: "orOS", columns: COLS }, NOW, nid);
  const u = G.kanbanUndo(M, r.data, r.undo, NOW + 10);
  assert.equal(u.ok, true);
  assert.deepEqual([u.n, u.kept], [1, 0]);
  assert.ok(!u.data.boards.some((x) => x.id === r.ids[0]));
  assert.ok(u.data.boardDeleted[r.ids[0]] >= NOW + 10);
  const merged = M.mergeKanbanStates(r.data, u.data, NOW + 20);
  assert.ok(!merged.boards.some((x) => x.id === r.ids[0]), "a device that still has it does not bring it back");
  // gone already: nothing to do
  assert.deepEqual([G.kanbanUndo(M, u.data, r.undo, NOW + 30).n, G.kanbanUndo(M, u.data, r.undo, NOW + 30).kept], [0, 0]);
});

test("undo keeps a board the owner (or a routine) used since", () => {
  const r = G.kanbanWrite(M, "add_board", data(), { name: "orOS", columns: COLS }, NOW, nid);
  const withCard = G.kanbanWrite(M, "add_cards", r.data, { board: r.ids[0], cards: [{ column: "Νέο", text: "x" }] }, NOW + 1, nid);
  const withCol = G.kanbanWrite(M, "add_columns", r.data, { board: r.ids[0], columns: [{ name: "Άλλη" }] }, NOW + 1, nid);
  const renamed = G.kanbanWrite(M, "add_columns", r.data, { board: r.ids[0], rename_columns: [{ column: "Νέο", name: "Νέα" }] }, NOW + 1, nid);
  const boardRenamed = JSON.parse(JSON.stringify(r.data));
  boardRenamed.boards.find((x) => x.id === r.ids[0]).mtime = NOW + 5;
  for (const [what, d] of [["a card", withCard.data], ["a column", withCol.data], ["a renamed column", renamed.data], ["a renamed board", boardRenamed]]) {
    const u = G.kanbanUndo(M, d, r.undo, NOW + 10);
    assert.deepEqual([u.n, u.kept], [0, 1], what);
    assert.ok(u.data.boards.some((x) => x.id === r.ids[0]), what);
  }
});

test("the Gate offers it, queues it with orOS closed, and the Assistant has its twin", async () => {
  assert.ok(G.WRITES.kanban.indexOf("kanban_add_board") >= 0);
  assert.ok(G.QUEUED.indexOf("kanban_add_board") >= 0);
  const R = await import("../relay/gate.js");
  const t = R.TOOLS.find((x) => x.name === "kanban_add_board");
  assert.ok(t);
  assert.deepEqual(t.inputSchema.required, ["name", "columns"]);
  assert.equal(t.inputSchema.properties.columns.maxItems, 20);
  assert.equal(t.annotations.readOnlyHint, false);
  assert.equal(R.isDeletion("kanban_add_board", { name: "x", columns: COLS }), false);
  assert.equal(R.pendApp("kanban_add_board", { name: "x" }), "kanban");
  const a = C.toolsFor({ kbCols: 1 }).find((x) => x.name === "kanban_add_board");
  assert.ok(a, "the Assistant offers kanban_add_board with Kanban at «may change»");
  assert.deepEqual(Object.keys(a.params.properties).sort(), Object.keys(t.inputSchema.properties).sort());
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "assistant", "assistant.js"), "utf8");
  assert.match(src, /call\.name === "kanban_add_board"\) return kanbanColumns\(c, call\.args, apps, "add_board"\)/);
});
