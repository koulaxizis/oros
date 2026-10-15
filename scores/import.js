// ============================================================
// orOS Score Keeper — import.js (pure logic: "Import from another app")
// Reads a file the person exported from another score tracker, as
// DATA only (nothing is run, nothing becomes HTML):
//   - BG Stats  Settings › Backup / Export (.bgsplay or .json, also
//               inside a .zip): one JSON object
//               { players: [{ id, name, isAnonymous }],
//                 games: [{ id, name, cooperative, highestWins }],
//                 locations: [{ id, name }],
//                 plays: [{ uuid, gameRefId, playDate "YYYY-MM-DD
//                   HH:MM:SS", playerScores: [{ playerRefId, score,
//                   winner, rank, … }], ignored, … }] }
// One play = one FINISHED match (the game's name, the players as
// seats, finished at the play date) with ONE round holding each
// player's score. No scores in the play: the winners get 1 point
// and everyone else 0, so the win counts in Stats stay right.
// Games where the lowest score wins (highestWins false) keep that.
// Left out: plays with 1 player or more than 8 (a match has 2–8
// seats), plays marked "ignored" (not counted in BG Stats either),
// locations, comments, durations, teams and roles.
//   parseText(text, name)  → { source: "bgstats", plays: [{ key, game,
//                              at (ms), day, low, seats: [{ name,
//                              anon, pts }] }], skip: { solo, many,
//                              ignored, bad } } or { error }
//   readBytes(bytes, name) → Promise of the same (ZIP aware)
//   plan(res, data, opts)  → what an import would ADD to the current
//                            data (scores.js): new matches + rounds,
//                            new players, and counts
// Players are matched by name to the ones already saved (any case);
// a new name becomes a saved player (a suggestion with a colour).
// Stable ids: "imp" + hashes of the play's uuid (Score Keeper ids
// are [a-z0-9] only, no "-"), so importing the same file twice adds
// nothing. Caps: file size, plays, players, name lengths.
// Needs OrosImportKit (../importkit.js); ZIP needs AtelierZip.
// UMD: window.OrosScoresImport in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var K = (typeof module !== "undefined" && module.exports && typeof require === "function")
    ? require("../importkit.js") : root.OrosImportKit;

  var MAX_FILE = 40 * 1024 * 1024;      // the file as picked
  var MAX_TEXT = 40 * 1024 * 1024;      // characters parsed
  var MAX_PLAYS = 50000;                // plays read from the file
  var MAX_ZIP_ENTRIES = 20;
  var MIN_SEATS = 2, MAX_SEATS = 8;     // as in scores.js
  var NAME_LEN = 40, SEAT_LEN = 24;
  var MAX_SCORE = 1000000;
  var MAX_MATCHES = 1000, MAX_PLAYERS = 200;
  var COLORS = 8;

  // Score Keeper ids: [a-z0-9]{6,40}. Two hashes = ~64 bits, so
  // thousands of plays never collide.
  function sid(kind, key) { return "imp" + K.hash(kind + "|" + key) + K.hash(key + "|" + kind + "#"); }
  function nameKey(s) { return K.clean(s, SEAT_LEN).toLocaleLowerCase(); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dayOf(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  // ---------- 1. Parse ----------
  function isBgStats(o) {
    return !!o && typeof o === "object" && !Array.isArray(o) && Array.isArray(o.plays) &&
           (Array.isArray(o.games) || Array.isArray(o.players));
  }
  function byId(list) {
    var out = Object.create(null);
    arr(list).forEach(function (x) {
      if (x && typeof x === "object" && (typeof x.id === "number" || typeof x.id === "string")) out[String(x.id)] = x;
    });
    return out;
  }
  // a score: number or numeric string, rounded to a whole number
  // (the sheet keeps integers); null when there is none
  function score(v) {
    if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
    var n = typeof v === "number" ? v : K.num(v);
    if (typeof n !== "number" || !isFinite(n)) return null;
    n = Math.round(n);
    return Math.max(-MAX_SCORE, Math.min(MAX_SCORE, n));
  }
  function playTime(v) {
    if (typeof v === "number" && isFinite(v)) return v > 1e11 ? v : v * 1000;
    var s = String(v == null ? "" : v).trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
    if (m) {
      var d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 12), +(m[5] || 0), +(m[6] || 0));
      if (d.getMonth() !== +m[2] - 1) return NaN;
      return d.getTime();
    }
    return K.parseDate(s);
  }

  function fromBgStats(o) {
    var games = byId(o.games), players = byId(o.players);
    var skip = { solo: 0, many: 0, ignored: 0, bad: 0 }, plays = [], seen = Object.create(null);
    var list = o.plays.slice(0, MAX_PLAYS);
    skip.bad += o.plays.length - list.length;
    list.forEach(function (p) {
      if (!p || typeof p !== "object") { skip.bad++; return; }
      if (p.ignored === true) { skip.ignored++; return; }
      var g = games[String(p.gameRefId)];
      var game = K.clean(g && g.name, NAME_LEN);
      var at = playTime(p.playDate);
      var ps = arr(p.playerScores).filter(function (x) { return x && typeof x === "object"; });
      if (!game || !isFinite(at) || at <= 0) { skip.bad++; return; }
      if (ps.length < MIN_SEATS) { skip.solo++; return; }
      if (ps.length > MAX_SEATS) { skip.many++; return; }
      var hasScore = ps.some(function (x) { return score(x.score) !== null; });
      var hasWin = ps.some(function (x) { return x.winner === true; });
      var seats = ps.map(function (x, i) {
        var pl = players[String(x.playerRefId)];
        var name = K.clean(pl && pl.name, SEAT_LEN);
        var anon = !pl || pl.isAnonymous === true || !name;
        var win = hasWin ? x.winner === true : +x.rank === 1;
        return { name: name, anon: anon, pts: hasScore ? (score(x.score) || 0) : (win ? 1 : 0), n: i + 1 };
      });
      // the key: BG Stats' own uuid; without one, what the play is
      var key = K.clean(p.uuid, 80) || [game, String(p.playDate), seats.map(function (s) { return s.name + "=" + s.pts; }).join(",")].join("|");
      if (seen[key]) return;                   // the same play twice in the file
      seen[key] = 1;
      plays.push({ key: key, game: game, at: at, day: dayOf(at),
                   low: g && g.highestWins === false && hasScore ? 1 : 0, seats: seats });
    });
    if (!plays.length && !skip.solo && !skip.many && !skip.ignored) return { error: "empty" };
    plays.sort(function (a, b) { return a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0); });
    return { source: "bgstats", plays: plays, skip: skip };
  }

  function parseText(text, name) {
    if (typeof text !== "string") return { error: "bad" };
    if (text.length > MAX_TEXT) return { error: "big" };
    var o = K.json(text);
    if (!isBgStats(o)) return { error: "bad" };
    return fromBgStats(o);
  }

  function readBytes(bytes, name) {
    if (!bytes || bytes.length > MAX_FILE) return Promise.resolve({ error: "big" });
    if (!K.isZip(bytes)) {
      var txt;
      try { txt = K.text(bytes); } catch (e) { return Promise.resolve({ error: "bad" }); }
      return Promise.resolve(parseText(txt, name));
    }
    var z;
    try { z = K.unzip(bytes); } catch (e) { return Promise.resolve({ error: "bad" }); }
    var names = z.names.filter(function (n) {
      return /\.(json|bgsplay)$/i.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n);
    }).slice(0, MAX_ZIP_ENTRIES);
    var found = null;
    return names.reduce(function (p, n) {
      return p.then(function () {
        if (found) return;
        return z.text(n, MAX_TEXT).then(function (s) {
          var r = parseText(s, n);
          if (!r.error) found = r;
        }, function () {});
      });
    }, Promise.resolve()).then(function () { return found || { error: "bad" }; });
  }

  // ---------- 2. Plan ----------
  // `data` = the Score Keeper data as it is now { matches, rounds,
  // players, tombs }. opts = { now, anon: label for a player with no
  // name ("{n}" = seat number) }. Nothing existing is changed.
  function plan(res, data, opts) {
    opts = opts || {};
    var now = opts.now || Date.now();
    var anon = opts.anon || "Player {n}";
    var d = data || {};
    var have = Object.create(null), byName = Object.create(null), used = {};
    arr(d.matches).forEach(function (m) { if (m && m.id) have[m.id] = 1; });
    arr(d.players).forEach(function (p) {
      if (!p || !p.name) return;
      byName[nameKey(p.name)] = p;
      used[p.col] = (used[p.col] || 0) + 1;
    });
    var nPlayers = arr(d.players).length;
    var st = { found: res.plays.length, have: 0, full: 0, solo: res.skip.solo, many: res.skip.many,
               ignored: res.skip.ignored, bad: res.skip.bad, from: "", to: "", games: 0, known: 0, newp: 0 };
    var todo = res.plays.filter(function (p) {
      if (have[sid("m", p.key)]) { st.have++; return false; }
      return true;
    });
    // the cap: the newest plays fit, the oldest wait
    var room = Math.max(0, MAX_MATCHES - arr(d.matches).length);
    if (todo.length > room) { st.full = todo.length - room; todo = todo.slice(todo.length - room); }
    var matches = [], rounds = [], players = [], games = Object.create(null), known = Object.create(null);
    todo.forEach(function (p) {
      var keys = Object.create(null);
      var seats = p.seats.map(function (s) {
        var nm = s.name;
        if (!s.anon) {
          var k = nameKey(nm), ex = byName[k];
          if (ex) {
            nm = ex.name;
            if (!ex.imp) known[k] = 1;
          } else if (nPlayers + players.length < MAX_PLAYERS) {
            var col = 0;
            for (var c = 1; c < COLORS; c++) if ((used[c] || 0) < (used[col] || 0)) col = c;
            used[col] = (used[col] || 0) + 1;
            ex = { id: sid("p", k), m: now, name: nm, col: col };
            players.push(ex);
            byName[k] = { name: nm, imp: 1 };
          }
        } else nm = anon.replace("{n}", s.n);
        // two seats with one name (two "Anonymous") get " 2", " 3"
        var base = nm.slice(0, SEAT_LEN - 3), out = nm, i = 1;
        while (keys[nameKey(out)]) out = base + " " + (++i);
        keys[nameKey(out)] = 1;
        return out;
      });
      var id = sid("m", p.key);
      matches.push({ id: id, m: now, c: p.at, name: p.game, tpl: "", seats: seats, target: 0,
                     low: p.low, quick: [], done: p.at });
      rounds.push({ id: sid("r", p.key), m: now, g: id, c: p.at, s: p.seats.map(function (s) { return s.pts; }) });
      games[p.game.toLocaleLowerCase()] = 1;
      if (!st.from || p.day < st.from) st.from = p.day;
      if (!st.to || p.day > st.to) st.to = p.day;
    });
    st.games = Object.keys(games).length;
    st.known = Object.keys(known).length;
    st.newp = players.length;
    return { matches: matches, rounds: rounds, players: players, stats: st };
  }

  var API = { MAX_FILE: MAX_FILE, parseText: parseText, readBytes: readBytes, plan: plan, sid: sid };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.OrosScoresImport = API;
})(typeof self !== "undefined" ? self : this);
