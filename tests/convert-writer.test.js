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
  assert.deepEqual(CV.from, [".docx", ".odt", ".rtf", ".html", ".htm", ".md", ".markdown", ".txt"]);
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
  const e1 = await CV.convert({ name: "a.pdf", size: 10 }).catch((e) => e);
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
  assert.equal(r.html, "<p>Hello bold</p><p>Cafι Γε</p>", "\\ansicpg1253: byte 0xE9 is ι");
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
    return fs.existsSync(exe) ? { pw, exe } : null;
  } catch (e) { return null; }
}
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
      ["empty.txt", Buffer.from("")], ["broken.docx", Buffer.from("not a zip")]
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
    assert.equal(out["old.rtf"].content.doc.html, "<p>Hello there</p>");
    assert.match(out["old.rtf"].warnings[0], /^RTF/);
    assert.deepEqual(out["empty.txt"].warnings, ["The file has no text."]);
    assert.equal(out["broken.docx"].code, "bad");
    Object.keys(out).forEach((k) => assert.deepEqual(out[k].problems || [], [], k + ": bundle reads clean"));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    srv.close();
  }
});
