// Star Chart: the rules engine (starchart/engine.js, a module): the
// field, the moon and the clouds, the away rule, the drawing rules,
// shapes and bonuses, prices, the new season and the sync merge.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../starchart/engine.js");

const J = JSON.stringify;
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const T0 = Date.UTC(2026, 10, 20, 8, 0, 0);

function fresh(seed = "test") { return E.newGame(seed, T0, 0); }
function near(a, b, rel = 1e-6) { assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b)), a + " ≈ " + b); }
// A chain of k unused stars, joined nearest first; null when none.
function plan(s, k) {
  const f = E.fieldOf(s), used = E.usedStars(s, -1), others = E.allLines(s, -1);
  for (let st = 0; st < f.length; st++) {
    if (used[st] !== undefined) continue;
    const chain = [st], lines = [];
    while (chain.length < k) {
      const last = chain[chain.length - 1];
      let found = -1, bd = 1e9;
      for (let j = 0; j < f.length; j++) {
        if (used[j] !== undefined || chain.includes(j)) continue;
        if (E.lineErr(s, last, j, others.concat(lines))) continue;
        const d = (f[j].x - f[last].x) ** 2 + (f[j].y - f[last].y) ** 2;
        if (d < bd) { bd = d; found = j; }
      }
      if (found < 0) break;
      lines.push([last, found]); chain.push(found);
    }
    if (chain.length === k) return lines;
  }
  return null;
}
// Stars i, j, k... of a hand-made field: put them on s by seed search
// is not possible, so the shape tests use plain line lists.
function rich(s) { s.sl = 1e12; return s; }
function greedy(s) {
  for (let n = 0; n < 500; n++) {
    const k = 3 + (s.cs.length % 2);
    let l = null;
    for (let kk = k; kk >= 3 && !l; kk--) l = plan(s, kk);
    const opts = E.TELS.map((x) => E.upInfo(s, x.id)).concat(E.UPS.map((u) => E.upInfo(s, u.id))).filter((i) => i.ok).sort((a, b) => a.c - b.c);
    const lc = l ? E.linesCost(s, l.length) : Infinity;
    if (l && s.sl >= lc && (!opts.length || lc <= opts[0].c * 3)) { assert.equal(E.act(s, { t: "draw", l, n: "" }), ""); continue; }
    if (!opts.length) return;
    assert.equal(E.act(s, { t: "buy", u: opts[0].id }), "");
  }
}

test("starchart: a new sky is canonical and normalize is idempotent", () => {
  const s = fresh();
  assert.equal(J(E.normalize(s)), J(s));
  assert.equal(J(E.normalize(E.normalize(s))), J(s));
  assert.equal(s.lv.spy, 1);
  assert.equal(s.lv.refr, 0);
  assert.equal(s.sl, 25);
  assert.equal(s.sn, 0);
  assert.deepEqual(s.cs, []);
  assert.equal(E.reach(s), 3);
  assert.equal(E.normalize({ v: 2, lv: {} }), null);
  assert.equal(E.normalize("x"), null);
  assert.equal(E.normalize({ v: 1 }), null);
});

test("starchart: a field is seeded, 24 stars, none next to another, new each season", () => {
  const f = E.field("abc", 0);
  assert.equal(f.length, E.STARS);
  let full = 0;
  for (let k = 0; k < 200; k++) { const n = E.field("n" + k, 0).length; assert.ok(n >= 21 && n <= E.STARS); if (n === E.STARS) full++; }
  assert.ok(full >= 195, "almost every field has all 24 stars: " + full);
  assert.equal(J(E.field("abc", 0)), J(f));
  assert.notEqual(J(E.field("abc", 1)), J(f));
  assert.notEqual(J(E.field("abd", 0)), J(f));
  for (let i = 0; i < f.length; i++) {
    assert.ok(f[i].x >= 0 && f[i].x < E.GW && f[i].y >= 0 && f[i].y < E.GH);
    assert.ok([1, 2, 3].includes(f[i].b));
    assert.ok(E.KINDS.includes(f[i].k));
    for (let j = 0; j < i; j++) {
      const dx = f[i].x - f[j].x, dy = f[i].y - f[j].y;
      assert.ok(dx * dx + dy * dy >= 3, "no neighbours");
      assert.ok(f[j].y < f[i].y || (f[j].y === f[i].y && f[j].x < f[i].x), "reading order");
    }
  }
  // every kind turns up over a few fields
  const kinds = new Set();
  for (let k = 0; k < 5; k++) E.field("abc", k).forEach((st) => kinds.add(st.k));
  assert.equal(kinds.size, 4);
});

test("starchart: every field leaves room for six constellations of three", () => {
  for (let k = 0; k < 40; k++) {
    const s = rich(E.newGame("f" + k, T0, 0));
    for (let n = 0; n < E.SEASON_N; n++) {
      const l = plan(s, 3);
      assert.ok(l, "seed f" + k + ": constellation " + (n + 1));
      assert.equal(E.act(s, { t: "draw", l, n: "" }), "");
    }
  }
});

test("starchart: the moon is the real moon; new moon ×1.2, full moon ×0.8, the moon-watcher halves the loss", () => {
  near(E.moonPhase(E.NEW_MOON), 0);
  near(E.moonPhase(E.NEW_MOON + E.SYNODIC / 2), 0.5);
  { const q = E.moonPhase(E.NEW_MOON + 10 * E.SYNODIC); assert.ok(Math.min(q, 1 - q) < 1e-9); }
  // the full moon of 2026-11-24 (about 14:53 UTC)
  const p = E.moonPhase(Date.UTC(2026, 10, 24, 15, 0));
  assert.ok(Math.abs(p - 0.5) < 0.02, "full moon on 24 November 2026: " + p);
  const s = fresh();
  near(E.moonF(s, E.NEW_MOON), 1.2);
  near(E.moonF(s, E.NEW_MOON + E.SYNODIC / 2), 0.8);
  s.tr = ["moon"];
  near(E.moonF(s, E.NEW_MOON + E.SYNODIC / 2), 0.9);
  near(E.moonF(s, E.NEW_MOON), 1.2);
  s.tr = ["moon", "moon"];
  near(E.moonF(s, E.NEW_MOON + E.SYNODIC / 2), 0.95);
});

test("starchart: clouds are seeded per 3-hour block; the forecast lists the next hours", () => {
  const t = Date.UTC(2026, 10, 20, 9, 0);
  assert.equal(E.skyAt("x", t), E.skyAt("x", t + 2 * HOUR + 59 * MIN));
  const seen = new Set();
  for (let k = 0; k < 200; k++) seen.add(E.skyAt("x", t + k * 3 * HOUR));
  assert.deepEqual([...seen].sort(), ["clear", "cloud", "haze"]);
  const s = fresh("x");
  const fc = E.forecast(s, t + 20 * MIN, 8);
  assert.equal(fc.length, 8);
  assert.equal(fc[0].t, t);
  assert.equal(fc[7].t, t + 7 * HOUR);
  fc.forEach((f) => { assert.equal(f.sky, E.skyAt("x", f.t)); assert.ok(f.moon >= 0 && f.moon < 1); });
});

test("starchart: starlight comes in every minute, by the sky and the moon; long and short steps agree", () => {
  const a = fresh(), b = fresh();
  E.advance(a, 5 * HOUR + 12345);
  for (let i = 0; i < 5 * 60; i++) E.advance(b, MIN);
  E.advance(b, 12345);
  assert.equal(a.at, T0 + 5 * HOUR + 12345);
  assert.equal(a.at, b.at);
  near(a.sl, b.sl, 1e-5);
  near(a.life, b.life, 1e-5);
  assert.ok(a.sl > 25);
  // one spyglass: 1 a minute × sky × moon, never more than 1.2 a minute
  const g = a.sl - 25, mins = (5 * HOUR + 12345) / MIN;
  assert.ok(g > 0.4 * 0.8 * mins && g < 1.2 * mins);
  // an hour of clear sky at the new moon gives the base rate × 1.2 (about)
  const s = fresh("clear");
  let t = E.NEW_MOON;
  while (E.skyAt(s.seed, t) !== "clear") t += 3 * HOUR;
  s.at = Math.floor(t / (3 * HOUR)) * 3 * HOUR;
  E.advance(s, HOUR);
  near(s.sl - 25, 60 * E.moonF(s, s.at - HOUR / 2), 1e-9);
});

test("starchart: away, the first 7 days count in full, the rest at half; a clock that went back counts nothing", () => {
  const s = fresh();
  const a = E.clone(s);
  E.advance(a, 7 * DAY);
  const g7 = a.sl - s.sl;
  const b = E.clone(a);
  E.advance(b, 3 * DAY);
  const g3 = b.sl - a.sl;
  const c = E.clone(s);
  const out = E.catchUp(c, T0 + 10 * DAY);
  near(c.sl - s.sl, g7 + g3 / 2, 1e-6);
  near(out.sl, g7 + g3 / 2, 1e-6);
  assert.equal(out.slowed, true);
  assert.equal(c.at, T0 + 10 * DAY);
  assert.ok(out.moons === 0 || out.moons === 1);
  // a clock that went back
  const d = E.clone(c), before = J(d);
  const o2 = E.catchUp(d, T0 + 5 * DAY);
  assert.equal(o2.sl, 0);
  assert.equal(d.at, T0 + 5 * DAY);
  assert.equal(d.sl, c.sl);
  assert.notEqual(J(d), before);
  // at most 400 days are worked out
  const e = fresh();
  const o3 = E.catchUp(e, T0 + 900 * DAY);
  assert.equal(e.at, T0 + 900 * DAY);
  assert.ok(o3.sl < 1.2 * (7 * 1440 + 393 * 720) + 1);
  assert.ok(o3.moons >= 30);
});

test("starchart: lines: reach, never through a star, never crossing, no repeats", () => {
  const s = rich(fresh("lines"));
  const f = E.fieldOf(s);
  // find a pair too far apart and a pair in reach
  let far = null, ok = null;
  for (let i = 0; i < f.length && (!far || !ok); i++) {
    for (let j = i + 1; j < f.length; j++) {
      const d = (f[i].x - f[j].x) ** 2 + (f[i].y - f[j].y) ** 2;
      if (!far && d > 9) far = [i, j];
      if (!ok && d <= 9 && !E.lineErr(s, i, j, [])) ok = [i, j];
    }
  }
  assert.equal(E.lineErr(s, far[0], far[1], []), "far");
  assert.equal(E.lineErr(s, ok[0], ok[1], []), "");
  assert.equal(E.lineErr(s, ok[0], ok[1], [ok]), "dup");
  assert.equal(E.lineErr(s, ok[1], ok[0], [ok]), "dup");
  assert.equal(E.lineErr(s, 3, 3, []), "bad");
  assert.equal(E.lineErr(s, 0, 99, []), "bad");
  // the star compass reaches farther
  s.lv.comp = 2;
  assert.equal(E.reach(s), 5);
  s.lv.comp = 0;
  // crossing (the compass makes lines long enough to cross)
  s.lv.comp = 2;
  let found = false;
  for (let a = 0; a < f.length && !found; a++) for (let b = a + 1; b < f.length && !found; b++) {
    if (E.lineErr(s, a, b, [])) continue;
    for (let c = 0; c < f.length && !found; c++) for (let d = c + 1; d < f.length && !found; d++) {
      if ([a, b].includes(c) || [a, b].includes(d) || E.lineErr(s, c, d, [])) continue;
      if (E.lineErr(s, c, d, [[a, b]]) === "cross") {
        found = true;
        assert.equal(E.lineErr(s, a, b, [[c, d]]), "cross", "crossing is symmetric");
      }
    }
  }
  assert.ok(found, "some lines cross");
});

test("starchart: a line never passes through a third star", () => {
  // a seed whose field has three stars in a row within reach
  for (let k = 0; k < 200; k++) {
    const s = fresh("row" + k), f = E.fieldOf(s);
    s.lv.comp = 2;
    for (let i = 0; i < f.length; i++) for (let j = 0; j < f.length; j++) {
      if (i === j) continue;
      const dx = f[j].x - f[i].x, dy = f[j].y - f[i].y;
      const m = f.findIndex((c) => c.x === f[i].x + 2 * dx && c.y === f[i].y + 2 * dy);
      if (m >= 0 && 4 * (dx * dx + dy * dy) <= 25) {
        assert.equal(E.lineErr(s, i, m, []), "through");
        return;
      }
    }
  }
  assert.fail("no three stars in a row found");
});

test("starchart: shapes: chain, branch, loop, both; one piece, at most one ring", () => {
  assert.equal(E.shapeOf([[0, 1], [1, 2]]), "chain");
  assert.equal(E.shapeOf([[0, 1], [1, 2], [0, 2]]), "chain", "a triangle counts as a chain");
  assert.equal(E.shapeOf([[0, 1], [0, 2], [0, 3]]), "branch");
  assert.equal(E.shapeOf([[0, 1], [1, 2], [2, 3], [0, 3]]), "loop");
  assert.equal(E.shapeOf([[0, 1], [1, 2], [2, 3], [0, 3], [3, 4]]), "both");
  assert.equal(E.shapeOf([[0, 1], [2, 3]]), null, "two pieces");
  assert.equal(E.shapeOf([[0, 1], [1, 2], [0, 2], [2, 3], [3, 4], [2, 4]]), null, "two rings");
  assert.equal(E.shapeOf([]), null);
});

test("starchart: a constellation's worth: brightness by kind × shape, one kind ×1.2, the cartographer", () => {
  const s = rich(fresh("worth"));
  const l = plan(s, 4);
  const f = E.fieldOf(s), st = E.starsOfLines(l);
  const w = E.worth(s, l);
  assert.equal(w.shape, "chain");
  assert.equal(w.n, 4);
  const sum = { blue: 0, gold: 0, red: 0, white: 0 }, kinds = new Set();
  st.forEach((i) => { sum[f[i].k] += f[i].b; kinds.add(f[i].k); });
  const m = kinds.size === 1 ? 1.2 : 1;
  near(w.blue, sum.blue * m); near(w.gold, sum.gold * m); near(w.red, sum.red * m); near(w.white, sum.white * m);
  s.tr = ["carto"];
  near(E.worth(s, l).m, 1.25 * m);
});

test("starchart: naming a constellation: price, the rules, erase and rename", () => {
  const s = fresh("draw");
  const l = plan(s, 3);
  const c = E.linesCost(s, 2);
  near(c, 10 + 12.5);
  assert.equal(E.act(s, { t: "draw", l, n: "" }), "", "the starting starlight pays for the first one");
  near(s.sl, 25 - c);
  assert.equal(s.cs.length, 1);
  assert.equal(s.cs[0].n, "");
  assert.ok(s.cs[0].k >= 0 && s.cs[0].k < E.NAMES);
  assert.equal(E.act(s, { t: "draw", l, n: "" }), "used");
  rich(s);
  assert.equal(E.act(s, { t: "draw", l: [[l[0][0], l[0][1]]], n: "" }), "few");
  const l2 = plan(s, 2) || [];
  assert.equal(E.act(s, { t: "draw", l: l2.slice(0, 1), n: "" }), "few");
  assert.equal(E.act(s, { t: "draw", l: "x" }), "bad");
  assert.equal(E.act(s, { t: "draw", l: [[0, 0]] }), "bad");
  // the next lines cost more: 2 lines drawn
  near(E.linesCost(s, 1), 10 * 1.25 ** 2 * Math.max(0.25, 1 - 0.03 * E.totals(s).red));
  // rename: control characters go, at most 24 characters, shown as text
  assert.equal(E.act(s, { t: "rename", c: 0, n: "  The\u0000 <b>Kite</b>\n  " }), "");
  assert.equal(s.cs[0].n, "The <b>Kite</b>");
  assert.equal(E.act(s, { t: "rename", c: 0, n: "x".repeat(40) }), "");
  assert.equal(s.cs[0].n.length, 24);
  assert.equal(E.act(s, { t: "rename", c: 5, n: "y" }), "bad");
  // erase: no refund
  const before = s.sl;
  assert.equal(E.act(s, { t: "erase", c: 0 }), "");
  assert.equal(s.cs.length, 0);
  assert.equal(s.sl, before);
  assert.equal(E.act(s, { t: "erase", c: 0 }), "bad");
  // too many stars
  const big = plan(s, 8);
  if (big) {
    const f = E.fieldOf(s), used = new Set(E.starsOfLines(big));
    const last = big[big.length - 1][1];
    const extra = f.findIndex((_, j) => !used.has(j) && !E.lineErr(s, last, j, big));
    if (extra >= 0) assert.equal(E.act(s, { t: "draw", l: big.concat([[last, extra]]), n: "" }), "many");
  }
});

test("starchart: blue stars lift the telescopes, gold makes them cheaper, red makes lines cheaper (with floors)", () => {
  const s = fresh();
  const base = E.baseRate(s), tc = E.telCost(s, "spy"), lc = E.linesCost(s, 1);
  const tot = { blue: 10, gold: 10, red: 10, white: 0 };
  near(E.baseRate(s, tot), base * 1.3);
  near(E.telCost(s, "spy", tot), tc * 0.8);
  near(E.linesCost(s, 1, tot), lc * 0.7);
  const huge = { blue: 0, gold: 1000, red: 1000, white: 0 };
  near(E.telCost(s, "spy", huge), tc * 0.4);
  near(E.linesCost(s, 1, huge), lc * 0.25);
  s.tr = ["grinder", "steady"];
  near(E.telCost(s, "spy"), tc * 0.9);
  near(E.linesCost(s, 1), lc * 0.85);
});

test("starchart: telescopes and upgrades: prices, mirrors need their telescope, dark sky and mirrors lift the rate", () => {
  const s = rich(fresh());
  near(E.upInfo(s, "spy").c, 10 * 1.22);
  assert.equal(E.act(s, { t: "buy", u: "spy" }), "");
  assert.equal(s.lv.spy, 2);
  near(E.baseRate(s), 2);
  assert.equal(E.act(s, { t: "buy", u: "mrefr" }), "need");
  assert.equal(E.act(s, { t: "buy", u: "mspy" }), "");
  near(E.baseRate(s), 4);
  assert.equal(E.act(s, { t: "buy", u: "mspy" }), "max");
  assert.equal(E.act(s, { t: "buy", u: "dark" }), "");
  near(E.baseRate(s), 5);
  assert.equal(E.act(s, { t: "buy", u: "nope" }), "bad");
  const p = fresh();
  assert.equal(E.act(p, { t: "buy", u: "refr" }), "sl");
  assert.equal(E.upInfo(p, "comp").c, 2000);
  assert.equal(E.upInfo(p, "dark").c, 400);
});

test("starchart: a new season needs six constellations and a radio dish; it fills the atlas", () => {
  const s = rich(fresh("season"));
  for (let n = 0; n < 6; n++) assert.equal(E.act(s, { t: "draw", l: plan(s, 3 + (n % 2)), n: n ? "" : "Mine" }), "");
  assert.equal(E.canSeason(s), false);
  assert.equal(E.act(s, { t: "season", tr: E.offer(s)[0] }), "noseason");
  assert.equal(E.act(s, { t: "buy", u: "dish" }), "");
  assert.equal(E.canSeason(s), true);
  const off = E.offer(s);
  assert.equal(off.length, 3);
  assert.equal(new Set(off).size, 3);
  assert.equal(J(E.offer(s)), J(off), "seeded");
  assert.equal(E.act(s, { t: "season", tr: "nope" }), "bad");
  const whites = s.cs.map((c) => E.worth(s, c.l).white);
  const oldField = J(E.fieldOf(s));
  s.sl = 1000;
  const tr = off.includes("early") ? "early" : off[0];
  assert.equal(E.act(s, { t: "season", tr }), "");
  assert.equal(s.sn, 1);
  assert.deepEqual(s.tr, [tr]);
  assert.equal(s.cs.length, 0);
  assert.equal(s.ax.length, 6);
  assert.equal(s.ax[0].n, "Mine");
  s.ax.forEach((a, i) => near(a.b, 0.01 + 0.005 * whites[i]));
  near(E.atlasBonus(s), s.ax.reduce((x, a) => x + a.b, 0));
  near(s.sl, 20 + 100);
  assert.equal(s.lv.spy, 1);
  assert.equal(s.lv.dish, 0);
  assert.equal(s.lv.refr, tr === "early" ? 2 : 0);
  assert.notEqual(J(E.fieldOf(s)), oldField, "a new star field");
  assert.ok(E.bit(s, "season"));
  // the atlas lifts everything
  near(E.baseRate(s), (1 + 8 * s.lv.refr) * (1 + E.atlasBonus(s)));
  // the atlas keeps the shape small: points on the grid, lines by index
  s.ax.forEach((a) => {
    assert.ok(a.p.length >= 6 && a.p.length % 2 === 0);
    a.l.forEach((i) => assert.ok(i >= 0 && i < a.p.length / 2));
  });
});

test("starchart: normalize drops broken constellations, clamps numbers and keeps the atlas small", () => {
  const s = rich(fresh("norm"));
  const l = plan(s, 3);
  assert.equal(E.act(s, { t: "draw", l, n: "A" }), "");
  const x = E.clone(s);
  x.cs.push({ s: [], l: l, n: "same stars", k: 3 });
  x.cs.push({ l: [[0, 1], [1, 2]], n: 5, k: 99 });
  x.cs.push("junk");
  x.sl = -5; x.life = "a"; x.lv.spy = 0; x.lv.dark = 99; x.tr = ["keen", "nope"]; x.mi = -1;
  const n = E.normalize(x);
  assert.equal(n.cs[0].n, "A");
  assert.ok(n.cs.every((c) => c.n !== "same stars"));
  assert.equal(n.sl, 0); assert.equal(n.life, 0); assert.equal(n.lv.spy, 1); assert.equal(n.lv.dark, 4);
  assert.deepEqual(n.tr, ["keen"]);
  assert.equal(n.mi, 0);
  assert.equal(J(E.normalize(n)), J(n));
  // the atlas: bad entries go, more than AX_MAX keep their bonus in ab0
  const y = E.clone(fresh());
  for (let i = 0; i < E.AX_MAX + 5; i++) y.ax.push({ n: "", k: 1, p: [0, 0, 2, 0, 4, 0], l: [0, 1, 1, 2], b: 0.01 });
  y.ax.push({ n: "", k: 1, p: [0, 0, 99, 0, 4, 0], l: [0, 1], b: 0.01 });
  y.ax.push({ n: "", k: 1, p: [0, 0, 2, 0, 4, 0], l: [0, 7], b: 0.01 });
  const m = E.normalize(y);
  assert.equal(m.ax.length, E.AX_MAX);
  near(m.ab0, 0.05);
  near(E.atlasBonus(m), 1.25);
});

test("starchart: merge is symmetric: the reset stamp, then the further-ahead sky", () => {
  const a = fresh("m"), b = fresh("m");
  E.advance(a, 3 * HOUR);
  assert.equal(J(E.merge(a, b)), J(E.normalize(a)));
  assert.equal(J(E.merge(b, a)), J(E.normalize(a)));
  const c = E.newGame("other", T0 + HOUR, T0 + HOUR);
  assert.equal(J(E.merge(a, c)), J(c), "a reset wins");
  assert.equal(J(E.merge(c, a)), J(c));
  assert.equal(J(E.merge(a, a)), J(E.normalize(a)));
  assert.equal(J(E.merge(null, a)), J(E.normalize(a)));
  assert.equal(J(E.merge(a, "junk")), J(E.normalize(a)));
  const d = E.clone(a); d.at += 1;
  assert.equal(J(E.merge(a, d)), J(d), "same life: the later one");
});

test("starchart: milestones", () => {
  const s = rich(fresh("miles"));
  assert.equal(s.mi, 0);
  assert.equal(E.act(s, { t: "draw", l: plan(s, 3), n: "" }), "");
  assert.ok(E.bit(s, "first"));
  s.life = 2e6;
  E.advance(s, MIN);
  assert.ok(E.bit(s, "million"));
  assert.ok(!E.bit(s, "season"));
});

test("starchart: balance: the first season after 3-7 days for a player who visits four times a day", () => {
  for (const seed of ["a", "b", "c"]) {
    const s = E.newGame(seed, T0, 0);
    let day = -1;
    for (let d = 0; d < 12 && day < 0; d++) {
      for (const h of [8, 12, 18, 22]) {
        const t = Date.UTC(2026, 10, 20 + d, h);
        E.catchUp(s, t);
        greedy(s);
        if (E.canSeason(s)) { day = (t - T0) / DAY; break; }
      }
    }
    assert.ok(day >= 3 && day <= 7, seed + ": first season after " + day + " days");
  }
});
