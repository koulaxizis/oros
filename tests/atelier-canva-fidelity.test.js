// Atelier wave CV-F1: a Canva design imported as Canva drew it — line
// pitch in Canva's whole pixels, the first baseline where Canva puts it,
// words in their own colour (atelier/pptx.js, ax.js, draw.js).
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
global.window = global.window || {};
const P = require("../atelier/pptx.js");
const AX = require("../atelier/ax.js");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const near = (a, b, e) => assert.ok(Math.abs(a - b) <= e, a + " ≈ " + b);

test("line pitch: Canva's points in whole pixels of 0.75 pt, cut down, as a % to a tenth", () => {
  // 13.96 pt at 10.5 pt: 18.61 px → 18 px = 13.5 pt (Canva's PDF: 13.495 pt)
  assert.equal(P.leadPct(13.96, 10.5), 128.6);
  // 16.57 pt at 11.84 pt: 22.09 px → 22 px = 16.5 pt (Canva's PDF: 16.515 pt)
  near(11.84 * P.leadPct(16.57, 11.84) / 100, 16.5, 0.01);
  // a whole number of pixels stays (42 pt = 56 px)
  assert.equal(P.leadPct(42, 30), 140);
  // and the range Atelier keeps
  assert.equal(P.leadPct(1, 30), 70);
  assert.equal(P.leadPct(400, 30), 300);
});

test("first baseline: a CSS line box plus a share of the pitch, not the font's ascent", () => {
  // Arima 10.5 pt, pitch 13.5 pt, ascent 1.073, descent 0.56 → Canva's PDF: 9.06 pt below the top
  near(P.canvaBase(13.5, 10.5, 1.073 * 10.5, 0.56 * 10.5), 9.06, 0.07 * 10.5);    // within the fit's spread
  // One Little Font 11.84 pt, pitch 16.5 pt, ascent 1.149, descent 0.649 → 11.64 pt
  near(P.canvaBase(16.5, 11.84, 1.149 * 11.84, 0.649 * 11.84), 11.64, 0.07 * 11.84);
  // Canva Sans Display 90 pt at 0.9: 67.5 pt
  near(P.canvaBase(81, 90, 1.069 * 90, 0.293 * 90), 67.5, 0.1 * 90);
});

test("line height keeps a tenth of a per cent; older whole values stay", () => {
  const n = AX.normAx({ k: "text", tx: "x", lh: 128.57 }, { t: "rect" });
  assert.equal(n.lh, 128.6);
  assert.equal(AX.normAx({ k: "text", tx: "x", lh: 133 }, { t: "rect" }).lh, 133);
  assert.equal(AX.normAx({ k: "text", tx: "x", lh: 120 }, { t: "rect" }).lh, undefined, "the default is omitted");
});

test("a word in its own colour: ext.runs fc, painted where the text's colour is used", () => {
  const it = { t: "rect", w: 400, h: 60, ax: { k: "text", tx: "ΘΑΑΝΑ", size: 40, fc: "#ffffff" }, ext: { runs: [{ n: 2 }, { n: 3, fc: "#FF751F" }] } };
  const cols = [];
  AX.textLayout(it).lines.forEach((ln) => ln.runs.forEach((r) => { if (r.t.trim()) cols.push(r.t + "=" + AX.runColor({ color: "#ffffff" }, "#ffffff", r)); }));
  assert.deepEqual(cols, ["ΘΑ=#ffffff", "ΑΝΑ=#ff751f"]);
  // a pass in another colour (a shadow, the glitch's cyan) keeps its own
  const r = AX.textLayout(it).lines[0].runs.find((x) => x.t === "ΑΝΑ");
  assert.equal(AX.runColor({ color: "#00e5ff" }, "#ffffff", r), "#00e5ff");
  // a font picked for the whole text keeps the colours
  const c = JSON.parse(JSON.stringify(it));
  c.ext.runs[1].fam = "uf_" + "ab".repeat(8);
  AX.dropRunFonts(c);
  assert.deepEqual(c.ext.runs, [{ n: 2 }, { n: 3, fc: "#FF751F" }]);
  const D = read("atelier/draw.js"), PO = read("atelier/pdfout.js"), W = read("atelier/webout.js");
  assert.ok(D.includes("AX.runColor(p, fill, r)") && PO.includes("AX.runColor(p, ax.fc || \"#000000\", r)") && W.includes("AX.runColor(p, ax.fc || \"#000000\", r)"));
});
