// ============================================================
// orOS Dots & Boxes — App logic (v1.0.0)
// Draw lines between dots; closing a box scores it and moves again.
//   - boards of 3×3, 4×4 or 5×5 boxes
//   - vs Computer, 3 levels: Easy (closes a box when it can, else a
//     random line) · Medium (+ never gives a third side while a safe
//     line exists; when none is left, gives away the fewest boxes) ·
//     Hard (+ chain play: in the endgame it keeps control with the
//     double-dealing move, leaving the last two boxes of a chain)
//   - who starts vs the computer: you / computer / take turns
//   - 2 players on one device, with a running series score
//   - undo (vs the computer back to your turn)
// Data:
//   - synced slice "dots" (oros-dots-data): results vs the computer
//     per level × size, as per-device counter rows (same join as
//     Connect 4) + a reset stamp br
//   - device-local (R10): oros-dots-prefs, oros-dots-session (the game
//     in progress and the 2-player series), oros-dots-device (counter
//     row id), oros-dots-sfx
// Sections:
//   1. Constants, i18n, helpers
//   2. Board model (geometry, replay)
//   3. Computer player
//   4. Synced data: load / save / normalize / merge (R5, R26)
//   5. Device-local prefs + session
//   6. Game flow (new, play, computer turn, undo, finish)
//   7. Render (toolbar, status, board)
//   8. Dialogs (result, records, confirm)
//   9. Toasts
//  10. Sound
//  11. Keyboard (arrows between lines, N, Z, Contract Β)
//  12. Sync slice + palette
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-dots-data";
  var PREFS_KEY   = "oros-dots-prefs";
  var SESSION_KEY = "oros-dots-session";
  var DEVICE_KEY  = "oros-dots-device";
  var SFX_KEY     = "oros-dots-sfx";
  var DATA_VER    = 1;

  var LEVELS = ["e", "m", "h"];
  var SIZES = [3, 4, 5];
  var MODES = ["ai", "duo"];
  var FIRSTS = ["you", "ai", "alt"];
  var AI_DELAY = 420, AI_CHAIN_DELAY = 260;   // ms per computer line
  var MARGIN = 0.5;                            // board margin, in box edges

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
      "size.label": "{n}×{n} boxes",
      "side.you": "You", "side.ai": "Computer",
      "player.1": "Player 1", "player.2": "Player 2",
      "turn.you": "Your turn", "turn.ai": "Computer is playing…",
      "turn.player": "{player}'s turn",
      "turn.win": "{who} won", "turn.youwin": "You won", "turn.draw": "Draw",
      "btn.new": "New game (N)", "btn.undo": "Undo (Z)",
      "btn.undoNone": "Nothing to undo",
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "board.label": "Board, {n}×{n} boxes",
      "ln.h": "Line, row {r}, between columns {a} and {b}",
      "ln.v": "Line, column {c}, between rows {a} and {b}",
      "ln.taken": "{line}, drawn",
      "live.box": "{who} closed {k} box(es)",
      "res.title": "Game over",
      "res.youwin": "You win!",
      "res.ailose": "The computer wins",
      "res.pwin": "{player} wins!",
      "res.draw": "It's a draw!",
      "res.again": "Play again",
      "res.close": "Close",
      "res.series": "Series",
      "res.boxes": "Boxes",
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
      "toast.taken": "That line is already drawn",
      "toast.wait": "The computer is playing",
      "toast.over": "The game is over: start a new one (N)"
    },
    el: {
      "mode.ai": "Με υπολογιστή", "mode.duo": "2 παίκτες",
      "level.e": "Εύκολο", "level.m": "Μεσαίο", "level.h": "Δύσκολο",
      "first.you": "Ξεκινάς εσύ", "first.ai": "Ξεκινά ο υπολογιστής", "first.alt": "Εναλλάξ",
      "first.label": "Πρώτη κίνηση",
      "size.label": "{n}×{n} κουτιά",
      "side.you": "Εσύ", "side.ai": "Υπολογιστής",
      "player.1": "Παίκτης 1", "player.2": "Παίκτης 2",
      "turn.you": "Σειρά σου", "turn.ai": "Παίζει ο υπολογιστής…",
      "turn.player": "Σειρά: {player}",
      "turn.win": "Κέρδισε: {who}", "turn.youwin": "Κέρδισες", "turn.draw": "Ισοπαλία",
      "btn.new": "Νέο παιχνίδι (N)", "btn.undo": "Αναίρεση (Z)",
      "btn.undoNone": "Δεν υπάρχει κίνηση για αναίρεση",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "board.label": "Ταμπλό, {n}×{n} κουτιά",
      "ln.h": "Γραμμή, σειρά {r}, ανάμεσα στις στήλες {a} και {b}",
      "ln.v": "Γραμμή, στήλη {c}, ανάμεσα στις σειρές {a} και {b}",
      "ln.taken": "{line}, τραβηγμένη",
      "live.box": "{who}: έκλεισε {k} κουτί/ιά",
      "res.title": "Τέλος",
      "res.youwin": "Κέρδισες!",
      "res.ailose": "Κέρδισε ο υπολογιστής",
      "res.pwin": "Νικητής: {player}!",
      "res.draw": "Ισοπαλία!",
      "res.again": "Ξανά",
      "res.close": "Κλείσιμο",
      "res.series": "Σειρά αγώνων",
      "res.boxes": "Κουτιά",
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
      "toast.taken": "Η γραμμή είναι ήδη τραβηγμένη",
      "toast.wait": "Παίζει ο υπολογιστής",
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

  // crypto RNG with rejection sampling (same as Dice / Memory / Connect 4)
  function randInt(n) {
    var buf = new Uint32Array(1);
    var lim = 0xFFFFFFFF - (0xFFFFFFFF % n);
    while (true) {
      crypto.getRandomValues(buf);
      if (buf[0] < lim) return buf[0] % n;
    }
  }
  function pick(arr) { return arr[randInt(arr.length)]; }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("dots.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Board model ----------
  // n boxes per side. Horizontal line (r, c), r 0..n, c 0..n-1, has id
  // r*n + c; vertical line (r, c), r 0..n-1, c 0..n, has id
  // H + r*(n+1) + c, with H = n(n+1). Box (r, c) has id r*n + c.
  var GEO = {};
  function geo(n) {
    if (GEO[n]) return GEO[n];
    var H = n * (n + 1), L = 2 * H, boxLines = [], lineBoxes = [];
    for (var l = 0; l < L; l++) lineBoxes.push([]);
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        var b = r * n + c;
        var sides = [r * n + c, (r + 1) * n + c, H + r * (n + 1) + c, H + r * (n + 1) + c + 1];
        boxLines.push(sides);
        sides.forEach(function (s) { lineBoxes[s].push(b); });
      }
    }
    GEO[n] = { n: n, H: H, L: L, boxLines: boxLines, lineBoxes: lineBoxes };
    return GEO[n];
  }

  // Count of drawn sides per box.
  function sideCounts(g, drawn) {
    var cnt = [];
    for (var b = 0; b < g.boxLines.length; b++) {
      var k = 0;
      for (var i = 0; i < 4; i++) if (drawn[g.boxLines[b][i]]) k++;
      cnt.push(k);
    }
    return cnt;
  }

  // Replay a move list. Returns who drew each line (1/2), who owns each
  // box, the scores, the mover of every move and who plays next.
  function replay(n, moves, starter) {
    var g = geo(n), drawn = [], owner = [], movers = [], p = starter, i;
    for (i = 0; i < g.L; i++) drawn.push(0);
    for (i = 0; i < n * n; i++) owner.push(0);
    var score = [0, 0], last = [];
    for (var m = 0; m < moves.length; m++) {
      var l = moves[m];
      drawn[l] = p;
      movers.push(p);
      var closed = [];
      g.lineBoxes[l].forEach(function (b) {
        var full = true;
        for (var k = 0; k < 4; k++) if (!drawn[g.boxLines[b][k]]) full = false;
        if (full) { owner[b] = p; score[p - 1]++; closed.push(b); }
      });
      last = closed;
      if (!closed.length) p = 3 - p;               // a closed box moves again
    }
    return { n: n, drawn: drawn, owner: owner, score: score, movers: movers,
             next: p, lastBoxes: last, full: moves.length === g.L };
  }

  // ---------- 3. Computer player ----------
  // Lines that close a box right now.
  function closingLines(g, drawn, cnt) {
    var out = [];
    for (var b = 0; b < cnt.length; b++) {
      if (cnt[b] !== 3) continue;
      for (var k = 0; k < 4; k++) {
        var l = g.boxLines[b][k];
        if (!drawn[l] && out.indexOf(l) < 0) out.push(l);
      }
    }
    return out;
  }
  // Free lines that give no box its third side.
  function safeLines(g, drawn, cnt) {
    var out = [];
    for (var l = 0; l < g.L; l++) {
      if (drawn[l]) continue;
      var ok = true;
      g.lineBoxes[l].forEach(function (b) { if (cnt[b] >= 2) ok = false; });
      if (ok) out.push(l);
    }
    return out;
  }
  // Boxes the next player takes by closing greedily after `line` is
  // drawn (without the line itself closing anything for the mover).
  function boxesGiven(g, drawn, line) {
    var d = drawn.slice();
    d[line] = 1;
    var cnt = sideCounts(g, d), taken = 0, more = true;
    while (more) {
      more = false;
      for (var b = 0; b < cnt.length; b++) {
        if (cnt[b] !== 3) continue;
        for (var k = 0; k < 4; k++) {
          var l = g.boxLines[b][k];
          if (d[l]) continue;
          d[l] = 1;
          g.lineBoxes[l].forEach(function (x) { cnt[x]++; if (cnt[x] === 4) taken++; });
          more = true;
          break;
        }
      }
    }
    return taken;
  }
  // The cheapest sacrifice: the line that gives away the fewest boxes.
  function cheapestGift(g, drawn) {
    var best = Infinity, ties = [];
    for (var l = 0; l < g.L; l++) {
      if (drawn[l]) continue;
      var k = boxesGiven(g, drawn, l);
      if (k < best) { best = k; ties = [l]; }
      else if (k === best) ties.push(l);
    }
    return ties.length ? pick(ties) : -1;
  }

  // Hard: in the endgame (no safe line left) a chain being taken is
  // closed up to its last two boxes; the computer then draws the far
  // line of that pair (double-dealing), so the opponent takes the two
  // boxes and must open the next chain. Worth it only while a long
  // chain (3+) remains elsewhere.
  function doubleDeal(g, drawn, cnt) {
    // The pair: box a (3 sides) next to box b (2 sides), sharing line s.
    for (var a = 0; a < cnt.length; a++) {
      if (cnt[a] !== 3) continue;
      var s = -1;
      for (var k = 0; k < 4; k++) if (!drawn[g.boxLines[a][k]]) s = g.boxLines[a][k];
      var nb = g.lineBoxes[s].filter(function (x) { return x !== a; });
      if (nb.length !== 1 || cnt[nb[0]] !== 2) continue;
      var b = nb[0];
      var far = g.boxLines[b].filter(function (l) { return !drawn[l] && l !== s; });
      if (far.length !== 1) continue;
      var e = far[0];
      // the far line must end the chain: its other box (if any) must
      // not become capturable, or the pair is not the end of the chain
      var other = g.lineBoxes[e].filter(function (x) { return x !== b; });
      if (other.length && cnt[other[0]] >= 2) continue;
      // anything else on the board still open to capture? then not yet
      var d = drawn.slice();
      d[s] = 1; d[e] = 1;
      var c2 = sideCounts(g, d);
      var elsewhere = false;
      for (var x = 0; x < c2.length; x++) if (x !== a && x !== b && c2[x] === 3) elsewhere = true;
      if (elsewhere) continue;
      // keep control only if a long chain is left for later
      if (longestChainLeft(g, d, c2, [a, b]) >= 3) return e;
    }
    return -1;
  }
  // Size of the largest group of open boxes (≥ 2 sides drawn already
  // count as chain links) once the pair is gone.
  function longestChainLeft(g, drawn, cnt, skip) {
    var seen = {}, best = 0;
    skip.forEach(function (x) { seen[x] = true; });
    for (var b0 = 0; b0 < cnt.length; b0++) {
      if (seen[b0] || cnt[b0] === 4 || cnt[b0] < 2) continue;
      var stack = [b0], size = 0;
      seen[b0] = true;
      while (stack.length) {
        var b = stack.pop();
        size++;
        g.boxLines[b].forEach(function (l) {
          if (drawn[l]) return;
          g.lineBoxes[l].forEach(function (x) {
            if (!seen[x] && cnt[x] >= 2 && cnt[x] < 4) { seen[x] = true; stack.push(x); }
          });
        });
      }
      if (size > best) best = size;
    }
    return best;
  }

  function chooseLine(n, drawnIn, level) {
    var g = geo(n);
    var drawn = drawnIn.map(function (v) { return v ? 1 : 0; });
    var cnt = sideCounts(g, drawn);
    var free = [];
    for (var l = 0; l < g.L; l++) if (!drawn[l]) free.push(l);
    if (!free.length) return -1;
    var closing = closingLines(g, drawn, cnt);
    if (level === "e") return closing.length ? pick(closing) : pick(free);
    var safe = safeLines(g, drawn, cnt);
    if (closing.length) {
      if (level === "h" && !safe.length) {
        var dd = doubleDeal(g, drawn, cnt);
        if (dd >= 0) return dd;
      }
      return pick(closing);
    }
    if (safe.length) return pick(safe);
    return cheapestGift(g, drawn);
  }

  // ---------- 4. Synced data ----------
  // data = { ver: 1, br, rows: { <deviceId>: { b: <epoch>, s: { "<lv><n>": [w,l,d] } } } }
  // Same join as Connect 4: each device grows only its own row; merge
  // = newer epoch, equal epochs per-cell max; rows older than br drop.
  var KEYS = [];
  LEVELS.forEach(function (lv) { SIZES.forEach(function (n) { KEYS.push(lv + n); }); });

  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normRow(row) {
    if (!row || typeof row !== "object" || !isInt(row.b) || row.b < 0) return null;
    var s = {}, any = false;
    KEYS.forEach(function (k) {
      var v = row.s && row.s[k];
      if (Array.isArray(v) && v.length === 3 &&
          isInt(v[0]) && isInt(v[1]) && isInt(v[2]) && v[0] >= 0 && v[1] >= 0 && v[2] >= 0) {
        s[k] = [v[0], v[1], v[2]];
        any = true;
      }
    });
    return any ? { b: row.b, s: s } : null;
  }

  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var s = {};
    KEYS.forEach(function (k) {
      var a = x.s[k], c = y.s[k];
      if (!a && !c) return;
      if (!a) { s[k] = c.slice(); return; }
      if (!c) { s[k] = a.slice(); return; }
      s[k] = [Math.max(a[0], c[0]), Math.max(a[1], c[1]), Math.max(a[2], c[2])];
    });
    return { b: x.b, s: s };
  }

  function mergeDots(A, B) {
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
      KEYS.forEach(function (k) { if (r.s[k]) s[k] = r.s[k]; });
      sorted[id] = { b: r.b, s: s };
    });
    return { ver: DATA_VER, br: br, rows: sorted };
  }

  function totals(key) {
    var out = [0, 0, 0];
    Object.keys(data.rows).forEach(function (id) {
      var v = data.rows[id].s[key];
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
          data = mergeDots(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] dots: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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
  function countResult(key, res) {
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // new epoch after a reset
    var v = row.s[key] ? row.s[key].slice() : [0, 0, 0];
    v[res]++;
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    row.s[key] = v;
    data.rows[deviceId] = row;
    data = mergeDots(data, data);
    save();
  }

  // ---------- 5. Device-local prefs + session ----------
  var prefs = { mode: "ai", lv: "m", n: 4, first: "you", nextAi: false };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (MODES.indexOf(p.mode) >= 0) prefs.mode = p.mode;
        if (LEVELS.indexOf(p.lv) >= 0) prefs.lv = p.lv;
        if (SIZES.indexOf(p.n) >= 0) prefs.n = p.n;
        if (FIRSTS.indexOf(p.first) >= 0) prefs.first = p.first;
        prefs.nextAi = p.nextAi === true;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = { mode, lv, n, starter: 1|2, ai: 0|2, moves: [lineId…], done, series: [p1, p2] }
  var game = null, board = null;

  function validSession(g) {
    if (!g || typeof g !== "object" || MODES.indexOf(g.mode) < 0 ||
        LEVELS.indexOf(g.lv) < 0 || SIZES.indexOf(g.n) < 0 ||
        (g.starter !== 1 && g.starter !== 2) || (g.ai !== 0 && g.ai !== 2) ||
        !Array.isArray(g.moves) || !Array.isArray(g.series) || g.series.length !== 2 ||
        !isInt(g.series[0]) || !isInt(g.series[1])) return false;
    var L = geo(g.n).L, seen = {};
    if (g.moves.length > L) return false;
    for (var i = 0; i < g.moves.length; i++) {
      var l = g.moves[i];
      if (!isInt(l) || l < 0 || l >= L || seen[l]) return false;
      seen[l] = true;
    }
    return true;
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
  var freshBoxes = [];

  function fresh(series) {
    var g = { mode: prefs.mode, lv: prefs.lv, n: prefs.n, starter: 1, ai: 0, moves: [],
              done: false, series: series || [0, 0] };
    if (g.mode === "ai") {
      g.ai = 2;
      var aiFirst = prefs.first === "ai" || (prefs.first === "alt" && prefs.nextAi);
      g.starter = aiFirst ? 2 : 1;
      if (prefs.first === "alt") { prefs.nextAi = !prefs.nextAi; savePrefs(); }
    } else if (game && game.mode === "duo") {
      g.starter = 3 - game.starter;                // 2 players: starts alternate
    }
    return g;
  }

  function inProgress() { return !!(game && !game.done && game.moves.length > 0); }

  // A game in progress is never lost silently: Undo toast (R14).
  function newGame(announce, keepSeries) {
    var prev = inProgress() ? JSON.parse(JSON.stringify(game)) : null;
    var prevPrefs = JSON.parse(JSON.stringify(prefs));
    cancelAi();
    var series = (keepSeries && game && game.mode === "duo" && prefs.mode === "duo" &&
                  game.n === prefs.n) ? game.series.slice() : [0, 0];
    game = fresh(series);
    saveSession();
    syncBoard();
    renderAll(true);
    maybeAi();
    if (prev) {
      undoToast(t("toast.newgame"), function () {
        cancelAi();
        prefs = prevPrefs;
        savePrefs();
        game = prev;
        saveSession();
        syncBoard();
        renderAll(true);
        maybeAi();
      });
    } else if (announce) {
      live(t("toast.newgame"));
    }
  }

  function syncBoard() { board = replay(game.n, game.moves, game.starter); }

  function aiTurn() { return game.mode === "ai" && !game.done && board.next === game.ai; }

  function cancelAi() { if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; } }

  function maybeAi() {
    if (!aiTurn() || aiTimer) return;
    renderStatus();
    // a box the computer just closed → it keeps going a little faster
    var lastMover = board.movers[board.movers.length - 1];
    var delay = (lastMover === game.ai) ? AI_CHAIN_DELAY : AI_DELAY;
    aiTimer = setTimeout(function () {
      aiTimer = null;
      if (!aiTurn()) return;
      var l = chooseLine(game.n, board.drawn, game.lv);
      if (l >= 0) place(l);
    }, delay);
  }

  function play(l) {
    if (!game) return;
    if (game.done) { showToast(t("toast.over")); return; }          // R28
    if (aiTurn()) { showToast(t("toast.wait")); return; }
    if (board.drawn[l]) { showToast(t("toast.taken")); return; }
    place(l);
  }

  function place(l) {
    var p = board.next;
    game.moves.push(l);
    syncBoard();
    freshBoxes = board.lastBoxes.slice();
    if (freshBoxes.length) {
      sfx("box");
      live(t("live.box", { who: sideName(p), k: freshBoxes.length }));
    } else {
      sfx("line");
    }
    if (board.full) { finish(); return; }
    saveSession();
    renderAll(false);
    maybeAi();
  }

  // Undo: one line with 2 players; vs the computer, back to your turn
  // (taking back every computer line since your last one).
  function humanMoves() {
    if (!game || game.mode !== "ai") return game ? game.moves.length : 0;
    return board.movers.filter(function (p) { return p !== game.ai; }).length;
  }
  function canUndo() {
    if (!game || game.done || !game.moves.length) return false;
    return game.mode === "duo" || humanMoves() > 0;
  }
  function undo() {
    if (!canUndo()) { showToast(t("btn.undoNone")); return; }       // R28
    cancelAi();
    if (game.mode === "duo") {
      game.moves.pop();
    } else {
      // drop the computer's lines, then your last line
      while (board.movers.length && board.movers[board.movers.length - 1] === game.ai) {
        game.moves.pop(); syncBoard();
      }
      game.moves.pop();
    }
    syncBoard();
    freshBoxes = [];
    saveSession();
    renderAll(true);
    maybeAi();
  }

  function finish() {
    game.done = true;
    var s = board.score, winner = s[0] === s[1] ? 0 : (s[0] > s[1] ? 1 : 2);
    if (game.mode === "duo") {
      if (winner) game.series[winner - 1]++;
    } else {
      countResult(game.lv + game.n, winner === 0 ? 2 : (winner === game.ai ? 1 : 0));
    }
    saveSession();
    renderAll(false);
    sfx(winner && !(game.mode === "ai" && winner === game.ai) ? "win" : "end");
    setTimeout(function () { resultDialog(winner); }, 700);
  }

  // ---------- 7. Render ----------
  function sideName(p) {
    if (game && game.mode === "ai") return t(p === game.ai ? "side.ai" : "side.you");
    return t("player." + p);
  }

  function renderAll(rebuild) {
    renderToolbar();
    renderStatus();
    if (rebuild) buildBoard(); else renderBoard();
  }

  function segActive(sel, attr, val) {
    [].forEach.call(document.querySelectorAll(sel + " .seg-btn"), function (b) {
      var on = b.getAttribute(attr) === String(val);
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function renderToolbar() {
    var mode = game ? game.mode : prefs.mode;
    segActive("#mode-seg", "data-mode", mode);
    segActive("#level-seg", "data-level", game ? game.lv : prefs.lv);
    segActive("#size-seg", "data-size", game ? game.n : prefs.n);
    $("level-seg").hidden = mode !== "ai";
    $("first-select").hidden = mode !== "ai";
    $("first-select").value = prefs.first;
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
    $("score0").textContent = String(board.score[0]);
    $("score1").textContent = String(board.score[1]);
    var next = board.next, txt;
    if (game.done) {
      var s = board.score, w = s[0] === s[1] ? 0 : (s[0] > s[1] ? 1 : 2);
      txt = !w ? t("turn.draw") : (ai && w !== game.ai) ? t("turn.youwin") : t("turn.win", { who: sideName(w) });
    } else if (ai) {
      txt = next === game.ai ? t("turn.ai") : t("turn.you");
    } else {
      txt = t("turn.player", { player: t("player." + next) });
    }
    $("turn").textContent = txt;
    $("side0").classList.toggle("turn", !game.done && next === 1);
    $("side1").classList.toggle("turn", !game.done && next === 2);
  }

  function layoutBoard() {
    var wrap = $("board-wrap"), el = $("board");
    var cs = getComputedStyle(wrap);
    var W = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var H = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (W <= 0 || H <= 0 || !game) return;
    var size = Math.floor(Math.max(200, Math.min(W, H, 640)));
    var unit = size / (game.n + 2 * MARGIN);
    el.style.setProperty("--size", size + "px");
    el.style.setProperty("--stroke", Math.max(4, Math.round(unit * 0.09)) + "px");
    el.style.setProperty("--dot", Math.max(8, Math.round(unit * 0.16)) + "px");
  }

  // % position of grid point (r, c).
  function pct(v) { return ((v + MARGIN) / (game.n + 2 * MARGIN) * 100).toFixed(4) + "%"; }
  function span(v) { return (v / (game.n + 2 * MARGIN) * 100).toFixed(4) + "%"; }

  function lineLabel(l) {
    var g = geo(game.n), n = game.n;
    if (l < g.H) {
      var r = Math.floor(l / n), c = l % n;
      return t("ln.h", { r: r + 1, a: c + 1, b: c + 2 });
    }
    var k = l - g.H, r2 = Math.floor(k / (n + 1)), c2 = k % (n + 1);
    return t("ln.v", { c: c2 + 1, a: r2 + 1, b: r2 + 2 });
  }

  // Line centres in box units (for arrow-key navigation).
  var centres = [];

  function buildBoard() {
    var el = $("board"), g = geo(game.n), n = game.n;
    el.innerHTML = "";
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", t("board.label", { n: n }));
    centres = [];
    for (var b = 0; b < n * n; b++) {
      var bx = document.createElement("div");
      bx.className = "box";
      bx.setAttribute("data-b", String(b));
      var br = Math.floor(b / n), bc = b % n;
      bx.style.left = pct(bc + 0.12); bx.style.top = pct(br + 0.12);
      bx.style.width = span(0.76); bx.style.height = span(0.76);
      el.appendChild(bx);
    }
    for (var l = 0; l < g.L; l++) {
      var btn = document.createElement("button");
      btn.type = "button";
      var r, c;
      if (l < g.H) {
        r = Math.floor(l / n); c = l % n;
        btn.className = "ln h";
        btn.style.left = pct(c); btn.style.top = pct(r - 0.5);
        centres.push([c + 0.5, r]);
      } else {
        var k = l - g.H;
        r = Math.floor(k / (n + 1)); c = k % (n + 1);
        btn.className = "ln v";
        btn.style.left = pct(c - 0.5); btn.style.top = pct(r);
        centres.push([c, r + 0.5]);
      }
      btn.style.width = span(1); btn.style.height = span(1);   // a diamond (CSS clip)
      btn.setAttribute("data-l", String(l));
      btn.tabIndex = (l === focusLine) ? 0 : -1;
      btn.appendChild(document.createElement("span")).className = "st";
      el.appendChild(btn);
    }
    for (var dr = 0; dr <= n; dr++) {
      for (var dc = 0; dc <= n; dc++) {
        var dot = document.createElement("span");
        dot.className = "dot";
        dot.style.left = pct(dc); dot.style.top = pct(dr);
        el.appendChild(dot);
      }
    }
    if (focusLine >= g.L) focusLine = 0;
    layoutBoard();
    renderBoard();
  }

  function renderBoard() {
    var el = $("board"), g = geo(game.n);
    el.classList.toggle("over", !!game.done);
    el.classList.toggle("t1", board.next === 1);
    el.classList.toggle("t2", board.next === 2);
    var lastLine = game.moves.length ? game.moves[game.moves.length - 1] : -1;
    var lines = el.querySelectorAll(".ln");
    var blocked = game.done || aiTurn();
    for (var l = 0; l < lines.length; l++) {
      var who = board.drawn[l], btn = lines[l];
      var cls = "ln " + (l < g.H ? "h" : "v") + (who ? " p" + who : "") + (l === lastLine ? " last" : "");
      if (btn.className !== cls) btn.className = cls;
      if (who || blocked) btn.setAttribute("aria-disabled", "true");
      else btn.removeAttribute("aria-disabled");
      btn.setAttribute("aria-label", who ? t("ln.taken", { line: lineLabel(l) }) : lineLabel(l));
    }
    var boxes = el.querySelectorAll(".box");
    for (var b = 0; b < boxes.length; b++) {
      var o = board.owner[b], bx = boxes[b];
      var bcls = "box" + (o ? " o" + o : "") + (freshBoxes.indexOf(b) >= 0 ? " fresh" : "");
      if (bx.className !== bcls) bx.className = bcls;
      if (o && !bx.firstChild) bx.appendChild(document.createElement("i")).className = "mark";
      if (!o && bx.firstChild) bx.removeChild(bx.firstChild);
    }
    freshBoxes = [];
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

  function resultDialog(winner) {
    if (!game || !game.done) return;           // undone / replaced meanwhile
    var dlg = makeDialog("db-result");
    var ai = game.mode === "ai";
    dlg.appendChild(el("div", "dlg-title", t("res.title") + " · " + game.n + "×" + game.n +
      (ai ? " · " + t("level." + game.lv) : "")));
    var hero = !winner ? t("res.draw")
      : ai ? t(winner === game.ai ? "res.ailose" : "res.youwin")
      : t("res.pwin", { player: t("player." + winner) });
    dlg.appendChild(el("div", "dlg-hero", hero));
    dlg.appendChild(row(t("res.boxes"), board.score[0] + " – " + board.score[1]));
    if (ai) {
      dlg.appendChild(row(t("stats.head"), totals(game.lv + game.n).join(" · ")));
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
    var dlg = makeDialog("db-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    var empty = true;
    LEVELS.forEach(function (lv) {
      dlg.appendChild(el("div", "dlg-sub", t("level." + lv) + " · " + t("stats.head")));
      SIZES.forEach(function (n) {
        var s = totals(lv + n);
        if (s[0] + s[1] + s[2]) empty = false;
        dlg.appendChild(row(t("size.label", { n: n }), s.join(" · ")));
      });
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
    var dlg = makeDialog("db-confirm");
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

  function resetRecords() {
    data.br = Math.max(Date.now(), data.br + 1);
    data = mergeDots(data, data);
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
          n.transient({ ns: "dots", title: String(text) })) return;
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
      if (kind === "line") tone(520, 0, 0.06, "triangle", 0.12);
      else if (kind === "box") { tone(660, 0, 0.1, "sine"); tone(880, 0.08, 0.16, "sine"); }
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
  var focusLine = 0;
  function focusLineAt(l) {
    var lines = $("board").querySelectorAll(".ln");
    if (!lines[l]) return;
    if (lines[focusLine]) lines[focusLine].tabIndex = -1;
    focusLine = l;
    lines[l].tabIndex = 0;
    lines[l].focus();
  }
  // The nearest line in the arrow's direction (by centre, box units).
  function lineToward(from, dx, dy) {
    var o = centres[from], best = -1, bestD = Infinity;
    for (var l = 0; l < centres.length; l++) {
      if (l === from) continue;
      var vx = centres[l][0] - o[0], vy = centres[l][1] - o[1];
      var along = vx * dx + vy * dy;
      if (along <= 0.01) continue;
      var across = Math.abs(vx * dy - vy * dx);
      if (across > along + 0.01) continue;           // within a 45° cone
      var d = along + across * 2;
      if (d < bestD) { bestD = d; best = l; }
    }
    return best;
  }

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.shiftKey) return;
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") { e.preventDefault(); undo(); return; }
      if (e.ctrlKey || e.metaKey) return;               // never steal OS combos
      if (e.code === "KeyN") { e.preventDefault(); newGame(true, true); return; }
      if (e.code === "KeyZ") { e.preventDefault(); undo(); return; }
      var dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      var a = document.activeElement;
      if (dir && a && a.classList && a.classList.contains("ln")) {
        e.preventDefault();
        var next = lineToward(+a.getAttribute("data-l"), dir[0], dir[1]);
        if (next >= 0) focusLineAt(next);
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
    api.registerSlice("dots", sliceGet, sliceSet, STORAGE_KEY, mergeDots);
  }

  function sliceGet() {
    return mergeDots(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeDots(incoming, incoming);
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
    $("first-select").setAttribute("aria-label", t("first.label"));
    $("first-select").title = t("first.label");
    [].forEach.call(document.querySelectorAll("#size-seg .seg-btn"), function (b) {
      var lbl = t("size.label", { n: b.getAttribute("data-size") });
      b.setAttribute("aria-label", lbl);
      b.title = lbl;
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
    [].forEach.call(document.querySelectorAll("#size-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () {
        var n = +b.getAttribute("data-size");
        if (game && n === game.n && !game.done) return;
        prefs.n = n; savePrefs(); newGame(true, true);
      });
    });
    $("first-select").addEventListener("change", function () {
      prefs.first = $("first-select").value;
      prefs.nextAi = prefs.first === "ai";
      savePrefs();
      newGame(true, true);
      $("first-select").blur();
    });
    $("new-btn").addEventListener("click", function () { newGame(true, true); $("new-btn").blur(); });
    $("undo-btn").addEventListener("click", function () { undo(); });
    $("stats-btn").addEventListener("click", statsDialog);
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("box");   // audible confirmation when turned on
    });
    $("board").addEventListener("focusin", function (e) {
      var b = e.target.closest && e.target.closest(".ln");
      if (!b || b.tabIndex === 0) return;
      var lines = $("board").querySelectorAll(".ln");
      if (lines[focusLine]) lines[focusLine].tabIndex = -1;
      focusLine = +b.getAttribute("data-l");
      b.tabIndex = 0;
    });
    $("board").addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".ln");
      if (b) play(+b.getAttribute("data-l"));
    });

    var relayout = function () { layoutBoard(); };
    if (window.ResizeObserver) new ResizeObserver(relayout).observe($("board-wrap"));
    else window.addEventListener("resize", relayout);

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
      prefs.mode = game.mode; prefs.lv = game.lv; prefs.n = game.n;
    } else {
      game = fresh(null);
    }
    syncBoard();
    if (board.full) game.done = true;
    renderAll(true);
    maybeAi();   // a game left on the computer's turn continues
  }

  boot();
})();
