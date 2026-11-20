// Lantern maze: the rules engine (maze/engine.js, a module): the
// squares, light and the darkest way, refused placements, towers,
// waves, the session copy and the sync merge.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../maze/engine.js");

const J = JSON.stringify;

// A plain player: before each wave it adds the block (or upgrade) that
// most raises the harm along the shadows' way, per coin, while one helps.
function exposure(g, route) {
  const f = E.fields(g);
  const beam = {};
  Object.keys(f.beams).forEach((i) => f.beams[i].forEach((l) => l.forEach((j) => { beam[j] = (beam[j] || 0) + E.stats(g.bl[i]).dps; })));
  let sum = 0;
  route.forEach((t) => {
    const p = E.centre(t);
    let d = beam[t] || 0, slow = 1;
    Object.keys(g.bl).forEach((k) => {
      const b = g.bl[k];
      if (b.k === "crate") return;
      const st = E.stats(b), q = E.centre(+k), r2 = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
      if (st.r && r2 > st.r * st.r) return;
      if (b.k === "lantern") d += st.dps;
      else if (b.k === "flash") d += st.d * 60 / st.cd;
      else if (b.k === "bell") slow = Math.max(slow, 1 + st.sl);
    });
    sum += d * slow;
  });
  return sum;
}
function score(g) {
  let s = 0;
  E.routes(g, false).forEach((r) => { s += exposure(g, r); });
  if (E.hasMoths(g.sq)) E.routes(g, true).forEach((r) => { s += 0.6 * exposure(g, r); });
  return s;
}
function spend(g) {
  for (let guard = 0; guard < 60; guard++) {
    const base = score(g), way = new Set();
    E.routes(g, false).forEach((r) => r.forEach((t) => way.add(t)));
    if (E.hasMoths(g.sq)) E.routes(g, true).forEach((r) => r.forEach((t) => way.add(t)));
    let best = null, bg = 0;
    const kinds = E.KINDS.filter((k) => E.unlocked(g, k));
    const consider = (c, cost) => { const gain = (score(c) - base) / cost; if (gain > bg) { bg = gain; best = c; } };
    for (let t = 0; t < E.N; t++) {
      if (!E.isGround(E.SQUARE[g.sq], t) || g.bl[t]) continue;
      const p = E.centre(t);
      if (![...way].some((x) => { const q = E.centre(x); return (p.x - q.x) ** 2 + (p.y - q.y) ** 2 <= 9; })) continue;
      for (const k of way.has(t) ? kinds.concat("crate") : kinds) {
        if (E.whyNot(g, t, k)) continue;
        const c = E.clone(g);
        if (E.build(c, t, k)) consider(c, E.buildCost(k));
      }
    }
    Object.keys(g.bl).forEach((k) => {
      const b = g.bl[k];
      if (b.k === "crate" || b.l >= 3) return;
      (b.l === 2 ? ["a", "b"] : [""]).forEach((br) => {
        const c = E.clone(g);
        if (E.upgrade(c, +k, br)) consider(c, E.upCost(b));
      });
    });
    if (!best) return;
    Object.keys(best).forEach((k) => { g[k] = best[k]; });
  }
}
function play(sq, diff, player) {
  const g = E.newRun(sq, diff);
  while (g.over < 0) {
    if (!g.sp.length && !g.sh.length) { if (player) player(g); E.callWave(g); }
    E.step(g);
    g.ev.length = 0;
  }
  return g;
}
function at(c, r) { return E.idx(c, r); }

test("maze: every square is 12 x 18, one fountain, gates on the edge, a way from every gate", () => {
  assert.equal(E.SQUARES.length, 4);
  const ids = new Set();
  E.SQUARES.forEach((sq) => {
    assert.ok(!ids.has(sq.id)); ids.add(sq.id);
    assert.equal(sq.map.length, E.ROWS, sq.id);
    sq.map.forEach((row) => { assert.equal(row.length, E.COLS, sq.id); assert.match(row, /^[#ow.GF]+$/, sq.id); });
    assert.ok(sq.fountain >= 0, sq.id);
    assert.ok(sq.gates.length >= 1, sq.id);
    sq.gates.forEach((g) => {
      const c = E.colOf(g), r = E.rowOf(g);
      assert.ok(c === 0 || r === 0 || c === E.COLS - 1 || r === E.ROWS - 1, sq.id + ": gate on the edge");
    });
    const g = E.newRun(sq.id, "n");
    E.routes(g, false).forEach((r) => assert.equal(r[r.length - 1], sq.fountain, sq.id + ": the way ends at the fountain"));
    assert.equal(sq.waves.length, 10);
    sq.groups.forEach((gs) => gs.forEach((x) => assert.ok(E.SHADOW[x.k] && x.n > 0, sq.id)));
    assert.ok(/g1:0$/.test(sq.waves[9]), sq.id + ": a gloom ends the night");
  });
});

test("maze: light raises the cost, so shadows walk around it; moths walk into it", () => {
  const g = E.newRun("q1", "n");
  const before = E.routes(g, false)[0];
  assert.ok(before.includes(at(6, 9)), "the straight way runs up column 6");
  g.coins = 1000;
  assert.ok(E.build(g, at(7, 9), "lantern"));
  const f = E.fields(g);
  assert.equal(f.light[at(6, 9)], 1);
  assert.equal(f.light[at(7, 9)], 0, "a tower lights the tiles round it, not its own");
  assert.equal(E.tileCost(f.light, at(6, 9), false), 3, "a lit tile counts as three steps");
  assert.equal(E.tileCost(f.light, at(6, 9), true), 5, "for a moth a dark tile is the dear one");
  const after = E.routes(g, false)[0];
  assert.ok(!after.includes(at(6, 9)), "the shadows step out of the light");
  after.forEach((t) => assert.equal(E.walkable(E.SQUARE.q1, g.bl, t), true));
  // two lanterns add up, capped at 3
  assert.ok(E.build(g, at(5, 9), "lantern"));
  assert.equal(E.fields(g).light[at(6, 9)], 2);
  const moth = E.routes(g, true)[0];
  assert.ok(moth.includes(at(6, 9)) || moth.includes(at(6, 8)) || moth.includes(at(6, 10)), "a moth goes through the light");
});

test("maze: a block that would close the last way is refused, with the reason", () => {
  const g = E.newRun("q1", "n");
  g.coins = 1000;
  // wall off row 8 except one tile
  for (let c = 2; c <= 9; c++) if (c !== 9) assert.ok(E.build(g, at(c, 8), "crate"), "crate " + c);
  assert.equal(E.whyNot(g, at(9, 8), "crate"), "closed");
  assert.ok(!E.build(g, at(9, 8), "crate"));
  assert.equal(E.routeWith(g, at(9, 8)), null);
  assert.equal(E.whyNot(g, at(0, 0), "crate"), "ground", "a house");
  assert.equal(E.whyNot(g, E.SQUARE.q1.gates[0], "crate"), "ground", "the gate");
  assert.equal(E.whyNot(g, E.SQUARE.q1.fountain, "crate"), "ground", "the fountain");
  assert.equal(E.whyNot(g, at(4, 4), "crate"), "ground", "a column");
  assert.equal(E.whyNot(g, at(2, 8), "crate"), "taken");
  assert.equal(E.whyNot(g, at(3, 3), "flash"), "locked", "the flash lamp opens on square 2");
  g.coins = 3;
  assert.equal(E.whyNot(g, at(3, 3), "crate"), "coins");
  // a shadow on its way: its tiles cannot be built on
  const h = E.newRun("q1", "n");
  E.callWave(h); E.run(h, 200);
  const s = h.sh[0];
  assert.ok(s, "a shadow is out");
  assert.equal(E.whyNot(h, s.to, "crate"), "shadow");
});

test("maze: build, upgrade with a branch, sell (full back since the wave began), turn a mirror", () => {
  const g = E.newRun("q4", "n");
  assert.equal(g.u, 4);
  assert.equal(g.coins, 120);
  assert.ok(E.build(g, at(5, 5), "lantern"));
  assert.ok(!E.build(g, at(5, 5), "crate"), "one block a tile");
  assert.ok(E.upgrade(g, at(5, 5), ""));
  assert.equal(g.coins, 120 - 40 - 24);
  assert.ok(!E.upgrade(g, at(5, 5), ""), "level 3 needs a branch");
  g.coins = 500;
  assert.ok(E.upgrade(g, at(5, 5), "a"));
  assert.deepEqual([g.bl[at(5, 5)].l, g.bl[at(5, 5)].b], [3, "a"]);
  assert.equal(E.fields(g).light[at(5, 6)], 2, "the bright lamp gives two");
  assert.ok(!E.upgrade(g, at(5, 5), "b"), "top level");
  assert.equal(E.sellValue(g.bl[at(5, 5)]), 104, "all of it: built since the wave began");
  assert.ok(E.build(g, at(6, 5), "mirror"));
  const m = g.bl[at(6, 5)];
  const lit = E.fields(g).beams[at(6, 5)];
  assert.equal(lit.length, 1, "a lantern next to it: one beam");
  assert.ok(lit[0].length > 0);
  const d0 = m.d;
  assert.ok(E.turn(g, at(6, 5)));
  assert.equal(m.d, (d0 + 1) % 4);
  assert.ok(!E.turn(g, at(5, 5)), "only mirrors turn");
  E.callWave(g);
  assert.equal(E.sellValue(g.bl[at(5, 5)]), 72, "older: 70%");
  const c = g.coins;
  assert.ok(E.sell(g, at(5, 5)));
  assert.equal(g.coins, c + 72);
  assert.deepEqual(E.fields(g).beams[at(6, 5)], [], "no lantern next to it: no beam");
  const crate = E.newRun("q1", "n");
  assert.ok(E.build(crate, at(3, 3), "crate"));
  assert.ok(!E.upgrade(crate, at(3, 3), ""), "crates have no levels");
});

test("maze: waves come only when called; an early call pays for the shadows still out", () => {
  const g = E.newRun("q1", "n");
  E.run(g, 600);
  assert.equal(g.sh.length, 0);
  assert.equal(g.wave, 0);
  assert.ok(E.callWave(g));
  E.run(g, 200);
  assert.ok(g.sh.length > 0);
  const c = g.coins, left = E.shadowsLeft(g);
  assert.ok(left > 0);
  assert.ok(E.callWave(g));
  assert.equal(g.coins, c + left);
  assert.equal(g.wave, 2);
});

test("maze: lanterns hurt shadows in their light, veils shrug it off until torn, bells slow, glooms cost three", () => {
  const g = E.newRun("q4", "n");
  g.coins = 1000; g.wave = 1; g.wl[0] = 3;
  assert.ok(E.build(g, at(5, 5), "lantern"));
  const p = E.centre(at(5, 6));
  g.sh.push({ id: 900, k: "s", w: 0, x: p.x, y: p.y, at: at(5, 6), to: -1, hp: 100, mx: 100, sl: 0, st: 0, ar: 0 });
  g.sh.push({ id: 901, k: "v", w: 0, x: p.x, y: p.y, at: at(5, 6), to: -1, hp: 100, mx: 100, sl: 0, st: 0, ar: 1 });
  assert.ok(E.build(g, at(4, 6), "bell"));
  E.step(g);
  assert.ok(Math.abs(g.sh[0].hp - (100 - 7 / 60)) < 1e-9);
  assert.ok(Math.abs(g.sh[1].hp - (100 - 7 / 60 * 0.25)) < 1e-9, "a veil takes a quarter of steady light");
  assert.ok(g.sh.every((s) => s.st > 0 && s.sl === 0.4), "the bell slows all near it");
  const h = E.newRun("q1", "n");
  h.wave = 1; h.wl[0] = 1;
  const q = E.centre(at(5, 1));
  h.sh.push({ id: 5, k: "g", w: 0, x: q.x, y: q.y, at: at(5, 1), to: -1, hp: 999, mx: 999, sl: 0, st: 0, ar: 0 });
  E.run(h, 200);
  assert.equal(h.hearts, 17);
});

test("maze: doing nothing loses, a plain player clears the first square, the same night replays exactly", () => {
  const idle = play("q1", "n", null);
  assert.equal(idle.over, 0);
  assert.equal(idle.hearts, 0);
  assert.equal(E.stars(idle), 0);
  const a = play("q1", "m", spend), b = play("q1", "m", spend);
  assert.equal(a.over, 1, "won");
  assert.ok(E.stars(a) >= 2);
  assert.equal(J(E.saveable(a)), J(E.saveable(b)), "deterministic");
  const n = play("q1", "n", spend);
  assert.equal(n.over, 1, "Normal is beatable on the first square");
  E.SQUARES.forEach((sq) => assert.equal(play(sq.id, "m", spend).over, 1, sq.id + " is beatable on Mild"));
});

test("maze: the session copy is canonical, and anything odd is refused", () => {
  const g = E.newRun("q2", "h");
  E.build(g, at(5, 4), "lantern"); E.build(g, at(4, 10), "crate"); E.callWave(g); E.run(g, 400);
  const c = E.saveable(g);
  assert.equal(c.ev, undefined);
  assert.equal(c._f, undefined, "derived fields are never saved");
  const n = E.normalizeRun(JSON.parse(J(c)));
  assert.equal(J(E.saveable(n)), J(c));
  E.run(n, 300); E.run(g, 300);
  assert.equal(J(E.saveable(n)), J(E.saveable(g)), "a reopened night goes on the same way");
  assert.equal(E.normalizeRun(null), null);
  assert.equal(E.normalizeRun({ ...c, v: 2 }), null);
  assert.equal(E.normalizeRun({ ...c, sq: "zz" }), null);
  assert.equal(E.normalizeRun({ ...c, bl: { 0: { k: "crate", l: 1, b: "", d: 0, cd: 0, sp: 5, fr: 5 } } }), null, "not on a house");
  const lan = c.bl[at(5, 4)];
  assert.equal(E.normalizeRun({ ...c, bl: { [at(5, 4)]: { ...lan, l: 3, b: "" } } }), null, "level 3 needs a branch");
  assert.equal(E.normalizeRun({ ...c, sh: [{ k: "zz" }] }), null);
  // a saved maze that closes the way is refused
  const wall = {};
  for (let col = 1; col <= 10; col++) wall[at(col, 6)] = { k: "crate", l: 1, b: "", d: 0, cd: 0, sp: 5, fr: 5 };
  assert.equal(E.normalizeRun({ ...c, sh: [], bl: wall }), null);
});

test("maze: progress merge is a join (symmetric, idempotent, the reset stamp wins)", () => {
  const A = { ver: 1, br: 0, maps: { q1: { b: 0, s: 3, e: 0 }, q2: { b: 0, s: 1, e: 0 } },
              rows: { aaaaaa1: { b: 0, s: { n: [3, 2] }, f: 40 } } };
  const B = { ver: 1, br: 0, maps: { q2: { b: 0, s: 2, e: 0 }, bad: { b: 0, s: 3, e: 0 } },
              rows: { aaaaaa1: { b: 0, s: { n: [2, 2], h: [1, 0] }, f: 10 }, bbbbbb2: { b: 0, s: { m: [1, 1] }, f: 5 } } };
  const ab = E.merge(A, B), ba = E.merge(B, A);
  assert.equal(J(ab), J(ba));
  assert.equal(J(E.merge(ab, ab)), J(ab));
  assert.deepEqual(ab.maps, { q1: { b: 0, s: 3, e: 0 }, q2: { b: 0, s: 2, e: 0 } });
  assert.deepEqual(ab.rows.aaaaaa1, { b: 0, s: { n: [3, 2], h: [1, 0] }, f: 40 });
  const R = { ver: 1, br: 5, maps: {}, rows: {} };
  const r = E.merge(ab, R);
  assert.deepEqual([r.br, Object.keys(r.maps).length, Object.keys(r.rows).length], [5, 0, 0], "a reset drops what came before");
  assert.equal(J(E.merge(r, ab)), J(r));
  assert.equal(J(E.merge(null, undefined)), J(E.defaultData()));
});

test("maze: a night counts once per end; stars open the next square", () => {
  let d = E.defaultData();
  assert.ok(E.isOpen(d, "q1"));
  assert.ok(!E.isOpen(d, "q2"));
  const lost = play("q1", "n", null);
  d = E.record(d, "dev0001", lost, 1000);
  assert.deepEqual(d.rows.dev0001.s.n, [1, 0]);
  assert.ok(!E.isOpen(d, "q2"));
  const won = play("q1", "m", spend);
  d = E.record(d, "dev0001", won, 2000);
  assert.deepEqual(d.rows.dev0001.s.m, [1, 1]);
  assert.equal(E.starsOf(d, "q1"), E.stars(won));
  assert.ok(E.isOpen(d, "q2"));
  assert.equal(J(E.merge(d, d)), J(d), "canonical");
});
