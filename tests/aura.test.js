// Pure logic of Aura Painter (aura/core.js): packing the points of
// a stroke, symmetry, the limits, drawing through a canvas context
// (a recording fake), the surprise work and the my-works merge
// (sync slice "aura"); plus the wiring of the app and the shell's
// device picture wallpaper (orosWallpaper.setImage).
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const C = require(path.join(__dirname, "..", "aura/core.js"));
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const line = (n, x0, y0, dx, dy) => {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push({ x: x0 + i * (dx || 5), y: y0 + i * (dy || 0), w: i % 16 });
  return pts;
};
const stroke = (over) => Object.assign({ b: "glow", c: "#3cff9e", s: 30, g: 70, y: "none", p: C.encodePoints(line(10, 100, 100)) }, over || {});
const work = (id, m, extra) => Object.assign({ id, m, name: "Work " + id.slice(1, 4), w: 2000, h: 1125, bg: "black", st: [stroke()] }, extra || {});
const empty = () => ({ ver: 1, works: [], tombs: {} });

// A canvas context that records what is drawn.
function fakeCtx() {
  const log = [];
  const ctx = {
    log, globalAlpha: 1, globalCompositeOperation: "source-over", fillStyle: "#000",
    save() { log.push("save"); }, restore() { log.push("restore"); },
    fillRect(...a) { log.push(["rect", ctx.fillStyle, ...a]); },
    beginPath() {}, closePath() {},
    moveTo(x, y) { log.push(["m", Math.round(x), Math.round(y)]); },
    lineTo(x, y) { log.push(["l", Math.round(x), Math.round(y)]); },
    arc(x, y, r) { log.push(["arc", Math.round(x), Math.round(y)]); },
    fill() { log.push(["fill", ctx.fillStyle, Math.round(ctx.globalAlpha * 1000), ctx.globalCompositeOperation]); }
  };
  return ctx;
}

test("points: pack and unpack give the same points back", () => {
  const pts = [{ x: 0, y: 0, w: 0 }, { x: 2000, y: 1125, w: 15 }, { x: 1999, y: 3, w: 7 }, { x: 0, y: 1125, w: 1 }];
  const s = C.encodePoints(pts);
  assert.match(s, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(C.decodePoints(s), pts);
  const long = line(1500, 0, 0, 1, 1).map((p) => ({ x: p.x % 2001, y: p.y % 1126, w: p.w }));
  assert.deepEqual(C.decodePoints(C.encodePoints(long)), long);
  // small moves pack in about 3 characters a point
  assert.ok(C.encodePoints(line(1000, 10, 10, 3, 2)).length < 3200);
  // garbage
  for (const bad of [null, "", 7, "a b", "zz", "A", "AA", "//", "_____________"]) assert.equal(C.decodePoints(bad), null, String(bad));
});

test("normStroke and normWork: canonical, clamped, junk dropped", () => {
  const s = C.normStroke({ b: "neon", c: "#FFAA00", s: 400, g: 2, y: "k8", p: C.encodePoints([{ x: -50, y: 3000, w: 40 }]), extra: 1 }, 2000, 1125);
  assert.deepEqual(s.stroke, { b: "neon", c: "#ffaa00", s: 100, g: 10, y: "k8", p: C.encodePoints([{ x: 0, y: 1125, w: 15 }]) });
  assert.equal(s.n, 1);
  assert.equal(C.normStroke({ b: "neon", c: "r359", s: 5, g: 50, y: "none", p: "AAA" }, 2000, 2000).stroke.c, "r359");
  for (const bad of [null, { b: "pencil" }, stroke({ c: "red" }), stroke({ c: "r360" }), stroke({ y: "k5" }), stroke({ p: "" })])
    assert.equal(C.normStroke(bad, 2000, 1125), null);
  assert.equal(C.normWork(work("abad", 1)), null, "id");
  assert.equal(C.normWork(work("aaaaaaa1", 1, { w: 1999 })), null, "long side must be 2000");
  assert.equal(C.normWork(work("aaaaaaa1", 1, { w: 50 })), null);
  const w = C.normWork(work("aaaaaaa1", 3, { name: "  a\u0000b ", bg: "pink", st: [null, stroke(), { b: "x" }] }));
  assert.deepEqual(Object.keys(w), ["id", "m", "name", "w", "h", "bg", "st"]);
  assert.equal(w.name, "a b"); assert.equal(w.bg, "black"); assert.equal(w.st.length, 1);
  assert.deepEqual(C.normWork(w), w);
  assert.deepEqual(C.sizeFor(1920, 1080), { w: 2000, h: 1125 });
  assert.deepEqual(C.sizeFor(390, 844), { w: 924, h: 2000 });
});

test("limits: points per stroke and per work", () => {
  const big = C.normStroke(stroke({ p: C.encodePoints(line(3000, 0, 0, 0, 0)) }), 2000, 2000);
  assert.equal(big.n, C.MAX_STROKE);
  const many = [];
  for (let i = 0; i < 5; i++) many.push(stroke({ p: C.encodePoints(line(1000, 0, i, 1, 0)) }));
  const st = C.normStrokes(many, 2000, 2000);
  assert.equal(st.length, 4);
  assert.equal(C.pointCount(st), C.MAX_POINTS);
  assert.equal(C.MAX_POINTS, 4000); assert.equal(C.MAX_WORKS, 60);
  // a full work of tiny moves stays small (60 of them well under 1 MB)
  assert.ok(JSON.stringify(work("aaaaaaa1", 1, { st })).length < 16000);
});

test("symmetry: copies, mirror and kaleidoscope keep the centre", () => {
  assert.deepEqual(C.SYMS.map(C.copies), [1, 2, 4, 6, 8, 12]);
  const p = [{ x: 150, y: 120, w: 3 }];
  const mir = C.applyT(p, C.transforms("mirror")[1], 100, 100)[0];
  assert.deepEqual([mir.x, mir.y, mir.w], [50, 120, 3]);
  for (const sym of ["k4", "k6", "k8", "k12"]) {
    const ts = C.transforms(sym);
    const out = ts.map((T) => C.applyT(p, T, 100, 100)[0]);
    out.forEach((q) => assert.ok(Math.abs(Math.hypot(q.x - 100, q.y - 100) - Math.hypot(50, 20)) < 1e-9, sym + " same distance"));
    const keys = new Set(out.map((q) => Math.round(q.x * 100) + "," + Math.round(q.y * 100)));
    assert.equal(keys.size, ts.length, sym + " all copies differ");
  }
  assert.equal(C.transforms("nope").length, 1);
});

test("outline: a closed shape around the stroke, round caps", () => {
  const pts = line(5, 0, 0, 10, 0);
  const poly = C.outline(pts, () => 2);
  assert.equal(poly.length % 2, 0);
  assert.equal(poly.length, (5 * 2 + 7 * 2) * 2);
  const ys = poly.filter((_, i) => i % 2 === 1);
  assert.ok(Math.max(...ys) <= 2 + 1e-9 && Math.min(...ys) >= -2 - 1e-9);
  assert.equal(C.outline([{ x: 5, y: 5, w: 0 }], () => 3).length, 32, "a dot is a circle");
});

test("draw: every brush draws, the same way every time; light paper multiplies", () => {
  for (const b of C.BRUSHES) {
    const wk = C.normWork(work("aaaaaaa1", 1, { st: [stroke({ b, y: "k6" }), stroke({ b, c: "r200", p: C.encodePoints(line(40, 300, 300, 7, 3)) })] }));
    const a = fakeCtx(), z = fakeCtx();
    C.draw(a, wk, 400, 300);
    C.draw(z, wk, 400, 300);
    assert.deepEqual(a.log, z.log, b + " deterministic");
    const fills = a.log.filter((e) => e[0] === "fill");
    assert.ok(fills.length > 6 * 2, b + " draws its copies");
    assert.ok(fills.every((f) => f[3] === "lighter"), b + " adds light");
    assert.deepEqual(a.log[1], ["rect", C.BG_COLOUR.black, 0, 0, 400, 300]);
    // rainbow strokes change colour along the way
    assert.ok(new Set(fills.map((f) => f[1])).size > 3);
  }
  const light = fakeCtx();
  C.draw(light, C.normWork(work("aaaaaaa1", 1, { bg: "light" })), 200, 200);
  assert.ok(light.log.filter((e) => e[0] === "fill").every((f) => f[3] === "multiply"));
  // replay: fewer points, less drawn; fading strokes skip at alpha 0
  const wk = C.normWork(work("aaaaaaa1", 1, { st: [stroke(), stroke({ b: "ribbon" })] }));
  const full = fakeCtx(), part = fakeCtx(), gone = fakeCtx();
  C.draw(full, wk, 400, 300);
  C.draw(part, wk, 400, 300, { upto: { stroke: 0, point: 3 } });
  C.draw(gone, wk, 400, 300, { alphas: [0, 0] });
  assert.ok(part.log.length < full.log.length);
  assert.equal(gone.log.filter((e) => e[0] === "fill").length, 0);
});

test("fit: the work is contained and centred", () => {
  const f = C.fit({ w: 2000, h: 1000 }, 400, 400);
  assert.equal(f.k, 0.2); assert.equal(f.ox, 0); assert.equal(f.oy, 100);
});

test("surprise: a valid work inside the limits", () => {
  for (let s = 1; s < 30; s++) {
    const w = C.surprise(C.prng(s), 1280, 720);
    const n = C.normWork(Object.assign({ id: "asurpris", m: 1, name: "x" }, w));
    assert.ok(n, "seed " + s);
    assert.equal(n.st.length, w.st.length);
    assert.ok(w.st.length >= 1 && C.pointCount(w.st) <= C.MAX_POINTS);
  }
  assert.deepEqual(C.surprise(C.prng(9), 800, 800), C.surprise(C.prng(9), 800, 800));
});

test("mergeWorks: laws, LWW per work", () => {
  const A = { works: [work("aaaaaaa1", 5), work("abbbbbb1", 9, { name: "New" })], tombs: {} };
  const B = { works: [work("abbbbbb1", 3, { name: "Old" }), work("acccccc1", 4)], tombs: {} };
  const ab = C.mergeWorks(A, B), ba = C.mergeWorks(B, A);
  assert.deepEqual(ab, ba);
  assert.deepEqual(C.mergeWorks(ab, ab), ab);
  const D = { works: [work("adddddd1", 1)], tombs: { aaaaaaa1: 2 } };
  assert.deepEqual(C.mergeWorks(C.mergeWorks(A, B), D), C.mergeWorks(A, C.mergeWorks(B, D)));
  assert.equal(C.findWork(ab, "abbbbbb1").name, "New");
  assert.deepEqual(C.newestFirst(ab.works).map((x) => x.id), ["abbbbbb1", "aaaaaaa1", "acccccc1"]);
  const t1 = C.mergeWorks({ works: [work("aeeeeee1", 7, { bg: "blue" })] }, { works: [work("aeeeeee1", 7, { bg: "light" })] });
  const t2 = C.mergeWorks({ works: [work("aeeeeee1", 7, { bg: "light" })] }, { works: [work("aeeeeee1", 7, { bg: "blue" })] });
  assert.deepEqual(t1, t2);
  const before = JSON.stringify(A);
  C.mergeWorks(A, B);
  assert.equal(JSON.stringify(A), before, "inputs untouched");
});

test("mergeWorks: tombstones, undo, junk, the 60-work limit", () => {
  const base = { works: [work("aaaaaaa1", 5)], tombs: {} };
  const del = C.mergeWorks(base, { works: [], tombs: { aaaaaaa1: 5 } });
  assert.equal(del.works.length, 0);
  assert.equal(C.mergeWorks(del, { works: [work("aaaaaaa1", 6)] }).works.length, 1);
  assert.equal(C.mergeWorks(del, { works: [work("aaaaaaa1", 4)] }).works.length, 0);
  const junk = C.mergeWorks({ works: [null, 7, { id: "bad", m: 1 }, work("affffff1", -1), work("agggggg1", 2, { h: 5000 })],
                              tombs: { bad: 1, aiiiiii1: -1, ajjjjjj1: 4 } }, null);
  assert.deepEqual(junk.works, []);
  assert.deepEqual(junk.tombs, { ajjjjjj1: 4 });
  assert.deepEqual(C.mergeWorks(undefined, null), empty());
  const lots = [];
  for (let i = 0; i < 70; i++) lots.push(work("a" + String(i).padStart(7, "0"), 100 + i));
  const kept = C.mergeWorks({ works: lots }, null);
  assert.equal(kept.works.length, C.MAX_WORKS);
  assert.ok(!C.findWork(kept, "a0000000"), "the oldest go");
  assert.ok(C.findWork(kept, "a0000069"));
});

test("ids, colours and file names", () => {
  for (let i = 0; i < 20; i++) assert.match(C.newId(Math.random), /^a[a-z0-9]{12}$/);
  assert.equal(C.normColour("#ABCDEF"), "#abcdef");
  assert.equal(C.normColour("r007"), "r7");
  assert.equal(C.normColour("#abc"), null);
  assert.equal(C.rainbowHue("r120"), 120);
  assert.equal(C.hsl(0, 1, 0.5), "#ff0000");
  assert.equal(C.mix("#000000", "#ffffff", 0.5), "#808080");
  C.PALETTE_IDS.forEach((id) => assert.ok(C.PALETTES[id].every((c) => C.normColour(c) === c)));
  assert.equal(C.fileName("Βόρειο σέλας", "png"), "aura-Βόρειο-σέλας.png");
  assert.equal(C.fileName("../", "png"), "aura-work.png");
});

test("wiring: app, palette, sync, wallpaper picture, help", () => {
  const js = read("aura/aura.js"), html = read("aura/index.html");
  assert.ok(js.includes("inheritPalette") && js.includes("watchPalette"));            // guard G3
  assert.ok(/registerSlice\("aura", sliceGet, sliceSet, STORAGE_KEY, C\.mergeWorks\)/.test(js));
  assert.ok(js.includes('"oros-aura-data"') && js.includes('"oros-aura-prefs"') && js.includes('"oros-aura-draft"'));
  assert.equal((js.match(/window\.__orosOpenAt = /g) || []).length, 1);
  assert.ok(js.includes('__orosTakeTarget("aura")'));
  assert.ok(js.includes("api.setImage(blob, { bg: C.BG_COLOUR[work.bg] })"));
  assert.ok(html.indexOf("core.js") < html.indexOf("aura.js"));
  assert.ok(html.includes('id="cv"') && read("aura/aura.css").includes("touch-action: none"));
  for (const f of ["help.en.txt", "help.el.txt"]) assert.ok(fs.existsSync(path.join(__dirname, "..", "aura", f)));
  // the shell: a device picture as "Mine", never in the synced fields
  const sh = read("shell.js");
  assert.ok(sh.includes("setImage: function (blob, opts)"));
  assert.ok(sh.includes('var WP_PIC_KEY = "oros-wallpaper-pic"'));
  assert.ok(/var SHELL_FIELDS = \[[^\]]*\]/.exec(sh)[0].indexOf("pic") < 0, "the picture does not sync");
  assert.ok(sh.includes("if (wpPic()) wpPicClear();"), "a recipe made here replaces the picture");
  const setImage = sh.slice(sh.indexOf("setImage: function"), sh.indexOf("get: function", sh.indexOf("setImage: function")));
  assert.ok(!setImage.includes("noteLocalChange") && !setImage.includes("state.wallpaper ="), "nothing of it syncs");
  assert.ok(sh.includes('if (w.id === "custom" || wpPic()) wpCustomApply(desktop);'));
  assert.ok(sh.includes("wallpaper: pic ? \"custom\" : state.wallpaper"), "Settings shows it as Mine");
  // apps that check "is this my wallpaper" know about the picture
  assert.ok(read("wallpaper/wallpaper.js").includes("!cur.picture"));
  assert.ok(read("trees/trees.js").includes("!curW.picture"));
});
