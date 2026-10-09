// designkit/fx.js: photo adjustments and filter presets, image
// placement and crop, shapes / frame masks, text effects, curved
// text and colour helpers.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const F = require(path.join(__dirname, "..", "designkit/fx.js"));

function img(w, h, fn) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = fn(x, y), i = (y * w + x) * 4;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3] == null ? 255 : c[3];
  }
  return d;
}
const px = (d, w, x, y) => Array.from(d.slice((y * w + x) * 4, (y * w + x) * 4 + 4));

// ---------- adjustments ----------

test("normAdjust: fixed keys, clamped integers, idempotent", () => {
  const n = F.normAdjust({ bright: 500, contrast: -7.6, sat: "20", fade: -3, junk: 1, blur: NaN });
  assert.deepEqual(Object.keys(n), F.ADJUST.map((a) => a.id));
  assert.equal(n.bright, 100);
  assert.equal(n.contrast, -8);
  assert.equal(n.sat, 20);
  assert.equal(n.fade, 0);
  assert.equal(n.blur, 0);
  assert.deepEqual(F.normAdjust(n), n);
  assert.ok(F.isIdentity({}));
  assert.ok(F.isIdentity(null));
  assert.ok(!F.isIdentity({ sepia: 1 }));
});

test("adjustPixels: identity leaves pixels alone; only blur touches alpha", () => {
  const d = img(4, 3, (x, y) => [x * 60, y * 80, 100, 128 + x]);
  const copy = d.slice();
  F.adjustPixels(d, 4, 3, {});
  assert.deepEqual(d, copy);
  F.adjustPixels(d, 4, 3, { bright: 40, contrast: 30, sat: -100, warmth: 20, tint: 20, fade: 30, sepia: 50, vignette: 80, sharpen: 50 });
  for (let i = 3; i < d.length; i += 4) assert.equal(d[i], copy[i]);
  // blur softens transparent edges too (a cut-out gets a soft rim)
  const cut = img(20, 1, (x) => [255, 0, 0, x < 10 ? 0 : 255]);
  F.adjustPixels(cut, 20, 1, { blur: 100 });
  assert.ok(cut[9 * 4 + 3] > 0 && cut[10 * 4 + 3] < 255);
});

test("adjustPixels: brightness, contrast, saturation, warmth, sepia behave", () => {
  const gray = () => img(1, 1, () => [100, 100, 100]);
  let d = gray(); F.adjustPixels(d, 1, 1, { bright: 50 }); assert.ok(d[0] > 100);
  d = gray(); F.adjustPixels(d, 1, 1, { bright: -50 }); assert.ok(d[0] < 100);
  d = img(2, 1, (x) => (x ? [200, 200, 200] : [60, 60, 60]));
  F.adjustPixels(d, 2, 1, { contrast: 60 });
  assert.ok(d[0] < 60 && d[4] > 200, "contrast pushes values apart");
  d = img(1, 1, () => [200, 50, 50]); F.adjustPixels(d, 1, 1, { sat: -100 });
  assert.ok(Math.abs(d[0] - d[1]) <= 1 && Math.abs(d[1] - d[2]) <= 1, "mono");
  d = gray(); F.adjustPixels(d, 1, 1, { warmth: 100 }); assert.ok(d[0] > d[2]);
  d = gray(); F.adjustPixels(d, 1, 1, { warmth: -100 }); assert.ok(d[0] < d[2]);
  d = gray(); F.adjustPixels(d, 1, 1, { sepia: 100 }); assert.ok(d[0] > d[1] && d[1] > d[2], "sepia is brown");
  d = img(1, 1, () => [0, 0, 0]); F.adjustPixels(d, 1, 1, { fade: 100 }); assert.ok(d[0] > 30, "fade lifts blacks");
});

test("adjustPixels: vignette darkens corners, blur softens an edge, sharpen hardens it", () => {
  const W = 21;
  let d = img(W, W, () => [200, 200, 200]);
  F.adjustPixels(d, W, W, { vignette: 100 });
  assert.equal(px(d, W, 10, 10)[0], 200, "centre untouched");
  assert.ok(px(d, W, 0, 0)[0] < 120, "corner darker");
  const edge = () => img(40, 40, (x) => (x < 20 ? [0, 0, 0] : [255, 255, 255]));
  d = edge(); F.adjustPixels(d, 40, 40, { blur: 100 });
  assert.ok(px(d, 40, 19, 20)[0] > 30 && px(d, 40, 20, 20)[0] < 225, "edge blurred");
  const soft = img(40, 1, (x) => [100 + x * 2, 100 + x * 2, 100 + x * 2]);
  soft[20 * 4] = soft[20 * 4 + 1] = soft[20 * 4 + 2] = 200;
  const before = soft[20 * 4] - soft[19 * 4];
  F.adjustPixels(soft, 40, 1, { sharpen: 100 });
  assert.ok(soft[20 * 4] - soft[19 * 4] > before, "a bump stands out more");
  assert.doesNotThrow(() => F.adjustPixels(new Uint8ClampedArray(4), 0, 0, { bright: 10 }));
});

test("filters: unique ids, bilingual names, 'none' is the identity", () => {
  const ids = F.FILTERS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(F.FILTERS.length >= 12);
  F.FILTERS.forEach((f) => {
    assert.ok(f.en && f.el, f.id);
    const p = F.filterById(f.id).p;
    assert.deepEqual(F.normAdjust(p), p);
    if (f.id !== "none") assert.ok(!F.isIdentity(p), f.id);
  });
  assert.ok(F.isIdentity(F.filterById("none").p));
  assert.equal(F.filterById("nope"), null);
});

// ---------- placement + crop ----------

test("fitRect: fit letterboxes, fill covers, stretch fills", () => {
  assert.deepEqual(F.fitRect(200, 100, 100, 100, "fit"), { x: 0, y: 25, w: 100, h: 50 });
  assert.deepEqual(F.fitRect(200, 100, 100, 100, "fill"), { x: -50, y: 0, w: 200, h: 100 });
  assert.deepEqual(F.fitRect(200, 100, 100, 100, "stretch"), { x: 0, y: 0, w: 100, h: 100 });
  assert.deepEqual(F.fitRect(0, 100, 100, 100, "fit"), { x: 0, y: 0, w: 0, h: 0 });
});

test("crop: clamped into the image, canonical, pixel rectangle", () => {
  assert.deepEqual(F.normCrop({}), { x: 0, y: 0, w: 1, h: 1 });
  assert.deepEqual(F.normCrop({ x: -1, y: 0.5, w: 2, h: 0.123456 }), { x: 0, y: 0.5, w: 1, h: 0.1235 });
  assert.deepEqual(F.normCrop({ x: 1, y: 1, w: 0, h: 0 }), { x: 0.99, y: 0.99, w: 0.01, h: 0.01 });
  const c = F.normCrop({ x: "a", w: null });
  assert.deepEqual(F.normCrop(c), c);
  assert.deepEqual(F.cropPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 }, 400, 200), { x: 100, y: 100, w: 200, h: 100 });
  assert.deepEqual(F.rotatedBounds(100, 50, 90), { w: 50, h: 100 });
  assert.deepEqual(F.rotatedBounds(100, 100, 45), { w: 141.421, h: 141.421 });
});

// ---------- shapes ----------

function coords(cmds) {
  const xs = [], ys = [];
  cmds.forEach((c) => { for (let i = 1; i < c.length; i += 2) { xs.push(c[i]); ys.push(c[i + 1]); } });
  return { xs, ys };
}

test("shapes: every shape is a closed path inside its box that reaches all four sides", () => {
  const ids = F.SHAPES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  F.SHAPES.forEach((s) => {
    assert.ok(s.en && s.el, s.id);
    const cmds = F.shapePath(s.id, 200, 100);
    assert.ok(cmds.length >= 4, s.id);
    assert.equal(cmds[0][0], "M", s.id);
    assert.deepEqual(cmds[cmds.length - 1], ["Z"], s.id);
    cmds.forEach((c) => assert.ok(/^[MLCZ]$/.test(c[0]) && c.slice(1).every(Number.isFinite), s.id));
    const { xs, ys } = coords(cmds);
    const eps = 1e-6;
    assert.ok(Math.min(...xs) >= -eps && Math.max(...xs) <= 200 + eps, s.id + " x in box");
    assert.ok(Math.min(...ys) >= -eps && Math.max(...ys) <= 100 + eps, s.id + " y in box");
    assert.ok(Math.min(...xs) < 1 && Math.max(...xs) > 199, s.id + " spans the width");
    assert.ok(Math.min(...ys) < 1 && Math.max(...ys) > 99, s.id + " spans the height");
  });
  assert.deepEqual(F.shapePath("nope", 10, 10), []);
  assert.deepEqual(F.shapePath("rect", 0, 10), []);
});

test("shapes: rounded corners stay round on a stretched box; SVG path text", () => {
  const sharp = F.shapePath("rounded", 300, 100, { round: 0 });
  assert.ok(!sharp.some((c) => c[0] === "C"));
  const r = F.shapePath("rounded", 300, 100, { round: 100 });
  assert.deepEqual(r[0], ["M", 50, 0], "radius = half the short side");
  assert.equal(F.toSvgPath(F.shapePath("triangle", 10, 20)), "M5 0L10 20L0 20Z");
  assert.equal(F.toSvgPath([["M", 0.004, -0.001], ["L", 1.23456, 2]]), "M0 0L1.23 2");
});

// ---------- text effects ----------

test("text effects: canonical record, passes end with the text itself", () => {
  const ids = F.TEXT_FX.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  ids.forEach((id) => {
    const fx = F.normTextFx({ type: id });
    assert.deepEqual(Object.keys(fx), ["type", "off", "dir", "blur", "alpha", "color", "thick", "pad", "round"]);
    assert.deepEqual(F.normTextFx(fx), fx);
    const passes = F.textPasses(fx, 40, "#336699");
    assert.ok(passes.length >= 1, id);
    passes.forEach((p) => {
      assert.ok(["fill", "stroke", "box"].includes(p.mode), id);
      assert.match(p.color, /^#[0-9a-f]{6}$/, id);
      assert.ok(p.alpha >= 0 && p.alpha <= 1, id);
      assert.ok([p.dx, p.dy, p.blur].every(Number.isFinite), id);
    });
    if (!["hollow", "splice", "neon"].includes(id)) assert.deepEqual(passes[passes.length - 1], { mode: "fill", dx: 0, dy: 0, blur: 0, color: "#336699", alpha: 1 }, id);
  });
  assert.equal(F.normTextFx({ type: "<b>" }).type, "none");
  assert.equal(F.normTextFx({ color: "red" }).color, "#000000");
  assert.equal(F.normTextFx({ color: "#ABC" }).color, "#aabbcc");
  assert.equal(F.textPasses({ type: "hollow" }, 40, "#ff0000")[0].mode, "stroke");
  const sh = F.textPasses({ type: "shadow", dir: 0, off: 100 }, 50, "#000")[0];
  assert.equal(sh.dx, 10);
  assert.equal(sh.dy, 0);
});

test("text effects: padding covers what the passes paint outside the glyphs", () => {
  assert.deepEqual(F.fxPad({ type: "none" }, 40), { l: 0, t: 0, r: 0, b: 0 });
  const p = F.fxPad({ type: "shadow", dir: 0, off: 100, blur: 0 }, 50);
  assert.equal(p.r, 10);
  assert.equal(p.l, 0);
  const b = F.fxPad({ type: "background", pad: 100 }, 20);
  assert.ok(b.l > 0 && b.t > 0 && b.l === b.r);
  F.TEXT_FX.forEach((f) => Object.values(F.fxPad({ type: f.id }, 30)).forEach((v) => assert.ok(v >= 0, f.id)));
});

test("curved text: straight at 0, symmetric, arches up for positive curve", () => {
  const glyphs = [0, 1, 2, 3, 4].map((i) => ({ x: i * 20, w: 20 }));
  assert.deepEqual(F.curveGlyphs(glyphs, 0).map((g) => [g.x, g.y, g.rot]), [[-40, 0, 0], [-20, 0, 0], [0, 0, 0], [20, 0, 0], [40, 0, 0]]);
  const up = F.curveGlyphs(glyphs, 50);
  assert.equal(up[2].y, 0);
  assert.equal(up[2].rot, 0);
  assert.ok(up[0].y > 0 && up[4].y > 0, "ends lower: a rainbow");
  assert.equal(up[0].y, up[4].y);
  assert.equal(up[0].x, -up[4].x);
  assert.ok(up[4].rot > 0 && up[0].rot < 0);
  const down = F.curveGlyphs(glyphs, -50);
  assert.ok(down[0].y < 0, "ends higher: a smile");
  // neighbouring glyphs keep (almost) their spacing along the arc
  const d = Math.hypot(up[3].x - up[2].x, up[3].y - up[2].y);
  assert.ok(d > 19 && d <= 20.01);
  const full = F.curveGlyphs(glyphs, 100);
  assert.ok(full.every((g) => Number.isFinite(g.x) && Number.isFinite(g.y)));
  assert.deepEqual(F.curveGlyphs([], 50), []);
  assert.deepEqual(F.curveGlyphs(null, 50), []);
});

// ---------- colour ----------

test("colour: normalisation, mixing, main colours of a picture", () => {
  assert.equal(F.normColor("#FFF"), "#ffffff");
  assert.equal(F.normColor(" a1b2c3 "), "#a1b2c3");
  assert.equal(F.normColor("rgb(1,2,3)"), "");
  assert.equal(F.mix("#000000", "#ffffff", 0.5), "#808080");
  const W = 50;
  const d = img(W, W, (x, y) => (y < 10 ? [0, 0, 0, 0] : x < 30 ? [20, 90, 200] : [240, 200, 10]));
  const pal = F.paletteOf(d, W, W, 5);
  assert.equal(pal.length, 2);
  assert.equal(pal[0], "#145ac8");
  assert.equal(pal[1], "#f0c80a");
  assert.deepEqual(F.paletteOf(d, W, W, 5), pal, "deterministic");
});
