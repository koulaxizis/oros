// Invoices: PDF import (invoices/pdfin.js). The fixture is the text of a
// Novus / timologisi.online PDF as PDF.js reads it ([x, y, text]), with
// every name, ΑΦΜ and code replaced by made-up ones.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const P = require(path.join(__dirname, "..", "invoices/pdfin.js"));
const C = require(path.join(__dirname, "..", "invoices/core.js"));

const NOVUS = [[117.7, 712.1, "ΕΙΔΟΣ ΠΑΡΑΣΤΑΤΙΚΟΥ"], [490.1, 712.1, "ΗΜ/ΝΙΑ"], [384.0, 712.1, "ΑΡΙΘΜΟΣ"], [327.4, 712.1, "ΣΕΙΡΑ"], [102.4, 663.9, "ΣΤΟΙΧΕΙΑ ΣΥΜΒΑΛΛΟΜΕΝΟΥ"], [384.5, 663.9, "ΣΧΕΤΙΚΑ ΠΑΡΑΣΤΑΤΙΚΑ"], [36.0, 644.9, "ΚΩΔΙΚΟΣ"], [36.0, 630.7, "ΕΠΩΝΥΜΙΑ"], [36.0, 608.1, "ΕΠΑΓΓΕΛΜΑ"], [36.0, 593.9, "ΔΙΕΥΘΥΝΣΗ"], [36.0, 579.7, "ΠΟΛΗ / Τ.Κ."], [36.0, 565.5, "ΤΗΛ / ΕΜΑΙΛ"], [36.0, 551.4, "ΑΦΜ / ΔΟΥ"], [325.1, 610.9, "ΣΚΟΠΟΣ ΔΙΑΚΙΝΗΣΗΣ"], [325.1, 548.5, "ΤΡΟΠΟΣ ΠΛΗΡΩΜΗΣ"], [89.9, 644.9, ":"], [89.9, 630.7, ":"], [89.9, 608.1, ":"], [89.9, 593.9, ":"], [89.9, 579.7, ":"], [89.9, 565.5, ":"], [89.9, 551.4, ":"], [413.0, 562.7, ":"], [38.7, 521.6, "ΚΩΔΙΚΟΣ"], [272.7, 521.6, "ΠΟΣ"], [234.8, 521.6, "ΜΜ"], [131.5, 521.6, "ΠΕΡΙΓΡΑΦΗ"], [319.5, 526.4, "ΤΙΜΗ"], [318.9, 516.8, "ΜΟΝ."], [370.9, 521.6, "ΑΞΙΑ"], [433.5, 528.7, "ΕΚΠΤ."], [416.5, 514.5, "%"], [450.2, 514.5, "ΑΞΙΑ"], [488.8, 526.4, "ΑΞΙΑ ΜΕΤΑ"], [498.7, 516.8, "ΕΚΠΤ."], [542.8, 521.6, "ΦΠΑ"], [396.9, 795.8, "ΠΑΠΑΔΟΠΟΥΛΟΣ ΝΙΚΟΣ"], [403.4, 782.5, "ΥΠΗΡΕΣΙΕΣ ΗΧΟΥ"], [400.0, 773, "ΑΦΜ: 111111111 - ΔΟΥ: Α ΑΘΗΝΩΝ"], [403.5, 763.5, "ΟΔΟΣ 1, ΑΘΗΝΑ 10000, Ελλάδα"], [370.2, 753.9, "ΤΗΛ. 210-0000-000 EMAIL: A@EXAMPLE.COM"], [397.0, 744.4, "WWW.EXAMPLE.COM"], [498.2, 744.4, "ΚΙΝ: 690-0000-000"], [325.1, 625.1, "ΗΜ/ΝΙΑ / ΩΡΑ ΑΠΟΣΤ."], [413.0, 610.9, ":"], [325.1, 562.7, "ΟΧΗΜΑ"], [413.0, 548.5, ":"], [487.9, 693.1, "27/10/2026"], [334.1, 693.1, "ΤΠΥ"], [400.6, 693.1, "149"], [95.5, 632.3, "ΠΕΛΑΤΗΣ ΕΠΕ"], [95.5, 646.5, "7"], [95.5, 609.6, "ΟΡΓΑΝΩΣΗ ΕΚΔΗΛΩΣΕΩΝ"], [95.5, 595.5, "ΠΛΑΤΕΙΑ 2"], [95.5, 581.3, "ΠΕΙΡΑΙΑΣ 18500"], [97.8, 567.1, "210 0000000 - info@example.gr"], [418.7, 548.5, "Επί Πιστώσει"], [117.8, 693.1, "Τιμολόγιο Παροχής Υπηρεσιών"], [413.0, 625.1, ":"], [325.1, 595.3, "ΤΟΠΟΣ ΦΟΡΤΩΣΗΣ"], [413.0, 595.3, ":"], [325.1, 578.3, "ΠΡΟΟΡΙΣΜΟΣ"], [413.0, 578.3, ":"], [95.5, 552.9, "222222222 - ΦΑΕ ΠΕΙΡΑΙΑ"], [420.9, 595.3, ","], [420.9, 578.3, ","], [329.1, 495.8, "850,00"], [285.9, 495.8, "1,00"], [380.1, 495.8, "850,00"], [413.2, 495.8, "0,00"], [451.5, 495.8, "0,00"], [543.1, 495.8, "24,00"], [226.2, 495.8, "Υπηρεσία"], [87.0, 495.8, "Υπηρεσίες ήχου"], [510.5, 495.8, "850,00"], [401.7, 470.2, "ΑΞΙΑ ΠΡΟ ΕΚΠΤ."], [401.7, 456, "ΕΚΠΤΩΣΗ"], [401.7, 441.8, "ΚΑΘΑΡΗ ΑΞΙΑ"], [401.7, 427.6, "ΦΟΡΟΙ"], [401.7, 413.5, "ΦΠΑ"], [401.7, 396.5, "ΤΕΛΙΚΗ ΑΞΙΑ"], [401.7, 369.9, "ΚΡΑΤΗΣΕΙΣ"], [401.7, 341.5, "ΠΛΗΡΩΤΕΟ"], [240.9, 470.2, "ΑΝΑΛΥΣΗ ΦΠΑ"], [167.5, 456, "ΚΑΘΑΡΗ ΑΞΙΑ"], [258.6, 456, "ΦΠΑ %"], [327.1, 456, "ΑΞΙΑ ΦΠΑ"], [201.8, 442.9, "850,00"], [262.8, 442.9, "24,00"], [354.9, 442.9, "204,00"], [33.2, 380.6, "ΠΑΡΑΤΗΡΗΣΕΙΣ:"], [529.9, 441.8, "850,00"], [529.9, 341.5, "884,00"], [529.9, 413.5, "204,00"], [529.9, 369.9, "170,00"], [539.9, 427.6, "0,00"], [522.4, 396.5, "1.054,00"], [539.9, 456, "0,00"], [529.9, 470.2, "850,00"], [221.4, 288.9, "ΥΠΟΣΕΛΙΔΟ"], [401.7, 325.6, "(ΕΥΡ)"], [33.2, 65, "NOVUS CONCEPTUS OE | https://timologisi.online"], [33.2, 52.5, "Σελίδα 1/1"], [306.4, 69.1, "ΕΚΔΟΣΗ"], [393.5, 69.1, "ΠΑΡΑΔΟΣΗ"], [493.1, 69.1, "ΠΑΡΑΛΑΒΗ"], [98.1, 31.7, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA 400000000000001 BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"]];
const items = (rows) => rows.map((r) => ({ x: r[0], y: r[1], s: r[2] }));
const ME = "111111111";
const opts = (o) => Object.assign({ core: C, mine: [ME], days: 30, crm: [], lang: "el", now: 10 }, o || {});
// The same invoice with other words in places (a copy to change)
function variant(fn) { return items(NOVUS.map((r) => fn(r.slice()) || r)); }

test("amounts and dates as Greek invoices print them", () => {
  assert.equal(P.cents("1.054,00"), 105400);
  assert.equal(P.cents("850,00"), 85000);
  assert.equal(P.cents("1,054.00"), 105400);
  assert.ok(Number.isNaN(P.cents("24")));
  assert.equal(P.day("27/10/2026"), "2026-10-27");
  assert.equal(P.day("31/02/2026"), "");
  assert.equal(P.payHow("Επί Πιστώσει"), "");
  assert.equal(P.payHow("Μετρητά"), "cash");
  assert.equal(P.payHow("Κάρτα POS"), "card");
});

test("a Novus PDF: every field", () => {
  const p = P.parse(items(NOVUS));
  assert.equal(p.ok, true);
  assert.equal(p.prov, "novus");
  assert.equal(p.kindText, "Τιμολόγιο Παροχής Υπηρεσιών");
  assert.equal(p.credit, false);
  assert.equal(p.num, "ΤΠΥ 149");
  assert.equal(p.date, "2026-10-27");
  assert.deepEqual(p.issuer, { name: "ΠΑΠΑΔΟΠΟΥΛΟΣ ΝΙΚΟΣ", afm: ME });
  assert.deepEqual(p.party, { name: "ΠΕΛΑΤΗΣ ΕΠΕ", job: "ΟΡΓΑΝΩΣΗ ΕΚΔΗΛΩΣΕΩΝ", addr: "ΠΛΑΤΕΙΑ 2\nΠΕΙΡΑΙΑΣ 18500",
                              afm: "222222222", doy: "ΦΑΕ ΠΕΙΡΑΙΑ", phone: "210 0000000", email: "info@example.gr" });
  assert.equal(p.payText, "Επί Πιστώσει");
  assert.deepEqual(p.lines, [{ d: "Υπηρεσίες ήχου", q: 1, unit: "Υπηρεσία", p: 85000, net: 85000, vat: 24 }]);
  assert.equal(p.net, 85000);
  assert.equal(p.vat, 20400);       // not the "ΦΠΑ" column header
  assert.equal(p.total, 105400);
  assert.equal(p.ded, 17000);
  assert.equal(p.pay, 88400);
  assert.equal(p.mark, "400000000000001");
  assert.equal(p.uid, "A".repeat(40));
  assert.equal(p.auth, "B".repeat(40));
  assert.deepEqual(p.warn, []);
});

test("amounts that do not agree are flagged, nothing else is guessed", () => {
  const p = P.parse(variant((r) => { if (r[2] === "1.054,00") r[2] = "1.064,00"; return r; }));
  assert.ok(p.warn.includes("sum"));
  assert.ok(p.warn.includes("pay"));
  assert.equal(P.parse([]).ok, false);
  assert.equal(P.parse(items([[10, 10, "Hello"]])).ok, false);
  const cred = P.parse(variant((r) => { if (r[2] === "Τιμολόγιο Παροχής Υπηρεσιών") r[2] = "Πιστωτικό Τιμολόγιο"; return r; }));
  assert.equal(cred.credit, true);
});

test("plan: a new record, a new client, payable as the PDF says", () => {
  const p = P.parse(items(NOVUS));
  const [r] = P.plan(C.empty(), [{ name: "a.pdf", p }], opts());
  assert.equal(r.st, "new");
  assert.equal(r.newClient, true);
  assert.equal(r.client.afm, "222222222");
  assert.equal(r.client.email, "info@example.gr");
  const d = r.doc;
  assert.equal(d.kind, "ext");
  assert.equal(d.st, "issued");
  assert.equal(d.num, "ΤΠΥ 149");
  assert.equal(d.due, "2026-11-26");
  assert.equal(d.cli, r.client.id);
  assert.equal(d.mark, "400000000000001");
  assert.equal(d.wht, 20);
  assert.equal(d.mdu, "A".repeat(40));
  assert.match(d.notes, /Υπηρεσίες ήχου: 1 Υπηρεσία × 850,00 \(ΦΠΑ 24%\)/);
  const tt = C.totals(d);
  assert.deepEqual([tt.net, tt.vat, tt.total, tt.wht, tt.pay], [85000, 20400, 105400, 17000, 88400]);
  assert.equal(r.pay, undefined, "on credit: still owed");
  assert.deepEqual(C.normDoc(d), d, "the record is already normalized");
});

test("plan: the same PDF twice is one record (same ids on every device)", () => {
  const p = P.parse(items(NOVUS));
  const a = P.plan(C.empty(), [{ name: "a.pdf", p }], opts())[0];
  const b = P.plan(C.empty(), [{ name: "a.pdf", p }], opts({ now: 99 }))[0];
  assert.equal(a.doc.id, b.doc.id);
  assert.equal(a.client.id, b.client.id);
  const data = C.empty();
  data.docs.push(a.doc);
  data.clients.push(a.client);
  assert.equal(P.plan(data, [{ name: "a.pdf", p }], opts())[0].st, "have");
  // a record typed by hand with the same ΜΑΡΚ counts too
  const hand = C.empty();
  hand.docs.push(C.normDoc({ id: "hand-1", m: 1, kind: "ext", st: "issued", num: "149", date: "2026-10-27", mark: "400000000000001", xnet: 1 }));
  assert.equal(P.plan(hand, [{ name: "a.pdf", p }], opts())[0].st, "have");
  // two PDFs of one new client in one import: one client
  const two = P.plan(C.empty(), [{ name: "a.pdf", p }, { name: "b.pdf", p: P.parse(variant((r) => {
    if (r[2] === "149") r[2] = "150";
    if (/^AAAA/.test(r[2])) r[2] = r[2].replace("400000000000001", "400000000000002");
    return r;
  })) }], opts());
  assert.equal(two[1].st, "new");
  assert.equal(two[1].doc.cli, two[0].doc.cli);
  assert.equal(two[1].client, undefined);
});

test("plan: the client is found by ΑΦΜ, here or in CRM", () => {
  const p = P.parse(items(NOVUS));
  const data = C.empty();
  data.clients.push(C.normClient({ id: "cli-1", m: 1, name: "Πελάτης (μου)", afm: "222222222", crm: "crm-9" }));
  const r = P.plan(data, [{ name: "a.pdf", p }], opts())[0];
  assert.equal(r.newClient, false);
  assert.equal(r.doc.cli, "cli-1");
  assert.equal(r.doc.crm, "crm-9");
  const r2 = P.plan(C.empty(), [{ name: "a.pdf", p }], opts({ crm: [{ id: "crm-7", name: "Άλλο όνομα", afm: "222222222" }] }))[0];
  assert.equal(r2.client.crm, "crm-7");
  assert.equal(r2.doc.crm, "crm-7");
});

test("plan: cash is paid at once, a PDF to you is a received invoice, others are left out", () => {
  const cash = P.parse(variant((r) => { if (r[2] === "Επί Πιστώσει") r[2] = "Μετρητά"; return r; }));
  const r = P.plan(C.empty(), [{ name: "a.pdf", p: cash }], opts())[0];
  assert.equal(r.doc.due, "2026-10-27");
  assert.equal(r.pay.amt, 88400);
  assert.equal(r.pay.how, "cash");
  assert.equal(r.pay.doc, r.doc.id);

  const p = P.parse(items(NOVUS));
  const bill = P.plan(C.empty(), [{ name: "a.pdf", p }], opts({ mine: ["222222222"], crm: [{ id: "crm-3", name: "x", afm: ME }] }))[0];
  assert.equal(bill.st, "bill");
  assert.deepEqual(bill.bill.sup, { name: "ΠΑΠΑΔΟΠΟΥΛΟΣ ΝΙΚΟΣ", afm: ME });
  assert.equal(bill.bill.crm, "crm-3");
  assert.equal(bill.bill.net + bill.bill.vat, 105400);
  assert.equal(bill.bill.due, "2026-11-26");

  assert.equal(P.plan(C.empty(), [{ name: "a.pdf", p }], opts({ mine: ["333333333"] }))[0].st, "other");
  assert.equal(P.plan(C.empty(), [{ name: "a.pdf", p }], opts({ mine: [] }))[0].st, "new", "no ΑΦΜ in Settings: taken as yours");
  assert.equal(P.plan(C.empty(), [{ name: "x.pdf", p: null }], opts())[0].st, "bad");
  const cred = P.parse(variant((r) => { if (r[2] === "Τιμολόγιο Παροχής Υπηρεσιών") r[2] = "Πιστωτικό Τιμολόγιο"; return r; }));
  assert.equal(P.plan(C.empty(), [{ name: "a.pdf", p: cred }], opts())[0].st, "credit");
});

test("text from a file is only data: odd strings stay strings, sizes are capped", () => {
  const p = P.parse(variant((r) => { if (r[2] === "ΠΕΛΑΤΗΣ ΕΠΕ") r[2] = "<img src=x onerror=alert(1)>" + "x".repeat(400); return r; }));
  const r = P.plan(C.empty(), [{ name: "a.pdf", p }], opts())[0];
  assert.equal(typeof r.client.name, "string");
  assert.ok(r.client.name.length <= C.LIM.name);
  assert.equal(P.parse(Array.from({ length: 9000 }, (_, i) => ({ x: i, y: i, s: "a" }))).ok, false);
});
