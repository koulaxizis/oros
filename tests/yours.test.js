// Make it yours (YOURS-1, video ideas 2026-11-23 #9): one card at the
// top of Appearance with a live preview; every control is the same
// setting as in its own place, under "y-" keys, and search still lights
// up the setting's own place.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const APP = read("settings/settings.js");
const C = require(path.join(ROOT, "settings/core.js"));
const FN = APP.slice(APP.indexOf("  function secYours(host, s) {"), APP.indexOf("  function secAppearance(host, s) {"));

test("first on the Appearance page, reachable as 'yours'", () => {
  assert.match(APP, /function secAppearance\(host, s\) \{\n    secYours\(host, s\);/);
  assert.equal(C.resolve ? C.resolve("yours") : "appearance", "appearance");
  assert.deepEqual(C.findItem("yours"), ["yours", "appearance", "my.title"]);
});

test("the same settings as in their own places, under their own data keys", () => {
  for (const name of ["smartbar-look", "dock:on", "dock:pos", "feel", "uisnd:on", "uisnd:pack"]) {
    assert.ok(FN.includes('set("' + name + '"'), name);
  }
  assert.match(FN, /L\.option\("look", v\)/, "the lock screen's look through the lock");
  const keys = [...FN.matchAll(/"(y-[a-z:-]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length >= 7);
  assert.equal(new Set(keys).size, keys.length, "each y- key once");
  assert.doesNotMatch(FN, /data-k", "(wall|skin):/, "no clash with the wallpaper grid or the swatches");
  assert.match(APP, /if \(key !== "my\.title" && all\[i\]\.closest\("#my-card"\)\) continue;/, "search lights up the setting's own place");
});

test("YOURS-2: one wallpaper and one colour picker; Make it yours takes you to them", () => {
  assert.doesNotMatch(FN, /set\("(wallpaper|skin|wpaccent)/, "no second wallpaper, colour or accent picker here");
  assert.doesNotMatch(FN, /my-walls|my-swatches/);
  assert.match(FN, /button\(t\("my\.wall"\), "y-wall-go"/);
  assert.match(FN, /yoursGo\("wall-card", "\.wall\.on", "f-wall-find"\)/);
  assert.match(FN, /button\(t\("my\.skin"\), "y-skin-go"/);
  assert.match(FN, /yoursGo\("skin-card", "\.swatch\.on", null\)/);
  assert.match(FN, /function yoursGo\(cardId, onSel, alt\)/);
  assert.match(APP, /c3\.id = "wall-card";/);
  assert.match(APP, /c2\.id = "skin-card";/);
  assert.doesNotMatch(read("settings/settings.css"), /\.my-(walls|swatches)/);
});

test("the preview: wallpaper, bar look, accent window, Dock edge; it plays only when the feel changes", () => {
  assert.match(FN, /function yoursPreview\(s\)/);
  assert.match(FN, /"my-bar my-bar-" \+ look/);
  assert.match(FN, /"my-dock my-dock-" \+ \(s\.dock\.pos \|\| "bottom"\)/);
  assert.match(FN, /if \(yoursFeel !== null && yoursFeel !== feel\) yoursPlayAt = Date\.now\(\);/);
  const css = read("settings/settings.css");
  assert.match(css, /html\[data-oros-motion="reduce"\] \.my-win\.my-play \{ animation: none; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.my-win\.my-play \{ animation: none; \} \}/);
});

test("strings in EN, EL and DE", () => {
  const de = read("i18n/de/settings.js");
  for (const k of ["my.title", "my.hint", "my.colour", "my.preview", "my.lock", "my.wall", "my.skin", "w.yours"]) {
    for (const L of ["en", "el"]) assert.notEqual(C.t(L, k), k, L + " " + k);
    assert.ok(de.includes('"' + k + '"'), "de " + k);
  }
});
