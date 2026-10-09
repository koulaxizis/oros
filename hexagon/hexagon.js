// ============================================================
// orOS Hexagon Puzzle — App logic (v1.0.0)
// A big hexagon of hex cells, cut into pieces of 3 to 6 cells. The
// pieces wait in the tray, shuffled and turned; fit them all back in.
//   - 3 levels by the board's radius: Easy 2 (19 cells), Medium 3
//     (37), Hard 4 (61); the app cuts the board itself, so a solution
//     always exists (any arrangement that fills the board wins)
//   - drag a piece from the tray onto the board (mouse / touch); it
//     snaps to the grid; drag a placed piece to move it, or off the
//     board to send it back; a tap or a right-click turns a piece by
//     60°, and so do the turn buttons and R (E turns the other way)
//   - keyboard: 1–9 (or Enter on a tray piece) picks a piece up,
//     arrows move it on the board, R / E turn it, Enter places, Esc
//     puts it back; Enter on a placed piece picks it up again
//   - Hint (H) puts one piece where the app cut it (a hinted puzzle
//     sets no best time); Restart sends every piece back to the tray
//   - time runs from the first move, only while the app is visible;
//     a puzzle in progress is kept on the device and resumes
// Data:
//   - synced slice "hexagon" (oros-hexagon-data): per level the
//     puzzles solved and the best time, as per-device rows (each
//     device only grows its own row; merge = per-row join) + a reset
//     stamp br
//   - device-local (R10): oros-hexagon-prefs (level),
//     oros-hexagon-session (the puzzle in progress),
//     oros-hexagon-device (row id), oros-hexagon-sfx (sound on/off)
// Sections:
//   1. Constants, i18n, helpers
//   2. Puzzle model (hex grid, turning, cutting, fitting)
//   3. Synced data: load / save / normalize / merge (R5, R26)
//   4. Device-local prefs + session
//   5. Game flow (new, pick up, turn, place, hint, restart, finish)
//   6. Render (toolbar, status, board, tray, ghost)
//   7. Dialogs (result, records, confirm)
//   8. Toasts
//   9. Sound
//  10. Input (pointer, keyboard, Contract Β)
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-hexagon-data";
  var PREFS_KEY   = "oros-hexagon-prefs";
  var SESSION_KEY = "oros-hexagon-session";
  var DEVICE_KEY  = "oros-hexagon-device";
  var SFX_KEY     = "oros-hexagon-sfx";
  var DATA_VER    = 1;

  var LEVELS = ["e", "m", "h"];
  var RADIUS = { e: 2, m: 3, h: 4 };
  var MIN_PIECE = 3, MAX_PIECE = 6;
  var SQ3 = Math.sqrt(3);
  // Axial neighbours, clockwise from east (pointy-top hexes, y down);
  // direction d is the edge between corners d and d + 1.
  var DIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  var MAX_MS = 360000000;                    // 100 h: anything above is junk

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
      "level.label": "Level",
      "btn.rot": "Turn right (R)",
      "btn.rotl": "Turn left (E)",
      "btn.hint": "Hint (H)",
      "btn.restart": "All pieces back to the tray",
      "btn.new": "New puzzle (N)",
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "st.pieces": "Pieces", "st.time": "Time",
      "turn.start": "Drag the pieces into the hexagon",
      "turn.left1": "1 piece to go",
      "turn.left": "{k} pieces to go",
      "turn.held": "Arrows move, R turns, Enter places, Esc puts back",
      "turn.done": "Solved!",
      "board.label": "Hexagon board. Arrows move, Enter picks up or places a piece",
      "tray.label": "Pieces to place",
      "tray.piece": "Piece {n}, {k} cells: tap to turn, drag to the board",
      "live.pick": "Piece {n} picked up: arrows move, R turns, Enter places",
      "live.lift": "Piece lifted: arrows move, R turns, Enter places",
      "live.place": "Piece placed: {k} to go",
      "live.back": "Piece back in the tray",
      "live.turn": "Turned",
      "live.done": "Solved in {t}",
      "live.cell": "Row {r}, cell {c}",
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
      "toast.restart": "All pieces back in the tray",
      "toast.undo": "Undo",
      "toast.intray": "Every piece is already in the tray",
      "toast.hint": "Hint used: this puzzle sets no best time",
      "toast.done": "Solved: start a new puzzle (N)",
      "toast.nofit": "It does not fit there",
      "toast.noturn": "No room to turn it here: drag it out first",
      "toast.pick": "Pick a piece first: tap it in the tray, or press 1–9",
      "toast.drag": "Drag a piece from the tray onto the board",
      "toast.nopiece": "No piece {n} in the tray",
      "toast.save": "Could not save: storage is full"
    },
    el: {
      "level.e": "Εύκολο", "level.m": "Μεσαίο", "level.h": "Δύσκολο",
      "level.label": "Επίπεδο",
      "btn.rot": "Στροφή δεξιά (R)",
      "btn.rotl": "Στροφή αριστερά (E)",
      "btn.hint": "Υπόδειξη (H)",
      "btn.restart": "Όλα τα κομμάτια πίσω στη θήκη",
      "btn.new": "Νέος γρίφος (N)",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "st.pieces": "Κομμάτια", "st.time": "Χρόνος",
      "turn.start": "Σύρε τα κομμάτια μέσα στο εξάγωνο",
      "turn.left1": "Μένει 1 κομμάτι",
      "turn.left": "Μένουν {k} κομμάτια",
      "turn.held": "Βελάκια: κίνηση, R: στροφή, Enter: τοποθέτηση, Esc: πίσω",
      "turn.done": "Λύθηκε!",
      "board.label": "Εξάγωνος πίνακας. Τα βελάκια κινούν, το Enter πιάνει ή αφήνει κομμάτι",
      "tray.label": "Κομμάτια για τοποθέτηση",
      "tray.piece": "Κομμάτι {n}, {k} κελιά: πάτα για στροφή, σύρε στον πίνακα",
      "live.pick": "Πήρες το κομμάτι {n}: βελάκια για κίνηση, R για στροφή, Enter για τοποθέτηση",
      "live.lift": "Σήκωσες το κομμάτι: βελάκια για κίνηση, R για στροφή, Enter για τοποθέτηση",
      "live.place": "Το κομμάτι μπήκε: μένουν {k}",
      "live.back": "Το κομμάτι γύρισε στη θήκη",
      "live.turn": "Γύρισε",
      "live.done": "Λύθηκε σε {t}",
      "live.cell": "Σειρά {r}, κελί {c}",
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
      "toast.restart": "Όλα τα κομμάτια γύρισαν στη θήκη",
      "toast.undo": "Αναίρεση",
      "toast.intray": "Όλα τα κομμάτια είναι ήδη στη θήκη",
      "toast.hint": "Υπόδειξη: αυτός ο γρίφος δεν μετράει για ρεκόρ χρόνου",
      "toast.done": "Λύθηκε: ξεκίνα νέο γρίφο (N)",
      "toast.nofit": "Δεν χωράει εκεί",
      "toast.noturn": "Δεν έχει χώρο να γυρίσει εδώ: τράβηξέ το πρώτα έξω",
      "toast.pick": "Διάλεξε πρώτα κομμάτι: πάτα το στη θήκη ή πάτα 1–9",
      "toast.drag": "Σύρε ένα κομμάτι από τη θήκη στον πίνακα",
      "toast.nopiece": "Δεν υπάρχει κομμάτι {n} στη θήκη",
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
    console.log("hexagon.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Puzzle model ----------
  // A cell is [q, r] in axial coordinates (pointy-top hexes; the third
  // cube coordinate is -q-r). A piece is the list of its cells where
  // the app cut it (its solution place). On the board a piece is
  // turned (rot: 0–5, steps of 60° clockwise) about its first cell
  // and that cell sits at `at`; at = null means it is in the tray.
  function key(c) { return c[0] + "," + c[1]; }

  function inBoard(R, q, r) {
    return Math.abs(q) <= R && Math.abs(r) <= R && Math.abs(q + r) <= R;
  }

  // Every cell of the board, row by row.
  function boardCells(R) {
    var out = [];
    for (var r = -R; r <= R; r++) {
      for (var q = -R; q <= R; q++) if (inBoard(R, q, r)) out.push([q, r]);
    }
    return out;
  }

  // Turn a cell about the origin by k × 60° clockwise.
  function rotate(c, k) {
    var q = c[0], r = c[1];
    k = ((k % 6) + 6) % 6;
    for (var i = 0; i < k; i++) {
      var nq = -r + 0, nr = q + r;
      q = nq; r = nr;
    }
    return [q, r];
  }

  // The piece's cells relative to its first cell.
  function shapeOf(cells) {
    var o = cells[0];
    return cells.map(function (c) { return [c[0] - o[0], c[1] - o[1]]; });
  }

  // Where a piece's cells land, turned by rot with its first cell at `at`.
  function placeCells(cells, rot, at) {
    return shapeOf(cells).map(function (c) {
      var p = rotate(c, rot);
      return [p[0] + at[0], p[1] + at[1]];
    });
  }

  // The `at` that puts the piece's cell g on hex h.
  function grabAt(cells, rot, g, h) {
    var p = rotate(shapeOf(cells)[g], rot);
    return [h[0] - p[0], h[1] - p[1]];
  }

  function connected(cells) {
    if (!cells.length) return false;
    var set = {}, seen = {}, stack = [cells[0]], n = 0;
    cells.forEach(function (c) { set[key(c)] = true; });
    seen[key(cells[0])] = true;
    while (stack.length) {
      var c = stack.pop();
      n++;
      for (var d = 0; d < 6; d++) {
        var nb = [c[0] + DIRS[d][0], c[1] + DIRS[d][1]], k = key(nb);
        if (set[k] && !seen[k]) { seen[k] = true; stack.push(nb); }
      }
    }
    return n === cells.length;
  }

  // Connected groups of the cells in `left` (a key → cell map).
  function groups(left) {
    var seen = {}, out = [];
    Object.keys(left).forEach(function (k0) {
      if (seen[k0]) return;
      var g = [], stack = [left[k0]];
      seen[k0] = true;
      while (stack.length) {
        var c = stack.pop();
        g.push(c);
        for (var d = 0; d < 6; d++) {
          var nb = [c[0] + DIRS[d][0], c[1] + DIRS[d][1]], k = key(nb);
          if (left[k] && !seen[k]) { seen[k] = true; stack.push(left[k]); }
        }
      }
      out.push(g);
    });
    return out;
  }

  // Cut the board into connected pieces of MIN_PIECE…MAX_PIECE cells.
  // A piece grows from the free cell with the fewest free neighbours
  // (a corner first), to a random size, picking random free neighbours;
  // it is kept only if every group of free cells left still has room
  // for a piece. A dead end starts over.
  function partition(R, rnd) {
    for (var attempt = 0; ; attempt++) {
      var left = {}, pieces = [], ok = true;
      boardCells(R).forEach(function (c) { left[key(c)] = c; });
      var free = function (c) { return !!left[key(c)]; };
      var degree = function (c) {
        var n = 0;
        for (var d = 0; d < 6; d++) if (free([c[0] + DIRS[d][0], c[1] + DIRS[d][1]])) n++;
        return n;
      };
      while (ok && Object.keys(left).length) {
        var keys = Object.keys(left), best = 7, seeds = [];
        keys.forEach(function (k) {
          var dg = degree(left[k]);
          if (dg < best) { best = dg; seeds = [left[k]]; } else if (dg === best) seeds.push(left[k]);
        });
        var placed = false;
        for (var tr = 0; tr < 12 && !placed; tr++) {
          var seed = seeds[rnd(seeds.length)];
          var size = keys.length <= MAX_PIECE ? keys.length : MIN_PIECE + rnd(MAX_PIECE - MIN_PIECE + 1);
          var piece = [seed], inP = {};
          inP[key(seed)] = true;
          while (piece.length < size) {
            var cand = [];
            piece.forEach(function (c) {
              for (var d = 0; d < 6; d++) {
                var nb = [c[0] + DIRS[d][0], c[1] + DIRS[d][1]];
                if (free(nb) && !inP[key(nb)]) cand.push(nb);
              }
            });
            if (!cand.length) break;
            var pick = cand[rnd(cand.length)];
            inP[key(pick)] = true;
            piece.push(pick);
          }
          if (piece.length < MIN_PIECE) continue;
          var rest = {};
          keys.forEach(function (k) { if (!inP[k]) rest[k] = left[k]; });
          if (groups(rest).some(function (g) { return g.length < MIN_PIECE; })) continue;
          pieces.push(piece);
          left = rest;
          placed = true;
        }
        if (!placed) ok = false;
      }
      if (ok) return pieces;
    }
  }

  // key → index of the piece on that cell (pieces on the board only;
  // `skip` is left out).
  function occupancy(pieces, st, skip) {
    var occ = {};
    st.forEach(function (s, j) {
      if (j === skip || !s.at) return;
      placeCells(pieces[j], s.rot, s.at).forEach(function (c) { occ[key(c)] = j; });
    });
    return occ;
  }

  // Can piece i sit at `at`, turned by rot: inside the board and on no
  // other piece?
  function canPlace(R, pieces, st, i, rot, at) {
    var occ = occupancy(pieces, st, i), cells = placeCells(pieces[i], rot, at);
    for (var k = 0; k < cells.length; k++) {
      var c = cells[k];
      if (!inBoard(R, c[0], c[1]) || occ[key(c)] !== undefined) return false;
    }
    return true;
  }

  // Every piece on the board (they never overlap, and their sizes add
  // up to the board, so the board is full).
  function isSolved(R, pieces, st) {
    if (!st.every(function (s) { return !!s.at; })) return false;
    return Object.keys(occupancy(pieces, st, -1)).length === boardCells(R).length;
  }

  // Is piece i exactly where the app cut it?
  function isHome(pieces, st, i) {
    if (!st[i].at) return false;
    var a = placeCells(pieces[i], st[i].rot, st[i].at).map(key).sort();
    return a.join(" ") === pieces[i].map(key).sort().join(" ");
  }

  // Hint: the first piece not at home goes home; pieces in its way go
  // back to the tray. Returns { i, st } or null when all are home.
  function hintMove(pieces, st) {
    for (var i = 0; i < pieces.length; i++) {
      if (isHome(pieces, st, i)) continue;
      var want = {}, out = st.map(function (s) { return { rot: s.rot, at: s.at ? s.at.slice() : null }; });
      pieces[i].forEach(function (c) { want[key(c)] = true; });
      out.forEach(function (s, j) {
        if (j === i || !s.at) return;
        var hit = placeCells(pieces[j], s.rot, s.at).some(function (c) { return want[key(c)]; });
        if (hit) s.at = null;
      });
      out[i] = { rot: 0, at: pieces[i][0].slice() };
      return { i: i, st: out };
    }
    return null;
  }

  // Centre of a hex in board units (hex radius 1).
  function toPixel(q, r) { return [SQ3 * (q + r / 2), 1.5 * r]; }

  // The hex under a point in board units.
  function fromPixel(x, y) {
    var fq = SQ3 / 3 * x - y / 3, fr = 2 / 3 * y, fs = -fq - fr;
    var q = Math.round(fq), r = Math.round(fr), s = Math.round(fs);
    var dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs);
    if (dq > dr && dq > ds) q = -r - s;
    else if (dr > ds) r = -q - s;
    return [q + 0, r + 0];
  }

  // Keyboard cursor: left / right along the row, up / down to the hex
  // of the next row closest to the column `x` it keeps. Returns
  // { c, x } (unchanged at the edge).
  function stepCursor(R, c, x, dir) {
    if (dir === "L" || dir === "R") {
      var n = [c[0] + (dir === "R" ? 1 : -1), c[1]];
      if (!inBoard(R, n[0], n[1])) return { c: c, x: x };
      return { c: n, x: toPixel(n[0], n[1])[0] };
    }
    var r = c[1] + (dir === "D" ? 1 : -1), best = null, bd = Infinity;
    for (var q = -R; q <= R; q++) {
      if (!inBoard(R, q, r)) continue;
      var d = Math.abs(toPixel(q, r)[0] - x);
      if (d < bd - 1e-9) { bd = d; best = [q, r]; }
    }
    return best ? { c: best, x: x } : { c: c, x: x };
  }

  // A puzzle from storage: radius of its level, pieces of the allowed
  // sizes, connected, covering the board once.
  function validPieces(R, pieces) {
    if (!Array.isArray(pieces) || !pieces.length) return false;
    var seen = {}, n = 0;
    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i];
      if (!Array.isArray(p) || p.length < MIN_PIECE || p.length > MAX_PIECE) return false;
      for (var k = 0; k < p.length; k++) {
        var c = p[k];
        if (!Array.isArray(c) || c.length !== 2 || !isInt(c[0]) || !isInt(c[1]) ||
            !inBoard(R, c[0], c[1]) || seen[key(c)]) return false;
        seen[key(c)] = true;
        n++;
      }
      if (!connected(p)) return false;
    }
    return n === boardCells(R).length;
  }

  // Piece states from storage: a turn 0–5 and a place on the board
  // (or null), no piece outside or on another.
  function validState(R, pieces, st) {
    if (!Array.isArray(st) || st.length !== pieces.length) return false;
    var occ = {};
    for (var j = 0; j < st.length; j++) {
      var s = st[j];
      if (!s || typeof s !== "object" || !isInt(s.rot) || s.rot < 0 || s.rot > 5) return false;
      if (s.at === null) continue;
      if (!Array.isArray(s.at) || s.at.length !== 2 || !isInt(s.at[0]) || !isInt(s.at[1])) return false;
      var cells = placeCells(pieces[j], s.rot, s.at);
      for (var k = 0; k < cells.length; k++) {
        var c = cells[k];
        if (!inBoard(R, c[0], c[1]) || occ[key(c)]) return false;
        occ[key(c)] = true;
      }
    }
    return true;
  }

  // ---------- 3. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                         // max-merged
  //   rows: { <deviceId>: { b: <epoch>,
  //                         s: { e|m|h: { g: solved, t: best ms (0 none) } } } }
  // }
  // Each device only ever writes ITS OWN row; a row counts from epoch b.
  // Merge per row: the newer epoch wins; equal epochs take, per level,
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

  function mergeHexagon(A, B) {
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
  function totals(k) {
    var out = { g: 0, t: 0 };
    Object.keys(data.rows).forEach(function (id) {
      var c = data.rows[id].s[k];
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
          data = mergeHexagon(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] hexagon: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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
  function countSolve(lv, ms, timed) {
    var before = totals(lv);
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // new epoch after a reset
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    var c = row.s[lv] || { g: 0, t: 0 };
    ms = Math.max(1, Math.min(MAX_MS, ms));
    row.s[lv] = { g: c.g + 1, t: timed ? minTime(c.t, ms) : c.t };
    data.rows[deviceId] = row;
    data = mergeHexagon(data, data);
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

  // game = { level, pieces: [[cells]], st: [{ rot, at }], order: [tray
  //          order of piece indices], moves, ms, hint, done }
  var game = null;

  function validSession(g) {
    if (!g || typeof g !== "object" || LEVELS.indexOf(g.level) < 0) return false;
    var R = RADIUS[g.level];
    if (!validPieces(R, g.pieces) || !validState(R, g.pieces, g.st) ||
        !Array.isArray(g.order) || g.order.length !== g.pieces.length ||
        !isInt(g.moves) || g.moves < 0 || !isInt(g.ms) || g.ms < 0 || g.ms > MAX_MS) return false;
    var seen = {};
    for (var i = 0; i < g.order.length; i++) {
      var j = g.order[i];
      if (!isInt(j) || j < 0 || j >= g.pieces.length || seen[j]) return false;
      seen[j] = true;
    }
    return true;
  }
  function loadSession() {
    try {
      var g = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(g)) {
        g.hint = g.hint === true;
        g.done = isSolved(RADIUS[g.level], g.pieces, g.st);
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
  // The piece in hand: { j, rot, g (cell held), from: { rot, at }, ptr }
  var held = null;
  var selIdx = -1;          // the piece the turn buttons act on
  var cursor = [0, 0];      // keyboard cursor hex
  var cursorX = 0;          // the column it keeps on up / down
  var kbd = false;          // keyboard in use (shows the cursor)
  var target = null;        // the hex under the dragged piece (null: off the board)

  function R() { return RADIUS[game.level]; }
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

  function fresh(level) {
    var pieces = partition(RADIUS[level], randInt), order = [], i;
    for (i = 0; i < pieces.length; i++) order.push(i);
    for (i = order.length - 1; i > 0; i--) {
      var j = randInt(i + 1), x = order[i]; order[i] = order[j]; order[j] = x;
    }
    return { level: level, pieces: pieces,
             st: pieces.map(function () { return { rot: randInt(6), at: null }; }),
             order: order, moves: 0, ms: 0, hint: false, done: false };
  }
  function inProgress() { return !!(game && !game.done && game.moves > 0); }
  function copy(g) { return JSON.parse(JSON.stringify(g)); }

  function setGame(g) {
    runFrom = 0;
    game = g;
    held = null;
    target = null;
    selIdx = -1;
    cursor = [0, 0];
    cursorX = 0;
    hideGhost();
    saveSession();
    syncClock();
    renderAll(true);
  }

  // Put back an earlier game (Undo toast of New puzzle / Restart).
  function restore(prev) {
    prefs.level = prev.level; savePrefs();
    setGame(prev);
  }

  // A puzzle in progress is never lost silently: Undo toast (R14).
  function newGame(announce) {
    if (game) { dropHeld(); syncClock(); }
    var prev = inProgress() ? copy(game) : null;
    setGame(fresh(prefs.level));
    if (prev) undoToast(t("toast.newgame"), function () { restore(prev); });
    else if (announce) live(t("toast.newgame"));
  }

  function gate() {
    if (!game) return false;
    if (game.done) { showToast(t("toast.done")); return false; }
    return true;
  }

  // A move: count it, start the clock with the first one.
  function moved() {
    var first = game.moves === 0;
    game.moves++;
    if (first) syncClock();
  }

  function trayLeft() {
    return game.order.filter(function (j) { return !game.st[j].at; });
  }

  // Pick piece j up (from the tray or the board), holding its cell g.
  function pickUp(j, g, ptr) {
    var s = game.st[j];
    held = { j: j, rot: s.rot, g: g, from: { rot: s.rot, at: s.at ? s.at.slice() : null }, ptr: !!ptr };
    s.at = null;
    selIdx = j;
    sfx("pick");
  }

  // Put the held piece back where it came from (Esc, a refused drop).
  function dropHeld() {
    if (!held) return;
    game.st[held.j] = { rot: held.from.rot, at: held.from.at };
    held = null;
    target = null;
    hideGhost();
  }

  // Place the held piece with its held cell on hex h. Refused, with a
  // toast (R28): a dragged piece goes back where it came from, a piece
  // held by keyboard stays in hand.
  function placeHeld(h) {
    if (!held) return false;
    var at = grabAt(game.pieces[held.j], held.rot, held.g, h);
    if (!canPlace(R(), game.pieces, game.st, held.j, held.rot, at)) {
      if (held.ptr) dropHeld();
      showToast(t("toast.nofit"));
      shake();
      renderAll(false);
      return false;
    }
    var j = held.j, same = held.from.at && held.from.at[0] === at[0] && held.from.at[1] === at[1] &&
      held.from.rot === held.rot;
    game.st[j] = { rot: held.rot, at: at };
    held = null;
    target = null;
    hideGhost();
    if (!same) moved();
    sfx("place");
    afterMove(t("live.place", { k: trayLeft().length }));
    return true;
  }

  // Send the held piece to the tray (dropped off the board).
  function toTray() {
    if (!held) return;
    var j = held.j, was = !!held.from.at || held.from.rot !== held.rot;
    game.st[j] = { rot: held.rot, at: null };
    held = null;
    target = null;
    hideGhost();
    if (was) moved();
    afterMove(t("live.back"));
  }

  function afterMove(msg) {
    if (isSolved(R(), game.pieces, game.st)) { finish(); return; }
    saveSession();
    renderAll(false);
    if (msg) live(msg);
  }

  // Turn: the held piece, else piece j (in the tray: freely; on the
  // board: about cell g, if it still fits).
  function turn(j, g, dir) {
    if (!gate()) return;
    if (held) {
      held.rot = (held.rot + dir + 6) % 6;
      sfx("turn");
      if (held.ptr) drawGhost();
      renderAll(false);
      return;
    }
    if (j < 0) { showToast(t("toast.pick")); return; }
    var s = game.st[j], rot = (s.rot + dir + 6) % 6;
    selIdx = j;
    if (s.at) {
      var hex = placeCells(game.pieces[j], s.rot, s.at)[g || 0];
      var at = grabAt(game.pieces[j], rot, g || 0, hex);
      if (!canPlace(R(), game.pieces, game.st, j, rot, at)) {
        showToast(t("toast.noturn"));
        shake();
        renderAll(false);
        return;
      }
      game.st[j] = { rot: rot, at: at };
    } else {
      game.st[j] = { rot: rot, at: null };
    }
    moved();
    sfx("turn");
    afterMove(t("live.turn"));
  }

  // Every piece back to the tray (turns kept). The time keeps running.
  function restart() {
    if (!game) return;
    dropHeld();
    var any = game.st.some(function (s) { return !!s.at; });
    if (!any) { showToast(t("toast.intray")); renderAll(false); return; }   // R28
    syncClock();
    var prev = copy(game), wasDone = game.done;
    game.st.forEach(function (s) { s.at = null; });
    game.done = false;
    if (wasDone) { game.ms = 0; game.moves = 0; game.hint = false; }
    saveSession();
    syncClock();
    renderAll(false);
    undoToast(t("toast.restart"), function () { restore(prev); });
  }

  function hint() {
    if (!gate()) return;
    dropHeld();
    var h = hintMove(game.pieces, game.st);
    if (!h) return;
    if (!game.hint) {
      game.hint = true;
      showToast(t("toast.hint"));
    }
    game.st = h.st;
    selIdx = h.i;
    moved();
    sfx("place");
    afterMove(t("live.place", { k: trayLeft().length }));
  }

  function finish() {
    held = null;
    hideGhost();
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
  var view = null;          // the board's viewBox { x, y, w, h }
  var layers = {};

  function hue(j) { return Math.round((j * 137.508 + 20) % 360); }

  function renderAll(rebuild) {
    renderToolbar();
    renderStatus();
    if (rebuild) buildBoard();
    renderBoard();
    renderTray();
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

  function renderClock() { $("time").textContent = fmtTime(elapsed()); }

  function renderStatus() {
    renderClock();
    if (!game) return;
    var n = game.pieces.length, k = n - trayLeft().length - (held ? 1 : 0);
    $("pieces").textContent = k + "/" + n;
    var left = n - k;
    $("turn").textContent = game.done ? t("turn.done") :
      (held && !held.ptr ? t("turn.held") :
      (!game.moves ? t("turn.start") : (left === 1 ? t("turn.left1") : t("turn.left", { k: left }))));
    $("turn").className = game.done ? "done" : "";
  }

  function svg(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }

  // Corner i of the hex at (x, y), radius s: angle 60i − 30°.
  function corner(x, y, s, i) {
    var a = Math.PI / 180 * (60 * i - 30);
    return [x + s * Math.cos(a), y + s * Math.sin(a)];
  }
  function hexPoints(x, y, s) {
    var out = [];
    for (var i = 0; i < 6; i++) {
      var p = corner(x, y, s, i);
      out.push(p[0].toFixed(3) + "," + p[1].toFixed(3));
    }
    return out.join(" ");
  }

  // A piece as SVG: one hex per cell, then its outline (the edges that
  // face no cell of the same piece). cells: [q, r]; off: pixel shift.
  function drawPiece(parent, cells, j, cls, off) {
    var g = svg("g", { "class": cls, style: "--h:" + hue(j) }, parent), set = {}, d = "";
    off = off || [0, 0];
    cells.forEach(function (c) { set[key(c)] = true; });
    cells.forEach(function (c) {
      var p = toPixel(c[0], c[1]);
      svg("polygon", { points: hexPoints(p[0] + off[0], p[1] + off[1], 1.0) }, g);
    });
    cells.forEach(function (c) {
      var p = toPixel(c[0], c[1]);
      for (var dd = 0; dd < 6; dd++) {
        if (set[key([c[0] + DIRS[dd][0], c[1] + DIRS[dd][1]])]) continue;
        var a = corner(p[0] + off[0], p[1] + off[1], 0.97, dd), b = corner(p[0] + off[0], p[1] + off[1], 0.97, dd + 1);
        d += "M" + a[0].toFixed(3) + " " + a[1].toFixed(3) + "L" + b[0].toFixed(3) + " " + b[1].toFixed(3);
      }
    });
    svg("path", { "class": "edge", d: d }, g);
    return g;
  }

  function buildBoard() {
    var b = $("board");
    while (b.firstChild) b.removeChild(b.firstChild);
    if (!game) return;
    var Rr = R(), wx = SQ3 * (Rr + 0.5) + 0.15, wy = 1.5 * Rr + 1 + 0.15;
    view = { x: -wx, y: -wy, w: 2 * wx, h: 2 * wy };
    b.setAttribute("viewBox", view.x + " " + view.y + " " + view.w + " " + view.h);
    b.setAttribute("aria-label", t("board.label"));
    b.style.setProperty("--ratio", String(view.w / view.h));
    layers.slots = svg("g", { "class": "slots" }, b);
    boardCells(Rr).forEach(function (c) {
      var p = toPixel(c[0], c[1]);
      svg("polygon", { "class": "slot", points: hexPoints(p[0], p[1], 0.93) }, layers.slots);
    });
    layers.pieces = svg("g", {}, b);
    layers.preview = svg("g", { "class": "preview" }, b);
    layers.cursor = svg("polygon", { "class": "cursor" }, b);
  }

  function renderBoard() {
    var b = $("board");
    if (!game || !layers.pieces) return;
    b.classList.toggle("over", !!game.done);
    b.classList.toggle("kbd", kbd);
    while (layers.pieces.firstChild) layers.pieces.removeChild(layers.pieces.firstChild);
    game.st.forEach(function (s, j) {
      if (!s.at) return;
      drawPiece(layers.pieces, placeCells(game.pieces[j], s.rot, s.at), j,
        "pc" + (j === selIdx && !game.done ? " sel" : ""));
    });
    // Where the held piece would land (keyboard: at the cursor).
    while (layers.preview.firstChild) layers.preview.removeChild(layers.preview.firstChild);
    var h = held ? (held.ptr ? target : cursor) : null;
    if (h) {
      var at = grabAt(game.pieces[held.j], held.rot, held.g, h);
      var fits = canPlace(R(), game.pieces, game.st, held.j, held.rot, at);
      var cells = placeCells(game.pieces[held.j], held.rot, at);
      if (held.ptr) {
        cells.forEach(function (c) {
          var p = toPixel(c[0], c[1]);
          svg("polygon", { "class": "pv " + (fits ? "ok" : "bad"), points: hexPoints(p[0], p[1], 0.9) }, layers.preview);
        });
      } else {
        var g = drawPiece(layers.preview, cells, held.j, "pc lift " + (fits ? "ok" : "bad"));
        g.setAttribute("opacity", fits ? "0.85" : "0.6");
      }
    }
    var cp = toPixel(cursor[0], cursor[1]);
    layers.cursor.setAttribute("points", hexPoints(cp[0], cp[1], 0.86));
  }

  function renderTray() {
    var tray = $("tray");
    tray.setAttribute("aria-label", t("tray.label"));
    var left = game ? trayLeft() : [];
    // Keep the buttons that stay (focus survives), rebuild the rest.
    var have = {};
    [].forEach.call(tray.querySelectorAll(".tp"), function (b) { have[b.getAttribute("data-j")] = b; });
    var focusJ = document.activeElement && document.activeElement.classList &&
      document.activeElement.classList.contains("tp") ? document.activeElement.getAttribute("data-j") : null;
    tray.innerHTML = "";
    var heldJ = held && held.ptr && !held.from.at ? held.j : -1;
    var list = left.slice();
    if (heldJ >= 0 && list.indexOf(heldJ) < 0) {
      list = game.order.filter(function (j) { return j === heldJ || !game.st[j].at; });
    }
    list.forEach(function (j, n) {
      var b = el("button", "tp" + (j === selIdx ? " sel" : "") + (j === heldJ ? " lifted" : ""));
      b.type = "button";
      b.setAttribute("data-j", String(j));
      b.setAttribute("aria-label", t("tray.piece", { n: n + 1, k: game.pieces[j].length }));
      b.setAttribute("aria-pressed", j === selIdx ? "true" : "false");
      var rot = j === heldJ ? held.rot : game.st[j].rot;
      var cells = shapeOf(game.pieces[j]).map(function (c) { return rotate(c, rot); });
      var s = svg("svg", {}, b), xs = [], ys = [];
      cells.forEach(function (c) { var p = toPixel(c[0], c[1]); xs.push(p[0]); ys.push(p[1]); });
      var x0 = Math.min.apply(null, xs) - SQ3 / 2 - 0.1, x1 = Math.max.apply(null, xs) + SQ3 / 2 + 0.1;
      var y0 = Math.min.apply(null, ys) - 1.1, y1 = Math.max.apply(null, ys) + 1.1;
      var side = Math.max(x1 - x0, y1 - y0, 5.2);
      var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      s.setAttribute("viewBox", (cx - side / 2) + " " + (cy - side / 2) + " " + side + " " + side);
      drawPiece(s, cells, j, "pc");
      if (n < 9) b.appendChild(el("span", "tp-n", String(n + 1)));
      tray.appendChild(b);
      if (focusJ === String(j)) b.focus();
    });
    tray.classList.toggle("empty", !list.length);
  }

  // The dragged piece follows the pointer at the board's scale, the
  // held cell under the pointer.
  var lastPtr = null;
  function drawGhost(e) {
    if (e) lastPtr = { x: e.clientX, y: e.clientY };
    var gh = $("ghost");
    if (!held || !held.ptr || !lastPtr || !view) return;
    var rect = $("board").getBoundingClientRect(), scale = rect.width / view.w;
    var sh = shapeOf(game.pieces[held.j]).map(function (c) { return rotate(c, held.rot); });
    var o = sh[held.g], cells = sh.map(function (c) { return [c[0] - o[0], c[1] - o[1]]; });
    var xs = [], ys = [];
    cells.forEach(function (c) { var p = toPixel(c[0], c[1]); xs.push(p[0]); ys.push(p[1]); });
    var x0 = Math.min.apply(null, xs) - 1, x1 = Math.max.apply(null, xs) + 1;
    var y0 = Math.min.apply(null, ys) - 1.1, y1 = Math.max.apply(null, ys) + 1.1;
    while (gh.firstChild) gh.removeChild(gh.firstChild);
    gh.setAttribute("viewBox", x0 + " " + y0 + " " + (x1 - x0) + " " + (y1 - y0));
    gh.style.width = ((x1 - x0) * scale) + "px";
    gh.style.height = ((y1 - y0) * scale) + "px";
    gh.style.left = (lastPtr.x + x0 * scale) + "px";
    gh.style.top = (lastPtr.y + y0 * scale) + "px";
    drawPiece(gh, cells, held.j, "pc");
    gh.style.display = "block";
  }
  function hideGhost() {
    var gh = $("ghost");
    if (gh) gh.style.display = "none";
    lastPtr = null;
  }

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

  function resultDialog(recT) {
    if (!game || !game.done) return;           // replaced meanwhile
    var s = totals(game.level);
    var dlg = makeDialog("hexagon-result");
    dlg.appendChild(el("div", "dlg-title", t("res.title") + " · " + t("level." + game.level)));
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
    var dlg = makeDialog("hexagon-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    LEVELS.forEach(function (k) {
      var s = totals(k);
      if (s.g) empty = false;
      dlg.appendChild(row(t("level." + k), s.g ? (s.t ? fmtTime(s.t) : "–") + " · " + s.g : "–"));
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
    var dlg = makeDialog("hexagon-confirm");
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
    data = mergeHexagon(data, data);
    save();
    showToast(t("toast.reset"));
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "hexagon", title: String(text) })) return;
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
      if (kind === "pick") tone(520, 0, 0.05, "triangle", 0.08);
      else if (kind === "turn") tone(740, 0, 0.04, "triangle", 0.08);
      else if (kind === "place") tone(392, 0, 0.09, "triangle", 0.14);
      else if (kind === "win") {
        [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
      }
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Toolbar icons (R9: injected by JS) ----------
  var UI_ICONS = {
    rot:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
    rotl:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    hint:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/></svg>',
    restart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 17v3h16v-3"/></svg>',
    new:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5 20.5 7.25v9.5L12 21.5 3.5 16.75v-9.5z"/><path d="M12 8v8M8 12h8"/></svg>',
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
  // The hex under a pointer (board units), or null off the board's box.
  function hexAt(x, y) {
    if (!view) return null;
    var rect = $("board").getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
    return fromPixel(view.x + (x - rect.left) * view.w / rect.width,
                     view.y + (y - rect.top) * view.h / rect.height);
  }

  // The cell of tray piece j nearest to a pointer on its button.
  function trayCellAt(btn, j, x, y) {
    var s = btn.querySelector("svg"), rect = s.getBoundingClientRect(), vb = s.viewBox.baseVal;
    var side = Math.min(rect.width, rect.height), ox = rect.left + (rect.width - side) / 2, oy = rect.top + (rect.height - side) / 2;
    var ux = vb.x + (x - ox) * vb.width / side, uy = vb.y + (y - oy) * vb.height / side;
    var cells = shapeOf(game.pieces[j]).map(function (c) { return rotate(c, game.st[j].rot); });
    var best = 0, bd = Infinity;
    cells.forEach(function (c, i) {
      var p = toPixel(c[0], c[1]), d = (p[0] - ux) * (p[0] - ux) + (p[1] - uy) * (p[1] - uy);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  // The piece and its cell on a board hex: { j, g } or null.
  function pieceOn(h) {
    if (!h) return null;
    var occ = occupancy(game.pieces, game.st, -1), j = occ[key(h)];
    if (j === undefined) return null;
    var cells = placeCells(game.pieces[j], game.st[j].rot, game.st[j].at);
    for (var g = 0; g < cells.length; g++) if (key(cells[g]) === key(h)) return { j: j, g: g };
    return null;
  }

  var pend = null;          // a press that may become a drag or a tap

  function wirePointer() {
    var board = $("board"), tray = $("tray");
    board.addEventListener("pointerdown", function (e) {
      if (e.button > 0 || !game) return;
      e.preventDefault();
      kbd = false;
      try { board.focus({ preventScroll: true }); } catch (err) {}
      if (held && !held.ptr) { dropHeld(); }
      var h = hexAt(e.clientX, e.clientY);
      if (h && inBoard(R(), h[0], h[1])) { cursor = h; cursorX = toPixel(h[0], h[1])[0]; }
      var pc = pieceOn(h);
      if (!pc) {
        renderAll(false);
        if (gate() && trayLeft().length) showToast(t("toast.drag"));
        return;
      }
      pend = { j: pc.j, g: pc.g, x: e.clientX, y: e.clientY, id: e.pointerId, src: board };
      try { board.setPointerCapture(e.pointerId); } catch (err) {}
    });
    tray.addEventListener("pointerdown", function (e) {
      var b = e.target.closest && e.target.closest(".tp");
      if (!b || e.button > 0 || !game) return;
      e.preventDefault();
      kbd = false;
      if (held && !held.ptr) dropHeld();
      var j = +b.getAttribute("data-j");
      pend = { j: j, g: trayCellAt(b, j, e.clientX, e.clientY), x: e.clientX, y: e.clientY, id: e.pointerId, src: b };
      // Capture on the tray, not the button: the tray is redrawn when the
      // piece lifts, and a touch captured by a removed button is lost.
      try { tray.setPointerCapture(e.pointerId); } catch (err) {}
    });
    document.addEventListener("pointermove", function (e) {
      if (!pend || e.pointerId !== pend.id) return;
      if (!held) {
        if (Math.abs(e.clientX - pend.x) + Math.abs(e.clientY - pend.y) < 8) return;
        if (!gate()) { pend = null; return; }
        pickUp(pend.j, pend.g, true);
        renderAll(false);
      }
      var h = hexAt(e.clientX, e.clientY);
      target = h;
      drawGhost(e);
      renderBoard();
    });
    var up = function (e) {
      if (!pend || e.pointerId !== pend.id) return;
      var p = pend;
      pend = null;
      if (held && held.ptr) {
        var h = hexAt(e.clientX, e.clientY);
        if (h) placeHeld(h); else toTray();
        return;
      }
      turn(p.j, p.g, 1);                          // a tap turns the piece
    };
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", function (e) {
      if (!pend || e.pointerId !== pend.id) return;
      pend = null;
      if (held && held.ptr) { dropHeld(); renderAll(false); }
    });
    // Right-click turns the piece under the pointer.
    var ctx = function (e) {
      e.preventDefault();
      if (!game) return;
      var b = e.target.closest && e.target.closest(".tp");
      if (b) { turn(+b.getAttribute("data-j"), 0, 1); return; }
      var pc = pieceOn(hexAt(e.clientX, e.clientY));
      if (pc) turn(pc.j, pc.g, 1);
    };
    board.addEventListener("contextmenu", ctx);
    tray.addEventListener("contextmenu", ctx);
    // Keyboard on a tray piece: Enter / Space picks it up.
    tray.addEventListener("keydown", function (e) {
      var b = e.target.closest && e.target.closest(".tp");
      if (!b || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      e.stopPropagation();
      kbdPick(+b.getAttribute("data-j"));
    });
  }

  // Keyboard pick-up of a tray piece: it appears at the cursor.
  function kbdPick(j) {
    if (!gate()) return;
    dropHeld();
    kbd = true;
    pickUp(j, 0, false);
    $("board").focus();
    renderAll(false);
    live(t("live.pick", { n: trayIndex(j) + 1 }));
  }
  function trayIndex(j) {
    var list = game.order.filter(function (k) { return k === j || !game.st[k].at; });
    return list.indexOf(j);
  }

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;   // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT" || !game) return;
      if (e.code === "KeyN") { e.preventDefault(); newGame(true); return; }
      if (e.code === "KeyH") { e.preventDefault(); hint(); return; }
      if (e.code === "KeyR" || e.code === "KeyE") {
        e.preventDefault();
        var dir = e.code === "KeyR" ? 1 : -1;
        if (held) { turn(-1, 0, dir); return; }
        var act = document.activeElement, pc = act === $("board") && kbd ? pieceOn(cursor) : null;
        if (pc) turn(pc.j, pc.g, dir);
        else if (act && act.classList && act.classList.contains("tp")) turn(+act.getAttribute("data-j"), 0, dir);
        else turn(selIdx, 0, dir);
        return;
      }
      var m = /^Digit([1-9])$/.exec(e.code || "");
      if (m) {
        e.preventDefault();
        var list = trayLeft(), n = +m[1];
        if (!gate()) return;
        if (n > list.length) { showToast(t("toast.nopiece", { n: n })); return; }
        kbdPick(list[n - 1]);
        return;
      }
      var onBoard = document.activeElement === $("board");
      var arrow = { ArrowLeft: "L", ArrowRight: "R", ArrowUp: "U", ArrowDown: "D" }[e.key];
      if (arrow) {
        if (!onBoard && !held) {
          var a = document.activeElement;
          if (a && a.classList && a.classList.contains("tp")) return;   // the tray keeps its arrows
          $("board").focus();
        }
        e.preventDefault();
        kbd = true;
        var s = stepCursor(R(), cursor, cursorX, arrow);
        cursor = s.c; cursorX = s.x;
        renderBoard();
        renderStatus();
        if (!held) live(cursorLabel());
        return;
      }
      if (!onBoard) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        kbd = true;
        if (held) { placeHeld(cursor); return; }
        if (!gate()) return;
        var p = pieceOn(cursor);
        if (!p) { showToast(t("toast.pick")); return; }
        pickUp(p.j, p.g, false);
        renderAll(false);
        live(t("live.lift"));
        return;
      }
      if (e.key === "Escape" && held) {
        e.preventDefault();
        dropHeld();
        renderAll(false);
        live(t("live.back"));
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

  function cursorLabel() {
    var Rr = R(), r = cursor[1] + Rr + 1, first = -Rr;
    while (!inBoard(Rr, first, cursor[1])) first++;
    return t("live.cell", { r: r, c: cursor[0] - first + 1 });
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
    api.registerSlice("hexagon", sliceGet, sliceSet, STORAGE_KEY, mergeHexagon);
  }

  function sliceGet() {
    return mergeHexagon(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeHexagon(incoming, incoming);
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
    [["rot-btn", "rot", "btn.rot"], ["rotl-btn", "rotl", "btn.rotl"], ["hint-btn", "hint", "btn.hint"],
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
    $("rot-btn").addEventListener("click", function () { turn(selIdx, 0, 1); });
    $("rotl-btn").addEventListener("click", function () { turn(selIdx, 0, -1); });
    $("hint-btn").addEventListener("click", hint);
    $("restart-btn").addEventListener("click", restart);
    $("new-btn").addEventListener("click", function () { newGame(true); $("new-btn").blur(); });
    $("stats-btn").addEventListener("click", statsDialog);
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("pick");   // audible confirmation when turned on
    });
    wirePointer();

    var relayout = function () { if (held && held.ptr) drawGhost(); };
    window.addEventListener("resize", relayout);

    // The clock runs only while the app is visible; the time is saved.
    document.addEventListener("visibilitychange", function () {
      if (!game) return;
      syncClock();
      saveSession();
    });
    window.addEventListener("pagehide", function () {
      if (!game) return;
      if (held) { dropHeld(); }
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
      setGame(fresh(prefs.level));
    }
  }

  boot();
})();
