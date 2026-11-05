// Diary "Your day" line (wave A4, diary/dayline.js): habits ticked and
// the Habits feed rows of other apps, read only.
// Run: node --test tests/diary-dayline.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const D = require(path.join(ROOT, "diary/dayline.js"));
const HC = require(path.join(ROOT, "habits/core.js"));

const DAY = "2026-11-04";
const habits = {
  habits: [{ id: "h1", name: "Reading", m: 1 }, { id: "h2", name: "Run", m: 1 }, { id: "h3", name: "Old", m: 1, archived: true },
           { id: "h4", name: "Gone", m: 1, del: true }],
  comps: [{ id: "h1|" + DAY, habitId: "h1", date: DAY, mtime: 1 }, { id: "h3|" + DAY, habitId: "h3", date: DAY, mtime: 1 },
          { id: "h2|2026-11-03", habitId: "h2", date: "2026-11-03", mtime: 1 }]
};
const feeds = [
  { id: "water", app: "water", name: { en: "Water", el: "Νερό" }, unit: { en: "L", el: "L" },
    read: () => ({ days: { [DAY]: true }, vals: { [DAY]: 2.25 } }) },
  { id: "fitness", app: "fitness", name: { en: "Workout", el: "Προπόνηση" }, read: () => ({ days: { [DAY]: true } }) },
  { id: "zen", app: "zen", name: "Micro-Zen", read: () => ({ days: { "2026-11-03": true } }) },
  { id: "bad", app: "x", name: "Bad", read: () => { throw new Error("x"); } }
];

test("habits ticked that day and the feeds done that day, in order; archived and deleted habits left out", () => {
  const got = D.items(DAY, "en", { habits, core: HC, feeds });
  const texts = got.map((x) => x.text);
  assert.ok(texts.includes("Reading"));
  assert.ok(!texts.includes("Run") && !texts.includes("Old") && !texts.includes("Gone"));
  assert.ok(texts.includes("Water 2.3 L") || texts.includes("Water 2.2 L"));
  assert.ok(texts.includes("Workout"));
  assert.ok(!texts.some((x) => /Zen|Bad/.test(x)));
  assert.equal(D.items(DAY, "el", { habits: null, core: HC, feeds })[0].text.slice(0, 4), "Νερό");
});

test("nothing without sources, a bad day, or nothing done; the block is Markdown lines", () => {
  assert.deepEqual(D.items("nope", "en", { habits, core: HC, feeds }), []);
  assert.deepEqual(D.items(DAY, "en", null), []);
  assert.deepEqual(D.items("2026-01-01", "en", { habits, core: HC, feeds }), []);
  assert.equal(D.block([], "Your day"), "");
  assert.equal(D.block([{ text: "Reading" }, { text: "Workout" }], "Your day"), "**Your day**\n- Reading\n- Workout");
});

test("Diary loads the readers and the feeds also register on the Diary page", () => {
  const html = fs.readFileSync(path.join(ROOT, "diary/index.html"), "utf8");
  for (const f of ["../habits/core.js", "../water/core.js", "../fitness/core.js", "../zen/core.js", "../typing/due.js", "../habits/steps.js", "dayline.js"]) {
    assert.ok(html.includes('src="' + f), "diary loads " + f);
  }
  for (const f of ["zen/core.js", "typing/due.js"]) {
    assert.ok(fs.readFileSync(path.join(ROOT, f), "utf8").includes("/\\/(habits|diary)\\//"), f);
  }
  const js = fs.readFileSync(path.join(ROOT, "diary/diary.js"), "utf8");
  assert.match(js, /applyWrite\(\{ date: day, text: b \}\)/);
  assert.ok(fs.readFileSync(path.join(ROOT, "sw.js"), "utf8").includes('"diary/dayline.js"'));
});

test("Baby: the next vaccine or visit opens Calendar's New event (prefill only)", () => {
  const js = fs.readFileSync(path.join(ROOT, "baby/baby.js"), "utf8");
  assert.match(js, /\(type === "vac" \|\| type === "doc"\) && calendarHere\(\)/);
  assert.match(js, /window\.parent\.__orosOpenCalendarNew\(\{ date: todayKey\(\), title: title\.slice\(0, 80\) \}\)/);
});
