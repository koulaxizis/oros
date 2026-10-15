// The orOS Converter, Spreadsheet's side (spreadsheet/convert.js,
// OrosConvert.spreadsheet): .xlsx / .xls / .ods / .csv -> .orossheet
// through the import code the app itself uses (spreadsheet/
// sheetimport.js). Fixtures are made with the vendored SheetJS.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const X = require(path.join(ROOT, "vendor/xlsx.full.min.js"));
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "spreadsheet/sheetkit.js"));
const FX = require(path.join(ROOT, "spreadsheet/functions.js"));
const SI = require(path.join(ROOT, "spreadsheet/sheetimport.js"));
const C = require(path.join(ROOT, "spreadsheet/convert.js"));

// spreadsheet.js normalizeState / canonSS, taken from the app's source
// (the same way tests/spreadsheet-sync.test.js does)
const src = fs.readFileSync(path.join(ROOT, "spreadsheet/spreadsheet.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const M = new Function("KIT",
  "var DATA_VER = 2, ROWS = 100, COLS = 26, MAX_ROWS = 10000, MAX_COLS = 104, SID = 's-main';\n" +
  "function clone(o) { return JSON.parse(JSON.stringify(o)); }\n" +
  block("var SEED_BI", "/* ===== SECTION 2c") +
  "return { canonSS: canonSS, normalizeState: normalizeState, blankState: blankState };")(K);

function file(bytes, name) {
  const b = new Blob([bytes]);
  return Object.assign(b, { name }); // Blob with a name, like a File
}
function xlFile(wb, bookType, name) {
  return file(new Uint8Array(X.write(wb, { type: "array", bookType })), name);
}
function unzip(blob) {
  return blob.arrayBuffer().then((ab) => {
    const u8 = new Uint8Array(ab);
    const z = X.CFB.read(u8, { type: "array" });
    const files = {};
    z.FullPaths.forEach((p, i) => {
      const e = z.FileIndex[i];
      if (e && e.type === 2) files[p.replace(/^[^/]*\//, "")] = Buffer.from(e.content).toString("utf8");
    });
    return { u8, files };
  });
}
async function convert(f, opts) {
  const r = await C.convert(f, opts);
  const z = await unzip(r.blob);
  const bk = await B.read(z.u8, { mime: C.mime });
  return { r, bk, wb: bk.content.workbook, files: z.files };
}

function sampleBook() {
  const wb = X.utils.book_new();
  const ws = X.utils.aoa_to_sheet([
    ["Item", "Qty", "Price", "Total"],
    ["Pen", 2, 1.5, { t: "n", f: "B2*C2", v: 3 }],
    ["Μολύβι", 4, 0.5, { t: "n", f: "B3*C3", v: 2 }],
    ["Paid", true, null, { t: "n", f: "SUM(D2:D3)", v: 5 }]
  ]);
  ws["!merges"] = [{ s: { r: 5, c: 0 }, e: { r: 5, c: 2 } }];
  ws["A6"] = { t: "s", v: "Merged" };
  ws["!ref"] = "A1:D6";
  ws["!rows"] = [undefined, { hpt: 30 }];
  X.utils.book_append_sheet(wb, ws, "Τιμές");
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([
    ["Sum", { t: "n", f: "SUM('Τιμές'!B2:B3)", v: 6 }],
    ["Date", new Date(2024, 2, 1)]
  ], { cellDates: true }), "Totals");
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([]), "Empty");
  return wb;
}

test("the contract: UMD module, accepted types, deps that exist", () => {
  assert.equal(C.app, "spreadsheet");
  assert.equal(C.to, ".orossheet");
  assert.equal(C.mime, "application/x-oros-sheet");
  assert.deepEqual(C.from, [".xlsx", ".xls", ".ods", ".csv"]);
  C.deps.forEach((d) => assert.ok(fs.existsSync(path.join(ROOT, d)), d));
  assert.equal(typeof C.convert, "function");
});

test(".xlsx -> every sheet with data, values, formulas + cached results, merges, row heights", async () => {
  const { r, bk, wb, files } = await convert(xlFile(sampleBook(), "xlsx", "Prices 2024.xlsx"), { lang: "en" });
  assert.equal(r.name, "Prices 2024.orossheet");
  assert.deepEqual(r.warnings, []);
  assert.equal(bk.app, "spreadsheet");
  assert.equal(bk.schema, "spreadsheet/1");
  assert.equal(bk.content.kind, K.BOOK_KIND);
  assert.equal(bk.meta.title, "Prices 2024");
  // the empty worksheet has no range and is skipped, like in the app
  assert.deepEqual(wb.sheets.map((s) => s.name), ["Τιμές", "Totals"]);
  assert.deepEqual(wb.sheets.map((s) => s.pos), [1, 2]);
  const [s1, s2] = wb.sheets;
  assert.equal(bk.settings.active, s2.id);
  const cell = (sh, a) => {
    const q = /^([A-Z]+)(\d+)$/.exec(a);
    return wb.cells[sh.id + "|" + (q[2] - 1) + "|" + K.colFromName(q[1])];
  };
  assert.equal(cell(s1, "A3").v, "Μολύβι");
  assert.equal(cell(s1, "C2").v, "1.5");
  assert.equal(cell(s1, "B4").v, "TRUE");
  assert.equal(cell(s1, "D2").v, "=B2*C2");
  assert.equal(cell(s1, "D2").cv, "3");
  assert.equal(cell(s1, "D4").v, "=SUM(D2:D3)");
  assert.deepEqual(cell(s1, "A6").f, { mc: 3 });
  assert.equal(s1.rh[1], 40);
  assert.equal(cell(s2, "B1").v, "=SUM('Τιμές'!B2:B3)");
  assert.equal(cell(s2, "B2").v, "2024-03-01");
  assert.equal(s1.rows, 100);
  assert.equal(s1.cols, 26);
  // preview CSVs: shown values, formulas by the engine's result
  assert.ok(files["preview/01-Times.csv"], Object.keys(files).join());
  assert.match(files["preview/01-Times.csv"], /Pen,2,1\.5,3\r\n/);
  assert.match(files["preview/01-Times.csv"], /Paid,TRUE,,5\r\n/);
  assert.match(files["preview/02-Totals.csv"], /^﻿Sum,6\r\n/);
});

test("the content is what the app's canonSS + bookContent make of the same import", async () => {
  const wbx = sampleBook();
  let n = 0;
  const imp = SI.workbookSheets(wbx, X.utils, { uid: () => "id" + (n++), now: 1000, pos: 1 });
  const st = M.blankState();
  imp.sheets.forEach((s) => st.sheets.push(s));
  Object.assign(st.cells, imp.cells);
  const app = K.bookContent(M.canonSS(st));
  const mine = K.bookContent(C._canonFresh(JSON.parse(JSON.stringify(imp.sheets)), JSON.parse(JSON.stringify(imp.cells))));
  // the app's save also carries the untouched seed "Sheet1"; the
  // converter leaves it out, nothing else differs
  app.workbook.sheets = app.workbook.sheets.filter((s) => s.id !== "s-main");
  assert.equal(JSON.stringify(mine), JSON.stringify(app));
  // and canonSS keeps it as it is (a fixed point)
  const again = M.canonSS(Object.assign({ deleted: {} }, mine.workbook));
  assert.equal(JSON.stringify(K.bookContent(again)), JSON.stringify(mine));
});

test("opening the result in Spreadsheet adds the same sheets as opening the source", async () => {
  const { wb } = await convert(xlFile(sampleBook(), "xlsx", "a.xlsx"));
  const norm = M.normalizeState(K.bookWorkbook({ kind: K.BOOK_KIND, ver: 1, workbook: wb }));
  let n = 0;
  const imp = K.importBook(norm, { taken: ["Sheet1", "Φύλλο1"], uid: () => "n" + (n++), now: 5, pos: 1, mapRefs: FX.mapRefs, lang: "en" });
  assert.deepEqual(imp.sheets.map((s) => s.name), ["Τιμές", "Totals"]);
  assert.deepEqual(imp.renamed, {});
  assert.equal(imp.cells["n0|1|3"].v, "=B2*C2");
});

test(".ods and binary .xls keep the values and formulas", async () => {
  for (const [type, name] of [["ods", "b.ods"], ["biff8", "c.xls"]]) {
    const { wb } = await convert(xlFile(sampleBook(), type, name));
    // (an empty sheet may come back with a range "A1" and then rides
    // along empty, exactly as in the app)
    assert.deepEqual(wb.sheets.map((s) => s.name).slice(0, 2), ["Τιμές", "Totals"], name);
    const id = wb.sheets[0].id;
    assert.equal(wb.cells[id + "|2|0"].v, "Μολύβι", name);
    // SheetJS writes no formulas into BIFF8, so the .xls fixture holds
    // the cached results only (reading .xls formulas is SheetJS's)
    if (type === "ods") {
      assert.equal(wb.cells[id + "|1|3"].v, "=B2*C2", name);
      assert.equal(wb.cells[id + "|1|3"].cv, "3", name);
    } else assert.equal(wb.cells[id + "|1|3"].v, "3", name);
  }
});

test("a binary .xls no longer comes in as one cell of mojibake", () => {
  const buf = X.write(sampleBook(), { type: "array", bookType: "biff8" });
  const wb = SI.readWorkbook(X, buf);
  assert.deepEqual(wb.SheetNames.slice(0, 2), ["Τιμές", "Totals"]);
});

test(".csv: ';' separated windows-1253 Greek -> one sheet, Sheet2 like in the app", async () => {
  const text = "Όνομα;Ποσό\r\nΚαφές;2,5\r\n\"a;b\";=1+1\r\n";
  const bytes = new TextEncoder().encode(text);
  let { r, wb, bk } = await convert(file(bytes, "Έξοδα.csv"), { lang: "el" });
  assert.equal(r.name, "Έξοδα.orossheet");
  assert.equal(wb.sheets.length, 1);
  assert.deepEqual(wb.sheets[0].bi, { en: "Sheet2", el: "Φύλλο2" });
  assert.equal(wb.sheets[0].name, null);
  assert.equal(bk.meta.language, "el");
  const id = wb.sheets[0].id;
  assert.equal(wb.cells[id + "|0|0"].v, "Όνομα");
  assert.equal(wb.cells[id + "|1|1"].v, "2,5");
  assert.equal(wb.cells[id + "|2|0"].v, "a;b");
  assert.equal(wb.cells[id + "|2|1"].v, "=1+1");
  // the same text in Greek ANSI
  const map = { "Ό": 0xBC, "ν": 0xED, "ο": 0xEF, "μ": 0xEC, "α": 0xE1, "Π": 0xD0, "σ": 0xF3, "ό": 0xFC, "Κ": 0xCA, "φ": 0xF6, "έ": 0xDD, "ς": 0xF2 };
  const arr = [];
  for (const ch of text) arr.push(map[ch] !== undefined ? map[ch] : ch.charCodeAt(0));
  ({ wb } = await convert(file(Uint8Array.from(arr), "x.csv")));
  assert.equal(wb.cells[wb.sheets[0].id + "|1|0"].v, "Καφές");
});

test("errors: unsupported, bad, toobig", async () => {
  await assert.rejects(C.convert(file(new Uint8Array([1]), "a.docx")), (e) => e.code === "unsupported");
  await assert.rejects(C.convert(file(new Uint8Array([1]), "noext")), (e) => e.code === "unsupported");
  await assert.rejects(C.convert(file(new Uint8Array(0), "empty.csv")), (e) => e.code === "bad");
  await assert.rejects(C.convert(file(new Uint8Array([0x50, 0x4B, 3, 4, 9, 9, 9, 9, 9]), "broken.xlsx")), (e) => e.code === "bad");
  const big = { name: "huge.xlsx", size: C.maxBytes + 1, arrayBuffer: () => Promise.reject(new Error("must not read")) };
  await assert.rejects(C.convert(big), (e) => e.code === "toobig");
});

test("caps: a CSV over the column limit is cut with a warning", async () => {
  const line = Array.from({ length: 120 }, (_, i) => "c" + i).join(",");
  const { r, wb } = await convert(file(new TextEncoder().encode(line + "\n"), "wide.csv"), { lang: "en" });
  assert.equal(wb.sheets[0].cols, 104);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /10000 rows × 104 columns/);
});

test("progress runs from 0 up to 1", async () => {
  const seen = [];
  await C.convert(xlFile(sampleBook(), "xlsx", "p.xlsx"), { onProgress: (x) => seen.push(x) });
  assert.equal(seen[seen.length - 1], 1);
  assert.ok(seen.every((x, i) => i === 0 || x >= seen[i - 1]));
});
