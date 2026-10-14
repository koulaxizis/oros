// Kanban change_item adapter (phase 4 wave 2): wired into a copy of
// assistant/edits.js and checked against kanban/model.js (merge, canon).
// Run: node --test kanban.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
const E = require(path.join(REPO, "assistant/edits.js"));
const M = require(path.join(REPO, "kanban/model.js"));

const NOW = 1760000000000;
const T0 = NOW - 100000;
const ch = (a) => { const r = E.normArgs(Object.assign({ ref: "r1" }, a)); assert.equal(r.ok, true, r.err); return r; };
const clone = (x) => JSON.parse(JSON.stringify(x));

function card(id, text, extra) {
  const c = { id, text, notes: "", due: null, labels: [], subtasks: [], info: [], mtime: T0, pos: 0 };
  return Object.assign(c, extra || {});
}
function data() {
  return M.canonState({
    ver: 5, om: 0, boardDeleted: {},
    boards: [{
      id: "b1", name: "Main", archived: false, mtime: T0, om: T0, deleted: {}, labels: [{ id: "l1", name: "Hot", color: "#ff0000", mtime: T0 }],
      columns: [
        { id: "c1", name: "To Do", mtime: T0, om: T0, cards: [
          card("k1", "Write report", { notes: "draft", due: "2026-10-20",
            subtasks: [{ id: "s1", text: "a", completed: true, m: T0 }, { id: "s2", text: "b", completed: false, m: T0 }], fm: { a: T0, c: T0, d: T0, k: T0, l: T0, m: T0, n: T0, p: T0, s: T0, t: T0, x: T0 } }),
          card("k2", "Old card"),                                           // older version: no fm
          card("k3", "With file", { att: [{ id: "a1", name: "x.pdf", file: "x1.pdf", kind: "pdf", size: 3, m: T0 }] })
        ] },
        { id: "c2", name: " Doing ", mtime: T0, om: T0, wip: 1, cards: [card("k4", "Busy")] },
        { id: "c3", name: "Done", mtime: T0, om: T0, auto: { done: true, today: true, label: "l1", top: true }, cards: [card("k5", "Shipped")] },
        { id: "c4", name: "Dup", mtime: T0, om: T0, cards: [] },
        { id: "c5", name: "dup", mtime: T0, om: T0, cards: [] }
      ]
    }, {
      id: "b2", name: "Old", archived: true, mtime: T0, om: T0, deleted: {}, labels: [],
      columns: [{ id: "c9", name: "A", mtime: T0, om: T0, cards: [card("k9", "Archived")] }]
    }]
  }, NOW);
}
const tg = (cardId, board) => ({ board: board || "b1", col: "c1", card: cardId });
const find = (d, id) => { for (const b of d.boards) for (const c of b.columns) for (const k of c.cards) if (k.id === id) return { b, c, k }; return null; };
function applyOk(d, t, c) {
  const p = E.plan("kanban", d, t, c, NOW);
  assert.equal(p.ok, true, p.err);
  const r = E.apply("kanban", d, t, c, NOW, p.before);
  assert.equal(r.ok, true, r.err);
  return { p, r };
}
const canonSame = (d) => assert.deepEqual(JSON.stringify(M.canonState(d, NOW)), JSON.stringify(d), "stored copy stays canonical");

test("actions and storage key", () => {
  assert.equal(E.storageKey("kanban"), "oros-kanban-data");
  assert.deepEqual(E.actionsFor("kanban"), ["reschedule", "update", "move", "delete"]);
  assert.equal(E.plan("kanban", data(), tg("k1"), ch({ action: "complete" }), NOW).ok, false);
  assert.equal(E.plan("kanban", data(), tg("k1"), ch({ action: "reopen" }), NOW).ok, false);
});

test("update: title, note, date → per-field stamps newer than before, canonical", () => {
  const d = data();
  const { p, r } = applyOk(d, tg("k1"), ch({ action: "update", title: "Write the report", note: "final", date: "2026-10-25" }));
  assert.deepEqual(p.rows.map((x) => x.f), ["title", "due", "note"]);
  const k = find(r.data, "k1").k;
  assert.equal(k.text, "Write the report"); assert.equal(k.notes, "final"); assert.equal(k.due, "2026-10-25");
  assert.equal(k.mtime, NOW); assert.equal(k.fm.m, NOW);
  assert.equal(k.fm.t, NOW); assert.equal(k.fm.n, NOW); assert.equal(k.fm.d, NOW); assert.equal(k.fm.p, T0);
  assert.ok(M.fmValid(k));
  canonSame(r.data);
  assert.deepEqual(d, data(), "input untouched");
});

test("update: empty note clears; reschedule sets due; clock behind still wins", () => {
  let { r } = applyOk(data(), tg("k1"), ch({ action: "update", note: "" }));
  assert.equal(find(r.data, "k1").k.notes, "");
  ({ r } = applyOk(data(), tg("k1"), ch({ action: "reschedule", date: "2026-11-01" })));
  assert.equal(find(r.data, "k1").k.due, "2026-11-01");
  const d = data(); find(d, "k1").k.mtime = NOW + 5000; find(d, "k1").k.fm.m = NOW + 5000;
  ({ r } = applyOk(d, tg("k1"), ch({ action: "update", title: "X" })));
  assert.equal(find(r.data, "k1").k.fm.t, NOW + 5001);
});

test("update refusals", () => {
  const d = data();
  assert.match(E.plan("kanban", d, tg("k1"), ch({ action: "update", title: "Write report" }), NOW).err, /Nothing would change/);
  assert.match(E.plan("kanban", d, tg("k1"), ch({ action: "reschedule", date: "2026-10-21", start: "10:00" }), NOW).err, /no start/);
  assert.match(E.plan("kanban", d, tg("k1"), ch({ action: "update", phone: "123" }), NOW).err, /no phone/);
  assert.match(E.plan("kanban", d, tg("k9", "b2"), ch({ action: "update", title: "Y" }), NOW).err, /archived/);
  assert.match(E.plan("kanban", d, tg("nope"), ch({ action: "update", title: "Y" }), NOW).err, /no longer/);
});

test("older card (no fm): first edit spells out fm at the old mtime", () => {
  const { r } = applyOk(data(), tg("k2"), ch({ action: "update", title: "New" }));
  const k = find(r.data, "k2").k;
  assert.equal(k.fm.t, NOW); assert.equal(k.fm.n, T0); assert.equal(k.fm.m, NOW); assert.ok(M.fmValid(k));
});

test("move: by trimmed case-insensitive name, to the end, p stamp + column om; WIP not enforced (the app does not)", () => {
  const d = data();
  const { p, r } = applyOk(d, tg("k1"), ch({ action: "move", column: "doing" }));
  assert.deepEqual(p.rows, [{ f: "column", b: "To Do", a: "Doing" }, { f: "position", b: "1/3", a: "2/2" }]);
  const f = find(r.data, "k1");
  assert.equal(f.c.id, "c2"); assert.deepEqual(f.c.cards.map((x) => x.id), ["k4", "k1"]);
  assert.equal(f.k.fm.p, NOW); assert.equal(f.k.fm.t, T0); assert.equal(f.c.om, NOW);
  assert.equal(r.data.boards[0].columns[0].om, NOW);
  assert.deepEqual(r.data.boards[0].columns[0].cards.map((x) => x.pos), [0, 1]);
  canonSame(r.data);
});

test("move refusals: unknown (names columns), ambiguous, same", () => {
  const d = data();
  const e1 = E.plan("kanban", d, tg("k1"), ch({ action: "move", column: "Later" }), NOW).err;
  assert.match(e1, /no column Later/); assert.match(e1, /To Do, Doing, Done, Dup, dup/);
  assert.match(E.plan("kanban", d, tg("k1"), ch({ action: "move", column: "DUP" }), NOW).err, /more than one/);
  assert.match(E.plan("kanban", d, tg("k1"), ch({ action: "move", column: "to do" }), NOW).err, /already in/);
});

test("app merge: the edited card wins over the old copy from another device (both orders)", () => {
  const old = data();
  let { r } = applyOk(data(), tg("k1"), ch({ action: "update", title: "Edited", note: "n2" }));
  for (const m of [M.mergeKanbanStates(r.data, old, NOW), M.mergeKanbanStates(old, r.data, NOW)]) {
    const k = find(m, "k1").k; assert.equal(k.text, "Edited"); assert.equal(k.notes, "n2");
  }
  // other device meanwhile edited the due date: both survive (per field)
  const other = data(); const ok = find(other, "k1").k; ok.due = "2026-12-01"; M.stampCard(ok, ["d"], NOW - 10);
  const m2 = M.mergeKanbanStates(r.data, other, NOW);
  assert.equal(find(m2, "k1").k.text, "Edited"); assert.equal(find(m2, "k1").k.due, "2026-12-01");
  // move of an older (no fm) card wins
  ({ r } = applyOk(data(), tg("k2"), ch({ action: "move", column: "Doing" })));
  for (const m of [M.mergeKanbanStates(r.data, old, NOW), M.mergeKanbanStates(old, r.data, NOW)]) assert.equal(find(m, "k2").c.id, "c2");
  // whole-card (pre-K1) merge picks it too
  assert.equal(find(M.mergeKanbanStates(old, r.data, NOW, true), "k2").c.id, "c2");
});

test("delete: tombstone newer than the card wins the app merge; attachments refused", () => {
  const d = data();
  const { p, r } = applyOk(d, tg("k1"), ch({ action: "delete" }));
  assert.equal(p.del, true); assert.ok(p.rows.some((x) => x.f === "title" && x.a === null));
  assert.equal(find(r.data, "k1"), null);
  assert.ok(r.data.boards[0].deleted.k1 > find(d, "k1").k.mtime);
  canonSame(r.data);
  for (const m of [M.mergeKanbanStates(r.data, d, NOW), M.mergeKanbanStates(d, r.data, NOW)]) assert.equal(find(m, "k1"), null);
  assert.match(E.plan("kanban", d, tg("k3"), ch({ action: "delete" }), NOW).err, /attachments/);
});

test("undo: update, move and delete put it back with fresh stamps that win", () => {
  let { r } = applyOk(data(), tg("k1"), ch({ action: "update", title: "Edited", date: "2026-10-30" }));
  let u = E.undo("kanban", r.data, r.undo, NOW + 10);
  assert.equal(u.ok, true, u.err);
  let k = find(u.data, "k1").k;
  assert.equal(k.text, "Write report"); assert.equal(k.due, "2026-10-20"); assert.equal(k.notes, "draft");
  assert.equal(k.fm.t, NOW + 10);
  assert.equal(find(M.mergeKanbanStates(r.data, u.data, NOW + 10), "k1").k.text, "Write report");
  canonSame(u.data);

  ({ r } = applyOk(data(), tg("k1"), ch({ action: "move", column: "Doing" })));
  u = E.undo("kanban", r.data, r.undo, NOW + 10);
  assert.equal(u.ok, true, u.err);
  const f = find(u.data, "k1");
  assert.equal(f.c.id, "c1"); assert.equal(f.c.cards[0].id, "k1"); assert.equal(f.k.fm.p, NOW + 10);
  assert.equal(find(M.mergeKanbanStates(r.data, u.data, NOW + 10), "k1").c.id, "c1");

  ({ r } = applyOk(data(), tg("k1"), ch({ action: "delete" })));
  u = E.undo("kanban", r.data, r.undo, NOW + 10);
  assert.equal(u.ok, true, u.err);
  k = find(u.data, "k1").k;
  assert.equal(find(u.data, "k1").c.cards[0].id, "k1");
  assert.equal(u.data.boards[0].deleted.k1, undefined);
  assert.ok(k.mtime > NOW && M.fmValid(k));
  canonSame(u.data);
  // even against a device that still has the tombstone
  assert.ok(find(M.mergeKanbanStates(r.data, u.data, NOW + 10), "k1"));
  assert.equal(E.undo("kanban", u.data, r.undo, NOW + 20).ok, false, "back already");
});

test("undo refuses once the card changed since", () => {
  const { r } = applyOk(data(), tg("k1"), ch({ action: "update", title: "Edited" }));
  const later = clone(r.data); find(later, "k1").k.text = "User typed";
  assert.match(E.undo("kanban", later, r.undo, NOW + 10).err, /changed since/);
});

test("conflict: card changed after plan → apply refuses, nothing written", () => {
  const d = data();
  const c = ch({ action: "move", column: "Doing" });
  const p = E.plan("kanban", d, tg("k1"), c, NOW);
  const now2 = clone(d); find(now2, "k1").k.notes = "edited elsewhere";
  const r = E.apply("kanban", now2, tg("k1"), c, NOW, p.before);
  assert.equal(r.ok, false); assert.equal(r.conflict, true);
  const now3 = clone(d); now3.boards[0].columns[0].name = "Backlog";      // column renamed
  assert.equal(E.apply("kanban", now3, tg("k1"), c, NOW, p.before).conflict, true);
});

const TODAY = (() => { const t = new Date(NOW); return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0"); })();
test("move into a column with arrival rules runs them like tools.js applyArrival, all shown in the diff", () => {
  const d = data();
  const { p, r } = applyOk(d, tg("k1"), ch({ action: "move", column: "done" }));
  assert.deepEqual(p.rows, [
    { f: "column", b: "To Do", a: "Done" }, { f: "due", b: "2026-10-20", a: TODAY },
    { f: "labels", b: "", a: "Hot" }, { f: "subtasks", b: "1/2", a: "2/2" },
    { f: "position", b: "1/3", a: "1/2" }]);
  const f = find(r.data, "k1");
  assert.equal(f.c.id, "c3"); assert.deepEqual(f.c.cards.map((x) => x.id), ["k1", "k5"]);
  assert.equal(f.k.due, TODAY); assert.deepEqual(f.k.labels, ["l1"]);
  assert.ok(f.k.subtasks.every((x) => x.completed));
  for (const g of ["p", "s", "d", "l"]) assert.ok(f.k.fm[g] >= NOW, g);
  assert.equal(f.k.fm.t, T0); assert.ok(M.fmValid(f.k));
  assert.equal(f.k.subtasks[1].m, f.k.fm.s); assert.equal(f.k.subtasks[0].m, T0);
  assert.ok(f.c.om >= NOW);
  canonSame(r.data);
  // the app's own applyArrival on the same move gives the same card
  const Tl = require(path.join(REPO, "kanban/tools.js"));
  const ref = clone(d), rb = ref.boards[0], rk = rb.columns[0].cards.shift();
  rb.columns[2].cards.push(rk); M.stampCard(rk, ["p"], NOW);
  Tl.applyArrival(rb, "c3", "k1", TODAY, NOW);
  const mine = find(r.data, "k1").k, theirs = M.canonState(ref, NOW).boards[0].columns[2].cards[0];
  assert.equal(JSON.stringify(mine), JSON.stringify(theirs));
  // wins the app merge against the old copy
  for (const m of [M.mergeKanbanStates(r.data, d, NOW), M.mergeKanbanStates(d, r.data, NOW)]) {
    const g = find(m, "k1"); assert.equal(g.c.id, "c3"); assert.equal(g.k.due, TODAY); assert.ok(g.k.subtasks.every((x) => x.completed));
  }
  // undo puts back column, place, due, labels and subtask ticks, and wins the merge
  const u = E.undo("kanban", r.data, r.undo, NOW + 10);
  assert.equal(u.ok, true, u.err);
  const b = find(u.data, "k1");
  assert.equal(b.c.id, "c1"); assert.equal(b.c.cards[0].id, "k1");
  assert.equal(b.k.due, "2026-10-20"); assert.deepEqual(b.k.labels, []);
  assert.deepEqual(b.k.subtasks.map((x) => x.completed), [true, false]);
  canonSame(u.data);
  for (const m of [M.mergeKanbanStates(r.data, u.data, NOW + 10), M.mergeKanbanStates(u.data, r.data, NOW + 10)]) {
    const g = find(m, "k1"); assert.equal(g.c.id, "c1"); assert.equal(g.k.due, "2026-10-20");
    assert.deepEqual(g.k.labels, []); assert.deepEqual(g.k.subtasks.map((x) => x.completed), [true, false]);
  }
  // a subtask unticked in between → undo refuses
  const later = clone(r.data); find(later, "k1").k.subtasks[0].completed = false;
  assert.match(E.undo("kanban", later, r.undo, NOW + 10).err, /changed since/);
});
