// orOS designkit — Scribus's own line ending and first line in frames
// from Scribus (LY-FIT, designkit/text.js sfit; layout/sla.js sets it).
// Synthetic text.
// Run: node --test tests/layout-fit.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const S = require(path.join(ROOT, "layout/sla.js"));
T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});
const P = (o) => Object.assign({ id: "p", m: 1, name: "P", font: "serif", size: 10, lead: 15, align: "l" }, o || {});
const lay = (paras, f, ps) => T.layoutChain({ paras }, [Object.assign({ id: "a", h: 200 }, f)], { ps: ps || [P()], cs: [] }).frames.a.lines;
const words = (l) => l.runs.filter((r) => r.t.trim()).map((r) => r.t).join(" ");

test("sfit: a line ends once its end rounded up reaches the column's right edge rounded down", () => {
  const txt = "one two three four";
  const w = T.measure("serif-r", txt, 10, 0);
  // room for the line with 0.6 pt to spare: it fits as before ...
  const W = Math.floor(w) + 1.6;
  assert.equal(lay([{ ps: "p", runs: [{ t: txt }] }], { w: W }).length, 1);
  // ... but Scribus rounds: ceil(w) >= floor(W) ends the line before "four"
  const ls = lay([{ ps: "p", runs: [{ t: txt }] }], { w: W, sfit: true });
  assert.ok(Math.ceil(w) >= Math.floor(W));
  assert.equal(ls.length, 2);
  assert.equal(words(ls[1]), "four");
  // a column a whole point wider holds it again
  assert.equal(lay([{ ps: "p", runs: [{ t: txt }] }], { w: Math.ceil(w) + 1.01, sfit: true }).length, 1);
});

test("sfit: the first line sits on the ascent of the font its words are set in, not the style's", () => {
  const paras = [{ ps: "p", runs: [{ t: "Words in sans", font: "sans" }] }];
  const own = lay(paras, { w: 300, sfit: true })[0], style = lay(paras, { w: 300 })[0];
  assert.ok(Math.abs(own.y - T.ascent("sans-r", 10)) < 0.01, "sans ascent");
  assert.ok(Math.abs(style.y - T.ascent("serif-r", 10)) < 0.01, "without sfit: the style's font, as before");
  // mixed fonts: the style's font
  const mix = lay([{ ps: "p", runs: [{ t: "Words ", font: "sans" }, { t: "mixed" }] }], { w: 300, sfit: true })[0];
  assert.ok(Math.abs(mix.y - T.ascent("serif-r", 10)) < 0.01);
});

test("Scribus text frames come in with sfit", () => {
  const sla = `<?xml version="1.0" encoding="UTF-8"?>
<SCRIBUSUTF8NEW Version="1.5.8"><DOCUMENT ANZPAGES="1" PAGEWIDTH="400" PAGEHEIGHT="600" BORDERLEFT="40" BORDERRIGHT="40" BORDERTOP="40" BORDERBOTTOM="40" BOOK="0" UNITS="1">
  <STYLE NAME="Default Paragraph Style" FONTSIZE="10"/>
  <PAGE PAGEXPOS="100" PAGEYPOS="20" PAGEWIDTH="400" PAGEHEIGHT="600" NUM="0" LEFT="0"/>
  <PAGEOBJECT XPOS="140" YPOS="60" WIDTH="300" HEIGHT="200" PTYPE="4" OwnPage="0" ItemID="1">
    <StoryText><DefaultStyle/><ITEXT CH="Text"/><trail/></StoryText>
  </PAGEOBJECT>
</DOCUMENT></SCRIBUSUTF8NEW>`;
  const d = S.convert(sla, { now: 5, name: "F" }).doc;
  const fr = d.items.find((it) => it.t === "text");
  assert.equal(fr.ext.sfit, 1);
});

test("render passes sfit to the engine", () => {
  const src = fs.readFileSync(path.join(ROOT, "designkit/render.js"), "utf8");
  assert.equal((src.match(/sfit: !!\(/g) || []).length, 2);
});

test("a no-break space and a line break keep their own font and size", () => {
  const sla = `<?xml version="1.0" encoding="UTF-8"?>
<SCRIBUSUTF8NEW Version="1.5.8"><DOCUMENT ANZPAGES="1" PAGEWIDTH="400" PAGEHEIGHT="600" BORDERLEFT="40" BORDERRIGHT="40" BORDERTOP="40" BORDERBOTTOM="40" BOOK="0" UNITS="1">
  <STYLE NAME="Default Paragraph Style" FONTSIZE="10"/>
  <PAGE PAGEXPOS="100" PAGEYPOS="20" PAGEWIDTH="400" PAGEHEIGHT="600" NUM="0" LEFT="0"/>
  <PAGEOBJECT XPOS="140" YPOS="60" WIDTH="300" HEIGHT="200" PTYPE="4" OwnPage="0" ItemID="1">
    <StoryText><DefaultStyle/><ITEXT FONTSIZE="14" CH="one"/><nbspace FONTSIZE="14"/><ITEXT FONTSIZE="14" CH="two"/><breakline FONTSIZE="14"/><ITEXT FONTSIZE="14" CH="three"/><trail/></StoryText>
  </PAGEOBJECT>
</DOCUMENT></SCRIBUSUTF8NEW>`;
  const d = S.convert(sla, { now: 5, name: "F" }).doc;
  const runs = d.stories[0].paras[0].runs;
  // one run: the space and the break are set like the words around them
  assert.equal(runs.length, 1);
  assert.equal(runs[0].t, "one two\nthree");
});
