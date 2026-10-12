// Atelier magic resize (atelier/relayout.js): elements are placed
// again for a new page size instead of the page being shrunk.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const M = require(path.join(__dirname, "..", "designkit/model.js"));
const AX = require(path.join(__dirname, "..", "atelier/ax.js"));
const RL = require(path.join(__dirname, "..", "atelier/relayout.js"));

const th = (it) => AX.textHeight(M.normItem(it));
function design() {
  const d = AX.newDesign({ name: "Post", w: 1080, h: 1080 }, 1000);
  const pg = d.pages[0].id;
  AX.addItem(d, pg, { k: "shape", shp: "rect", fc: "#112233", x: 0, y: 980, w: 1080, h: 100 }, 1001);          // bottom bar
  AX.addItem(d, pg, { k: "text", tx: "Big sale", size: 96, al: "c", x: 140, y: 440, w: 800 }, 1002);            // centred title
  AX.addItem(d, pg, { k: "icon", ico: "star", sc: "#000000", x: 30, y: 30, w: 120, h: 120 }, 1003);             // top-left logo
  AX.addItem(d, pg, { k: "photo", a: "ab".repeat(32) + ".jpg", iw: 800, ih: 800, x: 0, y: 0, w: 1080, h: 1080, fit: "custom", ix: 10, iy: 10, isc: 1.5 }, 1004);
  return M.normDoc(d);
}
const byK = (d, k) => d.items.find((it) => it.ax && it.ax.k === k && !it.ax.bg);

test("relayout: square post → story keeps sizes and anchors", () => {
  const src = design();
  const r = RL.relayout(src, 1080, 1920, { textHeight: th });
  assert.equal(r.setup.w, 1080); assert.equal(r.setup.h, 1920);
  assert.equal(src.setup.h, 1080, "the input is not changed");
  const bg = r.items.find((it) => it.ax.bg);
  assert.deepEqual([bg.x, bg.y, bg.w, bg.h], [0, 0, 1080, 1920]);
  const bar = r.items.find((it) => it.ax.k === "shape" && !it.ax.bg);
  assert.deepEqual([bar.x, bar.y, bar.w, bar.h], [0, 1820, 1080, 100], "bottom bar stays at the bottom, full width");
  const logo = byK(r, "icon");
  assert.deepEqual([logo.x, logo.y, logo.w, logo.h], [30, 30, 120, 120], "top-left logo stays top-left");
  const title = byK(r, "text");
  assert.equal(title.ax.size, 96);
  const t0 = byK(src, "text");
  const want = (t0.y + t0.h / 2) / 1080 * 1920;
  assert.ok(Math.abs(title.y + title.h / 2 - want) < 2, "title keeps its place on the page: " + title.y);
  const photo = byK(r, "photo");
  assert.deepEqual([photo.x, photo.y, photo.w, photo.h], [0, 0, 1080, 1920], "full-bleed photo covers the new page");
  assert.equal(photo.fit, "fill", "a stretched photo is cropped to fill");
});

test("relayout: square → wide banner scales by the smaller side, nothing leaves the page", () => {
  const r = RL.relayout(design(), 1920, 600, { textHeight: th });
  const k = 600 / 1080;
  const logo = byK(r, "icon");
  assert.ok(Math.abs(logo.w - 120 * k) < 0.02 && Math.abs(logo.x - 30 * k) < 0.02);
  const title = byK(r, "text");
  assert.equal(title.ax.size, Math.round(96 * k * 10) / 10);
  assert.ok(Math.abs(title.x + title.w / 2 - 960) < 1, "centred across");
  r.items.forEach((it) => {
    assert.ok(it.x >= -0.01 && it.y >= -0.01 && it.x + it.w <= 1920.01 && it.y + it.h <= 600.01, JSON.stringify([it.ax.k, it.x, it.y, it.w, it.h]));
  });
});

test("relayout: an even scale keeps a photo's crop", () => {
  const d = AX.newDesign({ name: "x", w: 1000, h: 1000 }, 1);
  AX.addItem(d, d.pages[0].id, { k: "photo", a: "cd".repeat(32) + ".png", iw: 500, ih: 500, x: 400, y: 400, w: 200, h: 200, fit: "custom", ix: 20, iy: 30, isc: 2 }, 2);
  const r = RL.relayout(M.normDoc(d), 500, 500, {});
  const p = byK(r, "photo");
  assert.deepEqual([p.x, p.y, p.w, p.h, p.fit, p.ix, p.iy, p.isc], [200, 200, 100, 100, "custom", 10, 15, 1]);
  // and the result survives normalization
  assert.ok(M.normDoc(r));
});
