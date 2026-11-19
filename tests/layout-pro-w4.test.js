// Layout pro (LY-PRO wave W4a, Chris's spec v2 items 9-10): pictures
// mirrored in their frames (screen, PDF, page pictures, SVG, data
// merge), the frame to the picture, corners, the Links list and the
// `picture` command.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "designkit/model.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const P = require(path.join(ROOT, "designkit/pdf.js"));
const PRO = require(path.join(ROOT, "layout/pro.js"));
const CMD = require(path.join(ROOT, "layout/commands.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const A64 = "a".repeat(64) + ".jpg";

let IDN = 0;
function idf() { const k = (++IDN).toString(36); let n = 0; return (p) => p + "-p" + k + "x" + (++n); }
function steps(list) { const c = CMD.check(list); assert.ok(c.ok, c.err); return c.steps; }
function run(d, list) { return steps(list).reduce((n, st) => n + CMD.apply(d, st, { now: 50, idf: idf() }), 0); }
function book() {
  const d = PRO.makeDoc(steps([{ op: "create", title: "Εικόνες", w: 180, h: 250, n: 4 }])[0], 10);
  const o = M.pagesInOrder(d);
  d.items.push({ id: "it-a", m: 1, t: "img", pg: o[0].id, x: 0, y: 0, w: 200, h: 100, a: A64, nm: "a.jpg", iw: 400, ih: 400, fit: "fill", ix: 0, iy: 0, isc: 1, z: 1 });
  d.items.push({ id: "it-b", m: 1, t: "img", pg: o[1].id, x: 0, y: 0, w: 200, h: 200, a: "", nm: "b.jpg", iw: 0, ih: 0, fit: "fill", ix: 0, iy: 0, isc: 1, z: 1 });
  d.items.push({ id: "it-c", m: 1, t: "img", pg: o[2].id, x: 0, y: 0, w: 500, h: 500, a: "b".repeat(64) + ".png", nm: "c.png", iw: 300, ih: 600, fit: "fit", ix: 0, iy: 0, isc: 1, z: 1 });
  return d;
}

test("flip: the PDF cut comes from the other side", () => {
  const it = { t: "img", x: 0, y: 0, w: 200, h: 100, iw: 400, ih: 400, fit: "fill" };
  const a = P.imageCrop(it);
  assert.equal(a.fh, false);
  // fill: the image is 200×200 in a 200×100 frame, rows 100-300 of 400 visible
  assert.deepEqual([a.src.y, a.src.h], [100, 200]);
  it.ext = { fl: "v" };
  const b = P.imageCrop(it);
  assert.equal(b.fv, true);
  assert.deepEqual([b.src.y, b.src.h], [100, 200], "centred: the same rows");
  it.ix = 0; it.iy = 0; it.fit = "custom"; it.isc = 0.5;   // 200×200 at the top: rows 0-200 shown
  const c = P.imageCrop(it);
  assert.deepEqual([c.src.y, c.src.h], [200, 200], "mirrored: the other half");
  assert.deepEqual(R.flipOf({ ext: { fl: "hv" } }), { h: true, v: true });
  assert.deepEqual(R.flipOf({}), { h: false, v: false });
});

test("picture command: flip, corner, frame to picture, by frame or pages", () => {
  const d = book();
  assert.equal(run(d, [{ op: "picture", frame: "it-a", flip: "h", corner: 3 }]), 1);
  const a = M.find(d.items, "it-a");
  assert.equal(a.ext.fl, "h");
  assert.ok(Math.abs(a.r - 3 * 72 / 25.4) < 0.01);
  assert.equal(run(d, [{ op: "picture", frame: "it-a", flip: "h" }]), 0, "nothing differs");
  assert.equal(run(d, [{ op: "picture", frame: "it-a", flip: "none" }]), 1);
  assert.ok(!a.ext);
  assert.equal(run(d, [{ op: "picture", pages: "3", fit: "frame" }]), 1);
  const c = M.find(d.items, "it-c");
  assert.equal(c.h, 1000);
  assert.equal(c.fit, "fill");
  assert.equal(run(d, [{ op: "picture", flip: "v" }]), 0, "no frame, no pages: nothing");
  a.lock = 1;
  assert.equal(run(d, [{ op: "picture", pages: "all", flip: "v" }]), 2, "a locked frame stays");
  const o = CMD.outline(d, null, {});
  const fc = o.frames.filter((f) => f.id === "it-c")[0];
  assert.equal(fc.flip, "v");
  assert.match(CMD.GUIDE, /\bpicture:/);
});

test("links: every picture with its page, resolution and state", () => {
  const d = book();
  const L = PRO.links(d, (a) => a.indexOf("b") === 0, R.effectivePpi, 200);
  assert.deepEqual(L.map((x) => [x.id, x.page, x.state]), [["it-a", 1, "low"], ["it-b", 2, "empty"], ["it-c", 3, "missing"]]);
  assert.equal(L[0].ppi, 144, "400 px over 200 pt");
  assert.equal(PRO.links(d, () => false, R.effectivePpi, 120)[0].state, "ok");
});

test("the UI and the words", () => {
  const p = read("layout/panels.js"), l = read("layout/layout.js"), de = read("i18n/de/layout.js"), a = read("assistant/assistant.js");
  assert.match(p, /function linksDlg\(\)/);
  assert.match(p, /t\("props\.flipH"\)/);
  assert.match(read("designkit/render.js"), /ctx\.scale\(fl\.h \? -1 : 1, fl\.v \? -1 : 1\)/);
  assert.match(read("layout/io.js"), /mirror\(cx, crop, cw, ch\)/);
  assert.match(read("layout/mergeui.js"), /LY\.io\.mirror\(cx2, crop, cw, ch\)/);
  ["props.flipH", "props.flipV", "props.frameToPic", "more.links", "links.title", "links.sum", "links.none", "links.noName", "links.page", "links.go", "links.s.ok", "links.s.missing", "links.s.empty", "links.s.low"].forEach((k) => {
    assert.equal(l.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.indexOf('"' + k + '":') > 0, k + " DE");
  });
  ["ed.op.picture", "ed.f.corner", "ed.v.flip.hv", "ed.v.fit.frame"].forEach((k) => assert.equal(a.split('"' + k + '":').length - 1, 2, k));
});
