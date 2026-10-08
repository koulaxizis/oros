// ============================================================
// orOS Lights Out — App logic (v1.0.0)
// A 5×5 grid of lights. Pressing a light toggles it and its four
// neighbours (up, down, left, right). Turn every light off.
//   - 3 levels by the puzzle's exact minimum number of presses (par):
//     Easy 3–6 · Medium 7–11 · Hard 12–15 (15 is the 5×5 maximum)
//   - puzzles are made by pressing a solved board, so always solvable;
//     the par comes from light chasing over the 32 first rows
//   - Undo (counts as a press), Restart the same puzzle, Hint (one
//     press of a minimum solution; a hinted puzzle sets no records)
//   - presses and time; time runs only while the app is visible
//   - a puzzle in progress is kept on the device and resumes
// Data:
//   - synced slice "lightsout" (oros-lightsout-data): per level the
//     puzzles solved, the perfect solves (presses = par, no hint) and
//     the best time, as per-device rows (each device only grows its own
//     row; merge = per-row join) + a reset stamp br
//   - device-local (R10): oros-lightsout-prefs (level),
//     oros-lightsout-session (the puzzle in progress),
//     oros-lightsout-device (row id), oros-lightsout-sfx (sound on/off)
// Sections:
//   1. Constants, i18n, helpers
//   2. Puzzle model (press, solve, generate)
//   3. Synced data: load / save / normalize / merge (R5, R26)
//   4. Device-local prefs + session
//   5. Game flow (new, press, undo, restart, hint, timer, finish)
//   6. Render (toolbar, status, board)
//   7. Dialogs (result, records, confirm)
//   8. Toasts
//   9. Sound
//  10. Input (keyboard, Contract Β)
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-lightsout-data";
  var PREFS_KEY   = "oros-lightsout-prefs";
  var SESSION_KEY = "oros-lightsout-session";
  var DEVICE_KEY  = "oros-lightsout-device";
  var SFX_KEY     = "oros-lightsout-sfx";
  var DATA_VER    = 1;

  var N = 5;                                 // grid side
  var LEVELS = ["e", "m", "h"];
  var RANGE = { e: [3, 6], m: [7, 11], h: [12, 15] };
  var MAX_MS = 360000000;                    // 100 h: anything above is junk
  var MAX_HIST = 500;                        // undo steps kept

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
      "level.e": "Easy", "level.m": "Medium", "level.h": "Hard",
      "btn.undo": "Undo (U)",
      "btn.hint": "Hint (H)",
      "btn.restart": "Restart this puzzle (R)",
      "btn.new": "New puzzle (N)",
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "st.moves": "Moves", "st.par": "min", "st.time": "Time",
      "turn.start": "Turn all the lights off",
      "turn.left1": "1 light on",
      "turn.left": "{k} lights on",
      "turn.done": "All lights off!",
      "board.label": "Lights, {n} by {n}",
      "cell.on": "Row {r}, column {c}: on",
      "cell.off": "Row {r}, column {c}: off",
      "cell.hint": "{s}, hint: press here",
      "live.done": "Solved in {m} moves",
      "res.title": "Solved",
      "res.perfect": "Perfect!",
      "res.hero": "Well done!",
      "res.moves": "Moves",
      "res.par": "Minimum",
      "res.time": "Time",
      "res.bestT": "Best time",
      "res.solved": "Solved",
      "res.perfects": "Perfect",
      "res.recT": "New best time!",
      "res.hinted": "Solved with a hint: no records this time",
      "res.again": "New puzzle",
      "res.close": "Close",
      "stats.title": "Records",
      "stats.head": "Best time · perfect · solved",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "confirm.reset": "Delete the records on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Records reset",
      "toast.newgame": "New puzzle",
      "toast.restart": "Puzzle restarted",
      "toast.undo": "Undo",
      "toast.noundo": "Nothing to undo",
      "toast.atstart": "Already at the start",
      "toast.hint": "Hint used: this puzzle sets no records",
      "toast.done": "Solved: start a new puzzle (N)",
      "toast.save": "Could not save: storage is full"
    },
    el: {
      "level.e": "Εύκολο", "level.m": "Μεσαίο", "level.h": "Δύσκολο",
      "btn.undo": "Αναίρεση (U)",
      "btn.hint": "Υπόδειξη (H)",
      "btn.restart": "Ξανά από την αρχή (R)",
      "btn.new": "Νέος γρίφος (N)",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "st.moves": "Κινήσεις", "st.par": "ελάχ.", "st.time": "Χρόνος",
      "turn.start": "Σβήσε όλα τα φώτα",
      "turn.left1": "1 φως αναμμένο",
      "turn.left": "{k} φώτα αναμμένα",
      "turn.done": "Έσβησαν όλα!",
      "board.label": "Φώτα, {n} επί {n}",
      "cell.on": "Γραμμή {r}, στήλη {c}: αναμμένο",
      "cell.off": "Γραμμή {r}, στήλη {c}: σβηστό",
      "cell.hint": "{s}, υπόδειξη: πάτα εδώ",
      "live.done": "Λύθηκε σε {m} κινήσεις",
      "res.title": "Λύθηκε",
      "res.perfect": "Τέλεια!",
      "res.hero": "Μπράβο!",
      "res.moves": "Κινήσεις",
      "res.par": "Ελάχιστες",
      "res.time": "Χρόνος",
      "res.bestT": "Καλύτερος χρόνος",
      "res.solved": "Λυμένοι",
      "res.perfects": "Τέλειοι",
      "res.recT": "Νέο ρεκόρ χρόνου!",
      "res.hinted": "Λύθηκε με υπόδειξη: χωρίς ρεκόρ αυτή τη φορά",
      "res.again": "Νέος γρίφος",
      "res.close": "Κλείσιμο",
      "stats.title": "Ρεκόρ",
      "stats.head": "Χρόνος · τέλειοι · λυμένοι",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.newgame": "Νέος γρίφος",
      "toast.restart": "Ο γρίφος ξεκίνησε από την αρχή",
      "toast.undo": "Αναίρεση",
      "toast.noundo": "Δεν υπάρχει κίνηση για αναίρεση",
      "toast.atstart": "Είσαι ήδη στην αρχή",
      "toast.hint": "Υπόδειξη: αυτός ο γρίφος δεν μετράει για ρεκόρ",
      "toast.done": "Λύθηκε: ξεκίνα νέο γρίφο (N)",
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

  // crypto RNG with rejection sampling (same as Dice / Memory / Connect 4)
  function randInt(n) {
    var buf = new Uint32Array(1);
    var lim = 0xFFFFFFFF - (0xFFFFFFFF % n);
    while (true) {
      crypto.getRandomValues(buf);
      if (buf[0] < lim) return buf[0] % n;
    }
  }

  function fmtTime(ms) {
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    var ss = ("0" + (s % 60)).slice(-2);
    return h ? h + ":" + ("0" + m).slice(-2) + ":" + ss : m + ":" + ss;
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("lightsout.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Puzzle model ----------
  // A board is a bit mask: bit r * n + c set = that light is on.
  // A set of presses is a bit mask of the same shape.
  function pressMask(n, i) {
    var r = Math.floor(i / n), c = i % n, m = 1 << i;
    if (r > 0) m |= 1 << (i - n);
    if (r < n - 1) m |= 1 << (i + n);
    if (c > 0) m |= 1 << (i - 1);
    if (c < n - 1) m |= 1 << (i + 1);
    return m;
  }
  function press(lights, n, i) { return lights ^ pressMask(n, i); }

  function bitCount(x) {
    var k = 0;
    while (x) { x &= x - 1; k++; }
    return k;
  }

  // The board that a set of presses makes from all-off (or from `from`).
  function applyPresses(n, presses, from) {
    var s = from || 0;
    for (var i = 0; i < n * n; i++) if (presses >> i & 1) s = press(s, n, i);
    return s;
  }

  // A minimum solution, by light chasing: for every choice of presses
  // in the first row, each light left on in a row is switched off by
  // pressing the cell below it. Whatever stays on in the last row
  // decides whether that first row works. Every solution of the board
  // comes out of exactly one first row, so the fewest presses found
  // is the true minimum. Returns { p: presses mask, k: count } or null
  // (unsolvable). Ties go to the smaller mask, so a board always gets
  // the same answer.
  function solve(lights, n) {
    var best = null;
    for (var f = 0; f < (1 << n); f++) {
      var s = lights, p = 0;
      for (var c = 0; c < n; c++) {
        if (f >> c & 1) { s = press(s, n, c); p |= 1 << c; }
      }
      for (var r = 1; r < n; r++) {
        for (c = 0; c < n; c++) {
          if (s >> ((r - 1) * n + c) & 1) {
            var i = r * n + c;
            s = press(s, n, i);
            p |= 1 << i;
          }
        }
      }
      if (s === 0) {
        var k = bitCount(p);
        if (!best || k < best.k || (k === best.k && p < best.p)) best = { p: p, k: k };
      }
    }
    return best;
  }

  // A puzzle for a level: press k random distinct cells of a dark board
  // (k in the level's range), keep it when its true minimum is in range.
  function generate(n, level) {
    var lo = RANGE[level][0], hi = RANGE[level][1];
    while (true) {
      var k = lo + randInt(hi - lo + 1), cells = [], i;
      for (i = 0; i < n * n; i++) cells.push(i);
      for (i = cells.length - 1; i > 0; i--) {
        var j = randInt(i + 1), x = cells[i]; cells[i] = cells[j]; cells[j] = x;
      }
      var presses = 0;
      for (i = 0; i < k; i++) presses |= 1 << cells[i];
      var lights = applyPresses(n, presses);
      var sol = solve(lights, n);
      if (sol && sol.k >= lo && sol.k <= hi) return { lights: lights, par: sol.k };
    }
  }

  // The cell to press next on a minimum solution (-1 when all off).
  function hintCell(lights, n) {
    var sol = solve(lights, n);
    if (!sol || !sol.p) return -1;
    for (var i = 0; i < n * n; i++) if (sol.p >> i & 1) return i;
    return -1;
  }

  // ---------- 3. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                         // max-merged
  //   rows: { <deviceId>: { b: <epoch>,
  //                         s: { e|m|h: { g: solved, p: perfect, t: best ms (0 none) } } } }
  // }
  // Each device only ever writes ITS OWN row; a row counts from epoch b.
  // Merge per row: the newer epoch wins; equal epochs take, per level,
  // the higher g, the higher p and the lower non-zero t. Rows older
  // than br drop. A join (symmetric, associative, idempotent).
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normCell(v) {
    if (!v || typeof v !== "object" || !isInt(v.g) || !isInt(v.p) || !isInt(v.t) ||
        v.g < 1 || v.p < 0 || v.p > v.g || v.t < 0 || v.t > MAX_MS) return null;
    return { g: v.g, p: v.p, t: v.t };
  }

  function normRow(row) {
    if (!row || typeof row !== "object" || !isInt(row.b) || row.b < 0) return null;
    var s = {}, any = false;
    LEVELS.forEach(function (k) {
      var c = normCell(row.s && row.s[k]);
      if (c) { s[k] = c; any = true; }
    });
    return any ? { b: row.b, s: s } : null;
  }

  function minTime(a, b) { return !a ? b : (!b ? a : Math.min(a, b)); }

  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var s = {};
    LEVELS.forEach(function (k) {
      var a = x.s[k], c = y.s[k];
      if (!a && !c) return;
      if (!a || !c) { s[k] = normCell(a || c); return; }
      s[k] = { g: Math.max(a.g, c.g), p: Math.max(a.p, c.p), t: minTime(a.t, c.t) };
    });
    return { b: x.b, s: s };
  }

  function mergeLightsOut(A, B) {
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
      LEVELS.forEach(function (k) { if (r.s[k]) s[k] = r.s[k]; });
      sorted[id] = { b: r.b, s: s };
    });
    return { ver: DATA_VER, br: br, rows: sorted };
  }

  // Puzzles solved, perfect solves and the best time (0 = none), all devices.
  function totals(key) {
    var out = { g: 0, p: 0, t: 0 };
    Object.keys(data.rows).forEach(function (id) {
      var c = data.rows[id].s[key];
      if (!c) return;
      out.g += c.g;
      out.p += c.p;
      out.t = minTime(out.t, c.t);
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
          data = mergeLightsOut(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] lightsout: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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

  // Counts a solved puzzle. A hinted solve counts as solved only: no
  // perfect, no time. Returns true when it set a new best time.
  function countSolve(key, ms, perfect, timed) {
    var before = totals(key);
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // new epoch after a reset
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    var c = row.s[key] || { g: 0, p: 0, t: 0 };
    ms = Math.max(1, Math.min(MAX_MS, ms));
    row.s[key] = { g: c.g + 1, p: c.p + (perfect ? 1 : 0), t: timed ? minTime(c.t, ms) : c.t };
    data.rows[deviceId] = row;
    data = mergeLightsOut(data, data);
    save();
    return !!timed && (!before.t || ms < before.t);
  }

  // ---------- 4. Device-local prefs + session ----------
  var prefs = { level: "e" };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object" && LEVELS.indexOf(p.level) >= 0) prefs.level = p.level;
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = { level, start, lights (masks), par, moves, ms (time played),
  //          hint (a hint was used), hist: [cells pressed], done }
  var game = null;
  var hintAt = -1;          // the cell the hint marks now (not saved)

  function validSession(g) {
    var full = (1 << (N * N)) - 1;
    if (!g || typeof g !== "object" || LEVELS.indexOf(g.level) < 0 ||
        !isInt(g.start) || g.start <= 0 || g.start > full ||
        !isInt(g.lights) || g.lights < 0 || g.lights > full ||
        !isInt(g.moves) || g.moves < 0 || !isInt(g.ms) || g.ms < 0 || g.ms > MAX_MS ||
        !Array.isArray(g.hist) || g.hist.length > MAX_HIST) return false;
    for (var i = 0; i < g.hist.length; i++) {
      if (!isInt(g.hist[i]) || g.hist[i] < 0 || g.hist[i] >= N * N) return false;
    }
    var sol = solve(g.start, N);
    return !!sol && sol.k === g.par && !!solve(g.lights, N);
  }
  function loadSession() {
    try {
      var g = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(g)) {
        g.hint = g.hint === true;
        g.done = g.lights === 0;
        return g;
      }
    } catch (e) {}
    return null;
  }
  function saveSession() {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(game)); } catch (e) {}
  }

  // ---------- 5. Game flow ----------
  var runFrom = 0;          // performance.now() when the clock last resumed (0: paused)
  var tick = null;

  function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function elapsed() { return game.ms + (runFrom ? Math.round(nowMs() - runFrom) : 0); }

  function clockRuns() {
    return !!(game && !game.done && game.moves > 0 && document.visibilityState !== "hidden");
  }
  // Fold the running time into game.ms and stop or (re)start the clock.
  function syncClock() {
    if (runFrom) { game.ms = Math.min(MAX_MS, elapsed()); runFrom = 0; }
    if (clockRuns()) runFrom = nowMs();
    if (runFrom && !tick) tick = setInterval(renderClock, 500);
    if (!runFrom && tick) { clearInterval(tick); tick = null; }
    renderClock();
  }

  function fresh() {
    var p = generate(N, prefs.level);
    return { level: prefs.level, start: p.lights, lights: p.lights, par: p.par,
             moves: 0, ms: 0, hint: false, hist: [], done: false };
  }
  function inProgress() { return !!(game && !game.done && game.moves > 0); }
  function copy(g) { return JSON.parse(JSON.stringify(g)); }

  // Put back an earlier game (Undo toast of New puzzle / Restart).
  function restore(prev) {
    runFrom = 0;
    prefs.level = prev.level; savePrefs();
    game = prev;
    hintAt = -1;
    saveSession();
    syncClock();
    renderAll(true);
  }

  // A puzzle in progress is never lost silently: Undo toast (R14).
  function newGame(announce) {
    if (game) syncClock();
    var prev = inProgress() ? copy(game) : null;
    runFrom = 0;
    game = fresh();
    hintAt = -1;
    saveSession();
    syncClock();
    renderAll(true);
    if (prev) undoToast(t("toast.newgame"), function () { restore(prev); });
    else if (announce) live(t("toast.newgame"));
  }

  // Back to the puzzle's first board. The time keeps running on an
  // unsolved puzzle; a solved one starts over from zero.
  function restart() {
    if (!game) return;
    if (!game.done && !game.moves) { showToast(t("toast.atstart")); return; }   // R28
    syncClock();
    var prev = inProgress() ? copy(game) : null;
    var wasDone = game.done;
    game.lights = game.start;
    game.moves = 0;
    game.hist = [];
    game.done = false;
    if (wasDone) { game.ms = 0; game.hint = false; }
    hintAt = -1;
    saveSession();
    syncClock();
    renderAll(true);
    if (prev) undoToast(t("toast.restart"), function () { restore(prev); });
    else live(t("toast.restart"));
  }

  // Press cell i (tap, Enter / Space on a focused light).
  function pressCell(i, isUndo) {
    if (!game) return;
    if (game.done) { showToast(t("toast.done")); return; }              // R28
    var first = game.moves === 0;
    game.lights = press(game.lights, N, i);
    game.moves++;
    if (isUndo) game.hist.pop();
    else {
      game.hist.push(i);
      if (game.hist.length > MAX_HIST) game.hist.shift();
    }
    hintAt = -1;
    if (first) syncClock();                    // the clock starts with the first press
    sfx("press");
    if (!game.lights) { finish(); return; }
    saveSession();
    renderAll(false);
  }

  // Undo = press the last cell again: it counts as a press, like on the
  // real toy, so the par comparison stays honest.
  function undo() {
    if (!game) return;
    if (game.done) { showToast(t("toast.done")); return; }
    if (!game.hist.length) { showToast(t("toast.noundo")); return; }   // R28
    pressCell(game.hist[game.hist.length - 1], true);
  }

  function hint() {
    if (!game) return;
    if (game.done) { showToast(t("toast.done")); return; }
    if (!game.hint) {
      game.hint = true;
      saveSession();
      showToast(t("toast.hint"));
    }
    hintAt = hintCell(game.lights, N);
    renderAll(false);
    var cell = $("board").children[hintAt];
    if (cell) { cell.focus(); live(cell.getAttribute("aria-label")); }
  }

  function finish() {
    syncClock();
    game.done = true;
    syncClock();                               // stops the clock at the solve
    var perfect = !game.hint && game.moves === game.par;
    var recT = countSolve(game.level, game.ms, perfect, !game.hint);
    saveSession();
    renderAll(false);
    live(t("live.done", { m: game.moves }));
    sfx("win");
    setTimeout(function () { resultDialog(perfect, recT); }, 650);
  }

  // ---------- 6. Render ----------
  function renderAll(rebuild) {
    renderToolbar();
    renderStatus();
    if (rebuild) buildBoard(); else renderCells();
  }

  function renderToolbar() {
    var lv = game ? game.level : prefs.level;
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-level") === lv;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    $("hint-btn").setAttribute("aria-pressed", game && game.hint && !game.done ? "true" : "false");
    paintSfxBtn();
  }

  function renderClock() {
    if (game) $("time").textContent = fmtTime(elapsed());
  }

  function renderStatus() {
    if (!game) return;
    $("moves").textContent = String(game.moves);
    $("par").textContent = String(game.par);
    renderClock();
    var k = bitCount(game.lights);
    $("turn").textContent = game.done ? t("turn.done") :
      (!game.moves ? t("turn.start") : (k === 1 ? t("turn.left1") : t("turn.left", { k: k })));
    $("turn").className = game.done ? "done" : "";
  }

  function layoutBoard() {
    var wrap = $("board-wrap"), el = $("board");
    var cs = getComputedStyle(wrap);
    var W = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var H = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (W <= 0 || H <= 0) return;
    el.style.setProperty("--size", Math.floor(Math.max(220, Math.min(W, H, 520))) + "px");
  }

  function buildBoard() {
    var el = $("board");
    el.innerHTML = "";
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", t("board.label", { n: N }));
    el.style.setProperty("--n", String(N));
    for (var i = 0; i < N * N; i++) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cell";
      b.setAttribute("data-i", String(i));
      b.tabIndex = -1;
      el.appendChild(b);
    }
    el.classList.add("still");                 // no animation while building
    layoutBoard();
    renderCells();
    void el.offsetWidth;
    el.classList.remove("still");
  }

  function renderCells() {
    var el = $("board");
    el.classList.toggle("over", !!game.done);
    var keep = document.activeElement && document.activeElement.parentNode === el;
    for (var i = 0; i < N * N; i++) {
      var b = el.children[i], on = !!(game.lights >> i & 1);
      b.classList.toggle("on", on);
      b.classList.toggle("hint", i === hintAt);
      var s = t(on ? "cell.on" : "cell.off", { r: Math.floor(i / N) + 1, c: i % N + 1 });
      b.setAttribute("aria-label", i === hintAt ? t("cell.hint", { s: s }) : s);
      // roving tabindex: keep focus where it was, else the centre
      b.tabIndex = (keep ? b === document.activeElement : i === Math.floor(N * N / 2)) ? 0 : -1;
    }
  }

  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 7. Dialogs ----------
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

  function resultDialog(perfect, recT) {
    if (!game || !game.done) return;           // replaced meanwhile
    var s = totals(game.level);
    var dlg = makeDialog("lightsout-result");
    dlg.appendChild(el("div", "dlg-title", t("res.title") + " · " + t("level." + game.level)));
    dlg.appendChild(el("div", "dlg-hero", t(perfect ? "res.perfect" : "res.hero")));
    if (recT) dlg.appendChild(el("div", "dlg-badge", t("res.recT")));
    if (game.hint) dlg.appendChild(el("div", "dlg-note", t("res.hinted")));
    dlg.appendChild(row(t("res.moves"), String(game.moves)));
    dlg.appendChild(row(t("res.par"), String(game.par)));
    dlg.appendChild(row(t("res.time"), fmtTime(game.ms)));
    dlg.appendChild(row(t("res.bestT"), s.t ? fmtTime(s.t) : "–"));
    dlg.appendChild(row(t("res.perfects"), String(s.p)));
    dlg.appendChild(row(t("res.solved"), String(s.g)));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("res.close"), "", function () { dlg.close(); }));
    var again = button(t("res.again"), "primary", function () { dlg.close(); newGame(false); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    again.focus();
  }

  function statsDialog() {
    var dlg = makeDialog("lightsout-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    LEVELS.forEach(function (k) {
      var s = totals(k);
      if (s.g) empty = false;
      dlg.appendChild(row(t("level." + k),
        s.g ? (s.t ? fmtTime(s.t) : "–") + " · " + s.p + " · " + s.g : "–"));
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
    var dlg = makeDialog("lightsout-confirm");
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
    data = mergeLightsOut(data, data);
    save();
    showToast(t("toast.reset"));
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "lightsout", title: String(text) })) return;
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
      if (kind === "press") tone(880, 0, 0.05, "triangle", 0.1);
      else if (kind === "win") {
        [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
      }
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Toolbar icons (R9: injected by JS) ----------
  var UI_ICONS = {
    undo:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    hint:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/></svg>',
    restart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5v14"/><path d="M19 5 9 12l10 7z"/></svg>',
    new:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    stats:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    sfxOn:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    sfxOff:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>'
  };
  function paintSfxBtn() {
    var b = $("sfx-btn"), on = sfxOn();
    b.innerHTML = on ? UI_ICONS.sfxOn : UI_ICONS.sfxOff;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.setAttribute("aria-label", t(on ? "btn.sfxOn" : "btn.sfxOff"));
    b.title = t(on ? "btn.sfxOn" : "btn.sfxOff");
  }

  // ---------- 10. Input ----------
  // Lights are buttons: a tap, a click or Enter / Space presses one.
  // Arrows move the focus around the grid.
  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;   // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      if (e.code === "KeyN") { e.preventDefault(); newGame(true); return; }
      if (e.code === "KeyU") { e.preventDefault(); undo(); return; }
      if (e.code === "KeyH") { e.preventDefault(); hint(); return; }
      if (e.code === "KeyR") { e.preventDefault(); restart(); return; }
      var dir = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
      if (!dir) return;
      e.preventDefault();
      var board = $("board"), cur = document.activeElement;
      if (!cur || cur.parentNode !== board) {
        cur = board.querySelector('.cell[tabindex="0"]') || board.children[0];
        cur.focus();
        return;
      }
      var i = +cur.getAttribute("data-i");
      var r = Math.max(0, Math.min(N - 1, Math.floor(i / N) + dir[0]));
      var c = Math.max(0, Math.min(N - 1, i % N + dir[1]));
      board.children[r * N + c].focus();
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
    api.registerSlice("lightsout", sliceGet, sliceSet, STORAGE_KEY, mergeLightsOut);
  }

  function sliceGet() {
    return mergeLightsOut(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeLightsOut(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    // no toast on merge (sync feedback = taskbar dot)
  }

  // ---------- 12. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
  }

  function paintStatic() {
    [["undo-btn", "undo", "btn.undo"], ["hint-btn", "hint", "btn.hint"],
     ["restart-btn", "restart", "btn.restart"], ["new-btn", "new", "btn.new"],
     ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    paintSfxBtn();
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () {
        var lv = b.getAttribute("data-level");
        if (game && lv === game.level && !game.done) return;   // visible active state
        prefs.level = lv; savePrefs(); newGame(true);
      });
    });
    $("undo-btn").addEventListener("click", undo);
    $("hint-btn").addEventListener("click", hint);
    $("restart-btn").addEventListener("click", restart);
    $("new-btn").addEventListener("click", function () { newGame(true); $("new-btn").blur(); });
    $("stats-btn").addEventListener("click", statsDialog);
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("press");   // audible confirmation when turned on
    });
    $("board").addEventListener("click", function (e) {
      var cell = e.target.closest && e.target.closest(".cell");
      if (cell) pressCell(+cell.getAttribute("data-i"), false);
    });
    $("board").addEventListener("focusin", function (e) {
      var cell = e.target.closest && e.target.closest(".cell");
      if (!cell) return;
      [].forEach.call($("board").children, function (x) { x.tabIndex = x === cell ? 0 : -1; });
    });

    var relayout = function () { layoutBoard(); };
    if (window.ResizeObserver) new ResizeObserver(relayout).observe($("board-wrap"));
    else window.addEventListener("resize", relayout);

    // The clock runs only while the app is visible; the time is saved.
    document.addEventListener("visibilitychange", function () {
      if (!game) return;
      syncClock();
      saveSession();
    });
    window.addEventListener("pagehide", function () {
      if (!game) return;
      syncClock();
      saveSession();
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
    if (game) prefs.level = game.level;        // the resumed puzzle decides the toolbar
    else { game = fresh(); saveSession(); }
    syncClock();
    renderAll(true);
  }

  boot();
})();
