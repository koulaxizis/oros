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

// ---------- 1.1: purchase orders, reports, Today ----------
function po(id, extra) {
  return Object.assign({ id, m: 1000, no: "PO-1", sup: "sup001", d: "2026-10-01", exp: "2026-10-10", st: "sent",
                         lines: [{ i: "item01", q: k(10), c: 300 }, { i: "item02", q: k(4) }] }, extra || {});
}

test("purchase orders: normalizer, merge LWW + tombstones, a 1.0 copy without pos loses nothing", () => {
  assert.equal(C.normPo(po("po0001", { lines: [] })), null);
  assert.equal(C.normPo(po("po0001", { d: "2026-13-01" })), null);
  const x = C.normPo(po("po0001", { st: "weird", exp: "soon", lines: [{ i: "item01", q: 5 }, { i: "item01", q: 9 }, { i: "item02", q: 0 }, { i: "bad", q: 1 }] }));
  assert.equal(x.st, "draft");
  assert.equal(x.exp, "");
  assert.deepEqual(x.lines, [{ i: "item01", q: 5 }]);          // one line per item, q > 0
  const A = data({ pos: [po("po0001", { m: 2000, st: "closed" })] });
  const B = data({ pos: [po("po0001", { m: 1500 }), po("po0002", { no: "PO-2" })] });
  const ab = m(A, B), ba = m(B, A);
  assert.deepEqual(ab, ba);
  assert.deepEqual(m(ab, ab), ab);
  assert.equal(ab.pos.length, 2);
  assert.equal(ab.pos[0].st, "closed");
  const del = m(ab, data({ tombs: { po0002: NOW - 1000 } }));
  assert.deepEqual(del.pos.map((p) => p.id), ["po0001"]);
  // a 1.0 device's copy has no "pos" key: the merge keeps them
  const old = JSON.parse(JSON.stringify(ab));
  delete old.pos;
  assert.deepEqual(m(ab, old).pos, ab.pos);
});

test("purchase orders: received = live receipts with src po:<id>; state; on order; numbering", () => {
  const items = [item("item01"), item("item02")];
  const P0 = po("po0001");
  let d = m(data({ items, pos: [P0] }), null);
  let v = C.poView(d, d.pos[0]);
  assert.equal(v.state, "sent");
  assert.equal(v.open, true);
  assert.deepEqual(C.onOrder(d), Object.assign(Object.create(null), { item01: k(10), item02: k(4) }));
  // part arrives on device A, the rest of item02 on device B at the same time
  const rA = mv("mvrec01", "in", "2026-10-05", [{ i: "item01", q: k(6), c: 300 }], { src: C.poSrc("po0001") });
  const rB = mv("mvrec02", "in", "2026-10-05", [{ i: "item02", q: k(4) }], { src: C.poSrc("po0001") });
  d = m(m(d, data({ moves: [rA] })), data({ moves: [rB] }));
  v = C.poView(d, d.pos[0]);
  assert.equal(v.state, "partial");
  assert.deepEqual(v.lines.map((l) => [l.got, l.left]), [[k(6), k(4)], [k(4), 0]]);
  assert.deepEqual(C.onOrder(d), Object.assign(Object.create(null), { item01: k(4) }));
  // a receipt that is not "in", or has another src, does not count
  d = m(d, data({ moves: [mv("mvx0001", "fix", "2026-10-06", [{ i: "item01", q: k(4) }], { src: C.poSrc("po0001") }),
                          mv("mvx0002", "in", "2026-10-06", [{ i: "item01", q: k(4) }], { src: "po:other1" })] }));
  assert.equal(C.poView(d, d.pos[0]).state, "partial");
  const rC = mv("mvrec03", "in", "2026-10-07", [{ i: "item01", q: k(4) }], { src: C.poSrc("po0001") });
  d = m(d, data({ moves: [rC] }));
  assert.equal(C.poView(d, d.pos[0]).state, "received");
  assert.equal(C.poView(d, d.pos[0]).open, false);
  // voiding a receipt un-receives it
  d = m(d, data({ moves: [Object.assign({}, rC, { v: 1, m: 2000 })] }));
  assert.equal(C.poView(d, d.pos[0]).state, "partial");
  // closed: nothing more on order, even with lines left
  d = m(d, data({ pos: [Object.assign({}, P0, { st: "closed", m: 3000 })] }));
  assert.equal(C.poView(d, d.pos[0]).state, "closed");
  assert.deepEqual(Object.keys(C.onOrder(d)), []);
  // a draft is not on order yet
  assert.deepEqual(Object.keys(C.onOrder(m(data({ items, pos: [po("po0003", { st: "draft" })] }), null))), []);
  // numbering per day
  assert.equal(C.poNext(data(), TODAY), "PO-261012-1");
  assert.equal(C.poNext(data({ pos: [{ no: "PO-261012-1" }, { no: "PO-261012-7" }, { no: "PO-261011-9" }] }), TODAY), "PO-261012-8");
});

test("reports: value by category, period summary, dead stock, ranges", () => {
  const items = [item("item01", { cat: "cat001" }), item("item02"), item("item03", { cat: "gone01" }), item("item04", { arch: 1 })];
  const d = m(data({
    items, cats: [{ id: "cat001", m: 1, name: "Mugs" }],
    moves: [
      mv("mv00001", "in", "2026-06-01", [{ i: "item01", q: k(10), c: 200 }, { i: "item02", q: k(5), c: 100 }, { i: "item03", q: k(2), c: 50 }, { i: "item04", q: k(1), c: 999 }]),
      mv("mv00002", "out", "2026-10-02", [{ i: "item01", q: -k(3), p: 500 }]),
      mv("mv00003", "loss", "2026-10-03", [{ i: "item02", q: -k(1) }]),
      mv("mv00004", "out", "2026-10-04", [{ i: "item01", q: -k(1), p: 500 }], { v: 1 })
    ]
  }), null);
  const vc = C.valueByCat(d);
  assert.equal(vc.total, 7 * 200 + 4 * 100 + 2 * 50);          // archived item left out
  assert.deepEqual(vc.rows.map((r) => [r.cat, r.value, r.n]), [["cat001", 1400, 1], ["", 500, 2]]);   // unknown category → none
  const R = C.reportRange("30", TODAY);
  assert.deepEqual(R, { from: "2026-09-13", to: TODAY });
  assert.deepEqual(C.reportRange("month", TODAY), { from: "2026-10-01", to: TODAY });
  assert.deepEqual(C.reportRange("year", TODAY), { from: "2026-01-01", to: TODAY });
  const ps = C.periodSummary(d, R.from, R.to);
  assert.equal(ps.sales, 1500);                                 // the voided sale does not count
  assert.equal(ps.buys, 0);                                     // the receipt is outside the period
  assert.equal(ps.lossValue, 100);
  assert.equal(ps.rows[0].i, "item01");
  assert.equal(ps.rows[0].outQ, k(3));
  const all = C.periodSummary(d, "1900-01-01", "2200-12-31");
  assert.equal(all.buys, 2000 + 500 + 100 + 999);
  const dead = C.deadStock(d, TODAY, 90);
  assert.deepEqual(dead.map((x) => [x.row.item.id, x.last]), [["item03", null]]);   // item02 lost one (counts as moving)
});

test("Today provider: reorder line and expected deliveries, read-only", () => {
  globalThis.OrosStockCore = C;
  const T = require(path.join(__dirname, "..", "stock/today.js"));
  const A = require(path.join(__dirname, "..", "today/agg.js"));
  const store = {
    "oros-stock-data": data({
      items: [item("item01", { min: k(5) }), item("item02")],
      sups: [{ id: "sup001", m: 1, name: "Acme" }],
      pos: [po("po0001", { exp: "2026-10-10" }), po("po0002", { no: "PO-2", exp: "2026-12-01" }), po("po0003", { no: "PO-3", st: "draft", exp: TODAY })]
    })
  };
  const before = JSON.stringify(store);
  const ctx = {
    today: TODAY, horizon: A.HORIZON, now: NOW, lang: "el",
    readJSON: (key) => (key in store ? JSON.parse(JSON.stringify(store[key])) : null),
    readRaw: (key) => (key in store ? JSON.stringify(store[key]) : null), addDays: A.addDays, diff: A.diff
  };
  const rows = T.collect(ctx);
  assert.equal(JSON.stringify(store), before);
  assert.deepEqual(rows.map((r) => [r.id, r.kind, r.due]), [["low", "info", null], ["po-po0001", "task", "2026-10-10"]]);
  assert.equal(rows[0].title, "Για παραγγελία: 1");
  assert.deepEqual(rows[1].target, { po: "po0001" });
  assert.match(rows[1].text, /Acme/);
  assert.deepEqual(T.collect(Object.assign({}, ctx, { readJSON: () => null })), []);
  delete globalThis.OrosStockCore;
});

// ---------- 1.2: photos, barcodes ----------
test("photos: own list keyed by item, LWW, removed = empty name, hidden with the item, 1.1 copy loses nothing", () => {
  assert.equal(C.picName("2026-10-12", "item01", "AB12cd"), "20261012-item01-ab12cd.jpg");
  assert.equal(C.picName("2026-10-12", "x", "ab12cd"), null);
  assert.equal(C.picPath("20261012-item01-ab12cd.jpg"), "/internal/Stock/Photos/20261012-item01-ab12cd.jpg");
  assert.equal(C.picPath("../../etc/passwd"), null);
  assert.equal(C.normPic({ id: "item01", m: 1, f: "../x.jpg" }).f, "");
  const A = data({ items: [item("item01"), item("item02")], pics: [{ id: "item01", m: 2000, f: "20261012-item01-aaaa.jpg" }] });
  const B = data({ pics: [{ id: "item01", m: 3000, f: "" }, { id: "item02", m: 1000, f: "20261012-item02-bbbb.jpg" }] });
  const ab = m(A, B);
  assert.deepEqual(ab, m(B, A));
  assert.equal(C.picOf(ab, "item01"), "");                  // the newer removal wins
  assert.deepEqual(C.picsInUse(ab), ["20261012-item02-bbbb.jpg"]);
  const gone = m(ab, data({ tombs: { item02: NOW - 1000 } }));
  assert.equal(C.picOf(gone, "item02"), "");               // the item's tombstone hides its photo row
  const old = JSON.parse(JSON.stringify(ab));
  delete old.pics;
  assert.deepEqual(m(ab, old).pics, ab.pics);
});

test("barcodes: EAN-13 check digit and bars, Code 128 B, the label's choice, SVG has only bars", () => {
  assert.equal(C.eanCheck("501234567890"), "0");
  assert.equal(C.eanCheck("400638133393"), "1");
  assert.equal(C.ean13("5012345678900"), "10100011010110011001101101111010100011011100101010101000010001001001000111010011100101110010101");
  assert.equal(C.ean13("5012345678901"), null);            // wrong check digit
  assert.equal(C.code128("MUG-1"), "110100100001011101100011011101110110100010001001101110010011100110111101010001100011101011");
  assert.equal(C.code128("Ω"), null);
  assert.equal(C.code128(""), null);
  assert.equal(C.barcodeFor({ bc: "501234567890" }).type, "ean13");   // 12 digits get their check digit
  assert.equal(C.barcodeFor({ bc: "501234567890" }).text, "5012345678900");
  assert.equal(C.barcodeFor({ bc: "5012345678901", sku: "X" }).type, "code128");   // not a valid EAN: Code 128 of the barcode
  assert.deepEqual([C.barcodeFor({ bc: "", sku: "MUG-1" }).type, C.barcodeFor({ bc: "", sku: "MUG-1" }).text], ["code128", "MUG-1"]);
  assert.equal(C.barcodeFor({ bc: "", sku: "" }), null);
  const svg = C.barSvg(C.code128("<x>"), 40);
  assert.ok(!/<x>/.test(svg));
  assert.match(svg, /^<svg [^>]*viewBox="0 0 \d+ 40"/);
  assert.equal((svg.match(/<rect /g) || []).length, 1 + (C.code128("<x>").match(/1+/g) || []).length);
});

test("BR-ST-OUT: another app's sale is matched by code, summed, cleaned; nothing written", () => {
  const d = data({
    items: [item("item01", { sku: "MUG-1", bc: "5012345678900", price: 900 }), item("item02", { sku: "RICE", unit: "kg" }),
      item("item03", { sku: "OLD", arch: 1 })],
    moves: [mv("mv0001", "in", "2026-10-01", [{ i: "item01", q: k(10), c: 300 }]),
      mv("mv0002", "out", "2026-10-02", [{ i: "item01", q: -k(1) }], { src: "invoices:inv0001" }),
      mv("mv0003", "out", "2026-10-02", [{ i: "item01", q: -k(1) }], { src: "invoices:inv0001", v: 1 })]
  });
  const before = JSON.stringify(d);
  const r = C.outRequest(d, {
    ref: " INV-12 ", src: "invoices:inv0001", d: "2026-10-11",
    lines: [{ code: "mug-1", q: 2, p: 850 }, { sku: "5012345678900", q: 1, p: 850 }, { code: "RICE", q: 2.3456 },
      { code: "NOPE", q: 1 }, { code: "NOPE", q: 3 }, { code: "RICE", q: 0 }, { code: "", q: 1 }, null, { code: "OLD", q: -2 }]
  }, TODAY);
  assert.equal(r.t, "out");
  assert.equal(r.ref, "INV-12");
  assert.equal(r.d, "2026-10-11");
  assert.equal(r.src, "invoices:inv0001");
  assert.equal(r.used, 1);                                   // the voided one doesn't count
  assert.deepEqual(r.miss, ["NOPE"]);
  assert.deepEqual(r.lines, [{ i: "item01", q: k(3), p: 850 }, { i: "item02", q: 2346 }, { i: "item03", q: k(2) }]);
  assert.equal(JSON.stringify(d), before);
  // two prices for one product: the price is left for the person
  const r2 = C.outRequest(d, { t: "ret", src: "bad src!", d: "2030-01-01", lines: [{ code: "MUG-1", q: 1, p: 1 }, { code: "MUG-1", q: 1, p: 2 }] }, TODAY);
  assert.equal(r2.t, "ret");
  assert.equal(r2.src, "");
  assert.equal(r2.used, 0);
  assert.equal(r2.d, TODAY);                                 // a far future date falls back to today
  assert.deepEqual(r2.lines, [{ i: "item01", q: k(2) }]);
  // pcs round to whole units
  assert.deepEqual(C.outRequest(d, { lines: [{ code: "MUG-1", q: 1.6 }] }, TODAY).lines, [{ i: "item01", q: k(2) }]);
  assert.equal(C.outRequest(d, { lines: "x" }, TODAY), null);
  assert.equal(C.outRequest(d, null, TODAY), null);
  // the move it becomes keeps its src
  const saved = C.normMove({ id: "mv0009", m: 2, d: r.d, t: "out", ref: r.ref, src: r.src, lines: r.lines.map((l) => ({ i: l.i, q: -l.q, p: l.p })) });
  assert.equal(saved.src, "invoices:inv0001");
  assert.equal(C.srcUses(m(d, data({ moves: [saved] })), "invoices:inv0001"), 2);
});

test("catalog: live products with code, prices, VAT and quantity for another app's picker", () => {
  const d = data({
    items: [item("item01", { sku: "MUG-1", price: 900, vat: 13 }), item("item02", { bc: "123", unit: "kg", price: 0, vat: 24 }), item("item03", { arch: 1 })],
    moves: [mv("mv0001", "in", "2026-10-01", [{ i: "item01", q: k(4), c: 300 }, { i: "item02", q: 1500, c: 100 }])]
  });
  assert.deepEqual(C.catalog(d), [
    { id: "item01", code: "MUG-1", name: "Item item01", unit: "pcs", price: 900, vat: 13, q: 4 },
    { id: "item02", code: "123", name: "Item item02", unit: "kg", price: 0, vat: 24, q: 1.5 }
  ]);
});

test("warehouses: per-warehouse quantities, transfers leave totals, old copies stripped of w lose the tie", () => {
  const d = C.merge(data({
    items: [item("item01", { cost: 100 })],
    whs: [{ id: "wh0001", m: 1, name: "Shop" }, { id: C.WH_MAIN, m: 1, name: "Depot", arch: 1 }],
    moves: [
      mv("mv0001", "in", "2026-10-01", [{ i: "item01", q: k(10), c: 200 }]),
      mv("mv0002", "xfer", "2026-10-02", [{ i: "item01", q: k(4) }], { w2: "wh0001" }),
      mv("mv0003", "out", "2026-10-03", [{ i: "item01", q: -k(1), p: 500 }], { w: "wh0001" }),
      mv("mv0004", "xfer", "2026-10-03", [{ i: "item01", q: k(1) }], { w: "wh0001", w2: "wh0001" }),   // same place: dropped
      mv("mv0005", "xfer", "2026-10-03", [{ i: "item01", q: -k(1) }], { w2: "wh0001" }),              // negative: dropped
      mv("mv0006", "out", "2026-10-04", [{ i: "item01", q: -k(1) }], { w: C.WH_MAIN })                 // main is never stored as w
    ]
  }), null, NOW);
  assert.deepEqual(d.moves.map((x) => x.id), ["mv0001", "mv0002", "mv0003", "mv0006"]);
  assert.equal(d.moves[3].w, undefined);
  assert.equal(d.whs.find((w) => w.id === C.WH_MAIN).arch, 0);           // main can't be archived
  assert.equal(C.qtyMap(d).item01, k(8));                                // the transfer changes no total
  assert.deepEqual({ ...C.whQty(d).item01 }, { "": k(5), wh0001: k(3) });
  assert.deepEqual({ ...C.qtyIn(d, "wh0001") }, { item01: k(3) });
  assert.equal(C.costMap(d).item01, 200);
  const R = C.periodSummary(d, "2026-10-01", "2026-10-31");
  assert.equal(R.rows[0].outQ, k(2));
  assert.equal(R.rows[0].adj, 0);
  assert.equal(R.moves, 3);
  const hist = C.itemMoves(d, "item01");
  assert.deepEqual(hist.map((h) => [h.move.id, h.after]), [["mv0006", k(8)], ["mv0003", k(9)], ["mv0002", k(10)], ["mv0001", k(10)]]);
  assert.equal(C.whName(d, "", "Main"), "Depot");
  assert.equal(C.whName(d, "wh0001", "Main"), "Shop");
  assert.equal(C.whName(d, "wh9999", "Main"), "?");
  // a 1.3 device re-uploads the sale without w (same m): the copy with w wins, both ways round
  const stripped = JSON.parse(JSON.stringify(d));
  delete stripped.moves[2].w;
  assert.equal(m(d, stripped).moves[2].w, "wh0001");
  assert.equal(m(stripped, d).moves[2].w, "wh0001");
  // a 1.3 device knows no transfers and no whs list: merging its slice in loses nothing
  const old = JSON.parse(JSON.stringify(stripped));
  old.moves = old.moves.filter((x) => x.t !== "xfer");
  delete old.whs;
  const back = m(old, d);
  assert.equal(JSON.stringify(back), JSON.stringify(m(d, d)));
  // a warehouse deleted on one device while another used it stays
  const del = m(d, data({ tombs: { wh0001: NOW - 1000 } }));
  assert.ok(del.whs.some((w) => w.id === "wh0001"));
  // CSV with warehouses
  const rowsCsv = C.csvMoves(d, { xfer: "Transfer" }, "Main");
  assert.deepEqual(rowsCsv[1].slice(10), ["Depot", "Shop"]);
  assert.equal(rowsCsv[1][1], "Transfer");
  assert.equal(C.csvMoves(d, {})[0].length, 10);
});

test("lots: what is left per lot, named lots first then first to expire, expiring list, old copies lose the tie", () => {
  const d = C.merge(data({
    items: [item("item01"), item("item02", { arch: 1 })],
    moves: [
      mv("mv0001", "count", "2026-10-01", [{ i: "item01", q: k(2), n: k(2) }]),                                  // no lot
      mv("mv0002", "in", "2026-10-02", [{ i: "item01", q: k(5), lot: " L-A ", exp: "2026-10-15" }]),
      mv("mv0003", "in", "2026-10-03", [{ i: "item01", q: k(5), lot: "L-B", exp: "2026-12-01" }, { i: "item02", q: k(1), lot: "Z", exp: "2026-10-01" }]),
      mv("mv0004", "in", "2026-10-03", [{ i: "item01", q: k(1), lot: "L-A", exp: "2026-10-14" }]),              // earlier expiry wins
      mv("mv0005", "out", "2026-10-04", [{ i: "item01", q: -k(2), lot: "L-B", exp: "2030-01-01" }]),            // exp dropped on a sale
      mv("mv0006", "out", "2026-10-05", [{ i: "item01", q: -k(7) }]),                                            // FEFO: L-A 6, then L-B 1
      mv("mv0007", "count", "2026-10-05", [{ i: "item01", q: k(1), n: k(9), lot: "X" }]),                       // no lot on a count
      mv("mv0008", "xfer", "2026-10-06", [{ i: "item01", q: k(1), lot: "L-B" }], { w2: "wh0001" })                // no lot on a transfer
    ]
  }), null, NOW);
  assert.equal(d.moves[1].lines[0].lot, "L-A");
  assert.equal(d.moves[4].lines[0].exp, undefined);
  assert.equal(d.moves[6].lines[0].lot, undefined);
  assert.equal(d.moves[7].lines[0].lot, undefined);
  const L = C.lotsOf(d, "item01");
  assert.deepEqual(L.lots, [{ lot: "L-B", exp: "2026-12-01", q: k(2) }]);
  assert.equal(L.none, k(3));
  assert.equal(L.none + L.lots.reduce((a, r) => a + r.q, 0), C.qtyMap(d).item01);
  // an over-sale beyond every lot goes below zero on "none"
  const d2 = C.merge(d, data({ moves: [mv("mv0009", "loss", "2026-10-07", [{ i: "item01", q: -k(6), lot: "L-B" }])] }), NOW);
  assert.deepEqual(C.lotsOf(d2, "item01"), { lots: [], none: -k(1) });
  // expiring: archived products left out; 30 days from 2026-11-05 reaches L-B
  assert.deepEqual(C.expiring(d, TODAY, 7), []);
  assert.deepEqual(C.expiring(d, "2026-11-05", 30).map((x) => [x.item.id, x.lot, x.exp, x.q]), [["item01", "L-B", "2026-12-01", k(2)]]);
  assert.deepEqual(C.lotNames(d, "item01"), ["L-B", "L-A"]);
  // a 1.4 device strips lot / exp (same m): the copy with lots wins both ways
  const stripped = JSON.parse(JSON.stringify(d));
  stripped.moves.forEach((x) => x.lines.forEach((l) => { delete l.lot; delete l.exp; }));
  assert.equal(JSON.stringify(m(d, stripped)), JSON.stringify(m(d, d)));
  assert.equal(JSON.stringify(m(stripped, d)), JSON.stringify(m(d, d)));
  const rows = C.csvMoves(d, {}, undefined, true);
  assert.deepEqual(rows.find((r) => r[0] === "2026-10-02").slice(10), ["L-A", "2026-10-15"]);
});

test("Today provider: lots expiring within 7 days, expired ones overdue", () => {
  globalThis.OrosStockCore = C;
  const T = require(path.join(__dirname, "..", "stock/today.js"));
  const A = require(path.join(__dirname, "..", "today/agg.js"));
  const store = {
    "oros-stock-data": data({
      items: [item("item01", { name: "Milk" })],
      moves: [mv("mv0001", "in", "2026-10-01", [{ i: "item01", q: k(2), lot: "A1", exp: "2026-10-10" }, { i: "item01", q: k(3), lot: "B2", exp: "2026-10-18" }, { i: "item01", q: k(1), lot: "C3", exp: "2026-10-25" }])]
    })
  };
  const ctx = {
    today: TODAY, horizon: A.HORIZON, now: NOW, lang: "en",
    readJSON: (key) => (key in store ? JSON.parse(JSON.stringify(store[key])) : null),
    readRaw: (key) => (key in store ? JSON.stringify(store[key]) : null), addDays: A.addDays, diff: A.diff
  };
  const rows = T.collect(ctx);
  assert.deepEqual(rows.map((r) => [r.id, r.due, r.title, r.text]), [
    ["exp-item01-A1", "2026-10-10", "Expires: Milk", "lot A1"],
    ["exp-item01-B2", "2026-10-18", "Expires: Milk", "lot B2"]
  ]);
  assert.deepEqual(rows[0].target, { item: "item01" });
  delete globalThis.OrosStockCore;
});

// ---------- 1.6: closing a period ----------
function sample() {
  return C.merge(data({
    items: [item("item01", { cost: 100 }), item("item02", { cost: 50 }), item("item03")],
    whs: [{ id: "wh0001", m: 1, name: "Shop" }],
    pos: [{ id: "po0001", m: 1, no: "PO-1", sup: "", d: "2026-01-02", st: "sent", lines: [{ i: "item01", q: k(20), c: 120 }] }],
    moves: [
      mv("mv0001", "in", "2026-01-05", [{ i: "item01", q: k(10), c: 120, lot: "A", exp: "2027-01-01" }, { i: "item02", q: k(4), c: 60 }], { src: "po:po0001" }),
      mv("mv0002", "in", "2026-02-05", [{ i: "item01", q: k(5), c: 180, lot: "B", exp: "2026-12-01" }]),
      mv("mv0003", "xfer", "2026-03-01", [{ i: "item01", q: k(6) }], { w2: "wh0001" }),
      mv("mv0004", "out", "2026-04-01", [{ i: "item01", q: -k(3), p: 300 }], { w: "wh0001" }),
      mv("mv0005", "out", "2026-05-01", [{ i: "item02", q: -k(6) }]),                     // tea below zero, no lot
      mv("mv0006", "loss", "2026-06-01", [{ i: "item01", q: -k(1) }], { v: 1 }),           // voided
      mv("mv0007", "in", "2026-11-01", [{ i: "item01", q: k(2), c: 200 }]),                // after the close
      mv("mv0008", "out", "2026-11-02", [{ i: "item02", q: -k(1) }])
    ]
  }), null, NOW);
}
function views(d) {
  return JSON.stringify({
    q: { ...C.qtyMap(d) }, avg: Object.fromEntries(Object.entries(C.costMap(d)).map(([k2, v]) => [k2, Math.round(v * 1000) / 1000])),
    wh: Object.fromEntries(Object.entries(C.whQty(d)).map(([k2, v]) => [k2, Object.fromEntries(Object.entries(v).filter(([, n]) => n))])),
    lots: { ...C.allLots(d) }, rcv: Object.fromEntries(Object.entries(C.receivedMap(d)).map(([k2, v]) => [k2, { ...v }])),
    dead: C.deadStock(d, "2026-12-20", 90).map((x) => [x.row.item.id, x.last]), low: C.lowList(d).length
  });
}

test("closing a period: every derived number is the same after, the old movements are gone", () => {
  const d = sample();
  assert.deepEqual(C.closeInfo(d, "2026-10-31", "2026-12-20"), { ok: true, n: 6 });
  assert.equal(C.closeInfo(d, "2026-12-20", "2026-12-20").ok, false);       // not today or later
  const c = C.closePeriod(d, "2026-10-31", NOW, "cls00001");
  assert.deepEqual(c.moves.map((x) => x.id), ["mv0007", "mv0008"]);
  assert.equal(c.close.ids, "mv0001,mv0002,mv0003,mv0004,mv0005,mv0006");
  assert.equal(views(c), views(d));
  // item01 at the close: Main 9, Shop 3; lots B 2 (the sale took it first), A 10, soonest first; item02 −2 without a lot
  assert.deepEqual(c.close.bal, [
    { i: "item01", q: k(2), lot: "B", exp: "2026-12-01" }, { i: "item01", q: k(7), lot: "A", exp: "2027-01-01" },
    { i: "item01", q: k(3), w: "wh0001", lot: "A", exp: "2027-01-01" }, { i: "item02", q: -k(2) }
  ]);
  // history starts with the opening balance
  const h = C.itemMoves(c, "item01");
  assert.equal(h[h.length - 1].move.t, "open");
  assert.equal(C.hasMoves(c, "item02"), true);
  // a second close builds on the first
  const c2 = C.closePeriod(c, "2026-11-01", NOW + 1000, "cls00002");
  assert.equal(views(c2), views(d));
  assert.equal(C.closePeriod(c2, "2026-10-01", NOW, "cls00003"), null);   // not before the current one
  // the item of the opening can't be deleted away
  const del = m(c, data({ tombs: { item02: NOW } }));
  assert.ok(del.items.some((x) => x.id === "item02"));
});

test("closing a period with two devices: the other device's old copies drop, its offline movements stay", () => {
  const d = sample();
  const c = C.closePeriod(d, "2026-10-31", NOW, "cls00001");
  // device B still has the old movements, plus a sale typed offline (dated inside the period, before the close)
  const offline = mv("mv0099", "out", "2026-10-30", [{ i: "item01", q: -k(1) }], { m: NOW - 5000 });
  const b = m(d, data({ moves: [offline] }));
  const after = m(c, b);
  assert.deepEqual(after.moves.map((x) => x.id), ["mv0007", "mv0008", "mv0099"]);
  assert.equal(C.qtyMap(after).item01, C.qtyMap(d).item01 - k(1));
  assert.equal(JSON.stringify(m(b, c)), JSON.stringify(after));            // symmetric
  // 90 days later the id list is gone: old copies (m ≤ at) still drop, a later backdated fix stays
  const later = NOW + 91 * 86400000;
  const late = mv("mv0100", "fix", "2026-10-15", [{ i: "item02", q: k(1) }], { m: NOW + 10000 });
  const z = C.merge(after, m(d, data({ moves: [late] })), later);
  assert.equal(z.close.ids, "");
  assert.deepEqual(z.moves.map((x) => x.id), ["mv0007", "mv0008", "mv0100"]);
  // reopening: a tombstone on the close, the archive merged back
  const re = C.merge(C.merge(c, data({ tombs: { cls00001: NOW + 2000 } }), NOW + 2000), d, NOW + 2000);
  assert.equal(re.close, undefined);
  assert.equal(views(re), views(d));
  // a 1.5 copy (no close key) changes nothing
  const old = JSON.parse(JSON.stringify(d));
  assert.equal(JSON.stringify(m(c, old)), JSON.stringify(m(c, c)));
  assert.equal(C.normClose({ id: "cls00001", m: 1, d: "2026-01-01", at: 1, ids: "bad id!" }).ids, "");
});
