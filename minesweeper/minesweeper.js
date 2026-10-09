// ============================================================
// orOS Minesweeper — App logic (v1.0.0)
// Open every cell that hides no mine. A number tells how many of the
// eight cells around it hide a mine; flag the cells you are sure of.
//   - Beginner 9×9 / 10 mines, Intermediate 16×16 / 40, Expert
//     16×30 / 99 (shown 30×16 on a tall screen, so it fills a phone)
//   - the mines are laid at the first click, never in the 3×3 around
//     it, so the first click always opens an area
//   - an empty cell opens its neighbours (flood fill); a click on a
//     number whose flags are all set opens the rest around it (chord)
//   - flags: right-click, long-press on touch, or the flag-mode button;
//     no question marks
//   - arrows move, Space / Enter opens (or chords), F flags, N new game
//   - big boards: Fit shows the whole board; the zoom button makes the
//     cells bigger and the board scrolls (drag to pan)
//   - a game in progress is kept on the device and resumes
// Data:
//   - synced slice "minesweeper" (oros-minesweeper-data): per level the
//     best winning time (and when), games won and games finished, as
//     per-device rows (each device only grows its own row; merge =
//     per-row join) + a reset stamp br
//   - device-local (R10): oros-minesweeper-prefs (level, zoom),
//     oros-minesweeper-session (the game in progress),
//     oros-minesweeper-device (row id), oros-minesweeper-sfx (sound)
// Sections:
//   1. Constants, i18n, helpers
//   2. Minesweeper model (mines, numbers, flood fill, chord, win)
//   3. Synced data: load / save / normalize / merge (R5, R26)
//   4. Device-local prefs + session
//   5. Game flow (new, open, flag, chord, clock, win / lose)
//   6. Render (toolbar, status, board)
//   7. Dialogs (result, records, confirm)
//   8. Toasts
//   9. Sound
//  10. Input (pointer, long-press, keyboard, Contract Β)
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-minesweeper-data";
  var PREFS_KEY   = "oros-minesweeper-prefs";
  var SESSION_KEY = "oros-minesweeper-session";
  var DEVICE_KEY  = "oros-minesweeper-device";
  var SFX_KEY     = "oros-minesweeper-sfx";
  var DATA_VER    = 1;

  var LEVELS = ["b", "i", "e"];
  var LV = {
    b: { rows: 9, cols: 9, mines: 10 },
    i: { rows: 16, cols: 16, mines: 40 },
    e: { rows: 16, cols: 30, mines: 99 }
  };
  var MAX_MS = 360000000;                    // 100 h: anything above is junk
  var LONG_MS = 420;                         // long-press = flag
  var MOVE_PX = 10;                          // a touch that moves more is a pan
  // Cell states: 0 closed, 1 open, 2 flagged.

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
      "lv.b": "Beginner", "lv.i": "Intermediate", "lv.e": "Expert",
      "lv.label": "Level",
      "btn.new": "New game (N)",
      "btn.flagOn": "Flag mode on: a tap flags", "btn.flagOff": "Flag mode off: a tap opens",
      "btn.zoomIn": "Bigger cells (scroll the board)",
      "btn.zoomOut": "Fit the board",
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "st.mines": "Mines", "st.time": "Time",
      "turn.start": "Open any cell: the first one is always safe",
      "turn.startTouch": "Tap to open, long-press to flag",
      "turn.flag": "Flag mode: a tap flags or unflags",
      "turn.play": "Best {t}",
      "turn.playNone": "{n} cells left to open",
      "turn.won": "Cleared!",
      "turn.lost": "Boom! A mine",
      "board.label": "Minefield, {r} rows by {c} columns. Arrows move, Space opens, F flags",
      "cell.at": "Row {r}, column {c}: {s}",
      "cell.closed": "closed", "cell.flag": "flagged", "cell.empty": "open, no mines around",
      "cell.num": "{n} around", "cell.mine": "mine",
      "live.won": "Cleared in {t}",
      "live.lost": "A mine. Game over",
      "res.won": "Cleared",
      "res.lost": "Game over",
      "res.lostMsg": "You opened a mine.",
      "res.time": "Time",
      "res.best": "Best time",
      "res.wins": "Won",
      "res.rate": "Won · played",
      "res.rec": "New best time!",
      "res.again": "Play again",
      "res.close": "Close",
      "stats.title": "Records",
      "stats.head": "Best time · won · played",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "confirm.reset": "Delete the records on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Records reset",
      "toast.newgame": "New game",
      "toast.undo": "Undo",
      "toast.over": "Game over: start a new game (N)",
      "toast.flagged": "Flagged: remove the flag first",
      "toast.noZoom": "The cells are already big enough here",
      "toast.save": "Could not save: storage is full"
    },
    el: {
      "lv.b": "Αρχάριος", "lv.i": "Μέτριος", "lv.e": "Έμπειρος",
      "lv.label": "Επίπεδο",
      "btn.new": "Νέο παιχνίδι (N)",
      "btn.flagOn": "Σημαίες ανοιχτές: το άγγιγμα βάζει σημαία", "btn.flagOff": "Σημαίες κλειστές: το άγγιγμα ανοίγει",
      "btn.zoomIn": "Μεγαλύτερα κελιά (κύλιση του πίνακα)",
      "btn.zoomOut": "Όλος ο πίνακας στην οθόνη",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "st.mines": "Νάρκες", "st.time": "Χρόνος",
      "turn.start": "Άνοιξε όποιο κελί θες: το πρώτο είναι πάντα ασφαλές",
      "turn.startTouch": "Άγγιξε για άνοιγμα, κράτα για σημαία",
      "turn.flag": "Σημαίες: το άγγιγμα βάζει ή βγάζει σημαία",
      "turn.play": "Ρεκόρ {t}",
      "turn.playNone": "Μένουν {n} κελιά να ανοίξουν",
      "turn.won": "Καθάρισε!",
      "turn.lost": "Μπουμ! Νάρκη",
      "board.label": "Ναρκοπέδιο, {r} γραμμές επί {c} στήλες. Βελάκια για κίνηση, Space ανοίγει, F σημαία",
      "cell.at": "Γραμμή {r}, στήλη {c}: {s}",
      "cell.closed": "κλειστό", "cell.flag": "με σημαία", "cell.empty": "ανοιχτό, χωρίς νάρκες γύρω",
      "cell.num": "{n} γύρω", "cell.mine": "νάρκη",
      "live.won": "Καθάρισε σε {t}",
      "live.lost": "Νάρκη. Τέλος παιχνιδιού",
      "res.won": "Καθάρισε",
      "res.lost": "Τέλος παιχνιδιού",
      "res.lostMsg": "Άνοιξες μια νάρκη.",
      "res.time": "Χρόνος",
      "res.best": "Καλύτερος χρόνος",
      "res.wins": "Νίκες",
      "res.rate": "Νίκες · παιχνίδια",
      "res.rec": "Νέο ρεκόρ χρόνου!",
      "res.again": "Ξανά",
      "res.close": "Κλείσιμο",
      "stats.title": "Ρεκόρ",
      "stats.head": "Καλύτερος χρόνος · νίκες · παιχνίδια",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.newgame": "Νέο παιχνίδι",
      "toast.undo": "Αναίρεση",
      "toast.over": "Τέλος παιχνιδιού: ξεκίνα νέο (N)",
      "toast.flagged": "Έχει σημαία: βγάλε πρώτα τη σημαία",
      "toast.noZoom": "Τα κελιά είναι ήδη αρκετά μεγάλα εδώ",
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
    console.log("minesweeper.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Minesweeper model ----------
  // Cells are indexed r * cols + c; mines[i] = 1 for a mine.

  function neighbors(rows, cols, i) {
    var r = Math.floor(i / cols), c = i % cols, out = [];
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        var rr = r + dr, cc = c + dc;
        if (rr >= 0 && cc >= 0 && rr < rows && cc < cols) out.push(rr * cols + cc);
      }
    }
    return out;
  }

  // count mines on random cells, none on safe or around it.
  function layMines(rows, cols, count, safe, rnd) {
    var keep = {}, pool = [], i;
    keep[safe] = true;
    neighbors(rows, cols, safe).forEach(function (j) { keep[j] = true; });
    for (i = 0; i < rows * cols; i++) if (!keep[i]) pool.push(i);
    var mines = [];
    for (i = 0; i < rows * cols; i++) mines.push(0);
    for (i = 0; i < count && pool.length; i++) {
      var k = i + Math.floor(rnd() * (pool.length - i)), x = pool[k];
      pool[k] = pool[i]; pool[i] = x;
      mines[x] = 1;
    }
    return mines;
  }

  // How many mines touch each cell.
  function numbersOf(mines, rows, cols) {
    var out = [];
    for (var i = 0; i < mines.length; i++) {
      var n = 0;
      neighbors(rows, cols, i).forEach(function (j) { n += mines[j]; });
      out.push(n);
    }
    return out;
  }

  // Open cell i (a closed, unflagged one) and, from every opened cell
  // with no mine around, its neighbours. Changes st; returns the cells
  // opened, in order.
  function openFrom(st, mines, nums, rows, cols, i) {
    var opened = [], queue = [i];
    if (st[i] !== 0) return opened;
    st[i] = 1;
    opened.push(i);
    while (queue.length) {
      var k = queue.shift();
      if (mines[k] || nums[k]) continue;
      var nb = neighbors(rows, cols, k);
      for (var j = 0; j < nb.length; j++) {
        if (st[nb[j]] !== 0) continue;
        st[nb[j]] = 1;
        opened.push(nb[j]);
        queue.push(nb[j]);
      }
    }
    return opened;
  }

  // Chord on an open number: when its flags match it, open every other
  // closed neighbour. Returns { ok, opened: [], boom: a mine opened or -1 }.
  function chordAt(st, mines, nums, rows, cols, i) {
    if (st[i] !== 1 || !nums[i] || mines[i]) return { ok: false, opened: [], boom: -1 };
    var nb = neighbors(rows, cols, i), flags = 0, closed = 0, j;
    for (j = 0; j < nb.length; j++) {
      if (st[nb[j]] === 2) flags++;
      else if (st[nb[j]] === 0) closed++;
    }
    if (flags !== nums[i] || !closed) return { ok: false, opened: [], boom: -1 };
    var opened = [], boom = -1;
    for (j = 0; j < nb.length; j++) {
      var k = nb[j];
      if (st[k] !== 0) continue;
      if (mines[k]) { st[k] = 1; opened.push(k); if (boom < 0) boom = k; continue; }
      opened = opened.concat(openFrom(st, mines, nums, rows, cols, k));
    }
    return { ok: true, opened: opened, boom: boom };
  }

  // Won when every cell without a mine is open.
  function isWon(st, mines) {
    for (var i = 0; i < st.length; i++) if (!mines[i] && st[i] !== 1) return false;
    return true;
  }

  // Board view: Expert turns on a tall area, so view (vr, vc) shows
  // logical cell (vc, vr). Returns the logical index.
  function viewToCell(vr, vc, cols, flip) {
    return flip ? vc * cols + vr : vr * cols + vc;
  }

  // ---------- 3. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                       // max-merged
  //   rows: { <deviceId>: { b: <epoch>,
  //                         s: { b|i|e: { t: best winning ms (0 = none), ts: when,
  //                                       w: games won, g: games finished } } } }
  // }
  // Each device only ever writes ITS OWN row; a row counts from epoch b.
  // Merge per row: the newer epoch wins; equal epochs take, per level,
  // the better time (lower t > 0, then the earlier ts) and the higher w
  // and g. Rows older than br drop. A join (symmetric, associative,
  // idempotent).
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normCell(c) {
    if (!c || typeof c !== "object" || !isInt(c.t) || !isInt(c.ts) || !isInt(c.w) || !isInt(c.g) ||
        c.t < 0 || c.t > MAX_MS || c.ts < 0 || c.g < 1 || c.w < 0 || c.w > c.g ||
        (c.t > 0) !== (c.w > 0)) return null;
    return { t: c.t, ts: c.ts, w: c.w, g: c.g };
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

  function joinCell(a, c) {
    var best;
    if (!a.t || !c.t) best = a.t ? a : c;
    else if (a.t !== c.t) best = a.t < c.t ? a : c;
    else best = a.ts <= c.ts ? a : c;
    if (!a.t && !c.t) best = a.ts <= c.ts ? a : c;
    return { t: best.t, ts: best.ts, w: Math.max(a.w, c.w), g: Math.max(a.g, c.g) };
  }

  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var s = {};
    LEVELS.forEach(function (k) {
      var a = x.s[k], c = y.s[k];
      if (!a && !c) return;
      s[k] = (a && c) ? joinCell(a, c) : normCell(a || c);
    });
    return { b: x.b, s: s };
  }

  function mergeMinesweeper(A, B) {
    var a = A || {}, b = B || {};
    var br = Math.max(isInt(a.br) && a.br > 0 ? a.br : 0, isInt(b.br) && b.br > 0 ? b.br : 0);
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

  // Best time, wins and games for a level, across every device.
  function totals(key) {
    var out = { t: 0, w: 0, g: 0 };
    Object.keys(data.rows).forEach(function (id) {
      var c = data.rows[id].s[key];
      if (!c) return;
      out.w += c.w;
      out.g += c.g;
      if (c.t && (!out.t || c.t < out.t)) out.t = c.t;
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
          data = mergeMinesweeper(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] minesweeper: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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

  // Counts a finished game; returns true for a new best time.
  function countGame(key, won, ms) {
    var before = totals(key);
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // new epoch after a reset
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    var c = row.s[key] || { t: 0, ts: 0, w: 0, g: 0 };
    c = { t: c.t, ts: c.ts, w: c.w + (won ? 1 : 0), g: c.g + 1 };
    ms = Math.max(1, Math.min(MAX_MS, ms));
    if (won && (!c.t || ms < c.t)) { c.t = ms; c.ts = Date.now(); }
    row.s[key] = c;
    data.rows[deviceId] = row;
    data = mergeMinesweeper(data, data);
    save();
    return won && (!before.t || ms < before.t);
  }

  // ---------- 4. Device-local prefs + session ----------
  var prefs = { lv: "b", zoom: false };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (LEVELS.indexOf(p.lv) >= 0) prefs.lv = p.lv;
        if (typeof p.zoom === "boolean") prefs.zoom = p.zoom;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = { lv, mines: "0101…" | "" (not laid yet), st: [cell states],
  //          ms, over: "" | "w" | "l", hit: the mine that went off or -1,
  //          sel: cursor cell, flag: flag mode }
  var game = null;
  var MINES = null, NUMS = null;

  function validSession(g) {
    if (!g || typeof g !== "object" || LEVELS.indexOf(g.lv) < 0) return false;
    var L = LV[g.lv], n = L.rows * L.cols, i;
    if (typeof g.mines !== "string" || (g.mines !== "" && (g.mines.length !== n || !/^[01]+$/.test(g.mines))) ||
        !Array.isArray(g.st) || g.st.length !== n || !isInt(g.ms) || g.ms < 0 || g.ms > MAX_MS ||
        ["", "w", "l"].indexOf(g.over) < 0 || !isInt(g.hit) || g.hit < -1 || g.hit >= n ||
        !isInt(g.sel) || g.sel < 0 || g.sel >= n) return false;
    var count = 0;
    for (i = 0; i < n; i++) {
      if (g.st[i] !== 0 && g.st[i] !== 1 && g.st[i] !== 2) return false;
      if (g.mines && g.mines.charCodeAt(i) === 49) count++;
      if (!g.mines && g.st[i] === 1) return false;
    }
    if (g.mines && count !== L.mines) return false;
    return !g.over || !!g.mines;
  }
  function loadSession() {
    try {
      var g = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(g)) { g.flag = g.flag === true; return g; }
    } catch (e) {}
    return null;
  }
  function saveSession() {
    if (!game) return;
    if (runFrom) { game.ms = Math.min(MAX_MS, elapsed()); runFrom = nowMs(); }
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(game)); } catch (e) {}
  }

  // ---------- 5. Game flow ----------
  var runFrom = 0;          // nowMs() when the clock last resumed (0: stopped)
  var tick = null;

  function elapsed() { return game.ms + (runFrom ? Math.round(nowMs() - runFrom) : 0); }
  function clockRuns() {
    return !!(game && game.mines && !game.over && document.visibilityState !== "hidden");
  }
  function syncClock() {
    if (runFrom) { game.ms = Math.min(MAX_MS, elapsed()); runFrom = 0; }
    if (clockRuns()) runFrom = nowMs();
    if (runFrom && !tick) tick = setInterval(renderClock, 500);
    if (!runFrom && tick) { clearInterval(tick); tick = null; }
    renderClock();
  }

  function setGame(g) {
    game = g;
    var L = LV[g.lv];
    if (g.mines) {
      MINES = [];
      for (var i = 0; i < g.mines.length; i++) MINES.push(g.mines.charCodeAt(i) - 48);
      NUMS = numbersOf(MINES, L.rows, L.cols);
    } else { MINES = null; NUMS = null; }
  }

  function fresh(lv) {
    var L = LV[lv], st = [];
    for (var i = 0; i < L.rows * L.cols; i++) st.push(0);
    return { lv: lv, mines: "", st: st, ms: 0, over: "", hit: -1,
             sel: Math.floor(L.rows / 2) * L.cols + Math.floor(L.cols / 2), flag: game ? game.flag : false };
  }
  function inProgress() { return !!(game && game.mines && !game.over); }
  function copy(g) { return JSON.parse(JSON.stringify(g)); }

  // A game in progress is never lost silently: Undo toast (R14).
  function newGame(lv) {
    closeDialogs();
    var prev = inProgress() ? (saveSession(), copy(game)) : null;
    prefs.lv = lv; savePrefs();
    runFrom = 0;
    setGame(fresh(lv));
    saveSession();
    syncClock();
    renderAll(true);
    if (prev) {
      undoToast(t("toast.newgame"), function () {
        runFrom = 0;
        prefs.lv = prev.lv; savePrefs();
        setGame(prev);
        saveSession();
        syncClock();
        renderAll(true);
      });
    } else {
      live(t("toast.newgame"));
    }
  }

  function refuseOver() {
    if (game.over) { showToast(t("toast.over")); return true; }
    return false;
  }

  // Open cell i (or chord on an open number).
  function openCell(i) {
    if (refuseOver()) return;
    var L = LV[game.lv];
    if (game.st[i] === 2) { showToast(t("toast.flagged")); shake(i); return; }   // R28
    if (game.st[i] === 1) { chord(i); return; }
    if (!game.mines) {
      MINES = layMines(L.rows, L.cols, L.mines, i, rand);
      NUMS = numbersOf(MINES, L.rows, L.cols);
      game.mines = MINES.join("");
      game.ms = 0;
      syncClock();
    }
    if (MINES[i]) { game.st[i] = 1; lose(i); return; }
    var opened = openFrom(game.st, MINES, NUMS, L.rows, L.cols, i);
    sfx(opened.length > 1 ? "flood" : "open");
    after(opened);
  }

  function chord(i) {
    var L = LV[game.lv];
    var res = chordAt(game.st, MINES, NUMS, L.rows, L.cols, i);
    if (!res.ok) { shake(i); return; }                    // visible refusal (R28)
    if (res.boom >= 0) { lose(res.boom); return; }
    sfx("flood");
    after(res.opened);
  }

  function toggleFlag(i) {
    if (refuseOver()) return;
    if (game.st[i] === 1) { if (NUMS && NUMS[i]) chord(i); else shake(i); return; }
    game.st[i] = game.st[i] === 2 ? 0 : 2;
    sfx(game.st[i] === 2 ? "flag" : "unflag");
    saveSession();
    renderCells([i]);
    renderStatus();
    live(cellLabel(i));
  }

  function after(opened) {
    if (isWon(game.st, MINES)) { win(); return; }
    saveSession();
    renderCells(opened);
    renderStatus();
    if (opened.length) live(cellLabel(opened[0]));
  }

  function win() {
    syncClock();
    game.over = "w";
    syncClock();
    for (var i = 0; i < game.st.length; i++) if (MINES[i]) game.st[i] = 2;   // flag the rest
    var rec = countGame(game.lv, true, game.ms);
    saveSession();
    renderAll(false);
    live(t("live.won", { t: fmtTime(game.ms) }));
    sfx("win");
    var b = $("board");
    if (!reduced) { b.classList.remove("won"); void b.offsetWidth; b.classList.add("won"); }
    setTimeout(function () { resultDialog(rec); }, reduced ? 50 : 700);
  }

  function lose(i) {
    syncClock();
    game.over = "l";
    game.hit = i;
    syncClock();
    countGame(game.lv, false, game.ms);
    saveSession();
    renderAll(false);
    live(t("live.lost"));
    sfx("boom");
    var b = $("board");
    if (!reduced) { b.classList.remove("boom"); void b.offsetWidth; b.classList.add("boom"); }
    setTimeout(function () { resultDialog(false); }, reduced ? 50 : 900);
  }

  function toggleFlagMode() {
    if (!game) return;
    game.flag = !game.flag;
    saveSession();
    renderToolbar();
    renderStatus();
    live(t(game.flag ? "btn.flagOn" : "btn.flagOff"));
  }

  // ---------- 6. Render ----------
  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var cellEls = [];          // logical index → element
  var flip = false;          // Expert shown turned (30 rows × 16 columns)

  function renderAll(rebuild) {
    renderToolbar();
    renderStatus();
    if (rebuild || cellEls.length !== game.st.length) buildBoard();
    renderCells(null);
    if (rebuild) layout();
  }

  function renderToolbar() {
    var cur = game ? game.lv : prefs.lv;
    [].forEach.call(document.querySelectorAll("#lv-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-lv") === cur;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var f = $("flag-btn"), on = !!(game && game.flag);
    f.setAttribute("aria-pressed", on ? "true" : "false");
    f.setAttribute("aria-label", t(on ? "btn.flagOn" : "btn.flagOff"));
    f.title = t(on ? "btn.flagOn" : "btn.flagOff");
    f.classList.toggle("on", on);
    var z = $("zoom-btn");
    z.innerHTML = prefs.zoom ? UI_ICONS.zoomOut : UI_ICONS.zoomIn;
    z.setAttribute("aria-pressed", prefs.zoom ? "true" : "false");
    z.setAttribute("aria-label", t(prefs.zoom ? "btn.zoomOut" : "btn.zoomIn"));
    z.title = t(prefs.zoom ? "btn.zoomOut" : "btn.zoomIn");
    paintSfxBtn();
  }

  function renderClock() {
    if (game) $("time").textContent = fmtTime(elapsed());
  }

  function coarse() {
    return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  }

  function renderStatus() {
    renderClock();
    var L = LV[game.lv], flags = 0, closed = 0, i;
    for (i = 0; i < game.st.length; i++) {
      if (game.st[i] === 2) flags++;
      if (game.st[i] !== 1) closed++;
    }
    $("mines").textContent = String(L.mines - flags);
    var msg, cls = "", best = totals(game.lv).t;
    if (game.over === "w") { msg = t("turn.won"); cls = "done"; }
    else if (game.over === "l") { msg = t("turn.lost"); cls = "warn"; }
    else if (game.flag) { msg = t("turn.flag"); cls = "done"; }
    else if (!game.mines) msg = t(coarse() ? "turn.startTouch" : "turn.start");
    else msg = best ? t("turn.play", { t: fmtTime(best) }) : t("turn.playNone", { n: closed - L.mines });
    $("turn").textContent = msg;
    $("turn").className = cls;
  }

  function buildBoard() {
    var b = $("board"), L = LV[game.lv];
    b.innerHTML = "";
    var vr = flip ? L.cols : L.rows, vc = flip ? L.rows : L.cols;
    b.style.setProperty("--vr", String(vr));
    b.style.setProperty("--vc", String(vc));
    b.setAttribute("aria-label", t("board.label", { r: vr, c: vc }));
    cellEls = [];
    for (var i = 0; i < L.rows * L.cols; i++) cellEls.push(null);
    for (var r = 0; r < vr; r++) {
      for (var c = 0; c < vc; c++) {
        var i2 = viewToCell(r, c, L.cols, flip), d = document.createElement("div");
        d.className = "cell";
        d.setAttribute("data-i", String(i2));
        b.appendChild(d);
        cellEls[i2] = d;
      }
    }
    b.__flip = flip;
    b.__lv = game.lv;
  }

  // Redraw some cells (list) or all (null).
  function renderCells(list) {
    var all = !list, over = game.over, i;
    var idx = all ? null : list.slice();
    if (!all && game.sel >= 0) idx.push(game.sel);
    if (all) { idx = []; for (i = 0; i < game.st.length; i++) idx.push(i); }
    if (!all && lastSel >= 0 && lastSel !== game.sel) idx.push(lastSel);
    lastSel = game.sel;
    idx.forEach(function (k) {
      var d = cellEls[k];
      if (!d) return;
      var s = game.st[k], cls = "cell", txt = "";
      if (s === 1) {
        if (MINES && MINES[k]) { cls += " open mine" + (k === game.hit ? " hit" : ""); }
        else {
          cls += " open";
          if (NUMS[k]) { cls += " n" + NUMS[k]; txt = String(NUMS[k]); }
        }
      } else if (s === 2) {
        cls += " flag";
        if (over === "l" && MINES && !MINES[k]) cls += " wrong";
      } else if (over === "l" && MINES && MINES[k]) {
        cls += " open mine";
      }
      if (k === game.sel && !over) cls += " sel";
      if (d.className !== cls) d.className = cls;
      if (d.textContent !== txt) d.textContent = txt;
    });
    $("board").classList.toggle("over", !!over);
  }
  var lastSel = -1;

  function shake(i) {
    if (reduced || !cellEls[i]) return;
    var d = cellEls[i];
    d.classList.remove("shake");
    void d.offsetWidth;
    d.classList.add("shake");
    setTimeout(function () { d.classList.remove("shake"); }, 400);
  }

  // Fit the whole board in #board-wrap; with zoom on, cells are at least
  // 30 px (34 on touch) and the wrap scrolls. Expert turns on a tall area.
  function layout() {
    if (!game) return;
    var wrap = $("board-wrap"), b = $("board"), L = LV[game.lv];
    var cs = getComputedStyle(wrap);
    var W = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var H = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (W <= 0 || H <= 0) return;
    var wantFlip = L.rows !== L.cols && H > W;
    if (wantFlip !== flip || b.__lv !== game.lv || b.__flip !== flip) {
      flip = wantFlip;
      buildBoard();
      lastSel = -1;
      renderCells(null);
    }
    var vr = flip ? L.cols : L.rows, vc = flip ? L.rows : L.cols;
    var fit = Math.floor(Math.min((W - 8) / vc, (H - 8) / vr, 44));
    var want = coarse() ? 34 : 30, c = fit;
    var zoomed = prefs.zoom && fit < want;
    if (zoomed) c = want;
    b.style.setProperty("--c", Math.max(12, c) + "px");
    wrap.classList.toggle("zoomed", zoomed);
    $("zoom-btn").hidden = fit >= want && !prefs.zoom;
  }

  function scrollToSel() {
    var wrap = $("board-wrap"), d = cellEls[game.sel];
    if (!wrap.classList.contains("zoomed") || !d) return;
    var r = d.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    if (r.left < w.left) wrap.scrollLeft -= w.left - r.left + 4;
    else if (r.right > w.right) wrap.scrollLeft += r.right - w.right + 4;
    if (r.top < w.top) wrap.scrollTop -= w.top - r.top + 4;
    else if (r.bottom > w.bottom) wrap.scrollTop += r.bottom - w.bottom + 4;
  }

  // Cursor moves in view directions (arrows follow the board on screen).
  function moveSel(dr, dc) {
    var L = LV[game.lv], cols = L.cols;
    var r = Math.floor(game.sel / cols), c = game.sel % cols;
    var vr = flip ? c : r, vc = flip ? r : c;
    var VR = flip ? L.cols : L.rows, VC = flip ? L.rows : L.cols;
    vr = (vr + dr + VR) % VR; vc = (vc + dc + VC) % VC;
    game.sel = viewToCell(vr, vc, cols, flip);
    renderCells([]);
    scrollToSel();
    live(cellLabel(game.sel));
  }

  function cellLabel(i) {
    var cols = LV[game.lv].cols, s = game.st[i], what;
    if (s === 2) what = t("cell.flag");
    else if (s === 0) what = t("cell.closed");
    else if (MINES && MINES[i]) what = t("cell.mine");
    else what = NUMS[i] ? t("cell.num", { n: NUMS[i] }) : t("cell.empty");
    var r = Math.floor(i / cols), c = i % cols;
    return t("cell.at", { r: (flip ? c : r) + 1, c: (flip ? r : c) + 1, s: what });
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

  function resultDialog(rec) {
    if (!game || !game.over) return;            // replaced meanwhile
    closeDialogs();
    var s = totals(game.lv), won = game.over === "w";
    var dlg = makeDialog("minesweeper-result");
    dlg.appendChild(el("div", "dlg-title", t(won ? "res.won" : "res.lost") + " · " + t("lv." + game.lv)));
    dlg.appendChild(el("div", "dlg-hero" + (won ? "" : " lost"), won ? fmtTime(game.ms) : t("turn.lost")));
    if (rec) dlg.appendChild(el("div", "dlg-badge", t("res.rec")));
    if (!won) dlg.appendChild(el("div", "dlg-msg", t("res.lostMsg")));
    if (!won) dlg.appendChild(row(t("res.time"), fmtTime(game.ms)));
    dlg.appendChild(row(t("res.best"), s.t ? fmtTime(s.t) : "–"));
    dlg.appendChild(row(t("res.rate"), s.w + " · " + s.g));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("res.close"), "", function () { dlg.close(); }));
    var again = button(t("res.again"), "primary", function () { dlg.close(); newGame(game.lv); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    again.focus();
  }

  function statsDialog() {
    var dlg = makeDialog("minesweeper-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    LEVELS.forEach(function (k) {
      var s = totals(k);
      if (s.g) empty = false;
      dlg.appendChild(row(t("lv." + k),
        s.g ? (s.t ? fmtTime(s.t) : "–") + " · " + s.w + " · " + s.g : "–"));
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
    var dlg = makeDialog("minesweeper-confirm");
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
    data = mergeMinesweeper(data, data);
    save();
    renderStatus();
    showToast(t("toast.reset"));
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "minesweeper", title: String(text) })) return;
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
      if (kind === "open") tone(560, 0, 0.04, "triangle", 0.08);
      else if (kind === "flood") { tone(520, 0, 0.05, "triangle", 0.08); tone(700, 0.04, 0.06, "triangle", 0.07); }
      else if (kind === "flag") tone(880, 0, 0.06, "square", 0.05);
      else if (kind === "unflag") tone(440, 0, 0.05, "square", 0.04);
      else if (kind === "boom") { tone(140, 0, 0.35, "sawtooth", 0.16); tone(90, 0.05, 0.4, "square", 0.1); }
      else if (kind === "win") {
        [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
      }
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Toolbar icons (R9: injected by JS) ----------
  var UI_ICONS = {
    new:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    flag:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></svg>',
    zoomIn:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/></svg>',
    zoomOut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M8 11h6"/></svg>',
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
  // Mouse: left opens (flags in flag mode), right flags, middle chords.
  // Touch: a tap opens (flags in flag mode), a long-press flags, a drag
  // pans the zoomed board (native scroll: touch-action pan-x pan-y).
  function wirePointer() {
    var b = $("board"), press = null;
    b.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    b.addEventListener("pointerdown", function (e) {
      var c = e.target.closest ? e.target.closest(".cell") : null;
      if (!c || !game) return;
      var i = +c.getAttribute("data-i");
      if (e.pointerType === "mouse") {
        if (e.button === 2) { e.preventDefault(); game.sel = i; toggleFlag(i); return; }
        if (e.button === 1) { e.preventDefault(); game.sel = i; if (!refuseOver()) chord(i); return; }
        if (e.button !== 0) return;
      }
      press = { i: i, x: e.clientX, y: e.clientY, id: e.pointerId, long: false, timer: null };
      if (e.pointerType !== "mouse") {
        press.timer = setTimeout(function () {
          if (!press) return;
          press.long = true;
          game.sel = press.i;
          if (navigator.vibrate) { try { navigator.vibrate(15); } catch (err) {} }
          toggleFlag(press.i);
        }, LONG_MS);
      }
    });
    b.addEventListener("pointermove", function (e) {
      if (!press || e.pointerId !== press.id) return;
      if (Math.abs(e.clientX - press.x) > MOVE_PX || Math.abs(e.clientY - press.y) > MOVE_PX) {
        clearTimeout(press.timer);
        press = null;
      }
    });
    b.addEventListener("pointerup", function (e) {
      if (!press || e.pointerId !== press.id) return;
      var p = press;
      press = null;
      clearTimeout(p.timer);
      if (p.long) return;
      game.sel = p.i;
      if (game.flag && game.st[p.i] !== 1) toggleFlag(p.i);
      else openCell(p.i);
    });
    b.addEventListener("pointercancel", function () {
      if (press) clearTimeout(press.timer);
      press = null;
    });
  }

  var KEY_MOVE = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;   // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      if (!game) return;
      if (KEY_MOVE[e.code]) { e.preventDefault(); moveSel(KEY_MOVE[e.code][0], KEY_MOVE[e.code][1]); return; }
      if (e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter") {
        if (tag === "BUTTON") return;
        e.preventDefault();
        openCell(game.sel);
        return;
      }
      if (e.repeat) return;
      if (e.code === "KeyF") { e.preventDefault(); toggleFlag(game.sel); return; }
      if (e.code === "KeyN") { e.preventDefault(); newGame(game.lv); }
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
    api.registerSlice("minesweeper", sliceGet, sliceSet, STORAGE_KEY, mergeMinesweeper);
  }

  function sliceGet() {
    return mergeMinesweeper(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeMinesweeper(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (game) renderStatus();
    // no toast on merge (sync feedback = taskbar dot)
  }

  // ---------- 12. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    $("lv-seg").setAttribute("aria-label", t("lv.label"));
  }

  function paintStatic() {
    [["new-btn", "new", "btn.new"], ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    $("flag-btn").innerHTML = UI_ICONS.flag;
    paintSfxBtn();
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#lv-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () {
        var lv = b.getAttribute("data-lv");
        if (game && lv === game.lv && !game.over) return;   // visible active state
        newGame(lv);
      });
    });
    $("flag-btn").addEventListener("click", toggleFlagMode);
    $("zoom-btn").addEventListener("click", function () {
      prefs.zoom = !prefs.zoom;
      savePrefs();
      layout();
      renderToolbar();
      if (prefs.zoom && !$("board-wrap").classList.contains("zoomed")) showToast(t("toast.noZoom"));
      else scrollToSel();
    });
    $("new-btn").addEventListener("click", function () { newGame(game ? game.lv : prefs.lv); $("new-btn").blur(); });
    $("stats-btn").addEventListener("click", statsDialog);
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("open");   // audible confirmation when turned on
    });
    wirePointer();

    if (window.ResizeObserver) new ResizeObserver(function () { layout(); }).observe($("board-wrap"));
    else window.addEventListener("resize", layout);

    document.addEventListener("visibilitychange", function () {
      if (!game) return;
      syncClock();
      saveSession();
    });
    window.addEventListener("pagehide", function () { if (game) saveSession(); });

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
    var g = loadSession();
    if (g) {
      prefs.lv = g.lv;                           // the resumed game decides the toolbar
      setGame(g);
    } else {
      setGame(fresh(prefs.lv));
      saveSession();
    }
    syncClock();
    renderAll(true);
  }

  boot();
})();
