// Photo Lab wave 2D: rulers, guides, grid and snapping
// (photolab/guides.js), guides / saved selections / back link in the
// document (photolab/core.js), quick selection and colour range
// (photolab/select.js).
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const dir = (f) => path.join(__dirname, "..", f);
const G = require(dir("photolab/guides.js"));
const C = require(dir("photolab/core.js"));
const S = require(dir("photolab/select.js"));

test("guides: ruler ticks get coarser as you zoom out", () => {
  const near = G.tickStep(4), mid = G.tickStep(1), far = G.tickStep(0.05);
  assert.ok(near.major < mid.major && mid.major < far.major);
  for (const z of [0.02, 0.1, 0.33, 1, 2.5, 16]) {
    const s = G.tickStep(z);
    assert.ok(s.major * z >= 64 || s.major === 5000, "labels do not crowd at " + z);
    assert.equal(s.major % s.minor, 0);
  }
});

test("guides: snapping to guides, edges, centre and grid, within the tolerance only", () => {
  const doc = { w: 1000, h: 600, gd: { x: [333], y: [100] } };
  const t = G.targets(doc, { grid: 0 });
  assert.deepEqual(G.snapPoint({ x: 330, y: 104 }, t, 5), { x: 333, y: 100, sx: 333, sy: 100 });
  assert.deepEqual(G.snapPoint({ x: 320, y: 290 }, t, 5), { x: 320, y: 290, sx: null, sy: null });
  assert.equal(G.snap1(497, t.x, 5), 500);                 // canvas centre
  assert.equal(G.snap1(998, t.x, 5), 1000);                // canvas edge
  assert.ok(G.targets(doc, { guides: false }).x.indexOf(333) < 0);
  const tg = G.targets(doc, { grid: 50 });
  assert.equal(G.snap1(148, tg.x, 5), 150);
  // A rect snaps by its nearest edge or centre, without resizing.
  const r = G.snapRect({ x: 336, y: 10, w: 100, h: 50 }, t, 5);
  assert.equal(r.x, 333); assert.equal(r.w, 100); assert.equal(r.dx, -3);
  const c = G.snapRect({ x: 448, y: 270, w: 100, h: 60 }, t, 5);
  assert.equal(c.x + c.w / 2, 500); assert.equal(c.y + c.h / 2, 300);
  // A huge grid count is ignored rather than listed.
  assert.equal(G.targets({ w: 8000, h: 8000 }, { grid: 2 }).x.length, 3);
});

test("core: guides, saved selections and the back link are cleaned", () => {
  const d = C.normDoc({ id: "pproj01", m: 1, w: 100, h: 100, layers: [{ id: "llay1", k: "raster" }],
    gd: { x: [5, 5.4, "a", 3, 1e9], y: [] },
    sels: [{ id: "lsel1", name: "A", t: {}, x: 3, y: -2 }, { id: "llay1" }, { id: "lsel1" }, { id: "../x" }],
    bk: { app: "atelier", key: "doc1:el2" } });
  assert.deepEqual(d.gd, { x: [3, 5], y: [] });
  assert.deepEqual(d.sels, [{ id: "lsel1", name: "A", t: {}, x: 3, y: -2 }]);
  assert.deepEqual(d.bk, { app: "atelier", key: "doc1:el2" });
  assert.deepEqual(C.tileOwners(d).map((o) => o.id), ["llay1", "lsel1"]);
  const bare = C.normDoc({ id: "pproj01", m: 1, w: 10, h: 10, layers: [], gd: { x: [], y: [] }, sels: [], bk: { app: "Atelier!", key: "k" } });
  assert.equal(bare.gd, undefined); assert.equal(bare.sels, undefined); assert.equal(bare.bk, undefined);
  assert.equal(C.normBack({ app: "atelier", key: "a\u0000b" }), null);
  assert.equal(C.normBack({ app: "atelier", key: "x".repeat(201) }), null);
  assert.equal(C.normBack({ app: "atelier" }), null);
});

function twoTone() {
  const w = 120, h = 60, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (x < 60) { data[i] = 240; data[i + 1] = 40; data[i + 2] = 40; }
    else { data[i] = 20; data[i + 1] = 20; data[i + 2] = 200; }
    data[i + 3] = 255;
  }
  return { w, h, data };
}

test("select: quick selection stops at colour edges and stays near the brush", () => {
  const img = twoTone();
  const m = S.quickGrow(img, null, 30, 30, 4, 40);
  assert.equal(m.data[30 * 120 + 30], 255);
  assert.equal(m.data[30 * 120 + 50], 255);
  assert.equal(m.data[30 * 120 + 56], 0, "only 3 brush radii (min 24 px) from the dab");
  assert.equal(m.data[30 * 120 + 60], 0, "the blue half is not taken");
  // Dabs add up.
  S.quickGrow(img, m, 80, 30, 4, 40);
  assert.equal(m.data[30 * 120 + 80], 255);
  // Inside a big flat area the growth stays within a few brush radii.
  const big = { w: 400, h: 400, data: new Uint8ClampedArray(400 * 400 * 4).fill(255) };
  const q = S.quickGrow(big, null, 200, 200, 5, 20);
  assert.equal(q.data[200 * 400 + 200], 255);
  assert.equal(q.data[200 * 400 + 300], 0);
  assert.equal(S.quickGrow(img, null, -5, 5, 4, 40).data.every((v) => v === 0), true);
});

test("select: colour range is full near the colour and fades out", () => {
  const img = twoTone();
  const m = S.colorRange(img, [240, 40, 40], 20);
  assert.equal(m.data[0], 255);
  assert.equal(m.data[100], 0);
  const soft = S.colorRange({ w: 1, h: 1, data: new Uint8ClampedArray([230, 40, 40, 255]) }, [200, 40, 40], 20);
  assert.ok(soft.data[0] > 0 && soft.data[0] < 255);
  const clear = S.colorRange({ w: 1, h: 1, data: new Uint8ClampedArray([200, 40, 40, 0]) }, [200, 40, 40], 20);
  assert.equal(clear.data[0], 0);
});
