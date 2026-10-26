// Partner card W4: contracts on a CRM record (crm/core.js 1.6). Normalize,
// the order and state on the card, the reminder day, and the sync merge
// (left out while empty, an older device's copy loses nothing, a
// contract follows its customer). Two devices through the real sync
// engine (tests/harness.js).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const C = require(path.join(__dirname, "..", "crm/core.js"));
const { FakeDropbox, createDevice, readKey, writeKey } = require("./harness");

const KEY = "oros-crm-data";
function cust(id, name, extra) { return Object.assign({ id: id, m: 10, name: name }, extra || {}); }
function ctr(id, extra) { return Object.assign({ id: id, m: 10, cust: "aaaaaa1", t: "Consignment" }, extra || {}); }
const json = (x) => JSON.stringify(x);

test("contracts: normalized, bad rows dropped, absent while empty", () => {
  const d = C.norm({ cust: [cust("aaaaaa1", "A")], ctr: [
    ctr("ctr0001", { from: "2026-01-01", to: "2026-12-31", rem: 14, val: 120000, note: "  signed\n copy ", file: "/internal/CRM/A/c.pdf", fup: "fup0001", x9: 1 }),
    ctr("ctr0002", { t: "  ", to: "2026-12-31" }),
    ctr("ctr0003", { cust: "aaaaaa9" }),
    ctr("ctr0004", { rem: 900, to: "31/12/2026", val: -5, file: "/internal/../etc", fup: "bad id" })
  ] });
  assert.deepEqual(d.ctr.map((c) => c.id), ["ctr0001", "ctr0004"]);
  const [a, b] = d.ctr;
  assert.equal(a.rem, 14);
  assert.equal(a.file, "/internal/CRM/A/c.pdf");
  assert.equal(a.fup, "fup0001");
  assert.equal("x9" in a, false);
  assert.deepEqual(b, { id: "ctr0004", m: 10, cust: "aaaaaa1", t: "Consignment", rem: 30 }, "bad fields leave, the reminder defaults to 30 days");
  assert.equal(json(C.norm(d)), json(d), "idempotent");
  assert.equal("ctr" in C.norm({ cust: [cust("aaaaaa1", "A")] }), false);
  assert.equal("ctr" in C.norm({ cust: [cust("aaaaaa1", "A")], ctr: [] }), false);
});

test("contracts: reminder day, state and order on the card", () => {
  const today = "2026-10-25";
  const d = C.norm({ cust: [cust("aaaaaa1", "A"), cust("aaaaaa2", "B")], ctr: [
    ctr("ctr0001", { t: "Old", to: "2026-03-01" }),
    ctr("ctr0002", { t: "Older", to: "2025-03-01" }),
    ctr("ctr0003", { t: "Open ended" }),
    ctr("ctr0004", { t: "Soon", to: "2026-11-10", rem: 30 }),
    ctr("ctr0005", { t: "Later", to: "2027-06-30", rem: 30 }),
    ctr("ctr0006", { t: "Not mine", cust: "aaaaaa2", to: "2026-11-01" })
  ] });
  assert.equal(C.ctrRemindDay(C.byId(d.ctr, "ctr0004")), "2026-10-11");
  assert.equal(C.ctrRemindDay(C.byId(d.ctr, "ctr0003")), "");
  assert.deepEqual(C.contractsOf(d, "aaaaaa1", today).map((c) => c.t), ["Soon", "Later", "Open ended", "Old", "Older"]);
  assert.deepEqual(C.contractsOf(d, "aaaaaa1", today).map((c) => C.ctrState(c, today)), ["soon", "on", "on", "ended", "ended"]);
  assert.equal(C.ctrState(ctr("x", { to: today, rem: 0 }), today), "soon", "the last day still counts");
});

test("contracts merge: newer wins, tombstones win, an older device's copy loses nothing, a removed customer takes them", () => {
  const a = { cust: [cust("aaaaaa1", "A")], ctr: [ctr("ctr0001", { m: 10, note: "a" }), ctr("ctr0002", { m: 10 })] };
  const b = { cust: [cust("aaaaaa1", "A")], ctr: [ctr("ctr0001", { m: 11, note: "b" })], tombs: { ctr0002: 12 } };
  const m = C.merge(a, b);
  assert.equal(json(C.merge(b, a)), json(m), "symmetric");
  assert.deepEqual(m.ctr.map((c) => [c.id, c.note]), [["ctr0001", "b"]]);
  // a 1.5 device (no ctr) that renamed the customer keeps the contracts
  const old = { cust: [cust("aaaaaa1", "A, renamed", { m: 30 })] };
  const mo = C.merge(m, old);
  assert.equal(mo.cust[0].name, "A, renamed");
  assert.equal(mo.ctr.length, 1);
  // the customer deleted: its contracts go with it
  const gone = C.merge(m, { cust: [], tombs: { aaaaaa1: 40 } });
  assert.equal("ctr" in gone, false);
  // a backup carries them
  assert.equal(json(C.restore(C.norm({}), C.backup(m))), json(C.norm(m)));
});

test("sync: contracts and their reminders from two devices both survive", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A");
  const B = await createDevice(db, "B");
  const reg = (dev) => dev.sync.registerSlice("crm",
    () => C.norm(readKey(dev, KEY)),
    (data) => writeKey(dev, KEY, C.merge(readKey(dev, KEY), data)),
    KEY, C.merge);
  reg(A); reg(B);
  writeKey(A, KEY, C.norm({ cust: [cust("aaaaaa1", "A")] }));
  A.sync.markDirty();
  await A.sync.push();
  await B.sync.pull();
  const edit = (dev, fn) => {
    const cur = C.norm(readKey(dev, KEY));
    fn(cur);
    writeKey(dev, KEY, C.norm(cur));
    dev.sync.markDirty();
  };
  edit(A, (d) => {
    d.ctr = [ctr("ctr000a", { m: 50, to: "2027-01-31", fup: "fup000a" })];
    d.fups.push({ id: "fup000a", m: 50, cust: "aaaaaa1", d: "2027-01-01", text: "Contract ends: Consignment" });
  });
  edit(B, (d) => { d.ctr = [ctr("ctr000b", { m: 60, t: "Rights" })]; });
  await A.sync.push();
  await B.sync.push();
  await A.sync.pull();
  await B.sync.pull();
  const a = C.norm(readKey(A, KEY)), b = C.norm(readKey(B, KEY));
  assert.equal(json(a), json(b));
  assert.deepEqual(a.ctr.map((c) => c.id), ["ctr000a", "ctr000b"]);
  assert.equal(a.fups[0].id, "fup000a");
});
