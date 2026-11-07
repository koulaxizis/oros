// ============================================================
// orOS gamekit/resume.js — which games have a game in progress (v1.0.0)
// NOT an app (no apps.json entry, no slice, no storage of its own).
// Each game already keeps its game in progress in the device-local
// key oros-<id>-session (Bible Part IV) and reopens it by itself.
// This file only answers "is there a game under way?" from those
// keys, read-only, with the same test each game's own inProgress()
// applies (the one that decides its Undo toast, R14). Used by:
//   - the shell (GR-1): when orOS starts again, it reopens the game
//     that was in front when orOS closed, if that game is under way;
//   - the Game Center: the "Continue" row.
//
// API (window.orosResume, or module.exports in Node):
//   GAMES                        the ids that keep a session (every
//                                Games app but the Game Center)
//   inProgress(id, read) → true | false | null
//       read(key) → the parsed JSON of a localStorage key, or null.
//       null = this file cannot tell (Jigsaw keeps its game in
//       IndexedDB; an id it does not know).
//   list(read) → [id]            the games with a game in progress,
//                                in GAMES order
//
// A finished game, a fresh deal nobody has touched yet and unreadable
// data all answer false: nothing is reopened that would not resume.
// Tests: tests/gamekit-resume.test.js.
// ============================================================
(function (root) {
  "use strict";

  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : null; }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }
  // Games that keep one entry per language and mode ({"en:d": {...}}):
  // under way if any entry is.
  function anyEntry(s, fn) {
    s = obj(s);
    if (!s) return false;
    return Object.keys(s).some(function (k) { var e = obj(s[k]); return !!(e && fn(e)); });
  }
  function movesList(s) { return !s.done && arr(s.moves).length > 0; }
  function movesCount(s) { return !s.done && num(s.moves) > 0; }
  // Snake, Tetris, Breakout, Pong: the session exists only while a
  // game runs, is paused or counts down (removed at game over).
  function present(s) { return true; }
  function crosswordTyped(e) {
    var f = e.fill, giv = arr(e.giv);
    if (!f || typeof f.length !== "number") return false;
    for (var i = 0; i < f.length; i++) {
      if (f[i] !== "-" && f[i] !== "." && giv.indexOf(i) < 0) return true;
    }
    return false;
  }

  // One test per game, on its parsed session (never null here).
  var TEST = {
    memory: function (s) { return !s.done && (num(s.moves) > 0 || arr(s.open).length > 0); },
    connect4: movesList,
    dots: movesList,
    tictactoe: movesList,
    slider: movesCount,
    lightsout: movesCount,
    snake: present,
    g2048: function (s) { return !s.over && num(s.moves) > 0; },
    wordle: function (s) { return anyEntry(s, function (e) { return !e.done && arr(e.guesses).length > 0; }); },
    spot: function (s) { return !s.over && (arr(s.found).length > 0 || num(s.misses) > 0 || num(s.hints) > 0 || num(s.el) > 5000); },
    hexagon: movesCount,
    chess: movesList,
    sudoku: function (s) {
      if (s.done) return false;
      if (num(s.hints) > 0) return true;
      var v = arr(s.v), nt = arr(s.nt);
      for (var i = 0; i < 81; i++) if (v[i] || nt[i]) return true;
      return false;
    },
    tetris: present,
    minesweeper: function (s) { return !s.over && !!s.mines; },
    mahjong: function (s) { return !s.over && !!s.go; },
    gomoku: movesList,
    bubble: function (s) { return !s.over && num(s.moves) > 0; },
    checkers: movesList,
    mastermind: function (s) {
      if (s.done) return false;
      return arr(s.rows).length > 0 || arr(s.cur).some(function (v) { return v >= 0; });
    },
    battleship: function (s) { return s.phase === "play" && arr(s.myShots).length > 0; },
    rps: function (s) { return !s.done && num(s.rounds) > 0; },
    // guessed is the string of letters tried ("EA"); an array is read too
    hangman: function (s) {
      return anyEntry(s, function (e) {
        var g = typeof e.guessed === "string" ? e.guessed : arr(e.guessed);
        return !e.done && g.length > 0;
      });
    },
    flow: movesCount,
    nonogram: function (s) {
      if (s.done) return false;
      if (num(s.hints) > 0) return true;
      return arr(s.c).some(function (v) { return !!v; });
    },
    breakout: present,
    reversi: movesList,
    mancala: movesList,
    pong: present,
    backgammon: function (s) { return s.phase !== "done" && typeof s.turn === "number" && s.turn >= 0; },
    wordsearch: function (s) { return anyEntry(s, function (e) { return !e.done && (arr(e.found).length > 0 || num(e.ms) > 15000); }); },
    // One deal per variant; a won deal is removed. A deal is under way
    // once a move was made (undo positions) or after 15 s of play.
    solitaire: function (s) { return anyEntry(s, function (e) { return arr(e.u).length > 0 || num(e.t) > 15000; }); },
    crossword: function (s) { return anyEntry(s, function (e) { return !e.done && (crosswordTyped(e) || num(e.ms) > 15000); }); },
    // GR-2: Simon keeps {pads, mode, seq} from the first round; Whack-a-Mole
    // keeps a round only while it is paused (removed when it ends).
    simon: function (s) { return Array.isArray(s.seq) && s.seq.length > 0; },
    whack: present,
    // Realm: {g: engine state, u, opts, done}; under way after the
    // first action of any side, until the game is over.
    realm: function (s) {
      var g = obj(s.g);
      return !!g && !s.done && num(g.over) < 0 && num(g.acts) > 0;
    },
    // Banner: {g: engine state, opts, counted, done, pass, me}; under
    // way after the first move of a person (me), until the battle is
    // over. When the computer starts, its moves alone do not count.
    // Sessions saved before "me" existed: after any action.
    banner: function (s) {
      var g = obj(s.g);
      if (!g || s.done || num(g.over) >= 0) return false;
      return s.me === undefined ? num(g.n) > 0 : s.me === true;
    },
    // Crypt: {g: engine state, opts, cp, done}; under way after the
    // first turn, until the run is over (a fall in Gentle with a save
    // point still waits for the choice, so it is under way too).
    crypt: function (s) {
      var g = obj(s.g);
      return !!g && !s.done && num(g.turn) > 0 && (num(g.over) < 0 || !!obj(s.cp));
    },
    xeri: function (s) {
      if (s.phase === "over") return false;
      var hs = num(s.hs) || 6, won = arr(s.won), hands = arr(s.hands);
      var w0 = arr(won[0]).length + arr(won[1]).length;
      var h0 = arr(hands[0]).length + arr(hands[1]).length;
      return num(s.dn) > 1 || w0 > 0 || h0 < 2 * hs || arr(s.deck).length < 52 - 2 * hs - 4;
    }
  };
  var GAMES = Object.keys(TEST).concat(["jigsaw"]);

  function inProgress(id, read) {
    if (!Object.prototype.hasOwnProperty.call(TEST, id)) return null;
    var s;
    try { s = obj(read("oros-" + id + "-session")); } catch (e) { s = null; }
    if (!s) return false;
    try { return !!TEST[id](s); } catch (e) { return false; }
  }
  function list(read) {
    return GAMES.filter(function (id) { return inProgress(id, read) === true; });
  }

  var api = { GAMES: GAMES, inProgress: inProgress, list: list };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.orosResume = api;
})(typeof window !== "undefined" ? window : this);
