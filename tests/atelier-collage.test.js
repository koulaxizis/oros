// Atelier Photo collage (collage.js): the grids tile the page, the
// spacing and corners, laying a page out (new boxes, photos in order,
// a smaller grid never drops a photo silently), swapping two boxes,
// the marks surviving normalization and merge; and the wiring.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "designkit/model.js"));
const AX = require(path.join(ROOT, "atelier/ax.js"));
const CL = require(path.join(ROOT, "atelier/collage.js"));
const J = (x) => JSON.stringify(x);
const clone = (x) => JSON.parse(J(x));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const pic = (c, w, h) => ({ a: c.repeat(64) + ".jpg", nm: c + ".jpg", iw: w || 800, ih: h || 600 });
function page(w, h) {
  const d = AX.newDesign({ name: "C", w: w || 1080, h: h || 1080 }, 1000);
  return { d, pg: d.pages[0].id };
}
function lay(d, pg, st, photos, now) {
  const r = CL.apply(d, pg, st, photos, now || 2000, AX, M);
  const n = M.normDoc(d);
  Object.keys(n).forEach((k) => { d[k] = n[k]; });
  return r;
}
const cells = (d, pg) => CL.cellsOf(d, pg);

test("every grid tiles its unit grid exactly once, 1 to 9 photos", () => {
  const ids = new Set();
  for (const l of CL.LAYOUTS) {
    assert.ok(!ids.has(l.id), "unique id " + l.id);
    ids.add(l.id);
    const [gw, gh] = l.g, seen = {};
    for (const [x, y, w, h] of l.c) {
      assert.ok(w > 0 && h > 0 && x >= 0 && y >= 0 && x + w <= gw && y + h <= gh, l.id + " inside");
      for (let i = x; i < x + w; i++) for (let j = y; j < y + h; j++) {
        assert.ok(!seen[i + "," + j], l.id + " overlaps at " + i + "," + j);
        seen[i + "," + j] = 1;
      }
    }
    assert.equal(Object.keys(seen).length, gw * gh, l.id + " leaves no hole");
  }
  for (let n = 1; n <= 9; n++) assert.ok(CL.forCount(n).length >= 1, "a grid for " + n);
  assert.equal(CL.bestFor(4).c.length, 4);
  assert.equal(CL.bestFor(30).c.length, 9);
  assert.equal(CL.bestFor(0).c.length, 1);
});

test("rects: spacing between the boxes and around the edge", () => {
  const r = CL.rects("2c", 1000, 500, 2);           // 2% of 500 = 10
  assert.deepEqual(r, [{ x: 10, y: 10, w: 485, h: 480 }, { x: 505, y: 10, w: 485, h: 480 }]);
  const z = CL.rects("4g", 100, 100, 0);
  assert.deepEqual(z.map((b) => [b.x, b.y, b.w, b.h]), [[0, 0, 50, 50], [50, 0, 50, 50], [0, 50, 50, 50], [50, 50, 50, 50]]);
  // equal gaps everywhere in a mixed grid
  const m = CL.rects("4l", 900, 900, 2);             // gap 18
  assert.equal(m[0].x, 18);
  assert.equal(Math.round(m[1].x - (m[0].x + m[0].w)), 18);
  assert.equal(Math.round(m[2].y - (m[1].y + m[1].h)), 18);
  assert.equal(Math.round(900 - (m[3].y + m[3].h)), 18);
  assert.deepEqual(CL.rects("nope", 10, 10, 1), []);
});

test("roundness: the same corner on boxes of every size", () => {
  // 2% of 1000 = 20 px; a 200 × 400 box: 20 / 100 = 20
  assert.equal(CL.roundness(200, 400, 2, 1000, 1000), 20);
  assert.equal(CL.roundness(400, 400, 2, 1000, 1000), 10);
  assert.equal(CL.roundness(10, 10, 10, 1000, 1000), 100);
  assert.equal(CL.roundness(400, 400, 0, 1000, 1000), 0);
});

test("normState: known grid, spacing and corners clamped", () => {
  assert.equal(CL.normState(null), null);
  assert.equal(CL.normState({ l: "zz" }), null);
  assert.deepEqual(CL.normState({ l: "4g" }), { l: "4g", g: CL.GAP_DEF, r: 0 });
  assert.deepEqual(CL.normState({ l: "4g", g: 99, r: -3 }), { l: "4g", g: CL.GAP_MAX, r: 0 });
  assert.deepEqual(CL.normState({ l: "4g", g: 1.26, r: 3.74 }), { l: "4g", g: 1.5, r: 3.5 });
});

test("apply: a new collage, photos in order, empty boxes for the rest", () => {
  const { d, pg } = page();
  const r = lay(d, pg, { l: "4g", g: 2, r: 3 }, [pic("a"), pic("b"), pic("c")]);
  assert.deepEqual(r, { dropped: 0, left: 0 });
  const c = cells(d, pg);
  assert.equal(c.length, 4);
  assert.deepEqual(c.map((x) => x.a.charAt(0)), ["a", "b", "c", ""]);
  c.forEach((x, i) => {
    assert.equal(x.ax.k, "photo");
    assert.equal(x.fit, "fill");
    assert.equal(x.ax.shp, "rounded");
    assert.deepEqual(x.ext.clg, { i });
  });
  assert.deepEqual(CL.stateOf(d, pg), { l: "4g", g: 2, r: 3 });
  assert.ok(CL.isCell(d, c[0]));
  // the boxes sit below everything else, the background stays the bottom
  const bg = AX.background(d, pg);
  c.forEach((x) => assert.ok(x.z > bg.z));
  assert.ok(M.normDoc(clone(d)), "still a valid document");
});

test("apply: a bigger grid keeps every photo where it was", () => {
  const { d, pg } = page();
  lay(d, pg, { l: "2c", g: 2, r: 0 }, [pic("a"), pic("b")]);
  const ids = cells(d, pg).map((x) => x.id);
  lay(d, pg, { l: "4g", g: 2, r: 0 }, [], 3000);
  const c = cells(d, pg);
  assert.deepEqual(c.slice(0, 2).map((x) => x.id), ids);
  assert.deepEqual(c.map((x) => x.a.charAt(0)), ["a", "b", "", ""]);
  assert.equal(c[0].ax.shp, undefined, "no corners: no shape");
});

test("apply: spacing changes never reorder photos around an empty box", () => {
  const { d, pg } = page();
  lay(d, pg, { l: "3c", g: 2, r: 0 }, [pic("a"), pic("b"), pic("c")]);
  CL.putPhoto(cells(d, pg)[1], { a: "" });           // box 2 emptied
  lay(d, pg, { l: "3c", g: 6, r: 0 }, [], 3000);
  assert.deepEqual(cells(d, pg).map((x) => x.a.charAt(0)), ["a", "", "c"]);
});

test("apply: a smaller grid drops empty boxes first and counts lost photos", () => {
  const { d, pg } = page();
  lay(d, pg, { l: "4g", g: 2, r: 0 }, [pic("a"), pic("b")]);
  CL.putPhoto(cells(d, pg)[0], { a: "" });
  CL.putPhoto(cells(d, pg)[3], pic("d"));            // a, b, d spread out → "", b, "", d
  const r = lay(d, pg, { l: "2c", g: 2, r: 0 }, [], 3000);
  assert.equal(r.dropped, 0);
  assert.deepEqual(cells(d, pg).map((x) => x.a.charAt(0)), ["b", "d"]);
  const r2 = lay(d, pg, { l: "1", g: 2, r: 0 }, [], 4000);
  assert.equal(r2.dropped, 1);
  assert.equal(cells(d, pg).length, 1);
  // the removed box is tombstoned (merge on another device removes it too)
  assert.ok(Object.keys(d.tombs).length >= 3);
});

test("apply: photos without an empty box are counted, not lost in the doc", () => {
  const { d, pg } = page();
  const r = lay(d, pg, { l: "2c" }, [pic("a"), pic("b"), pic("c")]);
  assert.equal(r.left, 1);
  assert.equal(cells(d, pg).length, 2);
});

test("apply keeps other elements and a cropped photo goes back to filling its box", () => {
  const { d, pg } = page();
  AX.addItem(d, pg, { k: "text", tx: "Summer", x: 10, y: 10, w: 300 }, 1000);
  lay(d, pg, { l: "2r", g: 2, r: 0 }, [pic("a")]);
  const c = cells(d, pg)[0];
  c.fit = "custom"; c.ix = -40; c.isc = 2;
  lay(d, pg, { l: "2r", g: 4, r: 0 }, [], 3000);
  const c2 = cells(d, pg)[0];
  assert.equal(c2.fit, "fill");
  assert.ok(d.items.some((x) => x.ax && x.ax.k === "text" && x.ax.tx === "Summer"));
});

test("swap: the photos and their looks change boxes, the boxes stay", () => {
  const { d, pg } = page();
  lay(d, pg, { l: "2c", g: 2, r: 4 }, [pic("a", 100, 50), pic("b", 30, 90)]);
  const [x, y] = cells(d, pg);
  x.ax.flt = "noir"; x.ax.flh = 1; x.fit = "custom"; x.ix = 5;
  const bx = { x: x.x, w: x.w, shp: x.ax.shp, i: x.ext.clg.i };
  CL.swap(x, y);
  assert.equal(x.a.charAt(0), "b"); assert.equal(x.iw, 30);
  assert.equal(y.a.charAt(0), "a"); assert.equal(y.ax.flt, "noir"); assert.equal(y.ax.flh, 1);
  assert.equal(x.ax.flt, undefined);
  assert.equal(x.fit, "fill"); assert.equal(x.ix, 0);
  assert.deepEqual({ x: x.x, w: x.w, shp: x.ax.shp, i: x.ext.clg.i }, bx);
});

test("the marks survive normalization and merge both ways", () => {
  const { d, pg } = page();
  lay(d, pg, { l: "3l", g: 3, r: 2 }, [pic("a"), pic("b")]);
  const n = M.normDoc(clone(d));
  assert.equal(J(n), J(M.normDoc(clone(n))), "canonical");
  assert.deepEqual(CL.stateOf(n, pg), { l: "3l", g: 3, r: 2 });
  const a = clone(n), b = clone(n);
  lay(a, pg, { l: "4g", g: 5, r: 2 }, [pic("c")], 9000);   // this device: a new grid
  const ab = M.mergeDoc(a, b), ba = M.mergeDoc(b, a);
  assert.equal(J(ab), J(ba), "symmetric");
  assert.deepEqual(CL.stateOf(ab, pg), { l: "4g", g: 5, r: 2 });
  assert.deepEqual(cells(ab, pg).map((x) => x.a.charAt(0)), ["a", "b", "c", ""]);
});

test("cellNo ignores marks on the background and on other kinds", () => {
  assert.equal(CL.cellNo({ ax: { k: "text" }, ext: { clg: { i: 0 } } }), -1);
  assert.equal(CL.cellNo({ ax: { k: "photo", bg: 1 }, ext: { clg: { i: 0 } } }), -1);
  assert.equal(CL.cellNo({ ax: { k: "photo" }, ext: { clg: { i: 12 } } }), -1);
  assert.equal(CL.cellNo({ ax: { k: "photo" }, ext: { clg: { i: 2 } } }), 2);
});

test("wiring: loaded after the panels, hooked into home, More, the photo bar and the stage", () => {
  const html = read("atelier/index.html");
  assert.ok(html.indexOf('src="collage.js') > html.indexOf('src="panels.js'));
  assert.ok(html.indexOf('src="collage.js') < html.indexOf('src="io.js'));
  assert.match(read("atelier/core.js"), /AT\.collage\.homeCard\(\)/);
  assert.match(read("atelier/io.js"), /AT\.collage\.open\(\)/);
  assert.match(read("atelier/panels.js"), /AT\.collage\.isCell\(it\)/);
  const ed = read("atelier/editor.js");
  assert.match(ed, /AT\.collage\.dropTarget\(/);
  assert.match(ed, /AT\.collage\.drop\(/);
  assert.match(ed, /AT\.collage\.tapEmpty\(it\)/);
  const src = read("atelier/collage.js");
  assert.doesNotMatch(src, /innerHTML\s*=\s*(?!""|'')\S/, "no data through innerHTML");
});

test("strings: every cl.* key in English and Greek (and the German pack)", () => {
  const src = read("atelier/collage.js");
  const used = new Set([...src.matchAll(/t\("(cl\.[a-zA-Z0-9]+)"/g)].map((m) => m[1]));
  ["sq", "port", "story", "land", "a4"].forEach((k) => used.add("cl." + k));
  const block = (lang) => {
    const i = src.indexOf("\n    " + lang + ": {"), j = src.indexOf("\n    }", i);
    return new Set([...src.slice(i, j).matchAll(/"(cl\.[a-zA-Z0-9]+)":/g)].map((m) => m[1]));
  };
  const en = block("en"), el = block("el");
  for (const k of used) { assert.ok(en.has(k), "en " + k); assert.ok(el.has(k), "el " + k); }
  assert.deepEqual([...en].sort(), [...el].sort());
  const de = read("i18n/de/atelier.js");
  for (const k of en) assert.ok(de.indexOf('"' + k + '":') >= 0, "de " + k);
});

test("help: the collage is explained in English, Greek and German", () => {
  assert.match(read("atelier/help.en.txt"), /## Photo collage/);
  assert.match(read("atelier/help.el.txt"), /## Κολάζ φωτογραφιών/);
  assert.match(read("i18n/de/help/atelier.txt"), /## Fotocollage/);
});
