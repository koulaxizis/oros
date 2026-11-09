// AR-CAT + AR-XF (6.02.00, Chris 2026-11-09 «Ενιαία οικονομικά στο
// Budget», card «Ναι, σε δύο PR»): categories belong to an area (a
// subcategory follows its main one), entries that are money moved
// between own accounts become transfers, and the gate reads and changes
// categories (budget_categories) and makes transfers (budget_transfer),
// each with undo.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

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
  "\nreturn { mergeBudget, emptyData, normCat, categoryList, SEED_NAMES, canXfer, xferTwins };")();
const canon = (x) => JSON.stringify(x);
let seq = 0;
const newId = () => "n" + (++seq);

function base() {
  return Object.assign(B.emptyData(), {
    acc: [{ id: "alpha", m: 1, n: "Alpha", o: 0, col: 0 }, { id: "viva", m: 1, n: "Viva Business", o: 0, col: 1 }],
    area: [{ id: "a1", m: 1, col: 0, n: "Εκδόσεις", q: "" }, { id: "a2", m: 1, col: 1, n: "Προσωπικά", q: "" }],
    cats: [{ id: "u1", m: 1, k: "o", name: "Εκτύπωση", col: 0 }],
    tx: [
      { id: "t1", m: 1, d: "2026-11-02", a: 35174, k: "i", c: "", n: "Sent from Viva.com", ac: "alpha" },
      { id: "t2", m: 1, d: "2026-11-01", a: 35174, k: "o", c: "", n: "Payout", ac: "viva" },
      { id: "t3", m: 1, d: "2026-11-03", a: 1200, k: "o", c: "u1", n: "Τυπογραφείο", ac: "alpha" },
      { id: "t4", m: 1, d: "2026-10-20", a: 35174, k: "o", c: "", n: "too early", ac: "viva" },
      { id: "l-shop-1", m: 1, d: "2026-11-02", a: 500, k: "i", c: "", n: "order", ac: "alpha" }
    ]
  });
}

test("categories: dm is kept as an area id, cleaned otherwise, and a subcategory follows its main one", () => {
  const ok = B.normCat({ id: "u1", m: 1, k: "o", name: "Εκτύπωση", col: 0, dm: "a1" });
  assert.deepEqual(Object.keys(ok), ["id", "m", "k", "name", "col", "dm"]);
  assert.equal(B.normCat({ id: "u1", m: 1, k: "o", name: "X", col: 0, dm: "BAD ID" }).dm, undefined);
  const d = Object.assign(B.emptyData(), { cats: [
    { id: "u1", m: 1, k: "o", name: "Εκτύπωση", col: 0, dm: "a1" },
    { id: "u2", m: 1, k: "o", name: "Χαρτί", col: 1, p: "u1", dm: "a2" },
    { id: "u3", m: 1, k: "o", name: "Καφές", col: 2 }
  ] });
  const list = B.categoryList(d, B.SEED_NAMES.en);
  const by = {};
  list.forEach((c) => { by[c.id] = c; });
  assert.equal(by.u1.dm, "a1");
  assert.equal(by.u2.dm, "a1", "a subcategory takes its main category's area, not its own");
  assert.equal(by.u3.dm, undefined);
  assert.ok(list.filter((c) => c.seed).every((c) => c.dm === undefined), "ready categories have no area");
  // merge keeps it byte for byte
  assert.equal(canon(B.mergeBudget(d, d).cats), canon(B.mergeBudget(B.mergeBudget(d, d), d).cats));
});

test("transfers: which entries may become one, and their other side", () => {
  const d = base();
  const t1 = d.tx.find((x) => x.id === "t1");
  assert.equal(B.canXfer(t1), true);
  assert.equal(B.canXfer(d.tx.find((x) => x.id === "l-shop-1")), false, "not from another app or a shop");
  assert.equal(B.canXfer(Object.assign({}, t1, { rc: "r.jpg" })), false, "not with receipts");
  assert.equal(B.canXfer(Object.assign({}, t1, { oc: "USD", oa: 100 })), false, "not in another currency");
  assert.deepEqual(B.xferTwins(d.tx, t1, "viva").map((x) => x.id), ["t2"], "opposite kind, same amount, ≤ 5 days");
  assert.deepEqual(B.xferTwins(d.tx, t1, "alpha"), []);
  assert.deepEqual(B.xferTwins(d.tx, t1, ""), []);
});

test("gate budget_categories: make with an area and a main one, rename, remove, checks, undo", () => {
  seq = 0;
  const r = G.budgetWrite("cats", base(), { categories: [
    { name: "Πωλήσεις", kind: "income", area: "εκδόσεις" },
    { name: "Δημιουργοί", kind: "expense", area: "Εκδόσεις" },
    { name: "Εικονογράφηση", kind: "expense", main: "Δημιουργοί" },
    { name: "Εκτύπωση", kind: "expense", area: "Εκδόσεις" }
  ] }, 1000, newId);
  assert.equal(r.ok, true, r.err);
  const by = {};
  r.data.cats.forEach((c) => { by[c.name] = c; });
  assert.equal(by["Πωλήσεις"].k, "i");
  assert.equal(by["Πωλήσεις"].dm, "a1");
  assert.equal(by["Εικονογράφηση"].p, by["Δημιουργοί"].id);
  assert.equal(by["Εκτύπωση"].id, "u1", "an existing one is changed, not doubled");
  assert.equal(by["Εκτύπωση"].dm, "a1");
  assert.ok(/^u/.test(by["Δημιουργοί"].id));
  assert.deepEqual(Object.keys(by["Εικονογράφηση"]), ["id", "m", "k", "name", "col", "p"]);
  // what Budget itself stores
  assert.equal(canon(B.mergeBudget(r.data, r.data).cats), canon(r.data.cats));
  // budget_lines lists them
  const lines = G.budgetLines(r.data, { from: "2026-11-01", to: "2026-11-30" });
  const cl = {};
  lines.data.categories.forEach((c) => { cl[c.name] = c; });
  assert.deepEqual(cl["Εικονογράφηση"], { name: "Εικονογράφηση", kind: "expense", main: "Δημιουργοί", area: "Εκδόσεις" });
  assert.deepEqual(cl["Πωλήσεις"], { name: "Πωλήσεις", kind: "income", area: "Εκδόσεις" });
  assert.equal(lines.data.categories[0].kind, "expense");
  // checks
  assert.match(G.budgetWrite("cats", r.data, { categories: [{ name: "Χ", kind: "expense", area: "Nope" }] }, 2000, newId).err, /Areas: Εκδόσεις, Προσωπικά/);
  assert.match(G.budgetWrite("cats", r.data, { categories: [{ name: "Εικονογράφηση", kind: "expense", area: "Εκδόσεις" }] }, 2000, newId).err, /main category's area/);
  assert.match(G.budgetWrite("cats", r.data, { categories: [{ name: "Χ", kind: "expense", main: "Εικονογράφηση" }] }, 2000, newId).err, /one level/);
  assert.match(G.budgetWrite("cats", r.data, { categories: [{ name: "Δημιουργοί", kind: "expense", main: "Εκτύπωση" }] }, 2000, newId).err, /has subcategories/);
  assert.match(G.budgetWrite("cats", r.data, { categories: [{ name: "Εκτύπωση", kind: "expense", remove: true }] }, 2000, newId).err, /1 entry uses/);
  assert.match(G.budgetWrite("cats", r.data, { categories: [{ name: "Δημιουργοί", kind: "expense", remove: true }] }, 2000, newId).err, /has subcategories/);
  assert.match(G.budgetWrite("cats", r.data, { categories: [{ name: "Πωλήσεις", kind: "income", area: "Εκδόσεις" }] }, 2000, newId).err, /Nothing would change/);
  assert.match(G.budgetWrite("cats", r.data, { categories: [{ name: "Πωλήσεις", kind: "income", rename: "Εκτύπωση" }] }, 2000, newId).ok ? "" : "x", /^$/, "names are per kind");
  assert.match(G.budgetWrite("cats", r.data, { categories: [{ name: "Δημιουργοί", kind: "expense", rename: "Εκτύπωση" }] }, 2000, newId).err, /exists already/);
  // remove an unused one, undo brings it back
  const rm = G.budgetWrite("cats", r.data, { categories: [{ name: "Εικονογράφηση", kind: "expense", remove: true }] }, 3000, newId);
  assert.equal(rm.ok, true, rm.err);
  const gid = by["Εικονογράφηση"].id;
  assert.ok(rm.data.tombs["cat:" + gid] >= 3000);
  const un = G.budgetUndo(rm.data, rm.undo, 4000);
  assert.equal(un.n, 1);
  assert.ok(un.data.cats.some((c) => c.id === gid));
  assert.equal(un.data.tombs["cat:" + gid], undefined);
  // undoing the first change: the new ones go, Εκτύπωση loses its area
  const none = G.budgetUndo(r.data, r.undo, 5000);
  assert.deepEqual(none.data.cats.filter((c) => !none.data.tombs["cat:" + c.id]).map((c) => c.name), ["Εκτύπωση"]);
  assert.equal(none.data.cats[0].dm, undefined);
});

test("gate budget_transfer: an entry (and its other side) becomes one transfer, with undo", () => {
  seq = 0;
  const d = base();
  const r = G.budgetWrite("xfer", d, { id: "t1", other_account: "viva business", other_id: "t2" }, 1000, newId);
  assert.equal(r.ok, true, r.err);
  assert.equal(r.data.xfer.length, 1);
  const x = r.data.xfer[0];
  assert.deepEqual(Object.keys(x), ["id", "m", "d", "a", "f", "t", "n"]);
  assert.equal(x.f, "viva");
  assert.equal(x.t, "alpha", "an income comes from the other account");
  assert.equal(x.a, 35174);
  assert.equal(x.d, "2026-11-02");
  assert.ok(!r.data.tx.some((y) => y.id === "t1" || y.id === "t2"));
  assert.ok(r.data.tombs["tx:t1"] >= 1000 && r.data.tombs["tx:t2"] >= 1000);
  assert.equal(canon(B.mergeBudget(r.data, r.data).xfer), canon(r.data.xfer), "what Budget itself stores");
  assert.deepEqual(r.ids, [x.id, "t1", "t2"]);
  // an expense goes from the entry's account
  const e = G.budgetWrite("xfer", d, { id: "t2", other_account: "Alpha" }, 1000, newId);
  assert.equal(e.data.xfer[0].f, "viva");
  assert.equal(e.data.xfer[0].t, "alpha");
  assert.ok(e.data.tx.some((y) => y.id === "t1"), "without other_id the other side stays");
  // checks
  assert.match(G.budgetWrite("xfer", d, { id: "l-shop-1", other_account: "viva" }, 1000, newId).err, /another app or a shop/);
  assert.match(G.budgetWrite("xfer", d, { id: "t1", other_account: "alpha" }, 1000, newId).err, /own account/);
  assert.match(G.budgetWrite("xfer", d, { id: "t1", other_account: "Nope" }, 1000, newId).err, /Accounts: Alpha, Viva Business/);
  assert.match(G.budgetWrite("xfer", d, { id: "t1", other_account: "viva", other_id: "t4" }, 1000, newId).err, /not the other side/);
  assert.match(G.budgetWrite("xfer", d, { id: "t1", other_account: "viva", other_id: "t3" }, 1000, newId).err, /not the other side/);
  const noAc = base();
  delete noAc.tx[0].ac;
  assert.match(G.budgetWrite("xfer", noAc, { id: "t1", other_account: "viva" }, 1000, newId).err, /no Budget account/);
  const usd = base();
  usd.acc[1].cur = "USD";
  assert.match(G.budgetWrite("xfer", usd, { id: "t1", other_account: "viva" }, 1000, newId).err, /different currencies/);
  // undo: the transfer goes, both entries come back
  const un = G.budgetUndo(r.data, r.undo, 2000);
  assert.equal(un.n, 3);
  assert.ok(un.data.tombs["xfer:" + x.id] >= 2000);
  assert.ok(!un.data.xfer.some((y) => y.id === x.id));
  assert.deepEqual(un.data.tx.filter((y) => y.id === "t1" || y.id === "t2").map((y) => y.id).sort(), ["t1", "t2"]);
  assert.equal(un.data.tombs["tx:t1"], undefined);
});
