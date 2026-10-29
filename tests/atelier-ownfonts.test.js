// Atelier wave AC3 (Canva PowerPoint fidelity): the fonts a .pptx
// carries (Embedded OpenType → own fonts, ext.fam with ax.font as the
// stand-in, setup.ext.fonts), pictures Canva writes as shapes filled
// with a picture (crop in fillRect, transparency, flips), exact line
// spacing, pair kerning (ext.kern) and text boxes that keep their
// lines. The .pptx files and fonts are built here, byte by byte.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const DKF = require(path.join(ROOT, "designkit/fonts.js"));
const AX = require(path.join(ROOT, "atelier/ax.js"));
const Z = require(path.join(ROOT, "atelier/zip.js"));
const P = require(path.join(ROOT, "atelier/pptx.js"));
const PDF = require(path.join(ROOT, "atelier/pdfout.js"));
const WEB = require(path.join(ROOT, "atelier/webout.js"));
const J = (x) => JSON.stringify(x);

function noto(file) {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", file));
  return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
const SERIF = noto("NotoSerif-Regular.ttf");
T.register("sans-r", noto("NotoSans-Regular.ttf").buffer);
T.register("sans-b", noto("NotoSans-Bold.ttf").buffer);
T.register("serif-r", SERIF.slice().buffer);

// A TrueType file passed off as PostScript outlines: "OTTO" and no
// "glyf" table (metrics and cmap stay readable).
function asCff(src) {
  const b = src.slice(), dv = new DataView(b.buffer);
  b.set([0x4F, 0x54, 0x54, 0x4F], 0);
  const n = dv.getUint16(4);
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    if (String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]) === "glyf") b.set([0x43, 0x46, 0x46, 0x20], o);
  }
  return b;
}
// Embedded OpenType around a font (version 2.2, no compression).
function eotOf(font, flags) {
  const head = 82, out = new Uint8Array(head + font.length), dv = new DataView(out.buffer);
  dv.setUint32(0, out.length, true); dv.setUint32(4, font.length, true);
  dv.setUint32(8, 0x00020002, true); dv.setUint32(12, flags || 0, true);
  dv.setUint16(34, 0x504C, true);
  const body = font.slice();
  if (flags & 0x10000000) for (let i = 0; i < body.length; i++) body[i] ^= 0x50;
  out.set(body, head);
  return out;
}

test("eot(): the font inside an Embedded OpenType file", () => {
  assert.deepEqual(P.eot(eotOf(SERIF)), SERIF);
  assert.deepEqual(P.eot(eotOf(SERIF, 0x10000000)), SERIF, "XOR obfuscation undone");
  assert.equal(P.eot(eotOf(SERIF, 0x4)), null, "MicroType Express is not read");
  assert.deepEqual(P.eot(SERIF), SERIF, "a plain font passes through");
  const bad = eotOf(SERIF); bad[34] = 0;
  assert.equal(P.eot(bad), null, "no magic number");
  const short = eotOf(SERIF); new DataView(short.buffer).setUint32(0, short.length + 10, true);
  assert.equal(P.eot(short), null, "sizes past the end");
  assert.equal(P.eot(new Uint8Array(10)), null);
  const junk = eotOf(new Uint8Array(200).fill(7));
  assert.equal(P.eot(junk), null, "not a font inside");
});

test("designkit fonts: PostScript outlines only when asked (Atelier), never in Layout's library", () => {
  const cff = asCff(SERIF).buffer;
  assert.equal(DKF.check(cff).err, "outlines");
  const c = DKF.check(cff, { cff: true });
  assert.ok(c.ok); assert.equal(c.info.glyf, false);
  assert.ok(DKF.check(SERIF.slice().buffer).ok);
  // text.js tells the PDF which face it cannot embed
  T.register("fs_ottotest-r", cff);
  T.registerFamily("fs_ottotest", { name: "Otto", urls: { r: ["x"] }, fallback: "sans" });
  assert.equal(T.faceParts("fs_ottotest-r")[0].cff, true);
  assert.equal(T.faceParts("serif-r")[0].cff, false);
  assert.equal(PDF.faceFor("fs_ottotest-r", 65), null, "its text becomes a picture in the PDF");
  assert.deepEqual(PDF.faceFor("serif-r", 65), ["serif-r", 0]);
});

// ---- a .pptx as Canva writes it ----
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function makeZip(files) {
  const locals = [], centrals = [];
  let off = 0;
  Object.keys(files).forEach((name) => {
    const raw = Buffer.from(files[name]);
    const nm = Buffer.from(name, "utf8"), lh = Buffer.alloc(30), ch = Buffer.alloc(46);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4);
    lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(raw.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt32LE(crc32(raw), 16); ch.writeUInt32LE(raw.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nm, raw); centrals.push(ch, nm);
    off += 30 + nm.length + raw.length;
  });
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22), n = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(n, 8); end.writeUInt16LE(n, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat(locals.concat([cd, end])));
}
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const E = (pt) => Math.round(pt * 12700);
const xfrm = (x, y, w, h, extra) => `<a:xfrm${extra || ""}><a:off x="${E(x)}" y="${E(y)}"/><a:ext cx="${E(w)}" cy="${E(h)}"/></a:xfrm>`;
const rels = (list) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((r) => `<Relationship Id="${r[0]}" Type="http://x/${r[1]}" Target="${r[2]}"/>`).join("")}</Relationships>`;
const rect = `<a:custGeom><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="0"/></a:lnTo><a:lnTo><a:pt x="100" y="100"/></a:lnTo><a:lnTo><a:pt x="0" y="100"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>`;
const sp = (inner) => `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Freeform"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>${inner}</p:sp>`;
const run = (face, extra, t) => `<a:r><a:rPr lang="el-GR" sz="3200"${extra || ""}><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:latin typeface="${face}"/></a:rPr><a:t>${t}</a:t></a:r>`;

function canvaDeck() {
  const body = [
    // a photo: a picture-filled freeform, the crop in fillRect, 5% opaque, mirrored
    sp(`<p:spPr>${xfrm(10, 20, 200, 100, ' flipH="true" flipV="false" rot="0"')}${rect}<a:blipFill><a:blip r:embed="rIdImg"><a:alphaModFix amt="5000"/></a:blip><a:stretch><a:fillRect l="-50000" t="0" r="-50000" b="0"/></a:stretch></a:blipFill></p:spPr>`),
    // srcRect and fillRect together
    sp(`<p:spPr>${xfrm(0, 200, 100, 100)}${rect}<a:blipFill><a:blip r:embed="rIdImg"/><a:srcRect l="20000" r="20000"/><a:stretch><a:fillRect l="10000" r="10000"/></a:stretch></a:blipFill></p:spPr>`),
    // text in an embedded font, exact line spacing
    `<p:sp><p:nvSpPr><p:cNvPr id="5" name="TextBox 5"/><p:cNvSpPr txBox="true"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(100, 400, 30, 50)}<a:prstGeom prst="rect"/></p:spPr><p:txBody><a:bodyPr lIns="0" tIns="0" rIns="0" bIns="0"><a:spAutoFit/></a:bodyPr><a:p><a:pPr algn="ctr"><a:lnSpc><a:spcPts val="4480"/></a:lnSpc></a:pPr>${run("Caudex", "", "ΓΛΑΡΟΛΥΚΟΙ")}</a:p></p:txBody></p:sp>`,
    // a typeface the file does not carry
    `<p:sp><p:nvSpPr><p:cNvPr id="6" name="TextBox 6"/><p:cNvSpPr txBox="true"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(100, 600, 400, 50)}<a:prstGeom prst="rect"/></p:spPr><p:txBody><a:bodyPr/><a:p>${run("Open Sans", "", "Other")}</a:p></p:txBody></p:sp>`
  ].join("");
  const files = {
    "[Content_Types].xml": "<Types/>",
    "ppt/presentation.xml": `<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="${E(1000)}" cy="${E(1000)}"/>` +
      `<p:embeddedFontLst><p:embeddedFont><p:font typeface="Caudex"/><p:regular r:id="rIdF1"/></p:embeddedFont>` +
      `<p:embeddedFont><p:font typeface="Broken"/><p:regular r:id="rIdF2"/></p:embeddedFont>` +
      `<p:embeddedFont><p:font typeface="Escape"/><p:regular r:id="rIdF3"/></p:embeddedFont></p:embeddedFontLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": rels([["rId1", "slide", "slides/slide1.xml"], ["rIdF1", "font", "fonts/font1.fntdata"], ["rIdF2", "font", "fonts/font2.fntdata"], ["rIdF3", "font", "../../x.fntdata"]]),
    "ppt/fonts/font1.fntdata": eotOf(SERIF),
    "ppt/fonts/font2.fntdata": new Uint8Array(100),
    "ppt/media/image1.png": Buffer.from([137, 80, 78, 71]),
    "ppt/slides/slide1.xml": `<?xml version="1.0" encoding="UTF-8"?><p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${body}</p:spTree></p:cSld></p:sld>`,
    "ppt/slides/_rels/slide1.xml.rels": rels([["rIdImg", "image", "../media/image1.png"]])
  };
  return makeZip(files);
}

const FILE = "1f".repeat(32) + ".ttf", OWN = "uf_" + "1f".repeat(8);
function ownEntry() { return { id: OWN, name: "Caudex", fb: "serif", r: FILE }; }

test("pptx: embedded fonts, picture-filled shapes, exact spacing", async () => {
  const zip = Z.open(canvaDeck());
  const plan = await P.parse(zip, "Canva");
  assert.deepEqual(plan.fonts, [{ name: "Caudex", r: "ppt/fonts/font1.fntdata" }, { name: "Broken", r: "ppt/fonts/font2.fntdata" }],
    "only files inside ppt/fonts/");
  const font = await zip.bytes(plan.fonts[0].r, 1e8);
  assert.deepEqual(P.eot(font), SERIF);
  assert.equal(P.eot(await zip.bytes(plan.fonts[1].r, 1e8)), null);

  const [a, b] = plan.pages[0].items.filter((i) => i.k === "photo");
  assert.equal(a.op, 5); assert.equal(a.flh, 1); assert.equal(a.flv, undefined);
  assert.deepEqual(a.crop, { l: 0.25, t: 0, r: 0.25, b: 0 }, "fillRect -50% each side: the picture is twice as wide, its middle shows");
  // srcRect 20% each side shown in the middle 80% of the box: the whole
  // picture is 0.8 / 0.6 box widths, starting 0.1 − 0.2 · 4/3 into it
  const W = 0.8 / 0.6, x = 0.1 - 0.2 * W;
  assert.ok(Math.abs(b.crop.l + x / W) < 1e-6 && Math.abs(b.crop.r - (1 - 1 / W + x / W)) < 1e-6);

  const t = plan.pages[0].items.find((i) => i.k === "text" && /ΓΛΑ/.test(i.tx));
  assert.equal(t.face, "Caudex"); assert.equal(t.lh, 140, "44.8 pt at 32 pt");
});

test("pptx build: own font as ext.fam over its stand-in, kerning, the design's font list", async () => {
  const plan = await P.parse(Z.open(canvaDeck()), "Canva");
  const assets = { "ppt/media/image1.png": { id: "a".repeat(64) + ".png", w: 400, h: 100 } };
  AX.useDocFonts({ setup: { ext: { fonts: [ownEntry()] } } });
  T.register(OWN + "-r", SERIF.slice().buffer);
  const r = P.build(plan, assets, 7000, { Caudex: ownEntry() });
  const d = r.doc;
  assert.equal(J(M.normDoc(JSON.parse(J(d)))), J(d), "canonical");
  assert.deepEqual(d.setup.ext.fonts, [ownEntry()], "only the families the text uses");
  const t = d.items.find((i) => i.ax.k === "text" && /ΓΛΑ/.test(i.ax.tx));
  assert.deepEqual(t.ext, { fam: OWN, kern: 1 });
  assert.equal(t.ax.font, "fs_caudex", "the Fontsource match stays as the stand-in");
  assert.equal(AX.fontOf(t), OWN);
  assert.equal(AX.fontKeyOf(t.ax, t), OWN + "-r");
  assert.equal(AX.fontKeyOf(t.ax), "fs_caudex-r");
  // far too narrow for its word (past the 8% slack): the box stays as it was
  assert.equal(t.w, 30);
  const other = d.items.find((i) => i.ax.k === "text" && i.ax.tx === "Other");
  assert.deepEqual(other.ext, { kern: 1 });
  assert.equal(AX.fontOf(other), "fs_open_sans");
  const ph = d.items.find((i) => i.ax.k === "photo" && i.op === 5);
  assert.equal(ph.fit, "custom"); assert.equal(ph.ax.flh, 1);
  assert.ok(Math.abs(ph.isc - 200 * 2 / 400) < 1e-6 && Math.abs(ph.ix + 0.25 * 400) < 0.01);
  // without the font list the text keeps its stand-in
  const r2 = P.build(plan, assets, 7000, {});
  assert.ok(!r2.doc.setup.ext || !r2.doc.setup.ext.fonts);
  assert.ok(r2.doc.items.every((i) => !i.ext || !i.ext.fam));
});

test("pptx build: a line that runs a little past its box widens the box around its alignment", async () => {
  const plan = await P.parse(Z.open(canvaDeck()), "Canva");
  const s = plan.pages[0].items.find((i) => i.k === "text" && /ΓΛΑ/.test(i.tx));
  AX.useDocFonts({ setup: { ext: { fonts: [ownEntry()] } } });
  T.register(OWN + "-r", SERIF.slice().buffer);
  const it = { ax: { k: "text", tx: s.tx, font: "serif", size: 32, al: "c" }, ext: { fam: OWN, kern: 1 }, t: "rect" };
  const nat = AX.textWidth(it.ax, it, true);
  s.w = Math.round(nat * 0.97 * 100) / 100;            // 3% short, as another program measured
  const d = P.build(plan, { "ppt/media/image1.png": { id: "a".repeat(64) + ".png", w: 400, h: 100 } }, 1, { Caudex: ownEntry() }).doc;
  const t = d.items.find((i) => i.ax.k === "text" && /ΓΛΑ/.test(i.ax.tx));
  assert.equal(AX.textLayout(t).lines.length, 1, "one line, as in Canva");
  assert.ok(Math.abs(t.x + t.w / 2 - (s.x + s.w / 2)) < 0.02, "centred text keeps its centre");
});

test("own fonts: setFont, docFonts, registration, PDF / web export", () => {
  const it = { ax: { k: "text", tx: "x", font: "serif" } };
  AX.setFont(it, OWN);
  assert.deepEqual([it.ax.font, it.ext], ["serif", { fam: OWN }], "an own font keeps the stand-in");
  AX.setFont(it, "fs_lora");
  assert.equal(it.ax.font, "fs_lora"); assert.equal(it.ext, undefined, "another font clears it (and an empty ext)");
  const tb = { ax: { k: "table", font: "sans" } };
  AX.setFont(tb, OWN);
  assert.equal(tb.ext, undefined, "tables keep ax.font");
  const kept = { ax: { k: "text", font: "sans" }, ext: { lnk: "https://x.org", fam: OWN } };
  AX.setFont(kept, "serif");
  assert.deepEqual(kept.ext, { lnk: "https://x.org" });

  const doc = { setup: { ext: { fonts: [ownEntry(), { id: "uf_bad", r: FILE }, { id: "uf_" + "2".repeat(16), r: "nope.ttf" }, { id: "uf_" + "3".repeat(16), name: "B", fb: "x", r: FILE, b: FILE, i: "../x" }] } } };
  assert.deepEqual(AX.docFonts(doc), [ownEntry(), { id: "uf_" + "3".repeat(16), name: "B", fb: "sans", r: FILE, b: FILE }]);
  assert.equal(AX.useDocFonts(doc), 2);
  assert.deepEqual(T.FAMILIES["uf_" + "3".repeat(16)].urls, { r: ["asset:" + FILE], b: ["asset:" + FILE], i: [], bi: [] });
  // an id this device has not registered: the stand-in
  const lost = { ax: { k: "text", font: "serif" }, ext: { fam: "uf_" + "9".repeat(16) } };
  assert.equal(AX.fontOf(lost), "serif");
  assert.equal(AX.fontName(OWN), "Caudex");

  // web page: own-font text is a picture (the file is not handed out)
  const own = { id: "i1", t: "rect", pg: "p1", ax: { k: "text", tx: "Hi", font: "serif" }, ext: { fam: OWN } };
  assert.equal(WEB.kindOf(own), "raster");
  assert.equal(WEB.kindOf({ id: "i2", t: "rect", pg: "p1", ax: { k: "text", tx: "Hi", font: "serif" } }), "text");
});

test("kerning: layout and the PDF place pairs the same way", () => {
  const key = "serif-r";
  const k = T.kernPair(key, "A", "V", 100);
  const plain = { ax: { k: "text", tx: "AVAV", font: "serif", size: 100 }, w: 2000, t: "rect" };
  const kerned = { ax: plain.ax, ext: { kern: 1 }, w: 2000, t: "rect" };
  const w0 = AX.textWidth(plain.ax, plain, true), w1 = AX.textWidth(plain.ax, kerned, true);
  assert.ok(Math.abs(w1 - w0 - 3 * k) < 0.01, "three kerned pairs");
  const r0 = AX.textLayout(kerned).lines[0].runs.filter((r) => r.t);
  assert.ok(r0.every((r) => r.kern === 1), "runs carry the kerning to the drawing");
  assert.ok(!AX.textLayout(plain).lines[0].runs.some((r) => r.kern));
});

// ---- AC3b: one box with paragraphs in different styles; designs past
// PowerPoint's largest slide ----
function deckOf(body, cx, cy) {
  return makeZip({
    "[Content_Types].xml": "<Types/>",
    "ppt/presentation.xml": `<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="${cx || E(1000)}" cy="${cy || E(1000)}"/></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": rels([["rId1", "slide", "slides/slide1.xml"]]),
    "ppt/media/image1.png": Buffer.from([137, 80, 78, 71]),
    "ppt/slides/slide1.xml": `<?xml version="1.0" encoding="UTF-8"?><p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${body}</p:spTree></p:cSld></p:sld>`,
    "ppt/slides/_rels/slide1.xml.rels": rels([["rIdImg", "image", "../media/image1.png"]])
  });
}
const para = (pts, r) => `<a:p><a:pPr algn="ctr"><a:lnSpc><a:spcPts val="${pts}"/></a:lnSpc></a:pPr>${r || ""}</a:p>`;
const runSz = (sz, col, t) => `<a:r><a:rPr lang="el-GR" sz="${sz}"><a:solidFill><a:srgbClr val="${col}"/></a:solidFill><a:latin typeface="Noto Serif"/></a:rPr><a:t>${t}</a:t></a:r>`;
const box = (rot, paras) => `<p:sp><p:nvSpPr><p:cNvPr id="7" name="TextBox 7"/><p:cNvSpPr txBox="true"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(100, 100, 600, 300, rot ? ` rot="${rot * 60000}"` : "")}<a:prstGeom prst="rect"/></p:spPr><p:txBody><a:bodyPr lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"/>${paras}</p:txBody></p:sp>`;

test("pptx: paragraphs in other styles become items stacked baseline to baseline, blank lines between them kept", async () => {
  const paras = para(4000, runSz(3200, "FFFFFF", "Title")) + para(4000, runSz(3200, "FFFFFF", "Title 2")) + para(2000, "") +
    para(2000, runSz(1600, "BCBBBA", "Author")) + para(2000, runSz(1600, "BCBBBA", "Author 2"));
  const plan = await P.parse(Z.open(deckOf(box(0, paras))), "Canva");
  const ts = plan.pages[0].items.filter((i) => i.k === "text");
  assert.deepEqual(ts.map((t) => t.tx), ["Title\nTitle 2", "Author\nAuthor 2"]);
  assert.equal(ts[1].gap, 40, "the blank paragraph is the block above's line (32 pt at 125%)");
  assert.ok(ts[0].stk && ts[1].stk === ts[0].stk);
  const d = P.build(plan, {}, 1).doc;
  const [a, b] = d.items.filter((i) => i.ax.k === "text").sort((p, q) => p.z - q.z);
  const L = (it) => AX.textLayout(it).lines;
  assert.equal(a.y, 100, "a top-anchored stack starts at the box");
  const last = a.y + L(a)[L(a).length - 1].y, first = b.y + L(b)[0].y;
  assert.ok(Math.abs(first - last - (40 + 20)) < 0.02, "the blank line, then one line at the second block's spacing");
  assert.equal(b.ax.fc, "#bcbbba"); assert.equal(b.ax.size, 16);
  // a rotated box stays one item in its first style
  const rot = await P.parse(Z.open(deckOf(box(90, paras))), "Canva");
  const rt = rot.pages[0].items.filter((i) => i.k === "text");
  assert.equal(rt.length, 1); assert.equal(rt[0].tx, "Title\nTitle 2\nAuthor\nAuthor 2"); assert.equal(rt[0].stk, undefined);
});

test("pptx: a design past PowerPoint's largest slide gets its own page back", async () => {
  // Canva: a 2:1 design 5184 pt wide on a 4025 × 2592 pt slide, scaled to its width and centred
  const H = 4025 / 2, top = (2592 - H) / 2;
  const bg = sp(`<p:spPr>${xfrm(0, top, 4025, H)}${rect}<a:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></a:blipFill></p:spPr>`);
  const text = box(0, para(4000, runSz(3200, "000000", "Hi")));
  const plan = await P.parse(Z.open(deckOf(bg + text, 51117500, 32918400)), "Banner");
  assert.equal(plan.w, 4025); assert.ok(Math.abs(plan.h - H) < 0.01);
  const t = plan.pages[0].items.find((i) => i.k === "text");
  assert.ok(Math.abs(t.y - (100 - top)) < 0.01, "everything moves with the page");
  // a slide below the limit is left as it is
  const small = await P.parse(Z.open(deckOf(bg + text, E(4000), E(2592))), "Small");
  assert.equal(small.h, 2592);
});

test("pptx: bold words and other typefaces inside a paragraph become runs (ext.runs)", async () => {
  const r = (face, b, t) => `<a:r><a:rPr lang="el-GR" sz="3200"${b ? ' b="1"' : ""}><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:latin typeface="${face}"/></a:rPr><a:t>${t}</a:t></a:r>`;
  const red = `<a:r><a:rPr lang="el-GR" sz="3200"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:latin typeface="Caudex"/></a:rPr><a:t> red</a:t></a:r>`;
  const paras = `<a:p>${r("Caudex", 0, "Get ")}${r("Caudex Bold", 0, "40%")}${r("Caudex", 0, " off")}${red}</a:p><a:p>${r("Caudex", 0, "now ")}${r("Caudex", 1, "here")}</a:p>`;
  const plan = await P.parse(Z.open(deckOf(box(0, paras))), "Canva");
  const t = plan.pages[0].items.find((i) => i.k === "text");
  assert.equal(t.tx, "Get 40% off red\nnow here");
  assert.deepEqual(t.runs, [{ n: 4 }, { n: 3, b: 1, i: 0, face: "Caudex Bold" }, { n: 13 }, { n: 4, b: 1, i: 0, face: "Caudex" }],
    "another size or colour keeps the box's look; the paragraph break belongs to the plain run");
  const BOLD = "uf_" + "2b".repeat(8);
  AX.useDocFonts({ setup: { ext: { fonts: [ownEntry(), { id: BOLD, name: "Caudex Bold", fb: "serif", r: "2b".repeat(32) + ".ttf" }] } } });
  T.register(OWN + "-r", SERIF.slice().buffer); T.register(BOLD + "-r", noto("NotoSerif-Bold.ttf").buffer);
  const d = P.build(plan, {}, 1, { Caudex: ownEntry(), "Caudex Bold": { id: BOLD, name: "Caudex Bold", fb: "serif", r: "2b".repeat(32) + ".ttf" } }).doc;
  assert.equal(J(M.normDoc(JSON.parse(J(d)))), J(d), "canonical");
  const it = d.items.find((i) => i.ax.k === "text");
  assert.deepEqual(it.ext.runs, [{ n: 4 }, { n: 3, b: 1, fam: BOLD }, { n: 13 }, { n: 4, b: 1 }]);
  assert.deepEqual(d.setup.ext.fonts.map((f) => f.id).sort(), [BOLD, OWN].sort(), "a run's own font is in the design's list");
  const keys = [];
  AX.textLayout(it).lines.forEach((ln) => ln.runs.forEach((x) => { if (x.t.trim()) keys.push(x.t + "=" + x.key); }));
  assert.ok(keys.includes("40%=" + BOLD + "-b") && keys.includes("Get=" + OWN + "-r") && keys.includes("here=" + OWN + "-b"), keys.join(" "));
  assert.ok(AX.textWidth(it.ax, it, true) > T.measure(OWN + "-r", "Get 40% off red", 32), "the bold run is wider");
  assert.equal(WEB.kindOf(Object.assign({ id: "w", t: "rect", pg: "p" }, it, { ext: { runs: it.ext.runs } })), "raster", "a run in an own font: a picture on a web page");
  // the text no longer matches the runs: they are not used
  assert.equal(AX.runsOf({ ax: { tx: "short" }, ext: it.ext }), null);
});

test("ext.runs: edits keep them in step, a font for the whole text replaces theirs", () => {
  const it = { ax: { k: "text", tx: "ab CD ef" }, ext: { runs: [{ n: 3 }, { n: 2, b: 1, fam: OWN }, { n: 3 }] } };
  const ed = (v) => { AX.editRuns(it, it.ax.tx, v); it.ax.tx = v; return it.ext && it.ext.runs && it.ext.runs.map((r) => r.n); };
  assert.deepEqual(ed("ab CDX ef"), [3, 3, 3], "typed at the end of the bold run: bold");
  assert.deepEqual(ed("Zab CDX ef"), [4, 3, 3]);
  assert.deepEqual(ed("Zab ef"), [4, 2], "the bold run deleted");
  it.ax.tx = "ab CD ef"; it.ext = { runs: [{ n: 3 }, { n: 2, b: 1, fam: OWN }, { n: 3 }], kern: 1 };
  AX.setFont(it, "serif");
  assert.deepEqual(it.ext, { runs: [{ n: 3 }, { n: 2, b: 1 }, { n: 3 }], kern: 1 }, "bold stays, the run's font goes");
  it.ext.runs[1] = { n: 2, fam: OWN };
  AX.setFont(it, "sans");
  assert.deepEqual(it.ext, { kern: 1 }, "runs with nothing left are dropped");
});

test("pptx: radial and multi-stop gradients keep their stops (ext.gs over the ax.g stand-in)", async () => {
  const gs = (pts) => pts.map(([p, c]) => `<a:gs pos="${p}"><a:srgbClr val="${c}"/></a:gs>`).join("");
  const radial = sp(`<p:spPr>${xfrm(0, 0, 400, 200)}<a:prstGeom prst="rect"/><a:gradFill rotWithShape="true"><a:gsLst>${gs([[0, "0B6DC2"], [50000, "138EFF"], [100000, "A2D2FF"]])}</a:gsLst><a:path path="circle"><a:fillToRect l="0" r="100000" t="0" b="100000"/></a:path></a:gradFill></p:spPr>`);
  const three = sp(`<p:spPr>${xfrm(0, 300, 400, 200)}<a:prstGeom prst="rect"/><a:gradFill><a:gsLst>${gs([[100000, "0000FF"], [0, "FF0000"], [30000, "00FF00"]])}</a:gsLst><a:lin ang="0"/></a:gradFill></p:spPr>`);
  const two = sp(`<p:spPr>${xfrm(0, 600, 400, 200)}<a:prstGeom prst="rect"/><a:gradFill><a:gsLst>${gs([[0, "FF0000"], [100000, "0000FF"]])}</a:gsLst><a:lin ang="0"/></a:gradFill></p:spPr>`);
  const plan = await P.parse(Z.open(deckOf(radial + three + two)), "Canva");
  const [r, t, w] = plan.pages[0].items;
  assert.deepEqual(r.g, { a: "#0b6dc2", b: "#a2d2ff", ang: 180 });
  assert.deepEqual(r.gs, { st: [[0, "#0b6dc2"], [0.5, "#138eff"], [1, "#a2d2ff"]], r: 1, c: [0, 0] }, "centred on the top-left corner");
  assert.deepEqual(t.gs, { st: [[0, "#ff0000"], [0.3, "#00ff00"], [1, "#0000ff"]] }, "stops in order");
  assert.equal(w.gs, undefined, "two stops, linear: ax.g alone");
  const d = P.build(plan, {}, 1).doc;
  assert.equal(J(M.normDoc(JSON.parse(J(d)))), J(d), "canonical");
  const it = d.items.find((i) => i.ax.g && i.ext && i.ext.gs && i.ext.gs.r);
  assert.deepEqual(AX.gradOf(it), { st: r.gs.st, r: 1, c: [0, 0] });
  // a gradient changed elsewhere in Atelier (the stand-in's colours) leaves the stops out
  const moved = JSON.parse(J(it)); moved.ax.g.b = "#ffffff";
  assert.equal(AX.gradOf(moved), null);
  assert.equal(AX.gradOf({ ax: { g: { a: "#000000", b: "#ffffff" } }, ext: { gs: { st: [[0.5, "#000000"], [0.2, "#ffffff"]] } } }), null, "stops out of order");
  assert.equal(AX.gradOf({ ax: { g: { a: "#000000", b: "#ffffff" } }, ext: { gs: { st: [[0, "#000000"], [1, "red"]] } } }), null);
  // a web page and PowerPoint write every stop; PowerPoint comes back the same
  const web = WEB.build(d, {}, {}), page = web.files.find((f) => f.name === "index.html");
  const h = typeof page.data === "string" ? page.data : Buffer.from(page.data).toString("utf8");
  assert.match(h, /<radialGradient [^>]*><stop offset="0"[^>]*\/><stop offset="0.5"[^>]*\/><stop offset="1"/);
  const PX = require(path.join(ROOT, "atelier/pptxout.js"));
  const back = await P.parse(Z.open(PX.build(d, {}).bytes), "back");
  const g2 = back.pages[0].items.filter((i) => i.gs);
  assert.deepEqual(g2.map((i) => i.gs), [r.gs, t.gs]);
});
