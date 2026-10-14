// Tests for gamekit/daily.js (Wave 49): day numbers, seeds, the seeded
// random stream, streaks, times and the spoiler-free share text.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../gamekit/daily.js");

test("gamekit: day 0 is 1 Jan 2026 (local date) and dates round-trip", () => {
  assert.equal(D.dayIndex(new Date(2026, 0, 1, 0, 1)), 0);
  assert.equal(D.dayIndex(new Date(2026, 0, 1, 23, 59)), 0);
  assert.equal(D.dayIndex(new Date(2026, 9, 14, 12)), 286);
  assert.equal(D.dateStr(0), "2026-01-01");
  assert.equal(D.dateStr(286), "2026-10-14");
  assert.equal(D.dateStr(-1), "2025-12-31");
  for (let day = -400; day < 3000; day += 37) {
    const [y, m, d] = D.dateStr(day).split("-").map(Number);
    assert.equal(D.dayIndex(new Date(y, m - 1, d, 12)), day);
  }
  // a daylight-saving change does not skip or repeat a day
  assert.equal(D.dayIndex(new Date(2026, 2, 30, 12)) - D.dayIndex(new Date(2026, 2, 28, 12)), 2);
  assert.equal(D.dayIndex(new Date(2026, 9, 26, 12)) - D.dayIndex(new Date(2026, 9, 24, 12)), 2);
});

test("gamekit: seeds are per game and date; the stream is deterministic", () => {
  assert.equal(D.seedOf("sudoku", 286), "sudoku:2026-10-14");
  assert.notEqual(D.hashStr(D.seedOf("sudoku", 286)), D.hashStr(D.seedOf("nonogram", 286)));
  const a = D.random("x:1"), b = D.random("x:1"), c = D.random("x:2");
  const sa = [], sb = [], sc = [];
  for (let i = 0; i < 50; i++) { sa.push(a()); sb.push(b()); sc.push(c()); }
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  assert.ok(sa.every((x) => x >= 0 && x < 1));
  const r = D.randInt(42);
  for (let i = 0; i < 200; i++) { const v = r(7); assert.ok(Number.isInteger(v) && v >= 0 && v < 7); }
  // a known value guards against an accidental change of the generator
  // (it would give everyone a different daily puzzle than yesterday's app)
  assert.equal(D.hashStr("abc"), 0x1a47e90b);
  const k = D.counter();
  assert.equal(k(), 0); assert.equal(k(), 1); assert.equal(k(), 2);
});

test("gamekit: streaks count back from today, or from yesterday when today is open", () => {
  assert.deepEqual(D.streaks({}, 10), { cur: 0, best: 0 });
  assert.deepEqual(D.streaks({ 8: 1, 9: 1, 10: 1 }, 10), { cur: 3, best: 3 });
  assert.deepEqual(D.streaks({ 8: 1, 9: 1 }, 10), { cur: 2, best: 2 });
  assert.deepEqual(D.streaks({ 7: 1, 8: 1 }, 10), { cur: 0, best: 2 });
  assert.deepEqual(D.streaks({ 1: 1, 2: 1, 3: 1, 4: 1, 9: 1, 10: 1 }, 10), { cur: 2, best: 4 });
  assert.deepEqual(D.streaks({ 5: 0, 6: true }, 6), { cur: 1, best: 1 });
  assert.deepEqual(D.streaks({ "x": 1, "-1": 1, "0": 1 }, 0), { cur: 2, best: 2 });
});

test("gamekit: times and the share text", () => {
  assert.equal(D.fmtTime(0), "0:00");
  assert.equal(D.fmtTime(65400), "1:05");
  assert.equal(D.fmtTime(3725000), "1:02:05");
  const s = D.shareText({ game: "Sudoku", day: 286, line: "4:12 · no hints", grid: ["🟩🟩🟩", "🟩🟨🟩"] });
  assert.equal(s, "orOS Sudoku · Daily #287 · 2026-10-14\n4:12 · no hints\n\n🟩🟩🟩\n🟩🟨🟩");
  assert.equal(D.shareText({ game: "Flow", day: 0, label: "Ημερήσιο" }), "orOS Flow · Ημερήσιο #1 · 2026-01-01");
  // no shell in Node: no hub, no target, no share sheet
  assert.equal(D.hasHub(), false);
  assert.equal(D.takeTarget("sudoku"), null);
  assert.equal(D.shareOnMobile(), false);
});
