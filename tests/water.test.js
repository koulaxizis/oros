// Water: the shared core (water/core.js) — normalize, the sync merge
// (slice "water"), day maths, the reminder rule the shell engine
// uses, the Habits feed, CSV — plus a two-device round trip through
// the real sync engine (tests/harness.js).
// Run: node --test tests/
//
// Every date here is built in LOCAL time (new Date(y, m, d, h, min)):
// the app derives a drink's day from its timestamp the same way.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../water/core.js");
const { FakeDropbox, createDevice, readKey, writeKey } = require("./harness");

const at = (d, h, m) => new Date(2026, 9, d, h, m || 0).getTime();   // October 2026
const key = (d) => "2026-10-" + String(d).padStart(2, "0");
const sip = (id, ts, ml, m) => ({ id, ts, ml, m: m === undefined ? ts : m });
function model(sips, extra) {
  return C.normalize(Object.assign({ ver: 1, sips: sips || [], goals: [] }, extra || {}));
}
const json = (x) => JSON.stringify(x);

// ---------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------

test("normalize: bad rows dropped, rows sorted by id, defaults filled", () => {
  const d = C.normalize({
    sips: [
      sip("zzzzzz1", at(1, 9), 250),
      sip("aaaaaa1", at(1, 8), 300),
      { id: "bad id!", ts: at(1, 9), ml: 250, m: 1 },        // id
      { id: "cccccc1", ts: at(1, 9), ml: 0, m: 1 },          // ml below range
      { id: "cccccc2", ts: at(1, 9), ml: 9000, m: 1 },       // ml above range
      { id: "cccccc3", ts: -5, ml: 250, m: 1 },              // ts
      { id: "cccccc4", ts: at(1, 9), ml: 250.5, m: 1 },      // not an integer
      { id: "dddddd1", m: 7, del: 1, ts: 1, ml: 5 }          // tombstone keeps id + m only
    ],
    goals: [{ id: "2026-02-30", ml: 2000, m: 1 }, { id: "2026-10-01", ml: 100, m: 1 }, { id: "2026-10-02", ml: 2500, m: 1 }]
  });
  assert.deepEqual(d.sips.map((s) => s.id), ["aaaaaa1", "dddddd1", "zzzzzz1"]);
  assert.deepEqual(d.sips[1], { id: "dddddd1", m: 7, del: 1 });
  assert.deepEqual(d.goals, [{ id: "2026-10-02", ml: 2500, m: 1 }]);
  assert.deepEqual(d.prefs, C.DEFAULT_PREFS);
  assert.equal(d.pm, 0);
  assert.equal(d.ver, 1);
});

test("normalize: prefs clamp to defaults field by field, window must be ordered", () => {
  const p = C.normPrefs({ glass: 20, bottle: 750, unit: "litres", rem: { on: true, from: 600, to: 500, every: 10 }, habits: 0 });
  assert.deepEqual(p, { glass: 250, bottle: 750, unit: "ml", rem: { on: 1, from: 540, to: 1260, every: 120 }, habits: 0 });
  assert.equal(json(Object.keys(C.normPrefs({ habits: 1, unit: "oz", glass: 300 }))), json(["glass", "bottle", "unit", "rem", "habits"]));
});

test("parse: missing → empty model, unreadable → null (the app keeps a rescue copy)", () => {
  assert.deepEqual(C.parse(null), C.empty());
  assert.equal(C.parse("{oops"), null);
  assert.equal(C.parse(json({ sips: "no" })), null);
  assert.equal(C.parse(json(model([sip("aaaaaa1", at(1, 9), 250)]))).sips.length, 1);
});

// ---------------------------------------------------------------
// Merge
// ---------------------------------------------------------------

test("merge: two devices adding at the same time keep every drink", () => {
  const base = model([sip("base001", at(3, 8), 250)]);
  const a = model(base.sips.concat([sip("aaaaaa1", at(3, 10), 250)]));
  const b = model(base.sips.concat([sip("bbbbbb1", at(3, 10), 500)]));
  const m = C.mergeWater(a, b);
  assert.deepEqual(m.sips.map((s) => s.id), ["aaaaaa1", "base001", "bbbbbb1"]);
  assert.equal(C.dayTotal(m, key(3)), 1000);
});

test("merge: symmetric, idempotent, canonical (a second sync uploads nothing)", () => {
  const a = model([sip("aaaaaa1", at(3, 10), 250), sip("cccccc1", at(3, 11), 200, 50)],
    { goals: [{ id: key(1), ml: 2500, m: 5 }], prefs: { unit: "glass" }, pm: 9 });
  const b = model([sip("bbbbbb1", at(3, 12), 500), { id: "cccccc1", m: 60, del: 1 }],
    { goals: [{ id: key(1), ml: 3000, m: 6 }, { id: key(2), ml: 1800, m: 2 }], prefs: { unit: "oz" }, pm: 4 });
  const ab = C.mergeWater(a, b), ba = C.mergeWater(b, a);
  assert.equal(json(ab), json(ba));
  assert.equal(json(C.mergeWater(ab, ab)), json(ab));
  assert.equal(json(C.normalize(JSON.parse(json(ab)))), json(ab));
  assert.equal(ab.prefs.unit, "glass", "newer prefs stamp wins");
  assert.equal(ab.pm, 9);
  assert.deepEqual(ab.goals, [{ id: key(1), ml: 3000, m: 6 }, { id: key(2), ml: 1800, m: 2 }]);
  assert.deepEqual(ab.sips.find((s) => s.id === "cccccc1"), { id: "cccccc1", m: 60, del: 1 });
});

test("merge: delete vs edit — the newer stamp wins, a tie goes to the delete, undo resurrects", () => {
  const live = sip("aaaaaa1", at(3, 10), 250, 100);
  const edited = sip("aaaaaa1", at(3, 10), 400, 120);
  const gone = { id: "aaaaaa1", m: 110, del: 1 };
  assert.equal(C.mergeWater(model([edited]), model([gone])).sips[0].ml, 400);
  assert.equal(C.mergeWater(model([live]), model([gone])).sips[0].del, 1);
  const tieDel = { id: "aaaaaa1", m: 100, del: 1 };
  assert.equal(C.mergeWater(model([live]), model([tieDel])).sips[0].del, 1);
  assert.equal(C.mergeWater(model([tieDel]), model([live])).sips[0].del, 1);
  const back = sip("aaaaaa1", at(3, 10), 250, 111);
  assert.equal(C.mergeWater(model([gone]), model([back])).sips[0].ml, 250);
});

test("merge: equal prefs stamps pick the same record on both sides", () => {
  const a = model([], { prefs: { glass: 200 }, pm: 5 });
  const b = model([], { prefs: { glass: 300 }, pm: 5 });
  assert.equal(json(C.mergeWater(a, b)), json(C.mergeWater(b, a)));
});

test("merge: inputs are not mutated", () => {
  const a = model([sip("aaaaaa1", at(3, 10), 250)]);
  const b = model([{ id: "aaaaaa1", m: at(3, 10) + 1, del: 1 }]);
  const sa = json(a), sb = json(b);
  C.mergeWater(a, b);
  assert.equal(json(a), sa);
  assert.equal(json(b), sb);
});

// ---------------------------------------------------------------
// Day maths
// ---------------------------------------------------------------

test("totals: a drink belongs to its local day, tombstones do not count", () => {
  const d = model([
    sip("aaaaaa1", at(4, 23, 59), 300),
    sip("aaaaaa2", at(5, 0, 0), 200),
    sip("aaaaaa3", at(5, 9), 250),
    { id: "aaaaaa4", m: 5, del: 1 }
  ]);
  assert.equal(C.dayTotal(d, key(4)), 300);
  assert.equal(C.dayTotal(d, key(5)), 450);
  assert.deepEqual(C.daySips(d, key(5)).map((s) => s.id), ["aaaaaa2", "aaaaaa3"]);
  assert.equal(C.firstDay(d), key(4));
  assert.equal(C.hasAny(model([{ id: "aaaaaa4", m: 5, del: 1 }])), false);
});

test("goals: a change applies from its day on, earlier days keep theirs", () => {
  const d = model([]);
  assert.equal(C.goalFor(d, key(1)), C.DEFAULT_GOAL);
  C.setGoal(d, key(10), 2500, 1000);
  assert.equal(C.goalFor(d, key(9)), 2500, "before the first goal: that goal");
  C.setGoal(d, key(20), 3000, 2000);
  assert.equal(C.goalFor(d, key(15)), 2500);
  assert.equal(C.goalFor(d, key(20)), 3000);
  assert.equal(C.goalFor(d, key(31)), 3000);
  C.setGoal(d, key(20), 2800, 1500);                     // same day again: stamp still rises
  assert.equal(C.goalFor(d, key(20)), 2800);
  assert.equal(d.goals.find((g) => g.id === key(20)).m, 2001);
});

test("streaks, average and on-goal rate", () => {
  const sips = [];
  // Oct 1–3 met (2000), Oct 4 missed (1000), Oct 5–6 met, today Oct 7 half
  [1, 2, 3, 5, 6].forEach((d) => sips.push(sip("d" + d + "aaaaa", at(d, 10), 2000)));
  sips.push(sip("d4aaaaa", at(4, 10), 1000));
  sips.push(sip("d7aaaaa", at(7, 10), 1000));
  const d = model(sips);
  assert.deepEqual(C.streaks(d, key(7)), { current: 2, longest: 3 });
  assert.equal(C.average(d, key(7), 7), Math.round((2000 * 5 + 1000) / 6));
  assert.equal(C.goalRate(d, key(7)), Math.round(5 * 100 / 6));
  d.sips.push(sip("d7bbbbb", at(7, 12), 1000));
  const d2 = C.normalize(d);
  assert.deepEqual(C.streaks(d2, key(7)), { current: 3, longest: 3 });
  assert.equal(C.goalRate(d2, key(7)), Math.round(6 * 100 / 7));
  assert.deepEqual(C.streaks(model([]), key(7)), { current: 0, longest: 0 });
  assert.equal(C.average(model([]), key(7), 7), null);
});

// ---------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------

test("amounts in ml, glasses and fl oz, both languages", () => {
  const p = (unit) => C.normPrefs({ unit, glass: 250 });
  assert.equal(C.fmtAmount(1250, p("ml"), "en"), "1,250 ml");
  assert.equal(C.fmtAmount(1250, p("ml"), "el"), "1.250 ml");
  assert.equal(C.fmtAmount(1250, p("glass"), "en"), "5 glasses");
  assert.equal(C.fmtAmount(250, p("glass"), "el"), "1 ποτήρι");
  assert.equal(C.fmtAmount(375, p("glass"), "el"), "1,5 ποτήρια");
  assert.equal(C.fmtAmount(500, p("oz"), "en"), "16.9 fl oz");
  assert.equal(C.fmtMinutes(545), "09:05");
});

// ---------------------------------------------------------------
// Reminder rule (shell engine)
// ---------------------------------------------------------------

function remModel(sips, rem) {
  return model(sips, { prefs: { rem: Object.assign({ on: 1, from: 540, to: 1260, every: 120 }, rem || {}) }, pm: 1 });
}

test("reminder: off by default, silent before the first drink ever", () => {
  const used = model([sip("aaaaaa1", at(6, 9), 250)]);
  assert.equal(C.reminderDue(used, new Date(at(7, 15))), null, "default prefs: off");
  assert.equal(C.reminderDue(remModel([]), new Date(at(7, 15))), null, "never used (SH-B7)");
});

test("reminder: due when behind the pace and nothing drunk for the interval", () => {
  const d = remModel([sip("aaaaaa1", at(7, 9, 30), 250)]);
  // 09:00–21:00 window, goal 2000; at 12:00 the pace is 500 ml
  const due = C.reminderDue(d, new Date(at(7, 12, 0)));
  assert.ok(due);
  assert.equal(due.key, "water-" + key(7) + "-1");
  assert.equal(due.total, 250);
  assert.equal(due.goal, 2000);
  assert.equal(C.reminderDue(d, new Date(at(7, 11, 0))), null, "last drink 90 min ago < 120");
  assert.equal(C.reminderDue(d, new Date(at(7, 8, 59))), null, "before the window");
  assert.equal(C.reminderDue(d, new Date(at(7, 21, 0))), null, "after the window");
  assert.equal(C.reminderDue(d, new Date(at(7, 14, 0))).key, "water-" + key(7) + "-2", "next slot, new key");
});

test("reminder: silent on pace, at the goal, and right after a drink", () => {
  const onPace = remModel([sip("aaaaaa1", at(7, 9, 30), 1000)]);
  assert.equal(C.reminderDue(onPace, new Date(at(7, 13, 0))), null);
  const met = remModel([sip("aaaaaa1", at(7, 9, 30), 2000)]);
  assert.equal(C.reminderDue(met, new Date(at(7, 20, 0))), null);
  const recent = remModel([sip("aaaaaa1", at(6, 9), 250), sip("aaaaaa2", at(7, 15, 30), 250)]);
  assert.equal(C.reminderDue(recent, new Date(at(7, 16, 0))), null);
  // a drink yesterday only: the window start counts as the last drink
  const fresh = remModel([sip("aaaaaa1", at(6, 9), 250)]);
  assert.equal(C.reminderDue(fresh, new Date(at(7, 10, 59))), null);
  assert.ok(C.reminderDue(fresh, new Date(at(7, 11, 0))));
});

test("reminder text in both languages", () => {
  const p = C.normPrefs({});
  const en = C.reminderText({ total: 500, goal: 2000 }, p, "en");
  assert.equal(en.title, "Time for some water");
  assert.equal(en.body, "Today: 500 of 2,000 ml. 1,500 ml to go.");
  const el = C.reminderText({ total: 500, goal: 2000 }, C.normPrefs({ unit: "glass" }), "el");
  assert.equal(el.body, "Σήμερα: 2 από 8 ποτήρια. Μένουν 6 ποτήρια.");
});

// ---------------------------------------------------------------
// Habits feed + CSV
// ---------------------------------------------------------------

test("Habits feed: met days only, hidden when off or unused", () => {
  const store = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (k) => (store.has(k) ? store.get(k) : null) }
  });
  try {
    assert.equal(C.FEED.read(), null, "no data");
    const d = model([sip("aaaaaa1", at(1, 9), 2000), sip("aaaaaa2", at(2, 9), 500)]);
    store.set(C.STORAGE_KEY, json(d));
    assert.deepEqual(C.FEED.read(), { days: { [key(1)]: true }, first: key(1) });
    d.prefs.habits = 0;
    store.set(C.STORAGE_KEY, json(d));
    assert.equal(C.FEED.read(), null, "Show in Habits off");
    store.set(C.STORAGE_KEY, "{broken");
    assert.equal(C.FEED.read(), null, "unreadable data");
  } finally {
    delete globalThis.localStorage;
  }
  assert.equal(C.FEED.id, "water");
  assert.deepEqual(C.FEED.keys, [C.STORAGE_KEY]);
  assert.match(C.FEED.icon, /^<svg/);
  assert.match(C.FEED.color, /^#[0-9a-f]{6}$/i);
});

test("CSV: one line per drink in time order, tombstones left out", () => {
  const d = model([sip("bbbbbb1", at(2, 9, 5), 250), sip("aaaaaa1", at(2, 14, 30), 330), { id: "cccccc1", m: 3, del: 1 }]);
  assert.equal(C.toCsv(d), "date,time,ml\r\n2026-10-02,09:05,250\r\n2026-10-02,14:30,330\r\n");
});

// ---------------------------------------------------------------
// Two devices through the real sync engine
// ---------------------------------------------------------------

test("sync: offline drinks on two devices both survive, then nothing re-uploads", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A");
  const B = await createDevice(db, "B");
  const reg = (dev) => dev.sync.registerSlice("water",
    () => C.normalize(readKey(dev, C.STORAGE_KEY)),
    (data) => writeKey(dev, C.STORAGE_KEY, C.mergeWater(readKey(dev, C.STORAGE_KEY), data)),
    C.STORAGE_KEY, C.mergeWater);
  reg(A); reg(B);

  writeKey(A, C.STORAGE_KEY, model([sip("base001", at(3, 8), 250)]));
  A.sync.markDirty();
  await A.sync.push();
  await B.sync.pull();

  const add = (dev, s) => {
    const cur = readKey(dev, C.STORAGE_KEY);
    cur.sips.push(s);
    writeKey(dev, C.STORAGE_KEY, C.normalize(cur));
    dev.sync.markDirty();
  };
  add(A, sip("aaaaaa1", at(3, 10), 250));
  add(B, sip("bbbbbb1", at(3, 10), 500));
  await A.sync.push();
  await B.sync.push();          // stale: refused, merged, retried
  await A.sync.pull();

  const a = readKey(A, C.STORAGE_KEY), b = readKey(B, C.STORAGE_KEY);
  assert.equal(json(a), json(b));
  assert.equal(C.dayTotal(a, key(3)), 1000);

  assert.equal(A.sync.isDirty(), false, "A: nothing left to push once converged");
  assert.equal(B.sync.isDirty(), false, "B: nothing left to push once converged");
  await B.sync.pull();
  assert.equal(B.sync.isDirty(), false, "a pull of the same state marks nothing dirty");
});
