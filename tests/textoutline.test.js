// Vector tools, wave V5: text to outlines. designkit/fonts.js 1.6.0
// (TrueType glyph outlines), Atelier AX.textOutlines / outlineText /
// shapeToPath, the automation steps and Assistant commands, Layout
// outlineLines.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const V = require(path.join(ROOT, "designkit/vector.js"));
const F = require(path.join(ROOT, "designkit/fonts.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const AX = require(path.join(ROOT, "atelier/ax.js"));
const RS = require(path.join(ROOT, "atelier/recipesteps.js"));
const CM = require(path.join(ROOT, "atelier/commands.js"));

T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

function partOf(key, ch) {
  const cp = ch.codePointAt(0);
  const p = T.faceParts(key).find((x) => x.map[cp] !== undefined);
  return { ol: F.outliner(p.bytes().buffer), gid: p.map[cp] };
}
// signed area of each closed contour (font units, y up), cubic ends only
function areas(cmds) {
  const out = [];
  let pts = [];
  cmds.forEach((c) => {
    if (c[0] === "M") pts = [[c[1], c[2]]];
    else if (c[0] === "Z") {
      let a = 0;
      for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
      out.push(a / 2);
    } else pts.push([c[c.length - 2], c[c.length - 1]]);
  });
  return out;
}
function box(cmds) {
  const b = V.bounds(V.fromCmds(cmds));
  return [b.x, b.y, b.x + b.w, b.y + b.h];
}

test("outliner reads TrueType glyphs: contours, holes wound the other way, composites", () => {
  const o = partOf("serif-r", "o");
  assert.ok(o.ol && o.ol.upm > 0);
  const a = areas(o.ol.glyph(o.gid));
  assert.equal(a.length, 2, "o: outside and hole");
  assert.ok(Math.sign(a[0]) !== Math.sign(a[1]), "the hole turns the other way");
  const e = partOf("sans-b", "é");
  assert.ok(areas(e.ol.glyph(e.gid)).length >= 3, "é: the letter and its accent (a composite glyph)");
  const H = partOf("sans-r", "H"), hb = box(H.ol.glyph(H.gid));
  const cap = T.metrics("sans-r").cap;
  assert.ok(Math.abs(hb[3] - cap) <= 2 && Math.abs(hb[1]) <= 2, "H stands on the baseline, cap high: " + hb);
  assert.deepEqual(H.ol.glyph(99999), []);
  assert.equal(F.outliner(new ArrayBuffer(0)), null);
  // a file without glyf (PostScript outlines) has no outliner
  const fake = new DataView(new ArrayBuffer(12 + 16));
  fake.setUint16(4, 1);
  [0x43, 0x46, 0x46, 0x20].forEach((c, i) => fake.setUint8(12 + i, c));
  assert.equal(F.outliner(fake.buffer), null);
});

test("outlineGlyphs places glyphs at size, baseline and turn; spaces draw nothing", () => {
  const g = [{ key: "sans-r", ch: "H", size: 100, x: 10, y: 200, rot: 0 }, { key: "sans-r", ch: " ", size: 100, x: 80, y: 200, rot: 0 }];
  const r = F.outlineGlyphs(g);
  assert.equal(r.missing, 0);
  const b = box(r.cmds), cap = T.metrics("sans-r").cap / T.metrics("sans-r").upm * 100;
  assert.ok(Math.abs(b[3] - 200) < 0.5 && Math.abs(b[1] - (200 - cap)) < 0.5 && b[0] > 10 && b[2] < 10 + T.measure("sans-r", "H", 100, 0), String(b));
  const turned = F.outlineGlyphs([{ key: "sans-r", ch: "H", size: 100, x: 0, y: 0, rot: Math.PI / 2 }]);
  const tb = box(turned.cmds);
  assert.ok(tb[0] > 0 && tb[2] <= cap + 0.5, "a quarter turn puts the letter to the right of its baseline point: " + tb);
});

function design(spec) {
  const d = AX.newDesign({ name: "OL", w: 1000, h: 1000 }, 1);
  const pg = d.pages[0].id;
  const it = AX.addItem(d, pg, Object.assign({ k: "text", tx: "Hello", size: 60, x: 100, y: 100, w: 600, fc: "#123456" }, spec), 1);
  return { d, it, pg };
}

test("Atelier: a text becomes shapes in its place, colour, turn and link kept, one record per piece", () => {
  const { d, it } = design({ tx: "Logo", rot: 15, op: 80, ext: { lnk: "https://example.com" } });
  const res = AX.textOutlines(it);
  assert.equal(res.lines.length, 1);
  const r = AX.outlineText(d, it, 5);
  assert.equal(r.ids.length, 1, "a short word fits one shape");
  assert.equal(d.items.find((x) => x.id === it.id), undefined);
  assert.equal(d.tombs[it.id], 5);
  const sh = d.items.find((x) => x.id === r.ids[0]);
  assert.deepEqual([sh.ax.k, sh.ax.fc, sh.rot, sh.op, sh.ext.lnk], ["shape", "#123456", 15, 80, "https://example.com"]);
  assert.ok(AX.pthOf(sh).length > 20);
  const n = M.normDoc(JSON.parse(JSON.stringify(d)));
  assert.ok(n.items.find((x) => x.id === sh.id).ext.pth, "the outline survives the record");
  // inside the text's box (unturned frame): the shape's centre near the glyphs' middle
  assert.ok(sh.w < 600 && sh.h < 100);
});

test("Atelier: big text splits by line, then word, then letter; underline and curved text come too", () => {
  const { d, it } = design({ tx: "Γλαρόλυκοι Γλαρόλυκοι\nsecond", size: 160, w: 900, b: 1, font: "serif" });
  const r = AX.outlineText(d, it, 2);
  assert.ok(r.ids.length > 2 && r.lost === 0, JSON.stringify(r));
  r.ids.forEach((id) => assert.ok(JSON.stringify(d.items.find((x) => x.id === id).ext).length <= 8192));
  const u = design({ tx: "under", u: 1 });
  const ru = AX.textOutlines(u.it);
  assert.equal(ru.lines[0].length, 2, "the word and its underline");
  const c = design({ tx: "ROUND", cv: 60 });
  const rc = AX.textOutlines(c.it);
  assert.equal(rc.lines[0][0].length, 5);
  assert.equal(AX.textOutlines({ ax: { k: "shape" } }), null);
});

test("Atelier: a library shape takes its outline as its own; the same points", () => {
  const { d, pg } = design({});
  const st = AX.addItem(d, pg, { k: "shape", shp: "star", x: 10, y: 20, w: 200, h: 180, fc: "#ff0000" }, 1);
  const before = AX.shapeCmds(st);
  assert.equal(AX.shapeToPath(st), true);
  assert.ok(st.ext.pth);
  const after = AX.shapeCmds(st);
  assert.equal(after.length, before.length);
  after.forEach((c, i) => c.slice(1).forEach((v, k) => assert.ok(Math.abs(v - before[i][k + 1]) < 0.05)));
  assert.equal(AX.shapeToPath(st), false, "once only");
});

test("automation steps and Assistant commands: outlines and topath, the second run changes nothing", () => {
  const { d, pg } = design({ tx: "One", font: "serif" });
  AX.addItem(d, pg, { k: "text", tx: "Two", size: 40, x: 100, y: 400, w: 400, font: "sans" }, 1);
  AX.addItem(d, pg, { k: "shape", shp: "heart", x: 10, y: 600, w: 100, h: 100, fc: "#ff0000" }, 1);
  assert.ok(RS.ORDER.includes("outlines") && RS.ORDER.includes("topath"));
  assert.equal(RS.apply(d, { op: "outlines", from: "serif" }, { now: 3 }), 1);
  assert.equal(d.items.filter((x) => x.ax.k === "text").length, 1, "only the serif text");
  assert.equal(RS.apply(d, { op: "topath" }, { now: 3 }), 1, "the heart (the letter shapes have their own outline)");
  assert.equal(RS.apply(d, { op: "topath" }, { now: 4 }), 0);
  // commands: the preview counts, Atelier's env does the work
  const copy = JSON.parse(JSON.stringify(d));
  assert.equal(CM.apply(copy, { op: "outlines", ids: "", pages: "", what: "", has: "" }, {}), 1, "preview: one text left");
  assert.equal(copy.items.filter((x) => x.ax.k === "text").length, 1, "the preview changes nothing");
  const env = { now: 9, textOutline: (doc, it, nw) => { const r = AX.outlineText(doc, it, nw); return !!(r && r.ids.length); }, toPath: (doc, it) => AX.shapeToPath(it) };
  assert.equal(CM.apply(d, { op: "outlines", ids: "", pages: "", what: "", has: "" }, env), 1);
  assert.equal(d.items.filter((x) => x.ax.k === "text").length, 0);
  assert.ok(/outlines:/.test(CM.GUIDE) && /topath:/.test(CM.GUIDE));
});

test("Layout: laid-out lines by line and colour, through outlineLines", () => {
  const d = M.newDoc({ name: "OL", w: 400, h: 400, pages: 1 }, 1000);
  const pg = M.pagesInOrder(d)[0].id;
  d.stories.push({ id: "st-o", m: 1000, paras: [{ ps: "ps-body", runs: [{ t: "Outlines from Layout" }] }] });
  d.items.push({ id: "it-o", m: 1000, t: "text", pg, x: 20, y: 20, w: 300, h: 80, story: "st-o", seq: 1, z: 1 });
  const n = M.normDoc(d), L = R.computeLayout(n);
  const res = F.outlineLines(L.frames["it-o"].lines);
  assert.equal(res.missing, 0);
  assert.equal(res.parts.length, 1);
  const b = box(res.parts[0].cmds);
  assert.ok(b[0] >= 0 && b[2] <= 300 && b[1] >= 0 && b[3] < 80, String(b));
});

test("strings in EN, EL and DE; both apps offer it", () => {
  const PE = require(path.join(ROOT, "designkit/pathedit.js"));
  ["pe.toOutlines", "pe.olHint", "pe.olMissing", "pe.olNone"].forEach((k) => assert.ok(PE.STR.en[k] && PE.STR.el[k], k));
  const de = fs.readFileSync(path.join(ROOT, "i18n/de/designkit.js"), "utf8");
  ["pe.toOutlines", "pe.olHint", "pe.olMissing", "pe.olNone"].forEach((k) => assert.ok(de.includes('"' + k + '"'), "DE " + k));
  const dea = fs.readFileSync(path.join(ROOT, "i18n/de/atelier.js"), "utf8");
  ["rc.op.outlines", "rc.op.topath", "rc.olFont", "rc.olHint", "rc.tpHint"].forEach((k) => assert.ok(dea.includes('"' + k + '"'), "DE " + k));
  assert.match(fs.readFileSync(path.join(ROOT, "atelier/vector.js"), "utf8"), /VEC\.textOutline = textOutline/);
  assert.match(fs.readFileSync(path.join(ROOT, "layout/vector.js"), "utf8"), /VEC\.textOutline = textOutline/);
  assert.match(fs.readFileSync(path.join(ROOT, "atelier/assist.js"), "utf8"), /textOutline: function/);
});
