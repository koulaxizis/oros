// Timesheet T1 (BR-TS-INV, BR-TS-CRM): the invoice a report became
// marks its own entries and extra charges as invoiced, a cancelled
// invoice takes the marks off, a slower device never undoes a mark;
// time not invoiced yet per client; a client names its CRM customer.
// Run: node --test tests/
//
// Dates are LOCAL (new Date(y, m, d, h, min)), as in timesheet.test.js.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../timesheet/core.js");

const at = (d, h, m) => new Date(2026, 9, d, h, m || 0).getTime();   // October 2026
const NOW = at(31, 23);
const ent = (id, p, s, e, extra) => Object.assign({ id, p, desc: "", s, e, billed: 0, m: s }, extra || {});

function base(extra) {
  return C.normalize(Object.assign({
    ver: 1,
    clients: [{ id: "cccccc1", name: "Acme", rate: 5000, m: 1 }, { id: "cccccc2", name: "Beta", rate: 4000, m: 1 }],
    projects: [
      { id: "pppppp1", name: "Site", client: "cccccc1", m: 1 },
      { id: "pppppp2", name: "Logo", client: "cccccc2", m: 1 },
      { id: "pppppp3", name: "Own", client: "", bill: 0, m: 1 }
    ],
    entries: [
      ent("eeeeee1", "pppppp1", at(5, 9), at(5, 11)),
      ent("eeeeee2", "pppppp1", at(6, 9), at(6, 10)),
      ent("eeeeee3", "pppppp2", at(7, 9), at(7, 12)),
      ent("eeeeee4", "pppppp3", at(7, 13), at(7, 14))
    ],
    extras: [{ id: "xxxxxx1", d: "2026-10-06", p: "pppppp1", c: "", desc: "Fuel", amt: 1500, billed: 0, m: 1 }]
  }, extra || {}));
}
// look: docs = { batch: docId }, state = { docId: true | false | null }
function look(docs, state) {
  return { doc: (b) => docs[b] || "", gone: (id) => (id in state ? state[id] : null) };
}
const pendOf = (o) => C.normPend(o, NOW);

test("iv and crm are written only when set, so older data stays byte-identical", () => {
  const d = base();
  assert.ok(!("crm" in d.clients[0]));
  assert.ok(!("iv" in d.entries[0]) && !("iv" in d.extras[0]));
  const e = C.normEntry(Object.assign(ent("eeeeee9", "", at(1, 9), at(1, 10)), { billed: 1, iv: "inv-a1b2" }));
  assert.equal(e.iv, "inv-a1b2");
  assert.equal(C.normEntry(Object.assign(ent("eeeeee9", "", at(1, 9), at(1, 10)), { iv: "bad id!" })).iv, undefined);
  assert.equal(C.normClient({ id: "cccccc9", name: "X", crm: "cust_01", m: 1 }).crm, "cust_01");
  assert.equal(C.normExtra({ id: "xxxxxx9", d: "2026-10-01", amt: 100, billed: 1, iv: "doc1", m: 1 }).iv, "doc1");
  // an older version keeps the new fields as flat extras (forward compatibility)
  const round = C.normalize(JSON.parse(JSON.stringify(Object.assign(base(), {
    entries: [Object.assign(ent("eeeeee1", "pppppp1", at(5, 9), at(5, 11)), { billed: 1, iv: "doc1" })]
  }))));
  assert.equal(round.entries[0].iv, "doc1");
});

test("pending batches: only well-formed, at most 20, gone after 30 days", () => {
  const o = {};
  for (let i = 0; i < 25; i++) o["batch" + String(i).padStart(3, "0")] = { at: NOW - i * 1000, ids: ["eeeeee1"], ex: [] };
  o["BAD ID"] = { at: NOW, ids: ["eeeeee1"] };
  o.oldbatch1 = { at: NOW - 31 * C.DAY, ids: ["eeeeee1"] };
  o.emptyb1 = { at: NOW, ids: [], ex: [] };
  o.junkbat1 = { at: NOW, ids: ["ok1234", 5, "NO!"] };
  const p = C.normPend(o, NOW);
  assert.equal(Object.keys(p).length, 20);
  assert.ok(!p.oldbatch1 && !p.emptyb1 && !p["BAD ID"]);
  assert.deepEqual(p.junkbat1.ids, ["ok1234"]);
  const q = C.pendAdd({}, "newbatch1", ["eeeeee1", "eeeeee2"], ["xxxxxx1"], NOW);
  assert.deepEqual(q.newbatch1, { at: NOW, ids: ["eeeeee1", "eeeeee2"], ex: ["xxxxxx1"] });
});

test("a saved invoice marks exactly its batch's entries and extra charges", () => {
  const d = base();
  const pend = pendOf({ batch0001: { at: NOW - 60000, ids: ["eeeeee1", "eeeeee2"], ex: ["xxxxxx1"] },
                        batch0002: { at: NOW - 60000, ids: ["eeeeee3"], ex: [] } });
  const r = C.invLink(d, pend, look({ batch0001: "docA" }, { docA: false }), NOW);
  assert.deepEqual(r.set, [{ id: "eeeeee1", iv: "docA" }, { id: "eeeeee2", iv: "docA" }, { id: "xxxxxx1", iv: "docA" }]);
  assert.deepEqual(r.done, ["batch0001"], "the batch without a document keeps waiting");
  assert.deepEqual(r.clear, []);
});

test("nothing is marked twice, and a running entry or one on another live invoice is left alone", () => {
  const d = base();
  d.entries[0].billed = 1; d.entries[0].iv = "docA";     // already marked
  d.entries[1].billed = 1; d.entries[1].iv = "docB";     // on another invoice that stands
  d.entries[2].e = 0;                                     // running
  const pend = pendOf({ batch0001: { at: NOW, ids: ["eeeeee1", "eeeeee2", "eeeeee3"], ex: [] } });
  const r = C.invLink(d, pend, look({ batch0001: "docA" }, { docA: false, docB: false }), NOW);
  assert.deepEqual(r.set, []);
  assert.deepEqual(r.done, ["batch0001"]);
  // the other invoice was cancelled: the entry moves to the new one
  const r2 = C.invLink(d, pend, look({ batch0001: "docA" }, { docA: false, docB: true }), NOW);
  assert.deepEqual(r2.set, [{ id: "eeeeee2", iv: "docA" }]);
  assert.deepEqual(r2.clear, []);
});

test("a cancelled document takes its marks off; one this device does not know is left alone", () => {
  const d = base();
  d.entries[0].billed = 1; d.entries[0].iv = "docA";
  d.entries[2].billed = 1; d.entries[2].iv = "docZ";
  d.extras[0].billed = 1; d.extras[0].iv = "docA";
  d.entries[1].billed = 1;                               // marked by hand: no iv, never touched
  const r = C.invLink(d, {}, look({}, { docA: true }), NOW);
  assert.deepEqual(r.clear, ["eeeeee1", "xxxxxx1"]);
  assert.deepEqual(r.set, []);
  // a batch whose document is already gone marks nothing and stays pending
  const r2 = C.invLink(base(), pendOf({ batch0001: { at: NOW, ids: ["eeeeee1"] } }), look({ batch0001: "docA" }, { docA: true }), NOW);
  assert.deepEqual(r2, { set: [], clear: [], done: [] });
});

test("unbilled: billable time and extra charges not invoiced yet, per client, the largest first", () => {
  const d = base();
  let u = C.unbilled(d, "2026-10-31", NOW);
  assert.deepEqual(u.map((r) => r.cid), ["cccccc1", "cccccc2"]);
  // Acme: 3 h at 50 + fuel 15 = 165,00; Beta: 3 h at 40 = 120,00; Own is not billable
  assert.equal(u[0].amount, 16500);
  assert.equal(u[0].ms, 3 * C.HOUR);
  assert.equal(u[0].since, "2026-10-05");
  assert.equal(u[0].n, 3);
  assert.equal(u[1].amount, 12000);
  d.entries[0].billed = 1; d.entries[1].billed = 1; d.extras[0].billed = 1;
  u = C.unbilled(d, "2026-10-31", NOW);
  assert.deepEqual(u.map((r) => r.cid), ["cccccc2"]);
});

test("the app wires the batch ref, the read-only cores and the CRM side honours a client's own link", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "timesheet", "timesheet.js"), "utf8");
  assert.match(src, /ref: \{ app: "timesheet", id: batch \}/);
  assert.match(src, /I\.bySrc\(inv, "timesheet:" \+ b\)/);
  assert.doesNotMatch(src, /localStorage\.setItem\(INV_KEY|localStorage\.setItem\(CRM_KEY/, "Timesheet never writes Invoices or CRM");
  assert.match(fs.readFileSync(path.join(__dirname, "..", "crm", "links.js"), "utf8"), /if \(x\.crm\) return;\s+\/\/ Timesheet links it itself/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "crm", "overview.js"), "utf8"), /c\.crm === x\.cust\.id/);
});
