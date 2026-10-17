// Atelier Magic edit / Magic expand (magicai.js): the part sent, the
// canvas each service gets, the grown picture; and the wiring.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MX = require("../atelier/magicai.js");
const IA = require("../assistant/imgai.js");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("regionFor: room around the paint, inside the picture", () => {
  assert.deepEqual(MX.regionFor({ x0: 100, y0: 100, x1: 200, y1: 150 }, 1000, 800), { x: 52, y: 52, w: 196, h: 146 });
  const edge = MX.regionFor({ x0: 0, y0: 700, x1: 400, y1: 800 }, 1000, 800);
  assert.equal(edge.x, 0); assert.equal(edge.y + edge.h, 800); assert.equal(edge.w, 540);
});

test("frameFor / fitRect: sizes each service takes", () => {
  assert.deepEqual(MX.frameFor("openai", 1600, 900), { w: 1536, h: 1024 });
  assert.deepEqual(MX.frameFor("openai", 900, 1600), { w: 1024, h: 1536 });
  assert.deepEqual(MX.frameFor("openai", 500, 480), { w: 1024, h: 1024 });
  const sd = MX.frameFor("sdwebui", 1600, 900);
  assert.equal(sd.w, 1024); assert.equal(sd.h % 64, 0);
  assert.deepEqual(MX.frameFor("stability", 800, 1600), { w: 512, h: 1024 });
  assert.deepEqual(MX.fitRect(1600, 900, 1536, 1024), { x: 0, y: 80, w: 1536, h: 864 });
  assert.deepEqual(MX.fitRect(100, 100, 1024, 1024), { x: 0, y: 0, w: 1024, h: 1024 });
});

test("expandRect / padFor: the grown picture", () => {
  assert.deepEqual(MX.expandRect(1000, 1000, 16 / 9), { W: 1778, H: 1000, ox: 389, oy: 0 });
  assert.deepEqual(MX.expandRect(1600, 900, 9 / 16), { W: 1600, H: 2844, ox: 0, oy: 972 });
  assert.deepEqual(MX.expandRect(800, 600, 0, 1.5), { W: 1200, H: 900, ox: 200, oy: 150 });
  assert.equal(MX.expandRect(1000, 1000, 1), null);
  const ex = MX.expandRect(1000, 1000, 16 / 9);
  assert.deepEqual(MX.padFor(ex, 1000, 1000, 1), { left: 389, right: 389, up: 0, down: 0 });
  assert.deepEqual(MX.padFor({ W: 10000, H: 1000, ox: 4500, oy: 0 }, 1000, 1000, 1), { left: 2000, right: 2000, up: 0, down: 0 });
  MX.RATIO_IDS.forEach((r) => assert.ok(r in MX.RATIOS, r));
});

test("only services that can fill a painted part are used", () => {
  const can = IA.IDS.filter((id) => IA.PROVIDERS[id].mask);
  assert.deepEqual(can, ["openai", "stability", "sdwebui"]);
  can.forEach((id) => assert.ok(IA.buildEdit(IA.conf({ prov: id }), "k", { prompt: "p" }), id));
});

test("wiring: bar, AI tab, index, precache, help", () => {
  const ih = read("atelier/index.html");
  assert.ok(ih.indexOf("magicai.js") > ih.indexOf("imagine.js") && ih.indexOf("imagine.js") > ih.indexOf("magic.js"));
  assert.ok(read("sw.js").includes('"atelier/magicai.js"'));
  assert.ok(read("atelier/panels.js").includes("AT.magic.edit(it.id)") && read("atelier/panels.js").includes("AT.magic.expand(it.id)"));
  assert.ok(read("atelier/ai.js").includes("AT.magic.edit(one.id)"));
  const core = read("atelier/core.js");
  assert.ok(/\n    medit: '/.test(core) && /\n    mexpand: '/.test(core));
  const mg = read("atelier/magic.js");
  assert.ok(mg.includes("painter: painter"));
  assert.ok(read("atelier/help.en.txt").includes("`Magic expand`"));
  assert.ok(read("atelier/help.el.txt").includes("`Μαγική επέκταση`"));
});
