// Vector tools, wave V3: text on a path. designkit/vector.js walker /
// alongPath, Atelier ext.tp (atelier/ax.js curveLayout) and Layout
// LY-TP (designkit/render.js: a one-line frame bent onto its outline,
// drawn glyph by glyph on the canvas and in the PDF).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const V = require(path.join(ROOT, "designkit/vector.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const P = require(path.join(ROOT, "designkit/pdf.js"));
const AX = require(path.join(ROOT, "atelier/ax.js"));

T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

const CIRCLE = V.text(V.ellCmds(1, 1));            // unit circle outline, starts at the top, clockwise
const near = (a, b, e) => Math.abs(a - b) <= e;

test("walker measures an outline by arc length", () => {
  const wk = V.walker(V.ellCmds(200, 200));
  assert.ok(near(wk.len, 2 * Math.PI * 100, 0.5), String(wk.len));
  assert.equal(wk.closed, true);
  const top = wk.at(0);
  assert.ok(near(top[0], 100, 1e-6) && near(top[1], 0, 1e-6));
  assert.ok(near(top[2], 0, 0.05), "heads right at the top: " + top[2]);
  const line = V.walker([["M", 0, 0], ["L", 100, 0]]);
  assert.equal(line.len, 100);
  assert.deepEqual(line.at(25).map((v) => Math.round(v * 1000) / 1000), [25, 0, 0]);
  assert.equal(V.walker([["M", 5, 5]]), null);
});

test("alongPath: anchor and alignment, open ends hide, flip keeps the anchor", () => {
  const line = [["M", 0, 0], ["L", 100, 0]], g = [{ w: 10 }, { w: 10 }, { w: 10 }];
  const c = V.alongPath(line, g, { o: 50, al: "c" });
  assert.deepEqual(c.map((p) => p.x), [40, 50, 60]);
  const l = V.alongPath(line, g, { o: 0, al: "l" });
  assert.deepEqual(l.map((p) => p.x), [5, 15, 25]);
  const r = V.alongPath(line, g, { o: 100, al: "r" });
  assert.deepEqual(r.map((p) => p.x), [75, 85, 95]);
  const over = V.alongPath(line, g, { o: 95, al: "l" });
  assert.ok(!over[0].hide && over[1].hide && over[2].hide);
  const f = V.alongPath(line, g, { o: 50, al: "c", s: -1 });
  assert.deepEqual(f.map((p) => Math.round(p.x)), [60, 50, 40]);
  assert.ok(near(f[0].rot, Math.PI, 1e-9));
  // a closed outline wraps round instead of hiding
  const ring = V.alongPath(V.ellCmds(20, 20), Array(20).fill({ w: 5 }), { o: 0, al: "l" });
  assert.ok(ring.every((p) => !p.hide));
});

function design() {
  const d = AX.newDesign({ name: "TP", w: 1000, h: 1000 }, 1);
  const pg = d.pages[0].id;
  const it = AX.addItem(d, pg, { k: "text", tx: "Around we go", size: 40, al: "c", x: 100, y: 100, w: 400, h: 400, ext: { tp: { d: CIRCLE, o: 0 } } }, 1);
  return { d, it };
}

test("Atelier: text on a circle sits on it, upright along the way", () => {
  const { it } = design();
  assert.ok(AX.isCurved(it) && AX.tpOf(it));
  assert.equal(AX.textHeight(it), 400, "the box is the outline's");
  const cl = AX.curveLayout(it);
  assert.equal(cl.w, 400); assert.equal(cl.h, 400); assert.equal(cl.over, false);
  assert.equal(cl.glyphs.length, Array.from("Around we go").length);
  cl.glyphs.forEach((g) => assert.ok(near(Math.hypot(g.x, g.y), 200, 0.5), g.ch + " " + Math.hypot(g.x, g.y)));
  // centred on the top: the middle glyph is near the top, nearly level
  const mid = cl.glyphs[Math.floor(cl.glyphs.length / 2)];
  assert.ok(mid.y < -195 && Math.abs(mid.rot) < 0.2, JSON.stringify(mid));
  // the other side reverses the order of travel
  const f = JSON.parse(JSON.stringify(it));
  AX.setTp(f, { d: CIRCLE, o: 0, s: -1 });
  const fl = AX.curveLayout(f);
  assert.ok(fl.glyphs[0].x > fl.glyphs[fl.glyphs.length - 1].x, "runs right to left over the top");
  assert.ok(near(Math.abs(fl.glyphs[0].rot - cl.glyphs[cl.glyphs.length - 1].rot), Math.PI, 0.1));
});

test("Atelier: ext.tp survives the record and bad values fall back", () => {
  const { d } = design();
  const n = M.normDoc(JSON.parse(JSON.stringify(d)));
  const t = n.items.find((x) => x.ax.k === "text");
  assert.deepEqual(t.ext.tp, { d: CIRCLE, o: 0 });
  assert.equal(JSON.stringify(M.normDoc(JSON.parse(JSON.stringify(n)))), JSON.stringify(n), "idempotent");
  assert.equal(AX.tpOf({ ax: { k: "text" }, ext: { tp: { d: 5 } } }), null);
  assert.equal(AX.tpOf({ ax: { k: "shape" }, ext: { tp: { d: CIRCLE } } }), null);
  assert.equal(AX.tpOf({ ax: { k: "text" }, ext: { tp: { d: CIRCLE, o: 400 } } }).o, 100);
  const x = { ax: { k: "text" }, ext: { lnk: "https://example.com", tp: { d: CIRCLE, o: 3 } } };
  AX.setTp(x, null);
  assert.deepEqual(x.ext, { lnk: "https://example.com" });
  AX.setTp(x, { d: CIRCLE, o: 12.3456, s: -1 });
  assert.deepEqual(x.ext.tp, { d: CIRCLE, o: 12.35, s: -1 });
  // an open path: glyphs past its end are left out
  const o = { ax: { k: "text", tx: "a long line of text", size: 40 }, ext: { tp: { d: "M0 0L1 0", o: 0 } }, w: 100, h: 1 };
  const ol = AX.curveLayout(o);
  assert.ok(ol.over && ol.glyphs.length < 19 && ol.glyphs.length > 0);
});

function layoutDoc() {
  const d = M.newDoc({ name: "TP", w: 400, h: 400, pages: 1 }, 1000);
  const pg = M.pagesInOrder(d)[0].id;
  d.stories.push({ id: "st-c", m: 1000, paras: [{ ps: "ps-body", runs: [{ t: "Round and round the text goes. " }] }, { ps: "ps-body", runs: [{ t: "Second line." }] }] });
  d.items.push({ id: "it-c", m: 1000, t: "text", pg, x: 50, y: 50, w: 200, h: 200, story: "st-c", seq: 1, z: 1, ext: { tp: { d: CIRCLE, o: 0 } } });
  d.items.push({ id: "it-n", m: 1000, t: "text", pg, x: 50, y: 300, w: 300, h: 60, story: "st-c", seq: 2, z: 2 });
  return M.normDoc(d);
}

test("Layout: a path frame takes one line, bent onto the outline; the rest flows on", () => {
  const d = layoutDoc();
  assert.ok(d.items.find((x) => x.id === "it-c").ext.tp, "ext.tp kept by the Layout model");
  const L = R.computeLayout(d);
  const a = L.frames["it-c"].lines, b = L.frames["it-n"].lines;
  assert.equal(a.length, 1, "one line on the path");
  assert.ok(b.length >= 1, "the next paragraph goes to the next frame");
  assert.equal(L.overset["st-c"], undefined);
  const gl = [].concat(...a[0].runs.map((r) => r.g || []));
  assert.ok(gl.length > 10);
  gl.forEach((g) => assert.ok(near(Math.hypot(g.x - 100, g.y - 100), 100, 0.5), JSON.stringify(g)));
  // the line is centred on the anchor (the top) on a closed outline
  const xs = gl.map((g) => g.x), ys = gl.map((g) => g.y);
  assert.ok(Math.min(...ys) < 2, "reaches the top");
  assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - 100) < 40);
  assert.ok(b[0].runs.every((r) => !r.g), "a plain frame is not bent");
  assert.ok(R.pathOf(d.items.find((x) => x.id === "it-c")));
});

test("Layout: the PDF draws path text glyph by glyph", () => {
  global.window = global.window || global;
  const { jsPDF } = require(path.join(ROOT, "vendor/jspdf.umd.min.js"));
  const pdf = P.build(layoutDoc(), {}, { jsPDF });
  const raw = Buffer.from(pdf.output("arraybuffer")), out = raw.toString("latin1");
  assert.ok(out.startsWith("%PDF-"));
  // the page's content streams, inflated: one turn per glyph
  const zlib = require("zlib");
  let text = "", at = 0;
  for (;;) {
    const s = out.indexOf("stream\n", at);
    if (s < 0) break;
    const e = out.indexOf("endstream", s);
    try { text += zlib.inflateSync(raw.subarray(s + 7, e)).toString("latin1"); } catch (err) { /* not deflated */ }
    at = e + 9;
  }
  assert.ok((text.match(/ cm\b/g) || []).length > 10, "each glyph turned");
});

test("both apps offer it and the strings exist in EN, EL and DE", () => {
  const PE = require(path.join(ROOT, "designkit/pathedit.js"));
  ["pe.textPath", "pe.tpStart", "pe.tpFlip", "pe.tpOff", "pe.tpNeed", "pe.tpOver"].forEach((k) => {
    assert.ok(PE.STR.en[k] && PE.STR.el[k], k);
  });
  const de = fs.readFileSync(path.join(ROOT, "i18n/de/designkit.js"), "utf8");
  assert.match(de, /"pe\.textPath"/);
  assert.match(fs.readFileSync(path.join(ROOT, "atelier/vector.js"), "utf8"), /VEC\.textPath = textPath/);
  assert.match(fs.readFileSync(path.join(ROOT, "layout/vector.js"), "utf8"), /VEC\.textPath = textPath/);
});
