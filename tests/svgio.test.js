// Vector tools, wave V4: SVG in and out. Atelier webout.svgFile and
// atelier/svgin.js (Layout's reader → editable shapes), Layout
// layout/svgout.js; export then import gives the same outlines.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const V = require(path.join(ROOT, "designkit/vector.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const AX = require(path.join(ROOT, "atelier/ax.js"));
const WB = require(path.join(ROOT, "atelier/webout.js"));
const AS = require(path.join(ROOT, "atelier/svgin.js"));
const SI = require(path.join(ROOT, "layout/svgin.js"));
const SO = require(path.join(ROOT, "layout/svgout.js"));

T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

// page-space points along an Atelier shape's outline
function pagePoints(it) {
  const cmds = AX.shapeCmds(it), a = (it.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const wk = V.walker(cmds), out = [];
  for (let i = 0; i < 64; i++) {
    const q = wk.at(wk.len * i / 64), dx = q[0] - it.w / 2, dy = q[1] - it.h / 2;
    out.push([it.x + it.w / 2 + dx * c - dy * s, it.y + it.h / 2 + dx * s + dy * c]);
  }
  return out;
}
// every point of a lies on (near) b's outline
function sameOutline(a, b, tol) {
  const pb = pagePoints(b), pa = pagePoints(a);
  return pa.every((p) => pb.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < tol)) || pa.map((p) => p).length === 0;
}
function near(p, list, tol) { return list.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < tol); }

function design() {
  const d = AX.newDesign({ name: "SVG", w: 800, h: 600, bg: "#fff8e7" }, 1);
  const pg = d.pages[0].id;
  AX.addItem(d, pg, { k: "shape", shp: "rect", x: 50, y: 60, w: 200, h: 100, fc: "#ff0000", sc: "#000000", sw: 4, rot: 30 }, 1);
  AX.addItem(d, pg, { k: "shape", shp: "circle", x: 300, y: 60, w: 150, h: 100, fc: "#00ff00" }, 1);
  AX.addItem(d, pg, { k: "shape", shp: "star", x: 520, y: 40, w: 160, h: 160, fc: "#8c52ff" }, 1);
  AX.addItem(d, pg, { k: "shape", shp: "rect", x: 500, y: 300, w: 200, h: 200, ext: { pth: "M0 0C0.5 -0.2 1 0.3 1 1L0 1Z" }, fc: "#0000ff" }, 1);
  AX.addItem(d, pg, { k: "line", x: 50, y: 400, w: 300, h: 50, sc: "#333333", sw: 3 }, 1);
  AX.addItem(d, pg, { k: "text", tx: "Hello SVG", size: 40, b: 1, font: "serif", x: 100, y: 500, w: 400, fc: "#123456" }, 1);
  return { d: M.normDoc(d), pg };
}

test("Atelier: a page as one SVG file, fonts inside, a selection in its own box", () => {
  const { d, pg } = design();
  const r = WB.svgFile(d, pg, {}, {});
  assert.ok(r.svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.match(r.svg, /viewBox="0 0 800 600"/);
  assert.match(r.svg, /@font-face\{font-family:"f-serif-b";src:url\(data:font\/ttf;base64,/);
  assert.match(r.svg, /font-weight="bold"/);
  assert.ok(!/<script/i.test(r.svg));
  const lean = WB.svgFile(d, pg, { fonts: false }, {});
  assert.ok(!/@font-face/.test(lean.svg) && lean.svg.length < r.svg.length);
  const circle = d.items.find((x) => x.ax.shp === "circle");
  const one = WB.svgFile(d, pg, { ids: [circle.id], fonts: false }, {});
  assert.match(one.svg, /viewBox="300 60 150 100"/);
  assert.equal(WB.svgFile(d, pg, { ids: ["it-none"] }, {}), null);
});

test("Atelier: export then import gives the same outlines, texts and colours", () => {
  const { d, pg } = design();
  const page = SI.parse(WB.svgFile(d, pg, { fonts: false }, {}).svg);
  const res = AS.toSpecs(page, null, { bg: true });
  assert.equal(res.bg, "#fff8e7", "the page colour, not a shape");
  const d2 = AX.newDesign({ name: "back", w: 800, h: 600 }, 2), pg2 = d2.pages[0].id;
  res.specs.forEach((s) => AX.addItem(d2, pg2, s, 2));
  const shapes = (doc) => doc.items.filter((x) => x.ax.k === "shape" && !x.ax.bg).sort((p, q) => p.z - q.z);
  const a = shapes(d), b = shapes(d2);
  assert.equal(b.length, a.length);
  a.forEach((x, i) => {
    assert.equal(b[i].ax.fc, x.ax.fc);
    assert.ok(sameOutline(x, b[i], 0.6) && sameOutline(b[i], x, 0.6), "outline " + i + " " + x.ax.shp);
  });
  assert.equal(b[0].ax.sc, "#000000"); assert.equal(b[0].sw, 4);
  const ln = d2.items.find((x) => x.ax.k === "line");
  assert.deepEqual([ln.x, ln.y, ln.w, ln.h, ln.ax.sc, ln.sw], [50, 400, 300, 50, "#333333", 3]);
  const tx = d2.items.find((x) => x.ax.k === "text");
  assert.deepEqual([tx.ax.tx, tx.ax.font, tx.ax.b, tx.ax.size, tx.ax.fc, tx.x, tx.y], ["Hello SVG", "serif", 1, 40, "#123456", 100, 500]);
});

test("SVG in: gradients, rounded and turned boxes, pictures, a fitted box", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient>' +
    '<radialGradient id="r"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#00ff00"/><stop offset="1" stop-color="#000000"/></radialGradient></defs>' +
    '<rect x="0" y="0" width="100" height="50" fill="url(#g)"/><rect x="100" y="0" width="100" height="50" rx="10" fill="#abcdef" transform="rotate(10 150 25)"/>' +
    '<circle cx="50" cy="75" r="20" fill="url(#r)"/>' +
    '<image x="120" y="60" width="40" height="30" href="data:image/png;base64,iVBORw0KGgo="/><image x="0" y="0" width="5" height="5" href="https://example.com/a.png"/>' +
    '<script>alert(1)</script><text x="10" y="95" font-family="Georgia" font-style="italic" font-size="12" fill="#222">Hi there</text></svg>';
  const pg = SI.parse(svg);
  const res = AS.toSpecs(pg, { x: 0, y: 0, w: 400, h: 400 });
  const [g, rr, c] = res.specs;
  assert.deepEqual(g.g, { a: "#ff0000", b: "#0000ff", ang: 180 });
  assert.deepEqual(g.ext.gs.st, [[0, "#ff0000"], [1, "#0000ff"]]);
  assert.equal(g.w, 200, "scaled ×2 into the box");
  assert.equal(g.y, 100, "centred in the box");
  assert.ok(rr.ext && rr.ext.pth, "a rounded rectangle keeps its own outline");
  assert.equal(c.shp, "circle"); assert.equal(c.ext.gs.r, 1); assert.equal(c.ext.gs.st.length, 3);
  assert.equal(res.images.length, 1); assert.equal(res.specs[res.images[0].i].k, "photo");
  assert.equal(res.linked, 1);
  const t = res.specs.find((s) => s.k === "text");
  assert.deepEqual([t.tx, t.font, t.i, t.fc], ["Hi there", "serif", 1, "#222222"]);
});

function layoutDoc() {
  const d = M.newDoc({ name: "T", w: 400, h: 400, pages: 1 }, 1000);
  const pg = M.pagesInOrder(d)[0];
  d.stories.push({ id: "st-a", m: 1000, paras: [{ ps: "ps-body", runs: [{ t: "Hello Layout text" }] }] });
  d.items.push({ id: "it-a", m: 1000, t: "text", pg: pg.id, x: 20, y: 20, w: 300, h: 50, story: "st-a", seq: 1, z: 1 });
  d.items.push({ id: "it-r", m: 1000, t: "rect", pg: pg.id, x: 50, y: 100, w: 100, h: 60, r: 8, fill: "sw-black", z: 2, rot: 15 });
  d.items.push({ id: "it-e", m: 1000, t: "ell", pg: pg.id, x: 200, y: 100, w: 100, h: 60, stroke: "sw-black", sw: 2, z: 3 });
  d.items.push({ id: "it-p", m: 1000, t: "path", pg: pg.id, x: 50, y: 200, w: 100, h: 100, d: "M0 0C0.5 0 1 0.5 1 1L0 1Z", fill: "sw-black", z: 4 });
  d.items.push({ id: "it-l", m: 1000, t: "line", pg: pg.id, x: 200, y: 250, w: 150, h: 40, stroke: "sw-black", sw: 1, z: 5 });
  d.stories.push({ id: "st-c", m: 1000, paras: [{ ps: "ps-body", runs: [{ t: "Round and round" }] }] });
  d.items.push({ id: "it-c", m: 1000, t: "text", pg: pg.id, x: 220, y: 300, w: 80, h: 80, story: "st-c", seq: 1, z: 6, ext: { tp: { d: V.text(V.ellCmds(1, 1)), o: 0 } } });
  return M.normDoc(d);
}

test("Layout: a page as SVG, the same outlines back through the reader", () => {
  const d = layoutDoc(), page = M.pagesInOrder(d)[0];
  const r = SO.build(d, page, R.computeLayout(d), {}, {});
  assert.match(r.svg, /viewBox="0 0 400 400"/);
  assert.match(r.svg, /@font-face\{font-family:"f-/);
  assert.ok(!/ A\d|A\d/.test(r.svg.replace(/data:[^)]*\)/g, "")), "curves as cubics, no arcs");
  assert.ok((r.svg.match(/rotate\(/g) || []).length > 10, "path text glyph by glyph");
  const p = SI.parse(SO.build(d, page, null, { fonts: false }, {}).svg);
  const texts = p.pieces.map((x) => x.s.trim()).join(" ");
  assert.match(texts, /Hello Layout text/);
  const byBox = (t, x, y, w, h) => p.items.some((i) => i.t === t && Math.abs(i.x - x) < 0.6 && Math.abs(i.y - y) < 0.6 && Math.abs(i.w - w) < 0.6 && Math.abs(i.h - h) < 0.6);
  assert.ok(byBox("path", 200, 100, 100, 60), "ellipse");
  assert.ok(byBox("path", 50, 200, 100, 100), "path");
  assert.ok(byBox("line", 200, 250, 150, 40), "line");
  // the turned rounded rectangle: its corners' arcs stay on the page where they were
  const rr = p.items.find((i) => i.t === "path" && i.x < 50 && i.y < 100);
  assert.ok(rr && Math.abs(rr.x + rr.w / 2 - 100) < 0.6 && Math.abs(rr.y + rr.h / 2 - 130) < 0.6);
  // a selection: its own box, no page
  const one = SO.build(d, page, null, { ids: ["it-e"], fonts: false }, {});
  assert.match(one.svg, /viewBox="199 99 102 62"/);
  assert.ok(!/<rect width="400"/.test(one.svg));
});

test("both apps offer SVG and the reader loads on first use", () => {
  const io = fs.readFileSync(path.join(ROOT, "atelier/io.js"), "utf8");
  assert.match(io, /loadScript\("\.\.\/layout\/svgin\.js"\)/);
  assert.match(io, /\["svg"\]/);
  const ah = fs.readFileSync(path.join(ROOT, "atelier/index.html"), "utf8"), lh = fs.readFileSync(path.join(ROOT, "layout/index.html"), "utf8");
  assert.ok(!/svgin\.js|sla\.js/.test(ah), "Atelier loads the reader on first use");
  assert.ok(!/svgout\.js/.test(lh), "Layout loads the writer on first use");
  assert.match(fs.readFileSync(path.join(ROOT, "layout/io.js"), "utf8"), /script\("svgout\.js", "LY_SVGOUT"\)/);
  assert.match(fs.readFileSync(path.join(ROOT, "layout/editor.js"), "utf8"), /svgSelection\("copy"\)/);
  assert.match(fs.readFileSync(path.join(ROOT, "atelier/panels.js"), "utf8"), /svgSelection\("copy"\)/);
});
