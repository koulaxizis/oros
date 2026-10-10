// orOS Layout — InDesign .idml import (layout/idml.js)
// A small IDML package is built here (zip of XML parts, as InDesign
// writes it) and read back into a Layout document.
// Run: node --test tests/layout-idml.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "designkit/model.js"));
const I = require(path.join(ROOT, "layout/idml.js"));

// ---------- a minimal zip writer (stored + deflate) ----------
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
  Object.keys(files).forEach((name, i) => {
    const raw = Buffer.from(files[name], "utf8"), method = i === 0 ? 0 : 8;
    const data = method ? zlib.deflateRawSync(raw) : raw, nm = Buffer.from(name, "utf8");
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(method, 10);
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

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const rect = (x0, y0, x1, y1) => `<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>
  <PathPointType Anchor="${x0} ${y0}" LeftDirection="${x0} ${y0}" RightDirection="${x0} ${y0}"/>
  <PathPointType Anchor="${x0} ${y1}" LeftDirection="${x0} ${y1}" RightDirection="${x0} ${y1}"/>
  <PathPointType Anchor="${x1} ${y1}" LeftDirection="${x1} ${y1}" RightDirection="${x1} ${y1}"/>
  <PathPointType Anchor="${x1} ${y0}" LeftDirection="${x1} ${y0}" RightDirection="${x1} ${y0}"/>
</PathPointArray></GeometryPathType></PathGeometry></Properties>`;

function pkg() {
  const W = 420, H = 595;
  return {
    "mimetype": "application/vnd.adobe.indesign-idml-package",
    "designmap.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<?aid style="50" type="document" readerVersion="6.0" featureSet="257" product="16.0(32)" ?>
<Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="16.0" Self="d">
  <idPkg:Graphic src="Resources/Graphic.xml"/>
  <idPkg:Styles src="Resources/Styles.xml"/>
  <idPkg:Preferences src="Resources/Preferences.xml"/>
  <idPkg:MasterSpread src="MasterSpreads/MasterSpread_ua.xml"/>
  <idPkg:Spread src="Spreads/Spread_u1.xml"/>
  <idPkg:Spread src="Spreads/Spread_u2.xml"/>
  <idPkg:Story src="Stories/Story_us1.xml"/>
  <idPkg:Story src="Stories/Story_us2.xml"/>
</Document>`,
    "Resources/Preferences.xml": `<idPkg:Preferences xmlns:idPkg="x">
  <DocumentPreference PageHeight="${H}" PageWidth="${W}" FacingPages="true" DocumentBleedTopOffset="8.5" DocumentBleedBottomOffset="8.5" DocumentBleedInsideOrLeftOffset="8.5" DocumentBleedOutsideOrRightOffset="8.5"/>
  <MarginPreference ColumnCount="2" ColumnGutter="14" Top="40" Bottom="50" Left="30" Right="36"/>
  <ViewPreference HorizontalMeasurementUnits="Millimeters" VerticalMeasurementUnits="Millimeters"/>
</idPkg:Preferences>`,
    "Resources/Graphic.xml": `<idPkg:Graphic xmlns:idPkg="x">
  <Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" Name="Black"/>
  <Color Self="Color/Paper" Model="Process" Space="CMYK" ColorValue="0 0 0 0" Name="Paper"/>
  <Color Self="Color/u9" Model="Process" Space="CMYK" ColorValue="0 100 100 0" Name="Κόκκινο"/>
  <Color Self="Color/u10" Model="Process" Space="RGB" ColorValue="0 128 255" Name="Sky"/>
  <Color Self="Color/u11" Model="Process" Space="LAB" ColorValue="50 0 0" Name="Lab grey"/>
  <Tint Self="Tint/u12" BaseColor="Color/u10" TintValue="40"/>
  <Swatch Self="Swatch/None" Name="None"/>
</idPkg:Graphic>`,
    "Resources/Styles.xml": `<idPkg:Styles xmlns:idPkg="x">
  <RootCharacterStyleGroup Self="rcs">
    <CharacterStyle Self="CharacterStyle/$ID/[No character style]" Name="$ID/[No character style]"/>
    <CharacterStyle Self="CharacterStyle/Emphasis" Name="Emphasis" FontStyle="Italic" FillColor="Color/u9"/>
  </RootCharacterStyleGroup>
  <RootParagraphStyleGroup Self="rps">
    <ParagraphStyle Self="ParagraphStyle/$ID/[No paragraph style]" Name="$ID/[No paragraph style]" PointSize="12"/>
    <ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Name="$ID/NormalParagraphStyle" PointSize="10" FillColor="Color/Black">
      <Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn><AppliedFont type="string">Minion Pro</AppliedFont><Leading type="unit">13</Leading></Properties>
    </ParagraphStyle>
    <ParagraphStyleGroup Self="g1" Name="Headings">
      <ParagraphStyle Self="ParagraphStyle/Headings%3aTitle" Name="Headings:Title" PointSize="28" FontStyle="Bold" Justification="CenterAlign" SpaceAfter="6">
        <Properties><BasedOn type="object">ParagraphStyle/$ID/NormalParagraphStyle</BasedOn><AppliedFont type="string">Myriad Pro</AppliedFont><Leading type="enumeration">Auto</Leading></Properties>
      </ParagraphStyle>
    </ParagraphStyleGroup>
    <ParagraphStyle Self="ParagraphStyle/Body" Name="Body" FirstLineIndent="12" Justification="LeftJustified">
      <Properties><BasedOn type="object">ParagraphStyle/$ID/NormalParagraphStyle</BasedOn></Properties>
    </ParagraphStyle>
  </RootParagraphStyleGroup>
</idPkg:Styles>`,
    "MasterSpreads/MasterSpread_ua.xml": `<idPkg:MasterSpread xmlns:idPkg="x">
  <MasterSpread Self="ua" Name="A-Parent" NamePrefix="A" BaseName="Parent" ItemTransform="1 0 0 1 0 0" PageCount="2">
    <Page Self="uap1" Name="A" GeometricBounds="0 0 ${H} ${W}" ItemTransform="1 0 0 1 -${W} -${H / 2}"/>
    <Page Self="uap2" Name="A" GeometricBounds="0 0 ${H} ${W}" ItemTransform="1 0 0 1 0 -${H / 2}"/>
    <TextFrame Self="umf" ParentStory="us2" PreviousTextFrame="n" NextTextFrame="n" ContentType="TextType" ItemTransform="1 0 0 1 0 0">
      ${rect(300, -37.5, 380, -17.5)}<TextFramePreference TextColumnCount="1"/>
    </TextFrame>
  </MasterSpread>
</idPkg:MasterSpread>`,
    // spread 1: one right-hand page (origin at its left edge, centred vertically)
    "Spreads/Spread_u1.xml": `<idPkg:Spread xmlns:idPkg="x">
  <Spread Self="u1" PageCount="1" BindingLocation="0" ItemTransform="1 0 0 1 0 0">
    <Page Self="up1" Name="1" AppliedMaster="ua" GeometricBounds="0 0 ${H} ${W}" ItemTransform="1 0 0 1 0 -${H / 2}"/>
    <TextFrame Self="utf1" ParentStory="us1" PreviousTextFrame="n" NextTextFrame="utf2" ContentType="TextType" ItemTransform="1 0 0 1 30 -257.5" FillColor="Swatch/None" StrokeColor="Swatch/None">
      ${rect(0, 0, 360, 200)}
      <TextFramePreference TextColumnCount="2" TextColumnGutter="10" VerticalJustification="CenterAlign"><Properties><InsetSpacing type="list"><ListItem type="unit">4</ListItem><ListItem type="unit">4</ListItem><ListItem type="unit">4</ListItem><ListItem type="unit">4</ListItem></InsetSpacing></Properties></TextFramePreference>
      <TextWrapPreference TextWrapMode="None"/>
    </TextFrame>
    <Rectangle Self="ur1" ContentType="GraphicType" ItemTransform="0.8660254 0.5 -0.5 0.8660254 210 100" FillColor="Tint/u12" StrokeColor="Color/u9" StrokeWeight="2" StrokeType="StrokeStyle/$ID/Dashed" CornerOption="RoundedCorner" CornerRadius="6">
      ${rect(-50, -25, 50, 25)}
      <TransparencySetting><BlendingSetting Opacity="60"/></TransparencySetting>
      <TextWrapPreference TextWrapMode="BoundingBoxTextWrap"><Properties><TextWrapOffset Top="5" Left="5" Bottom="5" Right="5"/></Properties></TextWrapPreference>
    </Rectangle>
    <Group Self="ug" ItemTransform="1 0 0 1 20 150">
      <Oval Self="uo" ItemTransform="1 0 0 1 0 0" FillColor="Color/u10">${rect(0, 0, 40, 40)}</Oval>
      <GraphicLine Self="ul" ItemTransform="1 0 0 1 0 0" StrokeColor="Color/Black" StrokeWeight="0.5">
        <Properties><PathGeometry><GeometryPathType PathOpen="true"><PathPointArray><PathPointType Anchor="0 50"/><PathPointType Anchor="100 50"/></PathPointArray></GeometryPathType></PathGeometry></Properties>
      </GraphicLine>
    </Group>
    <Rectangle Self="uimg" ItemTransform="1 0 0 1 30 200" StrokeWeight="0">
      ${rect(0, 0, 100, 60)}
      <Image Self="uimgi" ItemTransform="1 0 0 1 0 0"><Properties><Contents><![CDATA[${PNG}]]></Contents></Properties><Link Self="ulk" LinkResourceURI="file:/Users/me/Pictures/sea%20view.png"/></Image>
    </Rectangle>
    <Rectangle Self="ulnk" ItemTransform="1 0 0 1 150 200">
      ${rect(0, 0, 100, 60)}
      <Image Self="ulnki" ItemTransform="1 0 0 1 0 0"><Link Self="ulk2" LinkResourceURI="file:///C:/work/logo.tif"/></Image>
    </Rectangle>
    <Polygon Self="upoly" ItemTransform="1 0 0 1 300 200" FillColor="Color/u9">
      <Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray><PathPointType Anchor="0 0"/><PathPointType Anchor="30 40"/><PathPointType Anchor="60 0"/></PathPointArray></GeometryPathType></PathGeometry></Properties>
    </Polygon>
    <Button Self="ubtn" ItemTransform="1 0 0 1 0 0">${rect(0, 0, 10, 10)}</Button>
  </Spread>
</idPkg:Spread>`,
    // spread 2: a two-page spread
    "Spreads/Spread_u2.xml": `<idPkg:Spread xmlns:idPkg="x">
  <Spread Self="u2" PageCount="2" ItemTransform="1 0 0 1 0 700">
    <Page Self="up2" Name="2" AppliedMaster="ua" GeometricBounds="0 0 ${H} ${W}" ItemTransform="1 0 0 1 -${W} -${H / 2}"/>
    <Page Self="up3" Name="3" AppliedMaster="n" GeometricBounds="0 0 ${H} ${W}" ItemTransform="1 0 0 1 0 -${H / 2}"/>
    <TextFrame Self="utf2" ParentStory="us1" PreviousTextFrame="utf1" NextTextFrame="utf3" ContentType="TextType" ItemTransform="1 0 0 1 -390 -257.5">${rect(0, 0, 360, 500)}</TextFrame>
    <TextFrame Self="utf3" ParentStory="us1" PreviousTextFrame="utf2" NextTextFrame="n" ContentType="TextType" ItemTransform="1 0 0 1 30 -257.5">${rect(0, 0, 360, 500)}</TextFrame>
  </Spread>
</idPkg:Spread>`,
    "Stories/Story_us1.xml": `<idPkg:Story xmlns:idPkg="x">
  <Story Self="us1"><StoryPreference OpticalMarginAlignment="false"/>
    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Headings%3aTitle">
      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>Καλημέρα &amp; InDesign</Content><Br/></CharacterStyleRange>
    </ParagraphStyleRange>
    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Body">
      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>Plain then </Content></CharacterStyleRange>
      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]" FontStyle="Bold"><Content>bold</Content></CharacterStyleRange>
      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/Emphasis"><Content> styled</Content></CharacterStyleRange>
      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]" PointSize="14" FillColor="Color/u10"><Content> big blue&#x2028;next line	tab</Content><Br/></CharacterStyleRange>
    </ParagraphStyleRange>
    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Body" Justification="CenterAlign">
      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>Centred</Content><Table Self="ut"/><Br/></CharacterStyleRange>
    </ParagraphStyleRange>
    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Body">
      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><HyperlinkTextSource Self="uh"><Content>link text</Content></HyperlinkTextSource><Br/></CharacterStyleRange>
    </ParagraphStyleRange>
  </Story>
</idPkg:Story>`,
    "Stories/Story_us2.xml": `<idPkg:Story xmlns:idPkg="x">
  <Story Self="us2"><ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>Page <?ACE 18?> of </Content><TextVariableInstance Self="uv" Name="Last Page Number" ResultText="3" AssociatedTextVariable="dTextVariablenLast Page Number"/></CharacterStyleRange></ParagraphStyleRange></Story>
</idPkg:Story>`
  };
}

test("idml: the zip is read (stored and deflate parts, XML only)", async () => {
  const files = await I.unzip(zip(Object.assign({ "Links/evil.bin": "x", "../escape.xml": "<a/>" }, pkg())));
  assert.ok(files["designmap.xml"].includes("<Document"));
  assert.ok(files["Stories/Story_us1.xml"].includes("Καλημέρα"));
  assert.equal(files.mimetype, undefined);
  assert.equal(files["Links/evil.bin"], undefined);
  assert.equal(files["../escape.xml"], undefined);
  await assert.rejects(I.unzip(new ArrayBuffer(10)));
});

test("idml: document setup, colours, styles, masters", async () => {
  const res = await I.open(zip(pkg()), { now: 5000, name: "Brochure" });
  assert.ok(res);
  const d = res.doc, s = d.setup;
  assert.equal(d.name, "Brochure");
  assert.deepEqual([s.w, s.h, s.unit, s.facing, s.cols, s.gut, s.mt, s.mb, s.mi, s.mo, s.bleed], [420, 595, "mm", 1, 2, 14, 40, 50, 30, 36, 8.5]);
  assert.equal(d.pages.length, 3);
  assert.equal(res.stats.pages, 3);
  const sw = (n) => d.swatches.find((x) => (typeof x.name === "string" ? x.name : x.name.en) === n);
  assert.deepEqual(sw("Κόκκινο").v, [0, 100, 100, 0]);
  assert.deepEqual([sw("Sky").mode, sw("Sky").v], ["rgb", [0, 128, 255]]);
  assert.equal(sw("Lab grey"), undefined, "Lab colours are left out");
  assert.deepEqual(sw("Sky 40%").v, [153, 204, 255]);
  // styles: Basic Paragraph → ps-base; group names kept; based-on kept
  const base = M.find(d.pstyles, "ps-base");
  assert.equal(base.size, 10); assert.equal(base.font, "serif"); assert.equal(base.lead, 13);
  const title = d.pstyles.find((p) => p.name === "Headings:Title");
  assert.deepEqual([title.size, title.b, title.align, title.sa, title.font, title.lead, title.base], [28, 1, "c", 6, "sans", 0, "ps-base"]);
  const body = d.pstyles.find((p) => p.name === "Body");
  assert.deepEqual([body.fi, body.align], [12, "j"]);
  const em = d.cstyles.find((c) => c.name === "Emphasis");
  assert.equal(em.i, 1); assert.equal(em.color, sw("Κόκκινο").id);
  // master: two pages (facing) → items keep their side; doc pages use it
  const ms = d.masters.find((m) => m.pre === "A");
  assert.ok(ms && /A-Parent/.test(typeof ms.name === "string" ? ms.name : ms.name.en));
  const pages = M.pagesInOrder(d);
  assert.deepEqual(pages.map((p) => p.ms === ms.id), [true, true, false]);
  const mf = d.items.find((i) => i.pg === ms.id);
  assert.equal(mf.side, "R");
  assert.deepEqual([Math.round(mf.x), Math.round(mf.y), Math.round(mf.w), Math.round(mf.h)], [300, 260, 80, 20]);
  const mst = M.story(d, mf.story);
  assert.deepEqual(mst.paras[0].runs.map((r) => r.f || r.t), ["Page ", "pn", " of ", "pc"]);
});

test("idml: frames, threads, text, shapes, images", async () => {
  const res = await I.open(zip(pkg()), { now: 5000 });
  const d = res.doc, pages = M.pagesInOrder(d);
  const on = (k) => d.items.filter((i) => i.pg === pages[k].id);
  // the threaded story: three frames on pages 1, 2, 3 in order
  const tfs = d.items.filter((i) => i.t === "text" && i.pg !== d.masters[0].id).sort((a, b) => a.seq - b.seq);
  assert.equal(tfs.length, 3);
  assert.equal(new Set(tfs.map((t) => t.story)).size, 1);
  assert.deepEqual(tfs.map((t) => pages.findIndex((p) => p.id === t.pg)), [0, 1, 2]);
  const f1 = tfs[0];
  assert.deepEqual([f1.x, f1.y, f1.w, f1.h, f1.cols, f1.gut, f1.ins, f1.va], [30, 40, 360, 200, 2, 10, 4, "c"]);
  assert.deepEqual([tfs[1].x, tfs[1].y, tfs[2].x], [30, 40, 30]);
  const st = M.story(d, f1.story), body = d.pstyles.find((p) => p.name === "Body");
  assert.equal(st.paras.length, 4);
  assert.equal(st.paras[0].runs[0].t, "Καλημέρα & InDesign");
  assert.equal(st.paras[0].ps, d.pstyles.find((p) => p.name === "Headings:Title").id);
  const p1 = st.paras[1];
  assert.equal(p1.ps, body.id);
  assert.deepEqual(p1.runs.map((r) => r.t), ["Plain then ", "bold", " styled", " big blue\nnext line tab"]);
  assert.equal(p1.runs[1].b, 1);
  assert.equal(p1.runs[2].cs, d.cstyles.find((c) => c.name === "Emphasis").id);
  const big = d.cstyles.find((c) => c.id === p1.runs[3].cs);
  assert.deepEqual([big.size, big.color], [14, d.swatches.find((x) => x.name === "Sky").id]);
  // a local paragraph override → a derived style based on Body
  const cen = d.pstyles.find((p) => p.id === st.paras[2].ps);
  assert.deepEqual([cen.base, cen.align], [body.id, "c"]);
  assert.equal(st.paras[3].runs[0].t, "link text");
  // rotated, tinted, dashed, rounded, semi-transparent rectangle
  const r = on(0).find((i) => i.t === "rect" && i.rot);
  assert.equal(Math.round(r.rot), 30);
  assert.deepEqual([Math.round(r.x + r.w / 2), Math.round(r.y + r.h / 2), Math.round(r.w), Math.round(r.h)], [210, 398, 100, 50]);
  assert.deepEqual([r.dash, r.r, r.op, r.sw, r.wrap, r.wo], [1, 6, 60, 2, "box", 5]);
  assert.equal(r.fill, d.swatches.find((x) => x.name === "Sky 40%").id);
  // group: oval + line share a group id; line keeps its ends
  const ov = on(0).find((i) => i.t === "ell"), ln = on(0).find((i) => i.t === "line");
  assert.ok(ov.grp && ov.grp === ln.grp);
  assert.deepEqual([ov.x, ov.y, ov.w], [20, 447.5, 40]);
  assert.deepEqual([ln.x, ln.y, ln.w, ln.h, ln.sw], [20, 497.5, 100, 0, 0.5]);
  // images: one embedded (bytes back for io.js), one linked
  const imgs = on(0).filter((i) => i.t === "img");
  assert.deepEqual(imgs.map((i) => i.nm).sort(), ["logo.tif", "sea view.png"]);
  assert.equal(res.images.length, 1);
  assert.equal(res.linked, 1);
  assert.equal(res.images[0].item, imgs.find((i) => i.nm === "sea view.png").id);
  const blob = I.imageBlob(res.images[0]);
  assert.equal(blob.type, "image/png");
  // polygon → its box (counted), button left out (counted), table counted
  assert.ok(on(0).some((i) => i.t === "rect" && Math.round(i.w) === 60 && Math.round(i.h) === 40));
  assert.equal(res.stats.skipped, 3);
  assert.equal(res.stats.items, d.items.length);
  // the result is a normal, valid document
  assert.equal(JSON.stringify(M.normDoc(d)), JSON.stringify(d));
});

test("idml: broken or hostile input gives null, never throws", async () => {
  assert.equal(await I.open(new ArrayBuffer(0)), null);
  assert.equal(await I.open(zip({ "a.xml": "<x/>" })), null);
  const p = pkg();
  p["Stories/Story_us1.xml"] = "<Story Self=\"us1\"><Content><script>alert(1)</script>&lt;img onerror=x&gt;</Content></Story>";
  const res = await I.open(zip(p), { now: 1 });
  const st = res.doc.stories.find((s) => s.paras.some((pp) => pp.runs.some((r) => /img/.test(r.t || ""))));
  assert.equal(st.paras[0].runs[0].t, "<img onerror=x>");
});
