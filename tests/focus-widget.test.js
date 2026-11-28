// Focus timer widget (FOCUS-W, video ideas 2026-11-23 #8): the Time
// app's Pomodoro on the desktop, on the same record (oros-time-pmrun)
// and the same engine alarm as Time. Pause / Resume, Skip and ±5 min;
// Focus legs that end while Time is closed are counted by Time later.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const W = require(path.join(ROOT, "widgets.js"));
const MIN = 60000;
const LENS = { work: 25 * MIN, break: 5 * MIN };
const plain = (o) => JSON.parse(JSON.stringify(o));

test("the card is a desktop widget kind, painted in the gallery too", () => {
  assert.equal(W.VER, "1.7.0");
  assert.ok(W.KINDS.includes("pomo"));
  assert.ok(!W.DEFAULT.includes("pomo"), "not on the desktop until added");
  assert.ok(W.PREVIEW_PAINT.includes("pomo"));
  assert.equal(W.PM_KEY, "oros-time-pmrun");
});

test("reads every form Time and the card write; odd records are Focus, not started", () => {
  assert.deepEqual(plain(W.pmParse(null)), { phase: "work", mode: "idle", done: 0 });
  assert.deepEqual(plain(W.pmParse("junk")), { phase: "work", mode: "idle", done: 0 });
  assert.deepEqual(plain(W.pmParse(JSON.stringify({ phase: "work", end: 5000, alarmId: "a1", start: 1000, logged: 1 }))),
    { phase: "work", mode: "run", done: 0, end: 5000, alarmId: "a1", start: 1000, logged: 1 }, "Time's own running record");
  assert.deepEqual(plain(W.pmParse(JSON.stringify({ phase: "break", left: 90000, paused: 1, done: 2 }))),
    { phase: "break", mode: "pause", done: 2, left: 90000 });
  assert.deepEqual(plain(W.pmParse(JSON.stringify({ phase: "break", idle: 1 }))), { phase: "break", mode: "idle", done: 0 });
  assert.equal(W.pmParse(JSON.stringify({ phase: "work", left: 9e9, paused: 1 })).left, 120 * MIN, "capped at 2 h");
  assert.equal(W.pmParse(JSON.stringify({ done: 1e6 })).done, 0);
});

test("start, pause, resume, skip and ±5 min", () => {
  const now = 1_000_000;
  let s = W.pmParse(null);
  assert.equal(W.pmLeft(s, now, LENS), 25 * MIN);
  s = W.pmStartOf(s, now, LENS);
  assert.equal(s.mode, "run");
  assert.equal(s.end, now + 25 * MIN);
  assert.equal(W.pmStartOf(s, now + 5, LENS), s, "Start on a running leg changes nothing");
  s = W.pmPauseOf(s, now + 10 * MIN);
  assert.deepEqual(plain(s), { phase: "work", mode: "pause", left: 15 * MIN, done: 0 });
  s = W.pmPlusOf(s, now, W.PM_STEP);
  assert.equal(s.left, 20 * MIN);
  s = W.pmStartOf(s, now + 20 * MIN, LENS);
  assert.equal(s.end, now + 40 * MIN, "resume goes on from what was left");
  s = W.pmPlusOf(s, now + 39 * MIN, -W.PM_STEP);
  assert.equal(s.end, now + 40 * MIN, "never under 1 min left");
  s = W.pmPlusOf(s, now + 20 * MIN, 500 * MIN);
  assert.equal(s.end, now + 20 * MIN + 120 * MIN, "never over 2 h");
  const sk = W.pmSkipOf(s);
  assert.deepEqual(plain(sk), { phase: "break", mode: "idle", done: 0 });
  assert.equal(W.pmLeft(sk, now, LENS), 5 * MIN);
  assert.equal(W.pmPlusOf(sk, now, W.PM_STEP), sk, "±5 only on a started leg");
});

test("a Focus leg that ended counts once; Break comes next; the record Time keeps", () => {
  const run = W.pmParse(JSON.stringify({ phase: "work", end: 1000, alarmId: "a", start: 0 }));
  assert.equal(W.pmSettle(run, 999), run);
  const over = W.pmSettle(run, 1000);
  assert.deepEqual(plain(over), { phase: "break", mode: "idle", done: 1 });
  assert.deepEqual(W.pmRecord(over), { phase: "break", idle: 1, done: 1 });
  const brk = W.pmSettle(W.pmParse(JSON.stringify({ phase: "break", end: 1000 })), 2000);
  assert.deepEqual(plain(brk), { phase: "work", mode: "idle", done: 0 }, "a Break does not count");
  assert.equal(W.pmRecord(brk), null, "Focus, not started: the key goes");
  assert.deepEqual(W.pmRecord({ phase: "work", mode: "idle", done: 2 }), { phase: "work", idle: 1, done: 2 });
  assert.deepEqual(W.pmRecord({ phase: "work", mode: "run", end: 5, alarmId: "x", start: 1, logged: 0, done: 0 }),
    { phase: "work", end: 5, alarmId: "x", start: 1, logged: 0 });
});

test("lengths come from Time's settings, 25 / 5 by default", () => {
  assert.deepEqual(W.pmLens(null), LENS);
  assert.deepEqual(W.pmLens(JSON.stringify({ pmWork: 50, pmBreak: 10 })), { work: 50 * MIN, break: 10 * MIN });
  assert.deepEqual(W.pmLens(JSON.stringify({ pmWork: 999, pmBreak: 0 })), { work: 120 * MIN, break: 1 * MIN });
  assert.equal(W.pmClock(25 * MIN), "25:00");
  assert.equal(W.pmClock(61001), "1:02");
});

test("wiring: the engine alarm first, then the record; Time follows the record", () => {
  const w = read("widgets.js");
  assert.match(w, /A\.add\(\{ at: next\.end/);
  assert.match(w, /if \(!id\) return;/, "an alarm the engine refuses changes nothing");
  const T = read("time/time.js");
  assert.match(T, /if \(ev\.key === PMRUN_KEY\) pmReload\(\);/);
  assert.match(T, /state\.pmDone \+= Math\.floor\(rt\.done\);/);
  assert.match(T, /JSON\.stringify\(\{ phase: pmPhase, left: pmLeft, paused: 1 \}\)/);
  assert.match(T, /JSON\.stringify\(\{ phase: "break", idle: 1 \}\)/);
  assert.match(T, /pmEnd = pmStart \+ \(pmLeft \|\| pmLen\(\)\);/);
  assert.match(read("time/index.html"), /id="pm-paused"/);
});

test("strings in EN, EL and DE", () => {
  const tr = read("translations.js"), de = read("i18n/de/shell.js");
  for (const k of ["wg.pomo", "wg.pomo.work", "wg.pomo.break", "wg.pomo.start", "wg.pomo.pause", "wg.pomo.resume", "wg.pomo.skip",
    "wg.pomo.skipTo", "wg.pomo.minus", "wg.pomo.plus", "wg.pomo.paused", "wg.pomo.ready"]) {
    assert.equal(tr.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.includes('"' + k + '":'), "de " + k);
  }
  assert.equal(read("time/time.js").split('"pm.paused":').length - 1, 2);
  assert.ok(read("i18n/de/time.js").includes('"pm.paused":'));
});
