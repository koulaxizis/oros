// Layout: Scribus linked pictures (layout/sla.js v1.3.0). Every image
// frame keeps how Scribus placed its picture (ext.place) and linked
// pictures are listed by name (`links`); once the picture is there,
// placePicture() gives the frame the same scale and offset, fit or stretch,
// and designkit/render.js draws a stretch with its own height scale
// (ext.iscy). io.js fills the frames from pictures picked with the
// file, its "Collect for output" folder, or later (Find pictures).
// Synthetic files only.
// Run: node --test tests/layout-sla-links.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const S = require(path.join(ROOT, "layout/sla.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const SLA = `<SCRIBUSUTF8NEW Version="1.5.8"><DOCUMENT ANZPAGES="1" PAGEWIDTH="400" PAGEHEIGHT="600" BORDERLEFT="40" BORDERRIGHT="40" BORDERTOP="40" BORDERBOTTOM="40">
  <PAGE PAGEXPOS="100" PAGEYPOS="20" PAGEWIDTH="400" PAGEHEIGHT="600" NUM="0"/>
  <PAGEOBJECT XPOS="140" YPOS="60" WIDTH="200" HEIGHT="100" PTYPE="2" OwnPage="0" PFILE="Pictures/Cover Front.JPG" SCALETYPE="0" RATIO="1" LOCALSCX="0.25" LOCALSCY="0.25" LOCALX="-40" LOCALY="12" PCOLOR="None" PCOLOR2="None" ItemID="1"/>
  <PAGEOBJECT XPOS="140" YPOS="200" WIDTH="200" HEIGHT="100" PTYPE="2" OwnPage="0" PFILE="C:\\\\work\\\\back.png" SCALETYPE="1" RATIO="0" LOCALSCX="0.5" LOCALSCY="0.2" PCOLOR="None" PCOLOR2="None" ItemID="2"/>
  <PAGEOBJECT XPOS="140" YPOS="340" WIDTH="200" HEIGHT="100" PTYPE="2" OwnPage="0" PFILE="logo.png" SCALETYPE="1" RATIO="1" PCOLOR="None" PCOLOR2="None" ItemID="3"/>
  <PAGEOBJECT XPOS="140" YPOS="460" WIDTH="200" HEIGHT="100" PTYPE="2" OwnPage="0" PFILE="free.jpg" SCALETYPE="0" LOCALSCX="0.4" LOCALSCY="0.3" LOCALX="10" LOCALY="20" PCOLOR="None" PCOLOR2="None" ItemID="4"/>
</DOCUMENT></SCRIBUSUTF8NEW>`;

function imgs(res) { return res.doc.items.filter((i) => i.t === "img").sort((a, b) => a.y - b.y); }

test("linked pictures are listed by name and keep how Scribus placed them", () => {
  const res = S.convert(SLA, { now: 5 });
  const [a, b, c, d] = imgs(res);
  assert.equal(res.linked, 4);
  assert.deepEqual(res.links.map((l) => l.name), ["Cover Front.JPG", "back.png", "logo.png", "free.jpg"]);
  assert.deepEqual(res.links.map((l) => l.item), [a.id, b.id, c.id, d.id]);
  assert.deepEqual(a.ext.place, [0, 0.25, 0.25, -40, 12]);
  assert.deepEqual(b.ext.place, [2, 0.5, 0.2, 0, 0]);
  assert.deepEqual(c.ext.place, [1, 1, 1, 0, 0]);
  assert.deepEqual(d.ext.place, [0, 0.4, 0.3, 10, 20]);
  // the bag survives the model's normalizer (R39) unchanged
  assert.deepEqual(M.normDoc(res.doc).items.find((i) => i.id === a.id).ext, a.ext);
});

test("placePicture(): own scale and offset, fit, stretch; the picture lands where Scribus drew it", () => {
  const res = S.convert(SLA, { now: 5 });
  const [a, b, c, d] = imgs(res);
  [a, b, c, d].forEach((it) => { it.iw = 1600; it.ih = 800; S.placePicture(it); });
  // free placement: points = pixels × LOCALSC, offset LOCALX × LOCALSC
  assert.deepEqual(R.imageRect(a), { x: -10, y: 3, w: 400, h: 200 });
  assert.equal(a.ext.iscy, undefined, "same scale both ways: no iscy");
  // stretched to the frame (RATIO 0): both sides to the frame
  assert.equal(b.fit, "custom");
  const rb = R.imageRect(b);
  assert.ok(Math.abs(rb.w - 200) < 1e-9 && Math.abs(rb.h - 100) < 1e-9 && rb.x === 0 && rb.y === 0);
  // proportional fit
  assert.equal(c.fit, "fit");
  assert.equal(c.ext.iscy, undefined);
  // free and not uniform: the height has its own scale
  const rd = R.imageRect(d);
  assert.ok(Math.abs(rd.w - 640) < 1e-9 && Math.abs(rd.h - 240) < 1e-9);
  assert.ok(Math.abs(rd.x - 4) < 1e-9 && Math.abs(rd.y - 6) < 1e-9);
  assert.equal(d.ext.iscy, 0.3);
  // the lower resolution of the two sides counts in preflight
  assert.ok(Math.abs(R.effectivePpi(d) - 180) < 1e-9, "1600 px over 640 pt, not 800 px over 240 pt");
  // no picture size or no ext.place: nothing changes
  const e = { t: "img", w: 10, h: 10, fit: "fill", ext: { place: [0, 2, 2, 0, 0] } };
  S.placePicture(e);
  assert.equal(e.fit, "fill");
  const f = { t: "img", w: 10, h: 10, iw: 5, ih: 5, fit: "fill" };
  S.placePicture(f);
  assert.deepEqual(f, { t: "img", w: 10, h: 10, iw: 5, ih: 5, fit: "fill" });
});

test("uniform() returns to one scale; names compare loosely", () => {
  const it = { ext: { iscy: 2 } };
  R.uniform(it);
  assert.equal(it.ext, undefined);
  const k = { ext: { iscy: 2, place: [2, 1, 1, 0, 0] } };
  R.uniform(k);
  assert.deepEqual(k.ext, { place: [2, 1, 1, 0, 0] });
  assert.equal(S.nameKey("Pictures/Cover Front.JPG"), "cover front.jpg");
  assert.equal(S.nameKey("C:\\work\\Ε\u0301ξώφυλλο.PNG"), S.nameKey("Έξώφυλλο.png"), "accent written apart, case, folder");
});

test("wiring: open with pictures or the folder, Find pictures, every edit of the fit or scale goes back to one scale", () => {
  const io = read("layout/io.js");
  assert.match(io, /if \(sla && !list\.some\(function \(f\) \{ return f\.name === "content\.json"; \}\)\) return importSla\(sla, list\.filter\(isPicture\), list\.filter\(isPdf\)\[0\]\);/);
  assert.match(io, /var first = importSla\(sla\[0\], pics, pdf\);/);
  assert.match(io, /"sla\.done", \{ p: res\.stats\.pages, n: res\.stats\.items \}\) \+ fitMsg, "", pics\);/);
  assert.match(io, /LY\.toast\(parts\.join\(" "\), t\("sla\.find"\), relinkPick\);/);
  assert.match(io, /it\.ix = 0; it\.iy = 0; it\.isc = 1; LY\.R\.uniform\(it\);/);
  const pn = read("layout/panels.js");
  assert.match(pn, /x\.fit = v; R\.uniform\(x\);/);
  assert.match(pn, /x\.fit = "custom"; x\.isc = k; R\.uniform\(x\);/);
  assert.match(read("layout/editor.js"), /if \(o\.ext && o\.ext\.iscy > 0\) it\.ext\.iscy = o\.ext\.iscy \* k;/);
  const ly = read("layout/layout.js"), de = read("i18n/de/layout.js");
  ["sla.find", "sla.relinked"].forEach((k) => {
    assert.equal(ly.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.includes('"' + k + '":'), k);
  });
});
