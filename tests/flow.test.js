// Pure logic of Flow Free: the random full path, the exact solution
// counter (against brute force), the generator (full cover, one
// solution), drawing rules (cut, take back, refusals), the win, the
// hint, stored-state checks and the records merge.
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
const { webcrypto } = require("crypto");

const SRC = fs.readFileSync(path.join(__dirname, "..", "flow/flow.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

// cmpStr's cut also takes isInt and randInt, the one-liners after it;
// copyPaths and minTime are one-liners, so they come in as blocks.
const F = (() => {
  const parts = [cut("  var DATA_VER", "  // ---------- 1."),
    cut("  function copyPaths(", "\n  // Pick up a line"),
    cut("  function minTime(", "\n  function joinRows(")];
  ["cmpStr", "adjacent", "neighbours", "hamiltonPath", "touches", "joins", "joined", "growPaths",
   "flowSolver", "endsOf", "countSolutions", "wiring", "divergence", "splitAt", "genJob", "genStep",
   "generate", "dotMap", "ownerOf", "isDone", "filled", "isWon", "startAt", "stepTo", "retract",
   "route", "hintPaths", "validPuzzle", "validPaths", "normCell", "normRow", "joinRows",
   "mergeFlow"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    parts.push(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function("crypto", parts.join("\n") +
    "\nreturn { SIZES, COLOURS, randInt, adjacent, neighbours, hamiltonPath, touches, growPaths," +
    " countSolutions, divergence, generate, dotMap, ownerOf, isDone, filled, isWon, startAt, stepTo," +
    " retract, route, hintPaths, validPuzzle, validPaths, mergeFlow };")(webcrypto);
})();

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);

// Brute force: every set of simple lines joining the pairs, counted
// when they fill the grid (stops at `cap`).
function brute(n, dots, cap) {
  const dm = new Array(n * n).fill(-1);
  dots.forEach(([a, b], k) => { dm[a] = k; dm[b] = k; });
  const used = new Array(n * n).fill(false);
  let count = 0, filledCells = 0;
  function line(k) {
    if (count >= cap) return;
    if (k === dots.length) { if (filledCells === n * n) count++; return; }
    const [a, b] = dots[k];
    used[a] = true; filledCells++;
    (function walk(c) {
      if (count >= cap) return;
      for (const v of F.neighbours(n, c)) {
        if (used[v]) continue;
        if (v === b) { used[v] = true; filledCells++; line(k + 1); used[v] = false; filledCells--; continue; }
        if (dm[v] >= 0) continue;
        used[v] = true; filledCells++;
        walk(v);
        used[v] = false; filledCells--;
      }
    })(a);
    used[a] = false; filledCells--;
  }
  line(0);
  return count;
}

test("flow: grid neighbours never wrap", () => {
  assert.equal(J(F.neighbours(5, 0)), J([1, 5]));
  assert.equal(J(F.neighbours(5, 4)), J([9, 3]));
  assert.equal(J(F.neighbours(5, 12)), J([7, 13, 17, 11]));
  assert.ok(F.adjacent(5, 4, 9) && !F.adjacent(5, 4, 5) && !F.adjacent(5, 0, 6));
});

test("flow: the random full path visits every cell once, step by step", () => {
  for (const n of [5, 6, 7, 8, 9]) {
    for (let k = 0; k < 10; k++) {
      const p = F.hamiltonPath(n, rnd);
      assert.equal(new Set(p).size, n * n);
      for (let i = 1; i < p.length; i++) assert.ok(F.adjacent(n, p[i - 1], p[i]));
    }
  }
  const lines = F.growPaths(7, rnd);
  assert.equal(lines.reduce((s, p) => s + p.length, 0), 49);
  for (const p of lines) if (p.length > 3) assert.ok(!F.touches(7, p), "grown line touches itself");
});

test("flow: the solution counter agrees with brute force", () => {
  let seen = { 0: 0, 1: 0, 2: 0 };
  for (let it = 0; it < 400; it++) {
    const n = it < 300 ? 4 : 5;
    let dots;
    if (it % 3 === 0) {
      // random dots anywhere: often no solution at all
      const cells = [...Array(n * n).keys()].sort(() => Math.random() - 0.5);
      const k = 2 + rnd(3);
      dots = [];
      for (let i = 0; i < k; i++) dots.push([cells[2 * i], cells[2 * i + 1]]);
    } else {
      // cut a full path in pieces: at least one solution
      const h = F.hamiltonPath(n, rnd), k = 2 + rnd(n === 4 ? 3 : 3);
      const cuts = new Set();
      while (cuts.size < k - 1) cuts.add(2 + rnd(h.length - 3));
      const at = [0, ...[...cuts].sort((a, b) => a - b), h.length];
      dots = [];
      let bad = false;
      for (let i = 0; i < k; i++) { if (at[i + 1] - at[i] < 2) bad = true; dots.push([h[at[i]], h[at[i + 1] - 1]]); }
      if (bad) continue;
    }
    const got = F.countSolutions(n, dots), want = Math.min(2, brute(n, dots, 2));
    assert.equal(got, want, n + " " + J(dots));
    seen[got]++;
  }
  assert.ok(seen[0] > 0 && seen[1] > 0 && seen[2] > 0, "every outcome seen " + J(seen));
});

test("flow: generated puzzles cover the grid and have exactly one solution", () => {
  const counts = { 5: 12, 6: 8, 7: 5, 8: 3, 9: 3 };
  for (const n of [5, 6, 7, 8, 9]) {
    for (let k = 0; k < counts[n]; k++) {
      const pz = F.generate(n, F.randInt, Date.now() + 2500);
      assert.ok(F.validPuzzle(pz), "valid " + n);
      assert.ok(pz.dots.length >= 2 && pz.dots.length <= F.COLOURS);
      for (const s of pz.sol) assert.ok(s.length >= 3, "no two-cell lines");
      assert.equal(F.countSolutions(n, pz.dots), 1, "unique " + J(pz.dots));
      assert.ok(F.isWon(pz, pz.sol), "its solution wins");
      assert.equal(F.divergence(n, pz.sol), -1);
    }
  }
});

// A 5×5 puzzle of five rows: A = row 1, B = row 2, …
const ROWS = (() => {
  const sol = [0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3, 4].map((c) => r * 5 + c));
  return { n: 5, dots: sol.map((s) => [s[0], s[4]]), sol };
})();
const empty = (pz) => pz.dots.map(() => []);

test("flow: drawing, cutting, taking back and refusals", () => {
  const pz = ROWS;
  let s = F.startAt(pz, empty(pz), 0);
  assert.equal(s.k, 0);
  assert.equal(J(s.paths[0]), J([0]));
  assert.equal(F.startAt(pz, empty(pz), 12), null, "an empty cell is not a start");
  let p = s.paths, r;
  r = F.stepTo(pz, p, 0, 5); assert.equal(r.r, "dot"); assert.equal(r.paths, p);   // B's dot
  r = F.stepTo(pz, p, 0, 2); assert.equal(r.r, "far");
  r = F.stepTo(pz, p, 0, 1); assert.equal(r.r, "ok"); p = r.paths;
  r = F.stepTo(pz, p, 0, 6); assert.equal(r.r, "ok"); p = r.paths;
  r = F.stepTo(pz, p, 0, 7); assert.equal(r.r, "ok"); p = r.paths;
  assert.equal(J(p[0]), J([0, 1, 6, 7]));
  r = F.stepTo(pz, p, 1, 6); assert.equal(r.r, "none", "line B not started");
  // B from its dot: drawing into A's cell 6 cuts A there
  s = F.startAt(pz, p, 5); p = s.paths;
  r = F.stepTo(pz, p, 1, 6); assert.equal(r.r, "cut"); p = r.paths;
  assert.equal(J(p[0]), J([0, 1]));
  assert.equal(J(p[1]), J([5, 6]));
  // taking back: step onto an own cell, or retract
  r = F.stepTo(pz, p, 1, 7); p = r.paths;
  r = F.stepTo(pz, p, 1, 8); p = r.paths;
  r = F.stepTo(pz, p, 1, 6); assert.equal(r.r, "back"); assert.equal(J(r.paths[1]), J([5, 6]));
  p = F.retract(p, 1); assert.equal(J(p[1]), J([5, 6, 7]));
  p = F.retract(F.retract(F.retract(p, 1), 1), 1); assert.equal(J(p[1]), J([5]), "the dot stays");
  // picking up a line in its middle keeps it up to there
  s = F.startAt(pz, [[0, 1, 2, 3], [], [], [], []], 2);
  assert.equal(J(s.paths[0]), J([0, 1, 2]));
  // picking up a dot starts that colour again
  s = F.startAt(pz, [[0, 1, 2, 3], [], [], [], []], 4);
  assert.equal(J(s.paths[0]), J([4]));
  // joined: no further steps
  p = [[0, 1, 2, 3], [], [], [], []];
  r = F.stepTo(pz, p, 0, 4); assert.equal(r.r, "joined"); p = r.paths;
  assert.ok(F.isDone(pz, p, 0));
  r = F.stepTo(pz, p, 0, 9); assert.equal(r.r, "done");
  // a line never passes through its own start dot again (it is a take-back)
  r = F.stepTo(pz, [[0, 1], [], [], [], []], 0, 0); assert.equal(r.r, "back");
  // inputs never change
  const before = J(p); F.stepTo(pz, p, 0, 3); F.retract(p, 0); F.startAt(pz, p, 2); assert.equal(J(p), before);
});

test("flow: route fills the cells of a fast drag", () => {
  const r = F.route(5, 0, 12);
  assert.equal(r[r.length - 1], 12);
  let prev = 0;
  for (const c of r) { assert.ok(F.adjacent(5, prev, c)); prev = c; }
  assert.equal(r.length, 4);
  assert.equal(J(F.route(5, 7, 7)), "[]");
});

test("flow: the win needs every pair joined and every cell full", () => {
  // A rings the board (dots side by side), B snakes inside.
  const A = [0, 5, 10, 15, 20, 21, 22, 23, 24, 19, 14, 9, 4, 3, 2, 1];
  const B = [6, 7, 8, 13, 12, 11, 16, 17, 18];
  const pz = { n: 5, dots: [[0, 1], [6, 18]], sol: [A, B] };
  assert.ok(F.validPuzzle(Object.assign({}, pz, { n: 5 })));
  assert.ok(F.isWon(pz, [A, B]));
  assert.ok(F.isDone(pz, [[0, 1], B], 0));
  assert.ok(!F.isWon(pz, [[0, 1], B]), "joined but not full");
  assert.equal(F.filled(pz, [[0, 1], B]), 11);
  assert.ok(!F.isWon(pz, [A, B.slice(0, 8)]), "full minus one, B open");
  assert.ok(F.isWon(pz, [A.slice().reverse(), B]), "either direction");
  assert.ok(F.isWon(ROWS, ROWS.sol));
});

test("flow: hints draw solution lines until the puzzle is solved", () => {
  for (let it = 0; it < 6; it++) {
    const pz = F.generate(6, F.randInt, Date.now() + 2500);
    // a messy start: a line drawn the wrong way through others' cells
    let paths = empty(pz), k = 0, s = F.startAt(pz, paths, pz.dots[0][0]);
    paths = s.paths;
    for (let i = 0; i < 6; i++) {
      const head = paths[0][paths[0].length - 1];
      const nb = F.neighbours(6, head).filter((c) => F.dotMap(pz)[c] < 0 && paths[0].indexOf(c) < 0);
      if (!nb.length) break;
      paths = F.stepTo(pz, paths, 0, nb[rnd(nb.length)]).paths;
    }
    assert.ok(F.validPaths(pz, paths));
    while (!F.isWon(pz, paths)) {
      const h = F.hintPaths(pz, paths);
      assert.ok(h, "a hint while unsolved");
      assert.equal(J(h.paths[h.k]), J(pz.sol[h.k]));
      assert.ok(F.validPaths(pz, h.paths));
      paths = h.paths;
      assert.ok(++k <= 40, "hints end");
    }
    assert.equal(F.hintPaths(pz, paths), null, "no hint once solved");
  }
});

test("flow: stored puzzles and lines are checked", () => {
  assert.ok(F.validPuzzle(ROWS));
  assert.ok(!F.validPuzzle(Object.assign({}, ROWS, { n: 4 })), "size we do not play");
  assert.ok(!F.validPuzzle({ n: 5, dots: ROWS.dots.slice(0, 4), sol: ROWS.sol.slice(0, 4) }), "not full");
  const jump = ROWS.sol.map((s) => s.slice()); jump[0] = [0, 2, 1, 3, 4];
  assert.ok(!F.validPuzzle({ n: 5, dots: ROWS.dots, sol: jump }), "steps must be neighbours");
  assert.ok(!F.validPuzzle(null) && !F.validPuzzle({ n: 5 }));
  assert.ok(F.validPaths(ROWS, [[0, 1], [9, 8], [], [], []]));
  assert.ok(!F.validPaths(ROWS, [[1, 2], [], [], [], []]), "must start at its dot");
  assert.ok(!F.validPaths(ROWS, [[0, 5], [], [], [], []]), "never through another dot");
  assert.ok(!F.validPaths(ROWS, [[0, 1, 6], [5, 6], [], [], []]), "no shared cell");
  assert.ok(!F.validPaths(ROWS, [[0, 1], [], []]), "one list per colour");
});

test("flow: records merge is a join and a reset drops older rows", () => {
  const M = F.mergeFlow, keys = ["5", "6", "7", "8", "9"];
  const st = () => {
    const rows = {};
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      keys.forEach((k) => {
        if (!rnd(2)) return;
        s[k] = { g: 1 + rnd(9), t: rnd(3) ? 1 + rnd(9e4) : 0 };
      });
      rows["d" + rnd(4)] = { b: rnd(3) * 100, s };
    }
    return { ver: 1, br: rnd(4) ? 0 : rnd(3) * 100, rows };
  };
  for (let i = 0; i < 5000; i++) {
    const a = st(), b = st(), c = st(), sa = J(a), sb = J(b);
    assert.equal(J(M(a, b)), J(M(b, a)));
    const m = M(a, b);
    assert.equal(J(M(m, m)), J(m));
    assert.equal(J(M(M(a, b), c)), J(M(a, M(b, c))));
    assert.equal(J(a), sa);
    assert.equal(J(b), sb);
  }
  const x = { rows: { d: { b: 0, s: { 7: { g: 4, t: 0 } } } } };
  const y = { rows: { d: { b: 0, s: { 7: { g: 3, t: 40000 } } } } };
  assert.equal(J(M(x, y).rows.d.s["7"]), J({ g: 4, t: 40000 }));   // no time yet ≠ best time 0
  assert.equal(J(M({ rows: { d: { b: 9, s: { 7: { g: 1, t: 5 } } } } }, y).rows.d), J({ b: 9, s: { 7: { g: 1, t: 5 } } }), "newer epoch wins");
  assert.equal(J(M(x, { br: 5, rows: {} }).rows), "{}");
  for (const bad of [{ g: 0, t: 1 }, { g: 1, t: -1 }, { g: 1.5, t: 0 }, { g: 1 }, { g: 1, t: 4e8 }]) {
    assert.equal(J(M({ rows: { d: { b: 0, s: { 5: bad } } } }, null).rows), "{}", J(bad));
  }
  assert.equal(J(M({ rows: { d: { b: 0, s: { 4: { g: 1, t: 1 } } } } }, null).rows), "{}", "unknown size");
  assert.equal(J(M({ rows: { d: { b: -1, s: { 5: { g: 1, t: 1 } } } } }, null).rows), "{}", "bad epoch");
});
