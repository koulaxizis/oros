// Atelier wave CV-1: groups (designkit item.grp), through addItem, the
// PowerPoint import and export (Canva keeps them as groups), and the
// wiring of grouping, the Layers list and Copy style. The stage itself
// (tap, second tap, drag in Layers) is covered in the real-shell run.
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Z = require("../atelier/zip.js");
const P = require("../atelier/pptx.js");
const O = require("../atelier/pptxout.js");
const AX = require("../atelier/ax.js");
const M = require("../designkit/model.js");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

function design() {
  const d = AX.newDesign({ name: "Groups", w: 1080, h: 1080, unit: "px", bg: "#ffffff" }, 1000);
  const pg = M.pagesInOrder(d)[0];
  const g = M.newId("gr");
  AX.addItem(d, pg.id, { k: "shape", shp: "rect", fc: "#ff0000", x: 100, y: 100, w: 200, h: 100, grp: g }, 1000);
  AX.addItem(d, pg.id, { k: "text", tx: "Μέσα", fc: "#000000", x: 120, y: 120, w: 160, grp: g }, 1000);
  AX.addItem(d, pg.id, { k: "shape", shp: "circle", fc: "#0000ff", x: 600, y: 600, w: 100, h: 100 }, 1000);
  return { d, pg, g };
}

test("addItem keeps grp on the item, not in ax; normDoc keeps it", () => {
  const { d, g } = design();
  const grouped = d.items.filter((it) => it.grp === g);
  assert.equal(grouped.length, 2);
  assert.ok(grouped.every((it) => !("grp" in it.ax)));
  const again = M.normDoc(JSON.parse(JSON.stringify(d)));
  assert.equal(again.items.filter((it) => it.grp === g).length, 2);
});

test("pptx out → in: a group goes as <p:grpSp> and comes back as one group", async () => {
  const { d } = design();
  const r = O.build(d, {});
  const zip = Z.open(r.bytes);
  const xml = await zip.text("ppt/slides/slide1.xml", 1 << 22);
  assert.equal((xml.match(/<p:grpSp>/g) || []).length, 1);
  const plan = await P.parse(zip, "back");
  const specs = plan.pages[0].items;
  const tokens = specs.map((s) => s.grp || "");
  assert.equal(tokens.filter(Boolean).length, 2);
  assert.equal(new Set(tokens.filter(Boolean)).size, 1);
  const back = P.build(plan, {}, 2000).doc;
  const ids = back.items.filter((it) => it.grp).map((it) => it.grp);
  assert.equal(ids.length, 2);
  assert.ok(M.isId(ids[0]) && ids[0] === ids[1]);
  assert.equal(back.items.filter((it) => it.ax.k === "shape" && it.ax.shp === "circle")[0].grp, "");
});

test("pptx in: nested groups become one; a group of one element is no group", async () => {
  const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const E = (pt) => Math.round(pt * 12700);
  const xf = (x, y, w, h) => `<a:xfrm><a:off x="${E(x)}" y="${E(y)}"/><a:ext cx="${E(w)}" cy="${E(h)}"/></a:xfrm>`;
  const sp = (x, c) => `<p:sp><p:nvSpPr><p:cNvPr id="3" name="s"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xf(x, 10, 50, 50)}<a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="${c}"/></a:solidFill></p:spPr></p:sp>`;
  const grp = (inner) => `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="7" name="g"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${E(1000)}" cy="${E(1000)}"/><a:chOff x="0" y="0"/><a:chExt cx="${E(1000)}" cy="${E(1000)}"/></a:xfrm></p:grpSpPr>${inner}</p:grpSp>`;
  const body = grp(sp(10, "FF0000") + grp(sp(100, "00FF00") + sp(200, "0000FF"))) + grp(sp(400, "111111")) + sp(600, "222222");
  // build the deck from the pptxout package (its parts) with this slide
  const base = O.build(AX.newDesign({ name: "x", w: 1080, h: 1080, unit: "px" }, 1), {});
  const z0 = Z.open(base.bytes), files = [];
  for (const n of z0.names) {
    let data = await z0.bytes(n, 1 << 24);
    if (n === "ppt/slides/slide1.xml") {
      data = Buffer.from(`<?xml version="1.0"?><p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${body}</p:spTree></p:cSld></p:sld>`);
    }
    files.push({ name: n, data });
  }
  const zipBytes = require("../photolab/ora.js").zip(files);
  const plan = await P.parse(Z.open(zipBytes), "nested");
  const tok = plan.pages[0].items.map((s) => s.grp || "");
  assert.equal(tok.length, 5);
  assert.ok(tok[0] && tok[0] === tok[1] && tok[1] === tok[2], "the outer group holds the inner one");
  assert.deepEqual(tok.slice(3), ["", ""]);
});

test("wiring: grouping, Layers, Copy style and their strings", () => {
  const E = read("atelier/editor.js"), PN = read("atelier/panels.js"), C = read("atelier/core.js"), DE = read("i18n/de/atelier.js");
  ["ED.group = ", "ED.ungroup = ", "ED.reorder = ", "ED.copyStyle = ", "function groupIds", "ED.inGrp = it.grp", 'k === "g"'].forEach((s) => assert.ok(E.includes(s), s));
  ["function layersSection", "function dragRow", 'tool("group"', 'tool("ungroup"', 'tool("roller"'].forEach((s) => assert.ok(PN.includes(s), s));
  ["grp.h", "grp.group", "grp.ungroup", "cs.copy", "cs.pick", "cs.done", "ly.h", "ly.none", "ly.text", "ly.video", "ly.photo", "ly.shape",
   "ly.icon", "ly.line", "ly.table", "ly.chart", "ly.drag", "ly.close", "ly.open", "ly.group", "ly.locked", "ly.hidden", "ly.hint"].forEach((k) => {
    assert.equal(C.split('"' + k + '"').length - 1, 2, k + " EN + EL");
    assert.ok(DE.includes('"' + k + '"'), k + " DE");
  });
  ["group:", "ungroup:", "roller:", "layers:"].forEach((k) => assert.ok(C.includes("    " + k + " '"), k + " icon"));
});
