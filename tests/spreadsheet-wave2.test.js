// Spreadsheet Wave 2 sync model (spreadsheet/spreadsheet.js, sections 2–2b):
// charts and conditional-format rules as records of their own
// (state.charts / state.cf, per-record mtime, tombstones "ch:<id>" /
// "cf:<id>"), custom row heights (sheet.rh) and the new cell format
// fields (bg, bd, wr, va, mr, mc). The canonical form must stay a fixed
// point and merge must commute, so no device uploads forever.
// Run: node --test tests/

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
const KIT = require(path.join(__dirname, "..", "spreadsheet/sheetkit.js"));
const M = new Function("KIT",
  "var DATA_VER = 2, ROWS = 100, COLS = 26, MAX_ROWS = 10000, MAX_COLS = 104, SID = 's-main';\n" +
  "function clone(o) { return JSON.parse(JSON.stringify(o)); }\n" +
  block("var SEED_BI", "/* ===== SECTION 2c") +
  "return { canonSS: canonSS, mergeState: mergeState, normalizeState: normalizeState };")(KIT);

const J = (x) => JSON.stringify(x);
const C = (x) => JSON.parse(J(x));
function canon(x) { return M.canonSS(M.normalizeState(C(x))); }

function plain() {
  return {
    ver: 2,
    sheets: [{ id: "s-main", name: "Data", rows: 100, cols: 26, pos: 0, mtime: 10, cw: {} }],
    cells: { "s-main|0|0": { v: "Name", mtime: 10, fm: { v: 10, f: 10 } } },
    deleted: {}
  };
}
function chart(id, mtime, extra) {
  return Object.assign({ id: id, sid: "s-main", mtime: mtime, t: "col", src: "A1:C4",
    at: { r: 1, c: 5, x: 0, y: 0 }, w: 420, h: 260 }, extra || {});
}
function rule(id, mtime, extra) {
  return Object.assign({ id: id, sid: "s-main", mtime: mtime, rg: "B2:C4", k: "gt", a: "10",
    st: { bg: "#f6d36b" } }, extra || {});
}
function rich() {
  const s = plain();
  s.sheets[0].rh = { 2: 40, 5: 120 };
  s.cells["s-main|1|1"] = { v: "x", mtime: 20, fm: { v: 20, f: 20 },
    f: { b: 1, bg: "#ffee00", bd: "tblr", wr: 1, va: "m", mr: 2, mc: 3 } };
  s.charts = { "c-1": chart("c-1", 30, { ttl: "Sales", co: ["#ff0000"] }) };
  s.cf = { "r-1": rule("r-1", 31), "r-2": rule("r-2", 32, { k: "cs", cs: ["#ffffff", "#2a78d6"] }) };
  return s;
}

test("a workbook without the new features keeps its exact bytes", () => {
  const c = canon(plain());
  assert.equal("charts" in c, false);
  assert.equal("cf" in c, false);
  assert.equal("rh" in c.sheets[0], false);
  assert.deepEqual(Object.keys(c), ["ver", "sheets", "cells", "deleted"]);
});

test("canon is a fixed point with charts, rules, row heights and new formats", () => {
  const a = canon(rich());
  const b = canon(a);
  assert.equal(J(b), J(a));
  assert.deepEqual(a.sheets[0].rh, { 2: 40, 5: 120 });
  const f = a.cells["s-main|1|1"].f;
  assert.deepEqual(Object.keys(f), ["b", "bg", "bd", "wr", "va", "mr", "mc"]);
  assert.equal(a.charts["c-1"].ttl, "Sales");
  assert.equal(Object.keys(a.cf).length, 2);
});

test("bad records and values are dropped or clamped, not kept", () => {
  const s = rich();
  s.sheets[0].rh = { 3: 1, x: 50, 4: 9999 };
  s.charts.bad = { id: "other", sid: "s-main" };
  s.cf["r-3"] = rule("r-3", 1, { k: "nope" });
  s.cf["r-4"] = rule("r-4", 1, { rg: "not a range" });
  const c = canon(s);
  assert.equal("bad" in c.charts, false);
  assert.equal("r-3" in c.cf, false);
  assert.equal("r-4" in c.cf, false);
  assert.ok(c.sheets[0].rh[3] >= 18 && c.sheets[0].rh[4] <= 400);
  assert.equal("x" in c.sheets[0].rh, false);
});

test("merge commutes and is idempotent", () => {
  const a = rich();
  const b = rich();
  b.charts["c-1"] = chart("c-1", 40, { t: "line" });
  b.charts["c-2"] = chart("c-2", 41, { t: "pie" });
  b.cf["r-1"] = rule("r-1", 25, { a: "99" });
  b.sheets[0] = Object.assign({}, b.sheets[0], { mtime: 50, rh: { 2: 60 } });
  const ab = M.mergeState(C(a), C(b)), ba = M.mergeState(C(b), C(a));
  assert.equal(J(ab), J(ba));
  assert.equal(J(M.mergeState(C(ab), C(ab))), J(ab));
  assert.equal(J(M.mergeState(C(ab), C(a))), J(ab));
  assert.equal(ab.charts["c-1"].t, "line");     /* newer wins */
  assert.equal(ab.charts["c-2"].t, "pie");      /* union */
  assert.equal(ab.cf["r-1"].a, "10");           /* local newer kept */
  assert.deepEqual(ab.sheets[0].rh, { 2: 60 });
});

test("a delete wins a tie; a newer edit brings the record back", () => {
  const a = rich(), b = rich();
  delete b.charts["c-1"]; b.deleted["ch:c-1"] = 30;
  delete b.cf["r-2"]; b.deleted["cf:r-2"] = 32;
  let m = M.mergeState(C(a), C(b));
  assert.equal("c-1" in (m.charts || {}), false);
  assert.equal("r-2" in m.cf, false);
  assert.equal(J(M.mergeState(C(b), C(a))), J(m));
  a.charts["c-1"].mtime = 35;
  m = M.mergeState(C(a), C(b));
  assert.equal(m.charts["c-1"].mtime, 35);
});

test("charts and rules go with their deleted sheet", () => {
  const a = rich();
  a.sheets.push({ id: "s-two", name: "Two", rows: 100, cols: 26, pos: 1, mtime: 10, cw: {} });
  a.charts["c-9"] = chart("c-9", 30, { sid: "s-two" });
  a.cf["r-9"] = rule("r-9", 30, { sid: "s-two" });
  const b = C(a);
  b.sheets = b.sheets.filter((s) => s.id !== "s-two");
  b.deleted["s-two"] = 60;
  const m = M.mergeState(C(a), C(b));
  assert.equal(m.sheets.length, 1);
  assert.equal("c-9" in m.charts, false);
  assert.equal("r-9" in m.cf, false);
});

test("a copy stripped by an older version loses nothing on merge", () => {
  /* the previous spreadsheet.js keeps only the fields it knows: no
     charts / cf / rh, and cell formats without the new fields */
  const a = canon(rich());
  const old = C(a);
  delete old.charts; delete old.cf; delete old.sheets[0].rh;
  old.cells["s-main|1|1"].f = { b: 1 };
  const m = M.mergeState(C(a), C(old));
  assert.equal(J(m), J(a));
  assert.equal(J(M.mergeState(C(old), C(a))), J(a));
});
