// orOS Scanner & PDF, camera scanning (scanpdf/scan.js): quads, finding
// the page in a picture (bright on dark, dark on bright, nothing,
// filling the frame), perspective correction (homography, warp), the
// looks (Document, Grey, Black & white, Photo) on a page with a
// shadow, quarter turns, auto-capture steadiness; scanned pages keep
// their own shape in the PDF; the scanner's wiring (camera stopped,
// strings).
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const S = require(path.join(ROOT, "scanpdf/scan.js"));
const C = require(path.join(ROOT, "scanpdf/core.js"));
const OPS = require(path.join(ROOT, "scanpdf/pdfops.js"));
const L = require(path.join(ROOT, "vendor/pdf-lib/pdf-lib.min.js"));

// A w × h picture: `paint(x, y)` gives the grey level of each pixel.
function picture(w, h, paint) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = paint(x + 0.5, y + 0.5), i = (y * w + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  return { data: d, width: w, height: h };
}
function inside(q, x, y) {
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false;
  }
  return true;
}
// a repeatable bit of noise
function noise(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; }; }
const grey = (img, x, y) => img.data[(y * img.width + x) * 4];
const near = (a, b, tol) => a.every((p, i) => Math.abs(p[0] - b[i][0]) <= tol && Math.abs(p[1] - b[i][1]) <= tol);

test("quads: order, convex, area, output size, whole picture", () => {
  const q = S.orderQuad([[300, 220], [10, 15], [290, 20], [5, 210]]);
  assert.deepEqual(q, [[10, 15], [290, 20], [300, 220], [5, 210]]);
  assert.ok(S.isConvex(q));
  assert.ok(!S.isConvex([[0, 0], [10, 10], [10, 0], [0, 10]]), "crossed");
  assert.equal(S.quadArea([[0, 0], [10, 0], [10, 5], [0, 5]]), 50);
  assert.deepEqual(S.outSize([[0, 0], [100, 0], [100, 200], [0, 200]]), [100, 200]);
  assert.deepEqual(S.outSize([[0, 0], [6000, 0], [6000, 3000], [0, 3000]]), [2400, 1200]);
  assert.deepEqual(S.fullQuad(1, 1, 0.1).map((p) => p.map((v) => Math.round(v * 10) / 10)), [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]);
  assert.deepEqual(S.clampQuad([[-5, 3], [120, -1], [99, 99], [0, 50]], 100, 80), [[0, 3], [100, 0], [99, 80], [0, 50]]);
});

test("detectQuad: a light page on a dark desk and a dark page on a light one, turned and noisy", () => {
  const q = [[70, 30], [260, 50], [245, 220], [55, 200]];
  for (const [bg, page] of [[60, 220], [205, 85]]) {
    const n = noise(7);
    const img = picture(320, 240, (x, y) => (inside(q, x, y) ? page : bg) + n() * 30);
    const r = S.detectQuad(img);
    assert.ok(r, "found on " + bg + "/" + page);
    assert.ok(near(r.quad, q, 3), JSON.stringify(r.quad));
    assert.ok(r.area > 0.35 && r.area < 0.5);
  }
});

test("detectQuad: nothing on an even picture or a blob that is not a sheet", () => {
  const n = noise(3);
  assert.equal(S.detectQuad(picture(320, 240, () => 128 + n() * 40)), null);
  const edge = S.detectQuad(picture(320, 240, (x, y) => (x > 2 && y > 2 && x < 318 && y < 238 ? 220 : 40)));
  assert.ok(edge && edge.area > 0.9 && edge.area <= 0.97, "a page almost filling the frame is still found");
  // a round blob: its outline is no four-cornered sheet
  assert.equal(S.detectQuad(picture(320, 240, (x, y) => (Math.hypot(x - 160, y - 120) < 90 ? 220 : 50))), null);
  assert.equal(S.detectQuad(picture(8, 8, () => 0)), null);
});

test("homography + warp: a turned page comes out straight, its corners in place", () => {
  const src = [[0, 0], [100, 0], [100, 140], [0, 140]], dst = [[40, 20], [150, 35], [140, 190], [30, 170]];
  const H = S.homography(src, dst);
  src.forEach((p, i) => { const m = S.applyH(H, p[0], p[1]); assert.ok(Math.abs(m[0] - dst[i][0]) < 1e-6 && Math.abs(m[1] - dst[i][1]) < 1e-6); });
  assert.equal(S.homography([[0, 0], [0, 0], [0, 0], [0, 0]], dst), null);
  // the page: white with a black square in its top-left quarter
  const Hinv = S.homography(dst, src);
  const img = picture(200, 220, (x, y) => {
    if (!inside(dst, x, y)) return 90;
    const u = S.applyH(Hinv, x, y);
    return u[0] < 50 && u[1] < 70 ? 0 : 255;
  });
  const out = S.warp(img, dst, 100, 140);
  assert.equal(out.width, 100); assert.equal(out.height, 140);
  assert.ok(grey(out, 20, 30) < 40, "top-left quarter is black");
  assert.ok(grey(out, 80, 30) > 215 && grey(out, 20, 110) > 215 && grey(out, 80, 110) > 215, "the rest is white");
  assert.equal(out.data[3], 255);
});

test("filters: Document and Grey make the paper white under a shadow; Black & white keeps the ink and drops the shadow", () => {
  // paper 225 on the right, 120 under a shadow on the left; ink bars 40 lighter in the shadow
  const page = () => picture(240, 160, (x, y) => {
    const shade = x < 120 ? 0.53 : 1;
    const ink = (y % 40) > 16 && (y % 40) < 24 && x > 20 && x < 220;
    return (ink ? 40 : 225) * shade;
  });
  const doc = S.filter(page(), "color");
  assert.ok(grey(doc, 60, 5) > 235 && grey(doc, 180, 5) > 235, "paper white in shadow and light: " + grey(doc, 60, 5) + "/" + grey(doc, 180, 5));
  assert.ok(grey(doc, 60, 20) < 90 && grey(doc, 180, 20) < 90, "ink dark");
  const g = S.filter(page(), "gray");
  assert.equal(g.data[0], g.data[1]);
  const bw = S.filter(page(), "bw");
  const vals = new Set(); for (let i = 0; i < bw.data.length; i += 4) vals.add(bw.data[i]);
  assert.deepEqual([...vals].sort((a, b) => a - b), [0, 255]);
  assert.equal(grey(bw, 60, 5), 255, "shadowed paper white");
  assert.equal(grey(bw, 60, 20), 0, "shadowed ink black");
  assert.equal(grey(bw, 180, 20), 0);
  const ph = page(), before = Buffer.from(ph.data);
  S.filter(ph, "photo"); S.filter(ph, "nope");
  assert.ok(before.equals(Buffer.from(ph.data)), "Photo and unknown looks leave it as taken");
});

test("rotate90: sizes swap, pixels move a quarter, four turns are the start", () => {
  const img = picture(3, 2, (x, y) => (x < 1 && y < 1 ? 10 : 200));    // dark top-left
  const r = S.rotate90(img, 1);
  assert.deepEqual([r.width, r.height], [2, 3]);
  assert.equal(grey(r, 1, 0), 10, "clockwise: top-left goes top-right");
  assert.equal(grey(S.rotate90(img, -1), 0, 2), 10, "counter-clockwise: to bottom-left");
  let back = img; for (let i = 0; i < 4; i++) back = S.rotate90(back, 1);
  assert.ok(Buffer.from(back.data).equals(Buffer.from(img.data)));
});

test("steady: auto-capture only after the outline holds still", () => {
  const q = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]];
  const moved = q.map((p) => [p[0] + 0.05, p[1]]);
  assert.ok(S.steady([q, q, q, q, q, q, q], 7, 0.02));
  assert.ok(!S.steady([q, q, q, q, q, q], 7, 0.02), "not long enough");
  assert.ok(!S.steady([q, q, q, moved, q, q, q], 7, 0.02), "moved");
  assert.ok(!S.steady([q, q, q, null, q, q, q], 7, 0.02), "lost the page");
});

test("scanned pages keep their own shape and no margin, whatever the picture page choices", async () => {
  assert.deepEqual(C.prefsFor({ scan: true }, { size: "a4", margin: "normal" }), Object.assign(C.readPrefs({ size: "fit", margin: "none" })));
  assert.equal(C.prefsFor({}, { size: "letter" }).size, "letter");
  const jpg = new Uint8Array(fs.readFileSync(path.join(ROOT, "tests/fixtures/scanpdf/plain.jpg")));
  const img = { bytes: jpg, type: "jpg", w: 8, h: 4 };
  const pages = [{ key: "a", src: "s", idx: 0, rot: 0 }, { key: "b", src: "p", idx: 0, rot: 0 }];
  const d = await L.PDFDocument.load(await OPS.build(L, { s: { kind: "image", img, scan: true }, p: { kind: "image", img } }, pages, { size: "a4", margin: "normal" }));
  const a = d.getPage(0).getSize(), b = d.getPage(1).getSize();
  assert.equal(Math.round(a.width / a.height), 2, "the scan's own shape");
  assert.deepEqual(b, { width: 841.89, height: 595.28 }, "a picture still on A4");
});

test("scanner wiring: scan.js loaded before the app, the camera is always stopped, every string exists", () => {
  const html = read("scanpdf/index.html");
  assert.ok(html.indexOf('src="core.js') < html.indexOf('src="scan.js') && html.indexOf('src="scan.js') < html.indexOf('src="scanpdf.js'));
  const js = read("scanpdf/scanpdf.js");
  assert.ok(/getTracks\(\)\.forEach\(function \(tr\) \{ try \{ tr\.stop\(\)/.test(js), "tracks stopped");
  ["visibilitychange", "pagehide", "facingMode", "NotAllowedError"].forEach((s) => assert.ok(js.includes(s), s));
  const block = js.slice(js.indexOf("var STRINGS = ") + 14, js.indexOf("\n  };\n", js.indexOf("var STRINGS = ")) + 4);
  const T = new Function("return " + block)();
  S.FILTERS.map((f) => "sc.f." + f).concat([0, 1, 2, 3].map((i) => "sc.corner." + i))
    .forEach((k) => { assert.ok(T.en[k], k); assert.ok(T.el[k], "el " + k); });
  assert.ok(!/[Ͱ-Ͽ]/.test(read("scanpdf/scan.js")), "scan.js has no UI text");
});
