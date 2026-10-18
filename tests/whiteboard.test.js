// Whiteboard: the data model's sync rules (OROS_BIBLE.md Part I,
// R5/R17/R26), the geometry and the drawing (whiteboard/core.js),
// and the search provider.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../whiteboard/core.js");
const P = require("../whiteboard/search.js");

const note = (id, tx, x, y) => ({ id, b: "b1", k: "note", x, y, w: 200, h: 200, z: 1, tx });
const A = () => {
  let d = C.putBoard(C.empty(), "b1", "Plan", 100);
  d = C.apply(d, { n1: note("n1", "milk", 0, 0), n2: note("n2", "bread", 300, 0) }, 110);
  return C.apply(d, { a1: { id: "a1", b: "b1", k: "arrow", ax: 0, ay: 0, bx: 0, by: 0, ao: "n1", bo: "n2", z: 2 } }, 120);
};
const B = () => {
  let d = A();
  d = C.apply(d, { n1: Object.assign(note("n1", "oat milk", 10, 10), { c: "pink" }) }, 200);
  return C.apply(d, { n2: null }, 210);
};

test("merge is symmetric and settles at once", () => {
  const ab = C.serialize(C.merge(A(), B())), ba = C.serialize(C.merge(B(), A()));
  assert.equal(ab, ba);
  assert.equal(C.serialize(C.merge(JSON.parse(ab), B())), ab);
  assert.equal(C.serialize(C.merge(B(), B())), C.serialize(B()));
  assert.equal(C.serialize(C.merge(A(), C.empty())), C.serialize(A()));
});

test("per object: the newer edit wins, a delete wins over an older edit, a newer edit brings it back", () => {
  const m = C.merge(A(), B());
  assert.deepEqual(m.objs.map((o) => o.id), ["a1", "n1"]);
  assert.equal(m.objs.find((o) => o.id === "n1").tx, "oat milk");
  // the other device moved n2 before the delete: still deleted
  const moved = C.apply(A(), { n2: note("n2", "bread", 500, 500) }, 150);
  assert.ok(!C.merge(moved, B()).objs.some((o) => o.id === "n2"));
  // and after it: it comes back
  const later = C.apply(A(), { n2: note("n2", "rye bread", 500, 500) }, 300);
  assert.equal(C.merge(B(), later).objs.find((o) => o.id === "n2").tx, "rye bread");
  // edits on two devices to two different objects both stay
  const x = C.apply(A(), { n1: note("n1", "x", 0, 0) }, 400);
  const y = C.apply(A(), { n2: note("n2", "y", 0, 0) }, 400);
  const xy = C.merge(x, y);
  assert.deepEqual(xy.objs.filter((o) => o.k === "note").map((o) => o.tx), ["x", "y"]);
});

test("an undo of a delete gets a time after the tombstone, so it syncs", () => {
  const d = C.apply(A(), { n2: null }, 500);
  const back = C.apply(d, { n2: note("n2", "bread", 300, 0) }, 400);   // the clock went back
  const o = back.objs.find((x) => x.id === "n2");
  assert.ok(o && o.m > 500);
  assert.equal(back.tombs.n2, undefined);
  assert.ok(C.merge(back, d).objs.some((x) => x.id === "n2"));
});

test("deleting a board removes what is on it, on every device", () => {
  const gone = C.removeBoard(A(), "b1", 600);
  assert.deepEqual(gone.boards, []);
  assert.deepEqual(gone.objs, []);
  assert.deepEqual(C.merge(A(), gone).objs, []);
  // an object added later on another device to the deleted board is left out
  const other = C.apply(A(), { n9: note("n9", "late", 0, 0) }, 700);
  assert.ok(!C.merge(other, gone).objs.some((o) => o.id === "n9"));
});

test("broken input is dropped, never repaired with a fresh id or time", () => {
  const d = C.normalize({
    boards: [{ id: "b1", name: 5, m: "x" }, { name: "no id" }],
    objs: [
      { id: "o1", b: "b1", k: "note", x: 0, y: 0, w: 10, h: 10 },
      { id: "o2", b: "b1", k: "script", x: 0, y: 0, w: 10, h: 10 },
      { id: "o3", b: "b1", k: "note", x: "0", y: 0, w: 10, h: 10 },
      { id: "o4", b: "b1", k: "image", x: 0, y: 0, w: 10, h: 10, src: "javascript:alert(1)" },
      { id: "o5", b: "b1", k: "image", x: 0, y: 0, w: 10, h: 10, src: "data:image/svg+xml;base64,PHN2Zz4=" },
      { id: "o6", b: "b1", k: "pen", x: 0, y: 0, w: 10, h: 10, pts: [1, 2, 3] },
      { id: "o7", b: "b1", k: "shape", x: 0, y: 0, w: 10, h: 10, shp: "blob", c: "chartreuse", f: "x" },
      { id: "o8", b: "nope", k: "note", x: 0, y: 0, w: 10, h: 10 },
      null
    ],
    tombs: { z: "bad" }
  });
  assert.deepEqual(d.boards, [{ id: "b1", name: "", m: 0 }]);
  assert.deepEqual(d.objs.map((o) => o.id), ["o1", "o7"]);
  assert.deepEqual(d.objs[0], { id: "o1", b: "b1", k: "note", z: 0, m: 0, c: "yellow", x: 0, y: 0, w: 10, h: 10, tx: "" });
  assert.deepEqual([d.objs[1].shp, d.objs[1].c, d.objs[1].f], ["rect", "blue", "soft"]);
  assert.deepEqual(d.tombs, {});
});

test("arrows stick to the edge of the objects they join, and follow them", () => {
  const d = A(), list = C.objsOf(d, "b1"), m = C.index(list);
  const e = C.ends(m.a1, m);
  assert.ok(Math.abs(e.a.x - 206) < 0.01 && Math.abs(e.a.y - 100) < 0.01, JSON.stringify(e));
  assert.ok(Math.abs(e.b.x - 294) < 0.01 && Math.abs(e.b.y - 100) < 0.01);
  // move n2 down: the arrow's end goes with it
  const m2 = C.index(list.map((o) => o.id === "n2" ? C.moved(o, 0, 400) : o));
  assert.ok(C.ends(m2.a1, m2).b.y > 300);
  // a deleted end: the arrow keeps its last drawn point
  const loose = C.ends(Object.assign({}, m.a1, { bx: 50, by: 60 }), { n1: m.n1 });
  assert.deepEqual(loose.b, { x: 50, y: 60 });
  // ellipse and diamond edges
  const el = { k: "shape", shp: "ellipse", x: 0, y: 0, w: 100, h: 50 };
  const p = C.edge(el, { x: 50, y: 500 }, 0);
  assert.ok(Math.abs(p.x - 50) < 1e-9 && Math.abs(p.y - 50) < 1e-9);
  const di = C.edge({ k: "shape", shp: "diamond", x: 0, y: 0, w: 100, h: 100 }, { x: 500, y: 500 }, 0);
  assert.ok(Math.abs(di.x - 75) < 1e-9 && Math.abs(di.y - 75) < 1e-9);
});

test("copies get new ids; arrows between copied objects join the copies", () => {
  const list = C.objsOf(A(), "b1");
  let i = 0;
  const cp = C.copies(list.filter((o) => o.id !== "n2"), () => "c" + (++i), 20, 20, 10);
  const arrow = cp.find((o) => o.k === "arrow"), n1 = cp.find((o) => o.k === "note");
  assert.equal(arrow.ao, n1.id);
  assert.equal(arrow.bo, "");                       // n2 was not copied
  assert.equal(n1.x, 20);
  assert.ok(cp.every((o) => /^c\d$/.test(o.id)));
});

test("text wraps to the width, notes fit their text, pen lines get simpler", () => {
  const mw = (s, fs) => s.length * fs * 0.5;
  assert.deepEqual(C.wrap("one two three", 40, 10, mw), ["one two", "three"]);
  assert.deepEqual(C.wrap("abcdefghij", 20, 10, mw), ["abcd", "efgh", "ij"]);
  assert.deepEqual(C.wrap("a\n\nb", 100, 10, mw), ["a", "", "b"]);
  assert.equal(C.fit("hi", 176, 176, 32, mw).fs, 32);
  assert.ok(C.fit("word ".repeat(80), 176, 176, 32, mw).fs < 16);
  const line = []; for (let x = 0; x <= 100; x++) line.push(x, x * 0.5);
  assert.deepEqual(C.simplify(line, 0.5), [0, 0, 100, 50]);
  const pen = C.penFrom([10, 20, 30, 60, 50, 20], { id: "p", b: "b1", c: "red", sw: 4, z: 1 });
  assert.deepEqual([pen.x, pen.y, pen.w, pen.h, pen.pts.join()], [10, 20, 40, 40, "0,0,20,40,40,0"]);
  const big = C.resized(pen, 80, 20);
  assert.deepEqual(big.pts, [0, 0, 40, 20, 80, 0]);
});

test("bounds, marquee and frames", () => {
  const list = C.objsOf(A(), "b1");
  const b = C.bounds(list, null, 0);
  assert.deepEqual([b.x, b.y, b.w, b.h], [0, 0, 500, 200]);
  assert.deepEqual(C.inRect(list, { x: 250, y: 95, w: 100, h: 10 }).sort(), ["a1", "n2"]);
  const fr = { id: "f1", b: "b1", k: "frame", x: -10, y: -10, w: 230, h: 230, z: 0, tx: "Left" };
  assert.deepEqual(C.inFrame(list.concat([fr]), fr).map((o) => o.id), ["f1", "n1"]);
  // frames are drawn first, whatever their z
  const d = C.apply(A(), { f1: Object.assign({}, fr, { z: 99 }) }, 130);
  assert.equal(C.objsOf(d, "b1")[0].id, "f1");
});

test("the SVG file is escaped and has no script; the screen scene has hit areas", () => {
  let d = A();
  d = C.apply(d, { t1: { id: "t1", b: "b1", k: "text", x: 0, y: 300, w: 400, h: 30, fs: 20, tx: "<script>alert(1)</script> & co" } }, 130);
  d = C.apply(d, { p1: C.penFrom([0, 0, 10, 10, 20, 0], { id: "p1", b: "b1", c: "red", sw: 3, z: 9 }) }, 131);
  const list = C.objsOf(d, "b1");
  const svg = C.toSvg(C.scene(list, {}), C.bounds(list), { title: "A \"board\" <x>", bg: C.PAPER });
  assert.ok(!/<script/i.test(svg));
  assert.ok(svg.includes("&lt;script&gt;alert(1)&lt;/script&gt; &amp; co"));
  assert.ok(svg.includes("<title>A &quot;board&quot; &lt;x&gt;</title>"));
  assert.ok(!svg.includes("data-id"));
  assert.ok(!svg.includes("transparent"));
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="\d+" viewBox="-?\d+ -?\d+ \d+ \d+">/);
  const live = C.scene(list, { live: true });
  assert.ok(live.every((g) => g.tag === "g" && g.a["data-id"]));
  const penG = live.find((g) => g.a["data-id"] === "p1");
  assert.equal(penG.kids[0].a.stroke, "transparent");
  // a draft moves an object on screen without touching the data
  const dr = C.scene(list, { draft: { n1: C.moved(list.find((o) => o.id === "n1"), 5, 0), n2: null } });
  assert.equal(dr.length, list.length - 1);
  assert.equal(list.find((o) => o.id === "n1").x, 0);
});

test("the search provider finds words on live boards only", () => {
  let d = C.apply(B(), { f1: { id: "f1", b: "b1", k: "frame", x: 0, y: 0, w: 10, h: 10, tx: "Ideas" } }, 220);
  d = JSON.parse(C.serialize(d));
  const hits = P.search({ readJSON: () => d });
  assert.deepEqual(hits.map((h) => h.target.obj || "board").sort(), ["board", "f1", "n1"]);
  assert.ok(hits.every((h) => h.target.board === "b1"));
  assert.equal(hits.find((h) => h.target.obj === "n1").text, "oat milk");
  // a tombstoned object is skipped even if the row is still there
  d.tombs.n1 = 9e12;
  assert.ok(!P.search({ readJSON: () => d }).some((h) => h.target.obj === "n1"));
  assert.deepEqual(P.search({ readJSON: () => null }), []);
});
