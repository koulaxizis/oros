// Spreadsheet wave 4.4: range selection on touch. The corner handles'
// pure part (sheetkit.js handleGrab / handleMove) and the extend mode's
// wiring and strings. Dragging itself is checked in the real shell.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const KIT = require(path.join(__dirname, "..", "spreadsheet/sheetkit.js"));
const SRC = fs.readFileSync(path.join(__dirname, "..", "spreadsheet/spreadsheet.js"), "utf8");

test("grabbing a corner anchors the opposite one", () => {
  const g = { t: 2, b: 5, l: 1, r: 3 };
  assert.deepEqual(KIT.handleGrab(g, "b", 100, 26), { ar: 2, ac: 1, r: 5, c: 3, lockR: false, lockC: false });
  assert.deepEqual(KIT.handleGrab(g, "a", 100, 26), { ar: 5, ac: 3, r: 2, c: 1, lockR: false, lockC: false });
  /* a single cell: both corners are the cell */
  const one = KIT.handleGrab({ t: 4, b: 4, l: 2, r: 2 }, "b", 100, 26);
  assert.deepEqual([one.ar, one.ac, one.r, one.c], [4, 2, 4, 2]);
});

test("moving the end follows the finger, past the anchor too", () => {
  const o = KIT.handleGrab({ t: 2, b: 5, l: 1, r: 3 }, "b", 100, 26);
  assert.deepEqual(KIT.handleMove(o, { r: 9, c: 7 }), { r: 9, c: 7 });
  assert.deepEqual(KIT.handleMove(o, { r: 0, c: 0 }), { r: 0, c: 0 });   /* flips over the anchor */
});

test("whole columns keep their rows, whole rows their columns", () => {
  const cols = KIT.handleGrab({ t: 0, b: 99, l: 1, r: 1 }, "a", 100, 26);
  assert.equal(cols.lockR, true); assert.equal(cols.lockC, false);
  assert.deepEqual(KIT.handleMove(cols, { r: 40, c: 3 }), { r: 0, c: 3 });
  const rows = KIT.handleGrab({ t: 4, b: 4, l: 0, r: 25 }, "b", 100, 26);
  assert.equal(rows.lockC, true);
  assert.deepEqual(KIT.handleMove(rows, { r: 8, c: 2 }), { r: 8, c: 25 });
  /* the whole sheet: nothing locked */
  const all = KIT.handleGrab({ t: 0, b: 99, l: 0, r: 25 }, "b", 100, 26);
  assert.equal(all.lockR || all.lockC, false);
});

test("extend mode stays on until ended, for mouse and touch", () => {
  /* a tap in extend mode grows the selection in mousedown already (touch
     sends mousedown before click, and a collapse there lost the anchor) */
  const md = SRC.slice(SRC.indexOf('$("grid").addEventListener("mousedown"'), SRC.indexOf('$("grid").addEventListener("mousemove"'));
  assert.match(md, /if \(RANGE_MODE\) \{/);
  assert.doesNotMatch(md, /RANGE_MODE = false/);
  assert.match(md, /headerSelect\(pos, e\.shiftKey \|\| RANGE_MODE\)/);
  const ck = SRC.slice(SRC.indexOf('$("grid").addEventListener("click"'), SRC.indexOf("/* ---- touch (Wave 2)"));
  assert.doesNotMatch(ck, /RANGE_MODE = false/);
  assert.match(ck, /headerSelect\(pos, RANGE_MODE\)/);
  /* ended by the chip, Esc and editing */
  assert.match(SRC, /RANGE_MODE && k === "Escape"\) \{ setRangeMode\(false\)/);
  assert.match(SRC.slice(SRC.indexOf("function beginEdit"), SRC.indexOf("function beginEdit") + 200), /setRangeMode\(false\)/);
});

test("the handles show only for touch, never over the editor or a chart", () => {
  const f = SRC.slice(SRC.indexOf("function placeRangeHandles"), SRC.indexOf("function rgMove"));
  assert.match(f, /!touchUi\(\) \|\| editing \|\| CHSEL/);
  assert.match(SRC, /function placeFillHandle\(\) \{\n  placeRangeHandles\(\);/);
});

test("strings in EN, EL and DE", () => {
  const de = fs.readFileSync(path.join(__dirname, "..", "i18n/de/spreadsheet.js"), "utf8");
  const en = SRC.slice(SRC.indexOf("var STRINGS"), SRC.indexOf("\n  el:"));
  const el = SRC.slice(SRC.indexOf("\n  el:"));
  for (const k of ["rg.mode", "rg.tap", "rg.off", "rg.chip", "rg.x", "rg.ha"]) {
    assert.ok(en.includes('"' + k + '":'), "EN " + k);
    assert.ok(el.includes('"' + k + '":'), "EL " + k);
    assert.ok(de.includes('"' + k + '":'), "DE " + k);
  }
});
