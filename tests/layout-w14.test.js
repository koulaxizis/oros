// Layout W14 (LY-W14): object effects. The model (ext.fx read
// checked), the canvas (a layer with the canvas's own shadows, a group
// when blended, soft edges as a mask), the PDF (blend modes as
// ExtGStates written into jsPDF's resources, shadows and glows as
// faint copies in one colour, cut out of the object when blended,
// artifacts in a tagged PDF), SVG (a filter, mix-blend-mode), the
// `effects` command, strings in EN/EL/DE and the wiring.
// Synthetic documents only.
// Run: node --test tests/layout-w14.test.js
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
T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});
global.window = global.window || global;
const { jsPDF } = require(path.join(ROOT, "vendor/jspdf.umd.min.js"));

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

function doc(fxA, fxB) {
  const d = M.newDoc({ name: "Εφέ", w: 300, h: 300, pages: 1, facing: 0 }, 1);
  const pg = M.pagesInOrder(d)[0];
  d.stories.push({ id: "st-a", m: 1, paras: [{ ps: "ps-body", runs: [{ t: "Σκιά" }] }] });
  d.items.push({ id: "it-a", m: 1, t: "rect", pg: pg.id, x: 40, y: 40, w: 100, h: 80, fill: "sw-yellow", z: 1, ext: fxA ? { fx: fxA } : undefined });
  d.items.push({ id: "it-b", m: 1, t: "text", pg: pg.id, x: 40, y: 180, w: 200, h: 60, story: "st-a", seq: 1, z: 2, ext: fxB ? { fx: fxB } : undefined });
  d.items.push({ id: "it-c", m: 1, t: "img", pg: pg.id, x: 160, y: 40, w: 100, h: 80, z: 3 });
  return M.normDoc(d);
}

test("model: effects read checked, soft edges only on pictures, unknown blend modes dropped", () => {
  assert.equal(M.itemFx({ t: "rect" }), null);
  assert.deepEqual(M.itemFx({ t: "rect", ext: { fx: { sh: {} } } }), { sh: { x: 3, y: 3, b: 4, c: "", o: 50 } });
  assert.deepEqual(M.itemFx({ t: "rect", ext: { fx: { sh: { x: 999, y: -999, b: -4, o: 300, c: "not an id!" }, gl: { b: 0 }, fe: 10, bm: "hue" } } }),
    { sh: { x: 144, y: -144, b: 0, c: "", o: 100 }, gl: { b: 0.5, c: "", o: 60 } });
  assert.deepEqual(M.itemFx({ t: "img", ext: { fx: { fe: 12, bm: "multiply", sh: { o: 0 } } } }), { fe: 12, bm: "multiply" });
  assert.equal(M.fxPad(M.itemFx({ t: "rect", ext: { fx: { sh: { x: -6, y: 2, b: 4 }, gl: { b: 12 } } } })), 12);
  // a document keeps them through its own check and a merge
  const d = doc({ sh: { x: 2, y: 2, b: 3, o: 40 }, bm: "screen" });
  assert.deepEqual(M.find(d.items, "it-a").ext.fx, { sh: { x: 2, y: 2, b: 3, o: 40 }, bm: "screen" });
  assert.deepEqual(M.find(M.mergeDoc(d, doc()).items, "it-a").ext.fx, { sh: { x: 2, y: 2, b: 3, o: 40 }, bm: "screen" });
});

test("canvas: no layer to draw on, the blend mode still applies; the item is drawn once", () => {
  const d = doc({ sh: {}, bm: "multiply" });
  const ops = [];
  const ctx = new Proxy({ canvas: null }, { get: (o, k) => (k in o ? o[k] : typeof k === "string" ? (...a) => { ops.push(k); } : undefined), set: (o, k, v) => { if (k === "globalCompositeOperation") ops.push("gco:" + v); o[k] = v; return true; } });
  R.drawItem(ctx, d, M.find(d.items, "it-a"), {});
  assert.ok(ops.includes("gco:multiply"));
  assert.equal(ops.filter((k) => k === "fill").length, 1);
  assert.ok(/function drawFx\(ctx, doc, it, opts, fx\)/.test(read("designkit/render.js")) && /shadowOffsetX = W \* 2/.test(read("designkit/render.js")));
});

test("PDF: a blend mode is an ExtGState in the resources, a shadow is faint copies cut out of the object", () => {
  const plain = P.build(doc(), { rgb: true }, { jsPDF }).output();
  const out = P.build(doc({ sh: { x: 6, y: 6, b: 8, o: 60 }, bm: "multiply" }), { rgb: true }, { jsPDF });
  const raw = Buffer.from(out.output("arraybuffer")).toString("latin1");
  assert.ok(/<< \/Type \/ExtGState \/BM \/Multiply >>/.test(raw));
  const ref = raw.match(/\/OBMultiply (\d+) 0 R/);
  assert.ok(ref, "the page's ExtGState dictionary names it");
  assert.ok(new RegExp("\\n" + ref[1] + " 0 obj\\n<< /Type /ExtGState /BM /Multiply >>").test(raw), "the name points at the object");
  // the same PDF written twice is the same (the hook writes on every build)
  assert.equal(Buffer.from(out.output("arraybuffer")).toString("latin1").replace(/\/CreationDate \([^)]*\)|\/ID \[[^\]]*\]/g, ""), raw.replace(/\/CreationDate \([^)]*\)|\/ID \[[^\]]*\]/g, ""));
  const content = streams(out.output("arraybuffer")).join("\n");
  assert.ok(/\/OBMultiply gs/.test(content));
  assert.ok(/W\*\nn/.test(content), "the shadow is cut out of the object (even-odd clip)");
  const rects = (s) => (s.match(/ re\n/g) || []).length;
  assert.equal(rects(content) - rects(streams(Buffer.from(plain, "latin1")).join("\n")), 17 + 2, "17 shadow copies, the clip's two rectangles");
  // without blur: one copy; without a blend mode: no clip, no blend state
  const hard = streams(P.build(doc({ sh: { b: 0, o: 50 } }), { rgb: true }, { jsPDF }).output("arraybuffer")).join("\n");
  assert.ok(!/W\*\nn/.test(hard) && !/\/OB\w+ gs/.test(hard));
  assert.equal(rects(hard) - rects(streams(Buffer.from(plain, "latin1")).join("\n")), 1);
});

test("PDF: a glow on a text frame without a fill repeats its letters in the glow's colour, as artifacts in a tagged PDF", () => {
  const d = doc(null, { gl: { b: 4, o: 80, c: "sw-red" } });
  const content = streams(P.build(d, { rgb: true, tagged: true }, { jsPDF }).output("arraybuffer")).join("\n");
  const tj = (content.match(/\) Tj|\] TJ/g) || []).length;
  const tj0 = (streams(P.build(doc(), { rgb: true, tagged: true }, { jsPDF }).output("arraybuffer")).join("\n").match(/\) Tj|\] TJ/g) || []).length;
  assert.equal(tj - tj0, 17 * tj0, "17 copies");
  // every copy is inside /Artifact … EMC, the real text is the one tagged run
  const mcids = (content.match(/\/MCID \d+/g) || []).length;
  assert.equal(mcids, (streams(P.build(doc(), { rgb: true, tagged: true }, { jsPDF }).output("arraybuffer")).join("\n").match(/\/MCID \d+/g) || []).length);
});

test("SVG: shadow and glow as one filter, the blend mode as mix-blend-mode", () => {
  const SO = require(path.join(ROOT, "layout/svgout.js"));
  const d = doc({ sh: { x: 4, y: 5, b: 6, o: 50 }, gl: { b: 3, o: 70, c: "sw-blue" }, bm: "overlay" });
  const svg = SO.build(d, M.pagesInOrder(d)[0], R.computeLayout(d), {}, {}).svg;
  assert.ok(/<filter id="[^"]+" filterUnits="userSpaceOnUse"/.test(svg));
  assert.equal((svg.match(/<feGaussianBlur in="SourceAlpha" stdDeviation="3"/g) || []).length, 1);
  assert.ok(/<feOffset dx="4" dy="5"\/>/.test(svg));
  assert.ok(/<feFuncA type="linear" slope="0.5"\/>/.test(svg) && /<feFuncA type="linear" slope="0.7"\/>/.test(svg));
  assert.ok(/<feFlood flood-color="#000000"\/>/.test(svg) && /<feFlood flood-color="#(?!000000)[0-9a-f]{6}"\/>/i.test(svg), "black shadow, blue glow");
  assert.ok(/<g filter="url\(#[^"]+\)" style="mix-blend-mode:overlay">/.test(svg));
  const d0 = doc();
  assert.ok(!/<filter/.test(SO.build(d0, M.pagesInOrder(d0)[0], R.computeLayout(d0), {}, {}).svg));
});

test("effects command: checked, set, changed in part, taken off; soft edges on pictures only", () => {
  const C = require(path.join(ROOT, "layout/commands.js"));
  const ok = C.check([{ op: "effects", frame: "it-a, it-c", shadow_opacity: 40, shadow_color: "#223344", blend: "multiply", soft_edges: 8 }]);
  assert.equal(ok.ok, true, ok.err);
  assert.equal(C.check([{ op: "effects", shadow_opacity: 40 }]).ok, false, "needs frames");
  const d = doc();
  assert.equal(C.apply(d, ok.steps[0], { now: 5 }), 2);
  const a = M.find(d.items, "it-a").ext.fx, c = M.find(d.items, "it-c").ext.fx;
  assert.equal(a.sh.o, 40);
  assert.deepEqual([a.sh.x, a.sh.y, a.sh.b], [3, 3, 4], "the rest is the default");
  assert.ok(/^sw-/.test(a.sh.c) && M.swatchColor(d, a.sh.c).rgb.join() === "34,51,68");
  assert.equal(a.bm, "multiply");
  assert.equal(a.fe, undefined, "not a picture");
  assert.equal(c.fe, 8);
  assert.equal(M.find(d.items, "it-a").m, 5);
  // only the offset changes; a negative offset is a value
  assert.equal(C.apply(d, C.check([{ op: "effects", frame: "it-a", shadow_x: -5 }]).steps[0], { now: 6 }), 1);
  assert.deepEqual([M.find(d.items, "it-a").ext.fx.sh.x, M.find(d.items, "it-a").ext.fx.sh.o], [-5, 40]);
  // nothing to change
  assert.equal(C.apply(d, C.check([{ op: "effects", frame: "it-a", shadow_x: -5 }]).steps[0], { now: 7 }), 0);
  // a glow; then everything off
  C.apply(d, C.check([{ op: "effects", frame: "it-a", glow_opacity: 70, glow_blur: 9 }]).steps[0], { now: 8 });
  assert.deepEqual(M.find(d.items, "it-a").ext.fx.gl, { b: 9, c: "", o: 70 });
  assert.equal(C.apply(d, C.check([{ op: "effects", frame: "it-a,it-c", shadow_opacity: 0, glow_opacity: 0, blend: "normal", soft_edges: 0 }]).steps[0], { now: 9 }), 2);
  assert.equal(M.find(d.items, "it-a").ext, undefined);
  assert.equal(M.find(d.items, "it-c").ext, undefined);
  assert.ok(/\neffects: /.test(C.GUIDE));
});

test("wiring: properties, pictures out with soft edges, strings and help in EN/EL/DE", () => {
  const pn = read("layout/panels.js");
  assert.ok(/body\.appendChild\(fxSection\(items\)\)/.test(pn) && /function fxSection\(items\)/.test(pn));
  const io = read("layout/io.js");
  assert.ok(/LY\.R\.feather\(cx, cw, ch,/.test(io) && /"fe" \+ fe/.test(io), "soft edges baked into the picture the PDF carries");
  assert.ok(/bm && bm !== N\("Normal"\)/.test(read("designkit/pdfx.js")), "PDF/X-1a counts a blend mode as transparency");
  const lay = read("layout/layout.js"), de = read("i18n/de/layout.js");
  const keys = Array.from(new Set(pn.match(/["(]fx\.[a-zA-Z.]+"/g).map((m) => m.slice(1, -1)).filter((k) => !/\.$/.test(k))))
    .concat(M.BLENDS.map((b) => "fx.bm." + b));
  assert.ok(keys.length >= 15, String(keys.length));
  keys.forEach((k) => {
    assert.equal((lay.match(new RegExp('"' + k.replace(/\./g, "\\.") + '": "', "g")) || []).length, 2, k + " EN + EL");
    assert.ok(de.includes('"' + k + '": "'), k + " DE");
  });
  assert.ok(read("layout/help.en.txt").includes("## Effects\n"));
  assert.ok(read("layout/help.el.txt").includes("## Εφέ\n"));
  assert.ok(read("i18n/de/help/layout.txt").includes("## Effekte\n"));
});
