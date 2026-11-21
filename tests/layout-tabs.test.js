// orOS designkit — tabs and small text in a big style (LY-TAB,
// designkit/text.js), and Scribus line breaks and tabs coming in as
// such (layout/sla.js). Synthetic text.
// Run: node --test tests/layout-tabs.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const S = require(path.join(ROOT, "layout/sla.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});
const P = (ext, o) => Object.assign({ id: "p", m: 1, name: "P", font: "serif", size: 10, lead: 15, align: "l", ext }, o || {});
const lay = (paras, w, h, ps, cs) => T.layoutChain({ paras }, [{ id: "a", w, h }], { ps: ps || [P()], cs: cs || [] }).frames.a.lines;
const runAt = (line, t) => line.runs.find((r) => r.t === t);

test("a tab moves on to the next 36 pt stop from the left indent, or the style's own stops", () => {
  let ls = lay([{ ps: "p", runs: [{ t: "\tone\ttwo" }] }], 400, 100);
  assert.ok(Math.abs(runAt(ls[0], "one").x - 36) < 0.01, "first stop");
  assert.ok(Math.abs(runAt(ls[0], "two").x - 72) < 0.01, "second stop");
  ls = lay([{ ps: "p", runs: [{ t: "\tone" }] }], 400, 100, [P({ tabw: 20 }, { li: 10 })]);
  assert.ok(Math.abs(runAt(ls[0], "one").x - 30) < 0.01, "interval from the left indent");
  ls = lay([{ ps: "p", runs: [{ t: "a\tb\tc" }] }], 400, 100, [P({ tabs: [100, 50] })]);
  assert.ok(Math.abs(runAt(ls[0], "b").x - 50) < 0.01 && Math.abs(runAt(ls[0], "c").x - 100) < 0.01, "own stops, in order");
  // the tab is one character the caret can find
  const tab = ls[0].runs.find((r) => r.t === " " && r.o === 1);
  assert.ok(tab && tab.n === 1);
});

test("after a line break a tab indents the new line; a justified line never stretches its tab", () => {
  const long = "λέξη ".repeat(30).trim();
  const ls = lay([{ ps: "p", runs: [{ t: long + "\n\t" + long }] }], 200, 900, [P(null, { align: "j" })]);
  const second = ls.find((l) => l.runs.some((r) => r.t === " " && r.w > 20));
  assert.ok(second, "a line starts with the tab");
  const word = second.runs.find((r) => r.t === "λέξη");
  assert.ok(Math.abs(word.x - 36) < 0.01, "the first word sits on the stop");
  // the line before the break is not justified (ends short)
  const before = ls[ls.indexOf(second) - 1], last = before.runs[before.runs.length - 1];
  assert.ok(last.x + last.w < 200 - 1);
});

test("a 7 pt line fits a frame too short for the 10.5 pt style it is in", () => {
  const ps = [P(null, { size: 10.5, lead: 17, align: "c" })], cs = [{ id: "c", m: 1, name: "C", size: 7 }];
  const ls = lay([{ ps: "p", runs: [{ t: "Mr Grim", cs: "c" }] }], 300, 9.8, ps, cs);
  assert.equal(ls.length, 1);
  assert.ok(ls[0].y <= 9.8 - T.descent("serif-r", 7) + 0.01);
  // the same text at the style's size does not fit
  assert.equal(lay([{ ps: "p", runs: [{ t: "Mr Grim" }] }], 300, 9.8, ps).length, 0);
});

test("Scribus: line breaks stay in the paragraph, tabs stay tabs, tab stops and interval come along", () => {
  const sla = `<SCRIBUSUTF8NEW Version="1.6.2"><DOCUMENT ANZPAGES="1" PAGEWIDTH="400" PAGEHEIGHT="600" BORDERLEFT="40" BORDERRIGHT="40" BORDERTOP="40" BORDERBOTTOM="40" TabWidth="28">
  <STYLE NAME="Default Paragraph Style" FONT="Cambria Regular" FONTSIZE="10"/>
  <STYLE NAME="TOC" PARENT="Default Paragraph Style"><Tabs Type="0" Pos="120" Fill=""/><Tabs Type="1" Pos="300" Fill="."/></STYLE>
  <PAGE PAGEXPOS="100" PAGEYPOS="20" PAGEWIDTH="400" PAGEHEIGHT="600" NUM="0"/>
  <PAGEOBJECT XPOS="140" YPOS="60" OwnPage="0" PTYPE="4" WIDTH="320" HEIGHT="500" ItemID="1"><StoryText>
    <DefaultStyle PARENT="Default Paragraph Style"/>
    <ITEXT CH="first"/><breakline/><tab/><ITEXT CH="second"/><para ALIGN="3" LINESP="19" FIRST="14"/>
    <ITEXT CH="Chapter"/><tab/><ITEXT CH="7"/><trail PARENT="TOC"/>
  </StoryText></PAGEOBJECT></DOCUMENT></SCRIBUSUTF8NEW>`;
  const d = S.convert(sla, { now: 5 }).doc;
  const base = d.pstyles.find((s) => s.id === "ps-base");
  assert.equal(base.ext.tabw, 28);
  const st = d.stories[0];
  assert.equal(st.paras.length, 2);
  assert.equal(st.paras[0].runs.map((r) => r.t).join(""), "first\n\tsecond");
  const p0 = M.find(d.pstyles, st.paras[0].ps);
  assert.equal(p0.align, "j"); assert.equal(p0.lead, 19); assert.equal(p0.fi, 14);
  const toc = d.pstyles.find((s) => s.name === "TOC");
  assert.deepEqual(toc.ext.tabs, [120, 300]);
  assert.equal(st.paras[1].ps, toc.id);
});

test("a Scribus frame break: the text after it starts the next frame, as the same paragraph going on", () => {
  const sla = `<SCRIBUSUTF8NEW Version="1.6.2"><DOCUMENT ANZPAGES="1" PAGEWIDTH="400" PAGEHEIGHT="600" BORDERLEFT="40" BORDERRIGHT="40" BORDERTOP="40" BORDERBOTTOM="40">
  <STYLE NAME="Default Paragraph Style" FONT="Cambria Regular" FONTSIZE="10" FIRST="14" VOR="6"/>
  <PAGE PAGEXPOS="100" PAGEYPOS="20" PAGEWIDTH="400" PAGEHEIGHT="600" NUM="0"/>
  <PAGEOBJECT XPOS="140" YPOS="60" OwnPage="0" PTYPE="4" WIDTH="320" HEIGHT="500" ItemID="1"><StoryText>
    <DefaultStyle PARENT="Default Paragraph Style"/>
    <ITEXT CH="one"/><breakframe/><ITEXT CH="two"/><para/>
    <ITEXT CH="three"/><para/><breakframe/>
    <ITEXT CH="four"/><trail/>
  </StoryText></PAGEOBJECT></DOCUMENT></SCRIBUSUTF8NEW>`;
  const d = S.convert(sla, { now: 5 }).doc;
  const st = d.stories[0], txt = st.paras.map((p) => p.runs.map((r) => r.t).join(""));
  assert.deepEqual(txt, ["one", "two", "three", "four"]);
  const sty = st.paras.map((p) => M.find(d.pstyles, p.ps));
  const ext = (s) => (s.ext && s.ext.brk) || "";
  assert.equal(ext(sty[0]), ""); assert.equal(ext(sty[2]), "");
  assert.equal(ext(sty[1]), "col", "the text after the break goes on in the next frame");
  assert.equal(sty[1].fi, 0, "no first-line indent where the paragraph goes on");
  assert.equal(ext(sty[3]), "col", "a break before a paragraph starts it in the next frame");
  assert.notEqual(sty[3].fi, 0, "a paragraph that starts there keeps its own indent");
  const lines = T.layoutChain(st, [{ id: "a", w: 200, h: 300 }, { id: "b", w: 200, h: 300 }, { id: "c", w: 200, h: 300 }], { ps: d.pstyles, cs: d.cstyles }).frames;
  assert.equal(lines.a.lines.length, 1); assert.equal(lines.b.lines.length, 2); assert.equal(lines.c.lines.length, 1);
});

test("a line break at the end of a paragraph leaves an empty line after it", () => {
  const n = (t) => lay([{ ps: "p", runs: [{ t }] }, { ps: "p", runs: [{ t: "z" }] }], 200, 300).length;
  assert.equal(n("a"), 2);
  assert.equal(n("a\n"), 3);
  assert.equal(n("a\nb"), 3);
  const L = lay([{ ps: "p", runs: [{ t: "a\n" }] }], 200, 300);
  assert.equal(L[1].o0, 2, "the caret after the break sits on the empty line");
});
