// ============================================================
// orOS Hangman — App logic (v1.0.0)
// Guess the hidden word one letter at a time. Each letter that is not
// in the word adds a part to the figure; six misses and the word is
// lost. Every letter of the word found and it is won.
//   - words in English or Greek (own switch, default = orOS language);
//     Greek ignores accents and diaeresis, and ς is σ
//   - levels by word length: Easy 5–6, Medium 7–8, Hard 9–10 letters
//   - physical keys by position (the OS layout does not matter; Greek
//     follows the Greek keyboard), on-screen keyboard; a letter already
//     tried is greyed and refused with a toast (R28); Shift+N new word
//   - a word in progress is kept per language and resumes
// Data:
//   - synced slice "hangman" (oros-hangman-data): per language wins,
//     losses, current and best streak, as per-device rows (each device
//     only grows its own row; merge = per-row join) + a reset stamp br
//   - device-local (R10): oros-hangman-prefs (word language, level),
//     oros-hangman-session (the word in progress per language),
//     oros-hangman-device (row id), oros-hangman-sfx (sound on/off)
// Word lists: words-en.js / words-el.js (window.HANGMAN_WORDS).
// Sections:
//   1. Constants, i18n, helpers
//   2. Word model (normalize, reveal, misses, won / lost)
//   3. Synced data: load / save / normalize / merge (R5, R26)
//   4. Device-local prefs + session
//   5. Game flow (guess, finish, new word, language, level)
//   6. Render (toolbar, status, figure, word, keyboard)
//   7. Dialogs (result, records, confirm)
//   8. Toasts
//   9. Sound
//  10. Input (keys, on-screen keyboard, Contract Β)
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-hangman-data";
  var PREFS_KEY   = "oros-hangman-prefs";
  var SESSION_KEY = "oros-hangman-session";
  var DEVICE_KEY  = "oros-hangman-device";
  var SFX_KEY     = "oros-hangman-sfx";
  var DATA_VER    = 1;

  var MAX_MISS = 6;
  var LANGS = ["en", "el"];
  var LEVELS = ["e", "m", "h"];
  var LEVEL_LEN = { e: [5, 6], m: [7, 8], h: [9, 10] };
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
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "lang.en": "EN", "lang.el": "ΕΛ",
      "lang.enLong": "English words", "lang.elLong": "Greek words",
      "level.e": "Easy", "level.m": "Medium", "level.h": "Hard",
      "levelLen.e": "5–6 letters", "levelLen.m": "7–8 letters", "levelLen.h": "9–10 letters",
      "st.misses": "Misses",
      "st.streak": "Streak",
      "turn.play": "{n} letters: pick a letter",
      "turn.left": "{n} letters left to find",
      "turn.won": "Found it!",
      "turn.lost": "The word was {w}",
      "word.label": "The word, {n} letters",
      "word.slot": "Letter {i}: {l}",
      "word.blank": "Letter {i}: not found yet",
      "kb.label": "Letters",
      "kb.used": "{l}, already tried",
      "live.hit": "{l}: yes, {n} in the word",
      "live.miss": "{l}: not in the word. Misses {m} of 6",
      "live.won": "Found! {w}",
      "live.lost": "Out of guesses. The word was {w}",
      "res.won": "Found it!",
      "res.lost": "The word was",
      "res.misses": "Misses",
      "res.played": "Played",
      "res.winPct": "Won %",
      "res.streak": "Streak",
      "res.best": "Best streak",
      "res.again": "New word",
      "res.close": "Close",
      "stats.title": "Records",
      "stats.wl": "Won · lost",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "confirm.reset": "Delete the records on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Records reset",
      "toast.newword": "New word",
      "toast.undo": "Undo",
      "toast.used": "{l} was already tried",
      "toast.over": "This word is done: start a new one (Shift+N)",
      "toast.save": "Could not save: storage is full",
      "toast.noWords": "The word list did not load"
    },
    el: {
      "btn.new": "Νέα λέξη (Shift+N)",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "lang.en": "EN", "lang.el": "ΕΛ",
      "lang.enLong": "Αγγλικές λέξεις", "lang.elLong": "Ελληνικές λέξεις",
      "level.e": "Εύκολο", "level.m": "Μέτριο", "level.h": "Δύσκολο",
      "levelLen.e": "5–6 γράμματα", "levelLen.m": "7–8 γράμματα", "levelLen.h": "9–10 γράμματα",
      "st.misses": "Λάθη",
      "st.streak": "Σερί",
      "turn.play": "{n} γράμματα: διάλεξε ένα γράμμα",
      "turn.left": "Μένουν {n} γράμματα",
      "turn.won": "Βρέθηκε!",
      "turn.lost": "Η λέξη ήταν {w}",
      "word.label": "Η λέξη, {n} γράμματα",
      "word.slot": "Γράμμα {i}: {l}",
      "word.blank": "Γράμμα {i}: δεν βρέθηκε ακόμα",
      "kb.label": "Γράμματα",
      "kb.used": "{l}, δοκιμάστηκε ήδη",
      "live.hit": "{l}: ναι, {n} στη λέξη",
      "live.miss": "{l}: δεν υπάρχει. Λάθη {m} από 6",
      "live.won": "Βρέθηκε! {w}",
      "live.lost": "Τέλος προσπαθειών. Η λέξη ήταν {w}",
      "res.won": "Βρέθηκε!",
      "res.lost": "Η λέξη ήταν",
      "res.misses": "Λάθη",
      "res.played": "Παιχνίδια",
      "res.winPct": "Νίκες %",
      "res.streak": "Σερί",
      "res.best": "Καλύτερο σερί",
      "res.again": "Νέα λέξη",
      "res.close": "Κλείσιμο",
      "stats.title": "Ρεκόρ",
      "stats.wl": "Νίκες · ήττες",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.newword": "Νέα λέξη",
      "toast.undo": "Αναίρεση",
      "toast.used": "Το {l} δοκιμάστηκε ήδη",
      "toast.over": "Η λέξη τελείωσε: ξεκίνα νέα (Shift+N)",
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
    console.log("hangman.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Word model ----------
  // Upper case, no accents or diaeresis, final sigma as Σ, letters only.
  function normWord(s) {
    s = String(s || "");
    if (s.normalize) s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return s.toUpperCase().replace(/ς/g, "Σ").replace(/[^A-ZΑ-Ω]/g, "");
  }

  // The word as the player sees it: found letters, "_" for the rest.
  function reveal(word, guessed) {
    var out = "";
    for (var i = 0; i < word.length; i++) out += guessed.indexOf(word[i]) >= 0 ? word[i] : "_";
    return out;
  }

  // Letters tried that are not in the word, in the order tried.
  function missesOf(word, guessed) {
    var out = [];
    for (var i = 0; i < guessed.length; i++) if (word.indexOf(guessed[i]) < 0) out.push(guessed[i]);
    return out;
  }

  // How many times a letter appears in the word.
  function countIn(word, l) {
    var n = 0;
    for (var i = 0; i < word.length; i++) if (word[i] === l) n++;
    return n;
  }

  // "w" won, "l" lost, "" still playing.
  function outcome(word, guessed) {
    if (missesOf(word, guessed).length >= MAX_MISS) return "l";
    return reveal(word, guessed).indexOf("_") < 0 ? "w" : "";
  }

  // Add a letter to the tried ones: { ok, guessed, hit } — refused when
  // already tried, not a letter of the alphabet, or the word is over.
  function tryLetter(word, guessed, l, alphabet) {
    if (l.length !== 1 || alphabet.indexOf(l) < 0 || guessed.indexOf(l) >= 0 || outcome(word, guessed)) {
      return { ok: false, guessed: guessed, hit: 0 };
    }
    return { ok: true, guessed: guessed + l, hit: countIn(word, l) };
  }

  // ---------- Word lists ----------
  var LISTS = {};      // lang → { e: [...], m: [...], h: [...], set: { word: level } }
  function splitList(s) { return String(s || "").split(" ").filter(Boolean); }
  function lists(lang) {
    if (LISTS[lang]) return LISTS[lang];
    var src = window.HANGMAN_WORDS && window.HANGMAN_WORDS[lang];
    if (!src) return null;
    var out = { set: {} };
    LEVELS.forEach(function (lv) {
      out[lv] = splitList(src[lv]);
      out[lv].forEach(function (w) { out.set[w] = lv; });
    });
    LISTS[lang] = out;
    return out;
  }

  // ---------- 3. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                       // max-merged
  //   rows: { <deviceId>: { b: <epoch>,
  //                         s: { en|el: { w: won, l: lost, c: current streak,
  //                                       m: best streak, ts: last result } } } }
  // }
  // Each device only ever writes ITS OWN row, and every result adds one
  // game (w + l grows). Merge per row: the newer epoch wins; equal epochs
  // keep, per language, the later state: more games, then the later ts,
  // then the larger w, c, m (a total order, so the max is a join:
  // symmetric, associative, idempotent). Rows older than br drop.
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normCell(c) {
    if (!c || typeof c !== "object" || !isInt(c.w) || !isInt(c.l) || !isInt(c.c) || !isInt(c.m) ||
        !isInt(c.ts) || c.w < 0 || c.l < 0 || c.w + c.l < 1 || c.c < 0 || c.m < c.c || c.m > c.w ||
        c.ts < 0) return null;
    return { w: c.w, l: c.l, c: c.c, m: c.m, ts: c.ts };
  }
  function normRow(row) {
    if (!row || typeof row !== "object" || !isInt(row.b) || row.b < 0) return null;
    var s = {}, any = false;
    LANGS.forEach(function (k) {
      var c = normCell(row.s && row.s[k]);
      if (c) { s[k] = c; any = true; }
    });
    return any ? { b: row.b, s: s } : null;
  }
  // The later of two states of the same counters.
  function joinCell(a, c) {
    var ka = [a.w + a.l, a.ts, a.w, a.c, a.m], kc = [c.w + c.l, c.ts, c.w, c.c, c.m];
    for (var i = 0; i < ka.length; i++) if (ka[i] !== kc[i]) return ka[i] > kc[i] ? a : c;
    return a;
  }
  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var s = {};
    LANGS.forEach(function (k) {
      var a = x.s[k], c = y.s[k];
      if (!a && !c) return;
      s[k] = normCell((a && c) ? joinCell(a, c) : (a || c));
    });
    return { b: x.b, s: s };
  }

  function mergeHangman(A, B) {
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
      LANGS.forEach(function (k) { if (r.s[k]) s[k] = r.s[k]; });
      sorted[id] = { b: r.b, s: s };
    });
    return { ver: DATA_VER, br: br, rows: sorted };
  }

  // Totals for a language across every device: won, lost, best streak,
  // and the current streak of the device that played last.
  function totals(d, lang) {
    var out = { w: 0, l: 0, m: 0, c: 0 }, last = -1;
    Object.keys(d.rows).forEach(function (id) {
      var c = d.rows[id].s[lang];
      if (!c) return;
      out.w += c.w; out.l += c.l;
      if (c.m > out.m) out.m = c.m;
      if (c.ts > last) { last = c.ts; out.c = c.c; }
    });
    return out;
  }

  // The next state of a cell after one result.
  function addResult(c, won, ts) {
    c = c || { w: 0, l: 0, c: 0, m: 0, ts: 0 };
    var cur = won ? c.c + 1 : 0;
    return { w: c.w + (won ? 1 : 0), l: c.l + (won ? 0 : 1), c: cur, m: Math.max(c.m, cur), ts: Math.max(ts, c.ts) };
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.rows && typeof parsed.rows === "object") {
          data = mergeHangman(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] hangman: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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

  function countGame(lang, won) {
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // new epoch after a reset
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    row.s[lang] = addResult(row.s[lang], won, Date.now());
    data.rows[deviceId] = row;
    data = mergeHangman(data, data);
    save();
  }

  // ---------- 4. Device-local prefs + session ----------
  var prefs = { lang: LANG, level: "e" };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (LANGS.indexOf(p.lang) >= 0) prefs.lang = p.lang;
        if (LEVELS.indexOf(p.level) >= 0) prefs.level = p.level;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // One word per language: { lang, level, word, guessed, done }
  var sessions = {};
  var game = null;

  function validGame(g, key) {
    var L = g && lists(g.lang);
    if (!g || typeof g !== "object" || LANGS.indexOf(g.lang) < 0 || key !== g.lang ||
        LEVELS.indexOf(g.level) < 0 || !L || typeof g.word !== "string" || L.set[g.word] !== g.level ||
        typeof g.guessed !== "string" || typeof g.done !== "boolean") return false;
    for (var i = 0; i < g.guessed.length; i++) {
      if (LETTERS[g.lang].indexOf(g.guessed[i]) < 0 || g.guessed.indexOf(g.guessed[i]) !== i) return false;
    }
    return g.done === !!outcome(g.word, g.guessed);
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
    if (game) sessions[game.lang] = game;
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(sessions)); } catch (e) {}
  }

  // ---------- 5. Game flow ----------
  function freshGame(lang, level) {
    var L = lists(lang);
    if (!L || !L[level].length) return null;
    return { lang: lang, level: level, word: L[level][randInt(L[level].length)], guessed: "", done: false };
  }

  // The saved word of the current language, or a new one.
  function pickGame() {
    var g = sessions[prefs.lang];
    if (!g) g = freshGame(prefs.lang, prefs.level);
    game = g;
    if (game) {
      if (prefs.level !== game.level) { prefs.level = game.level; savePrefs(); }
      saveSessions();
    }
  }

  function inProgress() { return !!(game && !game.done && game.guessed.length > 0); }

  var finishTimer = null;

  // Can a letter be played now? (R28: say why not)
  function gate() {
    if (!game || document.querySelector("dialog[open]")) return false;
    if (game.done) { showToast(t("toast.over")); return false; }
    return true;
  }

  function guess(l) {
    if (!gate()) return;
    if (game.guessed.indexOf(l) >= 0) {
      showToast(t("toast.used", { l: l }));
      shakeKey(l);
      return;
    }
    var r = tryLetter(game.word, game.guessed, l, LETTERS[game.lang]);
    if (!r.ok) return;
    game.guessed = r.guessed;
    var end = outcome(game.word, game.guessed);
    if (end) game.done = true;
    saveSessions();
    if (end) countGame(game.lang, end === "w");
    renderAll(r.hit ? "" : l);
    if (r.hit) live(t("live.hit", { l: l, n: r.hit }));
    else live(t("live.miss", { l: l, m: missesOf(game.word, game.guessed).length }));
    if (end) {
      sfx(end === "w" ? "win" : "lose");
      setTimeout(function () { live(t(end === "w" ? "live.won" : "live.lost", { w: game.word })); }, 400);
      clearTimeout(finishTimer);
      var g = game;
      finishTimer = setTimeout(function () { if (game === g) resultDialog(); }, end === "w" ? 700 : 900);
    } else {
      sfx(r.hit ? "hit" : "miss");
    }
  }

  // A new word (same language and level). A word in progress is never
  // lost silently (R14): Undo toast.
  function newWord(level) {
    closeDialogs();
    clearTimeout(finishTimer);
    var prev = inProgress() ? JSON.parse(JSON.stringify(game)) : null;
    var prevLevel = prefs.level;
    if (level) { prefs.level = level; savePrefs(); }
    var g = freshGame(prefs.lang, prefs.level);
    if (!g) { showToast(t("toast.noWords")); return; }
    game = g;
    saveSessions();
    renderAll(null, true);
    if (prev) {
      undoToast(t("toast.newword"), function () {
        prefs.lang = prev.lang; prefs.level = prevLevel; savePrefs();
        game = prev;
        saveSessions();
        renderAll(null, true);
      });
    } else {
      live(t("toast.newword"));
    }
  }

  function setLang(lang) {
    if (game && lang === game.lang) return;
    clearTimeout(finishTimer);
    prefs.lang = lang; savePrefs();
    closeDialogs();
    pickGame();
    renderAll(null, true);
  }

  function setLevel(level) {
    if (game && level === game.level) return;
    newWord(level);
  }

  // ---------- 6. Render ----------
  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function renderAll(missed, rebuild) {
    renderToolbar();
    renderStatus();
    renderFigure(!!missed);
    renderWord(rebuild);
    renderKeyboard();
  }

  function renderToolbar() {
    var lang = game ? game.lang : prefs.lang, level = game ? game.level : prefs.level;
    [].forEach.call(document.querySelectorAll("#lang-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-lang") === lang;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      var lv = b.getAttribute("data-level"), on = lv === level;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.title = t("levelLen." + lv);
    });
    paintSfxBtn();
  }

  function renderStatus() {
    if (!game) { $("turn").textContent = t("toast.noWords"); return; }
    var miss = missesOf(game.word, game.guessed).length, end = outcome(game.word, game.guessed);
    $("misses").textContent = miss + "/" + MAX_MISS;
    $("misses").className = miss >= MAX_MISS - 1 ? "warn" : "";
    $("streak").textContent = String(totals(data, game.lang).c);
    var msg, cls = "";
    if (end === "w") { msg = t("turn.won"); cls = "done"; }
    else if (end === "l") { msg = t("turn.lost", { w: game.word }); cls = "warn"; }
    else if (!game.guessed.length) msg = t("turn.play", { n: game.word.length });
    else {
      var left = 0, r = reveal(game.word, game.guessed);
      for (var i = 0; i < r.length; i++) if (r[i] === "_") left++;
      msg = t("turn.left", { n: left });
    }
    $("turn").textContent = msg;
    $("turn").className = cls;
  }

  // Gallows + figure; part k (1…6) appears with the k-th miss.
  var FIG_PARTS = [
    '<circle class="fp" cx="138" cy="66" r="17"/>',
    '<path class="fp" d="M138 83v58"/>',
    '<path class="fp" d="M138 98l-24 26"/>',
    '<path class="fp" d="M138 98l24 26"/>',
    '<path class="fp" d="M138 141l-20 40"/>',
    '<path class="fp" d="M138 141l20 40"/>'
  ];
  function figureSvg(n, end) {
    var s = '<svg viewBox="0 0 200 220" xmlns="http://www.w3.org/2000/svg">' +
      '<g class="gallows"><path d="M18 206h112"/><path d="M48 206V18h90v31"/><path d="M48 50l32-32"/></g>' +
      '<g class="body' + (end ? " " + end : "") + '">';
    for (var k = 0; k < n && k < FIG_PARTS.length; k++) s += FIG_PARTS[k];
    if (end === "l") s += '<path class="eyes" d="M131 61l5 5M136 61l-5 5M140 61l5 5M145 61l-5 5"/>';
    return s + "</g></svg>";
  }
  function renderFigure(animateLast) {
    if (!game) return;
    var n = missesOf(game.word, game.guessed).length, end = outcome(game.word, game.guessed);
    $("figure").innerHTML = figureSvg(n, end);
    if (animateLast && n && !reduced) {
      var parts = $("figure").querySelectorAll(".fp");
      var last = parts[parts.length - 1];
      if (last) last.classList.add("draw");
    }
  }

  function renderWord(rebuild) {
    var box = $("word");
    if (!game) { box.innerHTML = ""; return; }
    var r = reveal(game.word, game.guessed), end = outcome(game.word, game.guessed);
    if (rebuild || box.children.length !== r.length || box.getAttribute("data-w") !== game.lang + game.word.length) {
      box.innerHTML = "";
      box.setAttribute("data-w", game.lang + game.word.length);
      box.style.setProperty("--n", String(r.length));
      for (var i = 0; i < r.length; i++) box.appendChild(el("span", "slot"));
    }
    box.setAttribute("aria-label", t("word.label", { n: r.length }));
    for (var j = 0; j < r.length; j++) {
      var s = box.children[j], shown = r[j] !== "_";
      var was = s.textContent;
      var text = shown ? r[j] : (end === "l" ? game.word[j] : "");
      s.textContent = text;
      s.className = "slot" + (shown ? " on" : "") + (!shown && end === "l" ? " missed" : "") +
        (shown && !was && !rebuild && !reduced ? " pop" : "");
      s.setAttribute("aria-label", shown ? t("word.slot", { i: j + 1, l: r[j] }) : t("word.blank", { i: j + 1 }));
    }
    box.classList.toggle("won", end === "w");
  }

  function renderKeyboard() {
    var kb = $("kb"), lang = game ? game.lang : prefs.lang;
    if (kb.getAttribute("data-lang") !== lang) {
      kb.innerHTML = "";
      kb.setAttribute("data-lang", lang);
      KB_ROWS[lang].forEach(function (letters) {
        var row = el("div", "kb-row");
        letters.split("").forEach(function (l) {
          var b = el("button", "key", l);
          b.type = "button";
          b.setAttribute("data-k", l);
          b.tabIndex = -1;
          row.appendChild(b);
        });
        kb.appendChild(row);
      });
    }
    [].forEach.call(kb.querySelectorAll(".key"), function (b) {
      var k = b.getAttribute("data-k"), used = !!game && game.guessed.indexOf(k) >= 0;
      var hit = used && game.word.indexOf(k) >= 0;
      b.classList.toggle("hit", hit);
      b.classList.toggle("miss", used && !hit);
      b.setAttribute("aria-disabled", used ? "true" : "false");
      b.setAttribute("aria-label", used ? t("kb.used", { l: k }) : k);
    });
  }

  function shakeKey(l) {
    var b = document.querySelector('#kb .key[data-k="' + l + '"]');
    if (!b || reduced) return;
    b.classList.remove("shake");
    void b.offsetWidth;
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
  function langName(l) { return t(l === "el" ? "lang.elLong" : "lang.enLong"); }

  function numsBlock(s) {
    var nums = el("div", "hm-nums"), g = s.w + s.l;
    [[t("res.played"), g], [t("res.winPct"), g ? Math.round(100 * s.w / g) : 0],
     [t("res.streak"), s.c], [t("res.best"), s.m]].forEach(function (x) {
      var c = el("div", "hm-num");
      c.appendChild(el("strong", "", String(x[1])));
      c.appendChild(el("span", "", x[0]));
      nums.appendChild(c);
    });
    return nums;
  }

  function resultDialog() {
    if (!game || !game.done) return;
    closeDialogs();
    var won = outcome(game.word, game.guessed) === "w";
    var dlg = makeDialog("hangman-result");
    dlg.appendChild(el("div", "dlg-title", t("level." + game.level) + " · " + langName(game.lang)));
    if (won) dlg.appendChild(el("div", "dlg-hero", t("res.won")));
    else dlg.appendChild(el("div", "dlg-msg hm-center", t("res.lost")));
    dlg.appendChild(el("div", "dlg-hero hm-word" + (won ? "" : " lost"), game.word));
    dlg.appendChild(row(t("res.misses"), missesOf(game.word, game.guessed).length + "/" + MAX_MISS));
    dlg.appendChild(numsBlock(totals(data, game.lang)));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("res.close"), "", function () { dlg.close(); }));
    var again = button(t("res.again"), "primary", function () { dlg.close(); newWord(); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    again.focus();
  }

  function statsDialog() {
    var dlg = makeDialog("hangman-stats"), empty = true;
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    LANGS.forEach(function (l) {
      var s = totals(data, l);
      if (s.w + s.l) empty = false;
      dlg.appendChild(el("div", "dlg-sub", langName(l)));
      dlg.appendChild(numsBlock(s));
      dlg.appendChild(row(t("stats.wl"), s.w + " · " + s.l));
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
    var dlg = makeDialog("hangman-confirm");
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

  // Reset = a new epoch: every device drops rows older than br.
  function resetRecords() {
    data.br = Math.max(Date.now(), data.br + 1);
    data = mergeHangman(data, data);
    save();
    renderStatus();
    showToast(t("toast.reset"));
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "hangman", title: String(text) })) return;
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
      } else if (kind === "hit") {
        tone(740, 0, 0.08, "triangle", 0.12);
      } else if (kind === "miss") {
        tone(220, 0, 0.12, "sine", 0.14);
      } else tone(620, 0, 0.05, "triangle", 0.1);
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Toolbar icons (R9: injected by JS) ----------
  var UI_ICONS = {
    new:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
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
  function letterFor(e, lang) {
    var m = /^Key([A-Z])$/.exec(e.code || "");
    if (lang === "el") {
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
      if (e.shiftKey) {                                        // Shift+N: new word (by position, any layout)
        if (e.code === "KeyN") { e.preventDefault(); newWord(); }
        return;
      }
      if (e.repeat || !game) return;
      var l = letterFor(e, game.lang);
      if (l) { e.preventDefault(); guess(l); }
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
      if (b) guess(b.getAttribute("data-k"));
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
    api.registerSlice("hangman", sliceGet, sliceSet, STORAGE_KEY, mergeHangman);
  }

  function sliceGet() {
    return mergeHangman(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeHangman(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    renderStatus();
    // no toast on merge (sync feedback = taskbar dot)
  }

  // ---------- 12. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    $("kb").setAttribute("aria-label", t("kb.label"));
    $("lang-seg").setAttribute("aria-label", t("lang.enLong") + " / " + t("lang.elLong"));
  }

  function paintStatic() {
    [["new-btn", "new", "btn.new"], ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    $("lang-seg").querySelector('[data-lang="en"]').title = t("lang.enLong");
    $("lang-seg").querySelector('[data-lang="el"]').title = t("lang.elLong");
    paintSfxBtn();
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#lang-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () { setLang(b.getAttribute("data-lang")); b.blur(); });
    });
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () { setLevel(b.getAttribute("data-level")); b.blur(); });
    });
    $("new-btn").addEventListener("click", function () { newWord(); $("new-btn").blur(); });
    $("stats-btn").addEventListener("click", function () { $("stats-btn").blur(); statsDialog(); });
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("key");   // audible confirmation when turned on
    });
    wireScreenKeyboard();
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
    renderAll(null, true);
    if (!game) showToast(t("toast.noWords"));
  }

  boot();
})();
