// Budget loans and debts (C5): stored shape, status, what is owed,
// and how loans move account balances.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const L = require("../budget/loans.js");

const loan = (x) => Object.assign({ id: "l1", m: 1, a: 10000, ac: "bank", crm: "", d: "2026-10-01", due: "", k: "l", n: "Nikos", nt: "", wo: false }, x || {});
const pay = (x) => Object.assign({ id: "p1", m: 1, a: 2500, ac: "bank", d: "2026-10-10", l: "l1", n: "" }, x || {});

test("a loan and a repayment keep every field, in name order after id and m", () => {
  const l = L.normLoan(loan({ zz: 1, n: "  Nikos  ", due: "2026-12-01" }));
  assert.deepEqual(Object.keys(l), ["id", "m", "a", "ac", "crm", "d", "due", "k", "n", "nt", "wo"]);
  assert.equal(l.n, "Nikos");
  assert.deepEqual(Object.keys(L.normPay(pay())), ["id", "m", "a", "ac", "d", "l", "n"]);
  // keys in name order: what an older version writes for an unknown collection
  const k = Object.keys(l).slice(2);
  assert.deepEqual(k, k.slice().sort());
  [{ k: "x" }, { n: " " }, { a: 0 }, { d: "2026-02-30" }, { id: "BAD" }].forEach((bad) =>
    assert.equal(L.normLoan(loan(bad)), null, JSON.stringify(bad)));
  assert.equal(L.normLoan(loan({ due: "2026-09-01" })).due, "");      // before the date: dropped
  assert.equal(L.normLoan(loan({ wo: "yes" })).wo, false);
  assert.equal(L.normLoan(loan({ crm: "bad id!" })).crm, "");
  assert.equal(L.normPay(pay({ l: "" })), null);
});

test("status: paid, left, late, written off", () => {
  const l = loan({ due: "2026-11-01" });
  let s = L.status(l, [pay(), pay({ id: "p2", a: 2500, d: "2026-10-20" })], "2026-10-25");
  assert.deepEqual(s, { paid: 5000, left: 5000, over: 0, pct: 50, state: "open", last: "2026-10-20", int: 0, prin: 5000 });
  assert.equal(L.status(l, [], "2026-11-02").state, "late");
  assert.equal(L.status(l, [pay({ a: 12000 })], "2026-11-02").state, "paid");
  assert.equal(L.status(l, [pay({ a: 12000 })], "2026-11-02").over, 2000);
  assert.equal(L.status(loan({ wo: true }), [], "2026-11-02").state, "off");
});

test("summary: what is owed to you and what you owe, open loans only", () => {
  const loans = [loan(), loan({ id: "l2", k: "b", a: 3000, n: "Bank of mum" }), loan({ id: "l3", wo: true }), loan({ id: "l4", a: 100 })];
  const pays = [pay(), pay({ id: "p9", l: "l4", a: 100 })];
  assert.deepEqual(L.summary(loans, pays, "2026-11-02"), { toMe: 7500, byMe: 3000, nToMe: 1, nByMe: 1 });
});

test("balances: a loan is like a transfer to or from the person", () => {
  const loans = [loan(), loan({ id: "l2", k: "b", a: 3000, ac: "cash", d: "2026-10-05" }), loan({ id: "l3", ac: "" })];
  const pays = [pay(), pay({ id: "p2", l: "l2", a: 1000, ac: "bank", d: "2026-10-06" }), pay({ id: "p3", l: "gone" })];
  assert.deepEqual(L.balanceMoves(loans, pays, "2026-10-31"), { bank: -10000 + 2500 - 1000, cash: 3000 });
  assert.deepEqual(L.balanceMoves(loans, pays, "2026-10-01"), { bank: -10000 });
  assert.deepEqual(L.balanceMoves(undefined, undefined, "2026-10-31"), {});
});

test("budget.js: loans move account balances; without loans.js they ride along", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "budget/budget.js"), "utf8");
  const block = (from, to) => { const i = src.indexOf(from), j = src.indexOf(to, i); return src.slice(i, j); };
  const body = block("  var STORAGE_KEY", "  // ---------- 1.") + block("  function cmpStr(", "  function newId(") +
    block("  // ---------- 2. Money", "  // ---------- 6. Storage") + "\nreturn { mergeBudget, emptyData, accBalances };";
  const NEW = new Function("window", body)({ OrosBudgetLoans: L });
  const OLD = new Function("window", body)(undefined);
  const d = Object.assign(NEW.emptyData(), { acc: [{ id: "bank", m: 1, n: "Bank", o: 50000, col: 0 }], loan: [loan()], lpay: [pay()] });
  const merged = NEW.mergeBudget(d, NEW.emptyData());
  assert.deepEqual(NEW.accBalances(merged, "2026-11-02"), { bank: 50000 - 10000 + 2500 });
  // an older copy (no loans.js) writes the same JSON for the loan collections
  const old = OLD.mergeBudget(d, OLD.emptyData());
  assert.equal(JSON.stringify(old.loan), JSON.stringify(merged.loan));
  assert.equal(JSON.stringify(old.lpay), JSON.stringify(merged.lpay));
  assert.equal(JSON.stringify(NEW.mergeBudget(old, merged)), JSON.stringify(NEW.mergeBudget(merged, old)));
  // a deleted loan stays deleted
  const del = Object.assign(NEW.emptyData(), { tombs: { "loan:l1": 5 } });
  assert.deepEqual(NEW.mergeBudget(merged, del).loan, []);
});

test("LN-I: interest, installment, split and schedule", () => {
  const l = L.normLoan(loan({ k: "b", a: 1000000, d: "2026-01-15", nm: 120, r: 475 }));
  const k = Object.keys(l).slice(2);
  assert.deepEqual(k, k.slice().sort());                         // still in name order
  assert.deepEqual(Object.keys(l), ["id", "m", "a", "ac", "crm", "d", "due", "ins", "k", "n", "nm", "nt", "r", "wo"]);
  assert.equal(L.installment(l), 10485);                          // 10,000 at 4.75 % over 10 years
  assert.equal(L.installment(Object.assign({}, l, { ins: 11000 })), 11000);
  assert.equal(L.installment(Object.assign({}, l, { r: 0 })), 8334);
  assert.equal(L.installment(loan()), 0);
  assert.equal(L.normLoan(loan({ nm: 0, r: 475, ins: 5 })).r, undefined);   // no plan: nothing kept
  assert.equal(L.normLoan(loan({ nm: 12, r: -1 })).r, 0);
  const ps = [pay({ id: "p1", a: 10485, d: "2026-02-15" }), pay({ id: "p2", a: 10485, d: "2026-03-15" })];
  const st = L.status(l, ps, "2026-04-01");
  assert.equal(st.int, 3958 + 3932);
  assert.equal(st.prin + st.int, st.paid);
  assert.equal(st.left, 1000000 - st.prin);
  // a skipped month: two months of interest on the next repayment; a second one that month is all principal
  const sk = L.split(l, [pay({ id: "q1", a: 10485, d: "2026-03-10" }), pay({ id: "q2", a: 5000, d: "2026-03-20" })]);
  assert.equal(sk.rows[0].int, Math.round(1000000 * (Math.pow(1 + 0.0475 / 12, 2) - 1)));
  assert.equal(sk.rows[1].int, 0);
  const sc = L.schedule(l, ps);
  assert.equal(sc.rows.length, 118);
  assert.equal(sc.rows[0].d, "2026-04-15");
  assert.equal(sc.end, "2036-01-15");
  assert.equal(sc.rows[sc.rows.length - 1].bal, 0);
  assert.equal(L.schedule(Object.assign({}, l, { ins: 3000 }), []).never, true);   // less than the interest
  // the loan is paid when the principal is: interest does not count towards it
  const done = L.status(Object.assign({}, l, { a: 10000, nm: 1 }), [pay({ a: 10040, d: "2026-02-15" })], "2026-03-01");
  assert.equal(done.state, "paid");
  assert.equal(done.int, 40);
});

test("loansui: EN and EL have the same keys and every key in the code exists", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "budget/loansui.js"), "utf8");
  const tables = new Function("root", "var A = { lang: 'en' };" + src.slice(src.indexOf("var S = {"), src.indexOf("// orosI18n")) + "return S;")({});
  assert.deepEqual(Object.keys(tables.en).sort(), Object.keys(tables.el).sort());
  const used = [...src.matchAll(/t\("(ln\.[A-Za-z.]+)"\s*[,)]/g)].map((m) => m[1]);
  used.forEach((k) => assert.ok(k in tables.en, k));
});

test("CC-1: a credit card's cycle, what is left and the interest estimate", () => {
  assert.equal(L.cardCfg({ cys: 10 }), null);
  assert.deepEqual(L.cardCfg({ cys: 10, cyd: 5, cyr: 1650 }), { s: 10, d: 5, r: 1650 });
  assert.deepEqual(L.cardCfg({ cys: 31, cyd: 20, cyr: -1 }), { s: 31, d: 20, r: 0 });
  const acc = { cys: 10, cyd: 5, cyr: 1825 };           // statement on the 10th, due the 5th of the next month, 18.25 %
  const bal = { "2026-10-10": -100000, "2026-09-10": 0, "2026-11-10": -50000 };
  const balAt = (d) => bal[d] === undefined ? 0 : bal[d];
  let inflowArgs = null;
  const inflow = (from, to) => { inflowArgs = [from, to]; return 30000; };
  const c = L.cardCycle(acc, "2026-10-25", balAt, inflow);
  assert.deepEqual(inflowArgs, ["2026-10-10", "2026-10-25"]);
  assert.equal(c.s, "2026-10-10");
  assert.equal(c.due, "2026-11-05");
  assert.equal(c.next, "2026-11-10");
  assert.equal(c.stmt, 100000);
  assert.equal(c.paid, 30000);
  assert.equal(c.left, 70000);
  assert.equal(c.est, Math.round(70000 * 0.1825 * 31 / 365));   // 1085
  assert.equal(c.days, 11);
  assert.equal(c.state, "open");
  // before this month's statement day: the previous cycle
  const e = L.cardCycle(acc, "2026-10-09", balAt, () => 0);
  assert.equal(e.s, "2026-09-10");
  assert.equal(e.state, "none");
  // late, paid
  assert.equal(L.cardCycle(acc, "2026-11-07", balAt, () => 0).state, "late");
  assert.equal(L.cardCycle(acc, "2026-11-07", balAt, () => 200000).state, "paid");
  assert.equal(L.cardCycle(acc, "2026-11-07", balAt, () => 200000).paid, 100000);
  // a due day after the statement day falls in the same month; month ends clamp
  const f = L.cardCycle({ cys: 31, cyd: 28 }, "2027-02-15", () => -1000, () => 0);
  assert.equal(f.s, "2027-01-31");
  assert.equal(f.due, "2027-02-28");
  assert.equal(f.next, "2027-02-28");
  assert.equal(f.est, 0);
  const g = L.cardCycle({ cys: 1, cyd: 20 }, "2026-12-01", () => -1000, () => 0);
  assert.equal(g.s, "2026-12-01");
  assert.equal(g.due, "2026-12-20");
});
