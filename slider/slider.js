// ============================================================
// orOS Number Slider — App logic (v1.0.0)
// The sliding puzzle: put the numbered tiles in order by sliding
// them into the empty square. 3×3 (8 tiles), 4×4 (15, the classic),
// 5×5 (24). Every shuffle is solvable and never already solved.
//   - tap a tile in the empty square's row or column (several tiles
//     move at once; each tile moved counts as one move), swipe, or
//     arrow keys (push a tile into the empty square)
//   - moves and time; time runs only while the app is visible
//   - a game in progress is kept on the device and resumes
// Data:
//   - synced slice "slider" (oros-slider-data): per size the best
//     time, the fewest moves and the games solved, as per-device rows
//     (each device only grows its own row; merge = per-row join)
//     + a reset stamp br
//   - device-local (R10): oros-slider-prefs (size),
//     oros-slider-session (the game in progress), oros-slider-device
//     (row id), oros-slider-sfx (sound on/off)
// Sections:
//   1. Constants, i18n, helpers
//   2. Puzzle model (shuffle, solvability, slide, solved)
//   3. Synced data: load / save / normalize / merge (R5, R26)
//   4. Device-local prefs + session
//   5. Game flow (new, move, timer, finish)
//   6. Render (toolbar, status, board, tiles)
//   7. Dialogs (result, records, confirm)
//   8. Toasts
//   9. Sound
//  10. Input (tap, swipe, keyboard, Contract Β)
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-slider-data";
  var PREFS_KEY   = "oros-slider-prefs";
  var SESSION_KEY = "oros-slider-session";
  var DEVICE_KEY  = "oros-slider-device";
  var SFX_KEY     = "oros-slider-sfx";
  var DATA_VER    = 1;

  var SIZES = [3, 4, 5];
  var KEYS = ["n3", "n4", "n5"];
  var MAX_MS = 360000000;                    // 100 h: anything above is junk
  var SWIPE_PX = 24;

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
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "st.moves": "Moves", "st.time": "Time",
      "turn.start": "Slide a tile to start",
      "turn.play": "Put the numbers in order",
      "turn.done": "Solved!",
      "board.label": "Puzzle, {n} by {n}",
      "tile.label": "Tile {v}",
      "tile.can": "Tile {v}, can move",
      "live.done": "Solved in {m} moves",
      "res.title": "Solved",
      "res.hero": "Well done!",
      "res.moves": "Moves",
      "res.time": "Time",
      "res.bestT": "Best time",
      "res.bestM": "Fewest moves",
      "res.solved": "Solved",
      "res.recT": "New best time!",
      "res.recM": "New fewest moves!",
      "res.again": "Play again",
      "res.close": "Close",
      "stats.title": "Records",
      "stats.head": "Best time · fewest moves · solved",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "confirm.reset": "Delete the records on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Records reset",
      "toast.newgame": "New puzzle",
      "toast.undo": "Undo",
      "toast.stuck": "Only tiles in the empty square's row or column can move",
      "toast.done": "Solved: start a new puzzle (N)",
      "toast.save": "Could not save: storage is full"
    },
    el: {
      "btn.new": "Νέο παιχνίδι (N)",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "st.moves": "Κινήσεις", "st.time": "Χρόνος",
      "turn.start": "Σύρε ένα πλακίδιο για να ξεκινήσεις",
      "turn.play": "Βάλε τους αριθμούς στη σειρά",
      "turn.done": "Λύθηκε!",
      "board.label": "Παζλ, {n} επί {n}",
      "tile.label": "Πλακίδιο {v}",
      "tile.can": "Πλακίδιο {v}, μπορεί να κινηθεί",
      "live.done": "Λύθηκε σε {m} κινήσεις",
      "res.title": "Λύθηκε",
      "res.hero": "Μπράβο!",
      "res.moves": "Κινήσεις",
      "res.time": "Χρόνος",
      "res.bestT": "Καλύτερος χρόνος",
      "res.bestM": "Λιγότερες κινήσεις",
      "res.solved": "Λυμένα",
      "res.recT": "Νέο ρεκόρ χρόνου!",
      "res.recM": "Νέο ρεκόρ κινήσεων!",
      "res.again": "Ξανά",
      "res.close": "Κλείσιμο",
      "stats.title": "Ρεκόρ",
      "stats.head": "Χρόνος · κινήσεις · λυμένα",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.newgame": "Νέο παζλ",
      "toast.undo": "Αναίρεση",
      "toast.stuck": "Κινούνται μόνο πλακίδια στη γραμμή ή στη στήλη του κενού",
      "toast.done": "Λύθηκε: ξεκίνα νέο παζλ (N)",
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
    console.log("slider.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Puzzle model ----------
  // tiles[r * n + c] = tile number 1…n²-1, or 0 for the empty square.
  // Solved: 1, 2, …, n²-1, then the empty square.
  function solvedTiles(n) {
    var out = [];
    for (var i = 1; i < n * n; i++) out.push(i);
    out.push(0);
    return out;
  }
  function isSolved(tiles) {
    for (var i = 0; i < tiles.length - 1; i++) if (tiles[i] !== i + 1) return false;
    return tiles[tiles.length - 1] === 0;
  }

  // Odd n: solvable iff the inversion count is even. Even n: iff the
  // inversions plus the empty square's row (from the top) is odd.
  function isSolvable(tiles, n) {
    var inv = 0, blank = tiles.indexOf(0);
    for (var i = 0; i < tiles.length; i++) {
      if (!tiles[i]) continue;
      for (var j = i + 1; j < tiles.length; j++) if (tiles[j] && tiles[j] < tiles[i]) inv++;
    }
    return n % 2 ? inv % 2 === 0 : (inv + Math.floor(blank / n)) % 2 === 1;
  }

  // Tiles out of place (the empty square not counted).
  function misplaced(tiles) {
    var k = 0;
    for (var i = 0; i < tiles.length; i++) if (tiles[i] && tiles[i] !== i + 1) k++;
    return k;
  }

  // A random solvable arrangement, never solved, with most tiles out of place.
  function shuffle(n) {
    var N = n * n;
    while (true) {
      var a = solvedTiles(n);
      for (var i = N - 1; i > 0; i--) {
        var j = randInt(i + 1), x = a[i]; a[i] = a[j]; a[j] = x;
      }
      if (!isSolvable(a, n)) {
        // swapping two tiles flips the parity
        var p = a[0] && a[1] ? 0 : 2, q = p + 1;
        var y = a[p]; a[p] = a[q]; a[q] = y;
      }
      if (isSolvable(a, n) && misplaced(a) >= N - 3) return a;
    }
  }

  // Slide toward the empty square from tile index idx (same row or
  // column). Returns { tiles, moved } or null when idx cannot move.
  function slide(tiles, n, idx) {
    var b = tiles.indexOf(0);
    if (idx === b || idx < 0 || idx >= tiles.length) return null;
    var br = Math.floor(b / n), bc = b % n, r = Math.floor(idx / n), c = idx % n;
    var step;
    if (r === br) step = c < bc ? -1 : 1;
    else if (c === bc) step = r < br ? -n : n;
    else return null;
    var out = tiles.slice(), cur = b, moved = 0;
    while (cur !== idx) {
      out[cur] = out[cur + step];
      cur += step;
      moved++;
    }
    out[idx] = 0;
    return { tiles: out, moved: moved };
  }

  // The tile that an arrow (dr, dc) pushes into the empty square: the
  // neighbour on the opposite side. -1 if there is none.
  function pushFrom(tiles, n, dr, dc) {
    var b = tiles.indexOf(0), r = Math.floor(b / n) - dr, c = b % n - dc;
    return (r < 0 || r >= n || c < 0 || c >= n) ? -1 : r * n + c;
  }

  // ---------- 3. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                       // max-merged
  //   rows: { <deviceId>: { b: <epoch>,
  //                         s: { n3|n4|n5: { t: best ms, m: fewest moves, g: solved } } } }
  // }
  // Each device only ever writes ITS OWN row; a row counts from epoch b.
  // Merge per row: the newer epoch wins; equal epochs take, per size,
  // the lower t, the lower m and the higher g. Rows older than br drop.
  // A join (symmetric, associative, idempotent).
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normCell(v) {
    if (!v || typeof v !== "object" || !isInt(v.t) || !isInt(v.m) || !isInt(v.g) ||
        v.t < 1 || v.t > MAX_MS || v.m < 1 || v.g < 1) return null;
    return { t: v.t, m: v.m, g: v.g };
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

  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var s = {};
    KEYS.forEach(function (k) {
      var a = x.s[k], c = y.s[k];
      if (!a && !c) return;
      if (!a || !c) { s[k] = normCell(a || c); return; }
      s[k] = { t: Math.min(a.t, c.t), m: Math.min(a.m, c.m), g: Math.max(a.g, c.g) };
    });
    return { b: x.b, s: s };
  }

  function mergeSlider(A, B) {
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

  // Best time, fewest moves (0 = none yet) and games solved, all devices.
  function totals(key) {
    var out = { t: 0, m: 0, g: 0 };
    Object.keys(data.rows).forEach(function (id) {
      var c = data.rows[id].s[key];
      if (!c) return;
      out.g += c.g;
      if (!out.t || c.t < out.t) out.t = c.t;
      if (!out.m || c.m < out.m) out.m = c.m;
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
          data = mergeSlider(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] slider: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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

  // Counts a solved puzzle; returns which records it beat.
  function countSolve(key, ms, moves) {
    var before = totals(key);
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // new epoch after a reset
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    var c = row.s[key];
    ms = Math.max(1, Math.min(MAX_MS, ms));
    c = c ? { t: Math.min(c.t, ms), m: Math.min(c.m, moves), g: c.g + 1 } : { t: ms, m: moves, g: 1 };
    row.s[key] = c;
    data.rows[deviceId] = row;
    data = mergeSlider(data, data);
    save();
    return { t: !before.t || ms < before.t, m: !before.m || moves < before.m };
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

  // game = { n, tiles: [...], moves, ms (time played), done }
  var game = null;

  function validSession(g) {
    if (!g || typeof g !== "object" || SIZES.indexOf(g.n) < 0 || !Array.isArray(g.tiles) ||
        g.tiles.length !== g.n * g.n || !isInt(g.moves) || g.moves < 0 ||
        !isInt(g.ms) || g.ms < 0 || g.ms > MAX_MS) return false;
    var seen = {};
    for (var i = 0; i < g.tiles.length; i++) {
      var v = g.tiles[i];
      if (!isInt(v) || v < 0 || v >= g.tiles.length || seen[v]) return false;
      seen[v] = true;
    }
    return isSolvable(g.tiles, g.n);
  }
  function loadSession() {
    try {
      var g = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(g)) { g.done = isSolved(g.tiles); return g; }
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
    return { n: prefs.n, tiles: shuffle(prefs.n), moves: 0, ms: 0, done: false };
  }
  function inProgress() { return !!(game && !game.done && game.moves > 0); }

  // A game in progress is never lost silently: Undo toast (R14).
  function newGame(announce) {
    if (game) syncClock();
    var prev = inProgress() ? JSON.parse(JSON.stringify(game)) : null;
    var prevN = game ? game.n : prefs.n;
    runFrom = 0;
    game = fresh();
    saveSession();
    syncClock();
    renderAll(true);
    if (prev) {
      undoToast(t("toast.newgame"), function () {
        runFrom = 0;
        prefs.n = prevN; savePrefs();
        game = prev;
        saveSession();
        syncClock();
        renderAll(true);
      });
    } else if (announce) {
      live(t("toast.newgame"));
    }
  }

  // Move from tile index idx (tap, swipe, key).
  function move(idx) {
    if (!game) return;
    if (game.done) { showToast(t("toast.done")); return; }              // R28
    var res = slide(game.tiles, game.n, idx);
    if (!res) { showToast(t("toast.stuck")); return; }
    var first = game.moves === 0;
    game.tiles = res.tiles;
    game.moves += res.moved;
    if (first) syncClock();                    // the clock starts with the first move
    sfx("move");
    if (isSolved(game.tiles)) { finish(); return; }
    saveSession();
    renderAll(false);
  }

  function finish() {
    syncClock();
    game.done = true;
    syncClock();                               // stops the clock at the solve
    var rec = countSolve("n" + game.n, game.ms, game.moves);
    saveSession();
    renderAll(false);
    live(t("live.done", { m: game.moves }));
    sfx("win");
    setTimeout(function () { resultDialog(rec); }, 650);
  }

  // ---------- 6. Render ----------
  function renderAll(rebuild) {
    renderToolbar();
    renderStatus();
    if (rebuild) buildBoard(); else renderTiles();
  }

  function renderToolbar() {
    [].forEach.call(document.querySelectorAll("#size-seg .seg-btn"), function (b) {
      var on = +b.getAttribute("data-size") === (game ? game.n : prefs.n);
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    paintSfxBtn();
  }

  function renderClock() {
    if (game) $("time").textContent = fmtTime(elapsed());
  }

  function renderStatus() {
    if (!game) return;
    $("moves").textContent = String(game.moves);
    renderClock();
    $("turn").textContent = game.done ? t("turn.done") : t(game.moves ? "turn.play" : "turn.start");
    $("turn").className = game.done ? "done" : "";
  }

  function layoutBoard() {
    var wrap = $("board-wrap"), el = $("board");
    var cs = getComputedStyle(wrap);
    var W = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var H = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (W <= 0 || H <= 0) return;
    el.style.setProperty("--size", Math.floor(Math.max(220, Math.min(W, H, 560))) + "px");
  }

  function buildBoard() {
    var el = $("board"), n = game.n;
    el.innerHTML = "";
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", t("board.label", { n: n }));
    el.style.setProperty("--n", String(n));
    for (var v = 1; v < n * n; v++) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tile";
      b.setAttribute("data-v", String(v));
      b.tabIndex = -1;
      b.textContent = String(v);
      el.appendChild(b);
    }
    el.classList.add("still");                 // no slide animation while building
    layoutBoard();
    renderTiles();
    void el.offsetWidth;
    el.classList.remove("still");
  }

  // Tiles stay in the DOM in number order; their position is a transform,
  // so a move slides them.
  function renderTiles() {
    var el = $("board"), n = game.n;
    el.classList.toggle("over", !!game.done);
    var b = game.tiles.indexOf(0), focusable = -1;
    for (var i = 0; i < game.tiles.length; i++) {
      var v = game.tiles[i];
      if (!v) continue;
      var tile = el.children[v - 1];
      var r = Math.floor(i / n), c = i % n;
      tile.style.transform = "translate(" + (c * 100) + "%, " + (r * 100) + "%)";
      tile.setAttribute("data-i", String(i));
      tile.classList.toggle("home", v === i + 1);
      var can = !game.done && (r === Math.floor(b / n) || c === b % n);
      tile.classList.toggle("can", can);
      tile.setAttribute("aria-label", t(can ? "tile.can" : "tile.label", { v: v }));
      if (can && focusable < 0) focusable = v - 1;
    }
    // roving tabindex: keep focus where it was, else the first movable tile
    var keep = document.activeElement && document.activeElement.classList &&
               document.activeElement.classList.contains("tile");
    for (var k = 0; k < el.children.length; k++) {
      var on = keep ? el.children[k] === document.activeElement : k === Math.max(0, focusable);
      el.children[k].tabIndex = on ? 0 : -1;
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
  function sizeName(n) { return n + "×" + n; }

  function resultDialog(rec) {
    if (!game || !game.done) return;           // replaced meanwhile
    var s = totals("n" + game.n);
    var dlg = makeDialog("slider-result");
    dlg.appendChild(el("div", "dlg-title", t("res.title") + " · " + sizeName(game.n)));
    dlg.appendChild(el("div", "dlg-hero", t("res.hero")));
    if (rec.t) dlg.appendChild(el("div", "dlg-badge", t("res.recT")));
    if (rec.m) dlg.appendChild(el("div", "dlg-badge", t("res.recM")));
    dlg.appendChild(row(t("res.moves"), String(game.moves)));
    dlg.appendChild(row(t("res.time"), fmtTime(game.ms)));
    dlg.appendChild(row(t("res.bestT"), fmtTime(s.t)));
    dlg.appendChild(row(t("res.bestM"), String(s.m)));
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
    var dlg = makeDialog("slider-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    SIZES.forEach(function (n) {
      var s = totals("n" + n);
      if (s.g) empty = false;
      dlg.appendChild(row(sizeName(n), s.g ? fmtTime(s.t) + " · " + s.m + " · " + s.g : "–"));
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
    var dlg = makeDialog("slider-confirm");
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
    data = mergeSlider(data, data);
    save();
    showToast(t("toast.reset"));
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "slider", title: String(text) })) return;
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
      if (kind === "move") tone(620, 0, 0.05, "triangle", 0.1);
      else if (kind === "win") {
        [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
      }
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Toolbar icons (R9: injected by JS) ----------
  var UI_ICONS = {
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
  // Pointer: a tap moves the tile under it; a swipe pushes the tile next
  // to the empty square in the swipe's direction.
  var down = null;
  function wirePointer() {
    var board = $("board");
    board.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      var tile = e.target.closest && e.target.closest(".tile");
      down = { x: e.clientX, y: e.clientY, i: tile ? +tile.getAttribute("data-i") : -1 };
    });
    board.addEventListener("pointerup", function (e) {
      if (!down) return;
      var dx = e.clientX - down.x, dy = e.clientY - down.y, d = down;
      down = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_PX) {
        var h = Math.abs(dx) > Math.abs(dy);
        var from = pushFrom(game.tiles, game.n, h ? 0 : (dy > 0 ? 1 : -1), h ? (dx > 0 ? 1 : -1) : 0);
        if (from >= 0) move(from); else showToast(t("toast.stuck"));
      } else if (d.i >= 0) {
        move(d.i);
      }
    });
    board.addEventListener("pointercancel", function () { down = null; });
    // keyboard activation (Enter / Space on a focused tile) has detail 0
    board.addEventListener("click", function (e) {
      var tile = e.target.closest && e.target.closest(".tile");
      if (tile && e.detail === 0) move(+tile.getAttribute("data-i"));
    });
  }

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;   // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      if (e.code === "KeyN") { e.preventDefault(); newGame(true); return; }
      var dir = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
      if (!dir) return;
      e.preventDefault();
      var from = pushFrom(game.tiles, game.n, dir[0], dir[1]);
      if (from >= 0) move(from); else showToast(t("toast.stuck"));
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
    api.registerSlice("slider", sliceGet, sliceSet, STORAGE_KEY, mergeSlider);
  }

  function sliceGet() {
    return mergeSlider(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeSlider(incoming, incoming);
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
    [["new-btn", "new", "btn.new"], ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
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
        if (game && n === game.n && !game.done) return;   // visible active state
        prefs.n = n; savePrefs(); newGame(true);
      });
    });
    $("new-btn").addEventListener("click", function () { newGame(true); $("new-btn").blur(); });
    $("stats-btn").addEventListener("click", statsDialog);
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("move");   // audible confirmation when turned on
    });
    $("board").addEventListener("focusin", function (e) {
      var tile = e.target.closest && e.target.closest(".tile");
      if (!tile) return;
      [].forEach.call($("board").children, function (x) { x.tabIndex = x === tile ? 0 : -1; });
    });
    wirePointer();

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
    if (game) prefs.n = game.n;                // the resumed game decides the toolbar
    else { game = fresh(); saveSession(); }
    syncClock();
    renderAll(true);
  }

  boot();
})();
