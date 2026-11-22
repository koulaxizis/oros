// Layout W9 (LY-W9): print colours. Soft proof and ink plates through
// the print profile (pdfx.js 1.2.0, layout/proof.js), overprint in the
// PDF and on screen, tints that follow their colour, the print checks
// in Preflight (ink limit, rich black, hairlines, text near the trim,
// white that overprints) and PDF/X-1a (all CMYK, pictures too, PDF
// 1.4, transparency reported); strings in EN/EL/DE and the wiring.
// Run: node --test tests/layout-w9.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const M = require(path.join(ROOT, "designkit/model.js"));
const X = require(path.join(ROOT, "designkit/pdfx.js"));
const PROOF = require(path.join(ROOT, "layout/proof.js"));
global.window = global.window || global;
const R = require(path.join(ROOT, "designkit/render.js"));
const PDFLib = require(path.join(ROOT, "vendor/pdf-lib/pdf-lib.min.js"));
const icc = fs.readFileSync(path.join(ROOT, "vendor/icc/ISOcoated_v2_eci.icc"));
const srgb = fs.readFileSync(path.join(ROOT, "vendor/icc/sRGB_IEC61966-2-1.icc"));
const MM = 72 / 25.4;
const b255 = (a) => a.map((v) => Math.round(v * 255));

test("pdfx: Lab back to sRGB, the profile's look of each ink, its name", () => {
  for (const c of [[0.2, 0.5, 0.8], [1, 1, 1], [0, 0, 0], [0.9, 0.1, 0.3]]) {
    const back = X.labSrgb(...X.srgbLab(...c));
    back.forEach((v, i) => assert.ok(Math.abs(v - c[i]) < 0.002, c + " → " + back));
  }
  const c = X.cmyk(icc);
  assert.deepEqual(b255(c.show(0, 0, 0, 0)), [255, 255, 255], "paper is white (relative colorimetric)");
  const cyan = b255(c.show(1, 0, 0, 0));
  assert.ok(cyan[0] < 30 && cyan[1] > 140 && cyan[1] < 180 && cyan[2] > 210, "FOGRA39 cyan " + cyan);
  const k = b255(c.show(0, 0, 0, 1));
  assert.ok(k[0] > 25 && k[0] < 60, "100 % K is not screen black: " + k);
  const red = b255(c.proof(1, 0, 0));
  assert.ok(red[0] > 200 && red[1] < 90 && red[2] < 70, "sRGB red, as it prints: " + red);
  assert.deepEqual(X.profileInfo(icc), { cls: "prtr", space: "CMYK", name: "ISO Coated v2 (ECI)" });
  assert.equal(X.profileInfo(srgb).cls, "mntr");
  assert.equal(X.profileInfo(new Uint8Array(40)), null);
});

test("pdfx.grid: the 3D table reads as the function it samples", () => {
  const c = X.cmyk(icc), at = X.grid((r, g, b) => c.rgb(r, g, b), 4, 33), o = [0, 0, 0, 0];
  let worst = 0;
  // colours away from the greys (there the profile's table gives way to black ink alone)
  for (const p of [[10, 200, 30], [250, 240, 10], [60, 70, 200], [200, 40, 90]]) {
    at(p[0], p[1], p[2], o);
    const d = c.rgb(p[0] / 255, p[1] / 255, p[2] / 255);
    d.forEach((v, i) => { worst = Math.max(worst, Math.abs(v - o[i])); });
  }
  assert.ok(worst < 0.04, "worst ink difference " + worst);
  const un = X.unpredict(Uint8Array.from([0, 1, 2, 3, 2, 1, 1, 1]), 3, 3);
  assert.deepEqual(Array.from(un), [1, 2, 3, 2, 3, 4], "PNG Up / Sub filters undone");
});

test("recolor: overprint states switch only when needed and follow q / Q", () => {
  const op = PROOF.opFn([[0, 0, 0, 1]]);
  const r = X.recolor("q 0 0 0 1 k BT (Αα) Tj ET Q 0 g 0 0 0 1 k 1 0 0 0 k 0 0 0 1 K 0.2 0.2 0.2 rg", null, op);
  assert.equal(r.text, "q /OP01 gs 0 0 0 1 k BT (Αα) Tj ET Q /OP01 gs 0 g 0 0 0 1 k /OP00 gs 1 0 0 0 k /OP10 gs 0 0 0 1 K 0.2 0.2 0.2 rg");
  assert.equal(r.ops, 4);
  assert.equal(r.n, 0, "no conversion asked");
  const c = X.cmyk(icc), r2 = X.recolor("0 0 0 rg 1 0 0 rg", (a, b, d) => c.rgb(a, b, d), op);
  assert.match(r2.text, /^\/OP01 gs 0 0 0 1 k \/OP00 gs [\d.]+ [\d.]+ [\d.]+ [\d.]+ k$/, "converted black overprints, red does not: " + r2.text);
});

// a page with an RGB image (Flate, PNG predictor), a JPEG and a 50 % opacity
async function sample() {
  const P = PDFLib, doc = await P.PDFDocument.create(), ctx = doc.context, N = P.PDFName.of;
  const page = doc.addPage([200, 200]);
  page.node.set(N("TrimBox"), ctx.obj([0, 0, 200, 200]));
  const px = Uint8Array.from([255, 0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0]);   // 2×2: red, blue, white, black
  const rows = new Uint8Array(2 * 7);
  rows.set([0, ...px.slice(0, 6)], 0); rows.set([0, ...px.slice(6)], 7);
  const flate = ctx.register(ctx.flateStream(rows, { Type: "XObject", Subtype: "Image", Width: 2, Height: 2, ColorSpace: "DeviceRGB", BitsPerComponent: 8, DecodeParms: { Predictor: 15, Colors: 3, Columns: 2 } }));
  const jpeg = ctx.register(ctx.stream(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), { Type: "XObject", Subtype: "Image", Width: 1, Height: 1, ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "DCTDecode" }));
  const gs = ctx.register(ctx.obj({ Type: "ExtGState", ca: 0.5 }));
  page.node.set(N("Resources"), ctx.obj({ XObject: { Im1: flate, Im2: jpeg }, ExtGState: { G1: gs } }));
  page.node.set(N("Contents"), ctx.register(ctx.flateStream(Buffer.from("q 0 0 0 rg 0 0 10 10 re f Q q 1 0 0 rg 20 20 10 10 re f Q q /G1 gs 100 0 0 100 0 0 cm /Im1 Do Q q 10 0 0 10 50 50 cm /Im2 Do Q", "latin1"))));
  return doc.save({ useObjectStreams: false });
}

test("make(x1a): PDF/X-1a:2003, every picture in CMYK, black overprints, transparency reported", async () => {
  const bytes = await sample();
  const decoded = [];
  const r = await X.make(PDFLib, bytes, {
    icc, x1a: true, now: Date.UTC(2026, 10, 22), overprint: PROOF.opFn([[0, 0, 0, 1]]),
    decode: (b, kind) => { decoded.push(kind); return Promise.resolve({ w: 1, h: 1, data: Uint8Array.from([0, 128, 0, 255]) }); }
  });
  assert.equal(r.pdfx, "PDF/X-1a:2003");
  assert.equal(r.pictures, 2);
  assert.deepEqual(decoded, ["jpeg"]);
  assert.deepEqual(r.problems.map((p) => p.code), ["transparency"], "the 50 % opacity is reported, not hidden");
  assert.equal(Buffer.from(r.bytes.slice(0, 8)).toString("latin1"), "%PDF-1.4");
  const out = await PDFLib.PDFDocument.load(r.bytes, { updateMetadata: false }), ctx = out.context, N = PDFLib.PDFName.of;
  let cmykPics = 0, rgbPics = 0, iccBased = 0, pix = null;
  ctx.enumerateIndirectObjects().forEach(([, o]) => {
    const d = o && o.dict;
    if (!d || d.get(N("Subtype")) !== N("Image")) return;
    if (d.get(N("ColorSpace")) === N("DeviceCMYK")) cmykPics++; else rgbPics++;
    if (d.get(N("Width")).asNumber() === 2) pix = PDFLib.decodePDFRawStream(o).decode();
  });
  ctx.enumerateIndirectObjects().forEach(([, o]) => { if (o instanceof PDFLib.PDFArray && o.get(0) === N("ICCBased")) iccBased++; });
  assert.equal(cmykPics, 2); assert.equal(rgbPics, 0); assert.equal(iccBased, 0, "no sRGB profile in an X-1a");
  assert.equal(pix.length, 16, "2×2 pixels, four inks each");
  assert.deepEqual(Array.from(pix.slice(8, 12)), [0, 0, 0, 0], "white is no ink");
  assert.deepEqual(Array.from(pix.slice(12, 16)), [0, 0, 0, 255], "black is black ink alone");
  assert.ok(pix[1] > 200 && pix[2] > 200 && pix[0] < 20, "red is magenta + yellow: " + Array.from(pix.slice(0, 4)));
  const pg = out.getPages()[0], text = Buffer.from(PDFLib.decodePDFRawStream(ctx.lookup(pg.node.get(N("Contents")))).decode()).toString("latin1");
  assert.match(text, /\/OP01 gs 0 0 0 1 k/);
  assert.doesNotMatch(text, /\brg\b/);
  const egs = pg.node.Resources().get(N("ExtGState"));
  const op01 = ctx.lookup((egs instanceof PDFLib.PDFRef ? ctx.lookup(egs) : egs).get(N("OP01")));
  assert.equal(op01.get(N("op")), PDFLib.PDFBool.True);
  assert.equal(op01.get(N("OPM")).asNumber(), 1);
  const info = ctx.lookup(ctx.trailerInfo.Info);
  assert.equal(info.get(N("GTS_PDFXVersion")).decodeText(), "PDF/X-1a:2003");
  const meta = Buffer.from(ctx.lookup(out.catalog.get(N("Metadata"))).getContents()).toString("utf8");
  assert.match(meta, /<pdfxid:GTS_PDFXVersion>PDF\/X-1a:2003</);
  // the same PDF as X-4 keeps sRGB pictures and stays 1.7
  const x4 = await X.make(PDFLib, bytes, { icc, srgb, now: Date.UTC(2026, 10, 22) });
  assert.equal(x4.pdfx, "PDF/X-4");
  assert.notEqual(Buffer.from(x4.bytes.slice(0, 8)).toString("latin1"), "%PDF-1.4");
  // an own profile names its condition
  const own = await X.make(PDFLib, bytes, { icc, x1a: true, cond: { id: "Custom", info: "My press", registry: "" }, decode: () => Promise.resolve(null) });
  assert.ok(own.problems.some((p) => p.code === "x1aImage"), "a picture that cannot be read is reported");
});

function doc() {
  const d = M.newDoc({ name: "W9", w: 140 * MM, h: 210 * MM, pages: 1, facing: 0 }, 1);
  Object.assign(d.setup, { mt: 15 * MM, mb: 15 * MM, mi: 15 * MM, mo: 15 * MM, bleed: 3 * MM });
  return { d, pg: M.pagesInOrder(d)[0] };
}
function text(d, pg, id, x, y, w, h, color, size) {
  d.cstyles.push({ id: "cs-" + id.slice(3), m: 1, name: id, color, size });
  d.stories.push({ id: "st-" + id.slice(3), m: 1, paras: [{ ps: "ps-body", runs: [{ t: "Λιμάνι και θάλασσα", cs: "cs-" + id.slice(3) }] }] });
  d.items.push({ id, m: 1, t: "text", pg: pg.id, x, y, w, h, story: "st-" + id.slice(3), z: 2 });
}

test("preflight: ink limit, rich black, hairlines, text near the trim, white that overprints", () => {
  const { d, pg } = doc();
  d.swatches.push({ id: "sw-four", m: 1, name: "Four", mode: "cmyk", v: [100, 100, 100, 100] });
  d.swatches.push({ id: "sw-rich", m: 1, name: "Rich", mode: "cmyk", v: [60, 40, 40, 100] });
  d.swatches.push({ id: "sw-opw", m: 1, name: "White", mode: "cmyk", v: [0, 0, 0, 0], ext: { op: 1 } });
  d.swatches.push({ id: "sw-deep", m: 1, name: "Deep", mode: "rgb", v: [20, 10, 60] });
  d.items.push({ id: "it-r1", m: 1, t: "rect", pg: pg.id, x: 50, y: 50, w: 40, h: 40, fill: "sw-four", z: 1 });
  d.items.push({ id: "it-l1", m: 1, t: "line", pg: pg.id, x: 50, y: 120, w: 100, h: 0, stroke: "sw-black", sw: 0.1, z: 1 });
  d.items.push({ id: "it-r2", m: 1, t: "rect", pg: pg.id, x: 100, y: 200, w: 40, h: 40, fill: "sw-opw", z: 1 });
  d.items.push({ id: "it-r3", m: 1, t: "rect", pg: pg.id, x: 150, y: 200, w: 40, h: 40, fill: "sw-deep", z: 1 });
  text(d, pg, "it-t1", 60, 300, 200, 40, "sw-rich", 8);           // small rich black, well inside
  text(d, pg, "it-t2", 2, 400, 200, 40, "sw-black", 10);          // 2 pt from the trim
  text(d, pg, "it-t3", 15 * MM, 450, 200, 40, "sw-black", 10);    // inside the margins: fine
  const ND = M.normDoc(d), L = R.computeLayout(ND);
  const codes = (list) => list.map((p) => p.code + ":" + p.id).sort();
  const pf = R.preflight(ND, L, {});
  for (const c of ["ink:it-r1", "hair:it-l1", "opWhite:it-r2", "richBlack:it-t1", "safe:it-t2"]) assert.ok(codes(pf).includes(c), c + " in " + codes(pf));
  assert.ok(!codes(pf).some((c) => /:it-t3$/.test(c)), "text inside the margins passes");
  assert.ok(!codes(pf).includes("ink:it-r3"), "an RGB colour without a profile is not guessed");
  const ink = pf.find((p) => p.code === "ink");
  assert.equal(ink.n, 400); assert.equal(ink.m, 300);
  assert.equal(pf.find((p) => p.code === "safe").n, 3);
  assert.equal(pf.find((p) => p.code === "opWhite").sev, "err");
  // through the profile, a deep RGB blue is over a 260 % limit
  ND.setup.ext = ND.setup.ext || {};
  ND.setup.ext.pf = PROOF.normPf({ ink: 260, safeMm: 0 });
  const pf2 = R.preflight(ND, L, { conv: X.cmyk(icc) });
  assert.ok(codes(pf2).includes("ink:it-r3"), codes(pf2).join(" "));
  assert.ok(!codes(pf2).includes("safe:it-t2"), "no safe distance asked");
});

test("print settings, overprint list and the views", () => {
  assert.deepEqual(PROOF.normPf({ ink: 999, safeMm: "x", bop: true }), { ink: 300, safe: 8.5 });
  assert.deepEqual(PROOF.normPf({ ink: 260, safeMm: 5, bop: false }), { ink: 260, safe: 14.17, bop: 0 });
  const { d } = doc();
  d.setup.ext = d.setup.ext || {};
  d.swatches.push({ id: "sw-sp", m: 1, name: "Spot-like", mode: "cmyk", v: [0, 50, 100, 0], ext: { op: 1 } });
  assert.deepEqual(PROOF.opList(d, R), [[0, 0, 0, 1], [0, 0.5, 1, 0]]);
  assert.ok(R.overprints(d, M.find(d.swatches, "sw-black")), "100 % black overprints");
  d.setup.ext.pf = { bop: 0 };
  assert.ok(!R.overprints(d, M.find(d.swatches, "sw-black")));
  assert.deepEqual(PROOF.opList(d, R), [[0, 0.5, 1, 0]]);
  const conv = X.cmyk(icc);
  assert.equal(PROOF.viewFor("", conv, d, R), null);
  assert.equal(PROOF.viewFor("proof", null, d, R), null, "no view before the profile is in");
  const plate = (m, c) => PROOF.viewFor(m, conv, d, R, X.grid).color(c);
  assert.deepEqual(plate("c", { rgb: [0, 0, 0], cmyk: [100, 0, 0, 0] }), [0, 0, 0], "the cyan plate is dark where cyan prints");
  assert.deepEqual(plate("m", { rgb: [0, 0, 0], cmyk: [100, 0, 0, 0] }), [255, 255, 255]);
  assert.deepEqual(plate("k", { rgb: [0, 0, 0], cmyk: null }), [0, 0, 0], "RGB black is black ink alone");
  assert.deepEqual(plate("ink", { rgb: [0, 0, 0], cmyk: [100, 100, 100, 100] }), [255, 0, 170], "over the limit in pink");
  const fine = plate("ink", { rgb: [0, 0, 0], cmyk: [0, 0, 0, 100] });
  assert.equal(fine[0], fine[1]);
  const pr = plate("proof", { rgb: [0, 0, 0], cmyk: [0, 0, 0, 100] });
  assert.ok(pr[0] > 25, "proof of K: " + pr);
});

test("tints follow their colour; the swatch dialog keeps them in step", () => {
  const { d } = doc();
  d.swatches.push({ id: "sw-sea", m: 1, name: "Sea", mode: "cmyk", v: [80, 20, 0, 10] });
  d.swatches.push({ id: "sw-sea40", m: 1, name: "Sea 40", mode: "cmyk", v: [1, 1, 1, 1], ext: { tp: "sw-sea", tt: 40 } });
  d.swatches.push({ id: "sw-web", m: 1, name: "Web", mode: "rgb", v: [0, 100, 200] });
  d.swatches.push({ id: "sw-web50", m: 1, name: "Web 50", mode: "rgb", v: [0, 0, 0], ext: { tp: "sw-web", tt: 50 } });
  const ND = M.normDoc(d);
  assert.deepEqual(M.swatchColor(ND, "sw-sea40").cmyk, [32, 8, 0, 4]);
  assert.deepEqual(M.swatchColor(ND, "sw-web50").rgb, [128, 178, 228]);
  M.find(ND.swatches, "sw-sea").v = [100, 0, 0, 0];
  assert.deepEqual(M.swatchColor(ND, "sw-sea40").cmyk, [40, 0, 0, 0], "the tint follows");
  // a tint of a tint is not followed (one level only)
  ND.swatches.push({ id: "sw-t2", m: 1, name: "T2", mode: "cmyk", v: [5, 5, 5, 5], ext: { tp: "sw-sea40", tt: 50 } });
  assert.deepEqual(M.swatchColor(ND, "sw-t2").cmyk, [5, 5, 5, 5]);
  const pn = read("layout/panels.js");
  assert.match(pn, /\/\/ its tints follow it\n\s+d2\.swatches\.forEach/);
  assert.match(pn, /\/\/ its tints keep their last values, on their own/);
  assert.match(pn, /check\(t\("colors\.op"\)/);
});

test("render: a print view stands between swatches and screen, overprint multiplies", () => {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (o, k) => (k in o ? o[k] : typeof k === "string" && /^(save|restore|beginPath|rect|fill|stroke|moveTo|lineTo|closePath|translate|rotate|setLineDash|fillText|fillRect|ellipse|arcTo|clip|drawImage|bezierCurveTo|createLinearGradient|createRadialGradient)$/.test(k) ? () => {} : undefined),
    set: (o, k, v) => { o[k] = v; if (k === "fillStyle" || k === "globalCompositeOperation") calls.push(k + "=" + v); return true; }
  });
  const { d, pg } = doc();
  d.items.push({ id: "it-r1", m: 1, t: "rect", pg: pg.id, x: 0, y: 0, w: 10, h: 10, fill: "sw-black", z: 1 });
  const ND = M.normDoc(d), L = R.computeLayout(ND);
  R.setView({ color: () => [1, 2, 3], op: (sw) => sw && sw.id === "sw-black" });
  R.drawPage(ctx, ND, M.pagesInOrder(ND)[0], L, {});
  R.setView(null);
  assert.ok(calls.includes("globalCompositeOperation=multiply"), calls.join(" "));
  assert.ok(calls.includes("fillStyle=rgba(1,2,3,1)"));
  calls.length = 0;
  R.drawPage(ctx, ND, M.pagesInOrder(ND)[0], L, {});
  assert.ok(!calls.some((c) => /multiply|1,2,3/.test(c)), "no view, no change");
  const ed = read("layout/editor.js");
  assert.match(ed, /R\.setView\(LY\.proof && LY\.proof\.view \? LY\.proof\.view\(\) : null\);/);
  assert.match(ed, /R\.setView\(null\);\n\s+ctx\.setTransform\(dpr, 0, 0, dpr, 0, 0\);\n\s+drawOverlay\(\);/, "guides, selection and rulers stay in their own colours");
});

test("wiring, strings EN/EL/DE, help", () => {
  const html = read("layout/index.html"), sw = read("sw.js");
  assert.match(html, /<script src="proof\.js\?v=[\d.]+"><\/script>/);
  assert.match(sw, /"layout\/proof\.js"/);
  assert.match(read("layout/panels.js"), /\["x1a", t\("exp\.x1a"\)\]/);
  assert.match(read("layout/pdfout.js"), /if \(x1a\) opt\.decode = decodeJpeg;/);
  assert.match(read("layout/io.js"), /cropImage\(it, opts\.ppi \|\| 300, !!opts\.x1a\)/);
  const L = read("layout/layout.js"), DE = read("i18n/de/layout.js");
  const keys = ["pf.ink", "pf.richBlack", "pf.hair", "pf.safe", "pf.opWhite", "more.print", "pc.title", "pc.view", "pc.v.off", "pc.v.proof", "pc.v.c", "pc.v.m", "pc.v.y", "pc.v.k", "pc.v.ink", "pc.viewHint", "pc.off", "pc.profile", "pc.own", "pc.ownBtn", "pc.builtIn", "pc.profileHint", "pc.badProfile", "pc.noFiles", "pc.profileSet", "pc.noProfile", "pc.ink", "pc.safe", "pc.bop", "pc.hint", "exp.x1a", "exp.x1aHint", "exp.x1aBad", "colors.tintOf", "colors.tintNone", "colors.tint", "colors.op", "colors.opShort", "colors.opHint"];
  for (const k of keys) {
    const re = new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g");
    assert.equal((L.match(re) || []).length, 2, k + " EN + EL");
    assert.equal((DE.match(re) || []).length, 1, k + " DE");
  }
  assert.match(read("layout/help.en.txt"), /## Print colours\n/);
  assert.match(read("layout/help.el.txt"), /## Χρώματα εκτύπωσης\n/);
  assert.match(read("i18n/de/help/layout.txt"), /## Druckfarben\n/);
});
