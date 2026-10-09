// Pure logic of Nonogram: clues, the line solver, the puzzle maker
// (every puzzle solvable by line logic alone), the hint, the solved
// check and the records merge.
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

const SRC = fs.readFileSync(path.join(__dirname, "..", "nonogram/nonogram.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

// cmpStr's cut also takes isInt, the one-liner after it.
const N = (() => {
  const parts = [cut("  var DATA_VER", "  // ---------- 1.")];
  ["cmpStr", "runsOf", "rowOf", "colOf", "cluesOf", "sameRuns", "solveLine", "lineSolve",
   "solvedByLines", "picture", "fillShare", "makePuzzle", "hintCell", "isSolved",
   "normCell", "normRow", "joinCell", "joinRows", "mergeNonogram"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    parts.push(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function(parts.join("\n") +
    "\nreturn { SIZES, KEYS, GEN_MS, runsOf, cluesOf, solveLine, lineSolve, solvedByLines, picture," +
    " makePuzzle, hintCell, isSolved, mergeNonogram };")();
})();

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);
const clock = () => performance.now();
const line = (s) => [...s].map((c) => (c === "#" ? 1 : c === "." ? 0 : -1));

// Every placement of the runs in n cells (brute force).
function placements(clue, n) {
  const out = [];
  const rec = (j, at, acc) => {
    if (j === clue.length) { out.push(acc.concat(Array(n - acc.length).fill(0))); return; }
    for (let s = at; s + clue[j] <= n; s++) {
      const next = acc.concat(Array(s - acc.length).fill(0), Array(clue[j]).fill(1));
      if (j < clue.length - 1) next.push(0);
      if (next.length <= n) rec(j + 1, next.length, next);
    }
  };
  rec(0, 0, []);
  return out;
}

test("nonogram: clues are the runs of each row and column", () => {
  assert.equal(J(N.runsOf([1, 1, 1, 0, 1])), "[3,1]");
  assert.equal(J(N.runsOf([0, 0, 0])), "[]");
  assert.equal(J(N.runsOf([1, 0, 0, 1, 1])), "[1,2]");
  const pic = [1, 1, 0,
               0, 1, 0,
               1, 0, 1];
  assert.equal(J(N.cluesOf(pic, 3)), J({ rows: [[2], [1], [1, 1]], cols: [[1, 1], [2], [1]] }));
});

test("nonogram: the line solver settles exactly what every placement agrees on", () => {
  assert.equal(J(N.solveLine([5], line("?????"))), J(line("#####")));
  assert.equal(J(N.solveLine([3], line("?????"))), J(line("??#??")));
  assert.equal(J(N.solveLine([], line("???"))), J(line("...")));
  assert.equal(J(N.solveLine([1, 1], line("???"))), J(line("#.#")));
  assert.equal(J(N.solveLine([2], line("#????"))), J(line("##...")));
  assert.equal(N.solveLine([3], line("#.###")), null);
  assert.equal(N.solveLine([1], line("##???")), null);
  // brute force on random clues and partial knowledge
  for (let k = 0; k < 4000; k++) {
    const n = 1 + rnd(12), truth = Array.from({ length: n }, () => rnd(2));
    const clue = N.runsOf(truth);
    const known = truth.map((v) => (rnd(3) ? -1 : v));
    if (rnd(5) === 0) known[rnd(n)] = rnd(2);                 // sometimes a contradiction
    const fits = placements(clue, n).filter((p) => p.every((v, i) => known[i] < 0 || known[i] === v));
    const res = N.solveLine(clue, known);
    if (!fits.length) { assert.equal(res, null, J([clue, known])); continue; }
    const want = known.map((_, i) => (fits.every((p) => p[i] === 1) ? 1 : fits.every((p) => p[i] === 0) ? 0 : -1));
    assert.equal(J(res), J(want), J([clue, known]));
  }
});

test("nonogram: line logic solves easy grids and stops when a guess is needed", () => {
  // a plus sign: lines alone
  const plus = [0, 1, 0, 1, 1, 1, 0, 1, 0];
  assert.ok(N.solvedByLines(plus, 3));
  // two diagonals: rows/cols all [1] — two solutions, no line settles anything
  const diag = [1, 0, 0, 1];
  assert.equal(N.solvedByLines(diag, 2), false);
  assert.equal(J(N.lineSolve(N.cluesOf(diag, 2), 2)), J([-1, -1, -1, -1]));
  // impossible clues give null
  assert.equal(N.lineSolve({ rows: [[2], [0]].map((x) => x.filter(Boolean)), cols: [[], []] }, 2), null);
});

test("nonogram: made puzzles are solvable by lines alone and keep their clues", () => {
  for (const n of N.SIZES) {
    for (let k = 0; k < 25; k++) {
      const t0 = clock();
      const p = N.makePuzzle(n, Math.random, N.GEN_MS, clock);
      assert.ok(clock() - t0 < 1500, n + " took " + (clock() - t0));
      assert.equal(p.pic.length, n * n);
      assert.ok(p.pic.every((v) => v === 0 || v === 1));
      const clues = N.cluesOf(p.pic, n);
      const g = N.lineSolve(clues, n);
      assert.equal(J(g), J(p.pic), "line solver reaches the picture");
      assert.ok(N.isSolved(clues, p.pic, n));
      const share = p.pic.reduce((a, b) => a + b, 0) / (n * n);
      assert.ok(share >= 0.4 && share <= 0.7, "fill share " + share);
    }
  }
  // even with no budget left the maker ends with a fair puzzle
  const p = N.makePuzzle(15, Math.random, -1, clock);
  assert.ok(N.solvedByLines(p.pic, 15));
});

test("nonogram: solved means every clue matches, marks do not matter", () => {
  const pic = [1, 1, 0, 0, 1, 0, 1, 0, 1], clues = N.cluesOf(pic, 3);
  assert.ok(N.isSolved(clues, pic, 3));
  assert.ok(N.isSolved(clues, pic.map((v) => (v ? 1 : 2)), 3));     // ✕ on every empty cell
  assert.ok(!N.isSolved(clues, [1, 1, 0, 0, 1, 0, 1, 0, 0], 3));
  assert.ok(!N.isSolved(clues, [1, 1, 1, 0, 1, 0, 1, 0, 1], 3));
});

test("nonogram: a hint fixes the cursor, then a wrong fill, then a missing fill", () => {
  const pic = [1, 0, 1, 0], r0 = () => 0;
  assert.equal(J(N.hintCell(pic, [0, 0, 0, 0], 2, r0)), J({ i: 2, s: 1 }));
  assert.equal(J(N.hintCell(pic, [0, 1, 0, 0], 2, r0)), J({ i: 2, s: 1 }));
  assert.equal(J(N.hintCell(pic, [1, 1, 0, 0], 0, r0)), J({ i: 1, s: 2 }));      // wrong fill first
  assert.equal(J(N.hintCell(pic, [1, 2, 0, 2], 0, r0)), J({ i: 2, s: 1 }));
  assert.equal(J(N.hintCell(pic, [0, 1, 1, 0], 1, r0)), J({ i: 1, s: 2 }));      // the cursor is wrong
  assert.equal(N.hintCell(pic, [1, 2, 1, 0], 3, r0), null);                       // nothing to fix
});

test("nonogram: records merge is a join and a reset drops older rows", () => {
  const M = N.mergeNonogram;
  const cell = () => {
    const n = 1 + rnd(9), c = rnd(n + 1);
    return { t: c && rnd(3) ? (1 + rnd(4)) * 60000 : 0, ts: rnd(3) * 1000, n, c };
  };
  const st = () => {
    const rows = {};
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      N.KEYS.forEach((k) => { if (rnd(2)) s[k] = cell(); });
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
  const x = { rows: { d: { b: 0, s: { n10: { t: 900, ts: 500, n: 3, c: 1 } } } } };
  const y = { rows: { d: { b: 0, s: { n10: { t: 700, ts: 900, n: 2, c: 2 } } } } };
  assert.equal(J(M(x, y).rows.d.s.n10), J({ t: 700, ts: 900, n: 3, c: 2 }));
  assert.equal(J(M(x, { br: 5, rows: {} }).rows), "{}");
  for (const bad of [{ t: 1, ts: 1, n: 1, c: 0 }, { t: 1, ts: 1, n: 0, c: 0 }, { t: 1, ts: 1, n: 1, c: 2 }, { t: 1, ts: -1, n: 1, c: 1 }]) {
    assert.equal(J(M({ rows: { d: { b: 0, s: { n5: bad } } } }, null).rows), "{}", J(bad));
  }
  assert.equal(J(M({ rows: { d: { b: 0, s: { n7: { t: 1, ts: 1, n: 1, c: 1 } } } } }, null).rows), "{}");
});
