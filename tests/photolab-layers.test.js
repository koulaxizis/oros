// Photo Lab wave 2C: layer masks, adjustment layers and layer styles
// in the document model (photolab/core.js), the new adjustments
// (photolab/adjust.js), mask tiles (photolab/tiles.js) and masks on
// disk (photolab/store.js).
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const dir = (f) => path.join(__dirname, "..", f);
const C = require(dir("photolab/core.js"));
const T = require(dir("photolab/tiles.js"));
const A = require(dir("photolab/adjust.js"));
const ST = require(dir("photolab/store.js"));

const one = (r, g, b, a) => ({ w: 1, h: 1, data: new Uint8ClampedArray([r, g, b, a == null ? 255 : a]) });
const rgbOf = (im) => Array.from(im.data.slice(0, 3));

// ---------- core ----------

test("core: adjustment layers keep a known type and clamped parameters", () => {
  const L = C.normLayer({ id: "llay1", k: "adj", aj: { id: "curves", p: { s: 999, m: "x", h: 10.6 } }, x: 5, y: 6 });
  assert.equal(L.k, "adj");
  assert.deepEqual(L.aj, { id: "curves", p: { s: 255, m: 128, h: 11 } });
  assert.equal(L.x, 5);                                    // x, y place the mask
  assert.equal(L.name, "Adjustment");
  const bad = C.normLayer({ id: "llay2", k: "adj", aj: { id: "<script>", p: { ib: -5 } } });
  assert.equal(bad.aj.id, "levels");
  assert.equal(bad.aj.p.ib, 0);
  const lv = C.normLayer({ id: "llay3", k: "adj", aj: { id: "levels", p: { g: 1.234 } } });
  assert.equal(lv.aj.p.g, 1.23);
  const ph = C.normLayer({ id: "llay4", k: "adj", aj: { id: "photo", p: { c: "red", d: 300 } } });
  assert.deepEqual(ph.aj.p, { c: "#ec8a00", d: 100 });
  for (const id of C.ADJ_IDS) {
    const n = C.normAdj({ id });
    assert.equal(n.id, id);
    assert.ok(A.IDS.indexOf(id) >= 0, id + " runs in adjust.js");
  }
});

test("core: masks only on picture and adjustment layers, never sharing an id", () => {
  const mk = { id: "lmsk1", t: { "0,0": "a".repeat(28) }, on: 0, bg: 0 };
  assert.deepEqual(C.normLayer({ id: "llay1", k: "raster", mk }).mk, { id: "lmsk1", t: { "0,0": "a".repeat(28) }, on: 0, bg: 0 });
  assert.equal(C.normLayer({ id: "llay1", k: "adj", mk }).mk.id, "lmsk1");
  assert.equal(C.normLayer({ id: "llay1", k: "text", tx: { s: "hi" }, mk }).mk, undefined);
  assert.equal(C.normLayer({ id: "llay1", k: "raster", mk: { id: "llay1" } }).mk, undefined);
  assert.equal(C.normLayer({ id: "llay1", k: "raster", mk: { id: "../x" } }).mk, undefined);
  assert.equal(C.normLayer({ id: "llay1", k: "raster", mk: { id: "lmsk2", bg: 7 } }).mk.bg, 255);
  // A mask id may not repeat a layer id or another mask in the doc.
  const doc = C.normDoc({ id: "pproj01", m: 1, w: 10, h: 10, layers: [
    { id: "llay1", k: "raster", mk: { id: "lmsk1" } },
    { id: "lmsk1", k: "raster" },
    { id: "llay2", k: "raster", mk: { id: "lmsk1" } },
    { id: "llay3", k: "raster", mk: { id: "lmsk3" } }
  ] });
  assert.deepEqual(doc.layers.map((L) => L.id), ["llay1", "llay3"]);
});

test("core: styles keep only known effects, clamped; fxPad covers their reach", () => {
  const L = C.normLayer({ id: "llay1", k: "raster", fx: { sh: { d: 20, s: 5, op: 300 }, st: { w: 0, c: "#00ff00" }, zz: {} } });
  assert.deepEqual(Object.keys(L.fx).sort(), ["sh", "st"]);
  assert.equal(L.fx.sh.op, 100);
  assert.equal(L.fx.sh.c, "#000000");
  assert.equal(L.fx.st.w, 1);
  assert.equal(L.fx.st.c, "#00ff00");
  assert.equal(C.fxPad(L.fx), 30);
  assert.equal(C.fxPad(null), 0);
  assert.equal(C.normLayer({ id: "llay1", k: "raster", fx: {} }).fx, undefined);
  assert.equal(C.normLayer({ id: "llay1", k: "adj", fx: { co: {} } }).fx, undefined);
  assert.ok(C.normLayer({ id: "llay1", k: "text", tx: { s: "a" }, fx: { co: {} } }).fx.co);
});

test("core: tile owners are picture layers and masks; tilesOf lists both", () => {
  const n1 = "1".repeat(28), n2 = "2".repeat(28), n3 = "3".repeat(28);
  const doc = C.normDoc({ id: "pproj01", m: 1, w: 10, h: 10, layers: [
    { id: "llay1", k: "raster", t: { "0,0": n1 }, mk: { id: "lmsk1", t: { "0,0": n2 } } },
    { id: "llay2", k: "adj", mk: { id: "lmsk2", t: { "1,0": n3 } } },
    { id: "llay3", k: "text", tx: { s: "a" } }
  ] });
  assert.deepEqual(C.tileOwners(doc).map((o) => o.id), ["llay1", "lmsk1", "lmsk2"]);
  assert.equal(C.ownerOf(doc, "lmsk2"), doc.layers[1].mk);
  assert.equal(C.ownerOf(doc, "llay3"), null);
  assert.deepEqual(C.tilesOf(doc), [n1, n2, n3]);
});

// ---------- adjust ----------

test("adjust: curves through the default points change nothing; raised points brighten", () => {
  const id = A.curvesLut({ s: 64, m: 128, h: 192 });
  for (let v = 0; v < 256; v++) assert.equal(id[v], v);
  const up = A.curvesLut({ s: 100, m: 170, h: 220 });
  for (let v = 1; v < 256; v++) assert.ok(up[v] >= up[v - 1], "monotone");
  assert.equal(up[128], 170);
  assert.equal(up[0], 0); assert.equal(up[255], 255);
});

test("adjust: brightness / contrast, balance, photo filter, gradient map", () => {
  assert.equal(A.bcLut({ b: 0, c: 0 })[77], 77);
  assert.equal(A.bcLut({ b: 20, c: 0 })[77], 97);
  assert.ok(A.bcLut({ b: 0, c: 50 })[200] > 200 && A.bcLut({ b: 0, c: 50 })[50] < 50);

  const g = one(128, 128, 128);
  A.run(g, "balance", { r: 100, g: 0, b: -100 });
  assert.ok(g.data[0] > 128 && g.data[1] === 128 && g.data[2] < 128);
  const blk = one(0, 0, 0);
  A.run(blk, "balance", { r: 100 });
  assert.deepEqual(rgbOf(blk), [0, 0, 0]);                 // midtones only

  const p = one(100, 150, 200);
  A.run(p, "photo", { c: "#ec8a00", d: 100 });
  assert.ok(p.data[0] > p.data[2]);                        // warm
  const lumBefore = 0.2126 * 100 + 0.7152 * 150 + 0.0722 * 200;
  const lumAfter = 0.2126 * p.data[0] + 0.7152 * p.data[1] + 0.0722 * p.data[2];
  assert.ok(Math.abs(lumAfter - lumBefore) < 3, "keeps the brightness");

  const m = one(0, 0, 0), w = one(255, 255, 255);
  A.run(m, "gradmap", { c0: "#102030", c1: "#ffeedd" });
  A.run(w, "gradmap", { c0: "#102030", c1: "#ffeedd" });
  assert.deepEqual(rgbOf(m), [16, 32, 48]);
  assert.deepEqual(rgbOf(w), [255, 238, 221]);
  // Alpha is never changed, transparent pixels are left alone.
  const clear = one(10, 20, 30, 0);
  A.run(clear, "gradmap", { c0: "#ffffff", c1: "#ffffff" });
  assert.deepEqual(Array.from(clear.data), [10, 20, 30, 0]);
});

// ---------- tiles ----------

test("tiles: a mask tile reads as its grey, the background where unpainted", () => {
  const s = T.create();
  // left pixel: white, opaque; next: black at half alpha; rest unpainted
  T.writeRect(s, 0, 0, { w: 2, h: 1, data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 128]) });
  const t = T.get(s, 0, 0);
  const a255 = T.maskAlpha(t, 255), a0 = T.maskAlpha(t, 0);
  assert.equal(a255[3], 255); assert.equal(a255[7], 127); assert.equal(a255[11], 255);
  assert.equal(a0[3], 255); assert.equal(a0[7], 0); assert.equal(a0[11], 0);
  assert.equal(a0[0], 0);                                  // rgb stays black
  assert.equal(T.maskAlpha(null, 255)[3], 255);
  assert.equal(T.maskAlpha(null, 0)[3], 0);
  assert.equal(T.maskAt(s, 0, 0, 0), 255);
  assert.equal(T.maskAt(s, 255, 1, 0), 127);
  assert.equal(T.maskAt(s, 0, 5000, -3), 0);
  assert.equal(T.maskAt(s, 255, -1, 0), 255);
});

// ---------- store ----------

function memFs() {
  const files = new Map();
  const err = (code) => Object.assign(new Error(code), { code });
  return {
    files,
    read(p) { return files.has(p) ? Promise.resolve(new Blob([files.get(p)])) : Promise.reject(err("ENOENT")); },
    write(p, d) { files.set(p, typeof d === "string" ? d : new Uint8Array(d)); return Promise.resolve(); },
    stat(p) { return files.has(p) ? Promise.resolve({ path: p, size: 1, mtime: 1 }) : Promise.reject(err("ENOENT")); },
    ls() { return Promise.reject(err("ENOENT")); },
    rm(p) { files.delete(p); return Promise.resolve(); }
  };
}

test("store: masks save their own tiles and load back", async () => {
  const fs = memFs();
  const doc = C.newDoc({ w: 300, h: 100, now: 10 });
  const L = doc.layers[0];
  L.mk = { id: C.newLayerId(), t: {}, on: 1, bg: 0 };
  const px = T.create(), mk = T.create();
  T.writeRect(px, 0, 0, { w: 2, h: 1, data: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]) });
  T.writeRect(mk, 290, 0, { w: 1, h: 1, data: new Uint8ClampedArray([200, 200, 200, 255]) });
  const r = await ST.save(fs, C, T, doc, { [L.id]: px, [L.mk.id]: mk }, {});
  assert.equal(r.written, 2);
  assert.deepEqual(Object.keys(r.doc.layers[0].mk.t), ["1,0"]);
  const back = await ST.load(fs, C, T, doc.id);
  assert.equal(back.missing, 0);
  assert.equal(back.doc.layers[0].mk.bg, 0);
  assert.equal(T.maskAt(back.surfaces[L.mk.id], 0, 290, 0), 200);
  assert.equal(T.maskAt(back.surfaces[L.mk.id], 0, 289, 0), 0);
  assert.deepEqual(Array.from(T.readRect(back.surfaces[L.id], 0, 0, 1, 1).data), [1, 2, 3, 255]);
});
