// Layout pro (LY-PRO wave W1, Chris's spec v2 2026-11-18): names in
// reading order, the paths Layout may read, create (trim, bleed per
// side, first page left, presets), pages from pictures (1_A on a right
// page), full-page pictures that stop at the trim and their fill,
// bleed fill (mirror, stretch, smart), the read-back, the PDF boxes
// per side with marks, PDF/X-4 (OutputIntent, sRGB, XMP, no
// unembedded font left), export_pdf in the Assistant and the gate
// lists. The acceptance book ("Στην καρδιά του βυθού", 180×250 mm,
// 3 mm bleed) is the model for the numbers.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "designkit/model.js"));
const T = require(path.join(ROOT, "designkit/text.js"));
const P = require(path.join(ROOT, "designkit/pdf.js"));
const PRO = require(path.join(ROOT, "layout/pro.js"));
const BF = require(path.join(ROOT, "layout/bleedfill.js"));
const X = require(path.join(ROOT, "designkit/pdfx.js"));
const CMD = require(path.join(ROOT, "layout/commands.js"));
const C = require(path.join(ROOT, "assistant/core.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const MM = 72 / 25.4;
const near = (a, b, e) => Math.abs(a - b) <= (e || 0.05);

T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

function idf() { let n = 0; return (p) => p + "-t" + (++n); }
const BOOK = { title: "Στην καρδιά του βυθού", w: 180, h: 250, u: "mm", n: 1, facing: 1, side: "right", mm: 3, bt: -1, bb: -1, bi: -1, bo: -1, slug: 0, t: -1, b: -1, i: -1, o: -1, ncol: 1, gut: 5, grid: 0, color: "rgb", icc: "" };
function pics(n) {
  const names = [];
  for (let i = n; i >= 1; i--) names.push(i + "_" + (i % 2 ? "A" : "b") + ".jpg");
  return PRO.natSort(names).map((nm, i) => ({ a: (i.toString(16).padStart(2, "0")).repeat(32) + ".jpg", iw: 2126, ih: 2953, nm }));
}

test("pro: names in reading order, numbers as numbers", () => {
  assert.deepEqual(PRO.natSort(["10_a.jpg", "2_b.jpg", "1_A.jpg", "27.jpg", "1_b.jpg"]), ["1_A.jpg", "1_b.jpg", "2_b.jpg", "10_a.jpg", "27.jpg"]);
  assert.deepEqual(PRO.natSort(["Σελίδα 3.png", "σελίδα 12.png", "Σελίδα 1.png"]), ["Σελίδα 1.png", "Σελίδα 3.png", "σελίδα 12.png"]);
});

test("pro: Layout reads only pictures inside Claude's folders", () => {
  const F = ["/internal/Drive/PC/Βυθός"];
  assert.equal(PRO.pathOk("/internal/Drive/PC/Βυθός/1_A.jpg", F), "");
  assert.equal(PRO.pathOk("Drive › PC › Βυθός › 2_b.JPG", F), "");
  assert.match(PRO.pathOk("/internal/Drive/PC/Other/1.jpg", F), /Claude's folders/);
  assert.match(PRO.pathOk("/internal/Drive/PC/Βυθός/../Other/1.jpg", F), /not a path/);
  assert.match(PRO.pathOk("/internal/Drive/PC/Βυθός/.hidden/1.jpg", F), /not a path/);
  assert.match(PRO.pathOk("/internal/Drive/PC/Βυθός/id_rsa", F), /key/);
  assert.match(PRO.pathOk("/internal/Drive/PC/Βυθός/notes.txt", F), /not a picture/);
  assert.equal(PRO.pathOk("/internal/Drive/PC/Βυθός", F, true), "", "a folder");
});

test("pro: create makes the book's trim, bleed per side, first page left", () => {
  const d = PRO.makeDoc(BOOK, 10);
  assert.ok(near(d.setup.w, 180 * MM) && near(d.setup.h, 250 * MM));
  assert.equal(d.setup.preset, "bk180x250");
  assert.ok(near(d.setup.bleed, 3 * MM));
  assert.equal(d.name, BOOK.title);
  assert.equal(M.pagesInOrder(d).length, 1);
  const b = M.bleeds(d, "R");
  assert.ok(near(b.t, 3 * MM) && near(b.l, 3 * MM) && near(b.r, 3 * MM));
  // inner bleed 0 on a facing book: left page's right side, right page's left side
  const d2 = PRO.makeDoc(Object.assign({}, BOOK, { bi: 0, n: 4 }), 10);
  const r = M.bleeds(d2, "R"), l = M.bleeds(d2, "L");
  assert.ok(near(r.l, 0) && near(r.r, 3 * MM) && near(l.r, 0) && near(l.l, 3 * MM), JSON.stringify([r, l]));
  const d3 = PRO.makeDoc(Object.assign({}, BOOK, { side: "left", n: 3 }), 10);
  assert.equal(M.firstLeft(d3), true);
  assert.equal(M.sideOf(d3, 0), "L");
  assert.equal(M.spreads(d3)[0].length, 2, "a left first page opens a spread");
  const d4 = PRO.makeDoc(Object.assign({}, BOOK, { color: "cmyk", slug: 10 }), 10);
  assert.equal(d4.setup.ext.cm, "cmyk");
  assert.equal(d4.setup.ext.icc, "fogra39");
  assert.ok(near(M.slugOf(d4), 10 * MM));
});

test("pro: 28 pictures become 28 pages, 1_A on a right page, frames to the trim", () => {
  const d = PRO.makeDoc(BOOK, 10);
  const r = PRO.placePictures(d, pics(28), { fit: "trim", at: "end", side: "right" }, 20, idf());
  assert.equal(r.items.length, 28);
  assert.equal(r.blank, 0);
  assert.equal(r.first, 1);
  const order = M.pagesInOrder(d);
  assert.equal(order.length, 28, "the empty first page was used");
  assert.equal(M.sideOf(d, 0), "R");
  const first = d.items.filter((it) => it.pg === order[0].id)[0];
  assert.equal(first.nm, "1_A.jpg");
  assert.ok(near(first.x, 0) && near(first.w, d.setup.w));
  // every page picture stops at the trim: bleed fill's targets
  assert.equal(PRO.bleedTargets(d).length, 28);
  assert.equal(PRO.noBleed(d).length, 28);
  // with side "left" a blank page goes first: the empty page itself
  const e = PRO.makeDoc(BOOK, 10);
  const r2 = PRO.placePictures(e, pics(2), { fit: "trim", side: "left" }, 20, idf());
  assert.equal(r2.blank, 1);
  assert.equal(r2.first, 2);
  assert.equal(M.pagesInOrder(e).length, 3);
  assert.equal(M.sideOf(e, 1), "L");
});

test("pro: the fill grows the frame to the bleed and keeps the picture's scale", () => {
  const d = PRO.makeDoc(BOOK, 10);
  PRO.placePictures(d, pics(2), { fit: "trim" }, 20, idf());
  const it = PRO.bleedTargets(d)[0];
  const need = PRO.needPx(d, it);
  assert.ok(need.l > 0 && need.t > 0 && need.r > 0 && need.b > 0);
  // 2126 px over 180 mm → ~11.8 px/mm; 3 mm ≈ 36 px
  assert.ok(need.t >= 35 && need.t <= 38, String(need.t));
  const w0 = it.w;
  PRO.applyFill(d, it, { a: "c".repeat(64) + ".jpg", iw: 2126 + need.l + need.r, ih: 2953 + need.t + need.b, mode: "smart", need }, 30);
  assert.ok(near(it.w, w0 + 6 * MM, 0.01) && near(it.x, -3 * MM, 0.01));
  assert.equal(it.ext.bf.src, "00".repeat(32) + ".jpg", "the original is remembered");
  assert.equal(PRO.noBleed(d).length, 1, "the other page still stops at the trim");
});

test("bleedfill: mirror, stretch and smart keep the picture and fill the band", () => {
  const w = 40, h = 30, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; data[i] = x * 6; data[i + 1] = y * 8; data[i + 2] = (x * y) % 255; data[i + 3] = 255; }
  const src = { w, h, data }, need = { l: 5, t: 4, r: 6, b: 3 };
  BF.MODES.forEach((mode) => {
    const o = BF.extend(src, need, mode, 7);
    assert.equal(o.w, w + 11);
    assert.equal(o.h, h + 7);
    for (let y = 0; y < h; y += 7) for (let x = 0; x < w; x += 9) {
      const a = (y * w + x) * 4, b = ((y + 4) * o.w + x + 5) * 4;
      assert.deepEqual([...o.data.slice(b, b + 4)], [...data.slice(a, a + 4)], mode + ": the picture is unchanged");
    }
    for (let i = 3; i < o.data.length; i += 4) assert.equal(o.data[i], 255, mode + ": no hole");
  });
  const m = BF.extend(src, need, "mirror");
  // the first pixel left of the edge mirrors the edge pixel
  assert.equal(m.data[((4) * m.w + 4) * 4], data[0]);
  const s = BF.extend(src, need, "stretch");
  assert.equal(s.data[0], data[0], "the corner takes the corner pixel");
  const a = BF.extend(src, need, "smart", 3), b = BF.extend(src, need, "smart", 3);
  assert.deepEqual(a.data, b.data, "same seed, same pixels");
});

test("pdf: per-side boxes, marks and the book's trim and bleed boxes", () => {
  global.window = global.window || global;
  const { jsPDF } = require(path.join(ROOT, "vendor/jspdf.umd.min.js"));
  const d = PRO.makeDoc(Object.assign({}, BOOK, { n: 3 }), 10);
  const pdf = P.build(d, { bleed: true, marks: { crop: 1, bleed: 1, reg: 1, bars: 1, info: 1 } }, { jsPDF });
  assert.equal(pdf.getNumberOfPages(), 3);
  const b = pdf.orosBoxes[0];
  assert.ok(near((b.trim[2] - b.trim[0]) / MM, 180, 0.1) && near((b.trim[3] - b.trim[1]) / MM, 250, 0.1));
  assert.ok(near((b.bleed[2] - b.bleed[0]) / MM, 186, 0.1) && near((b.bleed[3] - b.bleed[1]) / MM, 256, 0.1));
  assert.ok(b.w > (b.bleed[2] - b.bleed[0]) + 10, "the slug holds the marks");
  // inner bleed 0: a left page's bleed box stops at the spine
  const d2 = PRO.makeDoc(Object.assign({}, BOOK, { bi: 0, n: 2 }), 10);
  const p2 = P.build(d2, { bleed: true }, { jsPDF });
  const L = p2.orosBoxes[1];
  assert.ok(near((L.bleed[2] - L.bleed[0]) / MM, 183, 0.1), "183 mm: outer bleed only");
  assert.ok(near(L.trim[2], L.bleed[2], 0.01), "no bleed on the spine side");
});

test("pdfx: PDF/X-4 with FOGRA39, sRGB, XMP and only embedded fonts", async () => {
  global.window = global.window || global;
  const { jsPDF } = require(path.join(ROOT, "vendor/jspdf.umd.min.js"));
  const PDFLib = require(path.join(ROOT, "vendor/pdf-lib/pdf-lib.min.js"));
  const d = PRO.makeDoc(Object.assign({}, BOOK, { n: 2 }), 10);
  // a coloured box and a text frame, so there is RGB and a font
  const pg = M.pagesInOrder(d)[0];
  d.stories.push({ id: "st-a", m: 1, paras: [{ ps: d.pstyles[0].id, runs: [{ t: "Στην καρδιά του βυθού" }] }] });
  d.items.push({ id: "it-t", m: 1, t: "text", pg: pg.id, x: 40, y: 40, w: 300, h: 80, story: "st-a", z: 2 });
  d.items.push({ id: "it-r", m: 1, t: "rect", pg: pg.id, x: 0, y: 0, w: 50, h: 50, fill: "#1a6fb0", z: 1 });
  const pdf = P.build(M.normDoc(d), { bleed: true, marks: { crop: 1 } }, { jsPDF });
  const bytes = new Uint8Array(pdf.output("arraybuffer"));
  assert.match(Buffer.from(bytes).toString("latin1"), /\/Helvetica/, "jsPDF lists its standard fonts");
  const icc = fs.readFileSync(path.join(ROOT, "vendor/icc/ISOcoated_v2_eci.icc"));
  const srgb = fs.readFileSync(path.join(ROOT, "vendor/icc/sRGB_IEC61966-2-1.icc"));
  const r = await X.make(PDFLib, bytes, { icc, srgb, title: "Στην καρδιά του βυθού", now: Date.UTC(2026, 10, 18) });
  assert.deepEqual(r.problems, []);
  assert.equal(r.intent, "Coated FOGRA39 (ISO 12647-2:2004)");
  const out = await PDFLib.PDFDocument.load(r.bytes, { updateMetadata: false });
  const N = PDFLib.PDFName.of, ctx = out.context;
  const oi = ctx.lookup(out.catalog.get(N("OutputIntents"))).get(0);
  const oid = ctx.lookup(oi);
  assert.equal(oid.get(N("S")).asString(), "/GTS_PDFX");
  assert.equal(oid.get(N("OutputConditionIdentifier")).asString(), "FOGRA39");
  const prof = ctx.lookup(oid.get(N("DestOutputProfile")));
  assert.equal(prof.dict.get(N("N")).asNumber(), 4);
  const info = ctx.lookup(ctx.trailerInfo.Info);
  assert.equal(info.get(N("GTS_PDFXVersion")).asString(), "PDF/X-4");
  assert.equal(info.get(N("Trapped")).asString(), "/False");
  assert.ok(ctx.trailerInfo.ID, "trailer ID");
  const meta = ctx.lookup(out.catalog.get(N("Metadata")));
  const xmp = Buffer.from(meta.getContents ? meta.getContents() : meta.contents).toString("utf8");
  assert.match(xmp, /<pdfxid:GTS_PDFXVersion>PDF\/X-4</);
  assert.match(xmp, /Στην καρδιά του βυθού/);
  const text = Buffer.from(r.bytes).toString("latin1");
  assert.doesNotMatch(text, /\/BaseFont \/Helvetica/, "no unembedded standard font is left");
  assert.match(text, /FontFile2/);
  out.getPages().forEach((p) => {
    const cs = p.node.Resources().get(N("ColorSpace"));
    const csd = cs instanceof PDFLib.PDFRef ? ctx.lookup(cs) : cs;
    assert.ok(csd.get(N("DefaultRGB")), "DefaultRGB on every page");
  });
  assert.ok(near((r.boxes[0].trim[2] - r.boxes[0].trim[0]) / MM, 180, 0.1));
  assert.ok(near((r.boxes[0].bleed[3] - r.boxes[0].bleed[1]) / MM, 256, 0.1));
  // a page without a TrimBox is reported
  const bare = new jsPDF({ unit: "pt", format: [100, 100] });
  const r2 = await X.make(PDFLib, new Uint8Array(bare.output("arraybuffer")), { icc, srgb });
  assert.deepEqual(r2.problems, [{ code: "noTrimBox", page: 1 }]);
  await assert.rejects(X.make(PDFLib, bytes, {}), /profiles/);
});

test("export_pdf: checked arguments, the report the model gets, the gate lists", () => {
  const a = C.normPdf({ document: "Στην καρδιά του βυθού" });
  assert.equal(a.ok, true);
  assert.equal(a.preset, "pdfx4");
  assert.deepEqual(a.marks, { crop: 1 });
  assert.equal(a.bleed, 1);
  assert.equal(C.normPdf({ document: "x", preset: "pdfa" }).ok, false);
  assert.equal(C.normPdf({ document: "x", pages: "1;drop" }).ok, false);
  assert.equal(C.normPdf({ document: "x", marks: ["crop", "x"] }).ok, false);
  assert.equal(C.normPdf({ document: "x", preset: "screen" }).bleed, 0);
  assert.equal(C.normPdf({}).ok, false);
  const rep = C.pdfReport({ ok: 1, doc: "Βυθός", preset: "pdfx4", path: "/internal/Layout/PDF/Βυθός (PDF-X-4).pdf", bytes: 5e6, pages: 40,
    trim: { w: 180, h: 250 }, bleedBox: { w: 186, h: 256 }, intent: "Coated FOGRA39 (ISO 12647-2:2004)", pdfx: "PDF/X-4",
    problems: [{ sev: "warn", code: "isbnEmpty", page: 0 }, { sev: "err", code: "<script>", id: "bad id" }] });
  assert.deepEqual(rep.trim_box, { w_mm: 180, h_mm: 250 });
  assert.deepEqual(rep.bleed_box, { w_mm: 186, h_mm: 256 });
  assert.equal(rep.preflight.errors, 1);
  assert.equal(rep.preflight.warnings, 1);
  assert.equal(rep.preflight.problems[0].code, "isbnEmpty");
  assert.equal(rep.preflight.problems[1].code, "other", "codes are checked");
  assert.equal(rep.preflight.problems[1].frame, undefined);
  assert.equal(C.pdfReport({ ok: 1, path: "/internal/Notes/x.pdf" }).path, "", "only Layout's PDF folder");
  assert.deepEqual(C.pdfReport({ failed: 1, why: "noDoc" }), { failed: true, why: "noDoc" });
  assert.ok(C.GATE_TOOLS.indexOf("export_pdf") !== -1);
  assert.ok(C.GATE_TOOLS.length <= 30, "the relay takes 30 tools");
  assert.match(read("gate/gate.js"), /"export_pdf"/);
});

test("pro: a create + folder + bleed fill + pictures request is valid as the model sends it", () => {
  const r = CMD.check([{ op: "create", title: "x", w: 180, h: 250, u: "mm", facing: 1, side: "right", mm: 3 },
    { op: "images", folder: "/internal/Drive/PC/Vythos", side: "right" }, { op: "bleedfill", mode: "smart" }, { op: "thumbs", pages: "1-3", dpi: 72 }]);
  assert.equal(r.ok, true, r.err);
  assert.deepEqual(r.steps[1].paths, []);
  assert.equal(r.steps[1].folder, "/internal/Drive/PC/Vythos");
  assert.equal(CMD.check([{ op: "images" }]).ok, false, "needs paths or folder");
  assert.equal(CMD.check([{ op: "images", paths: ["a.jpg"] }, { op: "create", w: 100, h: 100 }]).ok, false, "create first only");
});

test("pro: the read-back gives the setup, pages and frames in mm", () => {
  const d = PRO.makeDoc(BOOK, 10);
  PRO.placePictures(d, pics(3), { fit: "trim" }, 20, idf());
  const o = CMD.outline(d, null, { lastExport: { path: "/internal/Layout/PDF/x.pdf" } });
  assert.equal(o.name, BOOK.title);
  assert.deepEqual(o.trim_mm, { w: 180, h: 250 });
  assert.equal(o.pages, 3);
  assert.equal(o.page_list[0].side, "right");
  assert.equal(o.frames.length, 3);
  assert.equal(o.frames[0].file, "1_A.jpg");
  assert.equal(o.frames[0].w_mm, 180);
  assert.ok(o.frames[0].effective_ppi > 290 && o.frames[0].effective_ppi < 310, String(o.frames[0].effective_ppi));
  assert.equal(o.last_export.path, "/internal/Layout/PDF/x.pdf");
});

test("pro: the wiring in Layout and the precache", () => {
  const sw = read("sw.js");
  ["layout/pro.js", "layout/proassist.js", "layout/bleedfill.js", "layout/pdfout.js", "designkit/pdfx.js", "vendor/icc/ISOcoated_v2_eci.icc", "vendor/icc/sRGB_IEC61966-2-1.icc", "vendor/icc/LICENSES.md"]
    .forEach((f) => assert.ok(sw.indexOf('"' + f + '"') !== -1, f + " precached"));
  const lay = read("layout/layout.js");
  assert.match(lay, /tg\.pdfOut/);
  assert.match(lay, /"pdfout\.js", "LY_PDFOUT"/);
  assert.match(read("layout/pdfout.js"), /\/internal\/Layout\/PDF|PDF_DIR/);
  // the ICC licence must ship with the profile
  assert.match(read("vendor/icc/LICENSES.md"), /HEIDELBERG/);
  assert.match(read("CREDITS.md"), /ISOcoated_v2_eci\.icc/);
  assert.match(read("shell.js"), /cr\.icc-fogra39/);
  const crypto = require("crypto");
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, "vendor/icc/ISOcoated_v2_eci.icc"))).digest("hex"),
    "128dc02f7246cc3807af0323695379f64151a8f27a587736acc59f8b6ce894b8", "the profile is never changed");
});
