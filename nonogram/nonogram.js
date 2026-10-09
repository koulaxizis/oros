// ============================================================
// orOS Nonogram — App logic (v1.0.0)
// Paint the hidden picture: the numbers beside each row and above each
// column give the runs of filled cells in that line, in order, with at
// least one empty cell between runs.
//   - sizes 5×5 / 10×10 / 15×15, each with its own records
//   - every picture is made on the device (offline) from random,
//     smoothed noise and kept only when a line solver alone finishes
//     it, so every puzzle is fair: it never needs a guess
//   - Fill / Mark (✕) modes; drag paints a straight line; right-click
//     marks; a finished row or column dims its numbers
//   - arrows move, Space fills, X marks, Backspace clears, M switches
//     the mode, U undoes, H gives a hint (one cell: no time record)
//   - on a small screen 15×15 fits the width; the zoom button makes the
//     cells bigger and the board scrolls (drag the numbers to pan;
//     the numbers stay in view)
//   - a puzzle in progress is kept on the device and resumes
// Data:
//   - synced slice "nonogram" (oros-nonogram-data): per size the best
//     time (puzzles without hints only, and when), puzzles solved and
//     puzzles solved without hints, as per-device rows (each device
//     only grows its own row; merge = per-row join) + a reset stamp br
//   - device-local (R10): oros-nonogram-prefs (size, zoom),
//     oros-nonogram-session (the puzzle in progress), oros-nonogram-device
//     (row id), oros-nonogram-sfx (sound on/off)
// Sections:
//   1. Constants, i18n, helpers
//   2. Nonogram model (clues, line solver, maker, hint)
//   3. Synced data: load / save / normalize / merge (R5, R26)
//   4. Device-local prefs + session
//   5. Game flow (new, paint strokes, undo, hint, clock, finish)
//   6. Render (toolbar, status, board, clues)
//   7. Dialogs (result, records, confirm)
//   8. Toasts
//   9. Sound
//  10. Input (pointer strokes, keyboard, Contract Β)
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-nonogram-data";
  var PREFS_KEY   = "oros-nonogram-prefs";
  var SESSION_KEY = "oros-nonogram-session";
  var DEVICE_KEY  = "oros-nonogram-device";
  var SFX_KEY     = "oros-nonogram-sfx";
  var DATA_VER    = 1;

  var SIZES = [5, 10, 15];
  var KEYS = ["n5", "n10", "n15"];
  var GEN_MS = 600;                          // maker budget before it eases the pictures
  var MAX_MS = 360000000;                    // 100 h: anything above is junk
  var MAX_HIST = 300;
  // Cell states in a game: 0 open, 1 filled, 2 marked ✕.

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
      "mode.f": "Fill", "mode.x": "Mark",
      "mode.label": "Painting mode (M)",
      "size.label": "Size",
      "btn.new": "New puzzle",
      "btn.undo": "Undo (U)",
      "btn.hint": "Hint (H)",
      "btn.zoomIn": "Bigger cells (scroll the board)",
      "btn.zoomOut": "Fit the board",
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "st.time": "Time", "st.best": "Best",
      "turn.start": "Fill the cells the numbers ask for",
      "turn.play": "{d} of {n} lines done",
      "turn.hinted": "Hint used: no time record this puzzle",
      "turn.done": "Solved!",
      "board.label": "Nonogram, {n} by {n}. Arrows move, Space fills, X marks",
      "cell.at": "Row {r}, column {c}: {s}",
      "cell.0": "open", "cell.1": "filled", "cell.2": "marked",
      "clue.row": "Row {r}: {c}", "clue.col": "Column {c}: {v}",
      "live.done": "Solved in {t}",
      "live.hint": "Hint: row {r}, column {c} is {s}",
      "res.title": "Solved",
      "res.best": "Best time",
      "res.solved": "Solved",
      "res.hints": "Hints",
      "res.rec": "New best time!",
      "res.noRec": "A hint was used: no time record for this puzzle",
      "res.again": "New puzzle",
      "res.close": "Close",
      "stats.title": "Records",
      "stats.head": "Best time · solved · without hints",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "confirm.reset": "Delete the records on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Records reset",
      "toast.newgame": "New puzzle",
      "toast.undo": "Undo",
      "toast.noUndo": "Nothing to undo",
      "toast.noErase": "Nothing to clear in this cell",
      "toast.done": "Solved: start a new puzzle",
      "toast.hint": "Hint used: this puzzle sets no time record",
      "toast.noZoom": "The cells are already big enough here",
      "toast.save": "Could not save: storage is full"
    },
    el: {
      "mode.f": "Γέμισμα", "mode.x": "Σημάδι",
      "mode.label": "Τρόπος βαψίματος (M)",
      "size.label": "Μέγεθος",
      "btn.new": "Νέος γρίφος",
      "btn.undo": "Αναίρεση (U)",
      "btn.hint": "Βοήθεια (H)",
      "btn.zoomIn": "Μεγαλύτερα κελιά (κύλιση του πίνακα)",
      "btn.zoomOut": "Όλος ο πίνακας στην οθόνη",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "st.time": "Χρόνος", "st.best": "Ρεκόρ",
      "turn.start": "Γέμισε τα κελιά που ζητούν οι αριθμοί",
      "turn.play": "Έτοιμες {d} από {n} γραμμές",
      "turn.hinted": "Πήρες βοήθεια: χωρίς ρεκόρ χρόνου εδώ",
      "turn.done": "Λύθηκε!",
      "board.label": "Νονόγραμμα, {n} επί {n}. Βελάκια για κίνηση, Space γεμίζει, X σημαδεύει",
      "cell.at": "Γραμμή {r}, στήλη {c}: {s}",
      "cell.0": "κενό", "cell.1": "γεμάτο", "cell.2": "σημαδεμένο",
      "clue.row": "Γραμμή {r}: {c}", "clue.col": "Στήλη {c}: {v}",
      "live.done": "Λύθηκε σε {t}",
      "live.hint": "Βοήθεια: γραμμή {r}, στήλη {c}: {s}",
      "res.title": "Λύθηκε",
      "res.best": "Καλύτερος χρόνος",
      "res.solved": "Λυμένοι",
      "res.hints": "Βοήθειες",
      "res.rec": "Νέο ρεκόρ χρόνου!",
      "res.noRec": "Πήρες βοήθεια: χωρίς ρεκόρ χρόνου σε αυτόν τον γρίφο",
      "res.again": "Νέος γρίφος",
      "res.close": "Κλείσιμο",
      "stats.title": "Ρεκόρ",
      "stats.head": "Καλύτερος χρόνος · λυμένοι · χωρίς βοήθεια",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.newgame": "Νέος γρίφος",
      "toast.undo": "Αναίρεση",
      "toast.noUndo": "Τίποτα για αναίρεση",
      "toast.noErase": "Δεν υπάρχει κάτι να σβηστεί σε αυτό το κελί",
      "toast.done": "Λύθηκε: ξεκίνα νέο γρίφο",
      "toast.hint": "Πήρες βοήθεια: αυτός ο γρίφος δεν γράφει ρεκόρ χρόνου",
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
    console.log("nonogram.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Nonogram model ----------
  // A picture is an array of n * n cells (1 filled, 0 empty), row by row.

  // The runs of a line: [3, 1] for ■■■□■; [] for an empty line.
  function runsOf(line) {
    var out = [], run = 0;
    for (var i = 0; i < line.length; i++) {
      if (line[i] === 1) run++;
      else if (run) { out.push(run); run = 0; }
    }
    if (run) out.push(run);
    return out;
  }

  function rowOf(cells, n, r) { return cells.slice(r * n, r * n + n); }
  function colOf(cells, n, c) {
    var out = [];
    for (var r = 0; r < n; r++) out.push(cells[r * n + c]);
    return out;
  }

  function cluesOf(pic, n) {
    var rows = [], cols = [];
    for (var k = 0; k < n; k++) {
      rows.push(runsOf(rowOf(pic, n, k)));
      cols.push(runsOf(colOf(pic, n, k)));
    }
    return { rows: rows, cols: cols };
  }

  function sameRuns(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // Everything a single line tells, given its clue and what is known
  // (-1 unknown, 0 empty, 1 filled): a cell is settled when every way to
  // place the runs agrees on it. Returns the new line, or null when no
  // placement fits.
  function solveLine(clue, line) {
    var n = line.length, k = clue.length, i, j, s;
    // pre[i][j]: cells 0…i-1 can hold runs 0…j-1; suf[i][j]: cells i…n-1 hold runs j…k-1
    var pre = [], suf = [];
    for (i = 0; i <= n + 1; i++) { pre.push([]); suf.push([]); for (j = 0; j <= k; j++) { pre[i].push(false); suf[i].push(false); } }
    // no 0 inside [a, b)
    var empties = [0];
    for (i = 0; i < n; i++) empties.push(empties[i] + (line[i] === 0 ? 1 : 0));
    var clear = function (a, b) { return empties[b] - empties[a] === 0; };
    pre[0][0] = true;
    for (i = 1; i <= n; i++) {
      for (j = 0; j <= k; j++) {
        var v = pre[i - 1][j] && line[i - 1] !== 1;
        if (!v && j > 0) {
          var len = clue[j - 1], st = i - len;
          if (st >= 0 && clear(st, i)) {
            if (st === 0) v = j === 1;
            else v = line[st - 1] !== 1 && pre[st - 1][j - 1];
          }
        }
        pre[i][j] = v;
      }
    }
    suf[n][k] = true;
    for (i = n - 1; i >= 0; i--) {
      for (j = k; j >= 0; j--) {
        var w = suf[i + 1][j] && line[i] !== 1;
        if (!w && j < k) {
          var ln = clue[j], en = i + ln;
          if (en <= n && clear(i, en)) {
            if (en === n) w = j === k - 1;
            else w = line[en] !== 1 && suf[en + 1][j + 1];
          }
        }
        suf[i][j] = w;
      }
    }
    if (!pre[n][k]) return null;
    var canFill = [], canEmpty = [];
    for (i = 0; i <= n; i++) canFill.push(0);
    for (i = 0; i < n; i++) {
      canEmpty.push(false);
      if (line[i] === 1) continue;
      for (j = 0; j <= k && !canEmpty[i]; j++) if (pre[i][j] && suf[i + 1][j]) canEmpty[i] = true;
    }
    for (j = 0; j < k; j++) {
      var L = clue[j];
      for (s = 0; s + L <= n; s++) {
        if (!clear(s, s + L)) continue;
        var left = s === 0 ? j === 0 : (line[s - 1] !== 1 && pre[s - 1][j]);
        if (!left) continue;
        var right = s + L === n ? j === k - 1 : (line[s + L] !== 1 && suf[s + L + 1][j + 1]);
        if (!right) continue;
        canFill[s]++;
        canFill[s + L]--;
      }
    }
    var out = [], acc = 0;
    for (i = 0; i < n; i++) {
      acc += canFill[i];
      var f = acc > 0 && line[i] !== 0, e = canEmpty[i];
      if (!f && !e) return null;
      out.push(f && e ? -1 : (f ? 1 : 0));
    }
    return out;
  }

  // Line logic alone, row and column again and again until nothing
  // changes. Returns the grid (-1 where still unknown) or null on a
  // contradiction.
  function lineSolve(clues, n) {
    var g = [], i, rowDirty = [], colDirty = [];
    for (i = 0; i < n * n; i++) g.push(-1);
    for (i = 0; i < n; i++) { rowDirty.push(true); colDirty.push(true); }
    var changed = true;
    while (changed) {
      changed = false;
      for (var pass = 0; pass < 2; pass++) {
        var dirty = pass ? colDirty : rowDirty, other = pass ? rowDirty : colDirty;
        for (var k = 0; k < n; k++) {
          if (!dirty[k]) continue;
          dirty[k] = false;
          var line = pass ? colOf(g, n, k) : rowOf(g, n, k);
          var res = solveLine(pass ? clues.cols[k] : clues.rows[k], line);
          if (!res) return null;
          for (var j = 0; j < n; j++) {
            if (res[j] === line[j]) continue;
            g[pass ? j * n + k : k * n + j] = res[j];
            other[j] = true;
            changed = true;
          }
        }
      }
    }
    return g;
  }

  function solvedByLines(pic, n) {
    var g = lineSolve(cluesOf(pic, n), n);
    if (!g) return false;
    for (var i = 0; i < g.length; i++) if (g[i] !== pic[i]) return false;
    return true;
  }

  // A random picture: noise, smoothed into blobs on the bigger sizes,
  // sometimes mirrored. dens = the share of filled noise.
  function picture(n, rnd, dens) {
    var p = [], i, r, c;
    for (i = 0; i < n * n; i++) p.push(rnd() < dens ? 1 : 0);
    var passes = n >= 10 ? 1 : 0;
    for (var k = 0; k < passes; k++) {
      var q = [];
      for (r = 0; r < n; r++) {
        for (c = 0; c < n; c++) {
          var on = 0, all = 0;
          for (var dr = -1; dr <= 1; dr++) {
            for (var dc = -1; dc <= 1; dc++) {
              var rr = r + dr, cc = c + dc;
              if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
              all++;
              on += p[rr * n + cc];
            }
          }
          q.push(on * 2 > all ? 1 : (on * 2 < all ? 0 : p[r * n + c]));
        }
      }
      p = q;
    }
    if (n >= 10 && rnd() < 0.4) {
      for (r = 0; r < n; r++) for (c = 0; c < n / 2; c++) p[r * n + (n - 1 - c)] = p[r * n + c];
    }
    return p;
  }

  function fillShare(p) {
    var f = 0;
    for (var i = 0; i < p.length; i++) f += p[i];
    return f / p.length;
  }

  // A fair puzzle: a picture that line logic alone solves. After the
  // budget the pictures get denser (denser pictures settle sooner), so
  // the loop always ends; returns { pic, tries }.
  function makePuzzle(n, rnd, budgetMs, clock) {
    var t0 = clock(), tries = 0;
    for (;;) {
      tries++;
      var late = clock() - t0 > budgetMs;
      var dens = (n >= 10 ? 0.5 : 0.56) + rnd() * 0.08 + (late ? Math.min(0.35, tries * 0.005) : 0);
      var pic = picture(n, rnd, Math.min(0.95, dens)), share = fillShare(pic);
      if (share < 0.4 || share > (late ? 0.97 : 0.7)) continue;
      if (solvedByLines(pic, n)) return { pic: pic, tries: tries };
    }
  }

  // The cell a hint settles: the cursor when it is wrong or a missing
  // fill, else a wrong fill, else a missing fill. Returns { i, s } (the
  // right state: 1 fill, 2 mark) or null.
  function hintCell(pic, cells, sel, rnd) {
    var wrong = function (i) { return cells[i] === 1 ? pic[i] === 0 : pic[i] === 1; };
    if (sel >= 0 && sel < pic.length && wrong(sel)) return { i: sel, s: pic[sel] ? 1 : 2 };
    var bad = [], miss = [];
    for (var i = 0; i < pic.length; i++) {
      if (cells[i] === 1 && !pic[i]) bad.push(i);
      else if (pic[i] && cells[i] !== 1) miss.push(i);
    }
    if (bad.length) return { i: bad[Math.floor(rnd() * bad.length)], s: 2 };
    if (miss.length) return { i: miss[Math.floor(rnd() * miss.length)], s: 1 };
    return null;
  }

  // Solved when every row and column has the runs its clue asks for.
  function isSolved(clues, cells, n) {
    for (var k = 0; k < n; k++) {
      if (!sameRuns(runsOf(rowOf(cells, n, k)), clues.rows[k])) return false;
      if (!sameRuns(runsOf(colOf(cells, n, k)), clues.cols[k])) return false;
    }
    return true;
  }

  // ---------- 3. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                       // max-merged
  //   rows: { <deviceId>: { b: <epoch>,
  //                         s: { n5|n10|n15: { t: best ms (0 = none), ts: when,
  //                                            n: solved, c: solved without hints } } } }
  // }
  // Each device only ever writes ITS OWN row; a row counts from epoch b.
  // Merge per row: the newer epoch wins; equal epochs take, per size,
  // the better time (lower t > 0, then the earlier ts) and the higher n
  // and c. Rows older than br drop. A join (symmetric, associative,
  // idempotent).
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normCell(c) {
    if (!c || typeof c !== "object" || !isInt(c.t) || !isInt(c.ts) || !isInt(c.n) || !isInt(c.c) ||
        c.t < 0 || c.t > MAX_MS || c.ts < 0 || c.n < 1 || c.c < 0 || c.c > c.n ||
        (c.t > 0 && c.c < 1)) return null;
    return { t: c.t, ts: c.ts, n: c.n, c: c.c };
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
    var best;
    if (!a.t || !c.t) best = a.t ? a : c;
    else if (a.t !== c.t) best = a.t < c.t ? a : c;
    else best = a.ts <= c.ts ? a : c;
    if (!a.t && !c.t) best = a.ts <= c.ts ? a : c;
    return { t: best.t, ts: best.ts, n: Math.max(a.n, c.n), c: Math.max(a.c, c.c) };
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

  function mergeNonogram(A, B) {
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
      KEYS.forEach(function (k) { if (r.s[k]) s[k] = r.s[k]; });
      sorted[id] = { b: r.b, s: s };
    });
    return { ver: DATA_VER, br: br, rows: sorted };
  }

  // Best time, solved and clean solves for a size, across every device.
  function totals(key) {
    var out = { t: 0, n: 0, c: 0 };
    Object.keys(data.rows).forEach(function (id) {
      var c = data.rows[id].s[key];
      if (!c) return;
      out.n += c.n;
      out.c += c.c;
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
          data = mergeNonogram(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] nonogram: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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

  // Counts a solved puzzle; returns true for a new best time. A puzzle
  // with a hint counts as solved but sets no time.
  function countSolve(key, ms, hinted) {
    var before = totals(key);
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // new epoch after a reset
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    var c = row.s[key] || { t: 0, ts: 0, n: 0, c: 0 };
    c = { t: c.t, ts: c.ts, n: c.n + 1, c: c.c + (hinted ? 0 : 1) };
    ms = Math.max(1, Math.min(MAX_MS, ms));
    if (!hinted && (!c.t || ms < c.t)) { c.t = ms; c.ts = Date.now(); }
    row.s[key] = c;
    data.rows[deviceId] = row;
    data = mergeNonogram(data, data);
    save();
    return !hinted && (!before.t || ms < before.t);
  }

  // ---------- 4. Device-local prefs + session ----------
  var prefs = { n: 10, zoom: false };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (SIZES.indexOf(p.n) >= 0) prefs.n = p.n;
        if (typeof p.zoom === "boolean") prefs.zoom = p.zoom;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = { n, pic: "0101…", c: [cell states], ms, hints, done, sel,
  //          mode: "f" | "x", hist: [[[cell, old, new]…]…] }
  var game = null;
  var CLUES = null, PIC = null;

  function validSession(g) {
    if (!g || typeof g !== "object" || SIZES.indexOf(g.n) < 0 || typeof g.pic !== "string" ||
        g.pic.length !== g.n * g.n || !/^[01]+$/.test(g.pic) || !Array.isArray(g.c) ||
        g.c.length !== g.n * g.n || !isInt(g.ms) || g.ms < 0 || g.ms > MAX_MS ||
        !isInt(g.hints) || g.hints < 0 || typeof g.done !== "boolean" ||
        !isInt(g.sel) || g.sel < 0 || g.sel >= g.n * g.n) return false;
    for (var i = 0; i < g.c.length; i++) if (g.c[i] !== 0 && g.c[i] !== 1 && g.c[i] !== 2) return false;
    return true;
  }
  function validHist(h, n) {
    if (!Array.isArray(h) || h.length > MAX_HIST) return false;
    for (var i = 0; i < h.length; i++) {
      if (!Array.isArray(h[i]) || !h[i].length) return false;
      for (var j = 0; j < h[i].length; j++) {
        var c = h[i][j];
        if (!Array.isArray(c) || c.length !== 3 || !isInt(c[0]) || c[0] < 0 || c[0] >= n * n ||
            [0, 1, 2].indexOf(c[1]) < 0 || [0, 1, 2].indexOf(c[2]) < 0) return false;
      }
    }
    return true;
  }
  function loadSession() {
    try {
      var g = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(g)) {
        if (!validHist(g.hist, g.n)) g.hist = [];
        if (g.mode !== "x") g.mode = "f";
        return g;
      }
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
    return !!(game && !game.done && document.visibilityState !== "hidden");
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
    PIC = [];
    for (var i = 0; i < g.pic.length; i++) PIC.push(g.pic.charCodeAt(i) - 48);
    CLUES = cluesOf(PIC, g.n);
  }

  function fresh(n) {
    var p = makePuzzle(n, rand, GEN_MS, nowMs), c = [];
    for (var i = 0; i < n * n; i++) c.push(0);
    return { n: n, pic: p.pic.join(""), c: c, ms: 0, hints: 0, done: false,
             sel: Math.floor(n / 2) * n + Math.floor(n / 2), mode: game ? game.mode : "f", hist: [] };
  }
  function inProgress() {
    if (!game || game.done) return false;
    if (game.hints) return true;
    for (var i = 0; i < game.c.length; i++) if (game.c[i]) return true;
    return false;
  }
  function copy(g) { return JSON.parse(JSON.stringify(g)); }

  // A puzzle in progress is never lost silently: Undo toast (R14).
  function newGame(n) {
    endStroke(false);
    closeDialogs();
    var prev = inProgress() ? (saveSession(), copy(game)) : null;
    prefs.n = n; savePrefs();
    runFrom = 0;
    setGame(fresh(n));
    saveSession();
    syncClock();
    renderAll(true);
    if (prev) {
      undoToast(t("toast.newgame"), function () {
        runFrom = 0;
        prefs.n = prev.n; savePrefs();
        setGame(prev);
        saveSession();
        syncClock();
        renderAll(true);
      });
    } else {
      live(t("toast.newgame"));
    }
  }

  // ---- paint strokes: one undo step per stroke ----
  var stroke = null;   // { start, from, to, axis, changed: {cell: old} }

  function refuseDone() {
    if (game.done) { showToast(t("toast.done")); return true; }
    return false;
  }

  function beginStroke(i, markMode) {
    if (refuseDone()) return false;
    var from = game.c[i], to;
    if (markMode) to = from === 2 ? 0 : 2;
    else to = from === 1 ? 0 : 1;
    stroke = { start: i, from: from, to: to, axis: null, changed: {} };
    paintCell(i);
    renderCells();
    sfx(to === 1 ? "fill" : (to === 2 ? "mark" : "clear"));
    return true;
  }
  function paintCell(i) {
    if (game.c[i] !== stroke.from || stroke.changed[i] !== undefined) return;
    stroke.changed[i] = game.c[i];
    game.c[i] = stroke.to;
  }
  // The pointer is over cell i: paint the straight line from the start.
  function extendStroke(i) {
    if (!stroke) return;
    var n = game.n, r0 = Math.floor(stroke.start / n), c0 = stroke.start % n;
    var r = Math.floor(i / n), c = i % n;
    if (!stroke.axis) {
      if (r === r0 && c === c0) return;
      stroke.axis = Math.abs(r - r0) >= Math.abs(c - c0) ? "v" : "h";
    }
    if (stroke.axis === "v") c = c0; else r = r0;
    var dr = r > r0 ? 1 : (r < r0 ? -1 : 0), dc = c > c0 ? 1 : (c < c0 ? -1 : 0);
    var rr = r0, cc = c0;
    for (;;) {
      paintCell(rr * n + cc);
      if (rr === r && cc === c) break;
      rr += dr; cc += dc;
    }
    renderCells();
  }
  function endStroke(keep) {
    if (!stroke) return;
    var s = stroke, list = [];
    stroke = null;
    Object.keys(s.changed).forEach(function (k) {
      var i = +k;
      if (keep) list.push([i, s.changed[k], game.c[i]]);
      else game.c[i] = s.changed[k];
    });
    if (keep && list.length) {
      game.hist.push(list);
      if (game.hist.length > MAX_HIST) game.hist.shift();
    }
    afterEdit();
  }

  // One cell from the keyboard (Space / X / Backspace).
  function setCell(i, to) {
    if (refuseDone()) return;
    var from = game.c[i];
    if (to === -1) {                     // clear
      if (!from) { showToast(t("toast.noErase")); return; }   // R28
      to = 0;
    } else if (from === to) to = 0;      // toggle off
    game.c[i] = to;
    game.hist.push([[i, from, to]]);
    if (game.hist.length > MAX_HIST) game.hist.shift();
    sfx(to === 1 ? "fill" : (to === 2 ? "mark" : "clear"));
    afterEdit();
    live(cellLabel(i));
  }

  function undo() {
    if (refuseDone()) return;
    if (!game.hist.length) { showToast(t("toast.noUndo")); return; }
    var list = game.hist.pop();
    for (var k = list.length - 1; k >= 0; k--) game.c[list[k][0]] = list[k][1];
    afterEdit();
  }

  function hint() {
    if (refuseDone()) return;
    var h = hintCell(PIC, game.c, game.sel, rand);
    if (!h) return;
    if (!game.hints) showToast(t("toast.hint"));
    game.hints++;
    game.hist.push([[h.i, game.c[h.i], h.s]]);
    game.c[h.i] = h.s;
    game.sel = h.i;
    sfx("hint");
    var n = game.n;
    live(t("live.hint", { r: Math.floor(h.i / n) + 1, c: h.i % n + 1, s: t("cell." + h.s) }));
    flashCell(h.i);
    afterEdit();
  }

  function setMode(m) {
    if (!game) return;
    game.mode = m;
    saveSession();
    renderToolbar();
    live(t("mode." + m));
  }

  function afterEdit() {
    if (!game.done && isSolved(CLUES, game.c, game.n)) { finish(); return; }
    saveSession();
    renderAll(false);
  }

  function finish() {
    syncClock();
    game.done = true;
    syncClock();
    var rec = countSolve("n" + game.n, game.ms, game.hints > 0);
    saveSession();
    renderAll(false);
    live(t("live.done", { t: fmtTime(game.ms) }));
    sfx("win");
    var p = $("pic");
    if (!reduced) { p.classList.remove("won"); void p.offsetWidth; p.classList.add("won"); }
    setTimeout(function () { resultDialog(rec); }, reduced ? 50 : 800);
  }

  function moveSel(dr, dc) {
    var n = game.n, r = Math.floor(game.sel / n), c = game.sel % n;
    r = (r + dr + n) % n; c = (c + dc + n) % n;
    game.sel = r * n + c;
    saveSession();
    renderCells();
    scrollToSel();
    live(cellLabel(game.sel));
  }

  // ---------- 6. Render ----------
  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var cellEls = [], rowClueEls = [], colClueEls = [];
  var fitCell = 0;          // the cell size that fits the whole board

  function renderAll(rebuild) {
    renderToolbar();
    renderStatus();
    if (rebuild || !cellEls.length || cellEls.length !== game.n * game.n) buildBoard();
    renderCells();
  }

  function renderToolbar() {
    [].forEach.call(document.querySelectorAll("#size-seg .seg-btn"), function (b) {
      var on = +b.getAttribute("data-size") === (game ? game.n : prefs.n);
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    [].forEach.call(document.querySelectorAll("#mode-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-mode") === (game ? game.mode : "f");
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    $("undo-btn").disabled = !(game && !game.done && game.hist.length);
    $("hint-btn").disabled = !(game && !game.done);
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

  function linesDone() {
    var n = game.n, d = 0;
    for (var k = 0; k < n; k++) {
      if (sameRuns(runsOf(rowOf(game.c, n, k)), CLUES.rows[k])) d++;
      if (sameRuns(runsOf(colOf(game.c, n, k)), CLUES.cols[k])) d++;
    }
    return d;
  }

  function renderStatus() {
    renderClock();
    var s = totals("n" + game.n);
    $("best").textContent = s.t ? fmtTime(s.t) : "–";
    var msg, cls = "";
    if (game.done) { msg = t("turn.done"); cls = "done"; }
    else if (game.hints) { msg = t("turn.hinted"); cls = "warn"; }
    else if (!inProgress()) msg = t("turn.start");
    else msg = t("turn.play", { d: linesDone(), n: game.n * 2 });
    $("turn").textContent = msg;
    $("turn").className = cls;
  }

  function buildBoard() {
    var pic = $("pic"), n = game.n;
    pic.innerHTML = "";
    pic.setAttribute("aria-label", t("board.label", { n: n }));
    pic.style.setProperty("--n", String(n));
    cellEls = []; rowClueEls = []; colClueEls = [];
    var maxL = 1, maxT = 1, k;
    for (k = 0; k < n; k++) {
      maxL = Math.max(maxL, CLUES.rows[k].length);
      maxT = Math.max(maxT, CLUES.cols[k].length);
    }
    pic.style.setProperty("--ml", String(maxL));
    pic.style.setProperty("--mt", String(maxT));
    pic.appendChild(el("div", "corner"));
    for (k = 0; k < n; k++) {
      var cc = el("div", "clue col" + (k % 5 === 4 || k === n - 1 ? " cut" : ""));
      cc.setAttribute("aria-label", t("clue.col", { c: k + 1, v: CLUES.cols[k].join(" ") || "0" }));
      fillClue(cc, CLUES.cols[k]);
      pic.appendChild(cc);
      colClueEls.push(cc);
    }
    for (var r = 0; r < n; r++) {
      var rc = el("div", "clue row" + (r % 5 === 4 || r === n - 1 ? " cut" : ""));
      rc.setAttribute("aria-label", t("clue.row", { r: r + 1, c: CLUES.rows[r].join(" ") || "0" }));
      fillClue(rc, CLUES.rows[r]);
      pic.appendChild(rc);
      rowClueEls.push(rc);
      for (var c = 0; c < n; c++) {
        var d = el("div", "cell");
        d.setAttribute("data-i", String(r * n + c));
        pic.appendChild(d);
        cellEls.push(d);
      }
    }
    layout();
  }
  function fillClue(node, clue) {
    var list = clue.length ? clue : [0];
    list.forEach(function (v) { node.appendChild(el("span", "", String(v))); });
  }

  function renderCells() {
    if (!game) return;
    var n = game.n;
    for (var i = 0; i < n * n; i++) {
      var s = game.c[i], cls = "cell" + (s === 1 ? " on" : (s === 2 ? " x" : ""));
      if (i % n % 5 === 4 || i % n === n - 1) cls += " vr";
      if (Math.floor(i / n) % 5 === 4 || i >= n * (n - 1)) cls += " hr";
      if (i === game.sel && !game.done) cls += " sel";
      if (cellEls[i].className !== cls) cellEls[i].className = cls;
    }
    for (var k = 0; k < n; k++) {
      rowClueEls[k].classList.toggle("ok", sameRuns(runsOf(rowOf(game.c, n, k)), CLUES.rows[k]));
      colClueEls[k].classList.toggle("ok", sameRuns(runsOf(colOf(game.c, n, k)), CLUES.cols[k]));
    }
    var sr = Math.floor(game.sel / n), sc = game.sel % n;
    rowClueEls.forEach(function (e, k) { e.classList.toggle("cur", k === sr && !game.done); });
    colClueEls.forEach(function (e, k) { e.classList.toggle("cur", k === sc && !game.done); });
    $("pic").classList.toggle("solved", !!game.done);
  }

  function flashCell(i) {
    if (reduced || !cellEls[i]) return;
    var c = cellEls[i];
    c.classList.remove("flash");
    void c.offsetWidth;
    c.classList.add("flash");
    setTimeout(function () { c.classList.remove("flash"); }, 700);
  }

  function coarse() {
    return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  }

  // Cell size: the whole board fits #board-wrap; with zoom on, cells
  // are at least 30 px (34 on touch) and the wrap scrolls, the clues
  // sticking to its top and left edges.
  function layout() {
    if (!game) return;
    var wrap = $("board-wrap"), pic = $("pic");
    var cs = getComputedStyle(wrap);
    var W = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var H = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (W <= 0 || H <= 0) return;
    var n = game.n;
    var ml = +pic.style.getPropertyValue("--ml") || 1, mt = +pic.style.getPropertyValue("--mt") || 1;
    var slot = n >= 10 ? 0.66 : 0.6;              // clue number width / cell
    var cw = W / (n + ml * slot + 0.5), ch = H / (n + mt * 0.62 + 0.5);
    fitCell = Math.floor(Math.min(cw, ch, 52));
    var want = coarse() ? 34 : 30, c = fitCell;
    var zoomed = prefs.zoom && fitCell < want;
    if (zoomed) c = want;
    c = Math.max(12, c);
    pic.style.setProperty("--c", c + "px");
    pic.style.setProperty("--slot", slot);
    wrap.classList.toggle("zoomed", zoomed);
    $("zoom-btn").hidden = fitCell >= want && !prefs.zoom;
  }

  function scrollToSel() {
    var wrap = $("board-wrap");
    if (!wrap.classList.contains("zoomed") || !cellEls[game.sel]) return;
    var r = cellEls[game.sel].getBoundingClientRect(), w = wrap.getBoundingClientRect();
    var lc = rowClueEls[0].getBoundingClientRect().width, tc = colClueEls[0].getBoundingClientRect().height;
    if (r.left < w.left + lc) wrap.scrollLeft -= (w.left + lc - r.left) + 4;
    else if (r.right > w.right) wrap.scrollLeft += r.right - w.right + 4;
    if (r.top < w.top + tc) wrap.scrollTop -= (w.top + tc - r.top) + 4;
    else if (r.bottom > w.bottom) wrap.scrollTop += r.bottom - w.bottom + 4;
  }

  function cellLabel(i) {
    var n = game.n;
    return t("cell.at", { r: Math.floor(i / n) + 1, c: i % n + 1, s: t("cell." + game.c[i]) });
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

  // A small drawing of the solved picture for the result dialog.
  function miniPicture() {
    var n = game.n, box = el("div", "dlg-pic");
    box.style.setProperty("--n", String(n));
    for (var i = 0; i < n * n; i++) box.appendChild(el("span", PIC[i] ? "on" : ""));
    box.setAttribute("aria-hidden", "true");
    return box;
  }

  function resultDialog(rec) {
    if (!game || !game.done) return;            // replaced meanwhile
    closeDialogs();
    var s = totals("n" + game.n);
    var dlg = makeDialog("nonogram-result");
    dlg.appendChild(el("div", "dlg-title", t("res.title") + " · " + sizeName(game.n)));
    dlg.appendChild(miniPicture());
    dlg.appendChild(el("div", "dlg-hero", fmtTime(game.ms)));
    if (rec) dlg.appendChild(el("div", "dlg-badge", t("res.rec")));
    if (game.hints) dlg.appendChild(el("div", "dlg-msg dlg-note", t("res.noRec")));
    dlg.appendChild(row(t("res.hints"), String(game.hints)));
    dlg.appendChild(row(t("res.best"), s.t ? fmtTime(s.t) : "–"));
    dlg.appendChild(row(t("res.solved"), String(s.n)));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("res.close"), "", function () { dlg.close(); }));
    var again = button(t("res.again"), "primary", function () { dlg.close(); newGame(game.n); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    again.focus();
  }

  function statsDialog() {
    endStroke(true);
    var dlg = makeDialog("nonogram-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    SIZES.forEach(function (n) {
      var s = totals("n" + n);
      if (s.n) empty = false;
      dlg.appendChild(row(sizeName(n),
        s.n ? (s.t ? fmtTime(s.t) : "–") + " · " + s.n + " · " + s.c : "–"));
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
    var dlg = makeDialog("nonogram-confirm");
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
    data = mergeNonogram(data, data);
    save();
    renderStatus();
    showToast(t("toast.reset"));
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "nonogram", title: String(text) })) return;
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
      if (kind === "fill") tone(520, 0, 0.05, "triangle", 0.09);
      else if (kind === "mark") tone(360, 0, 0.05, "triangle", 0.07);
      else if (kind === "clear") tone(300, 0, 0.04, "sine", 0.06);
      else if (kind === "hint") { tone(660, 0, 0.07, "triangle", 0.1); tone(990, 0.07, 0.09, "triangle", 0.08); }
      else if (kind === "win") {
        [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
      }
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Toolbar icons (R9: injected by JS) ----------
  var UI_ICONS = {
    new:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    undo:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    hint:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/></svg>',
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
  // A stroke starts on a cell (left button / touch: the current mode;
  // right button: mark) and paints along one row or column.
  function cellAt(x, y) {
    var n = document.elementFromPoint(x, y);
    var c = n && n.closest ? n.closest("#pic .cell") : null;
    return c ? +c.getAttribute("data-i") : -1;
  }
  function wirePointer() {
    var pic = $("pic"), pid = null;
    pic.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    pic.addEventListener("pointerdown", function (e) {
      var c = e.target.closest ? e.target.closest(".cell") : null;
      if (!c || !game || stroke) return;
      if (e.button !== undefined && e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      var i = +c.getAttribute("data-i");
      game.sel = i;
      if (!beginStroke(i, e.button === 2 || game.mode === "x")) return;
      pid = e.pointerId;
      try { pic.setPointerCapture(pid); } catch (err) {}
    });
    pic.addEventListener("pointermove", function (e) {
      if (!stroke || e.pointerId !== pid) return;
      var i = cellAt(e.clientX, e.clientY);
      if (i >= 0) extendStroke(i);
    });
    var end = function (e) {
      if (!stroke || e.pointerId !== pid) return;
      pid = null;
      endStroke(true);
    };
    pic.addEventListener("pointerup", end);
    pic.addEventListener("pointercancel", end);
    pic.addEventListener("lostpointercapture", end);
  }

  var KEY_MOVE = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;   // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      if (!game || stroke) return;
      if (KEY_MOVE[e.code]) { e.preventDefault(); moveSel(KEY_MOVE[e.code][0], KEY_MOVE[e.code][1]); return; }
      if (e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter") {
        if (tag === "BUTTON" && e.code !== "Space") return;
        e.preventDefault();
        setCell(game.sel, game.mode === "x" ? 2 : 1);
        return;
      }
      if (e.code === "KeyX") { e.preventDefault(); setCell(game.sel, 2); return; }
      if (e.code === "KeyF") { e.preventDefault(); setCell(game.sel, 1); return; }
      if (e.code === "Backspace" || e.code === "Delete") { e.preventDefault(); setCell(game.sel, -1); return; }
      if (e.repeat) return;
      if (e.code === "KeyM") { e.preventDefault(); setMode(game.mode === "x" ? "f" : "x"); return; }
      if (e.code === "KeyU" || e.code === "KeyZ") { e.preventDefault(); undo(); return; }
      if (e.code === "KeyH") { e.preventDefault(); hint(); }
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
    api.registerSlice("nonogram", sliceGet, sliceSet, STORAGE_KEY, mergeNonogram);
  }

  function sliceGet() {
    return mergeNonogram(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeNonogram(incoming, incoming);
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
    $("mode-seg").setAttribute("aria-label", t("mode.label"));
    $("size-seg").setAttribute("aria-label", t("size.label"));
  }

  function paintStatic() {
    [["undo-btn", "undo", "btn.undo"], ["hint-btn", "hint", "btn.hint"], ["new-btn", "new", "btn.new"],
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
        if (game && n === game.n && !game.done) return;   // visible active state
        newGame(n);
      });
    });
    [].forEach.call(document.querySelectorAll("#mode-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () { setMode(b.getAttribute("data-mode")); });
    });
    $("undo-btn").addEventListener("click", undo);
    $("hint-btn").addEventListener("click", hint);
    $("zoom-btn").addEventListener("click", function () {
      prefs.zoom = !prefs.zoom;
      savePrefs();
      layout();
      renderToolbar();
      if (prefs.zoom && !$("board-wrap").classList.contains("zoomed")) showToast(t("toast.noZoom"));
      else scrollToSel();
    });
    $("new-btn").addEventListener("click", function () { newGame(game ? game.n : prefs.n); $("new-btn").blur(); });
    $("stats-btn").addEventListener("click", statsDialog);
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("fill");   // audible confirmation when turned on
    });
    wirePointer();

    if (window.ResizeObserver) new ResizeObserver(function () { layout(); }).observe($("board-wrap"));
    else window.addEventListener("resize", layout);

    document.addEventListener("visibilitychange", function () {
      if (!game) return;
      syncClock();
      saveSession();
    });
    window.addEventListener("pagehide", function () { if (game) { endStroke(true); saveSession(); } });

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
      prefs.n = g.n;                             // the resumed puzzle decides the toolbar
      setGame(g);
      saveSession();
    } else {
      setGame(fresh(prefs.n));
      saveSession();
    }
    syncClock();
    renderAll(true);
  }

  boot();
})();
