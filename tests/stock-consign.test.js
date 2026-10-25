// Consignment in Stock (stock/core.js 1.8): the cons list and its
// merge, due settlements, the settlement movement and the Invoices
// prefill it opens.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "stock/core.js"));
const INV = require(path.join(__dirname, "..", "invoices/core.js"));

const NOW = Date.UTC(2026, 9, 25, 10, 0, 0);
function k(n) { return n * 1000; }
function base() {
  return {
    items: [
      { id: "book01", m: 1, name: "Sea Wolves", sku: "GL-001", unit: "pcs", price: 1500, vat: 6 },
      { id: "book02", m: 1, name: "Salt", unit: "pcs", price: 1200, vat: 6 },
      { id: "mug001", m: 1, name: "Mug", unit: "pcs", price: 800, vat: 24 }
    ],
    cats: [], units: [], sups: [], tombs: {},
    whs: [{ id: "whshop1", m: 1, name: "Corner Books", arch: 0 }],
    cons: [{ id: "whshop1", m: 1, on: 1, disc: 35, every: 3, who: "" }],
    moves: [
      { id: "mv0001", m: 1, t: "in", d: "2026-05-01", lines: [{ i: "book01", q: k(50) }, { i: "book02", q: k(30) }, { i: "mug001", q: k(5) }] },
      { id: "mv0002", m: 1, t: "xfer", d: "2026-05-10", w2: "whshop1", lines: [{ i: "book01", q: k(10) }, { i: "book02", q: k(6) }] }
    ]
  };
}
function norm(d) { return C.merge(d, d, NOW); }

test("normCons: strict, ranges clamped to defaults, main warehouse refused", () => {
  assert.deepEqual(C.normCons({ id: "whshop1", m: 2, disc: 40, every: 6, who: "  Corner\nBooks Ltd " }),
    { id: "whshop1", m: 2, on: 1, disc: 40, every: 6, who: "Corner Books Ltd" });
  const r = C.normCons({ id: "whshop1", m: 2, on: 0, disc: 95, every: 30, extra: 1 });
  assert.equal(r.on, 0); assert.equal(r.disc, 0); assert.equal(r.every, 0); assert.ok(!("extra" in r));
  assert.equal(C.normCons({ id: C.WH_MAIN, m: 1 }), null);
  assert.equal(C.normCons({ id: "x", m: 1 }), null);
});

test("merge: cons written only when it has rows, LWW, a warehouse tombstone hides it", () => {
  const d = base();
  const none = norm(Object.assign({}, d, { cons: [] }));
  assert.ok(!("cons" in none));
  const a = norm(d), b = norm(Object.assign({}, d, { cons: [{ id: "whshop1", m: 5, on: 1, disc: 30, every: 0, who: "" }] }));
  assert.equal(C.merge(a, b, NOW).cons[0].disc, 30);
  assert.equal(C.merge(b, a, NOW).cons[0].disc, 30);
  // a 1.7 copy (no cons list) never strips it
  const old = JSON.parse(JSON.stringify(b)); delete old.cons; old.whs[0].name = "Corner Books (Main St)"; old.whs[0].m = 9;
  const mm = C.merge(old, b, NOW);
  assert.equal(mm.cons[0].disc, 30);
  assert.equal(mm.whs[0].name, "Corner Books (Main St)");
  const del = norm(Object.assign({}, b, { tombs: { whshop1: NOW } }));
  assert.ok(!("cons" in del));
});

test("addMonths keeps the day or takes the month's last", () => {
  assert.equal(C.addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(C.addMonths("2026-11-15", 3), "2027-02-15");
  assert.equal(C.addMonths("2028-03-31", -1), "2028-02-29");
});

test("consList, consOf: only warehouses that are on and not archived", () => {
  const d = norm(base());
  assert.equal(C.consList(d).length, 1);
  assert.equal(C.consOf(d, ""), null);
  const off = norm(Object.assign(base(), { cons: [{ id: "whshop1", m: 2, on: 0 }] }));
  assert.equal(C.consList(off).length, 0);
  const arch = base(); arch.whs[0].arch = 1;
  assert.equal(C.consList(norm(arch)).length, 0);
});

test("consDue: from the first delivery, then from the last settlement; empty shelf is never due", () => {
  const d = norm(base());
  assert.equal(C.consDue(d, "2026-08-09").length, 0);
  const due = C.consDue(d, "2026-08-10");
  assert.equal(due.length, 1);
  assert.equal(due[0].since, "2026-05-10");
  assert.equal(due[0].due, "2026-08-10");
  const mv = C.settleMove(d, "whshop1", { book01: k(4) }, "2026-08-12", "mv0003", NOW);
  d.moves.push(mv);
  assert.equal(C.lastSettle(d, "whshop1"), "2026-08-12");
  assert.equal(C.consDue(d, "2026-11-11").length, 0);
  assert.equal(C.consDue(d, "2026-11-12").length, 1);
  // a voided settlement doesn't count
  mv.v = 1;
  assert.equal(C.lastSettle(d, "whshop1"), "");
  // every 0 = no reminder
  const noRem = norm(Object.assign(base(), { cons: [{ id: "whshop1", m: 2, on: 1, every: 0 }] }));
  assert.equal(C.consDue(noRem, "2027-01-01").length, 0);
  // all of it came back: nothing to settle
  const back = base();
  back.moves.push({ id: "mv0009", m: 1, t: "xfer", d: "2026-06-01", w: "whshop1", lines: [{ i: "book01", q: k(10) }, { i: "book02", q: k(6) }] });
  assert.equal(C.consDue(norm(back), "2027-01-01").length, 0);
});

test("settleMove: sold = what is there − what is left, at the sale price, in that warehouse", () => {
  const d = norm(base());
  const mv = C.settleMove(d, "whshop1", { book01: k(4), book02: k(6) }, "2026-08-12", "mv0003", NOW);
  assert.equal(mv.t, "out"); assert.equal(mv.w, "whshop1"); assert.equal(mv.src, "cons:whshop1");
  assert.deepEqual(mv.lines, [{ i: "book01", q: -k(6), p: 1500 }]);
  // an item not named: all of it is left
  assert.equal(C.settleMove(d, "whshop1", {}, "2026-08-12", "mv0003", NOW), null);
  // more left than there is: nothing sold of it
  assert.equal(C.settleMove(d, "whshop1", { book01: k(99), book02: k(6) }, "2026-08-12", "mv0003", NOW), null);
  // all sold
  const all = C.settleMove(d, "whshop1", { book01: 0, book02: 0 }, "2026-08-12", "mv0003", NOW);
  assert.deepEqual(all.lines.map((l) => l.q), [-k(10), -k(6)]);
  // not a consignment warehouse / bad input
  assert.equal(C.settleMove(d, "", { book01: 0 }, "2026-08-12", "mv0003", NOW), null);
  assert.equal(C.settleMove(d, "whshop1", { book01: 0 }, "12/08/2026", "mv0003", NOW), null);
  // the quantities follow: the shop now holds 4 + 6, the business 66 in all
  d.moves.push(mv);
  const n = norm(d);
  assert.deepEqual(Object.assign({}, C.qtyIn(n, "whshop1")), { book01: k(4), book02: k(6) });
  assert.equal(C.qtyMap(n).book01, k(44));
});

test("consInvoice: the shop as client, lines at its discount, no codes (stock already came off)", () => {
  const d = norm(base());
  d.settings = C.normSettings({ cur: "EUR" });
  const mv = C.settleMove(d, "whshop1", { book01: k(4), book02: k(2) }, "2026-08-12", "mv0003", NOW);
  const req = C.consInvoice(d, "whshop1", mv);
  assert.equal(req.name, "Corner Books");
  assert.deepEqual(req.ref, { app: "stock", id: "cons-mv0003" });
  assert.deepEqual(req.items, [
    { d: "Sea Wolves (GL-001)", q: 6, p: 15, vat: 6, disc: 35 },
    { d: "Salt", q: 4, p: 12, vat: 6, disc: 35 }
  ]);
  // Invoices takes it as a prefill, and offers no "take out of stock"
  const p = INV.normPrefill(req);
  assert.equal(p.client.name, "Corner Books");
  assert.equal(p.items.length, 2);
  assert.equal(p.items[0].disc, 35);
  assert.ok(!p.items.some((x) => x.code));
  // invoice to another name
  d.cons[0].who = "Corner Books Ltd";
  assert.equal(C.consInvoice(d, "whshop1", mv).name, "Corner Books Ltd");
  // not a settlement of this warehouse
  assert.equal(C.consInvoice(d, "whshop1", d.moves[0]), null);
});
