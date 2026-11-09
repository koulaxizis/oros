// AR-INV (6.01.00, Chris 2026-11-09): areas know their Invoices series,
// the one area of shared costs and the other areas' shares of it.
// Invoices payments come into the area of their series, the Overview
// shows the year after shared costs, and the gate reads and changes
// areas (budget_areas, area on entries) with undo.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const L = require("../budget/links.js");
const O = require("../budget/overview.js");
const G = require("../gate/gate.js");

const src = fs.readFileSync(path.join(__dirname, "..", "budget/budget.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const B = new Function(
  block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  function cmpStr(", "  function newId(") +
  block("  // ---------- 2. Money", "  // ---------- 6. Storage") +
  "\nreturn { mergeBudget, emptyData };")();
const canon = (x) => JSON.stringify(x);

test("areas: invoice series, shared costs and shares are kept, cleaned and in key order", () => {
  const d = Object.assign(B.emptyData(), { area: [
    { id: "ar1", m: 5, n: "Ηχοληψία", q: "", col: 1, iv: "ser-x ser-inv ser-inv BAD! ", pc: 30 },
    { id: "ar2", m: 5, n: "Κοινά", q: "telekom", col: 2, sh: 1, pc: 0 },
    { id: "ar3", m: 5, n: "Εκδόσεις", q: "viva", col: 3, pc: 101, sh: 2 }
  ] });
  const out = B.mergeBudget(d, d);
  const by = {};
  out.area.forEach((a) => { by[a.id] = a; });
  assert.deepEqual(Object.keys(by.ar1), ["id", "m", "col", "iv", "n", "pc", "q"]);
  assert.equal(by.ar1.iv, "ser-inv ser-x");
  assert.deepEqual(Object.keys(by.ar2), ["id", "m", "col", "n", "q", "sh"]);
  assert.equal(by.ar3.pc, undefined, "a share over 100 is dropped");
  assert.equal(by.ar3.sh, undefined, "sh is 1 or nothing");
  assert.equal(canon(B.mergeBudget(out, out)), canon(out));
});

test("invoiceRows: a payment gets the area of its document's series", () => {
  const doc = { id: "d1", m: 5, kind: "inv", ser: "ser-hx", st: "issued", num: "ΗΧ-1", cur: "EUR", c: { name: "Studio" } };
  const doc2 = Object.assign({}, doc, { id: "d2", ser: "ser-inv" });
  const pay = (id, d) => ({ id, m: 9, doc: d, date: "2026-11-09", amt: 10000, ab: 1 });
  const inv = { ver: 1, docs: [doc, doc2], pays: [pay("p1", "d1"), pay("p2", "d2")] };
  const rows = L.invoiceRows(inv, "EUR", { "ser-hx": "ar1" });
  assert.equal(rows[0].dm, "ar1");
  assert.equal(rows[1].dm, undefined);
  assert.equal(L.invoiceRows(inv, "EUR")[0].dm, undefined, "no map, no area");
  assert.equal(L.invoiceRows(inv, "EUR", { "ser-hx": "BAD ID" })[0].dm, undefined);
  const plan = L.plan({ tx: [], tombs: {} }, "invoices", rows);
  assert.equal(plan.put[0].dm, "ar1");
});

test("areaYear: the year to the month per area, shared costs split by shares", () => {
  const tx = (d, a, k, dm) => ({ id: d + a, m: 1, d, a, k, dm });
  const txs = [
    tx("2026-01-10", 100000, "i", "pub"), tx("2026-03-02", 40000, "o", "pub"),
    tx("2026-02-01", 50000, "i", "snd"),
    tx("2026-02-05", 12001, "o", "sh"), tx("2026-04-05", 1, "i", "sh"),
    tx("2026-12-01", 99999, "i", "pub"),      // after the month
    tx("2025-12-31", 99999, "o", "pub"),      // the year before
    tx("2026-05-01", 700, "o", undefined)
  ];
  const Y = O.areaYear(txs, "2026-11", [{ id: "pub", pc: 50 }, { id: "snd", pc: 25 }, { id: "sh", sh: 1 }, { id: "it" }]);
  assert.equal(Y.from, "2026-01");
  assert.equal(Y.to, "2026-11");
  assert.deepEqual(Y.shared, { id: "sh", inc: 1, out: 12001, cost: 12000 });
  const r = {};
  Y.rows.forEach((x) => { r[x.id] = x; });
  assert.deepEqual(r.pub, { id: "pub", inc: 100000, out: 40000, net: 60000, share: 6000, after: 54000 });
  assert.deepEqual(r.snd, { id: "snd", inc: 50000, out: 0, net: 50000, share: 3000, after: 47000 });
  assert.equal(r.it.share, 0);
  assert.equal(Y.left, 3000);
  assert.deepEqual(Y.none, { inc: 0, out: 700 });
  assert.equal(O.areaYear(txs, "2026-11", [{ id: "pub", pc: 50 }]).shared, null);
});

const series = [{ id: "ser-inv", prefix: "INV", kind: "inv" }, { id: "ser-hx", prefix: "ΗΧ", kind: "inv" }, { id: "ser-rcpt", prefix: "RCT", kind: "rcpt" }];
let n = 0;
const newId = () => "id" + (++n);
const base = () => ({ ver: 1, set: { m: 1, cur: "EUR" }, acc: [], cats: [], area: [], tombs: {},
  tx: [{ id: "t1", m: 1, d: "2026-11-02", a: 500, k: "o", c: "", n: "" }, { id: "l-shop-1", m: 1, d: "2026-11-02", a: 900, k: "i", c: "i-free", n: "", src: "pl" }] });

test("gate budget_areas: make, change, shared costs, shares, remove, undo", () => {
  const r = G.budgetWrite("areas", base(), { areas: [
    { name: "Εκδόσεις", words: "viva, box now", share: 50 },
    { name: "Ηχοληψία", invoice_series: ["ηχ"], share: 30 },
    { name: "Κοινά", words: "telekom", shared_costs: true }
  ] }, 1000, newId, series);
  assert.equal(r.ok, true, r.err);
  const by = {};
  r.data.area.forEach((a) => { by[a.n] = a; });
  assert.equal(by["Ηχοληψία"].iv, "ser-hx");
  assert.equal(by["Κοινά"].sh, 1);
  assert.equal(by["Εκδόσεις"].pc, 50);
  assert.deepEqual(Object.keys(by["Ηχοληψία"]), ["id", "m", "col", "iv", "n", "pc", "q"]);
  assert.notEqual(by["Εκδόσεις"].col, by["Ηχοληψία"].col);
  // what Budget itself would store
  assert.equal(canon(B.mergeBudget(r.data, r.data).area), canon(r.data.area));
  // budget_lines shows the areas
  const lines = G.budgetLines(r.data, { from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(lines.data.areas.map((a) => a.name), ["Εκδόσεις", "Ηχοληψία", "Κοινά"]);
  assert.equal(lines.data.areas[2].shared_costs, true);
  assert.deepEqual(lines.data.areas[1].invoice_series, ["ser-hx"]);
  // checks: shares over 100, unknown series, the shared area's own share, no Invoices
  assert.match(G.budgetWrite("areas", r.data, { areas: [{ name: "Ηχοληψία", share: 51 }] }, 2000, newId, series).err, /101%/);
  assert.match(G.budgetWrite("areas", r.data, { areas: [{ name: "Ηχοληψία", invoice_series: ["ZZ"] }] }, 2000, newId, series).err, /no Invoices series/);
  assert.match(G.budgetWrite("areas", r.data, { areas: [{ name: "Ηχοληψία", invoice_series: ["ser-hx"] }] }, 2000, newId, null).err, /not loaded/);
  assert.match(G.budgetWrite("areas", r.data, { areas: [{ name: "Κοινά", share: 5 }] }, 2000, newId, series).err, /no share of itself/);
  assert.match(G.budgetWrite("areas", r.data, { areas: [{ name: "Κοινά", words: "telekom" }] }, 2000, newId, series).err, /Nothing would change/);
  // moving the shared costs to another area unmarks the first
  const mv = G.budgetWrite("areas", r.data, { areas: [{ name: "εκδόσεις", shared_costs: true }] }, 3000, newId, series);
  assert.equal(mv.ok, true, mv.err);
  assert.deepEqual(mv.data.area.filter((a) => a.sh === 1).map((a) => a.n), ["Εκδόσεις"]);
  assert.equal(mv.data.area.find((a) => a.n === "Εκδόσεις").pc, undefined);
  const back = G.budgetUndo(mv.data, mv.undo, 4000);
  assert.equal(back.n, 2);
  assert.deepEqual(back.data.area.filter((a) => a.sh === 1).map((a) => a.n), ["Κοινά"]);
  // remove, then undo brings it back
  const rm = G.budgetWrite("areas", r.data, { areas: [{ name: "Κοινά", remove: true }] }, 5000, newId, series);
  assert.equal(rm.ok, true);
  assert.equal(rm.data.area.length, 2);
  assert.ok(rm.data.tombs["area:" + by["Κοινά"].id] >= 5000);
  const un = G.budgetUndo(rm.data, rm.undo, 6000);
  assert.equal(un.data.area.length, 3);
  assert.equal(un.data.tombs["area:" + by["Κοινά"].id], undefined);
  assert.equal(canon(B.mergeBudget(un.data, un.data).area.map((a) => a.n).sort()), canon(["Εκδόσεις", "Ηχοληψία", "Κοινά"].sort()));
  // undoing the first change takes the areas away again
  const none = G.budgetUndo(r.data, r.undo, 7000);
  assert.equal(none.data.area.length, 0);
});

test("gate: an entry's area by name; a linked entry takes only an area", () => {
  const r = G.budgetWrite("areas", base(), { areas: [{ name: "Εκδόσεις" }, { name: "Κοινά", shared_costs: true }] }, 1000, newId, series);
  const pub = r.data.area.find((a) => a.n === "Εκδόσεις").id;
  const c = G.budgetWrite("change", r.data, { id: "t1", area: "εκδόσεις" }, 2000, newId);
  assert.equal(c.ok, true, c.err);
  assert.equal(c.data.tx.find((x) => x.id === "t1").dm, pub);
  const lines = G.budgetLines(c.data, { from: "2026-11-01", to: "2026-11-30" });
  assert.equal(lines.data.lines.find((x) => x.id === "t1").area, "Εκδόσεις");
  assert.equal(lines.data.lines.find((x) => x.id === "t1").dm, undefined, "dm is shown as area");
  assert.match(G.budgetWrite("change", r.data, { id: "t1", area: "Nope" }).err || G.budgetWrite("change", r.data, { id: "t1", area: "Nope" }, 2000, newId).err, /Areas: Εκδόσεις, Κοινά/);
  const l = G.budgetWrite("change", r.data, { id: "l-shop-1", area: "Εκδόσεις" }, 2000, newId);
  assert.equal(l.ok, true, l.err);
  assert.equal(G.budgetWrite("change", r.data, { id: "l-shop-1", note: "x" }, 2000, newId).ok, false);
  assert.equal(G.budgetWrite("change", r.data, { id: "l-shop-1", area: "Εκδόσεις", note: "x" }, 2000, newId).ok, false);
  const clr = G.budgetWrite("change", c.data, { id: "t1", area: "" }, 3000, newId);
  assert.equal(clr.data.tx.find((x) => x.id === "t1").dm, undefined);
  const add = G.budgetWrite("add", r.data, { entries: [{ date: "2026-11-05", kind: "expense", amount: "21.00", area: "Κοινά", note: "Telekom" }] }, 2000, newId);
  assert.equal(add.ok, true, add.err);
  assert.equal(add.data.tx.find((x) => x.n === "Telekom").dm, r.data.area.find((a) => a.n === "Κοινά").id);
  assert.match(G.budgetWrite("add", base(), { entries: [{ date: "2026-11-05", kind: "expense", amount: "1", area: "Κοινά" }] }, 2000, newId).err, /no areas yet/);
});

test("app_summary budget: the month per area, and what has none", () => {
  global.window = global.window || {};
  const SUM = require("../assistant/summary.js");
  const d = { set: { cur: "EUR" }, cats: [], tombs: { "area:old": 9 },
    area: [{ id: "b", m: 1, n: "Κοινά", q: "", col: 0, sh: 1 }, { id: "a", m: 1, n: "Εκδόσεις", q: "", col: 1 }, { id: "old", m: 1, n: "Παλιός", q: "", col: 2 }],
    tx: [{ id: "1", m: 1, d: "2026-11-02", a: 10000, k: "i", dm: "a" }, { id: "2", m: 1, d: "2026-11-03", a: 2500, k: "o", dm: "b" },
         { id: "3", m: 1, d: "2026-11-04", a: 300, k: "o", dm: "old" }, { id: "4", m: 1, d: "2026-10-04", a: 300, k: "o", dm: "a" }] };
  const s = SUM.budgetMonth(d, "2026-11", "el");
  assert.deepEqual(s.areas, [
    { name: "Εκδόσεις", income: 100, expenses: 0, net: 100, entries: 1 },
    { name: "Κοινά", income: 0, expenses: 25, net: -25, entries: 1, shared_costs: true }
  ]);
  assert.deepEqual(s.without_area, { income: 0, expenses: 3, entries: 1 });
  assert.equal(SUM.budgetMonth(Object.assign({}, d, { area: [] }), "2026-11", "el").areas, undefined);
});
