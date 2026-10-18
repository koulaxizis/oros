// Atelier morph (wave C2): atelier/morph.js pairs what two pages
// share and draws the frames between them; anim.js times a morph page
// (ext.mph on its background) and starts its entrances after it.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "designkit/model.js"));
const AX = require(path.join(ROOT, "atelier/ax.js"));
const Anim = require(path.join(ROOT, "atelier/anim.js"));
const Mo = require(path.join(ROOT, "atelier/morph.js"));

// two pages: a red square + "Hello" + a star icon, then the same moved,
// grown and blue, a circle where the square was, and a new text
function twoPages() {
  const d = AX.newDesign({ name: "Morph", w: 1000, h: 500 }, 1000);
  const p1 = d.pages[0].id, p2 = M.newId("pg");
  d.pages.push({ id: p2, m: 1000, pos: d.pages[0].pos + 1024, ms: "" });
  if (!AX.background(d, p1)) AX.addBackground(d, p1, "#ffffff", 1000);
  AX.addBackground(d, p2, "#000000", 1000);
  AX.addItem(d, p1, { k: "shape", shp: "rect", fc: "#ff0000", x: 0, y: 0, w: 100, h: 100 }, 1000);
  AX.addItem(d, p1, { k: "text", tx: "Hello", size: 20, fc: "#000000", x: 10, y: 300, w: 300 }, 1000);
  AX.addItem(d, p1, { k: "text", tx: "Bye", size: 20, x: 10, y: 400, w: 300 }, 1000);
  AX.addItem(d, p2, { k: "text", tx: "Hello", size: 60, fc: "#ffffff", x: 500, y: 100, w: 400 }, 1000);
  AX.addItem(d, p2, { k: "shape", shp: "circle", fc: "#0000ff", x: 200, y: 100, w: 200, h: 200, rot: 90 }, 1000);
  AX.addItem(d, p2, { k: "text", tx: "New", size: 20, x: 10, y: 450, w: 300, an: "fade" }, 1000);
  const n = M.normDoc(d);
  const bg = AX.background(n, p2);
  bg.ext = { mph: 1 };
  return { d: M.normDoc(n), p1, p2 };
}
const find = (d, pg, f) => d.items.find((it) => it.pg === pg && it.ax && f(it.ax));

test("the morph flag lives in the background's ext and survives normalization", () => {
  const { d, p1, p2 } = twoPages();
  assert.equal(Mo.isOn(d, p2), true);
  assert.equal(Mo.isOn(d, p1), false);
  assert.equal(AX.background(d, p2).ext.mph, 1);
  // older copies: ptr stays the default (fade), which they show instead
  assert.equal(AX.background(d, p2).ax.ptr, undefined);
  assert.equal(Anim.pageTransition(d, p2), "morph");
  const again = M.normDoc(JSON.parse(JSON.stringify(d)));
  assert.equal(JSON.stringify(again), JSON.stringify(d));
});

test("pairs: backgrounds, same words, then kind by kind; entrances and leftovers fade", () => {
  const { d, p1, p2 } = twoPages();
  const ps = Mo.pairs(d, p1, p2);
  const pairOf = (b) => ps.find((q) => q.b && q.b.id === b.id);
  assert.equal(pairOf(AX.background(d, p2)).a.id, AX.background(d, p1).id);
  const hello2 = find(d, p2, (a) => a.tx === "Hello");
  assert.equal(pairOf(hello2).a.ax.tx, "Hello");          // not "Bye", though "Bye" is also a text
  const circle = find(d, p2, (a) => a.shp === "circle");
  assert.equal(pairOf(circle).a.ax.shp, "rect");
  // "New" has its own entrance: it does not pair, and "Bye" fades out
  const nw = find(d, p2, (a) => a.tx === "New");
  assert.equal(pairOf(nw).a, null);
  assert.ok(ps.some((q) => q.a && q.a.ax.tx === "Bye" && q.b === null));
  // every element of both pages appears exactly once
  const n1 = d.items.filter((it) => it.pg === p1).length, n2 = d.items.filter((it) => it.pg === p2).length;
  assert.equal(ps.filter((q) => q.a).length, n1);
  assert.equal(ps.filter((q) => q.b).length, n2);
});

test("frame: the ends look like the two pages, the middle is between", () => {
  const { d, p1, p2 } = twoPages();
  const sq = find(d, p1, (a) => a.shp === "rect" && !a.bg);
  const at = (p) => Mo.frame(d, p1, p2, p);
  const shapeOf = (list) => list.find((c) => c.ax.k === "shape" && !c.ax.bg);
  const s0 = shapeOf(at(0)), s1 = shapeOf(at(1)), sm = shapeOf(at(0.5));
  assert.deepEqual([s0.x, s0.y, s0.w, s0.h, s0.ax.fc], [sq.x, sq.y, 100, 100, "#ff0000"]);
  assert.deepEqual([s1.x, s1.y, s1.w, s1.h, s1.ax.fc], [200, 100, 200, 200, "#0000ff"]);
  assert.deepEqual([sm.x, sm.w], [100, 150]);
  assert.equal(sm.rot, 45);
  assert.equal(sm.ax.fc, "#800080");
  // a square turning into a circle draws its own outline
  assert.ok(typeof sm.ext.pth === "string" && /^M/.test(sm.ext.pth));
  assert.ok(AX.pthOf(sm).length > 4);
  // the text grows and changes colour; the background turns from white to black
  const tx = at(0.5).find((c) => c.ax.tx === "Hello");
  assert.equal(tx.ax.size, 40);
  assert.equal(tx.ax.fc, "#808080");
  assert.equal(at(0.5).find((c) => c.ax.bg).ax.fc, "#808080");
  // leftovers fade: "Bye" half gone, the entering "New" not drawn at all
  assert.equal(at(0.5).find((c) => c.ax.tx === "Bye").op, 50);
  assert.equal(at(0.5).some((c) => c.ax.tx === "New"), false);
  // copies only: the design is not changed, and the copies sit on the new page in z order
  const before = JSON.stringify(d);
  const f = at(0.3);
  assert.equal(JSON.stringify(d), before);
  assert.ok(f.every((c) => c.pg === p2));
  for (let i = 1; i < f.length; i++) assert.ok(f[i - 1].z <= f[i].z);
  assert.ok(f[0].ax.bg);
});

test("frame: different words crossfade while they move, same shapes keep their library shape", () => {
  const { d, p1, p2 } = twoPages();
  find(d, p2, (a) => a.tx === "Hello").ax.tx = "World";
  const f = Mo.frame(d, p1, p2, 0.25);
  const hello = f.find((c) => c.ax.tx === "Hello"), world = f.find((c) => c.ax.tx === "World");
  assert.ok(hello && world);
  assert.equal(hello.x, world.x);
  assert.equal(hello.op, 75);
  assert.equal(world.op, 25);
  // a square to a bigger square: no own outline needed
  find(d, p2, (a) => a.shp === "circle").ax.shp = "rect";
  const sq = Mo.frame(d, p1, p2, 0.5).find((c) => c.ax.k === "shape" && !c.ax.bg);
  assert.equal(sq.ext, undefined);
});

test("hidden elements never pair; tables and charts are not in the pairing kinds", () => {
  const { d, p1, p2 } = twoPages();
  const h = find(d, p1, (a) => a.tx === "Bye");
  h.hide = 1;
  const ps = Mo.pairs(d, p1, p2);
  assert.equal(ps.some((q) => q.a && q.a.id === h.id), false);
  const src = fs.readFileSync(path.join(ROOT, "atelier/morph.js"), "utf8");
  assert.match(src, /ORDER = \["shape", "line", "text", "icon", "photo"\]/);
});

test("timing: a morph runs MORPH seconds, the page's entrances start after it", () => {
  const { d, p1, p2 } = twoPages();
  AX.background(d, p1).ax.dur = 3;
  const tl = Anim.timeline(d, M.pagesInOrder(d));
  assert.equal(tl.pages[1].tr, "morph");
  assert.ok(tl.pages[1].dur >= Anim.MORPH + Anim.introLen(d.items.filter((it) => it.pg === p2)));
  const mid = Anim.at(tl, 3 + Anim.MORPH / 2);
  assert.equal(mid.prev, 0);
  assert.equal(mid.tr, "morph");
  assert.ok(Math.abs(mid.mix - 0.5) < 1e-9);               // ease in-out is symmetric
  assert.ok(Math.abs(mid.pt + Anim.MORPH / 2) < 1e-9);       // entrances not started yet
  const after = Anim.at(tl, 3 + Anim.MORPH + 0.2);
  assert.equal(after.prev, -1);
  assert.ok(Math.abs(after.pt - 0.2) < 1e-9);
  // the first page never morphs (nothing before it)
  AX.background(d, p1).ext = { mph: 1 };
  assert.equal(Anim.timeline(d, M.pagesInOrder(d)).pages[0].tr, "none");
  // a single page exported alone does not morph either
  assert.equal(Anim.timeline(d, [M.pagesInOrder(d)[1]]).pages[0].tr, "none");
  assert.equal(Anim.at(Anim.timeline(d, [M.pagesInOrder(d)[1]]), 0.1).pt, 0.1);
});

test("the morph is wired into the editor, Present, video / GIF, and its strings exist", () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
  const draw = read("atelier/draw.js"), motion = read("atelier/motion.js"), core = read("atelier/core.js");
  assert.match(draw, /opts\.morph && opts\.morph\.p < 1 && Mo/);
  assert.match(read("atelier/editor.js"), /morph: ED\.morph/);
  assert.match(motion, /pageTo\(a, list\[p\.i\], p\.pt, mo\)/);
  assert.match(motion, /onChange: function \(st\)/);
  assert.match(read("atelier/index.html"), /<script src="morph\.js\?v=[^"]+"><\/script>/);
  assert.match(read("sw.js"), /"atelier\/morph\.js"/);
  ["an.tr.morph", "an.morphHint"].forEach((k) => assert.equal(core.split('"' + k + '"').length - 1, 2, k));
  assert.match(read("i18n/de/atelier.js"), /"an\.tr\.morph"/);
});
