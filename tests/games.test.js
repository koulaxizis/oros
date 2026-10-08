// Pure logic of the Games apps: merge functions (Memory, Connect 4,
// Dots & Boxes, Tic-Tac-Toe), Connect 4 and Tic-Tac-Toe win
// detection, Dots & Boxes rules and the computer players.
// Run: node --test tests/
//
// The apps are browser IIFEs with no exports, so the pure functions
// are cut out of the source by name and evaluated on their own. A
// renamed function fails here loudly ("missing function …").

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { webcrypto } = require("crypto");

function load(file, names, preludes, ret) {
  const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const parts = preludes.map(([from, to]) => {
    const i = src.indexOf(from), j = src.indexOf(to, i);
    if (i < 0 || j < 0) throw new Error("missing block " + from);
    return src.slice(i, j);
  });
  names.forEach((name) => {
    const i = src.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    parts.push(src.slice(i, src.indexOf("\n  }\n", i) + 4));
  });
  return new Function("crypto", "performance", "window",
    parts.join("\n") + "\nreturn {" + ret + "};")(webcrypto, performance, { performance });
}

const C4 = load("connect4/connect4.js",
  ["cmpStr", "isInt", "now", "randInt", "emptyBoard", "lineAt", "wins", "replay",
   "evaluate", "Abort", "negamax", "rootScores", "pickBest", "chooseMove",
   "normRow", "joinRows", "mergeConnect4"],
  [["  var DATA_VER", "  // ---------- 1."], ["  var DIRS", "  function lineAt("],
   ["  var WINDOWS", "  function evaluate("], ["  var WIN_SCORE", "  function Abort("]],
  "replay, chooseMove, mergeConnect4, lineAt");

const MM = load("memory/memory.js",
  ["cmpStr", "isInt", "normBest", "normGame", "better", "gameCmp", "mergeMemory"],
  [["  var DATA_VER", "  var MISS_DELAY"], ["  var LEVELS", "  // ---------- 1."]],
  "mergeMemory");

// cmpStr's cut also takes isInt and randInt, the one-liners after it.
const DB = load("dots/dots.js",
  ["cmpStr", "geo", "sideCounts", "replay", "closingLines",
   "safeLines", "boxesGiven", "cheapestGift", "doubleDeal", "longestChainLeft", "chooseLine",
   "normRow", "joinRows", "mergeDots"],
  [["  var DATA_VER", "  function appLang("], ["  function pick(", "  // BOOT MARKER"], ["  var GEO", "  function geo("],
   ["  var KEYS", "  var data ="]],
  "geo, sideCounts, replay, safeLines, closingLines, doubleDeal, chooseLine, mergeDots");

const TT = load("tictactoe/tictactoe.js",
  ["cmpStr", "lineAt", "replay", "freeCells", "winningCells", "minimax", "chooseMove",
   "normRow", "joinRows", "mergeTicTacToe"],
  [["  var DATA_VER", "  // ---------- 1."], ["  var LINES", "  function lineAt("]],
  "replay, chooseMove, winningCells, mergeTicTacToe");

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);
const COLS = [0, 1, 2, 3, 4, 5, 6];

// Would player p win by dropping in column c of board b?
function winsWith(b, c, p) {
  if (b.h[c] >= 6) return false;
  const cells = b.cells.slice();
  cells[c * 6 + b.h[c]] = p;
  return !!C4.lineAt(cells, c, b.h[c], p);
}

test("connect4: four in a row in every direction, edges included", () => {
  assert.equal(C4.replay([0, 0, 1, 1, 2, 2, 3], 1).win.length, 4);           // horizontal
  assert.equal(C4.replay([6, 0, 6, 0, 6, 0, 6], 1).win.length, 4);           // vertical, right edge
  assert.ok(C4.replay([0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3], 1).win);           // diagonal /
  assert.ok(C4.replay([6, 5, 5, 4, 4, 3, 4, 3, 3, 0, 3], 1).win);           // diagonal \
  assert.equal(C4.replay([0, 1, 2, 3, 4, 5, 6], 1).win, null);              // alternating row
  const five = C4.replay([0, 0, 1, 1, 3, 3, 4, 4, 2], 1);                   // the middle disc joins 5
  assert.equal(five.win.length, 5);
});

test("connect4: the computer takes a win and blocks a single threat", () => {
  for (const lv of ["m", "h"]) {
    for (let k = 0; k < 40; k++) {
      let moves, b;
      do {
        moves = [];
        b = C4.replay([], 1);
        const n = 4 + rnd(20);
        for (let i = 0; i < n && !b.win; i++) {
          const legal = COLS.filter((c) => b.h[c] < 6);
          moves.push(legal[rnd(legal.length)]);
          b = C4.replay(moves, 1);
        }
      } while (b.win || b.full);
      const p = b.next, o = 3 - p;
      const winning = COLS.filter((c) => winsWith(b, c, p));
      const threats = COLS.filter((c) => winsWith(b, c, o));
      const m = C4.chooseMove(b, p, lv);
      if (winning.length) {
        assert.ok(winning.includes(m), lv + " misses a win in " + J(moves));
      } else if (threats.length === 1 && m !== threats[0]) {
        // Skipping the block is only acceptable when blocking loses anyway.
        const after = C4.replay(moves.concat([threats[0]]), 1);
        assert.ok(COLS.some((c) => winsWith(after, c, o)), lv + " fails to block in " + J(moves));
      }
    }
  }
  assert.equal(C4.chooseMove(C4.replay([0, 6, 1, 6, 2, 5], 1), 1, "e"), 3);  // easy takes a win
});

test("connect4: records merge is a join and a reset drops older rows", () => {
  const M = C4.mergeConnect4;
  const st = () => {
    const rows = {};
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      ["e", "m", "h"].forEach((l) => { if (rnd(2)) s[l] = [rnd(5), rnd(5), rnd(5)]; });
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
    assert.equal(J(a), sa);                                                // inputs untouched
  }
  const reset = M({ br: 0, rows: { x: { b: 0, s: { e: [3, 0, 0] } } } }, { br: 50, rows: {} });
  assert.equal(J(reset.rows), "{}");
});

test("memory: merge is symmetric and idempotent; a reset keeps later games", () => {
  const M = MM.mergeMemory, lv = ["e", "m", "h", "x"];
  let G = {};
  const game = (id) => G[id] || (G[id] = (() => {
    const g = { id, ts: 1000 + rnd(500), lv: lv[rnd(4)], mode: rnd(2) ? "solo" : "duo",
                set: "icons", moves: rnd(40), ms: rnd(9e4) };
    if (g.mode === "duo") g.s = [rnd(9), rnd(9)];
    return g;
  })());
  const st = () => {
    const games = [];
    for (let i = 0; i < rnd(70); i++) games.push(game("g" + rnd(120)));
    const s = { ver: 1, br: rnd(3) ? 0 : 1000 + rnd(500), best: {}, games };
    return M(s, s);                       // a device's records come from its own games
  };
  for (let i = 0; i < 5000; i++) {
    if (i % 50 === 0) G = {};
    const a = st(), b = st();
    assert.equal(J(M(a, b)), J(M(b, a)));
    const m = M(a, b);
    assert.equal(J(M(m, m)), J(m));
  }
  // Reset on C; B finished a worse game after it: that game is the record.
  const old = { id: "o", ts: 100, lv: "m", mode: "solo", set: "icons", moves: 8, ms: 1000 };
  const worse = { id: "w", ts: 300, lv: "m", mode: "solo", set: "icons", moves: 20, ms: 5000 };
  const bestOld = { m: { id: "o", ts: 100, moves: 8, ms: 1000 } };
  const A = { ver: 1, br: 0, best: bestOld, games: [old] };
  const B = { ver: 1, br: 0, best: bestOld, games: [worse, old] };
  const C = { ver: 1, br: 200, best: {}, games: [] };
  assert.equal(M(M(A, B), C).best.m.id, "w");
  assert.equal(M(A, M(B, C)).best.m.id, "w");
});

// Lines of box (r, c) on an n board: top, bottom, left, right.
const sides = (n, r, c) => DB.geo(n).boxLines[r * n + c];

test("dots: closing a box scores and moves again; the game ends full", () => {
  const n = 3, [t, b, l, r] = sides(n, 0, 0);
  let s = DB.replay(n, [t, b, l], 1);
  assert.equal(s.next, 2);                                                 // no box: turn passes
  s = DB.replay(n, [t, b, l, r], 1);
  assert.deepEqual(s.score, [0, 1]);                                       // player 2 closed it
  assert.equal(s.owner[0], 2);
  assert.equal(s.next, 2);                                                 // and plays again
  assert.deepEqual(s.lastBoxes, [0]);
  // One line closing two boxes at once counts both.
  const mid = sides(n, 0, 0)[3];                                           // shared with box (0,1)
  const around = sides(n, 0, 0).concat(sides(n, 0, 1)).filter((x) => x !== mid);
  s = DB.replay(n, around.concat([mid]), 1);
  assert.equal(s.score[0] + s.score[1], 2);
  assert.deepEqual(s.lastBoxes.sort(), [0, 1]);
  // Random full games: every box owned, scores add up, full flag set.
  for (const size of [3, 4, 5]) {
    const g = DB.geo(size), order = [...Array(g.L).keys()].sort(() => Math.random() - 0.5);
    const f = DB.replay(size, order, 1);
    assert.ok(f.full);
    assert.equal(f.score[0] + f.score[1], size * size);
    assert.ok(f.owner.every((o) => o === 1 || o === 2));
  }
});

// Play random positions, then let the computer move from them.
function randomPosition(n) {
  const g = DB.geo(n), moves = [];
  const stop = rnd(g.L);
  let s = DB.replay(n, [], 1);
  while (moves.length < stop) {
    const free = [];
    for (let l = 0; l < g.L; l++) if (!s.drawn[l]) free.push(l);
    moves.push(free[rnd(free.length)]);
    s = DB.replay(n, moves, 1);
  }
  return { g, s, moves };
}

test("dots: the computer takes boxes and only gives a third side when it must", () => {
  for (const n of [3, 4, 5]) {
    for (let k = 0; k < 300; k++) {
      const { g, s, moves } = randomPosition(n);
      const cnt = DB.sideCounts(g, s.drawn);
      const closing = DB.closingLines(g, s.drawn, cnt), safe = DB.safeLines(g, s.drawn, cnt);
      for (const lv of ["e", "m", "h"]) {
        const l = DB.chooseLine(n, s.drawn, lv);
        assert.ok(l >= 0 && !s.drawn[l], lv + " picks a drawn line in " + J(moves));
        if (closing.length && lv !== "h") {
          assert.ok(closing.includes(l), lv + " leaves a box in " + J(moves));
        }
        if (closing.length && lv === "h" && !closing.includes(l)) {
          // Hard skips a box only to double-deal, and only with no safe line left.
          assert.equal(safe.length, 0, "h skips a box with safe lines in " + J(moves));
          assert.equal(l, DB.doubleDeal(g, s.drawn, cnt));
        }
        if (!closing.length && safe.length && lv !== "e") {
          assert.ok(safe.includes(l), lv + " gives a third side in " + J(moves));
        }
      }
    }
  }
});

test("dots: hard double-deals the last two boxes to keep a long chain", () => {
  // 3x3: the computer took box (0,2) of the top-row chain; (0,1) has
  // 3 sides, (0,0) has 2. Rows 1-2 form a loop of 6 boxes.
  const n = 3, g = DB.geo(n), drawn = Array(g.L).fill(0);
  const draw = (...ls) => ls.forEach((l) => { drawn[l] = 1; });
  const v = (r, c) => g.H + r * (n + 1) + c, h = (r, c) => r * n + c;
  draw(h(0, 2), h(1, 2), v(0, 2), v(0, 3));                                 // (0,2) taken
  draw(h(0, 1), h(1, 1));                                                   // (0,1): 3 sides
  draw(h(0, 0), h(1, 0));                                                   // (0,0): 2 sides
  draw(v(1, 0), h(2, 1), v(1, 3), v(2, 0), h(3, 0), h(3, 1), v(2, 3), h(3, 2));
  const cnt = DB.sideCounts(g, drawn);
  assert.equal(DB.safeLines(g, drawn, cnt).length, 0);
  assert.equal(DB.chooseLine(n, drawn, "h"), v(0, 0));                      // far side of the pair
  assert.equal(DB.chooseLine(n, drawn, "m"), v(0, 1));                      // medium just takes
  // With no long chain left the pair is simply taken.
  draw(v(1, 1), v(1, 2), h(2, 0), v(2, 1), v(2, 2), h(2, 2));
  assert.equal(DB.chooseLine(n, drawn, "h"), v(0, 1));
});

test("dots: records merge is a join and a reset drops older rows", () => {
  const M = DB.mergeDots, keys = ["e3", "m4", "h5", "e5"];
  const st = () => {
    const rows = {};
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      keys.forEach((k) => { if (rnd(2)) s[k] = [rnd(5), rnd(5), rnd(5)]; });
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
  const reset = M({ br: 0, rows: { x: { b: 0, s: { e3: [3, 0, 0] } } } }, { br: 50, rows: {} });
  assert.equal(J(reset.rows), "{}");
  const junk = M({ rows: { x: { b: 1, s: { e3: [1, -1, 0], zz: [1, 1, 1] } } } }, null);
  assert.equal(J(junk.rows), "{}");                                        // bad cells drop
});

test("tictactoe: three in a row in all eight lines, and a draw", () => {
  const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  for (const L of lines) {
    const other = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((i) => !L.includes(i)).slice(0, 2);
    const b = TT.replay([L[0], other[0], L[1], other[1], L[2]], 1);
    assert.deepEqual(b.win, L);
  }
  const draw = TT.replay([0, 4, 8, 1, 7, 6, 2, 5, 3], 1);                  // X O X / X O O / O X X
  assert.equal(draw.win, null);
  assert.ok(draw.full);
});

test("tictactoe: hard never loses, starting or not", () => {
  // The opponent tries every move; hard answers (randomly among its
  // equal best moves), so the walk is repeated a few times.
  let games = 0;
  const walk = (moves, starter, hard) => {
    const b = TT.replay(moves, starter);
    if (b.win) { assert.notEqual(3 - b.next, 3 - hard, "hard lost " + J(moves)); games++; return; }
    if (b.full) { games++; return; }
    if (b.next === hard) return walk(moves.concat([TT.chooseMove(b.cells, hard, "h")]), starter, hard);
    for (let i = 0; i < 9; i++) if (!b.cells[i]) walk(moves.concat([i]), starter, hard);
  };
  for (let k = 0; k < 4; k++) { walk([], 1, 1); walk([], 1, 2); }
  assert.ok(games > 100);
});

test("tictactoe: medium takes a win and blocks a single threat", () => {
  for (let k = 0; k < 2000; k++) {
    const moves = [];
    let b = TT.replay([], 1);
    const n = rnd(8);
    while (moves.length < n && !b.win) {
      const free = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((i) => !b.cells[i]);
      moves.push(free[rnd(free.length)]);
      b = TT.replay(moves, 1);
    }
    if (b.win || b.full) continue;
    const p = b.next;
    const win = TT.winningCells(b.cells.slice(), p), threat = TT.winningCells(b.cells.slice(), 3 - p);
    const m = TT.chooseMove(b.cells, p, "m");
    if (win.length) assert.ok(win.includes(m), "medium misses a win in " + J(moves));
    else if (threat.length === 1) assert.equal(m, threat[0], "medium fails to block in " + J(moves));
    if (win.length) assert.ok(win.includes(TT.chooseMove(b.cells, p, "e")), "easy misses a win");
  }
});

test("tictactoe: records merge is a join and a reset drops older rows", () => {
  const M = TT.mergeTicTacToe;
  const st = () => {
    const rows = {};
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      ["e", "m", "h"].forEach((l) => { if (rnd(2)) s[l] = [rnd(5), rnd(5), rnd(5)]; });
      rows["d" + rnd(4)] = { b: rnd(3) * 100, s };
    }
    return { ver: 1, br: rnd(4) ? 0 : rnd(3) * 100, rows };
  };
  for (let i = 0; i < 3000; i++) {
    const a = st(), b = st(), c = st(), sa = J(a);
    assert.equal(J(M(a, b)), J(M(b, a)));
    const m = M(a, b);
    assert.equal(J(M(m, m)), J(m));
    assert.equal(J(M(M(a, b), c)), J(M(a, M(b, c))));
    assert.equal(J(a), sa);
  }
  assert.equal(J(M({ br: 0, rows: { x: { b: 0, s: { e: [3, 0, 0] } } } }, { br: 50, rows: {} }).rows), "{}");
});
