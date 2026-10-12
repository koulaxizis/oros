// Pure engine of Photo Lab (photolab/): the document model and the
// synced project index (core.js), tiled pixels and tile files
// (tiles.js), undo under a budget (history.js), selections
// (select.js), brush / fill / gradient (paint.js), resampling and
// geometry (resample.js), adjustments (adjust.js, with the real
// designkit/fx.js) and projects on a disk double (store.js).
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const dir = (f) => path.join(__dirname, "..", f);
const C = require(dir("photolab/core.js"));
const T = require(dir("photolab/tiles.js"));
const H = require(dir("photolab/history.js"));
const S = require(dir("photolab/select.js"));
const P = require(dir("photolab/paint.js"));
const R = require(dir("photolab/resample.js"));
const A = require(dir("photolab/adjust.js"));
const ST = require(dir("photolab/store.js"));
const FX = require(dir("designkit/fx.js"));

// Deterministic random for ids.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function img(w, h, fill) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set(fill || [0, 0, 0, 0], i * 4);
  return { w, h, data: d };
}
function px(im, x, y) { const i = (y * im.w + x) * 4; return Array.from(im.data.slice(i, i + 4)); }
function count(m) { let n = 0; for (const v of m.data) if (v >= 128) n++; return n; }

// ---------- core ----------

test("core: new document has one raster background layer and normalises", () => {
  const d = C.newDoc({ w: 800, h: 600, name: "Holiday", now: 5 }, rng(1));
  assert.match(d.id, C.ID_RE);
  assert.equal(d.layers.length, 1);
  assert.equal(d.layers[0].k, "raster");
  assert.deepEqual(C.normDoc(d), d);
  assert.equal(JSON.stringify(C.normDoc(C.normDoc(d))), JSON.stringify(d));
});

test("core: bad documents and layers are refused or cleaned", () => {
  assert.equal(C.normDoc(null), null);
  assert.equal(C.normDoc({ id: "x", m: 1, w: 10, h: 10 }), null);
  assert.equal(C.normDoc({ id: "pabcdefgh", m: 1, w: 0, h: 10 }), null);
  assert.equal(C.normDoc({ id: "pabcdefgh", m: 1, w: 9000, h: 10 }), null);
  const d = C.normDoc({ id: "pabcdefgh", m: 1, w: 10, h: 10, name: "a\u0000b", layers: [
    { id: "labcd1", k: "raster", bl: "evil", op: 400, t: { "0,0": "zz", "1,0": "a".repeat(28), "x": "b".repeat(28) } },
    { id: "labcd1", k: "raster" },                         // duplicate id
    { id: "labcd2", k: "script" },                         // unknown kind
    { id: "labcd3", k: "text", tx: { s: "Hi\u0007", c: "red", z: 1e9 } }
  ] });
  assert.equal(d.name, "a b");
  assert.equal(d.layers.length, 2);
  assert.equal(d.layers[0].bl, "normal");
  assert.equal(d.layers[0].op, 100);
  assert.deepEqual(d.layers[0].t, { "1,0": "a".repeat(28) });
  assert.equal(d.layers[1].tx.s, "Hi");
  assert.equal(d.layers[1].tx.c, "#000000");
  assert.equal(d.layers[1].tx.z, 2000);
});

test("core: 16 native blend modes, tilesOf, moveLayer", () => {
  assert.equal(C.BLENDS.length, 16);
  assert.equal(C.blendOp("dodge"), "color-dodge");
  assert.equal(C.blendOp("nope"), "source-over");
  const d = C.normDoc({ id: "pabcdefgh", m: 1, w: 10, h: 10, layers: [
    { id: "la1111", k: "raster", t: { "0,0": "1".repeat(28), "0,1": "2".repeat(28) } },
    { id: "la2222", k: "raster", t: { "0,0": "1".repeat(28) } },
    { id: "la3333", k: "shape" }
  ] });
  assert.deepEqual(C.tilesOf(d), ["1".repeat(28), "2".repeat(28)]);
  assert.deepEqual(C.moveLayer(d.layers, 0, 2).map((l) => l.id), ["la2222", "la3333", "la1111"]);
  assert.equal(C.findLayer(d, "la3333"), 2);
});

test("core: size limits per device are never silent", () => {
  const ph = C.limitsFor(true), dk = C.limitsFor(false);
  assert.deepEqual(C.fitSize(4000, 3000, dk), { w: 4000, h: 3000, scaled: false });
  const f = C.fitSize(6000, 4000, ph);
  assert.equal(f.scaled, true);
  assert.ok(f.w <= 4096 && f.w * f.h <= 16777216);
  assert.equal(C.fitSize(12000, 100, dk).w, 8192);
});

test("core: index merge is symmetric, idempotent, canonical (R5, R17, R26)", () => {
  const a = { projects: [{ id: "pbbbbbb", m: 5, name: "B", w: 10, h: 10 }, { id: "paaaaaa", m: 2, name: "A", w: 10, h: 10 }], tombs: {} };
  const b = { projects: [{ id: "paaaaaa", m: 3, name: "A2", w: 20, h: 10 }, { id: "pcccccc", m: 1, name: "C", w: 1, h: 1 }], tombs: { pbbbbbb: 5 } };
  const ab = C.mergeIndex(a, b), ba = C.mergeIndex(b, a);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba));
  assert.deepEqual(ab.projects.map((p) => p.id), ["paaaaaa", "pcccccc"]);
  assert.equal(ab.projects[0].name, "A2");
  assert.equal(JSON.stringify(C.mergeIndex(ab, ab)), JSON.stringify(ab));
  // A newer edit resurrects over an older tombstone.
  const c = C.mergeIndex(ab, { projects: [{ id: "pbbbbbb", m: 9, name: "B", w: 10, h: 10 }] });
  assert.ok(c.projects.some((p) => p.id === "pbbbbbb"));
  const d = C.newDoc({ w: 10, h: 10, now: 7 }, rng(2));
  let ix = C.upsertEntry(C.emptyIndex(), d);
  assert.equal(ix.projects.length, 1);
  ix = C.removeEntry(ix, d.id, 8);
  assert.equal(ix.projects.length, 0);
  assert.equal(ix.tombs[d.id], 8);
});

// ---------- tiles ----------

test("tiles: rectangles across tile borders and negative coordinates", () => {
  const s = T.create();
  const src = img(300, 20, [10, 20, 30, 255]);
  T.writeRect(s, -10, 250, src);
  assert.deepEqual([...s.tiles.keys()].sort(), ["-1,0", "-1,1", "0,0", "0,1", "1,0", "1,1"]);
  const back = T.readRect(s, -10, 250, 300, 20);
  assert.deepEqual(back.data, src.data);
  assert.deepEqual(T.contentBounds(s), { x: -10, y: 250, w: 300, h: 20 });
  // Writing transparency drops the tiles again.
  T.writeRect(s, -10, 250, img(300, 20));
  assert.equal(s.tiles.size, 0);
  assert.ok(Object.keys(s.dirty).length >= 6);
  // An all-transparent write never creates a tile.
  const s2 = T.create();
  T.writeRect(s2, 0, 0, img(10, 10));
  assert.equal(s2.tiles.size, 0);
});

test("tiles: snapshots restore exactly; names follow content", () => {
  const s = T.create();
  T.writeRect(s, 0, 0, img(10, 10, [1, 2, 3, 255]));
  const keys = T.keysIn(0, 0, 600, 10);
  const before = T.snapshot(s, keys);
  T.writeRect(s, 0, 0, img(600, 10, [9, 9, 9, 255]));
  T.restore(s, before);
  assert.deepEqual(px(T.readRect(s, 0, 0, 600, 10), 5, 5), [1, 2, 3, 255]);
  assert.equal(s.tiles.has("1,0"), false);
  const t = s.tiles.get("0,0");
  assert.match(T.tileName(t), /^[0-9a-f]{28}$/);
  assert.equal(T.tileName(t), T.tileName(new Uint8ClampedArray(t)));
  const u = new Uint8ClampedArray(t); u[12345] ^= 1;
  assert.notEqual(T.tileName(u), T.tileName(t));
});

test("tiles: tile files round-trip losslessly and garbage is refused", async () => {
  const t = new Uint8ClampedArray(256 * 256 * 4);
  for (let i = 0; i < t.length; i++) t[i] = (i * 7) & 255;
  t[3] = 1; t[4] = 200;                                   // low alpha keeps its colour
  const bytes = await T.encodeTile(t);
  assert.ok(bytes.length < t.length);
  assert.deepEqual(await T.decodeTile(bytes), t);
  await assert.rejects(T.decodeTile(new Uint8Array([1, 2, 3, 4, 5])), /tile/);
  // A valid stream that inflates past one tile is cut off.
  const big = await T.encodeTile(new Uint8ClampedArray(256 * 256 * 8));
  await assert.rejects(T.decodeTile(big), /tile/);
});

// ---------- history ----------

test("history: undo, redo, jump, budget drops the oldest", () => {
  const h = H.create(1000);
  let v = 0;
  const step = (n, bytes) => ({ label: "s" + n, bytes, undo() { v -= n; }, redo() { v += n; } });
  [1, 2, 3].forEach((n) => { v += n; h.push(step(n, 100)); });
  assert.equal(h.undo(), "s3"); assert.equal(v, 3);
  assert.equal(h.redo(), "s3"); assert.equal(v, 6);
  h.goTo(1); assert.equal(v, 1);
  assert.deepEqual(h.list(), { done: ["s1"], undone: ["s2", "s3"] });
  h.push(step(10, 100)); v += 10;                         // a new step clears redo
  assert.equal(h.canRedo(), false);
  h.push(step(0, 900));
  assert.equal(h.dropped(), 1);
  assert.deepEqual(h.list().done, ["s10", "s0"]);
  // tileStep restores surfaces.
  const s = T.create();
  const keys = T.keysIn(0, 0, 4, 4);
  const b = T.snapshot(s, keys);
  T.writeRect(s, 0, 0, img(4, 4, [5, 5, 5, 255]));
  const st = H.tileStep("paint", T, s, b, T.snapshot(s, keys));
  st.undo(); assert.equal(s.tiles.size, 0);
  st.redo(); assert.equal(s.tiles.size, 1);
});

// ---------- select ----------

test("select: shapes cover the right areas", () => {
  assert.equal(count(S.rect(100, 100, { x: 10, y: 10, w: 30, h: 20 })), 600);
  const e = S.ellipse(200, 200, { x: 0, y: 0, w: 200, h: 100 });
  assert.ok(Math.abs(count(e) - Math.PI * 100 * 50) < 150);
  const tri = S.polygon(100, 100, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }]);
  assert.ok(Math.abs(count(tri) - 5000) < 120);
  assert.equal(count(S.rect(10, 10, { x: -5, y: -5, w: 100, h: 100 })), 100);
});

test("select: magic wand, contiguous or global", () => {
  const im = img(10, 10, [255, 255, 255, 255]);
  for (let y = 0; y < 10; y++) im.data.set([0, 0, 0, 255], (y * 10 + 5) * 4);     // black wall
  im.data.set([250, 250, 250, 255], (0 * 10 + 8) * 4);                              // near white
  const c = S.wand(im, 0, 0, 0, true);
  assert.equal(count(c), 50);
  assert.equal(count(S.wand(im, 0, 0, 0, false)), 89);
  assert.equal(count(S.wand(im, 0, 0, 10, false)), 90);
  assert.equal(count(S.wand(im, 50, 50, 0, true)), 0);
});

test("select: combine, invert, feather, grow, bounds, outline", () => {
  const a = S.rect(20, 20, { x: 0, y: 0, w: 10, h: 10 }), b = S.rect(20, 20, { x: 5, y: 5, w: 10, h: 10 });
  assert.equal(count(S.combine(a, b, "add")), 175);
  assert.equal(count(S.combine(a, b, "sub")), 75);
  assert.equal(count(S.combine(a, b, "and")), 25);
  assert.equal(S.combine(a, b, "replace"), b);
  assert.equal(S.combine(null, b, "sub"), null);
  assert.equal(S.combine(null, b, "add"), b);
  assert.equal(count(S.invert(a)), 300);
  const f = S.feather(S.rect(40, 40, { x: 10, y: 10, w: 20, h: 20 }), 6);
  assert.ok(f.data[20 * 40 + 20] === 255 && f.data[20 * 40 + 10] > 0 && f.data[20 * 40 + 10] < 255);
  assert.equal(count(S.grow(S.rect(40, 40, { x: 10, y: 10, w: 20, h: 20 }), 2)), 24 * 24);
  assert.equal(count(S.grow(S.rect(40, 40, { x: 10, y: 10, w: 20, h: 20 }), -2)), 16 * 16);
  assert.equal(count(S.grow(S.all(10, 10), -2)), 100);               // the canvas edge does not erode
  assert.deepEqual(S.bounds(b), { x: 5, y: 5, w: 10, h: 10 });
  assert.equal(S.isEmpty(S.make(5, 5)), true);
  assert.equal(S.outline(a).length, 4);
});

// ---------- paint ----------

test("paint: one stroke never passes its opacity; undo data is exact", () => {
  const s = T.create();
  const st = P.stroke(T, s, { color: [255, 0, 0], size: 20, hard: 100, opacity: 50, flow: 100 });
  st.dab(50, 50); st.dab(50, 50); st.lineTo(60, 50); st.lineTo(50, 50);
  const r = st.end();
  const p = px(T.readRect(s, 0, 0, 100, 100), 50, 50);
  assert.deepEqual(p, [255, 0, 0, 128]);
  T.restore(s, r.before);
  assert.equal(s.tiles.size, 0);
});

test("paint: eraser, selection clip, layer offset, lock alpha", () => {
  const s = T.create();
  T.writeRect(s, 0, 0, img(40, 40, [0, 0, 255, 255]));
  const mask = S.rect(40, 40, { x: 0, y: 0, w: 20, h: 40 });
  const er = P.stroke(T, s, { size: 80, hard: 100, opacity: 100, erase: true, mask });
  er.dab(20, 20); er.end();
  const out = T.readRect(s, 0, 0, 40, 40);
  assert.equal(px(out, 5, 20)[3], 0);
  assert.equal(px(out, 30, 20)[3], 255);
  // Offset: canvas (110, 10) is layer (10, 10) when the layer sits at 100, 0.
  const s2 = T.create();
  const b = P.stroke(T, s2, { color: [0, 255, 0], size: 4, hard: 100, ox: 100, oy: 0 });
  b.dab(110, 10); b.end();
  assert.equal(px(T.readRect(s2, 0, 0, 20, 20), 10, 10)[1], 255);
  // Lock alpha paints only where there are pixels.
  const s3 = T.create();
  T.writeRect(s3, 0, 0, img(5, 5, [0, 0, 0, 100]));
  const la = P.stroke(T, s3, { color: [255, 255, 255], size: 30, hard: 100, lockAlpha: true });
  la.dab(5, 5); la.end();
  const o3 = T.readRect(s3, 0, 0, 10, 10);
  assert.deepEqual(px(o3, 2, 2), [255, 255, 255, 100]);
  assert.equal(px(o3, 8, 8)[3], 0);
});

test("paint: fill area and gradients", () => {
  const s = T.create();
  const area = S.rect(30, 30, { x: 0, y: 0, w: 300, h: 300 });
  const r = P.fillArea(T, s, area, { color: [1, 2, 3], opacity: 100 });
  assert.deepEqual(px(T.readRect(s, 0, 0, 30, 30), 29, 29), [1, 2, 3, 255]);
  assert.equal(r.keys.length, 1);
  const g = T.create();
  P.gradient(T, g, 100, 10, { type: "linear", x0: 0, y0: 0, x1: 100, y1: 0, c0: [0, 0, 0, 255], c1: [255, 255, 255, 255] });
  const gi = T.readRect(g, 0, 0, 100, 10);
  assert.ok(px(gi, 0, 5)[0] < 5 && px(gi, 99, 5)[0] > 250 && Math.abs(px(gi, 50, 5)[0] - 129) < 4);
  assert.equal(P.gradientAt({ type: "radial", x0: 0, y0: 0, x1: 10, y1: 0 }, 5, 0), 0.5);
  assert.deepEqual(P.rgbOf("#ff8000"), [255, 128, 0]);
});

// ---------- resample ----------

test("resample: area average, alpha-weighted edges, size", () => {
  const im = img(4, 4, [200, 100, 0, 255]);
  const r = R.resize(im, 2, 2);
  assert.deepEqual(px(r, 1, 1), [200, 100, 0, 255]);
  // Transparent black next to red must not make the red darker.
  const e = img(8, 1, [255, 0, 0, 255]);
  for (let x = 4; x < 8; x++) e.data.set([0, 0, 0, 0], x * 4);
  const up = R.resize(e, 16, 1);
  for (let x = 0; x < 16; x++) if (px(up, x, 0)[3] > 0) assert.equal(px(up, x, 0)[0], 255);
  const big = R.resize(img(10, 7, [1, 1, 1, 255]), 33, 21);
  assert.equal(big.w, 33); assert.equal(big.h, 21);
});

test("resample: rotate, flip, canvas size, trim, crop, transform", () => {
  const im = img(3, 2);
  im.data.set([9, 0, 0, 255], 0);                         // top-left marker
  const r1 = R.rot90(im, 1);
  assert.equal(r1.w, 2); assert.equal(r1.h, 3);
  assert.deepEqual(px(r1, 1, 0), [9, 0, 0, 255]);
  assert.deepEqual(R.rot90(R.rot90(r1, 2), 1).data, im.data);
  assert.deepEqual(R.flip(R.flip(im, true), true).data, im.data);
  assert.deepEqual(px(R.flip(im, true), 2, 0), [9, 0, 0, 255]);
  const cr = R.canvasResize(im, 7, 6, "br");
  assert.deepEqual([cr.dx, cr.dy], [4, 4]);
  assert.deepEqual(px(cr.img, 4, 4), [9, 0, 0, 255]);
  assert.deepEqual(R.trimRect(cr.img), { x: 4, y: 4, w: 1, h: 1 });
  assert.deepEqual(px(R.crop(cr.img, { x: 4, y: 4, w: 2, h: 2 }), 0, 0), [9, 0, 0, 255]);
  assert.deepEqual(R.rotate(im, 90).data, r1.data);
  const id = R.transform(im, [1, 0, 0, 1, 0, 0], 3, 2);
  assert.deepEqual(px(id, 0, 0), [9, 0, 0, 255]);
  const rot = R.rotate(img(10, 10, [5, 5, 5, 255]), 45);
  assert.equal(rot.w, 15);
});

// ---------- adjust ----------

test("adjust: invert, gray, threshold, posterize, hsl, levels, fx presets", () => {
  const base = () => { const m = img(2, 1, [200, 100, 50, 255]); m.data.set([10, 20, 30, 0], 4); return m; };
  const a = base(); A.run(a, "invert"); assert.deepEqual(px(a, 0, 0), [55, 155, 205, 255]);
  assert.deepEqual(px(a, 1, 0), [10, 20, 30, 0]);           // transparent pixels untouched
  A.run(a, "invert"); assert.deepEqual(a.data, base().data);
  const g = base(); A.run(g, "gray"); const p = px(g, 0, 0); assert.ok(p[0] === p[1] && p[1] === p[2]);
  const t = base(); A.run(t, "threshold", { t: 128 }); assert.deepEqual(px(t, 0, 0), [0, 0, 0, 255]);
  const q = base(); A.run(q, "posterize", { n: 2 }); assert.deepEqual(px(q, 0, 0), [255, 0, 0, 255]);
  const h = base(); A.run(h, "hsl", { h: 0, s: 0, l: 0 }); assert.deepEqual(h.data, base().data);
  const h2 = base(); A.run(h2, "hsl", { h: 120 }); assert.ok(px(h2, 0, 0)[1] > px(h2, 0, 0)[0]);
  assert.equal(A.levelsLut({ ib: 50, iw: 200 })[50], 0);
  assert.equal(A.levelsLut({ ib: 50, iw: 200 })[200], 255);
  const f = base(); assert.equal(A.run(f, "preset", { id: "mono" }, FX), true);
  const fp = px(f, 0, 0); assert.ok(Math.abs(fp[0] - fp[2]) <= 1);
  assert.equal(A.run(base(), "preset", { id: "nope" }, FX), false);
  const before = img(4, 1, [0, 0, 0, 255]), after = img(4, 1, [255, 255, 255, 255]);
  const mask = S.rect(4, 1, { x: 0, y: 0, w: 2, h: 1 });
  A.masked(before, after, mask, 0, 0);
  assert.deepEqual([px(after, 0, 0)[0], px(after, 3, 0)[0]], [255, 0]);
  assert.equal(A.histogram(img(3, 3, [255, 255, 255, 255]))[255], 9);
});

// ---------- store ----------

function memFs(now) {
  const files = new Map();
  const err = (code) => Object.assign(new Error(code), { code });
  const blob = (data) => new Blob([data]);
  return {
    files,
    clock: { now: now || 1000 },
    read(p) { return files.has(p) ? Promise.resolve(blob(files.get(p).data)) : Promise.reject(err("ENOENT")); },
    write(p, d) {
      const v = d instanceof Blob ? d : (typeof d === "string" ? d : new Uint8Array(d));
      return Promise.resolve(v instanceof Blob ? v.arrayBuffer().then((b) => new Uint8Array(b)) : v)
        .then((data) => { files.set(p, { data, mtime: this.clock.now }); });
    },
    stat(p) { return files.has(p) ? Promise.resolve({ path: p, size: 1, mtime: files.get(p).mtime }) : Promise.reject(err("ENOENT")); },
    ls(p) {
      const pre = p + "/", out = new Set();
      for (const k of files.keys()) if (k.startsWith(pre)) out.add(k.slice(pre.length).split("/")[0]);
      if (!out.size) return Promise.reject(err("ENOENT"));
      return Promise.resolve([...out].sort().map((name) => ({ name, dir: false })));
    },
    rm(p) {
      let any = false;
      for (const k of [...files.keys()]) if (k === p || k.startsWith(p + "/")) { files.delete(k); any = true; }
      return any ? Promise.resolve() : Promise.reject(err("ENOENT"));
    }
  };
}

test("store: save writes only new tiles, load round-trips", async () => {
  const fs = memFs();
  const doc = C.newDoc({ w: 600, h: 300, now: 10 }, rng(3));
  const s = T.create();
  T.writeRect(s, 0, 0, img(600, 10, [7, 8, 9, 255]));
  const surfaces = { [doc.layers[0].id]: s };
  const r1 = await ST.save(fs, C, T, doc, surfaces, {});
  assert.equal(r1.written, 2);                            // two full tiles are identical: one file, + the partial one
  assert.equal(Object.keys(r1.doc.layers[0].t).length, 3);
  const r2 = await ST.save(fs, C, T, r1.doc, surfaces, {});
  assert.equal(r2.written, 0);
  const back = await ST.load(fs, C, T, doc.id);
  assert.equal(back.missing, 0);
  assert.deepEqual(T.readRect(back.surfaces[doc.layers[0].id], 0, 0, 600, 10).data, img(600, 10, [7, 8, 9, 255]).data);
  // A named tile that vanished from the disk (another device's gc) is rewritten.
  for (const k of [...fs.files.keys()]) if (k.endsWith(".plt")) fs.files.delete(k);
  const r3 = await ST.save(fs, C, T, back.doc, back.surfaces, {});
  assert.equal(r3.written, 2);
  // A tile not on this device yet counts as missing, never as an error.
  for (const k of [...fs.files.keys()]) if (k.endsWith(".plt")) fs.files.delete(k);
  const miss = await ST.load(fs, C, T, doc.id);
  assert.equal(miss.missing, 3);
});

test("store: a corrupt doc is refused; a tampered tile is missing", async () => {
  const fs = memFs();
  await fs.write(ST.dirOf("pzzzzzz") + "/doc.json", "{nope");
  await assert.rejects(ST.load(fs, C, T, "pzzzzzz"), /doc/);
  const doc = C.newDoc({ w: 10, h: 10, now: 1 }, rng(4));
  const s = T.create();
  T.writeRect(s, 0, 0, img(10, 10, [1, 1, 1, 255]));
  const r = await ST.save(fs, C, T, doc, { [doc.layers[0].id]: s }, {});
  const name = r.doc.layers[0].t["0,0"];
  const other = new Uint8ClampedArray(256 * 256 * 4); other[0] = 1;
  await fs.write(ST.tilePath(doc.id, name), await T.encodeTile(other));
  assert.equal((await ST.load(fs, C, T, doc.id)).missing, 1);
});

test("store: conflict copies become their own project; gc keeps what any doc needs", async () => {
  const fs = memFs(1000);
  const doc = C.newDoc({ w: 10, h: 10, now: 1 }, rng(5));
  const lid = doc.layers[0].id;
  const s = T.create();
  T.writeRect(s, 0, 0, img(10, 10, [1, 1, 1, 255]));
  const r = await ST.save(fs, C, T, doc, { [lid]: s }, {});
  // The other device's version, kept by Vault Drive as a conflict copy.
  const s2 = T.create();
  T.writeRect(s2, 0, 0, img(10, 10, [2, 2, 2, 255]));
  const other = JSON.parse(JSON.stringify(r.doc));
  const oname = T.tileName(s2.tiles.get("0,0"));
  other.layers[0].t["0,0"] = oname;
  await fs.write(ST.tilePath(doc.id, oname), await T.encodeTile(s2.tiles.get("0,0")));
  const cfile = "doc (conflict 20261012-101010).json";
  await fs.write(ST.dirOf(doc.id) + "/" + cfile, JSON.stringify(other));
  // An orphan tile, old enough to go.
  const orphan = new Uint8ClampedArray(256 * 256 * 4); orphan[3] = 9;
  await fs.write(ST.tilePath(doc.id, T.tileName(orphan)), await T.encodeTile(orphan));
  fs.clock.now = 1000 + ST.GRACE + 5;
  // A fresh orphan stays.
  const fresh = new Uint8ClampedArray(256 * 256 * 4); fresh[3] = 8;
  await fs.write(ST.tilePath(doc.id, T.tileName(fresh)), await T.encodeTile(fresh));
  assert.equal(await ST.gc(fs, C, doc.id, fs.clock.now), 1);
  assert.ok(fs.files.has(ST.tilePath(doc.id, oname)));     // the conflict copy still needs it
  assert.deepEqual(await ST.conflicts(fs, doc.id), [cfile]);
  const split = await ST.splitConflict(fs, C, doc.id, cfile, "pnewnew1", "(other device)", 50);
  assert.equal(split.id, "pnewnew1");
  assert.match(split.name, /\(other device\)$/);
  assert.deepEqual(await ST.conflicts(fs, doc.id), []);
  const loaded = await ST.load(fs, C, T, "pnewnew1");
  assert.equal(loaded.missing, 0);
  assert.deepEqual(px(T.readRect(loaded.surfaces[lid], 0, 0, 10, 10), 0, 0), [2, 2, 2, 255]);
  // An unreadable doc stops gc altogether.
  await fs.write(ST.dirOf(doc.id) + "/doc (conflict x).json", "garbage");
  assert.equal(await ST.gc(fs, C, doc.id, fs.clock.now + ST.GRACE * 2), 0);
  await assert.rejects(ST.splitConflict(fs, C, doc.id, "../doc.json", "pq123456", "x", 1), /doc/);
});
