// Invoices wave 7: received invoices (bills) and what you paid on them,
// for the CRM partner card (BR-CRM-LINK). Normalize, the sync merge
// (lists left out while empty, so an older device costs nothing),
// balances and statuses, the lookup by CRM partner, and a two-device
// round trip through the real sync engine (tests/harness.js).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../invoices/core.js");
const { FakeDropbox, createDevice, readKey, writeKey } = require("./harness");

const json = (x) => JSON.stringify(x);
function bill(id, extra) {
  return Object.assign({ id, num: "Τ-12", date: "2026-10-01", due: "2026-10-20", cur: "EUR",
    sup: { name: "Τυπογραφείο Άλφα", afm: "EL 123456789" }, net: 10000, vat: 2400, note: "", m: 10 }, extra || {});
}
const bpay = (id, b, amt, extra) => Object.assign({ id, bill: b, date: "2026-10-05", amt, how: "bank", note: "", m: 5 }, extra || {});
const model = (o) => C.normalize(Object.assign({ ver: 1, clients: [], docs: [], pays: [] }, o || {}));

test("bills: normalized, bad rows dropped, left out of the data while empty", () => {
  assert.equal("bills" in C.empty(), false);
  assert.equal("bpays" in C.empty(), false);
  const d = model({
    bills: [bill("bil-b"), { id: "bil-x", m: 1, date: "2026-10-01", sup: { name: "" } }, { id: "bil-y", m: 1, sup: { name: "A" } },
            bill("bil-a", { crm: "cust001", net: 1.5, extra1: "kept", sup: { name: "  Beta \n ΕΠΕ ", afm: "" } })],
    bpays: [bpay("bpy-1", "bil-b", 2000), bpay("bpy-2", "bil-b", 0), { id: "bpy-3", m: 1, bill: "BAD ID", date: "2026-10-01", amt: 5 }]
  });
  assert.deepEqual(d.bills.map((b) => b.id), ["bil-a", "bil-b"]);
  assert.equal(d.bills[0].sup.name, "Beta ΕΠΕ");
  assert.equal(d.bills[0].crm, "cust001");
  assert.equal(d.bills[0].net, 0, "money is integer cents");
  assert.equal(d.bills[0].extra1, "kept", "a newer version's flat field rides along");
  assert.deepEqual(d.bpays.map((p) => p.id), ["bpy-1"]);
  assert.equal(C.normalize(d).bills.length, 2, "idempotent");
});

test("bills: balance and status from payments; never in revenue or the dashboard", () => {
  const d = model({ docs: [], bills: [bill("bil-1"), bill("bil-2", { due: "" }), bill("bil-3")],
    bpays: [bpay("bpy-1", "bil-1", 4000), bpay("bpy-2", "bil-3", 12400)] });
  const [b1, b2, b3] = d.bills;
  assert.equal(C.billTotal(b1), 12400);
  assert.equal(C.billBalance(d, b1), 8400);
  assert.equal(C.billStatus(d, b1, "2026-10-10"), "partial");
  assert.equal(C.billStatus(d, b1, "2026-10-21"), "overdue");
  assert.equal(C.billStatus(d, b2, "2027-01-01"), "unpaid", "no due date: never overdue");
  assert.equal(C.billStatus(d, b3, "2026-10-21"), "paid");
  assert.deepEqual(C.billsOpen(d, "2026-10-21"), { EUR: { open: 20800, overdue: 8400, n: 2 } });
  // the revenue side does not see them
  assert.deepEqual(C.dashboard(d, "2026-01-01", "2026-12-31", "EUR").count, 0);
  assert.equal(C.paidOf(d, "bil-1"), 0);
});

test("bills: a CRM partner's bills by crm id, or by ΑΦΜ when the bill names no partner", () => {
  const d = model({ bills: [
    bill("bil-1", { crm: "cust001" }),
    bill("bil-2", { sup: { name: "Same ΑΦΜ", afm: "123 456 789" } }),
    bill("bil-3", { crm: "cust002", sup: { name: "Other", afm: "123456789" } }),
    bill("bil-4", { sup: { name: "No ΑΦΜ", afm: "" } }),
    bill("bil-5", { crm: "cust001", m: 20, del: 1 })
  ], bpays: [bpay("bpy-1", "bil-1", 12400)] });
  const r = C.billsByCrm(d, "cust001", "2026-10-25", "EL123456789");
  assert.deepEqual(r.rows.map((x) => x.id).sort(), ["bil-1", "bil-2"]);
  assert.deepEqual(r.totals, { EUR: { billed: 24800, paid: 12400, open: 12400, overdue: 12400 } });
  assert.deepEqual(C.billsByCrm(d, "cust001", "2026-10-25", "").rows.map((x) => x.id), ["bil-1"]);
  assert.deepEqual(C.billsByCrm(d, "", "2026-10-25", "").rows, []);
});

test("bills: supplier suggestions, newest first, one per name + ΑΦΜ", () => {
  const d = model({ bills: [bill("bil-1", { m: 1 }), bill("bil-2", { m: 3, crm: "cust001" }), bill("bil-3", { m: 2, sup: { name: "Beta", afm: "" } })] });
  assert.deepEqual(C.billSuppliers(d), [
    { name: "Τυπογραφείο Άλφα", afm: "EL 123456789", crm: "cust001" },
    { name: "Beta", afm: "", crm: "" }
  ]);
});

test("bills merge: newer wins per id, tombstones win ties, an older device's copy loses nothing", () => {
  const a = model({ bills: [bill("bil-1", { m: 10, note: "a" }), bill("bil-2", { m: 10 })], bpays: [bpay("bpy-1", "bil-1", 100)] });
  const b = model({ bills: [bill("bil-1", { m: 11, note: "b" }), { id: "bil-2", m: 10, del: 1 }], bpays: [bpay("bpy-2", "bil-1", 200)] });
  const m = C.mergeInvoices(a, b);
  assert.equal(m.bills[0].note, "b");
  assert.equal(m.bills[1].del, 1);
  assert.equal(m.bpays.length, 2);
  assert.equal(json(C.mergeInvoices(b, a)), json(m), "symmetric");
  // an older device (no bills in its copy) merged in keeps everything
  const old = { ver: 1, prof: a.prof, series: [], clients: [], docs: [], pays: [], tpls: [] };
  assert.equal(json(C.mergeInvoices(m, old)), json(m));
  // a backup carries them
  assert.equal(json(C.fromBackup(C.toBackup(m))), json(m));
});

test("sync: bills and their payments from two devices both survive", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A");
  const B = await createDevice(db, "B");
  const reg = (dev) => dev.sync.registerSlice("invoices",
    () => C.normalize(readKey(dev, C.STORAGE_KEY)),
    (data) => writeKey(dev, C.STORAGE_KEY, C.mergeInvoices(readKey(dev, C.STORAGE_KEY), data)),
    C.STORAGE_KEY, C.mergeInvoices);
  reg(A); reg(B);
  writeKey(A, C.STORAGE_KEY, model({ bills: [bill("bil-1")] }));
  A.sync.markDirty();
  await A.sync.push();
  await B.sync.pull();
  const edit = (dev, fn) => {
    const cur = readKey(dev, C.STORAGE_KEY);
    fn(cur);
    writeKey(dev, C.STORAGE_KEY, C.normalize(cur));
    dev.sync.markDirty();
  };
  edit(A, (d) => { d.bpays = (d.bpays || []).concat([bpay("bpy-a", "bil-1", 2000)]); });
  edit(B, (d) => { d.bpays = (d.bpays || []).concat([bpay("bpy-b", "bil-1", 3000)]); d.bills.push(bill("bil-2", { m: 30 })); });
  await A.sync.push();
  await B.sync.push();
  await A.sync.pull();
  await B.sync.pull();
  const a = readKey(A, C.STORAGE_KEY), b = readKey(B, C.STORAGE_KEY);
  assert.equal(json(C.normalize(a)), json(C.normalize(b)));
  assert.equal(C.billPaid(a, "bil-1"), 5000);
  assert.equal(a.bills.length, 2);
});

test("doc source (wave 7): kept when valid, found by bySrc, cancelled documents left out", () => {
  const doc = (id, extra) => Object.assign({ id, kind: "inv", st: "issued", ser: "ser-inv", seq: 1, num: "INV-1", date: "2026-10-01",
    cur: "EUR", c: { name: "Shop" }, lines: [{ d: "Book", q: 1, p: 1000, vat: 24 }], m: 1 }, extra || {});
  const d = model({ docs: [doc("doc-1", { src: "stock:cons-mv1" }), doc("doc-2", { src: "stock:cons-mv2", st: "void" }),
    doc("doc-3", { src: "bad src" }), doc("doc-4", { st: "draft", src: "stock:cons-mv4" })] });
  assert.equal(d.docs[0].src, "stock:cons-mv1");
  assert.equal("src" in d.docs[2], false);
  assert.deepEqual(C.bySrc(d, "stock:cons-mv1").map((x) => x.id), ["doc-1"]);
  assert.deepEqual(C.bySrc(d, "stock:cons-mv2"), []);
  assert.deepEqual(C.bySrc(d, "stock:cons-mv4").map((x) => x.id), ["doc-4"], "a draft counts: the invoice is on its way");
  assert.deepEqual(C.bySrc(d, ""), []);
});
