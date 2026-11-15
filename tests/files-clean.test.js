// Files › Remove hidden details (STRICT-4, files/clean-core.js): each
// cleaner drops who / where / when / with what and keeps the content
// byte for byte.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const zlib = require("zlib");
const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "files/clean-core.js"));
const Zip = require(path.join(ROOT, "atelier/zip.js"));
const FC = require(path.join(ROOT, "files/files-core.js"));
const PDFLib = require(path.join(ROOT, "vendor/pdf-lib/pdf-lib.min.js"));

const u8 = (a) => Uint8Array.from(a);
const asc = (s) => Array.from(Buffer.from(s, "latin1"));
function seg(marker, payload) { const n = payload.length + 2; return [0xff, marker, n >> 8, n & 255].concat(payload); }
function has(b, s) { return Buffer.from(b).includes(Buffer.from(s, "latin1")); }

// A JPEG: JFIF, EXIF (orientation 6 + a GPS pointer), XMP, COM, ICC,
// a DQT, SOS with "image data", EOI.
function jpeg(orient) {
  const tiff = [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 2,
    0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orient, 0, 0,
    0x88, 0x25, 0, 4, 0, 0, 0, 1, 0, 0, 0, 0x26,
    0, 0, 0, 0].concat(asc("Canon EOS 5D serial 1234"));
  return u8([0xff, 0xd8]
    .concat(seg(0xe0, asc("JFIF\0").concat([1, 2, 0, 0, 1, 0, 1, 0, 0])))
    .concat(seg(0xe1, asc("Exif\0\0").concat(tiff)))
    .concat(seg(0xe1, asc("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>Jane Doe</x:xmpmeta>")))
    .concat(seg(0xfe, asc("taken at the safe house")))
    .concat(seg(0xe2, asc("ICC_PROFILE\0").concat([1, 1, 9, 9])))
    .concat(seg(0xdb, [0].concat(new Array(64).fill(1))))
    .concat(seg(0xda, [1, 1, 0, 0, 63, 0]).concat([0x12, 0x34, 0xff, 0x00, 0x56]))
    .concat([0xff, 0xd9]));
}

test("JPEG: EXIF, GPS, XMP and comments go; JFIF, colour profile and image data stay", () => {
  const src = jpeg(6), r = C.cleanJpeg(src);
  assert.deepEqual(r.removed.sort(), ["camera", "comment", "gps", "xmp"]);
  assert.ok(!has(r.bytes, "Canon") && !has(r.bytes, "Jane") && !has(r.bytes, "safe house"));
  assert.ok(has(r.bytes, "JFIF") && has(r.bytes, "ICC_PROFILE"));
  const tail = Buffer.from(src).subarray(Buffer.from(src).indexOf(Buffer.from([0xff, 0xda])));
  assert.ok(Buffer.from(r.bytes).subarray(-tail.length).equals(tail), "image data byte for byte");
  // the turned photo keeps only its orientation
  const ex = Buffer.from(r.bytes).indexOf(Buffer.from("Exif\0\0", "latin1"));
  assert.ok(ex > 0);
  assert.equal(C.tiffInfo(r.bytes, ex + 6, r.bytes.length).orient, 6);
  assert.equal(C.tiffInfo(r.bytes, ex + 6, r.bytes.length).gps, false);
  // upright photo: no EXIF at all
  assert.ok(!has(C.cleanJpeg(jpeg(1)).bytes, "Exif"));
  // already clean: the same bytes back
  const again = C.cleanJpeg(r.bytes);
  assert.equal(again.removed.length, 0);
  assert.equal(again.bytes, r.bytes);
  assert.throws(() => C.cleanJpeg(u8([0xff, 0xd8, 0x00, 0x11, 0, 0])));
});

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), Buffer.from(data)]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) : 0);
  return Buffer.concat([len, body, crc]);
}
test("PNG: text, EXIF and time chunks go; image chunks stay", () => {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]), idat = chunk("IDAT", [1, 2, 3]), iend = chunk("IEND", []);
  const src = Buffer.concat([sig, ihdr, chunk("tEXt", asc("Author\0Jane Doe")), chunk("tIME", [7, 234, 11, 14, 1, 2, 3]),
    chunk("eXIf", asc("MM\0*")), idat, iend]);
  const r = C.cleanPng(u8(src));
  assert.deepEqual(r.removed.sort(), ["camera", "text", "time"]);
  assert.ok(Buffer.from(r.bytes).equals(Buffer.concat([sig, ihdr, idat, iend])));
});

test("WebP: EXIF and XMP chunks go, the flags and the size follow", () => {
  function ch(id, data) { const l = Buffer.alloc(4); l.writeUInt32LE(data.length); const pad = data.length & 1 ? [0] : []; return Buffer.concat([Buffer.from(id, "latin1"), l, Buffer.from(data), Buffer.from(pad)]); }
  const vp8x = ch("VP8X", [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]), img = ch("VP8 ", [9, 9, 9]);
  const body = Buffer.concat([Buffer.from("WEBP"), vp8x, img, ch("EXIF", asc("MM\0*GPS")), ch("XMP ", asc("<x>Jane</x>"))]);
  const head = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4)]); head.writeUInt32LE(body.length, 4);
  const r = C.cleanWebp(u8(Buffer.concat([head, body])));
  assert.deepEqual(r.removed.sort(), ["camera", "xmp"]);
  const out = Buffer.from(r.bytes);
  assert.equal(out.readUInt32LE(4), out.length - 8);
  assert.equal(out[20] & 0x0c, 0, "no EXIF/XMP flags");
  assert.ok(!has(out, "Jane") && has(out, "VP8 "));
});

const CORE_XML = '<?xml version="1.0"?><cp:coreProperties xmlns:cp="x" xmlns:dc="y" xmlns:dcterms="z"><dc:title>Report</dc:title><dc:creator>Jane Doe</dc:creator><cp:lastModifiedBy>J. Doe</cp:lastModifiedBy><cp:revision>12</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">2026-11-01T10:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-11-02T10:00:00Z</dcterms:modified><dc:description>source: M.</dc:description></cp:coreProperties>';
const APP_XML = '<Properties><Application>Microsoft Office Word</Application><Company>Daily News</Company><Template>Normal.dotm</Template><TotalTime>93</TotalTime><Pages>2</Pages></Properties>';
const DOC_XML = '<w:document><w:body><w:p w:rsidR="00A1B2C3" w:rsidRDefault="00D4E5F6"><w:r><w:t>Text</w:t></w:r></w:p><w:ins w:author="Jane">x</w:ins></w:body></w:document>';

test("Word: people, dates, program, company and editing ids go; title, text, comments warning", () => {
  const r = C.cleanOffice("ooxml", { "docProps/core.xml": CORE_XML, "docProps/app.xml": APP_XML, "word/document.xml": DOC_XML,
    "word/settings.xml": '<w:settings><w:zoom/><w:rsids><w:rsidRoot w:val="00A1B2C3"/></w:rsids></w:settings>',
    "docProps/custom.xml": '<Properties><property name="Source">M.</property></Properties>' },
    ["word/document.xml", "word/comments.xml"]);
  assert.deepEqual(r.removed.sort(), ["app", "custom", "dates", "people", "rsid", "text"]);
  assert.deepEqual(r.warn.sort(), ["comments", "tracked"]);
  const core = r.changes["docProps/core.xml"];
  assert.match(core, /<dc:title>Report<\/dc:title>/);
  assert.doesNotMatch(core, /Jane|J\. Doe|2026|source/);
  assert.doesNotMatch(r.changes["docProps/app.xml"], /Daily News|Normal|Microsoft|TotalTime/);
  assert.match(r.changes["docProps/app.xml"], /<Pages>2<\/Pages>/);
  assert.doesNotMatch(r.changes["word/document.xml"], /rsid/);
  assert.match(r.changes["word/document.xml"], /<w:t>Text<\/w:t>/);
  assert.doesNotMatch(r.changes["word/settings.xml"], /rsid/);
  assert.doesNotMatch(r.changes["docProps/custom.xml"], /Source/);
});

test("OpenDocument: meta and printer go; comments and tracked changes are reported", () => {
  const meta = '<office:document-meta><office:meta><meta:initial-creator>Jane</meta:initial-creator><dc:creator>Jane</dc:creator><meta:creation-date>2026-11-01</meta:creation-date><dc:date>2026-11-02</dc:date><meta:editing-cycles>4</meta:editing-cycles><meta:generator>LibreOffice/7</meta:generator><meta:user-defined meta:name="Src">M</meta:user-defined><dc:title>Report</dc:title></office:meta></office:document-meta>';
  const settings = '<config:config-item config:name="PrinterName" config:type="string">Newsroom-HP</config:config-item>';
  const r = C.cleanOffice("odf", { "meta.xml": meta, "settings.xml": settings,
    "content.xml": '<office:text><office:annotation>x</office:annotation><text:tracked-changes/></office:text>' });
  assert.deepEqual(r.removed.sort(), ["app", "custom", "dates", "people"]);
  assert.deepEqual(r.warn.sort(), ["comments", "tracked"]);
  assert.doesNotMatch(r.changes["meta.xml"], /Jane|2026|LibreOffice|Src|editing/);
  assert.match(r.changes["meta.xml"], /<dc:title>Report<\/dc:title>/);
  assert.doesNotMatch(r.changes["settings.xml"], /Newsroom/);
});

test("a whole .docx is rebuilt: changed parts cleaned, others byte for byte, neutral dates", async () => {
  const enc = new TextEncoder();
  const files = { "[Content_Types].xml": "<Types/>", "docProps/core.xml": CORE_XML, "docProps/app.xml": APP_XML, "word/document.xml": DOC_XML, "word/media/image1.png": "PNGDATA" };
  const entries = Object.keys(files).map((n) => { const d = enc.encode(files[n]); return { name: n, size: d.length, crc: FC.crc32(d), data: d, method: 0, date: new Date(2026, 10, 2, 13, 45) }; });
  const src = new Uint8Array(Buffer.concat(FC.zipBuild(entries).map((p) => Buffer.from(p))));
  const deflate = (b) => new Uint8Array(zlib.deflateRawSync(b));
  const r = await C.cleanZip("ooxml", src, { Zip, build: FC.zipBuild, crc32: FC.crc32, deflate });
  assert.ok(r.removed.includes("people") && r.warn.includes("tracked"));
  const z = Zip.open(r.bytes);
  assert.deepEqual(z.names, Object.keys(files));
  assert.doesNotMatch(await z.text("docProps/core.xml"), /Jane/);
  assert.equal(await z.text("word/media/image1.png"), "PNGDATA");
  const loc = Buffer.from(r.bytes);
  assert.equal(loc.readUInt16LE(12), (0 << 9) | (1 << 5) | 1, "zip date 1980-01-01");
  assert.equal(C.kindOf("a.docx", r.bytes), "ooxml");
});

test("PDF: author, program, dates and XMP go, earlier versions inside too; the title stays", async () => {
  const doc = await PDFLib.PDFDocument.create();
  doc.addPage([200, 200]);
  doc.setTitle("Report"); doc.setAuthor("Jane Doe"); doc.setCreator("Word"); doc.setProducer("Acrobat");
  doc.setKeywords(["source M"]); doc.setCreationDate(new Date(2026, 10, 1));
  const first = await doc.save();
  // an incremental "second version" appended, as editors do
  const src = new Uint8Array(Buffer.concat([Buffer.from(first), Buffer.from("\n% second save\n%%EOF\n")]));
  const r = await C.cleanPdf(src, PDFLib);
  assert.deepEqual(r.removed.sort(), ["app", "dates", "history", "people", "text"]);
  const back = await PDFLib.PDFDocument.load(r.bytes, { updateMetadata: false });
  assert.equal(back.getAuthor(), undefined);
  assert.equal(back.getProducer(), undefined);
  assert.equal(back.getTitle(), "Report");
  assert.equal(back.getPageCount(), 1);
  await assert.rejects(C.cleanPdf(u8(asc("%PDF-1.7 nonsense")), PDFLib));
});

test("kinds, names and the menu check", () => {
  assert.equal(C.kindOf("x.jpg", jpeg(1)), "jpeg");
  assert.equal(C.kindOf("x.txt", u8(asc("hello world, plain"))), "");
  assert.equal(C.canClean("Photo.JPG"), true);
  assert.equal(C.canClean("notes.txt"), false);
  assert.equal(C.canClean("Budget.xlsx"), true);
  assert.equal(C.cleanName("Report.final.docx"), "Report.final (clean).docx");
  assert.equal(C.cleanName("README"), "README (clean)");
});
