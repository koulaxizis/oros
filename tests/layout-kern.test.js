// orOS designkit — pair kerning (LY-KERN): read from a font's GPOS
// "kern" feature or its old kern table (designkit/text.js), turned on
// by a style's ext.kern, and applied the same in layout, on screen
// (render.js) and in the PDF (pdf.js). Fonts: the Noto files in
// vendor/ (the full Noto Sans has kerning, the subsets do not).
// Run: node --test tests/layout-kern.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const P = require(path.join(ROOT, "designkit/pdf.js"));
const RB = require(path.join(ROOT, "layout/rebuild.js"));
const S = require(path.join(ROOT, "layout/sla.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

function buf(file) {
  const b = fs.readFileSync(path.join(ROOT, file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
T.allKeys().forEach((k) => T.register(k, buf("vendor/noto/" + T.fontFile(k))));
const FULL = buf("vendor/NotoSans-Regular.ttf");
T.registerFamily("fs_kern", { name: "Kern", urls: { r: ["k"] }, fallback: "sans" });
T.register("fs_kern-r", FULL);

// a copy of a font with one more table (tag, bytes)
function withTable(src, tag, data) {
  const dv = new DataView(src), n = dv.getUint16(4);
  const head = 12 + (n + 1) * 16, oldHead = 12 + n * 16;
  const body = new Uint8Array(src, oldHead), pad = (data.length + 3) & ~3;
  const out = new Uint8Array(head + body.length + pad), ov = new DataView(out.buffer);
  out.set(new Uint8Array(src, 0, 12));
  ov.setUint16(4, n + 1);
  for (let t = 0; t < n; t++) {
    out.set(new Uint8Array(src, 12 + t * 16, 16), 12 + t * 16);
    ov.setUint32(12 + t * 16 + 8, dv.getUint32(12 + t * 16 + 8) + 16);
  }
  const e = 12 + n * 16;
  for (let i = 0; i < 4; i++) out[e + i] = tag.charCodeAt(i);
  ov.setUint32(e + 8, head + body.length); ov.setUint32(e + 12, data.length);
  out.set(body, head);
  out.set(data, head + body.length);
  return out.buffer;
}
// an old-style kern table (version 0, one format-0 subtable)
function kernTable(pairs) {
  const n = pairs.length, len = 14 + 6 * n, b = new Uint8Array(4 + len), dv = new DataView(b.buffer);
  dv.setUint16(0, 0); dv.setUint16(2, 1);
  dv.setUint16(4, 0); dv.setUint16(6, len); dv.setUint16(8, 1);   // format 0, horizontal
  dv.setUint16(10, n);
  pairs.forEach((p, k) => { dv.setUint16(18 + k * 6, p[0]); dv.setUint16(20 + k * 6, p[1]); dv.setInt16(22 + k * 6, p[2]); });
  return b;
}

test("GPOS pairs: class and glyph pairs of the full Noto Sans; the subsets have none", () => {
  const m = T.parseTTF(FULL);
  const k = (a, b) => m.kern(m.map[a.codePointAt(0)], m.map[b.codePointAt(0)]);
  assert.deepEqual([k("A", "V"), k("T", "o"), k("Α", "Υ"), k("Τ", "α"), k("a", "b")], [-40, -70, -60, -70, 0]);
  assert.equal(T.parseTTF(buf("vendor/noto/NotoSans-Regular.ttf")).kern, null);
  assert.equal(T.kernPair("fs_kern-r", "A", "V", 10), -0.4);
  assert.equal(T.kernPair("sans-r", "A", "V", 10), 0);
});

test("the old kern table, when there is no GPOS kerning", () => {
  const src = buf("vendor/noto/NotoSerif-Regular.ttf"), m0 = T.parseTTF(src);
  const A = m0.map[65], V = m0.map[86];
  const m = T.parseTTF(withTable(src, "kern", kernTable([[A, V, -80], [V, A, -75]])));
  assert.equal(m.kern(A, V), -80);
  assert.equal(m.kern(V, A), -75);
  assert.equal(m.kern(A, A), 0);
  // a damaged table is no kerning, never an error
  assert.equal(T.parseTTF(withTable(src, "GPOS", new Uint8Array([0, 1, 0, 0, 0xff, 0xff, 0xff, 0xff]))).kern, null);
});

test("measure: kerning only when asked, between neighbours of one face", () => {
  const plain = T.measure("fs_kern-r", "AVATAR", 20, 0);
  const kerned = T.measure("fs_kern-r", "AVATAR", 20, 0, 1);
  let sum = 0;
  ["AV", "VA", "AT", "TA", "AR"].forEach((p) => { sum += T.kernPair("fs_kern-r", p[0], p[1], 20); });
  assert.ok(sum < 0);
  assert.ok(Math.abs(kerned - (plain + sum)) < 1e-9);
  assert.equal(T.measure("sans-r", "AVATAR", 20, 0, 1), T.measure("sans-r", "AVATAR", 20, 0), "no pairs, no change");
  // with tracking both add up
  assert.ok(Math.abs(T.measure("fs_kern-r", "AV", 20, 50, 1) - (T.measure("fs_kern-r", "AV", 20, 50) + T.kernPair("fs_kern-r", "A", "V", 20))) < 1e-9);
});

test("styles: ext.kern is inherited, a character style can turn it off; layout and its runs follow", () => {
  const styles = {
    ps: [{ id: "ps-base", m: 1, name: "B", font: "sans", size: 20, ext: { fam: "fs_kern", kern: 1 } }, { id: "ps-child", m: 1, name: "C", base: "ps-base", size: 20 }],
    cs: [{ id: "cs-off", m: 1, name: "Off", ext: { kern: 0 } }]
  };
  assert.equal(T.resolvePs(T.byId(styles.ps), "ps-child").kern, 1);
  assert.equal(T.resolveCs(T.byId(styles.cs), "cs-off").kern, 0);
  const r = T.layoutChain({ paras: [{ ps: "ps-child", runs: [{ t: "AVATAR " }, { t: "TAVERN", cs: "cs-off" }] }] }, [{ id: "a", w: 500, h: 60 }], styles);
  const runs = r.frames.a.lines[0].runs;
  assert.equal(runs[0].kern, 1);
  assert.equal(runs[1].kern, undefined);
  assert.ok(Math.abs(runs[0].w - T.measure("fs_kern-r", runs[0].t, 20, 0, 1)) < 1e-6);
  // without ext.kern nothing changes (older documents keep their line breaks)
  const off = T.layoutChain({ paras: [{ ps: "p", runs: [{ t: "AVATAR" }] }] }, [{ id: "a", w: 500, h: 60 }], { ps: [{ id: "p", m: 1, name: "P", font: "sans", size: 20, ext: { fam: "fs_kern" } }], cs: [] });
  assert.equal(off.frames.a.lines[0].runs[0].kern, undefined);
  assert.equal(off.frames.a.lines[0].runs[0].w, T.measure("fs_kern-r", "AVATAR", 20, 0));
});

test("pdf: a kerned pair starts a new piece of text, placed where layout put it", () => {
  global.window = global.window || global;
  const { jsPDF } = require(path.join(ROOT, "vendor/jspdf.umd.min.js"));
  const mk = (kern) => {
    const calls = [];
    // jsPDF puts its methods on the instance: wrap text() there
    function Rec(o) { const p = new jsPDF(o), text = p.text; p.text = function (t, x) { calls.push([t, x]); return text.apply(p, arguments); }; return p; }
    const d = M.newDoc({ name: "K", pages: 1 }, 1);
    d.pstyles.push({ id: "ps-k", m: 1, name: "K", base: "ps-base", font: "sans", size: 20, ext: kern ? { fam: "fs_kern", kern: 1 } : { fam: "fs_kern" } });
    d.stories.push({ id: "st-k", m: 1, paras: [{ ps: "ps-k", runs: [{ t: "AVATAR" }] }] });
    d.items.push({ id: "it-k", m: 1, t: "text", pg: M.pagesInOrder(d)[0].id, x: 40, y: 40, w: 400, h: 60, story: "st-k", seq: 1, z: 1 });
    P.build(M.normDoc(d), {}, { jsPDF: Rec });
    return calls;
  };
  assert.deepEqual(mk(false).map((c) => c[0]), ["AVATAR"]);
  const k = mk(true);
  assert.deepEqual(k.map((c) => c[0]), ["A", "V", "A", "T", "AR"], "A|V, V|A, A|T and T|A are kerned pairs, A R is not");
  // each piece where the kerned measure puts it
  let before = "";
  k.forEach((c) => {
    const want = T.measure("fs_kern-r", before, 20, 0, 1) + (before ? T.kernPair("fs_kern-r", before.slice(-1), c[0][0], 20) : 0);
    assert.ok(Math.abs(c[1] - k[0][1] - want) < 1e-6, c[0]);
    before += c[0];
  });
});

test("rebuilt PDFs, Scribus files and new documents kern; the style editor has the switch", () => {
  const sp = (t, y) => ({ t, x: 50, x1: 50 + T.measure("serif-r", t, 10, 0), y, size: 10, fam: "serif", b: 0, i: 0, font: "X", color: null, rot: 0 });
  const d = RB.build({ w: 420, h: 595, bleed: 0, pages: [{ spans: [sp("a line of text", 100), sp("another line here", 114)], imgs: [], bg: null }] }, { now: 5 }).doc;
  assert.equal(d.pstyles.find((s) => s.id === "ps-base").ext.kern, 1);
  const sla = `<SCRIBUSUTF8NEW Version="1.5.8"><DOCUMENT ANZPAGES="1" PAGEWIDTH="400" PAGEHEIGHT="600" BORDERLEFT="40" BORDERRIGHT="40" BORDERTOP="40" BORDERBOTTOM="40">
  <STYLE NAME="Default Paragraph Style" FONT="Constantia Regular" FONTSIZE="10.5"/>
  <PAGE PAGEXPOS="100" PAGEYPOS="20" PAGEWIDTH="400" PAGEHEIGHT="600" NUM="0"/></DOCUMENT></SCRIBUSUTF8NEW>`;
  const base = S.convert(sla, { now: 5 }).doc.pstyles.find((s) => s.id === "ps-base");
  assert.deepEqual(base.ext, { kern: 1, srcFont: "Constantia Regular" });
  assert.match(read("layout/layout.js"), /function createDoc\(opts\) \{\n\s+var d = M\.newDoc\(opts, now\(\)\), base = M\.find\(d\.pstyles, "ps-base"\);\n\s+if \(base\) base\.ext = \{ kern: 1 \};/);
  assert.match(read("layout/panels.js"), /flags\.appendChild\(triState\(t\("sty\.kern"\), st\.ext, "kern"\)\);/);
  const ly = read("layout/layout.js");
  assert.equal(ly.split('"sty.kern":').length - 1, 2);
  assert.ok(read("i18n/de/layout.js").includes('"sty.kern":'));
});
