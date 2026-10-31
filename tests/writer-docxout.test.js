// Writer's Word export (writer/docxout.js → WriterDocxOut, DOCX v2) and
// the round trip import → export → import through writer/io.js.
// Node: the wiring. Chromium (when Playwright is installed): a document
// with headings, alignment, lists (start, letters, Roman, Greek,
// nesting), a picture and a table goes out as .docx and comes back
// the same; a second round changes nothing.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = require(path.join(ROOT, "writer/docxout.js"));

// A red 2×2 PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DAwMDAwMDAAAD//wMAD/sB/1Y3o3EAAAAASUVORK5CYII=";

test("wiring: one Word writer, loaded after io.js, precached", () => {
  const W = read("writer/writer.js");
  ["dxRun", "dxRuns", "dxPara", "dxBlocks"].forEach((n) => assert.ok(W.indexOf("function " + n + "(") === -1, n + " lives in docxout.js"));
  assert.match(W, /D\.build\(c, \{/);
  const html = read("writer/index.html");
  assert.ok(html.indexOf('src="io.js') < html.indexOf('src="docxout.js') && html.indexOf('src="docxout.js') < html.indexOf('src="writer.js'));
  assert.match(read("sw.js"), /"writer\/docxout\.js"/);
  const src = read("writer/docxout.js");
  assert.doesNotMatch(src, /innerHTML|eval\(|new Function|TargetMode/);
  assert.equal(typeof D.build, "function");
  assert.equal(D.run("a<b", { b: true }), '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">a&lt;b</w:t></w:r>');
  assert.equal(D.para("", { jc: "center" }), '<w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p>');
});

function chromium() {
  try {
    const exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
    const pw = require("/opt/node22/lib/node_modules/playwright");
    if (fs.existsSync(exe)) return { pw, exe };
    const own = pw.chromium.executablePath();
    return own && fs.existsSync(own) ? { pw, exe: own } : null;
  } catch (e) { return null; }
}
const CH = chromium();

const DOC = '<h1 style="text-align:center">Σύμβαση</h1>' +
  '<p style="text-align:justify">Text with <strong>bold</strong>, <em>italic</em>, <u>under</u> and <del>gone</del>.</p>' +
  '<p style="text-align:right">Athens</p>' +
  '<ol start="3"><li>three<ol style="list-style-type:lower-alpha"><li>a sub</li><li>b sub</li></ol></li><li>four</li></ol>' +
  '<p>between</p>' +
  '<ol style="list-style-type:lower-greek"><li>alpha</li><li>beta</li></ol>' +
  '<ol style="list-style-type:upper-roman"><li>one</li></ol>' +
  '<ul><li>dot<ul><li>inner</li></ul></li></ul>' +
  '<p style="text-align:center"><img src="data:image/png;base64,' + PNG + '" alt="red" style="width:120px;max-width:100%"></p>' +
  '<figure style="margin:1em 0;text-align:center"><img src="data:image/png;base64,' + PNG + '" alt="" style="width:40px;max-width:100%"><figcaption style="font-size:0.85em;color:var(--text-dim)">A caption</figcaption></figure>' +
  '<blockquote>Quoted.</blockquote>' +
  '<table><tr><td>a</td><td>b</td></tr></table>';

test("Chromium: export → import keeps headings, alignment, lists and pictures; a second round is the same", { skip: CH ? false : "Playwright / Chromium not installed", timeout: 90000 }, async () => {
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
    for (const d of ["bundle.js", "atelier/zip.js", "writer/track.js", "writer/io.js", "writer/docxout.js"]) await page.addScriptTag({ url: base + d });
    const r = await page.evaluate(async (html) => {
      async function round(h) {
        const box = document.createElement("div");
        box.innerHTML = h;
        const files = await WriterDocxOut.build(box, { title: "T", page: { w: 210, h: 297 }, margins: { top: 20, right: 20, bottom: 20, left: 20 } });
        const zip = AtelierZip.write(files);
        const res = await WriterIO.parseZipBuf(zip.buffer, "docx");
        const dec = new TextDecoder();
        return { names: files.map((f) => f.name), docXml: dec.decode(files.find((f) => f.name === "word/document.xml").data),
                 numXml: dec.decode((files.find((f) => f.name === "word/numbering.xml") || { data: new Uint8Array() }).data),
                 html: WriterIO.prepareImport(res).html };
      }
      const a = await round(html);
      const b = await round(a.html);
      return { a, b };
    }, DOC);
    assert.deepEqual(errors, []);
    const { a, b } = r;
    assert.ok(a.names.includes("word/media/image1.png"), "the picture is a real part");
    assert.ok(a.names.includes("word/numbering.xml") && a.names.includes("word/_rels/document.xml.rels"));
    assert.match(a.docXml, /<w:jc w:val="both"\/>/);
    assert.match(a.docXml, /<a:blip r:embed="rId1"\/>/);
    assert.match(a.docXml, /<wp:extent cx="1143000" cy="1143000"\/>/, "120 px = 1143000 EMU, square");
    assert.match(a.numXml, /<w:start w:val="3"\/><w:numFmt w:val="decimal"\/>/);
    assert.match(a.numXml, /w:format="α, β, γ, \.\.\."/);
    const h = a.html;
    assert.match(h, /<h1 style="text-align:center">Σύμβαση<\/h1>/);
    assert.match(h, /<p style="text-align:justify">Text with <strong>bold<\/strong>, <em>italic<\/em>, <u>under<\/u> and <del>gone<\/del>\.<\/p>/);
    assert.match(h, /<p style="text-align:right">Athens<\/p>/);
    assert.match(h, /<ol start="3"><li>three<ol style="list-style-type:lower-alpha"><li>a sub<\/li><li>b sub<\/li><\/ol><\/li><li>four<\/li><\/ol>/);
    assert.match(h, /<ol style="list-style-type:lower-greek"><li>alpha<\/li><li>beta<\/li><\/ol>/);
    assert.match(h, /<ol style="list-style-type:upper-roman"><li>one<\/li><\/ol>/);
    assert.match(h, /<ul><li>dot<ul><li>inner<\/li><\/ul><\/li><\/ul>/);
    assert.match(h, /<p style="text-align:center"><img src="data:image\/png;base64,[^"]+" alt="red" style="width:120px;max-width:100%"><\/p>/);
    assert.match(h, /<figure style="margin:1em 0;text-align:center"><img src="data:image\/png;base64,[^"]+" alt="" style="width:40px;max-width:100%"><figcaption style="font-size:0.85em;color:var\(--text-dim\)">A caption<\/figcaption><\/figure>/);
    assert.equal((a.docXml.match(/<a:blip /g) || []).length, 2, "the same picture twice: one part, two drawings");
    assert.ok(!a.names.includes("word/media/image2.png"));
    assert.match(h, /<blockquote>Quoted\.<\/blockquote>/);
    assert.match(h, /<td[^>]*><p>a<\/p><\/td>/);
    assert.equal(b.html, a.html, "a second round changes nothing");
  } finally {
    await browser.close();
    srv.close();
  }
});
