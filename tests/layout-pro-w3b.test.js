// Layout pro (LY-PRO wave W3b, Chris's spec v2 item 4): a page's own
// trim size (fold-outs, smaller inserts) that the PDF, the pictures,
// the editor and the read-back follow; creep for saddle-stitched books
// in the print PDF; the command and the UI.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "designkit/model.js"));
const PRO = require(path.join(ROOT, "layout/pro.js"));
const CMD = require(path.join(ROOT, "layout/commands.js"));
const C = require(path.join(ROOT, "assistant/core.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const MM = 72 / 25.4;

let IDN = 0;
function idf() { const k = (++IDN).toString(36); let n = 0; return (p) => p + "-b" + k + "x" + (++n); }
function steps(list) { const c = CMD.check(list); assert.ok(c.ok, c.err); return c.steps; }
function run(d, list) { return steps(list).reduce((n, st) => n + CMD.apply(d, st, { now: 50, idf: idf() }), 0); }
function book(n) { return PRO.makeDoc(steps([{ op: "create", title: "Βιβλίο", w: 180, h: 250, n: n || 8 }])[0], 10); }

test("pageSize: own size, else the document's; nonsense ignored", () => {
  const d = book(4), p = M.pagesInOrder(d)[1];
  assert.deepEqual(M.pageSize(d, p), { w: d.setup.w, h: d.setup.h, own: 0 });
  p.ext = { sz: { w: 1000, h: 700 } };
  assert.deepEqual(M.pageSize(d, p), { w: 1000, h: 700, own: 1 });
  p.ext = { sz: { w: 5, h: "x" } };
  assert.equal(M.pageSize(d, p).own, 0);
  assert.equal(M.pageSize(d, null).w, d.setup.w);
});

test("pagesize command: by range, back to the document's, outline shows it", () => {
  const d = book(8);
  assert.equal(run(d, [{ op: "pagesize", pages: "3-4", w: 360, h: 250 }]), 2);
  const o = M.pagesInOrder(d);
  assert.ok(Math.abs(M.pageSize(d, o[2]).w - 360 * MM) < 0.01);
  assert.equal(M.pageSize(d, o[0]).own, 0);
  assert.equal(run(d, [{ op: "pagesize", pages: "3-4", w: 360, h: 250 }]), 0, "nothing differs");
  const out = CMD.outline(d, null, {});
  assert.deepEqual(out.page_list[2].trim_mm, { w: 360, h: 250 });
  assert.ok(!out.page_list[0].trim_mm);
  assert.equal(run(d, [{ op: "pagesize", pages: "3", w: 0, h: 0 }]), 1);
  assert.ok(!o[2].ext, "the document's size again: ext goes");
  assert.equal(run(d, [{ op: "pagesize", pages: "4", w: 180, h: 250 }]), 1, "the document's own size = none");
  assert.ok(!o[3].ext);
  assert.equal(run(d, [{ op: "pagesize", pages: "1", w: 5, h: 250 }]), 0, "too small: refused");
  assert.match(CMD.GUIDE, /\bpagesize:/);
  assert.ok(CMD.ORDER.indexOf("pagesize") > 0);
});

test("pictures and the bleed check follow the page's size", () => {
  const d = book(4), p = M.pagesInOrder(d)[1];
  p.ext = { sz: { w: 1000, h: 700 } };
  const f = PRO.frameFor(d, "L", "trim", p);
  assert.deepEqual([f.w, f.h], [1000, 700]);
  assert.equal(PRO.frameFor(d, "L", "trim", M.pagesInOrder(d)[0]).w, d.setup.w);
});

test("creep: 0 on the outer sheet, the most in the middle, towards the spine", () => {
  const d = book(16);
  const c = (i) => M.creepOf(d, i, 16, 1);
  assert.equal(c(0), 0);
  assert.equal(c(15), 0);
  assert.equal(Math.abs(c(7)), 1);
  assert.equal(Math.abs(c(8)), 1);
  assert.ok(Math.abs(c(4)) > 0 && Math.abs(c(4)) < 1);
  // right pages move left (−), left pages move right (+)
  assert.equal(M.sideOf(d, 7), "L"); assert.ok(c(7) > 0);
  assert.equal(M.sideOf(d, 8), "R"); assert.ok(c(8) < 0);
  assert.equal(M.creepOf(d, 3, 4, 1), 0, "under 8 pages: none");
  assert.equal(M.creepOf(d, 7, 16, 0), 0);
});

test("export_pdf creep: checked, carried to Layout, the PDF uses it", () => {
  assert.equal(C.normPdf({ document: "Β", creep: 0.5 }).creep, 0.5);
  assert.equal(C.normPdf({ document: "Β" }).creep, 0);
  assert.equal(C.normPdf({ document: "Β", creep: 9 }).ok, false);
  assert.match(read("layout/pdfout.js"), /creep: print && q\.creep \? q\.creep \* 72 \/ 25\.4 : 0/);
  assert.match(read("designkit/pdf.js"), /M\.creepOf\(doc, idx, all\.length, opts\.creep\)/);
  assert.match(read("assistant/assistant.js"), /creep: Number\(ui\.creep\) \|\| 0/);
});

test("the UI: page size dialog, creep field, words", () => {
  const p = read("layout/panels.js"), l = read("layout/layout.js"), de = read("i18n/de/layout.js");
  assert.match(p, /function pageSizeDlg\(pgId\)/);
  assert.match(p, /t\("exp\.creep"\)/);
  ["pages.size", "pages.sizeOwn", "pages.sizeTitle", "pages.sizePages", "pages.sizeDoc", "pages.sizeBad", "exp.creep"].forEach((k) => {
    assert.equal(l.split('"' + k + '":').length - 1, 2, k + " in EN and EL");
    assert.ok(de.indexOf('"' + k + '":') > 0, k + " in DE");
  });
  assert.match(read("assistant/assistant.js"), /"ed\.op\.pagesize": "Page size"/);
  assert.match(read("layout/editor.js"), /M\.pageSize\(/);
});
