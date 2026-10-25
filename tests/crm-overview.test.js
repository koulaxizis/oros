// The partner card's Overview (crm/overview.js, partner card W2): money
// both ways, consignment shelf, open orders, unbilled hours, titles and
// royalties, read from the other apps' data through their own cores.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const R = (f) => require(path.join(__dirname, "..", f));
const C = R("crm/core.js"), O = R("crm/overview.js"), S = R("stock/core.js"), T = R("timesheet/core.js"), I = R("invoices/core.js");

const NOW = Date.UTC(2026, 9, 25, 12);
const TODAY = "2026-10-25";

function stock() {
  return S.merge({
    items: [{ id: "item001", m: 1, name: "Book", price: 2000, cost: 500, unit: "pc" }],
    sups: [{ id: "sup0001", m: 1, name: "Paper" }, { id: "sup0002", m: 1, name: "Other" }],
    whs: [{ id: "wh00001", m: 1, name: "Shop" }, { id: "wh00002", m: 1, name: "Not linked" }],
    cons: [{ id: "wh00001", m: 1, on: 1, disc: 30, every: 1 }, { id: "wh00002", m: 1, on: 1 }],
    moves: [
      { id: "mv00001", m: 1, t: "in", d: "2026-01-01", lines: [{ i: "item001", q: 10000 }] },
      { id: "mv00002", m: 1, t: "xfer", d: "2026-02-01", w2: "wh00001", lines: [{ i: "item001", q: 4000 }] }
    ],
    pos: [
      { id: "po00001", m: 1, sup: "sup0001", d: "2026-10-01", st: "sent", lines: [{ i: "item001", q: 3000, c: 500 }] },
      { id: "po00002", m: 1, sup: "sup0001", d: "2026-09-01", st: "closed", lines: [{ i: "item001", q: 9000, c: 500 }] },
      { id: "po00003", m: 1, sup: "sup0002", d: "2026-10-01", st: "sent", lines: [{ i: "item001", q: 1000, c: 500 }] }
    ],
    settings: { m: 1, cur: "EUR" }
  }, null, NOW);
}
function ts() {
  return T.normalize({ ver: 1, clients: [{ id: "tsc0001", m: 1, name: "K", rate: 5000 }],
    projects: [{ id: "prj0001", m: 1, name: "P", client: "tsc0001", bill: 1 }],
    entries: [
      { id: "ent0001", m: 1, p: "prj0001", s: NOW - 7200000, e: NOW - 3600000 },
      { id: "ent0002", m: 1, p: "prj0001", s: NOW - 20000000, e: NOW - 16400000, billed: 1 }
    ], prefs: { cur: "EUR" }, pm: 0 });
}
const PUB = {
  titles: [{ id: "tit0001", t: "B", ppl: [{ r: "a", n: "Me", crm: "cust001" }] }, { id: "tit0002", t: "A", ppl: [{ r: "t", n: "Μαρία" }] }],
  stmts: [
    { id: "st00001", n: "Me", from: "2026-01-01", to: "2026-06-30", cur: "EUR", due: 1234, paid: "", rec: [{ ti: "tit0001", tr: "r1", adv: 50000, left: 30000 }] },
    { id: "st00002", n: "Me", from: "2025-07-01", to: "2025-12-31", cur: "EUR", due: 999, paid: "2026-01-10", rec: [{ ti: "tit0001", tr: "r1", adv: 50000, left: 45000 }] },
    { id: "st00003", n: "μαρια", from: "2026-01-01", to: "2026-06-30", cur: "EUR", due: 500, paid: "", rec: [] },
    { id: "st00004", n: "Me", from: "2026-07-01", to: "2026-09-30", cur: "EUR", due: 700, paid: "", v: 1, rec: [] }
  ]
};

function build(pt, extra) {
  const data = C.norm(Object.assign({ cust: [{ id: "cust001", m: 1, name: "Me" }], pt: [Object.assign({ id: "cust001", m: 1 }, pt)] }, extra || {}));
  const cust = data.cust[0];
  return O.build({ data, cust, today: TODAY, nowMs: NOW, links: C.linksOf(data, cust),
    stock: stock(), S, ts: ts(), T, pub: PUB, inv: null, I });
}

test("consignment shop: shelf at sale price and a settlement due; unlinked shops left out", () => {
  const x = build({ ln: ["wh:wh00001"] });
  assert.deepEqual(x.shops, [{ id: "wh00001", name: "Shop", products: 1, q: 4000, value: 8000, cur: "EUR", last: "", due: "2026-03-01" }]);
});

test("supplier: only open orders of that supplier, pieces still to come at the order's cost", () => {
  const x = build({ ln: ["sup:sup0001"] });
  assert.deepEqual(x.sups, [{ id: "sup0001", name: "Paper", open: 1, left: 3000, value: 1500, cur: "EUR" }]);
});

test("Timesheet: billable hours not yet billed, at the client's rate", () => {
  const x = build({ ln: ["tsc:tsc0001"] });
  assert.deepEqual(x.work, [{ id: "tsc0001", name: "K", ms: 3600000, amount: 5000, cur: "EUR" }]);
});

test("Publishing: titles by id, unpaid statements (voided ones out), advance from the latest statement", () => {
  const x = build({ ln: [] });
  assert.deepEqual(x.pub.titles.map((r) => r.t), ["B"]);
  assert.deepEqual(x.pub.due, { EUR: 1234 });
  assert.deepEqual(x.pub.adv, { EUR: 30000 });
  assert.equal(x.pub.open, 1);
  assert.deepEqual(x.money.out, { EUR: 1234 }, "royalties due count as owed by you");
  const y = build({ ln: ["pub:μαρια"] });
  assert.deepEqual(y.pub.titles.map((r) => r.t), ["A", "B"]);
  assert.deepEqual(y.pub.due, { EUR: 1734 }, "a linked name's statements count too");
});

test("nothing linked: empty sections, the relationship still there", () => {
  const x = build({ ln: [] }, {
    fups: [{ id: "fup0001", m: 1, cust: "cust001", d: "2026-11-02", text: "Call" }],
    deals: [{ id: "deal001", m: 1, cust: "cust001", title: "D", val: 5000, stage: "new" }],
    acts: [{ id: "act0001", m: 1, cust: "cust001", k: "call", at: NOW - 1000 }]
  });
  assert.deepEqual([x.shops, x.sups, x.work], [[], [], []]);
  assert.deepEqual(x.crm, { last: NOW - 1000, next: "2026-11-02", deals: 1, val: 5000 });
});

test("Invoices: what a customer owes, open and overdue per currency", () => {
  const inv = I.normalize({ ver: 1, clients: [{ id: "cli0001", m: 1, name: "Me" }], docs: [
    { id: "doc0001", m: 1, kind: "ext", st: "issued", num: "A1", date: "2026-09-01", due: "2026-09-30", cur: "EUR", cli: "cli0001", xnet: 1000, xvat: 0 }
  ] });
  const data = C.norm({ cust: [{ id: "cust001", m: 1, name: "Me" }], pt: [{ id: "cust001", m: 1, ln: ["inv:cli0001"] }] });
  const x = O.build({ data, cust: data.cust[0], today: TODAY, nowMs: NOW, links: C.linksOf(data, data.cust[0]), inv, I, alsoInv: ["cli0001"] });
  assert.equal(x.money.in.EUR.open > 0, true);
  assert.equal(x.money.in.EUR.overdue, x.money.in.EUR.open);
});
