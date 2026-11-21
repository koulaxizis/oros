// Photo Lab wave PS-5: the 11 Photoshop blend modes the canvas lacks
// (photolab/blendx.js), their names in PSD, XCF, OpenRaster and Krita,
// and the wiring into the screen and the export.
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const BX = require("../photolab/blendx.js");
const C = require("../photolab/core.js");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

// one pixel b (backdrop) under s (source), opacity a
function mix(id, b, s, a = 1) {
  const dst = new Uint8ClampedArray(b), src = new Uint8ClampedArray(s);
  BX.blendPixels(dst, src, a, id, 1, 0, 0);
  return [...dst];
}

test("every per-pixel mode is in core BLENDS with no canvas op, and only those", () => {
  const soft = C.BLENDS.filter((b) => !b.op).map((b) => b.id);
  assert.deepEqual(soft.slice().sort(), BX.IDS.slice().sort());
  BX.IDS.forEach((id) => assert.ok(BX.isSoft(id)));
  ["normal", "multiply", "hue", "pass", "nope"].forEach((id) => assert.ok(!BX.isSoft(id), id));
});

test("opaque over opaque: Photoshop's formulas", () => {
  const B = [100, 150, 200, 255], S = [200, 100, 50, 255];
  assert.deepEqual(mix("linearburn", B, S), [45, 0, 0, 255]);              // b + s - 1
  assert.deepEqual(mix("lineardodge", B, S), [255, 250, 250, 255]);        // b + s
  assert.deepEqual(mix("subtract", B, S), [0, 50, 150, 255]);              // b - s
  assert.deepEqual(mix("divide", B, S), [128, 255, 255, 255]);             // b / s
  assert.deepEqual(mix("linearlight", B, S), [245, 95, 45, 255]);           // b + 2s - 1
  assert.deepEqual(mix("pin", B, S), [145, 150, 100, 255]);
  assert.deepEqual(mix("hardmix", B, S), [255, 0, 0, 255]);              // b + s ≥ 1
  assert.deepEqual(mix("hardmix", [10, 10, 10, 255], [20, 20, 20, 255]), [0, 0, 0, 255]);
  // vivid: s ≤ ½ colour burn with 2s, else colour dodge with 2s - 1
  assert.deepEqual(mix("vivid", [128, 128, 128, 255], [64, 192, 128, 255]), [2, 255, 129, 255]);
  // darker / lighter colour take the whole colour, by its sum
  assert.deepEqual(mix("darkercolor", B, S), [200, 100, 50, 255]);
  assert.deepEqual(mix("lightercolor", B, S), [100, 150, 200, 255]);
});

test("opacity and transparency follow the W3C rule", () => {
  // over nothing: the source's own colour, its alpha × opacity
  assert.deepEqual(mix("subtract", [0, 0, 0, 0], [200, 100, 50, 255], 0.5), [200, 100, 50, 128]);
  // half opacity over opaque: halfway between backdrop and the mix
  assert.deepEqual(mix("lineardodge", [100, 100, 100, 255], [100, 100, 100, 255], 0.5), [150, 150, 150, 255]);
  // a transparent source changes nothing
  assert.deepEqual(mix("divide", [9, 8, 7, 255], [1, 2, 3, 0]), [9, 8, 7, 255]);
});

test("dissolve: all or nothing per document pixel, by a fixed noise", () => {
  const n = 4000, dst = new Uint8ClampedArray(n * 4), src = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) { src.set([255, 0, 0, 255], i * 4); dst.set([0, 0, 255, 255], i * 4); }
  BX.blendPixels(dst, src, 0.3, "dissolve", 100, 0, 0);
  let red = 0;
  for (let i = 0; i < n; i++) {
    const px = [...dst.slice(i * 4, i * 4 + 4)];
    assert.ok(px.join() === "255,0,0,255" || px.join() === "0,0,255,255", px.join());
    if (px[0] === 255) red++;
  }
  assert.ok(red > n * 0.25 && red < n * 0.35, "about 30 % of the pixels: " + red);
  assert.equal(BX.noise(17, 42), BX.noise(17, 42));
  // the noise is the document's: the same pixels at another offset of the rect
  const one = (x, y) => { const d = new Uint8ClampedArray([0, 0, 0, 255]); BX.blendPixels(d, new Uint8ClampedArray([255, 255, 255, 255]), 0.5, "dissolve", 1, x, y); return d[0]; };
  const two = new Uint8ClampedArray(8).fill(0); two[3] = two[7] = 255;
  BX.blendPixels(two, new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]), 0.5, "dissolve", 2, 30, 40);
  assert.deepEqual([two[0], two[4]], [one(30, 40), one(31, 40)]);
});

test("PSD, XCF, OpenRaster and Krita know the new modes, in and out", () => {
  const P = read("photolab/psd.js"), X = require("../photolab/xcf.js"), O = read("photolab/ora.js");
  const keys = { diss: "dissolve", lbrn: "linearburn", dkCl: "darkercolor", lddg: "lineardodge", lgCl: "lightercolor",
    vLit: "vivid", lLit: "linearlight", pLit: "pin", hMix: "hardmix", fsub: "subtract", fdiv: "divide" };
  Object.keys(keys).forEach((k) => assert.ok(P.includes('"' + k + '": "' + keys[k] + '"'), k));
  const gimp = { 1: "dissolve", 33: "lineardodge", 34: "subtract", 41: "divide", 48: "vivid", 49: "pin", 50: "linearlight",
    51: "hardmix", 53: "linearburn", 54: "darkercolor", 55: "lightercolor" };
  Object.keys(gimp).forEach((m) => assert.equal(X.MODES[m], gimp[m], "GIMP " + m));
  BX.IDS.forEach((id) => assert.ok(O.includes('"' + id + '"'), "ORA/Krita " + id));
  assert.ok(O.includes('"svg:plus": "lineardodge"'));
});

test("wiring: the screen, groups and the layer cap mix through blendx; strings EN, EL, DE", () => {
  const V = read("photolab/view.js"), IO = read("photolab/io.js"), H = read("photolab/index.html");
  assert.equal((V.match(/BX\.drawOver\(/g) || []).length, 2);
  assert.ok(IO.includes("blendx.drawOver("));
  assert.ok(H.indexOf('src="blendx.js') > H.indexOf('src="core.js') && H.indexOf('src="blendx.js') < H.indexOf('src="view.js'));
  global.window = {};
  require(path.join(__dirname, "..", "photolab/strings.js"));
  const S = global.window.PL_STRINGS, DE = read("i18n/de/photolab.js");
  delete global.window;
  BX.IDS.forEach((id) => {
    assert.ok(S.en["blend." + id] && S.el["blend." + id], id + " EN + EL");
    assert.ok(DE.includes('"blend.' + id + '"'), id + " DE");
  });
});
