// Stock fair till, wave F2 (data 1.9): events with a stand warehouse,
// packing and bringing back as transfers (src ev:<id>), the event's
// report over several days, the cash drawer on a closed day, and the
// merge (evs LWW + tombs, ev on sales, fl / cc on zs).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../stock/core.js");
const P = require("../stock/pos-core.js");

const NOW = Date.UTC(2026, 11, 5, 10, 0, 0);
const k = (n) => n * 1000;
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const m = (a, b) => C.merge(a, b, NOW);
function base() {
  return {
    items: [{ id: "book01", m: 1, name: "Book one", unit: "pcs", price: 1415, vat: 6 }, { id: "book02", m: 1, name: "Book two", unit: "pcs", price: 1887, vat: 6 }],
    cats: [], units: [], sups: [], tombs: {},
    whs: [{ id: "stand01", m: 1, name: "Fair stand", arch: 0 }],
    moves: [{ id: "mvin0001", m: 1, d: "2026-12-01", t: "in", ref: "", note: "", lines: [{ i: "book01", q: k(30), p: 500 }, { i: "book02", q: k(20), p: 600 }] }],
    evs: [{ id: "fair2026", m: 1, name: "Book fair", from: "2026-12-04", to: "2026-12-06", w: "stand01", pl: "", fl: 5000, arch: 0 }]
  };
}
function sell(d, ev, cart, id, at, pays) {
  return P.makeSale({ data: d, cart, pay: "cash", pays, d: at, now: NOW, dev: "AB", id, mvId: "mv" + id, w: "stand01", ev });
}

test("normEv: dates, stand, float; junk dropped; evs merge LWW with tombstones", () => {
  assert.equal(C.normEv({ id: "fair2026", m: 1, name: "", from: "2026-12-04" }), null);
  assert.equal(C.normEv({ id: "fair2026", m: 1, name: "X", from: "nope" }), null);
  const e = C.normEv({ id: "fair2026", m: 1, name: "X", from: "2026-12-04", to: "2026-12-01", w: "whmain", pl: "BAD!", fl: -5 });
  assert.deepEqual(e, { id: "fair2026", m: 1, name: "X", from: "2026-12-04", to: "2026-12-04", w: "", pl: "", fl: 0, arch: 0 });
  const a = m(base(), null), b = JSON.parse(JSON.stringify(a));
  b.evs[0].name = "Book fair 2026"; b.evs[0].m = 5;
  assert.equal(m(a, b).evs[0].name, "Book fair 2026");
  assert.deepEqual(m(a, b), m(b, a));
  const gone = JSON.parse(JSON.stringify(a)); gone.evs = []; gone.tombs.fair2026 = NOW;
  assert.ok(!("evs" in m(a, gone)), "a tombstone deletes it, and an empty list is left out");
  const plain = m(Object.assign(base(), { evs: undefined }), null);
  assert.ok(!("evs" in plain), "data without events stays as it was");
});

test("events running on a day; pack, sell over two days, bring back; the report adds up", () => {
  let d = m(base(), null);
  assert.deepEqual(P.evsOn(d, "2026-12-05").map((e) => e.id), ["fair2026"]);
  assert.deepEqual(P.evsOn(d, "2026-12-07"), []);
  const ev = P.evOf(d, "fair2026");
  const pack = P.packMove(ev, [{ i: "book01", q: k(10) }, { i: "book02", q: k(5) }, { i: "book02", q: 0 }, { i: P.OTHER, q: k(1) }], { d: "2026-12-03", now: NOW, id: "mvpack01" });
  assert.deepEqual(pack.lines, [{ i: "book01", q: k(10) }, { i: "book02", q: k(5) }]);
  assert.equal(pack.src, "ev:fair2026");
  assert.equal(pack.w2, "stand01");
  assert.ok(!pack.w, "from the main warehouse");
  d.moves.push(pack);
  d = m(d, null);
  assert.equal(C.whQty(d).book01.stand01, k(10));
  const s1 = sell(d, "fair2026", [{ i: "book01", q: k(3) }], "sale0001", "2026-12-04");
  const s2 = sell(d, "fair2026", [{ i: "book01", q: k(1) }, { i: "book02", q: k(2) }, { i: P.OTHER, q: k(1), p: 400, vat: 0, n: "Poster" }], "sale0002", "2026-12-05",
    null);
  const other = P.makeSale({ data: d, cart: [{ i: "book02", q: k(1) }], pay: "card", d: "2026-12-05", now: NOW, dev: "AB", id: "sale0003", mvId: "mvsale03" });
  d.sales = [s1.sale, s2.sale, other.sale];
  d.moves.push(s1.move, s2.move, other.move);
  d = m(d, null);
  assert.equal(d.sales.find((x) => x.id === "sale0001").ev, "fair2026");
  const whq = C.whQty(d);
  assert.equal(whq.book01.stand01, k(6));
  assert.equal(whq.book02.stand01, k(3));
  const rep = P.evReport(d, ev, whq);
  assert.equal(rep.n, 2, "only the event's sales");
  assert.deepEqual(rep.days.map((x) => x.d), ["2026-12-04", "2026-12-05"]);
  assert.equal(rep.days.reduce((a, x) => a + x.g, 0), rep.g);
  assert.equal(rep.byPay.cash, rep.g);
  const b1 = rep.titles.find((x) => x.i === "book01");
  assert.deepEqual([b1.taken, b1.sold, b1.back, b1.left], [k(10), k(4), 0, k(6)]);
  assert.ok(rep.titles.some((x) => x.i === P.OTHER && x.n === "Poster" && x.left === 0));
  // the per-day Z of the event's days includes the other sale; the event report does not
  assert.equal(P.zReport(d, "2026-12-05").n, 2);
  // bring back what is left
  const back = P.backMove(ev, whq, { d: "2026-12-06", now: NOW, id: "mvback01" });
  assert.deepEqual(back.lines, [{ i: "book01", q: k(6) }, { i: "book02", q: k(3) }]);
  assert.equal(back.w, "stand01");
  d.moves.push(back);
  d = m(d, null);
  const whq2 = C.whQty(d);
  assert.equal(whq2.book01.stand01 || 0, 0);
  assert.equal(whq2.book01[""], k(30 - 10 + 6));
  const rep2 = P.evReport(d, ev, whq2);
  const b2 = rep2.titles.find((x) => x.i === "book01");
  assert.deepEqual([b2.taken, b2.sold, b2.back, b2.left], [k(10), k(4), k(6), 0]);
  // totals of the business are unchanged by the transfers
  assert.equal(C.qtyMap(d).book01, k(26));
  assert.equal(P.backMove(ev, whq2, { d: "2026-12-06", now: NOW, id: "x" }), null);
  assert.equal(P.packMove(Object.assign({}, ev, { w: "" }), [{ i: "book01", q: 1 }], { d: "2026-12-06", now: NOW, id: "y" }), null);
});

test("the cash drawer: float + cash sales = expected; counted → difference; kept on the closed day", () => {
  let d = m(base(), null);
  const s1 = sell(d, "fair2026", [{ i: "book01", q: k(2) }], "sale0001", "2026-12-04");
  const g = P.totals(s1.sale.lines).gross;
  const s2 = sell(d, "fair2026", [{ i: "book02", q: k(1) }], "sale0002", "2026-12-04", null);
  s2.sale.pay = "card";
  d.sales = [s1.sale, s2.sale];
  d = m(d, null);
  const rep = P.zReport(d, "2026-12-04");
  const dr = P.drawer(rep, 5000, 5000 + g - 10);
  assert.deepEqual(dr, { exp: 5000 + g, cc: 5000 + g - 10, diff: -10 });
  assert.deepEqual(P.drawer(rep, 0), { exp: g, cc: null, diff: null });
  const z = P.zRowDrawer(rep, NOW, 1, 5000, 5000 + g);
  assert.equal(z.fl, 5000);
  const z0 = P.zRowDrawer(rep, NOW, 1, undefined, undefined);
  assert.ok(!("fl" in z0) && !("cc" in z0));
  d.zs = [z];
  const d2 = m(d, null);
  assert.equal(d2.zs[0].fl, 5000);
  assert.equal(d2.zs[0].cc, 5000 + g);
  assert.ok(!("fl" in C.normZ(z0)), "a Z without a drawer stays as it was");
  assert.equal(P.DENOMS.reduce((a, c) => a + c, 0), 88888);
});

test("a sale's event survives a 1.8 copy on a tie", () => {
  const rich = C.normSale({ id: "sale0009", m: 5, d: "2026-12-04", ev: "fair2026", lines: [{ i: "book01", q: 1000, p: 1415, vat: 6 }] });
  const old = C.normSale({ id: "sale0009", m: 5, d: "2026-12-04", lines: [{ i: "book01", q: 1000, p: 1415, vat: 6 }] });
  assert.equal(C.mergeSales([old], [rich])[0].ev, "fair2026");
  assert.equal(C.mergeSales([rich], [old])[0].ev, "fair2026");
});

test("wiring: events, pack, bring back, report and drawer in the till; strings EN, EL, DE", () => {
  const js = read("stock/pos.js"), st = read("stock/stock.js"), de = read("i18n/de/stock.js");
  ["evDialog", "evEditor", "packDialog", "backDialog", "evReportDialog", "countDialog", "P.zRowDrawer", "P.evsOn", "ev: P.evOf"].forEach((n) => assert.ok(js.indexOf(n) >= 0, n));
  ["putEv:", "delEv:", "newWh:", "addMove:", "whQty:", "openSheet:"].forEach((n) => assert.ok(st.indexOf(n) >= 0, n));
  ["evTitle", "evPack", "evBack", "repTitles", "drCc", "drExp", "drCountT"].forEach((key) => {
    assert.ok(js.indexOf(key + ": \"") >= 0, key);
    assert.ok(de.indexOf('"' + key + '":') >= 0, key + " in DE");
  });
  assert.deepEqual((js.match(/innerHTML\s*=\s*[^;]+;/g) || []).filter((x) => !/innerHTML\s*=\s*"";/.test(x)), []);
});
