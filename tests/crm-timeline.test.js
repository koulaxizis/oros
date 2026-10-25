// The partner card's one timeline (crm/timeline.js, partner card W3):
// CRM contacts and closed deals with invoices, payments, received
// invoices, Stock orders, deliveries and settlements, Timesheet days,
// royalty statements and Budget entries of one partner, newest first.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const R = (f) => require(path.join(__dirname, "..", f));
const C = R("crm/core.js"), TL = R("crm/timeline.js"), S = R("stock/core.js"), T = R("timesheet/core.js"), I = R("invoices/core.js");

const NOW = Date.UTC(2026, 9, 25, 12);

function fixture() {
  const data = C.norm({
    cust: [{ id: "cust001", m: 1, name: "Shop", afm: "999" }, { id: "cust002", m: 1, name: "Other" }],
    acts: [{ id: "act001", m: 1, cust: "cust001", k: "call", at: Date.UTC(2026, 9, 20, 9), text: "Called" },
           { id: "act002", m: 1, cust: "cust002", k: "call", at: Date.UTC(2026, 9, 20, 9) }],
    deals: [{ id: "deal01", m: 1, cust: "cust001", title: "Autumn", val: 50000, stage: "won", cd: "2026-10-01" },
            { id: "deal02", m: 1, cust: "cust001", title: "Open", val: 100, stage: "new" }],
    pt: [{ id: "cust001", m: 1, roles: ["shop", "sup"], ln: ["wh:wh00001", "sup:sup0001", "tsc:tsc0001", "pub:shop"] }]
  });
  const stock = S.merge({
    items: [{ id: "item001", m: 1, name: "Book", price: 2000, unit: "pc" }],
    sups: [{ id: "sup0001", m: 1, name: "Shop" }],
    whs: [{ id: "wh00001", m: 1, name: "Shop" }],
    cons: [{ id: "wh00001", m: 1, on: 1 }],
    moves: [
      { id: "mv00001", m: 1, t: "in", d: "2026-01-02", sup: "sup0001", lines: [{ i: "item001", q: 10000 }] },
      { id: "mv00002", m: 1, t: "xfer", d: "2026-02-01", w2: "wh00001", lines: [{ i: "item001", q: 4000 }] },
      { id: "mv00003", m: 1, t: "out", d: "2026-03-01", w: "wh00001", src: "cons:wh00001", lines: [{ i: "item001", q: -1000, p: 2000 }] },
      { id: "mv00004", m: 1, t: "xfer", d: "2026-04-01", w: "wh00001", w2: "", lines: [{ i: "item001", q: 1000 }] },
      { id: "mv00005", m: 1, t: "in", d: "2026-05-01", lines: [{ i: "item001", q: 1000 }] }
    ],
    pos: [{ id: "po00001", m: 1, sup: "sup0001", d: "2026-09-01", st: "sent", lines: [{ i: "item001", q: 3000, c: 500 }] }],
    settings: { m: 1, cur: "EUR" }
  }, null, NOW);
  const ts = T.normalize({ ver: 1, clients: [{ id: "tsc0001", m: 1, name: "K", rate: 5000 }],
    projects: [{ id: "prj0001", m: 1, name: "P", client: "tsc0001", bill: 1 }],
    entries: [
      { id: "ent0001", m: 1, p: "prj0001", s: Date.UTC(2026, 9, 21, 8), e: Date.UTC(2026, 9, 21, 9) },
      { id: "ent0002", m: 1, p: "prj0001", s: Date.UTC(2026, 9, 21, 10), e: Date.UTC(2026, 9, 21, 12) }
    ], prefs: { cur: "EUR" }, pm: 0 });
  const inv = I.normalize({ ver: 1, clients: [{ id: "cli-001", m: 1, name: "Shop", crm: "cust001" }],
    docs: [{ id: "doc-001", kind: "inv", st: "issued", ser: "ser-inv", seq: 1, num: "INV-1", date: "2026-10-02", cur: "EUR", cli: "cli-001",
             c: { name: "Shop" }, lines: [{ d: "x", q: 1, p: 10000, vat: 0 }], m: 1 },
           { id: "doc-002", kind: "inv", st: "draft", date: "2026-10-03", cur: "EUR", cli: "cli-001", c: { name: "Shop" }, lines: [], m: 1 }],
    pays: [{ id: "pay-001", m: 1, doc: "doc-001", date: "2026-10-04", amt: 4000 }],
    bills: [{ id: "bil-001", m: 1, num: "B1", date: "2026-10-05", cur: "EUR", sup: { name: "Shop", afm: "999" }, net: 1000, vat: 0 }],
    bpays: [{ id: "bpy-001", m: 1, bill: "bil-001", date: "2026-10-06", amt: 1000 }] });
  const pub = { titles: [{ id: "tit0001", t: "B", ppl: [{ r: "a", n: "Shop" }] }],
    stmts: [{ id: "st00001", n: "SHOP", from: "2026-01-01", to: "2026-06-30", cur: "EUR", due: 1234, paid: "2026-07-15", rec: [] },
            { id: "st00002", n: "Shop", from: "2026-07-01", to: "2026-09-30", cur: "EUR", due: 700, paid: "", v: 1, rec: [] }] };
  const bud = { set: { cur: "EUR" }, tombs: {}, tx: [{ id: "t1", m: 1, d: "2026-10-07", a: 300, k: "o", c: "", n: "Coffee", crm: "cust001" }] };
  const cust = data.cust[0];
  return { data, cust, links: C.linksOf(data, cust), tz: 0, day: "2026-10-25", inv, I, stock, S, ts, pub, bud };
}

test("timeline: every app's events of one partner, newest first, nothing of other partners", () => {
  const evs = TL.build(fixture());
  assert.deepEqual(evs.map((e) => e.k + "@" + e.day), [
    "work@2026-10-21", "act@2026-10-20", "bout@2026-10-07", "bpay@2026-10-06", "bill@2026-10-05", "pay@2026-10-04",
    "inv@2026-10-02", "won@2026-10-01", "po@2026-09-01", "roy@2026-07-15", "stmt@2026-06-30", "back@2026-04-01",
    "settle@2026-03-01", "ship@2026-02-01", "recv@2026-01-02"
  ]);
  const by = Object.fromEntries(evs.map((e) => [e.k, e]));
  assert.equal(by.work.ms, 3 * 3600000, "one line per day and client");
  assert.equal(by.settle.amt, 2000);
  assert.equal(by.inv.amt, 10000);
  assert.deepEqual(by.bill.open, { app: "invoices", target: { bill: "bil-001" } });
  assert.deepEqual(by.bout.open, { app: "budget", target: { tx: "t1" } });
  assert.equal(by.won.amt, 50000);
});

test("timeline: groups filter, no other app's data gives the CRM history alone", () => {
  const x = fixture();
  const evs = TL.build(x);
  assert.deepEqual(TL.filter(evs, "stock").map((e) => e.k), ["po", "back", "settle", "ship", "recv"]);
  assert.equal(TL.filter(evs, "").length, evs.length);
  const only = TL.build({ data: x.data, cust: x.cust, links: [], tz: 0 });
  assert.deepEqual(only.map((e) => e.k), ["act", "won"]);
});

test("timeline: the local day of a contact follows the time zone", () => {
  assert.equal(TL.dayOf(Date.UTC(2026, 9, 20, 23, 30), 0), "2026-10-20");
  assert.equal(TL.dayOf(Date.UTC(2026, 9, 20, 23, 30), -120), "2026-10-21");   // UTC+2
});
