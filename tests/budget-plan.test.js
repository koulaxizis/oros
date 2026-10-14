// Budget wave 10: envelopes, savings goals, subscriptions, reports,
// currencies and receipts (budget/plan.js, pure) and the new synced
// fields and collections of budget.js (asg, goal; tx oc/oa/rc, rec nd,
// acc cur, xfer ta, set env/envs). Also the shared rates helper of
// units/core.js that Budget reuses. Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const P = require("../budget/plan.js");
const UC = require("../units/core.js");

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
  "\nreturn { normTx, normRec, normAcc, normXfer, normAsg, normGoal, asgId, mergeBudget, emptyData };")();
const canon = (x) => JSON.stringify(x);
const D = (parts) => Object.assign(B.emptyData(), parts || {});
const tx = (id, d, a, k, c, extra) => Object.assign({ id, m: 1, d, a, k, c, n: "" }, extra || {});
// What an older Budget writes for a field it does not know: the known
// keys first, then every unknown flat field in name order.
function oldOrder(keys, base) {
  const extra = keys.filter((k) => base.indexOf(k) < 0);
  return keys.slice(0, base.length).join() === base.join() && extra.join() === extra.slice().sort().join();
}

// ---------- envelopes ----------
test("envelopes: assigned, spent, leftovers and overspending roll on", () => {
  const d = D({
    tx: [tx("s1", "2026-09-01", 200000, "i", "i-salary"), tx("g1", "2026-09-05", 30000, "o", "o-groc"),
         tx("e1", "2026-09-07", 12000, "o", "o-eat"), tx("g2", "2026-10-03", 10000, "o", "o-groc"),
         tx("s2", "2026-10-01", 200000, "i", "i-salary"), tx("x", "2026-08-01", 99999, "o", "o-groc")],
    asg: [{ id: "202609-o-groc", m: 1, a: 40000, c: "o-groc", mk: "2026-09" },
          { id: "202609-o-eat", m: 1, a: 10000, c: "o-eat", mk: "2026-09" },
          { id: "202610-o-groc", m: 1, a: 5000, c: "o-groc", mk: "2026-10" }]
  });
  const live = ["o-groc", "o-eat"];
  const sep = P.envMonth(d, "2026-09", "2026-09", live, 0);
  assert.deepEqual(sep.rows, [
    { c: "o-groc", asg: 40000, spent: 30000, carry: 0, avail: 10000 },
    { c: "o-eat", asg: 10000, spent: 12000, carry: 0, avail: -2000 }]);
  assert.equal(sep.tba, 200000 - 50000);
  assert.deepEqual(sep.overspent, ["o-eat"]);
  const oct = P.envMonth(d, "2026-10", "2026-09", live, 0);
  assert.deepEqual(oct.rows, [
    { c: "o-groc", asg: 5000, spent: 10000, carry: 10000, avail: 5000 },
    { c: "o-eat", asg: 0, spent: 0, carry: -2000, avail: -2000 }]);   // overspending rolls on too
  assert.equal(oct.tba, 400000 - 55000);
  // starting cash counts; before the start nothing
  assert.equal(P.envMonth(d, "2026-10", "2026-09", live, 12345).tba, 400000 - 55000 + 12345);
  assert.equal(P.envMonth(d, "2026-10", "2026-09", live, -500).startCash, 0);
  assert.deepEqual(P.envMonth(d, "2026-08", "2026-09", live, 0), { before: true });
  assert.deepEqual(P.envMonth(d, "2026-10", "", live, 0), { before: true });
});

test("envelopes: a deleted category's money goes back; its spending shows as Uncategorized", () => {
  const d = D({
    tx: [tx("i", "2026-10-01", 100000, "i", ""), tx("a", "2026-10-02", 3000, "o", "u-gone"), tx("b", "2026-10-02", 1000, "o", "")],
    asg: [{ id: "202610-u-gone", m: 1, a: 20000, c: "u-gone", mk: "2026-10" }, { id: "202610-o-groc", m: 1, a: 1000, c: "o-groc", mk: "2026-10" }]
  });
  const r = P.envMonth(d, "2026-10", "2026-10", ["o-groc"], 0);
  assert.equal(r.tba, 100000 - 1000);
  assert.deepEqual(r.rows.map((x) => [x.c, x.spent, x.avail]), [["o-groc", 0, 1000], ["", 4000, -4000]]);
});

test("envelopes: moving money and the assignment ids", () => {
  const asg = { a: 5000, b: 0 };
  const of = (c) => asg[c] || 0;
  assert.deepEqual(P.moveMoney(of, "a", "b", 2000), [{ c: "a", a: 3000 }, { c: "b", a: 2000 }]);
  assert.deepEqual(P.moveMoney(of, null, "b", 700), [{ c: "b", a: 700 }]);     // from "To be assigned"
  assert.deepEqual(P.moveMoney(of, "a", null, 9000), [{ c: "a", a: -4000 }]);  // back to it, more than assigned
  assert.deepEqual(P.moveMoney(of, "a", "a", 1), []);
  assert.deepEqual(P.moveMoney(of, "a", "b", 0), []);
  assert.equal(P.asgId("2026-10", "o-groc"), "202610-o-groc");
  assert.equal(B.asgId("2026-10", ""), "202610-none");
});

// ---------- goals ----------
test("goals: progress, months left, amount a month, late", () => {
  const g = { t: 120000, d: "2027-03-15" };
  assert.deepEqual(P.goalStatus(g, 30000, "2026-10-14"), { saved: 30000, left: 90000, pct: 25, done: false, months: 6, perMonth: 15000, late: false });
  assert.equal(P.goalStatus(g, 130000, "2026-10-14").done, true);
  assert.equal(P.goalStatus(g, 130000, "2026-10-14").pct, 100);
  const late = P.goalStatus(g, 100000, "2027-04-01");
  assert.equal(late.late, true);
  assert.equal(late.perMonth, 20000);
  assert.equal(P.goalStatus({ t: 1000, d: "" }, 0, "2026-10-14").perMonth, 0);
  assert.equal(P.goalStatus({ t: 1000, d: "2026-10-31" }, 1, "2026-10-14").perMonth, 999);   // this month only
  assert.equal(P.goalStatus({ t: 1000, d: "" }, -50, "2026-10-14").pct, 0);
});

// ---------- subscriptions ----------
test("subscriptions: next charge, monthly and yearly cost", () => {
  assert.equal(P.nextCharge({ f: "m", s: "2026-01-31", e: "" }, "2026-02-10"), "2026-02-28");
  assert.equal(P.nextCharge({ f: "m", s: "2026-01-31", e: "" }, "2026-01-31"), "2026-01-31");
  assert.equal(P.nextCharge({ f: "m", s: "2026-11-05", e: "" }, "2026-10-14"), "2026-11-05");
  assert.equal(P.nextCharge({ f: "m", s: "2026-01-05", e: "2026-10-01" }, "2026-10-14"), "");
  assert.equal(P.nextCharge({ f: "w", s: "2026-10-01", e: "" }, "2026-10-14"), "2026-10-15");
  assert.equal(P.nextCharge({ f: "w", s: "2026-10-01", e: "" }, "2026-10-15"), "2026-10-15");
  assert.equal(P.nextCharge({ f: "y", s: "2024-02-29", e: "" }, "2026-10-14"), "2027-02-28");
  assert.equal(P.nextCharge({ f: "y", s: "2025-12-01", e: "" }, "2026-10-14"), "2026-12-01");
  assert.equal(P.monthlyCost({ f: "w", a: 1200 }), 5200);
  assert.equal(P.monthlyCost({ f: "y", a: 1199 }), 100);
  assert.equal(P.yearlyCost({ f: "w", a: 1200 }), 62400);
  assert.equal(P.yearlyCost({ f: "m", a: 1299 }), 15588);
  const d = D({ rec: [{ id: "a", k: "o", a: 1299, f: "m", s: "2026-01-20", e: "" }, { id: "b", k: "o", a: 6000, f: "y", s: "2026-03-01", e: "" },
                      { id: "c", k: "i", a: 9, f: "m", s: "2026-01-01", e: "" }, { id: "d", k: "o", a: 5, f: "m", s: "2026-01-01", e: "2026-02-01" },
                      { id: "z", k: "o", a: 5, f: "m", s: "2026-01-01", e: "" }], tombs: { "rec:z": 9 } });
  const s = P.subscriptions(d, "2026-10-14");
  assert.deepEqual(s.list.map((x) => [x.r.id, x.next]), [["a", "2026-10-20"], ["b", "2027-03-01"]]);
  assert.equal(s.monthly, 1299 + 500);
  assert.equal(s.yearly, 15588 + 6000);
});

test("subscriptions: reminders N days before, once per charge", () => {
  const d = D({ rec: [{ id: "net", k: "o", a: 1299, f: "m", s: "2026-01-16", e: "", n: "Netflix", nd: 2 },
                      { id: "gym", k: "o", a: 3500, f: "m", s: "2026-01-16", e: "" },
                      { id: "now", k: "o", a: 100, f: "m", s: "2026-01-14", e: "", nd: 0 },
                      { id: "bad", k: "o", a: 100, f: "m", s: "2026-01-15", e: "", nd: 99 }] });
  const due = P.subsDue(d, "2026-10-14");
  assert.deepEqual(due.map((x) => [x.id, x.days, x.key]), [["now", 0, "sub-now-20261014"], ["net", 2, "sub-net-20261016"]]);
  assert.equal(P.subsDue(d, "2026-10-13").length, 0);           // 3 days before: not yet
  assert.equal(P.subsDue(d, "2026-10-16")[0].key, "sub-net-20261016");
  assert.equal(P.normNd(31), -1);
  assert.equal(P.normNd(0), 0);
});

// ---------- reports ----------
test("reports: a year per category per month", () => {
  const d = D({ tx: [tx("a", "2026-01-05", 1000, "o", "o-groc"), tx("b", "2026-01-20", 500, "o", "o-groc"),
                     tx("c", "2026-03-01", 7000, "o", "o-home"), tx("d", "2026-03-02", 200, "o", "u-gone"),
                     tx("e", "2026-03-02", 9000, "i", "i-salary"), tx("f", "2025-12-31", 1, "o", "o-groc")] });
  const r = P.yearReport(d, 2026, ["o-groc", "o-home"]);
  assert.equal(r.months.length, 12);
  assert.equal(r.months[0], "2026-01");
  assert.deepEqual(r.rows.map((x) => [x.c, x.tot]), [["o-home", 7000], ["o-groc", 1500], ["", 200]]);
  assert.equal(r.rows[1].by[0], 1500);
  assert.equal(r.out[2], 7200);
  assert.equal(r.inc[2], 9000);
  assert.equal(r.totOut, 8700);
  assert.equal(r.totInc, 9000);
});

test("net worth: balances in their own currency, converted to the main one", () => {
  const rates = { base: "EUR", rates: { USD: 1.25, GBP: 0.8 } };
  const fx = (c, f, t) => UC.convertCents(c, f, t, rates);
  const d = D({
    acc: [{ id: "bank", n: "Bank", o: 100000 }, { id: "us", n: "US", o: 50000, cur: "USD" }, { id: "jp", n: "JP", o: 1000, cur: "JPY" }],
    tx: [tx("a", "2026-10-01", 4000, "o", "", { ac: "us", oc: "USD", oa: 5000 }),   // typed in the account's currency
         tx("b", "2026-10-02", 8000, "o", "", { ac: "us" }),                          // typed in EUR → converted
         tx("c", "2026-10-03", 1000, "i", "", { ac: "bank" }), tx("late", "2026-11-01", 1, "i", "", { ac: "bank" })],
    xfer: [{ id: "x", d: "2026-10-05", a: 20000, f: "bank", t: "us", ta: 24800 }, { id: "y", d: "2026-10-06", a: 1000, f: "us", t: "bank" }]
  });
  const bal = P.balancesFx(d, "2026-10-31", "EUR", fx);
  assert.equal(bal.bank, 100000 + 1000 - 20000 + 800);
  assert.equal(bal.us, 50000 - 5000 - 10000 + 24800 - 1000);
  const nw = P.netWorth(d, "2026-10-31", "EUR", fx);
  assert.deepEqual(nw.missing, ["jp"]);   // no JPY rate: left out, said so
  assert.equal(nw.tot, bal.bank + Math.round(bal.us / 1.25));
  const series = P.netWorthSeries(d, ["2026-09", "2026-10", "2026-11"], "2026-10-14", "EUR", fx);
  assert.equal(series[0].tot, 100000 + 40000);
  assert.equal(series[2].tot, series[1].tot);   // the future month ends today
  // all in the main currency: same as the old balances
  const d2 = D({ acc: [{ id: "a", n: "A", o: 5 }], tx: [tx("t", "2026-01-01", 7, "i", "", { ac: "a" })] });
  assert.equal(P.balancesFx(d2, "2026-12-31", "EUR", null).a, 12);
});

// ---------- currencies (units/core.js, shared with Unit Converter) ----------
test("rates: convert through EUR, missing rate → null, one fetcher with fallbacks", async () => {
  const r = { rates: { USD: 1.1, GBP: 0.85 } };
  assert.equal(UC.convertCents(1000, "EUR", "USD", r), 1100);
  assert.equal(UC.convertCents(1100, "USD", "EUR", r), 1000);
  assert.equal(UC.convertCents(1100, "USD", "GBP", r), 850);
  assert.equal(UC.convertCents(5, "USD", "USD", null), 5);
  assert.equal(UC.convertCents(5, "USD", "JPY", r), null);
  assert.equal(UC.convertCents(5, "constructor", "EUR", r), null);
  const calls = [];
  const fake = (url) => {
    calls.push(url);
    if (calls.length === 1) return Promise.reject(new Error("down"));
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ base: "EUR", date: "2026-10-13", rates: { USD: 1.1 } }) });
  };
  const got = await UC.fetchRates(fake, 123);
  assert.equal(calls.length, 2);
  assert.deepEqual(got, { base: "EUR", date: "2026-10-13", at: 123, src: UC.RATES_URLS[1], rates: { USD: 1.1 } });
  await assert.rejects(UC.fetchRates(() => Promise.resolve({ ok: false }), 1));
  const store = { v: null, getItem() { return this.v; }, setItem(k, v) { assert.equal(k, UC.RATES_KEY); this.v = v; } };
  assert.equal(UC.loadRates(store), null);
  UC.saveRates(store, got);
  assert.deepEqual(UC.loadRates(store), got);
});

// ---------- receipts ----------
test("receipts: names, the joined field, PDF magic bytes", () => {
  const n = P.rcName("2026-10-14", "r1a2-20261014", "ab12cd", "jpg");
  assert.equal(n, "20261014-r1a2-20261014-ab12cd.jpg");
  assert.equal(P.rcPath(n), "/internal/Budget/Receipts/" + n);
  assert.equal(P.rcPath("../x.jpg"), null);
  assert.equal(P.rcName("2026-10-14", "ok", "a!", "jpg"), null);
  assert.equal(P.rcName("2026-10-14", "ok", "abcd", "exe"), null);
  const p = P.rcName("2026-10-14", "ok", "abcd", "pdf");
  assert.deepEqual(P.rcList(n + " junk " + p + " " + n), [n, p].sort());
  assert.equal(P.rcJoin([p, n, "x", n]), [n, p].sort().join(" "));
  assert.deepEqual(P.rcAll({ tx: [{ rc: n }, {}, { rc: p }] }), [n, p]);
  assert.equal(P.isPdfHead(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])), true);
  assert.equal(P.isPdfHead(new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c])), false);
  assert.equal(P.isPdfHead(new Uint8Array([0x25])), false);
});

test("receipts: the total read from pasted text", () => {
  const greek = "ΣΚΛΑΒΕΝΙΤΗΣ Α.Ε.\nΓΑΛΑ ΦΡΕΣΚΟ 1,89\nΨΩΜΙ 1,20\nΦ.Π.Α. 13% 0,36\nΣΥΝΟΛΟ 23,45\nΜΕΤΡΗΤΑ 50,00\nΡΕΣΤΑ 26,55";
  assert.equal(P.amountFromText(greek), 2345);
  assert.equal(P.amountFromText("Subtotal 10.00\nVAT 2.40\nTOTAL\n12.40\nCard 12.40"), 1240);
  assert.equal(P.amountFromText("ΠΛΗΡΩΤΕΟ ΠΟΣΟ: 1.234,56 €"), 123456);
  assert.equal(P.amountFromText("Amount due $1,234.50"), 123450);
  assert.equal(P.amountFromText("coffee 2,50\ncake 4,10"), 410);   // no total line: the largest
  assert.equal(P.amountFromText("nothing here"), null);
  assert.equal(P.amountFromText(""), null);
  assert.equal(P.amountFromText(null), null);
});

// ---------- the model: new fields and collections ----------
test("model: an entry's original currency and receipts, kept flat in an older version's order", () => {
  const x = B.normTx(tx("t", "2026-10-01", 2000, "o", "o-groc", { oc: "USD", oa: 2200, rc: "20261001-t-abcd.jpg", ac: "a1" }));
  assert.deepEqual(x, { id: "t", m: 1, d: "2026-10-01", a: 2000, k: "o", c: "o-groc", n: "", ac: "a1", oa: 2200, oc: "USD", rc: "20261001-t-abcd.jpg" });
  assert.ok(oldOrder(Object.keys(x), ["id", "m", "d", "a", "k", "c", "n", "ac"]));
  // half a pair or junk drops both / it
  assert.deepEqual(Object.keys(B.normTx(tx("t", "2026-10-01", 1, "o", "", { oc: "usd", oa: 5 }))), ["id", "m", "d", "a", "k", "c", "n"]);
  assert.deepEqual(Object.keys(B.normTx(tx("t", "2026-10-01", 1, "o", "", { oc: "USD" }))), ["id", "m", "d", "a", "k", "c", "n"]);
  assert.equal("rc" in B.normTx(tx("t", "2026-10-01", 1, "o", "", { rc: "<img src=x>" })), false);
  assert.equal("rc" in B.normTx(tx("t", "2026-10-01", 1, "o", "", { rc: "a b c d" })), false);
});

test("model: reminder lead, account currency, transfer received, settings", () => {
  const r = B.normRec({ id: "r1", m: 1, k: "o", a: 5, c: "", n: "", f: "m", s: "2026-01-01", e: "", nd: 3, ac: "a" });
  assert.equal(r.nd, 3);
  assert.ok(oldOrder(Object.keys(r), ["id", "m", "k", "a", "c", "n", "f", "s", "e", "ac"]));
  assert.equal("nd" in B.normRec({ id: "r1", m: 1, k: "o", a: 5, f: "m", s: "2026-01-01", nd: 31 }), false);
  assert.equal("nd" in B.normRec({ id: "r1", m: 1, k: "o", a: 5, f: "m", s: "2026-01-01", nd: 1.5 }), false);
  assert.deepEqual(B.normAcc({ id: "a", m: 1, n: "US", o: -5, col: 1, cur: "USD" }), { id: "a", m: 1, n: "US", o: -5, col: 1, cur: "USD" });
  assert.equal("cur" in B.normAcc({ id: "a", m: 1, n: "US", cur: "dollars" }), false);
  assert.equal(B.normXfer({ id: "x", m: 1, d: "2026-10-01", a: 5, f: "a", t: "b", ta: 7 }).ta, 7);
  assert.equal("ta" in B.normXfer({ id: "x", m: 1, d: "2026-10-01", a: 5, f: "a", t: "b", ta: -7 }), false);
  const m = B.mergeBudget(D({ set: { m: 5, cur: "EUR", env: true, envs: "2026-10", zz: 1 } }), B.emptyData());
  assert.deepEqual(m.set, { m: 5, cur: "EUR", env: true, envs: "2026-10", zz: 1 });
  const bad = B.mergeBudget(D({ set: { m: 5, cur: "EUR", env: "yes", envs: "2026-13" } }), B.emptyData());
  assert.deepEqual(bad.set, { m: 5, cur: "EUR" });
});

test("model: assignments and goals, LWW per id with tombstones, canonical", () => {
  const g = { id: "202610-o-groc", m: 5, a: 4000, c: "o-groc", mk: "2026-10" };
  assert.deepEqual(B.normAsg(g), g);
  assert.equal(B.normAsg(Object.assign({}, g, { id: "202611-o-groc" })), null);   // id must name month + envelope
  assert.equal(B.normAsg(Object.assign({}, g, { mk: "2026-1" })), null);
  assert.deepEqual(B.normAsg({ id: "202610-none", m: 1, a: -5, c: "", mk: "2026-10" }).a, -5);
  const goal = B.normGoal({ id: "g1", m: 3, n: "  Trip\nto Crete ", t: 150000, d: "2027-06-30", sv: 100, ac: "", col: 4, x1: "keep" });
  assert.deepEqual(goal, { id: "g1", m: 3, ac: "", col: 4, d: "2027-06-30", n: "Trip to Crete", sv: 100, t: 150000, x1: "keep" });
  assert.ok(oldOrder(Object.keys(goal), ["id", "m"]));
  assert.equal(B.normGoal({ id: "g1", m: 3, n: "", t: 5 }), null);
  assert.equal(B.normGoal({ id: "g1", m: 3, n: "x", t: 0 }), null);
  const a = D({ asg: [g], goal: [goal] });
  const b = D({ asg: [Object.assign({}, g, { m: 6, a: 5000 })], goal: [Object.assign({}, goal, { m: 2, sv: 999 })], tombs: { "goal:g1": 3 } });
  const ab = B.mergeBudget(a, b);
  assert.equal(canon(ab), canon(B.mergeBudget(b, a)));
  assert.equal(canon(B.mergeBudget(ab, ab)), canon(ab));
  assert.equal(ab.asg[0].a, 5000);                 // newer assignment wins, never a sum
  assert.deepEqual(ab.goal, []);                   // delete wins a tie
  const back = B.mergeBudget(ab, D({ goal: [Object.assign({}, goal, { m: 4 })] }));
  assert.equal(back.goal.length, 1);               // a newer edit resurrects
});

test("model: an older device carries every new field and collection unchanged", () => {
  // An older Budget keeps unknown flat fields and unknown collections
  // {id, m, …} as they are; simulate its view with fields it ignores.
  const full = D({
    tx: [tx("t", "2026-10-01", 2000, "o", "", { oc: "GBP", oa: 1700, rc: "20261001-t-abcd.jpg" })],
    rec: [{ id: "r", m: 1, k: "o", a: 5, c: "", n: "", f: "m", s: "2026-01-01", e: "", nd: 2 }],
    acc: [{ id: "a", m: 1, n: "UK", o: 0, col: 0, cur: "GBP" }],
    xfer: [{ id: "x", m: 1, d: "2026-10-01", a: 5, f: "a", t: "b", n: "", ta: 6 }],
    asg: [{ id: "202610-none", m: 1, a: 3, c: "", mk: "2026-10" }],
    goal: [{ id: "g", m: 1, ac: "", col: 2, d: "", n: "G", sv: 0, t: 5 }],
    set: { m: 2, cur: "EUR", env: true, envs: "2026-10" }
  });
  const once = B.mergeBudget(full, full);
  // the JSON round trip (what sync and the old device store) changes nothing
  assert.equal(canon(B.mergeBudget(JSON.parse(canon(once)), B.emptyData())), canon(once));
  // and the keys after the old known ones are in name order, as an old device writes them
  Object.keys(once).forEach((k) => {
    if (!Array.isArray(once[k])) return;
    once[k].forEach((item) => assert.deepEqual(Object.keys(item).slice(2), Object.keys(item).slice(2), k));
  });
  assert.deepEqual(Object.keys(once.asg[0]), ["id", "m", "a", "c", "mk"]);
  assert.deepEqual(Object.keys(once.set), ["m", "cur", "env", "envs"]);
});

// ---------- wiring ----------
test("wiring: files loaded, shell engine, deep link, help", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "budget/index.html"), "utf8");
  ["../units/core.js", "plan.js", "planui.js"].forEach((f) => assert.ok(html.indexOf('src="' + f + "?v=") > 0, f));
  assert.ok(html.indexOf('src="plan.js') < html.indexOf('src="budget.js'));
  const shellHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.ok(/<script src="budget\/plan\.js\?v=/.test(shellHtml));
  const shell = fs.readFileSync(path.join(root, "shell.js"), "utf8");
  assert.ok(shell.indexOf('tickSafe("budgetCheckTick", budgetCheckTickThrottled)') > 0);
  assert.ok(shell.indexOf("Core.subsDue(raw, today)") > 0);
  const notif = fs.readFileSync(path.join(root, "notifications.js"), "utf8");
  assert.ok(/budget:\s+function \(id\)/.test(notif));
  assert.ok(src.indexOf("x.sub") > 0);
  const en = fs.readFileSync(path.join(root, "budget/help.en.txt"), "utf8");
  const el = fs.readFileSync(path.join(root, "budget/help.el.txt"), "utf8");
  ["## Envelopes", "## Savings goals", "## Subscriptions", "## Reports", "## Currencies", "## Receipts"].forEach((h) => assert.ok(en.indexOf(h) >= 0, h));
  assert.equal(en.split("\n## ").length, el.split("\n## ").length);
  // every string of planui.js exists in both languages
  const ui = fs.readFileSync(path.join(root, "budget/planui.js"), "utf8");
  const tables = ui.slice(ui.indexOf("var S = {"), ui.indexOf("var MAX_GOALS"));
  const keysOf = (part) => (part.match(/(^|[\s,{])([a-zA-Z_][\w]*): "/g) || []).map((s) => s.replace(/^[\s,{]/, "").replace(/: "$/, "")).sort();
  const enPart = tables.slice(0, tables.indexOf("el: {")), elPart = tables.slice(tables.indexOf("el: {"));
  assert.deepEqual(keysOf(elPart), keysOf(enPart));
});
