// Atelier wave CV-2: Canva's photo effects (atelier/photofx.js) — shadow
// and glow, duotone, blur edges, frames — their record (ext.pfx), how
// the exports draw them, and the wiring of the panel.
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const PF = require("../atelier/photofx.js");
const AX = require("../atelier/ax.js");
const M = require("../designkit/model.js");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("norm keeps only what it knows, clamped, in a fixed order", () => {
  assert.equal(PF.norm(null), null);
  assert.equal(PF.norm({}), null);
  assert.equal(PF.norm({ sh: { t: "nope" }, eb: 0, fr: { t: "x" } }), null);
  const p = PF.norm({ fr: { t: "polaroid", c: "#FFFFFF", w: 99 }, eb: 140, duo: { a: "red", b: "#00FF00" }, sh: { t: "drop", op: -3, bl: 7.6, d: 80, ang: 400, c: "#123456" } });
  assert.deepEqual(Object.keys(p), ["sh", "duo", "eb", "fr"]);
  assert.deepEqual(p.sh, { t: "drop", c: "#123456", op: 0, bl: 8, d: 50, ang: 359 });
  assert.deepEqual(p.duo, { a: PF.DEF.duo.a, b: "#00ff00" });
  assert.equal(p.eb, 100);
  assert.deepEqual(p.fr, { t: "polaroid", c: "#ffffff", w: 30 });
  assert.deepEqual(PF.norm({ sh: { t: "glow", d: 20, ang: 90 } }).sh, { t: "glow", c: "#ffde59", op: 80, bl: 10, d: 0, ang: 0 });
  assert.deepEqual(PF.norm(JSON.parse(JSON.stringify(p))), p, "stable");
});

test("of() reads photos only; composite and pad; the frame's inner rect", () => {
  const ph = { ax: { k: "photo" }, w: 200, h: 100, ext: { pfx: { duo: { a: "#000000", b: "#ffffff" } } } };
  assert.ok(PF.of(ph));
  assert.equal(PF.of({ ax: { k: "text" }, ext: ph.ext }), null);
  assert.ok(!PF.composite(PF.of(ph)), "duotone alone is a look, not a composite");
  assert.ok(PF.composite({ eb: 5 }) && PF.composite({ fr: { t: "border" } }));
  assert.equal(PF.pad(ph, PF.of(ph)), 0);
  assert.equal(PF.pad(ph, PF.norm({ sh: { t: "drop", bl: 10, d: 5 } })), Math.ceil(100 * 0.1 * 1.2 + 100 * 0.05) + 1);
  assert.deepEqual(PF.inner(ph, PF.norm({ fr: { t: "border", w: 5 } })), { x: 5, y: 5, w: 190, h: 90 });
  const pol = PF.inner(ph, PF.norm({ fr: { t: "polaroid", w: 4 } }));
  assert.equal(pol.x, 4); assert.equal(pol.y, 4); assert.equal(pol.w, 192); assert.equal(pol.h, 100 - 4 - 14);
});

test("duotone maps black to the shadows colour and white to the highlights colour", () => {
  const d = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 128, 128, 128, 128, 255]);
  PF.duotone(d, "#102030", "#f0e0d0");
  assert.deepEqual([...d.slice(0, 4)], [16, 32, 48, 255]);
  assert.deepEqual([...d.slice(4, 8)], [240, 224, 208, 128], "alpha kept");
  assert.deepEqual([...d.slice(8, 11)], [128, 128, 128]);
});

test("ext.pfx survives the model and the design's storage", () => {
  const d = AX.newDesign({ name: "Fx", w: 1080, h: 1080, unit: "px", bg: "#ffffff" }, 1000);
  const pg = M.pagesInOrder(d)[0];
  AX.addItem(d, pg.id, { k: "photo", x: 10, y: 10, w: 300, h: 200 }, 1000);
  const it = d.items.filter((x) => x.ax.k === "photo")[0];
  it.ext = { pfx: PF.norm({ sh: { t: "drop" }, fr: { t: "border" } }) };
  const back = M.normDoc(JSON.parse(JSON.stringify(d)));
  const b = back.items.filter((x) => x.id === it.id)[0];
  assert.deepEqual(PF.of(b), it.ext.pfx);
});

test("PDF, PowerPoint and web export draw a photo with effects as a picture with room for the shadow", () => {
  const P = read("atelier/pdfout.js"), O = read("atelier/pptxout.js"), W = read("atelier/webout.js"), IO = read("atelier/io.js");
  assert.ok(P.includes('(PF && PF.of(it) ? "raster" : "photo")') && P.includes("return PF.pad(it, PF.of(it));"));
  assert.ok(W.includes('(PF && PF.of(it) ? "raster" : "photo")') && W.includes("return PF ? PF.pad(it, PF.of(it)) : 0;"));
  assert.ok(O.includes("ax.adj || ax.flt || (PF && PF.of(it))"));
  assert.ok(IO.includes("window.AtelierPhotoFx.pad(it, window.AtelierPhotoFx.of(it))"));
  const D = read("atelier/draw.js");
  assert.ok(D.includes("PF.paint(ctx, it, pf, shape,") && D.includes("PF.duotone(id.data, duo.a, duo.b)"));
  const H = read("atelier/index.html");
  assert.ok(H.indexOf('src="photofx.js') > 0 && H.indexOf('src="photofx.js') < H.indexOf('src="draw.js'));
});

test("wiring: the Effects view for photos, strings in EN, EL and DE", () => {
  const PN = read("atelier/panels.js"), C = read("atelier/core.js"), DE = read("i18n/de/atelier.js");
  ["VIEWS.pfx = function", 't("ctx.pfx"), function () { openView("pfx"); }', "pfx: 1, mask: 1"].forEach((s) => assert.ok(PN.includes(s), s));
  ["ctx.pfx", "tab.pfx", "pfx.shadow", "pfx.none", "pfx.drop", "pfx.glow", "pfx.color", "pfx.op", "pfx.bl", "pfx.d", "pfx.ang", "pfx.duo",
   "pfx.duoA", "pfx.duoB", "pfx.eb", "pfx.frame", "pfx.border", "pfx.polaroid", "pfx.fw", "pfx.reset"].forEach((k) => {
    assert.equal(C.split('"' + k + '"').length - 1, 2, k + " EN + EL");
    assert.ok(DE.includes('"' + k + '"'), k + " DE");
  });
});
