// Time wave 5 (world clock search, meeting planner, kitchen timers,
// stopwatch laps): the pure core (time/clock-core.js + the city list
// time/cities.js), the zone merge of the `time` slice with the new
// `city` field (time/time.js mergeTime, extracted), the shell's
// device-local timer alarms (shell.js alarmsCanonical, extracted),
// the Today provider and the page wiring.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../time/clock-core.js");
const CITIES = require("../time/cities.js");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const MIN = 60000, H = 3600000;

// ---------------------------------------------------------------
// Cities and search
// ---------------------------------------------------------------

test("cities: ~500 rows, four fields, every zone known to the runtime, no duplicates", () => {
  assert.ok(CITIES.length >= 400, "at least 400 cities");
  const seen = new Set();
  CITIES.forEach((row) => {
    const p = row.split("|");
    assert.equal(p.length, 4, row);
    assert.ok(p[0] && p[1] && /^[A-Z]{2}$/.test(p[3]), row);
    assert.ok(/[Ͱ-Ͽ]/.test(p[1]), "Greek name: " + row);
    assert.ok(C.validZone(p[2]), "zone: " + row);
    const k = p[0] + "|" + p[3];
    assert.ok(!seen.has(k), "duplicate " + k);
    seen.add(k);
  });
});

test("fold: case, accents and Greek final sigma ignored", () => {
  assert.equal(C.fold("Αθήνα"), C.fold("αθηνα"));
  assert.equal(C.fold("São Paulo"), "sao paulo");
  assert.equal(C.fold("Λευκωσίας"), C.fold("ΛΕΥΚΩΣΙΑΣ"));
  assert.equal(C.fold("  New_York/ "), "new york");
});

test("search: English and Greek names, accents ignored, exact before prefix before contains", () => {
  const first = (q) => C.searchPlaces(q, { zones: ["Europe/Athens", "Asia/Tokyo", "America/New_York", "Asia/Kolkata", "UTC"] })[0];
  assert.equal(first("athens").city, "Athens");
  assert.equal(first("αθηνα").city, "Athens");
  assert.equal(first("Θεσσαλονίκη").tz, "Europe/Athens");
  assert.equal(first("thessa").city, "Thessaloniki");
  assert.equal(first("sao pa").city, "São Paulo");
  assert.equal(first("νέα υόρκη").city, "New York");
  assert.equal(first("york").city, "New York");               // a word starts with it
  assert.equal(first("tokyo").kind, "city");
  const res = C.searchPlaces("kolkata", { zones: ["Asia/Kolkata"] });
  assert.equal(res[0].city, "Kolkata");
  assert.ok(!res.some((r) => r.kind === "zone" && r.tz === "Asia/Kolkata"), "the city row covers its own zone");
  const z = C.searchPlaces("utc", { zones: ["UTC", "Etc/GMT+5"] });
  assert.equal(z[0].kind, "zone");
  assert.equal(z[0].tz, "UTC");
  assert.deepEqual(C.searchPlaces("", {}), []);
  assert.deepEqual(C.searchPlaces("zzqqxx", { zones: [] }), []);
  assert.ok(C.searchPlaces("a", { limit: 5 }).length <= 5);
});

test("search: any IANA zone, by id parts", () => {
  const zones = C.allZones();
  assert.ok(zones.length > 300, "Intl.supportedValuesOf lists the zones");
  assert.ok(zones.indexOf("UTC") >= 0);
  const r = C.searchPlaces("Argentina", { zones });
  assert.ok(r.some((x) => x.kind === "zone" && /^America\/Argentina\//.test(x.tz)));
});

test("zoneLabel: city name in the language, bare zones named after their city or last part", () => {
  assert.equal(C.zoneLabel("Europe/Athens", "Thessaloniki", "el"), "Θεσσαλονίκη");
  assert.equal(C.zoneLabel("Europe/Athens", "Thessaloniki", "en"), "Thessaloniki");
  assert.equal(C.zoneLabel("Europe/Berlin", "", "el"), "Βερολίνο");
  assert.equal(C.zoneLabel("America/New_York", "", "en"), "New York");
  assert.equal(C.zoneLabel("America/Argentina/Jujuy", "", "el"), "Jujuy");
  assert.equal(C.zoneLabel("UTC", "", "el"), "UTC");
  assert.equal(C.zoneLabel("Europe/Athens", "My place", "el"), "My place");   // unknown city text kept
});

// ---------------------------------------------------------------
// Zones in time
// ---------------------------------------------------------------

test("offsets, parts and midnight in a zone (DST aware)", () => {
  const jan = Date.UTC(2026, 0, 15, 12), jul = Date.UTC(2026, 6, 15, 12);
  assert.equal(C.offsetMin("Europe/Athens", jan), 120);
  assert.equal(C.offsetMin("Europe/Athens", jul), 180);
  assert.equal(C.offsetMin("Asia/Kolkata", jan), 330);
  assert.equal(C.offsetMin("America/New_York", jan), -300);
  assert.equal(C.offsetMin("UTC", jan), 0);
  const p = C.partsIn("Asia/Tokyo", Date.UTC(2026, 9, 14, 20, 30));
  assert.deepEqual([p.y, p.mo, p.d, p.h, p.mi, p.wd], [2026, 10, 15, 5, 30, 4]);
  assert.equal(C.midnightIn("Europe/Athens", 2026, 10, 14), Date.UTC(2026, 9, 13, 21));
  assert.equal(C.midnightIn("America/Los_Angeles", 2026, 3, 8), Date.UTC(2026, 2, 8, 8));   // DST starts that night
  assert.equal(C.diffLabel(0), "±0");
  assert.equal(C.diffLabel(-420), "−7");
  assert.equal(C.diffLabel(150), "+2:30");
  assert.equal(C.dayDiff({ y: 2026, mo: 1, d: 1 }, { y: 2025, mo: 12, d: 31 }), 1);
});

// ---------------------------------------------------------------
// Meeting planner
// ---------------------------------------------------------------

test("planner: aligned rows, working hours on weekdays, everyone-at-work columns", () => {
  const base = C.midnightIn("Europe/Athens", 2026, 10, 14);   // Wednesday
  const r = C.planRows(["Europe/Athens", "Europe/London", "America/New_York"], base, { wf: "09:00", wt: "17:00" });
  assert.equal(r.rows.length, 3);
  r.rows.forEach((row) => assert.equal(row.cells.length, 24));
  // Same instant per column
  for (let i = 0; i < 24; i++) assert.equal(r.rows[0].cells[i].ms, r.rows[2].cells[i].ms);
  assert.equal(r.rows[0].cells[0].h, 0);
  assert.equal(r.rows[1].cells[0].h, 22);           // London is 2 hours behind (BST)
  assert.equal(r.rows[2].cells[0].h, 17);           // New York 7 behind (EDT)
  assert.equal(r.rows[2].cells[7].newDay, true);    // midnight in New York
  assert.equal(r.rows[0].cells[10].cls, "work");
  assert.equal(r.rows[0].cells[20].cls, "awake");
  assert.equal(r.rows[0].cells[3].cls, "night");
  // Athens 16:00 = London 14:00 = New York 09:00: the only common hour
  assert.deepEqual(r.allWork.map((x, i) => x ? i : -1).filter((i) => i >= 0), [16]);
});

test("planner: weekends are not working hours; half-hour zones; overnight shifts", () => {
  const sat = C.midnightIn("Europe/Athens", 2026, 10, 17);
  const r = C.planRows(["Europe/Athens"], sat, {});
  assert.ok(r.rows[0].cells.every((c) => c.cls !== "work"));
  const wed = C.midnightIn("Europe/Athens", 2026, 10, 14);
  const k = C.planRows(["Asia/Kolkata"], wed, {}).rows[0].cells;
  assert.equal(k[0].mi, 30);
  assert.equal(C.isWork(23 * 60, 3, C.hmMin("22:00"), C.hmMin("06:00")), true);
  assert.equal(C.isWork(12 * 60, 3, C.hmMin("22:00"), C.hmMin("06:00")), false);
  assert.equal(C.isWork(12 * 60, 3, 600, 600), false);
  const s = C.slotIn(["Europe/Athens", "America/New_York"], wed + 23 * H, 90);
  assert.equal(C.hm(s[0].s), "23:00");
  assert.equal(C.hm(s[0].e), "00:30");
  assert.equal(C.dayDiff(s[0].e, s[0].s), 1);
  assert.equal(C.hm(s[1].s), "16:00");
});

// ---------------------------------------------------------------
// Kitchen timers
// ---------------------------------------------------------------

test("timers: start, pause, resume, +1 min, done, restart, reset", () => {
  const t0 = 1000000;
  let t = C.timerNew("abcd1234", "Pasta", 10 * MIN, "bell");
  assert.equal(t.st, "idle");
  assert.equal(C.timerLeft(t, t0), 10 * MIN);
  t = C.timerStart(t, t0);
  assert.equal(t.st, "run");
  assert.equal(t.end, t0 + 10 * MIN);
  t = C.timerPause(t, t0 + 4 * MIN);
  assert.equal(t.st, "pause");
  assert.equal(t.left, 6 * MIN);
  assert.equal(C.timerProgress(t, t0), 0.4);
  t = C.timerAdd(t, MIN, t0 + 5 * MIN);
  assert.equal(t.left, 7 * MIN);
  assert.equal(t.tot, 11 * MIN);
  t = C.timerStart(t, t0 + 5 * MIN);
  assert.equal(t.end, t0 + 12 * MIN);
  t = C.timerAdd(t, MIN, t0 + 6 * MIN);
  assert.equal(t.end, t0 + 13 * MIN);
  let r = C.timerTick([t], t0 + 12 * MIN);
  assert.equal(r.changed, false);
  r = C.timerTick([t], t0 + 13 * MIN);
  assert.equal(r.changed, true);
  t = r.list[0];
  assert.equal(t.st, "done");
  assert.equal(C.timerLeft(t, t0 + 13 * MIN + 12000), -12000);
  assert.equal(C.fmtTimer(-12000), "−00:12");
  assert.equal(C.timerProgress(t, t0), 1);
  const plus = C.timerAdd(t, MIN, t0 + 14 * MIN);     // +1 min on a finished timer runs one more minute
  assert.equal(plus.st, "run");
  assert.equal(plus.end, t0 + 15 * MIN);
  t = C.timerStart(t, t0 + 20 * MIN);                 // Restart: the preset again
  assert.equal(t.end, t0 + 30 * MIN);
  t = C.timerReset(t);
  assert.deepEqual([t.st, t.left, t.tot, t.end], ["idle", 10 * MIN, 10 * MIN, 0]);
  assert.equal(C.fmtTimer(5 * MIN), "05:00");
  assert.equal(C.fmtTimer(3723000), "1:02:03");
  assert.equal(C.fmtTimer(1500), "00:02");            // counts down rounding up
});

test("timers: normalise drops bad rows, caps the list, keeps only tmr- alarm ids", () => {
  const ok = C.timerNew("aaaa1111", "Eggs", 6 * MIN, "nope");
  assert.equal(ok.sound, "beep");
  const list = C.timerNorm([
    ok,
    Object.assign({}, ok),                                   // duplicate id
    { id: "BAD", dur: 1000 },
    { id: "bbbb2222", dur: 0 },
    Object.assign({}, ok, { id: "cccc3333", st: "run", end: 0 }),   // running without an end → idle
    Object.assign({}, ok, { id: "dddd4444", aid: "x-1", name: "a\u0001b" + "z".repeat(60) }),
    null
  ]);
  assert.deepEqual(list.map((t) => t.id), ["aaaa1111", "cccc3333", "dddd4444"]);
  assert.equal(list[1].st, "idle");
  assert.equal(list[2].aid, "");
  assert.equal(list[2].name.length, 40);
  assert.ok(!/\u0001/.test(list[2].name));
  const many = [];
  for (let i = 0; i < 30; i++) many.push(C.timerNew("t" + String(i).padStart(4, "0"), "", MIN, "chime"));
  assert.equal(C.timerNorm(many).length, C.MAX_TIMERS);
  assert.deepEqual(C.SOUNDS, ["beep", "chime", "bell", "digital", "gentle"]);
});

// ---------------------------------------------------------------
// Stopwatch
// ---------------------------------------------------------------

test("stopwatch: runs from timestamps, laps, best / worst, text and CSV", () => {
  let sw = C.swReset();
  sw = C.swToggle(sw, 1000);
  assert.equal(C.swElapsed(sw, 4000), 3000);
  sw = C.swLap(sw, 4000);
  sw = C.swLap(sw, 9500);
  sw = C.swToggle(sw, 11000);                      // stop
  assert.equal(sw.run, false);
  assert.equal(C.swElapsed(sw, 99999), 10000);
  assert.deepEqual(C.swLap(sw, 12000), sw);         // no lap while stopped
  sw = C.swToggle(sw, 20000);
  sw = C.swLap(sw, 21000);
  const rows = C.lapRows(sw.laps);
  assert.deepEqual(rows.map((r) => [r.n, r.lap, r.total]), [[1, 3000, 3000], [2, 5500, 8500], [3, 2500, 11000]]);
  assert.equal(rows[2].best, true);
  assert.equal(rows[1].worst, true);
  assert.equal(C.lapRows([1000]).some((r) => r.best || r.worst), false);
  assert.equal(C.fmtSw(3723456), "1:02:03.45");
  assert.equal(C.fmtSw(65432), "01:05.43");
  const txt = C.lapsText(rows, { title: "Χρονόμετρο", lap: "Γύρος" });
  assert.equal(txt.split("\n")[0], "Χρονόμετρο · 00:11.00");
  assert.equal(txt.split("\n")[2], "Γύρος 2\t00:05.50\t00:08.50");
  const csv = C.lapsCsv(rows, ["Lap", "Lap time", "Total", "Lap, ms", "Total ms"]);
  assert.equal(csv.split("\r\n")[0], 'Lap,Lap time,Total,"Lap, ms",Total ms');
  assert.equal(csv.split("\r\n")[1], "1,00:03.00,00:03.00,3000,3000");
  // Restore: a stored running watch keeps counting; junk is cleaned
  const back = C.swNorm(JSON.parse(JSON.stringify(sw)));
  assert.equal(C.swElapsed(back, 31000), 21000);
  assert.deepEqual(C.swNorm({ run: true, start: "x", laps: [5, 3, "a"] }), { run: false, start: 0, base: 0, laps: [5] });
});

// ---------------------------------------------------------------
// The `time` slice: zones with a city (mergeTime, extracted)
// ---------------------------------------------------------------

function timeMerge() {
  const src = read("time/time.js");
  const block = (from, to) => {
    const i = src.indexOf(from), j = src.indexOf(to, i);
    if (i < 0 || j < 0) throw new Error("missing block " + from);
    return src.slice(i, j);
  };
  return new Function(
    block("  function sanitizeZone(z) {", "  function loadState() {") +
    block("  function mergeTime(local, remote) {", "  // Pull-fed setter") +
    "\nreturn { mergeTime, canonTime, sanitizeZone };")();
}

test("time slice: a city rides on the zone; old zones keep their bytes; merge symmetric", () => {
  const M = timeMerge();
  const old = { zones: [{ tz: "Europe/London", mtime: 5 }] };
  assert.equal(JSON.stringify(M.canonTime(old).zones), '[{"tz":"Europe/London","mtime":5}]');
  const a = { zones: [{ tz: "Europe/Athens", mtime: 10, city: "Thessaloniki" }] };
  const b = { zones: [{ tz: "Europe/Athens", mtime: 10 }] };          // a pre-wave-5 device stripped it
  const ab = M.mergeTime(a, b), ba = M.mergeTime(b, a);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba));
  assert.equal(ab.zones[0].city, "Thessaloniki");
  const c = { zones: [{ tz: "Europe/Athens", mtime: 10, city: "Patras" }] };
  assert.equal(JSON.stringify(M.mergeTime(a, c)), JSON.stringify(M.mergeTime(c, a)));
  const newer = { zones: [{ tz: "Europe/Athens", mtime: 11 }] };      // renamed back to the zone later
  assert.equal(M.mergeTime(a, newer).zones[0].city, undefined);
  assert.equal(M.sanitizeZone({ tz: "X/Y", mtime: 1, city: " a\u0002b " }).city, "a b");
  assert.equal("city" in M.sanitizeZone({ tz: "X/Y", mtime: 1, city: "  " }), false);
  // canonical is idempotent with a city
  const once = M.canonTime(ab);
  assert.equal(JSON.stringify(M.canonTime(once)), JSON.stringify(once));
});

// ---------------------------------------------------------------
// Shell: kitchen-timer alarms stay on this device
// ---------------------------------------------------------------

function shellAlarms() {
  const src = read("shell.js");
  const block = (from, to) => {
    const i = src.indexOf(from), j = src.indexOf(to, i);
    if (i < 0 || j < 0) throw new Error("missing block " + from);
    return src.slice(i, j);
  };
  return new Function(
    block("  function alarmCanon(a) {", "  // Deterministic total order") +
    block("  function alarmBetter(a, b) {", "  function alarmTombsClean(raw) {") +
    block("  // Time wave 5: \"tmr-\" ids", "  // Next firing of a daily alarm") +
    "\nreturn { alarmsCanonical, alarmIsTimer };")();
}

test("shell: tmr- alarms never enter the synced alarm list; others unchanged", () => {
  const S = shellAlarms();
  const now = 1e12;
  const list = [
    { id: "abc", at: now + H, label: "Wake", repeat: "daily", state: "pending", mtime: 3 },
    { id: "tmr-aaaa1111-x", at: now + MIN, label: "Pasta", repeat: "once", state: "pending", mtime: 4 }
  ];
  assert.deepEqual(S.alarmsCanonical(list, {}, now).map((a) => a.id), ["abc"]);
  assert.equal(S.alarmIsTimer("tmr-1"), true);
  assert.equal(S.alarmIsTimer("tm-1"), false);
  const src = read("shell.js");
  assert.ok(/alarmIsTimer\(mine\[ti\]\.id\)/.test(src), "a pull keeps this device's timers");
  assert.ok(/if \(gone && !alarmIsTimer\(id\)\)/.test(src), "removing a timer leaves no tombstone");
  assert.ok(/window\.orosAlarmSound = function/.test(src), "sound preview for Time");
  assert.ok(/var voice = alarmSoundOf\(a\)/.test(src), "a timer rings with its own sound");
});

test("phone bridge: timer alarms are reminder rows (rung by the Android app), opening the Timer tab", () => {
  const P = require("../phone.js");
  const fn = P.reminderRows || (P._test && P._test.reminderRows);
  if (typeof fn !== "function") return;   // not exported in this build
  const now = Date.UTC(2026, 9, 14, 10);
  const rows = fn({ alarms: [{ id: "tmr-aaaa1111-x", at: now + 5 * MIN, label: "Pasta", repeat: "once", state: "pending" }], lang: "en" }, now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].body, "Pasta");
  assert.equal(rows[0].link, "time:timer");
});

test("Today: kitchen timers are left out, alarms stay", () => {
  const P = require("../time/today.js");
  const now = new Date(2026, 9, 14, 9, 0).getTime();
  const at = new Date(2026, 9, 14, 20, 0).getTime();
  global.orosAlarms = { list: () => [
    { id: "tmr-aaaa1111-x", at: at, label: "Roast", repeat: "once", mtime: now - 6 * H },
    { id: "zz", at: at, label: "Call mum", repeat: "once", mtime: now - 6 * H }
  ] };
  try {
    const rows = P.collect({ now, today: "2026-10-14", lang: "en", horizon: 3, readJSON: () => null, addDays: (d) => d });
    assert.deepEqual(rows.map((r) => r.title), ["Call mum"]);
  } finally { delete global.orosAlarms; }
});

// ---------------------------------------------------------------
// Page wiring
// ---------------------------------------------------------------

test("page: scripts in order, new controls present, i18n parity, help EN/EL limits", () => {
  const html = read("time/index.html");
  const iC = html.indexOf("cities.js"), iK = html.indexOf("clock-core.js"), iT = html.indexOf('src="time.js');
  assert.ok(iC > 0 && iC < iK && iK < iT, "cities → core → time.js");
  ["zone-q", "zone-res", "pl-toggle", "pl-grid", "pl-cal", "pl-copy", "tmr-list", "tm-name", "tm-sound", "tm-presets",
   "st-lap", "st-laps", "st-copy", "st-csv"].forEach((id) => assert.ok(html.indexOf('id="' + id + '"') > 0, id));
  const src = read("time/time.js");
  const pack = (lang) => {
    const i = src.indexOf("    " + lang + ": {"), j = src.indexOf("\n    }", i);
    return new Set((src.slice(i, j).match(/"([a-z][a-z0-9.]*)":/g) || []).map((k) => k.slice(1, -2)));
  };
  const en = pack("en"), el = pack("el");
  assert.deepEqual([...en].filter((k) => !el.has(k)), []);
  assert.deepEqual([...el].filter((k) => !en.has(k)), []);
  ["pl.cal", "tm.plus", "st.lap", "snd.bell", "zones.ph"].forEach((k) => assert.ok(en.has(k), k));
  ["en", "el"].forEach((l) => {
    const h = read("time/help." + l + ".txt");
    assert.ok(!/21/.test(h.split(/\n## /).pop()), "no fixed list of 21 zones in Limits (" + l + ")");
  });
  assert.ok(!/stopwatch resets/i.test(read("time/help.en.txt")));
});
