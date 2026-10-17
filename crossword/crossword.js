// ============================================================
// orOS Crossword — App logic (v1.0.0)
// A fill-in crossword (kriss-kross): no clues. The words are given,
// grouped by length; place them in the grid so every crossing agrees.
//   - words in English or Greek (own switch, default = orOS language);
//     Greek in capitals without accents, final sigma as Σ
//   - three sizes: up to 9×9 (8–10 words), 13×13 (14–18), 17×17 (22–28);
//     random common words or one of the Word Search themes
//   - generated from the shared word lists: a connected crossing layout,
//     a unique solution where possible (a solver counts them), a few
//     letters given (the first in the most crossed word)
//   - tap a cell and type (physical keys by position, or the on-screen
//     keyboard); a second tap switches across / down; arrows, Tab,
//     Backspace
//   - check letter / word / all; reveal a letter (no record then)
//   - Daily: one puzzle a day, the same on every device (from the date,
//     offline); Free play: as many as you like, records per size
//   - Imported (import.js, window.OrosCrosswordImport): clued crosswords
//     from Across Lite .puz / .ipuz files, played with numbers and clues
//     (check / reveal against the file's solution; rebus squares take
//     their first letter; circles shown); a list of them, synced
// Data:
//   - synced slice "crossword" (oros-crossword-data): every daily result
//     per language (one per day: the better one wins), Free play records
//     as per-device rows + a reset stamp br, and lib: the imported
//     crosswords (each with its own best time; import.js holds its join)
//   - device-local (R10): oros-crossword-prefs (word language, mode,
//     size, theme), oros-crossword-session (the puzzles in progress),
//     oros-crossword-device (row id)
// Word lists: ../wordsearch/words-en.js / words-el.js
// (window.WORDSEARCH_WORDS, shared with Word Search).
// Sections:
//   1. Constants, i18n, helpers
//   2. Puzzle model (normalize, seeded random, layout, solver, givens)
//   3. Synced data: load / save / normalize / merge (R5, R26)
//   4. Device-local prefs + session
//   5. Game flow (new puzzle, typing, checks, reveal, finish, timer)
//   6. Render (toolbar, status, grid, word list, keyboard)
//   7. Dialogs (result, statistics, themes, check, confirm)
//   8. Toasts
//   9. Input (taps, keys by position, on-screen keyboard, Contract Β)
//  10. Sync slice + palette
//  11. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-crossword-data";
  var PREFS_KEY   = "oros-crossword-prefs";
  var SESSION_KEY = "oros-crossword-session";
  var DEVICE_KEY  = "oros-crossword-device";
  var DATA_VER    = 1;

  var LANGS = ["en", "el"];
  var MODES = ["d", "f"];
  var SIZES = ["e", "m", "h"];
  // n = largest grid side, lo–hi = words per puzzle, giv = most letters
  // given, lens = word lengths for random words (repeats = weight).
  var LEVELS = {
    e: { n: 9,  lo: 8,  hi: 10, giv: 3, lens: [3, 4, 4, 5, 5, 5, 6, 6, 7] },
    m: { n: 13, lo: 14, hi: 18, giv: 4, lens: [3, 4, 4, 5, 5, 5, 6, 6, 7, 7, 8, 9] },
    h: { n: 17, lo: 22, hi: 28, giv: 5, lens: [3, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 8, 8, 9, 10] }
  };
  var DAILY_SIZE = "m";
  var THEME_IDS = ["animals", "food", "countries", "jobs", "home", "nature", "sports", "music",
    "school", "body", "clothes", "colours", "transport", "weather", "fruitveg", "sea", "city",
    "tools", "feelings", "holidays"];
  var LETTERS = { en: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", el: "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ" };
  var WORD_RE = { en: /^[A-Z]{3,17}$/, el: /^[Α-Ω]{3,17}$/ };
  var KB_ROWS = {
    en: ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"],
    el: ["ΕΡΤΥΘΙΟΠ", "ΑΣΔΦΓΗΞΚΛ", "ΖΧΨΩΒΝΜ"]
  };
  // Physical key (by position) → Greek letter, as on a Greek keyboard
  // (same map as Wordle).
  var EL_BY_CODE = { KeyE: "Ε", KeyR: "Ρ", KeyT: "Τ", KeyY: "Υ", KeyU: "Θ", KeyI: "Ι", KeyO: "Ο",
    KeyP: "Π", KeyA: "Α", KeyS: "Σ", KeyD: "Δ", KeyF: "Φ", KeyG: "Γ", KeyH: "Η", KeyJ: "Ξ",
    KeyK: "Κ", KeyL: "Λ", KeyZ: "Ζ", KeyX: "Χ", KeyC: "Ψ", KeyV: "Ω", KeyB: "Β", KeyN: "Ν",
    KeyM: "Μ", KeyW: "Σ" };
  var EMPTY = "-", BLOCK = ".";
  var EPOCH_UTC = Date.UTC(2026, 0, 1);     // day 0 of the daily puzzles
  var DK = (typeof window !== "undefined" && window.orosDaily) || null;        // gamekit/daily.js (share, Game Center)
  var MAX_DAY = 100000;
  var MAX_SEC = 360000;                     // 100 hours: longer times are capped
  var SOLVE_NODES = 60000;                  // solver budget per count

  // ---------- 1. Constants, i18n, helpers ----------
  // UI language: the full code (a pack language such as "de" included).
  // The word lists stay EN/EL: a pack language plays with English words.
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = window.orosI18n ? window.orosI18n.lang() : appLang();
  var WORD_LANG = LANG === "el" ? "el" : "en";
  function loc() { return window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB"); }

  var STRINGS = {
    en: {
      "btn.new": "New puzzle (Shift+N)",
      "btn.check": "Check and reveal",
      "btn.stats": "Statistics",
      "btn.theme": "Words",
      "lang.en": "EN", "lang.el": "ΕΛ",
      "lang.enLong": "English words", "lang.elLong": "Greek words",
      "mode.d": "Daily", "mode.f": "Free",
      "size.e": "Small, up to 9×9: 8–10 words",
      "size.m": "Medium, up to 13×13: 14–18 words",
      "size.h": "Large, up to 17×17: 22–28 words",
      "sizeShort.e": "9×9", "sizeShort.m": "13×13", "sizeShort.h": "17×17",
      "theme.random": "Random words",
      "theme.animals": "Animals", "theme.food": "Food", "theme.countries": "Countries",
      "theme.jobs": "Jobs", "theme.home": "Home", "theme.nature": "Nature",
      "theme.sports": "Sports", "theme.music": "Music", "theme.school": "School",
      "theme.body": "Body", "theme.clothes": "Clothes", "theme.colours": "Colours",
      "theme.transport": "Transport", "theme.weather": "Weather",
      "theme.fruitveg": "Fruit & veg", "theme.sea": "Sea", "theme.city": "City",
      "theme.tools": "Tools", "theme.feelings": "Feelings", "theme.holidays": "Holidays",
      "st.daily": "Daily #{n}",
      "st.free": "{th} · {s}",
      "st.count": "{f}/{k} words",
      "st.time": "Time",
      "st.elsewhere": "Solved on another device in {t}",
      "grid.label": "Crossword grid",
      "words.label": "Words to place",
      "words.intro": "Place every word in the grid so that the crossings agree.",
      "words.group": "{n} letters",
      "cell.label": "{l}, row {r}, column {c}",
      "cell.empty": "empty",
      "dir.0": "across", "dir.1": "down",
      "live.slot": "{n} letters {d}",
      "live.word": "{w} is in place. {f} of {k}",
      "live.done": "Crossword solved in {t}",
      "kb.label": "Keyboard",
      "kb.back": "Delete letter",
      "kb.dir": "Switch between across and down (Space)",
      "res.titleD": "Daily #{n}",
      "res.titleF": "Free play · {s}",
      "res.solved": "Solved in {t}",
      "res.record": "New record!",
      "res.hinted": "With a revealed letter: no record for this puzzle",
      "res.days": "Days solved",
      "res.streak": "Streak",
      "res.bestStreak": "Best streak",
      "res.bestDaily": "Best daily time",
      "res.solvedN": "Solved ({s})",
      "res.best": "Best time ({s})",
      "res.next": "A new daily crossword tomorrow",
      "res.share": "Share",
      "btn.games": "All games",
      "share.name": "Crossword",
      "share.daily": "Daily",
      "share.clean": "no letters revealed",
      "share.revealed": "letters revealed",
      "toast.copied": "Result copied: paste it anywhere",
      "toast.shared": "Result shared",
      "toast.copyFail": "Could not copy the result",
      "res.newPuzzle": "New puzzle",
      "res.toFree": "Free play",
      "res.close": "Close",
      "stats.title": "Statistics · {l}",
      "stats.daily": "Daily",
      "stats.free": "Free play",
      "stats.freeRow": "{n} solved · best {t}",
      "stats.freeNone": "{n} solved",
      "stats.none": "—",
      "stats.reset": "Reset statistics",
      "stats.close": "Close",
      "themes.title": "Words · {l}",
      "themes.intro": "Random common words, or the words of a theme (topped up with common words when the theme is short).",
      "themes.close": "Close",
      "check.title": "Check",
      "check.letter": "Check letter",
      "check.word": "Check word",
      "check.all": "Check all",
      "check.reveal": "Reveal letter",
      "check.note": "Wrong letters turn red. A revealed letter means no record for this puzzle.",
      "check.multi": "This puzzle has more than one solution: any filling where every word fits counts as solved.",
      "check.close": "Close",
      "confirm.reset": "Delete the statistics on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Statistics reset",
      "toast.newPuzzle": "New puzzle",
      "toast.undo": "Undo",
      "toast.wrongN": "{n} wrong letters, marked in red",
      "toast.wrong1": "1 wrong letter, marked in red",
      "toast.allOk": "No mistakes so far",
      "toast.nothing": "Nothing to check yet: type some letters first",
      "toast.emptyCell": "This cell is empty",
      "toast.given": "This letter is given",
      "toast.revealNoRecord": "Letter revealed: no record for this puzzle",
      "toast.pickCell": "Tap a cell first",
      "toast.notYet": "Every cell is filled, but some words do not fit yet",
      "toast.dailyDone": "Today's crossword is done: a new one tomorrow, or try Free play",
      "toast.over": "This crossword is done: start a new one (Shift+N)",
      "toast.dailyOne": "Daily has one crossword a day: for more, switch to Free",
      "toast.dailyFixed": "The daily crossword is the same for everyone: size and words change in Free play",
      "toast.save": "Could not save: storage is full",
      "toast.noWords": "The word list did not load",
      "btn.lib": "Imported crosswords: open or import a .puz / .ipuz file",
      "lib.title": "Imported crosswords",
      "lib.intro": "Clued crosswords from Across Lite (.puz) or ipuz (.ipuz) files. They sync like your records.",
      "lib.file": "Import a file…",
      "lib.empty": "No imported crosswords yet.",
      "lib.size": "{w}×{h}",
      "lib.best": "best {t}",
      "lib.solved": "solved",
      "lib.open": "Open",
      "lib.openLabel": "Open {t}",
      "lib.untitled": "Crossword {w}×{h}",
      "lib.close": "Close",
      "lib.short": "Imported",
      "imp.title": "Import · {s}",
      "imp.src.puz": "Across Lite (.puz)",
      "imp.src.ipuz": "ipuz",
      "imp.name": "Title",
      "imp.author": "Author",
      "imp.copy": "Copyright",
      "imp.size": "Size",
      "imp.clues": "Clues",
      "imp.cluesN": "{a} across · {d} down",
      "imp.lang": "Letters",
      "imp.rebus": "{n} squares hold more than one letter (rebus): type the first letter; the whole entry shows when solved.",
      "imp.circles": "{n} circled squares are marked.",
      "imp.have": "Already in your imported crosswords.",
      "imp.go": "Import and play",
      "imp.open": "Open it",
      "imp.cancel": "Cancel",
      "imp.done": "Crossword imported",
      "imp.undone": "Import undone",
      "imp.full": "The list is full: {n} imported crosswords at most",
      "imp.err.read": "Could not read this file",
      "imp.err.big": "This file is too large to import",
      "imp.err.unknown": "Not a crossword file: choose an Across Lite .puz or an .ipuz file",
      "imp.err.scrambled": "This puzzle is locked (scrambled) in Across Lite: unlock it there, save, and import again",
      "imp.err.nosol": "This file has no solution, so answers could not be checked",
      "imp.err.size": "Grids from 2×2 to 30×30 only",
      "imp.err.clues": "The clues do not match the grid",
      "imp.err.kind": "This ipuz file is not a crossword",
      "clues.label": "Clues",
      "clues.a": "Across",
      "clues.d": "Down",
      "clues.none": "(no clue)",
      "live.clue": "{n} {d}, {k} letters: {q}",
      "toast.notYetI": "Every square is filled, but something is not right yet: try Check",
      "toast.impFixed": "This crossword comes from a file: sizes and words are for Free play",
      "res.titleI": "Imported crossword",
      "res.lib": "Imported crosswords",
      "res.bestI": "Best time"
    },
    el: {
      "btn.new": "Νέο σταυρόλεξο (Shift+N)",
      "btn.check": "Έλεγχος και αποκάλυψη",
      "btn.stats": "Στατιστικά",
      "btn.theme": "Λέξεις",
      "lang.en": "EN", "lang.el": "ΕΛ",
      "lang.enLong": "Αγγλικές λέξεις", "lang.elLong": "Ελληνικές λέξεις",
      "mode.d": "Ημέρας", "mode.f": "Ελεύθερο",
      "size.e": "Μικρό, έως 9×9: 8–10 λέξεις",
      "size.m": "Μεσαίο, έως 13×13: 14–18 λέξεις",
      "size.h": "Μεγάλο, έως 17×17: 22–28 λέξεις",
      "sizeShort.e": "9×9", "sizeShort.m": "13×13", "sizeShort.h": "17×17",
      "theme.random": "Τυχαίες λέξεις",
      "theme.animals": "Ζώα", "theme.food": "Φαγητά", "theme.countries": "Χώρες",
      "theme.jobs": "Επαγγέλματα", "theme.home": "Σπίτι", "theme.nature": "Φύση",
      "theme.sports": "Αθλήματα", "theme.music": "Μουσική", "theme.school": "Σχολείο",
      "theme.body": "Σώμα", "theme.clothes": "Ρούχα", "theme.colours": "Χρώματα",
      "theme.transport": "Μεταφορικά", "theme.weather": "Καιρός",
      "theme.fruitveg": "Φρούτα και λαχανικά", "theme.sea": "Θάλασσα", "theme.city": "Πόλη",
      "theme.tools": "Εργαλεία", "theme.feelings": "Συναισθήματα", "theme.holidays": "Διακοπές",
      "st.daily": "Ημέρας #{n}",
      "st.free": "{th} · {s}",
      "st.count": "{f}/{k} λέξεις",
      "st.time": "Χρόνος",
      "st.elsewhere": "Λύθηκε σε άλλη συσκευή σε {t}",
      "grid.label": "Πλέγμα σταυρόλεξου",
      "words.label": "Λέξεις για τοποθέτηση",
      "words.intro": "Βάλε όλες τις λέξεις στο πλέγμα, ώστε να ταιριάζουν στις διασταυρώσεις.",
      "words.group": "{n} γράμματα",
      "cell.label": "{l}, γραμμή {r}, στήλη {c}",
      "cell.empty": "κενό",
      "dir.0": "οριζόντια", "dir.1": "κάθετα",
      "live.slot": "{n} γράμματα {d}",
      "live.word": "Το {w} μπήκε στη θέση του. {f} από {k}",
      "live.done": "Το σταυρόλεξο λύθηκε σε {t}",
      "kb.label": "Πληκτρολόγιο",
      "kb.back": "Σβήσιμο γράμματος",
      "kb.dir": "Εναλλαγή οριζόντια / κάθετα (Space)",
      "res.titleD": "Ημέρας #{n}",
      "res.titleF": "Ελεύθερο · {s}",
      "res.solved": "Λύθηκε σε {t}",
      "res.record": "Νέο ρεκόρ!",
      "res.hinted": "Με αποκάλυψη γράμματος: χωρίς ρεκόρ σε αυτό το σταυρόλεξο",
      "res.days": "Μέρες που λύθηκαν",
      "res.streak": "Σερί",
      "res.bestStreak": "Καλύτερο σερί",
      "res.bestDaily": "Καλύτερος χρόνος ημέρας",
      "res.solvedN": "Λυμένα ({s})",
      "res.best": "Καλύτερος χρόνος ({s})",
      "res.next": "Νέο σταυρόλεξο ημέρας αύριο",
      "res.share": "Κοινοποίηση",
      "btn.games": "Όλα τα παιχνίδια",
      "share.name": "Σταυρόλεξο",
      "share.daily": "Ημέρας",
      "share.clean": "χωρίς αποκάλυψη γράμματος",
      "share.revealed": "με αποκάλυψη γράμματος",
      "toast.copied": "Το αποτέλεσμα αντιγράφηκε: επικόλλησέ το όπου θες",
      "toast.shared": "Το αποτέλεσμα κοινοποιήθηκε",
      "toast.copyFail": "Δεν έγινε αντιγραφή του αποτελέσματος",
      "res.newPuzzle": "Νέο σταυρόλεξο",
      "res.toFree": "Ελεύθερο",
      "res.close": "Κλείσιμο",
      "stats.title": "Στατιστικά · {l}",
      "stats.daily": "Ημέρας",
      "stats.free": "Ελεύθερο",
      "stats.freeRow": "{n} λυμένα · καλύτερος {t}",
      "stats.freeNone": "{n} λυμένα",
      "stats.none": "—",
      "stats.reset": "Μηδενισμός στατιστικών",
      "stats.close": "Κλείσιμο",
      "themes.title": "Λέξεις · {l}",
      "themes.intro": "Τυχαίες συνηθισμένες λέξεις, ή οι λέξεις ενός θέματος (με λίγες συνηθισμένες λέξεις επιπλέον, όταν το θέμα δεν φτάνει).",
      "themes.close": "Κλείσιμο",
      "check.title": "Έλεγχος",
      "check.letter": "Έλεγχος γράμματος",
      "check.word": "Έλεγχος λέξης",
      "check.all": "Έλεγχος όλων",
      "check.reveal": "Αποκάλυψη γράμματος",
      "check.note": "Τα λάθος γράμματα γίνονται κόκκινα. Με αποκάλυψη γράμματος δεν μετράει ρεκόρ σε αυτό το σταυρόλεξο.",
      "check.multi": "Αυτό το σταυρόλεξο έχει πάνω από μία λύση: μετράει κάθε συμπλήρωση όπου ταιριάζουν όλες οι λέξεις.",
      "check.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα στατιστικά σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα στατιστικά μηδενίστηκαν",
      "toast.newPuzzle": "Νέο σταυρόλεξο",
      "toast.undo": "Αναίρεση",
      "toast.wrongN": "Λάθος γράμματα: {n}, σημειώθηκαν με κόκκινο",
      "toast.wrong1": "Ένα γράμμα είναι λάθος, σημειώθηκε με κόκκινο",
      "toast.allOk": "Κανένα λάθος ως τώρα",
      "toast.nothing": "Δεν υπάρχει κάτι για έλεγχο: γράψε πρώτα μερικά γράμματα",
      "toast.emptyCell": "Το κελί είναι κενό",
      "toast.given": "Αυτό το γράμμα είναι δοσμένο",
      "toast.revealNoRecord": "Αποκάλυψη γράμματος: χωρίς ρεκόρ σε αυτό το σταυρόλεξο",
      "toast.pickCell": "Διάλεξε πρώτα ένα κελί",
      "toast.notYet": "Όλα τα κελιά είναι γεμάτα, αλλά κάποιες λέξεις δεν ταιριάζουν ακόμα",
      "toast.dailyDone": "Το σταυρόλεξο της ημέρας τελείωσε: νέο αύριο, ή δοκίμασε το Ελεύθερο",
      "toast.over": "Αυτό το σταυρόλεξο τελείωσε: ξεκίνα νέο (Shift+N)",
      "toast.dailyOne": "Το Ημέρας έχει ένα σταυρόλεξο τη μέρα: για περισσότερα, πήγαινε στο Ελεύθερο",
      "toast.dailyFixed": "Το σταυρόλεξο της ημέρας είναι ίδιο για όλους: μέγεθος και λέξεις αλλάζουν στο Ελεύθερο",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "toast.noWords": "Η λίστα λέξεων δεν φορτώθηκε",
      "btn.lib": "Σταυρόλεξα από εισαγωγή: άνοιγμα ή εισαγωγή αρχείου .puz / .ipuz",
      "lib.title": "Σταυρόλεξα από εισαγωγή",
      "lib.intro": "Σταυρόλεξα με ορισμούς από αρχεία Across Lite (.puz) ή ipuz (.ipuz). Συγχρονίζονται όπως τα ρεκόρ σου.",
      "lib.file": "Εισαγωγή αρχείου…",
      "lib.empty": "Δεν υπάρχουν ακόμα σταυρόλεξα από εισαγωγή.",
      "lib.size": "{w}×{h}",
      "lib.best": "ρεκόρ {t}",
      "lib.solved": "λυμένο",
      "lib.open": "Άνοιγμα",
      "lib.openLabel": "Άνοιγμα: {t}",
      "lib.untitled": "Σταυρόλεξο {w}×{h}",
      "lib.close": "Κλείσιμο",
      "lib.short": "Από εισαγωγή",
      "imp.title": "Εισαγωγή · {s}",
      "imp.src.puz": "Across Lite (.puz)",
      "imp.src.ipuz": "ipuz",
      "imp.name": "Τίτλος",
      "imp.author": "Δημιουργός",
      "imp.copy": "Πνευματικά δικαιώματα",
      "imp.size": "Μέγεθος",
      "imp.clues": "Ορισμοί",
      "imp.cluesN": "{a} οριζόντια · {d} κάθετα",
      "imp.lang": "Γράμματα",
      "imp.rebus": "{n} τετράγωνα έχουν πάνω από ένα γράμμα (rebus): γράψε το πρώτο γράμμα· όλη η λέξη φαίνεται όταν λυθεί.",
      "imp.circles": "{n} τετράγωνα με κύκλο είναι σημειωμένα.",
      "imp.have": "Υπάρχει ήδη στα σταυρόλεξα από εισαγωγή.",
      "imp.go": "Εισαγωγή και παιχνίδι",
      "imp.open": "Άνοιγμα",
      "imp.cancel": "Άκυρο",
      "imp.done": "Το σταυρόλεξο εισήχθη",
      "imp.undone": "Η εισαγωγή αναιρέθηκε",
      "imp.full": "Η λίστα γέμισε: έως {n} σταυρόλεξα από εισαγωγή",
      "imp.err.read": "Δεν ήταν δυνατή η ανάγνωση του αρχείου",
      "imp.err.big": "Το αρχείο είναι πολύ μεγάλο για εισαγωγή",
      "imp.err.unknown": "Δεν είναι αρχείο σταυρόλεξου: διάλεξε αρχείο Across Lite .puz ή .ipuz",
      "imp.err.scrambled": "Το σταυρόλεξο είναι κλειδωμένο (scrambled) στο Across Lite: ξεκλείδωσέ το εκεί, αποθήκευσε και κάνε ξανά εισαγωγή",
      "imp.err.nosol": "Το αρχείο δεν έχει λύση, οπότε οι απαντήσεις δεν μπορούν να ελεγχθούν",
      "imp.err.size": "Μόνο πλέγματα από 2×2 έως 30×30",
      "imp.err.clues": "Οι ορισμοί δεν ταιριάζουν με το πλέγμα",
      "imp.err.kind": "Αυτό το αρχείο ipuz δεν είναι σταυρόλεξο",
      "clues.label": "Ορισμοί",
      "clues.a": "Οριζόντια",
      "clues.d": "Κάθετα",
      "clues.none": "(χωρίς ορισμό)",
      "live.clue": "{n} {d}, {k} γράμματα: {q}",
      "toast.notYetI": "Όλα τα τετράγωνα είναι γεμάτα, αλλά κάτι δεν είναι σωστό ακόμα: δοκίμασε τον Έλεγχο",
      "toast.impFixed": "Αυτό το σταυρόλεξο είναι από αρχείο: μεγέθη και λέξεις αλλάζουν στο Ελεύθερο",
      "res.titleI": "Σταυρόλεξο από εισαγωγή",
      "res.lib": "Σταυρόλεξα από εισαγωγή",
      "res.bestI": "Καλύτερος χρόνος"
    }
  };

  if (window.orosI18n) window.orosI18n.table(STRINGS, "crossword", LANG);

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

  // crypto RNG with rejection sampling (same as Dice / Memory / Wordle)
  function randInt(n) {
    var buf = new Uint32Array(1);
    var lim = 0xFFFFFFFF - (0xFFFFFFFF % n);
    while (true) {
      crypto.getRandomValues(buf);
      if (buf[0] < lim) return buf[0] % n;
    }
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("crossword.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Puzzle model ----------
  // Upper case, no accents or diaeresis, final sigma as Σ, letters only.
  function normWord(s) {
    s = String(s || "");
    if (s.normalize) s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return s.toUpperCase().replace(/ς/g, "Σ").replace(/[^A-ZΑ-Ω]/g, "");
  }

  // Seeded random numbers: FNV-1a hash of a string → mulberry32 stream
  // (same as Word Search and Wordle).
  function hashStr(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  function seeded(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffled(list, rng) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1)), x = a[i];
      a[i] = a[j]; a[j] = x;
    }
    return a;
  }

  // Cell indexes of a placed word { w, r, c, d } (d 0 = across, 1 = down)
  // in a grid of `cols` columns.
  function cellsOf(p, cols) {
    var out = [];
    for (var i = 0; i < p.w.length; i++) out.push(p.d ? (p.r + i) * cols + p.c : p.r * cols + p.c + i);
    return out;
  }

  // Can w go at (r, c) in direction d of an n×n layout? Crossings only
  // where the letters agree and the other word runs the other way, the
  // cells before and after stay empty, and a new letter never touches
  // another word side by side (so no stray words appear). Returns the
  // number of crossings, or -1.
  function canPlace(cells, own, n, w, r, c, d) {
    var dr = d ? 1 : 0, dc = d ? 0 : 1, L = w.length;
    var r2 = r + dr * (L - 1), c2 = c + dc * (L - 1);
    if (r < 0 || c < 0 || r2 >= n || c2 >= n) return -1;
    function full(y, x) { return y >= 0 && x >= 0 && y < n && x < n && cells[y * n + x] !== ""; }
    if (full(r - dr, c - dc) || full(r2 + dr, c2 + dc)) return -1;
    var cross = 0;
    for (var i = 0; i < L; i++) {
      var y = r + dr * i, x = c + dc * i, ch = cells[y * n + x];
      if (ch !== "") {
        if (ch !== w[i] || (own[y * n + x] & (1 << d))) return -1;
        cross++;
      } else if (full(y + dc, x + dr) || full(y - dc, x - dr)) return -1;
    }
    return cross === L ? -1 : cross;
  }

  // Every place where w crosses the words already in the layout:
  // [r, c, d, crossings].
  function spots(cells, own, n, filled, w) {
    var out = [], seen = {};
    filled.forEach(function (ix) {
      if (own[ix] === 3) return;
      var d = own[ix] === 1 ? 1 : 0, y = Math.floor(ix / n), x = ix % n;
      for (var i = 0; i < w.length; i++) {
        if (w[i] !== cells[ix]) continue;
        var r = d ? y - i : y, c = d ? x : x - i, key = (r * 64 + c) * 2 + d;
        if (seen[key]) continue;
        seen[key] = true;
        var k = canPlace(cells, own, n, w, r, c, d);
        if (k > 0) out.push([r, c, d, k]);
      }
    });
    return out;
  }

  // A connected crossing layout in an n×n box: the first word in the
  // middle, then each step places, of up to 12 words that fit, the one
  // with the most crossings. Words of `primary` come first, `secondary`
  // only tops up. Deterministic for one rng stream.
  function layout(primary, secondary, lv, rng) {
    var n = lv.n, best = null;
    function usable(list) {
      var out = [], seen = {};
      list.forEach(function (w) { if (w.length >= 3 && w.length <= n && !seen[w]) { seen[w] = true; out.push(w); } });
      return out;
    }
    var prim = usable(primary), sec = usable(secondary).filter(function (w) { return prim.indexOf(w) < 0; });
    if (!prim.length && !sec.length) return null;
    for (var attempt = 0; attempt < 12; attempt++) {
      var k = lv.lo + Math.floor(rng() * (lv.hi - lv.lo + 1));
      var cells = [], own = [], filled = [], placed = [], used = {}, i;
      for (i = 0; i < n * n; i++) { cells.push(""); own.push(0); }
      var put = function (w, r, c, d) {
        var p = { w: w, r: r, c: c, d: d };
        cellsOf(p, n).forEach(function (ix, j) {
          if (cells[ix] === "") filled.push(ix);
          cells[ix] = w[j];
          own[ix] |= (1 << d);
        });
        placed.push(p);
        used[w] = true;
      };
      // first word: a long one across or down through the middle
      var src = prim.length ? prim : sec, longest = 0;
      src.forEach(function (w) { if (w.length > longest) longest = w.length; });
      var want = Math.min(longest, Math.max(4, Math.ceil(n * 0.55)));
      var firsts = src.filter(function (w) { return w.length >= want; });
      var w0 = firsts[Math.floor(rng() * firsts.length)], d0 = rng() < 0.5 ? 0 : 1;
      var along = Math.floor((n - w0.length) / 2) + Math.floor(rng() * 3) - 1;
      along = Math.max(0, Math.min(n - w0.length, along));
      var mid = Math.floor(n / 2);
      put(w0, d0 ? along : mid, d0 ? mid : along, d0);
      var step = function (list) {
        var order = shuffled(list.filter(function (w) { return !used[w]; }), rng), pick = null, tried = 0;
        for (var j = 0; j < order.length && tried < 12; j++) {
          var opts = spots(cells, own, n, filled, order[j]);
          if (!opts.length) continue;
          tried++;
          for (var q = 0; q < opts.length; q++) {
            var s = opts[q][3] * 4 + rng() * 3;
            if (!pick || s > pick.s) pick = { w: order[j], r: opts[q][0], c: opts[q][1], d: opts[q][2], s: s };
          }
        }
        return pick;
      };
      while (placed.length < k) {
        var o = step(prim) || step(sec);
        if (!o) break;
        put(o.w, o.r, o.c, o.d);
      }
      if (!best || placed.length > best.length) best = placed;
      if (placed.length >= lv.lo) break;
    }
    return best;
  }

  // Crop a layout to its bounding box: { rows, cols, words (sorted by
  // length, then alphabet), sol } where sol has "." for empty cells.
  function crop(placed) {
    var r0 = 1e9, c0 = 1e9, r1 = -1, c1 = -1;
    placed.forEach(function (p) {
      r0 = Math.min(r0, p.r); c0 = Math.min(c0, p.c);
      r1 = Math.max(r1, p.d ? p.r + p.w.length - 1 : p.r);
      c1 = Math.max(c1, p.d ? p.c : p.c + p.w.length - 1);
    });
    var rows = r1 - r0 + 1, cols = c1 - c0 + 1, sol = [], i;
    for (i = 0; i < rows * cols; i++) sol.push(BLOCK);
    var words = placed.map(function (p) { return { w: p.w, r: p.r - r0, c: p.c - c0, d: p.d }; })
      .sort(function (a, b) { return a.w.length - b.w.length || cmpStr(a.w, b.w); });
    words.forEach(function (p) { cellsOf(p, cols).forEach(function (ix, j) { sol[ix] = p.w[j]; }); });
    return { rows: rows, cols: cols, words: words, sol: sol.join("") };
  }

  // Count the ways to put the words in the slots so that every crossing
  // agrees and the given cells hold their letters (up to `limit`). Each
  // word is used once; the most constrained slot goes first. Returns
  // { n, sols: [[word index per slot]], cut } (cut = budget ran out).
  function solve(pz, giv, limit) {
    var cols = pz.cols, slots = pz.words.map(function (p) { return cellsOf(p, cols); });
    var letters = [], cnt = [], usedW = [], assign = [], sols = [], nodes = 0, cut = false, i;
    for (i = 0; i < pz.sol.length; i++) { letters.push(""); cnt.push(0); }
    giv.forEach(function (ix) { letters[ix] = pz.sol[ix]; cnt[ix] = 1; });
    for (i = 0; i < slots.length; i++) { usedW.push(false); assign.push(-1); }
    function fits(si, wi) {
      var w = pz.words[wi].w, cs = slots[si];
      if (w.length !== cs.length) return false;
      for (var j = 0; j < cs.length; j++) if (letters[cs[j]] && letters[cs[j]] !== w[j]) return false;
      return true;
    }
    function rec() {
      if (sols.length >= limit || cut) return;
      if (++nodes > SOLVE_NODES) { cut = true; return; }
      var bestS = -1, bestC = null;
      for (var s = 0; s < slots.length; s++) {
        if (assign[s] >= 0) continue;
        var cand = [];
        for (var w = 0; w < pz.words.length; w++) if (!usedW[w] && fits(s, w)) cand.push(w);
        if (!cand.length) return;
        if (!bestC || cand.length < bestC.length) { bestS = s; bestC = cand; }
        if (cand.length === 1) break;
      }
      if (bestS < 0) { sols.push(assign.slice()); return; }
      var cs = slots[bestS];
      for (var k = 0; k < bestC.length && sols.length < limit && !cut; k++) {
        var wd = pz.words[bestC[k]].w;
        assign[bestS] = bestC[k]; usedW[bestC[k]] = true;
        for (var j = 0; j < cs.length; j++) { cnt[cs[j]]++; letters[cs[j]] = wd[j]; }
        rec();
        for (j = 0; j < cs.length; j++) if (--cnt[cs[j]] === 0) letters[cs[j]] = "";
        assign[bestS] = -1; usedW[bestC[k]] = false;
      }
    }
    rec();
    return { n: sols.length, sols: sols, cut: cut };
  }

  // The letter grid of a solver solution.
  function solLetters(pz, assign) {
    var out = pz.sol.split("").map(function (ch) { return ch === BLOCK ? BLOCK : ""; });
    assign.forEach(function (wi, si) {
      var w = pz.words[wi].w;
      cellsOf(pz.words[si], pz.cols).forEach(function (ix, j) { out[ix] = w[j]; });
    });
    return out;
  }

  // Given letters: the first on a crossing of the most crossed word (like
  // printed kriss-kross puzzles), then, while two solutions exist and
  // fewer than lv.giv letters are given, one where they differ.
  // Returns { giv (sorted), uq }.
  function chooseGivens(pz, lv, rng) {
    var cols = pz.cols, cover = [], i;
    for (i = 0; i < pz.sol.length; i++) cover.push(0);
    pz.words.forEach(function (p) { cellsOf(p, cols).forEach(function (ix) { cover[ix]++; }); });
    var most = -1, tops = [];
    pz.words.forEach(function (p, wi) {
      var x = cellsOf(p, cols).filter(function (ix) { return cover[ix] > 1; }).length;
      if (x > most) { most = x; tops = [wi]; } else if (x === most) tops.push(wi);
    });
    var top = pz.words[tops[Math.floor(rng() * tops.length)]];
    var crossings = cellsOf(top, cols).filter(function (ix) { return cover[ix] > 1; });
    var giv = [crossings[Math.floor(rng() * crossings.length)]], uq = false;
    while (true) {
      var r = solve(pz, giv, 2);
      if (r.n === 1 && !r.cut) { uq = true; break; }
      if (r.n < 2 || giv.length >= lv.giv) break;
      var a = solLetters(pz, r.sols[0]), b = solLetters(pz, r.sols[1]), diff = [];
      for (i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
      if (!diff.length) break;
      giv.push(diff[Math.floor(rng() * diff.length)]);
    }
    return { giv: giv.sort(function (x, y) { return x - y; }), uq: uq };
  }

  // Random common words for a level, a few times more than needed.
  function randomPool(common, lv, rng) {
    var out = [], seen = {}, tries = 0;
    while (out.length < lv.hi * 5 && tries < lv.hi * 60) {
      tries++;
      var len = lv.lens[Math.floor(rng() * lv.lens.length)], list = common[len] || [];
      if (!list.length) continue;
      var w = list[Math.floor(rng() * list.length)];
      if (!seen[w]) { seen[w] = true; out.push(w); }
    }
    return out;
  }

  // A puzzle for a level: up to 8 layouts until one has a unique
  // solution; otherwise the first one (uq false, any valid filling
  // counts). Returns { rows, cols, words[{w, r, c, d}], sol, giv[], uq }
  // or null.
  function buildPuzzle(L, size, theme, rng) {
    var lv = LEVELS[size], pool = randomPool(L.common, lv, rng), first = null;
    var prim = theme === "random" ? pool : (L.themes[theme] || []);
    var sec = theme === "random" ? [] : pool;
    for (var tries = 0; tries < 8; tries++) {
      var placed = layout(prim, sec, lv, rng);
      if (!placed || placed.length < 2) return first;
      var pz = crop(placed), g = chooseGivens(pz, lv, rng);
      pz.giv = g.giv; pz.uq = g.uq;
      if (pz.uq && placed.length >= lv.lo) return pz;
      if (!first || (placed.length >= lv.lo && first.words.length < lv.lo)) first = pz;
    }
    return first;
  }

  // Day number of a local date (day 0 = 1 Jan 2026), same everywhere for
  // the same calendar day.
  function dayIndex(d) {
    return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH_UTC) / 86400000);
  }
  // The daily puzzle: random common words from the date and the language.
  function dailyPuzzle(L, lang, day) {
    return buildPuzzle(L, DAILY_SIZE, "random", seeded(hashStr("crossword:" + lang + ":" + day)));
  }

  // ---------- Grid helpers (pure) ----------
  // The slot (word index) across and down through each cell: [[a, d]].
  function slotMap(words, rows, cols) {
    var out = [], i;
    for (i = 0; i < rows * cols; i++) out.push([-1, -1]);
    words.forEach(function (p, wi) { cellsOf(p, cols).forEach(function (ix) { out[ix][p.d] = wi; }); });
    return out;
  }
  function readSlot(fill, p, cols) {
    return cellsOf(p, cols).map(function (ix) { return fill[ix]; }).join("");
  }
  // Words whose slot holds exactly their own word.
  function placedWords(fill, words, cols) {
    var out = [];
    words.forEach(function (p, i) { if (readSlot(fill, p, cols) === p.w) out.push(i); });
    return out;
  }
  // Solved: every cell filled and the slots read the word list exactly
  // (any order: a second valid solution counts too).
  function isSolved(fill, words, cols) {
    if (fill.indexOf(EMPTY) >= 0) return false;
    var left = {};
    words.forEach(function (p) { left[p.w] = (left[p.w] || 0) + 1; });
    for (var i = 0; i < words.length; i++) {
      var s = readSlot(fill, words[i], cols);
      if (!left[s]) return false;
      left[s]--;
    }
    return true;
  }
  // Filled cells among ixs that differ from the solution.
  function wrongCells(fill, sol, ixs) {
    return ixs.filter(function (ix) { return fill[ix] !== EMPTY && fill[ix] !== BLOCK && fill[ix] !== sol[ix]; });
  }
  // The next letter cell from ix in the direction (dr, dc), jumping over
  // empty squares; -1 when there is none.
  function nextCell(sol, rows, cols, ix, dr, dc) {
    var r = Math.floor(ix / cols) + dr, c = ix % cols + dc;
    while (r >= 0 && c >= 0 && r < rows && c < cols) {
      if (sol[r * cols + c] !== BLOCK) return r * cols + c;
      r += dr; c += dc;
    }
    return -1;
  }
  function setCh(s, ix, ch) { return s.slice(0, ix) + ch + s.slice(ix + 1); }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    var ss = (s < 10 ? "0" : "") + s;
    return h ? h + ":" + (m < 10 ? "0" : "") + m + ":" + ss : m + ":" + ss;
  }

  // Current and best streak of solved days from a { day: … } map; the
  // current streak counts back from today, or from yesterday when today
  // is not solved yet.
  function streaks(days, today) {
    var keys = Object.keys(days).map(Number).sort(function (a, b) { return a - b; });
    var cur = 0, d = days[today] ? today : today - 1;
    while (days[d]) { cur++; d--; }
    var best = 0, run = 0, prev = null;
    keys.forEach(function (k) {
      run = (prev !== null && k === prev + 1) ? run + 1 : 1;
      if (run > best) best = run;
      prev = k;
    });
    return { cur: cur, best: best };
  }

  // ---------- Word lists ----------
  var LISTS = {};      // lang → { common: { len: [...] }, themes: { id: [...] } }
  function splitList(s) { return String(s || "").split(" ").filter(function (w) { return w; }); }
  function lists(lang) {
    if (LISTS[lang]) return LISTS[lang];
    var src = window.WORDSEARCH_WORDS && window.WORDSEARCH_WORDS[lang];
    if (!src || !src.common || !src.themes) return null;
    var common = {}, themes = {};
    Object.keys(src.common).forEach(function (k) { common[k] = splitList(src.common[k]); });
    THEME_IDS.forEach(function (id) { themes[id] = splitList(src.themes[id]); });
    LISTS[lang] = { common: common, themes: themes };
    return LISTS[lang];
  }

  // ---------- 3. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                     // max-merged
  //   days: { "en:<day>"|"el:<day>": { b: <epoch>, t: seconds, h: 0|1 revealed } },
  //   rows: { <deviceId>: { b: <epoch>, s: { "<lang>:<size>": { n, t, d } } } },
  //   lib?: { "imp-…": { z: puzzle, b, x, s, t } }   // imported (import.js)
  // }
  // lib is only present when it holds something; a records reset (br)
  // leaves it alone.
  // Daily: one result per day and language; the newer epoch wins, equal
  // epochs keep the better result (no revealed letter first, then the
  // shorter time). Free play: each device only grows its own row: solved
  // n (max) and the best time t in seconds with its date d (0/0 = none
  // yet; the shorter time wins, then the earlier date). Entries older
  // than br drop. A join: symmetric, associative, idempotent (R5, R26).
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, days: {}, rows: {} }; }

  function normDayRes(v) {
    if (!v || typeof v !== "object" || !isInt(v.b) || v.b < 0 || !isInt(v.t) || v.t < 1 || v.t > MAX_SEC ||
        (v.h !== 0 && v.h !== 1)) return null;
    return { b: v.b, t: v.t, h: v.h };
  }
  function dayKeyOk(k) {
    var m = /^(en|el):(-?\d+)$/.exec(k);
    return !!m && Math.abs(+m[2]) <= MAX_DAY;
  }
  // Is daily result x better than y (same epoch)?
  function betterDay(x, y) {
    if (x.h !== y.h) return x.h < y.h;
    return x.t < y.t;
  }

  function statKeyOk(k) { return /^(en|el):(e|m|h)$/.test(k); }
  function normStat(c) {
    if (!c || typeof c !== "object" || !isInt(c.n) || c.n < 1 || !isInt(c.t) || c.t < 0 || c.t > MAX_SEC ||
        !isInt(c.d) || c.d < 0 || (c.t === 0) !== (c.d === 0)) return null;
    return { n: c.n, t: c.t, d: c.d };
  }
  function joinStat(a, c) {
    var best = a;
    if (a.t === 0 || (c.t !== 0 && (c.t < a.t || (c.t === a.t && c.d < a.d)))) best = c;
    return { n: Math.max(a.n, c.n), t: best.t, d: best.d };
  }
  function normRow(row) {
    if (!row || typeof row !== "object" || !isInt(row.b) || row.b < 0 || !row.s || typeof row.s !== "object") return null;
    var s = {}, any = false;
    Object.keys(row.s).sort(cmpStr).forEach(function (k) {
      var c = statKeyOk(k) ? normStat(row.s[k]) : null;
      if (c) { s[k] = c; any = true; }
    });
    return any ? { b: row.b, s: s } : null;
  }
  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var s = {};
    Object.keys(x.s).concat(Object.keys(y.s)).sort(cmpStr).forEach(function (k) {
      if (s[k]) return;
      var a = x.s[k], c = y.s[k];
      s[k] = (a && c) ? joinStat(a, c) : (a || c);
    });
    return { b: x.b, s: s };
  }

  function mergeCW(A, B) {
    var a = A || {}, b = B || {};
    var br = Math.max(isInt(a.br) && a.br > 0 ? a.br : 0, isInt(b.br) && b.br > 0 ? b.br : 0);
    var days = {}, rows = {};
    [a.days, b.days].forEach(function (m) {
      if (!m || typeof m !== "object") return;
      Object.keys(m).forEach(function (k) {
        var v = dayKeyOk(k) ? normDayRes(m[k]) : null;
        if (!v || v.b < br) return;
        var o = days[k];
        if (!o || v.b > o.b || (v.b === o.b && betterDay(v, o))) days[k] = v;
      });
    });
    [a.rows, b.rows].forEach(function (m) {
      if (!m || typeof m !== "object") return;
      Object.keys(m).forEach(function (id) {
        if (!/^[a-z0-9]{6,32}$/.test(id)) return;
        var r = normRow(m[id]);
        if (!r || r.b < br) return;
        rows[id] = rows[id] ? joinRows(rows[id], r) : r;
      });
    });
    var sd = {}, sr = {};
    Object.keys(days).sort(cmpStr).forEach(function (k) { sd[k] = days[k]; });
    Object.keys(rows).sort(cmpStr).forEach(function (id) { sr[id] = rows[id]; });
    var out = { ver: DATA_VER, br: br, days: sd, rows: sr };
    var lib = libJoin(a.lib, b.lib);
    if (lib) out.lib = lib;
    return out;
  }
  // The imported crosswords' join (import.js). Without the module (it
  // did not load) the library is carried over untouched, never dropped.
  function libJoin(x, y) {
    var m = typeof window !== "undefined" && window.OrosCrosswordImport;
    if (m) return m.mergeLib(x, y);
    var keep = x && typeof x === "object" ? x : (y && typeof y === "object" ? y : null);
    return keep && Object.keys(keep).length ? keep : null;
  }

  // { day: result } for one language.
  function daysOf(lang) {
    var out = {};
    Object.keys(data.days).forEach(function (k) {
      if (k.indexOf(lang + ":") === 0) out[+k.slice(3)] = data.days[k];
    });
    return out;
  }
  function dailyStats(lang, today) {
    var d = daysOf(lang), n = 0, bt = 0;
    Object.keys(d).forEach(function (k) {
      n++;
      if (!d[k].h && (!bt || d[k].t < bt)) bt = d[k].t;
    });
    var s = streaks(d, today);
    return { n: n, t: bt, cur: s.cur, best: s.best };
  }
  // Free play records for language × size, all devices together.
  function freeStats(lang, size) {
    var out = { n: 0, t: 0, d: 0 }, k = lang + ":" + size;
    Object.keys(data.rows).forEach(function (id) {
      var c = data.rows[id].s[k];
      if (!c) return;
      out.n += c.n;
      if (c.t && (!out.t || c.t < out.t || (c.t === out.t && c.d < out.d))) { out.t = c.t; out.d = c.d; }
    });
    return out;
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          data = mergeCW(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] crossword: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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

  // Count a solved puzzle; returns true for a new record (Free play).
  function countGame(g, sec) {
    sec = Math.min(MAX_SEC, Math.max(1, Math.round(sec)));
    var record = false;
    if (g.mode === "i") {
      // imported: its own solved stamp and best time in the library
      var e = data.lib && data.lib[g.id], IM = window.OrosCrosswordImport;
      if (!e || !IM) return false;
      record = !g.hinted && (!e.t || sec < e.t);
      data.lib = IM.solved(data.lib, g.id, sec, g.hinted, Date.now()) || data.lib;
    } else if (g.mode === "d") {
      var k = g.lang + ":" + g.day, o = data.days[k], v = { b: data.br, t: sec, h: g.hinted ? 1 : 0 };
      if (!o || o.b < data.br || betterDay(v, o)) data.days[k] = v;
    } else {
      var row = data.rows[deviceId];
      if (!row || row.b < data.br) row = { b: data.br, s: {} };   // new epoch after a reset
      row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
      var key = g.lang + ":" + g.size, c = row.s[key] || { n: 0, t: 0, d: 0 };
      var before = freeStats(g.lang, g.size).t;
      c.n++;
      if (!g.hinted && (!c.t || sec < c.t)) { c.t = sec; c.d = Date.now(); }
      record = !g.hinted && (!before || sec < before);
      row.s[key] = c;
      data.rows[deviceId] = row;
    }
    data = mergeCW(data, data);
    save();
    return record;
  }

  // ---------- 4. Device-local prefs + session ----------
  // mode "i" = an imported crossword (imp = its library id).
  var prefs = { lang: WORD_LANG, mode: "d", size: "m", theme: "random", imp: "" };

  function themeOk(th) { return th === "random" || THEME_IDS.indexOf(th) >= 0; }
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (LANGS.indexOf(p.lang) >= 0) prefs.lang = p.lang;
        if (MODES.indexOf(p.mode) >= 0) prefs.mode = p.mode;
        if (SIZES.indexOf(p.size) >= 0) prefs.size = p.size;
        if (typeof p.theme === "string" && themeOk(p.theme)) prefs.theme = p.theme;
        if (p.mode === "i" && typeof p.imp === "string" && /^imp-[a-z0-9]{1,16}$/.test(p.imp)) { prefs.mode = "i"; prefs.imp = p.imp; }
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // One puzzle per language and mode (key "<lang>:<mode>"), and per
  // imported crossword (key "i:<id>", only the play state: the puzzle
  // itself comes from the library, see impGame):
  // { lang, mode, day, size, theme, rows, cols, sol, words[{w,r,c,d}],
  //   giv[], uq, fill, bad[], rev[], cur, dir, hinted, ms, done, ext }
  // sol / fill: one character per cell ("." no cell, "-" empty in fill);
  // bad: cells a check marked wrong; rev: revealed cells; cur / dir: the
  // cursor; ext: solved on another device (shown solved here).
  var sessions = {};
  var game = null;

  function idxList(a, size, ok) {
    if (!Array.isArray(a) || a.length > size) return false;
    var seen = {};
    for (var i = 0; i < a.length; i++) {
      if (!isInt(a[i]) || a[i] < 0 || a[i] >= size || seen[a[i]] || !ok(a[i])) return false;
      seen[a[i]] = true;
    }
    return true;
  }
  function validGame(g, key) {
    if (!g || typeof g !== "object" || LANGS.indexOf(g.lang) < 0 || MODES.indexOf(g.mode) < 0 ||
        key !== g.lang + ":" + g.mode || SIZES.indexOf(g.size) < 0 || !isInt(g.day) ||
        typeof g.theme !== "string" || !themeOk(g.theme) || !isInt(g.rows) || !isInt(g.cols) ||
        g.rows < 1 || g.cols < 1 || g.rows > LEVELS[g.size].n || g.cols > LEVELS[g.size].n ||
        typeof g.sol !== "string" || g.sol.length !== g.rows * g.cols ||
        typeof g.fill !== "string" || g.fill.length !== g.sol.length ||
        !Array.isArray(g.words) || g.words.length < 2 || g.words.length > 40 ||
        typeof g.uq !== "boolean" || !isInt(g.cur) || (g.dir !== 0 && g.dir !== 1) ||
        typeof g.hinted !== "boolean" || !isInt(g.ms) || g.ms < 0 ||
        typeof g.done !== "boolean" || typeof g.ext !== "boolean") return false;
    var letters = LETTERS[g.lang], size = g.sol.length, i;
    for (i = 0; i < size; i++) {
      var s = g.sol[i], f = g.fill[i];
      if (s === BLOCK) { if (f !== BLOCK) return false; continue; }
      if (letters.indexOf(s) < 0 || (f !== EMPTY && letters.indexOf(f) < 0)) return false;
    }
    var cover = [];
    for (i = 0; i < size; i++) cover.push(0);
    for (i = 0; i < g.words.length; i++) {
      var p = g.words[i];
      if (!p || typeof p.w !== "string" || !WORD_RE[g.lang].test(p.w) || !isInt(p.r) || !isInt(p.c) ||
          (p.d !== 0 && p.d !== 1) || p.r < 0 || p.c < 0 ||
          (p.d ? p.r + p.w.length > g.rows : p.c + p.w.length > g.cols) || p.r >= g.rows || p.c >= g.cols) return false;
      var cs = cellsOf(p, g.cols);
      for (var j = 0; j < cs.length; j++) { if (g.sol[cs[j]] !== p.w[j]) return false; cover[cs[j]]++; }
    }
    for (i = 0; i < size; i++) if ((g.sol[i] === BLOCK) !== (cover[i] === 0)) return false;
    var letterCell = function (ix) { return g.sol[ix] !== BLOCK; };
    if (!idxList(g.giv, size, function (ix) { return letterCell(ix) && g.fill[ix] === g.sol[ix]; }) || !g.giv.length) return false;
    if (!idxList(g.rev, size, function (ix) { return letterCell(ix) && g.fill[ix] === g.sol[ix]; })) return false;
    if (!idxList(g.bad, size, function (ix) { return letterCell(ix) && g.fill[ix] !== EMPTY; })) return false;
    return g.cur >= 0 && g.cur < size && letterCell(g.cur);
  }
  function loadSessions() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (s && typeof s === "object") {
        Object.keys(s).forEach(function (k) {
          if (/^i:imp-[a-z0-9]{1,16}$/.test(k)) { if (s[k] && typeof s[k] === "object") sessions[k] = s[k]; }
          else if (validGame(s[k], k)) sessions[k] = s[k];
        });
      }
    } catch (e) {}
  }
  function sessKey(g) { return g.mode === "i" ? "i:" + g.id : g.lang + ":" + g.mode; }
  // The play state of an imported crossword (what the session keeps).
  function impState(g) {
    return { id: g.id, fill: g.fill, bad: g.bad, rev: g.rev, cur: g.cur, dir: g.dir, hinted: g.hinted, ms: g.ms, done: g.done };
  }
  function saveSessions() {
    if (game) {
      foldTime();
      sessions[sessKey(game)] = game.mode === "i" ? impState(game) : game;
    }
    // imported states only while their crossword is in the list
    Object.keys(sessions).forEach(function (k) {
      if (k.indexOf("i:") === 0 && !libEntry(k.slice(2))) delete sessions[k];
    });
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(sessions)); } catch (e) {}
  }

  // ---------- 5. Game flow ----------
  function today() { return dayIndex(new Date()); }

  // The fill with only the given letters.
  function startFill(sol, giv) {
    var f = sol.split("").map(function (ch) { return ch === BLOCK ? BLOCK : EMPTY; });
    giv.forEach(function (ix) { f[ix] = sol[ix]; });
    return f.join("");
  }

  function freshGame(lang, mode, size, theme) {
    var L = lists(lang);
    if (!L) return null;
    var d = today(), pz;
    if (mode === "d") {
      pz = dailyPuzzle(L, lang, d);
      size = DAILY_SIZE;
      theme = "random";
    } else {
      pz = buildPuzzle(L, size, theme, seeded(randInt(0x7fffffff)));
    }
    if (!pz) return null;
    var g = { lang: lang, mode: mode, day: d, size: size, theme: theme, rows: pz.rows, cols: pz.cols,
      sol: pz.sol, words: pz.words, giv: pz.giv, uq: pz.uq, fill: startFill(pz.sol, pz.giv),
      bad: [], rev: [], cur: 0, dir: 0, hinted: false, ms: 0, done: false, ext: false };
    // the cursor starts on the first empty cell of the first long word
    var first = pz.words[pz.words.length - 1], cs = cellsOf(first, pz.cols);
    g.dir = first.d;
    g.cur = cs.filter(function (ix) { return g.fill[ix] === EMPTY; })[0];
    if (g.cur === undefined) g.cur = cs[0];
    return g;
  }

  // ---------- Imported crosswords (import.js) ----------
  var IMPC = window.OrosCrosswordImport || null;

  // The visible library entry of an id, or null.
  function libEntry(id) {
    var e = data && data.lib && data.lib[id];
    return e && e.z && e.b > e.x ? e : null;
  }

  // An imported crossword as a game: the slots with their numbers and
  // clues (across first, then down: the Tab order), squares whose
  // solution cannot be typed (a digit, a symbol) are given. With a saved
  // play state st (session) that state is restored when it fits.
  function impGame(e, st) {
    if (!IMPC || !e || !e.z) return null;
    var z = e.z, letters = LETTERS[z.lg], acr = [], dn = [], ka = 0, kd = 0, i;
    IMPC.slots(z).forEach(function (x) {
      var w = "";
      for (i = 0; i < x.len; i++) w += z.g[x.d ? (x.r + i) * z.w + x.c : x.r * z.w + x.c + i];
      var p = { w: w, r: x.r, c: x.c, d: x.d, n: x.n, q: x.d ? z.cd[kd++] : z.ca[ka++] };
      (x.d ? dn : acr).push(p);
    });
    var words = acr.concat(dn), giv = [];
    for (i = 0; i < z.g.length; i++) if (z.g[i] !== BLOCK && letters.indexOf(z.g[i]) < 0) giv.push(i);
    var rb = {};
    (z.rb || []).forEach(function (x) { rb[x[0]] = x[1]; });
    var g = { lang: z.lg, mode: "i", id: e.id, day: 0, size: "i", theme: "random", rows: z.h, cols: z.w,
      sol: z.g, words: words, giv: giv, uq: true, fill: startFill(z.g, giv), bad: [], rev: [], cur: 0, dir: 0,
      hinted: false, ms: 0, done: false, ext: false, ti: z.ti || "", au: z.au || "", ci: z.ci || [], rb: rb };
    var cs = cellsOf(words[0], z.w);
    g.dir = words[0].d;
    g.cur = cs.filter(function (ix) { return g.fill[ix] === EMPTY; })[0];
    if (g.cur === undefined) g.cur = cs[0];
    if (st && validImpState(g, st)) {
      g.fill = st.fill; g.bad = st.bad.slice(); g.rev = st.rev.slice(); g.cur = st.cur; g.dir = st.dir;
      g.hinted = st.hinted; g.ms = st.ms; g.done = st.done;
    }
    return g;
  }
  // Does a saved play state fit the crossword g?
  function validImpState(g, st) {
    if (!st || typeof st !== "object" || st.id !== g.id || typeof st.fill !== "string" ||
        st.fill.length !== g.sol.length || (st.dir !== 0 && st.dir !== 1) || typeof st.hinted !== "boolean" ||
        !isInt(st.ms) || st.ms < 0 || typeof st.done !== "boolean" || !isInt(st.cur)) return false;
    var letters = LETTERS[g.lang], size = g.sol.length, i;
    for (i = 0; i < size; i++) {
      var s0 = g.sol[i], f = st.fill[i];
      if ((s0 === BLOCK) !== (f === BLOCK)) return false;
      if (s0 !== BLOCK && f !== EMPTY && f !== s0 && letters.indexOf(f) < 0) return false;
    }
    for (i = 0; i < g.giv.length; i++) if (st.fill[g.giv[i]] !== g.sol[g.giv[i]]) return false;
    var letterCell = function (ix) { return g.sol[ix] !== BLOCK; };
    if (!idxList(st.rev, size, function (ix) { return letterCell(ix) && st.fill[ix] === g.sol[ix]; })) return false;
    if (!idxList(st.bad, size, function (ix) { return letterCell(ix) && st.fill[ix] !== EMPTY; })) return false;
    return st.cur >= 0 && st.cur < size && letterCell(st.cur);
  }

  // The puzzle for the current language and mode: the saved one, unless
  // it is an old daily puzzle; a new one otherwise. Mode "i": the open
  // imported crossword (Free play when it is gone from the list).
  function pickGame() {
    stopClock();
    if (prefs.mode === "i") {
      var ig = impGame(libEntry(prefs.imp) && { id: prefs.imp, z: libEntry(prefs.imp).z }, sessions["i:" + prefs.imp]);
      if (ig) {
        game = ig;
        saveSessions();
        startClock();
        return;
      }
      prefs.mode = "f"; prefs.imp = ""; savePrefs();
    }
    var key = prefs.lang + ":" + prefs.mode, g = sessions[key];
    if (g && g.mode === "d" && g.day !== today()) g = null;
    if (!g) g = freshGame(prefs.lang, prefs.mode, prefs.size, prefs.theme);
    game = g;
    if (game) {
      if (game.mode === "f") { prefs.size = game.size; prefs.theme = game.theme; savePrefs(); }
      markElsewhere();
      saveSessions();
    }
    startClock();
  }

  // The daily result from this or another device for the current puzzle.
  function dailyResult(g) {
    if (!g || g.mode !== "d") return null;
    var e = data.days[g.lang + ":" + g.day];
    return e && e.b >= data.br ? e : null;
  }
  function typedHere(g) {
    for (var i = 0; i < g.fill.length; i++) {
      if (g.fill[i] !== EMPTY && g.fill[i] !== BLOCK && g.giv.indexOf(i) < 0) return true;
    }
    return false;
  }
  // A daily puzzle solved elsewhere and not started here: show it solved.
  // After a reset that result is gone: the puzzle is playable again.
  function markElsewhere() {
    if (!game || game.mode !== "d") return false;
    var r = dailyResult(game);
    if (r && !game.done && !typedHere(game)) {
      stopClock();
      game.done = true; game.ext = true;
      game.fill = game.sol; game.bad = [];
      return true;
    }
    if (!r && game.ext) {
      game.done = false; game.ext = false; game.fill = startFill(game.sol, game.giv);
      game.bad = []; game.rev = []; game.ms = 0; game.hinted = false;
      return true;
    }
    return false;
  }

  function inProgress() { return !!(game && !game.done && (typedHere(game) || elapsed() > 15000)); }

  // Can the grid act now? (R28: say why not)
  function gate() {
    if (!game || document.querySelector("dialog[open]")) return false;
    if (game.done) {
      showToast(t(game.mode === "d" ? "toast.dailyDone" : "toast.over"));
      return false;
    }
    return true;
  }

  var slotCache = { g: null, map: null };
  function slots() {
    if (slotCache.g !== game || !slotCache.map) slotCache = { g: game, map: slotMap(game.words, game.rows, game.cols) };
    return slotCache.map;
  }
  function locked(ix) { return game.giv.indexOf(ix) >= 0 || game.rev.indexOf(ix) >= 0; }
  // The word the cursor is in (its direction if possible).
  function curSlot() {
    if (!game) return -1;
    var s = slots()[game.cur];
    return s[game.dir] >= 0 ? s[game.dir] : s[1 - game.dir];
  }

  function select(ix, dir) {
    var s = slots()[ix];
    game.cur = ix;
    game.dir = s[dir] >= 0 ? dir : 1 - dir;
    renderGrid();
    renderWords();
  }

  // A tap on a letter cell: select it; a second tap switches direction.
  function tapCell(ix) {
    if (!game) return;
    if (ix === game.cur) toggleDir();
    else select(ix, game.dir);
    var p = game.words[curSlot()];
    if (p) live(slotText(p));
  }
  // What a screen reader hears for a word: its length and direction, or
  // in an imported crossword its number and clue.
  function slotText(p) {
    if (game.mode === "i") return t("live.clue", { n: p.n, d: t("dir." + p.d), k: p.w.length, q: p.q || t("clues.none") });
    return t("live.slot", { n: p.w.length, d: t("dir." + p.d) });
  }
  function toggleDir() {
    if (!game) return;
    var s = slots()[game.cur];
    if (s[0] >= 0 && s[1] >= 0) game.dir = 1 - game.dir;
    renderGrid();
    renderWords();
  }

  // Step inside the current word: +1 forward, -1 back; -1 at its end.
  function stepInWord(ix, delta) {
    var p = game.words[curSlot()];
    if (!p) return -1;
    var cs = cellsOf(p, game.cols), k = cs.indexOf(ix) + delta;
    return k >= 0 && k < cs.length ? cs[k] : -1;
  }

  // Write ch ("" clears) in cell ix; returns true when something changed.
  function writeCell(ix, ch) {
    if (locked(ix)) return false;
    var v = ch || EMPTY;
    if (game.fill[ix] === v) return false;
    var before = placedWords(game.fill, game.words, game.cols);
    game.fill = setCh(game.fill, ix, v);
    game.bad = game.bad.filter(function (b) { return b !== ix; });
    var after = placedWords(game.fill, game.words, game.cols);
    var gained = after.filter(function (i) { return before.indexOf(i) < 0; });
    if (gained.length && game.mode !== "i") {           // clued: no hint that a word is right
      live(t("live.word", { w: game.words[gained[0]].w, f: after.length, k: game.words.length }));
      pulseWord(gained);
    }
    return true;
  }

  function typeLetter(l) {
    if (!gate()) return;
    var ix = game.cur;
    if (!locked(ix)) writeCell(ix, l);
    var nx = stepInWord(ix, 1);
    if (nx >= 0) game.cur = nx;
    afterEdit();
  }
  function backspace() {
    if (!gate()) return;
    var ix = game.cur;
    if (game.fill[ix] !== EMPTY && !locked(ix)) { writeCell(ix, ""); afterEdit(); return; }
    var pv = stepInWord(ix, -1);
    if (pv < 0) return;
    game.cur = pv;
    writeCell(pv, "");
    afterEdit();
  }
  function clearCell() {
    if (!gate()) return;
    if (locked(game.cur)) { showToast(t("toast.given")); return; }
    writeCell(game.cur, "");
    afterEdit();
  }

  var notYetShown = false;
  function afterEdit() {
    if (game.mode === "i" ? game.fill === game.sol : isSolved(game.fill, game.words, game.cols)) { finish(); renderAll(); return; }
    if (game.fill.indexOf(EMPTY) < 0) {
      if (!notYetShown) { notYetShown = true; showToast(t(game.mode === "i" ? "toast.notYetI" : "toast.notYet")); }
    } else notYetShown = false;
    saveSessions();
    renderGrid();
    renderWords();
    renderStatus();
  }

  // Arrow keys: the next letter cell that way; the direction follows.
  function moveCursor(dr, dc) {
    if (!game) return;
    var nx = nextCell(game.sol, game.rows, game.cols, game.cur, dr, dc);
    select(nx >= 0 ? nx : game.cur, dr ? 1 : 0);
  }
  // Tab: the next (or previous) word, on its first empty cell.
  function jumpWord(delta) {
    if (!game) return;
    var k = game.words.length, i = (curSlot() + delta + k) % k, p = game.words[i];
    var cs = cellsOf(p, game.cols), empty = cs.filter(function (ix) { return game.fill[ix] === EMPTY; });
    game.dir = p.d;
    select(empty.length ? empty[0] : cs[0], p.d);
    live(slotText(p));
  }

  // Check: mark wrong letters in the cell, the word or everywhere.
  function check(scope) {
    closeDialogs();
    if (!gate()) return;
    var ixs;
    if (scope === "letter") ixs = [game.cur];
    else if (scope === "word") ixs = cellsOf(game.words[curSlot()], game.cols);
    else { ixs = []; for (var i = 0; i < game.sol.length; i++) if (game.sol[i] !== BLOCK) ixs.push(i); }
    var filled = ixs.filter(function (ix) { return game.fill[ix] !== EMPTY && !locked(ix); });
    if (!filled.length) {
      showToast(t(scope === "letter" ? (locked(game.cur) ? "toast.given" : "toast.emptyCell") : "toast.nothing"));
      return;
    }
    var wrong = wrongCells(game.fill, game.sol, filled);
    wrong.forEach(function (ix) { if (game.bad.indexOf(ix) < 0) game.bad.push(ix); });
    game.bad.sort(function (a, b) { return a - b; });
    saveSessions();
    renderGrid();
    showToast(!wrong.length ? t("toast.allOk") : wrong.length === 1 ? t("toast.wrong1") : t("toast.wrongN", { n: wrong.length }));
  }

  // Reveal the letter under the cursor (no record for this puzzle).
  function reveal() {
    closeDialogs();
    if (!gate()) return;
    var ix = game.cur;
    if (locked(ix)) { showToast(t("toast.given")); return; }
    var first = !game.hinted;
    game.hinted = true;
    game.fill = setCh(game.fill, ix, game.sol[ix]);
    game.bad = game.bad.filter(function (b) { return b !== ix; });
    game.rev.push(ix);
    game.rev.sort(function (a, b) { return a - b; });
    var nx = stepInWord(ix, 1);
    if (nx >= 0) game.cur = nx;
    if (first) showToast(t("toast.revealNoRecord"));
    afterEdit();
  }

  function finish() {
    var sec = elapsed() / 1000;
    stopClock();
    game.done = true;
    game.bad = [];
    saveSessions();
    var record = countGame(game, sec);
    live(t("live.done", { t: fmtTime(sec) }));
    setTimeout(function () { resultDialog(record); }, reduced ? 50 : 650);
  }

  // Free play: a new puzzle. One in progress is never lost silently (R14).
  function newPuzzle(size, theme) {
    if (prefs.mode === "i") { libDialog(); return; }
    if (!game && !lists(prefs.lang)) { showToast(t("toast.noWords")); return; }
    if (prefs.mode === "d") { showToast(t(game && game.done ? "toast.dailyDone" : "toast.dailyOne")); return; }
    closeDialogs();
    var prev = inProgress() ? JSON.parse(JSON.stringify(game)) : null;
    if (prev) { foldTime(); prev.ms = game.ms; }
    stopClock();
    var g = freshGame(prefs.lang, "f", size || prefs.size, theme || prefs.theme);
    if (!g) { showToast(t("toast.noWords")); startClock(); return; }
    game = g;
    prefs.size = game.size; prefs.theme = game.theme; savePrefs();
    saveSessions();
    startClock();
    renderAll();
    if (prev) {
      undoToast(t("toast.newPuzzle"), function () {
        stopClock();
        prefs.lang = prev.lang; prefs.mode = "f"; prefs.size = prev.size; prefs.theme = prev.theme;
        savePrefs();
        game = prev;
        saveSessions();
        startClock();
        renderAll();
      });
    } else {
      live(t("toast.newPuzzle"));
    }
  }

  function setLangMode(lang, mode) {
    if (mode === "i") mode = "f";                                   // the language switch leaves an imported crossword
    if (game && game.mode !== "i" && lang === game.lang && mode === game.mode) return;   // visible active state
    if (game) saveSessions();
    prefs.lang = lang; prefs.mode = mode; savePrefs();
    closeDialogs();
    pickGame();
    renderAll();
    if (!game) showToast(t("toast.noWords"));
  }

  function setSize(size) {
    if (prefs.mode === "i") { showToast(t("toast.impFixed")); return; }
    if (prefs.mode === "d") { showToast(t("toast.dailyFixed")); return; }
    if (game && game.size === size) return;
    newPuzzle(size, null);
  }
  function setTheme(theme) {
    if (prefs.mode === "i") { showToast(t("toast.impFixed")); return; }
    if (prefs.mode === "d") { showToast(t("toast.dailyFixed")); return; }
    newPuzzle(null, theme);
  }

  // ---------- Timer ----------
  // ms accumulates while the app is visible and the puzzle is open.
  var runStart = 0, clockTimer = null;
  function elapsed() { return game ? game.ms + (runStart ? Date.now() - runStart : 0) : 0; }
  function foldTime() {
    if (game && runStart) { game.ms += Date.now() - runStart; runStart = Date.now(); }
  }
  function startClock() {
    if (!game || game.done || runStart || document.visibilityState === "hidden") { renderTime(); return; }
    runStart = Date.now();
    clockTimer = setInterval(renderTime, 1000);
    renderTime();
  }
  function stopClock() {
    if (game && runStart) game.ms += Date.now() - runStart;
    runStart = 0;
    clearInterval(clockTimer);
    clockTimer = null;
  }

  // ---------- 6. Render ----------
  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function renderAll() {
    renderToolbar();
    renderStatus();
    renderGrid();
    renderWords();
    renderKeyboard();
  }

  function themeName(g) {
    var th = g ? g.theme : prefs.theme;
    return t("theme." + (themeOk(th) ? th : "random"));
  }

  function renderToolbar() {
    var size = game ? game.size : prefs.size, imp = prefs.mode === "i";
    [["#lang-seg", "data-lang", imp ? "" : prefs.lang], ["#mode-seg", "data-mode", prefs.mode], ["#size-seg", "data-size", size]]
      .forEach(function (x) {
        [].forEach.call(document.querySelectorAll(x[0] + " .seg-btn"), function (b) {
          var on = b.getAttribute(x[1]) === x[2];
          b.classList.toggle("active", on);
          b.setAttribute("aria-pressed", on ? "true" : "false");
        });
      });
    $("size-seg").classList.toggle("fixed", prefs.mode !== "f");
    var tb = $("theme-btn");
    tb.lastChild.textContent = imp ? t("lib.short") : themeName(game);
    tb.classList.toggle("fixed", prefs.mode === "d");
    $("new-btn").disabled = prefs.mode === "d";
    $("lib-btn").classList.toggle("on", imp);
  }

  function renderStatus() {
    if (!game) { $("info").textContent = t("toast.noWords"); $("count").textContent = ""; return; }
    var s = t("sizeShort." + game.size);
    $("info").textContent = game.mode === "d" ? t("st.daily", { n: game.day + 1 })
      : game.mode === "i" ? impTitle(game) : t("st.free", { th: themeName(game), s: s });
    var r = game.ext ? dailyResult(game) : null;
    var f = game.done ? game.words.length : game.mode === "i" ? filledWords().length
      : placedWords(game.fill, game.words, game.cols).length;
    $("count").textContent = r ? t("st.elsewhere", { t: fmtTime(r.t) })
      : t("st.count", { f: f, k: game.words.length });
    $("count").className = game.done ? "done" : "";
    renderTime();
  }
  function renderTime() {
    var n = $("time");
    if (!n) return;
    var r = game && game.ext ? dailyResult(game) : null;
    n.textContent = fmtTime(r ? r.t : elapsed() / 1000);
  }

  function impTitle(g) { return g.ti || t("lib.untitled", { w: g.cols, h: g.rows }); }
  // Imported: words with every square filled (right or not: no hint).
  function filledWords() {
    var out = [];
    game.words.forEach(function (p, i) {
      if (cellsOf(p, game.cols).every(function (ix) { return game.fill[ix] !== EMPTY; })) out.push(i);
    });
    return out;
  }

  // Grid: one div per square; letter cells hold the letter. Imported
  // crosswords add the clue number (span.num) and circles (.circ); the
  // letter then sits in span.l.
  function buildGrid() {
    var el = $("grid");
    el.innerHTML = "";
    el.style.setProperty("--r", game.rows);
    el.style.setProperty("--c", game.cols);
    el.setAttribute("aria-label", t("grid.label"));
    el.classList.toggle("clued", game.mode === "i");
    var nums = {};
    if (game.mode === "i") game.words.forEach(function (p) { nums[p.r * game.cols + p.c] = p.n; });
    for (var r = 0; r < game.rows; r++) {
      var row = document.createElement("div");
      row.className = "g-row";
      row.setAttribute("role", "row");
      for (var c = 0; c < game.cols; c++) {
        var ix = r * game.cols + c, cell = document.createElement("div");
        if (game.sol[ix] === BLOCK) { cell.className = "blk" + (game.mode === "i" ? " ib" : ""); cell.setAttribute("aria-hidden", "true"); }
        else {
          cell.className = "cell";
          cell.setAttribute("role", "gridcell");
          cell.setAttribute("data-ix", ix);
          if (game.mode === "i") {
            if (nums[ix]) {
              var nm = document.createElement("span");      // (el is the grid here)
              nm.className = "num";
              nm.textContent = String(nums[ix]);
              cell.appendChild(nm);
            }
            if (game.ci.indexOf(ix) >= 0) cell.classList.add("circ");
            var lt = document.createElement("span");
            lt.className = "l";
            cell.appendChild(lt);
          }
        }
        row.appendChild(cell);
      }
      el.appendChild(row);
    }
    el.setAttribute("data-key", (game.mode === "i" ? game.id + ":" : "") + game.sol);
  }

  function renderGrid() {
    var el = $("grid");
    if (!game) { el.innerHTML = ""; el.removeAttribute("data-key"); return; }
    if (el.getAttribute("data-key") !== (game.mode === "i" ? game.id + ":" : "") + game.sol) buildGrid();
    var si = game.done ? -1 : curSlot(), inSlot = {};
    if (si >= 0) cellsOf(game.words[si], game.cols).forEach(function (ix) { inSlot[ix] = true; });
    var cells = el.querySelectorAll(".cell");
    for (var k = 0; k < cells.length; k++) {
      var cell = cells[k], ix = +cell.getAttribute("data-ix"), f = game.fill[ix], l = f === EMPTY ? "" : f;
      var box = game.mode === "i" ? cell.lastChild : cell;
      var shown = game.mode === "i" && game.done && game.rb[ix] ? game.rb[ix] : l;   // a solved rebus: the whole entry
      if (box.textContent !== shown) box.textContent = shown;
      if (game.mode === "i") box.classList.toggle("rb", shown.length > 1);
      cell.classList.toggle("giv", game.giv.indexOf(ix) >= 0);
      cell.classList.toggle("rev", game.rev.indexOf(ix) >= 0);
      cell.classList.toggle("bad", game.bad.indexOf(ix) >= 0);
      cell.classList.toggle("slot", !!inSlot[ix]);
      cell.classList.toggle("cur", !game.done && ix === game.cur);
      cell.classList.toggle("won", game.done);
      cell.setAttribute("aria-label", t("cell.label", { l: l || t("cell.empty"),
        r: Math.floor(ix / game.cols) + 1, c: ix % game.cols + 1 }));
      cell.setAttribute("aria-selected", !game.done && ix === game.cur ? "true" : "false");
    }
  }

  function pulseWord(list) {
    if (reduced) return;
    setTimeout(function () {
      list.forEach(function (wi) {
        cellsOf(game.words[wi], game.cols).forEach(function (ix) {
          var c = document.querySelector('#grid .cell[data-ix="' + ix + '"]');
          if (!c) return;
          c.classList.remove("pop");
          void c.offsetWidth;
          c.classList.add("pop");
        });
      });
    }, 0);
  }

  // Word list, grouped by length; the group of the current word is lit
  // and words in their own slot are struck through.
  function renderWords() {
    var box = $("word-groups");
    box.innerHTML = "";
    var clued = !!game && game.mode === "i";
    $("words-intro").hidden = clued;
    $("words").setAttribute("aria-label", t(clued ? "clues.label" : "words.label"));
    renderClueBar();
    if (!game) return;
    if (clued) { renderClues(box); return; }
    var got = game.done ? game.words.map(function (p, i) { return i; }) : placedWords(game.fill, game.words, game.cols);
    var si = game.done ? -1 : curSlot(), curLen = si >= 0 ? game.words[si].w.length : 0, groups = {};
    game.words.forEach(function (p, i) { (groups[p.w.length] = groups[p.w.length] || []).push(i); });
    Object.keys(groups).map(Number).sort(function (a, b) { return a - b; }).forEach(function (len) {
      var g = el("div", "grp" + (len === curLen ? " on" : ""));
      g.appendChild(el("div", "grp-h", t("words.group", { n: len })));
      var ul = el("ul", "grp-l");
      groups[len].forEach(function (i) {
        var li = el("li", "wd" + (got.indexOf(i) >= 0 ? " got" : ""), game.words[i].w);
        ul.appendChild(li);
      });
      g.appendChild(ul);
      box.appendChild(g);
    });
  }

  // Imported: the Across and Down clues; the current one lit (and kept
  // in view), the crossing one marked, filled words dimmed.
  function renderClues(box) {
    var si = game.done ? -1 : curSlot(), cross = -1, filled = filledWords();
    if (si >= 0) cross = slots()[game.cur][1 - game.words[si].d];
    [0, 1].forEach(function (d) {
      var g = el("div", "grp cl");
      g.appendChild(el("div", "grp-h", t(d ? "clues.d" : "clues.a")));
      var ol = el("ol", "cl-l");
      game.words.forEach(function (p, i) {
        if (p.d !== d) return;
        var li = el("li", "cl-i" + (i === si ? " on" : i === cross ? " x" : "") + (filled.indexOf(i) >= 0 ? " fill" : ""));
        li.setAttribute("data-w", String(i));
        li.appendChild(el("b", "", String(p.n)));
        li.appendChild(el("span", "", p.q || t("clues.none")));
        ol.appendChild(li);
      });
      g.appendChild(ol);
      box.appendChild(g);
    });
    var on = box.querySelector(".cl-i.on"), wrap = $("words");
    if (on && wrap.getBoundingClientRect) {
      var wr = wrap.getBoundingClientRect(), r = on.getBoundingClientRect();
      if (r.top < wr.top || r.bottom > wr.bottom) wrap.scrollTop += r.top - wr.top - Math.max(0, (wr.height - r.height) / 3);
    }
  }
  // The clue of the current word above the grid (imported only).
  function renderClueBar() {
    var bar = $("clue");
    if (!bar) return;
    var si = game && game.mode === "i" && !game.done ? curSlot() : -1;
    bar.hidden = !(game && game.mode === "i");
    bar.textContent = "";
    if (bar.hidden) return;
    if (si < 0) { bar.appendChild(el("span", "", impTitle(game) + (game.au ? " · " + game.au : ""))); return; }
    var p = game.words[si];
    bar.appendChild(el("b", "", p.n + (p.d ? "↓" : "→")));
    bar.appendChild(el("span", "", p.q || t("clues.none")));
  }
  // A tap on a clue: its first empty square.
  function tapClue(i) {
    var p = game && game.words[i];
    if (!p) return;
    if (game.done) { gate(); return; }
    var cs = cellsOf(p, game.cols), empty = cs.filter(function (ix) { return game.fill[ix] === EMPTY; });
    game.dir = p.d;
    select(empty.length ? empty[0] : cs[0], p.d);
    live(slotText(p));
  }

  function renderKeyboard() {
    var kb = $("kb"), lang = game ? game.lang : prefs.lang;
    if (kb.getAttribute("data-lang") === lang) return;
    kb.innerHTML = "";
    kb.setAttribute("data-lang", lang);
    KB_ROWS[lang].forEach(function (letters, i) {
      var row = el("div", "kb-row");
      if (i === 2) {
        var d = keyBtn("dir", "", "wide");
        d.innerHTML = UI_ICONS.dir;             // constant markup
        d.setAttribute("aria-label", t("kb.dir"));
        d.title = t("kb.dir");
        row.appendChild(d);
      }
      letters.split("").forEach(function (l) { row.appendChild(keyBtn(l, l, "")); });
      if (i === 2) {
        var b = keyBtn("back", "", "wide");
        b.innerHTML = UI_ICONS.back;            // constant markup
        b.setAttribute("aria-label", t("kb.back"));
        b.title = t("kb.back");
        row.appendChild(b);
      }
      kb.appendChild(row);
    });
  }
  function keyBtn(k, label, cls) {
    var b = el("button", "key" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.setAttribute("data-k", k);
    b.tabIndex = -1;
    return b;
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
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function row(label, value) {
    var r = el("div", "dlg-row");
    r.appendChild(el("span", "", label));
    r.appendChild(el("strong", "", value));
    return r;
  }
  function langName(l) { return t(l === "el" ? "lang.elLong" : "lang.enLong"); }
  function fmtDate(ts) {
    try { return new Date(ts).toLocaleDateString(loc()); }
    catch (e) { return ""; }
  }
  function bestText(s) {
    return s.t ? fmtTime(s.t) + " · " + fmtDate(s.d) : t("stats.none");
  }

  function resultDialog(record) {
    if (!game || !game.done) return;
    closeDialogs();
    var d = today(), sec = Math.max(1, Math.round(elapsed() / 1000));   // as counted
    var dlg = makeDialog("cw-result");
    if (game.mode === "i") { importedResult(dlg, sec, record); return; }
    var title = game.mode === "d" ? t("res.titleD", { n: game.day + 1 }) : t("res.titleF", { s: t("sizeShort." + game.size) });
    dlg.appendChild(el("div", "dlg-title", title + " · " + langName(game.lang)));
    dlg.appendChild(el("div", "dlg-hero", t("res.solved", { t: fmtTime(sec) })));
    if (record) dlg.appendChild(el("span", "dlg-badge", t("res.record")));
    if (game.hinted) dlg.appendChild(el("div", "dlg-msg cw-center cw-dim", t("res.hinted")));
    if (game.mode === "d") {
      var ds = dailyStats(game.lang, d);
      dlg.appendChild(row(t("res.days"), String(ds.n)));
      dlg.appendChild(row(t("res.streak"), String(ds.cur)));
      dlg.appendChild(row(t("res.bestStreak"), String(ds.best)));
      dlg.appendChild(row(t("res.bestDaily"), ds.t ? fmtTime(ds.t) : t("stats.none")));
      dlg.appendChild(el("div", "dlg-msg cw-center cw-dim cw-next", t("res.next")));
    } else {
      var s = t("sizeShort." + game.size), fs = freeStats(game.lang, game.size);
      dlg.appendChild(row(t("res.solvedN", { s: s }), String(fs.n)));
      dlg.appendChild(row(t("res.best", { s: s }), bestText(fs)));
    }
    var acts = el("div", "dlg-actions");
    if (game.mode === "d" && DK) acts.appendChild(button(t("res.share"), "", shareDaily));
    else acts.appendChild(button(t("res.close"), "", function () { dlg.close(); }));
    var main = game.mode === "d"
      ? button(t("res.toFree"), "primary", function () { dlg.close(); setLangMode(game.lang, "f"); })
      : button(t("res.newPuzzle"), "primary", function () { dlg.close(); newPuzzle(null, null); });
    acts.appendChild(main);
    dlg.appendChild(acts);
    hubLink(dlg);
    document.body.appendChild(dlg);
    dlg.showModal();
    main.focus();
  }

  function importedResult(dlg, sec, record) {
    var e = libEntry(game.id);
    dlg.appendChild(el("div", "dlg-title", t("res.titleI")));
    dlg.appendChild(el("div", "dlg-msg cw-center", impTitle(game)));
    dlg.appendChild(el("div", "dlg-hero", t("res.solved", { t: fmtTime(sec) })));
    if (record) dlg.appendChild(el("span", "dlg-badge", t("res.record")));
    if (game.hinted) dlg.appendChild(el("div", "dlg-msg cw-center cw-dim", t("res.hinted")));
    if (e && e.t) dlg.appendChild(row(t("res.bestI"), fmtTime(e.t)));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("res.close"), "", function () { dlg.close(); }));
    var main = button(t("res.lib"), "primary", function () { dlg.close(); libDialog(); });
    acts.appendChild(main);
    dlg.appendChild(acts);
    hubLink(dlg);
    document.body.appendChild(dlg);
    dlg.showModal();
    main.focus();
  }

  // Spoiler-free result of the daily crossword: the time and one square
  // per word (yellow: a letter of it was revealed), eight to a line. A
  // daily solved on another device has no board here: no squares.
  function shareDaily() {
    if (!game || game.mode !== "d" || !game.done || !DK) return;
    var r = data.days[game.lang + ":" + game.day];
    var grid = [], line = "", rev = {};
    (game.rev || []).forEach(function (ix) { rev[ix] = true; });
    if (!game.ext) {
      game.words.forEach(function (w, k) {
        var hit = cellsOf(w, game.cols).some(function (ix) { return rev[ix]; });
        line += hit ? "🟨" : "🟩";
        if (k % 8 === 7) { grid.push(line); line = ""; }
      });
      if (line) grid.push(line);
    }
    var sec = r ? r.t : Math.max(1, Math.round(elapsed() / 1000));
    var hinted = r ? r.h === 1 : game.hinted;
    var text = DK.shareText({ game: t("share.name") + " " + game.lang.toUpperCase(), label: t("share.daily"),
      day: game.day, grid: grid,
      line: "⏱ " + fmtTime(sec) + " · " + t(hinted ? "share.revealed" : "share.clean") });
    DK.share(text, "orOS " + t("share.name")).then(function (how) {
      if (how === "copied") showToast(t("toast.copied"));
      else if (how === "shared") showToast(t("toast.shared"));
      else if (how === "failed") showToast(t("toast.copyFail"));
    });
  }

  // "All games" (the Game Center), only when it is installed.
  function hubLink(dlg) {
    if (!DK || !DK.hasHub()) return;
    dlg.appendChild(button(t("btn.games"), "dlg-link", function () { dlg.close(); DK.openHub("crossword"); }));
  }

  function statsDialog() {
    var dlg = makeDialog("cw-stats"), d = today(), lang = game ? game.lang : prefs.lang;
    dlg.appendChild(el("div", "dlg-title", t("stats.title", { l: langName(lang) })));
    var empty = !Object.keys(data.days).length && !Object.keys(data.rows).length;
    var ds = dailyStats(lang, d);
    dlg.appendChild(el("div", "dlg-sub", t("stats.daily")));
    dlg.appendChild(row(t("res.days"), String(ds.n)));
    dlg.appendChild(row(t("res.streak"), String(ds.cur)));
    dlg.appendChild(row(t("res.bestStreak"), String(ds.best)));
    dlg.appendChild(row(t("res.bestDaily"), ds.t ? fmtTime(ds.t) : t("stats.none")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.free")));
    SIZES.forEach(function (sz) {
      var fs = freeStats(lang, sz);
      dlg.appendChild(row(t("sizeShort." + sz),
        fs.t ? t("stats.freeRow", { n: fs.n, t: bestText(fs) }) : t("stats.freeNone", { n: fs.n })));
    });
    var acts = el("div", "dlg-actions");
    var reset = button(t("stats.reset"), "danger", function () {
      dlg.close();
      confirmDialog(t("confirm.reset"), resetStats);
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

  // Word source picker (Free play): random words or a theme.
  function themesDialog() {
    if (prefs.mode === "i") { libDialog(); return; }
    if (prefs.mode === "d") { showToast(t("toast.dailyFixed")); return; }
    var cur = game ? game.theme : prefs.theme;
    var dlg = makeDialog("cw-themes");
    dlg.classList.add("wide");
    dlg.appendChild(el("div", "dlg-title", t("themes.title", { l: langName(prefs.lang) })));
    dlg.appendChild(el("div", "dlg-msg cw-dim cw-small", t("themes.intro")));
    var box = el("div", "chips");
    ["random"].concat(THEME_IDS).forEach(function (id) {
      var b = el("button", "chip" + (cur === id ? " active" : ""), t("theme." + id));
      b.type = "button";
      b.setAttribute("aria-pressed", cur === id ? "true" : "false");
      b.addEventListener("click", function () { dlg.close(); setTheme(id); });
      box.appendChild(b);
    });
    dlg.appendChild(box);
    var acts = el("div", "dlg-actions");
    var close = button(t("themes.close"), "primary", function () { dlg.close(); });
    acts.appendChild(close);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    close.focus();
  }

  // Check menu: letter, word, all; reveal a letter.
  function checkDialog() {
    if (!gate()) return;
    var dlg = makeDialog("cw-check");
    dlg.appendChild(el("div", "dlg-title", t("check.title")));
    var list = el("div", "dlg-list");
    var first = null;
    [["letter", "check.letter", "Shift+L"], ["word", "check.word", "Shift+W"], ["all", "check.all", "Shift+A"],
     ["reveal", "check.reveal", "Shift+R"]].forEach(function (x) {
      var b = button("", x[0] === "reveal" ? "reveal" : "", function () {
        dlg.close();
        if (x[0] === "reveal") reveal(); else check(x[0]);
      });
      b.appendChild(el("span", "", t(x[1])));
      b.appendChild(el("kbd", "", x[2]));
      list.appendChild(b);
      if (!first) first = b;
    });
    dlg.appendChild(list);
    dlg.appendChild(el("div", "dlg-msg cw-dim cw-small", t("check.note")));
    if (!game.uq) dlg.appendChild(el("div", "dlg-msg cw-dim cw-small", t("check.multi")));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("check.close"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    first.focus();
  }

  function confirmDialog(msg, onYes) {
    var dlg = makeDialog("cw-confirm");
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

  // Reset = a new epoch: every device drops results older than br. A
  // daily puzzle solved here stays solved on this device's grid.
  function resetStats() {
    data.br = Math.max(Date.now(), data.br + 1);
    data = mergeCW(data, data);
    save();
    if (markElsewhere()) { saveSessions(); startClock(); }
    renderAll();
    showToast(t("toast.reset"));
  }

  // ---------- Imported crosswords: list, picker, preview, import ----------
  // The list button → the imported crosswords (open one) and "Import a
  // file…" → picker → parse (OrosCrosswordImport, pure) → preview →
  // ONE write (save(): one persist, one dirty mark) → the crossword
  // opens → a toast with Undo (a newer tombstone; the game shown before
  // comes back). The games in progress are never touched: each imported
  // crossword keeps its own play state. Text from a file reaches the
  // page through textContent only.
  var IMP_SRC = { puz: "imp.src.puz", ipuz: "imp.src.ipuz" };

  function libDialog() {
    if (!IMPC || !window.OrosImportKit) return;
    parkToast();                                // the toast may live in a dialog being replaced
    var dlg = makeDialog("cw-lib");
    dlg.classList.add("wide");
    dlg.appendChild(el("div", "dlg-title", t("lib.title")));
    dlg.appendChild(el("div", "dlg-msg cw-dim cw-small", t("lib.intro")));
    var l = IMPC.list(data.lib);
    if (!l.length) dlg.appendChild(el("div", "dlg-msg cw-dim", t("lib.empty")));
    else {
      var ul = el("ul", "lib-list");
      l.forEach(function (e) {
        var z = e.z, name = z.ti || t("lib.untitled", { w: z.w, h: z.h });
        var li = el("li", "lib-row" + (game && game.mode === "i" && game.id === e.id ? " cur" : ""));
        var txt = el("span", "lib-txt");
        txt.appendChild(el("strong", "", name));
        var bits = [t("lib.size", { w: z.w, h: z.h })];
        if (z.au) bits.unshift(z.au);
        if (e.s) bits.push(e.t ? t("lib.best", { t: fmtTime(e.t) }) : t("lib.solved"));
        txt.appendChild(el("span", "lib-meta", bits.join(" · ")));
        li.appendChild(txt);
        var b = button(t("lib.open"), "lib-open", function () { dlg.close(); openImported(e.id); });
        b.setAttribute("aria-label", t("lib.openLabel", { t: name }));
        li.appendChild(b);
        ul.appendChild(li);
      });
      dlg.appendChild(ul);
    }
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("lib.close"), "", function () { dlg.close(); }));
    var imp = button(t("lib.file"), "primary", function () {
      dlg.close();
      pickImportFile().then(function (f) { if (f) importFile(f); });
    });
    acts.appendChild(imp);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    imp.focus();
  }

  // Play an imported crossword (its saved state, if any). The game shown
  // before is saved first, so nothing is lost.
  function openImported(id) {
    var e = libEntry(id);
    if (!e) return false;
    if (game) saveSessions();
    stopClock();
    prefs.mode = "i"; prefs.imp = id; savePrefs();
    pickGame();
    renderAll();
    if (game && game.words[curSlot()]) live(slotText(game.words[curSlot()]));
    return true;
  }

  function pickImportFile() {
    var host = null;
    try { host = window.parent && window.parent !== window ? window.parent.orosDialog : null; } catch (e) { host = null; }
    if (host && typeof host.openFile === "function") return host.openFile(IMPC.ACCEPT);
    return new Promise(function (resolve) {        // standalone page
      var inp = document.createElement("input");
      inp.type = "file";
      inp.accept = IMPC.ACCEPT;
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
  // A file → the preview (Promise<boolean>: a crossword was found). Also
  // the handle for a file opened with orOS.
  function importFile(file) {
    var K = window.OrosImportKit;
    if (!IMPC || !K) return Promise.resolve(false);
    return K.readFile(file, IMPC.MAX_FILE)
      .then(function (r) {
        var res = IMPC.parse(r);
        if (!res || res.error) {
          var code = res && res.error;
          showToast(t(code === "toobig" ? "imp.err.big" : STRINGS.en["imp.err." + code] ? "imp.err." + code : "imp.err.unknown"));
          return false;
        }
        previewImport(res, K.clean(r.name || file.name || "", 80));
        return true;
      })
      .catch(function (e) {
        showToast(t(e && e.message === "toobig" ? "imp.err.big" : "imp.err.read"));
        return false;
      });
  }

  function previewImport(res, fileName) {
    var z = res.z, id = IMPC.idOf(z), have = !!libEntry(id);
    var dlg = makeDialog("cw-imp");
    dlg.classList.add("wide");
    dlg.appendChild(el("div", "dlg-title", t("imp.title", { s: t(IMP_SRC[res.source]) })));
    if (fileName) dlg.appendChild(el("div", "dlg-msg cw-dim cw-small imp-file", fileName));
    dlg.appendChild(row(t("imp.name"), z.ti || t("lib.untitled", { w: z.w, h: z.h })));
    if (z.au) dlg.appendChild(row(t("imp.author"), z.au));
    if (z.cp) dlg.appendChild(row(t("imp.copy"), z.cp));
    dlg.appendChild(row(t("imp.size"), t("lib.size", { w: z.w, h: z.h })));
    dlg.appendChild(row(t("imp.clues"), t("imp.cluesN", { a: z.ca.length, d: z.cd.length })));
    dlg.appendChild(row(t("imp.lang"), langName(z.lg)));
    if (z.rb) dlg.appendChild(el("div", "dlg-msg cw-dim cw-small", t("imp.rebus", { n: z.rb.length })));
    if (z.ci) dlg.appendChild(el("div", "dlg-msg cw-dim cw-small", t("imp.circles", { n: z.ci.length })));
    if (z.nt) dlg.appendChild(el("div", "dlg-msg cw-small imp-notes", z.nt.slice(0, 300)));
    if (have) dlg.appendChild(el("div", "dlg-msg cw-small", t("imp.have")));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("imp.cancel"), "", function () { dlg.close(); }));
    var go = button(t(have ? "imp.open" : "imp.go"), "primary", function () {
      dlg.close();
      if (have) openImported(id); else runImport(z);
    });
    acts.appendChild(go);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    go.focus();
  }

  function runImport(z) {
    var r = IMPC.apply(data.lib, z, Date.now());
    if (!r.added) {
      if (r.full) showToast(t("imp.full", { n: IMPC.MAX_LIB }));
      else if (r.id && libEntry(r.id)) openImported(r.id);
      return r;
    }
    var before = { mode: prefs.mode, imp: prefs.imp };
    data.lib = r.lib;
    data = mergeCW(data, data);
    save();                                    // one write, one dirty mark
    openImported(r.id);
    var info = r.undo, used = false;
    undoToast(t("imp.done"), function () {
      if (used) return;
      used = true;
      var lib = IMPC.undo(data.lib, info, Date.now());
      if (lib) data.lib = lib; else delete data.lib;
      data = mergeCW(data, data);
      save();
      if (game && game.mode === "i" && game.id === r.id) {
        delete sessions["i:" + r.id];
        game = null;
        prefs.mode = before.mode; prefs.imp = before.imp; savePrefs();
        pickGame();
      }
      closeDialogs();
      renderAll();
      showToast(t("imp.undone"));
    });
    return r;
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "crossword", title: String(text) })) return;
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

  // ---------- Icons (R9: injected by JS) ----------
  var UI_ICONS = {
    new:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>',
    stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    back:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H9l-6 7 6 7h12z"/><path d="M17 9l-5 6M12 9l5 6"/></svg>',
    lib:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11M7.5 9.5 12 14l4.5-4.5"/><path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></svg>',
    dir:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h12M12 5l3 3-3 3"/><path d="M18 3v14M15 14l3 3 3-3"/></svg>'
  };

  // ---------- 9. Input ----------
  // Letters by key position (e.code), so the OS layout does not matter
  // (Greek works on an English layout and the other way round).
  function letterFor(e) {
    if (!game) return "";
    var m = /^Key([A-Z])$/.exec(e.code || "");
    if (game.lang === "el") {
      if (m) return EL_BY_CODE[e.code] || "";
      var g = normWord(e.key);
      return g.length === 1 && LETTERS.el.indexOf(g) >= 0 ? g : "";
    }
    if (m) return m[1];
    var l = normWord(e.key);
    return l.length === 1 && LETTERS.en.indexOf(l) >= 0 ? l : "";
  }

  function wirePointer() {
    $("grid").addEventListener("click", function (e) {
      var c = e.target.closest && e.target.closest(".cell");
      if (!c || !game) return;
      if (game.done) { gate(); return; }
      tapCell(+c.getAttribute("data-ix"));
    });
    $("grid").addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;          // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!game) return;
      if (e.shiftKey) {                                        // shortcuts by position, any layout
        var sc = { KeyN: function () { newPuzzle(null, null); }, KeyL: function () { check("letter"); },
          KeyW: function () { check("word"); }, KeyA: function () { check("all"); }, KeyR: reveal }[e.code];
        if (sc) { e.preventDefault(); sc(); return; }
        if (e.key !== "Tab") return;
      }
      var mv = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      if (mv) { e.preventDefault(); moveCursor(mv[0], mv[1]); return; }
      if (e.key === "Tab") { e.preventDefault(); jumpWord(e.shiftKey ? -1 : 1); return; }
      var a = document.activeElement;
      var onButton = a && a.tagName === "BUTTON" && !a.classList.contains("key");
      if (e.key === " " && !onButton) { e.preventDefault(); toggleDir(); return; }
      if (e.key === "Backspace") { e.preventDefault(); backspace(); return; }
      if (e.key === "Delete") { e.preventDefault(); clearCell(); return; }
      if (onButton && e.key === "Enter") return;
      var l = letterFor(e);
      if (l) { e.preventDefault(); typeLetter(l); }
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

  function wireScreenKeyboard() {
    $("kb").addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".key");
      if (!b || !game) return;
      var k = b.getAttribute("data-k");
      if (k === "back") backspace();
      else if (k === "dir") { if (gate()) toggleDir(); }
      else typeLetter(k);
    });
  }

  // ---------- 10. Sync slice + palette ----------
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
    api.registerSlice("crossword", sliceGet, sliceSet, STORAGE_KEY, mergeCW);
  }

  function sliceGet() {
    return mergeCW(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object") return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeCW(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    // a daily puzzle solved on another device (or a reset) shows here
    if (markElsewhere()) { saveSessions(); startClock(); }
    // the open imported crossword was removed on another device (Undo)
    if (prefs.mode === "i" && !libEntry(prefs.imp)) { game = null; pickGame(); }
    renderAll();
    // no toast on merge (sync feedback = taskbar dot)
  }

  // ---------- 11. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    [].forEach.call(document.querySelectorAll("#size-seg .seg-btn"), function (b) {
      var s = b.getAttribute("data-size");
      b.setAttribute("aria-label", t("size." + s));
      b.title = t("size." + s);
    });
    $("words").setAttribute("aria-label", t("words.label"));
    $("words-intro").textContent = t("words.intro");
    $("kb").setAttribute("aria-label", t("kb.label"));
    $("clock").title = t("st.time");
  }

  function paintStatic() {
    [["check-btn", "check", "btn.check"], ["new-btn", "new", "btn.new"],
     ["stats-btn", "stats", "btn.stats"], ["lib-btn", "lib", "btn.lib"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    var tb = $("theme-btn");
    tb.innerHTML = UI_ICONS.theme;
    tb.appendChild(el("span", "txt"));
    tb.title = t("btn.theme");
    $("clock-ico").innerHTML = UI_ICONS.clock;
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#lang-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () { setLangMode(b.getAttribute("data-lang"), prefs.mode); b.blur(); });
    });
    [].forEach.call(document.querySelectorAll("#mode-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () { setLangMode(prefs.lang, b.getAttribute("data-mode")); b.blur(); });
    });
    [].forEach.call(document.querySelectorAll("#size-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () { setSize(b.getAttribute("data-size")); b.blur(); });
    });
    $("theme-btn").addEventListener("click", function () { themesDialog(); $("theme-btn").blur(); });
    $("check-btn").addEventListener("click", function () { checkDialog(); $("check-btn").blur(); });
    $("new-btn").addEventListener("click", function () { newPuzzle(null, null); $("new-btn").blur(); });
    // Deep link from the Game Center: { daily: true } opens today's crossword.
    window.__orosOpenAt = function (tg) { if (tg && tg.daily) setLangMode(prefs.lang, "d"); };
    $("stats-btn").addEventListener("click", function () { statsDialog(); $("stats-btn").blur(); });
    wirePointer();
    wireScreenKeyboard();
    $("word-groups").addEventListener("click", function (e) {
      var li = e.target.closest && e.target.closest(".cl-i");
      if (li) tapClue(+li.getAttribute("data-w"));
    });
    $("lib-btn").addEventListener("click", function () { libDialog(); $("lib-btn").blur(); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { stopClock(); if (game) saveSessions(); return; }
      // A daily puzzle left open past midnight: a new one when the app comes back.
      if (game && game.mode === "d" && game.day !== today()) { pickGame(); renderAll(); return; }
      startClock();
    });
    window.addEventListener("pagehide", function () { if (game) saveSessions(); });
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
    loadSessions();
    var tg = DK ? DK.takeTarget("crossword") : null;
    if (tg && tg.daily) { prefs.mode = "d"; savePrefs(); }
    pickGame();
    renderAll();
    if (!game) showToast(t("toast.noWords"));
  }

  boot();
})();
