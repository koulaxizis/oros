// Photo Lab wave PS-4: layer groups. The document model (core.js
// normGroups, layerTree, adoptGroups), groups through .orosphoto
// (package.js), and groups in and out of PSD (psd.js) and OpenRaster
// (ora.js). The panel and the drawing are covered in the real-shell run.
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const dir = (f) => path.join(__dirname, "..", f);
const C = require(dir("photolab/core.js"));
const PKG = require(dir("photolab/package.js"));
const PSD = require(dir("photolab/psd.js"));
const ORA = require(dir("photolab/ora.js"));

const img = (w, h, rgba) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set(rgba, i * 4);
  return { w, h, data: d };
};
const doc = (layers, gr) => C.normDoc({ id: "pgroups1", m: 1, name: "G", w: 4, h: 4, layers, gr });
const lay = (id, g) => Object.assign({ id, k: "raster", name: id, t: {} }, g ? { g } : {});

test("core: groups keep known fields; bad ids, loops and unknown parents go; empty groups go", () => {
  const d = doc([lay("la0001", "gaaaa1"), lay("la0002", "gbbbb2"), lay("la0003", "gnope9")], [
    { id: "gaaaa1", name: "Outer", vis: 0, op: 140, bl: "multiply", open: 1 },
    { id: "gbbbb2", name: "Inner", p: "gaaaa1", bl: "weird" },
    { id: "gcccc3", name: "Empty" },
    { id: "<x>", name: "Bad" },
    { id: "gloop1", p: "gloop2" }, { id: "gloop2", p: "gloop1" }
  ]);
  assert.deepEqual(d.gr.map((g) => g.id), ["gaaaa1", "gbbbb2"]);
  assert.deepEqual(d.gr[0], { id: "gaaaa1", name: "Outer", vis: 0, op: 100, bl: "multiply", open: 1 });
  assert.deepEqual([d.gr[1].bl, d.gr[1].p, d.gr[1].vis, d.gr[1].op], ["pass", "gaaaa1", 1, 100]);
  assert.equal(d.layers[2].g, undefined);                 // its group is not in gr
  const flat = doc([lay("la0001")], []);
  assert.equal(flat.gr, undefined);
});

test("core: loops are cut and nesting stops at MAX_DEPTH", () => {
  const raw = [];
  for (let i = 0; i < C.MAX_DEPTH + 3; i++) raw.push({ id: "gdeep" + i, p: i ? "gdeep" + (i - 1) : undefined });
  const gr = C.normGroups(raw.concat([{ id: "gloop1", p: "gloop2" }, { id: "gloop2", p: "gloop1" }]));
  const d = { gr };
  gr.forEach((g) => assert.ok(C.groupPath(d, g.id).length <= C.MAX_DEPTH));
  assert.ok(!(gr.find((g) => g.id === "gloop1").p && gr.find((g) => g.id === "gloop2").p));
  assert.equal(C.normGroups(Array.from({ length: 80 }, (_, i) => ({ id: "gmany" + i }))).length, C.MAX_GROUPS);
});

test("core: layerTree nests bottom → top; a split group shows twice; groupLayers reaches sub-groups", () => {
  const d = doc([lay("la0001"), lay("la0002", "gbbbb2"), lay("la0003", "gaaaa1"), lay("la0004"), lay("la0005", "gaaaa1")],
                [{ id: "gaaaa1", name: "A" }, { id: "gbbbb2", name: "B", p: "gaaaa1" }]);
  const tree = C.layerTree(d);
  const shape = (n) => n.L ? n.L.id : { [n.G.id]: n.kids.map(shape) };
  assert.deepEqual(tree.map(shape), ["la0001", { gaaaa1: [{ gbbbb2: ["la0002"] }, "la0003"] }, "la0004", { gaaaa1: ["la0005"] }]);
  assert.deepEqual(C.groupLayers(d, "gaaaa1").map((L) => L.id), ["la0002", "la0003", "la0005"]);
  assert.deepEqual(C.groupLayers(d, "gbbbb2").map((L) => L.id), ["la0002"]);
});

test("core: adoptGroups gives ids; past the limits the deepest groups go onto their layers", () => {
  const layers = [{ name: "a", op: 100, vis: 1, g: 1 }, { name: "b", op: 80, vis: 1, g: 0 }, { name: "c", op: 100, vis: 1 }];
  const gr = C.adoptGroups(layers, [{ name: "Outer", vis: 1, op: 50, bl: "pass" }, { name: "Inner", vis: 0, op: 40, bl: "screen", p: 0 }]);
  assert.equal(gr.length, 2);
  const outer = gr.find((g) => g.name === "Outer"), inner = gr.find((g) => g.name === "Inner");
  assert.ok(C.GROUP_RE.test(outer.id) && C.GROUP_RE.test(inner.id));
  assert.equal(inner.p, outer.id); assert.equal(inner.bl, "screen"); assert.equal(inner.vis, 0);
  assert.deepEqual(layers.map((L) => L.g), [inner.id, outer.id, undefined]);
  // a chain deeper than MAX_DEPTH: the deepest go, their opacity and visibility onto the layer
  const deep = [];
  for (let i = 0; i < C.MAX_DEPTH + 2; i++) deep.push({ name: "d" + i, op: 50, vis: i === C.MAX_DEPTH + 1 ? 0 : 1, p: i ? i - 1 : null });
  const L = [{ name: "x", op: 100, vis: 1, g: C.MAX_DEPTH + 1 }];
  const g2 = C.adoptGroups(L, deep);
  assert.equal(g2.length, C.MAX_DEPTH);
  assert.equal(L[0].op, 25); assert.equal(L[0].vis, 0);
  assert.equal(g2.find((g) => g.id === L[0].g).name, "d" + (C.MAX_DEPTH - 1));
});

test("package: groups go into the .orosphoto and come back", () => {
  const content = { kind: PKG.KIND, ver: PKG.VER, doc: { name: "G", w: 4, h: 4,
    layers: [{ id: "la0001", k: "raster", name: "In", g: "gaaaa1" }, { id: "la0002", k: "raster", name: "Out" }],
    gr: [{ id: "gaaaa1", name: "Folder", op: 60, bl: "overlay", open: 0 }] } };
  const r = PKG.parse(content, C, { now: 5 });
  assert.deepEqual(r.doc.gr, [{ id: "gaaaa1", name: "Folder", vis: 1, op: 60, bl: "overlay", open: 0 }]);
  assert.equal(r.doc.layers[0].g, "gaaaa1"); assert.equal(r.doc.layers[1].g, undefined);
});

test("psd: groups written as folders open again as the same groups (nested, pass-through, hidden, closed)", async () => {
  const groups = [{ name: "Ομάδα", vis: 1, op: 60, bl: "pass", open: 1, p: null },
                  { name: "Inner", vis: 0, op: 100, bl: "multiply", open: 0, p: 0 }];
  const L = (name, g, c) => Object.assign({ name, x: 0, y: 0, op: 100, bl: "normal", vis: 1, img: img(2, 2, c) }, g == null ? {} : { g });
  const bytes = PSD.write({ w: 2, h: 2, merged: img(2, 2, [0, 0, 0, 255]), groups, layers: [
    L("bottom", null, [1, 1, 1, 255]), L("in inner", 1, [2, 2, 2, 255]), L("in outer", 0, [3, 3, 3, 255]), L("top", null, [4, 4, 4, 255])
  ] });
  const r = await PSD.read(bytes);
  assert.deepEqual(r.layers.map((x) => x.name), ["bottom", "in inner", "in outer", "top"]);
  assert.deepEqual(r.layers[2].img.data.slice(0, 4), new Uint8ClampedArray([3, 3, 3, 255]));
  const byName = {};
  r.groups.forEach((g, i) => { byName[g.name] = Object.assign({ i }, g); });
  assert.deepEqual([byName["Ομάδα"].vis, byName["Ομάδα"].op, byName["Ομάδα"].bl, byName["Ομάδα"].open], [1, 60, "pass", 1]);
  assert.deepEqual([byName.Inner.vis, byName.Inner.op, byName.Inner.bl, byName.Inner.open], [0, 100, "multiply", 0]);
  assert.equal(byName.Inner.p, byName["Ομάδα"].i);
  assert.deepEqual(r.layers.map((x) => x.g), [undefined, byName.Inner.i, byName["Ομάδα"].i, undefined]);
  assert.equal(r.notes.groupBlend, undefined);
});

test("psd: a group split by another layer is written as two folders", async () => {
  const L = (name, g) => Object.assign({ name, x: 0, y: 0, op: 100, bl: "normal", vis: 1, img: img(1, 1, [9, 9, 9, 255]) }, g == null ? {} : { g });
  const r = await PSD.read(PSD.write({ w: 1, h: 1, merged: img(1, 1, [0, 0, 0, 255]), groups: [{ name: "G", vis: 1, op: 100, bl: "pass" }],
    layers: [L("a", 0), L("b"), L("c", 0)] }));
  assert.equal(r.groups.length, 2);
  assert.deepEqual(r.layers.map((x) => x.g), [0, undefined, 1]);
});

test("ora: groups written as nested stacks read back the same", () => {
  const png = new Uint8Array([137, 80, 78, 71]);
  const groups = [{ name: "Out & <er>", vis: 0, op: 50, bl: "pass", p: null }, { name: "In", vis: 1, op: 100, bl: "screen", p: 0 }];
  const L = (name, g) => Object.assign({ name, x: 1, y: 2, op: 100, bl: "normal", vis: 1, png }, g == null ? {} : { g });
  const bytes = ORA.write({ w: 8, h: 8, merged: png, groups, layers: [L("bottom"), L("deep", 1), L("mid", 0), L("top")] });
  const Zip = require(dir("atelier/zip.js"));
  return Zip.open(bytes).text("stack.xml", 1 << 20).then((xml) => {
    const s = ORA.parseStack(xml);
    assert.deepEqual(s.layers.map((x) => [x.name, x.g, x.x, x.y]), [["bottom", undefined, 1, 2], ["deep", 1, 1, 2], ["mid", 0, 1, 2], ["top", undefined, 1, 2]]);
    assert.deepEqual(s.groups, [{ name: "Out & <er>", vis: 0, op: 50, bl: "pass", open: 1, p: null },
                                { name: "In", vis: 1, op: 100, bl: "screen", open: 1, p: 0 }]);
  });
});

test("kra: passthrough groups, nesting and collapsed folders", () => {
  const d = ORA.parseKraDoc(`<DOC><IMAGE width="10" height="10" name="Art"><layers>
    <layer name="Pass" nodetype="grouplayer" passthrough="1" opacity="128" visible="1" collapsed="1" filename="l1"><layers>
      <layer name="Iso" nodetype="grouplayer" compositeop="multiply" opacity="255" visible="0" filename="l2"><layers>
        <layer name="Paint" nodetype="paintlayer" filename="l3" opacity="255" visible="1"/>
      </layers></layer>
    </layers></layer></layers></IMAGE></DOC>`);
  assert.deepEqual(d.groups, [{ name: "Pass", vis: 1, op: 50, bl: "pass", open: 0, p: null },
                              { name: "Iso", vis: 0, op: 100, bl: "multiply", open: 1, p: 0 }]);
  assert.equal(d.layers[0].g, 1);
});

test("wiring: the panel, menu, view and strings know groups", () => {
  const fs = require("fs");
  const read = (f) => fs.readFileSync(dir(f), "utf8");
  const S = read("photolab/strings.js"), DE = read("i18n/de/photolab.js");
  ["menu.groupLayer", "menu.ungroup", "msg.maxGroups", "msg.noGroup", "layer.group", "step.group", "step.ungroup",
   "step.deleteGroup", "btn.foldGroup", "btn.unfoldGroup", "kind.group", "kind.groupOwn", "blend.pass", "dlg.renameGroup"].forEach((k) => {
    assert.equal(S.split('"' + k + '"').length - 1, 2, k + " EN + EL");
    assert.ok(DE.includes('"' + k + '"'), k + " DE");
  });
  assert.match(read("photolab/view.js"), /compositeTree/);
  assert.match(read("photolab/panels.js"), /layerTree/);
  assert.ok(read("photolab/io.js").includes("layers, r.groups);"));
});
