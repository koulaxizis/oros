// Atelier wave CV-F2: Canva's text effects and curved text, read from
// Canva's PDF of the design (atelier/canvafx.js). Glyph lists here are
// made up; they follow how Canva's PDFs draw a text box: effect layers,
// an invisible copy, then the text.
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
global.window = global.window || {};
const CF = require("../atelier/canvafx.js");
const FX = require("../designkit/fx.js");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let seq = 0;
// one line of text as glyphs: 0.6 × size per letter
function line(text, x, y, size, fill, a, rot) {
  return Array.from(text).map((ch, i) => ({ i: seq++, ch, x: x + i * size * 0.6, y, rot: rot || 0, size, adv: size * 0.6, fill, stroke: fill, mode: 0, lw: 1, a: a == null ? 1 : a }));
}
const box = (tx, fc, size, x, y) => ({ tx, fc, size, x, y: y - size, w: 400, h: size * 1.3 });

test("glitch: a cyan copy left, another colour right, then the text", () => {
  const S = 100, g = 4;
  const gl = [].concat(line("ABC", 100 + g, 200, S, "#ff00ff"), line("ABC", 100 - g, 200, S, "#00ffff"),
    line("ABC", 100, 200, S, "#000000", 0), line("ABC", 100, 200, S, "#ffffff"));
  const [lk] = CF.pageLooks([box("ABC", "#ffffff", S, 100, 200)], gl);
  assert.equal(lk.tfx.type, "glitch");
  assert.equal(lk.tfx.color, "#ff00ff");
  assert.equal(lk.tfx.off, CF.offFor(2 * g, S));
  // Atelier draws it with Canva's colours; a glitch without a colour keeps Atelier's own
  const p = FX.textPasses(lk.tfx, S, "#ffffff");
  assert.deepEqual([p[0].color, p[1].color], ["#00ffff", "#ff00ff"]);
  const own = FX.textPasses({ type: "glitch" }, S, "#ffffff");
  assert.deepEqual([own[0].color, own[1].color], ["#00e5ff", "#ff2bd6"]);
});

test("shadow drawn a line at a time between invisible copies; the text is the opaque pass", () => {
  const S = 60, d = 5;
  const gl = [].concat(line("ONE", 50 + d, 100 + d, S, "#737373", 0.4), line("ONE", 50, 100, S, "#000000", 0),
    line("TWO", 50 + d, 170 + d, S, "#737373", 0.4), line("TWO", 50, 170, S, "#000000", 0),
    line("ONE", 50, 100, S, "#ff751f"), line("TWO", 50, 170, S, "#ff751f"));
  const [lk] = CF.pageLooks([box("ONE\nTWO", "#ff751f", S, 50, 100)], gl);
  assert.equal(lk.tfx.type, "shadow");
  assert.equal(lk.tfx.alpha, 40);
  assert.equal(lk.tfx.dir, 45);
  assert.equal(lk.tfx.color, "#737373");
  assert.equal(lk.tfx.off, CF.offFor(Math.hypot(d, d), S));
});

test("boxes of the same text stacked: each takes its own layers, in drawing order", () => {
  const S = 80;
  const gl = [].concat(line("HEY", 10, 100, S, "#000000", 0), line("HEY", 10, 100, S, "#ffffff"),
    line("HEY", 16, 106, S, "#ffffff", 0.4), line("HEY", 10, 100, S, "#000000", 0), line("HEY", 10, 100, S, "#ffffff"));
  const L = CF.pageLooks([box("HEY", "#ffffff", S, 10, 100), box("HEY", "#ffffff", S, 10, 100)], gl);
  assert.equal(L[0].tfx, undefined, "the first box has no effect");
  assert.equal(L[1].tfx.type, "shadow");
  assert.equal(L[1].tfx.alpha, 40);
});

test("two texts whose layers both come before both texts", () => {
  const S = 90;
  const gl = [].concat(line("AB", 0, 100, S, "#ff00ff"), line("AB", -8, 100, S, "#00ffff"),
    line("CD", 8, 300, S, "#ff0000"), line("CD", -8, 300, S, "#00ffff"),
    line("AB", -4, 100, S, "#00bf63"), line("CD", 0, 300, S, "#ff3131"));
  const L = CF.pageLooks([box("AB", "#00bf63", S, -4, 100), box("CD", "#ff3131", S, 0, 300)], gl);
  assert.deepEqual(L.map((l) => l.tfx.type), ["glitch", "glitch"]);
  assert.equal(L[1].tfx.color, "#ff0000");
});

test("no copy in the PDF: no effect; an invisible copy is never the text", () => {
  const gl = [].concat(line("XY", 0, 50, 40, "#000000", 0), line("XY", 0, 50, 40, "#222222"));
  const [lk] = CF.pageLooks([box("X Y", "#222222", 40, 0, 50)], gl);
  assert.equal(lk.tfx, undefined);
  assert.equal(lk.main[0].a, 1);
  assert.equal(CF.pageLooks([box("QQ", "#000000", 40, 0, 50)], gl)[0], null, "a text that is not in the PDF");
});

test("curved text: the turn from first to last letter gives Atelier's curve", () => {
  const S = 50, n = 7, gl = [];
  for (let i = 0; i < n; i++) {
    const a = -0.6 + 1.2 * i / (n - 1);
    gl.push.apply(gl, line("ABCDEFG"[i], 200 + Math.sin(a) * 300, 400 - Math.cos(a) * 300, S, "#000000", 1, a));
  }
  const [lk] = CF.pageLooks([{ tx: "ABCDEFG", fc: "#000000", size: S, x: 0, y: 90, w: 500, h: 200 }], gl);
  assert.ok(lk.arc, "an arc");
  near(lk.arc.rot1 - lk.arc.rot0, 1.2);
  // Atelier's turn grows with the curve: twice the turn, twice the curve
  assert.equal(CF.curveFor(lk.arc, -0.3, 0.3, 50), 100);
  assert.equal(CF.curveFor(lk.arc, -0.6, 0.6, 50), 50);
  assert.equal(CF.curveFor({ rot0: 0.6, rot1: -0.6 }, -0.6, 0.6, 50), -50, "a ∪ arc");
  function near(a, b) { assert.ok(Math.abs(a - b) < 1e-9, a + " ≈ " + b); }
});

test("import: a PowerPoint with Canva's PDF beside it takes the effects (io.js, sw.js)", () => {
  const io = read("atelier/io.js");
  assert.ok(io.includes('loadScript("canvafx.js")'), "canvafx.js loads on first use");
  assert.ok(io.includes("window.AtelierCanvaFx.apply(doc, pages, AX, AT.M)"));
  assert.ok(io.includes("importPptxFile(f, false, { real: real, pdf: pdf })"));
  assert.ok(io.includes('/\\.pdf$/i.test(e.name) && decks['), "a folder in Files brings the PDF beside a .pptx");
  // an offset copy in the text's colour keeps one colour (coloured words)
  const AX = require("../atelier/ax.js");
  assert.equal(AX.runColor({ color: "#ffffff", dx: 3, dy: 3 }, "#ffffff", { color: "#ff751f" }), "#ffffff");
  assert.equal(AX.runColor({ color: "#ffffff", dx: 0, dy: 0 }, "#ffffff", { color: "#ff751f" }), "#ff751f");
});

test("CV-F3: a gradient with see-through stops stays see-through (a picture that keeps them)", () => {
  const P = require("../atelier/pptx.js");
  const x = P.parseXml('<p:spPr xmlns:p="p" xmlns:a="a"><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="000000"><a:alpha val="0"/></a:srgbClr></a:gs><a:gs pos="100000"><a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill></p:spPr>');
  const f = P.fillOf(x.c[0], {});
  assert.deepEqual(f.ga.st, [[0, "#000000", 0], [1, "#000000", 0.4]]);
  assert.equal(f.ga.ang, 90);
  const sv = P.svgOf("M0 0H100V50H0Z", 100, 50, { c: f.g.a, a: 1, ga: f.ga }).svg;
  assert.ok(sv.includes('stop-opacity="0.4"') && sv.includes('fill="url(#g)"'));
  assert.ok(sv.includes('x1="50" y1="0" x2="50" y2="50"'), "top to bottom");
  // opaque stops: no picture needed
  const o = P.fillOf(P.parseXml('<p:spPr xmlns:p="p" xmlns:a="a"><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs><a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs></a:gsLst></a:gradFill></p:spPr>').c[0], {});
  assert.equal(o.ga, undefined);
});

test("CV-F3: a text box narrower than twice its size still shows its line (designkit text.js)", () => {
  const AX = require("../atelier/ax.js");
  const it = { t: "rect", x: 0, y: 0, w: 27.5, h: 27, ax: { k: "text", fc: "#000000", tx: "1", font: "sans", size: 21.32, b: 1, al: "c", lh: 126.6 } };
  assert.equal(AX.textLayout(it).lines.length, 1);
});

test("CV-F3: a word a hair wider than its box stays whole; a clearly wider one still breaks", () => {
  const AX = require("../atelier/ax.js"), T = require("../designkit/text.js");
  const w = T.measure(T.fontKey("sans", 0, 0), "WWWW", 20, 0);
  const it = { t: "rect", x: 0, y: 0, w: w - 0.03, h: 30, ax: { k: "text", fc: "#000000", tx: "WWWW", font: "sans", size: 20 } };
  assert.equal(AX.textLayout(it).lines.length, 1);
  it.w = w - 2;
  assert.equal(AX.textLayout(it).lines.length, 2);
  // a slice left by a wrap must be wide enough; the whole line always stays
  assert.ok(T.freeSegments(0, 10, [], 0, 10, 40).length === 1, "the whole line of a narrow frame stays");
});
