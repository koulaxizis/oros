// Vector tools, wave V2: designkit/boolean.js (combine shapes and
// outline stroke over polygon-clipping, fitted back to curves).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const V = require(path.join(ROOT, "designkit/vector.js"));
const B = require(path.join(ROOT, "designkit/boolean.js"));

function moved(cmds, x, y) {
  return cmds.map((c) => { const o = [c[0]]; for (let i = 1; i < c.length; i += 2) o.push(c[i] + x, c[i + 1] + y); return o; });
}
const sq = (x, y, w, h) => V.fromCmds(moved(V.rectCmds(w, h, 0), x, y));
const el = (x, y, w, h) => V.fromCmds(moved(V.ellCmds(w, h), x, y));
// the filled area under the nonzero rule (signed rings added up)
function area(paths) {
  let a = 0;
  B.flatten(paths, 0.01).forEach((r) => {
    const p = r.p;
    for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
  });
  return Math.abs(a / 2);
}
const near = (a, b, rel) => Math.abs(a - b) <= Math.abs(b) * rel;

const SQ = 10000, QUARTER = Math.PI * 50 * 50 / 4, CIRCLE = Math.PI * 50 * 50;

test("the four shape operations give the right areas", () => {
  const a = sq(0, 0, 100, 100), b = el(50, 50, 100, 100);
  const want = { union: SQ + CIRCLE - QUARTER, subtract: SQ - QUARTER, intersect: QUARTER, exclude: SQ + CIRCLE - 2 * QUARTER };
  Object.keys(want).forEach((k) => {
    const r = B.op(k, [a, b]);
    assert.ok(r && r.length, k);
    assert.ok(near(area(r), want[k], 0.004), k + " " + area(r) + " vs " + want[k]);
    assert.ok(V.count(r) < 40, k + " has " + V.count(r) + " points");
  });
});

test("the result keeps corners and fits curves with few points", () => {
  const r = B.op("subtract", [sq(0, 0, 100, 100), el(50, 50, 100, 100)]);
  assert.equal(r.length, 1);
  const b = V.bounds(r);
  assert.ok(Math.abs(b.x) < 0.05 && Math.abs(b.y) < 0.05 && Math.abs(b.w - 100) < 0.05 && Math.abs(b.h - 100) < 0.05, JSON.stringify(b));
  // the three square corners are points of the result
  [[0, 0], [100, 0], [0, 100]].forEach((c) => assert.ok(r[0].n.some((n) => Math.hypot(n.x - c[0], n.y - c[1]) < 0.05), "corner " + c));
  // a circle alone, flattened and fitted again, stays a circle in few points
  const f = B.fit(B.flatten(el(0, 0, 200, 200), 0.05)[0].p, 0.1);
  assert.ok(f.n.length <= 12, f.n.length + " points");
  B.flatten([f], 0.01)[0].p.forEach((q) => assert.ok(Math.abs(Math.hypot(q[0] - 100, q[1] - 100) - 100) < 0.2));
});

test("a hole is wound the other way, so nonzero fill shows it", () => {
  const r = B.op("subtract", [sq(0, 0, 100, 100), sq(25, 25, 50, 50)]);
  assert.equal(r.length, 2);
  assert.ok(near(area(r), SQ - 2500, 1e-6), String(area(r)));
  r.forEach((p) => { assert.equal(p.n.length, 4); p.n.forEach((n) => assert.equal(n.k, "c")); });
  // straight edges stay straight: the commands are lines only
  assert.ok(V.toCmds(r).every((c) => c[0] !== "C"));
});

test("shapes that do not meet: intersect leaves nothing, union keeps both", () => {
  assert.deepEqual(B.op("intersect", [sq(0, 0, 10, 10), sq(50, 50, 10, 10)]), []);
  assert.equal(B.op("union", [sq(0, 0, 10, 10), sq(50, 50, 10, 10)]).length, 2);
  assert.equal(B.op("union", [sq(0, 0, 10, 10)]), null);
  assert.equal(B.op("nope", [sq(0, 0, 10, 10), sq(5, 5, 10, 10)]), null);
});

test("a shape with a hole of its own combines as it draws", () => {
  const donut = sq(0, 0, 100, 100).concat(V.fromCmds(moved(V.rectCmds(50, 50, 0), 25, 25)).map((p) => V.reverse(p) || p));
  const r = B.op("union", [donut, sq(200, 0, 10, 10)]);
  assert.ok(near(area(r), SQ - 2500 + 100, 1e-6), String(area(r)));
});

test("outline stroke: a straight line becomes its rectangle", () => {
  const r = B.outline(V.fromCmds([["M", 0, 0], ["L", 100, 0]]), { w: 10, cap: "butt" });
  assert.equal(r.length, 1);
  assert.equal(r[0].n.length, 4);
  const b = V.bounds(r);
  assert.deepEqual([b.x, b.y, b.w, b.h].map((v) => Math.round(v * 1000) / 1000), [0, -5, 100, 10]);
  const sq2 = B.outline(V.fromCmds([["M", 0, 0], ["L", 100, 0]]), { w: 10, cap: "square" });
  assert.ok(near(V.bounds(sq2).w, 110, 1e-6));
  const rd = B.outline(V.fromCmds([["M", 0, 0], ["L", 100, 0]]), { w: 10, cap: "round" });
  assert.ok(near(area(rd), 1000 + Math.PI * 25, 0.005), String(area(rd)));
});

test("outline stroke: joins, a ring, dashes and extra pieces", () => {
  const corner = V.fromCmds([["M", 0, 0], ["L", 100, 0], ["L", 100, 100]]);
  const mi = B.outline(corner, { w: 10, join: "miter" }), bv = B.outline(corner, { w: 10, join: "bevel" }), ro = B.outline(corner, { w: 10, join: "round" });
  const am = area(mi), ab = area(bv), ar = area(ro);
  assert.ok(near(am, 2000, 1e-6), String(am));                       // two 100 × 10 bands meeting square
  assert.ok(near(ab, 2000 - 12.5, 1e-6), String(ab));                // the miter's corner cut off
  assert.ok(ar > ab && ar < am, [ab, ar, am].join(" "));
  // a 1:3 miter limit turns a sharp miter into a bevel
  const sharp = V.fromCmds([["M", 0, 0], ["L", 100, 0], ["L", 0, 10]]);
  assert.ok(V.bounds(B.outline(sharp, { w: 4, join: "miter", miter: 10 })).w < V.bounds(B.outline(sharp, { w: 4, join: "miter", miter: 100 })).w);
  // a circle's stroke is a ring: outer and inner outline, the right area
  const ring = B.outline(el(0, 0, 100, 100), { w: 10, join: "round" });
  assert.equal(ring.length, 2);
  assert.ok(near(area(ring), Math.PI * (55 * 55 - 45 * 45), 0.005), String(area(ring)));
  assert.ok(V.count(ring) <= 30, String(V.count(ring)));
  // dashes: on 12, off 8 along 100 = 5 dashes
  const d = B.outline(V.fromCmds([["M", 0, 0], ["L", 100, 0]]), { w: 4, dash: [12, 8] });
  assert.equal(d.length, 5);
  assert.ok(near(area(d), 5 * 12 * 4, 1e-6), String(area(d)));
  // extra rings (arrow heads) join the result
  const ar2 = B.outline(V.fromCmds([["M", 0, 0], ["L", 100, 0]]), { w: 4, extra: [[[100, -10], [120, 0], [100, 10]]] });
  assert.equal(ar2.length, 1);
  assert.ok(near(area(ar2), 400 + 200, 1e-6), String(area(ar2)));
  assert.equal(B.outline(corner, { w: 0 }), null);
});

test("results go back into an item box as unit outlines", () => {
  const r = B.op("union", [sq(10, 10, 100, 100), el(60, 60, 100, 100)]);
  const f = V.reframe({ x: 0, y: 0, w: 0, h: 0, rot: 0 }, r);
  assert.ok(near(f.x, 10, 1e-3) && near(f.w, 150, 1e-3), JSON.stringify(f).slice(0, 80));
  assert.ok(V.pack(f.unit, 8000));
  f.unit.forEach((c) => { if (c.length > 2) [c[c.length - 2], c[c.length - 1]].forEach((v) => assert.ok(v >= -1e-3 && v <= 1 + 1e-3, String(v))); });   // the points; handles may stand outside
});

test("polygon-clipping is vendored with its licence and credited", () => {
  const dir = path.join(ROOT, "vendor/polygon-clipping");
  assert.ok(fs.existsSync(path.join(dir, B.PC_PATH.split("/").pop())));
  const lic = fs.readFileSync(path.join(dir, "LICENSE"), "utf8");
  assert.match(lic, /MIT License/);
  assert.match(lic, /splaytree/);
  assert.match(lic, /robust-predicates/);
  assert.match(fs.readFileSync(path.join(ROOT, "CREDITS.md"), "utf8"), /polygon-clipping/);
  assert.match(fs.readFileSync(path.join(ROOT, "shell.js"), "utf8"), /polygon-clipping/);
});
