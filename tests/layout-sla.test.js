// Layout: Scribus .sla import (layout/sla.js). A small 1.5-style
// document covers pages, facing + masters, colours (CMYK, RGB, tints),
// paragraph styles with parents, a story threaded over two frames
// with page-number fields and character overrides, linked and
// inline images, shapes, a rotated line, a group, plus the 1.4 form
// (ITEXT inside the object, index threads) and hostile input.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "designkit/model.js"));
const S = require(path.join(ROOT, "layout/sla.js"));
const J = (x) => JSON.stringify(x);

const SLA15 = `<?xml version="1.0" encoding="UTF-8"?>
<SCRIBUSUTF8NEW Version="1.5.8">
<!-- a comment with <tags> -->
<DOCUMENT ANZPAGES="2" PAGEWIDTH="419.53" PAGEHEIGHT="595.28" BORDERLEFT="42" BORDERRIGHT="30" BORDERTOP="40" BORDERBOTTOM="50" BOOK="1" UNITS="1" AUTOSPALTEN="2" ABSTSPALTEN="12" BleedTop="8.5" BleedBottom="8.5" BleedLeft="8.5" BleedRight="8.5" TITLE="Δοκιμή &amp; test">
  <COLOR NAME="Black" SPACE="CMYK" C="0" M="0" Y="0" K="100"/>
  <COLOR NAME="Brand Red" SPACE="CMYK" C="0" M="90" Y="80" K="0"/>
  <COLOR NAME="Sky" SPACE="RGB" R="40" G="150" B="230"/>
  <COLOR NAME="Old" RGB="#ff8000"/>
  <STYLE NAME="Default Paragraph Style" FONT="Noto Serif Regular" FONTSIZE="10" LINESPMode="0" LINESP="13" ALIGN="0" FCOLOR="Black"/>
  <STYLE NAME="Heading" PARENT="Default Paragraph Style" FONT="Open Sans Bold" FONTSIZE="20" LINESP="24" NACH="6"/>
  <STYLE NAME="Sub" PARENT="Heading" FONTSIZE="14" FCOLOR="Brand Red"/>
  <MASTERPAGE PAGEXPOS="100" PAGEYPOS="20" PAGEWIDTH="419.53" PAGEHEIGHT="595.28" NUM="0" NAM="Normal Left" LEFT="1"/>
  <MASTERPAGE PAGEXPOS="600" PAGEYPOS="20" PAGEWIDTH="419.53" PAGEHEIGHT="595.28" NUM="1" NAM="Normal Right" LEFT="0"/>
  <PAGE PAGEXPOS="100" PAGEYPOS="20" PAGEWIDTH="419.53" PAGEHEIGHT="595.28" NUM="0" MNAM="Normal Right" LEFT="0"/>
  <PAGE PAGEXPOS="100" PAGEYPOS="700" PAGEWIDTH="419.53" PAGEHEIGHT="595.28" NUM="1" MNAM="Normal Left" LEFT="1"/>
  <MASTEROBJECT XPOS="650" YPOS="580" WIDTH="300" HEIGHT="16" PTYPE="4" OnMasterPage="Normal Right" OwnPage="1" PCOLOR="None" PCOLOR2="None" ItemID="900">
    <StoryText><DefaultStyle/><ITEXT CH="Page "/><var name="pgno"/><ITEXT CH=" of "/><var name="pgco"/><trail/></StoryText>
  </MASTEROBJECT>
  <PAGEOBJECT XPOS="142" YPOS="60" WIDTH="340" HEIGHT="200" PTYPE="4" OwnPage="0" COLUMNS="2" COLGAP="10" EXTRA="4" TEXTRA="4" BEXTRA="4" REXTRA="4" PCOLOR="None" PCOLOR2="None" ItemID="101" NEXTITEM="102" BACKITEM="-1">
    <StoryText>
      <DefaultStyle/>
      <ITEXT CH="Τίτλος"/><para PARENT="Heading"/>
      <ITEXT CH="Plain then "/><ITEXT FONT="Noto Serif Bold" CH="bold"/><ITEXT CH=" and "/><ITEXT FONTSIZE="14" FCOLOR="Sky" CH="big blue"/><tab/><ITEXT CH="end."/><para ALIGN="1"/>
      <ITEXT CH="Subtitle &lt;b&gt;"/><para PARENT="Sub"/>
      <ITEXT CH="line one"/><breakline/><ITEXT CH="line two"/><trail/>
    </StoryText>
  </PAGEOBJECT>
  <PAGEOBJECT XPOS="142" YPOS="740" WIDTH="340" HEIGHT="400" PTYPE="4" OwnPage="1" PCOLOR="None" PCOLOR2="None" ItemID="102" NEXTITEM="-1" BACKITEM="101"><StoryText><DefaultStyle/></StoryText></PAGEOBJECT>
  <PAGEOBJECT XPOS="142" YPOS="300" WIDTH="200" HEIGHT="120" PTYPE="2" OwnPage="0" PFILE="images/photo one.jpg" SCALETYPE="1" PCOLOR="None" PCOLOR2="None" ItemID="103"/>
  <PAGEOBJECT XPOS="350" YPOS="300" WIDTH="100" HEIGHT="100" PTYPE="2" OwnPage="0" isInlineImage="1" inlineImageExt="png" ImageData="AAAAAXic" PCOLOR="None" PCOLOR2="None" ItemID="104"/>
  <PAGEOBJECT XPOS="100" YPOS="440" WIDTH="80" HEIGHT="60" PTYPE="6" FRTYPE="1" OwnPage="0" PCOLOR="Brand Red" SHADE="50" PCOLOR2="Black" PWIDTH="2" TransValue="0.25" TEXTFLOWMODE="1" ItemID="105"/>
  <PAGEOBJECT XPOS="200" YPOS="440" WIDTH="80" HEIGHT="60" PTYPE="6" FRTYPE="0" ROT="90" OwnPage="0" PCOLOR="Old" PCOLOR2="None" LOCK="1" ItemID="106"/>
  <PAGEOBJECT XPOS="100" YPOS="560" WIDTH="100" HEIGHT="1" PTYPE="5" ROT="30" OwnPage="0" PCOLOR="None" PCOLOR2="Black" PWIDTH="1.5" ItemID="107"/>
  <PAGEOBJECT XPOS="120" YPOS="760" WIDTH="100" HEIGHT="50" PTYPE="12" OwnPage="1" ItemID="108">
    <PAGEOBJECT XPOS="120" YPOS="760" WIDTH="40" HEIGHT="40" PTYPE="6" FRTYPE="2" RADRECT="6" OwnPage="1" PCOLOR="Sky" PCOLOR2="None" ItemID="109"/>
    <PAGEOBJECT XPOS="170" YPOS="760" WIDTH="40" HEIGHT="40" PTYPE="6" FRTYPE="3" OwnPage="1" PCOLOR="Sky" PCOLOR2="None" ItemID="110"/>
  </PAGEOBJECT>
  <PAGEOBJECT XPOS="2000" YPOS="2000" WIDTH="10" HEIGHT="10" PTYPE="6" OwnPage="-1" PCOLOR="Black" ItemID="111"/>
  <PAGEOBJECT XPOS="150" YPOS="900" WIDTH="100" HEIGHT="60" PTYPE="16" OwnPage="1" ItemID="112"/>
</DOCUMENT>
</SCRIBUSUTF8NEW>`;

test("sla: document setup, pages, masters, colours", () => {
  const r = S.convert(SLA15, { now: 7000 });
  const d = r.doc;
  assert.equal(d.name, "Δοκιμή & test");
  assert.equal(d.setup.unit, "mm");
  assert.equal(d.setup.facing, 1);
  assert.equal(d.setup.cols, 2);
  assert.ok(Math.abs(d.setup.w - 419.53) < 0.01 && Math.abs(d.setup.bleed - 8.5) < 0.01);
  assert.equal(d.pages.length, 2);
  assert.equal(d.masters.length, 2);
  const pg = M.pagesInOrder(d);
  const right = d.masters.find((m) => m.name === "Normal Right");
  assert.equal(pg[0].ms, right.id);
  const red = d.swatches.find((s) => s.name === "Brand Red");
  assert.deepEqual([red.mode, red.v], ["cmyk", [0, 90, 80, 0]]);
  assert.deepEqual(d.swatches.find((s) => s.name === "Old").v, [255, 128, 0]);
  const tint = d.swatches.find((s) => /Brand Red 50%/.test(M.label(s.name, "en")));
  assert.deepEqual(tint.v, [0, 45, 40, 0]);
  assert.equal(J(M.normDoc(JSON.parse(J(d)))), J(d), "canonical");
});

test("sla: styles, threaded story, fields and character overrides", () => {
  const d = S.convert(SLA15, { now: 7000 }).doc;
  const head = d.pstyles.find((s) => s.name === "Heading"), sub = d.pstyles.find((s) => s.name === "Sub");
  assert.equal(head.font, "sans"); assert.equal(head.b, 1); assert.equal(head.size, 20); assert.equal(head.sa, 6);
  assert.equal(sub.base, head.id);
  assert.equal(M.find(d.pstyles, "ps-base").font, "serif");
  const pg = M.pagesInOrder(d);
  const f1 = d.items.find((i) => i.t === "text" && i.pg === pg[0].id);
  const f2 = d.items.find((i) => i.t === "text" && i.pg === pg[1].id);
  assert.equal(f1.story, f2.story, "threaded");
  assert.ok(f2.seq > f1.seq);
  assert.equal(f1.cols, 2); assert.equal(f1.ins, 4);
  assert.ok(Math.abs(f1.x - 42) < 0.01 && Math.abs(f1.y - 40) < 0.01, "page-local");
  const st = M.story(d, f1.story);
  assert.equal(st.paras.length, 5);
  assert.equal(st.paras[0].ps, head.id);
  assert.equal(st.paras[0].runs[0].t, "Τίτλος");
  const p2 = st.paras[1];
  assert.ok(p2.runs.some((r) => r.t === "bold" && r.b === 1));
  const big = p2.runs.find((r) => r.t === "big blue");
  const cs = M.find(d.cstyles, big.cs);
  assert.equal(cs.size, 14); assert.equal(M.find(d.swatches, cs.color).name, "Sky");
  assert.equal(M.find(d.pstyles, p2.ps).align, "c", "local alignment kept");
  assert.equal(st.paras[2].runs[0].t, "Subtitle <b>", "text, never markup");
  assert.equal(st.paras[3].runs[0].t, "line one");
  assert.equal(st.paras[4].runs[0].t, "line two");
  const mf = d.items.find((i) => M.find(d.masters, i.pg));
  assert.deepEqual(M.story(d, mf.story).paras[0].runs.filter((r) => r.f).map((r) => r.f), ["pn", "pc"]);
  assert.ok(Math.abs(mf.x - 50) < 0.01, "master-local");
});

test("sla: images, shapes, lines, groups, skipped objects", () => {
  const r = S.convert(SLA15, { now: 7000 }), d = r.doc;
  const imgs = d.items.filter((i) => i.t === "img");
  assert.equal(imgs.length, 2);
  const linked = imgs.find((i) => i.nm === "photo one.jpg");
  assert.ok(linked && linked.a === "" && linked.fit === "fit");
  assert.equal(r.linked, 1);
  assert.equal(r.images.length, 1); assert.equal(r.images[0].type, "png");
  const ell = d.items.find((i) => i.t === "ell");
  assert.equal(ell.op, 75); assert.equal(ell.wrap, "ell"); assert.equal(ell.sw, 2);
  assert.ok(/Brand Red 50%/.test(M.label(M.find(d.swatches, ell.fill).name, "en")));
  const rot = d.items.find((i) => i.lock === 1);
  // rotated 90° about its top-left (200,440) → box centred at (170, 480) on the page (-100, -20)
  assert.equal(rot.rot, 90);
  assert.ok(Math.abs(rot.x + rot.w / 2 - 70) < 0.01 && Math.abs(rot.y + rot.h / 2 - 460) < 0.01, J(rot));
  const ln = d.items.find((i) => i.t === "line");
  assert.ok(Math.abs(ln.w - 100 * Math.cos(Math.PI / 6)) < 0.01 && Math.abs(ln.h - 50) < 0.01);
  assert.ok(d.items.some((i) => i.t === "rect" && i.r === 6), "group member, rounded");
  assert.equal(r.stats.skipped, 3, "free shape + table drawn as boxes, scratch object dropped");
  assert.equal(r.stats.pages, 2);
});

test("sla: 1.4 form, index threads, broken and hostile input", () => {
  const old = `<SCRIBUSUTF8NEW Version="1.4.6"><DOCUMENT PAGEWIDTH="595" PAGEHEIGHT="842" UNITS="0">
    <PAGE PAGEXPOS="0" PAGEYPOS="0" NUM="0" MNAM=""/>
    <PAGEOBJECT XPOS="10" YPOS="10" WIDTH="100" HEIGHT="50" PTYPE="4" OwnPage="0" NEXTITEM="1" BACKITEM="-1"><ITEXT CH="Hello"/><para/><ITEXT CH="world"/></PAGEOBJECT>
    <PAGEOBJECT XPOS="10" YPOS="100" WIDTH="100" HEIGHT="50" PTYPE="4" OwnPage="0" NEXTITEM="0" BACKITEM="0"/>
  </DOCUMENT></SCRIBUSUTF8NEW>`;
  const d = S.convert(old, { now: 1 }).doc;
  assert.equal(d.setup.unit, "pt");
  const tx = d.items.filter((i) => i.t === "text");
  assert.equal(tx.length, 2);
  assert.equal(tx[0].story, tx[1].story, "index threads, loop stopped");
  assert.deepEqual(M.story(d, tx[0].story).paras.map((p) => p.runs.map((r) => r.t).join("")), ["Hello", "world"]);
  assert.equal(S.convert("not xml", {}), null);
  assert.equal(S.convert("<DOCUMENT></DOCUMENT>", {}), null, "no pages");
  const evil = `<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><DOCUMENT PAGEWIDTH="1e9" PAGEHEIGHT="-5"><PAGE NUM="0"/>
    <PAGEOBJECT XPOS="NaN" YPOS="1e30" WIDTH="5" HEIGHT="5" PTYPE="4" OwnPage="0"><ITEXT CH="&e;&#0;&#xD800;<script>"/></PAGEOBJECT></DOCUMENT>`;
  const e = S.convert(evil, { now: 1 }).doc;
  assert.equal(J(M.normDoc(JSON.parse(J(e)))), J(e));
  assert.ok(e.setup.w <= 14400 && e.setup.h >= 36);
  const t = M.story(e, e.items[0].story).paras[0].runs.map((r) => r.t).join("");
  assert.ok(!/passwd|\u0000/.test(t));
});
