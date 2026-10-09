// Pure logic of Mancala (Kalah): sowing with the wrap and the skipped
// store, extra turns, captures, the end sweep, the computer players and
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

const SRC = fs.readFileSync(path.join(__dirname, "..", "mancala/mancala.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

// cmpStr's cut also takes isInt, now and randInt, the one-liners after it.
const M = (() => {
  const parts = [cut("  var DATA_VER", "  // ---------- 1."), cut("  var WIN_SCORE", "  function search(")];
  ["cmpStr", "startBoard", "ownPit", "sideSum", "legalPits", "sow", "nextAfter", "replay",
   "evaluate", "chainGain", "search", "rootScores", "pickBest", "chooseMove",
   "normRow", "joinRows", "mergeMancala"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    parts.push(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function("crypto", "performance", "window", parts.join("\n") +
    "\nreturn { startBoard, legalPits, sow, nextAfter, replay, chooseMove, mergeMancala };")(
    webcrypto, performance, { performance });
})();

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);
const total = (s) => s.reduce((a, b) => a + b, 0);
// board from two rows as the players see them: own pits 1–6 + store
const B = (p0, st0, p1, st1) => p0.concat([st0], p1, [st1]);

test("mancala: sowing goes counter-clockwise, one seed per pit", () => {
  const r = M.sow(M.startBoard(4), 0, 2);
  assert.equal(J(r.s), J(B([4, 4, 0, 5, 5, 5], 1, [4, 4, 4, 4, 4, 4], 0)));
  assert.equal(J(r.path), J([3, 4, 5, 6]));
  assert.ok(r.extra, "4 seeds from pit 3 end in the store");
  assert.equal(M.nextAfter(0, r), 0);
  const r2 = M.sow(M.startBoard(4), 1, 7);
  assert.equal(J(r2.path), J([8, 9, 10, 11]));
  assert.ok(!r2.extra && r2.cap === -1);
  assert.equal(M.nextAfter(1, r2), 0);
});

test("mancala: a long sow wraps round and skips the opponent's store", () => {
  // player 0 sows 13 seeds from pit 6 (index 5): 6, 7…12, (skip 13), 0…5
  const s = B([1, 0, 0, 0, 0, 13], 0, [1, 1, 1, 1, 1, 1], 0);
  const r = M.sow(s, 0, 5);
  assert.equal(J(r.path), J([6, 7, 8, 9, 10, 11, 12, 0, 1, 2, 3, 4, 5]));
  assert.equal(r.s[13], 0, "never into the opponent's store");
  assert.equal(total(r.s), total(s));
  // player 1 sows past player 0's store
  const s2 = B([1, 1, 1, 1, 1, 1], 0, [0, 0, 0, 0, 0, 9], 0);
  const r2 = M.sow(s2, 1, 12);
  assert.equal(J(r2.path), J([13, 0, 1, 2, 3, 4, 5, 7, 8]));
  assert.equal(r2.s[6], 0);
  // the emptied pit itself gets a seed on a lap (16 seeds)
  const s3 = B([0, 0, 16, 1, 0, 0], 0, [1, 1, 1, 1, 1, 1], 0);
  const r3 = M.sow(s3, 0, 2);
  assert.ok(r3.path.includes(2) && r3.path.length === 16);
  assert.equal(total(r3.s), total(s3));
});

test("mancala: the last seed in an own empty pit captures the opposite seeds", () => {
  // pit index 1 has 2 seeds → ends in index 3 (empty), opposite 9 has 5
  const s = B([0, 2, 0, 0, 3, 0], 10, [1, 1, 5, 1, 1, 1], 7);
  const r = M.sow(s, 0, 1);
  assert.equal(r.cap, 9);
  assert.equal(r.got, 6);
  assert.equal(r.s[3], 0);
  assert.equal(r.s[9], 0);
  assert.equal(r.s[6], 16);
  assert.equal(M.nextAfter(0, r), 1);
  // opposite empty: no capture, the seed stays
  const s2 = B([0, 2, 0, 0, 3, 0], 10, [1, 1, 0, 1, 1, 1], 7);
  const r2 = M.sow(s2, 0, 1);
  assert.equal(r2.cap, -1);
  assert.equal(r2.s[3], 1);
  // landing on the opponent's empty pit never captures
  const s3 = B([0, 0, 0, 0, 0, 2], 0, [0, 3, 3, 3, 3, 3], 0);
  const r3 = M.sow(s3, 0, 5);
  assert.equal(r3.cap, -1);
  // a non-empty own pit: no capture
  const s4 = B([0, 2, 0, 1, 3, 0], 0, [1, 1, 5, 1, 1, 1], 0);
  assert.equal(M.sow(s4, 0, 1).cap, -1);
  // player 1 captures too
  const s5 = B([4, 4, 4, 4, 4, 4], 0, [1, 0, 0, 0, 0, 1], 0);
  const r5 = M.sow(s5, 1, 7);
  assert.equal(r5.cap, 4);
  assert.equal(r5.s[13], 5);
});

test("mancala: an empty side ends the game and the rest goes to its owner", () => {
  const s = B([0, 0, 0, 0, 0, 1], 20, [2, 0, 3, 0, 0, 1], 21);
  const r = M.sow(s, 0, 5);
  assert.ok(r.over && !r.extra, "player 0's side is empty");
  assert.equal(r.s[6], 21);
  assert.equal(r.s[13], 27);
  assert.equal(J(r.s.slice(0, 6).concat(r.s.slice(7, 13))), J([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  assert.equal(M.nextAfter(0, r), -1);
  // the capture that empties the opponent's side ends it too
  const s2 = B([0, 1, 0, 0, 0, 3], 10, [0, 0, 0, 4, 0, 0], 10);
  const r2 = M.sow(s2, 0, 1);
  assert.ok(r2.over);
  assert.equal(r2.s[6], 10 + 5 + 3);
  assert.equal(r2.s[13], 10);
});

test("mancala: random games keep every seed and end with all in the stores", () => {
  for (const seeds of [3, 4, 5, 6]) {
    for (let g = 0; g < 200; g++) {
      let s = M.startBoard(seeds), p = rnd(2), n = 0;
      const moves = [], starter = p;
      while (p >= 0) {
        const L = M.legalPits(s, p);
        assert.ok(L.length > 0, "a side to move always has seeds");
        const i = L[rnd(L.length)];
        const r = M.sow(s, p, i);
        assert.equal(total(r.s), seeds * 12);
        moves.push(i);
        s = r.s; p = M.nextAfter(p, r);
        assert.ok(++n < 500);
      }
      assert.equal(s[6] + s[13], seeds * 12);
      const rp = M.replay(seeds, starter, moves);
      assert.ok(rp.over && J(rp.s) === J(s), "replay matches");
    }
  }
  assert.equal(M.replay(4, 0, [7]), null, "a move on the other row is refused");
  assert.equal(M.replay(4, 0, [2, 2]), null, "an empty pit is refused");
});

test("mancala: every computer level plays a legal pit", () => {
  for (const lv of ["e", "m", "h"]) {
    for (let g = 0; g < (lv === "h" ? 6 : 40); g++) {
      let s = M.startBoard(4), p = rnd(2);
      while (p >= 0) {
        const L = M.legalPits(s, p);
        const i = p === 1 ? M.chooseMove(s, p, lv, 40) : L[rnd(L.length)];
        assert.ok(L.includes(i), lv + " legal " + i);
        const r = M.sow(s, p, i);
        s = r.s; p = M.nextAfter(p, r);
      }
    }
  }
});

test("mancala: the computer takes the extra turn when it is clearly best", () => {
  // Player 1: the pit next to its store (index 12) has 1 seed → extra
  // turn; every other move only feeds the opponent.
  const s = B([3, 3, 3, 3, 3, 3], 10, [2, 2, 2, 6, 6, 1], 10);
  for (const lv of ["m", "h"]) {
    for (let k = 0; k < 10; k++) assert.equal(M.chooseMove(s, 1, lv, 200), 12, lv);
  }
  // Player 0, a chain: index 5 (1 seed) then index 4 (2 seeds) both end in the store
  const s2 = B([0, 0, 0, 0, 2, 1], 12, [1, 1, 1, 1, 1, 1], 5);
  for (const lv of ["m", "h"]) {
    const i = M.chooseMove(s2, 0, lv, 200);
    assert.equal(i, 5, lv + " starts the chain with the 1-seed pit");
  }
});

test("mancala: Hard and Medium take a big capture", () => {
  // index 0 has 1 seed → index 1 empty, opposite (11) has 9
  const s = B([1, 0, 0, 0, 0, 3], 0, [1, 1, 1, 1, 9, 1], 0);
  for (const lv of ["m", "h"]) assert.equal(M.chooseMove(s, 0, lv, 200), 0, lv);
});

test("mancala: records merge is a join and a reset drops older rows", () => {
  const MG = M.mergeMancala;
  const st = () => {
    const rows = {};
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      ["e", "m", "h"].forEach((k) => { if (rnd(2)) s[k] = [rnd(5), rnd(5), rnd(3)]; });
      rows["d" + rnd(4)] = { b: rnd(3) * 100, s };
    }
    return { ver: 1, br: rnd(4) ? 0 : rnd(3) * 100, rows };
  };
  for (let i = 0; i < 5000; i++) {
    const a = st(), b = st(), c = st(), sa = J(a), sb = J(b);
    assert.equal(J(MG(a, b)), J(MG(b, a)));
    const m = MG(a, b);
    assert.equal(J(MG(m, m)), J(m));
    assert.equal(J(MG(MG(a, b), c)), J(MG(a, MG(b, c))));
    assert.equal(J(a), sa);
    assert.equal(J(b), sb);
  }
  const x = { rows: { d: { b: 5, s: { e: [3, 1, 0] } } } };
  const y = { rows: { d: { b: 5, s: { e: [2, 4, 1], h: [1, 0, 0] } } } };
  assert.equal(J(MG(x, y).rows.d.s), J({ e: [3, 4, 1], h: [1, 0, 0] }));
  assert.equal(J(MG(x, { rows: { d: { b: 9, s: { m: [1, 0, 0] } } } }).rows.d.s), J({ m: [1, 0, 0] }), "newer epoch wins");
  assert.equal(J(MG(x, { br: 6, rows: {} }).rows), "{}");
  for (const bad of [[1, 2], [1, -1, 0], [1, 1.5, 0], "x", null]) {
    assert.equal(J(MG({ rows: { d: { b: 0, s: { e: bad } } } }, null).rows), "{}", J(bad));
  }
  assert.equal(J(MG({ rows: { d: { b: -1, s: { e: [1, 0, 0] } } } }, null).rows), "{}");
  assert.equal(J(MG(null, undefined)), J({ ver: 1, br: 0, rows: {} }));
});
