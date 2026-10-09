// Pure logic of Minesweeper: mines laid after the first click (never
// in the 3×3 around it, exact count), numbers, flood fill, chord, win
// detection, the turned Expert view and the records merge.
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

const SRC = fs.readFileSync(path.join(__dirname, "..", "minesweeper/minesweeper.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

// cmpStr's cut also takes isInt, the one-liner after it.
const M = (() => {
  const parts = [cut("  var DATA_VER", "  // ---------- 1.")];
  ["cmpStr", "neighbors", "layMines", "numbersOf", "openFrom", "chordAt", "isWon", "viewToCell",
   "normCell", "normRow", "joinCell", "joinRows", "mergeMinesweeper"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    parts.push(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function(parts.join("\n") +
    "\nreturn { LEVELS, LV, neighbors, layMines, numbersOf, openFrom, chordAt, isWon, viewToCell," +
    " mergeMinesweeper };")();
})();

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);
// A board from a picture: * mine, anything else safe.
function board(rowsTxt) {
  const rows = rowsTxt.length, cols = rowsTxt[0].length;
  const mines = [...rowsTxt.join("")].map((c) => (c === "*" ? 1 : 0));
  return { rows, cols, mines, nums: M.numbersOf(mines, rows, cols), st: mines.map(() => 0) };
}

test("minesweeper: levels are the classic sizes", () => {
  assert.equal(J(M.LV), J({ b: { rows: 9, cols: 9, mines: 10 }, i: { rows: 16, cols: 16, mines: 40 }, e: { rows: 16, cols: 30, mines: 99 } }));
});

test("minesweeper: mines keep the count and never touch the first click", () => {
  for (const lv of M.LEVELS) {
    const { rows, cols, mines: count } = M.LV[lv];
    for (let k = 0; k < 400; k++) {
      const safe = rnd(rows * cols);
      const m = M.layMines(rows, cols, count, safe, Math.random);
      assert.equal(m.length, rows * cols);
      assert.equal(m.reduce((a, b) => a + b, 0), count);
      assert.equal(m[safe], 0);
      for (const j of M.neighbors(rows, cols, safe)) assert.equal(m[j], 0);
      // the first click opens an area: its number is 0
      assert.equal(M.numbersOf(m, rows, cols)[safe], 0);
    }
  }
  // every non-protected cell can hold a mine (no bias to a corner)
  const seen = new Set();
  for (let k = 0; k < 300; k++) M.layMines(9, 9, 10, 40, Math.random).forEach((v, i) => { if (v) seen.add(i); });
  assert.equal(seen.size, 81 - 9);
});

test("minesweeper: neighbours and numbers", () => {
  assert.equal(J(M.neighbors(3, 3, 0).sort()), J([1, 3, 4]));
  assert.equal(M.neighbors(3, 3, 4).length, 8);
  assert.equal(M.neighbors(16, 30, 29).length, 3);
  const b = board(["*..", ".*.", "..."]);
  assert.equal(J(b.nums), J([1, 2, 1, 2, 1, 1, 1, 1, 1]));
});

test("minesweeper: flood fill opens the empty area and its border, never a flag", () => {
  const b = board([
    "....*",
    "....*",
    "...**",
    "*....",
  ]);
  b.st[2] = 2;                                            // a flag in the way
  const opened = M.openFrom(b.st, b.mines, b.nums, b.rows, b.cols, 0);
  assert.ok(opened.includes(0));
  assert.equal(b.st[2], 2, "flag kept");
  assert.equal(b.st[4], 0, "no mine opened");
  for (let i = 0; i < 20; i++) if (b.st[i] === 1) assert.equal(b.mines[i], 0);
  // every open cell with a 0 has all its (unflagged) neighbours open
  for (let i = 0; i < 20; i++) {
    if (b.st[i] !== 1 || b.nums[i]) continue;
    for (const j of M.neighbors(b.rows, b.cols, i)) assert.ok(b.st[j] !== 0, "neighbour " + j + " of " + i);
  }
  // a number opens only itself; an open cell opens nothing
  const c = board(["*..", "...", "..."]);
  assert.equal(J(M.openFrom(c.st, c.mines, c.nums, 3, 3, 1)), "[1]");
  assert.equal(J(M.openFrom(c.st, c.mines, c.nums, 3, 3, 1)), "[]");
  // random boards: the flood equals a reference BFS
  for (let k = 0; k < 300; k++) {
    const rows = 4 + rnd(10), cols = 4 + rnd(10), mines = Array.from({ length: rows * cols }, () => (rnd(6) ? 0 : 1));
    const nums = M.numbersOf(mines, rows, cols), st = mines.map(() => 0);
    const start = mines.findIndex((v) => !v);
    if (start < 0) continue;
    M.openFrom(st, mines, nums, rows, cols, start);
    const want = new Set([start]), q = [start];
    while (q.length) {
      const x = q.shift();
      if (nums[x]) continue;
      for (const y of M.neighbors(rows, cols, x)) if (!want.has(y)) { want.add(y); q.push(y); }
    }
    assert.equal(J(st.map((v, i) => (v === 1 ? i : -1)).filter((i) => i >= 0)), J([...want].sort((a, b) => a - b)));
  }
});

test("minesweeper: chord opens the rest when the flags match, a wrong flag explodes", () => {
  const b = board(["*..", "...", "..."]);
  b.st[4] = 1;                                            // the centre shows 1
  assert.equal(M.chordAt(b.st, b.mines, b.nums, 3, 3, 4).ok, false);   // no flag yet
  b.st[0] = 2;
  const r = M.chordAt(b.st, b.mines, b.nums, 3, 3, 4);
  assert.ok(r.ok);
  assert.equal(r.boom, -1);
  assert.ok(M.isWon(b.st, b.mines));
  // flag on the wrong cell → the mine opens
  const c = board(["*..", "...", "..."]);
  c.st[4] = 1; c.st[1] = 2;
  const w = M.chordAt(c.st, c.mines, c.nums, 3, 3, 4);
  assert.ok(w.ok);
  assert.equal(w.boom, 0);
  // too many flags, a closed cell or a 0 → nothing
  const d = board(["*..", "...", "..."]);
  d.st[4] = 1; d.st[0] = 2; d.st[1] = 2;
  assert.equal(M.chordAt(d.st, d.mines, d.nums, 3, 3, 4).ok, false);
  assert.equal(M.chordAt(d.st, d.mines, d.nums, 3, 3, 8).ok, false);
  const e = board(["...", "...", "..*"]);
  e.st[0] = 1;
  assert.equal(M.chordAt(e.st, e.mines, e.nums, 3, 3, 0).ok, false);
});

test("minesweeper: won exactly when every safe cell is open; flags are optional", () => {
  const b = board(["*.", ".."]);
  assert.equal(M.isWon(b.st, b.mines), false);
  b.st = [0, 1, 1, 1];
  assert.equal(M.isWon(b.st, b.mines), true);
  b.st = [2, 1, 1, 0];
  assert.equal(M.isWon(b.st, b.mines), false);
  // a random game played by an oracle always ends won, never opening a mine
  for (let k = 0; k < 50; k++) {
    const { rows, cols, mines: count } = M.LV[M.LEVELS[k % 3]];
    const first = rnd(rows * cols);
    const mines = M.layMines(rows, cols, count, first, Math.random), nums = M.numbersOf(mines, rows, cols);
    const st = mines.map(() => 0);
    const opened = M.openFrom(st, mines, nums, rows, cols, first);
    assert.ok(opened.length >= 1 + M.neighbors(rows, cols, first).length, "first click opens an area: " + opened.length);
    for (let i = 0; i < st.length && !M.isWon(st, mines); i++) if (!mines[i] && !st[i]) M.openFrom(st, mines, nums, rows, cols, i);
    assert.ok(M.isWon(st, mines));
    assert.ok(st.every((v, i) => !(v === 1 && mines[i])));
  }
});

test("minesweeper: the turned Expert view maps every cell once", () => {
  const { rows, cols } = M.LV.e, seen = new Set();
  for (let vr = 0; vr < cols; vr++) for (let vc = 0; vc < rows; vc++) {
    const i = M.viewToCell(vr, vc, cols, true);
    assert.equal(Math.floor(i / cols), vc);
    assert.equal(i % cols, vr);
    seen.add(i);
  }
  assert.equal(seen.size, rows * cols);
  assert.equal(M.viewToCell(2, 3, cols, false), 2 * cols + 3);
});

test("minesweeper: records merge is a join and a reset drops older rows", () => {
  const Mg = M.mergeMinesweeper;
  const cell = () => {
    const g = 1 + rnd(9), w = rnd(g + 1);
    return { t: w ? (1 + rnd(4)) * 10000 : 0, ts: rnd(3) * 1000, w, g };
  };
  const st = () => {
    const rows = {};
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      M.LEVELS.forEach((k) => { if (rnd(2)) s[k] = cell(); });
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
  const x = { rows: { d: { b: 0, s: { e: { t: 90000, ts: 500, w: 1, g: 4 } } } } };
  const y = { rows: { d: { b: 0, s: { e: { t: 0, ts: 0, w: 0, g: 6 } } } } };
  assert.equal(J(Mg(x, y).rows.d.s.e), J({ t: 90000, ts: 500, w: 1, g: 6 }));
  assert.equal(J(Mg(x, { br: 5, rows: {} }).rows), "{}");
  for (const bad of [{ t: 1, ts: 1, w: 0, g: 1 }, { t: 0, ts: 1, w: 1, g: 1 }, { t: 1, ts: 1, w: 2, g: 1 }, { t: 1, ts: 1, w: 1, g: 0 }, { t: 1, ts: 1, w: 1 }]) {
    assert.equal(J(Mg({ rows: { d: { b: 0, s: { b: bad } } } }, null).rows), "{}", J(bad));
  }
});
