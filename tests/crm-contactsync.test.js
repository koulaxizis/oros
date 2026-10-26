// CRM ↔ Contacts two-way sync of linked records (CT-CRM):
// crm/contactsync.js + the cs rows of crm/core.js 1.8.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "crm/core.js"));
const MG = require(path.join(__dirname, "..", "contacts/merge.js"));
const S = require(path.join(__dirname, "..", "crm/contactsync.js"));

const T0 = 1000000;

// A stored contact as Contacts keeps it (every field stamped at `at`).
function contact(id, f, at) {
  const c = Object.assign({ id: id, given: "", middle: "", family: "", nickname: "", org: "", jobTitle: "",
    phones: [], emails: [], addresses: [], websites: [], im: [], events: [], relations: [], labelIds: [],
    starred: false, note: "", avatar: null, mtime: at || T0 }, f || {});
  return MG.restamp(null, c, c.mtime);
}
// Contacts' own edit: change fields, restamp at `at`.
function editContact(ctd, id, f, at) {
  const d = JSON.parse(JSON.stringify(ctd));
  const i = d.contacts.findIndex((c) => c.id === id);
  const prev = JSON.parse(JSON.stringify(d.contacts[i]));
  Object.assign(d.contacts[i], f);
  MG.restamp(prev, d.contacts[i], at);
  return d;
}
function cust(id, name, extra) { return Object.assign({ id: id, m: T0, name: name, kind: "person" }, extra || {}); }
function crm(custs, extra) { return C.norm(Object.assign({ cust: custs }, extra || {})); }
// CRM's own edit through the app's write path (crm.js commit)
function editCust(data, id, f, at) {
  const next = JSON.parse(JSON.stringify(data));
  const c = next.cust.find((x) => x.id === id);
  Object.keys(f).forEach((k) => { if (f[k] === "") delete c[k]; else c[k] = f[k]; });
  c.m = at;
  return S.stampEdits(C, data, C.norm(next));
}
function pass(d, ctd, now) {
  const r = S.run(C, MG, d, ctd, now);
  return { crm: r.crm || d, ct: r.contacts || ctd, r: r };
}
function custOf(d, id) { return d.cust.find((c) => c.id === id); }
function ctOf(ctd, id) { return ctd.contacts.find((c) => c.id === id); }

const LINK = { people: [{ c: "ct-ann", n: "Ann Lee" }] };

test("field map: the contact's side in CRM's form", () => {
  const ct = contact("x", { given: "Ann", middle: "Marie", family: "Lee", jobTitle: "Editor",
    phones: [{ v: "+30 210 1", type: "work" }, { v: "699", type: "mobile" }], emails: [{ v: "a@b.gr", type: "work" }],
    websites: [{ v: "ann.gr", type: "home" }],
    addresses: [{ street: "Main 1", city: "Athens", zip: "10558", region: "Attica", country: "Greece", type: "work" }] });
  assert.deepEqual(S.contactVals(C, ct), { name: "Ann Marie Lee", phone: "+30 210 1", email: "a@b.gr", web: "ann.gr",
    job: "Editor", addr: "Main 1, 10558 Athens, Attica", country: "Greece" });
});

test("existing link: blanks are filled both ways, differences wait for the user", () => {
  const ctd = { contacts: [contact("ct-ann", { given: "Ann", family: "Lee", phones: [{ v: "111", type: "mobile" }], emails: [] })] };
  const d = crm([cust("aaaaaa1", "Ann Lee", Object.assign({ phone: "222", email: "ann@x.gr" }, LINK))]);
  const p = pass(d, ctd, T0 + 5000);
  const c = custOf(p.crm, "aaaaaa1"), ct = ctOf(p.ct, "ct-ann");
  assert.equal(c.phone, "222", "a CRM value that differs is not replaced");
  assert.equal(ct.phones[0].v, "111", "a contact value that differs is not replaced");
  assert.equal(ct.emails[0].v, "ann@x.gr", "an empty contact field is filled");
  assert.deepEqual(p.crm.cs[0].f.phone, ["222", -1]);
  assert.deepEqual(S.diffs(C, MG, p.crm, p.ct, "aaaaaa1"), [{ k: "phone", crm: "222", ct: "111" }]);
  // a second pass (and a third) changes nothing: no loop, no upload
  const q = pass(p.crm, p.ct, T0 + 6000);
  assert.equal(q.r.crm, null);
  assert.equal(q.r.contacts, null);
  const z = pass(q.crm, q.ct, T0 + 7000);
  assert.equal(z.r.crm, null);
  assert.equal(z.r.contacts, null);
});

test("an empty CRM field is filled from the contact", () => {
  const ctd = { contacts: [contact("ct-ann", { given: "Ann", family: "Lee", jobTitle: "Editor", phones: [{ v: "111", type: "mobile" }] })] };
  const d = crm([cust("aaaaaa1", "Ann Lee", LINK)]);
  const p = pass(d, ctd, T0 + 5000);
  assert.equal(custOf(p.crm, "aaaaaa1").phone, "111");
  assert.equal(custOf(p.crm, "aaaaaa1").job, "Editor");
  assert.ok(custOf(p.crm, "aaaaaa1").m > T0);
  assert.equal(pass(p.crm, p.ct, T0 + 6000).r.crm, null);
});

test("a contact changed after the pair started wins, even over a waiting difference", () => {
  const ctd = { contacts: [contact("ct-ann", { given: "Ann", family: "Lee", phones: [{ v: "111", type: "mobile" }] })] };
  const d = crm([cust("aaaaaa1", "Ann Lee", Object.assign({ phone: "222" }, LINK))]);
  const p = pass(d, ctd, T0 + 5000);
  const ct2 = editContact(p.ct, "ct-ann", { phones: [{ v: "333", type: "mobile" }], family: "Lee-Smith" }, T0 + 9000);
  const q = pass(p.crm, ct2, T0 + 10000);
  assert.equal(custOf(q.crm, "aaaaaa1").phone, "333");
  assert.equal(custOf(q.crm, "aaaaaa1").name, "Ann Lee-Smith");
  assert.equal(q.r.contacts, null, "Contacts is not written back");
  assert.deepEqual(S.diffs(C, MG, q.crm, q.ct, "aaaaaa1"), []);
  assert.equal(pass(q.crm, q.ct, T0 + 11000).r.crm, null);
});

test("a CRM edit reaches the contact, and only the mapped fields", () => {
  const ctd = { contacts: [contact("ct-ann", { given: "Ann", middle: "M", family: "Lee", note: "keep me",
    phones: [{ v: "111", type: "work" }, { v: "999", type: "home" }],
    addresses: [{ street: "Main 1", city: "Athens", zip: "10558", region: "", country: "Greece", type: "home" }] })] };
  let d = crm([cust("aaaaaa1", "Ann M Lee", Object.assign({ phone: "111", addr: "Main 1, 10558 Athens", country: "Greece", afm: "123" }, LINK))]);
  let p = pass(d, ctd, T0 + 5000);
  assert.deepEqual(S.diffs(C, MG, p.crm, p.ct, "aaaaaa1"), []);
  d = editCust(p.crm, "aaaaaa1", { name: "Anna M Lee", phone: "222", addr: "Side 5, 10558 Athens", note: "crm only" }, T0 + 20000);
  p = pass(d, p.ct, T0 + 21000);
  const ct = ctOf(p.ct, "ct-ann");
  assert.equal(ct.given, "Anna");
  assert.equal(ct.middle, "M");
  assert.equal(ct.family, "Lee");
  assert.deepEqual(ct.phones, [{ v: "222", type: "work" }, { v: "999", type: "home" }]);
  assert.deepEqual(ct.addresses[0], { street: "Side 5", city: "Athens", zip: "10558", region: "", country: "Greece", type: "home" });
  assert.equal(ct.note, "keep me");
  assert.ok(ct.fm.phones > T0 + 5000, "the change is stamped by Contacts' own rule");
  assert.equal(ct.fm.note, T0, "an unmapped field keeps its stamp");
  const q = pass(p.crm, p.ct, T0 + 22000);
  assert.equal(q.r.crm, null);
  assert.equal(q.r.contacts, null);
});

test("both changed: the newer change wins per field", () => {
  const ctd = { contacts: [contact("ct-ann", { given: "Ann", family: "Lee", phones: [{ v: "111", type: "mobile" }], emails: [{ v: "a@x.gr", type: "home" }] })] };
  let d = crm([cust("aaaaaa1", "Ann Lee", Object.assign({ phone: "111", email: "a@x.gr" }, LINK))]);
  let p = pass(d, ctd, T0 + 5000);
  d = editCust(p.crm, "aaaaaa1", { phone: "222", email: "crm@x.gr" }, T0 + 30000);   // CRM at 30
  const ct2 = editContact(p.ct, "ct-ann", { emails: [{ v: "ct@x.gr", type: "home" }] }, T0 + 40000);   // Contacts at 40
  p = pass(d, ct2, T0 + 50000);
  assert.equal(custOf(p.crm, "aaaaaa1").phone, "222");
  assert.equal(custOf(p.crm, "aaaaaa1").email, "ct@x.gr");
  assert.equal(ctOf(p.ct, "ct-ann").phones[0].v, "222");
  assert.equal(ctOf(p.ct, "ct-ann").emails[0].v, "ct@x.gr");
});

test("a whole-record CRM merge that loses a synced value gets it back (no data loss)", () => {
  const ctd = { contacts: [contact("ct-ann", { given: "Ann", family: "Lee", phones: [{ v: "111", type: "mobile" }] })] };
  const base = pass(crm([cust("aaaaaa1", "Ann Lee", Object.assign({ phone: "111" }, LINK))]), ctd, T0 + 5000);
  // device A: the contact's phone changes, A's pass writes CRM
  const ctA = editContact(base.ct, "ct-ann", { phones: [{ v: "333", type: "mobile" }] }, T0 + 10000);
  const a = pass(base.crm, ctA, T0 + 10500);
  // device B, offline: a note on the same customer, later than A's pass
  const b = editCust(base.crm, "aaaaaa1", { note: "from B" }, T0 + 20000);
  const merged = C.merge(a.crm, b);
  assert.equal(custOf(merged, "aaaaaa1").phone, "111", "B's whole record won the merge");
  const p = pass(merged, ctA, T0 + 30000);
  assert.equal(custOf(p.crm, "aaaaaa1").phone, "333", "the phone comes back from the cs row");
  assert.equal(custOf(p.crm, "aaaaaa1").note, "from B", "and B's note stays");
  assert.equal(p.r.contacts, null, "the contact is not reverted");
});

test("cs rows merge field by field, symmetric and idempotent", () => {
  const a = crm([cust("aaaaaa1", "A")], { cs: [{ id: "aaaaaa1", m: 50, c: "ct", t: 10, f: { phone: ["1", 40], email: ["e", 5] } }] });
  const b = crm([cust("aaaaaa1", "A")], { cs: [{ id: "aaaaaa1", m: 60, c: "ct", t: 20, f: { phone: ["2", 30], name: ["N", 7] } }] });
  const ab = C.merge(a, b), ba = C.merge(b, a);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba));
  assert.deepEqual(ab.cs[0], { id: "aaaaaa1", m: 60, c: "ct", t: 10, f: { name: ["N", 7], phone: ["1", 40], email: ["e", 5] } });
  assert.equal(JSON.stringify(C.merge(ab, ab)), JSON.stringify(ab));
  // another contact: the newer row whole
  const c2 = crm([cust("aaaaaa1", "A")], { cs: [{ id: "aaaaaa1", m: 70, c: "other", t: 65 }] });
  assert.deepEqual(C.merge(ab, c2).cs[0], { id: "aaaaaa1", m: 70, c: "other", t: 65 });
  // a 1.7 copy without cs keeps it through the union; data without links keeps its bytes
  assert.deepEqual(C.merge(ab, crm([cust("aaaaaa1", "A")])).cs, ab.cs);
  const plain = JSON.stringify(crm([cust("aaaaaa1", "A")]));
  assert.equal(plain.indexOf("\"cs\""), -1);
  // a deleted customer takes its row with it
  assert.equal(C.norm(Object.assign({}, ab, { cust: [], tombs: { aaaaaa1: 99 } })).cs, undefined);
});

test("keep(): the user settles a difference either way", () => {
  const ctd = { contacts: [contact("ct-ann", { given: "Ann", family: "Lee", phones: [{ v: "111", type: "mobile" }], emails: [{ v: "c@x.gr", type: "home" }] })] };
  const p = pass(crm([cust("aaaaaa1", "Ann Lee", Object.assign({ phone: "222", email: "r@x.gr" }, LINK))]), ctd, T0 + 5000);
  assert.equal(S.diffs(C, MG, p.crm, p.ct, "aaaaaa1").length, 2);
  // phone: keep the contact's
  let d = S.keep(C, MG, p.crm, p.ct, "aaaaaa1", "phone", "ct", T0 + 6000);
  assert.equal(custOf(d, "aaaaaa1").phone, "111");
  // email: keep CRM's → the next pass writes the contact
  d = S.keep(C, MG, d, p.ct, "aaaaaa1", "email", "crm", T0 + 7000);
  assert.equal(S.stampEdits(C, p.crm, JSON.parse(JSON.stringify(d))).cs[0].f.phone[0], "111", "the app's own stamping leaves a kept value alone");
  const q = pass(d, p.ct, T0 + 8000);
  assert.equal(ctOf(q.ct, "ct-ann").emails[0].v, "r@x.gr");
  assert.deepEqual(S.diffs(C, MG, q.crm, q.ct, "aaaaaa1"), []);
  const z = pass(q.crm, q.ct, T0 + 9000);
  assert.equal(z.r.crm, null);
  assert.equal(z.r.contacts, null);
});

test("emptying a field: the CRM clear removes the contact's first entry", () => {
  const ctd = { contacts: [contact("ct-ann", { given: "Ann", family: "Lee", websites: [{ v: "ann.gr", type: "home" }] })] };
  let p = pass(crm([cust("aaaaaa1", "Ann Lee", Object.assign({ web: "ann.gr" }, LINK))]), ctd, T0 + 5000);
  const d = editCust(p.crm, "aaaaaa1", { web: "" }, T0 + 20000);
  p = pass(d, p.ct, T0 + 21000);
  assert.deepEqual(ctOf(p.ct, "ct-ann").websites, []);
  assert.equal(pass(p.crm, p.ct, T0 + 22000).r.contacts, null);
});

test("a value the other side can't hold exactly is never written (no loop)", () => {
  const long = "A".repeat(70) + " Lee";        // a given name over Contacts' 60
  const ctd = { contacts: [contact("ct-ann", { given: "Ann", family: "Lee" })] };
  let p = pass(crm([cust("aaaaaa1", "Ann Lee", LINK)]), ctd, T0 + 5000);
  const d = editCust(p.crm, "aaaaaa1", { name: long }, T0 + 20000);
  p = pass(d, p.ct, T0 + 21000);
  assert.equal(ctOf(p.ct, "ct-ann").given, "Ann");
  assert.equal(custOf(p.crm, "aaaaaa1").name, long, "CRM keeps its name");
  assert.equal(p.r.contacts, null);
  assert.equal(pass(p.crm, p.ct, T0 + 22000).r.crm, null);
});

test("an empty contact name never empties the customer's name", () => {
  const ctd = { contacts: [contact("ct-ann", { given: "Ann", family: "Lee" })] };
  let p = pass(crm([cust("aaaaaa1", "Ann Lee", LINK)]), ctd, T0 + 5000);
  const ct2 = editContact(p.ct, "ct-ann", { given: "", family: "", nickname: "Annie" }, T0 + 9000);
  p = pass(p.crm, ct2, T0 + 10000);
  assert.equal(custOf(p.crm, "aaaaaa1").name, "Ann Lee");
  assert.equal(pass(p.crm, p.ct, T0 + 11000).r.crm, null);
});

test("only persons are paired; a company's contact follows a rename", () => {
  const ctd = { contacts: [contact("ct-bob", { given: "Bob", family: "Ray", org: "Acme", phones: [{ v: "555", type: "work" }] }),
                           contact("ct-eve", { given: "Eve", org: "Other Ltd" })] };
  let d = crm([cust("aaaaaa2", "Acme", { kind: "co", phone: "100", people: [{ c: "ct-bob", n: "Bob Ray" }, { c: "ct-eve", n: "Eve" }] })]);
  let p = pass(d, ctd, T0 + 5000);
  assert.equal(custOf(p.crm, "aaaaaa2").phone, "100", "a company's phone is its own");
  assert.equal(p.r.contacts, null);
  assert.deepEqual(p.crm.cs[0], { id: "aaaaaa2", m: T0 + 5000, n: "Acme" });
  d = editCust(p.crm, "aaaaaa2", { name: "Acme Books" }, T0 + 20000);
  p = pass(d, p.ct, T0 + 21000);
  assert.equal(ctOf(p.ct, "ct-bob").org, "Acme Books");
  assert.equal(ctOf(p.ct, "ct-eve").org, "Other Ltd", "a contact of another company is left alone");
  assert.deepEqual(p.crm.cs[0].o, ["Acme"]);
  const q = pass(p.crm, p.ct, T0 + 22000);
  assert.equal(q.r.crm, null);
  assert.equal(q.r.contacts, null);
});

test("a person linked to another contact starts a new pair", () => {
  const ctd = { contacts: [contact("ct-ann", { given: "Ann", family: "Lee", phones: [{ v: "111", type: "mobile" }] }),
                           contact("ct-amy", { given: "Amy", family: "Lee", phones: [{ v: "777", type: "mobile" }] })] };
  let p = pass(crm([cust("aaaaaa1", "Ann Lee", Object.assign({ phone: "111" }, LINK))]), ctd, T0 + 5000);
  const d = JSON.parse(JSON.stringify(p.crm));
  d.cust[0].people = [{ c: "ct-amy", n: "Amy Lee" }];
  d.cust[0].m = T0 + 6000;
  p = pass(C.norm(d), p.ct, T0 + 7000);
  assert.equal(p.crm.cs[0].c, "ct-amy");
  assert.equal(p.crm.cs[0].t, T0 + 7000);
  assert.deepEqual(S.diffs(C, MG, p.crm, p.ct, "aaaaaa1").map((x) => x.k).sort(), ["name", "phone"]);
  assert.equal(ctOf(p.ct, "ct-ann").phones[0].v, "111", "the earlier contact is not touched");
});

test("name split keeps the family and middle names it can", () => {
  const ct = { given: "Maria", middle: "", family: "van Dijk" };
  assert.deepEqual(S.splitName("Marie van Dijk", ct), { given: "Marie", middle: "", family: "van Dijk" });
  assert.deepEqual(S.splitName("Marie Smith", ct), { given: "Marie", middle: "", family: "Smith" });
  assert.deepEqual(S.splitName("Cher", ct), { given: "Cher", middle: "", family: "" });
  assert.deepEqual(S.splitName("Jo Ann Lee", { given: "Jo", middle: "Ann", family: "Lee" }), { given: "Jo", middle: "Ann", family: "Lee" });
});

test("no linked contact or no Contacts data: nothing is written", () => {
  const d = crm([cust("aaaaaa1", "Ann Lee", { phone: "1" }), cust("aaaaaa3", "Gone", { people: [{ c: "ct-gone", n: "Gone" }] })]);
  const r = S.run(C, MG, d, { contacts: [] }, T0);
  assert.equal(r.crm, null);
  assert.equal(r.contacts, null);
  assert.equal(S.run(C, MG, d, null, T0).crm, null);
});

test("an Assistant change to a synced customer reaches the contact (edits.js stamps it)", () => {
  const E = require(path.join(__dirname, "..", "assistant/edits.js"));
  const ctd = { contacts: [contact("ct-ann", { given: "Ann", family: "Lee", phones: [{ v: "111", type: "mobile" }] })] };
  const p = pass(crm([cust("aaaaaa1", "Ann Lee", Object.assign({ phone: "111" }, LINK))]), ctd, T0 + 5000);
  const ch = E.normArgs({ ref: "r1", action: "update", phone: "6970000000", old_phone: "111" });
  assert.equal(ch.ok, true, ch.err);
  const NOW = T0 + 40000;
  const pl = E.plan("crm", p.crm, { cust: "aaaaaa1" }, ch, NOW);
  assert.equal(pl.ok, true, pl.err);
  const a = E.apply("crm", p.crm, { cust: "aaaaaa1" }, ch, NOW, pl.before);
  assert.equal(a.ok, true, a.err);
  assert.deepEqual(a.data.cs[0].f.phone, ["6970000000", NOW]);
  const q = pass(a.data, p.ct, NOW + 1000);
  assert.equal(ctOf(q.ct, "ct-ann").phones[0].v, "6970000000");
  assert.equal(custOf(q.crm, "aaaaaa1").phone, "6970000000");
});
