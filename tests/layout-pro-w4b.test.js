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

// ---------- text wrap by the outline or transparent edges ----------
const T = require(path.join(ROOT, "designkit/text.js"));
T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

test("alphaProfile: the opaque part of each band, null when nothing is transparent", () => {
  const w = 10, h = 4, data = new Uint8ClampedArray(w * h * 4);
  // rows 0-1: pixels 2..4 opaque; rows 2-3: clear
  for (let y = 0; y < 2; y++) for (let x = 2; x <= 4; x++) data[(y * w + x) * 4 + 3] = 255;
  assert.deepEqual(R.alphaProfile({ w, h, data }, 2), [[200, 500], 0]);
  const full = new Uint8ClampedArray(w * h * 4).fill(255);
  assert.equal(R.alphaProfile({ w, h, data: full }, 2), null);
});

test("blocked by a polygon: the band takes the polygon's extent there, widened by the offset", () => {
  // a triangle: point at the top (50, 0), base from (0, 100) to (100, 100)
  const ex = { x: 0, y: 0, w: 100, h: 100, shape: "poly", polys: [[[50, 0], [100, 100], [0, 100]]], o: 0 };
  const top = T.freeSegments(0, 300, [ex], 0, 10, 1), low = T.freeSegments(0, 300, [ex], 90, 100, 1);
  assert.ok(Math.abs(top[0][1] - 45) < 0.01 && Math.abs(top[1][0] - 55) < 0.01, "near the point: text on both sides of 45-55");
  assert.ok(Math.abs(low[0][0] - 100) < 0.01, "at the base at x 100");
  const off = T.freeSegments(0, 300, [Object.assign({}, ex, { o: 5 })], 0, 10, 1);
  assert.ok(Math.abs(off[0][1] - 37.5) < 0.01 && Math.abs(off[1][0] - 62.5) < 0.01, "offset 5: band widened and pushed out");
  assert.deepEqual(T.freeSegments(0, 300, [ex], 120, 130, 1), [[0, 300]], "below the shape");
});

function wrapDoc() {
  const d = PRO.makeDoc(steps([{ op: "create", title: "Wrap", w: 180, h: 250, n: 1, t: 10, b: 10, i: 10, o: 10 }])[0], 10);
  run(d, [{ op: "frame", page: 1, lines: ["word ".repeat(400)] }]);
  const pg = M.pagesInOrder(d)[0], tf = d.items.find((it) => it.t === "text");
  // a triangle path over the frame's top-left: point at the top, wide at the bottom
  d.items.push({ id: "it-p", m: 1, t: "path", pg: pg.id, x: tf.x, y: tf.y, w: 120, h: 120, d: "M0.5 0 L1 1 L0 1 Z", wrap: "box", wo: 0, z: 9 });
  return { d, tf };
}
function firstX(d, tf, yAt) {
  const L = R.computeLayout(d), ls = L.frames[tf.id].lines;
  return ls.filter((l) => l.y > yAt && l.y < yAt + 14)[0].runs[0].x;
}

test("wrap by outline: a path's slope lets the text in where the shape is narrow", () => {
  const { d, tf } = wrapDoc();
  const boxTop = firstX(d, tf, 0);
  assert.ok(boxTop >= 120, "by the box the first line starts after the box");
  assert.equal(run(d, [{ op: "framemod", frame: "it-p", wrap: "shape" }]), 1);
  assert.equal(M.find(d.items, "it-p").ext.wc, "shape");
  const top = firstX(d, tf, 0), bottom = firstX(d, tf, 100);
  assert.ok(top < 80, "near the point the line starts early: " + top);
  assert.ok(bottom > top + 30, "lower down the shape is wider");
  const o = CMD.outline(d, null, {});
  assert.equal(o.frames.filter((f) => f.id === "it-p")[0].wrap, "shape");
  assert.equal(run(d, [{ op: "framemod", frame: "it-p", wrap: "box" }]), 1);
  assert.ok(!M.find(d.items, "it-p").ext, "back to the box");
  assert.equal(firstX(d, tf, 0), boxTop);
});

test("wrap by transparent edges: the picture's profile, only for the picture it was read from", () => {
  const { d, tf } = wrapDoc();
  d.items = d.items.filter((it) => it.id !== "it-p");
  const pg = M.pagesInOrder(d)[0];
  // a picture whose left half is clear
  d.items.push({ id: "it-i", m: 1, t: "img", pg: pg.id, x: tf.x, y: tf.y, w: 120, h: 120, a: "c".repeat(64) + ".png", iw: 100, ih: 100, fit: "fill", ix: 0, iy: 0, isc: 1, wrap: "box", wo: 0, z: 9 });
  const boxX = firstX(d, tf, 0);
  const prof = Array.from({ length: 4 }, () => [500, 1000]);
  assert.equal(PRO.setWrap(d, ["it-i"], { wc: "alpha", prof: { "it-i": prof } }, 60), 1);
  const it = M.find(d.items, "it-i");
  assert.deepEqual([it.ext.wc, it.ext.wpa], ["alpha", it.a]);
  // the opaque right half is in the way, the clear left half lets text in: both sides
  const L = R.computeLayout(d), first = L.frames[tf.id].lines[0];
  assert.ok(first.runs[0].x < 20, "text in the clear left half");
  it.ext.fl = "h";
  assert.ok(R.computeLayout(d).frames[tf.id].lines[0].runs[0].x >= 60, "mirrored: the opaque half is on the left");
  delete it.ext.fl;
  it.a = "d".repeat(64) + ".png";
  assert.equal(firstX(d, tf, 0), boxX, "another picture: by the box until it is read again");
  // a command without pixels sets the mode; Layout reads the profile later
  assert.equal(run(d, [{ op: "framemod", frame: "it-i", wrap: "alpha", wrap_mm: 2 }]), 1);
  assert.deepEqual([it.ext.wc, it.ext.wpr, Math.round(it.wo * 25.4 / 72)], ["alpha", undefined, 2]);
  assert.match(read("layout/io.js"), /LY\.on\("doc", fillWrapProfiles\)/);
});

test("wrap words", () => {
  const p = read("layout/panels.js"), l = read("layout/layout.js"), de = read("i18n/de/layout.js");
  ["props.wc", "props.wc.box", "props.wc.shape", "props.wc.alpha", "props.wc.opaque"].forEach((k) => {
    assert.ok(p.indexOf('t("' + k + '")') > 0, k + " used");
    assert.equal(l.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.indexOf('"' + k + '":') > 0, k + " DE");
  });
  assert.match(CMD.GUIDE, /alpha \(a picture's opaque part/);
});

// ---------- anchored objects ----------
test("anchored: a picture in the text sits on its line and moves with the text", () => {
  const d = PRO.makeDoc(steps([{ op: "create", title: "Anchor", w: 180, h: 250, n: 2, t: 10, b: 10, i: 10, o: 10 }])[0], 10);
  run(d, [{ op: "frame", page: 1, lines: ["first paragraph", "second paragraph"] }]);
  const pgs = M.pagesInOrder(d), tf = d.items.find((it) => it.t === "text");
  d.items.push({ id: "it-k", m: 1, t: "rect", pg: pgs[1].id, x: 5, y: 5, w: 40, h: 30, wrap: "box", wo: 6, z: 3 });
  assert.equal(run(d, [{ op: "framemod", frame: "it-k", anchor: "inline", anchor_in: tf.id, anchor_para: 2, anchor_at: "start" }]), 1);
  const k = M.find(d.items, "it-k"), st = M.story(d, tf.story);
  assert.equal(k.ext.anc, tf.story);
  assert.deepEqual(st.paras[1].runs[0], { t: "\uFFFC", ext: { obj: "it-k" } });
  let L = R.computeLayout(d);
  const ls = L.frames[tf.id].lines, l2 = ls[1];
  assert.equal(k.pg, pgs[0].id, "moved to the page of its text");
  assert.ok(Math.abs(k.x - (tf.x + l2.runs[0].x)) < 0.01);
  assert.ok(Math.abs(k.y + k.h - (tf.y + l2.y)) < 0.01, "its bottom on the baseline");
  assert.ok(l2.y - ls[0].y >= 30, "the line made room for it");
  assert.ok(Math.abs(l2.runs[1].x - (l2.runs[0].x + 40)) < 0.01, "the words after it start after it");
  assert.deepEqual(L.anchored["it-k"], { pg: k.pg, x: k.x, y: k.y });
  // more text before it: it moves down with its line
  st.paras.unshift({ ps: st.paras[0].ps, runs: [{ t: "a new first paragraph" }] });
  const y0 = k.y;
  L = R.computeLayout(d);
  assert.ok(k.y > y0 + 5, "moved down with the text");
  // it does not push the text away from itself
  assert.ok(L.frames[tf.id].lines[2].runs[0].x < 1);
  const o = CMD.outline(d, null, {});
  assert.equal(o.frames.filter((f) => f.id === "it-k")[0].anchored_in, tf.story);
  // freed: no place in the text, stays where it was
  assert.equal(run(d, [{ op: "framemod", frame: "it-k", anchor: "off" }]), 1);
  assert.ok(!k.ext || !k.ext.anc);
  assert.ok(st.paras.every((p) => p.runs.every((r) => String(r.t || "").indexOf("\uFFFC") < 0)));
  assert.equal(st.paras[2].runs.map((r) => r.t).join(""), "second paragraph");
});

test("anchored: placed inside a run at an offset, refused where it cannot go", () => {
  const d = PRO.makeDoc(steps([{ op: "create", title: "Anchor", w: 180, h: 250, n: 1 }])[0], 10);
  run(d, [{ op: "frame", page: 1, lines: ["abcdef"] }]);
  const pg = M.pagesInOrder(d)[0], tf = d.items.find((it) => it.t === "text");
  d.items.push({ id: "it-k", m: 1, t: "ell", pg: pg.id, x: 5, y: 5, w: 10, h: 10, wrap: "none", wo: 0, z: 3 });
  M.story(d, tf.story).paras[0].runs = [{ t: "abc def" }];
  assert.ok(PRO.anchorItem(d, "it-k", tf.story, 0, 4, 20));
  assert.deepEqual(M.story(d, tf.story).paras[0].runs.map((r) => r.t), ["abc ", "\uFFFC", "def"]);
  assert.ok(PRO.anchorItem(d, "it-k", tf.story, 0, 6, 20));
  assert.deepEqual(M.story(d, tf.story).paras[0].runs.map((r) => r.t), ["abc ", "\uFFFC", "def"], "inside a word: before the word");
  // anchored again elsewhere: the old place goes
  assert.ok(PRO.anchorItem(d, "it-k", tf.story, 0, -1, 21));
  assert.equal(M.story(d, tf.story).paras[0].runs.map((r) => r.t).join(""), "abc def\uFFFC");
  assert.equal(PRO.anchorItem(d, tf.id, tf.story, 0, 0, 22), false, "not a text frame");
  M.find(d.items, "it-k").lock = 1;
  assert.equal(PRO.anchorItem(d, "it-k", tf.story, 0, 0, 23), false, "not locked");
  const notes = [];
  const c = CMD.check([{ op: "framemod", frame: "it-k", anchor: "inline", anchor_in: "nothing" }]);
  CMD.apply(d, c.steps[0], { now: 30, notes, idf: idf() });
  assert.deepEqual(notes, ["noAnchor"]);
});

test("anchored words", () => {
  const p = read("layout/panels.js"), l = read("layout/layout.js"), de = read("i18n/de/layout.js");
  ["anc.add", "anc.on", "anc.off"].forEach((k) => {
    assert.ok(p.indexOf('t("' + k + '")') > 0, k + " used");
    assert.equal(l.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.indexOf('"' + k + '":') > 0, k + " DE");
  });
  assert.match(CMD.GUIDE, /anchor inline puts the first frame/);
});

// ---------- a page of a file as a picture ----------
test("placepage: checked, applied with the page Layout drew, read back", () => {
  assert.equal(CMD.check([{ op: "placepage", frame: "it-a", path: "/internal/Claude/book.pdf", page: 3 }]).ok, true);
  assert.equal(CMD.check([{ op: "placepage", frame: "it-a", path: "local:Books/old.sla.gz" }]).ok, true);
  assert.match(CMD.check([{ op: "placepage", frame: "it-a", path: "/internal/Claude/book.af" }]).err, /Affinity/);
  assert.match(CMD.check([{ op: "placepage", frame: "it-a", path: "../x.pdf" }]).err, /orOS disk/);
  const d = book();
  const st = steps([{ op: "placepage", frame: "it-a", path: "/internal/Claude/book.pdf", page: 3 }])[0];
  assert.equal(CMD.apply(d, st, { now: 40 }), 1, "preview: the frame would change");
  const pic = { a: "e".repeat(64) + ".png", iw: 2480, ih: 3508, nm: "book · 3.png", pp: { f: "book.pdf", k: "pdf", p: 3 } };
  assert.equal(CMD.apply(d, st, { now: 41, page: pic }), 1);
  const it = M.find(d.items, "it-a");
  assert.deepEqual([it.a, it.fit, it.iw, it.ext.pp.p], [pic.a, "fit", 2480, 3]);
  const o = CMD.outline(d, null, {});
  assert.deepEqual(o.frames.filter((f) => f.id === "it-a")[0].page_of, { file: "book.pdf", page: 3 });
  assert.ok(read("layout/assist.js").indexOf("placepage: 1") > 0, "an async command");
  assert.match(read("layout/proassist.js"), /LY\.io\.pageImage\(new File/);
  assert.match(CMD.GUIDE, /\nplacepage: /);
});

test("place a page: the words", () => {
  const p = read("layout/panels.js"), io = read("layout/io.js"), l = read("layout/layout.js"), de = read("i18n/de/layout.js");
  ["pp.menu", "pp.from", "pp.title", "pp.which", "pp.page", "pp.place", "pp.working", "pp.done", "pp.bad", "pp.af"].forEach((k) => {
    assert.ok(p.indexOf('t("' + k + '"') > 0 || io.indexOf('t("' + k + '"') > 0, k + " used");
    assert.equal(l.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.indexOf('"' + k + '":') > 0, k + " DE");
  });
});
