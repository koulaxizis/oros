// Stock wave 46: the point of sale. Pure rules (stock/pos-core.js),
// the stored shapes and their merge (stock/core.js normSale / normPl /
// normZ / mergeSales: two registers never lose a sale, old data stays
// byte-identical) and the wiring of the till into the app.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../stock/core.js");
const P = require("../stock/pos-core.js");

const NOW = Date.UTC(2026, 9, 14, 10, 0, 0);
const DAY = "2026-10-14";
function item(id, extra) { return Object.assign({ id, m: 1000, name: "Item " + id, unit: "pcs" }, extra || {}); }
function data(o) { return Object.assign({ items: [], cats: [], units: [], sups: [], moves: [], tombs: {} }, o || {}); }
function m(a, b) { return C.merge(a, b, NOW); }
function k(n) { return n * 1000; }

const ITEMS = [item("coffee1", { price: 200, vat: 24 }), item("cake01", { price: 350, vat: 13 }), item("bag001", { price: 10, vat: 24 })];

test("price lists: own price, else sale price ± %, retail is the sale price", () => {
  const d = { items: ITEMS, pls: [{ id: "whole1", m: 1, name: "Wholesale", pct: -10, p: { cake01: 300 } }] };
  assert.equal(P.priceOf(d, ITEMS[0], ""), 200);
  assert.equal(P.priceOf(d, ITEMS[0], "whole1"), 180);
  assert.equal(P.priceOf(d, ITEMS[1], "whole1"), 300);
  assert.equal(P.priceOf(d, ITEMS[0], "gone01"), 200);
  assert.equal(P.priceOf(d, null, ""), 0);
});

test("totals: VAT per rate on the sum of its lines; change", () => {
  const tt = P.totals([{ q: k(3), p: 200, vat: 24 }, { q: k(1), p: 350, vat: 13 }, { q: 1500, p: 10, vat: 24 }]);
  assert.equal(tt.net, 600 + 350 + 15);
  assert.deepEqual(tt.byVat.map((r) => [r.rate, r.net, r.vat]), [[24, 615, 148], [13, 350, 46]]);
  assert.equal(tt.gross, tt.net + 148 + 46);
  assert.equal(P.change(1000, 2000), 1000);
  assert.equal(P.change(1000, 999), null);
  assert.equal(P.change(1000, undefined), null);
});

test("receipt numbers count per device and day", () => {
  const sales = [{ no: "AB-261014-001" }, { no: "AB-261014-007" }, { no: "CD-261014-009" }, { no: "AB-261013-050" }];
  assert.equal(P.nextNo(sales, DAY, "AB"), "AB-261014-008");
  assert.equal(P.nextNo(sales, DAY, "EF"), "EF-261014-001");
  assert.match(P.devCode(() => 0.5), /^[A-Z2-9]{2}$/);
});

test("a sale: lines at the list's price, one out movement with the same lines", () => {
  const d = data({ items: ITEMS });
  const r = P.makeSale({ data: d, cart: [{ i: "coffee1", q: k(2) }, { i: "cake01", q: k(1), p: 333 }, { i: "nope01", q: k(1) }, { i: "bag001", q: 0 }],
    pl: "", pay: "cash", given: 2000, d: DAY, now: NOW, dev: "AB", id: "sale0001", mvId: "move0001" });
  assert.equal(r.sale.no, "AB-261014-001");
  assert.deepEqual(r.sale.lines.map((l) => [l.i, l.q, l.p, l.vat]), [["coffee1", 2000, 200, 24], ["cake01", 1000, 333, 13]]);
  assert.equal(r.sale.mv, "move0001");
  assert.equal(r.sale.given, 2000);
  assert.equal(r.move.t, "out");
  assert.equal(r.move.src, "pos:sale0001");
  assert.equal(r.move.ref, r.sale.no);
  assert.deepEqual(r.move.lines, [{ i: "coffee1", q: -2000, p: 200 }, { i: "cake01", q: -1000, p: 333 }]);
  assert.equal(P.makeSale({ data: d, cart: [], d: DAY, now: NOW, id: "sale0002", mvId: "move0002" }), null);
  // stored: normalizes, and the stock comes off
  const d2 = m(Object.assign({}, d, { sales: [r.sale], moves: [r.move] }), null);
  assert.equal(d2.sales.length, 1);
  assert.equal(C.qtyMap(d2).coffee1, -2000);
});

test("sync: two registers selling at once keep both sales; a void wins", () => {
  const base = data({ items: ITEMS, moves: [{ id: "open001", m: 1, t: "in", d: "2026-10-01", lines: [{ i: "coffee1", q: k(10) }] }] });
  const a = P.makeSale({ data: base, cart: [{ i: "coffee1", q: k(1) }], pay: "card", d: DAY, now: NOW, dev: "AA", id: "salea001", mvId: "movea001" });
  const b = P.makeSale({ data: base, cart: [{ i: "coffee1", q: k(2) }], pay: "cash", d: DAY, now: NOW + 5, dev: "BB", id: "saleb001", mvId: "moveb001" });
  const A = m(Object.assign({}, base, { sales: [a.sale], moves: base.moves.concat([a.move]) }), null);
  const B = m(Object.assign({}, base, { sales: [b.sale], moves: base.moves.concat([b.move]) }), null);
  const AB = m(A, B), BA = m(B, A);
  assert.equal(JSON.stringify(AB), JSON.stringify(BA));
  assert.equal(AB.sales.length, 2);
  assert.equal(C.qtyMap(AB).coffee1, k(7));
  assert.equal(JSON.stringify(m(AB, AB)), JSON.stringify(AB), "idempotent");
  // A voids its sale (older m on purpose): the void still wins
  const Av = JSON.parse(JSON.stringify(AB));
  Av.sales[0].v = 1; Av.sales[0].m = 1;
  const newer = JSON.parse(JSON.stringify(AB));
  newer.sales[0].m = NOW + 99999;
  const merged = m(newer, Av);
  assert.equal(merged.sales.find((s) => s.id === Av.sales[0].id).v, 1);
  assert.deepEqual(C.mergeSales(null, undefined), []);
});

test("old data stays byte-identical; a 1.6 device drops the new lists harmlessly", () => {
  const old = m(data({ items: ITEMS }), null);
  assert.ok(!("sales" in old) && !("pls" in old) && !("zs" in old));
  assert.equal(JSON.stringify(m(old, old)), JSON.stringify(old));
  const withPos = m(Object.assign({}, old, {
    pls: [{ id: "whole1", m: 5, name: " Wholesale ", pct: -10, p: { cake01: 300, BAD: 5, bag001: -4 } }],
    zs: [{ id: "z20261014", m: 5, d: DAY, at: NOW, no: 1, n: 2, g: 1000, net: 800, vat: 200, cash: 1000, card: 0, other: 0 },
         { id: "z20261015", m: 5, d: DAY, at: NOW, no: 2 }]
  }), null);
  assert.deepEqual(withPos.pls, [{ id: "whole1", m: 5, name: "Wholesale", pct: -10, p: { cake01: 300 } }]);
  assert.equal(withPos.zs.length, 1, "a Z row's id must match its day");
  // a price list deleted on one device stays deleted
  const del = JSON.parse(JSON.stringify(withPos));
  del.pls = []; del.tombs.whole1 = NOW;
  assert.ok(!("pls" in m(withPos, del)));
});

test("normSale: strict lines, voids kept, junk dropped", () => {
  assert.equal(C.normSale({ id: "sale0001", m: 1, d: DAY, lines: [] }), null);
  assert.equal(C.normSale({ id: "sale0001", m: 1, d: "x", lines: [{ i: "coffee1", q: 1, p: 1 }] }), null);
  const s = C.normSale({ id: "sale0001", m: 1, d: DAY, at: NOW, no: "AB-261014-001", pay: "bitcoin", v: 1,
    lines: [{ i: "coffee1", q: 1000, p: 200, vat: 24, n: "Coffee" }, { i: "coffee1", q: -1, p: 1 }, { i: "X", q: 1, p: 1 }] });
  assert.equal(s.pay, "cash");
  assert.equal(s.v, 1);
  assert.equal(s.lines.length, 1);
});

test("Z report: live sales by payment, VAT and price list; voids apart; close", () => {
  const d = data({ items: ITEMS, pls: [{ id: "whole1", m: 1, name: "W", pct: -10, p: {} }] });
  let all = [];
  function sell(id, cart, pay, pl, at) {
    const r = P.makeSale({ data: Object.assign({}, d, { sales: all }), cart, pay, pl, d: DAY, now: at, dev: "AB", id, mvId: "mv" + id });
    all = all.concat([r.sale]);
    return r.sale;
  }
  sell("sale0001", [{ i: "coffee1", q: k(2) }], "cash", "", NOW);
  sell("sale0002", [{ i: "cake01", q: k(1) }], "card", "whole1", NOW + 1000);
  const v = sell("sale0003", [{ i: "coffee1", q: k(5) }], "cash", "", NOW + 2000);
  v.v = 1;
  const dd = Object.assign({}, d, { sales: all });
  const rep = P.zReport(dd, DAY);
  assert.equal(rep.n, 2);
  assert.equal(rep.voids, 1);
  assert.equal(rep.byPay.cash, 496);
  assert.equal(rep.byPay.card, 315 + 41);
  assert.equal(rep.g, 496 + 356);
  assert.deepEqual(Object.keys(rep.byPl).sort(), ["", "whole1"]);
  assert.equal(rep.top[0].i, "coffee1");
  assert.equal(rep.first, NOW);
  assert.equal(rep.last, NOW + 1000);
  assert.equal(rep.z, null);
  const z = P.zRow(rep, NOW + 3000, P.nextZ(dd));
  assert.equal(z.id, "z20261014");
  assert.equal(z.no, 1);
  assert.ok(C.normZ(z));
  const closed = Object.assign({}, dd, { zs: [z], sales: all.concat([{ id: "sale0004", d: DAY, at: NOW + 4000, pay: "card", no: "x", lines: [{ i: "bag001", q: 1000, p: 10, vat: 24 }] }]) });
  const rep2 = P.zReport(closed, DAY);
  assert.equal(rep2.z.no, 1);
  assert.equal(rep2.after, 1);
  assert.equal(P.nextZ(closed), 2);
  assert.equal(P.zReport(dd, "2026-10-13").n, 0);
});

test("receipt rows: header, lines with VAT, totals, change, footer", () => {
  const sale = { no: "AB-261014-001", pay: "cash", given: 1000, lines: [{ i: "coffee1", q: 2000, p: 200, vat: 24, n: "Coffee" }] };
  const rows = P.receiptRows(sale, { head: "Shop\n\n  Street 1 ", foot: "Thanks", money: (c) => (c / 100).toFixed(2), qty: (l) => String(l.q / 1000), when: "today",
    labels: { payName: { cash: "Cash" } } });
  assert.deepEqual(rows.filter((r) => r.k === "head").map((r) => r.l), ["Shop", "Street 1"]);
  assert.deepEqual(rows.find((r) => r.k === "item"), { k: "item", l: "Coffee", r: "4.96" });
  assert.equal(rows.find((r) => r.k === "total").r, "4.96");
  assert.ok(rows.some((r) => r.l === "Change" && r.r === "5.04"));
  assert.equal(rows[rows.length - 1].l, "Thanks");
});

test("wiring: the till is loaded, opened from New, and escapes its printouts", () => {
  const html = fs.readFileSync(path.join(__dirname, "../stock/index.html"), "utf8");
  assert.ok(html.indexOf('src="pos-core.js') > html.indexOf('src="core.js'));
  assert.ok(html.indexOf('src="pos.js') < html.indexOf('src="stock.js'));
  const js = fs.readFileSync(path.join(__dirname, "../stock/stock.js"), "utf8");
  assert.ok(js.indexOf('t("add.pos"), openPos') > 0);
  assert.ok(js.indexOf("window.OrosStockPos.open(") > 0);
  ["\"add.pos\": \"Point of sale", "\"add.pos\": \"Σημείο πώλησης"].forEach((s) => assert.ok(js.indexOf(s) > 0, s));
  const pos = fs.readFileSync(path.join(__dirname, "../stock/pos.js"), "utf8");
  assert.ok(!/innerHTML\s*=\s*[^"]/.test(pos.replace(/innerHTML = ""/g, "")), "no innerHTML from data");
  assert.ok(/api\.esc\(r\.l\)/.test(pos) && /api\.esc\(r\.r\)/.test(pos));
});
