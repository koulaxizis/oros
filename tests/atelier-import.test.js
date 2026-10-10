// Atelier import: zip.js (reader limits), pptx.js (XML parser, slide
// mapping: text, shapes, pictures, groups, lines, custom geometry,
// placeholders, theme colours) and the design it builds (canonical,
// a new document). The .pptx files are built here, byte by byte.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");

const Z = require("../atelier/zip.js");
const P = require("../atelier/pptx.js");
const M = require("../designkit/model.js");
const J = (x) => JSON.stringify(x);

// ---- a minimal zip writer (stored or deflated entries) ----
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function makeZip(files, deflate) {
  const locals = [], centrals = [];
  let off = 0;
  Object.keys(files).forEach((name) => {
    const raw = Buffer.isBuffer(files[name]) ? files[name] : Buffer.from(files[name], "utf8");
    const data = deflate ? zlib.deflateRawSync(raw) : raw;
    const nm = Buffer.from(name, "utf8");
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(deflate ? 8 : 0, 8);
    lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nm.length, 26);
    locals.push(lh, nm, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(deflate ? 8 : 0, 10);
    ch.writeUInt32LE(crc32(raw), 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    centrals.push(ch, nm);
    off += 30 + nm.length + data.length;
  });
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat(locals.concat([cd, end])));
}

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const E = (pt) => Math.round(pt * 12700);
const xfrm = (x, y, w, h, extra) => `<a:xfrm${extra || ""}><a:off x="${E(x)}" y="${E(y)}"/><a:ext cx="${E(w)}" cy="${E(h)}"/></a:xfrm>`;
const rels = (list) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((r) => `<Relationship Id="${r[0]}" Type="http://x/${r[1]}" Target="${r[2]}"${r[3] ? ' TargetMode="External"' : ""}/>`).join("")}</Relationships>`;

function deck(slides, opts) {
  opts = opts || {};
  const files = {
    "[Content_Types].xml": "<Types/>",
    "ppt/presentation.xml": `<p:presentation ${NS}><p:sldIdLst>${slides.map((s, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${E(opts.w || 1080)}" cy="${E(opts.h || 1080)}"/></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": rels(slides.map((s, i) => [`rId${i + 1}`, "slide", `slides/slide${i + 1}.xml`]).concat([["rIdT", "theme", "theme/theme1.xml"]])),
    "ppt/theme/theme1.xml": `<a:theme ${NS}><a:themeElements><a:clrScheme name="x"><a:dk1><a:srgbClr val="111111"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="FF0000"/></a:accent1></a:clrScheme><a:fontScheme><a:minorFont><a:latin typeface="Georgia"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`,
    "ppt/slideLayouts/slideLayout1.xml": `<p:sldLayout ${NS}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(40, 40, 1000, 100)}</p:spPr></p:sp></p:spTree></p:cSld></p:sldLayout>`,
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": rels([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]),
    "ppt/slideMasters/slideMaster1.xml": `<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="EEEEEE"/></a:solidFill></p:bgPr></p:bg><p:spTree/></p:cSld><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle></p:txStyles></p:sldMaster>`,
    "ppt/media/image1.png": Buffer.from([137, 80, 78, 71])
  };
  slides.forEach((s, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = `<?xml version="1.0" encoding="UTF-8"?><p:sld ${NS}><p:cSld>${s.bg || ""}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${s.body}</p:spTree></p:cSld></p:sld>`;
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = rels([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"], ["rIdImg", "image", "../media/image1.png"], ["rIdExt", "image", "https://example.com/x.png", true], ["rIdUp", "image", "../../../../etc/passwd"]]);
  });
  return makeZip(files, opts.deflate);
}

const sp = (inner, name) => `<p:sp><p:nvSpPr><p:cNvPr id="3" name="${name || "s"}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>${inner}</p:sp>`;

const SLIDE1 = {
  bg: `<p:bg><p:bgPr><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="000000"/></a:gs><a:gs pos="100000"><a:srgbClr val="FFFFFF"/></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill></p:bgPr></p:bg>`,
  body: [
    // text box, centred vertically, theme colour with lumMod
    sp(`<p:spPr>${xfrm(100, 100, 400, 300)}<a:prstGeom prst="rect"/><a:noFill/></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:p><a:pPr algn="ctr"><a:lnSpc><a:spcPct val="150000"/></a:lnSpc></a:pPr><a:r><a:rPr sz="3600" b="1" spc="360" cap="all"><a:solidFill><a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr></a:solidFill><a:latin typeface="Playfair Display"/></a:rPr><a:t>Γεια &amp; χαρά</a:t></a:r></a:p><a:p><a:r><a:t>second</a:t></a:r></a:p></p:txBody>`, "text"),
    // rounded rectangle with outline
    sp(`<p:spPr>${xfrm(50, 600, 300, 100, ' rot="5400000"')}<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="00FF00"><a:alpha val="50000"/></a:srgbClr></a:solidFill><a:ln w="25400"><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill></a:ln></p:spPr>`),
    // hidden shape: skipped
    `<p:sp><p:nvSpPr><p:cNvPr id="9" name="h" hidden="1"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(0, 0, 10, 10)}<a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="123456"/></a:solidFill></p:spPr></p:sp>`,
    // picture with crop and ellipse mask
    `<p:pic><p:nvPicPr><p:cNvPr id="4" name="p"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg"><a:alphaModFix amt="80000"/></a:blip><a:srcRect l="10000" r="10000"/><a:stretch/></p:blipFill><p:spPr>${xfrm(600, 100, 400, 400, ' flipH="1"')}<a:prstGeom prst="ellipse"/></p:spPr></p:pic>`,
    // external and escaping pictures: skipped
    `<p:pic><p:nvPicPr><p:cNvPr id="5" name="x"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdExt"/></p:blipFill><p:spPr>${xfrm(0, 0, 10, 10)}</p:spPr></p:pic>`,
    `<p:pic><p:nvPicPr><p:cNvPr id="6" name="y"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdUp"/></p:blipFill><p:spPr>${xfrm(0, 0, 10, 10)}</p:spPr></p:pic>`,
    // group: child space 0..100 mapped onto 500..700
    `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="7" name="g"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${E(500)}" y="${E(800)}"/><a:ext cx="${E(200)}" cy="${E(200)}"/><a:chOff x="0" y="0"/><a:chExt cx="${E(100)}" cy="${E(100)}"/></a:xfrm></p:grpSpPr>` +
      sp(`<p:spPr>${xfrm(50, 50, 50, 50)}<a:prstGeom prst="ellipse"/><a:solidFill><a:srgbClr val="FF00FF"/></a:solidFill></p:spPr>`) + `</p:grpSp>`,
    // connector with an arrow at the end, flipped vertically
    `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="8" name="l"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(100, 900, 200, 100, ' flipV="1"')}<a:prstGeom prst="straightConnector1"/><a:ln w="38100"><a:solidFill><a:srgbClr val="333333"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>`,
    // custom geometry: drawn as a picture
    sp(`<p:spPr>${xfrm(800, 800, 100, 100)}<a:custGeom><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="0"/></a:lnTo><a:arcTo wR="50" hR="50" stAng="0" swAng="10800000"/><a:close/></a:path></a:pathLst></a:custGeom><a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill></p:spPr>`, "c&quot;&gt;&lt;script&gt;x"),
    // a chart: skipped and counted
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="10" name="chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr></p:graphicFrame>`
  ].join("")
};
const SLIDE2 = {
  body: `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>Placeholder title</a:t></a:r></a:p></p:txBody></p:sp>`
};

test("zip: stored and deflated entries, limits, garbage", async () => {
  for (const deflate of [false, true]) {
    const z = Z.open(makeZip({ "a.txt": "héllo", "dir/b.bin": Buffer.alloc(1000, 7) }, deflate));
    assert.deepEqual(z.names, ["a.txt", "dir/b.bin"]);
    assert.equal(await z.text("a.txt"), "héllo");
    assert.equal((await z.bytes("dir/b.bin")).length, 1000);
    assert.equal(await z.bytes("missing"), null);
    await assert.rejects(z.bytes("dir/b.bin", 999), /toobig/);
  }
  // a small deflated entry that inflates past the cap is stopped while streaming
  const bomb = Z.open(makeZip({ "x": Buffer.alloc(5 * 1024 * 1024, 0) }, true));
  await assert.rejects(bomb.bytes("x", 1024 * 1024), /toobig/);
  assert.throws(() => Z.open(new Uint8Array([1, 2, 3])), /zip/);
  assert.throws(() => Z.open(new Uint8Array(100)), /zip/);
});

test("xml: entities, CDATA, quotes, no DTD expansion", () => {
  const d = P.parseXml(`<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><r a='1' b="&lt;&#x3b1;&#946;&gt;"><c/>t&amp;x<![CDATA[<raw>]]>&e;</r>`);
  const r = d.c[0];
  assert.equal(r.n, "r");
  assert.equal(r.a.a, "1");
  assert.equal(r.a.b, "<αβ>");
  assert.equal(r.c[0].n, "c");
  assert.equal(r.t, "t&x<raw>&e;");
});

test("pptx: slides map to text, shapes, pictures, groups, lines, custom geometry", async () => {
  for (const deflate of [false, true]) {
    const plan = await P.parse(Z.open(deck([SLIDE1, SLIDE2], { deflate })), "Canva design");
    assert.equal(plan.w, 1080); assert.equal(plan.h, 1080);
    assert.equal(plan.pages.length, 2);
    assert.deepEqual(Object.keys(plan.media), ["ppt/media/image1.png"], "only package media, never external or escaping targets");
    assert.ok(plan.skipped >= 3, "chart + 2 unusable pictures counted");
    const [p1, p2] = plan.pages;
    assert.deepEqual(p1.bg, { g: { a: "#000000", b: "#ffffff", ang: 180 } });
    const by = (k) => p1.items.filter((i) => i.k === k);

    const t = by("text")[0];
    assert.equal(t.tx, "Γεια & χαρά\nsecond");
    assert.equal(t.font, "fs_playfair_display"); assert.equal(t.size, 36); assert.equal(t.b, 1); assert.equal(t.caps, 1);
    assert.equal(t.al, "c"); assert.equal(t.lh, 180); assert.equal(t.tr, 100);
    assert.equal(t.fc, "#800000", "accent1 at lumMod 50%");
    assert.equal(t.anchor, "ctr");
    assert.equal(t.x, 107.2); assert.equal(t.y, 103.6);   // default insets 7.2 / 3.6 pt

    const shapes = by("shape");
    const rr = shapes.find((s) => s.shp === "rounded");
    assert.equal(rr.rd, 50); assert.equal(rr.rot, 90); assert.equal(rr.fc, "#00ff00"); assert.equal(rr.op, 50);
    assert.equal(rr.sc, "#0000ff"); assert.equal(rr.sw, 2);
    assert.ok(!shapes.some((s) => s.fc === "#123456"), "hidden shape skipped");
    const dot = shapes.find((s) => s.shp === "circle");
    assert.deepEqual([dot.x, dot.y, dot.w, dot.h], [600, 900, 100, 100], "group child mapped through chOff/chExt");

    const pic = by("photo").find((p) => !p.svg);
    assert.equal(pic.shp, "circle"); assert.equal(pic.flh, 1); assert.equal(pic.op, 80);
    assert.deepEqual(pic.crop, { l: 0.1, t: 0, r: 0.1, b: 0 });

    const ln = by("line")[0];
    assert.deepEqual([ln.x, ln.y, ln.w, ln.h], [100, 1000, 200, -100], "flipV swaps the ends");
    assert.equal(ln.ae, "arrow"); assert.equal(ln.sw, 3); assert.equal(ln.sc, "#333333");

    const g = by("photo").find((p) => p.svg);
    const svg = plan.svgs[g.img];
    assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    assert.match(svg, /fill="#abcdef"/);
    assert.match(svg, /L100 0A50 50 0 0 1 0 0Z/, "arcTo becomes an SVG arc");
    assert.doesNotMatch(svg, /script/i, "only numbers and colours reach the SVG");

    const title = p2.items.find((i) => i.k === "text");
    assert.equal(title.tx, "Placeholder title");
    assert.deepEqual([title.x, title.size], [47.2, 44], "box from the layout, size from the master title style");
    assert.deepEqual(p2.bg, { fc: "#eeeeee", a: 1 }, "background inherited from the master");
  }
});

test("pptx: the built design is a new, canonical Atelier document", async () => {
  const plan = await P.parse(Z.open(deck([SLIDE1, SLIDE2])), "Imported");
  const assets = { "ppt/media/image1.png": { id: "a".repeat(64) + ".png", w: 800, h: 600 } };
  Object.keys(plan.svgs).forEach((k) => { assets[k] = { id: "b".repeat(64) + ".png", w: 200, h: 200 }; });
  const r = P.build(plan, assets, 5000);
  const d = r.doc;
  assert.equal(r.missing, 0);
  assert.equal(d.name, "Imported");
  assert.equal(d.pages.length, 2);
  assert.equal(J(M.normDoc(JSON.parse(J(d)))), J(d), "canonical");
  assert.ok(d.items.every((i) => i.ax && i.m === 5000));
  const t = d.items.find((i) => i.ax.k === "text" && /Γεια/.test(i.ax.tx));
  assert.ok(Math.abs(t.y + t.h / 2 - (103.6 + 292.8 / 2)) < 0.6, "middle anchor keeps the text centred in its box");
  const pic = d.items.find((i) => i.ax.k === "photo" && i.a.startsWith("a"));
  assert.equal(pic.fit, "custom");
  assert.ok(Math.abs(pic.isc - 400 / 0.8 / 800) < 1e-6 && Math.abs(pic.ix + 0.1 * 500) < 0.01);
  // a missing picture is counted, never a broken item
  const r2 = P.build(plan, {}, 6000);
  assert.ok(r2.missing >= 2);
  assert.ok(r2.doc.items.every((i) => i.t !== "img" || i.a));
});

test("pptx: not a presentation", async () => {
  await assert.rejects(P.parse(Z.open(makeZip({ "word/document.xml": "<w/>" }))), /pptx/);
  await assert.rejects(P.parse(Z.open(makeZip({ "ppt/presentation.xml": `<p:presentation ${NS}><p:sldIdLst/></p:presentation>` }))), /pptx/);
  assert.equal(P.familyOf("Courier New"), "mono");
  assert.equal(P.familyOf("Open Sans"), "sans");
  assert.equal(P.familyOf("Libre Baskerville"), "serif");
});

test("pptx: fonts by name become their Fontsource family", () => {
  assert.deepEqual(P.fontFor("Montserrat Bold"), { font: "fs_montserrat", name: "Montserrat", b: 1, i: 0 });
  assert.deepEqual(P.fontFor("Playfair Display Italic"), { font: "fs_playfair_display", name: "Playfair Display", b: 0, i: 1 });
  assert.equal(P.fontFor("Poppins SemiBold").b, 1);
  assert.equal(P.fontFor("GFS Didot").font, "fs_gfs_didot");
  // system, Office and Canva-only fonts, and Noto (built in): the closest built-in family
  assert.equal(P.fontFor("Canva Sans").font, "sans");
  assert.equal(P.fontFor("Times New Roman").font, "serif");
  assert.equal(P.fontFor("Noto Sans").font, "sans");
  assert.equal(P.fontFor("Courier New").font, "mono");
  assert.equal(P.fontFor("").font, "sans");
  // nothing odd gets into an id
  assert.equal(P.fontFor("../../x<script>").font, "fs_x_script");
  assert.equal(P.fontFor("Ráleway").font, "fs_raleway");
  assert.equal(P.fontFor("x".repeat(80)).font, "sans");
});
