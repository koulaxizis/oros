// Pure logic of Mahjong: the layouts, the free-tile rule, solvable
// deals (each one solved here by an independent search), the shuffle
// that keeps a game solvable, the move list and the records merge.
// Run: node --test tests/
//
// The app is a browser IIFE with no exports, so the pure functions are
// cut out of the source by name and evaluated on their own. A renamed
// function fails here loudly ("missing function …").

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "mahjong/mahjong.js"), "utf8");

const M = (() => {
  const parts = ["var LAYS = ['turtle', 'pyramid', 'fortress'], MAX_TIME = 360000000, DATA_VER = 1;"];
  ["cmpStr", "isInt", "buildLayouts", "topology", "noneOn", "isFree", "matchGroup", "shuffleArr",
   "removalOrder", "pickTile", "facePairs", "assign", "findOrder", "deal", "reshuffle", "freePairs",
   "countOn", "normCell", "normRow", "joinCell", "joinRows", "mergeMahjong"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    parts.push(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function(parts.join("\n") +
    "\nreturn { buildLayouts, topology, isFree, matchGroup, removalOrder, deal, reshuffle, freePairs," +
    " countOn, facePairs, mergeMahjong };")();
})();

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);
// a small seeded PRNG, so every run checks the same deals
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const LAY = M.buildLayouts();
const TOPO = {};
for (const k of Object.keys(LAY)) {
  const tp = M.topology(LAY[k]);
  tp.below = tp.above.map(() => []);
  tp.above.forEach((a, i) => a.forEach((j) => tp.below[j].push(i)));
  tp.over = tp.above.map((a, i) => {
    const s = new Set(), st = [i];
    while (st.length) for (const j of tp.above[st.pop()]) if (!s.has(j)) { s.add(j); st.push(j); }
    return s;
  });
  TOPO[k] = tp;
}
const allOn = (n) => Array(n).fill(1);
const G = (f) => M.matchGroup(f);

// Independent solver (it knows nothing of how the deal was built):
// depth-first over matching free pairs with a memo of positions seen;
// the last tiles of a kind that are all free go at once; a kind whose
// last two lie one over the other is a dead end. Pairs that free the
// most tiles go first; restarts shuffle the ties. Returns the moves.
function solve(topo, faces, on0) {
  for (let r = 0; r < 400; r++) {
    const noise = r ? prng(r * 7919 + 1) : () => 0;
    const seen = new Set(), on = on0.slice(), moves = [];
    let nodes = 0;
    const rec = () => {
      if (!on.some(Boolean)) return true;
      if (++nodes > 2000) throw new Error("budget");
      const k = on.join("");
      if (seen.has(k)) return false;
      seen.add(k);
      const cnt = {}, last = {}, byG = {};
      for (let i = 0; i < topo.n; i++) if (on[i]) cnt[G(faces[i])] = (cnt[G(faces[i])] || 0) + 1;
      for (let i = 0; i < topo.n; i++) if (on[i] && cnt[G(faces[i])] === 2) (last[G(faces[i])] = last[G(faces[i])] || []).push(i);
      for (const g in last) { const [a, b] = last[g]; if (topo.over[a].has(b) || topo.over[b].has(a)) return false; }
      for (let i = 0; i < topo.n; i++) if (M.isFree(topo, on, i)) (byG[G(faces[i])] = byG[G(faces[i])] || []).push(i);
      let cand = [];
      for (const g in byG) {
        const l = byG[g];
        if (l.length === cnt[g] && l.length >= 2) { cand = [[l[0], l[1]]]; break; }
        for (let a = 0; a < l.length; a++) for (let b = a + 1; b < l.length; b++) cand.push([l[a], l[b]]);
      }
      const live = (l) => l.filter((j) => on[j]).length;
      const sc = new Map(cand.map((p) => [p, p.reduce((s, i) => s + 3 * live(topo.below[i]) + 2 * live(topo.left[i]) +
        2 * live(topo.right[i]) + 2 * topo.z[i], 0) + (cnt[G(faces[p[0]])] === 2 ? 4 : 0) + noise() * 10]));
      cand.sort((x, y) => sc.get(y) - sc.get(x));
      for (const [a, b] of cand) {
        on[a] = 0; on[b] = 0; moves.push([a, b]);
        if (rec()) return true;
        on[a] = 1; on[b] = 1; moves.pop();
      }
      return false;
    };
    try { if (rec()) return moves; return null; } catch (e) { /* next restart */ }
  }
  return null;
}

// Replays moves on a board: each pair must be free and matching.
function replay(topo, faces, on0, moves) {
  const on = on0.slice();
  for (const [a, b] of moves) {
    assert.ok(a !== b && M.isFree(topo, on, a) && M.isFree(topo, on, b), "pair not free " + a + "," + b);
    assert.equal(G(faces[a]), G(faces[b]), "pair does not match");
    on[a] = 0; on[b] = 0;
  }
  assert.equal(M.countOn(on), 0);
}

test("mahjong: layouts are sound (sizes, no overlaps, every tile rests on another)", () => {
  assert.equal(LAY.turtle.length, 144);
  assert.equal(LAY.pyramid.length, 82);
  assert.equal(LAY.fortress.length, 70);
  for (const k of Object.keys(LAY)) {
    const pos = LAY[k];
    assert.equal(pos.length % 2, 0);
    for (let i = 0; i < pos.length; i++) {
      const p = pos[i];
      assert.ok(p[0] >= 0 && p[1] >= 0 && p[2] >= 0, k + " " + J(p));
      for (let j = i + 1; j < pos.length; j++) {
        const q = pos[j];
        assert.ok(!(q[2] === p[2] && Math.abs(q[0] - p[0]) < 2 && Math.abs(q[1] - p[1]) < 2), k + " overlap " + J(p) + J(q));
      }
      if (p[2] > 0) {
        assert.ok(pos.some((q) => q[2] === p[2] - 1 && Math.abs(q[0] - p[0]) < 2 && Math.abs(q[1] - p[1]) < 2), k + " floats " + J(p));
      }
    }
  }
  // the classic turtle: 87 + 36 + 16 + 4 + 1
  assert.equal(J([0, 1, 2, 3, 4].map((z) => LAY.turtle.filter((p) => p[2] === z).length)), J([87, 36, 16, 4, 1]));
});

test("mahjong: free = nothing on top and an open left or right side", () => {
  // a row of three, a tile on the right one, a half-offset neighbour
  const pos = [[0, 0, 0], [2, 0, 0], [4, 0, 0], [4, 0, 1], [6, 1, 0], [10, 0, 0]];
  const tp = M.topology(pos), on = allOn(pos.length);
  assert.equal(J(tp.above[2]), J([3]));
  assert.equal(J(tp.right[2]), J([4]));                 // half a tile lower still touches
  assert.equal(J(tp.left[4]), J([2]));
  const free = (o) => pos.map((p, i) => M.isFree(tp, o, i) ? 1 : 0).join("");
  assert.equal(free(on), "100111");                      // middle blocked both sides, 2 covered
  on[3] = 0;
  assert.equal(free(on), "100011");                      // 2 uncovered but boxed in by 1 and 4
  on[4] = 0;
  assert.equal(free(on), "101001");
  on[0] = 0;
  assert.equal(free(on), "011001");
  // a tile that is off is never free
  assert.equal(M.isFree(tp, on, 0), false);
  // the full turtle: the top tile, ends of the open rows, the outer singles
  const tt = TOPO.turtle, ton = allOn(144);
  const fr = LAY.turtle.filter((p, i) => M.isFree(tt, ton, i));
  assert.equal(fr.length, 35);
  assert.ok(fr.some((p) => p[2] === 4));
  assert.ok(fr.some((p) => p[0] === 0 && p[1] === 7) && fr.some((p) => p[0] === 28) && !fr.some((p) => p[0] === 26));
  assert.ok(!fr.some((p) => p[2] === 3));
});

test("mahjong: flowers match flowers, seasons match seasons", () => {
  assert.equal(G(5), 5);
  assert.equal(G(33), 33);
  assert.equal(G(34), G(37));
  assert.equal(G(38), G(41));
  assert.notEqual(G(37), G(38));
  const pairs = M.facePairs(prng(1));
  assert.equal(pairs.length, 72);
  const all = pairs.flat().sort((a, b) => a - b);
  const want = [];
  for (let f = 0; f < 34; f++) want.push(f, f, f, f);
  for (let f = 34; f < 42; f++) want.push(f);
  assert.equal(J(all), J(want));
  for (const [a, b] of pairs) assert.equal(G(a), G(b));
});

for (const [k, count] of [["fortress", 120], ["pyramid", 120], ["turtle", 40]]) {
  test(`mahjong: ${k} deals are solvable (solved by an independent search)`, () => {
    const tp = TOPO[k];
    for (let s = 0; s < count; s++) {
      const faces = M.deal(tp, prng(1000 + s));
      assert.equal(faces.length, tp.n);
      const cnt = {};
      faces.forEach((f) => { assert.ok(f >= 0 && f < 42); cnt[G(f)] = (cnt[G(f)] || 0) + 1; });
      Object.values(cnt).forEach((c) => assert.equal(c % 2, 0));
      if (k === "turtle") {                      // the full set, each face exactly as often as in a real set
        const by = {};
        faces.forEach((f) => { by[f] = (by[f] || 0) + 1; });
        for (let f = 0; f < 42; f++) assert.equal(by[f], f < 34 ? 4 : 1);
      }
      const moves = solve(tp, faces, allOn(tp.n));
      assert.ok(moves, k + " deal " + s + " not solved");
      replay(tp, faces, allOn(tp.n), moves);
    }
  });
}

test("mahjong: shuffle keeps the tiles and stays solvable", () => {
  let shuffled = 0, refused = 0;
  for (const k of ["fortress", "pyramid", "turtle"]) {
    const tp = TOPO[k];
    for (let s = 0; s < (k === "turtle" ? 20 : 40); s++) {
      const r = prng(5000 + s);
      const faces = M.deal(tp, r), on = allOn(tp.n);
      // random play: take random matching free pairs (it may dead-end)
      const steps = Math.floor(r() * tp.n / 2);
      for (let i = 0; i < steps; i++) {
        const ps = M.freePairs(tp, faces, on);
        if (!ps.length) break;
        const [a, b] = ps[Math.floor(r() * ps.length)];
        on[a] = 0; on[b] = 0;
      }
      if (!M.countOn(on)) continue;
      const nf = M.reshuffle(tp, faces, on, r);
      if (!nf) { refused++; continue; }
      shuffled++;
      const keep = (f) => f.filter((x, i) => on[i]).map(G).sort((a, b) => a - b);
      assert.equal(J(keep(nf)), J(keep(faces)));            // same tiles (per kind)
      for (let i = 0; i < tp.n; i++) if (!on[i]) assert.equal(nf[i], faces[i]);
      const moves = solve(tp, nf, on);
      assert.ok(moves, k + " shuffle " + s + " not solved");
      replay(tp, nf, on, moves);
    }
  }
  assert.ok(shuffled > 60, "shuffled " + shuffled + ", refused " + refused);
  // a position no shuffle can save: one tile lying on the only other one
  const tp = M.topology([[0, 0, 0], [0, 0, 1]]);
  assert.equal(M.reshuffle(tp, [3, 3], [1, 1], prng(1)), null);
});

test("mahjong: the move list finds every matching free pair", () => {
  const pos = [[0, 0, 0], [2, 0, 0], [4, 0, 0], [8, 0, 0], [12, 0, 0], [16, 0, 0]];
  const tp = M.topology(pos);
  // 0 and 2 are free row ends, 1 is boxed in; 3, 4, 5 stand alone
  assert.equal(J(M.freePairs(tp, [7, 7, 7, 34, 37, 38], allOn(6)).sort()), J([[0, 2], [3, 4]]));
  assert.equal(J(M.freePairs(tp, [1, 2, 3, 4, 5, 6], allOn(6))), "[]");
});

test("mahjong: records merge is a join and a reset drops older rows", () => {
  const Mg = M.mergeMahjong, keys = ["turtle", "pyramid", "fortress"];
  const st = () => {
    const rows = {};
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      keys.forEach((k) => { if (rnd(2)) s[k] = { t: 1000 + rnd(30) * 1000, ts: rnd(3) * 1000, w: 1 + rnd(9) }; });
      rows["d" + rnd(4)] = { b: rnd(3) * 100, s };
    }
    return { ver: 1, br: rnd(4) ? 0 : rnd(3) * 100, rows };
  };
  for (let i = 0; i < 5000; i++) {
    const a = st(), b = st(), c = st(), sa = J(a);
    assert.equal(J(Mg(a, b)), J(Mg(b, a)));
    const m = Mg(a, b);
    assert.equal(J(Mg(m, m)), J(m));
    assert.equal(J(Mg(Mg(a, b), c)), J(Mg(a, Mg(b, c))));
    assert.equal(J(a), sa);
  }
  const x = { rows: { d: { b: 0, s: { turtle: { t: 90000, ts: 500, w: 3 } } } } };
  const y = { rows: { d: { b: 0, s: { turtle: { t: 90000, ts: 300, w: 2 }, fortress: { t: 5000, ts: 1, w: 1 } } } } };
  assert.equal(J(Mg(x, y).rows.d.s.turtle), J({ t: 90000, ts: 300, w: 3 }));   // tie: the earlier one
  assert.equal(J(Mg(x, { rows: { d: { b: 0, s: { turtle: { t: 80000, ts: 900, w: 1 } } } } }).rows.d.s.turtle),
    J({ t: 80000, ts: 900, w: 3 }));                                              // the faster time wins
  assert.equal(J(Mg(x, { rows: { d: { b: 1, s: { pyramid: { t: 1, ts: 1, w: 1 } } } } }).rows.d.s), J({ pyramid: { t: 1, ts: 1, w: 1 } }));
  assert.equal(J(Mg(x, { br: 5, rows: {} }).rows), "{}");
  for (const bad of [{ t: 0, ts: 1, w: 1 }, { t: 5, ts: -1, w: 1 }, { t: 5, ts: 1, w: 0 }, { t: 5, ts: 1 }, { t: 1.5, ts: 1, w: 1 }, { t: 4e8, ts: 1, w: 1 }]) {
    assert.equal(J(Mg({ rows: { d: { b: 0, s: { turtle: bad } } } }, null).rows), "{}", J(bad));
  }
  assert.equal(J(Mg({ rows: { d: { b: 0, s: { klondike: { t: 5, ts: 1, w: 1 } } } } }, null).rows), "{}");
});
