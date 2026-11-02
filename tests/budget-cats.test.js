// Budget subcategories and icons (C4): stored fields, the one-level
// rule, roll-ups for charts and limits, and the icon set.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

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
  "\nreturn { normCat, mergeBudget, emptyData, categoryList, parentMap, rollUp, withKids, rollTx, totals, SEED_IC, SEED_NAMES };")();
const ICONS = require("../budget/caticons.js");
const G = require("../budget/budgets.js");

const canon = (x) => JSON.stringify(x);
function D(parts) { return Object.assign(B.emptyData(), parts || {}); }
const names = () => B.SEED_NAMES.en;

test("a category keeps ic and p only when valid, in name order after the known fields", () => {
  const c = B.normCat({ id: "u1", m: 2, k: "o", name: "Coffee", col: 1, p: "o-eat", ic: "coffee", zz: 1 });
  assert.deepEqual(Object.keys(c), ["id", "m", "k", "name", "col", "ic", "p", "zz"]);
  const bad = B.normCat({ id: "u1", m: 2, k: "o", name: "Coffee", col: 1, p: "u1", ic: "Bad Icon!" });
  assert.equal("p" in bad, false);
  assert.equal("ic" in bad, false);
  assert.equal("p" in B.normCat({ id: "u1", m: 2, k: "o", name: "x", col: 1, p: "BAD" }), false);
});

test("an older version (fields as extras) and this one write the same JSON", () => {
  const x = { id: "u1", m: 2, k: "o", name: "Coffee", col: 1, p: "o-eat", ic: "coffee" };
  // what an older Budget writes: known fields, then every extra in name order
  const old = { id: "u1", m: 2, k: "o", name: "Coffee", col: 1, ic: "coffee", p: "o-eat" };
  assert.equal(canon(B.normCat(x)), canon(old));
  const a = D({ cats: [x] }), b = D({ cats: [old] });
  assert.equal(canon(B.mergeBudget(a, b)), canon(B.mergeBudget(b, a)));
});

test("one level: a subcategory needs a live main category of the same kind", () => {
  const d = D({ cats: [
    { id: "u1", m: 1, k: "o", name: "Coffee", col: 1, p: "o-eat" },
    { id: "u2", m: 1, k: "o", name: "Bakery", col: 1, p: "o-eat" },
    { id: "u3", m: 1, k: "o", name: "Espresso", col: 1, p: "u1" },      // under a subcategory: main again
    { id: "u4", m: 1, k: "o", name: "Wrong kind", col: 1, p: "i-salary" },
    { id: "u5", m: 1, k: "o", name: "Orphan", col: 1, p: "gone" }
  ] });
  const list = B.categoryList(d, names());
  const by = Object.fromEntries(list.map((c) => [c.id, c]));
  assert.equal(by.u1.p, "o-eat");
  assert.equal(by.u2.p, "o-eat");
  assert.equal(by.u3.p, "");
  assert.equal(by.u4.p, "");
  assert.equal(by.u5.p, "");
  // subcategories follow their main category, by name
  const ids = list.map((c) => c.id);
  const i = ids.indexOf("o-eat");
  assert.deepEqual(ids.slice(i, i + 3), ["o-eat", "u2", "u1"]);
  // a deleted main category frees its subcategories, the stored p stays
  const gone = D({ cats: d.cats, tombs: { "cat:o-eat": 5 } });
  assert.equal(B.categoryList(gone, names()).find((c) => c.id === "u1").p, "");
  assert.equal(gone.cats[0].p, "o-eat");
});

test("ready categories have an icon until another (or none) is picked", () => {
  const list = B.categoryList(B.emptyData(), names());
  list.forEach((c) => assert.ok(ICONS.has(c.ic), c.id + " " + c.ic));
  const d = D({ cats: [{ id: "o-groc", m: 1, k: "o", name: "", col: 0, ic: "basket" }, { id: "o-eat", m: 1, k: "o", name: "", col: 1, ic: "none" }] });
  const l2 = B.categoryList(d, names());
  assert.equal(l2.find((c) => c.id === "o-groc").ic, "basket");
  assert.equal(l2.find((c) => c.id === "o-eat").ic, "none");
  assert.equal(ICONS.svg("none"), "");
  Object.keys(B.SEED_IC).forEach((id) => assert.ok(ICONS.has(B.SEED_IC[id]), id));
});

test("roll-ups: charts count each amount once, limits count subcategories in the main one", () => {
  const pm = { u1: "o-eat", u2: "o-eat" };
  const byCat = { "o:o-eat": 1000, "o:u1": 300, "o:u2": 200, "o:o-groc": 50, "i:i-salary": 9000 };
  assert.deepEqual(B.rollUp(byCat, pm), { "o:o-eat": 1500, "o:o-groc": 50, "i:i-salary": 9000 });
  assert.deepEqual(B.withKids(byCat, pm), { "o:o-eat": 1500, "o:u1": 300, "o:u2": 200, "o:o-groc": 50, "i:i-salary": 9000 });
  const txs = [{ id: "a", c: "u1", a: 1, k: "o", d: "2026-11-01" }, { id: "b", c: "o-groc", a: 2, k: "o", d: "2026-11-01" }, { id: "c", c: "", a: 3, k: "o", d: "2026-11-01" }];
  const r = B.rollTx(txs, pm);
  assert.deepEqual(r[0], { id: "a", c: "o-eat", sc: "u1", a: 1, k: "o", d: "2026-11-01" });
  assert.equal(r[1], txs[1]);
  assert.equal(r[2], txs[2]);
  assert.equal(txs[0].c, "u1");      // the entries themselves never change
  assert.deepEqual(B.parentMap([{ id: "x", p: "" }, { id: "y", p: "x" }]), { y: "x" });
});

test("a flexible budget on a main category counts its subcategories; on a subcategory only that one", () => {
  const pm = { u1: "o-eat" };
  const txs = B.rollTx([
    { id: "a", c: "u1", a: 300, k: "o", d: "2026-11-02" },
    { id: "b", c: "o-eat", a: 1000, k: "o", d: "2026-11-02" },
    { id: "c", c: "o-groc", a: 50, k: "o", d: "2026-11-02" }
  ], pm);
  assert.equal(G.spent({ cs: "o-eat", as: "" }, txs, "2026-11-01", "2026-11-30"), 1300);
  assert.equal(G.spent({ cs: "u1", as: "" }, txs, "2026-11-01", "2026-11-30"), 300);
  assert.equal(G.spent({ cs: "", as: "" }, txs, "2026-11-01", "2026-11-30"), 1350);
});

test("icon set: about 60 distinct ids, each a single safe path", () => {
  assert.ok(ICONS.ids.length >= 60, String(ICONS.ids.length));
  assert.equal(new Set(ICONS.ids).size, ICONS.ids.length);
  ICONS.ids.forEach((id) => {
    assert.match(id, /^[a-z0-9-]{1,24}$/);
    const svg = ICONS.svg(id);
    assert.match(svg, /^<svg [^<]*><path d="[-0-9MmLlHhVvCcSsQqTtAaZz .,]+"\/><\/svg>$/, id);
  });
  assert.equal(ICONS.svg("constructor"), "");
  assert.equal(ICONS.svg("__proto__"), "");
});
