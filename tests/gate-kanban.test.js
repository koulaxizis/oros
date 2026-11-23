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
  assert.deepEqual(G.WRITES.kanban, ["kanban_add_cards", "kanban_move_cards", "kanban_change_card", "kanban_add_columns", "kanban_add_board"]);
  assert.equal(G.canWrite({ kanban: "write" }, 0, "kanban", NOW), true);
  assert.equal(G.canWrite({ kanban: "read" }, 0, "kanban", NOW), false);
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

// KB-COLREN (Chris 2026-11-21): rename columns through kanban_add_columns.
test("rename columns: by name or id, header stamp wins the merge, undo gives the old name back", () => {
  const base = data();
  const r = G.kanbanWrite(M, "add_columns", base, { board: "Βιβλία", rename_columns: [{ column: "Επιμέλεια", name: "ISBN" }, { column: "c3", name: " Σελίδες " }] }, NOW, nid);
  assert.equal(r.ok, true, r.err);
  assert.deepEqual(r.data.boards[0].columns.map((c) => c.name), ["Αναμονή", "ISBN", "Σελίδες"]);
  assert.deepEqual(r.ids, []);
  assert.equal(r.renamed, 2);
  assert.match(r.text, /Renamed "Επιμέλεια" → "ISBN"/);
  assert.equal(col(r.data, "c2").mtime, NOW);
  assert.equal(r.data.boards[0].om, T0, "no order change");
  assert.equal(M.mergeKanbanStates(base, r.data, NOW + 10).boards[0].columns[1].name, "ISBN", "the rename wins the merge");
  // with adds in the same call
  const both = G.kanbanWrite(M, "add_columns", base, { board: "b1", rename_columns: [{ column: "c2", name: "ISBN" }], columns: [{ name: "Τυπογραφείο" }] }, NOW, nid);
  assert.equal(both.ok, true, both.err);
  assert.deepEqual(both.data.boards[0].columns.map((c) => c.name), ["Αναμονή", "ISBN", "Σελιδοποίηση", "Τυπογραφείο"]);
  // undo
  const u = G.kanbanUndo(M, r.data, r.undo, NOW + 100);
  assert.deepEqual([u.n, u.kept], [2, 0]);
  assert.deepEqual(u.data.boards[0].columns.map((c) => c.name), ["Αναμονή", "Επιμέλεια", "Σελιδοποίηση"]);
  assert.equal(M.mergeKanbanStates(r.data, u.data, NOW + 200).boards[0].columns[1].name, "Επιμέλεια", "the undo wins the merge");
  // a column the owner renamed again since is kept
  const later = JSON.parse(JSON.stringify(r.data));
  col(later, "c2").name = "ISBN & κατάθεση"; col(later, "c2").mtime = NOW + 50;
  const u2 = G.kanbanUndo(M, later, r.undo, NOW + 100);
  assert.deepEqual([u2.n, u2.kept], [1, 1]);
  assert.equal(col(u2.data, "c2").name, "ISBN & κατάθεση");
  // refusals
  const no = (a) => G.kanbanWrite(M, "add_columns", base, Object.assign({ board: "b1" }, a), NOW, nid);
  assert.match(no({}).err, /rename_columns/);
  assert.match(no({ rename_columns: [{ column: "Nope", name: "X" }] }).err, /^rename_columns 1: /);
  assert.match(no({ rename_columns: [{ column: "c2", name: "" }] }).err, /at most 60/);
  assert.match(no({ rename_columns: [{ column: "c2", name: "x".repeat(61) }] }).err, /at most 60/);
  assert.match(no({ rename_columns: [{ column: "c2", name: "αναμονή" }] }).err, /already called "Αναμονή"/);
  assert.match(no({ rename_columns: [{ column: "c2", name: "A" }, { column: "Επιμέλεια", name: "B" }] }).err, /already renamed/);
  assert.match(no({ rename_columns: [{ column: "c2", name: "Επιμέλεια" }] }).err, /^Nothing to change/);
  assert.match(no({ rename_columns: [] }).err, /1 to 20/);
});

// KB-COLAP (Chris 2026-11-22): Author Portal step settings through kanban_add_columns.
test("portal columns: step, finish and texts merge into col.ap, win the merge, undo puts the old setting back", () => {
  const base = data();
  col(base, "c3").ap = { on: 1, n: "Σελίδες", a: "Παλιό" };
  const r = G.kanbanWrite(M, "add_columns", base, { board: "Βιβλία", portal_columns: [
    { column: "Επιμέλεια", step: true, about: "Ο επιμελητής διαβάζει το κείμενό σας.", about_en: "The editor reads your text." },
    { column: "c3", finish: true, about: "" }] }, NOW, nid);
  assert.equal(r.ok, true, r.err);
  assert.deepEqual(col(r.data, "c2").ap, { on: 1, a: "Ο επιμελητής διαβάζει το κείμενό σας.", ae: "The editor reads your text." });
  assert.deepEqual(col(r.data, "c3").ap, { on: 1, e: 1, n: "Σελίδες" }, "keys left out stay, \"\" clears a text");
  assert.equal(col(r.data, "c2").mtime, NOW);
  assert.equal(r.renamed, 2);
  assert.match(r.text, /Author Portal: "Επιμέλεια" \(step\), "Σελιδοποίηση" \(step, finish\)/);
  assert.deepEqual(M.mergeKanbanStates(base, r.data, NOW + 10).boards[0].columns[1].ap, col(r.data, "c2").ap, "wins the merge");
  // step false keeps the texts
  const off = G.kanbanWrite(M, "add_columns", r.data, { board: "b1", portal_columns: [{ column: "c2", step: false }] }, NOW + 5, nid);
  assert.equal(off.ok, true, off.err);
  assert.deepEqual(col(off.data, "c2").ap, { on: 0, a: "Ο επιμελητής διαβάζει το κείμενό σας.", ae: "The editor reads your text." });
  // undo
  const u = G.kanbanUndo(M, r.data, r.undo, NOW + 100);
  assert.deepEqual([u.n, u.kept], [2, 0]);
  assert.equal(col(u.data, "c2").ap, undefined);
  assert.deepEqual(col(u.data, "c3").ap, { on: 1, n: "Σελίδες", a: "Παλιό" });
  assert.equal(M.mergeKanbanStates(r.data, u.data, NOW + 200).boards[0].columns[1].ap, undefined, "the undo wins the merge");
  // rename and portal on the same column in one call: one stamp, one undo puts both back
  const both = G.kanbanWrite(M, "add_columns", base, { board: "b1", rename_columns: [{ column: "c2", name: "Επιμέλεια κειμένου" }],
    portal_columns: [{ column: "c2", step: true }] }, NOW, nid);
  assert.equal(both.ok, true, both.err);
  assert.equal(col(both.data, "c2").name, "Επιμέλεια κειμένου");
  assert.deepEqual(col(both.data, "c2").ap, { on: 1 });
  const ub = G.kanbanUndo(M, both.data, both.undo, NOW + 100);
  assert.deepEqual([ub.n, ub.kept], [2, 0]);
  assert.equal(col(ub.data, "c2").name, "Επιμέλεια");
  assert.equal(col(ub.data, "c2").ap, undefined);
  // the owner changed the column since: kept
  const later = JSON.parse(JSON.stringify(r.data));
  col(later, "c2").ap.a = "Δικό μου"; col(later, "c2").mtime = NOW + 50;
  const u2 = G.kanbanUndo(M, later, r.undo, NOW + 100);
  assert.deepEqual([u2.n, u2.kept], [1, 1]);
  assert.equal(col(u2.data, "c2").ap.a, "Δικό μου");
  // refusals
  const no = (a) => G.kanbanWrite(M, "add_columns", base, Object.assign({ board: "b1" }, a), NOW, nid);
  assert.match(no({ portal_columns: [{ column: "Nope", step: true }] }).err, /^portal_columns 1: /);
  assert.match(no({ portal_columns: [{ column: "c2" }] }).err, /give step, finish or a text/);
  assert.match(no({ portal_columns: [{ column: "c2", step: "yes" }] }).err, /true or false/);
  assert.match(no({ portal_columns: [{ column: "c2", about: "x".repeat(601) }] }).err, /at most 600/);
  assert.match(no({ portal_columns: [{ column: "c2", name: 5 }] }).err, /at most 80/);
  assert.match(no({ portal_columns: [{ column: "c2", step: true }, { column: "Επιμέλεια", finish: true }] }).err, /already set/);
  assert.match(no({ portal_columns: [{ column: "c3", step: true }] }).err, /^Nothing to change/);
  assert.match(no({ portal_columns: [] }).err, /1 to 20/);
  assert.match(no({}).err, /portal_columns/);
});

// KB-SUB (Chris 2026-11-12): subtasks through kanban_change_card.
test("subtasks: add at the end, tick or reword by id or text, undo takes back only those", () => {
  const raw = data();
  col(raw, "c1").cards[1].subtasks = [{ id: "s0", text: "ISBN", completed: false, m: T0 }];
  const r = G.kanbanWrite(M, "change_card", raw, { board: "b1", card: "k2",
    add_subtasks: ["Νόμιμη κατάθεση", " Βιβλιοθήκη  της Βουλής "], change_subtasks: [{ subtask: "ISBN", done: true }] }, NOW, nid);
  assert.equal(r.ok, true, r.err);
  const k = col(r.data, "c1").cards[1];
  assert.deepEqual(k.subtasks.map((s) => [s.text, s.completed]), [["ISBN", true], ["Νόμιμη κατάθεση", false], ["Βιβλιοθήκη της Βουλής", false]]);
  assert.ok(k.subtasks.every((s) => s.m === k.mtime));
  assert.equal(k.fm.s, k.mtime);
  assert.equal(k.notes, "n", "other fields stay");
  assert.equal(r.ids.length, 3);
  assert.match(r.text, /Added 2 subtasks.*Changed 1 subtask/);
  // reword by id
  const r2 = G.kanbanWrite(M, "change_card", r.data, { board: "b1", card: "k2", change_subtasks: [{ subtask: r.ids[1], text: "Κατάθεση" }] }, NOW + 5, nid);
  assert.equal(r2.ok, true, r2.err);
  assert.equal(col(r2.data, "c1").cards[1].subtasks[1].text, "Κατάθεση");
  // undo the second, then the first: back to one unticked subtask, the added ones tombstoned
  const u2 = G.kanbanUndo(M, r2.data, r2.undo, NOW + 10);
  assert.equal(u2.n, 1);
  assert.equal(col(u2.data, "c1").cards[1].subtasks[1].text, "Νόμιμη κατάθεση");
  const u1 = G.kanbanUndo(M, u2.data, r.undo, NOW + 20);
  assert.equal(u1.n, 0, "the card changed after the first change: kept");
  const u = G.kanbanUndo(M, r.data, r.undo, NOW + 20);
  assert.equal(u.n, 1);
  const k0 = col(u.data, "c1").cards[1];
  assert.deepEqual(k0.subtasks.map((s) => [s.id, s.completed]), [["s0", false]]);
  assert.ok(u.data.boards[0].deleted["k2/" + r.ids[1]] > 0);
  assert.equal(k0.subtasks[0].m, k0.mtime);
  // merging the undone copy with the changed one keeps the undo
  const mg = M.mergeKanbanStates(r.data, u.data, NOW + 30);
  assert.deepEqual(col(mg, "c1").cards[1].subtasks.map((s) => [s.id, s.completed]), [["s0", false]]);
});

test("subtasks: refused without changing anything", () => {
  const raw = data();
  col(raw, "c1").cards[1].subtasks = [{ id: "s0", text: "Ίδιο", completed: false }, { id: "s1", text: "Ίδιο", completed: false }];
  const bad = [
    [{ add_subtasks: [] }, /add_subtasks must hold/],
    [{ add_subtasks: [""] }, /Subtask 1/],
    [{ add_subtasks: Array(31).fill("x") }, /add_subtasks must hold/],
    [{ change_subtasks: [{ subtask: "Ίδιο", done: true }] }, /more than one subtask/],
    [{ change_subtasks: [{ subtask: "nope", done: true }] }, /no subtask/],
    [{ change_subtasks: [{ subtask: "s0" }] }, /give done, text or both/],
    [{ change_subtasks: [{ subtask: "s0", done: "yes" }] }, /done must be/],
    [{ change_subtasks: [{ subtask: "s0", done: true }, { subtask: "s0", done: false }] }, /twice/],
    [{ change_subtasks: [{ subtask: "s0", done: false }] }, /Nothing to change/],
    [{ add_subtasks: ["ok"], change_subtasks: [{ subtask: "nope", done: true }] }, /no subtask/]
  ];
  for (const [a, re] of bad) {
    const r = G.kanbanWrite(M, "change_card", raw, Object.assign({ board: "b1", card: "k2" }, a), NOW, nid);
    assert.equal(r.ok, false, JSON.stringify(a));
    assert.match(r.err, re);
  }
  col(raw, "c1").cards[1].subtasks = Array.from({ length: 99 }, (_, i) => ({ id: "x" + i, text: "t" + i, completed: false }));
  const full = G.kanbanWrite(M, "change_card", raw, { board: "b1", card: "k2", add_subtasks: ["a", "b"] }, NOW, nid);
  assert.match(full.err, /at most 100 subtasks/);
});

// KB-SUBDEL (Chris 2026-11-20): removing subtasks through kanban_change_card.
test("subtasks: removed by id or text with tombstones; undo puts them back in place and a merge keeps them", () => {
  const raw = data();
  col(raw, "c1").cards[1].subtasks = [
    { id: "s0", text: "ISBN", completed: true, m: T0 }, { id: "s1", text: "Εξώφυλλο", completed: false, m: T0 },
    { id: "s2", text: "Τυπογραφείο", completed: false, m: T0 }];
  const r = G.kanbanWrite(M, "change_card", raw, { board: "b1", card: "k2", remove_subtasks: ["s0", " Τυπογραφείο "] }, NOW, nid);
  assert.equal(r.ok, true, r.err);
  const k = col(r.data, "c1").cards[1];
  assert.deepEqual(k.subtasks.map((s) => s.id), ["s1"]);
  assert.deepEqual(r.removed, ["ISBN", "Τυπογραφείο"]);
  assert.match(r.text, /Removed 2 subtasks/);
  assert.ok(r.data.boards[0].deleted["k2/s0"] >= k.mtime && r.data.boards[0].deleted["k2/s2"] > T0);
  assert.equal(G.delCount("kanban_change_card", { remove_subtasks: ["s0", "s2"] }), 2, "a deletion: asked on the device");
  assert.equal(G.delCount("kanban_change_card", { add_subtasks: ["x"] }), 0);
  // a device that still has them loses them in the merge
  const mg0 = M.mergeKanbanStates(raw, r.data, NOW + 1);
  assert.deepEqual(col(mg0, "c1").cards[1].subtasks.map((s) => s.id), ["s1"]);
  // undo: back in their places, newer than their tombstones, and they survive a merge with the removed copy
  const u = G.kanbanUndo(M, r.data, r.undo, NOW + 10);
  assert.equal(u.n, 1);
  const k0 = col(u.data, "c1").cards[1];
  assert.deepEqual(k0.subtasks.map((s) => [s.id, s.text, s.completed]), [["s0", "ISBN", true], ["s1", "Εξώφυλλο", false], ["s2", "Τυπογραφείο", false]]);
  assert.ok(k0.subtasks[0].m > u.data.boards[0].deleted["k2/s0"]);
  const mg = M.mergeKanbanStates(r.data, u.data, NOW + 20);
  assert.deepEqual(col(mg, "c1").cards[1].subtasks.map((s) => s.id), ["s0", "s1", "s2"]);
  assert.deepEqual(col(M.mergeKanbanStates(u.data, r.data, NOW + 20), "c1").cards[1].subtasks.map((s) => s.id), ["s0", "s1", "s2"], "symmetric");
});

test("subtasks: a removal is refused whole when one name is wrong, twice, or changed too", () => {
  const raw = data();
  col(raw, "c1").cards[1].subtasks = [{ id: "s0", text: "Ίδιο", completed: false }, { id: "s1", text: "Ίδιο", completed: false }, { id: "s2", text: "Άλλο", completed: false }];
  const bad = [
    [{ remove_subtasks: [] }, /remove_subtasks must hold/],
    [{ remove_subtasks: [""] }, /give the subtask's id/],
    [{ remove_subtasks: ["Ίδιο"] }, /more than one subtask/],
    [{ remove_subtasks: ["s2", "nope"] }, /no subtask/],
    [{ remove_subtasks: ["s2", "Άλλο"] }, /twice/],
    [{ remove_subtasks: ["s2"], change_subtasks: [{ subtask: "s2", done: true }] }, /changed and removed/]
  ];
  for (const [a, re] of bad) {
    const r = G.kanbanWrite(M, "change_card", raw, Object.assign({ board: "b1", card: "k2" }, a), NOW, nid);
    assert.equal(r.ok, false, JSON.stringify(a));
    assert.match(r.err, re);
  }
  assert.equal(col(raw, "c1").cards[1].subtasks.length, 3, "the input is not changed");
});
