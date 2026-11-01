// CardDAV wave 4: davsync.js with the Contacts mapper (contacts/dav.js),
// two orOS devices and one fake CardDAV server (tests/dav-fake.js).
// First link joins the same person found on both sides; PHOTO and
// X- lines survive every write; labels travel by name (seed labels in
// any language); DAV-1..DAV-6 as for the Calendar.
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const DK = require("../davkit.js");
const DS = require("../davsync.js");
const CD = require("../contacts/dav.js");
const { fakeDav } = require("./dav-fake.js");

const BOOK = "https://dav.test/dav/addressbooks/u/contacts/";
const P = "/dav/addressbooks/u/contacts/";
const CONF = DK.normConf({ url: "https://dav.test/dav/", user: "u" });

let clock = Date.UTC(2026, 10, 1, 9, 0);
const tick = () => (clock += 60000);

function vcf(uid, given, family, extra) {
  return ["BEGIN:VCARD", "VERSION:3.0", "PRODID:-//Other//EN", "UID:" + uid, "N:" + family + ";" + given + ";;;",
    "FN:" + given + " " + family].concat(extra || [], ["REV:2026-10-01T00:00:00Z", "END:VCARD", ""]).join("\r\n");
}
function contact(id, given, family, extra) {
  return Object.assign({ id, given, middle: "", family, nickname: "", org: "", jobTitle: "", phones: [], emails: [],
                         addresses: [], websites: [], im: [], events: [], relations: [], labelIds: [], starred: false,
                         note: "", avatar: null, mtime: tick() }, extra || {});
}
const FIELDS = ["given", "middle", "family", "nickname", "org", "jobTitle", "phones", "emails", "addresses",
  "websites", "im", "events", "note", "starred", "avatar"];

// One orOS device: its contacts and labels, its own sync state, a pass
// (the same steps as contacts.js cdLocal / cdApply, in short).
function device(server, labels) {
  const d = { contacts: [], deleted: [], labels: labels || [{ id: "lbl-work", name: "Work" }], store: DS.memStore() };
  const map = CD.mapper(BOOK, { now: () => clock });
  const item = (c) => {
    const it = { id: c.id, mtime: c.mtime };
    for (const f of FIELDS) it[f] = c[f];
    it.cats = c.labelIds.map((id) => (d.labels.find((l) => l.id === id) || {}).name).filter(Boolean);
    return it;
  };
  const match = (srv) => {
    const hits = d.contacts.filter((c) => c.emails.some((e) => srv.emails.some((x) => x.v.toLowerCase() === e.v.toLowerCase())));
    return hits.length === 1 ? hits[0].id : null;
  };
  d.local = () => ({ items: d.contacts.map((c) => ({ id: c.id, item: item(c) })),
                     find: (id) => { const c = d.get(id); return c ? item(c) : null; }, match });
  const labelIds = (names) => names.map((n) => {
    const seed = CD.seedOf(n);
    let l = d.labels.find((x) => (seed && x.id === seed) || CD.fold(x.name) === CD.fold(n));
    if (!l) { l = { id: "lbl-" + d.labels.length, name: n }; d.labels.push(l); }
    return l.id;
  }).sort();
  d.apply = (r) => {
    const now = tick();
    for (const it of r.upsert) {
      const cur = d.get(it.id);
      const c = Object.assign(cur ? JSON.parse(JSON.stringify(cur)) : { id: it.id, relations: [] }, { mtime: now });
      for (const f of FIELDS) c[f] = it[f];
      c.labelIds = labelIds(it.cats);
      const i = d.contacts.findIndex((x) => x.id === c.id);
      if (i >= 0) d.contacts[i] = c; else d.contacts.push(c);
      d.deleted = d.deleted.filter((t) => t.id !== c.id);
    }
    for (const id of r.remove) {
      d.contacts = d.contacts.filter((x) => x.id !== id);
      d.deleted.push({ id, mtime: now });
    }
  };
  d.pass = async (o) => {
    const st = await d.store.get("card");
    return DS.sync(Object.assign({ client: DK.client(CONF, "p", server.fetch), url: BOOK, readOnly: false, state: st, map }, o || {}),
      d.local, d.apply, (s) => d.store.set("card", s));
  };
  d.preview = () => DS.run({ client: DK.client(CONF, "p", server.fetch), url: BOOK, state: null, local: d.local(), map, dry: true });
  d.get = (id) => d.contacts.find((c) => c.id === id);
  return d;
}
function orosSync(a, b) {
  const by = {}, tomb = {};
  for (const c of a.contacts.concat(b.contacts)) if (!by[c.id] || c.mtime > by[c.id].mtime) by[c.id] = c;
  for (const t of a.deleted.concat(b.deleted)) if (!tomb[t.id] || t.mtime > tomb[t.id].mtime) tomb[t.id] = t;
  const contacts = Object.values(by).filter((c) => !(tomb[c.id] && tomb[c.id].mtime >= c.mtime));
  const deleted = Object.values(tomb).filter((t) => !contacts.some((c) => c.id === t.id));
  for (const d of [a, b]) { d.contacts = contacts.map((c) => JSON.parse(JSON.stringify(c))); d.deleted = deleted.slice(); }
}
const writes = (S) => S.log.filter((l) => /^(PUT|DELETE) /.test(l));
const onServer = (S) => Object.keys(S.items).filter((p) => p.indexOf(P) === 0);

test("first link: the preview counts first; the same person on both sides is joined, PHOTO and X- lines stay", async () => {
  const S = fakeDav();
  S.put(P + "anna.vcf", vcf("anna@other", "Anna", "Pappa", ["EMAIL;TYPE=HOME:anna@example.com", "TEL;TYPE=CELL:+30 691 111 1111",
    "PHOTO;ENCODING=b;TYPE=JPEG:QUJD", "X-SOCIAL:anna", "CATEGORIES:Work"]));
  S.put(P + "bob.vcf", vcf("bob@other", "Bob", "Stone"));
  const A = device(S);
  A.contacts.push(contact("c-anna", "Anna", "Pappa", { emails: [{ v: "Anna@Example.com", type: "home" }],
                                                       phones: [{ v: "210 222 2222", type: "home" }], note: "met at the fair" }));
  A.contacts.push(contact("c-eva", "Eva", "Lind", { labelIds: ["lbl-work"] }));
  const before = writes(S).length;
  const pv = await A.preview();
  assert.deepEqual([pv.stats.down, pv.stats.up, pv.stats.same, pv.stats.merged], [1, 1, 0, 1]);
  assert.equal(writes(S).length, before, "the preview writes nothing");

  await A.pass();
  assert.equal(onServer(S).length, 3);
  assert.equal(A.contacts.length, 3, "Anna is one contact, not two");
  const anna = A.get("c-anna");
  assert.deepEqual(anna.phones.map((p) => p.v).sort(), ["+30 691 111 1111", "210 222 2222"]);
  assert.equal(anna.note, "met at the fair");
  assert.deepEqual(anna.labelIds, ["lbl-work"]);
  const text = S.items[P + "anna.vcf"].data;
  for (const keep of ["UID:anna@other", "PHOTO;ENCODING=b;TYPE=JPEG:QUJD", "X-SOCIAL:anna", "TEL;TYPE=CELL:+30 691 111 1111"]) {
    assert.ok(text.includes(keep), keep);
  }
  assert.ok(text.includes("TEL;TYPE=HOME:210 222 2222") && text.includes("NOTE:met at the fair"));
  assert.match(S.items[P + "c-eva.vcf"].data, /UID:c-eva@oros\.contacts[\s\S]*CATEGORIES:Work/);
  assert.match(A.contacts.find((c) => c.given === "Bob").id, /^dav-/);
});

test("DAV-6: no change writes nothing, even with seed labels named in another language; edits go both ways", async () => {
  const S = fakeDav();
  S.put(P + "a.vcf", vcf("a@other", "Ann", "Lee", ["CATEGORIES:Work,Family", "PHOTO:http://x.example/p.jpg"]));
  const A = device(S, [{ id: "lbl-work", name: "Εργασία" }, { id: "lbl-family", name: "Οικογένεια" }]);
  await A.pass();
  assert.deepEqual(A.contacts[0].labelIds, ["lbl-family", "lbl-work"], "seed labels found by their English names");
  const n = writes(S).length;
  for (let i = 0; i < 3; i++) {
    const r = await A.pass();
    assert.deepEqual([r.upsert.length, r.remove.length], [0, 0]);
  }
  assert.equal(writes(S).length, n, "nothing written by passes that changed nothing");

  const c = A.contacts[0];
  c.jobTitle = "Editor";
  c.mtime = tick();
  await A.pass();
  const text = S.items[P + "a.vcf"].data;
  assert.ok(text.includes("TITLE:Editor") && text.includes("PHOTO:http://x.example/p.jpg") && text.includes("CATEGORIES:Work,Family"));
  assert.equal(writes(S).length, n + 1);

  // Changed on the server: comes down.
  S.put(P + "a.vcf", text.replace("TITLE:Editor", "TITLE:Chief editor"));
  await A.pass();
  assert.equal(A.contacts[0].jobTitle, "Chief editor");
});

test("two devices: the second one binds to what the first uploaded, nothing doubles, nothing is written", async () => {
  const S = fakeDav();
  const A = device(S), B = device(S);
  A.contacts.push(contact("c1", "Nina", "Ray", { emails: [{ v: "nina@example.com", type: "work" }] }));
  await A.pass();
  orosSync(A, B);
  const n = writes(S).length;
  await B.pass();
  assert.equal(B.contacts.length, 1);
  assert.equal(writes(S).length, n);
  // B edits, A gets it through the server and through orOS sync alike.
  B.contacts[0].note = "from B";
  B.contacts[0].mtime = tick();
  await B.pass();
  orosSync(A, B);
  const r = await A.pass();
  assert.equal(r.stats.conflicts, 0, "the same change both ways is not a conflict");
  assert.equal(A.contacts[0].note, "from B");
});

test("deletions: here → DELETE If-Match; there → removed here; many at once wait (DAV-3)", async () => {
  const S = fakeDav();
  for (let i = 0; i < 8; i++) S.put(P + "p" + i + ".vcf", vcf("p" + i + "@other", "P" + i, "X"));
  const A = device(S);
  await A.pass();
  assert.equal(A.contacts.length, 8);
  const gone = A.contacts.find((c) => c.given === "P0");
  A.contacts = A.contacts.filter((c) => c !== gone);
  await A.pass();
  assert.equal(onServer(S).length, 7);
  S.remove(P + "p1.vcf");
  await A.pass();
  assert.equal(A.contacts.length, 6);
  // Five at once of six: held until the person answers.
  for (const k of ["p2", "p3", "p4", "p5", "p6"]) S.remove(P + k + ".vcf");
  const h = await A.pass();
  assert.deepEqual(h.held, { local: 5, server: 0 });
  assert.equal(A.contacts.length, 6);
  await A.pass({ decision: "restore" });
  assert.equal(onServer(S).length, 6, "brought back to the server");
  assert.equal(A.contacts.length, 6);
});
