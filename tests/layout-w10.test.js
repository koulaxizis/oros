// Layout W10 + N4 (LY-W10): imposition (booklet, sections, two up)
// with creep and marks (layout/impose.js), every page or spread as
// images in a .zip, the EAN-5 price code on a book cover; strings in
// EN/EL/DE and the wiring.
// Run: node --test tests/layout-w10.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const I = require(path.join(ROOT, "layout/impose.js"));
const CV = require(path.join(ROOT, "designkit/cover.js"));
const PDFLib = require(path.join(ROOT, "vendor/pdf-lib/pdf-lib.min.js"));

test("plan: a booklet folds in page order, blanks at the end, creep grows inwards", () => {
  const b = I.plan(8, "saddle", { creep: 1 });
  assert.equal(b.pages, 8);
  assert.deepEqual(b.sheets.map((s) => [s.front, s.back]), [[[7, 0], [1, 6]], [[5, 2], [3, 4]]]);
  assert.deepEqual(b.sheets.map((s) => s.creep), [0, 1]);
  // folding the stack reads 0..7
  const read = [];
  b.sheets.forEach((s) => { read.push(s.front[1], s.back[0]); });
  b.sheets.slice().reverse().forEach((s) => { read.push(s.back[1], s.front[0]); });
  assert.deepEqual(read, [0, 1, 2, 3, 4, 5, 6, 7]);
  const six = I.plan(6, "saddle");
  assert.equal(six.pages, 8);
  assert.deepEqual(six.sheets[0].front, [null, 0]);
  assert.deepEqual(six.sheets[0].back, [1, null]);
  assert.equal(I.plan(5, "saddle", { creep: 99 }).sheets[1].creep, 20, "creep is held to 20 pt");
});

test("plan: sections are booklets one after another; empty sheets are dropped", () => {
  const s = I.plan(18, "sig", { sig: 8 });
  assert.equal(s.sig, 8); assert.equal(s.pages, 24);
  assert.deepEqual(s.sheets[2].front, [15, 8], "the second section starts at page 8");
  assert.equal(s.sheets.length, 5, "the last section's empty inner sheet is not printed");
  assert.equal(I.plan(40, "sig", { sig: 5 }).sig, 16, "an unknown section size is 16");
  const two = I.plan(3, "twoUp");
  assert.deepEqual(two.sheets.map((x) => x.front), [[0, 1], [2, null]]);
  assert.equal(two.sheets[0].back, null);
});

async function book(n) {
  const d = await PDFLib.PDFDocument.create();
  for (let i = 0; i < n; i++) {
    const p = d.addPage([300, 420]);
    p.node.set(PDFLib.PDFName.of("TrimBox"), d.context.obj([9, 9, 291, 411]));
    p.node.set(PDFLib.PDFName.of("BleedBox"), d.context.obj([0, 0, 300, 420]));
    p.drawText("P" + (i + 1), { x: 100, y: 200, size: 40 });
  }
  return d.save();
}

test("make: sheets twice the trim plus bleed, boxes set, marks outside the bleed", async () => {
  const bytes = await book(6);
  const r = await I.make(PDFLib, bytes, I.plan(6, "saddle", { creep: 2 }), { marks: true });
  assert.equal(r.sheets, 2); assert.equal(r.sides, 4);
  assert.deepEqual(r.size, [2 * 282 + 18 + 48, 402 + 18 + 48]);
  const out = await PDFLib.PDFDocument.load(r.bytes);
  assert.equal(out.getPageCount(), 4);
  const N = PDFLib.PDFName.of, pg = out.getPages()[0];
  const box = (k) => pg.node.get(N(k)).asArray().map((x) => x.asNumber());
  assert.deepEqual(box("TrimBox"), [33, 33, 33 + 564, 33 + 402]);
  assert.deepEqual(box("BleedBox"), [24, 24, 24 + 582, 24 + 420]);
  const plain = await I.make(PDFLib, bytes, I.plan(6, "twoUp"), {});
  assert.deepEqual(plain.size, [2 * 282 + 18 + 18, 420], "two up keeps each page's bleed, no marks");
  assert.equal(plain.sides, 3);
});

test("EAN-5: the price code's parity and its place beside the ISBN", () => {
  // checksum 3×(5+4+5) + 9×(2+9) = 141 → 1 → G L G L L
  assert.equal(CV.ean5("52495"), "01011" + "0111001" + "01" + "0010011" + "01" + "0011101" + "01" + "0001011" + "01" + "0110001");
  assert.equal(CV.ean5("90000").length, 48);
  assert.equal(CV.ean5("9000"), null);
  assert.match(CV.addonPath("90000"), /^M0\.\d+ 0L/);
  const M = require(path.join(ROOT, "designkit/model.js"));
  const d12 = "978960000000", spec = { name: "C", w: 140, h: 210, pages: 200, title: "Λιμάνι" };
  spec.isbn = d12 + String((10 - [...d12].reduce((a, c, i) => a + (+c) * (i % 2 ? 3 : 1), 0) % 10) % 10);
  const plain = CV.build(spec, { now: 1 }), withAdd = CV.build(Object.assign({}, spec, { addon: "90000" }), { now: 1 });
  const paths = (d) => d.items.filter((it) => it.t === "path");
  assert.equal(paths(plain).length, 1); assert.equal(paths(withAdd).length, 2);
  // the add-on is the path drawn from addonPath (item order follows random ids)
  const a = paths(withAdd).find((it) => it.d === CV.addonPath("90000")), b = paths(withAdd).find((it) => it !== a);
  assert.ok(a && b);
  assert.ok(a.x > b.x + b.w, "the add-on is to the right of the ISBN bars");
  assert.ok(Math.abs((a.y + a.h) - (b.y + b.h)) < 0.01, "both end at the same line");
  const rect = (d) => d.items.find((it) => it.t === "rect" && it.fill === "sw-paper");
  assert.ok(Math.abs((rect(withAdd).x + rect(withAdd).w) - (rect(plain).x + rect(plain).w)) < 0.01, "the white box keeps its right edge and grows left");
  assert.ok(M.normDoc(withAdd).items.length === withAdd.items.length);
  assert.equal(paths(CV.build(Object.assign({}, spec, { addon: "12" }), { now: 1 })).length, 1, "a wrong code is left out");
});

test("wiring, strings EN/EL/DE, help", () => {
  const io = read("layout/io.js"), pn = read("layout/panels.js");
  assert.match(io, /script\("impose\.js", "LY_IMPOSE"\)/);
  assert.match(io, /Object\.assign\(\{\}, opts, \{ marks: false, creep: 0, spreads: false \}\)/, "marks and creep go on the sheets, not the pages");
  assert.match(io, /function exportImages\(doc, opts\)/);
  assert.match(pn, /impose: impOf\(expPrefs\.imp\)/);
  assert.match(pn, /pgOpts\.push\(\["\*", t\("imp\.allPages"\)\]\)/);
  assert.match(read("sw.js"), /"layout\/impose\.js"/);
  assert.match(read("layout/cover.js"), /txt\("cov\.f\.addon", "addon", 5\)/);
  const L = read("layout/layout.js"), DE = read("i18n/de/layout.js");
  for (const k of ["imp.title", "imp.none", "imp.saddle", "imp.sig", "imp.twoUp", "imp.hint", "imp.file.saddle", "imp.file.sig", "imp.file.twoUp", "imp.allPages", "imp.allSpreads", "imp.pageN", "imp.spreadN", "imp.pages", "imp.spreads", "cov.f.addon", "cov.badAddon"]) {
    const re = new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g");
    assert.equal((L.match(re) || []).length, 2, k);
    assert.equal((DE.match(re) || []).length, 1, k);
  }
  assert.match(read("layout/help.en.txt"), /## Imposition and images\n/);
  assert.match(read("layout/help.el.txt"), /## Μοντάζ και εικόνες\n/);
  assert.match(read("i18n/de/help/layout.txt"), /## Ausschießen und Bilder\n/);
});
