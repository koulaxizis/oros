// The .oroscontacts file (Contacts): every contact (with its
// interaction log) and label through the shared kit (recordpkg.js)
// and bundle.js; opening adds only what is missing, with its ids. No
// photos and no tombstones in the file; a vCard preview. Plus the app
// wiring (Save, Open, unzipped folder, "Open with" next to .vcf).
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const P = require(path.join(ROOT, "contacts/package.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = Date.now();
const clone = (x) => JSON.parse(JSON.stringify(x));

function person(id, given, family, m, extra) {
  return Object.assign({
    id: id, given: given, middle: "", family: family, nickname: "", org: "", jobTitle: "",
    phones: [], emails: [], addresses: [], websites: [], im: [], events: [], relations: [],
    labelIds: [], starred: false, note: "", avatar: null, mtime: m
  }, extra || {});
}
function slice() {
  return {
    ver: 1,
    labels: [
      { id: "lbl-personal", name: "Personal", color: "#d4af37", mtime: 0 },
      { id: "lbl-climb", name: "Climbing", color: "#7aa2f7", mtime: NOW - 900 }
    ],
    contacts: [
      person("c1", "Maria", "Papadopoulou", NOW - 800, {
        phones: [{ v: "+30 690 000 0001", type: "mobile" }], emails: [{ v: "maria@example.org", type: "work" }],
        addresses: [{ street: "Odos 1", city: "Athens", zip: "10558", region: "", country: "GR", type: "home" }],
        events: [{ day: "03-17", year: 1975, type: "birthday", label: "" }],
        labelIds: ["lbl-climb"], starred: true, note: "line one\nline two; x", avatar: "px:ab12",
        relations: [{ with: "c2", type: "friend" }],
        keep: { n: 2, u: "w" }, seen: "2026-10-01",
        log: [{ id: "lg1", k: "call", d: "2026-10-01", tx: "hi", m: NOW - 800 }],
        fm: { given: NOW - 800, note: NOW - 800 }
      }),
      person("c2", "", "", NOW - 700, { org: "=HYPERLINK(\"x\")", nickname: "" })
    ],
    deleted: [{ id: "c-gone", mtime: NOW - 100 }, { id: "lbl-work", mtime: NOW - 100 }]
  };
}
function device() {
  return {
    ver: 1,
    labels: [{ id: "lbl-personal", name: "Προσωπικά", color: "#d4af37", mtime: 0 }],
    contacts: [person("c-mine", "Nikos", "K", NOW - 50)],
    deleted: []
  };
}

test("contacts: round trip through bundle.js; no tombstones, a vCard preview", async () => {
  const o = K.pack(D, slice(), { title: "Contacts", lang: "en", now: NOW });
  assert.equal(o.mime, "application/x-oros-contacts");
  assert.equal(o.generator, "orOS Contacts");
  assert.deepEqual(Object.keys(o.content.data).sort(), ["contacts", "labels", "ver"]);
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-contacts");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-contacts-package");
  assert.deepEqual(r.content.data.contacts, slice().contacts);
  // preview: vCard 3.0, sorted by name, the avatar seed and labels kept, no PHOTO
  const vcf = o.preview.find((p) => p.name === "contacts.vcf").data;
  assert.equal(o.preview.length, 1);
  assert.match(vcf, /^BEGIN:VCARD\r\nVERSION:3\.0\r\nN:;;;;\r\n/);
  assert.match(vcf, /\r\nBEGIN:VCARD\r\nVERSION:3\.0\r\nN:Papadopoulou;Maria;;;\r\nFN:Maria Papadopoulou\r\n/);
  assert.match(vcf, /\r\nTEL;TYPE=CELL:\+30 690 000 0001\r\n/);
  assert.match(vcf, /\r\nEMAIL;TYPE=WORK:maria@example\.org\r\n/);
  assert.match(vcf, /\r\nADR;TYPE=HOME:;;Odos 1;Athens;;10558;GR\r\n/);
  assert.match(vcf, /\r\nBDAY:1975-03-17\r\n/);
  assert.match(vcf, /\r\nNOTE:line one\\nline two\\; x\r\n/);
  assert.match(vcf, /\r\nCATEGORIES:Climbing\r\n/);
  assert.match(vcf, /\r\nX-OROS-STARRED:TRUE\r\nX-OROS-AVATAR:px:ab12\r\n/);
  assert.match(vcf, /\r\nFN:=HYPERLINK\("x"\)\r\nORG:=HYPERLINK\("x"\)\r\n/);
  assert.doesNotMatch(vcf, /PHOTO/);
  assert.equal(vcf.indexOf("FN:=HYPERLINK") < vcf.indexOf("FN:Maria"), true);   // "=" sorts first
  assert.equal(P.contactToVcard(person("x", "", "", 0), {}, "el")[3], "FN:Χωρίς όνομα");

  // into a device with other data
  const res = K.open(D, device(), r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 3, skipped: 1, updated: 0 });   // lbl-climb, c1, c2 | lbl-personal kept
  assert.deepEqual(res.addedIds.slice().sort(), ["c1", "c2", "lbl-climb"]);
  assert.deepEqual(res.next.contacts.map((c) => c.id), ["c-mine", "c1", "c2"]);
  assert.equal(res.next.labels[0].name, "Προσωπικά");                     // the device's own seed label
  assert.deepEqual(res.next.deleted, []);                                  // the file's tombstones are not taken
  assert.deepEqual(res.next.contacts[1].log, slice().contacts[0].log);
  assert.equal(P.kindOf("c1", res.next), "contact");
  assert.equal(P.kindOf("lbl-climb", res.next), "label");
  assert.equal(P.kindOf("nope", res.next), "");
  // and again: nothing
  const again = K.open(D, res.next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.deepEqual(again.next, res.next);
});

test("contacts: a clash keeps the local contact, a deleted one stays deleted, update takes newer", () => {
  const theirs = slice();
  theirs.contacts[0].note = "changed in the file";
  theirs.contacts[0].mtime = NOW - 10;
  theirs.contacts.push(person("c-gone", "Ghost", "", NOW - 1));
  const mine = slice();
  mine.contacts[0].phones = [{ v: "123", type: "home" }];
  const c = K.pack(D, theirs, { now: NOW }).content;
  const res = K.open(D, mine, c, { now: NOW });
  assert.deepEqual(res.report, { added: 0, skipped: 5, updated: 0 });
  assert.deepEqual(res.next, mine);                                       // nothing changed here
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds, ["c1"]);
  assert.equal(upd.next.contacts[0].note, "changed in the file");
  assert.ok(!upd.next.contacts.some((x) => x.id === "c-gone"));
  assert.deepEqual(upd.next.deleted, mine.deleted);
});

test("contacts: hostile content is cut down (no photos, typed, capped, stamps clamped)", () => {
  const far = NOW + 10 * 365 * 864e5;
  const n = D.norm({
    labels: [{ id: "L1", name: "a\u0000b", color: "red", evil: 1 }, { id: "bad id" }, 4],
    deleted: [{ id: "c1", mtime: 1 }],
    contacts: [
      { id: "c1", given: "Ann\r\nBEGIN:VCARD", family: { x: 1 }, photo: "data:image/png;base64,AAAA", avatar: "data:image/jpeg;base64,AA",
        phones: [{ v: "1", type: "pager" }, { v: "   " }, null, "x"], emails: "x@y",
        events: [{ day: "02-30", type: "birthday" }, { day: "02-29", year: 99999, type: "party" }],
        labelIds: ["L1", "L1", 5, "../x"], relations: [{ with: "c2", type: "enemy" }, { with: "c2", type: "enemy" }, { with: "" }],
        starred: "yes", note: "x".repeat(5000), onclick: "alert(1)", token: "ya29.secret", gid: "people/c1",
        mtime: far, fm: { note: far, evil: 5 }, log: [{ id: "l", k: "hack", d: "2026-01-01", tx: "t", m: far }],
        logDel: { z: far }, keep: { n: 500, u: "w" } },
      { id: "__proto__", given: "x" }, { id: "has space" }, "junk"
    ]
  });
  assert.deepEqual(n.labels, [{ id: "L1", name: "a b", color: P.LABEL_PALETTE[0], mtime: 0 }]);
  assert.equal(n.contacts.length, 1);
  const c = n.contacts[0];
  assert.equal(c.given, "Ann  BEGIN:VCARD");
  assert.equal(c.family, "");
  assert.equal(c.avatar, null);
  ["photo", "onclick", "token", "gid"].forEach((k) => assert.equal(c[k], undefined, k));
  assert.deepEqual(c.phones, [{ v: "1", type: "other" }]);
  assert.deepEqual(c.emails, []);
  assert.deepEqual(c.events, [{ day: "02-29", year: null, type: "custom", label: "" }]);
  assert.deepEqual(c.labelIds, ["L1"]);
  assert.deepEqual(c.relations, [{ with: "c2", type: "other" }]);
  assert.equal(c.starred, false);
  assert.equal(c.note.length, 500);
  assert.equal(c.keep, null);
  assert.equal(c.log[0].k, "note");
  assert.ok(c.log[0].m <= Date.now() + K.FUTURE);
  assert.ok(c.logDel.z <= Date.now() + K.FUTURE);
  assert.deepEqual(Object.keys(c.fm), ["note"]);
  // through open: mtime and fm clamped, the file's tombstone ignored
  const res = K.open(D, device(), { kind: "oros-contacts-package", ver: 1, data: {
    contacts: [{ id: "c9", given: "Z", mtime: far, fm: { given: far }, photo: "data:x" }],
    deleted: [{ id: "c-mine", mtime: far }] } }, { now: NOW });
  const z = res.next.contacts.find((x) => x.id === "c9");
  assert.equal(z.mtime, NOW + K.FUTURE);
  assert.equal(z.fm.given, NOW + K.FUTURE);
  assert.equal(z.photo, undefined);
  assert.ok(res.next.contacts.some((x) => x.id === "c-mine"));
  assert.equal(D.norm("x"), null);
  assert.throws(() => K.open(D, device(), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  // the vCard preview cannot be broken into extra lines or properties
  const v = D.previews({ labels: [], contacts: [c] }, "en")["contacts.vcf"];
  assert.equal(v.split("\r\n").filter((l) => l === "BEGIN:VCARD").length, 1);
  assert.doesNotMatch(v, /PHOTO|data:image/);
});

test("contacts: the package's lists match contacts.js", () => {
  const js = read("contacts/contacts.js");
  const pal = js.match(/var LABEL_PALETTE = \[([^\]]+)\]/)[1].match(/#[0-9a-f]{6}/g);
  assert.deepEqual(pal, P.LABEL_PALETTE);
  const pkg = read("contacts/package.js");
  ["PHONE_TYPES", "EMAIL_TYPES", "ADDR_TYPES", "WEB_TYPES", "IM_TYPES", "EVENT_TYPES"].forEach((k) => {
    const re = new RegExp("var " + k + " += (\\[[^\\]]+\\])");
    assert.equal(pkg.match(re)[1], js.match(re)[1], k);
  });
  assert.equal(pkg.match(/var RELATION_TYPES = (\[[^\]]+\])/)[1].replace(/\s+/g, " "),
               js.match(/var RELATION_TYPES = (\[[^\]]+\])/)[1].replace(/\s+/g, " "));
  assert.match(pkg, /var PX_RE = \/\^px:\[a-z0-9\]\{1,12\}\$\/;/);
});

test("contacts: wiring (scripts, buttons, Open with next to .vcf, strings, help, file types)", () => {
  const html = read("contacts/index.html");
  ["../bundle.js?v=", "../recordpkg.js?v=", "package.js?v=", "contacts.js?v="].forEach((s) =>
    assert.ok(html.includes('src="' + s), s));
  assert.ok(html.indexOf('src="merge.js') < html.indexOf('src="package.js'));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf('src="contacts.js'));
  const js = read("contacts/contacts.js");
  assert.match(js, /RP\.ui\(CPK\.DESC,/);
  ["ct-osave", "ct-oopen", "ct-ofolder"].forEach((id) => assert.ok(js.includes('"' + id + '"'), id));
  assert.match(js, /if \(target && typeof target === "object" && target\.openFile\) \{ if \(recFile\) recFile\.openTarget\(target\.openFile\); return; \}/);
  assert.match(js, /target\.importVcf/);                                  // the .vcf text path stays
  assert.equal((js.match(/window\.__orosOpenAt\s*=/g) || []).length, 1);
  assert.match(js, /__orosTakeTarget\("contacts"\)/);
  assert.match(js, /__orosTakeFile\(/);
  assert.match(js, /"oros\.save": "orOS file \(\.oroscontacts\)"/);
  assert.match(js, /"oros\.save": "Αρχείο orOS \(\.oroscontacts\)"/);
  assert.match(js, /"oros\.folder": "Αποσυμπιεσμένος φάκελος orOS…"/);
  for (const f of ["contacts/help.en.txt", "contacts/help.el.txt"]) assert.ok(read(f).includes(".oroscontacts"), f);
  assert.deepEqual(F.appsFor(".oroscontacts"), ["contacts"]);
  assert.deepEqual(B.TYPES[".oroscontacts"], { app: "contacts", mime: "application/x-oros-contacts" });
});
