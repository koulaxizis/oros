// Pure logic of Stock (stock/core.js): normalizers, the sync merge
// (slice "stock"), the quantity as the sum of movements (two devices
// selling at once), counts, average cost, low stock and notices,
// codes, CSV (own export, WooCommerce) and the search provider.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const C = require(path.join(__dirname, "..", "stock/core.js"));
const S = require(path.join(__dirname, "..", "search.js"));
const P = require(path.join(__dirname, "..", "stock/search.js"));

const NOW = Date.UTC(2026, 9, 12, 10, 0, 0);   // 2026-10-12
const TODAY = "2026-10-12";

function item(id, extra) { return Object.assign({ id, m: 1000, name: "Item " + id, unit: "pcs" }, extra || {}); }
function mv(id, t, d, lines, extra) { return Object.assign({ id, m: 1000, t, d, lines }, extra || {}); }
function data(o) { return Object.assign({ items: [], cats: [], units: [], sups: [], moves: [], tombs: {} }, o || {}); }
function m(a, b) { return C.merge(a, b, NOW); }
function k(n) { return n * 1000; }   // units → thousandths

test("normalizers: strict, invalid rows dropped, text cleaned", () => {
  assert.equal(C.normItem({ id: "x", m: 1, name: "A" }), null);                 // short id
  assert.equal(C.normItem({ id: "item01", m: 1, name: "   " }), null);          // no name
  assert.equal(C.normItem({ id: "item01", m: -1, name: "A" }), null);
  const it = C.normItem({ id: "item01", m: 5, name: "  Blue\n mug ", sku: " MUG-1 ", bc: "50 12345 678900", unit: "nope!", min: -3, vat: 300, arch: 1, extra: 1 });
  assert.equal(it.name, "Blue mug");
  assert.equal(it.sku, "MUG-1");
  assert.equal(it.bc, "5012345678900");
  assert.equal(it.unit, "pcs");
  assert.equal(it.min, 0);
  assert.equal(it.vat, 24);
  assert.equal(it.arch, 1);
  assert.ok(!("extra" in it));
  assert.equal(C.normUnit({ id: "kg", m: 1, name: "kilo" }), null);             // a ready id can't be redefined
  assert.equal(C.normUnit({ id: "unit01", m: 1, name: "roll", dec: 9 }).dec, 0);
  assert.equal(C.normSup({ id: "sup001", m: 1, name: "Acme", lead: 900 }).lead, 0);
});

test("movement lines keep the sign of their type", () => {
  const L = (t, lines) => C.normMove(mv("move01", t, TODAY, lines));
  assert.equal(L("in", [{ i: "item01", q: -5 }]), null);
  assert.equal(L("out", [{ i: "item01", q: 5 }]), null);
  assert.equal(L("loss", [{ i: "item01", q: 0 }]), null);
  assert.equal(L("fix", [{ i: "item01", q: 0 }]), null);
  assert.equal(L("count", [{ i: "item01", q: 0 }]), null);                      // a count needs n
  assert.deepEqual(L("count", [{ i: "item01", q: 0, n: 7000 }]).lines, [{ i: "item01", q: 0, n: 7000 }]);
  assert.deepEqual(L("in", [{ i: "item01", q: 2000, c: 150, p: 9 }]).lines, [{ i: "item01", q: 2000, c: 150 }]);
  assert.deepEqual(L("out", [{ i: "item01", q: -2000, c: 150, p: 300 }]).lines, [{ i: "item01", q: -2000, p: 300 }]);
  assert.equal(C.normMove(mv("move01", "sell", TODAY, [{ i: "item01", q: -1 }])), null);
  assert.equal(C.normMove(mv("move01", "out", "2026-02-30", [{ i: "item01", q: -1 }])), null);
  const x = C.normMove(mv("move01", "out", TODAY, [{ i: "item01", q: -1 }, { i: "bad", q: -1 }], { sup: "sup001", src: "invoices:INV-1", v: 1 }));
  assert.equal(x.lines.length, 1);
  assert.equal(x.sup, "");                     // a sale has no supplier
  assert.equal(x.src, "invoices:INV-1");
  assert.equal(x.v, 1);
});

test("quantity = sum of movements; two devices selling at once lose nothing", () => {
  const base = data({ items: [item("item01")], moves: [mv("m00001", "in", "2026-10-01", [{ i: "item01", q: k(10), c: 200 }])] });
  const A = m(base, base), B = m(base, base);
  A.moves.push(mv("m0000a", "out", TODAY, [{ i: "item01", q: k(-2) }]));
  B.moves.push(mv("m0000b", "out", TODAY, [{ i: "item01", q: k(-3) }]));
  const AB = m(A, B), BA = m(B, A);
  assert.equal(JSON.stringify(AB), JSON.stringify(BA));
  assert.equal(C.qtyMap(AB).item01, k(5));
});

test("a stock count stores the difference, so a concurrent sale still counts", () => {
  const base = m(data({ items: [item("item01")], moves: [mv("m00001", "in", "2026-10-01", [{ i: "item01", q: k(10) }])] }), null);
  const A = m(base, null), B = m(base, null);
  // A counts 9 (one went missing): difference −1
  A.moves.push(mv("m0000a", "count", TODAY, [{ i: "item01", q: k(9) - C.qtyMap(A).item01, n: k(9) }]));
  // B sells 2 at the same time
  B.moves.push(mv("m0000b", "out", TODAY, [{ i: "item01", q: k(-2) }]));
  assert.equal(C.qtyMap(m(A, B)).item01, k(7));
});

test("merge: symmetric, idempotent, canonical; void wins; tombstones", () => {
  const A = data({
    items: [item("item02", { m: 2000, name: "New name" }), item("item01")],
    sups: [{ id: "sup001", m: 1000, name: "Acme" }],
    moves: [mv("m00001", "in", TODAY, [{ i: "item01", q: k(1) }])],
    settings: { m: 5, cur: "USD", vat: 13, neg: 0 }
  });
  const B = data({
    items: [item("item02", { m: 1500, name: "Old name" })],
    moves: [mv("m00001", "in", TODAY, [{ i: "item01", q: k(1) }], { m: 500, v: 1 })],
    tombs: { sup001: NOW - 1000 },
    settings: { m: 3, cur: "EUR" }
  });
  const AB = m(A, B), BA = m(B, A);
  assert.equal(JSON.stringify(AB), JSON.stringify(BA));
  assert.equal(JSON.stringify(m(AB, AB)), JSON.stringify(AB));
  assert.deepEqual(AB.items.map((x) => x.id), ["item01", "item02"]);
  assert.equal(AB.items[1].name, "New name");
  assert.equal(AB.moves[0].v, 1, "an older void still wins");
  assert.equal(C.qtyMap(AB).item01 || 0, 0);
  assert.equal(AB.sups.length, 0, "tombstoned supplier hidden");
  assert.equal(AB.settings.cur, "USD");
  assert.equal(AB.settings.neg, 0);
  // a newer edit resurrects
  const R = m(AB, data({ sups: [{ id: "sup001", m: NOW, name: "Acme again" }] }));
  assert.equal(R.sups[0].name, "Acme again");
});

test("merge: an item with movements survives a delete on another device", () => {
  const A = data({ items: [item("item01")], tombs: { item01: NOW - 5000 } });
  const B = data({ items: [item("item01")], moves: [mv("m00001", "out", TODAY, [{ i: "item01", q: k(-1) }])] });
  const AB = m(A, B);
  assert.deepEqual(AB.items.map((x) => x.id), ["item01"]);
  // without movements the tombstone hides it
  assert.equal(m(A, data({ items: [item("item01")] })).items.length, 0);
  // tombstones expire after a year
  assert.deepEqual(Object.keys(m(data({ tombs: { item09: NOW - 400 * 86400000 } }), null).tombs), []);
});

test("merge: hostile input never throws and never passes junk", () => {
  const junk = [null, 1, "x", [], { items: "x" }, { items: [null, 5, { id: "__proto__", m: 1, name: "a" }] },
    { moves: [{ id: "m00001", m: 1, t: "in", d: TODAY, lines: "x" }] }, { tombs: { "a b": 5, item01: "x" } }];
  junk.forEach((j) => {
    const r = m(j, j);
    assert.ok(Array.isArray(r.items) && Array.isArray(r.moves));
    assert.equal(JSON.stringify(m(r, r)), JSON.stringify(r));
  });
  const proto = m({ items: [{ id: "constructor", m: 1, name: "x" }] }, null);
  assert.equal(proto.items.length, 1);
});

test("average cost: weighted by receipts in time order, value of what is on hand", () => {
  const d = m(data({
    items: [item("item01", { cost: 999 }), item("item02", { cost: 450 })],
    moves: [
      mv("m00001", "in", "2026-10-01", [{ i: "item01", q: k(10), c: 100 }]),
      mv("m00002", "in", "2026-10-02", [{ i: "item01", q: k(10), c: 200 }]),
      mv("m00003", "out", "2026-10-03", [{ i: "item01", q: k(-5), p: 500 }]),
      mv("m00004", "in", "2026-10-04", [{ i: "item01", q: k(5), c: 300 }])
    ]
  }), null);
  const avg = C.costMap(d);
  // (10*100 + 10*200)/20 = 150; then 15 left; (15*150 + 5*300)/20 = 187.5
  assert.equal(avg.item01, 187.5);
  assert.equal(avg.item02, 450, "no receipt with a cost: the item's own price");
  const r = C.stockRows(d).find((x) => x.item.id === "item01");
  assert.equal(r.q, k(20));
  assert.equal(r.value, 3750);
  // stock that came in without a cost is valued at the item's price until a costed receipt
  const o = m(data({ items: [item("item01", { cost: 300 })], moves: [
    mv("m00001", "count", "2026-10-01", [{ i: "item01", q: k(10), n: k(10) }]),
    mv("m00002", "in", "2026-10-02", [{ i: "item01", q: k(5), c: 360 }])
  ] }), null);
  assert.equal(C.costMap(o).item01, 320);                 // (10×300 + 5×360) / 15
});

test("low stock: at or below the minimum, suggestion, archived skipped, notices once", () => {
  const d = m(data({
    items: [
      item("item01", { min: k(5) }),
      item("item02", { min: k(5), rq: k(24) }),
      item("item03", { min: k(5), arch: 1 }),
      item("item04", { min: 0 }),
      item("item05", { min: k(2), unit: "kg" })
    ],
    moves: [mv("m00001", "in", "2026-10-01", [
      { i: "item01", q: k(5) }, { i: "item02", q: k(1) }, { i: "item04", q: k(1) }, { i: "item05", q: 1500 }
    ])]
  }), null);
  const low = C.lowList(d);
  assert.deepEqual(low.map((r) => r.item.id).sort(), ["item01", "item02", "item05"]);
  const by = Object.fromEntries(low.map((r) => [r.item.id, r]));
  assert.equal(C.suggestQty(by.item01, 0), k(5));          // 2×5 − 5
  assert.equal(C.suggestQty(by.item02, 0), k(24));         // reorder qty wins
  assert.equal(C.suggestQty(by.item05, 3), 2500);          // 2×2 − 1.5 kg
  let st = C.toNotify(["item01", "item02"], {});
  assert.deepEqual(st.fresh, ["item01", "item02"]);
  st = C.toNotify(["item01", "item02"], st.next);
  assert.deepEqual(st.fresh, []);
  st = C.toNotify(["item02"], st.next);                     // item01 restocked
  st = C.toNotify(["item01", "item02"], st.next);           // and low again
  assert.deepEqual(st.fresh, ["item01"]);
});

test("out rate, item history and codes", () => {
  const d = m(data({
    items: [item("item01", { sku: "MUG-1", bc: "5012345678900" }), item("item02", { sku: "mug-1", arch: 1 })],
    moves: [
      mv("m00001", "in", "2026-09-01", [{ i: "item01", q: k(40) }]),
      mv("m00002", "out", "2026-10-01", [{ i: "item01", q: k(-6) }]),
      mv("m00003", "loss", "2026-10-10", [{ i: "item01", q: k(-3) }]),
      mv("m00004", "out", "2026-10-11", [{ i: "item01", q: k(-1) }], { v: 1 }),
      mv("m00005", "out", "2026-08-01", [{ i: "item01", q: k(-9) }])
    ]
  }), null);
  assert.equal(C.outRate(d, "item01", TODAY, 30), k(9) / 30);
  const h = C.itemMoves(d, "item01");
  assert.deepEqual(h.map((x) => x.move.id), ["m00004", "m00003", "m00002", "m00001", "m00005"]);
  assert.equal(h[0].after, null);
  assert.equal(h[1].after, k(22));
  assert.equal(C.findByCode(d, " mug-1 ").id, "item01", "live before archived");
  assert.equal(C.findByCode(d, "5012345678900").id, "item01");
  assert.equal(C.findByCode(d, "nothing"), null);
  assert.ok(C.hasMoves(d, "item01"));
  assert.ok(!C.hasMoves(d, "item02"));
});

test("parseNum: comma or dot decimals, Greek thousands", () => {
  assert.equal(C.parseNum("1,5", "el"), 1.5);
  assert.equal(C.parseNum("1.234", "el"), 1234);
  assert.equal(C.parseNum("1.234", "en"), 1.234);
  assert.equal(C.parseNum("1.234,50", "el"), 1234.5);
  assert.equal(C.parseNum("12a", "en"), null);
});

test("CSV: parser, formula injection neutralised, exports", () => {
  assert.deepEqual(C.parseCsv('\ufeffa;b\r\n"x;y";"he said ""hi"""\r\n\r\n').rows, [["a", "b"], ["x;y", 'he said "hi"']]);
  assert.equal(C.parseCsv("a\tb\n1\t2").sep, "\t");
  assert.equal(C.csvCell("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(C.csvCell("-5"), "'-5");
  assert.equal(C.csvCell(-5), "-5");
  const d = m(data({
    items: [item("item01", { name: "Mug", sku: "MUG", price: 800, cost: 300, min: k(2) })],
    sups: [{ id: "sup001", m: 1, name: "Acme" }],
    moves: [mv("m00001", "in", "2026-10-01", [{ i: "item01", q: k(3), c: 300 }], { sup: "sup001", ref: "INV 7" })]
  }), null);
  const p = C.csvProducts(d, { pcs: "pcs" });
  assert.deepEqual(p[0].slice(0, 7), ["MUG", "Mug", "", "", "pcs", 3, 2]);
  assert.equal(p[0][14], 9);
  const mm = C.csvMoves(d, { in: "Receive" });
  assert.deepEqual(mm[0], ["2026-10-01", "Receive", "INV 7", "Acme", "MUG", "Mug", 3, 3, "", ""]);
});

test("CSV import: WooCommerce export, variations, categories, quantities as one count", () => {
  let n = 0;
  const newId = () => "new" + String(++n).padStart(5, "0");
  const woo = [
    "ID,Type,SKU,Name,Published,In stock?,Stock,Low stock amount,Regular price,Categories,\"GTIN, UPC, EAN, or ISBN\"",
    "10,variable,TS,T-shirt,1,1,,,,\"Clothing > Tees\",",
    "11,variation,TS-S,T-shirt - S,1,1,5,2,12.50,\"Clothing > Tees, Sale\",",
    "12,simple,MUG,Mug,1,1,0,,8,\"Kitchen\\, Home\",5012345678900",
    "13,simple,,,1,1,3,,,,"
  ].join("\n");
  const base = m(data({ items: [item("item01", { name: "Old mug", sku: "mug", price: 700 })],
    moves: [mv("m00001", "in", "2026-10-01", [{ i: "item01", q: k(4) }])] }), null);
  const plan = C.importPlan(base, woo, { newId, now: NOW, today: TODAY, setQty: true });
  assert.ok(plan.ok);
  assert.deepEqual(plan.stats, { added: 1, updated: 1, same: 0, skipped: 2, qty: 2 });
  const ts = plan.items.find((x) => x.sku === "TS-S");
  assert.equal(ts.price, 1250);
  assert.equal(ts.min, k(2));
  assert.equal(plan.cats.find((c) => c.id === ts.cat).name, "Tees");
  const mug = plan.items.find((x) => x.id === "item01");
  assert.equal(mug.name, "Mug");
  assert.equal(mug.price, 800);
  assert.equal(mug.bc, "5012345678900");
  assert.equal(plan.cats.find((c) => c.id === mug.cat).name, "Kitchen, Home");
  assert.ok(mug.m > 1000);
  assert.equal(plan.move.t, "count");
  assert.deepEqual(plan.move.lines.sort((a, b) => (a.i < b.i ? -1 : 1)),
    [{ i: "item01", q: k(-4), n: 0 }, { i: ts.id, q: k(5), n: k(5) }]);
  // the plan's rows pass the normalizers as they are
  assert.ok(C.normMove(plan.move));
  plan.items.forEach((x) => assert.deepEqual(C.normItem(x), x));
  // without setQty no movement
  assert.equal(C.importPlan(base, woo, { newId, now: NOW, today: TODAY }).move, null);
});

test("CSV import: own Greek export (semicolons, comma decimals) round-trips unchanged", () => {
  const d = m(data({
    items: [item("item01", { name: "Αλεύρι", sku: "AL-1", unit: "kg", price: 125, cost: 90, min: 2500, vat: 13 })],
    moves: [mv("m00001", "in", "2026-10-01", [{ i: "item01", q: 12500, c: 90 }])]
  }), null);
  const head = ["SKU", "Όνομα", "Barcode", "Κατηγορία", "Μονάδα", "Ποσότητα", "Ελάχιστο", "Ποσότητα παραγγελίας", "Προμηθευτής", "Κωδικός προμηθευτή", "Κόστος (EUR)", "Τιμή (EUR)", "ΦΠΑ %", "Θέση", "Αξία (EUR)", "Σημείωση"];
  const units = {}; C.UNIT_IDS.forEach((u) => { units[u] = C.unitName(u, "el"); });
  const rows = C.csvProducts(d, units);
  const text = [head].concat(rows).map((r) => r.map((v) => (typeof v === "number" ? String(v).replace(".", ",") : C.csvCell(v))).join(";")).join("\r\n");
  const plan = C.importPlan(d, text, { newId: () => "zzzzzz", now: NOW, today: TODAY, setQty: true });
  assert.deepEqual(plan.stats, { added: 0, updated: 0, same: 1, skipped: 0, qty: 0 });
  assert.ok(C.headKey("Ποσότητα χαμηλού αποθέματος") === "min");
  assert.ok(C.headKey("Κωδικός (SKU)") === "sku");
});

test("CSV import: no product columns → not ok", () => {
  const plan = C.importPlan(data(), "foo,bar\n1,2\n", { newId: () => "a00000", now: NOW });
  assert.equal(plan.ok, false);
});

test("prefs: notify on by default", () => {
  assert.equal(C.readPrefs(null).notify, true);
  assert.equal(C.readPrefs({ notify: false }).notify, false);
});

// ---------- search provider ----------
function store(obj) {
  const mp = new Map(Object.entries(obj).map(([key, v]) => [key, JSON.stringify(v)]));
  return { getItem: (key) => (mp.has(key) ? mp.get(key) : null) };
}
function ctxFor(storage, q) {
  return { q, words: S.parseQuery(q || ""), fold: S.fold, lang: "en", limit: 50, readJSON: S.makeReader(storage) };
}

test("search: products and suppliers, archived and deleted skipped, read-only", () => {
  const d = {
    items: [
      item("item01", { name: "Blue mug", sku: "MUG-1", cat: "cat001", sup: "sup001", loc: "B3" }),
      item("item02", { name: "Old mug", arch: 1 }),
      item("item03", { name: "Gone mug" }),
      item("item04", { name: "Sold mug" })
    ],
    cats: [{ id: "cat001", m: 1, name: "Kitchen" }],
    sups: [{ id: "sup001", m: 1, name: "Acme", tel: "210 123" }],
    moves: [mv("m00001", "out", TODAY, [{ i: "item04", q: -1000 }])],
    tombs: { item03: 2000, item04: 2000 }
  };
  const hits = P.search(ctxFor(store({ "oros-stock-data": d }), "mug"));
  const ids = hits.map((h) => h.id).sort();
  assert.deepEqual(ids, ["i:item01", "i:item04", "s:sup001"]);
  const h1 = hits.find((h) => h.id === "i:item01");
  assert.equal(h1.text, "MUG-1 · Kitchen · B3 · Acme");
  assert.deepEqual(h1.target, { item: "item01" });
  assert.deepEqual(hits.find((h) => h.id === "s:sup001").target, { sup: "sup001" });
  assert.deepEqual(P.search(ctxFor(store({}), "x")), []);
  const src = fs.readFileSync(path.join(__dirname, "..", "stock/search.js"), "utf8");
  assert.ok(!/setItem|removeItem|registerSlice|innerHTML/.test(src));
});
