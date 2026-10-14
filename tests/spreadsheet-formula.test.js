// Formula engine of the orOS Spreadsheet (spreadsheet/functions.js):
// tokenizer, parser and evaluator (operators, ranges A1:B5, functions)
// with a tiny in-memory sheet.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const FX = require(path.join(__dirname, "..", "spreadsheet/functions.js"));

const cells = {};
const E = FX.engine({
  raw: (sid, r, c) => cells[sid + "|" + r + "|" + c] || "",
  sheetId: () => null,
  extent: () => ({ rows: 50, cols: 10 }),
  formulaCells: () => [],
  lang: "en",
  now: () => Date.UTC(2026, 9, 14, 10)
});

function sheet(map) {
  Object.keys(cells).forEach((k) => delete cells[k]);
  E.reset();
  Object.keys(map).forEach((a1) => {
    const m = a1.match(/^([A-Z]+)(\d+)$/);
    cells["s1|" + (+m[2] - 1) + "|" + FX.colFromName(m[1])] = map[a1];
  });
}
function val(a1) {
  const m = a1.match(/^([A-Z]+)(\d+)$/);
  return E.value("s1", +m[2] - 1, FX.colFromName(m[1]));
}

test("operators: arithmetic, precedence, parentheses, comparison, &", () => {
  sheet({ A1: "=1+1", A2: "=2*3+1", A3: "=(1+2)*3", A4: "=10/4-1", A5: "=2^3", A6: "=3>2", A7: '="a"&"b"', A8: "=1/0" });
  assert.equal(val("A1"), 2);
  assert.equal(val("A2"), 7);
  assert.equal(val("A3"), 9);
  assert.equal(val("A4"), 1.5);
  assert.equal(val("A5"), 8);
  assert.equal(val("A6"), true);
  assert.equal(val("A7"), "ab");
  assert.equal(val("A8"), "#DIV/0!");
});

test("unary minus, percent and Excel precedence", () => {
  sheet({ A1: "4", B1: "=-A1", B2: "=-2^2", B3: "=2^3^2", B4: "=50%", B5: "=--A1", B6: "=1-(-1)" });
  assert.equal(val("B1"), -4);
  assert.equal(val("B2"), 4);      // Excel: negation binds before ^
  assert.equal(val("B3"), 64);     // Excel: ^ is left-associative
  assert.equal(val("B4"), 0.5);
  assert.equal(val("B5"), 4);
  assert.equal(val("B6"), 2);
});

test("plain ranges A1:B5 are one reference", () => {
  const tk = FX.tokenize("=SUM(B2:B4)");
  assert.equal(tk.filter((x) => x.t === FX.T.REF && x.v === "B2:B4").length, 1);
  sheet({ B2: "-12.5", B3: "1000", B4: "-7", B5: "=SUM(B2:B4)", C1: "=AVERAGE(B2:B3)", C2: "=SUM(B2,B3)+B4", C3: "=MAX(B2:B4)-MIN(B2:B4)" });
  assert.equal(val("B5"), 980.5);
  assert.equal(val("C1"), 493.75);
  assert.equal(val("C2"), 980.5);
  assert.equal(val("C3"), 1012.5);
});

test("absolute refs, whole columns, zero-argument functions, strings", () => {
  sheet({ A1: "1", A2: "2", A3: "3", B1: "=SUM($A$1:A3)", B2: "=SUM(A:A)", B3: "=PI()*2", B4: '="say ""hi"""', B5: '="old \\"esc\\""' });
  assert.equal(val("B1"), 6);
  assert.equal(val("B2"), 6);
  assert.ok(Math.abs(val("B3") - 2 * Math.PI) < 1e-12);
  assert.equal(val("B4"), 'say "hi"');
  assert.equal(val("B5"), 'old "esc"');
});

test("blanks: a blank reference is 0, ranges keep blanks out of AVERAGE", () => {
  sheet({ A1: "4", A3: "8", B1: "=A2", B2: "=AVERAGE(A1:A3)", B3: "=A2+1", B4: '=A2&"x"', B5: "=ISBLANK(A2)", B6: '=A2=""', B7: "=A2=0" });
  assert.equal(val("B1"), 0);
  assert.equal(val("B2"), 6);
  assert.equal(val("B3"), 1);
  assert.equal(val("B4"), "x");
  assert.equal(val("B5"), true);
  assert.equal(val("B6"), true);
  assert.equal(val("B7"), true);
});

test("errors: unknown names, cycles, bad syntax; text that starts with # is text", () => {
  sheet({ A1: "=FOO(1)", A2: "=nope", A3: "=A3+1", A4: "=1+", A5: "#hashtag", A6: "=LEN(A5)", A7: "=Other!A1" });
  assert.equal(val("A1"), "#NAME?");
  assert.equal(val("A2"), "#NAME?");
  assert.equal(val("A3"), "#CYC!");
  assert.equal(val("A4"), "#ERROR!");
  assert.equal(val("A5"), "#hashtag");
  assert.equal(val("A6"), 8);
  assert.equal(val("A7"), "#REF!");
});

test("a long chain of formulas does not overflow the stack", () => {
  sheet({ A1: "1" });
  for (let r = 1; r < 8000; r++) cells["s1|" + r + "|0"] = "=A" + r + "+1";
  const E2 = FX.engine({
    raw: (sid, r, c) => cells[sid + "|" + r + "|" + c] || "",
    sheetId: () => null, extent: () => ({ rows: 8000, cols: 1 }),
    formulaCells: () => { const o = []; for (let r = 1; r < 8000; r++) o.push(["s1", r, 0]); return o; },
    lang: "en"
  });
  assert.equal(E2.value("s1", 7999, 0), 8000);
});
