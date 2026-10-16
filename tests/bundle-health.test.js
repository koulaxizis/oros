// The .oroshealth file (Health, phase 4b wave 4): every reading, kind,
// medicine, dose, refill, symptom and medical-record row through the
// shared kit (recordpkg.js) and bundle.js, the documents' photos and
// PDFs in media/; opening adds only what is missing, with its ids.
// Tombstones, snoozes and reminders never go in; settings and the
// Medical ID of the device stay. Plus the app wiring (settings,
// "Open with", help).
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const C = require(path.join(ROOT, "health/core.js"));
const P = require(path.join(ROOT, "health/package.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = 1800000000000;
const at = (d, h, m) => new Date(2026, 9, d, h, m || 0).getTime();   // October 2026, local

const SHA = "a".repeat(64), SHA2 = "b".repeat(64);
const DOC_JPG = "20261008-doc001-abcd.jpg", DOC_PDF = "20261008-doc001-efgh.pdf";
function slice() {
  return C.merge({
    ver: 1,
    en: [
      { id: "e1", m: NOW - 900, t: "bp", at: at(8, 7, 30), v: [128, 82, 70], a: 1, p: 1, n: "after coffee", g: ["home"] },
      { id: "e2", m: NOW - 890, t: "wt", at: at(8, 7, 35), v: [78400] },
      { id: "e3", m: NOW - 880, t: "cpeak", at: at(9, 8, 0), v: [-5000], n: "=HYPERLINK(\"x\")" }
    ],
    ty: [{ id: "bp", m: NOW - 1000, lo: 90, hi: 135, r: [480, 1200] },
         { id: "cpeak", m: NOW - 1000, n: "Peak flow", u: "L/min", dc: 1, r: [540] }],
    md: [{ id: "med1", m: NOW - 800, n: "Metformin", s: "500 mg", f: "tab", q: 100, k: "d", tm: [480, 1200],
           sd: "2026-10-01", rm: 1, sk: -1 }],
    dl: [{ id: C.doseKey("med1", "2026-10-08", 480), m: NOW - 700, md: "med1", d: "2026-10-08", tm: 480, s: "t", ta: at(8, 8, 5), q: 100 },
         { id: C.doseKey("med1", "2026-10-08", 1200), m: NOW - 690, md: "med1", d: "2026-10-08", tm: 1200, s: "z", ta: at(8, 20, 0), zu: at(8, 20, 30) }],
    rf: [{ id: "rf1", m: NOW - 680, md: "med1", at: at(5, 10), a: 3000 }],
    sy: [{ id: "sy1", m: NOW - 670, k: "ha", at: at(9, 14), i: 4, n: "", g: [] }],
    sk: [{ id: "smig", m: NOW - 660, n: "Migraine aura", h: 0 }],
    al: [{ id: "al1", m: NOW - 650, n: "Penicillin", sv: 3, r: "rash" }],
    cn: [{ id: "cn1", m: NOW - 640, n: "Asthma", sd: "2010-01-01" }],
    ec: [{ id: "ec1", m: NOW - 630, n: "Maria", rl: "Sister", ph: "+30 690 000 0000", ci: "" }],
    vx: [{ id: "vx1", m: NOW - 620, n: "Tetanus", d: "2016-10-20", nx: "2026-10-20", rm: 1 }],
    ap: [{ id: "ap1", m: NOW - 610, dr: "Dr A", sp: "Cardiology", pl: "Main St 1", at: at(20, 10), du: 30, rm: 60 }],
    dc: [{ id: "doc001", m: NOW - 600, k: "lab", n: "Blood test", d: "2026-10-08", sc: [DOC_JPG, DOC_PDF] }],
    set: { m: NOW - 2000, h: 1750, wu: "kg", gu: "mgdl", tu: "c", nm: "A. Person", fw: 1 },
    pf: { m: NOW - 2000, nm: "A. Person", bd: "1980-05-01", bt: "O+", od: 1, nt: "", sm: 1 },
    tombs: { "en:gone": NOW - 100, "al:al0": NOW - 100 }
  }, {});
}
function device() {
  // another device: its own reading, a copy of e2, a deleted e1, its own settings and Medical ID
  return C.merge({
    en: [{ id: "mine", m: NOW - 50, t: "hr", at: at(10, 7), v: [60] },
         { id: "e2", m: NOW - 10, t: "wt", at: at(8, 7, 35), v: [80000], n: "my copy" }],
    set: { m: NOW - 5, h: 1600, wu: "lb", gu: "mmol", tu: "f", nm: "", fw: 0 },
    pf: { m: NOW - 5, nm: "Someone", bd: "", bt: "A+", od: 0, nt: "", sm: 1 },
    tombs: { "en:e1": NOW - 20 }
  }, {});
}

test("health: round trip through bundle.js; no tombstones, snoozes or reminders; document files as media", async () => {
  const st = slice();
  st.ats = { [DOC_JPG]: SHA + ".jpg", [DOC_PDF]: SHA2 + ".pdf", "20261008-other1-abcd.jpg": SHA + ".jpg" };
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const pdf = new Uint8Array(Buffer.from("%PDF-1.4 x"));
  const o = K.pack(D, st, { title: "Health", lang: "en", now: NOW,
    files: [{ key: SHA + ".jpg", bytes: jpg }, { key: SHA2 + ".pdf", bytes: pdf }] });
  assert.equal(o.mime, "application/x-oros-health");
  assert.equal(o.generator, "orOS Health");
  const data = o.content.data;
  assert.deepEqual(Object.keys(data).sort(), ["al", "ap", "ats", "cn", "dc", "dl", "ec", "en", "md", "pf", "rf", "set", "sk", "sy", "ty", "ver", "vx"]);
  assert.equal(data.tombs, undefined);
  assert.deepEqual(data.dl.map((x) => x.s), ["t"]);                     // the snooze stays here
  assert.deepEqual(data.ty.map((x) => x.r), [[], []]);                  // reminder times stay here
  assert.equal(data.md[0].rm, 0);
  assert.equal(data.vx[0].rm, 0);
  assert.equal(data.ap[0].rm, -1);
  assert.deepEqual(data.ats, { [DOC_JPG]: SHA + ".jpg", [DOC_PDF]: SHA2 + ".pdf" });
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-health");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-health-package");
  const kj = Object.keys(r.media).find((k) => /\.jpg$/.test(k)), kp = Object.keys(r.media).find((k) => /\.pdf$/.test(k));
  assert.equal(r.content.data.ats[DOC_JPG], kj);
  assert.equal(r.content.data.ats[DOC_PDF], kp);
  // previews: the readings as CSV (formula guard), the record as Markdown
  const csv = o.preview.find((p) => p.name === "readings.csv").data.split("\r\n");
  assert.equal(csv[0], "﻿Date,Time,Measurement,Value,Unit,Diastolic,Pulse,Note,Tags");
  assert.equal(csv[1], "2026-10-08,07:30,Blood pressure,128,mmHg,82,70,after coffee,home");
  assert.equal(csv[2], "2026-10-08,07:35,Weight,78.4,kg,,,,");
  assert.equal(csv[3], "2026-10-09,08:00,Peak flow,'-5,L/min,,,\"'=HYPERLINK(\"\"x\"\")\",");
  const md = o.preview.find((p) => p.name === "health.md").data;
  ["# Health", "not encrypted", "Blood type: O+", "- Penicillin (severe): rash", "- Metformin 500 mg · 08:00, 20:00 · 2026-10-01",
   "- 2016-10-20 Tetanus · next dose 2026-10-20", "- 2026-10-08 Blood test (2 files)"].forEach((s) => assert.ok(md.includes(s), s));

  // into a device with other data
  const mine = device();
  const res = K.open(D, mine, r.content, { now: NOW });
  // e1 deleted here, e2 already here; every other record added (the snooze was never in the file)
  assert.deepEqual(res.report, { added: 14, skipped: 2, updated: 0 });
  assert.ok(res.addedIds.includes("e3") && !res.addedIds.includes("e1") && !res.addedIds.includes("e2"));
  const next = C.merge(res.next, res.next);                     // what health.js's set hook does
  assert.deepEqual(next.en.map((x) => x.id), ["e2", "e3", "mine"]);
  assert.equal(next.en.find((x) => x.id === "e2").n, "my copy");         // a clash keeps the local record
  assert.deepEqual(next.en.find((x) => x.id === "e3"), slice().en.find((x) => x.id === "e3"));
  assert.deepEqual(next.set, mine.set);                                   // settings stay
  assert.deepEqual(next.pf, mine.pf);                                     // so does the Medical ID
  assert.deepEqual(next.tombs, mine.tombs);
  assert.equal(next.md[0].rm, 0);                                         // reminders come in off
  assert.deepEqual(next.dc[0].sc, [DOC_JPG, DOC_PDF]);
  // and again: nothing
  const again = K.open(D, next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.equal(again.report.updated, 0);
  assert.deepEqual(C.merge(again.next, again.next), next);
});

test("health: update takes the newer copy, a deleted one stays deleted, stamps are clamped", () => {
  const theirs = slice();
  theirs.en.find((x) => x.id === "e2").n = "changed later";
  theirs.en.find((x) => x.id === "e2").m = NOW + 365 * 864e5;       // from the future
  const c = K.pack(D, theirs, { now: NOW }).content;
  const mine = device();
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds, ["e2"]);
  const e2 = upd.next.en.find((x) => x.id === "e2");
  assert.equal(e2.n, "changed later");
  assert.equal(e2.m, NOW + K.FUTURE);
  assert.ok(!upd.next.en.some((x) => x.id === "e1"));
  assert.deepEqual(D.tombIds(mine), ["e1"]);
  assert.deepEqual(P.collOf("med1", upd.next), ["md"]);
});

test("health: hostile content is cut down to the slice's shape", () => {
  const n = D.norm({
    en: [{ id: "ok", m: 1, t: "bp", at: 5, v: [80, 120] },                       // diastolic above systolic
         { id: "BAD", m: 1, t: "hr", at: 5, v: [60] },                           // id case
         { id: "e9", m: 1, t: "hr", at: 5, v: [60], n: "a\u0000b", onclick: "x", g: ["<b>", "<b>"] },
         { id: "e9", m: 2, t: "hr", at: 5, v: [70] },                            // duplicate id
         { id: "e10", m: 1, t: "hr", at: 5e15, v: [60] }],                       // past 2100
    ty: [{ id: "zz", m: 1 }, { id: "cx", m: 1, n: "x".repeat(500), u: "<u>", r: [1, 2, 3, 4, 5, 6] }],
    md: [{ id: "m-1", m: 1, n: "X", sd: "2026-01-01" }],                         // id with a dash
    dl: [{ id: "x", m: 1, md: "med1", d: "2026-10-08", tm: 480, s: "t", ta: 5 }], // id is not its slot
    dc: [{ id: "doc002", m: 1, k: "evil", n: "Scan", d: "2026-10-08",
           sc: ["20261008-doc002-abcd.jpg", "20261008-doc001-abcd.jpg", "../../etc/passwd", "20261008-doc002-abcd.exe"] }],
    ats: { "20261008-doc002-abcd.jpg": "c".repeat(64) + ".pdf", "nope.jpg": "d".repeat(64) + ".jpg" },
    pf: { m: 1, nm: "N", bt: "Z+", od: 9 },
    set: { m: 1, wu: "stone", h: 99999 },
    tombs: { "en:a": 1 }, evil: "<script>", __proto__x: 1
  });
  assert.deepEqual(n.en, [{ id: "e9", m: 1, t: "hr", at: 5, v: [60], c: 0, a: 0, p: 0, n: "ab", g: ["<b>"] }]);
  assert.equal(n.ty.length, 1);
  assert.equal(n.ty[0].n.length, C.NAME_LEN);
  assert.equal(n.ty[0].r.length, C.MAX_REM);
  assert.deepEqual(n.md, []);
  assert.deepEqual(n.dl, []);
  assert.deepEqual(n.dc, [{ id: "doc002", m: 1, k: "oth", n: "Scan", d: "2026-10-08", nt: "", sc: ["20261008-doc002-abcd.jpg"] }]);
  assert.equal(n.ats, undefined);                                   // a .jpg name never takes a .pdf key
  assert.equal(n.pf.bt, "");
  assert.equal(n.pf.od, 0);
  assert.equal(n.set.wu, "kg");
  assert.equal(n.set.h, 0);
  assert.equal(n.evil, undefined);
  const s = D.strip(n);
  assert.equal(s.tombs, undefined);
  assert.deepEqual(s.ty[0].r, []);
  assert.equal(D.norm("x"), null);
  assert.throws(() => K.open(D, device(), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  assert.throws(() => K.open(D, device(), { kind: "oros-health-package", ver: 9, data: {} }), /newer/);
  // a file can never make a document point at another document's files
  assert.deepEqual(P.atsOf({ id: "doc001", sc: ["20261008-doc001-abcd.jpg", "20261008-doc0011-abcd.jpg"] }), ["20261008-doc001-abcd.jpg"]);
  // a reminder in a hand-made file stays off
  const file = { kind: "oros-health-package", ver: 1,
    data: { md: [{ id: "med9", m: 5, n: "Y", sd: "2026-01-01", k: "d", tm: [600], rm: 1 }],
            ap: [{ id: "ap9", m: 5, dr: "Dr B", at: 5, rm: 30 }] } };
  const res = K.open(D, device(), file, { now: NOW });
  assert.equal(res.next.md.find((x) => x.id === "med9").rm, 0);
  assert.equal(res.next.ap.find((x) => x.id === "ap9").rm, -1);
});

test("health: the Greek preview uses the Excel layout; an empty Health has no CSV", () => {
  const el = D.previews(D.strip(slice()), "el");
  const csv = el["readings.csv"].split("\r\n");
  assert.equal(csv[0], "﻿Ημερομηνία;Ώρα;Μέτρηση;Τιμή;Μονάδα;Διαστολική;Σφυγμοί;Σημείωση;Ετικέτες");
  assert.equal(csv[2], "2026-10-08;07:35;Βάρος;78,4;kg;;;;");
  assert.ok(el["health.md"].startsWith("# Υγεία"));
  const empty = D.previews(D.strip(C.emptyData()), "en");
  assert.equal(empty["readings.csv"], undefined);
  assert.ok(empty["health.md"].includes("not encrypted"));
});

test("health: wiring (scripts, settings, Open with, document files, Undo, help, file types)", () => {
  const html = read("health/index.html");
  ["../bundle.js?v=2.52.00", "../recordpkg.js?v=2.52.00", "package.js?v=2.52.00", "health.js?v=2.52.00"].forEach((s) =>
    assert.ok(html.includes('src="' + s + '"'), s));
  assert.ok(html.indexOf("core.js") < html.indexOf("package.js"));
  assert.ok(html.indexOf("package.js") < html.indexOf('src="health.js'));
  const js = read("health/health.js");
  assert.match(js, /RP\.ui\(HPK\.DESC,/);
  assert.match(js, /if \(t && t\.openFile\) \{ if \(recFile\) recFile\.openTarget\(t\.openFile\); return; \}/);
  assert.match(js, /window\.__orosOpenAt = openSearchTarget;/);
  assert.equal(js.match(/window\.__orosOpenAt =/g).length, 1);
  assert.match(js, /__orosTakeTarget\("health"\)/);
  assert.match(js, /encodeAttachment\(blob\)/);                 // document files from a file: the attach checks
  assert.match(js, /data\.tombs\[k\] = Math\.max\(now, x\.m, data\.tombs\[k\] \|\| 0\)/);   // Undo through tombstones
  assert.match(js, /data = C\.merge\(next, next\);\s*saveNow\(\);/);                       // the app's save + sync path
  ["\"set.osave\": \"orOS file (.oroshealth)\"", "\"set.osave\": \"Αρχείο orOS (.oroshealth)\"",
   "\"set.oopen\": \"Open orOS file…\"", "\"set.oopen\": \"Άνοιγμα αρχείου orOS…\"",
   "\"set.ofolder\": \"Unzipped orOS folder…\"", "\"set.ofolder\": \"Αποσυμπιεσμένος φάκελος orOS…\""].forEach((s) => assert.ok(js.includes(s), s));
  const en = read("health/help.en.txt"), el = read("health/help.el.txt");
  for (const h of [en, el]) { assert.ok(h.includes(".oroshealth")); assert.ok(/not encrypted|δεν είναι κρυπτογραφημένο/.test(h)); }
  assert.deepEqual(en.match(/^## /gm).length, el.match(/^## /gm).length);
  assert.deepEqual(F.appsFor(".oroshealth"), ["health"]);
  assert.deepEqual(B.TYPES[".oroshealth"], { app: "health", mime: "application/x-oros-health" });
});
