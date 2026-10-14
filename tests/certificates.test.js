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
  ["certificates/core.js", "certificates/dk.js", "certificates/certificates.js", "certificates/search.js", "certificates/help.el.txt", "atelier/zip.js"]
    .forEach((f) => assert.ok(sw.includes('"' + f + '"'), "precache " + f));
});
