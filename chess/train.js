// ============================================================
// orOS Chess — train.js: puzzles and openings, the pure parts (v1.0.0)
// No DOM, no storage: chess.js calls these, tests/chess-train.test.js
// loads this file in node.
//   1. Puzzle packs: the Lichess puzzle CSV layout (PuzzleId, FEN,
//      Moves, Rating, RatingDeviation, Popularity, NbPlays, Themes,
//      GameUrl, OpeningTags), or its short form "id,fen,moves,rating,
//      themes". FEN = the position BEFORE the opponent's move; Moves[0]
//      is that move, then the solution (you, reply, you, ...).
//      Packs are scripts that push { id, name, csv } onto
//      self.OrosChessPacks (chess/puzzles-*.js), so they work offline
//      from the service worker cache with no fetch.
//   2. Puzzle history (synced): { <id>: [at, ok, fix] } = the first
//      attempt's time, solved at the first try (1) or not (0), and the
//      time of a later solve (0 = none). Join: the earliest (at, ok)
//      wins, fix = the latest solve seen anywhere. Symmetric,
//      associative, idempotent; entries older than the reset stamp drop.
//   3. Rating: Glicko-1 over the first attempts in time order (each
//      puzzle is an opponent with its own rating and deviation), so the
//      rating is the same on every device and never needs merging.
//   4. Picking the next puzzle: by theme, near your rating, unseen
//      first; "retry" = failed and not solved since.
//   5. Openings: the Lichess chess-openings table (ECO, name, moves;
//      CC0) in a compact form (chess/openings-data.js), indexed by
//      position so a transposition still finds its name.
// ============================================================
(function (root) {
  "use strict";

  var ID_RE = /^[A-Za-z0-9_-]{2,16}$/;
  var UCI_RE = /^[a-h][1-8][a-h][1-8][nbrq]?$/;
  var THEME_RE = /^[A-Za-z0-9]{2,30}$/;
  var MAX_PACK = 20000;                     // puzzles kept from one pack
  var R0 = 1500, RD0 = 350, RD_MIN = 60, RD_PZ = 90;
  var R_MIN = 400, R_MAX = 3200;

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }

  // ---------- 1. Packs ----------
  // One CSV line (no quoted commas in this layout) → a puzzle, or null.
  function parseLine(line) {
    var f = String(line || "").trim().split(",");
    if (f.length < 4) return null;
    var id = f[0], fen = f[1], moves = (f[2] || "").trim().split(/\s+/), rating, rd = RD_PZ, themes;
    if (f.length >= 8) { rating = +f[3]; rd = +f[4] || RD_PZ; themes = f[7]; }   // full Lichess row
    else { rating = +f[3]; themes = f[4] || ""; }
    if (!ID_RE.test(id) || typeof fen !== "string" || fen.length > 100 || fen.split(" ").length < 4) return null;
    if (moves.length < 2 || moves.length > 40 || !moves.every(function (m) { return UCI_RE.test(m); })) return null;
    if (!isFinite(rating) || rating < 100 || rating > 4000) return null;
    rd = Math.max(30, Math.min(500, Math.round(rd)));
    var th = String(themes).trim().split(/\s+/).filter(function (x) { return THEME_RE.test(x); }).slice(0, 12);
    return { id: id, fen: fen, moves: moves, r: Math.round(rating), rd: rd, th: th };
  }
  // A pack's text → puzzles (header and bad lines skipped, ids unique).
  function parsePack(text) {
    var out = [], seen = {};
    String(text || "").split(/\r?\n/).forEach(function (line) {
      if (out.length >= MAX_PACK || !line || /^PuzzleId,/.test(line)) return;
      var p = parseLine(line);
      if (p && !seen[p.id]) { seen[p.id] = true; out.push(p); }
    });
    return out;
  }
  // The puzzle checked against the rules (needs the engine): every move
  // legal from the FEN. Returns { pos (after the opponent's move), side }
  // or null.
  function checkPuzzle(E, p) {
    var P = E.parseFen(p.fen);
    if (!P) return null;
    for (var i = 0; i < p.moves.length; i++) {
      var m = E.fromUci(P, p.moves[i]);
      if (!m) return null;
      E.makeMove(P, m);
    }
    var Q = E.parseFen(p.fen);
    E.makeMove(Q, E.fromUci(Q, p.moves[0]));
    return { pos: Q, side: Q.t > 0 ? "w" : "b" };
  }
  // Is uci the right answer at solution step k (index into p.moves)?
  // The last move may be any other mate (as on Lichess).
  function rightMove(E, P, p, k, uci) {
    if (uci === p.moves[k]) return true;
    if (k !== p.moves.length - 1) return false;
    var m = E.fromUci(P, uci);
    if (!m) return false;
    E.makeMove(P, m);
    var mate = E.inCheck(P) && E.legalMoves(P).length === 0;
    E.unmakeMove(P);
    return mate;
  }
  // Every theme in the packs with its count, most first.
  function themeCounts(list) {
    var c = {};
    list.forEach(function (p) { p.th.forEach(function (x) { c[x] = (c[x] || 0) + 1; }); });
    return Object.keys(c).sort(function (a, b) { return c[b] - c[a] || (a < b ? -1 : 1); })
      .map(function (k) { return { theme: k, n: c[k] }; });
  }

  // ---------- 2. History ----------
  function normEntry(v) {
    if (!Array.isArray(v) || v.length < 2 || !isInt(v[0]) || v[0] <= 0 || (v[1] !== 0 && v[1] !== 1)) return null;
    var fix = isInt(v[2]) && v[2] > 0 ? v[2] : 0;
    if (v[1] === 1 && fix < v[0]) fix = v[0];
    return [v[0], v[1], fix];
  }
  function joinEntry(a, b) {
    var first = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? a : b;
    return [first[0], first[1], Math.max(a[2], b[2])];
  }
  // A, B: { id: entry } maps (anything else is ignored); br: drop older.
  function mergeHistory(A, B, br) {
    var out = {}, keys = {};
    br = isInt(br) ? br : 0;
    [A, B].forEach(function (m) {
      if (!m || typeof m !== "object" || Array.isArray(m)) return;
      Object.keys(m).forEach(function (id) {
        if (!ID_RE.test(id)) return;
        var e = normEntry(m[id]);
        if (!e || e[0] < br) return;
        out[id] = out[id] ? joinEntry(out[id], e) : e;
        keys[id] = true;
      });
    });
    var sorted = {};
    Object.keys(keys).sort().forEach(function (id) { sorted[id] = out[id]; });
    return sorted;
  }
  // A result: the first attempt sets [at, ok]; a later solve sets fix.
  function record(hist, id, ok, at) {
    var h = {};
    Object.keys(hist || {}).forEach(function (k) { h[k] = hist[k]; });
    var e = h[id];
    if (!e) h[id] = [at, ok ? 1 : 0, ok ? at : 0];
    else if (ok) h[id] = [e[0], e[1], Math.max(e[2], at)];
    return h;
  }

  // ---------- 3. Rating (Glicko-1, no time decay) ----------
  var Q = Math.LN10 / 400;
  function g(rd) { return 1 / Math.sqrt(1 + 3 * Q * Q * rd * rd / (Math.PI * Math.PI)); }
  function update(me, opp, score) {
    var gj = g(opp.rd);
    var ex = 1 / (1 + Math.pow(10, -gj * (me.r - opp.r) / 400));
    var d2 = 1 / (Q * Q * gj * gj * ex * (1 - ex));
    var den = 1 / (me.rd * me.rd) + 1 / d2;
    var r = me.r + (Q / den) * gj * (score - ex);
    var rd = Math.sqrt(1 / den);
    return { r: Math.max(R_MIN, Math.min(R_MAX, r)), rd: Math.max(RD_MIN, rd) };
  }
  // hist + puzzles by id → { r, rd, n, won, steps: [{id, at, ok, r}] in time order }
  function rating(hist, byId) {
    var me = { r: R0, rd: RD0 }, steps = [], won = 0;
    Object.keys(hist || {}).map(function (id) { return { id: id, e: hist[id] }; })
      .filter(function (x) { return byId[x.id]; })
      .sort(function (a, b) { return a.e[0] - b.e[0] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); })
      .forEach(function (x) {
        var p = byId[x.id];
        var before = Math.round(me.r);
        me = update(me, { r: p.r, rd: p.rd }, x.e[1]);
        if (x.e[1]) won++;
        steps.push({ id: x.id, at: x.e[0], ok: x.e[1], fix: x.e[2], r: Math.round(me.r), d: Math.round(me.r) - before });
      });
    return { r: Math.round(me.r), rd: Math.round(me.rd), n: steps.length, won: won, steps: steps };
  }

  // ---------- 4. Picking ----------
  // opts: { theme ("" = any), r (your rating), rnd () → [0, 1), not (id to skip) }
  function pick(list, hist, opts) {
    opts = opts || {};
    var rnd = opts.rnd || Math.random, theme = opts.theme || "", target = (opts.r || R0) + Math.round((rnd() - 0.5) * 200);
    var pool = list.filter(function (p) { return (!theme || p.th.indexOf(theme) >= 0) && p.id !== opts.not; });
    var fresh = pool.filter(function (p) { return !hist || !hist[p.id]; });
    var from = fresh.length ? fresh : pool;
    if (!from.length) return null;
    var near = from.slice().sort(function (a, b) {
      return Math.abs(a.r - target) - Math.abs(b.r - target) || (a.id < b.id ? -1 : 1);
    }).slice(0, 6);
    return near[Math.floor(rnd() * near.length)] || null;
  }
  // Failed at the first try and not solved since, oldest first.
  function toRetry(list, hist) {
    return list.filter(function (p) { var e = hist && hist[p.id]; return e && e[1] === 0 && !e[2]; })
      .sort(function (a, b) { return hist[a.id][0] - hist[b.id][0]; });
  }

  // ---------- 5. Openings ----------
  // Text: line 1 = the families "A|B|…"; then "eco|family (base 36)|
  // variation|parent line (base 36, "" = none)|extra UCI moves".
  function parseOpenings(text) {
    var lines = String(text || "").split("\n"), fam = (lines[0] || "").split("|"), out = [];
    for (var i = 1; i < lines.length; i++) {
      var f = lines[i].split("|");
      if (f.length !== 5 || !/^[A-E][0-9]{2}$/.test(f[0])) return null;
      var fi = parseInt(f[1], 36), base = f[3] === "" ? [] : out[parseInt(f[3], 36)];
      if (!(fi >= 0 && fi < fam.length) || !base) return null;
      var mv = f[4] ? f[4].split(" ") : [];
      if (!mv.every(function (m) { return UCI_RE.test(m); })) return null;
      out.push({ eco: f[0], family: fam[fi], variation: f[2], name: f[2] ? fam[fi] + ": " + f[2] : fam[fi],
                 moves: base.moves ? base.moves.concat(mv) : mv });
    }
    return out;
  }
  // The position's key for naming: placement, side, castling (no en
  // passant square, no clocks), so transpositions meet.
  function posKey(E, P) { return E.toFen(P).split(" ").slice(0, 3).join(" "); }
  // { byKey: { key: index }, max: longest line in plies }
  function indexOpenings(E, list) {
    var byKey = {}, max = 0;
    list.forEach(function (o, i) {
      var P = E.parseFen(E.START);
      for (var k = 0; k < o.moves.length; k++) {
        var m = E.fromUci(P, o.moves[k]);
        if (!m) return;
        E.makeMove(P, m);
      }
      var key = posKey(E, P);
      // the shortest line (listed first) names a position reached two ways
      if (byKey[key] === undefined) byKey[key] = i;
      if (o.moves.length > max) max = o.moves.length;
    });
    return { byKey: byKey, max: max };
  }
  // The opening of a game from the start: the last position on the way
  // that has a name. Returns the opening or null.
  function nameOf(E, list, ix, moves) {
    var P = E.parseFen(E.START), found = null;
    var n = Math.min(moves.length, ix.max + 2);
    for (var k = 0; k < n; k++) {
      var m = E.fromUci(P, moves[k]);
      if (!m) break;
      E.makeMove(P, m);
      var i = ix.byKey[posKey(E, P)];
      if (i !== undefined) found = list[i];
    }
    return found;
  }
  // Families with their lines, for the trainer's list.
  function families(list) {
    var map = {}, order = [];
    list.forEach(function (o, i) {
      if (!map[o.family]) { map[o.family] = []; order.push(o.family); }
      map[o.family].push(i);
    });
    return order.sort().map(function (f) { return { name: f, lines: map[f] }; });
  }
  // The side a trainee plays by default: black for a "Defense", a
  // "Counter…" or a "Gambit Declined" (black's choice), else white.
  function defaultSide(o) {
    if (/Defen[cs]e|Counter|Gambit Declined/i.test(o.family)) return "b";
    return "w";
  }

  var API = {
    parseLine: parseLine, parsePack: parsePack, checkPuzzle: checkPuzzle, rightMove: rightMove, themeCounts: themeCounts,
    normEntry: normEntry, mergeHistory: mergeHistory, record: record,
    update: update, rating: rating, pick: pick, toRetry: toRetry,
    parseOpenings: parseOpenings, indexOpenings: indexOpenings, nameOf: nameOf, posKey: posKey,
    families: families, defaultSide: defaultSide, R0: R0, RD0: RD0, ID_RE: ID_RE
  };
  root.OrosChessTrain = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this));
