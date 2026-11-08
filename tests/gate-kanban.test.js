// orOS Gate: changes to Kanban (kanbanWrite / kanbanUndo in gate.js)
// with Kanban's own sync model: field stamps, column order stamps,
// tombstones, all-or-none, and an Undo that keeps later edits.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../gate/gate.js");
const M = require("../kanban/model.js");

const T0 = 1760000000000, NOW = T0 + 1000;
function data() {
  return M.canonState({
    ver: 5, om: 1, boardDeleted: {},
    boards: [
      { id: "b1", name: "Βιβλία", mtime: T0, om: T0, deleted: {},
        labels: [{ id: "l1", name: "Blue", color: "blue", mtime: T0 }, { id: "l2", name: "Επείγον", color: "red", mtime: T0 }],
        columns: [
          { id: "c1", name: "Αναμονή", mtime: T0, om: T0, cards: [
            { id: "k1", text: "Ο Ψίθυρος", notes: "", due: null, labels: [], subtasks: [], info: [], mtime: T0 },
            { id: "k2", text: "Άμμος", notes: "n", due: "2026-12-01", labels: ["l1"], subtasks: [], info: [], mtime: T0 }] },
          { id: "c2", name: "Επιμέλεια", mtime: T0, om: T0, cards: [] },
          { id: "c3", name: "Σελιδοποίηση", mtime: T0, om: T0, cards: [] }] },
      { id: "tpl-x", name: "Template", archived: true, mtime: T0, deleted: {}, labels: [], columns: [] },
      { id: "b2", name: "Old", archived: true, mtime: T0, deleted: {}, labels: [], columns: [] }
    ]
  }, T0);
}
let n = 0;
const nid = () => "new" + (++n);
const col = (d, id) => d.boards[0].columns.find((c) => c.id === id);
const cardIn = (d, cid) => col(d, cid).cards.map((k) => k.id);

test("WRITES offers the Kanban tools; templates and archived boards are refused", () => {
  assert.deepEqual(G.WRITES.kanban, ["kanban_add_cards", "kanban_move_cards", "kanban_change_card", "kanban_add_columns"]);
  assert.equal(G.canWrite({ kanban: "write" }, NOW + 1, "kanban", NOW), true);
  assert.equal(G.canWrite({ kanban: "read" }, NOW + 1, "kanban", NOW), false);
  for (const b of ["Template", "Old", "tpl-x", "Nope"]) {
    const r = G.kanbanWrite(M, "add_cards", data(), { board: b, cards: [{ column: "x", text: "y" }] }, NOW, nid);
    assert.equal(r.ok, false, b);
  }
});

test("add cards: by column name, labels by name, top/bottom, stamps, all or none", () => {
  const raw = data(), before = JSON.stringify(raw);
  const r = G.kanbanWrite(M, "add_cards", raw, { board: "βιβλια", cards: [
    { column: "Επιμέλεια", text: "  Νέο   βιβλίο ", due: "2027-01-15", labels: ["επειγον"] },
    { column: "c1", text: "Πρώτη", position: "top" }] }, NOW, nid);
  assert.equal(r.ok, true, r.err);
  assert.equal(JSON.stringify(raw), before, "the input is never touched");
  const [a, b] = r.ids;
  const k = col(r.data, "c2").cards[0];
  assert.deepEqual([k.id, k.text, k.due, k.labels], [a, "Νέο βιβλίο", "2027-01-15", ["l2"]]);
  assert.equal(k.fm.m, NOW);
  assert.equal(col(r.data, "c1").cards[0].id, b);
  assert.equal(col(r.data, "c1").om, NOW);
  assert.equal(col(r.data, "c3").om, T0);
  // one bad card: nothing at all
  const bad = G.kanbanWrite(M, "add_cards", raw, { board: "b1", cards: [{ column: "c1", text: "ok" }, { column: "c1", text: "x", labels: ["Green"] }] }, NOW, nid);
  assert.equal(bad.ok, false);
  assert.match(bad.err, /Card 2: No label "Green"/);
  assert.equal(G.kanbanWrite(M, "add_cards", raw, { board: "b1", cards: [{ column: "c1", text: "   " }] }, NOW, nid).ok, false);
  assert.equal(G.kanbanWrite(M, "add_cards", raw, { board: "b1", cards: [{ column: "c1", text: "x", due: "2027-13-45" }] }, NOW, nid).ok, false);
});

test("move cards: placement stamp, both columns' order stamps, merge keeps the move", () => {
  const raw = data();
  const r = G.kanbanWrite(M, "move_cards", raw, { board: "b1", moves: [{ card: "k1", column: "Επιμέλεια" }, { card: "k2", column: "c3", position: "top" }] }, NOW, nid);
  assert.equal(r.ok, true, r.err);
  assert.deepEqual([cardIn(r.data, "c1"), cardIn(r.data, "c2"), cardIn(r.data, "c3")], [[], ["k1"], ["k2"]]);
  const k1 = col(r.data, "c2").cards[0];
  assert.equal(k1.fm.p, NOW);
  assert.equal(k1.fm.t, T0, "only the placement group moves on");
  // another device that still has the old board: the move wins the merge
  const merged = M.mergeKanbanStates(raw, r.data, NOW + 5);
  assert.deepEqual([cardIn(merged, "c1"), cardIn(merged, "c2")], [[], ["k1"]]);
  assert.equal(G.kanbanWrite(M, "move_cards", raw, { board: "b1", moves: [{ card: "k1", column: "c1" }] }, NOW, nid).ok, false, "already there");
  assert.equal(G.kanbanWrite(M, "move_cards", raw, { board: "b1", moves: [{ card: "k1", column: "c2" }, { card: "k1", column: "c3" }] }, NOW, nid).ok, false, "twice");
  assert.equal(G.kanbanWrite(M, "move_cards", raw, { board: "b1", moves: [{ card: "zz", column: "c2" }] }, NOW, nid).ok, false);
});

test("change a card: only the changed groups, labels replaced, due cleared, nothing-to-do refused", () => {
  const raw = data();
  const r = G.kanbanWrite(M, "change_card", raw, { board: "b1", card: "k2", due: "", labels: ["Blue", "Επείγον"] }, NOW, nid);
  assert.equal(r.ok, true, r.err);
  const k2 = col(r.data, "c1").cards[1];
  assert.deepEqual([k2.due, k2.labels, k2.notes], [null, ["l1", "l2"], "n"]);
  assert.equal(k2.fm.d, NOW); assert.equal(k2.fm.l, NOW); assert.equal(k2.fm.n, T0);
  assert.equal(G.kanbanWrite(M, "change_card", raw, { board: "b1", card: "k2", text: "Άμμος" }, NOW, nid).ok, false);
});

test("add columns: at the end or after one, board order stamp", () => {
  const r = G.kanbanWrite(M, "add_columns", data(), { board: "b1", columns: [{ name: "Unboxing", after: "Αναμονή" }, { name: "Κυκλοφορία" }] }, NOW, nid);
  assert.equal(r.ok, true, r.err);
  assert.deepEqual(r.data.boards[0].columns.map((c) => c.name), ["Αναμονή", "Unboxing", "Επιμέλεια", "Σελιδοποίηση", "Κυκλοφορία"]);
  assert.equal(r.data.boards[0].om, NOW);
});

test("undo: puts back moves, edits, new cards and empty new columns; keeps what changed since", () => {
  const base = data();
  const mv = G.kanbanWrite(M, "move_cards", base, { board: "b1", moves: [{ card: "k1", column: "c2" }, { card: "k2", column: "c3" }] }, NOW, nid);
  // the owner edits k2 after Claude moved it: that one is kept
  const later = JSON.parse(JSON.stringify(mv.data));
  M.stampCard(col(later, "c3").cards[0], ["t"], NOW + 50);
  col(later, "c3").cards[0].text = "Άμμος 2";
  const u = G.kanbanUndo(M, later, mv.undo, NOW + 100);
  assert.equal(u.ok, true);
  assert.deepEqual([u.n, u.kept], [1, 1]);
  assert.deepEqual(cardIn(u.data, "c1"), ["k1"]);
  assert.deepEqual(cardIn(u.data, "c3"), ["k2"]);
  assert.equal(M.mergeKanbanStates(mv.data, u.data, NOW + 200).boards[0].columns[0].cards[0].id, "k1", "the undo wins the merge");

  const ch = G.kanbanWrite(M, "change_card", base, { board: "b1", card: "k2", text: "Νέο" }, NOW, nid);
  const u2 = G.kanbanUndo(M, ch.data, ch.undo, NOW + 100);
  assert.equal(col(u2.data, "c1").cards[1].text, "Άμμος");

  const ad = G.kanbanWrite(M, "add_cards", base, { board: "b1", cards: [{ column: "c2", text: "temp" }] }, NOW, nid);
  const u3 = G.kanbanUndo(M, ad.data, ad.undo, NOW + 100);
  assert.deepEqual(cardIn(u3.data, "c2"), []);
  assert.ok(u3.data.boards[0].deleted[ad.ids[0]] > NOW, "a tombstone so other devices drop it too");
  assert.deepEqual(cardIn(M.mergeKanbanStates(ad.data, u3.data, NOW + 200), "c2"), []);

  const ac = G.kanbanWrite(M, "add_columns", base, { board: "b1", columns: [{ name: "A" }, { name: "B" }] }, NOW, nid);
  const withCard = G.kanbanWrite(M, "add_cards", ac.data, { board: "b1", cards: [{ column: "B", text: "keep me" }] }, NOW + 10, nid);
  const u4 = G.kanbanUndo(M, withCard.data, ac.undo, NOW + 100);
  assert.deepEqual([u4.n, u4.kept], [1, 1], "a column that got a card stays");
  assert.deepEqual(u4.data.boards[0].columns.map((c) => c.name), ["Αναμονή", "Επιμέλεια", "Σελιδοποίηση", "B"]);
});
