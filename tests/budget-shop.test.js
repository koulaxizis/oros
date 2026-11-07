// Budget shop records (PL-1): a shop's Production Ledger records
// (GET /wc/v3/pl/records) become linked entries (budget/links.js
// shopRows → plan, src "pl"), and the bank's lines for the same money
// are marked as already here (budget/bank.js crossTwin "shop" /
// "payout"). Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const L = require(path.join(__dirname, "..", "budget/links.js"));
const K = require(path.join(__dirname, "..", "budget/bank.js"));
const C = require(path.join(__dirname, "..", "links/core.js"));

const TAG = L.shopTag("https://glarolykoi.net/");
const base = { order: 812, number: "812", pm: "vivawallet_native", pmt: "Κάρτα (Viva)", tx: "abc", paid: "2026-12-03", rcpt: "", status: "completed" };
const P1 = Object.assign({ id: "o812-p100", m: 1764750000000, k: "i", d: "2026-12-03", a: 1200, v: 72, cat: "sales", pid: 100, title: "Βιβλίο", qty: 1 }, base);
const P2 = Object.assign({}, P1, { id: "o812-p200", a: 806, v: 48, pid: 200 });
const SH = Object.assign({ id: "o812-s", m: 1764750000000, k: "i", d: "2026-12-03", a: 242, v: 58, cat: "shipping_in", carrier: "box_now" }, base);
const E1 = { id: "e7", m: 1764760000000, k: "o", d: "2026-12-05", a: 10000, v: 2400, cat: "printing", scope: "product", pool: "", pid: 100, title: "Βιβλίο", supplier: "Τυπογραφείο", inv: "ΤΔΑ 55", note: "Ανατύπωση", src: "manual" };
const budget = (tx, tombs) => ({ tx: tx || [], tombs: tombs || {} });

test("shopTag: the same shop gives the same tag, whatever the address looks like", () => {
  assert.match(TAG, /^s[a-z0-9]{7}$/);
  assert.equal(L.shopTag("glarolykoi.net"), TAG);
  assert.equal(L.shopTag("https://www.glarolykoi.net"), TAG);
  assert.equal(L.shopTag("HTTP://glarolykoi.net:443/shop/"), TAG);
  assert.notEqual(L.shopTag("https://example.com"), TAG);
  assert.equal(L.shopTag(""), "");
});

test("shopReq: only what links/core.js allows for WooCommerce", () => {
  const r = L.shopReq("2026-12-01", "2026-12-31", 2);
  assert.deepEqual(r, { m: "GET", path: "/pl/records?from=2026-12-01&to=2026-12-31&page=2&per_page=500" });
  assert.equal(C.checkReq("woo", r), "");
  assert.equal(C.checkReq("woo", L.shopReq("", "2026-12-31", 1)), "");
  assert.equal(C.checkReq("woo", L.shopReq("bad", "", 0)), "");
});

test("shopRows: one income entry per order (products + shipping, VAT in), one per cost", () => {
  const rows = L.shopRows([P1, P2, SH, E1], TAG, {});
  assert.deepEqual(rows, [
    { key: TAG + "-e7", m: E1.m, a: 12400, d: "2026-12-05", n: "Τυπογραφείο · ΤΔΑ 55 · Ανατύπωση", k: "o" },
    { key: TAG + "-o812", m: P1.m, a: 1272 + 854 + 300, d: "2026-12-03", n: "#812 · Κάρτα (Viva)", k: "i" }
  ]);
  const withCats = L.shopRows([P1, E1], TAG, { i: "c-shop", o: "c-print" });
  assert.equal(withCats[0].c, "c-print");
  assert.equal(withCats[1].c, "c-shop");
  assert.deepEqual(L.shopRows([P1], "bad", {}), []);
  assert.deepEqual(L.shopRows(null, TAG, {}), []);
});

test("shopRows: a cancelled order and a deleted / test entry come as removals", () => {
  const m2 = P1.m + 5000;
  const rows = L.shopRows([{ id: "o812-p100", m: m2, del: 1 }, { id: "o812-p200", m: m2, del: 1 }, { id: "o812-s", m: m2, del: 1 },
                           { id: "e7", m: 9, del: 1 }, Object.assign({}, E1, { id: "e8", t: 1 })], TAG, {});
  assert.deepEqual(rows, [
    { key: TAG + "-e7", m: 9, del: 1 },
    { key: TAG + "-e8", m: E1.m, del: 1 },
    { key: TAG + "-o812", m: m2, del: 1 }
  ]);
  // one line refunded, the rest still paid: the order counts what is left
  const part = L.shopRows([P1, { id: "o812-p200", m: P1.m, del: 1 }], TAG, {});
  assert.deepEqual([part[0].a, part[0].k], [1272, "i"]);
  // a row we can't read leaves the order as it is (no wrong amount)
  assert.deepEqual(L.shopRows([P1, Object.assign({}, P2, { a: "8,06" })], TAG, {}), []);
  // an off-site sale is income
  assert.equal(L.shopRows([Object.assign({}, E1, { k: "i", cat: "offsite" })], TAG, {})[0].k, "i");
});

test("plan: shop entries keep their kind; a new one gets the default category of its kind", () => {
  const rows = L.shopRows([P1, P2, SH, E1], TAG, {});
  const p1 = L.plan(budget(), "pl", rows);
  assert.deepEqual(p1.put.map((x) => [x.id, x.k, x.c, x.src]), [
    ["l-pl-" + TAG + "-e7", "o", "o-other", "pl"],
    ["l-pl-" + TAG + "-o812", "i", "i-free", "pl"]
  ]);
  // read again: nothing to do
  assert.deepEqual(L.plan(budget(p1.put), "pl", rows), { put: [], drop: [] });
  // your category stays when the amount changes at the shop
  const mine = p1.put.map((x) => Object.assign({}, x, x.k === "o" ? { c: "c-print" } : {}));
  const later = L.shopRows([P1, P2, SH, Object.assign({}, E1, { m: E1.m + 1, a: 11000 })], TAG, {});
  const p2 = L.plan(budget(mine), "pl", later);
  assert.deepEqual(p2.put.map((x) => [x.k, x.a, x.c]), [["o", 13400, "c-print"]]);
  // the order is cancelled: its entry goes
  const gone = L.shopRows([{ id: "o812-p100", m: P1.m + 9, del: 1 }], TAG, {});
  assert.deepEqual(L.plan(budget(p1.put), "pl", gone).drop, [{ id: "l-pl-" + TAG + "-o812", m: P1.m + 9 }]);
  // deleted in Budget: stays deleted
  const tombs = { ["tx:l-pl-" + TAG + "-o812"]: P1.m + 1 };
  assert.deepEqual(L.plan(budget([], tombs), "pl", rows).put.map((x) => x.id), ["l-pl-" + TAG + "-e7"]);
});

test("plan: Invoices rows still make income in i-free (no kind given)", () => {
  const p = L.plan(budget(), "invoices", [{ key: "pay-1", m: 5, a: 100, d: "2026-12-01", n: "x" }]);
  assert.deepEqual([p.put[0].k, p.put[0].c], ["i", "i-free"]);
});

test("shopCheck: monthly totals of the shop against the records read", () => {
  const months = { "2026-12": { income_net: 1200 + 806 + 242, income_vat: 72 + 48 + 58, expense_net: 10000, expense_vat: 2400 } };
  assert.deepEqual(L.shopCheck([P1, P2, SH, E1], months), []);
  assert.deepEqual(L.shopCheck([P1, SH, E1], months), [{ mk: "2026-12", k: "i", want: 2426, got: 1572 }]);
  assert.deepEqual(L.shopCheck([P1, P2, SH, E1, Object.assign({}, E1, { id: "e9", t: 1 })], months), []);
});

test("bank import: the bank's line for a shop order or cost is already here", () => {
  const tx = L.plan(budget(), "pl", L.shopRows([P1, P2, SH, E1], TAG, {})).put;
  const items = [
    { d: "2026-12-04", amt: 2426, text: "ΕΜΒΑΣΜΑ ΠΕΛΑΤΗ 812" },        // bank transfer for the order
    { d: "2026-12-09", amt: -12400, text: "ΤΥΠΟΓΡΑΦΕΙΟ ΑΕ" },          // the printer paid
    { d: "2026-12-20", amt: 2426, text: "ΚΑΠΟΙΟΣ ΑΛΛΟΣ" }               // same amount, too late: new
  ];
  const r = K.plan(items, { ac: "", tx });
  assert.deepEqual(r.map((x) => [x.st, x.dk || ""]), [["dup", "shop"], ["dup", "shop"], ["new", ""]]);
  assert.equal(r[0].why, "l-pl-" + TAG + "-o812");
});

test("bank import: a payout of Viva, Stripe or the courier while shop orders are here", () => {
  const tx = L.plan(budget(), "pl", L.shopRows([P1, P2, SH], TAG, {})).put;
  const items = [
    { d: "2026-12-08", amt: 9935, text: "VIVA WALLET PAYOUT 0812" },
    { d: "2026-12-08", amt: 5000, text: "BOX NOW ΑΝΤΙΚΑΤΑΒΟΛΕΣ" },
    { d: "2026-12-08", amt: 7000, text: "ΜΙΣΘΟΔΟΣΙΑ ΣΤΟΥΝΤΙΟ" },
    { d: "2026-12-08", amt: -300, text: "VIVA WALLET FEE" }
  ];
  const r = K.plan(items, { ac: "", tx });
  assert.deepEqual(r.map((x) => [x.st, x.dk || "", x.on]), [["dup", "payout", false], ["dup", "payout", false], ["new", "", true], ["new", "", true]]);
  // no shop records: a payout is plain income
  assert.equal(K.plan(items.slice(0, 1), { ac: "", tx: [] })[0].st, "new");
  // a payout before any shop order: plain income
  assert.equal(K.plan([{ d: "2026-11-20", amt: 9935, text: "VIVA WALLET" }], { ac: "", tx })[0].st, "new");
});
