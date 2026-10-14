// Split wave 28: the split maths (fair cents), expenses paid in
// another currency (converted once, never again), itemised receipts
// with tax and tip, repeating expenses, and how the new fields travel
// (sync merge, group file) without touching what older versions read.
// Also the shared ECB helper in units/core.js that Split reuses.
// Run: node --test tests/
//
// Same approach as split.test.js: sections 2–5 of the browser IIFE are
// cut out of the source and evaluated on their own.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "split/split.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const S = new Function(
  block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  function cmpStr(", "  function newId(") +
  block("  // ---------- 2. Money", "  // ---------- 6. Storage") +
  "\nreturn { allot, sharesOf, itemShares, composeExp, normExp, normRec, mergeSplit, emptyData, balancesOf," +
  " parseRate, rateText, roundRate, convertCents, nthDate, recDates, nextDate, occId, dueOccurrences," +
  " packGroup, unpackGroup, changedCount, budgetPayload, MAX_CENTS };")();
const U = require("../units/core.js");

const G = "g1";
const A = G + ".a", B = G + ".b", C = G + ".c";
const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);
const canon = (x) => JSON.stringify(x);
function base(extra) {
  return Object.assign(S.emptyData(), {
    groups: [{ id: G, m: 1, n: "Flat", col: 0, cur: "EUR", arch: 0 }],
    people: [{ id: A, m: 1, n: "Anna" }, { id: B, m: 1, n: "Nikos" }, { id: C, m: 1, n: "Maria" }]
  }, extra || {});
}
function form(o) {
  return Object.assign({ id: G + ".e1", m: 5, t: "Dinner", cur: "EUR", gcur: "EUR", rate: 1, rs: "man", rd: "",
                         d: "2026-10-08", c: "food", n: "" }, o);
}

// ---------- fair cents ----------
test("allot: always the exact total, largest remainders first, ties rotate", () => {
  assert.deepEqual(S.allot({ [A]: 1, [B]: 1, [C]: 1 }, 100, 0), { [A]: 34, [B]: 33, [C]: 33 });
  assert.deepEqual(S.allot({ [A]: 1, [B]: 1, [C]: 1 }, 100, 1), { [A]: 33, [B]: 34, [C]: 33 });
  assert.deepEqual(S.allot({ [A]: 1, [B]: 1, [C]: 1 }, 100, 5), { [A]: 33, [B]: 33, [C]: 34 });
  assert.deepEqual(S.allot({ [A]: 2, [B]: 1 }, 100, 0), { [A]: 67, [B]: 33 });
  assert.deepEqual(S.allot({ [A]: 0, [B]: 5 }, 7, 0), { [B]: 7 });
  assert.deepEqual(S.allot({}, 7, 0), {});
  // Random weights: the sum is always the total and nobody is more
  // than one cent away from their exact proportional part.
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let k = 0; k < 300; k++) {
    const w = {}, n = 1 + Math.floor(rnd() * 6);
    for (let i = 0; i < n; i++) w["g1.p" + i] = 1 + Math.floor(rnd() * 5000);
    const total = Math.floor(rnd() * 1000000);
    const out = S.allot(w, total, k);
    assert.equal(sum(out), total);
    const W = sum(w);
    Object.keys(w).forEach((p) => assert.ok(Math.abs(out[p] - total * w[p] / W) < 1, "within a cent"));
  }
});

test("allot: exact for huge amounts (past 2^53)", () => {
  const out = S.allot({ [A]: 99999999999, [B]: 1 }, S.MAX_CENTS, 0);
  assert.equal(sum(out), S.MAX_CENTS);
  assert.equal(out[B], 1);
});

test("equal split over many items: the odd cents do not all land on one person", () => {
  const l = [];
  for (let i = 0; i < 30; i++) l.push({ n: "x", a: 100, p: [A, B, C] });
  const out = S.itemShares({ l, x: 0, tp: 0 });
  assert.equal(sum(out), 3000);
  assert.deepEqual(out, { [A]: 1000, [B]: 1000, [C]: 1000 });
});

// ---------- itemised receipts ----------
test("receipt: items to their people, tax and tip in proportion", () => {
  const it = { l: [{ n: "Pizza", a: 1200, p: [A] }, { n: "Salad", a: 800, p: [B] }, { n: "Wine", a: 2000, p: [A, B, C] }],
               x: 400, tp: 400 };
  const sh = S.itemShares(it);
  // wine 20,00 / 3, odd cents from the 3rd item on: A 667, B 666, C 667;
  // subtotals 1867 / 1466 / 667, tax + tip 8,00 in proportion: 374 / 293 / 133
  assert.deepEqual(sh, { [A]: 2241, [B]: 1759, [C]: 800 });
  assert.equal(sum(sh), 4800);
  const x = S.normExp(S.composeExp(form({ a: 4800, by: { [A]: 4800 }, mode: "it", it, w: null })));
  assert.ok(x);
  assert.equal(x.mode, "ex");
  assert.deepEqual(x.w, sh);
  assert.deepEqual(x.it.l[2].p, [A, B, C]);
  assert.deepEqual(S.sharesOf(x), sh);
});

test("receipt: a receipt that does not add up is dropped, the expense stays", () => {
  const it = { l: [{ n: "Pizza", a: 1000, p: [A] }], x: 0, tp: 0 };
  const x = S.composeExp(form({ a: 1000, by: { [A]: 1000 }, mode: "it", it }));
  x.it.l[0].a = 900;                        // tampered: items 9,00 ≠ 10,00
  const n = S.normExp(x);
  assert.ok(n);
  assert.equal(n.it, undefined);
  assert.deepEqual(n.w, { [A]: 1000 });
  // w that does not match the items → the receipt is dropped too
  const y = S.composeExp(form({ a: 1000, by: { [A]: 1000 }, mode: "it", it: { l: [{ n: "a", a: 1000, p: [A, B] }], x: 0, tp: 0 } }));
  y.w = { [A]: 600, [B]: 400 };
  assert.equal(S.normExp(y).it, undefined);
  // people of another group, empty people, too many items → dropped
  [{ l: [{ n: "a", a: 1000, p: ["g2.a"] }] }, { l: [{ n: "a", a: 1000, p: [] }] },
   { l: Array.from({ length: 61 }, () => ({ n: "a", a: 1, p: [A] })) }].forEach((bad) => {
    const z = { id: G + ".e1", m: 1, t: "", a: 1000, d: "2026-10-08", c: "food", by: { [A]: 1000 }, mode: "ex", w: { [A]: 1000 }, n: "", it: bad };
    assert.equal(S.normExp(z).it, undefined);
  });
});

// ---------- foreign currency ----------
test("currency: converted once, payers and exact amounts allotted to the cent", () => {
  const f = form({ a: 10000, cur: "USD", rate: 0.92345, rs: "ecb", rd: "2026-10-13",
                   by: { [A]: 6000, [B]: 4000 }, mode: "ex", w: { [A]: 3333, [B]: 3333, [C]: 3334 } });
  const x = S.normExp(S.composeExp(f));
  assert.ok(x);
  assert.equal(x.a, 9235);                                 // round(10000 × 0.92345)
  assert.equal(sum(x.by), 9235);
  assert.equal(sum(x.w), 9235);
  assert.deepEqual(x.fx, { c: "USD", a: 10000, r: 0.92345, s: "ecb", d: "2026-10-13",
                           by: { [A]: 6000, [B]: 4000 }, w: { [A]: 3333, [B]: 3333, [C]: 3334 } });
  // equal split of a foreign expense: weights stay, shares in EUR
  const e = S.normExp(S.composeExp(form({ a: 1000, cur: "GBP", rate: 1.15, by: { [C]: 1000 }, mode: "eq", w: { [A]: 1, [B]: 1, [C]: 1 } })));
  assert.equal(e.a, 1150);
  assert.deepEqual(e.by, { [C]: 1150 });
  assert.equal(e.fx.by, undefined);                         // one payer: nothing to keep
  assert.equal(e.fx.s, "man");
  assert.deepEqual(S.sharesOf(e), { [A]: 384, [B]: 383, [C]: 383 });
});

test("currency: balances never move once saved; a bad fx is dropped, not the expense", () => {
  const d = base();
  d.exp = [S.normExp(S.composeExp(form({ a: 5000, cur: "USD", rate: 0.9, by: { [A]: 5000 }, mode: "eq", w: { [A]: 1, [B]: 1 } })))];
  const before = canon(S.balancesOf(d, G));
  assert.deepEqual(S.balancesOf(d, G)[B], { id: B, paid: 0, share: 2250, bal: -2250 });
  const again = S.mergeSplit(d, d);
  assert.equal(canon(S.balancesOf(again, G)), before);
  const bad = JSON.parse(JSON.stringify(d.exp[0]));
  bad.fx.r = 0.95;                                          // rate no longer gives a
  let n = S.normExp(bad);
  assert.ok(n);
  assert.equal(n.fx, undefined);
  assert.equal(n.a, 4500);
  bad.fx = { c: "usd", a: 5000, r: 0.9 };                   // lower-case code
  assert.equal(S.normExp(bad).fx, undefined);
  bad.fx = { c: "USD", a: 5000, r: 0.912345678 };           // more than 6 digits
  assert.equal(S.normExp(bad).fx, undefined);
  bad.fx = { c: "USD", a: 5000, r: 0.9, by: { [A]: 4000 } }; // payers ≠ amount
  assert.equal(S.normExp(bad).fx, undefined);
  bad.fx = { c: "USD", a: 5000, r: 0.9, s: "ecb", d: "nope" };
  assert.deepEqual(S.normExp(bad).fx, { c: "USD", a: 5000, r: 0.9, s: "ecb" });
});

test("rates: typed by hand, 6 significant digits, ECB cross rates from units/core.js", () => {
  assert.equal(S.parseRate("0,9234"), 0.9234);
  assert.equal(S.parseRate("0.92345678"), 0.923457);
  assert.equal(S.parseRate("160"), 160);
  assert.equal(S.parseRate(",5"), 0.5);
  ["", "0", "-1", "1,2,3", "abc", "1e3", "1000000"].forEach((s) => assert.equal(S.parseRate(s), null, s));
  assert.equal(S.rateText(0.9234, "el"), "0,9234");
  assert.equal(S.rateText(160, "en"), "160");
  assert.equal(S.rateText(0.0000061234, "en"), "0.0000061234");
  const R = { base: "EUR", date: "2026-10-13", at: 1, src: "x", rates: { USD: 1.1, GBP: 0.85 } };
  assert.equal(U.crossRate(R, "EUR", "EUR"), 1);
  assert.equal(U.crossRate(R, "EUR", "USD"), 1.1);
  assert.ok(Math.abs(U.crossRate(R, "USD", "GBP") - 0.85 / 1.1) < 1e-12);
  assert.equal(U.crossRate(R, "USD", "JPY"), null);
  assert.equal(U.crossRate(null, "USD", "EUR"), null);
  assert.ok(U.CURRENCY_ORDER.indexOf("USD") > 0);
});

test("rates: one shared fetcher tries the next source, never stores", async () => {
  const seen = [];
  const reply = { base: "EUR", date: "2026-10-13", rates: { USD: 1.1 } };
  const r = await U.fetchLatest((url) => {
    seen.push(url);
    if (seen.length === 1) return Promise.reject(new Error("offline"));
    return Promise.resolve({ ok: true, json: () => Promise.resolve(reply) });
  }, 42);
  assert.deepEqual(seen, U.RATES_URLS);
  assert.deepEqual(r, { base: "EUR", date: "2026-10-13", at: 42, src: U.RATES_URLS[1], rates: { USD: 1.1 } });
  await assert.rejects(U.fetchLatest(() => Promise.resolve({ ok: false })));
  await assert.rejects(U.fetchLatest(() => Promise.resolve({ ok: true, json: () => Promise.resolve("<html>") })));
});

// ---------- exact amounts, shares, % ----------
test("split modes keep adding up; old expenses keep their equal split", () => {
  for (let a = 1; a < 2000; a += 37) {
    const pc = S.normExp(S.composeExp(form({ a, by: { [A]: a }, mode: "pc", w: { [A]: 3333, [B]: 3333, [C]: 3334 } })));
    assert.equal(sum(S.sharesOf(pc)), a);
    const sh = S.normExp(S.composeExp(form({ a, by: { [A]: a }, mode: "sh", w: { [A]: 2, [B]: 1, [C]: 1 } })));
    assert.equal(sum(S.sharesOf(sh)), a);
  }
  assert.equal(S.normExp(S.composeExp(form({ a: 1000, by: { [A]: 1000 }, mode: "ex", w: { [A]: 400, [B]: 500 } }))), null);
  const old = { id: G + ".e9", m: 1, t: "Old", a: 900, d: "2026-01-01", c: "food", by: { [A]: 900 }, mode: "eq",
                w: { [A]: 1, [B]: 1, [C]: 1 }, n: "" };
  const n = S.normExp(old);
  assert.equal(canon(n), canon(old), "an old expense stays byte-identical");
});

// ---------- repeating expenses ----------
test("repeating: monthly keeps the day (clamped), weekly, yearly, until", () => {
  const rule = (f, d, u) => ({ id: G + ".rent", f, d, u });
  assert.deepEqual(S.recDates(rule("m", "2026-01-31"), "2026-05-01", 99), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  assert.deepEqual(S.recDates(rule("w", "2026-10-01"), "2026-10-22", 99), ["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22"]);
  assert.deepEqual(S.recDates(rule("y", "2024-02-29"), "2027-03-01", 99), ["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28"]);
  assert.deepEqual(S.recDates(rule("m", "2026-01-15", "2026-03-14"), "2026-12-31", 99), ["2026-01-15", "2026-02-15"]);
  assert.deepEqual(S.recDates(rule("m", "2026-11-01"), "2026-10-14", 99), []);
  assert.equal(S.recDates(rule("w", "2000-01-01"), "2026-10-14", 400).length, 400);
  assert.equal(S.nextDate(rule("m", "2026-01-31"), "2026-10-14"), "2026-10-31");
  assert.equal(S.nextDate(rule("m", "2026-01-31", "2026-09-30"), "2026-10-14"), "");
  assert.equal(S.occId({ id: G + ".abcdefghijklmnopq" }, "2026-10-01"), G + ".abcdefghijklmno20261001");
});

test("repeating: occurrences appear on their date, once, never after a delete", () => {
  const rule = S.normRec(Object.assign(S.composeExp(form({ id: G + ".rent1", t: "Rent", a: 90000, d: "2026-08-01", c: "bills",
    by: { [A]: 90000 }, mode: "eq", w: { [A]: 1, [B]: 1, [C]: 1 } })), { f: "m", m: 100 }));
  assert.ok(rule);
  assert.equal(rule.f, "m");
  const d = base({ rec: [rule] });
  const due = S.dueOccurrences(d, "2026-10-14");
  assert.deepEqual(due.map((x) => x.d), ["2026-08-01", "2026-09-01", "2026-10-01"]);
  assert.deepEqual(due.map((x) => x.id), [G + ".rent120260801", G + ".rent120260901", G + ".rent120261001"]);
  assert.ok(due.every((x) => x.m === 100 && x.r === rule.id && x.a === 90000 && x.f === undefined));
  // a second device makes exactly the same records → the merge has one of each
  const other = S.mergeSplit(base({ rec: [rule], exp: S.dueOccurrences(base({ rec: [rule] }), "2026-10-14") }), null);
  d.exp = due;
  const merged = S.mergeSplit(S.mergeSplit(d, null), other);
  assert.equal(merged.exp.length, 3);
  assert.equal(S.dueOccurrences(merged, "2026-10-14").length, 0);
  // delete September; a later edit of the rule does not bring it back
  merged.exp = merged.exp.filter((x) => x.d !== "2026-09-01");
  merged.tombs["exp:" + G + ".rent120260901"] = 200;
  merged.rec[0] = Object.assign({}, merged.rec[0], { m: 300, a: 95000, by: { [A]: 95000 } });
  const after = S.mergeSplit(merged, null);
  assert.deepEqual(S.dueOccurrences(after, "2026-11-02").map((x) => x.d + " " + x.a), ["2026-11-01 95000"]);
  // archived or deleted group: nothing
  after.groups[0].arch = 1;
  assert.equal(S.dueOccurrences(after, "2026-12-02").length, 0);
});

test("repeating: rules merge and travel in the group file with their tombstones", () => {
  const rule = S.normRec(Object.assign(S.composeExp(form({ id: G + ".rent1", a: 1000, by: { [A]: 1000 }, mode: "eq", w: { [A]: 1, [B]: 1 } })), { f: "w", u: "2026-12-31", m: 9 }));
  assert.equal(rule.u, "2026-12-31");
  assert.equal(S.normRec(Object.assign({}, rule, { f: "d" })), null);
  assert.equal(S.normRec(Object.assign({}, rule, { u: "2020-01-01" })).u, undefined);
  const d = S.mergeSplit(base({ rec: [rule], tombs: { ["rec:" + G + ".old"]: 5 } }), null);
  const pk = S.unpackGroup(JSON.parse(JSON.stringify(S.packGroup(d, G))));
  assert.deepEqual(pk.data.rec, [rule]);
  assert.equal(pk.data.tombs["rec:" + G + ".old"], 5);
  // deleting the rule (newer tomb) removes it on merge
  const gone = S.mergeSplit(d, { tombs: { ["rec:" + G + ".rent1"]: 10 } });
  assert.equal(gone.rec, undefined);
  assert.equal(S.changedCount(d, gone), 0);
});

// ---------- compatibility ----------
test("compatibility: a slice without new things is byte-identical to before", () => {
  const d = base({ exp: [{ id: G + ".e1", m: 1, t: "", a: 300, d: "2026-10-01", c: "food", by: { [A]: 300 }, mode: "eq", w: { [A]: 1, [B]: 1 }, n: "" }] });
  const m = S.mergeSplit(d, null);
  assert.deepEqual(Object.keys(m), ["ver", "groups", "people", "exp", "pay", "mine", "tombs"]);
  assert.equal(canon(S.mergeSplit(m, m)), canon(m));
});

test("compatibility: what an older version keeps of a new expense is still right", () => {
  // An older version drops fx / it / ph / r and keeps a, by, mode, w:
  // the balances it shows are the same.
  const it = { l: [{ n: "Pizza", a: 1500, p: [A] }, { n: "Beer", a: 900, p: [A, B] }], x: 0, tp: 300 };
  const x = S.normExp(S.composeExp(form({ a: 2700, cur: "USD", rate: 0.9, by: { [B]: 2700 }, mode: "it", it,
                                          ph: "20261008-g1-e1-abcd.jpg", r: G + ".rent1" })));
  assert.ok(x.fx && x.it && x.ph && x.r);
  const oldView = { id: x.id, m: x.m, t: x.t, a: x.a, d: x.d, c: x.c, by: x.by, mode: x.mode, w: x.w, n: x.n };
  const d1 = base({ exp: [x] }), d2 = base({ exp: [oldView] });
  assert.equal(canon(S.balancesOf(d1, G)), canon(S.balancesOf(d2, G)));
  // On equal m the record with more fields wins, both ways round (an
  // older version strips them without a new stamp; its copy must lose).
  assert.deepEqual(S.mergeSplit(d1, d2).exp[0], x);
  assert.deepEqual(S.mergeSplit(d2, d1).exp[0], x);
  // Strings are only ever data: control characters out, lengths capped.
  const y = JSON.parse(JSON.stringify(x));
  y.it.l[0].n = "<img src=x onerror=alert(1)>\u0000" + "x".repeat(80);
  const n = S.normExp(y);
  assert.equal(n.it.l[0].n.length, 40);
  assert.ok(!/\u0000/.test(n.it.l[0].n));
  y.ph = "../../etc/passwd";
  assert.equal(S.normExp(y).ph, undefined);
});

test("budget: my share of a foreign expense goes over in the group currency", () => {
  const x = S.normExp(S.composeExp(form({ a: 10000, cur: "USD", rate: 0.9, by: { [A]: 10000 }, mode: "eq", w: { [A]: 1, [B]: 1 } })));
  const p = S.budgetPayload(x, B, "Flat", "Split: Flat · Dinner");
  assert.deepEqual(p, { k: "o", a: 4500, d: "2026-10-08", n: "Split: Flat · Dinner", c: "o-eat", src: "split" });
});
