// Royalty statements in Publishing (wave P6): terms on a title, the
// statements list and its merge, sales read from Stock by ISBN
// (consignment discount, returns, voids), advances recouped across
// statements, the usual periods.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const P = require(path.join(__dirname, "..", "publish/core.js"));
const R = require(path.join(__dirname, "..", "publish/royalty.js"));

const ISBN_PB = "9786185321000";   // check digits valid (see below)
const ISBN_EB = "9786185321017";

function pub(extra) {
  return P.normalize(Object.assign({
    titles: [{
      id: "t1", m: 1, t: "Sea Wolves", ppl: [{ r: "a", n: "Anna Writer" }],
      fmts: [{ id: "f1", k: "pb", isbn: ISBN_PB, price: 16 }, { id: "f2", k: "eb", isbn: ISBN_EB, price: 7.99 }],
      roy: [{ id: "r1", n: "Anna Writer", pct: 10, base: "list", k: "pb", adv: 50 },
            { id: "r2", n: "Anna Writer", pct: 25, base: "net", k: "eb", adv: 0 }]
    }, {
      id: "t2", m: 1, t: "Salt", fmts: [{ id: "f1", k: "pb", isbn: "", price: 12 }],
      roy: [{ id: "r1", n: "anna writer", pct: 8, base: "list", k: "", adv: 0 }, { id: "r2", n: "Ben Translator", pct: 2, base: "list" }]
    }]
  }, extra || {}));
}
const STOCK = {
  items: [{ id: "it1", name: "Sea Wolves", sku: ISBN_PB, bc: ISBN_PB, price: 1509 }],
  cons: [{ id: "whshop1", m: 1, on: 1, disc: 40 }],
  moves: [
    { id: "a", t: "in", d: "2026-01-02", lines: [{ i: "it1", q: 100000 }] },
    { id: "b", t: "out", d: "2026-02-01", lines: [{ i: "it1", q: -10000, p: 1509 }] },
    { id: "c", t: "out", d: "2026-03-01", src: "cons:whshop1", w: "whshop1", lines: [{ i: "it1", q: -5000, p: 1509 }] },
    { id: "d", t: "ret", d: "2026-03-05", lines: [{ i: "it1", q: 1000 }] },
    { id: "e", t: "out", d: "2026-03-06", v: 1, lines: [{ i: "it1", q: -50000, p: 1509 }] },     // voided
    { id: "f", t: "out", d: "2026-07-01", lines: [{ i: "it1", q: -3000, p: 1509 }] },              // after the period
    { id: "g", t: "xfer", d: "2026-02-10", w2: "whshop1", lines: [{ i: "it1", q: 20000 }] }
  ]
};

test("ISBNs used here are valid", () => {
  assert.ok(P.parseIsbn(ISBN_PB).ok);
  assert.ok(P.parseIsbn(ISBN_EB).ok);
});

test("terms: cleaned, bounded, carried on the title; statements: a list that merges", () => {
  const d = pub();
  assert.deepEqual(d.titles[0].roy[0], { id: "r1", n: "Anna Writer", pct: 10, base: "list", k: "pb", adv: 50 });
  assert.equal(P.cleanRoy({ id: "x", n: "A", pct: 300, base: "?", k: "zz", adv: -1 }).pct, 0);
  assert.equal(P.cleanRoy({ id: "x", n: " " }), null);
  assert.equal(P.cleanStmt({ id: "s1", n: "A", from: "2026-07-01", to: "2026-01-01" }), null);
  const st = { id: "s1", m: 5, n: "Anna Writer", from: "2026-01-01", to: "2026-06-30", cur: "EUR",
               rows: [{ ti: "t1", tr: "r1", t: "Sea Wolves", k: "pb", isbn: ISBN_PB, q: 14, base: "list", u: 1600, b: 22400, pct: 10, e: 2240 }],
               rec: [{ ti: "t1", tr: "r1", adv: 5000, left: 5000, e: 2240, pay: 0 }], due: 0, paid: "" };
  const a = P.put(d, "stmts", st, 10), b = P.put(d, "stmts", Object.assign({}, st, { paid: "2026-07-10" }), 20);
  assert.equal(P.merge(a, b).stmts[0].paid, "2026-07-10");
  assert.deepEqual(P.merge(a, b), P.merge(b, a));
  assert.equal(P.normalize(P.merge(a, b)).stmts.length, 1);
});

test("sales: by ISBN, consignment at the shop's discount, returns at the average, voids and transfers ignored", () => {
  const s = R.sales(STOCK, ISBN_PB, "2026-01-01", "2026-06-30");
  assert.equal(s.found, true);
  assert.equal(s.q, 14);                         // 10 + 5 − 1
  // 10 × 15.09 + 5 × 15.09 × 0.6 = 150.90 + 45.27 = 196.17; avg 13.078 → − 13.08
  assert.equal(s.net, 19617 - 1308);
  assert.equal(R.sales(STOCK, ISBN_EB, "2026-01-01", "2026-06-30").found, false);
  assert.equal(R.sales(STOCK, "", "2026-01-01", "2026-06-30").q, 0);
  const closed = Object.assign({}, STOCK, { close: { d: "2026-03-31" } });
  assert.equal(R.sales(closed, ISBN_PB, "2026-01-01", "2026-06-30").closed, true);
});

test("build: a row per format the term covers, list or net, advance recouped first", () => {
  const d = pub();
  const st = R.build(d, STOCK, "ANNA WRITER", "2026-01-01", "2026-06-30", "EUR");
  assert.deepEqual(st.rows.map((r) => [r.ti, r.tr, r.k, r.q, r.b, r.e]), [
    ["t1", "r1", "pb", 14, 22400, 2240],         // 14 × 16.00 × 10 %
    ["t1", "r2", "eb", 0, 0, 0],                  // e-book: not in Stock, typed by hand
    ["t2", "r1", "pb", 0, 0, 0]
  ]);
  assert.deepEqual(st.warn.missing, ["Sea Wolves"]);
  assert.deepEqual(st.rec[0], { ti: "t1", tr: "r1", adv: 5000, left: 5000, e: 2240, pay: 0 });
  assert.equal(st.due, 0);
  // the e-book sales typed in: 100 at the net 5.00 → 25 %
  st.rows[1].q = 100; st.rows[1].u = 500;
  const st2 = R.recompute(st, d);
  assert.equal(st2.rows[1].e, 12500);
  assert.equal(st2.due, 12500);
  // issued; the next half recoups the rest of the advance
  const d2 = P.put(d, "stmts", Object.assign({}, st2, { id: "s1" }), 100);
  const next = R.build(d2, STOCK, "Anna Writer", "2026-07-01", "2026-12-31", "EUR");
  assert.equal(next.rows[0].q, 3);
  assert.equal(next.rows[0].e, 480);              // 3 × 16 × 10 %
  assert.equal(next.rec[0].left, 5000 - 2240);
  assert.equal(next.due, 0);
  // a voided earlier statement does not count
  const d3 = P.put(d2, "stmts", Object.assign({}, P.find(d2, "stmts", "s1"), { v: 1 }), 200);
  assert.equal(R.build(d3, STOCK, "Anna Writer", "2026-07-01", "2026-12-31", "EUR").rec[0].left, 5000);
  // someone else only sees their own term
  const ben = R.build(d, STOCK, "Ben Translator", "2026-01-01", "2026-06-30", "EUR");
  assert.equal(ben.rows.length, 1);
  assert.equal(ben.rows[0].ti, "t2");
});

test("people: everyone with terms, names folded together", () => {
  const ps = R.people(pub());
  assert.deepEqual(ps.map((p) => [p.n, p.titles.length]), [["Anna Writer", 2], ["Ben Translator", 1]]);
});

test("periods: last half, last year, last quarter before today", () => {
  assert.deepEqual(R.periods("2026-10-25"), [
    { id: "half", from: "2026-01-01", to: "2026-06-30" },
    { id: "year", from: "2025-01-01", to: "2025-12-31" },
    { id: "quarter", from: "2026-07-01", to: "2026-09-30" }
  ]);
  assert.deepEqual(R.periods("2026-02-03").map((p) => p.from + "/" + p.to), ["2025-07-01/2025-12-31", "2025-01-01/2025-12-31", "2025-10-01/2025-12-31"]);
});
