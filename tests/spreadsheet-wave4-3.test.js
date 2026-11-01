// Spreadsheet wave 4.3: print / PDF page plan (spreadsheet/sheetkit.js
// normPrint, printPages, fitText, pageLabel) and the print dialog's
// strings in EN / EL / DE. The drawing itself (jsPDF) runs in the
// browser only and is checked in the real shell.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const KIT = require(path.join(__dirname, "..", "spreadsheet/sheetkit.js"));

test("normPrint: defaults and clamps", () => {
  assert.deepEqual(KIT.normPrint({}), { pa: "a4", or: "p", fit: "w", gl: 1, pn: 1, ch: 1, hr: 0, sel: 0 });
  assert.deepEqual(KIT.normPrint({ pa: "letter", or: "l", fit: "p", gl: 0, pn: 0, ch: 0, hr: 3, sel: 1 }),
    { pa: "letter", or: "l", fit: "p", gl: 0, pn: 0, ch: 0, hr: 3, sel: 1 });
  const bad = KIT.normPrint({ pa: "b5", or: "x", fit: "zoom", hr: 999, sel: "1" });
  assert.equal(bad.pa, "a4"); assert.equal(bad.or, "p"); assert.equal(bad.fit, "w");
  assert.equal(bad.hr, 50); assert.equal(bad.sel, 0);
  assert.equal(KIT.normPrint({ hr: -2 }).hr, 0);
  assert.equal(KIT.normPrint(null).pa, "a4");
});

test("printPages: actual size runs down, then over", () => {
  const P = KIT.printPages({ pa: "a4", or: "p", fit: "n", colW: Array(20).fill(66), rowH: Array(100).fill(21), headH: [] });
  assert.equal(P.scale, 1);
  assert.equal(P.w, 595.28); assert.equal(P.h, 841.89);
  /* 523.28 pt wide: 7 columns of 66 pt; 769.89 pt high: 36 rows of 21 pt */
  assert.deepEqual(P.pages[0], { c: [0, 6], r: [0, 35] });
  assert.deepEqual(P.pages[1], { c: [0, 6], r: [36, 71] });
  assert.deepEqual(P.pages[3], { c: [7, 13], r: [0, 35] });
  assert.equal(P.pages.length, 9);
  for (const pg of P.pages) {
    let w = 0; for (let i = pg.c[0]; i <= pg.c[1]; i++) w += 66;
    let h = 0; for (let i = pg.r[0]; i <= pg.r[1]; i++) h += 21;
    assert.ok(w <= P.uw + 0.01 && h <= P.uh + 0.01);
  }
});

test("printPages: landscape swaps the paper", () => {
  const P = KIT.printPages({ pa: "a4", or: "l", fit: "n", colW: [66], rowH: [21], headH: [] });
  assert.equal(P.w, 841.89); assert.equal(P.h, 595.28);
  assert.equal(P.pages.length, 1);
});

test("printPages: fit to width scales down, never up", () => {
  const wide = KIT.printPages({ pa: "a4", or: "p", fit: "w", colW: Array(20).fill(66), rowH: Array(100).fill(21), headH: [] });
  assert.ok(Math.abs(wide.scale - 523.28 / 1320) < 1e-9);
  assert.ok(wide.pages.every((p) => p.c[0] === 0 && p.c[1] === 19));
  const narrow = KIT.printPages({ pa: "a4", or: "p", fit: "w", colW: [66, 66], rowH: [21], headH: [] });
  assert.equal(narrow.scale, 1);
});

test("printPages: fit on one page", () => {
  const P = KIT.printPages({ pa: "a4", or: "p", fit: "p", colW: Array(10).fill(66), rowH: Array(300).fill(21), headH: [21] });
  assert.equal(P.pages.length, 1);
  assert.deepEqual(P.pages[0], { c: [0, 9], r: [0, 299] });
  assert.ok(P.scale < 1);
});

test("printPages: repeated heading rows take room on every page", () => {
  const a = KIT.printPages({ pa: "a4", or: "p", fit: "n", colW: [66], rowH: Array(72).fill(21), headH: [] });
  const b = KIT.printPages({ pa: "a4", or: "p", fit: "n", colW: [66], rowH: Array(72).fill(21), headH: [21, 21] });
  assert.deepEqual(a.pages[0].r, [0, 35]);
  assert.deepEqual(b.pages[0].r, [0, 33]);         /* two rows fewer under the headings */
  assert.equal(b.pages.length, 3);
});

test("printPages: footer room, oversize columns and rows, headings only", () => {
  const f = KIT.printPages({ pa: "a4", or: "p", fit: "n", colW: [66], rowH: Array(40).fill(21), headH: [], foot: 18 });
  assert.deepEqual(f.pages[0].r, [0, 34]);           /* 751.89 pt: 35 whole rows, one fewer */
  const g = KIT.printPages({ pa: "a4", or: "p", fit: "n", colW: [66], rowH: Array(40).fill(21), headH: [], foot: 60 });
  assert.deepEqual(g.pages[0].r, [0, 32]);            /* 709.89 pt: 33 rows */
  /* a column wider than the page gets a page of its own */
  const w = KIT.printPages({ pa: "a4", or: "p", fit: "n", colW: [66, 900, 66], rowH: [21], headH: [] });
  assert.deepEqual(w.pages.map((p) => p.c), [[0, 0], [1, 1], [2, 2]]);
  /* a row taller than the page too */
  const h = KIT.printPages({ pa: "a4", or: "p", fit: "n", colW: [66], rowH: [21, 2000, 21], headH: [] });
  assert.deepEqual(h.pages.map((p) => p.r), [[0, 0], [1, 1], [2, 2]]);
  /* only heading rows (no body): one page per column band */
  const o = KIT.printPages({ pa: "a4", or: "p", fit: "n", colW: [66], rowH: [], headH: [21] });
  assert.deepEqual(o.pages, [{ c: [0, 0], r: null }]);
  /* headings taller than the page still let the body move on */
  const t = KIT.printPages({ pa: "a4", or: "p", fit: "n", colW: [66], rowH: Array(10).fill(21), headH: [900] });
  assert.ok(t.pages.length >= 1 && t.pages.length <= 10);
});

test("fitText cuts with an ellipsis, never wider than asked", () => {
  const m = (s) => s.length * 5;
  assert.equal(KIT.fitText("short", 100, m), "short");
  const cut = KIT.fitText("Φεβρουάριος", 30, m);
  assert.equal(cut, "Φεβρο…");
  assert.ok(m(cut) <= 30);
  assert.equal(KIT.fitText("abc", 2, m), "");
});

test("pageLabel fills the language's pattern", () => {
  assert.equal(KIT.pageLabel("Page {n} of {t}", 2, 5), "Page 2 of 5");
  assert.equal(KIT.pageLabel("Σελίδα {n} από {t}", 1, 3), "Σελίδα 1 από 3");
});

test("every print string is there in EN, EL and DE", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "spreadsheet/spreadsheet.js"), "utf8");
  const de = fs.readFileSync(path.join(__dirname, "..", "i18n/de/spreadsheet.js"), "utf8");
  const used = new Set((src.match(/t\("pr\.[a-z.0-9]+"\)/g) || []).map((x) => x.slice(3, -2)));
  used.add("pr.hr.1"); used.add("pr.hr.n");                     /* picked by a ternary */
  assert.ok(used.size >= 20);
  const en = src.slice(src.indexOf("var STR"), src.indexOf("\n  el:"));
  const el = src.slice(src.indexOf("\n  el:"));
  for (const k of used) {
    assert.ok(en.includes('"' + k + '":'), "EN " + k);
    assert.ok(el.includes('"' + k + '":'), "EL " + k);
    assert.ok(de.includes('"' + k + '":'), "DE " + k);
  }
});

test("print settings stay on the device, the workbook format is untouched", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "spreadsheet/spreadsheet.js"), "utf8");
  assert.match(src, /var PR_KEY = "oros-spreadsheet-print";/);
  const canon = src.slice(src.indexOf("function canonSS"), src.indexOf("function mergeState"));
  assert.doesNotMatch(canon, /print|PR_KEY/);
  /* the fonts and jsPDF come from the precached vendor files, never a CDN */
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  for (const f of ["vendor/jspdf.umd.min.js", "vendor/noto/NotoSans-Regular.ttf", "vendor/noto/NotoSans-Bold.ttf",
    "vendor/noto/NotoSans-Italic.ttf", "vendor/noto/NotoSans-BoldItalic.ttf"]) assert.ok(sw.includes('"' + f + '"'), f);
  assert.doesNotMatch(src.slice(src.indexOf("SECTION 3j"), src.indexOf("SECTION 4: SYNC")), /https?:\/\//);
});
