// AR-VIEW (6.03.00, Chris 2026-11-09 «Ενιαία οικονομικά στο Budget»,
// cards «Ναι, σε δύο PR» and «Τομέας ανά λογαριασμό»): a personal area,
// an account's area, the whole picture (business after the shared
// costs, personal, total, money taken out for personal use) and the
// gate's `personal` on budget_areas.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

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

test("areas: ps 1 is kept in key order, never on the shared area; accounts keep their area", () => {
  const d = Object.assign(B.emptyData(), {
    area: [
      { id: "a1", m: 1, col: 0, n: "Προσωπικά", q: "efood", ps: 1, pc: 0 },
      { id: "a2", m: 1, col: 1, n: "Κοινά", q: "", sh: 1, ps: 1 },
      { id: "a3", m: 1, col: 2, n: "Εκδόσεις", q: "", ps: 2 }
    ],
    acc: [{ id: "alpha", m: 1, n: "Alpha", o: 0, col: 0, dm: "a1" }, { id: "viva", m: 1, n: "Viva", o: 0, col: 1, dm: "BAD ID" }]
  });
  const out = B.mergeBudget(d, d);
  const by = {};
  out.area.forEach((a) => { by[a.id] = a; });
  assert.deepEqual(Object.keys(by.a1), ["id", "m", "col", "n", "ps", "q"]);
  assert.equal(by.a2.ps, undefined, "the shared area is never personal");
  assert.equal(by.a3.ps, undefined);
  assert.equal(out.acc.find((a) => a.id === "alpha").dm, "a1");
  assert.equal(out.acc.find((a) => a.id === "viva").dm, undefined);
  assert.equal(canon(B.mergeBudget(out, out)), canon(out));
});

test("wholeYear: business after the shared costs, personal, none, total and draws", () => {
  const areas = [
    { id: "pub", n: "Εκδόσεις", pc: 50 }, { id: "snd", n: "Ηχοληψία", pc: 50 },
    { id: "sh", n: "Κοινά", sh: 1 }, { id: "me", n: "Προσωπικά", ps: 1 }
  ];
  const tx = [
    { id: "1", d: "2026-03-02", a: 100000, k: "i", dm: "pub" },
    { id: "2", d: "2026-03-03", a: 30000, k: "o", dm: "pub" },
    { id: "3", d: "2026-04-01", a: 50000, k: "i", dm: "snd" },
    { id: "4", d: "2026-04-02", a: 10000, k: "o", dm: "sh" },
    { id: "5", d: "2026-05-01", a: 20000, k: "o", dm: "me" },
    { id: "6", d: "2026-05-02", a: 500, k: "o" },
    { id: "7", d: "2025-12-31", a: 99999, k: "i", dm: "pub" },     // last year
    { id: "8", d: "2026-12-01", a: 99999, k: "i", dm: "pub" }      // after the month
  ];
  const accs = [{ id: "viva", dm: "pub" }, { id: "alpha", dm: "me" }, { id: "cash" }];
  const xf = [
    { id: "x1", d: "2026-05-10", a: 40000, f: "viva", t: "alpha" },
    { id: "x2", d: "2026-06-10", a: 5000, f: "alpha", t: "viva" },
    { id: "x3", d: "2026-06-11", a: 7000, f: "cash", t: "alpha" },     // cash has no area: neither
    { id: "x4", d: "2027-01-01", a: 1, f: "viva", t: "alpha" }
  ];
  const W = O.wholeYear(tx, xf, accs, "2026-11", areas);
  assert.equal(W.from, "2026-01");
  assert.equal(W.to, "2026-11");
  assert.deepEqual(W.business, { inc: 150000, out: 40000, net: 120000, shared: 10000, after: 110000 });
  assert.deepEqual(W.personal, { inc: 0, out: 20000, net: -20000 });
  assert.deepEqual(W.none, { inc: 0, out: 500, net: -500 });
  assert.equal(W.total, 110000 - 20000 - 500);
  assert.equal(W.total, 150000 - 40000 - 20000 - 500, "= all income − all expenses");
  assert.equal(W.draws, 40000);
  assert.equal(W.back, 5000);
  // without a shared area the business result is its net
  const W2 = O.wholeYear(tx, [], [], "2026-11", areas.filter((a) => a.id !== "sh"));
  assert.equal(W2.business.shared, 0);
  assert.equal(W2.business.after, 120000);
});

test("gate budget_areas: personal, and what it may not be", () => {
  let n = 0;
  const newId = () => "n" + (++n);
  const d = Object.assign(B.emptyData(), { area: [
    { id: "a1", m: 1, col: 0, n: "Εκδόσεις", pc: 30, q: "" },
    { id: "a2", m: 1, col: 1, n: "Κοινά", q: "", sh: 1 },
    { id: "a3", m: 1, col: 2, n: "Προσωπικά", pc: 10, q: "" }
  ] });
  const r = G.budgetWrite("areas", d, { areas: [{ name: "Προσωπικά", personal: true }] }, 1000, newId, []);
  assert.equal(r.ok, true, r.err);
  const me = r.data.area.find((a) => a.id === "a3");
  assert.equal(me.ps, 1);
  assert.equal(me.pc, undefined, "a personal area takes no share");
  assert.deepEqual(Object.keys(me), ["id", "m", "col", "n", "ps", "q"]);
  assert.equal(canon(B.mergeBudget(r.data, r.data).area), canon(r.data.area), "what Budget itself stores");
  const lines = G.budgetLines(r.data, { from: "2026-11-01", to: "2026-11-30" });
  assert.equal(lines.data.areas.find((a) => a.name === "Προσωπικά").personal, true);
  assert.match(G.budgetWrite("areas", r.data, { areas: [{ name: "Προσωπικά", share: 5 }] }, 2000, newId, []).err, /personal area has no share/);
  assert.match(G.budgetWrite("areas", r.data, { areas: [{ name: "Κοινά", personal: true }] }, 2000, newId, []).err, /can't be personal/);
  // moving the shared mark onto it drops personal
  const mv = G.budgetWrite("areas", r.data, { areas: [{ name: "Προσωπικά", shared_costs: true }] }, 2000, newId, []);
  assert.equal(mv.ok, true, mv.err);
  assert.equal(mv.data.area.find((a) => a.id === "a3").ps, undefined);
  const off = G.budgetWrite("areas", r.data, { areas: [{ name: "Προσωπικά", personal: false }] }, 3000, newId, []);
  assert.equal(off.data.area.find((a) => a.id === "a3").ps, undefined);
  const un = G.budgetUndo(r.data, r.undo, 4000);
  assert.equal(un.data.area.find((a) => a.id === "a3").pc, 10);
});
