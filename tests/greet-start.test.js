// New users, wave 1: the greeting at the start (GREET-1, shell.js) and
// the First steps widget (START-1, widgets.js 1.1.0).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const W = require(path.join(ROOT, "widgets.js"));
const SHELL = read("shell.js");

function cut(src, name) {
  const i = src.indexOf("  function " + name + "(");
  if (i < 0) throw new Error("missing function " + name);
  let depth = 0, j = src.indexOf("{", i);
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) break;
  }
  return src.slice(i, j + 1);
}

test("First steps: a kind of its own, first; the default cards are unchanged", () => {
  assert.equal(W.KINDS[0], "start");
  assert.deepEqual(W.DEFAULT, ["clock", "calendar", "today", "weather"]);
  assert.deepEqual(W.listOf(null, true, false), ["clock", "calendar", "today", "weather"], "no stored list: no First steps for anyone");
  assert.deepEqual(W.STEPS, ["note", "task", "wall", "icons", "import", "sync", "phone", "assistant", "install"]);
});

test("First steps: a new user gets it before this screen's default; a set list stays", () => {
  assert.deepEqual(W.firstList(null, true, false), ["start", "clock", "calendar", "today", "weather"]);
  assert.deepEqual(W.firstList(null, false, true), ["start"]);
  assert.equal(W.firstList({ v: 1, list: [] }, true, false), null);
  assert.equal(W.firstList({ v: 1, list: ["sync"] }, true, false), null);
});

test("First steps: steps tick from the facts or the record; install only where it can be", () => {
  const facts = { note: true, task: false, wall: false, icons: true, sync: false, install: "no" };
  const rows = W.startRows(facts, W.startNorm({ done: ["assistant", "nope"] }));
  assert.deepEqual(rows.map((r) => r.id), ["note", "task", "wall", "icons", "import", "sync", "assistant"]);
  assert.deepEqual(rows.filter((r) => r.done).map((r) => r.id), ["note", "icons", "assistant"]);
  assert.equal(W.startRows({ install: false }, null).some((r) => r.id === "install" && !r.done), true);
  assert.equal(W.startRows({ install: true }, null).some((r) => r.id === "install" && r.done), true);
  assert.equal(W.startRows({}, null).some((r) => r.id === "install"), false);
});

test("First steps: a step once done stays done; all done is noted once; the card goes the next day", () => {
  const rec0 = W.startNorm(null);
  assert.deepEqual(rec0, { v: 1, done: [], all: "" });
  const r1 = W.startNext(rec0, W.startRows({ note: true }, rec0), "2026-11-11");
  assert.deepEqual(r1.done, ["note"]);
  // The note is deleted later: the step stays ticked.
  assert.equal(W.startRows({ note: false }, r1)[0].done, true);
  const all = { note: true, task: true, wall: true, icons: true, import: true, sync: true, assistant: true, install: "no" };
  const r2 = W.startNext(r1, W.startRows(all, r1), "2026-11-11");
  assert.equal(r2.all, "2026-11-11");
  assert.equal(W.startNext(r2, W.startRows(all, r2), "2026-11-12").all, "2026-11-11", "noted once");
  assert.equal(W.startGone(r2, "2026-11-11"), false, "All done stays for that day");
  assert.equal(W.startGone(r2, "2026-11-12"), true);
  assert.equal(W.startGone(r1, "2026-11-12"), false);
  assert.equal(W.startNorm({ all: "yesterday", done: "x" }).all, "");
});

test("First steps: the widget's own wiring", () => {
  const src = read("widgets.js");
  assert.match(src, /var START_KEY = "oros-start";/);
  assert.match(src, /firstRun: function \(\) \{\n      if \(!host\) return;\n      var l = firstList\(stored\(\), wide\(\), phone\(\)\);\n      if \(l\) save\(l\);/);
  assert.match(src, /did: function \(step\) \{/);
  assert.match(src, /if \(kind === "start" && on\) startReopen\(\);/);
  assert.match(src, /if \(kind === "start" && cb\.checked\) startReopen\(\);/);
  // Text only through textContent; the one innerHTML is the static tick.
  const paint = src.slice(src.indexOf("    start: function (c, force) {"), src.indexOf("    clock: function (c) {"));
  assert.deepEqual(paint.match(/innerHTML = [A-Za-z_]+/g), ["innerHTML = IC_TICK"]);
});

test("shell: First steps facts are read-only and go to the right places", () => {
  const facts = cut(SHELL, "startFacts");
  assert.doesNotMatch(facts, /setItem|removeItem|noteLocalChange/);
  assert.match(facts, /"oros-notes-data"/);
  assert.match(facts, /"oros-todo-data"/);
  assert.match(facts, /install: installed \? true : \(state\.deferredPrompt \? false : "no"\)/);
  const go = cut(SHELL, "startGo");
  for (const [k, v] of [["note", 'openAppById\\("notes"\\)'], ["task", 'openAppById\\("todo"\\)'], ["import", 'if \\(window\\.orosWidgets && window\\.orosWidgets\\.did\\) window\\.orosWidgets\\.did\\("import"\\);\\s+openHelp\\("t\\/data\\/" \\+ window\\.t\\("wg\\.start\\.import\\.sec"\\)\\)'], ["assistant", 'openAppById\\("assistant"\\)']]) {
    assert.match(go, new RegExp('case "' + k + '":\\s+' + v), k);
  }
  assert.match(SHELL, /start: \{ facts: startFacts, go: startGo \}/);
  const open = cut(SHELL, "openApp");
  assert.match(open, /if \(greetEnd\) greetEnd\(\);/);
  assert.match(open, /window\.orosWidgets\.did\("assistant"\)/);
});

test("shell: a new user gets First steps and no greeting on the first day", () => {
  const first = cut(SHELL, "tourFirstRun");
  assert.ok(first.indexOf("greetMark();") > first.indexOf('localStorage.getItem(TOUR_DONE) === "1"'), "after the done check");
  assert.match(first, /window\.orosWidgets\.firstRun\(\)/);
});

test("greeting: hours as the Start page, Today's line, the guards", () => {
  const part = new Function(cut(SHELL, "greetPart") + "\nreturn greetPart;")();
  assert.deepEqual([4, 5, 11, 12, 17, 18, 23].map(part), ["evening", "morning", "morning", "afternoon", "afternoon", "evening", "evening"]);
  const tr = { "greet.today1": "1 thing for today", "greet.todayN": "{n} things for today", "greet.late1": "1 late", "greet.lateN": "{n} late" };
  const line = new Function("window", cut(SHELL, "greetTodayLine") + "\nreturn greetTodayLine;")({ t: (k) => tr[k] });
  assert.equal(line(null), "");
  assert.equal(line({ groups: { today: [], overdue: [] } }), "");
  assert.equal(line({ groups: { today: [1, 2, 3], overdue: [1] } }), "3 things for today · 1 late");
  assert.equal(line({ groups: { today: [1], overdue: [1, 2] } }), "1 thing for today · 2 late");
  const may = cut(SHELL, "greetMaybe");
  assert.match(may, /if \(g\.off \|\| g\.day === greetDay\(new Date\(\)\)\) return;/);
  assert.match(may, /if \(tour \|\| first \|\| tourBox \|\| profilesBusy\) return;/);
  assert.match(may, /if \(state\.running \|\| late\.open\) return;/);
  assert.match(may, /L\.isLocked\(\)/);
  assert.ok(may.indexOf("greetMark();") < may.indexOf("greetShow();"), "marked before it shows: once a day even if it fails");
  assert.match(cut(SHELL, "greetStart"), /if \(SOLO\) return;/);
  assert.match(SHELL, /gameResumeStart\(\);\n        greetStart\(\);/);
  const show = cut(SHELL, "greetShow");
  assert.doesNotMatch(show, /innerHTML/, "text only through textContent (the name is the person's text)");
  assert.match(show, /hi\.textContent = window\.t\("greet\." \+ greetPart\(now\.getHours\(\)\)\) \+ \(name \? ", " \+ name : ""\);/);
  assert.match(show, /openAppById\("today"\)/);
});

test("greeting: Settings switch on this device, styles, strings and help", () => {
  assert.match(SHELL, /greet: SOLO \? null : \{ on: greetOn\(\) \},/);
  assert.match(cut(SHELL, "settingsSet"), /case "greet":\s+greetSetUser\(!!value\);/);
  assert.match(read("settings/settings.js"), /switchBtn\(!!greet\.on, "greet", function \(v\) \{ set\("greet", v\); \}/);
  const core = read("settings/core.js"), de = read("i18n/de/settings.js");
  assert.match(core, /greet: "device"/);
  assert.match(core, /\["greet", "appearance", "a\.greet"\]/);
  for (const k of ["a.greet", "a.greet.hint", "w.greet"]) {
    assert.equal((core.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length, 2, k + " EN + EL");
    assert.ok(de.includes('"' + k + '":'), k + " DE");
  }
  const tr = read("translations.js");
  const en = tr.slice(0, tr.indexOf("\n  el: {")), el = tr.slice(tr.indexOf("\n  el: {"));
  const sde = read("i18n/de/shell.js");
  for (const k of ["greet.morning", "greet.afternoon", "greet.evening", "greet.today1", "greet.todayN", "greet.late1", "greet.lateN", "greet.open"]) {
    assert.ok(en.includes('"' + k + '":'), "EN " + k);
    assert.ok(el.includes('"' + k + '":'), "EL " + k);
    assert.ok(sde.includes('"' + k + '":'), "DE " + k);
  }
  const css = read("style.css");
  assert.match(css, /#oros-greet \{/);
  assert.match(css, /#oros-greet\.no-motion, #oros-greet\.no-motion\.out \{ animation: none; \}/);
  assert.match(css, /html\[data-oros-contrast="high"\] #oros-greet \{/);
  assert.match(read("help/topics/appearance.en.txt"), /## Greeting at the start[\s\S]*### First steps|### First steps[\s\S]*## Greeting at the start/);
  assert.match(read("help/topics/appearance.el.txt"), /## Χαιρετισμός στην εκκίνηση/);
  assert.match(read("help/topics/appearance.el.txt"), /### Πρώτα βήματα/);
  assert.match(read("i18n/de/help/topics/appearance.txt"), /## Begrüßung beim Start/);
  assert.match(read("i18n/de/help/topics/appearance.txt"), /### Erste Schritte/);
});
