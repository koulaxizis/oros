// Quick window (QW): the command bar adds a task at once and shows the
// universal search's hits; "#quick" / "#quick-win" open it from outside
// orOS (manifest shortcut, Android tile and widget, the desktop tray).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("QW the bar offers Add task, data hits and tells how it closed", () => {
  const bar = read("commands/bar.js");
  assert.match(bar, /host\.addTask && q\.length <= 300/);
  assert.match(bar, /var DATA_MAX = 6;/);
  assert.match(bar, /host\.closed\(acted\)/);
  // data rows are drawn as text only
  assert.doesNotMatch(bar, /innerHTML/);
  for (const k of ["task", "data", "busy"]) {
    assert.match(bar, new RegExp(k + ': "'), k);
    assert.match(read("i18n/de/commands.js"), new RegExp('"' + k + '": "'), "de " + k);
  }
});

test("QW the data rows follow the user's search switches (searchEnabled)", () => {
  const sh = read("shell.js");
  const fn = sh.slice(sh.indexOf("function cmdData(q)"), sh.indexOf("function cmdAddTask(q)"));
  assert.ok(fn.length > 100);
  assert.match(fn, /searchApps\(\)\.filter\(function \(a\) \{ return searchEnabled\(a\.id\); \}\)/);
  assert.match(fn, /return !!allow\[id\] && searchEnabled\(id\);/);
  assert.match(fn, /openSearchHit\(x\.id, x\.hit\)/);
  assert.match(sh, /addTask: hasApp\("todo"\) \? cmdAddTask : null/);
});

test("QW the task is written by To-Do itself ({ now: true }), with Undo, never twice", () => {
  const sh = read("shell.js");
  assert.match(sh, /__orosOpenAt\("todo", \{ addItems: \{ now: true, from: window\.t\("cmd\.quick"\), items: \[\{ text: text \}\] \} \}\)/);
  assert.doesNotMatch(sh.slice(sh.indexOf("function cmdAddTask"), sh.indexOf("function openCmdBar")), /oros-todo-data|setItem/);
  const td = read("todo/todo.js");
  assert.match(td, /if \(raw\.now === true && p\.items\.length === 1 && !p\.newList\) \{ addItemNow\(p\); return; \}/);
  const now = td.slice(td.indexOf("function addItemNow(p)"), td.indexOf("// Another window of this orOS"));
  assert.match(now, /if \(openKeysOf\(list\)\[normalize\(it\.text\)\]\)/);      // already open there: nothing written
  assert.match(now, /tombstone\(item\.id\)/);                                   // Undo deletes with a tombstone
  assert.match(now, /showToast\(addT\("added", \{ n: 1, list: list\.name \}\), true\)/);
});

test("QW To-Do merges what another window wrote (no lost task)", () => {
  const td = read("todo/todo.js");
  assert.match(td, /if \(e\.key !== STORAGE_KEY \|\| !e\.newValue \|\| e\.newValue === lastSaved\) return;/);
  assert.match(td, /sliceSet\(mergeTodoStates\(sliceGet\(\), other\), \{ merged: true \}\)/);
});

// The fragment parser, run as the shell runs it.
function takeHash(h) {
  const sh = read("shell.js");
  const m = /var m = (\/\^#quick\(-win\)\?.*?\$\/)\.exec\(h\);/.exec(sh);
  assert.ok(m, "regex found");
  const re = eval(m[1]);
  const r = re.exec(h);
  if (!r) return null;
  let t = "";
  try { t = decodeURIComponent((r[2] || "").replace(/\+/g, " ")); } catch (e) { t = ""; }
  return { win: !!r[1], text: t };
}
test("QW #quick, #quick-win and their text; #quick-ask stays the Assistant's", () => {
  assert.deepEqual(takeHash("#quick"), { win: false, text: "" });
  assert.deepEqual(takeHash("#quick=buy%20milk"), { win: false, text: "buy milk" });
  assert.deepEqual(takeHash("#quick-win"), { win: true, text: "" });
  assert.deepEqual(takeHash("#quick-win=a+b"), { win: true, text: "a b" });
  assert.equal(takeHash("#quick-ask"), null);
  assert.equal(takeHash("#quickly"), null);
  const sh = read("shell.js");
  assert.match(sh, /if \(L && L\.isLocked && L\.isLocked\(\)\)/);          // waits behind the screen lock
  assert.match(sh, /if \(!quickWin \|\| acted \|\| state\.running\) return;/);
  assert.match(sh, /quickReady\(\);\n      \}\)/);
});

test("QW manifest shortcut and the Android tile and widget open #quick", () => {
  const man = JSON.parse(read("manifest.webmanifest"));
  const urls = man.shortcuts.slice(0, 4).map((s) => s.url);
  assert.ok(urls.includes("/#quick") && urls.includes("/#quick-ask"), urls.join(" "));
  const tw = "android/app/src/main/java/online/useoros/twa/";
  assert.match(read(tw + "Widgets.java"), /\.fragment\("quick"\)/);
  assert.match(read(tw + "QuickTile.java"), /Widgets\.quickOpen\(this\)/);
  assert.match(read(tw + "QuickBarWidget.java"), /Widgets\.quickBar\(c\)/);
  const gen = read("android/tools/gen.js");
  assert.match(gen, /<receiver android:name="\.QuickBarWidget" android:exported="false"/);
  assert.match(gen, /<service android:name="\.QuickTile" android:exported="true"[^>]*BIND_QUICK_SETTINGS_TILE/);
  const { REMOVE_NODES } = require(path.join(ROOT, "android", "tools", "gen.js"));
  assert.ok(REMOVE_NODES.some(([t, n]) => t === "service" && n === ".QuickTile"));       // not in single apps
  assert.ok(REMOVE_NODES.some(([t, n]) => t === "receiver" && n === ".QuickBarWidget"));
  for (const v of ["values", "values-el", "values-de"]) {
    const s = read("android/app/src/main/res/" + v + "/strings.xml");
    for (const k of ["widget_quickbar", "widget_quickbar_desc", "widget_quickbar_hint", "tile_quick"]) {
      assert.ok(s.includes('name="' + k + '"'), v + " " + k);
    }
  }
});

test("QW the empty Quick window shows Today: the summary's own rows, read only", () => {
  const bar = read("commands/bar.js");
  assert.match(bar, /var TODAY_MAX = 5;/);
  assert.match(bar, /if \(host\.today\) \{/);
  for (const k of ["today", "late", "all"]) {
    assert.match(bar, new RegExp(k + ': "'), k);
    assert.match(read("i18n/de/commands.js"), new RegExp('"' + k + '": "'), "de " + k);
  }
  const sh = read("shell.js");
  // only in the Quick window (#quick, #quick-win), only with the Today app installed
  assert.match(sh, /today: opts\.today && hasApp\("today"\) \? cmdTodayRows : null/);
  const fn = sh.slice(sh.indexOf("function cmdTodayRows()"), sh.indexOf("function openCmdBar("));
  assert.ok(fn.length > 100);
  assert.match(fn, /T\.build\(\)/);
  assert.match(fn, /T\.open\(r\.app, r\.target\)/);
  assert.doesNotMatch(fn, /setItem|localStorage/);
});

test("K5 a setting by words goes through Settings' own setters", () => {
  const sh = read("shell.js");
  assert.match(sh, /lockOn: !!\(window\.orosLock && window\.orosLock\.isOn\(\)\)/);
  const fn = sh.slice(sh.indexOf("function cmdSetting("), sh.indexOf("function cmdMatchApps("));
  assert.ok(fn.length > 100);
  assert.match(fn, /setThemeUser\(value\)/);
  assert.match(fn, /window\.orosLock\.lock\(\)/);
  assert.match(fn, /N\.setSetting\("enabled", !!value\)/);
  assert.match(fn, /N\.setSetting\("quietHours", next\)/);
  assert.doesNotMatch(fn, /localStorage/);
  for (const k of ["set.dark", "set.light", "set.lock", "set.notifs.off", "set.notifs.on", "set.notifs.note", "set.quiet.on", "set.quiet.off"]) {
    assert.match(read("i18n/de/commands.js"), new RegExp('"' + k.replace(/\./g, "\\.") + '": "'), "de " + k);
  }
});
