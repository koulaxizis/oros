// Shop (SHOP-1): the pure model (shop/core.js), its requests against
// the WooCommerce allowlist, the search and Today providers.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../shop/core.js");
const L = require("../links/core.js");

// orosLinks.statusCode (links/host.js), the same codes
function statusCode(x) {
  if (!x) return "network";
  if (x.err) return x.err === "timeout" ? "network" : (x.err === "auth" ? "auth" : "network");
  if (x.status >= 200 && x.status < 300) return "";
  if (x.status === 401 || x.status === 403) return "auth";
  if (x.status === 404) return "notfound";
  if (x.status === 429) return "busy";
  return "server";
}
const ok = (data) => ({ status: 200, data });
const REP = (g, n, o, i) => ok([{ total_sales: g, net_sales: n, total_orders: o, total_items: i, total_refunds: "0.00", total_customers: 1 }]);
const DIGEST = {
  v: 1, site: "https://shop.example/", at: "2026-11-18T10:00:00+00:00",
  areas: {
    sales: {
      today: { period: { start: "2026-11-18", end: "2026-11-18" }, pending: { count: 2 }, completed: { count: 3, gross: 45.5, customers: 3, aov: 15.17 }, refunds: { count: 0, amount: 0 }, cancelled: { count: 1 } },
      month: { completed: { count: 12, gross: 228.2, customers: 6, aov: 19.02 }, money: { share: 60.35 } },
      year: { completed: { count: 85, gross: 1507.8, customers: 75, aov: 17.74 } }
    },
    titles: { year: { rows: [
      { id: 2, name: "Second &#8217;Book", qty: 4, sales: 40, net: 37.74, orders: 4, stock: "instock" },
      { id: 1, name: "First <b>Book</b>", qty: 20, sales: 274.4, net: 258.87, orders: 18, stock: "outofstock" }
    ], totals: { qty: 24, sales: 314.4, net: 296.61, orders: 22 } } },
    stock: { now: { threshold: 5, low: { count: 1, items: [{ id: 3, title: "Tee — S", stock: 2 }] }, out: { count: 1, items: [{ id: 4, title: "Mug", stock: 0 }] } } },
    splits: { now: { sales_since: "2026-09-01", beneficiaries: [
      { name: "Partner B", sales: 1, income: 0, deductions: 0, payments: 0, remaining: 1 },
      { name: "Partner A", sales: 100.5, income: 10, deductions: 5, payments: 0, remaining: 105.5 }
    ] } },
    costs: { year: { period: { from: "2026-11-07", to: "2026-11-18" }, currency: "EUR",
      products: [{ product_id: 1, title: "First Book", units: 1, revenue: 9.19, costs_total: 0.92, net: 8.27 }],
      totals: { revenue: 9.19, costs_total: 0.92, net: 8.27, units: 1 }, general: { total: 0 }, grand_total: 8.27 } },
    bookstores: { now: { as_of: "2026-11-18", products: {
      "10": [{ account: 61, name: "Book Corner", city: "Athens", given: 4, sold: 2, returned: 0, open: 2, due: "2026-11-01", overdue: false, sold_value_c: 1560, collected_c: 324, owed_c: 1236 }],
      "11": [{ account: 61, name: "Book Corner", city: "Athens", given: 2, sold: 2, returned: 0, open: 0, due: "", overdue: false, sold_value_c: 960, collected_c: 199, owed_c: 761 },
             { account: 7, name: "Kiosk", city: "", given: 3, sold: 0, returned: 1, open: 2, due: "2027-02-09", overdue: false, sold_value_c: 0, collected_c: 0, owed_c: 0 }]
    } } }
  },
  errors: { titles: "nope", users: "x" }
};
const ANSWERS = [REP("45.50", "40.00", 3, 4), REP("228.20", "210.00", 12, 20), REP("1507.80", "1400.00", 85, 123),
  ok([{ name: "First Book", product_id: 1, quantity: 20 }]), ok({ code: "EUR", name: "Euro", symbol: "€" }), ok(DIGEST)];

test("the requests pass the WooCommerce allowlist, in the app and the relay", async () => {
  const X = await import("../relay/ext.js");
  const rs = C.reqs("2026-11-18", true);
  assert.equal(rs.length, 6);
  assert.ok(rs.length <= 10);
  for (const r of rs) {
    assert.equal(L.checkReq("woo", r), "", r.path);
    assert.equal(X.checkExtReq("woo", r), "", "relay " + r.path);
  }
  assert.equal(rs[1].path, "/reports/sales?date_min=2026-11-01&date_max=2026-11-18");
  assert.equal(rs[5].path, "/oros/digest?fresh=1");
  assert.equal(C.reqs("2026-11-18", false)[5].path, "/oros/digest");
  assert.ok(L.PLATFORMS.woo.apps.includes("shop"));
});

test("answers become one entry: base, extras, cents, names as plain text", () => {
  const e = C.fromAnswers("w1", ANSWERS, 1000, "2026-11-18", statusCode);
  assert.equal(e.a, "w1");
  assert.equal(e.cur, "EUR");
  assert.deepEqual(e.base.today, { g: 4550, n: 4000, o: 3, i: 4, r: 0 });
  assert.equal(e.xs, "");
  assert.deepEqual(e.x.on, ["sales", "titles", "stock", "splits", "costs", "bookstores"]);
  assert.deepEqual(e.x.err, { titles: "nope" }, "unknown areas dropped");
  assert.equal(C.parseDigest({ areas: {}, errors: { sales: "Bad Code!" } }).err.sales, "error", "odd codes folded");
  assert.equal(e.x.sales.month.own, 6035);
  assert.equal(e.x.titles.rows[0].n, "Second ’Book");
  assert.equal(e.x.titles.rows[1].n, "First Book");
  assert.equal(e.x.titles.rows[1].st, "out");
  assert.equal(e.x.costs.nt, 827);
  const stores = C.stores(e);
  assert.deepEqual(stores.map((s) => [s.n, s.given, s.sold, s.open, s.owed, s.od, s.due]),
    [["Book Corner", 6, 4, 2, 1997, 1, "2026-11-01"], ["Kiosk", 3, 0, 2, 0, 0, "2027-02-09"]]);
  assert.deepEqual(C.partners(e).map((p) => p.n), ["Partner A", "Partner B"]);
  assert.deepEqual(C.products(e).map((p) => p.id), [1, 2]);
  assert.deepEqual(C.tabs(e), ["today", "money", "products", "partners", "stores"]);
  assert.equal(C.period(e, "today").src, "x");
  // nothing personal travels: no key of the stored entry names a person's contact
  assert.doesNotMatch(C.serialize(C.put(C.empty(), e)), /email|phone|address|billing|first_name|last_name/i);
});

test("a shop without orOS Connect shows WooCommerce's own figures", () => {
  const res = ANSWERS.slice(0, 5).concat([{ status: 404, data: { code: "rest_no_route" } }]);
  const e = C.fromAnswers("w1", res, 1000, "2026-11-18", statusCode);
  assert.equal(e.xs, "missing");
  assert.equal(e.x, null);
  assert.deepEqual(C.tabs(e), ["today", "money", "products"]);
  assert.deepEqual(C.period(e, "year"), { src: "base", o: 85, g: 150780, n: 140000, i: 123, r: 0, aov: 1774 });
  assert.deepEqual(C.products(e), [{ id: 1, n: "First Book", q: 20 }]);
  assert.deepEqual(C.missing(e), C.AREAS);
  assert.equal(C.fromAnswers("w1", ANSWERS.slice(0, 5).concat([{ status: 403 }]), 1, "2026-11-18", statusCode).xs, "auth");
  assert.equal(C.fromAnswers("w1", ANSWERS.slice(0, 5).concat([{ status: 500 }]), 1, "2026-11-18", statusCode).xs, "error");
  assert.equal(C.fromAnswers("w1", ANSWERS.slice(0, 5).concat([ok({ nothing: 1 })]), 1, "2026-11-18", statusCode).xs, "error");
});

test("a refused base is a failure, never an empty entry", () => {
  assert.deepEqual(C.fromAnswers("w1", [{ status: 401 }].concat(ANSWERS.slice(1)), 1, "2026-11-18", statusCode), { fail: "auth" });
  assert.deepEqual(C.fromAnswers("w1", [], 1, "2026-11-18", statusCode), { fail: "network" });
  assert.deepEqual(C.fromAnswers("w1", [ok({})].concat(ANSWERS.slice(1)), 1, "2026-11-18", statusCode), { fail: "server" });
});

test("merge is symmetric, the newer read wins whole, get() is canonical", () => {
  const e1 = C.fromAnswers("w1", ANSWERS, 1000, "2026-11-18", statusCode);
  const e2 = Object.assign({}, e1, { m: 2000, cur: "USD" });
  const e3 = C.fromAnswers("w2", ANSWERS, 1500, "2026-11-18", statusCode);
  const A = C.put(C.put(C.empty(), e1), e3), B = C.put(C.empty(), e2);
  const ab = C.serialize(C.merge(A, B)), ba = C.serialize(C.merge(B, A));
  assert.equal(ab, ba);
  const m = JSON.parse(ab);
  assert.equal(m.shops.w1.cur, "USD");
  assert.equal(m.shops.w2.m, 1500);
  assert.equal(C.serialize(C.merge(m, B)), ab, "settles at once");
  // equal times: the larger JSON, either way round
  const t1 = Object.assign({}, e1, { cur: "GBP" });
  assert.equal(C.serialize(C.merge(C.put(C.empty(), e1), C.put(C.empty(), t1))), C.serialize(C.merge(C.put(C.empty(), t1), C.put(C.empty(), e1))));
  assert.equal(C.serialize(JSON.parse(ab)), ab);
});

test("broken input is dropped, never repaired", () => {
  const d = C.normalize({ shops: { "bad id!": { a: "bad id!", m: 5 }, x: { a: "y", m: 5 }, z: { a: "z", m: 0 }, ok: { a: "ok", m: 7, base: { today: { g: "x" } }, xs: "weird", x: { on: ["sales", "evil"], err: { evil: "x" } } } } });
  assert.deepEqual(Object.keys(d.shops), ["ok"]);
  assert.equal(d.shops.ok.xs, "");
  assert.deepEqual(d.shops.ok.x, { on: ["sales"], err: {} });
  assert.deepEqual(d.shops.ok.base.today, { g: 0, n: 0, o: 0, i: 0, r: 0 });
  assert.deepEqual(C.normalize(null), { v: 1, shops: {} });
});

test("search finds products, partners and resellers; Today shows sales, stock and settlements", () => {
  const P = require("../shop/search.js"), T = require("../shop/today.js");
  const now = new Date(2026, 10, 18, 10).getTime();
  const e = C.fromAnswers("w1", ANSWERS, now, "2026-11-18", statusCode);
  const d = JSON.parse(C.serialize(C.put(C.empty(), e)));
  const hits = P.search({ readJSON: () => d, lang: "el" });
  assert.ok(hits.some((h) => h.title === "First Book" && h.target.view === "products" && h.target.shop === "w1"));
  assert.ok(hits.some((h) => h.title === "Partner A" && h.target.view === "partners"));
  assert.ok(hits.some((h) => h.title === "Book Corner" && h.target.view === "stores"));
  const rows = T.collect({ readJSON: () => d, lang: "en", today: "2026-11-18", horizon: 7,
    addDays: (day, n) => { const x = new Date(day + "T12:00:00"); x.setDate(x.getDate() + n); return C.dayOf(x); } });
  assert.deepEqual(rows.map((r) => r.id), ["sales-w1", "out-w1", "settle-w1-61"]);
  assert.equal(rows[0].title, "Shop today: 3 orders · 45.50 EUR");
  assert.equal(rows[2].due, "2026-11-01");
  assert.equal(rows[2].kind, "task");
  assert.deepEqual(T.collect({ readJSON: () => null }), []);
});
