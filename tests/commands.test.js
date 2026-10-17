// Command bar (commands/core.js): plain words in English and Greek →
// one bridge call; everything else stays a search (null).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "commands", "core.js"));
const Q = require(path.join(__dirname, "..", "calendar", "quickadd.js"));
const TODAY = "2026-10-17";   // a Saturday
const APPS = ["calendar", "todo", "budget", "notes", "water", "maps"].map((id) => ({
  id, names: { maps: ["Maps", "Χάρτες"], budget: ["Budget", "Προϋπολογισμός"] }[id] || [],
}));
const P = (s, apps) => C.parse(s, { today: TODAY, apps: apps || APPS, cal: Q });

test("events: explicit word or a day with a time, EN and EL", () => {
  let r = P("ραντεβού αύριο 10 οδοντίατρος");
  assert.equal(r.kind, "event");
  assert.deepEqual([r.data.date, r.data.start, r.data.title], ["2026-10-18", "10:00", "Ραντεβού οδοντίατρος"]);
  r = P("αύριο 10 οδοντίατρος");
  assert.deepEqual([r.kind, r.data.start, r.data.title], ["event", "10:00", "Οδοντίατρος"]);
  r = P("dentist fri 9:30");
  assert.deepEqual([r.data.date, r.data.start, r.data.title], ["2026-10-23", "09:30", "Dentist"]);
  r = P("Coffee with Nikos Thursday 6pm at Syntagma");
  assert.deepEqual([r.data.start, r.data.location], ["18:00", "Syntagma"]);
  r = P("συνάντηση με Γιώργο Τρίτη 18:00");
  assert.deepEqual([r.data.date, r.data.start], ["2026-10-20", "18:00"]);
  assert.deepEqual(C.call(r, "el"), { fn: "__orosOpenCalendarNew",
    args: [{ date: "2026-10-20", title: "Συνάντηση με Γιώργο", start: "18:00" }] });
});

test("shopping list and To-Do", () => {
  let r = P("γάλα στη λίστα");
  assert.deepEqual([r.kind, r.data.list, r.data.items], ["todo", "tdl-groceries", [{ text: "Γάλα" }]]);
  assert.deepEqual(P("γάλα, ψωμί και αυγά στη λίστα").data.items.map((i) => i.text), ["Γάλα", "Ψωμί", "Αυγά"]);
  assert.deepEqual(P("buy milk, eggs").data.items.map((i) => i.text), ["Milk", "Eggs"]);
  assert.deepEqual(P("add bread to the shopping list").data.items.map((i) => i.text), ["Bread"]);
  r = P("θυμήσου να πάρω τη μάνα");
  assert.deepEqual([r.data.list, r.data.items[0].text], ["", "Πάρω τη μάνα"]);
  const c = C.call(r, "el");
  assert.equal(c.fn, "__orosOpenAt");
  assert.equal(c.args[0], "todo");
  assert.deepEqual(c.args[1].addItems.items, [{ text: "Πάρω τη μάνα", note: "" }]);
  assert.equal("list" in c.args[1].addItems, false);
  assert.equal(C.call(P("buy milk"), "en").args[1].addItems.list, "tdl-groceries");
});

test("money: expense and income, cents, category, yesterday", () => {
  let r = P("ξόδεψα 12€ καφές");
  assert.deepEqual([r.kind, r.data.cents, r.data.cat, r.data.note, r.data.date], ["expense", 1200, "o-eat", "Καφές", TODAY]);
  r = P("ξόδεψα 12,50 ευρώ στο σούπερ χθες");
  assert.deepEqual([r.data.cents, r.data.cat, r.data.date], [1250, "o-groc", "2026-10-16"]);
  r = P("spent 30 on fuel");
  assert.deepEqual([r.data.cents, r.data.cat, r.data.note], [3000, "o-trans", "Fuel"]);
  r = P("πήρα 500 μισθό");
  assert.deepEqual([r.kind, r.data.cents, r.data.cat], ["income", 50000, "i-salary"]);
  r = P("12€ καφές");
  assert.deepEqual([r.kind, r.data.cents], ["expense", 1200]);
  assert.deepEqual(C.call(P("ξόδεψα 12€ καφές"), "el"), { fn: "__orosOpenBudgetNew",
    args: [{ k: "o", a: 1200, src: "command", d: TODAY, n: "Καφές", c: "o-eat" }] });
  // The shell's BR-B1 guard accepts it.
  const b = C.call(P("got 500 salary"), "en").args[0];
  assert.match(b.c, /^[a-z0-9-]{1,64}$/);
  assert.match(b.src, /^[a-z0-9]{1,20}$/);
  assert.equal(Math.floor(b.a), b.a);
});

test("note, water, open", () => {
  let r = P("σημείωση: κωδικός wifi 1234");
  assert.deepEqual([r.kind, r.data.title, r.data.text], ["note", "Κωδικός wifi 1234", "κωδικός wifi 1234"]);
  assert.deepEqual(C.call(r, "el"), { fn: "__orosOpenAt", args: ["notes", { add: { title: "Κωδικός wifi 1234", text: "κωδικός wifi 1234" } }] });
  assert.equal(P("ένα ποτήρι νερό").kind, "water");
  assert.deepEqual(C.call(P("a glass of water"), "en"), { fn: "__orosOpenAt", args: ["water", { sip: "glass" }] });
  assert.deepEqual(C.call(P("άνοιξε χάρτες"), "el"), { fn: "openAppById", args: ["maps"] });
  assert.equal(P("open budget").data.id, "budget");
  assert.equal(P("open nothing-like-this"), null);
});

test("plain searches stay searches", () => {
  for (const s of ["notes", "Monday", "12€", "καφές", "χρονόμετρο 25", "", "   ", "budget", "Νίκος", "2026", "15/11"]) {
    assert.equal(P(s), null, s);
  }
  assert.equal(P("x".repeat(400)), null);
  assert.equal(C.parse(null), null);
});

test("an app that is not installed gives no command", () => {
  const noBudget = APPS.filter((a) => a.id !== "budget");
  assert.equal(P("ξόδεψα 12€ καφές", noBudget), null);
  assert.equal(P("γάλα στη λίστα", APPS.filter((a) => a.id !== "todo")), null);
});

test("call rebuilds from data and refuses junk", () => {
  assert.equal(C.call(null), null);
  assert.equal(C.call({ kind: "expense", data: { cents: -5 } }), null);
  assert.equal(C.call({ kind: "expense", data: { cents: 1.5 } }), null);
  assert.equal(C.call({ kind: "event", data: { date: "tomorrow", title: "x" } }), null);
  assert.equal(C.call({ kind: "open", data: { id: "../x" } }), null);
  assert.equal(C.call({ kind: "todo", data: { items: [] } }), null);
  assert.equal(C.call({ kind: "nope", data: {} }), null);
  const e = C.call({ kind: "expense", data: { cents: 100, cat: "<b>", note: "x" } }, "en").args[0];
  assert.equal("c" in e, false);
});

test("describe: both languages, every kind", () => {
  for (const s of ["ραντεβού αύριο 10 οδοντίατρος", "γάλα στη λίστα", "todo x", "ξόδεψα 12€ καφές",
                   "πήρα 500 μισθό", "note x", "water", "open maps"]) {
    const r = P(s);
    for (const lg of ["en", "el"]) {
      const d = C.describe(r, lg);
      assert.ok(d.verb, s + " " + lg);
    }
  }
  assert.equal(C.describe(P("ξόδεψα 12,5€ καφές"), "el").detail.indexOf("12,50 €"), 0);
  assert.equal(C.describe(P("dentist fri 9:30"), "en").detail, "Fri 23/10 · 09:30 · Dentist");
});
