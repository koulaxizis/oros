// Layout N6 (LY-N6): a tagged, accessible PDF (PDF/UA-1). pdf.js marks
// every text line of a paragraph or note and every described picture
// with an MCID and everything else as an /Artifact; designkit/tagpdf.js
// builds the structure tree (reading order, headings, notes, contents,
// figures, links), ParentTree, MarkInfo, /Lang, DisplayDocTitle and the
// pdfuaid XMP; PDF/X keeps it; strings in EN/EL/DE and the wiring.
// Synthetic documents only.
// Run: node --test tests/layout-n6.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const P = require(path.join(ROOT, "designkit/pdf.js"));
const TG = require(path.join(ROOT, "designkit/tagpdf.js"));
const X = require(path.join(ROOT, "designkit/pdfx.js"));
const O = require(path.join(ROOT, "layout/outprof.js"));
const PDFLib = require(path.join(ROOT, "vendor/pdf-lib/pdf-lib.min.js"));
T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});
global.window = global.window || global;
const { jsPDF } = require(path.join(ROOT, "vendor/jspdf.umd.min.js"));
const PNG = new Uint8Array(fs.readFileSync(path.join(ROOT, "icons/icon-192.png")));

// every stream of a PDF, inflated where it can be
function streams(bytes) {
  const buf = Buffer.from(bytes), out = [];
  let at = 0;
  for (;;) {
    const s = buf.indexOf("stream", at);
    if (s < 0) break;
    const e = buf.indexOf("endstream", s + 6);
    if (e < 0) break;
    let a = s + 6;
    if (buf[a] === 13) a++;
    if (buf[a] === 10) a++;
    try { out.push(zlib.inflateSync(buf.subarray(a, e)).toString("latin1")); } catch (x) { out.push(buf.subarray(a, e).toString("latin1")); }
    at = e + 9;
  }
  return out;
}

// contents, a chapter with a footnote and a web link, a decorative
// rule, a described and a decorative picture
function book() {
  const d = M.newDoc({ name: "Ο φάρος", w: 400, h: 600, pages: 3, facing: 0 }, 1);
  const pg = M.pagesInOrder(d);
  d.setup.ext = { lang: "el" };
  d.pstyles.push({ id: "ps-h2", m: 1, name: "Heading 2", base: "ps-base", size: 18 });
  d.stories.push({ id: "st-toc", m: 1, ext: { hs: "toc" }, paras: [{ ps: "ps-body", runs: [{ t: "Ο φάρος\t2" }] }] });
  d.items.push({ id: "it-toc", m: 1, t: "text", pg: pg[0].id, x: 40, y: 40, w: 320, h: 200, story: "st-toc", seq: 1, z: 1 });
  d.stories.push({ id: "st-a", m: 1, paras: [
    { ps: "ps-h2", runs: [{ t: "Ο φάρος" }] },
    { ps: "ps-body", runs: [{ t: "Το φως γύριζε πάνω από τη θάλασσα" }, { t: "*", ext: { fn: "n1", ft: "Ο φάρος του νησιού." } }, { t: " όλη τη νύχτα." }] },
    { ps: "ps-body", runs: [{ t: "Δείτε https://example.com για περισσότερα." }] }] });
  d.items.push({ id: "it-a", m: 1, t: "text", pg: pg[1].id, x: 40, y: 60, w: 320, h: 480, story: "st-a", seq: 1, z: 2 });
  d.items.push({ id: "it-bar", m: 1, t: "rect", pg: pg[1].id, x: 0, y: 0, w: 400, h: 20, fill: "sw-black", z: 3 });
  d.items.push({ id: "it-img", m: 1, t: "img", pg: pg[2].id, x: 40, y: 300, w: 100, h: 80, a: "x", iw: 192, ih: 192, ext: { alt: "Ένας   φάρος\nτη νύχτα" }, z: 4 });
  d.items.push({ id: "it-orn", m: 1, t: "img", pg: pg[2].id, x: 200, y: 300, w: 50, h: 50, a: "y", iw: 192, ih: 192, ext: { alt: "κόσμημα", deco: 1 }, z: 5 });
  return d;
}
const imgs = () => ({ "it-img": { data: PNG, fmt: "PNG", rect: { x: 0, y: 0, w: 100, h: 80 }, alias: "i1" }, "it-orn": { data: PNG, fmt: "PNG", rect: { x: 0, y: 0, w: 50, h: 50 }, alias: "i2" } });
function role(d) {
  return (sid, p) => { const st = M.story(d, sid); if (st.ext && st.ext.hs === "toc") return "TOCI"; const lv = O.level(d, st.paras[p].ps); return lv ? "H" + lv : "P"; };
}
function tagged(d) {
  const L = R.computeLayout(d), heads = O.headings(d, L);
  return P.build(d, { rgb: true, lang: "el", tagged: true }, { jsPDF, layout: L, images: imgs(), outline: heads, links: O.tocLinks(d, L, heads).concat(O.urlLinks(d, L)), role: role(d) });
}

test("plan: stories in order, footnotes after their page's paragraphs, pictures where they stand, headings from H1, contents in a TOC", () => {
  const e = (key, sid, p, r, y, extra) => Object.assign({ k: "t", key, sid, p, r, x: 40, y, w: 100, h: 10, t: key }, extra || {});
  const tag = { pages: {
    1: [e("b:0", "b", 0, "TOCI", 40), e("b:1", "b", 1, "TOCI", 60)],
    2: [e("a:0", "a", 0, "H3", 40), e("a:1", "a", 1, "P", 60), e("a:n1", "a", -1, "Note", 500, { note: 1 })],
    3: [e("a:1", "a", 1, "P", 40), { k: "f", key: "fig:x", alt: "A", x: 10, y: 200, w: 50, h: 50 }, e("a:2", "a", 2, "H5", 300), e("a:3", "a", 3, "H2", 400)]
  } };
  const pl = TG.plan(tag);
  assert.deepEqual(pl.map((u) => u.r), ["TOC", "H1", "P", "Note", "Figure", "H2", "H2"]);
  assert.deepEqual(pl[0].kids.map((u) => u.key), ["b:0", "b:1"], "contents lines in one TOC");
  assert.deepEqual(pl[2].parts, [{ n: 2, mcid: 1 }, { n: 3, mcid: 0 }], "a paragraph across two pages is one element");
  assert.equal(pl[4].alt, "A");
  assert.deepEqual(TG.plan({ pages: {} }), []);
  assert.deepEqual(TG.plan(null), []);
});

test("pdf.js: every line and described picture is marked content, the rest artifacts; untagged unchanged", () => {
  const d = book(), pdf = tagged(d), tag = pdf.orosTag;
  const all = [].concat(...Object.values(tag.pages));
  assert.ok(all.length > 5);
  assert.ok(all.every((x) => typeof x.key === "string" && x.mcid >= 0));
  assert.deepEqual(Object.keys(tag.pages).sort(), ["1", "2", "3"]);
  const fig = all.filter((x) => x.k === "f");
  assert.equal(fig.length, 1, "the decorative picture is not a figure");
  assert.equal(fig[0].alt, "Ένας φάρος τη νύχτα");
  assert.ok(all.some((x) => x.r === "Note" && x.note), "the footnote");
  assert.ok(all.some((x) => x.r === "TOCI"));
  const txt = streams(pdf.output("arraybuffer")).join("\n");
  // every painting and text operator sits inside marked content
  let depth = 0, bad = 0;
  txt.split("\n").forEach((ln) => {
    if (/ BDC$/.test(ln) || /^\/Artifact BMC$/.test(ln)) depth++;
    else if (ln === "EMC") depth--;
    else if (/(Tj|TJ)$/.test(ln) || /^\/I\d+ Do$|^\/[A-Za-z0-9]+ Do$/.test(ln) || /^(f|f\*|S|B|B\*|b|b\*)$/.test(ln)) { if (depth <= 0) bad++; }
  });
  assert.equal(depth, 0, "balanced");
  assert.equal(bad, 0, "nothing painted outside marked content");
  const plain = streams(P.build(d, { rgb: true }, { jsPDF, layout: R.computeLayout(d), images: imgs() }).output("arraybuffer")).join("\n");
  assert.ok(!/BDC|BMC|EMC/.test(plain), "not tagged: no marked content");
});

test("tagpdf.make: structure tree, ParentTree, figures, notes, links, MarkInfo, /Lang, title, XMP", async () => {
  const d = book(), pdf = tagged(d);
  const r = await TG.make(PDFLib, new Uint8Array(pdf.output("arraybuffer")), pdf.orosTag, { title: d.name, lang: "el" });
  assert.equal(r.figures, 1); assert.equal(r.notes, 1); assert.equal(r.links, 2);
  const doc = await PDFLib.PDFDocument.load(r.bytes, { updateMetadata: false });
  const N = PDFLib.PDFName.of, ctx = doc.context, cat = doc.catalog;
  const L = (v) => (v instanceof PDFLib.PDFRef ? ctx.lookup(v) : v);
  assert.equal(L(cat.get(N("MarkInfo"))).get(N("Marked")).asBoolean(), true);
  assert.equal(cat.get(N("Lang")).decodeText(), "el");
  assert.equal(L(cat.get(N("ViewerPreferences"))).get(N("DisplayDocTitle")).asBoolean(), true);
  assert.equal(doc.getTitle(), "Ο φάρος");
  const xmp = Buffer.from(L(cat.get(N("Metadata"))).getContents()).toString("utf8");
  assert.ok(/<pdfuaid:part>1<\/pdfuaid:part>/.test(xmp) && /Ο φάρος/.test(xmp));
  const root = L(cat.get(N("StructTreeRoot"))), D = L(root.get(N("K")));
  assert.equal(D.get(N("S")).asString(), "/Document");
  const kids = L(D.get(N("K"))).asArray().map((k) => L(k));
  const S = (e) => e.get(N("S")).asString().slice(1);
  assert.deepEqual(kids.map(S), ["TOC", "H1", "P", "P", "Note", "Figure"], "reading order: the footnote after its page's paragraphs; the H2 heading starts at H1");
  const figure = kids[5];
  assert.equal(figure.get(N("Alt")).decodeText(), "Ένας φάρος τη νύχτα");
  assert.ok(L(figure.get(N("A"))).get(N("BBox")));
  assert.equal(kids[4].get(N("ID")).decodeText(), "note-1");
  assert.ok(L(root.get(N("IDTree"))).get(N("Names")));
  // ParentTree: each page's MCIDs point back at their elements
  const nums = L(L(root.get(N("ParentTree"))).get(N("Nums"))).asArray();
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    assert.equal(pg.node.get(N("Tabs")).asString(), "/S");
    const sp = pg.node.get(N("StructParents")).asNumber();
    const at = nums.findIndex((x, j) => j % 2 === 0 && x.asNumber() === sp);
    const arr = L(nums[at + 1]).asArray();
    assert.equal(arr.length, pdf.orosTag.pages[i + 1].length, "page " + (i + 1));
  });
  // links: a Link element holding the annotation, described
  let links = 0;
  pages.forEach((pg) => {
    const an = L(pg.node.get(N("Annots")));
    if (!an) return;
    an.asArray().forEach((ref) => {
      const a = L(ref);
      assert.ok(a.get(N("StructParent")) !== undefined);
      assert.ok(a.get(N("Contents")).decodeText().length > 0);
      links++;
    });
  });
  assert.equal(links, 2);
  const toc = L(kids[0].get(N("K"))).asArray().map(L);
  assert.equal(S(toc[0]), "TOCI");
  const tocK = L(toc[0].get(N("K"))).asArray().map(L);
  assert.ok(tocK.some((k) => k.get && k.get(N("S")) && S(k) === "Link"), "the contents link sits in its line");
  const pK = L(kids[3].get(N("K"))).asArray().map(L).filter((k) => k.get && k.get(N("S")));
  const lk = pK.find((k) => S(k) === "Link");
  const objr = L(L(lk.get(N("K"))).asArray()[0]);
  assert.equal(objr.get(N("Type")).asString(), "/OBJR");
  const ann = L(objr.get(N("Obj")));
  assert.equal(ann.get(N("Contents")).decodeText(), "https://example.com", "a web link says where it goes");
});

test("PDF/X-4 on a tagged PDF keeps the structure and says PDF/UA in its XMP", async () => {
  const d = book(), pdf = tagged(d);
  const t1 = await TG.make(PDFLib, new Uint8Array(pdf.output("arraybuffer")), pdf.orosTag, { title: d.name, lang: "el" });
  const icc = new Uint8Array(fs.readFileSync(path.join(ROOT, "vendor/icc/ISOcoated_v2_eci.icc")));
  const srgb = new Uint8Array(fs.readFileSync(path.join(ROOT, "vendor/icc/sRGB_IEC61966-2-1.icc")));
  const x = await X.make(PDFLib, t1.bytes, { icc, srgb, title: d.name });
  const doc = await PDFLib.PDFDocument.load(x.bytes, { updateMetadata: false });
  const N = PDFLib.PDFName.of, cat = doc.catalog;
  assert.ok(cat.get(N("StructTreeRoot")) && cat.get(N("MarkInfo")) && cat.get(N("Lang")));
  const xmp = Buffer.from(doc.context.lookup(cat.get(N("Metadata"))).getContents()).toString("utf8");
  assert.ok(/<pdfuaid:part>1<\/pdfuaid:part>/.test(xmp) && /PDF\/X-4/.test(xmp));
  const plain = await X.make(PDFLib, new Uint8Array(P.build(d, {}, { jsPDF, layout: R.computeLayout(d) }).output("arraybuffer")), { icc, srgb, title: d.name });
  const p2 = await PDFLib.PDFDocument.load(plain.bytes, { updateMetadata: false });
  assert.ok(!/pdfuaid/.test(Buffer.from(p2.context.lookup(p2.catalog.get(N("Metadata"))).getContents()).toString("utf8")), "untagged: no PDF/UA claim");
});

test("wiring: Export option, e-book profiles tagged, the Assistant and Gate tool, strings and help in EN/EL/DE", () => {
  const panels = read("layout/panels.js"), io = read("layout/io.js"), lay = read("layout/layout.js"), de = read("i18n/de/layout.js");
  assert.ok(/check\(t\("exp\.tag"\)/.test(panels) && /tagged: !!expPrefs\.tag/.test(panels));
  assert.ok(/opts\.tagged = prof\.tag !== 0/.test(io), "an e-book PDF is tagged");
  assert.ok(/tagged: false/.test(io) && /imp \|\| x1a/.test(io), "not with imposition or X-1a");
  assert.ok(/tagBytes: tagBytes/.test(io) && /"\.\.\/designkit\/tagpdf\.js", "DK_TAGPDF"/.test(io));
  assert.ok(/tagged: !!rq\.tagged/.test(read("layout/pdfout.js")));
  assert.ok(read("sw.js").includes('"designkit/tagpdf.js"'));
  ["exp.tag", "exp.tagHint", "tag.cover"].forEach((k) => {
    assert.equal((lay.match(new RegExp('"' + k.replace(".", "\\.") + '": "', "g")) || []).length, 2, k + " EN + EL");
    assert.ok(de.includes('"' + k + '": "'), k + " DE");
  });
  assert.ok(read("layout/help.en.txt").includes("## Accessible PDF"));
  assert.ok(read("layout/help.el.txt").includes("## Προσβάσιμο PDF"));
  assert.ok(read("i18n/de/help/layout.txt").includes("## Barrierefreies PDF"));
  const C = require(path.join(ROOT, "assistant/core.js"));
  const a = C.normPdf({ document: "Ο φάρος", preset: "screen", tagged: true });
  assert.equal(a.ok, true); assert.equal(a.tagged, 1);
  assert.equal(C.normPdf({ document: "Ο φάρος" }).tagged, 0);
  const rep = C.pdfReport({ ok: 1, doc: "x", preset: "screen", path: "/internal/Layout/PDF/x.pdf", bytes: 10, pages: 1, tagged: { elems: 9, figures: 1, links: 2 } });
  assert.deepEqual(rep.tagged, { elements: 9, figures: 1, links: 2 });
});
