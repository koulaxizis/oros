// Formula engine of the orOS Spreadsheet: tokenizer, parser and
// evaluator (operators, plain ranges A1:B5, functions).
// Run: node --test tests/
//
// The app is a browser IIFE with no exports, so the engine is cut out
// of the source and evaluated with a tiny in-memory sheet.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "spreadsheet/spreadsheet.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const E = new Function(
  "var state = { cells: {}, sheets: [] }, actSID = 's1';\n" +
  "function cellKey(sid, r, c) { return sid + '|' + r + '|' + c; }\n" +
  "function findSheetByName() { return null; }\n" +
  block("function colFromName(", "\n}\n") + "\n}\n" +
  block("var TT_NUM", "function fmtVal(") +
  block("function fmtVal(", "\n}\n") + "\n}\n" +
  "return { state: state, tokenize: tokenize, evalCell: evalCell, reset: function () { EVAL_CACHE = {}; } };")();

function sheet(cells) {
  E.state.cells = {};
  E.reset();
  Object.keys(cells).forEach((a1) => {
    const m = a1.match(/^([A-Z]+)(\d+)$/);
    const c = m[1].charCodeAt(0) - 65, r = +m[2] - 1;
    E.state.cells["s1|" + r + "|" + c] = { v: cells[a1] };
  });
}
function val(a1) {
  const m = a1.match(/^([A-Z]+)(\d+)$/);
  return E.evalCell("s1", +m[2] - 1, m[1].charCodeAt(0) - 65, {});
}

test("operators: arithmetic, precedence, parentheses, comparison, &", () => {
  sheet({ A1: "=1+1", A2: "=2*3+1", A3: "=(1+2)*3", A4: "=10/4-1", A5: "=2^3", A6: "=3>2", A7: '="a"&"b"', A8: "=1/0" });
  assert.equal(val("A1"), 2);
  assert.equal(val("A2"), 7);
  assert.equal(val("A3"), 9);
  assert.equal(val("A4"), 1.5);
  assert.equal(val("A5"), 8);
  assert.equal(val("A6"), 1);
  assert.equal(val("A7"), "ab");
  assert.equal(val("A8"), "#DIV/0!");
});

test("plain ranges A1:B5 are one reference", () => {
  const tk = E.tokenize("=SUM(B2:B4)");
  assert.deepEqual(tk.filter((x) => x.value === "B2:B4").length, 1);
  sheet({ B2: "-12.5", B3: "1000", B4: "-7", B5: "=SUM(B2:B4)", C1: "=AVERAGE(B2:B3)", C2: "=SUM(B2,B3)+B4", C3: "=MAX(B2:B4)-MIN(B2:B4)" });
  assert.equal(val("B5"), 980.5);
  assert.equal(val("C1"), 493.75);
  assert.equal(val("C2"), 980.5);
  assert.equal(val("C3"), 1012.5);
});
