// ============================================================
// orOS Pong — App logic (v1.0.0)
// Two paddles, one ball: return it past the other side to score.
// First to 7 points wins (option: 11).
//   - vs Computer (Easy / Medium / Hard) or 2 players on one device
//   - the computer is beatable: it reacts late, aims with an error and
//     its paddle has a top speed (lower on the easier levels)
//   - the bounce angle depends on where the ball meets the paddle;
//     every return is a little faster
//   - the serve alternates between the two sides
//   - keys: W / S for the left paddle, ↑ / ↓ for the right one in a
//     2-player game (vs Computer both move yours); the mouse moves
//     your paddle; on a touch screen each half drags its own paddle
//   - a tall field (phone) is drawn turned: your paddle at the bottom
//   - P / Space / Esc pause; hidden or blurred → paused; resume 3-2-1
//   - a game in progress is kept on the device and resumes paused
// The physics run in fixed 1/120 s steps (pure functions below) with
// sub-steps of at most 4 units, so the ball never slips through a
// paddle; requestAnimationFrame only feeds time and draws.
// Data:
//   - synced slice "pong" (oros-pong-data): per computer level the
//     wins, losses and best winning margin (and when), and the 2-player
//     games played, as per-device rows (each device only grows its own
//     row; merge = per-row join) + a reset stamp br
//   - device-local (R10): oros-pong-prefs (mode, level, points),
//     oros-pong-session (the game in progress), oros-pong-device
//     (row id), oros-pong-sfx (sound on/off)
// Sections:
//   1. Constants, i18n, helpers
//   2. Game model (serve, paddles, computer, ball physics, points)
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

  var STORAGE_KEY = "oros-pong-data";
  var PREFS_KEY   = "oros-pong-prefs";
  var SESSION_KEY = "oros-pong-session";
  var DEVICE_KEY  = "oros-pong-device";
  var SFX_KEY     = "oros-pong-sfx";
  var DATA_VER    = 1;

  var LEVELS = ["e", "m", "h"];
  var MODES = ["e", "m", "h", "2"];          // a computer level, or 2 players
  var TOS = [7, 11];                         // points to win
  var W = 800, H = 500;                      // logical field (paddles left / right)
  var PX = 24, PW = 14, PH = 90;             // paddle: distance from the edge, width, height
  var BR = 8;                                // ball radius
  var DT = 1 / 120;                          // one physics step (s)
  var SUB = 4;                               // max units per sub-step (< PW)
  var SERVE_V = 420, MAX_V = 1150, HIT_UP = 1.06;
  var MAX_BOUNCE = Math.PI * 0.3;            // 54° off straight at the paddle end
  var SERVE_ANGLE = Math.PI / 6;             // serves leave within ±30°
  var KEY_V = 600;                           // paddle by keys, units / s
  var PTR_V = 2400;                          // paddle following a pointer, units / s
  var WAIT = 0.9;                            // pause before each serve (s)
  // The computer: it looks again every `react` s, aims with an error up
  // to ±err, moves at most v units / s; Easy follows the ball, Medium
  // and Hard work out where it will arrive (walls included).
  var AI = {
    e: { react: 0.32, err: 70, v: 300, predict: false },
    m: { react: 0.2,  err: 32, v: 450, predict: true },
    h: { react: 0.11, err: 22, v: 560, predict: true }
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
      "mode.ai": "vs Computer", "mode.duo": "2 players",
      "level.e": "Easy", "level.m": "Medium", "level.h": "Hard",
      "to.n": "To {n}",
      "btn.pause": "Pause (P)", "btn.resume": "Resume (P)",
      "btn.new": "New game (N)",
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "btn.start": "Start", "btn.again": "Play again", "btn.go": "Resume",
      "who.you": "You", "who.cpu": "Computer", "who.p1": "Player 1", "who.p2": "Player 2",
      "turn.ready": "First to {n} wins",
      "turn.run": "First to {n}",
      "turn.paused": "Paused",
      "turn.over": "{w} won",
      "hint.ready": "W / S, ↑ / ↓ or the mouse move your paddle\nP or Space pause",
      "hint.readyDuo": "Left paddle: W / S\nRight paddle: ↑ / ↓\nP or Space pause",
      "hint.readyTouch": "Drag on the field to move your paddle",
      "hint.readyDuoTouch": "Each player drags on their own half",
      "hint.readyRot": "A / D, ← / → or the mouse move your paddle\nP or Space pause",
      "hint.readyDuoRot": "Bottom paddle: A / D\nTop paddle: ← / →\nP or Space pause",
      "hint.paused": "Paused",
      "board.label": "Pong field, {a} {s0}, {b} {s1}",
      "live.start": "Game started",
      "live.paused": "Paused",
      "live.point": "Point for {w}: {s0} to {s1}",
      "live.over": "{w} won {s0} to {s1}",
      "res.won": "You won!",
      "res.lost": "The computer won",
      "res.duo": "{w} won!",
      "res.record": "Best margin!",
      "res.margin": "Margin",
      "res.wl": "Wins · losses",
      "res.best": "Best margin",
      "res.games": "Games",
      "res.close": "Close",
      "stats.title": "Records",
      "stats.head": "vs Computer: wins · losses · best margin",
      "stats.duo": "2 players",
      "stats.games": "Games played",
      "stats.reset": "Reset records",
      "stats.close": "Close",
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
      "mode.ai": "Με υπολογιστή", "mode.duo": "2 παίκτες",
      "level.e": "Εύκολο", "level.m": "Μεσαίο", "level.h": "Δύσκολο",
      "to.n": "Στους {n}",
      "btn.pause": "Παύση (P)", "btn.resume": "Συνέχεια (P)",
      "btn.new": "Νέο παιχνίδι (N)",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "btn.start": "Έναρξη", "btn.again": "Ξανά", "btn.go": "Συνέχεια",
      "who.you": "Εσύ", "who.cpu": "Υπολογιστής", "who.p1": "Παίκτης 1", "who.p2": "Παίκτης 2",
      "turn.ready": "Κερδίζει όποιος φτάσει πρώτος στους {n}",
      "turn.run": "Μέχρι τους {n}",
      "turn.paused": "Παύση",
      "turn.over": "Νίκη: {w}",
      "hint.ready": "W / S, ↑ / ↓ ή το ποντίκι κινούν τη ρακέτα σου\nP ή Space για παύση",
      "hint.readyDuo": "Αριστερή ρακέτα: W / S\nΔεξιά ρακέτα: ↑ / ↓\nP ή Space για παύση",
      "hint.readyTouch": "Σύρε το δάχτυλο στο γήπεδο για να κινήσεις τη ρακέτα σου",
      "hint.readyDuoTouch": "Κάθε παίκτης σέρνει το δάχτυλο στο δικό του μισό",
      "hint.readyRot": "A / D, ← / → ή το ποντίκι κινούν τη ρακέτα σου\nP ή Space για παύση",
      "hint.readyDuoRot": "Κάτω ρακέτα: A / D\nΕπάνω ρακέτα: ← / →\nP ή Space για παύση",
      "hint.paused": "Παύση",
      "board.label": "Γήπεδο πινγκ πονγκ, {a} {s0}, {b} {s1}",
      "live.start": "Το παιχνίδι ξεκίνησε",
      "live.paused": "Παύση",
      "live.point": "Πόντος για {w}: {s0} – {s1}",
      "live.over": "Νίκη για {w}: {s0} – {s1}",
      "res.won": "Κέρδισες!",
      "res.lost": "Κέρδισε ο υπολογιστής",
      "res.duo": "Νίκη για {w}!",
      "res.record": "Καλύτερη διαφορά!",
      "res.margin": "Διαφορά",
      "res.wl": "Νίκες · ήττες",
      "res.best": "Καλύτερη διαφορά",
      "res.games": "Παιχνίδια",
      "res.close": "Κλείσιμο",
      "stats.title": "Ρεκόρ",
      "stats.head": "Με υπολογιστή: νίκες · ήττες · καλύτερη διαφορά",
      "stats.duo": "2 παίκτες",
      "stats.games": "Παιχνίδια",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
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

  function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function dateStr(ts) {
    try {
      return new Date(ts).toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB",
        { day: "numeric", month: "short", year: "numeric" });
    } catch (e) { return ""; }
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("pong.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Game model ----------
  // g = { mode (e|m|h computer level, 2 = two players), to (7 | 11),
  //       s [left, right] points, py [left, right] paddle centres,
  //       ball { x, y, vx, vy } (units / s), v (ball speed),
  //       wait (s before the serve), serve (0 left | 1 right serves),
  //       rally (returns this point), ai { t (s to its next look), ty (aim) },
  //       over, winner (-1 | 0 | 1) }
  // Paddle 0 is on the left (you / player 1), paddle 1 on the right.
  // Every function returns a new object; the inputs stay untouched.

  function freshGame(mode, to, first) {
    return { mode: mode, to: to, s: [0, 0], py: [H / 2, H / 2],
             ball: { x: W / 2, y: H / 2, vx: 0, vy: 0 }, v: SERVE_V,
             wait: WAIT, serve: first ? 1 : 0, rally: 0, ai: { t: 0, ty: H / 2 },
             over: false, winner: -1 };
  }

  function copyGame(g) {
    var o = {};
    for (var k in g) if (Object.prototype.hasOwnProperty.call(g, k)) o[k] = g[k];
    o.s = g.s.slice();
    o.py = g.py.slice();
    o.ball = { x: g.ball.x, y: g.ball.y, vx: g.ball.vx, vy: g.ball.vy };
    o.ai = { t: g.ai.t, ty: g.ai.ty };
    return o;
  }

  function clampPaddle(y) { return Math.max(PH / 2, Math.min(H - PH / 2, y)); }

  // The serving side sends the ball from the centre toward the other
  // side, up to 30° off straight.
  function serveDir(serve, rnd) {
    var a = (rnd() * 2 - 1) * SERVE_ANGLE, sign = serve === 0 ? 1 : -1;
    return { vx: sign * Math.cos(a), vy: Math.sin(a) };
  }

  // Where a ball at (x, y) moving (vx, vy) crosses the line at tx,
  // bouncing off the top and bottom walls on the way; b = wall bounces.
  function predictY(x, y, vx, vy, tx) {
    return predictHit(x, y, vx, vy, tx).y;
  }
  function predictHit(x, y, vx, vy, tx) {
    if (!vx) return { y: y, b: 0 };
    var tt = (tx - x) / vx, yy = y + vy * tt - BR, span = H - 2 * BR;
    var m = ((yy % (2 * span)) + 2 * span) % (2 * span);
    var bounces = Math.abs(Math.floor(yy / span));
    if (m > span) m = 2 * span - m;
    return { y: m + BR, b: bounces };
  }

  // Direction after paddle `side`: rel = -1 (top end) … 1 (bottom end).
  function paddleBounce(side, rel) {
    var a = Math.max(-1, Math.min(1, rel)) * MAX_BOUNCE;
    return { vx: (side === 0 ? 1 : -1) * Math.cos(a), vy: Math.sin(a) };
  }

  // The computer's paddle (right) for one step: every `react` s it
  // picks an aim (where the ball will come, plus an error that grows
  // with the ball's speed and the wall bounces on its way; the middle
  // while the ball goes away), then moves there at its top speed.
  function aiMove(n, rnd) {
    var p = AI[n.mode], b = n.ball;
    n.ai.t -= DT;
    if (n.ai.t <= 0) {
      n.ai.t += p.react;
      if (n.ai.t <= 0) n.ai.t = p.react;
      var err = (rnd() * 2 - 1) * p.err;
      if (n.wait <= 0 && b.vx > 0) {
        var ph = predictHit(b.x, b.y, b.vx, b.vy, W - PX - PW - BR);
        n.ai.ty = (p.predict ? ph.y : b.y) + err * (n.v / SERVE_V) * (1 + 0.5 * ph.b);
      } else n.ai.ty = H / 2 + err / 2;
    }
    var d = n.ai.ty - n.py[1], lim = p.v * DT;
    if (Math.abs(d) > 2) n.py[1] = clampPaddle(n.py[1] + Math.max(-lim, Math.min(lim, d)));
  }

  // A point for side p: the next serve is the other side's, or the game ends.
  function scorePoint(n, p, ev) {
    n.s[p]++;
    ev.point = p;
    n.rally = 0;
    n.ball = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
    n.v = SERVE_V;
    if (n.s[p] >= n.to) {
      n.over = true;
      n.winner = p;
      ev.over = true;
      return;
    }
    n.serve = 1 - n.serve;
    n.wait = WAIT;
    n.ai.t = 0;
  }

  // One physics step of DT seconds.
  // inp = { dir: [left, right] (-1 up | 0 | 1 down, keys),
  //         target: [left, right] (y | null, pointer) }; vs Computer the
  //         right paddle ignores inp and plays by itself.
  // Returns { g, ev: { wall, hit (-1 | 0 | 1 paddle), point (-1 | 0 | 1),
  //           serve, over } }.
  function step(g, inp, rnd) {
    var ev = { wall: false, hit: -1, point: -1, serve: false, over: false };
    if (g.over) return { g: g, ev: ev };
    var n = copyGame(g), i;
    for (i = 0; i < 2; i++) {
      if (i === 1 && n.mode !== "2") { aiMove(n, rnd); continue; }
      var tg = inp.target ? inp.target[i] : null, dir = inp.dir ? inp.dir[i] : 0;
      if (dir) n.py[i] += dir * KEY_V * DT;
      else if (isNum(tg)) {
        var d = tg - n.py[i], lim = PTR_V * DT;
        n.py[i] += Math.max(-lim, Math.min(lim, d));
      }
      n.py[i] = clampPaddle(n.py[i]);
    }
    if (n.wait > 0) {
      n.wait = Math.max(0, n.wait - DT);
      if (n.wait > 0) return { g: n, ev: ev };
      var sd = serveDir(n.serve, rnd);
      n.ball = { x: W / 2, y: H / 2, vx: sd.vx * n.v, vy: sd.vy * n.v };
      ev.serve = true;
      return { g: n, ev: ev };
    }
    var b = n.ball, dist = n.v * DT, subs = Math.max(1, Math.ceil(dist / SUB));
    var face0 = PX + PW, face1 = W - PX - PW;
    for (var k = 0; k < subs; k++) {
      var px = b.x, pyb = b.y;
      b.x += b.vx * DT / subs;
      b.y += b.vy * DT / subs;
      // walls: reflect (the overshoot too, so the path stays exact;
      // the previous point is mirrored with it for the paddle check)
      if (b.y - BR < 0) { b.y = 2 * BR - b.y; b.vy = Math.abs(b.vy); ev.wall = true; pyb = 2 * BR - pyb; }
      else if (b.y + BR > H) { b.y = 2 * (H - BR) - b.y; b.vy = -Math.abs(b.vy); ev.wall = true; pyb = 2 * (H - BR) - pyb; }
      // a paddle: only the ball crossing its face, coming toward it;
      // checked where it crosses the face line
      var side = -1, fx = 0;
      if (b.vx < 0 && px - BR >= face0 - 1e-9 && b.x - BR < face0) { side = 0; fx = face0 + BR; }
      else if (b.vx > 0 && px + BR <= face1 + 1e-9 && b.x + BR > face1) { side = 1; fx = face1 - BR; }
      if (side >= 0) {
        var yc = b.x === px ? b.y : pyb + (b.y - pyb) * (fx - px) / (b.x - px);
        if (Math.abs(yc - n.py[side]) > PH / 2 + BR) side = -1;
        else { b.x = fx; b.y = Math.max(BR, Math.min(H - BR, yc)); }
      }
      if (side >= 0) {
        n.v = Math.min(MAX_V, n.v * HIT_UP);
        var nd = paddleBounce(side, (b.y - n.py[side]) / (PH / 2 + BR));
        b.vx = nd.vx * n.v; b.vy = nd.vy * n.v;
        n.rally++;
        ev.hit = side;
        continue;
      }
      if (b.x < -BR) { scorePoint(n, 1, ev); break; }
      if (b.x > W + BR) { scorePoint(n, 0, ev); break; }
    }
    return { g: n, ev: ev };
  }

  // ---------- 3. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                       // max-merged
  //   rows: { <deviceId>: { b: <epoch>,
  //                         s: { e|m|h: { w: wins, l: losses, m: best margin, ts: when },
  //                              p2: { g: 2-player games } } } }
  // }
  // Each device only ever writes ITS OWN row; a row counts from epoch b.
  // Merge per row: the newer epoch wins; equal epochs take, per key,
  // the higher w, l, g and the better margin (higher m, then the
  // earlier ts). Rows older than br drop. A join (symmetric,
  // associative, idempotent).
  var data = null;
  var deviceId = null;
  var MAX_TO = 11, MAX_N = 999999;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normCell(k, v) {
    if (!v || typeof v !== "object") return null;
    if (k === "p2") return (isInt(v.g) && v.g >= 1 && v.g <= MAX_N) ? { g: v.g } : null;
    if (!isInt(v.w) || !isInt(v.l) || !isInt(v.m) || !isInt(v.ts) || v.w < 0 || v.l < 0 ||
        v.w > MAX_N || v.l > MAX_N || v.w + v.l < 1 || v.m < 0 || v.m > MAX_TO || v.ts < 0 ||
        (v.m > 0 && v.w < 1)) return null;
    return { w: v.w, l: v.l, m: v.m, ts: v.ts };
  }

  function normRow(row) {
    if (!row || typeof row !== "object" || !isInt(row.b) || row.b < 0) return null;
    var s = {}, any = false;
    LEVELS.concat(["p2"]).forEach(function (k) {
      var c = normCell(k, row.s && row.s[k]);
      if (c) { s[k] = c; any = true; }
    });
    return any ? { b: row.b, s: s } : null;
  }

  function joinCell(k, a, c) {
    if (k === "p2") return { g: Math.max(a.g, c.g) };
    var best = (a.m !== c.m) ? (a.m > c.m ? a : c) : (a.ts <= c.ts ? a : c);
    return { w: Math.max(a.w, c.w), l: Math.max(a.l, c.l), m: best.m, ts: best.ts };
  }

  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var s = {};
    LEVELS.concat(["p2"]).forEach(function (k) {
      var a = x.s[k], c = y.s[k];
      if (!a && !c) return;
      s[k] = (a && c) ? joinCell(k, a, c) : normCell(k, a || c);
    });
    return { b: x.b, s: s };
  }

  function mergePong(A, B) {
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
      LEVELS.concat(["p2"]).forEach(function (k) { if (r.s[k]) s[k] = r.s[k]; });
      sorted[id] = { b: r.b, s: s };
    });
    return { ver: DATA_VER, br: br, rows: sorted };
  }

  // Wins, losses, best margin (and when) and 2-player games, across devices.
  function totals(key) {
    var out = { w: 0, l: 0, m: 0, ts: 0, g: 0 };
    Object.keys(data.rows).forEach(function (id) {
      var c = data.rows[id].s[key];
      if (!c) return;
      if (key === "p2") { out.g += c.g; return; }
      out.w += c.w;
      out.l += c.l;
      if (c.m > out.m || (c.m === out.m && c.m > 0 && c.ts < out.ts)) { out.m = c.m; out.ts = c.ts; }
    });
    if (key !== "p2") out.g = out.w + out.l;
    return out;
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.rows && typeof parsed.rows === "object") {
          data = mergePong(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] pong: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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

  // Counts a finished game; returns true on a new best margin.
  function countGame(g) {
    var key = g.mode === "2" ? "p2" : g.mode;
    var before = totals(key).m;
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // new epoch after a reset
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    var rec = false;
    if (key === "p2") {
      row.s.p2 = { g: (row.s.p2 ? row.s.p2.g : 0) + 1 };
    } else {
      var c = row.s[key] || { w: 0, l: 0, m: 0, ts: 0 }, won = g.winner === 0;
      var margin = g.s[0] - g.s[1];
      c = { w: c.w + (won ? 1 : 0), l: c.l + (won ? 0 : 1), m: c.m, ts: c.ts };
      if (won && margin > c.m) { c.m = margin; c.ts = Date.now(); }
      row.s[key] = c;
      rec = won && margin > before;
    }
    data.rows[deviceId] = row;
    data = mergePong(data, data);
    save();
    return rec;
  }

  // ---------- 4. Device-local prefs + session ----------
  var prefs = { mode: "m", lastLevel: "m", to: 7 };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (MODES.indexOf(p.mode) >= 0) prefs.mode = p.mode;
        if (LEVELS.indexOf(p.lastLevel) >= 0) prefs.lastLevel = p.lastLevel;
        if (TOS.indexOf(p.to) >= 0) prefs.to = p.to;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  var game = null;

  function validSession(g) {
    if (!g || typeof g !== "object" || MODES.indexOf(g.mode) < 0 || TOS.indexOf(g.to) < 0 ||
        !Array.isArray(g.s) || g.s.length !== 2 || !Array.isArray(g.py) || g.py.length !== 2) return false;
    for (var i = 0; i < 2; i++) {
      if (!isInt(g.s[i]) || g.s[i] < 0 || g.s[i] >= g.to) return false;
      if (!isNum(g.py[i]) || g.py[i] < PH / 2 || g.py[i] > H - PH / 2) return false;
    }
    var b = g.ball;
    if (!b || !isNum(b.x) || !isNum(b.y) || !isNum(b.vx) || !isNum(b.vy) ||
        b.x < -BR || b.x > W + BR || b.y < BR - 1 || b.y > H - BR + 1) return false;
    if (!isNum(g.v) || g.v < SERVE_V - 1e-6 || g.v > MAX_V || !isNum(g.wait) || g.wait < 0 || g.wait > WAIT ||
        (g.serve !== 0 && g.serve !== 1) || !isInt(g.rally) || g.rally < 0 ||
        !g.ai || !isNum(g.ai.t) || !isNum(g.ai.ty)) return false;
    // a moving ball goes at the game's speed
    return g.wait > 0 ? true : Math.abs(Math.sqrt(b.vx * b.vx + b.vy * b.vy) - g.v) < 0.01 * g.v;
  }
  function loadSession() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(s)) {
        return { mode: s.mode, to: s.to, s: s.s.slice(), py: s.py.slice(),
                 ball: { x: s.ball.x, y: s.ball.y, vx: s.ball.vx, vy: s.ball.vy }, v: s.v,
                 wait: s.wait, serve: s.serve, rally: s.rally, ai: { t: s.ai.t, ty: s.ai.ty },
                 over: false, winner: -1 };
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
  var keys = {};               // e.code → held
  var target = [null, null];   // pointer aims (logical y)
  var flash = null;            // { side, t0 } the side that scored, for a short glow
  var lastSave = 0;

  function inProgress() { return state === "run" || state === "paused" || state === "count"; }
  function duo(g) { return (g || game).mode === "2"; }
  function who(side, g) {
    return duo(g) ? t(side ? "who.p2" : "who.p1") : t(side ? "who.cpu" : "who.you");
  }

  // A game in progress is never lost silently: Undo toast (R14).
  function newGame(announce) {
    var prev = inProgress() && game ? copyGame(game) : null;
    if (inProgress()) pause(true);
    stopLoop();
    closeDialogs();
    game = freshGame(prefs.mode, prefs.to, false);
    state = "ready";
    flash = null;
    resultPending = false;
    saveSession();
    renderAll();
    if (prev) {
      undoToast(t("toast.newgame"), function () {
        prefs.mode = prev.mode; prefs.to = prev.to;
        if (prev.mode !== "2") prefs.lastLevel = prev.mode;
        savePrefs();
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

  function releaseInput() { keys = {}; target = [null, null]; drags = {}; }

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

  // Held keys → a direction per paddle (-1 up, 1 down). In a turned
  // field left / right on the screen are up / down in the model.
  function keyDirs() {
    var k = keys, up0, dn0, up1, dn1;
    if (rot) {
      up0 = k.KeyA; dn0 = k.KeyD; up1 = k.ArrowLeft; dn1 = k.ArrowRight;
    } else {
      up0 = k.KeyW; dn0 = k.KeyS; up1 = k.ArrowUp; dn1 = k.ArrowDown;
    }
    var d0 = (dn0 ? 1 : 0) - (up0 ? 1 : 0), d1 = (dn1 ? 1 : 0) - (up1 ? 1 : 0);
    if (!duo()) { d0 = d0 || d1; d1 = 0; }   // vs Computer both sets move yours
    return [d0, d1];
  }

  function frame() {
    raf = 0;
    if (state !== "run") return;
    var now = nowMs(), dt = Math.min(250, now - lastT);
    lastT = now;
    acc += dt / 1000;
    var dirs = keyDirs();
    while (acc >= DT && state === "run") {
      acc -= DT;
      var res = step(game, { dir: dirs, target: target }, rand);
      game = res.g;
      afterStep(res.ev);
    }
    if (state === "run" && now - lastSave > 2000) { lastSave = now; saveSession(); }
    draw();
    if (state === "run") raf = requestAnimationFrame(frame);
  }

  function afterStep(ev) {
    if (ev.hit >= 0) sfx("hit");
    else if (ev.wall) sfx("wall");
    if (ev.point < 0) return;
    flash = { side: ev.point, t0: nowMs() };
    renderStatus();
    if (ev.over) { finish(); return; }
    sfx(duo() || ev.point === 0 ? "point" : "miss");
    live(t("live.point", { w: who(ev.point), s0: game.s[0], s1: game.s[1] }));
    saveSession();
  }

  function finish() {
    stopLoop();
    releaseInput();
    state = "over";
    var rec = countGame(game);
    saveSession();
    renderAll();
    live(t("live.over", { w: who(game.winner), s0: game.s[0], s1: game.s[1] }));
    sfx(duo() || game.winner === 0 ? "win" : "lose");
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
    var mode = game ? game.mode : prefs.mode, to = game ? game.to : prefs.to;
    var lv = mode === "2" ? prefs.lastLevel : mode;
    [].forEach.call(document.querySelectorAll("#mode-seg .seg-btn"), function (b) {
      var on = (b.getAttribute("data-mode") === "duo") === (mode === "2");
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-level") === lv;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    $("level-seg").hidden = mode === "2";
    [].forEach.call(document.querySelectorAll("#to-seg .seg-btn"), function (b) {
      var on = +b.getAttribute("data-to") === to;
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
    $("sc0").textContent = String(game.s[0]);
    $("sc1").textContent = String(game.s[1]);
    $("lab0").textContent = who(0);
    $("lab1").textContent = who(1);
    var msg, run = t("turn.run", { n: game.to });
    if (state === "run" || state === "count") msg = run;
    else if (state === "paused") msg = t("turn.paused") + " · " + run;
    else if (state === "over") msg = t("turn.over", { w: who(game.winner) });
    else msg = t("turn.ready", { n: game.to });
    $("turn").textContent = msg;
    $("turn").className = state === "over" ? "done" : "";
    $("board").setAttribute("aria-label", t("board.label", { a: who(0), s0: game.s[0], b: who(1), s1: game.s[1] }));
  }

  var coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  function renderOverlay() {
    var ov = $("overlay"), sb = $("start-btn"), cn = $("count"), hint = $("hint");
    ov.hidden = state === "run";
    $("field").classList.toggle("hide-cursor", state === "run" && !duo());
    cn.hidden = state !== "count";
    cn.textContent = state === "count" ? String(countN) : "";
    sb.hidden = state === "count";
    var label = state === "over" ? "btn.again" : (state === "ready" ? "btn.start" : "btn.go");
    sb.innerHTML = UI_ICONS.play + "<span>" + t(label) + "</span>" +
      (coarse ? "" : (state === "paused" ? "<kbd>P</kbd>" : "<kbd>Space</kbd>"));
    hint.hidden = !(state === "ready" || state === "paused");
    var h = "hint.ready" + (duo() ? "Duo" : "") + (coarse ? "Touch" : (rot ? "Rot" : ""));
    hint.textContent = state === "ready" ? t(h) : t("hint.paused");
  }

  var scale = 1;               // CSS px per logical unit
  var rot = false;             // tall field: drawn turned, paddle 0 at the bottom
  function layoutBoard() {
    var wrap = $("board-wrap"), field = $("field");
    var cs = getComputedStyle(wrap);
    var aw = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2;
    var ah = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 2;
    if (aw <= 0 || ah <= 0) return;
    var wasRot = rot;
    rot = ah > aw * 1.15;
    var lw = rot ? H : W, lh = rot ? W : H;
    scale = Math.max(0.25, Math.min(aw / lw, ah / lh, 1.4));
    var fw = Math.floor(lw * scale), fh = Math.floor(lh * scale);
    scale = fw / lw;
    field.style.setProperty("--fw", fw + "px");
    field.style.setProperty("--fh", fh + "px");
    var cv = $("board"), dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(fw * dpr);
    cv.height = Math.round(fh * dpr);
    cv.style.width = fw + "px";
    cv.style.height = fh + "px";
    if (wasRot !== rot) { keys = {}; renderOverlay(); }
    draw();
  }

  var COLORS = {};
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ["--accent", "--panel-bg", "--bg-desktop", "--border", "--text-dim", "--text", "--bg", "--p2"].forEach(function (v) {
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
  function sideColor(i) { return i ? (COLORS["--p2"] || "#4fc4cf") : (COLORS["--accent"] || "#d4af37"); }

  // Draw in logical units; the transform scales to CSS px × devicePixelRatio
  // (and turns the field when it is tall: logical x runs bottom → top).
  function draw() {
    var cv = $("board");
    if (!cv || !game || !cv.width) return;
    var ctx = cv.getContext("2d"), k = cv.width / (rot ? H : W);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = COLORS["--bg-desktop"] || "#1a1712";
    ctx.fillRect(0, 0, cv.width, cv.height);
    if (rot) ctx.setTransform(0, -k, k, 0, 0, W * k);
    else ctx.setTransform(k, 0, 0, k, 0, 0);
    // a short glow on the side that just scored
    if (flash && !reduced) {
      var age = nowMs() - flash.t0;
      if (age < 600) {
        ctx.globalAlpha = 0.22 * (1 - age / 600);
        ctx.fillStyle = sideColor(flash.side);
        ctx.fillRect(flash.side ? W / 2 : 0, 0, W / 2, H);
        ctx.globalAlpha = 1;
      } else flash = null;
    }
    // the net
    ctx.fillStyle = COLORS["--border"] || "#322d20";
    for (var y = 6; y < H; y += 28) ctx.fillRect(W / 2 - 2, y, 4, 16);
    // big scores, faint, upright on the screen
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.3;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var fs = Math.round(Math.min(cv.width, cv.height) * 0.2);
    ctx.font = "800 " + fs + "px Nunito, system-ui, sans-serif";
    for (var i = 0; i < 2; i++) {
      ctx.fillStyle = sideColor(i);
      var lx = i ? W * 0.75 : W * 0.25, ly = H * 0.5;
      var sx = rot ? ly * k : lx * k, sy = rot ? (W - lx) * k : ly * k;
      if (!rot) sy = H * 0.22 * k;
      ctx.fillText(String(game.s[i]), sx, sy);
    }
    ctx.restore();
    // paddles
    for (i = 0; i < 2; i++) {
      ctx.fillStyle = sideColor(i);
      rr(ctx, i ? W - PX - PW : PX, game.py[i] - PH / 2, PW, PH, PW / 2);
      ctx.fill();
    }
    // ball (blinks while waiting for the serve)
    var b = game.ball, show = !(game.wait > 0 && state === "run" && !reduced && Math.floor(game.wait * 6) % 2);
    if (!game.over && show) {
      ctx.fillStyle = COLORS["--text"] || "#f0ead9";
      ctx.beginPath();
      ctx.arc(b.x, b.y, BR, 0, Math.PI * 2);
      ctx.fill();
      if (game.wait > 0) {          // which way the serve goes
        var dir = game.serve === 0 ? 1 : -1;
        ctx.strokeStyle = COLORS["--text-dim"] || "#a89f8a";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(b.x + dir * 22, b.y - 9);
        ctx.lineTo(b.x + dir * 32, b.y);
        ctx.lineTo(b.x + dir * 22, b.y + 9);
        ctx.stroke();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
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
  function marginStr(s) { return s.m ? "+" + s.m + " · " + dateStr(s.ts) : "–"; }

  // Shown once per game, 0.7 s after the end (Space shows it at once).
  var lastRec = false, resultPending = false, resultTimer = null;
  function resultDialog() {
    clearTimeout(resultTimer);
    if (!resultPending || state !== "over" || !game) return;     // replaced meanwhile
    resultPending = false;
    var dlg = makeDialog("pong-result"), d2 = duo();
    var sub = d2 ? t("mode.duo") : t("level." + game.mode);
    dlg.appendChild(el("div", "dlg-title", sub + " · " + t("to.n", { n: game.to })));
    var hero = d2 ? t("res.duo", { w: who(game.winner) }) : t(game.winner === 0 ? "res.won" : "res.lost");
    dlg.appendChild(el("div", "dlg-hero", hero));
    dlg.appendChild(el("div", "dlg-score", game.s[0] + " – " + game.s[1]));
    if (lastRec) dlg.appendChild(el("div", "dlg-badge", t("res.record")));
    if (d2) {
      dlg.appendChild(row(t("res.games"), String(totals("p2").g)));
    } else {
      var s = totals(game.mode);
      dlg.appendChild(row(t("res.wl"), s.w + " · " + s.l));
      dlg.appendChild(row(t("res.best"), marginStr(s)));
    }
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
    var dlg = makeDialog("pong-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    LEVELS.forEach(function (lv) {
      var s = totals(lv);
      if (s.g) empty = false;
      dlg.appendChild(row(t("level." + lv), s.g ? s.w + " · " + s.l + " · " + marginStr(s) : "–"));
    });
    dlg.appendChild(el("div", "dlg-sub", t("stats.duo")));
    var d = totals("p2");
    if (d.g) empty = false;
    dlg.appendChild(row(t("stats.games"), d.g ? String(d.g) : "–"));
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
    var dlg = makeDialog("pong-confirm");
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
    data = mergePong(data, data);
    save();
    renderStatus();
    showToast(t("toast.reset"));
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "pong", title: String(text) })) return;
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
      if (kind === "hit") tone(480, 0, 0.05, "square", 0.07);
      else if (kind === "wall") tone(320, 0, 0.04, "square", 0.05);
      else if (kind === "point") { tone(660, 0, 0.08, "triangle", 0.14); tone(880, 0.07, 0.12, "triangle", 0.12); }
      else if (kind === "miss") { tone(260, 0, 0.12, "triangle", 0.15); tone(196, 0.1, 0.18, "triangle", 0.13); }
      else if (kind === "win") { [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.1, 0.2, "triangle", 0.14); }); }
      else if (kind === "lose") { [330, 262, 196, 147].forEach(function (f, k) { tone(f, k * 0.13, 0.22, "triangle", 0.16); }); }
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
  var MOVE_CODES = { KeyW: 1, KeyS: 1, KeyA: 1, KeyD: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;   // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      var code = e.code, a = document.activeElement, busy = state === "run" || state === "count";
      if (MOVE_CODES[code]) {
        // a focused toolbar button keeps its arrow keys unless the game runs
        if (a && a.tagName === "BUTTON" && !busy && code.indexOf("Arrow") === 0) return;
        e.preventDefault();
        if (state === "over") { if (!e.repeat) showToast(t("toast.over")); return; }
        if (state === "ready" && !e.repeat) begin();
        keys[code] = true;
        if (!duo()) target[0] = null;
        return;
      }
      if (e.repeat) return;
      if (code === "KeyN") { e.preventDefault(); newGame(true); return; }
      if (code === "KeyP" || code === "Escape") { e.preventDefault(); togglePause(); return; }
      if (code === "Space" || code === "Enter") {
        // a focused toolbar or dialog button keeps its own Space / Enter
        if (a && a.tagName === "BUTTON" && a.id !== "start-btn" && !busy) return;
        e.preventDefault();
        if (a && a.tagName === "BUTTON") a.blur();
        if (state === "run") pause();
        else if (state === "paused") resume();
        else if (state === "over") { if (resultPending) resultDialog(); else newGame(false); }
        else if (state === "ready") begin();
      }
    });
    document.addEventListener("keyup", function (e) { delete keys[e.code]; });

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

  // A pointer on the field → logical { x, y }.
  function logical(e) {
    var r = $("board").getBoundingClientRect(), sx = (e.clientX - r.left) / scale, sy = (e.clientY - r.top) / scale;
    return rot ? { x: W - sy, y: sx } : { x: sx, y: sy };
  }

  // vs Computer: the mouse moves your paddle as it goes over the field;
  // a finger (or a held mouse button) anywhere drags it. 2 players: each
  // pointer drives the paddle of the half it went down on (multi-touch).
  var drags = {};              // pointerId → side
  function wirePointer() {
    var field = $("field");
    field.addEventListener("pointerdown", function (e) {
      if (e.target.closest && e.target.closest("button")) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (state === "ready") { begin(); }
      if (state !== "run") return;
      var p = logical(e), side = duo() ? (p.x < W / 2 ? 0 : 1) : 0;
      drags[e.pointerId] = side;
      target[side] = p.y;
      try { field.setPointerCapture(e.pointerId); } catch (err) {}
    });
    field.addEventListener("pointermove", function (e) {
      if (state !== "run") return;
      var side = drags[e.pointerId];
      if (side === undefined) {
        if (e.pointerType !== "mouse" || duo()) return;
        side = 0;                                  // a hovering mouse vs Computer
      }
      target[side] = logical(e).y;
    });
    var end = function (e) {
      var side = drags[e.pointerId];
      if (side === undefined) return;
      delete drags[e.pointerId];
      if (e.pointerType !== "mouse" || duo()) target[side] = null;
    };
    field.addEventListener("pointerup", end);
    field.addEventListener("pointercancel", end);
    field.addEventListener("pointerleave", function (e) {
      if (e.pointerType === "mouse" && drags[e.pointerId] === undefined && !duo()) target[0] = null;
    });
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
    api.registerSlice("pong", sliceGet, sliceSet, STORAGE_KEY, mergePong);
  }

  function sliceGet() {
    return mergePong(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergePong(incoming, incoming);
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
    [].forEach.call(document.querySelectorAll("#to-seg .seg-btn"), function (b) {
      b.textContent = t("to.n", { n: b.getAttribute("data-to") });
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

  // A setting change starts a new game with it (Undo toast if one was on).
  function setMode(mode, to) {
    if (game && mode === game.mode && to === game.to && state === "ready") return;   // visible active state
    prefs.mode = mode;
    prefs.to = to;
    if (mode !== "2") prefs.lastLevel = mode;
    savePrefs();
    newGame(true);
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#mode-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () {
        setMode(b.getAttribute("data-mode") === "duo" ? "2" : prefs.lastLevel, game ? game.to : prefs.to);
        b.blur();
      });
    });
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () { setMode(b.getAttribute("data-level"), game ? game.to : prefs.to); b.blur(); });
    });
    [].forEach.call(document.querySelectorAll("#to-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () { setMode(game ? game.mode : prefs.mode, +b.getAttribute("data-to")); b.blur(); });
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
      sfx("hit");   // audible confirmation when turned on
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
    if (game) {
      prefs.mode = game.mode; prefs.to = game.to;
      if (game.mode !== "2") prefs.lastLevel = game.mode;
      state = "paused";
    } else { game = freshGame(prefs.mode, prefs.to, false); state = "ready"; }
    layoutBoard();
    renderAll();
  }

  boot();
})();
