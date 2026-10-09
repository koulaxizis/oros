// Pure logic of Checkers (English draughts): move generation with
// forced captures, multi-jumps and crowning, the end of the game
// (no move, 40-move rule, threefold repetition), the computer player
// and the records merge.
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

const SRC = fs.readFileSync(path.join(__dirname, "..", "checkers/checkers.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

// cmpStr's cut also takes isInt and now, the one-liners after it, and randInt.
const C = (() => {
  const parts = [cut("  var DATA_VER", "  // ---------- 1.")];
  ["cmpStr", "owner", "startCells", "jumps", "genMoves", "doMove", "undoMove", "samePath",
   "findMove", "replay", "evaluate", "Abort", "negamax", "rootScores", "pickBest", "chooseMove",
   "normRow", "joinRows", "mergeCheckers"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    parts.push(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function("crypto", "performance", "window", parts.join("\n") +
    "\nreturn { startCells, genMoves, doMove, undoMove, replay, chooseMove, mergeCheckers };")(
    webcrypto, performance, { performance });
})();

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);
const sq = (name) => (8 - +name[1]) * 8 + "abcdefgh".indexOf(name[0]);   // "c3" → index
const empty = () => new Array(64).fill(0);
const paths = (ms) => ms.map((m) => m.path.join("-")).sort();

test("checkers: the opening has 7 steps for black, 7 for white", () => {
  const b = C.startCells();
  assert.equal(b.filter((v) => v === 1).length, 12);
  assert.equal(b.filter((v) => v === 2).length, 12);
  assert.equal(C.genMoves(b, 1).length, 7);
  assert.equal(C.genMoves(b, 2).length, 7);
  assert.ok(C.genMoves(b, 1).every((m) => m.caps.length === 0 && m.path[1] < m.path[0]));  // black goes up
});

test("checkers: a capture is forced and men capture forward only", () => {
  const b = empty();
  b[sq("c3")] = 1; b[sq("d4")] = 2;            // black can jump d4
  b[sq("g3")] = 1;                             // and could step, but must capture
  const ms = C.genMoves(b, 1);
  assert.deepEqual(paths(ms), [[sq("c3"), sq("e5")].join("-")]);
  assert.deepEqual(ms[0].caps, [sq("d4")]);
  const back = empty();
  back[sq("e5")] = 1; back[sq("d4")] = 2;      // the white man is behind: no capture
  assert.ok(C.genMoves(back, 1).every((m) => m.caps.length === 0));
  const king = empty();
  king[sq("e5")] = 3; king[sq("d4")] = 2;      // a king captures backwards
  assert.deepEqual(paths(C.genMoves(king, 1)), [[sq("e5"), sq("c3")].join("-")]);
});

test("checkers: multi-jumps go on to the end, with every branch", () => {
  const b = empty();
  b[sq("a1")] = 1;
  b[sq("b2")] = 2; b[sq("d4")] = 2; b[sq("d6")] = 2; b[sq("f4")] = 2;
  // a1×c3×e5, then from e5 either ×c7 (via d6) or ×g3 is backwards (men cannot)
  const ms = C.genMoves(b, 1);
  assert.deepEqual(paths(ms), [[sq("a1"), sq("c3"), sq("e5"), sq("c7")].join("-")]);
  assert.equal(ms[0].caps.length, 3);
  // a king takes both branches, and never jumps a piece twice
  b[sq("a1")] = 3;
  const km = C.genMoves(b, 1);
  assert.deepEqual(paths(km), [
    [sq("a1"), sq("c3"), sq("e5"), sq("c7")].join("-"),
    [sq("a1"), sq("c3"), sq("e5"), sq("g3")].join("-")].sort());
  km.forEach((m) => assert.equal(new Set(m.caps).size, m.caps.length));
});

test("checkers: a king may circle back over its own start square", () => {
  const b = empty();
  b[sq("c3")] = 3;
  b[sq("d4")] = 2; b[sq("f4")] = 2; b[sq("f2")] = 2; b[sq("d2")] = 2;
  const ms = C.genMoves(b, 1);
  assert.ok(ms.some((m) => m.caps.length === 4 && m.path[0] === m.path[4]), J(paths(ms)));
  const cells = b.slice(), m = ms.find((x) => x.caps.length === 4);
  const rec = C.doMove(cells, m);
  assert.equal(cells[sq("c3")], 3);
  assert.equal(cells.filter((v) => v === 2).length, 0);
  C.undoMove(cells, m, rec);
  assert.deepEqual(cells, b);
});

test("checkers: crowning ends the move, even mid-capture", () => {
  const b = empty();
  b[sq("b6")] = 1; b[sq("c7")] = 2; b[sq("e7")] = 2;
  // b6×d8 crowns; the king could jump e7 next, but the turn ends
  const ms = C.genMoves(b, 1);
  assert.deepEqual(paths(ms), [[sq("b6"), sq("d8")].join("-")]);
  const cells = b.slice();
  const rec = C.doMove(cells, ms[0]);
  assert.ok(rec.promo);
  assert.equal(cells[sq("d8")], 3);
  // a white man crowns on row 1
  const w = empty();
  w[sq("c2")] = 2;
  const wm = C.genMoves(w, 2);
  const wc = w.slice(); C.doMove(wc, wm[0]);
  assert.equal(wc[wm[0].path[1]], 4);
});

test("checkers: replay plays real games and rejects illegal moves", () => {
  assert.equal(C.replay([[sq("c3"), sq("c4")]]), null);               // not diagonal
  assert.equal(C.replay([[sq("d6"), sq("c5")]]), null);               // white moved first
  const st = C.replay([[sq("c3"), sq("d4")], [sq("f6"), sq("e5")], [sq("d4"), sq("f6")]]);
  assert.ok(st);
  assert.equal(st.cells.filter((v) => v === 2).length, 11);           // one white man taken
  assert.equal(st.next, 2);
  assert.ok(st.legal.every((m) => m.caps.length > 0));                // white must recapture
  // random full games always end and never break the rules
  for (let g = 0; g < 40; g++) {
    const moves = [];
    let s = C.replay([]);
    while (!s.over) {
      const m = s.legal[rnd(s.legal.length)];
      moves.push(m.path);
      s = C.replay(moves);
      assert.ok(s);
      assert.ok(moves.length < 2000);
    }
    assert.ok(["nomove", "forty", "rep"].includes(s.why));
    if (s.why === "nomove") assert.equal(s.winner, 3 - s.next);
    else assert.equal(s.winner, 0);
  }
});

test("checkers: no move left loses, 40 quiet moves each and threefold repetition draw", () => {
  // White's last man is blocked: black wins as soon as white has to move.
  const b = empty();
  b[sq("a7")] = 2; b[sq("b6")] = 1; b[sq("c5")] = 1; b[sq("d2")] = 1;
  assert.equal(C.genMoves(b, 2).length, 0);
  const lost = C.replay([], { cells: b, next: 2, quiet: 0 });
  assert.ok(lost.over);
  assert.equal(lost.why, "nomove");
  assert.equal(lost.winner, 1);
  const won = C.replay([[sq("d2"), sq("c3")]], { cells: b, next: 1, quiet: 0 });
  assert.equal(won.winner, 1);
  // no pieces at all is no move too
  const bare = empty(); bare[sq("d2")] = 1;
  assert.equal(C.replay([], { cells: bare, next: 2, quiet: 0 }).winner, 1);

  // Two kings shuffle: the third time the same position comes back it is a draw.
  const k = empty();
  k[sq("a1")] = 3; k[sq("h8")] = 4;
  const from = { cells: k, next: 1, quiet: 0 };
  const loop = [[sq("a1"), sq("b2")], [sq("h8"), sq("g7")], [sq("b2"), sq("a1")], [sq("g7"), sq("h8")]];
  assert.equal(C.replay(loop, from).over, false);                       // seen twice
  assert.equal(C.replay(loop.concat(loop.slice(0, 3)), from).over, false);
  const rep = C.replay(loop.concat(loop), from);
  assert.ok(rep.over);
  assert.equal(rep.why, "rep");
  assert.equal(rep.winner, 0);

  // 80 plies (40 moves each) without a capture or a crowning
  const near = { cells: k, next: 1, quiet: 78 };
  assert.equal(C.replay(loop.slice(0, 1), near).over, false);
  const forty = C.replay(loop.slice(0, 2), near);
  assert.equal(forty.why, "forty");
  assert.equal(forty.winner, 0);
  // a capture or a crowning resets the count
  const c = empty();
  c[sq("c3")] = 3; c[sq("d4")] = 2; c[sq("h8")] = 4; c[sq("b6")] = 1;
  const cap = C.replay([[sq("c3"), sq("e5")]], { cells: c, next: 1, quiet: 79 });
  assert.equal(cap.over, false);
  assert.equal(cap.quiet, 0);
  const cr = empty();
  cr[sq("b6")] = 1; cr[sq("a1")] = 3; cr[sq("h8")] = 4;
  const crown = C.replay([[sq("h8"), sq("g7")], [sq("b6"), sq("a7")], [sq("g7"), sq("h8")], [sq("a7"), sq("b8")]],
                         { cells: cr, next: 2, quiet: 77 });
  assert.equal(crown.over, false);
  assert.equal(crown.quiet, 0);
});

test("checkers: the computer plays legal moves on every level", () => {
  for (const lv of ["e", "m", "h"]) {
    for (let k = 0; k < (lv === "h" ? 6 : 25); k++) {
      const moves = [];
      let s = C.replay([]);
      const n = rnd(30);
      for (let i = 0; i < n && !s.over; i++) {
        moves.push(s.legal[rnd(s.legal.length)].path);
        s = C.replay(moves);
      }
      if (s.over) continue;
      const before = s.cells.slice();
      const m = C.chooseMove(s.cells, s.next, lv);
      assert.ok(s.legal.some((x) => x.path.join() === m.path.join()), lv + " illegal " + J(m));
      assert.deepEqual(s.cells, before, "the board is left untouched");
    }
  }
});

test("checkers: the computer takes the free capture, not the one that is taken back", () => {
  const b = empty();
  b[sq("c3")] = 1;                       // can take b4 (lands a5, safe) or d4 (lands e5)
  b[sq("b4")] = 2; b[sq("d4")] = 2;
  b[sq("f6")] = 2;                       // f6 would take e5 back (to d4)
  b[sq("h8")] = 2; b[sq("a1")] = 1;
  const legal = C.genMoves(b, 1);
  assert.equal(legal.length, 2);
  for (const lv of ["m", "h"]) {
    for (let k = 0; k < 5; k++) {
      const m = C.chooseMove(b, 1, lv);
      assert.equal(m.path.join("-"), [sq("c3"), sq("a5")].join("-"), lv);
    }
  }
  // and a single capture is always taken (forced), on every level
  const one = empty();
  one[sq("e3")] = 1; one[sq("f4")] = 2; one[sq("a7")] = 2; one[sq("a1")] = 1;
  for (const lv of ["e", "m", "h"]) assert.deepEqual(C.chooseMove(one, 1, lv).caps, [sq("f4")]);
});

test("checkers: hard answers within its time budget", () => {
  const t0 = Date.now();
  C.chooseMove(C.startCells(), 1, "h");
  assert.ok(Date.now() - t0 < 1500, "took " + (Date.now() - t0) + " ms");
});

test("checkers: records merge is a join and a reset drops older rows", () => {
  const M = C.mergeCheckers;
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
  const kept = M({ br: 0, rows: { x: { b: 60, s: { e: [1, 0, 0] } } } }, { br: 50, rows: {} });
  assert.equal(J(kept.rows.x.s.e), "[1,0,0]");
  for (const bad of [{ b: -1, s: { e: [1, 0, 0] } }, { b: 0, s: { e: [1, 0] } }, { b: 0, s: { e: [1, -1, 0] } },
                     { b: 0, s: { x: [1, 0, 0] } }, { b: 0.5, s: { e: [1, 0, 0] } }, null, "row"]) {
    assert.equal(J(M({ rows: { d: bad } }, null).rows), "{}", J(bad));
  }
});
