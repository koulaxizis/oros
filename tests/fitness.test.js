// Pure logic of Workouts (fitness/): unit parsing and formatting,
// the ready exercises and programs, the sync merge (slice "fitness"),
// records, the progression hint, weekly stats and the CSV export.
// Run: node --test tests/
//
// The app is a browser IIFE with no exports, so the constants, the
// strings and sections 2–4 are cut out of the source and evaluated
// on their own.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { webcrypto } = require("crypto");

const src = fs.readFileSync(path.join(__dirname, "..", "fitness/fitness.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
function build(lang) {
  return new Function("crypto",
    "var LANG = " + JSON.stringify(lang) + ";\n" +
    block("  var STORAGE_KEY", "  // ---------- 1.") +
    block("  var STRINGS", "  function newId(") +
    block("  // ---------- 2. Ready", "  // ---------- 5. Storage") +
    "\nreturn { SEED_EX, SEED_MAP, SEED_PG, GROUPS, KINDS, DEF_SET, F_DONE, F_WARM, STRINGS," +
    " parseNum, parseW, fmtW, parseDist, fmtDist, parseLen, fmtLen, parseTime, fmtTime, parseReps, fmtNum," +
    " e1rm, exInfo, allExercises, normEx, normPg, normWo, normBm, normSettings, mergeFit, emptyData," +
    " entryStats, recordsOf, bestsFor, lastEntry, suggestW, woVolume, woSets, perWeek, groupSets, dayCounts," +
    " seriesFor, buildCsv, csvCell, weekStart, ymd };")(webcrypto);
}
const F = build("en");
const FEL = build("el");

const D = 1, W = 2;   // set flags: done, warm-up
function wo(id, m, d, st, x, extra) {
  return Object.assign({ id, m, d, st, en: st + 3600000, ti: "W", p: "", pd: "", n: "", x }, extra || {});
}
function ent(e, sets, tr, tr2) { return { e, tr: tr || 0, tr2: tr2 || 0, rest: 0, s: sets }; }
function data(parts) { return Object.assign(F.emptyData(), parts || {}); }
const DAY = 86400000;
const T0 = new Date(2026, 9, 5, 18, 0).getTime();   // Monday 5 Oct 2026, 18:00

test("numbers: both decimal marks, units, bad input refused", () => {
  assert.equal(F.parseNum("12,5"), 12.5);
  assert.equal(F.parseNum(" 12.5 "), 12.5);
  assert.ok(isNaN(F.parseNum("12,5,1")));
  assert.ok(isNaN(F.parseNum("-3")));
  assert.ok(isNaN(F.parseNum("1e3")));
  assert.equal(F.parseW("62,5", "kg"), 62500);
  assert.equal(F.parseW("135", "lb"), Math.round(135 * 453.59237));
  assert.ok(isNaN(F.parseW("3000", "kg")));      // over 2 t
  assert.equal(F.fmtW(62500, "kg"), "62.5");
  assert.equal(FEL.fmtW(62500, "kg"), "62,5");
  assert.equal(F.fmtW(F.parseW("135", "lb"), "lb"), "135");
  assert.equal(F.parseDist("5,25", "km"), 5250);
  assert.equal(F.fmtDist(F.parseDist("3.1", "mi"), "mi"), "3.1");
  assert.equal(F.parseLen("82,5", "km"), 825);   // cm → mm
  assert.equal(FEL.fmtNum(12345.6, 0), "12.346");
  assert.equal(F.fmtNum(12345.6, 0), "12,346");
});

test("time: m:ss, h:mm:ss and bare seconds", () => {
  assert.equal(F.parseTime("90"), 90);
  assert.equal(F.parseTime("1:30"), 90);
  assert.equal(F.parseTime("1:02:03"), 3723);
  assert.ok(isNaN(F.parseTime("1:61")));
  assert.ok(isNaN(F.parseTime("1:60:00")));
  assert.ok(isNaN(F.parseTime("abc")));
  assert.equal(F.fmtTime(90), "1:30");
  assert.equal(F.fmtTime(3723), "1:02:03");
  assert.equal(F.parseReps("12"), 12);
  assert.ok(isNaN(F.parseReps("12.5")));
});

test("estimated 1RM (Epley): one rep is the weight, beyond 12 reps none", () => {
  assert.equal(F.e1rm(100000, 1), 100000);
  assert.equal(F.e1rm(100000, 5), Math.round(100000 * (1 + 5 / 30)));
  assert.equal(F.e1rm(100000, 13), 0);
  assert.equal(F.e1rm(0, 5), 0);
});

test("ready exercises and programs: unique ids, both languages, valid", () => {
  const ids = new Set();
  F.SEED_EX.forEach((r) => {
    assert.ok(/^x-[a-z0-9]+$/.test(r[0]), r[0]);
    assert.ok(!ids.has(r[0]), r[0]);
    ids.add(r[0]);
    assert.ok(F.GROUPS.includes(r[1]), r[0]);
    assert.ok(F.KINDS.includes(r[2]), r[0]);
    assert.ok(r[3] && r[4], r[0]);
  });
  assert.ok(F.SEED_EX.length >= 50);
  F.SEED_PG.forEach((p) => {
    const n = F.normPg({ id: p.id, m: 1, n: p.en, days: p.days.map((d) => ({ id: d.id, n: d.en, wd: d.wd, it: d.it })) });
    assert.ok(n, p.id);
    assert.equal(n.days.length, p.days.length);
    p.days.forEach((d, i) => {
      assert.equal(n.days[i].it.length, d.it.length, p.id + "/" + d.id);
      d.it.forEach((it) => assert.ok(F.SEED_MAP[it.e], it.e));
    });
  });
  // every string key exists in both languages
  assert.deepEqual(Object.keys(F.STRINGS.en).sort(), Object.keys(F.STRINGS.el).sort());
  assert.equal(F.exInfo(data(), "x-bench").name, "Bench press");
  assert.equal(FEL.exInfo(data(), "x-bench").name, "Πιέσεις πάγκου");
});

test("an edited ready exercise keeps its measure and stays translatable", () => {
  const d = data({ ex: [{ id: "x-plank", m: 5, n: "", g: "core", k: "wr", h: 1 }] });
  const n = F.mergeFit(d, d);
  assert.equal(n.ex[0].k, "t");               // the ready measure wins
  assert.equal(F.exInfo(n, "x-plank").name, "Plank");
  assert.equal(FEL.exInfo(n, "x-plank").name, "Σανίδα");
  assert.equal(F.exInfo(n, "x-plank").h, 1);
  assert.equal(F.normEx({ id: "own1", m: 1, n: "", g: "legs", k: "wr" }), null);   // own needs a name
});

test("normalize: bad rows dropped, values clamped, control chars cleaned", () => {
  assert.equal(F.normWo({ id: "a", m: 1, d: "2026-10-05", st: -1, x: [] }), null);
  assert.equal(F.normWo({ id: "A B", m: 1, d: "2026-10-05", st: 1, x: [] }), null);
  assert.equal(F.normWo({ id: "a", m: 1, d: "5/10/2026", st: 1, x: [] }), null);
  const w = F.normWo({ id: "a", m: 1, d: "2026-10-05", st: 10, en: 5, ti: "Push\u0000 <b>day</b>", n: 3,
                       x: [{ e: "x-bench", s: [[1e12, -4, "x", 2, 7], "bad"], tr: 8, tr2: 6 }, { e: "BAD ID" }] });
  assert.equal(w.en, 0);                       // end before start → still running
  assert.equal(w.ti, "Push <b>day</b>");       // shown as text, never as markup
  assert.equal(w.n, "");
  assert.equal(w.x.length, 1);
  assert.deepEqual(w.x[0].s, [[0, 0, 0, 2, 0]]);
  assert.equal(w.x[0].tr2, 0);                 // a range must go up
  assert.equal(F.normBm({ id: "2026-10-05", m: 1, w: 0 }), null);
  assert.equal(F.normSettings({ m: 1, wu: "stone", du: "mi", incU: 0, rest: 99999 }).wu, "kg");
});

function rnd(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function randomData(r) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const ids = ["a", "b", "c", "d"];
  const out = data({ set: r() < 0.5 ? { m: Math.floor(r() * 5), wu: pick(["kg", "lb"]), du: "km", incU: 2500, incL: 5000, rest: 90 } : null });
  ids.forEach((id) => {
    if (r() < 0.6) out.wo.push(wo(id, Math.floor(r() * 5), "2026-10-0" + (1 + Math.floor(r() * 8)), T0,
      [ent(pick(["x-bench", "x-squat", "x-plank"]), [[Math.floor(r() * 4) * 2500, Math.floor(r() * 10), 0, 0, Math.floor(r() * 4)]])]));
    if (r() < 0.3) out.tombs["wo:" + id] = Math.floor(r() * 5);
    if (r() < 0.4) out.pg.push({ id: "p" + id, m: Math.floor(r() * 5), n: pick(["A", "B"]), days: [{ id: "d1", n: "", wd: [0], it: [{ e: "x-bench", s: 3, r: 5, r2: 0, t: 0, w: 0, rest: 0 }] }] });
    if (r() < 0.2) out.tombs["pg:p" + id] = Math.floor(r() * 5);
    if (r() < 0.4) out.bm.push({ id: "2026-10-0" + (1 + ids.indexOf(id)), m: Math.floor(r() * 5), w: 70000 + Math.floor(r() * 3) * 500, wa: 0, ch: 0, ar: 0 });
    if (r() < 0.3) out.ex.push({ id: "e" + id, m: Math.floor(r() * 5), n: pick(["Own", "Mine"]), g: pick(F.GROUPS), k: pick(F.KINDS), h: Math.floor(r() * 2) });
  });
  return out;
}

test("merge laws: commutative, idempotent, associative, canonical (R26)", () => {
  const r = rnd(42);
  for (let i = 0; i < 400; i++) {
    const a = randomData(r), b = randomData(r), c = randomData(r);
    const ab = F.mergeFit(a, b), ba = F.mergeFit(b, a);
    assert.deepEqual(ab, ba);
    assert.deepEqual(F.mergeFit(ab, ab), ab);
    assert.deepEqual(F.mergeFit(F.mergeFit(a, b), c), F.mergeFit(a, F.mergeFit(b, c)));
    assert.equal(JSON.stringify(F.mergeFit(ab, ab)), JSON.stringify(ab));
    ["ex", "pg", "wo", "bm"].forEach((k) => {
      const sorted = ab[k].map((x) => x.id).slice().sort();
      assert.deepEqual(ab[k].map((x) => x.id), sorted);
    });
  }
});

test("merge: newer row wins, a tombstone wins the tie, a newer edit resurrects", () => {
  const a = data({ wo: [wo("w1", 5, "2026-10-05", T0, [], { ti: "old" })] });
  const b = data({ wo: [wo("w1", 9, "2026-10-05", T0, [], { ti: "new" })] });
  assert.equal(F.mergeFit(a, b).wo[0].ti, "new");
  const del = data({ tombs: { "wo:w1": 9 } });
  assert.equal(F.mergeFit(b, del).wo.length, 0);              // tie → deleted
  const back = data({ wo: [wo("w1", 10, "2026-10-05", T0, [], { ti: "back" })] });
  assert.equal(F.mergeFit(F.mergeFit(b, del), back).wo[0].ti, "back");
  // tombstones from unknown collections are dropped
  assert.deepEqual(F.mergeFit(data({ tombs: { "zz:x": 4, "nocolon": 3 } }), data()).tombs, {});
  // settings: newer wins
  const s1 = data({ set: { m: 3, wu: "kg", du: "km", incU: 2500, incL: 5000, rest: 90 } });
  const s2 = data({ set: { m: 4, wu: "lb", du: "mi", incU: 2268, incL: 4536, rest: 120 } });
  assert.equal(F.mergeFit(s1, s2).set.wu, "lb");
  assert.equal(F.mergeFit(s2, s1).set.wu, "lb");
});

test("fuzz: garbage never throws and merges to a fixed point", () => {
  const r = rnd(7);
  const junk = [null, 1, "x", [], {}, { id: 3 }, { id: "a", m: "1" }, { wo: "no" }, { tombs: [] }, { set: 4 },
                { ex: [{ id: "x-bench", m: 1, g: "nope" }] }, { wo: [{ id: "a", m: 1, d: "2026-01-01", st: 1, x: [{ e: "x-run", s: [[1, 2, 3]] }] }] }];
  for (let i = 0; i < 300; i++) {
    const a = r() < 0.5 ? junk[Math.floor(r() * junk.length)] : randomData(r);
    const b = r() < 0.5 ? junk[Math.floor(r() * junk.length)] : randomData(r);
    const m = F.mergeFit(a, b);
    assert.deepEqual(F.mergeFit(m, m), m);
    assert.ok(Array.isArray(m.wo) && Array.isArray(m.pg) && Array.isArray(m.ex) && Array.isArray(m.bm));
  }
});

test("entry stats: warm-ups and unticked sets do not count", () => {
  const e = ent("x-bench", [[40000, 10, 0, 0, D | W], [60000, 8, 0, 0, D], [62500, 6, 0, 0, D], [70000, 5, 0, 0, 0]]);
  const s = F.entryStats(e, "wr");
  assert.equal(s.sets, 2);
  assert.equal(s.top, 62500);
  assert.equal(s.vol, 60000 * 8 + 62500 * 6);
  assert.equal(s.e1, Math.max(F.e1rm(60000, 8), F.e1rm(62500, 6)));
  const run = F.entryStats(ent("x-run", [[0, 0, 1500, 5000, D]]), "dt");
  assert.equal(run.dist, 5000);
  assert.equal(run.pace, 300);                 // 5:00 per km
});

test("records: against earlier workouts only, never on the first time", () => {
  const w1 = wo("w1", 1, "2026-10-01", T0 - 4 * DAY, [ent("x-bench", [[60000, 8, 0, 0, D]])]);
  const w2 = wo("w2", 1, "2026-10-05", T0, [ent("x-bench", [[62500, 8, 0, 0, D]]), ent("x-squat", [[100000, 5, 0, 0, D]])]);
  const d = data({ wo: [w1, w2] });
  assert.deepEqual(F.recordsOf(d, w1), []);
  const recs = F.recordsOf(d, w2);
  assert.ok(recs.some((r) => r.e === "x-bench" && r.k === "top" && r.v === 62500));
  assert.ok(recs.some((r) => r.e === "x-bench" && r.k === "vol"));
  assert.ok(!recs.some((r) => r.e === "x-squat"));          // first squat: nothing to beat
  const w3 = wo("w3", 1, "2026-10-06", T0 + DAY, [ent("x-bench", [[50000, 8, 0, 0, D]])]);
  assert.deepEqual(F.recordsOf(data({ wo: [w1, w2, w3] }), w3), []);
});

test("progression hint: every working set at the top of the range → one step heavier", () => {
  const set = F.DEF_SET;
  const bench = F.exInfo(data(), "x-bench"), squat = F.exInfo(data(), "x-squat"), dl = F.exInfo(data(), "x-deadlift");
  const hit = ent("x-bench", [[40000, 10, 0, 0, D | W], [60000, 8, 0, 0, D], [60000, 8, 0, 0, D]], 6, 8);
  assert.equal(F.suggestW(hit, bench, set), 62500);
  assert.equal(F.suggestW(Object.assign({}, hit, { e: "x-squat" }), squat, set), 65000);
  assert.equal(F.suggestW(Object.assign({}, hit, { e: "x-deadlift" }), dl, set), 65000);
  const miss = ent("x-bench", [[60000, 8, 0, 0, D], [60000, 7, 0, 0, D]], 6, 8);
  assert.equal(F.suggestW(miss, bench, set), 0);
  const skipped = ent("x-bench", [[60000, 8, 0, 0, D], [60000, 8, 0, 0, 0]], 6, 8);
  assert.equal(F.suggestW(skipped, bench, set), 0);
  assert.equal(F.suggestW(ent("x-bench", [[60000, 8, 0, 0, D]]), bench, set), 0);   // no target, no hint
  assert.equal(F.suggestW(null, bench, set), 0);
});

test("last entry: the newest finished one before the moment, running ones skipped", () => {
  const w1 = wo("w1", 1, "2026-10-01", T0 - 4 * DAY, [ent("x-bench", [[60000, 8, 0, 0, D]])]);
  const w2 = wo("w2", 1, "2026-10-03", T0 - 2 * DAY, [ent("x-bench", [[62500, 8, 0, 0, D]])]);
  const run = wo("w3", 1, "2026-10-05", T0, [ent("x-bench", [[70000, 8, 0, 0, D]])], { en: 0 });
  const d = data({ wo: [w1, w2, run] });
  assert.equal(F.lastEntry(d, "x-bench", T0 + DAY, null).s[0][0], 62500);
  assert.equal(F.lastEntry(d, "x-bench", T0 - 3 * DAY, null).s[0][0], 60000);
  assert.equal(F.lastEntry(d, "x-squat", T0, null), null);
});

test("weekly stats, sets per muscle group, training days", () => {
  const now = new Date(T0 + 2 * DAY);   // Wednesday
  const wos = [
    wo("a", 1, "2026-10-05", T0, [ent("x-bench", [[60000, 8, 0, 0, D], [60000, 8, 0, 0, D | W]]), ent("x-squat", [[1, 1, 0, 0, D]])]),
    wo("b", 1, "2026-10-06", T0 + DAY, [ent("x-pullup", [[0, 8, 0, 0, D], [0, 8, 0, 0, D]])]),
    wo("c", 1, "2026-09-28", T0 - 7 * DAY, [ent("x-bench", [[60000, 8, 0, 0, D]])])
  ];
  const weeks = F.perWeek(wos, now, 3);
  assert.deepEqual(weeks.map((w) => w.key), ["2026-09-21", "2026-09-28", "2026-10-05"]);
  assert.deepEqual(weeks.map((w) => w.n), [0, 1, 2]);
  const g = F.groupSets(data(), wos, "2026-10-05");
  assert.equal(g.chest, 1);
  assert.equal(g.legs, 1);
  assert.equal(g.back, 2);
  assert.deepEqual(F.dayCounts(wos), { "2026-10-05": 1, "2026-10-06": 1, "2026-09-28": 1 });
  assert.equal(F.woSets(wos[0]), 2);
  assert.equal(F.woVolume(wos[0]), 60000 * 8 + 1);
});

test("series: one point per workout, newest last, range respected", () => {
  const d = data({ wo: [
    wo("b", 1, "2026-10-05", T0, [ent("x-bench", [[62500, 5, 0, 0, D]])]),
    wo("a", 1, "2026-09-01", T0 - 34 * DAY, [ent("x-bench", [[60000, 5, 0, 0, D]]), ent("x-bench", [[61000, 5, 0, 0, D]])]),
    wo("c", 1, "2026-10-06", T0 + DAY, [ent("x-squat", [[90000, 5, 0, 0, D]])])
  ] });
  const all = F.seriesFor(d, "x-bench", "top", "");
  assert.deepEqual(all.map((p) => [p.id, p.y]), [["a", 61000], ["b", 62500]]);
  assert.deepEqual(F.seriesFor(d, "x-bench", "top", "2026-10-01").map((p) => p.id), ["b"]);
});

test("CSV: BOM, separator and decimal mark per language, formulas defused", () => {
  const d = data({ wo: [wo("a", 1, "2026-10-05", T0, [
    ent("x-bench", [[62500, 5, 0, 0, D], [99999, 9, 0, 0, 0]]),
    ent("x-run", [[0, 0, 1500, 5250, D]])
  ], { ti: "=HYPERLINK(\"x\")" })] });
  const en = F.buildCsv(d), el = FEL.buildCsv(d);
  assert.ok(en.startsWith("﻿Date,Workout,Exercise"));
  assert.ok(el.startsWith("﻿Ημερομηνία;Προπόνηση;Άσκηση"));
  const enRows = en.trim().split("\r\n"), elRows = el.trim().split("\r\n");
  assert.equal(enRows.length, 3);                          // unticked set left out
  assert.ok(enRows[1].includes(",62.5,5,"));
  assert.ok(elRows[1].includes(";62,5;5;"));
  assert.ok(elRows[2].includes(";1500;5,25;"));
  assert.ok(enRows[1].includes("\"'=HYPERLINK(\"\"x\"\")\""));
  assert.equal(F.csvCell("+1", ","), "'+1");
  assert.equal(F.csvCell("a;b", ";"), "\"a;b\"");
});
