// Layout: what the PORT wave 2 brings over from Scribus and InDesign
// (LY-PORT2): Scribus tables and text on a path (layout/sla.js 1.6),
// InDesign layers, free shapes, text on a path, tables, footnotes and
// tabs (layout/idml.js 1.1).
// Run: node --test tests/layout-port2.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "designkit/model.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const S = require(path.join(ROOT, "layout/sla.js"));
const I = require(path.join(ROOT, "layout/idml.js"));

const near = (a, b, e) => Math.abs(a - b) < (e || 0.01);
const textOf = (d, sid) => M.story(d, sid).paras.map((p) => p.runs.map((r) => r.t || "").join("")).join("|");

// ---------- Scribus ----------
const cell = (r, c, txt, extra) => `<Cell Row="${r}" Column="${c}" FillColor="${(extra && extra.fill) || "None"}" FillShade="100" LeftPadding="2" RightPadding="2" TopPadding="1" BottomPadding="1" TextVertAlign="${(extra && extra.va) || 0}">
  <TableBorderLeft><TableBorderLine Width="${(extra && extra.w) || 1}" PenStyle="1" Color="Black" Shade="100"/></TableBorderLeft>
  <TableBorderRight><TableBorderLine Width="${(extra && extra.w) || 1}" PenStyle="1" Color="Black" Shade="100"/></TableBorderRight>
  <TableBorderTop><TableBorderLine Width="1" PenStyle="1" Color="Black" Shade="100"/></TableBorderTop>
  <TableBorderBottom><TableBorderLine Width="1" PenStyle="${(extra && extra.pen) || 1}" Color="Black" Shade="100"/></TableBorderBottom>
  <StoryText><DefaultStyle/>${txt ? `<ITEXT FONT="Times New Roman Bold" FONTSIZE="9" CH="${txt}"/>` : ""}<trail ALIGN="1"/></StoryText>
</Cell>`;
const SLA = `<?xml version="1.0" encoding="UTF-8"?>
<SCRIBUSUTF8NEW Version="1.6.1">
<DOCUMENT ANZPAGES="1" PAGEWIDTH="400" PAGEHEIGHT="500" UNITS="0">
  <COLOR NAME="Black" SPACE="CMYK" C="0" M="0" Y="0" K="100"/>
  <COLOR NAME="Grey" SPACE="RGB" R="200" G="200" B="200"/>
  <LAYERS NUMMER="0" LEVEL="0" NAME="Background" SICHTBAR="1" DRUCKEN="1" EDIT="1"/>
  <STYLE NAME="Default Paragraph Style" FONT="Times New Roman Regular" FONTSIZE="11"/>
  <PAGE PAGEXPOS="100" PAGEYPOS="20" PAGEWIDTH="400" PAGEHEIGHT="500" NUM="0" MNAM="Normal"/>
  <PAGEOBJECT XPOS="140" YPOS="60" OwnPage="0" ItemID="9" PTYPE="16" WIDTH="300" HEIGHT="60" PWIDTH="0" Rows="3" Columns="3" RowHeights="20 20 20" ColumnWidths="100 120 80" CellAreas="1 0 1 2" LAYER="0">
    <TableData Style="" FillColor="None" FillShade="100">
      <TableBorderLeft><TableBorderLine Width="2" PenStyle="1" Color="Black" Shade="100"/></TableBorderLeft>
      <TableBorderRight><TableBorderLine Width="2" PenStyle="1" Color="Black" Shade="100"/></TableBorderRight>
      <TableBorderTop><TableBorderLine Width="2" PenStyle="1" Color="Black" Shade="100"/></TableBorderTop>
      <TableBorderBottom><TableBorderLine Width="2" PenStyle="1" Color="Black" Shade="100"/></TableBorderBottom>
      ${cell(0, 0, "Σχολείο", { fill: "Grey" })}${cell(0, 1, "Τάξη", { fill: "Grey" })}${cell(0, 2, "Μέγεθος", { fill: "Grey" })}
      ${cell(1, 0, "Ενωμένο", { va: 1 })}${cell(1, 1, "κρυμμένο")}${cell(1, 2, "Γ")}
      ${cell(2, 0, "")}${cell(2, 1, "Ε", { pen: 2 })}${cell(2, 2, "Ζ")}
    </TableData>
  </PAGEOBJECT>
  <PAGEOBJECT XPOS="120" YPOS="300" OwnPage="0" ItemID="10" PTYPE="8" WIDTH="200" HEIGHT="50" PCOLOR="None" PCOLOR2="Black" PWIDTH="1" PLTSHOW="1" EXTRA="50" textPathFlipped="1" path="M0 50 C50 0 150 0 200 50" LAYER="0">
    <StoryText><DefaultStyle/><ITEXT CH="Γύρω γύρω"/><trail/></StoryText>
  </PAGEOBJECT>
</DOCUMENT>
</SCRIBUSUTF8NEW>`;

test("sla: a table becomes its cells, borders and cell text, grouped (LY-PORT2)", () => {
  const r = S.convert(SLA, { now: 7 }), d = r.doc;
  const tbl = d.items.filter((i) => i.grp);
  assert.ok(tbl.length > 0 && tbl.every((i) => i.grp === tbl[0].grp), "one group");
  assert.equal(r.stats.skipped, 0);
  // a text frame per cell with text: 8 cells (one merged away, one empty)
  const tx = tbl.filter((i) => i.t === "text");
  assert.equal(tx.length, 7);
  const merged = tx.find((i) => textOf(d, i.story) === "Ενωμένο");
  assert.deepEqual([merged.x, merged.y, merged.w, merged.h, merged.va, merged.ins], [40, 60, 220, 20, "c", 2]);
  assert.ok(!tx.some((i) => textOf(d, i.story) === "κρυμμένο"), "a cell under a merged one is left out");
  assert.equal(merged.ext.sfit, 1);
  // header fills
  const fills = tbl.filter((i) => i.t === "rect").sort((a, b) => a.x - b.x);
  assert.deepEqual(fills.map((f) => [f.x, f.w, f.h]), [[40, 100, 20], [140, 120, 20], [260, 80, 20]]);
  assert.ok(fills.every((f) => f.fill && !f.stroke));
  // borders: outer edges take the table's heavier 2 pt; a shared side is
  // drawn once; one line per straight run of the same look
  const lines = tbl.filter((i) => i.t === "line");
  const top = lines.filter((l) => near(l.y, 40) && l.h === 0);
  assert.deepEqual(top.map((l) => [l.x, l.w, l.sw]), [[40, 300, 2]]);
  const mid = lines.filter((l) => near(l.y, 60) && l.h === 0);
  assert.deepEqual(mid.map((l) => [l.x, l.w, l.sw]), [[40, 300, 1]]);
  // the merged cell has no inner side between its two columns on row 1
  const v1 = lines.filter((l) => l.w === 0 && near(l.x, 140)).sort((a, b) => a.y - b.y);
  assert.deepEqual(v1.map((l) => [l.y, l.h]), [[40, 20], [80, 20]]);
  // a dashed bottom on one cell is its own piece
  const bottom = lines.filter((l) => near(l.y, 100) && l.h === 0);
  assert.deepEqual(bottom.map((l) => [l.x, l.w, l.sw, !!l.dash]), [[40, 300, 2, false]], "the table's heavier border wins on the outer edge");
  // order: fills under lines under text
  const zs = (t) => tbl.filter((i) => i.t === t).map((i) => i.z);
  assert.ok(Math.max(...zs("rect")) < Math.min(...zs("line")) && Math.max(...zs("line")) < Math.min(...zs("text")));
  assert.equal(JSON.stringify(M.normDoc(d)), JSON.stringify(d));
});

test("sla: table cells and path text are laid out", () => {
  const d = S.convert(SLA, { now: 7 }).doc, L = R.computeLayout(d);
  const tx = d.items.filter((i) => i.grp && i.t === "text");
  tx.forEach((t) => assert.ok(L.frames[t.id] && L.frames[t.id].lines.length >= 1, "cell text laid out"));
  const tp = d.items.find((i) => i.ext && i.ext.tp), lines = L.frames[tp.id].lines;
  assert.ok(lines.length >= 1 && lines[0].runs.some((r) => Array.isArray(r.g) && r.g.length), "bent onto the path");
});

test("sla: text on a path keeps its path, start and side; Show curve draws it (LY-PORT2)", () => {
  const d = S.convert(SLA, { now: 7 }).doc;
  const tp = d.items.find((i) => i.t === "text" && i.ext && i.ext.tp);
  assert.ok(tp);
  assert.equal(textOf(d, tp.story), "Γύρω γύρω");
  assert.deepEqual([tp.x, tp.y, tp.w, tp.h, tp.ins, tp.fill, tp.stroke], [20, 280, 200, 50, 0, "", ""]);
  assert.equal(tp.ext.tp.d, "M0 1C0.25 0 0.75 0 1 1");
  assert.equal(tp.ext.tp.s, -1);
  // 50 pt along a curve about 245 pt long
  assert.ok(tp.ext.tp.o > 18 && tp.ext.tp.o < 23, String(tp.ext.tp.o));
  const curve = d.items.find((i) => i.t === "path" && i.d === tp.ext.tp.d);
  assert.ok(curve && curve.stroke && curve.z < tp.z);
  assert.ok(near(S.pathLen(S.svgPath("M0 0 L30 40")), 50));
});

test("sla: tableItems turns a rotated table about its corner", () => {
  const out = S.tableItems({ pg: "pg-1", x: 10, y: 10, rot: 90, cols: [20], rows: [10], cells: [{ r: 0, c: 0, fill: "sw-black" }], edge: () => null, z: 16 });
  assert.equal(out.length, 1);
  const f = out[0];
  // centre of the 20 x 10 cell turned 90° about (10, 10): (5, 20)
  assert.ok(near(f.x + f.w / 2, 5) && near(f.y + f.h / 2, 20) && near(f.rot, 90));
});

// ---------- InDesign ----------
function crc32(b) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < b.length; n++) {
    c = (crc ^ b[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const locals = [], cds = [];
  let off = 0;
  Object.keys(files).forEach((name) => {
    const raw = Buffer.from(files[name], "utf8"), data = zlib.deflateRawSync(raw), nm = Buffer.from(name, "utf8");
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc32(raw), 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(nm.length, 28); cd.writeUInt32LE(off, 42);
    locals.push(lh, nm, data); cds.push(cd, nm);
    off += 30 + nm.length + data.length;
  });
  const cdBuf = Buffer.concat(cds), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(cds.length / 2, 8); end.writeUInt16LE(cds.length / 2, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(off, 16);
  const all = Buffer.concat(locals.concat([cdBuf, end]));
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength);
}
const geo = (pts, open) => `<Properties><PathGeometry><GeometryPathType PathOpen="${open ? "true" : "false"}"><PathPointArray>${pts.map((p) => `<PathPointType Anchor="${p[0]} ${p[1]}" LeftDirection="${(p[2] || p[0])} ${(p[3] || p[1])}" RightDirection="${(p[4] || p[0])} ${(p[5] || p[1])}"/>`).join("")}</PathPointArray></GeometryPathType></PathGeometry></Properties>`;
const box = (w, h) => geo([[0, 0], [0, h], [w, h], [w, 0]]);
const cellX = (name, txt) => `<Cell Self="c${name}" Name="${name}" RowSpan="1" ColumnSpan="1"><ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Body"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>${txt}</Content></CharacterStyleRange></ParagraphStyleRange></Cell>`;
function idml() {
  const W = 400, H = 600;
  return {
    "mimetype": "application/vnd.adobe.indesign-idml-package",
    "designmap.xml": `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns:idPkg="x" DOMVersion="16.0" Self="d">
  <idPkg:Graphic src="Resources/Graphic.xml"/><idPkg:Styles src="Resources/Styles.xml"/><idPkg:Preferences src="Resources/Preferences.xml"/>
  <idPkg:Spread src="Spreads/Spread_u1.xml"/>
  <idPkg:Story src="Stories/Story_us1.xml"/><idPkg:Story src="Stories/Story_us2.xml"/>
  <Layer Self="lTop" Name="Top" Visible="true" Locked="true" Printable="true"/>
  <Layer Self="lHid" Name="Hidden" Visible="false" Locked="false" Printable="true"/>
  <Layer Self="lBot" Name="Bottom" Visible="true" Locked="false" Printable="true"/>
</Document>`,
    "Resources/Preferences.xml": `<idPkg:Preferences xmlns:idPkg="x"><DocumentPreference PageHeight="${H}" PageWidth="${W}" FacingPages="false"/><MarginPreference ColumnCount="1" Top="36" Bottom="36" Left="36" Right="36"/></idPkg:Preferences>`,
    "Resources/Graphic.xml": `<idPkg:Graphic xmlns:idPkg="x"><Color Self="Color/Black" Space="CMYK" ColorValue="0 0 0 100" Name="Black"/><Color Self="Color/u9" Space="CMYK" ColorValue="0 100 100 0" Name="Red"/><Swatch Self="Swatch/None" Name="None"/></idPkg:Graphic>`,
    "Resources/Styles.xml": `<idPkg:Styles xmlns:idPkg="x">
  <RootCharacterStyleGroup Self="rcs"><CharacterStyle Self="CharacterStyle/$ID/[No character style]" Name="$ID/[No character style]"/></RootCharacterStyleGroup>
  <RootParagraphStyleGroup Self="rps">
    <ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Name="$ID/NormalParagraphStyle" PointSize="10"/>
    <ParagraphStyle Self="ParagraphStyle/Body" Name="Body"><Properties><BasedOn type="object">ParagraphStyle/$ID/NormalParagraphStyle</BasedOn>
      <TabList type="list"><ListItem type="record"><Alignment type="enumeration">LeftAlign</Alignment><Position type="unit">72</Position></ListItem><ListItem type="record"><Position type="unit">144.5</Position></ListItem></TabList></Properties></ParagraphStyle>
  </RootParagraphStyleGroup>
</idPkg:Styles>`,
    "Spreads/Spread_u1.xml": `<idPkg:Spread xmlns:idPkg="x"><Spread Self="u1" PageCount="1" ItemTransform="1 0 0 1 0 0">
  <Page Self="up1" Name="1" GeometricBounds="0 0 ${H} ${W}" ItemTransform="1 0 0 1 0 -${H / 2}"/>
  <TextFrame Self="utf1" ParentStory="us1" PreviousTextFrame="n" NextTextFrame="n" ItemTransform="1 0 0 1 36 -264" ItemLayer="lBot">${box(328, 300)}</TextFrame>
  <Polygon Self="upc" ItemTransform="1 0 0 1 50 100" FillColor="Color/u9" ItemLayer="lTop">${geo([[0, 0, 0, 0, 20, -20], [100, 0, 80, -20, 100, 0], [50, 80]])}</Polygon>
  <Rectangle Self="uh" ItemTransform="1 0 0 1 200 100" FillColor="Color/u9" ItemLayer="lHid">${box(20, 20)}</Rectangle>
  <GraphicLine Self="ubl" ItemTransform="1 0 0 1 0 200" StrokeColor="Color/Black" StrokeWeight="1" ItemLayer="lBot">${geo([[0, 0], [50, 30], [100, 0]], true)}</GraphicLine>
  <Oval Self="uov" ItemTransform="1 0 0 1 250 150" StrokeColor="Color/Black" StrokeWeight="0.5" ItemLayer="lBot">
    ${geo([[0, 50, 0, 77.6, 0, 22.4], [50, 0, 22.4, 0, 77.6, 0], [100, 50, 100, 22.4, 100, 77.6], [50, 100, 77.6, 100, 22.4, 100]])}
    <TextPath Self="utp" ParentStory="us2" PreviousTextFrame="n" NextTextFrame="n" FlipPathEffect="Flipped"/>
  </Oval>
</Spread></idPkg:Spread>`,
    "Stories/Story_us1.xml": `<idPkg:Story xmlns:idPkg="x"><Story Self="us1">
  <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Body"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>Name	Age</Content><Footnote Self="fn1"><ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Body"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content><?ACE 4?> Πρώτη σημείωση.</Content><Br/><Content>Δεύτερη γραμμή.</Content></CharacterStyleRange></ParagraphStyleRange></Footnote><Content> after</Content><Note Self="n1"><ParagraphStyleRange><CharacterStyleRange><Content>editor only</Content></CharacterStyleRange></ParagraphStyleRange></Note><Br/></CharacterStyleRange></ParagraphStyleRange>
  <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Body"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>Before</Content>
    <Table Self="ut" HeaderRowCount="1" BodyRowCount="1" ColumnCount="3"><Row Self="r0" Name="0" SingleRowHeight="20"/><Row Self="r1" Name="1" SingleRowHeight="20"/>
      <Column Self="k0" Name="0" SingleColumnWidth="90"/><Column Self="k1" Name="1" SingleColumnWidth="60"/><Column Self="k2" Name="2" SingleColumnWidth="50"/>
      ${cellX("0:0", "Α")}${cellX("1:0", "Β")}${cellX("2:0", "Γ")}${cellX("0:1", "δ")}${cellX("2:1", "ζ")}
    </Table><Content>After</Content><Br/></CharacterStyleRange></ParagraphStyleRange>
</Story></idPkg:Story>`,
    "Stories/Story_us2.xml": `<idPkg:Story xmlns:idPkg="x"><Story Self="us2"><ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Body"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>Γύρω από τον κύκλο</Content></CharacterStyleRange></ParagraphStyleRange></Story></idPkg:Story>`
  };
}

test("idml: layers order, hide and lock their objects (LY-PORT2)", async () => {
  const r = await I.open(zip(idml()), { now: 9 }), d = r.doc;
  const poly = d.items.find((i) => i.t === "path" && i.fill), hid = d.items.find((i) => i.t === "rect"), tf = d.items.find((i) => i.t === "text" && !(i.ext && i.ext.tp));
  assert.equal(poly.lock, 1, "Top is locked");
  assert.equal(hid.hide, 1, "Hidden layer");
  assert.ok(poly.z > hid.z && hid.z > tf.z, "Top over Hidden over Bottom");
  assert.ok(!tf.hide && !tf.lock);
});

test("idml: free shapes and bent lines become paths with their curves (LY-PORT2)", async () => {
  const d = (await I.open(zip(idml()), { now: 9 })).doc;
  const poly = d.items.find((i) => i.t === "path" && i.fill);
  // anchors (0,0) (100,0) (50,80), handles out to y −20: the box holds them
  assert.deepEqual([poly.x, poly.y, poly.w, poly.h, poly.rot], [50, 380, 100, 100, 0]);
  assert.equal(poly.d, "M0 0.2C0.2 0 0.8 0 1 0.2L0.5 1Z");
  const bent = d.items.find((i) => i.t === "path" && !i.fill && i.stroke && !i.d.includes("Z"));
  assert.deepEqual([bent.x, bent.y, bent.w, bent.h, bent.sw], [0, 500, 100, 30, 1]);
  assert.equal(bent.d, "M0 0L0.5 1L1 0");
});

test("idml: text on a path is a text frame with the outline as its path (LY-PORT2)", async () => {
  const d = (await I.open(zip(idml()), { now: 9 })).doc;
  const tp = d.items.find((i) => i.t === "text" && i.ext && i.ext.tp);
  assert.ok(tp);
  assert.equal(textOf(d, tp.story), "Γύρω από τον κύκλο");
  assert.deepEqual([tp.x, tp.y, tp.w, tp.h, tp.ext.tp.s, tp.ext.tp.o], [250, 450, 100, 100, -1, 0]);
  assert.ok(/^M0 0\.5C/.test(tp.ext.tp.d) && tp.ext.tp.d.endsWith("Z"));
  const ov = d.items.find((i) => i.t === "ell");
  assert.ok(ov && tp.z > ov.z, "the shape stays, the text over it");
});

test("idml: tabs stay, a table is one paragraph per row at its columns, footnotes go after the story (LY-PORT2)", async () => {
  const r = await I.open(zip(idml()), { now: 9 }), d = r.doc;
  const tf = d.items.find((i) => i.t === "text" && !(i.ext && i.ext.tp)), st = M.story(d, tf.story);
  const body = d.pstyles.find((p) => p.name === "Body");
  assert.deepEqual(body.ext.tabs, [72, 144.5]);
  const txt = st.paras.map((p) => p.runs.map((x) => x.t).join(""));
  assert.deepEqual(txt, ["Name\tAge1 after", "Before", "Α\tΒ\tΓ", "δ\t\tζ", "After", "1. Πρώτη σημείωση. Δεύτερη γραμμή."]);
  // the note's mark is raised
  const mark = st.paras[0].runs.find((x) => x.t === "1");
  assert.equal(mark.ext.sup, 1);
  // rows: a style of their own with stops at the columns' left edges
  const row = d.pstyles.find((p) => p.id === st.paras[2].ps);
  assert.deepEqual([row.base, row.ext.tabs], [body.id, [90, 150]]);
  assert.equal(st.paras[3].ps, st.paras[2].ps);
  // the notes: smaller, no indent
  const np = d.pstyles.find((p) => p.id === st.paras[5].ps);
  assert.deepEqual([np.name, np.size, np.fi], ["Footnotes", 8.5, 0]);
  assert.equal(r.stats.tables, 1);
  assert.equal(r.stats.notes, 1);
  assert.equal(r.stats.skipped, 0);
  assert.equal(JSON.stringify(M.normDoc(d)), JSON.stringify(d));
});
