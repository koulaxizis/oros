// Contacts wave 26: per-field merge + interaction log (contacts/merge.js),
// keep in touch / reach out / reminder (contacts/keep.js), any-CSV column
// mapping (contacts/csvmap.js), business card text (contacts/cardtext.js),
// and the phone bridge ignoring the new keys (phone.js).
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../contacts/merge.js");
const K = require("../contacts/keep.js");
const C = require("../contacts/csvmap.js");
const CT = require("../contacts/cardtext.js");
const P = require("../phone.js");

function contact(o) {
  return Object.assign({
    id: "c1", given: "Μαρία", middle: "", family: "Παπά", nickname: "", org: "", jobTitle: "",
    phones: [], emails: [], addresses: [], websites: [], im: [], events: [], relations: [],
    labelIds: [], starred: false, note: "", photo: null, mtime: 100
  }, o);
}
const clone = (x) => JSON.parse(JSON.stringify(x));
function edit(c, patch, now) {
  const cur = Object.assign(clone(c), patch, { mtime: now });
  return M.restamp(clone(c), cur, now);
}

// ---------- per-field merge ----------
test("two devices edit different fields: both edits survive, either order", () => {
  const base = M.restamp(null, contact({}), 100);
  const a = edit(base, { phones: [{ v: "6900000001", type: "mobile" }] }, 200);
  const b = edit(base, { note: "met at the conference" }, 300);
  const ab = M.mergeContact(a, b), ba = M.mergeContact(b, a);
  assert.deepEqual(ab, ba, "symmetric");
  assert.equal(ab.phones[0].v, "6900000001");
  assert.equal(ab.note, "met at the conference");
  assert.equal(ab.mtime, 300);
  assert.deepEqual(M.mergeContact(ab, ab), ab, "merge(x, x) = x");
  assert.deepEqual(M.mergeContact(M.mergeContact(ab, a), b), ab, "re-merging old copies changes nothing");
});

test("the same field on both devices: the later edit wins", () => {
  const base = M.restamp(null, contact({}), 100);
  const a = edit(base, { org: "Alpha" }, 200);
  const b = edit(base, { org: "Beta" }, 300);
  assert.equal(M.mergeContact(a, b).org, "Beta");
  assert.equal(M.mergeContact(b, a).org, "Beta");
});

test("old data without stamps merges whole-object as before", () => {
  const a = contact({ note: "a", mtime: 200 });
  const b = contact({ note: "b", org: "X", mtime: 300 });
  const m = M.mergeContact(a, b);
  assert.equal(m.note, "b");
  assert.equal(m.org, "X");
  assert.equal(m.fm, undefined, "no stamps invented for old copies");
});

test("a copy changed by code that knows only mtime (older orOS, phone bridge) speaks for every old field", () => {
  const base = M.restamp(null, contact({}), 100);
  const mine = edit(base, { org: "Mine" }, 200);
  // phone.js: Object.assign(old, changes, { mtime }) keeps the old fm
  const phone = Object.assign(clone(base), { note: "from phone", mtime: 300 });
  assert.ok(M.touchedByOldCode(phone));
  const m = M.mergeContact(mine, phone);
  assert.equal(m.note, "from phone");
  assert.equal(m.org, "", "whole-object semantics for that copy, as before");
});

test("keep / seen: a copy that dropped the keys (older orOS) never wins them", () => {
  const base = M.restamp(null, contact({}), 100);
  const set = edit(base, { keep: { n: 2, u: "m" }, seen: "2026-10-01" }, 200);
  const stripped = clone(set);
  delete stripped.keep; delete stripped.seen; delete stripped.fm; delete stripped.log;
  stripped.note = "edited on an old device";
  stripped.mtime = 300;
  const m = M.mergeContact(set, stripped);
  assert.deepEqual(m.keep, { n: 2, u: "m" });
  assert.equal(m.seen, "2026-10-01");
  assert.equal(m.note, "edited on an old device");
  assert.deepEqual(M.mergeContact(stripped, set), m);
});

test("keep cleared on one device beats the older cadence on the other", () => {
  const base = M.restamp(null, contact({}), 100);
  const set = edit(base, { keep: { n: 1, u: "w" } }, 200);
  const cleared = edit(set, { keep: null }, 300);
  assert.equal(cleared.keep, null);
  assert.equal(M.mergeContact(set, cleared).keep, null);
});

test("restamp: a save with no change stamps nothing", () => {
  const base = M.restamp(null, contact({}), 100);
  const same = Object.assign(clone(base), { mtime: 999 });
  M.restamp(clone(base), same, 999);
  assert.equal(same.mtime, 100);
  assert.deepEqual(same.fm, base.fm);
});

// ---------- interaction log ----------
test("interactions merge per item; a deletion is a tombstone; an edit after it comes back", () => {
  const base = M.restamp(null, contact({}), 100);
  const a = clone(base), b = clone(base);
  M.logPut(a, { id: "i1", k: "call", d: "2026-10-01", tx: "hello" }, 200);
  M.logPut(b, { id: "i2", k: "gift", d: "2026-10-02", tx: "book" }, 210);
  let m = M.mergeContact(M.restamp(clone(base), a, 200), M.restamp(clone(base), b, 210));
  assert.deepEqual(m.log.map((x) => x.id), ["i1", "i2"]);
  // delete i1 on one side, the other still has it
  const d = clone(m);
  M.logRemove(d, "i1", 300);
  M.restamp(clone(m), d, 300);
  m = M.mergeContact(m, d);
  assert.deepEqual(m.log.map((x) => x.id), ["i2"]);
  assert.ok(m.logDel.i1 >= 300);
  // an older copy with i1 does not bring it back
  assert.deepEqual(M.mergeContact(m, a).log.map((x) => x.id), ["i2"]);
  // an edit made after the delete does
  const e = clone(a);
  M.logPut(e, { id: "i1", k: "call", d: "2026-10-01", tx: "edited later" }, 400);
  assert.deepEqual(M.mergeContact(m, e).log.map((x) => x.tx), ["edited later", "book"]);
});

test("log sanitizer: bad items dropped, kinds and lengths kept in bounds", () => {
  const out = M.sanLog([
    { id: "a", k: "dance", d: "2026-10-01", tx: "x".repeat(2000), m: 1 },
    { id: "b", k: "call", d: "2026-02-30", tx: "", m: 1 },
    { id: "", k: "call", d: "2026-10-01", m: 1 },
    null
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].k, "note");
  assert.equal(out[0].tx.length, 1000);
});

test("sanExtras keeps old contacts byte-identical", () => {
  const c = contact({});
  assert.deepEqual(M.sanExtras(c, clone(c)), c);
});

// ---------- keep in touch ----------
test("last contacted: the later of 'contacted today' and past interactions", () => {
  const c = contact({ seen: "2026-09-01", log: [
    { id: "a", k: "call", d: "2026-09-20", tx: "", m: 1 },
    { id: "b", k: "meet", d: "2026-12-01", tx: "planned", m: 1 }
  ] });
  assert.equal(K.lastContact(c, "2026-10-14"), "2026-09-20");
});

test("cadence: months clamp to the month end; overdue and due dates", () => {
  assert.equal(K.addKeep("2026-01-31", { n: 1, u: "m" }), "2026-02-28");
  assert.equal(K.addKeep("2026-11-15", { n: 3, u: "m" }), "2027-02-15");
  assert.equal(K.addKeep("2026-10-01", { n: 2, u: "w" }), "2026-10-15");
  const c = contact({ keep: { n: 2, u: "w" }, seen: "2026-09-20" });
  const st = K.status(c, "2026-10-14");
  assert.equal(st.due, "2026-10-04");
  assert.equal(st.days, 10);
  assert.ok(st.overdue);
  assert.equal(K.status(contact({ keep: null }), "2026-10-14"), null);
});

test("never contacted: counts from the day the cadence was set", () => {
  const set = new Date(2026, 9, 10, 12).getTime();
  const c = contact({ keep: { n: 1, u: "w" }, fm: { keep: set } });
  assert.equal(K.status(c, "2026-10-14").overdue, false);
  assert.equal(K.status(c, "2026-10-17").overdue, true);
});

test("reach out: only live overdue contacts, longest waiting first", () => {
  const blob = { contacts: [
    contact({ id: "a", given: "A", keep: { n: 1, u: "m" }, seen: "2026-08-01" }),
    contact({ id: "b", given: "B", keep: { n: 1, u: "m" }, seen: "2026-06-01" }),
    contact({ id: "c", given: "C", keep: { n: 1, u: "m" }, seen: "2026-10-10" }),
    contact({ id: "d", given: "D", keep: { n: 1, u: "w" }, seen: "2026-01-01", mtime: 5 })
  ], deleted: [{ id: "d", mtime: 10 }] };
  assert.deepEqual(K.reachOut(blob, "2026-10-14").map((x) => x.id), ["b", "a"]);
});

test("reminder: off by default, after the hour, one key per day, texts in both languages", () => {
  const blob = { contacts: [contact({ id: "a", given: "Άννα", keep: { n: 1, u: "w" }, seen: "2026-09-01" })] };
  const at9 = new Date(2026, 9, 14, 9, 0).getTime(), at11 = new Date(2026, 9, 14, 11, 0).getTime();
  assert.equal(K.reminder(blob, null, at11), null);
  assert.deepEqual(K.prefs({}), { on: false, hour: 10 });
  assert.equal(K.reminder(blob, { on: true, hour: 10 }, at9), null);
  const r = K.reminder(blob, { on: true, hour: 10 }, at11);
  assert.equal(r.key, "keep-2026-10-14");
  assert.deepEqual(r.ids, ["a"]);
  assert.match(K.reminderText(r, "el").body, /Άννα/);
  assert.match(K.reminderText(r, "en").title, /reach out/i);
});

// ---------- CSV mapping ----------
test("CSV: semicolons (Greek Excel), quotes, BOM", () => {
  const p = C.parse("﻿Όνομα;Επώνυμο;Σημειώσεις\r\nΜαρία;Παπά;\"a;b\"\r\n");
  assert.equal(p.delim, ";");
  assert.deepEqual(p.rows[1], ["Μαρία", "Παπά", "a;b"]);
});

test("CSV: header guesses in English and Greek, with types", () => {
  const g = (h) => { const x = C.guess(h); return x.f + (x.ty ? ":" + x.ty : ""); };
  assert.equal(g("First Name"), "given");
  assert.equal(g("Επώνυμο"), "family");
  assert.equal(g("Ονοματεπώνυμο"), "full");
  assert.equal(g("Επωνυμία"), "org");
  assert.equal(g("Job Title"), "jobTitle");
  assert.equal(g("Title"), "", "Outlook's Title is Mr./Ms., not a job");
  assert.equal(g("E-mail Address"), "email:other");
  assert.equal(g("Business Phone"), "phone:work");
  assert.equal(g("Κινητό"), "phone:mobile");
  assert.equal(g("Τηλ. οικίας"), "phone:home");
  assert.equal(g("Home Street"), "street:home");
  assert.equal(g("Τ.Κ."), "zip:other");
  assert.equal(g("Πόλη"), "city:other");
  assert.equal(g("Ημερομηνία γέννησης"), "birthday");
  assert.equal(g("Categories"), "labels");
  assert.equal(g("Phone 1 - Type"), "");
  assert.equal(g("Χρώμα"), "");
  assert.ok(C.isGoogle(["Name", "Phone 1 - Value"]));
  assert.ok(!C.isGoogle(["First Name", "Mobile Phone"]));
});

test("CSV: dates day-first unless the column says otherwise", () => {
  assert.equal(C.dateOrder(["03/04/1980", "25/12/1990"]), "dmy");
  assert.equal(C.dateOrder(["12/25/1990"]), "mdy");
  assert.deepEqual(C.parseDate("03/04/1980", "dmy"), { day: "04-03", year: 1980 });
  assert.deepEqual(C.parseDate("17 Μαρτίου 1975", "dmy"), { day: "03-17", year: 1975 });
  assert.deepEqual(C.parseDate("Mar 17, 1975", "dmy"), { day: "03-17", year: 1975 });
  assert.equal(C.parseDate("31/02/1980", "dmy"), null);
});

test("CSV: rows → contacts in the import shape", () => {
  const rows = C.parse([
    "Ονοματεπώνυμο;Κινητό;Email;Οδός;Τ.Κ.;Πόλη;Γενέθλια;Ετικέτες;Χρώμα",
    "Παπαδόπουλος, Γιώργος;694 000 0001 / 210 000 0002;g@example.gr;Ερμού 5;10563;Αθήνα;03/04/1980;Φίλοι, Δουλειά;μπλε",
    ";;only@example.com;;;;;;",
    ";;;;;;;;"
  ].join("\n")).rows;
  const map = rows[0].map(C.guess);
  const out = C.toContacts(rows, map, { header: true, order: "dmy" });
  assert.equal(out.length, 2);
  const a = out[0];
  assert.equal(a.given, "Γιώργος");
  assert.equal(a.family, "Παπαδόπουλος");
  assert.deepEqual(a.phones.map((p) => p.v), ["694 000 0001", "210 000 0002"]);
  assert.equal(a.phones[0].type, "mobile");
  assert.deepEqual(a.addresses, [{ street: "Ερμού 5", city: "Αθήνα", zip: "10563", region: "", country: "", type: "other" }]);
  assert.deepEqual(a.events, [{ day: "04-03", year: 1980, type: "birthday", label: "" }]);
  assert.deepEqual(a.cats, ["Φίλοι", "Δουλειά"]);
  assert.equal(out[1].given, "only@example.com", "no name → named by the e-mail");
});

// ---------- business card text ----------
test("card text (Greek): name, title, company, phones by label, address, web", () => {
  const pc = CT.parse([
    "Μαρία Παπαδοπούλου", "Διευθύντρια Πωλήσεων", "ACME Software Α.Ε.",
    "Τηλ.: +30 210 123 4567", "Κιν.: 694 123 4567", "Φαξ: 210 123 4568",
    "maria@acme.gr", "www.acme.gr", "Λεωφ. Κηφισίας 12, 115 26 Αθήνα"
  ].join("\n"));
  assert.equal(pc.given, "Μαρία");
  assert.equal(pc.family, "Παπαδοπούλου");
  assert.equal(pc.jobTitle, "Διευθύντρια Πωλήσεων");
  assert.equal(pc.org, "ACME Software Α.Ε.");
  assert.deepEqual(pc.phones, [{ v: "+30 210 123 4567", type: "work" }, { v: "694 123 4567", type: "mobile" }]);
  assert.deepEqual(pc.emails, [{ v: "maria@acme.gr", type: "work" }]);
  assert.deepEqual(pc.websites, [{ v: "www.acme.gr", type: "work" }]);
  assert.equal(pc.addresses[0].street, "Λεωφ. Κηφισίας 12");
  assert.equal(pc.addresses[0].zip, "115 26");
  assert.equal(pc.addresses[0].city, "Αθήνα");
  assert.match(pc.note, /Fax: 210 123 4568/);
});

test("card text (English, ALL CAPS name, one-letter labels)", () => {
  const pc = CT.parse("JOHN A. SMITH\nSenior Software Engineer\nGlobex Corporation\nT: +44 20 7946 0958 | M: +44 7700 900123\nF: +44 20 7946 0000\njohn.smith@globex.co.uk");
  assert.equal(pc.given, "John A.");
  assert.equal(pc.family, "Smith");
  assert.equal(pc.jobTitle, "Senior Software Engineer");
  assert.equal(pc.org, "Globex Corporation");
  assert.deepEqual(pc.phones.map((p) => p.type), ["work", "mobile"]);
  assert.equal(CT.titleCase("ΓΙΩΡΓΟΣ ΝΙΚΟΛΑΟΥ"), "Γιωργος Νικολαου");
});

test("card text: nothing recognisable still keeps every line in the note", () => {
  const pc = CT.parse("lorem ipsum dolor\n12345678 nope");
  assert.ok(pc.note.length > 0 || pc.phones.length > 0);
});

// ---------- phone bridge ----------
test("phone bridge: the new keys change no row hash and survive a phone edit", () => {
  const plain = contact({ phones: [{ v: "6900000001", type: "mobile" }] });
  const rich = Object.assign(clone(plain), {
    keep: { n: 1, u: "m" }, seen: "2026-10-01",
    log: [{ id: "i1", k: "call", d: "2026-10-01", tx: "hi", m: 5 }], logDel: { i0: 3 },
    fm: { given: 100, note: 100, keep: 100, log: 5 }
  });
  assert.deepEqual(P.contactRows({ contacts: [rich] }), P.contactRows({ contacts: [plain] }));
  const row = P.contactRows({ contacts: [rich] })[0];
  const res = P.applyContactChanges({ contacts: [rich] },
    [Object.assign({}, row, { ref: "r1v2", id: "c1", op: "update", note: "from the phone" })], 500);
  const back = res.blob.contacts[0];
  assert.equal(back.note, "from the phone");
  assert.deepEqual(back.keep, rich.keep);
  assert.deepEqual(back.log, rich.log);
  assert.deepEqual(back.logDel, rich.logDel);
});
