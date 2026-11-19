// Lighthouse Island: the rules engine (lighthouse/engine.js, a module):
// time, day and night, the weather line, prices, the away rule, the
// handover and the sync merge.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../lighthouse/engine.js");

const J = JSON.stringify;
const MIN = 60000, DAY = 86400000;
const T0 = Date.UTC(2026, 10, 19, 12, 0, 0);

function fresh(seed = "test") { return E.newGame(seed, T0, 0); }
// Buy the cheapest thing that can be bought, again and again.
function greedy(s) {
  for (let k = 0; k < 300; k++) {
    const o = E.UPGRADES.map((u) => E.upInfo(s, u.id)).filter((i) => i.ok).sort((a, b) => a.c - b.c);
    if (!o.length) return;
    assert.equal(E.act(s, { t: "up", u: o[0].id }), "");
  }
}

test("lighthouse: a new island is canonical and normalize is idempotent", () => {
  const s = fresh();
  assert.equal(J(E.normalize(s)), J(s));
  assert.equal(J(E.normalize(E.normalize(s))), J(s));
  assert.equal(s.lv.lamp, 0);
  assert.equal(s.lv.boat, 1);
  assert.equal(s.lv.tables, 1);
  assert.equal(s.is, "home");
  assert.equal(E.hourOf(s.hr), 16, "the game starts at 16:00");
  assert.equal(E.dayOf(s.hr), 0);
  assert.equal(E.range(s), 1);
  assert.equal(E.normalize({ v: 2, lv: {} }), null);
  assert.equal(E.normalize("x"), null);
  assert.equal(E.normalize({ v: 1 }), null);
});

test("lighthouse: night is 20:00 to 06:00", () => {
  const s = fresh();
  const night = [];
  for (let h = 0; h < 24; h++) night.push(E.isNight(h - 16 + 24));
  assert.deepEqual(night.map((n, h) => (n ? h : -1)).filter((h) => h >= 0), [0, 1, 2, 3, 4, 5, 20, 21, 22, 23]);
  assert.ok(!E.isNight(s.hr));
});

test("lighthouse: one long step and many small steps give the same island", () => {
  const a = fresh(), b = fresh();
  E.advance(a, 50 * MIN + 12345);
  for (let i = 0; i < 50; i++) E.advance(b, MIN);
  E.advance(b, 12345);
  assert.equal(J(a), J(b));
  assert.equal(a.hr, 50);
  assert.equal(a.ms, 12345);
  assert.equal(a.at, T0 + 50 * MIN + 12345);
});

test("lighthouse: the light earns at night, the boats and the tavern by day, oil is paid", () => {
  const s = fresh();
  const day = E.hourYield(s, 0, "calm", false);          // 16:00
  assert.equal(day.light, false);
  assert.equal(day.ships, 0);
  assert.ok(day.fish > 0, "the boat fishes by day");
  const night = E.hourYield(s, 6, "calm", false);        // 22:00
  assert.equal(night.light, true);
  assert.equal(night.fish, 0, "the boats are home at night");
  assert.ok(night.ships > 0 && night.coins > 0);
  assert.ok(night.oil > 0);
  const out = E.advance(s, 24 * MIN);
  assert.ok(out.coins > 0 && out.ships > 0 && out.fish > 0 && out.oil > 0);
  assert.equal(out.nights, 1);
  assert.ok(s.life > 0 && s.ships > 0);
});

test("lighthouse: fog lights the lamp by day; the defences lift the weather", () => {
  const s = fresh();
  const fogDay = E.hourYield(s, 0, "fog", false);
  assert.equal(fogDay.light, true, "fog lights the lamp by day");
  assert.equal(E.lightF(s, "fog"), 0.4);
  assert.equal(E.lightF(s, "rain"), 0.7);
  assert.equal(E.lightF(s, "storm"), 0.3);
  assert.equal(E.boatF(s, "storm"), 0);
  assert.equal(E.boatF(s, "wind"), 0.6);
  s.lv.horn = 1; s.lv.hood = 1; s.lv.shut = 1; s.lv.brk = 1;
  assert.equal(E.lightF(s, "fog"), 0.8);
  assert.equal(E.lightF(s, "rain"), 1);
  assert.equal(E.lightF(s, "storm"), 0.7);
  assert.equal(E.boatF(s, "storm"), 0.5);
  assert.equal(E.boatF(s, "wind"), 1);
  s.tr = ["weatherwise"];
  assert.ok(Math.abs(E.lightF(s, "fog") - 0.9) < 1e-12);
});

test("lighthouse: with no coins for oil the lamp burns low, and no ship is lost", () => {
  const s = fresh();
  s.coins = 0;
  const full = E.hourYield(s, 6, "calm", false), low = E.hourYield(s, 6, "calm", true);
  assert.ok(low.coins > 0 && low.coins < full.coins);
  s.lv.lamp = 3;
  const r4 = E.hourYield(s, 6, "calm", false), r2 = E.hourYield(s, 6, "calm", true);
  assert.equal(Object.keys(r4.routes).length, 4);
  assert.equal(Object.keys(r2.routes).length, 2, "low = half the reach");
  const t = fresh();
  t.coins = 0; t.lv.boat = 1;
  E.advance(t, 4 * MIN);             // 16:00 → 20:00: the day earns a little first
  t.coins = 0;
  E.advance(t, MIN);                 // 20:00, no coins: burns low
  assert.equal(t.low, 1);
  assert.ok(t.coins > 0, "it still earned");
});

test("lighthouse: the away rule: full for 7 days, then half; a clock going back counts nothing", () => {
  assert.equal(E.effectiveMs(DAY), DAY);
  assert.equal(E.effectiveMs(7 * DAY), 7 * DAY);
  assert.equal(E.effectiveMs(9 * DAY), 8 * DAY);
  assert.equal(E.effectiveMs(-5), 0);
  assert.equal(E.effectiveMs(NaN), 0);
  const s = fresh();
  const back = E.catchUp(s, T0 - 10 * MIN);
  assert.equal(back.hours, 0);
  assert.equal(s.hr, 0);
  assert.equal(s.at, T0 - 10 * MIN, "at moves to the clock now");
  const a = fresh();
  const out = E.catchUp(a, T0 + 9 * DAY);
  assert.equal(out.hours, 8 * 24 * 60);
  assert.ok(out.slowed);
  assert.equal(a.at, T0 + 9 * DAY);
});

test("lighthouse: a month away is worked out quickly", () => {
  const s = fresh();
  greedy(s);
  const t0 = Date.now();
  E.catchUp(s, T0 + 30 * DAY);
  assert.ok(Date.now() - t0 < 3000, "30 days in under 3 s");
  assert.ok(isFinite(s.coins) && s.coins >= 0 && isFinite(s.life));
});

test("lighthouse: weather is seeded, the same on every device, and the forecast follows it", () => {
  const s = fresh("seed-a"), t = fresh("seed-a");
  for (let h = 0; h < 24 * 20; h++) assert.equal(E.weather(s, h), E.weather(t, h));
  const count = {};
  for (let d = 0; d < 2000; d++) count[E.dayWeather("odds", "home", d)] = (count[E.dayWeather("odds", "home", d)] || 0) + 1;
  assert.ok(count.calm > 700 && count.calm < 900, "home: calm about 40% of days");
  const rock = {};
  for (let d = 0; d < 2000; d++) rock[E.dayWeather("odds", "rock", d)] = (rock[E.dayWeather("odds", "rock", d)] || 0) + 1;
  assert.ok(rock.fog > count.fog * 1.6, "the rock is foggier");
  const f = E.forecast(s);
  assert.equal(f.length, 12, "3 days of quarter days");
  assert.equal(f[0].w, E.weather(s));
  f.forEach((x, i) => { assert.equal(x.ah % 6, 0); if (i) assert.equal(x.ah - f[i - 1].ah, 6); });
  s.tr = ["weatherwise"];
  assert.equal(E.forecast(s).length, 20);
});

test("lighthouse: buildings cost coins (and supplies) and refuse what they must", () => {
  const s = fresh();
  s.coins = 0;
  assert.equal(E.act(s, { t: "up", u: "lamp" }), "coins");
  s.coins = 1e6;
  assert.equal(E.act(s, { t: "up", u: "lamp" }), "");
  assert.equal(s.lv.lamp, 1);
  assert.equal(E.act(s, { t: "up", u: "lamp" }), "sup", "the oil lamp → mantle needs supplies");
  assert.equal(E.act(s, { t: "up", u: "rot" }), "need", "rotation needs the mantle");
  assert.equal(E.act(s, { t: "up", u: "ferry" }), "need");
  s.sup = 1e6;
  assert.equal(E.act(s, { t: "up", u: "lamp" }), "");
  assert.equal(E.act(s, { t: "up", u: "rot" }), "");
  assert.equal(E.act(s, { t: "up", u: "rot" }), "max");
  assert.equal(E.act(s, { t: "up", u: "nope" }), "bad");
  assert.equal(E.act(s, null), "bad");
  assert.equal(E.act(s, { t: "x" }), "bad");
  const c0 = E.upInfo(s, "boat").c;
  E.act(s, { t: "up", u: "boat" });
  assert.ok(E.upInfo(s, "boat").c > c0, "the next boat costs more");
  const sup0 = E.upInfo(s, "ware").s;
  E.act(s, { t: "up", u: "shop" });
  assert.ok(Math.abs(E.upInfo(s, "ware").s - sup0 * 0.9) < 1e-9, "the workshop takes 10% off supplies");
  assert.equal(s.acts, 5);
});

test("lighthouse: every route the light reaches adds 5%, and the lamp opens routes in order", () => {
  const s = fresh();
  for (let l = 0; l <= 4; l++) {
    s.lv.lamp = l;
    const y = E.hourYield(s, 6, "calm", false);
    assert.deepEqual(Object.keys(y.routes), E.ROUTES.slice(0, l + 1).map((r) => r.id));
  }
  s.lv.lamp = 0;
  const one = E.hourYield(s, 6, "calm", false).coins;
  assert.ok(Math.abs(one - 3 * 1 * 1.05) < 1e-9, "3 fishing boats × 1 coin × 1.05");
});

test("lighthouse: the merge is symmetric, settles at once, and keeps the island further ahead", () => {
  const a = fresh("m"), b = fresh("m");
  E.advance(a, 300 * MIN);
  E.advance(b, 100 * MIN);
  const ab = E.merge(a, b), ba = E.merge(b, a);
  assert.equal(J(ab), J(ba));
  assert.equal(J(ab), J(E.normalize(a)));
  assert.equal(J(E.merge(ab, ab)), J(ab), "merge(x, x) = x (no endless uploads)");
  assert.equal(J(E.merge(null, a)), J(E.normalize(a)));
  assert.equal(J(E.merge(a, "junk")), J(E.normalize(a)));
  const reset = E.newGame("r", T0 + DAY, T0 + DAY);
  assert.equal(E.merge(a, reset).seed, "r", "a reset (larger br) wins");
});

test("lighthouse: an island in progress can be played for days without numbers going wrong", () => {
  const s = fresh("long");
  for (let i = 0; i < 6 * 24; i++) { greedy(s); E.advance(s, 60 * MIN); }
  assert.equal(J(E.normalize(s)), J(s), "canonical after days of play");
  ["coins", "sup", "fish", "ships", "life"].forEach((k) => assert.ok(isFinite(s[k]) && s[k] >= 0, k));
  assert.ok(s.lv.lamp >= 3, "the lens within 6 days of steady play");
});

test("lighthouse: the handover opens with the lens and enough ships, and starts a new light", () => {
  const s = fresh("h");
  s.lv.lamp = 3; s.ships = E.HANDOVER_SHIPS - 1;
  assert.ok(!E.canHand(s));
  assert.equal(E.act(s, { t: "hand", is: "rock", tr: E.offer(s)[0] }), "nohand");
  s.ships = E.HANDOVER_SHIPS;
  s.lv.lamp = 2;
  assert.ok(!E.canHand(s), "the lens is needed");
  s.lv.lamp = 3; s.coins = 1000; s.lv.boat = 5; s.hr = 24 * 30;
  assert.ok(E.canHand(s));
  const tr = E.offer(s);
  assert.equal(tr.length, 3);
  assert.equal(new Set(tr).size, 3);
  assert.equal(E.act(s, { t: "hand", is: "home", tr: tr[0] }), "bad", "not the same island");
  assert.equal(E.act(s, { t: "hand", is: "rock", tr: "nope" }), "bad");
  assert.equal(E.act(s, { t: "hand", is: "rock", tr: tr[0] }), "");
  assert.equal(s.is, "rock");
  assert.equal(s.hv, 1);
  assert.deepEqual(s.tr, [tr[0]]);
  assert.equal(s.lh.length, 1);
  assert.equal(s.lh[0].is, "home");
  assert.equal(s.lh[0].sh, E.HANDOVER_SHIPS);
  assert.equal(s.lv.lamp, 0);
  assert.equal(s.lv.boat, 1);
  assert.equal(s.coins, 120);
  assert.equal(E.shipsHere(s), 0);
  assert.ok(!E.canHand(s));
  assert.equal(E.handShips(s), E.HANDOVER_SHIPS * 0.9, "the next one needs 10% fewer ships");
  assert.equal(J(E.normalize(s)), J(s), "an island after a handover is canonical");
});

test("lighthouse: the trait offer is seeded and changes with each handover", () => {
  const s = fresh("o"), t = fresh("o");
  assert.deepEqual(E.offer(s), E.offer(t));
  const seen = new Set();
  for (let hv = 0; hv < 20; hv++) { s.hv = hv; E.offer(s).forEach((x) => seen.add(x)); }
  assert.equal(seen.size, E.TRAITS.length, "every trait comes up");
});

test("lighthouse: traits and the sea chart change the rules and add up", () => {
  const s = fresh();
  const oil = E.oilCost(s);
  s.tr = ["thrifty", "thrifty"];
  assert.ok(Math.abs(E.oilCost(s) - oil * 0.64) < 1e-12);
  s.tr = [];
  const base = E.hourYield(s, 6, "calm", false).coins, fishB = E.hourYield(s, 0, "calm", false).fish;
  s.tr = ["owl"];
  assert.ok(Math.abs(E.hourYield(s, 6, "calm", false).coins - base * 1.15) < 1e-9);
  s.tr = ["fisher"];
  assert.ok(Math.abs(E.hourYield(s, 0, "calm", false).fish - fishB * 1.25) < 1e-9);
  s.tr = ["host"];
  assert.ok(Math.abs(E.tavernPrice(s) - 2.4) < 1e-12);
  s.tr = []; s.hv = 10;
  assert.ok(Math.abs(E.hourYield(s, 6, "calm", false).coins - base * 1.2) < 1e-9, "10 lighthouses = +20%");
  s.hv = 99;
  assert.ok(Math.abs(E.chartF(s) - 2) < 1e-12, "the chart counts at most 50");
  assert.equal(E.handShips(s), E.HANDOVER_SHIPS / 2, "never under half");
});

test("lighthouse: normalize keeps the fields sane", () => {
  const s = E.normalize({ v: 1, lv: { lamp: 99, boat: -3, tables: "x", horn: 1 }, hr: 100, coins: -5, ships: 50, s0: 80,
                          d0: 999, is: "atlantis", tr: ["owl", "nope"], lh: [{ is: "rock", d: 0, sh: 5 }, { is: "x" }, null], hv: 0 });
  assert.equal(s.lv.lamp, 4);
  assert.equal(s.lv.boat, 1);
  assert.equal(s.lv.tables, 1);
  assert.equal(s.lv.horn, 1);
  assert.equal(s.coins, 0);
  assert.equal(s.s0, 50, "s0 never above ships");
  assert.equal(s.d0, E.dayOf(100));
  assert.equal(s.is, "home");
  assert.deepEqual(s.tr, ["owl"]);
  assert.deepEqual(s.lh, [{ is: "rock", d: 1, sh: 5 }]);
  assert.equal(s.hv, 1, "hv at least the sea chart");
  assert.equal(J(E.normalize(s)), J(s));
});

test("lighthouse: the keeper's log is seeded and only lists hours the light was on", () => {
  const s = fresh("log");
  E.advance(s, 3 * 24 * MIN);
  const a = E.log(s, 12), b = E.log(E.clone(s), 12);
  assert.equal(J(a), J(b));
  assert.equal(a.length, 12);
  a.forEach((e, i) => {
    assert.ok(E.lightWorks(s, e.hr, e.w));
    assert.ok(e.name >= 0 && e.name < E.SHIP_NAMES);
    assert.ok(E.RT[e.route].r <= E.range(s));
    if (i) assert.ok(e.hr < a[i - 1].hr, "newest first");
  });
  assert.deepEqual(E.log(fresh(), 5), [], "nothing before the first night");
});
