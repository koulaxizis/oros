// ============================================================
// orOS Sudoku — App logic (v1.0.0)
// Fill the 9×9 grid so every row, column and 3×3 box holds 1–9 once.
// Every puzzle is made on the device (offline): a random full grid,
// then cells come out in symmetric pairs while the solution stays
// unique. A small logical solver grades it by the techniques it needs:
//   - Easy: singles only, many givens; Medium: locked candidates;
//     Hard: pairs / triples; Expert: X-Wing, XY-Wing or beyond
//   - the maker keeps a time budget (~0.7 s) and takes the closest
//     puzzle when the budget runs out
//   - tap a cell + the number pad, or arrows + 1–9; Backspace erases;
//     N toggles notes (Shift + digit writes a note too); U / R undo and
//     redo; H gives a hint (fills one cell: no time record this puzzle)
//   - same digits and the row / column / box of the selected cell light
//     up; mistakes can be shown (option); notes clear themselves
//   - a puzzle in progress is kept on the device and resumes
// Data:
//   - synced slice "sudoku" (oros-sudoku-data): per level the best
//     time (puzzles without hints only, and when), puzzles solved and
//     puzzles solved without hints, as per-device rows (each device
//     only grows its own row; merge = per-row join) + a reset stamp br
//   - device-local (R10): oros-sudoku-prefs (level, options),
//     oros-sudoku-session (the puzzle in progress), oros-sudoku-device
//     (row id), oros-sudoku-sfx (sound on/off)
// Sections:
//   1. Constants, i18n, helpers
//   2. Sudoku model (solver, maker, logical grader, hint)
//   3. Synced data: load / save / normalize / merge (R5, R26)
//   4. Device-local prefs + session
//   5. Game flow (new, enter, notes, erase, undo / redo, hint, clock)
//   6. Render (toolbar, status, board, pad)
//   7. Dialogs (result, records, options, confirm)
//   8. Toasts
//   9. Sound
//  10. Input (keyboard, pointer, Contract Β)
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-sudoku-data";
  var PREFS_KEY   = "oros-sudoku-prefs";
  var SESSION_KEY = "oros-sudoku-session";
  var DEVICE_KEY  = "oros-sudoku-device";
  var SFX_KEY     = "oros-sudoku-sfx";
  var DATA_VER    = 1;

  var LEVELS = ["e", "m", "h", "x"];
  // min: the fewest givens the maker may leave; tier: the hardest
  // technique the puzzle should need (1 singles, 2 locked candidates,
  // 3 pairs / triples, 4 X-Wing / XY-Wing, 5 beyond the solver).
  var LV_SPEC = {
    e: { min: 36, tier: 1 },
    m: { min: 17, tier: 2 },
    h: { min: 17, tier: 3 },
    x: { min: 17, tier: 4 }
  };
  var GEN_MS = 700;                          // maker budget
  var MAX_MS = 360000000;                    // 100 h: anything above is junk
  var MAX_HIST = 400;
  // Cell tables: row, column and box of each index, the 27 units, peers.
  var ROW = [], COL = [], BOX = [], UNITS = [], PEERS = [], IS_PEER = [];
  var POP = [];
  (function () {
    var i, j, k;
    for (i = 0; i < 512; i++) { k = 0; for (j = i; j; j &= j - 1) k++; POP.push(k); }
    for (i = 0; i < 81; i++) {
      ROW.push(Math.floor(i / 9));
      COL.push(i % 9);
      BOX.push(Math.floor(i / 27) * 3 + Math.floor((i % 9) / 3));
    }
    for (k = 0; k < 27; k++) UNITS.push([]);
    for (i = 0; i < 81; i++) {
      UNITS[ROW[i]].push(i);
      UNITS[9 + COL[i]].push(i);
      UNITS[18 + BOX[i]].push(i);
    }
    for (i = 0; i < 81; i++) {
      var p = [];
      for (j = 0; j < 81; j++) {
        var on = i !== j && (ROW[i] === ROW[j] || COL[i] === COL[j] || BOX[i] === BOX[j]);
        IS_PEER.push(on);
        if (on) p.push(j);
      }
      PEERS.push(p);
    }
  })();

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
      "lv.e": "Easy", "lv.m": "Medium", "lv.h": "Hard", "lv.x": "Expert",
      "btn.new": "New puzzle",
      "btn.stats": "Records",
      "btn.opts": "Options",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "pad.digit": "Digit {d}, {n} left",
      "pad.undo": "Undo (U)", "pad.redo": "Redo (R)", "pad.erase": "Erase (Backspace)",
      "pad.notes": "Notes (N)", "pad.hint": "Hint (H)",
      "pad.undoS": "Undo", "pad.redoS": "Redo", "pad.eraseS": "Erase",
      "pad.notesS": "Notes", "pad.hintS": "Hint",
      "st.time": "Time", "st.best": "Best",
      "turn.making": "Making a puzzle…",
      "turn.start": "Tap a cell, then a digit",
      "turn.play": "{l}: {n} cells to go",
      "turn.notes": "Notes on: digits go in as notes",
      "turn.hinted": "Hint used: no time record this puzzle",
      "turn.done": "Solved!",
      "board.label": "Sudoku grid. Arrows move, 1 to 9 fill, Backspace erases",
      "cell.at": "Row {r}, column {c}",
      "cell.given": "given {d}",
      "cell.empty": "empty",
      "cell.notes": "notes {n}",
      "live.done": "Solved in {t}",
      "live.hint": "Hint: {d} at row {r}, column {c}",
      "res.title": "Solved",
      "res.time": "Time",
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
      "opts.title": "Options",
      "opts.mist": "Show mistakes",
      "opts.mistSub": "A digit that breaks the solution turns red",
      "opts.auto": "Clear notes automatically",
      "opts.autoSub": "A digit removes itself from the notes in its row, column and box",
      "opts.close": "Close",
      "confirm.reset": "Delete the records on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Records reset",
      "toast.newgame": "New puzzle",
      "toast.undo": "Undo",
      "toast.given": "That digit is part of the puzzle",
      "toast.pick": "Pick a cell first",
      "toast.noUndo": "Nothing to undo",
      "toast.noRedo": "Nothing to redo",
      "toast.noErase": "Nothing to erase in this cell",
      "toast.noteFull": "Clear the digit before writing notes",
      "toast.done": "Solved: start a new puzzle",
      "toast.hint": "Hint used: this puzzle sets no time record",
      "toast.making": "Still making the puzzle…",
      "toast.save": "Could not save: storage is full"
    },
    el: {
      "lv.e": "Εύκολο", "lv.m": "Μέτριο", "lv.h": "Δύσκολο", "lv.x": "Πολύ δύσκολο",
      "btn.new": "Νέο σουντόκου",
      "btn.stats": "Ρεκόρ",
      "btn.opts": "Ρυθμίσεις",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "pad.digit": "Ψηφίο {d}, απομένουν {n}",
      "pad.undo": "Αναίρεση (U)", "pad.redo": "Επανάληψη (R)", "pad.erase": "Σβήσιμο (Backspace)",
      "pad.notes": "Σημειώσεις (N)", "pad.hint": "Βοήθεια (H)",
      "pad.undoS": "Αναίρεση", "pad.redoS": "Επανάληψη", "pad.eraseS": "Σβήσιμο",
      "pad.notesS": "Σημειώσεις", "pad.hintS": "Βοήθεια",
      "st.time": "Χρόνος", "st.best": "Ρεκόρ",
      "turn.making": "Φτιάχνεται ένα σουντόκου…",
      "turn.start": "Διάλεξε κελί και μετά ψηφίο",
      "turn.play": "{l}: μένουν {n} κελιά",
      "turn.notes": "Σημειώσεις: τα ψηφία μπαίνουν ως σημειώσεις",
      "turn.hinted": "Πήρες βοήθεια: χωρίς ρεκόρ χρόνου εδώ",
      "turn.done": "Λύθηκε!",
      "board.label": "Πλέγμα σουντόκου. Βελάκια για κίνηση, 1 έως 9 για ψηφία, Backspace για σβήσιμο",
      "cell.at": "Γραμμή {r}, στήλη {c}",
      "cell.given": "δοσμένο {d}",
      "cell.empty": "κενό",
      "cell.notes": "σημειώσεις {n}",
      "live.done": "Λύθηκε σε {t}",
      "live.hint": "Βοήθεια: {d} στη γραμμή {r}, στήλη {c}",
      "res.title": "Λύθηκε",
      "res.time": "Χρόνος",
      "res.best": "Καλύτερος χρόνος",
      "res.solved": "Λυμένα",
      "res.hints": "Βοήθειες",
      "res.rec": "Νέο ρεκόρ χρόνου!",
      "res.noRec": "Πήρες βοήθεια: χωρίς ρεκόρ χρόνου σε αυτό το σουντόκου",
      "res.again": "Νέο σουντόκου",
      "res.close": "Κλείσιμο",
      "stats.title": "Ρεκόρ",
      "stats.head": "Καλύτερος χρόνος · λυμένα · χωρίς βοήθεια",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "opts.title": "Ρυθμίσεις",
      "opts.mist": "Εμφάνιση λαθών",
      "opts.mistSub": "Ένα ψηφίο που δεν ταιριάζει στη λύση γίνεται κόκκινο",
      "opts.auto": "Αυτόματο σβήσιμο σημειώσεων",
      "opts.autoSub": "Ένα ψηφίο σβήνεται από τις σημειώσεις της γραμμής, της στήλης και του κουτιού του",
      "opts.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.newgame": "Νέο σουντόκου",
      "toast.undo": "Αναίρεση",
      "toast.given": "Αυτό το ψηφίο είναι δοσμένο",
      "toast.pick": "Διάλεξε πρώτα ένα κελί",
      "toast.noUndo": "Τίποτα για αναίρεση",
      "toast.noRedo": "Τίποτα για επανάληψη",
      "toast.noErase": "Δεν υπάρχει κάτι να σβηστεί σε αυτό το κελί",
      "toast.noteFull": "Σβήσε το ψηφίο πριν γράψεις σημειώσεις",
      "toast.done": "Λύθηκε: ξεκίνα νέο σουντόκου",
      "toast.hint": "Πήρες βοήθεια: αυτό το σουντόκου δεν γράφει ρεκόρ χρόνου",
      "toast.making": "Το σουντόκου φτιάχνεται ακόμα…",
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
    console.log("sudoku.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Sudoku model ----------
  // grid = array of 81 digits (0 = empty), index r * 9 + c. Candidate
  // masks use bit d - 1 for digit d.

  function shuffled(list, rnd) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1)), x = a[i];
      a[i] = a[j]; a[j] = x;
    }
    return a;
  }

  // Backtracking search with the most constrained cell first. Counts
  // solutions up to limit; returns { n, sol: the first one or null }.
  // With rnd the digits are tried in random order (for a random grid).
  function solveGrid(grid, limit, rnd) {
    var g = grid.slice(), rm = [], cm = [], bm = [], i, n = 0, first = null;
    for (i = 0; i < 9; i++) { rm.push(0); cm.push(0); bm.push(0); }
    for (i = 0; i < 81; i++) {
      var v = g[i];
      if (!v) continue;
      var bit = 1 << (v - 1);
      if ((rm[ROW[i]] | cm[COL[i]] | bm[BOX[i]]) & bit) return { n: 0, sol: null };
      rm[ROW[i]] |= bit; cm[COL[i]] |= bit; bm[BOX[i]] |= bit;
    }
    var digits = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    function rec() {
      var best = -1, bestMask = 0, bestN = 10;
      for (var k = 0; k < 81; k++) {
        if (g[k]) continue;
        var m = ~(rm[ROW[k]] | cm[COL[k]] | bm[BOX[k]]) & 511, c = POP[m];
        if (c < bestN) { best = k; bestMask = m; bestN = c; if (c <= 1) break; }
      }
      if (best < 0) {
        n++;
        if (!first) first = g.slice();
        return n >= limit;
      }
      if (!bestN) return false;
      var order = rnd ? shuffled(digits, rnd) : digits;
      for (var j = 0; j < 9; j++) {
        var d = order[j], b = 1 << d;
        if (!(bestMask & b)) continue;
        g[best] = d + 1;
        rm[ROW[best]] |= b; cm[COL[best]] |= b; bm[BOX[best]] |= b;
        var stop = rec();
        rm[ROW[best]] &= ~b; cm[COL[best]] &= ~b; bm[BOX[best]] &= ~b;
        g[best] = 0;
        if (stop) return true;
      }
      return false;
    }
    rec();
    return { n: n, sol: first };
  }

  function emptyGrid() {
    var g = [];
    for (var i = 0; i < 81; i++) g.push(0);
    return g;
  }

  // A random complete grid.
  function fullGrid(rnd) {
    return solveGrid(emptyGrid(), 1, rnd).sol;
  }

  // Take cells out in symmetric pairs (i and 80 - i), in random order,
  // keeping a unique solution and at least minGivens givens.
  function carve(full, minGivens, rnd) {
    var puz = full.slice(), givens = 81, order = [], i;
    for (i = 0; i <= 40; i++) order.push(i);
    order = shuffled(order, rnd);
    for (i = 0; i < order.length; i++) {
      var p = order[i], q = 80 - p, k = p === q ? 1 : 2;
      if (givens - k < minGivens) continue;
      var vp = puz[p], vq = puz[q];
      puz[p] = 0; puz[q] = 0;
      if (solveGrid(puz, 2, null).n !== 1) { puz[p] = vp; puz[q] = vq; }
      else givens -= k;
    }
    return puz;
  }

  // Candidates of every empty cell of a grid (0 for a filled cell).
  function candidates(grid) {
    var out = [];
    for (var i = 0; i < 81; i++) {
      if (grid[i]) { out.push(0); continue; }
      var m = 511, p = PEERS[i];
      for (var j = 0; j < p.length; j++) if (grid[p[j]]) m &= ~(1 << (grid[p[j]] - 1));
      out.push(m);
    }
    return out;
  }

  // Solve like a person, simplest technique first. Returns { tier, solved,
  // left }: tier = the hardest technique used (1 singles, 2 locked
  // candidates, 3 naked / hidden pairs and triples, 4 X-Wing / XY-Wing),
  // 5 when these are not enough.
  function logicTier(puzzle) {
    var val = puzzle.slice(), cand = candidates(val), left = 0, tier = 1, i;
    for (i = 0; i < 81; i++) if (!val[i]) left++;

    function place(k, d) {
      val[k] = d;
      cand[k] = 0;
      left--;
      var b = ~(1 << (d - 1)), p = PEERS[k];
      for (var j = 0; j < p.length; j++) cand[p[j]] &= b;
    }
    function singles() {
      var hit = false, k, u, d;
      for (k = 0; k < 81; k++) {
        if (!val[k] && POP[cand[k]] === 1) { place(k, 1 + Math.round(Math.log(cand[k]) / Math.LN2)); hit = true; }
      }
      for (u = 0; u < 27; u++) {
        for (d = 0; d < 9; d++) {
          var at = -1, cnt = 0, cells = UNITS[u];
          for (var j = 0; j < 9; j++) if (cand[cells[j]] & (1 << d)) { cnt++; at = cells[j]; }
          if (cnt === 1) { place(at, d + 1); hit = true; }
        }
      }
      return hit;
    }
    function drop(k, mask) {
      if (val[k] || !(cand[k] & mask)) return false;
      cand[k] &= ~mask;
      return true;
    }
    // Pointing and claiming: a digit confined to one line of a box (or to
    // one box of a line) leaves the rest of that line (or box).
    function locked() {
      var hit = false;
      for (var u = 0; u < 27; u++) {
        for (var d = 0; d < 9; d++) {
          var b = 1 << d, cells = UNITS[u], rows = 0, cols = 0, boxes = 0, cnt = 0, j;
          for (j = 0; j < 9; j++) {
            var k = cells[j];
            if (cand[k] & b) { cnt++; rows |= 1 << ROW[k]; cols |= 1 << COL[k]; boxes |= 1 << BOX[k]; }
          }
          if (cnt < 2) continue;
          var targets = [];
          if (u >= 18) {
            if (POP[rows] === 1) targets.push(UNITS[Math.round(Math.log(rows) / Math.LN2)]);
            if (POP[cols] === 1) targets.push(UNITS[9 + Math.round(Math.log(cols) / Math.LN2)]);
          } else if (POP[boxes] === 1) {
            targets.push(UNITS[18 + Math.round(Math.log(boxes) / Math.LN2)]);
          }
          for (var x = 0; x < targets.length; x++) {
            for (j = 0; j < 9; j++) {
              var c = targets[x][j];
              if (cells.indexOf(c) < 0 && drop(c, b)) hit = true;
            }
          }
          if (hit) return true;
        }
      }
      return false;
    }
    // Naked and hidden pairs / triples inside a unit.
    function subsets() {
      for (var size = 2; size <= 3; size++) {
        for (var u = 0; u < 27; u++) {
          var cells = UNITS[u], hit = false, m, j;
          for (m = 1; m < 512; m++) {
            if (POP[m] !== size) continue;
            // naked: size cells (positions m) whose candidates fit in size digits
            var uni = 0, ok = true;
            for (j = 0; j < 9 && ok; j++) {
              if (!(m & (1 << j))) continue;
              if (val[cells[j]]) ok = false; else uni |= cand[cells[j]];
            }
            if (ok && POP[uni] === size) {
              for (j = 0; j < 9; j++) if (!(m & (1 << j)) && drop(cells[j], uni)) hit = true;
              if (hit) return true;
            }
            // hidden: size digits (m) that only fit in size cells
            var pos = 0, every = true;
            for (var d = 0; d < 9 && every; d++) {
              if (!(m & (1 << d))) continue;
              var here = 0;
              for (j = 0; j < 9; j++) if (cand[cells[j]] & (1 << d)) here |= 1 << j;
              if (!here) every = false;
              pos |= here;
            }
            if (every && POP[pos] === size) {
              for (j = 0; j < 9; j++) if ((pos & (1 << j)) && drop(cells[j], 511 & ~m)) hit = true;
              if (hit) return true;
            }
          }
        }
      }
      return false;
    }
    // X-Wing on rows and on columns; XY-Wing.
    function wings() {
      var d, a, b, j, hit = false;
      for (var dirn = 0; dirn < 2; dirn++) {
        for (d = 0; d < 9; d++) {
          var bit = 1 << d, masks = [];
          for (a = 0; a < 9; a++) {
            var mk = 0;
            for (j = 0; j < 9; j++) {
              var k = dirn ? j * 9 + a : a * 9 + j;
              if (cand[k] & bit) mk |= 1 << j;
            }
            masks.push(mk);
          }
          for (a = 0; a < 9; a++) {
            if (POP[masks[a]] !== 2) continue;
            for (b = a + 1; b < 9; b++) {
              if (masks[b] !== masks[a]) continue;
              for (j = 0; j < 9; j++) {
                if (!(masks[a] & (1 << j))) continue;
                for (var o = 0; o < 9; o++) {
                  if (o === a || o === b) continue;
                  var kk = dirn ? j * 9 + o : o * 9 + j;
                  if (drop(kk, bit)) hit = true;
                }
              }
              if (hit) return true;
            }
          }
        }
      }
      for (var p = 0; p < 81; p++) {
        if (val[p] || POP[cand[p]] !== 2) continue;
        var pp = PEERS[p];
        for (a = 0; a < pp.length; a++) {
          var x = pp[a], cx = cand[x];
          if (val[x] || POP[cx] !== 2 || POP[cx & cand[p]] !== 1) continue;
          var z = cx & ~cand[p];                       // pincer x = {shared, z}
          for (b = a + 1; b < pp.length; b++) {
            var y = pp[b], cy = cand[y];
            if (val[y] || POP[cy] !== 2 || cy === cx) continue;
            if ((cy & cand[p]) !== (cand[p] & ~cx) || !(cy & z)) continue;
            for (j = 0; j < 81; j++) {
              if (j === x || j === y || j === p) continue;
              if (IS_PEER[j * 81 + x] && IS_PEER[j * 81 + y] && drop(j, z)) hit = true;
            }
            if (hit) return true;
          }
        }
      }
      return false;
    }

    while (left > 0) {
      if (singles()) continue;
      if (locked()) { if (tier < 2) tier = 2; continue; }
      if (subsets()) { if (tier < 3) tier = 3; continue; }
      if (wings()) { if (tier < 4) tier = 4; continue; }
      return { tier: 5, solved: false, left: left };
    }
    return { tier: tier, solved: true, left: 0 };
  }

  // How far a graded puzzle is from what a level wants (0 = a match).
  // Expert wants tier 4 (X-Wing / XY-Wing) and takes tier 5 (beyond the
  // solver, still unique) when no tier 4 puzzle came in time.
  function levelDistance(lv, tier) {
    var want = LV_SPEC[lv].tier;
    if (lv === "x") return tier === 4 ? 0 : (tier === 5 ? 0.5 : 4 - tier);
    return Math.abs(tier - want);
  }

  // Make a puzzle for a level within budgetMs: { puz, sol, tier }, the
  // closest one found when no exact match came in time.
  function generate(lv, rnd, budgetMs, clock) {
    var t0 = clock(), best = null;
    do {
      var sol = fullGrid(rnd);
      var puz = carve(sol, LV_SPEC[lv].min, rnd);
      var g = logicTier(puz);
      var dist = levelDistance(lv, g.tier);
      if (!best || dist < best.dist) best = { puz: puz, sol: sol, tier: g.tier, dist: dist };
      if (!dist) break;
    } while (clock() - t0 < budgetMs);
    return { puz: best.puz, sol: best.sol, tier: best.tier };
  }

  // The cell a hint fills: the selected cell when it is open or wrong,
  // else a wrong digit, else a cell that a single settles, else any
  // open cell. -1 when nothing is left.
  function hintCell(puz, sol, vals, sel) {
    var open = function (i) { return !puz[i] && vals[i] !== sol[i]; };
    if (sel >= 0 && sel < 81 && open(sel)) return sel;
    var i, grid = [], firstOpen = -1;
    for (i = 0; i < 81; i++) {
      if (puz[i]) grid.push(puz[i]);
      else if (vals[i] && vals[i] !== sol[i]) return i;
      else grid.push(vals[i]);
      if (firstOpen < 0 && open(i)) firstOpen = i;
    }
    if (firstOpen < 0) return -1;
    var cand = candidates(grid);
    for (i = 0; i < 81; i++) if (!grid[i] && POP[cand[i]] === 1) return i;
    for (var u = 0; u < 27; u++) {
      for (var d = 0; d < 9; d++) {
        var at = -1, cnt = 0;
        for (var j = 0; j < 9; j++) if (cand[UNITS[u][j]] & (1 << d)) { cnt++; at = UNITS[u][j]; }
        if (cnt === 1) return at;
      }
    }
    return firstOpen;
  }

  // ---------- 3. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                       // max-merged
  //   rows: { <deviceId>: { b: <epoch>,
  //                         s: { e|m|h|x: { t: best ms (0 = none), ts: when,
  //                                         n: solved, c: solved without hints } } } }
  // }
  // Each device only ever writes ITS OWN row; a row counts from epoch b.
  // Merge per row: the newer epoch wins; equal epochs take, per level,
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
    return { t: best.t, ts: best.ts, n: Math.max(a.n, c.n), c: Math.max(a.c, c.c) };
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

  function mergeSudoku(A, B) {
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

  // Best time, solved and clean solves for a level, across every device.
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
          data = mergeSudoku(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] sudoku: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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
    data = mergeSudoku(data, data);
    save();
    return !hinted && (!before.t || ms < before.t);
  }

  // ---------- 4. Device-local prefs + session ----------
  var prefs = { lv: "e", mist: true, auto: true };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (LEVELS.indexOf(p.lv) >= 0) prefs.lv = p.lv;
        if (typeof p.mist === "boolean") prefs.mist = p.mist;
        if (typeof p.auto === "boolean") prefs.auto = p.auto;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = { lv, puz: "81 digits", sol: "81 digits", v: [81 entries],
  //          nt: [81 note masks], ms, hints, done, sel, notes (mode),
  //          hist: [[change…]…], fut: [[change…]…] }
  // change = [cell, old digit, old notes, new digit, new notes]
  var game = null;

  function digitsOf(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) - 48);
    return out;
  }
  function validChanges(list) {
    if (!Array.isArray(list) || list.length > MAX_HIST) return false;
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!Array.isArray(a) || !a.length) return false;
      for (var j = 0; j < a.length; j++) {
        var c = a[j];
        if (!Array.isArray(c) || c.length !== 5 || !isInt(c[0]) || c[0] < 0 || c[0] > 80 ||
            !isInt(c[1]) || c[1] < 0 || c[1] > 9 || !isInt(c[3]) || c[3] < 0 || c[3] > 9 ||
            !isInt(c[2]) || c[2] < 0 || c[2] > 511 || !isInt(c[4]) || c[4] < 0 || c[4] > 511) return false;
      }
    }
    return true;
  }
  function validSession(g) {
    if (!g || typeof g !== "object" || LEVELS.indexOf(g.lv) < 0 ||
        typeof g.puz !== "string" || !/^[0-9]{81}$/.test(g.puz) ||
        typeof g.sol !== "string" || !/^[1-9]{81}$/.test(g.sol) ||
        !Array.isArray(g.v) || g.v.length !== 81 || !Array.isArray(g.nt) || g.nt.length !== 81 ||
        !isInt(g.ms) || g.ms < 0 || g.ms > MAX_MS || !isInt(g.hints) || g.hints < 0 ||
        typeof g.done !== "boolean" || !isInt(g.sel) || g.sel < -1 || g.sel > 80) return false;
    var puz = digitsOf(g.puz), sol = digitsOf(g.sol);
    for (var i = 0; i < 81; i++) {
      if (puz[i] && puz[i] !== sol[i]) return false;
      if (!isInt(g.v[i]) || g.v[i] < 0 || g.v[i] > 9 || (puz[i] && g.v[i])) return false;
      if (!isInt(g.nt[i]) || g.nt[i] < 0 || g.nt[i] > 511) return false;
    }
    var check = solveGrid(sol, 1, null);
    return check.n === 1;
  }
  function loadSession() {
    try {
      var g = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(g)) {
        if (!validChanges(g.hist)) g.hist = [];
        if (!validChanges(g.fut)) g.fut = [];
        g.notes = g.notes === true;
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
  var making = false;       // a puzzle is being made
  var PUZ = null, SOL = null;   // digit arrays of game.puz / game.sol

  function elapsed() { return game.ms + (runFrom ? Math.round(nowMs() - runFrom) : 0); }
  function clockRuns() {
    return !!(game && !game.done && !making && document.visibilityState !== "hidden");
  }
  // Fold the running time into game.ms and stop or (re)start the clock.
  function syncClock() {
    if (runFrom) { game.ms = Math.min(MAX_MS, elapsed()); runFrom = 0; }
    if (clockRuns()) runFrom = nowMs();
    if (runFrom && !tick) tick = setInterval(renderClock, 500);
    if (!runFrom && tick) { clearInterval(tick); tick = null; }
    renderClock();
  }

  function setGame(g) {
    game = g;
    PUZ = digitsOf(g.puz);
    SOL = digitsOf(g.sol);
  }

  function fresh(lv) {
    var p = generate(lv, rand, GEN_MS, nowMs);
    var v = [], nt = [];
    for (var i = 0; i < 81; i++) { v.push(0); nt.push(0); }
    return { lv: lv, puz: p.puz.join(""), sol: p.sol.join(""), v: v, nt: nt, ms: 0, hints: 0,
             done: false, sel: -1, notes: false, hist: [], fut: [] };
  }
  function filledCount() {
    var n = 0;
    for (var i = 0; i < 81; i++) if (PUZ[i] || game.v[i]) n++;
    return n;
  }
  function inProgress() {
    if (!game || game.done) return false;
    if (game.hints) return true;
    for (var i = 0; i < 81; i++) if (game.v[i] || game.nt[i]) return true;
    return false;
  }
  function copy(g) { return JSON.parse(JSON.stringify(g)); }

  // A puzzle in progress is never lost silently: Undo toast (R14). The
  // new puzzle is made after a paint, so "Making a puzzle…" shows.
  function newGame(lv) {
    if (making) { showToast(t("toast.making")); return; }
    closeDialogs();
    var prev = inProgress() ? (saveSession(), copy(game)) : null;
    prefs.lv = lv; savePrefs();
    making = true;
    syncClock();
    renderAll();
    setTimeout(function () {
      setGame(fresh(lv));
      making = false;
      saveSession();
      syncClock();
      renderAll();
      if (prev) {
        undoToast(t("toast.newgame"), function () {
          runFrom = 0;
          prefs.lv = prev.lv; savePrefs();
          setGame(prev);
          saveSession();
          syncClock();
          renderAll();
        });
      } else {
        live(t("toast.newgame"));
      }
    }, 40);
  }

  // Refusals shared by every edit (R28). Returns the cell or -1.
  function editableCell() {
    if (making) { showToast(t("toast.making")); return -1; }
    if (game.done) { showToast(t("toast.done")); return -1; }
    var i = game.sel;
    if (i < 0) { showToast(t("toast.pick")); return -1; }
    if (PUZ[i]) { showToast(t("toast.given")); shakeCell(i); return -1; }
    return i;
  }

  function commit(changes) {
    if (!changes.length) return;
    game.hist.push(changes);
    if (game.hist.length > MAX_HIST) game.hist.shift();
    game.fut = [];
    applyChanges(changes, true);
  }
  function applyChanges(changes, forward) {
    var list = forward ? changes : changes.slice().reverse();
    list.forEach(function (c) {
      game.v[c[0]] = forward ? c[3] : c[1];
      game.nt[c[0]] = forward ? c[4] : c[2];
    });
  }

  // Digit d into the selected cell (a note in notes mode or with asNote).
  function enter(d, asNote) {
    var i = editableCell();
    if (i < 0) return;
    var note = asNote || game.notes, changes = [];
    if (note) {
      if (game.v[i]) { showToast(t("toast.noteFull")); return; }
      var nn = game.nt[i] ^ (1 << (d - 1));
      changes.push([i, 0, game.nt[i], 0, nn]);
      sfx("note");
    } else {
      var nv = game.v[i] === d ? 0 : d;
      changes.push([i, game.v[i], game.nt[i], nv, 0]);
      if (nv && prefs.auto) {
        var b = 1 << (d - 1);
        PEERS[i].forEach(function (p) {
          if (!PUZ[p] && !game.v[p] && (game.nt[p] & b)) changes.push([p, 0, game.nt[p], 0, game.nt[p] & ~b]);
        });
      }
      sfx(nv && prefs.mist && nv !== SOL[i] ? "bad" : "tap");
    }
    commit(changes);
    afterEdit();
  }

  function erase() {
    var i = editableCell();
    if (i < 0) return;
    if (!game.v[i] && !game.nt[i]) { showToast(t("toast.noErase")); return; }
    commit([[i, game.v[i], game.nt[i], 0, game.v[i] ? game.nt[i] : 0]]);
    afterEdit();
  }

  function undo() {
    if (making) { showToast(t("toast.making")); return; }
    if (game.done || !game.hist.length) { showToast(t(game.done ? "toast.done" : "toast.noUndo")); return; }
    var c = game.hist.pop();
    applyChanges(c, false);
    game.fut.push(c);
    game.sel = c[0][0];
    afterEdit();
  }
  function redo() {
    if (making) { showToast(t("toast.making")); return; }
    if (game.done || !game.fut.length) { showToast(t(game.done ? "toast.done" : "toast.noRedo")); return; }
    var c = game.fut.pop();
    applyChanges(c, true);
    game.hist.push(c);
    game.sel = c[0][0];
    afterEdit();
  }

  function hint() {
    if (making) { showToast(t("toast.making")); return; }
    if (game.done) { showToast(t("toast.done")); return; }
    var i = hintCell(PUZ, SOL, game.v, game.sel);
    if (i < 0) return;
    var d = SOL[i], changes = [[i, game.v[i], game.nt[i], d, 0]];
    var b = 1 << (d - 1);
    if (prefs.auto) {
      PEERS[i].forEach(function (p) {
        if (!PUZ[p] && !game.v[p] && (game.nt[p] & b)) changes.push([p, 0, game.nt[p], 0, game.nt[p] & ~b]);
      });
    }
    if (!game.hints) showToast(t("toast.hint"));
    game.hints++;
    game.sel = i;
    commit(changes);
    live(t("live.hint", { d: d, r: ROW[i] + 1, c: COL[i] + 1 }));
    sfx("hint");
    afterEdit();
  }

  function toggleNotes() {
    if (making) { showToast(t("toast.making")); return; }
    if (game.done) { showToast(t("toast.done")); return; }
    game.notes = !game.notes;
    saveSession();
    renderAll();
  }

  function solved() {
    for (var i = 0; i < 81; i++) if ((PUZ[i] || game.v[i]) !== SOL[i]) return false;
    return true;
  }

  function afterEdit() {
    if (solved()) { finish(); return; }
    saveSession();
    renderAll();
  }

  function finish() {
    syncClock();
    game.done = true;
    game.notes = false;
    syncClock();
    var rec = countSolve(game.lv, game.ms, game.hints > 0);
    saveSession();
    renderAll();
    live(t("live.done", { t: fmtTime(game.ms) }));
    sfx("win");
    var b = $("board");
    if (!reduced) { b.classList.remove("won"); void b.offsetWidth; b.classList.add("won"); }
    setTimeout(function () { resultDialog(rec); }, reduced ? 50 : 700);
  }

  function select(i) {
    if (!game || making) return;
    game.sel = i;
    saveSession();
    renderBoard();
    renderPad();
    live(cellLabel(i));
  }
  function moveSel(dr, dc) {
    var i = game.sel < 0 ? 40 : game.sel;
    var r = (ROW[i] + dr + 9) % 9, c = (COL[i] + dc + 9) % 9;
    select(r * 9 + c);
  }

  // ---------- 6. Render ----------
  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var cellEls = [];

  function renderAll() {
    renderToolbar();
    renderStatus();
    renderBoard();
    renderPad();
  }

  function renderToolbar() {
    var cur = game && !making ? game.lv : prefs.lv;
    [].forEach.call(document.querySelectorAll("#lv-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-lv") === cur;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    paintSfxBtn();
  }

  function renderClock() {
    if (!game) return;
    $("time").textContent = making ? "–" : fmtTime(elapsed());
  }

  function renderStatus() {
    renderClock();
    var lv = making ? prefs.lv : game.lv, s = totals(lv);
    $("best").textContent = s.t ? fmtTime(s.t) : "–";
    var msg, cls = "";
    if (making) msg = t("turn.making");
    else if (game.done) { msg = t("turn.done"); cls = "done"; }
    else if (game.notes) { msg = t("turn.notes"); cls = "done"; }
    else if (game.hints) { msg = t("turn.hinted"); cls = "warn"; }
    else if (filledCount() === countGivens()) msg = t("turn.start");
    else msg = t("turn.play", { l: t("lv." + game.lv), n: 81 - filledCount() });
    $("turn").textContent = msg;
    $("turn").className = cls;
  }
  function countGivens() {
    var n = 0;
    for (var i = 0; i < 81; i++) if (PUZ[i]) n++;
    return n;
  }

  function buildBoard() {
    var b = $("board");
    b.innerHTML = "";
    b.setAttribute("aria-label", t("board.label"));
    cellEls = [];
    var boxes = [];
    for (var k = 0; k < 9; k++) {
      var box = document.createElement("div");
      box.className = "box";
      b.appendChild(box);
      boxes.push(box);
    }
    for (var i = 0; i < 81; i++) {
      var c = document.createElement("div");
      c.className = "cell";
      c.setAttribute("data-i", String(i));
      boxes[BOX[i]].appendChild(c);
      cellEls.push(c);
    }
    // keep the DOM order of each box row by row
    for (k = 0; k < 9; k++) {
      var list = [];
      for (i = 0; i < 81; i++) if (BOX[i] === k) list.push(cellEls[i]);
      list.forEach(function (n) { boxes[k].appendChild(n); });
    }
  }

  function cellLabel(i) {
    var s = t("cell.at", { r: ROW[i] + 1, c: COL[i] + 1 }) + ": ";
    if (PUZ[i]) return s + t("cell.given", { d: PUZ[i] });
    if (game.v[i]) return s + game.v[i];
    if (game.nt[i]) {
      var ds = [];
      for (var d = 1; d <= 9; d++) if (game.nt[i] & (1 << (d - 1))) ds.push(d);
      return s + t("cell.notes", { n: ds.join(" ") });
    }
    return s + t("cell.empty");
  }

  function renderBoard() {
    if (!cellEls.length) buildBoard();
    var b = $("board");
    b.classList.toggle("making", making);
    b.classList.toggle("solved", !!(game && game.done && !making));
    if (!game || making) {
      cellEls.forEach(function (c) { c.className = "cell"; c.textContent = ""; });
      return;
    }
    var sel = game.sel, sd = sel >= 0 ? (PUZ[sel] || game.v[sel]) : 0;
    for (var i = 0; i < 81; i++) {
      var c = cellEls[i], v = PUZ[i] || game.v[i], cls = "cell";
      if (PUZ[i]) cls += " given";
      else if (v) cls += " user";
      if (v && prefs.mist && !PUZ[i] && v !== SOL[i]) cls += " bad";
      if (i === sel) cls += " sel";
      else if (sel >= 0 && IS_PEER[sel * 81 + i]) cls += " peer";
      if (sd && v === sd && i !== sel) cls += " same";
      var key = cls + "|" + v + "|" + game.nt[i] + "|" + (sd || 0);
      if (c.__k === key) continue;
      c.__k = key;
      c.className = cls;
      if (v) c.textContent = String(v);
      else if (game.nt[i]) {
        c.textContent = "";
        var g = document.createElement("div");
        g.className = "notes";
        for (var d = 1; d <= 9; d++) {
          var s = document.createElement("span");
          if (game.nt[i] & (1 << (d - 1))) {
            s.textContent = String(d);
            if (d === sd) s.className = "hl";
          }
          g.appendChild(s);
        }
        c.appendChild(g);
      } else c.textContent = "";
    }
  }

  function shakeCell(i) {
    if (reduced || !cellEls[i]) return;
    var c = cellEls[i];
    c.classList.remove("shake");
    void c.offsetWidth;
    c.classList.add("shake");
    setTimeout(function () { c.classList.remove("shake"); }, 400);
  }

  var padBuilt = false;
  function buildPad() {
    var dg = $("digits"), tl = $("tools");
    dg.innerHTML = "";
    tl.innerHTML = "";
    for (var d = 1; d <= 9; d++) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "key digit";
      b.setAttribute("data-d", String(d));
      b.innerHTML = '<span class="dn">' + d + '</span><span class="dc"></span>';
      (function (dd) {
        b.addEventListener("click", function () { enter(dd, false); });
      })(d);
      dg.appendChild(b);
    }
    [["undo", "pad.undo", "pad.undoS", undo], ["redo", "pad.redo", "pad.redoS", redo],
     ["erase", "pad.erase", "pad.eraseS", erase], ["notes", "pad.notes", "pad.notesS", toggleNotes],
     ["hint", "pad.hint", "pad.hintS", hint]].forEach(function (x) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "key tool";
      b.id = "pad-" + x[0];
      b.innerHTML = UI_ICONS[x[0]] + '<span class="tl">' + t(x[2]) + "</span>";
      b.setAttribute("aria-label", t(x[1]));
      b.title = t(x[1]);
      b.addEventListener("click", x[3]);
      tl.appendChild(b);
    });
    padBuilt = true;
  }

  function renderPad() {
    if (!padBuilt) buildPad();
    var counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    if (game && !making) for (var i = 0; i < 81; i++) counts[PUZ[i] || game.v[i]]++;
    [].forEach.call(document.querySelectorAll("#digits .digit"), function (b) {
      var d = +b.getAttribute("data-d"), left = Math.max(0, 9 - counts[d]);
      b.querySelector(".dc").textContent = game && !making ? String(left) : "";
      b.classList.toggle("full", !!game && !making && left === 0);
      b.setAttribute("aria-label", t("pad.digit", { d: d, n: left }));
    });
    var nb = $("pad-notes");
    var on = !!(game && game.notes);
    nb.classList.toggle("on", on);
    nb.setAttribute("aria-pressed", on ? "true" : "false");
    $("pad").classList.toggle("notes", on);
    $("pad-undo").disabled = !(game && !making && !game.done && game.hist.length);
    $("pad-redo").disabled = !(game && !making && !game.done && game.fut.length);
  }

  // Board and pad share #board-wrap: the pad goes beside the board on a
  // wide area, under it otherwise.
  function layout() {
    var wrap = $("board-wrap"), play = $("play");
    var cs = getComputedStyle(wrap);
    var W = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var H = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (W <= 0 || H <= 0) return;
    var coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    var side = W > H * 1.2 && W >= 520, size, padW = 0;
    if (side) {
      padW = Math.max(180, Math.min(280, Math.floor(W * 0.3)));
      size = Math.min(H, W - padW - 20, 620);
    } else {
      var key = Math.max(coarse ? 44 : 40, Math.min(56, Math.floor(W / 9)));
      size = Math.min(W, H - (key * 2 + 18), 620);
      play.style.setProperty("--key", key + "px");
    }
    size = Math.max(200, Math.floor(size / 9) * 9 + 8);
    play.classList.toggle("side", side);
    play.style.setProperty("--bs", size + "px");
    play.style.setProperty("--padw", padW + "px");
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
    if (!game || !game.done) return;            // replaced meanwhile
    closeDialogs();
    var s = totals(game.lv);
    var dlg = makeDialog("sudoku-result");
    dlg.appendChild(el("div", "dlg-title", t("res.title") + " · " + t("lv." + game.lv)));
    dlg.appendChild(el("div", "dlg-hero", fmtTime(game.ms)));
    if (rec) dlg.appendChild(el("div", "dlg-badge", t("res.rec")));
    if (game.hints) dlg.appendChild(el("div", "dlg-msg dlg-note", t("res.noRec")));
    dlg.appendChild(row(t("res.hints"), String(game.hints)));
    dlg.appendChild(row(t("res.best"), s.t ? fmtTime(s.t) : "–"));
    dlg.appendChild(row(t("res.solved"), String(s.n)));
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
    var dlg = makeDialog("sudoku-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    LEVELS.forEach(function (k) {
      var s = totals(k);
      if (s.n) empty = false;
      dlg.appendChild(row(t("lv." + k),
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

  function optsDialog() {
    var dlg = makeDialog("sudoku-opts");
    dlg.appendChild(el("div", "dlg-title", t("opts.title")));
    [["mist", "opts.mist", "opts.mistSub"], ["auto", "opts.auto", "opts.autoSub"]].forEach(function (o) {
      var lab = el("label", "opt");
      var box = el("input");
      box.type = "checkbox";
      box.checked = prefs[o[0]];
      box.addEventListener("change", function () {
        prefs[o[0]] = box.checked;
        savePrefs();
        renderAll();
      });
      lab.appendChild(box);
      var txt = el("span", "opt-txt");
      txt.appendChild(el("strong", "", t(o[1])));
      txt.appendChild(el("span", "", t(o[2])));
      lab.appendChild(txt);
      dlg.appendChild(lab);
    });
    var acts = el("div", "dlg-actions");
    var close = button(t("opts.close"), "primary", function () { dlg.close(); });
    acts.appendChild(close);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    close.focus();
  }

  function confirmDialog(msg, onYes) {
    var dlg = makeDialog("sudoku-confirm");
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
    data = mergeSudoku(data, data);
    save();
    renderStatus();
    showToast(t("toast.reset"));
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "sudoku", title: String(text) })) return;
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
      if (kind === "tap") tone(620, 0, 0.05, "triangle", 0.09);
      else if (kind === "note") tone(880, 0, 0.04, "sine", 0.06);
      else if (kind === "bad") tone(200, 0, 0.12, "square", 0.06);
      else if (kind === "hint") { tone(660, 0, 0.07, "triangle", 0.1); tone(990, 0.07, 0.09, "triangle", 0.08); }
      else if (kind === "win") {
        [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
      }
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Toolbar icons (R9: injected by JS) ----------
  var UI_ICONS = {
    new:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    undo:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    redo:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>',
    erase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/><path d="m18 9-6 6M12 9l6 6"/></svg>',
    notes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    hint:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/></svg>',
    stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    opts:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
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
  function wirePointer() {
    $("board").addEventListener("pointerdown", function (e) {
      var c = e.target.closest ? e.target.closest(".cell") : null;
      if (!c) return;
      select(+c.getAttribute("data-i"));
    });
  }

  var KEY_MOVE = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

  function digitOf(e) {
    var m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code || "");
    return m ? +m[1] : -1;
  }

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;   // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      if (!game) return;
      var d = digitOf(e);
      if (d >= 1) { e.preventDefault(); enter(d, e.shiftKey); return; }
      if (e.shiftKey) return;
      if (KEY_MOVE[e.code]) {
        e.preventDefault();
        if (!making) moveSel(KEY_MOVE[e.code][0], KEY_MOVE[e.code][1]);
        return;
      }
      if (d === 0 || e.code === "Backspace" || e.code === "Delete") { e.preventDefault(); erase(); return; }
      if (e.repeat) return;
      if (e.code === "KeyN") { e.preventDefault(); toggleNotes(); return; }
      if (e.code === "KeyU" || e.code === "KeyZ") { e.preventDefault(); undo(); return; }
      if (e.code === "KeyR" || e.code === "KeyY") { e.preventDefault(); redo(); return; }
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
    api.registerSlice("sudoku", sliceGet, sliceSet, STORAGE_KEY, mergeSudoku);
  }

  function sliceGet() {
    return mergeSudoku(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeSudoku(incoming, incoming);
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
    $("lv-seg").setAttribute("aria-label", t("btn.new"));
  }

  function paintStatic() {
    [["new-btn", "new", "btn.new"], ["stats-btn", "stats", "btn.stats"],
     ["opts-btn", "opts", "btn.opts"]].forEach(function (x) {
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
        if (game && lv === game.lv && !game.done && !making) return;   // visible active state
        newGame(lv);
      });
    });
    $("new-btn").addEventListener("click", function () { newGame(game && !making ? game.lv : prefs.lv); $("new-btn").blur(); });
    $("stats-btn").addEventListener("click", statsDialog);
    $("opts-btn").addEventListener("click", optsDialog);
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("tap");   // audible confirmation when turned on
    });
    wirePointer();

    if (window.ResizeObserver) new ResizeObserver(layout).observe($("board-wrap"));
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
    layout();
    var g = loadSession();
    if (g) {
      setGame(g);
      prefs.lv = g.lv;                            // the resumed puzzle decides the toolbar
      syncClock();
      renderAll();
    } else {
      newGame(prefs.lv);
    }
  }

  boot();
})();
