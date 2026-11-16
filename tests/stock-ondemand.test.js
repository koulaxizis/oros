// Stock: on-demand items (ST-OD, data 1.10). A product made to order has
// no real count: it never runs out, is never low, has no stock value,
// the shop's quantity is never read into it nor compared or sent, and
// the till sells it without the below-zero check. Its sales are still
// movements, so sales reports count them.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../stock/core.js");
const P = require("../stock/pos-core.js");
const W = require("../links/woo.js");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const NOW = Date.UTC(2026, 10, 14, 10, 0, 0);
const k = (n) => n * 1000;

function data() {
  return {
    items: [
      C.normItem({ id: "book0001", m: 1, name: "Book", unit: "pcs", price: 1500, vat: 6, min: k(2) }),
      C.normItem({ id: "print001", m: 1, name: "Art print", unit: "pcs", price: 2500, vat: 24, min: k(2), od: 1 })
    ],
    cats: [], units: [], sups: [], tombs: {}, whs: [{ id: "stand01", m: 1, name: "Stand", arch: 0 }],
    moves: [
      { id: "mvin0001", m: 1, d: "2026-11-01", t: "in", ref: "", note: "", lines: [{ i: "book0001", q: k(5), c: 700 }, { i: "print001", q: k(1), c: 900 }] },
      { id: "mvout001", m: 2, d: "2026-11-02", t: "out", ref: "", note: "", lines: [{ i: "print001", q: -k(4), p: 2500 }] }
    ]
  };
}

test("the flag is kept only when on, so other items stay byte-identical", () => {
  const on = C.normItem({ id: "aaaa0001", m: 1, name: "A", od: 1 });
  const off = C.normItem({ id: "aaaa0002", m: 1, name: "B", od: 0 });
  const odd = C.normItem({ id: "aaaa0003", m: 1, name: "C", od: true });
  assert.equal(on.od, 1);
  assert.equal("od" in off, false);
  assert.equal("od" in odd, false, "only od: 1");
  assert.equal(C.isOd(on), true);
  assert.equal(C.isOd(off), false);
  assert.equal(C.isOd(null), false);
});

test("an on-demand item is never out, never low and has no stock value", () => {
  const d = data();
  const rows = C.stockRows(d);
  const book = rows.find((r) => r.item.id === "book0001"), pr = rows.find((r) => r.item.id === "print001");
  assert.equal(pr.q, -k(3), "its movements still add up");
  assert.equal(pr.od, true);
  assert.equal(pr.out, false);
  assert.equal(pr.low, false);
  assert.equal(pr.value, 0);
  assert.equal(book.out, false);
  assert.ok(book.value > 0);
  assert.deepEqual(C.lowList(d).map((r) => r.item.id), [], "nothing to reorder");
});

test("the flag survives a merge and an older device simply drops it", () => {
  const a = data(), b = data();
  b.items = b.items.map((x) => (x.id === "print001" ? Object.assign({}, x) : x));
  const m = C.merge(a, b, NOW);
  assert.equal(m.items.find((x) => x.id === "print001").od, 1);
  const older = JSON.parse(JSON.stringify(a));
  delete older.items[1].od;
  older.items[1].m = 5;   // an older device edits it later: last write wins
  const m2 = C.merge(a, older, NOW);
  assert.equal("od" in m2.items.find((x) => x.id === "print001"), false);
});

test("the shop's quantity is never read into it, compared or sent", () => {
  const d = data();
  const products = [
    { id: 11, name: "Book", sku: "B1", type: "simple", regular_price: "15.00", manage_stock: true, stock_quantity: 9 },
    { id: 12, name: "Art print", sku: "P1", type: "simple", regular_price: "25.00", manage_stock: true, stock_quantity: 40 }
  ];
  d.items[0].sku = "B1";
  d.items[1].sku = "P1";
  const plan = W.productPlan(C, d, products, {}, { acct: "acct01", now: NOW, today: "2026-11-14", setQty: true });
  const lines = plan.move ? plan.move.lines : [];
  assert.deepEqual(lines.map((l) => l.i), ["book0001"], "only the counted product takes the shop's quantity");
  assert.equal(plan.items.every((x) => x.id !== "print001" || x.od === 1), true, "an import never clears the flag");
  const cmp = W.compare(C, d, plan.links);
  assert.equal(cmp.some((r) => r.item.id === "print001"), false, "not in the differences, so never sent");
});

test("the event report shows no quantity left for it; bringing back skips it", () => {
  const d = data();
  d.evs = [{ id: "fair01", m: 1, name: "Fair", from: "2026-11-14", to: "2026-11-14", w: "stand01", pl: "", fl: 0, arch: 0 }];
  const r = P.makeSale({ data: d, cart: [{ i: "print001", q: k(2), p: 2016, vat: 24 }], pay: "cash", d: "2026-11-14", now: NOW, dev: "AB", id: "sale0001", mvId: "mvsale01", w: "stand01", ev: "fair01" });
  d.sales = [r.sale];
  d.moves.push(r.move);
  const whq = { print001: { stand01: -k(2) } };
  const rep = P.evReport(d, d.evs[0], whq);
  const x = rep.titles.find((t) => t.i === "print001");
  assert.equal(x.sold, k(2));
  assert.equal(x.od, 1);
  assert.equal(x.left, 0);
  assert.equal(P.backMove(d.evs[0], whq, { id: "back0001", now: NOW, d: "2026-11-14" }), null);
});

test("the screens and checks know it", () => {
  const st = read("stock/stock.js"), pos = read("stock/pos.js");
  assert.match(st, /if \(prefs\.f === "out" && \(qOf\(r\) > 0 \|\| r\.od\)\) return false;/);
  assert.match(st, /r\.od \? t\("od\.q"\) : fmtQ\(q, it\)/, "the list says On demand");
  assert.match(st, /if \(C\.isOd\(byId\("items", l\.i\)\)\) return false;/, "counter sale: no below-zero check");
  assert.match(st, /!C\.isOd\(byId\("items", id\)\) && after\[id\] < 0/, "movement editor: no below-zero check");
  assert.match(st, /od: od \? 1 : 0/, "the editor saves the switch");
  assert.match(pos, /api\.core\.isOd\(byItem\(l\.i\)\)\) return false;/, "till: no below-zero check");
  assert.match(pos, /!it\.arch && !api\.core\.isOd\(it\) && api\.matchItem/, "not packed for the stand");
  const de = read("i18n/de/stock.js");
  ["od.q", "ed.od", "ed.odHint", "odLeft"].forEach((key) => assert.ok(de.includes("\"" + key + "\":"), "de " + key));
  ["\"ed.od\":", "\"ed.odHint\":", "\"od.q\":"].forEach((key) => assert.equal(st.split(key).length - 1, 2, key + " en + el"));
});
