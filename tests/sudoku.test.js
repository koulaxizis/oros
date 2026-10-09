// Pure logic of Sudoku: the solver (counting solutions), the maker
// (unique puzzles at every level), the logical grader, the hint and
// the records merge.
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

const SRC = fs.readFileSync(path.join(__dirname, "..", "sudoku/sudoku.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

// cmpStr's cut also takes isInt, the one-liner after it.
const S = (() => {
  const parts = [cut("  var DATA_VER", "  // ---------- 1.")];
  ["cmpStr", "shuffled", "solveGrid", "emptyGrid", "fullGrid", "carve", "candidates", "logicTier",
   "levelDistance", "generate", "hintCell", "normCell", "normRow", "joinCell", "joinRows",
   "mergeSudoku"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    parts.push(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function(parts.join("\n") +
    "\nreturn { LEVELS, LV_SPEC, GEN_MS, PEERS, solveGrid, fullGrid, carve, candidates, logicTier," +
    " levelDistance, generate, hintCell, mergeSudoku };")();
})();

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);
const clock = () => performance.now();
const grid = (s) => [...s.replace(/[^0-9.]/g, "")].map((c) => (c === "." ? 0 : +c));

// A valid complete grid: every row, column and box holds 1–9 once.
function validFull(g) {
  if (g.length !== 81) return false;
  for (let u = 0; u < 9; u++) {
    const r = new Set(), c = new Set(), b = new Set();
    for (let k = 0; k < 9; k++) {
      r.add(g[u * 9 + k]);
      c.add(g[k * 9 + u]);
      b.add(g[(Math.floor(u / 3) * 3 + Math.floor(k / 3)) * 9 + (u % 3) * 3 + (k % 3)]);
    }
    for (const s of [r, c, b]) if (s.size !== 9 || s.has(0)) return false;
  }
  return true;
}

// A well-known puzzle and its solution (singles are enough).
const P1 = grid("53..7.... 6..195... .98....6. 8...6...3 4..8.3..1 7...2...6 .6....28. ...419..5 ....8..79");
const S1 = grid("534678912 672195348 198342567 859761423 426853791 713924856 961537284 287419635 345286179");
// A puzzle beyond the simple solver (still unique), found by search.
const HARD = (() => {
  for (;;) {
    const p = S.carve(S.fullGrid(Math.random), 17, Math.random);
    if (S.logicTier(p).tier === 5) return p;
  }
})();

test("sudoku: the solver finds the solution and counts up to the limit", () => {
  const r = S.solveGrid(P1, 2, null);
  assert.equal(r.n, 1);
  assert.equal(J(r.sol), J(S1));
  assert.equal(S.solveGrid(S1, 2, null).n, 1);
  // an empty grid has many solutions: the count stops at the limit
  assert.equal(S.solveGrid(S.fullGrid(Math.random).map(() => 0), 2, null).n, 2);
  // a deadly rectangle: two rows, two columns, two digits, two boxes
  // (rows 0–1, columns c1/c2 of different boxes) emptied → two solutions
  let deadly = null;
  for (let c1 = 0; c1 < 9 && !deadly; c1++) for (let c2 = c1 + 1; c2 < 9 && !deadly; c2++) {
    if (Math.floor(c1 / 3) === Math.floor(c2 / 3)) continue;
    if (S1[c1] === S1[9 + c2] && S1[c2] === S1[9 + c1]) deadly = [c1, c2, 9 + c1, 9 + c2];
  }
  if (deadly) {
    const g = S1.slice();
    deadly.forEach((i) => { g[i] = 0; });
    assert.equal(S.solveGrid(g, 5, null).n, 2);
  }
  // a contradiction (two 5s in a row) has none
  const bad = P1.slice(); bad[2] = 5;
  assert.equal(S.solveGrid(bad, 2, null).n, 0);
  assert.equal(S.solveGrid(HARD, 2, null).n, 1);
});

test("sudoku: random full grids are valid", () => {
  for (let k = 0; k < 50; k++) assert.ok(validFull(S.fullGrid(Math.random)));
});

test("sudoku: carving keeps a unique solution and the givens floor", () => {
  for (let k = 0; k < 30; k++) {
    const sol = S.fullGrid(Math.random), min = [17, 30, 36][k % 3];
    const puz = S.carve(sol, min, Math.random);
    const givens = puz.filter(Boolean).length;
    assert.ok(givens >= min && givens < 81, "givens " + givens);
    for (let i = 0; i < 81; i++) if (puz[i]) assert.equal(puz[i], sol[i]);
    for (let i = 0; i < 81; i++) assert.equal(!puz[i], !puz[80 - i], "symmetric");
    const r = S.solveGrid(puz, 2, null);
    assert.equal(r.n, 1);
    assert.equal(J(r.sol), J(sol));
  }
});

test("sudoku: the logical grader is sound and grades known puzzles", () => {
  assert.equal(J(S.logicTier(P1)), J({ tier: 1, solved: true, left: 0 }));
  const h = S.logicTier(HARD);
  assert.equal(h.solved, false);
  assert.equal(h.tier, 5);
  assert.equal(S.logicTier(S1).tier, 1);
  // tiers only grow with the techniques: with fewer givens a puzzle is never easier
  for (let k = 0; k < 40; k++) {
    const sol = S.fullGrid(Math.random), puz = S.carve(sol, 17, Math.random);
    const g = S.logicTier(puz);
    assert.ok(g.tier >= 1 && g.tier <= 5);
    assert.equal(g.solved, g.tier < 5);
    // adding the solution back cell by cell never raises the tier
    const more = puz.slice();
    for (let i = 0; i < 81; i++) if (!more[i] && i % 2) more[i] = sol[i];
    assert.ok(S.logicTier(more).tier <= g.tier || g.tier === 5);
  }
});

test("sudoku: every level makes valid unique puzzles of its grade in time", () => {
  for (const lv of S.LEVELS) {
    for (let k = 0; k < 6; k++) {
      const t0 = clock();
      const p = S.generate(lv, Math.random, 3000, clock);
      const ms = clock() - t0;
      assert.ok(ms < 3500, lv + " took " + ms);
      assert.ok(validFull(p.sol));
      for (let i = 0; i < 81; i++) if (p.puz[i]) assert.equal(p.puz[i], p.sol[i]);
      const r = S.solveGrid(p.puz, 2, null);
      assert.equal(r.n, 1, lv + " unique");
      assert.equal(J(r.sol), J(p.sol));
      const g = S.logicTier(p.puz);
      assert.equal(g.tier, p.tier);
      assert.equal(S.levelDistance(lv, g.tier), 0, lv + " graded " + g.tier);
      const givens = p.puz.filter(Boolean).length;
      assert.ok(givens >= S.LV_SPEC[lv].min, lv + " givens " + givens);
    }
  }
  // Easy: singles only; Medium: locked candidates; Hard: subsets; Expert: wings
  assert.equal(J(S.LEVELS.map((lv) => S.LV_SPEC[lv].tier)), J([1, 2, 3, 4]));
  // a tiny budget still gives a valid unique puzzle (the closest found)
  const p = S.generate("x", Math.random, 0, clock);
  assert.equal(S.solveGrid(p.puz, 2, null).n, 1);
});

test("sudoku: the default budget stays well under a second", () => {
  for (const lv of S.LEVELS) {
    const t0 = clock();
    S.generate(lv, Math.random, S.GEN_MS, clock);
    assert.ok(clock() - t0 < S.GEN_MS + 250, lv);
  }
});

test("sudoku: a hint picks the selected open cell, then a mistake, then a single", () => {
  const puz = P1, sol = S1, v = puz.map(() => 0);
  const open = puz.findIndex((x) => !x);
  assert.equal(S.hintCell(puz, sol, v, open), open);
  // a given or a correct cell is not taken: the hint goes elsewhere
  const v2 = v.slice(); v2[open] = sol[open];
  const h = S.hintCell(puz, sol, v2, open);
  assert.ok(h !== open && !puz[h] && !v2[h]);
  // a wrong digit is fixed first
  const v3 = v.slice(); const w = puz.findIndex((x, i) => !x && i > 40); v3[w] = sol[w] % 9 + 1;
  assert.equal(S.hintCell(puz, sol, v3, 0), w);
  // the chosen cell is settled by a single on the board as it stands
  const cand = S.candidates(puz);
  for (let k = 0; k < 20; k++) {
    const c = S.hintCell(puz, sol, v, -1), bit = 1 << (sol[c] - 1);
    const naked = cand[c] === bit;
    const hidden = S.PEERS[c].length && [0, 1, 2].some((u) => {
      const same = (i) => (u === 0 ? Math.floor(i / 9) === Math.floor(c / 9) : u === 1 ? i % 9 === c % 9
        : Math.floor(i / 27) === Math.floor(c / 27) && Math.floor((i % 9) / 3) === Math.floor((c % 9) / 3));
      return S.PEERS[c].filter(same).every((i) => !(cand[i] & bit));
    });
    assert.ok(naked || hidden, "cell " + c);
  }
  // nothing left → -1
  assert.equal(S.hintCell(puz, sol, sol.map((d, i) => (puz[i] ? 0 : d)), -1), -1);
});

test("sudoku: records merge is a join and a reset drops older rows", () => {
  const M = S.mergeSudoku;
  const cell = () => {
    const n = 1 + rnd(9), c = rnd(n + 1);
    const t = c && rnd(3) ? (1 + rnd(4)) * 60000 : 0;
    return { t, ts: rnd(3) * 1000, n, c };
  };
  const st = () => {
    const rows = {};
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      S.LEVELS.forEach((k) => { if (rnd(2)) s[k] = cell(); });
      rows["d" + rnd(4)] = { b: rnd(3) * 100, s };
    }
    return { ver: 1, br: rnd(4) ? 0 : rnd(3) * 100, rows };
  };
  for (let i = 0; i < 5000; i++) {
    const a = st(), b = st(), c = st(), sa = J(a);
    assert.equal(J(M(a, b)), J(M(b, a)));
    const m = M(a, b);
    assert.equal(J(M(m, m)), J(m));
    assert.equal(J(M(M(a, b), c)), J(M(a, M(b, c))));
    assert.equal(J(a), sa);
  }
  const x = { rows: { d: { b: 0, s: { h: { t: 900, ts: 500, n: 3, c: 1 } } } } };
  const y = { rows: { d: { b: 0, s: { h: { t: 900, ts: 300, n: 2, c: 2 } } } } };
  const z = { rows: { d: { b: 0, s: { h: { t: 0, ts: 0, n: 7, c: 0 } } } } };
  assert.equal(J(M(x, y).rows.d.s.h), J({ t: 900, ts: 300, n: 3, c: 2 }));   // tie: the earlier one
  assert.equal(J(M(x, z).rows.d.s.h), J({ t: 900, ts: 500, n: 7, c: 1 }));   // no time never wins
  assert.equal(J(M({ rows: { d: { b: 1, s: { e: { t: 0, ts: 0, n: 1, c: 0 } } } } }, x).rows.d.s), J({ e: { t: 0, ts: 0, n: 1, c: 0 } }));   // newer epoch
  assert.equal(J(M(x, { br: 5, rows: {} }).rows), "{}");
  for (const bad of [{ t: 1, ts: 1, n: 1, c: 0 }, { t: -1, ts: 1, n: 1, c: 1 }, { t: 1, ts: 1, n: 0, c: 0 },
                     { t: 1, ts: 1, n: 1, c: 2 }, { t: 1, ts: 1, n: 1 }, { t: 1.5, ts: 1, n: 1, c: 1 }]) {
    assert.equal(J(M({ rows: { d: { b: 0, s: { e: bad } } } }, null).rows), "{}", J(bad));
  }
  assert.equal(J(M({ rows: { d: { b: 0, s: { q: { t: 1, ts: 1, n: 1, c: 1 } } } } }, null).rows), "{}");
  assert.equal(J(M(null, undefined)), J({ ver: 1, br: 0, rows: {} }));
});
