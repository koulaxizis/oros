// Pure logic of Micro-Zen: breathing-pattern timing (phase, time left,
// circle scale), whole-breath sessions, days and stats (week, streak,
// across a DST change), the per-device row merge (sync slice "zen").
// Run: node --test tests/
//
// The app is a browser IIFE with no exports, so the constants and
// sections 2–4 are cut out of the source and evaluated on their own.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "zen/zen.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const Z = new Function(
  block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  function cmpStr(", "  // BOOT MARKER") +
  block("  // ---------- 2. Patterns", "  // ---------- 5. Storage") +
  "\nreturn { MINUTES, SMALL, MAX_DAYS, PATTERNS, PATTERN_IDS, cycleMs, sessionBreaths, phaseAt, ease, dayKey, addDays," +
  " dayTotals, streak, stats, normRow, mergeZen, addSession };")();

const DEV = "dev0001", DEV2 = "dev0002";

test("patterns: cycle lengths and phase order", () => {
  assert.equal(Z.cycleMs("box"), 16000);
  assert.equal(Z.cycleMs("relax"), 19000);
  assert.equal(Z.cycleMs("coherent"), 11000);
  Z.PATTERN_IDS.forEach((id) => {
    const ph = Z.PATTERNS[id];
    assert.equal(ph[0].k, "in", id);
    assert.ok(ph.some((p) => p.k === "out"), id);
  });
});

test("phaseAt: phase, time left and scale through a box breath", () => {
  let p = Z.phaseAt("box", 0);
  assert.deepEqual([p.breath, p.k, p.left], [0, "in", 4000]);
  assert.equal(p.scale, Z.SMALL);
  p = Z.phaseAt("box", 2000);
  assert.ok(Math.abs(p.scale - (Z.SMALL + (1 - Z.SMALL) / 2)) < 1e-9);    // halfway up
  p = Z.phaseAt("box", 4000);
  assert.deepEqual([p.k, p.left, p.scale], ["hold", 4000, 1]);            // full hold
  p = Z.phaseAt("box", 9000);
  assert.deepEqual([p.k, p.left], ["out", 3000]);
  p = Z.phaseAt("box", 12500);
  assert.deepEqual([p.k, p.scale], ["hold", Z.SMALL]);                    // empty hold
  p = Z.phaseAt("box", 16000);
  assert.deepEqual([p.breath, p.k], [1, "in"]);
  p = Z.phaseAt("relax", 4000 + 6999);
  assert.deepEqual([p.k, p.left], ["hold", 1]);
  p = Z.phaseAt("coherent", 5500 + 5499);
  assert.equal(p.k, "out");
  assert.equal(Z.phaseAt("box", -50).k, "in");
});

test("phaseAt: the circle never jumps between phases", () => {
  Z.PATTERN_IDS.forEach((id) => {
    let prev = Z.phaseAt(id, 0).scale;
    for (let ms = 10; ms < Z.cycleMs(id) * 2; ms += 10) {
      const s = Z.phaseAt(id, ms).scale;
      assert.ok(s >= Z.SMALL - 1e-9 && s <= 1 + 1e-9);
      assert.ok(Math.abs(s - prev) < 0.01, `${id} at ${ms}: ${prev} → ${s}`);
      prev = s;
    }
  });
});

test("sessions end on a whole breath, near the chosen length", () => {
  Z.PATTERN_IDS.forEach((id) => {
    Z.MINUTES.forEach((m) => {
      const n = Z.sessionBreaths(id, m), ms = n * Z.cycleMs(id);
      assert.ok(n >= 1 && Number.isInteger(n));
      assert.ok(Math.abs(ms - m * 60000) <= Z.cycleMs(id) / 2, `${id} ${m} min → ${ms} ms`);
    });
  });
  assert.equal(Z.sessionBreaths("relax", 1), 3);       // 57 s
  assert.equal(Z.sessionBreaths("coherent", 1), 5);    // 55 s
});

test("days: keys, week totals, streak (alive until midnight, across DST)", () => {
  const today = new Date(2026, 2, 30, 9, 0);          // the Monday after the EU spring change
  assert.equal(Z.dayKey(today), "2026-03-30");
  assert.equal(Z.dayKey(Z.addDays(today, -1)), "2026-03-29");
  assert.equal(Z.dayKey(Z.addDays(today, -2)), "2026-03-28");
  const d = {};
  ["2026-03-26", "2026-03-27", "2026-03-28", "2026-03-29"].forEach((k) => { d[k] = [1, 60, 4]; });
  d["2026-03-20"] = [2, 300, 20];
  let dat = Z.mergeZen({ br: 0, rows: { [DEV]: { b: 0, d } } }, null);
  let st = Z.stats(dat, today);
  assert.equal(st.streak, 4);                          // today not yet: still alive
  assert.equal(st.todaySec, 0);
  assert.equal(st.weekSec, 240);                      // 03-24 … 03-30
  assert.equal(st.sessions, 6);
  assert.deepEqual(st.week.map((w) => w.day), ["2026-03-24", "2026-03-25", "2026-03-26", "2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30"]);
  dat = Z.addSession(dat, DEV2, "2026-03-30", 180, 11);
  st = Z.stats(dat, today);
  assert.equal(st.streak, 5);
  assert.equal(st.todaySec, 180);
  assert.equal(Z.stats(dat, new Date(2026, 3, 1)).streak, 0);   // a missed day breaks it
});

test("addSession only grows this device's row and leaves the input alone", () => {
  const a = Z.mergeZen(null, null);
  const b = Z.addSession(a, DEV, "2026-10-08", 180, 11);
  const c = Z.addSession(b, DEV, "2026-10-08", 60, 4);
  assert.deepEqual(a.rows, {});
  assert.deepEqual(c.rows[DEV].d["2026-10-08"], [2, 240, 15]);
  assert.deepEqual(Z.dayTotals(c)["2026-10-08"], [2, 240, 15]);
});

test("mergeZen: symmetric, associative, idempotent, canonical, inputs untouched", () => {
  const A = { br: 0, rows: { [DEV]: { b: 0, d: { "2026-10-07": [1, 60, 4], "2026-10-08": [2, 120, 8] } } } };
  const B = { br: 0, rows: { [DEV]: { b: 0, d: { "2026-10-08": [3, 200, 12] } }, [DEV2]: { b: 0, d: { "2026-10-08": [1, 55, 5] } } } };
  const C = { br: 0, rows: { dev0003: { b: 0, d: { "2026-10-01": [1, 300, 20] } } } };
  const sa = JSON.stringify(A), sb = JSON.stringify(B);
  const ab = Z.mergeZen(A, B);
  assert.deepEqual(ab, Z.mergeZen(B, A));
  assert.deepEqual(Z.mergeZen(Z.mergeZen(A, B), C), Z.mergeZen(A, Z.mergeZen(B, C)));
  assert.deepEqual(Z.mergeZen(ab, ab), ab);
  assert.equal(JSON.stringify(A), sa);
  assert.equal(JSON.stringify(B), sb);
  assert.deepEqual(ab.rows[DEV].d["2026-10-08"], [3, 200, 12]);            // per counter max
  assert.deepEqual(Object.keys(ab.rows), [DEV, DEV2]);
});

test("mergeZen: a reset drops older rows everywhere, a new epoch wins", () => {
  const old = { br: 0, rows: { [DEV]: { b: 0, d: { "2026-10-08": [5, 900, 60] } } } };
  const reset = { br: 1000, rows: {} };
  const m = Z.mergeZen(old, reset);
  assert.deepEqual(m.rows, {});
  assert.equal(m.br, 1000);
  const after = Z.addSession(m, DEV, "2026-10-08", 60, 4);
  assert.deepEqual(Z.mergeZen(old, after).rows[DEV].d["2026-10-08"], [1, 60, 4]);
});

test("mergeZen: junk drops out, a row keeps its newest 400 days", () => {
  const junk = { br: -5, rows: { "BAD ID": { b: 0, d: { "2026-10-08": [1, 1, 1] } },
    [DEV]: { b: 0, d: { "2026-13": [1, 1, 1], "2026-10-08": [1, -1, 1], "2026-10-09": [1, 2] } } } };
  assert.deepEqual(Z.mergeZen(junk, undefined), { ver: 1, br: 0, rows: {} });
  const d = {};
  let day = new Date(2025, 0, 1);
  for (let i = 0; i < 450; i++) { d[Z.dayKey(day)] = [1, 60, 4]; day = Z.addDays(day, 1); }
  const m = Z.mergeZen({ br: 0, rows: { [DEV]: { b: 0, d } } }, null);
  const keys = Object.keys(m.rows[DEV].d);
  assert.equal(keys.length, Z.MAX_DAYS);
  assert.equal(keys[keys.length - 1], Z.dayKey(Z.addDays(new Date(2025, 0, 1), 449)));
});
