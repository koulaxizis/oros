// Photo Lab .orosphoto (photolab/package.js + bundle.js): the PNG
// writer/reader, content.json build/parse and a full bundle round
// trip. The canvas parts (preview, thumbnail) are covered in the
// real-browser run.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const PKG = require("../photolab/package.js");
const C = require("../photolab/core.js");
const T = require("../photolab/tiles.js");
const B = require("../bundle.js");

function img(w, h, f) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4);
  return { w, h, data: d };
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

test("PNG: our own writer and reader are lossless (straight alpha)", async () => {
  const a = img(37, 19, (x, y) => [(x * 7) & 255, (y * 13) & 255, (x * y) & 255, (x + y * 3) % 256]);
  const png = await PKG.encodePng(a);
  assert.deepEqual([...png.subarray(1, 4)], [80, 78, 71]);
  const b = await PKG.decodePng(png);
  assert.equal(b.w, 37); assert.equal(b.h, 19);
  assert.ok(same(a.data, b.data));
  // zlib in Node reads the same pixels (a valid PNG stream)
  const idat = png.subarray(8 + 25 + 8, png.length - 12 - 4);
  assert.equal(zlib.inflateSync(Buffer.from(idat)).length, (37 * 4 + 1) * 19);
});

test("PNG: grey, RGB and palette files from other programs", async () => {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), Buffer.from(d)]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  function pngOf(ct, w, h, rows, extra) {
    const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = ct;
    return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih)].concat(extra || [])
      .concat([chunk("IDAT", zlib.deflateSync(Buffer.from(rows))), chunk("IEND", Buffer.alloc(0))])));
  }
  const g = await PKG.decodePng(pngOf(0, 2, 1, [0, 10, 200]));
  assert.deepEqual([...g.data], [10, 10, 10, 255, 200, 200, 200, 255]);
  const rgb = await PKG.decodePng(pngOf(2, 1, 2, [0, 1, 2, 3, 2, 1, 1, 1]));      // Up filter on row 2
  assert.deepEqual([...rgb.data], [1, 2, 3, 255, 2, 3, 4, 255]);
  const pal = await PKG.decodePng(pngOf(3, 2, 1, [0, 1, 0], [chunk("PLTE", [9, 8, 7, 1, 2, 3]), chunk("tRNS", [50])]));
  assert.deepEqual([...pal.data], [1, 2, 3, 255, 9, 8, 7, 50]);
  await assert.rejects(PKG.decodePng(new Uint8Array([1, 2, 3])), /png/);
  await assert.rejects(PKG.decodePng(pngOf(3, 1, 1, [0, 0])), /png/);              // palette without PLTE
  await assert.rejects(PKG.decodePng(pngOf(0, 2, 2, [0, 1, 2])), /png/);           // short data
  await assert.rejects(PKG.decodePng(pngOf(0, 4000, 4000, [0]), { maxPixels: 1e6 }), /png/);
});

// A small document: a raster layer with a mask, an adjustment layer,
// a text layer and a saved selection.
function sample() {
  const doc = C.newDoc({ w: 300, h: 200, name: "Holiday", now: 1000 });
  const bg = doc.layers[0];
  bg.x = -5; bg.y = 3;
  bg.mk = { id: "lmask000001", t: {}, on: 1, bg: 255 };
  bg.fx = C.normFx({ sh: { d: 4 } });
  doc.layers.push(C.normLayer({ id: "ladj0000001", k: "adj", name: "Curves", aj: { id: "curves", p: { s: 40 } }, op: 70, bl: "multiply" }));
  doc.layers.push(C.normLayer({ id: "ltext000001", k: "text", name: "Title", x: 20, y: 30, tx: { s: "Γειά", z: 48, c: "#ff0000" } }));
  doc.gd = { x: [10, 150], y: [] };
  doc.sels = [{ id: "lsel0000001", name: "Sky", t: {}, x: 0, y: 0 }];
  const surfaces = {};
  const s = surfaces[bg.id] = T.create();
  T.writeRect(s, 250, 10, img(40, 300, (x, y) => [x * 5, y % 256, 99, (x * 3 + y) % 256]));    // crosses tiles
  const m = surfaces["lmask000001"] = T.create();
  T.writeRect(m, 0, 0, img(10, 10, (x) => [x * 20, x * 20, x * 20, 128]));
  surfaces["lsel0000001"] = T.create();                                                          // empty: no px
  return { doc: C.normDoc(doc), surfaces };
}

test("build: content.json keeps the model, pixels go to media as PNGs", async () => {
  const { doc, surfaces } = sample();
  const r = await PKG.build(doc, surfaces, T, B.sha256);
  const c = r.content;
  assert.equal(c.kind, "oros-photolab-package"); assert.equal(c.ver, 1);
  assert.equal(c.doc.layers.length, 3);
  const L = c.doc.layers[0];
  assert.equal(L.t, undefined);
  assert.deepEqual({ x: L.px.x, y: L.px.y, w: L.px.w, h: L.px.h }, { x: 250, y: 10, w: 40, h: 300 });
  assert.match(L.px.key, /^[0-9a-f]{64}\.png$/);
  assert.equal(L.mk.on, 1); assert.equal(L.mk.px.w, 10);
  assert.equal(c.doc.layers[1].aj.id, "curves");
  assert.equal(c.doc.layers[2].tx.s, "Γειά");
  assert.deepEqual(c.doc.gd, { x: [10, 150], y: [] });
  assert.equal(c.doc.sels[0].px, undefined);
  assert.equal(Object.keys(r.media).length, 2);
  assert.ok(!/"t":/.test(JSON.stringify(c)));
  for (const k of Object.keys(r.media)) assert.equal(k, (await B.sha256(r.media[k])) + ".png");
});

test("bundle round trip: a new project with fresh ids, pixels exact", async () => {
  const { doc, surfaces } = sample();
  const built = await PKG.build(doc, surfaces, T, B.sha256);
  const bytes = await B.write({ mime: PKG.MIME, app: "photolab", schema: "photolab/1", content: built.content,
    meta: { title: doc.name }, media: built.media, preview: [{ name: "image.png", data: built.media[Object.keys(built.media)[0]], type: "image/png" }] });
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-photo");
  const r = await B.read(bytes, { mime: PKG.MIME });
  const res = PKG.parse(r.content, C, { now: 5000 });
  const d = res.doc;
  assert.notEqual(d.id, doc.id);
  assert.equal(d.m, 5000);
  assert.equal(d.name, "Holiday");
  const oldIds = new Set([doc.id, ...doc.layers.map((l) => l.id), "lmask000001", "lsel0000001"]);
  d.layers.forEach((l) => { assert.ok(!oldIds.has(l.id)); if (l.mk) assert.ok(!oldIds.has(l.mk.id)); });
  assert.equal(d.layers[0].x, -5); assert.equal(d.layers[0].mk.bg, 255); assert.ok(d.layers[0].fx.sh);
  assert.equal(d.layers[1].op, 70); assert.equal(d.layers[1].bl, "multiply");
  assert.equal(d.sels.length, 1);
  assert.equal(res.pieces.length, 2);
  // restore exactly as io.js applyPackage does, then compare pixels
  const out = {};
  for (const p of res.pieces) {
    const im = await PKG.decodePng(r.media[p.key].bytes);
    assert.equal(im.w, p.w);
    T.writeRect(out[p.sid] = out[p.sid] || T.create(), p.x, p.y, im);
  }
  const a = surfaces[doc.layers[0].id], b = out[d.layers[0].id];
  assert.deepEqual([...a.tiles.keys()].sort(), [...b.tiles.keys()].sort());
  a.tiles.forEach((t, k) => assert.ok(same(t, b.tiles.get(k)), k));
  const ma = surfaces["lmask000001"], mb = out[d.layers[0].mk.id];
  ma.tiles.forEach((t, k) => assert.ok(same(t, mb.tiles.get(k)), "mask " + k));
});

test("parse: refuses what is not ours, flags newer files, drops bad pieces", () => {
  assert.throws(() => PKG.parse(null, C), /notpackage/);
  assert.throws(() => PKG.parse({ kind: "oros-notes-package", ver: 1, doc: {} }, C), /notpackage/);
  assert.throws(() => PKG.parse({ kind: "oros-photolab-package", ver: 1, doc: { w: 0, h: 10 } }, C), /notpackage/);
  try { PKG.parse({ kind: "oros-photolab-package", ver: 9, doc: {} }, C); assert.fail(); }
  catch (e) { assert.equal(e.code, "newer"); }
  const key = "a".repeat(64) + ".png";
  const res = PKG.parse({ kind: "oros-photolab-package", ver: 1, doc: { name: "<b>x</b>\u0000", w: 100, h: 50, layers: [
    { id: "evil", k: "raster", px: { key, x: 0, y: 0, w: 10, h: 10 }, bl: "javascript", op: 900 },
    { k: "raster", px: { key: "../../etc.png", x: 0, y: 0, w: 1, h: 1 } },
    { k: "raster", px: { key, x: 0, y: 0, w: 1e6, h: 1e6 } },
    { k: "script", px: { key, x: 0, y: 0, w: 1, h: 1 } }
  ] } }, C, { now: 1 });
  assert.equal(res.doc.layers.length, 3);                 // the unknown kind is dropped
  assert.equal(res.doc.layers[0].bl, "normal"); assert.equal(res.doc.layers[0].op, 100);
  assert.equal(res.pieces.length, 1);                     // bad key and huge piece dropped
  assert.equal(res.doc.name, "<b>x</b>");
});
