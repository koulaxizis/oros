// Orbit garden: the rules engine (orbit/engine.js, a module): the
// gardens, the spiral way and the ring turns, plants and targets,
// sparks, waves, the session copy and the sync merge.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../orbit/engine.js");

const J = JSON.stringify;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// A plain player: the harm a plant would do along the next wave's way.
function dps(st, k) {
  if (k === "thorn") return st.d * 60 / st.cd;
  if (k === "sun") return st.d * 60 / st.cd * 1.5;
  if (k === "dew") return (st.d ? st.d * 60 / st.cd : 0) + 6 * st.sl;
  return st.hold / st.cd * 30 * st.n + st.d * 60 / st.cd;
}
function score(g) {
  let s = 0;
  E.nextGates(g).forEach((gi) => {
    const pts = E.wayPoints(g, gi);
    Object.keys(g.pl).forEach((k) => {
      const p = g.pl[k], st = E.stats(p), at = E.slotPos(g, k);
      let n = 0;
      pts.forEach((q) => { if ((q.x - at.x) ** 2 + (q.y - at.y) ** 2 <= st.r * st.r) n++; });
      s += n * 0.25 * dps(st, p.k);
    });
  });
  return s;
}
function shortest(g) { const w = E.ways(g); return Math.min(...E.nextGates(g).map((gi) => w[gi].len)); }
// Before each wave: plant or upgrade what most raises the harm per coin.
function spend(g) {
  for (let guard = 0; guard < 60; guard++) {
    const base = score(g);
    let best = null, bg = 0;
    const kinds = E.KINDS.filter((k) => E.unlocked(g, k));
    const consider = (c, cost) => { const gain = (score(c) - base) / cost; if (gain > bg) { bg = gain; best = c; } };
    for (let r = 0; r < 3; r++) for (let j = 0; j < E.RINGS[r].n; j++) {
      const key = E.key(r, j);
      for (const k of kinds) { if (E.whyNot(g, key, k)) continue; const c = E.clone(g); E.plant(c, key, k); consider(c, E.plantCost(k)); }
    }
    Object.keys(g.pl).forEach((k) => {
      const p = g.pl[k];
      if (p.l >= 3) return;
      (p.l === 2 ? ["a", "b"] : [""]).forEach((br) => { const c = E.clone(g); if (E.upgrade(c, k, br)) consider(c, E.upCost(p)); });
    });
    if (!best) return;
    Object.keys(best).forEach((k) => { g[k] = best[k]; });
  }
}
// And the free steps: the turns that make the way longest past the plants.
function turner(g) {
  const f = E.free(g), opts = [];
  for (let d = -f; d <= f; d++) opts.push(d);
  let best = null, bv = -1e9;
  for (const a of opts) for (const b of opts) for (const c of opts) {
    const x = E.clone(g);
    let ok = true;
    [a, b, c].forEach((d, k) => { for (let i = 0; i < Math.abs(d) && ok; i++) ok = E.turn(x, k, Math.sign(d)); });
    if (!ok) continue;
    const v = score(x) + 3 * shortest(x);
    if (v > bv + 1e-9) { bv = v; best = x; }
  }
  if (best) Object.keys(best).forEach((k) => { g[k] = best[k]; });
}
function play(id, diff, player, turns) {
  const g = E.newRun(id, diff);
  while (g.over < 0) {
    if (!g.sp.length && !g.sk.length) {
      if (turns) turner(g);
      if (player) player(g);
      if (turns) turner(g);
      E.callWave(g);
    }
    E.step(g);
    g.ev.length = 0;
  }
  return g;
}
// A spark placed by hand on the first gate's way.
function put(g, k, s, id) {
  const hp = 1000;
  const sk = { id: id || 900, k, w: 0, gt: 0, s, hp, mx: hp, sl: 0, st: 0, hd: 0, ar: E.SPARK[k].ar ? 1 : 0 };
  g.sk.push(sk);
  return sk;
}

test("orbit: eight gardens in two orbits, ten waves each ending with an eclipse, gates on the rim, the way ends at the moonflower", () => {
  assert.equal(E.GARDENS.length, 8);
  assert.deepEqual(E.GARDENS.map((gd) => gd.o), [1, 1, 1, 1, 2, 2, 2, 2]);
  E.GARDENS.forEach((gd) => {
    assert.equal(gd.waves.length, 10, gd.id);
    assert.ok(/e\d:\d+$/.test(gd.waves[9]), gd.id + ": an eclipse ends the night");
    gd.groups.forEach((gs) => gs.forEach((x) => assert.ok(E.SPARK[x.k] && x.n > 0, gd.id)));
    gd.gates.forEach((x) => assert.ok(x >= 0 && x < E.GATES_N));
    gd.gaps.forEach((gs, k) => { assert.equal(gs[0], 0, "frame slot 0 is always a gap"); gs.forEach((j) => assert.ok(j >= 0 && j < E.RINGS[k].n)); });
    gd.stones.forEach((st, k) => st.forEach((j) => assert.ok(j > 0 && j < E.RINGS[k].n && !E.isGap(gd, k, j), gd.id + ": never a gap")));
    if (gd.o === 1) assert.ok(gd.gaps.every((x) => x.length === 1) && gd.auto.every((x) => x === 0), gd.id + ": the Quiet orbit has no extras");
    const g = E.newRun(gd.id, "n");
    E.ways(g).forEach((w, i) => {
      const a = E.posOn(w, 0), b = E.posOn(w, w.len);
      assert.ok(near(Math.hypot(a.x, a.y), E.RIM, 1e-6), "starts on the rim");
      assert.ok(near(Math.hypot(b.x, b.y), E.HEART, 1e-6), "ends at the moonflower");
      assert.ok(near(Math.atan2(a.x, -a.y), (E.gateAngle(gd, i) + Math.PI) % (2 * Math.PI) - Math.PI, 1e-6) ||
        near(Math.hypot(a.x - E.point(E.RIM, E.gateAngle(gd, i)).x, a.y - E.point(E.RIM, E.gateAngle(gd, i)).y), 0, 1e-6), "at its gate");
    });
  });
});

test("orbit: the way walks clockwise to each ring's gap; turning a ring lengthens one lane and shortens the next", () => {
  const g = E.newRun("g1", "n");
  // g1: gate 0 at the top; gaps at 90° (outer, 4/16), 180° (middle, 6/12), 270° (inner, 6/8)
  const w = E.ways(g)[0];
  const lane = (r) => r * Math.PI / 2;
  const want = (E.RIM - E.LANES[0]) + lane(E.LANES[0]) + (E.LANES[0] - E.LANES[1]) + lane(E.LANES[1]) +
    (E.LANES[1] - E.LANES[2]) + lane(E.LANES[2]) + (E.LANES[2] - E.HEART);
  assert.ok(near(w.len, want, 1e-9), "a quarter round every lane");
  const p = E.posOn(w, (E.RIM - E.LANES[0]) + lane(E.LANES[0]) / 2);
  assert.ok(p.x > 0 && p.y < 0, "clockwise: half way round the first quarter is up and to the right");
  assert.ok(E.turn(g, 0, 1));
  const step = 2 * Math.PI / 16;
  assert.ok(near(E.ways(g)[0].len - w.len, step * (E.LANES[0] - E.LANES[1]), 1e-9), "outer lane longer, middle lane shorter");
  assert.equal(g.rot[0], 5);
  // turning the ring takes its plants with it
  const h = E.newRun("g1", "n");
  assert.ok(E.plant(h, "0:3", "thorn"));
  const before = E.slotPos(h, "0:3");
  E.turn(h, 0, 1);
  const after = E.slotPos(h, "0:3");
  assert.ok(near(Math.atan2(after.x, -after.y) - Math.atan2(before.x, -before.y), step, 1e-9));
});

test("orbit: two free steps per ring before the first wave, one after; more cost 5; turning back gives it back; locked while sparks are out", () => {
  const g = E.newRun("g1", "n");
  const c0 = g.coins;
  assert.equal(E.turnCost(g, 0, 1), 0);
  assert.ok(E.turn(g, 0, 1)); assert.ok(E.turn(g, 0, 1));
  assert.equal(g.coins, c0, "two free");
  assert.equal(E.turnCost(g, 0, 1), 5);
  assert.ok(E.turn(g, 0, 1));
  assert.equal(g.coins, c0 - 5);
  assert.equal(E.turnCost(g, 0, -1), -5, "turning back gives the step back");
  assert.ok(E.turn(g, 0, -1));
  assert.equal(g.coins, c0);
  assert.ok(E.turn(g, 1, -1), "each ring has its own steps, either way");
  assert.equal(g.coins, c0);
  g.coins = 3;
  assert.ok(E.turn(g, 1, -1), "second free step");
  assert.equal(E.whyNoTurn(g, 1, -1), "coins");
  assert.ok(!E.turn(g, 1, -1));
  g.coins = 100;
  E.callWave(g);
  assert.deepEqual(g.tn, [0, 0, 0]);
  assert.equal(E.whyNoTurn(g, 2, 1), "out", "the wave's sparks are coming");
  E.run(g, 120);
  assert.ok(g.sk.length > 0);
  assert.ok(!E.turn(g, 2, 1));
  g.sk = []; g.sp = [];
  assert.equal(E.free(g), 1);
  assert.ok(E.turn(g, 2, 1));
  assert.equal(E.turnCost(g, 2, 1), 5, "one free step between waves");
  assert.ok(!E.turn(g, 3, 1) && !E.turn(g, 0, 2), "only rings 0-2, one step at a time");
});

test("orbit: plant, upgrade with a branch, aim, sell (full back since the wave began); never in the gap or on a stone", () => {
  const g = E.newRun("g4", "n");
  assert.equal(g.u, 4);
  assert.equal(g.coins, 120);
  assert.equal(E.whyNot(g, "0:0", "thorn"), "gap");
  assert.equal(E.whyNot(g, "0:8", "thorn"), "stone");
  assert.equal(E.whyNot(g, "3:1", "thorn"), "stone", "no such ring");
  assert.ok(E.plant(g, "0:2", "thorn"));
  assert.equal(E.whyNot(g, "0:2", "dew"), "taken");
  assert.ok(E.upgrade(g, "0:2", ""));
  assert.equal(g.coins, 120 - 45 - 27);
  assert.ok(!E.upgrade(g, "0:2", ""), "level 3 needs a branch");
  g.coins = 500;
  assert.ok(E.upgrade(g, "0:2", "a"));
  assert.deepEqual([g.pl["0:2"].l, g.pl["0:2"].b], [3, "a"]);
  assert.ok(!E.upgrade(g, "0:2", "b"), "top level");
  assert.equal(E.sellValue(g.pl["0:2"]), 117, "all of it: planted since the wave began");
  assert.ok(E.target(g, "0:2"));
  assert.equal(E.TARGETS[g.pl["0:2"].tm], "strong");
  assert.ok(E.plant(g, "1:3", "dew"));
  assert.ok(!E.target(g, "1:3"), "a sprinkler has no aim");
  E.callWave(g);
  assert.equal(E.sellValue(g.pl["0:2"]), 81, "older: 70%");
  const c = g.coins;
  assert.ok(E.sell(g, "0:2"));
  assert.equal(g.coins, c + 81);
  const h = E.newRun("g1", "n");
  assert.equal(E.whyNot(h, "0:2", "dew"), "locked", "the sprinkler opens in garden 2");
  h.coins = 10;
  assert.equal(E.whyNot(h, "0:2", "thorn"), "coins");
});

// The free beds of a ring, nearest to a point first.
function bedsNear(g, ring, p) {
  const gd = E.GARDEN[g.gd], out = [];
  for (let j = 1; j < E.RINGS[ring].n; j++) {
    const key = E.key(ring, j);
    if (!E.isBed(gd, ring, j) || g.pl[key]) continue;
    const q = E.slotPos(g, key);
    out.push({ key, d: Math.hypot(q.x - p.x, q.y - p.y) });
  }
  return out.sort((x, y) => x.d - y.d);
}

test("orbit: thorns aim by mode, meteor shells let a part through until a sunflower cracks them, vines hold, sprays slow", () => {
  const g = E.newRun("g4", "n");
  g.coins = 2000; g.wave = 1; g.wl[0] = 9;
  const sAt = (E.RIM - E.LANES[0]) + 0.5;
  const p = E.posOn(E.ways(g)[0], sAt);
  const [b1, b2] = bedsNear(g, 0, p);
  assert.ok(b2.d < 1.7, "two beds within reach of the way in");
  assert.ok(E.plant(g, b1.key, "thorn"));
  const a = put(g, "s", sAt, 1), b = put(g, "s", sAt - 0.3, 2);
  b.hp = 2000;
  E.step(g);
  assert.ok(a.hp < 1000 && b.hp === 2000, "first: the one furthest along");
  g.pl[b1.key].cd = 0; g.pl[b1.key].tm = 1;
  E.step(g);
  assert.ok(b.hp < 2000, "strongest");
  g.sk = [];
  const m = put(g, "m", sAt, 3);
  g.pl[b1.key].cd = 0; g.pl[b1.key].tm = 0;
  E.step(g);
  assert.ok(near(1000 - m.hp, E.stats(g.pl[b1.key]).d * 0.4), "the shell lets a part through");
  assert.ok(E.plant(g, b2.key, "sun"));
  E.step(g);
  assert.equal(m.ar, 0, "a sunflower cracks the shell");
  const hp = m.hp;
  g.pl[b1.key].cd = 0; g.pl[b2.key].cd = 99;
  E.step(g);
  assert.ok(near(hp - m.hp, E.stats(g.pl[b1.key]).d), "then thorns do it all");
  // vines hold, sprays slow
  const h = E.newRun("g4", "n");
  h.coins = 2000; h.wave = 1; h.wl[0] = 3;
  assert.ok(E.plant(h, b1.key, "vine"));
  assert.ok(E.plant(h, b2.key, "dew"));
  const v = put(h, "s", sAt, 7);
  E.step(h);
  assert.ok(v.hd > 0, "held");
  assert.ok(v.st > 0 && v.sl === E.stats(h.pl[b2.key]).sl, "slowed");
  const s0 = v.s;
  E.run(h, 10);
  assert.equal(v.s, s0, "a held spark does not move");
});

test("orbit: a nebula leaves two bits; eclipses cost three hearts; waves come only when called; early calls pay", () => {
  const g = E.newRun("g4", "n");
  g.wave = 1; g.wl[0] = 1;
  const n = put(g, "n", 3, 5);
  n.hp = 0;
  E.step(g);
  assert.equal(g.sk.filter((s) => s.k === "b").length, 2);
  assert.equal(g.wl[0], 2, "the bits count for the wave");
  const h = E.newRun("g1", "n");
  h.wave = 1; h.wl[0] = 1;
  put(h, "e", E.ways(h)[0].len - 0.001, 6);
  E.step(h);
  assert.equal(h.hearts, 17);
  const k = E.newRun("g1", "n");
  E.run(k, 600);
  assert.equal(k.sk.length, 0);
  assert.ok(E.callWave(k));
  E.run(k, 200);
  assert.ok(k.sk.length > 0);
  const c = k.coins, left = E.sparksLeft(k);
  assert.ok(E.callWave(k));
  assert.equal(k.coins, c + left);
  assert.equal(k.wave, 2);
  // two gates: groups take them in turn, and the preview says which
  const t = E.newRun("g2", "n");
  t.wave = 2;
  assert.deepEqual(E.preview(t).map((x) => x.gt), [0, 1]);
});

test("orbit: doing nothing loses; a plain player who turns the rings clears the first garden; turning matters; replays exactly", () => {
  const idle = play("g1", "n", null, false);
  assert.equal(idle.over, 0);
  assert.equal(E.stars(idle), 0);
  const a = play("g1", "n", spend, true), b = play("g1", "n", spend, true);
  assert.equal(a.over, 1, "Normal is beatable on the first garden");
  assert.ok(E.stars(a) >= 2);
  assert.equal(J(E.saveable(a)), J(E.saveable(b)), "deterministic");
  assert.equal(play("g4", "n", spend, false).over, 0, "garden 4 on Normal is lost without turning");
  assert.equal(play("g4", "n", spend, true).over, 1, "and won with the turns");
  E.GARDENS.forEach((gd) => assert.equal(play(gd.id, "m", spend, true).over, 1, gd.id + " is beatable on Mild"));
  ["g5", "g6", "g7", "g8"].forEach((id) => assert.equal(play(id, "n", spend, true).over, 1, id + " is beatable on Normal with the turns"));
  assert.equal(play("g5", "m", spend, false).over, 0, "the far orbit is lost without turning, even on Mild");
});

test("orbit: a ring with two gaps lets the sparks through the first one they meet; neither gap takes a plant", () => {
  const g = E.newRun("g5", "n"), gd = E.GARDEN.g5;
  assert.deepEqual(gd.gaps[0], [0, 8]);
  assert.equal(E.whyNot(g, "0:8", "thorn"), "gap");
  assert.equal(E.isBed(gd, 0, 8), false);
  assert.equal(E.isBed(gd, 0, 7), true);
  const w = E.ways(g)[0], arc = w.seg.filter((q) => q.t === "c")[0];
  const a0 = E.gateAngle(gd, 0), to = [0, 8].map((j) => E.slotAngle(g.rot, 0, j));
  const sw = (b) => ((b - a0) % E.TAU + E.TAU) % E.TAU;
  assert.ok(near(arc.da, Math.min(...to.map(sw))), "the nearer gap clockwise");
  assert.ok(arc.da < Math.PI + 1e-9, "never more than half round with two opposite gaps");
});

test("orbit: a self-turning ring turns once after every wave, when the garden is clear, and the way follows", () => {
  const g = E.newRun("g6", "n"), gd = E.GARDEN.g6;
  assert.deepEqual(gd.auto, [0, 1, 0]);
  const r0 = g.rot.slice();
  E.callWave(g);
  let autos = [];
  for (let i = 0; i < 60 * 120 && (g.sp.length || g.sk.length || !autos.length); i++) {
    E.step(g);
    autos = autos.concat(g.ev.filter((x) => x.e === "auto"));
    g.ev.length = 0;
  }
  assert.equal(autos.length, 1);
  assert.deepEqual(autos[0], { e: "auto", k: 1, d: 1 });
  assert.deepEqual(g.rot, [r0[0], (r0[1] + 1) % 12, r0[2]]);
  assert.equal(g.at, 1);
  for (let i = 0; i < 120; i++) E.step(g);
  assert.deepEqual(g.rot[1], (r0[1] + 1) % 12, "only once per wave");
  assert.ok(E.canTurn(g) && E.turn(g, 1, -1), "the player can turn it back with the free step");
  assert.equal(E.turnCost(g, 1, -1), 5);
});

test("orbit: Endless repeats the garden's waves with more and stronger sparks; the best wave is kept", () => {
  const g = E.newRun("g1", "n", true);
  assert.equal(g.en, 1);
  assert.equal(g.nw, E.ENDLESS);
  assert.deepEqual(g.wl, []);
  const n0 = E.groupsOf(g, 0)[0].n, n10 = E.groupsOf(g, 10)[0].n, n20 = E.groupsOf(g, 20)[0].n;
  assert.ok(n10 > n0 && n20 > n10, "more sparks each round");
  assert.ok(E.sparkHp(g, "s", 20) > E.sparkHp(E.newRun("g1", "n"), "s", 20) * 2, "and stronger past wave 10");
  E.callWave(g);
  assert.equal(g.wl.length, 1);
  assert.ok(E.normalizeRun(JSON.parse(J(E.saveable(g)))), "the session copy loads");
  const bad = JSON.parse(J(E.saveable(g))); bad.wl = [];
  assert.equal(E.normalizeRun(bad), null);
  const won = JSON.parse(J(E.saveable(g))); won.over = 1;
  assert.equal(E.normalizeRun(won), null, "an Endless night is never won");
  // a lost Endless night: no stars, the waves cleared count
  g.wl[0] = 0; g.over = 0;
  assert.equal(E.stars(g), 0);
  let d = E.record(E.defaultData(), "dev123", Object.assign(E.newRun("g1", "n"), { over: 1, hearts: 20 }), 5);
  d = E.record(d, "dev123", g, 6);
  assert.equal(E.starsOf(d, "g1"), 3);
  assert.equal(E.endlessOf(d, "g1"), 1);
  assert.ok(E.endlessOpen(d, "g1") && !E.endlessOpen(d, "g2"));
  assert.deepEqual(d.rows.dev123.s.n, [2, 1]);
});

test("orbit: a session from before the far orbit (no at) loads without a surprise turn", () => {
  const g = E.newRun("g6", "n");
  E.callWave(g);
  const old = JSON.parse(J(E.saveable(g)));
  delete old.at;
  const back = E.normalizeRun(old);
  assert.equal(back.at, 1);
});

test("orbit: the session copy is canonical, and anything odd is refused", () => {
  const g = E.newRun("g2", "h");
  E.plant(g, "0:5", "thorn"); E.turn(g, 1, 1); E.callWave(g); E.run(g, 400);
  const c = E.saveable(g);
  assert.equal(c.ev, undefined);
  assert.equal(c._w, undefined, "derived ways are never saved");
  const n = E.normalizeRun(JSON.parse(J(c)));
  assert.equal(J(E.saveable(n)), J(c));
  E.run(n, 300); E.run(g, 300);
  assert.equal(J(E.saveable(n)), J(E.saveable(g)), "a reopened night goes on the same way");
  assert.equal(E.normalizeRun(null), null);
  assert.equal(E.normalizeRun({ ...c, v: 2 }), null);
  assert.equal(E.normalizeRun({ ...c, gd: "zz" }), null);
  assert.equal(E.normalizeRun({ ...c, rot: [16, 0, 0] }), null);
  assert.equal(E.normalizeRun({ ...c, pl: { "0:0": c.pl["0:5"] } }), null, "not in the gap");
  assert.equal(E.normalizeRun({ ...c, pl: { "00:5": c.pl["0:5"] } }), null, "one spelling of a slot");
  assert.equal(E.normalizeRun({ ...c, pl: { "0:5": { ...c.pl["0:5"], l: 3, b: "" } } }), null, "level 3 needs a branch");
  assert.equal(E.normalizeRun({ ...c, sk: [{ k: "zz" }] }), null);
  const st = E.newRun("g3", "n"), sc = E.saveable(st);
  assert.equal(E.normalizeRun({ ...sc, pl: { "0:5": c.pl["0:5"] } }), null, "not on a stone");
});

test("orbit: progress merge is a join (symmetric, idempotent, the reset stamp wins)", () => {
  const A = { ver: 1, br: 0, maps: { g1: { b: 0, s: 3, e: 0 }, g2: { b: 0, s: 1, e: 0 } },
              rows: { aaaaaa1: { b: 0, s: { n: [3, 2] }, f: 40 } } };
  const B = { ver: 1, br: 0, maps: { g2: { b: 0, s: 2, e: 0 }, bad: { b: 0, s: 3, e: 0 } },
              rows: { aaaaaa1: { b: 0, s: { n: [2, 2], h: [1, 0] }, f: 10 }, bbbbbb2: { b: 0, s: { m: [1, 1] }, f: 5 } } };
  const ab = E.merge(A, B), ba = E.merge(B, A);
  assert.equal(J(ab), J(ba));
  assert.equal(J(E.merge(ab, ab)), J(ab));
  assert.deepEqual(ab.maps, { g1: { b: 0, s: 3, e: 0 }, g2: { b: 0, s: 2, e: 0 } });
  assert.deepEqual(ab.rows.aaaaaa1, { b: 0, s: { n: [3, 2], h: [1, 0] }, f: 40 });
  const R = { ver: 1, br: 5, maps: {}, rows: {} };
  const r = E.merge(ab, R);
  assert.deepEqual([r.br, Object.keys(r.maps).length, Object.keys(r.rows).length], [5, 0, 0], "a reset drops what came before");
  assert.equal(J(E.merge(r, ab)), J(r));
  assert.equal(J(E.merge(null, undefined)), J(E.defaultData()));
});

test("orbit: a night counts once per end; stars open the next garden", () => {
  let d = E.defaultData();
  assert.ok(E.isOpen(d, "g1"));
  assert.ok(!E.isOpen(d, "g2"));
  const lost = play("g1", "n", null, false);
  d = E.record(d, "dev0001", lost, 1000);
  assert.deepEqual(d.rows.dev0001.s.n, [1, 0]);
  assert.ok(!E.isOpen(d, "g2"));
  const won = play("g1", "m", spend, true);
  d = E.record(d, "dev0001", won, 2000);
  assert.deepEqual(d.rows.dev0001.s.m, [1, 1]);
  assert.equal(E.starsOf(d, "g1"), E.stars(won));
  assert.ok(E.isOpen(d, "g2"));
  assert.equal(J(E.merge(d, d)), J(d), "canonical");
});
