// Desktop widgets (widgets.js): prefs, moves, the month grid, and the
// wiring in the shell, Settings, the desktop menu, the page and strings.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const W = require(path.join(ROOT, "widgets.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("prefs: unknown kinds and doubles go, bad data reads as none stored", () => {
  assert.deepEqual(W.norm({ list: ["clock", "x", "clock", "sync"] }), { v: 1, list: ["clock", "sync"] });
  assert.equal(W.norm(null), null);
  assert.equal(W.norm({ list: "clock" }), null);
  assert.equal(W.parse("{oops"), null);
  assert.deepEqual(W.parse('{"v":1,"list":[]}'), { v: 1, list: [] });
});

test("default: four cards on a wide screen, none on a phone or narrow window; a stored list wins", () => {
  assert.deepEqual(W.listOf(null, true, false), ["clock", "calendar", "today", "weather"]);
  assert.deepEqual(W.listOf(null, true, true), []);
  assert.deepEqual(W.listOf(null, false, false), []);
  assert.deepEqual(W.listOf({ v: 1, list: [] }, true, false), []);
  assert.deepEqual(W.listOf({ v: 1, list: ["sync"] }, false, true), ["sync"]);
});

test("toggle and move", () => {
  assert.deepEqual(W.toggle(["clock", "weather"], "today", true), ["clock", "today", "weather"]);
  assert.deepEqual(W.toggle(["weather", "clock"], "sync", true), ["weather", "clock", "sync"]);
  assert.deepEqual(W.toggle(["clock", "today"], "clock", false), ["today"]);
  assert.deepEqual(W.toggle(["clock"], "nope", true), ["clock"]);
  assert.deepEqual(W.move(["a", "b", "c"], "c", 0), ["c", "a", "b"]);
  assert.deepEqual(W.move(["a", "b", "c"], "a", 9), ["b", "c", "a"]);
  assert.deepEqual(W.move(["a", "b"], "z", 0), ["a", "b"]);
});

test("month grid: Monday first, whole weeks, no week wholly in the next month", () => {
  const oct = W.monthGrid(2026, 9);                 // 1 Oct 2026 is a Thursday
  assert.equal(oct.length, 5);
  assert.equal(oct[0][0].ymd, "2026-09-28");
  assert.equal(oct[0][3].ymd, "2026-10-01");
  assert.equal(oct[4][6].ymd, "2026-11-01");
  assert.ok(oct.every((w) => w.length === 7));
  const feb = W.monthGrid(2027, 1);                 // 1 Feb 2027 is a Monday, 28 days
  assert.equal(feb.length, 4);
  assert.equal(feb[0][0].ymd, "2027-02-01");
  const mar = W.monthGrid(2026, 2);                 // 1 Mar 2026 is a Sunday: six weeks
  assert.equal(mar.length, 6);
  assert.equal(mar[0][6].ymd, "2026-03-01");
  assert.equal(mar[0][0].out, true);
});

test("wiring: page, precache, shell, Settings, desktop menu", () => {
  const html = read("index.html");
  const i = html.indexOf('src="widgets.js?v='), s = html.indexOf('src="shell.js?v=');
  assert.ok(i > 0 && i < s, "widgets.js loads before shell.js");
  assert.match(read("sw.js"), /"\.\/qsettings\.js",\n  "\.\/widgets\.js",/);
  const sh = read("shell.js");
  assert.match(sh, /if \(window\.orosWidgets && !SOLO\) \{\n    window\.orosWidgets\.attach\(\{/);
  assert.match(sh, /widgets: window\.orosWidgets && window\.orosWidgets\.snapshot \? window\.orosWidgets\.snapshot\(\) : null,/);
  assert.match(sh, /if \(\/\^widgets:\/\.test\(name\)\)/);
  assert.match(sh, /if \(\(!wxTrayOn\(\) && !wgWantsWeather\(\)\) \|\| !navigator\.onLine\) return;/);
  assert.match(read("settings/settings.js"), /set\("widgets:" \+ w\.id, cb\.checked\)/);
  assert.match(read("quickmenu.js"), /#wg-col, /);
  assert.match(read("widgets.js"), /root\.__orosDeskItems = root\.__orosDeskItems \|\| \[\]\)\.push/);
});

test("strings: every wg.* key exists in EN, EL and DE", () => {
  const src = read("widgets.js");
  const keys = new Set((src.match(/"wg\.[a-z.]+"/g) || []).map((k) => k.slice(1, -1)));
  W.KINDS.forEach((k) => keys.add("wg." + k));
  const tr = read("translations.js");
  const en = tr.slice(0, tr.indexOf("\n  el: {")), el = tr.slice(tr.indexOf("\n  el: {"));
  const de = read("i18n/de/shell.js");
  for (const k of keys) {
    if (k.endsWith(".")) continue;
    assert.ok(en.includes('"' + k + '":'), "EN " + k);
    assert.ok(el.includes('"' + k + '":'), "EL " + k);
    assert.ok(de.includes('"' + k + '":'), "DE " + k);
  }
});
