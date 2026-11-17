// Title analysis in Publishing (wave P16): Production Ledger 1.3+'s
// GET /pl/analysis summed per title (channels, delivery, free copies,
// consignments, promotion per material, euros → cents), and the three
// typed writes (a dated price, the promotion package, an event sale)
// built here and accepted by links/core.js ALLOW.woo, nothing else.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const K = require(path.join(__dirname, "..", "publish/costs.js"));
const L = require(path.join(__dirname, "..", "links/core.js"));

function row(pid, over) {
  return Object.assign({
    product_id: pid, title: "T" + pid, stock: 21, sold: 3, revenue: 25.47, free: 9, orders: 3,
    channels: [
      { key: "full", label: "x", qty: 2, net: 16.98 }, { key: "discount", label: "x", qty: 1, net: 8.49 },
      { key: "free", label: "x", qty: 9, net: 0 }, { key: "consignment", label: "x", qty: 0, net: 0 }
    ],
    delivery: [{ key: "boxnow", qty: 2 }, { key: "hand", qty: 1 }, { key: "none", qty: 0 }],
    events: [{ name: "Book fair", qty: 1 }],
    stores: [{ name: "Όμμα", given: 10, sold: 4, returned: 1, shelf: 5, owed: 12.5 }],
    free_list: [
      { date: "2026-11-17", type: "legal", qty: 4, recipient: "Εθνική Βιβλιοθήκη", kind: "body", ben: "" },
      { date: "2026-11-10", type: "author_free", qty: 2, recipient: "", kind: "", ben: "Author" }
    ],
    promo: { lines: [
      { item: "ship_island", label: "Island", qty: 1, net: 2.41, vat: 0.58, gross: 2.99 },
      { item: "bookmark", label: "Bookmark", qty: 3, net: 0.3, vat: 0.07, gross: 0.37 },
      { item: "<bad>", label: "x", qty: 1, net: 99, vat: 0 }
    ], net: 2.71, vat: 0.65, gross: 3.36, packages: 1 }
  }, over || {});
}
const ANA = {
  source: "production-ledger", version: "1.3.0", from: "2026-09-01", to: "2026-11-17",
  titles: [row(86658), row(86659, { stock: null, channels: [{ key: "full", qty: 1, net: 8.49 }], delivery: [{ key: "boxnow", qty: 1 }],
    events: [], stores: [], free_list: [], promo: { lines: [] } }), row(999)],
  rates: {
    items: [{ key: "bookmark", label: "Bookmark", current: 0.1, in_pkg: 3,
      versions: [{ from: "2026-03-13", net: 0.1, vat_rate: 24, gross: 0.124, supplier: "ektyposi.gr", invoice: "1", note: "", change: null },
                 { from: "2027-01-01", net: 0.12, vat_rate: 24, gross: 0.1488, supplier: "", invoice: "", note: "", change: 20 }] }],
    package: { day: "2026-11-17", lines: [{ item: "bookmark", label: "Bookmark", qty: 3, net: 0.3, vat: 0.07 }], net: 9.61, vat: 2.3, gross: 11.91, missing: [] }
  }
};

test("okAna and the request", () => {
  assert.equal(K.okAna(ANA), true);
  assert.equal(K.okAna({ source: "production-ledger", titles: [] }), false);
  assert.deepEqual(K.anaReq("2026-01-01", "2026-12-31"), { m: "GET", path: "/pl/analysis?from=2026-01-01&to=2026-12-31" });
  assert.deepEqual(K.anaReq("", "x"), { m: "GET", path: "/pl/analysis" });
});

test("a title's products are summed, in cents, other titles left out", () => {
  const f = K.anaSum(ANA, { 86658: "f1", 86659: "f2" });
  assert.equal(f.any, true);
  assert.equal(f.sold, 4);
  assert.equal(f.rev, 1698 + 849 + 849);
  assert.equal(f.free, 9);
  assert.equal(f.stock, 21);
  assert.deepEqual(f.channels.map((c) => [c.key, c.q, c.a]), [["full", 3, 2547], ["discount", 1, 849], ["free", 9, 0]]);
  assert.deepEqual(f.delivery, [{ key: "boxnow", q: 3 }, { key: "hand", q: 1 }]);
  assert.deepEqual(f.events, [{ n: "Book fair", q: 1 }]);
  assert.deepEqual(f.stores, [{ n: "Όμμα", given: 10, sold: 4, ret: 1, shelf: 5, owed: 1250 }]);
  assert.deepEqual(f.freeList.map((x) => [x.d, x.type, x.q]), [["2026-11-10", "author_free", 2], ["2026-11-17", "legal", 4]]);
  assert.deepEqual(f.promo.map((l) => [l.item, l.net, l.vat]), [["ship_island", 241, 58], ["bookmark", 30, 7]]);
  assert.equal(f.promoNet, 271);
  assert.equal(K.anaSum(ANA, { 1: "x" }).any, false);
});

test("price list and package", () => {
  const r = K.rates(ANA);
  assert.equal(r.length, 1);
  assert.equal(r[0].vers[1].chg, 20);
  assert.equal(K.pkg(ANA).gross, 1191);
});

test("bodies are refused here when wrong", () => {
  assert.equal(K.rateBody({ key: "Bad Key", from: "2027-01-01", net: "1" }), null);
  assert.deepEqual(K.rateBody({ key: "bookmark", from: "2027-01-01", net: "0.1234" }), { key: "bookmark", from: "2027-01-01", net: "0.1234" });
  assert.equal(K.rateBody({ key: "bookmark", from: "2027-01-01", net: "x", rate: "24" }), null);
  assert.equal(K.rateBody({ key: "bookmark", from: "2027-01-01", net: "1", rate: "101" }), null);
  assert.equal(K.promoBody(0, "2026-11-17"), null);
  assert.equal(K.saleBody({ date: "2026-11-17", event: "", payment: "cash", lines: [{ product_id: 1, qty: 1 }] }), null);
  assert.equal(K.saleBody({ date: "2026-11-17", event: "F", payment: "iou", lines: [{ product_id: 1, qty: 1 }] }), null);
  assert.equal(K.saleBody({ date: "2026-11-17", event: "F", payment: "cash", lines: [{ product_id: 1, qty: 1000 }] }), null);
  assert.equal(K.saleBody({ date: "2026-11-17", event: "F", payment: "cash", lines: [] }), null);
});

test("ALLOW.woo: the analysis reads and the three typed writes go, nothing else", () => {
  const ok = (r) => L.checkReq("woo", r);
  assert.equal(ok(K.anaReq("2026-09-01", "2026-11-17")), "");
  assert.equal(ok({ m: "GET", path: "/pl/rates" }), "");
  assert.equal(ok({ m: "POST", path: "/pl/rates", body: K.rateBody({ key: "bookmark", from: "2027-01-01", net: "0,12", rate: "24", supplier: "ektyposi.gr" }) }), "");
  assert.equal(ok({ m: "POST", path: "/pl/promo-apply", body: K.promoBody(86658, "2026-11-17", true) }), "");
  assert.equal(ok({ m: "POST", path: "/pl/event-sale", body: K.saleBody({ date: "2026-11-17", event: "Φεστιβάλ", payment: "card",
    lines: [{ product_id: 77144, qty: 2 }, { product_id: 85020, qty: 1, price: "4,5" }], note: "x", dry_run: true }) }), "");
  // not from orOS: the package itself, unknown fields, a line without qty, missing parts
  assert.notEqual(ok({ m: "POST", path: "/pl/package", body: { pkg: { bookmark: 3 } } }), "");
  assert.notEqual(ok({ m: "POST", path: "/pl/rates", body: { key: "bookmark", from: "2027-01-01", net: "1", x: 1 } }), "");
  assert.notEqual(ok({ m: "POST", path: "/pl/rates", body: { key: "bookmark", net: "1" } }), "");
  assert.notEqual(ok({ m: "POST", path: "/pl/event-sale", body: { date: "2026-11-17", event: "F", payment: "cash", lines: [{ product_id: 1 }] } }), "");
  assert.notEqual(ok({ m: "POST", path: "/pl/event-sale", body: { date: "2026-11-17", event: "F", payment: "cash", lines: [{ product_id: 1, qty: 1, price: 5 }] } }), "");
  assert.notEqual(ok({ m: "POST", path: "/pl/promo-apply", body: { product_id: 1 } }), "");
  assert.notEqual(ok({ m: "GET", path: "/pl/analysis?product_id=1" }), "");
  assert.notEqual(ok({ m: "PUT", path: "/pl/rates", body: { key: "a", from: "2027-01-01", net: "1" } }), "");
});
