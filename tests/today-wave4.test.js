// Today wave 4: the shared read-only rules moved out of Cycle, the
// shell and the Calendar — cycle/core.js, mood/core.js,
// minimalism/core.js, OrosNamedays.petBirthday — locked against the
// code they replaced (golden tests: same input, same answer; the one
// intended change is tested on its own), and the Today providers of
// Cycle, Mood, Minimalism, Family Tree, Moon & Sky and the screen
// pet's birthday (through the Calendar's provider).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const req = (p) => require(path.join(__dirname, "..", p));

const A = req("today/agg.js");
const CC = globalThis.OrosCycleCore = req("cycle/core.js");
const MC = globalThis.OrosMoodCore = req("mood/core.js");
const NC = globalThis.OrosMinimalismCore = req("minimalism/core.js");
const ND = globalThis.OrosNamedays = req("calendar/namedays.js");
const F = globalThis.FTCore = req("familytree/ft-core.js");
const SK = globalThis.OrosSkyCore = req("sky/core.js");
globalThis.OrosCalOccur = req("calendar/occur.js");
const P = {};
["cycle", "mood", "minimalism", "familytree", "sky", "calendar"].forEach((id) => { P[id] = req(id + "/today.js"); });

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, "0");
const ymdOf = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const mid = (y, m, d) => new Date(y, m, d).getTime();
function ctx(store, today, lang, raw) {
  return {
    today, horizon: A.HORIZON, now: Date.now(), lang: lang || "en",
    readJSON: (k) => (k in store ? JSON.parse(JSON.stringify(store[k])) : null),
    readRaw: (k) => (raw && k in raw ? raw[k] : (k in store ? JSON.stringify(store[k]) : null)),
    addDays: A.addDays, diff: A.diff
  };
}
async function viaAgg(provider, c) { return (await A.run([provider], c, {})).rows; }
let seed = 41;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };

// ---------------------------------------------------------------
// The code these rules replaced (verbatim logic, kept only as the
// reference the shared copies must keep matching)
// ---------------------------------------------------------------
function legacyAppPrediction(periods) {            // cycle.js avgCycleLen / avgPeriodLen / nextPrediction
  const sorted = periods.slice().sort((a, b) => b.start - a.start);
  const ps = sorted.slice().reverse();
  if (ps.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < ps.length; i++) gaps.push(Math.round((ps[i].start - ps[i - 1].start) / DAY));
  let sum = 0; gaps.forEach((g) => { sum += g; });
  const avg = Math.round(sum / gaps.length);
  const ended = sorted.filter((p) => p.end !== null);
  let len = null;
  if (ended.length) { let s = 0; ended.forEach((p) => { s += Math.round((p.end - p.start) / DAY) + 1; }); len = Math.round(s / ended.length); }
  if (len === null) len = 5;
  const start = sorted[0].start + avg * DAY;
  return { start, end: start + (len - 1) * DAY, avg };
}
function legacyShellDue(raw, today) {               // shell.js cycleShellCheck (decision part)
  const snap = (ts) => { if (typeof ts !== "number" || !isFinite(ts)) return null; const d = new Date(ts); if (isNaN(d.getTime())) return null; return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const starts = [];
  raw.periods.forEach((p) => { if (!p) return; const s = snap(p.start); if (s !== null) starts.push(s); });
  starts.sort((a, b) => a - b);
  if (starts.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < starts.length; i++) gaps.push(Math.round((starts[i] - starts[i - 1]) / DAY));
  let sum = 0; gaps.forEach((g) => { sum += g; });
  const avg = Math.round(sum / gaps.length);
  const predStart = starts[starts.length - 1] + avg * DAY;
  const daysLeft = Math.ceil((predStart - today) / DAY);
  if (daysLeft > 2) return null;
  return { ymd: ymdOf(new Date(predStart)), daysLeft };
}
function legacyMoodHasToday(raw, today) {           // shell.js moodCheckInHasToday (valid ts)
  const key = (d) => { if (!(d instanceof Date) || isNaN(d.getTime())) d = new Date(); return ymdOf(d); };
  for (let i = 0; i < raw.entries.length; i++) {
    const e = raw.entries[i];
    if (!e || !e.ts) continue;
    if (key(new Date(e.ts)) === today) return true;
  }
  return false;
}
function legacyMinimalism(raw, today) {             // shell.js minimalismHasToday / HasAnyDay / PrefHour
  const engaged = Array.isArray(raw.days) && raw.days.some((e) => e && e.date === today && (e.status === "done" || e.status === "skip"));
  const any = !!(Array.isArray(raw.days) && raw.days.length > 0);
  const h = raw.prefs && typeof raw.prefs.remindHour === "number" && raw.prefs.remindHour >= 0 && raw.prefs.remindHour <= 23 ? raw.prefs.remindHour : 10;
  return { engaged, any, h };
}
function legacyPetBday(pet, dateStr) {              // calendar.js petFeedOn (birthday part)
  if (!(pet && typeof pet.birthTs === "number" && isFinite(pet.birthTs))) return false;
  const b = new Date(pet.birthTs), pd = dateStr.split("-"), cell = new Date(+pd[0], +pd[1] - 1, +pd[2]);
  return !isNaN(cell.getTime()) && cell.getMonth() === b.getMonth() && cell.getDate() === b.getDate() && cell.getFullYear() > b.getFullYear();
}

function randomPeriods() {
  const out = [], n = rnd(6);
  let t = mid(2025, rnd(12), 1 + rnd(28));
  for (let i = 0; i < n; i++) {
    const len = 3 + rnd(5);
    out.push({ id: "p" + i, start: t, end: rnd(4) === 0 ? null : t + (len - 1) * DAY });
    t = mid(new Date(t).getFullYear(), new Date(t).getMonth(), new Date(t).getDate() + 22 + rnd(14));
  }
  return out.sort(() => rnd(3) - 1);
}

// ---------------------------------------------------------------
// Golden tests
// ---------------------------------------------------------------
test("cycle: prediction exactly as the app had it, reminder exactly as the shell had it (fuzz)", () => {
  for (let n = 0; n < 500; n++) {
    const periods = randomPeriods();
    assert.deepEqual(CC.nextPrediction(periods), legacyAppPrediction(periods));
    const pr = legacyAppPrediction(periods);
    const today = pr ? pr.start + (rnd(10) - 6) * DAY : mid(2026, 0, 1);
    const t0 = CC.snap(today);
    assert.deepEqual(CC.dueIn(periods, t0), legacyShellDue({ periods }, t0));
    // the shell snapped raw starts itself; so does the core
    const raw = periods.map((p) => Object.assign({}, p, { start: p.start + rnd(3) * 3600000 }));
    assert.deepEqual(CC.dueIn(raw, t0), legacyShellDue({ periods: raw }, t0));
  }
  assert.equal(CC.nextPrediction([{ start: mid(2026, 0, 1), end: null }]), null);   // one start: no guess
});

test("mood: today's check-in exactly as the shell had it; a bad time no longer counts (fixed)", () => {
  const today = ymdOf(new Date());
  for (let n = 0; n < 300; n++) {
    const entries = [];
    for (let i = 0; i < rnd(4); i++) entries.push({ id: "e" + i, ts: Date.now() - rnd(4) * DAY + rnd(3600000) });
    if (rnd(3) === 0) entries.push(null, { id: "z" });
    const raw = { entries };
    assert.equal(MC.hasOn(raw, today), legacyMoodHasToday(raw, today));
    assert.equal(MC.hasAny(raw), entries.length > 0);
  }
  assert.equal(MC.hasOn({ entries: [{ id: "bad", ts: "not a time" }] }, today), false);   // legacy: counted as today
  assert.equal(MC.hasAny(null), false);
});

test("minimalism: engaged, used and reminder hour exactly as the shell had them (fuzz)", () => {
  for (let n = 0; n < 300; n++) {
    const today = `2026-10-${pad(1 + rnd(28))}`, days = [];
    for (let i = 0; i < rnd(5); i++) days.push({ date: `2026-10-${pad(1 + rnd(28))}`, level: rnd(2) ? "a" : "b", status: ["done", "skip", "x"][rnd(3)] });
    const raw = { days, prefs: rnd(2) ? { remindHour: rnd(30) - 3 } : undefined };
    const L = legacyMinimalism(raw, today);
    assert.equal(NC.engagedOn(raw, today), L.engaged);
    assert.equal(NC.hasAny(raw), L.any);
    assert.equal(NC.remindHour(raw), L.h);
  }
});

test("screen pet: birthday rule exactly as the Calendar had it, with the age", () => {
  for (let n = 0; n < 300; n++) {
    const pet = { name: "Pip", birthTs: mid(2020 + rnd(6), rnd(12), 1 + rnd(28)) + rnd(80000000) };
    const d = new Date(pet.birthTs), day = `${2020 + rnd(8)}-${pad(d.getMonth() + 1)}-${pad(rnd(2) ? d.getDate() : 1 + rnd(28))}`;
    assert.equal(ND.petBirthday(pet, day) > 0, legacyPetBday(pet, day), day);
  }
  assert.equal(ND.petBirthday({ birthTs: mid(2023, 4, 7) }, "2026-05-07"), 3);
  assert.equal(ND.petBirthday({ birthTs: mid(2026, 4, 7) }, "2026-05-07"), 0);   // the birth day itself
  assert.equal(ND.petBirthday(null, "2026-05-07"), 0);
});

// ---------------------------------------------------------------
// Providers
// ---------------------------------------------------------------
test("cycle provider: expected start in the next days; late as a top line for two weeks", async () => {
  const periods = [{ id: "a", start: mid(2026, 8, 1), end: mid(2026, 8, 5) }, { id: "b", start: mid(2026, 8, 29), end: mid(2026, 9, 2) }];
  // next = 29 Sep + 28 = 27 Oct
  let rows = await viaAgg(P.cycle, ctx({ "oros-cycle-data": { periods } }, "2026-10-25", "el"));
  assert.deepEqual(rows.map((r) => [r.due, r.kind, r.title, JSON.stringify(r.target)]),
    [["2026-10-27", "event", "Αναμένεται περίοδος", '{"day":"2026-10-27"}']]);
  assert.deepEqual(await viaAgg(P.cycle, ctx({ "oros-cycle-data": { periods } }, "2026-10-20")), []);   // too far
  rows = await viaAgg(P.cycle, ctx({ "oros-cycle-data": { periods } }, "2026-10-30"));
  assert.deepEqual(rows.map((r) => [r.due, r.kind, r.title, r.text]), [["2026-10-30", "info", "Period seems late", "Expected 3 days ago"]]);
  assert.deepEqual(await viaAgg(P.cycle, ctx({ "oros-cycle-data": { periods } }, "2026-11-20")), []);   // > 14 days late
  assert.deepEqual(await viaAgg(P.cycle, ctx({}, "2026-10-25")), []);
});

test("mood provider: a check-in row only once the app was used and while today is empty", async () => {
  const today = ymdOf(new Date());
  const yesterday = { entries: [{ id: "e1", ts: Date.now() - 2 * DAY }] };
  let rows = await viaAgg(P.mood, ctx({ "oros-mood-data": yesterday }, today, "el"));
  assert.deepEqual(rows.map((r) => [r.title, r.kind, r.due]), [["Καταγραφή διάθεσης", "task", today]]);
  assert.deepEqual(await viaAgg(P.mood, ctx({ "oros-mood-data": { entries: [{ id: "e2", ts: Date.now() }] } }, today)), []);
  assert.deepEqual(await viaAgg(P.mood, ctx({ "oros-mood-data": { entries: [] } }, today)), []);
});

test("minimalism provider: a row while today's proposal is neither done nor skipped", async () => {
  const today = "2026-10-12";
  const used = { days: [{ date: "2026-10-11", level: "a", status: "done" }] };
  let rows = await viaAgg(P.minimalism, ctx({ "oros-minimalism-data": used }, today));
  assert.deepEqual(rows.map((r) => [r.title, r.kind, JSON.stringify(r.target)]), [["Today's proposal", "task", '{"day":"2026-10-12"}']]);
  used.days.push({ date: today, level: "b", status: "skip" });
  assert.deepEqual(await viaAgg(P.minimalism, ctx({ "oros-minimalism-data": used }, today)), []);
  assert.deepEqual(await viaAgg(P.minimalism, ctx({ "oros-minimalism-data": { days: [] } }, today)), []);
});

test("family tree provider: death anniversaries of today and the next days", async () => {
  const T = "tree1";
  const raw = { trees: [{ id: T, m: 1, name: "Family", home: "" }], unions: [], tombs: {}, people: [
    { id: "a", m: 1, tree: T, given: "Anna", family: "Doe", parents: [], death: { d: "1990-10-13" } },
    { id: "b", m: 1, tree: T, given: "Babis", family: "Doe", parents: [], death: { d: "2025-10-12" } },
    { id: "c", m: 1, tree: T, given: "Chris", family: "Doe", parents: [], death: { d: "1990-10-20" } }] };
  const rows = await viaAgg(P.familytree, ctx({ "oros-familytree-data": raw }, "2026-10-12", "el"));
  assert.deepEqual(rows.map((r) => [r.due, r.title, r.text, JSON.stringify(r.target)]), [
    ["2026-10-12", "Babis Doe", "1 χρόνος από τον θάνατο", '{"person":"b"}'],
    ["2026-10-13", "Anna Doe", "36 χρόνια από τον θάνατο", '{"person":"a"}']
  ]);
});

test("moon & sky provider: the Calendar feed's events, today's as top lines", async () => {
  // find a day with a sky event, then look at it from two days before
  let day = "2026-10-01";
  while (!SK.feedFor(day, "en").length) day = A.addDays(day, 1);
  const from = A.addDays(day, -2);
  const rows = await viaAgg(P.sky, ctx({}, from, "en"));
  const ev = SK.feedFor(day, "en");
  assert.deepEqual(rows.filter((r) => r.due === day).map((r) => [r.kind, r.title, JSON.stringify(r.target)]),
    ev.map((e) => ["event", e.title, JSON.stringify({ date: day })]));
  const today = await viaAgg(P.sky, ctx({}, day, "el"));
  assert.ok(today.length >= 1 && today.every((r) => r.kind === "info" && r.due === day));
  assert.deepEqual(today.map((r) => r.title), SK.feedFor(day, "el").map((e) => e.title));
});

test("calendar provider: the screen pet's birthday with its age, unless the pet feed is off", async () => {
  const pet = { pet: { name: "Pip", birthTs: mid(2023, 9, 13) + 5000 } };
  let rows = (await viaAgg(P.calendar, ctx({ "oros-pet-data": pet }, "2026-10-12"))).filter((r) => r.id.startsWith("pet:"));
  assert.deepEqual(rows.map((r) => [r.due, r.title, r.text, JSON.stringify(r.target)]),
    [["2026-10-13", "Pip's birthday", "3 years old", '{"pet":true}']]);
  rows = (await viaAgg(P.calendar, ctx({ "oros-pet-data": pet }, "2026-10-12", "en", { "oros-pet-calendar-sync": "0" })))
    .filter((r) => r.id.startsWith("pet:"));
  assert.deepEqual(rows, []);
});
