// Layout: free shapes, gradients, layers and .sla.gz from Scribus
// (layout/sla.js 1.1) and the model / PDF side of path items and
// gradient fills (designkit model, render, pdf).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "designkit/model.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const P = require(path.join(ROOT, "designkit/pdf.js"));
const S = require(path.join(ROOT, "layout/sla.js"));

const SLA = `<?xml version="1.0" encoding="UTF-8"?>
<SCRIBUSUTF8NEW Version="1.6.1">
<DOCUMENT ANZPAGES="1" PAGEWIDTH="400" PAGEHEIGHT="400" UNITS="0">
  <COLOR NAME="Black" SPACE="CMYK" C="0" M="0" Y="0" K="100"/>
  <COLOR NAME="Red" SPACE="RGB" R="230" G="20" B="20"/>
  <COLOR NAME="Blue" SPACE="RGB" R="20" G="40" B="230"/>
  <Gradient Name="Sunset"><CSTOP RAMP="0" NAME="Red" SHADE="100" TRANS="1"/><CSTOP RAMP="1" NAME="Blue" SHADE="100" TRANS="0.5"/></Gradient>
  <LAYERS NUMMER="0" LEVEL="0" NAME="Background" SICHTBAR="1" DRUCKEN="1" EDIT="1"/>
  <LAYERS NUMMER="1" LEVEL="2" NAME="Top" SICHTBAR="1" DRUCKEN="1" EDIT="0"/>
  <LAYERS NUMMER="2" LEVEL="1" NAME="Notes" SICHTBAR="0" DRUCKEN="1" EDIT="1"/>
  <PAGE PAGEXPOS="100" PAGEYPOS="20" PAGEWIDTH="400" PAGEHEIGHT="400" NUM="0" MNAM="Normal"/>
  <PAGEOBJECT XPOS="110" YPOS="30" WIDTH="100" HEIGHT="50" PTYPE="6" FRTYPE="3" OwnPage="0" PCOLOR="Red" PCOLOR2="Black" PWIDTH="1" LAYER="1" fillRule="0" ItemID="1" path="M0 0 L100 0 L50 50 Z m10 5 h20 v10 h-20 z"/>
  <PAGEOBJECT XPOS="110" YPOS="100" WIDTH="80" HEIGHT="40" PTYPE="7" OwnPage="0" PCOLOR="None" PCOLOR2="Blue" PWIDTH="2" LAYER="0" ItemID="2" path="M0 40 Q40 -40 80 40"/>
  <PAGEOBJECT XPOS="210" YPOS="100" WIDTH="60" HEIGHT="60" PTYPE="13" OwnPage="0" PCOLOR="Blue" PCOLOR2="None" LAYER="2" ItemID="3" path="M30 0 L60 60 L0 60 Z"/>
  <PAGEOBJECT XPOS="110" YPOS="200" WIDTH="200" HEIGHT="100" PTYPE="6" FRTYPE="0" OwnPage="0" PCOLOR="Red" PCOLOR2="None" GRTYP="6" GRSTARTX="0" GRSTARTY="50" GRENDX="200" GRENDY="50" ItemID="4">
    <CSTOP RAMP="0" NAME="Red" SHADE="100" TRANS="1"/><CSTOP RAMP="0.5" NAME="None" SHADE="100" TRANS="1"/><CSTOP RAMP="1" NAME="Blue" SHADE="50" TRANS="1"/>
  </PAGEOBJECT>
  <PAGEOBJECT XPOS="330" YPOS="200" WIDTH="100" HEIGHT="100" PTYPE="6" FRTYPE="1" OwnPage="0" PCOLOR="None" PCOLOR2="None" GRTYP="7" GRSTARTX="50" GRSTARTY="50" GRENDX="100" GRENDY="50" GRNAME="Sunset" ItemID="5"/>
  <PAGEOBJECT XPOS="110" YPOS="320" WIDTH="50" HEIGHT="50" PTYPE="6" FRTYPE="0" OwnPage="0" PCOLOR="Red" PCOLOR2="None" GRTYP="11" ItemID="6"/>
  <PAGEOBJECT XPOS="200" YPOS="320" WIDTH="40" HEIGHT="40" PTYPE="6" FRTYPE="3" OwnPage="0" PCOLOR="Red" PCOLOR2="None" ItemID="7" NUMPO="4" POCOOR="0 0 0 0 40 0 40 0 40 0 40 0 20 40 20 40"/>
</DOCUMENT>
</SCRIBUSUTF8NEW>`;

const byXY = (d, x, y) => d.items.find((it) => Math.abs(it.x - x) < 0.6 && Math.abs(it.y - y) < 0.6);

test("model: path text is parsed, clamped and canonical; bad paths drop the item", () => {
  assert.deepEqual(M.parsePath("M0 0L1 0.5C0 0 1 1 .5 .25Z"), [["M", 0, 0], ["L", 1, 0.5], ["C", 0, 0, 1, 1, 0.5, 0.25], ["Z"]]);
  assert.equal(M.parsePath("L0 0"), null, "must start with M");
  assert.equal(M.parsePath("M0 0 Q1 1 2 2"), null, "only M L C Z");
  assert.equal(M.parsePath("M0"), null);
  assert.deepEqual(M.parsePath("M-99 99"), [["M", -4, 5]], "clamped");
  const base = { id: "it-p", m: 5, pg: "pg-1", t: "path", x: 1, y: 2, w: 10, h: 10 };
  assert.equal(M.normItem(Object.assign({}, base, { d: "M0.123456 0 L1 1" })).d, "M0.1235 0L1 1");
  assert.equal(M.normItem(Object.assign({}, base, { d: "<script>" })), null);
  assert.equal(M.normItem(Object.assign({}, base, { d: "M0 0", eo: true })).eo, 1);
});

test("model: gradients are normalized and only kept on shapes", () => {
  const g = M.normGrad({ k: "l", x1: 0, y1: 0, x2: 99, y2: 1, st: [[1, "sw-paper", 50], [0, "sw-black"], [0.5, "bad id!", 10]] });
  assert.deepEqual(g, { k: "l", x1: 0, y1: 0, x2: 10, y2: 1, st: [[0, "sw-black", 100], [1, "sw-paper", 50]] });
  assert.equal(M.normGrad({ k: "x", st: [[0, "sw-black"], [1, "sw-paper"]] }), null);
  assert.equal(M.normGrad({ k: "r", st: [[0, "sw-black"]] }), null, "two stops at least");
  const it = { id: "it-g", m: 5, pg: "pg-1", x: 0, y: 0, w: 10, h: 10, gr: g };
  assert.ok(M.normItem(Object.assign({ t: "rect" }, it)).gr);
  assert.ok(M.normItem(Object.assign({ t: "ell" }, it)).gr);
  assert.equal(M.normItem(Object.assign({ t: "img" }, it)).gr, undefined);
  assert.equal(M.normItem(Object.assign({ t: "line" }, it)).gr, undefined);
});

test("model: merge keeps a path item another copy does not know", () => {
  const d = M.newDoc({ pages: 1 }, 10), pg = M.pagesInOrder(d)[0].id;
  const a = JSON.parse(JSON.stringify(d)), b = JSON.parse(JSON.stringify(d));
  a.items.push({ id: "it-path1", m: 20, t: "path", pg, x: 0, y: 0, w: 50, h: 50, d: "M0 0L1 1" });
  // an older copy drops the unknown item on read: union merge brings it back
  b.items = b.items.filter((x) => x.t !== "path");
  const m = M.mergeDoc(M.normDoc(a), M.normDoc(b));
  assert.ok(m.items.some((x) => x.id === "it-path1"));
});

test("sla: free shapes, polylines, regular polygons and 1.4 point lists become paths", () => {
  const r = S.convert(SLA, { now: 7 });
  const d = r.doc;
  const tri = byXY(d, 10, 10);
  assert.equal(tri.t, "path");
  assert.ok(tri.d.startsWith("M0 0L1 0L0.5 1Z"), tri.d);
  assert.ok(/M0\.1 0\.1L0\.3 0\.1L0\.3 0\.3L0\.1 0\.3Z$/.test(tri.d), "relative sub-path with h / v");
  assert.ok(!tri.eo, "fillRule 0 = non-zero");
  const pl = byXY(d, 10, 80);
  assert.equal(pl.t, "path");
  assert.ok(/^M0 1C/.test(pl.d), "quadratic → cubic");
  assert.equal(pl.fill, "");
  assert.ok(pl.stroke);
  const poly = byXY(d, 110, 80);
  assert.equal(poly.t, "path"); assert.equal(poly.eo, 1, "Scribus default fill rule is even-odd");
  const old = byXY(d, 100, 300);
  assert.equal(old.t, "path");
  assert.equal(old.d, "M0 0C0 0 1 0 1 0C1 0 0.5 1 0.5 1");
  assert.equal(r.stats.skipped, 1, "only the mesh fill");
});

test("sla: gradients with their own or named stops; unsupported kinds keep the colour", () => {
  const d = S.convert(SLA, { now: 7 }).doc;
  const lin = byXY(d, 10, 180);
  assert.equal(lin.t, "rect");
  assert.equal(lin.gr.k, "l");
  assert.deepEqual([lin.gr.x1, lin.gr.y1, lin.gr.x2, lin.gr.y2], [0, 0.5, 1, 0.5]);
  assert.equal(lin.gr.st.length, 3);
  assert.equal(lin.gr.st[1][2], 0, "a None stop is transparent");
  assert.ok(/50%/.test(M.label(M.find(d.swatches, lin.gr.st[2][1]).name, "en")), "shaded stop → tint");
  const rad = byXY(d, 230, 180);
  assert.equal(rad.t, "ell"); assert.equal(rad.gr.k, "r");
  assert.deepEqual([rad.gr.x1, rad.gr.y1, rad.gr.x2, rad.gr.y2], [0.5, 0.5, 1, 0.5]);
  assert.equal(rad.gr.st[1][2], 50, "TRANS → stop opacity");
  assert.equal(rad.fill, rad.gr.st[0][1], "fallback fill for copies without gradients");
  const mesh = byXY(d, 10, 300);
  assert.equal(mesh.gr, undefined); assert.ok(mesh.fill);
});

test("sla: layers set stacking, hidden and locked", () => {
  const d = S.convert(SLA, { now: 7 }).doc;
  const top = byXY(d, 10, 10), bg = byXY(d, 10, 80), notes = byXY(d, 110, 80);
  assert.ok(top.z > notes.z && notes.z > bg.z, "LEVEL order, not file order");
  assert.equal(top.lock, 1, "EDIT=0 → locked");
  assert.equal(notes.hide, 1, "SICHTBAR=0 → hidden");
  assert.ok(!bg.hide && !bg.lock);
});

test("sla: .sla.gz unpacks (and refuses a bomb)", async () => {
  if (typeof DecompressionStream === "undefined") return;
  const gz = zlib.gzipSync(Buffer.from(SLA));
  const txt = await S.gunzip(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.length));
  assert.equal(txt, SLA);
  assert.equal(await S.gunzip(Buffer.from(SLA)), null, "not gzip");
  const big = zlib.gzipSync(Buffer.alloc(4 * 1024 * 1024));
  assert.equal(await S.gunzip(big, 1024 * 1024), null, "unpacked size is capped");
});

test("pdf: path items and gradients become vector paths and shadings", () => {
  const { jsPDF } = require(path.join(ROOT, "vendor/jspdf.umd.min.js"));
  const d = S.convert(SLA, { now: 7 }).doc;
  const pdf = P.build(d, {}, { jsPDF });
  const out = Buffer.from(pdf.output("arraybuffer")).toString("latin1");
  assert.ok(out.startsWith("%PDF-"));
  assert.ok(/\/ShadingType 2/.test(out), "axial shading");
  assert.ok(/\/ShadingType 3/.test(out), "radial shading");
  const cmds = R.pathCmds(byXY(d, 10, 10));
  assert.deepEqual(cmds[0], ["M", 10, 10]);
  assert.deepEqual(cmds[2], ["L", 60, 60]);
});
