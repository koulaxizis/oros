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
//   - imported puzzles (import.js, window.OrosSudokuImport): data.lib in
//     the same slice, one entry per puzzle with its own best time; a
//     tombstone stamp hides one (Undo of an import). An imported puzzle
//     plays like any other but never touches the level records.
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

  var LEVELS = ["e", "m", "h", "x", "k"];      // k = Killer (cages with sums)
  var CLASSIC = ["e", "m", "h", "x"];          // the graded levels (the maker of generate())
  var DAILY_LV = "m";                          // the daily puzzle: a Medium one
  var DAILY_TRIES = 40;                        // maker attempts for it (no clock)
  var MAX_DAY = 100000;
  var KILLER_GIVENS = 6;                       // a cut needing more givens is cut again
  var KNODES = 20000;                          // Killer: solver steps before a cut gets a given
  var KSIZES = [2, 2, 2, 3, 3, 3, 3, 4, 4, 5];  // Killer: the size a new cage aims for
  var KSUB = null, KMEMO = null;               // Killer: sum tables (killerTables)
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

  var DK = (typeof window !== "undefined" && window.orosDaily) || null;           // gamekit/daily.js (Daily puzzle)

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  // orosI18n (../i18n.js): the full language code, a pack language included.
  var LANG = (typeof window !== "undefined" && window.orosI18n) ? window.orosI18n.lang() : appLang();

  var STRINGS = {
    en: {
      "lv.e": "Easy", "lv.m": "Medium", "lv.h": "Hard", "lv.x": "Expert", "lv.k": "Killer",
      "lv.d": "Daily",
      "app.name": "Sudoku",
      "btn.daily": "Daily puzzle",
      "btn.games": "All games",
      "turn.daily": "Daily #{n}: {k} cells to go",
      "turn.killer": "Killer: {n} cells to go",
      "cell.cage": "cage of {n} cells, sum {s}",
      "board.killer": "Killer sudoku grid: each dashed cage holds different digits that add up to its sum. Arrows move, 1 to 9 fill, Backspace erases",
      "res.titleD": "Daily #{n}",
      "res.streak": "Streak",
      "res.bestStreak": "Best streak",
      "res.share": "Share",
      "res.next": "A new daily puzzle tomorrow",
      "res.dailyDone": "Today's puzzle is solved",
      "res.free": "Play a free puzzle",
      "stats.daily": "Daily",
      "stats.dailyRow": "Solved · streak · best",
      "share.clean": "no hints",
      "share.hints": "{n} hints",
      "toast.copied": "Result copied: paste it anywhere",
      "toast.shared": "Result shared",
      "toast.copyFail": "Could not copy the result",
      "toast.dailyGone": "Daily puzzles need the gamekit file: reload orOS",
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
      "toast.save": "Could not save: storage is full",
      "btn.imp": "Import puzzles",
      "lv.i": "Imported",
      "turn.imp": "Imported: {n} cells to go",
      "lib.title": "Imported puzzles",
      "lib.paste": "Paste one or more puzzles: 81 digits each (0 or . for a blank), or a 9×9 grid",
      "lib.check": "Check",
      "lib.file": "Open a file…",
      "lib.formats": "Plain text, .sdk (SadMan) and .ss (Simple Sudoku) files: up to 500 puzzles at a time.",
      "lib.empty": "No imported puzzles yet.",
      "lib.list": "Your imported puzzles ({n})",
      "lib.row": "{g} givens",
      "lib.best": "best {t}",
      "lib.solved": "solved",
      "lib.play": "Play",
      "lib.playLabel": "Play puzzle {k}",
      "lib.next": "Next unsolved",
      "lib.close": "Close",
      "imp.title": "Import · {s}",
      "imp.pasted": "Pasted text",
      "imp.found": "Puzzles found",
      "imp.new": "To import",
      "imp.multi": "Of these, not unique",
      "imp.have": "Already imported",
      "imp.dup": "Repeated in this text",
      "imp.bad": "Skipped: not valid",
      "imp.more": "Only the first {n} puzzles are read.",
      "imp.st.multi": "Puzzle {k} (line {l}): has {n} solutions: imported, any valid filling counts",
      "imp.st.multiPlus": "Puzzle {k} (line {l}): has at least {n} solutions: imported, any valid filling counts",
      "imp.st.conflict": "Puzzle {k} (line {l}): the same digit twice in a row, column or box",
      "imp.st.none": "Puzzle {k} (line {l}): has no solution",
      "imp.st.slow": "Puzzle {k} (line {l}): too hard to check, skipped",
      "imp.st.moreIssues": "…and {n} more",
      "imp.note": "Imported puzzles keep their own best time and do not change the level records.",
      "imp.go": "Import {n}",
      "imp.cancel": "Cancel",
      "imp.done": "Imported {n} puzzles",
      "imp.done1": "Imported 1 puzzle",
      "imp.undone": "Import undone",
      "imp.nothing": "No puzzle found: paste 81 digits or a 9×9 grid",
      "imp.noneNew": "Nothing new to import",
      "imp.err.read": "Could not read this file",
      "imp.err.big": "This file is too large to import",
      "imp.full": "The list is full: {n} imported puzzles at most",
      "res.nextImp": "Next imported",
      "lib.broken": "This puzzle cannot be solved"
    },
    el: {
      "lv.e": "Εύκολο", "lv.m": "Μέτριο", "lv.h": "Δύσκολο", "lv.x": "Πολύ δύσκολο", "lv.k": "Κίλερ",
      "lv.d": "Ημέρας",
      "app.name": "Σουντόκου",
      "btn.daily": "Σουντόκου της ημέρας",
      "btn.games": "Όλα τα παιχνίδια",
      "turn.daily": "Ημέρας #{n}: μένουν {k} κελιά",
      "turn.killer": "Κίλερ: μένουν {n} κελιά",
      "cell.cage": "ομάδα {n} κελιών, άθροισμα {s}",
      "board.killer": "Πλέγμα σουντόκου κίλερ: κάθε διακεκομμένη ομάδα έχει διαφορετικά ψηφία με το άθροισμα που γράφει. Βελάκια για κίνηση, 1 έως 9 για ψηφία, Backspace για σβήσιμο",
      "res.titleD": "Ημέρας #{n}",
      "res.streak": "Σερί",
      "res.bestStreak": "Καλύτερο σερί",
      "res.share": "Κοινοποίηση",
      "res.next": "Νέο σουντόκου της ημέρας αύριο",
      "res.dailyDone": "Το σημερινό σουντόκου λύθηκε",
      "res.free": "Παίξε ελεύθερα",
      "stats.daily": "Ημέρας",
      "stats.dailyRow": "Λυμένα · σερί · καλύτερο",
      "share.clean": "χωρίς βοήθεια",
      "share.hints": "{n} βοήθειες",
      "toast.copied": "Το αποτέλεσμα αντιγράφηκε: επικόλλησέ το όπου θες",
      "toast.shared": "Το αποτέλεσμα κοινοποιήθηκε",
      "toast.copyFail": "Δεν έγινε αντιγραφή του αποτελέσματος",
      "toast.dailyGone": "Το σουντόκου της ημέρας θέλει το αρχείο gamekit: φόρτωσε ξανά το orOS",
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
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "btn.imp": "Εισαγωγή σουντόκου",
      "lv.i": "Από εισαγωγή",
      "turn.imp": "Από εισαγωγή: μένουν {n} κελιά",
      "lib.title": "Σουντόκου από εισαγωγή",
      "lib.paste": "Επικόλλησε ένα ή περισσότερα σουντόκου: 81 ψηφία το καθένα (0 ή . για κενό), ή πλέγμα 9×9",
      "lib.check": "Έλεγχος",
      "lib.file": "Άνοιγμα αρχείου…",
      "lib.formats": "Απλό κείμενο, αρχεία .sdk (SadMan) και .ss (Simple Sudoku): έως 500 σουντόκου τη φορά.",
      "lib.empty": "Δεν υπάρχουν ακόμα σουντόκου από εισαγωγή.",
      "lib.list": "Τα σουντόκου σου από εισαγωγή ({n})",
      "lib.row": "{g} δοσμένα",
      "lib.best": "ρεκόρ {t}",
      "lib.solved": "λυμένο",
      "lib.play": "Παίξε",
      "lib.playLabel": "Παίξε το σουντόκου {k}",
      "lib.next": "Επόμενο άλυτο",
      "lib.close": "Κλείσιμο",
      "imp.title": "Εισαγωγή · {s}",
      "imp.pasted": "Επικολλημένο κείμενο",
      "imp.found": "Σουντόκου που βρέθηκαν",
      "imp.new": "Για εισαγωγή",
      "imp.multi": "Από αυτά, με πολλές λύσεις",
      "imp.have": "Υπάρχουν ήδη",
      "imp.dup": "Επαναλαμβάνονται στο κείμενο",
      "imp.bad": "Παραλείπονται: άκυρα",
      "imp.more": "Διαβάζονται μόνο τα πρώτα {n} σουντόκου.",
      "imp.st.multi": "Σουντόκου {k} (γραμμή {l}): έχει {n} λύσεις: εισάγεται, μετράει κάθε σωστή συμπλήρωση",
      "imp.st.multiPlus": "Σουντόκου {k} (γραμμή {l}): έχει τουλάχιστον {n} λύσεις: εισάγεται, μετράει κάθε σωστή συμπλήρωση",
      "imp.st.conflict": "Σουντόκου {k} (γραμμή {l}): το ίδιο ψηφίο δύο φορές σε γραμμή, στήλη ή κουτί",
      "imp.st.none": "Σουντόκου {k} (γραμμή {l}): δεν έχει λύση",
      "imp.st.slow": "Σουντόκου {k} (γραμμή {l}): πολύ δύσκολο για έλεγχο, παραλείπεται",
      "imp.st.moreIssues": "…και άλλα {n}",
      "imp.note": "Τα σουντόκου από εισαγωγή κρατούν δικό τους καλύτερο χρόνο και δεν αλλάζουν τα ρεκόρ των επιπέδων.",
      "imp.go": "Εισαγωγή {n}",
      "imp.cancel": "Άκυρο",
      "imp.done": "Εισήχθησαν {n} σουντόκου",
      "imp.done1": "Εισήχθη 1 σουντόκου",
      "imp.undone": "Η εισαγωγή αναιρέθηκε",
      "imp.nothing": "Δεν βρέθηκε σουντόκου: επικόλλησε 81 ψηφία ή πλέγμα 9×9",
      "imp.noneNew": "Τίποτα νέο για εισαγωγή",
      "imp.err.read": "Δεν ήταν δυνατή η ανάγνωση του αρχείου",
      "imp.err.big": "Το αρχείο είναι πολύ μεγάλο για εισαγωγή",
      "imp.full": "Η λίστα γέμισε: έως {n} σουντόκου από εισαγωγή",
      "res.nextImp": "Επόμενο από εισαγωγή",
      "lib.broken": "Αυτό το σουντόκου δεν λύνεται"
    }
  };

  if (typeof window !== "undefined" && window.orosI18n) window.orosI18n.table(STRINGS, "sudoku", LANG);

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

  // ---------- Killer Sudoku ----------
  // Cages: cg = cage number of every cell (81), cs = the sum of every
  // cage. A cage holds distinct digits that add up to its sum; the usual
  // row / column / box rules still hold. The maker cuts a random full
  // grid into cages of 1–5 cells, then proves the puzzle has ONE
  // solution with a solver that knows the cage sums; while it has two,
  // a cell where they differ becomes a given (few puzzles need any).
  // KSUB[k * 46 + s] = digit masks of k distinct digits adding up to s.
  function killerTables() {
    if (KSUB) return;
    KSUB = [];
    for (var i = 0; i < 10 * 46; i++) KSUB.push([]);
    for (var m = 0; m < 512; m++) {
      var k = 0, s = 0;
      for (var d = 0; d < 9; d++) if (m & (1 << d)) { k++; s += d + 1; }
      KSUB[k * 46 + s].push(m);
    }
    KMEMO = new Int16Array(10 * 46 * 512);
    for (i = 0; i < KMEMO.length; i++) KMEMO[i] = -1;
  }
  // Digits that can still go into a cage with k empty cells, sum s left
  // and the digits of avail free: the union of every fitting combination.
  function cageAllowed(k, s, avail) {
    if (k < 1 || k > 9 || s < 1 || s > 45) return 0;
    var key = (k * 46 + s) * 512 + avail, v = KMEMO[key];
    if (v >= 0) return v;
    var list = KSUB[k * 46 + s], u = 0;
    for (var i = 0; i < list.length; i++) if (!(list[i] & ~avail)) u |= list[i];
    KMEMO[key] = u;
    return u;
  }

  // Count solutions up to limit of a killer puzzle (grid = givens);
  // returns { n, sols: the first `limit` solutions }; n = -1 when the
  // search took more than maxNodes steps (0 = no cap).
  function solveKiller(grid, cg, cs, limit, maxNodes) {
    killerTables();
    var g = grid.slice(), rm = [], cm = [], bm = [], i, n = 0, sols = [], nodes = 0, over = false;
    var nc = cs.length, cu = [], cl = [], cr = [];
    for (i = 0; i < 9; i++) { rm.push(0); cm.push(0); bm.push(0); }
    for (i = 0; i < nc; i++) { cu.push(0); cl.push(0); cr.push(cs[i]); }
    for (i = 0; i < 81; i++) cl[cg[i]]++;
    for (i = 0; i < 81; i++) {
      var v = g[i];
      if (!v) continue;
      var bit = 1 << (v - 1), c = cg[i];
      if ((rm[ROW[i]] | cm[COL[i]] | bm[BOX[i]] | cu[c]) & bit) return { n: 0, sols: [] };
      rm[ROW[i]] |= bit; cm[COL[i]] |= bit; bm[BOX[i]] |= bit;
      cu[c] |= bit; cl[c]--; cr[c] -= v;
    }
    for (i = 0; i < nc; i++) {
      if (cl[i] === 0 ? cr[i] !== 0 : !cageAllowed(cl[i], cr[i], 511 & ~cu[i])) return { n: 0, sols: [] };
    }
    function rec() {
      if (maxNodes && ++nodes > maxNodes) { over = true; return true; }
      var best = -1, bestMask = 0, bestN = 10;
      for (var k = 0; k < 81; k++) {
        if (g[k]) continue;
        var c = cg[k];
        var m = ~(rm[ROW[k]] | cm[COL[k]] | bm[BOX[k]]) & cageAllowed(cl[c], cr[c], 511 & ~cu[c]) & 511;
        var cnt = POP[m];
        if (cnt < bestN) { best = k; bestMask = m; bestN = cnt; if (cnt <= 1) break; }
      }
      if (best < 0) {
        n++;
        sols.push(g.slice());
        return n >= limit;
      }
      if (!bestN) return false;
      var cc = cg[best];
      for (var d = 0; d < 9; d++) {
        var b = 1 << d;
        if (!(bestMask & b)) continue;
        g[best] = d + 1;
        rm[ROW[best]] |= b; cm[COL[best]] |= b; bm[BOX[best]] |= b;
        cu[cc] |= b; cl[cc]--; cr[cc] -= d + 1;
        var stop = rec();
        cu[cc] &= ~b; cl[cc]++; cr[cc] += d + 1;
        rm[ROW[best]] &= ~b; cm[COL[best]] &= ~b; bm[BOX[best]] &= ~b;
        g[best] = 0;
        if (stop) return true;
      }
      return false;
    }
    rec();
    return { n: over ? -1 : n, sols: sols };
  }


  // Cut a full grid into cages of distinct digits. Returns cg (cage
  // numbers in reading order of each cage's first cell) and cs.
  function makeCages(sol, rnd) {
    var cg = [], i, order = [];
    for (i = 0; i < 81; i++) { cg.push(-1); order.push(i); }
    order = shuffled(order, rnd);
    var cages = [];
    function nbrs(x) {
      var out = [], r = ROW[x], c = COL[x];
      if (r > 0) out.push(x - 9);
      if (r < 8) out.push(x + 9);
      if (c > 0) out.push(x - 1);
      if (c < 8) out.push(x + 1);
      return out;
    }
    order.forEach(function (start) {
      if (cg[start] >= 0) return;
      var id = cages.length, cells = [start], used = 1 << (sol[start] - 1);
      var want = KSIZES[Math.floor(rnd() * KSIZES.length)];
      cg[start] = id;
      while (cells.length < want) {
        var opts = [];
        cells.forEach(function (x) {
          nbrs(x).forEach(function (y) {
            if (cg[y] < 0 && !(used & (1 << (sol[y] - 1))) && opts.indexOf(y) < 0) opts.push(y);
          });
        });
        if (!opts.length) break;
        var y = opts[Math.floor(rnd() * opts.length)];
        cg[y] = id; cells.push(y); used |= 1 << (sol[y] - 1);
      }
      cages.push(cells);
    });
    // a lone cell joins a neighbouring cage when its digit fits there
    cages.forEach(function (cells, id) {
      if (cells.length !== 1) return;
      var x = cells[0], r = ROW[x], c = COL[x];
      var cand = [];
      if (r > 0) cand.push(x - 9);
      if (r < 8) cand.push(x + 9);
      if (c > 0) cand.push(x - 1);
      if (c < 8) cand.push(x + 1);
      for (var j = 0; j < cand.length; j++) {
        var o = cg[cand[j]], other = cages[o];
        if (o === id || other.length >= 5) continue;
        var clash = other.some(function (z) { return sol[z] === sol[x]; });
        if (clash) continue;
        other.push(x); cg[x] = o; cells.length = 0;
        return;
      }
    });
    // renumber in reading order of each cage's first cell
    var map = {}, next = 0, out = [], sums = [];
    for (i = 0; i < 81; i++) {
      if (map[cg[i]] === undefined) { map[cg[i]] = next++; sums.push(0); }
      out.push(map[cg[i]]);
      sums[map[cg[i]]] += sol[i];
    }
    return { cg: out, cs: sums };
  }

  // A killer puzzle: { puz (givens, mostly none), sol, cg, cs }. Tries
  // new cuts while a cut needs more than maxGivens givens.
  function makeKiller(rnd, maxGivens) {
    for (var tries = 0; ; tries++) {
      var sol = fullGrid(rnd), k = makeCages(sol, rnd), puz = emptyGrid(), ok = true;
      for (;;) {
        var r = solveKiller(puz, k.cg, k.cs, 2, KNODES);
        if (r.n === 1) break;
        var diff = [], i;
        if (r.n === 2) {
          for (i = 0; i < 81; i++) if (r.sols[0][i] !== r.sols[1][i]) diff.push(i);
        } else {
          for (i = 0; i < 81; i++) if (!puz[i]) diff.push(i);   // too slow to prove: one more given
        }
        var at = diff[Math.floor(rnd() * diff.length)];
        puz[at] = sol[at];
        var given = 0;
        for (i = 0; i < 81; i++) if (puz[i]) given++;
        if (given > maxGivens && tries < 20) { ok = false; break; }
      }
      if (ok) return { puz: puz, sol: sol, cg: k.cg, cs: k.cs };
    }
  }

  // ---------- 3. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                       // max-merged
  //   rows: { <deviceId>: { b: <epoch>,
  //                         s: { e|m|h|x|k: { t: best ms (0 = none), ts: when,
  //                                           n: solved, c: solved without hints } } } },
  //   days: { "<day>": { b: <epoch>, t: ms, h: hints, m: boxes with a hint (9 bits) } },
  //   lib?: { "imp-…": { p, nm?, b, x, s, t } }     // imported puzzles (import.js)
  // }
  // lib is only present when it holds something; its join lives in
  // import.js (mergeLib) and ignores br (a reset clears records only).
  // days (since 1.0 of Wave 49; older data has none): one daily result
  // per calendar day (day 0 = 1 Jan 2026, gamekit/daily.js). A daily
  // puzzle is solved once overall: the newer epoch wins; equal epochs
  // keep the better result (no hint first, then the shorter time, then
  // fewer hints, then the smaller mask: a total order, so a join).
  // Each device only ever writes ITS OWN row; a row counts from epoch b.
  // Merge per row: the newer epoch wins; equal epochs take, per level,
  // the better time (lower t > 0, then the earlier ts) and the higher n
  // and c. Rows older than br drop. A join (symmetric, associative,
  // idempotent).
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {}, days: {} }; }

  function normDay(v) {
    if (!v || typeof v !== "object" || !isInt(v.b) || v.b < 0 || !isInt(v.t) || v.t < 1 || v.t > MAX_MS ||
        !isInt(v.h) || v.h < 0 || v.h > 81 || !isInt(v.m) || v.m < 0 || v.m > 511) return null;
    return { b: v.b, t: v.t, h: v.h, m: v.m };
  }
  function dayKeyOk(k) { return /^\d{1,6}$/.test(k) && +k <= MAX_DAY; }
  // a better than c (equal epochs)
  function dayBetter(a, c) {
    if ((a.h > 0) !== (c.h > 0)) return a.h === 0;
    if (a.t !== c.t) return a.t < c.t;
    if (a.h !== c.h) return a.h < c.h;
    return a.m < c.m;
  }

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
    var rows = {}, days = {};
    [a.days, b.days].forEach(function (m) {
      if (!m || typeof m !== "object") return;
      Object.keys(m).forEach(function (k) {
        var v = dayKeyOk(k) ? normDay(m[k]) : null;
        if (!v || v.b < br) return;
        var o = days[k];
        if (!o || v.b > o.b || (v.b === o.b && dayBetter(v, o))) days[k] = v;
      });
    });
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
    var sd = {};
    Object.keys(days).sort(function (x, y) { return x - y; }).forEach(function (k) { sd[k] = days[k]; });
    var out = { ver: DATA_VER, br: br, rows: sorted, days: sd };
    var lib = libJoin(a.lib, b.lib);
    if (lib) out.lib = lib;
    return out;
  }
  // The imported puzzles' join (import.js). Without the module (it did
  // not load) the library is carried over untouched, never dropped.
  function libJoin(x, y) {
    var m = typeof window !== "undefined" && window.OrosSudokuImport;
    if (m) return m.mergeLib(x, y);
    var keep = x && typeof x === "object" ? x : (y && typeof y === "object" ? y : null);
    return keep && Object.keys(keep).length ? keep : null;
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

  // Daily results: solved days, the current and best streak.
  function dailyStats(todayIdx) {
    var on = {}, n = 0;
    Object.keys(data.days).forEach(function (k) { on[k] = true; n++; });
    var st = DK ? DK.streaks(on, todayIdx) : { cur: 0, best: 0 };
    return { n: n, cur: st.cur, best: st.best };
  }
  function countDaily(day, ms, hints, mask) {
    var v = { b: data.br, t: Math.max(1, Math.min(MAX_MS, ms)), h: Math.min(81, hints), m: mask & 511 };
    var o = data.days[day];
    if (o && o.b >= v.b && !dayBetter(v, o)) return;
    data.days[day] = v;
    data = mergeSudoku(data, data);
    save();
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
  //          hist: [[change…]…], fut: [[change…]…],
  //          day?: the daily puzzle's day number, hb?: boxes a hint filled
  //          (9 bits, for the shared result), cg?, cs?: Killer cages,
  //          imp?: the library id of an imported puzzle, mu?: it has more
  //          than one solution (any valid filling counts) }
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
    if (check.n !== 1) return false;
    if (g.day !== undefined && (!isInt(g.day) || g.day < 0 || g.day > MAX_DAY || g.lv !== DAILY_LV)) return false;
    if (g.imp !== undefined && (typeof g.imp !== "string" || !/^imp-[a-z0-9]{1,16}$/.test(g.imp) ||
        g.day !== undefined || g.lv === "k")) return false;
    if (g.mu !== undefined && (typeof g.mu !== "boolean" || g.imp === undefined)) return false;
    if (g.lv === "k") return validCages(g.cg, g.cs, sol);
    return true;
  }
  // Cages cover the grid, each holds distinct digits of the solution
  // that add up to its sum.
  function validCages(cg, cs, sol) {
    if (!Array.isArray(cg) || cg.length !== 81 || !Array.isArray(cs) || !cs.length || cs.length > 81) return false;
    var used = [], sum = [], i;
    for (i = 0; i < cs.length; i++) { used.push(0); sum.push(0); }
    for (i = 0; i < 81; i++) {
      var c = cg[i];
      if (!isInt(c) || c < 0 || c >= cs.length) return false;
      var bit = 1 << (sol[i] - 1);
      if (used[c] & bit) return false;
      used[c] |= bit; sum[c] += sol[i];
    }
    for (i = 0; i < cs.length; i++) if (!used[i] || sum[i] !== cs[i]) return false;
    return true;
  }
  function loadSession() {
    try {
      var g = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(g)) {
        if (!validChanges(g.hist)) g.hist = [];
        if (!validChanges(g.fut)) g.fut = [];
        g.notes = g.notes === true;
        g.hb = isInt(g.hb) && g.hb >= 0 && g.hb <= 511 ? g.hb : 0;
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
    cageMarks();
  }

  // Killer: per cell the cage border classes and, on the first cell of
  // each cage, its sum.
  var KCLS = [], KSUM = [];
  function cageMarks() {
    KCLS = []; KSUM = [];
    var cg = game && game.cg, seen = {};
    for (var i = 0; i < 81; i++) {
      if (!cg) { KCLS.push(""); KSUM.push(0); continue; }
      var c = cg[i], r = ROW[i], col = COL[i], k = " kc";
      if (r === 0 || cg[i - 9] !== c) k += " kt";
      if (col === 8 || cg[i + 1] !== c) k += " kr";
      if (r === 8 || cg[i + 9] !== c) k += " kb";
      if (col === 0 || cg[i - 1] !== c) k += " kl";
      KCLS.push(k);
      KSUM.push(seen[c] ? 0 : game.cs[c]);
      seen[c] = true;
    }
  }
  function cageSize(c) {
    var n = 0;
    for (var i = 0; i < 81; i++) if (game.cg[i] === c) n++;
    return n;
  }

  // A new puzzle: a level, Killer, or the daily one of a day (a Medium
  // puzzle from the date's seed; the maker counts attempts instead of
  // time, so every device makes the same one).
  function fresh(lv, day) {
    var p;
    if (day !== undefined) p = generate(DAILY_LV, DK.random(DK.seedOf("sudoku", day)), DAILY_TRIES, DK.counter());
    else if (lv === "k") p = makeKiller(rand, KILLER_GIVENS);
    else p = generate(lv, rand, GEN_MS, nowMs);
    var v = [], nt = [];
    for (var i = 0; i < 81; i++) { v.push(0); nt.push(0); }
    var g = { lv: day !== undefined ? DAILY_LV : lv, puz: p.puz.join(""), sol: p.sol.join(""), v: v, nt: nt, ms: 0,
              hints: 0, done: false, sel: -1, notes: false, hist: [], fut: [], hb: 0 };
    if (day !== undefined) g.day = day;
    if (p.cg) { g.cg = p.cg; g.cs = p.cs; }
    return g;
  }
  // An imported puzzle (a library entry of import.js) as a new game: its
  // first solution, mu when it has more (or was not proven unique); lv
  // = the level its techniques match, a label only (no records).
  function freshImported(e) {
    var r = IMPS ? IMPS.countSolutions(e.p, 2) : null;
    if (!r || !r.sol) return null;
    var v = [], nt = [], lt = logicTier(digitsOf(e.p));
    for (var i = 0; i < 81; i++) { v.push(0); nt.push(0); }
    return { lv: lt.solved ? ["e", "e", "m", "h", "x", "x"][Math.min(5, lt.tier)] : "x", puz: e.p, sol: r.sol,
             v: v, nt: nt, ms: 0, hints: 0, done: false, sel: -1, notes: false, hist: [], fut: [], hb: 0,
             imp: e.id, mu: r.n > 1 || r.cut };
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
  // imp: a library entry { id, p } to play instead of a made puzzle.
  function newGame(lv, day, imp) {
    if (making) { showToast(t("toast.making")); return; }
    var ig = imp ? freshImported(imp) : null;
    if (imp && !ig) { showToast(t("lib.broken")); return; }
    closeDialogs();
    var prev = inProgress() ? (saveSession(), copy(game)) : null;
    if (day === undefined && !imp) { prefs.lv = lv; savePrefs(); }
    making = true;
    syncClock();
    renderAll();
    setTimeout(function () {
      setGame(ig || fresh(lv, day));
      making = false;
      saveSession();
      syncClock();
      renderAll();
      if (prev) {
        undoToast(t("toast.newgame"), function () {
          runFrom = 0;
          if (prev.day === undefined && prev.imp === undefined) { prefs.lv = prev.lv; savePrefs(); }
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
    game.hb = (game.hb || 0) | (1 << BOX[i]);
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

  // Solved: the solution, or for a puzzle with more than one (mu) any
  // full grid without a clash.
  function solved() {
    var i;
    if (game.mu) {
      for (i = 0; i < 81; i++) if (!(PUZ[i] || game.v[i]) || clashes(i)) return false;
      return true;
    }
    for (i = 0; i < 81; i++) if ((PUZ[i] || game.v[i]) !== SOL[i]) return false;
    return true;
  }
  // Does cell i hold the same digit as one of its peers?
  function clashes(i) {
    var v = PUZ[i] || game.v[i];
    if (!v) return false;
    for (var j = 0; j < PEERS[i].length; j++) if ((PUZ[PEERS[i][j]] || game.v[PEERS[i][j]]) === v) return true;
    return false;
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
    var rec = game.imp !== undefined ? countImported(game.imp, game.ms, game.hints > 0)
      : countSolve(game.lv, game.ms, game.hints > 0);
    if (game.day !== undefined) countDaily(game.day, game.ms, game.hints, game.hb || 0);
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
    var cur = game && !making ? (game.day !== undefined || game.imp !== undefined ? "" : game.lv) : prefs.lv;
    var db = $("daily-btn");
    if (db) {
      var due = !!DK && !data.days[today()];
      db.classList.toggle("due", due);
      db.classList.toggle("on", !!(game && !making && game.day !== undefined));
    }
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
    if (!making && game.imp !== undefined) s = { t: impEntry(game.imp).t || 0 };
    $("best").textContent = s.t ? fmtTime(s.t) : "–";
    var msg, cls = "";
    if (making) msg = t("turn.making");
    else if (game.done) { msg = t("turn.done"); cls = "done"; }
    else if (game.notes) { msg = t("turn.notes"); cls = "done"; }
    else if (game.hints) { msg = t("turn.hinted"); cls = "warn"; }
    else if (filledCount() === countGivens()) msg = game.day !== undefined ? t("res.titleD", { n: game.day + 1 }) : t("turn.start");
    else if (game.day !== undefined) msg = t("turn.daily", { n: game.day + 1, k: 81 - filledCount() });
    else if (game.imp !== undefined) msg = t("turn.imp", { n: 81 - filledCount() });
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
    if (game.cg) s += t("cell.cage", { n: cageSize(game.cg[i]), s: game.cs[game.cg[i]] }) + ", ";
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
      cellEls.forEach(function (c) { c.className = "cell"; c.textContent = ""; c.__k = ""; });
      return;
    }
    b.classList.toggle("killer", !!game.cg);
    var lab = t(game.cg ? "board.killer" : "board.label");
    if (b.getAttribute("aria-label") !== lab) b.setAttribute("aria-label", lab);
    var sel = game.sel, sd = sel >= 0 ? (PUZ[sel] || game.v[sel]) : 0;
    for (var i = 0; i < 81; i++) {
      var c = cellEls[i], v = PUZ[i] || game.v[i], cls = "cell" + (KCLS[i] || "");
      if (PUZ[i]) cls += " given";
      else if (v) cls += " user";
      if (v && prefs.mist && !PUZ[i] && (game.mu ? clashes(i) : v !== SOL[i])) cls += " bad";
      if (i === sel) cls += " sel";
      else if (sel >= 0 && IS_PEER[sel * 81 + i]) cls += " peer";
      if (sd && v === sd && i !== sel) cls += " same";
      var key = cls + "|" + v + "|" + game.nt[i] + "|" + (sd || 0) + "|" + (KSUM[i] || 0);
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
      if (KSUM[i]) {
        var ks = document.createElement("span");
        ks.className = "ksum";
        ks.textContent = String(KSUM[i]);
        c.appendChild(ks);
      }
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
    // under the board the pad may run wider than a small board, so each
    // digit key stays at least ~35 px wide on a 360 px phone
    play.style.setProperty("--pw", (side ? size : Math.min(W, Math.max(size, 9 * 36 + 24))) + "px");
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
      var box = $("toast");
      if (box && box.parentNode === dlg) parkToast();   // only its own: the next dialog may host it already
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
    if (game.day !== undefined && data.days[game.day]) { dailyDialog(game.day, rec); return; }
    if (game.imp !== undefined) { importedResult(rec); return; }
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

  // ---------- Daily puzzle ----------
  function today() { return DK ? DK.today() : 0; }

  // The Daily button: today's result when it is solved (here or on
  // another device), else today's puzzle (resumed when it is open).
  function openDaily() {
    if (!DK) { showToast(t("toast.dailyGone")); return; }
    if (making) { showToast(t("toast.making")); return; }
    var d = today();
    if (data.days[d]) { dailyDialog(d, false); return; }
    closeDialogs();
    if (game && game.day === d && !game.done) return;
    newGame(DAILY_LV, d);
  }

  function dailyDialog(day, rec) {
    var r = data.days[day];
    if (!r || !DK) return;
    closeDialogs();
    var st = dailyStats(today());
    var dlg = makeDialog("sudoku-daily");
    dlg.appendChild(el("div", "dlg-title", t("res.titleD", { n: day + 1 }) + " · " + DK.dateLabel(day, LANG)));
    dlg.appendChild(el("div", "dlg-hero", fmtTime(r.t)));
    if (rec) dlg.appendChild(el("div", "dlg-badge", t("res.rec")));
    dlg.appendChild(row(t("res.hints"), String(r.h)));
    dlg.appendChild(row(t("res.streak"), String(st.cur)));
    dlg.appendChild(row(t("res.bestStreak"), String(st.best)));
    if (day === today()) dlg.appendChild(el("div", "dlg-msg dlg-center", t("res.next")));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("res.share"), "", function () { shareDaily(day); }));
    var free = button(t("res.free"), "primary", function () {
      dlg.close();
      if (game && game.day !== undefined) newGame(prefs.lv);
    });
    acts.appendChild(free);
    dlg.appendChild(acts);
    hubLink(dlg);
    document.body.appendChild(dlg);
    dlg.showModal();
    free.focus();
  }

  // Spoiler-free: the time, the hints and the 3×3 boxes (a yellow box
  // got a hint).
  function shareDaily(day) {
    var r = data.days[day];
    if (!r || !DK) return;
    var grid = [];
    for (var y = 0; y < 3; y++) {
      var line = "";
      for (var x = 0; x < 3; x++) line += (r.m & (1 << (y * 3 + x))) ? "🟨" : "🟩";
      grid.push(line);
    }
    var text = DK.shareText({ game: t("app.name"), label: t("lv.d"), day: day, grid: grid,
      line: "⏱ " + fmtTime(r.t) + " · " + (r.h ? t("share.hints", { n: r.h }) : t("share.clean")) });
    DK.share(text, "orOS " + t("app.name")).then(function (how) {
      if (how === "copied") showToast(t("toast.copied"));
      else if (how === "shared") live(t("toast.shared"));
      else if (how === "failed") showToast(t("toast.copyFail"));
    });
  }

  // "All games" (the Game Center), only when it is installed.
  function hubLink(dlg) {
    if (!DK || !DK.hasHub()) return;
    var b = button(t("btn.games"), "dlg-link", function () { dlg.close(); DK.openHub("sudoku"); });
    dlg.appendChild(b);
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
    var ds = dailyStats(today());
    if (ds.n) empty = false;
    dlg.appendChild(el("div", "dlg-sub", t("stats.daily") + " · " + t("stats.dailyRow")));
    dlg.appendChild(row(t("lv.d"), ds.n ? ds.n + " · " + ds.cur + " · " + ds.best : "–"));
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
    hubLink(dlg);
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

  // ---------- Imported puzzles (import.js) ----------
  // "Import puzzles" (toolbar): a paste box and a file button → analyze
  // (OrosSudokuImport, pure) → a preview with the counts and the issues
  // → ONE write (save(): one persist, one dirty mark) → a toast with
  // Undo. The list below the paste box plays any imported puzzle (the
  // game in progress gets the usual Undo toast). Text from a file only
  // reaches the page through textContent / a textarea value.
  var IMPS = window.OrosSudokuImport || null;
  var IMP_MAX = 4 * 1024 * 1024;              // bytes read from a file

  function impEntry(id) {
    var e = data.lib && data.lib[id];
    return e || { t: 0, s: 0 };
  }
  function impList() { return IMPS ? IMPS.list(data.lib) : []; }

  // A solved imported puzzle: solved stamp and its own best time in the
  // library; the level records stay as they are. True = a new best.
  function countImported(id, ms, hinted) {
    if (!IMPS || !data.lib || !data.lib[id]) return false;
    var before = data.lib[id].t || 0;
    data.lib = IMPS.solved(data.lib, id, ms, hinted, Date.now()) || data.lib;
    data = mergeSudoku(data, data);
    save();
    return !hinted && (!before || ms < before);
  }

  // The first unsolved imported puzzle after `id` (wrapping), or null.
  function nextUnsolved(id) {
    var l = impList(), k = -1, i;
    for (i = 0; i < l.length; i++) if (l[i].id === id) k = i;
    for (i = 1; i <= l.length; i++) {
      var e = l[(k + i + l.length) % l.length];
      if (!e.s && e.id !== id) return e;
    }
    return null;
  }

  function importedResult(rec) {
    closeDialogs();
    var e = impEntry(game.imp), nx = nextUnsolved(game.imp);
    var dlg = makeDialog("sudoku-result");
    dlg.appendChild(el("div", "dlg-title", t("res.title") + " · " + t("lv.i") + " · " + t("lv." + game.lv)));
    dlg.appendChild(el("div", "dlg-hero", fmtTime(game.ms)));
    if (rec) dlg.appendChild(el("div", "dlg-badge", t("res.rec")));
    dlg.appendChild(row(t("res.hints"), String(game.hints)));
    dlg.appendChild(row(t("res.best"), e.t ? fmtTime(e.t) : "–"));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("res.close"), "", function () { dlg.close(); }));
    var again = nx
      ? button(t("res.nextImp"), "primary", function () { dlg.close(); newGame(prefs.lv, undefined, nx); })
      : button(t("res.again"), "primary", function () { dlg.close(); newGame(prefs.lv); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    again.focus();
  }

  // The import dialog: paste box, file button, the imported list.
  function libDialog(draft) {
    if (!IMPS || !window.OrosImportKit) return;
    if (making) { showToast(t("toast.making")); return; }
    parkToast();                                // the toast may live in the dialog being replaced
    var dlg = makeDialog("sudoku-lib");
    dlg.classList.add("wide");
    dlg.appendChild(el("div", "dlg-title", t("lib.title")));
    var lab = el("label", "imp-lab", t("lib.paste"));
    lab.setAttribute("for", "imp-text");
    dlg.appendChild(lab);
    var ta = el("textarea", "imp-text");
    ta.id = "imp-text";
    ta.rows = 4;
    ta.spellcheck = false;
    ta.autocomplete = "off";
    ta.setAttribute("autocapitalize", "off");
    ta.placeholder = "4.....8.5.3..........7......2.....6.....8.4......1.......6.3.7.5..2.....1.4......";
    if (draft) ta.value = draft;
    dlg.appendChild(ta);
    dlg.appendChild(el("div", "imp-note", t("lib.formats")));
    var bar = el("div", "dlg-actions imp-bar");
    bar.appendChild(button(t("lib.file"), "", function () {
      pickImportFile().then(function (f) { if (f) importFile(f); });
    }));
    var chk = button(t("lib.check"), "primary", function () {
      var text = ta.value;
      if (!text.trim()) { ta.focus(); return; }
      previewImport(IMPS.analyze(text, data.lib), t("imp.pasted"), text);
    });
    bar.appendChild(chk);
    dlg.appendChild(bar);
    var l = impList();
    dlg.appendChild(el("div", "dlg-sub", t("lib.list", { n: l.length })));
    if (!l.length) dlg.appendChild(el("div", "imp-note", t("lib.empty")));
    else {
      var nx = nextUnsolved(game && game.imp !== undefined ? game.imp : "");
      if (nx) {
        var nb = button(t("lib.next"), "imp-next", function () { dlg.close(); newGame(prefs.lv, undefined, nx); });
        dlg.appendChild(nb);
      }
      var ul = el("ul", "imp-list");
      l.forEach(function (e, k) {
        var li = el("li", "imp-row" + (game && game.imp === e.id ? " cur" : ""));
        var txt = el("span", "imp-txt");
        txt.appendChild(el("strong", "", "#" + (k + 1) + (e.nm ? " · " + e.nm : "")));
        var bits = [t("lib.row", { g: IMPS.givens(e.p) })];
        if (e.s) bits.push(e.t ? t("lib.best", { t: fmtTime(e.t) }) : t("lib.solved"));
        txt.appendChild(el("span", "imp-meta", bits.join(" · ")));
        li.appendChild(txt);
        var pb = button(t("lib.play"), "imp-play", function () { dlg.close(); newGame(prefs.lv, undefined, e); });
        pb.setAttribute("aria-label", t("lib.playLabel", { k: k + 1 }));
        li.appendChild(pb);
        ul.appendChild(li);
      });
      dlg.appendChild(ul);
    }
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("lib.close"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    ta.focus();
  }

  function pickImportFile() {
    var host = null;
    try { host = window.parent && window.parent !== window ? window.parent.orosDialog : null; } catch (e) { host = null; }
    if (host && typeof host.openFile === "function") return host.openFile(IMPS.ACCEPT);
    return new Promise(function (resolve) {        // standalone page
      var inp = document.createElement("input");
      inp.type = "file";
      inp.accept = IMPS.ACCEPT;
      inp.hidden = true;
      inp.addEventListener("change", function () {
        var f = inp.files && inp.files[0];
        inp.remove();
        resolve(f || null);
      });
      inp.addEventListener("cancel", function () { inp.remove(); resolve(null); });
      document.body.appendChild(inp);
      inp.click();
    });
  }
  // A file → the preview (Promise<boolean>: puzzles were found).
  function importFile(file) {
    var K = window.OrosImportKit;
    return K.readFile(file, IMP_MAX)
      .then(function (r) {
        var text = K.text(r.bytes), res = IMPS.analyze(text, data.lib);
        if (!res.items.length) { showToast(t("imp.nothing")); return false; }
        previewImport(res, K.clean(r.name || file.name || "", 80) || t("imp.pasted"), "");
        return true;
      })
      .catch(function (e) {
        showToast(t(e && e.message === "toobig" ? "imp.err.big" : "imp.err.read"));
        return false;
      });
  }

  // Preview: counts, up to 8 issues, then Import (or back to the paste box).
  function previewImport(res, srcName, draft) {
    var c = res.counts;
    if (!c.found) { showToast(t("imp.nothing")); return; }
    var add = c.ok + c.multi, bad = c.conflict + c.none + c.slow;
    var dlg = makeDialog("sudoku-imp");
    dlg.classList.add("wide");
    dlg.appendChild(el("div", "dlg-title", t("imp.title", { s: srcName })));
    dlg.appendChild(row(t("imp.found"), String(c.found)));
    dlg.appendChild(row(t("imp.new"), String(add)));
    if (c.multi) dlg.appendChild(row(t("imp.multi"), String(c.multi)));
    if (c.have) dlg.appendChild(row(t("imp.have"), String(c.have)));
    if (c.dup) dlg.appendChild(row(t("imp.dup"), String(c.dup)));
    if (bad) dlg.appendChild(row(t("imp.bad"), String(bad)));
    var issues = [];
    res.items.forEach(function (it, k) {
      var p = { k: k + 1, l: it.at, n: it.n };
      if (it.st === "multi") issues.push(t(it.cut ? "imp.st.multiPlus" : "imp.st.multi", p));
      else if (it.st === "conflict" || it.st === "none" || it.st === "slow") issues.push(t("imp.st." + it.st, p));
    });
    if (issues.length) {
      var ul = el("ul", "imp-issues");
      issues.slice(0, 8).forEach(function (x) { ul.appendChild(el("li", "", x)); });
      if (issues.length > 8) ul.appendChild(el("li", "", t("imp.st.moreIssues", { n: issues.length - 8 })));
      dlg.appendChild(ul);
    }
    if (c.more) dlg.appendChild(el("div", "imp-note", t("imp.more", { n: IMPS.MAX_PUZZLES })));
    dlg.appendChild(el("div", "imp-note", t("imp.note")));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("imp.cancel"), "", function () { dlg.close(); if (draft) setTimeout(function () { libDialog(draft); }, 0); }));
    var go = button(t("imp.go", { n: add }), "primary", function () { dlg.close(); runImport(res); });
    go.disabled = !add;
    acts.appendChild(go);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    (add ? go : acts.firstChild).focus();
  }

  function runImport(res) {
    var r = IMPS.apply(data.lib, res.items, Date.now());
    if (!r.ids.length) { showToast(t(r.full ? "imp.full" : "imp.noneNew", { n: IMPS.MAX_LIB })); return; }
    if (r.lib) data.lib = r.lib;
    data = mergeSudoku(data, data);
    save();                                    // one write, one dirty mark
    libDialog();
    var info = r.undo, used = false;
    undoToast(r.ids.length === 1 ? t("imp.done1") : t("imp.done", { n: r.ids.length }), function () {
      if (used) return;
      used = true;
      var lib = IMPS.undo(data.lib, info, Date.now());
      if (lib) data.lib = lib; else delete data.lib;
      data = mergeSudoku(data, data);
      save();
      if (document.getElementById("sudoku-lib")) libDialog();
      renderStatus();
      showToast(t("imp.undone"));
    });
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
    daily: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="m12 13 1 2 2 .3-1.5 1.4.4 2.1-1.9-1-1.9 1 .4-2.1L9 15.3l2-.3z"/></svg>',
    imp:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>',
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
    if (game) { renderStatus(); renderToolbar(); }
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
     ["opts-btn", "opts", "btn.opts"], ["daily-btn", "daily", "btn.daily"], ["imp-btn", "imp", "btn.imp"]].forEach(function (x) {
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
        if (game && lv === game.lv && game.day === undefined && game.imp === undefined && !game.done && !making) return;   // visible active state
        newGame(lv);
      });
    });
    $("new-btn").addEventListener("click", function () {
      newGame(game && !making && game.day === undefined && game.imp === undefined ? game.lv : prefs.lv);
      $("new-btn").blur();
    });
    $("daily-btn").addEventListener("click", openDaily);
    // Deep link from the Game Center: { daily: true } opens today's puzzle.
    window.__orosOpenAt = function (tg) { if (tg && tg.daily) openDaily(); };
    $("stats-btn").addEventListener("click", statsDialog);
    $("opts-btn").addEventListener("click", optsDialog);
    $("imp-btn").addEventListener("click", function () { libDialog(""); $("imp-btn").blur(); });
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
      renderToolbar();                            // the Daily dot after midnight
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
    var g = loadSession(), tg = DK ? DK.takeTarget("sudoku") : null;
    if (g) {
      setGame(g);
      if (g.day === undefined) prefs.lv = g.lv;   // the resumed puzzle decides the toolbar
      syncClock();
      renderAll();
      if (tg && tg.daily) openDaily();
    } else if (tg && tg.daily && DK && !data.days[today()]) {
      newGame(DAILY_LV, today());
    } else {
      newGame(prefs.lv);
      if (tg && tg.daily) setTimeout(openDaily, 80);
    }
  }

  boot();
})();
