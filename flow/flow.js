// ============================================================
// orOS Flow Free — App logic (v1.0.0)
// Pairs of coloured dots on a square grid. Join every pair with a
// line; lines cannot cross, and every cell must be filled.
//   - 5 sizes: 5×5 to 9×9; puzzles are made here, offline: a random
//     path through every cell is cut and re-joined into lines that do
//     not touch themselves, then an exact solver (a row-by-row sweep
//     with memo) proves the puzzle has ONE solution; while it has two,
//     the line where they part is cut in two (a new colour); then
//     lines are joined again while the puzzle stays unique. The work
//     runs in small slices, so the app never freezes.
//   - draw by dragging from a dot or a line (mouse / touch); drawing
//     back over the own line takes it back, drawing over another line
//     cuts it there; keyboard: arrows move the cursor, Enter / Space
//     picks the dot or line under it, arrows then draw, Backspace takes
//     a cell back, Enter / Esc lets go
//   - every dot carries a letter, so colours are never the only clue
//   - Undo (U), Restart (R), Hint (H: draws one line of the solution;
//     a hinted puzzle sets no best time), New (N)
//   - time runs from the first line, only while the app is visible;
//     a puzzle in progress is kept on the device and resumes
// Data:
//   - synced slice "flow" (oros-flow-data): per size the puzzles solved
//     and the best time, as per-device rows (each device only grows
//     its own row; merge = per-row join) + a reset stamp br
//   - device-local (R10): oros-flow-prefs (size), oros-flow-session
//     (the puzzle in progress), oros-flow-device (row id),
//     oros-flow-sfx (sound on/off)
// Sections:
//   1. Constants, i18n, helpers
//   2. Puzzle model (paths, solver, generator)
//   3. Synced data: load / save / normalize / merge (R5, R26)
//   4. Device-local prefs + session
//   5. Game flow (new, draw, undo, restart, hint, timer, finish)
//   6. Render (toolbar, status, board)
//   7. Dialogs (result, records, confirm)
//   8. Toasts
//   9. Sound
//  10. Input (pointer, keyboard, Contract Β)
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-flow-data";
  var PREFS_KEY   = "oros-flow-prefs";
  var SESSION_KEY = "oros-flow-session";
  var DEVICE_KEY  = "oros-flow-device";
  var SFX_KEY     = "oros-flow-sfx";
  var DATA_VER    = 1;

  var LEVELS = ["5", "6", "7", "8", "9"];
  // Per size: the colours the generator aims for (k) and the most it
  // accepts before starting over (max).
  var SIZES = { 5: { k: 4, max: 6 }, 6: { k: 5, max: 7 }, 7: { k: 6, max: 8 },
                8: { k: 7, max: 9 }, 9: { k: 8, max: 11 } };
  var COLOURS = 16;                          // .k0 … .k15 in flow.css, letters A–P
  var LETTERS = "ABCDEFGHIJKLMNOP";
  var GEN_MS = 2500;                         // after this, take any unique puzzle
  var MAX_MS = 360000000;                    // 100 h: anything above is junk
  var MAX_HIST = 200;                        // undo steps kept

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
      "level.label": "Grid size",
      "btn.undo": "Undo (U)",
      "btn.hint": "Hint (H)",
      "btn.restart": "Clear the board (R)",
      "btn.new": "New puzzle (N)",
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "st.flows": "Lines", "st.time": "Time",
      "turn.making": "Making a puzzle…",
      "turn.start": "Join each pair of dots",
      "turn.fill": "Board {p}% full",
      "turn.full": "Lines joined: now fill every cell",
      "turn.done": "Solved!",
      "board.label": "Flow board, {n} by {n}. Arrows move, Enter picks a dot or a line",
      "cell.empty": "Row {r}, column {c}: empty",
      "cell.dot": "Row {r}, column {c}: dot {l}",
      "cell.line": "Row {r}, column {c}: line {l}",
      "live.pick": "Drawing line {l}",
      "live.drop": "Line {l} let go",
      "live.joined": "Line {l} joined",
      "live.done": "Solved in {t}",
      "res.title": "Solved",
      "res.hero": "Well done!",
      "res.time": "Time",
      "res.moves": "Moves",
      "res.bestT": "Best time",
      "res.solved": "Solved",
      "res.recT": "New best time!",
      "res.hinted": "Solved with a hint: no best time this time",
      "res.again": "New puzzle",
      "res.close": "Close",
      "stats.title": "Records",
      "stats.head": "Best time · solved",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "confirm.reset": "Delete the records on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Records reset",
      "toast.newgame": "New puzzle",
      "toast.restart": "Board cleared",
      "toast.undo": "Undo",
      "toast.noundo": "Nothing to undo",
      "toast.empty": "The board is already empty",
      "toast.hint": "Hint used: this puzzle sets no best time",
      "toast.done": "Solved: start a new puzzle (N)",
      "toast.making": "Making a puzzle, one moment",
      "toast.start": "Start from a dot or a line",
      "toast.blocked": "Lines cannot go through another colour's dot",
      "toast.closed": "This line is joined: start again from one of its dots",
      "toast.pick": "Press Enter on a dot or a line first",
      "toast.full": "Every line is joined, but some cells are still empty",
      "toast.save": "Could not save: storage is full"
    },
    el: {
      "level.label": "Μέγεθος",
      "btn.undo": "Αναίρεση (U)",
      "btn.hint": "Υπόδειξη (H)",
      "btn.restart": "Καθαρισμός πίνακα (R)",
      "btn.new": "Νέος γρίφος (N)",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "st.flows": "Γραμμές", "st.time": "Χρόνος",
      "turn.making": "Φτιάχνεται γρίφος…",
      "turn.start": "Ένωσε κάθε ζευγάρι χρωμάτων",
      "turn.fill": "Γέμισε το {p}%",
      "turn.full": "Ενώθηκαν όλα: γέμισε τώρα κάθε κουτάκι",
      "turn.done": "Λύθηκε!",
      "board.label": "Πίνακας, {n} επί {n}. Τα βελάκια κινούν, το Enter πιάνει τελεία ή γραμμή",
      "cell.empty": "Γραμμή {r}, στήλη {c}: άδειο",
      "cell.dot": "Γραμμή {r}, στήλη {c}: τελεία {l}",
      "cell.line": "Γραμμή {r}, στήλη {c}: γραμμή {l}",
      "live.pick": "Σχεδιάζεις τη γραμμή {l}",
      "live.drop": "Άφησες τη γραμμή {l}",
      "live.joined": "Η γραμμή {l} ενώθηκε",
      "live.done": "Λύθηκε σε {t}",
      "res.title": "Λύθηκε",
      "res.hero": "Μπράβο!",
      "res.time": "Χρόνος",
      "res.moves": "Κινήσεις",
      "res.bestT": "Καλύτερος χρόνος",
      "res.solved": "Λυμένοι",
      "res.recT": "Νέο ρεκόρ χρόνου!",
      "res.hinted": "Λύθηκε με υπόδειξη: χωρίς ρεκόρ χρόνου αυτή τη φορά",
      "res.again": "Νέος γρίφος",
      "res.close": "Κλείσιμο",
      "stats.title": "Ρεκόρ",
      "stats.head": "Καλύτερος χρόνος · λυμένοι",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.newgame": "Νέος γρίφος",
      "toast.restart": "Ο πίνακας καθάρισε",
      "toast.undo": "Αναίρεση",
      "toast.noundo": "Δεν υπάρχει κίνηση για αναίρεση",
      "toast.empty": "Ο πίνακας είναι ήδη άδειος",
      "toast.hint": "Υπόδειξη: αυτός ο γρίφος δεν μετράει για ρεκόρ χρόνου",
      "toast.done": "Λύθηκε: ξεκίνα νέο γρίφο (N)",
      "toast.making": "Φτιάχνεται γρίφος, μια στιγμή",
      "toast.start": "Ξεκίνα από τελεία ή από γραμμή",
      "toast.blocked": "Οι γραμμές δεν περνούν από τελεία άλλου χρώματος",
      "toast.closed": "Η γραμμή έχει ενωθεί: ξεκίνα πάλι από μία τελεία της",
      "toast.pick": "Πάτα πρώτα Enter σε τελεία ή γραμμή",
      "toast.full": "Ενώθηκαν όλες οι γραμμές, αλλά μένουν άδεια κουτάκια",
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
    console.log("flow.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Puzzle model ----------
  // Cells are numbered r * n + c. A puzzle is { n, dots: [[a, b], …],
  // sol: [[cells of colour k from a to b], …] }. The player's board is
  // paths: one cell list per colour, starting at one of its dots
  // ([] = nothing drawn yet).
  function adjacent(n, a, b) {
    var ra = Math.floor(a / n), rb = Math.floor(b / n);
    return (ra === rb && Math.abs(a - b) === 1) || (a % n === b % n && Math.abs(ra - rb) === 1);
  }

  function neighbours(n, i) {
    var r = Math.floor(i / n), c = i % n, out = [];
    if (r > 0) out.push(i - n);
    if (c < n - 1) out.push(i + 1);
    if (r < n - 1) out.push(i + n);
    if (c > 0) out.push(i - 1);
    return out;
  }

  // A random path through every cell: a zigzag, then many "backbite"
  // moves (an end steps onto a neighbour and the loop this makes is
  // turned around).
  function hamiltonPath(n, rnd) {
    var path = [], r, c, i;
    for (r = 0; r < n; r++) {
      for (c = 0; c < n; c++) path.push(r * n + (r % 2 ? n - 1 - c : c));
    }
    var steps = n * n * 30;
    for (var s = 0; s < steps; s++) {
      if (rnd(2)) path.reverse();
      var nb = neighbours(n, path[0]), v = nb[rnd(nb.length)];
      if (v === path[1]) continue;
      var at = path.indexOf(v);
      var head = path.slice(0, at).reverse();
      for (i = 0; i < at; i++) path[i] = head[i];
    }
    return path;
  }

  // Does a line touch itself (two cells side by side that do not
  // follow each other on the line)?
  function touches(n, p) {
    var at = {}, i;
    for (i = 0; i < p.length; i++) at[p[i]] = i;
    for (i = 0; i < p.length; i++) {
      var nb = neighbours(n, p[i]);
      for (var j = 0; j < nb.length; j++) {
        var k = at[nb[j]];
        if (k !== undefined && Math.abs(k - i) > 1) return true;
      }
    }
    return false;
  }

  // Every way to join two lines end to end: [k, m, joined line], k < m.
  function joins(n, paths) {
    var owner = {}, out = [];
    paths.forEach(function (p, k) { p.forEach(function (c) { owner[c] = k; }); });
    paths.forEach(function (p, k) {
      [0, p.length - 1].forEach(function (e) {
        neighbours(n, p[e]).forEach(function (v) {
          var m = owner[v];
          if (m === undefined || m <= k) return;
          var q = paths[m];
          if (v !== q[0] && v !== q[q.length - 1]) return;
          var a = e === 0 ? p.slice().reverse() : p;
          var b = v === q[0] ? q : q.slice().reverse();
          out.push([k, m, a.concat(b)]);
        });
      });
    });
    return out;
  }

  function joined(paths, j) {
    var out = paths.slice();
    out[j[0]] = j[2];
    out.splice(j[1], 1);
    return out;
  }

  // Lines that never touch themselves: a random full path cut into
  // pairs, then neighbouring lines joined end to end at random while
  // the joined line still does not touch itself.
  function growPaths(n, rnd) {
    var h = hamiltonPath(n, rnd), paths = [], i;
    for (i = 0; i + 1 < h.length; i += 2) paths.push(h.slice(i, i + 2));
    if (h.length % 2) paths[paths.length - 1].push(h[h.length - 1]);
    while (true) {
      var js = joins(n, paths).filter(function (j) { return !touches(n, j[2]); });
      if (!js.length) return paths;
      paths = joined(paths, js[rnd(js.length)]);
    }
  }

  // Exact solution counter (capped at 2) for a grid of dots, by a
  // row-by-row sweep over the cells with memo. The state is the
  // "frontier": per column the label on the edge going down into the
  // next row, plus the label on the edge going right into the next
  // cell. A label is 0 (no edge), a colour k + 1 (a line that started
  // at a dot of k) or a negative pair id (a line with no dot yet, open
  // at both ends, both of them on the frontier). A dot has one edge,
  // any other cell two; two lines meet only if they agree (same colour,
  // a pair taking a colour, or two different pairs), never closing a
  // loop. A full grid with an empty frontier is a solution.
  // ends: cell → colour + 1 (0 = no dot).
  function flowSolver(n, ends) {
    var memo = [], N2 = n * n, m;
    for (m = 0; m <= N2; m++) memo.push({});

    function norm(st) {
      var map = {}, next = -1, out = st.slice();
      for (var i = 0; i < out.length; i++) {
        if (out[i] < 0) {
          if (map[out[i]] === undefined) { map[out[i]] = next; next--; }
          out[i] = map[out[i]];
        }
      }
      return out;
    }
    function relabel(st, from, to) {
      for (var i = 0; i < st.length; i++) if (st[i] === from) { st[i] = to; return true; }
      return false;
    }
    function join(st, x, y) {
      if (x > 0 && y > 0) return x === y;
      if (x > 0) return relabel(st, y, x);
      if (y > 0) return relabel(st, x, y);
      if (x === y) return false;                 // a loop
      return relabel(st, y, x);
    }

    // Every way to wire cell i: { o: 2 * right + down, st: next state }.
    function choices(i, st) {
      var r = Math.floor(i / n), c = i % n, out = [];
      var L = c > 0 ? st[n] : 0, U = st[c], k = ends[i];
      var canR = c < n - 1, canD = r < n - 1;
      var base = st.slice(), s;
      base[c] = 0; base[n] = 0;
      if (k) {
        if (L && U) return out;
        var x = L || U;
        if (x) {
          s = base.slice();
          if (x > 0 ? x === k : relabel(s, x, k)) out.push({ o: 0, st: norm(s) });
          return out;
        }
        if (canR) { s = base.slice(); s[n] = k; out.push({ o: 2, st: norm(s) }); }
        if (canD) { s = base.slice(); s[c] = k; out.push({ o: 1, st: norm(s) }); }
        return out;
      }
      if (L && U) {
        s = base.slice();
        if (join(s, L, U)) out.push({ o: 0, st: norm(s) });
        return out;
      }
      var y = L || U;
      if (y) {
        if (canR) { s = base.slice(); s[n] = y; out.push({ o: 2, st: norm(s) }); }
        if (canD) { s = base.slice(); s[c] = y; out.push({ o: 1, st: norm(s) }); }
        return out;
      }
      if (canR && canD) {
        s = base.slice();
        var lo = 0;
        for (var z = 0; z < s.length; z++) if (s[z] < lo) lo = s[z];
        s[n] = lo - 1; s[c] = lo - 1;
        out.push({ o: 3, st: norm(s) });
      }
      return out;
    }

    function count(i, st) {
      if (i === N2) {
        for (var z = 0; z < st.length; z++) if (st[z]) return 0;
        return 1;
      }
      var key = st.join(","), got = memo[i][key];
      if (got !== undefined) return got;
      var chs = choices(i, st), total = 0;
      for (var j = 0; j < chs.length && total < 2; j++) total += count(i + 1, chs[j].st);
      if (total > 2) total = 2;
      memo[i][key] = total;
      return total;
    }

    var start = [];
    for (m = 0; m <= n; m++) start.push(0);
    return { start: start, choices: choices, count: count };
  }

  function endsOf(n, dots) {
    var ends = [];
    for (var i = 0; i < n * n; i++) ends.push(0);
    dots.forEach(function (d, k) { ends[d[0]] = k + 1; ends[d[1]] = k + 1; });
    return ends;
  }

  // Solutions of a puzzle: 0, 1 or 2 (= two or more).
  function countSolutions(n, dots) {
    var S = flowSolver(n, endsOf(n, dots));
    return S.count(0, S.start);
  }

  // How a solution wires each cell: 2 * (joined to the right) + (joined below).
  function wiring(n, paths) {
    var w = [], i, j;
    for (i = 0; i < n * n; i++) w.push(0);
    paths.forEach(function (p) {
      for (j = 1; j < p.length; j++) {
        var a = Math.min(p[j - 1], p[j]), b = Math.max(p[j - 1], p[j]);
        w[a] |= b === a + 1 ? 2 : 1;
      }
    });
    return w;
  }

  // The first cell (reading order) where another solution parts from
  // this one, or -1 when this is the only solution.
  function divergence(n, paths) {
    var dots = paths.map(function (p) { return [p[0], p[p.length - 1]]; });
    var S = flowSolver(n, endsOf(n, dots)), w = wiring(n, paths), st = S.start;
    if (S.count(0, st) < 2) return -1;
    for (var i = 0; i < n * n; i++) {
      var chs = S.choices(i, st), ours = null;
      for (var j = 0; j < chs.length; j++) if (chs[j].o === w[i]) ours = chs[j];
      if (!ours || S.count(i + 1, ours.st) < 2) return i;
      st = ours.st;
    }
    return -1;
  }

  // Cut a line at or near cell x (a new colour); both parts keep at
  // least `min` cells. Returns the new line list, or null.
  function splitAt(n, paths, x, min) {
    var near = [x].concat(neighbours(n, x));
    for (var d = 0; d < 3 * n; d++) {
      for (var m = 0; m < near.length; m++) {
        for (var k = 0; k < paths.length; k++) {
          var p = paths[k], j = p.indexOf(near[m]);
          if (j < 0) continue;
          var cuts = [j - d, j + 1 + d];
          for (var q = 0; q < 2; q++) {
            var c = cuts[q];
            if (c >= min && p.length - c >= min) {
              var out = paths.slice();
              out.splice(k, 1, p.slice(0, c), p.slice(c));
              return out;
            }
          }
        }
      }
    }
    return null;
  }

  // The generator as small steps, so the app can run it in slices.
  // Phase 0: lines that do not touch themselves, no two-cell lines.
  // Phase 1: while another solution exists, cut where it parts.
  // Phase 2: join lines (fewer colours) while the puzzle stays unique.
  function genJob(n, rnd, deadline) {
    return { n: n, rnd: rnd, deadline: deadline || 0, phase: 0, paths: null, tries: 0 };
  }

  function genStep(job) {
    var n = job.n, spec = SIZES[n], late = job.deadline && Date.now() > job.deadline, js;
    if (job.phase === 0) {
      var paths = growPaths(n, job.rnd);
      for (var guard = 0; guard < 60; guard++) {
        js = joins(n, paths).filter(function (j) { return paths[j[0]].length < 3 || paths[j[1]].length < 3; });
        if (!js.length) break;
        paths = joined(paths, js[job.rnd(js.length)]);
      }
      job.paths = paths;
      job.phase = 1;
      job.tries = 0;
      return null;
    }
    if (job.phase === 1) {
      var x = divergence(n, job.paths);
      if (x >= 0) {
        job.paths = splitAt(n, job.paths, x, 3);
        if (!job.paths || job.paths.length > COLOURS) job.phase = 0;
        return null;
      }
      var short = job.paths.some(function (p) { return p.length < 3; });
      job.phase = short ? 0 : 2;
      return null;
    }
    if (job.paths.length > spec.k && job.tries < 40 && !late) {
      js = joins(n, job.paths);
      if (js.length) {
        job.tries++;
        var cand = joined(job.paths, js[job.rnd(js.length)]);
        if (divergence(n, cand) < 0) job.paths = cand;
        return null;
      }
    }
    if (job.paths.length > spec.max && !late) { job.phase = 0; return null; }
    var sol = job.paths;
    return { n: n, dots: sol.map(function (p) { return [p[0], p[p.length - 1]]; }), sol: sol };
  }

  function generate(n, rnd, deadline) {
    var job = genJob(n, rnd, deadline), p = null;
    while (!p) p = genStep(job);
    return p;
  }

  // cell → colour of the dot there, or -1.
  function dotMap(pz) {
    var out = [];
    for (var i = 0; i < pz.n * pz.n; i++) out.push(-1);
    pz.dots.forEach(function (d, k) { out[d[0]] = k; out[d[1]] = k; });
    return out;
  }

  // cell → colour of the line through it, or -1.
  function ownerOf(n, paths) {
    var out = [];
    for (var i = 0; i < n * n; i++) out.push(-1);
    paths.forEach(function (p, k) { p.forEach(function (c) { out[c] = k; }); });
    return out;
  }

  // Line k joins its two dots.
  function isDone(pz, paths, k) {
    var p = paths[k], d = pz.dots[k];
    if (!p || p.length < 2) return false;
    var a = p[0], b = p[p.length - 1];
    return (a === d[0] && b === d[1]) || (a === d[1] && b === d[0]);
  }

  // Cells covered by a line or a dot.
  function filled(pz, paths) {
    var own = ownerOf(pz.n, paths), dm = dotMap(pz), k = 0;
    for (var i = 0; i < own.length; i++) if (own[i] >= 0 || dm[i] >= 0) k++;
    return k;
  }

  function isWon(pz, paths) {
    for (var k = 0; k < pz.dots.length; k++) if (!isDone(pz, paths, k)) return false;
    return filled(pz, paths) === pz.n * pz.n;
  }

  function copyPaths(paths) { return paths.map(function (p) { return p.slice(); }); }

  // Pick up a line at a cell: a dot starts its colour again from that
  // dot; a cell of a line takes the line back to that cell. Returns
  // { paths, k } or null (an empty cell).
  function startAt(pz, paths, cell) {
    var dm = dotMap(pz), out = copyPaths(paths), k = dm[cell];
    if (k >= 0) {
      out[k] = [cell];
      return { paths: out, k: k };
    }
    k = ownerOf(pz.n, paths)[cell];
    if (k < 0) return null;
    out[k] = out[k].slice(0, out[k].indexOf(cell) + 1);
    return { paths: out, k: k };
  }

  // Draw line k one step on, into cell. Returns { paths, r } where r is
  // "ok", "joined" (reached its other dot), "cut" (cut another line),
  // "back" (took back its own cells), or a refusal: "far" (not next to
  // the end), "done" (already joined), "dot" (another colour's dot),
  // "none" (line k not started).
  function stepTo(pz, paths, k, cell) {
    var p = paths[k];
    if (!p || !p.length) return { paths: paths, r: "none" };
    var j = p.indexOf(cell);
    if (j >= 0) {
      if (j === p.length - 1) return { paths: paths, r: "same" };
      var back = copyPaths(paths);
      back[k] = p.slice(0, j + 1);
      return { paths: back, r: "back" };
    }
    if (!adjacent(pz.n, p[p.length - 1], cell)) return { paths: paths, r: "far" };
    if (isDone(pz, paths, k)) return { paths: paths, r: "done" };
    var d = dotMap(pz)[cell];
    if (d >= 0 && d !== k) return { paths: paths, r: "dot" };
    var out = copyPaths(paths), o = ownerOf(pz.n, paths)[cell], r = "ok";
    if (o >= 0 && o !== k) {
      out[o] = out[o].slice(0, out[o].indexOf(cell));
      r = "cut";
    }
    out[k] = p.concat([cell]);
    if (d === k) r = "joined";
    return { paths: out, r: r };
  }

  // Take back the last cell of line k (its first dot stays).
  function retract(paths, k) {
    var out = copyPaths(paths);
    if (out[k] && out[k].length > 1) out[k].pop();
    return out;
  }

  // The cells from a to b in unit steps (the longer way first), a
  // excluded: a fast drag that skipped cells.
  function route(n, a, b) {
    var out = [], r = Math.floor(a / n), c = a % n, rb = Math.floor(b / n), cb = b % n;
    while (r !== rb || c !== cb) {
      if (Math.abs(cb - c) >= Math.abs(rb - r)) c += cb > c ? 1 : -1;
      else r += rb > r ? 1 : -1;
      out.push(r * n + c);
    }
    return out;
  }

  // One line of the solution: the first colour whose cells differ
  // from the solution (an unjoined one first). Lines in its way are
  // cut. Returns { paths, k } or null when every line is right.
  function hintPaths(pz, paths) {
    var pick = -1, k;
    function same(p, s) {
      if (p.length !== s.length) return false;
      var a = p.slice().sort(function (x, y) { return x - y; }).join();
      return a === s.slice().sort(function (x, y) { return x - y; }).join();
    }
    for (var pass = 0; pass < 2 && pick < 0; pass++) {
      for (k = 0; k < pz.sol.length && pick < 0; k++) {
        if (same(paths[k], pz.sol[k])) continue;
        if (pass === 0 && isDone(pz, paths, k)) continue;
        pick = k;
      }
    }
    if (pick < 0) return null;
    var out = copyPaths(paths), want = {};
    pz.sol[pick].forEach(function (c) { want[c] = true; });
    out.forEach(function (p, m) {
      if (m === pick) return;
      for (var i = 0; i < p.length; i++) {
        if (want[p[i]]) { out[m] = p.slice(0, i); break; }
      }
    });
    out[pick] = pz.sol[pick].slice();
    return { paths: out, k: pick };
  }

  // A puzzle from storage: a size we play, every dot pair joined by its
  // solution line, the lines covering the grid once.
  function validPuzzle(pz) {
    if (!pz || typeof pz !== "object" || !SIZES[pz.n] || !Array.isArray(pz.dots) ||
        !Array.isArray(pz.sol) || pz.dots.length !== pz.sol.length ||
        pz.dots.length < 2 || pz.dots.length > COLOURS) return false;
    var n = pz.n, seen = {}, cells = 0;
    for (var k = 0; k < pz.sol.length; k++) {
      var s = pz.sol[k], d = pz.dots[k];
      if (!Array.isArray(s) || s.length < 2 || !Array.isArray(d) || d.length !== 2 ||
          s[0] !== d[0] || s[s.length - 1] !== d[1]) return false;
      for (var i = 0; i < s.length; i++) {
        if (!isInt(s[i]) || s[i] < 0 || s[i] >= n * n || seen[s[i]]) return false;
        if (i && !adjacent(n, s[i - 1], s[i])) return false;
        seen[s[i]] = true;
        cells++;
      }
    }
    return cells === n * n;
  }

  // Player lines from storage: each starts at a dot of its colour,
  // steps to neighbours, never through another dot or another line.
  function validPaths(pz, paths) {
    if (!Array.isArray(paths) || paths.length !== pz.dots.length) return false;
    var dm = dotMap(pz), seen = {};
    for (var k = 0; k < paths.length; k++) {
      var p = paths[k];
      if (!Array.isArray(p)) return false;
      for (var i = 0; i < p.length; i++) {
        var c = p[i];
        if (!isInt(c) || c < 0 || c >= pz.n * pz.n || seen[c]) return false;
        if (i === 0 ? dm[c] !== k : (!adjacent(pz.n, p[i - 1], c) || (dm[c] >= 0 && dm[c] !== k))) return false;
        if (i > 0 && i < p.length - 1 && dm[c] === k) return false;
        seen[c] = true;
      }
    }
    return true;
  }

  // ---------- 3. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                         // max-merged
  //   rows: { <deviceId>: { b: <epoch>,
  //                         s: { "5"…"9": { g: solved, t: best ms (0 none) } } } }
  // }
  // Each device only ever writes ITS OWN row; a row counts from epoch b.
  // Merge per row: the newer epoch wins; equal epochs take, per size,
  // the higher g and the lower non-zero t. Rows older than br drop.
  // A join (symmetric, associative, idempotent).
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normCell(v) {
    if (!v || typeof v !== "object" || !isInt(v.g) || !isInt(v.t) ||
        v.g < 1 || v.t < 0 || v.t > MAX_MS) return null;
    return { g: v.g, t: v.t };
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
      s[k] = { g: Math.max(a.g, c.g), t: minTime(a.t, c.t) };
    });
    return { b: x.b, s: s };
  }

  function mergeFlow(A, B) {
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

  // Puzzles solved and the best time (0 = none), all devices.
  function totals(key) {
    var out = { g: 0, t: 0 };
    Object.keys(data.rows).forEach(function (id) {
      var c = data.rows[id].s[key];
      if (!c) return;
      out.g += c.g;
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
          data = mergeFlow(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] flow: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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

  // Counts a solved puzzle; a hinted one counts as solved only (no
  // time). Returns true when it set a new best time.
  function countSolve(key, ms, timed) {
    var before = totals(key);
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // new epoch after a reset
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    var c = row.s[key] || { g: 0, t: 0 };
    ms = Math.max(1, Math.min(MAX_MS, ms));
    row.s[key] = { g: c.g + 1, t: timed ? minTime(c.t, ms) : c.t };
    data.rows[deviceId] = row;
    data = mergeFlow(data, data);
    save();
    return !!timed && (!before.t || ms < before.t);
  }

  // ---------- 4. Device-local prefs + session ----------
  var prefs = { level: "5" };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object" && LEVELS.indexOf(p.level) >= 0) prefs.level = p.level;
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = { level, pz: { n, dots, sol }, paths, moves, ms,
  //          hint (a hint was used), hist: [earlier paths], done }
  var game = null;

  function validSession(g) {
    if (!g || typeof g !== "object" || LEVELS.indexOf(g.level) < 0 || !validPuzzle(g.pz) ||
        String(g.pz.n) !== g.level || !validPaths(g.pz, g.paths) ||
        !isInt(g.moves) || g.moves < 0 || !isInt(g.ms) || g.ms < 0 || g.ms > MAX_MS ||
        !Array.isArray(g.hist) || g.hist.length > MAX_HIST) return false;
    for (var i = 0; i < g.hist.length; i++) if (!validPaths(g.pz, g.hist[i])) return false;
    return true;
  }
  function loadSession() {
    try {
      var g = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(g)) {
        g.hint = g.hint === true;
        g.done = isWon(g.pz, g.paths);
        return g;
      }
    } catch (e) {}
    return null;
  }
  function saveSession() {
    if (!game) return;
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(game)); } catch (e) {}
  }

  // ---------- 5. Game flow ----------
  var runFrom = 0;          // performance.now() when the clock last resumed (0: paused)
  var tick = null;
  var making = null;        // the generator job running now (null: none)
  var sel = -1;             // the colour being drawn (pointer or keyboard), -1 none
  var cursor = 0;           // keyboard cursor cell
  var kbd = false;          // show the cursor (keyboard in use)

  function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function elapsed() { return game ? game.ms + (runFrom ? Math.round(nowMs() - runFrom) : 0) : 0; }

  function clockRuns() {
    return !!(game && !game.done && game.moves > 0 && document.visibilityState !== "hidden");
  }
  function syncClock() {
    if (runFrom && game) { game.ms = Math.min(MAX_MS, elapsed()); runFrom = 0; }
    if (clockRuns()) runFrom = nowMs();
    if (runFrom && !tick) tick = setInterval(renderClock, 500);
    if (!runFrom && tick) { clearInterval(tick); tick = null; }
    renderClock();
  }

  function inProgress() { return !!(game && !game.done && game.moves > 0); }
  function copy(g) { return JSON.parse(JSON.stringify(g)); }

  // Run the generator in slices of ~25 ms, then call done(puzzle).
  function makePuzzle(level, done) {
    var job = genJob(+level, randInt, Date.now() + GEN_MS);
    making = job;
    (function slice() {
      if (making !== job) return;                // replaced by a newer request
      var t0 = Date.now(), p = null;
      while (!p && Date.now() - t0 < 25) p = genStep(job);
      if (!p) { setTimeout(slice, 0); return; }
      making = null;
      done(p);
    })();
  }

  function setGame(g) {
    runFrom = 0;
    game = g;
    sel = -1;
    var n = game.pz.n;
    if (cursor >= n * n) cursor = Math.floor(n * n / 2);
    saveSession();
    syncClock();
    renderAll(true);
  }

  // Put back an earlier game (Undo toast of New puzzle / Restart).
  function restore(prev) {
    making = null;
    prefs.level = prev.level; savePrefs();
    setGame(prev);
  }

  // A puzzle in progress is never lost silently: Undo toast (R14).
  function newGame(announce) {
    if (game) syncClock();
    var prev = inProgress() ? copy(game) : null;
    var level = prefs.level;
    sel = -1;
    makePuzzle(level, function (pz) {
      setGame({ level: level, pz: pz, paths: pz.dots.map(function () { return []; }),
                moves: 0, ms: 0, hint: false, hist: [], done: false });
      if (prev) undoToast(t("toast.newgame"), function () { restore(prev); });
      else if (announce) live(t("toast.newgame"));
    });
    renderAll(false);
  }

  // Can the board change now? (R28: say why not)
  function gate() {
    if (making || !game) { showToast(t("toast.making")); return false; }
    if (game.done) { showToast(t("toast.done")); return false; }
    return true;
  }

  // Record the board before a change (one Undo step).
  function remember() {
    game.hist.push(copyPaths(game.paths));
    if (game.hist.length > MAX_HIST) game.hist.shift();
  }

  // A change of the board: count the move, start the clock, check the win.
  function changed(before) {
    if (JSON.stringify(before) === JSON.stringify(game.paths)) return false;
    game.hist.push(before);
    if (game.hist.length > MAX_HIST) game.hist.shift();
    var first = game.moves === 0;
    game.moves++;
    if (first) syncClock();
    return true;
  }

  function afterChange() {
    if (isWon(game.pz, game.paths)) { finish(); return; }
    saveSession();
    renderAll(false);
  }

  // Start drawing at a cell (pointer down / Enter). Returns the colour or -1.
  var strokeStart = null;   // the board when the stroke began
  var strokeWarned = false;
  function pick(cell) {
    if (!gate()) return -1;
    var s = startAt(game.pz, game.paths, cell);
    if (!s) { showToast(t("toast.start")); shake(); return -1; }
    strokeStart = copyPaths(game.paths);
    strokeWarned = false;
    game.paths = s.paths;
    sel = s.k;
    sfx("pick");
    renderAll(false);
    return s.k;
  }

  // Draw the selected line toward a cell; a fast drag fills the cells
  // between. Stops at the first refusal.
  function drawTo(cell) {
    if (sel < 0 || !game || game.done) return;
    var p = game.paths[sel];
    if (!p.length) return;
    var head = p[p.length - 1];
    if (cell === head) return;
    var steps = game.paths[sel].indexOf(cell) >= 0 ? [cell] : route(game.pz.n, head, cell);
    for (var i = 0; i < steps.length; i++) {
      var s = stepTo(game.pz, game.paths, sel, steps[i]);
      if (s.r === "dot" || s.r === "done" || s.r === "far" || s.r === "none") {
        if (!strokeWarned && (s.r === "dot" || s.r === "done")) {
          strokeWarned = true;
          showToast(t(s.r === "dot" ? "toast.blocked" : "toast.closed"));
        }
        break;
      }
      game.paths = s.paths;
      if (s.r === "joined") { sfx("join"); live(t("live.joined", { l: LETTERS[sel] })); }
    }
    renderAll(false);
  }

  // End of a stroke: one move (and one Undo step) if anything changed.
  function release() {
    if (sel < 0) return;
    var k = sel;
    sel = -1;
    if (strokeStart && changed(strokeStart)) {
      strokeStart = null;
      if (!isWon(game.pz, game.paths) && allJoined()) showToast(t("toast.full"));
      afterChange();
      return k;
    }
    strokeStart = null;
    renderAll(false);
    return k;
  }

  function allJoined() {
    for (var k = 0; k < game.pz.dots.length; k++) if (!isDone(game.pz, game.paths, k)) return false;
    return true;
  }

  function undo() {
    if (!gate()) return;
    if (sel >= 0) release();
    if (!game.hist.length) { showToast(t("toast.noundo")); return; }   // R28
    game.paths = game.hist.pop();
    game.moves++;
    afterChange();
  }

  // Clear every line. The time keeps running.
  function restart() {
    if (making) { showToast(t("toast.making")); return; }
    if (!game) return;
    if (sel >= 0) release();
    var empty = game.paths.every(function (p) { return p.length === 0; });
    if (empty && !game.done) { showToast(t("toast.empty")); return; }   // R28
    syncClock();
    var prev = copy(game), wasDone = game.done;
    if (!wasDone) remember();
    game.paths = game.pz.dots.map(function () { return []; });
    game.done = false;
    if (wasDone) { game.ms = 0; game.moves = 0; game.hint = false; game.hist = []; }
    saveSession();
    syncClock();
    renderAll(false);
    undoToast(t("toast.restart"), function () { restore(prev); });
  }

  function hint() {
    if (!gate()) return;
    if (sel >= 0) release();
    var h = hintPaths(game.pz, game.paths);
    if (!h) return;
    if (!game.hint) {
      game.hint = true;
      showToast(t("toast.hint"));
    }
    var before = copyPaths(game.paths);
    game.paths = h.paths;
    changed(before);
    sfx("join");
    live(t("live.joined", { l: LETTERS[h.k] }));
    afterChange();
  }

  function finish() {
    sel = -1;
    syncClock();
    game.done = true;
    syncClock();                               // stops the clock at the solve
    var recT = countSolve(game.level, game.ms, !game.hint);
    saveSession();
    renderAll(false);
    live(t("live.done", { t: fmtTime(game.ms) }));
    sfx("win");
    setTimeout(function () { resultDialog(recT); }, 650);
  }

  // ---------- 6. Render ----------
  var SVGNS = "http://www.w3.org/2000/svg";
  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function renderAll(rebuild) {
    renderToolbar();
    renderStatus();
    if (rebuild) buildBoard(); else renderBoard();
  }

  function renderToolbar() {
    var lv = making ? prefs.level : (game ? game.level : prefs.level);
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-level") === lv;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    $("hint-btn").setAttribute("aria-pressed", game && game.hint && !game.done ? "true" : "false");
    paintSfxBtn();
  }

  function renderClock() {
    $("time").textContent = fmtTime(elapsed());
  }

  function renderStatus() {
    renderClock();
    if (making || !game) {
      $("turn").textContent = t("turn.making");
      $("turn").className = "";
      if (!game) $("flows").textContent = "–";
      return;
    }
    var K = game.pz.dots.length, j = 0;
    for (var k = 0; k < K; k++) if (isDone(game.pz, game.paths, k)) j++;
    $("flows").textContent = j + "/" + K;
    var pct = Math.floor(100 * filled(game.pz, game.paths) / (game.pz.n * game.pz.n));
    var msg = game.done ? t("turn.done") : (!game.moves && sel < 0 ? t("turn.start") :
      (j === K ? t("turn.full") : t("turn.fill", { p: pct })));
    $("turn").textContent = msg;
    $("turn").className = game.done ? "done" : "";
  }

  function svg(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }

  var cellEls = [], pipeLayer = null, dotLayer = null, cursorEl = null, headEl = null;

  function buildBoard() {
    var b = $("board");
    while (b.firstChild) b.removeChild(b.firstChild);
    cellEls = [];
    if (!game) return;
    var n = game.pz.n;
    b.setAttribute("viewBox", "0 0 " + n + " " + n);
    b.setAttribute("aria-label", t("board.label", { n: n }));
    b.style.setProperty("--n", String(n));
    svg("rect", { "class": "bg", x: 0, y: 0, width: n, height: n, rx: 0.15 }, b);
    var cells = svg("g", {}, b);
    for (var i = 0; i < n * n; i++) {
      cellEls.push(svg("rect", { "class": "cell", x: (i % n) + 0.04, y: Math.floor(i / n) + 0.04,
        width: 0.92, height: 0.92, rx: 0.1 }, cells));
    }
    pipeLayer = svg("g", {}, b);
    dotLayer = svg("g", {}, b);
    game.pz.dots.forEach(function (d, k) {
      d.forEach(function (c) {
        var g = svg("g", { "class": "dot k" + k, "data-k": k }, dotLayer);
        svg("circle", { cx: (c % n) + 0.5, cy: Math.floor(c / n) + 0.5, r: 0.36 }, g);
        var tx = svg("text", { x: (c % n) + 0.5, y: Math.floor(c / n) + 0.5 }, g);
        tx.textContent = LETTERS[k];
      });
    });
    headEl = svg("circle", { "class": "head", r: 0.2 }, b);
    cursorEl = svg("rect", { "class": "cursor", width: 0.9, height: 0.9, rx: 0.12 }, b);
    renderBoard();
  }

  function cx(n, c) { return (c % n) + 0.5; }
  function cy(n, c) { return Math.floor(c / n) + 0.5; }

  function renderBoard() {
    var b = $("board");
    if (!game || !cellEls.length) return;
    var n = game.pz.n, own = ownerOf(n, game.paths), dm = dotMap(game.pz);
    b.classList.toggle("over", !!game.done);
    b.classList.toggle("busy", !!making);
    b.classList.toggle("kbd", kbd);
    for (var i = 0; i < n * n; i++) {
      var k = own[i] >= 0 ? own[i] : -1;
      cellEls[i].setAttribute("class", "cell" + (k >= 0 ? " own k" + k : ""));
    }
    while (pipeLayer.firstChild) pipeLayer.removeChild(pipeLayer.firstChild);
    game.paths.forEach(function (p, k) {
      if (p.length < 2) return;
      var d = "M" + p.map(function (c) { return cx(n, c) + " " + cy(n, c); }).join(" L");
      svg("path", { "class": "pipe-edge", d: d }, pipeLayer);
      svg("path", { "class": "pipe k" + k + (k === sel ? " sel" : ""), d: d }, pipeLayer);
    });
    [].forEach.call(dotLayer.children, function (g) {
      var k = +g.getAttribute("data-k");
      g.setAttribute("class", "dot k" + k + (isDone(game.pz, game.paths, k) ? " done" : "") + (k === sel ? " sel" : ""));
    });
    if (sel >= 0 && game.paths[sel].length) {
      var h = game.paths[sel][game.paths[sel].length - 1];
      headEl.setAttribute("cx", cx(n, h));
      headEl.setAttribute("cy", cy(n, h));
      headEl.setAttribute("class", "head k" + sel);
      headEl.style.display = "";
    } else headEl.style.display = "none";
    cursorEl.setAttribute("x", (cursor % n) + 0.05);
    cursorEl.setAttribute("y", Math.floor(cursor / n) + 0.05);
    var r = Math.floor(cursor / n) + 1, c = cursor % n + 1;
    var lab = dm[cursor] >= 0 ? t("cell.dot", { r: r, c: c, l: LETTERS[dm[cursor]] }) :
      (own[cursor] >= 0 ? t("cell.line", { r: r, c: c, l: LETTERS[own[cursor]] }) : t("cell.empty", { r: r, c: c }));
    cursorEl.setAttribute("aria-label", lab);
    curLabel = lab;
  }
  var curLabel = "";

  function shake() {
    var b = $("board");
    if (reduced) return;
    b.classList.remove("shake");
    void b.getBoundingClientRect();
    b.classList.add("shake");
    setTimeout(function () { b.classList.remove("shake"); }, 400);
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
  function levelName(k) { return k + "×" + k; }

  function resultDialog(recT) {
    if (!game || !game.done) return;           // replaced meanwhile
    var s = totals(game.level);
    var dlg = makeDialog("flow-result");
    dlg.appendChild(el("div", "dlg-title", t("res.title") + " · " + levelName(game.level)));
    dlg.appendChild(el("div", "dlg-hero", t("res.hero")));
    if (recT) dlg.appendChild(el("div", "dlg-badge", t("res.recT")));
    if (game.hint) dlg.appendChild(el("div", "dlg-note", t("res.hinted")));
    dlg.appendChild(row(t("res.time"), fmtTime(game.ms)));
    dlg.appendChild(row(t("res.moves"), String(game.moves)));
    dlg.appendChild(row(t("res.bestT"), s.t ? fmtTime(s.t) : "–"));
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
    var dlg = makeDialog("flow-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    LEVELS.forEach(function (k) {
      var s = totals(k);
      if (s.g) empty = false;
      dlg.appendChild(row(levelName(k), s.g ? (s.t ? fmtTime(s.t) : "–") + " · " + s.g : "–"));
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
    var dlg = makeDialog("flow-confirm");
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
    data = mergeFlow(data, data);
    save();
    showToast(t("toast.reset"));
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "flow", title: String(text) })) return;
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
      if (kind === "pick") tone(660, 0, 0.05, "triangle", 0.08);
      else if (kind === "join") { tone(784, 0, 0.08, "triangle", 0.12); tone(1047, 0.07, 0.1, "triangle", 0.12); }
      else if (kind === "win") {
        [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
      }
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Toolbar icons (R9: injected by JS) ----------
  var UI_ICONS = {
    undo:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    hint:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/></svg>',
    restart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
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
  // The cell under a pointer, or -1 outside the grid.
  function cellAt(e) {
    if (!game) return -1;
    var r = $("board").getBoundingClientRect(), n = game.pz.n;
    var x = (e.clientX - r.left) / r.width * n, y = (e.clientY - r.top) / r.height * n;
    if (x < 0 || y < 0 || x >= n || y >= n) return -1;
    return Math.floor(y) * n + Math.floor(x);
  }

  function wirePointer() {
    var b = $("board"), down = false;
    b.addEventListener("pointerdown", function (e) {
      if (e.button > 0) return;
      var c = cellAt(e);
      if (c < 0) return;
      e.preventDefault();
      kbd = false;
      try { b.focus({ preventScroll: true }); } catch (err) {}   // keys (U, H…) work after a tap
      if (sel >= 0) release();
      cursor = c;
      if (pick(c) < 0) { renderBoard(); return; }
      down = true;
      try { b.setPointerCapture(e.pointerId); } catch (err) {}
    });
    b.addEventListener("pointermove", function (e) {
      if (!down) return;
      var c = cellAt(e);
      if (c >= 0) { cursor = c; drawTo(c); }
    });
    var up = function () {
      if (!down) return;
      down = false;
      release();
    };
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
    b.addEventListener("lostpointercapture", up);
  }

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
      var onBoard = document.activeElement === $("board");
      var dir = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
      if (!dir && !onBoard) return;
      if (dir && !onBoard) { $("board").focus(); }
      if (!game) return;
      var n = game.pz.n;
      if (dir) {
        e.preventDefault();
        kbd = true;
        var r = Math.max(0, Math.min(n - 1, Math.floor(cursor / n) + dir[0]));
        var c = Math.max(0, Math.min(n - 1, cursor % n + dir[1]));
        var next = r * n + c;
        if (sel >= 0) {
          var s = stepTo(game.pz, game.paths, sel, next);
          if (s.r === "dot" || s.r === "done") { showToast(t(s.r === "dot" ? "toast.blocked" : "toast.closed")); shake(); renderBoard(); return; }
          if (s.r === "far" || s.r === "none") return;
          game.paths = s.paths;
          cursor = next;
          if (s.r === "joined") {
            sfx("join");
            live(t("live.joined", { l: LETTERS[sel] }));
            release();
            return;
          }
          renderAll(false);
        } else {
          cursor = next;
          renderBoard();
          live(curLabel);
        }
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        kbd = true;
        if (sel >= 0) { var k = release(); live(t("live.drop", { l: LETTERS[k] })); return; }
        var got = pick(cursor);
        if (got >= 0) {
          var p = game.paths[got];
          cursor = p[p.length - 1];
          renderBoard();
          live(t("live.pick", { l: LETTERS[got] }));
        }
        return;
      }
      if (e.key === "Escape") {
        if (sel >= 0) { e.preventDefault(); var k2 = release(); live(t("live.drop", { l: LETTERS[k2] })); }
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        if (sel < 0) { if (gate()) showToast(t("toast.pick")); return; }
        game.paths = retract(game.paths, sel);
        var q = game.paths[sel];
        cursor = q[q.length - 1];
        renderAll(false);
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
    api.registerSlice("flow", sliceGet, sliceSet, STORAGE_KEY, mergeFlow);
  }

  function sliceGet() {
    return mergeFlow(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeFlow(incoming, incoming);
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
    $("level-seg").setAttribute("aria-label", t("level.label"));
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
        if (!making && game && lv === game.level && !game.done) return;   // visible active state
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
      sfx("pick");   // audible confirmation when turned on
    });
    $("board").addEventListener("blur", function () {
      if (sel >= 0 && kbd) release();
    });
    wirePointer();

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
    var g = loadSession();
    if (g) {
      prefs.level = g.level;                   // the resumed puzzle decides the toolbar
      setGame(g);
    } else {
      renderAll(false);
      newGame(false);
    }
  }

  boot();
})();
