// Newsletter W1 (2026-11): status-aware CSV import, consent note,
// the column mapping (tags from other columns) and the suppression
// list for people who left (newsletter/core.js).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../newsletter/core.js");

const NOW = Date.UTC(2026, 10, 3, 12);
function data(subs, supp) {
  return C.normalize({ ver: 1, chans: [], lists: [{ id: "list-1", m: 1, name: "L", chan: "", from: "a@b.gr", lang: "el", salt: "abcdefgh12" }],
    subs: subs || [], issues: [], supp: supp || [] });
}
function sub(email, extra) {
  return Object.assign({ id: C.subId("list-1", email), m: 5, list: "list-1", email, name: "", tags: [], src: "manual",
    basis: "consent", at: 10, conf: 10, off: 0 }, extra || {});
}
// The shape of a MailerLite subscriber export (one status per file)
const ML = "Subscriber,Name,Last name,Subscribed,Source,Groups,orders_count,total_spent,City,Empty\n" +
  "ann@x.gr,Ann,Lee,2024-03-02 10:11:12,Popup,Customers,2,31.50,Athens,\n" +
  "bob@x.gr,Bob,,2025-01-05,,Press,0,0.00,,\n" +
  "cy@x.gr,,,not a date,,Customers,,,,\n";

test("peopleFromRows: MailerLite columns, signup date, source, other columns", () => {
  const r = C.peopleFromRows(C.parseCsv(ML), NOW);
  assert.equal(r.people.length, 3);
  assert.equal(r.hasSt, false);
  const [ann, bob, cy] = r.people;
  assert.equal(ann.email, "ann@x.gr");
  assert.equal(ann.name, "Ann Lee");
  assert.equal(ann.at0, Date.UTC(2024, 2, 2, 10, 11, 12));
  assert.equal(ann.cn, "Popup");
  assert.equal(ann.tags.length, 1);
  assert.equal(ann.tags[0].toLowerCase(), "customers");
  assert.equal(bob.name, "Bob");
  assert.equal(bob.at0, Date.UTC(2025, 0, 5));
  assert.equal(cy.at0, 0);
  // orders_count, total_spent, City; the empty column is left out
  assert.deepEqual(r.cols.map((c) => c.name), ["orders_count", "total_spent", "City"]);
  assert.deepEqual(r.cols.map((c) => c.buy), [true, true, false]);
  assert.deepEqual(ann.x, ["2", "31.50", "Athens"]);
});

test("exportStatus and exportDate", () => {
  assert.equal(C.exportStatus("active"), "on");
  assert.equal(C.exportStatus("Unsubscribed"), "off");
  assert.equal(C.exportStatus("bounced"), "bounce");
  assert.equal(C.exportStatus("junk"), "spam");
  assert.equal(C.exportStatus("unconfirmed"), "pend");
  assert.equal(C.exportStatus("whatever"), "");
  assert.equal(C.exportDate("1999-01-01", NOW), 0);
  assert.equal(C.exportDate("2030-01-01", NOW), 0);
  assert.equal(C.exportDate("2026-02-30x", NOW) > 0, true);
  assert.equal(C.exportDate("2026-13-01", NOW), 0);
  assert.equal(C.exportDate("2026-11-03T08:00:00Z", NOW), Date.UTC(2026, 10, 3, 8));
});

test("applyColumnTags: one tag from several columns, 0 and empty are not set", () => {
  const r = C.peopleFromRows(C.parseCsv(ML), NOW);
  const out = C.applyColumnTags(r.people, ["customer", "customer", ""]);
  assert.ok(out[0].tags.includes("customer"));
  assert.ok(!out[1].tags.includes("customer"));
  assert.ok(!out[2].tags.includes("customer"));
  assert.equal(out[0].tags.filter((t) => t === "customer").length, 1);
  // the input is not changed
  assert.ok(!r.people[0].tags.includes("customer"));
  assert.equal(C.applyColumnTags(r.people, ["", "", ""]), r.people);
  assert.equal(C.colValue("0,00"), false);
  assert.equal(C.colValue("όχι"), false);
  assert.equal(C.colValue("yes"), true);
});

test("planImport: signup date and consent note are kept; the note survives normalize and merge", () => {
  const r = C.peopleFromRows(C.parseCsv(ML), NOW);
  const p = C.planImport(data(), "list-1", r.people, { now: NOW, basis: "consent", cn: "Imported from MailerLite, 2026-11-03" });
  assert.equal(p.add.length, 3);
  const ann = p.add.find((x) => x.email === "ann@x.gr");
  const cy = p.add.find((x) => x.email === "cy@x.gr");
  assert.equal(ann.at, Date.UTC(2024, 2, 2, 10, 11, 12));
  assert.equal(ann.conf, ann.at);
  assert.equal(C.status(ann), "on");
  assert.equal(ann.cn, "Popup");
  assert.equal(cy.at, NOW);
  assert.equal(cy.cn, "Imported from MailerLite, 2026-11-03");
  const d = data(p.add);
  assert.equal(d.subs.find((x) => x.email === "ann@x.gr").cn, "Popup");
  const merged = C.mergeNewsletter(d, data());
  assert.equal(merged.subs.find((x) => x.email === "ann@x.gr").cn, "Popup");
  assert.equal(C.personData(d, "ann@x.gr").subscriptions[0].consentNote, "Popup");
  // no note: the key is left out
  assert.equal("cn" in C.normSub(sub("z@x.gr")), false);
});

test("planImport: a file of unsubscribed people only fills the suppression list", () => {
  const d = data([sub("on@x.gr"), sub("gone@x.gr", { off: 20, offSt: "off" })], [C.suppHash("old@x.gr")]);
  const people = ["on@x.gr", "gone@x.gr", "old@x.gr", "new@x.gr", "new@x.gr"].map((email) => ({ email, name: "", tags: [], lang: "" }));
  const p = C.planImport(d, "list-1", people, { now: NOW, st: "off" });
  assert.equal(p.add.length, 0);
  assert.equal(p.leave.length, 1);
  assert.equal(p.leave[0].email, "on@x.gr");
  assert.equal(C.status(p.leave[0]), "off");
  assert.equal(p.left, 1);
  assert.equal(p.supp, 1);
  assert.equal(p.dup, 1);
  assert.deepEqual(p.suppAdd, [C.suppHash("new@x.gr")]);
  // after applying, a re-import of the same address as active adds nobody
  d.supp.push(...p.suppAdd);
  const again = C.planImport(d, "list-1", [{ email: "NEW@x.gr", name: "", tags: [], lang: "" }], { now: NOW + 1, basis: "consent" });
  assert.equal(again.add.length, 0);
  assert.equal(again.supp, 1);
  // bounced and junk keep their kind
  const b = C.planImport(data([sub("a@x.gr")]), "list-1", [{ email: "a@x.gr" }], { now: NOW, st: "bounce" });
  assert.equal(C.status(b.leave[0]), "bounce");
  const j = C.planImport(data([sub("a@x.gr")]), "list-1", [{ email: "a@x.gr" }], { now: NOW, st: "spam" });
  assert.equal(C.status(j.leave[0]), "spam");
});

test("planImport: a status column is read row by row only with rowSt", () => {
  const csv = "email,status\non@x.gr,active\noff@x.gr,unsubscribed\npend@x.gr,unconfirmed\nbad@x.gr,bounced\n";
  const r = C.peopleFromRows(C.parseCsv(csv), NOW);
  assert.equal(r.hasSt, true);
  const p = C.planImport(data(), "list-1", r.people, { now: NOW, basis: "consent", rowSt: true });
  assert.deepEqual(p.add.map((x) => [x.email, C.status(x), x.basis]), [["on@x.gr", "on", "consent"], ["pend@x.gr", "pend", "optin"]]);
  assert.equal(p.suppAdd.length, 2);
  // without rowSt (other importers that pass people with st) nothing changes
  const q = C.planImport(data(), "list-1", r.people, { now: NOW, basis: "consent" });
  assert.equal(q.add.length, 4);
  assert.equal(q.suppAdd.length, 0);
});
