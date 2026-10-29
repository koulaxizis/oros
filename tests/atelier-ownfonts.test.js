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
