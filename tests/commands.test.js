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

// ---------- K2: Time, Kanban, Habits, Send, answers, history ----------
const fs = require("fs");
const CC = require(path.join(__dirname, "..", "calculator", "core.js"));
const U = require(path.join(__dirname, "..", "units", "core.js"));
const SC = require(path.join(__dirname, "..", "send", "core.js"));
const APPS2 = APPS.concat(["time", "kanban", "habits", "writer", "calculator", "units"].map((id) => ({
  id, names: { writer: ["Writer", "Κειμενογράφος"], time: ["Time", "Ώρα"] }[id] || [],
})));
const P2 = (s, lang) => C.parse(s, { today: TODAY, apps: APPS2, cal: Q, calc: CC, units: U, send: SC, lang: lang || "en" });
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("K2 timers: duration words in both languages, a label, Time's {timer}", () => {
  const cases = [
    ["χρονόμετρο 10 λεπτά μακαρόνια", 600, "Μακαρόνια"], ["timer 1h30m", 5400, ""],
    ["set a timer for 90 sec", 90, ""], ["pasta 8 min timer", 480, "Pasta"],
    ["βάλε αντίστροφη μέτρηση μισή ώρα", 1800, ""], ["χρονόμετρο 25", 1500, ""],
    ["ξυπνητήρι σε 20 λεπτά", 1200, ""], ["timer 2 hours 15 minutes tea", 8100, "Tea"],
  ];
  for (const [s, sec, label] of cases) {
    const r = P2(s);
    assert.deepEqual([r && r.kind, r && r.data.sec, r && r.data.label], ["timer", sec, label], s);
  }
  assert.deepEqual(C.call(P2("timer 5 min eggs"), "en"),
    { fn: "__orosOpenAt", args: ["time", { timer: { sec: 300, label: "Eggs" } }] });
  assert.equal(C.describe(P2("timer 1h30m"), "en").detail, "1:30:00");
  assert.equal(P2("timer"), null);
  assert.equal(C.call({ kind: "timer", data: { sec: 0 } }), null);
  assert.equal(C.call({ kind: "timer", data: { sec: 1e9 } }), null);
});

test("K2 alarms: a clock time, am/pm, every day → Time's alarm form", () => {
  let r = P2("ξυπνητήρι 7:00");
  assert.deepEqual([r.kind, r.data.at, r.data.daily], ["alarm", "07:00", false]);
  r = P2("wake me at 6:30 pm every day gym");
  assert.deepEqual([r.data.at, r.data.daily, r.data.label], ["18:30", true, "Gym"]);
  r = P2("ξύπνα με στις 7 κάθε μέρα");
  assert.deepEqual([r.data.at, r.data.daily], ["07:00", true]);
  assert.equal(P2("alarm 12 am").data.at, "00:00");
  assert.deepEqual(C.call(P2("alarm 7"), "en"),
    { fn: "__orosOpenAt", args: ["time", { alarm: { at: "07:00", label: "", daily: false } }] });
  assert.equal(P2("alarm 25"), null);
  assert.equal(C.call({ kind: "alarm", data: { at: "7" } }), null);
});

test("K2 Kanban cards and habits", () => {
  let r = P2("κάρτα στο kanban: φτιάξε την πόρτα");
  assert.deepEqual([r.kind, r.data.title], ["card", "Φτιάξε την πόρτα"]);
  assert.equal(P2("add fix door to kanban").data.title, "Fix door");
  assert.deepEqual(C.call(r, "el"), { fn: "__orosOpenAt", args: ["kanban", { asNew: { title: "Φτιάξε την πόρτα" } }] });
  r = P2("συνήθεια διάβασμα έγινε");
  assert.deepEqual([r.kind, r.data.name], ["habit", "διάβασμα"]);
  assert.deepEqual(C.call(P2("habit run done")).args, ["habits", { tick: { name: "run" } }]);
  assert.equal(P2("tick meditation").data.name, "meditation");
  assert.equal(P2("habit run"), null);           // no "done": a search
  r = P2("νέα συνήθεια τρέξιμο");
  assert.deepEqual(C.call(r).args, ["habits", { asNew: { name: "Τρέξιμο" } }]);
});

test("K2 send: text or link to a BR-SEND receiver by its name", () => {
  let r = P2("στείλε γεια σου κόσμε στο κειμενογράφο");
  assert.equal(r, null);                          // not the receiver's name
  r = P2("στείλε γεια σου κόσμε στο writer");
  assert.deepEqual([r.kind, r.app, r.data.kind, r.data.text], ["send", "writer", "text", "γεια σου κόσμε"]);
  assert.deepEqual(C.call(r, "el"), { fn: "__orosOpenAt", args: ["writer", SC.target("writer", "text", { text: "γεια σου κόσμε" }, "Γραμμή εντολών")] });
  r = P2("send https://example.com to notes");
  assert.equal(r.data.kind, "link");
  assert.equal(P2("send hello to maps"), null);   // Maps takes nothing
  assert.equal(C.parse("send x to writer", { apps: APPS2 }), null);   // no send engine: no command
});

test("K2 answers: sums and conversions copy, phones and dates stay searches", () => {
  let r = P2("12*3+4");
  assert.deepEqual([r.kind, r.data.answer], ["calc", "40"]);
  assert.deepEqual(C.call(r), { fn: "copy", args: ["40"] });
  assert.equal(C.describe(r, "el").hint, "Αντιγραφή");
  assert.equal(P2("(3+4)*2").data.answer, "14");
  assert.equal(P2("12 - 3").data.answer, "9");
  assert.equal(P2("2^10").data.answer, "1024");
  for (const s of ["210-1234567", "18/10", "2026", "-5", "15/11"]) assert.equal(P2(s), null, s);
  r = P2("5 μίλια σε χλμ", "el");
  assert.deepEqual([r.kind, r.data.text, r.data.answer], ["convert", "5 mi = 8,04672 km", "8.04672 km"]);
  r = P2("100 usd to eur");
  assert.equal(r, null);                          // no stored rates: no currency answer, and never an expense
  r = C.parse("100 usd to eur", { apps: APPS2, units: U, rates: U.storedRates({ base: "EUR", date: TODAY, at: 1, rates: { USD: 1.25 } }) });
  assert.deepEqual([r.kind, r.data.answer], ["convert", "80 EUR"]);
  assert.equal(P2("12€ καφές").kind, "expense");
  assert.equal(C.parse("12*3", { apps: APPS2 }), null);   // no engine: no answer
});

test("K2 receivers read the targets the bar sends", () => {
  const time = read("time/time.js"), astro = read("time/astro.js");
  assert.match(time, /window\.__orosTimeCmd = function/);
  assert.match(time, /tg\.timer/);
  assert.match(time, /tg\.alarm/);
  assert.match(astro, /__orosTimeCmd/);
  assert.match(astro, /pending\.timer \|\| pending\.alarm/);
  assert.match(read("habits/habits.js"), /t\.tick\) \{ tickByName\(t\.tick\)/);
  assert.match(read("kanban/kanban.js"), /tg\.asNew\) \{ newCardFrom\(tg\.asNew\)/);
  const sh = read("shell.js");
  assert.match(sh, /CMD_HIST_KEY = "oros-cmd-history"/);
  assert.doesNotMatch(read("sync.js"), /oros-cmd-history/);   // device-local, never synced
});
