// Spreadsheet .orossheet files (orOS bundle, docs/oros-bundle.md): the
// pure pack / unpack logic in spreadsheet/sheetkit.js (bookContent,
// bookWorkbook, importBook, sheetCSV, csvName), round-tripped through
// bundle.js.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const K = require(path.join(__dirname, "..", "spreadsheet/sheetkit.js"));
const FX = require(path.join(__dirname, "..", "spreadsheet/functions.js"));
const B = require(path.join(__dirname, "..", "bundle.js"));

const MIME = "application/x-oros-sheet";

function book() {
  return {
    ver: 2,
    sheets: [
      { id: "s-main", name: null, bi: { en: "Sheet1", el: "Φύλλο1" }, rows: 100, cols: 26, pos: 0, mtime: 5, cw: { 0: 140 }, fz: { r: 1, c: 0 } },
      { id: "s2", name: "Totals", rows: 50, cols: 10, pos: 1, mtime: 6, cw: {}, rh: { 2: 40 } },
      { id: "gone", name: "Gone", rows: 10, cols: 10, pos: 2, mtime: 1, cw: {} }
    ],
    cells: {
      "s-main|0|0": { v: "Item", mtime: 5, f: { b: 1, bg: "#ffeeaa" }, fm: { v: 5, f: 5 } },
      "s-main|1|0": { v: "Pen", mtime: 5 },
      "s-main|1|1": { v: "2.5", mtime: 5, f: { nf: "2" } },
      "s-main|2|1": { v: "4", mtime: 5 },
      "s2|0|0": { v: "=SUM(Sheet1!B2:B3)+'Totals'!B1+Φύλλο1!B2", mtime: 6 },
      "s2|0|1": { v: "1", mtime: 6 },
      "s2|99|0": { v: "out of the sheet", mtime: 6 },
      "nosheet|0|0": { v: "orphan", mtime: 6 }
    },
    deleted: { gone: 9 },
    charts: { c1: { id: "c1", sid: "s-main", mtime: 7, t: "col", src: "A1:B3", lg: 1, at: { r: 0, c: 3, x: 0, y: 0 }, w: 420, h: 260 } },
    cf: { r1: { id: "r1", sid: "s2", mtime: 8, pos: 0, rg: "A1:B5", k: "gt", a: "1", st: { bg: "#ff0000" } } }
  };
}
// what canonSS would hand bookContent: the deleted sheet is gone
function canon() {
  const st = book();
  st.sheets = st.sheets.filter((s) => s.id !== "gone");
  delete st.deleted;
  return st;
}

test("bookContent: the synced model, no tombstones, no orphans", () => {
  const c = K.bookContent(canon());
  assert.equal(c.kind, "oros-spreadsheet-package");
  assert.equal(c.ver, 1);
  assert.equal(c.workbook.deleted, undefined);
  assert.deepEqual(c.workbook.sheets.map((s) => s.id), ["s-main", "s2"]);
  assert.equal(c.workbook.cells["nosheet|0|0"], undefined);
  assert.deepEqual(c.workbook.cells["s-main|0|0"].f, { b: 1, bg: "#ffeeaa" });
  assert.equal(c.workbook.charts.c1.src, "A1:B3");
  assert.equal(c.workbook.cf.r1.k, "gt");
  assert.deepEqual(c.workbook.sheets[0].fz, { r: 1, c: 0 });
});

test("bookWorkbook: the right kind only, newer versions refused", () => {
  assert.throws(() => K.bookWorkbook({ kind: "oros-writer-package", workbook: { sheets: [] } }), { code: "notbook" });
  assert.throws(() => K.bookWorkbook(null), { code: "notbook" });
  assert.throws(() => K.bookWorkbook({ kind: K.BOOK_KIND, ver: 1, workbook: {} }), { code: "notbook" });
  assert.throws(() => K.bookWorkbook({ kind: K.BOOK_KIND, ver: 2, workbook: { sheets: [] } }), { code: "newer" });
  assert.ok(K.bookWorkbook(K.bookContent(canon())).sheets);
});

test("importBook: fresh ids and stamps, taken names renamed, formulas follow", () => {
  let n = 0;
  const wb = K.bookContent(canon()).workbook;
  const imp = K.importBook(wb, { taken: ["Sheet1", "Φύλλο1"], uid: () => "n" + ++n, now: 1000, pos: 3, mapRefs: FX.mapRefs, lang: "en" });
  assert.deepEqual(imp.sheets.map((s) => [s.id, s.name, s.pos, s.mtime]), [["n1", "Sheet1 (2)", 3, 1000], ["n2", "Totals", 4, 1000]]);
  assert.equal(imp.sheets[0].bi, undefined);
  assert.deepEqual(imp.sheets[0].cw, { 0: 140 });
  assert.deepEqual(imp.sheets[1].rh, { 2: 40 });
  assert.deepEqual(imp.ids, { "s-main": "n1", s2: "n2" });
  assert.deepEqual(imp.renamed, { Sheet1: "Sheet1 (2)", "Φύλλο1": "Sheet1 (2)" });
  // both names of the renamed sheet point at its new name; Totals is untouched
  assert.equal(imp.cells["n2|0|0"].v, "=SUM('Sheet1 (2)'!B2:B3)+'Totals'!B1+'Sheet1 (2)'!B2");
  assert.equal(imp.cells["n1|0|0"].mtime, 1000);
  assert.equal(imp.cells["n1|0|0"].fm, undefined);
  assert.deepEqual(imp.cells["n1|0|0"].f, { b: 1, bg: "#ffeeaa" });
  assert.equal(imp.cells["n2|99|0"], undefined, "a cell outside its sheet is dropped");
  const ch = Object.values(imp.charts), cf = Object.values(imp.cf);
  assert.equal(ch.length, 1);
  assert.equal(ch[0].sid, "n1");
  assert.equal(ch[0].mtime, 1000);
  assert.notEqual(ch[0].id, "c1");
  assert.equal(imp.charts[ch[0].id].id, ch[0].id);
  assert.equal(cf[0].sid, "n2");
  // the source is untouched
  assert.equal(wb.sheets[0].id, "s-main");
});

test("importBook: no clash, no rename; repeated opens keep counting", () => {
  let n = 0;
  const wb = K.bookContent(canon()).workbook;
  const a = K.importBook(wb, { taken: ["Other"], uid: () => "a" + ++n, now: 1, mapRefs: FX.mapRefs });
  assert.equal(a.sheets[0].name, null);
  assert.deepEqual(a.sheets[0].bi, { en: "Sheet1", el: "Φύλλο1" });
  assert.equal(a.cells[a.sheets[1].id + "|0|0"].v, wb.cells["s2|0|0"].v);
  const b = K.importBook(wb, { taken: ["Sheet1", "Sheet1 (2)", "Totals"], uid: () => "b" + ++n, now: 1, mapRefs: FX.mapRefs, lang: "el" });
  assert.deepEqual(b.sheets.map((s) => s.name), ["Φύλλο1 (2)", "Totals (2)"]);
  assert.equal(b.cells[b.sheets[1].id + "|0|0"].v, "=SUM('Φύλλο1 (2)'!B2:B3)+'Totals (2)'!B1+'Φύλλο1 (2)'!B2");
});

test("sheetCSV and csvName: the preview files", () => {
  const st = canon();
  const csv = K.sheetCSV("s-main", st.cells, (sid, r, c, cel) => cel.v);
  assert.equal(csv, "﻿Item,\r\nPen,2.5\r\n,4\r\n");
  assert.equal(K.sheetCSV("nothing", st.cells), null);
  assert.equal(K.sheetCSV("s", { "s|0|0": { v: 'a,"b"' } }), '﻿"a,""b"""\r\n');
  assert.equal(K.csvName(0, "Sheet1"), "01-Sheet1.csv");
  assert.equal(K.csvName(11, "Φύλλο1"), "12-Fyllo1.csv");
  assert.equal(K.csvName(1, "Σύνολα Ιουνίου"), "02-Synola Iouniou.csv");
  assert.equal(K.csvName(0, "数据"), "01-sheet.csv");
  assert.equal(K.csvName(2, "Q1 / Q2: sales"), "03-Q1 _ Q2_ sales.csv");
  assert.ok(B.safePath("preview/" + K.csvName(2, "../x")));
});

test("round trip through bundle.js: write, read, import", async () => {
  const st = canon();
  const content = K.bookContent(st);
  const bytes = await B.write({
    mime: MIME, app: "spreadsheet", schema: "spreadsheet/1", content,
    meta: { title: "Spreadsheet 2026-10-15", language: "en", generator: "orOS Spreadsheet" },
    settings: { active: "s2" },
    preview: st.sheets.map((sh, i) => ({ name: K.csvName(i, sh.name || sh.bi.en), data: K.sheetCSV(sh.id, st.cells), type: "text/csv" })),
    date: new Date(Date.UTC(2026, 9, 15))
  });
  assert.equal(B.sniff(bytes.subarray(0, 128)), MIME);
  const r = await B.read(bytes, { mime: MIME });
  assert.equal(r.app, "spreadsheet");
  assert.equal(r.meta.title, "Spreadsheet 2026-10-15");
  assert.deepEqual(r.settings, { active: "s2" });
  assert.deepEqual(r.content, JSON.parse(JSON.stringify(content)));
  const wb = K.bookWorkbook(r.content);
  let n = 0;
  const imp = K.importBook(wb, { taken: [], uid: () => "x" + ++n, now: 2, mapRefs: FX.mapRefs });
  assert.equal(imp.ids[r.settings.active], "x2");
  assert.equal(Object.keys(imp.cells).length, 6);
  // the wrong app's bundle is refused
  await assert.rejects(B.read(bytes, { mime: "application/x-oros-doc" }), { code: "wrongtype" });
});
