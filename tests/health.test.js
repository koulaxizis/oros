// Pure logic of Health (health/core.js): normalizers, the sync merge
// (slice "health"), reference ranges, units, statistics, Workouts
// weights and the reminder math. Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../health/core.js");

const T0 = new Date(2026, 9, 9, 8, 0).getTime();     // Fri 9 Oct 2026, 08:00 local
const H = 3600000, D = 86400000;
function en(id, t, v, extra) {
  return Object.assign({ id, m: 1000, t, at: T0, v, c: 0, a: 0, p: 0, n: "", g: [] }, extra || {});
}
function data(parts) { return Object.assign(C.emptyData(), parts || {}); }
function ty(id, extra) {
  return Object.assign({ id, m: 1000, n: "", u: "", dc: 0, h: 0, lo: null, hi: null, lo2: null, hi2: null, r: [] }, extra || {});
}

test("entries: strict normalizer per kind", () => {
  assert.deepEqual(C.normEntry(en("a", "bp", [120, 80, 70])).v, [120, 80, 70]);
  assert.equal(C.normEntry(en("a", "bp", [80, 90, 70])), null, "diastolic above systolic");
  assert.equal(C.normEntry(en("a", "bp", [400, 80])), null, "systolic out of range");
  assert.deepEqual(C.normEntry(en("a", "bp", [120, 80, 999])).v, [120, 80, 0], "bad optional pulse dropped");
  assert.equal(C.normEntry(en("a", "wt", [100])), null, "100 g is not a body weight");
  assert.deepEqual(C.normEntry(en("a", "sl", [450, 9])).v, [450, 0], "quality outside 0–5 dropped");
  assert.equal(C.normEntry(en("a", "gl", [1050], { c: 9 })).c, 0, "unknown context → random");
  assert.equal(C.normEntry(en("a", "wt", [70000], { c: 2, a: 1, p: 1 })).c, 0, "context only for glucose");
  assert.deepEqual(C.normEntry(en("a", "cxyz", [-1500])).v, [-1500], "own kind may be negative");
  assert.equal(C.normEntry(en("a", "cxyz", [1.5])), null, "integers only");
  assert.equal(C.normEntry(en("A B", "bp", [120, 80])), null, "bad id");
  assert.equal(C.normEntry(en("a", "bp", [120, 80], { at: -5 })), null, "bad time");
  assert.equal(C.normEntry(en("a", "bp", [120, 80], { m: "x" })), null, "no stamp");
  const n = C.normEntry(en("a", "bp", [120, 80], { n: "a\u0000b <img src=x onerror=alert(1)>", g: ["x", "X", " y ", "", 5, "z".repeat(50)] }));
  assert.equal(n.n, "ab <img src=x onerror=alert(1)>", "control characters removed; text stays text");
  assert.deepEqual(n.g, ["x", "y", "z".repeat(24)], "tags deduped, trimmed, cut");
});

test("kinds: built-in rows, own kinds, targets, reminders", () => {
  assert.equal(C.normType(ty("cabc")), null, "own kind needs a name");
  const own = C.normType(ty("cabc", { n: " Cholesterol ", u: "mg/dL", dc: 9, lo: 300, hi: 100, r: [600, 60, 60, 1440, 5, 7, 9] }));
  assert.equal(own.n, "Cholesterol");
  assert.equal(own.dc, 1, "bad decimals → 1");
  assert.deepEqual([own.lo, own.hi], [100, 300], "swapped target fixed");
  assert.deepEqual(own.r, [5, 7, 60, 600], "reminders: first 4 valid unique times, sorted");
  const bp = C.normType(ty("bp", { n: "ignored", lo2: 60, hi2: 85 }));
  assert.equal(bp.n, "", "built-in has no own name");
  assert.deepEqual([bp.lo2, bp.hi2], [60, 85]);
  assert.equal(C.normType(ty("wt", { lo2: 1 })).lo2, null, "second target only for blood pressure");
  assert.equal(C.normType(ty("xyz", { n: "X" })), null, "unknown non-custom id");
  const d = data({ ty: [own] });
  assert.equal(C.typeRow(d, "bp").r.length, 0, "unedited built-in gets defaults");
  assert.equal(C.typeRow(d, "cnope"), null);
  assert.deepEqual(C.typeList(d).map((x) => x.id), ["bp", "wt", "gl", "sl", "hr", "tp", "o2", "cabc"]);
});

test("merge: symmetric, idempotent, canonical (R5, R26)", () => {
  const A = data({ en: [en("b", "bp", [130, 85]), en("a", "wt", [70000])], ty: [ty("bp", { r: [480] })],
                   set: { m: 5, h: 1700, wu: "kg", gu: "mgdl", tu: "c", nm: "", fw: 1 } });
  const B = data({ en: [en("a", "wt", [71000], { m: 2000 }), en("c", "hr", [60])], tombs: { "en:b": 999 },
                   set: { m: 6, h: 1750, wu: "lb", gu: "mgdl", tu: "c", nm: "X", fw: 0 } });
  const ab = C.merge(A, B), ba = C.merge(B, A);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba), "symmetric");
  assert.equal(JSON.stringify(C.merge(ab, ab)), JSON.stringify(ab), "idempotent");
  assert.equal(JSON.stringify(C.merge(ab, A)), JSON.stringify(ab), "absorbs an older side");
  assert.deepEqual(ab.en.map((e) => e.id), ["a", "b", "c"], "sorted by id");
  assert.deepEqual(ab.en.find((e) => e.id === "a").v, [71000], "newer edit wins");
  assert.ok(ab.en.find((e) => e.id === "b"), "tombstone older than the row loses (999 < 1000)");
  assert.equal(ab.set.wu, "lb", "settings: newer wins");
  const del = C.merge(ab, { tombs: { "en:b": 1000 } });
  assert.ok(!del.en.find((e) => e.id === "b"), "tombstone wins a tie (R17)");
  const back = C.merge(del, { en: [en("b", "bp", [131, 85], { m: 1001 })] });
  assert.ok(back.en.find((e) => e.id === "b"), "a newer edit resurrects");
  const tie1 = C.merge({ en: [en("x", "hr", [60])] }, { en: [en("x", "hr", [61])] });
  const tie2 = C.merge({ en: [en("x", "hr", [61])] }, { en: [en("x", "hr", [60])] });
  assert.equal(JSON.stringify(tie1), JSON.stringify(tie2), "equal stamps: same winner both ways");
});

test("merge: hostile input is dropped, never thrown", () => {
  const out = C.merge({ en: [null, 5, "x", { id: "__proto__", m: 1, t: "bp", at: 1, v: [120, 80] }, en("ok", "o2", [97])],
                        ty: [{ id: "constructor", m: 1 }], tombs: { "en:a": -1, "xx:b": 5, "en:A B": 5, "ty:c1": 3 }, set: "nope" },
                      { en: { length: 3 }, ty: null, tombs: [1, 2] });
  assert.deepEqual(out.en.map((e) => e.id), ["ok"]);
  assert.deepEqual(out.ty, []);
  assert.deepEqual(out.tombs, { "ty:c1": 3 });
  assert.equal(out.set, null);
});

test("ranges: blood pressure (ESC/ESH 2023)", () => {
  const d = data();
  const lv = (s, di) => C.classify(d, en("a", "bp", [s, di]));
  assert.equal(lv(118, 76), "ok");
  assert.equal(lv(132, 80), "bord");
  assert.equal(lv(125, 87), "bord");
  assert.equal(lv(142, 80), "high");
  assert.equal(lv(128, 92), "high");
  assert.equal(lv(182, 100), "vhigh");
  assert.equal(lv(150, 112), "vhigh");
  assert.equal(lv(88, 58), "low");
  const own = data({ ty: [ty("bp", { hi: 135, hi2: 85 })] });
  assert.equal(C.classify(own, en("a", "bp", [134, 84])), "ok", "own target wins over the table");
  assert.equal(C.classify(own, en("a", "bp", [134, 86])), "high");
});

test("ranges: glucose by context, BMI, sleep, others", () => {
  const d = data({ set: { m: 1, h: 1800, wu: "kg", gu: "mgdl", tu: "c", nm: "", fw: 1 } });
  const g = (v, c) => C.classify(d, en("a", "gl", [v], { c }));
  assert.equal(g(650, 1), "low");
  assert.equal(g(950, 1), "ok");
  assert.equal(g(1100, 1), "bord");
  assert.equal(g(1300, 2), "high");
  assert.equal(g(1300, 3), "ok", "2 h after a meal: under 140 is fine");
  assert.equal(g(1500, 3), "bord");
  assert.equal(g(2100, 0), "high");
  const w = (gr) => C.classify(d, en("a", "wt", [gr]));
  assert.equal(w(58000), "low");                 // BMI 17.9
  assert.equal(w(75000), "ok");                  // 23.1
  assert.equal(w(85000), "bord");                // 26.2
  assert.equal(w(100000), "high");               // 30.9
  assert.equal(C.classify(data(), en("a", "wt", [75000])), "", "no height → no level");
  assert.equal(C.classify(d, en("a", "sl", [360])), "low");
  assert.equal(C.classify(d, en("a", "sl", [480])), "ok");
  assert.equal(C.classify(d, en("a", "sl", [600])), "bord");
  assert.equal(C.classify(d, en("a", "hr", [45])), "low");
  assert.equal(C.classify(d, en("a", "hr", [110])), "bord");
  assert.equal(C.classify(d, en("a", "tp", [3690])), "ok");
  assert.equal(C.classify(d, en("a", "tp", [3820])), "high");
  assert.equal(C.classify(d, en("a", "o2", [93])), "bord");
  assert.equal(C.classify(d, en("a", "o2", [90])), "low");
  assert.equal(C.classify(d, en("a", "cq", [5])), "", "own kind without target");
  const own = data({ ty: [ty("cq", { n: "Q", lo: 1000, hi: 2000 })] });
  assert.equal(C.classify(own, en("a", "cq", [2500])), "high");
  assert.equal(C.classify(own, en("a", "cq", [500])), "low");
});

test("units: weight, glucose, temperature round-trip", () => {
  const kg = C.DEF_SET, imp = { m: 1, h: 0, wu: "lb", gu: "mmol", tu: "f", nm: "", fw: 1 };
  assert.equal(C.fromUnit("w", 78.4, kg), 78400);
  assert.equal(C.fromUnit("w", 172.8, imp), Math.round(172.8 * C.G_PER_LB));
  assert.ok(Math.abs(C.toUnit("w", C.fromUnit("w", 172.8, imp), imp) - 172.8) < 0.01);
  assert.equal(C.fromUnit("g", 105, kg), 1050);
  assert.equal(C.fromUnit("g", 5.5, imp), Math.round(5.5 * C.MGDL_PER_MMOL * 10));
  assert.ok(Math.abs(C.toUnit("g", 1800, imp) - 9.99) < 0.01);
  assert.equal(C.fromUnit("t", 98.6, imp), 3700);
  assert.equal(C.toUnit("t", 3700, imp), 98.6);
  assert.ok(isNaN(C.fromUnit("w", NaN, kg)));
  assert.equal(Math.round(C.bmi(80000, 1780) * 10) / 10, 25.2);
  assert.equal(C.bmi(80000, 0), 0);
});

test("statistics: ranges, moving average, BP split, glucose by context, in target", () => {
  const list = [
    en("1", "bp", [140, 90], { at: T0 }),                    // morning
    en("2", "bp", [120, 80], { at: T0 + 12 * H }),           // evening
    en("3", "bp", [130, 84], { at: T0 + D }),                // morning
    en("4", "hr", [60], { at: T0 + 2 * D })
  ];
  assert.deepEqual(C.inRange(list, T0 + 1, T0 + 2 * D).map((e) => e.id), ["2", "3"]);
  assert.deepEqual(C.stats([3, 1, 2]), { n: 3, avg: 2, min: 1, max: 3 });
  assert.equal(C.stats([]), null);
  const sp = C.bpSplit(list);
  assert.deepEqual(sp.am, { n: 2, s: 135, d: 87 });
  assert.deepEqual(sp.pm, { n: 1, s: 120, d: 80 });
  const ma = C.movingAvg([{ x: 0, y: 10 }, { x: D, y: 20 }, { x: 8 * D, y: 30 }], 7);
  assert.deepEqual(ma.map((p) => p.y), [10, 15, 30], "the window drops readings 7 days old or older");
  const gl = C.glucoseByCtx([en("a", "gl", [900], { c: 1 }), en("b", "gl", [1100], { c: 1 }), en("c", "gl", [1600], { c: 3 })]);
  assert.equal(gl[1].avg, 1000);
  assert.equal(gl[3].n, 1);
  assert.equal(C.timeInTarget(data(), list.slice(0, 3)), 1 / 3);
  assert.equal(C.timeInTarget(data(), [en("x", "cq", [1])]), null);
  assert.equal(C.sleepEnd(en("s", "sl", [450], { at: T0 })), T0 + 450 * 60000);
});

test("Workouts weights: read only, tombstones respected, bad rows skipped", () => {
  const raw = { bm: [
    { id: "2026-10-01", m: 10, w: 80000 },
    { id: "2026-10-02", m: 10, w: 0 },             // waist only
    { id: "2026-10-03", m: 10, w: 79000 },          // deleted below
    { id: "bad", m: 10, w: 70000 },
    { id: "2026-10-04", m: 10, w: 9e9 }
  ], tombs: { "bm:2026-10-03": 10 } };
  const out = C.fitnessWeights(raw);
  assert.deepEqual(out.map((w) => [w.d, w.g]), [["2026-10-01", 80000]]);
  assert.equal(new Date(out[0].at).getHours(), 12);
  assert.deepEqual(C.fitnessWeights(null), []);
  assert.deepEqual(C.fitnessWeights({ bm: "x" }), []);
});

test("reminders: due window, done readings, hidden kinds, stable keys", () => {
  const at = (h, m) => new Date(2026, 9, 9, h, m).getTime();
  const d = data({ ty: [C.normType(ty("bp", { r: [480, 1200] })), C.normType(ty("wt", { h: 1, r: [480] }))] });
  assert.deepEqual(C.dueReminders(d, at(7, 59)), [], "not yet");
  const due = C.dueReminders(d, at(8, 5));
  assert.deepEqual(due, [{ t: "bp", min: 480, key: "r-bp-2026-10-09-0800" }], "due, hidden weight silent");
  assert.deepEqual(C.dueReminders(d, at(12, 0)), [], "4-hour window closed");
  d.en = [C.normEntry(en("x", "bp", [120, 80], { at: at(7, 10) }))];
  assert.deepEqual(C.dueReminders(d, at(8, 5)), [], "a reading from up to an hour before counts");
  d.en = [C.normEntry(en("x", "bp", [120, 80], { at: at(6, 50) }))];
  assert.equal(C.dueReminders(d, at(8, 5)).length, 1, "an older reading does not");
  assert.equal(C.dueReminders(d, at(20, 30))[0].key, "r-bp-2026-10-09-2000");
  assert.equal(C.slotKey("cq1", "2026-01-02", 65), "r-cq1-2026-01-02-0105");
});
