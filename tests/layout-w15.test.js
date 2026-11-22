// Layout W15 (LY-W15): InDesign (.idml) and Scribus (.sla) export and
// the package for print. Written files are read back by Layout's own
// readers (layout/idml.js, layout/sla.js): pages, masters, styles,
// colours, frames, threads, shapes, paths, pictures, tables; every XML
// part is well formed; picture names, faces and the report; wiring
// and strings in EN/EL/DE. Synthetic documents only.
// Run: node --test tests/layout-w15.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const M = require(path.join(ROOT, "designkit/model.js"));
const XO = require(path.join(ROOT, "layout/xout.js"));
const IDML = require(path.join(ROOT, "layout/idml.js"));
const SLA = require(path.join(ROOT, "layout/sla.js"));
const IMG = "a".repeat(64) + ".jpg";

function doc() {
  const d = M.newDoc({ name: "Βυθός", w: 396.85, h: 595.28, pages: 3, facing: 1, bleed: 8.5 }, 1);
  const o = M.pagesInOrder(d);
  d.swatches.push({ id: "sw-sea", m: 1, name: "Θάλασσα & ουρανός", mode: "cmyk", v: [100, 20, 0, 10] });
  d.pstyles.push({ id: "ps-ttl", m: 1, name: "Τίτλος <1>", base: "ps-base", size: 24, b: 1, align: "c", color: "sw-sea" });
  d.cstyles.push({ id: "cs-xem", m: 1, name: "Έμφαση", i: 1 });
  d.stories.push({ id: "st-a", m: 1, paras: [
    { ps: "ps-ttl", runs: [{ t: "Κεφάλαιο \"1\"" }] },
    { ps: "ps-base", runs: [{ t: "Κείμενο " }, { t: "έντονο", b: 1 }, { t: " και " }, { t: "πλάγιο", cs: "cs-xem" }, { t: "\tμετά\nγραμμή" }] },
    { ps: "ps-base", runs: [], ext: { tbl: { cols: [2, 1], hdr: 1, pad: 4, bw: 0.5, rows: [{ c: [{ t: "Α" }, { t: "Β" }] }, { c: [{ t: "1\n2", s: 2 }, { x: 1 }] }] } } },
    { ps: "ps-base", runs: [{ t: "Τέλος" }] }] });
  d.items.push({ id: "it-t1", m: 1, t: "text", pg: o[0].id, x: 40, y: 40, w: 300, h: 200, story: "st-a", seq: 1024, cols: 2, gut: 12, ins: 4, va: "c", z: 1 });
  d.items.push({ id: "it-t2", m: 1, t: "text", pg: o[1].id, x: 40, y: 40, w: 300, h: 200, story: "st-a", seq: 2048, z: 1 });
  d.items.push({ id: "it-r", m: 1, t: "rect", pg: o[1].id, x: 50, y: 300, w: 100, h: 60, fill: "sw-sea", rot: 15, r: 6, op: 70, z: 2, ext: { fx: { sh: { x: 3, y: 3, b: 4, o: 50 }, bm: "multiply" } } });
  d.items.push({ id: "it-e", m: 1, t: "ell", pg: o[2].id, x: 60, y: 60, w: 80, h: 40, fill: "sw-black", z: 2 });
  d.items.push({ id: "it-l", m: 1, t: "line", pg: o[2].id, x: 10, y: 500, w: 200, h: -20, stroke: "sw-sea", sw: 2, z: 3 });
  d.items.push({ id: "it-p", m: 1, t: "path", pg: o[2].id, x: 200, y: 200, w: 100, h: 100, d: "M0 0L1 0L1 1L0 1Z", fill: "sw-sea", z: 4 });
  d.items.push({ id: "it-i", m: 1, t: "img", pg: o[0].id, x: 40, y: 300, w: 200, h: 150, a: IMG, nm: "C:\\pics\\θάλασσα.JPEG", iw: 1000, ih: 500, fit: "fill", z: 5 });
  d.items.push({ id: "it-g1", m: 1, t: "rect", pg: o[2].id, x: 10, y: 10, w: 20, h: 20, grp: "gr-a", z: 6 });
  d.items.push({ id: "it-g2", m: 1, t: "rect", pg: o[2].id, x: 40, y: 10, w: 20, h: 20, grp: "gr-a", z: 7, hide: 1 });
  d.stories.push({ id: "st-f", m: 1, paras: [{ ps: "ps-base", runs: [{ f: "pn" }] }] });
  d.items.push({ id: "it-mf", m: 1, t: "text", pg: d.masters[0].id, side: "R", x: 300, y: 560, w: 40, h: 20, story: "st-f", seq: 1, z: 1 });
  return M.normDoc(d);
}
// a strict enough check that a string is well-formed XML: balanced
// tags, quoted attributes, no bare & or <
function wellFormed(x) {
  const s = x.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "").replace(/<\?[\s\S]*?\?>/g, "");
  const stack = [], re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|<|&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g;
  let m;
  while ((m = re.exec(s))) {
    if (!m[2]) throw new Error("bare < or & at " + m.index + ": " + s.slice(m.index, m.index + 40));
    if (m[4]) continue;
    if (m[1]) { const top = stack.pop(); if (top !== m[2]) throw new Error("</" + m[2] + "> closes <" + top + ">"); }
    else stack.push(m[2]);
  }
  if (stack.length) throw new Error("unclosed " + stack.join(","));
}

test("IDML: every part well formed; read back with pages, masters, styles, colours, frames and threads", () => {
  const d = doc();
  const r = XO.idml(d, { name: "Βυθός", images: { [IMG]: { b64: "/9j/4AAQ", name: "θάλασσα.jpg" } } });
  assert.equal(r.files[0].name, "mimetype");
  assert.equal(r.files[0].data, "application/vnd.adobe.indesign-idml-package");
  const files = {};
  r.files.forEach((f) => { if (/\.xml$/.test(f.name)) { wellFormed(f.data); files[f.name] = f.data; } });
  const b = IDML.convert(files, { now: 2 });
  assert.ok(b && b.doc);
  const bd = b.doc;
  assert.equal(bd.pages.length, 3);
  assert.equal(bd.setup.facing, 1);
  assert.ok(Math.abs(bd.setup.w - 396.85) < 0.01 && Math.abs(bd.setup.h - 595.28) < 0.01);
  assert.equal(bd.setup.bleed, 8.5);
  assert.equal(bd.masters.length, 1);
  assert.ok(M.pagesInOrder(bd).every((p) => p.ms === bd.masters[0].id), "pages keep their master");
  assert.ok(bd.swatches.some((s) => s.name === "Θάλασσα & ουρανός" && s.mode === "cmyk" && s.v.join() === "100,20,0,10"));
  const ttl = bd.pstyles.find((s) => s.name === "Τίτλος <1>");
  assert.ok(ttl && ttl.size === 24 && ttl.b === 1 && ttl.align === "c");
  // the thread: two frames, one story
  const tf = bd.items.filter((i) => i.t === "text" && i.pg !== bd.masters[0].id);
  assert.equal(tf.length, 2);
  assert.equal(tf[0].story, tf[1].story);
  const tf1 = tf.find((i) => i.cols === 2);
  assert.ok(tf1 && tf1.gut === 12 && tf1.ins === 4 && tf1.va === "c");
  const st = M.find(bd.stories, tf[0].story);
  assert.equal(st.paras[0].runs[0].t, "Κεφάλαιο \"1\"");
  assert.equal(M.find(bd.pstyles, st.paras[0].ps).name, "Τίτλος <1>");
  const p1 = st.paras[1].runs;
  assert.deepEqual(p1.map((x) => x.t), ["Κείμενο ", "έντονο", " και ", "πλάγιο", "\tμετά\nγραμμή"]);
  assert.equal(p1[1].b, 1);
  assert.ok(p1[3].i === 1 && M.find(bd.cstyles, p1[3].cs).name === "Έμφαση");
  assert.deepEqual(st.paras[2].runs.map((x) => x.t), ["Α\tΒ"], "the table: a row per paragraph to this reader");
  assert.equal(st.paras[st.paras.length - 1].runs[0].t, "Τέλος");
  // the master's page number
  const mf = bd.items.find((i) => i.pg === bd.masters[0].id);
  assert.equal(M.find(bd.stories, mf.story).paras[0].runs[0].f, "pn");
  // shapes
  const rc = bd.items.find((i) => i.t === "rect" && i.r > 0);
  assert.ok(Math.abs(rc.x - 50) < 0.01 && Math.abs(rc.w - 100) < 0.01 && Math.abs(rc.rot - 15) < 0.01 && rc.op === 70 && rc.r === 6);
  const el = bd.items.find((i) => i.t === "ell");
  assert.ok(Math.abs(el.x - 60) < 0.01 && Math.abs(el.h - 40) < 0.01);
  const ln = bd.items.find((i) => i.t === "line");
  assert.ok(Math.abs(ln.w - 200) < 0.01 && Math.abs(ln.h + 20) < 0.01 && ln.sw === 2);
  const pa = bd.items.find((i) => i.t === "path");
  assert.ok(pa && Math.abs(pa.w - 100) < 0.01);
  // the group, the hidden object
  const g = bd.items.filter((i) => i.t === "rect" && i.w === 20);
  assert.ok(g.length === 2 && g[0].grp && g[0].grp === g[1].grp && g.some((i) => i.hide));
  // the picture, embedded, by its name
  assert.equal(b.images.length, 1);
  assert.equal(bd.items.find((i) => i.t === "img").nm, "θάλασσα.jpg");
  // effects as InDesign's own
  const spread = r.files.find((f) => f.name.startsWith("Spreads/") && f.data.includes("DropShadowSetting")).data;
  assert.ok(/BlendMode="Multiply"/.test(spread) && /Opacity="70"/.test(spread));
  // a real table
  const story = r.files.find((f) => f.name.startsWith("Stories/") && f.data.includes("<Table")).data;
  assert.ok(/HeaderRowCount="1"/.test(story) && /ColumnSpan="2"/.test(story) && !/Name="1:1"/.test(story), "a merged cell covers the other");
});

test("IDML linked: pictures by file name in Links, no bytes inside", () => {
  const d = doc();
  const r = XO.idml(d, { links: "Links/", images: { [IMG]: { name: "θάλασσα.jpg" } } });
  const files = {};
  r.files.forEach((f) => { files[f.name] = f.data; });
  const all = Object.values(files).join("");
  assert.ok(all.includes('LinkResourceURI="file:Links/' + encodeURIComponent("θάλασσα.jpg") + '"'));
  assert.ok(!all.includes("<Contents>"));
  const b = IDML.convert(files, { now: 2 });
  assert.equal(b.linked, 1);
  assert.equal(b.links[0].name, "θάλασσα.jpg");
});

test("Scribus: well formed; read back with pages, masters, styles, frames, threads and pictures", () => {
  const d = doc();
  const r = XO.sla(d, { name: "Βυθός", images: { [IMG]: { name: "θάλασσα.jpg" } }, links: "Links/" });
  wellFormed(r.xml);
  const b = SLA.convert(r.xml, { now: 2 });
  assert.ok(b && b.doc);
  const bd = b.doc;
  assert.equal(bd.pages.length, 3);
  assert.equal(bd.setup.facing, 1);
  assert.equal(bd.setup.bleed, 8.5);
  assert.equal(bd.masters.length, 2, "Scribus keeps left and right master pages");
  assert.ok(M.pagesInOrder(bd).every((p) => p.ms), "pages keep a master");
  assert.ok(bd.swatches.some((s) => s.name === "Θάλασσα & ουρανός" && s.v.join() === "100,20,0,10"));
  const tf = bd.items.filter((i) => i.t === "text" && M.find(bd.pages, i.pg));
  assert.equal(tf.length, 2);
  assert.equal(tf[0].story, tf[1].story);
  const st = M.find(bd.stories, tf[0].story);
  assert.equal(st.paras[0].runs[0].t, "Κεφάλαιο \"1\"");
  const ttl = M.find(bd.pstyles, st.paras[0].ps);
  assert.ok(ttl && (ttl.name === "Τίτλος <1>" || M.find(bd.pstyles, ttl.base).name === "Τίτλος <1>"));
  assert.deepEqual(st.paras[1].runs.map((x) => x.t), ["Κείμενο ", "έντονο", " και ", "πλάγιο", "\tμετά\nγραμμή"]);
  assert.equal(st.paras[1].runs[1].b, 1);
  assert.equal(st.paras[1].runs[3].i, 1);
  assert.deepEqual(st.paras[2].runs.map((x) => x.t), ["Α\tΒ"]);
  const rc = bd.items.find((i) => i.t === "rect" && i.r > 0);
  assert.ok(Math.abs(rc.x - 50) < 0.01 && Math.abs(rc.y - 300) < 0.01 && Math.abs(rc.rot - 15) < 0.01 && rc.op === 70);
  assert.ok(/TransBlend="3"/.test(r.xml), "multiply");
  const ln = bd.items.find((i) => i.t === "line");
  assert.ok(Math.abs(ln.w - 200) < 0.01 && Math.abs(ln.h + 20) < 0.01);
  assert.ok(bd.items.some((i) => i.t === "ell" && Math.abs(i.w - 80) < 0.01));
  assert.ok(bd.items.some((i) => i.t === "path"));
  const im = bd.items.find((i) => i.t === "img");
  assert.equal(im.nm, "θάλασσα.jpg");
  assert.equal(b.links[0].name, "θάλασσα.jpg");
  assert.ok(r.xml.includes('PFILE="Links/θάλασσα.jpg"'));
  const mf = bd.items.find((i) => bd.masters.some((m) => m.id === i.pg));
  assert.equal(M.find(bd.stories, mf.story).paras[0].runs[0].f, "pn");
});

test("package: picture names, faces used, the report", () => {
  const d = doc();
  d.items.push({ id: "it-i2", m: 1, t: "img", pg: d.items[0].pg, x: 0, y: 0, w: 10, h: 10, a: "b".repeat(64) + ".png", nm: "θάλασσα.png", iw: 10, ih: 10, z: 9 });
  d.items.push({ id: "it-i3", m: 1, t: "img", pg: d.items[0].pg, x: 0, y: 0, w: 10, h: 10, a: "c".repeat(64) + ".jpg", nm: "θάλασσα.jpg", iw: 10, ih: 10, z: 10 });
  const n = XO.linkNames(M.normDoc(d));
  assert.equal(n[IMG], "θάλασσα.jpg", "no folders, the type's extension");
  assert.equal(n["b".repeat(64) + ".png"], "θάλασσα.png");
  assert.equal(n["c".repeat(64) + ".jpg"], "θάλασσα (2).jpg");
  const faces = XO.facesUsed(d);
  assert.ok(faces.some((f) => f.font === "serif" && f.b && !f.i), JSON.stringify(faces));
  assert.ok(faces.some((f) => f.i), "italic from the character style");
  assert.ok(faces.every((f) => f.key && /^(sans|serif|mono)-/.test(f.key)));
  const tr = (k, v) => k + (v ? JSON.stringify(v) : "");
  const rep = XO.report(d, tr, { date: "2026-11-22", pf: [{ pg: d.items[0].pg, code: "ppi", text: "low" }], links: n, faces: faces, pdf: "x.pdf", lang: "el" });
  assert.ok(rep.includes('xo.r.pages{"n":3,"w":140,"h":210}'), rep.slice(0, 300));
  assert.ok(rep.includes('xo.r.bleed{"t":3,"b":3,"i":3,"o":3}'));
  assert.ok(rep.includes("Θάλασσα & ουρανός  CMYK 100 20 0 10"));
  assert.ok(rep.includes("Noto Serif: "));
  assert.ok(rep.includes("θάλασσα.jpg  xo.r.page{\"n\":1}  "));
  assert.ok(rep.includes('xo.r.pf{"n":1}') && rep.includes("  low"));
  assert.ok(/\r\n$/.test(rep));
});

test("wiring: Export dialog, lazy script, strings and help in EN/EL/DE", () => {
  const pn = read("layout/panels.js");
  assert.ok(/LY\.io\.script\("xout\.js", "LY_XOUT"\)/.test(pn));
  ["exportPackage", "exportIdml", "exportSla"].forEach((f) => assert.ok(pn.includes('xo("' + f + '")'), f));
  assert.ok(read("sw.js").includes('"layout/xout.js"'));
  assert.ok(!read("layout/index.html").includes("xout.js"), "loaded on first use, not at start");
  const io = read("layout/io.js");
  assert.ok(/function bundleBytes\(doc\)/.test(io) && /bundleBytes: bundleBytes/.test(io));
  assert.ok(/return chain\.then\(function \(\) \{ return thumbOf\(doc\); \}\)/.test(io), "bundleBytes gives the bytes back (Package and the print package)");
  const src = read("layout/xout.js") + pn, lay = read("layout/layout.js"), de = read("i18n/de/layout.js");
  const keys = Array.from(new Set(src.match(/"xo\.[a-zA-Z.]+"/g).map((m) => m.slice(1, -1))));
  assert.ok(keys.length >= 25, String(keys.length));
  keys.forEach((k) => {
    assert.equal((lay.match(new RegExp('"' + k.replace(/\./g, "\\.") + '": "', "g")) || []).length, 2, k + " EN + EL");
    assert.ok(de.includes('"' + k + '": "'), k + " DE");
  });
  assert.ok(read("layout/help.en.txt").includes("## Package for print, InDesign and Scribus\n"));
  assert.ok(read("layout/help.el.txt").includes("## Πακέτο για το τυπογραφείο, InDesign και Scribus\n"));
  assert.ok(read("i18n/de/help/layout.txt").includes("## Paket für die Druckerei, InDesign und Scribus\n"));
});
