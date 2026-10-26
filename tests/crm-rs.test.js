// Partner card W6: a CRM partner linked to a beneficiary of the shop's
// Revenue Splitter (noxpress 1.11+). The link (crm/core.js 1.7 rsl:
// normalize, merge with an older device, unlink that sticks), the
// emptied pt row that now stays, the card's figures from the two
// read-only routes (crm/rs.js) and the sync round trip.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const C = require(path.join(__dirname, "..", "crm/core.js"));
const RS = require(path.join(__dirname, "..", "crm/rs.js"));
const { FakeDropbox, createDevice, readKey, writeKey } = require("./harness");

const KEY = "oros-crm-data";
const json = (x) => JSON.stringify(x);
function cust(id, name, extra) { return Object.assign({ id: id, m: 10, name: name }, extra || {}); }

test("rsl: normalized, names exact and capped, absent while empty, an unlink stays", () => {
  const d = C.norm({ cust: [cust("aaaaaa1", "Άννα"), cust("aaaaaa2", "B"), cust("aaaaaa3", "C")], rsl: [
    { id: "aaaaaa1", m: 10, a: "shop01", n: ["  Άννα Π.  ", "Άννα Π.", "Ann", "a", "b", "c", "d", ""], x: 1 },
    { id: "aaaaaa2", m: 10, a: "BAD ID", n: ["B"] },
    { id: "aaaaaa3", m: 10, a: "shop01", n: [] },
    { id: "aaaaaa9", m: 10, n: ["Gone"] }
  ] });
  assert.deepEqual(d.rsl, [
    { id: "aaaaaa1", m: 10, a: "shop01", n: ["Ann", "a", "b", "c", "Άννα Π."] },
    { id: "aaaaaa2", m: 10, n: ["B"] },
    { id: "aaaaaa3", m: 10 }
  ], "trimmed, unique, at most 5, no folding; a bad account id leaves; an emptied row stays; no customer, no row");
  assert.equal(json(C.norm(d)), json(d), "idempotent");
  assert.equal("rsl" in C.norm({ cust: [cust("aaaaaa1", "A")] }), false);
  assert.deepEqual(C.rsOf(d, d.cust[0]), { a: "shop01", n: ["Ann", "a", "b", "c", "Άννα Π."] });
  assert.equal(C.rsOf(d, d.cust[2]), null);
  assert.deepEqual(C.rsRow("aaaaaa1", "shop01", ["X", " X "]), { id: "aaaaaa1", m: 0, a: "shop01", n: ["X"] });
  assert.deepEqual(C.rsRow("aaaaaa1", "shop01", []), { id: "aaaaaa1", m: 0 });
});

test("rsl merge: a 1.6 device's copy loses nothing, an unlink beats an older link, a removed customer takes it", () => {
  const linked = { cust: [cust("aaaaaa1", "A")], rsl: [{ id: "aaaaaa1", m: 20, a: "shop01", n: ["Anna"] }] };
  // a 1.6 device knows no rsl: it renames the customer and its data has none
  const old = { cust: [cust("aaaaaa1", "A renamed", { m: 30 })] };
  const m = C.merge(linked, old);
  assert.equal(m.cust[0].name, "A renamed");
  assert.deepEqual(m.rsl, linked.rsl);
  assert.equal(json(C.merge(old, linked)), json(m), "symmetric");
  // unlinked on one device; the other still has the link
  const un = C.merge(linked, { cust: [cust("aaaaaa1", "A")], rsl: [{ id: "aaaaaa1", m: 25 }] });
  assert.deepEqual(un.rsl, [{ id: "aaaaaa1", m: 25 }]);
  assert.equal(C.rsOf(un, un.cust[0]), null);
  assert.deepEqual(C.merge(un, linked).rsl, [{ id: "aaaaaa1", m: 25 }], "the older link does not come back");
  const gone = C.merge(linked, { cust: [], tombs: { aaaaaa1: 40 } });
  assert.equal("rsl" in gone, false);
  assert.equal(json(C.restore(C.norm({}), C.backup(linked))), json(C.norm(linked)), "a backup carries it");
});

test("pt: the last link removed on one device does not come back from another (1.7)", () => {
  const A = C.norm({ cust: [cust("aaaaaa1", "A")], pt: [{ id: "aaaaaa1", m: 5, ln: ["sup:s1"] }] });
  const B = JSON.parse(json(A));
  const rows = C.linkMove(A, "", "sup:s1");
  rows[0].m = 9;
  A.pt = rows;
  const a2 = C.norm(A);
  assert.deepEqual(a2.pt, [{ id: "aaaaaa1", m: 9 }]);
  assert.deepEqual(C.merge(a2, B).pt, [{ id: "aaaaaa1", m: 9 }]);
  assert.deepEqual(C.lnOf(C.merge(B, a2), A.cust[0]), []);
});

const BAL = { currency: "EUR", sales_since: "2026-01-01", beneficiaries: [
  { name: "Άννα Παπά", sales: 12050, income: 1000, payments: 5000, remaining: 8050 },
  { name: "A. Papa", sales: 300, income: 0, payments: 0, remaining: 300 },
  { name: "Publisher", sales: 90000, income: 0, payments: 0, remaining: 90000 },
  { name: "", sales: 1 }, null, { name: "Bad", sales: 1.5, remaining: "x" }
] };
const REP = { currency: "EUR", period: { start: "2026-01-01", end: "2026-10-26" }, order_count: 3, products: [
  { product_id: 11, title: "Βιβλίο Α", qty: 5, qty_free: 1, net: 5000, stock: 7, stock_status: "instock",
    splits: [{ name: "Άννα Παπά", percent: 10, amount: 500 }, { name: "Publisher", percent: 90, amount: 4500 }] },
  { product_id: 12, title: "Βιβλίο Β", qty: 2, qty_free: 0, net: 2000, stock: 0, stock_status: "outofstock",
    splits: [{ name: "Άννα Παπά", percent: 10, amount: 200 }, { name: "A. Papa", percent: 5, amount: 100 }, { name: "Publisher", percent: 85, amount: 1700 }] },
  { product_id: 13, title: "Γ", qty: 9, qty_free: 0, net: 9000, stock: null, stock_status: "instock",
    splits: [{ name: "Publisher", percent: 100, amount: 9000 }] },
  { product_id: -1, title: "bad" }, { title: "no id" }
] };

test("rs.js: the two answers are read strictly; anything else is not Revenue Splitter", () => {
  assert.deepEqual(RS.REQ_BAL, { m: "GET", path: "/rs/balances" });
  assert.deepEqual(RS.reqReport("2026-10-26"), { m: "GET", path: "/rs/report?date_start=2026-01-01&date_end=2026-10-26" });
  assert.equal(RS.reqReport("26/10/2026"), null);
  const b = RS.parseBal(BAL);
  assert.equal(b.cur, "EUR");
  assert.deepEqual(b.ben.map((x) => x.name), ["Άννα Παπά", "A. Papa", "Publisher", "Bad"]);
  assert.deepEqual(b.ben[3], { name: "Bad", sales: 0, income: 0, payments: 0, remaining: 0 }, "not whole cents → 0");
  assert.equal(RS.parseBal({ code: "rest_no_route" }), null);
  assert.equal(RS.parseBal(null), null);
  const r = RS.parseRep(REP);
  assert.deepEqual(r.products.map((p) => p.id), [11, 12, 13]);
  assert.equal(r.products[2].stock, null);
  assert.equal(r.from, "2026-01-01");
  assert.equal(RS.parseRep({ products: "x" }), null);
});

test("rs.js card: what is owed, this year's titles with their share and stock, names gone from the shop", () => {
  const x = RS.card(RS.parseBal(BAL), RS.parseRep(REP), ["A. Papa", "Άννα Παπά", "Old name"]);
  assert.equal(x.cur, "EUR");
  assert.equal(x.owed, 8350);
  assert.deepEqual([x.sales, x.income, x.payments], [12350, 1000, 5000]);
  assert.deepEqual(x.missing, ["Old name"]);
  assert.deepEqual(x.titles, [
    { id: 11, title: "Βιβλίο Α", qty: 5, free: 1, share: 500, pct: 10, stock: 7, status: "instock" },
    { id: 12, title: "Βιβλίο Β", qty: 2, free: 0, share: 300, pct: 15, stock: 0, status: "outofstock" }
  ]);
  assert.equal(x.share, 800);
  const noRep = RS.card(RS.parseBal(BAL), null, ["Publisher"]);
  assert.equal(noRep.owed, 90000);
  assert.deepEqual(noRep.titles, []);
  assert.deepEqual(RS.card(null, null, ["A"]).missing, [], "nothing read: nothing is called missing");
});

test("rs.js suggest: the partner's own name first, then its people, names linked elsewhere left out", () => {
  const c = { id: "aaaaaa1", name: "ΑΝΝΑ ΠΑΠΑ", people: [{ c: "", n: "A. Papa" }] };
  const s = RS.suggest(RS.parseBal(BAL), c, ["Bad"]);
  assert.deepEqual(s, [{ name: "Άννα Παπά", why: "name" }, { name: "A. Papa", why: "person" }, { name: "Publisher", why: "" }]);
  assert.deepEqual(RS.suggest(null, c, []), []);
});

test("sync: a Revenue Splitter link from one device and a rename from the other both survive", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A");
  const B = await createDevice(db, "B");
  const reg = (dev) => dev.sync.registerSlice("crm",
    () => C.norm(readKey(dev, KEY)),
    (data) => writeKey(dev, KEY, C.merge(readKey(dev, KEY), data)),
    KEY, C.merge);
  reg(A); reg(B);
  writeKey(A, KEY, C.norm({ cust: [cust("aaaaaa1", "A")] }));
  A.sync.markDirty();
  await A.sync.push();
  await B.sync.pull();
  const edit = (dev, fn) => {
    const cur = C.norm(readKey(dev, KEY));
    fn(cur);
    writeKey(dev, KEY, C.norm(cur));
    dev.sync.markDirty();
  };
  edit(A, (d) => { d.rsl = [{ id: "aaaaaa1", m: 50, a: "shop01", n: ["Anna"] }]; });
  edit(B, (d) => { d.cust[0] = Object.assign({}, d.cust[0], { m: 60, name: "A, renamed" }); });
  await A.sync.push();
  await B.sync.push();
  await A.sync.pull();
  await B.sync.pull();
  const a = C.norm(readKey(A, KEY)), b = C.norm(readKey(B, KEY));
  assert.equal(json(a), json(b));
  assert.equal(a.cust[0].name, "A, renamed");
  assert.deepEqual(C.rsOf(a, a.cust[0]), { a: "shop01", n: ["Anna"] });
});
