// CardDAV wave 4: contacts/vcard.js (the vCard reader) and
// contacts/dav.js (the mapper between one vCard on the person's
// server and a contact: DAV-4 lossless patch per property group,
// DAV-5 PHOTO never read, read-only detection, DAV-6 read back).
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const VC = require("../contacts/vcard.js");
const CD = require("../contacts/dav.js");

const COL = "https://dav.test/dav/addressbooks/u/contacts/";
let clock = Date.UTC(2026, 10, 1, 9, 0);
const M = CD.mapper(COL, { now: () => clock });

function item(extra) {
  return Object.assign({
    id: "k1", given: "Anna", middle: "", family: "Pappa", nickname: "", org: "Acme", jobTitle: "Editor",
    phones: [{ v: "+30 691 234 5678", type: "mobile" }, { v: "210 123 4567", type: "work" }],
    emails: [{ v: "anna@example.com", type: "home" }],
    addresses: [{ street: "Odos 1", city: "Athens", region: "", zip: "10558", country: "Greece", type: "home" }],
    websites: [{ v: "https://anna.example", type: "blog" }], im: [{ v: "xmpp:anna@example.com", type: "other" }],
    events: [{ day: "04-12", year: 1985, type: "birthday", label: "" }, { day: "06-01", year: null, type: "custom", label: "Name day; \"big\"" }],
    note: "Line one\nline two, with; marks", starred: true, avatar: "px:ab12", cats: ["Work", "Book club"], mtime: 5
  }, extra || {});
}
const card = (lines) => ["BEGIN:VCARD"].concat(lines, ["END:VCARD", ""]).join("\r\n");

test("vCard reader: 2.1, 3.0 and 4.0 forms, groups, quoted and bare types, tel: URIs, dates", () => {
  const c = VC.parse(VC.blocks(card(["VERSION:4.0", "UID:urn:uuid:1", "FN:Bob Stone", "N:Stone;Bob;;Dr.;Jr.",
    "item1.TEL;TYPE=\"cell,voice\";PREF=1:+30 690 1", "TEL;VALUE=uri;TYPE=work:tel:+30-210-2", "TEL;CELL:555 3",
    "EMAIL;TYPE=INTERNET,WORK:bob@work.example", "ADR;TYPE=home:PO 9;Flat 2;Main 1;Town;;123;GR",
    "BDAY:--0412", "ANNIVERSARY:20100605T000000Z", "X-EVENT;TYPE=CUSTOM;X-LABEL=a\\;b:--07-01",
    "CATEGORIES:Friends,Work\\,ish", "PHOTO;ENCODING=b;TYPE=JPEG:AAAA", "REV:20261001T120000Z"]))[0]);
  assert.equal(c.version, "4.0");
  assert.equal(c.uid, "urn:uuid:1");
  assert.deepEqual([c.family, c.given], ["Stone", "Bob"]);
  assert.deepEqual(c.phones, [{ v: "+30 690 1", type: "mobile" }, { v: "+30-210-2", type: "work" }, { v: "555 3", type: "mobile" }]);
  assert.deepEqual(c.emails, [{ v: "bob@work.example", type: "work" }]);
  assert.equal(c.addresses[0].street, "PO 9, Flat 2, Main 1", "PO box and extended address are not lost");
  assert.deepEqual(c.events.map((e) => [e.type, e.day, e.year, e.label]),
    [["birthday", "04-12", null, ""], ["anniversary", "06-05", 2010, ""], ["custom", "07-01", null, "a;b"]]);
  assert.deepEqual(c.cats, ["Friends", "Work,ish"]);
  assert.equal(c.rev, Date.UTC(2026, 9, 1, 12));
  assert.equal(c.cut, false);
  assert.ok(!JSON.stringify(c).includes("AAAA"), "PHOTO is never read (CT-NP)");
  // What cannot be kept exactly is said.
  assert.equal(VC.parse(["N:" + "x".repeat(61) + ";;;;"]).cut, true);
  assert.equal(VC.parse(["BDAY:circa 1800"]).cut, true);
  assert.equal(VC.parse(["BDAY:1604-04-12"]).cut, true);
  // Folding at 75 octets, Greek included.
  const long = "NOTE:" + "Σημείωση ".repeat(20);
  for (const l of VC.fold(long)) assert.ok(Buffer.byteLength(l, "utf8") <= 75);
  assert.equal(VC.unfold(VC.fold(long).join("\r\n"))[0], long);
});

test("a contact is written as its own card and reads back as the same contact", () => {
  const text = M.write(item(), null);
  assert.ok(text, "written");
  assert.match(text, /\r\nUID:k1@oros\.contacts\r\n/);
  assert.match(text, /^BEGIN:VCARD\r\nVERSION:3\.0\r\n/);
  const r = M.read(text);
  assert.equal(r.ro, false);
  assert.equal(M.hash(r.main), M.hash(item()));
  assert.equal(M.idFor(r.uid, "x").own, "k1");
  for (const line of text.split("\r\n")) assert.ok(Buffer.byteLength(line, "utf8") <= 75, line);
});

test("the hash ignores id, mtime, spacing and what only orOS keeps; seed labels are one in every language", () => {
  const a = item({ id: "zz", mtime: 99, given: " Anna ", relations: [{ with: "x", type: "friend" }], keep: { n: 2, u: "w" } });
  assert.equal(M.hash(a), M.hash(item()));
  assert.notEqual(M.hash(item({ note: "other" })), M.hash(item()));
  assert.equal(M.hash(item({ cats: ["Εργασία", "book CLUB"] })), M.hash(item()), "Work = Εργασία, names without case");
  assert.equal(CD.seedOf("Arbeit"), "lbl-work");
});

test("DAV-4: a change patches only its own property group; PHOTO, X- lines, Apple groups and N prefixes stay", () => {
  const raw = card(["VERSION:3.0", "PRODID:-//Apple Inc.//iOS//EN", "UID:abc-123", "N:Pappa;Anna;;Dr.;", "FN:Dr. Anna Pappa",
    "ORG:Acme;Books", "item1.TEL;type=CELL;type=pref:+30 691 234 5678", "item1.X-ABLabel:_$!<Mobile>!$_",
    "TEL;TYPE=FAX:210 999", "EMAIL;type=INTERNET;type=HOME:anna@example.com", "X-SOCIALPROFILE;type=x:anna",
    "PHOTO;ENCODING=b;TYPE=JPEG:QUJD", "NOTE:old", "REV:2026-10-01T00:00:00Z"]);
  const r = M.read(raw);
  assert.equal(r.ro, false);
  assert.equal(r.main.org, "Acme");
  assert.equal(r.mtime, Date.UTC(2026, 9, 1));
  // Only the note changes.
  const out = M.write(Object.assign({}, r.main, { note: "new note" }), raw);
  assert.ok(out);
  for (const keep of ["UID:abc-123", "N:Pappa;Anna;;Dr.;", "FN:Dr. Anna Pappa", "ORG:Acme;Books",
    "item1.TEL;type=CELL;type=pref:+30 691 234 5678", "item1.X-ABLabel:_$!<Mobile>!$_", "TEL;TYPE=FAX:210 999",
    "X-SOCIALPROFILE;type=x:anna", "PHOTO;ENCODING=b;TYPE=JPEG:QUJD", "PRODID:-//Apple Inc.//iOS//EN"]) {
    assert.ok(out.includes(keep), keep);
  }
  assert.ok(out.includes("NOTE:new note") && !out.includes("NOTE:old"));
  assert.ok(out.includes("REV:2026-11-01T09:00:00Z") && !out.includes("REV:2026-10-01"));
  // A phone added: the lines still there are kept as they were.
  const p2 = M.write(Object.assign({}, r.main, { phones: r.main.phones.concat([{ v: "699 000", type: "home" }]) }), raw);
  assert.ok(p2.includes("item1.TEL;type=CELL;type=pref:+30 691 234 5678") && p2.includes("TEL;TYPE=FAX:210 999"));
  assert.ok(p2.includes("TEL;TYPE=HOME:699 000"));
  // The name changes: the prefix and the company unit stay.
  const n2 = M.write(Object.assign({}, r.main, { family: "Papa", org: "Acme Ltd" }), raw);
  assert.ok(n2.includes("N:Papa;Anna;;Dr.;") && n2.includes("FN:Anna Papa") && n2.includes("ORG:Acme Ltd;Books"));
  assert.equal(M.hash(M.read(n2).main), M.hash(Object.assign({}, r.main, { family: "Papa", org: "Acme Ltd" })));
  // Unchanged: every line stays (only REV moves).
  const same = M.write(r.main, raw);
  assert.equal(same.replace(/REV:.*\r\n/, ""), raw.replace(/REV:.*\r\n/, ""));
});

test("vCard 4: new lines keep its date and type forms", () => {
  const raw = card(["VERSION:4.0", "UID:urn:uuid:9", "FN:Eva", "N:;Eva;;;", "BDAY:--0412"]);
  const r = M.read(raw);
  const out = M.write(Object.assign({}, r.main, { events: [{ day: "04-12", year: 1990, type: "birthday", label: "" }],
                                                  phones: [{ v: "1", type: "mobile" }] }), raw);
  assert.ok(out.includes("BDAY:19900412") && out.includes("TEL;TYPE=cell:1") && out.includes("VERSION:4.0"));
});

test("read-only and not ours: cut values, several cards, group cards", () => {
  for (const props of [["FN:x", "NOTE:" + "n".repeat(2001)], ["FN:x", "BDAY:sometime"], ["FN:x", "CATEGORIES:" + "c".repeat(41)]]) {
    const r = M.read(card(["VERSION:3.0", "UID:u"].concat(props)));
    assert.equal(r.ro, true, props[1]);
    assert.equal(M.write(Object.assign({}, r.main, { given: "B" }), card(["VERSION:3.0", "UID:u"].concat(props))), null);
  }
  assert.equal(M.read(card(["VERSION:3.0", "UID:u", "FN:A"]) + card(["VERSION:3.0", "UID:v", "FN:B"])).ro, true);
  assert.equal(M.read(card(["VERSION:4.0", "UID:g", "KIND:group", "FN:Team"])), null);
  assert.equal(M.read(card(["VERSION:3.0", "UID:g", "X-ADDRESSBOOKSERVER-KIND:group", "FN:Team"])), null);
});

test("ids, conflict copies and the first-link join", () => {
  const ids = M.idFor("abc@server", "x");
  assert.deepEqual([ids.own, ids.bind], [null, null]);
  assert.match(ids.dav, /^dav-[0-9a-f]{16}$/);
  assert.equal(CD.mapper(COL).idFor("abc@server", "x").dav, ids.dav, "the same on every device");
  const c = M.copy(item());
  assert.notEqual(c.id, "k1");
  assert.equal(c.given, "Anna (conflict)");
  const loc = item({ note: "", emails: [{ v: "Anna@Example.com", type: "home" }], cats: ["Work"] });
  const srv = item({ id: undefined, phones: [{ v: "6912345678", type: "mobile" }, { v: "22", type: "home" }],
                     emails: [{ v: "anna@example.com", type: "home" }, { v: "a2@x.example", type: "work" }],
                     note: "from the server", cats: ["Friends"], family: "Other", starred: false });
  const j = M.merge(loc, srv);
  assert.equal(j.family, "Pappa", "the one here leads on one-value fields");
  assert.deepEqual(j.phones.map((p) => p.v), ["+30 691 234 5678", "210 123 4567", "22"]);
  assert.deepEqual(j.emails.map((e) => e.v), ["Anna@Example.com", "a2@x.example"]);
  assert.equal(j.note, "from the server");
  assert.deepEqual(j.cats, ["Work", "Friends"]);
  assert.equal(j.starred, true);
});
