// ============================================================
// orOS Gomoku — App logic (v1.0.0)
// Five in a row on a 15×15 board (freestyle: five or more wins).
// Black moves first; the stones go on the intersections.
//   - vs Computer, 3 levels, all built on a threat evaluation (five,
//     open four, four, open three, three, two, for both sides):
//     Easy (one of the best few moves) · Medium (the best move) ·
//     Hard (a search for a win by fours, then an alpha-beta search
//     over the best threat points, 700 ms budget). Every level takes
//     a win in one, blocks a four and stops an open four in the
//     making. Choose your colour.
//   - 2 players on one device, with a running series score
//   - the winning line lights up; the last stone is marked
//   - on a touch screen with small intersections a tap aims (ghost
//     stone + crosshair) and a second tap on the same point places,
//     so no zoom is needed; mouse and keyboard place at once
//   - undo (vs the computer it also takes back its answer)
// Data:
//   - synced slice "gomoku" (oros-gomoku-data): results vs the computer
//     per level as per-device counters (each device only grows its own
//     row; merge = per-row max, a join) + reset stamp br
//   - device-local (R10): oros-gomoku-prefs (mode, level, colour),
//     oros-gomoku-session (the game in progress and the 2-player
//     series), oros-gomoku-device (counter row id), oros-gomoku-sfx
// Sections:
//   1. Constants, i18n, helpers
//   2. Board model (lines, win, replay)
//   3. Computer player (threats, win by fours, alpha-beta)
//   4. Synced data: load / save / normalize / merge (R5, R26)
//   5. Device-local prefs + session
//   6. Game flow (new, aim, play, computer turn, undo, finish)
//   7. Render (toolbar, status, board, stones)
//   8. Dialogs (result, records, confirm)
//   9. Toasts
//  10. Sound
//  11. Keyboard (arrows, Enter/Space, Esc, N, Z, Contract Β)
//  12. Sync slice + palette
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-gomoku-data";
  var PREFS_KEY   = "oros-gomoku-prefs";
  var SESSION_KEY = "oros-gomoku-session";
  var DEVICE_KEY  = "oros-gomoku-device";
  var SFX_KEY     = "oros-gomoku-sfx";
  var DATA_VER    = 1;

  var S = 15, N = S * S, CENTER = 7 * S + 7;
  var LEVELS = ["e", "m", "h"];
  var MODES = ["ai", "duo"];
  var COLORS = ["b", "w"];
  var HARD_BUDGET = 700;                     // ms
  var AI_MIN_DELAY = 350;                    // ms, so the reply is visible
  var AIM_BELOW = 40;                        // px: touch aims first under this point size
  var DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
  var STARS = [3 * S + 3, 3 * S + 11, 7 * S + 7, 11 * S + 3, 11 * S + 11];
  // Shape scores for one line through a new stone.
  var SH_FIVE = 6, SH_OPEN4 = 5, SH_FOUR = 4, SH_OPEN3 = 3, SH_THREE = 2, SH_TWO = 1;
  var SHAPE_SCORE = [0, 120, 600, 4000, 9000, 100000, 1000000];

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();

  var STRINGS = {
    en: {
      "mode.ai": "vs Computer", "mode.duo": "2 players",
      "level.e": "Easy", "level.m": "Medium", "level.h": "Hard",
      "color.b": "You: black", "color.w": "You: white",
      "color.label": "Your colour (black moves first)",
      "side.you": "You", "side.ai": "Computer",
      "player.1": "Black", "player.2": "White",
      "pl.1": "black", "pl.2": "white",
      "turn.you": "Your turn", "turn.ai": "Computer is thinking…",
      "turn.player": "{player} to move",
      "turn.aim": "Tap the same point again to place",
      "turn.win": "{who} won", "turn.youwin": "You won", "turn.draw": "Draw",
      "btn.new": "New game (N)", "btn.undo": "Undo move (Z)",
      "btn.undoNone": "Nothing to undo",
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "board.label": "Gomoku board, 15 by 15",
      "sq.empty": "{sq}, empty", "sq.s1": "{sq}, black", "sq.s2": "{sq}, white",
      "sq.aim": "aimed: tap again to place",
      "live.move": "{who}: {sq}",
      "res.title": "Game over",
      "res.youwin": "You win!",
      "res.ailose": "The computer wins",
      "res.pwin": "{player} wins!",
      "res.draw": "It's a draw!",
      "res.again": "Play again",
      "res.close": "Close",
      "res.series": "Series",
      "res.moves": "Stones",
      "res.line": "Line",
      "stats.title": "Records vs computer",
      "stats.head": "Won · lost · drawn",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "confirm.reset": "Delete the records vs the computer on every device, and this device's 2-player series?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Records reset",
      "toast.newgame": "New game started",
      "toast.undo": "Undo",
      "toast.save": "Could not save: storage is full",
      "toast.taken": "This point is taken",
      "toast.wait": "The computer is playing",
      "toast.over": "The game is over: start a new one (N)"
    },
    el: {
      "mode.ai": "Με υπολογιστή", "mode.duo": "2 παίκτες",
      "level.e": "Εύκολο", "level.m": "Μεσαίο", "level.h": "Δύσκολο",
      "color.b": "Εσύ: μαύρα", "color.w": "Εσύ: λευκά",
      "color.label": "Το χρώμα σου (τα μαύρα παίζουν πρώτα)",
      "side.you": "Εσύ", "side.ai": "Υπολογιστής",
      "player.1": "Μαύρα", "player.2": "Λευκά",
      "pl.1": "μαύρα", "pl.2": "λευκά",
      "turn.you": "Σειρά σου", "turn.ai": "Ο υπολογιστής σκέφτεται…",
      "turn.player": "Παίζουν τα {pl}",
      "turn.aim": "Πάτα ξανά το ίδιο σημείο για να παίξεις",
      "turn.win": "Κέρδισε: {who}", "turn.youwin": "Κέρδισες", "turn.draw": "Ισοπαλία",
      "btn.new": "Νέο παιχνίδι (N)", "btn.undo": "Αναίρεση κίνησης (Z)",
      "btn.undoNone": "Δεν υπάρχει κίνηση για αναίρεση",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "board.label": "Ταμπλό, 15 επί 15",
      "sq.empty": "{sq}, κενό", "sq.s1": "{sq}, μαύρο", "sq.s2": "{sq}, λευκό",
      "sq.aim": "στόχος: πάτα ξανά για να παίξεις",
      "live.move": "{who}: {sq}",
      "res.title": "Τέλος",
      "res.youwin": "Κέρδισες!",
      "res.ailose": "Κέρδισε ο υπολογιστής",
      "res.pwin": "Κέρδισαν τα {pl}!",
      "res.draw": "Ισοπαλία!",
      "res.again": "Ξανά",
      "res.close": "Κλείσιμο",
      "res.series": "Σειρά αγώνων",
      "res.moves": "Πέτρες",
      "res.line": "Γραμμή",
      "stats.title": "Ρεκόρ με υπολογιστή",
      "stats.head": "Νίκες · ήττες · ισοπαλίες",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ με τον υπολογιστή σε όλες τις συσκευές και η σειρά αγώνων 2 παικτών αυτής της συσκευής;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.newgame": "Ξεκίνησε νέο παιχνίδι",
      "toast.undo": "Αναίρεση",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "toast.taken": "Το σημείο είναι πιασμένο",
      "toast.wait": "Παίζει ο υπολογιστής",
      "toast.over": "Το παιχνίδι τελείωσε: ξεκίνα νέο (N)"
    }
  };

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var str = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) {
      Object.keys(params).forEach(function (k) {
        str = str.split("{" + k + "}").join(String(params[k]));
      });
    }
    return str;
  }

  function $(id) { return document.getElementById(id); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  // crypto RNG with rejection sampling (same as Dice / Memory)
  function randInt(n) {
    var buf = new Uint32Array(1);
    var lim = 0xFFFFFFFF - (0xFFFFFFFF % n);
    while (true) {
      crypto.getRandomValues(buf);
      if (buf[0] < lim) return buf[0] % n;
    }
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("gomoku.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Board model ----------
  // cells[r * 15 + c], r = 0 is the top row; 0 empty, 1 black, 2 white.

  // Length of p's run through i along direction d (i itself counts).
  function runLength(cells, i, d, p) {
    var r0 = (i / S) | 0, c0 = i % S, dr = DIRS[d][0], dc = DIRS[d][1], n = 1;
    for (var s = -1; s <= 1; s += 2) {
      var r = r0 + dr * s, c = c0 + dc * s;
      while (r >= 0 && r < S && c >= 0 && c < S && cells[r * S + c] === p) {
        n++; r += dr * s; c += dc * s;
      }
    }
    return n;
  }

  // The winning line through i for p (every stone of a run of 5 or more), or null.
  function lineAt(cells, i, p) {
    var r0 = (i / S) | 0, c0 = i % S;
    for (var d = 0; d < 4; d++) {
      var dr = DIRS[d][0], dc = DIRS[d][1], line = [i];
      for (var s = -1; s <= 1; s += 2) {
        var r = r0 + dr * s, c = c0 + dc * s;
        while (r >= 0 && r < S && c >= 0 && c < S && cells[r * S + c] === p) {
          line.push(r * S + c);
          r += dr * s; c += dc * s;
        }
      }
      if (line.length >= 5) return line.sort(function (a, b) { return a - b; });
    }
    return null;
  }

  // Replay a move list (black first). null if a move is illegal.
  function replay(moves) {
    var cells = [], p = 1, win = null;
    for (var k = 0; k < N; k++) cells.push(0);
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      if (win || !isInt(m) || m < 0 || m >= N || cells[m]) return null;
      cells[m] = p;
      win = lineAt(cells, m, p);
      p = 3 - p;
    }
    var full = moves.length === N;
    return { cells: cells, next: p, win: win, last: moves.length ? moves[moves.length - 1] : -1,
             over: !!win || full, winner: win ? 3 - p : 0 };
  }

  // ---------- 3. Computer player ----------
  // Empty points that would give p five in a row along direction d,
  // with p's stone already on i (the five must include i).
  function fiveCells(cells, i, d, p, out) {
    var r0 = (i / S) | 0, c0 = i % S, dr = DIRS[d][0], dc = DIRS[d][1];
    for (var k = -4; k <= 4; k++) {
      if (!k) continue;
      var r = r0 + dr * k, c = c0 + dc * k;
      if (r < 0 || r >= S || c < 0 || c >= S) continue;
      var j = r * S + c;
      if (cells[j]) continue;
      cells[j] = p;
      // the run through j must reach i
      var lo = 0, hi = 0, rr, cc;
      rr = r - dr; cc = c - dc;
      while (rr >= 0 && rr < S && cc >= 0 && cc < S && cells[rr * S + cc] === p) { lo++; rr -= dr; cc -= dc; }
      rr = r + dr; cc = c + dc;
      while (rr >= 0 && rr < S && cc >= 0 && cc < S && cells[rr * S + cc] === p) { hi++; rr += dr; cc += dc; }
      cells[j] = 0;
      if (lo + hi + 1 >= 5 && reaches(k, lo, hi)) {
        if (out.indexOf(j) < 0) out.push(j);
      }
    }
    return out;
  }
  // i sits at offset -k from j; the run through j spans [-lo, +hi].
  function reaches(k, lo, hi) { return -k >= -lo && -k <= hi; }

  // The shape the stone on i makes for p along direction d.
  function shapeAt(cells, i, d, p) {
    if (runLength(cells, i, d, p) >= 5) return SH_FIVE;
    var w = fiveCells(cells, i, d, p, []).length;
    if (w >= 2) return SH_OPEN4;
    if (w === 1) return SH_FOUR;
    // three: one more stone in this line makes a four (open three: an open four)
    var r0 = (i / S) | 0, c0 = i % S, dr = DIRS[d][0], dc = DIRS[d][1], best = 0;
    for (var k = -4; k <= 4 && best < SH_OPEN3; k++) {
      if (!k) continue;
      var r = r0 + dr * k, c = c0 + dc * k;
      if (r < 0 || r >= S || c < 0 || c >= S) continue;
      var j = r * S + c;
      if (cells[j]) continue;
      cells[j] = p;
      var w2 = fiveCells(cells, i, d, p, []).length;
      cells[j] = 0;
      if (w2 >= 2) best = SH_OPEN3;
      else if (w2 === 1 && best < SH_THREE) best = SH_THREE;
    }
    if (best) return best;
    // two: a window of five holding two of p's stones and nothing else
    for (var s = -4; s <= 0; s++) {
      var mine = 0, free = true;
      for (var q = s; q < s + 5; q++) {
        var rq = r0 + dr * q, cq = c0 + dc * q;
        if (rq < 0 || rq >= S || cq < 0 || cq >= S) { free = false; break; }
        var v = cells[rq * S + cq];
        if (v === p) mine++; else if (v) { free = false; break; }
      }
      if (free && mine >= 2) return SH_TWO;
    }
    return 0;
  }

  // The same shape from a lookup table: a shape only depends on the
  // eight points within four of i along the line (empty, p's, or the
  // other side's / off the board), so each of the 3^8 patterns is
  // worked out once with shapeAt on a scratch board and remembered.
  var SHAPE_MEMO = [];
  function lineCode(cells, i, d, p) {
    var r0 = (i / S) | 0, c0 = i % S, dr = DIRS[d][0], dc = DIRS[d][1], code = 0;
    for (var k = -4; k <= 4; k++) {
      if (!k) continue;
      var r = r0 + dr * k, c = c0 + dc * k, v;
      if (r < 0 || r >= S || c < 0 || c >= S) v = 2;
      else { v = cells[r * S + c]; v = v === p ? 1 : (v ? 2 : 0); }
      code = code * 3 + v;
    }
    return code;
  }
  function shapeFast(cells, i, d, p) {
    var code = lineCode(cells, i, d, p), sh = SHAPE_MEMO[code];
    if (sh === undefined) {
      var tmp = [], x = code, k;
      for (k = 0; k < N; k++) tmp.push(0);
      for (k = 4; k >= -4; k--) {
        if (!k) continue;
        tmp[CENTER + k] = [0, 1, 2][x % 3];
        x = (x / 3) | 0;
      }
      tmp[CENTER] = 1;
      sh = SHAPE_MEMO[code] = shapeAt(tmp, CENTER, 0, 1);
    }
    return sh;
  }

  // Value of a stone of p on the empty point i (all four lines, with
  // bonuses for double threats).
  function pointScore(cells, i, p) {
    cells[i] = p;
    var sum = 0, fours = 0, threes = 0, five = false;
    for (var d = 0; d < 4; d++) {
      var sh = shapeFast(cells, i, d, p);
      if (sh === SH_FIVE) five = true;
      else if (sh === SH_OPEN4 || sh === SH_FOUR) fours++;
      else if (sh === SH_OPEN3) threes++;
      sum += SHAPE_SCORE[sh];
    }
    cells[i] = 0;
    if (five) return SHAPE_SCORE[SH_FIVE];
    if (fours >= 2 || (fours && threes)) sum += 90000;      // four-four, four-three: wins
    else if (threes >= 2) sum += 20000;                     // three-three
    return sum;
  }

  // Empty points within two of a stone (the centre on an empty board).
  function candidates(cells) {
    var out = [], any = false;
    for (var i = 0; i < N; i++) {
      if (cells[i]) { any = true; continue; }
      var r = (i / S) | 0, c = i % S, near = false;
      for (var dr = -2; dr <= 2 && !near; dr++) {
        for (var dc = -2; dc <= 2; dc++) {
          var rr = r + dr, cc = c + dc;
          if (rr >= 0 && rr < S && cc >= 0 && cc < S && cells[rr * S + cc]) { near = true; break; }
        }
      }
      if (near) out.push(i);
    }
    if (!any) out.push(CENTER);
    return out;
  }

  // Points where p completes five right now.
  function winningPoints(cells, p) {
    var out = candidates(cells);
    return out.filter(function (i) {
      cells[i] = p;
      var w = false;
      for (var d = 0; d < 4 && !w; d++) if (runLength(cells, i, d, p) >= 5) w = true;
      cells[i] = 0;
      return w;
    });
  }

  // Every candidate with attack, defence and a small pull to the centre.
  function scoreMoves(cells, p, defence) {
    var o = 3 - p;
    return candidates(cells).map(function (i) {
      var r = (i / S) | 0, c = i % S;
      var a = pointScore(cells, i, p), b = pointScore(cells, i, o);
      return { i: i, s: a + b * defence + (14 - Math.abs(r - 7) - Math.abs(c - 7)), a: a, b: b };
    }).sort(function (x, y) { return y.s - x.s; });
  }

  // Win by fours (VCF): p plays a four, the other side must block, and
  // so on, until p has two ways to five. Returns the first point, or -1.
  function vcf(cells, p, depth, ctx) {
    if (depth <= 0 || (ctx.deadline && now() > ctx.deadline)) return -1;
    var o = 3 - p;
    if (winningPoints(cells, p).length) return winningPoints(cells, p)[0];
    var theirs = winningPoints(cells, o);
    var list = candidates(cells);
    for (var k = 0; k < list.length; k++) {
      var e = list[k];
      if (theirs.length && theirs.indexOf(e) < 0) continue;   // their five must be blocked first
      cells[e] = p;
      var w = [];
      for (var d = 0; d < 4; d++) fiveCells(cells, e, d, p, w);
      var found = -1;
      if (w.length >= 2) found = e;
      else if (w.length === 1) {
        var blk = w[0];
        cells[blk] = o;
        var oWins = lineAt(cells, blk, o) !== null;
        if (!oWins && vcf(cells, p, depth - 1, ctx) >= 0) found = e;
        cells[blk] = 0;
      }
      cells[e] = 0;
      if (found >= 0) return found;
    }
    return -1;
  }

  function pickTop(list, n) {
    var top = list.slice(0, Math.min(n, list.length));
    return top[randInt(top.length)].i;
  }

  function Abort() {}

  // Static value of a position for p, the side to move: p's best threat
  // (it moves first) against the best threat the other side could make.
  function staticEval(cells, p) {
    var list = scoreMoves(cells, p, 1), ma = 0, mb = 0;
    for (var k = 0; k < list.length; k++) {
      if (list[k].a > ma) ma = list[k].a;
      if (list[k].b > mb) mb = list[k].b;
    }
    return ma - mb * 0.8;
  }

  // Alpha-beta over the best few threat-ordered points; a five ends the
  // line at once, a four of the other side must be blocked.
  var WIN = 10000000;
  function negamax(cells, p, depth, alpha, beta, ctx) {
    if (now() > ctx.deadline) throw new Abort();
    var o = 3 - p;
    if (winningPoints(cells, p).length) return WIN + depth;
    if (depth <= 0) return staticEval(cells, p);
    var theirs = winningPoints(cells, o), list;
    if (theirs.length >= 2) return -(WIN + depth - 1);
    if (theirs.length) list = [{ i: theirs[0] }];
    else list = scoreMoves(cells, p, 1).slice(0, ctx.width);
    if (!list.length) return 0;
    var best = -Infinity;
    for (var k = 0; k < list.length; k++) {
      cells[list[k].i] = p;
      var v;
      try { v = -negamax(cells, o, depth - 1, -beta, -alpha, ctx); }
      finally { cells[list[k].i] = 0; }
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  // Iterative deepening at the root while the time lasts; a depth that
  // runs out of time keeps the answer of the depth before.
  function searchRoot(cells, p, roots, budget) {
    var ctx = { deadline: now() + budget, width: 7 }, o = 3 - p;
    var bestI = roots[0].i;
    for (var depth = 1; depth <= 6; depth++) {
      var alpha = -Infinity, iterBest = -1, scores = [];
      try {
        for (var k = 0; k < roots.length; k++) {
          cells[roots[k].i] = p;
          var v;
          try { v = -negamax(cells, o, depth - 1, -Infinity, -alpha + 1, ctx); }
          finally { cells[roots[k].i] = 0; }
          scores.push({ i: roots[k].i, v: v, s: roots[k].s });
          if (v > alpha) { alpha = v; iterBest = roots[k].i; }
        }
      } catch (e) {
        if (e instanceof Abort) break;
        throw e;
      }
      bestI = iterBest;
      if (alpha >= WIN) break;                          // a forced win: done
      // the next depth looks at the most promising roots first
      scores.sort(function (x, y) { return y.v - x.v || y.s - x.s; });
      roots = scores;
    }
    return bestI;
  }

  // The computer's point for p, or -1 on a full board.
  function chooseMove(cells, p, level) {
    var work = cells.slice(), o = 3 - p;
    var free = 0;
    for (var i = 0; i < N; i++) if (!work[i]) free++;
    if (!free) return -1;
    var mine = winningPoints(work, p);
    if (mine.length) return mine[randInt(mine.length)];      // five now
    var theirs = winningPoints(work, o);
    if (theirs.length) return theirs[0];                     // block their five
    var list = scoreMoves(work, p, level === "e" ? 0.6 : 0.9);
    if (list[0].a >= 90000) return list[0].i;                // an open four / double threat of ours
    var stop = list.filter(function (x) { return x.b >= SHAPE_SCORE[SH_OPEN4]; });
    if (level === "h") {
      // Hard: a win by fours first, then a search over the best points
      // (only the blocking points when they threaten an open four).
      var v = vcf(work, p, 10, { deadline: now() + HARD_BUDGET * 0.25 });
      if (v >= 0) return v;
      var roots = (stop.length ? stop : list).slice(0, 10);
      return searchRoot(work, p, roots, HARD_BUDGET * 0.7);
    }
    if (stop.length) {
      // They would make an open four here: every level blocks it.
      stop.sort(function (x, y) { return y.s - x.s; });
      return stop[0].i;
    }
    if (level === "e") {
      var near = list.filter(function (x) { return x.s >= list[0].s * 0.5; });
      return pickTop(near, 4);
    }
    var best = list[0].s, ties = list.filter(function (x) { return x.s === best; });
    return ties[randInt(ties.length)].i;
  }

  // ---------- 4. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                               // max-merged
  //   rows: { <deviceId>: { b: <epoch>, s: { e:[w,l,d], m:[…], h:[…] } } }
  // }
  // Each device only ever increments ITS OWN row; a row counts from
  // epoch b. Merge per row: the newer epoch wins, equal epochs take the
  // per-cell max; rows older than br are dropped. That is a join
  // (symmetric, associative, idempotent), so no counter is lost or
  // double-counted however the devices meet.
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normRow(row) {
    if (!row || typeof row !== "object" || !isInt(row.b) || row.b < 0) return null;
    var s = {}, any = false;
    LEVELS.forEach(function (lv) {
      var v = row.s && row.s[lv];
      if (Array.isArray(v) && v.length === 3 &&
          isInt(v[0]) && isInt(v[1]) && isInt(v[2]) && v[0] >= 0 && v[1] >= 0 && v[2] >= 0) {
        s[lv] = [v[0], v[1], v[2]];
        any = true;
      }
    });
    return any ? { b: row.b, s: s } : null;
  }

  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var s = {};
    LEVELS.forEach(function (lv) {
      var a = x.s[lv], c = y.s[lv];
      if (!a && !c) return;
      if (!a) { s[lv] = c.slice(); return; }
      if (!c) { s[lv] = a.slice(); return; }
      s[lv] = [Math.max(a[0], c[0]), Math.max(a[1], c[1]), Math.max(a[2], c[2])];
    });
    return { b: x.b, s: s };
  }

  function mergeGomoku(A, B) {
    var a = A || {}, b = B || {};
    var br = Math.max(isInt(a.br) ? a.br : 0, isInt(b.br) ? b.br : 0);
    var rows = {};
    [a.rows || {}, b.rows || {}].forEach(function (m) {
      if (!m || typeof m !== "object") return;
      Object.keys(m).forEach(function (id) {
        var r = normRow(m[id]);
        if (!r || r.b < br) return;
        rows[id] = rows[id] ? joinRows(rows[id], r) : r;
      });
    });
    var sorted = {};
    Object.keys(rows).sort(cmpStr).forEach(function (id) {
      var r = rows[id], s = {};
      LEVELS.forEach(function (lv) { if (r.s[lv]) s[lv] = r.s[lv].slice(); });
      sorted[id] = { b: r.b, s: s };
    });
    return { ver: DATA_VER, br: br, rows: sorted };
  }

  // Totals per level across every device: [won, lost, drawn].
  function totals(lv) {
    var out = [0, 0, 0];
    Object.keys(data.rows).forEach(function (id) {
      var v = data.rows[id].s[lv];
      if (v) { out[0] += v[0]; out[1] += v[1]; out[2] += v[2]; }
    });
    return out;
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.rows && typeof parsed.rows === "object") {
          data = mergeGomoku(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.warn("[orOS] gomoku: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = defaultData();
  }

  var saveFailShown = false;
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function ensureDeviceId() {
    try { deviceId = localStorage.getItem(DEVICE_KEY); } catch (e) {}
    if (!deviceId || !/^[a-z0-9]{6,32}$/.test(deviceId)) {
      deviceId = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem(DEVICE_KEY, deviceId); } catch (e) {}
    }
  }

  // res: 0 = you won, 1 = you lost, 2 = draw
  function countResult(lv, res) {
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // a new epoch after a reset
    var v = row.s[lv] ? row.s[lv].slice() : [0, 0, 0];
    v[res]++;
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    row.s[lv] = v;
    data.rows[deviceId] = row;
    data = mergeGomoku(data, data);
    save();
  }

  // ---------- 5. Device-local prefs + session ----------
  var prefs = { mode: "ai", lv: "m", color: "b" };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (MODES.indexOf(p.mode) >= 0) prefs.mode = p.mode;
        if (LEVELS.indexOf(p.lv) >= 0) prefs.lv = p.lv;
        if (COLORS.indexOf(p.color) >= 0) prefs.color = p.color;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = {
  //   mode, lv,
  //   ai: 0 | 1 | 2,        // the computer's colour (vs computer); 1 = black
  //   moves: [point…],      // black first
  //   done: bool,
  //   series: [black, white] // 2-player running score (this device)
  // }
  var game = null, board = null;

  function validSession(g) {
    if (!g || typeof g !== "object" || MODES.indexOf(g.mode) < 0 ||
        LEVELS.indexOf(g.lv) < 0 || [0, 1, 2].indexOf(g.ai) < 0 ||
        (g.mode === "ai") !== (g.ai !== 0) ||
        !Array.isArray(g.moves) || g.moves.length > N ||
        !Array.isArray(g.series) || g.series.length !== 2 ||
        !isInt(g.series[0]) || !isInt(g.series[1])) return false;
    return replay(g.moves) !== null;
  }
  function loadSession() {
    try {
      var g = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(g)) { g.done = g.done === true; return g; }
    } catch (e) {}
    return null;
  }
  function saveSession() {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(game)); } catch (e) {}
  }

  // ---------- 6. Game flow ----------
  var aiTimer = null;
  var aim = -1;            // touch: the aimed point waiting for a second tap
  var pointerKind = "";    // pointerType of the last pointerdown on the board
  var fresh_ = -1;         // the stone to animate once

  function fresh(series) {
    return { mode: prefs.mode, lv: prefs.lv,
             ai: prefs.mode === "ai" ? (prefs.color === "b" ? 2 : 1) : 0,
             moves: [], done: false, series: series || [0, 0] };
  }

  function inProgress() { return !!(game && !game.done && game.moves.length > 0); }

  // A game in progress is never lost silently: Undo toast (R14).
  function newGame(announce, keepSeries) {
    var prev = inProgress() ? JSON.parse(JSON.stringify(game)) : null;
    var prevPrefs = JSON.parse(JSON.stringify(prefs));
    cancelAi();
    var series = (keepSeries && game && game.mode === "duo" && prefs.mode === "duo") ? game.series.slice() : [0, 0];
    game = fresh(series);
    saveSession();
    syncBoard();
    renderAll(true);
    maybeAi();
    if (prev) {
      undoToast(t("toast.newgame"), function () {
        cancelAi();
        prefs = prevPrefs;
        savePrefs();
        game = prev;
        saveSession();
        syncBoard();
        renderAll(true);
        maybeAi();
      });
    } else if (announce) {
      live(t("toast.newgame"));
    }
  }

  function syncBoard() { board = replay(game.moves); aim = -1; }

  function aiTurn() { return game.mode === "ai" && !game.done && board.next === game.ai; }

  function cancelAi() { if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; } }

  function maybeAi() {
    if (!aiTurn() || aiTimer) return;
    renderStatus();
    var started = Date.now();
    aiTimer = setTimeout(function () {
      // let the "thinking" text paint, then search
      var m = chooseMove(board.cells, game.ai, game.lv);
      var wait = Math.max(0, AI_MIN_DELAY - (Date.now() - started));
      aiTimer = setTimeout(function () {
        aiTimer = null;
        if (aiTurn() && m >= 0) place(m);
      }, wait);
    }, 30);
  }

  function pointSize() {
    var q = $("board").querySelector(".sq");
    return q ? q.getBoundingClientRect().width : 99;
  }

  // A tap / click / Enter on point i. `direct`: place without aiming.
  function tapPoint(i, direct) {
    if (!game) return;
    if (game.done) { showToast(t("toast.over")); return; }          // R28
    if (aiTurn()) { showToast(t("toast.wait")); return; }
    if (board.cells[i]) { shake(i); showToast(t("toast.taken")); return; }
    if (!direct && i !== aim) {
      aim = i;
      sfx("aim");
      renderStones();
      renderStatus();
      live(t("sq.aim"));
      return;
    }
    place(i);
  }

  function place(i) {
    var p = board.next;
    game.moves.push(i);
    syncBoard();
    fresh_ = i;
    sfx("place");
    live(t("live.move", { who: sideName(p), sq: sqName(i) }));
    if (board.over) { finish(); return; }
    saveSession();
    renderAll(false);
    maybeAi();
  }

  // Undo: one move with 2 players; vs the computer, back to your turn.
  function canUndo() {
    if (!game || game.done || !game.moves.length) return false;
    if (game.mode === "duo") return true;
    return game.ai === 2 || game.moves.length >= 2;
  }
  function undo() {
    if (aim >= 0 && !game.done) { aim = -1; renderStones(); renderStatus(); return; }
    if (!canUndo()) { showToast(t("btn.undoNone")); return; }       // R28
    cancelAi();
    if (game.mode === "duo") {
      game.moves.pop();
    } else {
      while (game.moves.length) {
        var mover = (game.moves.length - 1) % 2 === 0 ? 1 : 2;
        game.moves.pop();
        if (mover !== game.ai) break;
      }
    }
    syncBoard();
    saveSession();
    renderAll(true);
    maybeAi();
  }

  function finish() {
    game.done = true;
    var winner = board.winner;
    if (game.mode === "duo") {
      if (winner) game.series[winner - 1]++;
    } else {
      countResult(game.lv, winner === 0 ? 2 : (winner === game.ai ? 1 : 0));
    }
    saveSession();
    renderAll(false);
    setTimeout(function () {
      sfx(winner && !(game.mode === "ai" && winner === game.ai) ? "win" : "end");
    }, 200);
    setTimeout(function () { resultDialog(); }, 1300);
  }

  // ---------- 7. Render ----------
  function sideName(p) {
    if (game && game.mode === "ai") return t(p === game.ai ? "side.ai" : "side.you");
    return t("player." + p);
  }

  // Point name: columns A–O left to right, rows 1–15 bottom up.
  function sqName(i) { return "ABCDEFGHJKLMNOP".charAt(i % S) + (S - ((i / S) | 0)); }

  function renderAll(rebuild) {
    renderToolbar();
    renderStatus();
    if (rebuild) buildBoard(); else renderStones();
  }

  function renderToolbar() {
    var mode = game ? game.mode : prefs.mode;
    var lv = game ? game.lv : prefs.lv;
    [].forEach.call(document.querySelectorAll("#mode-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-mode") === mode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-level") === lv;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    $("level-seg").hidden = mode !== "ai";
    $("color-select").hidden = mode !== "ai";
    $("color-select").value = prefs.color;
    var u = $("undo-btn"), ok = canUndo();
    u.disabled = !ok;
    u.title = t(ok ? "btn.undo" : "btn.undoNone");
    u.setAttribute("aria-label", u.title);
    paintSfxBtn();
  }

  function renderStatus() {
    if (!game) return;
    var ai = game.mode === "ai";
    $("name0").textContent = sideName(1);
    $("name1").textContent = sideName(2);
    if (ai) {
      var s = totals(game.lv);    // your wins next to you, the computer's next to it
      $("score0").textContent = String(game.ai === 1 ? s[1] : s[0]);
      $("score1").textContent = String(game.ai === 1 ? s[0] : s[1]);
    } else {
      $("score0").textContent = String(game.series[0]);
      $("score1").textContent = String(game.series[1]);
    }
    var next = board.next, txt;
    if (game.done) {
      var w = board.winner;
      txt = !w ? t("turn.draw") : (ai && w !== game.ai) ? t("turn.youwin") : t("turn.win", { who: sideName(w) });
    } else if (aim >= 0) {
      txt = t("turn.aim");
    } else if (ai) {
      txt = next === game.ai ? t("turn.ai") : t("turn.you");
    } else {
      txt = t("turn.player", { player: t("player." + next), pl: t("pl." + next) });
    }
    $("turn").textContent = txt;
    $("side0").classList.toggle("turn", !game.done && next === 1);
    $("side1").classList.toggle("turn", !game.done && next === 2);
  }

  var focusPt = CENTER;     // roving-tabindex point

  function buildBoard() {
    var el = $("board");
    el.innerHTML = "";
    el.setAttribute("role", "grid");
    el.setAttribute("aria-label", t("board.label"));
    for (var r = 0; r < S; r++) {
      var tr = document.createElement("div");
      tr.setAttribute("role", "row");
      tr.className = "brow";
      for (var c = 0; c < S; c++) {
        var i = r * S + c;
        var sq = document.createElement("button");
        sq.type = "button";
        sq.className = "sq" + (r === 0 ? " et" : "") + (r === S - 1 ? " eb" : "") +
                       (c === 0 ? " el" : "") + (c === S - 1 ? " er" : "") +
                       (STARS.indexOf(i) >= 0 ? " star" : "");
        sq.setAttribute("role", "gridcell");
        sq.setAttribute("data-i", String(i));
        sq.tabIndex = i === focusPt ? 0 : -1;
        tr.appendChild(sq);
      }
      el.appendChild(tr);
    }
    renderStones();
  }

  // Stones are updated in place; the newest one drops in.
  function renderStones() {
    var el = $("board");
    var human = !game.done && !aiTurn();
    var winSet = {};
    (board.win || []).forEach(function (i) { winSet[i] = true; });
    el.classList.toggle("over", !!game.done);
    el.classList.toggle("p1", board.next === 1);
    el.classList.toggle("p2", board.next === 2);
    el.classList.toggle("aiming", aim >= 0);
    var ar = aim >= 0 ? (aim / S) | 0 : -1, ac = aim >= 0 ? aim % S : -1;
    var sqs = el.querySelectorAll(".sq");
    var anim = fresh_;
    fresh_ = -1;
    for (var k = 0; k < sqs.length; k++) {
      var sq = sqs[k], i = +sq.getAttribute("data-i"), v = board.cells[i];
      var r = (i / S) | 0, c = i % S;
      sq.classList.toggle("aim", i === aim);
      sq.classList.toggle("cross", aim >= 0 && i !== aim && (r === ar || c === ac));
      sq.classList.toggle("last", i === board.last);
      sq.classList.toggle("taken", !!v);
      var st = sq.firstChild;
      if (!v) { if (st) sq.removeChild(st); }
      else {
        if (!st) { st = document.createElement("i"); sq.appendChild(st); }
        var cls = "st s" + v + (winSet[i] ? " win" : "") + (i === anim && !reducedMotion() ? " drop" : "");
        if (st.className !== cls) st.className = cls;
      }
      var label = t(v ? "sq.s" + v : "sq.empty", { sq: sqName(i) });
      if (i === aim) label += ", " + t("sq.aim");
      sq.setAttribute("aria-label", label);
      if (!human) sq.setAttribute("aria-disabled", "true");
      else sq.removeAttribute("aria-disabled");
    }
  }

  function squareEl(i) { return $("board").querySelector('.sq[data-i="' + i + '"]'); }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function shake(i) {
    var sq = squareEl(i);
    if (!sq || reducedMotion()) return;
    sq.classList.remove("shake");
    void sq.offsetWidth;
    sq.classList.add("shake");
  }

  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 8. Dialogs ----------
  function makeDialog(id) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "mm-dlg";
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () {
      parkToast();
      setTimeout(function () { dlg.remove(); }, 0);
    });
    return dlg;
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function row(k, v) {
    var r = el("div", "dlg-row");
    r.appendChild(el("span", "", k));
    r.appendChild(el("strong", "", v));
    return r;
  }
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  function resultDialog() {
    if (!game || !game.done || !board.over) return;     // undone / replaced meanwhile
    var winner = board.winner;
    var dlg = makeDialog("gm-result");
    var ai = game.mode === "ai";
    dlg.appendChild(el("div", "dlg-title",
      t("res.title") + (ai ? " · " + t("level." + game.lv) : "")));
    var hero = !winner ? t("res.draw")
      : ai ? t(winner === game.ai ? "res.ailose" : "res.youwin")
      : t("res.pwin", { player: t("player." + winner), pl: t("pl." + winner) });
    dlg.appendChild(el("div", "dlg-hero", hero));
    if (board.win) {
      dlg.appendChild(row(t("res.line"), sqName(board.win[0]) + " – " + sqName(board.win[board.win.length - 1])));
    }
    dlg.appendChild(row(t("res.moves"), String(game.moves.length)));
    if (ai) {
      dlg.appendChild(row(t("stats.head"), totals(game.lv).join(" · ")));
    } else {
      dlg.appendChild(row(t("res.series"), t("player.1") + " " + game.series[0] + " – " + game.series[1] + " " + t("player.2")));
    }
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("res.close"), "", function () { dlg.close(); }));
    var again = button(t("res.again"), "primary", function () { dlg.close(); newGame(false, true); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    again.focus();
  }

  function statsDialog() {
    var dlg = makeDialog("gm-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    LEVELS.forEach(function (lv) {
      var s = totals(lv);
      if (s[0] + s[1] + s[2]) empty = false;
      dlg.appendChild(row(t("level." + lv), s.join(" · ")));
    });
    if (game && (game.series[0] || game.series[1])) {
      empty = false;
      dlg.appendChild(el("div", "dlg-sub", t("mode.duo")));
      dlg.appendChild(row(t("res.series"), t("player.1") + " " + game.series[0] + " – " + game.series[1] + " " + t("player.2")));
    }
    var acts = el("div", "dlg-actions");
    var reset = button(t("stats.reset"), "danger", function () {
      dlg.close();
      confirmDialog(t("confirm.reset"), resetRecords);
    });
    reset.disabled = empty;
    acts.appendChild(reset);
    var close = button(t("stats.close"), "primary", function () { dlg.close(); });
    acts.appendChild(close);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    close.focus();
  }

  function confirmDialog(msg, onYes) {
    var dlg = makeDialog("gm-confirm");
    dlg.appendChild(el("div", "dlg-msg", msg));
    var acts = el("div", "dlg-actions");
    var no = button(t("confirm.no"), "", function () { dlg.close(); });
    acts.appendChild(no);
    acts.appendChild(button(t("confirm.yes"), "danger", function () { dlg.close(); onYes(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    no.focus();
  }

  // Reset = a new epoch: every device drops rows older than br and
  // starts its own row again from zero.
  function resetRecords() {
    data.br = Math.max(Date.now(), data.br + 1);
    data = mergeGomoku(data, data);
    save();
    if (game) { game.series = [0, 0]; saveSession(); }
    renderStatus();
    showToast(t("toast.reset"));
  }

  // ---------- 9. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "gomoku", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }

  // Undo toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, onUndo); }

  var toastTimer = null;
  function localToast(text, onUndo) {
    var box = $("toast");
    if (!box) return;
    hostToast();
    box.innerHTML = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    if (onUndo) {
      var b = el("button", "", t("toast.undo"));
      b.type = "button";
      b.addEventListener("click", function () {
        box.classList.remove("show");
        clearTimeout(toastTimer);
        onUndo();
      });
      box.appendChild(b);
    }
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, onUndo ? 8000 : 4000);
  }
  function hostToast() {
    var box = $("toast"), d = document.querySelector("dialog[open]");
    if (box && d && box.parentNode !== d) d.appendChild(box);
  }
  function parkToast() {
    var box = $("toast");
    if (box && box.parentNode !== document.body) document.body.appendChild(box);
  }

  // ---------- 10. Sound ----------
  var audio = null;
  function sfxOn() {
    try { return localStorage.getItem(SFX_KEY) === "1"; } catch (e) { return false; }
  }
  function tone(freq, start, dur, type, vol) {
    var o = audio.createOscillator(), g = audio.createGain();
    o.type = type || "sine";
    o.frequency.value = freq;
    var t0 = audio.currentTime + start;
    g.gain.setValueAtTime(vol || 0.18, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(audio.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function sfx(kind) {
    if (!sfxOn()) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio) audio = new AC();
      if (audio.state === "suspended") audio.resume();
      if (kind === "place") tone(520, 0, 0.06, "triangle", 0.16);
      else if (kind === "aim") tone(760, 0, 0.03, "sine", 0.06);
      else if (kind === "win") {
        [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
      } else if (kind === "end") { tone(392, 0, 0.18, "sine"); tone(294, 0.16, 0.3, "sine"); }
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Toolbar icons (R9: injected by JS) ----------
  var UI_ICONS = {
    new:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    undo:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    sfxOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    sfxOff:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>'
  };
  function paintSfxBtn() {
    var b = $("sfx-btn"), on = sfxOn();
    b.innerHTML = on ? UI_ICONS.sfxOn : UI_ICONS.sfxOff;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.setAttribute("aria-label", t(on ? "btn.sfxOn" : "btn.sfxOff"));
    b.title = t(on ? "btn.sfxOn" : "btn.sfxOff");
  }

  // ---------- 11. Keyboard ----------
  function focusPoint(i) {
    var prev = squareEl(focusPt), next = squareEl(i);
    if (!next) return;
    if (prev) prev.tabIndex = -1;
    focusPt = i;
    next.tabIndex = 0;
    next.focus();
  }

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.shiftKey) return;
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") { e.preventDefault(); undo(); return; }
      if (e.ctrlKey || e.metaKey) return;               // never steal OS combos
      if (e.code === "KeyN") { e.preventDefault(); newGame(true, true); return; }
      if (e.code === "KeyZ") { e.preventDefault(); undo(); return; }
      if (e.key === "Escape" && aim >= 0) { e.preventDefault(); aim = -1; renderStones(); renderStatus(); return; }
      var onSq = document.activeElement && document.activeElement.classList &&
                 document.activeElement.classList.contains("sq");
      if (/^Arrow/.test(e.key)) {
        e.preventDefault();
        if (!onSq) { focusPoint(focusPt); return; }
        var r = (focusPt / S) | 0, c = focusPt % S;
        if (e.key === "ArrowLeft") c--; else if (e.key === "ArrowRight") c++;
        else if (e.key === "ArrowUp") r--; else r++;
        if (r >= 0 && r < S && c >= 0 && c < S) focusPoint(r * S + c);
      }
    });

    // Contract Β: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
  }

  // ---------- 12. Sync slice + palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow", "--danger"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }

  function registerSync() {
    // LOCAL FIRST: load() has already run (boot order).
    var api = syncApi();
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("gomoku", sliceGet, sliceSet, STORAGE_KEY, mergeGomoku);
  }

  function sliceGet() {
    return mergeGomoku(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeGomoku(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    renderStatus();   // no toast on merge (sync feedback = taskbar dot)
  }

  // ---------- 13. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    $("color-select").setAttribute("aria-label", t("color.label"));
    $("color-select").title = t("color.label");
    $("mode-seg").setAttribute("aria-label", t("mode.ai") + " / " + t("mode.duo"));
  }

  function paintStatic() {
    [["new-btn", "new", "btn.new"], ["undo-btn", "undo", "btn.undo"],
     ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    paintSfxBtn();
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#mode-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () {
        var m = b.getAttribute("data-mode");
        if (game && m === game.mode && !game.done) return;   // visible active state
        prefs.mode = m; savePrefs(); newGame(true, true);
      });
    });
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () {
        var lv = b.getAttribute("data-level");
        if (game && lv === game.lv && !game.done) return;
        prefs.lv = lv; savePrefs(); newGame(true, true);
      });
    });
    $("color-select").addEventListener("change", function () {
      prefs.color = $("color-select").value;
      savePrefs();
      newGame(true, true);
      $("color-select").blur();
    });
    $("new-btn").addEventListener("click", function () { newGame(true, true); $("new-btn").blur(); });
    $("undo-btn").addEventListener("click", function () { undo(); });
    $("stats-btn").addEventListener("click", statsDialog);
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("place");   // audible confirmation when turned on
    });
    $("board").addEventListener("pointerdown", function (e) { pointerKind = e.pointerType || ""; });
    $("board").addEventListener("focusin", function (e) {
      var s = e.target.closest && e.target.closest(".sq");
      if (!s || s.tabIndex === 0) return;
      var prev = squareEl(focusPt);
      if (prev) prev.tabIndex = -1;
      focusPt = +s.getAttribute("data-i");
      s.tabIndex = 0;
    });
    $("board").addEventListener("click", function (e) {
      var s = e.target.closest && e.target.closest(".sq");
      if (!s) return;
      // Keyboard (detail 0) and mouse place at once; a finger on small
      // points aims first, the second tap on the same point places.
      var touch = e.detail !== 0 && (pointerKind === "touch" || pointerKind === "pen");
      tapPoint(+s.getAttribute("data-i"), !(touch && pointSize() < AIM_BELOW));
      pointerKind = "";
    });
    $("board").addEventListener("animationend", function (e) {
      if (e.target.classList && e.target.classList.contains("shake")) e.target.classList.remove("shake");
    });

    wireKeyboard();
  }

  function boot() {
    load();
    ensureDeviceId();
    loadPrefs();
    applyI18n();
    paintStatic();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    game = loadSession();
    if (game) {
      // The resumed game decides what the toolbar shows.
      prefs.mode = game.mode; prefs.lv = game.lv;
      if (game.ai) prefs.color = game.ai === 2 ? "b" : "w";
    } else {
      game = fresh(null);
    }
    syncBoard();
    if (board.over) game.done = true;
    renderAll(true);
    maybeAi();   // a game left on the computer's turn continues
  }

  boot();
})();
