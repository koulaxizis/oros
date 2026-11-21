// Photo Lab wave PS-5: Edit › Transform › Skew, Distort, Perspective
// and Warp, and Filter › Liquify (photolab/warp.js), and their wiring
// into the transform tool, the worker and the menus.
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const W = require("../photolab/warp.js");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const close = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, a + " ≈ " + b);

function solid(w, h, rgba) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set(rgba, i * 4);
  return { w, h, data: d };
}
function stripes(w, h) {                         // left half red, right half blue
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(x < w / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * w + x) * 4);
  return { w, h, data: d };
}
const px = (img, x, y) => [...img.data.slice((y * img.w + x) * 4, (y * img.w + x) * 4 + 4)];

test("homography: the unit square lands on the four corners, and back", () => {
  const q = [{ x: 10, y: 10 }, { x: 110, y: 20 }, { x: 100, y: 90 }, { x: 5, y: 80 }];
  const H = W.squareToQuad(q), Hi = W.invert3(H);
  [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], i) => {
    const p = W.apply3(H, u, v); close(p.x, q[i].x); close(p.y, q[i].y);
    const b = W.apply3(Hi, q[i].x, q[i].y); close(b.x, u); close(b.y, v);
  });
  assert.ok(W.convex(q));
  assert.ok(!W.convex([q[0], q[2], q[1], q[3]]), "a bow tie is refused");
});

test("perspective: an untouched rect is the picture; a keystone keeps the left on the left", () => {
  const img = stripes(20, 20);
  const same = W.perspective(img, [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], 20, 20);
  assert.deepEqual(px(same, 3, 10), [255, 0, 0, 255]);
  assert.deepEqual(px(same, 16, 10), [0, 0, 255, 255]);
  const k = W.perspective(img, [{ x: 10, y: 0 }, { x: 30, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }], 40, 20);
  assert.equal(px(k, 2, 1)[3], 0, "outside the keystone stays empty");
  assert.deepEqual(px(k, 5, 18), [255, 0, 0, 255]);
  assert.deepEqual(px(k, 35, 18), [0, 0, 255, 255]);
  // a bow tie draws nothing rather than a broken picture
  assert.ok(W.perspective(img, [{ x: 0, y: 0 }, { x: 20, y: 20 }, { x: 20, y: 0 }, { x: 0, y: 20 }], 20, 20).data.every((v) => v === 0));
});

test("warp: a flat mesh is the picture; moving the corner carries its handles", () => {
  const img = stripes(24, 24);
  const m = W.meshOfQuad([{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 24 }, { x: 0, y: 24 }]);
  assert.equal(m.length, 16);
  close(m[5].x, 8); close(m[5].y, 8);
  const p = W.patchAt(m, 0.5, 0.25); close(p.x, 12); close(p.y, 6);
  const out = W.warp(img, m, 24, 24, 12);
  for (const [x, y] of [[2, 2], [8, 20], [15, 3], [21, 21]]) assert.deepEqual(px(out, x, y), px(img, x, y), x + "," + y);
  // bend: pull the middle-top handles up out of the frame → the top edge bulges up
  const bent = m.map((c) => ({ ...c }));
  bent[1].y = -12; bent[2].y = -12;
  const grid = W.patchGrid(bent, 8);
  assert.ok(grid[4].y < -5, "the top edge's middle rises: " + grid[4].y);
  close(grid[0].y, 0); close(grid[8].y, 0);      // its ends stay
  const tf = read("photolab/tools.js");
  assert.match(tf, /MESH_CARRY = \{ 0: \[1, 4, 5\], 3: \[2, 7, 6\], 12: \[8, 13, 9\], 15: \[11, 14, 10\] \}/);
});

test("liquify: an empty field changes nothing; push moves the picture the way of the brush", () => {
  const img = stripes(40, 20), f = W.field(40, 20);
  assert.equal(f.k, 1);
  assert.ok(!W.moved(f));
  assert.deepEqual([...W.liquify(img, f).data], [...img.data]);
  // push right at the border: red comes into the blue side
  for (let i = 0; i < 6; i++) W.dab(f, "push", 20 + i, 10, 8, 1, 1, 0);
  assert.ok(W.moved(f));
  const out = W.liquify(img, f);
  assert.ok(px(out, 22, 10)[0] > 200, "red pushed right: " + px(out, 22, 10));
  assert.deepEqual(px(out, 2, 2), [255, 0, 0, 255], "far away nothing moves");
  // reconstruct with full strength undoes it under the brush
  for (let i = 0; i < 6; i++) W.dab(f, "reconstruct", 23, 10, 12, 1);
  assert.deepEqual(px(W.liquify(img, f), 22, 10), [0, 0, 255, 255]);
});

test("liquify: pucker pulls in, bloat pushes out, twirl turns; big pictures get a coarser field", () => {
  const ring = solid(41, 41, [0, 0, 0, 0]);
  for (let y = 0; y < 41; y++) for (let x = 0; x < 41; x++) if (Math.hypot(x - 20, y - 20) < 6) ring.data.set([0, 200, 0, 255], (y * 41 + x) * 4);
  const count = (img) => { let n = 0; for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 128) n++; return n; };
  const n0 = count(ring);
  const fp = W.field(41, 41); for (let i = 0; i < 4; i++) W.dab(fp, "pucker", 20.5, 20.5, 16, 1);
  const fb = W.field(41, 41); for (let i = 0; i < 4; i++) W.dab(fb, "bloat", 20.5, 20.5, 16, 1);
  assert.ok(count(W.liquify(ring, fp)) < n0, "pucker shrinks");
  assert.ok(count(W.liquify(ring, fb)) > n0, "bloat grows");
  const ft = W.field(41, 41); W.dab(ft, "twirl", 20, 20, 10, 1);
  const D = W.at(ft, 25, 20, [0, 0]);
  assert.ok(Math.abs(D[1]) > Math.abs(D[0]), "a twirl moves sideways to the radius");
  const big = W.field(4000, 3000);
  assert.ok(big.w * big.h <= W.FIELD_MAX && big.k < 1);
  // a preview half the size reads the same field
  const half = W.liquify(solid(20, 10, [9, 9, 9, 255]), W.field(40, 20));
  assert.equal(half.w, 20);
});

test("wiring: modes in the transform tool, jobs in the worker, menus, strings EN, EL, DE", () => {
  const tl = read("photolab/tools.js"), wk = read("photolab/worker.js"), jb = read("photolab/jobs.js"), pn = read("photolab/panels.js");
  assert.match(tl, /var TF_MODES = \["free", "skew", "distort", "perspective", "warp"\];/);
  ["quadDrag(", "W.convex(nq)", 'job = "meshWarp"', 'job = "perspective"', "setTransformMode(e.shiftKey && e.altKey ?"].forEach((s) => assert.ok(tl.includes(s), s));
  assert.match(wk, /importScripts\("select\.js", "resample\.js", "warp\.js"/);
  ["perspective", "meshWarp", "liquify"].forEach((op) => {
    assert.ok(wk.includes('case "' + op + '"'), "worker " + op);
    assert.ok(jb.includes('case "' + op + '"'), "jobs " + op);
  });
  ['{ id: "liquify", k: "Ctrl+Shift+X", run: liquifyDialog', 'startTransform("skew")', 'startTransform("distort")',
   'startTransform("perspective")', 'startTransform("warp")', "function liquifyDialog"].forEach((s) => assert.ok(pn.includes(s), s));
  const H = read("photolab/index.html");
  assert.ok(H.indexOf('src="warp.js') > H.indexOf('src="resample.js'));
  global.window = {};
  require(path.join(__dirname, "..", "photolab/strings.js"));
  const S = global.window.PL_STRINGS, DE = read("i18n/de/photolab.js");
  delete global.window;
  ["menu.tfSkew", "menu.tfDistort", "menu.tfPerspective", "menu.tfWarp", "f.tfMode", "tf.free", "tf.skew", "tf.distort", "tf.perspective",
   "tf.warp", "hint.distort", "hint.warp", "msg.tfRaster", "msg.tfKept", "step.distort", "step.warp", "menu.liquify", "dlg.liquify",
   "f.lqTool", "lq.push", "lq.twirlCw", "lq.twirlCcw", "lq.pucker", "lq.bloat", "lq.reconstruct", "f.pressure", "btn.restoreAll",
   "hint.liquify", "step.liquify"].forEach((k) => {
    assert.ok(S.en[k] && S.el[k], k + " EN + EL");
    assert.ok(DE.includes('"' + k + '"'), k + " DE");
  });
});
