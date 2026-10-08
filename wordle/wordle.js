// ============================================================
// orOS Wordle — App logic (v1.0.0)
// Guess the 5-letter word in 6 tries. After each guess every letter
// is marked: right place (green), in the word elsewhere (yellow), not
// in the word (grey); repeated letters are counted exactly.
//   - words in English or Greek (own switch, default = orOS language);
//     Greek ignores accents and diaeresis, and ς is σ
//   - Daily: one word a day, the same on every device (from the date,
//     offline), counts for the streak; Free: as many words as you like
//   - Hard mode (option): revealed hints must be used in later guesses
//   - physical keys by position (the OS layout does not matter; Greek
//     follows the Greek keyboard), on-screen keyboard, Enter, Backspace
//   - Copy: the coloured squares without the word
// Data:
//   - synced slice "wordle" (oros-wordle-data): every daily result per
//     language (one result per day: the better one wins) and Free play
//     counters as per-device rows + a reset stamp br
//   - device-local (R10): oros-wordle-prefs (word language, mode, hard,
//     contrast), oros-wordle-session (the games in progress),
//     oros-wordle-device (row id), oros-wordle-sfx (sound on/off)
// Word lists: words-en.js / words-el.js (window.WORDLE_WORDS).
// Sections:
//   1. Constants, i18n, helpers
//   2. Word model (normalize, score, hard mode, daily word)
//   3. Synced data: load / save / normalize / merge (R5, R26)
//   4. Device-local prefs + session
//   5. Game flow (type, submit, finish, new)
//   6. Render (toolbar, status, board, keyboard)
//   7. Dialogs (result, records, options, confirm)
//   8. Toasts
//   9. Sound
//  10. Input (keys, on-screen keyboard, Contract Β)
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-wordle-data";
  var PREFS_KEY   = "oros-wordle-prefs";
  var SESSION_KEY = "oros-wordle-session";
  var DEVICE_KEY  = "oros-wordle-device";
  var SFX_KEY     = "oros-wordle-sfx";
  var DATA_VER    = 1;

  var LEN = 5, TRIES = 6, LOST = 7;
  var LANGS = ["en", "el"];
  var MODES = ["d", "f"];
  var EPOCH_UTC = Date.UTC(2026, 0, 1);     // day 0 of the daily words
  var MAX_DAY = 100000;
  var LETTERS = { en: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", el: "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ" };
  var KB_ROWS = {
    en: ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"],
    el: ["ΕΡΤΥΘΙΟΠ", "ΑΣΔΦΓΗΞΚΛ", "ΖΧΨΩΒΝΜ"]
  };
  // Physical key (by position) → Greek letter, as on a Greek keyboard.
  var EL_BY_CODE = { KeyE: "Ε", KeyR: "Ρ", KeyT: "Τ", KeyY: "Υ", KeyU: "Θ", KeyI: "Ι", KeyO: "Ο",
    KeyP: "Π", KeyA: "Α", KeyS: "Σ", KeyD: "Δ", KeyF: "Φ", KeyG: "Γ", KeyH: "Η", KeyJ: "Ξ",
    KeyK: "Κ", KeyL: "Λ", KeyZ: "Ζ", KeyX: "Χ", KeyC: "Ψ", KeyV: "Ω", KeyB: "Β", KeyN: "Ν",
    KeyM: "Μ", KeyW: "Σ" };

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
      "btn.new": "New word (Shift+N)",
      "btn.opts": "Options",
      "btn.stats": "Statistics",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "lang.en": "EN", "lang.el": "ΕΛ",
      "lang.enLong": "English words", "lang.elLong": "Greek words",
      "mode.d": "Daily", "mode.f": "Free",
      "st.daily": "Daily #{n}", "st.free": "Free play",
      "st.streak": "Streak",
      "turn.play": "Guess the word: {t} tries left",
      "turn.won": "Found in {n}/6!",
      "turn.lost": "The word was {w}",
      "turn.elsewhere": "Played today on another device ({r}): try Free play",
      "turn.hard": "Hard mode",
      "board.label": "Guesses",
      "row.label": "Guess {n}",
      "tile.c": "{l} right place", "tile.p": "{l} elsewhere", "tile.a": "{l} not in the word",
      "kb.label": "Keyboard",
      "kb.enter": "Enter", "kb.back": "Delete letter",
      "live.guess": "{w}: {list}",
      "live.won": "Found! {w}",
      "live.lost": "Out of tries. The word was {w}",
      "res.titleD": "Daily #{n}",
      "res.titleF": "Free play",
      "res.won": "Found in {n}/6",
      "res.lost": "The word was",
      "res.played": "Played",
      "res.winPct": "Won %",
      "res.streak": "Streak",
      "res.best": "Best streak",
      "res.dist": "Guesses",
      "res.next": "A new daily word tomorrow",
      "res.copy": "Copy",
      "res.newWord": "New word",
      "res.toFree": "Free play",
      "res.close": "Close",
      "stats.title": "Statistics",
      "stats.daily": "Daily · {l}",
      "stats.free": "Free play · {l}",
      "stats.freeRow": "{g} played · {w} found",
      "stats.reset": "Reset statistics",
      "stats.close": "Close",
      "opts.title": "Options",
      "opts.hard": "Hard mode",
      "opts.hardSub": "Hints you have found must be used in every later guess",
      "opts.contrast": "High contrast colours",
      "opts.contrastSub": "Orange and blue instead of green and yellow",
      "opts.close": "Close",
      "confirm.reset": "Delete the statistics on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Statistics reset",
      "toast.newword": "New word",
      "toast.undo": "Undo",
      "toast.short": "Not enough letters",
      "toast.notWord": "Not in the word list",
      "toast.hardGreen": "Hard mode: {l} goes in place {p}",
      "toast.hardYellow": "Hard mode: the word must contain {l}",
      "toast.hardLocked": "Hard mode can change only before the first guess",
      "toast.dailyDone": "Today's word is done: a new one tomorrow, or try Free play",
      "toast.over": "This word is done: start a new one (Shift+N)",
      "toast.dailyOne": "Daily has one word a day: for more words, switch to Free",
      "toast.copied": "Copied",
      "toast.copyFail": "Could not copy",
      "toast.save": "Could not save: storage is full",
      "toast.noWords": "The word list did not load"
    },
    el: {
      "btn.new": "Νέα λέξη (Shift+N)",
      "btn.opts": "Επιλογές",
      "btn.stats": "Στατιστικά",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "lang.en": "EN", "lang.el": "ΕΛ",
      "lang.enLong": "Αγγλικές λέξεις", "lang.elLong": "Ελληνικές λέξεις",
      "mode.d": "Ημέρας", "mode.f": "Ελεύθερο",
      "st.daily": "Ημέρας #{n}", "st.free": "Ελεύθερο",
      "st.streak": "Σερί",
      "turn.play": "Βρες τη λέξη: απομένουν {t}",
      "turn.won": "Βρέθηκε σε {n}/6!",
      "turn.lost": "Η λέξη ήταν {w}",
      "turn.elsewhere": "Παίχτηκε σήμερα σε άλλη συσκευή ({r}): δοκίμασε το Ελεύθερο",
      "turn.hard": "Δύσκολο",
      "board.label": "Προσπάθειες",
      "row.label": "Προσπάθεια {n}",
      "tile.c": "{l} σωστή θέση", "tile.p": "{l} αλλού", "tile.a": "{l} δεν υπάρχει",
      "kb.label": "Πληκτρολόγιο",
      "kb.enter": "Enter", "kb.back": "Σβήσιμο γράμματος",
      "live.guess": "{w}: {list}",
      "live.won": "Βρέθηκε! {w}",
      "live.lost": "Τέλος προσπαθειών. Η λέξη ήταν {w}",
      "res.titleD": "Ημέρας #{n}",
      "res.titleF": "Ελεύθερο",
      "res.won": "Βρέθηκε σε {n}/6",
      "res.lost": "Η λέξη ήταν",
      "res.played": "Παιχνίδια",
      "res.winPct": "Νίκες %",
      "res.streak": "Σερί",
      "res.best": "Καλύτερο σερί",
      "res.dist": "Προσπάθειες",
      "res.next": "Νέα λέξη ημέρας αύριο",
      "res.copy": "Αντιγραφή",
      "res.newWord": "Νέα λέξη",
      "res.toFree": "Ελεύθερο",
      "res.close": "Κλείσιμο",
      "stats.title": "Στατιστικά",
      "stats.daily": "Ημέρας · {l}",
      "stats.free": "Ελεύθερο · {l}",
      "stats.freeRow": "{g} παιχνίδια · {w} βρέθηκαν",
      "stats.reset": "Μηδενισμός στατιστικών",
      "stats.close": "Κλείσιμο",
      "opts.title": "Επιλογές",
      "opts.hard": "Δύσκολο",
      "opts.hardSub": "Όσα γράμματα βρήκες πρέπει να μπαίνουν σε κάθε επόμενη προσπάθεια",
      "opts.contrast": "Χρώματα υψηλής αντίθεσης",
      "opts.contrastSub": "Πορτοκαλί και μπλε αντί για πράσινο και κίτρινο",
      "opts.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα στατιστικά σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα στατιστικά μηδενίστηκαν",
      "toast.newword": "Νέα λέξη",
      "toast.undo": "Αναίρεση",
      "toast.short": "Λίγα γράμματα",
      "toast.notWord": "Η λέξη δεν είναι στη λίστα",
      "toast.hardGreen": "Δύσκολο: το {l} μπαίνει στη θέση {p}",
      "toast.hardYellow": "Δύσκολο: η λέξη πρέπει να έχει {l}",
      "toast.hardLocked": "Το Δύσκολο αλλάζει μόνο πριν την πρώτη προσπάθεια",
      "toast.dailyDone": "Η λέξη της ημέρας τελείωσε: νέα αύριο, ή δοκίμασε το Ελεύθερο",
      "toast.over": "Η λέξη τελείωσε: ξεκίνα νέα (Shift+N)",
      "toast.dailyOne": "Το Ημέρας έχει μία λέξη τη μέρα: για περισσότερες, πήγαινε στο Ελεύθερο",
      "toast.copied": "Αντιγράφηκε",
      "toast.copyFail": "Δεν έγινε αντιγραφή",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "toast.noWords": "Η λίστα λέξεων δεν φορτώθηκε"
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

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("wordle.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Word model ----------
  // Upper case, no accents or diaeresis, final sigma as Σ, letters only.
  function normWord(s) {
    s = String(s || "");
    if (s.normalize) s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return s.toUpperCase().replace(/ς/g, "Σ").replace(/[^A-ZΑ-Ω]/g, "");
  }

  // Score a guess: per letter "c" (right place), "p" (in the word
  // elsewhere) or "a" (absent). Greens first; then each yellow uses up
  // one of the answer's letters still unmatched, left to right.
  function score(guess, answer) {
    var out = [], left = {}, i;
    for (i = 0; i < LEN; i++) {
      if (guess[i] === answer[i]) out[i] = "c";
      else { out[i] = "a"; left[answer[i]] = (left[answer[i]] || 0) + 1; }
    }
    for (i = 0; i < LEN; i++) {
      if (out[i] === "c") continue;
      if (left[guess[i]] > 0) { out[i] = "p"; left[guess[i]]--; }
    }
    return out.join("");
  }

  // Hard mode: every green stays in place and every revealed letter is
  // used (as many times as revealed). Returns null, or the first broken
  // rule { kind: "c", l, p } / { kind: "p", l }.
  function hardCheck(guesses, answer, guess) {
    for (var g = 0; g < guesses.length; g++) {
      var sc = score(guesses[g], answer), need = {}, i;
      for (i = 0; i < LEN; i++) {
        if (sc[i] === "c" && guess[i] !== guesses[g][i]) return { kind: "c", l: guesses[g][i], p: i + 1 };
      }
      for (i = 0; i < LEN; i++) if (sc[i] !== "a") need[guesses[g][i]] = (need[guesses[g][i]] || 0) + 1;
      for (var l in need) {
        var have = 0;
        for (i = 0; i < LEN; i++) if (guess[i] === l) have++;
        if (have < need[l]) return { kind: "p", l: l };
      }
    }
    return null;
  }

  // Best state per letter so far (c > p > a), for the keyboard.
  function keyStates(guesses, answer) {
    var rank = { a: 1, p: 2, c: 3 }, out = {};
    guesses.forEach(function (g) {
      var sc = score(g, answer);
      for (var i = 0; i < LEN; i++) {
        var l = g[i];
        if (!out[l] || rank[sc[i]] > rank[out[l]]) out[l] = sc[i];
      }
    });
    return out;
  }

  // Day number of a local date (day 0 = 1 Jan 2026), same everywhere for
  // the same calendar day.
  function dayIndex(d) {
    return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH_UTC) / 86400000);
  }
  function dailyWord(answers, day) {
    var n = answers.length;
    return answers[((day % n) + n) % n];
  }

  // Current and best streak of won days from a { day: r } map; the
  // current streak counts back from today, or from yesterday when today
  // is not played yet.
  function streaks(days, today) {
    var won = {}, keys = [];
    Object.keys(days).forEach(function (k) {
      if (days[k] < LOST) { won[k] = true; keys.push(+k); }
    });
    var cur = 0, d = won[today] ? today : today - 1;
    while (won[d]) { cur++; d--; }
    keys.sort(function (a, b) { return a - b; });
    var best = 0, run = 0, prev = null;
    keys.forEach(function (k) {
      run = (prev !== null && k === prev + 1) ? run + 1 : 1;
      if (run > best) best = run;
      prev = k;
    });
    return { cur: cur, best: best };
  }

  function shareText(title, guesses, answer, won, hard, contrast) {
    var sq = contrast ? { c: "🟧", p: "🟦", a: "⬛" } : { c: "🟩", p: "🟨", a: "⬛" };
    var lines = guesses.map(function (g) {
      return score(g, answer).split("").map(function (s) { return sq[s]; }).join("");
    });
    return "orOS Wordle " + title + " " + (won ? guesses.length : "X") + "/6" + (hard ? "*" : "") +
      "\n\n" + lines.join("\n");
  }

  // ---------- Word lists ----------
  var LISTS = {};      // lang → { answers: [...], set: { word: true } }
  function splitWords(s) {
    var out = [];
    for (var i = 0; i + LEN <= s.length; i += LEN) out.push(s.slice(i, i + LEN));
    return out;
  }
  function lists(lang) {
    if (LISTS[lang]) return LISTS[lang];
    var src = window.WORDLE_WORDS && window.WORDLE_WORDS[lang];
    if (!src) return null;
    var answers = splitWords(src.answers), set = {};
    answers.concat(splitWords(src.extra)).forEach(function (w) { set[w] = true; });
    LISTS[lang] = { answers: answers, set: set };
    return LISTS[lang];
  }

  // ---------- 3. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                       // max-merged
  //   days: { "en:<day>"|"el:<day>": { b: <epoch>, r: 1…6 found, 7 lost } },
  //   rows: { <deviceId>: { b: <epoch>, s: { en|el: { g, w, h: [6 counts] } } } }
  // }
  // A daily word is played once overall: per day the newer epoch wins,
  // equal epochs keep the better result (lower r). Free play: each device
  // only grows its own row; equal epochs take the max of every counter.
  // Entries older than br drop. A join (symmetric, associative, idempotent).
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, days: {}, rows: {} }; }

  function normDay(v) {
    if (!v || typeof v !== "object" || !isInt(v.b) || v.b < 0 || !isInt(v.r) || v.r < 1 || v.r > LOST) return null;
    return { b: v.b, r: v.r };
  }
  function dayKeyOk(k) {
    var m = /^(en|el):(-?\d+)$/.exec(k);
    return !!m && Math.abs(+m[2]) <= MAX_DAY;
  }

  function normFree(c) {
    if (!c || typeof c !== "object" || !isInt(c.g) || !isInt(c.w) || c.g < 1 || c.w < 0 || c.w > c.g ||
        !Array.isArray(c.h) || c.h.length !== TRIES) return null;
    for (var i = 0; i < TRIES; i++) if (!isInt(c.h[i]) || c.h[i] < 0) return null;
    return { g: c.g, w: c.w, h: c.h.slice() };
  }
  function normRow(row) {
    if (!row || typeof row !== "object" || !isInt(row.b) || row.b < 0) return null;
    var s = {}, any = false;
    LANGS.forEach(function (k) {
      var c = normFree(row.s && row.s[k]);
      if (c) { s[k] = c; any = true; }
    });
    return any ? { b: row.b, s: s } : null;
  }
  function joinFree(a, c) {
    var h = [];
    for (var i = 0; i < TRIES; i++) h.push(Math.max(a.h[i], c.h[i]));
    var g = Math.max(a.g, c.g);
    return { g: g, w: Math.min(g, Math.max(a.w, c.w)), h: h };
  }
  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var s = {};
    LANGS.forEach(function (k) {
      var a = x.s[k], c = y.s[k];
      if (!a && !c) return;
      s[k] = (a && c) ? joinFree(a, c) : normFree(a || c);
    });
    return { b: x.b, s: s };
  }

  function mergeWordle(A, B) {
    var a = A || {}, b = B || {};
    var br = Math.max(isInt(a.br) ? a.br : 0, isInt(b.br) ? b.br : 0);
    var days = {}, rows = {};
    [a.days || {}, b.days || {}].forEach(function (m) {
      if (typeof m !== "object") return;
      Object.keys(m).forEach(function (k) {
        var v = dayKeyOk(k) ? normDay(m[k]) : null;
        if (!v || v.b < br) return;
        var o = days[k];
        if (!o || v.b > o.b || (v.b === o.b && v.r < o.r)) days[k] = v;
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
    var sd = {}, sr = {};
    Object.keys(days).sort(cmpStr).forEach(function (k) { sd[k] = days[k]; });
    Object.keys(rows).sort(cmpStr).forEach(function (id) {
      var r = rows[id], s = {};
      LANGS.forEach(function (k) { if (r.s[k]) s[k] = r.s[k]; });
      sr[id] = { b: r.b, s: s };
    });
    return { ver: DATA_VER, br: br, days: sd, rows: sr };
  }

  // { day: r } for one language.
  function daysOf(lang) {
    var out = {};
    Object.keys(data.days).forEach(function (k) {
      if (k.indexOf(lang + ":") === 0) out[+k.slice(3)] = data.days[k].r;
    });
    return out;
  }
  function dailyStats(lang, today) {
    var d = daysOf(lang), h = [0, 0, 0, 0, 0, 0], g = 0, w = 0;
    Object.keys(d).forEach(function (k) {
      g++;
      if (d[k] < LOST) { w++; h[d[k] - 1]++; }
    });
    var s = streaks(d, today);
    return { g: g, w: w, h: h, cur: s.cur, best: s.best };
  }
  function freeStats(lang) {
    var out = { g: 0, w: 0, h: [0, 0, 0, 0, 0, 0] };
    Object.keys(data.rows).forEach(function (id) {
      var c = data.rows[id].s[lang];
      if (!c) return;
      out.g += c.g; out.w += c.w;
      for (var i = 0; i < TRIES; i++) out.h[i] += c.h[i];
    });
    return out;
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && (parsed.days || parsed.rows)) {
          data = mergeWordle(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] wordle: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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

  // Count a finished game (r: tries, or LOST).
  function countGame(g, r) {
    if (g.mode === "d") {
      var k = g.lang + ":" + g.day, o = data.days[k];
      if (!o || o.b < data.br || r < o.r) data.days[k] = { b: data.br, r: r };
    } else {
      var row = data.rows[deviceId];
      if (!row || row.b < data.br) row = { b: data.br, s: {} };   // new epoch after a reset
      row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
      var c = row.s[g.lang] || { g: 0, w: 0, h: [0, 0, 0, 0, 0, 0] };
      c.g++;
      if (r < LOST) { c.w++; c.h[r - 1]++; }
      row.s[g.lang] = c;
      data.rows[deviceId] = row;
    }
    data = mergeWordle(data, data);
    save();
  }

  // ---------- 4. Device-local prefs + session ----------
  var prefs = { lang: LANG, mode: "d", hard: false, contrast: false };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (LANGS.indexOf(p.lang) >= 0) prefs.lang = p.lang;
        if (MODES.indexOf(p.mode) >= 0) prefs.mode = p.mode;
        if (typeof p.hard === "boolean") prefs.hard = p.hard;
        if (typeof p.contrast === "boolean") prefs.contrast = p.contrast;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // One game per language and mode: { lang, mode, day, answer, guesses, hard, done }
  var sessions = {};
  var game = null;
  var typed = "";

  function validGame(g, key) {
    var L = g && lists(g.lang);
    if (!g || typeof g !== "object" || LANGS.indexOf(g.lang) < 0 || MODES.indexOf(g.mode) < 0 ||
        key !== g.lang + ":" + g.mode || !L || typeof g.answer !== "string" || !L.set[g.answer] ||
        !Array.isArray(g.guesses) || g.guesses.length > TRIES || typeof g.hard !== "boolean" ||
        typeof g.done !== "boolean" || !isInt(g.day)) return false;
    for (var i = 0; i < g.guesses.length; i++) {
      if (typeof g.guesses[i] !== "string" || !L.set[g.guesses[i]]) return false;
    }
    return true;
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
    if (game) sessions[game.lang + ":" + game.mode] = game;
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(sessions)); } catch (e) {}
  }

  // ---------- 5. Game flow ----------
  function today() { return dayIndex(new Date()); }

  function freshGame(lang, mode) {
    var L = lists(lang);
    if (!L) return null;
    var d = today();
    var answer = mode === "d" ? dailyWord(L.answers, d) : L.answers[randInt(L.answers.length)];
    return { lang: lang, mode: mode, day: d, answer: answer, guesses: [], hard: prefs.hard, done: false };
  }

  // The game for the current language and mode: the saved one, unless it
  // is an old daily word; a new one otherwise.
  function pickGame() {
    var key = prefs.lang + ":" + prefs.mode, g = sessions[key];
    if (g && g.mode === "d" && g.day !== today()) g = null;
    if (!g) {
      g = freshGame(prefs.lang, prefs.mode);
      if (g && g.mode === "d") {
        var r = playedElsewhere(g);
        if (r) g.done = true;
      }
    }
    game = g;
    typed = "";
    if (game) saveSessions();
    revive();
  }

  // A daily word already counted (on this or another device) with no board here.
  function playedElsewhere(g) {
    if (!g || g.mode !== "d") return 0;
    var e = data.days[g.lang + ":" + g.day];
    return e && e.b >= data.br ? e.r : 0;
  }
  // After a reset the other device's result is gone: the word is playable here again.
  function revive() {
    if (game && game.mode === "d" && game.done && !game.guesses.length && !playedElsewhere(game)) {
      game.done = false;
      saveSessions();
    }
  }
  function wonGame(g) { return g.guesses.length > 0 && g.guesses[g.guesses.length - 1] === g.answer; }

  function typeLetter(l) {
    if (!game || !gate()) return;
    if (typed.length >= LEN) return;
    typed += l;
    renderRow(game.guesses.length);
  }
  function backspace() {
    if (!game || !gate()) return;
    typed = typed.slice(0, -1);
    renderRow(game.guesses.length);
  }
  // Can a key act now? (R28: say why not)
  function gate() {
    if (document.querySelector("dialog[open]") || revealing) return false;
    if (game.done) {
      showToast(t(game.mode === "d" ? "toast.dailyDone" : "toast.over"));
      return false;
    }
    return true;
  }

  function submit() {
    if (!game || !gate()) return;
    var row = game.guesses.length;
    if (typed.length < LEN) { shakeRow(row); showToast(t("toast.short")); return; }
    var L = lists(game.lang);
    if (!L.set[typed]) { shakeRow(row); showToast(t("toast.notWord")); return; }
    if (game.hard) {
      var bad = hardCheck(game.guesses, game.answer, typed);
      if (bad) {
        shakeRow(row);
        showToast(bad.kind === "c" ? t("toast.hardGreen", { l: bad.l, p: bad.p }) : t("toast.hardYellow", { l: bad.l }));
        return;
      }
    }
    var guess = typed;
    game.guesses.push(guess);
    typed = "";
    var won = guess === game.answer, over = won || game.guesses.length >= TRIES;
    if (over) game.done = true;
    saveSessions();
    if (over) countGame(game, won ? game.guesses.length : LOST);
    reveal(row, function () {
      renderAll();
      announce(guess);
      if (over) {
        live(won ? t("live.won", { w: game.answer }) : t("live.lost", { w: game.answer }));
        sfx(won ? "win" : "lose");
        setTimeout(resultDialog, won ? 900 : 600);
      }
    });
  }

  function announce(guess) {
    var sc = score(guess, game.answer), parts = [];
    for (var i = 0; i < LEN; i++) parts.push(t("tile." + sc[i], { l: guess[i] }));
    live(t("live.guess", { w: guess, list: parts.join(", ") }));
  }

  function inProgress() { return !!(game && !game.done && game.guesses.length > 0); }

  // Free play: a new word. A word in progress is never lost silently (R14).
  function newWord() {
    if (!game) return;
    if (game.mode === "d") { showToast(t(game.done ? "toast.dailyDone" : "toast.dailyOne")); return; }
    closeDialogs();
    var prev = inProgress() ? JSON.parse(JSON.stringify(game)) : null;
    game = freshGame(game.lang, "f");
    typed = "";
    saveSessions();
    renderAll();
    if (prev) {
      undoToast(t("toast.newword"), function () {
        if (prefs.lang !== prev.lang || prefs.mode !== "f") { prefs.lang = prev.lang; prefs.mode = "f"; savePrefs(); }
        game = prev;
        typed = "";
        saveSessions();
        renderAll();
      });
    } else {
      live(t("toast.newword"));
    }
  }

  function setLangMode(lang, mode) {
    if (game && lang === game.lang && mode === game.mode) return;   // visible active state
    prefs.lang = lang; prefs.mode = mode; savePrefs();
    closeDialogs();
    pickGame();
    renderAll();
  }

  // ---------- 6. Render ----------
  var revealing = false;

  function renderAll() {
    renderToolbar();
    renderStatus();
    renderBoard();
    renderKeyboard();
  }

  function renderToolbar() {
    [].forEach.call(document.querySelectorAll("#lang-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-lang") === prefs.lang;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    [].forEach.call(document.querySelectorAll("#mode-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-mode") === prefs.mode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    $("new-btn").disabled = prefs.mode === "d";
    document.body.classList.toggle("contrast", !!prefs.contrast);
    paintSfxBtn();
  }

  function renderStatus() {
    if (!game) { $("turn").textContent = t("toast.noWords"); return; }
    var d = today();
    $("info").textContent = game.mode === "d" ? t("st.daily", { n: game.day + 1 }) : t("st.free");
    $("hard-tag").hidden = !game.hard;
    $("streak").textContent = String(dailyStats(game.lang, d).cur);
    var msg, cls = "";
    if (game.done && !game.guesses.length) {
      var r = playedElsewhere(game);
      msg = t("turn.elsewhere", { r: r < LOST ? r + "/6" : "X/6" });
    } else if (game.done && wonGame(game)) { msg = t("turn.won", { n: game.guesses.length }); cls = "done"; }
    else if (game.done) { msg = t("turn.lost", { w: game.answer }); cls = "warn"; }
    else msg = t("turn.play", { t: TRIES - game.guesses.length });
    $("turn").textContent = msg;
    $("turn").className = cls;
  }

  function buildBoard() {
    var el = $("board");
    el.innerHTML = "";
    el.setAttribute("aria-label", t("board.label"));
    for (var r = 0; r < TRIES; r++) {
      var row = document.createElement("div");
      row.className = "row";
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", t("row.label", { n: r + 1 }));
      for (var c = 0; c < LEN; c++) {
        var tile = document.createElement("div");
        tile.className = "tile";
        row.appendChild(tile);
      }
      el.appendChild(row);
    }
  }

  function renderBoard() {
    if (!$("board").children.length) buildBoard();
    for (var r = 0; r < TRIES; r++) renderRow(r);
  }

  // One row: a scored guess, the letters being typed, or empty.
  function renderRow(r) {
    var row = $("board").children[r];
    if (!row || !game) return;
    var g = game.guesses[r], sc = g ? score(g, game.answer) : null;
    var text = g || (r === game.guesses.length && !game.done ? typed : "");
    for (var c = 0; c < LEN; c++) {
      var tile = row.children[c], l = text[c] || "";
      tile.textContent = l;
      tile.className = "tile" + (sc ? " " + sc[c] : (l ? " typed" : ""));
      if (sc) tile.setAttribute("aria-label", t("tile." + sc[c], { l: l }));
      else tile.removeAttribute("aria-label");
    }
  }

  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var FLIP_MS = 260;

  // Flip the tiles of a row one by one, then call done.
  function reveal(r, done) {
    var row = $("board").children[r];
    if (reduced || !row) { renderRow(r); done(); return; }
    revealing = true;
    var g = game.guesses[r], sc = score(g, game.answer), k = 0;
    (function next() {
      if (k >= LEN) { revealing = false; done(); return; }
      var tile = row.children[k], s = sc[k], l = g[k];
      tile.classList.add("flip");
      setTimeout(function () {
        tile.textContent = l;
        tile.className = "tile flip " + s;
        tile.setAttribute("aria-label", t("tile." + s, { l: l }));
      }, FLIP_MS / 2);
      setTimeout(function () { tile.classList.remove("flip"); k++; next(); }, FLIP_MS);
    })();
  }

  function shakeRow(r) {
    var row = $("board").children[r];
    if (!row || reduced) return;
    row.classList.remove("shake");
    void row.offsetWidth;
    row.classList.add("shake");
    setTimeout(function () { row.classList.remove("shake"); }, 400);
  }

  function renderKeyboard() {
    var kb = $("kb"), lang = game ? game.lang : prefs.lang;
    if (kb.getAttribute("data-lang") !== lang) {
      kb.innerHTML = "";
      kb.setAttribute("data-lang", lang);
      KB_ROWS[lang].forEach(function (letters, i) {
        var row = document.createElement("div");
        row.className = "kb-row";
        if (i === 2) row.appendChild(keyBtn("enter", t("kb.enter"), "wide"));
        letters.split("").forEach(function (l) { row.appendChild(keyBtn(l, l, "")); });
        if (i === 2) {
          var b = keyBtn("back", "", "wide");
          b.innerHTML = UI_ICONS.back;
          b.setAttribute("aria-label", t("kb.back"));
          row.appendChild(b);
        }
        kb.appendChild(row);
      });
    }
    var st = game ? keyStates(game.guesses, game.answer) : {};
    [].forEach.call(kb.querySelectorAll(".key[data-k]"), function (b) {
      var k = b.getAttribute("data-k");
      b.classList.remove("c", "p", "a");
      if (st[k]) b.classList.add(st[k]);
    });
  }
  function keyBtn(k, label, cls) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "key" + (cls ? " " + cls : "");
    b.setAttribute("data-k", k);
    b.textContent = label;
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
    b.addEventListener("click", fn);
    return b;
  }
  function langName(l) { return t(l === "el" ? "lang.elLong" : "lang.enLong"); }

  // Four numbers in a row, then the guess distribution as bars.
  function statsBlock(s, mark) {
    var box = el("div", "wd-stats");
    var nums = el("div", "wd-nums");
    [[t("res.played"), s.g], [t("res.winPct"), s.g ? Math.round(100 * s.w / s.g) : 0]]
      .concat(s.cur !== undefined ? [[t("res.streak"), s.cur], [t("res.best"), s.best]] : [])
      .forEach(function (x) {
        var c = el("div", "wd-num");
        c.appendChild(el("strong", "", String(x[1])));
        c.appendChild(el("span", "", x[0]));
        nums.appendChild(c);
      });
    box.appendChild(nums);
    box.appendChild(el("div", "dlg-sub", t("res.dist")));
    var max = Math.max.apply(null, s.h.concat([1]));
    for (var i = 0; i < TRIES; i++) {
      var r = el("div", "wd-bar" + (mark === i + 1 ? " mark" : ""));
      r.appendChild(el("span", "wd-bar-n", String(i + 1)));
      var fill = el("span", "wd-bar-fill", String(s.h[i]));
      fill.style.width = Math.max(8, Math.round(100 * s.h[i] / max)) + "%";
      r.appendChild(fill);
      box.appendChild(r);
    }
    return box;
  }

  function resultDialog() {
    if (!game || !game.done) return;
    closeDialogs();
    var won = wonGame(game), d = today();
    var title = game.mode === "d" ? t("res.titleD", { n: game.day + 1 }) : t("res.titleF");
    var dlg = makeDialog("wordle-result");
    dlg.appendChild(el("div", "dlg-title", title + " · " + langName(game.lang)));
    if (won) dlg.appendChild(el("div", "dlg-hero", t("res.won", { n: game.guesses.length })));
    else {
      dlg.appendChild(el("div", "dlg-msg wd-center", t("res.lost")));
      dlg.appendChild(el("div", "dlg-hero wd-word", game.answer));
    }
    var s = game.mode === "d" ? dailyStats(game.lang, d) : freeStats(game.lang);
    dlg.appendChild(statsBlock(s, won ? game.guesses.length : 0));
    if (game.mode === "d") dlg.appendChild(el("div", "dlg-msg wd-center wd-next", t("res.next")));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("res.copy"), "", copyResult));
    var main = game.mode === "d"
      ? button(t("res.toFree"), "primary", function () { dlg.close(); setLangMode(game.lang, "f"); })
      : button(t("res.newWord"), "primary", function () { dlg.close(); newWord(); });
    acts.appendChild(main);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    main.focus();
  }

  function copyResult() {
    if (!game || !game.done || !game.guesses.length) return;
    var title = game.mode === "d" ? "#" + (game.day + 1) + " " + game.lang.toUpperCase() : game.lang.toUpperCase();
    var text = shareText(title, game.guesses, game.answer, wonGame(game), game.hard, prefs.contrast);
    var ok = function () { showToast(t("toast.copied")); }, fail = function () { showToast(t("toast.copyFail")); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(ok, fail); return; }
    } catch (e) {}
    fail();
  }

  function statsDialog() {
    var dlg = makeDialog("wordle-stats"), d = today();
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    var lang = game ? game.lang : prefs.lang, empty = true;
    var ds = dailyStats(lang, d), fs = freeStats(lang);
    if (ds.g || fs.g) empty = false;
    LANGS.forEach(function (l) { if (dailyStats(l, d).g || freeStats(l).g) empty = false; });
    dlg.appendChild(el("div", "dlg-sub", t("stats.daily", { l: langName(lang) })));
    dlg.appendChild(statsBlock(ds, 0));
    var fr = el("div", "dlg-row");
    fr.appendChild(el("span", "", t("stats.free", { l: langName(lang) })));
    fr.appendChild(el("strong", "", t("stats.freeRow", { g: fs.g, w: fs.w })));
    dlg.appendChild(fr);
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

  function optsDialog() {
    var dlg = makeDialog("wordle-opts");
    dlg.appendChild(el("div", "dlg-title", t("opts.title")));
    [["hard", "opts.hard", "opts.hardSub"], ["contrast", "opts.contrast", "opts.contrastSub"]].forEach(function (o) {
      var lab = el("label", "wd-opt");
      var box = el("input");
      box.type = "checkbox";
      box.checked = o[0] === "hard" ? (game ? game.hard : prefs.hard) : prefs.contrast;
      box.addEventListener("change", function () {
        if (o[0] === "hard") {
          if (game && !game.done && game.guesses.length) {
            box.checked = game.hard;
            showToast(t("toast.hardLocked"));                    // R28
            return;
          }
          prefs.hard = box.checked;
          if (game && !game.done) { game.hard = box.checked; saveSessions(); }
        } else {
          prefs.contrast = box.checked;
        }
        savePrefs();
        renderAll();
      });
      lab.appendChild(box);
      var txt = el("span", "wd-opt-txt");
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
    var dlg = makeDialog("wordle-confirm");
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

  // Reset = a new epoch: every device drops entries older than br. A
  // daily word already played today stays played on this device's board.
  function resetStats() {
    data.br = Math.max(Date.now(), data.br + 1);
    data = mergeWordle(data, data);
    save();
    revive();
    renderAll();
    showToast(t("toast.reset"));
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "wordle", title: String(text) })) return;
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
      if (kind === "win") {
        [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
      } else if (kind === "lose") {
        [392, 330, 262].forEach(function (f, k) { tone(f, k * 0.14, 0.2, "triangle", 0.12); });
      } else tone(620, 0, 0.05, "triangle", 0.1);
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Toolbar icons (R9: injected by JS) ----------
  var UI_ICONS = {
    new:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    opts:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
    stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    back:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H9l-6 7 6 7h12z"/><path d="M17 9l-5 6M12 9l5 6"/></svg>',
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
  // Letters by key position (e.code), so the OS layout does not matter.
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

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;          // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      if (e.key === "Enter") {
        var a = document.activeElement;
        if (a && a.tagName === "BUTTON" && !a.classList.contains("key")) return;   // a focused button keeps Enter
        e.preventDefault(); submit(); return;
      }
      if (e.key === "Backspace") { e.preventDefault(); backspace(); return; }
      if (e.shiftKey) {                                        // Shift+N: new word (by position, any layout)
        if (e.code === "KeyN") { e.preventDefault(); newWord(); }
        return;
      }
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
      if (!b) return;
      var k = b.getAttribute("data-k");
      if (k === "enter") submit();
      else if (k === "back") backspace();
      else typeLetter(k);
    });
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
    api.registerSlice("wordle", sliceGet, sliceSet, STORAGE_KEY, mergeWordle);
  }

  function sliceGet() {
    return mergeWordle(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object") return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeWordle(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    // a daily word played on another device: show it as played here
    if (game && game.mode === "d" && !game.done && !game.guesses.length && playedElsewhere(game)) {
      game.done = true;
      saveSessions();
      renderAll();
    } else if (game) {
      revive();
      renderAll();
    }
    // no toast on merge (sync feedback = taskbar dot)
  }

  // ---------- 12. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    [].forEach.call(document.querySelectorAll("[data-i18n-title]"), function (n) {
      n.title = t(n.getAttribute("data-i18n-title"));
    });
    $("kb").setAttribute("aria-label", t("kb.label"));
  }

  function paintStatic() {
    [["opts-btn", "opts", "btn.opts"], ["new-btn", "new", "btn.new"],
     ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    paintSfxBtn();
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#lang-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () { setLangMode(b.getAttribute("data-lang"), prefs.mode); b.blur(); });
    });
    [].forEach.call(document.querySelectorAll("#mode-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () { setLangMode(prefs.lang, b.getAttribute("data-mode")); b.blur(); });
    });
    $("new-btn").addEventListener("click", function () { newWord(); $("new-btn").blur(); });
    $("opts-btn").addEventListener("click", optsDialog);
    $("stats-btn").addEventListener("click", statsDialog);
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("key");   // audible confirmation when turned on
    });
    wireScreenKeyboard();
    // A daily game left open past midnight: a new word when the app comes back.
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible" || !game || game.mode !== "d" || game.day === today()) return;
      pickGame();
      renderAll();
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
