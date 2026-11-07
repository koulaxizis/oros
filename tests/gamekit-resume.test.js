// Tests for gamekit/resume.js (GR-1): which games have a game in
// progress, read from their own device-local sessions.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const R = require("../gamekit/resume.js");

function reader(map) {
  return (k) => (Object.prototype.hasOwnProperty.call(map, k) ? JSON.parse(JSON.stringify(map[k])) : null);
}
const one = (id, s) => R.inProgress(id, reader({ ["oros-" + id + "-session"]: s }));

// The Game Center is the only Games app with no game of its own.
const NO_SESSION = ["gamecenter"];

test("resume: every game in apps.json is known, and each one keeps a session", () => {
  const apps = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "apps.json"), "utf8")).apps;
  const games = apps.filter((a) => a.category === "Games").map((a) => a.id);
  for (const id of games) {
    if (NO_SESSION.includes(id)) continue;
    assert.ok(R.GAMES.includes(id), id + " is missing from gamekit/resume.js");
    const src = fs.readFileSync(path.join(__dirname, "..", id, id + ".js"), "utf8");
    if (id !== "jigsaw") assert.ok(src.includes('"oros-' + id + '-session"'), id + " keeps oros-" + id + "-session");
  }
  for (const id of R.GAMES) assert.ok(games.includes(id), id + " is a Games app");
});

test("resume: no session, junk or a finished game is not in progress", () => {
  for (const id of R.GAMES) {
    if (id === "jigsaw") continue;
    assert.equal(R.inProgress(id, reader({})), false, id + " without a session");
    assert.equal(R.inProgress(id, () => { throw new Error("bad"); }), false, id + " unreadable");
    assert.equal(one(id, [1, 2]), false, id + " array");
  }
  assert.equal(R.inProgress("nope", reader({})), null);
  assert.equal(R.inProgress("jigsaw", reader({})), null);   // kept in IndexedDB
});

test("resume: turn games count moves until the game is done", () => {
  for (const id of ["connect4", "dots", "tictactoe", "gomoku", "checkers", "reversi", "mancala", "chess"]) {
    assert.equal(one(id, { mode: "ai", moves: [], done: false }), false, id + " fresh");
    assert.equal(one(id, { mode: "ai", moves: [4, 3], done: false }), true, id + " under way");
    assert.equal(one(id, { mode: "ai", moves: [4, 3], done: true }), false, id + " done");
  }
  for (const id of ["slider", "lightsout", "hexagon", "flow"]) {
    assert.equal(one(id, { moves: 0, done: false }), false, id);
    assert.equal(one(id, { moves: 3, done: false }), true, id);
    assert.equal(one(id, { moves: 3, done: true }), false, id);
  }
});

test("resume: real-time games are in progress while their session exists", () => {
  for (const id of ["snake", "tetris", "breakout", "pong"]) {
    assert.equal(one(id, { score: 0 }), true, id);
  }
});

test("resume: each game's own test", () => {
  assert.equal(one("memory", { done: false, moves: 0, open: [] }), false);
  assert.equal(one("memory", { done: false, moves: 0, open: [3] }), true);
  assert.equal(one("g2048", { moves: 2, over: false }), true);
  assert.equal(one("simon", { pads: 4, mode: "c", seq: [] }), false);
  assert.equal(one("simon", { pads: 4, mode: "c", seq: [2, 0] }), true);
  assert.equal(one("whack", { level: "e", ev: [], i: 0, acc: 9000, score: 3 }), true);
  assert.equal(one("g2048", { moves: 2, over: true }), false);
  assert.equal(one("wordle", { "en:d": { done: true, guesses: ["crane"] }, "el:f": { done: false, guesses: [] } }), false);
  assert.equal(one("wordle", { "en:f": { done: false, guesses: ["crane"] } }), true);
  assert.equal(one("spot", { over: false, found: [], misses: 0, hints: 0, el: 1000 }), false);
  assert.equal(one("spot", { over: false, found: [2], misses: 0, hints: 0, el: 1000 }), true);
  const v = new Array(81).fill(0), nt = new Array(81).fill(0);
  assert.equal(one("sudoku", { done: false, hints: 0, v, nt }), false);
  assert.equal(one("sudoku", { done: false, hints: 0, v: v.map((x, i) => (i === 5 ? 3 : 0)), nt }), true);
  assert.equal(one("minesweeper", { over: false, mines: null }), false);
  assert.equal(one("minesweeper", { over: false, mines: [1, 2] }), true);
  assert.equal(one("mahjong", { over: false, go: false }), false);
  assert.equal(one("mahjong", { over: false, go: true }), true);
  assert.equal(one("bubble", { over: false, moves: 1 }), true);
  assert.equal(one("mastermind", { done: false, rows: [], cur: [-1, -1, -1, -1] }), false);
  assert.equal(one("mastermind", { done: false, rows: [], cur: [-1, 2, -1, -1] }), true);
  assert.equal(one("battleship", { phase: "place", myShots: [] }), false);
  assert.equal(one("battleship", { phase: "play", myShots: [5] }), true);
  assert.equal(one("battleship", { phase: "done", myShots: [5] }), false);
  assert.equal(one("rps", { done: false, rounds: 0 }), false);
  assert.equal(one("rps", { done: false, rounds: 2 }), true);
  assert.equal(one("hangman", { en: { done: false, guessed: ["e"] } }), true);
  assert.equal(one("hangman", { en: { done: false, guessed: [] } }), false);
  assert.equal(one("hangman", { en: { lang: "en", word: "CHUCK", guessed: "", done: false } }), false);
  assert.equal(one("hangman", { en: { lang: "en", word: "CHUCK", guessed: "EA", done: false } }), true);
  assert.equal(one("nonogram", { done: false, hints: 0, c: [0, 0, 0] }), false);
  assert.equal(one("nonogram", { done: false, hints: 0, c: [0, 1, 0] }), true);
  assert.equal(one("backgammon", { phase: "roll", turn: -1 }), false);
  assert.equal(one("backgammon", { phase: "move", turn: 0 }), true);
  assert.equal(one("backgammon", { phase: "done", turn: 0 }), false);
  assert.equal(one("wordsearch", { "en:f": { done: false, found: [], ms: 3000 } }), false);
  assert.equal(one("wordsearch", { "en:f": { done: false, found: [1], ms: 3000 } }), true);
  assert.equal(one("solitaire", { k: { g: {}, u: [], t: 2000, c: false } }), false);
  assert.equal(one("solitaire", { k: { g: {}, u: [{}], t: 2000, c: false } }), true);
  assert.equal(one("crossword", { "en:d": { done: false, fill: "--..", giv: [], ms: 0 } }), false);
  assert.equal(one("crossword", { "en:d": { done: false, fill: "-A..", giv: [], ms: 0 } }), true);
  assert.equal(one("crossword", { "en:d": { done: false, fill: "-A..", giv: [1], ms: 0 } }), false);
  const deal = { phase: "play", hs: 6, dn: 1, won: [[], []], hands: [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12]], deck: new Array(36).fill(0) };
  assert.equal(one("xeri", deal), false);
  assert.equal(one("xeri", Object.assign({}, deal, { hands: [[1, 2, 3, 4, 5], [7, 8, 9, 10, 11, 12]] })), true);
  assert.equal(one("xeri", Object.assign({}, deal, { phase: "over", dn: 3 })), false);
  // Realm: under way after the first action, until the game is over
  assert.equal(one("realm", { g: { over: -1, acts: 0 }, u: [], done: false }), false);
  assert.equal(one("realm", { g: { over: -1, acts: 5 }, u: [], done: false }), true);
  assert.equal(one("realm", { g: { over: 1, acts: 40 }, u: [], done: true }), false);
  assert.equal(one("realm", { g: { over: -1, acts: 40 }, u: [], done: true }), false);
  // Banner: under way after the first action, until the battle is over
  assert.equal(one("banner", { g: { over: -1, n: 0 }, done: false }), false);
  assert.equal(one("banner", { g: { over: -1, n: 5 }, done: false }), true);
  assert.equal(one("banner", { g: { over: 1, n: 90 }, done: true }), false);
  assert.equal(one("banner", { g: { over: -1, n: 5 }, done: true }), false);
  assert.equal(one("banner", { g: { over: -1, n: 4 }, done: false, me: false }), false, "only the computer has moved");
  assert.equal(one("banner", { g: { over: -1, n: 4 }, done: false, me: true }), true);
  // Wayfarers: under way after the first action, until the journey is over
  assert.equal(one("wayfarers", { g: { over: -1, acts: 0 }, counted: false }), false);
  assert.equal(one("wayfarers", { g: { over: -1, acts: 3 }, counted: false }), true);
  assert.equal(one("wayfarers", { g: { over: 0, acts: 30 }, counted: true }), false);
  assert.equal(one("wayfarers", { g: { over: -1, acts: 3 }, counted: true }), false);
  // Crypt: under way after the first turn, until the run is over
  assert.equal(one("crypt", { g: { over: -1, turn: 0 }, done: false }), false);
  assert.equal(one("crypt", { g: { over: -1, turn: 12 }, done: false }), true);
  assert.equal(one("crypt", { g: { over: 0, turn: 80 }, cp: { floor: 4 }, done: false }), true);
  assert.equal(one("crypt", { g: { over: 0, turn: 80 }, cp: null, done: true }), false);
  assert.equal(one("crypt", { g: { over: 1, turn: 900 }, done: true }), false);
});

test("resume: list keeps the GAMES order", () => {
  const read = reader({
    "oros-tetris-session": { score: 1 },
    "oros-chess-session": { moves: ["e2e4"], done: false },
    "oros-sudoku-session": { done: true }
  });
  assert.deepEqual(R.list(read), R.GAMES.filter((id) => id === "chess" || id === "tetris"));
});
