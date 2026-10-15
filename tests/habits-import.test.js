// Habits "Import from another app" (habits/import.js): detection and
// mapping of Loop Habit Tracker (ZIP + bare CSVs), Habitica (JSON and
// CSV), Streaks, Habitify and generic long / wide CSV; the merge into
// the Habits data (stable ids, re-import adds nothing twice, the
// user's days win) and Undo.
// Fixtures follow the documented export shapes; zips are built here
// with atelier/zip.js write().
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const I = require(path.join(ROOT, "habits/import.js"));
const M = require(path.join(ROOT, "habits/model.js"));
const HC = require(path.join(ROOT, "habits/core.js"));
const Z = require(path.join(ROOT, "atelier/zip.js"));

const enc = (s) => new TextEncoder().encode(s);
const byName = (res, n) => res.habits.find((h) => h.name === n);
const empty = () => ({ ver: 2, habits: [], comps: [] });

// ---------- fixtures ----------
const LOOP_HABITS =
  "Position,Name,Type,Question,Description,FrequencyNumerator,FrequencyDenominator,Color,Unit,Target Type,Target Value,Archived?\n" +
  "001,Meditate,YES_NO,Did you meditate today?,,1,1,#4CAF50,,AT_LEAST,0,false\n" +
  "002,Gym,YES_NO,Did you go?,,3,7,#E53935,,AT_LEAST,0,false\n" +
  "003,Read,NUMERICAL,How many pages?,,1,1,#3F51B5,pages,AT_LEAST,20,false\n" +
  "004,\"Old, archived\",YES_NO,,,1,1,#9E9E9E,,AT_LEAST,0,true\n";
const LOOP_ROOT =
  "Date,Meditate,Gym,Read,\"Old, archived\"\n" +
  "2024-03-03,2,0,15000,-1\n" +
  "2024-03-02,0,2,0,2\n" +
  "2024-03-01,2,1,25000,-1\n";
const LOOP_MED = "Date,Value\n2024-03-03,2\n2024-03-02,3\n2024-03-01,2\n2024-02-29,0\n2024-02-28,-1\n";
const LOOP_SCORES = "Date,Value\n2024-03-03,0.51\n";

function loopZip(withPerHabit) {
  const files = [{ name: "Habits.csv", data: LOOP_HABITS }, { name: "Checkmarks.csv", data: LOOP_ROOT }, { name: "Scores.csv", data: LOOP_SCORES }];
  if (withPerHabit) {
    files.push({ name: "001 Meditate/Checkmarks.csv", data: LOOP_MED });
    files.push({ name: "001 Meditate/Scores.csv", data: LOOP_SCORES });
  }
  return Z.write(files);
}

const HABITICA_JSON = JSON.stringify({
  profile: { name: "x" },
  tasks: {
    habits: [
      { id: "h-water", type: "habit", text: "Drink water", up: true, down: false,
        history: [{ date: Date.UTC(2024, 2, 1, 12), value: 1, scoredUp: 2, scoredDown: 0 },
                  { date: Date.UTC(2024, 2, 2, 12), value: 0.5, scoredUp: 0, scoredDown: 1 }] },
      { id: "h-bad", type: "habit", text: "Junk food", up: false, down: true, history: [] }
    ],
    dailys: [
      { id: "d-floss", type: "daily", text: "Floss", frequency: "weekly", everyX: 1,
        repeat: { m: true, t: false, w: true, th: false, f: true, s: false, su: false },
        history: [{ date: Date.UTC(2024, 2, 5, 12), value: 1, completed: true, isDue: true },
                  { date: Date.UTC(2024, 2, 7, 12), value: 0, completed: false, isDue: true }] },
      { id: "d-walk", type: "daily", text: "Walk", frequency: "daily", everyX: 2,
        history: [{ date: Date.UTC(2024, 2, 5, 12), value: 0 }, { date: Date.UTC(2024, 2, 6, 12), value: 1.2 }] }
    ],
    todos: [{ id: "t1", text: "not a habit" }]
  }
});
const HABITICA_CSV =
  "Task Name,Task ID,Task Type,Date,Value\n" +
  "Floss,d-floss,daily,2024-03-05 08:00:00,1\n" +
  "Floss,d-floss,daily,2024-03-06 08:00:00,2\n" +
  "Floss,d-floss,daily,2024-03-07 08:00:00,1.5\n" +
  "Stretch,h-st,habit,2024-03-05 18:00:00,1\n" +
  "Buy milk,t-1,todo,2024-03-05 18:00:00,1\n";

const STREAKS_CSV =
  "task_id,title,icon,entry_type,entry_date,entry_timestamp,quantity\n" +
  "A1,Walk the dog,dog,completed_manually,20240301,2024-03-01T08:00:00Z,1\n" +
  "A1,Walk the dog,dog,missed_auto,20240302,2024-03-02T08:00:00Z,0\n" +
  "A1,Walk the dog,dog,skipped_manually,20240303,2024-03-03T08:00:00Z,0\n" +
  "B2,Drink water,cup,completed_auto,20240301,2024-03-01T20:00:00Z,1\n";

const HABITIFY_CSV =
  "Habit Name,Date,Status,Value,Unit,Note\n" +
  "Run,2024-03-01,completed,5,km,\n" +
  "Run,2024-03-02,skipped,,km,\n" +
  "Run,2024-03-03,completed,3,km,\n" +
  "Journal,2024-03-01,completed,1,,\n" +
  "Journal,2024-03-02,failed,,,\n";

const GENERIC_LONG = "Day;Activity;Done\n05/03/2024;Yoga;yes\n06/03/2024;Yoga;no\n13/03/2024;Yoga;x\n";
const GENERIC_WIDE = "Date,Yoga,Water,<img src=x onerror=alert(1)>\n2024-03-01,x,8,\n2024-03-02,,6,1\n2024-03-03,skip,,\n";

// ---------- detection + mapping ----------
test("Loop ZIP: habits, frequency, colours, amounts, per-habit file wins", async () => {
  const res = await I.parse({ name: "Loop Habits CSV 2024-03-03.zip", bytes: loopZip(true) });
  assert.equal(res.source, "loop");
  assert.deepEqual(res.habits.map((h) => h.name), ["Meditate", "Gym", "Read", "Old, archived"]);
  const med = byName(res, "Meditate"), gym = byName(res, "Gym"), read = byName(res, "Read");
  assert.deepEqual(med.days, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(gym.per, ["w", 3]);
  assert.equal(med.color, "#4caf50");
  // per-habit file: 2 done, 3 skipped; root column ignored for it
  assert.deepEqual(med.checks, { "2024-03-03": { d: true }, "2024-03-02": { s: true }, "2024-03-01": { d: true } });
  // root wide file: 2 done, 1 (auto) is not a check-in
  assert.deepEqual(gym.checks, { "2024-03-02": { d: true } });
  assert.deepEqual(read.num, { u: "pages", t: 20, c: "ge" });
  assert.deepEqual(read.checks, { "2024-03-03": { v: 15 }, "2024-03-01": { v: 25 } });
  assert.equal(byName(res, "Old, archived").archived, true);
});

test("Loop ZIP with a sub-folder, only per-habit files, old columns", async () => {
  const habits = "Position,Name,Description,NumRepetitions,Interval,Color\n1,Walk,,1,1,#ff0000\n2,Swim,,2,7,#00ff00\n";
  const zip = Z.write([
    { name: "export/Habits.csv", data: habits },
    { name: "export/001 Walk/Checkmarks.csv", data: "Date,Value\n2024-01-02,2\n2024-01-01,0\n" },
    { name: "export/002 Swim/Checkmarks.csv", data: "Date,Value\n2024-01-02,3000\n" }
  ]);
  const res = await I.parse({ name: "x.zip", bytes: zip });
  assert.equal(res.source, "loop");
  assert.deepEqual(byName(res, "Walk").checks, { "2024-01-02": { d: true } });
  assert.deepEqual(byName(res, "Swim").per, ["w", 2]);
  // no Type column: the ×1000 values say it is an amount habit
  assert.deepEqual(byName(res, "Swim").checks, { "2024-01-02": { v: 3 } });
});

test("Loop bare CSVs: Habits.csv alone, wide Checkmarks.csv alone", async () => {
  const a = I.parseText(LOOP_HABITS, "Habits.csv");
  assert.equal(a.source, "loop");
  assert.equal(a.habits.length, 4);
  assert.equal(a.checks, 0);
  const b = I.parseText(LOOP_ROOT, "Checkmarks.csv");
  assert.equal(b.source, "loop");
  assert.deepEqual(byName(b, "Meditate").checks, { "2024-03-03": { d: true }, "2024-03-01": { d: true } });
});

test("Habitica JSON: dailys + positive habits, schedule, cron day shift", () => {
  const res = I.parseText(HABITICA_JSON, "user-data.json");
  assert.equal(res.source, "habitica");
  assert.deepEqual(res.habits.map((h) => h.name), ["Floss", "Walk", "Drink water"]);
  const floss = byName(res, "Floss");
  assert.deepEqual(floss.days, [0, 2, 4]);
  assert.deepEqual(floss.checks, { "2024-03-04": { d: true } });       // recorded at the 5th's cron
  const walk = byName(res, "Walk");
  assert.deepEqual(walk.per, ["w", 4]);
  assert.deepEqual(walk.checks, { "2024-03-05": { d: true } });        // value went up
  assert.deepEqual(byName(res, "Drink water").checks, { "2024-03-01": { d: true } });
  // wrapped in { user: … } works too
  const wrapped = I.parseText(JSON.stringify({ user: JSON.parse(HABITICA_JSON) }), "x.json");
  assert.equal(wrapped.habits.length, 3);
});

test("Habitica CSV history", () => {
  const res = I.parseText(HABITICA_CSV, "habitica-tasks-history.csv");
  assert.equal(res.source, "habitica");
  assert.deepEqual(res.habits.map((h) => h.name).sort(), ["Floss", "Stretch"]);
  assert.deepEqual(Object.keys(byName(res, "Floss").checks).sort(), ["2024-03-04", "2024-03-05"]);
  assert.deepEqual(byName(res, "Stretch").checks, { "2024-03-05": { d: true } });
});

test("Streaks CSV", () => {
  const res = I.parseText(STREAKS_CSV, "Streaks.csv");
  assert.equal(res.source, "streaks");
  assert.deepEqual(byName(res, "Walk the dog").checks, { "2024-03-01": { d: true }, "2024-03-03": { s: true } });
  assert.deepEqual(byName(res, "Drink water").checks, { "2024-03-01": { d: true } });
  assert.equal(byName(res, "Walk the dog").num, undefined);
});

test("Habitify CSV: amounts become an amount habit", () => {
  const res = I.parseText(HABITIFY_CSV, "export.csv");
  assert.equal(res.source, "habitify");
  const run = byName(res, "Run");
  assert.deepEqual(run.num, { u: "km", t: 4, c: "ge" });
  assert.deepEqual(run.checks, { "2024-03-01": { v: 5 }, "2024-03-02": { s: true }, "2024-03-03": { v: 3 } });
  assert.deepEqual(byName(res, "Journal").checks, { "2024-03-01": { d: true } });
});

test("generic long (semicolons, d/m/y) and wide CSV", () => {
  const a = I.parseText(GENERIC_LONG, "log.csv");
  assert.equal(a.source, "generic");
  assert.deepEqual(byName(a, "Yoga").checks, { "2024-03-05": { d: true }, "2024-03-13": { d: true } });
  const b = I.parseText(GENERIC_WIDE, "sheet.csv");
  assert.equal(b.source, "generic");
  assert.deepEqual(byName(b, "Yoga").checks, { "2024-03-01": { d: true }, "2024-03-03": { s: true } });
  assert.deepEqual(byName(b, "Water").num, { u: "", t: 7, c: "ge" });
  // a name is only text (rendered with textContent later), kept as is
  assert.ok(byName(b, "<img src=x onerror=alert(1)>"));
});

test("unknown, empty and broken input → null", async () => {
  assert.equal(I.parseText("", "x.csv"), null);
  assert.equal(I.parseText("{\"foo\":1}", "x.json"), null);
  assert.equal(I.parseText("just some text", "x.txt"), null);
  assert.equal(await I.parse({ name: "x.zip", bytes: new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]) }), null);
  assert.equal(await I.parse({ name: "x.zip", bytes: Z.write([{ name: "a.txt", data: "hi" }]) }), null);
});

test("caps: habits and check-ins per file", () => {
  let wide = "Date";
  for (let i = 0; i < 400; i++) wide += ",H" + i;
  wide += "\n2024-01-01" + ",x".repeat(400) + "\n";
  const res = I.parseText(wide, "w.csv");
  assert.equal(res.habits.length, I.MAX_HABITS);
  const long = ["Date,Habit"];
  const d0 = Date.UTC(1990, 0, 1);
  for (let i = 0; i < 12000; i++) long.push(new Date(d0 + i * 86400000).toISOString().slice(0, 10) + ",A");
  assert.equal(I.parseText(long.join("\n"), "l.csv").checks, 12000);
});

// ---------- merge + undo ----------
test("apply: stable ids, one copy on re-import, user's days win", async () => {
  const res = await I.parse({ name: "loop.zip", bytes: loopZip(true) });
  const now = Date.UTC(2024, 5, 1);
  const r1 = I.apply(empty(), res, { now });
  assert.equal(r1.added, 4);
  const medId = I.idOf("loop", "meditate");
  assert.match(medId, /^imp-[a-z0-9]+$/);
  const d1 = r1.data;
  assert.ok(M.normalize(d1));
  assert.equal(HC.isDone(d1, medId, "2024-03-03"), true);
  assert.equal(HC.isSkipped(d1, medId, "2024-03-02"), true);
  const readId = I.idOf("loop", "read");
  assert.equal(HC.valueOn(d1, readId, "2024-03-01"), 25);
  assert.equal(HC.isDone(d1, readId, "2024-03-01"), true);
  assert.equal(HC.isDone(d1, readId, "2024-03-03"), false);   // 15 < 20

  // the user edits: renames Meditate, un-ticks a day, notes another
  const u = JSON.parse(JSON.stringify(d1));
  u.habits.find((h) => h.id === medId).name = "Sit";
  M.setTick(u, medId, "2024-03-01", false, now + 10);
  M.setNote(u, medId, "2024-02-20", "travel", now + 10);
  const r2 = I.apply(u, res, { now: now + 1000 });
  assert.equal(r2.added, 0);
  assert.equal(r2.data.habits.length, 4);
  assert.equal(r2.data.habits.find((h) => h.id === medId).name, "Sit");
  // the un-ticked day is the user's choice: it stays un-ticked
  assert.equal(r2.comps, 0);
  assert.equal(HC.isDone(r2.data, medId, "2024-03-01"), false);
  assert.equal(HC.noteOn(r2.data, medId, "2024-02-20"), "travel");
  // a deleted import comes back with its whole history
  const del = JSON.parse(JSON.stringify(r2.data));
  const h = del.habits.find((x) => x.id === medId);
  h.del = true; h.mtime = now + 3000;
  del.comps.forEach((c) => { if (c.habitId === medId && !c.del) { c.del = true; c.mtime = now + 3000; } });
  const r3 = I.apply(del, res, { now: now + 4000 });
  assert.equal(r3.updated >= 1, true);
  assert.equal(HC.isDone(r3.data, medId, "2024-03-01"), true);
  assert.equal(HC.noteOn(r3.data, medId, "2024-02-20"), "travel");
  assert.equal(HC.living(r3.data).length, 4);
});

test("apply: only the chosen habits; never touches the user's own habits", async () => {
  const res = await I.parse({ name: "loop.zip", bytes: loopZip(false) });
  const mine = empty();
  mine.habits.push(M.normHabit({ id: "abc123", name: "Meditate", days: [0, 1, 2, 3, 4, 5, 6], mtime: 5, del: false }));
  M.setTick(mine, "abc123", "2024-03-03", true, 6);
  const before = JSON.stringify(mine);
  const r = I.apply(mine, res, { keys: ["gym"], now: 100 });
  assert.equal(JSON.stringify(mine), before);               // input untouched
  assert.equal(r.added, 1);
  assert.deepEqual(r.data.habits.map((h) => h.name).sort(), ["Gym", "Meditate"]);
  assert.deepEqual(r.data.habits.find((h) => h.id === "abc123"), JSON.parse(before).habits[0]);
  assert.equal(r.data.comps.filter((c) => c.habitId === "abc123").length, 1);
});

test("undo: the visible data is what it was, and a synced copy cannot win", async () => {
  const res = I.parseText(HABITIFY_CSV, "habitify.csv");
  const mine = empty();
  mine.habits.push(M.normHabit({ id: "abc123", name: "Mine", days: [], mtime: 5, del: false }));
  M.setTick(mine, "abc123", "2024-03-03", true, 6);
  const r = I.apply(mine, res, { now: 1000 });
  const back = I.undo(r.data, r.undo, 2000);
  assert.deepEqual(HC.living(back).map((h) => h.id), ["abc123"]);
  // the user's day is untouched; imported days are empty tombstones
  assert.deepEqual(back.comps.find((c) => c.habitId === "abc123"), mine.comps[0]);
  assert.equal(back.comps.filter((c) => c.habitId !== "abc123").every((c) => c.del && !c.v && !(c.sk && c.sk[0])), true);
  // which the canonical form prunes once they are 30 days old
  const later = M.canon(Object.assign({}, back, { comps: back.comps.concat([{ id: "abc123|2030-01-01", habitId: "abc123", date: "2030-01-01", mtime: 2000 + 31 * 864e5, del: false }]) }));
  assert.equal(later.comps.length, 2);
  // the imported data reached the cloud before Undo: the merge keeps
  // the imported habits deleted
  const merged = M.mergeData(back, r.data);
  assert.deepEqual(HC.living(merged).map((h) => h.id), ["abc123"]);
  assert.equal(merged.comps.filter((c) => c.habitId !== "abc123" && !c.del).length, 0);
  // undo of a re-import into a habit that stays alive
  const r1 = I.apply(empty(), res, { now: 1000 });
  const runId = I.idOf("habitify", "run");
  const less = JSON.parse(JSON.stringify(r1.data));
  less.comps = less.comps.filter((c) => c.date !== "2024-03-03");
  const r2 = I.apply(less, res, { now: 3000 });
  assert.equal(r2.comps, 1);
  const back2 = I.undo(r2.data, r2.undo, 4000);
  assert.equal(HC.valueOn(back2, runId, "2024-03-03"), null);
  assert.equal(HC.living(back2).length, 2);
  assert.ok(M.normalize(back2));
});

test("apply output passes the model's normalize and merge unchanged", async () => {
  const res = I.parseText(HABITICA_JSON, "x.json");
  const r = I.apply(empty(), res, { now: 1e12 });
  const n = M.normalize(r.data);
  assert.equal(n.habits.length, r.data.habits.length);
  assert.equal(n.comps.length, r.data.comps.length);
  assert.deepEqual(M.canon(M.mergeData(r.data, r.data)), M.canon(r.data));
});
