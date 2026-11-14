// Layout EPUB export, reflowable (LY-EPUB, wave L7 E2): reading order,
// chapters, headings → nav, print page numbers → page-list, pictures
// with alt text and captions, styles → CSS, fonts (open ones as they
// are, the user's own obfuscated), Publishing metadata and the e-book
// ISBN, accessibility metadata; and the on-device check (layout/
// epubcheck.js) on good and broken books. Synthetic books only
// (tests/layout-ebooks.js); CI also runs the official EPUBCheck on them.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require("./layout-ebooks.js");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const E = require(path.join(ROOT, "layout/epub.js"));
const C = require(path.join(ROOT, "layout/epubcheck.js"));
const Z = require(path.join(ROOT, "atelier/zip.js"));

async function unzip(bytes) {
  const z = Z.open(bytes), out = {};
  for (const n of z.names) out[n] = await z.bytes(n);
  out.names = z.names;
  out.text = (n) => new TextDecoder().decode(out[n]);
  return out;
}
const codes = (r) => r.errors.map((e) => e.c);

test("a novel: files, reading order, chapters, headings and the page-list", async () => {
  const r = await B.epub(B.novel());
  const f = await unzip(r.bytes);
  assert.equal(f.names[0], "mimetype");
  assert.equal(f.text("mimetype"), "application/epub+zip");
  assert.equal(r.report.chapters, 5, "colophon, part, three chapters");
  const all = f.names.filter((n) => /text\/c\d+\.xhtml$/.test(n)).map((n) => f.text(n)).join("\n");
  // the contents page is replaced by the nav; master page numbers are left out
  assert.ok(!all.includes("Μέρος πρώτο\t3") && !/Μέρος πρώτο\s*3/.test(all));
  assert.ok(all.indexOf("Η αρχή") < all.indexOf("Το λιμάνι") && all.indexOf("Το λιμάνι") < all.indexOf("Το νησί") && all.indexOf("Το νησί") < all.indexOf("Το τέλος"), "reading order");
  // the threaded story is read once
  assert.equal(all.split("κοίταξε τη").length, 2);
  assert.match(all, /<h1 id="h1" class="ps-hspart">/);
  assert.match(all, /<h2 id="h1" class="ps-chap">/);
  assert.match(all, /<h3 id="h2" class="ps-sub">Το λιμάνι<\/h3>/);
  assert.match(all, /<span class="cs-name">Μαρία<\/span>/);
  assert.match(all, /χαμογέλασε<sup>1<\/sup>/);
  assert.match(all, /<em>Στο λιμάνι είχε <\/em><strong>πολύ<\/strong> κόσμο &amp; φασαρία &lt;όπως πάντα&gt;\.<br\/>Μια νέα γραμμή\./);
  assert.match(all, /<ul class="ps-li">\n<li>ψωμί<\/li>\n<li>ελιές<\/li>\n<\/ul>/);
  // the picture: after the text above it, its caption, the ornament decorative
  assert.match(all, /Το νησί φάνηκε στον ορίζοντα\.<\/p>\n<figure class="fig"><img src="..\/images\/it-pic.png" alt="Μια βάρκα στο μόλο, το πρωί\."[^>]*\/><figcaption><span class="ps-pcap">Η βάρκα του παππού\.<\/span><\/figcaption><\/figure>/);
  assert.match(all, /<img src="..\/images\/it-orn.png" alt="" role="presentation"/);
  assert.equal(all.split("Η βάρκα του παππού").length, 2, "the caption is not repeated as text");
  // page-list: the print pages that go out (the contents page and the empty page do not)
  const nav = f.text("EPUB/nav.xhtml");
  const pages = [...nav.matchAll(/#pg(\d+)">(\d+)</g)].map((m) => m[2]);
  assert.deepEqual(pages, ["1", "3", "4", "5", "6", "7", "8"]);
  assert.match(all, /<span epub:type="pagebreak" role="doc-pagebreak" id="pg5" aria-label="5"><\/span>/);
  // a page that starts inside a paragraph is marked inside it
  assert.match(all, /μόλο\. [^<]*<span epub:type="pagebreak" role="doc-pagebreak" id="pg5"|<span epub:type="pagebreak"[^>]*id="pg5"[^>]*><\/span>[^<]/);
  // nested contents: part → chapters → section
  assert.match(nav, /<ol><li><a href="text\/c002.xhtml#h1">Μέρος πρώτο<\/a><ol><li><a href="text\/c003.xhtml#h1">Η αρχή<\/a><ol><li><a href="text\/c003.xhtml#h2">Το λιμάνι<\/a><\/li><\/ol><\/li><li>/);
  assert.match(nav, /epub:type="landmarks"/);
  assert.match(nav, /<a epub:type="bodymatter" href="text\/c002.xhtml">/);
  assert.equal(r.report.shapes, 1);
  assert.equal(r.report.overset, 0);
  assert.deepEqual(r.report.noAlt, []);
  const chk = await C.check(r.bytes, Z);
  assert.deepEqual(chk.errors, []);
  assert.deepEqual(chk.warnings, []);
});

test("metadata from Publishing: the e-book ISBN, people with roles, series, the print ISBN line", async () => {
  const r = await B.epub(B.novel());
  const f = await unzip(r.bytes), opf = f.text("EPUB/package.opf");
  assert.match(opf, /<dc:identifier id="uid">urn:isbn:9786185321017<\/dc:identifier>/);
  assert.match(opf, /<dc:title id="title">Η θάλασσα του Βορρά<\/dc:title>/);
  assert.match(opf, /<dc:title id="subtitle">Μυθιστόρημα<\/dc:title>\n<meta refines="#subtitle" property="title-type">subtitle<\/meta>/);
  assert.match(opf, /<dc:language>el<\/dc:language>/);
  assert.match(opf, /<dc:creator id="p1">Άννα Παπαδοπούλου<\/dc:creator>\n<meta refines="#p1" property="role" scheme="marc:relators">aut<\/meta>/);
  assert.match(opf, /<dc:contributor id="p2">Νίκος Γεωργίου<\/dc:contributor>\n<meta refines="#p2" property="role" scheme="marc:relators">trl<\/meta>/);
  assert.match(opf, /marc:relators">ill</);
  assert.match(opf, /<dc:publisher>Εκδόσεις Δοκιμής<\/dc:publisher>/);
  assert.match(opf, /<dc:description>Ένα καλοκαίρι στο νησί, μια βάρκα &amp; ένα μυστικό &lt;παλιό&gt;\.<\/dc:description>/);
  assert.deepEqual([...opf.matchAll(/<dc:subject>([^<]+)</g)].map((m) => m[1]), ["θάλασσα", "νησί", "καλοκαίρι"]);
  assert.match(opf, /<meta property="belongs-to-collection" id="series">Βόρειες ιστορίες<\/meta>[\s\S]*group-position">2</);
  assert.match(opf, /<dc:source>urn:isbn:9786185321000<\/dc:source>\n<meta property="pageBreakSource">urn:isbn:9786185321000<\/meta>/);
  assert.match(opf, /<meta property="dcterms:modified">2026-11-13T08:00:00Z<\/meta>/);
  assert.match(opf, /<item id="cover-image" href="images\/cover.png" media-type="image\/png" properties="cover-image"\/>/);
  assert.match(opf, /<itemref idref="cover"\/>\n<itemref idref="nav" linear="no"\/>/);
  // accessibility: every picture has alt text or is decorative
  for (const f2 of ["tableOfContents", "readingOrder", "structuralNavigation", "pageNavigation", "alternativeText", "displayTransformability"]) {
    assert.match(opf, new RegExp('accessibilityFeature">' + f2 + "<"));
  }
  assert.match(opf, /accessMode">visual</);
  assert.match(opf, /accessModeSufficient">textual</);
  assert.match(opf, /dcterms:conformsTo">EPUB Accessibility 1.1 - WCAG 2.1 Level AA</);
  // the colophon: the e-book ISBN in the print one's shape, then the print edition's line
  const col = f.text("EPUB/text/c001.xhtml");
  assert.match(col, /ISBN 978-618-5321-01-7<\/p>\n<p class="ps-base">ISBN έντυπης έκδοσης: 978-618-5321-00-0<\/p>/);
});

test("no Publishing title: a stable urn:uuid, the document's language; a picture without alt text", async () => {
  const d = B.novel();
  d.items.find((i) => i.id === "it-pic").ext = {};
  const a = await B.epub(d, { data: null, cover: null });
  const b = await B.epub(d, { data: null, cover: null });
  const opf = (await unzip(a.bytes)).text("EPUB/package.opf");
  const uid = /<dc:identifier id="uid">(urn:uuid:[0-9a-f-]{36})</.exec(opf);
  assert.ok(uid, "urn:uuid");
  assert.equal(a.report.uid, b.report.uid, "the same document gives the same id");
  assert.match(opf, /<dc:language>el</);
  assert.ok(!opf.includes("dc:source"), "no print ISBN, no page break source");
  assert.ok(!opf.includes("conformsTo"), "no conformance claim with a picture lacking alt text");
  assert.match(opf, /accessModeSufficient">textual,visual</);
  assert.equal(a.report.noAlt.length, 1);
  assert.equal(a.report.noAlt[0].item, "it-pic");
  const chk = await C.check(a.bytes, Z);
  assert.deepEqual(codes(chk), []);
  assert.deepEqual(chk.warnings.map((w) => w.c).sort(), ["no-alt", "no-cover"]);
});

test("styles become CSS; no fonts inside on request; no page-list on request", async () => {
  const r = await B.epub(B.novel());
  const f = await unzip(r.bytes), css = f.text("EPUB/css/book.css");
  assert.match(css, /@font-face \{ font-family: "Noto Serif"; font-weight: bold; font-style: normal; src: url\(..\/fonts\/serif-b.ttf\); \}/);
  assert.match(css, /\.ps-txt \{ font-family: "Noto Serif", serif; [^}]*text-align: justify; [^}]*text-indent: 1.091em; [^}]*hyphens: auto;/);
  assert.match(css, /\.ps-chap \{[^}]*font-size: 1.455em;[^}]*font-weight: bold;[^}]*break-after: avoid;/);
  assert.match(css, /\.cs-name \{ letter-spacing: 0.05em; text-transform: uppercase; \}/);
  assert.match(css, /\.cs-sea \{ color: #14508c; \}/);
  assert.ok(!/\.ps-[a-z]+ \{[^}]*color: #000000/.test(css), "black stays the reader's colour");
  assert.ok(f.names.some((n) => /^EPUB\/fonts\/serif-r\.ttf$/.test(n)));
  assert.deepEqual(r.report.fonts.map((x) => x.obf), r.report.fonts.map(() => 0), "built-in fonts are open licence");
  const n = await B.epub(B.novel(), { prof: { nf: 1, npl: 1 } });
  const g = await unzip(n.bytes);
  assert.ok(!g.names.some((x) => /fonts\//.test(x)));
  assert.ok(!g.text("EPUB/css/book.css").includes("@font-face"));
  assert.ok(!g.text("EPUB/nav.xhtml").includes("page-list"));
  assert.ok(!g.text("EPUB/package.opf").includes("pageNavigation"));
  assert.deepEqual(codes(await C.check(n.bytes, Z)), []);
});

test("a font file of the user's is obfuscated (IDPF) and listed in encryption.xml", async () => {
  assert.ok(T.registerFamily("uf_0123456789abcdef", { name: "Own Face", urls: { r: ["x"] }, fallback: "serif" }));
  const buf = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile("serif-r")));
  T.register("uf_0123456789abcdef-r", buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const d = B.novel();
  Object.assign(d.pstyles.find((p) => p.id === "ps-pcap"), { i: 0, ext: { fam: "uf_0123456789abcdef" } });
  const r = await B.epub(M.normDoc(d));
  const f = await unzip(r.bytes);
  const name = "EPUB/fonts/uf_0123456789abcdef-r.ttf";
  assert.ok(f[name], "embedded");
  const key = await B.sha1(new TextEncoder().encode("urn:isbn:9786185321017"));
  assert.deepEqual(Buffer.from(E.obfuscate(f[name], key)), buf, "XOR with the SHA-1 of the id gives the font back");
  assert.notDeepEqual(Buffer.from(f[name].subarray(0, 64)), buf.subarray(0, 64));
  assert.match(f.text("META-INF/encryption.xml"), /Algorithm="http:\/\/www.idpf.org\/2008\/embedding"\/><enc:CipherData><enc:CipherReference URI="EPUB\/fonts\/uf_0123456789abcdef-r.ttf"\/>/);
  assert.match(f.text("EPUB/css/book.css"), /@font-face \{ font-family: "Own Face";/);
  assert.equal(r.report.fonts.find((x) => /^uf_/.test(x.key)).obf, 1);
  assert.deepEqual(codes(await C.check(r.bytes, Z)), []);
});

test("headings: a nested contents never skips a closing tag", () => {
  const ol = E.tocOl([{ t: "A", lvl: 1, file: 1, id: "a" }, { t: "B", lvl: 3, file: 1, id: "b" }, { t: "C", lvl: 2, file: 2, id: "c" }, { t: "D", lvl: 1, file: 3, id: "d" }], (h) => "#" + h.id);
  assert.equal(ol, '<ol><li><a href="#a">A</a><ol><li><a href="#b">B</a></li><li><a href="#c">C</a></li></ol></li><li><a href="#d">D</a></li></ol>');
  assert.doesNotThrow(() => C.parseXml("<nav>" + ol + "</nav>"));
});

// ---------- the on-device check on broken books ----------
async function broken(edit) {
  const r = await B.epub(B.novel());
  const z = Z.open(r.bytes), files = [];
  for (const n of z.names) files.push({ name: n, data: await z.bytes(n) });
  edit(files);
  return C.check(Z.write(files), Z);
}
const td = (b) => new TextDecoder().decode(b);
function swap(files, name, fn) { const f = files.find((x) => x.name === name); f.data = fn(td(f.data)); }

test("the check finds what EPUBCheck would", async () => {
  assert.ok(codes(await broken((fs2) => fs2.push(fs2.shift()))).includes("mime"), "mimetype not first");
  assert.ok(codes(await broken((fs2) => { const i = fs2.findIndex((x) => x.name === "EPUB/images/it-pic.png"); fs2.splice(i, 1); })).includes("man-missing"));
  assert.ok(codes(await broken((fs2) => swap(fs2, "EPUB/text/c003.xhtml", (s) => s.replace("</h3>", "</h2>")))).includes("xml"));
  assert.ok(codes(await broken((fs2) => swap(fs2, "EPUB/nav.xhtml", (s) => s.replace("c003.xhtml#h2", "c003.xhtml#nope")))).includes("frag"));
  assert.ok(codes(await broken((fs2) => swap(fs2, "EPUB/package.opf", (s) => s.replace("urn:isbn:9786185321017", "urn:isbn:9786185321012")))).includes("isbn"));
  const noAlt = await broken((fs2) => swap(fs2, "EPUB/text/c004.xhtml", (s) => s.replace(' alt=""', "").replace(' role="presentation"', "")));
  assert.deepEqual(codes(noAlt), [], "EPUBCheck accepts it too");
  assert.ok(noAlt.warnings.some((w) => w.c === "no-alt"));
  assert.ok(codes(await broken((fs2) => swap(fs2, "EPUB/text/c003.xhtml", (s) => s.replace('id="h2"', 'id="h1"')))).includes("id-dup"));
  assert.ok(codes(await broken((fs2) => swap(fs2, "EPUB/package.opf", (s) => s.replace(/<meta property="dcterms:modified">[^<]+<\/meta>/, "")))).includes("meta-mod"));
  assert.ok(codes(await broken((fs2) => swap(fs2, "EPUB/package.opf", (s) => s.replace('media-type="text/css"', 'media-type="text/plain"')))).includes("man-type"));
  assert.ok(codes(await broken((fs2) => swap(fs2, "EPUB/text/c001.xhtml", (s) => s.replace("</body>", '<img src="https://example.com/a.png" alt="x"/></body>')))).includes("remote"));
  assert.ok(codes(await broken((fs2) => swap(fs2, "EPUB/nav.xhtml", (s) => s.replace(/<nav epub:type="toc"[\s\S]*?<\/nav>/, "<nav epub:type=\"toc\" id=\"toc\"><h1>x</h1><ol></ol></nav>")))).includes("nav-toc"));
  const extra = await broken((fs2) => fs2.push({ name: "EPUB/stray.txt", data: "x" }));
  assert.deepEqual(codes(extra), []);
  assert.ok(extra.warnings.some((w) => w.c === "man-extra"));
  assert.deepEqual(codes(await C.check(new Uint8Array([1, 2, 3]), Z)), ["zip"]);
});

test("the XML reader: well formed or an error", () => {
  const x = C.parseXml('<?xml version="1.0"?>\n<!DOCTYPE html>\n<a b="1 &amp; 2"><c/>t&#233;x<![CDATA[<k>]]></a>');
  assert.equal(x.name, "a");
  assert.equal(x.attrs.b, "1 & 2");
  assert.equal(x.kids[1], "téx");
  for (const bad of ["<a><b></a></b>", "<a b=1/>", "<a b='1' b='2'/>", "<a>&nbsp;</a>", "<a>&</a>", "<a/><b/>", "<a>", "x<a/>"]) {
    assert.throws(() => C.parseXml(bad), /xml:/, bad);
  }
  assert.deepEqual(C.imgSize(B.png(40, 30, [0, 0, 0])), { w: 40, h: 30 });
  assert.equal(C.resolve("EPUB/text/c1.xhtml", "../images/a.png"), "EPUB/images/a.png");
});

test("Publishing keeps one EPUB-ready row per format of the title, with a preview path only under Layout/EPUB", () => {
  const P = require(path.join(ROOT, "publish/core.js"));
  const fids = { "f-eb": 1, "f-eb2": 1 };
  const out = P.cleanEps([
    { f: "f-eb2", d: "2026-11-13", n: 1234, p: "/internal/Layout/EPUB/book.epub" },
    { f: "f-eb", d: "2026-11-12", n: -5, p: "/internal/Diary/x.epub" },
    { f: "f-eb", d: "2026-11-13", n: 9 },
    { f: "f-gone", d: "2026-11-13", n: 1 },
    { f: "f-eb2", d: "bad", n: 1 },
    null, "x"
  ], fids);
  assert.deepEqual(out, [{ f: "f-eb", d: "2026-11-12", n: 0 }, { f: "f-eb2", d: "2026-11-13", n: 1234, p: "/internal/Layout/EPUB/book.epub" }]);
  assert.deepEqual(P.cleanEps("nope", fids), []);
  for (const bad of ["/internal/Layout/EPUB/../Passwords/a.epub", "/internal/Layout/EPUB/a/b.epub", "/internal/Layout/EPUB/a.pdf"]) assert.equal(P.EPS_RE.test(bad), false, bad);
  const lib = fs.readFileSync(path.join(ROOT, "library/app.js"), "utf8");
  assert.match(lib, /PREVIEW_RE = \/\^\\\/internal\\\/Layout\\\/EPUB\\\/\[\^\/\]\{1,200\}\\\.epub\$\//);
});
