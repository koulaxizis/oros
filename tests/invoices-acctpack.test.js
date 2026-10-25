// The month's pack for the accountant in Invoices (publisher wave P11):
// months, Budget and Stock rows of a month, shop orders, CSV and sums.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const A = require(path.join(__dirname, "..", "invoices/acctpack.js"));

test("months and their days", () => {
  assert.deepEqual(A.months("2026-02-14", 4), ["2026-02", "2026-01", "2025-12", "2025-11"]);
  assert.deepEqual(A.monthRange("2026-02"), ["2026-02-01", "2026-02-28"]);
  assert.deepEqual(A.monthRange("2024-02"), ["2024-02-01", "2024-02-29"]);
});

test("budgetRows: the month only, tombstones out, receipt names checked", () => {
  const bud = {
    tx: [
      { id: "a", m: 1, d: "2026-09-03", k: "o", a: 1250, c: "o-bills", n: "Power", rc: "r1.jpg ../x.pdf r2.pdf" },
      { id: "b", m: 1, d: "2026-09-01", k: "i", a: 50000, c: "i-free", n: "Fee" },
      { id: "c", m: 1, d: "2026-10-01", k: "o", a: 100, c: "", n: "" },
      { id: "d", m: 5, d: "2026-09-09", k: "o", a: 100, c: "", n: "gone" }
    ],
    tombs: { d: 6 }
  };
  const rows = A.budgetRows(bud, "2026-09", (c) => c.toUpperCase());
  assert.deepEqual(rows.map((r) => [r.d, r.k, r.cat, r.a, r.rc]), [
    ["2026-09-01", "i", "I-FREE", 50000, []],
    ["2026-09-03", "o", "O-BILLS", 1250, ["r1.jpg", "r2.pdf"]]
  ]);
  assert.deepEqual(A.budgetRows(null, "2026-09"), []);
});

test("stockRows: purchases at cost, sales at price, voids / counts / transfers out; totals", () => {
  const stock = {
    items: [{ id: "i1", name: "Sea Wolves", sku: "978" }],
    sups: [{ id: "s1", name: "Printer" }],
    moves: [
      { id: "m1", t: "in", d: "2026-09-02", sup: "s1", ref: "INV-9", lines: [{ i: "i1", q: 500000, c: 300 }] },
      { id: "m2", t: "out", d: "2026-09-05", lines: [{ i: "i1", q: -3000, p: 1600 }] },
      { id: "m3", t: "ret", d: "2026-09-06", lines: [{ i: "i1", q: 1000, p: 1600 }] },
      { id: "m4", t: "out", d: "2026-09-07", v: 1, lines: [{ i: "i1", q: -9000, p: 1600 }] },
      { id: "m5", t: "count", d: "2026-09-08", lines: [{ i: "i1", q: 0, n: 1000 }] },
      { id: "m6", t: "xfer", d: "2026-09-08", lines: [{ i: "i1", q: 1000 }] },
      { id: "m7", t: "out", d: "2026-08-31", lines: [{ i: "i1", q: -1000, p: 1600 }] }
    ]
  };
  const rows = A.stockRows(stock, "2026-09-01", "2026-09-30");
  assert.deepEqual(rows.map((r) => [r.t, r.q, r.u, r.tot, r.sup]), [
    ["in", 500, 300, 150000, "Printer"], ["out", 3, 1600, 4800, ""], ["ret", 1, 1600, 1600, ""]
  ]);
  const orders = A.orderRows([
    { id: 2, d: "2026-09-20", st: "completed", total: 2000, tax: 113 },
    { id: 1, d: "2026-09-10", st: "cancelled", total: 900, tax: 0 },
    { id: 3, d: "2026-10-01", st: "completed", total: 500, tax: 0 }
  ], "2026-09-01", "2026-09-30");
  assert.deepEqual(orders.map((o) => o.id), [1, 2]);
  const tt = A.totals({ budget: A.budgetRows({ tx: [{ id: "x", m: 1, d: "2026-09-01", k: "o", a: 700 }, { id: "y", m: 1, d: "2026-09-02", k: "i", a: 900 }] }, "2026-09"), stock: rows, orders });
  assert.deepEqual(tt, { bin: 900, bout: 700, buy: 150000, sell: 3200, ord: 2000, ordN: 1, ordTax: 113 });
});

test("csv: ';', BOM, formulas defused; money in the language's decimal mark", () => {
  assert.equal(A.csv([["a;b", "=SUM(A1)", "x"]]), "﻿\"a;b\";'=SUM(A1);x\r\n");
  assert.equal(A.money(-12345, "el"), "-123,45");
  assert.equal(A.money(5, "en"), "0.05");
  assert.equal(A.qty(2.5, "el"), "2,5");
});

test("Invoices loads the pack, Woo orders through links, and offers it on the Dashboard", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "invoices/index.html"), "utf8");
  assert.match(html, /<script src="\.\.\/links\/woo\.js[^"]*"><\/script>\s*<script src="acctpack\.js/);
  assert.match(html, /id="acct-pack"/);
  const js = fs.readFileSync(path.join(__dirname, "..", "invoices/invoices.js"), "utf8");
  assert.match(js, /\$\("acct-pack"\)\.addEventListener\("click", openAcctPack\)/);
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  assert.match(sw, /"invoices\/acctpack\.js"/);
});
