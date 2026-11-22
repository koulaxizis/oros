// LY-PORT-C (2026-11-20): PDF/X-4 from Export, its colours in the print
// profile's CMYK when asked: text, lines, shapes and gradients through
// the profile's B2A1 table, greys and black in black ink alone.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "designkit/model.js"));
const P = require(path.join(ROOT, "designkit/pdf.js"));
const PRO = require(path.join(ROOT, "layout/pro.js"));
const X = require(path.join(ROOT, "designkit/pdfx.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const icc = fs.readFileSync(path.join(ROOT, "vendor/icc/ISOcoated_v2_eci.icc"));
const srgb = fs.readFileSync(path.join(ROOT, "vendor/icc/sRGB_IEC61966-2-1.icc"));
const pct = (a) => a.map((v) => Math.round(v * 100));

test("cmyk(): FOGRA39 values, greys in black ink alone", () => {
  const c = X.cmyk(icc);
  assert.deepEqual(pct(c.rgb(0, 0, 0)), [0, 0, 0, 100]);
  assert.deepEqual(pct(c.rgb(1, 1, 1)), [0, 0, 0, 0]);
  // the near-black a K-only text shows on screen is K-only again
  assert.deepEqual(pct(c.rgb(35 / 255, 31 / 255, 32 / 255)), [0, 0, 0, 100]);
  const grey = pct(c.rgb(0.5, 0.5, 0.5));
  assert.deepEqual(grey.slice(0, 3), [0, 0, 0]);
  assert.ok(grey[3] > 50 && grey[3] < 75, "50 % grey in K: " + grey[3]);
  const red = pct(c.rgb(1, 0, 0));
  assert.equal(red[0], 0); assert.ok(red[1] > 80 && red[2] > 90 && red[3] < 5, "red " + red);
  const blue = pct(c.rgb(0, 0, 1));
  assert.ok(blue[0] > 80 && blue[1] > 80 && blue[2] < 5, "blue " + blue);
  assert.equal(X.cmyk(srgb), null, "an RGB profile has no CMYK tables");
});

test("recolor(): only rg / RG, never inside strings or inline images", () => {
  const conv = (r, g, b) => [r, g, b, 0.5];
  const src = "q 0.2 0.4 0.6 rg BT (a 1 0 0 rg \\) 1 1 1 rg) Tj ET 1 0 0 RG <00ff> Tj 0 g\nBI /W 1 /H 1 ID 1 2 3 rg EI Q % 9 9 9 rg";
  const r = X.recolor(src, conv);
  assert.equal(r.n, 2);
  assert.equal(r.text, "q 0.2 0.4 0.6 0.5 k BT (a 1 0 0 rg \\) 1 1 1 rg) Tj ET 1 0 0 0.5 K <00ff> Tj 0 g\nBI /W 1 /H 1 ID 1 2 3 rg EI Q % 9 9 9 rg");
});

test("make(cmyk): a book's RGB box and gradient come out in CMYK; X-4 checks still pass", async () => {
  global.window = global.window || global;
  const { jsPDF } = require(path.join(ROOT, "vendor/jspdf.umd.min.js"));
  const PDFLib = require(path.join(ROOT, "vendor/pdf-lib/pdf-lib.min.js"));
  const BOOK = { title: "Στην καρδιά του βυθού", w: 180, h: 250, u: "mm", n: 2, facing: 1, side: "right", mm: 3, bt: -1, bb: -1, bi: -1, bo: -1, slug: 0, t: -1, b: -1, i: -1, o: -1, ncol: 1, gut: 5, grid: 0, color: "rgb", icc: "" };
  const d = PRO.makeDoc(BOOK, 10);
  const pg = M.pagesInOrder(d)[0];
  d.stories.push({ id: "st-a", m: 1, paras: [{ ps: d.pstyles[0].id, runs: [{ t: "Στην καρδιά του βυθού" }] }] });
  d.items.push({ id: "it-t", m: 1, t: "text", pg: pg.id, x: 40, y: 40, w: 300, h: 80, story: "st-a", z: 3 });
  d.swatches.push({ id: "sw-rb", m: 1, name: "Sea", mode: "rgb", v: [26, 111, 176] }, { id: "sw-rr", m: 1, name: "Red", mode: "rgb", v: [255, 0, 0] });
  d.items.push({ id: "it-r", m: 1, t: "rect", pg: pg.id, x: 0, y: 0, w: 50, h: 50, fill: "sw-rb", z: 1 });
  d.items.push({ id: "it-g", m: 1, t: "rect", pg: pg.id, x: 60, y: 200, w: 80, h: 40, gr: { k: "l", st: [[0, "sw-rr"], [1, "sw-rb"]] }, z: 2 });
  const bytes = new Uint8Array(P.build(M.normDoc(d), { bleed: true }, { jsPDF }).output("arraybuffer"));
  const plain = await X.make(PDFLib, bytes, { icc, srgb, now: Date.UTC(2026, 10, 20) });
  assert.equal(plain.cmyk, undefined, "without cmyk nothing changes");
  const r = await X.make(PDFLib, bytes, { icc, srgb, cmyk: true, now: Date.UTC(2026, 10, 20) });
  assert.deepEqual(r.problems, []);
  assert.ok(r.cmyk >= 1, "colours changed: " + r.cmyk);
  const out = await PDFLib.PDFDocument.load(r.bytes, { updateMetadata: false });
  const N = PDFLib.PDFName.of, ctx = out.context;
  let all = "";
  out.getPages().forEach((p) => {
    let c = p.node.get(N("Contents")); c = c instanceof PDFLib.PDFRef ? ctx.lookup(c) : c;
    const one = (s) => { s = s instanceof PDFLib.PDFRef ? ctx.lookup(s) : s; all += Buffer.from(PDFLib.decodePDFRawStream(s).decode()).toString("latin1") + "\n"; };
    if (c instanceof PDFLib.PDFArray) for (let i = 0; i < c.size(); i++) one(c.get(i)); else one(c);
  });
  assert.doesNotMatch(all, /\brg\b/, "no RGB fill left in the pages");
  assert.match(all, /\bk\b/);
  let rgbShading = 0, cmykShading = 0;
  ctx.enumerateIndirectObjects().forEach(([, o]) => {
    const dict = o && o.dict ? o.dict : o;
    if (!dict || typeof dict.get !== "function" || !dict.get(N("ShadingType"))) return;
    if (dict.get(N("ColorSpace")) === N("DeviceRGB")) rgbShading++;
    if (dict.get(N("ColorSpace")) === N("DeviceCMYK")) cmykShading++;
  });
  assert.equal(rgbShading, 0);
  assert.ok(cmykShading >= 1, "the gradient's shading is CMYK");
});

test("Export: PDF/X-4 with CMYK in the dialog, through LY_PDFOUT.pdfx; strings EN/EL/DE", () => {
  const pn = read("layout/panels.js");
  assert.match(pn, /\["print", t\("exp\.print"\)\], \["x4", t\("exp\.x4"\)\], (\["x1a", t\("exp\.x1a"\)\], )?\["screen", t\("exp\.screen"\)\]/);
  assert.match(pn, /pdfx: expPrefs\.q === "x4", (x1a: expPrefs\.q === "x1a", )?cmyk: expPrefs\.q === "x4" && !!expPrefs\.cmyk/);
  const io = read("layout/io.js");
  assert.match(io, /return r\[1\]\.pdfx\(doc, new Uint8Array\(r\[0\]\), \{ cmyk: !!opts\.cmyk(, x1a: x1a)? \}\);/);
  assert.match(read("layout/pdfout.js"), /window\.LY_PDFOUT = \{ run: run, norm: norm, pdfx: pdfx \};/);
  const L = read("layout/layout.js"), DE = read("i18n/de/layout.js");
  for (const k of ["exp.x4", "exp.cmyk", "exp.cmykHint", "exp.x4Bad"]) {
    assert.equal((L.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k);
    assert.match(DE, new RegExp('"' + k.replace(".", "\\.") + '":'), k);
  }
});
