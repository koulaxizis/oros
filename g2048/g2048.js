// ============================================================
// orOS 2048 — App logic (v1.0.0)
// Slide every tile one way; two equal tiles that meet join into one
// with their sum (once per move). After each move that changed the
// board a new tile appears (2, or 4 one time in ten). Reach the target
// (2048; 512 on 3×3, where 2048 cannot fit), then keep going for a
// higher score. The game is over when no move is left.
//   - sizes 3×3 / 4×4 (classic) / 5×5, each with its own records
//   - arrows / WASD, swipe; U undoes one move (that game then sets no
//     score or tile record, it still counts as played); N new game
//   - a game in progress is kept on the device and resumes
// Data:
//   - synced slice "g2048" (oros-g2048-data): per size the best score
//     (and when), the biggest tile, games played and games that reached
//     the target, as per-device rows (each device only grows its own
//     row; merge = per-row join) + a reset stamp br
//   - device-local (R10): oros-g2048-prefs (size), oros-g2048-session
//     (the game in progress), oros-g2048-device (row id),
//     oros-g2048-sfx (sound on/off)
// Sections:
//   1. Constants, i18n, helpers
//   2. Game model (slide, spawn, can move)
//   3. Synced data: load / save / normalize / merge (R5, R26)
//   4. Device-local prefs + session
//   5. Game flow (new, move, undo, win, finish)
//   6. Render (toolbar, status, board, tiles)
//   7. Dialogs (win, result, records, confirm)
//   8. Toasts
//   9. Sound
//  10. Input (swipe, keyboard, Contract Β)
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-g2048-data";
  var PREFS_KEY   = "oros-g2048-prefs";
  var SESSION_KEY = "oros-g2048-session";
  var DEVICE_KEY  = "oros-g2048-device";
  var SFX_KEY     = "oros-g2048-sfx";
  var DATA_VER    = 1;

  var SIZES = [3, 4, 5];
  var KEYS = ["n3", "n4", "n5"];
  var TARGET = { 3: 512, 4: 2048, 5: 2048 };
  var MAX_TILE = 1048576;                    // 2^20: anything above is junk
  var MAX_SCORE = 1000000000;
  var SWIPE_PX = 24;
  var SLIDE_MS = 110;
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
      "btn.new": "New game (N)",
      "btn.undo": "Undo (U)",
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "st.score": "Score", "st.best": "Best",
      "turn.start": "Swipe or use the arrows: join equal tiles to reach {t}",
      "turn.play": "Reach {t}",
      "turn.more": "Keep going: highest tile {v}",
      "turn.undone": "Undo used: no score record this game",
      "turn.over": "No moves left",
      "board.label": "2048 board, {n} by {n}",
      "live.move": "Score {s}",
      "live.join": "Joined {v}. Score {s}",
      "live.win": "{t} reached!",
      "live.over": "No moves left. Score {s}",
      "win.title": "You reached {t}!",
      "win.msg": "Keep going for a higher score, or finish here.",
      "win.more": "Keep going",
      "win.end": "Finish here",
      "res.title": "Game over",
      "res.score": "Score",
      "res.tile": "Highest tile",
      "res.best": "Best score",
      "res.bestTile": "Best tile",
      "res.games": "Games",
      "res.rec": "New best score!",
      "res.noRec": "Undo was used: no record for this game",
      "res.again": "Play again",
      "res.close": "Close",
      "stats.title": "Records",
      "stats.head": "Best score · best tile · games · reached target",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "confirm.reset": "Delete the records on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Records reset",
      "toast.newgame": "New game",
      "toast.undo": "Undo",
      "toast.noUndo": "Nothing to undo: only the last move can be undone",
      "toast.over": "No moves left: start a new game (N)",
      "toast.save": "Could not save: storage is full"
    },
    el: {
      "btn.new": "Νέο παιχνίδι (N)",
      "btn.undo": "Αναίρεση (U)",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "st.score": "Σκορ", "st.best": "Ρεκόρ",
      "turn.start": "Σύρε ή πάτα τα βελάκια: ένωσε ίδια πλακίδια ως το {t}",
      "turn.play": "Φτάσε το {t}",
      "turn.more": "Συνέχισε: μεγαλύτερο πλακίδιο {v}",
      "turn.undone": "Έγινε αναίρεση: χωρίς ρεκόρ σκορ σε αυτό το παιχνίδι",
      "turn.over": "Δεν υπάρχουν άλλες κινήσεις",
      "board.label": "Πίνακας 2048, {n} επί {n}",
      "live.move": "Σκορ {s}",
      "live.join": "Ενώθηκε {v}. Σκορ {s}",
      "live.win": "Έφτασες το {t}!",
      "live.over": "Δεν υπάρχουν κινήσεις. Σκορ {s}",
      "win.title": "Έφτασες το {t}!",
      "win.msg": "Συνέχισε για μεγαλύτερο σκορ ή τελείωσε εδώ.",
      "win.more": "Συνέχεια",
      "win.end": "Τέλος εδώ",
      "res.title": "Τέλος παιχνιδιού",
      "res.score": "Σκορ",
      "res.tile": "Μεγαλύτερο πλακίδιο",
      "res.best": "Καλύτερο σκορ",
      "res.bestTile": "Καλύτερο πλακίδιο",
      "res.games": "Παιχνίδια",
      "res.rec": "Νέο ρεκόρ σκορ!",
      "res.noRec": "Έγινε αναίρεση: χωρίς ρεκόρ σε αυτό το παιχνίδι",
      "res.again": "Ξανά",
      "res.close": "Κλείσιμο",
      "stats.title": "Ρεκόρ",
      "stats.head": "Σκορ · πλακίδιο · παιχνίδια · έφτασαν τον στόχο",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.newgame": "Νέο παιχνίδι",
      "toast.undo": "Αναίρεση",
      "toast.noUndo": "Τίποτα για αναίρεση: αναιρείται μόνο η τελευταία κίνηση",
      "toast.over": "Δεν υπάρχουν κινήσεις: ξεκίνα νέο παιχνίδι (N)",
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
  function isTile(v) { return isInt(v) && v >= 2 && v <= MAX_TILE && (v & (v - 1)) === 0; }

  // crypto RNG in [0, 1)
  function rand() {
    var buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return (buf[0] * 2097152 + (buf[1] >>> 11)) / 9007199254740992;
  }

  function fmtNum(v) {
    try { return Number(v).toLocaleString(LANG === "el" ? "el-GR" : "en-US"); }
    catch (e) { return String(v); }
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("g2048.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Game model ----------
  // cells[r * n + c] = tile value, or 0 for an empty cell.

  // The cell indices of line k (0…n-1) for direction dir, starting at the
  // edge the tiles slide toward.
  function lineCells(n, dir, k) {
    var out = [];
    for (var j = 0; j < n; j++) {
      if (dir === 0) out.push(j * n + k);                   // up: column k, top first
      else if (dir === 2) out.push((n - 1 - j) * n + k);    // down: bottom first
      else if (dir === 3) out.push(k * n + j);              // left: row k, left first
      else out.push(k * n + (n - 1 - j));                   // right: right first
    }
    return out;
  }

  // One move. Returns { cells, gain, moved, joined: [cell indices of the
  // joined tiles], paths: [{ from, to }] } — every tile's trip, for the
  // slide. A tile joins at most once per move; the pair nearest the
  // edge joins first ([2,2,2,2] → [4,4], [4,4,8] → [8,8]).
  function slide(cells, n, dir) {
    var out = [], gain = 0, moved = false, joined = [], paths = [];
    for (var i = 0; i < n * n; i++) out.push(0);
    for (var k = 0; k < n; k++) {
      var idx = lineCells(n, dir, k), at = 0, open = false;
      for (var j = 0; j < n; j++) {
        var v = cells[idx[j]];
        if (!v) continue;
        if (open && out[idx[at - 1]] === v) {
          out[idx[at - 1]] = v * 2;
          gain += v * 2;
          joined.push(idx[at - 1]);
          paths.push({ from: idx[j], to: idx[at - 1] });
          open = false;
          moved = true;
        } else {
          out[idx[at]] = v;
          paths.push({ from: idx[j], to: idx[at] });
          if (idx[j] !== idx[at]) moved = true;
          at++;
          open = true;
        }
      }
    }
    return { cells: out, gain: gain, moved: moved, joined: joined, paths: paths };
  }

  // A new tile (2, or 4 one time in ten) on a random empty cell.
  // Returns { cells, at } or null when the board is full.
  function spawn(cells, rnd) {
    var free = [];
    for (var i = 0; i < cells.length; i++) if (!cells[i]) free.push(i);
    if (!free.length) return null;
    var at = free[Math.floor(rnd() * free.length)], out = cells.slice();
    out[at] = rnd() < 0.9 ? 2 : 4;
    return { cells: out, at: at };
  }

  // Is any move left? (an empty cell, or two equal neighbours)
  function canMove(cells, n) {
    for (var i = 0; i < cells.length; i++) {
      if (!cells[i]) return true;
      if (i % n < n - 1 && cells[i] === cells[i + 1]) return true;
      if (i + n < cells.length && cells[i] === cells[i + n]) return true;
    }
    return false;
  }

  function maxTile(cells) {
    var m = 0;
    for (var i = 0; i < cells.length; i++) if (cells[i] > m) m = cells[i];
    return m;
  }

  // A new board: two tiles.
  function startCells(n, rnd) {
    var cells = [];
    for (var i = 0; i < n * n; i++) cells.push(0);
    return spawn(spawn(cells, rnd).cells, rnd).cells;
  }

  // ---------- 3. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                       // max-merged
  //   rows: { <deviceId>: { b: <epoch>,
  //                         s: { n3|n4|n5: { s: best score, ts: when,
  //                                          v: best tile, g: games, w: reached target } } } }
  // }
  // Each device only ever writes ITS OWN row; a row counts from epoch b.
  // Merge per row: the newer epoch wins; equal epochs take, per size,
  // the better score (higher s, then the earlier ts), the higher v,
  // g and w. Rows older than br drop. A join (symmetric, associative,
  // idempotent).
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normCell(c) {
    if (!c || typeof c !== "object" || !isInt(c.s) || !isInt(c.ts) || !isInt(c.v) ||
        !isInt(c.g) || !isInt(c.w) || c.s < 0 || c.s > MAX_SCORE || c.ts < 0 ||
        (c.v !== 0 && !isTile(c.v)) || c.g < 1 || c.w < 0) return null;
    return { s: c.s, ts: c.ts, v: c.v, g: c.g, w: c.w };
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
    var best = (a.s !== c.s) ? (a.s > c.s ? a : c) : (a.ts <= c.ts ? a : c);
    return { s: best.s, ts: best.ts, v: Math.max(a.v, c.v), g: Math.max(a.g, c.g), w: Math.max(a.w, c.w) };
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

  function mergeG2048(A, B) {
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

  // Best score, best tile, games and wins for a size, across every device.
  function totals(key) {
    var out = { s: 0, v: 0, g: 0, w: 0 };
    Object.keys(data.rows).forEach(function (id) {
      var c = data.rows[id].s[key];
      if (!c) return;
      out.g += c.g;
      out.w += c.w;
      if (c.s > out.s) out.s = c.s;
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
          data = mergeG2048(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] g2048: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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

  // Counts a finished game; returns true for a new best score. A game
  // with an undo counts as played (and reached) but sets no score or tile.
  function countGame(key, g) {
    var before = totals(key);
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // new epoch after a reset
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    var c = row.s[key] || { s: 0, ts: 0, v: 0, g: 0, w: 0 };
    var sc = Math.min(MAX_SCORE, g.score), top = maxTile(g.cells);
    c = { s: c.s, ts: c.ts, v: c.v, g: c.g + 1, w: c.w + (g.won ? 1 : 0) };
    if (!g.undone) {
      if (sc > c.s) { c.s = sc; c.ts = Date.now(); }
      if (top > c.v) c.v = top;
    }
    row.s[key] = c;
    data.rows[deviceId] = row;
    data = mergeG2048(data, data);
    save();
    return !g.undone && sc > 0 && sc > before.s;
  }

  // ---------- 4. Device-local prefs + session ----------
  var prefs = { n: 4 };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object" && SIZES.indexOf(p.n) >= 0) prefs.n = p.n;
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = { n, cells, score, moves, won, undone, over, prev: { cells, score } | null }
  var game = null;

  function validCells(cells, n) {
    if (!Array.isArray(cells) || cells.length !== n * n) return false;
    for (var i = 0; i < cells.length; i++) if (cells[i] !== 0 && !isTile(cells[i])) return false;
    return true;
  }
  function validSession(g) {
    if (!g || typeof g !== "object" || SIZES.indexOf(g.n) < 0 || !validCells(g.cells, g.n) ||
        !isInt(g.score) || g.score < 0 || g.score > MAX_SCORE || !isInt(g.moves) || g.moves < 0 ||
        typeof g.won !== "boolean" || typeof g.undone !== "boolean" || typeof g.over !== "boolean") return false;
    if (g.prev !== null && (!g.prev || typeof g.prev !== "object" || !validCells(g.prev.cells, g.n) ||
        !isInt(g.prev.score) || g.prev.score < 0 || g.prev.score > g.score)) return false;
    return maxTile(g.cells) > 0;
  }
  function loadSession() {
    try {
      var g = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(g)) return g;
    } catch (e) {}
    return null;
  }
  function saveSession() {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(game)); } catch (e) {}
  }

  // ---------- 5. Game flow ----------
  function fresh() {
    return { n: prefs.n, cells: startCells(prefs.n, rand), score: 0, moves: 0,
             won: false, undone: false, over: false, prev: null };
  }
  function inProgress() { return !!(game && !game.over && game.moves > 0); }

  // A game in progress is never lost silently: Undo toast (R14).
  function newGame(announce) {
    flushSlide();
    closeDialogs();
    var prev = inProgress() ? JSON.parse(JSON.stringify(game)) : null;
    var prevN = game ? game.n : prefs.n;
    game = fresh();
    saveSession();
    renderAll(null);
    if (prev) {
      undoToast(t("toast.newgame"), function () {
        prefs.n = prevN; savePrefs();
        game = prev;
        saveSession();
        renderAll(null);
      });
    } else if (announce) {
      live(t("toast.newgame"));
    }
  }

  function play(dir) {
    if (!game || document.querySelector("dialog[open]")) return;
    if (game.over) { showToast(t("toast.over")); return; }                 // R28
    flushSlide();
    var res = slide(game.cells, game.n, dir);
    if (!res.moved) { nudge(dir); return; }                                 // visible, not a toast
    var sp = spawn(res.cells, rand);
    game.prev = { cells: game.cells, score: game.score };
    game.cells = sp ? sp.cells : res.cells;
    game.score = Math.min(MAX_SCORE, game.score + res.gain);
    game.moves++;
    var top = 0;
    res.joined.forEach(function (i) { if (res.cells[i] > top) top = res.cells[i]; });
    var reached = !game.won && maxTile(game.cells) >= TARGET[game.n];
    if (reached) game.won = true;
    var over = !canMove(game.cells, game.n);
    if (over) game.over = true;
    saveSession();
    renderAll({ paths: res.paths, joined: res.joined, spawned: sp ? sp.at : -1 });
    if (res.joined.length) sfx(top >= 128 ? "big" : "join");
    if (over) { finish(); return; }
    if (reached) {
      live(t("live.win", { t: TARGET[game.n] }));
      sfx("win");
      setTimeout(winDialog, SLIDE_MS + 300);
    } else {
      live(top ? t("live.join", { v: top, s: game.score }) : t("live.move", { s: game.score }));
    }
  }

  function undo() {
    if (!game) return;
    if (game.over || !game.prev) { showToast(t("toast.noUndo")); return; }   // R28
    flushSlide();
    game.cells = game.prev.cells;
    game.score = game.prev.score;
    game.prev = null;
    game.undone = true;
    game.moves = Math.max(0, game.moves - 1);
    saveSession();
    renderAll(null);
    live(t("live.move", { s: game.score }));
  }

  function finish() {
    var rec = countGame("n" + game.n, game);
    game.prev = null;
    saveSession();
    renderStatus();
    renderToolbar();
    live(t("live.over", { s: game.score }));
    sfx("over");
    setTimeout(function () { resultDialog(rec); }, SLIDE_MS + 500);
  }

  // ---------- 6. Render ----------
  function renderAll(anim) {
    renderToolbar();
    renderStatus();
    renderBoard(anim);
  }

  function renderToolbar() {
    [].forEach.call(document.querySelectorAll("#size-seg .seg-btn"), function (b) {
      var on = +b.getAttribute("data-size") === (game ? game.n : prefs.n);
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    $("undo-btn").disabled = !(game && game.prev && !game.over);
    paintSfxBtn();
  }

  function renderStatus() {
    if (!game) return;
    $("score").textContent = fmtNum(game.score);
    $("best").textContent = fmtNum(Math.max(totals("n" + game.n).s, game.undone ? 0 : game.score));
    var msg, tg = TARGET[game.n];
    if (game.over) msg = t("turn.over");
    else if (game.undone) msg = t("turn.undone");
    else if (game.won) msg = t("turn.more", { v: maxTile(game.cells) });
    else msg = t(game.moves ? "turn.play" : "turn.start", { t: tg });
    $("turn").textContent = msg;
    $("turn").className = game.over ? "done" : (game.undone ? "warn" : "");
  }

  function layoutBoard() {
    var wrap = $("board-wrap"), el = $("board");
    var cs = getComputedStyle(wrap);
    var W = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var H = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (W <= 0 || H <= 0) return;
    el.style.setProperty("--size", Math.floor(Math.max(220, Math.min(W, H, 560))) + "px");
  }

  function tileClass(v) {
    var lv = Math.round(Math.log(v) / Math.LN2);
    return "tile lv" + Math.min(lv, 12) + (v >= 10000 ? " d5" : (v >= 1000 ? " d4" : (v >= 100 ? " d3" : "")));
  }
  function place(node, i, n) {
    node.style.transform = "translate(" + ((i % n) * 100) + "%, " + (Math.floor(i / n) * 100) + "%)";
  }
  function makeTile(v, i, n, extra) {
    var d = document.createElement("div");
    d.className = tileClass(v) + (extra ? " " + extra : "");
    d.textContent = String(v);
    d.setAttribute("aria-hidden", "true");
    d.setAttribute("data-i", String(i));
    place(d, i, n);
    return d;
  }

  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var slideTimer = null, pendingAnim = null;

  // Draw the tiles. With anim, the old tiles first slide along their
  // paths, then the board is redrawn with the joined tiles popping and
  // the new tile growing in.
  function renderBoard(anim) {
    var el = $("board"), n = game.n;
    if (el.getAttribute("data-n") !== String(n)) {
      el.innerHTML = "";
      el.setAttribute("data-n", String(n));
      el.style.setProperty("--n", String(n));
      el.setAttribute("aria-label", t("board.label", { n: n }));
      var bg = document.createElement("div");
      bg.className = "grid";
      for (var i = 0; i < n * n; i++) bg.appendChild(document.createElement("span"));
      el.appendChild(bg);
      var layer = document.createElement("div");
      layer.className = "tiles";
      el.appendChild(layer);
      layoutBoard();
    }
    el.classList.toggle("over", !!game.over);
    if (anim && !reduced) {
      var layerNow = el.querySelector(".tiles"), byCell = {};
      [].forEach.call(layerNow.children, function (d) { byCell[d.getAttribute("data-i")] = d; });
      anim.paths.forEach(function (p) {
        var d = byCell[String(p.from)];
        if (d) { place(d, p.to, n); d.classList.add("moving"); }
      });
      pendingAnim = anim;
      clearTimeout(slideTimer);
      slideTimer = setTimeout(flushSlide, SLIDE_MS);
      return;
    }
    drawTiles(anim);
  }

  function flushSlide() {
    if (!pendingAnim) return;
    clearTimeout(slideTimer);
    var a = pendingAnim;
    pendingAnim = null;
    drawTiles(a);
  }

  function drawTiles(anim) {
    var el = $("board"), n = game.n, layer = el.querySelector(".tiles");
    layer.innerHTML = "";
    var joined = {};
    if (anim && !reduced) anim.joined.forEach(function (i) { joined[i] = true; });
    for (var i = 0; i < game.cells.length; i++) {
      var v = game.cells[i];
      if (!v) continue;
      var extra = joined[i] ? "pop" : (anim && !reduced && i === anim.spawned ? "new" : "");
      layer.appendChild(makeTile(v, i, n, extra));
    }
  }

  // A move that changes nothing: a small shake toward that side.
  function nudge(dir) {
    if (reduced) return;
    var el = $("board");
    el.classList.remove("nudge0", "nudge1", "nudge2", "nudge3");
    void el.offsetWidth;
    el.classList.add("nudge" + dir);
    setTimeout(function () { el.classList.remove("nudge" + dir); }, 200);
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
  function sizeName(n) { return n + "×" + n; }

  function winDialog() {
    if (!game || game.over || !game.won) return;
    var tg = TARGET[game.n];
    var dlg = makeDialog("g2048-win");
    dlg.appendChild(el("div", "dlg-title", sizeName(game.n)));
    dlg.appendChild(el("div", "dlg-hero", t("win.title", { t: tg })));
    dlg.appendChild(el("div", "dlg-msg", t("win.msg")));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("win.end"), "", function () {
      dlg.close();
      if (game && !game.over) { game.over = true; finish(); }
    }));
    var more = button(t("win.more"), "primary", function () { dlg.close(); });
    acts.appendChild(more);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    more.focus();
  }

  function resultDialog(rec) {
    if (!game || !game.over) return;           // replaced meanwhile
    closeDialogs();
    var s = totals("n" + game.n);
    var dlg = makeDialog("g2048-result");
    dlg.appendChild(el("div", "dlg-title", t("res.title") + " · " + sizeName(game.n)));
    dlg.appendChild(el("div", "dlg-hero", fmtNum(game.score)));
    if (rec) dlg.appendChild(el("div", "dlg-badge", t("res.rec")));
    if (game.undone) dlg.appendChild(el("div", "dlg-msg dlg-note", t("res.noRec")));
    dlg.appendChild(row(t("res.tile"), String(maxTile(game.cells))));
    dlg.appendChild(row(t("res.best"), fmtNum(s.s)));
    dlg.appendChild(row(t("res.bestTile"), s.v ? String(s.v) : "–"));
    dlg.appendChild(row(t("res.games"), String(s.g)));
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
    flushSlide();
    var dlg = makeDialog("g2048-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    SIZES.forEach(function (n) {
      var s = totals("n" + n);
      if (s.g) empty = false;
      dlg.appendChild(row(sizeName(n) + " · " + TARGET[n],
        s.g ? fmtNum(s.s) + " · " + (s.v || "–") + " · " + s.g + " · " + s.w : "–"));
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
    var dlg = makeDialog("g2048-confirm");
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
    data = mergeG2048(data, data);
    save();
    renderStatus();
    showToast(t("toast.reset"));
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "g2048", title: String(text) })) return;
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
      if (kind === "join") tone(560, 0, 0.06, "triangle", 0.1);
      else if (kind === "big") { tone(660, 0, 0.07, "triangle", 0.12); tone(880, 0.06, 0.09, "triangle", 0.1); }
      else if (kind === "win") {
        [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
      } else if (kind === "over") {
        [392, 330, 262].forEach(function (f, k) { tone(f, k * 0.14, 0.2, "triangle", 0.12); });
      }
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

  // ---------- 10. Input ----------
  // Swipe anywhere on the board (decided on release).
  var down = null;
  function wirePointer() {
    var board = $("board");
    board.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY };
    });
    board.addEventListener("pointerup", function (e) {
      if (!down) return;
      var dx = e.clientX - down.x, dy = e.clientY - down.y;
      down = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;
      play(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
    });
    board.addEventListener("pointercancel", function () { down = null; });
  }

  var KEY_DIR = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3,
                  KeyW: 0, KeyD: 1, KeyS: 2, KeyA: 3 };

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;   // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      var d = KEY_DIR[e.code] !== undefined ? KEY_DIR[e.code] : KEY_DIR[e.key];
      if (d !== undefined) { e.preventDefault(); play(d); return; }
      if (e.repeat) return;
      if (e.code === "KeyN") { e.preventDefault(); newGame(true); return; }
      if (e.code === "KeyU") { e.preventDefault(); undo(); }
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
    api.registerSlice("g2048", sliceGet, sliceSet, STORAGE_KEY, mergeG2048);
  }

  function sliceGet() {
    return mergeG2048(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeG2048(incoming, incoming);
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
  }

  function paintStatic() {
    [["undo-btn", "undo", "btn.undo"], ["new-btn", "new", "btn.new"],
     ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    paintSfxBtn();
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#size-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () {
        var n = +b.getAttribute("data-size");
        if (game && n === game.n && !game.over) return;   // visible active state
        prefs.n = n; savePrefs(); newGame(true);
      });
    });
    $("undo-btn").addEventListener("click", undo);
    $("new-btn").addEventListener("click", function () { newGame(true); $("new-btn").blur(); });
    $("stats-btn").addEventListener("click", statsDialog);
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("join");   // audible confirmation when turned on
    });
    wirePointer();

    var relayout = function () { layoutBoard(); };
    if (window.ResizeObserver) new ResizeObserver(relayout).observe($("board-wrap"));
    else window.addEventListener("resize", relayout);

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
    game = loadSession();
    if (game) prefs.n = game.n;                // the resumed game decides the toolbar
    else { game = fresh(); saveSession(); }
    renderAll(null);
  }

  boot();
})();
