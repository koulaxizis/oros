// Integrations wave 5 (Adobe files without an account): swatch files
// (.ase, .aco) for the Atelier Brand kit and Lightroom / Camera Raw
// presets (.xmp) as Photo Lab adjustment layers.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const SW = require("../atelier/swatches.js");
const X = require("../photolab/xmp.js");
const PC = require("../photolab/core.js");

// ---------- swatches ----------
function aseBlock(type, payload) {
  const b = Buffer.alloc(6);
  b.writeUInt16BE(type, 0); b.writeUInt32BE(payload.length, 2);
  return Buffer.concat([b, payload]);
}
function aseName(s) {
  const b = Buffer.alloc(2 + (s.length + 1) * 2);
  b.writeUInt16BE(s.length + 1, 0);
  for (let i = 0; i < s.length; i++) b.writeUInt16BE(s.charCodeAt(i), 2 + i * 2);
  return b;
}
function aseColor(name, model, vals) {
  const f = Buffer.alloc(vals.length * 4 + 2);
  vals.forEach((v, i) => f.writeFloatBE(v, i * 4));
  return aseBlock(1, Buffer.concat([aseName(name), Buffer.from(model, "ascii"), f]));
}
function ase(blocks) {
  const h = Buffer.alloc(12);
  h.write("ASEF", 0, "ascii"); h.writeUInt16BE(1, 4); h.writeUInt16BE(0, 6); h.writeUInt32BE(blocks.length, 8);
  return new Uint8Array(Buffer.concat([h, ...blocks]));
}

test("ase: RGB, CMYK, Gray, LAB, groups flattened, names kept", () => {
  const bytes = ase([
    aseBlock(0xC001, aseName("Brand")),
    aseColor("Κόκκινο", "RGB ", [1, 0, 0]),
    aseColor("Cyan", "CMYK", [1, 0, 0, 0]),
    aseColor("Mid gray", "Gray", [0.5]),
    aseColor("Lab white", "LAB ", [1, 0, 0]),
    aseBlock(0xC002, Buffer.alloc(0))
  ]);
  const got = SW.read(bytes);
  assert.deepEqual(got.map((x) => x.c), ["#ff0000", "#00ffff", "#808080", "#ffffff"]);
  assert.equal(got[0].name, "Κόκκινο");
});

test("ase: written by orOS reads back the same", () => {
  const out = SW.writeAse([{ c: "#5e17eb" }, { c: "#00A86B", name: "Jade" }, { c: "bad" }], "Brand colours");
  assert.equal(Buffer.from(out.slice(0, 4)).toString("ascii"), "ASEF");
  assert.deepEqual(SW.read(out), [{ name: "#5e17eb", c: "#5e17eb" }, { name: "Jade", c: "#00a86b" }]);
});

test("aco: version 1 then 2 with names; RGB, CMYK, Lab, Gray; others skipped", () => {
  const rows = [[0, 65535, 32896, 0, 0, "Orange"], [2, 0, 65535, 65535, 65535, "Cyan ink"], [7, 10000, 0, 0, 0, "White"], [8, 10000, 0, 0, 0, "Black"], [3, 1, 2, 3, 4, "Pantone"]];
  const parts = [];
  const v1 = Buffer.alloc(4 + rows.length * 10);
  v1.writeUInt16BE(1, 0); v1.writeUInt16BE(rows.length, 2);
  rows.forEach((r, i) => r.slice(0, 5).forEach((v, j) => v1.writeUInt16BE(v, 4 + i * 10 + j * 2)));
  parts.push(v1);
  const h2 = Buffer.alloc(4); h2.writeUInt16BE(2, 0); h2.writeUInt16BE(rows.length, 2); parts.push(h2);
  rows.forEach((r) => {
    const c = Buffer.alloc(10); r.slice(0, 5).forEach((v, j) => c.writeUInt16BE(v, j * 2));
    const n = Buffer.alloc(4 + (r[5].length + 1) * 2); n.writeUInt16BE(0, 0); n.writeUInt16BE(r[5].length + 1, 2);
    for (let i = 0; i < r[5].length; i++) n.writeUInt16BE(r[5].charCodeAt(i), 4 + i * 2);
    parts.push(c, n);
  });
  const got = SW.read(new Uint8Array(Buffer.concat(parts)));
  assert.deepEqual(got, [{ name: "Orange", c: "#ff8000" }, { name: "Cyan ink", c: "#00ffff" }, { name: "White", c: "#ffffff" }, { name: "Black", c: "#000000" }]);
});

test("swatches: damaged or hostile files are refused, never over-read", () => {
  assert.throws(() => SW.read(new Uint8Array([1, 2])), /swatch/);
  assert.throws(() => SW.read(new Uint8Array(Buffer.from("PK\u0003\u0004 not a swatch file"))), /swatch/);
  const h = Buffer.alloc(12); h.write("ASEF", 0, "ascii"); h.writeUInt32BE(0xffffffff, 8);
  assert.throws(() => SW.read(new Uint8Array(h)), /swatch/);
  const bad = ase([aseColor("x", "RGB ", [1, 1, 1])]);
  bad[15] = 0xff;                                   // block length past the end
  assert.throws(() => SW.read(bad), /swatch/);
});

// ---------- Lightroom presets ----------
const NS = 'xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"';
const attrs = (o) => Object.entries(o).map(([k, v]) => `crs:${k}="${v}"`).join(" ");
const xmp = (o, extra) => `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" ${NS} ${attrs(o)}>${extra || ""}</rdf:Description></rdf:RDF></x:xmpmeta>`;

test("xmp: tone, white balance, colour and black and white become adjustment layers", () => {
  const r = X.parse(xmp({ Exposure2012: "+1.00", Contrast2012: "+25", Highlights2012: "-50", Shadows2012: "+40", Whites2012: "+10", Blacks2012: "-20",
    IncrementalTemperature: "+20", IncrementalTint: "-10", Saturation: "-10", Vibrance: "+30", ConvertToGrayscale: "True", Clarity2012: "+15", Sharpness: "40" },
    '<crs:Name><rdf:Alt><rdf:li xml:lang="x-default">Warm &amp; bright</rdf:li></rdf:Alt></crs:Name>'));
  assert.equal(r.name, "Warm & bright");
  assert.deepEqual(r.layers.map((l) => l.id), ["levels", "curves", "balance", "hsl", "gray"]);
  const lv = r.layers[0].p;
  assert.equal(lv.ib, 8);
  assert.ok(lv.iw < 200 && lv.iw > 150, "brighter: white point moves in " + lv.iw);
  assert.deepEqual(r.layers[1].p, { s: 70, m: 128, h: 184 });
  assert.deepEqual(r.layers[2].p, { r: 6, g: 3, b: -6 });
  assert.deepEqual(r.layers[3].p, { h: 0, s: 5, l: 0 });
  assert.deepEqual(r.skipped, ["clarity"]);         // Sharpness 40 is Lightroom's default
  // every layer is a valid Photo Lab adjustment record as it is
  r.layers.forEach((l) => assert.deepEqual(PC.normAdj(l), l));
});

test("xmp: element form, point curve, Kelvin; nothing to do; not a preset", () => {
  const r = X.parse(xmp({ Temperature: "6400" }, "<crs:Exposure2012>-1</crs:Exposure2012><crs:ToneCurvePV2012><rdf:Seq><rdf:li>0, 20</rdf:li><rdf:li>128, 140</rdf:li><rdf:li>255, 255</rdf:li></rdf:Seq></crs:ToneCurvePV2012><crs:HueAdjustmentRed>+10</crs:HueAdjustmentRed>"));
  assert.deepEqual(r.layers.map((l) => l.id), ["levels", "curves", "balance"]);
  assert.ok(r.layers[0].p.ow < 255);
  assert.deepEqual(r.layers[1].p, { s: 80, m: 140, h: 198 });
  assert.ok(r.layers[2].p.r > 0 && r.layers[2].p.b < 0);
  assert.deepEqual(r.skipped, ["mixer"]);
  assert.deepEqual(X.parse(xmp({ Exposure2012: "0.00", Contrast2012: "0" })).layers, []);
  assert.throws(() => X.parse("<x:xmpmeta>photoshop:History</x:xmpmeta>"), /xmp/);
  assert.throws(() => X.parse(xmp({ Exposure2012: "1e9" }).repeat(1) + "x".repeat(3 * 1024 * 1024)), /xmp/);
  // values that aren't plain numbers are ignored
  assert.deepEqual(X.parse(xmp({ Exposure2012: "<script>" })).layers, []);
});
