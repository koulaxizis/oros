// Atelier: save a design as PowerPoint (.pptx) for Canva, PowerPoint,
// LibreOffice. Builds a design, writes it with atelier/pptxout.js, and
// reads it back with Atelier's own .pptx import (atelier/pptx.js): text
// stays text, shapes stay shapes, photos keep their crop, lines their
// heads, the background its colour; icons and filtered photos go out
// as pictures; every part is well-formed XML.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const Z = require("../atelier/zip.js");
const P = require("../atelier/pptx.js");
const O = require("../atelier/pptxout.js");
const AX = require("../atelier/ax.js");
const M = require("../designkit/model.js");

// a tiny valid PNG (1×1) and a fake asset name
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const IMG = "a".repeat(64) + ".png";

function design() {
  const d = AX.newDesign({ name: "Αφίσα <1>", w: 1080, h: 1350, unit: "px", bg: "#112233", pages: 2 }, 1000);
  const [p1, p2] = M.pagesInOrder(d);
  AX.addItem(d, p1.id, { k: "text", tx: "Γεια σου & <κόσμε>\nδεύτερη", font: "serif", size: 64, b: 1, al: "c", lh: 150, tr: 50, fc: "#ff0000", x: 100, y: 120, w: 800, rot: 10, tfx: { type: "shadow" } }, 1000);
  AX.addItem(d, p1.id, { k: "shape", shp: "rounded", rd: 40, fc: "#00ff00", sc: "#0000ff", sw: 4, x: 50, y: 400, w: 300, h: 200, op: 50 }, 1000);
  AX.addItem(d, p1.id, { k: "shape", shp: "star", g: { a: "#ff0000", b: "#0000ff", ang: 180 }, x: 400, y: 400, w: 200, h: 200 }, 1000);
  AX.addItem(d, p1.id, { k: "line", sc: "#123456", sw: 6, as: "dot", ae: "arrow", x: 900, y: 900, w: -300, h: 100 }, 1000);
  AX.addItem(d, p1.id, { k: "photo", a: IMG, iw: 400, ih: 200, fit: "fill", shp: "circle", flh: 1, x: 100, y: 700, w: 200, h: 200 }, 1000);
  AX.addItem(d, p1.id, { k: "icon", ico: "heart", sc: "#000000", x: 700, y: 700, w: 100, h: 100 }, 1000);
  AX.addItem(d, p2.id, { k: "photo", a: IMG, iw: 400, ih: 200, fit: "fill", flt: "mono", x: 0, y: 0, w: 100, h: 100 }, 1000);
  AX.addItem(d, p2.id, { k: "text", tx: "  ", x: 0, y: 0, w: 100 }, 1000);       // empty: left out
  return d;
}

test("needs: the images to read and the elements to draw as pictures", () => {
  const d = design();
  const n = O.needs(d);
  assert.deepEqual(n.assets, [IMG]);
  const kinds = n.raster.map((id) => d.items.find((it) => it.id === id).ax.k);
  assert.deepEqual(kinds.sort(), ["icon", "photo"]);
  assert.equal(O.kindOf({ ax: { k: "text", tx: "x", cv: 30 } }), "raster");
  assert.equal(O.kindOf({ ax: { k: "text", tx: "x", tfx: { type: "neon" } } }), "raster");
  assert.equal(O.kindOf({ hide: 1, ax: { k: "text", tx: "x" } }), "");
});

async function roundTrip(d, media) {
  const r = O.build(d, media);
  const zip = Z.open(r.bytes);
  return { r, zip, plan: await P.parse(zip, "back") };
}

test("round trip through Atelier's own .pptx import", async () => {
  const d = design(), n = O.needs(d), media = { ["a:" + IMG]: PNG };
  n.raster.forEach((id) => { media["r:" + id] = { png: PNG, pad: 4 }; });
  const { r, plan } = await roundTrip(d, media);
  assert.deepEqual(r.out, { native: 7, raster: 2, missing: 0 });
  // a screen design goes out at Canva's 0.75 pt per px (CV-0): the
  // slide reads back in points as 3/4 of the design's pixels
  const S = 3 / 4;
  assert.equal(plan.w, 1080 * S); assert.equal(plan.h, 1350 * S);
  assert.equal(plan.pages.length, 2);
  const [a, b] = plan.pages;
  assert.equal(a.bg.fc, "#112233");
  const text = a.items.find((i) => i.k === "text");
  assert.equal(text.tx, "Γεια σου & <κόσμε>\nδεύτερη");
  assert.deepEqual([text.size, text.b, text.al, text.lh, text.tr, text.fc, text.rot, text.x, text.w], [64 * S, 1, "c", 150, 50, "#ff0000", 10, 100 * S, 800 * S]);
  const shapes = a.items.filter((i) => i.k === "shape");
  assert.equal(shapes[0].shp, "rounded"); assert.equal(shapes[0].rd, 40);
  assert.equal(shapes[0].fc, "#00ff00"); assert.equal(shapes[0].op, 50); assert.equal(shapes[0].sc, "#0000ff"); assert.equal(shapes[0].sw, 4 * S);
  // the star is exact custom geometry (read back as a drawn picture)
  const line = a.items.find((i) => i.k === "line");
  assert.deepEqual([line.x, line.y, line.w, line.h, line.sc, line.sw, line.as, line.ae], [900 * S, 900 * S, -300 * S, 100 * S, "#123456", 6 * S, "dot", "arrow"]);
  const photos = a.items.filter((i) => i.k === "photo" && !i.svg);
  assert.equal(photos.length, 2);                                       // the photo + the icon picture
  const ph = photos[0];
  assert.equal(ph.shp, "circle");
  // fill: a 2:1 image in a square frame keeps its middle half
  assert.deepEqual(ph.crop, { l: 0.25, t: 0, r: 0.25, b: 0 });
  assert.equal(b.items.length, 1);
  assert.equal(b.bg.fc, "#112233");
  // and back through the build: the design's own pixels again
  const back = P.build(plan, {}, 2000).doc;
  assert.deepEqual([back.setup.w, back.setup.h], [1080, 1350]);
  const bt = back.items.find((i) => i.ax.k === "text");
  assert.deepEqual([bt.ax.size, bt.x, bt.w], [64, 100, 800]);
});

test("the package: well-formed parts, slide size, title escaped, no script", async () => {
  const d = design(), media = { ["a:" + IMG]: PNG };
  const { r, zip } = await roundTrip(d, media);
  assert.equal(r.out.missing, 2);                                       // the pictures not supplied are counted
  for (const name of zip.names) {
    if (!/\.(xml|rels)$/.test(name)) continue;
    const s = await zip.text(name);
    assert.ok(P.parseXml(s), name);
    assert.ok(!/<script|javascript:/i.test(s), name);
  }
  const pres = await zip.text("ppt/presentation.xml");
  assert.match(pres, /<p:sldSz cx="10287000" cy="12858750"\/>/);   // 810 × 1012.5 pt = 1080 × 1350 px
  assert.match(await zip.text("docProps/core.xml"), /Αφίσα &lt;1&gt;/);
  assert.deepEqual(zip.names.filter((n) => /media/.test(n)), ["ppt/media/image1.png"]);   // one copy of the image
});

test("sizes past PowerPoint's limits scale as a whole", async () => {
  const d = AX.newDesign({ name: "Banner", w: 8064, h: 1000, unit: "px", bg: "#ffffff" }, 1);
  AX.addItem(d, M.pagesInOrder(d)[0].id, { k: "text", tx: "Hi", size: 100, x: 800, y: 0, w: 1000 }, 1);
  const { r, plan } = await roundTrip(d, {});
  assert.equal(r.scale, 0.5);
  assert.equal(plan.w, 4032);
  const t = plan.pages[0].items[0];
  assert.deepEqual([t.x, t.size], [400, 50]);
});

test("CV-0: paper sizes keep their points both ways; screen sizes are Canva's 0.75 pt per px", async () => {
  assert.equal(AX.paper(595.28, 841.89), true);
  assert.equal(AX.paper(810, 810), false);
  // an A4 design (mm) goes out at its own size and comes back unscaled
  const a4 = AX.newDesign({ name: "A4", w: 595.28, h: 841.89, unit: "mm", pages: 1 }, 1);
  AX.addItem(a4, M.pagesInOrder(a4)[0].id, { k: "text", tx: "Flyer", size: 24, x: 72, y: 72, w: 300 }, 1);
  const { zip, plan } = await roundTrip(a4, {});
  assert.match(await zip.text("ppt/presentation.xml"), /<p:sldSz cx="7560056" cy="10692003"\/>/);
  const back = P.build(plan, {}, 2).doc;
  assert.deepEqual([back.setup.w, back.setup.h], [595.28, 841.89]);
  assert.equal(back.items.find((i) => i.ax.k === "text").ax.size, 24);
  // scaleDesign: page, boxes, strokes, crops and font sizes, exactly
  const d = AX.newDesign({ name: "s", w: 810, h: 810, unit: "px" }, 1), pg = M.pagesInOrder(d)[0].id;
  AX.addItem(d, pg, { k: "photo", a: IMG, iw: 400, ih: 200, fit: "custom", ix: -30, iy: 0, isc: 0.5, x: 30, y: 60, w: 150, h: 90 }, 1);
  AX.addItem(d, pg, { k: "line", sw: 3, x: 0, y: 0, w: 300, h: 0 }, 1);
  AX.scaleDesign(d, 4 / 3);
  const n = M.normDoc(d), ph = n.items.find((i) => i.t === "img");
  assert.deepEqual([n.setup.w, ph.x, ph.y, ph.w, ph.h, ph.ix, ph.isc], [1080, 40, 80, 200, 120, -40, 0.667]);
  assert.equal(n.items.find((i) => i.ax.k === "line").sw, 4);
});
