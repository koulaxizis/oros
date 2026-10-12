// Photo Lab layered files: photolab/psd.js (Photoshop) and
// photolab/ora.js (OpenRaster). Pure parts only; PNG decoding and the
// UI are covered in the real-shell run.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const PSD = require("../photolab/psd.js");
const ORA = require("../photolab/ora.js");
const Zip = require("../atelier/zip.js");

function img(w, h, f) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4);
  return { w, h, data: d };
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// ---------- A small PSD builder for reader cases the writer never makes ----------
function be(n, v) { const b = Buffer.alloc(n); if (n === 2) b.writeUInt16BE(v & 0xffff); else b.writeInt32BE(v | 0); return b; }
function psdFile(o) {
  // o: { w, h, depth, mode, nch, layers: [{ rect:[t,l,b,r], ch:[{id, bytes}], key, op, flags, name, mask, section }], merged }
  const parts = [Buffer.from("8BPS"), be(2, o.ver || 1), Buffer.alloc(6), be(2, o.nch || 3), be(4, o.h), be(4, o.w), be(2, o.depth || 8), be(2, o.mode || 3),
                 be(4, 0), be(4, 0)];
  const recs = [], data = [];
  (o.layers || []).forEach((L) => {
    const r = [be(4, L.rect[0]), be(4, L.rect[1]), be(4, L.rect[2]), be(4, L.rect[3]), be(2, L.ch.length)];
    L.ch.forEach((c) => { r.push(be(2, c.id), be(4, c.bytes.length)); data.push(c.bytes); });
    r.push(Buffer.from("8BIM"), Buffer.from(L.key || "norm"), Buffer.from([L.op == null ? 255 : L.op, 0, L.flags || 0, 0]));
    const extra = [];
    if (L.mask) extra.push(be(4, 20), be(4, L.mask[0]), be(4, L.mask[1]), be(4, L.mask[2]), be(4, L.mask[3]), Buffer.from([L.mask[4] || 0, L.mask[5] || 0, 0, 0]));
    else extra.push(be(4, 0));
    extra.push(be(4, 0));
    const nm = Buffer.from(L.name || "L"); const pad = (4 - ((nm.length + 1) % 4)) % 4;
    extra.push(Buffer.from([nm.length]), nm, Buffer.alloc(pad));
    if (L.section) extra.push(Buffer.from("8BIMlsct"), be(4, 4), be(4, L.section));
    const ex = Buffer.concat(extra);
    r.push(be(4, ex.length), ex);
    recs.push(Buffer.concat(r));
  });
  const li = Buffer.concat([be(2, o.negative ? -(o.layers || []).length : (o.layers || []).length)].concat(recs, data));
  const lm = o.layers ? Buffer.concat([be(4, li.length), li]) : Buffer.alloc(0);
  parts.push(be(4, lm.length), lm);
  parts.push(o.merged || Buffer.alloc(0));
  return new Uint8Array(Buffer.concat(parts));
}
const raw = (bytes) => Buffer.concat([be(2, 0), Buffer.from(bytes)]);
const zip = (bytes) => Buffer.concat([be(2, 2), zlib.deflateSync(Buffer.from(bytes))]);
function zipPred(bytes, w) {                            // 8-bit prediction: row deltas
  const d = Buffer.from(bytes);
  for (let y = 0; y < d.length / w; y++) for (let x = w - 1; x > 0; x--) d[y * w + x] = (d[y * w + x] - d[y * w + x - 1]) & 255;
  return Buffer.concat([be(2, 3), zlib.deflateSync(d)]);
}
const fill = (n, v) => new Array(n).fill(v);

test("psd: write then read keeps layers, names, offsets, blend, opacity, visibility, pixels", async () => {
  const bg = img(40, 30, (x, y) => [x * 6, y * 8, 128, 255]);
  const top = img(12, 7, (x) => [255, 0, 0, x < 6 ? 255 : 100]);
  const empty = { w: 0, h: 0, data: new Uint8ClampedArray(0) };
  const bytes = PSD.write({ w: 40, h: 30, merged: bg, layers: [
    { name: "Background", x: 0, y: 0, img: bg, op: 100, bl: "normal", vis: 1 },
    { name: "Κόκκινο ✓", x: -3, y: 20, img: top, op: 40, bl: "soft", vis: 0 },
    { name: "Empty", x: 0, y: 0, img: empty, op: 100, bl: "normal", vis: 1 }] });
  const r = await PSD.read(bytes);
  assert.equal(r.w, 40); assert.equal(r.h, 30);
  assert.equal(r.layers.length, 2);                  // the empty layer has no pixels
  assert.equal(r.skipped.empty, 1);
  const [a, b] = r.layers;
  assert.equal(a.name, "Background"); assert.ok(same(a.img.data, bg.data));
  assert.equal(b.name, "Κόκκινο ✓"); assert.equal(b.x, -3); assert.equal(b.y, 20);
  assert.equal(b.bl, "soft"); assert.equal(b.op, 40); assert.equal(b.vis, 0);
  assert.ok(same(b.img.data, top.data));
});

test("psd: every blend id round-trips", async () => {
  const ids = Object.values(PSD.KEYS);
  const one = img(2, 2, () => [1, 2, 3, 255]);
  const r = await PSD.read(PSD.write({ w: 2, h: 2, merged: one,
    layers: ids.map((bl) => ({ name: bl, x: 0, y: 0, img: one, op: 100, bl, vis: 1 })) }));
  assert.deepEqual(r.layers.map((l) => l.bl), ids);
});

test("psd: PackBits round-trips runs, literals and 128-long edges", () => {
  const rows = [[], [5], [1, 1], [1, 2, 3], fill(300, 7), Array.from({ length: 300 }, (_, i) => i * 7 & 255),
                [1, 1, 1, 2, 3, 3, 4, 4, 4, 4, 5].concat(fill(129, 9), [1, 2])];
  rows.forEach((row) => {
    const src = Uint8Array.from(row), out = new Uint8Array(row.length * 2 + 4);
    const n = PSD.packRow(src, 0, src.length, out, 0);
    const back = new Uint8Array(src.length);
    PSD.unpack(out, 0, n, back, 0, src.length);
    assert.ok(same(back, src), JSON.stringify(row).slice(0, 40));
  });
});

test("psd: raw, ZIP and ZIP-with-prediction channels; mask baked into alpha; groups flattened", async () => {
  const R = fill(16, 200), G = fill(16, 100), B = Array.from({ length: 16 }, (_, i) => i * 10), A = fill(16, 255);
  const mask = [255, 0, 255, 0];                       // 2 × 2 mask at the layer's top-left, rest default 255
  const file = psdFile({ w: 4, h: 4, layers: [
    { rect: [0, 0, 0, 0], ch: [], section: 3, name: "</Layer group>" },
    { rect: [0, 0, 4, 4], key: "mul ", op: 255, name: "In group",
      ch: [{ id: 0, bytes: raw(R) }, { id: 1, bytes: zip(G) }, { id: 2, bytes: zipPred(B, 4) }, { id: -1, bytes: raw(A) },
           { id: -2, bytes: raw(mask) }], mask: [0, 0, 2, 2, 255, 0] },
    { rect: [0, 0, 0, 0], ch: [], section: 1, op: 128, flags: 2, name: "Group" },
    { rect: [1, 1, 2, 2], key: "fsub", name: "Odd blend", ch: [{ id: 0, bytes: raw([1]) }, { id: 1, bytes: raw([2]) }, { id: 2, bytes: raw([3]) }] }
  ] });
  const r = await PSD.read(file);
  assert.equal(r.layers.length, 2);
  const g = r.layers[0];
  assert.equal(g.name, "In group"); assert.equal(g.bl, "multiply");
  assert.equal(g.vis, 0);                               // the group is hidden
  assert.equal(g.op, 50);                               // 100 % × group 128/255
  assert.deepEqual([...g.img.data.slice(0, 4)], [200, 100, 0, 255]);
  assert.equal(g.img.data[1 * 4 + 3], 0);               // mask 0
  assert.equal(g.img.data[15 * 4 + 2], 150);            // prediction undone
  assert.equal(g.img.data[15 * 4 + 3], 255);            // outside the mask: default 255
  assert.equal(r.skipped.groups, 1); assert.equal(r.skipped.masks, 1);
  assert.equal(r.layers[1].bl, "normal"); assert.equal(r.skipped.blends, 1);
});

test("psd: flat Grayscale, CMYK and 16-bit files open as their merged picture", async () => {
  const gray = psdFile({ w: 2, h: 1, nch: 1, mode: 1, merged: Buffer.concat([be(2, 0), Buffer.from([10, 250])]) });
  let r = await PSD.read(gray);
  assert.equal(r.layers.length, 0);
  assert.deepEqual([...r.merged.data], [10, 10, 10, 255, 250, 250, 250, 255]);
  // CMYK stores 255 - ink: pure red = C 0, M 100, Y 100, K 0 → stored 255, 0, 0, 255
  const cmyk = psdFile({ w: 1, h: 1, nch: 4, mode: 4, merged: Buffer.concat([be(2, 0), Buffer.from([255, 0, 0, 255])]) });
  r = await PSD.read(cmyk);
  assert.deepEqual([...r.merged.data], [255, 0, 0, 255]);
  const deep = psdFile({ w: 1, h: 1, nch: 3, depth: 16, merged: Buffer.concat([be(2, 0), Buffer.from([0x80, 0x01, 0xff, 0xff, 0x00, 0x10])]) });
  r = await PSD.read(deep);
  assert.deepEqual([...r.merged.data], [0x80, 0xff, 0x00, 255]);
  // An extra channel is a saved selection, not transparency, unless the layer count says so.
  const extra = psdFile({ w: 1, h: 1, nch: 4, merged: Buffer.concat([be(2, 0), Buffer.from([1, 2, 3, 0])]) });
  r = await PSD.read(extra);
  assert.equal(r.merged.data[3], 255);
});

test("psd: refuses what it cannot or should not open", async () => {
  const reject = async (bytes, msg, o) => { await assert.rejects(PSD.read(bytes, o), (e) => e.message === msg); };
  await reject(new Uint8Array([1, 2, 3]), "psd");
  await reject(psdFile({ w: 2, h: 2, ver: 2 }), "psd-big");                    // PSB
  await reject(psdFile({ w: 2, h: 2, mode: 2 }), "psd-mode");                  // indexed
  await reject(psdFile({ w: 2, h: 2, depth: 32 }), "psd-mode");
  await reject(psdFile({ w: 5000, h: 5000 }), "psd-big", { maxPixels: 1e6 });
  // A layer claiming more channel bytes than the file holds
  const bad = psdFile({ w: 2, h: 2, layers: [{ rect: [0, 0, 2, 2], ch: [{ id: 0, bytes: raw([1, 2, 3, 4]) }] }] });
  await reject(bad.subarray(0, bad.length - 3), "psd");
  // RLE that leaves its row short
  const rle = Buffer.concat([be(2, 1), be(2, 2), Buffer.from([0x00, 7])]);              // 1 pixel for a 2-pixel row
  await reject(psdFile({ w: 2, h: 1, layers: [{ rect: [0, 0, 1, 2], ch: [{ id: 0, bytes: rle }, { id: 1, bytes: rle }, { id: 2, bytes: rle }] }] }), "psd");
  // A ZIP bomb is stopped at the plane size
  const bomb = Buffer.concat([be(2, 2), zlib.deflateSync(Buffer.alloc(1e6))]);
  await reject(psdFile({ w: 2, h: 2, layers: [{ rect: [0, 0, 2, 2], ch: [{ id: 0, bytes: bomb }, { id: 1, bytes: bomb }, { id: 2, bytes: bomb }] }] }), "psd");
});

// ---------- OpenRaster ----------
test("ora: stack.xml groups, offsets, opacity, visibility, blend; unsafe paths ignored", () => {
  const xml = `<?xml version="1.0"?><image w="100" h="80" version="0.0.6">
    <stack>
      <layer name="Top &amp; &#x3B1;" src="data/a.png" x="5" y="6" opacity="0.5" composite-op="svg:multiply"/>
      <stack name="G" opacity="0.5" visibility="hidden" x="10" y="0">
        <layer name="In" src="data/b.png" x="1" y="2"/>
      </stack>
      <layer name="Evil" src="../../etc/passwd"/>
      <layer name="Abs" src="/x.png"/>
      <layer name="Url" src="https://x/y.png"/>
      <layer name="Bottom" src="data/c.png" composite-op="krita:unknown"/>
    </stack></image>`;
  const s = ORA.parseStack(xml);
  assert.equal(s.w, 100); assert.equal(s.h, 80); assert.equal(s.groups, 1);
  assert.deepEqual(s.layers.map((l) => l.name), ["Bottom", "In", "Top & α"]);
  const [bottom, inner, top] = s.layers;
  assert.equal(bottom.bl, "normal");
  assert.deepEqual([inner.x, inner.y, inner.op, inner.vis], [11, 2, 50, 0]);
  assert.deepEqual([top.x, top.y, top.op, top.bl, top.vis], [5, 6, 50, "multiply", 1]);
  assert.throws(() => ORA.parseStack("<image><stack/></image>"));
});

test("ora: write then read through the shared ZIP reader; mimetype first and stored", async () => {
  const png = (n) => new Uint8Array([137, 80, 78, 71, n]);
  const bytes = ORA.write({ w: 64, h: 48, merged: png(9), thumb: png(8), layers: [
    { name: "Back <1>", x: 0, y: 0, op: 100, bl: "normal", vis: 1, png: png(1) },
    { name: "Λάμψη", x: 4, y: -2, op: 30, bl: "screen", vis: 0, png: png(2) }] });
  assert.equal(Buffer.from(bytes.subarray(30, 38)).toString(), "mimetype");
  assert.equal(bytes[8], 0);                                       // method: stored
  assert.equal(Buffer.from(bytes.subarray(38, 54)).toString(), "image/openraster");
  const r = await ORA.read(bytes, Zip);
  assert.equal(r.w, 64); assert.equal(r.h, 48);
  assert.deepEqual(r.layers.map((l) => [l.name, l.x, l.y, l.op, l.bl, l.vis, l.png[4]]),
    [["Back <1>", 0, 0, 100, "normal", 1, 1], ["Λάμψη", 4, -2, 30, "screen", 0, 2]]);
  assert.equal(r.merged, null);
  const z = Zip.open(bytes);
  assert.ok(z.has("mergedimage.png") && z.has("Thumbnails/thumbnail.png"));
  assert.equal(ORA.crc32(new TextEncoder().encode("The quick brown fox jumps over the lazy dog")), 0x414fa339);
});

test("ora: a file without layers opens its merged picture; junk is refused", async () => {
  const xml = new TextEncoder().encode('<image w="2" h="2"><stack></stack></image>');
  const only = ORA.zip([{ name: "mimetype", data: new TextEncoder().encode(ORA.MIME) },
                        { name: "stack.xml", data: xml }, { name: "mergedimage.png", data: new Uint8Array([7]) }]);
  const r = await ORA.read(only, Zip);
  assert.equal(r.layers.length, 0); assert.equal(r.merged[0], 7);
  await assert.rejects(ORA.read(new Uint8Array([1, 2, 3]), Zip), /ora/);
  const noStack = ORA.zip([{ name: "mimetype", data: new TextEncoder().encode(ORA.MIME) }]);
  await assert.rejects(ORA.read(noStack, Zip), /ora/);
});
