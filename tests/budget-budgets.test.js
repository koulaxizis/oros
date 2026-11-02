// Budget flexible budgets (C3): budget/budgets.js (periods, spent,
// status, history, norm) and the synced collection "bgt" in budget.js,
// which an older Budget carries untouched. Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const G = require("../budget/budgets.js");
const src = fs.readFileSync(path.join(__dirname, "..", "budget/budget.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const load = (win) => new Function("window",
  block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  function cmpStr(", "  function newId(") +
  block("  // ---------- 2. Money", "  // ---------- 6. Storage") +
  "\nreturn { mergeBudget, emptyData };")(win);
const NEW = load({ OrosBudgetBudgets: G });     // this version, with budgets.js
const OLD = load(undefined);                    // budgets.js missing: carried like an unknown collection

const B = (x) => G.norm(Object.assign({ id: "b1", m: 1, a: 10000, n: "Food", p: "m", s: "2026-01-15", cs: "", as: "" }, x));
const tx = (d, a, c, ac, k) => ({ id: "t" + d + a, m: 1, d, a, k: k || "o", c: c || "food", n: "", ac });

test("periods: month from any day (clamped), week, every N days, once", () => {
  assert.deepEqual(G.periodAt(B(), "2026-03-20"), { i: 2, from: "2026-03-15", to: "2026-04-14" });
  assert.deepEqual(G.periodAt(B(), "2026-03-14"), { i: 1, from: "2026-02-15", to: "2026-03-14" });
  assert.deepEqual(G.periodAt(B({ s: "2026-01-31" }), "2026-02-28"), { i: 1, from: "2026-02-28", to: "2026-03-30" });
  assert.deepEqual(G.periodAt(B({ p: "w", s: "2026-11-02" }), "2026-11-15"), { i: 1, from: "2026-11-09", to: "2026-11-15" });
  assert.deepEqual(G.periodAt(B({ p: "d", nd: 10, s: "2026-11-02" }), "2026-11-12"), { i: 1, from: "2026-11-12", to: "2026-11-21" });
  assert.deepEqual(G.periodAt(B({ p: "o", s: "2026-07-01", e: "2026-07-10" }), "2026-12-01"), { i: 0, from: "2026-07-01", to: "2026-07-10" });
  assert.deepEqual(G.periodAt(B(), "2025-12-01").i, 0);    // before the first day: the first period
});

test("spent and status: chosen categories and accounts, per day left, ideal pace", () => {
  const b = B({ cs: "food fun", as: "bank" });
  const txs = [tx("2026-03-15", 2000, "food", "bank"), tx("2026-03-16", 500, "fun", "bank"), tx("2026-03-16", 900, "rent", "bank"),
               tx("2026-03-17", 700, "food", "cash"), tx("2026-03-17", 300, "food"), tx("2026-03-17", 5000, "food", "bank", "i")];
  assert.equal(G.spent(b, txs, "2026-03-15", "2026-04-14"), 2500);
  assert.equal(G.spent(B(), txs, "2026-03-15", "2026-04-14"), 2000 + 500 + 900 + 700 + 300);
  const st = G.status(b, txs, "2026-03-24");
  assert.equal(st.when, "now");
  assert.equal(st.len, 31);
  assert.equal(st.days, 22);                       // 24 March to 14 April
  assert.equal(st.left, 7500);
  assert.equal(st.perDay, Math.floor(7500 / 22));
  assert.equal(st.ideal, Math.round(10000 * 10 / 31));
  assert.equal(st.pace.length, 10);
  assert.equal(st.pace[1], 2500);
  assert.equal(G.status(B({ a: 2000 }), txs, "2026-03-24").state, "over");
  assert.equal(G.status(B({ p: "o", s: "2026-12-01", e: "2026-12-05" }), txs, "2026-03-24").when, "ahead");
});

test("history: the periods before the current one, oldest first, never before the first day", () => {
  const txs = [tx("2026-01-20", 12000), tx("2026-02-20", 3000), tx("2026-03-20", 1)];
  const h = G.history(B(), txs, "2026-03-20", 6);
  assert.deepEqual(h.map((p) => p.from + ":" + p.spent + ":" + p.over), ["2026-01-15:12000:true", "2026-02-15:3000:false"]);
  assert.deepEqual(G.history(B({ p: "o", s: "2026-01-01", e: "2026-01-02" }), txs, "2026-03-20", 6), []);
});

test("norm: refuses what can't be a budget, cleans the rest, every field written in name order", () => {
  assert.equal(G.norm({ id: "x", m: 1, a: 0, n: "A", p: "m", s: "2026-01-01" }), null);
  assert.equal(G.norm({ id: "x", m: 1, a: 5, n: "", p: "m", s: "2026-01-01" }), null);
  assert.equal(G.norm({ id: "x", m: 1, a: 5, n: "A", p: "o", s: "2026-01-02", e: "2026-01-01" }), null);
  assert.equal(G.norm({ id: "x", m: 1, a: 5, n: "A", p: "d", nd: 0, s: "2026-01-01" }), null);
  const b = G.norm({ id: "x", m: 1, a: 5, n: "  A\u0007 b ", p: "w", s: "2026-01-01", cs: "o-groc BAD o-groc o-eat", nd: 9, e: "2026-02-01" });
  assert.deepEqual(Object.keys(b), ["id", "m", "a", "as", "col", "cs", "e", "n", "nd", "p", "s"]);
  assert.equal(b.n, "A b");
  assert.equal(b.cs, "o-groc o-eat");
  assert.equal(b.nd, 0);
  assert.equal(b.e, "");
});

test("bgt syncs: LWW with tombstones, and an older Budget writes the very same canonical JSON", () => {
  const b = B({});
  const d1 = Object.assign(NEW.emptyData(), { bgt: [b] });
  const d2 = Object.assign(NEW.emptyData(), { bgt: [Object.assign({}, b, { m: 5, a: 20000 })] });
  const merged = NEW.mergeBudget(d1, d2);
  assert.equal(merged.bgt[0].a, 20000);
  const keys = Object.keys(merged);
  assert.equal(keys.indexOf("bgt"), keys.indexOf("bnk") + 1);
  const gone = NEW.mergeBudget(merged, Object.assign(NEW.emptyData(), { tombs: { "bgt:b1": 9 } }));
  assert.equal(gone.bgt.length, 0);
  // the same data through an older device and back
  const viaOld = OLD.mergeBudget(merged, merged);
  assert.equal(JSON.stringify(viaOld), JSON.stringify(merged));
  assert.equal(JSON.stringify(NEW.mergeBudget(viaOld, viaOld)), JSON.stringify(merged));
});

test("budgetsui.js: English and Greek have the same keys; index.html loads it before budget.js", () => {
  const s = fs.readFileSync(path.join(__dirname, "..", "budget/budgetsui.js"), "utf8");
  const keys = (lang) => {
    const i = s.indexOf("    " + lang + ": {"), j = s.indexOf("\n    }", i);
    return [...s.slice(i, j).matchAll(/"(bg\.[^"]+)":/g)].map((m) => m[1]);
  };
  const en = keys("en"), el = keys("el");
  assert.equal(new Set(en).size, en.length);
  assert.deepEqual(en.slice().sort(), el.slice().sort());
  for (const m of s.matchAll(/\bt\("(bg\.[^"]+)"\s*[,)]/g)) assert.ok(en.includes(m[1]), "missing string " + m[1]);
  const html = fs.readFileSync(path.join(__dirname, "..", "budget/index.html"), "utf8");
  const at = (f) => html.indexOf('src="' + f);
  assert.ok(at("budgets.js") > 0 && at("budgetsui.js") > at("budgets.js") && at("budget.js") > at("budgetsui.js"));
});
