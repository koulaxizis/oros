// ============================================================
// orOS Game Center — daily challenges core (v1.0.0, CH-1)
// Pure logic, no DOM, no storage. Used by the shell side
// (gamecenter/host.js), the Game Center page and
// tests/challenges.test.js.
//
// Every day up to three small goals, picked only from the games the
// person has played at least once (Game Center summary p > 0) and
// has not turned off ("Not this game"):
//   ["<game>", "p", n]  finish n games of it    (progress: p − base)
//   ["<game>", "w", 1]  win one game of it      (progress: w − base)
//   ["<game>", "s", 1]  beat your best score    (done: sc > base)
// The pick depends only on the day and the list of played games, so
// two devices with the same data pick the same goals. Progress is
// measured against the game's counters when the day's goals were
// made (the baseline), from the games' OWN synced data: nothing in
// any game changes.
//
// Synced slice "gamechal" (oros-gamechal-data), owned by host.js:
//   { v: 1,
//     days: { "<day>": { at, c: [[game, kind, n]…], b: { <game>: [p, w, sc] }, d: [i…] } },
//     skip: { <game>: [mtime, 1 off | 0 on] },
//     hide: [mtime, 1 hidden | 0 shown] }
//   day = orosDaily day number (1 Jan 2026 = 0, local date);
//   at = when the goals were made; d = goals seen done (indices).
// merge (R5 symmetric, R26 canonical):
//   - a day kept on both sides: the goals made FIRST win (lower at,
//     tie → smaller JSON); the baseline of each of its games is the
//     LOWEST value per counter seen on either side (a round played on
//     the phone before the PC made the day still counts); d is the
//     union when both sides hold the same goals;
//   - skip / hide: the newer mtime wins (tie → the greater JSON);
//   - only the last KEEP days (counted from the newest day) are kept.
// ============================================================
(function (root) {
  "use strict";

  var DK = (typeof module !== "undefined" && module.exports) ? require("../gamekit/daily.js") : root.orosDaily;

  var PER_DAY = 3;
  var KEEP = 60;
  var MAX_MT = 8640000000000000;
  // Games where a win is not the same as a finished game.
  var WIN = ["wordle", "minesweeper", "solitaire", "hangman", "mastermind", "g2048", "bubble",
    "pong", "chess", "checkers", "reversi", "gomoku", "connect4", "dots", "tictactoe", "mancala",
    "backgammon", "battleship", "rps", "xeri", "realm", "crypt"];
  // Games with a best score that can be beaten.
  var SCORE = ["tetris", "snake", "breakout", "bubble", "simon", "whack", "g2048"];
  // Long games: one finished game is a goal of its own.
  var LONG = ["chess", "checkers", "backgammon", "reversi", "gomoku", "mancala", "battleship",
    "xeri", "realm", "crypt", "solitaire", "mahjong", "jigsaw", "sudoku", "nonogram", "crossword",
    "wordsearch", "spot", "hexagon", "slider"];
  var KINDS = ["p", "w", "s"];
  var ID_RE = /^[a-z0-9]{1,24}$/;

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function nat(v) { return isInt(v) && v >= 0 ? v : 0; }
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : null; }
  function has(list, x) { return list.indexOf(x) >= 0; }
  function dayKey(k) { return /^(0|[1-9]\d{0,5})$/.test(k); }
  function sortedKeys(o) { return Object.keys(o).sort(); }
  function byDay(a, b) { return +a - +b; }

  // The counters a goal is measured with: [p, w, sc] (-1 = none).
  function counters(S) {
    S = obj(S) || {};
    return [nat(S.p), isInt(S.w) && S.w >= 0 ? S.w : -1, isInt(S.sc) && S.sc >= 0 ? S.sc : -1];
  }

  // The games that can get a goal: played at least once, not turned
  // off, in the Game Center's own order (GAMES).
  function eligible(sum, games, data) {
    var skip = (data && data.skip) || {};
    return (games || []).filter(function (g) {
      var S = sum && sum.games ? sum.games[g] : null;
      return S && nat(S.p) > 0 && !(skip[g] && skip[g][1] === 1);
    });
  }

  // The kinds a game can get, given its counters.
  function kindsOf(g, c) {
    var out = ["p"];
    if (has(WIN, g) && c[1] >= 0) out.push("w");
    if (has(SCORE, g) && c[2] > 0) out.push("s");
    return out;
  }

  // → [[game, kind, n]…]: up to PER_DAY goals, one per game.
  function pick(day, list, sum) {
    var r = DK.random("chal:" + DK.dateStr(day));
    var pool = list.slice();
    for (var i = pool.length - 1; i > 0; i--) {     // Fisher-Yates, seeded
      var j = Math.floor(r() * (i + 1)), x = pool[i];
      pool[i] = pool[j]; pool[j] = x;
    }
    return pool.slice(0, PER_DAY).map(function (g) {
      var ks = kindsOf(g, counters(sum.games[g]));
      var k = ks[Math.floor(r() * ks.length)];
      var n = 1;
      if (k === "p") n = g === "rps" ? 5 : has(LONG, g) ? 1 : 2 + Math.floor(r() * 2);
      return [g, k, n];
    });
  }

  // A new day record, or null when no game was ever played.
  function make(sum, games, data, day, at) {
    var list = eligible(sum, games, data);
    if (!list.length) return null;
    var c = pick(day, list, sum), b = {};
    c.forEach(function (x) { b[x[0]] = counters(sum.games[x[0]]); });
    return normDay({ at: at, c: c, b: b, d: [] });
  }

  // [{ g, k, n, have, done }] for one day record.
  function progress(rec, sum) {
    if (!rec) return [];
    var d = rec.d || [];
    return rec.c.map(function (x, i) {
      var g = x[0], k = x[1], n = x[2], base = rec.b[g] || [0, -1, -1];
      var now = counters(sum && sum.games ? sum.games[g] : null), have = 0;
      if (k === "p") have = Math.max(0, now[0] - base[0]);
      else if (k === "w") have = base[1] < 0 ? Math.max(0, now[1]) : Math.max(0, now[1] - base[1]);
      else if (k === "s") have = now[2] > base[2] ? 1 : 0;
      have = Math.min(have, n);
      return { g: g, k: k, n: n, have: have, done: have >= n || d.indexOf(i) >= 0 };
    });
  }

  // The day record with the goals now done added to d, or null when
  // nothing new is done (so nothing is written).
  function noteDone(rec, sum) {
    if (!rec) return null;
    var add = [];
    progress(rec, sum).forEach(function (p, i) {
      if (p.have >= p.n && rec.d.indexOf(i) < 0) add.push(i);
    });
    if (!add.length) return null;
    return normDay({ at: rec.at, c: rec.c, b: rec.b, d: rec.d.concat(add) });
  }

  // Days in a row (back from today, or from yesterday while today is
  // not finished) where every goal was done.
  function streak(data, today) {
    var on = {};
    Object.keys(data.days).forEach(function (k) {
      var r = data.days[k];
      if (r.c.length && r.d.length >= r.c.length) on[+k] = true;
    });
    var n = 0, d = on[today] ? today : today - 1;
    while (on[d]) { n++; d--; }
    return n;
  }
  function doneCount(data) {
    var n = 0;
    Object.keys(data.days).forEach(function (k) { n += data.days[k].d.length; });
    return n;
  }

  // ---------- Normalizing (canonical, R26) ----------
  function normGoal(x) {
    if (!Array.isArray(x) || x.length !== 3) return null;
    var g = x[0], k = x[1], n = x[2];
    if (typeof g !== "string" || !ID_RE.test(g) || !has(KINDS, k) || !isInt(n) || n < 1 || n > 9) return null;
    return [g, k, n];
  }
  function normCnt(v) {
    if (!Array.isArray(v) || v.length !== 3) return null;
    var p = nat(v[0]), w = isInt(v[1]) && v[1] >= -1 ? v[1] : -1, s = isInt(v[2]) && v[2] >= -1 ? v[2] : -1;
    return [p, w, s];
  }
  function normDay(r) {
    r = obj(r);
    if (!r || !isInt(r.at) || r.at < 0 || r.at > MAX_MT || !Array.isArray(r.c)) return null;
    var c = [], seen = {};
    r.c.forEach(function (x) {
      var gl = normGoal(x);
      if (gl && !seen[gl[0]] && c.length < PER_DAY) { seen[gl[0]] = true; c.push(gl); }
    });
    if (!c.length) return null;
    var bi = obj(r.b) || {}, b = {};
    c.map(function (x) { return x[0]; }).sort().forEach(function (g) {
      b[g] = normCnt(bi[g]) || [0, -1, -1];
    });
    var d = [];
    (Array.isArray(r.d) ? r.d : []).forEach(function (i) {
      if (isInt(i) && i >= 0 && i < c.length && d.indexOf(i) < 0) d.push(i);
    });
    d.sort(function (x, y) { return x - y; });
    return { at: r.at, c: c, b: b, d: d };
  }
  function normFlag(v) {
    if (!Array.isArray(v) || v.length !== 2 || !isInt(v[0]) || v[0] < 0 || v[0] > MAX_MT) return null;
    return [v[0], v[1] === 1 ? 1 : 0];
  }
  function norm(x) {
    x = obj(x) || {};
    var din = obj(x.days) || {}, ok = {}, days = {};
    var keys = Object.keys(din).filter(dayKey).sort(byDay).filter(function (k) {
      var r = normDay(din[k]);
      if (r) ok[k] = r;
      return !!r;
    });
    var top = keys.length ? +keys[keys.length - 1] : 0;
    keys.forEach(function (k) { if (+k > top - KEEP) days[k] = ok[k]; });
    var sin = obj(x.skip) || {}, skip = {};
    sortedKeys(sin).forEach(function (g) {
      var f = ID_RE.test(g) ? normFlag(sin[g]) : null;
      if (f) skip[g] = f;
    });
    return { v: 1, days: days, skip: skip, hide: normFlag(x.hide) || [0, 0] };
  }

  // ---------- Merge ----------
  function newer(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a[0] !== b[0]) return a[0] > b[0] ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }
  function mergeDay(a, b) {
    if (!a) return b;
    if (!b) return a;
    var ja = JSON.stringify(a.c), jb = JSON.stringify(b.c);
    var w = a.at !== b.at ? (a.at < b.at ? a : b) : (ja <= jb ? a : b);
    var o = w === a ? b : a, same = ja === jb, base = {};
    Object.keys(w.b).forEach(function (g) {
      var x = w.b[g], y = o.b[g];
      base[g] = !y ? x.slice() : [Math.min(x[0], y[0]),
        x[1] < 0 ? y[1] : y[1] < 0 ? x[1] : Math.min(x[1], y[1]),
        x[2] < 0 ? y[2] : y[2] < 0 ? x[2] : Math.min(x[2], y[2])];
    });
    return normDay({ at: Math.min(a.at, b.at), c: w.c, b: base, d: same ? a.d.concat(b.d) : w.d });
  }
  function merge(a, b) {
    a = norm(a); b = norm(b);
    var days = {};
    Object.keys(a.days).concat(Object.keys(b.days)).forEach(function (k) {
      if (!days[k]) days[k] = mergeDay(a.days[k] || null, b.days[k] || null);
    });
    var skip = {};
    Object.keys(a.skip).concat(Object.keys(b.skip)).forEach(function (g) {
      skip[g] = newer(a.skip[g] || null, b.skip[g] || null);
    });
    return norm({ v: 1, days: days, skip: skip, hide: newer(a.hide, b.hide) });
  }

  // ---------- Edits (return the new data; the caller writes it) ----------
  function withDay(data, day, rec) {
    var x = norm(data);
    if (rec) x.days[String(day)] = rec;
    return norm(x);
  }
  function setSkip(data, game, off, now) {
    var x = norm(data);
    if (!ID_RE.test(String(game))) return x;
    var cur = x.skip[game] || null;
    var stamp = Math.max(nat(now), cur ? cur[0] + 1 : 0);
    x.skip[game] = [stamp, off ? 1 : 0];
    return norm(x);
  }
  function setHide(data, hidden, now) {
    var x = norm(data);
    x.hide = [Math.max(nat(now), x.hide[0] + 1), hidden ? 1 : 0];
    return norm(x);
  }
  function skipped(data) {
    var x = norm(data);
    return Object.keys(x.skip).filter(function (g) { return x.skip[g][1] === 1; });
  }

  var API = {
    VERSION: "1.0.0", PER_DAY: PER_DAY, KEEP: KEEP, WIN: WIN, SCORE: SCORE, LONG: LONG,
    counters: counters, eligible: eligible, kindsOf: kindsOf, pick: pick, make: make,
    progress: progress, noteDone: noteDone, streak: streak, doneCount: doneCount,
    norm: norm, normDay: normDay, merge: merge, withDay: withDay,
    setSkip: setSkip, setHide: setHide, skipped: skipped
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.orosGameChal = API;
})(typeof window !== "undefined" ? window : this);
