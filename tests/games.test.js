// Pure logic of the Games apps: merge functions (Memory, Connect 4),
// Connect 4 win detection and computer player.
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
