// Everyday interop B (Diary ↔ Mood): Diary shows the feelings Mood
// logged that day (read-only, through the shell's OrosMoodCore.dayMoods)
// and opens Mood at { day }; Mood's "Write about it" hands an entry to
// Diary as { write: { date, text } }, which only prefills (BR-W8-6:
// nothing saved until Keep or an edit) and waits for the PIN lock.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const MC = require(path.join(ROOT, "mood/core.js"));

const at = (y, m, d, h) => new Date(y, m - 1, d, h, 0).getTime();

test("dayMoods: that day only, in the order logged, one per feeling", () => {
  const raw = {
    entries: [
      { id: "b", ts: at(2026, 10, 17, 20), mtime: 1, emotions: [{ k: "tired", i: 2 }, { k: "calm", i: 4 }] },
      { id: "a", ts: at(2026, 10, 17, 9), mtime: 1, emotions: [{ k: "happy", i: 3 }, { k: "calm", i: 2 }] },
      { id: "x", ts: at(2026, 10, 16, 23), mtime: 1, emotions: [{ k: "sad", i: 5 }] },
      { id: "y", ts: at(2026, 10, 18, 0), mtime: 1, emotions: [{ k: "angry", i: 5 }] }
    ],
    deleted: {}
  };
  const out = MC.dayMoods(raw, "2026-10-17", "en");
  assert.deepEqual(out.map((m) => m.k), ["happy", "calm", "tired"]);
  assert.equal(out[1].i, 4, "highest intensity of the day");
  assert.equal(out[0].label, "Happy");
  assert.equal(out[0].col, "#87cf3e");
  assert.equal(MC.dayMoods(raw, "2026-10-17", "el")[0].label, "Χαρούμενος");
  assert.deepEqual(MC.dayMoods(raw, "2026-10-15", "en"), []);
});

test("dayMoods: tombstoned entries are skipped, a newer edit revives one", () => {
  const raw = {
    entries: [
      { id: "gone", ts: at(2026, 10, 17, 9), mtime: 100, emotions: [{ k: "sad", i: 3 }] },
      { id: "back", ts: at(2026, 10, 17, 10), mtime: 300, emotions: [{ k: "happy", i: 3 }] }
    ],
    deleted: { gone: 200, back: 200 }
  };
  assert.deepEqual(MC.dayMoods(raw, "2026-10-17", "en").map((m) => m.k), ["happy"]);
});

test("dayMoods: own feelings use their name, emoji and colour; bad data never throws", () => {
  const raw = {
    entries: [{ id: "a", ts: at(2026, 10, 17, 9), emotions: [{ k: "c-abcd1", i: 2 }, { k: "calm", i: 1 }, null, { i: 3 }] }],
    vocab: { emo: [
      { id: "c-abcd1", mtime: 1, lab: "Old", col: "#111111" },
      { id: "c-abcd1", mtime: 5, lab: "Proud", ic: "🦁", col: "#ec6fb4" },
      { id: "calm", mtime: 2, lab: "Chill" }
    ] }
  };
  const out = MC.dayMoods(raw, "2026-10-17", "en");
  assert.deepEqual(out.map((m) => [m.k, m.label, m.ic, m.col]),
    [["c-abcd1", "Proud", "🦁", "#ec6fb4"], ["calm", "Chill", "", "#51a2da"]]);
  for (const bad of [null, undefined, {}, { entries: "x" }, { entries: [null, { ts: "x" }] }]) {
    assert.deepEqual(MC.dayMoods(bad, "2026-10-17", "en"), []);
  }
});

test("Mood: a { day } target opens that day's entries; Write about it hands over { write }", () => {
  const s = src("mood/mood.js");
  const oa = s.slice(s.indexOf("window.__orosOpenAt = function (tg)"));
  assert.match(oa.slice(0, 600), /tg\.day[\s\S]*openDayEntries\(tg\.day\)/);
  assert.match(s, /if \(dayFilter && dayKey\(e\.ts\) !== dayFilter\) return;/);
  assert.match(s, /__orosOpenAt\("diary", \{ write: \{ date: dayKey\(e\.ts\), text: text \} \}\)/);
  assert.match(s, /typeof p\.__orosOpenAt !== "function"/, "checks the bridge first");
  assert.match(s, /a\.id === "diary"/, "only when Diary is installed");
  for (const [k, en, el] of [["wr.btn", "Write about it", "Γράψε γι' αυτό"], ["day.all", "Show all days", "Όλες οι μέρες"]]) {
    assert.ok(s.includes(`STRINGS.en["${k}"]`) && s.includes(en), "EN " + k);
    assert.ok(s.includes(`STRINGS.el["${k}"]`) && s.includes(el), "EL " + k);
  }
  assert.doesNotMatch(s.slice(s.indexOf("function renderDayBar"), s.indexOf("function diaryBridge")), /innerHTML/);
});

test("Diary: mood line is read-only and quiet; { write } only prefills and respects the lock", () => {
  const s = src("diary/diary.js");
  const md = s.slice(s.indexOf("function moodApi"), s.indexOf("// ---- prompts and templates"));
  assert.match(md, /OrosMoodCore\.dayMoods\(JSON\.parse\(localStorage\.getItem\(MOOD_KEY\)/);
  assert.match(md, /b\.hidden = !list\.length;/, "nothing when Mood has nothing that day");
  assert.match(md, /a\.id === "mood"/, "nothing when Mood is not installed");
  assert.match(md, /__orosOpenAt\("mood", \{ day: day \}\)/);
  assert.doesNotMatch(md, /innerHTML|localStorage\.setItem/, "no HTML from data, never writes Mood's key");
  assert.match(s, /target\.write\) \{ openWriteTarget\(target\.write\)/);
  assert.match(s, /if \(lockRec && \(locked \|\| !booted\)\) \{ writeWaiting = w; return; \}/);
  assert.match(s, /if \(w && !locked\) applyWrite\(w\);/);
  const aw = s.slice(s.indexOf("function applyWrite"), s.indexOf("function keepDraft"));
  assert.doesNotMatch(aw, /onLongInput|commitLong|save\(\)|setLong\(/, "the hand-over never saves");
  assert.match(s, /\$\("long-keep"\)\.addEventListener\("click", keepDraft\)/);
  const html = src("diary/index.html");
  for (const id of ["mood-day", "long-keep", "long-drop"]) assert.ok(html.includes(`id="${id}"`), id);
  for (const [en, el] of [["\"mood.lbl\": \"Mood\"", "\"mood.lbl\": \"Διάθεση\""], ["\"draft.keep\": \"Keep\"", "\"draft.keep\": \"Κράτα το\""]]) {
    assert.ok(s.includes(en) && s.includes(el), en);
  }
});

test("help mentions the hand-overs in both languages", () => {
  assert.match(src("diary/help.en.txt"), /app:mood[\s\S]*`Write about it`/);
  assert.match(src("diary/help.el.txt"), /app:mood[\s\S]*`Γράψε γι' αυτό`/);
  assert.match(src("mood/help.en.txt"), /`Write about it`[^\n]*app:diary/);
  assert.match(src("mood/help.el.txt"), /`Γράψε γι' αυτό`[^\n]*app:diary/);
});
