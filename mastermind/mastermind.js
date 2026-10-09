// ============================================================
// orOS Mastermind — App logic (v1.0.0)
// Crack the hidden colour code in 10 tries. After each guess the key
// pegs say how close it was: a solid peg for every colour in the right
// place, a hollow peg for every other colour that is in the code but
// elsewhere (repeated colours counted exactly).
//   - levels: Easy 4 pegs of 6 colours, no repeats · Medium 4 of 6,
//     repeats allowed · Hard 5 of 8, repeats allowed
//   - colour-blind friendly: every colour also has its own symbol and
//     number (1–8)
//   - keys 1–8 pick a colour, ←/→ move, Backspace clears, Enter checks,
//     N new game; tap a colour, tap a peg to select or clear it
//   - a game in progress is kept on the device and resumes
// Data:
//   - synced slice "mastermind" (oros-mastermind-data): per level games,
//     wins, best (fewest tries) and the tries of all wins (for the
//     average), as per-device rows (each device only grows its own row;
//     merge = per-row join) + a reset stamp br
//   - device-local (R10): oros-mastermind-prefs (level),
//     oros-mastermind-session (the game in progress),
//     oros-mastermind-device (row id), oros-mastermind-sfx (sound on/off)
// Sections:
//   1. Constants, i18n, helpers
//   2. Code model (generate, score, validity)
//   3. Synced data: load / save / normalize / merge (R5, R26)
//   4. Device-local prefs + session
//   5. Game flow (pick, clear, check, finish, new game)
//   6. Render (toolbar, status, board, palette)
//   7. Dialogs (result, records, help, confirm)
//   8. Toasts
//   9. Sound
//  10. Input (keys, taps, Contract Β)
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-mastermind-data";
  var PREFS_KEY   = "oros-mastermind-prefs";
  var SESSION_KEY = "oros-mastermind-session";
  var DEVICE_KEY  = "oros-mastermind-device";
  var SFX_KEY     = "oros-mastermind-sfx";
  var DATA_VER    = 1;

  var TRIES = 10;
  var LEVELS = ["e", "m", "h"];
  var CONF = {
    e: { pegs: 4, colors: 6, rep: false },
    m: { pegs: 4, colors: 6, rep: true },
    h: { pegs: 5, colors: 8, rep: true }
  };
  // Symbols drawn inside the pegs (24×24), one per colour.
  var SYMBOLS = [
    '<circle cx="12" cy="12" r="5"/>',
    '<path d="M12 6l6 11H6z"/>',
    '<path d="M7 7h10v10H7z"/>',
    '<path d="M12 5l7 7-7 7-7-7z"/>',
    '<path d="M12 5l2.1 4.6 5 .5-3.8 3.3 1.1 4.9L12 15.8l-4.4 2.5 1.1-4.9L4.9 10.1l5-.5z"/>',
    '<path d="M10 6h4v4h4v4h-4v4h-4v-4H6v-4h4z"/>',
    '<path d="M7.8 5.6L12 9.8l4.2-4.2 2.4 2.4-4.2 4.2 4.2 4.2-2.4 2.4-4.2-4.2-4.2 4.2-2.4-2.4 4.2-4.2-4.2-4.2z"/>',
    '<path d="M12 19s-7-4.4-7-9.2A3.8 3.8 0 0 1 12 7.6a3.8 3.8 0 0 1 7 2.2C19 14.6 12 19 12 19z"/>'
  ];

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
      "btn.new": "New game (N)",
      "btn.help": "How to play",
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "btn.del": "Clear", "btn.check": "Check",
      "btn.delLong": "Clear a peg (Backspace)", "btn.checkLong": "Check the guess (Enter)",
      "level.e": "Easy", "level.m": "Medium", "level.h": "Hard",
      "levelSub.e": "4 pegs, 6 colours, no repeats",
      "levelSub.m": "4 pegs, 6 colours, repeats allowed",
      "levelSub.h": "5 pegs, 8 colours, repeats allowed",
      "st.try": "Try", "st.best": "Best",
      "turn.start": "Find {p} pegs of {c} colours",
      "turn.startRep": "Find {p} pegs of {c} colours (repeats allowed)",
      "turn.play": "{n} tries left",
      "turn.won": "Cracked in {n}!",
      "turn.lost": "Not cracked: the code is shown",
      "c1": "red", "c2": "orange", "c3": "yellow", "c4": "green",
      "c5": "blue", "c6": "purple", "c7": "cyan", "c8": "pink",
      "board.label": "Guesses",
      "secret.label": "Secret code",
      "secret.hidden": "Secret code, hidden",
      "row.label": "Guess {n}",
      "row.keys": "{b} right place, {w} right colour only",
      "slot.empty": "Peg {i}: empty",
      "slot.peg": "Peg {i}: {c}",
      "palette.label": "Colours",
      "pick.label": "{n} {c}",
      "live.guess": "Guess {n}: {b} right place, {w} right colour only",
      "live.won": "Cracked in {n}!",
      "live.lost": "Out of tries. The code was {code}",
      "res.won": "Cracked in {n}/10",
      "res.lost": "Not cracked",
      "res.code": "The code",
      "res.wins": "Won",
      "res.best": "Best",
      "res.avg": "Average",
      "res.rec": "New best!",
      "res.again": "Play again",
      "res.close": "Close",
      "stats.title": "Records",
      "stats.head": "Won · best · average tries",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "help.title": "How to play",
      "help.1": "Guess the hidden code: pick a colour for each peg, then Check.",
      "help.2": "A solid key peg: a right colour in the right place.",
      "help.3": "A hollow key peg: a right colour in the wrong place.",
      "help.4": "Key pegs do not say which pegs they mean. Crack the code in 10 tries.",
      "help.keys": "Keys: 1–8 colours · ← → move · Backspace clear · Enter check · N new game",
      "confirm.reset": "Delete the records on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Records reset",
      "toast.newgame": "New game",
      "toast.undo": "Undo",
      "toast.short": "Fill all {p} pegs first",
      "toast.noRep": "Easy: each colour only once",
      "toast.noColor": "This level has colours 1–{c}",
      "toast.empty": "Nothing to clear",
      "toast.over": "This game is over: start a new one (N)",
      "toast.save": "Could not save: storage is full"
    },
    el: {
      "btn.new": "Νέο παιχνίδι (N)",
      "btn.help": "Πώς παίζεται",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "btn.del": "Σβήσιμο", "btn.check": "Έλεγχος",
      "btn.delLong": "Σβήσιμο πιονιού (Backspace)", "btn.checkLong": "Έλεγχος της πρόβλεψης (Enter)",
      "level.e": "Εύκολο", "level.m": "Μέτριο", "level.h": "Δύσκολο",
      "levelSub.e": "4 πιόνια, 6 χρώματα, χωρίς επαναλήψεις",
      "levelSub.m": "4 πιόνια, 6 χρώματα, με επαναλήψεις",
      "levelSub.h": "5 πιόνια, 8 χρώματα, με επαναλήψεις",
      "st.try": "Γύρος", "st.best": "Ρεκόρ",
      "turn.start": "Βρες {p} πιόνια από {c} χρώματα",
      "turn.startRep": "Βρες {p} πιόνια από {c} χρώματα (με επαναλήψεις)",
      "turn.play": "Απομένουν {n} προσπάθειες",
      "turn.won": "Τον έσπασες σε {n}!",
      "turn.lost": "Δεν βρέθηκε: ο κωδικός φαίνεται",
      "c1": "κόκκινο", "c2": "πορτοκαλί", "c3": "κίτρινο", "c4": "πράσινο",
      "c5": "μπλε", "c6": "μωβ", "c7": "γαλάζιο", "c8": "ροζ",
      "board.label": "Προσπάθειες",
      "secret.label": "Μυστικός κωδικός",
      "secret.hidden": "Μυστικός κωδικός, κρυφός",
      "row.label": "Προσπάθεια {n}",
      "row.keys": "{b} στη σωστή θέση, {w} μόνο σωστό χρώμα",
      "slot.empty": "Πιόνι {i}: κενό",
      "slot.peg": "Πιόνι {i}: {c}",
      "palette.label": "Χρώματα",
      "pick.label": "{n} {c}",
      "live.guess": "Προσπάθεια {n}: {b} στη σωστή θέση, {w} μόνο σωστό χρώμα",
      "live.won": "Τον έσπασες σε {n}!",
      "live.lost": "Τέλος προσπαθειών. Ο κωδικός ήταν {code}",
      "res.won": "Τον έσπασες σε {n}/10",
      "res.lost": "Δεν βρέθηκε",
      "res.code": "Ο κωδικός",
      "res.wins": "Νίκες",
      "res.best": "Ρεκόρ",
      "res.avg": "Μέσος όρος",
      "res.rec": "Νέο ρεκόρ!",
      "res.again": "Ξανά",
      "res.close": "Κλείσιμο",
      "stats.title": "Ρεκόρ",
      "stats.head": "Νίκες · ρεκόρ · μέσος όρος προσπαθειών",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "help.title": "Πώς παίζεται",
      "help.1": "Μάντεψε τον κρυφό κωδικό: διάλεξε χρώμα για κάθε πιόνι και πάτα Έλεγχος.",
      "help.2": "Γεμάτο σημάδι: σωστό χρώμα στη σωστή θέση.",
      "help.3": "Άδειο σημάδι: σωστό χρώμα σε λάθος θέση.",
      "help.4": "Τα σημάδια δεν λένε ποιο πιόνι εννοούν. Σπάσε τον κωδικό σε 10 προσπάθειες.",
      "help.keys": "Πλήκτρα: 1–8 χρώματα · ← → μετακίνηση · Backspace σβήσιμο · Enter έλεγχος · N νέο παιχνίδι",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.newgame": "Νέο παιχνίδι",
      "toast.undo": "Αναίρεση",
      "toast.short": "Γέμισε πρώτα και τα {p} πιόνια",
      "toast.noRep": "Εύκολο: κάθε χρώμα μόνο μία φορά",
      "toast.noColor": "Σε αυτό το επίπεδο τα χρώματα είναι 1–{c}",
      "toast.empty": "Δεν υπάρχει κάτι για σβήσιμο",
      "toast.over": "Το παιχνίδι τελείωσε: ξεκίνα νέο (N)",
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

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("mastermind.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Code model ----------
  // A secret code for a level: colours 0…colors-1; on Easy all different.
  function makeCode(level, rnd) {
    var c = CONF[level], out = [], pool = [];
    for (var k = 0; k < c.colors; k++) pool.push(k);
    for (var i = 0; i < c.pegs; i++) {
      if (c.rep) out.push(rnd(c.colors));
      else out.push(pool.splice(rnd(pool.length), 1)[0]);
    }
    return out;
  }

  // Key pegs: b = right colour in the right place, w = right colour
  // elsewhere; repeated colours are counted exactly.
  function score(guess, code) {
    var b = 0, common = 0, cg = {}, cc = {}, i;
    for (i = 0; i < code.length; i++) {
      if (guess[i] === code[i]) b++;
      cg[guess[i]] = (cg[guess[i]] || 0) + 1;
      cc[code[i]] = (cc[code[i]] || 0) + 1;
    }
    Object.keys(cg).forEach(function (k) { if (cc[k]) common += Math.min(cg[k], cc[k]); });
    return { b: b, w: common - b };
  }

  // A complete, legal row for the level (right length, colours in range,
  // no repeats on Easy).
  function validRow(row, level) {
    var c = CONF[level], seen = {};
    if (!Array.isArray(row) || row.length !== c.pegs) return false;
    for (var i = 0; i < row.length; i++) {
      if (!isInt(row[i]) || row[i] < 0 || row[i] >= c.colors) return false;
      if (!c.rep && seen[row[i]]) return false;
      seen[row[i]] = true;
    }
    return true;
  }

  // ---------- 3. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                       // max-merged
  //   rows: { <deviceId>: { b: <epoch>,
  //                         s: { e|m|h: { g: games, w: wins, bt: best tries (0 = none),
  //                                       st: tries of all wins summed } } } }
  // }
  // Each device only ever writes ITS OWN row; a row counts from epoch b.
  // Merge per row: the newer epoch wins; equal epochs take, per level,
  // the max of g, w, st and the smallest bt above 0. A join (symmetric,
  // associative, idempotent). Rows older than br drop.
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normCell(c) {
    if (!c || typeof c !== "object" || !isInt(c.g) || !isInt(c.w) || !isInt(c.bt) || !isInt(c.st) ||
        c.g < 1 || c.w < 0 || c.w > c.g || c.st < c.w || c.st > TRIES * c.w ||
        (c.w === 0 ? c.bt !== 0 : (c.bt < 1 || c.bt > TRIES))) return null;
    return { g: c.g, w: c.w, bt: c.bt, st: c.st };
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
    var bt = !a.bt ? c.bt : (!c.bt ? a.bt : Math.min(a.bt, c.bt));
    var w = Math.max(a.w, c.w);
    return { g: Math.max(a.g, c.g), w: w, bt: bt, st: Math.max(a.st, c.st) };
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

  function mergeMastermind(A, B) {
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

  // Games, wins, best and average tries for a level across every device.
  function totals(d, level) {
    var out = { g: 0, w: 0, bt: 0, st: 0, avg: 0 };
    Object.keys(d.rows).forEach(function (id) {
      var c = d.rows[id].s[level];
      if (!c) return;
      out.g += c.g; out.w += c.w; out.st += c.st;
      if (c.bt && (!out.bt || c.bt < out.bt)) out.bt = c.bt;
    });
    out.avg = out.w ? out.st / out.w : 0;
    return out;
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.rows && typeof parsed.rows === "object") {
          data = mergeMastermind(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] mastermind: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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

  // Counts a finished game (tries = 0 when lost); true for a new best.
  function countGame(level, tries) {
    var before = totals(data, level);
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // new epoch after a reset
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    var c = row.s[level] || { g: 0, w: 0, bt: 0, st: 0 };
    c = { g: c.g + 1, w: c.w + (tries ? 1 : 0), bt: c.bt, st: c.st + tries };
    if (tries && (!c.bt || tries < c.bt)) c.bt = tries;
    row.s[level] = c;
    data.rows[deviceId] = row;
    data = mergeMastermind(data, data);
    save();
    return !!tries && (!before.bt || tries < before.bt);
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

  // game = { level, code: [..], rows: [[..]], cur: [colour | -1], sel, done, rec }
  var game = null;

  function validSession(g) {
    if (!g || typeof g !== "object" || LEVELS.indexOf(g.level) < 0 || !validRow(g.code, g.level) ||
        !Array.isArray(g.rows) || g.rows.length > TRIES || !Array.isArray(g.cur) ||
        g.cur.length !== CONF[g.level].pegs || !isInt(g.sel) || g.sel < 0 || g.sel >= g.cur.length ||
        typeof g.done !== "boolean" || typeof g.rec !== "boolean") return false;
    for (var i = 0; i < g.rows.length; i++) if (!validRow(g.rows[i], g.level)) return false;
    for (var j = 0; j < g.cur.length; j++) {
      if (!isInt(g.cur[j]) || g.cur[j] < -1 || g.cur[j] >= CONF[g.level].colors) return false;
    }
    return g.done === !!finished(g);
  }
  function loadSession() {
    try {
      var g = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(g)) return g;
    } catch (e) {}
    return null;
  }
  function saveSession() {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(game)); } catch (e) {}
  }

  // ---------- 5. Game flow ----------
  function emptyRow(n) { var r = []; for (var i = 0; i < n; i++) r.push(-1); return r; }
  function fresh(level) {
    return { level: level, code: makeCode(level, randInt), rows: [], cur: emptyRow(CONF[level].pegs),
             sel: 0, done: false, rec: false };
  }
  // "w" won, "l" lost, "" playing.
  function finished(g) {
    var n = g.rows.length;
    if (n && score(g.rows[n - 1], g.code).b === g.code.length) return "w";
    return n >= TRIES ? "l" : "";
  }
  function inProgress() {
    if (!game || game.done) return false;
    return game.rows.length > 0 || game.cur.some(function (v) { return v >= 0; });
  }

  // Can the player act now? (R28: say why not)
  function gate() {
    if (!game || document.querySelector("dialog[open]")) return false;
    if (game.done) { showToast(t("toast.over")); return false; }
    return true;
  }

  function pick(color) {
    if (!gate()) return;
    var c = CONF[game.level];
    if (color < 0 || color >= c.colors) { showToast(t("toast.noColor", { c: c.colors })); return; }
    var at = game.cur.indexOf(color);
    if (!c.rep && at >= 0 && at !== game.sel) {
      showToast(t("toast.noRep"));
      shake(slotNode(at));
      return;
    }
    game.cur[game.sel] = color;
    // next empty slot after this one (wrapping), else stay
    for (var k = 1; k <= game.cur.length; k++) {
      var i = (game.sel + k) % game.cur.length;
      if (game.cur[i] < 0) { game.sel = i; break; }
    }
    saveSession();
    sfx("key");
    renderBoard();
    renderPalette();
  }

  function clearPeg() {
    if (!gate()) return;
    if (game.cur[game.sel] < 0 && game.sel > 0 && game.cur[game.sel - 1] >= 0) game.sel--;
    if (game.cur[game.sel] < 0) {
      var last = -1;
      for (var i = 0; i < game.cur.length; i++) if (game.cur[i] >= 0) last = i;
      if (last < 0) { showToast(t("toast.empty")); return; }
      game.sel = last;
    }
    game.cur[game.sel] = -1;
    saveSession();
    renderBoard();
    renderPalette();
  }

  function select(i) {
    if (!gate()) return;
    if (i === game.sel && game.cur[i] >= 0) game.cur[i] = -1;    // tap again: clear
    game.sel = i;
    saveSession();
    renderBoard();
    renderPalette();
  }
  function moveSel(d) {
    if (!gate()) return;
    game.sel = (game.sel + d + game.cur.length) % game.cur.length;
    saveSession();
    renderBoard();
  }

  var finishTimer = null;

  function check() {
    if (!gate()) return;
    var n = game.rows.length;
    if (game.cur.indexOf(-1) >= 0) {
      showToast(t("toast.short", { p: game.cur.length }));
      shake(rowNode(n));
      return;
    }
    var row = game.cur.slice(), sc = score(row, game.code);
    game.rows.push(row);
    game.cur = emptyRow(row.length);
    game.sel = 0;
    var end = finished(game);
    if (end) {
      game.done = true;
      game.rec = countGame(game.level, end === "w" ? game.rows.length : 0);
    }
    saveSession();
    renderAll();
    live(t("live.guess", { n: n + 1, b: sc.b, w: sc.w }));
    if (end) {
      sfx(end === "w" ? "win" : "lose");
      var g = game;
      setTimeout(function () {
        live(end === "w" ? t("live.won", { n: g.rows.length }) : t("live.lost", { code: codeText(g.code) }));
      }, 500);
      clearTimeout(finishTimer);
      finishTimer = setTimeout(function () { if (game === g) resultDialog(); }, 900);
    } else {
      sfx(sc.b || sc.w ? "hit" : "miss");
    }
  }

  function codeText(code) {
    return code.map(function (c) { return (c + 1) + " " + t("c" + (c + 1)); }).join(", ");
  }

  // A game in progress is never lost silently: Undo toast (R14).
  function newGame(level) {
    closeDialogs();
    clearTimeout(finishTimer);
    var prev = inProgress() ? JSON.parse(JSON.stringify(game)) : null;
    var prevLevel = prefs.level;
    if (level) { prefs.level = level; savePrefs(); }
    game = fresh(prefs.level);
    saveSession();
    renderAll(true);
    if (prev) {
      undoToast(t("toast.newgame"), function () {
        prefs.level = prevLevel; savePrefs();
        game = prev;
        saveSession();
        renderAll(true);
      });
    } else {
      live(t("toast.newgame"));
    }
  }

  function setLevel(level) {
    if (game && level === game.level) return;
    newGame(level);
  }

  // ---------- 6. Render ----------
  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function renderAll(rebuild) {
    renderToolbar();
    renderStatus();
    renderBoard(rebuild);
    renderPalette(rebuild);
  }

  function renderToolbar() {
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      var lv = b.getAttribute("data-level"), on = !!game && lv === game.level;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.title = t("levelSub." + lv);
    });
    paintSfxBtn();
  }

  function renderStatus() {
    var c = CONF[game.level], n = game.rows.length, end = finished(game);
    $("tries").textContent = Math.min(n + (end ? 0 : 1), TRIES) + "/" + TRIES;
    var s = totals(data, game.level);
    $("best").textContent = s.bt ? String(s.bt) : "–";
    var msg, cls = "";
    if (end === "w") { msg = t("turn.won", { n: n }); cls = "done"; }
    else if (end === "l") { msg = t("turn.lost"); cls = "warn"; }
    else if (!n) msg = t(c.rep ? "turn.startRep" : "turn.start", { p: c.pegs, c: c.colors });
    else msg = t("turn.play", { n: TRIES - n });
    $("turn").textContent = msg;
    $("turn").className = cls;
  }

  function pegHtml(color) {
    if (color < 0) return "";
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + SYMBOLS[color] + "</svg>";
  }
  function setPeg(node, color) {
    if (node.getAttribute("data-c") === String(color)) return;
    node.setAttribute("data-c", String(color));
    node.className = node.className.replace(/\s*\bc\d\b/g, "") + (color >= 0 ? " c" + (color + 1) : "");
    node.innerHTML = pegHtml(color);
  }

  function buildBoard() {
    var b = $("board"), c = CONF[game.level];
    b.innerHTML = "";
    b.style.setProperty("--p", String(c.pegs));
    b.setAttribute("aria-label", t("board.label"));
    var secret = el("div", "mrow secret");
    secret.appendChild(el("span", "mnum", ""));
    var sp = el("div", "pegs");
    for (var i = 0; i < c.pegs; i++) sp.appendChild(el("span", "peg"));
    secret.appendChild(sp);
    secret.appendChild(el("span", "keys"));
    b.appendChild(secret);
    for (var r = 0; r < TRIES; r++) {
      var row = el("div", "mrow");
      row.setAttribute("role", "group");
      row.appendChild(el("span", "mnum", String(r + 1)));
      var pegs = el("div", "pegs");
      for (var k = 0; k < c.pegs; k++) {
        var p = el("button", "peg");
        p.type = "button";
        p.tabIndex = -1;
        p.setAttribute("data-i", String(k));
        pegs.appendChild(p);
      }
      row.appendChild(pegs);
      var keys = el("span", "keys");
      for (var j = 0; j < c.pegs; j++) keys.appendChild(el("i", "kp"));
      row.appendChild(keys);
      b.appendChild(row);
    }
    b.setAttribute("data-level", game.level);
  }

  function rowNode(r) { return $("board").children[r + 1] || null; }
  function slotNode(i) {
    var row = rowNode(game.rows.length);
    return row ? row.querySelectorAll(".peg")[i] : null;
  }

  function renderBoard(rebuild) {
    var b = $("board");
    if (rebuild || b.getAttribute("data-level") !== game.level || !b.children.length) buildBoard();
    var end = finished(game), n = game.rows.length;
    // secret row
    var secret = b.children[0], sp = secret.querySelectorAll(".peg");
    secret.classList.toggle("open", !!end);
    secret.setAttribute("aria-label", end ? t("secret.label") + ": " + codeText(game.code) : t("secret.hidden"));
    for (var s = 0; s < sp.length; s++) {
      if (end) { sp[s].className = "peg c" + (game.code[s] + 1); sp[s].innerHTML = pegHtml(game.code[s]); }
      else { sp[s].className = "peg hidden"; sp[s].textContent = "?"; }
    }
    for (var r = 0; r < TRIES; r++) {
      var row = b.children[r + 1], pegs = row.querySelectorAll(".peg"), kps = row.querySelectorAll(".kp");
      var vals = r < n ? game.rows[r] : (r === n && !end ? game.cur : null);
      var cur = r === n && !end;
      row.classList.toggle("cur", cur);
      row.classList.toggle("past", r < n);
      for (var i = 0; i < pegs.length; i++) {
        setPeg(pegs[i], vals ? vals[i] : -1);
        pegs[i].classList.toggle("sel", cur && i === game.sel);
        pegs[i].disabled = !cur;
        pegs[i].setAttribute("aria-label", vals && vals[i] >= 0
          ? t("slot.peg", { i: i + 1, c: t("c" + (vals[i] + 1)) }) : t("slot.empty", { i: i + 1 }));
      }
      var sc = r < n ? score(game.rows[r], game.code) : null;
      for (var k = 0; k < kps.length; k++) {
        kps[k].className = "kp" + (sc ? (k < sc.b ? " b" : (k < sc.b + sc.w ? " w" : "")) : "");
      }
      var label = t("row.label", { n: r + 1 });
      if (sc) label += ": " + codeText(game.rows[r]) + "; " + t("row.keys", { b: sc.b, w: sc.w });
      row.setAttribute("aria-label", label);
    }
  }

  function renderPalette(rebuild) {
    var pal = $("palette"), c = CONF[game.level];
    if (rebuild || pal.children.length !== c.colors) {
      pal.innerHTML = "";
      pal.setAttribute("aria-label", t("palette.label"));
      for (var k = 0; k < c.colors; k++) {
        var b = el("button", "pick");
        b.type = "button";
        b.setAttribute("data-c", String(k));
        var dot = el("span", "peg c" + (k + 1));
        dot.innerHTML = pegHtml(k);
        b.appendChild(dot);
        b.appendChild(el("span", "pnum", String(k + 1)));
        b.setAttribute("aria-label", t("pick.label", { n: k + 1, c: t("c" + (k + 1)) }));
        b.title = (k + 1) + " · " + t("c" + (k + 1));
        pal.appendChild(b);
      }
    }
    var end = !!finished(game);
    [].forEach.call(pal.children, function (b) {
      var k = +b.getAttribute("data-c");
      var used = !c.rep && game.cur.indexOf(k) >= 0 && game.cur[game.sel] !== k;
      b.classList.toggle("used", used || end);
      b.setAttribute("aria-disabled", used || end ? "true" : "false");
    });
    $("del-btn").setAttribute("aria-disabled", end ? "true" : "false");
    $("check-btn").setAttribute("aria-disabled", end || game.cur.indexOf(-1) >= 0 ? "true" : "false");
  }

  function shake(node) {
    if (!node || reduced) return;
    node.classList.remove("shake");
    void node.offsetWidth;
    node.classList.add("shake");
    setTimeout(function () { node.classList.remove("shake"); }, 400);
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
  function fmtAvg(v) {
    if (!v) return "–";
    var s = (Math.round(v * 10) / 10).toFixed(1);
    return LANG === "el" ? s.replace(".", ",") : s;
  }

  function resultDialog() {
    if (!game || !game.done) return;
    closeDialogs();
    var won = finished(game) === "w", s = totals(data, game.level);
    var dlg = makeDialog("mastermind-result");
    dlg.appendChild(el("div", "dlg-title", t("level." + game.level)));
    dlg.appendChild(el("div", "dlg-hero" + (won ? "" : " lost"), won ? t("res.won", { n: game.rows.length }) : t("res.lost")));
    if (won && game.rec) dlg.appendChild(el("div", "dlg-badge", t("res.rec")));
    dlg.appendChild(el("div", "dlg-sub", t("res.code")));
    var code = el("div", "pegs res-code");
    code.setAttribute("aria-label", codeText(game.code));
    game.code.forEach(function (c) { var p = el("span", "peg c" + (c + 1)); p.innerHTML = pegHtml(c); code.appendChild(p); });
    dlg.appendChild(code);
    dlg.appendChild(row(t("res.wins"), s.w + "/" + s.g));
    dlg.appendChild(row(t("res.best"), s.bt ? String(s.bt) : "–"));
    dlg.appendChild(row(t("res.avg"), fmtAvg(s.avg)));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("res.close"), "", function () { dlg.close(); }));
    var again = button(t("res.again"), "primary", function () { dlg.close(); newGame(); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    again.focus();
  }

  function statsDialog() {
    var dlg = makeDialog("mastermind-stats"), empty = true;
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    LEVELS.forEach(function (lv) {
      var s = totals(data, lv);
      if (s.g) empty = false;
      dlg.appendChild(row(t("level." + lv),
        s.g ? s.w + "/" + s.g + " · " + (s.bt || "–") + " · " + fmtAvg(s.avg) : "–"));
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

  function helpDialog() {
    var dlg = makeDialog("mastermind-help");
    dlg.appendChild(el("div", "dlg-title", t("help.title")));
    dlg.appendChild(el("p", "dlg-msg", t("help.1")));
    [["b", "help.2"], ["w", "help.3"]].forEach(function (x) {
      var p = el("p", "dlg-msg help-key");
      p.appendChild(el("i", "kp " + x[0]));
      p.appendChild(el("span", "", t(x[1])));
      dlg.appendChild(p);
    });
    dlg.appendChild(el("p", "dlg-msg", t("help.4")));
    LEVELS.forEach(function (lv) { dlg.appendChild(row(t("level." + lv), t("levelSub." + lv))); });
    dlg.appendChild(el("p", "dlg-msg help-keys", t("help.keys")));
    var acts = el("div", "dlg-actions");
    var close = button(t("res.close"), "primary", function () { dlg.close(); });
    acts.appendChild(close);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    close.focus();
  }

  function confirmDialog(msg, onYes) {
    var dlg = makeDialog("mastermind-confirm");
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
    data = mergeMastermind(data, data);
    save();
    renderStatus();
    showToast(t("toast.reset"));
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "mastermind", title: String(text) })) return;
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
        tone(660, 0, 0.08, "triangle", 0.12); tone(880, 0.08, 0.08, "triangle", 0.1);
      } else if (kind === "miss") {
        tone(260, 0, 0.12, "sine", 0.14);
      } else tone(620, 0, 0.05, "triangle", 0.1);
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Toolbar icons (R9: injected by JS) ----------
  var UI_ICONS = {
    new:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    help:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>',
    stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    back:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H9l-6 7 6 7h12z"/><path d="M17 9l-5 6M12 9l5 6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
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
  // Digit keys by position (Digit1…8 / Numpad1…8), any layout.
  function colorForKey(e) {
    var m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code || "") || /^([1-9])$/.exec(e.key || "");
    return m ? +m[1] - 1 : -1;
  }

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;   // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      var c = colorForKey(e);
      if (c >= 0) { e.preventDefault(); if (!e.repeat) pick(c); return; }
      if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); clearPeg(); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); moveSel(-1); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); moveSel(1); return; }
      if (e.key === "Enter") {
        var a = document.activeElement;
        if (a && a.tagName === "BUTTON" && !a.classList.contains("pick") && !a.classList.contains("peg")) return;
        e.preventDefault(); if (!e.repeat) check(); return;
      }
      if (e.repeat) return;
      if (e.code === "KeyN") { e.preventDefault(); newGame(); }
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

  function wireTaps() {
    $("palette").addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".pick");
      if (b) { pick(+b.getAttribute("data-c")); b.blur(); }
    });
    $("board").addEventListener("click", function (e) {
      var p = e.target.closest && e.target.closest(".peg[data-i]");
      if (!p || p.disabled) return;
      var row = p.closest(".mrow");
      if (row && row.classList.contains("cur")) select(+p.getAttribute("data-i"));
    });
    $("del-btn").addEventListener("click", function () { clearPeg(); $("del-btn").blur(); });
    $("check-btn").addEventListener("click", function () { check(); $("check-btn").blur(); });
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
    api.registerSlice("mastermind", sliceGet, sliceSet, STORAGE_KEY, mergeMastermind);
  }

  function sliceGet() {
    return mergeMastermind(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeMastermind(incoming, incoming);
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
  }

  function paintStatic() {
    [["help-btn", "help", "btn.help"], ["new-btn", "new", "btn.new"],
     ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    [["del-btn", "back", "btn.del", "btn.delLong"], ["check-btn", "check", "btn.check", "btn.checkLong"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]] + "<span>" + t(x[2]) + "</span>";
      b.setAttribute("aria-label", t(x[3]));
      b.title = t(x[3]);
    });
    paintSfxBtn();
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () { setLevel(b.getAttribute("data-level")); b.blur(); });
    });
    $("new-btn").addEventListener("click", function () { newGame(); $("new-btn").blur(); });
    // blurred first, so a closed dialog does not hand Enter back to them
    $("help-btn").addEventListener("click", function () { $("help-btn").blur(); helpDialog(); });
    $("stats-btn").addEventListener("click", function () { $("stats-btn").blur(); statsDialog(); });
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("key");   // audible confirmation when turned on
    });
    wireTaps();
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
    game = loadSession() || fresh(prefs.level);
    if (prefs.level !== game.level) { prefs.level = game.level; savePrefs(); }
    saveSession();
    renderAll(true);
  }

  boot();
})();
