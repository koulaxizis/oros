// Habits wave 4: measurable habits, X times per week / month, habit
// strength, skipped days, notes, reminders and the Steps row.
// habits/core.js (rules), habits/model.js (shape, merge, writes),
// habits/steps.js (the Steps feed), and the Habits rows of the phone
// bridge, Today and search.
// Run: node --test tests/

"use strict";

process.env.TZ = "Europe/Athens";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const root = path.join(__dirname, "..");
const C = globalThis.OrosHabitsCore = require(path.join(root, "habits", "core.js"));
const M = require(path.join(root, "habits", "model.js"));
const S = require(path.join(root, "habits", "steps.js"));
const P = require(path.join(root, "phone.js"));
const TODAY = require(path.join(root, "habits", "today.js"));
const SEARCH = require(path.join(root, "habits", "search.js"));

const H = (o) => Object.assign({ id: "h1", name: "Read", icon: "book", color: "#e06c75", days: [0, 1, 2, 3, 4, 5, 6], mtime: 1, del: false }, o);
const tick = (hid, d, o) => Object.assign({ id: hid + "|" + d, habitId: hid, date: d, mtime: 5, del: false }, o);
const days = (from, n) => { const out = []; for (let i = 0; i < n; i++) out.push(C.addDays(from, i)); return out; };

// ---------- shape + load ----------
test("model: v1 data loads unchanged; new fields normalised, bad ones dropped", () => {
  const v1 = { ver: 1, habits: [H({ id: "a" }), { id: "b", name: "", mtime: 1 }], comps: [tick("a", "2026-10-01")] };
  const n = M.normalize(v1);
  assert.equal(n.ver, 2);
  assert.deepEqual(n.habits, [H({ id: "a" })]);
  assert.deepEqual(n.comps, [tick("a", "2026-10-01")]);
  const h = M.normHabit(H({ num: { t: 10, u: "  pages  ", c: "x", s: -1 }, per: ["w", 3], rem: 480, days: [1, 2] }));
  assert.deepEqual(h.num, { u: "pages", t: 10, c: "ge", s: 1 });
  assert.deepEqual(h.per, ["w", 3]);
  assert.deepEqual(h.days, [], "a per-period habit has no weekdays");
  assert.equal(h.rem, 480);
  const bad = M.normHabit(H({ num: { t: 0 }, per: ["w", 9], rem: 2000 }));
  assert.equal("num" in bad || "per" in bad || "rem" in bad, false);
  const c = M.normComp(tick("a", "2026-10-02", { v: { dev1: [3, 7], "BAD!": [1, 1], dev2: ["x", 1] }, sk: [1, 9], nt: ["  hi  ", 4] }));
  assert.deepEqual(c.v, { dev1: [3, 7] });
  assert.deepEqual(c.sk, [1, 9]);
  assert.deepEqual(c.nt, ["hi", 4]);
  assert.equal(M.normalize({ habits: "x", comps: [] }), null, "shape invalid → rescue path");
});

// ---------- merge ----------
test("merge: symmetric, idempotent, canonical; field by field per day", () => {
  const base = { ver: 2, habits: [H({ num: { t: 10, u: "pages", c: "ge", s: 1 } })], comps: [] };
  const a = JSON.parse(JSON.stringify(base)), b = JSON.parse(JSON.stringify(base));
  // device A adds 3 pages and a note, device B adds 4 pages and skips another day, offline
  M.addValue(a, "h1", "2026-10-10", "deva", 3, 100);
  M.setNote(a, "h1", "2026-10-10", "on the train", 101);
  M.addValue(b, "h1", "2026-10-10", "devb", 4, 102);
  M.setSkip(b, "h1", "2026-10-11", true, 103);
  const ab = M.mergeData(a, b), ba = M.mergeData(b, a);
  assert.deepEqual(ab, ba, "symmetric");
  assert.deepEqual(M.mergeData(ab, ab), ab, "idempotent");
  assert.deepEqual(M.canon(ab), ab, "canonical");
  assert.equal(C.valueOn(ab, "h1", "2026-10-10"), 7, "both devices' pages count");
  assert.equal(C.noteOn(ab, "h1", "2026-10-10"), "on the train");
  assert.equal(C.isSkipped(ab, "h1", "2026-10-11"), true);
  // a typed total on B sets B's share so the day shows the total
  M.setValue(ab, "h1", "2026-10-10", "devb", 12, 200);
  assert.equal(C.valueOn(ab, "h1", "2026-10-10"), 12);
  assert.deepEqual(ab.comps.find((c) => c.date === "2026-10-10").v, { deva: [3, 100], devb: [9, 200] });
});

test("merge: tick LWW (tie → not ticked), notes and skips by their own stamp", () => {
  const a = { ver: 2, habits: [H()], comps: [tick("h1", "2026-10-01", { mtime: 10, nt: ["a", 5] })] };
  const b = { ver: 2, habits: [H()], comps: [tick("h1", "2026-10-01", { mtime: 10, del: true, nt: ["b", 6], sk: [0, 2] })] };
  const m = M.mergeData(a, b);
  assert.deepEqual(m.comps[0], { id: "h1|2026-10-01", habitId: "h1", date: "2026-10-01", mtime: 10, del: true, sk: [0, 2], nt: ["b", 6] });
  assert.deepEqual(M.mergeData(b, a), m);
  // habits: newer edit wins, equal stamps → tombstone (R17 / HB-10)
  const x = M.mergeData({ habits: [H({ mtime: 3, name: "New" })], comps: [] }, { habits: [H({ mtime: 2 })], comps: [] });
  assert.equal(x.habits[0].name, "New");
  const y = M.mergeData({ habits: [H({ mtime: 3, del: true })], comps: [] }, { habits: [H({ mtime: 3 })], comps: [] });
  assert.equal(y.habits[0].del, true);
});

test("canon: empty completion rows older than 30 days prune; rows with a value, skip or note stay", () => {
  const day = 86400000, now = 100 * day;
  const d = { ver: 2, habits: [H()], comps: [
    tick("h1", "2026-01-01", { mtime: now - 40 * day, del: true }),
    tick("h1", "2026-01-02", { mtime: now - 40 * day, del: true, nt: ["kept", now - 40 * day] }),
    tick("h1", "2026-01-03", { mtime: 0, del: true, sk: [1, now - 50 * day] }),
    tick("h1", "2026-01-04", { mtime: now, del: true })
  ] };
  assert.deepEqual(M.canon(d).comps.map((c) => c.date), ["2026-01-02", "2026-01-03", "2026-01-04"]);
});

test("writes: skip un-ticks, tick un-skips, stamps only move forward; settings record", () => {
  const db = { ver: 2, habits: [H()], comps: [] };
  M.setTick(db, "h1", "2026-10-01", true, 50);
  M.setSkip(db, "h1", "2026-10-01", true, 40);
  let c = db.comps[0];
  assert.equal(c.del, true);
  assert.deepEqual(c.sk, [1, 40]);
  assert.ok(c.mtime > 50, "stamp moved forward past the older clock");
  M.setTick(db, "h1", "2026-10-01", true, 60);
  assert.equal(C.isDone(db, "h1", "2026-10-01"), true);
  assert.equal(C.isSkipped(db, "h1", "2026-10-01"), false);
  M.setTick(db, "h1", "2026-10-01", undefined, 70);
  assert.equal(C.isDone(db, "h1", "2026-10-01"), false, "undefined toggles");
  assert.equal(M.addValue(db, "h1", "2026-10-02", "deva", -5, 80) && C.valueOn(db, "h1", "2026-10-02"), 0, "never below 0");
  assert.deepEqual(M.settingsOf(db), { st: 1, sg: 8000, m: 0 });
  M.setSettings(db, { st: false, sg: 12000 }, 90);
  assert.deepEqual(db.set, { st: 0, sg: 12000, m: 90 });
  const m = M.mergeData({ habits: [], comps: [], set: { st: 1, sg: 9000, m: 80 } }, db);
  assert.deepEqual(m.set, db.set, "newer settings win");
});

// ---------- rules ----------
test("measurable: at least / at most targets, progress", () => {
  const ge = H({ id: "p", num: { t: 10, u: "pages", c: "ge", s: 1 } });
  const le = H({ id: "c", num: { t: 2, u: "coffees", c: "le", s: 1 } });
  const d = { habits: [ge, le], comps: [
    tick("p", "2026-10-01", { del: true, v: { deva: [6, 1], devb: [4, 1] } }),
    tick("p", "2026-10-02", { del: true, v: { deva: [5, 1] } }),
    tick("c", "2026-10-01", { del: true, v: { deva: [3, 1] } }),
    tick("c", "2026-10-02", { del: true, v: { deva: [0, 1] } })
  ] };
  assert.equal(C.isDone(d, "p", "2026-10-01"), true);
  assert.equal(C.isDone(d, "p", "2026-10-02"), false);
  assert.equal(C.progress(d, ge, "2026-10-02"), 0.5);
  assert.equal(C.isDone(d, "c", "2026-10-01"), false, "3 coffees > 2");
  assert.equal(C.isDone(d, "c", "2026-10-02"), true, "a logged 0 meets 'at most'");
  assert.equal(C.isDone(d, "c", "2026-10-03"), false, "nothing logged is not done");
  assert.equal(Math.round(C.progress(d, le, "2026-10-01") * 100), 67);
});

test("periods: X per week counts Monday–Sunday, X per month the calendar month; due until met", () => {
  const h = H({ id: "g", days: [], per: ["w", 3] });
  const d = { habits: [h], comps: [tick("g", "2026-10-12"), tick("g", "2026-10-13", { del: true, sk: [1, 5] })] };
  assert.equal(C.periodStart("2026-10-14", "w"), "2026-10-12");
  assert.equal(C.periodEnd("2026-10-14", "w"), "2026-10-18");
  assert.equal(C.periodEnd("2026-02-10", "m"), "2026-02-28");
  assert.deepEqual(C.periodCount(d, h, "2026-10-14"), { done: 1, skip: 1 });
  assert.equal(C.periodMet(d, h, "2026-10-14"), false);
  assert.deepEqual(C.dueOn(d, "2026-10-14").map((x) => x.id), ["g"]);
  d.comps.push(tick("g", "2026-10-14"));
  assert.equal(C.periodMet(d, h, "2026-10-15"), true, "a skipped day counts toward the week");
  assert.deepEqual(C.dueOn(d, "2026-10-15"), [], "met for the week → not due");
  assert.equal(C.isScheduledOn(h, "2026-10-15"), false);
});

test("streaks: skipped days don't break; periods counted in weeks", () => {
  const h = H({ id: "d" });
  const comps = days("2026-10-01", 10).map((x) => tick("d", x));
  comps[4] = tick("d", comps[4].date, { del: true, sk: [1, 9] });   // 2026-10-05 skipped
  const d = { habits: [h], comps };
  assert.deepEqual(C.streaks(d, h, "2026-10-10"), { cur: 9, best: 9, unit: "d" });
  assert.deepEqual(C.streaks(d, h, "2026-10-11"), { cur: 9, best: 9, unit: "d" }, "today not done is not a break");
  assert.deepEqual(C.streaks(d, h, "2026-10-12"), { cur: 0, best: 9, unit: "d" });
  const w = H({ id: "w", days: [], per: ["w", 2] });
  const wd = { habits: [w], comps: ["2026-09-21", "2026-09-23", "2026-09-28", "2026-09-29", "2026-10-06", "2026-10-12", "2026-10-13"].map((x) => tick("w", x)) };
  assert.deepEqual(C.streaks(wd, w, "2026-10-14"), { cur: 1, best: 2, unit: "w" }, "week of 5 Oct had one: the run restarts");
  const fixed = H({ id: "f", days: [0, 2, 4] });   // Mon Wed Fri
  const fd = { habits: [fixed], comps: ["2026-10-05", "2026-10-07", "2026-10-09", "2026-10-12"].map((x) => tick("f", x)) };
  assert.equal(C.streaks(fd, fixed, "2026-10-13").cur, 4, "unscheduled days are transparent");
});

test("strength: grows with check-ins, one missed day costs a little, a skip freezes", () => {
  const h = H({ id: "s" });
  const done = days("2026-07-01", 100).map((x) => tick("s", x));
  const d = { habits: [h], comps: done };
  const today = C.addDays("2026-07-01", 99);
  const full = C.score(d, h, today);
  assert.ok(full >= 99, "100 days in a row ≈ 100%: " + full);
  const miss = { habits: [h], comps: done.filter((c) => c.date !== C.addDays(today, -1)) };
  const after = C.score(miss, h, today);
  assert.ok(after < full && after >= 90, "one miss: a few points, not a reset (" + after + ")");
  const skip = { habits: [h], comps: done.map((c) => c.date === C.addDays(today, -1) ? tick("s", c.date, { del: true, sk: [1, 9] }) : c) };
  const sk = C.score(skip, h, today);
  assert.ok(sk > after && full - sk <= 1, "a skipped day freezes the score (" + sk + ")");
  const half = { habits: [h], comps: days("2026-07-01", 100).filter((x, i) => i % 2 === 0).map((x) => tick("s", x)) };
  const hs = C.score(half, h, today);
  assert.ok(hs > 35 && hs < 65, "every other day ≈ half (" + hs + ")");
  assert.equal(C.score({ habits: [h], comps: [] }, h, today), 0);
  const ser = C.scoreSeries(d, h, today);
  assert.equal(ser.length, 100);
  assert.ok(ser.every((p, i) => i === 0 || p.s >= ser[i - 1].s), "monotonic while kept");
  const wk = H({ id: "k", days: [], per: ["w", 3] });
  const wkd = { habits: [wk], comps: days("2026-07-06", 98).filter((x) => [0, 2, 4].includes(C.schedIdx(x))).map((x) => tick("k", x)) };
  assert.ok(C.score(wkd, wk, C.addDays("2026-07-06", 97)) >= 90, "3 a week, every week → strong");
});

test("reminders: due from the time for 4 hours on days the habit still needs", () => {
  const at = (d, h, m) => new Date(2026, 9, d, h, m || 0).getTime();
  const read = H({ id: "r", rem: 8 * 60 });
  const gym = H({ id: "g", name: "Gym", days: [], per: ["w", 1], rem: 18 * 60 });
  const none = H({ id: "n", name: "No rem" });
  const data = { habits: [read, gym, none], comps: [tick("g", "2026-10-12")] };
  assert.deepEqual(C.dueReminders(data, at(14, 7, 59)), []);
  assert.deepEqual(C.dueReminders(data, at(14, 8, 30)), [{ id: "r", name: "Read", min: 480, key: "r-r-2026-10-14" }]);
  assert.deepEqual(C.dueReminders(data, at(14, 12, 0)), [], "after 4 hours: dropped");
  assert.deepEqual(C.dueReminders(data, at(14, 18, 5)), [], "the week's gym is met");
  data.comps.push(tick("r", "2026-10-15"));
  assert.deepEqual(C.dueReminders(data, at(15, 9)), [], "done → quiet");
  const mwf = H({ id: "m", days: [0, 2, 4], rem: 600 });
  assert.equal(C.needsReminder({ habits: [mwf], comps: [] }, mwf, "2026-10-13"), false, "Tuesday is not its day");
  assert.equal(C.needsReminder({ habits: [mwf], comps: [tick("m", "2026-10-14", { del: true, sk: [1, 1] })] }, mwf, "2026-10-14"), false, "skipped");
});

test("phone bridge: habit reminders for the next 48 hours, same key as the shell", () => {
  const now = new Date(2026, 9, 14, 8, 0).getTime();
  const data = { habits: [H({ id: "r", rem: 9 * 60 }), H({ id: "x", rem: 7 * 60 }), H({ id: "z", del: true, rem: 600 })],
                 comps: [tick("r", "2026-10-15")] };
  const rows = P.reminderRows({ lang: "en", habits: { core: C, data } }, now);
  assert.deepEqual(rows.map((r) => [r.id, new Date(r.at).getDate(), new Date(r.at).getHours()]), [
    ["habits:r-r-2026-10-14", 14, 9],
    ["habits:r-x-2026-10-15", 15, 7],
    ["habits:r-x-2026-10-16", 16, 7]
  ], "today's 07:00 has passed, the 15th is already done, 16th 09:00 is past 48 h, deleted habits ring never");
  assert.deepEqual([rows[0].ns, rows[0].kind, rows[0].body, rows[0].link], ["habits", "note", "Time for: Read", "habits:0"]);
  assert.equal(rows[0].id, "habits:" + C.dueReminders(data, now + 3600000)[0].key);
});

// ---------- providers ----------
test("Today: X per week due until met, measurable shows the value; search shows the schedule", async () => {
  const today = "2026-10-14";
  const data = { ver: 2, habits: [
    H({ id: "a", name: "Pages", num: { t: 10, u: "pages", c: "ge", s: 1 } }),
    H({ id: "b", name: "Gym", days: [], per: ["w", 2] }),
    H({ id: "c", name: "Coffee", days: [], per: ["m", 4], num: { t: 2, u: "", c: "le", s: 1 } })
  ], comps: [tick("a", today, { del: true, v: { deva: [4, 1] } }), tick("b", "2026-10-12"), tick("b", "2026-10-13")] };
  const rows = TODAY.collect({ today, readJSON: () => data });
  assert.deepEqual(rows.map((r) => r.title), ["Pages · 4 / 10 pages", "Coffee · ≤ 0 / 2"]);
  const hits = SEARCH.search({ lang: "en", readJSON: () => data });
  assert.deepEqual(hits.map((h) => h.text), ["Every day · at least 10 pages", "2 times / week", "4 times / month · at most 2"]);
  const el = SEARCH.search({ lang: "el", readJSON: () => data });
  assert.equal(el[1].text, "2 φορές / εβδομάδα");
});

test("Steps row: highest reading per local day, tombstones and the Health switch honoured", () => {
  const at = (d, h) => new Date(2026, 9, d, h).getTime();
  const health = { en: [
    { id: "hc-st-20261012", t: "st", at: at(12, 23), v: [9500], m: 5 },
    { id: "e1", t: "st", at: at(12, 10), v: [3000], m: 5 },
    { id: "e2", t: "st", at: at(13, 10), v: [4000], m: 5 },
    { id: "e3", t: "st", at: at(14, 10), v: [7000], m: 5 },
    { id: "e4", t: "wt", at: at(14, 10), v: [70000], m: 5 }
  ], ty: [], tombs: { "en:e3": 6 } };
  assert.deepEqual(S.stepsByDay(health), { "2026-10-12": 9500, "2026-10-13": 4000 });
  const f = S.feedFrom(health, null);
  assert.deepEqual(f, { days: { "2026-10-12": true }, vals: { "2026-10-12": 9500, "2026-10-13": 4000 }, goal: 8000, first: "2026-10-12" });
  assert.deepEqual(S.feedFrom(health, { set: { st: 1, sg: 3000, m: 1 } }).days, { "2026-10-12": true, "2026-10-13": true });
  assert.equal(S.feedFrom(health, { set: { st: 0, sg: 8000, m: 1 } }), null, "switched off in Habits");
  assert.equal(S.feedFrom(Object.assign({}, health, { ty: [{ id: "st", h: 1, m: 1 }] }), null), null, "hidden in Health");
  assert.equal(S.feedFrom({ en: [] }, null), null, "no steps → no row");
  assert.equal(S.FEED.id, "steps");
  assert.equal(S.FEED.app, "health");
});

test("merge: a row stripped by an older orOS (same stamp) never wins over the full one", () => {
  const full = H({ mtime: 7, num: { u: "pages", t: 10, c: "ge", s: 1 }, rem: 480 });
  const old = H({ mtime: 7 });
  const comp = tick("h1", "2026-10-01", { del: true, mtime: 0, v: { deva: [4, 9] }, nt: ["x", 9] });
  const stripped = { id: comp.id, habitId: "h1", date: comp.date, mtime: 0, del: true };
  const m1 = M.mergeData({ habits: [full], comps: [comp] }, { habits: [old], comps: [stripped] });
  const m2 = M.mergeData({ habits: [old], comps: [stripped] }, { habits: [full], comps: [comp] });
  assert.deepEqual(m1, m2);
  assert.deepEqual(m1.habits[0], full);
  assert.deepEqual(m1.comps[0].v, { deva: [4, 9] });
  assert.deepEqual(m1.comps[0].nt, ["x", 9]);
});
