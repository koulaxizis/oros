// The .orospet file (Pet Health Book, phase 4b wave 4): every pet and
// health record through the shared kit (recordpkg.js) and bundle.js,
// the records' attachments in media/; opening adds only what is
// missing, with its ids. Tombstones and the device prefs never go in.
// Plus the app wiring (Settings, "Open with", attachments, help).
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const C = require(path.join(ROOT, "petcare/core.js"));
const P = require(path.join(ROOT, "petcare/package.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = Date.now();
const SHA = "a".repeat(64), SHA2 = "b".repeat(64);
const AT1 = "20261001-recvacc01-abcd12.jpg", AT2 = "20261002-recvisit01-zz9999.pdf";
const PH = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";

function pet(id, name, m, extra) {
  return C.normPet(Object.assign({ id: id, m: m, name: name, sp: "dog", breed: "Mixed", sex: "f", neut: 1,
    birth: "2019-05", chip: "123456789012345", vet: { n: "Dr Vet", c: "Clinic", ph: "+30 210 000" },
    food: { n: "Kibble", g: 200, ml: 2, bag: 12000, open: "2026-10-01" }, care: { bath: 30 }, cs: { bath: "2026-09-01" },
    ph: PH, notes: "Good girl" }, extra || {}));
}
function slice() {
  return C.merge({
    ver: 1,
    pets: [pet("petrex001", "Rex", NOW - 9000), pet("petmia001", "=Mia", NOW - 8000, { sp: "cat", ph: "" })],
    recs: [
      { id: "recvacc01", p: "petrex001", k: "vacc", d: "2026-10-01", m: NOW - 7000, n: "Rabies", nx: "2027-10-01", b: "L1", v: "Dr Vet", sc: [AT1], nt: "" },
      { id: "recvisit01", p: "petrex001", k: "visit", d: "2026-10-02", m: NOW - 6000, n: "Check-up", c: 4500, sc: [AT2], nt: "all fine" },
      { id: "recweight1", p: "petmia001", k: "weight", d: "2026-10-03", m: NOW - 5000, g: 4200, nt: "" },
      { id: "recmed0001", p: "petmia001", k: "med", d: "2026-10-04", m: NOW - 4000, n: "Antibiotic", ds: "1 tab", u: "2026-10-10", tm: ["08:00", "20:00"], nt: "" }
    ],
    tombs: { recgone001: NOW - 100 }
  }, null, NOW);
}
function withAts(s) { s.ats = {}; s.ats[AT1] = SHA + ".jpg"; s.ats[AT2] = SHA2 + ".pdf"; return s; }

test("petcare: round trip through bundle.js; no tombstones; attachments as media; previews", async () => {
  const s = withAts(slice());
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const o = K.pack(D, s, { title: "Pet Health Book", lang: "en", now: NOW,
    files: [{ key: SHA + ".jpg", bytes: jpg, type: "image/jpeg" }] });
  assert.equal(o.mime, "application/x-oros-pet");
  assert.deepEqual(Object.keys(o.content.data).sort(), ["ats", "pets", "recs", "ver"]);
  assert.equal(o.content.data.tombs, undefined);
  assert.deepEqual(o.content.data.ats, { [AT1]: SHA + ".jpg", [AT2]: SHA2 + ".pdf" });
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-pet");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-petcare-package");
  assert.deepEqual(r.content.data.pets, s.pets);
  assert.deepEqual(r.content.data.recs, s.recs);
  // the media key follows the real hash of the bytes (bundle.js rekeys)
  const keys = Object.keys(r.media);
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^[0-9a-f]{64}\.jpg$/);
  assert.equal(r.content.data.ats[AT1], keys[0]);
  // previews: Markdown health book, CSV with a formula guard
  const md = o.preview.find((p) => p.name === "pets.md").data;
  assert.match(md, /^# Pet Health Book\n\n## =Mia\n/);
  assert.match(md, /## Rex\n\n### Profile\n\n- Species: Dog\n- Breed: Mixed\n- Sex: Female, neutered\n- Born: 2019-05/);
  assert.match(md, /- 2026-10-02 · Vet visit: Check-up \(1 attachments, cost 45\.00\) · all fine/);
  assert.ok(!md.includes("data:image"));
  const csv = o.preview.find((p) => p.name === "records.csv").data;
  assert.match(csv, /^﻿Pet,Date,Kind,Name,Next \/ until,Details,Cost,Notes\r\n"'=Mia",2026-10-04,Medicine,Antibiotic,2026-10-10,1 tab; 08:00 20:00,,\r\n/);
  const el = K.pack(D, s, { lang: "el", now: NOW }).preview.find((p) => p.name === "pets.md").data;
  assert.match(el, /^# Βιβλιάριο κατοικιδίου/);
  // into a device with one pet of its own
  const mine = C.merge({ ver: 1, pets: [pet("petown001", "Bobby", NOW - 50)], recs: [], tombs: {} }, null, NOW);
  const res = K.open(D, mine, r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 6, skipped: 0, updated: 0 });
  assert.deepEqual(res.next.pets.map((p) => p.id), ["petmia001", "petown001", "petrex001"]);
  assert.equal(res.next.recs.length, 4);
  assert.equal(res.next.ats, undefined);                        // the map never enters the slice
  assert.deepEqual(res.next.recs.find((x) => x.id === "recvacc01").sc, [AT1]);
  assert.equal(res.next.pets.find((p) => p.id === "petrex001").ph, PH);
  // and again: nothing
  const again = K.open(D, res.next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.deepEqual(again.next, res.next);
  assert.equal(P.kindOf("petrex001", res.next), "pet");
  assert.equal(P.kindOf("recmed0001", res.next), "rec");
  assert.equal(P.kindOf("nope", res.next), "");
});

test("petcare: a clash keeps the local copy; deleted here stays deleted; update takes the newer one", () => {
  const theirs = slice();
  theirs.pets[theirs.pets.findIndex((x) => x.id === "petmia001")] = pet("petmia001", "Mia renamed", NOW - 10, { sp: "cat" });
  theirs.recs.find((x) => x.id === "recweight1").g = 9999;
  theirs.recs.find((x) => x.id === "recweight1").m = NOW - 10;
  theirs.recs.push(C.normRec({ id: "recgone001", p: "petrex001", k: "weight", d: "2026-10-05", m: NOW - 1000, g: 30000, nt: "" }));
  theirs.recs.push(C.normRec({ id: "recnew0001", p: "petmia001", k: "care", d: "2026-10-06", m: NOW - 1000, c: "bath", nt: "" }));
  const c = K.pack(D, theirs, { now: NOW }).content;
  const mine = slice();
  const res = K.open(D, mine, c, { now: NOW });
  assert.deepEqual(res.addedIds, ["recnew0001"]);
  assert.equal(res.report.skipped, 6 + 1);                      // 2 pets + 4 records here, 1 deleted here
  assert.equal(res.next.pets.find((p) => p.id === "petmia001").name, "=Mia");
  assert.equal(res.next.recs.find((x) => x.id === "recweight1").g, 4200);
  assert.ok(!res.next.recs.some((x) => x.id === "recgone001"));
  assert.deepEqual(res.next.tombs, mine.tombs);
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds.sort(), ["petmia001", "recweight1"]);
  assert.equal(upd.next.pets.find((p) => p.id === "petmia001").name, "Mia renamed");
  assert.equal(upd.next.recs.find((x) => x.id === "recweight1").g, 9999);
  assert.ok(!upd.next.recs.some((x) => x.id === "recgone001"));
});

test("petcare: forLocal drops the records of a pet deleted here (the kit keeps the pet deleted)", () => {
  const theirs = slice();
  theirs.recs.push(C.normRec({ id: "recnew0001", p: "petrex001", k: "weight", d: "2026-10-06", m: NOW - 1000, g: 30000, nt: "" }));
  theirs.recs.push(C.normRec({ id: "recnew0002", p: "petmia001", k: "weight", d: "2026-10-06", m: NOW - 1000, g: 4300, nt: "" }));
  const c = K.pack(D, theirs, { now: NOW }).content;
  const mine = slice();
  mine.tombs.petrex001 = NOW;                                   // Rex deleted here
  const here = C.merge(mine, null, NOW);
  assert.ok(!here.pets.some((p) => p.id === "petrex001"));
  const plain = K.open(D, here, c, { now: NOW });
  assert.ok(plain.addedIds.includes("recnew0001"));             // the plain descriptor would count it…
  assert.ok(!plain.next.recs.some((r) => r.id === "recnew0001"));   // …and core.merge drops it
  const res = K.open(P.forLocal(() => here), here, c, { now: NOW });
  assert.deepEqual(res.addedIds, ["recnew0002"]);
  assert.equal(res.report.added, 1);
  assert.ok(res.next.recs.some((r) => r.id === "recnew0002"));
  assert.ok(!res.next.pets.some((p) => p.id === "petrex001"));
});

test("petcare: hostile content is cut down to the slice's shape; stamps are clamped", () => {
  const far = NOW + 1e12;
  const content = { kind: "oros-petcare-package", ver: 1, data: {
    pets: [
      { id: "petevil01", m: far, name: "<img src=x onerror=alert(1)>\u0000", sp: "dragon", sex: "x", vet: { ph: "javascript:alert(1)" },
        ph: "data:text/html;base64,PHNjcmlwdD4=", fm: { name: far }, evil: "<script>", __proto__x: 1 },
      { id: "BAD ID", m: 1, name: "x" }, { id: "petnoname", m: 1, name: "" }, "junk", null
    ],
    recs: [
      { id: "recevil01", p: "petevil01", k: "visit", d: "2026-10-01", m: far, n: "x", c: -5, onclick: "x",
        sc: ["../../etc/passwd", "20261001-recother01-abcd12.jpg", "20261001-recevil01-abcd12.jpg", "20261001-recevil01-abcd12.exe"] },
      { id: "recorphan", p: "petnobody", k: "weight", d: "2026-10-01", m: 1, g: 5 },
      { id: "recbadkind", p: "petevil01", k: "shell", d: "2026-10-01", m: 1 },
      { id: "recbaddate", p: "petevil01", k: "weight", d: "tomorrow", m: 1, g: 5 }
    ],
    ats: { "20261001-recevil01-abcd12.jpg": SHA + ".pdf", "20261001-recother01-abcd12.jpg": SHA + ".jpg", "x": "y" },
    tombs: { petown001: NOW }
  } };
  const mine = C.merge({ ver: 1, pets: [pet("petown001", "Bobby", NOW - 50)], recs: [], tombs: {} }, null, NOW);
  const res = K.open(D, mine, content, { now: NOW });
  assert.deepEqual(res.report, { added: 2, skipped: 0, updated: 0 });
  const p = res.next.pets.find((x) => x.id === "petevil01");
  assert.equal(p.name, "<img src=x onerror=alert(1)>");         // text only (rendered with textContent)
  assert.equal(p.sp, "other");
  assert.equal(p.sex, "");
  assert.equal(p.vet.ph, "(1)");                               // digits and + ( ) - only (a tel: link)
  assert.equal(p.ph, "");
  assert.equal(p.evil, undefined);
  assert.ok(p.m <= Date.now() + K.FUTURE);
  assert.ok(p.fm.name <= p.m);
  const r = res.next.recs.find((x) => x.id === "recevil01");
  assert.ok(r.m <= Date.now() + K.FUTURE);
  assert.equal(r.c, 0);
  assert.equal(r.onclick, undefined);
  assert.deepEqual(r.sc, ["20261001-recevil01-abcd12.jpg"]);  // only its own, well-formed names
  assert.ok(!res.next.recs.some((x) => /orphan|badkind|baddate/.test(x.id)));
  assert.ok(res.next.pets.some((x) => x.id === "petown001"));   // a file's tombstone deletes nothing
  // the attachments map: only names a record keeps, of the same type
  const n = D.norm(content.data);
  assert.deepEqual(n.ats, undefined);
  assert.deepEqual(P.normAts({ "20261001-recevil01-abcd12.jpg": SHA + ".jpg" }, n.recs), { "20261001-recevil01-abcd12.jpg": SHA + ".jpg" });
  assert.equal(D.norm("x"), null);
  assert.throws(() => K.open(D, mine, { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  assert.throws(() => K.open(D, mine, { kind: "oros-petcare-package", ver: 9, data: {} }), /newer/);
  assert.equal(P.csvCell("+cmd"), "\"'+cmd\"");
  assert.equal(P.csvCell("@x"), "\"'@x\"");
});

test("petcare: wiring (scripts, Settings, Open with, attachments, Undo, help, file types)", () => {
  const html = read("petcare/index.html");
  ["core.js", "../bundle.js?v=2.52.00", "../recordpkg.js?v=2.52.00", "package.js?v=2.52.00", "petcare.js?v=2.52.00"].forEach((s) =>
    assert.ok(html.includes('src="' + s), s));
  assert.ok(html.indexOf("core.js") < html.indexOf("package.js"));
  assert.ok(html.indexOf("package.js") < html.indexOf('src="petcare.js'));
  const js = read("petcare/petcare.js");
  assert.match(js, /RP\.ui\(PPK\.forLocal\(function \(\) \{ return data; \}\),/);
  ["pc-osave", "pc-oopen", "pc-ofolder"].forEach((id) => assert.ok(js.includes('"' + id + '"'), id));
  assert.match(js, /if \(t && t\.openFile\) \{ if \(recFile\) recFile\.openTarget\(t\.openFile\); return; \}/);
  assert.match(js, /window\.__orosOpenAt = openSearchTarget;/);
  assert.match(js, /__orosTakeTarget\("petcare"\)/);
  assert.match(js, /__orosTakeFile\(/);
  assert.match(js, /encodeAttachment\(file\)/);                // attachments from a file: the attach checks
  assert.match(js, /data\.tombs\[p\.id\] = Math\.max\(now, p\.m\)/);   // Undo tombstones (sync carries it)
  assert.equal((js.match(/window\.__orosOpenAt =/g) || []).length, 1);
  ["\"set.osave\": \"orOS file (.orospet)\"", "\"set.oopen\": \"Open orOS file…\"", "\"set.ofolder\": \"Unzipped orOS folder…\"",
   "\"set.osave\": \"Αρχείο orOS (.orospet)\"", "\"set.oopen\": \"Άνοιγμα αρχείου orOS…\"", "\"set.ofolder\": \"Αποσυμπιεσμένος φάκελος orOS…\""]
    .forEach((s) => assert.ok(js.includes(s), s));
  for (const f of ["petcare/help.en.txt", "petcare/help.el.txt"]) assert.ok(read(f).includes(".orospet"), f);
  assert.deepEqual(F.appsFor(".orospet"), ["petcare"]);
  assert.deepEqual(B.TYPES[".orospet"], { app: "petcare", mime: "application/x-oros-pet" });
});
