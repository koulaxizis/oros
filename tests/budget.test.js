// Pure logic of Budget: amount parsing, dates and recurring
// occurrences, the slice merge (sync slice "budget"), the ready
// categories, totals, limits, due recurring entries and the CSV.
// Run: node --test tests/
//
// The app is a browser IIFE with no exports, so the constants and
// sections 2–5 are cut out of the source and evaluated on their own.

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
  "\nreturn { MAX_CENTS, parseAmount, centsToInput, centsPlain, parseYmd, daysIn, addDays, mkAdd, weekday," +
  " occurrences, recTxId, SEEDS, SEED_NAMES, normTx, normCat, normRec, mergeBudget, emptyData, categoryList," +
  " totals, monthSeries, limitState, dueRecurring, csvCell, buildCsv };")();

const canon = (x) => JSON.stringify(x);
function tx(id, m, extra) { return Object.assign({ id, m, d: "2026-10-08", a: 1250, k: "o", c: "o-groc", n: "" }, extra || {}); }
function D(parts) { return Object.assign(B.emptyData(), parts || {}); }

// ---------- amounts ----------
test("amounts: Greek and English ways of writing them, in cents", () => {
  const ok = { "12": 1200, "12,5": 1250, "12,50": 1250, "12.50": 1250, "0,99": 99, ".5": 50, "1.234,56": 123456,
    "1,234.56": 123456, "1.250": 125000, "1,250": 125000, "1 234,5": 123450, "1.234.567": 123456700,
    "€ 12,00": 1200, "+7": 700, "12.": 1200 };
  Object.keys(ok).forEach((s) => assert.equal(B.parseAmount(s), ok[s], s));
  ["", "0", "0,00", "-5", "abc", "1,2,3", "12,345,6", "1.2345", "1.23.4", "1..2", "1,2.3,4", null, 5]
    .forEach((s) => assert.equal(B.parseAmount(s), null, String(s)));
  assert.equal(B.parseAmount("1000000000"), B.MAX_CENTS);
  assert.equal(B.parseAmount("1000000000,01"), null);
});

test("amounts: back to input text and CSV text", () => {
  assert.equal(B.centsToInput(1250, "el"), "12,50");
  assert.equal(B.centsToInput(1250, "en"), "12.50");
  assert.equal(B.centsToInput(1200, "el"), "12");
  assert.equal(B.centsToInput(5, "en"), "0.05");
  [1, 99, 1250, 123456].forEach((c) => {
    assert.equal(B.parseAmount(B.centsToInput(c, "el")), c);
    assert.equal(B.parseAmount(B.centsToInput(c, "en")), c);
  });
  assert.equal(B.centsPlain(-1250, ","), "-12,50");
  assert.equal(B.centsPlain(7, "."), "0.07");
});

// ---------- dates + recurring ----------
test("dates: validity, month arithmetic", () => {
  assert.deepEqual(B.parseYmd("2028-02-29"), { y: 2028, m: 2, d: 29 });
  assert.equal(B.parseYmd("2027-02-29"), null);
  assert.equal(B.parseYmd("2026-13-01"), null);
  assert.equal(B.parseYmd("26-1-1"), null);
  assert.equal(B.daysIn(2026, 2), 28);
  assert.equal(B.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(B.mkAdd("2026-01", -1), "2025-12");
  assert.equal(B.mkAdd("2026-11", 14), "2028-01");
  assert.equal(B.weekday("2026-10-08"), 4);   // Thursday
});

test("recurring: monthly keeps the day, clamped to short months", () => {
  const r = { f: "m", s: "2026-01-31", e: "" };
  assert.deepEqual(B.occurrences(r, "2026-01-01", "2026-05-31"),
    ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  assert.deepEqual(B.occurrences({ f: "m", s: "2026-03-05", e: "2026-05-04" }, "2000-01-01", "2030-01-01"),
    ["2026-03-05", "2026-04-05"]);
  assert.deepEqual(B.occurrences(r, "2026-03-01", "2026-03-30"), []);
});

test("recurring: weekly and yearly (29 February)", () => {
  assert.deepEqual(B.occurrences({ f: "w", s: "2026-10-01", e: "" }, "2026-10-05", "2026-10-31"),
    ["2026-10-08", "2026-10-15", "2026-10-22", "2026-10-29"]);
  assert.deepEqual(B.occurrences({ f: "y", s: "2024-02-29", e: "" }, "2024-01-01", "2028-12-31"),
    ["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]);
  assert.deepEqual(B.occurrences({ f: "w", s: "2030-01-01", e: "" }, "2026-01-01", "2026-12-31"), []);
  assert.equal(B.recTxId("abc123", "2026-10-08"), "rabc123-20261008");
});

test("recurring: due entries are created once, never twice, never after a delete", () => {
  const rec = { id: "rent1", m: 5, k: "o", a: 50000, c: "o-home", n: "Rent", f: "m", s: "2026-08-01", e: "" };
  const d = B.mergeBudget(D({ rec: [rec] }), D());
  const made = B.dueRecurring(d, "2026-10-08");
  assert.deepEqual(made.map((x) => x.d), ["2026-08-01", "2026-09-01", "2026-10-01"]);
  made.forEach((x) => {
    assert.equal(x.id, B.recTxId("rent1", x.d));
    assert.equal(x.m, Date.parse(x.d + "T00:00:00Z"));
    assert.ok(B.normTx(x), "valid entry");
  });
  // Two devices make the same entries: identical, so the merge is a no-op.
  const A = B.mergeBudget(Object.assign({}, d, { tx: made }), D());
  const C = B.mergeBudget(Object.assign({}, d, { tx: B.dueRecurring(d, "2026-10-08") }), D());
  assert.equal(canon(B.mergeBudget(A, C)), canon(A));
  assert.deepEqual(B.dueRecurring(A, "2026-10-08"), []);
  // A deleted occurrence stays deleted, here and after a merge with a device that made it.
  const id = made[1].id;
  const del = B.mergeBudget(Object.assign({}, A, { tx: A.tx.filter((x) => x.id !== id), tombs: { ["tx:" + id]: Date.now() } }), D());
  assert.deepEqual(B.dueRecurring(del, "2026-10-08"), []);
  assert.ok(!B.mergeBudget(del, C).tx.some((x) => x.id === id));
  // A deleted recurring entry adds nothing more; old entries stay.
  const gone = B.mergeBudget(Object.assign({}, A, { rec: [], tombs: { "rec:rent1": Date.now() } }), D());
  assert.deepEqual(B.dueRecurring(gone, "2027-03-01"), []);
  assert.equal(gone.tx.length, 3);
});

test("recurring: back-fill is capped at two years", () => {
  const d = B.mergeBudget(D({ rec: [{ id: "old", m: 1, k: "i", a: 100, c: "", n: "", f: "w", s: "1990-01-01", e: "" }] }), D());
  const made = B.dueRecurring(d, "2026-10-08");
  assert.ok(made.length >= 104 && made.length <= 106, String(made.length));
  assert.ok(made[0].d >= "2024-10-08");
});

// ---------- normalize + merge ----------
test("normalize: bad entries drop out, text is cleaned", () => {
  assert.equal(B.normTx(tx("a1", 1, { a: 0 })), null);
  assert.equal(B.normTx(tx("a1", 1, { a: 12.5 })), null);
  assert.equal(B.normTx(tx("a1", 1, { k: "x" })), null);
  assert.equal(B.normTx(tx("a1", 1, { d: "2026-02-30" })), null);
  assert.equal(B.normTx(tx("A B", 1)), null);
  assert.equal(B.normTx(tx("a1", -1)), null);
  const x = B.normTx(tx("a1", 1, { n: "  hi\n\tthere  " + "x".repeat(200), c: "<b>", extra: 1 }));
  assert.equal(x.n.slice(0, 8), "hi there");
  assert.equal(x.n.length, 140);
  assert.equal(x.c, "");
  assert.deepEqual(Object.keys(x), ["id", "m", "d", "a", "k", "c", "n"]);
  assert.equal(B.normCat({ id: "o-groc", m: 1, k: "i", name: "", col: 0 }), null);   // a ready category keeps its kind
  assert.equal(B.normCat({ id: "u1", m: 1, k: "o", name: " ", col: 0 }), null);       // own needs a name
  assert.equal(B.normCat({ id: "u1", m: 1, k: "o", name: "Pets", col: 99 }).col, 8);
  assert.equal(B.normRec({ id: "r1", m: 1, k: "o", a: 5, c: "", n: "", f: "m", s: "2026-05-05", e: "2026-01-01" }).e, "");
});

function randomData(rnd) {
  const ids = ["a1", "a2", "a3", "b1", "rx-20261001"];
  const d = D();
  ids.forEach((id) => {
    if (rnd() < 0.6) d.tx.push(tx(id, Math.floor(rnd() * 5), { a: 1 + Math.floor(rnd() * 3), n: rnd() < 0.5 ? "x" : "" }));
    if (rnd() < 0.25) d.tombs["tx:" + id] = Math.floor(rnd() * 5);
  });
  ["o-groc", "u1"].forEach((id) => {
    if (rnd() < 0.5) d.cats.push({ id, m: Math.floor(rnd() * 5), k: "o", name: rnd() < 0.5 ? "N" : "M", col: Math.floor(rnd() * 9) });
    if (rnd() < 0.25) d.tombs["cat:" + id] = Math.floor(rnd() * 5);
  });
  if (rnd() < 0.5) d.bud.push({ id: "all", m: Math.floor(rnd() * 5), a: Math.floor(rnd() * 3) * 100 });
  if (rnd() < 0.5) d.rec.push({ id: "r1", m: Math.floor(rnd() * 5), k: "o", a: 9, c: "", n: "", f: "m", s: "2026-01-0" + (1 + Math.floor(rnd() * 3)), e: "" });
  if (rnd() < 0.2) d.tombs["rec:r1"] = Math.floor(rnd() * 5);
  d.set = { m: Math.floor(rnd() * 5), cur: rnd() < 0.5 ? "EUR" : "USD" };
  // shuffled order, so canonical sorting is exercised
  d.tx.sort(() => rnd() - 0.5);
  return d;
}
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

test("merge laws: idempotent, commutative, associative, canonical (fuzz 5,000)", () => {
  const rnd = rng(42);
  for (let i = 0; i < 5000; i++) {
    const a = randomData(rnd), b = randomData(rnd), c = randomData(rnd);
    const ab = B.mergeBudget(a, b);
    assert.equal(canon(B.mergeBudget(ab, ab)), canon(ab), "idempotent");
    assert.equal(canon(B.mergeBudget(b, a)), canon(ab), "commutative");
    assert.equal(canon(B.mergeBudget(B.mergeBudget(a, b), c)), canon(B.mergeBudget(a, B.mergeBudget(b, c))), "associative");
    const g = B.mergeBudget(a, a);
    assert.equal(canon(JSON.parse(canon(g))), canon(B.mergeBudget(g, g)), "get() is canonical (R26)");
    for (let k = 1; k < ab.tx.length; k++) assert.ok(ab.tx[k - 1].id < ab.tx[k].id, "sorted by id");
  }
});

test("merge: newer edit wins, equal stamps break the same way, delete wins ties", () => {
  const a = D({ tx: [tx("a1", 10, { a: 100 })] }), b = D({ tx: [tx("a1", 20, { a: 200 })] });
  assert.equal(B.mergeBudget(a, b).tx[0].a, 200);
  const c = D({ tx: [tx("a1", 10, { a: 300 })] });
  assert.equal(canon(B.mergeBudget(a, c)), canon(B.mergeBudget(c, a)));
  const del = D({ tombs: { "tx:a1": 20 } });
  assert.equal(B.mergeBudget(b, del).tx.length, 0, "tie: delete wins");
  assert.equal(B.mergeBudget(D({ tx: [tx("a1", 21)] }), del).tx.length, 1, "newer edit resurrects (R17)");
  assert.deepEqual(B.mergeBudget(b, del).tombs, { "tx:a1": 20 });
  assert.deepEqual(B.mergeBudget(D({ tombs: { "bad key": 1, "tx:a1": -3 } }), D()).tombs, {});
  // limits: no tombstones, 0 = no limit travels as a value
  const l1 = D({ bud: [{ id: "all", m: 5, a: 30000 }] }), l2 = D({ bud: [{ id: "all", m: 6, a: 0 }] });
  assert.equal(B.mergeBudget(l1, l2).bud[0].a, 0);
  // settings: later wins
  assert.equal(B.mergeBudget(D({ set: { m: 3, cur: "USD" } }), D({ set: { m: 2, cur: "GBP" } })).set.cur, "USD");
  assert.equal(B.mergeBudget(D({ set: { m: 3, cur: "XXX" } }), D()).set.cur, "EUR");
});

// ---------- categories ----------
test("ready categories: language-free ids, both languages named, nothing stored", () => {
  const ids = B.SEEDS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  ids.forEach((id) => {
    assert.match(id, /^[oi]-[a-z]+$/);
    assert.ok(B.SEED_NAMES.en[id] && B.SEED_NAMES.el[id], id);
  });
  const fresh = B.mergeBudget(D(), D());
  assert.deepEqual(fresh.cats, [], "a fresh device stores no category");
  const en = B.categoryList(fresh, B.SEED_NAMES.en), el = B.categoryList(fresh, B.SEED_NAMES.el);
  assert.equal(en.length, B.SEEDS.length);
  assert.equal(el.find((c) => c.id === "o-groc").name, "Σούπερ μάρκετ");
  // EN + EL fresh devices: identical slices
  assert.equal(canon(B.mergeBudget(D(), D())), canon(fresh));
});

test("categories: rename, colour, delete, own ones by name", () => {
  const d = B.mergeBudget(D({
    cats: [{ id: "o-eat", m: 2, k: "o", name: "Taverna", col: 5 }, { id: "uz", m: 1, k: "o", name: "Zoo", col: 1 },
           { id: "ua", m: 1, k: "i", name: "Allowance", col: 2 }],
    tombs: { "cat:o-cloth": 9 }
  }), D());
  const list = B.categoryList(d, B.SEED_NAMES.en);
  const eat = list.find((c) => c.id === "o-eat");
  assert.equal(eat.name, "Taverna");
  assert.equal(eat.col, 5);
  assert.ok(!list.some((c) => c.id === "o-cloth"), "deleted ready category stays gone");
  assert.deepEqual(list.slice(-2).map((c) => c.name), ["Allowance", "Zoo"]);
  const back = B.mergeBudget(d, D({ cats: [{ id: "o-cloth", m: 10, k: "o", name: "", col: 7 }] }));
  assert.ok(B.categoryList(back, B.SEED_NAMES.en).some((c) => c.id === "o-cloth"), "undo beats the tombstone");
});

// ---------- totals, series, limits ----------
test("totals per month, year and all; running balance over months", () => {
  const txs = [
    tx("a", 1, { d: "2026-09-30", a: 1000, k: "i", c: "i-salary" }),
    tx("b", 1, { d: "2026-10-01", a: 250, c: "o-groc" }),
    tx("c", 1, { d: "2026-10-31", a: 150, c: "o-groc" }),
    tx("d", 1, { d: "2026-10-15", a: 2000, k: "i", c: "i-salary" }),
    tx("e", 1, { d: "2025-12-31", a: 70, c: "" })
  ];
  const oct = B.totals(txs, "2026-10");
  assert.equal(oct.inc, 2000);
  assert.equal(oct.out, 400);
  assert.equal(oct.byCat["o:o-groc"], 400);
  assert.equal(B.totals(txs, "2026").n, 4);
  assert.equal(B.totals(txs, "").out, 470);
  assert.equal(B.totals(txs, "").byCat["o:"], 70);
  const s = B.monthSeries(txs, ["2026-09", "2026-10", "2026-11"]);
  assert.deepEqual(s.map((r) => r.bal), [930, 2530, 2530]);
  assert.deepEqual(s.map((r) => [r.inc, r.out]), [[1000, 0], [2000, 400], [0, 0]]);
});

test("limit states", () => {
  assert.equal(B.limitState(100, 0), "none");
  assert.equal(B.limitState(79, 100), "ok");
  assert.equal(B.limitState(80, 100), "warn");
  assert.equal(B.limitState(100, 100), "warn");
  assert.equal(B.limitState(101, 100), "over");
});

// ---------- CSV ----------
test("CSV: Greek Excel and standard formats, quoting, no formula injection", () => {
  const rows = [
    { d: "2026-10-01", k: "o", cat: "Σούπερ μάρκετ", a: 1250, n: '=HYPERLINK("x")' },
    { d: "2026-10-02", k: "i", cat: "Salary; main", a: 200000, n: "line\nbreak" }
  ];
  const head = ["Date", "Type", "Category", "Amount", "Currency", "Note"];
  const kn = (k) => (k === "i" ? "Income" : "Expense");
  const xl = B.buildCsv(rows, "excel", "EUR", head, kn);
  assert.ok(xl.startsWith("﻿Date;Type;"));
  const lines = xl.slice(1).split("\r\n");
  assert.equal(lines[1], "2026-10-01;Expense;Σούπερ μάρκετ;-12,50;EUR;\"'=HYPERLINK(\"\"x\"\")\"");
  assert.equal(lines[2], '2026-10-02;Income;"Salary; main";2000,00;EUR;"line\nbreak"');
  const std = B.buildCsv(rows, "std", "EUR", head, kn);
  assert.ok(std.includes("2026-10-01,Expense,Σούπερ μάρκετ,-12.50,EUR,"));
  assert.ok(std.includes("Salary; main,2000.00"));
  ["=1", "+1", "-1", "@a", "\tx"].forEach((s) => assert.equal(B.csvCell(s, ",")[0] === "'" || B.csvCell(s, ",")[1] === "'", true, s));
  assert.equal(B.csvCell("plain", ","), "plain");
});
