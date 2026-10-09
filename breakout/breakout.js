// ============================================================
// orOS Breakout — App logic (v1.0.0)
// Bounce the ball off the paddle and break every brick. Bricks take
// 1, 2 or 3 hits; 8 hand-made levels, then they repeat faster.
//   - the paddle follows the mouse, a drag on a touch screen, or the
//     arrow keys / A D; the bounce angle depends on where the ball
//     hits the paddle (up to 60° from straight up)
//   - 3 lives; a level cleared gives 100 × its number
//   - power-ups (option, on by default): wider paddle, slow ball,
//     extra life, dropped by a broken brick now and then
//   - Space / click / tap launches; P / Space / Esc pause; hidden or
//     blurred → paused; resume after 3-2-1
//   - a game in progress is kept on the device and resumes paused
// The physics run in fixed 1/120 s steps (pure functions below) with
// sub-steps of at most 3 units, so the ball never skips a brick or
// the paddle; requestAnimationFrame only feeds time and draws.
// Data:
//   - synced slice "breakout" (oros-breakout-data): per mode (power-ups
//     on / off) the best score (and when), the best level reached and
//     the games played, as per-device rows (each device only grows its
//     own row; merge = per-row join) + a reset stamp br
//   - device-local (R10): oros-breakout-prefs (power-ups),
//     oros-breakout-session (the game in progress), oros-breakout-device
//     (row id), oros-breakout-sfx (sound on/off)
// Sections:
//   1. Constants, i18n, helpers
//   2. Game model (levels, paddle, ball physics, bricks, power-ups)
//   3. Synced data: load / save / normalize / merge (R5, R26)
//   4. Device-local prefs + session
//   5. Game flow (new, start, pause, countdown, loop, finish)
//   6. Render (toolbar, status, overlay, canvas)
//   7. Dialogs (result, records, confirm)
//   8. Toasts
//   9. Sound
//  10. Input (keys, pointer, Contract Β)
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-breakout-data";
  var PREFS_KEY   = "oros-breakout-prefs";
  var SESSION_KEY = "oros-breakout-session";
  var DEVICE_KEY  = "oros-breakout-device";
  var SFX_KEY     = "oros-breakout-sfx";
  var DATA_VER    = 1;

  var KEYS = ["p1", "p0"];                   // power-ups on | off
  var W = 480, H = 640;                      // logical field
  var BCOLS = 12, BROWS = 10;                // brick grid
  var BW = 36, BH = 18, BLEFT = 24, BTOP = 64;
  var R = 6;                                 // ball radius
  var PADDLE_Y = H - 44, PADDLE_H = 12;      // top of the paddle
  var PADDLE_W = 84, PADDLE_WIDE = 132;
  var PADDLE_V = 620;                        // keys, units / s
  var PADDLE_PTR_V = 3000;                   // pointer follow, units / s
  var DT = 1 / 120;                          // one physics step (s)
  var SUB = 3;                               // max units per sub-step (< R)
  var MAX_V = 720;                           // ball speed cap
  var MAX_ANGLE = Math.PI / 3;               // 60° off vertical at the paddle edge
  var LIVES = 3, MAX_LIVES = 5;
  var CAP_V = 150, CAP_R = 9, CAP_CHANCE = 0.12;
  var WIDE_S = 15, SLOW_S = 10, SLOW_F = 0.7;
  var MAX_LEVEL = 999, MAX_SCORE = 99999999;
  // Hand-made levels: 12 columns, "." empty, 1–3 = hits.
  var LEVELS = [
    ["............",
     "111111111111",
     "111111111111",
     "111111111111",
     "111111111111"],
    ["222222222222",
     "111111111111",
     "222222222222",
     "111111111111",
     "111111111111"],
    [".....33.....",
     "....2222....",
     "...111111...",
     "..22222222..",
     ".1111111111.",
     "222222222222"],
    ["1.2.1.2.1.2.",
     ".1.2.1.2.1.2",
     "2.1.2.1.2.1.",
     ".2.1.2.1.2.1",
     "1.2.1.2.1.2.",
     ".1.2.1.2.1.2"],
    [".....11.....",
     "....1221....",
     "...123321...",
     "..12333321..",
     "...123321...",
     "....1221....",
     ".....11....."],
    ["33.33..33.33",
     "22.22..22.22",
     "11.11..11.11",
     "11.11..11.11",
     "22.22..22.22",
     "33.33..33.33"],
    ["333333333333",
     "3..........3",
     "3.22222222.3",
     "3.21111112.3",
     "3.22222222.3",
     "3..........3",
     "3333....3333"],
    ["1..........1",
     "21........12",
     "321......123",
     "2321....1232",
     "12321..12321",
     "112322223211",
     "111111111111"]
  ];

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
      "pow.on": "Power-ups", "pow.off": "No power-ups",
      "btn.pause": "Pause (P)", "btn.resume": "Resume (P)",
      "btn.new": "New game (N)",
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "btn.start": "Start", "btn.again": "Play again", "btn.go": "Resume",
      "st.score": "Score", "st.best": "Best",
      "turn.ready": "Break every brick",
      "turn.run": "Level {l} · Lives {n}",
      "turn.paused": "Paused",
      "turn.over": "Game over",
      "hint.ready": "Mouse or ← → move the paddle\nClick or Space launches · P pause",
      "hint.readyTouch": "Drag to move the paddle\nTap to launch the ball",
      "hint.paused": "Paused",
      "cv.launch": "Space or click to launch",
      "cv.launchTouch": "Tap to launch",
      "cv.level": "Level {l}",
      "cv.lives": "Lives left: {n}",
      "cap.w": "Wide paddle", "cap.s": "Slow ball", "cap.l": "Extra life",
      "board.label": "Breakout field, level {l}, {b} bricks left",
      "live.start": "Game started",
      "live.paused": "Paused",
      "live.lost": "Ball lost, {n} lives left",
      "live.lost1": "Ball lost, 1 life left",
      "live.level": "Level {l}",
      "live.over": "Game over: {s} points",
      "res.title": "Game over",
      "res.points": "{s} points",
      "res.record": "New record!",
      "res.level": "Level reached",
      "res.best": "Best",
      "res.games": "Games",
      "res.close": "Close",
      "stats.title": "Records",
      "stats.head": "Best · level · games",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "stats.on": "best on {d}",
      "confirm.reset": "Delete the records on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Records reset",
      "toast.newgame": "New game",
      "toast.undo": "Undo",
      "toast.over": "Game over: start a new game (N)",
      "toast.start": "Press Start (Space) first",
      "toast.save": "Could not save: storage is full"
    },
    el: {
      "pow.on": "Ενισχύσεις", "pow.off": "Χωρίς ενισχύσεις",
      "btn.pause": "Παύση (P)", "btn.resume": "Συνέχεια (P)",
      "btn.new": "Νέο παιχνίδι (N)",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "btn.start": "Έναρξη", "btn.again": "Ξανά", "btn.go": "Συνέχεια",
      "st.score": "Πόντοι", "st.best": "Ρεκόρ",
      "turn.ready": "Σπάσε όλα τα τουβλάκια",
      "turn.run": "Επίπεδο {l} · Ζωές {n}",
      "turn.paused": "Παύση",
      "turn.over": "Τέλος παιχνιδιού",
      "hint.ready": "Ποντίκι ή ← → για τη ρακέτα\nΚλικ ή Space ρίχνει την μπάλα · P παύση",
      "hint.readyTouch": "Σύρε για να κινήσεις τη ρακέτα\nΆγγιξε για να ρίξεις την μπάλα",
      "hint.paused": "Παύση",
      "cv.launch": "Space ή κλικ για ρίξιμο",
      "cv.launchTouch": "Άγγιξε για ρίξιμο",
      "cv.level": "Επίπεδο {l}",
      "cv.lives": "Ζωές που μένουν: {n}",
      "cap.w": "Φαρδιά ρακέτα", "cap.s": "Αργή μπάλα", "cap.l": "Μία ζωή ακόμη",
      "board.label": "Πεδίο Τουβλάκια, επίπεδο {l}, μένουν {b} τουβλάκια",
      "live.start": "Το παιχνίδι ξεκίνησε",
      "live.paused": "Παύση",
      "live.lost": "Χάθηκε η μπάλα, μένουν {n} ζωές",
      "live.lost1": "Χάθηκε η μπάλα, μένει 1 ζωή",
      "live.level": "Επίπεδο {l}",
      "live.over": "Τέλος: {s} πόντοι",
      "res.title": "Τέλος παιχνιδιού",
      "res.points": "{s} πόντοι",
      "res.record": "Νέο ρεκόρ!",
      "res.level": "Επίπεδο",
      "res.best": "Ρεκόρ",
      "res.games": "Παιχνίδια",
      "res.close": "Κλείσιμο",
      "stats.title": "Ρεκόρ",
      "stats.head": "Ρεκόρ · επίπεδο · παιχνίδια",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "stats.on": "ρεκόρ στις {d}",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.newgame": "Νέο παιχνίδι",
      "toast.undo": "Αναίρεση",
      "toast.over": "Τέλος: ξεκίνα νέο παιχνίδι (N)",
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

  function dateStr(ts) {
    try {
      return new Date(ts).toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB",
        { day: "numeric", month: "short", year: "numeric" });
    } catch (e) { return ""; }
  }
  function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function fmt(n) { return Number(n).toLocaleString(LANG === "el" ? "el-GR" : "en-US"); }
  function isNum(v) { return typeof v === "number" && isFinite(v); }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("breakout.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Game model ----------
  // g = { pow (power-ups on), level (0-based; LEVELS[level % 8]),
  //       bricks[BROWS*BCOLS] (hits left, 0 = none), score, lives,
  //       px (paddle centre), speed (ball, units / s),
  //       ball { x, y, dx, dy (unit direction), stuck, off (x on the paddle) },
  //       wideT, slowT (power-up seconds left), caps[{ x, y, k: w|s|l }],
  //       over }
  // Every function returns a new object; the inputs stay untouched.

  // The bricks of a level (0-based; after the 8th they repeat).
  function levelBricks(level) {
    var rows = LEVELS[level % LEVELS.length], out = [];
    for (var r = 0; r < BROWS; r++) for (var c = 0; c < BCOLS; c++) {
      var ch = rows[r] ? rows[r].charAt(c) : ".";
      out.push(ch >= "1" && ch <= "3" ? +ch : 0);
    }
    return out;
  }

  // Ball speed at the start of a level: a little faster each level,
  // +15% each time the 8 levels repeat.
  function levelSpeed(level) {
    return Math.min(MAX_V - 120, (300 + 15 * (level % LEVELS.length)) * (1 + 0.15 * Math.floor(level / LEVELS.length)));
  }

  function paddleW(g) { return g.wideT > 0 ? PADDLE_WIDE : PADDLE_W; }

  function stuckBall(px) { return { x: px, y: PADDLE_Y - R, dx: 0, dy: -1, stuck: true, off: 0 }; }

  function freshGame(pow) {
    return { pow: !!pow, level: 0, bricks: levelBricks(0), score: 0, lives: LIVES, px: W / 2,
             speed: levelSpeed(0), ball: stuckBall(W / 2), wideT: 0, slowT: 0, caps: [], over: false };
  }

  function copyGame(g) {
    var o = {};
    for (var k in g) if (Object.prototype.hasOwnProperty.call(g, k)) o[k] = g[k];
    o.ball = {};
    for (k in g.ball) if (Object.prototype.hasOwnProperty.call(g.ball, k)) o.ball[k] = g.ball[k];
    o.caps = g.caps.map(function (c) { return { x: c.x, y: c.y, k: c.k }; });
    return o;
  }

  function bricksLeft(bricks) {
    var n = 0;
    for (var i = 0; i < bricks.length; i++) if (bricks[i] > 0) n++;
    return n;
  }

  // The brick (index) the ball's box at (x, y) overlaps most, or -1.
  function brickAt(bricks, x, y) {
    var c0 = Math.floor((x - R - BLEFT) / BW), c1 = Math.floor((x + R - BLEFT) / BW);
    var r0 = Math.floor((y - R - BTOP) / BH), r1 = Math.floor((y + R - BTOP) / BH);
    var best = -1, area = 0;
    for (var r = Math.max(0, r0); r <= Math.min(BROWS - 1, r1); r++) {
      for (var c = Math.max(0, c0); c <= Math.min(BCOLS - 1, c1); c++) {
        if (!bricks[r * BCOLS + c]) continue;
        var bx = BLEFT + c * BW, by = BTOP + r * BH;
        var ox = Math.min(x + R, bx + BW) - Math.max(x - R, bx);
        var oy = Math.min(y + R, by + BH) - Math.max(y - R, by);
        if (ox > 0 && oy > 0 && ox * oy > area) { area = ox * oy; best = r * BCOLS + c; }
      }
    }
    return best;
  }

  // Direction after the paddle: rel = -1 (left edge) … 1 (right edge).
  function paddleBounce(rel) {
    var a = Math.max(-1, Math.min(1, rel)) * MAX_ANGLE;
    return { dx: Math.sin(a), dy: -Math.cos(a) };
  }

  // Launch from the paddle at 10°–25° off vertical, either side.
  function launchDir(rnd) {
    var a = (10 + 15 * rnd()) * Math.PI / 180 * (rnd() < 0.5 ? -1 : 1);
    return { dx: Math.sin(a), dy: -Math.cos(a) };
  }

  // One brick hit: one hit less, 10 points; a broken brick may drop a
  // power-up (when they are on).
  function hitBrick(n, i, ev, rnd) {
    n.bricks[i]--;
    n.score = Math.min(MAX_SCORE, n.score + 10);
    ev.hits++;
    if (n.bricks[i] > 0) return;
    ev.broke++;
    if (n.pow && rnd() < CAP_CHANCE) {
      var p = rnd(), k = p < 0.45 ? "w" : (p < 0.8 ? "s" : "l");
      n.caps.push({ x: BLEFT + (i % BCOLS + 0.5) * BW, y: BTOP + (Math.floor(i / BCOLS) + 0.5) * BH, k: k });
    }
  }

  // Back on the paddle for a new life or level; power-ups end.
  function resetBall(n) {
    n.ball = stuckBall(n.px);
    n.caps = [];
    n.wideT = 0;
    n.slowT = 0;
    n.speed = levelSpeed(n.level);
  }

  // One physics step of DT seconds.
  // inp = { dir: -1 | 0 | 1 (keys), target: x | null (pointer), launch }
  // Returns { g, ev: { hits, broke, wall, paddle, caught, lost, cleared, over } }.
  function step(g, inp, rnd) {
    var ev = { hits: 0, broke: 0, wall: false, paddle: false, caught: null, lost: false, cleared: false, over: false };
    if (g.over) return { g: g, ev: ev };
    var n = copyGame(g), i;
    n.wideT = Math.max(0, n.wideT - DT);
    n.slowT = Math.max(0, n.slowT - DT);
    var pw = paddleW(n);
    // paddle
    if (inp.target !== null && inp.target !== undefined && isNum(inp.target)) {
      var d = inp.target - n.px, lim = PADDLE_PTR_V * DT;
      n.px += Math.max(-lim, Math.min(lim, d));
    } else if (inp.dir) n.px += inp.dir * PADDLE_V * DT;
    n.px = Math.max(pw / 2, Math.min(W - pw / 2, n.px));
    // falling power-ups
    var kept = [];
    n.caps.forEach(function (c) {
      c.y += CAP_V * DT;
      if (c.y + CAP_R >= PADDLE_Y && c.y - CAP_R <= PADDLE_Y + PADDLE_H &&
          c.x + CAP_R >= n.px - pw / 2 && c.x - CAP_R <= n.px + pw / 2) {
        ev.caught = c.k;
        if (c.k === "w") n.wideT = WIDE_S;
        else if (c.k === "s") n.slowT = SLOW_S;
        else n.lives = Math.min(MAX_LIVES, n.lives + 1);
      } else if (c.y - CAP_R < H) kept.push(c);
    });
    n.caps = kept;
    pw = paddleW(n);
    n.px = Math.max(pw / 2, Math.min(W - pw / 2, n.px));
    var b = n.ball;
    if (b.stuck) {
      b.x = Math.max(R, Math.min(W - R, n.px + b.off));
      b.y = PADDLE_Y - R;
      if (!inp.launch) return { g: n, ev: ev };
      var l = launchDir(rnd);
      b.dx = l.dx; b.dy = l.dy; b.stuck = false;
    }
    // ball: sub-steps of at most SUB units, x then y, so it never skips a brick
    var v = n.speed * (n.slowT > 0 ? SLOW_F : 1), dist = v * DT;
    var subs = Math.max(1, Math.ceil(dist / SUB)), h = dist / subs;
    n.bricks = n.bricks.slice();
    for (var s = 0; s < subs; s++) {
      b.x += b.dx * h;
      if (b.x - R < 0) { b.x = R; b.dx = Math.abs(b.dx); ev.wall = true; }
      else if (b.x + R > W) { b.x = W - R; b.dx = -Math.abs(b.dx); ev.wall = true; }
      i = brickAt(n.bricks, b.x, b.y);
      if (i >= 0) { b.x -= b.dx * h; b.dx = -b.dx; hitBrick(n, i, ev, rnd); }
      b.y += b.dy * h;
      if (b.y - R < 0) { b.y = R; b.dy = Math.abs(b.dy); ev.wall = true; }
      i = brickAt(n.bricks, b.x, b.y);
      if (i >= 0) { b.y -= b.dy * h; b.dy = -b.dy; hitBrick(n, i, ev, rnd); }
      // the paddle: only from above, while the ball comes down
      if (b.dy > 0 && b.y + R >= PADDLE_Y && b.y - R <= PADDLE_Y + PADDLE_H &&
          b.x + R >= n.px - pw / 2 && b.x - R <= n.px + pw / 2 && b.y - b.dy * h + R <= PADDLE_Y + 1) {
        var nd = paddleBounce((b.x - n.px) / (pw / 2 + R));
        b.dx = nd.dx; b.dy = nd.dy;
        b.y = PADDLE_Y - R;
        n.speed = Math.min(MAX_V, Math.max(n.speed, levelSpeed(n.level)) + 3);
        ev.paddle = true;
      }
      if (b.y - R > H) break;
    }
    if (ev.broke && !bricksLeft(n.bricks)) {
      ev.cleared = true;
      n.score = Math.min(MAX_SCORE, n.score + 100 * (n.level + 1));
      n.level = Math.min(MAX_LEVEL, n.level + 1);
      n.bricks = levelBricks(n.level);
      resetBall(n);
      return { g: n, ev: ev };
    }
    if (b.y - R > H) {
      ev.lost = true;
      n.lives--;
      resetBall(n);
      if (n.lives <= 0) { n.lives = 0; n.over = true; ev.over = true; }
    }
    return { g: n, ev: ev };
  }

  // ---------- 3. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                       // max-merged
  //   rows: { <deviceId>: { b: <epoch>,
  //                         s: { p1|p0: { n: best, ts: when, v: best level, g: games } } } }
  // }
  // Each device only ever writes ITS OWN row; a row counts from epoch b.
  // Merge per row: the newer epoch wins; equal epochs take, per key,
  // the better best (higher n, then the earlier ts) and the higher v, g.
  // Rows older than br drop. A join (symmetric, associative, idempotent).
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normCell(v) {
    if (!v || typeof v !== "object" || !isInt(v.n) || !isInt(v.ts) || !isInt(v.g) || !isInt(v.v) ||
        v.n < 0 || v.n > MAX_SCORE || v.ts < 0 || v.g < 1 || v.v < 1 || v.v > MAX_LEVEL + 1) return null;
    return { n: v.n, ts: v.ts, v: v.v, g: v.g };
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
    return { n: best.n, ts: best.ts, v: Math.max(a.v, c.v), g: Math.max(a.g, c.g) };
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

  function mergeBreakout(A, B) {
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

  // Best score (and when), best level and games for a key, across every device.
  function totals(key) {
    var out = { n: 0, ts: 0, v: 0, g: 0 };
    Object.keys(data.rows).forEach(function (id) {
      var c = data.rows[id].s[key];
      if (!c) return;
      out.g += c.g;
      if (c.n > out.n || (c.n === out.n && c.n > 0 && c.ts < out.ts)) { out.n = c.n; out.ts = c.ts; }
      if (c.v > out.v) out.v = c.v;
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
          data = mergeBreakout(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] breakout: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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
  function countGame(key, score, levelNo) {
    var before = totals(key).n;
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // new epoch after a reset
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    var c = row.s[key] || { n: 0, ts: 0, v: 1, g: 0 };
    c = { n: c.n, ts: c.ts, v: Math.max(c.v, levelNo), g: c.g + 1 };
    if (score > c.n) { c.n = score; c.ts = Date.now(); }
    row.s[key] = c;
    data.rows[deviceId] = row;
    data = mergeBreakout(data, data);
    save();
    return score > 0 && score > before;
  }

  // ---------- 4. Device-local prefs + session ----------
  var prefs = { pow: true };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object" && typeof p.pow === "boolean") prefs.pow = p.pow;
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }
  function keyOf(pow) { return pow ? "p1" : "p0"; }

  var game = null;

  function validSession(g) {
    if (!g || typeof g !== "object" || typeof g.pow !== "boolean" || !isInt(g.level) || g.level < 0 ||
        g.level > MAX_LEVEL || !Array.isArray(g.bricks) || g.bricks.length !== BROWS * BCOLS ||
        !isInt(g.score) || g.score < 0 || g.score > MAX_SCORE || !isInt(g.lives) || g.lives < 1 ||
        g.lives > MAX_LIVES || !isNum(g.px) || g.px < 0 || g.px > W || !isNum(g.speed) || g.speed <= 0 ||
        g.speed > MAX_V || !isNum(g.wideT) || g.wideT < 0 || !isNum(g.slowT) || g.slowT < 0 ||
        !Array.isArray(g.caps) || g.caps.length > 40) return false;
    for (var i = 0; i < g.bricks.length; i++) if (!isInt(g.bricks[i]) || g.bricks[i] < 0 || g.bricks[i] > 3) return false;
    if (!bricksLeft(g.bricks)) return false;
    for (i = 0; i < g.caps.length; i++) {
      var c = g.caps[i];
      if (!c || !isNum(c.x) || !isNum(c.y) || "wsl".indexOf(c.k) < 0 || c.k.length !== 1) return false;
    }
    var b = g.ball;
    return !!(b && isNum(b.x) && isNum(b.y) && isNum(b.dx) && isNum(b.dy) && typeof b.stuck === "boolean" &&
      isNum(b.off) && Math.abs(b.dx * b.dx + b.dy * b.dy - 1) < 0.01 && b.x >= 0 && b.x <= W && b.y >= -R && b.y <= H + R);
  }
  function loadSession() {
    try {
      var g = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(g)) {
        return { pow: g.pow, level: g.level, bricks: g.bricks, score: g.score, lives: g.lives, px: g.px,
                 speed: g.speed,
                 ball: { x: g.ball.x, y: g.ball.y, dx: g.ball.dx, dy: g.ball.dy, stuck: g.ball.stuck, off: g.ball.off },
                 wideT: g.wideT, slowT: g.slowT,
                 caps: g.caps.map(function (c) { return { x: c.x, y: c.y, k: c.k }; }), over: false };
      }
    } catch (e) {}
    return null;
  }
  function saveSession() {
    try {
      if (game && !game.over && (state === "run" || state === "paused" || state === "count")) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(game));
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
  var input = { left: false, right: false, target: null, launch: false };
  var banner = null;           // { text, sub, t0 } level / life message on the canvas
  var lastSave = 0;

  function inProgress() { return state === "run" || state === "paused" || state === "count"; }

  // A game in progress is never lost silently: Undo toast (R14).
  function newGame(announce) {
    var prev = inProgress() && game ? copyGame(game) : null;
    if (inProgress()) pause(true);
    stopLoop();
    closeDialogs();
    game = freshGame(prefs.pow);
    state = "ready";
    banner = null;
    resultPending = false;
    saveSession();
    renderAll();
    if (prev) {
      undoToast(t("toast.newgame"), function () {
        prefs.pow = prev.pow; savePrefs();
        game = prev;
        state = "paused";
        saveSession();
        renderAll();
      });
    } else if (announce) live(t("toast.newgame"));
  }

  function begin(launch) {
    if (state !== "ready") return;
    state = "run";
    input.launch = !!launch;
    banner = { text: t("cv.level", { l: game.level + 1 }), t0: nowMs() };
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
      input.left = input.right = input.launch = false;
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
      input.launch = false;
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

  // Space / click / tap / Up: launch a waiting ball, else nothing.
  function launch() {
    if (state === "ready") { begin(true); return; }
    if (state === "over") { showToast(t("toast.over")); return; }   // R28
    if (state === "run" && game.ball.stuck) input.launch = true;
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
    acc += dt / 1000;
    while (acc >= DT && state === "run") {
      acc -= DT;
      var dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      var res = step(game, { dir: dir, target: dir ? null : input.target, launch: input.launch }, rand);
      if (input.launch && !res.g.ball.stuck) { input.launch = false; banner = null; sfx("paddle"); saveSession(); }
      if (game.ball.stuck && !res.g.ball.stuck) input.launch = false;
      game = res.g;
      afterStep(res.ev);
    }
    if (state === "run" && now - lastSave > 2000) { lastSave = now; saveSession(); }
    draw();
    if (state === "run") raf = requestAnimationFrame(frame);
  }

  function afterStep(ev) {
    if (ev.hits) { sfx(ev.broke ? "break" : "hit"); renderStatus(); }
    else if (ev.paddle) sfx("paddle");
    else if (ev.wall) sfx("wall");
    if (ev.caught) { sfx("power"); live(t("cap." + ev.caught)); banner = { text: t("cap." + ev.caught), t0: nowMs(), short: true }; renderStatus(); }
    if (ev.over) { finish(); return; }
    if (ev.cleared) {
      sfx("level");
      live(t("live.level", { l: game.level + 1 }));
      banner = { text: t("cv.level", { l: game.level + 1 }), t0: nowMs() };
      saveSession();
      renderStatus();
    } else if (ev.lost) {
      sfx("lost");
      live(game.lives === 1 ? t("live.lost1") : t("live.lost", { n: game.lives }));
      banner = { text: t("cv.lives", { n: game.lives }), t0: nowMs() };
      saveSession();
      renderStatus();
    }
  }

  function finish() {
    stopLoop();
    input.left = input.right = input.launch = false;
    state = "over";
    var rec = countGame(keyOf(game.pow), game.score, game.level + 1);
    saveSession();
    renderAll();
    live(t("live.over", { s: fmt(game.score) }));
    sfx("over");
    lastRec = rec;
    resultPending = true;
    resultTimer = setTimeout(resultDialog, 700);
  }

  // ---------- 6. Render ----------
  function renderAll() {
    renderToolbar();
    renderStatus();
    renderOverlay();
    draw();
  }

  function renderToolbar() {
    var pow = game ? game.pow : prefs.pow;
    [].forEach.call(document.querySelectorAll("#pow-seg .seg-btn"), function (b) {
      var on = (b.getAttribute("data-pow") === "1") === pow;
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
    $("best").textContent = fmt(totals(keyOf(game.pow)).n);
    var msg, run = t("turn.run", { l: game.level + 1, n: game.lives });
    if (state === "run" || state === "count") msg = run;
    else if (state === "paused") msg = t("turn.paused") + " · " + run;
    else if (state === "over") msg = t("turn.over");
    else msg = t("turn.ready");
    $("turn").textContent = msg;
    $("turn").className = state === "over" ? "done" : "";
    $("board").setAttribute("aria-label", t("board.label", { l: game.level + 1, b: bricksLeft(game.bricks) }));
  }

  var coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  function renderOverlay() {
    var ov = $("overlay"), sb = $("start-btn"), cn = $("count"), hint = $("hint");
    ov.hidden = state === "run";
    $("field").classList.toggle("idle", state !== "run");
    cn.hidden = state !== "count";
    cn.textContent = state === "count" ? String(countN) : "";
    sb.hidden = state === "count";
    var label = state === "over" ? "btn.again" : (state === "ready" ? "btn.start" : "btn.go");
    sb.innerHTML = UI_ICONS.play + "<span>" + t(label) + "</span>" +
      (coarse ? "" : (state === "paused" ? "<kbd>P</kbd>" : "<kbd>Space</kbd>"));
    hint.hidden = !(state === "ready" || state === "paused");
    hint.textContent = state === "ready" ? t(coarse ? "hint.readyTouch" : "hint.ready") : t("hint.paused");
  }

  var scale = 1;               // CSS px per logical unit
  function layoutBoard() {
    var wrap = $("board-wrap"), field = $("field");
    var cs = getComputedStyle(wrap);
    var aw = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2;
    var ah = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 2;
    if (aw <= 0 || ah <= 0) return;
    scale = Math.max(0.4, Math.min(aw / W, ah / H, 1.4));
    var fw = Math.floor(W * scale), fh = Math.floor(H * scale);
    scale = fw / W;
    field.style.setProperty("--fw", fw + "px");
    field.style.setProperty("--fh", fh + "px");
    var cv = $("board"), dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(fw * dpr);
    cv.height = Math.round(fh * dpr);
    cv.style.width = fw + "px";
    cv.style.height = fh + "px";
    draw();
  }

  var COLORS = {};
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ["--accent", "--accent-hover", "--panel-bg", "--bg-desktop", "--border", "--text-dim", "--text", "--bg",
     "--danger", "--br1", "--br2", "--br3", "--cap-slow"].forEach(function (v) {
      COLORS[v] = cs.getPropertyValue(v).trim();
    });
  }

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
  var BRICK_FALLBACK = ["#4fa3e0", "#e8a33a", "#d9576b"];

  // Draw in logical units; the transform scales to CSS px × devicePixelRatio.
  function draw() {
    var cv = $("board");
    if (!cv || !game || !cv.width) return;
    var ctx = cv.getContext("2d"), k = cv.width / W;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = COLORS["--bg-desktop"] || "#1a1712";
    ctx.fillRect(0, 0, W, H);
    // bricks (colour by hits left; a hit 3-brick shows a crack)
    for (var r = 0; r < BROWS; r++) for (var c = 0; c < BCOLS; c++) {
      var v = game.bricks[r * BCOLS + c];
      if (!v) continue;
      var x = BLEFT + c * BW, y = BTOP + r * BH;
      ctx.fillStyle = COLORS["--br" + v] || BRICK_FALLBACK[v - 1];
      rr(ctx, x + 1.5, y + 1.5, BW - 3, BH - 3, 3);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(x + 4, y + 3, BW - 8, 3);
      if (v >= 2) {
        ctx.fillStyle = "rgba(0,0,0,0.22)";
        for (var d = 0; d < v; d++) ctx.fillRect(x + BW / 2 - (v - 1) * 4 + d * 8 - 1.5, y + BH / 2, 3, 3);
      }
    }
    // power-ups
    game.caps.forEach(function (cp) {
      ctx.fillStyle = cp.k === "w" ? (COLORS["--accent"] || "#d4af37") :
        (cp.k === "s" ? (COLORS["--cap-slow"] || "#3fc6d8") : (COLORS["--danger"] || "#e06c75"));
      rr(ctx, cp.x - 16, cp.y - CAP_R, 32, CAP_R * 2, CAP_R);
      ctx.fill();
      ctx.fillStyle = COLORS["--bg"] || "#14120d";
      ctx.font = "800 13px Nunito, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(cp.k === "w" ? "↔" : (cp.k === "s" ? "S" : "+1"), cp.x, cp.y + 1);
    });
    // paddle
    var pw = paddleW(game);
    ctx.fillStyle = COLORS["--accent"] || "#d4af37";
    rr(ctx, game.px - pw / 2, PADDLE_Y, pw, PADDLE_H, PADDLE_H / 2);
    ctx.fill();
    if (game.wideT > 0 && game.wideT < 3 && Math.floor(game.wideT * 4) % 2 === 0) {
      ctx.strokeStyle = COLORS["--text"] || "#f0ead9";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // ball
    ctx.fillStyle = game.slowT > 0 ? (COLORS["--cap-slow"] || "#3fc6d8") : (COLORS["--text"] || "#f0ead9");
    ctx.beginPath();
    ctx.arc(game.ball.x, game.ball.y, R, 0, Math.PI * 2);
    ctx.fill();
    // lives (small balls, bottom left)
    ctx.fillStyle = COLORS["--text-dim"] || "#a89f8a";
    for (var l = 0; l < game.lives; l++) {
      ctx.beginPath();
      ctx.arc(16 + l * 16, H - 14, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // banner (level / lives / power-up) and the launch hint
    if (state === "run" || state === "count" || state === "paused") {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (banner && (!banner.short || nowMs() - banner.t0 < 1500)) {
        ctx.fillStyle = COLORS["--accent"] || "#d4af37";
        ctx.font = "800 " + (banner.short ? 22 : 30) + "px Nunito, system-ui, sans-serif";
        ctx.fillText(banner.text, W / 2, H * 0.55);
      }
      if (game.ball.stuck && state === "run") {
        ctx.fillStyle = COLORS["--text-dim"] || "#a89f8a";
        ctx.font = "700 17px Nunito, system-ui, sans-serif";
        ctx.fillText(t(coarse ? "cv.launchTouch" : "cv.launch"), W / 2, H * 0.55 + 36);
      }
    }
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
  // A records row; ts (when the best was set) shows under the label.
  function statRow(k, v, ts) {
    var r = row(k, v);
    if (ts) r.firstChild.appendChild(el("small", "dlg-date", t("stats.on", { d: dateStr(ts) })));
    return r;
  }
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  // Shown once per game, 0.7 s after the end (Space shows it at once).
  var lastRec = false, resultPending = false, resultTimer = null;
  function resultDialog() {
    clearTimeout(resultTimer);
    if (!resultPending || state !== "over" || !game) return;     // replaced meanwhile
    resultPending = false;
    var s = totals(keyOf(game.pow));
    var dlg = makeDialog("breakout-result");
    dlg.appendChild(el("div", "dlg-title", t("res.title") + " · " + t(game.pow ? "pow.on" : "pow.off")));
    dlg.appendChild(el("div", "dlg-hero", t("res.points", { s: fmt(game.score) })));
    if (lastRec) dlg.appendChild(el("div", "dlg-badge", t("res.record")));
    dlg.appendChild(row(t("res.level"), String(game.level + 1)));
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
    var dlg = makeDialog("breakout-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    [true, false].forEach(function (pow) {
      var s = totals(keyOf(pow));
      if (s.g) empty = false;
      dlg.appendChild(statRow(t(pow ? "pow.on" : "pow.off"), s.g ? fmt(s.n) + " · " + s.v + " · " + fmt(s.g) : "–", s.n ? s.ts : 0));
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
    var dlg = makeDialog("breakout-confirm");
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
    data = mergeBreakout(data, data);
    save();
    renderStatus();
    showToast(t("toast.reset"));
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "breakout", title: String(text) })) return;
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
      if (kind === "paddle") tone(440, 0, 0.05, "square", 0.06);
      else if (kind === "wall") tone(300, 0, 0.03, "square", 0.04);
      else if (kind === "hit") tone(620, 0, 0.05, "triangle", 0.12);
      else if (kind === "break") tone(880, 0, 0.06, "triangle", 0.13);
      else if (kind === "power") { tone(660, 0, 0.08, "sine", 0.14); tone(990, 0.07, 0.12, "sine", 0.12); }
      else if (kind === "lost") { tone(260, 0, 0.12, "triangle", 0.16); tone(180, 0.1, 0.2, "triangle", 0.14); }
      else if (kind === "level") { [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.09, 0.18, "triangle", 0.14); }); }
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
    sfxOff:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>'
  };
  function paintSfxBtn() {
    var b = $("sfx-btn"), on = sfxOn();
    b.innerHTML = on ? UI_ICONS.sfxOn : UI_ICONS.sfxOff;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.setAttribute("aria-label", t(on ? "btn.sfxOn" : "btn.sfxOff"));
    b.title = t(on ? "btn.sfxOn" : "btn.sfxOff");
  }

  // ---------- 10. Input ----------
  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;   // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      var code = e.code, a = document.activeElement, busy = state === "run" || state === "count";
      if (code === "ArrowLeft" || code === "KeyA" || code === "ArrowRight" || code === "KeyD") {
        e.preventDefault();
        if (state === "ready") begin(false);
        else if (state === "over") { if (!e.repeat) showToast(t("toast.over")); return; }
        if (code === "ArrowLeft" || code === "KeyA") input.left = true; else input.right = true;
        input.target = null;
        return;
      }
      if (e.repeat) return;
      if (code === "ArrowUp" || code === "KeyW") { e.preventDefault(); launch(); return; }
      if (code === "KeyN") { e.preventDefault(); newGame(true); return; }
      if (code === "KeyP" || code === "Escape") { e.preventDefault(); togglePause(); return; }
      if (code === "Space" || code === "Enter") {
        // a focused toolbar or dialog button keeps its own Space / Enter
        if (a && a.tagName === "BUTTON" && a.id !== "start-btn" && !busy) return;
        e.preventDefault();
        if (a && a.tagName === "BUTTON") a.blur();
        if (state === "run") { if (game.ball.stuck) launch(); else pause(); }
        else if (state === "paused") resume();
        else if (state === "over") { if (resultPending) resultDialog(); else newGame(false); }
        else if (state === "ready") begin(true);
      }
    });
    document.addEventListener("keyup", function (e) {
      if (e.code === "ArrowLeft" || e.code === "KeyA") input.left = false;
      else if (e.code === "ArrowRight" || e.code === "KeyD") input.right = false;
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

  // Mouse: the paddle follows the pointer over the field, a click
  // launches. Touch / pen: drag anywhere (the paddle moves with the
  // finger, not under it), a tap launches.
  var drag = null;
  function logicalX(e) {
    var r = $("board").getBoundingClientRect();
    return (e.clientX - r.left) / r.width * W;
  }
  function wirePointer() {
    var field = $("field");
    field.addEventListener("pointermove", function (e) {
      if (state !== "run") return;
      if (e.pointerType === "mouse") { input.target = logicalX(e); return; }
      if (!drag || e.pointerId !== drag.id) return;
      var x = logicalX(e);
      if (Math.abs(x - drag.x0) * scale > 6) drag.moved = true;
      input.target = drag.px0 + (x - drag.x0) * 1.2;
    });
    field.addEventListener("pointerdown", function (e) {
      if (e.target.closest && e.target.closest("button")) return;
      if (e.pointerType === "mouse") {
        if (e.button !== 0) return;
        if (state === "run") { input.target = logicalX(e); launch(); }
        else if (state === "ready") begin(true);
        return;
      }
      drag = { id: e.pointerId, x0: logicalX(e), px0: game.px, t: nowMs(), moved: false };
      try { field.setPointerCapture(e.pointerId); } catch (err) {}
    });
    var end = function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var was = drag;
      drag = null;
      input.target = null;
      if (e.type === "pointercancel") return;
      if (!was.moved && nowMs() - was.t < 400) {
        if (state === "ready") begin(true);
        else launch();
      }
    };
    field.addEventListener("pointerup", end);
    field.addEventListener("pointercancel", end);
    field.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") input.target = null; });
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
    api.registerSlice("breakout", sliceGet, sliceSet, STORAGE_KEY, mergeBreakout);
  }

  function sliceGet() {
    return mergeBreakout(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeBreakout(incoming, incoming);
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
  }

  function paintStatic() {
    [["new-btn", "new", "btn.new"], ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    paintSfxBtn();
  }

  // A mode change starts a new game with it (Undo toast if one was on).
  function setPow(pow) {
    if (game && pow === game.pow && state === "ready") return;   // visible active state
    prefs.pow = pow; savePrefs();
    newGame(true);
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#pow-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () { setPow(b.getAttribute("data-pow") === "1"); b.blur(); });
    });
    $("pause-btn").addEventListener("click", function () { togglePause(); $("pause-btn").blur(); });
    $("new-btn").addEventListener("click", function () { newGame(true); $("new-btn").blur(); });
    $("start-btn").addEventListener("click", function () {
      $("start-btn").blur();
      if (state === "over") newGame(false);
      else if (state === "ready") begin(false);
      else resume();
    });
    $("stats-btn").addEventListener("click", statsDialog);
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("break");   // audible confirmation when turned on
    });
    wirePointer();

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
    if (game) { prefs.pow = game.pow; state = "paused"; }
    else { game = freshGame(prefs.pow); state = "ready"; }
    layoutBoard();
    renderAll();
  }

  boot();
})();
