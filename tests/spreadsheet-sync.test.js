// Spreadsheet sync model (spreadsheet/spreadsheet.js, sections 2–2b):
// the new per-sheet freeze field `fz`, the larger size caps and the
// date number format keep the canonical form stable and merge without
// loss (no endless uploads: canon(x) is a fixed point, merge commutes).
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
  "return { canonSS: canonSS, mergeState: mergeState, normFz: normFz, blankState: blankState };")(KIT);

const J = (x) => JSON.stringify(x);

function base() {
  return {
    ver: 2,
    sheets: [{ id: "s-main", name: "Data", rows: 100, cols: 26, pos: 0, mtime: 10, cw: { 1: 120 } }],
    cells: { "s-main|0|0": { v: "Name", mtime: 10, fm: { v: 10, f: 10 } } },
    deleted: {}
  };
}

test("a sheet without frozen panes keeps its exact bytes (no new field)", () => {
  const c = M.canonSS(base());
  assert.equal("fz" in c.sheets[0], false);
  assert.equal(J(M.canonSS(c)), J(c));
});

test("fz is normalised: numbers, at least one side, capped", () => {
  assert.deepEqual(M.normFz({ r: "2", c: 0 }, { rows: 100, cols: 26 }), { r: 2, c: 0 });
  assert.equal(M.normFz({ r: 0, c: 0 }, { rows: 100, cols: 26 }), null);
  assert.equal(M.normFz({ r: -3, c: "x" }, { rows: 100, cols: 26 }), null);
  assert.equal(M.normFz("junk", { rows: 100, cols: 26 }), null);
  assert.deepEqual(M.normFz({ r: 999, c: 999 }, { rows: 100, cols: 26 }), { r: 50, c: 25 });
  assert.deepEqual(M.normFz({ r: 5, c: 1 }, { rows: 3, cols: 26 }), { r: 2, c: 1 });
  const st = base();
  st.sheets[0].fz = { r: 1, c: 2, extra: true };
  const c = M.canonSS(st);
  assert.deepEqual(c.sheets[0].fz, { r: 1, c: 2 });
  assert.deepEqual(Object.keys(c.sheets[0]), ["id", "name", "rows", "cols", "pos", "mtime", "cw", "fz"]);
  assert.equal(J(M.canonSS(c)), J(c));
});

test("bigger sheets: 10,000 rows × 104 columns are kept, more is capped", () => {
  const st = base();
  st.sheets[0].rows = 5000; st.sheets[0].cols = 104;
  assert.equal(M.canonSS(st).sheets[0].rows, 5000);
  assert.equal(M.canonSS(st).sheets[0].cols, 104);
  st.sheets[0].rows = 25000; st.sheets[0].cols = 500;
  assert.equal(M.canonSS(st).sheets[0].rows, 10000);
  assert.equal(M.canonSS(st).sheets[0].cols, 104);
  st.cells["s-main|9999|103"] = { v: "far", mtime: 11, fm: { v: 11, f: 11 } };
  assert.equal(M.canonSS(st).cells["s-main|9999|103"].v, "far");
});

test("freeze set on one device merges like column widths (newer sheet wins), both ways", () => {
  const a = base(), b = base();
  b.sheets[0].fz = { r: 1, c: 1 }; b.sheets[0].mtime = 20;
  const ab = M.mergeState(a, b), ba = M.mergeState(b, a);
  assert.deepEqual(ab.sheets[0].fz, { r: 1, c: 1 });
  assert.equal(J(ab), J(ba));
  assert.equal(J(M.mergeState(ab, b)), J(ab));        // idempotent: nothing left to upload
  assert.equal(J(M.mergeState(ab, a)), J(ab));
  // unfreeze later on A wins
  const a2 = JSON.parse(J(ab)); delete a2.sheets[0].fz; a2.sheets[0].mtime = 30;
  const m = M.mergeState(ab, a2);
  assert.equal("fz" in m.sheets[0], false);
  assert.equal(J(m), J(M.mergeState(a2, ab)));
});

test("the date number format survives the canonical form and a merge", () => {
  const a = base();
  a.cells["s-main|1|0"] = { v: "46309", f: { nf: "d", b: 1 }, mtime: 12, fm: { v: 12, f: 12 } };
  const c = M.canonSS(a);
  assert.deepEqual(c.cells["s-main|1|0"].f, { b: 1, nf: "d" });
  const b = base();
  b.cells["s-main|1|0"] = { v: "46310", mtime: 15, fm: { v: 15, f: 0 } };
  const m = M.mergeState(c, b);
  assert.equal(m.cells["s-main|1|0"].v, "46310");          // newer value
  assert.deepEqual(m.cells["s-main|1|0"].f, { b: 1, nf: "d" });  // format kept
});
