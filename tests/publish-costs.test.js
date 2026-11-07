// Cost & result per title in Publishing (wave P15): Production
// Ledger's records and Revenue Splitter's splits read from the shop,
// matched to a title by its formats (the product sent to the shop, or
// the ISBN as SKU), summed net of VAT; the publisher's own shares are
// not a cost; pooled and general costs are left out.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const P = require(path.join(__dirname, "..", "publish/core.js"));
const K = require(path.join(__dirname, "..", "publish/costs.js"));

function pub() {
  return P.normalize({
    ver: 1,
    titles: [
      { id: "t1", m: 1, t: "Book one", st: "out", ppl: [], fmts: [{ id: "f1", k: "pb", isbn: "9786185321000", wp: { a: "shop", id: 101 } }] },
      { id: "t2", m: 1, t: "Book two", st: "out", ppl: [], fmts: [{ id: "f2", k: "pb", isbn: "9786185321017" }] },
      { id: "t3", m: 1, t: "Book three", st: "idea", ppl: [], fmts: [] }
    ],
    set: { m: 1, cur: "EUR", imp: "Seagull Press", own: "SEAGULLS, Seagull Books" }
  });
}

const RECS = [
  { id: "o1-p101", m: 5, k: "i", d: "2026-09-03", a: 1000, v: 60, cat: "sales", pid: 101, qty: 2 },
  { id: "o2-p101", m: 5, k: "i", d: "2026-09-10", a: 2000, v: 120, cat: "trade", pid: 101, qty: 5 },
  { id: "o2-s", m: 5, k: "i", d: "2026-09-10", a: 300, v: 72, cat: "shipping_in" },
  { id: "o3-p101", m: 6, del: 1 },
  { id: "o4-p202", m: 5, k: "i", d: "2026-10-01", a: 900, v: 54, cat: "sales", pid: 202, qty: 1 },
  { id: "e1", m: 5, k: "o", d: "2026-08-20", a: 50000, v: 3000, cat: "printing", scope: "product", pid: 101, supplier: "Print Co", inv: "A-17", note: "500 copies" },
  { id: "e2", m: 5, k: "o", d: "2026-08-01", a: 20000, v: 4800, cat: "editing", scope: "product", pid: 101, supplier: "Ed", inv: "", note: "" },
  { id: "e3", m: 5, k: "o", d: "2026-08-15", a: 5000, v: 1200, cat: "printing", scope: "product", pid: 101, supplier: "Print Co", inv: "A-12" },
  { id: "e4", m: 5, k: "i", d: "2026-09-20", a: 1500, v: 90, cat: "offsite", scope: "product", pid: 101, note: "Book fair" },
  { id: "e5", m: 5, k: "o", d: "2026-09-01", a: 999, v: 0, cat: "shipping", scope: "pool", pool: "orders", pid: 0 },
  { id: "e6", m: 5, k: "o", d: "2026-09-01", a: 777, v: 0, cat: "general", scope: "general", pid: 0 },
  { id: "e7", m: 9, del: 1 },
  { id: "e8", m: 5, k: "o", d: "2026-09-05", a: 300, v: 0, cat: "mystery", scope: "product", pid: 101 }
];
const RS = {
  sales_since: "2026-09-01",
  products: [
    { product_id: 101, splits: [{ name: "SEAGULLS", percent: 50, amount: 1500 }, { name: "Ana Writer", percent: 50, amount: 1500 }] },
    { product_id: 303, splits: [{ name: "Someone", percent: 100, amount: 999 }] }
  ]
};

test("requests stay inside what the shop link allows", () => {
  assert.deepEqual(K.recReq("2026-01-01", "2026-11-07", 2), { m: "GET", path: "/pl/records?from=2026-01-01&to=2026-11-07&page=2&per_page=500" });
  assert.deepEqual(K.recReq("", "2026-11-07", 1), { m: "GET", path: "/pl/records?to=2026-11-07&page=1&per_page=500" });
  assert.deepEqual(K.rsReq("2026-09-01", "2026-11-07"), { m: "GET", path: "/rs/report?date_start=2026-09-01&date_end=2026-11-07" });
  const L = require(path.join(__dirname, "..", "links/core.js"));
  assert.equal(L.checkReq("woo", K.recReq("2026-01-01", "2026-11-07", 3)), "");
  assert.equal(L.checkReq("woo", K.rsReq("2026-09-01", "2026-11-07")), "");
  assert.equal(L.checkReq("woo", { m: "GET", path: "/products/101" }), "");
  assert.deepEqual(K.repReq("", "2026-11-07"), { m: "GET", path: "/pl/report?to=2026-11-07" });
  assert.equal(L.checkReq("woo", K.repReq("2026-01-01", "2026-11-07")), "");
  assert.equal(L.checkReq("woo", K.repReq("", "")), "");
});

test("a title's products: the format sent to the shop, or the ISBN as SKU", () => {
  const d = pub();
  assert.deepEqual(K.pidsOf(d.titles[0], "shop", {}), { 101: "f1" });
  assert.deepEqual(K.pidsOf(d.titles[0], "other", {}), {});
  assert.deepEqual(K.pidsOf(d.titles[1], "shop", {}), {});
  assert.deepEqual(K.pidsOf(d.titles[1], "shop", { 202: "9786185321017" }), { 202: "f2" });
  assert.deepEqual(K.unknownPids(RECS, d, "shop"), [202]);
  // SKU digits only: a hyphenated SKU matches; a wrong id or a short SKU does not
  assert.deepEqual(K.skuMap([202, 203, 204], [{ id: 202, sku: "978-618-5321-01-7" }, { id: 999, sku: "9786185321024" }, { id: 204, sku: "ABC" }]), { 202: "9786185321017" });
});

test("the publisher's names: set.imp, set.own, folded, one inside the other", () => {
  const set = pub().set;
  assert.equal(K.isOwn("SEAGULLS", set), true);
  assert.equal(K.isOwn("seagull books", set), true);
  assert.equal(K.isOwn("Seagull Press Ltd", set), true);
  assert.equal(K.isOwn("Ana Writer", set), false);
  assert.equal(K.isOwn("", set), false);
  assert.equal(K.isOwn("Γλαρόλυκοι", { imp: "Ανεξάρτητες Εκδόσεις ΓΛΑΡΟΛΥΚΟΙ" }), true);
});

test("one title: income, costs by category with their invoices, shares, result", () => {
  const d = pub();
  const f = K.forTitle(RECS, { 101: true }, RS, d.set);
  assert.equal(f.any, true);
  assert.deepEqual(f.inc.sales, { q: 2, a: 1000 });
  assert.deepEqual(f.inc.trade, { q: 5, a: 2000 });
  assert.equal(f.inc.offsite.a, 1500);
  assert.equal(f.incA, 4500);
  assert.deepEqual(f.costs.map(c => [c.cat, c.a]), [["printing", 55000], ["editing", 20000], ["general", 300]]);
  // oldest first inside a category, with supplier and invoice
  assert.deepEqual(f.costs[0].rows.map(r => [r.d, r.sup, r.inv]), [["2026-08-15", "Print Co", "A-12"], ["2026-08-20", "Print Co", "A-17"]]);
  assert.equal(f.costA, 75300);
  // pooled (e5) and general (e6) entries are not the title's; deleted rows don't count
  assert.ok(!f.costs.some(c => c.rows.some(r => r.id === "e5" || r.id === "e6")));
  assert.deepEqual(f.shares, [{ n: "Ana Writer", a: 1500, own: false }, { n: "SEAGULLS", a: 1500, own: true }]);
  assert.equal(f.shareA, 1500);
  assert.equal(f.net, 4500 - 75300 - 1500);
  assert.equal(f.first, "2026-08-01");
  assert.equal(f.last, "2026-09-20");
  assert.equal(f.rsSince, "2026-09-01");
});

test("nothing in the shop, no splits, bad rows: nothing counted, nothing thrown", () => {
  const f = K.forTitle([null, { id: 5 }, { id: "e9", pid: 500, k: "o", a: -5 }], { 101: true }, null, {});
  assert.equal(f.any, false);
  assert.equal(f.net, 0);
  const g = K.forTitle([{ id: "e1", m: 1, k: "o", d: "2026-01-01", a: 1.5, v: 0, cat: "printing", scope: "product", pid: 101 }], { 101: true }, { products: "x" }, {});
  assert.equal(g.costA, 0);          // not whole cents: counted as 0
});

test("overview: titles with something in the shop, biggest cost first", () => {
  const d = pub();
  const rows = K.overview(d, "shop", RECS, RS, { 202: "9786185321017" });
  assert.deepEqual(rows.map(r => [r.id, r.inc, r.cost, r.share, r.n]), [["t1", 4500, 75300, 1500, 7], ["t2", 900, 0, 0, 1]]);
  assert.equal(rows[0].net, 4500 - 75300 - 1500);
});

test("read: every page of every window, currency and shape checked", async () => {
  const asked = [];
  function env(from, to, page, pages, recs, start) {
    return { source: "production-ledger", currency: "EUR", from, to, start, pages, page, records: recs, months: {} };
  }
  // a short history: one window, two pages
  let r = await K.read(req => {
    asked.push(req.path);
    if (/page=1/.test(req.path)) return Promise.resolve(env("2026-09-01", "2026-11-07", 1, 2, [{ id: "e1" }], "2026-09-01"));
    return Promise.resolve(env("2026-09-01", "2026-11-07", 2, 2, [{ id: "e2" }], "2026-09-01"));
  }, "2026-11-07", "EUR");
  assert.deepEqual(r.recs.map(x => x.id), ["e1", "e2"]);
  assert.equal(r.start, "2026-09-01");
  assert.deepEqual(asked, ["/pl/records?to=2026-11-07&page=1&per_page=500", "/pl/records?from=2026-09-01&to=2026-11-07&page=2&per_page=500"]);
  // a longer history: windows of 390 days, oldest first
  asked.length = 0;
  r = await K.read(req => {
    asked.push(req.path);
    const m = /from=(\d{4}-\d{2}-\d{2})/.exec(req.path);
    return Promise.resolve(env(m ? m[1] : "2025-11-07", "2026-11-07", 1, 1, [{ id: m ? m[1] : "first" }], "2024-01-01"));
  }, "2026-11-07", "EUR");
  assert.equal(asked.length, 4);
  assert.deepEqual(r.recs.map(x => x.id), ["2024-01-01", "2025-01-25", "2026-02-19"]);
  // another currency, or not Production Ledger: refused with a code
  await assert.rejects(K.read(() => Promise.resolve(Object.assign(env("2026-01-01", "2026-11-07", 1, 1, [], "2026-01-01"), { currency: "USD" })), "2026-11-07", "EUR"), e => e.code === "cur" && e.params.c === "USD");
  await assert.rejects(K.read(() => Promise.resolve({ hello: 1 }), "2026-11-07", "EUR"), e => e.code === "nopl");
});

test("set.own is kept, trimmed and bounded; Publishing loads costs.js", () => {
  const d = P.setSet(pub(), { own: "  A, B  " }, 10);
  assert.equal(d.set.own, "A, B");
  assert.equal(P.setSet(pub(), { own: "x".repeat(400) }, 10).set.own.length, 300);
  assert.equal(P.setSet(pub(), { own: "" }, 10).set.own, undefined);
  const fs = require("fs");
  const html = fs.readFileSync(path.join(__dirname, "..", "publish/index.html"), "utf8");
  assert.ok(html.indexOf('src="costs.js') > html.indexOf('src="core.js') && html.indexOf('src="costs.js') < html.indexOf('src="app.js'));
  assert.ok(/data-tab="cost"/.test(html) && /id="view-cost"/.test(html));
});

// The ledger's report (Production Ledger 1.1, cents), as /pl/report answers it
const REP = {
  source: "production-ledger", currency: "EUR", start: "2026-08-01", from: "2026-08-01", to: "2026-11-07",
  products: [
    { pid: 101, title: "Book one", units_retail: 2, units_trade: 5, retail: 1000, trade: 2000, offsite: 1500, revenue: 4500,
      vat_out: 270, vat_in: 9000, creators_rs: 1500, shipping_charged: 250, shipping_cost: 400, consumables: 60, payment_fees: 35,
      costs: { printing: 55000, editing: 20000 }, costs_total: 76995, net: -72245, net_since_start: -72245, break_even: 170 },
    { pid: 202, title: "Book two", units_retail: 1, units_trade: 0, retail: 900, trade: 0, offsite: 0, revenue: 900,
      vat_out: 54, vat_in: 0, creators_rs: 0, shipping_charged: 0, shipping_cost: 100, consumables: 10, payment_fees: 20,
      costs: {}, costs_total: 130, net: 770, net_since_start: 770, break_even: null },
    { pid: 900, title: "Mug", units_retail: 3, units_trade: 0, retail: 1500, trade: 0, offsite: 0, revenue: 1500,
      vat_out: 360, vat_in: 0, creators_rs: 0, shipping_charged: 0, shipping_cost: 0, consumables: 0, payment_fees: 0,
      costs: {}, costs_total: 0, net: 1500, net_since_start: 1500, break_even: null }
  ],
  general: { by_category: { general: 777 }, unallocated: {}, total: 777 }, grand_total: -70752
};

test("report: a title's whole picture, shared costs, creators and VAT included", () => {
  const d = pub();
  assert.equal(K.okRep(REP), true);
  assert.equal(K.okRep({ source: "production-ledger" }), false);
  const f = K.titleReport(REP, RECS, RS, d.titles[0], { 101: "f1" }, d.set);
  assert.equal(f.any, true);
  assert.equal(f.incA, 4500 + 250);
  assert.deepEqual(f.costs.map(c => [c.cat, c.a, c.rows.length]), [["printing", 55000, 2], ["editing", 20000, 1]]);
  assert.deepEqual(f.shared, { ship: 400, cons: 60, fees: 35 });
  assert.equal(f.creators, 1500);
  assert.equal(f.roy, null);
  assert.equal(f.costA, 76995);
  assert.equal(f.net, 4750 - 76995);          // = the ledger's net
  assert.equal(f.net, REP.products[0].net);
  assert.deepEqual(f.vat, { out: 270, in: 9000, due: -8730 });
  assert.equal(f.be, 170);
  assert.equal(f.inc.offsite.rows.length, 1);
});

test("report: royalties from the title's terms only when nobody else pays them", () => {
  const d = pub();
  const two = Object.assign({}, d.titles[1], {
    fmts: [{ id: "f2", k: "pb", isbn: "9786185321017", price: 12 }],
    roy: [{ id: "r1", n: "Ana", pct: 10, base: "list", k: "", adv: 0 }, { id: "r2", n: "Ben", pct: 5, base: "net", k: "", adv: 50 }]
  });
  const f = K.titleReport(REP, RECS, null, two, { 202: "f2" }, d.set);
  // Ana: 10% of 12.00 × 1 = 120; Ben: 5% of 9.00 = 45, but the 50.00 advance was paid
  assert.deepEqual(f.roy.lines.map(r => [r.n, r.earned, r.a]), [["Ana", 120, 120], ["Ben", 45, 5000]]);
  assert.equal(f.costA, 130 + 5120);
  assert.equal(f.net, 900 - 5250);
  assert.equal(f.be, null);
  // Revenue Splitter already pays someone for book one: its terms are not counted again
  const one = Object.assign({}, d.titles[0], { roy: [{ id: "r1", n: "Ana", pct: 10, base: "list", k: "", adv: 0 }] });
  assert.equal(K.titleReport(REP, RECS, RS, one, { 101: "f1" }, d.set).roy, null);
});

test("report overview: titles, other products and general expenses add up to the ledger's total", () => {
  const d = pub();
  const o = K.overviewRep(d, "shop", REP, { 202: "9786185321017" });
  assert.deepEqual(o.rows.map(r => [r.id, r.n, r.inc, r.cost, r.net]), [["t1", 7, 4750, 76995, -72245], ["t2", 1, 900, 130, 770]]);
  assert.deepEqual(o.other, { n: 3, inc: 1500, cost: 0, net: 1500, k: 1 });
  assert.equal(o.general, 777);
  assert.equal(o.total, REP.grand_total);
});
