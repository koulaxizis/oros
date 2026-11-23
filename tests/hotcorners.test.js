// Hot corners (HOTC-1, video ideas 2026-11-23 #2): each of the four
// corners can open Overview, Quick settings, Notifications or show the
// desktop; off by default, mouse only, never while locked.
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
const SEC = SHELL.slice(SHELL.indexOf("// Hot corners (HOTC-1"), SHELL.indexOf("// ---------- 10g."));

function helpers() {
  const pick = (name) => {
    const i = SEC.indexOf("  function " + name + "(");
    assert.ok(i >= 0, name);
    return SEC.slice(i, SEC.indexOf("\n  }\n", i) + 4);
  };
  const ctx = {};
  const head = SEC.slice(SEC.indexOf("  var HC_KEY"), SEC.indexOf("  function hcParse("));
  vm.runInNewContext(head + pick("hcParse") + pick("hcWhich") + "this.p = hcParse; this.w = hcWhich;", ctx);
  return { p: (...a) => JSON.parse(JSON.stringify(ctx.p(...a))), w: ctx.w };
}

test("off by default; OV-1's corner becomes the top-left Overview; odd values fall back", () => {
  const { p } = helpers();
  assert.deepEqual(p(null, false), { tl: "", tr: "", bl: "", br: "", d: 150 });
  assert.deepEqual(p(null, true), { tl: "overview", tr: "", bl: "", br: "", d: 150 });
  assert.deepEqual(p("not json", false), { tl: "", tr: "", bl: "", br: "", d: 150 });
  assert.deepEqual(p(JSON.stringify({ tl: "", tr: "qs", bl: "notifs", br: "desktop", d: 300 }), true),
    { tl: "", tr: "qs", bl: "notifs", br: "desktop", d: 300 }, "a saved record wins over the old switch");
  assert.deepEqual(p(JSON.stringify({ tl: "rm -rf", tr: 1, d: 999 }), false), { tl: "", tr: "", bl: "", br: "", d: 150 });
  assert.deepEqual(p("[1]", false), { tl: "", tr: "", bl: "", br: "", d: 150 });
});

test("which corner: within the given pixels of two edges", () => {
  const { w } = helpers();
  assert.equal(w(0, 0, 1280, 800, 1), "tl");
  assert.equal(w(1279, 0, 1280, 800, 1), "tr");
  assert.equal(w(0, 799, 1280, 800, 1), "bl");
  assert.equal(w(1279, 799, 1280, 800, 1), "br");
  assert.equal(w(640, 0, 1280, 800, 1), "");
  assert.equal(w(3, 3, 1280, 800, 1), "");
  assert.equal(w(30, 30, 1280, 800, 40), "tl");
});

test("mouse only, never with a button held, never while locked; the delay is waited", () => {
  assert.match(SEC, /if \(e\.pointerType !== "mouse"\) return;/);
  assert.match(SEC, /if \(!c \|\| e\.buttons\)/);
  assert.match(SEC, /if \(!action \|\| !ovAllowed\(\)\) return;/);
  assert.match(SEC, /function hcRun\(action\) \{\s+if \(!ovAllowed\(\)\) return;/);
  assert.match(SEC, /\}, rec\.d\);/);
  assert.match(SEC, /HC_ACTIONS = \["", "overview", "qs", "notifs", "desktop"\]/);
  assert.match(SEC, /HC_DELAYS = \[0, 150, 300\]/);
  assert.match(SHELL, /case "hotcorner:tl": case "hotcorner:tr": case "hotcorner:bl": case "hotcorner:br": case "hotcorner:d":/);
});

test("Settings: a Hot corners card, EN/EL/DE", () => {
  const core = read("settings/core.js"), de = read("i18n/de/settings.js");
  assert.match(core, /\["hotcorners", "system", "hc\.title", null, null, "overview"\]/);
  const keys = ["hc.title", "hc.hint", "hc.c.tl", "hc.c.tr", "hc.c.bl", "hc.c.br", "hc.a.none", "hc.a.overview",
    "hc.a.qs", "hc.a.notifs", "hc.a.desktop", "hc.delay", "hc.now", "hc.ms", "w.hotcorners"];
  for (const k of keys) {
    assert.equal(core.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.includes('"' + k + '":'), k + " DE");
  }
});
