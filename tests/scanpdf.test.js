// orOS Scanner & PDF (scanpdf/): recognising files (name, first bytes,
// EXIF orientation), the page list edits (move, drag target, rotate,
// delete, duplicate, undo/redo), page ranges and split plans, picture
// page sizes, names, prefs and deep-link targets; real PDFs written by
// pdfops.js with the vendored pdf-lib (merge, order, rotation, copies,
// pictures, split parts, locked and broken files); the page wiring
// (DL-1, palette, R33, every t() key exists).
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
  assert.deepEqual(C.readPrefs(null), { size: "a4", orient: "auto", margin: "small", dest: "device" });
  assert.deepEqual(C.readPrefs({ size: "fit", orient: "landscape", margin: "none", dest: "files", x: 1 }),
    { size: "fit", orient: "landscape", margin: "none", dest: "files" });
  assert.deepEqual(C.readPrefs({ size: "a3", orient: 9, margin: "<b>", dest: "cloud" }), C.readPrefs(null));
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
   "split.err.range", "split.err.number", "err.locked", "err.bad"].forEach((k) => assert.ok(en[k], k));
});
