// Spreadsheet wave 4.2 (2026-10-31): iterative calculation, area /
// stacked / combo charts with trend lines, formula and icon-set rules,
// and the mixed-version promises that keep them alive next to a device
// still on 4.73.00.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const FX = require(path.join(__dirname, "..", "spreadsheet/functions.js"));
const KIT = require(path.join(__dirname, "..", "spreadsheet/sheetkit.js"));
const src = fs.readFileSync(path.join(__dirname, "..", "spreadsheet/spreadsheet.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const M = new Function("KIT",
  "var DATA_VER = 2, ROWS = 100, COLS = 26, MAX_ROWS = 10000, MAX_COLS = 104, SID = 's-main';\n" +
  "function clone(o) { return JSON.parse(JSON.stringify(o)); }\n" +
  block("var SEED_BI", "/* ===== SECTION 2c") +
  "return { canonSS: canonSS, mergeState: mergeState, normalizeState: normalizeState };")(KIT);
const J = (x) => JSON.stringify(x);
const C = (x) => JSON.parse(J(x));
const canon = (x) => M.canonSS(M.normalizeState(C(x)));

function book() {
  return {
    ver: 2,
    sheets: [{ id: "s-main", name: "Data", rows: 100, cols: 26, pos: 0, mtime: 10, cw: {} }],
    cells: { "s-main|0|0": { v: "Name", mtime: 10, fm: { v: 10, f: 10 } } },
    deleted: {},
    charts: {
      "c-1": { id: "c-1", sid: "s-main", mtime: 30, t: "area", sk: 1, src: "A1:C4", at: { r: 1, c: 5, x: 0, y: 0 }, w: 420, h: 260 },
      "c-2": { id: "c-2", sid: "s-main", mtime: 31, t: "col", cb: 1, ln: 1, src: "A1:C4", at: { r: 9, c: 5, x: 0, y: 0 }, w: 420, h: 260 },
      "c-3": { id: "c-3", sid: "s-main", mtime: 32, t: "bar", sk: 1, src: "A1:C4", at: { r: 19, c: 5, x: 0, y: 0 }, w: 420, h: 260 }
    },
    cf: {
      "r-1": { id: "r-1", sid: "s-main", mtime: 40, rg: "B2:B9", k: "fx", a: "=$C2>10", st: { bg: "#f6d36b" } },
      "r-2": { id: "r-2", sid: "s-main", mtime: 41, rg: "C2:C9", k: "ic", is: "dt" },
      "r-3": { id: "r-3", sid: "s-main", mtime: 42, rg: "C2:C9", k: "gt", a: "5", st: { b: 1 } }
    },
    calc: { it: 1, n: 50, d: 0.0001, mtime: 50 }
  };
}
/* what canonSS on 4.73.00 does to the same data: unknown chart types
   become "col", the new chart keys, the new rule kinds and calc go */
function asOld(x) {
  const o = C(x);
  for (const id in o.charts) {
    const ch = o.charts[id];
    if (["col", "bar", "line", "pie", "donut", "scatter"].indexOf(ch.t) < 0) ch.t = "col";
    const re = { id: ch.id, sid: ch.sid, mtime: ch.mtime, t: ch.t, src: ch.src };
    for (const k in ch) if (!(k in re) && ["cb", "ln", "sk"].indexOf(k) < 0) re[k] = ch[k];
    o.charts[id] = re;
  }
  for (const id in o.cf) if (["fx", "ic"].indexOf(o.cf[id].k) >= 0) delete o.cf[id];
  delete o.calc;
  return o;
}

test("new chart options and rules survive normalising, in a fixed key order", () => {
  const c = canon(book());
  assert.deepEqual(Object.keys(c.charts["c-1"]).slice(0, 6), ["id", "sid", "mtime", "t", "sk", "src"]);
  assert.deepEqual(Object.keys(c.charts["c-2"]).slice(0, 7), ["id", "sid", "mtime", "t", "cb", "ln", "src"]);
  assert.equal(c.cf["r-1"].a, "=$C2>10");
  assert.equal(c.cf["r-2"].is, "dt");
  assert.deepEqual(c.calc, { it: 1, n: 50, d: 0.0001, mtime: 50 });
  // options only where they mean something
  assert.equal(KIT.normChart({ id: "x", sid: "s", t: "pie", sk: 1, cb: 1, ln: 1, src: "A1:B2" }).sk, undefined);
  assert.equal(KIT.normChart({ id: "x", sid: "s", t: "line", cb: 1, src: "A1:B2" }).cb, undefined);
  assert.equal(KIT.normChart({ id: "x", sid: "s", t: "line", ln: 1, src: "A1:B2" }).ln, 1);
  assert.equal(KIT.normCf({ id: "x", sid: "s", rg: "A1:A3", k: "ic", is: "zz" }).is, "ar");
  assert.equal(KIT.normCalc({ it: 1, n: 99999, d: -1 }).n, 1000);
  assert.equal(KIT.normCalc({ it: 1, n: 5, d: -1 }).d, 0.001);
  // a workbook that never touched these keeps its bytes (no calc key)
  const plain = book(); delete plain.charts; delete plain.cf; delete plain.calc;
  assert.equal(J(canon(plain)).indexOf('"calc"'), -1);
});

test("a copy from a 4.73.00 device, same stamps, loses nothing on merge", () => {
  const a = canon(book()), old = canon(asOld(a));
  assert.equal(old.charts["c-1"].t, "col");
  assert.equal(old.cf["r-1"], undefined);
  assert.equal(J(M.mergeState(C(a), C(old))), J(a));
  assert.equal(J(M.mergeState(C(old), C(a))), J(a));
});

test("calc is last writer wins, and turning it off is kept", () => {
  const a = canon(book()), b = C(a);
  b.calc = { it: 0, n: 50, d: 0.0001, mtime: 60 };
  assert.equal(M.mergeState(C(a), C(b)).calc.it, 0);
  assert.equal(M.mergeState(C(b), C(a)).calc.it, 0);
});

test("iterative calculation settles circular references", () => {
  const cells = {};
  const E = FX.engine({
    raw: (s, r, c) => cells[s + "|" + r + "|" + c] || "",
    sheetId: () => null, extent: () => ({ rows: 10, cols: 5 }), lang: "en", now: () => 0,
    formulaCells: () => Object.keys(cells).filter((k) => cells[k][0] === "=").map((k) => { const p = k.split("|"); return [p[0], +p[1], +p[2]]; })
  });
  cells["s|0|0"] = "=B1/2+1"; cells["s|0|1"] = "=A1";         // x = x/2 + 1 -> 2
  cells["s|1|0"] = "=A1*10";                                  // depends on the loop
  assert.equal(E.value("s", 0, 0), "#CYC!");
  E.setIter({ it: 1, n: 100, d: 1e-9 });
  const rounds = E.settle();
  assert.ok(rounds > 5 && rounds < 100, "rounds " + rounds);
  assert.ok(Math.abs(E.value("s", 0, 0) - 2) < 1e-6);
  assert.ok(Math.abs(E.value("s", 1, 0) - 20) < 1e-5);
  // the next recalculation starts from the settled values
  E.reset(); assert.ok(E.settle() <= 2);
  // a cap on the rounds is respected and never throws
  E.setIter({ it: 0 }); E.setIter({ it: 1, n: 3, d: 1e-12 });
  assert.equal(E.settle(), 3);
  // off again: back to #CYC!, no leftover values
  E.setIter(null); E.reset();
  assert.equal(E.value("s", 0, 0), "#CYC!");
  // a workbook without a loop needs one round
  cells["s|0|1"] = "5"; E.setIter({ it: 1 });
  assert.equal(E.settle(), 1);
  assert.equal(E.value("s", 0, 0), 3.5);
});

test("formula and icon-set rules", () => {
  const ic = { k: "ic", is: "ar" }, st = KIT.cfStats(ic, [0, 5, 10]);
  assert.equal(KIT.cfStyle(ic, 10, st).ic, "▲");
  assert.equal(KIT.cfStyle(ic, 5, st).ic, "▶");
  assert.equal(KIT.cfStyle(ic, 0, st).ic, "▼");
  assert.equal(KIT.cfStyle(ic, 0, st).icCo, "#e34948");
  assert.equal(KIT.cfStyle(ic, "x", st), null);
  const fx = { k: "fx", a: "=A1>1", st: { bg: "#f8c4c4" } };
  assert.equal(KIT.cfStyle(fx, null, {}, true).bg, "#f8c4c4");    // blank cells too
  assert.equal(KIT.cfStyle(fx, 5, {}, false), null);
  // the formula moves with each cell like a copied formula
  assert.equal(FX.shiftFormula("=$C2>10", 3, 0), "=$C5>10");
});

test("charts: area, stacked, combo and trend lines draw clean SVG", () => {
  const model = { cats: ["Q1", "Q2", "Q3", "Q4"], series: [
    { name: "North", vals: [3, 5, null, 8] }, { name: "South", vals: [2, -1, 4, 6] }, { name: "Total", vals: [5, 4, 4, 14] }] };
  const base = { w: 420, h: 260, lang: "en", pal: {} };
  const svgs = [
    KIT.chartSVG(model, Object.assign({ t: "area" }, base)),
    KIT.chartSVG(model, Object.assign({ t: "area", sk: 1 }, base)),
    KIT.chartSVG(model, Object.assign({ t: "col", sk: 1 }, base)),
    KIT.chartSVG(model, Object.assign({ t: "bar", sk: 1 }, base)),
    KIT.chartSVG(model, Object.assign({ t: "col", cb: 1, ln: 1 }, base)),
    KIT.chartSVG(model, Object.assign({ t: "line", ln: 1 }, base)),
    KIT.chartSVG({ cats: ["1", "2", "3"], xs: [1, 2, 3], xnum: true, series: [{ name: "y", vals: [2, 4, 7] }] }, Object.assign({ t: "scatter", ln: 1 }, base))
  ];
  svgs.forEach((s, i) => {
    assert.ok(s.startsWith("<svg") && s.endsWith("</svg>"), "svg " + i);
    assert.ok(!/NaN|undefined|Infinity/.test(s), "clean numbers " + i);
  });
  assert.ok(svgs[0].includes('fill-opacity="0.25"'));
  assert.ok(svgs[1].includes('fill-opacity="0.55"'));
  assert.ok(svgs[4].includes("stroke-dasharray"));                 // trend line
  assert.equal((svgs[4].match(/<circle/g) || []).length, 4);       // the line series' markers
  assert.ok(svgs[6].includes("stroke-dasharray"));
  // stacked columns: one bar per category, value scale holds the totals
  const one = KIT.chartSVG({ cats: ["A"], series: [{ name: "a", vals: [30] }, { name: "b", vals: [40] }] }, Object.assign({ t: "col", sk: 1 }, base));
  assert.ok(/>70</.test(one) || />80</.test(one), "axis reaches the total");
  const fit = KIT.trendFit([1, 2, 3], [2, 4, 6]);
  assert.ok(Math.abs(fit.b - 2) < 1e-12 && Math.abs(fit.a) < 1e-12);
  assert.equal(KIT.trendFit([1, 1], [2, 3]), null);
});
