// Layout pro (LY-PRO wave W4b, Chris's spec v2 item 15): colour
// corrections of pictures (levels, curves, brightness and contrast,
// colour balance, hue/saturation/lightness, black and white), kept in
// the document apart from the file; the `picture` command sets them.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "designkit/model.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const PRO = require(path.join(ROOT, "layout/pro.js"));
const CMD = require(path.join(ROOT, "layout/commands.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

let IDN = 0;
function idf() { const k = (++IDN).toString(36); let n = 0; return (p) => p + "-q" + k + "x" + (++n); }
function steps(list) { const c = CMD.check(list); assert.ok(c.ok, c.err); return c.steps; }
function run(d, list) { return steps(list).reduce((n, st) => n + CMD.apply(d, st, { now: 50, idf: idf() }), 0); }
function book() {
  const d = PRO.makeDoc(steps([{ op: "create", title: "Χρώμα", w: 180, h: 250, n: 2 }])[0], 10);
  const o = M.pagesInOrder(d);
  d.items.push({ id: "it-a", m: 1, t: "img", pg: o[0].id, x: 0, y: 0, w: 200, h: 100, a: "a".repeat(64) + ".jpg", nm: "a.jpg", iw: 400, ih: 400, fit: "fill", ix: 0, iy: 0, isc: 1, z: 1 });
  d.items.push({ id: "it-b", m: 1, t: "img", pg: o[1].id, x: 0, y: 0, w: 200, h: 100, a: "b".repeat(64) + ".jpg", nm: "b.jpg", iw: 400, ih: 400, fit: "fill", ix: 0, iy: 0, isc: 1, z: 1 });
  return d;
}

test("adjNorm keeps what changes the picture, within range, in a fixed order", () => {
  assert.equal(R.adjNorm(null), null);
  assert.equal(R.adjNorm({ bc: { b: 0, c: 0 }, gray: 0 }), null, "nothing that changes anything");
  const a = R.adjNorm({ gray: 1, bc: { b: 500, c: "x" }, levels: { ib: 200, iw: 100 }, hsl: { s: -20 }, foo: { x: 1 } });
  assert.deepEqual(Object.keys(a), ["levels", "bc", "hsl", "gray"]);
  assert.deepEqual(a.bc, { b: 150, c: 0 });
  assert.equal(a.levels.iw, 201, "the white point stays above the black point");
  assert.deepEqual(a.hsl, { h: 0, s: -20, l: 0 });
  assert.equal(R.adjKey(a), R.adjKey(R.adjNorm(a)), "the key is stable");
  assert.notEqual(R.adjKey(a), R.adjKey(R.adjNorm({ gray: 1 })));
  assert.equal(R.adjKey(null), "");
  assert.equal(R.adjOf({ t: "rect", ext: { adj: { gray: 1 } } }), null, "pictures only");
});

test("applyAdj changes the pixels as Photo Lab does, alpha untouched", () => {
  const px = () => ({ w: 2, h: 1, data: new Uint8ClampedArray([200, 40, 40, 255, 10, 20, 30, 0]) });
  const g = px();
  assert.ok(R.applyAdj(g, R.adjNorm({ gray: 1 })));
  assert.equal(g.data[0], g.data[1]);
  assert.equal(g.data[1], g.data[2]);
  assert.deepEqual(Array.from(g.data.slice(4)), [10, 20, 30, 0], "a clear pixel stays");
  const l = px();
  R.applyAdj(l, R.adjNorm({ levels: { ib: 40, iw: 200 } }));
  assert.deepEqual(Array.from(l.data.slice(0, 4)), [255, 0, 0, 255]);
  // order: levels before black and white
  const both = px(), a = px(), b = px();
  R.applyAdj(both, R.adjNorm({ gray: 1, levels: { ib: 40, iw: 200 } }));
  R.applyAdj(a, R.adjNorm({ levels: { ib: 40, iw: 200 } }));
  R.applyAdj(a, R.adjNorm({ gray: 1 }));
  assert.deepEqual(Array.from(both.data), Array.from(a.data));
  assert.equal(R.applyAdj(b, null), false);
});

test("picture command: corrections set, merged, taken off; the outline and Links show them", () => {
  const d = book();
  assert.equal(run(d, [{ op: "picture", frame: "it-a", bc: "10 20", gray: "on" }]), 1);
  const a = M.find(d.items, "it-a");
  assert.deepEqual(a.ext.adj, { bc: { b: 10, c: 20 }, gray: 1 });
  assert.equal(run(d, [{ op: "picture", frame: "it-a", levels: "12 240 1.1" }]), 1);
  assert.deepEqual(a.ext.adj.levels, { ib: 12, iw: 240, g: 1.1, ob: 0, ow: 255 });
  assert.equal(a.ext.adj.gray, 1, "the others stay");
  assert.equal(run(d, [{ op: "picture", frame: "it-a", levels: "12 240 1.1" }]), 0, "nothing differs");
  assert.equal(run(d, [{ op: "picture", frame: "it-a", bc: "0 0", gray: "off" }]), 1);
  assert.deepEqual(Object.keys(a.ext.adj), ["levels"], "a correction that changes nothing goes");
  assert.equal(run(d, [{ op: "picture", pages: "all", hsl: "0 -100 0", curves: "56 132 200", balance: "5 0 -5" }]), 2);
  const o = CMD.outline(d, null, {});
  assert.deepEqual(o.frames.filter((f) => f.id === "it-b")[0].adj, { curves: { s: 56, m: 132, h: 200 }, balance: { r: 5, g: 0, b: -5 }, hsl: { h: 0, s: -100, l: 0 } });
  assert.equal(PRO.links(d, () => false, R.effectivePpi, 100)[0].adj, true);
  assert.equal(run(d, [{ op: "picture", pages: "all", adjust: "none" }]), 2);
  assert.ok(!a.ext && !M.find(d.items, "it-b").ext, "nothing left in ext");
  assert.match(CMD.GUIDE, /levels "black white gamma/);
});

test("screen, PDF, e-book, SVG and merge all draw the corrected picture", () => {
  assert.match(read("designkit/render.js"), /if \(img\) img = adjustedImage\(img, adjOf\(it\)\);/);
  const io = read("layout/io.js");
  assert.match(io, /var adj = adjust\(cx, it, cw, ch\);/, "the cut that goes out (PDF, e-book, SVG)");
  assert.match(io, /\(adj \? "-" \+ adj : ""\)/, "a corrected picture is its own PDF image");
  assert.match(read("layout/mergeui.js"), /LY\.io\.adjust\(cx2, it, cw, ch\)/);
  const idx = read("layout/index.html");
  assert.ok(idx.indexOf("../photolab/adjust.js") > idx.indexOf("../designkit/render.js"));
});

test("the UI and the words", () => {
  const p = read("layout/panels.js"), l = read("layout/layout.js"), de = read("i18n/de/layout.js");
  assert.match(p, /function adjSection\(it\)/);
  ["adj.title", "adj.gray", "adj.bcT", "adj.b", "adj.c", "adj.hslT", "adj.h", "adj.s", "adj.l", "adj.levels", "adj.ib", "adj.iw", "adj.g", "adj.ob", "adj.ow",
    "adj.curves", "adj.cs", "adj.cm", "adj.ch", "adj.balance", "adj.r", "adj.gr", "adj.bl", "adj.off", "adj.noLib"].forEach((k) => {
    assert.ok(p.indexOf('"' + k + '"') > 0, k + " used");
    assert.equal(l.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.indexOf('"' + k + '":') > 0, k + " DE");
  });
});
