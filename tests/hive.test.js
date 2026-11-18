// Hive: the rules engine (hive/engine.js, a module): time, foraging,
// winter, prices, the away rule and the sync merge.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../hive/engine.js");

const J = JSON.stringify;
const MIN = 60000, DAY = 86400000;
const T0 = Date.UTC(2026, 10, 18, 12, 0, 0);

function fresh(seed = "test") { return E.newGame(seed, T0, 0); }

test("hive: a new hive is canonical and normalize is idempotent", () => {
  const s = fresh();
  assert.equal(J(E.normalize(s)), J(s));
  assert.equal(J(E.normalize(E.normalize(s))), J(s));
  assert.equal(s.slots.length, 18);
  assert.equal(E.slotsOpen(s), 6);
  assert.equal(s.slots[0].f, "wild");
  assert.ok(E.established(s, s.slots[0]), "the starting meadow is in flower from the start");
  assert.equal(E.monthOf(s.min), 2, "the game starts in March");
  assert.equal(E.yearOf(s.min), 0);
  assert.equal(E.normalize({ v: 2, slots: [] }), null);
  assert.equal(E.normalize("x"), null);
});

test("hive: the hillside is two rings of hex cells around the hive", () => {
  assert.equal(E.SLOTS.filter((s) => s.ring === 1).length, 6);
  assert.equal(E.SLOTS.filter((s) => s.ring === 2).length, 12);
  const keys = new Set(E.SLOTS.map((s) => s.q + "," + s.r));
  assert.equal(keys.size, 18);
  E.SLOTS.forEach((s) => {
    const d = (Math.abs(s.q) + Math.abs(s.r) + Math.abs(-s.q - s.r)) / 2;
    assert.equal(d, s.ring);
  });
});

test("hive: one long step and many small steps give the same hive", () => {
  const a = fresh(), b = fresh();
  E.advance(a, 3 * 60 * MIN + 12345);
  for (let i = 0; i < 180; i++) E.advance(b, MIN);
  E.advance(b, 12345);
  assert.equal(J(a), J(b));
  assert.equal(a.min, 180);
  assert.equal(a.ms, 12345);
  assert.equal(a.at, T0 + 3 * 60 * MIN + 12345);
});

test("hive: bees make honey from patches in bloom, wax with it, and the queen lays", () => {
  const s = fresh();
  E.advance(s, 31 * MIN);   // into April: wildflowers in bloom
  assert.ok(s.life > 0 && s.honey > 0 && s.wax > 0);
  assert.ok(s.bees > 500, "the queen laid");
  assert.ok(s.bees <= E.capacity(s));
  assert.ok(s.kinds.wild > 0);
  const r = E.rates(s);
  assert.ok(r.honey > 0 && r.fed > 0 && r.fed <= E.PATCH_BEES);
});

test("hive: the away rule: full for 7 days, then half; a clock going back counts nothing", () => {
  assert.equal(E.effectiveMs(-5), 0);
  assert.equal(E.effectiveMs(NaN), 0);
  assert.equal(E.effectiveMs(3 * DAY), 3 * DAY);
  assert.equal(E.effectiveMs(7 * DAY), 7 * DAY);
  assert.equal(E.effectiveMs(9 * DAY), 8 * DAY);
  const s = fresh();
  const out = E.catchUp(s, T0 - 5 * MIN);
  assert.equal(out.minutes, 0);
  assert.equal(s.min, 0);
  assert.equal(s.at, T0 - 5 * MIN, "at follows the clock back, nothing is taken away");
  const s2 = fresh();
  const o2 = E.catchUp(s2, T0 + 9 * DAY);
  assert.equal(o2.slowed, true);
  assert.equal(s2.min, 8 * 1440);
  assert.equal(s2.at, T0 + 9 * DAY);
});

test("hive: a month away is worked out quickly", () => {
  const s = fresh();
  const t = Date.now();
  E.catchUp(s, T0 + 30 * DAY);
  assert.ok(Date.now() - t < 3000, "30 days away in under 3 s");
  assert.ok(s.life > 0);
  assert.ok(E.yearOf(s.min) >= 50);
});

test("hive: winter eats the stores; running out clusters the bees and loses none", () => {
  const s = fresh();
  s.min = 9 * 30;            // December (March + 9 months)
  s.yk = E.yearOf(s.min);
  assert.equal(E.monthOf(s.min), 11);
  assert.ok(E.isWinter(11) && E.isWinter(0) && !E.isWinter(1));
  s.honey = 5;
  const bees = s.bees;
  const out = E.advance(s, 30 * MIN);
  assert.equal(s.honey, 0);
  assert.equal(s.cl, 1);
  assert.equal(out.clustered, 1);
  assert.equal(s.bees, bees, "no bee is lost");
  assert.ok(E.winterNeed(s) > 0);
  // the windbreak lowers what winter eats
  const w = E.winterNeed(s);
  s.lv.wind = 2;
  assert.ok(Math.abs(E.winterNeed(s) - w * 0.7) < 1e-9);
});

test("hive: planting, tending and improvements cost honey (and wax) and refuse what they must", () => {
  const s = fresh();
  s.honey = 1000; s.wax = 100;
  assert.equal(E.act(s, { t: "plant", slot: 6, f: "thyme" }), "locked", "ring 2 waits for the terraces");
  assert.equal(E.act(s, { t: "plant", slot: 0, f: "wild" }), "same");
  assert.equal(E.act(s, { t: "plant", slot: 1, f: "nope" }), "bad");
  assert.equal(E.act(s, { t: "plant", slot: 1.5, f: "wild" }), "bad");
  const c = E.plantCost(s, "wild");
  assert.ok(Math.abs(c - 15 * 1.15) < 1e-9, "the second patch of a flower costs 15% more");
  assert.equal(E.act(s, { t: "plant", slot: 1, f: "wild" }), "");
  assert.ok(Math.abs(s.honey - (1000 - c)) < 1e-9);
  assert.deepEqual(s.slots[1], { f: "wild", p: 0, l: 0 });
  assert.ok(!E.established(s, s.slots[1]));
  const ti = E.tendInfo(s, 1);
  assert.equal(E.act(s, { t: "tend", slot: 1 }), "");
  assert.equal(s.slots[1].l, 1);
  assert.ok(ti.h > 0);
  assert.equal(E.act(s, { t: "tend", slot: 2 }), "bad", "an empty patch cannot be tended");
  const f = E.upInfo(s, "frame");
  assert.equal(E.act(s, { t: "up", u: "frame" }), "");
  assert.equal(s.frames, 3);
  assert.ok(f.w > 0);
  assert.equal(E.act(s, { t: "up", u: "trough" }), "");
  assert.equal(E.act(s, { t: "up", u: "trough" }), "max");
  s.honey = 0;
  assert.equal(E.act(s, { t: "up", u: "ent" }), "honey");
  s.honey = 1e6; s.wax = 0;
  assert.equal(E.act(s, { t: "up", u: "terr" }), "wax");
  s.wax = 1e6;
  assert.equal(E.act(s, { t: "up", u: "terr" }), "");
  assert.equal(E.slotsOpen(s), 18);
  assert.equal(E.act(s, { t: "plant", slot: 6, f: "thyme" }), "");
  assert.equal(s.acts, 6);
  // frames stop at 10 per box
  s.frames = 10;
  assert.equal(E.upInfo(s, "frame").done, true);
  E.act(s, { t: "up", u: "box" });
  assert.equal(s.lv.box, 2);
  assert.equal(E.upInfo(s, "frame").done, false);
  assert.equal(J(E.normalize(s)), J(E.normalize(E.normalize(s))));
});

test("hive: every honey kind of the year adds 5%, and the kinds start again each January", () => {
  const s = fresh();
  assert.equal(E.varietyF(s), 1);
  s.kinds = { wild: 1, thyme: 2 };
  assert.ok(Math.abs(E.varietyF(s) - 1.1) < 1e-9);
  s.min = 10 * 30 - 1;       // the last minute of December, year 1
  s.yk = E.yearOf(s.min);
  E.advance(s, 2 * MIN);
  assert.equal(E.monthOf(s.min), 0);
  assert.deepEqual(s.kinds, {}, "a new year, no kinds yet");
});

test("hive: weather is seeded, the same on every device, and winter is always fair", () => {
  const a = [], b = [];
  for (let y = 0; y < 30; y++) for (let m = 0; m < 12; m++) { a.push(E.weather("abc", y, m)); b.push(E.weather("abc", y, m)); }
  assert.deepEqual(a, b);
  assert.ok(a.includes("rain") && a.includes("heat"));
  for (let y = 0; y < 30; y++) { assert.equal(E.weather("abc", y, 11), "fair"); assert.equal(E.weather("abc", y, 0), "fair"); }
  for (let y = 0; y < 30; y++) for (const m of [1, 2, 3, 4, 8, 9, 10]) assert.notEqual(E.weather("abc", y, m), "heat");
});

test("hive: the merge is symmetric, settles at once, and keeps the hive further ahead", () => {
  const a = fresh("a"), b = fresh("b");
  E.advance(a, 60 * MIN);
  E.advance(b, 30 * MIN);
  assert.equal(J(E.merge(a, b)), J(E.merge(b, a)));
  assert.equal(J(E.merge(a, a)), J(E.normalize(a)));
  assert.equal(E.merge(a, b).seed, "a", "the larger life wins");
  // a reset (newer br) beats any progress
  const r = E.newGame("r", T0 + DAY, T0 + DAY);
  assert.equal(E.merge(a, r).seed, "r");
  assert.equal(E.merge(r, a).seed, "r");
  // nothing on one side
  assert.equal(J(E.merge(null, a)), J(E.normalize(a)));
  assert.equal(J(E.merge(a, { junk: 1 })), J(E.normalize(a)));
  assert.equal(E.merge(null, null), null);
  // equal life and at: the larger JSON, either way round
  const c = E.clone(a), d = E.clone(a);
  d.wax += 1;
  assert.equal(J(E.merge(c, d)), J(E.merge(d, c)));
});

test("hive: a hive in progress can be played for days without numbers going wrong", () => {
  const s = fresh("long");
  s.honey = 1e9; s.wax = 1e9;
  E.act(s, { t: "up", u: "terr" });
  for (let i = 0; i < 18; i++) E.act(s, { t: "plant", slot: i, f: E.FLOWERS[i % 7].id });
  for (let k = 0; k < 30; k++) E.act(s, { t: "up", u: k % 2 ? "frame" : "box" });
  E.catchUp(s, T0 + 12 * DAY);
  const n = E.normalize(s);
  ["honey", "wax", "bees", "life", "min"].forEach((k) => assert.ok(Number.isFinite(n[k]) && n[k] >= 0, k));
  assert.ok(n.bees <= E.capacity(n));
  assert.equal(J(E.normalize(n)), J(n));
});
