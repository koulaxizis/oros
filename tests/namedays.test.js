// Pure logic of the Calendar's name days / holidays / world days
// (calendar/namedays.js) and the shipped calendar/days.json.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const N = require(path.join(__dirname, "..", "calendar/namedays.js"));
const DAYS = require(path.join(__dirname, "..", "calendar/days.json"));

test("Orthodox Easter: known years", () => {
  const known = { 2020: "2020-04-19", 2021: "2021-05-02", 2022: "2022-04-24", 2023: "2023-04-16",
    2024: "2024-05-05", 2025: "2025-04-20", 2026: "2026-04-12", 2027: "2027-05-02",
    2028: "2028-04-16", 2029: "2029-04-08", 2030: "2030-04-28" };
  for (const [y, d] of Object.entries(known)) assert.equal(N.easter(+y), d, y);
  for (let y = 1990; y <= 2099; y++) assert.equal(N.weekday(N.easter(y)), 0, "Sunday " + y);
});

test("holidays: fixed and movable (2026)", () => {
  const ids = (d) => N.holidaysOn(d).map((h) => h.id);
  assert.deepEqual(ids("2026-01-01"), ["newyear"]);
  assert.deepEqual(ids("2026-02-23"), ["cleanmon"]);
  assert.deepEqual(ids("2026-04-10"), ["goodfri"]);
  assert.deepEqual(ids("2026-04-12"), ["easter"]);
  assert.deepEqual(ids("2026-04-13"), ["eastermon"]);
  assert.deepEqual(ids("2026-06-01"), ["whitmon"]);
  assert.deepEqual(ids("2026-10-28"), ["oct28"]);
  assert.deepEqual(ids("2026-10-27"), []);
  assert.deepEqual(N.holidaysOn("bad"), []);
  // Every year: 8 fixed + 5 movable, never on the same day.
  for (const y of [2024, 2025, 2026, 2027, 2030]) {
    let n = 0;
    for (let d = y + "-01-01"; d.startsWith(String(y)); d = N.addDays(d, 1)) n += N.holidaysOn(d).length;
    assert.equal(n, 13, String(y));
  }
});

test("name days: fixed, movable, George and Mark rule", () => {
  assert.ok(N.namesOn("2026-10-26").includes("Δημήτρης"));
  assert.ok(N.namesOn("2026-12-06").includes("Νίκος"));
  assert.ok(N.namesOn("2026-04-12").includes("Αναστασία"));    // Easter
  assert.ok(N.namesOn("2026-04-19").includes("Θωμάς"));        // Easter + 7
  assert.ok(N.namesOn("2026-04-04").includes("Λάζαρος"));      // Easter - 8
  // George after Easter: stays 23 April.
  assert.ok(N.namesOn("2026-04-23").includes("Γιώργος"));
  assert.ok(N.namesOn("2026-04-25").includes("Μάρκος"));
  // George before Easter (2024, Easter 5 May): Easter Monday; Mark: Easter Tuesday.
  assert.ok(!N.namesOn("2024-04-23").includes("Γιώργος"));
  assert.ok(N.namesOn("2024-05-06").includes("Γιώργος"));
  assert.ok(!N.namesOn("2024-04-25").includes("Μάρκος"));
  assert.ok(N.namesOn("2024-05-07").includes("Μάρκος"));
  // George on Easter Sunday itself (2006): Easter Monday; Mark then on Easter Tuesday.
  assert.equal(N.easter(2006), "2006-04-23");
  assert.ok(N.namesOn("2006-04-24").includes("Γιώργος"));
  assert.ok(N.namesOn("2006-04-25").includes("Μάρκος"));
  // Nicknames marked "~" match but are never displayed.
  assert.ok(!N.namesOn("2026-12-06").some((n) => n.startsWith("~")));
  assert.ok(N.celebrates("Νικολάκης", "2026-12-06"));
});

test("name days: every listed date is a real date and no name is listed twice per day", () => {
  for (const mmdd of Object.keys(N._NAMES_FIXED)) {
    assert.ok(N.isYmd("2024-" + mmdd), mmdd);
    const d = "2024-" + mmdd;
    assert.equal(N.addDays(N.addDays(d, 1), -1), d);
  }
  for (let d = "2026-01-01"; d < "2027-01-01"; d = N.addDays(d, 1)) {
    const names = N.namesOn(d);
    assert.equal(new Set(names).size, names.length, d);
  }
});

test("matching: Greek, Greeklish, accents, case, surname ignored", () => {
  const same = [["Γιώργος", "Giorgos"], ["ΓΙΩΡΓΟΣ", "giorgos"], ["Χρήστος", "Christos"],
    ["Χρήστος", "Hristos"], ["Βασίλης", "Vassilis"], ["Ευάγγελος", "Evangelos"],
    ["Ιωάννης", "Ioannis"], ["Παναγιώτης", "Panagiotis"], ["Θανάσης", "Thanasis"],
    ["Φώτης", "Fotis"], ["Αλέξανδρος", "Alexandros"], ["Σπύρος", "Spyros"]];
  for (const [a, b] of same) assert.equal(N.skeleton(a), N.skeleton(b), a + " / " + b);
  assert.ok(N.celebrates("Δημήτρης Παπαδόπουλος", "2026-10-26"));
  assert.ok(N.celebrates("dimitris", "2026-10-26"));
  assert.ok(N.celebrates("Ελένη", "2026-05-21"));
  assert.ok(!N.celebrates("Ελένη", "2026-10-26"));
  assert.ok(!N.celebrates("", "2026-10-26"));
  assert.ok(!N.celebrates(null, "2026-10-26"));
  assert.ok(N.celebrates("Giorgos", "2024-05-06"));
});

test("observances: rules (fixed, n-th weekday, last weekday, Easter, day of year)", () => {
  const data = N.cleanDays(DAYS);
  const on = (d) => N.observancesOn(d, data).map((o) => o.id);
  assert.ok(on("2026-02-10").includes("safer-internet"));   // 2nd Tuesday of Feb
  assert.ok(on("2026-05-10").includes("mothers"));          // 2nd Sunday of May
  assert.ok(on("2026-06-21").includes("fathers"));          // 3rd Sunday of June
  assert.ok(on("2026-07-31").includes("sysadmin"));         // last Friday of July
  assert.ok(on("2026-02-12").includes("tsiknopempti"));     // Easter - 59
  assert.ok(on("2026-09-13").includes("programmers"));      // day 256
  assert.ok(on("2024-09-12").includes("programmers"));      // leap year
  assert.ok(on("2026-03-31").includes("backup"));
  assert.deepEqual(N.observancesOn("2026-03-31", null), []);
  assert.equal(N.nthWeekday(2026, 2, 2, 5), null);          // no 5th Tuesday in Feb 2026
});

test("days.json: ships clean (nothing dropped by the sanitizer)", () => {
  const data = N.cleanDays(DAYS);
  assert.equal(data.days.length, DAYS.days.length);
  assert.ok(data.days.length >= 50);
});

test("cleanDays: hostile or broken input is dropped, titles are plain and short", () => {
  assert.equal(N.cleanDays(null), null);
  assert.equal(N.cleanDays({ ver: 2, days: [] }), null);
  assert.equal(N.cleanDays({ ver: 1, days: "x" }), null);
  const d = N.cleanDays({ ver: 1, days: [
    { id: "ok", md: "01-02", en: "A", el: "Α" },
    { id: "ok", md: "01-03", en: "dup", el: "dup" },
    { id: "Bad Id", md: "01-02", en: "A", el: "Α" },
    { id: "nomd", en: "A", el: "Α" },
    { id: "badmd", md: "13-40", en: "A", el: "Α" },
    { id: "badnth", nth: [2, 9, 1], en: "A", el: "Α" },
    { id: "badeaster", easter: 1.5, en: "A", el: "Α" },
    { id: "noel", md: "01-02", en: "A" },
    { id: "long", md: "01-05", en: "x".repeat(500), el: "<b>\u0000y</b>" },
    { id: "proto", md: "01-06", en: "A", el: "Α", __proto__: { evil: 1 } }
  ] });
  assert.deepEqual(d.days.map((x) => x.id), ["ok", "long", "proto"]);
  assert.equal(d.days[1].en.length, 80);
  assert.equal(d.days[1].el, "<b>y</b>");                  // rendered with textContent
  assert.equal(Object.keys(d.days[2]).sort().join(), "el,en,id,md");
});
