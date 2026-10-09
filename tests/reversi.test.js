// Pure logic of Reversi: the start, legal moves and flips in all eight
// directions, passes and the end of the game, the computer player and
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
const { webcrypto } = require("crypto");

const SRC = fs.readFileSync(path.join(__dirname, "..", "reversi/reversi.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

// cmpStr's cut also takes isInt and now, the one-liners after it, and randInt.
const R = (() => {
  const parts = [cut("  var DATA_VER", "  // ---------- 1.")];
  ["cmpStr", "startCells", "flipsFor", "legalMoves", "counts", "replay", "play", "unplay",
   "positional", "evaluate", "Abort", "negamax", "rootScores", "pickBest", "chooseMove",
   "normRow", "joinRows", "mergeReversi"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    parts.push(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function("crypto", "performance", "window", parts.join("\n") +
    "\nreturn { CORNERS, startCells, flipsFor, legalMoves, counts, replay, chooseMove, mergeReversi };")(
    webcrypto, performance, { performance });
})();

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);
const sq = (name) => (8 - +name[1]) * 8 + "abcdefgh".indexOf(name[0]);
const empty = () => new Array(64).fill(0);

// Random game prefix of n moves (stops at the end).
function randomGame(n) {
  const moves = [];
  let s = R.replay([]);
  for (let i = 0; i < n && !s.over; i++) {
    moves.push(s.legal[rnd(s.legal.length)]);
    s = R.replay(moves);
  }
  return { moves, s };
}

test("reversi: the standard start and black's four openings", () => {
  const b = R.startCells();
  assert.equal(b[sq("d4")], 2); assert.equal(b[sq("e5")], 2);
  assert.equal(b[sq("d5")], 1); assert.equal(b[sq("e4")], 1);
  assert.deepEqual(R.counts(b), [2, 2]);
  assert.deepEqual(R.legalMoves(b, 1).sort((x, y) => x - y), [sq("d3"), sq("c4"), sq("f5"), sq("e6")].sort((x, y) => x - y));
  assert.deepEqual(R.flipsFor(b, sq("d3"), 1), [sq("d4")]);
});

test("reversi: flips in all eight directions, and only closed lines", () => {
  const b = empty();
  const c = sq("d4");
  // a white ring around d4 with black discs behind it in every direction
  const dirs = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const r0 = c >> 3, c0 = c & 7;
  for (const [dr, dc] of dirs) {
    b[(r0 + dr) * 8 + c0 + dc] = 2;
    b[(r0 + 2 * dr) * 8 + c0 + 2 * dc] = 1;
  }
  const fl = R.flipsFor(b, c, 1);
  assert.equal(fl.length, 8);
  for (const [dr, dc] of dirs) assert.ok(fl.includes((r0 + dr) * 8 + c0 + dc));
  // each direction alone
  for (const [dr, dc] of dirs) {
    const one = empty();
    one[(r0 + dr) * 8 + c0 + dc] = 2;
    one[(r0 + 2 * dr) * 8 + c0 + 2 * dc] = 2;
    one[(r0 + 3 * dr) * 8 + c0 + 3 * dc] = 1;
    assert.equal(R.flipsFor(one, c, 1).length, 2, J([dr, dc]));
    one[(r0 + 3 * dr) * 8 + c0 + 3 * dc] = 0;                 // open end: no flip
    assert.equal(R.flipsFor(one, c, 1).length, 0, J([dr, dc]));
  }
  // a line that runs off the board does not flip; an occupied square is never legal
  const edge = empty();
  edge[sq("b1")] = 2; edge[sq("c1")] = 2;
  assert.equal(R.flipsFor(edge, sq("a1"), 1).length, 0);
  edge[sq("d1")] = 1;
  assert.deepEqual(R.flipsFor(edge, sq("a1"), 1).sort(), [sq("b1"), sq("c1")].sort());
  assert.equal(R.flipsFor(edge, sq("b1"), 1).length, 0);
  // no wrap from the h-file to the a-file
  const wrap = empty();
  wrap[sq("h4")] = 2; wrap[sq("a3")] = 1;                     // index h4 + 1 = a3
  assert.equal(R.flipsFor(wrap, sq("g4"), 1).length, 0);
});

test("reversi: random games keep the rules: flips, counts, passes, end", () => {
  for (let g = 0; g < 200; g++) {
    const moves = [];
    let s = R.replay([]);
    let prev = s;
    while (!s.over) {
      const m = s.legal[rnd(s.legal.length)];
      const flips = R.flipsFor(s.cells, m, s.next);
      moves.push(m);
      prev = s;
      s = R.replay(moves);
      const mover = prev.next;
      assert.equal(s.movers[s.movers.length - 1], mover);
      const me = mover - 1;
      assert.equal(s.counts[me], prev.counts[me] + flips.length + 1);
      assert.equal(s.counts[1 - me], prev.counts[1 - me] - flips.length);
      if (!s.over) {
        assert.ok(s.legal.length > 0);
        if (s.next === mover) {                                // the other side passed
          assert.ok(s.passed);
          assert.equal(R.legalMoves(s.cells, 3 - mover).length, 0);
        }
      }
    }
    assert.equal(R.legalMoves(s.cells, 1).length + R.legalMoves(s.cells, 2).length, 0);
    const [b, w] = s.counts;
    assert.equal(s.winner, b > w ? 1 : (w > b ? 2 : 0));
    assert.ok(moves.length <= 60);
  }
});

test("reversi: a pass and an early end are detected", () => {
  // Black wipes out white in two moves: f5 then … play a known short game.
  // The shortest game: 9 moves, black wins 13–0.
  const line = ["e6", "f4", "e3", "f6", "g5", "d6", "e7", "f5", "c5"].map(sq);
  const s = R.replay(line);
  assert.ok(s.over);
  assert.deepEqual(s.counts, [13, 0]);
  assert.equal(s.winner, 1);
  assert.equal(R.replay(line.slice(0, 8)).over, false);
  // illegal moves are refused
  assert.equal(R.replay([sq("a1")]), null);
  assert.equal(R.replay([sq("d4")]), null);
  // a pass: find a random game where it happens and check the side to move
  let found = false;
  for (let g = 0; g < 400 && !found; g++) {
    const moves = [];
    let s2 = R.replay([]);
    while (!s2.over && !found) {
      const mover = s2.next;
      moves.push(s2.legal[rnd(s2.legal.length)]);
      s2 = R.replay(moves);
      if (!s2.over && s2.next === mover) {
        found = true;
        assert.equal(R.legalMoves(s2.cells, 3 - mover).length, 0);
        // the replay of the next move by the same side is accepted
        const again = R.replay(moves.concat([s2.legal[0]]));
        assert.equal(again.movers[again.movers.length - 1], mover);
      }
    }
  }
  assert.ok(found, "no pass found in 400 random games");
});

test("reversi: the computer plays legal moves on every level", () => {
  for (const lv of ["e", "m", "h"]) {
    for (let k = 0; k < (lv === "h" ? 6 : 40); k++) {
      const { s } = randomGame(rnd(56));
      if (s.over) continue;
      const before = s.cells.slice();
      const m = R.chooseMove(s.cells, s.next, lv);
      assert.ok(s.legal.includes(m), lv + " illegal " + m);
      assert.deepEqual(s.cells, before, "board untouched");
    }
    assert.equal(R.chooseMove(R.startCells().fill(1), 2, lv), -1);
  }
});

test("reversi: medium and hard take a corner when one is offered", () => {
  let tried = 0;
  for (let k = 0; k < 400 && tried < 30; k++) {
    const { s } = randomGame(15 + rnd(30));
    if (s.over) continue;
    const corners = s.legal.filter((m) => R.CORNERS.includes(m));
    if (!corners.length) continue;
    tried++;
    assert.ok(corners.includes(R.chooseMove(s.cells, s.next, "m")), "medium missed a corner");
    assert.ok(corners.includes(R.chooseMove(s.cells, s.next, "h")), "hard missed a corner");
  }
  assert.ok(tried >= 10, "too few corner positions: " + tried);
  // easy, greedy: takes the move with the most flips (3 of 4 times)
  const b = empty();
  b[sq("a1")] = 1; b[sq("b1")] = 2; b[sq("c1")] = 2; b[sq("d1")] = 2;   // e1 flips 3
  b[sq("h8")] = 1; b[sq("h7")] = 2;                                      // h6 flips 1
  let greedy = 0;
  for (let k = 0; k < 40; k++) if (R.chooseMove(b, 1, "e") === sq("e1")) greedy++;
  assert.ok(greedy >= 20, "easy greedy " + greedy);
});

test("reversi: hard answers within its time budget", () => {
  const { s } = randomGame(20);
  const t0 = Date.now();
  R.chooseMove(s.cells, s.next, "h");
  assert.ok(Date.now() - t0 < 1500, "took " + (Date.now() - t0) + " ms");
});

test("reversi: records merge is a join and a reset drops older rows", () => {
  const M = R.mergeReversi;
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
    const a = st(), b = st(), c = st(), sa = J(a), sb = J(b);
    assert.equal(J(M(a, b)), J(M(b, a)));
    const m = M(a, b);
    assert.equal(J(M(m, m)), J(m));
    assert.equal(J(M(M(a, b), c)), J(M(a, M(b, c))));
    assert.equal(J(a), sa);                                                // inputs untouched
    assert.equal(J(b), sb);
  }
  const reset = M({ br: 0, rows: { x: { b: 0, s: { e: [3, 0, 0] } } } }, { br: 50, rows: {} });
  assert.equal(J(reset.rows), "{}");
  const kept = M({ br: 0, rows: { x: { b: 60, s: { h: [0, 2, 1] } } } }, { br: 50, rows: {} });
  assert.equal(J(kept.rows.x.s.h), "[0,2,1]");
  for (const bad of [{ b: -1, s: { e: [1, 0, 0] } }, { b: 0, s: { e: [1, 0] } }, { b: 0, s: { e: [1, -1, 0] } },
                     { b: 0, s: { x: [1, 0, 0] } }, { b: 0.5, s: { e: [1, 0, 0] } }, null, "row"]) {
    assert.equal(J(M({ rows: { d: bad } }, null).rows), "{}", J(bad));
  }
});
