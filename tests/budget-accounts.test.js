// AC-GATE (6.04.00, Chris 2026-11-10 «μηδενική απόκλιση καθημερινά»):
// budget_lines lists the accounts with their balances and the bank's,
// and purchases read twice; budget_balances brings accounts to the real
// balance as Budget's own Update balance does, with undo.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const G = require("../gate/gate.js");
const L = require("../budget/loans.js");

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
const budgetBalances = new Function("window", block("  function accBalances(", "  // \"-12,50\"") + "return accBalances;");
const canon = (x) => JSON.stringify(x);

function sample() {
  return Object.assign(B.emptyData(), {
    acc: [
      { id: "alpha", m: 1, n: "Alpha", o: 100000, col: 0, dm: "a1" },
      { id: "card", m: 1, n: "Debit Card", o: 0, col: 1, cys: 5, cyd: 25 },
      { id: "fresh", m: 1, n: "PayPal", o: 1000, col: 2 },
      { id: "viva", m: 1, n: "Viva Business", o: 0, col: 3 }
    ],
    tx: [
      { id: "t1", m: 1, d: "2026-08-08", a: 2890, k: "o", c: "", n: "COSMOTE FIXED TELCO MPAY · Αγορά", ac: "card" },
      { id: "t2", m: 1, d: "2026-08-11", a: 2890, k: "o", c: "", n: "CΟSΜΟΤΕ FΙΧΕD ΤΕLCΟ", ac: "alpha" },
      { id: "t3", m: 1, d: "2026-08-11", a: 390, k: "o", c: "", n: "ΝΕΑ ΟΔΟΣ" },
      { id: "t4", m: 1, d: "2026-08-13", a: 390, k: "o", c: "", n: "NEA ODOS", ac: "alpha" },
      { id: "t5", m: 1, d: "2026-08-12", a: 5200, k: "o", c: "", n: "Lea Primavera", ac: "card" },
      { id: "t6", m: 1, d: "2026-08-14", a: 5200, k: "o", c: "", n: "Skroutz", ac: "alpha" },     // same amount, other shop
      { id: "t7", m: 1, d: "2026-08-20", a: 50000, k: "i", c: "", n: "Πωλήσεις", ac: "viva" },
      { id: "t8", m: 1, d: "2026-08-21", a: 50000, k: "i", c: "", n: "Πωλήσεις", ac: "viva" }      // income: never a pair
    ],
    xfer: [{ id: "x1", m: 1, d: "2026-08-25", a: 20000, f: "viva", t: "alpha", n: "" }],
    adj: [{ id: "j1", m: 1, a: -500, ac: "alpha", d: "2026-08-30", n: "" }],
    loan: [{ id: "l1", m: 1, k: "b", n: "Δάνειο", a: 300000, d: "2026-08-01", ac: "alpha" }],
    lpay: [{ id: "p1", m: 1, l: "l1", a: 10000, d: "2026-08-28", ac: "alpha" }],
    bnk: [{ id: "b1", m: 1, ac: "alpha", bb: 400000, bc: "EUR", bd: "2026-08-31" }, { id: "b2", m: 1, ac: "fresh", src: "pp", bb: 1, bc: "EUR", bd: "2026-08-31" }],
    area: [{ id: "a1", m: 1, col: 0, n: "Εκδόσεις", q: "" }]
  });
}

test("balances: the Gate counts them as Budget does (loans, transfers, corrections)", () => {
  const d = sample();
  ["2026-08-10", "2026-08-31", "2026-11-10"].forEach((day) => {
    const want = budgetBalances({ OrosBudgetLoans: L })(d, day);
    assert.deepEqual(G.accBals(d, L, day), want, day);
  });
  // a deleted entry no longer counts
  const t = JSON.parse(JSON.stringify(d));
  t.tombs["tx:t2"] = 5;
  assert.equal(G.accBals(t, L, "2026-08-31").alpha, G.accBals(d, L, "2026-08-31").alpha + 2890);
});

test("budget_lines: accounts with the bank's difference, and purchases read twice", () => {
  const d = sample();
  const r = G.budgetLines(d, { from: "2026-08-01", to: "2026-08-31" }, L);
  assert.equal(r.ok, true, r.err);
  const al = r.data.accounts.find((a) => a.name === "Alpha");
  const mine = G.accBals(d, L, "2026-08-31").alpha;
  assert.equal(al.balance, (mine / 100).toFixed(2));
  assert.equal(al.area, "Εκδόσεις");
  assert.deepEqual(al.bank, { day: "2026-08-31", balance: "4000.00", budget_that_day: (mine / 100).toFixed(2), difference: ((400000 - mine) / 100).toFixed(2) });
  assert.equal(r.data.accounts.find((a) => a.name === "Debit Card").credit_card, true);
  assert.equal(r.data.accounts.find((a) => a.name === "PayPal").bank, undefined, "PayPal's own balance is left out (as in Budget)");
  assert.deepEqual(r.data.possible_duplicates.map((p) => p.ids), [["t1", "t2"], ["t3", "t4"]]);
  // Greek look-alike letters and Greek words in Latin letters both match
  assert.deepEqual(r.data.possible_duplicates[0].dates, ["2026-08-08", "2026-08-11"]);
  // the same bank line twice is not a pair; nor two lines on one account
  const one = G.dupPairs([
    { id: "a", k: "o", a: 100, d: "2026-01-01", n: "Telekom", ac: "alpha" },
    { id: "b", k: "o", a: 100, d: "2026-01-02", n: "Telekom", ac: "alpha" },
    { id: "c", k: "o", a: 100, d: "2026-01-02", n: "Telekom", fit: "F1" },
    { id: "e", k: "o", a: 100, d: "2026-01-03", n: "Telekom", fit: "F1" },
    { id: "f", k: "o", a: 100, d: "2026-01-09", n: "Telekom" }
  ], 10);
  assert.deepEqual(one.map((p) => p.ids), [["a", "e"], ["b", "c"]], "closest days pair first; f is too far");
});

test("gate budget_balances: a correction on that day or a new start, chk, all or none, undo", () => {
  let n = 0;
  const newId = () => "n" + (++n);
  const d = sample();
  const before = G.accBals(d, L, "2026-11-10");
  const r = G.budgetWrite("bal", d, { accounts: [
    { account: "Alpha", balance: "2770.56", date: "2026-11-10" },
    { account: "paypal", balance: "17,02", date: "2026-11-10" },
    { account: "Debit Card", balance: "-1447.37", date: "2026-11-10" }
  ] }, 1000, newId, undefined, L);
  assert.equal(r.ok, true, r.err);
  const after = G.accBals(r.data, L, "2026-11-10");
  assert.equal(after.alpha, 277056);
  assert.equal(after.fresh, 1702);
  assert.equal(after.card, -144737);
  // PayPal had nothing but a starting balance: that changed, no correction
  const pp = r.data.acc.find((a) => a.id === "fresh");
  assert.equal(pp.o, 1702);
  assert.equal(r.data.adj.filter((j) => j.ac === "fresh").length, 0);
  const ja = r.data.adj.find((j) => j.ac === "alpha" && j.id !== "j1");
  assert.deepEqual(ja, { id: ja.id, m: 1000, a: 277056 - before.alpha, ac: "alpha", d: "2026-11-10", n: "" });
  assert.equal(r.data.acc.find((a) => a.id === "alpha").chk, "2026-11-10");
  // the days before keep their balance
  assert.equal(G.accBals(r.data, L, "2026-11-09").alpha, G.accBals(d, L, "2026-11-09").alpha);
  // what Budget itself stores
  assert.equal(canon(B.mergeBudget(r.data, r.data).acc), canon(r.data.acc));
  assert.equal(canon(B.mergeBudget(r.data, r.data).adj), canon(r.data.adj));
  // again: nothing to do
  const again = G.budgetWrite("bal", r.data, { accounts: [{ account: "Alpha", balance: "2770.56", date: "2026-11-10" }] }, 2000, newId, undefined, L);
  assert.equal(again.ok, false);
  assert.match(again.err, /Nothing would change: Alpha already 2770\.56/);
  // all or none
  const bad = G.budgetWrite("bal", d, { accounts: [{ account: "Alpha", balance: "1", date: "2026-11-10" }, { account: "Nope", balance: "1", date: "2026-11-10" }] }, 2000, newId, undefined, L);
  assert.match(bad.err, /no Budget account "Nope"/);
  assert.match(G.budgetWrite("bal", d, { accounts: [{ account: "Alpha", balance: "1" }] }, 2000, newId).err, /date must be/);
  assert.match(G.budgetWrite("bal", d, { accounts: [{ account: "Alpha", balance: "1.234", date: "2026-11-10" }] }, 2000, newId).err, /balance must be/);
  // undo puts it all back
  const un = G.budgetUndo(r.data, r.undo, 3000);
  assert.equal(un.ok !== false, true);
  assert.deepEqual(G.accBals(un.data, L, "2026-11-10"), before);
  assert.equal(un.data.acc.find((a) => a.id === "alpha").chk, undefined);
  assert.ok(un.data.tombs["adj:" + ja.id] > 0);
});

test("budget_balances is a Budget change the relay may queue", () => {
  assert.ok(G.QUEUED.indexOf("budget_balances") >= 0);
});

test("gate categories (6.05.03): only real built-ins, by id or name; a made-up o-… id is refused", () => {
  let n = 0;
  const newId = () => "n" + (++n);
  const d = sample();
  const add = (category) => G.budgetWrite("add", d, { entries: [{ date: "2026-11-05", kind: "expense", amount: "9.60", category }] }, 1000, newId);
  assert.equal(add("o-trans").data.tx.find((x) => x.d === "2026-11-05").c, "o-trans");
  assert.equal(add("Μεταφορές").data.tx.find((x) => x.d === "2026-11-05").c, "o-trans");
  assert.equal(add("eating out").data.tx.find((x) => x.d === "2026-11-05").c, "o-eat");
  const bad = add("o-transport");
  assert.equal(bad.ok, false);
  assert.match(bad.err, /no expense category "o-transport"\. Categories: .*o-trans \(Transport\)/);
  assert.equal(add("i-salary").ok, false, "an income built-in is not an expense one");
});
