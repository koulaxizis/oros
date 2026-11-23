// Interface sounds (UISND-1, video ideas 2026-11-23 #5): off by default,
// three CC0 packs from oros-sounds ui/, silent under Do Not Disturb and
// Focus, this device only.
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
const SEC = SHELL.slice(SHELL.indexOf("// ---------- UISND-1"), SHELL.indexOf("  // A timer can also ring with a Ringtone Composer melody"));

function helpers() {
  const pick = (name) => {
    const i = SEC.indexOf("  function " + name + "(");
    assert.ok(i >= 0, name);
    return SEC.slice(i, SEC.indexOf("\n  }\n", i) + 4);
  };
  const ctx = {};
  const head = SEC.slice(SEC.indexOf("  var UIS_KEY"), SEC.indexOf("  function uisParse("));
  vm.runInNewContext(head + pick("uisParse") + pick("uisKind") + "this.p = uisParse; this.k = uisKind;", ctx);
  return { p: (r) => JSON.parse(JSON.stringify(ctx.p(r))), k: ctx.k };
}

test("off by default; odd values fall back; volume clamped", () => {
  const { p } = helpers();
  assert.deepEqual(p(null), { on: false, pack: "pebble", vol: 50 });
  assert.deepEqual(p("junk"), { on: false, pack: "pebble", vol: 50 });
  assert.deepEqual(p(JSON.stringify({ on: true, pack: "keys", vol: 80 })), { on: true, pack: "keys", vol: 80 });
  assert.deepEqual(p(JSON.stringify({ on: "yes", pack: "../x", vol: 900 })), { on: false, pack: "pebble", vol: 100 });
  assert.deepEqual(p(JSON.stringify({ on: true, pack: "crystal", vol: -5 })), { on: true, pack: "crystal", vol: 0 });
});

test("what a click sounds like: switches on / off, buttons tap, the rest nothing", () => {
  const { k } = helpers();
  assert.equal(k({ tag: "BUTTON", pressed: "true" }), "on");
  assert.equal(k({ tag: "BUTTON", pressed: "false" }), "off");
  assert.equal(k({ tag: "INPUT", checked: true }), "on");
  assert.equal(k({ tag: "INPUT", checked: false }), "off");
  assert.equal(k({ tag: "DIV", role: "switch", checked: "true" }), "on");
  assert.equal(k({ tag: "BUTTON", pressed: null, checked: null }), "tap");
  assert.equal(k({ tag: "A", pressed: null, checked: null }), "tap");
  assert.equal(k({ tag: "DIV", role: "tab", pressed: null, checked: null }), "tap");
  assert.equal(k({ tag: "DIV", pressed: null, checked: null }), "");
  assert.equal(k({ tag: "BUTTON", disabled: true }), "");
  assert.equal(k(null), "");
});

test("quiet under Do Not Disturb, Focus, a hidden page and in a single app; packs from oros-sounds ui/", () => {
  assert.match(SEC, /function uisQuiet\(\) \{\s+if \(SOLO \|\| document\.hidden\) return true;/);
  assert.match(SEC, /if \(d && d\.on\) return true;/);
  assert.match(SEC, /F\.active\(\)\) return true;/);
  assert.match(SEC, /if \(!force && uisQuiet\(\)\) return;/);
  assert.match(SEC, /UIS_BASE = "https:\/\/koulaxizis\.github\.io\/oros-sounds\/ui\/"/);
  assert.match(SEC, /window\.caches\.open\("oros-sounds"\)/, "kept with Studio's packs, offline afterwards");
  assert.match(SEC, /UIS_PACKS = \["pebble", "keys", "crystal"\]/);
  assert.match(SHELL, /uiSound\("open"\);   \/\/ UISND-1\s+wpLandRefresh\(\);\s+zoomOpen\(app\);/);
  assert.match(SHELL, /if \(prev\) uiSound\("close"\);/);
  assert.match(SHELL, /uisounds: uisSnapshot\(\),/);
});

test("Settings: Interface sounds card in Notifications, EN/EL/DE; credits", () => {
  const st = read("settings/settings.js"), core = read("settings/core.js"), de = read("i18n/de/settings.js");
  assert.match(st, /if \(s && s\.uisounds\) secUiSounds\(host, s\.uisounds\);/);
  assert.match(core, /\["uisounds", "notifications", "us\.title", null, null, "uisounds"\]/);
  for (const key of ["us.title", "us.hint", "us.on", "us.pack", "us.pack.pebble", "us.pack.keys", "us.pack.crystal", "us.vol", "us.try", "w.uisounds"]) {
    assert.equal(core.split('"' + key + '":').length - 1, 2, key);
    assert.ok(de.includes('"' + key + '":'), key + " DE");
  }
  assert.match(read("CREDITS.md"), /interface sounds \(three packs of five short sounds in oros-sounds `ui\/`/);
});
