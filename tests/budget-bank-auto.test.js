// Budget BK-AO (Chris 2026-11-18 «ρύθμισε το orOS ώστε να κάνει αυτόματα
// την ενημέρωση, να μην τη ζητάς από μένα»): the banks update by
// themselves while orOS is open in every mode but "off" (the 6-hour mode
// now runs with Budget closed too, shell.js 10f), Automatic updates can
// be turned off (set.bao), and the Gate's budget_refresh reads the banks
// now from an open device (never queued: the bank key stays there).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
global.window = global.window || {};
const K = require("../budget/bankapi.js");
const G = require("../gate/gate.js");

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

const H = 3600000;
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi || 0, 0, 0).getTime();
let R;
test.before(async () => { R = await import("../relay/gate.js"); });

test("autoMode: off wins over times; times; else every 6 hours", () => {
  assert.equal(K.autoMode(null), "six");
  assert.equal(K.autoMode({}), "six");
  assert.equal(K.autoMode({ bat: "08:00 20:00" }), "set");
  assert.equal(K.autoMode({ bat: "bad" }), "six");
  assert.equal(K.autoMode({ bao: 1, bat: "08:00" }), "off");
  assert.equal(K.autoMode({ bao: true }), "six", "only bao 1 turns it off");
});

test("autoDue, every 6 hours: on open when 6 hours old, then not before 6 hours, from this device's update or the shell's last run", () => {
  const now = at(2026, 11, 18, 21);
  assert.equal(K.autoDue({}, [], 0, 0, now), now, "never updated here: now");
  assert.equal(K.autoDue({}, [], now - 7 * H, 0, now), now);
  assert.equal(K.autoDue({}, [], now - 5 * H, 0, now), 0);
  assert.equal(K.autoDue({}, [], now - 7 * H, now - H, now), 0, "the shell tried an hour ago");
  assert.equal(K.autoDue({}, [], now + H, 0, now), now, "a stamp from the future is not counted");
});

test("autoDue, set times: the slot as before; off: never", () => {
  const set = { bat: "08:00 20:00" }, now = at(2026, 11, 18, 21);
  assert.equal(K.autoDue(set, [], 0, 0, now), at(2026, 11, 18, 20));
  assert.equal(K.autoDue(set, [{ bt: at(2026, 11, 18, 20, 5) }], 0, 0, now), 0, "another device read it");
  assert.equal(K.autoDue(set, [], 0, at(2026, 11, 18, 20), now), 0, "the shell tried this slot");
  assert.equal(K.autoDue({ bao: 1, bat: "08:00 20:00" }, [], 0, 0, now), 0);
  assert.equal(K.autoDue({ bao: 1 }, [], 0, 0, now), 0);
});

test("set.bao: kept only as 1, synced with the settings", () => {
  assert.equal(B.normSet({ m: 1, cur: "EUR", bao: 1 }).bao, 1);
  assert.equal(B.normSet({ m: 1, cur: "EUR", bao: true }).bao, undefined);
  assert.equal(B.normSet({ m: 1, cur: "EUR", bao: 2 }).bao, undefined);
  const a = Object.assign(B.emptyData(), { set: { m: 2, cur: "EUR", bao: 1, bat: "08:00" } });
  const b = Object.assign(B.emptyData(), { set: { m: 3, cur: "EUR" } });
  assert.equal(B.mergeBudget(a, b).set.bao, undefined, "the later settings win");
  assert.deepEqual(B.mergeBudget(a, b), B.mergeBudget(b, a));
  assert.match(src, /function saveBankTimes\(bat, off\) \{/);
  assert.match(src, /if \(off\) data\.set\.bao = 1; else delete data\.set\.bao;/);
});

test("banklive: Off in Automatic updates, a forced hidden run, runNow for an open Budget", () => {
  const lv = read("budget/banklive.js");
  assert.match(lv, /\["off", t\("atOff"\)\]/);
  assert.match(lv, /mode\.value = K\.autoMode\(A\.data\(\)\.set\);/);
  assert.match(lv, /if \(mode\.value === "off"\) A\.saveTimes\(K\.timesText\(list\), true\);/);
  assert.match(lv, /if \(!canRead\(\) \|\| !canAuto\(\) \|\| \(!force && !isDue\(Date\.now\(\)\)\)\) \{ bgDone\(null\); return; \}/);
  assert.match(lv, /\/\[\?&\]bankforce=1\(&\|\$\)\//);
  assert.match(lv, /runNow: runNow/);
  assert.match(lv, /oros: "bank-bg-done", app: "budget", n: o\.n, err: o\.err, text: o\.text, errs: o\.errs/);
});

test("shell 10f: every mode through autoDue; __orosBankNow uses an open Budget, else a forced hidden run, and answers within its wait", () => {
  const sh = read("shell.js");
  assert.match(sh, /window\.__orosBankNow = function \(waitMs\) \{/);
  assert.match(sh, /bankBgStart\(app, "bankbg=1&bankforce=1", fin\);/);
  assert.match(sh, /L\.runNow\(\)/);
  assert.match(sh, /if \(b\.cb\) \{ try \{ b\.cb\(r \|\| \{ n: 0, err: "timeout", text: "", errs: \[\] \}\); \} catch \(e\) \{\} \}/);
  assert.match(sh, /over = true; done\(\{ why: "slow", last: lastT\(\) \}\);/);
  assert.doesNotMatch(sh, /if \(!ts\.length\) return;\n    \/\/ a bank connection waiting/, "the 6-hour mode is no longer skipped");
});

test("gate budget_refresh: a Budget change tool, never queued, the answer in plain words", () => {
  assert.ok(G.WRITES.budget.indexOf("budget_refresh") >= 0);
  assert.ok(G.QUEUED.indexOf("budget_refresh") < 0);
  assert.equal(G.BANK_GAP, 600000);
  const now = Date.UTC(2026, 10, 18, 19, 47);
  const ok = JSON.parse(G.bankNowText({ n: 3, errs: [], last: now }, now).c);
  assert.equal(ok.new_entries, 3);
  assert.equal(ok.failed, undefined);
  assert.equal(ok.last_update, "2026-11-18T19:47:00.000Z");
  const bad = G.bankNowText({ n: 0, errs: [{ c: "consent", text: "Viva: renew" }], last: now }, now);
  assert.equal(bad.ok, true, "the other accounts were read");
  assert.deepEqual(JSON.parse(bad.c).failed, [{ code: "consent", text: "Viva: renew" }]);
  assert.match(JSON.parse(bad.c).note, /consent = the owner renews/);
  assert.equal(G.bankNowText({ why: "nobanks" }, now).ok, false);
  assert.equal(G.bankNowText({ why: "offline", last: now }, now).ok, false);
  assert.equal(G.bankNowText({ why: "slow", last: now }, now).ok, true, "it goes on by itself");
  assert.match(JSON.parse(G.bankNowText({ gap: 1, last: now }, now).c).done, /less than 10 minutes ago/);
  const gs = read("gate/gate.js");
  assert.match(gs, /if \(name === "budget_refresh"\) \{[\s\S]{0,400}if \(!canWrite\(p\.lv, p\.hold, "budget", nowB\)\)/);
  assert.match(gs, /root\.__orosBankNow\(20000\)/);
});

test("relay budget_refresh: offered, not read-only, refused with orOS closed (nothing waits)", async () => {
  const t = R.TOOLS.find((x) => x.name === "budget_refresh");
  assert.ok(t);
  assert.equal(t.annotations.readOnlyHint, false);
  assert.deepEqual(t.inputSchema.properties, {});
  assert.deepEqual(R.LIVE_ONLY, ["budget_refresh"]);
  assert.match(read("relay/gate.js"), /if \(name === "budget_refresh"\) return \{ ok: false, c: "orOS is closed: the banks can be read only from an open device/);
});

test("autoDue, every 6 hours: another device's read counts too (BK-6S, PSD2 ~4 reads a day)", () => {
  const H = 3600000, now = Date.UTC(2026, 10, 20, 23, 0);
  assert.equal(K.autoDue({}, [{ bt: now - 2 * H }], now - 7 * H, 0, now), 0, "the computer read 2 hours ago: the phone waits");
  assert.equal(K.autoDue({}, [{ bt: now - 7 * H }], now - 8 * H, 0, now), now, "6 hours since any read: due");
  assert.equal(K.autoDue({}, [{ bt: now + H }], 0, 0, now), now, "a read stamped in the future is not counted");
});
