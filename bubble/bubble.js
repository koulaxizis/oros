// ============================================================
// orOS Bubble Shooter — App logic (v1.0.0)
// Shoot coloured bubbles into a hex-packed wall hanging from the
// ceiling. Three or more of one colour that touch pop; bubbles left
// hanging from nothing fall (bonus). Every few shots the ceiling drops
// one row; the game is lost when a bubble crosses the line, won when
// the wall is cleared.
//   - levels Easy / Normal / Hard (colours, starting rows, shots per
//     drop), each with its own records
//   - aim by dragging (or moving the mouse) over the field and let go
//     to shoot; the aim line shows the path with one bounce; arrows aim,
//     Space / Enter / Up shoot; S / Down or a tap on the next bubble
//     swaps; N new game
//   - the next bubble is shown; new bubbles only come in colours still
//     on the board; every colour also has its own symbol
//   - a game in progress is kept on the device and resumes
// Data:
//   - synced slice "bubble" (oros-bubble-data): per level the best
//     score (and when), games and wins, as per-device rows (each device
//     only grows its own row; merge = per-row join) + a reset stamp br
//   - device-local (R10): oros-bubble-prefs (level),
//     oros-bubble-session (the game in progress), oros-bubble-device
//     (row id), oros-bubble-sfx (sound on/off)
// Sections:
//   1. Constants, i18n, helpers
//   2. Game model (hex grid, trace + bounce, snap, clusters, floaters)
//   3. Synced data: load / save / normalize / merge (R5, R26)
//   4. Device-local prefs + session
//   5. Game flow (new, aim, shoot, resolve, finish)
//   6. Render (toolbar, status, canvas)
//   7. Dialogs (result, records, confirm)
//   8. Toasts
//   9. Sound
//  10. Input (drag aim, keyboard, Contract Β)
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-bubble-data";
  var PREFS_KEY   = "oros-bubble-prefs";
  var SESSION_KEY = "oros-bubble-session";
  var DEVICE_KEY  = "oros-bubble-device";
  var SFX_KEY     = "oros-bubble-sfx";
  var DATA_VER    = 1;

  // Field in bubble radii: COLS bubbles on even rows, COLS-1 on odd rows
  // (shifted half a bubble right). A bubble on row k (counted from the
  // top of the field, k = row + drop) has its centre at 1 + k × ROW_H.
  var COLS = 11;
  var W = COLS * 2;                          // 22
  var ROW_H = Math.sqrt(3);
  var LOSE = 11;                             // a bubble on row k ≥ LOSE has crossed the line
  var ROWS = LOSE + 2;                       // grid rows kept (relative to the ceiling)
  var LINE_Y = 1 + (LOSE - 0.5) * ROW_H;     // the line drawn on the field
  var SHOOT_Y = LINE_Y + 2.7;                // launcher centre
  var H = SHOOT_Y + 1.9;                     // field height
  var NEXT_X = 3.2, NEXT_Y = SHOOT_Y + 0.4;  // next-bubble preview
  var HIT = 1.7;                             // a shot stops this close to a bubble (2 = touching)
  var STEP = 0.2;                            // trace step
  var ANG_MIN = 8, ANG_MAX = 172;            // degrees from the right, upward
  var SPEED = 46;                            // radii per second in flight

  var LEVELS = ["l1", "l2", "l3"];
  var LEVEL = {
    l1: { colors: 4, rows: 5, every: 8 },
    l2: { colors: 5, rows: 6, every: 7 },
    l3: { colors: 6, rows: 7, every: 6 }
  };
  var NCOL = 6;
  var MAX_SCORE = 100000000;
  var CLEAR_BONUS = 1000;

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
      "lv.l1": "Easy", "lv.l2": "Normal", "lv.l3": "Hard",
      "btn.new": "New game (N)",
      "btn.swap": "Swap bubbles (S)",
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "st.score": "Score", "st.best": "Best",
      "turn.start": "Drag to aim, let go to shoot",
      "turn.startKeys": "Arrows aim, Space shoots",
      "turn.drop": "Ceiling drops in {n} shots",
      "turn.drop1": "Ceiling drops after this shot",
      "turn.won": "Cleared!",
      "turn.lost": "The bubbles reached the line",
      "board.label": "Bubble field: {n} bubbles, aim {a}°. Shooting {c}, next {x}",
      "c0": "red heart", "c1": "blue diamond", "c2": "green triangle",
      "c3": "yellow star", "c4": "purple square", "c5": "cyan ring",
      "live.pop": "{n} popped, {f} fell. Score {s}",
      "live.pop0": "{n} popped. Score {s}",
      "live.stick": "Stuck. Score {s}",
      "live.drop": "The ceiling dropped",
      "live.swap": "Shooting {c}, next {x}",
      "live.won": "Board cleared! Score {s}",
      "live.lost": "Game over. Score {s}",
      "res.won": "Cleared!",
      "res.lost": "Game over",
      "res.score": "Score",
      "res.best": "Best score",
      "res.games": "Games",
      "res.wins": "Cleared",
      "res.rec": "New best score!",
      "res.again": "Play again",
      "res.close": "Close",
      "stats.title": "Records",
      "stats.head": "Best score · games · cleared",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "confirm.reset": "Delete the records on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Records reset",
      "toast.newgame": "New game",
      "toast.level": "Level changed",
      "toast.undo": "Undo",
      "toast.over": "This game is over: start a new one (N)",
      "toast.busy": "Wait for the bubble to land",
      "toast.save": "Could not save: storage is full"
    },
    el: {
      "lv.l1": "Εύκολο", "lv.l2": "Κανονικό", "lv.l3": "Δύσκολο",
      "btn.new": "Νέο παιχνίδι (N)",
      "btn.swap": "Αλλαγή φούσκας (S)",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "st.score": "Σκορ", "st.best": "Ρεκόρ",
      "turn.start": "Σύρε για να σημαδέψεις, άφησε για βολή",
      "turn.startKeys": "Βελάκια για σημάδι, Space για βολή",
      "turn.drop": "Το ταβάνι κατεβαίνει σε {n} βολές",
      "turn.drop1": "Το ταβάνι κατεβαίνει μετά από αυτή τη βολή",
      "turn.won": "Καθάρισε!",
      "turn.lost": "Οι φούσκες έφτασαν τη γραμμή",
      "board.label": "Πεδίο με {n} φούσκες, σημάδι {a}°. Βολή: {c}, επόμενη: {x}",
      "c0": "κόκκινη καρδιά", "c1": "μπλε ρόμβος", "c2": "πράσινο τρίγωνο",
      "c3": "κίτρινο αστέρι", "c4": "μωβ τετράγωνο", "c5": "γαλάζιος κύκλος",
      "live.pop": "Έσκασαν {n}, έπεσαν {f}. Σκορ {s}",
      "live.pop0": "Έσκασαν {n}. Σκορ {s}",
      "live.stick": "Κόλλησε. Σκορ {s}",
      "live.drop": "Το ταβάνι κατέβηκε",
      "live.swap": "Βολή: {c}, επόμενη: {x}",
      "live.won": "Το πεδίο καθάρισε! Σκορ {s}",
      "live.lost": "Τέλος παιχνιδιού. Σκορ {s}",
      "res.won": "Καθάρισε!",
      "res.lost": "Τέλος παιχνιδιού",
      "res.score": "Σκορ",
      "res.best": "Καλύτερο σκορ",
      "res.games": "Παιχνίδια",
      "res.wins": "Καθαρίσματα",
      "res.rec": "Νέο ρεκόρ σκορ!",
      "res.again": "Ξανά",
      "res.close": "Κλείσιμο",
      "stats.title": "Ρεκόρ",
      "stats.head": "Καλύτερο σκορ · παιχνίδια · καθαρίσματα",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.newgame": "Νέο παιχνίδι",
      "toast.level": "Άλλαξε το επίπεδο",
      "toast.undo": "Αναίρεση",
      "toast.over": "Το παιχνίδι τελείωσε: ξεκίνα νέο (N)",
      "toast.busy": "Περίμενε να κολλήσει η φούσκα",
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
    console.log("bubble.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Game model ----------
  // grid[r][c] = colour 0…5, or -1 for an empty cell; r counts from the
  // ceiling, which sits drop rows below the top of the field.

  function rowLen(r) { return r % 2 ? COLS - 1 : COLS; }

  function cellXY(r, c, drop) {
    return [c * 2 + 1 + (r % 2), 1 + (r + drop) * ROW_H];
  }

  function emptyGrid() {
    var g = [];
    for (var r = 0; r < ROWS; r++) {
      var row = [];
      for (var c = 0; c < rowLen(r); c++) row.push(-1);
      g.push(row);
    }
    return g;
  }

  // The six neighbours of a cell (odd rows sit half a bubble right).
  function neighbors(r, c) {
    var odd = r % 2, out = [];
    var cand = [[r, c - 1], [r, c + 1],
                [r - 1, c - 1 + odd], [r - 1, c + odd],
                [r + 1, c - 1 + odd], [r + 1, c + odd]];
    cand.forEach(function (p) {
      if (p[0] >= 0 && p[0] < ROWS && p[1] >= 0 && p[1] < rowLen(p[0])) out.push(p);
    });
    return out;
  }

  // Where a bubble that stopped at (x, y) settles: the nearest empty cell
  // that hangs from the ceiling (row 0) or touches another bubble.
  function snapCell(grid, drop, x, y) {
    var best = null, bestD = Infinity;
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < rowLen(r); c++) {
        if (grid[r][c] >= 0) continue;
        var ok = r === 0;
        if (!ok) {
          var nb = neighbors(r, c);
          for (var k = 0; k < nb.length && !ok; k++) if (grid[nb[k][0]][nb[k][1]] >= 0) ok = true;
        }
        if (!ok) continue;
        var p = cellXY(r, c, drop), d = (p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y);
        if (d < bestD) { bestD = d; best = [r, c]; }
      }
    }
    return best;
  }

  // The flight of a shot from the launcher at angle deg (degrees from the
  // right, upward). It bounces off the side walls and stops at the
  // ceiling or next to a bubble. maxBounce limits the bounces (the aim
  // line shows one); then the trace ends where it is (cell null).
  // Returns { path: [[x, y]…] (start, each bounce, end), cell: [r, c] | null, bounces }.
  function trace(grid, drop, deg, maxBounce) {
    var a = deg * Math.PI / 180, dx = Math.cos(a), dy = -Math.sin(a);
    var x = W / 2, y = SHOOT_Y, path = [[x, y]], bounces = 0, ceil = 1 + drop * ROW_H;
    var lim = maxBounce === undefined ? 99 : maxBounce;
    for (var s = 0; s < 4000; s++) {
      var nx = x + dx * STEP, ny = y + dy * STEP;
      if (nx < 1 || nx > W - 1) {
        var wall = nx < 1 ? 1 : W - 1, f = (wall - x) / (nx - x);
        var by = y + (ny - y) * f;
        if (bounces >= lim) { path.push([wall, by]); return { path: path, cell: null, bounces: bounces }; }
        path.push([wall, by]);
        bounces++;
        dx = -dx;
        nx = 2 * wall - nx;
      }
      x = nx; y = ny;
      if (y <= ceil) {
        y = ceil;
        path.push([x, y]);
        return { path: path, cell: snapCell(grid, drop, x, y), bounces: bounces };
      }
      for (var r = 0; r < ROWS; r++) {
        var cy = 1 + (r + drop) * ROW_H;
        if (Math.abs(cy - y) >= HIT) continue;
        for (var c = 0; c < rowLen(r); c++) {
          if (grid[r][c] < 0) continue;
          var cx = c * 2 + 1 + (r % 2);
          if ((cx - x) * (cx - x) + (cy - y) * (cy - y) < HIT * HIT) {
            path.push([x, y]);
            return { path: path, cell: snapCell(grid, drop, x, y), bounces: bounces };
          }
        }
      }
    }
    path.push([x, y]);
    return { path: path, cell: snapCell(grid, drop, x, y), bounces: bounces };
  }

  // The group of same-coloured bubbles touching (r, c), as [[r, c]…].
  function cluster(grid, r, c) {
    var col = grid[r][c], seen = {}, out = [], stack = [[r, c]];
    if (col < 0) return out;
    seen[r + ":" + c] = true;
    while (stack.length) {
      var p = stack.pop();
      out.push(p);
      neighbors(p[0], p[1]).forEach(function (q) {
        var k = q[0] + ":" + q[1];
        if (!seen[k] && grid[q[0]][q[1]] === col) { seen[k] = true; stack.push(q); }
      });
    }
    return out;
  }

  // Bubbles that no longer hang from the ceiling through other bubbles.
  function floating(grid) {
    var seen = {}, stack = [], out = [], r, c;
    for (c = 0; c < rowLen(0); c++) if (grid[0][c] >= 0) { seen["0:" + c] = true; stack.push([0, c]); }
    while (stack.length) {
      var p = stack.pop();
      neighbors(p[0], p[1]).forEach(function (q) {
        var k = q[0] + ":" + q[1];
        if (!seen[k] && grid[q[0]][q[1]] >= 0) { seen[k] = true; stack.push(q); }
      });
    }
    for (r = 0; r < ROWS; r++) for (c = 0; c < rowLen(r); c++) {
      if (grid[r][c] >= 0 && !seen[r + ":" + c]) out.push([r, c]);
    }
    return out;
  }

  function colorsOn(grid) {
    var has = [], out = [];
    grid.forEach(function (row) { row.forEach(function (v) { if (v >= 0) has[v] = true; }); });
    for (var k = 0; k < NCOL; k++) if (has[k]) out.push(k);
    return out;
  }

  function countBubbles(grid) {
    var n = 0;
    grid.forEach(function (row) { row.forEach(function (v) { if (v >= 0) n++; }); });
    return n;
  }

  // Lowest row (counted from the top of the field) that holds a bubble, or -1.
  function lowestRow(grid, drop) {
    for (var r = ROWS - 1; r >= 0; r--) {
      for (var c = 0; c < rowLen(r); c++) if (grid[r][c] >= 0) return r + drop;
    }
    return -1;
  }

  function pickColor(cols, rnd) { return cols[Math.floor(rnd() * cols.length)]; }

  // A starting wall: rows of random colours from the level's set.
  function startGrid(lv, rnd) {
    var L = LEVEL[lv], g = emptyGrid();
    for (var r = 0; r < L.rows; r++) for (var c = 0; c < rowLen(r); c++) g[r][c] = Math.floor(rnd() * L.colors);
    return g;
  }

  // Points: 10 for each popped bubble; 20 for each one that falls, twice
  // that from 5 falling at once, three times from 10; clearing the
  // board adds CLEAR_BONUS.
  function points(popped, fell) {
    return popped * 10 + fell * 20 * (1 + Math.floor(fell / 5));
  }

  // Puts a bubble of colour col on cell; pops its group when it has 3+,
  // then drops what hangs from nothing. Returns a new grid and what went.
  function settle(grid, cell, col) {
    var g = grid.map(function (row) { return row.slice(); });
    g[cell[0]][cell[1]] = col;
    var grp = cluster(g, cell[0], cell[1]), popped = [], fell = [];
    if (grp.length >= 3) {
      grp.forEach(function (p) { popped.push([p[0], p[1], g[p[0]][p[1]]]); g[p[0]][p[1]] = -1; });
      floating(g).forEach(function (p) { fell.push([p[0], p[1], g[p[0]][p[1]]]); g[p[0]][p[1]] = -1; });
    }
    return { grid: g, popped: popped, fell: fell, gain: points(popped.length, fell.length) };
  }

  // ---------- 3. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                       // max-merged
  //   rows: { <deviceId>: { b: <epoch>,
  //                         s: { l1|l2|l3: { s: best score, ts: when, g: games, w: cleared } } } }
  // }
  // Each device only ever writes ITS OWN row; a row counts from epoch b.
  // Merge per row: the newer epoch wins; equal epochs take, per level,
  // the better score (higher s, then the earlier ts), the higher g and
  // w. Rows older than br drop. A join (symmetric, associative,
  // idempotent).
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normCell(c) {
    if (!c || typeof c !== "object" || !isInt(c.s) || !isInt(c.ts) || !isInt(c.g) || !isInt(c.w) ||
        c.s < 0 || c.s > MAX_SCORE || c.ts < 0 || c.g < 1 || c.w < 0 || c.w > c.g) return null;
    return { s: c.s, ts: c.ts, g: c.g, w: c.w };
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
    var best = (a.s !== c.s) ? (a.s > c.s ? a : c) : (a.ts <= c.ts ? a : c);
    return { s: best.s, ts: best.ts, g: Math.max(a.g, c.g), w: Math.max(a.w, c.w) };
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

  function mergeBubble(A, B) {
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

  // Best score, games and wins for a level, across every device.
  function totals(key) {
    var out = { s: 0, g: 0, w: 0 };
    Object.keys(data.rows).forEach(function (id) {
      var c = data.rows[id].s[key];
      if (!c) return;
      out.g += c.g;
      out.w += c.w;
      if (c.s > out.s) out.s = c.s;
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
          data = mergeBubble(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] bubble: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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

  // Counts a finished game; returns true for a new best score.
  function countGame(key, score, won) {
    var before = totals(key);
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // new epoch after a reset
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    var c = row.s[key] || { s: 0, ts: 0, g: 0, w: 0 };
    var sc = Math.min(MAX_SCORE, score);
    c = { s: c.s, ts: c.ts, g: c.g + 1, w: c.w + (won ? 1 : 0) };
    if (sc > c.s) { c.s = sc; c.ts = Date.now(); }
    row.s[key] = c;
    data.rows[deviceId] = row;
    data = mergeBubble(data, data);
    save();
    return sc > 0 && sc > before.s;
  }

  // ---------- 4. Device-local prefs + session ----------
  var prefs = { lv: "l1" };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object" && LEVELS.indexOf(p.lv) >= 0) prefs.lv = p.lv;
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = { lv, grid, drop, shots (since the last drop), score, cur, nxt,
  //          ang (degrees), moves, over, won }
  var game = null;

  function validGrid(g, ncol) {
    if (!Array.isArray(g) || g.length !== ROWS) return false;
    for (var r = 0; r < ROWS; r++) {
      if (!Array.isArray(g[r]) || g[r].length !== rowLen(r)) return false;
      for (var c = 0; c < g[r].length; c++) if (!isInt(g[r][c]) || g[r][c] < -1 || g[r][c] >= ncol) return false;
    }
    return true;
  }
  function validSession(g) {
    if (!g || typeof g !== "object" || LEVELS.indexOf(g.lv) < 0) return false;
    var L = LEVEL[g.lv];
    return validGrid(g.grid, L.colors) && isInt(g.drop) && g.drop >= 0 && g.drop <= LOSE &&
      isInt(g.shots) && g.shots >= 0 && g.shots < L.every && isInt(g.score) && g.score >= 0 &&
      g.score <= MAX_SCORE && isInt(g.cur) && g.cur >= 0 && g.cur < L.colors && isInt(g.nxt) &&
      g.nxt >= 0 && g.nxt < L.colors && typeof g.ang === "number" && g.ang >= ANG_MIN && g.ang <= ANG_MAX &&
      isInt(g.moves) && g.moves >= 0 && typeof g.over === "boolean" && typeof g.won === "boolean";
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
  var flight = null;     // { path, len, t0, col, cell } while a bubble flies
  var effects = [];      // popping and falling bubbles: { x, y, col, kind, t0, vx }
  var aimLive = false;   // the aim line shows (pointer over / dragging / keys used)
  var queued = false;    // a shot asked for while one was flying

  function fresh(lv) {
    var g = startGrid(lv, rand), cols = colorsOn(g);
    return { lv: lv, grid: g, drop: 0, shots: 0, score: 0, cur: pickColor(cols, rand), nxt: pickColor(cols, rand),
             ang: 90, moves: 0, over: false, won: false };
  }
  function inProgress() { return !!(game && !game.over && game.moves > 0); }

  // A game in progress is never lost silently: Undo toast (R14).
  function newGame(announce, msg) {
    closeDialogs();
    flight = null; effects = []; queued = false;
    var prev = inProgress() ? JSON.parse(JSON.stringify(game)) : null;
    game = fresh(prefs.lv);
    saveSession();
    renderAll();
    if (prev) {
      undoToast(msg || t("toast.newgame"), function () {
        prefs.lv = prev.lv; savePrefs();
        flight = null; effects = [];
        game = prev;
        saveSession();
        renderAll();
      });
    } else if (announce) {
      live(msg || t("toast.newgame"));
    }
  }

  function clampAng(a) { return Math.max(ANG_MIN, Math.min(ANG_MAX, a)); }

  function setAim(deg) {
    if (!game || game.over) return;
    game.ang = Math.round(clampAng(deg) * 10) / 10;
    aimLive = true;
    draw();
  }

  function shoot() {
    if (!game || document.querySelector("dialog[open]")) return;
    if (game.over) { showToast(t("toast.over")); return; }                  // R28
    if (flight) { queued = true; return; }                                // one at a time: the next waits
    var tr = trace(game.grid, game.drop, game.ang);
    var len = 0;
    for (var i = 1; i < tr.path.length; i++) {
      len += Math.hypot(tr.path[i][0] - tr.path[i - 1][0], tr.path[i][1] - tr.path[i - 1][1]);
    }
    var col = game.cur;
    game.cur = game.nxt;
    game.nxt = pickColor(colorsOn(game.grid), rand);
    sfx("shoot");
    if (reduced) { land(tr.cell, col); return; }
    flight = { path: tr.path, len: len, t0: nowMs(), col: col, cell: tr.cell };
    loop();
  }

  function swap() {
    if (!game || document.querySelector("dialog[open]")) return;
    if (game.over) { showToast(t("toast.over")); return; }
    if (flight) { showToast(t("toast.busy")); return; }                    // R28
    var x = game.cur;
    game.cur = game.nxt;
    game.nxt = x;
    saveSession();
    sfx("swap");
    draw();
    live(t("live.swap", { c: t("c" + game.cur), x: t("c" + game.nxt) }));
  }

  // The shot has landed: settle it, score, drop the ceiling, end?
  function land(cell, col) {
    flight = null;
    var L = LEVEL[game.lv], res = settle(game.grid, cell, col), now = nowMs();
    game.grid = res.grid;
    game.moves++;
    game.score = Math.min(MAX_SCORE, game.score + res.gain);
    if (!reduced) {
      res.popped.forEach(function (p) {
        var xy = cellXY(p[0], p[1], game.drop);
        effects.push({ x: xy[0], y: xy[1], col: p[2], kind: "pop", t0: now });
      });
      res.fell.forEach(function (p) {
        var xy = cellXY(p[0], p[1], game.drop);
        effects.push({ x: xy[0], y: xy[1], col: p[2], kind: "fall", t0: now, vx: (rand() - 0.5) * 6 });
      });
    }
    var left = countBubbles(game.grid), dropped = false;
    if (left) {
      game.shots++;
      if (game.shots >= L.every) { game.shots = 0; game.drop++; dropped = true; }
    }
    if (res.popped.length) sfx(res.fell.length ? "fall" : "pop");
    else sfx("stick");
    if (!left) {
      game.score = Math.min(MAX_SCORE, game.score + CLEAR_BONUS);
      finish(true);
      return;
    }
    if (lowestRow(game.grid, game.drop) >= LOSE) { finish(false); return; }
    // new bubbles only in colours still on the board
    var cols = colorsOn(game.grid);
    if (cols.indexOf(game.cur) < 0) game.cur = pickColor(cols, rand);
    if (cols.indexOf(game.nxt) < 0) game.nxt = pickColor(cols, rand);
    saveSession();
    renderAll();
    if (dropped) { live(t("live.drop")); sfx("drop"); shakeField(); }
    else if (res.popped.length) {
      live(res.fell.length ? t("live.pop", { n: res.popped.length, f: res.fell.length, s: game.score })
                           : t("live.pop0", { n: res.popped.length, s: game.score }));
    } else live(t("live.stick", { s: game.score }));
    if (effects.length) loop();
    if (queued) { queued = false; setTimeout(shoot, 0); }
  }

  function finish(won) {
    game.over = true;
    game.won = won;
    var rec = countGame(game.lv, game.score, won);
    saveSession();
    renderAll();
    if (effects.length) loop();
    live(t(won ? "live.won" : "live.lost", { s: fmtNum(game.score) }));
    sfx(won ? "win" : "over");
    setTimeout(function () { resultDialog(rec); }, 700);
  }

  // ---------- 6. Render ----------
  function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  var raf = 0;
  function loop() {
    if (raf) return;
    raf = requestAnimationFrame(frame);
  }
  function frame() {
    raf = 0;
    var now = nowMs();
    if (flight && (now - flight.t0) / 1000 * SPEED >= flight.len) {
      var f = flight;
      land(f.cell, f.col);
    }
    effects = effects.filter(function (e) { return now - e.t0 < (e.kind === "pop" ? 220 : 900); });
    draw();
    if (flight || effects.length) raf = requestAnimationFrame(frame);
  }

  function renderAll() {
    renderToolbar();
    renderStatus();
    draw();
  }

  function renderToolbar() {
    [].forEach.call(document.querySelectorAll("#lv-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-lv") === (game ? game.lv : prefs.lv);
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    $("swap-btn").disabled = !game || game.over;
    paintSfxBtn();
  }

  var coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  var usedKeys = false;

  function renderStatus() {
    if (!game) return;
    $("score").textContent = fmtNum(game.score);
    $("best").textContent = fmtNum(Math.max(totals(game.lv).s, game.score));
    var msg, cls = "", left = LEVEL[game.lv].every - game.shots;
    if (game.over) { msg = t(game.won ? "turn.won" : "turn.lost"); cls = game.won ? "done" : "warn"; }
    else if (!game.moves) msg = t(usedKeys ? "turn.startKeys" : "turn.start");
    else { msg = left === 1 ? t("turn.drop1") : t("turn.drop", { n: left }); if (left === 1) cls = "warn"; }
    $("turn").textContent = msg;
    $("turn").className = cls;
    $("board").setAttribute("aria-label", t("board.label", {
      n: countBubbles(game.grid), a: Math.round(game.ang), c: t("c" + game.cur), x: t("c" + game.nxt) }));
  }

  var scale = 20;
  function layoutBoard() {
    var wrap = $("board-wrap"), cv = $("board");
    var cs = getComputedStyle(wrap);
    var Wp = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var Hp = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (Wp <= 0 || Hp <= 0) return;
    scale = Math.max(8, Math.min(Wp / W, Hp / H, 30));
    var cw = Math.floor(W * scale), ch = Math.floor(H * scale), dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(cw * dpr);
    cv.height = Math.round(ch * dpr);
    cv.style.width = cw + "px";
    cv.style.height = ch + "px";
    draw();
  }

  var COLORS = {};
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ["--accent", "--panel-bg", "--bg-desktop", "--border", "--text-dim", "--text", "--bg", "--danger",
     "--bb-0", "--bb-1", "--bb-2", "--bb-3", "--bb-4", "--bb-5", "--bb-sym"].forEach(function (v) {
      COLORS[v] = cs.getPropertyValue(v).trim();
    });
  }
  var FALLBACK = ["#e5534b", "#3d8bfd", "#2fb36d", "#f0b429", "#a46ff5", "#22b8cf"];
  function colOf(k) { return COLORS["--bb-" + k] || FALLBACK[k]; }

  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // The symbol of each colour, centred on (x, y), size s (= radius).
  function symbol(ctx, k, x, y, s) {
    ctx.beginPath();
    if (k === 0) {                                     // heart
      var h = s * 0.5;
      ctx.moveTo(x, y + h * 0.95);
      ctx.bezierCurveTo(x - h * 1.5, y - h * 0.1, x - h * 0.75, y - h * 1.25, x, y - h * 0.45);
      ctx.bezierCurveTo(x + h * 0.75, y - h * 1.25, x + h * 1.5, y - h * 0.1, x, y + h * 0.95);
      ctx.fill();
    } else if (k === 1) {                              // diamond
      ctx.moveTo(x, y - s * 0.55); ctx.lineTo(x + s * 0.4, y); ctx.lineTo(x, y + s * 0.55); ctx.lineTo(x - s * 0.4, y);
      ctx.closePath(); ctx.fill();
    } else if (k === 2) {                              // triangle
      ctx.moveTo(x, y - s * 0.5); ctx.lineTo(x + s * 0.5, y + s * 0.38); ctx.lineTo(x - s * 0.5, y + s * 0.38);
      ctx.closePath(); ctx.fill();
    } else if (k === 3) {                              // star
      for (var i = 0; i < 10; i++) {
        var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? s * 0.24 : s * 0.55;
        if (i) ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath(); ctx.fill();
    } else if (k === 4) {                              // square
      ctx.rect(x - s * 0.36, y - s * 0.36, s * 0.72, s * 0.72); ctx.fill();
    } else {                                           // ring
      ctx.arc(x, y, s * 0.4, 0, Math.PI * 2);
      ctx.lineWidth = s * 0.2;
      ctx.stroke();
    }
  }

  function bubbleAt(ctx, k, x, y, rad, alpha) {
    var px = x * scale * DPR, py = y * scale * DPR, r = rad * scale * DPR;
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    var g = ctx.createRadialGradient(px - r * 0.35, py - r * 0.4, r * 0.1, px, py, r);
    g.addColorStop(0, "rgba(255,255,255,0.55)");
    g.addColorStop(0.35, colOf(k));
    g.addColorStop(1, colOf(k));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.strokeStyle = "rgba(0,0,0,0.28)";
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle = COLORS["--bb-sym"] || "rgba(15,12,8,0.55)";
    symbol(ctx, k, px, py + r * 0.04, r);
    ctx.globalAlpha = 1;
  }

  var DPR = 1;
  function draw() {
    var cv = $("board");
    if (!cv || !game || !cv.width) return;
    DPR = cv.width / (W * scale);
    var ctx = cv.getContext("2d"), S = scale * DPR, now = nowMs();
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = COLORS["--bg-desktop"] || "#1a1712";
    ctx.fillRect(0, 0, cv.width, cv.height);
    // the ceiling plate, lower after each drop
    var ceil = game.drop * ROW_H;
    if (ceil > 0) {
      ctx.fillStyle = COLORS["--panel-bg"] || "#1d1a13";
      ctx.fillRect(0, 0, cv.width, ceil * S);
      ctx.strokeStyle = COLORS["--border"] || "#322d20";
      ctx.lineWidth = Math.max(1, S * 0.06);
      for (var d = 1; d <= game.drop; d++) {
        ctx.beginPath(); ctx.moveTo(0, d * ROW_H * S); ctx.lineTo(cv.width, d * ROW_H * S); ctx.stroke();
      }
    }
    ctx.fillStyle = COLORS["--accent"] || "#d4af37";
    ctx.fillRect(0, ceil * S, cv.width, Math.max(2, S * 0.12));
    // the line
    ctx.strokeStyle = COLORS["--danger"] || "#e06c75";
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = Math.max(1, S * 0.08);
    ctx.setLineDash([S * 0.5, S * 0.35]);
    ctx.beginPath(); ctx.moveTo(0, LINE_Y * S); ctx.lineTo(cv.width, LINE_Y * S); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    // the wall
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < rowLen(r); c++) {
      if (game.grid[r][c] < 0) continue;
      var xy = cellXY(r, c, game.drop);
      bubbleAt(ctx, game.grid[r][c], xy[0], xy[1], 0.96);
    }
    // aim line: dots to the first bubble or the second wall
    if (!game.over && !flight && (aimLive || !coarse)) {
      var tr = trace(game.grid, game.drop, game.ang, 1);
      ctx.fillStyle = COLORS["--text"] || "#f0ead9";
      ctx.globalAlpha = 0.65;
      var gap = 0.9, carry = 0;
      for (var i = 1; i < tr.path.length; i++) {
        var a = tr.path[i - 1], b = tr.path[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (var u = carry; u < L; u += gap) {
          var q = u / L;
          ctx.beginPath();
          ctx.arc((a[0] + (b[0] - a[0]) * q) * S, (a[1] + (b[1] - a[1]) * q) * S, S * 0.13, 0, Math.PI * 2);
          ctx.fill();
        }
        carry = (u - L);
      }
      ctx.globalAlpha = 1;
    }
    // launcher: a ring and an arrow toward the aim
    var lx = W / 2 * S, ly = SHOOT_Y * S, ang = game.ang * Math.PI / 180;
    ctx.strokeStyle = COLORS["--text-dim"] || "#a89f8a";
    ctx.lineWidth = Math.max(1, S * 0.12);
    ctx.beginPath(); ctx.arc(lx, ly, S * 1.35, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = COLORS["--accent"] || "#d4af37";
    ctx.lineWidth = Math.max(2, S * 0.22);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(lx + Math.cos(ang) * S * 1.35, ly - Math.sin(ang) * S * 1.35);
    ctx.lineTo(lx + Math.cos(ang) * S * 2.1, ly - Math.sin(ang) * S * 2.1);
    ctx.stroke();
    ctx.lineCap = "butt";
    if (!game.over) {
      if (!flight) bubbleAt(ctx, game.cur, W / 2, SHOOT_Y, 0.96);
      // next bubble, with a swap hint
      bubbleAt(ctx, game.nxt, NEXT_X, NEXT_Y, 0.72);
      ctx.strokeStyle = COLORS["--text-dim"] || "#a89f8a";
      ctx.lineWidth = Math.max(1, S * 0.08);
      ctx.beginPath(); ctx.arc(NEXT_X * S, NEXT_Y * S, S * 1.05, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      // shots left before the ceiling drops
      var every = LEVEL[game.lv].every, left = every - game.shots;
      for (var k = 0; k < every; k++) {
        ctx.fillStyle = k < left ? (COLORS["--accent"] || "#d4af37") : (COLORS["--border"] || "#322d20");
        ctx.beginPath();
        ctx.arc((W - 1.2 - k * 0.7) * S, (SHOOT_Y + 0.6) * S, S * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // the flying bubble
    if (flight) {
      var dist = Math.min(flight.len, (now - flight.t0) / 1000 * SPEED), p = flight.path[0];
      for (var j = 1; j < flight.path.length; j++) {
        var p0 = flight.path[j - 1], p1 = flight.path[j], sl = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        if (dist <= sl || j === flight.path.length - 1) {
          var f = sl ? Math.min(1, dist / sl) : 1;
          p = [p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f];
          break;
        }
        dist -= sl;
      }
      bubbleAt(ctx, flight.col, p[0], p[1], 0.96);
    }
    // popping and falling bubbles
    effects.forEach(function (e) {
      var tt = (now - e.t0) / 1000;
      if (e.kind === "pop") bubbleAt(ctx, e.col, e.x, e.y, 0.96 * (1 + tt * 2.5), Math.max(0, 1 - tt / 0.22));
      else bubbleAt(ctx, e.col, e.x + e.vx * tt, e.y + 30 * tt * tt, 0.96, Math.max(0, 1 - tt / 0.9));
    });
    renderStatusLabel();
  }
  function renderStatusLabel() {
    if (!game) return;
    $("board").setAttribute("aria-label", t("board.label", {
      n: countBubbles(game.grid), a: Math.round(game.ang), c: t("c" + game.cur), x: t("c" + game.nxt) }));
  }

  function shakeField() {
    if (reduced) return;
    var el = $("board");
    el.classList.remove("shake");
    void el.offsetWidth;
    el.classList.add("shake");
    setTimeout(function () { el.classList.remove("shake"); }, 300);
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
    if (!game || !game.over) return;           // replaced meanwhile
    closeDialogs();
    var s = totals(game.lv);
    var dlg = makeDialog("bubble-result");
    dlg.appendChild(el("div", "dlg-title", t(game.won ? "res.won" : "res.lost") + " · " + t("lv." + game.lv)));
    dlg.appendChild(el("div", "dlg-hero", fmtNum(game.score)));
    if (rec) dlg.appendChild(el("div", "dlg-badge", t("res.rec")));
    dlg.appendChild(row(t("res.best"), fmtNum(s.s)));
    dlg.appendChild(row(t("res.games"), String(s.g)));
    dlg.appendChild(row(t("res.wins"), String(s.w)));
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
    var dlg = makeDialog("bubble-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    LEVELS.forEach(function (k) {
      var s = totals(k);
      if (s.g) empty = false;
      dlg.appendChild(row(t("lv." + k), s.g ? fmtNum(s.s) + " · " + s.g + " · " + s.w : "–"));
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
    var dlg = makeDialog("bubble-confirm");
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
    data = mergeBubble(data, data);
    save();
    renderStatus();
    showToast(t("toast.reset"));
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "bubble", title: String(text) })) return;
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
      if (kind === "shoot") tone(420, 0, 0.05, "triangle", 0.08);
      else if (kind === "swap") tone(700, 0, 0.04, "triangle", 0.08);
      else if (kind === "stick") tone(220, 0, 0.06, "triangle", 0.1);
      else if (kind === "pop") { tone(760, 0, 0.05, "triangle", 0.12); tone(1020, 0.04, 0.06, "triangle", 0.1); }
      else if (kind === "fall") [760, 900, 1080, 1280].forEach(function (f, k) { tone(f, k * 0.05, 0.07, "triangle", 0.1); });
      else if (kind === "drop") tone(140, 0, 0.18, "square", 0.06);
      else if (kind === "win") [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
      else if (kind === "over") [392, 330, 262].forEach(function (f, k) { tone(f, k * 0.14, 0.2, "triangle", 0.12); });
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Toolbar icons (R9: injected by JS) ----------
  var UI_ICONS = {
    new:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    swap:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4 3 8l4 4"/><path d="M3 8h13"/><path d="m17 12 4 4-4 4"/><path d="M21 16H8"/></svg>',
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
  // A point on the canvas in field units.
  function fieldPoint(e) {
    var r = $("board").getBoundingClientRect();
    return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H];
  }
  // The aim toward a field point (below the launcher: flat to that side).
  function angleTo(p) {
    var dx = p[0] - W / 2, dy = SHOOT_Y - p[1];
    if (dy < 0.3) dy = 0.3;
    return Math.atan2(dy, dx) * 180 / Math.PI;
  }

  // Drag (or move the mouse) to aim, let go to shoot; letting go below
  // the launcher cancels. A tap on the next bubble swaps.
  var drag = null;
  function wirePointer() {
    var cv = $("board");
    cv.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (!game) return;
      var p = fieldPoint(e);
      if (Math.hypot(p[0] - NEXT_X, p[1] - NEXT_Y) < 1.6) { swap(); return; }
      if (game.over) { showToast(t("toast.over")); return; }
      drag = { id: e.pointerId };
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      setAim(angleTo(p));
    });
    cv.addEventListener("pointermove", function (e) {
      if (!game || game.over) return;
      if (drag && e.pointerId === drag.id) { setAim(angleTo(fieldPoint(e))); return; }
      if (e.pointerType === "mouse" && !drag) setAim(angleTo(fieldPoint(e)));
    });
    cv.addEventListener("pointerup", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      var p = fieldPoint(e);
      if (p[1] > SHOOT_Y - 0.4) { aimLive = false; draw(); return; }      // let go below: no shot
      setAim(angleTo(p));
      shoot();
    });
    cv.addEventListener("pointercancel", function () { drag = null; });
    cv.addEventListener("pointerleave", function (e) {
      if (e.pointerType === "mouse" && !drag) { aimLive = false; draw(); }
    });
  }

  var held = {}, holdTimer = 0;
  function aimStep() {
    var d = (held.ArrowLeft ? 1 : 0) - (held.ArrowRight ? 1 : 0);
    if (!d || !game || game.over) { holdTimer = 0; return; }
    setAim(game.ang + d * 1.5);
    holdTimer = setTimeout(aimStep, 30);
  }

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;   // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        e.preventDefault();
        if (!usedKeys) { usedKeys = true; renderStatus(); }
        if (game && game.over) { showToast(t("toast.over")); return; }
        if (e.repeat) return;
        held[e.code] = true;
        if (game) setAim(game.ang + (e.code === "ArrowLeft" ? 2 : -2));
        clearTimeout(holdTimer);
        holdTimer = setTimeout(aimStep, 220);
        return;
      }
      if (e.code === "Space" || e.code === "ArrowUp" ||
          ((e.code === "Enter" || e.code === "NumpadEnter") && (tag === "BODY" || tag === "MAIN" || tag === "CANVAS"))) {
        e.preventDefault();
        if (e.repeat) return;
        aimLive = true;
        shoot();
        return;
      }
      if (e.repeat || e.shiftKey) return;
      if (e.code === "KeyS" || e.code === "ArrowDown") { e.preventDefault(); swap(); return; }
      if (e.code === "KeyN") { e.preventDefault(); newGame(true); }
    });
    document.addEventListener("keyup", function (e) {
      if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        held[e.code] = false;
        if (!held.ArrowLeft && !held.ArrowRight) { clearTimeout(holdTimer); holdTimer = 0; if (game) saveSession(); }
      }
    });
    window.addEventListener("blur", function () { held = {}; clearTimeout(holdTimer); });

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
    api.registerSlice("bubble", sliceGet, sliceSet, STORAGE_KEY, mergeBubble);
  }

  function sliceGet() {
    return mergeBubble(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeBubble(incoming, incoming);
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
    [["swap-btn", "swap", "btn.swap"], ["new-btn", "new", "btn.new"],
     ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    paintSfxBtn();
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#lv-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () {
        var lv = b.getAttribute("data-lv");
        if (game && lv === game.lv && !game.over) return;   // visible active state
        prefs.lv = lv; savePrefs(); newGame(true, t("toast.level"));
      });
    });
    $("swap-btn").addEventListener("click", swap);
    $("new-btn").addEventListener("click", function () { newGame(true); $("new-btn").blur(); });
    $("stats-btn").addEventListener("click", statsDialog);
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("pop");   // audible confirmation when turned on
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
    readColors();
    inheritPalette();
    watchPalette();
    game = loadSession();
    if (game) { prefs.lv = game.lv; savePrefs(); }   // the resumed game decides the toolbar
    else { game = fresh(prefs.lv); saveSession(); }
    layoutBoard();
    renderAll();
  }

  boot();
})();
