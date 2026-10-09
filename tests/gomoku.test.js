// Pure logic of Gomoku: five-or-more detection in every direction and at
// the edges, replay of a game, the threat shapes, the computer player
// (takes a win, blocks a four and an open three, plays legal points,
// keeps its time budget) and the records merge.
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

const SRC = fs.readFileSync(path.join(__dirname, "..", "gomoku/gomoku.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

// cmpStr's cut also takes isInt and now, the one-liners after it, and randInt.
const G = (() => {
  const parts = [cut("  var STORAGE_KEY", "  // ---------- 1.")];
  ["cmpStr", "runLength", "lineAt", "replay", "fiveCells", "reaches", "shapeAt", "lineCode", "shapeFast", "pointScore",
   "candidates", "winningPoints", "scoreMoves", "vcf", "pickTop", "Abort", "staticEval", "negamax", "searchRoot", "chooseMove",
   "normRow", "joinRows", "mergeGomoku"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    parts.push(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  parts.push(cut("  var WIN =", "\n"), cut("  var SHAPE_MEMO", "\n"));
  return new Function("crypto", "performance", "window", parts.join("\n") +
    "\nreturn { S, N, CENTER, lineAt, replay, shapeAt, shapeFast, winningPoints, chooseMove, mergeGomoku," +
    " SH_OPEN4, SH_FOUR, SH_OPEN3, SH_THREE };")(webcrypto, performance, { performance });
})();

const J = JSON.stringify;
const S = 15;
const rnd = (n) => Math.floor(Math.random() * n);
const at = (r, c) => r * S + c;
const empty = () => new Array(S * S).fill(0);
const LEVELS = ["e", "m", "h"];

// A board from a list of [r, c, player].
function boardOf(list) {
  const b = empty();
  for (const [r, c, p] of list) b[at(r, c)] = p;
  return b;
}

test("gomoku: five in a row wins in all four directions, edges and corners included", () => {
  const lines = [
    [[0, 0], [0, 1]],         // top edge, from the corner, horizontal
    [[14, 10], [0, 1]],       // bottom edge, to the right corner
    [[3, 14], [1, 0]],        // right edge, vertical
    [[10, 0], [1, 0]],        // left edge, down to the corner
    [[0, 0], [1, 1]],         // main diagonal from the top-left corner
    [[10, 10], [1, 1]],       // diagonal into the bottom-right corner
    [[0, 14], [1, -1]],       // anti-diagonal from the top-right corner
    [[10, 4], [1, -1]],       // anti-diagonal into the bottom-left corner
    [[5, 5], [0, 1]]          // middle
  ];
  for (const [[r, c], [dr, dc]] of lines) {
    for (const p of [1, 2]) {
      const b = empty();
      const cells = [];
      for (let k = 0; k < 5; k++) { b[at(r + dr * k, c + dc * k)] = p; cells.push(at(r + dr * k, c + dc * k)); }
      for (const i of cells) {
        assert.deepEqual(G.lineAt(b, i, p), cells.slice().sort((x, y) => x - y), "five through " + i);
        assert.equal(G.lineAt(b, i, 3 - p), null);
      }
      // four is not a win; a gap is not a win
      b[cells[4]] = 0;
      assert.equal(G.lineAt(b, cells[0], p), null, "four is not five");
      b[cells[4]] = p; b[cells[2]] = 0;
      assert.equal(G.lineAt(b, cells[0], p), null, "a gap breaks the line");
    }
  }
  // no wrap-around: four at the end of a row plus one at the start of the next
  const w = boardOf([[2, 11, 1], [2, 12, 1], [2, 13, 1], [2, 14, 1], [3, 0, 1]]);
  assert.equal(G.lineAt(w, at(2, 14), 1), null);
  assert.equal(G.lineAt(w, at(3, 0), 1), null);
  // six or more also wins (freestyle), and the whole run lights up
  const six = boardOf([[7, 2, 1], [7, 3, 1], [7, 4, 1], [7, 5, 1], [7, 6, 1], [7, 7, 1]]);
  assert.equal(G.lineAt(six, at(7, 4), 1).length, 6);
});

test("gomoku: replay alternates, stops at five and rejects illegal moves", () => {
  // black: row 7 cols 3..7, white: row 8 cols 3..6
  const moves = [];
  for (let k = 0; k < 5; k++) { moves.push(at(7, 3 + k)); if (k < 4) moves.push(at(8, 3 + k)); }
  const s = G.replay(moves);
  assert.ok(s.over); assert.equal(s.winner, 1);
  assert.deepEqual(s.win, [at(7, 3), at(7, 4), at(7, 5), at(7, 6), at(7, 7)]);
  assert.equal(s.last, at(7, 7));
  const s2 = G.replay(moves.slice(0, -1));
  assert.ok(!s2.over); assert.equal(s2.next, 1); assert.equal(s2.winner, 0);
  assert.equal(G.replay(moves.concat([at(0, 0)])), null, "no move after the end");
  assert.equal(G.replay([at(7, 7), at(7, 7)]), null, "taken point");
  assert.equal(G.replay([225]), null);
  assert.equal(G.replay([-1]), null);
  assert.equal(G.replay([1.5]), null);
  const e = G.replay([]);
  assert.equal(e.next, 1); assert.equal(e.last, -1); assert.ok(!e.over);
  // white wins too
  const wm = [at(0, 0)];
  for (let k = 0; k < 5; k++) { wm.push(at(10, 10 - k)); if (k < 4) wm.push(at(0, 2 + 2 * k)); }
  const ws = G.replay(wm);
  assert.equal(ws.winner, 2);
});

test("gomoku: a full board without five is a draw", () => {
  // pattern with runs of at most two in every direction, 113 black / 112 white
  const col = (r, c) => (((c >> 1) + r) % 2 ? 2 : 1);
  const blacks = [], whites = [];
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) (col(r, c) === 1 ? blacks : whites).push(at(r, c));
  assert.equal(blacks.length, 113);
  const moves = [];
  for (let k = 0; k < 113; k++) { moves.push(blacks[k]); if (k < 112) moves.push(whites[k]); }
  const s = G.replay(moves);
  assert.ok(s.over); assert.equal(s.winner, 0); assert.equal(s.win, null);
  for (const lv of LEVELS) assert.equal(G.chooseMove(s.cells, 2, lv), -1);
});

test("gomoku: threat shapes: open four, four, open three, three", () => {
  const open4 = boardOf([[7, 4, 1], [7, 5, 1], [7, 6, 1], [7, 7, 1]]);
  assert.equal(G.shapeAt(open4, at(7, 5), 0, 1), G.SH_OPEN4);
  const four = boardOf([[7, 3, 2], [7, 4, 1], [7, 5, 1], [7, 6, 1], [7, 7, 1]]);
  assert.equal(G.shapeAt(four, at(7, 5), 0, 1), G.SH_FOUR);
  const split4 = boardOf([[7, 4, 1], [7, 5, 1], [7, 7, 1], [7, 8, 1]]);
  assert.equal(G.shapeAt(split4, at(7, 5), 0, 1), G.SH_FOUR);
  const open3 = boardOf([[7, 5, 1], [7, 6, 1], [7, 7, 1]]);
  assert.equal(G.shapeAt(open3, at(7, 6), 0, 1), G.SH_OPEN3);
  const three = boardOf([[7, 4, 2], [7, 5, 1], [7, 6, 1], [7, 7, 1]]);
  assert.equal(G.shapeAt(three, at(7, 6), 0, 1), G.SH_THREE);
  // a four against the edge has a single way to five
  const edge4 = boardOf([[0, 0, 1], [0, 1, 1], [0, 2, 1], [0, 3, 1]]);
  assert.equal(G.shapeAt(edge4, at(0, 1), 0, 1), G.SH_FOUR);
});

test("gomoku: the shape table agrees with the direct shape on random boards", () => {
  for (let g = 0; g < 300; g++) {
    const b = empty();
    const n = 10 + rnd(80);
    for (let k = 0; k < n; k++) b[rnd(S * S)] = 1 + rnd(2);
    for (let k = 0; k < 20; k++) {
      const i = rnd(S * S), p = 1 + rnd(2), keep = b[i];
      b[i] = p;
      for (let d = 0; d < 4; d++) assert.equal(G.shapeFast(b, i, d, p), G.shapeAt(b, i, d, p), "point " + i + " dir " + d);
      b[i] = keep;
    }
  }
});

test("gomoku: every level takes a win in one, also at the edge", () => {
  const cases = [
    { b: boardOf([[7, 4, 1], [7, 5, 1], [7, 6, 1], [7, 7, 1], [8, 4, 2], [8, 5, 2], [8, 6, 2], [6, 6, 2]]), p: 1, win: [at(7, 3), at(7, 8)] },
    { b: boardOf([[0, 0, 2], [1, 1, 2], [3, 3, 2], [4, 4, 2], [7, 7, 1], [7, 8, 1], [7, 9, 1], [6, 9, 1], [9, 9, 1]]), p: 2, win: [at(2, 2)] },
    { b: boardOf([[10, 14, 1], [11, 14, 1], [12, 14, 1], [13, 14, 1], [9, 14, 2], [5, 5, 2], [5, 6, 2], [5, 7, 2]]), p: 1, win: [at(14, 14)] }
  ];
  for (const lv of LEVELS) {
    for (const { b, p, win } of cases) {
      for (let k = 0; k < 5; k++) {
        const m = G.chooseMove(b, p, lv);
        assert.ok(win.includes(m), lv + " missed the win: " + m);
      }
    }
  }
});

test("gomoku: every level blocks a four and an open three", () => {
  // white has a closed four (one way to five); black to move, no win of its own
  const four = boardOf([[7, 3, 1], [7, 4, 2], [7, 5, 2], [7, 6, 2], [7, 7, 2], [9, 9, 1], [10, 10, 1]]);
  // white has a split four 2,2 _ 2,2 on a diagonal
  const split = boardOf([[2, 2, 2], [3, 3, 2], [5, 5, 2], [6, 6, 2], [9, 3, 1], [9, 4, 1]]);
  for (const lv of LEVELS) {
    for (let k = 0; k < 5; k++) {
      assert.equal(G.chooseMove(four, 1, lv), at(7, 8), lv + " did not block the four");
      assert.equal(G.chooseMove(split, 1, lv), at(4, 4), lv + " did not block the split four");
    }
  }
  // white has an open three: black must stop the open four (an end or the gap)
  const open3 = boardOf([[7, 5, 2], [7, 6, 2], [7, 7, 2], [6, 6, 1], [9, 9, 1]]);
  const okStops = [at(7, 4), at(7, 8), at(7, 3), at(7, 9)];
  for (const lv of LEVELS) {
    for (let k = 0; k < 5; k++) {
      const m = G.chooseMove(open3, 1, lv);
      const after = open3.slice(); after[m] = 1;
      // after the answer white must have no open-four point left
      const stillOpen = [];
      for (let i = 0; i < S * S; i++) {
        if (after[i]) continue;
        after[i] = 2;
        for (let d = 0; d < 4; d++) if (G.shapeAt(after, i, d, 2) === G.SH_OPEN4) stillOpen.push(i);
        after[i] = 0;
      }
      assert.ok(okStops.includes(m) && !stillOpen.length, lv + " let the open three through: " + m + " " + stillOpen);
    }
  }
  // a broken open three _22_2_ is stopped too
  const broken = boardOf([[4, 4, 2], [4, 5, 2], [4, 7, 2], [6, 6, 1], [10, 10, 1]]);
  for (const lv of LEVELS) {
    const m = G.chooseMove(broken, 1, lv);
    assert.ok([at(4, 3), at(4, 6), at(4, 8)].includes(m), lv + " broken three: " + m);
  }
});

test("gomoku: the computer plays a free point on every level and leaves the board alone", () => {
  assert.equal(G.chooseMove(empty(), 1, "m"), G.CENTER);
  for (const lv of LEVELS) {
    for (let g = 0; g < (lv === "h" ? 4 : 12); g++) {
      const moves = [];
      let s = G.replay(moves);
      const n = 4 + rnd(30);
      while (moves.length < n && !s.over) {
        // random stones near the centre so games stay open
        let i;
        do { i = at(3 + rnd(9), 3 + rnd(9)); } while (s.cells[i]);
        moves.push(i);
        s = G.replay(moves);
      }
      if (s.over) continue;
      const before = s.cells.slice();
      const m = G.chooseMove(s.cells, s.next, lv);
      assert.ok(m >= 0 && m < S * S && s.cells[m] === 0, lv + " illegal " + m);
      assert.deepEqual(s.cells, before, "board untouched");
    }
  }
});

test("gomoku: a full computer-vs-computer game ends legally, hard beats easy", () => {
  let hardWins = 0;
  for (let g = 0; g < 2; g++) {
    const moves = [];
    let s = G.replay(moves);
    const lv = g % 2 ? ["e", "h"] : ["h", "e"];   // [black, white]
    while (!s.over) {
      const m = G.chooseMove(s.cells, s.next, lv[s.next - 1]);
      assert.ok(s.cells[m] === 0);
      moves.push(m);
      s = G.replay(moves);
      assert.ok(s, "replay accepts the move");
    }
    if (s.winner && lv[s.winner - 1] === "h") hardWins++;
  }
  assert.ok(hardWins >= 1, "hard never beat easy");
});

test("gomoku: hard answers within its time budget", () => {
  const moves = [];
  let s = G.replay(moves);
  while (moves.length < 24 && !s.over) {
    moves.push(G.chooseMove(s.cells, s.next, "m"));
    s = G.replay(moves);
  }
  if (s.over) return;
  const t0 = Date.now();
  G.chooseMove(s.cells, s.next, "h");
  assert.ok(Date.now() - t0 < 1500, "took " + (Date.now() - t0) + " ms");
});

test("gomoku: records merge is a join and a reset drops older rows", () => {
  const M = G.mergeGomoku;
  const st = () => {
    const rows = {};
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      LEVELS.forEach((l) => { if (rnd(2)) s[l] = [rnd(5), rnd(5), rnd(5)]; });
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
