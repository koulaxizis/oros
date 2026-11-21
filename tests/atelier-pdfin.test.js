// orOS Atelier — a PDF as an editable design (atelier/pdfin.js, wave
// PS-3): Layout's PDF reader (layout/pdfin.js) builds a Layout document,
// toDesign turns it into Atelier element specs. Node: made-up pages
// through the pure part; the PDF.js run is shared with Layout.
// Run: node --test tests/atelier-pdfin.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const LP = require(path.join(ROOT, "layout/pdfin.js"));
const AX = require(path.join(ROOT, "atelier/ax.js"));
const P = require(path.join(ROOT, "atelier/pdfin.js"));

T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

const piece = (s, x, y, size, o) => Object.assign({ s, x, y, w: T.measure("sans-r", s, size), size, rot: 0, fam: "sans", b: 0, i: 0 }, o || {});
const ASSET = "b".repeat(64) + ".jpg", PIC = "c".repeat(64) + ".png";

// a 1080 × 1080 px Canva post comes as 810 × 810 pt
function canvaPost() {
  const blocks = LP.toBlocks(LP.toLines([
    piece("Big title", 60, 120, 48, { fam: "serif", color: [200, 20, 20] }),
    piece("Body with ", 60, 300, 20), piece("bold", 60 + T.measure("sans-r", "Body with ", 20), 300, 20, { b: 1 }), piece(" words.", 60 + T.measure("sans-r", "Body with bold", 20), 300, 20),
    piece("All italic", 60, 500, 16, { i: 1 })
  ]));
  return LP.buildDoc([
    { w: 810, h: 810, blocks, bg: { a: ASSET, iw: 1688, ih: 1688 }, shapes: [{ t: "img", a: PIC, iw: 400, ih: 300, x: 400, y: 400, w: 300, h: 225, rot: 0, fit: "fill", sw: 0, nm: "pdf-1-1.png" }] },
    { w: 810, h: 810, blocks: [], bg: null, shapes: [] }
  ], { now: 5, name: "Canva post" }).doc;
}

test("pdf design: paper sizes are known either way up, screen sizes are not", () => {
  assert.equal(P.paper(595.28, 841.89), true);            // A4
  assert.equal(P.paper(841.89, 595.28), true);            // A4 landscape
  assert.equal(P.paper(612, 792), true);                  // Letter
  assert.equal(P.paper(419.5, 595.3), true);              // A5, rounded
  assert.equal(P.paper(810, 810), false);                 // 1080 px post
  assert.equal(P.paper(1440, 810), false);                // 1920 × 1080 slide
  assert.equal(P.paper(450, 800), false);                 // 600 × 1067 story
});

test("pdf design: a Canva post is 1080 px again, with text, picture and the drawing behind", () => {
  const plan = P.toDesign(canvaPost());
  assert.deepEqual(plan.setup, { w: 1080, h: 1080, unit: "px" });
  assert.equal(plan.scaled, true);
  assert.equal(plan.pages.length, 2);
  assert.deepEqual(plan.pages[1], []);
  const specs = plan.pages[0];
  // back to front: locked drawing, picture, then the texts
  assert.equal(specs[0].k, "photo");
  assert.deepEqual([specs[0].a, specs[0].x, specs[0].y, specs[0].w, specs[0].h, specs[0].lock], [ASSET, 0, 0, 1080, 1080, 1]);
  const pic = specs.find((s) => s.a === PIC);
  assert.deepEqual([pic.x, pic.y, pic.w, pic.h, pic.lock, pic.iw], [533.3, 533.3, 400, 300, 0, 400]);
  const texts = specs.filter((s) => s.k === "text");
  assert.equal(texts.length, 3);
  assert.ok(specs.indexOf(texts[0]) > specs.indexOf(pic), "texts above the pictures");
  const title = texts.find((s) => s.tx === "Big title");
  assert.deepEqual([title.font, title.size, title.fc, title.b, title.i, title.ext.kern], ["serif", 64, "#c81414", 0, 0, 1]);
  // mixed looks are runs over the text; one look throughout is on the element
  const body = texts.find((s) => s.tx.startsWith("Body"));
  assert.equal(body.tx, "Body with bold words.");
  assert.deepEqual(body.ext.runs, [{ n: 10, b: 0 }, { n: 4, b: 1 }, { n: 7, b: 0 }]);
  const it = texts.find((s) => s.tx === "All italic");
  assert.deepEqual([it.i, it.ext.runs], [1, undefined]);
  // z goes up in order
  specs.forEach((s, i) => assert.equal(s.z, i + 1));
});

test("pdf design: the specs make a valid Atelier design", () => {
  const plan = P.toDesign(canvaPost());
  const d = AX.newDesign({ name: "Canva post", w: plan.setup.w, h: plan.setup.h, unit: plan.setup.unit, pages: plan.pages.length }, 9);
  const pages = M.pagesInOrder(d);
  let made = 0;
  plan.pages.forEach((specs, i) => specs.forEach((sp) => { if (AX.addItem(d, pages[i].id, sp, 9)) made++; }));
  assert.equal(made, 5);
  const n = M.normDoc(d);
  assert.deepEqual([n.setup.w, n.setup.h], [1080, 1080]);
  const body = n.items.find((i) => i.ax && i.ax.tx === "Body with bold words.");
  assert.ok(body, "the body text survives normDoc");
  assert.equal(body.ext.kern, 1);
  assert.equal(body.ext.runs.length, 3);
  assert.equal(n.items.filter((i) => i.ax && i.ax.k === "photo").length, 2);
  assert.equal(n.items.find((i) => i.a === ASSET).lock, 1);
  assert.equal(JSON.stringify(M.normDoc(n)), JSON.stringify(n));
});

test("pdf design: a paper PDF keeps its size in mm and is not scaled", () => {
  const blocks = LP.toBlocks(LP.toLines([piece("Flyer", 72, 100, 24)]));
  const ld = LP.buildDoc([{ w: 595.28, h: 841.89, blocks, bg: null, shapes: [] }], { now: 3 }).doc;
  const plan = P.toDesign(ld);
  assert.deepEqual(plan.setup, { w: 595.28, h: 841.89, unit: "mm" });
  assert.equal(plan.scaled, false);
  const tx = plan.pages[0].find((s) => s.k === "text");
  assert.equal(tx.size, 24);
});

test("pdf design: nothing to make is null", () => {
  assert.equal(P.toDesign(null), null);
  assert.equal(P.toDesign({ pages: [] }), null);
});

test("pdf design: wired into Atelier's import and shipped offline", () => {
  const io = fs.readFileSync(path.join(ROOT, "atelier/io.js"), "utf8");
  assert.match(io, /loadScript\("\.\.\/layout\/pdfin\.js"\)/);
  assert.match(io, /loadScript\("pdfin\.js"\)/);
  assert.match(io, /isPdf\(f\) \? importPdfFile/);
  assert.match(io, /\.pdf,application\/pdf/);
  const core = fs.readFileSync(path.join(ROOT, "atelier/core.js"), "utf8");
  const de = fs.readFileSync(path.join(ROOT, "i18n/de/atelier.js"), "utf8");
  ["imp.pdfDone", "imp.pdfCut", "imp.pdfFail"].forEach((k) => {
    assert.equal(core.split('"' + k + '"').length - 1, 2, k + " in EN and EL");
    assert.ok(de.includes('"' + k + '"'), k + " in DE");
  });
});
