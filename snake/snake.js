// ============================================================
// orOS Snake — App logic (v1.0.0)
// The snake moves on a 20×20 grid; steer it to the fruit, it grows
// by one per fruit. Hitting itself ends the game, and so does a wall
// in Walls mode (No walls: it comes out on the opposite side).
//   - speeds Slow / Normal / Fast, a little faster every 5 fruit
//   - arrows / WASD, swipe on the board, or the D-pad (touch screens)
//   - up to 2 quick turns are queued; a turn straight back is ignored
//   - Space / P pause; hidden → paused; resume after 3-2-1
//   - a game in progress is kept on the device and resumes paused
// Data:
//   - synced slice "snake" (oros-snake-data): per speed × walls the
//     best score (and when) and the games played, as per-device rows
//     (each device only grows its own row; merge = per-row join)
//     + a reset stamp br
//   - device-local (R10): oros-snake-prefs (speed, walls),
//     oros-snake-session (the game in progress), oros-snake-device
//     (row id), oros-snake-sfx (sound on/off)
// Sections:
//   1. Constants, i18n, helpers
//   2. Game model (start, turn queue, step, fruit, tempo)
//   3. Synced data: load / save / normalize / merge (R5, R26)
//   4. Device-local prefs + session
//   5. Game flow (new, start, pause, countdown, loop, finish)
//   6. Render (toolbar, status, overlay, canvas)
//   7. Dialogs (result, records, confirm)
//   8. Toasts
//   9. Sound
//  10. Input (keys, swipe, D-pad, Contract Β)
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-snake-data";
  var PREFS_KEY   = "oros-snake-prefs";
  var SESSION_KEY = "oros-snake-session";
  var DEVICE_KEY  = "oros-snake-device";
  var SFX_KEY     = "oros-snake-sfx";
  var DATA_VER    = 1;

  var N = 20;                                // grid side
  var SPEEDS = ["s", "n", "f"];
  var KEYS = ["sw", "so", "nw", "no", "fw", "fo"];   // speed + w(alls) | o(pen)
  var BASE_MS = { s: 200, n: 140, f: 95 };   // ms per step at the start
  var MAX_SCORE = N * N;
  var SWIPE_PX = 20;
  // 0 up, 1 right, 2 down, 3 left
  var DIRS = [[-1, 0], [0, 1], [1, 0], [0, -1]];

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
      "speed.s": "Slow", "speed.n": "Normal", "speed.f": "Fast",
      "walls.on": "Walls", "walls.off": "No walls",
      "btn.pause": "Pause (Space)", "btn.resume": "Resume (Space)",
      "btn.new": "New game (N)",
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "btn.start": "Start", "btn.again": "Play again",
      "pad.0": "Up", "pad.1": "Right", "pad.2": "Down", "pad.3": "Left",
      "st.score": "Score", "st.best": "Best",
      "turn.ready": "Eat the fruit, don't bite yourself",
      "turn.run": "Length {n}",
      "turn.paused": "Paused",
      "turn.over": "Game over",
      "turn.won": "The board is full!",
      "hint.ready": "Arrow keys, WASD or swipe to start",
      "hint.readyTouch": "Swipe or use the buttons to start",
      "hint.paused": "Paused",
      "board.label": "Snake board, {n} by {n}, {m}",
      "live.start": "Game started",
      "live.paused": "Paused",
      "live.over": "Game over: {s} fruit",
      "res.title": "Game over",
      "res.won": "Board full!",
      "res.fruit": "{s} fruit",
      "res.fruit1": "1 fruit",
      "res.record": "New record!",
      "res.length": "Length",
      "res.best": "Best",
      "res.games": "Games",
      "res.close": "Close",
      "stats.title": "Records",
      "stats.head": "Best · games",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "confirm.reset": "Delete the records on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Records reset",
      "toast.newgame": "New game",
      "toast.undo": "Undo",
      "toast.over": "Game over: start a new game (N)",
      "toast.save": "Could not save: storage is full"
    },
    el: {
      "speed.s": "Αργά", "speed.n": "Κανονικά", "speed.f": "Γρήγορα",
      "walls.on": "Τοίχοι", "walls.off": "Χωρίς τοίχους",
      "btn.pause": "Παύση (Space)", "btn.resume": "Συνέχεια (Space)",
      "btn.new": "Νέο παιχνίδι (N)",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "btn.start": "Έναρξη", "btn.again": "Ξανά",
      "pad.0": "Πάνω", "pad.1": "Δεξιά", "pad.2": "Κάτω", "pad.3": "Αριστερά",
      "st.score": "Φρούτα", "st.best": "Ρεκόρ",
      "turn.ready": "Φάε τα φρούτα, μη δαγκώσεις τον εαυτό σου",
      "turn.run": "Μήκος {n}",
      "turn.paused": "Παύση",
      "turn.over": "Τέλος παιχνιδιού",
      "turn.won": "Γέμισε το πλαίσιο!",
      "hint.ready": "Βέλη, WASD ή swipe για να ξεκινήσεις",
      "hint.readyTouch": "Swipe ή τα κουμπιά για να ξεκινήσεις",
      "hint.paused": "Παύση",
      "board.label": "Πλαίσιο φιδιού, {n} επί {n}, {m}",
      "live.start": "Το παιχνίδι ξεκίνησε",
      "live.paused": "Παύση",
      "live.over": "Τέλος: {s} φρούτα",
      "res.title": "Τέλος παιχνιδιού",
      "res.won": "Γέμισε το πλαίσιο!",
      "res.fruit": "{s} φρούτα",
      "res.fruit1": "1 φρούτο",
      "res.record": "Νέο ρεκόρ!",
      "res.length": "Μήκος",
      "res.best": "Ρεκόρ",
      "res.games": "Παιχνίδια",
      "res.close": "Κλείσιμο",
      "stats.title": "Ρεκόρ",
      "stats.head": "Ρεκόρ · παιχνίδια",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.newgame": "Νέο παιχνίδι",
      "toast.undo": "Αναίρεση",
      "toast.over": "Τέλος: ξεκίνα νέο παιχνίδι (N)",
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

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("snake.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Game model ----------
  // Cells are r * N + c. body[0] is the head.
  function startBody() {
    var r = Math.floor(N / 2), c = Math.floor(N / 2) - 3;
    return [r * N + c, r * N + c - 1, r * N + c - 2];   // length 3, heading right
  }

  // A random free cell for the fruit, or -1 when the board is full.
  function placeFood(body, rnd) {
    var taken = {}, free = [];
    for (var i = 0; i < body.length; i++) taken[body[i]] = true;
    for (var k = 0; k < N * N; k++) if (!taken[k]) free.push(k);
    return free.length ? free[Math.floor(rnd() * free.length)] : -1;
  }

  // Queue a turn: at most 2 waiting; the same direction or straight
  // back (relative to the last queued one) is ignored.
  function queueTurn(queue, dir, d) {
    var last = queue.length ? queue[queue.length - 1] : dir;
    if (d === last || (d + 2) % 4 === last || queue.length >= 2) return queue;
    return queue.concat([d]);
  }

  // Two cells are neighbours (across the edge too when there are no walls).
  function adjacent(a, b, walls) {
    var ar = Math.floor(a / N), ac = a % N, br = Math.floor(b / N), bc = b % N;
    var dr = Math.abs(ar - br), dc = Math.abs(ac - bc);
    if (!walls) { dr = Math.min(dr, N - dr); dc = Math.min(dc, N - dc); }
    return dr + dc === 1;
  }

  // One step. g = { body, dir, queue, food, score, walls, ... }; returns
  // { g: next state, ate, dead, won }. Other fields (speed) carry over.
  // The tail cell is free on the step it moves away (unless the snake
  // grows on that step).
  function step(g, rnd) {
    var queue = g.queue.slice(), dir = queue.length ? queue.shift() : g.dir;
    var head = g.body[0], r = Math.floor(head / N) + DIRS[dir][0], c = head % N + DIRS[dir][1];
    var base = {};
    for (var k in g) if (Object.prototype.hasOwnProperty.call(g, k)) base[k] = g[k];
    base.dir = dir;
    base.queue = queue;
    if (r < 0 || r >= N || c < 0 || c >= N) {
      if (g.walls) return { g: base, ate: false, dead: true, won: false };
      r = (r + N) % N; c = (c + N) % N;
    }
    var ni = r * N + c, ate = ni === g.food;
    var rest = ate ? g.body : g.body.slice(0, -1);
    if (rest.indexOf(ni) >= 0) return { g: base, ate: false, dead: true, won: false };
    var body = [ni].concat(rest), next = {};
    for (k in base) next[k] = base[k];
    next.body = body;
    if (ate) {
      next.score = g.score + 1;
      next.food = placeFood(body, rnd);
    }
    return { g: next, ate: ate, dead: false, won: next.food < 0 };
  }

  // ms per step: 6% faster every 5 fruit, never faster than 60% of the start.
  function tickMs(speed, score) {
    var b = BASE_MS[speed];
    return Math.max(Math.round(b * 0.6), Math.round(b * Math.pow(0.94, Math.floor(score / 5))));
  }

  // ---------- 3. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                       // max-merged
  //   rows: { <deviceId>: { b: <epoch>,
  //                         s: { sw|so|nw|no|fw|fo: { n: best, ts: when, g: games } } } }
  // }
  // Each device only ever writes ITS OWN row; a row counts from epoch b.
  // Merge per row: the newer epoch wins; equal epochs take, per key,
  // the better best (higher n, then the earlier ts) and the higher g.
  // Rows older than br drop. A join (symmetric, associative, idempotent).
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normCell(v) {
    if (!v || typeof v !== "object" || !isInt(v.n) || !isInt(v.ts) || !isInt(v.g) ||
        v.n < 0 || v.n > MAX_SCORE || v.ts < 0 || v.g < 1) return null;
    return { n: v.n, ts: v.ts, g: v.g };
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
    return { n: best.n, ts: best.ts, g: Math.max(a.g, c.g) };
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

  function mergeSnake(A, B) {
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

  // Best score and games played for a key, across every device.
  function totals(key) {
    var out = { n: 0, g: 0 };
    Object.keys(data.rows).forEach(function (id) {
      var c = data.rows[id].s[key];
      if (!c) return;
      out.g += c.g;
      if (c.n > out.n) out.n = c.n;
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
          data = mergeSnake(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] snake: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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
  function countGame(key, score) {
    var before = totals(key).n;
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // new epoch after a reset
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    var c = row.s[key] || { n: 0, ts: 0, g: 0 };
    c = { n: c.n, ts: c.ts, g: c.g + 1 };
    if (score > c.n) { c.n = score; c.ts = Date.now(); }
    row.s[key] = c;
    data.rows[deviceId] = row;
    data = mergeSnake(data, data);
    save();
    return score > 0 && score > before;
  }

  // ---------- 4. Device-local prefs + session ----------
  var prefs = { speed: "n", walls: true };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (SPEEDS.indexOf(p.speed) >= 0) prefs.speed = p.speed;
        if (typeof p.walls === "boolean") prefs.walls = p.walls;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }
  function keyOf(speed, walls) { return speed + (walls ? "w" : "o"); }

  // game = { speed, walls, body[], dir, queue[], food, score }
  var game = null;

  function validSession(g) {
    if (!g || typeof g !== "object" || SPEEDS.indexOf(g.speed) < 0 || typeof g.walls !== "boolean" ||
        !Array.isArray(g.body) || g.body.length < 3 || g.body.length > N * N ||
        !isInt(g.dir) || g.dir < 0 || g.dir > 3 || !isInt(g.food) || g.food < 0 || g.food >= N * N ||
        !isInt(g.score) || g.score !== g.body.length - 3) return false;
    var seen = {};
    for (var i = 0; i < g.body.length; i++) {
      var v = g.body[i];
      if (!isInt(v) || v < 0 || v >= N * N || seen[v]) return false;
      if (i && !adjacent(g.body[i - 1], v, g.walls)) return false;
      seen[v] = true;
    }
    return !seen[g.food];
  }
  function loadSession() {
    try {
      var g = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(g)) { g.queue = []; return g; }
    } catch (e) {}
    return null;
  }
  function saveSession() {
    try {
      if (game && (state === "run" || state === "paused" || state === "count")) {
        localStorage.setItem(SESSION_KEY, JSON.stringify({
          speed: game.speed, walls: game.walls, body: game.body, dir: game.dir,
          food: game.food, score: game.score }));
      } else {
        localStorage.removeItem(SESSION_KEY);
      }
    } catch (e) {}
  }

  // ---------- 5. Game flow ----------
  // state: ready (waiting for the first direction) → run ⇄ paused
  // (resume via count 3-2-1) → over.
  var state = "ready";
  var prevBody = null;      // the body one step ago (for the slide)
  var acc = 0, lastT = 0, raf = 0;
  var countTimer = null, countN = 0;

  function fresh() {
    var body = startBody();
    return { speed: prefs.speed, walls: prefs.walls, body: body, dir: 1, queue: [],
             food: placeFood(body, rand), score: 0 };
  }
  function inProgress() { return state === "run" || state === "paused" || state === "count"; }

  // A game in progress is never lost silently: Undo toast (R14).
  function newGame(announce) {
    var prev = inProgress() && game ? JSON.parse(JSON.stringify(game)) : null;
    if (inProgress()) pause(true);
    stopLoop();
    closeDialogs();
    game = fresh();
    prevBody = null;
    state = "ready";
    saveSession();
    renderAll();
    if (prev) {
      undoToast(t("toast.newgame"), function () {
        prefs.speed = prev.speed; prefs.walls = prev.walls; savePrefs();
        game = prev;
        prevBody = null;
        state = "paused";
        saveSession();
        renderAll();
      });
    } else if (announce) live(t("toast.newgame"));
  }

  // First direction of a ready game: go.
  function begin(d) {
    game.queue = queueTurn([], game.dir, d);
    state = "run";
    saveSession();
    live(t("live.start"));
    startLoop();
    renderAll();
  }

  function turn(d) {
    if (state === "ready") { begin(d); return; }
    if (state === "run") game.queue = queueTurn(game.queue, game.dir, d);
    else if (state === "over") showToast(t("toast.over"));              // R28
    // paused / counting: the overlay says how to go on
  }

  function pause(quiet) {
    if (state === "run") stopLoop();
    if (state === "run" || state === "count") {
      clearTimeout(countTimer);
      state = "paused";
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
    else if (state === "ready" || state === "over") showToast(t(state === "over" ? "toast.over" : "hint.ready"));
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
    var ms = tickMs(game.speed, game.score);
    while (acc >= ms && state === "run") {
      acc -= ms;
      advance();
      ms = tickMs(game.speed, game.score);
    }
    draw(state === "run" ? Math.min(1, acc / ms) : 1);
    if (state === "run") raf = requestAnimationFrame(frame);
  }

  function advance() {
    var res = step(game, rand);
    if (res.dead) { prevBody = null; game = res.g; finish(false); return; }
    prevBody = game.body;
    game = res.g;
    if (res.ate) {
      sfx("eat");
      saveSession();
      renderStatus();
    }
    if (res.won) finish(true);
  }

  function finish(won) {
    stopLoop();
    state = "over";
    var rec = countGame(keyOf(game.speed, game.walls), game.score);
    saveSession();
    renderAll();
    live(t("live.over", { s: game.score }));
    sfx(won ? "win" : "over");
    setTimeout(function () { resultDialog(rec, won); }, 500);
  }

  // ---------- 6. Render ----------
  function renderAll() {
    renderToolbar();
    renderStatus();
    renderOverlay();
    draw(1);
  }

  function renderToolbar() {
    var sp = game ? game.speed : prefs.speed, w = game ? game.walls : prefs.walls;
    [].forEach.call(document.querySelectorAll("#speed-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-speed") === sp;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    [].forEach.call(document.querySelectorAll("#walls-seg .seg-btn"), function (b) {
      var on = (b.getAttribute("data-walls") === "1") === w;
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
    $("score").textContent = String(game.score);
    $("best").textContent = String(totals(keyOf(game.speed, game.walls)).n);
    var msg;
    if (state === "run" || state === "count") msg = t("turn.run", { n: game.body.length });
    else if (state === "paused") msg = t("turn.paused");
    else if (state === "over") msg = t(game.food < 0 ? "turn.won" : "turn.over");
    else msg = t("turn.ready");
    $("turn").textContent = msg;
    $("turn").className = state === "over" ? "done" : "";
    $("board").setAttribute("aria-label", t("board.label", {
      n: N, m: t(game.walls ? "walls.on" : "walls.off") }));
  }

  var coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  function renderOverlay() {
    var ov = $("overlay"), sb = $("start-btn"), cn = $("count"), hint = $("hint");
    ov.hidden = state === "run";
    cn.hidden = state !== "count";
    cn.textContent = state === "count" ? String(countN) : "";
    sb.hidden = !(state === "paused" || state === "over");
    sb.innerHTML = UI_ICONS.play + "<span>" + t(state === "over" ? "btn.again" : "btn.resume").replace(/ \(.*\)$/, "") +
                   "</span>" + (state === "paused" ? "<kbd>Space</kbd>" : "");
    hint.hidden = !(state === "ready" || state === "paused");
    hint.textContent = state === "ready" ? t(coarse ? "hint.readyTouch" : "hint.ready") : t("hint.paused");
  }

  function layoutBoard() {
    var wrap = $("board-wrap"), field = $("field"), pad = $("dpad");
    var cs = getComputedStyle(wrap);
    var W = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var H = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (pad && getComputedStyle(pad).display !== "none") H -= pad.offsetHeight + 10;
    if (W <= 0 || H <= 0) return;
    var size = Math.floor(Math.max(200, Math.min(W, H, 560)));
    size -= size % N;                                        // whole cells
    field.style.setProperty("--size", size + "px");
    var cv = $("board"), dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(size * dpr);
    cv.height = Math.round(size * dpr);
    cv.style.width = size + "px";
    cv.style.height = size + "px";
    draw(1);
  }

  var COLORS = {};
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ["--accent", "--panel-bg", "--bg-desktop", "--border", "--text-dim", "--bg", "--danger"].forEach(function (v) {
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

  // Draw the board; f in [0, 1] is how far the current step has slid.
  function draw(f) {
    var cv = $("board");
    if (!cv || !game || !cv.width) return;
    var ctx = cv.getContext("2d"), S = cv.width, cell = S / N;
    ctx.clearRect(0, 0, S, S);
    // board: soft checker
    ctx.fillStyle = COLORS["--bg-desktop"] || "#1a1712";
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = COLORS["--panel-bg"] || "#1d1a13";
    for (var r = 0; r < N; r++) for (var c = (r % 2); c < N; c += 2) ctx.fillRect(c * cell, r * cell, cell, cell);
    // fruit: an apple (round, a stalk and a leaf)
    if (game.food >= 0) {
      var fx = (game.food % N + 0.5) * cell, fy = (Math.floor(game.food / N) + 0.55) * cell;
      ctx.fillStyle = "#e5534b";
      ctx.beginPath(); ctx.arc(fx, fy, cell * 0.36, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#6b4226"; ctx.lineWidth = Math.max(1, cell * 0.08);
      ctx.beginPath(); ctx.moveTo(fx, fy - cell * 0.3); ctx.lineTo(fx + cell * 0.05, fy - cell * 0.46); ctx.stroke();
      ctx.fillStyle = "#5fb35f";
      ctx.beginPath(); ctx.ellipse(fx + cell * 0.17, fy - cell * 0.4, cell * 0.14, cell * 0.07, -0.5, 0, Math.PI * 2); ctx.fill();
    }
    // snake: tail → head, fading toward the tail
    var body = game.body, len = body.length, slide = !reduced && prevBody && state === "run";
    var accent = COLORS["--accent"] || "#d4af37";
    for (var i = len - 1; i >= 0; i--) {
      var cur = body[i], pr = Math.floor(cur / N), pc = cur % N;
      if (slide && f < 1) {
        var from = i < prevBody.length ? prevBody[i] : cur;
        var fr = Math.floor(from / N), fc = from % N;
        if (Math.abs(fr - pr) + Math.abs(fc - pc) === 1) {       // no slide across an edge
          pr = fr + (pr - fr) * f;
          pc = fc + (pc - fc) * f;
        }
      }
      ctx.globalAlpha = i ? 1 - 0.55 * (i / Math.max(1, len - 1)) : 1;
      ctx.fillStyle = accent;
      var pad = i ? cell * 0.1 : cell * 0.04;
      rr(ctx, pc * cell + pad, pr * cell + pad, cell - 2 * pad, cell - 2 * pad, cell * (i ? 0.25 : 0.35));
      ctx.fill();
      if (!i) {
        // eyes, looking where it goes
        ctx.globalAlpha = 1;
        var d = DIRS[game.dir], cx = (pc + 0.5) * cell, cy = (pr + 0.5) * cell;
        var ox = d[1] * cell * 0.16, oy = d[0] * cell * 0.16, px = -d[0] * cell * 0.18, py = d[1] * cell * 0.18;
        ctx.fillStyle = COLORS["--bg"] || "#14120d";
        [1, -1].forEach(function (s) {
          ctx.beginPath();
          ctx.arc(cx + ox + s * px, cy + oy + s * py, Math.max(1.5, cell * 0.09), 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }
    ctx.globalAlpha = 1;
    if (state === "over" && game.food >= 0) {                  // where it crashed
      var h = body[0];
      ctx.strokeStyle = COLORS["--danger"] || "#e06c75";
      ctx.lineWidth = Math.max(2, cell * 0.12);
      rr(ctx, (h % N) * cell + 1, Math.floor(h / N) * cell + 1, cell - 2, cell - 2, cell * 0.3);
      ctx.stroke();
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
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  function modeName(speed, walls) { return t("speed." + speed) + " · " + t(walls ? "walls.on" : "walls.off"); }

  function resultDialog(rec, won) {
    if (state !== "over" || !game) return;     // replaced meanwhile
    var s = totals(keyOf(game.speed, game.walls));
    var dlg = makeDialog("snake-result");
    dlg.appendChild(el("div", "dlg-title", t(won ? "res.won" : "res.title") + " · " + modeName(game.speed, game.walls)));
    dlg.appendChild(el("div", "dlg-hero", game.score === 1 ? t("res.fruit1") : t("res.fruit", { s: game.score })));
    if (rec) dlg.appendChild(el("div", "dlg-badge", t("res.record")));
    dlg.appendChild(row(t("res.length"), String(game.body.length)));
    dlg.appendChild(row(t("res.best"), String(s.n)));
    dlg.appendChild(row(t("res.games"), String(s.g)));
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
    var dlg = makeDialog("snake-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    [true, false].forEach(function (w) {
      SPEEDS.forEach(function (sp) {
        var s = totals(keyOf(sp, w));
        if (s.g) empty = false;
        dlg.appendChild(row(modeName(sp, w), s.g ? s.n + " · " + s.g : "–"));
      });
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
    var dlg = makeDialog("snake-confirm");
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
    data = mergeSnake(data, data);
    save();
    renderStatus();
    showToast(t("toast.reset"));
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "snake", title: String(text) })) return;
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
      if (kind === "eat") { tone(660, 0, 0.06, "triangle", 0.14); tone(990, 0.05, 0.08, "triangle", 0.12); }
      else if (kind === "over") { [330, 262, 196].forEach(function (f, k) { tone(f, k * 0.12, 0.2, "triangle", 0.16); }); }
      else if (kind === "win") {
        [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
      }
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
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>'
  };
  function paintSfxBtn() {
    var b = $("sfx-btn"), on = sfxOn();
    b.innerHTML = on ? UI_ICONS.sfxOn : UI_ICONS.sfxOff;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.setAttribute("aria-label", t(on ? "btn.sfxOn" : "btn.sfxOff"));
    b.title = t(on ? "btn.sfxOn" : "btn.sfxOff");
  }

  // ---------- 10. Input ----------
  var KEY_DIR = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3,
                  KeyW: 0, KeyD: 1, KeyS: 2, KeyA: 3 };

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;   // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      var d = KEY_DIR[e.code] !== undefined ? KEY_DIR[e.code] : KEY_DIR[e.key];
      if (d !== undefined) { e.preventDefault(); turn(d); return; }
      if (e.repeat) return;
      if (e.code === "KeyN") { e.preventDefault(); newGame(true); return; }
      if (e.code === "KeyP" || e.code === "Space") {
        // a focused toolbar or dialog button keeps its own Space
        var a = document.activeElement;
        if (e.code === "Space" && a && a.tagName === "BUTTON" && a.id !== "start-btn" && a.id !== "pause-btn") return;
        e.preventDefault();
        if (state === "over") newGame(false); else togglePause();
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

  // Swipe anywhere on the board; a short swipe is enough.
  var down = null;
  function wireSwipe() {
    var field = $("field");
    field.addEventListener("pointerdown", function (e) {
      if (e.target.closest && e.target.closest("button")) return;
      down = { x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    field.addEventListener("pointermove", function (e) {
      if (!down || e.pointerId !== down.id) return;
      var dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;
      turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
      down = { x: e.clientX, y: e.clientY, id: e.pointerId };   // a second swipe in the same touch
    });
    var end = function () { down = null; };
    field.addEventListener("pointerup", end);
    field.addEventListener("pointercancel", end);
  }

  function wirePad() {
    [].forEach.call(document.querySelectorAll("#dpad .pad"), function (b) {
      var d = +b.getAttribute("data-d");
      b.innerHTML = UI_ICONS.arrow;
      b.setAttribute("aria-label", t("pad." + d));
      b.addEventListener("pointerdown", function (e) { e.preventDefault(); turn(d); });
      b.addEventListener("click", function (e) { if (e.detail === 0) turn(d); });
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
    draw(1);
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
    api.registerSlice("snake", sliceGet, sliceSet, STORAGE_KEY, mergeSnake);
  }

  function sliceGet() {
    return mergeSnake(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeSnake(incoming, incoming);
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

  // A setting change starts a new game with it (Undo toast if one was on).
  function setMode(speed, walls) {
    if (game && speed === game.speed && walls === game.walls && state !== "over") return;   // visible active state
    prefs.speed = speed; prefs.walls = walls; savePrefs();
    newGame(true);
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#speed-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () { setMode(b.getAttribute("data-speed"), game ? game.walls : prefs.walls); });
    });
    [].forEach.call(document.querySelectorAll("#walls-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () { setMode(game ? game.speed : prefs.speed, b.getAttribute("data-walls") === "1"); });
    });
    $("pause-btn").addEventListener("click", togglePause);
    $("new-btn").addEventListener("click", function () { newGame(true); $("new-btn").blur(); });
    $("start-btn").addEventListener("click", function () { if (state === "over") newGame(false); else resume(); });
    $("stats-btn").addEventListener("click", statsDialog);
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("eat");   // audible confirmation when turned on
    });
    wireSwipe();
    wirePad();

    var relayout = function () { layoutBoard(); };
    if (window.ResizeObserver) new ResizeObserver(relayout).observe($("board-wrap"));
    else window.addEventListener("resize", relayout);

    // Hidden → paused (the game is saved); it waits for Resume.
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") pause();
    });
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
    if (game) { prefs.speed = game.speed; prefs.walls = game.walls; state = "paused"; }
    else { game = fresh(); state = "ready"; }
    layoutBoard();
    renderAll();
  }

  boot();
})();
