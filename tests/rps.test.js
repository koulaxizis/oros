// Pure logic of Rock Paper Scissors: the outcome table, the computer's
// predictors per level and the records merge.
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

const SRC = fs.readFileSync(path.join(__dirname, "..", "rps/rps.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

const R = (() => {
  const parts = [cut("  var DATA_VER", "  // ---------- 1.")];
  ["cmpStr", "isInt", "keyMove", "outcome", "counter", "topMoves", "chainPredict", "roundPredict", "guesses",
   "hardPredict", "chooseMove", "normCell", "normRow", "joinRows", "mergeRps"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    parts.push(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function(parts.join("\n") +
    "\nreturn { keyMove, outcome, counter, topMoves, chainPredict, roundPredict, hardPredict, chooseMove, mergeRps };")();
})();

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);
function seeded(s) {
  return () => { s = (s * 1103515245 + 12345) >>> 0; return (s >>> 8) / 16777216; };
}
const ROCK = 0, PAPER = 1, SCISSORS = 2;

test("rps: the outcome table", () => {
  // 0 draw, 1 first wins, 2 second wins
  const table = [
    [ROCK, ROCK, 0], [ROCK, PAPER, 2], [ROCK, SCISSORS, 1],
    [PAPER, ROCK, 1], [PAPER, PAPER, 0], [PAPER, SCISSORS, 2],
    [SCISSORS, ROCK, 2], [SCISSORS, PAPER, 1], [SCISSORS, SCISSORS, 0]
  ];
  for (const [a, b, r] of table) assert.equal(R.outcome(a, b), r, a + " vs " + b);
  for (let m = 0; m < 3; m++) {
    assert.equal(R.outcome(R.counter(m), m), 1, "counter beats");
    assert.equal(R.outcome(m, R.counter(m)), 2);
  }
  // keys: the typed letter R P S / Π Χ Ψ, digits 1 2 3, else the physical R P S
  assert.equal(R.keyMove("r", "KeyR"), ROCK);
  assert.equal(R.keyMove("P", "KeyP"), PAPER);
  assert.equal(R.keyMove("s", "KeyS"), SCISSORS);
  assert.equal(R.keyMove("π", "KeyP"), ROCK);
  assert.equal(R.keyMove("χ", "KeyX"), PAPER);
  assert.equal(R.keyMove("ψ", "KeyC"), SCISSORS);
  assert.equal(R.keyMove("ρ", "KeyR"), ROCK);
  assert.equal(R.keyMove("σ", "KeyS"), SCISSORS);
  assert.equal(R.keyMove("!", "Digit1"), ROCK);
  assert.equal(R.keyMove("3", "Numpad3"), SCISSORS);
  assert.equal(R.keyMove("n", "KeyN"), -1);
  assert.equal(R.keyMove("Enter", "Enter"), -1);
});

// Plays `rounds` rounds of a level against a fixed player; returns the
// computer's [wins, draws, losses].
function run(level, player, rounds, rng) {
  const hist = [], out = [0, 0, 0];
  for (let i = 0; i < rounds; i++) {
    const c = R.chooseMove(level, hist, rng);
    const y = player(i, hist);
    assert.ok(c >= 0 && c <= 2 && y >= 0 && y <= 2);
    const r = R.outcome(c, y);
    out[r === 1 ? 0 : (r === 0 ? 1 : 2)]++;
    hist.push([y, c]);
    if (hist.length > 200) hist.shift();
  }
  return out;
}

test("rps: Easy is random", () => {
  const rng = seeded(7), n = [0, 0, 0];
  for (let i = 0; i < 3000; i++) n[R.chooseMove("e", [[ROCK, ROCK], [ROCK, PAPER]], rng)]++;
  for (const k of n) assert.ok(k > 850 && k < 1150, J(n));
  // against a rock-only player Easy wins only about a third
  const r = run("e", () => ROCK, 600, seeded(3));
  assert.ok(r[0] > 130 && r[0] < 270, J(r));
});

test("rps: Medium counters your most frequent move", () => {
  const hist = [[ROCK, 0], [ROCK, 1], [PAPER, 2], [ROCK, 0]];
  for (let i = 0; i < 50; i++) assert.equal(R.chooseMove("m", hist, Math.random), PAPER);
  assert.deepEqual(R.topMoves([[SCISSORS, 0], [PAPER, 0]], 200).sort(), [PAPER, SCISSORS]);
  // on a tie it counters one of the leaders, never the third move's counter
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(R.chooseMove("m", [[SCISSORS, 0], [PAPER, 0]], Math.random));
  assert.deepEqual([...seen].sort(), [ROCK, SCISSORS]);
  // a player who favours rock loses most rounds to Medium
  const r = run("m", (i) => (i % 4 === 3 ? PAPER : ROCK), 300, seeded(5));
  assert.ok(r[0] > 0.6 * 300, J(r));
});

test("rps: the chain predictors read patterns", () => {
  const H = (ys) => ys.map((y) => [y, 0]);
  assert.equal(R.chainPredict(H([0, 1, 2, 0, 1, 2, 0]), 1, 100), 1);          // after rock: paper
  assert.equal(R.chainPredict(H([0, 0, 1, 1, 0, 0, 1, 1, 0]), 2, 100), 0);    // after 1 then 0: 0
  assert.equal(R.chainPredict(H([0, 0, 1, 1, 0, 0, 1, 1, 0, 0]), 2, 100), 1); // after 0, 0: 1
  assert.equal(R.chainPredict(H([2]), 1, 100), -1);
  assert.equal(R.chainPredict([], 2, 100), -1);
  // win-stay / lose-shift: the round predictor sees (you, computer) pairs
  assert.equal(R.roundPredict([[0, 2], [0, 1], [2, 2], [0, 2], [0, 1]], 100), 2);
  assert.equal(R.hardPredict([]), -1);
});

test("rps: Hard beats a fixed cyclic pattern more than 80% over 300 rounds", () => {
  const patterns = [
    [ROCK, PAPER, SCISSORS],
    [SCISSORS, PAPER, ROCK],
    [ROCK, ROCK, PAPER, PAPER, SCISSORS, SCISSORS],
    [PAPER, PAPER, ROCK],
    [ROCK, SCISSORS, SCISSORS, PAPER]
  ];
  for (const p of patterns) {
    const r = run("h", (i) => p[i % p.length], 300, seeded(11));
    assert.ok(r[0] / 300 > 0.8, J(p) + " → " + J(r));
  }
  // also a reactive player: always plays what would have beaten the computer's last move
  const r = run("h", (i, hist) => (hist.length ? R.counter(hist[hist.length - 1][1]) : ROCK), 300, seeded(13));
  assert.ok(r[0] / 300 > 0.8, "reactive " + J(r));
  // Medium does not read a cycle (it only counts)
  const m = run("m", (i) => [ROCK, PAPER, SCISSORS][i % 3], 300, seeded(17));
  assert.ok(m[0] / 300 < 0.6, "medium vs cycle " + J(m));
});

test("rps: Hard stays near even against a random player", () => {
  const rng = seeded(19), pr = seeded(23);
  const r = run("h", () => Math.floor(pr() * 3), 900, rng);
  assert.ok(r[0] / 900 < 0.42 && r[2] / 900 < 0.42, J(r));
});

test("rps: records merge is a join and a reset drops older rows", () => {
  const M = R.mergeRps, lvs = ["e", "m", "h"];
  const cell = () => { const rw = rnd(9); return [rnd(4), rnd(4), rw, rnd(9), rnd(9), rnd(rw + 1)]; };
  const st = () => {
    const rows = {};
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      lvs.forEach((k) => { if (rnd(2)) s[k] = cell(); });
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
  const x = { rows: { d: { b: 0, s: { h: [1, 0, 5, 2, 3, 4] } } } };
  const y = { rows: { d: { b: 0, s: { h: [0, 2, 6, 1, 3, 2], e: [0, 0, 1, 0, 0, 1] } } } };
  assert.equal(J(M(x, y).rows.d.s), J({ e: [0, 0, 1, 0, 0, 1], h: [1, 2, 6, 2, 3, 4] }));
  assert.equal(J(M(x, { rows: { d: { b: 9, s: { m: [0, 0, 0, 1, 0, 0] } } } }).rows.d.s), J({ m: [0, 0, 0, 1, 0, 0] }));
  assert.equal(J(M(x, { br: 5, rows: {} }).rows), "{}");
  for (const bad of [[1, 2, 3], [0, 0, 1, 0, 0, 2], [-1, 0, 0, 0, 0, 0], [0, 0, 0.5, 0, 0, 0], "x"]) {
    assert.equal(J(M({ rows: { d: { b: 0, s: { m: bad } } } }, null).rows), "{}", J(bad));
  }
  assert.equal(J(M(undefined, null)), J({ ver: 1, br: 0, rows: {} }));
});
