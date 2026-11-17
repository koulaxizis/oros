// Billing (app merge 7, wave K4): the quotes' way to money on Billing's
// Overview, worked out each time from both slices and never stored.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const Q = require("../quote/core.js");

const raw = { deleted: { gone: 1 }, quotes: [
  { id: "a", date: "2026-10-03", status: "accepted", currency: "EUR", items: [{ qty: 1, price: 100, vat: 24 }] },
  { id: "b", date: "2026-11-02", status: "sent", items: [] },                       // no currency = EUR
  { id: "c", date: "2026-11-05", status: "accepted", items: [{ qty: 2, price: 50, vat: 0 }] },
  { id: "p", date: "2026-11-09", status: "accepted", items: [{ qty: 1, price: 10, vat: 0 }] },
  { id: "d", date: "2026-11-06", status: "draft" },                                 // never sent
  { id: "e", date: "2026-11-07", status: "accepted", currency: "USD" },              // other currency
  { id: "gone", date: "2026-11-07", status: "sent" },                               // deleted
  { id: "r", date: "2026-11-08", status: "rejected" },
  { id: "old", date: "2026-09-30", status: "sent" }] };                             // before the range
const inv = { a: { paid: false, open: 5000 }, p: { paid: true, open: 0 } };

test("pipeline: month by month, sent → accepted → invoiced → paid", () => {
  const r = Q.pipeline(raw, "2026-10-01", "2026-11-30", "EUR", (id) => inv[id] || null);
  assert.deepEqual(r.months, [
    { ym: "2026-10", sent: 1, accepted: 1, invoiced: 1, paid: 0 },
    { ym: "2026-11", sent: 4, accepted: 2, invoiced: 1, paid: 1 }]);
  assert.equal(r.sent, 5);
  assert.equal(r.accepted, 3);
  assert.equal(r.invoiced, 2);
  assert.equal(r.paid, 1);
  assert.equal(r.rate, 3 / 5);
  assert.equal(r.toInvoice, 10000);    // quote c, 100.00 in cents
  assert.equal(r.unpaid, 5000);        // what quote a's invoice still owes
});

test("pipeline: empty, bad input and a year boundary", () => {
  assert.equal(Q.pipeline(null, "2026-01-01", "2026-12-31", "EUR").rate, null);
  assert.deepEqual(Q.pipeline(raw, "2026-12-01", "2026-01-01", "EUR").months, []);
  const r = Q.pipeline({ quotes: [] }, "2025-12-15", "2026-02-02", "EUR");
  assert.deepEqual(r.months.map((m) => m.ym), ["2025-12", "2026-01", "2026-02"]);
  assert.equal(r.rate, null);
});

test("Billing's Overview shows it, read-only", () => {
  const host = read("invoices/invoices.js");
  assert.match(host, /var p = Q\.pipeline\(raw, k\[0\], k\[1\], cur, quoteInvoiced\);/);
  assert.match(host, /return d\.src === "quote:" \+ qid && d\.st === "issued";/);
  assert.doesNotMatch(host.slice(host.indexOf("function renderQuotePipeline"), host.indexOf("function renderDash")), /setItem|putDoc|saveNow/);
  assert.match(read("invoices/index.html"), /<div id="d-quotes" class="d-quotes" hidden><\/div>/);
  for (const k of ["dash.quotes", "dash.qRate", "dash.qToInv", "dash.qUnpaid", "dash.qNone"]) {
    assert.equal((host.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k);
    assert.match(read("i18n/de/invoices.js"), new RegExp('"' + k.replace(".", "\\.") + '":'), k);
  }
});
