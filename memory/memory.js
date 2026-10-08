// ============================================================
// orOS Memory — App logic (v1.0.0)
// Classic pairs game: flip two cards, keep them if they match.
//   - 4 levels: Easy 4×3 (6 pairs) · Medium 4×4 (8) · Hard 6×4 (12)
//     · Expert 6×6 (18); the grid turns upright on a portrait screen
//   - 3 symbol sets, all drawn in-house (inline SVG / text, no emoji):
//     shapes (6 shapes × 3 colours), icons (18 line icons), letters
//     (Greek Α–Σ under EL, Latin A–R under EN)
//   - Solo: moves + timer, best per level (fewest moves, then time)
//   - 2 players on one device: a match keeps the turn, a miss passes it
// Data:
//   - synced slice "memory" (oros-memory-data): finished games
//     (cap 50, union by id) + best per level ("better wins") + a reset
//     stamp br (anything at or before br is gone on every device)
//   - device-local (R10): oros-memory-prefs (level, mode, set),
//     oros-memory-session (the game in progress, resumable),
//     oros-memory-sfx (sound on/off)
// Sections:
//   1. Constants, i18n, helpers
//   2. Symbols (shapes, icons, letters)
//   3. Synced data: load / save / normalize / merge (R5, R26)
//   4. Device-local prefs + session
//   5. Game engine (deal, flip, resolve, win)
//   6. Timer
//   7. Render (toolbar, status, board layout, cards)
//   8. Dialogs (win, stats, confirm)
//   9. Toasts (shell transient + local undo toast)
//  10. Sound (WebAudio synth, no files)
//  11. Keyboard (roving focus, N = new game, Contract Β)
//  12. Sync slice + palette
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-memory-data";
  var PREFS_KEY   = "oros-memory-prefs";
  var SESSION_KEY = "oros-memory-session";
  var SFX_KEY     = "oros-memory-sfx";
  var DATA_VER    = 1;
  var HISTORY_CAP = 50;
  var MISS_DELAY  = 850;   // ms a non-matching pair stays face up

  // cols × rows in landscape; portrait swaps them
  var LEVELS = {
    e: { cols: 4, rows: 3 },
    m: { cols: 4, rows: 4 },
    h: { cols: 6, rows: 4 },
    x: { cols: 6, rows: 6 }
  };
  var LEVEL_ORDER = ["e", "m", "h", "x"];
  var SETS = ["shapes", "icons", "letters"];
  var MODES = ["solo", "duo"];

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
      "level.e": "Easy", "level.m": "Medium", "level.h": "Hard", "level.x": "Expert",
      "mode.solo": "Solo", "mode.duo": "2 players",
      "set.shapes": "Shapes", "set.icons": "Icons", "set.letters": "Letters",
      "set.label": "Symbols",
      "stat.moves": "Moves", "stat.time": "Time", "stat.best": "Best",
      "player.1": "Player 1", "player.2": "Player 2",
      "btn.new": "New game (N)", "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "board.label": "Cards",
      "card.down": "Card {n}, face down",
      "card.open": "{name}, face up",
      "card.matched": "{name}, matched",
      "live.match": "Pair found: {name}",
      "live.miss": "No match",
      "live.turn": "{player}'s turn",
      "win.title": "Finished",
      "win.solo": "Well done!",
      "win.duo": "{player} wins!",
      "win.draw": "It's a draw!",
      "win.record": "New record!",
      "win.again": "Play again",
      "win.close": "Close",
      "stats.title": "Records",
      "stats.best": "Best",
      "stats.none": "—",
      "stats.played": "Games played (last {n})",
      "stats.duo": "2-player games",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "confirm.reset": "Delete all records and the game history on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Records reset",
      "toast.newgame": "New game started",
      "toast.undo": "Undo",
      "toast.save": "Could not save: storage is full",
      "fmt.best": "{moves} moves · {time}",
      "shape.circle": "Circle", "shape.square": "Square", "shape.triangle": "Triangle",
      "shape.diamond": "Diamond", "shape.star": "Star", "shape.heart": "Heart",
      "color.0": "red", "color.1": "blue outline", "color.2": "yellow",
      "icon.sun": "Sun", "icon.moon": "Moon", "icon.cloud": "Cloud", "icon.star": "Star",
      "icon.heart": "Heart", "icon.drop": "Drop", "icon.bolt": "Lightning",
      "icon.umbrella": "Umbrella", "icon.music": "Music", "icon.bell": "Bell",
      "icon.key": "Key", "icon.anchor": "Anchor", "icon.flag": "Flag", "icon.gift": "Gift",
      "icon.cup": "Cup", "icon.leaf": "Leaf", "icon.snow": "Snowflake", "icon.flame": "Flame",
      "letter": "Letter {c}"
    },
    el: {
      "level.e": "Εύκολο", "level.m": "Μεσαίο", "level.h": "Δύσκολο", "level.x": "Expert",
      "mode.solo": "Μόνος", "mode.duo": "2 παίκτες",
      "set.shapes": "Σχήματα", "set.icons": "Εικονίδια", "set.letters": "Γράμματα",
      "set.label": "Σύμβολα",
      "stat.moves": "Κινήσεις", "stat.time": "Χρόνος", "stat.best": "Ρεκόρ",
      "player.1": "Παίκτης 1", "player.2": "Παίκτης 2",
      "btn.new": "Νέο παιχνίδι (N)", "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "board.label": "Κάρτες",
      "card.down": "Κάρτα {n}, κλειστή",
      "card.open": "{name}, ανοιχτή",
      "card.matched": "{name}, βρέθηκε",
      "live.match": "Βρέθηκε ζευγάρι: {name}",
      "live.miss": "Δεν ταιριάζουν",
      "live.turn": "Σειρά: {player}",
      "win.title": "Τέλος",
      "win.solo": "Μπράβο!",
      "win.duo": "Νικητής: {player}!",
      "win.draw": "Ισοπαλία!",
      "win.record": "Νέο ρεκόρ!",
      "win.again": "Ξανά",
      "win.close": "Κλείσιμο",
      "stats.title": "Ρεκόρ",
      "stats.best": "Ρεκόρ",
      "stats.none": "—",
      "stats.played": "Παιχνίδια (τελευταία {n})",
      "stats.duo": "Παιχνίδια 2 παικτών",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν όλα τα ρεκόρ και το ιστορικό σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.newgame": "Ξεκίνησε νέο παιχνίδι",
      "toast.undo": "Αναίρεση",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "fmt.best": "{moves} κινήσεις · {time}",
      "shape.circle": "Κύκλος", "shape.square": "Τετράγωνο", "shape.triangle": "Τρίγωνο",
      "shape.diamond": "Ρόμβος", "shape.star": "Αστέρι", "shape.heart": "Καρδιά",
      "color.0": "κόκκινο", "color.1": "μπλε περίγραμμα", "color.2": "κίτρινο",
      "icon.sun": "Ήλιος", "icon.moon": "Φεγγάρι", "icon.cloud": "Σύννεφο", "icon.star": "Αστέρι",
      "icon.heart": "Καρδιά", "icon.drop": "Σταγόνα", "icon.bolt": "Κεραυνός",
      "icon.umbrella": "Ομπρέλα", "icon.music": "Μουσική", "icon.bell": "Καμπάνα",
      "icon.key": "Κλειδί", "icon.anchor": "Άγκυρα", "icon.flag": "Σημαία", "icon.gift": "Δώρο",
      "icon.cup": "Φλιτζάνι", "icon.leaf": "Φύλλο", "icon.snow": "Νιφάδα", "icon.flame": "Φλόγα",
      "letter": "Γράμμα {c}"
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
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }

  function fmtTime(ms) {
    var s = Math.floor((ms || 0) / 1000);
    var m = Math.floor(s / 60);
    s = s % 60;
    return (m < 10 ? "0" + m : String(m)) + ":" + (s < 10 ? "0" + s : String(s));
  }

  // crypto RNG with rejection sampling (same as Dice)
  function randInt(n) {
    var buf = new Uint32Array(1);
    var lim = 0xFFFFFFFF - (0xFFFFFFFF % n);
    while (true) {
      crypto.getRandomValues(buf);
      if (buf[0] < lim) return buf[0] % n;
    }
  }
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = randInt(i + 1);
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("memory.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Symbols ----------
  // Every set has exactly 18 symbols (enough for Expert). A game picks
  // its symbols by index, so a session stays valid across languages.
  var SYMBOL_COUNT = 18;
  var SHAPE_COLORS = ["#e06c75", "#4fc4cf", "#ecc75f"];   // LABEL_COLORS
  var SHAPES = ["circle", "square", "triangle", "diamond", "star", "heart"];
  var SHAPE_PATHS = {
    circle:   '<circle cx="12" cy="12" r="8.5"/>',
    square:   '<rect x="4" y="4" width="16" height="16" rx="2"/>',
    triangle: '<path d="M12 3.5 21 19.5H3z"/>',
    diamond:  '<path d="M12 2.5 21.5 12 12 21.5 2.5 12z"/>',
    star:     '<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/>',
    heart:    '<path d="M12 20.5 4.3 13a4.9 4.9 0 0 1 7-7l.7.7.7-.7a4.9 4.9 0 0 1 7 7z"/>'
  };
  var ICON_IDS = ["sun", "moon", "cloud", "star", "heart", "drop", "bolt", "umbrella",
                  "music", "bell", "key", "anchor", "flag", "gift", "cup", "leaf",
                  "snow", "flame"];
  var ICON_PATHS = {
    sun:      '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon:     '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    cloud:    '<path d="M17.5 19H8a6 6 0 1 1 5.7-7.9A4.5 4.5 0 1 1 17.5 19z"/>',
    star:     '<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/>',
    heart:    '<path d="M12 20.5 4.3 13a4.9 4.9 0 0 1 7-7l.7.7.7-.7a4.9 4.9 0 0 1 7 7z"/>',
    drop:     '<path d="M12 2.7l5.7 5.6a8 8 0 1 1-11.3 0z"/>',
    bolt:     '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    umbrella: '<path d="M22 12a10 10 0 0 0-20 0z"/><path d="M12 12v7a2.5 2.5 0 0 1-5 0"/>',
    music:    '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    bell:     '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    key:      '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 20 3M16 7l3 3M18 5l2 2"/>',
    anchor:   '<circle cx="12" cy="5" r="2.5"/><path d="M12 7.5V22M5 12H2a10 10 0 0 0 20 0h-3M8 11h8"/>',
    flag:     '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
    gift:     '<path d="M20 12v10H4V12"/><rect x="2" y="7" width="20" height="5"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
    cup:      '<path d="M17 8h1a4 4 0 0 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><path d="M7 1v3M11 1v3M15 1v3"/>',
    leaf:     '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z"/><path d="M2 21c0-3 1.9-5.4 5.2-6.1"/>',
    snow:     '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7"/><path d="M9 4l3 2 3-2M9 20l3-2 3 2"/>',
    flame:    '<path d="M12 22a7 7 0 0 0 7-7c0-4-3-6-4.5-9.5C13 8 11.5 9 10 8.5 9.5 7 10 4.5 11 2 7 4 5 9 5 15a7 7 0 0 0 7 7z"/>'
  };
  var ICON_COLORS = ["#e06c75", "#ecc75f", "#87cf3e", "#4fc4cf", "#6d4aff", "#e09ecf", "#f28c5a"];
  var LETTERS = {
    en: "ABCDEFGHIJKLMNOPQR",
    el: "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣ"
  };

  function symbolSvg(set, idx) {
    if (set === "shapes") {
      var shape = SHAPES[idx % 6], ci = Math.floor(idx / 6);
      var col = SHAPE_COLORS[ci];
      var paint = (ci === 1)
        ? 'fill="none" stroke="' + col + '" stroke-width="2.6" stroke-linejoin="round"'
        : 'fill="' + col + '" stroke="none"';
      return '<svg viewBox="0 0 24 24" aria-hidden="true" ' + paint + '>' + SHAPE_PATHS[shape] + '</svg>';
    }
    if (set === "icons") {
      var id = ICON_IDS[idx];
      return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="' +
        ICON_COLORS[idx % ICON_COLORS.length] +
        '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        ICON_PATHS[id] + '</svg>';
    }
    return '<span class="glyph" aria-hidden="true">' + LETTERS[LANG].charAt(idx) + '</span>';
  }

  function symbolName(set, idx) {
    if (set === "shapes") {
      return t("shape." + SHAPES[idx % 6]) + " (" + t("color." + Math.floor(idx / 6)) + ")";
    }
    if (set === "icons") return t("icon." + ICON_IDS[idx]);
    return t("letter", { c: LETTERS[LANG].charAt(idx) });
  }

  // ---------- 3. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                       // max-merged
  //   best: { <lv>: { id, ts, moves, ms } },   // solo only, better wins
  //   games: [{ id, ts, lv, mode, set, moves, ms, s?: [p1, p2] }]
  // }
  // Entries are immutable (written once at the end of a game), so a
  // union by id with a byte tie-break is enough; there are no edits.
  var data = null;

  function defaultData() { return { ver: DATA_VER, br: 0, best: {}, games: [] }; }

  function normBest(b) {
    if (!b || typeof b !== "object") return null;
    if (typeof b.id !== "string" || !isInt(b.ts) || !isInt(b.moves) || b.moves < 0 ||
        !isInt(b.ms) || b.ms < 0) return null;
    return { id: b.id, ts: b.ts, moves: b.moves, ms: b.ms };
  }
  function normGame(g) {
    if (!g || typeof g !== "object") return null;
    if (typeof g.id !== "string" || !isInt(g.ts) || !LEVELS[g.lv] ||
        MODES.indexOf(g.mode) < 0 || SETS.indexOf(g.set) < 0 ||
        !isInt(g.moves) || g.moves < 0 || !isInt(g.ms) || g.ms < 0) return null;
    var out = { id: g.id, ts: g.ts, lv: g.lv, mode: g.mode, set: g.set, moves: g.moves, ms: g.ms };
    if (g.mode === "duo") {
      if (!Array.isArray(g.s) || g.s.length !== 2 || !isInt(g.s[0]) || !isInt(g.s[1])) return null;
      out.s = [g.s[0], g.s[1]];
    }
    return out;
  }

  // Is a strictly better than b? Fewer moves, then less time, then the
  // earlier game, then id: a total order, so the pick is symmetric (R5).
  function better(a, b) {
    if (a.moves !== b.moves) return a.moves < b.moves;
    if (a.ms !== b.ms) return a.ms < b.ms;
    if (a.ts !== b.ts) return a.ts < b.ts;
    return cmpStr(a.id, b.id) < 0;
  }
  function gameCmp(x, y) {   // newest first, tie → id
    return (y.ts - x.ts) || cmpStr(x.id, y.id);
  }

  function mergeMemory(A, B) {
    var a = A || {}, b = B || {};
    var br = Math.max(isInt(a.br) ? a.br : 0, isInt(b.br) ? b.br : 0);

    var best = {};
    [a.best || {}, b.best || {}].forEach(function (m) {
      Object.keys(m).forEach(function (lv) {
        if (!LEVELS[lv]) return;
        var e = normBest(m[lv]);
        if (!e || e.ts <= br) return;
        if (!best[lv] || better(e, best[lv])) best[lv] = e;
      });
    });
    var bestSorted = {};

    var map = {};
    [a.games || [], b.games || []].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var g = normGame(raw);
        if (!g || g.ts <= br) return;
        var ex = map[g.id];
        if (!ex || JSON.stringify(g) < JSON.stringify(ex)) map[g.id] = g;
      });
    });
    var games = Object.keys(map).map(function (id) { return map[id]; });
    games.sort(gameCmp);
    if (games.length > HISTORY_CAP) games = games.slice(0, HISTORY_CAP);
    // A solo game in the history is a record candidate too: after a
    // reset on another device, a game finished here later (but worse
    // than the old record) must become the new record, not vanish.
    games.forEach(function (g) {
      if (g.mode !== "solo") return;
      var e = { id: g.id, ts: g.ts, moves: g.moves, ms: g.ms };
      if (!best[g.lv] || better(e, best[g.lv])) best[g.lv] = e;
    });
    LEVEL_ORDER.forEach(function (lv) { if (best[lv]) bestSorted[lv] = best[lv]; });

    return { ver: DATA_VER, br: br, best: bestSorted, games: games };
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.games)) {
          data = mergeMemory(parsed, parsed);
          return;
        }
      } catch (e) {}
      // unreadable → device-local rescue copy BEFORE the fresh state
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] memory: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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

  // ---------- 4. Device-local prefs + session ----------
  var prefs = { lv: "m", mode: "solo", set: "shapes" };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (LEVELS[p.lv]) prefs.lv = p.lv;
        if (MODES.indexOf(p.mode) >= 0) prefs.mode = p.mode;
        if (SETS.indexOf(p.set) >= 0) prefs.set = p.set;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = {
  //   lv, mode, set,
  //   deck: [symbolIdx × 2n],          // board order
  //   state: [0 down | 1 open | 2 matched] per card
  //   by: [-1 | 0 | 1] per card        // who matched it (duo colour)
  //   open: [i] (0–2 face-up, unmatched)
  //   moves, ms (elapsed before the current run), turn, s: [p1, p2],
  //   done: bool
  // }
  var game = null;

  function validSession(g) {
    if (!g || typeof g !== "object" || !LEVELS[g.lv] || MODES.indexOf(g.mode) < 0 ||
        SETS.indexOf(g.set) < 0 || !Array.isArray(g.deck)) return false;
    var L = LEVELS[g.lv], n = L.cols * L.rows;
    if (g.deck.length !== n || !Array.isArray(g.state) || g.state.length !== n ||
        !Array.isArray(g.by) || g.by.length !== n || !Array.isArray(g.open) ||
        !Array.isArray(g.s) || g.s.length !== 2) return false;
    for (var i = 0; i < n; i++) {
      if (!isInt(g.deck[i]) || g.deck[i] < 0 || g.deck[i] >= SYMBOL_COUNT) return false;
      if ([0, 1, 2].indexOf(g.state[i]) < 0) return false;
    }
    return isInt(g.moves) && isInt(g.ms) && isInt(g.s[0]) && isInt(g.s[1]) &&
      (g.turn === 0 || g.turn === 1);
  }

  function loadSession() {
    try {
      var g = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(g) && !g.done) {
        // A pair left face up when the app closed is turned back down.
        g.open.forEach(function (i) { if (g.state[i] === 1) g.state[i] = 0; });
        g.open = [];
        return g;
      }
    } catch (e) {}
    return null;
  }
  function saveSession() {
    try {
      if (!game || game.done) localStorage.removeItem(SESSION_KEY);
      else localStorage.setItem(SESSION_KEY, JSON.stringify(sessionCopy()));
    } catch (e) {}
  }
  function sessionCopy() {
    var c = JSON.parse(JSON.stringify(game));
    c.ms = elapsed();   // fold the running segment in
    return c;
  }

  // ---------- 5. Game engine ----------
  var pendingMiss = null;   // timer that turns a missed pair back down
  var justMatched = [];

  function deal(lv, mode, set) {
    var L = LEVELS[lv], pairs = (L.cols * L.rows) / 2;
    var pool = [];
    for (var i = 0; i < SYMBOL_COUNT; i++) pool.push(i);
    var chosen = shuffle(pool).slice(0, pairs);
    var deck = shuffle(chosen.concat(chosen));
    var st = [], by = [];
    for (var k = 0; k < deck.length; k++) { st.push(0); by.push(-1); }
    return { lv: lv, mode: mode, set: set, deck: deck, state: st, by: by, open: [],
             moves: 0, ms: 0, turn: 0, s: [0, 0], done: false };
  }

  function inProgress() {
    return !!(game && !game.done && (game.moves > 0 || game.open.length > 0));
  }

  // Start a fresh game from prefs. A game in progress is not lost
  // silently: the local Undo toast brings it back (R14: undo > confirm).
  function newGame(announce) {
    var prev = inProgress() ? sessionCopy() : null;
    var prevPrefs = { lv: prefs.lv, mode: prefs.mode, set: prefs.set };
    cancelMiss();
    stopTimer();
    game = deal(prefs.lv, prefs.mode, prefs.set);
    saveSession();
    renderAll(true);
    if (prev) {
      undoToast(t("toast.newgame"), function () {
        cancelMiss();
        stopTimer();
        prefs = prevPrefs;
        savePrefs();
        game = prev;
        saveSession();
        renderAll(true);
      });
    } else if (announce) {
      live(t("toast.newgame"));
    }
  }

  function cancelMiss() {
    if (pendingMiss) { clearTimeout(pendingMiss); pendingMiss = null; }
  }

  // Turn a missed pair back down (on the timer or on the next tap).
  function resolveMiss() {
    cancelMiss();
    if (!game) return;
    game.open.forEach(function (i) { if (game.state[i] === 1) game.state[i] = 0; });
    game.open = [];
    saveSession();
    renderCards();
  }

  function flip(i) {
    if (!game || game.done) return;
    if (game.state[i] === 2) return;                 // matched: no action, visible state
    if (game.open.length === 2) {                    // a missed pair is still showing
      var wasOpen = game.open.indexOf(i) >= 0;
      resolveMiss();
      if (wasOpen) return;                           // tapping it just closes it
    }
    if (game.state[i] === 1) return;                 // the first card of this turn
    startTimer();
    game.state[i] = 1;
    game.open.push(i);
    sfx("flip");

    if (game.open.length === 2) {
      game.moves++;
      var a = game.open[0], b = game.open[1];
      if (game.deck[a] === game.deck[b]) {
        game.state[a] = game.state[b] = 2;
        game.by[a] = game.by[b] = (game.mode === "duo") ? game.turn : 0;
        if (game.mode === "duo") game.s[game.turn]++;
        game.open = [];
        justMatched = [a, b];
        live(t("live.match", { name: symbolName(game.set, game.deck[a]) }));
        if (isWon()) { finish(); return; }
        sfx("match");
      } else {
        sfx("miss");
        if (game.mode === "duo") {
          game.turn = 1 - game.turn;
          live(t("live.miss") + ". " + t("live.turn", { player: t("player." + (game.turn + 1)) }));
        } else {
          live(t("live.miss"));
        }
        pendingMiss = setTimeout(resolveMiss, MISS_DELAY);
      }
    }
    saveSession();
    renderAll(false);
  }

  function isWon() {
    for (var i = 0; i < game.state.length; i++) if (game.state[i] !== 2) return false;
    return true;
  }

  function finish() {
    stopTimer();
    game.done = true;
    var now = Date.now();
    var entry = { id: uid(), ts: now, lv: game.lv, mode: game.mode, set: game.set,
                  moves: game.moves, ms: game.ms };
    var record = false;
    if (game.mode === "duo") {
      entry.s = [game.s[0], game.s[1]];
    } else {
      var cand = { id: entry.id, ts: now, moves: entry.moves, ms: entry.ms };
      var cur = data.best[game.lv];
      record = !cur || better(cand, cur);
      if (record) data.best[game.lv] = cand;
    }
    data.games.unshift(entry);
    data = mergeMemory(data, data);   // canonical order + cap
    save();
    saveSession();
    renderAll(false);
    sfx("win");
    setTimeout(function () { winDialog(entry, record); }, 450);
  }

  // ---------- 6. Timer ----------
  // ms holds the time of finished runs; runStart is set while running.
  // The clock pauses when the app is hidden or closed and resumes on
  // the next flip.
  var runStart = 0;
  var tick = null;

  function elapsed() {
    if (!game) return 0;
    return game.ms + (runStart ? Date.now() - runStart : 0);
  }
  function startTimer() {
    if (runStart || !game || game.done) return;
    runStart = Date.now();
    tick = setInterval(renderClock, 500);
  }
  function stopTimer() {
    if (game && runStart) game.ms += Date.now() - runStart;
    runStart = 0;
    if (tick) { clearInterval(tick); tick = null; }
    renderClock();
  }

  // ---------- 7. Render ----------
  function renderAll(rebuild) {
    renderToolbar();
    renderStatus();
    if (rebuild) buildBoard(); else renderCards();
  }

  function renderToolbar() {
    var lv = game ? game.lv : prefs.lv;
    var mode = game ? game.mode : prefs.mode;
    var set = game ? game.set : prefs.set;
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-level") === lv;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    [].forEach.call(document.querySelectorAll("#mode-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-mode") === mode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    $("set-select").value = set;
    paintSfxBtn();
  }

  function renderStatus() {
    var duo = game && game.mode === "duo";
    $("solo-stats").hidden = !!duo;
    $("duo-stats").hidden = !duo;
    if (duo) {
      $("score0").textContent = String(game.s[0]);
      $("score1").textContent = String(game.s[1]);
      $("p0").classList.toggle("turn", !game.done && game.turn === 0);
      $("p1").classList.toggle("turn", !game.done && game.turn === 1);
    } else {
      $("moves").textContent = String(game ? game.moves : 0);
      var b = data.best[game ? game.lv : prefs.lv];
      $("best").textContent = b ? b.moves + " · " + fmtTime(b.ms) : t("stats.none");
    }
    renderClock();
  }

  function renderClock() {
    var el = $("time");
    if (el) el.textContent = fmtTime(elapsed());
  }

  // Grid shape + card size from the space the board actually has.
  var gridCols = 4;
  function layoutBoard() {
    if (!game) return;
    var wrap = $("board-wrap"), board = $("board");
    var L = LEVELS[game.lv];
    var cs = getComputedStyle(wrap);
    var W = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var H = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (W <= 0 || H <= 0) return;
    var big = Math.max(L.cols, L.rows), small = Math.min(L.cols, L.rows);
    var cols = (H > W) ? small : big;
    var rows = (H > W) ? big : small;
    var gap = Math.max(4, Math.min(10, Math.floor(Math.min(W, H) / 60)));
    var size = Math.floor(Math.min((W - gap * (cols - 1)) / cols, (H - gap * (rows - 1)) / rows));
    size = Math.max(36, Math.min(size, 140));
    board.style.setProperty("--cols", String(cols));
    board.style.setProperty("--card", size + "px");
    board.style.setProperty("--gap", gap + "px");
    gridCols = cols;
  }

  function buildBoard() {
    var board = $("board");
    board.innerHTML = "";
    board.setAttribute("aria-label", t("board.label"));
    if (!game) return;
    if (focusIdx >= game.deck.length) focusIdx = 0;
    for (var i = 0; i < game.deck.length; i++) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "card";
      btn.setAttribute("data-i", String(i));
      btn.tabIndex = (i === focusIdx) ? 0 : -1;
      btn.innerHTML = '<span class="inner"><span class="face back"></span>' +
        '<span class="face front">' + symbolSvg(game.set, game.deck[i]) + '</span></span>';
      board.appendChild(btn);
    }
    layoutBoard();
    renderCards();
  }

  // Update classes in place (Part VII: no rebuild on click).
  function renderCards() {
    if (!game) return;
    var cards = $("board").children;
    var missShowing = game.open.length === 2;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i], st = game.state[i];
      c.classList.toggle("open", st === 1);
      c.classList.toggle("matched", st === 2);
      c.classList.toggle("by1", st === 2 && game.by[i] === 1);
      c.classList.toggle("miss", missShowing && st === 1);
      c.classList.toggle("just", justMatched.indexOf(i) >= 0);
      var name = symbolName(game.set, game.deck[i]);
      c.setAttribute("aria-label", st === 0 ? t("card.down", { n: i + 1 })
        : t(st === 1 ? "card.open" : "card.matched", { name: name }));
      if (st === 2) c.setAttribute("aria-disabled", "true");
      else c.removeAttribute("aria-disabled");
    }
    justMatched = [];
    renderStatus();
  }

  function live(msg) {
    var el = $("live");
    if (!el) return;
    el.textContent = "";
    setTimeout(function () { el.textContent = msg; }, 30);
  }

  // ---------- 8. Dialogs ----------
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

  function winDialog(entry, record) {
    var dlg = makeDialog("mm-win");
    dlg.appendChild(el("div", "dlg-title", t("win.title") + " · " + t("level." + entry.lv)));
    var hero;
    if (entry.mode === "duo") {
      hero = entry.s[0] === entry.s[1] ? t("win.draw")
        : t("win.duo", { player: t("player." + (entry.s[0] > entry.s[1] ? 1 : 2)) });
    } else {
      hero = t("win.solo");
    }
    dlg.appendChild(el("div", "dlg-hero", hero));
    if (record) dlg.appendChild(el("span", "dlg-badge", t("win.record")));
    if (entry.mode === "duo") {
      dlg.appendChild(row(t("player.1"), String(entry.s[0])));
      dlg.appendChild(row(t("player.2"), String(entry.s[1])));
    }
    dlg.appendChild(row(t("stat.moves"), String(entry.moves)));
    dlg.appendChild(row(t("stat.time"), fmtTime(entry.ms)));
    if (entry.mode === "solo") {
      var b = data.best[entry.lv];
      if (b) dlg.appendChild(row(t("stat.best"), t("fmt.best", { moves: b.moves, time: fmtTime(b.ms) })));
    }
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("win.close"), "", function () { dlg.close(); }));
    var again = button(t("win.again"), "primary", function () { dlg.close(); newGame(false); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    again.focus();
  }

  function statsDialog() {
    var dlg = makeDialog("mm-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    var counts = { e: 0, m: 0, h: 0, x: 0 }, duo = 0;
    data.games.forEach(function (g) { if (g.mode === "duo") duo++; else counts[g.lv]++; });
    dlg.appendChild(el("div", "dlg-sub", t("stats.best")));
    LEVEL_ORDER.forEach(function (lv) {
      var b = data.best[lv];
      dlg.appendChild(row(t("level." + lv),
        b ? t("fmt.best", { moves: b.moves, time: fmtTime(b.ms) }) : t("stats.none")));
    });
    dlg.appendChild(el("div", "dlg-sub", t("stats.played", { n: HISTORY_CAP })));
    LEVEL_ORDER.forEach(function (lv) {
      dlg.appendChild(row(t("level." + lv), String(counts[lv])));
    });
    dlg.appendChild(row(t("stats.duo"), String(duo)));
    var acts = el("div", "dlg-actions");
    var reset = button(t("stats.reset"), "danger", function () {
      dlg.close();
      confirmDialog(t("confirm.reset"), resetRecords);
    });
    var empty = data.games.length === 0 && Object.keys(data.best).length === 0;
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
    var dlg = makeDialog("mm-confirm");
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

  // Reset = a stamp. Every device drops games and records at or before
  // it on the next merge; a game finished later on any device survives.
  function resetRecords() {
    data.br = Math.max(Date.now(), data.br + 1);
    data = mergeMemory(data, data);
    save();
    renderStatus();
    showToast(t("toast.reset"));
  }

  // ---------- 9. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "memory", title: String(text) })) return;
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
  // A modal dialog makes the page inert: host the toast inside it.
  function hostToast() {
    var box = $("toast"), d = document.querySelector("dialog[open]");
    if (box && d && box.parentNode !== d) d.appendChild(box);
  }
  function parkToast() {
    var box = $("toast");
    if (box && box.parentNode !== document.body) document.body.appendChild(box);
  }

  // ---------- 10. Sound ----------
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
      if (kind === "flip") tone(660, 0, 0.06, "triangle", 0.12);
      else if (kind === "match") { tone(660, 0, 0.12, "sine"); tone(990, 0.09, 0.18, "sine"); }
      else if (kind === "miss") tone(220, 0, 0.16, "sine", 0.12);
      else if (kind === "win") {
        [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
      }
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Icons for toolbar buttons (R9: injected by JS) ----------
  var UI_ICONS = {
    new:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
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

  // ---------- 11. Keyboard ----------
  var focusIdx = 0;
  function focusCard(i) {
    var cards = $("board").children;
    if (!cards.length) return;
    i = Math.max(0, Math.min(cards.length - 1, i));
    if (cards[focusIdx]) cards[focusIdx].tabIndex = -1;
    focusIdx = i;
    cards[i].tabIndex = 0;
    cards[i].focus();
  }

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;   // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      if (e.code === "KeyN") { e.preventDefault(); newGame(true); return; }
      var onCard = document.activeElement && document.activeElement.classList &&
                   document.activeElement.classList.contains("card");
      var d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -gridCols, ArrowDown: gridCols }[e.key];
      if (d && onCard) {
        e.preventDefault();
        var next = parseInt(document.activeElement.getAttribute("data-i"), 10) + d;
        if (next >= 0 && next < $("board").children.length) focusCard(next);
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

  // ---------- 12. Sync slice + palette ----------
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
    api.registerSlice("memory", sliceGet, sliceSet, STORAGE_KEY, mergeMemory);
  }

  function sliceGet() {
    return mergeMemory(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.games)) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeMemory(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    renderStatus();   // no toast on merge (sync feedback = taskbar dot)
  }

  // ---------- 13. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    $("set-select").setAttribute("aria-label", t("set.label"));
    $("set-select").title = t("set.label");
  }

  function paintStatic() {
    var nb = $("new-btn"), sb = $("stats-btn");
    nb.innerHTML = UI_ICONS.new;
    nb.setAttribute("aria-label", t("btn.new")); nb.title = t("btn.new");
    sb.innerHTML = UI_ICONS.stats;
    sb.setAttribute("aria-label", t("btn.stats")); sb.title = t("btn.stats");
    paintSfxBtn();
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () {
        var lv = b.getAttribute("data-level");
        if (game && lv === game.lv && !game.done) return;   // already showing (visible active state)
        prefs.lv = lv; savePrefs(); newGame(true);
      });
    });
    [].forEach.call(document.querySelectorAll("#mode-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () {
        var m = b.getAttribute("data-mode");
        if (game && m === game.mode && !game.done) return;
        prefs.mode = m; savePrefs(); newGame(true);
      });
    });
    $("set-select").addEventListener("change", function () {
      prefs.set = $("set-select").value; savePrefs(); newGame(true);
      $("set-select").blur();
    });
    $("new-btn").addEventListener("click", function () { newGame(true); $("new-btn").blur(); });
    $("stats-btn").addEventListener("click", statsDialog);
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("match");   // audible confirmation when turned on
    });
    $("board").addEventListener("focusin", function (e) {
      var c = e.target.closest && e.target.closest(".card");
      if (!c || c.tabIndex === 0) return;
      var prev = $("board").children[focusIdx];
      if (prev) prev.tabIndex = -1;
      focusIdx = parseInt(c.getAttribute("data-i"), 10);
      c.tabIndex = 0;
    });
    $("board").addEventListener("click", function (e) {
      var c = e.target.closest && e.target.closest(".card");
      if (!c) return;
      flip(parseInt(c.getAttribute("data-i"), 10));
    });

    // Pause the clock when the app is hidden; keep the session on exit.
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { stopTimer(); saveSession(); }
    });
    window.addEventListener("pagehide", function () { stopTimer(); saveSession(); });

    var relayout = function () { layoutBoard(); };
    if (window.ResizeObserver) new ResizeObserver(relayout).observe($("board-wrap"));
    else window.addEventListener("resize", relayout);

    wireKeyboard();
  }

  function boot() {
    load();
    loadPrefs();
    applyI18n();
    paintStatic();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    game = loadSession();
    if (game) {
      // The resumed game decides what the toolbar shows.
      prefs.lv = game.lv; prefs.mode = game.mode; prefs.set = game.set;
    } else {
      game = deal(prefs.lv, prefs.mode, prefs.set);
    }
    renderAll(true);
  }

  boot();
})();
