// Pure logic of Plant Care (plants/core.js): dates, the schedule
// (intervals, winter, postponements), the daily reminder summary,
// the weather hint and the sync merge (slice "plants").
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "plants/core.js"));

const NOW = Date.UTC(2026, 9, 8, 10, 0, 0);   // 2026-10-08
const TODAY = "2026-10-08";

function plant(id, extra) {
  return Object.assign({ id, m: 1000, name: "Plant " + id, sp: "", room: "", out: 0, em: "",
    w: 7, ww: 0, f: 0, mi: 0, r: 0, st: "2026-10-01", sn: {}, notes: "" }, extra || {});
}
function entry(id, p, k, d, extra) { return Object.assign({ id, p, k, d, s: 0, m: 2000 }, extra || {}); }
function data(plants, log, tombs) { return { ver: 1, plants: plants || [], log: log || [], tombs: tombs || {} }; }
function m(a, b) { return C.merge(a, b, NOW); }

test("dates: whole-day arithmetic, month/year edges, DST-proof", () => {
  assert.equal(C.addDays("2026-02-27", 2), "2026-03-01");
  assert.equal(C.addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(C.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(C.addDays("2026-03-28", 2), "2026-03-30");   // EU spring-forward weekend
  assert.equal(C.addDays("2026-10-24", 2), "2026-10-26");   // EU fall-back weekend
  assert.equal(C.dayNum("2026-10-08") - C.dayNum("2026-10-01"), 7);
  assert.ok(C.isYmd("2028-02-29"));
  assert.ok(!C.isYmd("2026-02-29"));
  assert.ok(!C.isYmd("2026-13-01"));
  assert.ok(!C.isYmd("2026-1-01"));
  assert.equal(C.ymdOf(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

test("normalizers drop invalid rows and clean text", () => {
  assert.equal(C.normPlant(plant("bad id!")), null);
  assert.equal(C.normPlant(plant("abc123", { w: 0 })), null);
  assert.equal(C.normPlant(plant("abc123", { w: 61 })), null);
  assert.equal(C.normPlant(plant("abc123", { name: "   " })), null);
  assert.equal(C.normPlant(plant("abc123", { st: "2026-02-30" })), null);
  const p = C.normPlant(plant("abc123", { name: " Big\u0000  fern\n", room: "x".repeat(80), sp: "nope",
    out: true, f: -1, ww: 500, sn: { water: "2026-10-10", foo: "2026-10-10", fert: "bad" }, notes: "a\u0007b\n\n\n\nc", extra: 1 }));
  assert.equal(p.name, "Big fern");
  assert.equal(p.room.length, C.ROOM_LEN);
  assert.equal(p.sp, "");
  assert.equal(p.out, 0);
  assert.equal(p.f, 0);
  assert.equal(p.ww, 0);
  assert.deepEqual(p.sn, { water: "2026-10-10" });
  assert.equal(p.notes, "ab\n\nc");
  assert.ok(!("extra" in p));
  assert.equal(C.normLog(entry("abc123", "pl0001", "drink", TODAY)), null);
  assert.equal(C.normLog(entry("abc123", "pl0001", "water", "2026-10-8")), null);
  assert.deepEqual(C.normLog(entry("abc123", "pl0001", "water", TODAY, { s: true })),
    { id: "abc123", p: "pl0001", k: "water", d: TODAY, s: 0, m: 2000 });
});

test("schedule: start, last done, interval in force on the base day", () => {
  const p = C.normPlant(plant("pl0001", { w: 7, ww: 14, f: 30 }));
  assert.equal(C.nextDue(p, "water", null, "n"), "2026-10-08");
  assert.equal(C.nextDue(p, "water", "2026-10-05", "n"), "2026-10-12");
  assert.equal(C.nextDue(p, "water", "2026-09-01", "n"), "2026-10-08");   // older than the start
  assert.equal(C.nextDue(p, "fert", null, "n"), "2026-10-31");
  assert.equal(C.nextDue(p, "mist", null, "n"), null);                     // off
  // winter interval from November (north) / May (south)
  assert.equal(C.nextDue(p, "water", "2026-11-03", "n"), "2026-11-17");
  assert.equal(C.nextDue(p, "water", "2026-11-03", "s"), "2026-11-10");
  assert.equal(C.nextDue(Object.assign({}, p, { st: "2026-05-01" }), "water", "2026-06-01", "s"), "2026-06-15");
  assert.ok(C.isWinter("2027-02-28", "n") && !C.isWinter("2027-03-01", "n"));
});

test("postponement only moves a task later", () => {
  const p = C.normPlant(plant("pl0001", { sn: { water: "2026-10-10" } }));
  assert.equal(C.nextDue(p, "water", null, "n"), "2026-10-10");
  const q = C.normPlant(plant("pl0001", { sn: { water: "2026-10-03" } }));
  assert.equal(C.nextDue(q, "water", null, "n"), "2026-10-08");
});

test("tasks: late first, horizon, skip counts as done for the cycle", () => {
  const d = m(data([
    plant("aaaaaa", { name: "Basil", w: 2, st: "2026-10-01", out: 1 }),
    plant("bbbbbb", { name: "Fern", w: 3, mi: 2, st: "2026-10-06" }),
    plant("cccccc", { name: "Cactus", w: 14, st: "2026-10-07" })
  ], [
    entry("e00001", "aaaaaa", "water", "2026-10-04"),
    entry("e00002", "bbbbbb", "water", "2026-10-07", { s: 1 })
  ]), null);
  const list = C.tasks(d, TODAY, 7, "n");
  assert.deepEqual(list.map((t) => t.key + "@" + t.diff),
    ["aaaaaa:water@-2", "bbbbbb:mist@0", "bbbbbb:water@2"]);
  assert.equal(C.tasks(d, TODAY, 30, "n").length, 4);
  const s = C.summary(d, TODAY, "n");
  assert.deepEqual(s, { n: 2, names: ["Basil", "Fern"], outWater: true });
  assert.deepEqual(C.summary(data(), TODAY, "n"), { n: 0, names: [], outWater: false });
});

test("average real watering gap ignores skips and same-day doubles", () => {
  const log = [
    entry("e00001", "aaaaaa", "water", "2026-09-01"),
    entry("e00002", "aaaaaa", "water", "2026-09-07"),
    entry("e00003", "aaaaaa", "water", "2026-09-07"),
    entry("e00004", "aaaaaa", "water", "2026-09-10", { s: 1 }),
    entry("e00005", "aaaaaa", "water", "2026-09-14")
  ];
  assert.equal(C.avgGap({ log }, "aaaaaa"), 6.5);
  assert.equal(C.avgGap({ log: log.slice(0, 2) }, "aaaaaa"), null);
});

test("merge: symmetric, idempotent, canonical (R5, R26)", () => {
  const A = data([plant("aaaaaa", { m: 5, name: "A1" }), plant("cccccc")],
                 [entry("e00002", "aaaaaa", "water", "2026-10-05"), entry("e00001", "cccccc", "fert", "2026-10-02")]);
  const B = data([plant("aaaaaa", { m: 9, name: "A2" }), plant("bbbbbb")],
                 [entry("e00003", "bbbbbb", "water", "2026-10-06")]);
  const ab = m(A, B), ba = m(B, A);
  assert.deepEqual(ab, ba);
  assert.deepEqual(m(ab, ab), ab);
  assert.deepEqual(ab.plants.map((p) => p.id + ":" + p.name), ["aaaaaa:A2", "bbbbbb:Plant bbbbbb", "cccccc:Plant cccccc"]);
  assert.deepEqual(ab.log.map((x) => x.id), ["e00001", "e00002", "e00003"]);
  // equal m: the larger canonical JSON wins on both sides
  const X = data([plant("aaaaaa", { m: 7, name: "Zed" })]), Y = data([plant("aaaaaa", { m: 7, name: "Abe" })]);
  assert.equal(m(X, Y).plants[0].name, "Zed");
  assert.equal(m(Y, X).plants[0].name, "Zed");
});

test("merge: two devices water the same plant the same day → both kept, same due", () => {
  const base = data([plant("aaaaaa")]);
  const d1 = m(base, data([], [entry("e1aaaa", "aaaaaa", "water", TODAY)]));
  const d2 = m(base, data([], [entry("e2bbbb", "aaaaaa", "water", TODAY)]));
  const u = m(d1, d2);
  assert.equal(u.log.length, 2);
  const last = C.lastByKind(u);
  assert.equal(C.nextDue(u.plants[0], "water", last.aaaaaa.water, "n"), "2026-10-15");
});

test("merge: tombstones delete, a newer edit resurrects, log follows its plant", () => {
  const A = data([plant("aaaaaa", { m: 100 })], [entry("e00001", "aaaaaa", "water", "2026-10-05", { m: 100 })]);
  const del = data([], [], { aaaaaa: NOW - 1000 });
  const gone = m(A, del);
  assert.equal(gone.plants.length, 0);
  assert.equal(gone.log.length, 0);
  assert.deepEqual(Object.keys(gone.tombs), ["aaaaaa"]);
  const edited = data([plant("aaaaaa", { m: NOW })], [entry("e00001", "aaaaaa", "water", "2026-10-05", { m: 100 })]);
  const back = m(gone, edited);
  assert.equal(back.plants.length, 1);
  assert.equal(back.log.length, 1);
  // undo of one log entry = tombstone on the entry only
  const undone = m(back, data([], [], { e00001: NOW }));
  assert.equal(undone.plants.length, 1);
  assert.equal(undone.log.length, 0);
});

test("merge: clock pruning is the same rule on both sides (no resurrection)", () => {
  const old = entry("e00001", "aaaaaa", "water", "2024-01-01");
  const older = entry("e00000", "aaaaaa", "water", "2023-12-01");
  const fresh = entry("e00002", "aaaaaa", "fert", "2023-01-01");
  const d = m(data([plant("aaaaaa")], [old, older, fresh]), null);
  // old water entries beyond two years: only the newest per plant+kind stays
  assert.deepEqual(d.log.map((x) => x.id), ["e00001", "e00002"]);
  // an old tombstone is forgotten; a fresh one is kept
  const t = m(data([], [], { zzzzzz: NOW - 200 * 86400000, yyyyyy: NOW - 5 * 86400000 }), null);
  assert.deepEqual(Object.keys(t.tombs), ["yyyyyy"]);
  // re-merging a pruned copy changes nothing
  assert.deepEqual(m(d, data([plant("aaaaaa")], [old, older, fresh])), d);
});

test("merge: hostile input never throws and never passes junk", () => {
  const junk = { plants: [null, 5, "x", { id: "<img src=x>", m: 1 }, plant("aaaaaa", { name: "<b>ok</b>" })],
                 log: [{}, entry("e00001", "aaaaaa", "water", TODAY, { m: -1 })], tombs: { "bad id": 5, aaaaab: "x" } };
  const d = m(junk, "nope");
  assert.equal(d.plants.length, 1);
  assert.equal(d.plants[0].name, "<b>ok</b>");   // text stays text; the app escapes on render
  assert.deepEqual(d.log, []);
  assert.deepEqual(d.tombs, {});
  assert.deepEqual(m(null, undefined), data());
});

test("weather hint: nearest city, today's row, fresh cache only", () => {
  const wxData = { cities: [{ id: "c1", lat: 37.98, lon: 23.73 }, { id: "c2", lat: 40.64, lon: 22.94 }] };
  const row = (date, code, pop, max) => ({ date, code, pop, max, min: 10 });
  const cache = {
    c1: { at: NOW - 3600000, daily: [row(TODAY, 1, 10, 25)] },
    c2: { at: NOW - 3600000, daily: [row(TODAY, 61, 80, 20)] }
  };
  assert.deepEqual(C.weather(wxData, cache, { lat: 40.6, lon: 22.9 }, TODAY, NOW), { rain: true, hot: false });
  assert.deepEqual(C.weather(wxData, cache, null, TODAY, NOW), { rain: false, hot: false });
  cache.c1.daily = [row(TODAY, 2, 20, 35)];
  assert.deepEqual(C.weather(wxData, cache, null, TODAY, NOW), { rain: false, hot: true });
  cache.c1.daily = [row(TODAY, 95, null, 20)];
  assert.equal(C.weather(wxData, cache, null, TODAY, NOW).rain, true);
  assert.equal(C.weather(wxData, cache, null, "2026-10-20", NOW), null);   // no row for that day
  cache.c1.at = NOW - 2 * 86400000;
  assert.equal(C.weather(wxData, cache, null, TODAY, NOW), null);           // stale
  assert.equal(C.weather(null, cache, null, TODAY, NOW), null);
});

test("prefs: reminder hour (default 09:00, -1 off) and hemisphere", () => {
  assert.deepEqual(C.readPrefs(null), { remind: 9, hemi: "n" });
  assert.deepEqual(C.readPrefs({ remind: -1, hemi: "s" }), { remind: -1, hemi: "s" });
  assert.deepEqual(C.readPrefs({ remind: 24, hemi: "x" }), { remind: 9, hemi: "n" });
});

test("presets: both languages, valid intervals, unique ids", () => {
  assert.ok(C.PRESET_IDS.length >= 25);
  C.PRESET_IDS.forEach((id) => {
    const p = C.PRESETS[id];
    assert.ok(p.en[0] && p.en[1] && p.el[0] && p.el[1], id);
    assert.ok(p.w >= 1 && p.w <= C.KIND_MAX.w, id);
    assert.ok(p.ww >= 0 && p.ww <= C.KIND_MAX.ww, id);
    assert.ok(p.f >= 0 && p.mi >= 0, id);
    assert.ok(p.out === 0 || p.out === 1, id);
    assert.ok(C.normPlant(plant("aaaaaa", { sp: id, w: p.w, ww: p.ww, f: p.f, mi: p.mi })), id);
  });
});
