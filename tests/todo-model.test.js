// To-Do wave "closer to Todoist" (TD-14): todo/model.js (priorities,
// subtasks, smart lists, saved filters, sorting, repeat after
// completion, moved tasks) and the merge of the new fields, run through
// todo.js's own merge engine (sections 2 and 2b, cut out of the file).
// The dialogs, menus and rows are checked in the real shell.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const M = require("../todo/model.js");
const src = fs.readFileSync(path.join(__dirname, "..", "todo", "todo.js"), "utf8");
const T = (() => {
  const i = src.indexOf("  var ITEM_FIELDS"), j = src.indexOf("  // ---------- 3. Recurrence");
  if (i < 0 || j < 0) throw new Error("merge block not found");
  return new Function("M",
    "var window = { OrosTodoModel: M }; var DATA_VER = 3, TOMB_LIFETIME_MS = 30 * 864e5, LANG = 'en'; var state = null;" +
    src.slice(i, j) + "\nreturn { mergeTodoStates, canonState, migrate };")(M);
})();

const TODAY = "2026-10-14";

test("priority: P1..P3 kept, anything else is P4 (none)", () => {
  assert.equal(M.prioOf({ prio: 1 }), 1);
  assert.equal(M.prioOf({ prio: 3 }), 3);
  [undefined, 4, 0, 5, "1", null].forEach((p) => assert.equal(M.prioOf({ prio: p }), 4, String(p)));
});

test("smart lists: today (with overdue), next 7 days, no date, priority 1", () => {
  const it = (due, prio) => ({ due, prio });
  assert.equal(M.smartMatch("today", it("2026-10-14"), TODAY), true);
  assert.equal(M.smartMatch("today", it("2026-10-01"), TODAY), true);
  assert.equal(M.smartMatch("today", it("2026-10-15"), TODAY), false);
  assert.equal(M.smartMatch("week", it("2026-10-20"), TODAY), true);
  assert.equal(M.smartMatch("week", it("2026-10-21"), TODAY), false);
  assert.equal(M.smartMatch("week", it(null), TODAY), false);
  assert.equal(M.smartMatch("nodate", it(null), TODAY), true);
  assert.equal(M.smartMatch("nodate", it("bad"), TODAY), true);
  assert.equal(M.smartMatch("p1", it(null, 1), TODAY), true);
  assert.equal(M.smartMatch("p1", it(null, 2), TODAY), false);
});

test("saved filters: cleaned, then labels (any) + priority + due range + text", () => {
  const f = M.cleanFilter({ id: "f1", name: "  Work\n", labels: ["a", "a", 3, "b"], prios: [2, 1, 9, 1], due: "range",
    from: "2026-10-10", to: "nope", text: " Call ", mtime: 5, pos: 1, junk: 1 });
  assert.deepEqual(f, { id: "f1", name: "Work", labels: ["a", "b"], prios: [1, 2], due: "range", from: "2026-10-10", to: "",
    text: "Call", mtime: 5, pos: 1 });
  assert.equal(M.cleanFilter({ name: "x" }), null);
  assert.equal(M.cleanFilter({ id: "x", due: "someday" }).due, "");
  const ctx = { today: TODAY, labelName: (id) => ({ a: "Office" })[id] || "" };
  const t1 = { text: "Call the bank", labels: ["a"], prio: 1, due: "2026-10-12" };
  assert.equal(M.filterMatch(f, t1, ctx), true);
  assert.equal(M.filterMatch(f, Object.assign({}, t1, { due: "2026-10-09" }), ctx), false);   // before "from"
  assert.equal(M.filterMatch(f, Object.assign({}, t1, { prio: 3 }), ctx), false);
  assert.equal(M.filterMatch(f, Object.assign({}, t1, { labels: ["c"] }), ctx), false);
  assert.equal(M.filterMatch(f, Object.assign({}, t1, { text: "Pay" }), ctx), false);
  // text also looks in notes, extra info, label names and subtasks
  const g = M.cleanFilter({ id: "g", text: "office" });
  assert.equal(M.filterMatch(g, { text: "x", labels: ["a"] }, ctx), true);
  assert.equal(M.filterMatch(M.cleanFilter({ id: "h", text: "milk" }), { text: "x", subs: [{ id: "s", text: "Buy MILK" }] }, ctx), true);
  const due = (d) => M.cleanFilter({ id: "d", due: d });
  assert.equal(M.filterMatch(due("overdue"), { due: "2026-10-13" }, ctx), true);
  assert.equal(M.filterMatch(due("overdue"), { due: TODAY }, ctx), false);
  assert.equal(M.filterMatch(due("month"), { due: "2026-11-12" }, ctx), true);
  assert.equal(M.filterMatch(due("month"), { due: "2026-11-13" }, ctx), false);
  assert.equal(M.filterMatch(due("none"), { due: null }, ctx), true);
  assert.equal(M.filterMatch(due(""), { due: null }, ctx), true);
});

test("sorting: manual keeps order; priority; due date; done last; stable", () => {
  const rows = [
    { item: { id: "a", due: "2026-10-20" } },
    { item: { id: "b", prio: 1 } },
    { item: { id: "c", due: "2026-10-15", prio: 2 } },
    { item: { id: "d", done: true, prio: 1, due: "2026-10-01" } },
    { item: { id: "e", due: "2026-10-15" } }
  ].map((r, i) => Object.assign(r, { i }));
  const ids = (rs) => rs.map((r) => r.item.id).join("");
  assert.equal(ids(M.sortRows(rows, "manual")), "abcde");
  assert.equal(ids(M.sortRows(rows, "prio")), "bcead");
  assert.equal(ids(M.sortRows(rows, "due")), "ceabd");
});

test("repeat after completion: counts from the day it was ticked", () => {
  assert.equal(M.nextAfterDone("2026-10-14", { every: 30, unit: "day", after: true }), "2026-11-13");
  assert.equal(M.nextAfterDone("2026-10-14", { every: 2, unit: "week", after: true }), "2026-10-28");
  assert.equal(M.nextAfterDone("2026-01-31", { every: 1, unit: "month", after: true }), "2026-02-28");
  assert.equal(M.nextAfterDone("2026-12-15", { every: 1, unit: "month", after: true }), "2027-01-15");
  assert.equal(M.nextAfterDone("2026-10-14", { every: 0, unit: "day" }), "2026-10-15");
});

test("subtasks merge one by one; order from the newer order stamp; symmetric", () => {
  const s = (id, text, done, mtime) => ({ id, text, done, mtime });
  const a = [s("1", "one", true, 5), s("2", "two", false, 1), s("3", "three", false, 1)];
  const b = [s("3", "three", true, 7), s("1", "one", false, 2), s("2", "TWO", false, 3), s("4", "four", false, 4)];
  const ab = M.mergeSubs(a, b, 10, 0), ba = M.mergeSubs(b, a, 0, 10);
  assert.deepEqual(ab, ba);
  assert.deepEqual(ab.map((x) => x.id), ["1", "2", "3", "4"]);          // a's order (newer), b's newcomer last
  assert.deepEqual(ab.map((x) => x.done), [true, false, true, false]);  // each from its newer side
  assert.equal(ab[1].text, "TWO");
  // equal stamps: the same pick on both sides
  assert.deepEqual(M.mergeSubs(a, b, 0, 0), M.mergeSubs(b, a, 0, 0));
  assert.deepEqual(M.dropDeadSubs(ab, { "2": 9, "4": 1 }).map((x) => x.id), ["1", "3", "4"]);
  assert.deepEqual(M.subCount({ subs: ab }), { done: 2, total: 4 });
  assert.deepEqual(M.cleanSubs([null, { id: "x", text: "a\u0007b" }, { id: "x" }, { text: "no id" }]),
    [{ id: "x", text: "a b", done: false, mtime: 0 }]);
});

// ---------- the merge engine with the new fields ----------
const FM = (n) => ({ text: n, done: n, due: n, notes: n, labels: n, info: n, recurrence: n });
function task(id, text, n, extra) {
  return Object.assign({ id, text, done: false, due: null, notes: "", labels: [], info: [], recurrence: null,
    mtime: n, om: 0, pos: 0, fm: FM(n) }, extra || {});
}
function data(lists, extra) {
  return Object.assign({ ver: 3, sm: 0, om: 0, activeList: "L1", hideCompleted: false, deleted: {}, labels: [],
    lists: lists.map((l, i) => ({ id: l[0], name: l[0], mtime: 1, om: l[2] || 0, pos: i, recurrence: null,
      lastReset: null, nextReset: null, items: l[1], fm: { name: 1, cycle: 1 } })) }, extra || {});
}
const clone = (x) => JSON.parse(JSON.stringify(x));
function both(a, b) {
  const ab = T.mergeTodoStates(clone(a), clone(b)), ba = T.mergeTodoStates(clone(b), clone(a));
  assert.deepEqual(ab, ba, "merge is symmetric");
  assert.deepEqual(T.mergeTodoStates(clone(ab), clone(a)), ab, "merging again changes nothing (a)");
  assert.deepEqual(T.mergeTodoStates(clone(ab), clone(b)), ab, "merging again changes nothing (b)");
  return ab;
}
const where = (st, id) => st.lists.filter((l) => l.items.some((i) => i.id === id)).map((l) => l.id);
const find = (st, id) => { for (const l of st.lists) for (const i of l.items) if (i.id === id) return i; return null; };

test("data without the new fields keeps its exact shape (no filters, no prio, no xf)", () => {
  const d = data([["L1", [task("t1", "milk", 1)]]]);
  const c = T.canonState(T.migrate(clone(d)));
  assert.equal("filters" in c, false);
  assert.equal("fom" in c, false);
  const it = c.lists[0].items[0];
  ["prio", "subs", "xf"].forEach((k) => assert.equal(k in it, false, k));
  assert.deepEqual(Object.keys(c), ["ver", "sm", "om", "activeList", "hideCompleted", "deleted", "labels", "lists"]);
  assert.deepEqual(both(d, d), c);
});

test("a task moved on one device and edited in its old list on the other: one copy, in the new list, with both changes", () => {
  const base = data([["L1", [task("t1", "milk", 1), task("t2", "bread", 1)]], ["L2", []]]);
  // device A moves t1 to L2 at 50
  const A = clone(base);
  const t1 = A.lists[0].items.shift();
  t1.xf = { list: 50 }; t1.mtime = 50;
  A.lists[1].items.unshift(t1);
  A.lists[0].om = 50; A.lists[1].om = 50;
  // device B (not synced) writes notes on t1 in L1 at 60 and gives it P1 at 61
  const B = clone(base);
  const b1 = B.lists[0].items[0];
  b1.notes = "2 litres"; b1.fm.notes = 60; b1.prio = 1; b1.xf = { prio: 61 }; b1.mtime = 61;
  const m = both(A, B);
  assert.deepEqual(where(m, "t1"), ["L2"]);
  const r = find(m, "t1");
  assert.equal(r.notes, "2 litres");
  assert.equal(r.prio, 1);
  assert.deepEqual(r.xf, { prio: 61, list: 50 });
  assert.deepEqual(m.lists[0].items.map((i) => i.id), ["t2"]);
  // moved again on B, later: B's list wins
  const B2 = clone(m);
  const again = B2.lists[1].items.shift();
  again.xf.list = 90; again.mtime = 90;
  B2.lists[0].items.push(again);
  assert.deepEqual(where(both(m, B2), "t1"), ["L1"]);
});

test("subtasks ticked on two devices both stay ticked; a deleted one stays deleted; priority last-writer", () => {
  const s = (id, text, done, mtime) => ({ id, text, done, mtime });
  const base = data([["L1", [task("t1", "trip", 1, { subs: [s("s1", "passport", false, 1), s("s2", "tickets", false, 1), s("s3", "hotel", false, 1)], xf: { subs: 1 } })]]]);
  const A = clone(base), B = clone(base);
  const a = A.lists[0].items[0], b = B.lists[0].items[0];
  a.subs[0].done = true; a.subs[0].mtime = 20; a.xf.subs = 20; a.mtime = 20;
  a.prio = 2; a.xf.prio = 21; a.mtime = 21;
  b.subs[1].done = true; b.subs[1].mtime = 30; b.xf.subs = 30; b.mtime = 30;
  b.subs = b.subs.filter((x) => x.id !== "s3"); B.deleted.s3 = 31; b.mtime = 31; b.xf.subs = 31;
  b.subs.push(s("s4", "insurance", false, 32)); b.xf.subs = 32; b.mtime = 32;
  const m = both(A, B);
  const r = find(m, "t1");
  assert.deepEqual(r.subs.map((x) => [x.id, x.done]), [["s1", true], ["s2", true], ["s4", false]]);
  assert.equal(r.prio, 2);
  // a later "no priority" on B wins
  const B2 = clone(m);
  const b2 = find(B2, "t1");
  delete b2.prio; b2.xf.prio = 40; b2.mtime = 40;
  assert.equal("prio" in find(both(m, B2), "t1"), false);
});

test("saved filters merge by id, deletions win, absent when none are left", () => {
  const f = (id, name, mtime, pos) => ({ id, name, labels: [], prios: [1], due: "", from: "", to: "", text: "", mtime, pos });
  const A = data([["L1", []]], { filters: [f("f1", "Urgent", 5, 0)], fom: 5 });
  const B = data([["L1", []]], { filters: [f("f2", "Calls", 6, 0)], fom: 6 });
  const m = both(A, B);
  assert.deepEqual(m.filters.map((x) => x.id), ["f2", "f1"]);       // B's order (newer fom), A's newcomer after
  const C = clone(m);
  C.filters = C.filters.filter((x) => x.id !== "f1"); C.deleted.f1 = 9;
  C.filters.forEach((x, i) => { x.pos = i; });
  C.fom = 9;
  const m2 = both(m, C);
  assert.deepEqual(m2.filters.map((x) => x.id), ["f2"]);
  const D = clone(m2); D.filters = []; D.deleted.f2 = 10;
  const m3 = both(m2, D);
  assert.equal("filters" in m3, false);
  // an older device that drops the root "filters" key does not delete them
  const old = clone(m); delete old.filters; delete old.fom;
  assert.deepEqual(both(m, old).filters.map((x) => x.id), ["f2", "f1"]);
});

test("repeat after completion survives load and merge; other recurrence keys untouched", () => {
  const d = data([["L1", [task("t1", "filter", 1, { recurrence: { every: 30, unit: "day", weekday: null, after: true } }),
                          task("t2", "bins", 1, { recurrence: { every: 1, unit: "week", weekday: 2, after: "yes" } })]]]);
  const c = T.canonState(T.migrate(clone(d)));
  assert.equal(c.lists[0].items[0].recurrence.after, true);
  assert.deepEqual(c.lists[0].items[1].recurrence, { every: 1, unit: "week", weekday: 2 });
});
