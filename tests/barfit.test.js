// BARFIT-2 (Chris 2026-11-23): on a narrow phone with the switcher,
// smart cards, help and a music chip the right end of the top bar was
// cut off. fitBar() got three more levels before the smart bar folds
// its last pill. Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("fitBar: levels 8-10 and the language button only with Quick settings", () => {
  const sh = read("shell.js");
  assert.match(sh, /var BAR_FIT_MAX = 10;/);
  assert.match(sh, /bar\.classList\.toggle\("bar-slim", lvl >= 8\);/);
  assert.match(sh, /bar\.classList\.toggle\("bar-nowx", lvl >= 9\);/);
  assert.match(sh, /bar\.classList\.toggle\("bar-nohelp", lvl >= 10\);/);
  assert.match(sh, /var max = BAR_FIT_MAX, qs = !!document\.getElementById\("qs-btn"\);/);
});

test("the CSS of each level keeps 44px-high hit areas at least 32px wide", () => {
  const css = read("style.css");
  assert.match(css, /#oros-bar\.bar-slim #qs-btn > :not\(:last-child\) \{ display: none; \}/, "the power symbol stays");
  assert.match(css, /#oros-bar\.bar-slim #sync-dot-btn \{ width: 34px; min-width: 34px; \}/);
  assert.match(css, /#oros-bar\.bar-slim #oros-taskbar-bell \{ width: 34px !important; \}/);
  assert.match(css, /#oros-bar\.bar-nowx #wx-chip \{ display: none; \}/);
  assert.match(css, /#oros-bar\.bar-nohelp #help-btn \{ display: none; \}/);
  // the power symbol is the last thing qsettings.js paints in its button
  assert.match(read("qsettings.js"), /html \+= IC\.power;\n    if \(btn\.__qsHtml !== html\)/);
});
