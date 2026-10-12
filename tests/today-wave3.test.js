// Today wave 3: the shared read-only rules moved out of Habits,
// Workouts and the Calendar — habits/core.js, the training plan in
// fitness/core.js, OrosMealsCore.planByDay — locked against the code
// they replaced (golden tests: same input, same answer), the new
// Health reminder times (OrosHealthCore.timesOn), and the Today
// providers of Mail (counts only), Meal Planner, Budget, Health,
// Workouts and Habits.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const req = (p) => require(path.join(__dirname, "..", p));

const A = req("today/agg.js");
const HC = globalThis.OrosHabitsCore = req("habits/core.js");
const FC = req("fitness/core.js");
globalThis.OrosFitnessCore = { plannedOn: FC.plannedOn, doneOn: FC.doneOn };
const MC = globalThis.OrosMealsCore = req("meals/core.js").OrosMealsCore;
const BF = globalThis.OrosBudgetFeed = req("budget/feed.js");
const H = globalThis.OrosHealthCore = req("health/core.js");
const P = {};
["habits", "fitness", "meals", "budget", "health", "mail"].forEach((id) => { P[id] = req(id + "/today.js"); });

const pad = (n) => String(n).padStart(2, "0");
const ymdOf = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
function ctx(store, today, lang, now) {
  return {
    today, horizon: A.HORIZON, now: now || Date.now(), lang: lang || "en",
    readJSON: (k) => (k in store ? JSON.parse(JSON.stringify(store[k])) : null),
    readRaw: (k) => (k in store ? JSON.stringify(store[k]) : null),
    addDays: A.addDays, diff: A.diff
  };
}
let seed = 23;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const day = () => `${2025 + rnd(3)}-${pad(1 + rnd(12))}-${pad(1 + rnd(28))}`;
// Every row a provider gives must survive today/agg.js as it is.
async function viaAgg(provider, c) {
  const res = await A.run([provider], c, {});
  return res.rows;
}

// ---------------------------------------------------------------
// The code these rules replaced (verbatim logic, kept only as the
// reference the shared copies must keep matching)
// ---------------------------------------------------------------
function legacyHabitScheduled(habit, d) {           // habits.js isScheduledOn(habit, Date)
  if (!habit.days.length) return false;
  return habit.days.indexOf((d.getDay() + 6) % 7) !== -1;
}
function legacyHabitDone(db, habitId, dateK) {      // habits.js isDone
  for (let i = 0; i < db.comps.length; i++) {
    const c = db.comps[i];
    if (c.id === habitId + "|" + dateK) return !c.del;
  }
  return false;
}
function legacyCalHabitDone(data, habitId, dateStr) {   // calendar.js isHabitDoneOn
  const key = habitId + "|" + dateStr;
  for (let i = 0; i < data.comps.length; i++) {
    const c = data.comps[i];
    if (c.id === key && !c.del) return true;
  }
  return false;
}
function legacyTrainToday(data, date) {             // fitness.js renderTrain "Today"
  const today = (date.getDay() + 6) % 7, out = [];
  data.pg.forEach((p) => {
    p.days.forEach((d) => { if (d.wd.indexOf(today) >= 0 && d.it.length) out.push(p.id + "/" + d.id); });
  });
  return out;
}
const SLOTN = { b: "Breakfast", l: "Lunch", d: "Dinner", s: "Snack", x: "Extra" };
function legacyMealsRows(raw, lang) {               // calendar.js mealsRows
  const d = MC.mergeMeals(raw, raw), names = {}, rows = {};
  MC.allRecipes(d, lang).forEach((r) => { names[r.id] = r.t; });
  d.set.sl.forEach((sl, order) => {
    Object.keys(d.pl).forEach((k) => {
      const i = k.indexOf("|"), dy = k.slice(0, i);
      if (k.slice(i + 1) !== sl) return;
      const what = d.pl[k].it.map((it) => (it.r ? names[it.r] : it.t)).filter(Boolean);
      if (!what.length) return;
      (rows[dy] = rows[dy] || []).push({ key: sl, order, title: (d.set.nm[sl] || SLOTN[sl]) + ": " + what.join(", ") });
    });
  });
  return rows;
}

// ---------------------------------------------------------------
// Golden tests
// ---------------------------------------------------------------
test("habits: schedule and done exactly as the app and the Calendar had them (fuzz)", () => {
  for (let n = 0; n < 300; n++) {
    const habits = [], comps = [];
    for (let i = 0; i < 1 + rnd(6); i++) {
      const days = [];
      for (let w = 0; w < 7; w++) if (rnd(3) === 0) days.push(w);
      habits.push({ id: "h" + i, name: "H" + i, days, del: rnd(8) === 0 });
    }
    const dates = [];
    for (let i = 0; i < 6; i++) dates.push(day());
    habits.forEach((h) => dates.forEach((dt) => {
      if (rnd(3) === 0) comps.push({ id: h.id + "|" + dt, habitId: h.id, date: dt, del: rnd(4) === 0 });
    }));
    const db = { ver: 1, habits, comps };
    habits.forEach((h) => dates.forEach((dt) => {
      const p = dt.split("-");
      assert.equal(HC.isScheduledOn(h, dt), legacyHabitScheduled(h, new Date(+p[0], +p[1] - 1, +p[2])), h.id + " " + dt);
      assert.equal(HC.isDone(db, h.id, dt), legacyHabitDone(db, h.id, dt));
      assert.equal(HC.isDone(db, h.id, dt), legacyCalHabitDone(db, h.id, dt));
    }));
  }
  assert.equal(HC.schedIdx("2026-10-12"), 0);          // a Monday
  assert.equal(HC.schedIdx("2026-10-11"), 6);          // a Sunday
  assert.equal(HC.schedIdx("nope"), -1);
  assert.equal(HC.isScheduledOn({ days: [] }, "2026-10-12"), false);   // flexible
});

test("workouts: today's program days exactly as the Train tab had them (fuzz)", () => {
  for (let n = 0; n < 300; n++) {
    const pg = [];
    for (let i = 0; i < rnd(4); i++) {
      const days = [];
      for (let k = 0; k < 1 + rnd(4); k++) {
        const wd = [];
        for (let w = 0; w < 7; w++) if (rnd(4) === 0) wd.push(w);
        days.push({ id: "d" + k, n: rnd(2) ? "Leg day" : "", wd, it: rnd(5) === 0 ? [] : [{ e: "x-squat", s: 3 }] });
      }
      pg.push({ id: "p" + i, m: 1, n: "Prog " + i, days });
    }
    const data = { ver: 1, ex: [], pg, wo: [], bm: [], set: null, tombs: {} };
    const dt = day(), p = dt.split("-");
    const got = FC.plannedOn(data, dt).map((r) => r.pg.id + "/" + r.day.id);
    assert.deepEqual(got, legacyTrainToday(data, new Date(+p[0], +p[1] - 1, +p[2])));
  }
});

test("meals: the plan by day exactly as the Calendar feed had it (fuzz)", () => {
  const base = new Date();
  const near = (i) => ymdOf(new Date(base.getFullYear(), base.getMonth(), base.getDate() + i));
  for (let n = 0; n < 150; n++) {
    const pl = {};
    for (let i = 0; i < 8; i++) {
      const k = near(rnd(9) - 4) + "|" + ["b", "l", "d", "s", "x"][rnd(5)];
      const it = [];
      for (let j = 0; j < rnd(3); j++) it.push(rnd(2) ? { r: rnd(3) ? "s-fasolada" : "gone-one", sv: 2 } : { t: "Salad " + j });
      pl[k] = { m: 1 + rnd(5), it };
    }
    const set = { m: 1, dt: [], sl: rnd(2) ? ["b", "l", "d"] : ["l", "d", "s", "x"], nm: rnd(2) ? { d: "Supper" } : {}, ws: 1 };
    const raw = Object.assign(MC.emptyData(), { pl, set });
    const lang = rnd(2) ? "en" : "el";
    const got = MC.planByDay(raw, lang), legacy = legacyMealsRows(raw, lang);
    assert.deepEqual(Object.keys(got).sort(), Object.keys(legacy).sort());
    Object.keys(got).forEach((dy) => {
      assert.deepEqual(got[dy].map((r) => ({ key: r.slot, order: r.order, title: (r.name || SLOTN[r.slot]) + ": " + r.what.join(", ") })), legacy[dy]);
    });
  }
  assert.deepEqual(MC.planByDay(null, "en"), {});
});

// ---------------------------------------------------------------
// Health reminder times (new)
// ---------------------------------------------------------------
test("health: today's reminder times, a reading early or late ticks its slot", () => {
  const now = new Date(2026, 9, 12, 21, 0).getTime();
  const at = (h, m) => new Date(2026, 9, 12, h, m).getTime();
  const d = H.merge({
    ty: [{ id: "bp", m: 1, r: [480, 1200] }, { id: "wt", m: 1, r: [420], h: 1 }, { id: "cgr", m: 1, n: "Steps", r: [600] }],
    en: [{ id: "e1", m: 1, t: "bp", at: at(7, 15), v: [120, 80, 60] }]   // 45 min early for 08:00
  }, {});
  assert.deepEqual(H.timesOn(d, now), [
    { t: "bp", min: 480, done: true },
    { t: "cgr", min: 600, done: false },
    { t: "bp", min: 1200, done: false }                     // hidden "wt" left out
  ]);
  // a late reading (19:30) belongs to the 20:00 slot window (from 19:00), not to 08:00
  const d2 = H.merge(d, { en: [{ id: "e2", m: 1, t: "bp", at: at(19, 30), v: [120, 80, 60] }] });
  assert.deepEqual(H.timesOn(d2, now).filter((s) => s.t === "bp").map((s) => s.done), [true, true]);
  // yesterday's reading never counts
  const d3 = H.merge({ ty: [{ id: "bp", m: 1, r: [480] }], en: [{ id: "e3", m: 1, t: "bp", at: at(7, 59) - 86400000, v: [120, 80, 60] }] }, {});
  assert.deepEqual(H.timesOn(d3, now), [{ t: "bp", min: 480, done: false }]);
  assert.deepEqual(H.timesOn(null, now), []);
});

// ---------------------------------------------------------------
// Providers
// ---------------------------------------------------------------
test("habits provider: scheduled today and not ticked; flexible, deleted and done ones out", async () => {
  const today = "2026-10-12";                              // Monday
  const store = { "oros-habits-data": { ver: 1,
    habits: [
      { id: "h1", name: "Read", days: [0, 2] },
      { id: "h2", name: "Run", days: [0] },
      { id: "h3", name: "Any day", days: [] },
      { id: "h4", name: "Gone", days: [0], del: true },
      { id: "h5", name: "Tuesday", days: [1] }
    ],
    comps: [{ id: "h2|2026-10-12", habitId: "h2", date: today }] } };
  const rows = await viaAgg(P.habits, ctx(store, today, "el"));
  assert.deepEqual(rows.map((r) => [r.title, r.text, r.kind, r.due, JSON.stringify(r.target)]),
    [["Read", "", "task", today, '{"habit":"h1"}']]);
  assert.deepEqual(await viaAgg(P.habits, ctx({}, today)), []);
});

test("workouts provider: today's program days until a workout of that day is finished", async () => {
  const today = "2026-10-12";                              // Monday = 0
  const data = { ver: 1, ex: [], wo: [], bm: [], set: null, tombs: {}, pg: [
    { id: "ppl", m: 1, n: "Push Pull Legs", days: [
      { id: "a", n: "Push", wd: [0, 3], it: [{ e: "x-bench", s: 3 }, { e: "x-ohp", s: 3 }] },
      { id: "b", n: "", wd: [0], it: [{ e: "x-row", s: 3 }] },
      { id: "c", n: "Rest", wd: [0], it: [] }
    ] }
  ] };
  let rows = await viaAgg(P.fitness, ctx({ "oros-fitness-data": data }, today));
  assert.deepEqual(rows.map((r) => [r.title, r.text, JSON.stringify(r.target)]), [
    ["Push", "Push Pull Legs · 2 exercises", '{"train":true}'],
    ["Day 2", "Push Pull Legs · 1 exercise", '{"train":true}']
  ]);
  data.wo = [{ id: "w1", m: 1, d: today, st: 1, en: 2, p: "ppl", pd: "a" },
             { id: "w2", m: 1, d: today, st: 1, en: 0, p: "ppl", pd: "b" }];   // still running
  rows = await viaAgg(P.fitness, ctx({ "oros-fitness-data": data }, today, "el"));
  assert.deepEqual(rows.map((r) => [r.title, r.text]), [["Ημέρα 2", "Push Pull Legs · 1 άσκηση"]]);
});

test("meals provider: today's plan as top lines, the user's slot names first", async () => {
  const today = ymdOf(new Date());
  const raw = Object.assign(MC.emptyData(), {
    pl: { [today + "|d"]: { m: 2, it: [{ r: "s-fasolada", sv: 4 }, { t: "Salad" }] },
          [today + "|b"]: { m: 2, it: [{ t: "Toast" }] },
          [A.addDays(today, 1) + "|l"]: { m: 2, it: [{ t: "Tomorrow" }] } },
    set: { m: 1, dt: [], sl: ["b", "l", "d"], nm: { b: "Early" }, ws: 1 } });
  const rows = await viaAgg(P.meals, ctx({ "oros-meals-data": raw }, today, "el"));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.kind), ["info", "info"]);
  assert.equal(rows[0].title, "Early: Toast");
  assert.match(rows[1].title, /^Βραδινό: .+, Salad$/);
  assert.deepEqual(rows[1].target, { day: today });
});

test("budget provider: recurring entries today and the next days, with the amount", async () => {
  const today = "2026-10-12";
  const data = { rec: [
    { id: "rent", m: 1, k: "o", a: 50000, c: "o-home", n: "Rent", f: "m", s: "2026-01-13" },
    { id: "pay", m: 1, k: "i", a: 120000, c: "i-salary", n: "", f: "m", s: "2026-01-12" },
    { id: "old", m: 1, k: "o", a: 100, c: "o-other", n: "Ended", f: "m", s: "2025-01-12", e: "2025-12-31" },
    { id: "del", m: 1, k: "o", a: 100, c: "o-other", n: "Deleted", f: "w", s: "2026-10-12" }
  ], cats: [], set: { cur: "EUR" }, tombs: { "rec:del": 5 } };
  const rows = await viaAgg(P.budget, ctx({ "oros-budget-data": data }, today));
  assert.deepEqual(rows.map((r) => [r.due, r.title, r.kind, JSON.stringify(r.target)]), [
    ["2026-10-12", "Salary", "event", '{"rec":"pay"}'],
    ["2026-10-13", "Rent", "event", '{"rec":"rent"}']
  ]);
  assert.match(rows[0].text, /^\+.*1,200\.00/);
  assert.match(rows[1].text, /^−.*500\.00/);
});

test("health provider: open reminder times of today with their time; a reading ticks them", async () => {
  const now = new Date(2026, 9, 12, 9, 0).getTime(), today = "2026-10-12";
  const data = { ty: [{ id: "bp", m: 1, r: [480, 1200] }, { id: "cgr", m: 1, n: "Steps", r: [600] }],
                 en: [{ id: "e1", m: 1, t: "bp", at: new Date(2026, 9, 12, 8, 5).getTime(), v: [120, 80, 60] }] };
  const rows = await viaAgg(P.health, ctx({ "oros-health-data": data }, today, "el", now));
  assert.deepEqual(rows.map((r) => [r.time, r.title, r.kind, JSON.stringify(r.target)]), [
    ["10:00", "Steps", "task", '{"kind":"cgr"}'],
    ["20:00", "Πίεση", "task", '{"kind":"bp"}']
  ]);
  // the clock already in another day than the summary: nothing (no stale ticks)
  assert.deepEqual(await viaAgg(P.health, ctx({ "oros-health-data": data }, "2026-10-13", "en", now)), []);
});

test("mail provider: unread counts only, per account, with the time of the count", () => {
  const today = "2026-10-12";
  const accts = P.mail.accounts({ accounts: [
    { id: "acct000001", m: 1, name: "Work", email: "me@work.gr" },
    { id: "acct000002", m: 1, name: "", email: "me@home.gr" },
    { id: "acct000003", m: 1, name: "", email: "none@x.gr" },
    { id: "acct000004", m: 1, name: "Gone", email: "gone@x.gr" }
  ], tombs: { acct000004: 2 } });
  assert.deepEqual(accts.map((a) => a.id), ["acct000001", "acct000002", "acct000003"]);
  const recs = {
    acct000001: { at: new Date(2026, 9, 12, 8, 40).getTime(), list: [
      { name: "INBOX", unseen: 12, subject: "secret" }, { name: "Spam", unseen: 40 }] },
    acct000002: { at: new Date(2026, 9, 10, 23, 5).getTime(), list: [{ name: "INBOX", unseen: 1 }] },
    acct000003: { at: 1, list: [{ name: "INBOX", unseen: 0 }] }
  };
  const rows = P.mail.rows(accts, recs, today, "en");
  assert.deepEqual(rows.map((r) => [r.title, r.text, r.kind, JSON.stringify(r.target)]), [
    ["12 unread · Work", "as of 08:40", "info", '{"acct":"acct000001","folder":"INBOX"}'],
    ["1 unread · me@home.gr", "as of 10/10 23:05", "info", '{"acct":"acct000002","folder":"INBOX"}']
  ]);
  assert.ok(!JSON.stringify(rows).includes("secret"));
  assert.equal(P.mail.rows(accts, recs, today, "el")[0].title, "12 αδιάβαστα · Work");
});

test("mail provider: no database, no line (and no network)", async () => {
  const store = { "oros-mail-data": { accounts: [{ id: "acct000001", m: 1, name: "", email: "me@x.gr" }] } };
  assert.deepEqual(await P.mail.collect(ctx(store, "2026-10-12")), []);   // Node: no indexedDB
  assert.deepEqual(await P.mail.collect(ctx({}, "2026-10-12")), []);
});
