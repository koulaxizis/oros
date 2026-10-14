// change_item adapter for Habits: wired into a copy of
// assistant/edits.js, checked against habits/model.js mergeData.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
const E = require(path.join(REPO, "assistant/edits.js"));
const M = require(path.join(REPO, "habits/model.js"));
const HC = require(path.join(REPO, "habits/core.js"));

const NOW = new Date(2026, 9, 14, 23, 30).getTime();   // local 2026-10-14, late evening
const TODAY = "2026-10-14";
const T0 = NOW - 86400000 * 3;
function data() {
  return M.normalize({ ver: 2, habits: [
      { id: "h1", name: "Read", icon: "book", color: M.COLORS[0], days: [0, 1, 2, 3, 4, 5, 6], mtime: T0, del: false },
      { id: "h2", name: "Pages", days: [], mtime: T0, del: false, num: { u: "pages", t: 10, c: "ge", s: 1 } },
      { id: "h3", name: "Old", days: [], mtime: T0, del: true }],
    comps: [{ id: "h1|2026-10-13", habitId: "h1", date: "2026-10-13", mtime: T0, del: false }] });
}
const ch = (args) => { const r = E.normArgs(Object.assign({ ref: "r1" }, args)); assert.ok(r.ok, r.err); return r; };
function run(d, target, c, now) {
  const p = E.plan("habits", d, target, c, now);
  assert.ok(p.ok, p.err);
  const a = E.apply("habits", d, target, c, now, p.before);
  assert.ok(a.ok, a.err);
  return { p, a };
}

test("habits: wired; no delete", () => {
  assert.equal(E.storageKey("habits"), "oros-habits-data");
  assert.equal(E.plan("habits", data(), { habit: "h1" }, ch({ action: "delete" }), NOW).ok, false);
});

test("habits: complete ticks today's local day exactly as setTick, wins the merge", () => {
  const d = data();
  const { p, a } = run(d, { habit: "h1" }, ch({ action: "complete" }), NOW);
  assert.deepEqual(p.rows, [{ f: "done", b: false, a: true }]);
  const c = a.data.comps.find((x) => x.id === "h1|" + TODAY);
  assert.deepEqual(c, { id: "h1|" + TODAY, habitId: "h1", date: TODAY, mtime: NOW, del: false });
  // the same as the app's own write
  const ref = data(); M.setTick(ref, "h1", TODAY, true, NOW);
  assert.deepEqual(M.canon(a.data), M.canon(ref));
  const m = M.mergeData(d, a.data);
  assert.deepEqual(m, M.mergeData(a.data, d));
  assert.ok(HC.isDone(m, "h1", TODAY));
  assert.equal(d.comps.length, 1);                                  // input untouched
  assert.match(E.plan("habits", a.data, { habit: "h1" }, ch({ action: "complete" }), NOW + 1).err, /already ticked/);
});

test("habits: complete un-skips; a stale unticked copy elsewhere loses", () => {
  const d = data();
  M.setSkip(d, "h1", TODAY, true, NOW - 1000);
  const other = JSON.parse(JSON.stringify(d));
  M.setTick(other, "h1", TODAY, false, NOW - 500);                     // no-op there: still unticked, older stamps
  const { a } = run(d, { habit: "h1" }, ch({ action: "complete" }), NOW);
  const c = a.data.comps.find((x) => x.id === "h1|" + TODAY);
  assert.equal(c.sk[0], 0); assert.ok(c.sk[1] > NOW - 1000);
  const m = M.mergeData(other, a.data);
  assert.ok(HC.isDone(m, "h1", TODAY));
  assert.ok(!HC.isSkipped(HC.index(m), "h1", TODAY));
});

test("habits: reopen unticks today, stamp beats a future-dated tick", () => {
  const d = data();
  M.setTick(d, "h1", TODAY, true, NOW + 9000);
  const { p, a } = run(d, { habit: "h1" }, ch({ action: "reopen" }), NOW);
  assert.deepEqual(p.rows, [{ f: "done", b: true, a: false }]);
  const c = a.data.comps.find((x) => x.id === "h1|" + TODAY);
  assert.equal(c.del, true); assert.equal(c.mtime, NOW + 9001);
  assert.ok(!HC.isDone(M.mergeData(d, a.data), "h1", TODAY));
  assert.match(E.plan("habits", a.data, { habit: "h1" }, ch({ action: "reopen" }), NOW).err, /not ticked/);
});

test("habits: refusals — number habit, note, deleted habit, unknown field", () => {
  assert.match(E.plan("habits", data(), { habit: "h2" }, ch({ action: "complete" }), NOW).err, /how much/);
  assert.match(E.plan("habits", data(), { habit: "h2" }, ch({ action: "reopen" }), NOW).err, /how much/);
  assert.match(E.plan("habits", data(), { habit: "h1" }, ch({ action: "update", note: "x" }), NOW).err, /per day/);
  assert.match(E.plan("habits", data(), { habit: "h3" }, ch({ action: "update", title: "x" }), NOW).err, /no longer/);
  assert.match(E.plan("habits", data(), { habit: "h1" }, ch({ action: "update", date: "2026-10-20" }), NOW).err, /no date/);
  assert.match(E.plan("habits", data(), { habit: "h1" }, ch({ action: "update", title: "Read" }), NOW).err, /Nothing/);
});

test("habits: rename (number habit too) bumps mtime and wins the merge", () => {
  const d = data();
  const { p, a } = run(d, { habit: "h2" }, ch({ action: "update", title: "Pages read" }), NOW);
  assert.deepEqual(p.rows, [{ f: "title", b: "Pages", a: "Pages read" }]);
  const h = a.data.habits.find((x) => x.id === "h2");
  assert.equal(h.mtime, NOW); assert.deepEqual(h.num, d.habits[1].num);
  assert.equal(M.mergeData(d, a.data).habits.find((x) => x.id === "h2").name, "Pages read");
  const u = E.undo("habits", a.data, a.undo, NOW + 10);
  assert.ok(u.ok, u.err);
  assert.equal(M.mergeData(a.data, u.data).habits.find((x) => x.id === "h2").name, "Pages");
});

test("habits: undo of a tick puts it back with fresh stamps; refuses after a later change", () => {
  const d = data();
  const { a } = run(d, { habit: "h1" }, ch({ action: "complete" }), NOW);
  const u = E.undo("habits", a.data, a.undo, NOW + 100);
  assert.ok(u.ok, u.err);
  const m = M.mergeData(a.data, u.data);                              // the device that still has the tick
  assert.ok(!HC.isDone(m, "h1", TODAY));
  const b = JSON.parse(JSON.stringify(a.data));
  M.setTick(b, "h1", TODAY, false, NOW + 50);
  assert.match(E.undo("habits", b, a.undo, NOW + 100).err, /changed since/);
});

test("habits: conflict — ticked elsewhere after the plan, or the day rolled over", () => {
  const d = data(), c = ch({ action: "complete" });
  const p = E.plan("habits", d, { habit: "h1" }, c, NOW);
  const later = JSON.parse(JSON.stringify(d)); later.habits[0].name = "Read a book"; later.habits[0].mtime = NOW - 1;
  const r = E.apply("habits", later, { habit: "h1" }, c, NOW, p.before);
  assert.equal(r.ok, false); assert.equal(r.conflict, true);
  const r2 = E.apply("habits", d, { habit: "h1" }, c, NOW + 3600000, p.before);    // after local midnight
  assert.equal(r2.ok, false); assert.equal(r2.conflict, true);
});
