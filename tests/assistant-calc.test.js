// AS-CALC (Assistant wave 5, AH-7, Chris 2026-11-28: fixed tools, never
// run_js): calc uses Spreadsheet's formula engine, file_hash SHA-256.
// Run: node --test tests/assistant-calc.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../assistant/core.js");
const FX = require("../spreadsheet/functions.js");

test("calc: formulas over a table, exact, errors as Excel codes", () => {
  const r = C.calc({ formulas: ["=ROUND(SUM(B2:B3)*1.24,2)", "SUM(1,2)", "=DATEDIF(DATE(2026,1,1),DATE(2026,11,28),\"d\")", "=1/0", "=FOO(1)", "=0.1+0.2"],
    table: [["Item", "Net"], ["a", 10], ["b", "20.5"]] }, FX);
  assert.deepEqual(r.results.map((x) => x.value === undefined ? x.error : x.value), [37.82, 3, 331, "#DIV/0!", "#NAME?", 0.3]);
  assert.equal(r.results[1].formula, "=SUM(1,2)");
});

test("calc: a table holds values only, never formulas; limits", () => {
  const r = C.calc({ formulas: ["=A1", "=A2*2"], table: [["=1+1"], [4]] }, FX);
  assert.deepEqual(r.results.map((x) => x.value), ["=1+1", 8]);
  assert.equal(C.calc({ formulas: Array(30).fill("=1") }, FX).results.length, 20);
  assert.ok(C.calc({ formulas: [] }, FX).err);
  assert.ok(C.calc({ formulas: ["=1"] }, null).err);
  assert.equal(C.calc({ formulas: ["=Other!A1"] }, FX).results[0].error, "#REF!");
});

test("calc and file_hash are offered, routines may use them, nothing else runs", () => {
  assert.deepEqual(C.toolsFor({ calc: true }).map((x) => x.name), ["calc"]);
  assert.ok(C.toolsFor({ files: true }).some((x) => x.name === "file_hash"));
  const as = fs.readFileSync(path.join(__dirname, "../assistant/assistant.js"), "utf8");
  assert.match(as, /github: ghOn, calc: true \}\);/);
  assert.match(as, /github_read: 1, calc: 1, file_hash: 1,/);
  assert.match(as, /loadOnce\("\.\.\/spreadsheet\/functions\.js"\)/);
  assert.match(as, /crypto\.subtle\.digest\("SHA-256", bytes\)/);
  assert.match(as, /function fileHash\(a, apps\) \{[\s\S]*?CF\.reach\(p, x\.folders\)/);
  assert.doesNotMatch(as, /run_js/);
});
