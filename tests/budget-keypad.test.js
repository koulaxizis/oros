// Budget amount keypad (C6): sums in the amount field.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const K = require("../budget/keypad.js");

const src = fs.readFileSync(path.join(__dirname, "..", "budget/budget.js"), "utf8");
const block = (from, to) => { const i = src.indexOf(from), j = src.indexOf(to, i); return src.slice(i, j); };
const B = new Function(block("  var STORAGE_KEY", "  // ---------- 1.") + block("  function cmpStr(", "  function newId(") +
  block("  // ---------- 2. Money", "  // ---------- 6. Storage") + "\nreturn { parseAmount, MAX_CENTS };")();
const calc = (s) => K.calc(s, B.parseAmount, B.MAX_CENTS);

test("sums: + − × ÷, Greek and English numbers, × and ÷ first", () => {
  assert.equal(calc("12+4,5"), 1650);
  assert.equal(calc("12+4.5"), 1650);
  assert.equal(calc("20−3,40"), 1660);
  assert.equal(calc("20-3"), 1700);
  assert.equal(calc("3×2,5"), 750);
  assert.equal(calc("10÷3"), 333);
  assert.equal(calc("2+3×4"), 1400);
  assert.equal(calc("1.234,56+0,44"), 123500);
  assert.equal(calc("12+"), 1200);          // a last operator is ignored
  assert.equal(calc("7"), 700);
});

test("sums that can't be an amount", () => {
  ["", "+5", "5++5", "5-10", "abc+1", "0", "5÷0", "1000000000×2"].forEach((s) => assert.equal(calc(s), null, s));
  assert.equal(K.hasOp("12"), false);
  assert.equal(K.hasOp("12+3"), true);
  assert.equal(K.hasOp("1.234,56"), false);
});
