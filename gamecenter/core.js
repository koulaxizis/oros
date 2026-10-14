// ============================================================
// orOS Game Center — core (v1.0.0)
// Pure logic, no DOM: reads the games' OWN synced data (read-only,
// never writes it) and turns it into one summary per game and a list
// of achievements. Nothing here is stored: every number is computed
// again from the games' data each time, so it always agrees with
// them and there is nothing extra to sync.
//
//   summarize(read, today) → { games: { <id>: S }, days: { <day>: n }, … }
//     read(key) → the parsed JSON of a localStorage key, or null
//     S = { p played, w won (-1 = the game has no "win"), t best time
//           in ms (0 = none), sc best score (-1 = none), cur / best
//           streak (-1 = none), dn dailies solved (-1 = no Daily),
//           today 0 not yet | 1 solved | 2 lost (Daily games only) }
//   achievements(sum) → [{ id, done, have, need }]
//
// Each game's adapter follows that game's schema in OROS_BIBLE.md
// Part IV; rows older than the reset stamp br are skipped, the same
// rule the games' own merges apply.
// Loaded by gamecenter/index.html (window.orosGameCore) and by
// tests/gamecenter.test.js (module.exports).
// ============================================================
(function (root) {
  "use strict";

  // The six games with a Daily challenge (Wave 49), in the order the
  // Today section shows them.
  var DAILY = ["wordle", "crossword", "sudoku", "nonogram", "flow", "minesweeper"];
  // Every game the page knows. Unknown or missing data = not played.
  var GAMES = ["wordle", "crossword", "sudoku", "nonogram", "flow", "minesweeper",
    "wordsearch", "solitaire", "mahjong", "jigsaw", "spot", "hexagon", "slider", "lightsout",
    "memory", "hangman", "mastermind", "g2048", "tetris", "snake", "breakout", "bubble",
    "simon", "whack", "pong", "chess", "checkers", "reversi", "gomoku", "connect4", "dots",
    "tictactoe", "mancala", "backgammon", "battleship", "rps", "xeri"];
  var WORDLE_LOST = 7;
  var SOL_VARIANTS = { k: ["k1c", "k1n", "k3c", "k3n"], f: ["f"], s: ["s1", "s2", "s4"], p: ["p"] };
  var MAX_MS = 360000000;

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function nat(v) { return isInt(v) && v >= 0 ? v : 0; }
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : null; }
  function keyOf(id) { return "oros-" + id + "-data"; }
  function minT(a, b) { return !b || b < 0 || b > MAX_MS ? a : (!a ? b : Math.min(a, b)); }

  // Every cell of every live row: fn(key, cell). Rows from before the
  // last reset (b < br) do not count.
  function eachCell(d, fn) {
    if (!obj(d) || !obj(d.rows)) return;
    var br = nat(d.br);
    Object.keys(d.rows).forEach(function (id) {
      var row = obj(d.rows[id]);
      if (!row || !isInt(row.b) || row.b < br || !obj(row.s)) return;
      Object.keys(row.s).forEach(function (k) { if (row.s[k] != null) fn(k, row.s[k]); });
    });
  }
  // A day-number key: "286" (Sudoku …) or "en:286" (Wordle …).
  function dayOf(k) {
    var m = /^(?:(?:en|el):)?(-?\d{1,6})$/.exec(k);
    return m ? +m[1] : null;
  }
  // The Daily entries that still count: fn(day, entry).
  function eachDay(d, fn) {
    if (!obj(d) || !obj(d.days)) return;
    var br = nat(d.br);
    Object.keys(d.days).forEach(function (k) {
      var v = obj(d.days[k]), day = dayOf(k);
      if (!v || day === null || !isInt(v.b) || v.b < br) return;
      fn(day, v);
    });
  }
  // { cur, best } over the days marked in on{day: true}; the current
  // streak counts back from today, or from yesterday when today is
  // not done yet (the same rule as gamekit/daily.js).
  function streaks(on, today) {
    var list = Object.keys(on).map(Number).filter(function (x) { return isFinite(x); })
      .sort(function (a, b) { return a - b; });
    var best = 0, run = 0, prev = null;
    list.forEach(function (x) {
      run = prev !== null && x === prev + 1 ? run + 1 : 1;
      if (run > best) best = run;
      prev = x;
    });
    var cur = 0, d = on[today] ? today : today - 1;
    while (on[d]) { cur++; d--; }
    return { cur: cur, best: best };
  }

  function blank() { return { p: 0, w: -1, t: 0, sc: -1, cur: -1, best: -1, dn: -1, today: -1 }; }

  // [won, lost, drawn] (or chess [won, drawn, lost]) per level.
  function wld(chess) {
    return function (d, S, X) {
      S.w = 0;
      eachCell(d, function (k, v) {
        if (!Array.isArray(v) || v.length < 3) return;
        var w = nat(v[0]), all = w + nat(v[1]) + nat(v[2]);
        S.p += all; S.w += w;
        if (w && /^h/.test(k)) X.hard = true;
      });
      if (chess) S.chess = true;
    };
  }
  // { n|s score, g games } per setting: arcade games with a best score.
  function scoreGame(field, winField) {
    return function (d, S) {
      if (winField) S.w = 0;
      eachCell(d, function (k, v) {
        if (!obj(v)) return;
        S.p += nat(v.g);
        if (winField) S.w += nat(v[winField]);
        if (isInt(v[field])) S.sc = Math.max(S.sc, v[field]);
      });
    };
  }
  // Puzzles counted as solved, with a best time: { <count>, t }.
  function solvedGame(countField, secs) {
    return function (d, S) {
      S.w = 0;
      eachCell(d, function (k, v) {
        if (!obj(v)) return;
        var n = nat(v[countField]);
        S.p += n; S.w += n;
        if (n && isInt(v.t) && v.t > 0) S.t = minT(S.t, secs ? v.t * 1000 : v.t);
      });
    };
  }
  // Daily results of Sudoku / Nonogram / Flow Free (hints h) and
  // Minesweeper (won w): fills S.dn, the streaks and today.
  function dailyPart(d, S, X, today, game) {
    var on = {}, tried = {};
    S.dn = 0;
    eachDay(d, function (day, v) {
      var ok = game === "minesweeper" ? v.w === 1 : true;
      tried[day] = true;
      if (!ok) return;
      on[day] = true;
      S.dn++;
      if (game !== "minesweeper" && v.h === 0) X.clean = true;
      X.solved[day] = true;
    });
    var st = streaks(on, today);
    S.cur = st.cur; S.best = st.best;
    S.today = on[today] ? 1 : (tried[today] ? 2 : 0);
  }
  // Word Search / Crossword: Free play rows {n, t sec} + one result
  // per day and language {t sec, h}.
  function wordDaily(game) {
    return function (d, S, X, today) {
      solvedGame("n", true)(d, S);
      var on = {};
      S.dn = 0;
      eachDay(d, function (day, v) {
        S.p++; S.w++;
        if (isInt(v.t) && v.t > 0) S.t = minT(S.t, v.t * 1000);
        if (!on[day]) S.dn++;
        on[day] = true;
        if (game === "crossword") {
          X.solved[day] = true;
          if (v.h === 0) X.clean = true;
        }
      });
      var st = streaks(on, today);
      S.cur = st.cur; S.best = st.best;
      if (game === "crossword") S.today = on[today] ? 1 : 0;
    };
  }

  var ADAPT = {
    sudoku: function (d, S, X, today) {
      solvedGame("n")(d, S);
      eachCell(d, function (k, v) { if (k === "k" && obj(v) && nat(v.n)) X.killer = true; });
      if (S.t && S.t < 300000) X.fastSudoku = true;
      dailyPart(d, S, X, today, "sudoku");
    },
    nonogram: function (d, S, X, today) { solvedGame("n")(d, S); dailyPart(d, S, X, today, "nonogram"); },
    flow: function (d, S, X, today) { solvedGame("g")(d, S); dailyPart(d, S, X, today, "flow"); },
    minesweeper: function (d, S, X, today) {
      S.w = 0;
      eachCell(d, function (k, v) {
        if (!obj(v)) return;
        S.p += nat(v.g); S.w += nat(v.w);
        if (nat(v.w) && isInt(v.t) && v.t > 0) S.t = minT(S.t, v.t);
        if (k === "e" && nat(v.w)) X.expert = true;
      });
      dailyPart(d, S, X, today, "minesweeper");
    },
    wordle: function (d, S, X, today) {
      S.w = 0;
      eachCell(d, function (k, v) { if (obj(v)) { S.p += nat(v.g); S.w += nat(v.w); } });
      var on = {}, tried = {};
      S.dn = 0;
      eachDay(d, function (day, v) {
        if (!isInt(v.r) || v.r < 1 || v.r > WORDLE_LOST) return;
        S.p++;
        tried[day] = true;
        if (v.r === WORDLE_LOST) return;
        S.w++;
        if (!on[day]) S.dn++;
        on[day] = true;
        X.solved[day] = true;
        if (v.r <= 2) X.wordle2 = true;
      });
      var st = streaks(on, today);
      S.cur = st.cur; S.best = st.best;
      S.today = on[today] ? 1 : (tried[today] ? 2 : 0);
    },
    crossword: wordDaily("crossword"),
    wordsearch: wordDaily("wordsearch"),
    solitaire: function (d, S, X) {
      S.w = 0;
      var won = {};
      eachCell(d, function (k, v) {
        if (!obj(v)) return;
        S.p += nat(v.p); S.w += nat(v.w);
        if (nat(v.w)) {
          won[k] = true;
          if (isInt(v.t) && v.t > 0) S.t = minT(S.t, v.t);
          if (isInt(v.s)) S.sc = Math.max(S.sc, v.s);
        }
      });
      X.cards = Object.keys(SOL_VARIANTS).filter(function (f) {
        return SOL_VARIANTS[f].some(function (k) { return won[k]; });
      }).length;
    },
    mahjong: solvedGame("w"),
    spot: solvedGame("w"),
    jigsaw: solvedGame("n"),
    hexagon: solvedGame("g"),
    slider: solvedGame("g"),
    lightsout: solvedGame("g"),
    memory: function (d, S) {
      if (!obj(d)) return;
      var br = nat(d.br);
      S.w = 0;
      (Array.isArray(d.games) ? d.games : []).forEach(function (g) {
        if (!obj(g) || !isInt(g.ts) || g.ts <= br) return;
        S.p++;
        if (g.mode !== "duo") { S.w++; if (isInt(g.ms) && g.ms > 0) S.t = minT(S.t, g.ms); }
      });
      if (obj(d.best)) Object.keys(d.best).forEach(function (k) {
        var b = obj(d.best[k]);
        if (b && isInt(b.ts) && b.ts > br && isInt(b.ms) && b.ms > 0) S.t = minT(S.t, b.ms);
      });
    },
    hangman: function (d, S) {
      S.w = 0; S.cur = 0; S.best = 0;
      eachCell(d, function (k, v) {
        if (!obj(v)) return;
        S.p += nat(v.w) + nat(v.l); S.w += nat(v.w);
        S.cur = Math.max(S.cur, nat(v.c)); S.best = Math.max(S.best, nat(v.m));
      });
    },
    mastermind: function (d, S) {
      S.w = 0;
      eachCell(d, function (k, v) { if (obj(v)) { S.p += nat(v.g); S.w += nat(v.w); } });
    },
    g2048: scoreGame("s", "w"),
    bubble: scoreGame("s", "w"),
    tetris: scoreGame("n"),
    snake: scoreGame("n"),
    breakout: scoreGame("n"),
    simon: scoreGame("n"),
    whack: scoreGame("n"),
    pong: function (d, S, X) {
      S.w = 0;
      eachCell(d, function (k, v) {
        if (!obj(v)) return;
        if (k === "p2") { S.p += nat(v.g); return; }
        S.p += nat(v.w) + nat(v.l); S.w += nat(v.w);
        if (k === "h" && nat(v.w)) X.hard = true;
      });
    },
    chess: wld(true),
    checkers: wld(),
    reversi: wld(),
    gomoku: wld(),
    connect4: wld(),
    dots: wld(),
    tictactoe: wld(),
    mancala: wld(),
    backgammon: function (d, S, X) {
      S.w = 0;
      eachCell(d, function (k, v) {
        if (!Array.isArray(v) || v.length < 2) return;
        S.p += nat(v[0]) + nat(v[1]); S.w += nat(v[0]);
        if (k === "h" && nat(v[0])) X.hard = true;
      });
    },
    battleship: function (d, S, X) {
      S.w = 0;
      eachCell(d, function (k, v) {
        if (!obj(v)) return;
        S.p += nat(v.w) + nat(v.l); S.w += nat(v.w);
        if (k === "h" && nat(v.w)) X.hard = true;
      });
    },
    rps: function (d, S, X) {
      S.w = 0;
      eachCell(d, function (k, v) {
        if (!Array.isArray(v) || v.length < 2) return;
        S.p += nat(v[0]) + nat(v[1]); S.w += nat(v[0]);
        if (k === "h" && nat(v[0])) X.hard = true;
      });
    },
    xeri: function (d, S, X) {
      S.w = 0;
      eachCell(d, function (k, v) {
        if (!Array.isArray(v) || v.length < 2) return;
        S.p += nat(v[0]); S.w += nat(v[1]);
        if (k === "h" && nat(v[1])) X.hard = true;
      });
    }
  };

  function summarize(read, today) {
    var X = { solved: {}, hard: false, killer: false, expert: false, fastSudoku: false,
      wordle2: false, clean: false, cards: 0 };
    var games = {}, perDay = {};
    GAMES.forEach(function (id) {
      var S = blank(), d = null;
      try { d = read(keyOf(id)); } catch (e) { d = null; }
      X.solved = {};
      try { if (d) ADAPT[id](d, S, X, today); } catch (e) { S = blank(); }
      if (DAILY.indexOf(id) >= 0) {
        if (S.dn < 0) { S.dn = 0; S.cur = 0; S.best = 0; S.today = 0; }
        Object.keys(X.solved).forEach(function (day) { perDay[day] = (perDay[day] || 0) + 1; });
      }
      delete S.chess;
      games[id] = S;
    });
    // Days with at least one Daily solved: the overall Daily streak.
    var on = {};
    Object.keys(perDay).forEach(function (day) { on[day] = true; });
    var st = streaks(on, today), sweep = 0;
    Object.keys(perDay).forEach(function (day) { sweep = Math.max(sweep, perDay[day]); });
    var tot = { p: 0, w: 0, wonGames: 0, playedGames: 0, bestStreak: 0 };
    GAMES.forEach(function (id) {
      var S = games[id];
      tot.p += S.p;
      if (S.w > 0) { tot.w += S.w; tot.wonGames++; }
      if (S.p > 0) tot.playedGames++;
      if (DAILY.indexOf(id) >= 0) tot.bestStreak = Math.max(tot.bestStreak, S.best);
    });
    return {
      games: games, today: today, perDay: perDay,
      daily: { cur: st.cur, best: st.best, days: Object.keys(on).length, sweep: sweep,
               todayDone: perDay[today] || 0 },
      tot: tot,
      x: { hard: X.hard, killer: X.killer, expert: X.expert, fastSudoku: X.fastSudoku,
           wordle2: X.wordle2, clean: X.clean, cards: X.cards }
    };
  }

  // Achievements: computed from the summary, never stored. have/need
  // drive the progress bar.
  var ACH = [
    ["first",    function (s) { return [s.tot.w, 1]; }],
    ["daily1",   function (s) { return [s.daily.days, 1]; }],
    ["streak7",  function (s) { return [s.tot.bestStreak, 7]; }],
    ["streak30", function (s) { return [s.tot.bestStreak, 30]; }],
    ["sweep",    function (s) { return [s.daily.sweep, DAILY.length]; }],
    ["clean",    function (s) { return [s.x.clean ? 1 : 0, 1]; }],
    ["wordle2",  function (s) { return [s.x.wordle2 ? 1 : 0, 1]; }],
    ["killer",   function (s) { return [s.x.killer ? 1 : 0, 1]; }],
    ["cards",    function (s) { return [s.x.cards, 4]; }],
    ["hard",     function (s) { return [s.x.hard ? 1 : 0, 1]; }],
    ["expert",   function (s) { return [s.x.expert ? 1 : 0, 1]; }],
    ["speedy",   function (s) { return [s.x.fastSudoku ? 1 : 0, 1]; }],
    ["variety",  function (s) { return [s.tot.wonGames, 10]; }],
    ["played100", function (s) { return [s.tot.p, 100]; }],
    ["wins250",  function (s) { return [s.tot.w, 250]; }]
  ];
  function achievements(sum) {
    return ACH.map(function (a) {
      var r = a[1](sum), need = r[1], have = Math.max(0, Math.min(need, r[0]));
      return { id: a[0], done: have >= need, have: have, need: need };
    });
  }

  var API = {
    DAILY: DAILY, GAMES: GAMES, keyOf: keyOf, streaks: streaks,
    summarize: summarize, achievements: achievements
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.orosGameCore = API;
})(typeof window !== "undefined" ? window : this);
