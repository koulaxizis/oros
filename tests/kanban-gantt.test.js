// Kanban Gantt wave G1: the plan field group g (start, ms, deps) in the
// card merge, and a mixed fleet with the 6.29.00 model (no group g),
// which keeps the plan keys on the whole card but rebuilds fm without g.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const M = require(path.join(__dirname, "..", "kanban/model.js"));
const OLD = require(path.join(__dirname, "fixtures", "kanban-model-6.29.00.js"));
const T = require(path.join(__dirname, "..", "kanban/tools.js"));

const NOW = Date.UTC(2026, 10, 13, 10, 0, 0);
const T0 = NOW - 3600e3;

function card(id, extra) {
  return Object.assign({ id, text: "Card " + id, notes: "", due: null, labels: [], subtasks: [], info: [], mtime: T0, pos: 0 }, extra || {});
}
function col(id, cards, extra) { return Object.assign({ id, name: id, mtime: T0, om: T0, pos: 0, cards }, extra || {}); }
function board(cols) { return { id: "b1", name: "B", archived: false, mtime: T0, om: T0, deleted: {}, labels: [], columns: cols }; }
function st(boards) { return { ver: 5, om: T0, boardDeleted: {}, boards }; }
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function canon(s) { return M.canonState(s, NOW); }
function k1(s) { return s.boards[0].columns[0].cards[0]; }
function edit(s, fn) { const x = clone(s); fn(k1(x)); return canon(x); }
function base(extra) { return canon(st([board([col("todo", [card("k1", Object.assign({ due: "2026-11-20" }, extra || {}))]), col("done", [])])])); }

test("cards without plan fields keep their exact bytes (no re-upload)", () => {
  const s = base();
  assert.equal(JSON.stringify(canon(s)), JSON.stringify(OLD.canonState(clone(s), NOW)));
  assert.equal(JSON.stringify(k1(s)).indexOf("start"), -1);
});

test("canon drops invalid plan values and keeps valid ones", () => {
  const s = canon(st([board([col("todo", [
    card("a", { start: "11/2026", ms: 0, deps: [] }),
    card("b", { start: "2026-11-02", ms: true, deps: ["b", "a", "a", 5] })
  ])])]));
  const [a, b] = s.boards[0].columns[0].cards;
  assert.ok(!("start" in a) && !("ms" in a) && !("deps" in a));
  assert.equal(b.start, "2026-11-02");
  assert.equal(b.ms, 1);
  assert.deepEqual(b.deps, ["a"], "no self, no duplicates, strings only");
});

test("a start edit on one device and a text edit on the other both survive", () => {
  const s0 = base();
  const A = edit(s0, (k) => { k.start = "2026-11-16"; M.stampCard(k, ["g"], NOW - 1000); });
  const B = edit(s0, (k) => { k.text = "Renamed"; M.stampCard(k, ["t"], NOW - 500); });
  const m1 = M.mergeKanbanStates(clone(A), clone(B), NOW), m2 = M.mergeKanbanStates(clone(B), clone(A), NOW);
  assert.equal(JSON.stringify(m1), JSON.stringify(m2), "symmetric");
  assert.equal(k1(m1).start, "2026-11-16");
  assert.equal(k1(m1).text, "Renamed");
  assert.equal(JSON.stringify(M.mergeKanbanStates(clone(m1), clone(A), NOW)), JSON.stringify(m1), "idempotent");
});

test("a moved bar (start + due) and a newer milestone switch: newest plan wins whole", () => {
  const s0 = base({ start: "2026-11-10" });
  const A = edit(s0, (k) => { k.start = "2026-11-12"; k.due = "2026-11-22"; M.stampCard(k, ["g", "d"], NOW - 900); });
  const B = edit(s0, (k) => { k.ms = 1; M.stampCard(k, ["g"], NOW - 800); });
  const m = M.mergeKanbanStates(clone(A), clone(B), NOW);
  assert.equal(k1(m).due, "2026-11-22", "due follows its own stamp");
  assert.equal(k1(m).ms, 1);
  assert.equal(k1(m).start, "2026-11-10", "the plan group is one value: B's newer plan");
});

test("an older version carries the plan fields through syncs and its own edits", () => {
  const s0 = edit(base(), (k) => { k.start = "2026-11-16"; k.deps = ["x1"]; M.stampCard(k, ["g"], NOW - 2000); });
  // plain sync on the old device: nothing lost
  const same = OLD.mergeKanbanStates(clone(s0), clone(s0), NOW);
  assert.equal(k1(same).start, "2026-11-16");
  // an edit there keeps the keys and the g stamp
  const B = clone(s0);
  k1(B).text = "Old edit";
  OLD.stampCard(k1(B), ["t"], NOW - 100);
  const b = OLD.canonState(B, NOW);
  assert.equal(k1(b).start, "2026-11-16");
  assert.deepEqual(k1(b).deps, ["x1"]);
  assert.equal(k1(b).fm.g, NOW - 2000);
});

// Sync rounds through one remote copy, like the engine: a device merges
// the remote into its copy and uploads when the result differs.
function settle(devices, remote) {
  let quiet = 0, rounds = 0, uploads = 0;
  while (quiet < devices.length && rounds < 40) {
    const d = devices[rounds % devices.length];
    rounds++;
    const merged = d.model.mergeKanbanStates(clone(d.local), clone(remote), NOW);
    d.local = merged;
    if (JSON.stringify(merged) !== JSON.stringify(remote)) { remote = merged; uploads++; quiet = 0; }
    else quiet++;
  }
  return { remote, rounds, uploads, settled: quiet >= devices.length };
}

test("mixed fleet: a start set here and a text edit on an older device converge, nothing lost", () => {
  const s0 = base();
  const neu = { model: M, local: edit(s0, (k) => { k.start = "2026-11-16"; M.stampCard(k, ["g"], NOW - 1000); }) };
  const old = { model: OLD, local: OLD.canonState(clone(edit(s0, (k) => { k.text = "Old text"; OLD.stampCard(k, ["t"], NOW - 500); })), NOW) };
  [[old, neu], [neu, old]].forEach((order) => {
    const devs = order.map((d) => ({ model: d.model, local: clone(d.local) }));
    const r = settle(devs, s0);
    assert.ok(r.settled, "no endless uploads");
    assert.ok(r.uploads <= 4, "a few uploads, then quiet (" + r.uploads + ")");
    assert.equal(k1(r.remote).start, "2026-11-16");
    assert.equal(k1(r.remote).text, "Old text");
    devs.forEach((d) => assert.equal(JSON.stringify(d.local), JSON.stringify(r.remote), "every device holds the same copy"));
  });
});

test("mixed fleet: a due edit on the older device and a milestone here", () => {
  const s0 = base({ start: "2026-11-10" });
  const neu = { model: M, local: edit(s0, (k) => { k.ms = 1; M.stampCard(k, ["g"], NOW - 700); }) };
  const old = { model: OLD, local: OLD.canonState(clone(edit(s0, (k) => { k.due = "2026-11-25"; OLD.stampCard(k, ["d"], NOW - 300); })), NOW) };
  const r = settle([old, neu], s0);
  assert.ok(r.settled);
  assert.equal(k1(r.remote).due, "2026-11-25");
  assert.equal(k1(r.remote).start, "2026-11-10");
  // the older device's newer d stamp counts for g there, so its plan (no
  // milestone) may win: what matters is one answer everywhere, no loop.
  assert.equal(JSON.stringify(neu.local), JSON.stringify(old.local));
});

test("plan helpers: bar span, workdays, shifting", () => {
  assert.deepEqual(T.planSpan({ start: "2026-11-16", due: "2026-11-20" }), { from: "2026-11-16", to: "2026-11-20", ms: false });
  assert.deepEqual(T.planSpan({ due: "2026-11-20" }), { from: "2026-11-20", to: "2026-11-20", ms: false });
  assert.deepEqual(T.planSpan({ start: "2026-11-16" }), { from: "2026-11-16", to: "2026-11-16", ms: false });
  assert.deepEqual(T.planSpan({ start: "2026-11-25", due: "2026-11-20" }), { from: "2026-11-20", to: "2026-11-25", ms: false });
  assert.deepEqual(T.planSpan({ start: "2026-11-16", due: "2026-11-20", ms: 1 }), { from: "2026-11-20", to: "2026-11-20", ms: true });
  assert.equal(T.planSpan({}), null);
  assert.equal(T.spanDays("2026-11-16", "2026-11-22", false), 7);
  assert.equal(T.spanDays("2026-11-16", "2026-11-22", true), 5, "Mon..Sun = 5 workdays");
  assert.equal(T.isWeekend("2026-11-14"), true);
  assert.equal(T.isWeekend("2026-11-16"), false);
  // move by days; workdays keep the working length and skip weekends
  assert.deepEqual(T.shiftSpan("2026-11-16", "2026-11-20", 2, false), { from: "2026-11-18", to: "2026-11-22" });
  assert.deepEqual(T.shiftSpan("2026-11-16", "2026-11-20", 2, true), { from: "2026-11-18", to: "2026-11-24" });
  assert.deepEqual(T.shiftSpan("2026-11-16", "2026-11-20", 5, true), { from: "2026-11-23", to: "2026-11-27" }, "Sat → Mon");
  assert.deepEqual(T.shiftSpan("2026-11-16", "2026-11-20", -2, true), { from: "2026-11-13", to: "2026-11-19" }, "Sat ← Fri backwards");
  assert.equal(T.nextWorkday("2026-11-14", 1), "2026-11-16");
  assert.equal(T.nextWorkday("2026-11-15", -1), "2026-11-13");
  assert.equal(T.progressOf({ subtasks: [{ completed: true }, { completed: false }, { completed: true }, { completed: true }] }), 0.75);
  assert.equal(T.progressOf({ subtasks: [] }), null);
});

test("timeline range covers starts as well as dues", () => {
  const r = T.timelineRange(["2026-11-20", "2026-09-01"], "2026-11-13");
  assert.ok(r.from <= "2026-08-31");
});

test("export / import and templates keep start, milestone, deps (re-mapped) and Only workdays", () => {
  const src = board([
    col("todo", [card("a", { start: "2026-11-16", due: "2026-11-20" }), card("b", { due: "2026-11-27", ms: 1, deps: ["a", "gone"] })], { gw: 1 }),
    col("done", [], { gw: 1 })
  ]);
  const json = T.exportBoard(src, null, NOW);
  const back = T.parseExport(JSON.parse(JSON.stringify(json)), T.counter(), NOW);
  const [a, b] = back.board.columns[0].cards;
  assert.equal(a.start, "2026-11-16");
  assert.equal(b.ms, 1);
  assert.deepEqual(b.deps, [a.id], "dependency follows the new id, a missing card is dropped");
  assert.ok(T.boardWorkdays(back.board));
  // a template (no dates kept) drops the start like the due date
  const tpl = T.rebuild(src, { uid: T.counter(), now: NOW });
  assert.ok(!("start" in tpl.columns[0].cards[0]));
  // CSV: start and milestone at the end of each row
  const csv = T.boardCsv(src, ["b", "c", "t", "n", "d", "l", "s", "k", "x", "a", "st", "ms"]).split("\r\n");
  assert.ok(/,2026-11-16,$/.test(csv[1]), csv[1]);
  assert.ok(/,,1$/.test(csv[2]), csv[2]);
});
