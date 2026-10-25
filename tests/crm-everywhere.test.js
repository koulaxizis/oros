// Partner card W5: the partner outside CRM. The balance in Invoices
// (OrosCrmCore.balance) as search and Contacts show it, CRM's Today
// rows for linked partners (settlement due, royalties, unbilled hours),
// received invoices to pay in Invoices' Today, and the Assistant's
// "what is open with X?" summary (assistant/summary.js crmPartner).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const R = (f) => require(path.join(__dirname, "..", f));
const C = R("crm/core.js"), O = R("crm/overview.js"), S = R("stock/core.js"), T = R("timesheet/core.js"), I = R("invoices/core.js");
const SUM = R("assistant/summary.js");

const NOW = Date.UTC(2026, 9, 25, 12);
const TODAY = "2026-10-25";

function crm() {
  return C.norm({
    cust: [{ id: "cust001", m: 1, name: "Alpha Books", afm: "123456789" }, { id: "cust002", m: 1, name: "Alpha Print" }, { id: "cust003", m: 1, name: "Beta" }],
    pt: [{ id: "cust001", m: 1, roles: ["shop", "sup"], ln: ["wh:wh00001", "tsc:tsc0001", "inv:cli0001"] }],
    ctr: [{ id: "ctr0001", m: 1, cust: "cust001", t: "Consignment 2026", to: "2026-11-10", rem: 30 }]
  });
}
function inv() {
  return I.normalize({ ver: 1, clients: [{ id: "cli0001", m: 1, name: "Alpha Books" }],
    docs: [{ id: "doc0001", m: 1, kind: "inv", st: "issued", ser: "ser-inv", seq: 1, num: "INV-1", date: "2026-09-01", due: "2026-09-30",
             cur: "EUR", cli: "cli0001", c: { name: "Alpha Books" }, lines: [{ d: "Books", q: 1, p: 10000, vat: 0 }] }],
    pays: [],
    bills: [{ id: "bil0001", m: 1, num: "Τ-7", date: "2026-10-01", due: "2026-10-27", cur: "EUR", sup: { name: "Alpha Books", afm: "EL123456789" }, net: 5000, vat: 0, note: "" }],
    bpays: [] });
}
function stock() {
  return S.merge({
    items: [{ id: "item001", m: 1, name: "Book", price: 2000, cost: 500, unit: "pc" }],
    whs: [{ id: "wh00001", m: 1, name: "Shop" }],
    cons: [{ id: "wh00001", m: 1, on: 1, disc: 30, every: 1 }],
    moves: [{ id: "mv00001", m: 1, t: "in", d: "2026-01-01", lines: [{ i: "item001", q: 10000 }] },
            { id: "mv00002", m: 1, t: "xfer", d: "2026-02-01", w2: "wh00001", lines: [{ i: "item001", q: 4000 }] }],
    settings: { m: 1, cur: "EUR" }
  }, null, NOW);
}
function tsRaw() {
  return { ver: 1, clients: [{ id: "tsc0001", m: 1, name: "K", rate: 5000 }],
    projects: [{ id: "prj0001", m: 1, name: "P", client: "tsc0001", bill: 1 }],
    entries: [{ id: "ent0001", m: 1, p: "prj0001", s: NOW - 3 * 3600000, e: NOW - 3600000 }], prefs: { cur: "EUR" }, pm: 0 };
}

test("balance: what a partner owes you and what you owe them, in Invoices", () => {
  const d = crm();
  const b = C.balance(d, d.cust[0], I, inv(), TODAY);
  assert.deepEqual(b, { "in": { EUR: { open: 10000, overdue: 10000 } }, out: { EUR: { open: 5000, overdue: 0 } } });
  assert.deepEqual(C.balance(d, d.cust[2], I, inv(), TODAY), { "in": {}, out: {} });
  assert.deepEqual(C.balance(d, d.cust[0], null, inv(), TODAY), { "in": {}, out: {} }, "no Invoices: nothing");
});

test("search: a matching partner leads with its balance; contracts are found", () => {
  const P = R("crm/search.js");
  const store = { "oros-crm-data": crm(), "oros-invoices-data": inv() };
  globalThis.OrosCrmCore = C;
  globalThis.OrosInvoicesCore = I;
  try {
    const words = ["alpha", "books"];
    const hits = P.search({ q: "alpha books", words, fold: C.fold, lang: "en", code: "en", readJSON: (k) => store[k] || null });
    const a = hits.find((h) => h.id === "cust001");
    assert.ok(a.text.startsWith("Owes you €100 · You owe €50"), a.text);
    assert.equal(hits.find((h) => h.id === "cust003").text, "", "a customer that does not match is not worked out");
    const k = hits.find((h) => h.id === "ctr0001");
    assert.equal(k.title, "Consignment 2026");
    assert.deepEqual(k.target, { cust: "cust001" });
    const el = P.search({ q: "alpha books", words, fold: C.fold, lang: "el", code: "el", readJSON: (k2) => store[k2] || null });
    assert.ok(el.find((h) => h.id === "cust001").text.startsWith("Σου χρωστά"));
  } finally {
    delete globalThis.OrosCrmCore;
    delete globalThis.OrosInvoicesCore;
  }
});

test("Today: settlement due, hours not billed and royalties of linked partners open the partner", () => {
  const P = R("crm/today.js");
  const store = { "oros-crm-data": crm(), "oros-stock-data": stock(), "oros-timesheet-data": tsRaw(),
    "oros-publish-data": { titles: [], stmts: [] } };
  Object.assign(globalThis, { OrosCrmCore: C, OrosCrmOverview: O, OrosStockCore: S, orosTimesheetCore: T, OrosInvoicesCore: I });
  try {
    const ctx = { today: TODAY, horizon: 3, now: NOW, lang: "en", readJSON: (k) => store[k] || null,
      readRaw: (k) => (store[k] ? JSON.stringify(store[k]) : null), addDays: C.addDays };
    const rows = P.collect(ctx);
    const settle = rows.find((r) => r.id === "cons-wh00001");
    assert.deepEqual(settle, { id: "cons-wh00001", due: "2026-03-01", title: "Settlement due: Shop", text: "Alpha Books", kind: "task", target: { cust: "cust001" } });
    const hrs = rows.find((r) => r.id === "hrs-cust001");
    assert.equal(hrs.title, "Hours not billed: 2 h · €100");
    assert.equal(hrs.kind, "info");
    assert.equal(rows.some((r) => /^roy-/.test(r.id)), false, "no statement, no royalty line");
    // the contract's reminder is an ordinary follow-up row (W4) and still comes first
    store["oros-crm-data"].fups = [{ id: "fup0001", m: 1, cust: "cust001", d: TODAY, text: "Contract ends" }];
    assert.equal(P.collect(ctx)[0].id, "fup0001");
  } finally {
    ["OrosCrmCore", "OrosCrmOverview", "OrosStockCore", "orosTimesheetCore", "OrosInvoicesCore"].forEach((k) => delete globalThis[k]);
  }
});

test("Invoices Today: a received invoice to pay shows on its due day, a paid one does not", () => {
  const P = R("invoices/today.js");
  const d = inv();
  globalThis.OrosInvoicesCore = I;
  try {
    const ctx = { today: TODAY, horizon: 3, now: NOW, lang: "en", readRaw: () => JSON.stringify(d), addDays: C.addDays };
    const row = P.collect(ctx).find((r) => r.id === "bill-bil0001");
    assert.deepEqual(row, { id: "bill-bil0001", due: "2026-10-27", kind: "task", title: "Τ-7 · Alpha Books", text: "To pay: €50.00", target: { bill: "bil0001" } });
    d.bpays = [{ id: "bpy0001", m: 2, bill: "bil0001", date: "2026-10-20", amt: 5000, how: "bank", note: "" }];
    assert.equal(P.collect(ctx).some((r) => r.id === "bill-bil0001"), false);
  } finally {
    delete globalThis.OrosInvoicesCore;
  }
});

test("Assistant: what is open with a partner; several matches ask which one", () => {
  const d = crm();
  const a = SUM.normArgs({ app: "crm", partner: "  alpha   books " }, TODAY);
  assert.equal(a.partner, "alpha books");
  assert.equal(SUM.normArgs({ app: "todo", partner: "x" }, TODAY).partner, undefined);
  const build = (c) => O.build({ data: d, cust: c, today: TODAY, nowMs: NOW, links: C.linksOf(d, c), inv: inv(), I,
    alsoInv: ["cli0001"], stock: stock(), S, ts: T.parse(JSON.stringify(tsRaw())), T, pub: null });
  const s = SUM.crmPartner(C, d, "alpha books", TODAY, build);
  assert.equal(s.found, true);
  assert.deepEqual(s.target, { cust: "cust001" });
  assert.deepEqual(s.owes_you, { EUR: 100 });
  assert.deepEqual(s.you_owe, { EUR: 50 });
  assert.equal(s.consignment[0].settlement_due, "2026-03-01");
  assert.equal(s.hours_not_billed[0].hours, 2);
  assert.deepEqual(s.contracts, [{ title: "Consignment 2026", from: "", to: "2026-11-10", state: "soon" }]);
  const lines = SUM.preview(s, "en");
  assert.equal(lines[0], "Alpha Books");
  assert.ok(lines.includes("Owes you: 100.00 EUR (overdue 100.00 EUR)"), lines.join("\n"));
  const many = SUM.crmPartner(C, d, "alpha", TODAY, build);
  assert.deepEqual(many, { app: "crm", partner: "alpha", found: false, matches: ["Alpha Books", "Alpha Print"] });
  assert.equal(SUM.crmPartner(C, d, "gamma", TODAY, build).found, false);
  assert.match(SUM.preview(SUM.crmPartner(C, d, "gamma", TODAY, build), "el")[0], /Κανένας συνεργάτης/);
});
