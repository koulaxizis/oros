// Stock fair till, wave F1 (data 1.9): discounts per line and on the
// whole sale, split payment, free items without stock, the receipt's
// rows and text, and the merge with a 1.8 device that strips the new
// fields (its totals and stock stay right; the richer copy wins a tie).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../stock/core.js");
const P = require("../stock/pos-core.js");

const NOW = Date.UTC(2026, 10, 13, 10, 0, 0);
const DAY = "2026-11-13";
const k = (n) => n * 1000;
function item(id, extra) { return Object.assign({ id, m: 1000, name: "Book " + id, unit: "pcs" }, extra || {}); }
function data(o) { return Object.assign({ items: [], cats: [], units: [], sups: [], moves: [], tombs: {} }, o || {}); }
const ITEMS = [item("book01", { price: 1415, vat: 6 }), item("book02", { price: 1887, vat: 6 }), item("tote01", { price: 806, vat: 24 })];
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("netFor: the net whose gross is nearest to the typed price", () => {
  assert.equal(P.grossOf(P.netFor(1500, 6), 6), 1500);
  assert.equal(P.grossOf(P.netFor(2000, 24), 24), 2000);
  assert.ok(Math.abs(P.grossOf(P.netFor(1000, 24), 24) - 1000) <= 1);
  assert.equal(P.netFor(0, 24), 0);
  assert.equal(P.netFor(999, 0), 999);
});

test("line discounts: % on the unit price, an amount off the line's gross", () => {
  const out = P.applyDisc([
    { i: "book01", q: k(1), p0: 1415, vat: 6, dl: { k: "pct", v: 10 } },
    { i: "book02", q: k(2), p0: 1887, vat: 6, dl: { k: "amt", v: 400 } },
    { i: "tote01", q: k(1), p0: 806, vat: 24 }
  ], null);
  assert.equal(out[0].p, 1274);
  assert.equal(out[0].p0, 1415);
  // two books at 20.00 gross = 40.00; 4.00 off → 36.00 (± a cent of VAT rounding)
  const g1 = P.totals([out[1]]).gross;
  assert.ok(Math.abs(g1 - 3600) <= 1, String(g1));
  assert.ok(!("p0" in out[2]), "no discount, no p0");
  assert.ok(!("dl" in out[0]), "dl never leaves the cart");
  assert.equal(P.saved([out[2]]), 0);
});

test("whole-sale discount: % per line; an amount spread by gross, exact on single units", () => {
  const lines = [{ i: "book01", q: k(1), p0: 1415, vat: 6 }, { i: "book02", q: k(1), p0: 1887, vat: 6 }];
  const pct = P.applyDisc(lines, { k: "pct", v: 20 });
  assert.deepEqual(pct.map((l) => l.p), [1132, 1510]);
  const before = P.totals(P.applyDisc(lines, null)).gross;     // 15.00 + 20.00
  assert.equal(before, 3500);
  const amt = P.applyDisc(lines, { k: "amt", v: 500 });
  assert.equal(P.totals(amt).gross, 3000);
  assert.equal(P.saved(amt), 500);
  // the till's case: two books at 10 % off, a typed free item, then 2.00 off the whole sale
  const mixed = P.applyDisc([
    { i: "book02", q: k(2), p0: 1887, vat: 6, dl: { k: "pct", v: 10 } },
    { i: "book01", q: k(1), p0: 1415, vat: 6 },
    { i: P.OTHER, q: k(1), p0: P.netFor(500, 24), vat: 24, n: "Poster" }
  ], null);
  const g0 = P.totals(mixed).gross;
  const off2 = P.applyDisc(mixed.map((l) => Object.assign({}, l, { p0: l.p })), { k: "amt", v: 200 });
  assert.equal(P.totals(off2).gross, g0 - 200);
  assert.equal(P.discPct(amt), 14.3);
  // more off than the sale costs: everything is free, never negative
  const all = P.applyDisc(lines, { k: "amt", v: 99999 });
  assert.ok(all.every((l) => l.p === 0));
  // nonsense is ignored
  assert.deepEqual(P.applyDisc(lines, { k: "pct", v: -5 }).map((l) => l.p), [1415, 1887]);
  assert.deepEqual(P.applyDisc(lines, { k: "x", v: 5 }).map((l) => l.p), [1415, 1887]);
});

test("a sale with a discount, a split payment and a free item", () => {
  const d = data({ items: ITEMS });
  const charged = P.applyDisc([
    { i: "book01", q: k(2), p0: 1415, vat: 6 },
    { i: P.OTHER, q: k(1), p0: P.netFor(500, 24), vat: 24, n: "Tote bag" }
  ], { k: "pct", v: 10 });
  const g = P.totals(charged).gross;
  const r = P.makeSale({ data: d, cart: charged, pl: "", pay: "cash", pays: { cash: 1000, card: g - 1000 }, dc: "Students",
    given: 2000, d: DAY, now: NOW, dev: "AB", id: "sale0001", mvId: "move0001" });
  assert.equal(r.sale.dc, "Students");
  assert.deepEqual(r.sale.pays, { cash: 1000, card: g - 1000 });
  assert.equal(r.sale.pay, "card", "pay = the largest part");
  assert.equal(r.sale.lines[1].i, P.OTHER);
  assert.equal(r.sale.lines[1].n, "Tote bag");
  assert.equal(r.sale.lines[0].p0, 1415);
  // the movement carries only the stock lines
  assert.deepEqual(r.move.lines, [{ i: "book01", q: -2000, p: r.sale.lines[0].p }]);
  // stored: normalized with the new fields, stock right, free item never in stock
  const d2 = C.merge(Object.assign({}, d, { sales: [r.sale], moves: [r.move] }), null, NOW);
  const s = d2.sales[0];
  assert.equal(s.dc, "Students");
  assert.deepEqual(s.pays, r.sale.pays);
  assert.equal(s.lines[0].p0, 1415);
  assert.equal(C.qtyMap(d2).book01, -2000);
  assert.ok(!(P.OTHER in C.qtyMap(d2)));
  // Z: split parts counted apart, discounts summed
  const z = P.zReport(d2, DAY);
  assert.equal(z.byPay.cash, 1000);
  assert.equal(z.byPay.card, g - 1000);
  assert.equal(z.g, g);
  assert.equal(z.splits, 1);
  assert.equal(z.disc, P.saved(s.lines));
  assert.ok(z.top.some((x) => x.n === "Tote bag"));
  // receipt rows: was price, discount line with its reason, both parts, change from the cash part
  const rows = P.receiptRows(s, { money: (c) => (c / 100).toFixed(2), qty: (l) => String(l.q / 1000), labels: { was: "was", disc: "Discount" } });
  assert.ok(rows.some((x) => x.l.indexOf("was ") === 0));
  assert.ok(rows.some((x) => x.l === "Discount · Students" && x.r.indexOf("−") === 0));
  assert.equal(rows.filter((x) => x.l.indexOf("Paid · ") === 0).length, 2);
  assert.ok(rows.some((x) => x.l === "Change" && x.r === "10.00"));
  const txt = P.receiptText(rows);
  assert.match(txt, /Tote bag/);
  assert.ok(txt.length < 1200);
});

test("a sale of free items only has no movement", () => {
  const r = P.makeSale({ data: data({ items: ITEMS }), cart: [{ i: P.OTHER, q: k(1), p: 400, vat: 0, n: "Ticket" }],
    pay: "cash", d: DAY, now: NOW, dev: "AB", id: "sale0002", mvId: "move0002" });
  assert.equal(r.move, null);
  assert.ok(!("mv" in r.sale));
  assert.equal(P.makeSale({ data: data(), cart: [{ i: P.OTHER, q: k(1), p: 400, vat: 0, n: "" }], d: DAY, now: NOW, id: "sale0003", mvId: "m" }), null);
});

test("split parts that do not add up are not stored as a split", () => {
  const r = P.makeSale({ data: data({ items: ITEMS }), cart: [{ i: "book01", q: k(1) }], pay: "cash", pays: { cash: 100, card: 100 },
    d: DAY, now: NOW, dev: "AB", id: "sale0004", mvId: "move0004" });
  assert.ok(!("pays" in r.sale));
  assert.equal(r.sale.pay, "cash");
  // an edited copy whose parts no longer match falls back to pay
  const s = Object.assign({}, r.sale, { pays: { cash: 1, card: 2 } });
  assert.deepEqual(P.payParts(s), { cash: P.totals(s.lines).gross, card: 0, other: 0 });
  // normSale keeps only two or more positive parts, a known method each
  assert.ok(!("pays" in C.normSale(Object.assign({}, r.sale, { pays: { cash: 1500 } }))));
  assert.deepEqual(C.normSale(Object.assign({}, r.sale, { pays: { cash: 500, card: 1000, gold: 7 } })).pays, { cash: 500, card: 1000 });
});

test("normSale: p0 only above p, dc capped and cleaned", () => {
  const s = C.normSale({ id: "sale0005", m: 1, d: DAY, lines: [{ i: "book01", q: 1000, p: 500, p0: 400, vat: 6 }, { i: "book02", q: 1000, p: 500, p0: 600, vat: 6 }],
    dc: "x".repeat(90) });
  assert.ok(!("p0" in s.lines[0]));
  assert.equal(s.lines[1].p0, 600);
  assert.equal(s.dc.length, 40);
  const plain = C.normSale({ id: "sale0006", m: 1, d: DAY, lines: [{ i: "book01", q: 1000, p: 500, vat: 6 }] });
  assert.ok(!("dc" in plain) && !("pays" in plain) && !("p0" in plain.lines[0]), "a 1.7 sale stays byte-identical");
});

test("sync with a 1.8 device: the stripped copy never wins a tie, totals stay right either way", () => {
  const rich = C.normSale({ id: "sale0007", m: 5, d: DAY, pay: "card", pays: { cash: 500, card: 1000 }, dc: "Fair",
    lines: [{ i: "book01", q: 1000, p: 1415, p0: 1600, vat: 6 }] });
  const old = { id: "sale0007", m: 5, d: DAY, at: 0, no: "", pay: "card", lines: [{ i: "book01", q: 1000, p: 1415, vat: 6, n: "" }] };
  const ab = C.mergeSales([rich], [old]), ba = C.mergeSales([old], [rich]);
  assert.deepEqual(ab, ba);
  assert.equal(ab[0].dc, "Fair");
  assert.deepEqual(ab[0].pays, { cash: 500, card: 1000 });
  assert.equal(P.totals(old.lines).gross, P.totals(rich.lines).gross, "p is what was charged on both copies");
  // a void still wins over the richer copy
  const voided = Object.assign({}, old, { v: 1, m: 1 });
  assert.equal(C.mergeSales([rich], [voided])[0].v, 1);
});

test("wiring: the till offers discounts, split, other items, PDF and QR; strings in EN, EL and DE", () => {
  const js = read("stock/pos.js");
  ["discDialog", "otherDialog", "receiptPdf", "qrDialog", "P.applyDisc", "dmax", "splitParts"].forEach((n) => assert.ok(js.indexOf(n) >= 0, n));
  assert.deepEqual((js.match(/innerHTML\s*=\s*[^;]+;/g) || []).filter((x) => !/innerHTML\s*=\s*"";/.test(x)), [], "innerHTML only ever cleared");
  const de = read("i18n/de/stock.js");
  ["discT", "discSale", "split", "otherT", "share", "qr", "qrLong", "stDmax", "zDisc"].forEach((key) => {
    assert.ok(js.indexOf(key + ": \"") >= 0, key + " in EN/EL");
    assert.ok(de.indexOf('"' + key + '":') >= 0, key + " in DE");
  });
  const st = read("stock/stock.js");
  assert.match(st, /if \(move\) data\.moves\.push\(move\)/);
  assert.match(st, /dmax:/);
});
