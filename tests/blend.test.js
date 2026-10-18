// Blend (wave C1): designkit/blend.js (the morph between two
// outlines), atelier/blend.js and layout/blend.js (the steps as plain
// shapes, Update, Release), and Atelier's own outlines (ext.pth) in
// the renderers.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "designkit/blend.js"));
const FX = require(path.join(ROOT, "designkit/fx.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const AX = require(path.join(ROOT, "atelier/ax.js"));
const AB = require(path.join(ROOT, "atelier/blend.js"));
const LB = require(path.join(ROOT, "layout/blend.js"));

const unit = (id) => B.toUnit(FX.shapePath(id, 100, 100, { round: 30 }), 100, 100);
const close = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-3);
// the anchors (end points) of every segment of a command list
const anchors = (cmds) => cmds.filter((c) => c[0] !== "Z").map((c) => c.slice(-2));
// does point p lie on one of the outline's anchors?
function onOutline(p, cmds) { return anchors(cmds).some((q) => close(p[0], q[0], 2e-3) && close(p[1], q[1], 2e-3)); }

// ---------- designkit/blend.js ----------

test("morph: both ends get the same number of segments, at least 4", () => {
  [["rect", "star"], ["circle", "triangle"], ["heart", "cross"], ["rect", "rect"]].forEach(([a, b]) => {
    const p = B.prepare(unit(a), unit(b));
    assert.equal(p.pairs.length, 1);
    assert.equal(p.pairs[0][0].segs.length, p.pairs[0][1].segs.length, a + "→" + b);
    assert.ok(p.pairs[0][0].segs.length >= 4);
  });
});

test("morph: t = 0 and t = 1 trace the two outlines", () => {
  const a = unit("rect"), b = unit("star"), p = B.prepare(a, b);
  const s0 = B.at(p, 0), s1 = B.at(p, 1);
  anchors(a).forEach((q) => assert.ok(onOutline(q, s0), "corner of A kept " + q));
  anchors(b).forEach((q) => assert.ok(onOutline(q, s1), "point of B kept " + q));
  assert.equal(s0[0][0], "M");
  assert.equal(s0[s0.length - 1][0], "Z");
  // the middle step lies between the two
  const mid = B.at(p, 0.5);
  assert.equal(mid.length, s0.length);
  mid.forEach((c) => c.slice(1).forEach((v) => assert.ok(v >= -0.01 && v <= 1.01)));
});

test("morph: straight sides stay lines, curves stay curves", () => {
  const poly = B.at(B.prepare(unit("rect"), unit("hexagon")), 0.5);
  assert.ok(poly.every((c) => c[0] !== "C"), "two polygons blend as lines");
  const curved = B.at(B.prepare(unit("rect"), unit("circle")), 0.5);
  assert.ok(curved.some((c) => c[0] === "C"));
  // text form parses back (designkit path items, ext.pth)
  assert.ok(M.parsePath(M.pathText(curved)));
});

test("morph: B turns the same way and starts near A's start", () => {
  // the same square, drawn the other way round from another corner
  const a = unit("rect"), rev = [["M", 0, 1], ["L", 1, 1], ["L", 1, 0], ["L", 0, 0], ["Z"]];
  const p = B.prepare(a, rev);
  B.at(p, 0.5).forEach((c) => {
    // the same square at both ends: every step is that square
    if (c[0] === "M" || c[0] === "L") {
      const [x, y] = c.slice(1);
      assert.ok((close(x, 0) || close(x, 1) || close(y, 0) || close(y, 1)) && x >= -1e-3 && x <= 1.001 && y >= -1e-3 && y <= 1.001, "on the square " + JSON.stringify(c));
    }
  });
});

test("morph: an extra subpath grows from its middle", () => {
  const two = [["M", 0, 0], ["L", 0.4, 0], ["L", 0.4, 0.4], ["Z"], ["M", 0.6, 0.6], ["L", 1, 0.6], ["L", 1, 1], ["Z"]];
  const p = B.prepare(unit("rect"), two);
  assert.equal(p.pairs.length, 2);
  const s0 = B.at(p, 0);
  const second = s0.slice(s0.findIndex((c, i) => i > 0 && c[0] === "M"));
  second.filter((c) => c[0] !== "Z").forEach((c) => {
    assert.ok(close(c[c.length - 2], 0.8667, 1e-3) && close(c[c.length - 1], 0.7333, 1e-3), "a dot at the middle " + c);
  });
});

test("steps, angle, colours", () => {
  assert.deepEqual(B.steps(3), [0.25, 0.5, 0.75]);
  assert.deepEqual(B.steps(1), [0.5]);
  assert.equal(B.angle(350, 10, 0.5), 0);
  assert.equal(B.angle(10, 350, 0.5), 0);
  assert.equal(B.angle(0, 90, 0.5), 45);
  assert.equal(B.angle(170, -170, 0.5), 180);
  assert.equal(B.hex("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(B.hex("#ff0000", "#0000ff", 0), "#ff0000");
  assert.equal(B.hex("", "#0000ff", 0.3), "#0000ff");
  assert.deepEqual(B.mixVals([0, 100], [100, 0], 0.25), [25, 75]);
});

// ---------- atelier/blend.js ----------

function design() {
  const d = AX.newDesign({ name: "Blend", w: 1000, h: 1000, bg: "#ffffff" }, 1000);
  const pg = d.pages[0].id;
  const a = AX.addItem(d, pg, { k: "shape", shp: "rect", fc: "#ff0000", x: 0, y: 0, w: 100, h: 100 }, 1000);
  const b = AX.addItem(d, pg, { k: "shape", shp: "star", fc: "#0000ff", sc: "#000000", x: 800, y: 400, w: 200, h: 200, rot: 90, op: 50 }, 1000);
  b.sw = 4;
  return { d: M.normDoc(d), a: a.id, b: b.id, pg };
}
const steps = (d, g) => AB.members(d, g).sort((x, y) => x.ext.bl.i - y.ext.bl.i);

test("atelier: n plain shapes between the ends, values in even steps", () => {
  let { d, a, b } = design();
  const res = AB.make(d, a, b, 3, 2000);
  d = M.normDoc(d);
  assert.equal(res.ids.length, 3);
  const s = steps(d, res.g);
  assert.deepEqual(s.map((it) => it.x), [200, 400, 600]);
  assert.deepEqual(s.map((it) => it.w), [125, 150, 175]);
  assert.deepEqual(s.map((it) => it.rot), [22.5, 45, 67.5]);
  assert.deepEqual(s.map((it) => it.op), [88, 75, 63]);
  assert.deepEqual(s.map((it) => it.sw), [1, 2, 3]);
  assert.deepEqual(s.map((it) => it.ax.fc), ["#bf0040", "#800080", "#4000bf"]);
  assert.ok(s.every((it) => it.ax.sc === "#000000"));
  // z: strictly between A and B, in order
  const za = M.find(d.items, a).z, zb = M.find(d.items, b).z;
  s.forEach((it, i) => { assert.ok(it.z > za && it.z < zb); if (i) assert.ok(it.z > s[i - 1].z); });
  // shp: the nearer end's (what an older copy draws); own outline in ext.pth
  assert.deepEqual(s.map((it) => it.ax.shp), ["rect", "star", "star"]);
  s.forEach((it, i) => {
    assert.deepEqual(it.ext.bl, { a, b, g: res.g, i: i + 1, n: 3 });
    assert.ok(AX.pthOf(it), "own outline");
    assert.ok(JSON.stringify(it.ext).length <= 8192);
  });
  // the ends are not changed
  assert.equal(M.find(d.items, a).m, 1000);
  assert.equal(M.find(d.items, b).m, 1000);
});

test("atelier: the same shape keeps shp and blends the roundness, no own outline", () => {
  let d = AX.newDesign({ name: "R", w: 500, h: 500, bg: "#ffffff" }, 1000);
  const pg = d.pages[0].id;
  const a = AX.addItem(d, pg, { k: "shape", shp: "rounded", rd: 0, fc: "#000000", x: 0, y: 0, w: 50, h: 50 }, 1000);
  const b = AX.addItem(d, pg, { k: "shape", shp: "rounded", rd: 100, g: { a: "#ff0000", b: "#00ff00", ang: 0 }, x: 400, y: 0, w: 50, h: 50 }, 1000);
  const res = AB.make(d, a.id, b.id, 1, 2000);
  d = M.normDoc(d);
  const it = M.find(d.items, res.ids[0]);
  assert.equal(it.ax.shp, "rounded");
  assert.equal(it.ax.rd, 50);
  assert.equal(AX.pthOf(it), null);
  // a plain fill blends into the gradient as a two-colour gradient
  assert.deepEqual(it.ax.g, { a: "#800000", b: "#008000", ang: 45 });
});

test("atelier: Update re-makes from the ends as they are now, keeping the step ids", () => {
  let { d, a, b } = design();
  const res = AB.make(d, a, b, 4, 2000);
  d = M.normDoc(d);
  const ids = steps(d, res.g).map((it) => it.id);
  M.find(d.items, b).x = 400;
  let u = AB.update(d, res.g, null, 3000);
  d = M.normDoc(d);
  assert.deepEqual(u.ids, ids, "same ids, same order");
  assert.deepEqual(steps(d, res.g).map((it) => it.x), [80, 160, 240, 320]);
  assert.ok(steps(d, res.g).every((it) => it.m >= 3000));
  // fewer steps: the extra ones are removed with a tombstone
  u = AB.update(d, res.g, 2, 4000);
  d = M.normDoc(d);
  assert.deepEqual(u.ids, ids.slice(0, 2));
  assert.equal(d.tombs[ids[3]], 4000);
  assert.equal(M.find(d.items, ids[3]), null);
  // more again: new ids for the new ones
  u = AB.update(d, res.g, 5, 5000);
  d = M.normDoc(d);
  assert.equal(u.ids.length, 5);
  assert.deepEqual(u.ids.slice(0, 2), ids.slice(0, 2));
});

test("atelier: Release leaves plain shapes; a lost end stops Update", () => {
  let { d, a, b } = design();
  const res = AB.make(d, a, b, 2, 2000);
  d = M.normDoc(d);
  d.items = d.items.filter((it) => it.id !== b);
  assert.equal(AB.ends(d, res.g), null);
  assert.equal(AB.update(d, res.g, 3, 3000), null);
  assert.equal(AB.release(d, res.g, 3000), 2);
  d = M.normDoc(d);
  assert.equal(AB.members(d, res.g).length, 0);
  res.ids.forEach((id) => {
    const it = M.find(d.items, id);
    assert.ok(it && !it.ext.bl && it.ext.pth, "outline kept, link gone");
  });
});

test("atelier: no blend of a background, a photo or one shape with itself", () => {
  const { d, a } = design();
  const bg = AX.background(d, d.pages[0].id);
  assert.equal(AB.canBlend(M.find(d.items, a), bg), false);
  assert.equal(AB.canBlend(M.find(d.items, a), M.find(d.items, a)), false);
  assert.equal(AB.make(d, a, a, 3, 2000), null);
  assert.equal(AB.steps(0), 1);
  assert.equal(AB.steps(500), 50);
});

test("atelier: z gap too small makes room above", () => {
  let { d, a, b } = design();
  M.find(d.items, b).z = M.find(d.items, a).z;
  const res = AB.make(d, a, b, 5, 2000);
  d = M.normDoc(d);
  const za = M.find(d.items, a).z, zb = M.find(d.items, b).z;
  assert.ok(zb > za);
  steps(d, res.g).forEach((it) => assert.ok(it.z > za && it.z < zb));
  assert.equal(new Set(d.items.map((it) => it.z)).size, d.items.length, "no two items share a z");
});

test("atelier: an own outline is what every renderer draws", () => {
  let { d, a, b } = design();
  const res = AB.make(d, a, b, 1, 2000);
  d = M.normDoc(d);
  const it = M.find(d.items, res.ids[0]);
  const own = AX.shapeCmds(it), lib = FX.shapePath(it.ax.shp, it.w, it.h, { round: 30 });
  assert.notDeepEqual(own, lib);
  // scaled to the box
  own.filter((c) => c[0] !== "Z").forEach((c) => {
    assert.ok(c[c.length - 2] >= -1 && c[c.length - 2] <= it.w + 1);
    assert.ok(c[c.length - 1] >= -1 && c[c.length - 1] <= it.h + 1);
  });
  // a broken ext.pth falls back to the library shape
  const bad = JSON.parse(JSON.stringify(it));
  bad.ext.pth = "Q0 0";
  assert.deepEqual(AX.shapeCmds(bad), lib);
  // a long outline comes in chunks normX keeps
  const long = JSON.parse(JSON.stringify(it));
  const txt = M.pathText(own.map((c) => [c[0]].concat(c.slice(1).map((v, i) => v / (i % 2 ? it.h : it.w)))));
  long.ext = { pth: [txt.slice(0, 50), txt.slice(50)] };
  const n = M.normItem(long);
  assert.deepEqual(n.ext.pth, long.ext.pth);
  assert.equal(AX.shapeCmds(n).length, own.length);
});

test("atelier: the web page and the .pptx draw a step's own outline", async () => {
  const W = require(path.join(ROOT, "atelier/webout.js"));
  const O = require(path.join(ROOT, "atelier/pptxout.js"));
  const Z = require(path.join(ROOT, "atelier/zip.js"));
  let { d, a, b } = design();
  const res = AB.make(d, a, b, 1, 2000);
  d = M.normDoc(d);
  const it = M.find(d.items, res.ids[0]);
  const page = Buffer.from(W.build(d, {}, {}).files.find((f) => f.name === "index.html").data).toString("utf8");
  assert.ok(page.includes(FX.toSvgPath(AX.shapeCmds(it))), "web page: the morphed outline");
  const zip = Z.open(O.build(d, {}).bytes);
  const slide = await zip.text("ppt/slides/slide1.xml");
  // the circle-to-star step is custom geometry with as many points as its outline
  assert.ok(slide.includes("<a:custGeom>"));
  const own = AX.shapeCmds(it).filter((c) => c[0] === "L" || c[0] === "C").length;
  assert.ok((slide.match(/<a:(lnTo|cubicBezTo)>/g) || []).length >= own);
});

// ---------- layout/blend.js ----------

function ldoc() {
  const d = M.newDoc({ name: "L" }, 1000);
  const pg = d.pages[0].id;
  d.items.push(M.normItem({ id: "it-aaaaaaaaaaaa", m: 1000, t: "rect", pg, x: 0, y: 0, w: 50, h: 50, fill: "sw-red", stroke: "sw-black", sw: 2, z: 1 }));
  d.items.push(M.normItem({ id: "it-bbbbbbbbbbbb", m: 1000, t: "ell", pg, x: 300, y: 0, w: 100, h: 100, fill: "sw-blue", stroke: "sw-black", sw: 2, z: 2 }));
  return M.normDoc(d);
}

test("layout: different shapes become path items with mixed CMYK swatches", () => {
  let d = ldoc();
  const before = d.swatches.length;
  const res = LB.make(d, "it-aaaaaaaaaaaa", "it-bbbbbbbbbbbb", 3, 2000);
  d = M.normDoc(d);
  const s = LB.members(d, res.g).sort((x, y) => x.ext.bl.i - y.ext.bl.i);
  assert.equal(s.length, 3);
  assert.ok(s.every((it) => it.t === "path" && M.parsePath(it.d)));
  assert.deepEqual(s.map((it) => it.x), [75, 150, 225]);
  assert.ok(s.every((it) => it.stroke === "sw-black"), "same swatch on both ends is reused");
  assert.equal(d.swatches.length, before + 3);
  const mid = M.find(d.swatches, s[1].fill);
  assert.equal(mid.mode, "cmyk");
  assert.deepEqual(mid.v, [50, 75, 42.5, 0]);
  assert.equal(mid.ext.bl, res.g);
});

test("layout: two rectangles stay rectangles, RGB when an end is RGB", () => {
  let d = ldoc();
  const b = M.find(d.items, "it-bbbbbbbbbbbb");
  b.t = "rect"; b.r = 20; b.fill = "sw-paper";
  d = M.normDoc(d);
  const res = LB.make(d, "it-aaaaaaaaaaaa", "it-bbbbbbbbbbbb", 1, 2000);
  d = M.normDoc(d);
  const it = M.find(d.items, res.ids[0]);
  assert.equal(it.t, "rect");
  assert.equal(it.r, 10);
  const sw = M.find(d.swatches, it.fill);
  assert.equal(sw.mode, "rgb");
  assert.deepEqual(sw.v, [255, 140, 147]);   // red (CMYK 0 90 85 0 on screen: 255 25 38) halfway to white
});

test("layout: Update tidies swatches, Release keeps them as ordinary swatches", () => {
  let d = ldoc();
  const base = d.swatches.length;
  const res = LB.make(d, "it-aaaaaaaaaaaa", "it-bbbbbbbbbbbb", 4, 2000);
  d = M.normDoc(d);
  const ids = res.ids.slice();
  assert.equal(d.swatches.length, base + 4);
  const u = LB.update(d, res.g, 1, 3000);
  d = M.normDoc(d);
  assert.deepEqual(u.ids, ids.slice(0, 1));
  assert.equal(d.swatches.length, base + 1, "unused blend swatches removed");
  assert.ok(Object.keys(d.tombs).length >= 3 + 3);
  assert.equal(LB.release(d, res.g, 4000), 1);
  d = M.normDoc(d);
  assert.equal(LB.members(d, res.g).length, 0);
  assert.ok(d.swatches.every((s) => !s.ext || !s.ext.bl));
  assert.equal(d.swatches.length, base + 1);
  // a pasted copy of a step is plain
  const copy = LB.unlink({ ext: { bl: { g: "x" } } });
  assert.equal(copy.ext, undefined);
});

test("layout: no blend of text, images, lines or locked objects", () => {
  const d = ldoc();
  const a = M.find(d.items, "it-aaaaaaaaaaaa");
  assert.equal(LB.canBlend(a, Object.assign({}, a, { id: "it-cccccccccccc", t: "line" })), false);
  assert.equal(LB.canBlend(a, Object.assign({}, a, { id: "it-cccccccccccc", t: "img" })), false);
  assert.equal(LB.canBlend(a, Object.assign({}, a, { id: "it-cccccccccccc", lock: 1 })), false);
  assert.equal(LB.canBlend(a, Object.assign({}, a, { id: "it-cccccccccccc", pg: "pg-other" })), false);
  assert.equal(LB.canBlend(a, Object.assign({}, a, { id: "it-cccccccccccc" })), true);
});
