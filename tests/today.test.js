// Today / Σήμερα: the summary core (today/agg.js) — rows, groups,
// the notice text, providers that throw or hang, the synced settings
// slice "today" (R5/R26/R27), when the daily notice is built — and
// every app provider (<app>/today.js) against its app's real core.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const A = require(path.join(__dirname, "..", "today/agg.js"));
const req = (p) => require(path.join(__dirname, "..", p));

// The providers find their app's core on the global object, as the
// shell window has it.
globalThis.OrosPlantsCore = req("plants/core.js");
globalThis.OrosChoresCore = req("chores/core.js");
globalThis.OrosPetcareCore = req("petcare/core.js");
globalThis.OrosGarageCore = req("garage/core.js");
globalThis.OrosTravelCore = req("travel/core.js");
globalThis.orosTimesheetCore = req("timesheet/core.js");
globalThis.OrosShelfFeed = req("shelf/feed.js");
globalThis.orosWaterCore = req("water/core.js");
globalThis.orosBabyCore = req("baby/core.js");
globalThis.OrosNamedays = req("calendar/namedays.js");

const P = {};
["plants", "chores", "petcare", "garage", "travel", "timesheet", "shelf", "water", "baby", "calendar", "weather", "time"]
  .forEach((id) => { P[id] = req(id + "/today.js"); });

const at = (d, h, m) => new Date(2026, 9, d, h, m || 0).getTime();   // October 2026, local time
function ctx(store, today, now, lang) {
  return {
    today, horizon: A.HORIZON, now, lang: lang || "en",
    readRaw: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? (typeof store[k] === "string" ? store[k] : JSON.stringify(store[k])) : null),
    readJSON: (k) => { try { return Object.prototype.hasOwnProperty.call(store, k) ? JSON.parse(JSON.stringify(store[k])) : null; } catch (e) { return null; } },
    addDays: A.addDays, diff: A.diff
  };
}
const row = (app, o) => A.cleanRow(Object.assign({ title: "x" }, o), app);

// ---------------------------------------------------------------
// Days and rows
// ---------------------------------------------------------------

test("days: whole-day arithmetic over month, year and DST edges", () => {
  assert.equal(A.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(A.addDays("2026-10-24", 2), "2026-10-26");     // EU fall-back weekend
  assert.equal(A.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(A.diff("2026-10-11", "2026-10-14"), 3);
  assert.equal(A.diff("2026-10-11", "2026-10-09"), -2);
  assert.ok(A.isYmd("2028-02-29"));
  assert.ok(!A.isYmd("2026-02-29"));
  assert.ok(!A.isYmd("2026-1-01"));
  assert.equal(A.ymdOf(new Date(2026, 9, 11, 23, 59)), "2026-10-11");
});

test("cleanRow: plain text, bounded, bad fields dropped", () => {
  assert.equal(A.cleanRow(null, "plants"), null);
  assert.equal(A.cleanRow({ title: "   " }, "plants"), null);
  const r = A.cleanRow({ id: 5, title: " Fern\u0000:\n water ", text: "y".repeat(400), due: "2026-02-30",
                         time: "24:00", kind: "boom", target: { plant: "aaaaaa" } }, "plants");
  assert.equal(r.title, "Fern : water");
  assert.equal(r.text.length, 240);
  assert.equal(r.due, null);
  assert.equal(r.time, null);
  assert.equal(r.kind, "task");
  assert.equal(r.id, "Fern : water");               // no string id → the title
  assert.equal(r.key, "plants:Fern : water");
  assert.deepEqual(r.target, { plant: "aaaaaa" });
  assert.equal(A.cleanRow({ title: "x", target: { s: "z".repeat(600) } }, "a").target, null);
  assert.equal(A.cleanRow({ title: "x", target: () => 1 }, "a").target, null);
  assert.equal(A.cleanRow({ title: "a".repeat(300) }, "a").title.length, 160);
  assert.equal(A.cleanRow({ title: "x", time: "07:05", kind: "info" }, "a").time, "07:05");
});

// ---------------------------------------------------------------
// Groups, counts, notice
// ---------------------------------------------------------------

test("group: late tasks only, today, the next 3 days day by day, info today only", () => {
  const T = "2026-10-11";
  const rows = [
    row("plants", { id: "a", title: "Late water", due: "2026-10-09" }),
    row("travel", { id: "b", title: "Past trip day", due: "2026-10-10", kind: "event" }),   // gone, not late
    row("chores", { id: "c", title: "Dishes" }),                                             // no day = today
    row("time", { id: "d", title: "Alarm", due: T, time: "18:30", kind: "event" }),
    row("time", { id: "e", title: "Early alarm", due: T, time: "07:00", kind: "event" }),
    row("garage", { id: "f", title: "KTEO", due: "2026-10-14" }),                            // horizon edge
    row("garage", { id: "g", title: "Insurance", due: "2026-10-15" }),                       // past horizon
    row("petcare", { id: "h", title: "Vaccine", due: "2026-10-12" }),
    row("weather", { id: "i", title: "Sunny", kind: "info" }),
    row("calendar", { id: "j", title: "Tomorrow holiday", due: "2026-10-12", kind: "info" }) // info not today: out
  ];
  const g = A.group(rows, T, 3, ["chores", "time", "plants", "petcare", "garage", "travel", "weather", "calendar"]);
  assert.deepEqual(g.info.map((r) => r.id), ["i"]);
  assert.deepEqual(g.overdue.map((r) => r.id), ["a"]);
  assert.deepEqual(g.today.map((r) => r.id), ["e", "d", "c"]);                 // timed first, by time
  assert.deepEqual(g.soon.map((d) => [d.day, d.rows.map((r) => r.id)]), [["2026-10-12", ["h"]], ["2026-10-14", ["f"]]]);
  assert.deepEqual(A.counts(g), { overdue: 1, today: 3, soon: 2 });
});

test("group: untimed rows by app order, then title; overdue oldest first", () => {
  const T = "2026-10-11";
  const g = A.group([
    row("b", { id: "1", title: "zeta" }), row("a", { id: "2", title: "Beta" }), row("a", { id: "3", title: "alpha" }),
    row("z", { id: "4", title: "unknown app" }),
    row("a", { id: "5", title: "late 1", due: "2026-10-10" }), row("a", { id: "6", title: "late 2", due: "2026-10-01" })
  ], T, 3, ["a", "b"]);
  assert.deepEqual(g.today.map((r) => r.id), ["3", "2", "1", "4"]);
  assert.deepEqual(g.overdue.map((r) => r.id), ["6", "5"]);
});

test("trim: at most PER_APP_MAX rows of one app per group, the rest counted", () => {
  const rows = [];
  for (let i = 0; i < A.PER_APP_MAX + 7; i++) rows.push(row("chores", { id: "c" + i, title: "t" + i }));
  rows.push(row("plants", { id: "p", title: "p" }));
  const g = A.trim(A.group(rows, "2026-10-11", 3, []));
  assert.equal(g.today.filter((r) => r.app === "chores").length, A.PER_APP_MAX);
  assert.equal(g.today.filter((r) => r.app === "plants").length, 1);
  assert.deepEqual(g.todayMore, { chores: 7 });
});

test("notice: only late or today's rows speak; numbers only, both languages", () => {
  assert.equal(A.worthNotice({ overdue: 0, today: 0, soon: 5 }), false);
  assert.equal(A.worthNotice({ overdue: 1, today: 0, soon: 0 }), true);
  assert.deepEqual(A.noticeText({ overdue: 2, today: 1, soon: 0 }, "en"), { title: "Today", body: "2 overdue · 1 today" });
  assert.deepEqual(A.noticeText({ overdue: 1, today: 3, soon: 1 }, "el"),
    { title: "Σήμερα", body: "1 εκπρόθεσμο · 3 για σήμερα · 1 έρχεται" });
  assert.equal(A.noticeText({ overdue: 0, today: 2, soon: 4 }, "xx").body, "2 today · 4 coming up");
});

// ---------------------------------------------------------------
// Running providers
// ---------------------------------------------------------------

test("run: a provider that throws, hangs, rejects or answers junk is left out", async () => {
  const ok = { id: "plants", collect: () => [{ id: "a", title: "A" }, { id: "a", title: "dup" }, null, { title: "" }] };
  const providers = [
    ok,
    { id: "plants", collect: () => [{ title: "second plants provider" }] },          // same id: ignored
    { id: "boom", collect: () => { throw new Error("x"); } },
    { id: "slow", collect: () => new Promise((r) => setTimeout(() => r([{ title: "late" }]), 200)) },
    { id: "rej", collect: () => Promise.reject(new Error("no")) },
    { id: "junk", collect: () => "rows" },
    { id: "async", collect: () => Promise.resolve([{ id: "z", title: "Z" }]) },
    { id: "off", collect: () => [{ title: "never" }] },
    { id: "BAD ID", collect: () => [{ title: "x" }] },
    null
  ];
  const res = await A.run(providers, {}, { enabled: (id) => id !== "off", timeoutMs: 50 });
  assert.deepEqual(res.rows.map((r) => r.key), ["plants:a", "async:z"]);
  assert.deepEqual(res.apps, { plants: 1, async: 1 });
});

// ---------------------------------------------------------------
// Settings slice "today"
// ---------------------------------------------------------------

test("slice: defaults, canonical shape, junk refused", () => {
  const d = A.normData(null);
  assert.deepEqual(d, { ver: 1, on: { v: true, m: 0 }, hour: { v: 6, m: 0 }, absorb: { v: true, m: 0 }, apps: {} });
  const n = A.normData({ on: { v: "yes", m: 5 }, hour: { v: 13, m: 5 }, absorb: { v: false, m: -3 },
    apps: { zeta: { v: false, m: 2 }, alpha: { v: true, m: 1 }, "BAD!": { v: true, m: 1 }, beta: { v: 1, m: 1 } }, extra: 1 });
  assert.deepEqual(n, { ver: 1, on: { v: true, m: 0 }, hour: { v: 6, m: 0 }, absorb: { v: false, m: 0 },
    apps: { alpha: { v: true, m: 1 }, zeta: { v: false, m: 2 } } });
  assert.deepEqual(Object.keys(n.apps), ["alpha", "zeta"]);
  assert.deepEqual(A.normData(JSON.parse(JSON.stringify(n))), n);
});

test("slice: merge is symmetric, idempotent, newest field wins, ties are stable", () => {
  const a = { on: { v: false, m: 10 }, hour: { v: 7, m: 3 }, apps: { mood: { v: true, m: 4 }, plants: { v: false, m: 9 } } };
  const b = { on: { v: true, m: 5 }, hour: { v: 8, m: 4 }, absorb: { v: false, m: 2 }, apps: { plants: { v: true, m: 9 } } };
  const ab = A.merge(a, b), ba = A.merge(b, a);
  assert.deepEqual(ab, ba);
  assert.deepEqual(ab, A.merge(ab, ab));
  assert.deepEqual(A.merge(ab, a), ab);
  assert.equal(ab.on.v, false);
  assert.equal(ab.hour.v, 8);
  assert.equal(ab.absorb.v, false);
  assert.equal(ab.apps.mood.v, true);
  assert.equal(ab.apps.plants.v, true);           // same m: larger JSON ("true" > "false")
});

test("slice: merge fuzz stays symmetric, idempotent and associative", () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const ids = ["plants", "mood", "cycle", "garage"];
  function gen() {
    const o = {};
    if (rnd(2)) o.on = { v: !!rnd(2), m: rnd(5) };
    if (rnd(2)) o.hour = { v: rnd(14), m: rnd(5) };
    if (rnd(2)) o.absorb = { v: !!rnd(2), m: rnd(5) };
    o.apps = {};
    ids.forEach((id) => { if (rnd(2)) o.apps[id] = { v: !!rnd(2), m: rnd(5) }; });
    return o;
  }
  for (let i = 0; i < 300; i++) {
    const x = gen(), y = gen(), z = gen();
    const s = (v) => JSON.stringify(v);
    assert.equal(s(A.merge(x, y)), s(A.merge(y, x)));
    assert.equal(s(A.merge(A.merge(x, y), y)), s(A.merge(x, y)));
    assert.equal(s(A.merge(A.merge(x, y), z)), s(A.merge(x, A.merge(y, z))));
  }
});

test("setField: one real change stamps m; the same value changes nothing (R27)", () => {
  const d0 = A.normData(null);
  assert.deepEqual(A.setField(d0, "on", true, 100), d0);
  const d1 = A.setField(d0, "hour", 8, 100);
  assert.deepEqual(d1.hour, { v: 8, m: 100 });
  assert.deepEqual(A.setField(d1, "hour", 13, 200), d1);        // out of range
  assert.deepEqual(A.setField(d1, "ver", 2, 200), d1);
  assert.deepEqual(A.setField(d1, "hour", 9, 50).hour, { v: 9, m: 101 });   // a slow clock still moves forward
  // apps: the default needs no row; a change against it does
  assert.deepEqual(A.setField(d0, "app", true, 100, "plants"), d0);
  assert.deepEqual(A.setField(d0, "app", false, 100, "mood"), d0);
  const d2 = A.setField(d0, "app", true, 100, "mood");
  assert.deepEqual(d2.apps, { mood: { v: true, m: 100 } });
  assert.deepEqual(A.setField(d2, "app", true, 300, "mood"), d2);
  assert.deepEqual(A.setField(d0, "app", true, 100, "BAD ID"), d0);
});

test("appOn: Cycle and Mood off by default, every app switchable either way", () => {
  const d0 = A.normData(null);
  assert.equal(A.appOn(d0, "plants"), true);
  assert.equal(A.appOn(d0, "health"), true);
  assert.equal(A.appOn(d0, "baby"), true);
  assert.equal(A.appOn(d0, "budget"), true);
  assert.equal(A.appOn(d0, "cycle"), false);
  assert.equal(A.appOn(d0, "mood"), false);
  assert.equal(A.appOn(A.setField(d0, "app", true, 1, "cycle"), "cycle"), true);
  assert.equal(A.appOn(A.setField(d0, "app", false, 1, "health"), "health"), false);
  assert.equal(A.appOn(null, "mood"), false);
});

// ---------------------------------------------------------------
// When the notice is built
// ---------------------------------------------------------------

test("decide: start hour, once a day, wait for the sync, empty days retried", () => {
  const base = { on: true, hour: 6, now: at(11, 7), last: "", settled: true, emptyAt: 0, syncAt: 0 };
  const d = (o) => A.decide(Object.assign({}, base, o));
  assert.equal(d({}), "build");
  assert.equal(d({ on: false }), "skip");
  assert.equal(d({ last: "2026-10-11" }), "skip");
  assert.equal(d({ last: "2026-10-10" }), "build");
  assert.equal(d({ now: at(11, 5, 59) }), "wait");
  assert.equal(d({ now: at(11, 0, 1), hour: 0 }), "build");
  assert.equal(d({ settled: false }), "wait");
  assert.equal(d({ emptyAt: at(11, 6, 50) }), "wait");                                   // empty 10 min ago
  assert.equal(d({ emptyAt: at(11, 6, 20) }), "build");                                  // 40 min ago
  assert.equal(d({ emptyAt: at(11, 6, 50), syncAt: at(11, 6, 55) }), "build");           // new data came in
  assert.equal(d({ emptyAt: at(10, 23, 50), now: at(11, 6, 5) }), "build");              // yesterday's empty
});

test("settled: no cloud = now; locked = never; otherwise after the merge or a grace", () => {
  const T0 = at(11, 7);
  const base = { connected: true, unlocked: true, online: true, now: T0, bootAt: T0, syncAt: 0, failAt: 0 };
  const s = (o) => A.settled(Object.assign({}, base, o));
  assert.equal(s({ connected: false, unlocked: false }), true);
  assert.equal(s({ unlocked: false, now: T0 + 3600e3 }), false);
  assert.equal(s({}), false);
  assert.equal(s({ syncAt: T0 + 5 }), true);
  assert.equal(s({ failAt: T0, now: T0 + A.FAIL_GRACE_MS - 1 }), false);
  assert.equal(s({ failAt: T0, now: T0 + A.FAIL_GRACE_MS }), true);
  assert.equal(s({ online: false, now: T0 + A.FAIL_GRACE_MS }), true);
  assert.equal(s({ now: T0 + A.SYNC_WAIT_MS - 1 }), false);
  assert.equal(s({ now: T0 + A.SYNC_WAIT_MS }), true);
});

test("askText: the row's own words only, bounded, both languages", () => {
  const r = row("plants", { title: "Fern: water", time: "09:00", text: "Kitchen" });
  assert.equal(A.askText(r, "Plant Care", "2026-10-11", "en"), "From my Today summary (2026-10-11): Plant Care · Fern: water (09:00) — Kitchen");
  assert.equal(A.askText(row("x", { title: "A" }), "X", "2026-10-11", "el"), "Από τη σύνοψη «Σήμερα» (2026-10-11): X · A");
  assert.ok(A.askText(row("x", { title: "a".repeat(160), text: "b".repeat(240) }), "n".repeat(500), "2026-10-11", "en").length <= 2000);
});

test("todayFiles: internal apps only, safe file names, at most 4", () => {
  const app = (o) => Object.assign({ id: "plants", type: "internal", url: "plants/" }, o);
  assert.deepEqual(A.todayFiles(app({ today: "today.js" })), ["plants/today.js"]);
  assert.deepEqual(A.todayFiles(app({ today: ["core.js", "today.js"] })), ["plants/core.js", "plants/today.js"]);
  assert.deepEqual(A.todayFiles(app({})), []);
  assert.deepEqual(A.todayFiles(app({ today: "../x.js" })), []);
  assert.deepEqual(A.todayFiles(app({ today: "today.mjs" })), []);
  assert.deepEqual(A.todayFiles(app({ today: ["a.js", "b.js", "c.js", "d.js", "e.js"] })), []);
  assert.deepEqual(A.todayFiles(app({ type: "external", today: "today.js" })), []);
  assert.deepEqual(A.todayFiles(app({ url: "https://evil.example/", today: "today.js" })), []);
  assert.deepEqual(A.todayFiles(null), []);
});

// ---------------------------------------------------------------
// Providers (real app cores, in-memory storage)
// ---------------------------------------------------------------

test("providers: every one is read-only shaped, and says nothing on empty storage", async () => {
  globalThis.orosAlarms = { list: () => [] };
  for (const id of Object.keys(P)) {
    const p = P[id];
    assert.equal(p.id, id);
    assert.ok(Array.isArray(p.keys) && p.keys.length);
    assert.equal(typeof p.collect, "function");
    const out = await p.collect(ctx({}, "2026-10-11", at(11, 8)));
    assert.ok(Array.isArray(out), id);
    if (id !== "calendar") assert.equal(out.length, 0, id);           // the calendar always knows name days
    // junk in storage never throws
    const junk = {};
    p.keys.forEach((k) => { junk[k] = { plants: "x", tasks: 5, pets: [null], vehicles: [1], trips: "no", cities: [null], contacts: "x", data: 1 }; });
    assert.ok(Array.isArray(await p.collect(ctx(junk, "2026-10-11", at(11, 8)))), id + " junk");
  }
  delete globalThis.orosAlarms;
});

test("plants: late, today and next-days tasks with the plant to open", () => {
  const plant = (id, o) => Object.assign({ id, m: 1000, name: "Plant " + id, sp: "", room: "", out: 0, em: "",
    w: 7, ww: 0, f: 0, mi: 0, r: 0, st: "2026-10-01", sn: {}, notes: "" }, o);
  const store = { "oros-plants-data": { ver: 1, tombs: {},
    plants: [plant("aaaaaa", { name: "Basil", w: 2, room: "Balcony" }), plant("bbbbbb", { name: "Fern", w: 3, st: "2026-10-07" })],
    log: [{ id: "e00001", p: "aaaaaa", k: "water", d: "2026-10-04", s: 0, m: 2000 }] } };
  const rows = P.plants.collect(ctx(store, "2026-10-08", at(8, 10)));
  const g = A.group(rows.map((r) => A.cleanRow(r, "plants")), "2026-10-08", 3, []);
  assert.deepEqual(g.overdue.map((r) => [r.title, r.text, r.due]), [["Basil: water", "Balcony", "2026-10-06"]]);
  assert.deepEqual(g.soon.map((d) => [d.day, d.rows.map((r) => r.title)]), [["2026-10-10", ["Fern: water"]]]);
  assert.deepEqual(g.overdue[0].target, { plant: "aaaaaa" });
  assert.equal(P.plants.collect(ctx(store, "2026-10-08", at(8, 10), "el"))[0].title, "Basil: πότισμα");
  let opened = null;
  P.plants.open({ plant: "aaaaaa" }, { __orosOpenPlants: (id) => { opened = id; } });
  assert.equal(opened, "aaaaaa");
});

test("chores: open chores of today, last week's late ones, mine only with a 'me'", () => {
  const C = globalThis.OrosChoresCore;
  const mem = (id, order) => ({ id, m: 1, name: id.toUpperCase(), color: 0, icon: "", away: null, order, om: 0 });
  const task = (id, freq, o) => Object.assign({ id, m: 1, name: id, icon: "", freq, weight: 1, mode: "rr", who: [], start: "2026-10-05", off: 0 }, o);
  const A1 = "aaaaaa", B1 = "bbbbbb";
  const data = C.mergeChores({ members: [mem(A1, 0), mem(B1, 1)], tasks: [task("tdishes", { k: "d" })],
    done: { "tdishes|2026-10-06": [1, A1, 1] }, set: {}, tombs: {} }, {}, Date.UTC(2026, 9, 8, 12));
  const store = { "oros-chores-data": data };
  const rows = P.chores.collect(ctx(store, "2026-10-08", at(8, 10)));
  assert.deepEqual(rows.map((r) => [r.id, r.due]).sort(), [["tdishes|2026-10-07", "2026-10-07"], ["tdishes|2026-10-08", "2026-10-08"]]);
  assert.ok(rows.every((r) => r.text === "AAAAAA" || r.text === "BBBBBB"));
  store["oros-chores-prefs"] = { me: A1 };
  const mine = P.chores.collect(ctx(store, "2026-10-08", at(8, 10)));
  assert.ok(mine.length < rows.length || mine.every((r) => r.text === ""));
  assert.ok(mine.every((r) => r.text === ""));
});

test("petcare: due care within the horizon and birthdays, gone pets silent", () => {
  const pet = (id, o) => Object.assign({ id, m: 1000, name: "Pet " + id, sp: "dog", care: {}, cs: {}, food: {}, vet: {} }, o);
  const rec = (id, p, k, d, o) => Object.assign({ id, p, k, d, m: 2000 }, o);
  const store = { "oros-petcare-data": { ver: 1, tombs: {},
    pets: [pet("pt0001", { name: "Rex", birth: "2020-10-11" }), pet("pt0002", { name: "Old", gone: "2025-01-01", birth: "2015-10-11" })],
    recs: [rec("r00001", "pt0001", "vacc", "2025-10-12", { n: "Rabies", nx: "2026-10-12" }),
           rec("r00002", "pt0001", "vacc", "2025-11-01", { n: "DHPPi", nx: "2026-11-20" }),
           rec("r00003", "pt0002", "vacc", "2025-10-12", { n: "Rabies", nx: "2026-10-12" })] } };
  const rows = P.petcare.collect(ctx(store, "2026-10-11", at(11, 9)));
  const titles = rows.map((r) => r.title);
  assert.ok(titles.includes("Rex: Rabies"), titles.join("|"));
  assert.ok(!titles.some((t) => t.includes("DHPPi")));          // 40 days away
  assert.ok(titles.some((t) => t.startsWith("🎂 Rex")));
  assert.ok(!titles.some((t) => t.includes("Old")), titles.join("|"));
  let opened = null;
  P.petcare.open({ pet: "pt0001" }, { __orosOpenPetcare: (id) => { opened = id; } });
  assert.equal(opened, "pt0001");
});

test("garage: expired and soon renewals, archived vehicles silent", () => {
  const veh = (id, o) => Object.assign({ id, m: 1000, name: "Car " + id, type: "car", fuel: "petrol" }, o);
  const store = { "oros-garage-data": { vehicles: [veh("aaaaaa1"), veh("wwwwww1", { arch: 1 })],
    fuel: [], service: [], plans: [], tyres: [], costs: [], odo: [], tombs: {},
    renewals: [
      { id: "r000001", m: 1, v: "aaaaaa1", kind: "ins", exp: "2026-10-12" },
      { id: "r000002", m: 1, v: "aaaaaa1", kind: "kteo", exp: "2026-10-01" },
      { id: "r000003", m: 1, v: "aaaaaa1", kind: "tax", exp: "2026-10-30" },
      { id: "r000004", m: 1, v: "wwwwww1", kind: "ins", exp: "2026-10-10" }
    ] } };
  const rows = P.garage.collect(ctx(store, "2026-10-09", at(9, 9)));
  assert.deepEqual(rows.map((r) => [r.target.id, r.due]), [["r000002", "2026-10-01"], ["r000001", "2026-10-12"]]);
  assert.ok(rows.every((r) => typeof r.title === "string" && r.title.length > 0));
});

test("travel: the trip day you are on, departures ahead, timed entries", () => {
  const trip = (o) => Object.assign({ id: "trip-rome", name: "Rome", dest: "Rome, Italy", start: "2026-10-12", end: "2026-10-14",
    people: [], notes: "", f: {}, pack: [], plan: [] }, o);
  const entry = (id, o) => Object.assign({ id, kind: "flight", title: "", day: "2026-10-12", t1: "", day2: "", t2: "", place: "",
    from: "", to: "", ref: "", note: "", pos: 0, f: {} }, o);
  const store = { "oros-travel-data": { ver: 1, tpls: [], tombs: {},
    trips: [trip({ plan: [entry("fl-1", { from: "ATH", to: "FCO", t1: "08:15", t2: "10:05" })] })] } };
  const before = P.travel.collect(ctx(store, "2026-10-10", at(10, 9)));
  assert.deepEqual(before.map((r) => [r.due, r.time || "", r.title]),
    [["2026-10-12", "", "Rome · day 1/3"], ["2026-10-12", "08:15", "Flight ATH → FCO"]]);
  const during = P.travel.collect(ctx(store, "2026-10-13", at(13, 9)));
  assert.deepEqual(during.map((r) => r.title), ["Rome · day 2/3"]);           // later days: departures only
  assert.deepEqual(during[0].target, { trip: "trip-rome", tab: "" });
});

test("timesheet: running timer and today against the goal, as top lines", () => {
  const C = globalThis.orosTimesheetCore;
  const raw = JSON.stringify(C.normalize({ ver: 1, clients: [], projects: [{ id: "pppppp1", name: "Site", m: 1 }],
    entries: [{ id: "aaaaaa1", p: "", desc: "", s: at(11, 8), e: at(11, 9), billed: 0, m: 1 },
              { id: "bbbbbb1", p: "pppppp1", desc: "", s: at(11, 10), e: 0, billed: 0, m: 1 }],
    prefs: { goal: 480 } }));
  const rows = P.timesheet.collect(ctx({ "oros-timesheet-data": raw }, "2026-10-11", at(11, 10, 30)));
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.kind === "info"));
  assert.equal(rows[0].title, "Timer running since 10:00");
  assert.equal(rows[0].text, "Site");
  assert.ok(rows[1].title.startsWith("Tracked today: "), rows[1].title);
});

test("shelf: wish-list release days inside the horizon only", () => {
  const item = (id, o) => Object.assign({ id, m: 1, a: 1, type: "book", title: "Title " + id, st: "want" }, o);
  const store = { "oros-shelf-data": { ver: 1, sess: [], goals: {}, tombs: {},
    items: [item("item000001", { rel: "2026-10-12" }), item("item000002", { rel: "2026-11-30" }),
            item("item000003", { rel: "2026-10-11", st: "done" })] } };
  const rows = P.shelf.collect(ctx(store, "2026-10-11", at(11, 9)));
  assert.deepEqual(rows.map((r) => [r.due, r.title, r.target.item]), [["2026-10-12", "Release: Title item000001", "item000001"]]);
});

test("water: one top line once the app is used", () => {
  const C = globalThis.orosWaterCore;
  assert.deepEqual(P.water.collect(ctx({ "oros-water-data": JSON.stringify(C.normalize({ ver: 1, sips: [], goals: [] })) }, "2026-10-11", at(11, 9))), []);
  const raw = JSON.stringify(C.normalize({ ver: 1, goals: [], sips: [{ id: "aaaaaa1", ts: at(11, 8), ml: 500, m: at(11, 8) }] }));
  const rows = P.water.collect(ctx({ "oros-water-data": raw }, "2026-10-11", at(11, 9)));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "info");
  assert.match(rows[0].title, /^Water: .+ of .+$/);
});

test("baby: marks on their day, age as a top line today only, the medicine time", () => {
  const C = globalThis.orosBabyCore, KID = "kid0001";
  const data = C.normalize({ ver: 1, kids: [{ id: KID, n: "Anna", b: "2026-06-15", s: "f", c: 1, m: 1 }], ev: [], gr: [],
    mk: [{ id: "vacc001", k: KID, t: "vac", tx: "Hexa 2", d: "2026-10-16", m: 1 }] });
  const store = { "oros-baby-data": JSON.stringify(data) };
  const rows = P.baby.collect(ctx(store, "2026-10-15", at(15, 7)));
  assert.deepEqual(rows.map((r) => [r.kind, r.due, r.title]),
    [["info", "2026-10-15", "Anna is 4 months old today"], ["event", "2026-10-16", "Anna: vaccine, Hexa 2"]]);
  assert.deepEqual(rows[1].target, { kid: KID, mk: "vacc001" });
  store["oros-baby-rem"] = { med: "09:00", mt: "Vit D" };
  const med = P.baby.collect(ctx(store, "2026-10-15", at(15, 7))).filter((r) => r.kind === "task");
  assert.deepEqual(med.map((r) => [r.time, r.title]), [["09:00", "Vit D"]]);
  // already given this morning → no task
  store["oros-baby-data"] = JSON.stringify(C.normalize(Object.assign({}, data,
    { ev: [{ id: "med0001", k: KID, t: "med", ts: at(15, 8, 30), tx: "Vit D", m: at(15, 8, 30) }] })));
  assert.equal(P.baby.collect(ctx(store, "2026-10-15", at(15, 10))).filter((r) => r.kind === "task").length, 0);
});

test("calendar: holiday and names as top lines, contacts who celebrate as rows", () => {
  const store = { "oros-contacts-data": { contacts: [{ id: "c1", given: "Δημήτρης", family: "Παπάς" }, { id: "c2", given: "Άννα" }] } };
  const rows = P.calendar.collect(ctx(store, "2026-10-26", at(26, 9)));
  assert.ok(rows.some((r) => r.kind === "info" && r.title.startsWith("Name day: ") && r.title.includes("Δημήτρης")));
  assert.deepEqual(rows.filter((r) => r.kind === "event" && r.target && r.target.contact).map((r) => r.target.contact), ["c1"]);
  const hol = P.calendar.collect(ctx({}, "2026-10-26", at(26, 9))).filter((r) => r.id.startsWith("hol:"));
  assert.deepEqual(hol.map((r) => [r.due, r.kind]), [["2026-10-28", "event"]]);       // Oct 28, two days ahead
  const onDay = P.calendar.collect(ctx({}, "2026-10-28", at(28, 9), "el")).filter((r) => r.id.startsWith("hol:"));
  assert.equal(onDay[0].kind, "info");
  const calls = [];
  P.calendar.open({ contact: "c1" }, { __orosOpenContact: (id) => calls.push(["ct", id]) });
  P.calendar.open({ date: "2026-10-28" }, { __orosOpenCalendar: (a, b) => calls.push([a, b]) });
  assert.deepEqual(calls, [["ct", "c1"], ["day", "2026-10-28"]]);
});

test("contactsCelebrating: one row per contact, name kept, junk skipped", () => {
  const ND = globalThis.OrosNamedays;
  const list = ND.contactsCelebrating([{ id: "c1", given: "Δημήτρης", family: "Παπάς" }, { id: "c2", given: "Άννα" }, null, { id: 5 }], "2026-10-26");
  assert.deepEqual(list.map((x) => x.id), ["c1"]);
  assert.equal(list[0].name, "Δημήτρης Παπάς");
  assert.deepEqual(ND.contactsCelebrating(null, "2026-10-26"), []);
  assert.deepEqual(ND.contactsCelebrating([{ id: "c1", given: "Δημήτρης" }], "bad"), []);
});

test("weather: nearest city's today row from a fresh cache, never a stale one", () => {
  const today = "2026-10-11", now = at(11, 8);
  const data = { units: "metric", active: "c2", cities: [
    { id: "c1", label: "Athens", lat: 37.98, lon: 23.72, pos: 0 },
    { id: "c2", label: "Thessaloniki", lat: 40.64, lon: 22.94, pos: 1 }] };
  const cache = {
    c1: { at: now - 3600e3, daily: [{ date: today, max: 24.4, min: 15.6, pop: 10 }] },
    c2: { at: now - 3600e3, daily: [{ date: today, max: 20, min: 11 }] }
  };
  const c = (o) => ctx(Object.assign({ "oros-weatherapp-data": data, "oros-weatherapp-cache": cache }, o), today, now);
  assert.deepEqual(P.weather.collect(c({ "oros-weather": { lat: 37.97, lon: 23.73 } })).map((r) => r.title), ["Athens: 24° / 16° · rain 10%"]);
  assert.deepEqual(P.weather.collect(c({})).map((r) => r.title), ["Thessaloniki: 20° / 11°"]);
  const imp = Object.assign({}, data, { units: "imperial" });
  assert.deepEqual(P.weather.collect(c({ "oros-weatherapp-data": imp })).map((r) => r.title), ["Thessaloniki: 68° / 52°"]);
  const stale = { c2: { at: now - 25 * 3600e3, daily: [{ date: today, max: 20, min: 11 }] } };
  assert.deepEqual(P.weather.collect(c({ "oros-weatherapp-cache": stale })), []);
  const yesterday = { c2: { at: now, daily: [{ date: "2026-10-10", max: 20, min: 11 }] } };
  assert.deepEqual(P.weather.collect(c({ "oros-weatherapp-cache": yesterday })), []);
});

test("time: today's later alarms; timers and other days left out", () => {
  const now = at(11, 8);
  globalThis.orosAlarms = { list: () => [
    { id: 1, at: at(11, 18, 30), label: "Gym", repeat: "daily", mtime: at(1, 9) },
    { id: 2, at: at(11, 7), label: "Past", repeat: "once", mtime: at(10, 9) },
    { id: 3, at: at(11, 8, 25), label: "Timer done", repeat: "once", mtime: now },       // a timer
    { id: 4, at: at(11, 21), label: "", repeat: "once", mtime: at(10, 20) },
    { id: 5, at: at(12, 7), label: "Tomorrow", repeat: "daily", mtime: at(1, 9) },
    null
  ] };
  const rows = P.time.collect(ctx({}, "2026-10-11", now));
  assert.deepEqual(rows.map((r) => [r.time, r.title]), [["18:30", "Gym"], ["21:00", "Alarm"]]);
  globalThis.orosAlarms = { list: () => { throw new Error("x"); } };
  assert.deepEqual(P.time.collect(ctx({}, "2026-10-11", now)), []);
  delete globalThis.orosAlarms;
});
