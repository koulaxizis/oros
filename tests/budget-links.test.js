// Budget linked entries (budget/links.js, BR-B3): Invoices payments
// become income in Budget by themselves, the same on every device, and
// what you change or delete in Budget stays yours.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const L = require(path.join(__dirname, "..", "budget/links.js"));

const DOC = { id: "doc-1", m: 5, kind: "ext", st: "issued", num: "ΤΠΥ 149", cur: "EUR", c: { name: "Πελάτης ΕΠΕ" }, crm: "crm-7" };
function inv(pays, docs) { return { ver: 1, docs: docs || [DOC], pays: pays }; }
const PAY = { id: "pay-1", m: 100, doc: "doc-1", date: "2026-10-30", amt: 88400, how: "bank", ab: 1 };
const budget = (tx, tombs) => ({ tx: tx || [], tombs: tombs || {} });

test("invoiceRows: only payments made with the setting on, in Budget's currency", () => {
  const rows = L.invoiceRows(inv([PAY,
    Object.assign({}, PAY, { id: "pay-2", ab: undefined }),           // before the setting / turned off
    Object.assign({}, PAY, { id: "pay-3", bud: 1 }),                  // already sent by hand
    Object.assign({}, PAY, { id: "pay-4", amt: -500 }),               // a refund
    Object.assign({}, PAY, { id: "pay-5", doc: "nope" }),
    { id: "pay-6", m: 300, del: 1 }
  ]), "EUR");
  assert.deepEqual(rows, [
    { key: "pay-1", m: 100, a: 88400, d: "2026-10-30", n: "ΤΠΥ 149 · Πελάτης ΕΠΕ", crm: "crm-7" },
    { key: "pay-6", m: 300, del: 1 }
  ]);
  assert.deepEqual(L.invoiceRows(inv([PAY]), "USD"), []);
  assert.deepEqual(L.invoiceRows(null, "EUR"), []);
  const voided = L.invoiceRows(inv([PAY], [Object.assign({}, DOC, { st: "void", m: 400 })]), "EUR");
  assert.deepEqual(voided, [{ key: "pay-1", m: 400, del: 1 }]);
  assert.deepEqual(L.invoiceRows(inv([PAY], [{ id: "doc-1", m: 500, del: 1 }]), "EUR"), [{ key: "pay-1", m: 500, del: 1 }]);
});

test("plan: a new entry with a fixed id and the payment's own m (every device the same)", () => {
  const rows = L.invoiceRows(inv([PAY]), "EUR");
  const p1 = L.plan(budget(), "invoices", rows);
  const p2 = L.plan(budget(), "invoices", rows);
  assert.deepEqual(p1, p2);
  assert.deepEqual(p1.put, [{ id: "l-invoices-pay-1", m: 100, d: "2026-10-30", a: 88400, k: "i", c: "i-free",
                              n: "ΤΠΥ 149 · Πελάτης ΕΠΕ", src: "invoices", crm: "crm-7" }]);
  assert.deepEqual(p1.drop, []);
  // once there, nothing more to do
  assert.deepEqual(L.plan(budget(p1.put), "invoices", rows), { put: [], drop: [] });
});

test("plan: a changed payment updates amount and date only; your edit wins", () => {
  const mine = { id: "l-invoices-pay-1", m: 100, d: "2026-10-30", a: 88400, k: "i", c: "o-other", n: "my note", ac: "acc-1", src: "invoices" };
  const changed = L.invoiceRows(inv([Object.assign({}, PAY, { m: 200, amt: 50000, date: "2026-11-02" })]), "EUR");
  const p = L.plan(budget([mine]), "invoices", changed);
  assert.deepEqual(p.put, [Object.assign({}, mine, { a: 50000, d: "2026-11-02", m: 200 })]);
  // edited in Budget after the payment changed: left alone
  const edited = Object.assign({}, mine, { m: 250 });
  assert.deepEqual(L.plan(budget([edited]), "invoices", changed).put, []);
  // a note change on the payment (same amount and date): nothing to write
  const same = L.invoiceRows(inv([Object.assign({}, PAY, { m: 300, note: "x" })]), "EUR");
  assert.deepEqual(L.plan(budget([mine]), "invoices", same).put, []);
});

test("plan: a deleted payment removes the entry, unless you edited it later; your delete stays", () => {
  const tx = { id: "l-invoices-pay-1", m: 100, d: "2026-10-30", a: 88400, k: "i", c: "i-free", n: "", src: "invoices" };
  const gone = [{ key: "pay-1", m: 300, del: 1 }];
  assert.deepEqual(L.plan(budget([tx]), "invoices", gone).drop, [{ id: "l-invoices-pay-1", m: 300 }]);
  assert.deepEqual(L.plan(budget([Object.assign({}, tx, { m: 400 })]), "invoices", gone).drop, []);
  assert.deepEqual(L.plan(budget(), "invoices", gone), { put: [], drop: [] });
  // deleted in Budget: never comes back, not even when the payment changes
  const later = L.invoiceRows(inv([Object.assign({}, PAY, { m: 900, amt: 1 })]), "EUR");
  assert.deepEqual(L.plan(budget([], { "tx:l-invoices-pay-1": 150 }), "invoices", later).put, []);
});

test("plan: bad input writes nothing", () => {
  assert.deepEqual(L.plan(null, "invoices", []), { put: [], drop: [] });
  assert.deepEqual(L.plan(budget(), "Bad Src", [{ key: "a", m: 1, a: 1, d: "2026-01-01" }]), { put: [], drop: [] });
  assert.deepEqual(L.plan(budget(), "invoices", [{ key: "UPPER", m: 1 }, { key: "ok", m: 0 }, null]), { put: [], drop: [] });
});
