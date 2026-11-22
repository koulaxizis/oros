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

test("CV-F4: Canva's outline (the text again in a font of outlined letters) is Atelier's outline", () => {
  const S = 100, t = 7.5;   // the outlined letters are 7.5 wider: a line of 7.5 across the edge
  const ol = line("ABC", 100, 200, S, "#000000").map((g) => Object.assign(g, { t3: 1, inkw: 50 + t }));
  const mn = line("ABC", 100, 200, S, "#ffffff").map((g) => Object.assign(g, { inkw: 50 }));
  const [lk] = CF.pageLooks([box("ABC", "#ffffff", S, 100, 200)], [].concat(ol, mn));
  assert.equal(lk.tfx.type, "outline");
  assert.equal(lk.tfx.color, "#000000");
  assert.equal(lk.tfx.thick, Math.round(t / (S * 0.0024)));
  // Atelier draws a line that wide under the text
  const p = FX.textPasses(lk.tfx, S, "#ffffff");
  assert.ok(Math.abs(p[0].width - t) < 0.2 && p[0].mode === "stroke");
  // the same copy in an ordinary font is no outline
  const plain = line("ABC", 100, 200, S, "#000000");
  assert.equal(CF.pageLooks([box("ABC", "#ffffff", S, 100, 200)], [].concat(plain, line("ABC", 100, 200, S, "#ffffff")))[0].tfx, undefined);
});

test("CV-F4: a picture drawn just before the text that frames its letters is its effect picture", () => {
  const S = 50, gl = line("GLOW", 100, 200, S, "#ffffff");
  const ink = { x: 100, y: 200 - S * 0.75, w: 4 * S * 0.6, h: S * 0.95 };
  const imgs = [
    { at: 0, straight: true, x: ink.x - 20, y: ink.y - 20, w: ink.w + 40, h: ink.h + 40 },     // around the letters
    { at: 0, straight: true, x: 0, y: 0, w: 1000, h: 1000 },                                  // the background photo
    { at: 0, straight: false, x: ink.x - 20, y: ink.y - 20, w: ink.w + 40, h: ink.h + 40 }    // turned: not ours
  ];
  const [lk] = CF.pageLooks([box("GLOW", "#ffffff", S, 100, 200)], gl, imgs);
  assert.deepEqual(lk.pics, [imgs[0]]);
  // drawn after the text: not its effect
  const late = [Object.assign({}, imgs[0], { at: gl[gl.length - 1].i + 1 })];
  assert.equal(CF.pageLooks([box("GLOW", "#ffffff", S, 100, 200)], gl, late)[0].pics, undefined);
});

test("CV-F4: lines, size, pitch and first baseline as Canva set them", () => {
  const AX = require("../atelier/ax.js");
  // Canva: 30 pt letters, two lines 40 apart, broken after "ONE"
  const S = 30, gl = [].concat(line("ONE", 10, 100, S, "#000000"), line("TWO", 10, 140, S, "#000000"));
  assert.deepEqual(CF.linesOf(gl, S).map((l) => [l.y, l.n]), [[100, 3], [140, 3]]);
  const it = { t: "rect", x: 10, y: 60, w: 400, h: 40, ax: { k: "text", fc: "#000000", tx: "ONE TWO", font: "sans", size: 32 } };
  assert.ok(CF.snap(it, gl, AX));
  assert.equal(it.ax.size, 30);
  assert.equal(it.ax.tx, "ONE\nTWO");
  assert.ok(Math.abs(it.ax.lh - 133.3) < 0.1, "pitch 40 / 30");
  const L = AX.textLayout(it).lines;
  assert.ok(Math.abs(it.y + L[0].y - 100) < 0.01, "the first baseline on Canva's");
  // nothing to change the second time
  assert.equal(CF.snap(it, gl, AX), false);
});

test("CV-F4: a Canva account import also brings Canva's PDF (atelier/canva.js, relay)", () => {
  const cv = read("atelier/canva.js");
  assert.ok(cv.includes('authed({ act: "export", id: d.id, kind: kind })'));
  assert.ok(cv.includes('file("pdf")') && cv.includes("importPptx(new File([pptx]") && cv.includes(", true, opts)"));
  assert.ok(cv.includes('=== "%PDF-"'), "an older relay's answer is not taken for a PDF");
});
