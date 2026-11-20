// LY-PORT-O (2026-11-20): a cover whose text came as shapes (InDesign)
// is read with OCR into text frames where the text is, hidden by
// default so the page keeps its look.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const RB = require(path.join(ROOT, "layout/rebuild.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("ocrFrames(): one frame per paragraph, lines in order, size from the line height", () => {
  const box = { x: 10, y: 20, w: 400, h: 600 };
  const words = [
    { t: "ΣΑΚΕΛΛΑΡΗΣ", x: 0.1, y: 0.1, w: 0.5, h: 0.03, ln: 0, pa: 0 },
    { t: "ΚΑΜΠΟΥΡΗΣ", x: 0.62, y: 0.1, w: 0.3, h: 0.03, ln: 0, pa: 0 },
    { t: "Ο", x: 0.2, y: 0.3, w: 0.05, h: 0.08, ln: 1, pa: 1 },
    { t: "ψίθυρος", x: 0.27, y: 0.3, w: 0.4, h: 0.08, ln: 1, pa: 1 },
    { t: "μυθιστόρημα", x: 0.3, y: 0.45, w: 0.4, h: 0.08, ln: 2, pa: 1 },
    { t: " ", x: 0, y: 0, w: 0, h: 0, ln: 3, pa: 2 }
  ];
  const f = RB.ocrFrames(words, box);
  assert.equal(f.length, 2);
  assert.deepEqual(f[0].lines, ["ΣΑΚΕΛΛΑΡΗΣ ΚΑΜΠΟΥΡΗΣ"]);
  assert.deepEqual(f[1].lines, ["Ο ψίθυρος", "μυθιστόρημα"]);
  assert.ok(Math.abs(f[0].size - 18 / 0.95) < 0.2, "size " + f[0].size);
  assert.ok(f[0].x < 10 + 40 && f[0].x > 10 + 30);
  assert.ok(f[0].y < 20 + 60 && f[0].y > 20 + 50);
  assert.equal(f[1].lead, 90, "two lines 90 pt apart");
  assert.ok(f[1].w >= 0.5 * 400);
});

test("rebuild: pages without text but with drawings are offered OCR; the picture's menu has it too", () => {
  const rb = read("layout/rebuild.js");
  assert.match(rb, /if \(!\(P\.spans \|\| \[\]\)\.some\(function \(sp\) \{ return sp\.t && sp\.t\.trim\(\); \}\)\) report\.drawn\.push\(\{ page: pi \+ 1, id: bgIt\.id \}\);/);
  const io = read("layout/io.js");
  assert.match(io, /b\.addEventListener\("click", function \(\) \{ close\(\); ED\.gotoItem && ED\.gotoItem\(d\.id\); ocrPicture\(d\.id\); \}\);/);
  // the engine downloads only on a yes; recognised text reaches the page only as textContent
  assert.match(io, /if \(K\.allowed\(\)\) return go\(K\);/);
  assert.match(io, /yes\.addEventListener\("click", function \(\) \{ K\.allow\(\); close\(\); go\(K\); \}\);/);
  assert.match(io, /pre\.textContent = text\.slice\(0, 20000\);/);
  assert.match(io, /hide: hide \? 1 : 0 \}\);/);
  assert.match(read("layout/editor.js"), /items\[0\]\.t === "img" && items\[0\]\.a\) list\.push\(\{ label: t\("ocr\.menu"\), fn: function \(\) \{ LY\.io\.ocrPicture\(items\[0\]\.id\); \} \}\);/);
  const L = read("layout/layout.js"), DE = read("i18n/de/layout.js");
  for (const k of ["ocr.menu", "ocr.title", "ocr.ask", "ocr.place", "ocr.hidden", "rb.drawn", "rb.ocrPage"]) {
    assert.equal((L.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k);
    assert.match(DE, new RegExp('"' + k.replace(".", "\\.") + '":'), k);
  }
});

test("ocrFrames(): the stray marks a photo's edges read as are dropped, one-letter words kept", () => {
  const w = (t, x) => ({ t, x, y: 0.1, w: 0.02, h: 0.02, ln: 0, pa: 0 });
  const f = RB.ocrFrames([w("Από", 0.1), w("§", 0.2), w("ζ", 0.25), w("η", 0.3), w("Κω", 0.35), w("/", 0.4), w("™", 0.45)], { x: 0, y: 0, w: 100, h: 100 });
  assert.deepEqual(f[0].lines, ["Από η Κω"]);
  assert.deepEqual(RB.ocrFrames([w("/", 0.1), w("™", 0.2)], { x: 0, y: 0, w: 100, h: 100 }), []);
});
