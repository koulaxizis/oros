// ============================================================
// orOS Mancala — App logic (v1.0.0)
// Kalah: two rows of 6 pits and a store each. Pick one of your pits;
// its seeds are sown one by one counter-clockwise, into your store
// but never the opponent's. Last seed in your store: play again.
// Last seed in an empty pit of yours with seeds opposite: both go to
// your store. When one side is empty the game ends and every seed
// left goes to its owner's store; the fuller store wins.
//   - 3 / 4 / 5 / 6 seeds per pit
//   - vs Computer, 3 levels: Easy (random) · Medium (greedy, follows
//     extra-turn chains) · Hard (alpha-beta, iterative deepening,
//     500 ms budget)
//   - who starts vs the computer: you / computer / take turns
//   - 2 players on one device, with a running series score
//   - undo (vs the computer it also takes back its answer)
//   - animated sowing (off with reduced motion); counts always shown
// Data:
//   - synced slice "mancala" (oros-mancala-data): results vs the
//     computer per level as per-device counter rows (each device only
//     grows its own row; merge = per-row join) + a reset stamp br
//   - device-local (R10): oros-mancala-prefs (mode, level, seeds,
//     first, next starter), oros-mancala-session (the game in progress
//     and the 2-player series), oros-mancala-device (row id),
//     oros-mancala-sfx (sound on/off)
// Sections:
//   1. Constants, i18n, helpers
//   2. Board model (sow, capture, sweep, replay)
//   3. Computer player (easy / greedy chains / alpha-beta)
//   4. Synced data: load / save / normalize / merge (R5, R26)
//   5. Device-local prefs + session
//   6. Game flow (new, play, animate, computer turn, undo, finish)
//   7. Render (toolbar, status, board, pits)
//   8. Dialogs (result, records, confirm)
//   9. Toasts
//  10. Sound
//  11. Keyboard (1–6, arrows, N, Z, Contract Β)
//  12. Sync slice + palette
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-mancala-data";
  var PREFS_KEY   = "oros-mancala-prefs";
  var SESSION_KEY = "oros-mancala-session";
  var DEVICE_KEY  = "oros-mancala-device";
  var SFX_KEY     = "oros-mancala-sfx";
  var DATA_VER    = 1;

  var PITS = 6, N = 14, STORE = [6, 13];
  var LEVELS = ["e", "m", "h"];
  var MODES = ["ai", "duo"];
  var FIRSTS = ["you", "ai", "alt"];
  var SEEDS = [3, 4, 5, 6];
  var HARD_DEPTH = 14, HARD_BUDGET = 500;   // ms
  var AI_MIN_DELAY = 450;                   // ms, so the reply is visible
  var MAX_MOVES = 400;                      // a session longer than this is junk

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
      "mode.ai": "vs Computer", "mode.duo": "2 players",
      "level.e": "Easy", "level.m": "Medium", "level.h": "Hard",
      "first.you": "You start", "first.ai": "Computer starts", "first.alt": "Take turns",
      "first.label": "First move",
      "seeds.label": "Seeds per pit",
      "seeds.n": "{n} seeds",
      "side.you": "You", "side.ai": "Computer",
      "player.1": "Player 1", "player.2": "Player 2",
      "turn.you": "Your turn", "turn.ai": "Computer is thinking…",
      "turn.player": "{player}'s turn",
      "turn.again": "{who}: play again",
      "turn.youagain": "Play again",
      "turn.win": "{who} won", "turn.youwin": "You won", "turn.draw": "Draw",
      "btn.new": "New game (N)", "btn.undo": "Undo move (Z)",
      "btn.undoNone": "Nothing to undo",
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "board.label": "Mancala board",
      "pit.label": "{who}, pit {n}: {seeds} seeds",
      "store.label": "{who}'s store: {seeds} seeds",
      "live.move": "{who}: pit {n}",
      "live.extra": "last seed in the store, play again",
      "live.capture": "captures {n}",
      "res.title": "Game over",
      "res.youwin": "You win!",
      "res.ailose": "The computer wins",
      "res.pwin": "{player} wins!",
      "res.draw": "It's a draw!",
      "res.again": "Play again",
      "res.close": "Close",
      "res.series": "Series",
      "res.score": "Stores",
      "stats.title": "Records vs computer",
      "stats.head": "Won · lost · drawn",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "confirm.reset": "Delete the records vs the computer on every device, and this device's 2-player series?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Records reset",
      "toast.newgame": "New game started",
      "toast.undo": "Undo",
      "toast.save": "Could not save: storage is full",
      "toast.empty": "That pit is empty",
      "toast.notyours": "Pick a pit on your own row",
      "toast.wait": "The computer is playing",
      "toast.sowing": "Wait for the seeds to land",
      "toast.over": "The game is over: start a new one (N)"
    },
    el: {
      "mode.ai": "Με υπολογιστή", "mode.duo": "2 παίκτες",
      "level.e": "Εύκολο", "level.m": "Μεσαίο", "level.h": "Δύσκολο",
      "first.you": "Ξεκινάς εσύ", "first.ai": "Ξεκινά ο υπολογιστής", "first.alt": "Εναλλάξ",
      "first.label": "Πρώτη κίνηση",
      "seeds.label": "Σπόροι ανά λακκούβα",
      "seeds.n": "{n} σπόροι",
      "side.you": "Εσύ", "side.ai": "Υπολογιστής",
      "player.1": "Παίκτης 1", "player.2": "Παίκτης 2",
      "turn.you": "Σειρά σου", "turn.ai": "Ο υπολογιστής σκέφτεται…",
      "turn.player": "Σειρά: {player}",
      "turn.again": "{who}: παίζει ξανά",
      "turn.youagain": "Παίζεις ξανά",
      "turn.win": "Κέρδισε: {who}", "turn.youwin": "Κέρδισες", "turn.draw": "Ισοπαλία",
      "btn.new": "Νέο παιχνίδι (N)", "btn.undo": "Αναίρεση κίνησης (Z)",
      "btn.undoNone": "Δεν υπάρχει κίνηση για αναίρεση",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "board.label": "Ταμπλό Μαγκάλα",
      "pit.label": "{who}, λακκούβα {n}: {seeds} σπόροι",
      "store.label": "Αποθήκη ({who}): {seeds} σπόροι",
      "live.move": "{who}: λακκούβα {n}",
      "live.extra": "ο τελευταίος σπόρος στην αποθήκη, παίζει ξανά",
      "live.capture": "παίρνει {n}",
      "res.title": "Τέλος",
      "res.youwin": "Κέρδισες!",
      "res.ailose": "Κέρδισε ο υπολογιστής",
      "res.pwin": "Νικητής: {player}!",
      "res.draw": "Ισοπαλία!",
      "res.again": "Ξανά",
      "res.close": "Κλείσιμο",
      "res.series": "Σειρά αγώνων",
      "res.score": "Αποθήκες",
      "stats.title": "Ρεκόρ με υπολογιστή",
      "stats.head": "Νίκες · ήττες · ισοπαλίες",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ με τον υπολογιστή σε όλες τις συσκευές και η σειρά αγώνων 2 παικτών αυτής της συσκευής;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.newgame": "Ξεκίνησε νέο παιχνίδι",
      "toast.undo": "Αναίρεση",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "toast.empty": "Η λακκούβα είναι άδεια",
      "toast.notyours": "Διάλεξε λακκούβα από τη δική σου σειρά",
      "toast.wait": "Παίζει ο υπολογιστής",
      "toast.sowing": "Περίμενε να πέσουν οι σπόροι",
      "toast.over": "Το παιχνίδι τελείωσε: ξεκίνα νέο (N)"
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
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  // crypto RNG with rejection sampling (same as Dice / Memory)
  function randInt(n) {
    var buf = new Uint32Array(1);
    var lim = 0xFFFFFFFF - (0xFFFFFFFF % n);
    while (true) {
      crypto.getRandomValues(buf);
      if (buf[0] < lim) return buf[0] % n;
    }
  }

  function reducedMotion() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch (e) { return false; }
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("mancala.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Board model ----------
  // s[0..5]  player 0's pits (bottom row, left → right), s[6] its store
  // s[7..12] player 1's pits (top row, right → left), s[13] its store
  // Sowing runs 0 → 13 and round again (counter-clockwise on screen).
  // Pit i faces pit 12 − i.
  function startBoard(seeds) {
    var s = [];
    for (var i = 0; i < N; i++) s.push(i === 6 || i === 13 ? 0 : seeds);
    return s;
  }

  function ownPit(p, i) { return p === 0 ? (i >= 0 && i <= 5) : (i >= 7 && i <= 12); }

  function sideSum(s, p) {
    var a = p === 0 ? 0 : 7, n = 0;
    for (var i = a; i < a + PITS; i++) n += s[i];
    return n;
  }

  // Pits player p may play.
  function legalPits(s, p) {
    var out = [], a = p === 0 ? 0 : 7;
    for (var i = a; i < a + PITS; i++) if (s[i] > 0) out.push(i);
    return out;
  }

  // Sow pit i for player p. Pure: returns the new board and what
  // happened. path = every pit that received a seed, in order;
  // cap = the captured pit (−1 if none); over = one side is empty and
  // the rest has been swept to its owner.
  function sow(s0, p, i) {
    var s = s0.slice(), n = s[i], pos = i, path = [];
    var skip = STORE[1 - p], store = STORE[p];
    s[i] = 0;
    while (n > 0) {
      pos = (pos + 1) % N;
      if (pos === skip) continue;
      s[pos]++;
      n--;
      path.push(pos);
    }
    var extra = pos === store, cap = -1, got = 0;
    if (!extra && ownPit(p, pos) && s[pos] === 1 && s[12 - pos] > 0) {
      cap = 12 - pos;
      got = s[cap] + 1;
      s[store] += got;
      s[pos] = 0;
      s[cap] = 0;
    }
    var over = false;
    if (sideSum(s, 0) === 0 || sideSum(s, 1) === 0) {
      over = true;
      for (var k = 0; k < PITS; k++) {
        s[6] += s[k]; s[k] = 0;
        s[13] += s[7 + k]; s[7 + k] = 0;
      }
    }
    return { s: s, path: path, last: pos, extra: extra && !over, cap: cap, got: got, over: over };
  }

  // Who moves after player p's sow result r.
  function nextAfter(p, r) { return r.over ? -1 : (r.extra ? p : 1 - p); }

  // Replay a move list (pit indices) from the start. Returns null if a
  // move is illegal (a broken session).
  function replay(seeds, starter, moves) {
    var s = startBoard(seeds), p = starter, r = null;
    for (var k = 0; k < moves.length; k++) {
      var i = moves[k];
      if (p < 0 || !isInt(i) || !ownPit(p, i) || s[i] === 0) return null;
      r = sow(s, p, i);
      s = r.s;
      p = nextAfter(p, r);
    }
    return { s: s, next: p, over: p < 0, lastRes: r };
  }

  // ---------- 3. Computer player ----------
  // Store difference from p's side.
  function evaluate(s, p) {
    return (s[STORE[p]] - s[STORE[1 - p]]) * 4 + (sideSum(s, p) - sideSum(s, 1 - p));
  }

  // Medium: the best store gain over every chain of extra turns that
  // starts with each move (a greedy look at this turn only).
  function chainGain(s, p, budget) {
    var best = -Infinity;
    var pits = legalPits(s, p);
    for (var k = 0; k < pits.length; k++) {
      var r = sow(s, p, pits[k]);
      var g = r.s[STORE[p]] - r.s[STORE[1 - p]];
      if (r.extra && budget.n-- > 0) g = Math.max(g, chainGain(r.s, p, budget));
      if (g > best) best = g;
    }
    return best;
  }

  var WIN_SCORE = 100000;
  function Abort() {}

  // Alpha-beta; returns the score for player p (the searching side).
  // An extra turn keeps the same player to move.
  function search(s, toMove, p, depth, alpha, beta, ctx) {
    if ((++ctx.nodes & 1023) === 0 && ctx.deadline && now() > ctx.deadline) throw new Abort();
    if (depth === 0) return evaluate(s, p);
    var pits = legalPits(s, toMove);
    var maxing = toMove === p, best = maxing ? -Infinity : Infinity;
    for (var k = 0; k < pits.length; k++) {
      var r = sow(s, toMove, pits[k]), v;
      if (r.over) {
        var d = r.s[STORE[p]] - r.s[STORE[1 - p]];
        v = d > 0 ? WIN_SCORE + d : (d < 0 ? -WIN_SCORE + d : 0);
      } else {
        v = search(r.s, nextAfter(toMove, r), p, depth - 1, alpha, beta, ctx);
      }
      if (maxing) { if (v > best) best = v; if (v > alpha) alpha = v; }
      else { if (v < best) best = v; if (v < beta) beta = v; }
      if (alpha >= beta) break;
    }
    return best;
  }

  function rootScores(s, p, depth, ctx) {
    var out = [], pits = legalPits(s, p);
    // the last pit first: extra turns are found early (better cut-offs)
    pits.sort(function (a, b) { return b - a; });
    for (var k = 0; k < pits.length; k++) {
      var r = sow(s, p, pits[k]), v;
      if (r.over) {
        var d = r.s[STORE[p]] - r.s[STORE[1 - p]];
        v = d > 0 ? WIN_SCORE + d : (d < 0 ? -WIN_SCORE + d : 0);
      } else {
        v = search(r.s, nextAfter(p, r), p, depth - 1, -Infinity, Infinity, ctx);
      }
      out.push({ i: pits[k], s: v });
    }
    return out;
  }

  function pickBest(scores) {
    var top = -Infinity, ties = [];
    scores.forEach(function (x) {
      if (x.s > top) { top = x.s; ties = [x.i]; }
      else if (x.s === top) ties.push(x.i);
    });
    return ties[randInt(ties.length)];
  }

  function chooseMove(s, p, level, budgetMs) {
    var pits = legalPits(s, p);
    if (!pits.length) return -1;
    if (level === "e") return pits[randInt(pits.length)];
    if (level === "m") {
      return pickBest(pits.map(function (i) {
        var r = sow(s, p, i);
        var g = r.s[STORE[p]] - r.s[STORE[1 - p]];
        if (r.extra) g = Math.max(g, chainGain(r.s, p, { n: 200 })) + 0.5;   // a free move is worth a little
        return { i: i, s: g };
      }));
    }
    var ctx = { nodes: 0, deadline: now() + (budgetMs || HARD_BUDGET) }, best = null;
    for (var d = 2; d <= HARD_DEPTH; d++) {
      try { best = rootScores(s, p, d, ctx); }
      catch (e) { if (e instanceof Abort) break; throw e; }
    }
    return pickBest(best || rootScores(s, p, 1, { nodes: 0, deadline: 0 }));
  }

  // ---------- 4. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                               // max-merged
  //   rows: { <deviceId>: { b: <epoch>, s: { e:[w,l,d], m:[…], h:[…] } } }
  // }
  // Each device only ever increments ITS OWN row; a row counts from
  // epoch b. Merge per row: the newer epoch wins, equal epochs take the
  // per-cell max; rows older than br are dropped. A join (symmetric,
  // associative, idempotent), so no result is lost or double-counted.
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normRow(row) {
    if (!row || typeof row !== "object" || !isInt(row.b) || row.b < 0) return null;
    var s = {}, any = false;
    LEVELS.forEach(function (lv) {
      var v = row.s && row.s[lv];
      if (Array.isArray(v) && v.length === 3 &&
          isInt(v[0]) && isInt(v[1]) && isInt(v[2]) && v[0] >= 0 && v[1] >= 0 && v[2] >= 0) {
        s[lv] = [v[0], v[1], v[2]];
        any = true;
      }
    });
    return any ? { b: row.b, s: s } : null;
  }

  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var s = {};
    LEVELS.forEach(function (lv) {
      var a = x.s[lv], c = y.s[lv];
      if (!a && !c) return;
      if (!a) { s[lv] = c.slice(); return; }
      if (!c) { s[lv] = a.slice(); return; }
      s[lv] = [Math.max(a[0], c[0]), Math.max(a[1], c[1]), Math.max(a[2], c[2])];
    });
    return { b: x.b, s: s };
  }

  function mergeMancala(A, B) {
    var a = A || {}, b = B || {};
    var br = Math.max(isInt(a.br) && a.br > 0 ? a.br : 0, isInt(b.br) && b.br > 0 ? b.br : 0);
    var rows = {};
    [a.rows, b.rows].forEach(function (m) {
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

  // Totals per level across every device: [won, lost, drawn].
  function totals(lv) {
    var out = [0, 0, 0];
    Object.keys(data.rows).forEach(function (id) {
      var v = data.rows[id].s[lv];
      if (v) { out[0] += v[0]; out[1] += v[1]; out[2] += v[2]; }
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
          data = mergeMancala(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] mancala: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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

  // res: 0 = you won, 1 = you lost, 2 = draw
  function countResult(lv, res) {
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // a new epoch after a reset
    var v = row.s[lv] ? row.s[lv].slice() : [0, 0, 0];
    v[res]++;
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    row.s[lv] = v;
    data.rows[deviceId] = row;
    data = mergeMancala(data, data);
    save();
  }

  // ---------- 5. Device-local prefs + session ----------
  var prefs = { mode: "ai", lv: "m", seeds: 4, first: "you", nextAi: false };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (MODES.indexOf(p.mode) >= 0) prefs.mode = p.mode;
        if (LEVELS.indexOf(p.lv) >= 0) prefs.lv = p.lv;
        if (SEEDS.indexOf(p.seeds) >= 0) prefs.seeds = p.seeds;
        if (FIRSTS.indexOf(p.first) >= 0) prefs.first = p.first;
        prefs.nextAi = p.nextAi === true;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = {
  //   mode, lv, seeds,
  //   starter: 0 | 1,      // who sowed first (0 = bottom row)
  //   ai: −1 | 1,          // the computer's side (vs computer: 1, top)
  //   moves: [pit…],
  //   done: bool,
  //   series: [p1, p2]     // 2-player running score (this device)
  // }
  // The board itself is always replayed from moves.
  var game = null, board = null;

  function validSession(g) {
    if (!g || typeof g !== "object" || MODES.indexOf(g.mode) < 0 ||
        LEVELS.indexOf(g.lv) < 0 || SEEDS.indexOf(g.seeds) < 0 ||
        (g.starter !== 0 && g.starter !== 1) || (g.ai !== -1 && g.ai !== 1) ||
        !Array.isArray(g.moves) || g.moves.length > MAX_MOVES ||
        !Array.isArray(g.series) || g.series.length !== 2 ||
        !isInt(g.series[0]) || !isInt(g.series[1])) return false;
    return replay(g.seeds, g.starter, g.moves) !== null;
  }
  function loadSession() {
    try {
      var g = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(g)) { g.done = g.done === true; return g; }
    } catch (e) {}
    return null;
  }
  function saveSession() {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(game)); } catch (e) {}
  }

  // ---------- 6. Game flow ----------
  var aiTimer = null;
  var anim = null;          // { timer, frames, k, done } while seeds are flying
  var lastRes = null;       // the last sow, for highlights

  function fresh(series) {
    var g = { mode: prefs.mode, lv: prefs.lv, seeds: prefs.seeds, starter: 0, ai: -1,
              moves: [], done: false, series: series || [0, 0] };
    if (g.mode === "ai") {
      g.ai = 1;
      var aiFirst = prefs.first === "ai" || (prefs.first === "alt" && prefs.nextAi);
      g.starter = aiFirst ? 1 : 0;
      if (prefs.first === "alt") { prefs.nextAi = !prefs.nextAi; savePrefs(); }
    } else if (game && game.mode === "duo") {
      g.starter = 1 - game.starter;              // 2 players: starts alternate
    }
    return g;
  }

  function inProgress() { return !!(game && !game.done && game.moves.length > 0); }

  // A game in progress is never lost silently: Undo toast (R14).
  function newGame(announce, keepSeries) {
    var prev = inProgress() ? JSON.parse(JSON.stringify(game)) : null;
    var prevPrefs = JSON.parse(JSON.stringify(prefs));
    cancelAi(); stopAnim();
    var series = (keepSeries && game && game.mode === "duo" && prefs.mode === "duo") ? game.series.slice() : [0, 0];
    game = fresh(series);
    saveSession();
    syncBoard();
    lastRes = null;
    renderAll();
    maybeAi();
    if (prev) {
      undoToast(t("toast.newgame"), function () {
        cancelAi(); stopAnim();
        prefs = prevPrefs;
        savePrefs();
        game = prev;
        saveSession();
        syncBoard();
        lastRes = null;
        renderAll();
        maybeAi();
      });
    } else if (announce) {
      live(t("toast.newgame"));
    }
  }

  function syncBoard() {
    board = replay(game.seeds, game.starter, game.moves);
    if (!board) {                              // cannot happen after validSession
      game.moves = [];
      board = replay(game.seeds, game.starter, []);
    }
  }

  function aiTurn() { return game.mode === "ai" && !game.done && board.next === game.ai; }

  function cancelAi() { if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; } }

  function maybeAi() {
    if (!aiTurn() || aiTimer || anim) return;
    renderStatus();
    var started = Date.now();
    aiTimer = setTimeout(function () {
      var i = chooseMove(board.s, game.ai, game.lv);
      var wait = Math.max(0, AI_MIN_DELAY - (Date.now() - started));
      aiTimer = setTimeout(function () {
        aiTimer = null;
        if (aiTurn() && !anim && i >= 0) place(i);
      }, wait);
    }, 30);
  }

  // A human tap on pit i.
  function play(i) {
    if (!game) return;
    if (game.done) { showToast(t("toast.over")); return; }          // R28
    if (anim) { showToast(t("toast.sowing")); return; }
    if (aiTurn()) { showToast(t("toast.wait")); return; }
    if (!ownPit(board.next, i)) { showToast(t("toast.notyours")); shake(i); return; }
    if (board.s[i] === 0) { showToast(t("toast.empty")); shake(i); return; }
    place(i);
  }

  function place(i) {
    var p = board.next, before = board.s.slice();
    var r = sow(before, p, i);
    game.moves.push(i);
    syncBoard();
    lastRes = { p: p, i: i, r: r };
    var msg = t("live.move", { who: sideName(p), n: pitNo(i) });
    if (r.cap >= 0) msg += ", " + t("live.capture", { n: r.got });
    if (r.extra) msg += ", " + t("live.extra");
    live(msg);
    if (board.over) game.done = true;
    saveSession();
    animateSow(before, p, i, r, function () {
      if (game.done) { finish(); return; }
      renderAll();
      maybeAi();
    });
  }

  // Seeds fly one pit at a time; the counts follow. Reduced motion:
  // straight to the end.
  function animateSow(before, p, i, r, done) {
    stopAnim();
    if (reducedMotion() || r.path.length === 0) { sfx("sow"); done(); return; }
    var frames = [], s = before.slice();
    s[i] = 0;
    frames.push({ s: s.slice(), hot: i });
    r.path.forEach(function (pos) {
      s[pos]++;
      frames.push({ s: s.slice(), hot: pos });
    });
    var step = Math.max(55, Math.min(170, Math.round(1600 / frames.length)));
    anim = { k: 0, frames: frames, timer: null };
    renderToolbar();
    renderStatus();
    var tick = function () {
      if (!anim) return;
      var f = anim.frames[anim.k++];
      renderPits(f.s, f.hot);
      if (anim.k > 1) sfx("seed");
      if (anim.k >= anim.frames.length) {
        anim.timer = setTimeout(function () { anim = null; done(); }, step + 60);
        return;
      }
      anim.timer = setTimeout(tick, step);
    };
    tick();
  }
  function stopAnim() {
    if (anim) { clearTimeout(anim.timer); anim = null; }
  }

  // Undo: one move with 2 players; vs the computer, back to your turn.
  function canUndo() {
    if (!game || game.done || anim || !game.moves.length) return false;
    if (game.mode === "duo") return true;
    // only the computer's moves so far: nothing of yours to take back
    var b = replay(game.seeds, game.starter, []), p = b.next;
    for (var k = 0; k < game.moves.length; k++) {
      if (p !== game.ai) return true;
      var r = sow(b.s, p, game.moves[k]);
      b = { s: r.s };
      p = nextAfter(p, r);
    }
    return false;
  }
  function undo() {
    if (!canUndo()) { showToast(t(anim ? "toast.sowing" : "btn.undoNone")); return; }   // R28
    cancelAi();
    game.moves.pop();
    syncBoard();
    if (game.mode === "ai") {
      while (game.moves.length && board.next === game.ai) {
        game.moves.pop();
        syncBoard();
      }
    }
    lastRes = null;
    saveSession();
    renderAll();
    maybeAi();
  }

  function winnerOf(s) {
    return s[6] > s[13] ? 0 : (s[13] > s[6] ? 1 : -1);
  }

  function finish() {
    game.done = true;
    var w = winnerOf(board.s);
    if (game.mode === "duo") {
      if (w >= 0) game.series[w]++;
    } else {
      countResult(game.lv, w < 0 ? 2 : (w === game.ai ? 1 : 0));
    }
    saveSession();
    renderAll();
    sfx(w >= 0 && !(game.mode === "ai" && w === game.ai) ? "win" : "end");
    setTimeout(function () { resultDialog(w); }, 700);
  }

  // ---------- 7. Render ----------
  function sideName(p) {
    if (game && game.mode === "ai") return t(p === game.ai ? "side.ai" : "side.you");
    return t("player." + (p + 1));
  }
  // Pit number as the owner sees it: 1–6 from their left.
  function pitNo(i) { return i < 6 ? i + 1 : i - 6; }

  function renderAll() {
    renderToolbar();
    renderStatus();
    renderPits(board.s, -1);
  }

  function renderToolbar() {
    var mode = game ? game.mode : prefs.mode;
    var lv = game ? game.lv : prefs.lv;
    [].forEach.call(document.querySelectorAll("#mode-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-mode") === mode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-level") === lv;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    $("level-seg").hidden = mode !== "ai";
    $("first-select").hidden = mode !== "ai";
    $("first-select").value = prefs.first;
    $("seeds-select").value = String(game ? game.seeds : prefs.seeds);
    var u = $("undo-btn"), ok = canUndo();
    u.disabled = !ok;
    u.title = t(ok ? "btn.undo" : "btn.undoNone");
    u.setAttribute("aria-label", u.title);
    paintSfxBtn();
  }

  function renderStatus() {
    if (!game) return;
    var ai = game.mode === "ai";
    $("name0").textContent = ai ? t("side.you") : t("player.1");
    $("name1").textContent = ai ? t("side.ai") : t("player.2");
    var sc = ai ? totals(game.lv) : game.series;
    $("score0").textContent = String(sc[0]);
    $("score1").textContent = String(sc[1]);
    var next = board.next, txt;
    var again = lastRes && lastRes.r.extra && lastRes.p === next;
    if (game.done) {
      var w = winnerOf(board.s);
      txt = w < 0 ? t("turn.draw") : (ai && w !== game.ai) ? t("turn.youwin") : t("turn.win", { who: sideName(w) });
    } else if (ai) {
      txt = next === game.ai ? (again ? t("turn.again", { who: t("side.ai") }) : t("turn.ai"))
          : (again ? t("turn.youagain") : t("turn.you"));
    } else {
      txt = again ? t("turn.again", { who: t("player." + (next + 1)) })
                  : t("turn.player", { player: t("player." + (next + 1)) });
    }
    $("turn").textContent = txt;
    $("side0").classList.toggle("turn", !game.done && next === 0);
    $("side1").classList.toggle("turn", !game.done && next === 1);
  }

  // DOM: #board holds both stores and the 12 pits as grid items; the
  // classes c0…c5 (screen column, left → right) and r0 / r1 (top /
  // bottom row) place them. On a tall screen the CSS turns the board a
  // quarter turn (stores top and bottom). Built once.
  function buildBoard() {
    var el = $("board");
    el.innerHTML = "";
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", t("board.label"));
    var mk = function (i, cls) {
      var b = document.createElement(i === 6 || i === 13 ? "div" : "button");
      if (b.tagName === "BUTTON") { b.type = "button"; b.tabIndex = -1; }
      b.className = cls;
      b.setAttribute("data-i", String(i));
      var seeds = document.createElement("span");
      seeds.className = "seeds";
      seeds.setAttribute("aria-hidden", "true");
      var cnt = document.createElement("span");
      cnt.className = "cnt";
      cnt.setAttribute("aria-hidden", "true");
      b.appendChild(seeds);
      b.appendChild(cnt);
      return b;
    };
    el.appendChild(mk(13, "store st1"));
    for (var k = 12; k >= 7; k--) el.appendChild(mk(k, "pit p1 r0 c" + (12 - k)));
    for (var j = 0; j <= 5; j++) el.appendChild(mk(j, "pit p0 r1 c" + j));
    el.appendChild(mk(6, "store st0"));
  }

  // Up to 24 seeds (48 in a store) drawn as beads on fixed spots of a
  // spiral, in % of the box (a store stretches it); the count is always
  // written too.
  function spiral(n, r0) {
    var out = [];
    for (var k = 0; k < n; k++) {
      var r = r0 + (0.41 - r0) * Math.sqrt((k + 0.5) / n), a = k * 2.39996;
      out.push([50 + 100 * r * Math.cos(a), 50 + 100 * r * Math.sin(a)]);
    }
    return out;
  }
  var SPOTS = [spiral(24, 0.10), spiral(48, 0.24)];   // a store keeps its middle for the count

  function paintSeeds(box, n, store) {
    var want = Math.min(n, store ? 48 : 24);
    if (box.childElementCount === want) return;
    while (box.childElementCount > want) box.removeChild(box.lastChild);
    while (box.childElementCount < want) {
      var k = box.childElementCount, d = document.createElement("i");
      var at = SPOTS[store ? 1 : 0][k];
      d.style.left = at[0] + "%";
      d.style.top = at[1] + "%";
      d.style.setProperty("--h", String((k * 47) % 360));
      box.appendChild(d);
    }
  }

  function renderPits(s, hot) {
    var el = $("board");
    if (!el.firstChild) buildBoard();
    var busy = !!anim || !game || game.done || aiTurn();
    var next = board.next;
    el.classList.toggle("over", !!game.done);
    [].forEach.call(el.querySelectorAll("[data-i]"), function (b) {
      var i = +b.getAttribute("data-i"), n = s[i];
      var isStore = i === 6 || i === 13;
      paintSeeds(b.firstChild, n, isStore);
      b.lastChild.textContent = String(n);
      b.classList.toggle("hot", i === hot);
      b.classList.toggle("last", hot < 0 && !!lastRes && i === lastRes.r.last && !game.done);
      b.classList.toggle("cap", hot < 0 && !!lastRes && i === lastRes.r.cap);
      var owner = i < 7 ? 0 : 1;
      if (isStore) {
        b.setAttribute("role", "img");
        b.setAttribute("aria-label", t("store.label", { who: sideName(owner), seeds: n }));
        return;
      }
      var can = !busy && owner === next && n > 0;
      b.classList.toggle("can", can);
      if (can) b.removeAttribute("aria-disabled");
      else b.setAttribute("aria-disabled", "true");   // a tap explains why (R28)
      b.setAttribute("aria-label", t("pit.label", { who: sideName(owner), n: pitNo(i), seeds: n }));
    });
    el.classList.toggle("turn0", !busy && next === 0);
    el.classList.toggle("turn1", !busy && next === 1);
    fixTabStop();
  }

  // One tab stop on the board: the pit last focused, or the first
  // playable one while the focus is elsewhere.
  var focusPit = 0;
  function fixTabStop() {
    var el = $("board");
    var cur = el.querySelector('.pit[data-i="' + focusPit + '"]');
    if (!el.contains(document.activeElement)) cur = el.querySelector(".pit.can") || cur;
    if (!cur) return;
    focusPit = +cur.getAttribute("data-i");
    [].forEach.call(el.querySelectorAll(".pit"), function (b) { b.tabIndex = b === cur ? 0 : -1; });
  }

  function shake(i) {
    var b = $("board").querySelector('[data-i="' + i + '"]');
    if (!b || reducedMotion()) return;
    b.classList.remove("shake");
    void b.offsetWidth;
    b.classList.add("shake");
  }

  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
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

  function resultDialog(w) {
    if (!game || !game.done) return;            // undone / replaced meanwhile
    var dlg = makeDialog("mancala-result");
    var ai = game.mode === "ai";
    dlg.appendChild(el("div", "dlg-title",
      t("res.title") + (ai ? " · " + t("level." + game.lv) : "")));
    var hero = w < 0 ? t("res.draw")
      : ai ? t(w === game.ai ? "res.ailose" : "res.youwin")
      : t("res.pwin", { player: t("player." + (w + 1)) });
    dlg.appendChild(el("div", "dlg-hero", hero));
    dlg.appendChild(row(t("res.score"), sideName(0) + " " + board.s[6] + " – " + board.s[13] + " " + sideName(1)));
    if (ai) {
      dlg.appendChild(row(t("stats.head"), totals(game.lv).join(" · ")));
    } else {
      dlg.appendChild(row(t("res.series"), game.series[0] + " – " + game.series[1]));
    }
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("res.close"), "", function () { dlg.close(); }));
    var again = button(t("res.again"), "primary", function () { dlg.close(); newGame(false, true); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    again.focus();
  }

  function statsDialog() {
    var dlg = makeDialog("mancala-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    LEVELS.forEach(function (lv) {
      var s = totals(lv);
      if (s[0] + s[1] + s[2]) empty = false;
      dlg.appendChild(row(t("level." + lv), s.join(" · ")));
    });
    if (game && (game.series[0] || game.series[1])) {
      empty = false;
      dlg.appendChild(el("div", "dlg-sub", t("mode.duo")));
      dlg.appendChild(row(t("res.series"), game.series[0] + " – " + game.series[1]));
    }
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
    var dlg = makeDialog("mancala-confirm");
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
    data = mergeMancala(data, data);
    save();
    if (game) { game.series = [0, 0]; saveSession(); }
    renderStatus();
    showToast(t("toast.reset"));
  }

  // ---------- 9. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "mancala", title: String(text) })) return;
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
      if (kind === "seed") tone(620 + randInt(120), 0, 0.05, "triangle", 0.08);
      else if (kind === "sow") tone(440, 0, 0.09, "triangle", 0.14);
      else if (kind === "win") {
        [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
      } else if (kind === "end") { tone(392, 0, 0.18, "sine"); tone(294, 0.16, 0.3, "sine"); }
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Toolbar icons (R9: injected by JS) ----------
  var UI_ICONS = {
    new:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    undo:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
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
  // 1–6: the pit of the side to move, counted from the left of the
  // screen. Arrows move between pits, Enter / Space sows (buttons).
  function pitForKey(n, p) { return p === 0 ? n - 1 : 13 - n; }

  function focusPitEl(i) {
    var b = $("board").querySelector('.pit[data-i="' + i + '"]');
    if (!b) return;
    focusPit = i;
    [].forEach.call($("board").querySelectorAll(".pit"), function (x) { x.tabIndex = x === b ? 0 : -1; });
    b.focus();
  }

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.shiftKey) return;
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") { e.preventDefault(); undo(); return; }
      if (e.ctrlKey || e.metaKey) return;               // never steal OS combos
      if (e.repeat) return;
      if (e.code === "KeyN") { e.preventDefault(); newGame(true, true); return; }
      if (e.code === "KeyZ") { e.preventDefault(); undo(); return; }
      var m = /^(?:Digit|Numpad)([1-6])$/.exec(e.code);
      if (m) { e.preventDefault(); play(pitForKey(+m[1], board.next < 0 ? 0 : board.next)); return; }
      var a = document.activeElement;
      var onPit = a && a.classList && a.classList.contains("pit");
      if (onPit && /^Arrow/.test(e.key)) {
        e.preventDefault();
        var i = +a.getAttribute("data-i"), top = i >= 7;
        // screen order: bottom 0…5 left → right, top 12…7 left → right
        var col = top ? 12 - i : i;
        if (e.key === "ArrowLeft") col = Math.max(0, col - 1);
        else if (e.key === "ArrowRight") col = Math.min(5, col + 1);
        else if (e.key === "ArrowUp") top = true;
        else if (e.key === "ArrowDown") top = false;
        focusPitEl(top ? 12 - col : col);
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
    api.registerSlice("mancala", sliceGet, sliceSet, STORAGE_KEY, mergeMancala);
  }

  function sliceGet() {
    return mergeMancala(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeMancala(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (game) renderStatus();   // no toast on merge (sync feedback = taskbar dot)
  }

  // ---------- 13. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    [].forEach.call($("seeds-select").options, function (o) {
      o.textContent = t("seeds.n", { n: o.value });
    });
    [["first-select", "first.label"], ["seeds-select", "seeds.label"]].forEach(function (x) {
      $(x[0]).setAttribute("aria-label", t(x[1]));
      $(x[0]).title = t(x[1]);
    });
  }

  function paintStatic() {
    [["new-btn", "new", "btn.new"], ["undo-btn", "undo", "btn.undo"],
     ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    paintSfxBtn();
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#mode-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () {
        var m = b.getAttribute("data-mode");
        if (game && m === game.mode && !game.done) return;   // visible active state
        prefs.mode = m; savePrefs(); newGame(true, true);
      });
    });
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () {
        var lv = b.getAttribute("data-level");
        if (game && lv === game.lv && !game.done) return;
        prefs.lv = lv; savePrefs(); newGame(true, true);
      });
    });
    $("first-select").addEventListener("change", function () {
      prefs.first = $("first-select").value;
      prefs.nextAi = prefs.first === "ai";
      savePrefs();
      newGame(true, true);
      $("first-select").blur();
    });
    $("seeds-select").addEventListener("change", function () {
      prefs.seeds = +$("seeds-select").value;
      savePrefs();
      newGame(true, true);
      $("seeds-select").blur();
    });
    $("new-btn").addEventListener("click", function () { newGame(true, true); $("new-btn").blur(); });
    $("undo-btn").addEventListener("click", function () { undo(); });
    $("stats-btn").addEventListener("click", statsDialog);
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("sow");   // audible confirmation when turned on
    });
    $("board").addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".pit");
      if (b) play(+b.getAttribute("data-i"));
    });
    $("board").addEventListener("focusin", function (e) {
      var b = e.target.closest && e.target.closest(".pit");
      if (b) focusPit = +b.getAttribute("data-i");
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
    game = loadSession();
    if (game) {
      // The resumed game decides what the toolbar shows.
      prefs.mode = game.mode; prefs.lv = game.lv; prefs.seeds = game.seeds;
    } else {
      game = fresh(null);
      saveSession();
    }
    syncBoard();
    if (board.over) game.done = true;
    renderAll();
    maybeAi();   // a game left on the computer's turn continues
  }

  boot();
})();
