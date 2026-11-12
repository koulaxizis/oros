// Budget BK-AT (Chris 2026-11-12): banks update by themselves at 1 to 4
// times set in Banks › Automatic updates. budget/bankapi.js holds the
// schedule maths (times, slots, the last read across devices); budget.js
// keeps set.bat / set.bam; banklive.js runs the update on open or in
// the shell's hidden frame (?bankbg=1); shell.js 10f opens that frame
// at each time while Budget is closed.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const K = require("../budget/bankapi.js");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const src = read("budget/budget.js");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const B = new Function(
  block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  function cmpStr(", "  function newId(") +
  block("  // ---------- 2. Money", "  // ---------- 6. Storage") +
  "\nreturn { normSet, mergeBudget, emptyData };")();

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi || 0, 0, 0).getTime();

test("times: sorted, unique, 1 to 4 valid HH:MM; anything else is none", () => {
  assert.deepEqual(K.times("20:00 08:00"), ["08:00", "20:00"]);
  assert.deepEqual(K.times("08:00 08:00"), ["08:00"]);
  assert.deepEqual(K.times("00:00 06:30 12:00 23:59"), ["00:00", "06:30", "12:00", "23:59"]);
  assert.deepEqual(K.times("01:00 02:00 03:00 04:00 05:00"), []);
  assert.deepEqual(K.times("24:00"), []);
  assert.deepEqual(K.times("8:00"), []);
  assert.deepEqual(K.times(""), []);
  assert.deepEqual(K.times(null), []);
  assert.equal(K.timesText(["20:00", "08:00", "08:00", "bad", "25:00"]), "08:00 20:00");
  assert.equal(K.timesText(["01:00", "02:00", "03:00", "04:00", "05:00"]), "01:00 02:00 03:00 04:00");
  assert.equal(K.timesText([]), "");
  assert.equal(K.MAX_TIMES, 4);
});

test("lastSlot: the latest set time at or before now, yesterday's when today's are ahead", () => {
  const ts = ["08:00", "20:00"];
  assert.equal(K.lastSlot(ts, at(2026, 11, 12, 9, 30)), at(2026, 11, 12, 8));
  assert.equal(K.lastSlot(ts, at(2026, 11, 12, 8, 0)), at(2026, 11, 12, 8));
  assert.equal(K.lastSlot(ts, at(2026, 11, 12, 7, 59)), at(2026, 11, 11, 20));
  assert.equal(K.lastSlot(ts, at(2026, 11, 12, 23, 0)), at(2026, 11, 12, 20));
  // the first of a month: yesterday is the last day of the month before
  assert.equal(K.lastSlot(["22:00"], at(2026, 12, 1, 6)), at(2026, 11, 30, 22));
  assert.equal(K.lastSlot([], at(2026, 11, 12, 9)), 0);
});

test("slotDue: due once per time; a read since (any device) or a later save covers it", () => {
  const ts = ["08:00", "20:00"], now = at(2026, 11, 12, 9);
  assert.equal(K.slotDue(ts, 0, now), at(2026, 11, 12, 8));
  assert.equal(K.slotDue(ts, at(2026, 11, 12, 7), now), at(2026, 11, 12, 8));
  assert.equal(K.slotDue(ts, at(2026, 11, 12, 8, 1), now), 0);
  // missed overnight (orOS closed): the next open runs the latest slot only
  assert.equal(K.slotDue(ts, at(2026, 11, 10, 20), at(2026, 11, 12, 7)), at(2026, 11, 11, 20));
  assert.equal(K.slotDue([], 0, now), 0);
});

test("lastRead: this device, any row's bt, the times' saving; a future stamp is not counted", () => {
  const now = at(2026, 11, 12, 9);
  assert.equal(K.lastRead([], 0, 0, now), 0);
  assert.equal(K.lastRead([{ bt: at(2026, 11, 12, 8, 5) }, { bt: at(2026, 11, 11, 20, 5) }], at(2026, 11, 11, 21), 0, now), at(2026, 11, 12, 8, 5));
  assert.equal(K.lastRead([{}], 0, at(2026, 11, 12, 8, 30), now), at(2026, 11, 12, 8, 30));
  assert.equal(K.lastRead([{ bt: now + 3600000 }, { bt: "x" }], at(2026, 11, 12, 1), 0, now), at(2026, 11, 12, 1));
  // times saved after today's slot: that slot waits for tomorrow
  const saved = at(2026, 11, 12, 8, 30);
  assert.equal(K.slotDue(["08:00"], K.lastRead([], 0, saved, now), now), 0);
  assert.equal(K.slotDue(["08:00"], K.lastRead([], 0, saved, at(2026, 11, 13, 8, 1)), at(2026, 11, 13, 8, 1)), at(2026, 11, 13, 8));
});

test("set.bat / set.bam: kept when valid, dropped otherwise, merged with the settings (later m)", () => {
  assert.equal(B.normSet({ m: 1, cur: "EUR", bat: "08:00 20:00", bam: 5 }).bat, "08:00 20:00");
  assert.equal(B.normSet({ m: 1, cur: "EUR", bat: "08:00 20:00", bam: 5 }).bam, 5);
  assert.equal(B.normSet({ m: 1, cur: "EUR", bat: "8 o'clock" }).bat, undefined);
  assert.equal(B.normSet({ m: 1, cur: "EUR", bat: "01:00 02:00 03:00 04:00 05:00" }).bat, undefined);
  assert.equal(B.normSet({ m: 1, cur: "EUR", bam: -1 }).bam, undefined);
  assert.equal(B.normSet({ m: 1, cur: "EUR", bam: "1" }).bam, undefined);
  const a = Object.assign(B.emptyData(), { set: { m: 2, cur: "EUR", bat: "08:00", bam: 2 } });
  const b = Object.assign(B.emptyData(), { set: { m: 3, cur: "EUR", bat: "07:30 19:30", bam: 3 } });
  assert.equal(B.mergeBudget(a, b).set.bat, "07:30 19:30");
  assert.deepEqual(B.mergeBudget(a, b), B.mergeBudget(b, a));
});

test("banklive: set times replace the 6-hour rule, bt is written only with set times, the hidden run reports", () => {
  const lv = read("budget/banklive.js");
  assert.match(lv, /function isDue\(now\)[\s\S]*?if \(!ts\.length\) return K\.due\(/);
  assert.match(lv, /K\.slotDue\(ts, K\.lastRead\(live\(\), dev && dev\.t, \(A\.data\(\)\.set \|\| \{\}\)\.bam, now\), now\)/);
  assert.match(lv, /if \(sched\) rows\.forEach\(function \(r\) \{ if \(!errs\[r\.id\]\) put\(r\.id, \{ bt: at \}\); \}\);/);
  assert.match(lv, /oros: "bank-bg-done", app: "budget"/);
  assert.match(lv, /var QUIET = \{ keys: 1, noapp: 1, offline: 1 \};/);
  // the hidden run takes no bank answers and runs nothing else
  assert.match(lv, /if \(bgMode\(\)\) \{ setTimeout\(bgRun, 0\); return; \}\s*listen\(\);/);
  // every Banks string in both languages
  ["atT", "atMode", "atSix", "atSet", "atSixHint", "atHint", "atOne", "atAdd", "atRemove"].forEach((k) => {
    assert.equal((lv.match(new RegExp("\\b" + k + ": \"", "g")) || []).length, 2, k);
  });
  assert.match(src, /saveTimes: saveBankTimes/);
});

test("shell 10f: ticks, opens Budget hidden with ?bankbg=1, stops when Budget opens, notifies only with an error", () => {
  const sh = read("shell.js");
  assert.match(sh, /tickSafe\("bankBgTick", bankBgTickThrottled\)/);
  assert.match(sh, /davBgStop\(app\.id\); bankBgStop\(app\.id\);/);
  assert.match(sh, /frameGo\(f, bgUrl\(app, "bankbg=1"\)\)/);
  assert.match(sh, /if \(appLive\("budget"\)\) return;/);
  assert.match(sh, /localStorage\.setItem\("oros-budget-bank-bg", JSON\.stringify\(\{ at: slot \}\)\)/);
  assert.match(sh, /if \(r && r\.text\) \{/);
  assert.match(sh, /key: "bankbg:" \+ sysYmd\(\) \+ ":" \+ r\.err/);
  assert.match(sh, /bankBg && bankBg\.el\.contentDocument/);
  // the schedule maths is the file Budget runs
  assert.match(read("index.html"), /<script src="budget\/bankapi\.js\?v=[\d.]+"><\/script>/);
});
