// Photo Lab wave 2B: filters (photolab/filters.js) and the retouch
// tools of photolab/paint.js (clone stamp, healing, dodge, burn,
// sponge, red-eye, smudge).
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const dir = (f) => path.join(__dirname, "..", f);
const F = require(dir("photolab/filters.js"));
const T = require(dir("photolab/tiles.js"));
const P = require(dir("photolab/paint.js"));

function img(w, h, f) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(f(x, y), (y * w + x) * 4);
  return { w, h, data };
}
const px = (im, x, y) => Array.from(im.data.slice((y * im.w + x) * 4, (y * im.w + x) * 4 + 4));
const flat = (c) => img(40, 30, () => c);

test("every filter keeps the size and leaves a flat colour flat (except the ones that draw)", () => {
  const a = flat([90, 140, 200, 255]);
  for (const id of F.IDS) {
    const r = F.run(a, id, {}, { x: 0, y: 0, cw: 40, ch: 30 });
    assert.equal(r.w, 40); assert.equal(r.h, 30); assert.equal(r.data.length, a.data.length);
    if (["gauss", "motion", "unsharp", "median", "pixelate", "lens"].includes(id)) {
      assert.deepEqual(px(r, 0, 0), [90, 140, 200, 255], id);
      assert.deepEqual(px(r, 20, 15), [90, 140, 200, 255], id);
    }
  }
  assert.throws(() => F.run(a, "nope", {}), /filter/);
});

test("blur spreads an edge and keeps transparent edges from going dark", () => {
  const a = img(40, 10, (x) => (x < 20 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
  const r = F.run(a, "gauss", { r: 3 });
  const p = px(r, 21, 5);
  assert.ok(p[3] > 0 && p[3] < 255, "alpha spreads");
  assert.equal(p[0], 255, "colour stays red (premultiplied)");
  assert.deepEqual(px(r, 0, 5), [255, 0, 0, 255]);
  // Gaussian ≈ three boxes; sizes grow with sigma
  assert.ok(F.boxSizes(10)[0] > F.boxSizes(2)[0]);
});

test("motion blur smears along the angle only", () => {
  const a = img(40, 40, (x, y) => (x === 20 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
  const h = F.run(a, "motion", { a: 0, d: 10 }), v = F.run(a, "motion", { a: 90, d: 10 });
  assert.ok(px(h, 23, 20)[0] > 0, "horizontal smear reaches the side");
  assert.equal(px(v, 23, 20)[0], 0, "vertical smear stays on the line");
  assert.ok(px(v, 20, 20)[0] > 200);
});

test("unsharp mask raises contrast at an edge, threshold protects small steps", () => {
  const a = img(30, 4, (x) => (x < 15 ? [100, 100, 100, 255] : [150, 150, 150, 255]));
  const r = F.run(a, "unsharp", { amt: 200, r: 2, th: 0 });
  assert.ok(px(r, 14, 1)[0] < 100 && px(r, 15, 1)[0] > 150);
  const kept = F.run(a, "unsharp", { amt: 200, r: 2, th: 255 });
  assert.deepEqual(px(kept, 14, 1), [100, 100, 100, 255]);
});

test("noise is seeded by canvas position: preview and result match, areas line up", () => {
  const a = flat([128, 128, 128, 255]);
  const r1 = F.run(a, "noise", { amt: 30, seed: 7 }, { x: 10, y: 5 }), r2 = F.run(a, "noise", { amt: 30, seed: 7 }, { x: 10, y: 5 });
  assert.deepEqual(r1.data, r2.data);
  const shifted = F.run(img(40, 30, () => [128, 128, 128, 255]), "noise", { amt: 30, seed: 7 }, { x: 11, y: 5 });
  assert.deepEqual(px(shifted, 0, 0), px(r1, 1, 0));
  const mono = F.run(a, "noise", { amt: 30, seed: 7, mono: true });
  const m = px(mono, 3, 3);
  assert.equal(m[0], m[1]); assert.equal(m[1], m[2]);
  assert.notDeepEqual(px(r1, 3, 3), [128, 128, 128, 255]);
});

test("reduce noise removes a lone speck", () => {
  const a = img(9, 9, (x, y) => (x === 4 && y === 4 ? [255, 255, 255, 255] : [20, 20, 20, 255]));
  assert.deepEqual(px(F.run(a, "median", { r: 1 }), 4, 4), [20, 20, 20, 255]);
});

test("pixelate uses a grid fixed to the canvas", () => {
  const a = img(20, 20, (x, y) => [x * 10, y * 10, 0, 255]);
  const r = F.run(a, "pixelate", { s: 10 }, { x: 5, y: 0 });
  // canvas x 5..9 is one cell (cells start at 0, 10, 20 on the canvas)
  assert.deepEqual(px(r, 0, 0), px(r, 4, 0));
  assert.notDeepEqual(px(r, 4, 0), px(r, 5, 0));
});

test("emboss is grey, find edges is white on flat areas, vignette darkens the corners", () => {
  const a = img(30, 30, (x) => (x < 15 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  const e = F.run(a, "emboss", { a: 0, h: 2 });
  const q = px(e, 3, 3);
  assert.equal(q[0], 128); assert.equal(q[1], 128);
  assert.notEqual(px(e, 15, 3)[0], 128);
  const ed = F.run(a, "edges", {});
  assert.deepEqual(px(ed, 3, 3), [255, 255, 255, 255]);
  assert.ok(px(ed, 15, 3)[0] < 128);
  const v = F.run(flat([200, 200, 200, 255]), "vignette", { amt: -100, size: 0 }, { x: 0, y: 0, cw: 40, ch: 30 });
  assert.ok(px(v, 0, 0)[0] < px(v, 20, 15)[0]);
  const l = F.run(flat([100, 100, 100, 255]), "vignette", { amt: 100, size: 0 }, { x: 0, y: 0, cw: 40, ch: 30 });
  assert.ok(px(l, 0, 0)[0] > 100);
});

test("reach and crop: the caller pads the area and crops it back", () => {
  assert.equal(F.reach("gauss", { r: 2 }), 6);
  assert.equal(F.reach("gauss", { r: 250 }), 300);
  assert.equal(F.reach("vignette", {}), 0);
  assert.equal(F.reach("motion", { d: 20 }), 11);
  const a = img(10, 8, (x, y) => [x, y, 0, 255]);
  const c = F.crop(a, 2, 3, 4, 2);
  assert.equal(c.w, 4); assert.equal(c.h, 2);
  assert.deepEqual(px(c, 0, 0), [2, 3, 0, 255]);
  assert.equal(F.crop(a, 0, 0, 10, 8), a);
});

test("filters clamp their parameters", () => {
  const a = flat([10, 20, 30, 255]);
  for (const id of F.IDS) {
    for (const p of [{ r: -5, d: 1e9, s: 0, amt: "x", h: NaN, a: 9999, size: -1 }, { r: 1e9, s: 1e9, amt: 1e9 }]) {
      const r = F.run(a, id, p, { x: 0, y: 0, cw: 40, ch: 30 });
      assert.equal(r.data.length, a.data.length, id);
    }
  }
});

// ---------- Retouch ----------
function layer() {
  const s = T.create();
  T.writeRect(s, 0, 0, img(512, 256, (x) => (x < 256 ? [200, 30, 30, 255] : [30, 30, 200, 255])));
  return s;
}
const at = (s, x, y) => Array.from(T.readRect(s, x, y, 1, 1).data);

test("clone stamp copies from the source offset and is one undoable step", () => {
  const s = layer();
  const st = P.retouch(T, s, { kind: "clone", size: 20, hard: 100, dx: 300, dy: 0 });
  st.dab(100, 100); st.lineTo(120, 100);
  const r = st.end();
  assert.deepEqual(at(s, 110, 100), [30, 30, 200, 255]);
  assert.deepEqual(at(s, 100, 130), [200, 30, 30, 255], "outside the brush stays");
  T.restore(s, r.before);
  assert.deepEqual(at(s, 110, 100), [200, 30, 30, 255]);
});

test("clone reads the layer as it was when the stroke began", () => {
  const s = layer();
  // source 10 px to the left of the target: a long stroke would copy
  // its own fresh paint if it sampled the current pixels.
  const st = P.retouch(T, s, { kind: "clone", size: 6, hard: 100, dx: -10, dy: 0 });
  st.dab(262, 50); st.lineTo(300, 50);
  st.end();
  assert.deepEqual(at(s, 263, 50), [200, 30, 30, 255]);
  assert.deepEqual(at(s, 299, 50), [30, 30, 200, 255], "beyond 10 px the source is still blue");
});

test("clone onto empty areas paints, from an empty source paints nothing", () => {
  const s = T.create();
  T.writeRect(s, 0, 0, img(20, 20, () => [0, 255, 0, 255]));
  let st = P.retouch(T, s, { kind: "clone", size: 8, hard: 100, dx: -290, dy: 0 });
  st.dab(300, 10); st.end();
  assert.deepEqual(at(s, 300, 10), [0, 255, 0, 255]);
  st = P.retouch(T, s, { kind: "clone", size: 8, hard: 100, dx: 500, dy: 0 });
  st.dab(10, 10); const r = st.end();
  assert.deepEqual(at(s, 10, 10), [0, 255, 0, 255]);
  assert.ok(Array.isArray(r.keys));
});

test("healing keeps the colour of the target and takes the texture of the source", () => {
  const s = T.create();
  // target: flat red; source: blue with a darker stripe
  T.writeRect(s, 0, 0, img(512, 64, (x, y) => (x < 256 ? [200, 40, 40, 255] : (y === 32 ? [10, 10, 150, 255] : [30, 30, 170, 255]))));
  const st = P.retouch(T, s, { kind: "heal", size: 30, hard: 100, dx: 300, dy: 0 });
  st.dab(60, 32); st.end();
  const a = at(s, 60, 31), b = at(s, 60, 32);
  assert.ok(Math.abs(a[0] - 200) < 3, "red stays red: " + a);
  assert.ok(b[0] < a[0] && b[2] < a[2], "the stripe comes along");
});

test("dodge lightens, burn darkens, by range; alpha is kept", () => {
  const s = T.create();
  T.writeRect(s, 0, 0, img(64, 64, () => [120, 120, 120, 128]));
  for (const [kind, sign] of [["dodge", 1], ["burn", -1]]) {
    const st = P.retouch(T, s, { kind, size: 20, hard: 100, strength: 50, range: "mid" });
    st.dab(30, 30); const r = st.end();
    const p = at(s, 30, 30);
    assert.ok(sign > 0 ? p[0] > 120 : p[0] < 120, kind);
    assert.equal(p[3], 128);
    T.restore(s, r.before);
  }
  // highlights range barely touches a dark pixel
  T.writeRect(s, 0, 0, img(64, 64, () => [20, 20, 20, 255]));
  const st = P.retouch(T, s, { kind: "dodge", size: 20, hard: 100, strength: 100, range: "high" });
  st.dab(30, 30); st.end();
  assert.ok(at(s, 30, 30)[0] < 30);
});

test("sponge takes colour away or adds it; red-eye only touches red", () => {
  const s = T.create();
  T.writeRect(s, 0, 0, img(64, 64, (x) => (x < 32 ? [200, 60, 60, 255] : [60, 120, 200, 255])));
  let st = P.retouch(T, s, { kind: "sponge", size: 10, hard: 100, strength: 100, sat: "down" });
  st.dab(10, 10); let r = st.end();
  const g = at(s, 10, 10);
  assert.ok(Math.abs(g[0] - g[1]) <= 1 && Math.abs(g[1] - g[2]) <= 1, "grey: " + g);
  T.restore(s, r.before);
  st = P.retouch(T, s, { kind: "sponge", size: 10, hard: 100, strength: 50, sat: "up" });
  st.dab(10, 10); st.end();
  assert.ok(at(s, 10, 10)[0] > 200);
  st = P.retouch(T, s, { kind: "redeye", size: 200, hard: 100, strength: 50 });
  st.dab(32, 32); st.end();
  const red = at(s, 20, 40), blue = at(s, 50, 40);
  assert.ok(red[0] < 100, "red is gone: " + red);
  assert.deepEqual(blue, [60, 120, 200, 255]);
});

test("smudge drags colour along the stroke and the before tiles undo it", () => {
  const s = layer();
  const st = P.retouch(T, s, { kind: "smudge", size: 20, hard: 100, strength: 80 });
  st.dab(250, 100); st.lineTo(290, 100);
  const r = st.end();
  assert.ok(at(s, 275, 100)[0] > 100, "red pulled into blue");
  T.restore(s, r.before);
  assert.deepEqual(at(s, 275, 100), [30, 30, 200, 255]);
});

test("retouch respects the selection mask", () => {
  const s = layer();
  const mask = { w: 512, h: 256, data: new Uint8Array(512 * 256) };
  for (let y = 0; y < 256; y++) for (let x = 0; x < 100; x++) mask.data[y * 512 + x] = 255;
  const st = P.retouch(T, s, { kind: "clone", size: 40, hard: 100, dx: 300, dy: 0, mask });
  st.dab(100, 100); st.end();
  assert.deepEqual(at(s, 95, 100), [30, 30, 200, 255]);
  assert.deepEqual(at(s, 105, 100), [200, 30, 30, 255]);
  assert.deepEqual(P.KINDS, ["clone", "heal", "dodge", "burn", "sponge", "redeye", "smudge"]);
});
