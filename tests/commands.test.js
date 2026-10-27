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

test("K3 the Android widgets' command button opens the bar", () => {
  const ph = read("phone.js"), w = read("android/app/src/main/java/online/useoros/twa/Widgets.java");
  assert.match(ph, /cmd: \["", null\]/);
  assert.match(ph, /root\.__orosOpenCmdBar\(\)/);
  assert.match(read("shell.js"), /window\.__orosOpenCmdBar = function \(\) \{ openCmdBar\(\); \}/);
  assert.match(w, /R\.id\.w_cmd, open\(c, "cmd"\)/);
  for (const l of ["widget_quick", "widget_today"]) {
    assert.match(read("android/app/src/main/res/layout/" + l + ".xml"), /@\+id\/w_cmd"[^>]*contentDescription="@string\/widget_cmd"/);
  }
  assert.match(read("android/app/src/main/res/values/strings.xml"), /name="widget_cmd">Command bar</);
  assert.match(read("android/app/src/main/res/values-el/strings.xml"), /name="widget_cmd">Γραμμή εντολών</);
});

// K4: answers about dates and clocks (no engine, no network).
const NOW = Date.UTC(2026, 9, 27, 15, 16);   // Tue 27/10/2026 15:16 UTC, Athens +2 (winter time)
const PD = (s) => C.parse(s, { today: "2026-10-27", apps: APPS2, now: NOW, offset: 120 });
const copy = (s, lang) => { const c = C.call(PD(s), lang || "en"); return c && c.fn === "copy" ? c.args[0] : null; };

test("dates: offsets from today, EN and EL", () => {
  assert.deepEqual(PD("σε 45 μέρες").data, { q: "add", date: "2026-12-11", n: 45, unit: "d" });
  assert.equal(copy("σε 45 μέρες"), "11/12/2026");
  assert.equal(copy("in 3 weeks"), "17/11/2026");
  assert.equal(copy("45 μέρες από σήμερα"), "11/12/2026");
  assert.equal(copy("30 days ago"), "27/9/2026");
  assert.equal(copy("πριν από 2 χρόνια"), "27/10/2024");
  assert.equal(copy("today + 100"), "4/2/2027");
  assert.equal(copy("σήμερα - 1"), "26/10/2026");
  assert.equal(copy("σε 4 μήνες"), "27/2/2027");
  // A month on from the 31st ends on the last day of a short month.
  const jan31 = C.parse("in 1 month", { today: "2027-01-31", apps: APPS2 });
  assert.equal(jan31.data.date, "2027-02-28");
  assert.equal(C.parse("σε 1 μήνα", { today: "2028-01-31", apps: APPS2 }).data.date, "2028-02-29");
  assert.deepEqual(C.describe(PD("σε 45 μέρες"), "el"), { verb: "Παρ 11/12/2026", detail: "σε 45 μέρες", hint: "Αντιγραφή" });
  assert.deepEqual(C.describe(PD("30 days ago"), "en"), { verb: "Sun 27/9/2026", detail: "30 days ago", hint: "Copy" });
  assert.equal(C.describe(PD("in 1 week"), "en").detail, "in 1 week");
  assert.equal(PD("σε 0 μέρες"), null);
});

test("dates: days until, since and between", () => {
  assert.equal(copy("μέρες ως 25/12"), "59");
  assert.equal(copy("πόσες μέρες μέχρι τα Χριστούγεννα"), "59");
  assert.equal(copy("days until christmas"), "59");
  assert.equal(copy("μέρες ως 25 Δεκεμβρίου"), "59");
  assert.equal(copy("days until dec 25 2027"), "424");
  assert.equal(copy("πόσο μένει για την Πρωτοχρονιά"), "66");
  // A day without a year that has passed: next year's (until), this year's (since).
  assert.equal(PD("days until 1/3").data.date, "2027-03-01");
  assert.equal(PD("μέρες από 1/3").data.date, "2026-03-01");
  assert.equal(copy("days since 1/3/2020"), "2431");
  assert.equal(copy("μέρες από 1/3 ως 15/4"), "45");
  assert.equal(copy("days between 20/12 and 5/1"), "16");
  assert.equal(PD("days until 29/2").data.date, "2028-02-29");
  assert.deepEqual(C.describe(PD("μέρες ως 25/12"), "el"), { verb: "59 μέρες", detail: "ως Παρ 25/12/2026", hint: "Αντιγραφή" });
  assert.equal(C.describe(PD("days until tomorrow"), "en").verb, "1 day");
  assert.equal(PD("μέρες ως 31/2"), null);
  assert.equal(PD("days until someday"), null);
});

test("dates: weekday and ISO week", () => {
  assert.equal(copy("τι μέρα είναι 25/12", "el"), "Παρασκευή");
  assert.equal(copy("τι μέρα έπεσε 28/10/1940", "el"), "Δευτέρα");
  assert.equal(copy("what day is 1/1/2030"), "Tuesday");
  assert.equal(copy("ποια εβδομάδα"), "44");
  assert.equal(copy("week number 2027-01-01"), "53");
  assert.equal(copy("week number 2026-01-01"), "1");
  assert.deepEqual(C.describe(PD("ποια εβδομάδα"), "el"), { verb: "Εβδομάδα 44", detail: "Δευ 26/10 – Κυρ 1/11", hint: "Αντιγραφή" });
});

test("clock: the time in a place, with the difference from here", () => {
  let r = PD("ώρα στη Νέα Υόρκη");
  assert.deepEqual([r.kind, r.app, r.data.zone, r.data.at, r.data.diff], ["clock", "time", "America/New_York", "11:16", -360]);
  assert.equal(copy("ώρα στη Νέα Υόρκη"), "11:16");
  assert.deepEqual(C.describe(r, "el"), { verb: "11:16", detail: "Νέα Υόρκη · 6 ώρες πίσω", hint: "Αντιγραφή" });
  assert.deepEqual(C.describe(PD("time in tokyo"), "en"), { verb: "00:16", detail: "Tokyo · 7 h ahead · Wed 28/10", hint: "Copy" });
  assert.equal(C.describe(PD("ώρα στο Δελχί"), "el").detail, "Νέο Δελχί · 3,5 ώρες μπροστά");
  assert.equal(C.describe(PD("τι ώρα είναι στην Αθήνα"), "en").detail, "Athens · same time as here");
  assert.equal(C.describe(PD("ώρα στις Βρυξέλλες"), "el").detail, "Βρυξέλλες · 1 ώρα πίσω");
  assert.equal(PD("london time").data.zone, "Europe/London");
  assert.equal(PD("time in atlantis"), null);
  assert.equal(PD("dinner time"), null);
});

test("dates and clocks leave other commands alone", () => {
  assert.equal(PD("timer 10 min").kind, "timer");
  assert.equal(PD("ξυπνητήρι σε 10 λεπτά").kind, "timer");
  assert.equal(PD("12*3+4"), null);   // no calc engine given here
  assert.equal(P("ραντεβού αύριο 10 οδοντίατρος").kind, "event");
});

// K5: settings by words (theme, lock, notifications, quiet hours).
test("settings by words: EN and EL, the lock only when it is on", () => {
  const APPS3 = APPS2.concat([{ id: "settings", names: ["Settings"] }]);
  const PS = (s, lockOn) => C.parse(s, { today: TODAY, apps: APPS3, lockOn: lockOn === true });
  assert.equal(C.parse("σκοτεινό θέμα", { today: TODAY, apps: APPS2 }), null);   // Settings missing: no setting
  const dd = (s, lockOn) => { const r = PS(s, lockOn); return r ? [r.kind, r.data.name, r.data.value] : null; };
  assert.deepEqual(dd("σκοτεινό θέμα"), ["setting", "theme", "dark"]);
  assert.deepEqual(dd("Dark mode"), ["setting", "theme", "dark"]);
  assert.deepEqual(dd("φωτεινό θέμα"), ["setting", "theme", "light"]);
  assert.deepEqual(dd("use light theme"), ["setting", "theme", "light"]);
  assert.deepEqual(dd("μην ενοχλείτε"), ["setting", "notifs", false]);
  assert.deepEqual(dd("do not disturb"), ["setting", "notifs", false]);
  assert.deepEqual(dd("ειδοποιήσεις on"), ["setting", "notifs", true]);
  assert.deepEqual(dd("ώρες ησυχίας on"), ["setting", "quiet", true]);
  assert.deepEqual(dd("quiet hours off"), ["setting", "quiet", false]);
  assert.deepEqual(dd("κλείδωμα", true), ["setting", "lock", true]);
  assert.equal(PS("κλείδωμα"), null);          // no screen lock set up: a search
  assert.equal(PS("dark chocolate"), null);
  assert.deepEqual(C.call(PS("σκοτεινό θέμα"), "el"), { fn: "setting", args: ["theme", "dark"] });
  assert.equal(C.call({ kind: "setting", data: { name: "theme", value: "blue" } }, "en"), null);
  assert.equal(C.call({ kind: "setting", data: { name: "wipe", value: true } }, "en"), null);
  assert.deepEqual(C.describe(PS("μην ενοχλείτε"), "el"),
    { verb: "Ειδοποιήσεις κλειστές", detail: "Δεν εμφανίζεται ούτε κρατιέται τίποτα μέχρι να τις ανοίξεις ξανά" });
  assert.equal(C.describe(PS("lock", true), "en").verb, "Lock orOS now");
});
