// Photo Lab: Krita .kra files (photolab/ora.js, readKra). Fixtures are
// built here: a maindoc.xml, layers in Krita's tiled format (version 2:
// 64×64 tiles, LZF-compressed channel planes in BGRA order) and a
// mergedimage.png, packed with the module's own stored-ZIP writer and
// read back through the shared ZIP reader (atelier/zip.js).
// (OpenRaster itself is covered in photolab-files.test.js.)
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ORA = require("../photolab/ora.js");
const Zip = require("../atelier/zip.js");

const enc = (s) => new TextEncoder().encode(s);

// LZF: literal runs, and a back reference (distance 1) for repeats.
function lzfEncode(src) {
  const out = [];
  let i = 0, lit = [];
  const flush = () => { while (lit.length) { const n = Math.min(32, lit.length); out.push(n - 1, ...lit.splice(0, n)); } };
  while (i < src.length) {
    let run = 0;
    if (i > 0) while (i + run < src.length && src[i + run] === src[i - 1] && run < 264) run++;
    if (run >= 3) {
      flush();
      const len = run - 2;
      if (len < 7) out.push(len << 5, 0); else out.push(7 << 5, len - 7, 0);
      i += run;
    } else { lit.push(src[i]); i++; }
  }
  flush();
  return Uint8Array.from(out);
}

// One layer: tiles { x, y, px: (x, y) → [r, g, b, a] } → tiled bytes.
function tiled(tiles, o) {
  o = o || {};
  const T = 64, parts = [enc(`VERSION ${o.version || 2}\nTILEWIDTH ${T}\nTILEHEIGHT ${T}\nPIXELSIZE ${o.ps || 4}\nDATA ${tiles.length}\n`)];
  tiles.forEach((t) => {
    const planes = new Uint8Array(T * T * 4), inter = new Uint8Array(T * T * 4);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const [r, g, b, a] = t.px(x, y), j = y * T + x;
      planes[j] = b; planes[T * T + j] = g; planes[2 * T * T + j] = r; planes[3 * T * T + j] = a;
      inter.set([b, g, r, a], j * 4);
    }
    const body = t.stored ? Uint8Array.from([0, ...inter]) : Uint8Array.from([1, ...lzfEncode(planes)]);
    parts.push(enc(`${t.x},${t.y},LZF,${body.length}\n`), body);
  });
  return Buffer.concat(parts.map((p) => Buffer.from(p)));
}

function kra(xml, files, merged) {
  const entries = [{ name: "mimetype", data: enc("application/x-krita") }, { name: "maindoc.xml", data: enc(xml) }];
  Object.keys(files).forEach((k) => entries.push({ name: k, data: new Uint8Array(files[k]) }));
  if (merged) entries.push({ name: "mergedimage.png", data: merged });
  return ORA.zip(entries);
}
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 42]);
const DOC = (layers) => `<?xml version="1.0"?><!DOCTYPE DOC><DOC syntaxVersion="2">
  <IMAGE name="Art" width="100" height="80" colorspacename="RGBA" mime="application/x-kra">
    <layers>${layers}</layers>
  </IMAGE></DOC>`;
const at = (img, x, y) => Array.from(img.data.slice((y * img.w + x) * 4, (y * img.w + x) * 4 + 4));

test("kra: LZF round trip (literals, short and long back references)", () => {
  const src = new Uint8Array(5000);
  for (let i = 0; i < src.length; i++) src[i] = i < 1000 ? i & 255 : i < 3000 ? 7 : (i * 13) & 255;
  const out = new Uint8Array(src.length);
  assert.equal(ORA.lzf(lzfEncode(src), out), src.length);
  assert.deepEqual(out, src);
  assert.throws(() => ORA.lzf(Uint8Array.from([0x20, 5]), new Uint8Array(8)));     // reference before the start
  assert.throws(() => ORA.lzf(Uint8Array.from([5, 1]), new Uint8Array(8)));        // literal past the end
});

test("kra: maindoc.xml layers, groups, masks, opacity, visibility, blend; unsafe names ignored", () => {
  const d = ORA.parseKraDoc(DOC(`
    <layer name="Top &amp; &#x3B1;" filename="layer5" nodetype="paintlayer" x="3" y="4" opacity="128" visible="1" compositeop="multiply" colorspacename="RGBA"/>
    <layer name="G" nodetype="grouplayer" visible="0" opacity="255" filename="layer2">
      <layers><layer name="In" filename="layer3" nodetype="paintlayer" opacity="255" visible="1"/></layers>
    </layer>
    <layer name="Vec" filename="layer6" nodetype="shapelayer"/>
    <layer name="Evil" filename="../x" nodetype="paintlayer"/>
    <layer name="Masked" filename="layer7" nodetype="paintlayer" compositeop="luminize"><masks><mask name="m" nodetype="transparencymask"/></masks></layer>
    <layer name="Bottom" filename="layer4" nodetype="paintlayer" compositeop="weird"/>`));
  assert.equal(d.w, 100); assert.equal(d.h, 80); assert.equal(d.name, "Art");
  assert.deepEqual(d.layers.map((l) => l.name), ["Bottom", "Masked", "In", "Top & α"]);
  assert.deepEqual([d.groups, d.masks, d.other], [1, 1, 2]);
  const [bottom, masked, inner, top] = d.layers;
  assert.equal(bottom.bl, "normal"); assert.equal(masked.bl, "luminosity");
  assert.deepEqual([inner.vis, inner.op], [0, 100]);
  assert.deepEqual([top.x, top.y, top.op, top.bl, top.vis, top.file], [3, 4, 50, "multiply", 1, "layer5"]);
  assert.throws(() => ORA.parseKraDoc("<DOC><IMAGE/></DOC>"));
});

test("kra: tiled layers decoded to RGBA (LZF planes and stored tiles, negative offsets)", async () => {
  const red = () => [255, 0, 0, 255], half = (x) => (x < 32 ? [0, 0, 255, 128] : [0, 0, 0, 0]);
  const files = {
    "Art/layers/layer2": tiled([{ x: 0, y: 0, px: red }, { x: 64, y: 0, px: (x, y) => [x, y, 9, 255], stored: true }]),
    "Art/layers/layer3": tiled([{ x: -64, y: -64, px: half }]),
    "Art/layers/layer4": tiled([])
  };
  const bytes = kra(DOC(`
    <layer name="Blue" filename="layer3" nodetype="paintlayer" x="10" y="0" opacity="255" visible="1" compositeop="screen" colorspacename="RGBA"/>
    <layer name="Empty" filename="layer4" nodetype="paintlayer"/>
    <layer name="Back" filename="layer2" nodetype="paintlayer" x="0" y="0" opacity="255" visible="1" compositeop="normal" colorspacename="RGBA"/>`), files, PNG);
  const r = await ORA.readKra(bytes, Zip);
  assert.equal(r.w, 100); assert.equal(r.h, 80); assert.equal(r.merged, null); assert.equal(r.skipped.flat, 0);
  assert.deepEqual(r.layers.map((l) => [l.name, l.x, l.y, l.img.w, l.img.h, l.bl]),
    [["Back", 0, 0, 128, 64, "normal"], ["Blue", -54, -64, 64, 64, "screen"]]);
  const back = r.layers[0].img, blue = r.layers[1].img;
  assert.deepEqual(at(back, 5, 5), [255, 0, 0, 255]);
  assert.deepEqual(at(back, 64 + 7, 3), [7, 3, 9, 255]);
  assert.deepEqual(at(blue, 0, 0), [0, 0, 255, 128]);
  assert.deepEqual(at(blue, 40, 0), [0, 0, 0, 0]);
});

test("kra: what can't be read layer by layer opens as the merged picture, and says so", async () => {
  // a 16-bit layer
  const deep = kra(DOC(`<layer name="Deep" filename="layer2" nodetype="paintlayer" colorspacename="RGBA16"/>`),
    { "Art/layers/layer2": tiled([]) }, PNG);
  const a = await ORA.readKra(deep, Zip);
  assert.equal(a.layers.length, 0); assert.equal(a.merged[8], 42); assert.equal(a.skipped.flat, 1);
  // pixel data missing from the file
  const gone = await ORA.readKra(kra(DOC(`<layer name="X" filename="layer9" nodetype="paintlayer"/>`), {}, PNG), Zip);
  assert.equal(gone.skipped.flat, 1);
  // over the pixel limit
  const big = kra(DOC(`<layer name="B" filename="layer2" nodetype="paintlayer"/>`),
    { "Art/layers/layer2": tiled([{ x: 0, y: 0, px: () => [1, 2, 3, 255] }]) }, PNG);
  assert.equal((await ORA.readKra(big, Zip, { maxPixels: 1000 })).skipped.flat, 1);
  // a renamed image folder is still found
  const moved = kra(DOC(`<layer name="M" filename="layer2" nodetype="paintlayer"/>`),
    { "Other/layers/layer2": tiled([{ x: 0, y: 0, px: () => [1, 2, 3, 255] }]) }, PNG);
  assert.equal((await ORA.readKra(moved, Zip)).layers.length, 1);
  // damaged layer data, with a merged picture to fall back on
  const bad = kra(DOC(`<layer name="D" filename="layer2" nodetype="paintlayer"/>`), { "Art/layers/layer2": enc("VERSION 2\nnonsense\n") }, PNG);
  assert.equal((await ORA.readKra(bad, Zip)).skipped.flat, 1);
  // only vector layers: the merged picture, not "flat"
  const vec = await ORA.readKra(kra(DOC(`<layer name="V" filename="layer2" nodetype="shapelayer"/>`), {}, PNG), Zip);
  assert.equal(vec.skipped.flat, 0); assert.equal(vec.skipped.other, 1); assert.ok(vec.merged);
});

test("kra: junk and damaged files are refused", async () => {
  await assert.rejects(ORA.readKra(new Uint8Array([1, 2, 3]), Zip), /ora/);
  await assert.rejects(ORA.readKra(kra("<DOC/>", {}), Zip), /ora/);
  const cut = tiled([{ x: 0, y: 0, px: () => [1, 2, 3, 4] }]).subarray(0, 120);
  await assert.rejects(ORA.readKra(kra(DOC(`<layer name="C" filename="layer2" nodetype="paintlayer"/>`), { "Art/layers/layer2": cut }), Zip), /ora/);
  assert.throws(() => ORA.kraTiles(enc("VERSION 2\nTILEWIDTH 64\n")), /ora/);
});
