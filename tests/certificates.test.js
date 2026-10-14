// Certificates (certificates/): the data model and its merge (LWW per
// entity, tombstones, people go with their event), fields and the
// [[ optional ]] parts, dates in EN / EL, numbering (list order, never
// reused, numbers given twice found and fixed), list import (paste,
// CSV / TSV, headers in EN / EL, first + last name, no header),
// Contacts / CRM extraction, the register CSV (no formula injection),
// certificate -> designkit (every look, shrink to fit against the real
// Noto metrics, a vector PDF smoke test) and the search provider.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const P = require(path.join(ROOT, "designkit/pdf.js"));
T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});
const ctx = { orosDK: { model: M, text: T } };
vm.createContext(ctx);
["certificates/core.js", "certificates/dk.js"].forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx));
const C = ctx.CertCore, D = ctx.CertDK;
const S = require(path.join(ROOT, "certificates/search.js"));
const j = (x) => JSON.parse(JSON.stringify(x));

function seq(prefix) { let n = 0; return () => (n++ % 36).toString(36); }
function setup(lang) {
  let d = C.empty();
  const ev = C.blankEvent("eaaaaaa1", 1000, lang || "en", "attend", "2026-10-14");
  ev.t = "Digital Marketing"; ev.place = "Athens"; ev.hours = "20"; ev.issuer = "Learning Centre";
  ev.d1 = "2026-10-05"; ev.d2 = "2026-10-07";
  d = C.putEvent(d, ev, 2000).data;
  return { d, ev: C.eventById(d, "eaaaaaa1") };
}
function addPeople(d, names, t0, seed) {
  let i = seed || 0;
  const rand = () => ((i++ * 7919) % 1000) / 1000;
  return C.importPeople(d, "eaaaaaa1", names.map((n) => ({ n })), t0 || 3000, rand).data;
}

test("core: a new event has the kind's texts, a style, today's dates and a prefix", () => {
  const e = C.blankEvent("eabcdef1", 5, "el", "award", "2026-10-14");
  assert.equal(e.sty, "elegant");
  assert.equal(e.txt.head, "ΕΠΑΙΝΟΣ");
  assert.equal(e.idate, "2026-10-14");
  assert.equal(e.pre, "CERT-2026-");
  assert.equal(e.sigs.length, 1);
  // every kind has EN + EL texts with a head and a body
  C.KINDS.forEach((k) => ["en", "el"].forEach((l) => {
    const x = C.kindTexts(l, k);
    assert.ok(x.head && x.body && x.nm.includes("{name}"), k + " " + l);
  }));
});

test("core: normalizers drop junk and keep strings safe", () => {
  assert.equal(C.normEvent({ id: "bad", m: 1 }), null);
  assert.equal(C.normEvent({ id: "eabcdef1" }), null);              // no m
  const e = C.normEvent({ id: "eabcdef1", m: 1, kind: "x", sty: "y", acc: "red", d1: "2026-02-30", t: "a\u0000b\nc",
    sigs: [{ n: "A" }, { n: "B" }, { n: "C" }, { n: "D" }], logo: { a: "../../x.png", w: 1, h: 1 } });
  assert.equal(e.kind, "attend");
  assert.equal(e.sty, "classic");
  assert.equal(e.acc, "#8a6d3b");
  assert.equal(e.d1, "");
  assert.equal(e.t, "a b c");
  assert.equal(e.sigs.length, 3);
  assert.equal(e.logo, null);
  assert.equal(C.normPerson({ id: "pabcdef1", m: 1, e: "eabcdef1", n: "  " }), null);
  const p = C.normPerson({ id: "pabcdef1", m: 1, e: "eabcdef1", n: "Ann", no: 3, iss: "2026-01-01", rv: true, o: 4.7 });
  assert.deepEqual(j(p), { id: "pabcdef1", m: 1, e: "eabcdef1", n: "Ann", no: 3, iss: "2026-01-01", rv: 1, o: 4 });
});

test("merge: LWW per entity, symmetric, idempotent; tombstones win ties, newer edits resurrect", () => {
  const { d, ev } = setup();
  const a = addPeople(d, ["Ann", "Bob"]);
  const b = j(a);
  const ann = C.eventPeople(a, ev.id)[0];
  const A2 = C.putPeople(a, [Object.assign({}, ann, { g: "A+" })], 5000).data;
  const B2 = C.putPeople(b, [Object.assign({}, ann, { g: "B" })], 4000).data;
  const m1 = C.merge(A2, B2), m2 = C.merge(B2, A2);
  assert.deepEqual(m1, m2);
  assert.deepEqual(C.merge(m1, m1), m1);
  assert.equal(C.personById(m1, ann.id).g, "A+");
  // delete on one side, older edit on the other: stays deleted
  const del = C.removePeople(A2, [ann.id], 6000);
  assert.equal(C.personById(C.merge(del, B2), ann.id), null);
  // a newer edit resurrects
  const B3 = C.putPeople(B2, [Object.assign({}, C.personById(B2, ann.id), { g: "late" })], 7000).data;
  assert.equal(C.personById(C.merge(del, B3), ann.id).g, "late");
});

test("merge: deleting an event takes its people with it, on every device", () => {
  const { d, ev } = setup();
  const a = addPeople(d, ["Ann", "Bob"]);
  const gone = C.removeEvent(a, ev.id, 9000);
  assert.equal(gone.evs.length, 0);
  assert.equal(gone.ppl.length, 0);
  // the other device still has them: the merge drops them
  const m = C.merge(gone, a);
  assert.equal(m.evs.length, 0);
  assert.equal(m.ppl.length, 0);
});

test("fields: [[ optional ]] parts, known fields replaced, unknown ones kept", () => {
  const map = { name: "Ann", hours: "", place: "Athens" };
  assert.equal(C.fill("Hi {name}[[ ({hours} h)]][[ in {place}]] {other}", map), "Hi Ann in Athens {other}");
  assert.equal(C.fill("[[no fields]]", map), "no fields");
  const { ev } = setup("el");
  const f = C.fields(ev, { n: "Μαρία", no: 7 });
  assert.equal(f.dates, "5–7 Οκτωβρίου 2026");
  assert.equal(f.date, "14 Οκτωβρίου 2026");
  assert.equal(f.serial, "CERT-2026-0007");
  assert.equal(f.name2, "Μαρία");                 // falls back to the name
  assert.equal(C.fmtRange("2026-09-30", "2026-10-02", "en"), "30 September – 2 October 2026");
  assert.equal(C.fmtRange("2025-12-30", "2026-01-02", "el"), "30 Δεκεμβρίου 2025 – 2 Ιανουαρίου 2026");
  assert.equal(C.fmtRange("", "2026-01-02", "en"), "2 January 2026");
  const body = C.fill(ev.txt.body, f);
  assert.ok(body.includes("«Digital Marketing»") && body.includes("διάρκειας 20 ωρών") && body.includes("(Athens)"), body);
});

test("fields: what the design needs but is empty", () => {
  const { ev } = setup();
  assert.deepEqual(j(C.missing(ev, [])), []);
  const e = Object.assign({}, ev, { t: "", issuer: "" });
  assert.deepEqual(j(C.missing(e, [])), ["title", "issuer"]);
  // a field inside [[ ]] is optional
  const e2 = Object.assign({}, ev, { hours: "", place: "" });
  assert.deepEqual(j(C.missing(e2, [])), []);
});

test("numbers: list order, from the next free number, never reused; twice-given found and fixed", () => {
  const { d, ev } = setup();
  let a = addPeople(d, ["Ann", "Bob", "Cat"]);
  let r = C.issue(a, ev.id, null, 5000, "2026-10-14");
  assert.equal(r.n, 3);
  a = r.data;
  assert.deepEqual(j(C.eventPeople(a, ev.id).map((p) => [p.n, p.no])), [["Ann", 1], ["Bob", 2], ["Cat", 3]]);
  assert.equal(C.eventById(a, ev.id).next, 4);
  // removing Cat does not free number 3
  a = C.removePeople(a, [C.eventPeople(a, ev.id)[2].id], 6000);
  a = addPeople(a, ["Dan"], 7000);
  a = C.issue(a, ev.id, null, 8000, "2026-10-15").data;
  assert.equal(C.eventPeople(a, ev.id).find((p) => p.n === "Dan").no, 4);
  assert.equal(C.issue(a, ev.id, null, 9000, "2026-10-15").n, 0);
  // two devices number different people at the same time
  let x = addPeople(a, ["Eve"], 10000, 50), y = addPeople(a, ["Fay"], 10001, 90);
  x = C.issue(x, ev.id, null, 11000, "2026-10-16").data;
  y = C.issue(y, ev.id, null, 11001, "2026-10-16").data;
  let m = C.merge(x, y);
  assert.deepEqual(j(C.dupNumbers(m, ev.id)), [5]);
  const fay = C.eventPeople(m, ev.id).find((p) => p.n === "Fay");
  m = C.renumber(m, ev.id, fay.id, 12000, "2026-10-16").data;
  assert.deepEqual(j(C.dupNumbers(m, ev.id)), []);
  assert.equal(C.personById(m, fay.id).no, 6);
});

test("import: paste / CSV / TSV, EN + EL headers, first + last name, no header, duplicates skipped", () => {
  let r = C.rowsToPeople(C.parseTable("Name,Email,Grade\nAnn Lee,ann@x.com,A\n\"Smith, Bob\",bad-mail,B\n"));
  assert.equal(r.header, true);
  assert.deepEqual(j(r.people), [{ n: "Ann Lee", n2: "", em: "ann@x.com", g: "A", x: "" }, { n: "Smith, Bob", n2: "", em: "", g: "B", x: "" }]);
  r = C.rowsToPeople(C.parseTable("Όνομα;Επώνυμο;Ηλ. ταχυδρομείο;Βαθμολογία\nΜαρία;Παπά;m@x.gr;9\n"));
  assert.deepEqual(j(r.people[0]), { n: "Μαρία Παπά", n2: "", em: "m@x.gr", g: "9", x: "" });
  r = C.rowsToPeople(C.parseTable("ΟΝΟΜΑΤΕΠΩΝΥΜΟ\tΑιτιατική\nΓιώργος Νικολάου\tΓιώργο Νικολάου\n"));
  assert.equal(r.people[0].n2, "Γιώργο Νικολάου");
  // no header: names, and a column of emails
  r = C.rowsToPeople(C.parseTable("Ann\nBob\tbob@x.com\n"));
  assert.equal(r.header, false);
  assert.deepEqual(j(r.people.map((p) => [p.n, p.em])), [["Ann", ""], ["Bob", "bob@x.com"]]);
  // spreadsheet rows (SheetJS gives arrays, numbers, nulls)
  r = C.rowsToPeople([["Name", "Score"], ["Zoe", 10], [null, null], ["Yan", null]]);
  assert.deepEqual(j(r.people.map((p) => [p.n, p.g])), [["Zoe", "10"], ["Yan", ""]]);
  // duplicates: same folded name + email
  const { d, ev } = setup();
  const one = C.importPeople(d, ev.id, [{ n: "Μαρία Παπά", em: "m@x.gr" }], 3000, Math.random);
  const two = C.importPeople(one.data, ev.id, [{ n: "ΜΑΡΙΑ ΠΑΠΑ", em: "m@x.gr" }, { n: "Μαρία Παπά" }], 4000, Math.random);
  assert.equal(two.added, 1);
  assert.equal(two.dup, 1);
});

test("import: Contacts (labels) and CRM (tags), deleted ones left out", () => {
  const ct = {
    labels: [{ id: "lbl-1", name: "Class A" }],
    contacts: [
      { id: "c1", given: "Ann", family: "Lee", emails: [{ v: "ann@x.com" }], labelIds: ["lbl-1"] },
      { id: "c2", given: "Bob", emails: [{ v: "nope" }] },
      { id: "c3", given: "Gone" }
    ],
    deleted: [{ id: "c3" }]
  };
  assert.deepEqual(j(C.contactsPeople(ct, "").map((p) => [p.n, p.em])), [["Ann Lee", "ann@x.com"], ["Bob", ""]]);
  assert.deepEqual(j(C.contactsPeople(ct, "lbl-1").map((p) => p.n)), ["Ann Lee"]);
  assert.deepEqual(j(C.contactLabels(ct)), [{ id: "lbl-1", name: "Class A" }]);
  const crm = {
    cust: [{ id: "aaaaaa1", m: 5, name: "Acme", email: "a@acme.com", tags: ["tag1"] }, { id: "aaaaaa2", m: 5, name: "Old" }],
    tags: [{ id: "tag1", m: 1, name: "VIP" }],
    tombs: { aaaaaa2: 6 }
  };
  assert.deepEqual(j(C.crmPeople(crm, "").map((p) => p.n)), ["Acme"]);
  assert.deepEqual(j(C.crmPeople(crm, "tag1").map((p) => p.em)), ["a@acme.com"]);
  assert.deepEqual(j(C.crmTags(crm).map((x) => x.name)), ["VIP"]);
});

test("register CSV: header in the app's language, numbers, no formula injection", () => {
  const { d, ev } = setup();
  let a = C.importPeople(d, ev.id, [{ n: "=HYPERLINK(\"x\")", em: "a@x.com" }, { n: "Bob, Jr" }], 3000, Math.random).data;
  a = C.issue(a, ev.id, null, 4000, "2026-10-14").data;
  const csv = C.registerCsv(a, ev.id, "el").replace(/^﻿/, "").split("\r\n");
  assert.ok(csv[0].startsWith("Αριθμός,Ονοματεπώνυμο"));
  assert.ok(csv[1].startsWith("CERT-2026-0001,\"'=HYPERLINK(\"\"x\"\")\""), csv[1]);
  assert.ok(csv[2].startsWith("CERT-2026-0002,\"Bob, Jr\""), csv[2]);
  assert.deepEqual(C.uniqueNames(["a.pdf", "A.pdf", "a.pdf"]), ["a.pdf", "A-2.pdf", "a-3.pdf"]);
  assert.equal(C.fileStem("CERT-0001 Μαρία / Παπά?"), "CERT-0001-Μαρία-Παπά");
});

test("dk: every look builds a valid designkit page per person, normDoc keeps everything", () => {
  const { d, ev } = setup("el");
  const a = C.issue(addPeople(d, ["Ann", "Bob"]), ev.id, null, 5000, "2026-10-14").data;
  const ppl = C.eventPeople(a, ev.id);
  C.STYLES.forEach((s) => ["l", "p"].forEach((o) => {
    const e = Object.assign(C.applyStyle(C.eventById(a, ev.id), s), { orient: o,
      sigs: [{ n: "A", r: "r" }, { n: "B", r: "r" }, { n: "C", r: "r" }] });
    const out = D.build(e, ppl, {});
    assert.equal(out.doc.pages.length, 2, s);
    const again = M.normDoc(j(out.doc));
    assert.equal(again.items.length, out.doc.items.length, s + o);
    assert.equal(again.stories.length, out.doc.stories.length, s + o);
    // every item stays on the page
    out.doc.items.forEach((it) => {
      if (it.t === "line" || it.t === "ell" || it.z <= -50) return;
      assert.ok(it.x >= -1 && it.y >= -1 && it.x + it.w <= out.doc.setup.w + 1 && it.y + it.h <= out.doc.setup.h + 1, s + o + " " + it.t + " " + JSON.stringify([it.x, it.y, it.w, it.h]));
    });
  }));
  // the example page when there is no one yet
  assert.equal(D.build(ev, [], { sample: { n: "X", no: 1 } }).doc.pages.length, 1);
});

test("dk: a long name shrinks to fit its line (real Noto metrics)", () => {
  const { ev } = setup("el");
  const sizeOf = (name) => {
    const out = D.build(ev, [{ id: "pxxxxxx1", n: name }], {});
    const story = out.doc.stories.find((s) => s.paras[0].runs[0] && s.paras[0].runs[0].t === name);
    return out.doc.pstyles.find((p) => p.id === story.paras[0].ps).size;
  };
  const short = sizeOf("Ann Lee");
  const long = sizeOf("Αικατερίνη Κωνσταντινοπούλου-Παπαγεωργοπούλου του Αλεξάνδρου");
  assert.ok(long < short, long + " < " + short);
  assert.ok(long >= short * D.MIN_FIT);
  const L = R.computeLayout(D.build(ev, [{ id: "pxxxxxx1", n: "Αικατερίνη Κωνσταντινοπούλου-Παπαγεωργοπούλου" }], {}).doc);
  Object.keys(L.frames).forEach((k) => assert.ok(!L.frames[k].overset, "overset " + k));
});

test("dk: a vector PDF with one page per person and the Noto fonts", () => {
  const { jsPDF } = require(path.join(ROOT, "vendor/jspdf.umd.min.js"));
  const { d, ev } = setup("el");
  const a = addPeople(d, ["Μαρία Παπαδοπούλου", "Bob"]);
  const out = D.build(C.eventById(a, ev.id), C.eventPeople(a, ev.id), {});
  const pdf = P.build(out.doc, { title: "t" }, { jsPDF });
  assert.equal(pdf.getNumberOfPages(), 2);
  const bytes = pdf.output("arraybuffer");
  assert.ok(bytes.byteLength > 10000);
  assert.ok(/\/BaseFont \/serif-/.test(Buffer.from(bytes).toString("latin1")) && /FontFile2/.test(Buffer.from(bytes).toString("latin1")));
});

test("search: events and people, deleted ones left out, deep link targets", () => {
  const { d, ev } = setup();
  let a = C.issue(addPeople(d, ["Ann", "Bob"]), ev.id, null, 5000, "2026-10-14").data;
  a = C.removePeople(a, [C.eventPeople(a, ev.id)[1].id], 6000);
  const hits = S.search({ lang: "en", readJSON: () => j(a) });
  assert.deepEqual(hits.map((h) => h.title), ["Digital Marketing", "Ann"]);
  assert.deepEqual(hits[1].target, { ev: ev.id, p: C.eventPeople(a, ev.id)[0].id });
  assert.ok(hits[1].text.includes("CERT-2026-0001"));
  assert.deepEqual(S.search({ lang: "en", readJSON: () => null }), []);
});

test("app: every string has a Greek text and the shell knows the app", () => {
  const src = fs.readFileSync(path.join(ROOT, "certificates/certificates.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "certificates/index.html"), "utf8");
  // data-i18n keys used in the page exist in the table
  const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
  keys.forEach((k) => assert.ok(src.includes('"' + k + '":'), "missing string " + k));
  assert.ok(src.includes("inheritPalette") && src.includes("watchPalette"));
  const apps = JSON.parse(fs.readFileSync(path.join(ROOT, "apps.json"), "utf8")).apps;
  const me = apps.find((x) => x.id === "certificates");
  assert.ok(me && me.category === "Business" && me.search === "search.js");
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  ["certificates/core.js", "certificates/dk.js", "certificates/certificates.js", "certificates/search.js", "certificates/badges.js", "certificates/help.el.txt", "atelier/zip.js",
   "certificates/sign.js", "certificates/verify.html"]
    .forEach((f) => assert.ok(sw.includes('"' + f + '"'), "precache " + f));
});

// ---------- wave 2: signed check QR codes ----------
const SG = require(path.join(ROOT, "certificates/sign.js"));
const QE = require(path.join(ROOT, "qr/qr-encode.js"));
const subtle = globalThis.crypto && globalThis.crypto.subtle;
const BASE = "https://useoros.online/certificates/verify.html";

test("sign: compact payload round trip (Greek, other characters, empty fields, limits)", () => {
  const f = { no: "CERT-2026-0007", n: "Μαρία „Παπά“ Ἀ", t: "Ψηφιακό Μάρκετινγκ", dates: "5–7 Οκτωβρίου 2026", issuer: "Κέντρο «Πρόοδος»", idate: "2026-10-14", lang: "el" };
  const b = SG.payload(f);
  assert.equal(b[0], 1);
  // Greek letters take one byte each
  assert.ok(b.length < 120, String(b.length));
  const r = SG.readPayload(b);
  assert.deepEqual(j(r), { no: f.no, n: f.n, t: f.t, dates: f.dates, issuer: f.issuer, idate: f.idate, place: "", hours: "", g: "", lang: "el" });
  // English: trailing empty fields and the language are left out
  const e = SG.readPayload(SG.payload({ no: "", n: "Ann", t: "T", issuer: "I", idate: "2026-01-02" }));
  assert.equal(e.lang, "en");
  assert.equal(e.n, "Ann");
  // long values are cut, control characters dropped
  const long = SG.readPayload(SG.payload({ n: "x".repeat(300) + "\u0007", t: "t", issuer: "i", idate: "" }));
  assert.equal(long.n.length, SG.CAP.n);
  assert.ok(long.n.endsWith("…"));
  assert.equal(SG.readPayload(new Uint8Array([2, 65, 30, 65, 30, 65, 30, 65, 30, 65, 30])), null);
  // compressed public keys come back whole
  assert.equal(SG.decompress(new Uint8Array(33)), null);
});

test("sign: a signed link checks, any change fails, the QR code stays printable", { skip: !subtle }, async () => {
  const k = await SG.makeKey(subtle);
  const f = { no: "CERT-2026-0001", n: "Αικατερίνη Κωνσταντινοπούλου", t: "Ψηφιακό Μάρκετινγκ για Μικρές Επιχειρήσεις", dates: "5–7 Οκτωβρίου 2026", issuer: "Κέντρο Δια Βίου Μάθησης «Πρόοδος»", idate: "2026-10-14", place: "Θεσσαλονίκη", hours: "24", lang: "el" };
  const url = await SG.sign(subtle, k, BASE, f);
  assert.ok(url.startsWith(BASE + "#c1."));
  const x = SG.parseLink(url);
  assert.equal(x.data.n, f.n);
  assert.equal(await SG.verify(subtle, x), true);
  // the restored key is the one that signed
  const raw = new Uint8Array(65); raw[0] = 4; raw.set(SG.unb64u(k.x), 1); raw.set(SG.unb64u(k.y), 33);
  assert.deepEqual([...SG.decompress(SG.compress(raw))], [...raw]);
  // one changed byte in the details, or another key, fails
  const parts = url.split("#")[1].split(".");
  const bytes = SG.unb64u(parts[1]); bytes[5] ^= 1;
  const tampered = SG.parseLink(["c1", SG.b64u(bytes), parts[2], parts[3]].join("."));
  assert.ok(!tampered || !(await SG.verify(subtle, tampered)));
  const other = await SG.makeKey(subtle);
  const forged = SG.parseLink(["c1", parts[1], SG.b64u(SG.pubOf(other)), parts[3]].join("."));
  assert.equal(await SG.verify(subtle, forged), false);
  assert.equal(SG.parseLink("https://x/#c1.AAAA"), null);
  assert.equal(SG.parseLink(""), null);
  // the fingerprint: 4 groups of 4
  assert.match(await SG.fingerprint(subtle, SG.pubOf(k)), /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
  // a long Greek certificate still fits a version 13 code (ECC L)
  assert.ok(QE.encode(url, { ecl: "L" }).version <= 13);
});

test("keys: synced, merged by id, the newest made signs, kept through every edit", () => {
  const A = "A".repeat(43), B = "B".repeat(43);
  let { d, ev } = setup();
  let r = C.putKey(d, { id: "kaaaaaa1", made: 100, x: A, y: A, d: A }, 100);
  assert.ok(r.ok);
  const one = r.data;
  const two = C.putKey(d, { id: "kaaaaaa2", made: 200, x: B, y: B, d: B }, 200).data;
  const m = C.merge(one, two);
  assert.deepEqual(j(m.keys.map((k) => k.id)), ["kaaaaaa1", "kaaaaaa2"]);
  assert.equal(C.activeKey(m).id, "kaaaaaa2");
  assert.deepEqual(j(C.merge(m, C.empty())), j(C.merge(C.empty(), m)));
  // edits keep the keys
  let x = addPeople(m, ["Ann"]);
  x = C.issue(x, ev.id, null, 5000, "2026-10-14").data;
  x = C.putEvent(x, Object.assign({}, C.eventById(x, ev.id), { qr: 1 }), 6000).data;
  assert.equal(x.keys.length, 2);
  assert.equal(C.eventById(x, ev.id).qr, 1);
  // a device without keys does not lose them on merge
  assert.equal(C.merge(C.parse(JSON.stringify({ ver: 1, evs: x.evs, ppl: x.ppl, tombs: x.tombs })), x).keys.length, 2);
  // bad keys are dropped
  assert.equal(C.putKey(d, { id: "kaaaaaa3", x: "short", y: A, d: A }, 1).ok, false);
  // what a code carries
  const p = C.eventPeople(x, ev.id)[0];
  const f = C.checkFields(C.eventById(x, ev.id), p);
  assert.deepEqual([f.no, f.n, f.t, f.issuer, f.idate], ["CERT-2026-0001", "Ann", "Digital Marketing", "Learning Centre", "2026-10-14"]);
  assert.ok(f.dates.includes("2026"));
});

test("dk: the check code gets a white square at the bottom left, the row moves over", () => {
  const { d, ev } = setup("el");
  const a = C.issue(addPeople(d, ["Ann"]), ev.id, null, 5000, "2026-10-14").data;
  const ppl = C.eventPeople(a, ev.id);
  C.STYLES.forEach((s) => ["l", "p"].forEach((o) => [1, 3].forEach((ns) => {
    const e = Object.assign(C.applyStyle(C.eventById(a, ev.id), s), { orient: o, qr: 1,
      sigs: [{ n: "A", r: "r" }, { n: "B", r: "r" }, { n: "C", r: "r" }].slice(0, ns) });
    const out = D.build(e, ppl, {});
    const q = out.pages[0].qr;
    assert.ok(q && q.s > 60, s + o);
    // nothing else is drawn over the square
    out.doc.items.forEach((it) => {
      if (it.z <= -50 || it.t === "line" && it.h === 0 && it.y < q.y) return;
      if (it.t === "rect" && Math.abs(it.x - q.x) < 0.01 && Math.abs(it.y - q.y) < 0.01) return;
      const over = it.x < q.x + q.s && it.x + Math.abs(it.w) > q.x && it.y < q.y + q.s && it.y + Math.abs(it.h) > q.y;
      assert.ok(!over || it.z < 2, s + o + ns + " " + it.t + " " + JSON.stringify([it.x, it.y, it.w, it.h]));
    });
  })));
  assert.equal(D.build(C.eventById(a, ev.id), ppl, {}).pages[0].qr, undefined);
});

test("ids: events, people and keys get their own prefix", () => {
  assert.match(C.newId("k", Math.random), C.K_RE);
  assert.match(C.newId("p", Math.random), C.P_RE);
  assert.match(C.newId("e", Math.random), C.EV_RE);
});

// ---------- wave 3: attendance, sign-in sheet, Open Badges ----------
test("attendance: tick some or everyone, counted per event, kept through normalizing", () => {
  let { d, ev } = setup();
  d = addPeople(d, ["Ann", "Bob", "Cy"]);
  const ppl = C.eventPeople(d, ev.id);
  let r = C.setAttended(d, ev.id, [ppl[0].id, ppl[2].id], true, 5000);
  assert.equal(r.n, 2);
  assert.equal(C.countAttended(r.data, ev.id), 2);
  // ticking again changes nothing
  assert.equal(C.setAttended(r.data, ev.id, [ppl[0].id], true, 5100).n, 0);
  r = C.setAttended(r.data, ev.id, null, true, 6000);
  assert.equal(r.n, 1);
  assert.equal(C.countAttended(r.data, ev.id), 3);
  r = C.setAttended(r.data, ev.id, null, false, 7000);
  assert.equal(C.countAttended(r.data, ev.id), 0);
  assert.equal(C.personById(r.data, ppl[0].id).at, undefined);
  // normalizers: bits only
  assert.equal(C.normEvent(Object.assign({}, ev, { onlyAt: "yes" })).onlyAt, 0);
  assert.equal(C.normEvent(Object.assign({}, ev, { onlyAt: 1 })).onlyAt, 1);
  assert.equal(C.normPerson(Object.assign({}, ppl[1], { at: 1 })).at, 1);
  assert.equal(C.normPerson(Object.assign({}, ppl[1], { at: 7 })).at, undefined);
});

test("attendance: the days of an event, at most 7", () => {
  assert.deepEqual(j(C.eventDays({ d1: "2026-10-05", d2: "2026-10-07" })), ["2026-10-05", "2026-10-06", "2026-10-07"]);
  assert.deepEqual(j(C.eventDays({ d1: "2026-10-30", d2: "2026-11-02" })), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  assert.deepEqual(j(C.eventDays({ d1: "2026-10-05", d2: "" })), ["2026-10-05"]);
  assert.deepEqual(j(C.eventDays({ d1: "2026-10-05", d2: "2026-10-01" })), ["2026-10-05"]);
  assert.deepEqual(j(C.eventDays({ d1: "", d2: "" })), [""]);
  assert.equal(C.eventDays({ d1: "2026-01-01", d2: "2026-03-01" }).length, 7);
});

test("dk: sign-in sheet pages, columns per day, landscape from 4 days", () => {
  const { d, ev } = setup();
  const L = { title: "T", sub: "S", sheet: "Sign-in sheet", no: "#", name: "Name", sign: "Signature", page: "{i}/{n}", day: (x) => "D" + x.slice(8) };
  const people = Array.from({ length: 40 }, (_, i) => ({ n: "Person " + i }));
  const a = D.buildSheet(ev, people, L);
  assert.equal(a.days.length, 3);
  assert.ok(a.doc.setup.h > a.doc.setup.w, "portrait");
  assert.equal(a.doc.pages.length, Math.ceil(45 / a.perPage));
  const txt = (doc) => doc.stories.map((s) => s.paras.map((p) => (p.runs || []).map((r) => r.t).join("")).join("\n"));
  const all = txt(a.doc);
  ["D05", "D06", "D07", "Person 0", "Person 39", "1/" + a.doc.pages.length].forEach((s) => assert.ok(all.includes(s), s));
  const b = D.buildSheet(Object.assign({}, ev, { d2: "2026-10-09" }), people.slice(0, 3), L);
  assert.equal(b.days.length, 5);
  assert.ok(b.doc.setup.w > b.doc.setup.h, "landscape");
  assert.equal(b.doc.pages.length, 1);
  // one day: the column is just "Signature"
  const c = D.buildSheet(Object.assign({}, ev, { d2: "" }), [], L);
  assert.ok(txt(c.doc).includes("Signature"));
});

const BD = require(path.join(ROOT, "certificates/badges.js"));
function b64uDec(s) { return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"); }

test("badges: Open Badges 3.0 VC-JWT, did:jwk issuer, signature checks, stable ids, hashed email", { skip: !subtle }, async () => {
  const k = await SG.makeKey(subtle);
  const f = { kind: "attend", title: "Ψηφιακό Μάρκετινγκ", name: "Μαρία Παπά", email: " Maria@Example.com ", issuer: "Κέντρο", description: "20 ώρες", idate: "2026-10-14", d1: "2026-10-05", d2: "2026-10-07", checkUrl: BASE + "#c1.x", checkName: "Check" };
  const r = await BD.make(subtle, k, f, { evId: "eaaaaaa1", pId: "p1", now: 0 }, () => 0.5);
  const parts = r.jwt.split(".");
  assert.equal(parts.length, 3);
  const head = JSON.parse(b64uDec(parts[0]));
  const body = JSON.parse(b64uDec(parts[1]));
  assert.equal(head.alg, "ES256");
  assert.ok(body.iss.startsWith("did:jwk:"));
  assert.equal(head.kid, body.iss + "#0");
  const jwk = JSON.parse(b64uDec(body.iss.slice(8)));
  assert.deepEqual(jwk, { crv: "P-256", kty: "EC", x: k.x, y: k.y });
  const pub = await subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const ok = await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, b64uDec(parts[2]), Buffer.from(parts[0] + "." + parts[1]));
  assert.ok(ok);
  const vc = body.vc;
  assert.deepEqual(vc.type, ["VerifiableCredential", "OpenBadgeCredential"]);
  assert.equal(vc["@context"][1], BD.CONTEXT[1]);
  assert.equal(vc.credentialSubject.achievement.achievementType, "Certificate");
  assert.equal(vc.credentialSubject.activityStartDate, "2026-10-05T00:00:00Z");
  assert.equal(vc.credentialSubject.activityEndDate, "2026-10-07T23:59:59Z");
  assert.equal(vc.issuanceDate, "2026-10-14T00:00:00Z");
  assert.equal(body.nbf, Date.parse("2026-10-14T00:00:00Z") / 1000);
  assert.equal(body.jti, vc.id);
  assert.match(vc.id, /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(vc.evidence[0].id, f.checkUrl);
  // email: only the salted hash, and it matches the trimmed lower-case address
  const em = vc.credentialSubject.identifier.find((x) => x.identityType === "emailAddress");
  assert.ok(!r.jwt.includes("example.com") && !JSON.stringify(vc).includes("example.com"));
  const h = require("crypto").createHash("sha256").update("maria@example.com" + em.salt).digest("hex");
  assert.equal(em.identityHash, "sha256$" + h);
  // same person, same ids; another person, another credential but the same achievement
  const r2 = await BD.make(subtle, k, f, { evId: "eaaaaaa1", pId: "p1", now: 0 }, () => 0.1);
  const r3 = await BD.make(subtle, k, Object.assign({}, f, { email: "" }), { evId: "eaaaaaa1", pId: "p2", now: 0 });
  assert.equal(r2.cred.id, vc.id);
  assert.notEqual(r3.cred.id, vc.id);
  assert.equal(r3.cred.credentialSubject.achievement.id, vc.credentialSubject.achievement.id);
  assert.equal(r3.cred.credentialSubject.identifier.length, 1);
  assert.equal(BD.credential({ kind: "volunteer", title: "x", name: "y" }, { did: "d", cred: "c", ach: "a", now: 0 }).credentialSubject.achievement.achievementType, "CommunityService");
});

const SD = require(path.join(ROOT, "certificates/send.js"));
const MC = require(path.join(ROOT, "mail/compose.js"));

test("send: pacing within the per-hour limit, at least 2 s apart", () => {
  assert.equal(SD.gapFor(60), 60000);
  assert.equal(SD.gapFor(500), 7200);
  assert.equal(SD.gapFor(100000), 7200);   // capped at 500 an hour
  assert.equal(SD.gapFor(1), 720000);      // at least 5 an hour
  assert.equal(SD.gapFor("x"), 60000);     // default
  assert.ok(SD.gapFor(500) >= SD.MIN_GAP);
});

test("send: one refused address is skipped, anything else stops the queue", () => {
  assert.equal(SD.classify({ code: "rcpt" }), "skip");
  assert.equal(SD.classify({ code: "too-big" }), "skip");
  assert.equal(SD.classify({ code: "rcpt", msg: "550 5.1.1 no such user" }), "skip");
  assert.equal(SD.classify({ code: "rcpt", msg: "450 4.2.1 try again later" }), "stop");
  // an oversized message is skipped before it is sent (the relay would say bad-request)
  assert.equal(SD.checkSize("x".repeat(10)), "x".repeat(10));
  assert.throws(() => SD.checkSize({ length: SD.MAX_RAW + 1, toString() { return "x".repeat(SD.MAX_RAW + 1); } }), (e) => e.code === "too-big" && SD.classify(e) === "skip");
  ["rate", "auth", "no", "timeout", "network", "offline", "nopass", "connect", undefined].forEach((c) => assert.equal(SD.classify({ code: c }), "stop", String(c)));
  assert.ok(SD.isRate({ code: "rate" }));
  assert.ok(SD.isRate({ code: "no", msg: "452 4.5.3 Daily sending quota exceeded" }));
  assert.ok(SD.isRate({ code: "proto", msg: "421 Too many messages" }));
  assert.ok(!SD.isRate({ code: "auth", msg: "535 bad password" }));
});

test("send: one recipient per message, the PDF attached, Greek subject encoded", () => {
  const pdf = "%PDF-1.7\n" + String.fromCharCode(0, 255, 128) + "binary";
  const m = SD.message(MC, { from: { name: "Κέντρο", addr: "info@example.com" }, to: { name: "Μαρία", addr: "maria@example.com" },
    subject: "Το πιστοποιητικό σου: Μάρκετινγκ", text: "Γεια σου Μαρία,\n\nΣυνημμένο.", pdf: { name: "CERT-2026-0001-Μαρία.pdf", bin: pdf } });
  assert.deepEqual(m.rcpt, ["maria@example.com"]);
  assert.match(m.bin, /^To: .*maria@example\.com/m);
  assert.ok(!/^(Cc|Bcc):/m.test(m.bin));
  assert.match(m.bin, /Subject:\s+=\?UTF-8\?B\?/);
  assert.match(m.bin, /Content-Type: application\/pdf/);
  assert.ok(m.bin.includes(Buffer.from(pdf, "latin1").toString("base64").slice(0, 20)));
});

test("send: the sent time is kept per person and synced like every field", () => {
  let { d, ev } = setup();
  d = addPeople(d, ["Ann"]);
  const p = C.eventPeople(d, ev.id)[0];
  assert.equal(C.normPerson(Object.assign({}, p, { ms: 1760000000000 })).ms, 1760000000000);
  assert.equal(C.normPerson(Object.assign({}, p, { ms: "x" })).ms, undefined);
  assert.equal(C.normPerson(Object.assign({}, p, { ms: -5 })).ms, undefined);
});
