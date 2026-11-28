// The menu button's icon (MENUICON-1, video ideas 2026-11-23 #13):
// six static icons or none, this device only, the four squares by default.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const SHELL = read("shell.js");
const SEC = SHELL.slice(SHELL.indexOf("// ---------- 5b-icon. MENUICON-1"), SHELL.indexOf("// ---------- 5b-dir. WPDIR-1"));

test("the choices; odd values are the four squares", () => {
  const ctx = {};
  const head = SEC.slice(SEC.indexOf("  var MENU_ICON_KEY"), SEC.indexOf("  function menuIconNow("));
  vm.runInNewContext(head + "this.of = menuIconOf; this.ids = MENU_ICON_IDS; this.icons = MENU_ICONS;", ctx);
  assert.deepEqual([...ctx.ids], ["grid", "dots", "ring", "spark", "leaf", "lines", "none"]);
  assert.equal(ctx.of("spark"), "spark");
  assert.equal(ctx.of("<img onerror>"), "grid");
  assert.equal(ctx.of(null), "grid");
  for (const id of ctx.ids) {
    if (id === "none") { assert.equal(ctx.icons[id], ""); continue; }
    assert.match(ctx.icons[id], /^<svg [^>]*aria-hidden="true">/, id);
    assert.doesNotMatch(ctx.icons[id], /on\w+=|script|href/i, id);
  }
  assert.ok(read("index.html").includes('<rect x="14" y="14" width="7" height="7" rx="1.5"/>'), "the default stays in index.html");
});

test("stored on this device, set from Settings, the bar refits", () => {
  assert.match(SEC, /var MENU_ICON_KEY = "oros-menuicon";/);
  assert.match(SEC, /if \(id === "grid"\) localStorage\.removeItem\(MENU_ICON_KEY\)/);
  assert.match(SEC, /fitBar\(\)/);
  assert.match(SHELL, /case "menuicon":   if \(!SOLO\) \{ menuIconSet\(String\(value \|\| ""\)\); settingsNotify\(\); \} return;/);
  assert.match(SHELL, /menuIcon: \{ now: menuIconNow\(\), choices: MENU_ICON_IDS\.slice\(\) \}/);
  const C = require(path.join(ROOT, "settings/core.js"));
  assert.equal(C.scopeOf("menuicon"), "computers");   // LOOK-1: shared between computers
  const S = read("settings/settings.js");
  assert.match(S, /"menuicon",\n        function \(v\) \{ set\("menuicon", v\); \}\);/);
  assert.match(S, /"y-menuicon",/);
  const de = read("i18n/de/settings.js");
  for (const k of ["a.menuicon", "a.menuicon.grid", "a.menuicon.dots", "a.menuicon.ring", "a.menuicon.spark", "a.menuicon.leaf", "a.menuicon.lines", "a.menuicon.none"]) {
    for (const L of ["en", "el"]) assert.notEqual(C.t(L, k), k, L + " " + k);
    assert.ok(de.includes('"' + k + '"'), "de " + k);
  }
});
