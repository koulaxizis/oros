// Slides: PowerPoint (.pptx) save and open (slides/pptx.js).
// A deck is written with write(), read back with read() + build(), and
// must come back with the same structure: slides, layouts and
// placeholders, paragraphs / bullets / levels / run formatting,
// colours (theme roles too), sizes, alignment, pictures with their
// crop, shapes, lines, backgrounds, notes, hidden slides, transitions,
// 16:9 and 4:3. Also: a file made by Atelier opens; a foreign file
// with placeholders that inherit from the layout / master / theme,
// groups, charts and video opens with placeholder notes, tables as tables;
// DTDs are refused, external links never followed.
// In the browser XML goes through DOMParser; here Atelier's small
// tolerant parser (atelier/pptx.js parseXml) stands in for it.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const AP = require(path.join(ROOT, "atelier/pptx.js"));
const AO = require(path.join(ROOT, "atelier/pptxout.js"));
const AX = require(path.join(ROOT, "atelier/ax.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const ctx = { TextEncoder, TextDecoder, DecompressionStream };
vm.createContext(ctx);
["slides/core.js", "slides/dk.js", "atelier/zip.js", "slides/pptx.js"].forEach((f) =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx));
const C = ctx.OrosSlidesCore, X = ctx.OrosSlidesPPTX, Z = ctx.AtelierZip;
const j = (x) => JSON.parse(JSON.stringify(x));
const parseXml = AP.parseXml;

const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const IMG = "a".repeat(64) + ".png", IMG2 = "b".repeat(64) + ".jpg";

function ids(prefix) {
  let n = 0;
  return () => prefix + String(++n).padStart(4, "0");
}
function strip(it) {
  const y = j(it);
  ["id", "m", "s", "b", "z"].forEach((k) => delete y[k]);       // z: renumbered, order kept
  return y;
}

function richDeck(aspect) {
  const d = C.emptyData(), nid = ids("x");
  const deck = C.newDeck(d, { t: "Ετήσια <αναφορά> & σχέδια", th: "ocean", as: aspect || "16:9" }, 1000, nid);
  const s1 = C.addSlide(d, deck.id, "title", null, 1000, nid);
  C.setItemParas(d, C.placeholder(d, s1.id, "title").id, [{ l: 0, ls: "", r: [{ t: "Καλωσήρθατε " }, { t: "όλοι", c: "t:a2", u: true }] }], 1000);
  C.setItemParas(d, C.placeholder(d, s1.id, "sub").id, [{ l: 0, ls: "", r: [{ t: "Ομάδα · 2026" }] }], 1000);
  const s2 = C.addSlide(d, deck.id, "content", s1.id, 1000, nid);
  const s2d = d.slides[s2.id];
  s2d.hid = true; s2d.tr = "fade"; s2d.bg = "#123456"; s2d.n = "Πρώτη γραμμή\n\nΤρίτη <γραμμή> & τέλος";
  C.setItemParas(d, C.placeholder(d, s2.id, "title").id, [{ l: 0, ls: "", r: [{ t: "Σημεία" }] }], 1000);
  const body = C.placeholder(d, s2.id, "body");
  body.fs = 36; body.al = "j"; body.va = "m"; body.fit = false; body.fc = "#fafafa";
  C.setItemParas(d, body.id, [
    { l: 0, ls: "b", r: [{ t: "Πρώτο " }, { t: "έντονο", b: true }, { t: " και " }, { t: "πλάγιο", i: true }] },
    { l: 1, ls: "b", r: [{ t: "δεύτερο επίπεδο", c: "#ff0000" }] },
    { l: 2, ls: "n", r: [{ t: "αρίθμηση" }] },
    { l: 2, ls: "n", r: [{ t: "δεύτερη", u: true }] },
    { l: 0, ls: "", r: [] },
    { l: 1, ls: "", r: [{ t: "χωρίς κουκκίδα" }] }
  ], 1000);
  const add = (o) => { const it = C.normItem(Object.assign({ id: nid(), m: 1000, s: s2.id, z: 10 + Object.keys(d.items).length }, o)); d.items[it.id] = it; return it; };
  add({ k: "shape", sh: "rect", x: 100, y: 120, w: 300, h: 200, r: 15, rad: 20, fill: "t:a1", st: "#000000", sw: 3, dash: true, op: 60 });
  add({ k: "shape", sh: "ellipse", x: 500, y: 600, w: 200, h: 100, fill: "#00ff00" });
  add({ k: "shape", sh: "rect", x: 900, y: 600, w: 120, h: 80, st: "t:fg", sw: 5 });
  add({ k: "line", x: 100, y: 800, w: 400, h: 150, flip: true, st: "t:a3", sw: 4 });
  add({ k: "line", x: 600, y: 900, w: 500, h: 2, st: "#222222", sw: 2, dash: true });
  add({ k: "line", x: 1300, y: 300, w: 2, h: 400, st: "#222222", sw: 6 });
  add({ k: "text", x: 1200, y: 100, w: 400, h: 200, r: -30, ff: "serif", fill: "t:sf", fc: "t:mu", fs: 30, al: "r", va: "b",
    paras: [{ l: 0, ls: "", r: [{ t: "Σημείωση" }] }] });
  add({ k: "image", x: 1100, y: 450, w: 400, h: 300, rad: 30, img: { a: IMG, pw: 800, ph: 400, fit: "fill", zm: 150, ox: 40, oy: -30, alt: "Ακρόπολη" } });
  add({ k: "image", x: 200, y: 400, w: 300, h: 300, img: { a: IMG2, pw: 640, ph: 480, fit: "fill", zm: 100, ox: 0, oy: 0, alt: "" } });
  const s3 = C.addSlide(d, deck.id, "imgtext", s2.id, 1000, nid);
  d.slides[s3.id].tr = "push";
  C.setItemParas(d, C.placeholder(d, s3.id, "title").id, [{ l: 0, ls: "", r: [{ t: "Εικόνα" }] }], 1000);
  const ph = C.placeholder(d, s3.id, "img");
  ph.img = { a: IMG2, pw: 640, ph: 480, fit: "fill", ox: 0, oy: 0, zm: 100, alt: "" };
  const s4 = C.addSlide(d, deck.id, "quote", s3.id, 1000, nid);       // left empty: placeholders only
  d.slides[s4.id].tr = "zoom";
  const s5 = C.addSlide(d, deck.id, "blank", s4.id, 1000, nid);
  d.slides[s5.id].tr = "slide"; d.slides[s5.id].bg = "t:a1";
  return { d: C.canonical(d), deck, nid };
}

async function roundTrip(d, deckId, media, assets) {
  const w = X.write(d, deckId, media, {});
  const zip = Z.open(w.bytes);
  const plan = await X.read(zip, { parseXml });
  const b = X.build(plan, assets || {}, 5000, ids("y"));
  return { w, zip, plan, b };
}
function slideItemsOf(b, slideId) {
  return b.items.filter((it) => it.s === slideId).sort((x, y) => x.z - y.z).map(strip);
}
const ASSETS = { [IMG]: { w: 800, h: 400 }, [IMG2]: { w: 640, h: 480 } };
function mediaAssets(plan, zip, byBytes) {
  // the reader names media by path; map each back to the asset it came from
  const out = {};
  Object.keys(plan.media).forEach((p) => { out[p] = byBytes(p); });
  return out;
}

test("pptx: the written package has every part, all well-formed, nothing external", async () => {
  const { d, deck } = richDeck();
  const w = X.write(d, deck.id, { [IMG]: PNG, [IMG2]: PNG });
  const zip = Z.open(w.bytes);
  ["[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels", "ppt/slideMasters/slideMaster1.xml",
    "ppt/theme/theme1.xml", "ppt/notesMasters/notesMaster1.xml", "ppt/theme/theme2.xml", "ppt/slides/slide1.xml", "ppt/slides/slide5.xml",
    "ppt/slideLayouts/slideLayout9.xml", "ppt/notesSlides/notesSlide1.xml", "docProps/core.xml", "docProps/app.xml"].forEach((p) => assert.ok(zip.has(p), p));
  assert.equal(w.out.slides, 5);
  assert.equal(w.out.pictures, 3);
  assert.equal(w.out.missing, 0);
  // one picture file per asset, shared by every slide that uses it
  assert.equal(zip.names.filter((n) => /^ppt\/media\//.test(n)).length, 2);
  // every XML part is balanced (start/end tags pair up) and has no DOCTYPE
  for (const name of zip.names.filter((n) => /\.(xml|rels)$/.test(n))) {
    const s = await zip.text(name);
    assert.ok(!/<!DOCTYPE/i.test(s), name);
    const stack = [];
    s.replace(/<(\/?)([A-Za-z][\w:.-]*)[^>]*?(\/?)>/g, (m, close, tag, self) => {
      if (self) return m;
      if (close) assert.equal(stack.pop(), tag, name + ": " + tag); else stack.push(tag);
      return m;
    });
    assert.equal(stack.length, 0, name);
  }
  const ct = await zip.text("[Content_Types].xml");
  assert.match(ct, /notesSlide\+xml/);
  const s1 = await zip.text("ppt/slides/slide1.xml");
  assert.match(s1, /<p:ph type="title"\/>/);
  assert.match(s1, /<p:ph type="subTitle" idx="1"\/>/);
  const s2 = await zip.text("ppt/slides/slide2.xml");
  assert.match(s2, /<p:sld [^>]*show="0"/);
  assert.match(s2, /&lt;|Σημεία/);
  assert.match(s2, /<a:schemeClr val="accent1">/);
  assert.match(s2, /<p:transition spd="med"><p:fade\/><\/p:transition>/);
  const core = await zip.text("docProps/core.xml");
  assert.match(core, /Ετήσια &lt;αναφορά&gt; &amp; σχέδια/);
  const pres = await zip.text("ppt/presentation.xml");
  assert.match(pres, /<p:sldSz cx="12192000" cy="6858000"\/>/);
  const theme = await zip.text("ppt/theme/theme1.xml");
  assert.match(theme, /name="orOS ocean"/);
  assert.match(theme, /<a:lt1><a:srgbClr val="0B3954"\/><\/a:lt1>/);
});

test("pptx: save → open gives the same deck (text, bullets, runs, colours, shapes, lines, pictures, notes)", async () => {
  const { d, deck } = richDeck();
  const media = { [IMG]: PNG, [IMG2]: Uint8Array.from([...PNG, 1]) };
  const w = X.write(d, deck.id, media);
  const zip = Z.open(w.bytes);
  const plan = await X.read(zip, { parseXml });
  // which media file is which asset: by its bytes
  const assets = {};
  for (const p of Object.keys(plan.media)) {
    const b = await zip.bytes(p);
    const id = b.length === PNG.length ? IMG : IMG2;
    assets[p] = { id, w: ASSETS[id].w, h: ASSETS[id].h };
  }
  const b = X.build(plan, assets, 5000, ids("y"));
  assert.equal(b.missing, 0);
  assert.equal(b.deck.t, "Ετήσια <αναφορά> & σχέδια");
  assert.equal(b.deck.th, "ocean");
  assert.equal(b.deck.as, "16:9");
  const before = C.deckSlides(d, deck.id);
  assert.equal(b.slides.length, before.length);
  before.forEach((s, i) => {
    const t = b.slides[i];
    assert.equal(t.ly, s.ly, "layout " + i);
    assert.equal(t.hid, s.hid, "hidden " + i);
    assert.equal(t.tr, s.tr, "transition " + i);
    assert.equal(t.n, s.n, "notes " + i);
    assert.equal(t.bg, s.bg, "background " + i);
    assert.deepEqual(slideItemsOf(b, t.id), C.slideItems(d, s.id).map(strip), "items of slide " + (i + 1));
  });
  // the result is valid slides data: canonical keeps everything
  const data = C.emptyData();
  data.decks[b.deck.id] = b.deck;
  b.slides.forEach((s) => { data.slides[s.id] = s; });
  b.items.forEach((it) => { data.items[it.id] = it; });
  const canon = C.canonical(j(data));
  assert.equal(Object.keys(canon.items).length, b.items.length);
  assert.equal(Object.keys(canon.slides).length, b.slides.length);
});

test("pptx: 4:3 decks, a picture shown whole (fit) keeps its place, missing pictures are counted", async () => {
  const { d, deck, nid } = richDeck("4:3");
  const s = C.deckSlides(d, deck.id)[4];
  const fit = C.normItem({ id: nid(), m: 1, s: s.id, k: "image", x: 100, y: 100, w: 600, h: 300, z: 50, img: { a: IMG, pw: 400, ph: 400, fit: "fit", zm: 100 } });
  d.items[fit.id] = fit;
  const w = X.write(d, deck.id, { [IMG]: PNG });
  assert.equal(w.out.missing, 2);                      // IMG2 twice (free picture + placeholder)
  const zip = Z.open(w.bytes);
  assert.match(await zip.text("ppt/presentation.xml"), /<p:sldSz cx="9144000" cy="6858000" type="screen4x3"\/>/);
  const plan = await X.read(zip, { parseXml });
  assert.equal(plan.as, "4:3");
  const assets = {};
  Object.keys(plan.media).forEach((p) => { assets[p] = { id: IMG, w: 400, h: 400 }; });
  const b = X.build(plan, assets, 5000, ids("y"));
  const last = b.slides[4];
  const img = b.items.find((it) => it.s === last.id && it.k === "image");
  // drawn the same: a 300 × 300 square in the middle of the 600 × 300 frame
  assert.deepEqual([img.x, img.y, img.w, img.h], [250, 100, 300, 300]);
  assert.equal(img.img.zm, 100);
  // the picture placeholder without its file is an empty placeholder again
  const s3 = b.slides[2];
  const ph = b.items.find((it) => it.s === s3.id && it.ph === "img");
  assert.ok(ph && !ph.img);
});

test("pptx: crop maths: zoom and offsets survive the trip through a crop", () => {
  [[150, 40, -30], [100, 0, 0], [300, -100, 100], [220, 13, 77]].forEach(([zm, ox, oy]) => {
    const it = { x: 0, y: 0, w: 400, h: 300, r: 0, img: { a: IMG, pw: 800, ph: 400, fit: "fill", zm, ox, oy } };
    const g = X.picGeom(it);
    const back = X.cropToImg({ w: g.w, h: g.h, crop: g.crop }, { id: IMG, w: 800, h: 400 });
    assert.equal(back.zm, zm);
    assert.ok(Math.abs(back.ox - ox) <= 1 && Math.abs(back.oy - oy) <= 1, JSON.stringify([back.ox, back.oy, ox, oy]));
  });
});

test("pptx: a file saved by Atelier opens in Slides", async () => {
  const doc = AX.newDesign({ name: "Atelier deck", w: 1920, h: 1080, unit: "px", bg: "#112233", pages: 2 }, 1000);
  const [p1, p2] = M.pagesInOrder(doc);
  AX.addItem(doc, p1.id, { k: "text", tx: "Γεια σου & <κόσμε>\nδεύτερη", font: "serif", size: 64, b: 1, al: "c", fc: "#ff0000", x: 100, y: 120, w: 800 }, 1000);
  AX.addItem(doc, p1.id, { k: "shape", shp: "rect", fc: "#00ff00", x: 50, y: 400, w: 300, h: 200 }, 1000);
  AX.addItem(doc, p1.id, { k: "shape", shp: "circle", fc: "#0000ff", x: 500, y: 400, w: 200, h: 200 }, 1000);
  AX.addItem(doc, p2.id, { k: "photo", a: IMG, iw: 400, ih: 200, fit: "fill", x: 0, y: 0, w: 400, h: 400 }, 1000);
  AX.addItem(doc, p2.id, { k: "line", sc: "#123456", sw: 6, x: 900, y: 900, w: -300, h: 100 }, 1000);
  const r = AO.build(doc, { ["a:" + IMG]: PNG });
  const plan = await X.read(require(path.join(ROOT, "atelier/zip.js")).open(r.bytes), { parseXml });
  assert.equal(plan.slides.length, 2);
  assert.equal(plan.as, "16:9");
  assert.equal(plan.slides[0].bg, "#112233");
  const b = X.build(plan, { [Object.keys(plan.media)[0]]: { id: IMG, w: 400, h: 200 } }, 5000, ids("z"));
  const it1 = b.items.filter((it) => it.s === b.slides[0].id);
  const text = it1.find((it) => it.k === "text");
  assert.deepEqual(j(text.paras.map((p) => C.paraText(p))), ["Γεια σου & <κόσμε>", "δεύτερη"]);
  assert.equal(text.ff, "serif");
  assert.equal(text.al, "c");
  assert.equal(text.fc, "#ff0000");
  assert.notEqual(text.fit, false);                            // Atelier's noAutofit: Slides still shrinks
  assert.equal(text.fs, Math.round(64 * 0.5 / 0.54));          // 1920 px wide → 960 pt; 64 px = 32 pt
  assert.ok(text.paras[0].r.every((r) => r.b));
  assert.deepEqual(j(it1.filter((it) => it.k === "shape").map((s) => [s.sh, s.fill])), [["rect", "#00ff00"], ["ellipse", "#0000ff"]]);
  const it2 = b.items.filter((it) => it.s === b.slides[1].id);
  assert.ok(it2.some((it) => it.k === "image" && it.img && it.img.a === IMG));
  const line = it2.find((it) => it.k === "line");
  assert.ok(line && line.flip === true && line.st === "#123456");
});

// ---------- a hand-made foreign file ----------
const NSA = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const RELS = (list) => '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  list.map(([id, type, target, ext]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"${ext ? ' TargetMode="External"' : ""}/>`).join("") + "</Relationships>";
const SP = (inner) => `<p:sp>${inner}</p:sp>`;
const XF = (x, y, w, h, extra) => `<a:xfrm${extra || ""}><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`;
function foreign(extraSlide) {
  const theme = `<a:theme ${NSA} name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Georgia"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;
  const master = `<p:sldMaster ${NSA}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:bgPr></p:bg><p:spTree>
    ${SP(`<p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr>${XF(838200, 365125, 10515600, 1325563)}</p:spPr>`)}
    ${SP(`<p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${XF(838200, 1825625, 10515600, 4351338)}</p:spPr>`)}
    ${SP(`<p:nvSpPr><p:cNvPr id="4" name="Logo bar"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${XF(0, 6400800, 12192000, 457200)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:spPr>`)}
    </p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
    <p:txStyles><p:titleStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>
    <p:bodyStyle><a:lvl1pPr marL="228600" indent="-228600"><a:buChar char="•"/><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr><a:lvl2pPr><a:buChar char="–"/><a:defRPr sz="2400"/></a:lvl2pPr></p:bodyStyle>
    <p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
  const layout = `<p:sldLayout ${NSA}><p:cSld name="Title and Content"><p:spTree>
    ${SP(`<p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>`)}
    ${SP(`<p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${XF(838200, 2000000, 10515600, 4000000)}</p:spPr>`)}
    </p:spTree></p:cSld></p:sldLayout>`;
  const slide = `<p:sld ${NSA}><p:cSld><p:spTree>
    ${SP(`<p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Quarterly &amp; review</a:t></a:r></a:p></p:txBody>`)}
    ${SP(`<p:nvSpPr><p:cNvPr id="3" name="Content 2"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr><a:normAutofit fontScale="50000"/></a:bodyPr><a:lstStyle/>
      <a:p><a:r><a:rPr lang="en-US" b="1"/><a:t>Revenue up</a:t></a:r><a:r><a:rPr lang="en-US"><a:solidFill><a:schemeClr val="accent2"><a:lumMod val="50000"/></a:schemeClr></a:solidFill></a:rPr><a:t> 12%</a:t></a:r></a:p>
      <a:p><a:pPr lvl="1"/><a:r><a:rPr lang="en-US" i="1"/><a:t>in Europe</a:t></a:r><a:br/><a:r><a:rPr lang="en-US"/><a:t>and Asia</a:t></a:r></a:p>
      <a:p><a:pPr><a:buNone/></a:pPr><a:r><a:rPr lang="en-US"/><a:t>No bullet</a:t></a:r></a:p></p:txBody>`)}
    <p:grpSp><p:nvGrpSpPr><p:cNvPr id="9" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/><a:chOff x="0" y="0"/><a:chExt cx="4000000" cy="2000000"/></a:xfrm></p:grpSpPr>
      ${SP(`<p:nvSpPr><p:cNvPr id="10" name="Oval"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${XF(0, 0, 2000000, 2000000)}<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr></a:solidFill><a:ln w="25400"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill><a:prstDash val="dash"/></a:ln></p:spPr>`)}
    </p:grpSp>
    <p:cxnSp><p:nvCxnSpPr><p:cNvPr id="11" name="L"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${XF(0, 3429000, 6858000, 0)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="12700"><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill></a:ln></p:spPr></p:cxnSp>
    <p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="12" name="Chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="6858000" y="3429000"/><a:ext cx="3429000" cy="1714500"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphic></p:graphicFrame>
    <p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="13" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="3429000" cy="1714500"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>A1</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>B1</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>
    <p:pic><p:nvPicPr><p:cNvPr id="14" name="Video"/><p:cNvPicPr/><p:nvPr><a:videoFile r:link="rId9"/></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="rId3"/></p:blipFill><p:spPr>${XF(100, 100, 1000, 1000)}</p:spPr></p:pic>
    <p:pic><p:nvPicPr><p:cNvPr id="15" name="Far" descr="from the web"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId4"/></p:blipFill><p:spPr>${XF(100, 100, 1000, 1000)}</p:spPr></p:pic>
    <p:pic><p:nvPicPr><p:cNvPr id="16" name="Photo" descr="A photo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId3"/><a:srcRect l="25000" r="25000"/></p:blipFill><p:spPr>${XF(6096000, 0, 3048000, 3429000)}<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom></p:spPr></p:pic>
    ${SP(`<p:nvSpPr><p:cNvPr id="17" name="Footer"/><p:cNvSpPr/><p:nvPr><p:ph type="sldNum" idx="12"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:fld type="slidenum"><a:t>1</a:t></a:fld></a:p></p:txBody>`)}
    </p:spTree></p:cSld><p:transition><p:wipe/></p:transition></p:sld>`;
  const files = [
    ["[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
    ["ppt/presentation.xml", `<p:presentation ${NSA}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/>${extraSlide ? '<p:sldId id="257" r:id="rId3"/>' : ""}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`],
    ["ppt/_rels/presentation.xml.rels", RELS([["rId1", "slideMaster", "slideMasters/slideMaster1.xml"], ["rId2", "slide", "slides/slide1.xml"], ["rId3", "slide", "slides/slide2.xml"]])],
    ["ppt/slideMasters/slideMaster1.xml", master],
    ["ppt/slideMasters/_rels/slideMaster1.xml.rels", RELS([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"], ["rId2", "theme", "../theme/theme1.xml"]])],
    ["ppt/slideLayouts/slideLayout1.xml", layout],
    ["ppt/slideLayouts/_rels/slideLayout1.xml.rels", RELS([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]])],
    ["ppt/theme/theme1.xml", theme],
    ["ppt/slides/slide1.xml", slide],
    ["ppt/slides/_rels/slide1.xml.rels", RELS([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"], ["rId2", "notesSlide", "../notesSlides/notesSlide1.xml"],
      ["rId3", "image", "../media/image1.png"], ["rId4", "image", "https://example.com/x.png", true]])],
    ["ppt/notesSlides/notesSlide1.xml", `<p:notes ${NSA}><p:cSld><p:spTree>${SP('<p:nvSpPr><p:cNvPr id="2" name="I"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/>')}${SP('<p:nvSpPr><p:cNvPr id="3" name="N"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>Say hello</a:t></a:r></a:p><a:p><a:r><a:t>then</a:t></a:r><a:br/><a:r><a:t>go</a:t></a:r></a:p></p:txBody>')}</p:spTree></p:cSld></p:notes>`],
    ["ppt/media/image1.png", PNG]
  ];
  if (extraSlide) {
    files.push(["ppt/slides/slide2.xml", extraSlide]);
    files.push(["ppt/slides/_rels/slide2.xml.rels", RELS([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"]])]);
  }
  return Z.write(files.map(([name, data]) => ({ name, data })));
}

test("pptx: a foreign file: inherited positions and styles, groups, lines, notes, unknown things as notes", async () => {
  const plan = await X.read(Z.open(foreign()), { parseXml, labels: { chart: "Γράφημα", table: "Πίνακας" } });
  assert.equal(plan.slides.length, 1);
  assert.equal(plan.th, "light");
  assert.deepEqual(Object.keys(plan.media), ["ppt/media/image1.png"]);        // the external picture is never read
  const S = plan.slides[0];
  assert.equal(S.ly, "content");
  assert.equal(S.tr, "wipe");
  assert.equal(S.n, "Say hello\nthen\ngo");
  assert.equal(S.bg, "#ffffff");
  const b = X.build(plan, { "ppt/media/image1.png": { id: IMG, w: 400, h: 300 } }, 5000, ids("f"));
  const items = b.items.filter((it) => it.s === b.slides[0].id).sort((x, y) => x.z - y.z);
  const k = 1000 / 6858000;
  // master decoration first, locked
  const bar = items[0];
  assert.equal(bar.k, "shape"); assert.equal(bar.fill, "#4472c4"); assert.equal(bar.lk, true);
  // title: position from the master (the layout has none), style from titleStyle
  const title = items.find((it) => it.ph === "title");
  assert.equal(title.x, Math.round(838200 * k)); assert.equal(title.y, Math.round(365125 * k));
  assert.equal(C.itemText(title), "Quarterly & review");
  assert.equal(title.al, "c"); assert.equal(title.fc, "#44546a"); assert.equal(title.fs, Math.round(44 / 0.54));
  assert.equal(title.ff, "sans");                                             // Calibri Light
  // body: position from the layout, bullets from bodyStyle, autofit scale, a line break splits
  const body = items.find((it) => it.ph === "body");
  assert.equal(body.y, Math.round(2000000 * k));
  assert.equal(body.fs, Math.round(28 * 0.5 / 0.54));
  assert.equal(body.ff, "serif");                                             // the theme's minor font, Georgia
  assert.deepEqual(j(body.paras.map((p) => [p.l, p.ls, C.paraText(p)])),
    [[0, "b", "Revenue up 12%"], [1, "b", "in Europe"], [1, "", "and Asia"], [0, "", "No bullet"]]);
  assert.equal(body.paras[0].r[0].b, true);
  assert.match(body.paras[0].r[1].c, /^#[0-9a-f]{6}$/);                       // lumMod applied: a fixed colour
  assert.notEqual(body.paras[0].r[1].c, "#ed7d31");
  assert.equal(body.paras[1].r[0].i, true);
  // the grouped ellipse: scaled by the group, transparency, dashed outline
  const oval = items.find((it) => it.k === "shape" && it.sh === "ellipse");
  assert.equal(oval.x, Math.round(1000000 * k)); assert.equal(oval.w, Math.round(1000000 * k));
  assert.equal(oval.op, 50); assert.equal(oval.st, "#00ff00"); assert.equal(oval.dash, true);
  // a horizontal line
  const line = items.find((it) => it.k === "line");
  assert.equal(line.h, 2); assert.equal(line.st, "#0000ff");
  // chart and video as dashed notes; the table is a table (wave 24)
  const notes = items.filter((it) => it.k === "text" && it.dash && it.st === "#9ca3af");
  assert.deepEqual(j(notes.map((n) => C.paraText(n.paras[0]))).sort(), ["Video or sound (not imported)", "Γράφημα"].sort());
  const table = items.find((it) => it.k === "table");
  assert.deepEqual(j(table.tb.rows), [["A1", "B1"]]);
  assert.equal(table.tb.hd, undefined);
  // the photo: cropped to its middle half, round mask, description
  const photo = items.find((it) => it.k === "image");
  assert.equal(photo.img.alt, "A photo");
  assert.equal(photo.rad, Math.round(3048000 * k / 2));                    // ellipse mask → round corners
  assert.equal(photo.img.ox, 0);
  // no slide number placeholder (Slides has its own footer), no external picture
  assert.ok(!items.some((it) => it.k === "text" && C.itemText(it) === "1"));
  assert.equal(plan.count.unknown, 2);
});

test("pptx: refuses DTDs, keeps going past a broken slide, rejects what is not a presentation", async () => {
  const evil = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><p:sld ${NSA}><p:cSld><p:spTree/></p:cSld></p:sld>`;
  await assert.rejects(X.read(Z.open(foreign(evil)), { parseXml }), /xml/);
  const broken = `<p:sld ${NSA}><p:cSld><p:spTree>${SP("<p:nvSpPr><p:cNvPr id='2' name='x'/></p:nvSpPr>")}</p:spTree></p:cSld></p:sld>`;
  const plan = await X.read(Z.open(foreign(broken)), { parseXml });
  assert.equal(plan.slides.length, 2);
  assert.ok(plan.count.skipped >= 1);
  await assert.rejects(X.read(Z.open(Z.write([{ name: "word/document.xml", data: "<w/>" }])), { parseXml }), /pptx/);
  assert.equal(X.isZip(Uint8Array.from([0x50, 0x4b, 3, 4, 0])), true);
  assert.equal(X.isZip(new TextEncoder().encode("{\"kind\":1}")), false);
});
