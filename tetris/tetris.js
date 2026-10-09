// ============================================================
// orOS Tetris — App logic (v1.0.0)
// Falling tetrominoes on a 10×20 field (+2 hidden rows on top).
//   - 7-bag randomizer, SRS rotation with wall kicks (own I table)
//   - hold (once per piece), next queue (3), ghost piece
//   - soft drop (1 point a row), hard drop (2 points a row)
//   - lock delay 0.5 s, reset by a move or turn up to 15 times
//   - lines 100 / 300 / 500 / 800 × level, back-to-back Tetris ×1.5
//   - the level rises every 10 lines (start at 1, 5 or 10)
//   - arrows, Up / X / Z rotate, C / Shift hold, Space hard drop
//     (by e.code); tap / drag / swipe on the field and a touch pad
//   - P / Esc pause; hidden or blurred → paused; resume after 3-2-1
//   - a game in progress is kept on the device and resumes paused
// The simulation runs in fixed 1/60 s ticks (pure functions below);
// requestAnimationFrame only feeds it time and draws.
// Data:
//   - synced slice "tetris" (oros-tetris-data): per start level the
//     best score (and when), the most lines and the games played, as
//     per-device rows (each device only grows its own row; merge =
//     per-row join) + a reset stamp br
//   - device-local (R10): oros-tetris-prefs (start level),
//     oros-tetris-session (the game in progress), oros-tetris-device
//     (row id), oros-tetris-sfx (sound on/off)
// Sections:
//   1. Constants, i18n, helpers
//   2. Game model (bag, SRS, moves, gravity, lock, lines, score)
//   3. Synced data: load / save / normalize / merge (R5, R26)
//   4. Device-local prefs + session
//   5. Game flow (new, start, pause, countdown, loop, finish)
//   6. Render (toolbar, status, overlay, canvases)
//   7. Dialogs (result, records, confirm)
//   8. Toasts
//   9. Sound
//  10. Input (keys, auto-shift, field gestures, pad, Contract Β)
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-tetris-data";
  var PREFS_KEY   = "oros-tetris-prefs";
  var SESSION_KEY = "oros-tetris-session";
  var DEVICE_KEY  = "oros-tetris-device";
  var SFX_KEY     = "oros-tetris-sfx";
  var DATA_VER    = 1;

  var COLS = 10, ROWS = 22, HIDE = 2;        // 2 hidden rows above the 20 shown
  var STARTS = [1, 5, 10];
  var KEYS = ["l1", "l5", "l10"];
  var FRAME_MS = 1000 / 60;                  // one simulation tick
  var LOCK_FRAMES = 30;                      // lock delay 0.5 s
  var MAX_RESETS = 15;                       // lock-delay resets per piece
  var DAS = 10, ARR = 2;                     // auto-shift: 167 ms, then every 33 ms
  var MAX_LEVEL = 30;
  var MAX_SCORE = 999999999;
  var MAX_LINES = 999999;
  var LINE_PTS = [0, 100, 300, 500, 800];
  // Pieces 0..6 = I O T S Z J L: spawn shape in its n×n box, [row, col], row 0 on top.
  var SPAWN = [
    { n: 4, cells: [[1, 0], [1, 1], [1, 2], [1, 3]] },
    { n: 2, cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
    { n: 3, cells: [[0, 1], [1, 0], [1, 1], [1, 2]] },
    { n: 3, cells: [[0, 1], [0, 2], [1, 0], [1, 1]] },
    { n: 3, cells: [[0, 0], [0, 1], [1, 1], [1, 2]] },
    { n: 3, cells: [[0, 0], [1, 0], [1, 1], [1, 2]] },
    { n: 3, cells: [[0, 2], [1, 0], [1, 1], [1, 2]] }
  ];
  var SHAPES = buildShapes();                // SHAPES[t][r] = 4 × [row, col]
  // SRS wall kicks by "from" + "to" state (0, 1 = R, 2, 3 = L), as
  // [dx, dy] with y DOWN (the guideline tables are written with y up).
  var KICKS = {
    "01": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    "10": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    "12": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    "21": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    "23": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    "32": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    "30": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    "03": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]]
  };
  var KICKS_I = {
    "01": [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    "10": [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    "12": [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
    "21": [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    "23": [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    "32": [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    "30": [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    "03": [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]]
  };

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
      "start.n": "Level {n}",
      "btn.pause": "Pause (P)", "btn.resume": "Resume (P)",
      "btn.new": "New game (N)",
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "btn.start": "Start", "btn.again": "Play again", "btn.go": "Resume",
      "btn.hold": "Hold (C)",
      "pad.left": "Move left", "pad.right": "Move right",
      "pad.ccw": "Rotate left", "pad.cw": "Rotate right",
      "pad.soft": "Soft drop", "pad.hard": "Hard drop",
      "side.hold": "Hold", "side.next": "Next",
      "st.score": "Score", "st.best": "Best",
      "turn.ready": "Clear lines, don't reach the top",
      "turn.run": "Level {l} · Lines {n}",
      "turn.paused": "Paused",
      "turn.over": "Game over",
      "hint.ready": "← → move · ↑ X Z rotate\n↓ soft drop · Space hard drop\nC or Shift hold · P pause",
      "hint.readyTouch": "Tap: rotate · drag: move\nswipe down: drop · up: hold",
      "hint.paused": "Paused",
      "board.label": "Tetris field, 10 by 20, level {l}",
      "live.start": "Game started",
      "live.paused": "Paused",
      "live.lines1": "1 line",
      "live.lines": "{n} lines",
      "live.tetris": "Tetris!",
      "live.level": "Level {l}",
      "live.over": "Game over: {s} points",
      "res.title": "Game over",
      "res.points": "{s} points",
      "res.record": "New record!",
      "res.lines": "Lines",
      "res.level": "Level",
      "res.best": "Best",
      "res.games": "Games",
      "res.close": "Close",
      "stats.title": "Records",
      "stats.head": "Start level: best · lines · games",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "confirm.reset": "Delete the records on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Records reset",
      "toast.newgame": "New game",
      "toast.undo": "Undo",
      "toast.over": "Game over: start a new game (N)",
      "toast.held": "Hold is used once per piece",
      "toast.start": "Press Start (Space) first",
      "toast.save": "Could not save: storage is full"
    },
    el: {
      "start.n": "Επίπεδο {n}",
      "btn.pause": "Παύση (P)", "btn.resume": "Συνέχεια (P)",
      "btn.new": "Νέο παιχνίδι (N)",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "btn.start": "Έναρξη", "btn.again": "Ξανά", "btn.go": "Συνέχεια",
      "btn.hold": "Κράτηση (C)",
      "pad.left": "Μετακίνηση αριστερά", "pad.right": "Μετακίνηση δεξιά",
      "pad.ccw": "Στροφή αριστερά", "pad.cw": "Στροφή δεξιά",
      "pad.soft": "Γρήγορη πτώση", "pad.hard": "Άμεση πτώση",
      "side.hold": "Κράτηση", "side.next": "Επόμενα",
      "st.score": "Πόντοι", "st.best": "Ρεκόρ",
      "turn.ready": "Γέμισε γραμμές, μη φτάσεις στην κορυφή",
      "turn.run": "Επίπεδο {l} · Γραμμές {n}",
      "turn.paused": "Παύση",
      "turn.over": "Τέλος παιχνιδιού",
      "hint.ready": "← → κίνηση · ↑ X Z στροφή\n↓ γρήγορη πτώση · Space άμεση πτώση\nC ή Shift κράτηση · P παύση",
      "hint.readyTouch": "Άγγιγμα: στροφή · σύρε: κίνηση\nswipe κάτω: πτώση · πάνω: κράτηση",
      "hint.paused": "Παύση",
      "board.label": "Πεδίο Τέτρις, 10 επί 20, επίπεδο {l}",
      "live.start": "Το παιχνίδι ξεκίνησε",
      "live.paused": "Παύση",
      "live.lines1": "1 γραμμή",
      "live.lines": "{n} γραμμές",
      "live.tetris": "Τέτρις!",
      "live.level": "Επίπεδο {l}",
      "live.over": "Τέλος: {s} πόντοι",
      "res.title": "Τέλος παιχνιδιού",
      "res.points": "{s} πόντοι",
      "res.record": "Νέο ρεκόρ!",
      "res.lines": "Γραμμές",
      "res.level": "Επίπεδο",
      "res.best": "Ρεκόρ",
      "res.games": "Παιχνίδια",
      "res.close": "Κλείσιμο",
      "stats.title": "Ρεκόρ",
      "stats.head": "Αρχικό επίπεδο: ρεκόρ · γραμμές · παιχνίδια",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.newgame": "Νέο παιχνίδι",
      "toast.undo": "Αναίρεση",
      "toast.over": "Τέλος: ξεκίνα νέο παιχνίδι (N)",
      "toast.held": "Η κράτηση γίνεται μία φορά ανά κομμάτι",
      "toast.start": "Πάτα πρώτα Έναρξη (Space)",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος"
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

  // crypto RNG in [0, 1)
  function rand() {
    var buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return (buf[0] * 2097152 + (buf[1] >>> 11)) / 9007199254740992;
  }

  function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function fmt(n) { return Number(n).toLocaleString(LANG === "el" ? "el-GR" : "en-US"); }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("tetris.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Game model ----------
  // g = { start, board[ROWS*COLS] (0 empty, 1..7 piece+1), t, r, x, y
  //       (the falling piece: type, rotation, box column / row),
  //       hold (-1 | type), held (hold used for this piece), queue[],
  //       score, lines, level, b2b, fall (gravity rows owed), lockF
  //       (frames on the ground), resets, low (lowest row reached),
  //       pieces, over }
  // Every function returns a new object; the inputs stay untouched.

  // The four rotations of each piece, turning clockwise in its box.
  function buildShapes() {
    return SPAWN.map(function (p) {
      var out = [p.cells], cur = p.cells;
      for (var k = 1; k < 4; k++) {
        cur = cur.map(function (rc) { return [rc[1], p.n - 1 - rc[0]]; });
        out.push(cur);
      }
      return out;
    });
  }

  function copyGame(g) {
    var o = {};
    for (var k in g) if (Object.prototype.hasOwnProperty.call(g, k)) o[k] = g[k];
    return o;
  }

  // One shuffled bag of the seven pieces (Fisher–Yates).
  function nextBag(rnd) {
    var bag = [0, 1, 2, 3, 4, 5, 6];
    for (var i = bag.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1)), x = bag[i];
      bag[i] = bag[j]; bag[j] = x;
    }
    return bag;
  }

  // Whole bags are appended while fewer than 7 pieces wait.
  function fillQueue(queue, rnd) {
    var q = queue.slice();
    while (q.length < 7) q = q.concat(nextBag(rnd));
    return q;
  }

  // Does piece t in rotation r fit with its box at column x, row y?
  // Above the top counts as free; walls and floor do not.
  function fits(board, t, r, x, y) {
    var cells = SHAPES[t][r];
    for (var i = 0; i < 4; i++) {
      var row = y + cells[i][0], col = x + cells[i][1];
      if (col < 0 || col >= COLS || row >= ROWS) return false;
      if (row >= 0 && board[row * COLS + col]) return false;
    }
    return true;
  }

  // Put piece t at the top (first shown row); a blocked spot is tried
  // up to two rows higher, then it is a block out (game over).
  function spawnPiece(g, t) {
    var n = copyGame(g), x = t === 1 ? 4 : 3, y = t === 0 ? HIDE - 1 : HIDE;
    n.t = t; n.r = 0; n.x = x;
    n.fall = 0; n.lockF = 0; n.resets = 0;
    for (var k = 0; k < 3; k++) {
      if (fits(g.board, t, 0, x, y - k)) { n.y = y - k; n.low = n.y; return n; }
    }
    n.y = y; n.low = y; n.over = true;
    return n;
  }

  function takeNext(g, rnd) {
    var q = fillQueue(g.queue, rnd), n = copyGame(g);
    n.queue = fillQueue(q.slice(1), rnd);
    return spawnPiece(n, q[0]);
  }

  function freshGame(start, rnd) {
    var board = [];
    for (var i = 0; i < ROWS * COLS; i++) board.push(0);
    return takeNext({ start: start, board: board, t: 0, r: 0, x: 0, y: 0, hold: -1, held: false,
                      queue: [], score: 0, lines: 0, level: start, b2b: false, fall: 0,
                      lockF: 0, resets: 0, low: 0, pieces: 0, over: false }, rnd);
  }

  // After a player's move or turn: a new lowest row gives a fresh lock
  // delay; on the ground a move restarts it, up to MAX_RESETS times.
  function touched(n) {
    if (n.y > n.low) { n.low = n.y; n.resets = 0; n.lockF = 0; }
    else if (n.lockF > 0 && n.resets < MAX_RESETS) { n.resets++; n.lockF = 0; }
    return n;
  }

  // Shift by dx columns / dy rows (dy > 0 is a soft drop: 1 point a
  // row). null when blocked.
  function tryMove(g, dx, dy) {
    if (g.over || !fits(g.board, g.t, g.r, g.x + dx, g.y + dy)) return null;
    var n = copyGame(g);
    n.x += dx; n.y += dy;
    if (dy > 0) n.score = Math.min(MAX_SCORE, n.score + dy);
    return touched(n);
  }

  // Rotate (dir 1 clockwise, -1 counter-clockwise) trying the SRS kicks
  // in order; n.kick is the kick used. null when every kick is blocked.
  function tryRotate(g, dir) {
    if (g.over) return null;
    var n;
    if (g.t === 1) { n = copyGame(g); n.kick = 0; return touched(n); }   // O: nothing to turn
    var to = (g.r + dir + 4) % 4, kicks = (g.t === 0 ? KICKS_I : KICKS)["" + g.r + to];
    for (var i = 0; i < kicks.length; i++) {
      var x = g.x + kicks[i][0], y = g.y + kicks[i][1];
      if (fits(g.board, g.t, to, x, y)) {
        n = copyGame(g);
        n.r = to; n.x = x; n.y = y; n.kick = i;
        return touched(n);
      }
    }
    return null;
  }

  // Rows the piece can still fall (the ghost sits that far below).
  function dropDist(g) {
    var d = 0;
    while (fits(g.board, g.t, g.r, g.x, g.y + d + 1)) d++;
    return d;
  }

  // Remove full rows; returns { board, n, rows (indices before removal) }.
  function clearLines(board) {
    var keep = [], rows = [];
    for (var r = 0; r < ROWS; r++) {
      var full = true;
      for (var c = 0; c < COLS; c++) if (!board[r * COLS + c]) { full = false; break; }
      if (full) rows.push(r);
      else keep.push(board.slice(r * COLS, r * COLS + COLS));
    }
    var out = [];
    for (var k = 0; k < rows.length * COLS; k++) out.push(0);
    keep.forEach(function (row) { out = out.concat(row); });
    return { board: out, n: rows.length, rows: rows };
  }

  // Points for n cleared lines at a level; a Tetris right after a
  // Tetris (back-to-back) scores 1.5×. A clear of 1–3 lines ends the
  // chain, a piece with no lines keeps it.
  function lineScore(n, level, b2b) {
    var pts = LINE_PTS[n] * level;
    if (n === 4 && b2b) pts = pts * 3 / 2;
    return { pts: pts, b2b: n === 4 ? true : (n > 0 ? false : b2b) };
  }

  function levelOf(start, lines) {
    return Math.min(MAX_LEVEL, start + Math.floor(lines / 10));
  }

  // Gravity in rows per tick (guideline curve: 1 s a row at level 1,
  // ~0.36 s at 5, ~0.06 s at 10, about 20 rows a tick from level 20).
  function gravityRows(level) {
    var lv = Math.min(level, 20), spr = Math.pow(0.8 - (lv - 1) * 0.007, lv - 1);
    return Math.min(ROWS, 1 / (60 * spr));
  }

  // Fix the piece in the board, clear lines, score, take the next piece.
  // Returns { g, ev: { lock, lines, rows, pts, levelUp, over } }.
  function lockPiece(g, rnd) {
    var board = g.board.slice(), cells = SHAPES[g.t][g.r], above = true;
    for (var i = 0; i < 4; i++) {
      var row = g.y + cells[i][0], col = g.x + cells[i][1];
      if (row >= HIDE) above = false;
      if (row >= 0) board[row * COLS + col] = g.t + 1;
    }
    var cl = clearLines(board), sc = lineScore(cl.n, g.level, g.b2b), n = copyGame(g);
    n.board = cl.board;
    n.lines = Math.min(MAX_LINES, g.lines + cl.n);
    n.score = Math.min(MAX_SCORE, g.score + sc.pts);
    n.b2b = sc.b2b;
    n.level = levelOf(g.start, n.lines);
    n.held = false;
    n.pieces = g.pieces + 1;
    var ev = { lock: true, lines: cl.n, rows: cl.rows, pts: sc.pts, levelUp: n.level > g.level, over: false };
    if (above) { n.over = true; ev.over = true; return { g: n, ev: ev }; }   // lock out
    n = takeNext(n, rnd);
    ev.over = n.over;                                                       // block out
    return { g: n, ev: ev };
  }

  function hardDrop(g, rnd) {
    var d = dropDist(g), n = copyGame(g);
    n.y += d;
    n.score = Math.min(MAX_SCORE, n.score + 2 * d);
    return lockPiece(n, rnd);
  }

  // Swap with the hold box (empty box: take the next piece). Once per
  // piece; null when already used.
  function holdPiece(g, rnd) {
    if (g.over || g.held) return null;
    var n = copyGame(g);
    n.held = true;
    n.hold = g.t;
    return g.hold < 0 ? takeNext(n, rnd) : spawnPiece(n, g.hold);
  }

  // One tick: gravity (soft drop = 20× and 1 point a row) and the lock
  // delay. Returns { g, ev } (ev from lockPiece, else null).
  function tick(g, soft, rnd) {
    if (g.over) return { g: g, ev: null };
    var n = copyGame(g), rate = gravityRows(g.level);
    if (soft) rate = Math.min(ROWS, Math.max(rate * 20, 1 / 3));
    n.fall += rate;
    var landed = !fits(n.board, n.t, n.r, n.x, n.y + 1);
    while (n.fall >= 1 && !landed) {
      n.y++;
      n.fall -= 1;
      if (soft) n.score = Math.min(MAX_SCORE, n.score + 1);
      landed = !fits(n.board, n.t, n.r, n.x, n.y + 1);
    }
    if (n.y > n.low) { n.low = n.y; n.resets = 0; n.lockF = 0; }
    if (!landed) return { g: n, ev: null };
    n.fall = 0;
    n.lockF++;
    if (n.lockF >= LOCK_FRAMES) return lockPiece(n, rnd);
    return { g: n, ev: null };
  }

  // ---------- 3. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                       // max-merged
  //   rows: { <deviceId>: { b: <epoch>,
  //                         s: { l1|l5|l10: { n: best, ts: when, l: most lines, g: games } } } }
  // }
  // Each device only ever writes ITS OWN row; a row counts from epoch b.
  // Merge per row: the newer epoch wins; equal epochs take, per key,
  // the better best (higher n, then the earlier ts) and the higher l, g.
  // Rows older than br drop. A join (symmetric, associative, idempotent).
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normCell(v) {
    if (!v || typeof v !== "object" || !isInt(v.n) || !isInt(v.ts) || !isInt(v.g) || !isInt(v.l) ||
        v.n < 0 || v.n > MAX_SCORE || v.ts < 0 || v.g < 1 || v.l < 0 || v.l > MAX_LINES) return null;
    return { n: v.n, ts: v.ts, l: v.l, g: v.g };
  }

  function normRow(row) {
    if (!row || typeof row !== "object" || !isInt(row.b) || row.b < 0) return null;
    var s = {}, any = false;
    KEYS.forEach(function (k) {
      var c = normCell(row.s && row.s[k]);
      if (c) { s[k] = c; any = true; }
    });
    return any ? { b: row.b, s: s } : null;
  }

  function joinCell(a, c) {
    var best = (a.n !== c.n) ? (a.n > c.n ? a : c) : (a.ts <= c.ts ? a : c);
    return { n: best.n, ts: best.ts, l: Math.max(a.l, c.l), g: Math.max(a.g, c.g) };
  }

  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var s = {};
    KEYS.forEach(function (k) {
      var a = x.s[k], c = y.s[k];
      if (!a && !c) return;
      s[k] = (a && c) ? joinCell(a, c) : normCell(a || c);
    });
    return { b: x.b, s: s };
  }

  function mergeTetris(A, B) {
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
      KEYS.forEach(function (k) { if (r.s[k]) s[k] = r.s[k]; });
      sorted[id] = { b: r.b, s: s };
    });
    return { ver: DATA_VER, br: br, rows: sorted };
  }

  // Best score, most lines and games for a key, across every device.
  function totals(key) {
    var out = { n: 0, l: 0, g: 0 };
    Object.keys(data.rows).forEach(function (id) {
      var c = data.rows[id].s[key];
      if (!c) return;
      out.g += c.g;
      if (c.n > out.n) out.n = c.n;
      if (c.l > out.l) out.l = c.l;
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
          data = mergeTetris(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] tetris: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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

  // Counts a finished game; returns true on a new record.
  function countGame(key, score, lines) {
    var before = totals(key).n;
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // new epoch after a reset
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    var c = row.s[key] || { n: 0, ts: 0, l: 0, g: 0 };
    c = { n: c.n, ts: c.ts, l: Math.max(c.l, lines), g: c.g + 1 };
    if (score > c.n) { c.n = score; c.ts = Date.now(); }
    row.s[key] = c;
    data.rows[deviceId] = row;
    data = mergeTetris(data, data);
    save();
    return score > 0 && score > before;
  }

  // ---------- 4. Device-local prefs + session ----------
  var prefs = { start: 1 };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object" && STARTS.indexOf(p.start) >= 0) prefs.start = p.start;
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }
  function keyOf(start) { return "l" + start; }

  var game = null;
  var SESSION_FIELDS = ["start", "board", "t", "r", "x", "y", "hold", "held", "queue", "score",
                        "lines", "level", "b2b", "low", "resets", "pieces"];

  function validSession(g) {
    if (!g || typeof g !== "object" || STARTS.indexOf(g.start) < 0 ||
        !Array.isArray(g.board) || g.board.length !== ROWS * COLS ||
        !Array.isArray(g.queue) || g.queue.length < 3 || g.queue.length > 14) return false;
    for (var i = 0; i < g.board.length; i++) if (!isInt(g.board[i]) || g.board[i] < 0 || g.board[i] > 7) return false;
    for (i = 0; i < g.queue.length; i++) if (!isInt(g.queue[i]) || g.queue[i] < 0 || g.queue[i] > 6) return false;
    if (!isInt(g.t) || g.t < 0 || g.t > 6 || !isInt(g.r) || g.r < 0 || g.r > 3 ||
        !isInt(g.x) || !isInt(g.y) || !isInt(g.hold) || g.hold < -1 || g.hold > 6 ||
        typeof g.held !== "boolean" || typeof g.b2b !== "boolean" ||
        !isInt(g.score) || g.score < 0 || g.score > MAX_SCORE || !isInt(g.lines) || g.lines < 0 ||
        g.lines > MAX_LINES || g.level !== levelOf(g.start, g.lines) || !isInt(g.low) ||
        !isInt(g.resets) || g.resets < 0 || !isInt(g.pieces) || g.pieces < 0) return false;
    return fits(g.board, g.t, g.r, g.x, g.y);
  }
  function loadSession() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(s)) {
        var g = { fall: 0, lockF: 0, over: false };
        SESSION_FIELDS.forEach(function (k) { g[k] = s[k]; });
        return g;
      }
    } catch (e) {}
    return null;
  }
  function saveSession() {
    try {
      if (game && !game.over && (state === "run" || state === "paused" || state === "count")) {
        var s = {};
        SESSION_FIELDS.forEach(function (k) { s[k] = game[k]; });
        localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      } else {
        localStorage.removeItem(SESSION_KEY);
      }
    } catch (e) {}
  }

  // ---------- 5. Game flow ----------
  // state: ready (waiting for Start) → run ⇄ paused (resume via count
  // 3-2-1) → over.
  var state = "ready";
  var acc = 0, lastT = 0, raf = 0;
  var countTimer = null, countN = 0;
  var input = { dir: 0, das: 0, soft: false, softPad: false };
  var flash = null;            // { rows[], t0 } cleared rows, for a short glow

  function inProgress() { return state === "run" || state === "paused" || state === "count"; }

  // A game in progress is never lost silently: Undo toast (R14).
  function newGame(announce) {
    var prev = inProgress() && game ? copyGame(game) : null;
    if (inProgress()) pause(true);
    stopLoop();
    closeDialogs();
    game = freshGame(prefs.start, rand);
    state = "ready";
    flash = null;
    resultPending = false;
    saveSession();
    renderAll();
    if (prev) {
      undoToast(t("toast.newgame"), function () {
        prefs.start = prev.start; savePrefs();
        game = prev;
        state = "paused";
        saveSession();
        renderAll();
      });
    } else if (announce) live(t("toast.newgame"));
  }

  function begin() {
    if (state !== "ready") return;
    state = "run";
    releaseInput();
    saveSession();
    live(t("live.start"));
    startLoop();
    renderAll();
  }

  function pause(quiet) {
    if (state === "run") stopLoop();
    if (state === "run" || state === "count") {
      clearTimeout(countTimer);
      state = "paused";
      releaseInput();
      saveSession();
      if (!quiet) { live(t("live.paused")); renderAll(); }
    }
  }

  function resume() {
    if (state !== "paused") return;
    state = "count";
    countN = 3;
    renderAll();
    clearTimeout(countTimer);
    countTimer = setTimeout(function tickDown() {
      countN--;
      if (countN > 0) { renderOverlay(); countTimer = setTimeout(tickDown, 600); return; }
      if (document.visibilityState === "hidden") { state = "paused"; renderAll(); return; }
      state = "run";
      releaseInput();
      startLoop();
      renderAll();
    }, 600);
  }

  function togglePause() {
    if (state === "run") pause();
    else if (state === "paused") resume();
    else if (state === "ready") showToast(t("toast.start"));
    else if (state === "over") showToast(t("toast.over"));
  }

  function startLoop() {
    stopLoop();
    acc = 0;
    lastT = nowMs();
    raf = requestAnimationFrame(frame);
  }
  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function frame() {
    raf = 0;
    if (state !== "run") return;
    var now = nowMs(), dt = Math.min(250, now - lastT);
    lastT = now;
    acc += dt;
    while (acc >= FRAME_MS && state === "run") {
      acc -= FRAME_MS;
      autoShift();
      var res = tick(game, input.soft || input.softPad, rand);
      game = res.g;
      if (res.ev) afterLock(res.ev);
    }
    draw();
    if (state === "run") raf = requestAnimationFrame(frame);
  }

  // A piece was fixed: sound, glow, announce, save; or game over.
  function afterLock(ev) {
    if (ev.lines) {
      flash = { rows: ev.rows, t0: nowMs() };
      sfx(ev.lines === 4 ? "tetris" : "line");
      live(ev.lines === 4 ? t("live.tetris") : (ev.lines === 1 ? t("live.lines1") : t("live.lines", { n: ev.lines })));
      if (ev.levelUp) setTimeout(function () { sfx("level"); live(t("live.level", { l: game.level })); }, 400);
    } else sfx("lock");
    if (ev.over) { finish(); return; }
    saveSession();
    renderStatus();
    renderSide();
  }

  // Player actions while running; a refused one gives a short shake.
  function act(kind) {
    if (state === "ready") { begin(); return; }
    if (state === "over") { showToast(t("toast.over")); return; }   // R28
    if (state !== "run") return;                                     // paused / 3-2-1: overlay says how
    var n = null, ev = null;
    if (kind === "left" || kind === "right") n = tryMove(game, kind === "left" ? -1 : 1, 0);
    else if (kind === "down") n = tryMove(game, 0, 1);
    else if (kind === "cw" || kind === "ccw") {
      n = tryRotate(game, kind === "cw" ? 1 : -1);
      if (n) sfx("turn"); else shake();
    } else if (kind === "hard") {
      var r = hardDrop(game, rand);
      n = r.g; ev = r.ev;
    } else if (kind === "hold") {
      n = holdPiece(game, rand);
      if (n) sfx("turn");
      else { shake(); showToast(t("toast.held")); }
    }
    if (!n) return false;
    game = n;
    if (ev) afterLock(ev);
    else if (kind === "hold") { if (game.over) finish(); else { saveSession(); renderSide(); } }
    if (state === "run") draw();
    return true;
  }

  function finish() {
    stopLoop();
    releaseInput();
    state = "over";
    var rec = countGame(keyOf(game.start), game.score, game.lines);
    saveSession();
    renderAll();
    live(t("live.over", { s: fmt(game.score) }));
    sfx("over");
    lastRec = rec;
    resultPending = true;
    resultTimer = setTimeout(resultDialog, 600);
  }

  // ---------- 6. Render ----------
  function renderAll() {
    renderToolbar();
    renderStatus();
    renderOverlay();
    renderSide();
    draw();
  }

  function renderToolbar() {
    var st = game ? game.start : prefs.start;
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      var on = +b.getAttribute("data-start") === st;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var pb = $("pause-btn"), paused = state === "paused";
    pb.innerHTML = paused ? UI_ICONS.play : UI_ICONS.pause;
    pb.setAttribute("aria-label", t(paused ? "btn.resume" : "btn.pause"));
    pb.title = t(paused ? "btn.resume" : "btn.pause");
    pb.disabled = !(state === "run" || state === "paused");
    paintSfxBtn();
  }

  function renderStatus() {
    if (!game) return;
    $("score").textContent = fmt(game.score);
    $("best").textContent = fmt(totals(keyOf(game.start)).n);
    var msg;
    if (state === "run" || state === "count") msg = t("turn.run", { l: game.level, n: game.lines });
    else if (state === "paused") msg = t("turn.paused") + " · " + t("turn.run", { l: game.level, n: game.lines });
    else if (state === "over") msg = t("turn.over");
    else msg = t("turn.ready");
    $("turn").textContent = msg;
    $("turn").className = state === "over" ? "done" : "";
    $("board").setAttribute("aria-label", t("board.label", { l: game.level }));
  }

  var coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  function renderOverlay() {
    var ov = $("overlay"), sb = $("start-btn"), cn = $("count"), hint = $("hint");
    ov.hidden = state === "run";
    cn.hidden = state !== "count";
    cn.textContent = state === "count" ? String(countN) : "";
    sb.hidden = state === "count";
    var label = state === "over" ? "btn.again" : (state === "ready" ? "btn.start" : "btn.go");
    sb.innerHTML = UI_ICONS.play + "<span>" + t(label) + "</span>" +
      (coarse ? "" : (state === "paused" ? "<kbd>P</kbd>" : "<kbd>Space</kbd>"));
    hint.hidden = !(state === "ready" || state === "paused");
    hint.textContent = state === "ready" ? t(coarse ? "hint.readyTouch" : "hint.ready") : t("hint.paused");
  }

  var cell = 20, mini = 12;
  function layoutBoard() {
    var wrap = $("board-wrap"), pad = $("pad");
    var cs = getComputedStyle(wrap);
    var W = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var H = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (pad && getComputedStyle(pad).display !== "none") H -= pad.offsetHeight + parseFloat(cs.rowGap || 10);
    if (W <= 0 || H <= 0) return;
    var gap = W < 420 ? 6 : 10;
    // width: 10 cells + two side panels (2.4 cells + 12 px each) + gaps + borders
    // (each panel at least 64 px so its label fits)
    cell = Math.floor(Math.max(10, Math.min((W - 26 - 2 * gap) / 14.8, (W - 130 - 2 * gap) / 10, (H - 2) / 20, 36)));
    mini = Math.max(7, Math.floor(cell * 0.6));
    var side = Math.max(64, 4 * mini + 12);
    var play = $("play");
    play.style.setProperty("--gap", gap + "px");
    play.style.setProperty("--fw", (cell * COLS) + "px");
    play.style.setProperty("--fh", (cell * (ROWS - HIDE)) + "px");
    play.style.setProperty("--side", side + "px");
    sizeCanvas($("board"), cell * COLS, cell * (ROWS - HIDE));
    sizeCanvas($("hold-cv"), 4 * mini + 4, 2 * mini + 8);
    sizeCanvas($("next-cv"), 4 * mini + 4, 3 * (2 * mini + 8) + 2 * Math.round(mini * 0.6));
    renderSide();
    draw();
  }
  function sizeCanvas(cv, w, h) {
    var dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.width = w + "px";
    cv.style.height = h + "px";
  }

  var COLORS = {};
  var PIECE_VARS = ["--pc-i", "--pc-o", "--pc-t", "--pc-s", "--pc-z", "--pc-j", "--pc-l"];
  var PIECE_FALLBACK = ["#3fc6d8", "#e8c43a", "#a66ad8", "#5cbf5a", "#e0574f", "#4a7fe0", "#ec8f3a"];
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ["--accent", "--panel-bg", "--bg-desktop", "--border", "--text-dim", "--text", "--bg", "--danger"]
      .concat(PIECE_VARS).forEach(function (v) { COLORS[v] = cs.getPropertyValue(v).trim(); });
  }
  function pieceColor(t) { return COLORS[PIECE_VARS[t]] || PIECE_FALLBACK[t]; }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // One block with a soft bevel (light top-left, dark bottom).
  function block(ctx, x, y, s, color) {
    var p = Math.max(1, s * 0.06), r = s * 0.16;
    ctx.fillStyle = color;
    rr(ctx, x + p, y + p, s - 2 * p, s - 2 * p, r);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    rr(ctx, x + p * 2, y + p * 2, s - 4 * p, (s - 4 * p) * 0.32, r * 0.7);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.fillRect(x + p * 2, y + s - p - s * 0.14, s - 4 * p, s * 0.1);
  }

  function draw() {
    var cv = $("board");
    if (!cv || !game || !cv.width) return;
    var ctx = cv.getContext("2d"), dpr = cv.width / (cell * COLS), s = cell;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, s * COLS, s * (ROWS - HIDE));
    ctx.fillStyle = COLORS["--bg-desktop"] || "#1a1712";
    ctx.fillRect(0, 0, s * COLS, s * (ROWS - HIDE));
    // faint grid
    ctx.strokeStyle = COLORS["--border"] || "#322d20";
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var c = 1; c < COLS; c++) { ctx.moveTo(c * s + 0.5, 0); ctx.lineTo(c * s + 0.5, s * (ROWS - HIDE)); }
    for (var r = 1; r < ROWS - HIDE; r++) { ctx.moveTo(0, r * s + 0.5); ctx.lineTo(s * COLS, r * s + 0.5); }
    ctx.stroke();
    ctx.globalAlpha = 1;
    // settled blocks
    for (r = HIDE; r < ROWS; r++) for (c = 0; c < COLS; c++) {
      var v = game.board[r * COLS + c];
      if (v) block(ctx, c * s, (r - HIDE) * s, s, pieceColor(v - 1));
    }
    var cells = SHAPES[game.t][game.r], col = pieceColor(game.t);
    // ghost: an outline where a hard drop would land
    if (state !== "over") {
      var gy = game.y + dropDist(game);
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1.5, s * 0.08);
      ctx.globalAlpha = 0.7;
      cells.forEach(function (rc) {
        var row = gy + rc[0];
        if (row < HIDE) return;
        rr(ctx, (game.x + rc[1]) * s + s * 0.12, (row - HIDE) * s + s * 0.12, s * 0.76, s * 0.76, s * 0.14);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }
    // the falling piece (only its shown part)
    cells.forEach(function (rc) {
      var row = game.y + rc[0];
      if (row < HIDE) return;
      block(ctx, (game.x + rc[1]) * s, (row - HIDE) * s, s, col);
    });
    // glow where lines were cleared
    if (flash && !reduced) {
      var age = nowMs() - flash.t0;
      if (age < 320) {
        ctx.fillStyle = "rgba(255,255,255," + (0.55 * (1 - age / 320)).toFixed(3) + ")";
        flash.rows.forEach(function (row) { if (row >= HIDE) ctx.fillRect(0, (row - HIDE) * s, s * COLS, s); });
      } else flash = null;
    }
    if (state === "over") {
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(0, 0, s * COLS, s * (ROWS - HIDE));
    }
  }

  // A piece centred in a w × h area of a mini canvas.
  function drawMini(ctx, t, x0, y0, w, h, m, dim) {
    var cells = SHAPES[t][0], minR = 9, maxR = -1, minC = 9, maxC = -1;
    cells.forEach(function (rc) {
      minR = Math.min(minR, rc[0]); maxR = Math.max(maxR, rc[0]);
      minC = Math.min(minC, rc[1]); maxC = Math.max(maxC, rc[1]);
    });
    var pw = (maxC - minC + 1) * m, ph = (maxR - minR + 1) * m;
    var ox = x0 + (w - pw) / 2, oy = y0 + (h - ph) / 2;
    ctx.globalAlpha = dim ? 0.4 : 1;
    cells.forEach(function (rc) { block(ctx, ox + (rc[1] - minC) * m, oy + (rc[0] - minR) * m, m, pieceColor(t)); });
    ctx.globalAlpha = 1;
  }

  function renderSide() {
    if (!game) return;
    var hc = $("hold-cv"), nc = $("next-cv");
    if (!hc.width || !nc.width) return;
    var dpr = window.devicePixelRatio || 1, m = mini;
    var w = 4 * m + 4, hh = 2 * m + 8, gap = Math.round(m * 0.6);
    var ctx = hc.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hh);
    if (game.hold >= 0) drawMini(ctx, game.hold, 0, 0, w, hh, m, game.held);
    var box = $("hold-box");
    box.classList.toggle("used", !!game.held && state === "run");
    ctx = nc.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, 3 * hh + 2 * gap);
    for (var i = 0; i < 3 && i < game.queue.length; i++) drawMini(ctx, game.queue[i], 0, i * (hh + gap), w, hh, i ? Math.round(m * 0.85) : m, false);
  }

  var shakeTimer = null;
  function shake() {
    var f = $("field");
    f.classList.remove("shake");
    void f.offsetWidth;
    f.classList.add("shake");
    clearTimeout(shakeTimer);
    shakeTimer = setTimeout(function () { f.classList.remove("shake"); }, 200);
  }

  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 7. Dialogs ----------
  function closeDialogs() {
    [].forEach.call(document.querySelectorAll("dialog[open]"), function (d) { d.close(); });
  }
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

  // Shown once per game, 0.6 s after the end (Space shows it at once).
  var lastRec = false, resultPending = false, resultTimer = null;
  function resultDialog() {
    clearTimeout(resultTimer);
    if (!resultPending || state !== "over" || !game) return;     // replaced meanwhile
    resultPending = false;
    var rec = lastRec;
    var s = totals(keyOf(game.start));
    var dlg = makeDialog("tetris-result");
    dlg.appendChild(el("div", "dlg-title", t("res.title") + " · " + t("start.n", { n: game.start })));
    dlg.appendChild(el("div", "dlg-hero", t("res.points", { s: fmt(game.score) })));
    if (rec) dlg.appendChild(el("div", "dlg-badge", t("res.record")));
    dlg.appendChild(row(t("res.lines"), fmt(game.lines)));
    dlg.appendChild(row(t("res.level"), String(game.level)));
    dlg.appendChild(row(t("res.best"), fmt(s.n)));
    dlg.appendChild(row(t("res.games"), fmt(s.g)));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("res.close"), "", function () { dlg.close(); }));
    var again = button(t("btn.again"), "primary", function () { dlg.close(); newGame(false); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    again.focus();
  }

  function statsDialog() {
    pause();
    var dlg = makeDialog("tetris-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    STARTS.forEach(function (st) {
      var s = totals(keyOf(st));
      if (s.g) empty = false;
      dlg.appendChild(row(t("start.n", { n: st }), s.g ? fmt(s.n) + " · " + fmt(s.l) + " · " + fmt(s.g) : "–"));
    });
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
    var dlg = makeDialog("tetris-confirm");
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
    data = mergeTetris(data, data);
    save();
    renderStatus();
    showToast(t("toast.reset"));
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "tetris", title: String(text) })) return;
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

  // ---------- 9. Sound ----------
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
      if (kind === "turn") tone(880, 0, 0.03, "square", 0.04);
      else if (kind === "lock") tone(180, 0, 0.06, "triangle", 0.12);
      else if (kind === "line") { tone(660, 0, 0.07, "triangle", 0.14); tone(880, 0.06, 0.1, "triangle", 0.12); }
      else if (kind === "tetris") { [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.07, 0.14, "triangle", 0.14); }); }
      else if (kind === "level") { tone(784, 0, 0.1, "sine", 0.14); tone(1175, 0.09, 0.16, "sine", 0.12); }
      else if (kind === "over") { [330, 262, 196, 147].forEach(function (f, k) { tone(f, k * 0.13, 0.22, "triangle", 0.16); }); }
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Toolbar icons (R9: injected by JS) ----------
  var UI_ICONS = {
    pause: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5v14M15 5v14"/></svg>',
    play:  '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
    new:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    sfxOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    sfxOff:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
    left:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    ccw:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.6-5.9L4 8.5"/><path d="M4 3.5v5h5"/></svg>',
    cw:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.6-5.9L20 8.5"/><path d="M20 3.5v5h-5"/></svg>',
    soft:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    hard:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5l6 6 6-6M6 11l6 6 6-6M5 21h14"/></svg>'
  };
  function paintSfxBtn() {
    var b = $("sfx-btn"), on = sfxOn();
    b.innerHTML = on ? UI_ICONS.sfxOn : UI_ICONS.sfxOff;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.setAttribute("aria-label", t(on ? "btn.sfxOn" : "btn.sfxOff"));
    b.title = t(on ? "btn.sfxOn" : "btn.sfxOff");
  }

  // ---------- 10. Input ----------
  // Left / right: one step at once, then auto-shift after DAS ticks,
  // one column every ARR ticks while held (keys or pad buttons).
  function pressDir(d) {
    if (state !== "run") { act(d < 0 ? "left" : "right"); return; }
    input.dir = d;
    input.das = 0;
    act(d < 0 ? "left" : "right");
  }
  function releaseDir(d) { if (input.dir === d) { input.dir = 0; input.das = 0; } }
  function releaseInput() { input.dir = 0; input.das = 0; input.soft = false; input.softPad = false; }
  function autoShift() {
    if (!input.dir) return;
    input.das++;
    if (input.das >= DAS && (input.das - DAS) % ARR === 0) {
      var n = tryMove(game, input.dir, 0);
      if (n) game = n;
    }
  }

  var ACT_KEYS = { ArrowUp: "cw", KeyX: "cw", KeyZ: "ccw", KeyC: "hold", ShiftLeft: "hold", ShiftRight: "hold" };

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;   // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      var code = e.code, a = document.activeElement;
      var busy = state === "run" || state === "count";
      if (code === "ArrowLeft" || code === "ArrowRight") {
        e.preventDefault();
        if (!e.repeat) pressDir(code === "ArrowLeft" ? -1 : 1);
        return;
      }
      if (code === "ArrowDown") {
        e.preventDefault();
        if (e.repeat) return;
        if (state === "run") input.soft = true; else act("down");
        return;
      }
      if (ACT_KEYS[code]) {
        if (e.shiftKey && code.indexOf("Shift") < 0) return;
        e.preventDefault();
        if (!e.repeat) act(ACT_KEYS[code]);
        return;
      }
      if (e.repeat || e.shiftKey) return;
      if (code === "KeyN") { e.preventDefault(); newGame(true); return; }
      if (code === "KeyP" || code === "Escape") { e.preventDefault(); togglePause(); return; }
      if (code === "Space" || code === "Enter") {
        // a focused toolbar or dialog button keeps its own Space / Enter
        // unless the game is running (then Space is the hard drop)
        if (a && a.tagName === "BUTTON" && a.id !== "start-btn" && !busy) return;
        e.preventDefault();
        if (a && a.tagName === "BUTTON") a.blur();
        if (state === "run") { if (code === "Space") act("hard"); }
        else if (state === "paused") resume();
        else if (state === "over") { if (resultPending) resultDialog(); else newGame(false); }
        else if (state === "ready") begin();
      }
    });
    document.addEventListener("keyup", function (e) {
      if (e.code === "ArrowLeft") releaseDir(-1);
      else if (e.code === "ArrowRight") releaseDir(1);
      else if (e.code === "ArrowDown") input.soft = false;
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

  // Field gestures: a tap rotates, a drag moves one column per cell
  // (down: soft drop a row per cell), a quick swipe down hard-drops,
  // a quick swipe up holds.
  var down = null;
  function wireField() {
    var field = $("field");
    field.addEventListener("pointerdown", function (e) {
      if (e.target.closest && e.target.closest("button")) return;
      down = { x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, t: nowMs(), id: e.pointerId, moved: false, rows: 0 };
      try { field.setPointerCapture(e.pointerId); } catch (err) {}
    });
    field.addEventListener("pointermove", function (e) {
      if (!down || e.pointerId !== down.id || state !== "run") return;
      var dx = e.clientX - down.x, dy = e.clientY - down.y;
      while (Math.abs(dx) >= cell) {
        var d = dx > 0 ? 1 : -1, n = tryMove(game, d, 0);
        if (n) { game = n; draw(); }
        down.x += d * cell; dx -= d * cell; down.moved = true;
      }
      // a slow drag down soft-drops; a fast flick is left to pointerup
      var v = (e.clientY - down.oy) / Math.max(1, nowMs() - down.t);
      while (dy >= cell && v < 0.9) {
        var m = tryMove(game, 0, 1);
        if (m) { game = m; draw(); }
        down.y += cell; dy -= cell; down.moved = true; down.rows++;
      }
    });
    var end = function (e) {
      if (!down || e.pointerId !== down.id) return;
      var dx = e.clientX - down.ox, dy = e.clientY - down.oy, dt = nowMs() - down.t, was = down;
      down = null;
      if (e.type === "pointercancel") return;
      if (state === "ready") { begin(); return; }
      if (state !== "run") return;
      var far = Math.max(Math.abs(dx), Math.abs(dy));
      if (far < 10 && dt < 350 && !was.moved) { act("cw"); return; }
      if (Math.abs(dy) > Math.abs(dx) * 1.5 && Math.abs(dy) >= 40 && dt < 400) {
        if (dy > 0 && was.rows < 3) act("hard");
        else if (dy < 0) act("hold");
      }
    };
    field.addEventListener("pointerup", end);
    field.addEventListener("pointercancel", end);
  }

  function wirePad() {
    [].forEach.call(document.querySelectorAll("#pad .pad"), function (b) {
      var a = b.getAttribute("data-act");
      b.innerHTML = UI_ICONS[a];
      b.setAttribute("aria-label", t("pad." + a));
      b.title = t("pad." + a);
      var off = function () {
        b.classList.remove("on");
        if (a === "left") releaseDir(-1);
        else if (a === "right") releaseDir(1);
        else if (a === "soft") input.softPad = false;
      };
      b.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        b.classList.add("on");
        try { b.setPointerCapture(e.pointerId); } catch (err) {}
        if (a === "left") pressDir(-1);
        else if (a === "right") pressDir(1);
        else if (a === "soft") { if (state === "run") input.softPad = true; else act("down"); }
        else act(a === "hard" ? "hard" : a);
      });
      b.addEventListener("pointerup", off);
      b.addEventListener("pointercancel", off);
      b.addEventListener("lostpointercapture", off);
      b.addEventListener("click", function (e) {
        if (e.detail !== 0) return;              // keyboard activation only
        act(a === "soft" ? "down" : a);
      });
    });
    $("hold-box").addEventListener("click", function () { act("hold"); $("hold-box").blur(); });
  }

  // ---------- 11. Sync slice + palette ----------
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
    readColors();
    draw();
    renderSide();
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
    api.registerSlice("tetris", sliceGet, sliceSet, STORAGE_KEY, mergeTetris);
  }

  function sliceGet() {
    return mergeTetris(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeTetris(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    renderStatus();
    // no toast on merge (sync feedback = taskbar dot)
  }

  // ---------- 12. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      b.textContent = t("start.n", { n: b.getAttribute("data-start") });
    });
  }

  function paintStatic() {
    [["new-btn", "new", "btn.new"], ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    $("hold-box").setAttribute("aria-label", t("btn.hold"));
    $("hold-box").title = t("btn.hold");
    paintSfxBtn();
  }

  // A start-level change starts a new game with it (Undo toast if one was on).
  function setStart(st) {
    if (game && st === game.start && state === "ready") return;   // visible active state
    prefs.start = st; savePrefs();
    newGame(true);
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () { setStart(+b.getAttribute("data-start")); b.blur(); });
    });
    $("pause-btn").addEventListener("click", function () { togglePause(); $("pause-btn").blur(); });
    $("new-btn").addEventListener("click", function () { newGame(true); $("new-btn").blur(); });
    $("start-btn").addEventListener("click", function () {
      $("start-btn").blur();
      if (state === "over") newGame(false);
      else if (state === "ready") begin();
      else resume();
    });
    $("stats-btn").addEventListener("click", statsDialog);
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("line");   // audible confirmation when turned on
    });
    wireField();
    wirePad();

    var relayout = function () { layoutBoard(); };
    if (window.ResizeObserver) new ResizeObserver(relayout).observe($("board-wrap"));
    else window.addEventListener("resize", relayout);

    // Hidden or blurred → paused (the game is saved); it waits for Resume.
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") pause();
    });
    window.addEventListener("blur", function () { pause(); });
    window.addEventListener("pagehide", function () { pause(true); saveSession(); });

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
    if (game) { prefs.start = game.start; state = "paused"; }
    else { game = freshGame(prefs.start, rand); state = "ready"; }
    layoutBoard();
    renderAll();
  }

  boot();
})();
