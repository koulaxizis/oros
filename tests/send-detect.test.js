// "Send to an app", wave A3: send/detect.js (days, amounts, phones,
// addresses found on the device) and the receivers it opens: Calendar,
// Budget, Contacts, Maps first when they fit, Invoices and Diary.
// Run: node --test tests/send-detect.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
globalThis.OrosCalQuick = require(path.join(ROOT, "calendar/quickadd.js"));
globalThis.OrosContactsCard = require(path.join(ROOT, "contacts/cardtext.js"));
const D = require(path.join(ROOT, "send/detect.js"));
const C = require(path.join(ROOT, "send/core.js"));
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const ALL = C.SMART.concat(C.ORDER);
const TODAY = "2026-11-04";
const pad = (n) => (n < 10 ? "0" : "") + n;
const today = () => { const t = new Date(); return t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate()); };

test("amounts: euro marks before or after, Greek and English thousands, totals win", () => {
  const a = (s) => { const r = D.amount(s); return r && r.cents; };
  assert.equal(a("Ψωμί 2,50€"), 250);
  assert.equal(a("€ 3"), 300);
  assert.equal(a("Πλήρωσα 1.234,56 ευρώ"), 123456);
  assert.equal(a("Total: EUR 1,234.50"), 123450);
  assert.equal(a("12.50 EUR"), 1250);
  assert.equal(a("Γάλα 1,20 €\nΨωμί 0,90 €\nΣΥΝΟΛΟ 2,10 €"), 210);
  assert.equal(D.amount("Σούπερ μάρκετ\nΣύνολο 23,40 €").note, "Σούπερ μάρκετ");
  // a number without a euro mark is never an amount
  assert.equal(D.amount("Κάλεσε 2101234567 το 2026"), null);
  assert.equal(D.amount("3 μήλα"), null);
  assert.equal(D.amount("0,00 €"), null);
  assert.deepEqual(D.amounts(["Λογότυπο 350 €", "χωρίς ποσό", "Site 1.200,00 €"]),
    [{ text: "Λογότυπο", cents: 35000 }, { text: "Site", cents: 120000 }]);
});

test("days and times through Calendar's quick add; nothing named, no event", () => {
  const e = D.event("Οδοντίατρος 15/11 στις 10:30\nΦέρε τις ακτινογραφίες", TODAY);
  assert.deepEqual([e.date, e.start, e.title], ["2026-11-15", "10:30", "Οδοντίατρος"]);
  const f = D.event("Hi all,\nMeeting Friday 6pm at Syntagma", TODAY);
  assert.deepEqual([f.date, f.start, f.location], ["2026-11-06", "18:00", "Syntagma"]);
  assert.equal(D.event("Καλημέρα σε όλους\nτα λέμε", TODAY), null);
});

test("phones, e-mails and addresses through Contacts' card reader", () => {
  const c = D.card("Νίκος Παπαδόπουλος\nΤηλ. 210 1234567\nnikos@example.gr\nΕρμού 25, 105 63 Αθήνα");
  assert.deepEqual(c.phones, ["210 1234567"]);
  assert.deepEqual(c.emails, ["nikos@example.gr"]);
  assert.equal(D.address("Συνάντηση στην Ερμού 25, 105 63 Αθήνα"), "Ερμού 25, 105 63 Αθήνα");
  assert.equal(D.address("Πατησίων 76, Αθήνα"), "");                  // no postcode, street word or phone
  assert.equal(D.address("Λογότυπο 350 €"), "");                      // an amount is not a street
  assert.equal(D.address("Τηλ 2101234567 έτος 2026"), "");            // a year neither
});

test("without the parsers, nothing is found (never a guess)", () => {
  const q = globalThis.OrosCalQuick, k = globalThis.OrosContactsCard;
  delete globalThis.OrosCalQuick; delete globalThis.OrosContactsCard;
  try {
    assert.equal(D.event("dentist 15/11 10:30", TODAY), null);
    assert.equal(D.card("Τηλ. 210 1234567"), null);
    assert.equal(D.amount("2,50 €").cents, 250);                       // its own reader still works
  } finally { globalThis.OrosCalQuick = q; globalThis.OrosContactsCard = k; }
});

test("the sheet puts the app that fits first, and only when it fits", () => {
  const t = (text, title) => ({ title: title || "", text });
  const apps = (d, self) => C.appsFor("text", d, ALL, self || "notes");
  assert.deepEqual(apps(t("Οδοντίατρος 15/11 στις 10:30")).slice(0, 1), ["calendar"]);
  assert.deepEqual(apps(t("Σούπερ μάρκετ\nΣύνολο 23,40 €")).slice(0, 1), ["budget"]);
  assert.deepEqual(apps(t("Νίκος\nΤηλ. 210 1234567\nΕρμού 25, 105 63 Αθήνα")).slice(0, 2), ["contacts", "maps"]);
  const plain = apps(t("Καλημέρα σε όλους"));
  for (const id of C.SMART.concat(["invoices"])) assert.ok(!plain.includes(id), id);
  assert.ok(plain.includes("diary"));
  // the sender is never offered to itself
  assert.ok(!apps(t("Ψωμί 2,50€"), "budget").includes("budget"));
});

test("targets: Calendar and Budget through the shell's openers, the rest through deep links", () => {
  const ev = C.target("calendar", "text", { title: "Mail", text: "Οδοντίατρος 15/11 στις 10:30\nΦέρε τις ακτινογραφίες" });
  assert.equal(C.via("calendar"), "calendarNew");
  assert.equal(ev.title, "Οδοντίατρος");
  assert.equal(ev.start, "10:30");
  assert.equal(ev.note, "Φέρε τις ακτινογραφίες");
  assert.match(ev.date, /^\d{4}-11-15$/);
  assert.equal(C.via("budget"), "budgetNew");
  assert.deepEqual(C.target("budget", "text", { text: "Σούπερ μάρκετ\nΣύνολο 23,40 €" }),
    { k: "o", a: 2340, n: "Σούπερ μάρκετ", src: "send" });
  assert.deepEqual(C.target("contacts", "text", { text: "Τηλ. 210 1234567" }), { cardText: { text: "Τηλ. 210 1234567" } });
  assert.deepEqual(C.target("maps", "text", { text: "Ερμού 25, 105 63 Αθήνα" }),
    { asNew: { name: "Ερμού 25, 105 63 Αθήνα", query: "Ερμού 25, 105 63 Αθήνα" } });
  assert.deepEqual(C.target("invoices", "items", { title: "Πρόταση", items: ["Λογότυπο 350 €", "Site 1.200,00 €", "Ευχαριστώ"] }),
    { "new": { items: [{ d: "Λογότυπο", q: 1, p: 350 }, { d: "Site", q: 1, p: 1200 }], notes: "Πρόταση" } });
  assert.equal(C.target("invoices", "text", { text: "χωρίς ποσά" }), null);
  assert.deepEqual(C.target("diary", "text", { title: "Σκέψεις", text: "Μια καλή μέρα" }),
    { write: { date: today(), text: "Σκέψεις\n\nΜια καλή μέρα" } });
  assert.equal(C.via("notes"), "");
});

test("the receiving code reads these fields; the shell wires the openers and loads the parsers", () => {
  const cal = src("calendar/calendar.js");
  for (const k of ["p.title", "p.start", "p.end", "p.location", "p.note", "p.dateEnd"]) assert.ok(cal.includes(k), "calendar reads " + k);
  assert.match(src("budget/budget.js"), /window\.__orosBudgetNew = function/);
  const sh = src("shell.js");
  assert.match(sh, /calendarNew: function \(p\) \{ window\.__orosOpenCalendarNew\(p\); \}/);
  assert.match(sh, /budgetNew: function \(p\) \{ return window\.__orosOpenBudgetNew\(p\); \}/);
  assert.match(sh, /load\("send\/detect\.js"\)/);
  assert.match(sh, /load\("calendar\/quickadd\.js"\)/);
  assert.match(sh, /load\("contacts\/cardtext\.js"\)/);
  assert.match(src("send/sheet.js"), /C\.via \? C\.via\(id\)/);
  assert.ok(src("sw.js").includes('"send/detect.js"'));
  assert.doesNotMatch(src("send/detect.js"), /innerHTML|localStorage|sessionStorage|fetch\(|XMLHttpRequest/);
});
