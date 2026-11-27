// Photo Lab before / after and scopes (PL-CMP): the pure scope maths
// in photolab/adjust.js (histograms, vectorscope, lean), and the
// wiring of the split view, the Scopes tab and the strings EN/EL/DE.
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const dir = (f) => path.join(__dirname, "..", f);
const read = (f) => fs.readFileSync(dir(f), "utf8");
const A = require(dir("photolab/adjust.js"));

function img(w, h, px) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set(typeof px === "function" ? px(i) : px, i * 4);
  return { w, h, data: d };
}

test("histograms count red, green, blue and brightness of opaque pixels", () => {
  const hs = A.histograms(img(4, 4, (i) => (i < 8 ? [255, 0, 0, 255] : [0, 0, 255, 10])));
  assert.equal(hs.n, 8);
  assert.equal(hs.r[255], 8);
  assert.equal(hs.g[0], 8);
  assert.equal(hs.b[0], 8);
  assert.equal(hs.l[Math.round(0.2126 * 255)], 8);
});

test("a big picture is sampled, not read whole", () => {
  const hs = A.histograms(img(1000, 1000, [10, 20, 30, 255]));
  assert.ok(hs.n <= 250000 && hs.n >= 200000, String(hs.n));
});

test("vectorscope: grey sits in the centre, red up and to the left", () => {
  const n = 65, m = n - 1;
  const g = A.vectorscope(img(5, 5, [128, 128, 128, 255]), n);
  assert.equal(g.count, 25);
  assert.equal(g.max, 25);
  assert.equal(g.bins[(m / 2) * n + m / 2], 25);
  const r = A.vectorscope(img(5, 5, [255, 0, 0, 255]), n);
  const at = r.bins.findIndex((v) => v === 25), x = at % n, y = Math.floor(at / n);
  assert.ok(x < m / 2 && y < m / 4, `${x},${y}`);
  assert.ok(r.cr > 0.49 && r.cb < 0);
});

test("vectorscope gain spreads weak colours and drops what falls past the edge", () => {
  const soft = img(2, 2, [150, 128, 128, 255]);
  const v1 = A.vectorscope(soft, 101), v2 = A.vectorscope(soft, 101, 2);
  const off = (v) => { const i = v.bins.findIndex((c) => c > 0); return Math.hypot(i % 101 - 50, Math.floor(i / 101) - 50); };
  assert.ok(off(v2) > off(v1) * 1.8);
  assert.equal(v1.cr, v2.cr);                         // the mean never takes the gain
  const red = A.vectorscope(img(2, 2, [255, 0, 0, 255]), 101, 2);
  assert.equal(red.max, 0);
  assert.equal(red.count, 4);
});

test("transparent pixels are left out of every scope", () => {
  const v = A.vectorscope(img(3, 3, [255, 0, 0, 0]), 32);
  assert.equal(v.count, 0);
  assert.equal(v.max, 0);
  assert.equal(A.leanOf(v).id, "none");
});

test("lean names the colour family and finds skin tones", () => {
  const lean = (px) => A.leanOf(A.vectorscope(img(2, 2, px), 64));
  assert.equal(lean([128, 128, 128, 255]).id, "none");
  assert.equal(lean([0, 0, 255, 255]).id, "b");
  assert.equal(lean([0, 200, 0, 255]).id, "g");
  assert.equal(lean([255, 255, 0, 255]).id, "y");
  const skin = lean([224, 172, 145, 255]);
  assert.equal(skin.skin, true);
  assert.equal(lean([0, 0, 255, 255]).skin, false);
  assert.deepEqual(A.TARGETS.map((t) => t.id), ["r", "y", "g", "c", "b", "m"]);
  assert.ok(A.SKIN_DEG > 115 && A.SKIN_DEG < 130);
});

test("view: split compare, before kept at open or before the first undo step", () => {
  const v = read("photolab/view.js");
  for (const k of ["takeBefore:", "newBefore:", "beforeStep:", "setCompare:", "setCompareX:", "compareAt:"]) assert.ok(v.includes(k), k);
  assert.match(v, /PL\.phone \? 2048 : 4096/);
  assert.match(v, /function flatten\(rect, scale, layers, preview\)/);
  const app = read("photolab/app.js");
  assert.match(app, /PL\.view\.beforeStep\(step\);\s*\/\/[^\n]*\n\s*st\.hist\.push\(step\)/);
  assert.match(app, /PL\.view\.newBefore\(\)/);
  const tools = read("photolab/tools.js");
  assert.match(tools, /compareAt\(sp\)\) \{ op = compareOp\(\)/);
});

test("panels: menu, \\ key, status button, dialog toggle and Scopes tab", () => {
  const p = read("photolab/panels.js");
  assert.match(p, /id: "compare", k: "\\\\"/);
  assert.match(p, /id: "scopes"/);
  assert.match(p, /e\.code === "Backslash"/);
  assert.match(p, /extra: \[cmpB\]/);
  assert.match(p, /PL\.compareLive = function/);
  assert.match(p, /\["layers", "history", "scopes"\]/);
  const html = read("photolab/index.html");
  for (const id of ["tab-scopes", "pane-scopes", "sc-histo", "sc-vec", "sc-zoom", "sc-note", "cmp-btn"]) assert.ok(html.includes(`id="${id}"`), id);
  // app data never reaches the scopes as HTML
  assert.doesNotMatch(p.slice(p.indexOf("Before / after + scopes"), p.indexOf("// ---------- Adjustment layers")), /innerHTML = (?!ICON\.)/);
});

test("strings EN, EL and DE, help in all three", () => {
  global.window = {};
  require(dir("photolab/strings.js"));
  const S = global.window.PL_STRINGS;
  let pack = null;
  global.orosPack = (l, a, o) => { pack = o; };
  // eslint-disable-next-line no-eval
  eval(read("i18n/de/photolab.js"));
  const keys = ["tab.scopes", "menu.compare", "menu.scopes", "btn.compare", "btn.cmpDlg", "cmp.before", "cmp.after",
    "live.cmpOn", "live.cmpOff", "sc.histo", "sc.vec", "sc.zoom", "sc.histoAria", "sc.vecAria", "sc.empty",
    "sc.neutral", "sc.lean", "sc.skin", "sc.c.r", "sc.c.y", "sc.c.g", "sc.c.c", "sc.c.b", "sc.c.m"];
  for (const k of keys) {
    assert.ok(S.en[k], "en " + k); assert.ok(S.el[k], "el " + k); assert.ok(pack[k], "de " + k);
    if (k === "sc.lean") for (const t of [S.en[k], S.el[k], pack[k]]) assert.ok(t.includes("{c}"));
  }
  for (const f of ["photolab/help.en.txt", "photolab/help.el.txt", "i18n/de/help/photolab.txt"]) {
    const h = read(f);
    assert.ok(h.includes("[[\\]]"), f);
    assert.ok(/4096 px/.test(h) && /2048 px/.test(h), f);
  }
});
