// ============================================================
// orOS Word Search — App logic (v1.0.0)
// Find the hidden words in a grid of letters.
//   - words in English or Greek (own switch, default = orOS language);
//     Greek in capitals without accents, final sigma as Σ
//   - 8×8 (easy: across and down), 12×12 (medium: + diagonals),
//     15×15 (hard: + backwards); a theme or random common words, or
//     one of your own themes (synced)
//   - select by dragging (touch or mouse) or with two taps (first and
//     last letter); keyboard: arrows + Enter/Space
//   - hint: circles the first letter of a word (no record then)
//   - Daily: one puzzle a day, the same on every device (from the date,
//     offline); Free play: as many as you like, records per size
// Data:
//   - synced slice "wordsearch" (oros-wordsearch-data): every daily
//     result per language (one per day: the better one wins), Free play
//     records as per-device rows + a reset stamp br, own themes LWW +
//     tombstones
//   - device-local (R10): oros-wordsearch-prefs (word language, mode,
//     size, theme), oros-wordsearch-session (the puzzles in progress),
//     oros-wordsearch-device (row id)
// Word lists: words-en.js / words-el.js (window.WORDSEARCH_WORDS).
// Sections:
//   1. Constants, i18n, helpers
//   2. Puzzle model (normalize, seeded random, generator, selection)
//   3. Synced data: load / save / normalize / merge (R5, R17, R26)
//   4. Device-local prefs + session
//   5. Game flow (new puzzle, pick, hint, finish, timer)
//   6. Render (toolbar, status, grid, word list)
//   7. Dialogs (result, statistics, themes, theme editor, confirm)
//   8. Toasts
//   9. Input (drag, taps, keys, Contract Β)
//  10. Sync slice + palette
//  11. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-wordsearch-data";
  var PREFS_KEY   = "oros-wordsearch-prefs";
  var SESSION_KEY = "oros-wordsearch-session";
  var DEVICE_KEY  = "oros-wordsearch-device";
  var DATA_VER    = 1;

  var LANGS = ["en", "el"];
  var MODES = ["d", "f"];
  var SIZES = ["e", "m", "h"];
  // n = grid side, k = words per puzzle, nd = directions allowed (a
  // prefix of DIRS), lo/hi = word lengths for random words.
  var LEVELS = {
    e: { n: 8,  k: 7,  nd: 2, lo: 4, hi: 7 },
    m: { n: 12, k: 11, nd: 4, lo: 4, hi: 10 },
    h: { n: 15, k: 15, nd: 8, lo: 5, hi: 10 }
  };
  // [row step, column step]: across, down, diagonal down, diagonal up,
  // then the same four backwards.
  var DIRS = [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1]];
  var DAILY_SIZE = "m";
  var THEME_IDS = ["animals", "food", "countries", "jobs", "home", "nature", "sports", "music",
    "school", "body", "clothes", "colours", "transport", "weather", "fruitveg", "sea", "city",
    "tools", "feelings", "holidays"];
  var LETTERS = { en: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", el: "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ" };
  var WORD_RE = { en: /^[A-Z]{3,15}$/, el: /^[Α-Ω]{3,15}$/ };
  var EPOCH_UTC = Date.UTC(2026, 0, 1);     // day 0 of the daily puzzles
  var MAX_DAY = 100000;
  var MAX_SEC = 360000;                     // 100 hours: longer times are capped
  var ID_RE = /^[a-z0-9]{6,40}$/;
  var NAME_LEN = 40, MAX_THEMES = 30, MAX_WORDS = 60, MIN_WORDS = 3;
  var COLORS = ["#e06c75", "#ecc75f", "#87cf3e", "#4fc4cf", "#6d4aff", "#e09ecf", "#f28c5a", "#9aa4b0"];

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
      "btn.new": "New puzzle (Shift+N)",
      "btn.hint": "Hint (H)",
      "btn.stats": "Statistics",
      "btn.theme": "Theme",
      "lang.en": "EN", "lang.el": "ΕΛ",
      "lang.enLong": "English words", "lang.elLong": "Greek words",
      "mode.d": "Daily", "mode.f": "Free",
      "size.e": "Easy, 8×8: across and down",
      "size.m": "Medium, 12×12: also diagonal",
      "size.h": "Hard, 15×15: also backwards",
      "sizeShort.e": "8×8", "sizeShort.m": "12×12", "sizeShort.h": "15×15",
      "theme.random": "Random words",
      "theme.animals": "Animals", "theme.food": "Food", "theme.countries": "Countries",
      "theme.jobs": "Jobs", "theme.home": "Home", "theme.nature": "Nature",
      "theme.sports": "Sports", "theme.music": "Music", "theme.school": "School",
      "theme.body": "Body", "theme.clothes": "Clothes", "theme.colours": "Colours",
      "theme.transport": "Transport", "theme.weather": "Weather",
      "theme.fruitveg": "Fruit & veg", "theme.sea": "Sea", "theme.city": "City",
      "theme.tools": "Tools", "theme.feelings": "Feelings", "theme.holidays": "Holidays",
      "st.daily": "Daily #{n} · {th}",
      "st.free": "{th} · {s}",
      "st.count": "{f}/{k} found",
      "st.time": "Time",
      "st.elsewhere": "Solved on another device in {t}",
      "grid.label": "Letter grid",
      "words.label": "Words to find",
      "cell.label": "{l}, row {r}, column {c}",
      "live.found": "Found {w}. {f} of {k}",
      "live.start": "First letter {l}, row {r}, column {c}",
      "live.done": "All words found in {t}",
      "res.titleD": "Daily #{n}",
      "res.titleF": "Free play · {s}",
      "res.solved": "Solved in {t}",
      "res.record": "New record!",
      "res.hinted": "With a hint: no record for this puzzle",
      "res.days": "Days solved",
      "res.streak": "Streak",
      "res.bestStreak": "Best streak",
      "res.bestDaily": "Best daily time",
      "res.solvedN": "Solved ({s})",
      "res.best": "Best time ({s})",
      "res.next": "A new daily puzzle tomorrow",
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
      "themes.title": "Theme · {l}",
      "themes.ready": "Ready themes",
      "themes.mine": "My themes",
      "themes.mineEmpty": "Your own word lists, for example for a class. They sync between your devices.",
      "themes.add": "New theme",
      "themes.edit": "Edit {name}",
      "themes.del": "Delete {name}",
      "themes.close": "Close",
      "edit.titleNew": "New theme",
      "edit.titleEdit": "Edit theme",
      "edit.name": "Name",
      "edit.words": "Words",
      "edit.hint": "One word per line (or separated by commas), 3–15 letters, {l} only. At least 3 words, at most 60.",
      "edit.save": "Save",
      "edit.cancel": "Cancel",
      "confirm.reset": "Delete the statistics on every device? Your own themes stay.",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Statistics reset",
      "toast.newPuzzle": "New puzzle",
      "toast.undo": "Undo",
      "toast.already": "{w} is already found",
      "toast.line": "Pick the last letter in a straight line",
      "toast.hintNoRecord": "Hint: no record for this puzzle",
      "toast.hintShown": "The circled letter starts a word",
      "toast.dailyDone": "Today's puzzle is done: a new one tomorrow, or try Free play",
      "toast.over": "This puzzle is done: start a new one (Shift+N)",
      "toast.dailyOne": "Daily has one puzzle a day: for more, switch to Free",
      "toast.dailyFixed": "The daily puzzle is the same for everyone: size and theme change in Free play",
      "toast.save": "Could not save: storage is full",
      "toast.noWords": "The word list did not load",
      "toast.needName": "Give the theme a name",
      "toast.fewWords": "A theme needs at least 3 words of 3–15 letters",
      "toast.skipped": "Skipped {n}: {list}",
      "toast.tooMany": "Only the first 60 words are kept",
      "toast.maxThemes": "At most {n} own themes",
      "toast.themeSaved": "Theme saved",
      "toast.themeDeleted": "Theme deleted",
      "toast.themeGone": "That theme was deleted: random words instead",
      "toast.fewFit": "Only {n} of the theme's words fit this grid"
    },
    el: {
      "btn.new": "Νέο κρυπτόλεξο (Shift+N)",
      "btn.hint": "Βοήθεια (H)",
      "btn.stats": "Στατιστικά",
      "btn.theme": "Θέμα",
      "lang.en": "EN", "lang.el": "ΕΛ",
      "lang.enLong": "Αγγλικές λέξεις", "lang.elLong": "Ελληνικές λέξεις",
      "mode.d": "Ημέρας", "mode.f": "Ελεύθερο",
      "size.e": "Εύκολο, 8×8: οριζόντια και κάθετα",
      "size.m": "Μέτριο, 12×12: και διαγώνια",
      "size.h": "Δύσκολο, 15×15: και ανάποδα",
      "sizeShort.e": "8×8", "sizeShort.m": "12×12", "sizeShort.h": "15×15",
      "theme.random": "Τυχαίες λέξεις",
      "theme.animals": "Ζώα", "theme.food": "Φαγητά", "theme.countries": "Χώρες",
      "theme.jobs": "Επαγγέλματα", "theme.home": "Σπίτι", "theme.nature": "Φύση",
      "theme.sports": "Αθλήματα", "theme.music": "Μουσική", "theme.school": "Σχολείο",
      "theme.body": "Σώμα", "theme.clothes": "Ρούχα", "theme.colours": "Χρώματα",
      "theme.transport": "Μεταφορικά", "theme.weather": "Καιρός",
      "theme.fruitveg": "Φρούτα και λαχανικά", "theme.sea": "Θάλασσα", "theme.city": "Πόλη",
      "theme.tools": "Εργαλεία", "theme.feelings": "Συναισθήματα", "theme.holidays": "Διακοπές",
      "st.daily": "Ημέρας #{n} · {th}",
      "st.free": "{th} · {s}",
      "st.count": "{f}/{k} βρέθηκαν",
      "st.time": "Χρόνος",
      "st.elsewhere": "Λύθηκε σε άλλη συσκευή σε {t}",
      "grid.label": "Πλέγμα γραμμάτων",
      "words.label": "Λέξεις για εύρεση",
      "cell.label": "{l}, γραμμή {r}, στήλη {c}",
      "live.found": "Βρέθηκε: {w}. {f} από {k}",
      "live.start": "Πρώτο γράμμα {l}, γραμμή {r}, στήλη {c}",
      "live.done": "Βρέθηκαν όλες οι λέξεις σε {t}",
      "res.titleD": "Ημέρας #{n}",
      "res.titleF": "Ελεύθερο · {s}",
      "res.solved": "Λύθηκε σε {t}",
      "res.record": "Νέο ρεκόρ!",
      "res.hinted": "Με βοήθεια: χωρίς ρεκόρ σε αυτό το κρυπτόλεξο",
      "res.days": "Μέρες που λύθηκαν",
      "res.streak": "Σερί",
      "res.bestStreak": "Καλύτερο σερί",
      "res.bestDaily": "Καλύτερος χρόνος ημέρας",
      "res.solvedN": "Λυμένα ({s})",
      "res.best": "Καλύτερος χρόνος ({s})",
      "res.next": "Νέο κρυπτόλεξο ημέρας αύριο",
      "res.newPuzzle": "Νέο κρυπτόλεξο",
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
      "themes.title": "Θέμα · {l}",
      "themes.ready": "Έτοιμα θέματα",
      "themes.mine": "Δικά μου θέματα",
      "themes.mineEmpty": "Δικές σου λίστες λέξεων, π.χ. για μια τάξη. Συγχρονίζονται στις συσκευές σου.",
      "themes.add": "Νέο θέμα",
      "themes.edit": "Αλλαγή: {name}",
      "themes.del": "Διαγραφή: {name}",
      "themes.close": "Κλείσιμο",
      "edit.titleNew": "Νέο θέμα",
      "edit.titleEdit": "Αλλαγή θέματος",
      "edit.name": "Όνομα",
      "edit.words": "Λέξεις",
      "edit.hint": "Μία λέξη σε κάθε γραμμή (ή με κόμματα), 3–15 γράμματα, μόνο {l}. Τουλάχιστον 3 λέξεις, το πολύ 60.",
      "edit.save": "Αποθήκευση",
      "edit.cancel": "Άκυρο",
      "confirm.reset": "Να διαγραφούν τα στατιστικά σε όλες τις συσκευές; Τα δικά σου θέματα μένουν.",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα στατιστικά μηδενίστηκαν",
      "toast.newPuzzle": "Νέο κρυπτόλεξο",
      "toast.undo": "Αναίρεση",
      "toast.already": "Το {w} το έχεις ήδη βρει",
      "toast.line": "Διάλεξε το τελευταίο γράμμα σε ευθεία γραμμή",
      "toast.hintNoRecord": "Βοήθεια: χωρίς ρεκόρ σε αυτό το κρυπτόλεξο",
      "toast.hintShown": "Από το κυκλωμένο γράμμα ξεκινά μια λέξη",
      "toast.dailyDone": "Το κρυπτόλεξο της ημέρας τελείωσε: νέο αύριο, ή δοκίμασε το Ελεύθερο",
      "toast.over": "Αυτό το κρυπτόλεξο τελείωσε: ξεκίνα νέο (Shift+N)",
      "toast.dailyOne": "Το Ημέρας έχει ένα κρυπτόλεξο τη μέρα: για περισσότερα, πήγαινε στο Ελεύθερο",
      "toast.dailyFixed": "Το κρυπτόλεξο της ημέρας είναι ίδιο για όλους: μέγεθος και θέμα αλλάζουν στο Ελεύθερο",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "toast.noWords": "Η λίστα λέξεων δεν φορτώθηκε",
      "toast.needName": "Δώσε ένα όνομα στο θέμα",
      "toast.fewWords": "Ένα θέμα θέλει τουλάχιστον 3 λέξεις των 3–15 γραμμάτων",
      "toast.skipped": "Παραλείφθηκαν {n}: {list}",
      "toast.tooMany": "Κρατήθηκαν μόνο οι πρώτες 60 λέξεις",
      "toast.maxThemes": "Το πολύ {n} δικά σου θέματα",
      "toast.themeSaved": "Το θέμα αποθηκεύτηκε",
      "toast.themeDeleted": "Το θέμα διαγράφηκε",
      "toast.themeGone": "Αυτό το θέμα διαγράφηκε: τυχαίες λέξεις στη θέση του",
      "toast.fewFit": "Μόνο {n} λέξεις του θέματος χωρούν σε αυτό το πλέγμα"
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

  // crypto RNG with rejection sampling (same as Dice / Memory / Wordle)
  function randInt(n) {
    var buf = new Uint32Array(1);
    var lim = 0xFFFFFFFF - (0xFFFFFFFF % n);
    while (true) {
      crypto.getRandomValues(buf);
      if (buf[0] < lim) return buf[0] % n;
    }
  }

  function newId() {
    var r = new Uint32Array(2);
    crypto.getRandomValues(r);
    return Date.now().toString(36) + r[0].toString(36) + r[1].toString(36).slice(0, 4);
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("wordsearch.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Puzzle model ----------
  // Upper case, no accents or diaeresis, final sigma as Σ, letters only.
  function normWord(s) {
    s = String(s || "");
    if (s.normalize) s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return s.toUpperCase().replace(/ς/g, "Σ").replace(/[^A-ZΑ-Ω]/g, "");
  }

  // Seeded random numbers: FNV-1a hash of a string → mulberry32 stream.
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

  // Filler letters weighted by how often each letter appears in the
  // language's common words: { letters, cum[] }.
  function letterWeights(lang, words) {
    var letters = LETTERS[lang], counts = [], cum = [], sum = 0, i;
    for (i = 0; i < letters.length; i++) counts.push(1);
    words.forEach(function (w) {
      for (var j = 0; j < w.length; j++) {
        var k = letters.indexOf(w[j]);
        if (k >= 0) counts[k]++;
      }
    });
    for (i = 0; i < counts.length; i++) { sum += counts[i]; cum.push(sum); }
    return { letters: letters, cum: cum };
  }
  function pickLetter(wt, rng) {
    var x = rng() * wt.cum[wt.cum.length - 1];
    for (var i = 0; i < wt.cum.length; i++) if (x < wt.cum[i]) return wt.letters[i];
    return wt.letters[wt.letters.length - 1];
  }

  // Cell indexes of a placed word { w, r, c, d } in an n×n grid.
  function cellsOf(p, n) {
    var out = [], dr = DIRS[p.d][0], dc = DIRS[p.d][1];
    for (var i = 0; i < p.w.length; i++) out.push((p.r + dr * i) * n + (p.c + dc * i));
    return out;
  }

  function reversed(w) { return w.split("").reverse().join(""); }

  // Two words that would show up inside each other (forwards or
  // backwards) can never be in one puzzle: one would appear twice.
  function clash(a, b) {
    return a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0 ||
      a.indexOf(reversed(b)) >= 0 || b.indexOf(reversed(a)) >= 0;
  }

  // Every place where w fits: [r, c, d, overlap]; a word never lies
  // completely on letters that are already there.
  function placements(cells, n, nd, w) {
    var out = [];
    for (var d = 0; d < nd; d++) {
      var dr = DIRS[d][0], dc = DIRS[d][1];
      for (var r = 0; r < n; r++) {
        var r2 = r + dr * (w.length - 1);
        if (r2 < 0 || r2 >= n) continue;
        for (var c = 0; c < n; c++) {
          var c2 = c + dc * (w.length - 1);
          if (c2 < 0 || c2 >= n) continue;
          var ov = 0, ok = true;
          for (var i = 0; i < w.length; i++) {
            var x = cells[(r + dr * i) * n + (c + dc * i)];
            if (x === "") continue;
            if (x !== w[i]) { ok = false; break; }
            ov++;
          }
          if (ok && ov < w.length) out.push([r, c, d, ov]);
        }
      }
    }
    return out;
  }

  // How many times w can be read in the grid, in any of the 8
  // directions (a palindrome read both ways counts once).
  function occurrences(grid, n, w) {
    var seen = {}, count = 0, L = w.length;
    for (var d = 0; d < 8; d++) {
      var dr = DIRS[d][0], dc = DIRS[d][1];
      for (var r = 0; r < n; r++) {
        var r2 = r + dr * (L - 1);
        if (r2 < 0 || r2 >= n) continue;
        for (var c = 0; c < n; c++) {
          var c2 = c + dc * (L - 1);
          if (c2 < 0 || c2 >= n) continue;
          var i = 0;
          while (i < L && grid[(r + dr * i) * n + (c + dc * i)] === w[i]) i++;
          if (i < L) continue;
          var a = r * n + c, b = r2 * n + c2, key = Math.min(a, b) + "-" + Math.max(a, b);
          if (!seen[key]) { seen[key] = true; count++; }
        }
      }
    }
    return count;
  }

  // Build a puzzle from a word pool: up to k words, each found exactly
  // once in the grid, in the first nd directions; overlaps where letters
  // match; filler weighted by letter frequency. Deterministic for one
  // rng stream. Returns { n, grid, words: [{ w, r, c, d }] } or null.
  function generate(pool, n, nd, k, wt, rng) {
    var words = [], seenW = {};
    pool.forEach(function (w) {
      if (w.length >= 3 && w.length <= n && !seenW[w]) { seenW[w] = true; words.push(w); }
    });
    if (!words.length) return null;
    var best = null;
    for (var attempt = 0; attempt < 40; attempt++) {
      var cells = [], placed = [], i;
      for (i = 0; i < n * n; i++) cells.push("");
      var order = shuffled(words, rng);
      for (i = 0; i < order.length && placed.length < k; i++) {
        var w = order[i];
        if (placed.some(function (p) { return clash(p.w, w); })) continue;
        var opts = placements(cells, n, nd, w);
        if (!opts.length) continue;
        var crossing = opts.filter(function (o) { return o[3] > 0; });
        var from = crossing.length && rng() < 0.55 ? crossing : opts;
        var o = from[Math.floor(rng() * from.length)];
        var p = { w: w, r: o[0], c: o[1], d: o[2] };
        cellsOf(p, n).forEach(function (ix, j) { cells[ix] = w[j]; });
        placed.push(p);
      }
      if (!placed.length || (best && placed.length <= best.words.length)) continue;
      for (var f = 0; f < 8; f++) {
        var grid = cells.map(function (x) { return x || pickLetter(wt, rng); }).join("");
        if (placed.every(function (q) { return occurrences(grid, n, q.w) === 1; })) {
          best = { n: n, grid: grid, words: placed };
          break;
        }
      }
      if (best && best.words.length >= Math.min(k, words.length)) break;
    }
    return best;
  }

  // Word pool for a puzzle: a theme's words, or random common words of
  // the level's lengths (a few times more than needed).
  function randomPool(common, lv, rng) {
    var out = [], seen = {}, tries = 0;
    while (out.length < lv.k * 4 && tries < lv.k * 40) {
      tries++;
      var len = lv.lo + Math.floor(rng() * (lv.hi - lv.lo + 1));
      var list = common[len] || [];
      if (!list.length) continue;
      var w = list[Math.floor(rng() * list.length)];
      if (!seen[w]) { seen[w] = true; out.push(w); }
    }
    return out;
  }
  function buildPuzzle(L, size, theme, words, rng) {
    var lv = LEVELS[size];
    var pool = words || (theme === "random" ? randomPool(L.common, lv, rng) : (L.themes[theme] || []));
    return generate(pool, lv.n, lv.nd, lv.k, L.weights, rng);
  }

  // Day number of a local date (day 0 = 1 Jan 2026), same everywhere for
  // the same calendar day.
  function dayIndex(d) {
    return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH_UTC) / 86400000);
  }
  // The daily puzzle: theme and grid from the date and the language only.
  function dailyPuzzle(L, lang, day) {
    var rng = seeded(hashStr("wordsearch:" + lang + ":" + day));
    var theme = THEME_IDS[Math.floor(rng() * THEME_IDS.length)];
    var pz = buildPuzzle(L, DAILY_SIZE, theme, null, rng);
    if (pz) pz.theme = theme;
    return pz;
  }

  // Straight line from cell a toward (r, c), snapped to the nearest of
  // the 8 directions and kept inside the grid. Cells are { r, c }.
  function snapEnd(a, r, c, n) {
    var dr = r - a.r, dc = c - a.c;
    if (!dr && !dc) return { r: a.r, c: a.c };
    var oct = Math.round(Math.atan2(dr, dc) / (Math.PI / 4));
    var sr = Math.round(Math.sin(oct * Math.PI / 4)), sc = Math.round(Math.cos(oct * Math.PI / 4));
    var len = sr && sc ? Math.round((Math.abs(dr) + Math.abs(dc)) / 2) : Math.abs(sr ? dr : dc);
    while (len > 0 && (a.r + sr * len < 0 || a.r + sr * len >= n || a.c + sc * len < 0 || a.c + sc * len >= n)) len--;
    return { r: a.r + sr * len, c: a.c + sc * len };
  }
  function inLine(a, b) {
    var dr = b.r - a.r, dc = b.c - a.c;
    return (dr || dc) && (!dr || !dc || Math.abs(dr) === Math.abs(dc));
  }
  // The index of the word whose first and last letters are a and b (in
  // either order), or -1.
  function matchWord(words, n, a, b) {
    var ia = a.r * n + a.c, ib = b.r * n + b.c;
    for (var i = 0; i < words.length; i++) {
      var cs = cellsOf(words[i], n), s = cs[0], e = cs[cs.length - 1];
      if ((s === ia && e === ib) || (s === ib && e === ia)) return i;
    }
    return -1;
  }

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
  var LISTS = {};      // lang → { common: { len: [...] }, themes: { id: [...] }, weights }
  function splitList(s) { return String(s || "").split(" ").filter(function (w) { return w; }); }
  function lists(lang) {
    if (LISTS[lang]) return LISTS[lang];
    var src = window.WORDSEARCH_WORDS && window.WORDSEARCH_WORDS[lang];
    if (!src || !src.common || !src.themes) return null;
    var common = {}, themes = {}, all = [];
    Object.keys(src.common).forEach(function (k) { common[k] = splitList(src.common[k]); all = all.concat(common[k]); });
    THEME_IDS.forEach(function (id) { themes[id] = splitList(src.themes[id]); });
    LISTS[lang] = { common: common, themes: themes, weights: letterWeights(lang, all) };
    return LISTS[lang];
  }

  // ---------- 3. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                     // max-merged
  //   days: { "en:<day>"|"el:<day>": { b: <epoch>, t: seconds, h: 0|1 hint } },
  //   rows: { <deviceId>: { b: <epoch>, s: { "<lang>:<size>": { n, t, d } } } },
  //   themes: [ { id, m, name, lang, words[] } ] sorted by id,
  //   tombs: { <themeId>: deletedAt }
  // }
  // Daily: one result per day and language; the newer epoch wins, equal
  // epochs keep the better result (no hint first, then the shorter time).
  // Free play: each device only grows its own row: solved n (max) and the
  // best time t in seconds with its date d (0/0 = none yet; the shorter
  // time wins, then the earlier date). Entries older than br drop. Own
  // themes: LWW per id by m, tombstones max-merged, delete wins ties, a
  // newer edit resurrects (R17). A join: symmetric, associative,
  // idempotent (R5, R26).
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, days: {}, rows: {}, themes: [], tombs: {} }; }

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

  function normName(s) {
    return String(s || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, NAME_LEN).trim();
  }
  // Words of an own theme: normalized, of the theme's alphabet, 3–15
  // letters, no repeats, at most MAX_WORDS, order kept.
  function normThemeWords(list, lang) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (s) {
      if (typeof s !== "string" || out.length >= MAX_WORDS) return;
      var w = normWord(s);
      if (WORD_RE[lang].test(w) && !seen[w]) { seen[w] = true; out.push(w); }
    });
    return out;
  }
  function normTheme(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
        !isInt(x.m) || x.m < 0 || LANGS.indexOf(x.lang) < 0) return null;
    var name = normName(x.name), words = normThemeWords(x.words, x.lang);
    if (!name || words.length < MIN_WORDS) return null;
    return { id: x.id, m: x.m, name: name, lang: x.lang, words: words };
  }

  function mergeWS(A, B) {
    var a = A || {}, b = B || {};
    var br = Math.max(isInt(a.br) && a.br > 0 ? a.br : 0, isInt(b.br) && b.br > 0 ? b.br : 0);
    var days = {}, rows = {}, tombs = {}, best = {};
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
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object") return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    [a.themes, b.themes].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var x = normTheme(raw);
        if (!x) return;
        var cur = best[x.id];
        if (!cur || x.m > cur.m || (x.m === cur.m && JSON.stringify(x) > JSON.stringify(cur))) best[x.id] = x;
      });
    });
    var sd = {}, sr = {}, st = {}, themes = [];
    Object.keys(days).sort(cmpStr).forEach(function (k) { sd[k] = days[k]; });
    Object.keys(rows).sort(cmpStr).forEach(function (id) { sr[id] = rows[id]; });
    Object.keys(best).sort(cmpStr).forEach(function (id) {
      if (id in tombs && tombs[id] >= best[id].m) return;
      themes.push(best[id]);
    });
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { st[id] = tombs[id]; });
    return { ver: DATA_VER, br: br, days: sd, rows: sr, themes: themes, tombs: st };
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
          data = mergeWS(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] wordsearch: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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
    if (g.mode === "d") {
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
    data = mergeWS(data, data);
    save();
    return record;
  }

  // ---------- 4. Device-local prefs + session ----------
  var prefs = { lang: LANG, mode: "d", size: "m", theme: "random" };

  function themeOk(th) {
    return th === "random" || THEME_IDS.indexOf(th) >= 0 || (/^u:/.test(th) && ID_RE.test(th.slice(2)));
  }
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (LANGS.indexOf(p.lang) >= 0) prefs.lang = p.lang;
        if (MODES.indexOf(p.mode) >= 0) prefs.mode = p.mode;
        if (SIZES.indexOf(p.size) >= 0) prefs.size = p.size;
        if (typeof p.theme === "string" && themeOk(p.theme)) prefs.theme = p.theme;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // One puzzle per language and mode:
  // { lang, mode, day, size, theme, tname, n, grid, words[{w,r,c,d}],
  //   found[idx in order], hint (idx or -1), hinted, ms, done, ext }
  // ext: solved on another device (the grid is shown solved here).
  var sessions = {};
  var game = null;

  function validGame(g, key) {
    if (!g || typeof g !== "object" || LANGS.indexOf(g.lang) < 0 || MODES.indexOf(g.mode) < 0 ||
        key !== g.lang + ":" + g.mode || SIZES.indexOf(g.size) < 0 || !isInt(g.day) ||
        typeof g.theme !== "string" || !themeOk(g.theme) || typeof g.tname !== "string" ||
        g.n !== LEVELS[g.size].n || typeof g.grid !== "string" || g.grid.length !== g.n * g.n ||
        !Array.isArray(g.words) || !g.words.length || g.words.length > 30 || !Array.isArray(g.found) ||
        !isInt(g.hint) || typeof g.hinted !== "boolean" || !isInt(g.ms) || g.ms < 0 ||
        typeof g.done !== "boolean" || typeof g.ext !== "boolean") return false;
    var letters = LETTERS[g.lang], i;
    for (i = 0; i < g.grid.length; i++) if (letters.indexOf(g.grid[i]) < 0) return false;
    for (i = 0; i < g.words.length; i++) {
      var p = g.words[i];
      if (!p || typeof p.w !== "string" || !WORD_RE[g.lang].test(p.w) || !isInt(p.r) || !isInt(p.c) ||
          !isInt(p.d) || p.d < 0 || p.d >= LEVELS[g.size].nd || p.w.length > g.n) return false;
      var er = p.r + DIRS[p.d][0] * (p.w.length - 1), ec = p.c + DIRS[p.d][1] * (p.w.length - 1);
      if (p.r < 0 || p.c < 0 || p.r >= g.n || p.c >= g.n || er < 0 || ec < 0 || er >= g.n || ec >= g.n) return false;
      var cs = cellsOf(p, g.n);
      for (var j = 0; j < cs.length; j++) if (g.grid[cs[j]] !== p.w[j]) return false;
    }
    var seen = {};
    for (i = 0; i < g.found.length; i++) {
      var f = g.found[i];
      if (!isInt(f) || f < 0 || f >= g.words.length || seen[f]) return false;
      seen[f] = true;
    }
    return g.hint >= -1 && g.hint < g.words.length;
  }
  function loadSessions() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (s && typeof s === "object") {
        Object.keys(s).forEach(function (k) { if (validGame(s[k], k)) sessions[k] = s[k]; });
      }
    } catch (e) {}
  }
  function saveSessions() {
    if (game) {
      foldTime();
      sessions[game.lang + ":" + game.mode] = game;
    }
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(sessions)); } catch (e) {}
  }

  // ---------- 5. Game flow ----------
  function today() { return dayIndex(new Date()); }

  function ownTheme(id) {
    for (var i = 0; i < data.themes.length; i++) if (data.themes[i].id === id) return data.themes[i];
    return null;
  }

  function freshGame(lang, mode, size, theme) {
    var L = lists(lang);
    if (!L) return null;
    var d = today(), pz, tname = "", words = null;
    if (mode === "d") {
      pz = dailyPuzzle(L, lang, d);
      if (!pz) return null;
      size = DAILY_SIZE;
      theme = pz.theme;
    } else {
      if (/^u:/.test(theme)) {
        var own = ownTheme(theme.slice(2));
        if (own && own.lang === lang) { words = own.words; tname = own.name; }
        else { theme = "random"; showToast(t("toast.themeGone")); }
      }
      pz = buildPuzzle(L, size, theme, words, seeded(randInt(0x7fffffff)));
      if (!pz) return null;
      if (words && pz.words.length < Math.min(LEVELS[size].k, words.length)) {
        showToast(t("toast.fewFit", { n: pz.words.length }));
      }
    }
    return { lang: lang, mode: mode, day: d, size: size, theme: theme, tname: tname, n: pz.n,
      grid: pz.grid, words: pz.words, found: [], hint: -1, hinted: false, ms: 0, done: false, ext: false };
  }

  // The puzzle for the current language and mode: the saved one, unless
  // it is an old daily puzzle; a new one otherwise.
  function pickGame() {
    stopClock();
    var key = prefs.lang + ":" + prefs.mode, g = sessions[key];
    if (g && g.mode === "d" && g.day !== today()) g = null;
    if (!g) g = freshGame(prefs.lang, prefs.mode, prefs.size, prefs.theme);
    game = g;
    anchor = null;
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
  // A daily puzzle solved elsewhere and not started here: show it solved.
  // After a reset that result is gone: the puzzle is playable again.
  function markElsewhere() {
    if (!game || game.mode !== "d") return false;
    var r = dailyResult(game);
    if (r && !game.done && !game.found.length) {
      stopClock();
      game.done = true; game.ext = true;
      game.found = game.words.map(function (w, i) { return i; });
      game.hint = -1;
      return true;
    }
    if (!r && game.ext) {
      game.done = false; game.ext = false; game.found = []; game.ms = 0; game.hint = -1; game.hinted = false;
      return true;
    }
    return false;
  }

  function inProgress() { return !!(game && !game.done && (game.found.length > 0 || elapsed() > 15000)); }

  // A selection from cell a to cell b.
  function tryPick(a, b) {
    if (!game || !gate()) return;
    if (!inLine(a, b)) { showToast(t("toast.line")); return; }
    var i = matchWord(game.words, game.n, a, b);
    if (i < 0) { flashMiss(a, b); return; }
    if (game.found.indexOf(i) >= 0) { showToast(t("toast.already", { w: game.words[i].w })); return; }
    game.found.push(i);
    if (game.hint === i) game.hint = -1;
    var all = game.found.length === game.words.length;
    if (all) finish();
    else saveSessions();
    renderAll();
    live(t("live.found", { w: game.words[i].w, f: game.found.length, k: game.words.length }));
    pulseWord(i);
  }

  function finish() {
    var sec = elapsed() / 1000;
    stopClock();
    game.done = true;
    saveSessions();
    var record = countGame(game, sec);
    live(t("live.done", { t: fmtTime(sec) }));
    setTimeout(function () { resultDialog(record); }, reduced ? 50 : 650);
  }

  // Can the grid act now? (R28: say why not)
  function gate() {
    if (document.querySelector("dialog[open]")) return false;
    if (game.done) {
      showToast(t(game.mode === "d" ? "toast.dailyDone" : "toast.over"));
      return false;
    }
    return true;
  }

  function hint() {
    if (!game || !gate()) return;
    if (game.hint >= 0 && game.found.indexOf(game.hint) < 0) { showToast(t("toast.hintShown")); pulseHint(); return; }
    var left = [];
    game.words.forEach(function (w, i) { if (game.found.indexOf(i) < 0) left.push(i); });
    if (!left.length) return;
    game.hint = left[randInt(left.length)];
    var first = !game.hinted;
    game.hinted = true;
    saveSessions();
    renderAll();
    pulseHint();
    var w = game.words[game.hint];
    live(t("live.start", { l: w.w[0], r: w.r + 1, c: w.c + 1 }));
    if (first) showToast(t("toast.hintNoRecord"));
  }

  // Free play: a new puzzle. One in progress is never lost silently (R14).
  function newPuzzle(size, theme) {
    if (!game && !lists(prefs.lang)) { showToast(t("toast.noWords")); return; }
    if (prefs.mode === "d") { showToast(t(game && game.done ? "toast.dailyDone" : "toast.dailyOne")); return; }
    closeDialogs();
    var prev = inProgress() ? JSON.parse(JSON.stringify(game)) : null;
    if (prev) { foldTime(); prev.ms = game.ms; }
    stopClock();
    var g = freshGame(prefs.lang, "f", size || prefs.size, theme || prefs.theme);
    if (!g) { showToast(t("toast.noWords")); startClock(); return; }
    game = g;
    anchor = null;
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
        anchor = null;
        saveSessions();
        startClock();
        renderAll();
      });
    } else {
      live(t("toast.newPuzzle"));
    }
  }

  function setLangMode(lang, mode) {
    if (game && lang === game.lang && mode === game.mode) return;   // visible active state
    if (game) saveSessions();
    prefs.lang = lang; prefs.mode = mode; savePrefs();
    closeDialogs();
    pickGame();
    renderAll();
    if (!game) showToast(t("toast.noWords"));
  }

  function setSize(size) {
    if (prefs.mode === "d") { showToast(t("toast.dailyFixed")); return; }
    if (game && game.size === size) return;
    newPuzzle(size, null);
  }
  function setTheme(theme) {
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
  var SVGNS = "http://www.w3.org/2000/svg";
  var anchor = null;      // first tap { r, c }
  var drag = null;        // { id, a, b, moved }
  var cursor = null;      // keyboard cursor { r, c }
  var miss = null;        // { a, b } shown briefly

  function renderAll() {
    renderToolbar();
    renderStatus();
    renderGrid();
    renderWords();
  }

  function themeName(g) {
    var th = g ? g.theme : prefs.theme;
    if (th === "random") return t("theme.random");
    if (/^u:/.test(th)) {
      var own = ownTheme(th.slice(2));
      return own ? own.name : (g && g.tname) || t("theme.random");
    }
    return t("theme." + th);
  }

  function renderToolbar() {
    var size = game ? game.size : prefs.size;
    [["#lang-seg", "data-lang", prefs.lang], ["#mode-seg", "data-mode", prefs.mode], ["#size-seg", "data-size", size]]
      .forEach(function (x) {
        [].forEach.call(document.querySelectorAll(x[0] + " .seg-btn"), function (b) {
          var on = b.getAttribute(x[1]) === x[2];
          b.classList.toggle("active", on);
          b.setAttribute("aria-pressed", on ? "true" : "false");
        });
      });
    $("size-seg").classList.toggle("fixed", prefs.mode === "d");
    var tb = $("theme-btn");
    tb.lastChild.textContent = themeName(game);
    tb.classList.toggle("fixed", prefs.mode === "d");
    $("new-btn").disabled = prefs.mode === "d";
  }

  function renderStatus() {
    if (!game) { $("info").textContent = t("toast.noWords"); $("count").textContent = ""; return; }
    var s = t("sizeShort." + game.size);
    $("info").textContent = game.mode === "d" ? t("st.daily", { n: game.day + 1, th: themeName(game) })
      : t("st.free", { th: themeName(game), s: s });
    var r = game.ext ? dailyResult(game) : null;
    $("count").textContent = r ? t("st.elsewhere", { t: fmtTime(r.t) })
      : t("st.count", { f: game.found.length, k: game.words.length });
    $("count").className = game.done ? "done" : "";
    renderTime();
  }
  function renderTime() {
    var n = $("time");
    if (!n) return;
    var r = game && game.ext ? dailyResult(game) : null;
    n.textContent = fmtTime(r ? r.t : elapsed() / 1000);
  }

  // Grid: one div per cell (letters) + an SVG layer for the lines.
  function buildGrid() {
    var el = $("grid"), n = game.n;
    el.innerHTML = "";
    el.style.setProperty("--n", n);
    el.setAttribute("data-n", n);
    el.setAttribute("aria-label", t("grid.label"));
    for (var r = 0; r < n; r++) {
      var row = document.createElement("div");
      row.className = "g-row";
      row.setAttribute("role", "row");
      for (var c = 0; c < n; c++) {
        var cell = document.createElement("div");
        cell.className = "cell";
        cell.setAttribute("role", "gridcell");
        row.appendChild(cell);
      }
      el.appendChild(row);
    }
    var svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("id", "marks");
    svg.setAttribute("viewBox", "0 0 " + n + " " + n);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    el.appendChild(svg);
    el.setAttribute("data-key", game.grid);
  }

  function renderGrid() {
    var el = $("grid");
    if (!game) { el.innerHTML = ""; el.removeAttribute("data-key"); return; }
    if (el.getAttribute("data-key") !== game.grid) buildGrid();
    var n = game.n, found = {};
    game.found.forEach(function (i) { cellsOf(game.words[i], n).forEach(function (ix) { found[ix] = true; }); });
    var rows = el.querySelectorAll(".g-row");
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        var cell = rows[r].children[c], ix = r * n + c, l = game.grid[ix];
        if (cell.textContent !== l) cell.textContent = l;
        cell.classList.toggle("found", !!found[ix]);
        cell.classList.toggle("cur", !!(cursor && cursor.r === r && cursor.c === c));
        cell.setAttribute("aria-label", t("cell.label", { l: l, r: r + 1, c: c + 1 }));
      }
    }
    renderMarks();
  }

  function line(svg, a, b, color, cls) {
    var ln = document.createElementNS(SVGNS, "line");
    ln.setAttribute("x1", a.c + 0.5); ln.setAttribute("y1", a.r + 0.5);
    ln.setAttribute("x2", b.c + 0.5); ln.setAttribute("y2", b.r + 0.5);
    ln.setAttribute("class", cls);
    if (color) ln.style.stroke = color;
    svg.appendChild(ln);
    return ln;
  }
  function ring(svg, p, cls) {
    var ci = document.createElementNS(SVGNS, "circle");
    ci.setAttribute("cx", p.c + 0.5); ci.setAttribute("cy", p.r + 0.5); ci.setAttribute("r", 0.42);
    ci.setAttribute("class", cls);
    svg.appendChild(ci);
    return ci;
  }
  function ends(p, n) {
    var cs = cellsOf(p, n), s = cs[0], e = cs[cs.length - 1];
    return [{ r: Math.floor(s / n), c: s % n }, { r: Math.floor(e / n), c: e % n }];
  }
  function renderMarks() {
    var svg = $("marks");
    if (!svg || !game) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    game.found.forEach(function (i, k) {
      var e = ends(game.words[i], game.n);
      line(svg, e[0], e[1], COLORS[k % COLORS.length], "hl").setAttribute("data-w", i);
    });
    if (game.hint >= 0 && game.found.indexOf(game.hint) < 0) {
      ring(svg, ends(game.words[game.hint], game.n)[0], "hint");
    }
    if (miss) line(svg, miss.a, miss.b, null, "sel miss");
    if (drag && drag.moved) line(svg, drag.a, drag.b, null, "sel");
    if (anchor) ring(svg, anchor, "anchor");
  }

  function flashMiss(a, b) {
    miss = { a: a, b: b };
    renderMarks();
    setTimeout(function () { miss = null; renderMarks(); }, reduced ? 250 : 450);
  }
  function pulseWord(i) {
    if (reduced) return;
    var ln = document.querySelector('#marks line[data-w="' + i + '"]');
    if (ln) ln.classList.add("pop");
  }
  function pulseHint() {
    if (reduced) return;
    var c = document.querySelector("#marks circle.hint");
    if (!c) return;
    c.classList.remove("pop");
    void c.getBoundingClientRect();
    c.classList.add("pop");
  }

  function renderWords() {
    var ul = $("word-list");
    ul.innerHTML = "";
    ul.setAttribute("aria-label", t("words.label"));
    if (!game) return;
    var order = game.words.map(function (w, i) { return i; })
      .sort(function (a, b) { return cmpStr(game.words[a].w, game.words[b].w); });
    order.forEach(function (i) {
      var li = document.createElement("li"), k = game.found.indexOf(i);
      li.className = "wd" + (k >= 0 ? " got" : "");
      var dot = document.createElement("span");
      dot.className = "dot";
      if (k >= 0) dot.style.background = COLORS[k % COLORS.length];
      li.appendChild(dot);
      var tx = document.createElement("span");
      tx.className = "wd-t";
      tx.textContent = game.words[i].w;
      li.appendChild(tx);
      ul.appendChild(li);
    });
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
    try { return new Date(ts).toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB"); }
    catch (e) { return ""; }
  }
  function bestText(s) {
    return s.t ? fmtTime(s.t) + " · " + fmtDate(s.d) : t("stats.none");
  }

  function resultDialog(record) {
    if (!game || !game.done) return;
    closeDialogs();
    var d = today(), sec = elapsed() / 1000;
    var dlg = makeDialog("ws-result");
    var title = game.mode === "d" ? t("res.titleD", { n: game.day + 1 }) : t("res.titleF", { s: t("sizeShort." + game.size) });
    dlg.appendChild(el("div", "dlg-title", title + " · " + langName(game.lang)));
    dlg.appendChild(el("div", "dlg-hero", t("res.solved", { t: fmtTime(sec) })));
    if (record) dlg.appendChild(el("span", "dlg-badge", t("res.record")));
    if (game.hinted) dlg.appendChild(el("div", "dlg-msg ws-center ws-dim", t("res.hinted")));
    if (game.mode === "d") {
      var ds = dailyStats(game.lang, d);
      dlg.appendChild(row(t("res.days"), String(ds.n)));
      dlg.appendChild(row(t("res.streak"), String(ds.cur)));
      dlg.appendChild(row(t("res.bestStreak"), String(ds.best)));
      dlg.appendChild(row(t("res.bestDaily"), ds.t ? fmtTime(ds.t) : t("stats.none")));
      dlg.appendChild(el("div", "dlg-msg ws-center ws-dim ws-next", t("res.next")));
    } else {
      var s = t("sizeShort." + game.size), fs = freeStats(game.lang, game.size);
      dlg.appendChild(row(t("res.solvedN", { s: s }), String(fs.n)));
      dlg.appendChild(row(t("res.best", { s: s }), bestText(fs)));
    }
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("res.close"), "", function () { dlg.close(); }));
    var main = game.mode === "d"
      ? button(t("res.toFree"), "primary", function () { dlg.close(); setLangMode(game.lang, "f"); })
      : button(t("res.newPuzzle"), "primary", function () { dlg.close(); newPuzzle(null, null); });
    acts.appendChild(main);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    main.focus();
  }

  function statsDialog() {
    var dlg = makeDialog("ws-stats"), d = today(), lang = game ? game.lang : prefs.lang;
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
    document.body.appendChild(dlg);
    dlg.showModal();
    close.focus();
  }

  // Theme picker: ready themes + own themes of the word language.
  function themesDialog() {
    if (prefs.mode === "d") { showToast(t("toast.dailyFixed")); return; }
    var lang = prefs.lang, cur = game ? game.theme : prefs.theme;
    var dlg = makeDialog("ws-themes");
    dlg.classList.add("wide");
    dlg.appendChild(el("div", "dlg-title", t("themes.title", { l: langName(lang) })));
    dlg.appendChild(el("div", "dlg-sub", t("themes.ready")));
    var box = el("div", "chips");
    ["random"].concat(THEME_IDS).forEach(function (id) {
      var b = el("button", "chip" + (cur === id ? " active" : ""), t("theme." + id));
      b.type = "button";
      b.setAttribute("aria-pressed", cur === id ? "true" : "false");
      b.addEventListener("click", function () { dlg.close(); setTheme(id); });
      box.appendChild(b);
    });
    dlg.appendChild(box);
    dlg.appendChild(el("div", "dlg-sub", t("themes.mine")));
    var mine = data.themes.filter(function (x) { return x.lang === lang; })
      .sort(function (a, b) { return cmpStr(a.name.toLowerCase(), b.name.toLowerCase()) || cmpStr(a.id, b.id); });
    if (!mine.length) dlg.appendChild(el("div", "dlg-msg ws-dim", t("themes.mineEmpty")));
    mine.forEach(function (x) {
      var r = el("div", "mine-row");
      var on = cur === "u:" + x.id;
      var b = el("button", "chip grow" + (on ? " active" : ""), x.name);
      b.type = "button";
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.addEventListener("click", function () { dlg.close(); setTheme("u:" + x.id); });
      r.appendChild(b);
      r.appendChild(el("span", "mine-n", String(x.words.length)));
      r.appendChild(iconBtn("mini", UI_ICONS.edit, t("themes.edit", { name: x.name }), function () { dlg.close(); editDialog(x); }));
      r.appendChild(iconBtn("mini danger", UI_ICONS.del, t("themes.del", { name: x.name }), function () { dlg.close(); deleteTheme(x.id); }));
      dlg.appendChild(r);
    });
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("themes.add"), "", function () {
      if (data.themes.length >= MAX_THEMES) { showToast(t("toast.maxThemes", { n: MAX_THEMES })); return; }
      dlg.close();
      editDialog(null);
    }));
    var close = button(t("themes.close"), "primary", function () { dlg.close(); });
    acts.appendChild(close);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    close.focus();
  }

  function iconBtn(cls, svg, label, fn) {
    var b = el("button", "icon-btn " + cls);
    b.type = "button";
    b.innerHTML = svg;                      // constant markup, never user data
    b.setAttribute("aria-label", label);
    b.title = label;
    b.addEventListener("click", fn);
    return b;
  }

  // Split typed text into words (lines, commas, semicolons, spaces).
  function parseWords(text, lang) {
    var ok = [], bad = [], seen = {};
    String(text || "").split(/[\n,;\s]+/).forEach(function (s) {
      if (!s) return;
      var w = normWord(s);
      if (!WORD_RE[lang].test(w)) { bad.push(s); return; }
      if (!seen[w]) { seen[w] = true; ok.push(w); }
    });
    return { ok: ok, bad: bad };
  }

  function editDialog(existing) {
    var lang = existing ? existing.lang : prefs.lang;
    var dlg = makeDialog("ws-edit");
    dlg.appendChild(el("div", "dlg-title", t(existing ? "edit.titleEdit" : "edit.titleNew") + " · " + langName(lang)));
    var form = el("form");
    form.method = "dialog";
    var l1 = el("label", "dlg-lbl", t("edit.name"));
    l1.setAttribute("for", "ws-name-in");
    var name = el("input");
    name.id = "ws-name-in";
    name.maxLength = NAME_LEN;
    name.autocomplete = "off";
    name.value = existing ? existing.name : "";
    var l2 = el("label", "dlg-lbl", t("edit.words"));
    l2.setAttribute("for", "ws-words-in");
    var words = el("textarea");
    words.id = "ws-words-in";
    words.rows = 8;
    words.spellcheck = false;
    words.value = existing ? existing.words.join("\n") : "";
    var hintTx = el("div", "dlg-msg ws-dim ws-small", t("edit.hint", { l: langName(lang) }));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("edit.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("edit.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    [l1, name, l2, words, hintTx, acts].forEach(function (n) { form.appendChild(n); });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var nm = normName(name.value);
      if (!nm) { showToast(t("toast.needName")); name.focus(); return; }
      var p = parseWords(words.value, lang);
      if (p.ok.length < MIN_WORDS) { showToast(t("toast.fewWords")); words.focus(); return; }
      if (!existing && data.themes.length >= MAX_THEMES) { showToast(t("toast.maxThemes", { n: MAX_THEMES })); return; }
      var list = p.ok.slice(0, MAX_WORDS), id;
      if (existing) {
        var x = ownTheme(existing.id);
        if (x) {
          if (x.name !== nm || x.words.join() !== list.join()) {     // R27: stamp only a real change
            x.name = nm; x.words = list; x.m = Math.max(Date.now(), x.m + 1);
          }
          id = x.id;
        } else {                                                     // deleted meanwhile: save again
          id = existing.id;
          data.themes.push({ id: id, m: Math.max(Date.now(), (data.tombs[id] || 0) + 1), name: nm, lang: lang, words: list });
        }
      } else {
        id = newId();
        data.themes.push({ id: id, m: Date.now(), name: nm, lang: lang, words: list });
      }
      data = mergeWS(data, data);
      save();
      dlg.close();
      if (p.bad.length) showToast(t("toast.skipped", { n: p.bad.length, list: p.bad.slice(0, 5).join(", ") + (p.bad.length > 5 ? "…" : "") }));
      else if (p.ok.length > MAX_WORDS) showToast(t("toast.tooMany"));
      else showToast(t("toast.themeSaved"));
      if (lang === prefs.lang && prefs.mode === "f") setTheme("u:" + id);
      else renderAll();
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    name.focus();
  }

  function deleteTheme(id) {
    var x = ownTheme(id);
    if (!x) return;
    var snapshot = JSON.parse(JSON.stringify(x));
    data.tombs[id] = Math.max(Date.now(), x.m);
    data = mergeWS(data, data);
    save();
    renderAll();
    undoToast(t("toast.themeDeleted"), function () {
      // R17: a fresh mtime beats the tombstone
      snapshot.m = Math.max(Date.now(), (data.tombs[snapshot.id] || 0) + 1);
      data.themes.push(snapshot);
      data = mergeWS(data, data);
      save();
      renderAll();
    });
  }

  function confirmDialog(msg, onYes) {
    var dlg = makeDialog("ws-confirm");
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
  // daily puzzle solved here stays solved on this device's grid; own
  // themes are not touched.
  function resetStats() {
    data.br = Math.max(Date.now(), data.br + 1);
    data = mergeWS(data, data);
    save();
    if (markElsewhere()) { saveSessions(); startClock(); }
    renderAll();
    showToast(t("toast.reset"));
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "wordsearch", title: String(text) })) return;
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
    hint:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/></svg>',
    stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    edit:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    del:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>'
  };

  // ---------- 9. Input ----------
  // Cell under a point; clamp keeps a drag inside the grid.
  function cellAt(x, y, clamp) {
    var g = $("grid"), rc = g.getBoundingClientRect(), n = game.n;
    var c = Math.floor((x - rc.left) / (rc.width / n)), r = Math.floor((y - rc.top) / (rc.height / n));
    if (clamp) { r = Math.max(0, Math.min(n - 1, r)); c = Math.max(0, Math.min(n - 1, c)); }
    else if (r < 0 || c < 0 || r >= n || c >= n) return null;
    return { r: r, c: c };
  }
  function same(a, b) { return a && b && a.r === b.r && a.c === b.c; }

  // A tap (or Enter on the keyboard cursor): first letter, then last.
  function tapCell(p) {
    if (!game || !gate()) return;
    if (!anchor) {
      anchor = p;
      var l = game.grid[p.r * game.n + p.c];
      live(t("live.start", { l: l, r: p.r + 1, c: p.c + 1 }));
    } else if (same(anchor, p)) {
      anchor = null;
    } else if (inLine(anchor, p)) {
      var a = anchor;
      anchor = null;
      tryPick(a, p);
    } else {
      anchor = p;
      showToast(t("toast.line"));
    }
    renderMarks();
  }

  function wirePointer() {
    var g = $("grid");
    g.addEventListener("pointerdown", function (e) {
      if (!game || (e.pointerType === "mouse" && e.button !== 0)) return;
      var p = cellAt(e.clientX, e.clientY, false);
      if (!p) return;
      e.preventDefault();
      if (game.done) { gate(); return; }
      try { g.setPointerCapture(e.pointerId); } catch (err) {}
      drag = { id: e.pointerId, a: p, b: p, moved: false };
      cursor = null;
    });
    g.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var p = cellAt(e.clientX, e.clientY, true), b = snapEnd(drag.a, p.r, p.c, game.n);
      if (!same(b, drag.b)) {
        drag.b = b;
        if (!same(b, drag.a)) { drag.moved = true; anchor = null; }
        renderMarks();
      }
    });
    function up(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var d = drag;
      drag = null;
      if (e.type === "pointercancel") { renderMarks(); return; }
      if (d.moved) {
        renderMarks();
        if (!same(d.a, d.b)) tryPick(d.a, d.b);
      } else tapCell(d.a);
    }
    g.addEventListener("pointerup", up);
    g.addEventListener("pointercancel", up);
    g.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }

  function wireKeyboard() {
    $("grid").addEventListener("keydown", function (e) {
      if (!game || e.altKey || e.ctrlKey || e.metaKey) return;
      var mv = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      if (mv) {
        e.preventDefault();
        var c = cursor || anchor || { r: 0, c: 0 };
        if (cursor) c = { r: Math.max(0, Math.min(game.n - 1, c.r + mv[0])), c: Math.max(0, Math.min(game.n - 1, c.c + mv[1])) };
        cursor = c;
        renderGrid();
        live(t("cell.label", { l: game.grid[c.r * game.n + c.c], r: c.r + 1, c: c.c + 1 }));
        return;
      }
      if ((e.key === "Enter" || e.key === " ") && cursor) { e.preventDefault(); tapCell(cursor); return; }
      if (e.key === "Escape" && anchor) { e.preventDefault(); anchor = null; renderMarks(); }
    });
    $("grid").addEventListener("blur", function () { if (cursor) { cursor = null; renderGrid(); } });

    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;          // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.shiftKey && e.code === "KeyN") { e.preventDefault(); newPuzzle(null, null); return; }   // by position
      if (!e.shiftKey && e.code === "KeyH") { e.preventDefault(); hint(); }
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
    api.registerSlice("wordsearch", sliceGet, sliceSet, STORAGE_KEY, mergeWS);
  }

  function sliceGet() {
    return mergeWS(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object") return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeWS(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    // a daily puzzle solved on another device (or a reset) shows here
    if (markElsewhere()) { saveSessions(); startClock(); }
    renderAll();
    var open = document.querySelector("dialog#ws-themes[open]");
    if (open) { open.close(); themesDialog(); }                      // its rows may be stale
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
    $("clock").title = t("st.time");
  }

  function paintStatic() {
    [["hint-btn", "hint", "btn.hint"], ["new-btn", "new", "btn.new"],
     ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
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
    $("theme-btn").addEventListener("click", themesDialog);
    $("hint-btn").addEventListener("click", function () { hint(); $("hint-btn").blur(); });
    $("new-btn").addEventListener("click", function () { newPuzzle(null, null); $("new-btn").blur(); });
    $("stats-btn").addEventListener("click", statsDialog);
    wirePointer();
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
    pickGame();
    renderAll();
    if (!game) showToast(t("toast.noWords"));
  }

  boot();
})();
