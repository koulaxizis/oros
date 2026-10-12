// Invoices: the shared core (invoices/core.js) — normalize, the sync
// merge (slice "invoices"), numbering and number clashes, totals with
// per-rate VAT, discounts and withholding, payments, credit notes and
// statuses, the CRM Lite lookup (BR-CRM-INV), the prefill (BR-INV-NEW),
// the dashboard, recurring templates, CSV, backup — plus a two-device
// round trip through the real sync engine (tests/harness.js).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../invoices/core.js");
const { FakeDropbox, createDevice, readKey, writeKey } = require("./harness");

const json = (x) => JSON.stringify(x);
function model(o) {
  return C.normalize(Object.assign({ ver: 1, clients: [], docs: [], pays: [] }, o || {}));
}
const line = (p, extra) => Object.assign({ code: "", d: "Work", q: 1, unit: "", p, disc: 0, vat: 24 }, extra || {});
function inv(id, extra) {
  return Object.assign({
    id, kind: "inv", st: "issued", ser: "ser-inv", seq: 1, num: "INV-2026-0001",
    date: "2026-10-01", due: "2026-10-31", cur: "EUR", cli: "", c: { name: "Acme" },
    lines: [line(10000)], gDisc: 0, wht: 0, m: 10
  }, extra || {});
}
const pay = (id, doc, amt, date, extra) => Object.assign({ id, doc, amt, date: date || "2026-10-05", how: "bank", note: "", m: 5 }, extra || {});

// ---------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------

test("normalize: bad rows dropped, sorted by id, text cleaned, profile defaults", () => {
  const d = C.normalize({
    clients: [{ id: "cli-b", name: "  Acme \n SA ", afm: "123", m: 1 }, { id: "cli-a", name: "", m: 1 }, { id: "BAD ID", name: "x", m: 1 }],
    docs: [
      inv("doc-z"),
      { id: "doc-a", kind: "nope", m: 1 },
      inv("doc-b", { st: "weird", num: "X-1", seq: 9 })          // unknown state → draft, no number
    ],
    pays: [pay("pay-1", "doc-z", 0), pay("pay-2", "doc-z", 500, "2026-13-01"), pay("pay-3", "doc-z", 500)]
  });
  assert.deepEqual(d.clients.map((c) => c.id), ["cli-b"]);
  assert.equal(d.clients[0].name, "Acme SA");
  assert.deepEqual(d.docs.map((x) => x.id), ["doc-b", "doc-z"]);
  assert.equal(d.docs[0].st, "draft");
  assert.equal(d.docs[0].num, "");
  assert.equal(d.docs[0].seq, 0);
  assert.deepEqual(d.pays.map((p) => p.id), ["pay-3"]);
  assert.equal(d.prof.cur, "EUR");
  assert.equal(d.prof.vat, 24);
  assert.equal(d.prof.days, 30);
  assert.deepEqual(d.series, []);                                   // defaults are implicit
  assert.equal(json(C.normalize(d)), json(d));                      // idempotent (R26)
});

test("normalize: a record (ext) is never a draft and keeps net + VAT; lines dropped", () => {
  const d = model({ docs: [{ id: "ext-1", kind: "ext", st: "draft", num: "Α-17", date: "2026-09-02",
    cur: "EUR", c: { name: "Beta" }, lines: [line(100)], xnet: 10000, xvat: 2400, mark: "400001234567890", m: 3 }] });
  const x = d.docs[0];
  assert.equal(x.st, "issued");
  assert.equal(x.num, "Α-17");
  assert.deepEqual(x.lines, []);
  assert.equal(C.totals(x).total, 12400);
  assert.equal(x.mark, "400001234567890");
});

test("normalize: unknown flat fields ride along; logo must be a png/jpeg data URL", () => {
  const d = model({ prof: { name: "Me", logo: "data:image/svg+xml;base64,PHN2Zz4=", m: 2, zfuture: "x" },
                    clients: [{ id: "cli-1", name: "A", m: 1, later: 5 }] });
  assert.equal(d.prof.logo, "");
  assert.equal(d.prof.zfuture, "x");
  assert.equal(d.clients[0].later, 5);
  const ok = model({ prof: { logo: "data:image/png;base64,iVBORw0KGgo=", m: 1 } });
  assert.equal(ok.prof.logo, "data:image/png;base64,iVBORw0KGgo=");
});

test("normalize: a file link must stay on the orOS disk", () => {
  const a = model({ docs: [inv("doc-1", { kind: "ext", file: "/internal/Invoices/a.pdf" })] });
  const b = model({ docs: [inv("doc-1", { kind: "ext", file: "https://evil.example/x.pdf" })] });
  const c = model({ docs: [inv("doc-1", { kind: "ext", file: "/internal/../x.pdf" })] });
  assert.equal(a.docs[0].file, "/internal/Invoices/a.pdf");
  assert.equal(b.docs[0].file, "");
  assert.equal(c.docs[0].file, "");
});

// ---------------------------------------------------------------
// Merge
// ---------------------------------------------------------------

test("merge: symmetric, newer m wins, tombstone wins ties, payments union", () => {
  const A = model({ docs: [inv("doc-1", { notes: "a", m: 20 })], pays: [pay("pay-a", "doc-1", 1000)],
                    prof: { name: "Old", m: 1 } });
  const B = model({ docs: [inv("doc-1", { notes: "b", m: 30 })], pays: [pay("pay-b", "doc-1", 2000)],
                    prof: { name: "New", m: 2 } });
  const ab = C.mergeInvoices(A, B), ba = C.mergeInvoices(B, A);
  assert.equal(json(ab), json(ba));
  assert.equal(ab.docs[0].notes, "b");
  assert.deepEqual(ab.pays.map((p) => p.id), ["pay-a", "pay-b"]);
  assert.equal(ab.prof.name, "New");
  const T = model({ pays: [{ id: "pay-a", m: 5, del: 1 }] });
  assert.equal(C.mergeInvoices(ab, T).pays.find((p) => p.id === "pay-a").del, 1);
  assert.equal(json(C.mergeInvoices(ab, ab)), json(ab));
});

// ---------------------------------------------------------------
// Series + numbering
// ---------------------------------------------------------------

test("series: defaults implicit, an edit overrides, a default cannot be deleted", () => {
  const d = model({ series: [{ id: "ser-inv", kind: "inv", prefix: "ΤΙΜ", year: 0, digits: 3, m: 4 },
                             { id: "ser-rcpt", m: 5, del: 1 },
                             { id: "ser-b", kind: "inv", prefix: "B", year: 1, digits: 4, m: 6 }] });
  const ids = C.seriesList(d).map((s) => s.id);
  assert.ok(ids.includes("ser-rcpt"));
  assert.ok(ids.includes("ser-b"));
  assert.equal(C.series(d, "ser-inv").prefix, "ΤΙΜ");
  assert.equal(C.fmtNum(C.series(d, "ser-inv"), 2026, 7), "ΤΙΜ-007");
  assert.equal(C.fmtNum(C.series(d, "ser-b"), 2026, 42), "B-2026-0042");
  assert.equal(C.fmtNum({ prefix: "", year: 1, digits: 2 }, 2026, 5), "2026-05");
  assert.deepEqual(C.seriesFor(d, "inv").map((s) => s.id), ["ser-b", "ser-inv"]);
});

test("numbering: max + 1 per series and year; drafts and other series ignored; new year restarts", () => {
  const d = model({ docs: [
    inv("doc-1", { seq: 1 }), inv("doc-2", { seq: 7, num: "INV-2026-0007" }),
    inv("doc-3", { st: "draft", seq: 0 }),
    inv("doc-4", { ser: "ser-rcpt", kind: "rcpt", seq: 30 }),
    inv("doc-5", { seq: 99, date: "2025-12-31" }),
    inv("doc-6", { seq: 8, st: "void" })                        // a cancelled number stays used
  ] });
  assert.equal(C.nextSeq(d, "ser-inv", "2026-11-01"), 9);
  assert.equal(C.nextSeq(d, "ser-inv", "2027-01-02"), 1);
  assert.equal(C.nextSeq(d, "ser-rcpt", "2026-11-01"), 31);
  assert.equal(C.nextSeq(d, "ser-pro", "2026-11-01"), 1);
});

test("clashes: same number from two offline devices is found; the earlier issue keeps it", () => {
  const A = model({ docs: [inv("doc-a", { seq: 42, m: 100 })] });
  const B = model({ docs: [inv("doc-b", { seq: 42, m: 90 })] });
  const d = C.mergeInvoices(A, B);
  const cl = C.clashes(d);
  assert.equal(cl.length, 1);
  assert.deepEqual(cl[0].map((x) => x.id), ["doc-a", "doc-b"]);
  assert.equal(C.clashKeeper(cl[0]).id, "doc-b");
  assert.equal(C.clashes(model({ docs: [inv("doc-a", { seq: 42 }), inv("doc-b", { seq: 42, date: "2025-05-05" })] })).length, 0);
});

// ---------------------------------------------------------------
// Totals, payments, statuses
// ---------------------------------------------------------------

test("totals: line discount, global discount, VAT per rate, withholding", () => {
  const d = C.normDoc(inv("doc-1", {
    lines: [line(10000, { q: 2, disc: 10 }), line(5000, { vat: 13 }), line(333, { q: 3, vat: 24 })],
    gDisc: 5, wht: 20
  }));
  const t = C.totals(d);
  // lines: 18000 @24, 5000 @13, 999 @24 → base 24% = 18999, 13% = 5000
  assert.equal(t.sub, 23999);
  assert.deepEqual(t.rates.map((r) => [r.rate, r.base, r.vat]), [[24, 18049, 4332], [13, 4750, 618]]);
  assert.equal(t.net, 22799);
  assert.equal(t.disc, 1200);
  assert.equal(t.vat, 4950);
  assert.equal(t.total, 27749);
  assert.equal(t.wht, 4560);
  assert.equal(t.pay, 23189);
});

test("status: unpaid, partial, overdue, paid; credit notes reduce the balance; void and drafts", () => {
  const d = model({
    docs: [inv("doc-1"), inv("doc-2", { seq: 2 }), inv("doc-3", { st: "draft", seq: 0 }), inv("doc-4", { st: "void", seq: 4 }),
           { id: "cn-1", kind: "cred", st: "issued", ser: "ser-cred", seq: 1, num: "CN-2026-0001", date: "2026-10-03",
             cur: "EUR", c: { name: "Acme" }, lines: [line(5000)], ref: "doc-2", m: 3 },
           inv("pro-1", { kind: "pro", ser: "ser-pro" })],
    pays: [pay("pay-1", "doc-1", 4000)]
  });
  const doc = (id) => d.docs.find((x) => x.id === id);
  assert.equal(C.status(d, doc("doc-1"), "2026-10-10"), "partial");
  assert.equal(C.status(d, doc("doc-1"), "2026-11-01"), "overdue");
  assert.equal(C.balance(d, doc("doc-1")), 12400 - 4000);
  assert.equal(C.balance(d, doc("doc-2")), 12400 - 6200);
  assert.equal(C.status(d, doc("doc-2"), "2026-10-10"), "unpaid");
  assert.equal(C.status(d, doc("doc-3")), "draft");
  assert.equal(C.status(d, doc("doc-4")), "void");
  assert.equal(C.status(d, doc("cn-1")), "credit");
  assert.equal(C.status(d, doc("pro-1")), "pro");
  assert.equal(C.balance(d, doc("pro-1")), 0);
  const paid = C.mergeInvoices(d, model({ pays: [pay("pay-2", "doc-1", 8400)] }));
  assert.equal(C.status(paid, paid.docs.find((x) => x.id === "doc-1"), "2026-12-01"), "paid");
  assert.equal(C.lateDays(doc("doc-1"), "2026-11-03"), 3);
});

test("dueList: owed documents due by a day, earliest first", () => {
  const d = model({ docs: [inv("doc-1", { due: "2026-10-20" }), inv("doc-2", { seq: 2, due: "2026-10-12" }),
                           inv("doc-3", { seq: 3, due: "2026-12-01" }), inv("doc-4", { seq: 4, due: "2026-10-01" })],
                    pays: [pay("pay-1", "doc-4", 12400)] });
  assert.deepEqual(C.dueList(d, "2026-10-31").map((x) => x.id), ["doc-2", "doc-1"]);
});

// ---------------------------------------------------------------
// CRM Lite (BR-CRM-INV) + prefill (BR-INV-NEW)
// ---------------------------------------------------------------

test("byCrm: documents of a CRM customer via the doc or its client, totals per currency", () => {
  const d = model({
    clients: [{ id: "cli-1", name: "Acme", crm: "crm_77", m: 1 }],
    docs: [inv("doc-1", { cli: "cli-1" }), inv("doc-2", { seq: 2, crm: "crm_77", cur: "USD" }),
           inv("doc-3", { seq: 3, st: "draft", cli: "cli-1" }), inv("doc-4", { seq: 4 })],
    pays: [pay("pay-1", "doc-1", 2400)]
  });
  const r = C.byCrm(d, "crm_77", "2026-11-15");
  assert.deepEqual(r.rows.map((x) => x.id).sort(), ["doc-1", "doc-2"]);
  assert.deepEqual(r.totals.EUR, { invoiced: 12400, paid: 2400, open: 10000, overdue: 10000 });
  assert.deepEqual(r.totals.USD, { invoiced: 12400, paid: 0, open: 12400, overdue: 12400 });
  assert.deepEqual(C.byCrm(d, "nobody").rows, []);
  assert.deepEqual(C.byCrm(d, "<script>").rows, []);
});

test("normPrefill: CRM client only, lines from a won deal, bad currency rejects, junk cleaned", () => {
  const a = C.normPrefill({ crm: "c1", name: "Acme\u0000 SA", afm: "123456789", doy: "Α' Αθηνών", country: "GR" });
  assert.equal(a.client.name, "Acme SA");
  assert.equal(a.crm, "c1");
  assert.deepEqual(a.items, []);
  const b = C.normPrefill({ name: "X", items: [{ d: "Deal", q: 1, p: 1500.5 }, { d: "", q: 1, p: 1 }, { d: "Neg", q: 0, p: 1 }] });
  assert.deepEqual(b.items, [{ d: "Deal", q: 1, p: 150050 }]);
  assert.equal(C.normPrefill({ name: "X", cur: "euro" }), null);
  assert.equal(C.normPrefill({}), null);
  assert.equal(C.normPrefill({ items: [{ d: "x", q: 1, p: 1 }], ref: { app: "quote", id: "q1" } }).ref.app, "quote");
});

test("matchClient: crm id, then ΑΦΜ, then name ignoring case and accents", () => {
  const d = model({ clients: [{ id: "cli-1", name: "Ελαιώνας ΑΕ", afm: "099 999 999", m: 1 },
                              { id: "cli-2", name: "Other", crm: "k9", m: 1 }] });
  assert.equal(C.matchClient(d, { crm: "k9", name: "zzz" }).id, "cli-2");
  assert.equal(C.matchClient(d, { afm: "099999999" }).id, "cli-1");
  assert.equal(C.matchClient(d, { name: "ελαιωνας αε" }).id, "cli-1");
  assert.equal(C.matchClient(d, { name: "none" }), null);
});

// ---------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------

test("dashboard: invoiced, collected, outstanding, months, top clients, VAT per rate", () => {
  const d = model({
    clients: [{ id: "cli-1", name: "Acme", m: 1 }],
    docs: [inv("doc-1", { cli: "cli-1" }), inv("doc-2", { seq: 2, date: "2026-11-02", due: "2026-11-30", c: { name: "Beta" } }),
           { id: "cn-1", kind: "cred", st: "issued", ser: "ser-cred", seq: 1, num: "CN-1", date: "2026-11-05",
             cur: "EUR", cli: "cli-1", c: { name: "Acme" }, lines: [line(1000)], ref: "doc-1", m: 3 },
           inv("pro-1", { kind: "pro", ser: "ser-pro", date: "2026-10-02" }),
           inv("doc-9", { seq: 9, cur: "USD" }),
           { id: "ext-1", kind: "ext", st: "issued", num: "Α-1", date: "2026-10-09", cur: "EUR", c: { name: "Gamma" },
             xnet: 1000, xvat: 130, m: 2 }],
    pays: [pay("pay-1", "doc-1", 5000, "2026-10-20"), pay("pay-2", "doc-2", 1000, "2026-11-10")]
  });
  const s = C.dashboard(d, "2026-10-01", "2026-11-30", "EUR", "2026-11-15");
  assert.equal(s.invoiced, 12400 + 12400 - 1240 + 1130);
  assert.equal(s.collected, 6000);
  assert.equal(s.count, 3);
  assert.equal(s.outstanding, (12400 - 5000 - 1240) + (12400 - 1000) + 1130);
  assert.equal(s.overdue, 12400 - 5000 - 1240);
  assert.deepEqual(s.months.map((m) => [m.ym, m.inv, m.col]), [["2026-10", 13530, 5000], ["2026-11", 11160, 1000]]);
  assert.equal(s.top[0].name, "Beta");
  assert.equal(s.top[1].name, "Acme");
  assert.equal(s.top[1].amt, 12400 - 1240);
  assert.deepEqual(s.rates.map((r) => [r.rate, r.base, r.vat]), [[24, 19000, 4560], [null, 1000, 130]]);
  assert.deepEqual(C.currencies(d), ["EUR", "USD"]);
});

// ---------------------------------------------------------------
// Recurring templates
// ---------------------------------------------------------------

test("recurring: drafts owed up to today, same ids on two devices, month-end clamp", () => {
  const d = model({ tpls: [{ id: "tpl-1", name: "Hosting", kind: "inv", cur: "EUR", lines: [line(2000)],
                             rep: "m", next: "2026-08-31", dom: 31, m: 1 }] });
  const due = C.recurringDue(d, "2026-10-12");
  assert.deepEqual(due.map((x) => x.date), ["2026-08-31", "2026-09-30"]);
  assert.equal(due[0].id, C.recurringDue(model(d), "2026-10-12")[0].id);
  assert.ok(C.ID_RE.test(due[0].id));
  assert.equal(C.nextRun(d.tpls[0], "2026-10-12"), "2026-10-31");
  const draft = C.draftFrom(d, d.tpls[0], "2026-09-30", due[1].id, 7);
  assert.equal(draft.st, "draft");
  assert.equal(draft.due, "2026-10-30");
  assert.equal(C.totals(draft).total, 2480);
  const q = model({ tpls: [{ id: "tpl-2", name: "Q", kind: "inv", rep: "q", next: "2026-01-15", dom: 15, m: 1 }] });
  assert.deepEqual(C.recurringDue(q, "2026-10-12").map((x) => x.date), ["2026-01-15", "2026-04-15", "2026-07-15"]);
});

// ---------------------------------------------------------------
// Parsing, CSV, backup
// ---------------------------------------------------------------

test("parseMoney / parseNum / formatting", () => {
  assert.equal(C.parseMoney("1.250,50"), 125050);
  assert.equal(C.parseMoney("1,250.50"), 125050);
  assert.equal(C.parseMoney("-12,5"), -1250);
  assert.ok(isNaN(C.parseMoney("abc")));
  assert.equal(C.parseNum("1,5"), 1.5);
  assert.ok(isNaN(C.parseNum("1.000,5")));
  assert.equal(C.moneyInput(125050, "el"), "1250,50");
  assert.equal(C.fmtDay("2026-10-02"), "02/10/2026");
});

test("CSV: formula cells escaped, credit notes negative, BOM + semicolons", () => {
  const d = model({ docs: [inv("doc-1", { c: { name: "=HYPERLINK(1)" } }),
    { id: "cn-1", kind: "cred", st: "issued", ser: "ser-cred", seq: 1, num: "CN-1", date: "2026-10-03",
      cur: "EUR", c: { name: "B" }, lines: [line(1000)], m: 3 }] });
  const csv = C.docsCsv(d, "2026-01-01", "2026-12-31", ["no"], (k) => k, (s) => s, "el", "2026-10-10");
  assert.ok(csv.startsWith("\ufeffno\r\n"));
  assert.ok(csv.includes("'=HYPERLINK(1)"));
  assert.ok(csv.includes("-12,40"));
});

test("backup: round trip merges, tombstones kept, foreign files refused", () => {
  const d = model({ docs: [inv("doc-1")], pays: [{ id: "pay-x", m: 9, del: 1 }] });
  const back = C.fromBackup(C.toBackup(d));
  assert.equal(json(back), json(d));
  assert.equal(C.fromBackup('{"app":"timesheet","data":{}}'), null);
  assert.equal(C.fromBackup("nope"), null);
});

// ---------------------------------------------------------------
// Two devices through the real sync engine
// ---------------------------------------------------------------

test("sync: payments from two devices both survive; same-number issue shows as a clash", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A");
  const B = await createDevice(db, "B");
  const reg = (dev) => dev.sync.registerSlice("invoices",
    () => C.normalize(readKey(dev, C.STORAGE_KEY)),
    (data) => writeKey(dev, C.STORAGE_KEY, C.mergeInvoices(readKey(dev, C.STORAGE_KEY), data)),
    C.STORAGE_KEY, C.mergeInvoices);
  reg(A); reg(B);

  writeKey(A, C.STORAGE_KEY, model({ docs: [inv("doc-1")] }));
  A.sync.markDirty();
  await A.sync.push();
  await B.sync.pull();

  const edit = (dev, fn) => {
    const cur = readKey(dev, C.STORAGE_KEY);
    fn(cur);
    writeKey(dev, C.STORAGE_KEY, C.normalize(cur));
    dev.sync.markDirty();
  };
  edit(A, (d) => { d.pays.push(pay("pay-a", "doc-1", 2000)); d.docs.push(inv("doc-a", { seq: 2, m: 50 })); });
  edit(B, (d) => { d.pays.push(pay("pay-b", "doc-1", 3000)); d.docs.push(inv("doc-b", { seq: 2, m: 60 })); });
  await A.sync.push();
  await B.sync.push();
  await A.sync.pull();
  await B.sync.pull();

  const a = readKey(A, C.STORAGE_KEY), b = readKey(B, C.STORAGE_KEY);
  assert.equal(json(C.normalize(a)), json(C.normalize(b)));
  assert.equal(C.paidOf(a, "doc-1"), 5000);
  assert.equal(C.clashes(a).length, 1);
  assert.equal(C.clashKeeper(C.clashes(a)[0]).id, "doc-a");
});

test("search provider: documents and clients, drafts unnumbered, tombstones skipped, read-only", () => {
  const S = require("../search.js");
  const P = require("../invoices/search.js");
  const fs = require("fs");
  const data = {
    ver: 1,
    clients: [{ id: "cli-1", name: "Acme ΑΕ", afm: "123456789", job: "Software", m: 5 },
              { id: "cli-2", m: 9, del: 1 }],
    docs: [
      { id: "doc-1", kind: "inv", st: "issued", num: "INV-2026-0007", cli: "cli-1", c: { name: "Acme ΑΕ", afm: "123456789" },
        date: "2026-03-14", lines: [{ code: "WEB", d: "Website redesign" }], m: 10 },
      { id: "doc-2", kind: "pro", st: "draft", num: "", cli: "cli-1", c: { name: "Acme ΑΕ" }, date: "", lines: [], m: 20 },
      { id: "doc-3", kind: "ext", st: "issued", num: "A-12", c: { name: "Beta" }, mark: "400001", date: "2026-02-01", m: 30 },
      { id: "doc-4", m: 40, del: 1 }
    ]
  };
  const m = new Map([[P.keys[0], JSON.stringify(data)]]);
  const ctx = (lang) => ({ q: "acme", words: S.parseQuery("acme"), fold: S.fold, lang, limit: 50,
    readJSON: S.makeReader({ getItem: (k) => (m.has(k) ? m.get(k) : null) }) });
  const hits = Object.fromEntries(P.search(ctx("en")).map((h) => [h.id, h]));
  assert.deepEqual(Object.keys(hits).sort(), ["c:cli-1", "d:doc-1", "d:doc-2", "d:doc-3"]);
  assert.equal(hits["d:doc-1"].title, "Invoice INV-2026-0007 · Acme ΑΕ");
  assert.ok(hits["d:doc-1"].text.includes("WEB Website redesign"));
  assert.deepEqual(hits["d:doc-1"].target, { invoice: "doc-1" });
  assert.equal(hits["d:doc-1"].when, new Date(2026, 2, 14, 12).getTime());
  assert.equal(hits["d:doc-2"].title, "Proforma (draft) · Acme ΑΕ");
  assert.equal(hits["d:doc-2"].when, 20);
  assert.ok(hits["d:doc-3"].text.includes("ΜΑΡΚ 400001"));
  assert.deepEqual(hits["c:cli-1"].target, { client: { id: "cli-1" } });
  assert.equal(P.search(ctx("el")).find((h) => h.id === "d:doc-1").title, "Τιμολόγιο INV-2026-0007 · Acme ΑΕ");
  assert.deepEqual(P.search({ readJSON: () => null, lang: "en" }), []);
  assert.ok(!/setItem|removeItem|registerSlice|innerHTML/.test(fs.readFileSync(require.resolve("../invoices/search.js"), "utf8")));
});
