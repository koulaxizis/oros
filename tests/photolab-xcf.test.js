// Photo Lab: GIMP's .xcf files (wave PS-2, photolab/xcf.js). The
// files are built here byte by byte from GIMP's XCF format
// description (devel-docs/xcf.txt); no GIMP in the test machine.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const X = require("../photolab/xcf.js");

const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b; };
const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32BE(v | 0); return b; };
const f32 = (v) => { const b = Buffer.alloc(4); b.writeFloatBE(v); return b; };
const cat = (...a) => Buffer.concat(a);
const xstr = (s) => { const b = Buffer.from(s + "\0", "utf8"); return cat(u32(b.length), b); };
const prop = (t, data) => cat(u32(t), u32(data.length), data);
const END = prop(0, Buffer.alloc(0));

// GIMP's RLE for one tile: each byte plane in turn, here as literal runs.
function rle(raw, bpp) {
  const out = [], n = raw.length / bpp;
  for (let c = 0; c < bpp; c++) {
    const plane = []; for (let i = 0; i < n; i++) plane.push(raw[i * bpp + c]);
    for (let i = 0; i < plane.length;) {
      let j = i; while (j < plane.length && j - i < 127 && plane[j] === plane[i]) j++;
      if (j - i >= 2) { out.push(j - i - 1, plane[i]); i = j; continue; }      // a run: v + 1 copies
      const k = Math.min(plane.length, i + 127);
      out.push(256 - (k - i), ...plane.slice(i, k)); i = k;                  // literals: 256 − n
    }
  }
  return Buffer.from(out);
}

// image: { ver, w, h, base, prec, comp, cmap, layers: [{ w, h, type, name, props: [Buffer], px: Buffer (raw, w*h*bpp), bpp, mask? }] }
// Layers are listed top first, as GIMP saves them.
function xcf(o) {
  const ver = o.ver == null ? 11 : o.ver, wide = ver >= 11;
  const ptr = (v) => (wide ? cat(u32(0), u32(v)) : u32(v));
  const head = cat(Buffer.from("gimp xcf "), Buffer.from(ver === 0 ? "file" : "v" + String(ver).padStart(3, "0")), Buffer.from([0]),
                   u32(o.w), u32(o.h), u32(o.base || 0), ver >= 4 ? u32(o.prec == null ? 150 : o.prec) : Buffer.alloc(0));
  const iprops = [prop(17, Buffer.from([o.comp == null ? 1 : o.comp]))];
  if (o.cmap) iprops.push(prop(1, cat(u32(o.cmap.length / 3), o.cmap)));
  iprops.push(END);
  // lay out: header + props + layer pointers + 0 + channel 0, then the blocks
  const parts = []; let at = 0;
  const put = (b) => { const p = at; parts.push(b); at += b.length; return p; };
  const ptrSize = wide ? 8 : 4;
  const fixed = cat(head, ...iprops);
  at = fixed.length + ptrSize * (o.layers.length + 2);
  function tiles(px, w, h, bpp) {
    const tw = Math.ceil(w / 64), th = Math.ceil(h / 64), ptrs = [];
    for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
      const cw = Math.min(64, w - tx * 64), ch = Math.min(64, h - ty * 64), t = Buffer.alloc(cw * ch * bpp);
      for (let y = 0; y < ch; y++) px.copy(t, y * cw * bpp, ((ty * 64 + y) * w + tx * 64) * bpp, ((ty * 64 + y) * w + tx * 64 + cw) * bpp);
      const c = o.comp === 0 ? t : o.comp === 2 ? zlib.deflateSync(t) : rle(t, bpp);
      ptrs.push(put(c));
    }
    return ptrs;
  }
  function hier(px, w, h, bpp) {
    const tp = tiles(px, w, h, bpp);
    const lv = put(cat(u32(w), u32(h), ...tp.map(ptr), ptr(0)));
    return put(cat(u32(w), u32(h), u32(bpp), ptr(lv), ptr(0)));
  }
  const lptrs = o.layers.map((L) => {
    const hp = L.group ? hier(Buffer.alloc(L.w * L.h * L.bpp), L.w, L.h, L.bpp) : hier(L.px, L.w, L.h, L.bpp);
    let mp = 0;
    if (L.mask) {
      const mh = hier(L.mask, L.w, L.h, L.mbpp || 1);
      mp = put(cat(u32(L.w), u32(L.h), xstr("mask"), END, ptr(mh)));
    }
    return put(cat(u32(L.w), u32(L.h), u32(L.type), xstr(L.name), ...(L.props || []), END, ptr(hp), ptr(mp)));
  });
  return new Uint8Array(cat(fixed, ...lptrs.map(ptr), ptr(0), ptr(0), ...parts));
}
const rgba = (n, r, g, b, a) => Buffer.from(Array(n).fill([r, g, b, a]).flat());
const P = { opacity: (v) => prop(6, u32(v)), fop: (v) => prop(33, f32(v)), mode: (m) => prop(7, u32(m)), vis: (v) => prop(8, u32(v)),
            off: (x, y) => prop(15, cat(i32(x), i32(y))), apply: (v) => prop(11, u32(v)), group: () => prop(29, Buffer.alloc(0)),
            path: (...p) => prop(30, cat(...p.map(u32))), text: () => prop(26, u32(0)) };

test("RGBA layers top first in the file come bottom first, with offset, opacity, mode, visibility and a mask", async () => {
  for (const comp of [0, 1, 2]) {
    const file = xcf({ w: 70, h: 3, comp, layers: [
      { name: "Πάνω", w: 70, h: 2, type: 1, bpp: 4, px: rgba(140, 10, 20, 30, 200), props: [P.off(0, 1), P.fop(0.5), P.mode(30), P.vis(0), P.apply(1)],
        mask: Buffer.from(Array(140).fill(0).map((_, i) => i % 2 ? 255 : 0)) },
      { name: "Background", w: 70, h: 3, type: 0, bpp: 3, px: Buffer.from(Array(210).fill([1, 2, 3]).flat()), props: [P.opacity(255), P.mode(0)] }
    ] });
    const r = await X.read(file);
    assert.deepEqual(r.layers.map((L) => L.name), ["Background", "Πάνω"], "comp " + comp);
    const [bg, top] = r.layers;
    assert.deepEqual([...bg.img.data.slice(0, 4)], [1, 2, 3, 255]);
    assert.deepEqual([top.x, top.y, top.op, top.bl, top.vis], [0, 1, 50, "multiply", 0]);
    assert.deepEqual([...top.img.data.slice(69 * 4, 69 * 4 + 4)], [10, 20, 30, 200], "past the first 64-pixel tile");
    assert.deepEqual([top.mk.img.data[0], top.mk.img.data[1], top.mk.on, top.mk.x, top.mk.y], [0, 255, 1, 0, 1]);
  }
});

test("groups: kept as groups (pass-through, opacity); order by item path", async () => {
  const file = xcf({ w: 1, h: 1, layers: [
    { name: "Group", group: true, w: 1, h: 1, type: 1, bpp: 4, props: [P.group(), P.path(0), P.opacity(128), P.mode(61)] },
    { name: "In top", w: 1, h: 1, type: 1, bpp: 4, px: rgba(1, 9, 9, 9, 255), props: [P.path(0, 0), P.opacity(255)] },
    { name: "In bottom", w: 1, h: 1, type: 1, bpp: 4, px: rgba(1, 8, 8, 8, 255), props: [P.path(0, 1), P.opacity(255)] },
    { name: "Under", w: 1, h: 1, type: 1, bpp: 4, px: rgba(1, 7, 7, 7, 255), props: [P.path(1), P.opacity(255)] }
  ] });
  const r = await X.read(file);
  assert.deepEqual(r.layers.map((L) => L.name), ["Under", "In bottom", "In top"]);
  assert.deepEqual(r.layers.map((L) => L.op), [100, 100, 100]);
  assert.deepEqual(r.layers.map((L) => L.g), [undefined, 0, 0]);
  assert.deepEqual(r.groups, [{ name: "Group", vis: 1, op: 50, bl: "pass", open: 1, p: null }]);
  assert.equal(r.notes.groups, undefined);               // no group mask
  assert.equal(r.notes.groupBlend, undefined);
});

test("modes: legacy and new GIMP modes map; GIMP's old overlay is soft light; the others are named", async () => {
  assert.equal(X.MODES[5], "soft"); assert.equal(X.MODES[23], "overlay"); assert.equal(X.MODES[44], "hard"); assert.equal(X.MODES[14], "luminosity");
  const file = xcf({ w: 1, h: 1, layers: [{ name: "Grain", w: 1, h: 1, type: 1, bpp: 4, px: rgba(1, 1, 1, 1, 255), props: [P.mode(47), P.text()] }] });
  const r = await X.read(file);
  assert.equal(r.layers[0].bl, "normal");
  assert.deepEqual(r.names.blend, ["Grain"]); assert.deepEqual(r.names.text, ["Grain"]);
});

test("precisions: 16-bit linear, float and half; grey with alpha; indexed with its colour map; old versions", async () => {
  const be16 = (v) => [v >> 8, v & 255];
  let r = await X.read(xcf({ w: 1, h: 1, prec: 200, layers: [{ name: "L16", w: 1, h: 1, type: 1, bpp: 8, px: Buffer.from([...be16(65535), ...be16(14024), ...be16(0), ...be16(32768)]) }] }));
  assert.deepEqual([...r.layers[0].img.data], [255, 128, 0, 128]);     // linear 0.214 → sRGB 128; alpha stays linear
  r = await X.read(xcf({ w: 1, h: 1, prec: 650, layers: [{ name: "F", w: 1, h: 1, type: 3, bpp: 8, px: cat(f32(0.5), f32(1)) }] }));
  assert.deepEqual([...r.layers[0].img.data], [128, 128, 128, 255]);
  r = await X.read(xcf({ w: 1, h: 1, prec: 550, layers: [{ name: "H", w: 1, h: 1, type: 2, bpp: 2, px: Buffer.from([0x38, 0x00]) }] }));
  assert.equal(r.layers[0].img.data[0], 128);                           // half 0.5
  r = await X.read(xcf({ w: 2, h: 1, base: 2, cmap: Buffer.from([255, 0, 0, 0, 0, 255]), layers: [{ name: "I", w: 2, h: 1, type: 5, bpp: 2, px: Buffer.from([1, 255, 0, 0]) }] }));
  assert.deepEqual([...r.layers[0].img.data], [0, 0, 255, 255, 255, 0, 0, 0]);
  r = await X.read(xcf({ ver: 0, w: 1, h: 1, layers: [{ name: "Old", w: 1, h: 1, type: 1, bpp: 4, px: rgba(1, 5, 6, 7, 255) }] }));
  assert.deepEqual([...r.layers[0].img.data], [5, 6, 7, 255]);
  r = await X.read(xcf({ ver: 3, w: 1, h: 1, comp: 2, layers: [{ name: "V3", w: 1, h: 1, type: 1, bpp: 4, px: rgba(1, 5, 6, 7, 255) }] }));
  assert.deepEqual([...r.layers[0].img.data], [5, 6, 7, 255]);
});

test("refuses what is not an XCF, damaged, or too big", async () => {
  const reject = async (b, msg, o) => assert.rejects(X.read(b, o), (e) => e.message === msg);
  await reject(new Uint8Array(40), "xcf");
  const good = xcf({ w: 4, h: 4, layers: [{ name: "L", w: 4, h: 4, type: 1, bpp: 4, px: rgba(16, 1, 2, 3, 4) }] });
  await reject(good.subarray(0, good.length - 10), "xcf");
  await reject(xcf({ w: 5000, h: 5000, layers: [] }), "xcf-big", { maxPixels: 1e6 });
  await reject(xcf({ w: 1, h: 1, prec: 999, layers: [] }), "xcf");
  // an RLE run longer than the tile
  assert.throws(() => X.unrle(Buffer.from([126, 9]), 0, 2, new Uint8Array(4), 1, 4), /xcf/);
});

test("Photo Lab wiring: worker and lazy page load, .xcf opens, the shared report", () => {
  const fs = require("fs"), path = require("path"), R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  assert.match(R("photolab/worker.js"), /"psd\.js", "xcf\.js"/);
  assert.match(R("photolab/jobs.js"), /case "xcf": return loadXcf\(\)/);
  assert.match(R("photolab/io.js"), /return "xcf"/);
  assert.match(R("fileopen.js"), /"image\/x-xcf": \["\.xcf"\]/);
  assert.match(R("manifest.webmanifest"), /"image\/x-xcf":\["\.xcf"\]/);
});
