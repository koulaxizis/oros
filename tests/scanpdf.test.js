// orOS Scanner & PDF (scanpdf/): recognising files (name, first bytes,
// EXIF orientation), the page list edits (move, drag target, rotate,
// delete, duplicate, undo/redo), page ranges and split plans, picture
// page sizes, names, prefs and deep-link targets; real PDFs written by
// pdfops.js with the vendored pdf-lib (merge, order, rotation, copies,
// pictures, split parts, locked and broken files); wave 2: where an
// addition sits on a turned page (editor ↔ PDF), page numbers,
// watermark, Greek text through fontkit + Noto, compress output, the
// signature library and ink from a photo; the page wiring (DL-1,
// palette, R33, every t() key exists).
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const C = require(path.join(ROOT, "scanpdf/core.js"));
const OPS = require(path.join(ROOT, "scanpdf/pdfops.js"));
const L = require(path.join(ROOT, "vendor/pdf-lib/pdf-lib.min.js"));
const fontkit = require(path.join(ROOT, "vendor/pdf-lib/fontkit.umd.min.js"));
const FONT = { fontkit, bytes: new Uint8Array(fs.readFileSync(path.join(ROOT, "vendor/noto/NotoSans-Regular.ttf"))) };
const fixture = (f) => new Uint8Array(fs.readFileSync(path.join(ROOT, "tests/fixtures/scanpdf", f)));

function keys() { let k = 0; return () => "k" + (k++); }
const order = (pages) => pages.map((p) => p.src + ":" + p.idx);

// A PDF of n pages, each w × h with "<tag> <n>" on it.
async function pdf(n, tag, w = 300, h = 400, opts = {}) {
  const d = await L.PDFDocument.create();
  for (let i = 0; i < n; i++) d.addPage([w, h]).drawText(tag + " " + (i + 1), { x: 20, y: 200, size: 18 });
  return d.save(opts);
}
// A w × h RGBA PNG (with some see-through pixels when alpha).
function png(w, h, alpha) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4);
    len.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 4 + 1) + 1 + x * 4;
    raw[o] = 20; raw[o + 1] = 120; raw[o + 2] = 200; raw[o + 3] = alpha && x === 0 ? 0 : 255;
  }
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
async function textOf(bytes) {
  // The drawn text sits in content streams (FlateDecode by default): good
  // enough to find "<tag> <n>" in page order is the page's /Contents.
  const d = await L.PDFDocument.load(bytes);
  return d.getPages().map((p) => {
    const c = p.node.Contents();
    const s = d.context.lookup(c);
    const arr = s instanceof L.PDFArray ? s.asArray().map((r) => d.context.lookup(r)) : [s];
    return arr.map((st) => {
      const raw = st.getContents ? st.getContents() : st.contents;
      let b = Buffer.from(raw);
      try { b = zlib.inflateSync(b); } catch (e) { /* not compressed */ }
      return b.toString("latin1");
    }).join("");
  });
}
// drawText writes hex strings: "<tag> <n>" → <...> in the stream
const hex = (s) => "<" + Buffer.from(s, "latin1").toString("hex").toUpperCase() + ">";

// ---------- core: files ----------

test("kindOf: PDFs and pictures by extension or type, nothing else", () => {
  assert.equal(C.kindOf("a.PDF"), "pdf");
  assert.equal(C.kindOf("x", "application/pdf"), "pdf");
  ["a.jpg", "a.jpeg", "a.png", "a.webp", "a.gif", "a.bmp", "a.avif"].forEach((n) => assert.equal(C.kindOf(n), "image", n));
  assert.equal(C.kindOf("photo", "image/png"), "image");
  assert.equal(C.kindOf("a.heic"), null);
  assert.equal(C.kindOf("a.svg", "image/svg+xml"), null);
  assert.equal(C.kindOf("a.docx"), null);
});

test("sniff: first bytes, %PDF- after a little junk", () => {
  assert.equal(C.sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "jpeg");
  assert.equal(C.sniff(png(1, 1)), "png");
  assert.equal(C.sniff(new TextEncoder().encode("%PDF-1.7\n")), "pdf");
  assert.equal(C.sniff(new TextEncoder().encode("\r\n  junk%PDF-1.4")), "pdf");
  assert.equal(C.sniff(new TextEncoder().encode("PK\x03\x04 not a pdf")), "other");
  assert.equal(C.sniff(new Uint8Array(2)), "other");
});

test("exifOrientation: big- and little-endian EXIF, none, broken", () => {
  assert.equal(C.exifOrientation(fixture("exif6.jpg")), 6);
  assert.equal(C.exifOrientation(fixture("plain.jpg")), 1);
  // FFD8, APP1 "Exif\0\0" + "II*\0" little-endian TIFF, one entry 0x0112 = 3
  const le = [0xff, 0xd8, 0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 0x2a, 0, 8, 0, 0, 0,
    1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9];
  assert.equal(C.exifOrientation(new Uint8Array(le)), 3);
  assert.equal(C.exifOrientation(new Uint8Array(le.slice(0, 18))), 1);   // cut short
  assert.equal(C.exifOrientation(png(1, 1)), 1);
  assert.equal(C.exifOrientation(null), 1);
});

test("names: clean, base, output parts, unique, .pdf added once", () => {
  assert.equal(C.cleanName('  a/b:c*?"<>|\u0007.pdf '), "a-b-c------.pdf");
  assert.equal(C.cleanName("...hidden"), "hidden");
  assert.equal(C.baseName("Report.final.pdf"), "Report.final");
  assert.equal(C.outName("Report", "3-5"), "Report (3-5).pdf");
  assert.equal(C.outName("", ""), "Document.pdf");
  assert.equal(C.withPdf("Notes"), "Notes.pdf");
  assert.equal(C.withPdf("Notes.PDF"), "Notes.pdf");
  assert.equal(C.withPdf("  "), "Document.pdf");
  const taken = {};
  assert.deepEqual(["A.pdf", "a.pdf", "A.pdf"].map((n) => C.uniqueName(n, taken)), ["A.pdf", "a (2).pdf", "A (3).pdf"]);
  assert.equal(C.diskDir(), "/internal/PDF");
  assert.equal(C.zipName("Report"), "Report.zip");
  assert.equal(C.sizeLabel(1536, "el"), "1,5 KB");
  assert.equal(C.sizeLabel(3 * 1024 * 1024, "en"), "3.0 MB");
});

test("prefs: defaults and unknown values", () => {
  assert.deepEqual(C.readPrefs(null), { size: "a4", orient: "auto", margin: "small", dest: "device", cmp: "off", ocr: "ell+eng", read: "auto" });
  assert.deepEqual(C.readPrefs({ size: "fit", orient: "landscape", margin: "none", dest: "files", cmp: "medium", ocr: "eng", read: "on", x: 1 }),
    { size: "fit", orient: "landscape", margin: "none", dest: "files", cmp: "medium", ocr: "eng", read: "on" });
  assert.deepEqual(C.readPrefs({ size: "a3", orient: 9, margin: "<b>", dest: "cloud", cmp: "max", ocr: "fra", read: 1 }), C.readPrefs(null));
});

// ---------- core: picture pages ----------

test("pageFor / fitRect: A4 and Letter follow the picture or the choice; the picture's shape", () => {
  assert.deepEqual(C.pageFor(3000, 4000, { size: "a4" }), [595.28, 841.89]);
  assert.deepEqual(C.pageFor(4000, 3000, { size: "a4" }), [841.89, 595.28]);
  assert.deepEqual(C.pageFor(4000, 3000, { size: "a4", orient: "portrait" }), [595.28, 841.89]);
  assert.deepEqual(C.pageFor(300, 400, { size: "letter", orient: "landscape" }), [792, 612]);
  const fit = C.pageFor(2000, 1000, { size: "fit", margin: "none" });
  assert.deepEqual(fit, [841.89, 420.95]);
  const fitM = C.pageFor(1000, 1000, { size: "fit", margin: "normal" });
  assert.deepEqual(fitM, [841.89, 841.89]);
  const r = C.fitRect(1000, 500, 595.28, 841.89, "small");
  assert.equal(r.w, 559.28);
  assert.equal(r.x, 18);
  assert.ok(Math.abs(r.y - (841.89 - r.h) / 2) < 0.01);
  const n = C.fitRect(100, 100, 200, 400, "none");
  assert.deepEqual(n, { x: 0, y: 100, w: 200, h: 200 });
});

// ---------- core: page list ----------

test("page list: moveStep keeps a block together; edges stay put", () => {
  const mk = keys();
  const p = C.pagesOf("a", 5, mk);       // k0..k4
  assert.deepEqual(C.moveStep(p, ["k2", "k3"], -1).map((x) => x.key), ["k0", "k2", "k3", "k1", "k4"]);
  assert.deepEqual(C.moveStep(p, ["k0", "k3"], -1).map((x) => x.key), ["k0", "k1", "k3", "k2", "k4"]);
  assert.deepEqual(C.moveStep(p, ["k1", "k4"], 1).map((x) => x.key), ["k0", "k2", "k1", "k3", "k4"]);
  assert.deepEqual(C.moveStep(p, [], 1).map((x) => x.key), ["k0", "k1", "k2", "k3", "k4"]);
  assert.notEqual(C.moveStep(p, ["k1"], 1)[0], p[0], "a new list, not the old objects");
});

test("page list: moveTo (drag target) before the page at an index of the old list", () => {
  const p = C.pagesOf("a", 5, keys());
  assert.deepEqual(C.moveTo(p, ["k4"], 0).map((x) => x.key), ["k4", "k0", "k1", "k2", "k3"]);
  assert.deepEqual(C.moveTo(p, ["k0"], 5).map((x) => x.key), ["k1", "k2", "k3", "k4", "k0"]);
  assert.deepEqual(C.moveTo(p, ["k0"], 3).map((x) => x.key), ["k1", "k2", "k0", "k3", "k4"]);
  assert.deepEqual(C.moveTo(p, ["k1", "k3"], 5).map((x) => x.key), ["k0", "k2", "k4", "k1", "k3"]);
  assert.deepEqual(C.moveTo(p, ["k2"], 2).map((x) => x.key), ["k0", "k1", "k2", "k3", "k4"]);
  assert.deepEqual(C.moveTo(p, ["nope"], 0).map((x) => x.key), ["k0", "k1", "k2", "k3", "k4"]);
});

test("page list: rotate, remove, duplicate, sources in use", () => {
  const mk = keys();
  let p = C.pagesOf("a", 3, mk).concat(C.pagesOf("b", 2, mk));
  p = C.rotate(p, ["k0", "k3"], 90);
  p = C.rotate(p, ["k0"], 90);
  p = C.rotate(p, ["k3"], -90);
  assert.deepEqual(p.map((x) => x.rot), [180, 0, 0, 0, 0]);
  assert.deepEqual(C.rotate(p, ["k1"], -90)[1].rot, 270);
  assert.equal(C.normRot(-450), 270);
  const d = C.duplicate(p, ["k0", "k4"], mk);
  assert.deepEqual(order(d), ["a:0", "a:0", "a:1", "a:2", "b:0", "b:1", "b:1"]);
  assert.equal(d[1].rot, 180);
  assert.notEqual(d[1].key, d[0].key);
  const r = C.remove(p, ["k3", "k4"]);
  assert.deepEqual(order(r), ["a:0", "a:1", "a:2"]);
  assert.deepEqual(Object.keys(C.usedSources(r)), ["a"]);
});

test("undo / redo: steps back and forward, a new edit clears redo, capped", () => {
  const h = C.history();
  let p = C.pagesOf("a", 3, keys());
  C.record(h, p); p = C.remove(p, ["k0"]);
  C.record(h, p); p = C.rotate(p, ["k1"], 90);
  p = C.undo(h, p); assert.equal(p.length, 2); assert.equal(p[0].rot, 0);
  p = C.undo(h, p); assert.equal(p.length, 3);
  assert.equal(C.undo(h, p), null);
  p = C.redo(h, p); assert.equal(p.length, 2);
  C.record(h, p); p = C.remove(p, ["k1"]);
  assert.equal(C.redo(h, p), null, "a new edit drops what could be redone");
  for (let i = 0; i < 100; i++) C.record(h, p);
  assert.ok(h.past.length <= 60);
});

// ---------- core: ranges and split ----------

test("parseRanges: lists, open ends, dashes, errors", () => {
  assert.deepEqual(C.parseRanges("1-3, 5, 8-", 10), { ok: true, ranges: [[1, 3], [5, 5], [8, 10]] });
  assert.deepEqual(C.parseRanges(" -2 ; 4 – 6 ", 9), { ok: true, ranges: [[1, 2], [4, 6]] });
  assert.deepEqual(C.parseRanges("", 5), { ok: false, err: "empty" });
  assert.deepEqual(C.parseRanges("1-3, x", 5), { ok: false, err: "syntax", at: "x" });
  assert.deepEqual(C.parseRanges("-", 5), { ok: false, err: "syntax", at: "-" });
  assert.deepEqual(C.parseRanges("4-2", 5), { ok: false, err: "range", at: "4-2" });
  assert.deepEqual(C.parseRanges("0", 5), { ok: false, err: "range", at: "0" });
  assert.deepEqual(C.parseRanges("6", 5), { ok: false, err: "range", at: "6" });
});

test("splitPlan: each page, every n pages, ranges", () => {
  assert.deepEqual(C.splitPlan("each", 3).ranges, [[1, 1], [2, 2], [3, 3]]);
  assert.deepEqual(C.splitPlan("every", 7, "3").ranges, [[1, 3], [4, 6], [7, 7]]);
  assert.deepEqual(C.splitPlan("every", 2, "5").ranges, [[1, 2]]);
  assert.equal(C.splitPlan("every", 5, "0").err, "number");
  assert.equal(C.splitPlan("every", 5, "x").err, "number");
  assert.deepEqual(C.splitPlan("ranges", 5, "2-").ranges, [[2, 5]]);
  assert.equal(C.splitPlan("each", 0).ok, false);
  assert.deepEqual([[1, 3], [5, 5]].map(C.rangeLabel), ["1-3", "5"]);
});

test("parseTarget: token, disk paths under /internal only, PDFs and pictures only", () => {
  assert.deepEqual(C.parseTarget({ openFile: { token: "t1" } }), { token: "t1", paths: [] });
  assert.deepEqual(C.parseTarget({ paths: ["/internal/a.pdf", "/internal/../x.pdf", "/etc/a.pdf", "/internal/b.txt", "/internal/c.PNG", 4] }).paths,
    ["/internal/a.pdf", "/internal/c.PNG"]);
  assert.deepEqual(C.parseTarget({ path: "/internal/x.pdf" }).paths, ["/internal/x.pdf"]);
  assert.deepEqual(C.parseTarget(null), { token: "", paths: [] });
});

// ---------- pdfops: real PDFs ----------

test("load: page count; broken and locked files are refused", async () => {
  const ok = await OPS.load(L, await pdf(3, "A"));
  assert.equal(ok.pages, 3);
  assert.deepEqual(await OPS.load(L, new TextEncoder().encode("%PDF-1.4 nothing here")), { err: "bad" });
  assert.deepEqual(await OPS.load(L, new Uint8Array([1, 2, 3])), { err: "bad" });
  // An /Encrypt entry in the trailer: pdf-lib can't decrypt, so the
  // pages could not be copied (also with an empty user password).
  const plain = Buffer.from(await pdf(1, "S", 300, 400, { useObjectStreams: false })).toString("latin1");
  assert.ok(/trailer\s*<</.test(plain));
  const locked = plain.replace(/trailer\s*<</, "trailer\n<<\n/Encrypt 1 0 R");
  assert.deepEqual(await OPS.load(L, new Uint8Array(Buffer.from(locked, "latin1"))), { err: "locked" });
});

test("build: merge in list order, rotation, a page twice, metadata", async () => {
  const a = await OPS.load(L, await pdf(3, "A"));
  const b = await OPS.load(L, await pdf(2, "B", 500, 300));
  const mk = keys();
  let p = C.pagesOf("a", 3, mk).concat(C.pagesOf("b", 2, mk));   // A1 A2 A3 B1 B2
  p = C.moveTo(p, ["k4"], 0);                                     // B2 A1 A2 A3 B1
  p = C.remove(p, ["k0"]);                                        // B2 A2 A3 B1
  p = C.rotate(p, ["k2"], 90);
  p = C.duplicate(p, ["k2"], mk);                                 // B2 A2 A3 A3 B1
  const out = await OPS.build(L, { a: { kind: "pdf", doc: a.doc }, b: { kind: "pdf", doc: b.doc } }, p, {}, { title: "Merged" });
  const d = await L.PDFDocument.load(out, { updateMetadata: false });
  assert.equal(d.getPageCount(), 5);
  assert.deepEqual(d.getPages().map((x) => x.getRotation().angle), [0, 0, 90, 90, 0]);
  assert.deepEqual(d.getPages().map((x) => Math.round(x.getWidth())), [500, 300, 300, 300, 500]);
  const texts = await textOf(out);
  ["B 2", "A 2", "A 3", "A 3", "B 1"].forEach((s, i) => assert.ok(texts[i].includes(hex(s)), "page " + (i + 1) + " is " + s));
  assert.equal(d.getTitle(), "Merged");
  assert.equal(d.getProducer(), OPS.PRODUCER);
});

test("build: a page's own rotation is kept and added to", async () => {
  const src = await L.PDFDocument.create();
  src.addPage([200, 300]).setRotation(L.degrees(270));
  const s = await OPS.load(L, await src.save());
  const p = C.rotate(C.pagesOf("s", 1, keys()), ["k0"], 180);
  const out = await L.PDFDocument.load(await OPS.build(L, { s: { kind: "pdf", doc: s.doc } }, p, {}));
  assert.equal(out.getPage(0).getRotation().angle, 90);
});

test("build: pictures become pages (A4 centred, the picture's shape), JPEG and PNG", async () => {
  const jpg = fixture("plain.jpg");
  const img1 = { kind: "image", img: { bytes: jpg, type: "jpg", w: 8, h: 4 } };
  const img2 = { kind: "image", img: { bytes: png(30, 60, true), type: "png", w: 30, h: 60 } };
  const p = [{ key: "a", src: "j", idx: 0, rot: 0 }, { key: "b", src: "p", idx: 0, rot: 90 }, { key: "c", src: "j", idx: 0, rot: 0 }];
  let d = await L.PDFDocument.load(await OPS.build(L, { j: img1, p: img2 }, p, { size: "a4", margin: "small" }));
  assert.equal(d.getPageCount(), 3);
  assert.deepEqual(d.getPage(0).getSize(), { width: 841.89, height: 595.28 });   // a wide picture, auto → landscape
  assert.deepEqual(d.getPage(1).getSize(), { width: 595.28, height: 841.89 });
  assert.equal(d.getPage(1).getRotation().angle, 90);
  d = await L.PDFDocument.load(await OPS.build(L, { j: img1 }, [p[0]], { size: "fit", margin: "none" }));
  const sz = d.getPage(0).getSize();
  assert.equal(Math.round(sz.width / sz.height), 2);
});

test("build + split plan: one PDF per range, the right pages in each", async () => {
  const a = await OPS.load(L, await pdf(7, "P"));
  const pages = C.pagesOf("a", 7, keys());
  const plan = C.splitPlan("ranges", 7, "1-3, 5, 6-");
  const parts = [];
  for (const r of plan.ranges) parts.push(await OPS.build(L, { a: { kind: "pdf", doc: a.doc } }, pages.slice(r[0] - 1, r[1]), {}));
  const counts = [];
  for (const b of parts) counts.push((await L.PDFDocument.load(b)).getPageCount());
  assert.deepEqual(counts, [3, 1, 2]);
  const t = await textOf(parts[1]);
  assert.ok(t[0].includes(hex("P 5")));
  assert.deepEqual(plan.ranges.map((r) => C.outName("Report", C.rangeLabel(r))), ["Report (1-3).pdf", "Report (5).pdf", "Report (6-7).pdf"]);
});

test("build: an unknown source fails instead of writing a short PDF", async () => {
  await assert.rejects(OPS.build(L, {}, [{ key: "x", src: "gone", idx: 0, rot: 0 }], {}));
});

// ---------- wave 2: overlays, numbers, watermark, signatures ----------

test("overlays: display ↔ unturned page for every turn, round trip", () => {
  const W = 600, H = 800;
  [0, 90, 180, 270].forEach((R) => {
    [[0, 0], [600, 0], [123, 456], [600, 800]].forEach(([px, py]) => {
      const d = C.toDisp(px, py, W, H, R);
      assert.deepEqual(C.fromDisp(d[0], d[1], W, H, R), [px, py], "R " + R);
    });
  });
  // turned 90° clockwise: the top-left corner shows at the top right
  assert.deepEqual(C.toDisp(0, 0, W, H, 90), [800, 0]);
  assert.deepEqual(C.dispSize(W, H, 270), [800, 600]);
  // put at display (0.25, 0.1) of a page turned 90 → stays there, upright
  const at = C.ovAt(0.25, 0.1, W, H, 90);
  const v = C.ovDisp(Object.assign({ A: 90 }, at), W, H, 90);
  assert.ok(Math.abs(v.fx - 0.25) < 1e-3 && Math.abs(v.fy - 0.1) < 1e-3 && v.turn === 0);
  // the page turned again later: the addition turns with it
  assert.equal(C.ovDisp(Object.assign({ A: 90 }, at), W, H, 180).turn, 90);
  // clamped to the page
  assert.deepEqual(C.ovAt(-1, 2, W, H, 0), { cx: 0, cy: 1 });
});

test("overlays: clean, kept on the list, copied by duplicate and undo", () => {
  const img = "data:image/png;base64,iVBORw0KGgo=";
  assert.equal(C.cleanOv({ t: "img", src: "javascript:alert(1)", cx: 0.5, cy: 0.5 }), null);
  assert.equal(C.cleanOv({ t: "img", src: "data:image/svg+xml;base64,AA==" }), null);
  assert.equal(C.cleanOv({ t: "text", text: "   " }), null);
  const c = C.cleanOv({ id: "a", t: "text", text: "Hi\u0000there", cx: 3, cy: -1, A: 450, fs: 9, color: "pink", x: 1 });
  assert.deepEqual(c, { id: "a", t: "text", cx: 1, cy: 0, A: 90, text: "Hi there", fs: 0.5, color: "black" });
  const mk = keys();
  let p = C.pagesOf("s", 2, mk);
  p = C.setOverlays(p, { k0: [{ id: "x", t: "img", src: img, cx: 0.5, cy: 0.5, w: 0.3, h: 0.1 }, { t: "text", text: "" }] });
  assert.equal(p[0].ov.length, 1);
  assert.equal(p[1].ov, undefined);
  const h = C.history(); C.record(h, p);
  const before = h.past[0][0].ov[0];
  p[0].ov[0].cx = 0.9;                                  // a later change …
  assert.equal(before.cx, 0.5);                         // … never reaches the Undo copy
  const d = C.duplicate(p, ["k0"], mk);
  assert.equal(d[1].ov.length, 1);
  assert.notEqual(d[1].ov[0], d[0].ov[0]);
  assert.equal(C.setOverlays(p, { k0: [] })[0].ov, undefined);
});

test("wave 5: shapes, drawings and pictures are cleaned", () => {
  // shapes: known kinds and colours only, sizes in range, lines may point any way
  const r = C.cleanOv({ id: "s", t: "shape", k: "star", w: 9, h: -1, color: "pink", sw: 5, fill: "yes", cx: 0.5, cy: 0.5 });
  assert.deepEqual(r, { id: "s", t: "shape", cx: 0.5, cy: 0.5, A: 0, k: "rect", w: 2, h: 1, color: "red", fill: false, sw: 0.05 });
  const ln = C.cleanOv({ t: "shape", k: "arrow", w: -0.3, h: 0.2, color: "blue" });
  assert.equal(ln.w, -0.3); assert.equal(ln.h, 0.2); assert.equal(ln.fill, false);
  assert.equal(C.cleanOv({ t: "shape", k: "line", w: 0, h: 0 }).w, 0.01, "a line never has no length");
  assert.equal(C.cleanOv({ t: "shape", k: "line", w: 0.3, h: 0 }).h, 0, "a level line stays level");
  // a cover: filled, no edge; a line can't be filled
  const cv = C.cleanOv({ t: "shape", k: "rect", w: 0.3, h: 0.06, color: "white", fill: true, sw: 0 });
  assert.equal(cv.sw, 0); assert.equal(cv.fill, true);
  assert.equal(C.cleanOv({ t: "shape", k: "line", w: 0.3, h: 0, fill: true, sw: 0 }).fill, false);
  assert.ok(C.cleanOv({ t: "shape", k: "line", w: 0.3, h: 0, sw: 0 }).sw > 0, "an outline shape always has a line");
  // drawings: points inside the box, no bad numbers, limits kept
  assert.equal(C.cleanOv({ t: "ink", w: 0.1, h: 0.1, pts: [] }), null);
  assert.equal(C.cleanOv({ t: "ink", w: 0.1, h: 0.1, pts: "M 0 0" }), null);
  const ink = C.cleanOv({ t: "ink", w: 0.1, h: 0.1, pts: [[0.5, 2, -1, 0.25], [1], [NaN, 0], [0.1, 0.2]], op: 0.4, color: "yellow", sw: 9 });
  assert.deepEqual(ink.pts, [[0.5, 1, 0, 0.25], [0.1, 0.2]]);
  assert.equal(ink.op, 0.4); assert.equal(ink.sw, 0.08);
  const many = C.cleanOv({ t: "ink", w: 0.1, h: 0.1, pts: Array.from({ length: 100 }, () => new Array(200).fill(0.5)) });
  assert.ok(many.pts.length <= C.MAX_STROKES);
  assert.ok(many.pts.reduce((a, st) => a + st.length / 2, 0) <= C.MAX_INK);
  // pictures: PNG or JPEG data: URLs (a signature: PNG only), within the size
  const jpg = "data:image/jpeg;base64,/9j/AA==";
  assert.equal(C.cleanOv({ t: "img", src: jpg, w: 0.2, h: 0.1 }), null);
  assert.equal(C.cleanOv({ t: "img", pic: true, src: jpg, w: 0.2, h: 0.1 }).pic, true);
  assert.equal(C.cleanOv({ t: "img", pic: true, src: "data:image/svg+xml;base64,AA==" }), null);
  assert.equal(C.cleanOv({ t: "img", pic: true, src: "data:image/png;base64," + "A".repeat(C.MAX_PIC_URL) }), null);
  // a copy on the list keeps the drawing
  const p = C.setOverlays(C.pagesOf("s", 1, keys()), { k0: [Object.assign({ id: "i" }, ink)] });
  assert.deepEqual(p[0].ov[0].pts, ink.pts);
});

test("wave 5: outlines of shapes and drawings (M, L, C, Z only, centred, in units)", () => {
  const ok = /^[MLCZ0-9 .\-]+$/;
  C.SHAPES.forEach((k) => {
    const o = C.cleanOv({ t: "shape", k, w: 0.2, h: 0.1, sw: 0.01, color: "green" });
    const parts = C.ovParts(o, 100);
    assert.ok(parts.length >= 1, k);
    parts.forEach((pt) => {
      assert.match(pt.d, ok, k);
      pt.d.split(/[A-Z ]+/).filter(Boolean).map(Number).forEach((n) => assert.ok(Math.abs(n) <= 10.01 + 1e-9, k + " inside its box: " + n));
    });
  });
  const rect = C.ovParts(C.cleanOv({ t: "shape", k: "rect", w: 0.2, h: 0.1, fill: true, sw: 0, color: "white" }), 100);
  assert.deepEqual([rect[0].fill, rect[0].stroke], ["white", null]);
  assert.equal(rect[0].d, "M -10 -5 L 10 -5 L 10 5 L -10 5 Z");
  const arrow = C.ovParts(C.cleanOv({ t: "shape", k: "arrow", w: 0.2, h: 0, sw: 0.01, color: "blue" }), 100);
  assert.equal(arrow.length, 2);
  assert.equal(arrow[1].fill, "blue");
  assert.ok(arrow[1].d.startsWith("M 10 0 "), "the head is at the end");
  const ink = C.ovParts(C.cleanOv({ t: "ink", w: 0.2, h: 0.1, pts: [[0, 0, 1, 1], [0.5, 0.5]], color: "black", sw: 0.01, op: 0.4 }), 100);
  assert.equal(ink[0].d, "M -10 -5 L 10 5 M 0 0 L 0.01 0");
  assert.equal(ink[0].op, 0.4);
});

test("build: shapes and drawings are vector paths where the editor showed them; pictures as JPEG", async () => {
  const src = await L.PDFDocument.create();
  [0, 90].forEach((r) => src.addPage([300, 500]).setRotation(L.degrees(r)));
  const s = await OPS.load(L, await src.save());
  const srcs = { s: { kind: "pdf", doc: s.doc } };
  const where = [[0.25, 0.2], [0.7, 0.8]];
  const pages = C.pagesOf("s", 2, keys()).map((p, i) => {
    const g = OPS.geom(L, srcs, p, {});
    const at = (o) => Object.assign(o, { A: g.R }, C.ovAt(where[i][0], where[i][1], g.W, g.H, g.R));
    return Object.assign(p, { ov: [
      at({ id: "r", t: "shape", k: "ellipse", w: 0.2, h: 0.1, color: "red", sw: 0.004, fill: true }),
      at({ id: "k", t: "ink", w: 0.2, h: 0.1, pts: [[0, 0, 1, 1]], color: "yellow", sw: 0.03, op: 0.4 })
    ] });
  });
  const jpeg = fs.readdirSync(path.join(ROOT, "tests/fixtures/scanpdf")).find((f) => /\.jpe?g$/i.test(f));
  if (jpeg) pages[0].ov.push({ id: "j", t: "img", pic: true, src: "data:image/jpeg;base64," + Buffer.from(fixture(jpeg)).toString("base64"), w: 0.1, h: 0.1, cx: 0.5, cy: 0.5, A: 0 });
  const out = await OPS.build(L, srcs, pages, {});
  const d = await L.PDFDocument.load(out);
  const texts = await textOf(out);
  d.getPages().forEach((pg, i) => {
    const R = pg.getRotation().angle, W = pg.getWidth(), H = pg.getHeight();
    const re = /1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm\s+(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) 0 0 cm\s+1 0 0 -1 0 0 cm/g;
    const found = [...texts[i].matchAll(re)];
    assert.equal(found.length, 2, "page " + (i + 1) + ": the oval and the drawing");
    found.forEach((m) => {
      const disp = C.toDisp(Number(m[1]), H - Number(m[2]), W, H, R), size = C.dispSize(W, H, R);
      assert.ok(Math.abs(disp[0] / size[0] - where[i][0]) < 0.005 && Math.abs(disp[1] / size[1] - where[i][1]) < 0.005, "page " + (i + 1));
    });
    assert.match(texts[i], / c\b/, "the oval is curves");
    assert.match(texts[i], /1 J/, "round line ends");
    assert.match(texts[i], /1 j/, "round corners");
  });
  if (jpeg) {
    const imgs = d.context.enumerateIndirectObjects().map(([, o]) => o)
      .filter((o) => o instanceof L.PDFRawStream && String(o.dict.get(L.PDFName.of("Filter"))) === "/DCTDecode");
    assert.equal(imgs.length, 1, "the picture goes in as a JPEG");
  }
});

test("doc options, page number text and place, watermark size, render scale", () => {
  const o = C.readDocOpts(null);
  assert.deepEqual(o.num, { on: false, pos: "bc", fmt: "n", start: 1 });
  assert.equal(o.wm.on, false);
  const n = C.readDocOpts({ num: { on: 1, pos: "tr", fmt: "nt", start: "5" }, wm: { on: true, text: "  " }, title: "T\n1" });
  assert.equal(n.wm.on, false, "an empty watermark is off");
  assert.equal(n.title, "T 1");
  assert.equal(C.numText(n, 0, 3), "5 / 7");
  assert.equal(C.numText(C.readDocOpts({ num: { on: true, start: -3 } }), 2, 9), "3");
  const c = C.numCenter("bc", 600, 800, 10);
  assert.equal(c[0], 300);
  assert.ok(c[1] > 760 && c[1] < 800);
  assert.ok(C.numCenter("tr", 600, 800, 10)[1] < 40);
  assert.equal(C.numSize(595), 9.92);
  const ws = C.wmSize(5, 595, 842);
  assert.ok(ws > 50 && ws <= 595 / 4);
  assert.equal(C.renderScale(595, 842, 72), 1);
  assert.ok(C.renderScale(20000, 20000, 150) * 20000 <= 5000);
});

test("signatures: kept list (valid PNG data URLs, at most 6, newest first), Otsu, ink, crop, bytes", () => {
  const src = "data:image/png;base64,iVBORw0KGgo=";
  let list = [];
  for (let i = 0; i < 8; i++) list = C.addSig(list, { id: "s" + i, src, w: 100, h: 40 });
  assert.equal(list.length, C.MAX_SIGS);
  assert.equal(list[0].id, "s7");
  list = C.removeSig(list, "s7");
  assert.equal(list[0].id, "s6");
  assert.deepEqual(C.readSigs([{ id: "a", src: "data:text/html,<b>", w: 1, h: 1 }, { id: "b", src, w: 0, h: 9 }, "x", null]), []);
  assert.equal(C.readSigs([{ id: "c", src: src + "A".repeat(300000), w: 9, h: 9 }]).length, 0);
  // bimodal: dark ink around 30, paper around 220
  const hist = new Array(256).fill(0);
  hist[30] = 100; hist[35] = 50; hist[215] = 400; hist[225] = 300;
  const thr = C.otsu(hist);
  assert.ok(thr >= 35 && thr < 215, String(thr));
  // 4 × 1 pixels: ink, paper, ink, paper
  const px = new Uint8ClampedArray([20, 20, 20, 255, 230, 230, 230, 255, 25, 25, 25, 255, 235, 235, 235, 255]);
  C.inkFromPhoto(px, [1, 2, 3]);
  assert.deepEqual([px[3], px[7], px[11], px[15]].map((a) => a > 200 ? "ink" : a === 0 ? "clear" : "?"), ["ink", "clear", "ink", "clear"]);
  assert.deepEqual([px[0], px[1], px[2]], [1, 2, 3]);
  const box = new Uint8ClampedArray(10 * 5 * 4);
  box[(2 * 10 + 3) * 4 + 3] = 255; box[(3 * 10 + 6) * 4 + 3] = 255;
  assert.deepEqual(C.inkBox(box, 10, 5, 1), { x: 2, y: 1, w: 6, h: 4 });
  assert.equal(C.inkBox(new Uint8ClampedArray(16), 2, 2, 0), null);
  assert.deepEqual([...C.dataUrlBytes("data:image/png;base64,AQID")], [1, 2, 3]);
});

// Where pdf-lib put each picture: the centre of the box drawn by the
// "x y cm / rotate cm / w h cm … Do" run before each image.
function imageCentres(content) {
  const out = [], re = /1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm\s+(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) 0 0 cm\s+([\d.]+) 0 0 ([\d.]+) 0 0 cm[^]*?Do/g;
  let m;
  while ((m = re.exec(content))) {
    const [x, y, a, b, c, d, w, h] = m.slice(1).map(Number);
    out.push([x + a * w / 2 + c * h / 2, y + b * w / 2 + d * h / 2]);
  }
  return out;
}

test("build: a signature put on a turned page lands where the editor showed it", async () => {
  const src = await L.PDFDocument.create();
  [0, 90, 180, 270].forEach((r) => src.addPage([300, 500]).setRotation(L.degrees(r)));
  const s = await OPS.load(L, await src.save());
  const srcs = { s: { kind: "pdf", doc: s.doc } };
  const img = "data:image/png;base64," + Buffer.from(png(4, 2)).toString("base64");
  const where = [[0.2, 0.1], [0.7, 0.85], [0.5, 0.3], [0.9, 0.6]];
  const pages = C.pagesOf("s", 4, keys()).map((p, i) => {
    const g = OPS.geom(L, srcs, p, {});
    return Object.assign(p, { ov: [Object.assign({ id: "o", t: "img", src: img, w: 0.2, h: 0.1, A: g.R }, C.ovAt(where[i][0], where[i][1], g.W, g.H, g.R))] });
  });
  const out = await OPS.build(L, srcs, pages, {});
  const d = await L.PDFDocument.load(out);
  const texts = await textOf(out);
  d.getPages().forEach((pg, i) => {
    const R = pg.getRotation().angle, W = pg.getWidth(), H = pg.getHeight();
    const c = imageCentres(texts[i]);
    assert.equal(c.length, 1, "page " + (i + 1));
    const disp = C.toDisp(c[0][0], H - c[0][1], W, H, R), size = C.dispSize(W, H, R);
    assert.ok(Math.abs(disp[0] / size[0] - where[i][0]) < 0.005 && Math.abs(disp[1] / size[1] - where[i][1]) < 0.005,
      "page " + (i + 1) + " at " + disp.map((v, k) => (v / size[k]).toFixed(3)));
  });
});

test("build: Greek text, page numbers, watermark, title and author with the Noto font; no font → code font", async () => {
  const a = await OPS.load(L, await pdf(3, "A"));
  const srcs = { a: { kind: "pdf", doc: a.doc } };
  const p = C.pagesOf("a", 3, keys());
  p[1].ov = [{ id: "t", t: "text", text: "Υπογραφή: Χρήστος", cx: 0.5, cy: 0.5, A: 0, fs: 0.05, color: "blue" }];
  const opts = { num: { on: true, fmt: "nt" }, wm: { on: true, text: "ΑΝΤΙΓΡΑΦΟ", op: "strong" }, title: "Σύμβαση", author: "Χρήστος" };
  await assert.rejects(OPS.build(L, srcs, p, {}, { opts }), (e) => e.code === "font");
  const out = await OPS.build(L, srcs, p, {}, { opts, font: FONT });
  const d = await L.PDFDocument.load(out, { updateMetadata: false });
  assert.equal(d.getPageCount(), 3);
  assert.equal(d.getTitle(), "Σύμβαση");
  assert.equal(d.getAuthor(), "Χρήστος");
  const fonts = d.context.enumerateIndirectObjects().map(([, o]) => o)
    .filter((o) => o instanceof L.PDFDict && String(o.get(L.PDFName.of("BaseFont")) || "").includes("NotoSans"));
  assert.ok(fonts.length > 0, "the Noto font is embedded");
  const texts = await textOf(out);
  texts.forEach((t, i) => {
    assert.ok(t.includes(hex("A " + (i + 1))), "the page's own text stays");
    assert.ok(/\/GS-?\d+ gs/.test(t) || /gs/.test(t), "watermark opacity on page " + (i + 1));
  });
  // only pictures and no text: no font needed
  const plain = await OPS.build(L, srcs, C.pagesOf("a", 1, keys()), {}, {});
  assert.ok(plain.length > 0);
});

test("fromImages: one JPEG per page, the page filled, upright", async () => {
  const jpg = fixture("plain.jpg");
  const out = await OPS.fromImages(L, [{ bytes: jpg, w: 842, h: 595 }, { bytes: jpg, w: 300, h: 400 }], { opts: { title: "Small" } });
  const d = await L.PDFDocument.load(out, { updateMetadata: false });
  assert.deepEqual(d.getPages().map((x) => [x.getWidth(), x.getHeight(), x.getRotation().angle]), [[842, 595, 0], [300, 400, 0]]);
  assert.equal(d.getTitle(), "Small");
});

// ---------- page wiring ----------

test("index.html: DL-1 first, scripts in order, [hidden] rule, no inline handlers", () => {
  const html = read("scanpdf/index.html");
  const charset = html.indexOf('<meta charset="utf-8">');
  const dl = html.indexOf('location.replace("../?open=scanpdf"');
  assert.ok(charset > 0 && dl > charset && dl < html.indexOf("<title>"));
  const at = (s) => html.indexOf(s);
  const seq = ["../vendor/pdf-lib/pdf-lib.min.js", "core.js?v=", "pdfops.js?v=", "../bundle.js?v=", "scanpdf.js?v="].map(at);
  seq.forEach((i) => assert.ok(i > 0));
  assert.deepEqual([...seq].sort((x, y) => x - y), seq);
  assert.ok(!/\son[a-z]+=/i.test(html), "no inline event handlers");
  assert.ok(/\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(read("scanpdf/scanpdf.css")));
});

test("scanpdf.js: palette, deep link, R33 dialogs, no innerHTML from data, every t() key exists", () => {
  const js = read("scanpdf/scanpdf.js");
  ["function inheritPalette", "function watchPalette", "window.__orosOpenAt", "__orosTakeTarget(\"scanpdf\")",
   "__orosTakeFile", "dlg.saveFile", "dlg.openFiles", "isEvalSupported: false"].forEach((s) => assert.ok(js.includes(s), s));
  assert.ok(!/showSaveFilePicker|showOpenFilePicker/.test(js));
  // innerHTML only ever gets the fixed ICON strings
  (js.match(/innerHTML\s*=\s*[^;]+/g) || []).forEach((m) => assert.ok(/=\s*ICON(\.|\[)/.test(m), m));
  const en = new Function("return " + js.slice(js.indexOf("var STRINGS = ") + 14, js.indexOf("\n  };\n", js.indexOf("var STRINGS = ")) + 4))().en;
  const used = new Set();
  for (const m of js.matchAll(/\bt\("([a-z][\w.]*\w)"/g)) used.add(m[1]);
  for (const m of js.matchAll(/\btn\("([a-z][\w.]*\w)"/g)) used.add(m[1]);
  for (const m of js.matchAll(/data-i18n="([\w.]+)"/g)) used.add(m[1]);
  for (const m of read("scanpdf/index.html").matchAll(/data-i18n="([\w.]+)"/g)) used.add(m[1]);
  used.forEach((k) => assert.ok(en[k] !== undefined, "missing string " + k));
  // keys built at runtime
  ["pic.a4", "pic.letter", "pic.fit", "pic.portrait", "pic.landscape", "split.err.empty", "split.err.syntax",
   "split.err.range", "split.err.number", "err.locked", "err.bad",
   "ed.sig", "ed.text", "ed.date", "ed.all", "ed.del", "ed.prev", "ed.next", "btn.close", "btn.edit",
   "color.black", "color.blue", "color.red", "sig.draw", "sig.type", "sig.photo",
   "cmp.off", "cmp.light", "cmp.medium", "cmp.strong"].concat(C.NUM_POS.map((k) => "num." + k)).forEach((k) => assert.ok(en[k], k));
  // every English string has a Greek one
  const el = new Function("return " + js.slice(js.indexOf("var STRINGS = ") + 14, js.indexOf("\n  };\n", js.indexOf("var STRINGS = ")) + 4))().el;
  Object.keys(en).forEach((k) => assert.ok(el[k] !== undefined, "no Greek for " + k));
  // saved signatures stay device-local: never handed to sync
  assert.ok(js.includes("C.SIGS_KEY") && !/orosSync|__slices/.test(js));
});
