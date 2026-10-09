// ============================================================
// orOS Checkers — App logic (v1.0.0)
// English draughts on an 8×8 board (the 32 dark squares).
//   - men move one square diagonally forward; capturing is
//     mandatory, a capture goes on jumping while it can (multi-jump in
//     one turn), men capture forward only
//   - a man reaching the far row is crowned; a crowning ends the turn
//   - kings move and capture one square in every diagonal (not flying)
//   - the side with no legal move loses; a draw after 40 moves each
//     with no capture and no crowning, or when a position repeats 3 times
//   - vs Computer, 3 levels: Easy (2-ply search with noise) · Medium
//     (alpha-beta depth 4) · Hard (iterative deepening, alpha-beta,
//     capture extension, 700 ms budget); choose your colour (Black
//     moves first)
//   - 2 players on one device, with a running series score
//   - undo (vs the computer it also takes back its answer)
// Data:
//   - synced slice "checkers" (oros-checkers-data): results vs the
//     computer per level as per-device counters (each device only
//     grows its own row; merge = per-row max, a join) + reset stamp br
//   - device-local (R10): oros-checkers-prefs (mode, level, colour),
//     oros-checkers-session (the game in progress and the 2-player
//     series), oros-checkers-device (counter row id),
//     oros-checkers-sfx (sound on/off)
// Sections:
//   1. Constants, i18n, helpers
//   2. Board model (moves, captures, crowning, end of game)
//   3. Computer player (alpha-beta)
//   4. Synced data: load / save / normalize / merge (R5, R26)
//   5. Device-local prefs + session
//   6. Game flow (new, select, play, computer turn, undo, finish)
//   7. Render (toolbar, status, board, pieces)
//   8. Dialogs (result, records, confirm)
//   9. Toasts
//  10. Sound
//  11. Keyboard (arrows, Enter/Space, Esc, N, Z, Contract Β)
//  12. Sync slice + palette
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-checkers-data";
  var PREFS_KEY   = "oros-checkers-prefs";
  var SESSION_KEY = "oros-checkers-session";
  var DEVICE_KEY  = "oros-checkers-device";
  var SFX_KEY     = "oros-checkers-sfx";
  var DATA_VER    = 1;

  var N = 64;
  var LEVELS = ["e", "m", "h"];
  var MODES = ["ai", "duo"];
  var COLORS = ["b", "w"];
  var QUIET_LIMIT = 80;                      // 40 moves each without capture / crowning
  var HARD_DEPTH = 30, HARD_BUDGET = 700;    // ms
  var AI_MIN_DELAY = 400;                    // ms, so the reply is visible
  var WIN = 100000;
  // Diagonal steps [dr, dc] by piece: black men go up, white men down.
  var UP = [[-1, -1], [-1, 1]], DOWN = [[1, -1], [1, 1]], ALL = UP.concat(DOWN);
  var DIRS_V = [[], UP, DOWN, ALL, ALL];
  var PIECE = [0, 100, 100, 170, 170];

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
      "turn.you": "Your turn", "turn.youcap": "Your turn: capture",
      "turn.ai": "Computer is thinking…",
      "turn.player": "{player} to move", "turn.playercap": "{player} must capture",
      "turn.jump": "Keep jumping",
      "turn.win": "{who} won", "turn.youwin": "You won", "turn.draw": "Draw",
      "btn.new": "New game (N)", "btn.undo": "Undo move (Z)",
      "btn.undoNone": "Nothing to undo",
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "board.label": "Checkers board",
      "sq.empty": "{sq}, empty",
      "sq.man1": "{sq}, black man", "sq.man2": "{sq}, white man",
      "sq.king1": "{sq}, black king", "sq.king2": "{sq}, white king",
      "sq.sel": "selected", "sq.target": "move here", "sq.must": "must capture",
      "live.move": "{who}: {path}",
      "live.caps": "{n} captured",
      "live.king": "crowned",
      "res.title": "Game over",
      "res.youwin": "You win!",
      "res.ailose": "The computer wins",
      "res.pwin": "{player} wins!",
      "res.draw": "It's a draw!",
      "res.again": "Play again",
      "res.close": "Close",
      "res.series": "Series",
      "res.moves": "Moves",
      "res.why": "Ending",
      "why.nomove": "No legal move left",
      "why.forty": "40 moves each without a capture",
      "why.rep": "Same position three times",
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
      "toast.must": "A capture is possible: you must take it",
      "toast.stuck": "This piece cannot move",
      "toast.notyours": "Pick one of your own pieces",
      "toast.illegal": "Not a legal move for this piece",
      "toast.jump": "The capture must go on: jump again",
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
      "turn.you": "Σειρά σου", "turn.youcap": "Σειρά σου: πρέπει να φας",
      "turn.ai": "Ο υπολογιστής σκέφτεται…",
      "turn.player": "Παίζουν τα {pl}", "turn.playercap": "Τα {pl} πρέπει να φάνε",
      "turn.jump": "Συνέχισε να πηδάς",
      "turn.win": "Κέρδισε: {who}", "turn.youwin": "Κέρδισες", "turn.draw": "Ισοπαλία",
      "btn.new": "Νέο παιχνίδι (N)", "btn.undo": "Αναίρεση κίνησης (Z)",
      "btn.undoNone": "Δεν υπάρχει κίνηση για αναίρεση",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "board.label": "Ταμπλό ντάμας",
      "sq.empty": "{sq}, κενό",
      "sq.man1": "{sq}, μαύρο πιόνι", "sq.man2": "{sq}, λευκό πιόνι",
      "sq.king1": "{sq}, μαύρη ντάμα", "sq.king2": "{sq}, λευκή ντάμα",
      "sq.sel": "επιλεγμένο", "sq.target": "κίνηση εδώ", "sq.must": "πρέπει να φάει",
      "live.move": "{who}: {path}",
      "live.caps": "φαγώθηκαν {n}",
      "live.king": "έγινε ντάμα",
      "res.title": "Τέλος",
      "res.youwin": "Κέρδισες!",
      "res.ailose": "Κέρδισε ο υπολογιστής",
      "res.pwin": "Κέρδισαν τα {pl}!",
      "res.draw": "Ισοπαλία!",
      "res.again": "Ξανά",
      "res.close": "Κλείσιμο",
      "res.series": "Σειρά αγώνων",
      "res.moves": "Κινήσεις",
      "res.why": "Λήξη",
      "why.nomove": "Δεν έμεινε καμία κίνηση",
      "why.forty": "40 κινήσεις ο καθένας χωρίς φάγωμα",
      "why.rep": "Η ίδια θέση τρεις φορές",
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
      "toast.must": "Υπάρχει φάγωμα: είναι υποχρεωτικό",
      "toast.stuck": "Αυτό το πιόνι δεν μπορεί να κινηθεί",
      "toast.notyours": "Διάλεξε ένα δικό σου πιόνι",
      "toast.illegal": "Αυτή η κίνηση δεν επιτρέπεται",
      "toast.jump": "Το φάγωμα συνεχίζεται: πήδα ξανά",
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
    console.log("checkers.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Board model ----------
  // cells[r * 8 + c], r = 0 is the top row as Black sees the board.
  // 0 empty · 1 black man · 2 white man · 3 black king · 4 white king.
  // Black (player 1) starts on rows 5–7 and moves up; White on rows 0–2.
  // A move is { path: [from, landing…], caps: [jumped squares] }.
  function owner(v) { return v ? 2 - (v & 1) : 0; }

  function startCells() {
    var cells = [];
    for (var i = 0; i < N; i++) {
      var r = i >> 3, c = i & 7, v = 0;
      if ((r + c) & 1) { if (r < 3) v = 2; else if (r > 4) v = 1; }
      cells.push(v);
    }
    return cells;
  }

  // Every capture sequence from `at`, jumping on while possible. The
  // jumped pieces stay on the board until the move ends (they block a
  // landing and cannot be jumped twice); a man that reaches the far
  // row is crowned and the move ends there.
  function jumps(cells, at, v, path, caps, out) {
    var p = owner(v), ds = DIRS_V[v], r = at >> 3, c = at & 7, found = false;
    for (var k = 0; k < ds.length; k++) {
      var lr = r + 2 * ds[k][0], lc = c + 2 * ds[k][1];
      if (lr < 0 || lr > 7 || lc < 0 || lc > 7) continue;
      var m = (r + ds[k][0]) * 8 + c + ds[k][1], l = lr * 8 + lc;
      if (!cells[m] || owner(cells[m]) === p || cells[l] || caps.indexOf(m) >= 0) continue;
      found = true;
      var np = path.concat([l]), nc = caps.concat([m]);
      if (v < 3 && lr === (p === 1 ? 0 : 7)) out.push({ path: np, caps: nc });
      else jumps(cells, l, v, np, nc, out);
    }
    if (!found && caps.length) out.push({ path: path, caps: caps });
  }

  // Legal moves of player p: the captures when there are any, otherwise
  // the plain steps.
  function genMoves(cells, p) {
    var out = [], i, v;
    for (i = 0; i < N; i++) {
      v = cells[i];
      if (owner(v) !== p) continue;
      cells[i] = 0;                        // the jumping piece leaves its square
      jumps(cells, i, v, [i], [], out);
      cells[i] = v;
    }
    if (out.length) return out;
    for (i = 0; i < N; i++) {
      v = cells[i];
      if (owner(v) !== p) continue;
      var ds = DIRS_V[v], r = i >> 3, c = i & 7;
      for (var k = 0; k < ds.length; k++) {
        var tr = r + ds[k][0], tc = c + ds[k][1];
        if (tr < 0 || tr > 7 || tc < 0 || tc > 7 || cells[tr * 8 + tc]) continue;
        out.push({ path: [i, tr * 8 + tc], caps: [] });
      }
    }
    return out;
  }

  function doMove(cells, m) {
    var from = m.path[0], to = m.path[m.path.length - 1], v = cells[from];
    var rec = { v: v, cv: [], promo: false };
    cells[from] = 0;
    for (var k = 0; k < m.caps.length; k++) { rec.cv.push(cells[m.caps[k]]); cells[m.caps[k]] = 0; }
    if (v < 3 && (to >> 3) === (v === 1 ? 0 : 7)) { cells[to] = v + 2; rec.promo = true; }
    else cells[to] = v;
    return rec;
  }

  function undoMove(cells, m, rec) {
    cells[m.path[m.path.length - 1]] = 0;
    for (var k = 0; k < m.caps.length; k++) cells[m.caps[k]] = rec.cv[k];
    cells[m.path[0]] = rec.v;
  }

  function samePath(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function findMove(legal, path) {
    for (var i = 0; i < legal.length; i++) if (samePath(legal[i].path, path)) return legal[i];
    return null;
  }

  // Replay a list of paths from the start (or from `from`, a test
  // position {cells, next, quiet}). null if a move is illegal.
  // over / winner / why: "nomove" (the side to move has none and
  // loses), "forty" (80 plies with no capture or crowning), "rep" (the
  // same position with the same side to move for the third time).
  function replay(moves, from) {
    var cells = from ? from.cells.slice() : startCells(), p = from ? from.next : 1;
    var quiet = from ? from.quiet : 0, seen = {}, last = null;
    var key = cells.join("") + p;
    seen[key] = 1;
    for (var i = 0; i < moves.length; i++) {
      var m = findMove(genMoves(cells, p), moves[i]);
      if (!m) return null;
      var rec = doMove(cells, m);
      quiet = (m.caps.length || rec.promo) ? 0 : quiet + 1;
      last = { path: m.path.slice(), caps: m.caps.slice(), cv: rec.cv, promo: rec.promo, v: rec.v };
      p = 3 - p;
      key = cells.join("") + p;
      seen[key] = (seen[key] || 0) + 1;
    }
    var st = { cells: cells, next: p, legal: genMoves(cells, p), quiet: quiet, last: last,
               over: false, winner: 0, why: "" };
    if (!st.legal.length) { st.over = true; st.winner = 3 - p; st.why = "nomove"; }
    else if (quiet >= QUIET_LIMIT) { st.over = true; st.why = "forty"; }
    else if (seen[key] >= 3) { st.over = true; st.why = "rep"; }
    return st;
  }

  // ---------- 3. Computer player ----------
  // Static evaluation for player p: material (king = 1.7 men), men
  // advance, a guarded back row, central kings, and a nudge to trade
  // down when ahead.
  function evaluate(cells, p) {
    var s = 0, mine = 0, theirs = 0;
    for (var i = 0; i < N; i++) {
      var v = cells[i];
      if (!v) continue;
      var r = i >> 3, c = i & 7, own = owner(v), x = PIECE[v];
      if (v < 3) {
        var adv = own === 1 ? 7 - r : r;   // 0 on its own back row … 6 next to crowning
        x += adv * 3;
        if (adv === 0) x += 8;
      } else if (r > 1 && r < 6 && c > 1 && c < 6) {
        x += 8;
      }
      if (own === p) { s += x; mine += PIECE[v]; } else { s -= x; theirs += PIECE[v]; }
    }
    if (mine + theirs) s += Math.round((mine - theirs) * 200 / (mine + theirs));
    return s;
  }

  function Abort() {}

  // Negamax with alpha-beta; a position with a capture to make is
  // searched on past the depth limit (captures are forced).
  function negamax(cells, p, depth, alpha, beta, ctx, ply) {
    if ((++ctx.nodes & 1023) === 0 && ctx.deadline && now() > ctx.deadline) throw new Abort();
    var moves = genMoves(cells, p);
    if (!moves.length) return -WIN + ply;
    if (depth <= 0 && (!moves[0].caps.length || ply > 40)) return evaluate(cells, p);
    if (moves.length > 1 && moves[0].caps.length) {
      moves.sort(function (a, b) { return b.caps.length - a.caps.length; });
    }
    var best = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var rec = doMove(cells, moves[i]), s;
      try { s = -negamax(cells, 3 - p, depth - 1, -beta, -alpha, ctx, ply + 1); }
      finally { undoMove(cells, moves[i], rec); }
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (alpha >= beta) break;
    }
    return best;
  }

  // Root search: every legal move (index in `moves`) with its score.
  function rootScores(cells, p, moves, order, depth, ctx) {
    var scores = [];
    for (var j = 0; j < order.length; j++) {
      var m = moves[order[j]], rec = doMove(cells, m), s;
      try { s = -negamax(cells, 3 - p, depth - 1, -Infinity, Infinity, ctx, 1); }
      finally { undoMove(cells, m, rec); }
      scores.push({ i: order[j], s: s });
    }
    return scores;
  }

  function pickBest(scores) {
    var top = -Infinity, ties = [];
    scores.forEach(function (x) {
      if (x.s > top) { top = x.s; ties = [x.i]; }
      else if (x.s === top) ties.push(x.i);
    });
    return ties[randInt(ties.length)];           // variety among equals
  }

  // Returns the chosen move (one of genMoves(cells, p)) or null.
  function chooseMove(cells, p, level) {
    var work = cells.slice(), moves = genMoves(work, p), order = [], i;
    if (!moves.length) return null;
    if (moves.length === 1) return moves[0];
    for (i = 0; i < moves.length; i++) order.push(i);
    if (level === "e") {
      var sc = rootScores(work, p, moves, order, 2, { nodes: 0, deadline: 0 });
      sc.forEach(function (x) { x.s += randInt(121) - 60; });
      return moves[pickBest(sc)];
    }
    if (level === "m") return moves[pickBest(rootScores(work, p, moves, order, 4, { nodes: 0, deadline: 0 }))];
    var ctx = { nodes: 0, deadline: now() + HARD_BUDGET }, best = null;
    for (var d = 2; d <= HARD_DEPTH; d++) {          // iterative deepening
      try { best = rootScores(work, p, moves, order, d, ctx); }
      catch (e) { if (e instanceof Abort) break; throw e; }
      // search the best moves first next time (better cut-offs)
      order = best.slice().sort(function (a, b) { return b.s - a.s; }).map(function (x) { return x.i; });
      if (best.some(function (x) { return x.s > WIN - 100; })) break;   // a forced win found
    }
    return moves[pickBest(best || rootScores(work, p, moves, order, 2, { nodes: 0, deadline: 0 }))];
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

  function mergeCheckers(A, B) {
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
          data = mergeCheckers(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.warn("[orOS] checkers: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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
    data = mergeCheckers(data, data);
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
  //   moves: [[from, landing…]…],
  //   done: bool,
  //   series: [black, white] // 2-player running score (this device)
  // }
  // The board itself is always replayed from moves.
  var game = null, board = null;

  function validSession(g) {
    if (!g || typeof g !== "object" || MODES.indexOf(g.mode) < 0 ||
        LEVELS.indexOf(g.lv) < 0 || [0, 1, 2].indexOf(g.ai) < 0 ||
        (g.mode === "ai") !== (g.ai !== 0) ||
        !Array.isArray(g.moves) || g.moves.length > 2000 ||
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
  var part = [];        // the human's move so far: [from, landing…]
  var anim = null;      // the last move, to animate once

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

  function syncBoard() { board = replay(game.moves); part = []; }

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
        if (aiTurn() && m) place(m.path);
      }, wait);
    }, 30);
  }

  // The legal moves that start with the human's partial path.
  function matching() {
    return board.legal.filter(function (m) {
      for (var k = 0; k < part.length; k++) if (m.path[k] !== part[k]) return false;
      return true;
    });
  }
  function nextSquares() {
    var out = {};
    if (!part.length) return out;
    matching().forEach(function (m) { if (m.path.length > part.length) out[m.path[part.length]] = true; });
    return out;
  }
  function mustCapture() { return board.legal.length > 0 && board.legal[0].caps.length > 0; }
  function movable() {
    var out = {};
    board.legal.forEach(function (m) { out[m.path[0]] = true; });
    return out;
  }

  // A human tap / Enter on square i.
  function tapSquare(i) {
    if (!game) return;
    if (game.done) { showToast(t("toast.over")); return; }          // R28
    if (aiTurn()) { showToast(t("toast.wait")); return; }
    var mine = owner(board.cells[i]) === board.next;
    if (part.length) {
      var nx = nextSquares();
      if (nx[i]) {
        part.push(i);
        var ms = matching();
        if (ms.length === 1) { place(ms[0].path); return; }
        sfx("step");
        renderPieces();
        renderStatus();
        return;
      }
      if (part.length > 1) { shake(i); showToast(t("toast.jump")); return; }
      if (i === part[0]) { part = []; renderPieces(); return; }    // tap again: deselect
      if (!mine) { shake(i); showToast(t("toast.illegal")); return; }
    }
    if (!mine) { shake(i); showToast(t("toast.notyours")); return; }
    if (!movable()[i]) {
      shake(i);
      showToast(t(mustCapture() ? "toast.must" : "toast.stuck"));
      if (mustCapture()) flashMust();
      return;
    }
    part = [i];
    renderPieces();
  }

  function place(path) {
    var p = board.next;
    game.moves.push(path.slice());
    syncBoard();
    anim = board.last;
    sfx(anim.caps.length ? "cap" : "move");
    if (anim.promo) setTimeout(function () { sfx("king"); }, 140);
    var msg = t("live.move", { who: sideName(p), path: path.map(sqName).join(anim.caps.length ? "×" : "–") });
    if (anim.caps.length) msg += ", " + t("live.caps", { n: anim.caps.length });
    if (anim.promo) msg += ", " + t("live.king");
    live(msg);
    if (board.over) { finish(); return; }
    saveSession();
    renderAll(false);
    maybeAi();
  }

  // Undo: one move with 2 players; vs the computer, back to your turn.
  function canUndo() {
    if (!game || game.done || !game.moves.length) return false;
    if (game.mode === "duo") return true;
    // you have moved at least once (black moves on even plies)
    var humanFirst = game.ai === 2;
    return humanFirst || game.moves.length >= 2;
  }
  function undo() {
    if (part.length && !game.done) { part = []; renderPieces(); renderStatus(); return; }
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
    anim = null;
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
    }, 250);
    setTimeout(function () { resultDialog(); }, 1000);
  }

  // ---------- 7. Render ----------
  function sideName(p) {
    if (game && game.mode === "ai") return t(p === game.ai ? "side.ai" : "side.you");
    return t("player." + p);
  }

  // Square name as Black sees the board: files a–h, ranks 1–8 bottom up.
  function sqName(i) { return "abcdefgh".charAt(i & 7) + (8 - (i >> 3)); }

  function flipped() { return !!(game && game.mode === "ai" && game.ai === 1); }

  function renderAll(rebuild) {
    renderToolbar();
    renderStatus();
    if (rebuild) buildBoard(); else renderPieces();
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
    // Left: black (player 1), right: white.
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
    } else if (part.length > 1) {
      txt = t("turn.jump");
    } else if (ai) {
      txt = next === game.ai ? t("turn.ai") : t(mustCapture() ? "turn.youcap" : "turn.you");
    } else {
      txt = t(mustCapture() ? "turn.playercap" : "turn.player", { player: t("player." + next), pl: t("pl." + next) });
    }
    $("turn").textContent = txt;
    $("side0").classList.toggle("turn", !game.done && next === 1);
    $("side1").classList.toggle("turn", !game.done && next === 2);
  }

  var focusSq = -1;     // board index of the roving-tabindex square

  function buildBoard() {
    var el = $("board");
    el.innerHTML = "";
    el.setAttribute("role", "grid");
    el.setAttribute("aria-label", t("board.label"));
    var flip = flipped();
    if (focusSq < 0 || !(((focusSq >> 3) + (focusSq & 7)) & 1)) focusSq = flip ? 21 : 42;
    for (var row = 0; row < 8; row++) {
      var tr = document.createElement("div");
      tr.setAttribute("role", "row");
      tr.className = "brow";
      for (var col = 0; col < 8; col++) {
        var i = flip ? 63 - (row * 8 + col) : row * 8 + col;
        var dark = ((i >> 3) + (i & 7)) & 1;
        var sq;
        if (dark) {
          sq = document.createElement("button");
          sq.type = "button";
          sq.className = "sq dark";
          sq.setAttribute("role", "gridcell");
          sq.setAttribute("data-i", String(i));
          sq.tabIndex = i === focusSq ? 0 : -1;
        } else {
          sq = document.createElement("span");
          sq.className = "sq light";
          sq.setAttribute("role", "gridcell");
          sq.setAttribute("aria-hidden", "true");
        }
        tr.appendChild(sq);
      }
      el.appendChild(tr);
    }
    renderPieces();
  }

  var CROWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 3.5L12 5l4.5 6.5L21 8l-2 10H5z" fill="currentColor"/></svg>';

  function pieceClass(v) { return "pc p" + owner(v) + (v > 2 ? " king" : ""); }

  // Pieces are updated in place; the last move slides once.
  function renderPieces() {
    var el = $("board");
    var human = !game.done && !aiTurn();
    var must = {}, mov = {}, tg = nextSquares(), cur = part.length ? part[part.length - 1] : -1;
    if (human) {
      mov = movable();
      if (mustCapture()) must = mov;
    }
    el.classList.toggle("over", !!game.done);
    var lastSet = {};
    if (board.last) board.last.path.forEach(function (i) { lastSet[i] = true; });
    var sqs = el.querySelectorAll(".sq.dark");
    var a = anim;
    anim = null;
    for (var k = 0; k < sqs.length; k++) {
      var sq = sqs[k], i = +sq.getAttribute("data-i"), v = board.cells[i];
      if (part.length > 1 && i === part[0]) v = 0;                // the jumping piece is on its way
      if (part.length > 1 && i === cur) v = board.cells[part[0]];
      sq.classList.toggle("last", !!lastSet[i] && !part.length);
      sq.classList.toggle("sel", i === cur);
      sq.classList.toggle("tgt", !!tg[i]);
      sq.classList.toggle("jumped", part.length > 1 && isJumped(i));
      var pc = sq.querySelector(".pc:not(.gone)");
      var ghost = sq.querySelector(".pc.gone");
      if (ghost) sq.removeChild(ghost);
      if (!v) { if (pc) sq.removeChild(pc); }
      else {
        if (!pc) { pc = document.createElement("i"); sq.appendChild(pc); }
        var cls = pieceClass(v) + (must[i] && !part.length ? " must" : "");
        if (pc.className !== cls) pc.className = cls;
        var crown = v > 2;
        if (crown && !pc.firstChild) pc.innerHTML = CROWN;
        else if (!crown && pc.firstChild) pc.innerHTML = "";
      }
      var label = t((v > 2 ? "sq.king" : "sq.man") + owner(v), { sq: sqName(i) });
      if (!v) label = t("sq.empty", { sq: sqName(i) });
      if (i === cur) label += ", " + t("sq.sel");
      if (tg[i]) label += ", " + t("sq.target");
      if (must[i] && !part.length) label += ", " + t("sq.must");
      sq.setAttribute("aria-label", label);
      if (!human) sq.setAttribute("aria-disabled", "true");
      else sq.removeAttribute("aria-disabled");
    }
    if (a) animateMove(a);
  }

  function isJumped(i) {
    var ms = matching();
    for (var k = 0; k < ms.length; k++) {
      var caps = ms[k].caps;
      for (var j = 0; j < part.length - 1 && j < caps.length; j++) if (caps[j] === i) return true;
    }
    return false;
  }

  function squareEl(i) { return $("board").querySelector('.sq[data-i="' + i + '"]'); }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  // The moved piece slides from where it started; captured pieces fade.
  function animateMove(a) {
    a.caps.forEach(function (i, k) {
      var sq = squareEl(i);
      if (!sq) return;
      var g = document.createElement("i");
      g.className = pieceClass(a.cv[k]) + " gone";
      sq.appendChild(g);
    });
    if (reducedMotion()) return;
    var from = squareEl(a.path[0]), to = squareEl(a.path[a.path.length - 1]);
    var pc = to && to.querySelector(".pc:not(.gone)");
    if (!from || !pc || from === to) return;
    var fr = from.getBoundingClientRect(), tr = to.getBoundingClientRect();
    pc.style.transition = "none";
    pc.style.transform = "translate(" + (fr.left - tr.left) + "px," + (fr.top - tr.top) + "px)";
    pc.style.zIndex = "2";
    void pc.offsetWidth;
    pc.style.transition = "transform " + (0.16 + 0.08 * (a.path.length - 1)) + "s ease-out";
    pc.style.transform = "";
    setTimeout(function () { pc.style.zIndex = ""; pc.style.transition = ""; }, 500);
  }

  function shake(i) {
    var sq = squareEl(i);
    if (!sq || reducedMotion()) return;
    sq.classList.remove("shake");
    void sq.offsetWidth;
    sq.classList.add("shake");
  }

  function flashMust() {
    var el = $("board");
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
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
    var dlg = makeDialog("ck-result");
    var ai = game.mode === "ai";
    dlg.appendChild(el("div", "dlg-title",
      t("res.title") + (ai ? " · " + t("level." + game.lv) : "")));
    var hero = !winner ? t("res.draw")
      : ai ? t(winner === game.ai ? "res.ailose" : "res.youwin")
      : t("res.pwin", { player: t("player." + winner), pl: t("pl." + winner) });
    dlg.appendChild(el("div", "dlg-hero", hero));
    dlg.appendChild(row(t("res.why"), t("why." + board.why)));
    dlg.appendChild(row(t("res.moves"), String(Math.ceil(game.moves.length / 2))));
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
    var dlg = makeDialog("ck-stats");
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
    var dlg = makeDialog("ck-confirm");
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
    data = mergeCheckers(data, data);
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
          n.transient({ ns: "checkers", title: String(text) })) return;
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
      if (kind === "move") tone(300, 0, 0.08, "triangle", 0.16);
      else if (kind === "step") tone(360, 0, 0.06, "triangle", 0.12);
      else if (kind === "cap") { tone(260, 0, 0.07, "square", 0.08); tone(200, 0.07, 0.1, "square", 0.08); }
      else if (kind === "king") { tone(660, 0, 0.12, "triangle"); tone(880, 0.1, 0.18, "triangle"); }
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
  // Arrows walk the dark squares on screen: left / right two files,
  // up / down one rank (zig-zag), so every dark square is reachable.
  function moveFocus(key) {
    var flip = flipped(), r = focusSq >> 3, c = focusSq & 7;
    var sr = flip ? 7 - r : r, sc = flip ? 7 - c : c;     // screen row / column
    if (key === "ArrowLeft") sc -= 2;
    else if (key === "ArrowRight") sc += 2;
    else if (key === "ArrowUp") { sr -= 1; sc += (sc + 1 <= 7) ? 1 : -1; }
    else if (key === "ArrowDown") { sr += 1; sc += (sc - 1 >= 0) ? -1 : 1; }
    if (sr < 0 || sr > 7 || sc < 0 || sc > 7) return;
    focusSquare(flip ? (7 - sr) * 8 + 7 - sc : sr * 8 + sc);
  }
  function focusSquare(i) {
    var prev = squareEl(focusSq), next = squareEl(i);
    if (!next) return;
    if (prev) prev.tabIndex = -1;
    focusSq = i;
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
      if (e.key === "Escape" && part.length) {
        e.preventDefault();
        if (part.length > 1) { showToast(t("toast.jump")); return; }
        part = []; renderPieces(); renderStatus(); return;
      }
      var onSq = document.activeElement && document.activeElement.classList &&
                 document.activeElement.classList.contains("sq");
      if (/^Arrow/.test(e.key)) {
        e.preventDefault();
        if (!onSq) { focusSquare(focusSq); return; }
        moveFocus(e.key);
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
    api.registerSlice("checkers", sliceGet, sliceSet, STORAGE_KEY, mergeCheckers);
  }

  function sliceGet() {
    return mergeCheckers(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeCheckers(incoming, incoming);
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
      sfx("move");   // audible confirmation when turned on
    });
    $("board").addEventListener("focusin", function (e) {
      var s = e.target.closest && e.target.closest(".sq.dark");
      if (!s || s.tabIndex === 0) return;
      var prev = squareEl(focusSq);
      if (prev) prev.tabIndex = -1;
      focusSq = +s.getAttribute("data-i");
      s.tabIndex = 0;
    });
    $("board").addEventListener("click", function (e) {
      var s = e.target.closest && e.target.closest(".sq.dark");
      if (s) tapSquare(+s.getAttribute("data-i"));
    });
    $("board").addEventListener("animationend", function (e) {
      if (e.target.classList) e.target.classList.remove("shake", "flash");
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
