// Windmill ridge: the rules engine (ridge/engine.js, a module): roads
// and pads, the wind, towers, waves, the session copy and the sync merge.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../ridge/engine.js");

const J = JSON.stringify;

// A plain player: slings first, then the other towers it has, then
// upgrades (branch a), always on the pads that see the most road.
function cover(rd, pad, r) {
  const p = E.padPos(rd, pad);
  let n = 0;
  for (let s = 0; s < rd.len; s += 0.25) {
    const q = E.posAt(rd, s);
    if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 <= r * r) n++;
  }
  return n;
}
function spend(g) {
  const rd = E.RIDGE[g.ridge];
  const pads = rd.pads.map((_, i) => i).sort((a, b) => cover(rd, b, 2.6) - cover(rd, a, 2.6) || a - b);
  for (let guard = 0; guard < 40; guard++) {
    const free = pads.find((i) => !g.tw[i]);
    const have = Object.keys(g.tw).length;
    const k = E.KINDS.filter((x) => E.unlocked(g, x))[have % Math.min(2, E.KINDS.filter((x) => E.unlocked(g, x)).length)];
    if (have < 4 && free !== undefined && E.build(g, free, k)) continue;
    if (Object.keys(g.tw).some((p) => E.upgrade(g, +p, "a"))) continue;
    if (free !== undefined && E.build(g, free, "sling")) continue;
    return;
  }
}
function play(ridge, diff, player) {
  const g = E.newRun(ridge, diff);
  while (g.over < 0) {
    if (player) player(g);
    if (!g.sp.length && !g.fog.length) E.callWave(g);
    E.step(g);
    g.ev.length = 0;
  }
  return g;
}

test("ridge: every map is on the 9 x 16 grid, pads beside the road and never on it", () => {
  assert.equal(E.RIDGES.length, 4);
  const ids = new Set();
  E.RIDGES.forEach((rd) => {
    assert.ok(!ids.has(rd.id)); ids.add(rd.id);
    rd.path.forEach(([c, r]) => assert.ok(c >= 0 && c < E.COLS && r >= 0 && r < E.ROWS, rd.id));
    for (let i = 1; i < rd.path.length; i++) {
      const [a, b] = [rd.path[i - 1], rd.path[i]];
      assert.ok(a[0] === b[0] || a[1] === b[1], rd.id + ": straight lines only");
    }
    assert.equal(rd.path[rd.path.length - 1][1], 0, rd.id + ": the well is on the top row");
    const seen = new Set();
    rd.pads.forEach(([c, r]) => {
      const k = c + "," + r;
      assert.ok(!seen.has(k), rd.id + " pad twice " + k); seen.add(k);
      assert.ok(c >= 0 && c < E.COLS && r >= 0 && r < E.ROWS, rd.id + " " + k);
      assert.ok(!rd.tiles[k], rd.id + " pad on the road " + k);
      const near = Object.keys(rd.tiles).some((x) => { const [tc, tr] = x.split(",").map(Number); return Math.abs(tc - c) <= 1 && Math.abs(tr - r) <= 1; });
      assert.ok(near, rd.id + " pad far from the road " + k);
    });
    assert.ok(rd.pads.length >= 12 && rd.pads.length <= 14, rd.id);
    assert.equal(rd.waves.length, 10);
    rd.groups.forEach((gs) => gs.forEach((x) => assert.ok(E.FOG[x.k] && x.n > 0, rd.id)));
  });
});

test("ridge: positions along the road", () => {
  const rd = E.RIDGE.i1r1;
  assert.deepEqual(E.posAt(rd, 0), { x: 4.5, y: 15.5 });
  assert.deepEqual(E.posAt(rd, 3), { x: 4.5, y: 12.5 });
  assert.deepEqual(E.posAt(rd, rd.len), { x: 3.5, y: 0.5 });
  assert.equal(rd.len, 28);
});

test("ridge: the wind is the same for the same night and wave, and stretches the reach", () => {
  assert.deepEqual(E.windOf("i1r1", "n", 3), E.windOf("i1r1", "n", 3));
  const all = new Set();
  for (let w = 0; w < 40; w++) { const x = E.windOf("i1r2", "n", w); all.add(x.s); assert.ok(x.d >= 0 && x.d < 8); }
  assert.ok(all.size >= 3, "strengths vary");
  const east = { d: 2, s: 3 };                     // a gale blowing east
  assert.ok(Math.abs(E.reachTo("sling", 2, east, 1, 0) - 2.6) < 1e-9, "downwind +30%");
  assert.ok(Math.abs(E.reachTo("sling", 2, east, -1, 0) - 1.4) < 1e-9, "upwind -30%");
  assert.ok(Math.abs(E.reachTo("sling", 2, east, 0, 1) - 2) < 1e-9, "across: as is");
  assert.equal(E.reachTo("bell", 2, east, -1, 0), 2, "bells never lose reach");
  assert.ok(E.reachTo("bell", 2, east, 1, 0) > 2.5);
  assert.equal(E.reachTo("mill", 2, east, 1, 0), 2, "windmills ignore the direction");
  assert.equal(E.reachTo("sling", 2, { d: 2, s: 0 }, 1, 0), 2, "calm");
});

test("ridge: build, upgrade with a branch, aim and sell (full back since the wave began)", () => {
  const g = E.newRun("i1r4", "n");
  assert.equal(g.u, 4);
  assert.equal(g.coins, 100);
  assert.ok(E.build(g, 0, "sling"));
  assert.ok(!E.build(g, 0, "sling"), "a pad holds one tower");
  assert.ok(!E.build(g, 1, "mill"), "not enough coins");
  assert.ok(E.upgrade(g, 0, ""));
  assert.equal(g.coins, 100 - 50 - 30);
  assert.ok(!E.upgrade(g, 0, ""), "level 3 needs a branch");
  g.coins = 200;
  assert.ok(E.upgrade(g, 0, "b"));
  assert.deepEqual([g.tw[0].l, g.tw[0].b], [3, "b"]);
  assert.equal(E.stats(g.tw[0]).r, E.TOWERS.sling.st.b.r);
  assert.ok(!E.upgrade(g, 0, "a"), "top level");
  assert.ok(E.target(g, 0)); assert.equal(g.tw[0].tm, 1);
  assert.equal(E.sellValue(g.tw[0]), 130, "all of it: built since the wave began");
  E.callWave(g);
  assert.equal(E.sellValue(g.tw[0]), 91, "older: 70%");
  const c = g.coins;
  assert.ok(E.sell(g, 0));
  assert.equal(g.coins, c + 91);
  assert.ok(!g.tw[0]);
  const h = E.newRun("i1r1", "n");
  assert.ok(!E.build(h, 0, "bell"), "the bell opens on ridge 2");
  assert.ok(E.build(h, 0, "sling"));
  assert.ok(E.build(h, 1, "sling"));
  assert.ok(!E.target(E.newRun("i1r4", "n"), 0), "no tower, nothing to aim");
});

test("ridge: waves come only when called; an early call pays for the fog still out", () => {
  const g = E.newRun("i1r1", "n");
  E.run(g, 600);
  assert.equal(g.fog.length, 0);
  assert.equal(g.wave, 0);
  assert.ok(E.callWave(g));
  E.run(g, 200);
  assert.ok(g.fog.length > 0);
  const c = g.coins, left = E.fogLeft(g);
  assert.ok(left > 0);
  assert.ok(E.callWave(g));
  assert.equal(g.coins, c + left);
  assert.equal(g.wave, 2);
});

test("ridge: doing nothing loses, a plain player clears the first ridge, the same night replays exactly", () => {
  const idle = play("i1r1", "n", null);
  assert.equal(idle.over, 0);
  assert.equal(idle.hearts, 0);
  assert.equal(E.stars(idle), 0);
  const a = play("i1r1", "m", spend), b = play("i1r1", "m", spend);
  assert.equal(a.over, 1, "won");
  assert.ok(E.stars(a) >= 2);
  assert.equal(J(E.saveable(a)), J(E.saveable(b)), "deterministic");
  const n = play("i1r1", "n", spend);
  assert.equal(n.over, 1, "Normal is beatable on the first ridge");
});

test("ridge: shells shrug off stones until oil or a deep bell cracks them; puffs split; windmills push", () => {
  const g = E.newRun("i1r4", "n");
  g.coins = 1000;
  const rd = E.RIDGE.i1r4;
  // a shell next to pad 0 and a sling there
  E.build(g, 0, "sling");
  const near = (() => { let best = 0, bd = 1e9; for (let s = 0; s < rd.len; s += 0.1) { const q = E.posAt(rd, s), p = E.padPos(rd, 0); const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2; if (d < bd) { bd = d; best = s; } } return best; })();
  g.wave = 1; g.wl[0] = 3;
  g.fog.push({ id: 900, k: "s", w: 0, s: near, hp: 100, mx: 100, sl: 0, st: 0, ar: 1 });
  E.step(g);
  assert.equal(g.fog[0].hp, 100 - 10 * 0.25, "a stone does a quarter");
  g.oil.push({ a: 0, b: rd.len, e: g.t + 10, dps: 60, sl: 0 });
  E.step(g);
  assert.equal(g.fog[0].ar, 0, "oil cracks the shell");
  // a puff that fades leaves two halves
  g.fog = [{ id: 901, k: "p", w: 0, s: near, hp: 0.5, mx: 40, sl: 0, st: 0, ar: 0 }];
  g.wl[0] = 1;
  g.oil = [];
  g.tw[0].cd = 0;
  E.step(g);
  assert.deepEqual(g.fog.map((f) => f.k), ["m", "m"]);
  assert.equal(g.wl[0], 2);
  // a windmill pushes the fog back, harder in a gale
  const m = E.newRun("i1r4", "n");
  m.coins = 1000; m.wave = 1; m.wl[0] = 1;
  E.build(m, 0, "mill");
  m.fog.push({ id: 902, k: "w", w: 0, s: near, hp: 999, mx: 999, sl: 0, st: 0, ar: 0 });
  E.step(m);
  const w = E.windNow(m);
  assert.ok(Math.abs(m.fog[0].s - (near - 1.6 * (1 + w.s) / 2 + 0.9 / 60)) < 1e-9);
});

test("ridge: the session copy is canonical, and anything odd is refused", () => {
  const g = E.newRun("i1r2", "h");
  E.build(g, 3, "sling"); E.callWave(g); E.run(g, 400);
  const c = E.saveable(g);
  assert.equal(c.ev, undefined);
  const n = E.normalizeRun(JSON.parse(J(c)));
  assert.equal(J(E.saveable(n)), J(c));
  E.run(n, 300); E.run(g, 300);
  assert.equal(J(E.saveable(n)), J(E.saveable(g)), "a reopened night goes on the same way");
  assert.equal(E.normalizeRun(null), null);
  assert.equal(E.normalizeRun({ ...c, v: 2 }), null);
  assert.equal(E.normalizeRun({ ...c, ridge: "zz" }), null);
  assert.equal(E.normalizeRun({ ...c, tw: { 99: c.tw[3] } }), null, "no such pad");
  assert.equal(E.normalizeRun({ ...c, tw: { 3: { ...c.tw[3], l: 3, b: "" } } }), null, "level 3 needs a branch");
  assert.equal(E.normalizeRun({ ...c, fog: [{ k: "zz" }] }), null);
});

test("ridge: progress merge is a join (symmetric, idempotent, the reset stamp wins)", () => {
  const A = { ver: 1, br: 0, maps: { i1r1: { b: 0, s: 3, e: 0 }, i1r2: { b: 0, s: 1, e: 0 } },
              rows: { aaaaaa1: { b: 0, s: { n: [3, 2] }, f: 40 } } };
  const B = { ver: 1, br: 0, maps: { i1r2: { b: 0, s: 2, e: 0 }, bad: { b: 0, s: 3, e: 0 } },
              rows: { aaaaaa1: { b: 0, s: { n: [2, 2], h: [1, 0] }, f: 10 }, bbbbbb2: { b: 0, s: { m: [1, 1] }, f: 5 } } };
  const ab = E.merge(A, B), ba = E.merge(B, A);
  assert.equal(J(ab), J(ba));
  assert.equal(J(E.merge(ab, ab)), J(ab));
  assert.deepEqual(ab.maps, { i1r1: { b: 0, s: 3, e: 0 }, i1r2: { b: 0, s: 2, e: 0 } });
  assert.deepEqual(ab.rows.aaaaaa1, { b: 0, s: { n: [3, 2], h: [1, 0] }, f: 40 });
  const R = { ver: 1, br: 5, maps: {}, rows: {} };
  const r = E.merge(ab, R);
  assert.deepEqual([r.br, Object.keys(r.maps).length, Object.keys(r.rows).length], [5, 0, 0], "a reset drops what came before");
  assert.equal(J(E.merge(r, ab)), J(r));
  assert.equal(J(E.merge(null, undefined)), J(E.defaultData()));
});

test("ridge: a night counts once per end; stars open the next ridge", () => {
  let d = E.defaultData();
  assert.ok(E.isOpen(d, "i1r1"));
  assert.ok(!E.isOpen(d, "i1r2"));
  const lost = play("i1r1", "n", null);
  d = E.record(d, "dev0001", lost, 1000);
  assert.deepEqual(d.rows.dev0001.s.n, [1, 0]);
  assert.ok(!E.isOpen(d, "i1r2"));
  const won = play("i1r1", "m", spend);
  d = E.record(d, "dev0001", won, 2000);
  assert.deepEqual(d.rows.dev0001.s.m, [1, 1]);
  assert.equal(E.starsOf(d, "i1r1"), E.stars(won));
  assert.ok(E.isOpen(d, "i1r2"));
  assert.equal(J(E.merge(d, d)), J(d), "canonical");
});
