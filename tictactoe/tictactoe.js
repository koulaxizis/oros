// ============================================================
// orOS Tic-Tac-Toe — App logic (v1.0.0)
// Three in a row on a 3×3 board; whoever moves first plays X.
//   - vs Computer, 3 levels: Easy (takes a win, otherwise random) ·
//     Medium (takes a win, blocks a threat, otherwise random) · Hard
//     (full minimax: never loses; random among equal best moves)
//   - who starts vs the computer: you / computer / take turns
//   - 2 players on one device, with a running series score
//   - undo (vs the computer it also takes back its answer)
// Data:
//   - synced slice "tictactoe" (oros-tictactoe-data): results vs the
//     computer per level as per-device counters (each device only
//     grows its own row; merge = per-row max, symmetric + associative)
//     + a reset stamp br
//   - device-local (R10): oros-tictactoe-prefs (mode, level, first,
//     next starter), oros-tictactoe-session (the game in progress and
//     the 2-player series), oros-tictactoe-device (counter row id),
//     oros-tictactoe-sfx (sound on/off)
// Sections:
//   1. Constants, i18n, helpers
//   2. Board model (cells, lines, win test)
//   3. Computer player (easy / medium / minimax)
//   4. Synced data: load / save / normalize / merge (R5, R26)
//   5. Device-local prefs + session
//   6. Game flow (new, play, computer turn, undo, finish)
//   7. Render (toolbar, status, board layout, marks, strike line)
//   8. Dialogs (result, records, confirm)
//   9. Toasts
//  10. Sound
//  11. Keyboard (arrows, 1–9 numpad layout, N, Z, Contract Β)
//  12. Sync slice + palette
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-tictactoe-data";
  var PREFS_KEY   = "oros-tictactoe-prefs";
  var SESSION_KEY = "oros-tictactoe-session";
  var DEVICE_KEY  = "oros-tictactoe-device";
  var SFX_KEY     = "oros-tictactoe-sfx";
  var DATA_VER    = 1;

  var N = 9;
  var LEVELS = ["e", "m", "h"];
  var MODES = ["ai", "duo"];
  var FIRSTS = ["you", "ai", "alt"];
  var AI_MIN_DELAY = 380;                    // ms, so the reply is visible

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
      "level.e": "Easy", "level.m": "Medium", "level.h": "Hard", "level.hTip": "Never loses",
      "first.you": "You start", "first.ai": "Computer starts", "first.alt": "Take turns",
      "first.label": "First move",
      "side.you": "You", "side.ai": "Computer",
      "player.1": "Player 1", "player.2": "Player 2",
      "turn.you": "Your turn", "turn.ai": "Computer is thinking…",
      "turn.player": "{player}'s turn",
      "turn.win": "{who} won", "turn.youwin": "You won", "turn.draw": "Draw",
      "btn.new": "New game (N)", "btn.undo": "Undo move (Z)",
      "btn.undoNone": "Nothing to undo",
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "board.label": "Board, 3 by 3",
      "cell.label": "Row {r}, column {c}, empty",
      "cell.taken": "Row {r}, column {c}, {mark}",
      "live.move": "{who}: {mark} at row {r}, column {c}",
      "res.title": "Game over",
      "res.youwin": "You win!",
      "res.ailose": "The computer wins",
      "res.pwin": "{player} wins!",
      "res.draw": "It's a draw!",
      "res.again": "Play again",
      "res.close": "Close",
      "res.series": "Series",
      "res.moves": "Moves",
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
      "toast.full": "That square is taken",
      "toast.wait": "The computer is playing",
      "toast.over": "The game is over: start a new one (N)"
    },
    el: {
      "mode.ai": "Με υπολογιστή", "mode.duo": "2 παίκτες",
      "level.e": "Εύκολο", "level.m": "Μεσαίο", "level.h": "Δύσκολο", "level.hTip": "Δεν χάνει ποτέ",
      "first.you": "Ξεκινάς εσύ", "first.ai": "Ξεκινά ο υπολογιστής", "first.alt": "Εναλλάξ",
      "first.label": "Πρώτη κίνηση",
      "side.you": "Εσύ", "side.ai": "Υπολογιστής",
      "player.1": "Παίκτης 1", "player.2": "Παίκτης 2",
      "turn.you": "Σειρά σου", "turn.ai": "Ο υπολογιστής σκέφτεται…",
      "turn.player": "Σειρά: {player}",
      "turn.win": "Κέρδισε: {who}", "turn.youwin": "Κέρδισες", "turn.draw": "Ισοπαλία",
      "btn.new": "Νέο παιχνίδι (N)", "btn.undo": "Αναίρεση κίνησης (Z)",
      "btn.undoNone": "Δεν υπάρχει κίνηση για αναίρεση",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "board.label": "Ταμπλό, 3 επί 3",
      "cell.label": "Γραμμή {r}, στήλη {c}, κενό",
      "cell.taken": "Γραμμή {r}, στήλη {c}, {mark}",
      "live.move": "{who}: {mark} στη γραμμή {r}, στήλη {c}",
      "res.title": "Τέλος",
      "res.youwin": "Κέρδισες!",
      "res.ailose": "Κέρδισε ο υπολογιστής",
      "res.pwin": "Νικητής: {player}!",
      "res.draw": "Ισοπαλία!",
      "res.again": "Ξανά",
      "res.close": "Κλείσιμο",
      "res.series": "Σειρά αγώνων",
      "res.moves": "Κινήσεις",
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
      "toast.full": "Το τετράγωνο είναι πιασμένο",
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

  // crypto RNG with rejection sampling (same as Dice / Memory / Connect 4)
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
    console.log("tictactoe.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Board model ----------
  // cells[r * 3 + c], r = 0 is the TOP row; 0 empty, 1 / 2 player.
  var LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8],
               [0, 4, 8], [2, 4, 6]];

  // The line player p completes through cell i, if any.
  function lineAt(cells, i, p) {
    for (var k = 0; k < LINES.length; k++) {
      var L = LINES[k];
      if (L.indexOf(i) >= 0 && cells[L[0]] === p && cells[L[1]] === p && cells[L[2]] === p) return L;
    }
    return null;
  }

  // Replay a move list (cells) from an empty board.
  function replay(moves, starter) {
    var cells = [0, 0, 0, 0, 0, 0, 0, 0, 0], p = starter, win = null;
    for (var i = 0; i < moves.length; i++) {
      cells[moves[i]] = p;
      if (i === moves.length - 1) win = lineAt(cells, moves[i], p);
      p = 3 - p;
    }
    return { cells: cells, next: p, win: win, full: moves.length === N };
  }

  // ---------- 3. Computer player ----------
  function freeCells(cells) {
    var out = [];
    for (var i = 0; i < N; i++) if (!cells[i]) out.push(i);
    return out;
  }
  // Cells where player p completes a line right now.
  function winningCells(cells, p) {
    return freeCells(cells).filter(function (i) {
      cells[i] = p;
      var w = lineAt(cells, i, p) !== null;
      cells[i] = 0;
      return w;
    });
  }

  // Minimax for player p to move: +(10 - ply) win, -(10 - ply) loss, 0 draw.
  function minimax(cells, p, ply) {
    var free = freeCells(cells);
    if (!free.length) return 0;
    var best = -Infinity;
    for (var k = 0; k < free.length; k++) {
      var i = free[k], s;
      cells[i] = p;
      if (lineAt(cells, i, p)) s = 10 - ply;
      else s = -minimax(cells, 3 - p, ply + 1);
      cells[i] = 0;
      if (s > best) best = s;
      if (best === 10 - ply) break;            // a win now can't be beaten
    }
    return best;
  }

  function chooseMove(cellsIn, p, level) {
    var cells = cellsIn.slice(), free = freeCells(cells);
    if (!free.length) return -1;
    var win = winningCells(cells, p);
    if (win.length) return win[randInt(win.length)];
    if (level === "e") return free[randInt(free.length)];
    if (level === "m") {
      var block = winningCells(cells, 3 - p);
      if (block.length) return block[randInt(block.length)];
      return free[randInt(free.length)];
    }
    var top = -Infinity, ties = [];
    free.forEach(function (i) {
      cells[i] = p;
      var s = -minimax(cells, 3 - p, 1);
      cells[i] = 0;
      if (s > top) { top = s; ties = [i]; }
      else if (s === top) ties.push(i);
    });
    return ties[randInt(ties.length)];           // variety among equals
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

  function mergeTicTacToe(A, B) {
    var a = A || {}, b = B || {};
    var br = Math.max(isInt(a.br) ? a.br : 0, isInt(b.br) ? b.br : 0);
    var rows = {};
    [a.rows || {}, b.rows || {}].forEach(function (m) {
      if (typeof m !== "object") return;
      Object.keys(m).forEach(function (id) {
        var r = normRow(m[id]);
        if (!r || r.b < br) return;
        rows[id] = rows[id] ? joinRows(rows[id], r) : r;
      });
    });
    var sorted = {};
    Object.keys(rows).sort(cmpStr).forEach(function (id) {
      var r = rows[id], s = {};
      LEVELS.forEach(function (lv) { if (r.s[lv]) s[lv] = r.s[lv]; });
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
          data = mergeTicTacToe(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] tictactoe: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // start a new epoch after a reset
    var v = row.s[lv] ? row.s[lv].slice() : [0, 0, 0];
    v[res]++;
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    row.s[lv] = v;
    data.rows[deviceId] = row;
    data = mergeTicTacToe(data, data);
    save();
  }

  // ---------- 5. Device-local prefs + session ----------
  var prefs = { mode: "ai", lv: "m", first: "you", nextAi: false };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (MODES.indexOf(p.mode) >= 0) prefs.mode = p.mode;
        if (LEVELS.indexOf(p.lv) >= 0) prefs.lv = p.lv;
        if (FIRSTS.indexOf(p.first) >= 0) prefs.first = p.first;
        prefs.nextAi = p.nextAi === true;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = {
  //   mode, lv,
  //   starter: 1 | 2,      // who moved first (plays X)
  //   ai: 0 | 2,           // the computer's player number (vs computer)
  //   moves: [cell…],
  //   done: bool,
  //   series: [p1, p2]     // 2-player running score (this device)
  // }
  // The board itself is always replayed from moves.
  var game = null, board = null;

  function validSession(g) {
    if (!g || typeof g !== "object" || MODES.indexOf(g.mode) < 0 ||
        LEVELS.indexOf(g.lv) < 0 || (g.starter !== 1 && g.starter !== 2) ||
        (g.ai !== 0 && g.ai !== 2) || !Array.isArray(g.moves) || g.moves.length > N ||
        !Array.isArray(g.series) || g.series.length !== 2 ||
        !isInt(g.series[0]) || !isInt(g.series[1])) return false;
    var seen = {};
    for (var i = 0; i < g.moves.length; i++) {
      var c = g.moves[i];
      if (!isInt(c) || c < 0 || c >= N || seen[c]) return false;
      seen[c] = true;
    }
    return true;
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
  var lastMark = -1;     // cell of the mark to animate

  function seriesOf() { return game ? game.series.slice() : [0, 0]; }

  function fresh(series) {
    var g = { mode: prefs.mode, lv: prefs.lv, starter: 1, ai: 0, moves: [], done: false,
              series: series || [0, 0] };
    if (g.mode === "ai") {
      g.ai = 2;
      var aiFirst = prefs.first === "ai" || (prefs.first === "alt" && prefs.nextAi);
      g.starter = aiFirst ? 2 : 1;
      if (prefs.first === "alt") { prefs.nextAi = !prefs.nextAi; savePrefs(); }
    } else if (game && game.mode === "duo") {
      g.starter = 3 - game.starter;                // 2 players: starts alternate
    }
    return g;
  }

  function inProgress() { return !!(game && !game.done && game.moves.length > 0); }

  // A game in progress is never lost silently: Undo toast (R14).
  function newGame(announce, keepSeries) {
    var prev = inProgress() ? JSON.parse(JSON.stringify(game)) : null;
    var prevPrefs = JSON.parse(JSON.stringify(prefs));
    cancelAi();
    var series = (keepSeries && game && game.mode === "duo" && prefs.mode === "duo") ? seriesOf() : [0, 0];
    game = fresh(series);
    saveSession();
    syncBoard();
    lastMark = -1;
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
        lastMark = -1;
        renderAll(true);
        maybeAi();
      });
    } else if (announce) {
      live(t("toast.newgame"));
    }
  }

  function syncBoard() { board = replay(game.moves, game.starter); }

  function aiTurn() { return game.mode === "ai" && !game.done && board.next === game.ai; }

  function cancelAi() { if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; } }

  function maybeAi() {
    if (!aiTurn() || aiTimer) return;
    renderStatus();
    var started = Date.now();
    aiTimer = setTimeout(function () {
      // let the "thinking" text paint, then search
      var c = chooseMove(board.cells, game.ai, game.lv);
      var wait = Math.max(0, AI_MIN_DELAY - (Date.now() - started));
      aiTimer = setTimeout(function () {
        aiTimer = null;
        if (aiTurn() && c >= 0) place(c);
      }, wait);
    }, 30);
  }

  // A human tap on cell c.
  function play(c) {
    if (!game) return;
    if (game.done) { showToast(t("toast.over")); return; }          // R28
    if (aiTurn()) { showToast(t("toast.wait")); return; }
    if (board.cells[c]) { showToast(t("toast.full")); return; }
    place(c);
  }

  function place(c) {
    var p = board.next;
    lastMark = c;
    game.moves.push(c);
    syncBoard();
    sfx("drop");
    live(t("live.move", { who: sideName(p), mark: markName(p), r: Math.floor(c / 3) + 1, c: c % 3 + 1 }));
    if (board.win || board.full) { finish(); return; }
    saveSession();
    renderAll(false);
    maybeAi();
  }

  // Undo: one move with 2 players; vs the computer, back to your turn.
  function canUndo() {
    if (!game || game.done || !game.moves.length) return false;
    if (game.mode === "duo") return true;
    // the computer's opening mark alone cannot be taken back
    return !(game.moves.length === 1 && game.starter === game.ai);
  }
  function undo() {
    if (!canUndo()) { showToast(t("btn.undoNone")); return; }       // R28
    cancelAi();
    game.moves.pop();
    syncBoard();
    if (game.mode === "ai") {
      while (game.moves.length && board.next === game.ai) {
        game.moves.pop();
        syncBoard();
      }
    }
    lastMark = -1;
    saveSession();
    renderAll(true);
    maybeAi();
  }

  function finish() {
    game.done = true;
    var winner = board.win ? 3 - board.next : 0;    // the player who just moved
    if (game.mode === "duo") {
      if (winner) game.series[winner - 1]++;
    } else {
      countResult(game.lv, winner === 0 ? 2 : (winner === game.ai ? 1 : 0));
    }
    saveSession();
    renderAll(false);
    sfx(winner && !(game.mode === "ai" && winner === game.ai) ? "win" : "end");
    setTimeout(function () { resultDialog(winner); }, 900);
  }

  // ---------- 7. Render ----------
  function sideName(p) {
    if (game && game.mode === "ai") return t(p === game.ai ? "side.ai" : "side.you");
    return t("player." + p);
  }

  // The first mover plays X.
  function markOf(p) { return p === game.starter ? "x" : "o"; }
  function markName(p) { return markOf(p).toUpperCase(); }

  function renderAll(rebuild) {
    renderToolbar();
    renderStatus();
    if (rebuild) buildBoard(); else renderMarks();
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
    $("first-select").hidden = mode !== "ai";
    $("first-select").value = prefs.first;
    var hb = document.querySelector('#level-seg [data-level="h"]');
    hb.title = t("level.hTip");
    var u = $("undo-btn"), ok = canUndo();
    u.disabled = !ok;
    u.title = t(ok ? "btn.undo" : "btn.undoNone");
    u.setAttribute("aria-label", u.title);
    paintSfxBtn();
  }

  function renderStatus() {
    if (!game) return;
    var ai = game.mode === "ai";
    // Left side is always player 1 (you, vs the computer).
    $("name0").textContent = ai ? t("side.you") : t("player.1");
    $("name1").textContent = ai ? t("side.ai") : t("player.2");
    var sc = ai ? totals(game.lv) : game.series;
    $("score0").textContent = String(sc[0]);
    $("score1").textContent = String(sc[1]);
    $("mark0").className = "mk c1 " + markOf(1);
    $("mark1").className = "mk c2 " + markOf(2);
    var next = board.next, txt;
    if (game.done) {
      var w = board.win ? 3 - next : 0;
      txt = !w ? t("turn.draw") : (ai && w !== game.ai) ? t("turn.youwin") : t("turn.win", { who: sideName(w) });
    } else if (ai) {
      txt = next === game.ai ? t("turn.ai") : t("turn.you");
    } else {
      txt = t("turn.player", { player: t("player." + next) });
    }
    $("turn").textContent = txt;
    $("side0").classList.toggle("turn", !game.done && next === 1);
    $("side1").classList.toggle("turn", !game.done && next === 2);
  }

  function layoutBoard() {
    var wrap = $("board-wrap"), el = $("board");
    var cs = getComputedStyle(wrap);
    var W = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var H = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (W <= 0 || H <= 0) return;
    var pad = W < 420 ? 8 : 12, gap = W < 420 ? 6 : 10;
    var cell = Math.floor(Math.min(W - 2 * pad - 2 * gap - 2, H - 2 * pad - 2 * gap - 2) / 3);
    cell = Math.max(64, Math.min(cell, 168));
    el.style.setProperty("--cell", cell + "px");
    el.style.setProperty("--pad", pad + "px");
    el.style.setProperty("--gap", gap + "px");
    placeStrike();
  }

  function buildBoard() {
    var el = $("board");
    el.innerHTML = "";
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", t("board.label"));
    for (var i = 0; i < N; i++) {
      var cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      cell.setAttribute("data-i", String(i));
      cell.tabIndex = (i === focusCell) ? 0 : -1;
      el.appendChild(cell);
    }
    var strike = document.createElement("span");
    strike.id = "strike";
    strike.setAttribute("aria-hidden", "true");
    el.appendChild(strike);
    layoutBoard();
    renderMarks();
  }

  // Marks are added / removed in place; only the new one animates.
  function renderMarks() {
    var el = $("board");
    var winSet = {};
    (board.win || []).forEach(function (i) { winSet[i] = true; });
    el.classList.toggle("over", !!game.done);
    el.classList.toggle("p1", board.next === 1);
    el.classList.toggle("p2", board.next === 2);
    el.classList.toggle("nx", markOf(board.next) === "x");
    var blocked = game.done || aiTurn();
    for (var i = 0; i < N; i++) {
      var cell = el.children[i], v = board.cells[i], mk = cell.firstChild;
      var r = Math.floor(i / 3) + 1, c = i % 3 + 1;
      // aria-disabled, not disabled: a disabled button drops keyboard
      // focus while the computer plays. play() explains a refused tap.
      if (blocked || v) cell.setAttribute("aria-disabled", "true");
      else cell.removeAttribute("aria-disabled");
      cell.setAttribute("aria-label", v ? t("cell.taken", { r: r, c: c, mark: markName(v) })
                                        : t("cell.label", { r: r, c: c }));
      if (!v) { if (mk) cell.removeChild(mk); continue; }
      if (!mk) mk = cell.appendChild(document.createElement("i"));
      var cls = "mk c" + v + " " + markOf(v) + (winSet[i] ? " win" : "") + (i === lastMark ? " new" : "");
      if (mk.className !== cls) mk.className = cls;
    }
    lastMark = -1;
    placeStrike();
  }

  // The strike line through the winning three, from the cells' centres.
  function placeStrike() {
    var el = $("board"), s = $("strike");
    if (!s || !board) return;
    if (!board.win) { s.className = ""; return; }
    var a = el.children[board.win[0]], b = el.children[board.win[2]];
    var x1 = a.offsetLeft + a.offsetWidth / 2, y1 = a.offsetTop + a.offsetHeight / 2;
    var x2 = b.offsetLeft + b.offsetWidth / 2, y2 = b.offsetTop + b.offsetHeight / 2;
    var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy) + a.offsetWidth * 0.7;
    s.style.left = ((x1 + x2) / 2) + "px";
    s.style.top = ((y1 + y2) / 2) + "px";
    s.style.width = len + "px";
    s.style.transform = "translate(-50%, -50%) rotate(" + Math.atan2(dy, dx) + "rad)";
    s.className = "on c" + (3 - board.next);
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

  function resultDialog(winner) {
    if (!game || !game.done) return;           // undone / replaced meanwhile
    var dlg = makeDialog("ttt-result");
    var ai = game.mode === "ai";
    dlg.appendChild(el("div", "dlg-title",
      t("res.title") + (ai ? " · " + t("level." + game.lv) : "")));
    var hero = !winner ? t("res.draw")
      : ai ? t(winner === game.ai ? "res.ailose" : "res.youwin")
      : t("res.pwin", { player: t("player." + winner) });
    dlg.appendChild(el("div", "dlg-hero", hero));
    dlg.appendChild(row(t("res.moves"), String(game.moves.length)));
    if (ai) {
      var s = totals(game.lv);
      dlg.appendChild(row(t("stats.head"), s.join(" · ")));
    } else {
      dlg.appendChild(row(t("res.series"), game.series[0] + " – " + game.series[1]));
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
    var dlg = makeDialog("ttt-stats");
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
      dlg.appendChild(row(t("res.series"), game.series[0] + " – " + game.series[1]));
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
    var dlg = makeDialog("ttt-confirm");
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
    data = mergeTicTacToe(data, data);
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
          n.transient({ ns: "tictactoe", title: String(text) })) return;
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
      if (kind === "drop") tone(520, 0, 0.08, "triangle", 0.14);
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
  var focusCell = 4;
  function focusCellAt(i) {
    var cells = $("board").children;
    if (!cells[i]) return;
    if (cells[focusCell]) cells[focusCell].tabIndex = -1;
    focusCell = i;
    cells[i].tabIndex = 0;
    cells[i].focus();
  }

  // Keys 1–9 follow the numpad: 7 8 9 is the top row.
  function numpadCell(d) { return (2 - Math.floor((d - 1) / 3)) * 3 + (d - 1) % 3; }

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
      var m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (m) { e.preventDefault(); play(numpadCell(+m[1])); return; }
      var a = document.activeElement;
      var dir = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
      if (dir && a && a.classList && a.classList.contains("cell")) {
        e.preventDefault();
        var cur = +a.getAttribute("data-i");
        var r = Math.floor(cur / 3) + dir[0], c = cur % 3 + dir[1];
        if (r >= 0 && r < 3 && c >= 0 && c < 3) focusCellAt(r * 3 + c);
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
    api.registerSlice("tictactoe", sliceGet, sliceSet, STORAGE_KEY, mergeTicTacToe);
  }

  function sliceGet() {
    return mergeTicTacToe(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeTicTacToe(incoming, incoming);
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
    $("first-select").setAttribute("aria-label", t("first.label"));
    $("first-select").title = t("first.label");
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
    $("first-select").addEventListener("change", function () {
      prefs.first = $("first-select").value;
      prefs.nextAi = prefs.first === "ai";
      savePrefs();
      newGame(true, true);
      $("first-select").blur();
    });
    $("new-btn").addEventListener("click", function () { newGame(true, true); $("new-btn").blur(); });
    $("undo-btn").addEventListener("click", function () { undo(); });
    $("stats-btn").addEventListener("click", statsDialog);
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("drop");   // audible confirmation when turned on
    });
    $("board").addEventListener("focusin", function (e) {
      var c = e.target.closest && e.target.closest(".cell");
      if (!c || c.tabIndex === 0) return;
      var prev = $("board").children[focusCell];
      if (prev) prev.tabIndex = -1;
      focusCell = +c.getAttribute("data-i");
      c.tabIndex = 0;
    });
    $("board").addEventListener("click", function (e) {
      var c = e.target.closest && e.target.closest(".cell");
      if (c) play(+c.getAttribute("data-i"));
    });

    var relayout = function () { layoutBoard(); };
    if (window.ResizeObserver) new ResizeObserver(relayout).observe($("board-wrap"));
    else window.addEventListener("resize", relayout);

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
    } else {
      game = fresh(null);
    }
    syncBoard();
    if (board.win || board.full) game.done = true;
    renderAll(true);
    maybeAi();   // a game left on the computer's turn continues
  }

  boot();
})();
