// LY-PORT-G (2026-11-20): an original picture in colour that the PDF
// prints grey (an Affinity adjustment, the printer's file) comes in grey.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const RB = require(path.join(ROOT, "layout/rebuild.js"));

const px = (list) => { const d = new Uint8ClampedArray(list.length * 4); list.forEach((c, i) => { d.set([c[0], c[1], c[2], 255], i * 4); }); return d; };

test("grayPixels(): grey with JPEG noise is grey, a little colour is not", () => {
  const grey = Array.from({ length: 1000 }, (_, i) => [i % 256, (i % 256) + 3, Math.max(0, (i % 256) - 2)]);
  assert.equal(RB.grayPixels(px(grey), 1000), true);
  const some = grey.map((c, i) => (i % 50 === 0 ? [200, 40, 40] : c));   // 2 % red
  assert.equal(RB.grayPixels(px(some), 1000), false);
  assert.equal(RB.grayPixels(px([]), 0), false);
});

test("rebuild: a matched original is made grey only when the PDF's picture is grey, and the report says so", () => {
  const s = fs.readFileSync(path.join(ROOT, "layout/rebuild.js"), "utf8");
  assert.match(s, /var blobP = orig \? \(isGray\(cv\) \? grayOriginal\(orig\.file\) : Promise\.resolve\(orig\.file\)\)/);
  assert.match(s, /gray: !!orig && blob !== orig\.file/);
  assert.match(s, /if \(im\.gray\) report\.gray\+\+;/);
  // a grey original, or one that cannot be read, stays its own file
  assert.match(s, /if \(grayPixels\(d, w \* h\)\) return file;/);
  assert.match(s, /\.then\(null, function \(\) \{ return file; \}\);/);
  const io = fs.readFileSync(path.join(ROOT, "layout/io.js"), "utf8");
  assert.match(io, /if \(rep\.gray\) p\(t\("rb\.gray", \{ n: rep\.gray \}\), "hint"\);/);
  const L = fs.readFileSync(path.join(ROOT, "layout/layout.js"), "utf8");
  assert.equal((L.match(/"rb\.gray":/g) || []).length, 2);
  assert.match(fs.readFileSync(path.join(ROOT, "i18n/de/layout.js"), "utf8"), /"rb\.gray":/);
});
