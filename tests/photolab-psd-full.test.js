// Photo Lab: Photoshop files in full (wave PS-1). photolab/psdinfo.js
// (descriptors, layer styles, adjustment and fill layers, vector
// masks) and what photolab/psd.js makes of them: masks kept as masks,
// adjustment layers, styles, clipping baked, 16/32-bit layers in
// Lr16/Lr32, PSB, Indexed, Lab, Bitmap, and masks written back.
// The files are built here byte by byte from Adobe's file format
// specification (no Photoshop in the test machine).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const PSD = require("../photolab/psd.js");
const I = require("../photolab/psdinfo.js");

// ---------- Bytes ----------
function u8(...v) { return Buffer.from(v); }
function u16(v) { const b = Buffer.alloc(2); b.writeUInt16BE(v & 0xffff); return b; }
function i16(v) { const b = Buffer.alloc(2); b.writeInt16BE(v); return b; }
function u32(v) { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b; }
function i32(v) { const b = Buffer.alloc(4); b.writeInt32BE(v | 0); return b; }
function u64(v) { return Buffer.concat([u32(Math.floor(v / 4294967296)), u32(v % 4294967296)]); }
function f32(v) { const b = Buffer.alloc(4); b.writeFloatBE(v); return b; }
function f64(v) { const b = Buffer.alloc(8); b.writeDoubleBE(v); return b; }
const str = (s) => Buffer.from(s, "latin1");
const cat = (...a) => Buffer.concat(a);

// ---------- Action Descriptors (writer for the tests) ----------
function key(k) { return k.length === 4 ? cat(u32(0), str(k)) : cat(u32(k.length), str(k)); }
function uni(s) { return cat(u32(s.length), ...[...s].map((c) => u16(c.charCodeAt(0)))); }
// value: number → doub; {u, v} → UntF; true/false → bool; string → TEXT;
// {t, e} → enum; {_class, ...} → Objc; array → VlLs; {long} → long
function item(v) {
  if (typeof v === "number") return cat(str("doub"), f64(v));
  if (typeof v === "boolean") return cat(str("bool"), u8(v ? 1 : 0));
  if (typeof v === "string") return cat(str("TEXT"), uni(v));
  if (Array.isArray(v)) return cat(str("VlLs"), u32(v.length), ...v.map(item));
  if ("long" in v) return cat(str("long"), i32(v.long));
  if ("u" in v) return cat(str("UntF"), str(v.u), f64(v.v));
  if ("e" in v) return cat(str("enum"), key(v.t), key(v.e));
  return cat(str("Objc"), descBody(v));
}
function descBody(o) {
  const ks = Object.keys(o).filter((k) => k !== "_class");
  return cat(uni(""), key(o._class || "null"), u32(ks.length), ...ks.map((k) => cat(key(k), item(o[k]))));
}
const desc16 = (o) => cat(u32(16), descBody(o));
const rgb = (r, g, b) => ({ _class: "RGBC", "Rd  ": r, "Grn ": g, "Bl  ": b });
const pct = (v) => ({ u: "#Prc", v });
const pxl = (v) => ({ u: "#Pxl", v });

// ---------- A PSD / PSB builder ----------
// layer: { rect: [t, l, b, r], ch: [{ id, data: Buffer (raw) }], key, op, clip, flags,
//          name, mask: { rect, def, flags }, real, info: [[key, Buffer]], section, blendIf }
function chRaw(bytes) { return cat(u16(0), Buffer.from(bytes)); }
function block(k, data, big) {
  const len = big && /^(LMsk|Lr16|Lr32|Layr|Mt16|Mt32|Mtrn|Alph|FMsk|lnk2|FEid|FXid|PxSD)$/.test(k) ? u64(data.length) : u32(data.length);
  return cat(str("8BIM"), str(k), len, data);
}
function layerInfo(layers, big, negative) {
  const recs = [], data = [];
  layers.forEach((L) => {
    const r = [i32(L.rect[0]), i32(L.rect[1]), i32(L.rect[2]), i32(L.rect[3]), u16(L.ch.length)];
    L.ch.forEach((c) => { const b = chRaw(c.data); r.push(i16(c.id), big ? u64(b.length) : u32(b.length)); data.push(b); });
    r.push(str("8BIM"), str(L.key || "norm"), u8(L.op == null ? 255 : L.op, L.clip || 0, L.flags || 0, 0));
    const ex = [];
    if (L.mask) {
      const m = L.mask, mb = [i32(m.rect[0]), i32(m.rect[1]), i32(m.rect[2]), i32(m.rect[3]), u8(m.def || 0, m.flags || 0)];
      if (L.real) mb.push(u8(L.real.flags || 0, L.real.def || 0), i32(L.real.rect[0]), i32(L.real.rect[1]), i32(L.real.rect[2]), i32(L.real.rect[3]));
      else mb.push(u8(0, 0));
      const b = cat(...mb);
      ex.push(u32(b.length), b);
    } else ex.push(u32(0));
    const br = L.blendIf ? cat(u8(0, 0, 255, 255), u8(10, 20, 255, 255)) : Buffer.alloc(0);
    ex.push(u32(br.length), br);
    const nm = str(L.name || "L"), pad = (4 - ((nm.length + 1) % 4)) % 4;
    ex.push(u8(nm.length), nm, Buffer.alloc(pad));
    if (L.section) ex.push(block("lsct", cat(u32(L.section), L.gblend ? cat(str("8BIM"), str(L.gblend)) : Buffer.alloc(0))));
    (L.info || []).forEach(([k, d]) => ex.push(block(k, d, big)));
    const e = cat(...ex);
    r.push(u32(e.length), e);
    recs.push(cat(...r));
  });
  return cat(i16(negative ? -layers.length : layers.length), ...recs, ...data);
}
function psd(o) {
  const big = o.ver === 2;
  const parts = [str("8BPS"), u16(o.ver || 1), Buffer.alloc(6), u16(o.nch || 3), u32(o.h), u32(o.w), u16(o.depth || 8), u16(o.mode == null ? 3 : o.mode)];
  const cm = o.palette || Buffer.alloc(0);
  parts.push(u32(cm.length), cm);
  const res = (o.res || []).map(([id, d]) => cat(str("8BIM"), u16(id), u8(0, 0), u32(d.length), d, Buffer.alloc(d.length % 2)));
  const rs = cat(...res);
  parts.push(u32(rs.length), rs);
  let lm = Buffer.alloc(0);
  if (o.layers || o.lr16) {
    const li = o.layers ? layerInfo(o.layers, big) : Buffer.alloc(0);
    const tail = o.lr16 ? block(o.lr16.key, layerInfo(o.lr16.layers, big), big) : Buffer.alloc(0);
    lm = cat(big ? u64(li.length) : u32(li.length), li, u32(0), tail);
  }
  parts.push(big ? u64(lm.length) : u32(lm.length), lm);
  parts.push(o.merged || Buffer.alloc(0));
  return new Uint8Array(Buffer.concat(parts));
}
const rgbCh = (n, r, g, b, a) => [{ id: 0, data: Array(n).fill(r) }, { id: 1, data: Array(n).fill(g) }, { id: 2, data: Array(n).fill(b) }].concat(a == null ? [] : [{ id: -1, data: Array(n).fill(a) }]);
const px = (L, x, y) => { const i = ((y - L.y) * L.img.w + (x - L.x)) * 4; return [...L.img.data.slice(i, i + 4)]; };

// ---------- psdinfo.js ----------
test("descriptors: nested objects, lists, units, enums, text, and limits", () => {
  const d = I.desc(descBody({ _class: "null", a: 1.5, b: pxl(7), c: { t: "BlnM", e: "Mltp" }, d: "Λόγος", e: [1, 2, true], f: { _class: "RGBC", "Rd  ": 10, "Grn ": 20, "Bl  ": 30 }, g: { long: -4 } }));
  assert.equal(d.a, 1.5); assert.deepEqual(d.b, { u: "#Pxl", v: 7 }); assert.deepEqual(d.c, { t: "BlnM", e: "Mltp" });
  assert.equal(d.d, "Λόγος"); assert.deepEqual(d.e, [1, 2, true]); assert.equal(d.g, -4);
  assert.equal(I.colour(d.f), "#0a141e");
  assert.throws(() => I.desc(descBody({ x: 1 }).subarray(0, 20)), /psd-info/);
  // 13 objects deep is refused
  let o = { _class: "null", v: 1 };
  for (let i = 0; i < 14; i++) o = { _class: "null", o };
  assert.throws(() => I.desc(descBody(o)), /psd-info/);
});

test("colours: RGB, HSB, CMYK, grey, Lab and the binary 10-byte colours", () => {
  assert.equal(I.colour({ _class: "HSBC", "H   ": 120, Strt: 100, Brgh: 100 }), "#00ff00");
  assert.equal(I.colour({ _class: "CMYC", "Cyn ": 0, Mgnt: 100, "Ylw ": 100, Blck: 0 }), "#ff0000");
  assert.equal(I.colour({ _class: "Grsc", "Gry ": 100 }), "#000000");
  assert.equal(I.colour({ _class: "LbCl", Lmnc: 100, "A   ": 0, "B   ": 0 }), "#ffffff");
  assert.equal(I.binColour(0, [65535, 0, 32896, 0]), "#ff0080");
  assert.equal(I.binColour(8, [10000, 0, 0, 0]), "#000000");
});

function lfx2(o) { return cat(u32(0), desc16(Object.assign({ _class: "null", masterFXSwitch: true, "Scl ": pct(100) }, o))); }
test("layer styles: drop shadow, glows, stroke, colour overlay; the rest named", () => {
  const e = I.effects(lfx2({
    DrSh: { _class: "DrSh", enab: true, "Md  ": { t: "BlnM", e: "Mltp" }, "Clr ": rgb(20, 0, 0), Opct: pct(60), uglg: false, lagl: { u: "#Ang", v: 135 }, Dstn: pxl(8), Ckmt: pxl(0), blur: pxl(12) },
    OrGl: { _class: "OrGl", enab: true, "Clr ": rgb(255, 255, 0), Opct: pct(50), blur: pxl(9) },
    IrGl: { _class: "IrGl", enab: false, "Clr ": rgb(255, 255, 0), Opct: pct(50), blur: pxl(9) },
    FrFX: { _class: "FrFX", enab: true, Styl: { t: "FStl", e: "InsF" }, PntT: { t: "FrFl", e: "SClr" }, Opct: pct(100), "Sz  ": pxl(4), "Clr ": rgb(0, 0, 255) },
    SoFi: { _class: "SoFi", enab: true, "Clr ": rgb(0, 255, 0), Opct: pct(30) },
    ebbl: { _class: "ebbl", enab: true },
    IrSh: { _class: "IrSh", enab: false }
  }), 120);
  assert.deepEqual(e.fx, {
    sh: { c: "#140000", op: 60, a: 135, d: 8, s: 12 },
    gl: { c: "#ffff00", op: 50, s: 9 },
    st: { c: "#0000ff", op: 100, w: 4 },
    co: { c: "#00ff00", op: 30 }
  });
  assert.deepEqual(e.lost, ["bevel"]);                    // the inner shadow is off
  assert.deepEqual(e.approx, ["strokeInside"]);
  // the global light angle when the shadow uses it; all off → nothing
  assert.equal(I.effects(lfx2({ DrSh: { _class: "DrSh", enab: true, uglg: true, Dstn: pxl(3), blur: pxl(3) } }), 90).fx.sh.a, 90);
  assert.equal(I.effects(lfx2({ masterFXSwitch: false, DrSh: { _class: "DrSh", enab: true } }), 120).fx, null);
  // Photoshop CC's lists of styles: the first one that is on
  const m = I.effects(lfx2({ dropShadowMulti: [{ _class: "DrSh", enab: false, Dstn: pxl(1) }, { _class: "DrSh", enab: true, Dstn: pxl(5), blur: pxl(2) }] }), 120);
  assert.equal(m.fx.sh.d, 5);
});

test("adjustment layers: the eleven kinds Photo Lab has, close ones marked, others lost", () => {
  const levl = cat(u16(2), u16(10), u16(240), u16(5), u16(250), u16(150), ...Array(28).fill(cat(u16(0), u16(255), u16(0), u16(255), u16(100))));
  assert.deepEqual(I.adjust("levl", levl), { aj: { id: "levels", p: { ib: 10, iw: 240, g: 1.5, ob: 5, ow: 250 } }, approx: false });
  // curves version 1, composite only (bit 0), points as (output, input)
  const curv = cat(u8(0), u16(1), u32(1), u16(3), u16(0), u16(0), u16(160), u16(128), u16(255), u16(255));
  const c = I.adjust("curv", curv);
  assert.equal(c.aj.id, "curves"); assert.equal(c.aj.p.m, 160); assert.equal(c.approx, false);
  assert.ok(c.aj.p.s > 64 && c.aj.p.h > 192, JSON.stringify(c.aj.p));
  // a red-channel curve too → approximate
  assert.equal(I.adjust("curv", cat(u8(0), u16(1), u32(3), u16(2), u16(0), u16(0), u16(255), u16(255), u16(2), u16(0), u16(30), u16(255), u16(255))).approx, true);
  const hue = cat(u16(2), u8(0, 0), i16(0), i16(25), i16(0), i16(30), i16(-20), i16(10), ...Array(6).fill(cat(Buffer.alloc(8), i16(0), i16(0), i16(0))));
  assert.deepEqual(I.adjust("hue2", hue).aj, { id: "hsl", p: { h: 30, s: -20, l: 10 } });
  const bal = cat(...[0, 0, 0, 40, -10, 20, 0, 0, 0].map(i16), u8(1));
  assert.deepEqual(I.adjust("blnc", bal), { aj: { id: "balance", p: { r: 40, g: -10, b: 20 } }, approx: false });
  assert.deepEqual(I.adjust("brit", cat(i16(30), i16(-20), i16(0), u8(0))).aj, { id: "bc", p: { b: 30, c: -20 } });
  assert.deepEqual(I.adjust("CgEd", desc16({ _class: "null", Vrsn: { long: 1 }, Brgh: { long: -40 }, Cntr: { long: 10 }, useLegacy: true })).aj, { id: "bc", p: { b: -40, c: 10 } });
  assert.deepEqual(I.adjust("blwh", desc16({ _class: "null", "Rd  ": { long: 40 }, Yllw: { long: 60 }, useTint: false })), { aj: { id: "gray", p: {} }, approx: false });
  assert.deepEqual(I.adjust("phfl", cat(u16(2), u16(0), u16(65535), u16(32896), u16(0), u16(0), u32(40), u8(1))).aj, { id: "photo", p: { c: "#ff8000", d: 40 } });
  const grdm = cat(u16(1), u8(0, 0), uni("BW"), u16(2),
    u32(0), u32(50), u16(0), u16(0), u16(0), u16(65535), u16(0), u16(0),
    u32(4096), u32(50), u16(0), u16(65535), u16(65535), u16(0), u16(0), u16(0));
  assert.deepEqual(I.adjust("grdm", grdm).aj, { id: "gradmap", p: { c0: "#0000ff", c1: "#ffff00" } });
  assert.deepEqual(I.adjust("nvrt", Buffer.alloc(0)).aj, { id: "invert", p: {} });
  assert.deepEqual(I.adjust("thrs", cat(u16(90), u16(0))).aj, { id: "threshold", p: { t: 90 } });
  assert.deepEqual(I.adjust("post", cat(u16(6), u16(0))).aj, { id: "posterize", p: { n: 6 } });
  assert.equal(I.adjust("vibA", desc16({ _class: "null", vibrance: { long: 40 }, Strt: { long: 10 } })).aj.p.s, 30);
  const ex = I.adjust("expA", cat(u16(1), f32(1), f32(0), f32(1)));
  assert.equal(ex.aj.id, "levels"); assert.equal(ex.aj.p.iw, 128); assert.equal(ex.approx, true);
  assert.deepEqual(I.adjust("selc", Buffer.alloc(10)), { lost: "selc" });
  assert.deepEqual(I.adjust("levl", u16(9)), { lost: "levl" });   // damaged → lost, never a throw
});

test("vector masks: a rectangle path painted with soft edges, inverted, subtract", () => {
  const fx = (v) => i32(Math.round(v * 16777216));
  const knot = (x, y) => cat(u16(1), fx(y), fx(x), fx(y), fx(x), fx(y), fx(x));   // a corner: controls on the anchor
  const sub = (n, op) => cat(u16(0), u16(n), i16(op), Buffer.alloc(20));
  const rect = (x0, y0, x1, y1, op) => cat(sub(4, op), knot(x0, y0), knot(x1, y0), knot(x1, y1), knot(x0, y1));
  const vm = I.vmask(cat(u32(3), u32(0), cat(u16(6), Buffer.alloc(24)), rect(0.25, 0.25, 0.75, 0.75, 1)));
  assert.equal(vm.paths.length, 1);
  const cov = I.paint(vm, 8, 8, 0, 0, 8, 8);
  assert.equal(cov[0], 0); assert.equal(cov[3 * 8 + 3], 255); assert.equal(cov[2 * 8 + 2], 255); assert.equal(cov[1 * 8 + 1], 0);
  const inv = I.paint(I.vmask(cat(u32(3), u32(1), rect(0.25, 0.25, 0.75, 0.75, 1))), 8, 8, 0, 0, 8, 8);
  assert.equal(inv[0], 255); assert.equal(inv[3 * 8 + 3], 0);
  const hole = I.paint(I.vmask(cat(u32(3), u32(0), rect(0, 0, 1, 1, 1), rect(0.25, 0.25, 0.75, 0.75, 2))), 8, 8, 0, 0, 8, 8);
  assert.equal(hole[0], 255); assert.equal(hole[4 * 8 + 4], 0);
  // half a pixel covered → about half
  const half = I.paint(I.vmask(cat(u32(3), u32(0), rect(0, 0, 0.5625, 1, 1))), 8, 8, 0, 0, 8, 8);
  assert.ok(Math.abs(half[4] - 128) <= 1, String(half[4]));
});

// ---------- psd.js reading ----------
test("a layer mask stays a mask (box, default, off, inverted); a real mask wins over the vector picture", async () => {
  const file = psd({ w: 4, h: 4, layers: [
    { rect: [0, 0, 4, 4], name: "Masked", ch: rgbCh(16, 200, 10, 10, 255).concat([{ id: -2, data: [0, 128, 255, 64] }]), mask: { rect: [1, 1, 3, 3], def: 255, flags: 2 } },
    { rect: [0, 0, 2, 2], name: "Inverted", ch: rgbCh(4, 1, 2, 3, 255).concat([{ id: -2, data: [0] }]), mask: { rect: [0, 0, 1, 1], def: 0, flags: 4 } },
    { rect: [0, 0, 2, 2], name: "Both", ch: rgbCh(4, 1, 2, 3, 255).concat([{ id: -2, data: [9] }, { id: -3, data: [77, 78] }]),
      mask: { rect: [0, 0, 1, 1], def: 0, flags: 0 }, real: { flags: 0, def: 255, rect: [0, 0, 1, 2] } }
  ] });
  const r = await PSD.read(file);
  const [a, b, c] = r.layers;
  assert.deepEqual(a.mk, { x: 1, y: 1, img: { w: 2, h: 2, data: new Uint8Array([0, 128, 255, 64]) }, bg: 255, on: 0 });
  assert.deepEqual(px(a, 0, 0), [200, 10, 10, 255]);       // pixels untouched
  assert.deepEqual([b.mk.img.data[0], b.mk.bg], [255, 255]);
  assert.deepEqual([...c.mk.img.data], [77, 78]); assert.equal(c.mk.bg, 255);
});

test("adjustment layers come as adjustment layers with their masks; styles come as styles", async () => {
  const levl = cat(u16(2), u16(20), u16(230), u16(0), u16(255), u16(100), ...Array(28).fill(cat(u16(0), u16(255), u16(0), u16(255), u16(100))));
  const file = psd({ w: 4, h: 4, res: [[1037, i32(30)]], layers: [
    { rect: [0, 0, 4, 4], name: "Photo", ch: rgbCh(16, 100, 100, 100, 255),
      info: [["lfx2", lfx2({ DrSh: { _class: "DrSh", enab: true, uglg: true, "Clr ": rgb(0, 0, 0), Opct: pct(40), Dstn: pxl(2), blur: pxl(3) }, ChFX: { _class: "ChFX", enab: true } })]] },
    { rect: [0, 0, 0, 0], name: "Levels 1", op: 128, ch: [{ id: -1, data: [] }, { id: -2, data: [255, 0] }], mask: { rect: [0, 0, 1, 2], def: 0 }, info: [["levl", levl]] },
    { rect: [0, 0, 0, 0], name: "Selective", ch: [], info: [["selc", Buffer.alloc(40)]] }
  ] });
  const r = await PSD.read(file);
  assert.equal(r.layers.length, 2);
  const [p, l] = r.layers;
  assert.deepEqual(p.fx, { sh: { c: "#000000", op: 40, a: 30, d: 2, s: 3 } });
  assert.equal(l.k, "adj"); assert.deepEqual(l.aj, { id: "levels", p: { ib: 20, iw: 230, g: 1, ob: 0, ow: 255 } });
  assert.equal(l.op, 50);
  assert.deepEqual(l.mk.img.data, new Uint8Array([255, 0]));
  assert.deepEqual(r.names.fx_satin, ["Photo"]);
  assert.deepEqual(r.names.adjLost, ["Selective"]);
});

test("fill layers without pixels are drawn; a vector mask becomes the layer's mask", async () => {
  const fxp = (v) => i32(Math.round(v * 16777216));
  const knot = (x, y) => cat(u16(1), fxp(y), fxp(x), fxp(y), fxp(x), fxp(y), fxp(x));
  const vmsk = cat(u32(3), u32(0), u16(0), u16(4), i16(1), Buffer.alloc(20), knot(0, 0), knot(0.5, 0), knot(0.5, 1), knot(0, 1));
  const file = psd({ w: 4, h: 2, layers: [
    { rect: [0, 0, 0, 0], name: "Colour fill", ch: [], info: [["SoCo", desc16({ _class: "null", "Clr ": rgb(255, 128, 0) })], ["vmsk", vmsk]] },
    { rect: [0, 0, 0, 0], name: "Gradient", ch: [], info: [["GdFl", desc16({ _class: "null", Angl: { u: "#Ang", v: 0 }, Type: { t: "GrdT", e: "Lnr " },
      Grad: { _class: "Grdn", Clrs: [{ _class: "Clrt", "Clr ": rgb(0, 0, 0), Lctn: { long: 0 } }, { _class: "Clrt", "Clr ": rgb(255, 255, 255), Lctn: { long: 4096 } }] } })]] },
    { rect: [0, 0, 0, 0], name: "Pattern", ch: [], info: [["PtFl", desc16({ _class: "null" })]] }
  ] });
  const r = await PSD.read(file);
  assert.equal(r.layers.length, 2);
  const [s, g] = r.layers;
  assert.deepEqual(px(s, 3, 1), [255, 128, 0, 255]);
  assert.deepEqual([s.mk.x, s.mk.y, s.mk.img.w, s.mk.img.h, s.mk.bg], [0, 0, 2, 2, 0]);
  assert.equal(s.mk.img.data[0], 255);
  assert.ok(px(g, 0, 0)[0] < 64 && px(g, 3, 0)[0] > 192, "dark on the left, light on the right");
  assert.deepEqual(r.names.fillLost, ["Pattern"]);
  assert.equal(r.notes.vmask, 1);
});

test("clipping: a clipped picture keeps what lies over its base; a clipped adjustment changes the base", async () => {
  const file = psd({ w: 4, h: 1, layers: [
    { rect: [0, 0, 1, 2], name: "Base", ch: rgbCh(2, 100, 100, 100, 255) },
    { rect: [0, 0, 1, 4], name: "Clipped", clip: 1, ch: rgbCh(4, 255, 0, 0, 255) },
    { rect: [0, 0, 0, 0], name: "Invert", clip: 1, ch: [], info: [["nvrt", Buffer.alloc(0)]] },
    { rect: [0, 0, 1, 4], name: "Free", ch: rgbCh(4, 0, 0, 255, 128) }
  ] });
  const r = await PSD.read(file);
  assert.deepEqual(r.layers.map((L) => L.name), ["Base", "Clipped", "Free"]);
  assert.deepEqual(px(r.layers[0], 0, 0), [155, 155, 155, 255]);   // inverted in place
  assert.deepEqual(px(r.layers[1], 1, 0), [255, 0, 0, 255]);
  assert.deepEqual(px(r.layers[1], 2, 0), [255, 0, 0, 0]);         // past the base: gone
  assert.equal(r.layers[2].img.data[3], 128);
  assert.equal(r.notes.clip, 1); assert.equal(r.notes.clipAdj, 1);
  assert.ok(r.layers.every((L) => !("clip" in L)));
});

test("groups: opacity, visibility and mask go onto the layers inside; fill opacity; Blend If and blend modes named", async () => {
  const file = psd({ w: 2, h: 1, layers: [
    { rect: [0, 0, 0, 0], ch: [], section: 3, name: "</Layer group>" },
    { rect: [0, 0, 1, 2], name: "Inside", ch: rgbCh(2, 9, 9, 9, 255), info: [["iOpa", u8(128, 0, 0, 0)]], blendIf: true },
    { rect: [0, 0, 0, 0], name: "Group", section: 1, gblend: "mul ", op: 255, ch: [{ id: -2, data: [255, 0] }], mask: { rect: [0, 0, 1, 2], def: 0 } }
  ] });
  const r = await PSD.read(file);
  const L = r.layers[0];
  assert.equal(L.op, 50);                                  // fill 128 without styles → opacity
  assert.deepEqual([L.img.data[3], L.img.data[7]], [255, 0]);   // the group's mask, baked
  assert.deepEqual(r.names.groupBlend, ["Group"]);
  assert.deepEqual(r.names.blendIf, ["Inside"]);
  assert.equal(r.notes.groupMask, 1);
});

test("16-bit layers in Lr16, 32-bit layers in Lr32 (linear light), and PSB with 8-byte lengths", async () => {
  const two = (v) => [v >> 8, v & 255];
  const file16 = psd({ w: 1, h: 1, depth: 16, lr16: { key: "Lr16", layers: [
    { rect: [0, 0, 1, 1], name: "Deep", ch: [{ id: 0, data: two(0xff00) }, { id: 1, data: two(0x8000) }, { id: 2, data: two(0x0100) }, { id: -1, data: two(0xffff) }] }
  ] } });
  let r = await PSD.read(file16);
  assert.equal(r.layers.length, 1); assert.equal(r.layers[0].name, "Deep");
  assert.deepEqual([...r.layers[0].img.data], [255, 128, 1, 255]);
  const fl = (v) => [...f32(v)];
  const file32 = psd({ w: 1, h: 1, depth: 32, lr16: { key: "Lr32", layers: [
    { rect: [0, 0, 1, 1], name: "HDR", ch: [{ id: 0, data: fl(1) }, { id: 1, data: fl(0.2140) }, { id: 2, data: fl(4) }, { id: -1, data: fl(0.5) }] }
  ] } });
  r = await PSD.read(file32);
  assert.deepEqual([...r.layers[0].img.data], [255, 128, 255, 128]);
  assert.equal(r.notes.hdr, 1);
  const big = psd({ ver: 2, w: 3, h: 1, layers: [{ rect: [0, 0, 1, 3], name: "Large", ch: rgbCh(3, 7, 8, 9, 255) }] });
  r = await PSD.read(big);
  assert.deepEqual(px(r.layers[0], 2, 0), [7, 8, 9, 255]);
});

test("flat Indexed (with its transparent colour), Lab, Bitmap and Duotone files", async () => {
  const pal = Buffer.alloc(768); pal[1] = 255; pal[256 + 1] = 0; pal[512 + 1] = 0; pal[2] = 0; pal[256 + 2] = 0; pal[512 + 2] = 255;
  let r = await PSD.read(psd({ w: 3, h: 1, nch: 1, mode: 2, palette: pal, res: [[1047, u16(2)]], merged: cat(u16(0), u8(1, 0, 2)) }));
  assert.deepEqual([...r.merged.data], [255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0]);
  r = await PSD.read(psd({ w: 1, h: 1, nch: 3, mode: 9, merged: cat(u16(0), u8(255, 128, 128)) }));
  assert.deepEqual([...r.merged.data], [255, 255, 255, 255]);
  r = await PSD.read(psd({ w: 9, h: 1, nch: 1, mode: 0, depth: 1, merged: cat(u16(0), u8(0b10100000, 0b10000000)) }));
  assert.deepEqual([0, 1, 2, 8].map((x) => r.merged.data[x * 4]), [0, 255, 0, 0]);
  r = await PSD.read(psd({ w: 1, h: 1, nch: 1, mode: 8, merged: cat(u16(0), u8(77)) }));
  assert.equal(r.merged.data[0], 77); assert.equal(r.notes.duotone, 1);
});

test("text, smart objects and artboards are named; damaged style or adjustment blocks never stop the file", async () => {
  const file = psd({ w: 1, h: 1, layers: [
    { rect: [0, 0, 1, 1], name: "Title", ch: rgbCh(1, 1, 1, 1, 255), info: [["TySh", Buffer.alloc(4)], ["lfx2", Buffer.from([0, 0, 0, 0, 0, 0, 0, 16, 1])]] },
    { rect: [0, 0, 1, 1], name: "Logo", ch: rgbCh(1, 1, 1, 1, 255), info: [["SoLd", Buffer.alloc(4)]] },
    { rect: [0, 0, 0, 0], name: "Curves", ch: [], info: [["curv", Buffer.from([0, 0, 9])]] }
  ] });
  const r = await PSD.read(file);
  assert.equal(r.layers.length, 2);
  assert.deepEqual(r.names.text, ["Title"]); assert.deepEqual(r.names.smart, ["Logo"]);
  assert.deepEqual(r.names.fxLost, ["Title"]); assert.deepEqual(r.names.adjLost, ["Curves"]);
});

// ---------- Writing masks ----------
test("write keeps a picture layer's mask: read back the same box, values, default and off", async () => {
  const img = { w: 3, h: 2, data: new Uint8ClampedArray(24).fill(200) };
  const mk = { x: 1, y: 0, img: { w: 2, h: 2, data: new Uint8Array([0, 50, 100, 255]) }, bg: 255, on: 0 };
  const merged = { w: 3, h: 2, data: new Uint8ClampedArray(24).fill(200) };
  const bytes = PSD.write({ w: 3, h: 2, layers: [{ name: "Μάσκα", x: 0, y: 0, img, op: 100, bl: "normal", vis: 1, mk }], merged });
  const r = await PSD.read(bytes);
  assert.equal(r.layers[0].name, "Μάσκα");
  assert.deepEqual(r.layers[0].mk, mk);
});

test("Photo Lab wiring: psdinfo.js loads before psd.js in the page and the worker, PSB opens, strings in EN, EL, DE", () => {
  const fs = require("fs"), path = require("path"), R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const html = R("photolab/index.html");
  assert.ok(html.indexOf("psdinfo.js") > 0 && html.indexOf("psdinfo.js") < html.indexOf('src="psd.js'));
  assert.match(R("photolab/worker.js"), /"psdinfo\.js", "psd\.js"/);
  assert.match(R("photolab/io.js"), /\\\.ps\[db\]\$/);
  assert.match(R("fileopen.js"), /"\.psd", "\.psb"/);
  global.window = global.window || {};
  require("../photolab/strings.js");
  const S = global.window.PL_STRINGS, de = R("i18n/de/photolab.js");
  const keys = Object.keys(S.en).filter((k) => k.startsWith("psd."));
  assert.ok(keys.length >= 30);
  keys.forEach((k) => { assert.ok(S.el[k], "EL " + k); assert.ok(de.includes('"' + k + '"'), "DE " + k); });
  // every note psd.js can give has a line (or is shown another way)
  const io = R("photolab/io.js");
  ["text", "smart", "adjApprox", "adjLost", "fxApprox", "fxLost", "fillApprox", "fillLost", "fillFx", "clip", "clipAdj", "clipLost",
   "groups", "groupBlend", "groupFx", "blend", "blendIf", "vmaskLost", "artboard", "empty", "cmyk", "hdr", "duotone"].forEach((k) => {
    assert.ok(io.includes('"' + k + '"'), "io " + k); assert.ok(S.en["psd." + k], "EN " + k);
  });
});
