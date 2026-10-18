// Whiteboard wave D2 (whiteboard/kit.js): dot votes are plain shapes
// that survive the D1 data model, the tally by position, free places
// for new dots, templates and Mind map imports that pass cleanObj,
// notes for other apps in reading order, the timer's clock.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../whiteboard/core.js");
const K = require("../whiteboard/kit.js");

const note = (id, tx, x, y, z) => ({ id, b: "b1", k: "note", x, y, w: 200, h: 200, z: z || 1, tx, c: "yellow" });
let seq = 0;
const newId = () => "id" + (++seq).toString(36).padStart(4, "0");

function board(objs) {
  let d = C.putBoard(C.empty(), "b1", "Ideas", 100);
  const rows = {};
  objs.forEach((o) => { rows[o.id] = o; });
  return C.apply(d, rows, 200);
}
function vote(d, targetId, c, now) {
  const list = C.objsOf(d, "b1"), t = list.find((o) => o.id === targetId);
  const dot = K.dotFor(t, list, { id: newId(), c: c || "red", z: C.zTop(d, "b1") });
  assert.ok(dot, "a free place");
  const rows = {};
  rows[dot.id] = dot;
  return { d: C.apply(d, rows, now || 300), dot };
}

test("a dot is an ordinary shape: the D1 model keeps every field, so no vote is stripped", () => {
  let d = board([note("n1", "Idea A", 0, 0)]);
  const r = vote(d, "n1");
  const kept = C.cleanObj(JSON.parse(JSON.stringify(r.dot)));
  assert.deepEqual(kept, Object.assign({ m: 0 }, r.dot));
  assert.ok(K.isDot(kept));
  assert.ok(!K.isDot(Object.assign({}, kept, { w: 23 })), "another size is a shape");
  assert.ok(!K.isDot(Object.assign({}, kept, { tx: "x" })), "a shape with text is not a dot");
  assert.ok(!K.isDot(Object.assign({}, kept, { f: "soft" })));
  // merged with a device that never saw it: the dot stays
  const merged = C.merge(board([note("n1", "Idea A", 0, 0)]), r.d);
  assert.ok(merged.objs.some((o) => o.id === r.dot.id));
});

test("tally: by where the dot lies; the top object wins; frames and arrows never take votes", () => {
  let d = board([note("n1", "A", 0, 0, 1), note("n2", "B", 400, 0, 2), note("n3", "C", 100, 100, 5),
    { id: "f1", b: "b1", k: "frame", x: -50, y: -50, w: 900, h: 600, tx: "", c: "gray", z: 0 }]);
  let r = vote(d, "n1"); d = r.d;
  r = vote(d, "n2"); d = r.d;
  r = vote(d, "n2"); d = r.d;
  const list = C.objsOf(d, "b1");
  const t = K.tally(list);
  assert.equal(t.counts.n2, 2);
  // n1's first place (bottom right) is under n3, which lies on top
  assert.equal(t.counts.n3, 1);
  assert.equal(t.counts.n1, undefined);
  assert.equal(t.counts.f1, undefined);
  assert.deepEqual(K.ranked(list).map((x) => [x.id, x.n]), [["n2", 2], ["n3", 1]]);
  const lone = Object.assign({}, r.dot, { id: "zz", x: 5000, y: 5000 });
  assert.equal(K.tally(list.concat([lone])).of.zz, undefined, "a dot on nothing counts for nothing");
});

test("dotFor: a row from the bottom right, places of removed dots are used again, inside the object", () => {
  let d = board([note("n1", "A", 0, 0)]);
  const dots = [];
  for (let i = 0; i < 9; i++) { const r = vote(d, "n1"); d = r.d; dots.push(r.dot); }
  assert.equal(dots[0].x, 200 - 6 - K.DOT);
  assert.equal(dots[0].y, 200 - 6 - K.DOT);
  assert.equal(dots[1].y, dots[0].y);
  assert.ok(dots[1].x < dots[0].x);
  assert.ok(dots[7].y < dots[0].y, "the second row is above");
  dots.forEach((o) => assert.ok(o.x >= 0 && o.y >= 0 && o.x + K.DOT <= 200 && o.y + K.DOT <= 200));
  assert.equal(K.tally(C.objsOf(d, "b1")).counts.n1, 9);
  const rows = {};
  rows[dots[2].id] = null;
  d = C.apply(d, rows, 400);
  const r = vote(d, "n1", "blue", 500);
  assert.deepEqual([r.dot.x, r.dot.y], [dots[2].x, dots[2].y]);
  assert.deepEqual(K.dotsOn(C.objsOf(r.d, "b1"), ["n1"]).length, 9);
});

test("templates: every object passes the data model, ids are fresh, arrows join template objects", () => {
  const L = {};
  ["brainstorm", "retro", "swot", "roadmap", "topic", "well", "better", "actions", "s", "w", "o", "t", "now", "next", "later", "time"]
    .forEach((k) => { L[k] = "<" + k + ">"; });
  K.TEMPLATES.forEach((kind) => {
    const objs = K.template(kind, L, newId);
    assert.ok(objs.length >= 5, kind);
    const ids = new Set(objs.map((o) => o.id));
    assert.equal(ids.size, objs.length);
    const placed = K.place(objs, 1000, 2000, 10, "b1");
    placed.forEach((o) => {
      const c = C.cleanObj(o);
      assert.ok(c, kind + " " + o.k + " is valid");
      if (o.k === "arrow") { assert.ok(!o.ao || ids.has(o.ao)); assert.ok(!o.bo || ids.has(o.bo)); }
      if (o.k !== "frame") assert.ok(o.z > 10);
    });
    const r = C.bounds(placed, null, 0);
    assert.ok(Math.abs(r.x + r.w / 2 - 1000) < 1 && Math.abs(r.y + r.h / 2 - 2000) < 1, kind + " is centred");
    // frames hold their notes, so moving a frame carries them
    placed.filter((o) => o.k === "frame").forEach((f) => {
      assert.ok(C.inFrame(placed, f).length >= 2, kind + " frame holds a note");
    });
  });
  assert.deepEqual(K.template("nope", L, newId), []);
});

test("Mind map import: a tree to the right, branch colours, arrows, a cap", () => {
  const tree = { tx: "Trip", kids: [
    { tx: "Pack", kids: [{ tx: "Shoes", kids: [] }, { tx: "Map", kids: [] }] },
    { tx: "Book", kids: [{ tx: "Hotel", kids: [] }] },
    { tx: "Go", kids: [] }
  ] };
  const r = K.fromTree(tree, newId);
  assert.equal(r.count, 7);
  assert.equal(r.cut, false);
  const shapes = r.objs.filter((o) => o.k !== "arrow"), arrows = r.objs.filter((o) => o.k === "arrow");
  assert.equal(shapes.length, 7);
  assert.equal(arrows.length, 6);
  const by = Object.fromEntries(shapes.map((o) => [o.tx, o]));
  assert.equal(by.Trip.k, "shape");
  assert.equal(by.Shoes.c, by.Pack.c, "a branch keeps its colour");
  assert.notEqual(by.Pack.c, by.Book.c);
  assert.ok(by.Shoes.x > by.Pack.x && by.Pack.x > by.Trip.x);
  assert.ok(by.Pack.y > by.Shoes.y && by.Pack.y < by.Map.y, "a parent sits between its children");
  shapes.forEach((a) => shapes.forEach((b) => {
    if (a === b) return;
    const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
    assert.ok(apart, a.tx + " and " + b.tx + " do not overlap");
  }));
  K.place(r.objs, 0, 0, 0, "b1").forEach((o) => assert.ok(C.cleanObj(o), o.k));
  const wide = { tx: "Big", kids: Array.from({ length: 400 }, (_, i) => ({ tx: "n" + i, kids: [] })) };
  const w = K.fromTree(wide, newId);
  assert.equal(w.count, K.MAX_TREE);
  assert.equal(w.cut, true);
});

test("items: words in reading order, first line is the item, dots and pictures left out", () => {
  const list = [
    note("a", "Second\nwith details", 300, 10),
    note("b", "First", 0, 0),
    note("c", "  \nThird", 0, 400),
    note("d", "", 0, 800),
    { id: "e", b: "b1", k: "shape", shp: "ellipse", f: "solid", w: K.DOT, h: K.DOT, x: 0, y: 0, tx: "", c: "red", z: 9 },
    { id: "f", b: "b1", k: "arrow", ax: 0, ay: 0, bx: 1, by: 1, tx: "arrow label", z: 1 }
  ];
  assert.deepEqual(K.items(list), [
    { text: "First", note: "" }, { text: "Second", note: "with details" }, { text: "Third", note: "" }
  ]);
});

test("timer clock: running, paused, done", () => {
  assert.equal(K.remaining({ end: 61000, dur: 60000 }, 1000), 60000);
  assert.equal(K.remaining({ end: 0, left: 5000, dur: 60000 }, 99999), 5000);
  assert.equal(K.remaining({ end: 500, dur: 60000 }, 1000), 0);
  assert.equal(K.remaining(null, 0), 0);
  assert.equal(K.clock(60000), "01:00");
  assert.equal(K.clock(1), "00:01");
  assert.equal(K.clock(3725000), "1:02:05");
});

test("the app loads kit.js, and the browser code has no innerHTML with data", () => {
  const html = fs.readFileSync(path.join(__dirname, "../whiteboard/index.html"), "utf8");
  assert.ok(html.indexOf("kit.js") > html.indexOf("core.js") && html.indexOf("kit.js") < html.indexOf("app.js"));
  const kit = fs.readFileSync(path.join(__dirname, "../whiteboard/kit.js"), "utf8");
  assert.ok(!/innerHTML|eval\(|new Function/.test(kit));
});
