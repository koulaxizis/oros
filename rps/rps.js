// ============================================================
// orOS Rock Paper Scissors — App logic (v1.0.0)
// Rock beats scissors, scissors beat paper, paper beats rock.
//   - vs the computer, 3 levels: Easy (random) · Medium (counters the
//     move you play most) · Hard (a pattern reader: frequency, order-1
//     and order-2 chains on your moves and a chain on the last round,
//     each scored on the recent rounds; it follows the one that has
//     been right most often)
//   - matches: first to 3 / first to 5 / endless
//   - the computer picks from the past rounds only, before your move
//   - keys: R P S (EN) or Π Χ Ψ (EL) and 1 2 3; N new match
// Data:
//   - synced slice "rps" (oros-rps-data): per level matches won / lost,
//     rounds won / drawn / lost and the best win streak, as per-device
//     rows (each device only grows its own row; merge = per-row join) +
//     a reset stamp br
//   - device-local (R10): oros-rps-prefs (level, format),
//     oros-rps-session (the match in progress, the current streak and
//     your last 200 rounds for the predictors), oros-rps-device (row id),
//     oros-rps-sfx (sound on/off)
// Sections:
//   1. Constants, i18n, helpers
//   2. Rules + computer player (outcome, predictors)
//   3. Synced data: load / save / normalize / merge (R5, R26)
//   4. Device-local prefs + session
//   5. Game flow (new match, play a round, reveal, finish)
//   6. Render (toolbar, status, hands, picks)
//   7. Dialogs (result, records, confirm)
//   8. Toasts
//   9. Sound
//  10. Keyboard (R P S / Π Χ Ψ / 1 2 3, N, Contract Β)
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-rps-data";
  var PREFS_KEY   = "oros-rps-prefs";
  var SESSION_KEY = "oros-rps-session";
  var DEVICE_KEY  = "oros-rps-device";
  var SFX_KEY     = "oros-rps-sfx";
  var DATA_VER    = 1;

  var LEVELS = ["e", "m", "h"];
  var FORMATS = [3, 5, 0];                   // 0 = endless
  var HIST_MAX = 200;                        // rounds kept for the predictors
  var MAX_COUNT = 100000000;
  var REVEAL_MS = 650;
  // Keys per language, by physical position (e.code): R P S on an
  // English layout, Π Χ Ψ on a Greek one; 1 2 3 everywhere.
  var KEYS = {
    en: { KeyR: 0, KeyP: 1, KeyS: 2 },
    el: { KeyP: 0, KeyX: 1, KeyC: 2 }
  };

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
      "fmt.3": "First to 3", "fmt.5": "First to 5", "fmt.0": "Endless",
      "name.you": "You", "name.cpu": "Computer", "vs": "vs",
      "move.0": "Rock", "move.1": "Paper", "move.2": "Scissors",
      "key.0": "R", "key.1": "P", "key.2": "S",
      "pick.label": "{move} (key {k} or {n})",
      "picks.label": "Your move",
      "st.round": "Round {n}", "st.streak": "streak {n}",
      "st.to": "first to {n}", "st.endless": "endless",
      "verdict.start": "Pick rock, paper or scissors",
      "verdict.wait": "Rock… paper… scissors…",
      "verdict.win": "You win the round!",
      "verdict.lose": "The computer wins the round",
      "verdict.draw": "Draw",
      "verdict.match": "Match over: pick to play again",
      "live.round": "You: {you}. Computer: {cpu}. {res} Score {a} to {b}.",
      "hand.you": "Your move: {m}", "hand.cpu": "Computer's move: {m}", "hand.none": "none yet",
      "btn.new": "New match (N)",
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "res.title": "Match over",
      "res.youwin": "You win the match!",
      "res.ailose": "The computer wins the match",
      "res.score": "Score",
      "res.rounds": "Rounds played",
      "res.matches": "Matches won · lost",
      "res.best": "Best win streak",
      "res.again": "Play again",
      "res.close": "Close",
      "stats.title": "Records",
      "stats.matches": "Matches won · lost",
      "stats.rounds": "Rounds won · drawn · lost",
      "stats.best": "Best win streak",
      "stats.note": "A win streak counts rounds won in a row; a draw does not break it.",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "confirm.reset": "Delete the records on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Records reset",
      "toast.newgame": "New match started",
      "toast.undo": "Undo",
      "toast.save": "Could not save: storage is full",
      "toast.fresh": "Nothing to restart: the match has not begun"
    },
    el: {
      "level.e": "Εύκολο", "level.m": "Μεσαίο", "level.h": "Δύσκολο",
      "fmt.3": "Όποιος φτάσει 3", "fmt.5": "Όποιος φτάσει 5", "fmt.0": "Χωρίς τέλος",
      "name.you": "Εσύ", "name.cpu": "Υπολογιστής", "vs": "εναντίον",
      "move.0": "Πέτρα", "move.1": "Χαρτί", "move.2": "Ψαλίδι",
      "key.0": "Π", "key.1": "Χ", "key.2": "Ψ",
      "pick.label": "{move} (πλήκτρο {k} ή {n})",
      "picks.label": "Η κίνησή σου",
      "st.round": "Γύρος {n}", "st.streak": "σερί {n}",
      "st.to": "μέχρι το {n}", "st.endless": "χωρίς τέλος",
      "verdict.start": "Διάλεξε πέτρα, ψαλίδι ή χαρτί",
      "verdict.wait": "Πέτρα… ψαλίδι… χαρτί…",
      "verdict.win": "Κέρδισες τον γύρο!",
      "verdict.lose": "Ο υπολογιστής κέρδισε τον γύρο",
      "verdict.draw": "Ισοπαλία",
      "verdict.match": "Ο αγώνας τελείωσε: διάλεξε για νέο",
      "live.round": "Εσύ: {you}. Υπολογιστής: {cpu}. {res} Σκορ {a} – {b}.",
      "hand.you": "Η κίνησή σου: {m}", "hand.cpu": "Η κίνηση του υπολογιστή: {m}", "hand.none": "καμία ακόμα",
      "btn.new": "Νέος αγώνας (N)",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "res.title": "Τέλος αγώνα",
      "res.youwin": "Κέρδισες τον αγώνα!",
      "res.ailose": "Ο υπολογιστής κέρδισε τον αγώνα",
      "res.score": "Σκορ",
      "res.rounds": "Γύροι",
      "res.matches": "Αγώνες: νίκες · ήττες",
      "res.best": "Καλύτερο σερί νικών",
      "res.again": "Ξανά",
      "res.close": "Κλείσιμο",
      "stats.title": "Ρεκόρ",
      "stats.matches": "Αγώνες: νίκες · ήττες",
      "stats.rounds": "Γύροι: νίκες · ισοπαλίες · ήττες",
      "stats.best": "Καλύτερο σερί νικών",
      "stats.note": "Το σερί μετρά γύρους που κέρδισες στη σειρά· η ισοπαλία δεν το διακόπτει.",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.newgame": "Ξεκίνησε νέος αγώνας",
      "toast.undo": "Αναίρεση",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "toast.fresh": "Ο αγώνας δεν έχει αρχίσει ακόμα"
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

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("rps.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Rules + computer player ----------
  // Moves: 0 rock, 1 paper, 2 scissors. Each beats the one before it
  // (paper > rock, scissors > paper, rock > scissors).

  // 0 draw, 1 a wins, 2 b wins
  function outcome(a, b) {
    return (a - b + 3) % 3;
  }

  // The move that beats m.
  function counter(m) {
    return (m + 1) % 3;
  }

  // Your most played moves in hist ([[you, cpu]…]); all of them on a tie.
  function topMoves(hist, n) {
    var c = [0, 0, 0], from = Math.max(0, hist.length - n);
    for (var i = from; i < hist.length; i++) c[hist[i][0]]++;
    var top = Math.max(c[0], c[1], c[2]), out = [];
    if (!top) return out;
    for (var k = 0; k < 3; k++) if (c[k] === top) out.push(k);
    return out;
  }

  // What you played after the same k moves of yours, over the last
  // `span` rounds; -1 when unknown or tied (the latest one wins a tie
  // of the leaders only when it is among them).
  function chainPredict(hist, k, span) {
    var L = hist.length;
    if (L <= k) return -1;
    var c = [0, 0, 0], latest = -1, from = Math.max(k, L - span);
    for (var i = from; i < L; i++) {
      var same = true;
      for (var j = 1; j <= k; j++) {
        if (hist[i - j][0] !== hist[L - j][0]) { same = false; break; }
      }
      if (same) { c[hist[i][0]]++; latest = hist[i][0]; }
    }
    var top = Math.max(c[0], c[1], c[2]);
    if (!top) return -1;
    var n = (c[0] === top) + (c[1] === top) + (c[2] === top);
    return n === 1 ? c.indexOf(top) : (c[latest] === top ? latest : -1);
  }

  // What you played after a round like the last one (your move and the
  // computer's): catches "stay after a win, switch after a loss".
  function roundPredict(hist, span) {
    var L = hist.length;
    if (L < 2) return -1;
    var c = [0, 0, 0], latest = -1, from = Math.max(1, L - span);
    var y = hist[L - 1][0], z = hist[L - 1][1];
    for (var i = from; i < L; i++) {
      if (hist[i - 1][0] === y && hist[i - 1][1] === z) { c[hist[i][0]]++; latest = hist[i][0]; }
    }
    var top = Math.max(c[0], c[1], c[2]);
    if (!top) return -1;
    var n = (c[0] === top) + (c[1] === top) + (c[2] === top);
    return n === 1 ? c.indexOf(top) : (c[latest] === top ? latest : -1);
  }

  // One guess of your next move per predictor (-1: no idea).
  function guesses(hist) {
    var f = topMoves(hist, 20);
    return [
      f.length === 1 ? f[0] : -1,          // what you play most
      chainPredict(hist, 1, 100),          // after your last move
      chainPredict(hist, 2, 100),          // after your last two moves
      roundPredict(hist, 100)              // after a round like the last one
    ];
  }

  // Hard: score every predictor on the last 40 rounds (right +1,
  // wrong -1, older rounds count less) and follow the best one.
  function hardPredict(hist) {
    var L = hist.length, score = [0, 0, 0, 0], w = 1;
    for (var i = L - 1; i >= Math.max(2, L - 40); i--) {
      var g = guesses(hist.slice(0, i));
      for (var p = 0; p < g.length; p++) {
        if (g[p] < 0) continue;
        score[p] += g[p] === hist[i][0] ? w : -w;
      }
      w *= 0.94;
    }
    var now = guesses(hist), best = -1, bestScore = 0;
    for (var q = 0; q < now.length; q++) {
      if (now[q] >= 0 && score[q] > bestScore) { best = q; bestScore = score[q]; }
    }
    return best < 0 ? -1 : now[best];
  }

  // The computer's move from the past rounds only; rnd() in [0, 1).
  function chooseMove(level, hist, rnd) {
    if (level === "m") {
      var top = topMoves(hist, HIST_MAX);
      if (top.length) return counter(top[Math.floor(rnd() * top.length)]);
    } else if (level === "h") {
      var guess = hardPredict(hist);
      if (guess >= 0) return counter(guess);
    }
    return Math.floor(rnd() * 3);
  }

  // ---------- 3. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                 // max-merged
  //   rows: { <deviceId>: { b: <epoch>,
  //                         s: { e|m|h: [mw, ml, rw, rd, rl, bs] } } }
  // }
  // matches won / lost, rounds won / drawn / lost, best win streak.
  // Each device only ever grows ITS OWN row; a row counts from epoch b.
  // Merge per row: the newer epoch wins, equal epochs take the per-cell
  // max; rows older than br drop. A join (symmetric, associative,
  // idempotent).
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normCell(v) {
    if (!Array.isArray(v) || v.length !== 6) return null;
    for (var i = 0; i < 6; i++) if (!isInt(v[i]) || v[i] < 0 || v[i] > MAX_COUNT) return null;
    if (v[5] > v[2]) return null;                     // a streak needs that many won rounds
    return v.slice();
  }

  function normRow(row) {
    if (!row || typeof row !== "object" || !isInt(row.b) || row.b < 0) return null;
    var s = {}, any = false;
    LEVELS.forEach(function (lv) {
      var c = normCell(row.s && row.s[lv]);
      if (c) { s[lv] = c; any = true; }
    });
    return any ? { b: row.b, s: s } : null;
  }

  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var s = {};
    LEVELS.forEach(function (lv) {
      var a = x.s[lv], c = y.s[lv];
      if (!a && !c) return;
      if (!a || !c) { s[lv] = (a || c).slice(); return; }
      s[lv] = a.map(function (v, i) { return Math.max(v, c[i]); });
    });
    return { b: x.b, s: s };
  }

  function mergeRps(A, B) {
    var a = A || {}, b = B || {};
    var br = Math.max(isInt(a.br) ? a.br : 0, isInt(b.br) ? b.br : 0);
    var rows = {};
    [a.rows || {}, b.rows || {}].forEach(function (m) {
      if (!m || typeof m !== "object") return;
      Object.keys(m).forEach(function (id) {
        var r = normRow(m[id]);
        if (!r || r.b < br) return;
        rows[id] = rows[id] ? joinRows(rows[id], r) : r;
      });
    });
    var sorted = {};
    Object.keys(rows).sort(cmpStr).forEach(function (id) {
      var r = rows[id], s = {};
      LEVELS.forEach(function (lv) { if (r.s[lv]) s[lv] = r.s[lv].slice(); });
      sorted[id] = { b: r.b, s: s };
    });
    return { ver: DATA_VER, br: br, rows: sorted };
  }

  // Totals for a level across every device; the streak is the best one.
  function totals(lv) {
    var out = [0, 0, 0, 0, 0, 0];
    Object.keys(data.rows).forEach(function (id) {
      var v = data.rows[id].s[lv];
      if (!v) return;
      for (var i = 0; i < 5; i++) out[i] += v[i];
      out[5] = Math.max(out[5], v[5]);
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
          data = mergeRps(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] rps: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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

  // One round into this device's row: res 1 won, 0 drawn, 2 lost;
  // match 1 won, 2 lost, 0 none; streak = the current win streak.
  function countRound(lv, res, match, streak) {
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // a new epoch after a reset
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    var v = row.s[lv] ? row.s[lv].slice() : [0, 0, 0, 0, 0, 0];
    if (match === 1) v[0]++;
    if (match === 2) v[1]++;
    v[res === 1 ? 2 : (res === 0 ? 3 : 4)]++;
    // a streak can only be as long as the rounds won in this epoch
    v[5] = Math.min(v[2], Math.max(v[5], streak));
    row.s[lv] = v;
    data.rows[deviceId] = row;
    data = mergeRps(data, data);
    save();
  }

  // ---------- 4. Device-local prefs + session ----------
  var prefs = { lv: "m", fmt: 3 };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (LEVELS.indexOf(p.lv) >= 0) prefs.lv = p.lv;
        if (FORMATS.indexOf(p.fmt) >= 0) prefs.fmt = p.fmt;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = {
  //   lv, fmt,
  //   you, cpu,            // rounds won in this match
  //   rounds,              // rounds played in this match
  //   done,                // the match is decided (first to 3 / 5)
  //   streak,              // current win streak (draws keep it)
  //   last: [you, cpu] | null,
  //   hist: [[you, cpu]…]  // last 200 rounds, kept across matches
  // }
  var game = null;

  function validSession(g) {
    if (!g || typeof g !== "object" || LEVELS.indexOf(g.lv) < 0 || FORMATS.indexOf(g.fmt) < 0) return false;
    var ints = [g.you, g.cpu, g.rounds, g.streak];
    for (var i = 0; i < ints.length; i++) if (!isInt(ints[i]) || ints[i] < 0 || ints[i] > MAX_COUNT) return false;
    if (g.you + g.cpu > g.rounds) return false;
    if (g.last !== null && !validPair(g.last)) return false;
    if (!Array.isArray(g.hist) || g.hist.length > HIST_MAX) return false;
    for (var k = 0; k < g.hist.length; k++) if (!validPair(g.hist[k])) return false;
    return true;
  }
  function validPair(p) {
    return Array.isArray(p) && p.length === 2 && [0, 1, 2].indexOf(p[0]) >= 0 && [0, 1, 2].indexOf(p[1]) >= 0;
  }
  function loadSession() {
    try {
      var g = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(g)) {
        g.done = g.done === true && g.fmt > 0 && Math.max(g.you, g.cpu) >= g.fmt;
        return g;
      }
    } catch (e) {}
    return null;
  }
  function saveSession() {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(game)); } catch (e) {}
  }

  // ---------- 5. Game flow ----------
  function fresh(hist, streak) {
    return { lv: prefs.lv, fmt: prefs.fmt, you: 0, cpu: 0, rounds: 0, done: false,
             streak: streak || 0, last: null, hist: hist || [] };
  }

  function inProgress() { return !!(game && !game.done && game.rounds > 0); }

  // A match in progress is never lost silently: Undo toast (R14).
  function newMatch(announce) {
    flushReveal();
    closeDialogs();
    var prev = inProgress() ? JSON.parse(JSON.stringify(game)) : null;
    var prevPrefs = JSON.parse(JSON.stringify(prefs));
    if (announce && game && !game.done && game.rounds === 0 && game.lv === prefs.lv && game.fmt === prefs.fmt) {
      showToast(t("toast.fresh"));                                  // R28
      return;
    }
    game = fresh(game ? game.hist : [], game ? game.streak : 0);
    saveSession();
    renderAll();
    if (prev) {
      undoToast(t("toast.newgame"), function () {
        flushReveal();
        closeDialogs();
        prefs = prevPrefs;
        savePrefs();
        prev.hist = game.hist;                 // rounds played since stay learned
        prev.streak = game.streak;
        game = prev;
        saveSession();
        renderAll();
      });
    } else if (announce) {
      live(t("toast.newgame"));
    }
  }

  var revealTimer = null, revealing = false;

  // You pick m; the computer's move was decided from the past only.
  function play(m) {
    if (!game || document.querySelector("dialog[open]")) return;
    flushReveal();
    if (game.done) {                          // a decided match: the next pick starts a new one
      game = fresh(game.hist, game.streak);
    }
    var c = chooseMove(game.lv, game.hist, rand);
    var res = outcome(m, c);                  // 1 you, 2 computer, 0 draw
    game.rounds++;
    if (res === 1) { game.you++; game.streak++; }
    else if (res === 2) { game.cpu++; game.streak = 0; }
    game.last = [m, c];
    game.hist.push([m, c]);
    if (game.hist.length > HIST_MAX) game.hist = game.hist.slice(-HIST_MAX);
    var match = 0;
    if (game.fmt > 0 && (game.you >= game.fmt || game.cpu >= game.fmt)) {
      game.done = true;
      match = game.you >= game.fmt ? 1 : 2;
    }
    countRound(game.lv, res, match, game.streak);
    saveSession();
    live(t("live.round", { you: t("move." + m), cpu: t("move." + c),
      res: t(res === 1 ? "verdict.win" : (res === 2 ? "verdict.lose" : "verdict.draw")),
      a: game.you, b: game.cpu }));
    startReveal(res, match);
  }

  // Both hands shake as rocks, then open (skipped with reduced motion).
  function startReveal(res, match) {
    var done = function () {
      revealTimer = null;
      revealing = false;
      $("hands").classList.remove("shaking");
      renderAll();
      sfx(match ? (match === 1 ? "win" : "lose") : (res === 1 ? "point" : (res === 2 ? "miss" : "draw")));
      if (match) setTimeout(resultDialog, 450);
    };
    if (reduced) { done(); return; }
    revealing = true;
    renderStatus();
    paintHand("you", 0, true);
    paintHand("cpu", 0, true);
    $("verdict").textContent = t("verdict.wait");
    $("verdict").className = "";
    var h = $("hands");
    h.classList.remove("shaking");
    void h.offsetWidth;
    h.classList.add("shaking");
    sfx("tick");
    revealTimer = setTimeout(done, REVEAL_MS);
    revealDone = done;
  }
  var revealDone = null;
  function flushReveal() {
    if (!revealing || !revealTimer) return;
    clearTimeout(revealTimer);
    var d = revealDone;
    revealDone = null;
    d();
  }

  // ---------- 6. Render ----------
  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function renderAll() {
    renderToolbar();
    renderStatus();
    renderHands();
  }

  function renderToolbar() {
    var lv = game ? game.lv : prefs.lv, fmt = game ? game.fmt : prefs.fmt;
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-level") === lv;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    [].forEach.call(document.querySelectorAll("#fmt-seg .seg-btn"), function (b) {
      var on = +b.getAttribute("data-fmt") === fmt;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    paintSfxBtn();
  }

  function renderStatus() {
    if (!game) return;
    $("score-you").textContent = String(game.you);
    $("score-cpu").textContent = String(game.cpu);
    var parts = [t("st.round", { n: game.rounds + (game.done ? 0 : 1) }),
                 game.fmt ? t("st.to", { n: game.fmt }) : t("st.endless")];
    if (game.streak > 1) parts.push(t("st.streak", { n: game.streak }));
    $("turn").textContent = parts.join(" · ");
    var lead = game.you - game.cpu;
    $("side-you").classList.toggle("lead", lead > 0);
    $("side-cpu").classList.toggle("lead", lead < 0);
  }

  var MOVE_ART = [
    // rock: a rounded stone with two cracks
    '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 40c-3-9 1-19 9-23 7-4 17-4 24 0 8 4 11 13 9 21-2 9-10 14-21 14-10 0-18-4-21-12z" fill="currentColor" fill-opacity="0.18"/><path d="M24 24l5 6-3 6M40 30l-4 7 5 5"/></svg>',
    // paper: a sheet with a folded corner and lines
    '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M16 8h22l12 12v36H16z" fill="currentColor" fill-opacity="0.18"/><path d="M38 8v12h12M23 30h20M23 38h20M23 46h13"/></svg>',
    // scissors
    '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="17" cy="18" r="8" fill="currentColor" fill-opacity="0.18"/><circle cx="17" cy="46" r="8" fill="currentColor" fill-opacity="0.18"/><path d="M23 23 33 32M54 10 23 41M39 37l15 17"/></svg>'
  ];
  var UNKNOWN_ART = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="32" cy="32" r="22" stroke-dasharray="5 6"/><path d="M26 26a6 6 0 1 1 9 5c-2 1-3 2-3 5M32 43v.5"/></svg>';

  function paintHand(who, m, hidden) {
    var art = $("art-" + who), label = $("label-" + who);
    art.innerHTML = m === null ? UNKNOWN_ART : MOVE_ART[m];
    label.textContent = hidden ? "…" : (m === null ? "" : t("move." + m));
    $("hand-" + who).setAttribute("aria-label",
      t(who === "you" ? "hand.you" : "hand.cpu", { m: (hidden || m === null) ? t("hand.none") : t("move." + m) }));
  }

  function renderHands() {
    if (!game) return;
    var last = game.last, res = last ? outcome(last[0], last[1]) : -1;
    paintHand("you", last ? last[0] : null, false);
    paintHand("cpu", last ? last[1] : null, false);
    $("hand-you").className = "hand you" + (res === 1 ? " won" : (res === 2 ? " lost" : ""));
    $("hand-cpu").className = "hand cpu" + (res === 2 ? " won" : (res === 1 ? " lost" : ""));
    var v = $("verdict");
    if (game.done) { v.textContent = t("verdict.match"); v.className = "match"; }
    else if (!last || game.rounds === 0) { v.textContent = t("verdict.start"); v.className = ""; }
    else {
      v.textContent = t(res === 1 ? "verdict.win" : (res === 2 ? "verdict.lose" : "verdict.draw"));
      v.className = res === 1 ? "win" : (res === 2 ? "lose" : "draw");
    }
  }

  function buildPicks() {
    var box = $("picks");
    box.innerHTML = "";
    box.setAttribute("aria-label", t("picks.label"));
    for (var m = 0; m < 3; m++) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "pick";
      b.setAttribute("data-m", String(m));
      b.setAttribute("aria-label", t("pick.label", { move: t("move." + m), k: t("key." + m), n: m + 1 }));
      var art = el("span", "pick-art");
      art.innerHTML = MOVE_ART[m];
      art.setAttribute("aria-hidden", "true");
      b.appendChild(art);
      b.appendChild(el("span", "pick-name", t("move." + m)));
      var k = el("span", "pick-key", t("key." + m) + " · " + (m + 1));
      k.setAttribute("aria-hidden", "true");
      b.appendChild(k);
      box.appendChild(b);
    }
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

  function resultDialog() {
    if (!game || !game.done) return;           // replaced meanwhile
    closeDialogs();
    var s = totals(game.lv);
    var dlg = makeDialog("rps-result");
    dlg.appendChild(el("div", "dlg-title", t("res.title") + " · " + t("level." + game.lv)));
    dlg.appendChild(el("div", "dlg-hero" + (game.you > game.cpu ? "" : " lose"),
      t(game.you > game.cpu ? "res.youwin" : "res.ailose")));
    dlg.appendChild(el("div", "dlg-score", game.you + " – " + game.cpu));
    dlg.appendChild(row(t("res.rounds"), String(game.rounds)));
    dlg.appendChild(row(t("res.matches"), s[0] + " · " + s[1]));
    dlg.appendChild(row(t("res.best"), String(s[5])));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("res.close"), "", function () { dlg.close(); }));
    var again = button(t("res.again"), "primary", function () { dlg.close(); newMatch(false); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    again.focus();
  }

  function statsDialog() {
    flushReveal();
    var dlg = makeDialog("rps-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    var empty = true;
    LEVELS.forEach(function (lv) {
      var s = totals(lv);
      if (s[2] + s[3] + s[4]) empty = false;
      dlg.appendChild(el("div", "dlg-sub", t("level." + lv)));
      dlg.appendChild(row(t("stats.matches"), s[0] + " · " + s[1]));
      dlg.appendChild(row(t("stats.rounds"), s[2] + " · " + s[3] + " · " + s[4]));
      dlg.appendChild(row(t("stats.best"), String(s[5])));
    });
    dlg.appendChild(el("div", "dlg-foot", t("stats.note")));
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
    var dlg = makeDialog("rps-confirm");
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
    data = mergeRps(data, data);
    save();
    if (game) { game.streak = 0; saveSession(); }
    renderStatus();
    showToast(t("toast.reset"));
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "rps", title: String(text) })) return;
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
      if (kind === "tick") { [0, 0.2, 0.4].forEach(function (s) { tone(240, s, 0.06, "triangle", 0.12); }); }
      else if (kind === "point") { tone(660, 0, 0.1, "triangle", 0.14); tone(880, 0.08, 0.14, "triangle", 0.12); }
      else if (kind === "miss") { tone(330, 0, 0.12, "sine", 0.14); tone(247, 0.1, 0.18, "sine", 0.12); }
      else if (kind === "draw") tone(440, 0, 0.12, "sine", 0.1);
      else if (kind === "win") {
        [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
      } else if (kind === "lose") { tone(392, 0, 0.18, "sine"); tone(294, 0.16, 0.3, "sine"); }
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Toolbar icons (R9: injected by JS) ----------
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

  // ---------- 10. Keyboard ----------
  function keyMove(code) {
    var k = KEYS[LANG][code];
    if (k !== undefined) return k;
    var m = /^(?:Digit|Numpad)([1-3])$/.exec(code);
    return m ? +m[1] - 1 : -1;
  }

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;   // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      if (e.repeat) return;
      var m = keyMove(e.code);
      if (m >= 0) { e.preventDefault(); press(m); return; }
      if (e.code === "KeyN") { e.preventDefault(); newMatch(true); }
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

  // A pick from a key or a button: the button flashes, then the round.
  function press(m) {
    var b = document.querySelector('#picks .pick[data-m="' + m + '"]');
    if (b && !reduced) {
      b.classList.remove("hit");
      void b.offsetWidth;
      b.classList.add("hit");
      setTimeout(function () { b.classList.remove("hit"); }, 140);
    }
    play(m);
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
    api.registerSlice("rps", sliceGet, sliceSet, STORAGE_KEY, mergeRps);
  }

  function sliceGet() {
    return mergeRps(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeRps(incoming, incoming);
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
  }

  function paintStatic() {
    [["new-btn", "new", "btn.new"], ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
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
        if (game && lv === game.lv) return;              // visible active state
        prefs.lv = lv; savePrefs(); newMatch(false);
      });
    });
    [].forEach.call(document.querySelectorAll("#fmt-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () {
        var f = +b.getAttribute("data-fmt");
        if (game && f === game.fmt) return;
        prefs.fmt = f; savePrefs(); newMatch(false);
      });
    });
    $("new-btn").addEventListener("click", function () { newMatch(true); $("new-btn").blur(); });
    $("stats-btn").addEventListener("click", statsDialog);
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("point");   // audible confirmation when turned on
    });
    $("picks").addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".pick");
      if (b) play(+b.getAttribute("data-m"));
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
    buildPicks();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    game = loadSession();
    if (game) { prefs.lv = game.lv; prefs.fmt = game.fmt; }   // the resumed match decides the toolbar
    else { game = fresh([], 0); saveSession(); }
    renderAll();
  }

  boot();
})();
