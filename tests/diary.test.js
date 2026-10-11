// Pure logic of the One-Sentence Diary (diary/core.js): dates, the
// writing day after midnight, the merge (sync slice "diary"), on this
// day, the streak, search, export and import, and the evening
// reminder the shell fires; plus the search provider and the wiring
// of the app and the shell.
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const C = require(path.join(__dirname, "..", "diary/core.js"));
const P = require(path.join(__dirname, "..", "diary/search.js"));
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const T0 = 1760000000000;
const day = (t, e, m) => ({ t, e: e || "", m: m || T0 });
const data = (days, tombs) => ({ ver: 1, days: days || {}, tombs: tombs || {} });
const at = (ymd, h, mi) => { const [y, mo, d] = ymd.split("-").map(Number); return new Date(y, mo - 1, d, h, mi || 0); };

test("dates: real dates only, local calendar, Monday first", () => {
  assert.ok(C.isYmd("2024-02-29"));
  for (const bad of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-1-01", "26-01-01", "", null, 7, "1899-12-31"]) assert.equal(C.isYmd(bad), false, String(bad));
  assert.equal(C.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(C.addDays("2024-03-01", -1), "2024-02-29");
  assert.equal(C.addDays("2026-03-29", 1), "2026-03-30");                 // across a clock change
  assert.equal(C.weekday("2026-10-12"), 0);                               // a Monday
  assert.equal(C.weekday("2026-10-11"), 6);
  assert.equal(C.daysInMonth(2024, 2), 29);
  assert.equal(C.daysInMonth(2026, 2), 28);
  assert.ok(C.isLeap(2000) && !C.isLeap(1900) && C.isLeap(2024) && !C.isLeap(2026));
});

test("writingDay: before 03:00 the line is offered for yesterday", () => {
  assert.deepEqual(C.writingDay(data(), at("2026-10-11", 9)), { day: "2026-10-11", late: false });
  const w = C.writingDay(data(), at("2026-10-11", 1, 30));
  assert.equal(w.day, "2026-10-10");
  assert.ok(w.late && w.today === "2026-10-11" && w.yesterday === "2026-10-10");
  // yesterday already written: today, still late (both choices shown)
  assert.equal(C.writingDay(data({ "2026-10-10": day("x") }), at("2026-10-11", 2, 59)).day, "2026-10-11");
  assert.equal(C.writingDay(data(), at("2026-10-11", 3)).late, false);
});

test("cleanText: one line, 280 characters, emoji kept whole", () => {
  assert.equal(C.cleanText("  a\n b\t\tc  "), "a b c");
  assert.equal(C.cleanText("x\u2028y"), "x y");
  assert.equal(C.cleanText(null), "");
  const long = "😊".repeat(300);
  const cut = C.cleanText(long);
  assert.equal(Array.from(cut).length, 280);
  assert.ok(cut.endsWith("😊"), "no half emoji at the end");
  assert.equal(C.cleanText("α".repeat(281)).length, 280);
});

test("mergeDiary: laws, LWW per day, tombstones", () => {
  const A = data({ "2026-10-01": day("a", "😊", T0), "2026-10-02": day("b", "", T0) });
  const B = data({ "2026-10-01": day("a2", "", T0 + 5), "2026-10-03": day("c", "🎉", T0) }, { "2026-10-02": T0 + 1 });
  const AB = C.mergeDiary(A, B), BA = C.mergeDiary(B, A);
  assert.deepEqual(AB, BA, "commutative");
  assert.deepEqual(C.mergeDiary(AB, AB), AB, "idempotent");
  assert.deepEqual(C.mergeDiary(C.mergeDiary(A, B), A), AB, "absorbs");
  assert.equal(AB.days["2026-10-01"].t, "a2");
  assert.ok(!AB.days["2026-10-02"], "deleted on the other device");
  assert.equal(AB.days["2026-10-03"].e, "🎉");
  assert.deepEqual(Object.keys(AB.days), ["2026-10-01", "2026-10-03"], "sorted");
  // a later write beats an older tombstone
  const C2 = C.mergeDiary(AB, data({ "2026-10-02": day("back", "", T0 + 2) }));
  assert.equal(C2.days["2026-10-02"].t, "back");
  // junk dropped
  const J = C.mergeDiary({ days: { "2026-02-30": day("x"), "2026-10-04": { t: "", m: 1 }, "2026-10-05": { t: "ok", e: "🐍", m: 1 }, x: 1 }, tombs: { bad: 1, "2026-10-06": -1 } }, null);
  assert.deepEqual(J, data({ "2026-10-05": { t: "ok", e: "", m: 1 } }));
  assert.deepEqual(C.mergeDiary(null, undefined), data());
});

test("setDay: write, change, clear (= delete), always newer", () => {
  let d = C.setDay(data(), "2026-10-11", "  Coffee with Anna \n", "😊", T0);
  assert.deepEqual(d.days["2026-10-11"], { t: "Coffee with Anna", e: "😊", m: T0 });
  d = C.setDay(d, "2026-10-11", "Coffee with Anna", "", T0 - 50);          // clock behind
  assert.equal(d.days["2026-10-11"].m, T0 + 1);
  assert.equal(d.days["2026-10-11"].e, "");
  const del = C.setDay(d, "2026-10-11", "   ", "😊", T0 + 2);
  assert.ok(!del.days["2026-10-11"]);
  assert.equal(del.tombs["2026-10-11"], T0 + 2);
  const back = C.setDay(del, "2026-10-11", "again", "", T0);
  assert.ok(back.days["2026-10-11"].m > del.tombs["2026-10-11"]);
  assert.equal(C.setDay(data(), "2026-10-11", "", "", T0).tombs["2026-10-11"], undefined, "no tombstone for nothing");
  const bad = data();
  assert.equal(C.setDay(bad, "nope", "x", "", T0), bad);
});

test("onThisDay: earlier years, newest first, 29 Feb on 28 Feb", () => {
  const d = data({
    "2023-10-11": day("three"), "2025-10-11": day("one", "❤️"), "2024-10-11": day("two"),
    "2026-10-11": day("today"), "2027-10-11": day("later"), "2025-10-12": day("other")
  });
  const o = C.onThisDay(d, "2026-10-11");
  assert.deepEqual(o.map((x) => [x.year, x.ago, x.t]), [[2025, 1, "one"], [2024, 2, "two"], [2023, 3, "three"]]);
  assert.equal(o[0].e, "❤️");
  const leap = data({ "2024-02-29": day("leap"), "2025-02-28": day("plain") });
  assert.deepEqual(C.onThisDay(leap, "2026-02-28").map((x) => x.t), ["plain", "leap"]);
  assert.deepEqual(C.onThisDay(leap, "2028-02-28").map((x) => x.t), ["plain"], "a leap year has its own 29th");
  assert.deepEqual(C.onThisDay(leap, "2028-02-29").map((x) => x.t), ["leap"]);
});

test("streak: current from today or yesterday, longest, total", () => {
  const d = data({ "2026-10-01": day("a"), "2026-10-02": day("b"), "2026-10-03": day("c"), "2026-10-09": day("d"), "2026-10-10": day("e") });
  assert.deepEqual(C.streak(d, "2026-10-11"), { current: 2, longest: 3, total: 5, today: false });
  const d2 = C.setDay(d, "2026-10-11", "f", "", T0);
  assert.deepEqual(C.streak(d2, "2026-10-11"), { current: 3, longest: 3, total: 6, today: true });
  assert.equal(C.streak(d, "2026-10-12").current, 0);
  const year = data({ "2026-12-31": day("x"), "2027-01-01": day("y") });
  assert.equal(C.streak(year, "2027-01-01").current, 2);
  assert.deepEqual(C.streak(data(), "2026-10-11"), { current: 0, longest: 0, total: 0, today: false });
});

test("month, year, years, random", () => {
  const d = data({ "2025-12-31": day("old"), "2026-10-02": day("b"), "2026-10-01": day("a", "😴"), "2026-11-01": day("n") });
  assert.deepEqual(C.monthDays(d, 2026, 10), [{ ymd: "2026-10-01", t: "a", e: "😴" }, { ymd: "2026-10-02", t: "b", e: "" }]);
  assert.deepEqual(C.yearDays(d, 2026).map((x) => x.ymd), ["2026-10-01", "2026-10-02", "2026-11-01"]);
  assert.deepEqual(C.years(d), [2026, 2025]);
  assert.equal(C.randomDay(d, () => 0, "2025-12-31").ymd, "2026-10-01");
  assert.equal(C.randomDay(d, () => 0.999).ymd, "2026-11-01");
  assert.equal(C.randomDay(data({ "2026-10-11": day("x") }), Math.random, "2026-10-11"), null);
});

test("search: every word, no case or accents, Greek final sigma, newest first", () => {
  const d = data({
    "2026-10-01": day("Καφές με την Άννα στο λιμάνι"),
    "2026-10-05": day("Βόλτα στο λιμάνι με τον σκύλο"),
    "2026-09-01": day("Crème brûlée at Café Nero")
  });
  assert.deepEqual(C.search(d, "λιμανι").map((x) => x.ymd), ["2026-10-05", "2026-10-01"]);
  assert.deepEqual(C.search(d, "ΑΝΝΑ λιμάνι").map((x) => x.ymd), ["2026-10-01"]);
  assert.deepEqual(C.search(d, "καφεσ").map((x) => x.ymd), ["2026-10-01"], "ς = σ");
  assert.deepEqual(C.search(d, "creme cafe").map((x) => x.ymd), ["2026-09-01"]);
  assert.deepEqual(C.search(d, "   "), []);
  assert.deepEqual(C.search(d, "zebra"), []);
});

test("export: text, CSV (safe cells), JSON", () => {
  const d = data({ "2026-10-02": day('Said "hi", then left'), "2026-10-01": day("Rain", "😔"), "2026-10-03": day("=SUM(A1)") });
  assert.equal(C.toText(d), "2026-10-01 😔 Rain\n2026-10-02 Said \"hi\", then left\n2026-10-03 =SUM(A1)\n");
  const csv = C.toCSV(d);
  assert.equal(csv, 'date,text,emoji\r\n2026-10-01,Rain,😔\r\n2026-10-02,"Said ""hi"", then left",\r\n2026-10-03,"=SUM(A1)",\r\n');
  const j = JSON.parse(C.toJSON(d));
  assert.equal(j.app, "oros-diary");
  assert.deepEqual(j.days[0], { date: "2026-10-01", text: "Rain", emoji: "😔" });
  assert.equal(C.fileName("csv", "2026-10-11"), "diary-2026-10-11.csv");
});

test("import: our three formats round-trip; other shapes; empty days only", () => {
  const d = data({ "2026-10-01": day("Rain", "😔"), "2026-10-02": day('Said "hi", then left', "❤️"), "2026-10-03": day("=SUM(A1)") });
  const want = [
    { date: "2026-10-01", text: "Rain", emoji: "😔" },
    { date: "2026-10-02", text: 'Said "hi", then left', emoji: "❤️" },
    { date: "2026-10-03", text: "=SUM(A1)", emoji: "" }
  ];
  assert.deepEqual(C.parseImport(C.toText(d)), want, "text");
  assert.deepEqual(C.parseImport("\ufeff" + C.toCSV(d)), want, "csv with BOM");
  assert.deepEqual(C.parseImport(C.toJSON(d)), want, "json");
  // other shapes
  assert.deepEqual(C.parseImport('[{"date":"11/10/2026","text":"dmy"}]'), [{ date: "2026-10-11", text: "dmy", emoji: "" }]);
  assert.deepEqual(C.parseImport('{"2026-10-11":"map","bad":"x","2026-10-12":3}'), [{ date: "2026-10-11", text: "map", emoji: "" }]);
  assert.deepEqual(C.parseImport("date;text\n11.10.2026;semi"), [{ date: "2026-10-11", text: "semi", emoji: "" }]);
  assert.deepEqual(C.parseImport("{broken"), []);
  assert.deepEqual(C.parseImport("hello\nworld"), []);
  assert.deepEqual(C.parseImport("2026-02-30 not a day"), []);
  // into existing data: fills empty days only, the first row for a date wins
  const cur = data({ "2026-10-01": day("mine") }, { "2026-10-03": T0 + 9 });
  const r = C.importInto(cur, want.concat([{ date: "2026-10-02", text: "dup", emoji: "" }]), T0);
  assert.equal(r.added, 2);
  assert.equal(r.kept, 1);
  assert.equal(r.data.days["2026-10-01"].t, "mine");
  assert.equal(r.data.days["2026-10-02"].t, 'Said "hi", then left');
  assert.ok(r.data.days["2026-10-03"].m > T0 + 9, "beats an old deletion");
});

test("reminder: off by default, after its time, only without a line today", () => {
  assert.deepEqual(C.readPrefs(null), { rem: { on: false, h: 21, mi: 30 } });
  assert.deepEqual(C.readPrefs({ rem: { on: true, h: 25, mi: -1 } }), { rem: { on: true, h: 21, mi: 30 } });
  const on = { rem: { on: true, h: 21, mi: 30 } };
  assert.equal(C.reminderDue(data(), null, at("2026-10-11", 22)), null, "off");
  assert.equal(C.reminderDue(data(), on, at("2026-10-11", 21, 29)), null, "too early");
  assert.deepEqual(C.reminderDue(data(), on, at("2026-10-11", 21, 30)), { key: "write-2026-10-11", day: "2026-10-11" });
  assert.equal(C.reminderDue(data({ "2026-10-11": day("done") }), on, at("2026-10-11", 23)), null, "written");
  assert.ok(C.reminderDue(data({ "2026-10-10": day("yesterday") }), on, at("2026-10-11", 23)));
  assert.deepEqual(C.reminderText("en", { current: 1 }), { title: "One-Sentence Diary", body: "One sentence about today?" });
  assert.equal(C.reminderText("el", { current: 4 }).body, "Μία φράση για σήμερα; Σερί 4 ημερών.");
  assert.equal(C.reminderText("el").title, "Ημερολόγιο μιας πρότασης");
});

test("search provider: one hit per day, deleted days skipped, opens the day", () => {
  const store = { "oros-diary-data": data({ "2026-10-01": day("Rain", "😔", 5), "2026-10-02": day("gone", "", 5), "2026-10-03": day("  ") }, { "2026-10-02": 6 }) };
  const hits = P.search({ readJSON: (k) => store[k], lang: "el" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, "2026-10-01");
  assert.equal(hits[0].text, "😔 Rain");
  assert.equal(hits[0].target, "2026-10-01");
  assert.deepEqual(P.search({ readJSON: () => null, lang: "en" }), []);
  const calls = [];
  P.open("2026-10-01", { __orosOpenAt: (...a) => calls.push(a) });
  P.open("junk", { __orosOpenAt: (...a) => calls.push(a) });
  assert.deepEqual(calls, [["diary", { day: "2026-10-01" }], ["diary", null]]);
  assert.deepEqual(P.keys, ["oros-diary-data"]);
});

test("wiring: app, palette, sync, deep link, shell reminder, help", () => {
  const js = read("diary/diary.js"), html = read("diary/index.html");
  assert.ok(js.includes("inheritPalette") && js.includes("watchPalette"));            // guard G3
  assert.ok(js.includes('api.registerSlice("diary", sliceGet, sliceSet, STORAGE_KEY, C.mergeDiary)'));
  assert.ok(js.includes('"oros-diary-data"') && read("diary/core.js").includes('"oros-diary-prefs"'));
  assert.equal((js.match(/window\.__orosOpenAt = /g) || []).length, 1);
  assert.ok(js.includes('__orosTakeTarget("diary")'));
  assert.ok(html.indexOf("core.js") < html.indexOf("diary.js"));
  assert.ok(read("diary/diary.css").includes("@media print"));
  for (const f of ["help.en.txt", "help.el.txt", "search.js"]) assert.ok(fs.existsSync(path.join(__dirname, "..", "diary", f)));
  // no raw line separators in the scripts (they end a regex literal)
  for (const f of ["diary/core.js", "diary/diary.js", "diary/search.js"]) assert.ok(!/[\u2028\u2029\ufeff]/.test(read(f)), f);
  // the shell fires the reminder with the app closed, silent without the core
  const sh = read("shell.js");
  assert.ok(sh.includes('tickSafe("diaryCheckTick", diaryCheckTickThrottled)'));
  const tick = sh.slice(sh.indexOf("function diaryCheckTick()"), sh.indexOf("// ---------- 7. PWA"));
  assert.ok(tick.includes('if (!D || typeof D.reminderDue !== "function") return;'));
  assert.ok(tick.includes('deepLink: "diary:day:" + due.day') && tick.includes('ns: "diary"'));
  assert.ok(read("notifications.js").includes("window.__orosOpenAt('diary', { day: String(ymd) })"));
});
