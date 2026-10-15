// Mood — "Import from another app" (mood/import.js): Daylio CSV and
// .daylio backup, Bearable, eMoods and plain CSV files, the preview
// numbers, and apply/undo on oros-mood-data (stable ids, nothing of the
// user's own changed, re-import adds only what is new).
// Fixtures follow the documented export shapes; the .daylio ZIP is
// built here with atelier/zip.js write().
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const I = require("../mood/import.js");
const V = require("../mood/vocab.js");
const Z = require("../atelier/zip.js");

const enc = (s) => new TextEncoder().encode(s);
const HAB = ["water", "food", "sleep", "move", "som", "caf", "alc", "scr", "meds",
  "meditate", "read", "tv", "music", "games", "cook", "walk", "nap", "journal", "chores", "bedtime", "outdoor"];
const ctx = (extra) => Object.assign({
  habitFields: HAB,
  emos: [{ k: "happy", label: "Happy" }, { k: "calm", label: "Calm" }, { k: "sad", label: "Sad" }],
  acts: [], habits: [{ f: "read", yes: "Read a book", no: "Didn't read" }],
  colors: V.CUSTOM_COLORS, nCustomEmo: 0
}, extra || {});
const local = (y, m, d, h, mi) => new Date(y, m - 1, d, h || 0, mi || 0).getTime();

const DAYLIO_CSV =
  "full_date,date,weekday,time,mood,activities,note_title,note\n" +
  "2024-03-05,March 5,Tuesday,21:45,rad,family | reading | bad sleep,Great day,\"Went out<br>with <b>friends</b> &amp; family\"\n" +
  "2024-03-05,March 5,Tuesday,9:10 AM,meh,,,\n" +
  "2024-03-04,March 4,Monday,8:30 PM,awful,work,,\"line one\nline two\"\n" +
  "2024-03-03,March 3,Sunday,12:00,Zonked,,,\n" +
  "2024-03-02,March 2,Saturday,12:00,,,,no mood\n";

test("Daylio CSV: detected, moods guessed, time and notes read as text", async () => {
  const p = await I.read("daylio_export_2024_03_05.csv", enc(DAYLIO_CSV));
  assert.equal(p.source, "daylio");
  assert.equal(p.items.length, 4);
  assert.equal(p.skipped, 1);
  const byMood = Object.fromEntries(p.moods.map((m) => [m.label, m.g]));
  assert.deepEqual(byMood, { rad: 1, meh: 3, awful: 5, Zonked: 0 });
  const rad = p.items.find((x) => x.mood === "rad");
  assert.equal(rad.ts, local(2024, 3, 5, 21, 45));
  assert.deepEqual(rad.acts, ["family", "reading", "bad sleep"]);
  assert.equal(rad.note, "Great day\nWent out\nwith friends & family");
  assert.equal(p.items.find((x) => x.mood === "meh").ts, local(2024, 3, 5, 9, 10));
  assert.equal(p.items.find((x) => x.mood === "awful").ts, local(2024, 3, 4, 20, 30));
  assert.equal(p.items.find((x) => x.mood === "awful").note, "line one\nline two");
});

test("prepare: steps → feelings, habits, own activities, unknown moods skipped", async () => {
  const p = await I.read("x.csv", enc(DAYLIO_CSV));
  const prep = I.prepare(p, ctx({ acts: [{ id: "c-mine1234", label: "Work" }] }));
  assert.equal(prep.entries.length, 3);                    // Zonked skipped by default
  assert.equal(prep.stats.skipped, 2);
  const rad = prep.entries.find((e) => e.ts === local(2024, 3, 5, 21, 45));
  assert.deepEqual(rad.emotions, [{ k: "happy", i: 5 }]);
  assert.equal(rad.read, "yes");
  assert.equal(rad.sleep, "no");
  assert.equal(rad.acts.length, 1);
  assert.ok(V.isCustomId(rad.acts[0]));
  assert.deepEqual(prep.defs.act.map((d) => d.lab), ["family"]);
  const awful = prep.entries.find((e) => e.ts === local(2024, 3, 4, 20, 30));
  assert.deepEqual(awful.emotions, [{ k: "sad", i: 5 }]);
  assert.deepEqual(awful.acts, ["c-mine1234"]);            // matched by label
  assert.ok(/^imp-[a-z0-9]+$/.test(rad.id));
  // every built-in habit field is present, as Capture writes them
  HAB.forEach((f) => assert.ok(f in rad));
  // the user picks a step for the unknown mood
  const prep2 = I.prepare(p, ctx({ steps: { Zonked: 4 } }));
  assert.equal(prep2.entries.length, 4);
  assert.deepEqual(prep2.entries.find((e) => e.ts === local(2024, 3, 3, 12)).emotions, [{ k: "sad", i: 3 }]);
  // ids do not depend on the steps or the vocabulary
  assert.equal(prep2.entries.find((e) => e.ts === rad.ts).id, rad.id);
});

function daylioBackup() {
  return {
    version: 15,
    customMoods: [
      { id: 1, custom_name: "", mood_group_id: 1, predefined_name_id: 1 },
      { id: 2, custom_name: "", mood_group_id: 2, predefined_name_id: 2 },
      { id: 3, custom_name: "", mood_group_id: 3, predefined_name_id: 3 },
      { id: 4, custom_name: "", mood_group_id: 4, predefined_name_id: 4 },
      { id: 5, custom_name: "", mood_group_id: 5, predefined_name_id: 5 },
      { id: 6, custom_name: "Ζεν", mood_group_id: 2, predefined_name_id: -1 }
    ],
    tags: [{ id: 1, name: "gaming" }, { id: 2, name: "Ψάρεμα" }],
    dayEntries: [
      { id: 10, datetime: local(2024, 1, 2, 18, 5), mood: 6, tags: [1, 2], note: "ήσυχα", note_title: "", year: 2024, month: 0, day: 2, hour: 18, minute: 5 },
      { id: 11, mood: 4, tags: [], note: "", note_title: "", year: 2024, month: 0, day: 1, hour: 9, minute: 0 },
      { id: 12, datetime: "bad", mood: 99, tags: [] }
    ]
  };
}
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

test("Daylio backup: ZIP with backup.daylio (base64 JSON), custom moods and tags", async () => {
  const zip = Z.write([{ name: "backup.daylio", data: b64(JSON.stringify(daylioBackup())) }, { name: "assets/x.jpg", data: "x" }]);
  const p = await I.read("backup_2024.daylio", zip);
  assert.equal(p.source, "daylio-bk");
  assert.equal(p.items.length, 2);
  assert.equal(p.skipped, 1);
  const zen = p.items.find((x) => x.mood === "Ζεν");
  assert.equal(zen.g, 2);
  assert.deepEqual(zen.acts, ["gaming", "Ψάρεμα"]);
  assert.equal(zen.note, "ήσυχα");
  assert.equal(p.items.find((x) => x.mood === "bad").ts, local(2024, 1, 1, 9, 0));
  const prep = I.prepare(p, ctx());
  const e = prep.entries.find((x) => x.ts === zen.ts);
  assert.deepEqual(e.emotions, [{ k: "happy", i: 3 }]);
  assert.equal(e.games, "yes");
  assert.deepEqual(prep.defs.act.map((d) => d.lab), ["Ψάρεμα"]);
  // the same file without the ZIP (bare base64), and plain JSON
  const p2 = await I.read("backup.daylio", enc(b64(JSON.stringify(daylioBackup()))));
  assert.equal(p2.items.length, 2);
  const p3 = await I.read("backup.json", enc(JSON.stringify(daylioBackup())));
  assert.equal(p3.source, "daylio-bk");
});

const BEARABLE_CSV =
  "date formatted,weekday,time of day,date,category,rating/amount,detail,notes\n" +
  "2024-05-01,Wed,am,2024-05-01,Mood,8,,woke up fine\n" +
  "2024-05-01,Wed,pm,2024-05-01,Mood,3,,\n" +
  "2024-05-01,Wed,am,2024-05-01,Emotions,,\"Happy, Grateful, Wistful\",\n" +
  "2024-05-01,Wed,,2024-05-01,Notes,,Long day at work,\n" +
  "2024-05-01,Wed,,2024-05-01,Sleep,7.5,,\n" +
  "2024-05-02,Thu,mid,2024-05-02,Emotions,,Anxious,\n" +
  "2024-05-03,Fri,pm,2024-05-03,Symptoms,2,Headache,\n";

test("Bearable: Mood rows by part of day, Emotions as feelings, notes joined", async () => {
  const p = await I.read("bearable-export.csv", enc(BEARABLE_CSV));
  assert.equal(p.source, "bearable");
  assert.equal(p.scale, 10);
  assert.equal(p.items.length, 3);
  const am = p.items.find((x) => x.ts === local(2024, 5, 1, 9));
  assert.equal(am.mood, "8");
  assert.deepEqual(am.emos.map((e) => e.name), ["Happy", "Grateful", "Wistful"]);
  assert.equal(am.note, "woke up fine\nLong day at work");
  assert.equal(p.items.find((x) => x.ts === local(2024, 5, 1, 18)).mood, "3");
  const prep = I.prepare(p, ctx());
  const e = prep.entries.find((x) => x.ts === am.ts);
  // 8/10 → step 2 (happy 3); Happy/Grateful → happy; Wistful → new feeling
  assert.equal(e.emotions.find((m) => m.k === "happy").i, 3);
  assert.equal(prep.defs.emo.length, 1);
  assert.equal(prep.defs.emo[0].lab, "Wistful");
  assert.ok(/^#[0-9a-f]{6}$/.test(prep.defs.emo[0].col));
  assert.ok(e.emotions.some((m) => m.k === prep.defs.emo[0].id));
  const pm = prep.entries.find((x) => x.ts === local(2024, 5, 1, 18));
  assert.deepEqual(pm.emotions, [{ k: "sad", i: 3 }]);
  const anx = prep.entries.find((x) => x.ts === local(2024, 5, 2, 13));
  assert.deepEqual(anx.emotions, [{ k: "anxious", i: 3 }]);
});

const EMOODS_CSV =
  "DATE,DEPRESSED,ELEVATED,IRRITABLE,ANXIETY,HOURS OF SLEEP,WEIGHT,NOTES\n" +
  "2024-02-10,2,0,1,3,6.5,70,rough night\n" +
  "2024-02-11,0,0,0,0,8,,\n" +
  "nope,1,1,1,1,,,\n";

test("eMoods: ratings 0–3 become feelings, the rest goes into the note", async () => {
  const p = await I.read("eMoods.csv", enc(EMOODS_CSV));
  assert.equal(p.source, "emoods");
  assert.equal(p.items.length, 2);
  assert.equal(p.skipped, 1);
  assert.equal(p.moods.length, 0);
  const prep = I.prepare(p, ctx());
  const a = prep.entries.find((x) => x.ts === local(2024, 2, 10, 12));
  assert.deepEqual(a.emotions, [{ k: "angry", i: 2 }, { k: "anxious", i: 5 }, { k: "sad", i: 4 }]);
  assert.ok(a.note.startsWith("rough night\neMoods · Depressed 2/3 · Elevated 0/3 · Irritable 1/3 · Anxiety 3/3 · Sleep 6.5 h"));
  assert.ok(a.note.includes("WEIGHT: 70"));
  const b = prep.entries.find((x) => x.ts === local(2024, 2, 11, 12));
  assert.deepEqual(b.emotions, [{ k: "calm", i: 3 }]);
  // translated words for the note
  const pg = await I.read("eMoods.csv", enc(EMOODS_CSV), { depressed: "Κατάθλιψη", elevated: "Ανεβασμένη", irritable: "Ευερεθιστότητα", anxiety: "Άγχος", sleep: "Ύπνος" });
  assert.ok(pg.items[0].note.includes("Κατάθλιψη 2/3"));
});

test("plain CSV: numbers 1–10 or 1–5, words, feelings, tags, ; delimiter", async () => {
  const p = await I.read("moods.csv", enc("Date;Time;Mood;Note;Tags\n05/03/2024;22:00;9;nice;walk, coffee\n06/03/2024;;2;;\n07/03/2024;08:00;10;;\n"));
  assert.equal(p.source, "generic");
  assert.equal(p.scale, 10);
  const prep = I.prepare(p, ctx());
  const a = prep.entries.find((x) => x.ts === local(2024, 3, 5, 22));
  assert.deepEqual(a.emotions, [{ k: "happy", i: 5 }]);
  assert.equal(a.walk, "yes");
  assert.equal(a.caf, "yes");
  assert.equal(a.note, "nice");
  assert.deepEqual(prep.entries.find((x) => x.ts === local(2024, 3, 6, 12)).emotions, [{ k: "sad", i: 5 }]);
  const q = await I.read("m.csv", enc("date,mood,feelings\n2024-01-01,good,calm|tired\n2024-01-02,4,\n2024-01-03,okay,\n"));
  assert.equal(q.scale, 5);
  const pq = I.prepare(q, ctx());
  assert.deepEqual(pq.entries.find((x) => x.ts === local(2024, 1, 1, 12)).emotions,
    [{ k: "calm", i: 3 }, { k: "happy", i: 3 }, { k: "tired", i: 3 }]);
  assert.deepEqual(pq.entries.find((x) => x.ts === local(2024, 1, 2, 12)).emotions, [{ k: "happy", i: 3 }]);
  assert.deepEqual(pq.entries.find((x) => x.ts === local(2024, 1, 3, 12)).emotions, [{ k: "numb", i: 2 }]);
});

test("unreadable and oversized files are refused", async () => {
  await assert.rejects(I.read("x.csv", enc("a,b\n1,2\n")), /format/);
  await assert.rejects(I.read("x.daylio", enc("not base64 at all!!")), /format/);
  await assert.rejects(I.read("x.zip", Z.write([{ name: "readme.txt", data: "hi" }])), /format/);
  const big = new Uint8Array(I.MAX_FILE + 1);
  await assert.rejects(I.read("x.csv", big), /toobig/);
  // markup in a note stays text
  assert.equal(I.noteText("<img src=x onerror=alert(1)>hi<script>x</script>"), "hix");
});

test("apply: adds once, never touches the user's entries, re-import adds only new", async () => {
  const p = await I.read("x.csv", enc(DAYLIO_CSV));
  const prep = I.prepare(p, ctx());
  const mine = { id: "u1", ts: local(2024, 3, 5, 21, 45), mtime: 5, emotions: [{ k: "calm", i: 2 }], note: "mine", loc: null, person: null, trig: null, trigger: "" };
  const state = { ver: 3, sm: 1, om: 0, entries: [mine], deleted: {}, cols: { loc: [], trig: [], person: [] } };
  const before = JSON.stringify(state);
  const r = I.apply(state, prep, 1000);
  assert.equal(JSON.stringify(state), before);              // input untouched
  assert.equal(r.added.length, 3);
  assert.equal(r.state.entries.length, 4);
  assert.deepEqual(r.state.entries.find((e) => e.id === "u1"), mine);
  assert.equal(r.state.sm, 1000);
  assert.ok(r.state.entries.every((e, i, a) => i === 0 || a[i - 1].ts >= e.ts));
  assert.deepEqual(r.defs.act.map((d) => d.lab).sort(), ["family", "work"]);
  // the vocabulary survives vocab.js normalisation unchanged
  assert.deepEqual(V.mergeVocab(r.state.vocab, null).act, r.state.vocab.act);
  // the same file again: nothing added, nothing changed
  const r2 = I.apply(r.state, I.prepare(p, ctx()), 2000);
  assert.equal(r2.added.length, 0);
  assert.equal(r2.skipped, 3);
  assert.equal(JSON.stringify(r2.state.entries), JSON.stringify(r.state.entries));
  // an imported entry the user edited stays as edited
  const edited = JSON.parse(JSON.stringify(r.state));
  edited.entries.find((e) => e.id === r.added[0]).note = "edited";
  const r3 = I.apply(edited, prep, 3000);
  assert.equal(r3.state.entries.find((e) => e.id === r.added[0]).note, "edited");
});

test("undo: the old data back, tombstones and hidden definitions for sync", async () => {
  const p = await I.read("x.csv", enc(DAYLIO_CSV));
  const prep = I.prepare(p, ctx());
  const prev = { ver: 3, sm: 1, entries: [], deleted: { old: 7 }, cols: { loc: [], trig: [], person: [] } };
  const r = I.apply(prev, prep, 1000);
  const u = I.undo(r.state, prev, r, 2000);
  assert.deepEqual(u.entries, []);
  r.added.forEach((id) => assert.equal(u.deleted[id], 2000));
  assert.equal(u.deleted.old, 7);
  assert.equal(u.vocab.act.length, 2);
  assert.ok(u.vocab.act.every((d) => d.hid === true && d.mtime > 1000));
  // merged with a device that already got the import: it goes there too
  const merged = V.mergeVocab(u.vocab, r.state.vocab);
  assert.ok(merged.act.every((d) => d.hid === true));
  // importing again after the undo brings the entries back and shows the activity
  const r2 = I.apply(u, I.prepare(p, ctx()), 3000);
  assert.equal(r2.added.length, 3);
  r2.added.forEach((id) => assert.equal(r2.state.deleted[id], undefined));
  assert.ok(r2.state.vocab.act.every((d) => d.hid === undefined));
  assert.equal(r2.defs.act.length, 2);
});

test("guessStep and same-time duplicates get distinct stable ids", async () => {
  assert.equal(I.guessStep("RAD"), 1);
  assert.equal(I.guessStep("καλά"), 2);
  assert.equal(I.guessStep("1"), 5);
  assert.equal(I.guessStep("5"), 1);
  assert.equal(I.guessStep("10", 10), 1);
  assert.equal(I.guessStep("whatever"), 0);
  const csv = "date,mood\n2024-01-01,good\n2024-01-01,good\n";
  const a = I.prepare(await I.read("a.csv", enc(csv)), ctx());
  const b = I.prepare(await I.read("a.csv", enc(csv)), ctx());
  assert.equal(a.entries.length, 2);
  assert.notEqual(a.entries[0].id, a.entries[1].id);
  assert.deepEqual(a.entries.map((e) => e.id), b.entries.map((e) => e.id));
});
