// orOS Layout — fonts besides the built-in Noto ones (LY-FONT):
// designkit/fonts.js (names, font file checks, a document's families),
// a style's ext.fam in designkit/text.js, the PDF writing each
// character in the file that has it (designkit/pdf.js), a rebuilt PDF
// and a Scribus file that name their fonts, and the wiring of the
// Fonts dialog. Fixtures are synthetic or the Noto files in vendor/.
// Run: node --test tests/layout-fonts.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const F = require(path.join(ROOT, "designkit/fonts.js"));
const P = require(path.join(ROOT, "designkit/pdf.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const RB = require(path.join(ROOT, "layout/rebuild.js"));
const S = require(path.join(ROOT, "layout/sla.js"));
const C = require(path.join(ROOT, "assistant/core.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

function buf(file) {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
T.allKeys().forEach((k) => T.register(k, buf(T.fontFile(k))));
const SERIF = buf("NotoSerif-Regular.ttf"), SANS = buf("NotoSans-Regular.ttf");

// a copy of a TTF with one OS/2 field or table tag changed
function patched(src, fn) {
  const out = src.slice(0), dv = new DataView(out), n = dv.getUint16(4), tb = {};
  for (let t = 0; t < n; t++) {
    const o = 12 + t * 16, tag = String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
    tb[tag] = { dir: o, off: dv.getUint32(o + 8) };
  }
  fn(dv, tb);
  return out;
}
// TTF → WOFF 1.0 (each table deflated)
function woff(src) {
  const dv = new DataView(src), n = dv.getUint16(4), dir = [];
  for (let t = 0; t < n; t++) {
    const o = 12 + t * 16;
    const data = new Uint8Array(src, dv.getUint32(o + 8), dv.getUint32(o + 12));
    const z = zlib.deflateSync(Buffer.from(data));
    dir.push({ tag: dv.getUint32(o), sum: dv.getUint32(o + 4), data: z.length < data.length ? new Uint8Array(z) : data, olen: data.length });
  }
  let size = 44 + 20 * n;
  dir.forEach((d) => { size += (d.data.length + 3) & ~3; });
  const out = new Uint8Array(size), ov = new DataView(out.buffer);
  out.set([0x77, 0x4f, 0x46, 0x46]);
  ov.setUint32(4, dv.getUint32(0)); ov.setUint32(8, size); ov.setUint16(12, n);
  let pos = 44 + 20 * n;
  dir.forEach((d, k) => {
    const e = 44 + k * 20;
    ov.setUint32(e, d.tag); ov.setUint32(e + 4, pos); ov.setUint32(e + 8, d.data.length); ov.setUint32(e + 12, d.olen); ov.setUint32(e + 16, d.sum);
    out.set(d.data, pos);
    pos += (d.data.length + 3) & ~3;
  });
  return out.buffer;
}

test("names: Fontsource and own-file ids, and what two names of one family share", () => {
  assert.equal(F.fsIdOf("eb-garamond"), "fs_eb_garamond");
  assert.equal(F.ufIdOf("0123456789abcdef".repeat(4) + ".ttf"), "uf_0123456789abcdef");
  assert.ok(F.isFam("fs_eb_garamond") && F.isFam("uf_0123456789abcdef"));
  assert.ok(!F.isFam("serif") && !F.isFam("fs_") && !F.isFam("fs_a-b") && !F.isFam("xx_abc"));
  assert.equal(F.squash("ABCDEF+Constantia-BoldItalic"), "constantia");
  assert.equal(F.squash("TimesNewRomanPS-BoldMT"), "timesnewroman");
  assert.equal(F.squash("Times New Roman"), "timesnewroman");
  assert.equal(F.squash("Constantia,Bold"), "constantia");
  assert.equal(F.squash("EB Garamond"), F.squash("EBGaramond-Regular"));
});

test("font files: what a TTF says about itself, and the checks before it is kept", async () => {
  const nfo = F.info(SERIF);
  assert.equal(nfo.family, "Noto Serif");
  assert.deepEqual([nfo.b, nfo.i, nfo.fb, nfo.glyf], [0, 0, "serif", true]);
  assert.equal(F.info(buf("NotoSans-BoldItalic.ttf")).fb, "sans");
  assert.deepEqual([F.info(buf("NotoSans-BoldItalic.ttf")).b, F.info(buf("NotoSans-BoldItalic.ttf")).i], [1, 1]);
  assert.equal(F.check(SERIF).ok, true);
  assert.equal(F.check(new ArrayBuffer(8)).err, "type");
  assert.equal(F.check(new ArrayBuffer(F.MAX + 1)).err, "size");
  // PostScript outlines (no glyf table): PDF export could not embed them
  assert.equal(F.check(patched(SERIF, (dv, tb) => { dv.setUint32(tb.glyf.dir, 0x78787878); })).err, "outlines");
  // licence: "restricted licence embedding" is refused, "editable" is fine
  assert.equal(F.check(patched(SERIF, (dv, tb) => { dv.setUint16(tb["OS/2"].off + 8, 2); })).err, "restricted");
  assert.equal(F.check(patched(SERIF, (dv, tb) => { dv.setUint16(tb["OS/2"].off + 8, 8); })).ok, true);
  // WOFF 1.0 is unpacked to the same tables
  const back = await F.unwoff(woff(SANS));
  assert.ok(back && F.check(back).ok);
  assert.equal(F.info(back).family, "Noto Sans");
  assert.equal(T.measure("sans-r", "Hello", 10), (() => { T.registerFamily("uf_aaaaaaaaaaaaaaaa", { urls: { r: ["x"] } }); T.register("uf_aaaaaaaaaaaaaaaa-r", back); return T.measure("uf_aaaaaaaaaaaaaaaa-r", "Hello", 10); })());
  assert.equal(await F.unwoff(SERIF), SERIF, "a TTF passes through");
});

test("a document's families: the list in setup.ext.fonts, the ones its styles use", () => {
  const file = "ab".repeat(32) + ".ttf";
  const d = M.normDoc(M.newDoc({ name: "Fonts", pages: 1 }, 1));
  d.setup.ext = { fonts: [
    { id: "fs_eb_garamond", name: "EB Garamond", fb: "serif" },
    { id: "uf_abababababababab", name: "Mine\u0001", fb: "nope", r: file, b: "bad.ttf" },
    { id: "uf_cdcdcdcdcdcdcdcd", name: "No files", fb: "sans" },
    { id: "fs_eb_garamond", name: "Twice", fb: "sans" },
    { id: "Bad id", name: "x" }
  ] };
  assert.deepEqual(F.docFonts(d), [
    { id: "fs_eb_garamond", name: "EB Garamond", fb: "serif" },
    { id: "uf_abababababababab", name: "Mine", fb: "serif", r: file }
  ]);
  d.pstyles.push({ id: "ps-g", m: 1, name: "G", font: "serif", ext: { fam: "fs_eb_garamond" } });
  d.cstyles.push({ id: "cs-m", m: 1, name: "M", font: "serif", ext: { fam: "uf_abababababababab" } });
  d.cstyles.push({ id: "cs-x", m: 1, name: "X", ext: { fam: "not a family" } });
  assert.deepEqual(F.famsUsed(d).sort(), ["fs_eb_garamond", "uf_abababababababab"]);
  // an own family's files come from the orOS disk; a Fontsource one from the CDN, every subset
  const keys = F.register(d);
  assert.equal(keys.length, 8);
  assert.deepEqual(T.FAMILIES.uf_abababababababab.urls.r, ["asset:" + file]);
  assert.deepEqual(T.FAMILIES.uf_abababababababab.urls.b, []);
  assert.equal(T.FAMILIES.fs_eb_garamond.urls.bi.length, 4);
  assert.match(T.FAMILIES.fs_eb_garamond.urls.r[2], /^https:\/\/cdn\.jsdelivr\.net\/fontsource\/fonts\/eb-garamond@latest\/greek-400-normal\.ttf$/);
  // the list: one entry per family, the newest last, at most 40
  let list = [];
  for (let k = 0; k < 45; k++) list = F.withEntry(list, { id: "fs_f" + k, name: "F" + k, fb: "sans" });
  list = F.withEntry(list, { id: "fs_f10", name: "Again", fb: "mono" });
  assert.equal(list.length, 40);
  assert.deepEqual(list[39], { id: "fs_f10", name: "Again", fb: "mono" });
  assert.equal(F.withEntry(list, { id: "bad" }), list);
});

test("text: a style's family (ext.fam) wins over its stand-in; a character style can change it back", () => {
  T.registerFamily("fs_demo", { name: "Demo", urls: { r: ["d"] }, fallback: "serif" });
  T.register("fs_demo-r", SANS);
  T.register("fs_demo-b", buf("NotoSans-Bold.ttf"));
  const ps = T.byId([
    { id: "ps-base", name: "Base", font: "serif", size: 10 },
    { id: "ps-d", base: "ps-base", font: "serif", ext: { fam: "fs_demo" } },
    { id: "ps-back", base: "ps-d", font: "mono" }
  ]);
  assert.equal(T.resolvePs(ps, "ps-d").fam, "fs_demo");
  assert.equal(T.resolvePs(ps, "ps-back").fam, "", "a built-in font set later ends the family");
  const cs = T.byId([{ id: "cs-b", b: 1 }, { id: "cs-sans", font: "sans" }]);
  const pd = T.resolvePs(ps, "ps-d");
  assert.equal(T.runAttrs(pd, {}, {}).key, "fs_demo-r");
  assert.equal(T.runAttrs(pd, T.resolveCs(cs, "cs-b"), {}).key, "fs_demo-b");
  assert.equal(T.runAttrs(pd, T.resolveCs(cs, "cs-sans"), {}).key, "sans-r");
  assert.equal(T.fallbackKey("fs_demo-b"), "serif-b");
  assert.equal(T.fallbackKey("sans-b"), "sans-b");
  // a family nobody registered: the stand-in
  const ps2 = T.byId([{ id: "ps-base", font: "serif", size: 10 }, { id: "ps-u", base: "ps-base", font: "serif", ext: { fam: "fs_unknown" } }]);
  assert.equal(T.runAttrs(T.resolvePs(ps2, "ps-u"), {}, {}).key, "serif-r");
  // and it lays out with the family's widths
  const r = T.layoutChain({ paras: [{ ps: "ps-d", runs: [{ t: "Hello" }] }] }, [{ id: "a", w: 300, h: 50 }], { ps: [
    { id: "ps-base", m: 1, name: "B", font: "serif", size: 10 }, { id: "ps-d", m: 1, name: "D", base: "ps-base", font: "serif", ext: { fam: "fs_demo" } }], cs: [] });
  assert.equal(r.frames.a.lines[0].runs[0].key, "fs_demo-r");
});

test("pdf: each character goes into the file that has it, only files in use are embedded", () => {
  global.window = global.window || global;
  const { jsPDF } = require(path.join(ROOT, "vendor/jspdf.umd.min.js"));
  // Latin only in the family's first file: Greek comes from its second, ✓ from the stand-in
  T.registerFamily("fs_split", { name: "Split", urls: { r: ["a", "b"] }, fallback: "serif" });
  const latin = patched(SERIF, () => {});
  T.register("fs_split-r", [latin, SANS]);
  const m = T.faceParts("fs_split-r")[0].map;
  Object.keys(m).forEach((cp) => { if (+cp > 0x7f) delete m[cp]; });
  const d = M.normDoc(M.newDoc({ name: "Split", pages: 1 }, 1));
  d.pstyles.push({ id: "ps-s", m: 1, name: "S", base: "ps-base", font: "serif", size: 12, ext: { fam: "fs_split" } });
  d.stories.push({ id: "st-a", m: 1, paras: [{ ps: "ps-s", runs: [{ t: "Abc Αβγ ★" }] }] });
  d.items.push({ id: "it-a", m: 1, t: "text", pg: M.pagesInOrder(d)[0].id, x: 40, y: 40, w: 300, h: 100, story: "st-a", seq: 1, z: 1 });
  const pdf = P.build(M.normDoc(d), {}, { jsPDF });
  assert.deepEqual(Object.keys(pdf.orosFonts).sort(), ["fs_split-r", "fs_split-r~1", "serif-r"], "both files of the family, the stand-in for ★, not the built-in sans");
});

// A PDF line set in "Demo" (registered and loaded) and one in a font nobody has
test("rebuild: a PDF font found by name keeps its family, with no tracking added", () => {
  T.registerFamily("fs_same", { name: "Same", urls: { r: ["s"] }, fallback: "serif" });
  T.register("fs_same-r", SERIF);
  const sp = (t, y, font) => ({ t, x: 50, x1: 50 + T.measure("serif-r", t, 10, 0) * 1.1, y, size: 10, fam: "serif", b: 0, i: 0, font, color: null, rot: 0 });
  const lines = ["the quiet sea at night", "and the gulls asleep", "on the old pier", "while lights go out"];
  const src = { w: 420, h: 595, bleed: 0, pages: [{ spans: lines.map((t, k) => sp(t, 100 + 14 * k, k % 2 ? "Other-Book" : "Same-Regular")), imgs: [], bg: null }] };
  const res = RB.build(src, { now: 5, lang: "en", fonts: { "Same-Regular": { id: "fs_same", name: "Same", fb: "serif" } } });
  const d = res.doc;
  assert.deepEqual(d.setup.ext.fonts, [{ id: "fs_same", name: "Same", fb: "serif" }]);
  const withFam = d.pstyles.filter((s) => s.ext && s.ext.fam === "fs_same");
  assert.ok(withFam.length >= 1 && withFam.every((s) => s.font === "serif"));
  const f = res.report.fonts.find((x) => x.font === "Same-Regular"), o = res.report.fonts.find((x) => x.font === "Other-Book");
  assert.deepEqual(f, { font: "Same-Regular", track: 0, as: "Same" });
  assert.ok(o.track !== 0 && o.as === undefined, "the other one still gets its tracking");
  // without a match nothing names a family
  const plain = RB.build(JSON.parse(JSON.stringify(src)), { now: 5, lang: "en" }).doc;
  assert.ok(!plain.setup.ext || !plain.setup.ext.fonts);
  assert.ok(plain.pstyles.every((s) => !s.ext || !s.ext.fam));
  // the Assistant hears which fonts were the PDF's own
  const rep = C.rebuildReport(res.report);
  assert.deepEqual(rep.fontsSame, ["Same-Regular"]);
  assert.deepEqual(rep.fontsReplaced, ["Other-Book"]);
});

test("Scribus: styles keep their font's own name; a run in another family gets a character style", () => {
  const sla = `<?xml version="1.0" encoding="UTF-8"?>
<SCRIBUSUTF8NEW Version="1.5.8"><DOCUMENT ANZPAGES="1" PAGEWIDTH="400" PAGEHEIGHT="600" BORDERLEFT="40" BORDERRIGHT="40" BORDERTOP="40" BORDERBOTTOM="40" BOOK="0" UNITS="1">
  <STYLE NAME="Default Paragraph Style" FONT="Constantia Regular" FONTSIZE="10.5" ALIGN="3"/>
  <STYLE NAME="Title" PARENT="Default Paragraph Style" FONT="Calibri Bold" FONTSIZE="20"/>
  <PAGE PAGEXPOS="100" PAGEYPOS="20" PAGEWIDTH="400" PAGEHEIGHT="600" NUM="0" LEFT="0"/>
  <PAGEOBJECT XPOS="140" YPOS="60" WIDTH="300" HEIGHT="200" PTYPE="4" OwnPage="0" PCOLOR="None" PCOLOR2="None" ItemID="1">
    <StoryText><DefaultStyle/>
      <ITEXT CH="Plain "/><ITEXT FONT="Constantia Bold" CH="bold "/><ITEXT FONT="Calibri Italic" CH="other"/><para/>
      <ITEXT CH="Heading"/><para PARENT="Title"/><trail/></StoryText>
  </PAGEOBJECT>
</DOCUMENT></SCRIBUSUTF8NEW>`;
  const d = S.convert(sla, { now: 5, name: "F" }).doc;
  const base = d.pstyles.find((s) => s.id === "ps-base"), title = d.pstyles.find((s) => s.name === "Title");
  assert.equal(base.ext.srcFont, "Constantia Regular");
  assert.equal(title.ext.srcFont, "Calibri Bold");
  const runs = d.stories[0].paras[0].runs;
  assert.equal(runs[1].b, 1);
  assert.equal(runs[1].cs, undefined, "the same family in bold is no character style");
  const cs = d.cstyles.find((c) => c.id === runs[2].cs);
  assert.equal(cs.ext.srcFont, "Calibri Italic");
  assert.equal(runs[2].i, 1);
});

test("the wiring: the Fonts dialog, the style editor, packages carry the font files", () => {
  const html = read("layout/index.html"), sw = read("sw.js");
  assert.ok(html.indexOf("designkit/fonts.js") > html.indexOf("designkit/text.js"));
  assert.ok(html.indexOf("fontpick.js") > html.indexOf("panels.js"));
  assert.match(sw, /"designkit\/fonts\.js",/);
  assert.match(sw, /"layout\/fontpick\.js",/);
  const pn = read("layout/panels.js");
  assert.match(pn, /fontOpts\.push\(\["__more", t\("fp\.more"\)\]\)/);
  assert.match(pn, /LY\.fonts\.pick\(function \(e\) \{/);
  assert.match(pn, /styleDlg\(kind, id, st\);/);
  const io = read("layout/io.js");
  assert.match(io, /fontFiles\(doc\)\.forEach\(function \(name\) \{\n\s+chain = chain\.then\(function \(\) \{ return F\.blob\(name\); \}\)/);
  assert.match(io, /return F\.put\(name,/);
  assert.match(io, /matchFonts: matchFonts/);
  assert.match(io, /return useSrcFonts\(res\.doc\)/);
  assert.match(read("layout/layout.js"), /T\.setFetcher\(LY\.F\.fetcher\)/);
  assert.match(read("layout/editor.js"), /LY\.F\.register\(doc\)/);
  // every new string in English, Greek and German
  const ly = read("layout/layout.js"), de = read("i18n/de/layout.js");
  ["fp.more", "fp.title", "fp.mine", "fp.loading", "fp.add", "fp.addHint", "fp.none", "fp.free", "fp.search", "fp.greek", "fp.offline", "fp.noMatch",
   "fp.hasGreek", "fp.moreHits", "fp.v.r", "fp.v.b", "fp.v.i", "fp.v.bi", "fp.err.size", "fp.err.type", "fp.err.outlines", "fp.err.restricted",
   "fp.err.disk", "fp.added", "imp.fontFail", "rb.fontsSame"].forEach((k) => {
    assert.equal(ly.split('"' + k + '":').length - 1, 2, k + " in EN and EL");
    assert.ok(de.includes('"' + k + '":'), k + " in DE");
  });
  // what the dialog uses exists
  const fp = read("layout/fontpick.js");
  (fp.match(/t\("fp\.[a-zA-Z.]+"[,)]/g) || []).forEach((m) => assert.ok(ly.includes(m.slice(2, -1) + ":"), m));
});
