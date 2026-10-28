// Converter, Writer's side (writer/convert.js → OrosConvert.writer) and
// the shared pure code it uses with Writer (writer/io.js → WriterIO).
// Node: the contract, the error codes, one copy of the parsers, the
// .orosdoc bundle. Chromium (when Playwright is installed): DOCX, ODT,
// HTML, Markdown, TXT and RTF files converted for real and read back.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const http = require("http");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const CV = require(path.join(ROOT, "writer/convert.js"));
const IO = require(path.join(ROOT, "writer/io.js"));
const B = require(path.join(ROOT, "bundle.js"));

// A red 2×2 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DAwMDAwMDAAAD//wMAD/sB/1Y3o3EAAAAASUVORK5CYII=", "base64");

test("contract: OrosConvert.writer shape, deps on disk, loading boots nothing", () => {
  assert.equal(CV.app, "writer");
  assert.equal(CV.to, ".orosdoc");
  assert.equal(CV.mime, "application/x-oros-doc");
  assert.equal(CV.mime, B.TYPES[".orosdoc"].mime);
  assert.deepEqual(CV.from, [".docx", ".odt", ".rtf", ".html", ".htm", ".md", ".markdown", ".txt", ".pdf"]);
  assert.equal(typeof CV.convert, "function");
  CV.deps.forEach((d) => assert.ok(fs.existsSync(path.join(ROOT, d)), d));
  assert.ok(CV.deps.indexOf("writer/track.js") < CV.deps.indexOf("writer/io.js"));
  const src = read("writer/convert.js");
  assert.doesNotMatch(src, /localStorage|indexedDB|orosSync|document\.(body|getElementById|querySelector)/);
  assert.match(src, /root\.OrosConvert\.writer = api/);
  // every user-facing text in English and Greek
  const vm = require("vm");
  const box = { window: {}, Promise: Promise };
  vm.runInNewContext(src, box);
  assert.ok(box.window.OrosConvert && box.window.OrosConvert.writer.convert, "browser global");
});

test("errors: unsupported, toobig, bad", async () => {
  const e1 = await CV.convert({ name: "a.doc", size: 10 }).catch((e) => e);
  assert.equal(e1.code, "unsupported");
  const e2 = await CV.convert({ name: "orosdoc.orosdoc", size: 10 }).catch((e) => e);
  assert.equal(e2.code, "unsupported", "an .orosdoc needs no converting");
  const e3 = await CV.convert({ name: "Big.DOCX", size: CV.maxSize + 1 }).catch((e) => e);
  assert.equal(e3.code, "toobig");
  const e4 = await CV.convert(null).catch((e) => e);
  assert.equal(e4.code, "bad");
  const e5 = await CV.convert({ name: "a.txt", size: 3 }).catch((e) => e);
  assert.equal(e5.code, "bad", "no DOM in Node: refused, never thrown");
});

test("one copy: Writer uses io.js, loaded before writer.js", () => {
  const W = read("writer/writer.js");
  ["ioParseDocxXml", "ioParseOdtXml", "ioReadZip", "ioDxRuns", "ioParseMd", "ioMdInline", "ioParseHtml", "ioLiftImages"]
    .forEach((n) => assert.ok(W.indexOf("function " + n + "(") === -1, n + " lives in io.js only"));
  assert.match(W, /WriterIO\.parseZipBuf\(buf, ext\)/);
  assert.match(W, /WriterIO\.parseTextOf\(text, ext\)/);
  assert.match(W, /WriterIO\.writeBundle\(obj, doc, ioToStandaloneHTML\(doc\)/);
  const html = read("writer/index.html");
  const at = (s) => html.indexOf(s);
  assert.ok(at('src="track.js') > 0 && at('src="track.js') < at('src="io.js') && at('src="io.js') < at('src="writer.js'));
});

test("drift guard: writer.js's own ioParseTxt (openSearchTarget) = io.js parseTxt", () => {
  const W = read("writer/writer.js");
  function cut(name) {
    const i = W.indexOf("\nfunction " + name + "(") + 1;
    return W.slice(i, W.indexOf("\n}", i) + 2);
  }
  const mine = new Function(cut("esc") + "\n" + cut("ioParseTxt") + "\nreturn ioParseTxt;")();
  ["", "One\n\nTwo <b>x</b>", "Line\r\nnext\r\n\r\n\r\nΆλλη & τέλος", "x".repeat(81) + "\n\nshort",
   "  spaced  \n \n tail "].forEach((s) => assert.deepEqual(IO.parseTxt(s), mine(s), JSON.stringify(s)));
});

test("io.js without a DOM: RTF, TXT and the JSON .orosdoc parse", () => {
  const r = IO.parseTextOf("{\\rtf1\\ansi\\ansicpg1253{\\fonttbl{\\f0 Arial;}}Hello \\b bold\\b0\\par Caf\\'e9 \\u915?\\u949?\\par}", "rtf");
  assert.equal(r.kind, "doc");
  assert.equal(r.title, "Hello bold");
  assert.equal(r.html, "<p>Hello <strong>bold</strong></p><p>Cafι Γε</p>", "\\ansicpg1253: byte 0xE9 is ι");
  const t = IO.parseTextOf("Title\n\nBody & more", "txt");
  assert.deepEqual([t.title, t.html], ["Title", "<p>Title</p><p>Body &amp; more</p>"]);
  const o = IO.parseTextOf(JSON.stringify({ orosWriter: true, doc: { title: "T", html: "<p>x</p>", tags: ["a"] } }), "orosdoc");
  assert.deepEqual([o.title, o.html, o.tags], ["T", "<p>x</p>", ["a"]]);
  assert.throws(() => IO.parseTextOf("x", "pdf"), /unsupported/);
});

test("io.js bundle: content.json, media by sha256, preview page, meta", async () => {
  const b64 = PNG.toString("base64");
  const doc = { id: "d1", title: "Τίτλος", author: "", tags: [], category: "", pageSize: "a4",
    margins: { top: 25, bottom: 25, left: 25, right: 25 }, header: "", footer: "", mtime: 1760000000000,
    fm: { c: 1750000000000 }, footnotes: [{ id: "fn1", text: "Note" }], comments: [],
    html: '<p>Hi <strong>there</strong><sup class="fn-ref" data-fn="fn1">1</sup></p><p><img src="data:image/png;base64,' + b64 + '"></p>' };
  const obj = IO.docContent(doc);
  assert.deepEqual(Object.keys(obj.doc), ["title", "author", "tags", "category", "html", "footnotes", "comments", "pageSize", "margins", "header", "footer"]);
  const page = '<!DOCTYPE html><html><body><img src="data:image/png;base64,' + b64 + '"></body></html>';
  const bytes = await IO.writeBundle(obj, doc, page, "el");
  const r = await B.read(bytes, { mime: CV.mime });
  const key = (await B.sha256(new Uint8Array(PNG))) + ".png";
  assert.deepEqual(Object.keys(r.media), [key]);
  assert.equal(r.content.doc.html, '<p>Hi <strong>there</strong><sup class="fn-ref" data-fn="fn1">1</sup></p><p><img src="media/' + key + '"></p>');
  assert.equal(r.meta.title, "Τίτλος");
  assert.equal(r.meta.language, "el");
  assert.equal(r.meta.generator, "orOS Writer");
  assert.equal(r.app, "writer");
  // and back: media/<key> → data: URL again, as Writer opens it
  const back = IO.dropImages(r.content.doc.html, r.media);
  assert.match(back, /src="data:image\/png;base64,iVBOR/);
});

/* ----- Chromium: real files through convert() ----- */

function crc32(b) {
  if (zlib.crc32) return zlib.crc32(b) >>> 0;
  let c, crc = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) { c = (crc ^ b[i]) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
// files: [[name, Buffer|string, deflate?]]
function zip(files) {
  const locals = [], centrals = [];
  let off = 0;
  files.forEach(([name, data, deflate]) => {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
    const body = deflate ? zlib.deflateRawSync(raw) : raw;
    const nm = Buffer.from(name, "utf8"), crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(deflate ? 8 : 0, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(deflate ? 8 : 0, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28);
    ch.writeUInt32LE(off, 42);
    locals.push(lh, nm, body); centrals.push(ch, nm);
    off += 30 + nm.length + body.length;
  });
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat(locals.concat([cd, end]));
}

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const DOCX = zip([
  ["[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
  ["word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document ' + W_NS + '><w:body>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Report</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">Plain </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r>' +
    '<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> ιταλικά</w:t></w:r>' +
    '<w:ins w:id="1" w:author="Chris" w:date="2026-10-01T10:00:00Z"><w:r><w:t xml:space="preserve"> added</w:t></w:r></w:ins></w:p>' +
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>first</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>second</w:t></w:r></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    '</w:body></w:document>', true],
  ["word/numbering.xml", '<?xml version="1.0"?><w:numbering ' + W_NS + '><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>', true],
  ["word/media/image1.png", PNG]
]);
const ODT = zip([
  ["mimetype", "application/vnd.oasis.opendocument.text"],
  ["content.xml", '<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
    'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0">' +
    '<office:automatic-styles><style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style></office:automatic-styles>' +
    '<office:body><office:text><text:h text:outline-level="1">Odt title</text:h>' +
    '<text:p>Some <text:span text:style-name="T1">strong</text:span> words</text:p>' +
    '<text:list><text:list-item><text:p>one</text:p></text:list-item></text:list></office:text></office:body></office:document-content>', true],
  ["Pictures/p.png", PNG]
]);
const MD = "# Notes\n\nText **bold** and a note[^1].\n\n![red](data:image/png;base64," + PNG.toString("base64") + ")\n\n[^1]: The note.\n";
const HTML = '<!DOCTYPE html><html><head><title>Page</title><script>alert(1)</script></head><body><h1>Hi</h1><p onclick="x()"><b>B</b> <img src="data:image/png;base64,' +
  PNG.toString("base64") + '"> <img src="https://example.com/a.png"></p></body></html>';

function chromium() {
  try {
    const exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
    const pw = require("/opt/node22/lib/node_modules/playwright");
    if (fs.existsSync(exe)) return { pw, exe };
    const own = pw.chromium.executablePath();
    return own && fs.existsSync(own) ? { pw, exe: own } : null;
  } catch (e) { return null; }
}

// A one-page PDF in Helvetica / Helvetica-Bold: lines [font, size, x, y (from the top), text]
function pdf(lines) {
  const esc = (t) => t.replace(/[\\()]/g, (c) => "\\" + c);
  const stream = lines.map(([f, size, x, y, t]) => "BT /" + f + " " + size + " Tf " + x + " " + (842 - y) + " Td (" + esc(t) + ") Tj ET").join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    "<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream"
  ];
  let out = "%PDF-1.4\n";
  const offs = objs.map((o, i) => { const at = out.length; out += (i + 1) + " 0 obj\n" + o + "\nendobj\n"; return at; });
  const xref = out.length;
  out += "xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n" + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += "trailer\n<< /Size " + (objs.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  return Buffer.from(out, "latin1");
}
const PDF = pdf([
  ["F2", 22, 72, 80, "Agreement"],
  ["F1", 11, 72, 120, "The parties agree to the "], ["F2", 11, 199, 120, "terms"], ["F1", 11, 231, 120, " below."],
  ["F1", 11, 72, 150, "1. First term."],
  ["F1", 11, 72, 166, "2. Second term."],
  ["F1", 9, 290, 810, "1"]
]);
// A DOCX from a Greek Word: style ids "1" / "a" with English names in styles.xml
const DOCX_EL = zip([
  ["[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
  ["word/styles.xml", '<?xml version="1.0"?><w:styles ' + 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' + '>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="a"><w:name w:val="Normal"/><w:pPr><w:jc w:val="both"/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/><w:basedOn w:val="a"/><w:rPr><w:b/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="Strong1"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style></w:styles>', true],
  ["word/numbering.xml", '<?xml version="1.0"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="3"/><w:numFmt w:val="lowerLetter"/></w:lvl></w:abstractNum>' +
    '<w:num w:numId="7"><w:abstractNumId w:val="0"/></w:num></w:numbering>', true],
  ["word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:pPr><w:pStyle w:val="1"/><w:jc w:val="center"/></w:pPr><w:r><w:t>Σύμβαση</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">Κείμενο </w:t></w:r><w:r><w:rPr><w:rStyle w:val="Strong1"/></w:rPr><w:t>έντονο</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>Δεξιά</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr><w:jc w:val="left"/></w:pPr><w:r><w:t>γ</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>μέση</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr><w:jc w:val="left"/></w:pPr><w:r><w:t>δ</w:t></w:r></w:p>' +
    '</w:body></w:document>', true]
]);
// A DOCX with a footnote and an endnote (Word's separator notes left out)
const WNS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const DOCX_NOTES = zip([
  ["[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
  ["word/footnotes.xml", '<?xml version="1.0"?><w:footnotes ' + WNS + '>' +
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
    '<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> A first note.</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Its second line.</w:t></w:r></w:p></w:footnote></w:footnotes>', true],
  ["word/endnotes.xml", '<?xml version="1.0"?><w:endnotes ' + WNS + '>' +
    '<w:endnote w:id="1"><w:p><w:r><w:endnoteRef/></w:r><w:r><w:t>An end note.</w:t></w:r></w:p></w:endnote></w:endnotes>', true],
  ["word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document ' + WNS + '><w:body>' +
    '<w:p><w:r><w:t>Text</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r>' +
    '<w:r><w:t xml:space="preserve"> and more</w:t></w:r><w:r><w:endnoteReference w:id="1"/></w:r><w:r><w:footnoteReference w:id="9"/></w:r><w:r><w:t>.</w:t></w:r></w:p>' +
    '</w:body></w:document>', true]
]);
const ODT_NUM = zip([
  ["mimetype", "application/vnd.oasis.opendocument.text"],
  ["styles.xml", '<?xml version="1.0"?><office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
    'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:styles>' +
    '<style:style style:name="Title" style:family="paragraph"><style:paragraph-properties fo:text-align="center"/></style:style>' +
    '<text:list-style style:name="Numbering_20_123"><text:list-level-style-number text:level="1" style:num-format="1"/></text:list-style>' +
    '</office:styles></office:document-styles>', true],
  ["content.xml", '<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
    'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"><office:automatic-styles>' +
    '<style:style style:name="P1" style:family="paragraph" style:parent-style-name="Title"><style:text-properties fo:font-weight="bold"/></style:style>' +
    '<style:style style:name="P2" style:family="paragraph"><style:paragraph-properties fo:text-align="justify"/></style:style>' +
    '</office:automatic-styles><office:body><office:text>' +
    '<text:p text:style-name="P1">Centred</text:p><text:p text:style-name="P2">Justified</text:p>' +
    '<text:list text:style-name="Numbering_20_123"><text:list-item><text:p>one</text:p></text:list-item><text:list-item><text:p>two</text:p></text:list-item></text:list>' +
    '<text:p>between</text:p>' +
    '<text:list text:style-name="Numbering_20_123" text:continue-numbering="true"><text:list-item><text:p>three</text:p></text:list-item></text:list>' +
    '</office:text></office:body></office:document-content>', true]
]);
const RTF_LIST = "{\\rtf1\\ansi{\\stylesheet{\\s0 Normal;}{\\s1\\outlinelevel0 heading 1;}}" +
  "{\\*\\listtable{\\list\\listtemplateid1{\\listlevel\\levelnfc4\\levelstartat1{\\leveltext\\'02\\'00.;}}\\listid5}}" +
  "{\\*\\listoverridetable{\\listoverride\\listid5\\ls1}}" +
  "\\pard\\s1\\qc Title\\par\\pard\\qj Body \\i it\\i0\\par" +
  "\\pard\\ls1\\ilvl0{\\listtext a.\\tab}One\\par\\pard\\ls1\\ilvl0{\\listtext b.\\tab}Two\\par" +
  "\\pard{\\pntext 1.\\tab}Old style\\par}";
const CH = chromium();

test("Chromium: every format converts, reads back as Writer's bundle", { skip: CH ? false : "Playwright / Chromium not installed", timeout: 90000 }, async () => {
  const srv = http.createServer((req, rsp) => {
    const p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/blank.html") { rsp.writeHead(200, { "Content-Type": "text/html" }); return rsp.end("<!doctype html><meta charset=utf-8><title>t</title>"); }
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
    rsp.writeHead(200, { "Content-Type": "application/javascript" });
    fs.createReadStream(f).pipe(rsp);
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + srv.address().port + "/";
  const browser = await CH.pw.chromium.launch({ executablePath: CH.exe, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "blank.html");
    for (const d of CV.deps.concat(["writer/convert.js"])) await page.addScriptTag({ url: base + d });
    assert.equal(await page.evaluate(() => !!(window.OrosConvert && OrosConvert.writer && window.WriterIO && window.OrosBundle)), true);
    const inputs = [
      ["Report.docx", DOCX], ["Odt file.odt", ODT], ["Notes.md", Buffer.from(MD)], ["Page.htm", Buffer.from(HTML)],
      ["plain.txt", Buffer.from("Short\n\nΚείμενο & more")], ["old.rtf", Buffer.from("{\\rtf1\\ansi Hello \\b there\\b0\\par}")],
      ["empty.txt", Buffer.from("")], ["broken.docx", Buffer.from("not a zip")],
      ["Agreement.pdf", PDF], ["greek.docx", DOCX_EL], ["numbers.odt", ODT_NUM], ["list.rtf", Buffer.from(RTF_LIST)],
      ["scan.pdf", pdf([])], ["notes.docx", DOCX_NOTES]
    ];
    const out = await page.evaluate(async (inputs) => {
      const res = {};
      for (const [name, b64] of inputs) {
        const bin = atob(b64), u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        try {
          const steps = [];
          const r = await OrosConvert.writer.convert(new File([u], name), { lang: name === "plain.txt" ? "el" : "en", onProgress: (v) => steps.push(v) });
          const b = await OrosBundle.read(new Uint8Array(await r.blob.arrayBuffer()), { mime: "application/x-oros-doc" });
          res[name] = { name: r.name, type: r.blob.type, warnings: r.warnings, steps, content: b.content, meta: b.meta,
            media: Object.keys(b.media), problems: b.warnings || [] };
        } catch (e) { res[name] = { code: e.code, message: e.message }; }
      }
      return res;
    }, inputs.map(([n, b]) => [n, b.toString("base64")]));

    const dx = out["Report.docx"];
    assert.equal(dx.name, "Report.orosdoc");
    assert.equal(dx.type, "application/x-oros-doc");
    assert.deepEqual(dx.steps, [0, 0.2, 0.5, 1]);
    assert.equal(dx.content.orosWriter, true);
    assert.equal(dx.content.doc.title, "Report");
    assert.equal(dx.content.doc.pageSize, "a4");
    const h = dx.content.doc.html;
    assert.match(h, /^<h1>Report<\/h1><p>Plain <strong>bold<\/strong><em> ιταλικά<\/em><ins class="tc" data-tc="tc[a-z0-9]+" data-au="Chris" data-ts="\d+"> added<\/ins><\/p>/);
    assert.match(h, /<ol><li>first<\/li><li>second<\/li><\/ol><table [^>]*><tbody><tr><td [^>]*><p>A1<\/p><\/td>/);
    assert.equal(dx.meta.generator, "orOS Writer");
    assert.equal(dx.warnings.length, 1, "the DOCX picture is not kept");
    assert.match(dx.warnings[0], /^1 picture/);

    const od = out["Odt file.odt"];
    assert.equal(od.name, "Odt file.orosdoc");
    assert.equal(od.content.doc.html, "<h1>Odt title</h1><p>Some <strong>strong</strong> words</p><ul><li>one</li></ul>");
    assert.equal(od.warnings.length, 1);

    const md = out["Notes.md"];
    assert.equal(md.content.doc.title, "Notes");
    assert.equal(md.media.length, 1, "the picture is stored as media");
    assert.match(md.content.doc.html, /<strong>bold<\/strong> and a note<sup class="fn-ref" data-fn="(fn[a-z0-9]+)">1<\/sup>/);
    assert.equal(md.content.doc.footnotes.length, 1);
    assert.equal(md.content.doc.footnotes[0].text, "The note.");
    assert.ok(md.content.doc.html.indexOf('src="media/' + md.media[0] + '"') > 0);
    assert.deepEqual(md.warnings, []);

    const ht = out["Page.htm"];
    assert.equal(ht.content.doc.title, "Page");
    assert.doesNotMatch(JSON.stringify(ht.content), /alert|onclick/);
    assert.equal(ht.media.length, 1);
    assert.equal(ht.warnings.length, 1, "the web picture stays a link");

    assert.equal(out["plain.txt"].content.doc.html, "<p>Short</p><p>Κείμενο &amp; more</p>");
    assert.equal(out["plain.txt"].meta.language, "el");
    assert.equal(out["old.rtf"].content.doc.html, "<p>Hello <strong>there</strong></p>");
    assert.match(out["old.rtf"].warnings[0], /^RTF: tables/);
    assert.deepEqual(out["empty.txt"].warnings, ["The file has no text."]);
    assert.equal(out["broken.docx"].code, "bad");
    const pd = out["Agreement.pdf"];
    assert.equal(pd.name, "Agreement.orosdoc");
    assert.equal(pd.content.doc.title, "Agreement");
    assert.equal(pd.content.doc.html, "<h1>Agreement</h1><p>The parties agree to the <strong>terms</strong> below.</p><ol><li>First term.</li><li>Second term.</li></ol>",
      "the page number is left out");
    assert.match(pd.warnings[0], /^PDF:/);
    assert.equal(out["scan.pdf"].code, "bad", "no text layer");

    assert.equal(out["greek.docx"].content.doc.html,
      '<h1 style="text-align:center">Σύμβαση</h1><p style="text-align:justify">Κείμενο <strong>έντονο</strong></p>' +
      '<p style="text-align:right">Δεξιά</p><ol start="3" style="list-style-type:lower-alpha"><li>γ</li></ol><p>μέση</p>' +
      '<ol start="4" style="list-style-type:lower-alpha"><li>δ</li></ol>');
    // Word's notes (LY-NT): a mark per note, the text in footnotes; a mark without a note is left out
    const nd = out["notes.docx"].content.doc;
    assert.match(nd.html, /^<p>Text<sup class="fn-ref" data-fn="(fn[a-z0-9]+)">[^<]*<\/sup> and more<sup class="fn-ref" data-fn="(fn[a-z0-9]+)">[^<]*<\/sup>\.<\/p>$/);
    assert.deepEqual(nd.footnotes.map((f) => f.text), ["A first note.\nIts second line.", "An end note."]);
    const ids = [...nd.html.matchAll(/data-fn="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(ids, nd.footnotes.map((f) => f.id));
    assert.equal(out["numbers.odt"].content.doc.html,
      '<p style="text-align:center"><strong>Centred</strong></p><p style="text-align:justify">Justified</p>' +
      '<ol><li>one</li><li>two</li></ol><p>between</p><ol start="3"><li>three</li></ol>');
    assert.equal(out["list.rtf"].content.doc.html,
      '<h1 style="text-align:center">Title</h1><p style="text-align:justify">Body <em>it</em></p>' +
      '<ol style="list-style-type:lower-alpha"><li>One</li><li>Two</li></ol><ol><li>Old style</li></ol>');

    Object.keys(out).forEach((k) => assert.deepEqual(out[k].problems || [], [], k + ": bundle reads clean"));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    srv.close();
  }
});
