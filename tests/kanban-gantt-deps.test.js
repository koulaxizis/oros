// Kanban Gantt wave G2: finish-to-start dependencies (loops refused,
// broken ones found, successors shifted on request) and the critical
// path, all pure in kanban/tools.js.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const T = require(path.join(__dirname, "..", "kanban/tools.js"));

function card(id, extra) { return Object.assign({ id, text: id, notes: "", due: null, labels: [], subtasks: [], info: [], mtime: 1 }, extra || {}); }
function board(cards) { return { id: "b", name: "B", columns: [{ id: "c1", name: "Todo", cards }, { id: "c2", name: "Done", cards: [] }] }; }

// a: 16-18 Nov (Mon-Wed) → b: 19-20 (Thu-Fri) → c: 23-27 (next week)
function plan() {
  return board([
    card("a", { start: "2026-11-16", due: "2026-11-18" }),
    card("b", { start: "2026-11-19", due: "2026-11-20", deps: ["a"] }),
    card("c", { start: "2026-11-23", due: "2026-11-27", deps: ["b", "gone"] }),
    card("x", { start: "2026-11-16", due: "2026-11-17" })
  ]);
}

test("loops are refused, missing cards ignored", () => {
  const b = plan();
  assert.equal(T.wouldCycle(b, "a", "c"), true, "a waiting for c closes a → b → c → a");
  assert.equal(T.wouldCycle(b, "a", "a"), true);
  assert.equal(T.wouldCycle(b, "c", "a"), false, "already implied, not a loop");
  assert.equal(T.wouldCycle(b, "x", "c"), false);
  assert.deepEqual(T.brokenDeps(b, false), [], "the plan keeps every dependency; 'gone' is ignored");
});

test("a dependency is broken when the next card starts on or before the day the first ends", () => {
  const b = plan();
  b.columns[0].cards[0].due = "2026-11-19";      // a now ends the day b starts
  assert.deepEqual(T.brokenDeps(b, false), [{ from: "a", to: "b" }]);
});

test("workdays: Friday → Monday keeps the dependency", () => {
  const b = board([card("a", { start: "2026-11-16", due: "2026-11-20" }), card("b", { start: "2026-11-23", due: "2026-11-24", deps: ["a"] })]);
  assert.deepEqual(T.brokenDeps(b, true), []);
  assert.equal(T.dayAfter("2026-11-20", true), "2026-11-23");
  assert.equal(T.dayAfter("2026-11-20", false), "2026-11-21");
});

test("move the next ones too: successors pushed later just enough, lengths kept", () => {
  const b = plan();
  b.columns[0].cards[0].due = "2026-11-20";     // a stretched to Friday
  const all = T.shiftAfter(b, "a", false);
  assert.deepEqual(all, [
    { id: "b", from: "2026-11-21", to: "2026-11-22" },
    { id: "c", from: "2026-11-23", to: "2026-11-27" }
  ].filter((r) => r.id === "b"), "c already starts after b's new end (23 > 22)");
  const wd = T.shiftAfter(b, "a", true);
  assert.deepEqual(wd, [
    { id: "b", from: "2026-11-23", to: "2026-11-24" },
    { id: "c", from: "2026-11-25", to: "2026-12-01" }
  ], "workdays: b to Mon-Tue, c keeps its 5 workdays from Wed");
  assert.deepEqual(T.shiftAfter(plan(), "a", false), [], "nothing broken, nothing moves; never pulled earlier");
});

test("critical path: the chain that sets the end, not the card with slack", () => {
  const cp = T.criticalPath(plan(), true);
  assert.equal(cp.end, "2026-11-27");
  assert.deepEqual(Object.keys(cp.ids).sort(), ["a", "b", "c"], "workdays: Fri → Mon is no slack");
  assert.deepEqual(Object.keys(T.criticalPath(plan(), false).ids), ["c"], "every day counts: Sat and Sun are slack for a and b");
  // give b a day of slack: c starts later than needed
  const b2 = plan();
  b2.columns[0].cards[1].due = "2026-11-19";
  const cp2 = T.criticalPath(b2, true);
  assert.deepEqual(Object.keys(cp2.ids).sort(), ["c"], "a and b could slip a day without moving the end");
  assert.deepEqual(T.criticalPath(board([]), false), { ids: {}, end: null });
});

test("a loop that came in through sync does not hang anything", () => {
  const b = board([card("a", { due: "2026-11-18", deps: ["b"] }), card("b", { due: "2026-11-19", deps: ["a"] })]);
  assert.ok(Array.isArray(T.brokenDeps(b, false)));
  assert.ok(Array.isArray(T.shiftAfter(b, "a", false)));
  assert.ok(T.criticalPath(b, false).end);
});
