// Pure logic of the Tree Sketcher (trees/core.js): the recipe, the
// seeded generator, painting through a pen (SVG), the saved-trees
// merge (sync slice "trees") and the bridge to the Wallpaper
// Generator's Tree style; plus the wiring of the app.
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const C = require(path.join(__dirname, "..", "trees/core.js"));
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const R = (over) => C.normRecipe(Object.assign({ seed: "hello" }, over || {}));
const tree = (id, m, extra) => Object.assign({ id, m, name: "Tree " + id.slice(1, 4), r: R() }, extra || {});
const empty = () => ({ ver: 1, trees: [], tombs: {} });

test("normRecipe: canonical, clamped, species defaults, idempotent", () => {
  assert.equal(C.normRecipe(null), null);
  assert.equal(C.normRecipe([]), null);
  assert.equal(C.normRecipe({ seed: "   " }), null);
  const r = C.normRecipe({ ground: "lava", seed: "  a   b ", sp: "palm", season: "monsoon", br: 40, ang: 0.4, rnd: -9, fol: 100.6, wind: -400, ink: "crayon", extra: 1 });
  assert.deepEqual(Object.keys(r), ["seed", "sp", "season", "br", "ang", "rnd", "fol", "wind", "ink", "ground"]);
  assert.deepEqual(r, { seed: "a b", sp: "oak", season: "summer", br: 11, ang: 5, rnd: 0, fol: 100, wind: -100, ink: "pencil", ground: "grass" });
  assert.deepEqual(C.normRecipe(r), r);
  assert.equal(C.normRecipe({ seed: "x".repeat(99) }).seed.length, C.SEED_LEN);
  assert.equal(C.normRecipe({ seed: 42 }).seed, "42");
  // a species brings its own sliders; withSpecies keeps the rest
  const cy = C.normRecipe({ seed: "s", sp: "cypress" });
  assert.deepEqual([cy.br, cy.ang, cy.rnd, cy.fol], Object.values(C.speciesDefaults("cypress")));
  const w = C.withSpecies(Object.assign({}, cy, { season: "winter", br: 5 }), "willow");
  assert.equal(w.season, "winter");
  assert.equal(w.br, C.speciesDefaults("willow").br);
  assert.ok(C.isEvergreen("olive") && !C.isEvergreen("oak"));
  assert.ok(C.sameRecipe(R(), R({ extra: 1 })));
});

test("grow: the same recipe grows the same tree, another seed another", () => {
  for (const sp of C.SPECIES) {
    const a = C.grow(R({ sp })), b = C.grow(R({ sp }));
    assert.deepEqual(a, b, sp + " deterministic");
    assert.notDeepEqual(a.segs, C.grow(R({ sp, seed: "other" })).segs, sp + " seed matters");
    assert.ok(a.segs.length > 20, sp + " has branches");
    assert.ok(a.leaves.length > 20, sp + " has leaves");
    assert.ok(a.height > 0.2 && a.box.x1 > a.box.x0);
    // the trunk starts at the root, everything stands above the ground
    assert.equal(a.segs[0].x1, 0); assert.equal(a.segs[0].y1, 0);
    a.leaves.forEach((l) => assert.ok(l.y < 0));
  }
});

test("grow: sliders change the tree, within the size limits", () => {
  const base = C.grow(R({ br: 6 }));
  assert.ok(C.grow(R({ br: 9 })).segs.length > base.segs.length, "more branches");
  assert.notDeepEqual(C.grow(R({ br: 6, ang: 60 })).segs, base.segs, "angle");
  assert.notDeepEqual(C.grow(R({ br: 6, rnd: 90 })).segs, base.segs, "randomness");
  assert.ok(C.grow(R({ br: 6, fol: 100 })).leaves.length > C.grow(R({ br: 6, fol: 20 })).leaves.length, "leaves");
  assert.equal(C.grow(R({ fol: 0 })).leaves.length, 0);
  const right = C.grow(R({ br: 7, wind: 100 })), left = C.grow(R({ br: 7, wind: -100 }));
  const mid = (m) => m.leaves.reduce((s, l) => s + l.x, 0) / m.leaves.length;
  assert.ok(mid(right) > mid(left), "the wind bends the crown");
  for (const sp of C.SPECIES) {
    const big = C.grow(R({ sp, br: 11, rnd: 100, fol: 100, season: "spring" }));
    assert.ok(big.segs.length <= 3400, sp + " branch limit " + big.segs.length);
    assert.ok(big.leaves.length <= 5000, sp + " leaf limit");
    assert.ok(big.blooms.length <= 900, sp + " bloom limit");
  }
});

test("seasons: blossoms in spring, fallen leaves in autumn, bare and snowy winter", () => {
  const sp = C.grow(R({ season: "spring" })), su = C.grow(R({ season: "summer" }));
  const au = C.grow(R({ season: "autumn" })), wi = C.grow(R({ season: "winter" }));
  assert.ok(sp.blooms.length > 0 && su.blooms.length === 0);
  assert.ok(sp.leaves.length < su.leaves.length);
  assert.ok(au.fallen.length > 0 && au.leafSet === "autumn");
  assert.equal(wi.leaves.length, 0);
  assert.ok(wi.snow.length > 0 && wi.flakes.length > 0);
  // evergreens keep their leaves in winter, some with snow
  const cy = C.grow(R({ sp: "cypress", season: "winter" }));
  assert.ok(cy.leaves.length > 0 && cy.leaves.some((l) => l.snow));
  assert.equal(C.grow(R({ sp: "olive", season: "autumn" })).leafSet, "olive");
});

test("cypress keeps a narrow flame shape", () => {
  const m = C.grow(R({ sp: "cypress" }));
  assert.ok((m.box.x1 - m.box.x0) < m.height * 0.6, "narrow");
});

test("fit puts the tree on the ground line inside the picture", () => {
  const m = C.grow(R());
  const f = C.fit(m, 400, 500);
  assert.equal(f.oy, 500 * 0.88);
  assert.ok(f.ox + m.box.x0 * f.k >= 400 * 0.05 - 0.5 && f.ox + m.box.x1 * f.k <= 400 * 0.95 + 0.5);
  assert.ok(f.oy + m.box.y0 * f.k >= 500 * 0.06 - 0.5);
});

test("paint: every style draws, the same way every time; growing draws less", () => {
  for (const ink of C.INKS) {
    for (const season of C.SEASONS) {
      const svg = C.toSVG(R({ ink, season, br: 6 }), 300, 400, "T");
      assert.ok(svg.startsWith("<?xml") && svg.trim().endsWith("</svg>"), ink + " " + season);
      assert.equal(svg, C.toSVG(R({ ink, season, br: 6 }), 300, 400, "T"));
      assert.ok(!/NaN|undefined|Infinity/.test(svg), ink + " " + season + " clean numbers");
    }
  }
  const m = C.grow(R({ br: 6 })), L = C.look("colour", "summer"), f = C.fit(m, 300, 400);
  const count = (upto) => { const p = C.svgPen(); C.paint(m, L, p, { k: f.k, ox: f.ox, oy: f.oy, w: 300, h: 400, upto }); return p.count(); };
  assert.ok(count(0.2) < count(0.7) && count(0.7) < count(1));
  // sway moves the parts, never the root
  const p1 = C.svgPen(), p2 = C.svgPen();
  C.paint(m, L, p1, { k: f.k, ox: f.ox, oy: f.oy, w: 300, h: 400 });
  C.paint(m, L, p2, { k: f.k, ox: f.ox, oy: f.oy, w: 300, h: 400, sway: (x, y, s) => 10 * s });
  assert.notEqual(p1.out(), p2.out());
  assert.equal(p1.out().split("\n")[0].length > 0, true);
  // the title is escaped
  assert.ok(C.toSVG(R(), 100, 100, '<b>"x"&</b>').includes("<title>&lt;b&gt;&quot;x&quot;&amp;&lt;/b&gt;</title>"));
});

test("looks: colours for every style and season", () => {
  for (const ink of C.INKS) {
    for (const season of C.SEASONS) {
      const L = C.look(ink, season);
      assert.equal(L.ink, ink);
      assert.equal(L.bg.length, 2);
      for (const set of ["spring", "summer", "autumn", "winter", "olive"]) assert.equal(L.leaf[set].length, 4);
    }
  }
  assert.equal(C.look("chalk", "summer").paper, false);
  assert.equal(C.look("pencil", "summer").paper, true);
});

test("mergeTrees: laws, LWW per tree", () => {
  const A = { trees: [tree("taaaaaa1", 5), tree("tbbbbbb1", 9, { name: "New" })], tombs: {} };
  const B = { trees: [tree("tbbbbbb1", 3, { name: "Old" }), tree("tcccccc1", 4)], tombs: {} };
  const ab = C.mergeTrees(A, B), ba = C.mergeTrees(B, A);
  assert.deepEqual(ab, ba);
  assert.deepEqual(C.mergeTrees(ab, ab), ab);
  const D = { trees: [tree("tdddddd1", 1)], tombs: { taaaaaa1: 2 } };
  assert.deepEqual(C.mergeTrees(C.mergeTrees(A, B), D), C.mergeTrees(A, C.mergeTrees(B, D)));
  assert.equal(C.findTree(ab, "tbbbbbb1").name, "New");
  assert.deepEqual(C.newestFirst(ab.trees).map((x) => x.id), ["tbbbbbb1", "taaaaaa1", "tcccccc1"]);
  const t1 = C.mergeTrees({ trees: [tree("teeeeee1", 7, { name: "A" })] }, { trees: [tree("teeeeee1", 7, { name: "B" })] });
  const t2 = C.mergeTrees({ trees: [tree("teeeeee1", 7, { name: "B" })] }, { trees: [tree("teeeeee1", 7, { name: "A" })] });
  assert.deepEqual(t1, t2);
  const before = JSON.stringify(A);
  C.mergeTrees(A, B);
  assert.equal(JSON.stringify(A), before, "inputs untouched");
});

test("mergeTrees: tombstones, undo, junk", () => {
  const base = { trees: [tree("taaaaaa1", 5)], tombs: {} };
  const del = C.mergeTrees(base, { trees: [], tombs: { taaaaaa1: 5 } });
  assert.equal(del.trees.length, 0);
  assert.equal(C.mergeTrees(del, { trees: [tree("taaaaaa1", 6)] }).trees.length, 1);
  assert.equal(C.mergeTrees(del, { trees: [tree("taaaaaa1", 4)] }).trees.length, 0);
  const junk = C.mergeTrees({
    trees: [null, 7, { id: "bad", m: 1, r: R() }, { id: "tffffff1", m: -1, r: R() },
            { id: "tgggggg1", m: 2, r: { seed: "" } },
            { id: "thhhhhh1", m: 3, name: "  a\u0000b  ", r: { seed: "s", sp: "palm", br: 99 }, extra: 1 },
            { id: "tkkkkkk1", m: 3, name: "   ", r: { seed: "only seed" } }],
    tombs: { bad: 1, tiiiiii1: -1, tjjjjjj1: 4 }
  }, null);
  assert.deepEqual(junk.trees.map((x) => x.id), ["thhhhhh1", "tkkkkkk1"]);
  assert.deepEqual(junk.trees[0], { id: "thhhhhh1", m: 3, name: "a b", r: C.normRecipe({ seed: "s", br: 11 }) });
  assert.equal(junk.trees[1].name, "only seed");                       // no name: the seed
  assert.deepEqual(junk.tombs, { tjjjjjj1: 4 });
  assert.deepEqual(C.mergeTrees(undefined, null), empty());
});

test("ids, names, seeds and file names", () => {
  for (let i = 0; i < 20; i++) assert.match(C.newId(Math.random), /^t[a-z0-9]{12}$/);
  assert.match(C.randomSeed(Math.random), /^[a-z]{6}-\d{3}$/);
  assert.equal(C.cleanName("  x\ty\n "), "x y");
  assert.equal(C.cleanName("x".repeat(99)).length, C.NAME_LEN);
  assert.equal(C.fileName("Η ελιά μου", "png"), "tree-Η-ελιά-μου.png");
  assert.equal(C.fileName("../", "svg"), "tree-sketch.svg");
});

test("wallpaper bridge: to the Tree style and back", () => {
  const r = R({ sp: "willow", season: "autumn", br: 8, ang: 40, rnd: 25, fol: 60, wind: -30, ink: "colour", ground: "hill" });
  const w = C.toWallRecipe(r);
  assert.equal(w.style, "tree");
  assert.equal(w.pal, "ember");
  assert.equal(w.dens, 60); assert.equal(w.chaos, 25);
  assert.deepEqual(w.tree, { sp: "willow", season: "autumn", br: 8, ang: 40, wind: -30, ink: "colour", ground: "hill" });
  assert.deepEqual(C.fromWallRecipe(w), r);
  assert.equal(C.toWallRecipe(R({ ink: "pencil" })).pal, "mono");
  assert.equal(C.toWallRecipe(R({ ink: "chalk" })).light, 0);
  assert.deepEqual(C.wallParams(null), { sp: "oak", season: "summer", br: 9, ang: 30, wind: 0, ink: "colour", ground: "hill" });
  assert.equal(C.fromWallRecipe(null), null);
  // the wallpaper look comes from the wallpaper colours
  const mix = (a) => a;
  const L = C.wallLook({ bg: "#000000", ink: ["#111111", "#222222", "#333333", "#444444", "#555555"], light: false }, w.tree, mix);
  assert.equal(L.bg[0], "#000000");
  assert.equal(L.leaf.summer.length, 4);
  assert.equal(L.snow, "#ffffff");
});

test("wiring: app, palette, sync, wallpaper, help", () => {
  const js = read("trees/trees.js"), html = read("trees/index.html");
  assert.ok(js.includes("inheritPalette") && js.includes("watchPalette"));            // guard G3
  assert.ok(/registerSlice\("trees", sliceGet, sliceSet, STORAGE_KEY, C\.mergeTrees\)/.test(js));
  assert.ok(js.includes('"oros-trees-data"') && js.includes('"oros-trees-prefs"'));
  assert.equal((js.match(/window\.__orosOpenAt = /g) || []).length, 1);
  assert.ok(js.includes('__orosTakeTarget("trees")'));
  assert.ok(html.indexOf("core.js") < html.indexOf("trees.js"));
  // the Wallpaper Generator and Jigsaw load the tree generator before art.js
  for (const f of ["wallpaper/index.html", "jigsaw/index.html"]) {
    const h = read(f);
    assert.ok(h.indexOf("../trees/core.js") > 0 && h.indexOf("../trees/core.js") < h.indexOf("art.js"), f);
  }
  assert.ok(read("wallpaper/wallpaper.js").includes('__orosOpenAt("trees", { wall: recipe() })'));
  assert.ok(read("wallpaper/index.html").includes('id="tree-btn"') && read("wallpaper/index.html").includes('id="tree-hint"'));
  for (const f of ["help.en.txt", "help.el.txt"]) assert.ok(fs.existsSync(path.join(__dirname, "..", "trees", f)));
});
