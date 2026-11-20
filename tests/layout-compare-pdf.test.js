// LY-PORT-D (2026-11-20): More › Compare with a PDF: each page of the
// document next to the PDF's, cut to the trim, the share of pixels that
// differ (softened by a pixel), the pages that differ most first.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const RB = require(path.join(ROOT, "layout/rebuild.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const rgba = (n, c) => { const d = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) d.set([c[0], c[1], c[2], 255], i * 4); return d; };

test("diffPixels(): a channel more than 48 apart counts, less does not", () => {
  const a = rgba(100, [255, 255, 255]), b = rgba(100, [255, 255, 255]);
  assert.equal(RB.diffPixels(a, b, 100).pct, 0);
  for (let i = 0; i < 10; i++) b.set([200, 255, 255, 255], i * 4);   // 55 apart
  for (let i = 10; i < 30; i++) b.set([220, 255, 255, 255], i * 4);  // 35 apart
  const r = RB.diffPixels(a, b, 100);
  assert.equal(r.pct, 10);
  assert.equal(r.mask[0], 1); assert.equal(r.mask[15], 0);
  assert.equal(RB.DIFF_AT, 48);
});

test("compare(): TrimBox cut, softened by a pixel, a red mask; the dialog in More, strings EN/EL/DE", () => {
  const rb = read("layout/rebuild.js");
  assert.match(rb, /var DIFF_AT = 48, SOFT = 1;/);
  assert.match(rb, /x\.filter = "blur\(" \+ SOFT \+ "px\)"/);
  assert.match(rb, /var tr = bx \? \{ x: bx\.trim\[0\] - view\[0\], y: view\[3\] - \(bx\.trim\[1\] \+ bx\.trim\[3\]\), w: bx\.trim\[2\], h: bx\.trim\[3\] \}/);
  const pn = read("layout/panels.js");
  assert.match(pn, /\{ label: t\("more\.compare"\), fn: compareDlg \},/);
  assert.match(pn, /preflight: preflightDlg, compare: compareDlg \};/);
  assert.match(pn, /var over = pages\.filter\(function \(p\) \{ return p\.pct > 2; \}\);/);
  assert.match(pn, /c\.setAttribute\("aria-label", t\(\["cmp\.theirs", "cmp\.ours", "cmp\.diff"\]\[j\]\)\);/);
  assert.match(read("layout/layout.css"), /\.cmp-pic \{ flex: 1 1 0; min-width: 0; max-width: 33%;/);
  const L = read("layout/layout.js"), DE = read("i18n/de/layout.js");
  for (const k of ["more.compare", "cmp.title", "cmp.working", "cmp.fail", "cmp.sum", "cmp.count", "cmp.over", "cmp.over1", "cmp.allOk", "cmp.hint", "cmp.theirs", "cmp.ours", "cmp.diff"]) {
    assert.equal((L.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k);
    assert.match(DE, new RegExp('"' + k.replace(".", "\\.") + '":'), k);
  }
});
