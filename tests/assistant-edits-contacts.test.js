// Contacts adapter for assistant/edits.js (phase 4 wave 2).
// Run: node --test contacts.test.js (from this directory)
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
const E = require(path.join(REPO, "assistant/edits.js"));
const MG = require(path.join(REPO, "contacts/merge.js"));

// The app's own list merge (contacts.js mergeContacts, inside its
// DOM IIFE), cut out verbatim and run with merge.js as MG.
const mergeContacts = (function () {
  const src = fs.readFileSync(path.join(REPO, "contacts/contacts.js"), "utf8");
  const a = src.indexOf("  function mergeEntity(a, b) {");
  const b = src.indexOf("  // CT-7: canonical form");
  assert.ok(a > 0 && b > a);
  return new Function("MG", src.slice(a, b) + "\nreturn mergeContacts;")(MG);
})();

const NOW = 1760000000000;
const ok = (args) => { const r = E.normArgs(args); assert.equal(r.ok, true, r.err); return r; };
const KEYS = ["id", "given", "middle", "family", "nickname", "org", "jobTitle", "phones", "emails", "addresses",
  "websites", "im", "events", "relations", "labelIds", "starred", "note", "photo", "mtime"];

function data() {
  return {
    ver: 1, labels: [],
    contacts: [
      { id: "c1", given: "Anna", middle: "", family: "Pappa", nickname: "", org: "Acme", jobTitle: "",
        phones: [{ v: "+30 691 234 5678", type: "mobile" }], emails: [{ v: "Anna@Example.com", type: "home" }],
        addresses: [], websites: [], im: [],
        events: [{ day: "05-01", year: null, type: "anniversary", label: "" }],
        relations: [], labelIds: [], starred: false, note: "old", photo: "data:image/jpeg;base64,AAAA",
        mtime: 1000,
        fm: { given: 900, middle: 900, family: 900, nickname: 900, org: 900, jobTitle: 900, phones: 1000, emails: 900,
              addresses: 900, websites: 900, im: 900, events: 900, relations: 900, labelIds: 900, starred: 900, note: 900, photo: 900 } },
      // an old copy: no fm (whole-object stamps)
      { id: "c2", given: "", middle: "", family: "", nickname: "", org: "Bakery", jobTitle: "",
        phones: [], emails: [], addresses: [], websites: [], im: [], events: [], relations: [], labelIds: [],
        starred: false, note: "", photo: null, mtime: 500 }
    ],
    deleted: [{ id: "zz", mtime: 3 }]
  };
}
const find = (d, id) => d.contacts.find((c) => c.id === id);
function run(d, target, args, now) {
  const ch = ok(args);
  const p = E.plan("contacts", d, target, ch, now || NOW);
  assert.equal(p.ok, true, p.err);
  const a = E.apply("contacts", d, target, ch, now || NOW, p.before);
  assert.equal(a.ok, true, a.err);
  return { p, a };
}

test("wiring: contacts is editable with update and delete only", () => {
  assert.equal(E.storageKey("contacts"), "oros-contacts-data");
  assert.deepEqual(E.actionsFor("contacts"), ["update", "delete"]);
  for (const action of ["complete", "reopen"]) {
    assert.equal(E.plan("contacts", data(), "c1", ok({ ref: "r1", action }), NOW).ok, false);
  }
  assert.equal(E.plan("contacts", data(), "c1", ok({ ref: "r1", action: "reschedule", date: "2026-01-01" }), NOW).ok, false);
});

test("update: name, org, note, birthday; stamps only the changed fields, newer than before", () => {
  const d = data();
  const { p, a } = run(d, "c1", { ref: "r1", action: "update", title: "Anna Maria Papadopoulou", org: "Acme Ltd", note: "new", date: "1990-03-17" });
  assert.deepEqual(p.before, { title: "Anna Pappa", org: "Acme", phone: "+30 691 234 5678", email: "Anna@Example.com", birthday: "", note: "old" });
  assert.deepEqual(p.after.title, "Anna Maria Papadopoulou");
  assert.deepEqual(p.rows.map((r) => r.f), ["title", "org", "birthday", "note"]);
  const c = find(a.data, "c1");
  assert.equal(c.given, "Anna Maria"); assert.equal(c.middle, ""); assert.equal(c.family, "Papadopoulou");
  assert.equal(c.org, "Acme Ltd"); assert.equal(c.note, "new");
  // events stay in sanitizeContact order (type, then day)
  assert.deepEqual(c.events, [{ day: "05-01", year: null, type: "anniversary", label: "" },
                              { day: "03-17", year: 1990, type: "birthday", label: "" }]);
  assert.equal(c.mtime, NOW);
  for (const f of ["given", "family", "org", "note", "events"]) assert.equal(c.fm[f], NOW, f);
  assert.equal(c.fm.middle, 900);  // unchanged ("" → "")
  assert.equal(c.fm.phones, 1000); assert.equal(c.fm.photo, 900);
  assert.equal(c.photo, "data:image/jpeg;base64,AAAA");
  assert.deepEqual(Object.keys(c), KEYS.concat(["fm"]));      // key order kept
  assert.deepEqual(find(data(), "c1"), find(d, "c1"));         // plan/apply never touch the input
});

test("update stamps match the app's own restamp (merge.js) byte for byte", () => {
  for (const id of ["c1", "c2"]) {
    const d = data();
    const args = id === "c1" ? { ref: "r1", action: "update", title: "Anna B", phone: "210 555 1234" }
                             : { ref: "r1", action: "update", note: "fresh bread", date: "1980-12-01" };
    const { a } = run(d, id, args);
    const mine = find(a.data, id);
    const app = Object.assign(JSON.parse(JSON.stringify(mine)));
    delete app.fm; app.mtime = find(d, id).mtime;
    MG.restamp(JSON.parse(JSON.stringify(find(d, id))), app, NOW);
    assert.deepEqual(mine, app, id);
  }
});

test("a clock behind the stored stamps still wins: stamp = newest + 1", () => {
  const d = data();
  const { a } = run(d, "c1", { ref: "r1", action: "update", note: "x" }, 10);
  const c = find(a.data, "c1");
  assert.equal(c.mtime, 1001); assert.equal(c.fm.note, 1001);
});

test("phone / email are added, never removed; one already there changes nothing", () => {
  const d = data();
  const { a } = run(d, "c1", { ref: "r1", action: "update", phone: "210 555 1234", email: "anna@work.gr" });
  const c = find(a.data, "c1");
  assert.deepEqual(c.phones, [{ v: "+30 691 234 5678", type: "mobile" }, { v: "210 555 1234", type: "mobile" }]);
  assert.deepEqual(c.emails, [{ v: "Anna@Example.com", type: "home" }, { v: "anna@work.gr", type: "home" }]);
  // same number without the country code, same e-mail in another case
  const ch = ok({ ref: "r1", action: "update", phone: "6912345678", email: "anna@example.COM" });
  const r = E.plan("contacts", data(), "c1", ch, NOW);
  assert.equal(r.ok, false); assert.match(r.err, /Nothing would change/);
  // already there + a real change: only the real change is stamped
  const { a: a2 } = run(data(), "c1", { ref: "r1", action: "update", phone: "6912345678", note: "n2" });
  const c2 = find(a2.data, "c1");
  assert.equal(c2.phones.length, 1); assert.equal(c2.fm.phones, 1000); assert.equal(c2.fm.note, NOW);
});

test("birthday: an existing one is moved (label kept), not duplicated", () => {
  const d = data();
  find(d, "c1").events.push({ day: "07-07", year: null, type: "birthday", label: "x" });
  const { p, a } = run(d, "c1", { ref: "r1", action: "update", date: "1991-02-03" });
  assert.equal(p.before.birthday, "--07-07"); assert.equal(p.after.birthday, "1991-02-03");
  const bd = find(a.data, "c1").events.filter((e) => e.type === "birthday");
  assert.deepEqual(bd, [{ day: "02-03", year: 1991, type: "birthday", label: "x" }]);
});

test("refusals", () => {
  const t = (target, args, re) => {
    const r = E.plan("contacts", data(), target, ok(args), NOW);
    assert.equal(r.ok, false); assert.match(r.err, re);
  };
  t("nope", { ref: "r1", action: "update", note: "x" }, /no longer in Contacts/);
  t("c1", { ref: "r1", action: "update", location: "Athens" }, /has no location/);
  t("c1", { ref: "r1", action: "update", title: "Anna Pappa" }, /Nothing would change/);
  t("c1", { ref: "r1", action: "update", date: "1700-01-01" }, /1850/);
  t("c1", { ref: "r1", action: "update", title: "A".repeat(61) }, /too long/);
  t("c2", { ref: "r1", action: "update", org: "" }, /needs a name or a company/);
  // a contact a newer tombstone already killed counts as gone
  const d = data(); d.deleted.push({ id: "c1", mtime: 5000 });
  assert.match(E.plan("contacts", d, "c1", ok({ ref: "r1", action: "delete" }), NOW).err, /no longer/);
});

test("the edit wins the app's own merge against the old copy from another device", () => {
  const d = data();
  const { a } = run(d, "c1", { ref: "r1", action: "update", note: "mine", phone: "210 555 1234" });
  const other = data();
  find(other, "c1").org = "Other Org"; find(other, "c1").fm.org = 990;  // a real edit there, older than ours
  for (const [x, y] of [[a.data, other], [other, a.data]]) {
    const m = find(mergeContacts(x, y), "c1");
    assert.equal(m.note, "mine"); assert.equal(m.phones.length, 2);
    assert.equal(m.org, "Other Org");              // per field: their untouched-by-us field survives
  }
  // old-format contact (no fm) against its untouched old copy
  const { a: b } = run(data(), "c2", { ref: "r1", action: "update", note: "n" });
  assert.equal(find(mergeContacts(data(), b.data), "c2").note, "n");
  assert.equal(find(mergeContacts(b.data, data()), "c2").note, "n");
});

test("delete: tombstone wins the app's merge over the other device's copy; undo brings it back", () => {
  const d = data();
  const { p, a } = run(d, "c1", { ref: "r1", action: "delete" });
  assert.equal(p.del, true);
  assert.deepEqual(p.rows.map((r) => r.f), ["title", "org", "phone", "email", "note"]);
  assert.equal(find(a.data, "c1"), undefined);
  const tomb = a.data.deleted.find((x) => x.id === "c1");
  assert.ok(tomb.mtime > 1000); assert.equal(tomb.mtime, NOW);
  for (const [x, y] of [[a.data, data()], [data(), a.data]]) {
    const m = mergeContacts(x, y);
    assert.equal(find(m, "c1"), undefined);
    assert.equal(m.deleted.find((t) => t.id === "c1").mtime, NOW);
  }
  // a slow clock: the tombstone still outranks the contact's newest stamp
  const { a: slow } = run(data(), "c1", { ref: "r1", action: "delete" }, 1);
  assert.equal(slow.data.deleted.find((x) => x.id === "c1").mtime, 1001);
  // undo
  const u = E.undo("contacts", a.data, a.undo, NOW + 10);
  assert.equal(u.ok, true, u.err);
  const back = find(u.data, "c1");
  assert.equal(u.data.contacts.indexOf(back), 0);
  assert.equal(back.photo, "data:image/jpeg;base64,AAAA");
  assert.equal(back.mtime, NOW + 10);
  assert.ok(Object.values(back.fm).every((s) => s === NOW + 10));
  assert.equal(u.data.deleted.find((x) => x.id === "c1"), undefined);
  // the restored contact beats the tombstone still on another device
  assert.equal(find(mergeContacts(a.data, u.data), "c1").note, "old");
  assert.equal(find(mergeContacts(u.data, a.data), "c1").note, "old");
  assert.equal(E.undo("contacts", u.data, a.undo, NOW + 20).ok, false);   // back already
});

test("undo of an update puts back only what changed, with fresh stamps", () => {
  const d = data();
  const { a } = run(d, "c1", { ref: "r1", action: "update", title: "Bo Pappa", phone: "210 555 1234", date: "1990-01-01" });
  assert.deepEqual(Object.keys(a.undo.next).sort(), ["events", "given", "phones"]);
  const u = E.undo("contacts", a.data, a.undo, NOW + 5);
  assert.equal(u.ok, true, u.err);
  const c = find(u.data, "c1"), o = find(data(), "c1");
  for (const k of KEYS.filter((k) => k !== "mtime")) assert.deepEqual(c[k], o[k], k);
  assert.equal(c.mtime, NOW + 5); assert.equal(c.fm.given, NOW + 5); assert.equal(c.fm.note, 900);
  // the undone values win the merge against the edited copy
  assert.equal(find(mergeContacts(a.data, u.data), "c1").given, "Anna");
  // changed since → no undo
  const d2 = JSON.parse(JSON.stringify(a.data));
  find(d2, "c1").phones.push({ v: "999 999 9999", type: "home" });
  assert.match(E.undo("contacts", d2, a.undo, NOW + 5).err, /changed since/);
});

test("conflict: the contact changed after the plan → apply refuses", () => {
  const d = data();
  const ch = ok({ ref: "r1", action: "update", note: "mine" });
  const p = E.plan("contacts", d, "c1", ch, NOW);
  const later = data(); find(later, "c1").org = "Changed elsewhere";
  const r = E.apply("contacts", later, "c1", ch, NOW, p.before);
  assert.equal(r.ok, false); assert.equal(r.conflict, true);
  const pd = E.plan("contacts", d, "c1", ok({ ref: "r1", action: "delete" }), NOW);
  const r2 = E.apply("contacts", later, "c1", ok({ ref: "r1", action: "delete" }), NOW, pd.before);
  assert.equal(r2.conflict, true);
});

test("target from search.js (a bare id) and {id} both work", () => {
  const S = require(path.join(REPO, "contacts/search.js"));
  const d = data();
  const hit = S.search({ readJSON: () => d, lang: "en" }).find((h) => h.id === "c2");
  assert.equal(hit.target, "c2");
  assert.equal(E.plan("contacts", d, hit.target, ok({ ref: "r1", action: "update", note: "a" }), NOW).ok, true);
  assert.equal(E.plan("contacts", d, { id: "c2" }, ok({ ref: "r1", action: "update", note: "a" }), NOW).ok, true);
});
