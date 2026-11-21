// SIGNAL-1: the dot-matrix skin "Signal", its "Dot matrix" wallpaper and
// the clock widget's LED dots (widgets.js clock style).
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const W = require(path.join(ROOT, "widgets.js"));
const SHELL = read("shell.js"), CSS = read("style.css");

function lum(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => {
    const c = parseInt(h.substr(i, 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a, b) {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function block(theme) {
  const m = new RegExp('^\\[data-skin="signal"\\]\\[data-theme="' + theme + '"\\] \\{([^}]*)\\}', "m").exec(CSS);
  assert.ok(m, "signal/" + theme + " block");
  const v = {};
  for (const d of m[1].matchAll(/--([a-z-]+):\s*([^;]+);/g)) v[d[1]] = d[2].trim();
  return v;
}

test("Signal is the 17th skin, suggests the Dot matrix wallpaper", () => {
  assert.match(SHELL, /\{ id: "signal",\s+color: "#ff3b30", wp: "dots" \}/);
  assert.match(SHELL, /\{ id: "dots",\s+css: "radial-gradient/);
  assert.match(SHELL, /WALLPAPER_NAMED = \{[^}]*\bdots: 1/);
  for (const f of ["translations.js", "i18n/de/shell.js"]) assert.equal((read(f).match(/"wp\.name\.dots":/g) || []).length, f === "translations.js" ? 2 : 1, f);
});

test("Signal reads well, dark and light: text, dim text and accent >= 4.5:1, ink on accent too", () => {
  for (const theme of ["dark", "light"]) {
    const v = block(theme);
    for (const bg of [v.bg, v["panel-bg"], v["bg-desktop"]]) {
      assert.ok(contrast(v.text, bg) >= 7, theme + " text on " + bg);
      assert.ok(contrast(v["text-dim"], bg) >= 4.5, theme + " dim on " + bg);
      assert.ok(contrast(v.accent, bg) >= 4.5, theme + " accent on " + bg);
    }
    assert.ok(contrast(v["accent-ink"], v.accent) >= 4.5, theme + " ink");
  }
});

test("dot glyphs: 0-9 are 5x7, the colon one column", () => {
  for (const ch of "0123456789") {
    const g = W.GLYPHS[ch];
    assert.equal(g.length, 7, ch);
    for (const row of g) assert.match(row, /^[01]{5}$/, ch);
  }
  assert.deepEqual(W.GLYPHS[":"].map((r) => r.length), [1, 1, 1, 1, 1, 1, 1]);
  const all = Object.keys(W.GLYPHS).filter((k) => k !== ":").map((k) => W.GLYPHS[k].join(""));
  assert.equal(new Set(all).size, 10, "every digit has its own shape");
});

test("dotCells lays glyphs out with one empty column between them", () => {
  const d = W.dotCells("21:07");
  assert.equal(d.cols, 4 * 5 + 1 + 4);        // 4 digits, a colon, 4 gaps
  assert.equal(d.cells.length, (4 * 5 + 1) * 7);
  assert.ok(d.cells.every((c) => c.x >= 0 && c.x < d.cols && c.y >= 0 && c.y < 7));
  const colon = d.cells.filter((c) => c.x === 12);
  assert.deepEqual(colon.filter((c) => c.on).map((c) => c.y), [2, 4]);
  assert.equal(W.dotCells("x").cols, 0, "unknown characters are left out");
  assert.equal(W.hhmm(new Date(2026, 0, 1, 7, 5)), "07:05");
});

test("clock style: kept in the prefs, Automatic = dots only with Signal", () => {
  assert.deepEqual(W.norm({ list: ["clock"], clock: "dots" }), { v: 1, list: ["clock"], clock: "dots" });
  assert.deepEqual(W.norm({ list: ["clock"], clock: "auto" }), { v: 1, list: ["clock"] });
  assert.deepEqual(W.norm({ list: ["clock"], clock: "<b>" }), { v: 1, list: ["clock"] });
  assert.equal(W.clockMode(undefined, "signal"), "dots");
  assert.equal(W.clockMode("auto", "oros"), "digits");
  assert.equal(W.clockMode("digits", "signal"), "digits");
  assert.equal(W.clockMode("dots", "tux"), "dots");
  assert.deepEqual(W.CLOCK_STYLES, ["auto", "digits", "dots"]);
});

test("clock style strings in EN, EL and DE; no blinking in the dots", () => {
  const tr = read("translations.js"), de = read("i18n/de/shell.js"), src = read("widgets.js");
  for (const st of W.CLOCK_STYLES) {
    assert.equal((tr.match(new RegExp('"wg\\.clock\\.' + st + '":', "g")) || []).length, 2, st);
    assert.equal((de.match(new RegExp('"wg\\.clock\\.' + st + '":', "g")) || []).length, 1, st);
  }
  assert.doesNotMatch(src.slice(src.indexOf("wg-dots"), src.indexOf("wg-dots") + 400), /animation|@keyframes/);
  assert.match(src, /data-oros-contrast=\\"high\\"\] \.wg-dots \.wg-off \{ display: none; \}/);
});
