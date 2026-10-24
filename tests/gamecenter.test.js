// Tests for gamecenter/core.js (Wave 49): per-game summaries read from
// the games' own synced data, Daily streaks and the computed
// achievements. The core only reads; nothing is stored.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../gamecenter/core.js");
const D = require("../gamekit/daily.js");

const TODAY = 286;
function reader(store) {
  return (key) => (Object.prototype.hasOwnProperty.call(store, key) ? JSON.parse(JSON.stringify(store[key])) : null);
}
function sum(store) { return C.summarize(reader(store), TODAY); }
function ach(s, id) { return C.achievements(s).find((a) => a.id === id); }

test("gamecenter: no data → everything empty, nothing done, no crash on junk", () => {
  const s = sum({});
  assert.equal(s.tot.p, 0);
  assert.equal(s.tot.w, 0);
  C.GAMES.forEach((id) => assert.equal(s.games[id].p, 0, id));
  C.DAILY.forEach((id) => {
    assert.equal(s.games[id].dn, 0);
    assert.equal(s.games[id].today, 0);
  });
  assert.ok(C.achievements(s).every((a) => !a.done && a.have === 0));
  const junk = {};
  C.GAMES.forEach((id, i) => {
    junk[C.keyOf(id)] = [null, 5, "x", [], { rows: 3 }, { rows: { a: { b: "x", s: 1 } }, days: [1] },
      { br: 9, rows: { a: { b: 1, s: { e: { n: 1, t: 1 } } } } }][i % 7];
  });
  const sj = sum(junk);
  assert.equal(sj.tot.p, 0, "junk and rows older than the reset count nothing");
  assert.equal(C.summarize(() => { throw new Error("x"); }, TODAY).tot.p, 0, "a failing read counts as no data");
});

test("gamecenter: per-game numbers from each schema; rows sum over devices", () => {
  const store = {
    "oros-sudoku-data": { ver: 1, br: 0, rows: {
      d1: { b: 0, s: { e: { t: 400000, ts: 1, n: 3, c: 2 }, k: { t: 0, ts: 0, n: 1, c: 0 } } },
      d2: { b: 0, s: { m: { t: 250000, ts: 1, n: 2, c: 1 } } } },
      days: { 284: { b: 0, t: 900000, h: 0, m: 0 }, 285: { b: 0, t: 1, h: 2, m: 3 }, 286: { b: 0, t: 1, h: 1, m: 1 } } },
    "oros-connect4-data": { ver: 1, br: 0, rows: { a: { b: 0, s: { e: [3, 1, 1], h: [1, 2, 0] } }, b: { b: 0, s: { m: [0, 4, 0] } } } },
    "oros-chess-data": { ver: 1, br: 0, rows: { a: { b: 0, s: { m: [2, 1, 5] } } } },
    "oros-g2048-data": { ver: 1, br: 0, rows: { a: { b: 0, s: { n4: { s: 9000, ts: 1, v: 1024, g: 4, w: 0 }, t4: { s: 12000, ts: 1, v: 2048, g: 1, w: 1 } } } } },
    "oros-minesweeper-data": { ver: 1, br: 0, rows: { a: { b: 0, s: { i: { t: 90000, ts: 1, w: 1, g: 3 } } } },
      days: { 286: { b: 0, w: 0, t: 5000, f: 12 }, 285: { b: 0, w: 1, t: 80000, f: 40 } } },
    "oros-wordle-data": { ver: 1, br: 0, rows: { a: { b: 0, s: { en: { g: 3, w: 2, h: [0, 1, 1, 0, 0, 0] } } } },
      days: { "en:285": { b: 0, r: 2 }, "el:285": { b: 0, r: 4 }, "en:286": { b: 0, r: 7 } } },
    "oros-crossword-data": { ver: 1, br: 0, rows: { a: { b: 0, s: { "en:m": { n: 2, t: 300, d: 1 } } } },
      days: { "en:286": { b: 0, t: 200, h: 1 } } },
    "oros-memory-data": { ver: 1, br: 5, best: { e: { id: "x", ts: 9, moves: 10, ms: 30000 } },
      games: [{ id: "a", ts: 4, lv: "e", mode: "solo", set: "a", moves: 9, ms: 1000 },
              { id: "b", ts: 9, lv: "e", mode: "solo", set: "a", moves: 10, ms: 30000 },
              { id: "c", ts: 10, lv: "e", mode: "duo", set: "a", moves: 10, ms: 9, s: [3, 2] }] },
    "oros-solitaire-data": { ver: 1, br: 0, rows: { a: { b: 0, s: {
      k1c: { p: 5, w: 2, k: 1, t: 200000, tt: 1 }, s2: { p: 2, w: 1, k: 1, t: 400000, tt: 1 }, p: { p: 3, w: 0, k: 0 } } } } },
    "oros-pong-data": { ver: 1, br: 0, rows: { a: { b: 0, s: { h: { w: 1, l: 2, m: 3, ts: 1 }, p2: { g: 4 } } } } },
    "oros-tetris-data": { ver: 1, br: 2, rows: { old: { b: 1, s: { 1: { n: 99999, ts: 1, l: 5, g: 9 } } }, a: { b: 2, s: { 1: { n: 500, ts: 1, l: 5, g: 2 } } } } }
  };
  const s = sum(store), g = s.games;
  assert.deepEqual([g.sudoku.p, g.sudoku.w, g.sudoku.t], [6, 6, 250000]);
  assert.deepEqual([g.sudoku.dn, g.sudoku.cur, g.sudoku.best, g.sudoku.today], [3, 3, 3, 1]);
  assert.deepEqual([g.connect4.p, g.connect4.w], [12, 4]);
  assert.deepEqual([g.chess.p, g.chess.w], [8, 2]);
  assert.deepEqual([g.g2048.p, g.g2048.w, g.g2048.sc], [5, 1, 12000]);
  // Minesweeper: today's daily was lost; yesterday's won → streak 1
  assert.deepEqual([g.minesweeper.p, g.minesweeper.w, g.minesweeper.t, g.minesweeper.dn, g.minesweeper.cur, g.minesweeper.today],
    [3, 1, 90000, 1, 1, 2]);
  // Wordle: free 3/2 + daily 3 played (2 days in 2 languages, 1 lost), 2 won; streak counts days
  assert.deepEqual([g.wordle.p, g.wordle.w, g.wordle.dn, g.wordle.cur, g.wordle.today], [6, 4, 1, 1, 2]);
  // Crossword: times in seconds → ms
  assert.deepEqual([g.crossword.p, g.crossword.w, g.crossword.t, g.crossword.today], [3, 3, 200000, 1]);
  // Memory: games at or before br are gone; duo games are played, not solved
  assert.deepEqual([g.memory.p, g.memory.w, g.memory.t], [2, 1, 30000]);
  assert.deepEqual([g.solitaire.p, g.solitaire.w, g.solitaire.t], [10, 3, 200000]);
  assert.deepEqual([g.pong.p, g.pong.w], [7, 1]);
  assert.deepEqual([g.tetris.p, g.tetris.w, g.tetris.sc], [2, -1, 500], "a row older than the reset is skipped");
  assert.equal(s.tot.p, Object.values(g).reduce((a, x) => a + x.p, 0));
  // Daily overview: days with any Daily solved
  assert.equal(s.perDay[286], 2);     // sudoku + crossword (wordle lost, minesweeper lost)
  assert.equal(s.perDay[285], 3);     // sudoku + minesweeper + wordle
  assert.deepEqual([s.daily.cur, s.daily.best, s.daily.todayDone], [3, 3, 2]);
  // achievements
  assert.ok(ach(s, "first").done);
  assert.ok(ach(s, "daily1").done);
  assert.ok(ach(s, "clean").done, "Sudoku day 284 without hints");
  assert.ok(ach(s, "wordle2").done);
  assert.ok(ach(s, "killer").done);
  assert.ok(ach(s, "hard").done, "Connect 4 won on Hard, Pong lost and won on Hard");
  assert.ok(ach(s, "speedy").done, "Sudoku in 4:10");
  assert.equal(ach(s, "expert").done, false);
  assert.deepEqual([ach(s, "cards").have, ach(s, "cards").need], [2, 4]);
  assert.deepEqual([ach(s, "sweep").have, ach(s, "sweep").need], [3, 6]);
  assert.deepEqual([ach(s, "streak7").have, ach(s, "streak7").done], [3, false]);
});

test("gamecenter: streaks match gamekit; sweep, streak7 and the counters complete", () => {
  for (let i = 0; i < 300; i++) {
    const on = {};
    for (let d = TODAY - 20; d <= TODAY; d++) if (Math.random() < 0.6) on[d] = true;
    assert.deepEqual(C.streaks(on, TODAY), D.streaks(on, TODAY));
  }
  const days = {};
  for (let d = TODAY - 6; d <= TODAY; d++) days[d] = { b: 0, t: 1000, h: 0, m: 0, k: 6 };
  const store = {
    "oros-flow-data": { ver: 1, br: 0, rows: {}, days },
    "oros-sudoku-data": { ver: 1, br: 0, rows: {}, days: { [TODAY]: { b: 0, t: 1, h: 0, m: 0 } } },
    "oros-nonogram-data": { ver: 1, br: 0, rows: {}, days: { [TODAY]: { b: 0, t: 1, h: 3, m: 7 } } },
    "oros-minesweeper-data": { ver: 1, br: 0, rows: {}, days: { [TODAY]: { b: 0, w: 1, t: 1, f: 40 } } },
    "oros-wordle-data": { ver: 1, br: 0, rows: {}, days: { ["el:" + TODAY]: { b: 0, r: 5 } } },
    "oros-crossword-data": { ver: 1, br: 0, rows: {}, days: { ["en:" + TODAY]: { b: 0, t: 99, h: 1 } } },
    "oros-solitaire-data": { ver: 1, br: 0, rows: { a: { b: 0, s: { k3n: { p: 1, w: 1, k: 1 }, f: { p: 1, w: 1, k: 1 }, s4: { p: 1, w: 1, k: 1 }, p: { p: 1, w: 1, k: 1 } } } } },
    "oros-minesweeper-data-x": null
  };
  store["oros-minesweeper-data"].rows = { a: { b: 0, s: { e: { t: 99000, ts: 1, w: 1, g: 1 } } } };
  const s = sum(store);
  assert.equal(s.games.flow.cur, 7);
  assert.ok(ach(s, "streak7").done);
  assert.ok(ach(s, "sweep").done);
  assert.ok(ach(s, "cards").done);
  assert.ok(ach(s, "expert").done);
  assert.equal(s.daily.todayDone, 6);
  // a reset (br newer than the days) clears the dailies
  store["oros-flow-data"].br = 5;
  assert.equal(sum(store).games.flow.dn, 0);
  // counters
  const many = { "oros-tictactoe-data": { ver: 1, br: 0, rows: { a: { b: 0, s: { e: [260, 0, 0] } } } } };
  const sm = sum(many);
  assert.ok(ach(sm, "played100").done);
  assert.ok(ach(sm, "wins250").done);
  assert.equal(ach(sm, "variety").have, 1);
  assert.ok(C.achievements(sm).every((a) => a.have <= a.need));
});

test("gamecenter: the core never writes what it reads", () => {
  const store = { "oros-sudoku-data": { ver: 1, br: 0, rows: { a: { b: 0, s: { e: { t: 1, ts: 1, n: 1, c: 1 } } } }, days: { 1: { b: 0, t: 1, h: 0, m: 0 } } } };
  const before = JSON.stringify(store);
  C.summarize((k) => store[k] || null, TODAY);
  assert.equal(JSON.stringify(store), before);
});

test("gamecenter: All games groups list every game exactly once, every Games app is known", () => {
  const seen = [];
  C.GROUPS.forEach((g) => { assert.ok(g.games.length > 0, g.id); seen.push(...g.games); });
  assert.deepEqual([...seen].sort(), [...C.GAMES].sort());
  assert.equal(new Set(seen).size, seen.length);
  const fs = require("fs"), path = require("path");
  const apps = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "apps.json"), "utf8")).apps;
  const games = apps.filter((a) => a.category === "Games" && a.id !== "gamecenter").map((a) => a.id);
  assert.deepEqual([...games].sort(), [...C.GAMES].sort());
  // Each group's heading has words in both languages.
  const src = fs.readFileSync(path.join(__dirname, "..", "gamecenter", "gamecenter.js"), "utf8");
  C.GROUPS.forEach((g) => assert.equal(src.split('"all.g.' + g.id + '"').length - 1, 2, g.id));
});
