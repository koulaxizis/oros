// Pure logic of Backgammon: entering from the bar, hitting, bearing
// off (a higher die from the highest point), the "use as many dice as
// possible / the larger die" rules, doubles, gammon and backgammon
// scoring, the computer players and the records merge.
// Run: node --test tests/
//
// The app is a browser IIFE with no exports, so the pure functions are
// cut out of the source by name and evaluated on their own. A renamed
// function or section fails here loudly ("missing …").

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { webcrypto } = require("crypto");

const SRC = fs.readFileSync(path.join(__dirname, "..", "backgammon/backgammon.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

const E = (() => {
  const parts = [
    cut("  var LEVELS", "  // ---------- 1."),
    cut("  function cmpStr(", "  function reducedMotion("),      // cmpStr, isInt, now, randInt
    cut("  // ---------- 2. Board model", "  // ---------- 4. Synced data"),
    cut("  function normCell(", "  // Totals per level")
  ];
  const DATA_VER = "  var DATA_VER = 1;";
  return new Function("crypto", "performance", "window", DATA_VER + parts.join("\n") +
    "\nreturn { startPos, stepsFor, applyStep, isHit, legalSteps, allPlays, maxUse, pips, winPoints," +
    " diceOf, chooseMove, evaluate, mergeBackgammon };")(webcrypto, performance, { performance });
})();

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);
const z = () => new Array(26).fill(0);
// A position from {point: count} maps, each in its owner's numbering
// (1–24 points, 25 the bar, 0 borne off).
function pos(white, black) {
  const w = z(), b = z();
  Object.keys(white).forEach((k) => { w[+k] = white[k]; });
  Object.keys(black).forEach((k) => { b[+k] = black[k]; });
  return [w, b];
}
const total = (m) => m.reduce((a, b) => a + b, 0);
const stepKey = (s) => s.f + "/" + s.t + ":" + s.d;
const keys = (list) => list.map(stepKey).sort();

test("backgammon: the start position and pip counts", () => {
  const c = E.startPos();
  assert.equal(total(c[0]), 15);
  assert.equal(total(c[1]), 15);
  assert.equal(E.pips(c[0]), 167);
  assert.equal(E.pips(c[1]), 167);
  // White 24 sits on Black's 1, and so on: no point is shared
  for (let i = 1; i <= 24; i++) assert.ok(!(c[0][i] && c[1][25 - i]));
  assert.equal(J(E.diceOf(3, 5)), J([3, 5]));
  assert.equal(J(E.diceOf(4, 4)), J([4, 4, 4, 4]));
});

test("backgammon: a checker on the bar must enter first; closed points block", () => {
  // White on the bar; Black holds White's entry points 20 and 22
  // (Black's own 5 and 3).
  const c = pos({ 25: 1, 13: 14 }, { 5: 2, 3: 2, 6: 11 });
  assert.equal(keys(E.legalSteps(c, 0, [5, 3])).join(), "", "5 → 20 and 3 → 22 are both closed");
  const L = E.legalSteps(c, 0, [4, 3]);
  assert.equal(keys(L).join(), "25/21:4", "only the bar checker moves, only into an open point");
  // after entering, the second die may move any checker
  const c2 = E.applyStep(c, 0, L[0]);
  assert.equal(c2[0][25], 0);
  const L2 = E.legalSteps(c2, 0, [3]);
  assert.ok(L2.some((s) => s.f === 13), "free to move after entering");
  // two on the bar: both dice must enter
  const c3 = pos({ 25: 2, 13: 13 }, { 8: 15 });
  for (const pl of E.allPlays(c3, 0, [6, 2])) {
    assert.ok(pl.seq.every((s) => s.f === 25), "both steps enter");
    assert.equal(pl.c[0][25], 0);
  }
  // a closed board: no legal play at all
  const shut = pos({ 25: 1, 6: 14 }, { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 5 });
  assert.equal(E.maxUse(shut, 0, [6, 6, 6, 6], {}), 0);
  assert.equal(J(E.allPlays(shut, 0, [3, 1])), J([{ c: shut, seq: [] }]));
});

test("backgammon: hitting a blot sends it to the bar", () => {
  const c = pos({ 13: 15 }, { 15: 1, 6: 14 });  // Black's 15 = White's 10
  const s = { f: 13, t: 10, d: 3 };
  assert.ok(E.isHit(c, 0, s));
  const n = E.applyStep(c, 0, s);
  assert.equal(n[1][15], 0);
  assert.equal(n[1][25], 1);
  assert.equal(n[0][10], 1);
  assert.equal(c[1][25], 0, "input not mutated");
  // two checkers make a point: cannot land there
  const c2 = pos({ 13: 15 }, { 15: 2, 6: 13 });
  assert.ok(!E.stepsFor(c2, 0, 3).some((x) => x.t === 10));
});

test("backgammon: bearing off, exact and with a higher die", () => {
  const c = pos({ 4: 2, 2: 3, 0: 10 }, { 12: 15 });
  // exact: a 4 bears off from 4, a 2 from 2
  assert.ok(E.stepsFor(c, 0, 4).some((s) => s.f === 4 && s.t === 0));
  assert.ok(E.stepsFor(c, 0, 2).some((s) => s.f === 2 && s.t === 0));
  // a 6 is higher than every checker: only from the highest point (4)
  const six = E.stepsFor(c, 0, 6);
  assert.equal(keys(six).join(), "4/0:6");
  // a 3: moves 4 → 1, but no bear-off from 2 (a checker on 4 is higher)
  assert.equal(keys(E.stepsFor(c, 0, 3)).join(), "4/1:3");
  // not all home: no bearing off at all
  const out = pos({ 7: 1, 4: 2, 0: 12 }, { 12: 15 });
  assert.ok(!E.stepsFor(out, 0, 4).some((s) => s.t === 0));
  // a checker hit back home blocks bearing off again
  const bar = pos({ 25: 1, 3: 14 }, { 12: 15 });
  assert.ok(E.legalSteps(bar, 0, [6, 5]).every((s) => s.f === 25));
});

test("backgammon: as many dice as possible must be played", () => {
  // White 9, 12 and 13 on the 1-point; Black closes White's 4, 5, 7,
  // 11 and 15. With 3-5: 12→9 (the 3) leaves no 5 anywhere, but 9→6
  // then 6→1 uses both dice, so that is the only legal start.
  const c = pos({ 9: 1, 12: 1, 1: 13 }, { 10: 2, 14: 2, 18: 3, 20: 2, 21: 6 });
  assert.equal(E.maxUse(c, 0, [3, 5], {}), 2);
  assert.ok(E.stepsFor(c, 0, 3).some((s) => s.f === 12), "12→9 exists as a single move");
  assert.equal(keys(E.legalSteps(c, 0, [3, 5])).join(), "9/6:3");
  for (const pl of E.allPlays(c, 0, [3, 5])) assert.equal(pl.seq.length, 2);
});

test("backgammon: only one die playable → the larger one", () => {
  // White 22, 23 and 13 on the 1-point; Black closes White's 3, 5, 8,
  // 17, 18 and 20. With 2-4 either 23→21 or 23→19 is possible, never
  // both dice: the 4 must be played.
  const c = pos({ 22: 1, 23: 1, 1: 13 }, { 5: 2, 7: 3, 8: 2, 17: 2, 20: 3, 22: 3 });
  assert.equal(E.maxUse(c, 0, [2, 4], {}), 1);
  assert.ok(E.stepsFor(c, 0, 2).length > 0, "the 2 alone is playable");
  assert.equal(keys(E.legalSteps(c, 0, [2, 4])).join(), "23/19:4");
  const plays = E.allPlays(c, 0, [2, 4]);
  assert.equal(plays.length, 1);
  assert.equal(plays[0].seq[0].d, 4);
  // …but when only the smaller can be played, it must be
  const c2 = pos({ 23: 1, 1: 14 }, { 7: 2, 8: 2, 6: 11 });   // closes White's 18 and 17
  assert.equal(keys(E.legalSteps(c2, 0, [1, 5])).join(), "23/22:1");
});

test("backgammon: doubles play four times", () => {
  const c = E.startPos();
  const plays = E.allPlays(c, 0, E.diceOf(6, 6));
  assert.ok(plays.length > 0);
  for (const pl of plays) {
    assert.equal(pl.seq.length, 4);
    assert.ok(pl.seq.every((s) => s.d === 6));
    assert.equal(E.pips(pl.c[0]), 167 - 24);
  }
  // blocked after two: only as many as possible
  const c2 = pos({ 24: 2, 1: 13 }, { 9: 2, 13: 13 });   // closes White's 16 and 12
  const L = E.allPlays(c2, 0, [4, 4, 4, 4]);
  assert.ok(L.every((pl) => pl.seq.length === L[0].seq.length));
  assert.equal(E.maxUse(c2, 0, [4, 4, 4, 4], {}), L[0].seq.length);
  assert.ok(L[0].seq.length < 4, "the closed points stop the 4s");
});

test("backgammon: single game, gammon and backgammon", () => {
  // White has borne off all 15
  assert.equal(E.winPoints(pos({ 0: 15 }, { 0: 1, 3: 14 }), 0), 1, "Black bore one off");
  assert.equal(E.winPoints(pos({ 0: 15 }, { 8: 15 }), 0), 2, "gammon");
  // Black's 19–24 is White's home board; 25 the bar
  assert.equal(E.winPoints(pos({ 0: 15 }, { 20: 1, 8: 14 }), 0), 3, "backgammon: in the winner's home");
  assert.equal(E.winPoints(pos({ 0: 15 }, { 25: 1, 8: 14 }), 0), 3, "backgammon: on the bar");
  assert.equal(E.winPoints(pos({ 0: 1, 20: 14 }, { 0: 15 }), 1), 1, "Black wins, White bore one off");
  assert.equal(E.winPoints(pos({ 19: 15 }, { 0: 15 }), 1), 3, "White still in Black's home");
});

test("backgammon: every computer level plays a legal play, games finish", () => {
  for (const lv of ["e", "m", "h"]) {
    for (let g = 0; g < (lv === "h" ? 2 : 6); g++) {
      let c = E.startPos(), p = rnd(2), n = 0;
      while (c[0][0] < 15 && c[1][0] < 15) {
        const a = 1 + rnd(6), b = 1 + rnd(6), dice = E.diceOf(a, b);
        const plays = E.allPlays(c, p, dice);
        const pick = E.chooseMove(c, p, dice, p === 1 ? lv : "e", 60);
        const fk = J(pick.c);
        assert.ok(plays.some((x) => J(x.c) === fk), lv + " picked a legal play");
        // replaying the steps one by one gives the same position
        let r = c;
        for (const s of pick.seq) {
          assert.ok(E.stepsFor(r, p, s.d).some((x) => x.f === s.f && x.t === s.t), "step legal");
          r = E.applyStep(r, p, s);
        }
        assert.equal(J(r), fk);
        assert.equal(total(r[0]), 15);
        assert.equal(total(r[1]), 15);
        c = r; p = 1 - p;
        assert.ok(++n < 600, "the game ends");
      }
    }
  }
});

test("backgammon: Medium and Hard hit a blot that costs a lot, and bear off to win", () => {
  // White's last checker sits on its 24; Black's blot on its 3-point
  // (White's 22) is 2 away: hitting it costs Black 22 pips and leaves it
  // facing White's closed 4-, 5- and 6-points.
  const c = pos({ 24: 1, 6: 5, 5: 5, 4: 4 }, { 3: 1, 6: 4, 5: 5, 4: 5 });
  for (const lv of ["m", "h"]) {
    const pl = E.chooseMove(c, 0, [2, 1], lv, 300);
    assert.equal(pl.c[1][25], 1, lv + " hits");
  }
  // the computer takes a winning bear-off
  const w = pos({ 1: 1, 2: 1, 0: 13 }, { 12: 15 });
  for (const lv of ["m", "h"]) assert.equal(E.chooseMove(w, 0, [2, 1], lv, 300).c[0][0], 15, lv);
});

test("backgammon: records merge is a join and a reset drops older rows", () => {
  const MG = E.mergeBackgammon;
  const cell = () => { const w = rnd(4), l = rnd(4); return [w, l, w + rnd(2 * w + 1), l + rnd(2 * l + 1)]; };
  const st = () => {
    const rows = {};
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      ["e", "m", "h"].forEach((k) => { if (rnd(2)) s[k] = cell(); });
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
  // equal epochs: the copy with more games is the newer one
  const x = { rows: { d: { b: 5, s: { e: [3, 1, 4, 1] } } } };
  const y = { rows: { d: { b: 5, s: { e: [3, 2, 4, 3], h: [1, 0, 2, 0] } } } };
  assert.equal(J(MG(x, y).rows.d.s), J({ e: [3, 2, 4, 3], h: [1, 0, 2, 0] }));
  assert.equal(J(MG(x, { rows: { d: { b: 9, s: { m: [1, 0, 1, 0] } } } }).rows.d.s), J({ m: [1, 0, 1, 0] }), "newer epoch wins");
  assert.equal(J(MG(x, { br: 6, rows: {} }).rows), "{}", "a reset drops older rows");
  for (const bad of [[1, 2], [1, -1, 0, 0], [1, 1.5, 1, 1], [1, 0, 4, 0], [1, 0, 0, 0], "x", null]) {
    assert.equal(J(MG({ rows: { d: { b: 0, s: { e: bad } } } }, null).rows), "{}", J(bad));
  }
  assert.equal(J(MG({ rows: { d: { b: -1, s: { e: [1, 0, 1, 0] } } } }, null).rows), "{}");
  assert.equal(J(MG(null, undefined)), J({ ver: 1, br: 0, rows: {} }));
});
