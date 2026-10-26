// Assistant: new contacts and CRM customers, and a CRM customer linked
// to a contact (AS-ADD, assistant/create.js). Records are written in the
// apps' own shape and stamps, look-alikes start unticked, the apps' own
// normalizers keep every record, and Undo takes back only what the card
// made, while it still looks so.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const N = require("../assistant/create.js");
const CRM = require("../crm/core.js");
const A = require("../assistant/core.js");

const NOW = 1790000000000;

function contacts() {
  return {
    ver: 1,
    labels: [{ id: "lbl-work", name: "Εργασία", color: "#000", mtime: 0 }, { id: "l1", name: "Authors", color: "#111", mtime: 5 }],
    contacts: [{ id: "c1", given: "Μαρία", middle: "", family: "Παπαδοπούλου", nickname: "", org: "", jobTitle: "",
                 phones: [{ v: "+30 6912345678", type: "mobile" }], emails: [{ v: "maria@example.gr", type: "home" }],
                 addresses: [], websites: [], im: [], events: [], relations: [], labelIds: [], starred: false, note: "",
                 avatar: null, mtime: 100 }],
    deleted: []
  };
}
function crm() {
  const d = CRM.empty();
  d.cust.push({ id: "aaaaaa01", m: 50, name: "Εκδόσεις Άλφα", kind: "co", st: "active", email: "info@alfa.gr" });
  return CRM.norm(d);
}

test("create: arguments are checked, nothing guessed", () => {
  assert.equal(N.normItems({ app: "todo", items: [{ name: "x" }] }).ok, false);
  assert.equal(N.normItems({ app: "contacts", items: [] }).ok, false);
  assert.match(N.normItems({ app: "contacts", items: [{ phones: ["123"] }] }).err, /items\[0\].*name or an org/);
  assert.match(N.normItems({ app: "contacts", items: [{ name: "A B", emails: ["nope"] }] }).err, /not an e-mail/);
  assert.match(N.normItems({ app: "contacts", items: [{ name: "A", note: "x".repeat(501) }] }).err, /501 characters; Contacts keeps 500/);
  assert.match(N.normItems({ app: "contacts", items: [{ name: "A", emails: ["a@b.gr"] }, { name: "a", emails: ["A@b.gr"] }] }).err, /items\[0\] and items\[1\] are the same/);
  assert.match(N.normItems({ app: "crm", items: [{ name: "X", tax_id: "123456789" }] }).err, /check digit/);
  assert.equal(N.normItems({ app: "crm", items: [{ name: "X", tax_id: "EL094014201" }] }).ok, true);
  assert.match(N.normItems({ app: "crm", items: [{ name: "X", contact: "Maria" }] }).err, /ref of a contact/);
  assert.match(N.normItems({ app: "crm", items: [{ name: "X", status: "vip" }] }).err, /lead, active or past/);
  assert.equal(N.normItems({ app: "contacts", items: new Array(101).fill({ name: "A" }) }).ok, false);
});

test("create: new contacts in Contacts' own shape, every field stamped, look-alikes flagged", () => {
  const nm = N.normItems({ app: "contacts", items: [
    { name: "Γιώργος Νέος", phones: ["210 1234567"], emails: ["g@new.gr"], address: { street: "Οδός 1", city: "Αθήνα", zip: "10558" },
      birthday: "1980-02-29", labels: ["work", "Authors"], note: "Μεταφραστής", job_title: "Translator" },
    { name: "Maria Other", phones: ["6912345678"] },         // same phone as c1
    { name: "μαρια παπαδοπουλου" }                             // same name as c1
  ] });
  assert.equal(nm.ok, true);
  const before = contacts();
  const pl = N.plan("contacts", before, nm.items);
  assert.equal(pl.ok, true);
  assert.equal(pl.rows[0].dup, null);
  assert.equal(pl.rows[1].dup.id, "c1");
  assert.equal(pl.rows[2].dup.id, "c1");
  assert.ok(pl.rows[0].fields.some((f) => f[0] === "labels"));

  const res = N.apply("contacts", before, nm.items, NOW, { 1: 1, 2: 1 });
  assert.equal(res.ok, true);
  assert.equal(res.made.length, 1);
  assert.deepEqual(before, contacts(), "the input is never touched");
  const c = res.data.contacts.find((x) => x.id === res.made[0].id);
  assert.equal(c.given, "Γιώργος");
  assert.equal(c.family, "Νέος");
  assert.equal(c.jobTitle, "Translator");
  assert.deepEqual(c.labelIds, ["l1", "lbl-work"]);
  assert.deepEqual(c.events, [{ day: "02-29", year: 1980, type: "birthday", label: "" }]);
  assert.equal(c.mtime, NOW);
  assert.equal(c.fm.note, NOW);
  assert.equal(c.fm.labelIds, NOW);
  assert.equal(c.fm.keep, undefined);
  assert.equal(res.data.contacts.length, 2);

  // contacts.js sanitizeContact keeps it byte for byte (the stored shape)
  const keys = ["id", "given", "middle", "family", "nickname", "org", "jobTitle", "phones", "emails", "addresses", "websites",
                "im", "events", "relations", "labelIds", "starred", "note", "avatar", "mtime", "fm"];
  assert.deepEqual(Object.keys(c), keys);

  // unknown label: refused with the user's labels named
  const bad = N.plan("contacts", before, N.normItems({ app: "contacts", items: [{ name: "Z", labels: ["VIP"] }] }).items);
  assert.match(bad.err, /no label VIP \(labels: Εργασία, Authors\)/);

  // an empty device
  const fresh = N.apply("contacts", null, N.normItems({ app: "contacts", items: [{ org: "ACME" }] }).items, NOW, {});
  assert.equal(fresh.data.contacts[0].org, "ACME");
  assert.deepEqual(fresh.data.deleted, []);
});

test("create: contact Undo takes back only an untouched new contact, with a tombstone", () => {
  const nm = N.normItems({ app: "contacts", items: [{ name: "A One" }, { name: "B Two" }] });
  const res = N.apply("contacts", contacts(), nm.items, NOW, {});
  const u = N.undo("contacts", res.data, res.undo, NOW + 10);
  assert.equal(u.ok, true);
  assert.equal(u.data.contacts.length, 1);
  assert.equal(u.data.deleted.length, 2);
  assert.ok(u.data.deleted.every((x) => x.mtime > NOW));
  // changed since: nothing undone
  const ch = JSON.parse(JSON.stringify(res.data));
  ch.contacts[1].note = "edited";
  assert.equal(N.undo("contacts", ch, res.undo, NOW + 10).ok, false);
});

test("create: CRM customers in normCust shape, sorted, linked to a contact; CRM's norm keeps them", () => {
  const nm = N.normItems({ app: "crm", items: [
    { name: "Γιάννης Συγγραφέας", kind: "person", status: "active", tax_id: "094014201", tax_office: "Α' Αθηνών",
      email: "g@a.gr", phone: "6900000000", address: { street: "Οδός 2", city: "Πάτρα", country: "Ελλάδα" }, note: "IBAN …",
      contact: "r4", role: "Author" },
    { name: "ΕΚΔΟΣΕΙΣ ΑΛΦΑ" }                              // same name as aaaaaa01
  ] });
  assert.equal(nm.ok, true);
  // the caller turns the contact ref into a person
  assert.equal(N.plan("crm", crm(), nm.items).ok, false);
  nm.items[0].person = { c: "c1", n: "Μαρία Παπαδοπούλου", role: nm.items[0].role };
  const pl = N.plan("crm", crm(), nm.items);
  assert.equal(pl.ok, true);
  assert.equal(pl.rows[1].dup.id, "aaaaaa01");
  const res = N.apply("crm", crm(), nm.items, NOW, { 1: 1 });
  assert.equal(res.made.length, 1);
  const c = res.data.cust.find((x) => x.id === res.made[0].id);
  assert.equal(c.kind, "person");
  assert.equal(c.st, "active");
  assert.equal(c.afm, "094014201");
  assert.equal(c.addr, "Οδός 2, Πάτρα");
  assert.equal(c.country, "Ελλάδα");
  assert.deepEqual(c.people, [{ c: "c1", n: "Μαρία Παπαδοπούλου", role: "Author" }]);
  assert.equal(c.m, NOW);
  const ids = res.data.cust.map((x) => x.id);
  assert.deepEqual(ids, ids.slice().sort());
  const normed = CRM.norm(res.data);
  assert.deepEqual(normed.cust.find((x) => x.id === c.id), c, "CRM keeps the row as written");
  assert.deepEqual(CRM.custsForContact(normed, "c1").map((x) => x.id), [c.id], "Contacts finds the customer");

  // undo: only while untouched and without deals
  const withDeal = JSON.parse(JSON.stringify(normed));
  withDeal.deals.push({ id: "dddddd01", m: NOW + 1, cust: c.id, title: "x", stage: "new" });
  assert.equal(N.undo("crm", withDeal, res.undo, NOW + 5).ok, false);
  const u = N.undo("crm", normed, res.undo, NOW + 5);
  assert.equal(u.ok, true);
  assert.equal(CRM.norm(u.data).cust.some((x) => x.id === c.id), false);
  assert.ok(u.data.tombs[c.id] > NOW);

  // an empty CRM
  const fresh = N.apply("crm", null, N.normItems({ app: "crm", items: [{ name: "New Co" }] }).items, NOW, {});
  assert.equal(CRM.norm(fresh.data).cust[0].name, "New Co");
  assert.equal(CRM.norm(fresh.data).cust[0].st, "lead");
});

test("link: a contact becomes one of the customer's people; a name-only person turns into the link", () => {
  const d = crm();
  d.cust[0].people = [{ c: "", n: "Μαρία Παπαδοπούλου", role: "Accounts" }];
  const pl = N.planLinks(d, contacts(), [{ cust: "aaaaaa01", c: "c1" }]);
  assert.equal(pl.ok, true);
  assert.equal(pl.rows[0].rows[0].a, "Μαρία Παπαδοπούλου (Accounts)");
  const res = N.applyLinks(d, contacts(), [{ cust: "aaaaaa01", c: "c1" }], NOW, {});
  assert.equal(res.ok, true);
  const c = res.data.cust[0];
  assert.deepEqual(c.people, [{ c: "c1", n: "Μαρία Παπαδοπούλου", role: "Accounts" }]);
  assert.equal(c.m, NOW);
  assert.deepEqual(CRM.norm(res.data).cust[0], c);
  // twice: linked already, nothing to do
  const again = N.planLinks(res.data, contacts(), [{ cust: "aaaaaa01", c: "c1" }]);
  assert.equal(again.rows[0].same, true);
  const none = N.applyLinks(res.data, contacts(), [{ cust: "aaaaaa01", c: "c1" }], NOW + 1, {});
  assert.deepEqual(none.done, []);
  // gone contact / customer
  assert.equal(N.planLinks(d, contacts(), [{ cust: "aaaaaa01", c: "zz" }]).ok, false);
  assert.equal(N.planLinks(d, contacts(), [{ cust: "aaaaaa99", c: "c1" }]).ok, false);
  // undo
  const u = N.undo("crm", res.data, res.undo, NOW + 5);
  assert.equal(u.ok, true);
  assert.deepEqual(u.data.cust[0].people, [{ c: "", n: "Μαρία Παπαδοπούλου", role: "Accounts" }]);
  assert.ok(u.data.cust[0].m > NOW);
  // a newer person added: plain new link, role given
  const r2 = N.applyLinks(crm(), contacts(), [{ cust: "aaaaaa01", c: "c1", role: "Editor" }], NOW, {});
  assert.deepEqual(r2.data.cust[0].people, [{ c: "c1", n: "Μαρία Παπαδοπούλου", role: "Editor" }]);
});

test("tools: create_items and link_contact are offered only when allowed, and the app wires them", () => {
  const names = (o) => A.toolsFor(o).map((t) => t.name);
  assert.ok(!names({ data: true, entries: true }).includes("create_items"));
  assert.ok(names({ data: true, entries: true, creates: ["contacts"] }).includes("create_items"));
  assert.ok(!names({ data: true, creates: ["contacts"] }).includes("link_contact"));
  assert.ok(names({ data: true, creates: ["contacts", "crm"], links: true }).includes("link_contact"));
  const sys = A.systemPrompt({ lang: "en", now: NOW, apps: ["Contacts (contacts)", "CRM (crm)"], entries: ["contact", "customer"],
                               changes: ["Contacts (contacts)"], creates: ["contacts", "crm"], links: true, files: "pdf" });
  assert.match(sys, /call create_items/);
  assert.match(sys, /link_contact/);
  assert.match(sys, /Someone not there gets create_items/);
  const src = fs.readFileSync(path.join(__dirname, "..", "assistant", "assistant.js"), "utf8");
  assert.match(src, /call\.name === "create_items"\) return createItems/);
  assert.match(src, /call\.name === "link_contact"\) return linkContact/);
  assert.match(src, /ui\.k === "create"\) \{ drawCreate/);
  const html = fs.readFileSync(path.join(__dirname, "..", "assistant", "index.html"), "utf8");
  assert.ok(html.indexOf("create.js") > html.indexOf("edits.js") && html.indexOf("create.js") < html.indexOf("assistant.js?"));
});
