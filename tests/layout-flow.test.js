// Layout: text flow and object styles (LY-W5b): break characters
// (a paragraph's ext.brk), the baseline grid and lock, vertical
// justification, object styles, and their strings in EN/EL/DE.
// Run: node --test tests/layout-flow.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const OS = require(path.join(ROOT, "layout/objstyles.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const LYJS = read("layout/layout.js");
const EL_AT = LYJS.indexOf('"home.new": "Νέο έγγραφο"');
function table(part) {
  const out = {}, re = /"([a-z][a-zA-Z0-9.]*)": "((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(part))) if (!(m[1] in out)) out[m[1]] = JSON.parse('"' + m[2] + '"');
  return out;
}
const EN = table(LYJS.slice(0, EL_AT)), EL = table(LYJS.slice(EL_AT));
const DE = table(read("i18n/de/layout.js"));

const P = (x) => Object.assign({ id: "p", m: 1, name: "P", font: "serif", size: 10, lead: 12 }, x);
const STY = { ps: [P(), P({ id: "h", size: 14, lead: 17, ext: { bl: 1 } })], cs: [] };
const at = (L, id) => L.frames[id].lines.map((l) => [l.col, l.p, Math.round(l.y * 100) / 100]);
const paras = () => [{ ps: "p", runs: [{ t: "One" }] }, { ps: "h", runs: [{ t: "Two" }] }, { ps: "p", runs: [{ t: "Three" }] }, { ps: "p", runs: [{ t: "Four" }] }];

test("breaks: a paragraph's own ext.brk starts it in the next column or page", () => {
  const ps = paras();
  ps[3].ext = { brk: "col" };
  let L = T.layoutChain({ paras: ps }, [{ id: "a", w: 200, h: 200, cols: 2, gut: 10 }], STY);
  assert.deepEqual(at(L, "a").map((l) => l[0]), [0, 0, 0, 1]);
  ps[3].ext = { brk: "page" };
  const fr = [{ id: "a", w: 200, h: 200, ctx: { pg: "p1" } }, { id: "b", w: 200, h: 200, ctx: { pg: "p2" } }];
  L = T.layoutChain({ paras: ps }, fr, STY);
  assert.equal(L.frames.a.lines.length, 3);
  assert.equal(L.frames.b.lines[0].p, 3);
  ps[3].ext = { brk: "nonsense" };
  L = T.layoutChain({ paras: ps }, [{ id: "a", w: 200, h: 200, cols: 2, gut: 10 }], STY);
  assert.deepEqual(at(L, "a").map((l) => l[0]), [0, 0, 0, 0], "an unknown break is ignored");
});

test("baseline grid: locked paragraphs sit on it, the rest do not move", () => {
  const free = at(T.layoutChain({ paras: paras() }, [{ id: "a", w: 200, h: 200 }], STY), "a");
  const grid = at(T.layoutChain({ paras: paras() }, [{ id: "a", w: 200, h: 200, bgrid: { o: 5, inc: 12 } }], STY), "a");
  assert.equal(free[0][2], grid[0][2], "an unlocked line stays");
  assert.equal((grid[1][2] - 5) % 12, 0, "the locked line is on the grid");
  assert.ok(grid[1][2] >= free[1][2]);
  // the grid from the page: setup.ext.bg { s, i } seen from the frame's top
  const doc = { setup: { ext: { bg: { s: 40, i: 14 } } } };
  assert.deepEqual(R.gridOf(doc, { y: 30 }), { o: 10, inc: 14 });
  assert.equal(R.gridOf(doc, { y: 30, rot: 15 }), null, "not on a turned frame");
  assert.equal(R.gridOf({ setup: { ext: { bg: { s: 0, i: 0 } } } }, { y: 0 }), null);
  assert.equal(R.gridOf({ setup: {} }, { y: 0 }), null);
  const st = T.resolvePs({ a: { id: "a", ext: { bl: 1 } }, b: { id: "b", base: "a", ext: { bl: 0 } } }, "b");
  assert.equal(st.bl, 0, "inherited and overridden like the rest");
});

test("vertical justification: free space between paragraphs, the last column stays", () => {
  const ps = paras();
  ps[3].ext = { brk: "col" };
  const L = T.layoutChain({ paras: ps }, [{ id: "a", w: 200, h: 200, cols: 2, gut: 10, vj: true }], STY);
  const ls = L.frames.a.lines.filter((l) => l.col === 0), last = ls[ls.length - 1];
  assert.ok(Math.abs(last.y + last.d - 200) < 0.01, "column 1 ends at the foot");
  assert.equal(ls[0].y, at(T.layoutChain({ paras: ps }, [{ id: "a", w: 200, h: 200, cols: 2, gut: 10 }], STY), "a")[0][2], "the first line stays");
  assert.equal(L.frames.a.lines.filter((l) => l.col === 1)[0].y, 8, "the last column of the text is not stretched");
  // the runs move with their line
  last.runs.forEach((r) => assert.equal(r.y, last.y));
});

test("object styles: capture, apply, check", () => {
  const box = { t: "text", fill: "sw-red", stroke: "", sw: 2, dash: 0, op: 80, r: 4, wrap: "box", wo: 6, ins: 5, cols: 2, gut: 9, va: "c", ext: { vj: 1 } };
  const p = OS.capture(box);
  assert.deepEqual(p, { fill: "sw-red", stroke: "", sw: 2, dash: 0, op: 80, r: 4, wrap: "box", wo: 6, ins: 5, cols: 2, gut: 9, va: "c", vj: 1 });
  const line = OS.apply({ t: "line", stroke: "sw-black", sw: 1 }, p, "os-a1");
  assert.equal(line.fill, undefined, "a line takes no fill");
  assert.equal(line.cols, undefined, "nor text settings");
  assert.equal(line.ext.os, "os-a1");
  const tf = OS.apply({ t: "text", cols: 1, ext: { sfit: 1 } }, p, "os-a1");
  assert.equal(tf.cols, 2);
  assert.deepEqual(tf.ext, { sfit: 1, vj: 1, os: "os-a1" });
  const off = OS.apply({ t: "text", ext: { os: "os-a1", vj: 1 } }, { vj: 0 }, "");
  assert.equal(off.ext, undefined);
  assert.deepEqual(OS.clean({ fill: "javascript:x", op: 300, cols: 0.2, wrap: "x", va: "j" }), { op: 100, cols: 1 });
  const list = OS.norm([{ id: "os-a", name: "A", p: { op: 50 } }, { id: "os-a", name: "dup" }, { id: "bad id" }, null, { id: "os-b", name: "x\u0001y".repeat(40) }]);
  assert.deepEqual(list.map((x) => x.id), ["os-a", "os-b"]);
  assert.equal(list[1].name.length, 60);
  assert.equal(OS.norm(new Array(80).fill(0).map((_, i) => ({ id: "os-" + i, name: "n" }))).length, OS.MAX);
});

test("breaks in the editors and the Story Editor keeps a paragraph's ext", () => {
  const story = read("layout/story.js"), inf = read("layout/inframe.js");
  assert.ok(story.includes("function insertBreak(paras, at, kind)"));
  assert.ok(story.includes('d.setAttribute("data-px", key)') && story.includes('open(node.getAttribute("data-ps"), node.getAttribute("data-px"))'), "para ext survives typing");
  assert.ok(story.includes('e.code === "NumpadEnter"') && inf.includes('e.code === "NumpadEnter"'));
  assert.ok(read("layout/panels.js").includes('["j", t("props.va.j")]'));
});

test("W5b: every string in English, Greek and German, and wired in", () => {
  const src = read("layout/objstyles.js") + read("layout/panels.js") + read("layout/story.js");
  const keys = new Set(["brk.col", "brk.page", "brk.odd", "brk.even"]);
  const re = /\bt\("([a-z][a-zA-Z0-9.]*)"(?! \+)/g;
  let m;
  while ((m = re.exec(src))) if (/^(os|bg|brk)\.|^sty\.bl$|^props\.va\.j$/.test(m[1])) keys.add(m[1]);
  ["col", "page", "odd", "even"].forEach((k) => keys.add("brk.ins." + k));
  assert.ok(keys.size > 25, String(keys.size));
  keys.forEach((k) => {
    assert.ok(EN[k], "EN " + k);
    assert.ok(EL[k], "EL " + k);
    assert.ok(DE[k], "DE " + k);
    const ph = (s) => (s.match(/\{[a-z]+\}/g) || []).sort().join();
    assert.equal(ph(EL[k]), ph(EN[k]), "EL placeholders " + k);
    assert.equal(ph(DE[k]), ph(EN[k]), "DE placeholders " + k);
  });
  const html = read("layout/index.html");
  assert.ok(html.indexOf("objstyles.js") > 0 && html.indexOf("objstyles.js") < html.indexOf("panels.js"));
  assert.ok(read("sw.js").includes('"layout/objstyles.js"'));
});
