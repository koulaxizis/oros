// ============================================================
// orOS Mahjong — App logic (v1.0.0)
// Mahjong solitaire: take matching pairs of free tiles until the
// layout is empty. A tile is free when no tile lies on it and its left
// or its right side is open. Flowers match any flower, seasons any
// season. Every deal is solvable: it is built backwards, by removing
// pairs of free positions from the full layout and giving each pair a
// matching pair of faces.
//   - layouts Turtle (144 tiles), Pyramid (82) and Fortress (70, for
//     phones), each with its own records
//   - tap / click two tiles; arrows move a cursor over the free tiles,
//     Enter / Space takes it; H hint, U undo, S shuffle (stays
//     solvable), Z zoom, N new game
//   - with a mouse the whole layout always fits the screen; on a touch
//     screen a tile is never under 34 px wide, so the Turtle pans inside
//     the board area on a phone (Fortress, the phone default, and Pyramid
//     fit at 360 px); Zoom makes the tiles bigger and the board scrolls
//   - "no moves left" offers a shuffle; a game in progress resumes
// Data:
//   - synced slice "mahjong" (oros-mahjong-data): per layout the best
//     time (and when) and the number of wins, as per-device rows (each
//     device only grows its own row; merge = per-row join) + a reset
//     stamp br
//   - device-local (R10): oros-mahjong-prefs (layout, zoom),
//     oros-mahjong-session (the game in progress), oros-mahjong-device
//     (row id), oros-mahjong-sfx (sound on/off)
// Sections:
//   1. Constants, i18n, helpers
//   2. Game model (layouts, free rule, solvable deal, shuffle)
//   3. Tile faces (SVG)
//   4. Synced data: load / save / normalize / merge (R5, R26)
//   5. Device-local prefs + session
//   6. Game flow (new, pick, undo, hint, shuffle, win)
//   7. Render (toolbar, status, board)
//   8. Dialogs (result, no moves, records, confirm)
//   9. Toasts
//  10. Sound
//  11. Input (tap, keyboard, Contract Β)
//  12. Sync slice + palette
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-mahjong-data";
  var PREFS_KEY   = "oros-mahjong-prefs";
  var SESSION_KEY = "oros-mahjong-session";
  var DEVICE_KEY  = "oros-mahjong-device";
  var SFX_KEY     = "oros-mahjong-sfx";
  var DATA_VER    = 1;

  var LAYS = ["turtle", "pyramid", "fortress"];
  var MAX_TIME = 360000000;                  // 100 h: anything above is junk
  var FACES = 42;                            // 34 kinds ×4 + 4 flowers + 4 seasons
  var TILE_MAX = 64;                         // px, tile width at most (no zoom)
  var ZOOM = 1.7;
  var TOUCH_MIN = 34;                        // px, smallest tile on a touch screen
  var TOUCH_ZOOM = 48;                       // px, at least this with Zoom on touch

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
      "lay.turtle": "Turtle", "lay.pyramid": "Pyramid", "lay.fortress": "Fortress",
      "btn.new": "New game (N)",
      "btn.undo": "Undo (U)",
      "btn.hint": "Hint (H)",
      "btn.shuffle": "Shuffle (S)",
      "btn.zoom": "Zoom (Z)",
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "st.time": "Time", "st.left": "Tiles",
      "turn.start": "Take pairs of free tiles",
      "turn.pairs": "{n} pairs to take",
      "turn.one": "1 pair to take",
      "turn.none": "No moves left",
      "turn.won": "Cleared!",
      "board.label": "Mahjong board, {lay}",
      "tile.label": "{face}",
      "tile.blocked": "{face}, blocked",
      "f.dots": "{n} of dots", "f.bamboo": "{n} of bamboo", "f.chars": "{n} of characters",
      "f.windE": "East wind", "f.windS": "South wind", "f.windW": "West wind", "f.windN": "North wind",
      "f.red": "Red dragon", "f.green": "Green dragon", "f.white": "White dragon",
      "f.flower": "Flower {n}", "f.season": "Season {n}",
      "wind.letters": "ESWN",
      "live.sel": "Selected {face}",
      "live.pair": "Pair taken. {n} tiles left",
      "live.won": "Board cleared in {t}",
      "live.shuffled": "Tiles shuffled",
      "live.hint": "Hint: {face}",
      "res.title": "Cleared",
      "res.time": "Time",
      "res.best": "Best time",
      "res.wins": "Wins",
      "res.rec": "New best time!",
      "res.again": "Play again",
      "res.close": "Close",
      "stuck.title": "No moves left",
      "stuck.msg": "No free tiles match. Shuffle the tiles that are left (the game stays solvable), undo, or start again.",
      "stuck.shuffle": "Shuffle",
      "stuck.undo": "Undo",
      "stuck.new": "New game",
      "stats.title": "Records",
      "stats.head": "Best time · wins",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "confirm.reset": "Delete the records on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Records reset",
      "toast.newgame": "New game",
      "toast.layout": "Layout changed",
      "toast.undo": "Undo",
      "toast.noUndo": "Nothing to undo",
      "toast.blocked": "That tile is not free: it needs an open left or right side and nothing on top",
      "toast.noMatch": "These two tiles do not match",
      "toast.over": "This game is over: start a new one (N)",
      "toast.noShuffle": "No shuffle can solve this position: undo a few pairs or start again",
      "toast.shuffled": "Shuffled",
      "toast.save": "Could not save: storage is full"
    },
    el: {
      "lay.turtle": "Χελώνα", "lay.pyramid": "Πυραμίδα", "lay.fortress": "Φρούριο",
      "btn.new": "Νέο παιχνίδι (N)",
      "btn.undo": "Αναίρεση (U)",
      "btn.hint": "Βοήθεια (H)",
      "btn.shuffle": "Ανακάτεμα (S)",
      "btn.zoom": "Μεγέθυνση (Z)",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "st.time": "Χρόνος", "st.left": "Πλακίδια",
      "turn.start": "Πάρε ζευγάρια ελεύθερων πλακιδίων",
      "turn.pairs": "{n} ζευγάρια διαθέσιμα",
      "turn.one": "1 ζευγάρι διαθέσιμο",
      "turn.none": "Δεν υπάρχουν κινήσεις",
      "turn.won": "Καθάρισε!",
      "board.label": "Ταμπλό Μαντζόνγκ, {lay}",
      "tile.label": "{face}",
      "tile.blocked": "{face}, μπλοκαρισμένο",
      "f.dots": "{n} κύκλοι", "f.bamboo": "{n} μπαμπού", "f.chars": "{n} χαρακτήρες",
      "f.windE": "Ανατολικός άνεμος", "f.windS": "Νότιος άνεμος", "f.windW": "Δυτικός άνεμος", "f.windN": "Βόρειος άνεμος",
      "f.red": "Κόκκινος δράκος", "f.green": "Πράσινος δράκος", "f.white": "Λευκός δράκος",
      "f.flower": "Λουλούδι {n}", "f.season": "Εποχή {n}",
      "wind.letters": "ΑΝΔΒ",
      "live.sel": "Επιλέχθηκε: {face}",
      "live.pair": "Ζευγάρι. Μένουν {n} πλακίδια",
      "live.won": "Το ταμπλό καθάρισε σε {t}",
      "live.shuffled": "Τα πλακίδια ανακατεύτηκαν",
      "live.hint": "Βοήθεια: {face}",
      "res.title": "Καθάρισε",
      "res.time": "Χρόνος",
      "res.best": "Καλύτερος χρόνος",
      "res.wins": "Νίκες",
      "res.rec": "Νέο ρεκόρ χρόνου!",
      "res.again": "Ξανά",
      "res.close": "Κλείσιμο",
      "stuck.title": "Δεν υπάρχουν κινήσεις",
      "stuck.msg": "Κανένα ελεύθερο πλακίδιο δεν ταιριάζει. Ανακάτεψε όσα έμειναν (το παιχνίδι μένει λύσιμο), κάνε αναίρεση ή ξεκίνα από την αρχή.",
      "stuck.shuffle": "Ανακάτεμα",
      "stuck.undo": "Αναίρεση",
      "stuck.new": "Νέο παιχνίδι",
      "stats.title": "Ρεκόρ",
      "stats.head": "Καλύτερος χρόνος · νίκες",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.newgame": "Νέο παιχνίδι",
      "toast.layout": "Άλλαξε η διάταξη",
      "toast.undo": "Αναίρεση",
      "toast.noUndo": "Τίποτα για αναίρεση",
      "toast.blocked": "Το πλακίδιο δεν είναι ελεύθερο: θέλει ανοιχτή αριστερή ή δεξιά πλευρά και τίποτα από πάνω",
      "toast.noMatch": "Αυτά τα δύο πλακίδια δεν ταιριάζουν",
      "toast.over": "Το παιχνίδι τελείωσε: ξεκίνα νέο (N)",
      "toast.noShuffle": "Κανένα ανακάτεμα δεν λύνει αυτή τη θέση: αναίρεσε μερικά ζευγάρια ή ξεκίνα από την αρχή",
      "toast.shuffled": "Ανακατεύτηκαν",
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

  // crypto RNG in [0, 1)
  function rand() {
    var buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return (buf[0] * 2097152 + (buf[1] >>> 11)) / 9007199254740992;
  }

  function fmtTime(ms) {
    var s = Math.floor(Math.max(0, ms) / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    s = s % 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("mahjong.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Game model ----------
  // A position is [x, y, z] in half-tile units (a tile covers x…x+2,
  // y…y+2) and its layer z. Faces: 0–8 dots, 9–17 bamboo, 18–26
  // characters, 27–30 winds E S W N, 31–33 dragons red green white,
  // 34–37 flowers, 38–41 seasons.

  function buildLayouts() {
    var L = { turtle: [], pyramid: [], fortress: [] }, x, y;
    function add(k, tx, ty, z) { L[k].push([tx * 2, ty * 2, z]); }
    function rect(k, x0, x1, y0, y1, z) {
      for (var yy = y0; yy <= y1; yy++) for (var xx = x0; xx <= x1; xx++) add(k, xx, yy, z);
    }
    // Turtle: the classic 144 (87 + 36 + 16 + 4 + 1)
    [[1, 12], [3, 10], [2, 11], [1, 12], [1, 12], [2, 11], [3, 10], [1, 12]].forEach(function (r, yy) {
      for (x = r[0]; x <= r[1]; x++) add("turtle", x, yy, 0);
    });
    add("turtle", 0, 3.5, 0); add("turtle", 13, 3.5, 0); add("turtle", 14, 3.5, 0);
    rect("turtle", 4, 9, 1, 6, 1);
    rect("turtle", 5, 8, 2, 5, 2);
    rect("turtle", 6, 7, 3, 4, 3);
    add("turtle", 6.5, 3.5, 4);
    // Pyramid: 8 × 6, 6 × 4, 4 × 2 and two on top (82)
    rect("pyramid", 0, 7, 0, 5, 0);
    rect("pyramid", 1, 6, 1, 4, 1);
    rect("pyramid", 2, 5, 2, 3, 2);
    add("pyramid", 3, 2.5, 3); add("pyramid", 4, 2.5, 3);
    // Fortress: 6 × 7 with four corner towers and a keep (70), tall for phones
    rect("fortress", 0, 5, 0, 6, 0);
    rect("fortress", 0, 1, 0, 1, 1); rect("fortress", 4, 5, 0, 1, 1);
    rect("fortress", 0, 1, 5, 6, 1); rect("fortress", 4, 5, 5, 6, 1);
    rect("fortress", 2, 3, 2, 4, 1);
    add("fortress", 0.5, 0.5, 2); add("fortress", 4.5, 0.5, 2);
    add("fortress", 0.5, 5.5, 2); add("fortress", 4.5, 5.5, 2);
    add("fortress", 2.5, 2.5, 2); add("fortress", 2.5, 3.5, 2);
    for (y in L) L[y].sort(function (a, b) { return a[2] - b[2] || a[1] - b[1] || a[0] - b[0]; });
    return L;
  }
  var LAYOUTS = buildLayouts();

  // For each position: the tiles on it (any higher layer, overlapping)
  // and its left and right neighbours on the same layer.
  function topology(pos) {
    var n = pos.length, above = [], left = [], right = [];
    for (var i = 0; i < n; i++) {
      var a = [], l = [], r = [], p = pos[i];
      for (var j = 0; j < n; j++) {
        if (j === i) continue;
        var q = pos[j], dy = Math.abs(q[1] - p[1]);
        if (q[2] > p[2] && Math.abs(q[0] - p[0]) < 2 && dy < 2) a.push(j);
        else if (q[2] === p[2] && dy < 2) {
          if (q[0] === p[0] - 2) l.push(j);
          else if (q[0] === p[0] + 2) r.push(j);
        }
      }
      above.push(a); left.push(l); right.push(r);
    }
    return { n: n, above: above, left: left, right: right, z: pos.map(function (p) { return p[2]; }) };
  }

  function noneOn(list, on) {
    for (var k = 0; k < list.length; k++) if (on[list[k]]) return false;
    return true;
  }

  // Free: still on the board, nothing on it, and an open left or right side.
  function isFree(topo, on, i) {
    return !!on[i] && noneOn(topo.above[i], on) &&
      (noneOn(topo.left[i], on) || noneOn(topo.right[i], on));
  }

  // Flowers match any flower, seasons any season, the rest their twin.
  function matchGroup(f) { return f < 34 ? f : (f < 38 ? 34 : 38); }

  function shuffleArr(a, rnd) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1)), x = a[i];
      a[i] = a[j]; a[j] = x;
    }
    return a;
  }

  // One way to clear the tiles that are on: pairs of positions that are
  // free together, in removal order. Higher tiles go first more often
  // (stacks left for the end are the usual dead end). null when this
  // try got stuck.
  function removalOrder(topo, on, rnd) {
    var live = on.slice(), left = 0, out = [], i;
    for (i = 0; i < live.length; i++) if (live[i]) left++;
    while (left > 0) {
      var free = [];
      for (i = 0; i < live.length; i++) if (isFree(topo, live, i)) free.push(i);
      if (free.length < 2) return null;
      var a = pickTile(topo, free, -1, rnd), b = pickTile(topo, free, a, rnd);
      live[a] = 0; live[b] = 0;
      out.push([a, b]);
      left -= 2;
    }
    return out;
  }

  // A random free tile other than skip, weighted 1 + 2 × its layer.
  function pickTile(topo, free, skip, rnd) {
    var tot = 0, k;
    for (k = 0; k < free.length; k++) if (free[k] !== skip) tot += 1 + 2 * topo.z[free[k]];
    var r = rnd() * tot;
    for (k = 0; k < free.length; k++) {
      if (free[k] === skip) continue;
      r -= 1 + 2 * topo.z[free[k]];
      if (r < 0) return free[k];
    }
    for (k = free.length - 1; k >= 0; k--) if (free[k] !== skip) return free[k];
    return -1;
  }

  // The 72 pairs of a full set, shuffled: each kind twice, flowers and
  // seasons paired among themselves.
  function facePairs(rnd) {
    var out = [], f;
    for (f = 0; f < 34; f++) { out.push([f, f]); out.push([f, f]); }
    [34, 38].forEach(function (b) {
      var g = shuffleArr([b, b + 1, b + 2, b + 3], rnd);
      out.push([g[0], g[1]]); out.push([g[2], g[3]]);
    });
    return shuffleArr(out, rnd);
  }

  // Lay faces on the positions that are on, following a removal order.
  function assign(order, pairs, faces) {
    var out = faces.slice();
    order.forEach(function (p, k) { out[p[0]] = pairs[k][0]; out[p[1]] = pairs[k][1]; });
    return out;
  }

  function findOrder(topo, on, rnd, tries) {
    for (var k = 0; k < tries; k++) {
      var ord = removalOrder(topo, on, rnd);
      if (ord) return ord;
    }
    return null;
  }

  // A new solvable deal for a layout: faces per position.
  function deal(topo, rnd) {
    var on = [], i;
    for (i = 0; i < topo.n; i++) on.push(1);
    var ord = findOrder(topo, on, rnd, 500);
    if (!ord) return null;
    var faces = [];
    for (i = 0; i < topo.n; i++) faces.push(0);
    return assign(ord, facePairs(rnd).slice(0, topo.n / 2), faces);
  }

  // New faces for the tiles that are on, same multiset, still solvable.
  // null when no removal order exists for what is left.
  function reshuffle(topo, faces, on, rnd) {
    var groups = {}, pairs = [];
    for (var i = 0; i < topo.n; i++) {
      if (!on[i]) continue;
      var g = matchGroup(faces[i]);
      (groups[g] = groups[g] || []).push(faces[i]);
    }
    Object.keys(groups).forEach(function (g) {
      var list = shuffleArr(groups[g], rnd);
      for (var k = 0; k + 1 < list.length; k += 2) pairs.push([list[k], list[k + 1]]);
    });
    var ord = findOrder(topo, on, rnd, 400);
    if (!ord || ord.length !== pairs.length) return null;
    return assign(ord, shuffleArr(pairs, rnd), faces);
  }

  // Every pair of free tiles that match.
  function freePairs(topo, faces, on) {
    var byG = {}, out = [];
    for (var i = 0; i < topo.n; i++) {
      if (!isFree(topo, on, i)) continue;
      var g = matchGroup(faces[i]);
      (byG[g] = byG[g] || []).push(i);
    }
    Object.keys(byG).forEach(function (g) {
      var l = byG[g];
      for (var a = 0; a < l.length; a++) for (var b = a + 1; b < l.length; b++) out.push([l[a], l[b]]);
    });
    return out;
  }

  function countOn(on) {
    var c = 0;
    for (var i = 0; i < on.length; i++) if (on[i]) c++;
    return c;
  }

  var TOPO = {};
  function topoOf(lay) {
    if (!TOPO[lay]) TOPO[lay] = topology(LAYOUTS[lay]);
    return TOPO[lay];
  }

  // ---------- 3. Tile faces (SVG, 30 × 40) ----------
  var INK = "#1d2a52", RED = "#c0392b", GRN = "#1f8a4c", BLU = "#2c5fb3";

  function circle(x, y, r, fill) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + fill + '"/>'; }
  function dot(x, y, r, c) {
    return circle(x, y, r, c) + circle(x, y, r * 0.55, "#f7f2e2") + circle(x, y, r * 0.22, c);
  }
  function stick(x, y, h, c) {
    return '<rect x="' + (x - 2) + '" y="' + y + '" width="4" height="' + h + '" rx="1.6" fill="' + c + '"/>' +
      '<rect x="' + (x - 2.6) + '" y="' + (y + h / 2 - 0.7) + '" width="5.2" height="1.4" rx="0.7" fill="' + c + '"/>' +
      '<line x1="' + x + '" y1="' + (y + 1.5) + '" x2="' + x + '" y2="' + (y + h - 1.5) + '" stroke="#f7f2e2" stroke-width="0.7" opacity="0.7"/>';
  }
  function index(n, c) {
    return '<text x="3.2" y="8.6" font-size="7" font-weight="800" fill="' + (c || INK) + '" opacity="0.8" font-family="system-ui,sans-serif">' + n + '</text>';
  }
  var DOTS = [
    [[15, 20]],
    [[15, 11], [15, 29]],
    [[8, 9], [15, 20], [22, 31]],
    [[9, 11], [21, 11], [9, 29], [21, 29]],
    [[9, 10], [21, 10], [15, 20], [9, 30], [21, 30]],
    [[9, 9], [21, 9], [9, 20], [21, 20], [9, 31], [21, 31]],
    [[7, 7], [15, 11], [23, 15], [9, 24], [21, 24], [9, 33], [21, 33]],
    [[9, 7], [21, 7], [9, 15.7], [21, 15.7], [9, 24.3], [21, 24.3], [9, 33], [21, 33]],
    [[7, 9], [15, 9], [23, 9], [7, 20], [15, 20], [23, 20], [7, 31], [15, 31], [23, 31]]
  ];
  var DOT_C = [
    [RED], [BLU, GRN], [BLU, RED, GRN], [BLU, GRN, GRN, BLU], [BLU, GRN, RED, GRN, BLU],
    [GRN, GRN, RED, RED, RED, RED], [GRN, GRN, GRN, RED, RED, RED, RED],
    [BLU, BLU, BLU, BLU, BLU, BLU, BLU, BLU], [BLU, BLU, BLU, RED, RED, RED, GRN, GRN, GRN]
  ];
  var DOT_R = [8, 5.6, 5, 5, 4.6, 4.3, 3.7, 3.5, 3.6];
  var BAMBOO = [
    null,
    [[15, 7, 12, GRN], [15, 22, 12, BLU]],
    [[15, 6, 12, GRN], [9, 22, 12, GRN], [21, 22, 12, GRN]],
    [[9, 6, 12, BLU], [21, 6, 12, GRN], [9, 22, 12, GRN], [21, 22, 12, BLU]],
    [[8, 6, 12, GRN], [22, 6, 12, GRN], [15, 14, 12, RED], [8, 22, 12, BLU], [22, 22, 12, BLU]],
    [[7, 6, 12, GRN], [15, 6, 12, GRN], [23, 6, 12, GRN], [7, 22, 12, BLU], [15, 22, 12, BLU], [23, 22, 12, BLU]],
    [[15, 3, 10, RED], [7, 15, 9.5, GRN], [15, 15, 9.5, GRN], [23, 15, 9.5, GRN], [7, 27, 9.5, GRN], [15, 27, 9.5, GRN], [23, 27, 9.5, GRN]],
    [[6, 6, 12, GRN], [12, 6, 12, GRN], [18, 6, 12, GRN], [24, 6, 12, GRN], [6, 22, 12, BLU], [12, 22, 12, BLU], [18, 22, 12, BLU], [24, 22, 12, BLU]],
    [[7, 4, 9.5, GRN], [15, 4, 9.5, RED], [23, 4, 9.5, BLU], [7, 15.5, 9.5, GRN], [15, 15.5, 9.5, RED], [23, 15.5, 9.5, BLU], [7, 27, 9.5, GRN], [15, 27, 9.5, RED], [23, 27, 9.5, BLU]]
  ];

  function flower(cx, cy, r, c) {
    var s = "";
    for (var k = 0; k < 5; k++) {
      var a = k * Math.PI * 2 / 5 - Math.PI / 2;
      s += circle((cx + Math.cos(a) * r).toFixed(1), (cy + Math.sin(a) * r).toFixed(1), (r * 0.72).toFixed(1), c);
    }
    return s + circle(cx, cy, r * 0.55, "#f2c94c");
  }
  function seasonArt(k) {
    if (k === 0) {                   // spring: a sprout
      return '<path d="M15 33 V18" stroke="' + GRN + '" stroke-width="2.2" stroke-linecap="round"/>' +
        '<path d="M15 22 C8 22 6 15 7 12 C12 12 15 16 15 22 Z" fill="' + GRN + '"/>' +
        '<path d="M15 19 C21 19 24 13 23 9 C18 9 15 13 15 19 Z" fill="#5cb85c"/>';
    }
    if (k === 1) {                   // summer: the sun
      var s = "";
      for (var i = 0; i < 8; i++) {
        var a = i * Math.PI / 4;
        s += '<line x1="' + (15 + Math.cos(a) * 8).toFixed(1) + '" y1="' + (21 + Math.sin(a) * 8).toFixed(1) +
          '" x2="' + (15 + Math.cos(a) * 11.5).toFixed(1) + '" y2="' + (21 + Math.sin(a) * 11.5).toFixed(1) +
          '" stroke="#e67e22" stroke-width="2" stroke-linecap="round"/>';
      }
      return s + circle(15, 21, 6, "#f39c12");
    }
    if (k === 2) {                   // autumn: a leaf
      return '<path d="M15 9 C24 14 24 27 15 33 C6 27 6 14 15 9 Z" fill="#d35400"/>' +
        '<path d="M15 11 V34" stroke="#7f3300" stroke-width="1.2"/>' +
        '<path d="M15 18 L10 15 M15 23 L20 19 M15 27 L10 24" stroke="#7f3300" stroke-width="0.9"/>';
    }
    var w = "";                      // winter: a snowflake
    for (var j = 0; j < 3; j++) {
      var b = j * Math.PI / 3, dx = Math.cos(b) * 11, dy = Math.sin(b) * 11;
      w += '<line x1="' + (15 - dx).toFixed(1) + '" y1="' + (21 - dy).toFixed(1) + '" x2="' + (15 + dx).toFixed(1) +
        '" y2="' + (21 + dy).toFixed(1) + '" stroke="' + BLU + '" stroke-width="2" stroke-linecap="round"/>';
    }
    return w + circle(15, 21, 2.6, BLU);
  }

  var FACE_CACHE = {};
  function faceSvg(f) {
    if (FACE_CACHE[f]) return FACE_CACHE[f];
    var s = "", n = f % 9;
    if (f < 9) {
      DOTS[n].forEach(function (p, k) { s += dot(p[0], p[1], DOT_R[n], DOT_C[n][k]); });
      if (n === 0) s = circle(15, 20, 11, GRN) + circle(15, 20, 9, "#f7f2e2") + s;
    } else if (f < 18) {
      if (n === 0) {
        s = stick(15, 6, 28, GRN) + circle(15, 8, 3.2, RED) + '<path d="M11 13 L15 9 L19 13" fill="none" stroke="' + RED + '" stroke-width="1.5"/>';
      } else {
        BAMBOO[n].forEach(function (b) { s += stick(b[0], b[1], b[2], b[3]); });
      }
    } else if (f < 27) {
      s = '<text x="15" y="21" text-anchor="middle" font-size="17" font-weight="800" fill="' + INK +
        '" font-family="system-ui,sans-serif">' + (n + 1) + '</text>' +
        '<rect x="7.5" y="24" width="15" height="12" rx="2" fill="none" stroke="' + RED + '" stroke-width="1.6"/>' +
        '<path d="M10 27.5 H20 M10 30 H20 M15 25.5 V34.5 M10.5 34 L13 31.5 M19.5 34 L17 31.5" stroke="' + RED + '" stroke-width="1.3" stroke-linecap="round"/>';
    } else if (f < 31) {
      var letter = t("wind.letters").charAt(f - 27);
      s = circle(15, 20, 12, "none").replace('fill="none"', 'fill="none" stroke="' + INK + '" stroke-width="1.2" opacity="0.35"') +
        '<text x="15" y="27" text-anchor="middle" font-size="20" font-weight="800" fill="' + INK +
        '" font-family="system-ui,sans-serif">' + letter + '</text>';
    } else if (f === 31) {
      s = '<rect x="8" y="13" width="14" height="10" rx="1.5" fill="none" stroke="' + RED + '" stroke-width="2.6"/>' +
        '<path d="M15 6 V34" stroke="' + RED + '" stroke-width="2.8" stroke-linecap="round"/>';
    } else if (f === 32) {
      s = '<path d="M15 7 C9 14 8 20 15 23 C22 20 21 14 15 7 Z" fill="' + GRN + '"/>' +
        '<path d="M15 23 C9 25 7 30 8 34 M15 23 C21 25 23 30 22 34 M15 23 V34" stroke="' + GRN + '" stroke-width="2.2" fill="none" stroke-linecap="round"/>';
    } else if (f === 33) {
      s = '<rect x="6" y="7" width="18" height="26" rx="2" fill="none" stroke="' + BLU + '" stroke-width="2.2"/>' +
        '<rect x="9.5" y="10.5" width="11" height="19" rx="1" fill="none" stroke="' + BLU + '" stroke-width="1.2"/>';
    } else if (f < 38) {
      s = flower(15, 20, 6, ["#d6336c", "#8e44ad", "#e67e22", "#c0392b"][f - 34]) +
        '<path d="M15 26 V35" stroke="' + GRN + '" stroke-width="1.8"/>' + index(f - 33, "#8e44ad");
    } else {
      s = seasonArt(f - 38) + index(f - 37, "#d35400");
    }
    FACE_CACHE[f] = '<svg viewBox="0 0 30 40" aria-hidden="true" focusable="false">' + s + '</svg>';
    return FACE_CACHE[f];
  }

  function faceName(f) {
    var n = f % 9 + 1;
    if (f < 9) return t("f.dots", { n: n });
    if (f < 18) return t("f.bamboo", { n: n });
    if (f < 27) return t("f.chars", { n: n });
    if (f < 31) return t(["f.windE", "f.windS", "f.windW", "f.windN"][f - 27]);
    if (f < 34) return t(["f.red", "f.green", "f.white"][f - 31]);
    if (f < 38) return t("f.flower", { n: f - 33 });
    return t("f.season", { n: f - 37 });
  }

  // ---------- 4. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                     // max-merged
  //   rows: { <deviceId>: { b: <epoch>,
  //                         s: { turtle|pyramid|fortress: { t: best time ms, ts: when, w: wins } } } }
  // }
  // Each device only ever writes ITS OWN row; a row counts from epoch b.
  // Merge per row: the newer epoch wins; equal epochs take, per layout,
  // the faster time (lower t, then the earlier ts) and the higher w.
  // Rows older than br drop. A join (symmetric, associative, idempotent).
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normCell(c) {
    if (!c || typeof c !== "object" || !isInt(c.t) || !isInt(c.ts) || !isInt(c.w) ||
        c.t < 1 || c.t > MAX_TIME || c.ts < 0 || c.w < 1) return null;
    return { t: c.t, ts: c.ts, w: c.w };
  }

  function normRow(row) {
    if (!row || typeof row !== "object" || !isInt(row.b) || row.b < 0) return null;
    var s = {}, any = false;
    LAYS.forEach(function (k) {
      var c = normCell(row.s && row.s[k]);
      if (c) { s[k] = c; any = true; }
    });
    return any ? { b: row.b, s: s } : null;
  }

  function joinCell(a, c) {
    var best = (a.t !== c.t) ? (a.t < c.t ? a : c) : (a.ts <= c.ts ? a : c);
    return { t: best.t, ts: best.ts, w: Math.max(a.w, c.w) };
  }

  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var s = {};
    LAYS.forEach(function (k) {
      var a = x.s[k], c = y.s[k];
      if (!a && !c) return;
      s[k] = (a && c) ? joinCell(a, c) : normCell(a || c);
    });
    return { b: x.b, s: s };
  }

  function mergeMahjong(A, B) {
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
      LAYS.forEach(function (k) { if (r.s[k]) s[k] = r.s[k]; });
      sorted[id] = { b: r.b, s: s };
    });
    return { ver: DATA_VER, br: br, rows: sorted };
  }

  // Best time and wins for a layout, across every device.
  function totals(key) {
    var out = { t: 0, w: 0 };
    Object.keys(data.rows).forEach(function (id) {
      var c = data.rows[id].s[key];
      if (!c) return;
      out.w += c.w;
      if (!out.t || c.t < out.t) out.t = c.t;
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
          data = mergeMahjong(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] mahjong: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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

  // Counts a win; returns true for a new best time.
  function countWin(key, ms) {
    var before = totals(key);
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // new epoch after a reset
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    var c = row.s[key], tm = Math.max(1, Math.min(MAX_TIME, Math.round(ms)));
    if (!c) c = { t: tm, ts: Date.now(), w: 1 };
    else c = tm < c.t ? { t: tm, ts: Date.now(), w: c.w + 1 } : { t: c.t, ts: c.ts, w: c.w + 1 };
    row.s[key] = c;
    data.rows[deviceId] = row;
    data = mergeMahjong(data, data);
    save();
    return !before.t || tm < before.t;
  }

  // ---------- 5. Device-local prefs + session ----------
  var prefs = { lay: "turtle", zoom: false };

  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    if (p && typeof p === "object") {
      if (LAYS.indexOf(p.lay) >= 0) prefs.lay = p.lay;
      prefs.zoom = p.zoom === true;
    } else if (window.innerWidth < 600) {
      prefs.lay = "fortress";                 // first run on a phone: the layout that fits
    }
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = { lay, faces[], on[] (1 = on the board), hist[] ([a, b] a pair,
  //          or { s: faces before } a shuffle), el (ms played), go (the
  //          clock has started), over, won }
  var game = null;

  function validSession(g) {
    if (!g || typeof g !== "object" || LAYS.indexOf(g.lay) < 0) return false;
    var n = LAYOUTS[g.lay].length, i;
    if (!Array.isArray(g.faces) || g.faces.length !== n || !Array.isArray(g.on) || g.on.length !== n ||
        !Array.isArray(g.hist) || !isInt(g.el) || g.el < 0 || g.el > MAX_TIME ||
        typeof g.go !== "boolean" || typeof g.over !== "boolean" || typeof g.won !== "boolean") return false;
    var cnt = {};
    for (i = 0; i < n; i++) {
      if (!isInt(g.faces[i]) || g.faces[i] < 0 || g.faces[i] >= FACES || (g.on[i] !== 0 && g.on[i] !== 1)) return false;
      if (g.on[i]) { var m = matchGroup(g.faces[i]); cnt[m] = (cnt[m] || 0) + 1; }
    }
    for (var k in cnt) if (cnt[k] % 2) return false;
    for (i = 0; i < g.hist.length; i++) {
      var h = g.hist[i];
      if (Array.isArray(h)) {
        if (h.length !== 2 || !isInt(h[0]) || !isInt(h[1]) || h[0] < 0 || h[1] < 0 || h[0] >= n || h[1] >= n || g.on[h[0]] || g.on[h[1]]) return false;
      } else if (!h || !Array.isArray(h.s) || h.s.length !== n) return false;
    }
    return true;
  }
  function loadSession() {
    try {
      var g = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(g)) return g;
    } catch (e) {}
    return null;
  }
  function saveSession() {
    if (!game) return;
    var copy = JSON.parse(JSON.stringify(game));
    copy.el = Math.min(MAX_TIME, Math.round(elapsed()));
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(copy)); } catch (e) {}
  }

  // ---------- 6. Game flow ----------
  var sel = -1;          // selected tile
  var hint = null;       // [a, b] shown by Hint
  var cur = -1;          // keyboard cursor
  var kbd = false;       // the cursor shows once a key was used
  var runFrom = 0;       // when the clock last started (0 = stopped)

  function fresh(lay) {
    var faces = deal(topoOf(lay), rand), on = [];
    for (var i = 0; i < faces.length; i++) on.push(1);
    return { lay: lay, faces: faces, on: on, hist: [], el: 0, go: false, over: false, won: false };
  }
  function started() { return !!(game && game.go); }
  function inProgress() { return !!(game && !game.over && game.go); }

  function elapsed() {
    if (!game) return 0;
    return game.el + (runFrom ? Date.now() - runFrom : 0);
  }
  function stopClock() {
    if (runFrom && game) game.el = Math.min(MAX_TIME, game.el + Date.now() - runFrom);
    runFrom = 0;
  }
  function clockRun() {
    var go = !!(game && !game.over && started() && document.visibilityState !== "hidden");
    if (go && !runFrom) runFrom = Date.now();
    if (!go && runFrom) { game.el = Math.min(MAX_TIME, game.el + Date.now() - runFrom); runFrom = 0; }
  }

  // A game in progress is never lost silently: Undo toast (R14).
  function newGame(announce, msg) {
    closeDialogs();
    stopClock();
    var prev = inProgress() ? JSON.parse(JSON.stringify(game)) : null;
    game = fresh(prefs.lay);
    sel = -1; hint = null; cur = -1;
    saveSession();
    renderAll(true);
    if (prev) {
      undoToast(msg || t("toast.newgame"), function () {
        prefs.lay = prev.lay; savePrefs();
        stopClock();
        game = prev;
        sel = -1; hint = null; cur = -1;
        saveSession();
        renderAll(true);
        clockRun();
      });
    } else if (announce) {
      live(msg || t("toast.newgame"));
    }
  }

  function pick(i) {
    if (!game || document.querySelector("dialog[open]")) return;
    if (game.over) { showToast(t("toast.over")); return; }                   // R28
    if (!game.on[i]) return;
    var topo = topoOf(game.lay);
    cur = i;
    if (!isFree(topo, game.on, i)) {
      shakeTile(i);
      showToast(t("toast.blocked"));
      sfx("no");
      paintBoard();
      return;
    }
    if (sel === i) { sel = -1; paintBoard(); return; }
    if (!game.go) { game.go = true; clockRun(); saveSession(); }
    if (sel < 0) {
      sel = i;
      sfx("tap");
      live(t("live.sel", { face: faceName(game.faces[i]) }));
      paintBoard();
      return;
    }
    if (matchGroup(game.faces[sel]) !== matchGroup(game.faces[i])) {
      shakeTile(i);
      showToast(t("toast.noMatch"));
      sfx("no");
      sel = i;                              // the new tile becomes the selection
      paintBoard();
      return;
    }
    var a = sel;
    sel = -1; hint = null;
    game.on[a] = 0; game.on[i] = 0;
    game.hist.push([a, i]);
    clockRun();
    var left = countOn(game.on);
    if (!left) { win(); return; }
    if (!game.on[cur]) cur = -1;
    saveSession();
    renderAll(false);
    sfx("pair");
    live(t("live.pair", { n: left }));
    if (!freePairs(topo, game.faces, game.on).length) setTimeout(stuckDialog, 350);
  }

  function undo() {
    if (!game || document.querySelector("dialog[open]") && !$("mahjong-stuck")) return;
    if (game.over || !game.hist.length) { showToast(t("toast.noUndo")); return; }   // R28
    closeDialogs();
    var h = game.hist.pop();
    if (Array.isArray(h)) { game.on[h[0]] = 1; game.on[h[1]] = 1; }
    else game.faces = h.s;
    sel = -1; hint = null;
    clockRun();
    saveSession();
    renderAll(!Array.isArray(h));
    live(t("toast.undo"));
  }

  function showHint() {
    if (!game || document.querySelector("dialog[open]")) return;
    if (game.over) { showToast(t("toast.over")); return; }
    var pairs = freePairs(topoOf(game.lay), game.faces, game.on);
    if (!pairs.length) { stuckDialog(); return; }
    hint = pairs[Math.floor(rand() * pairs.length)];
    sel = -1;
    paintBoard();
    live(t("live.hint", { face: faceName(game.faces[hint[0]]) }));
    var h = hint;
    setTimeout(function () { if (hint === h) { hint = null; paintBoard(); } }, 2600);
  }

  function shuffle() {
    if (!game) return;
    if (game.over) { showToast(t("toast.over")); return; }
    var nf = reshuffle(topoOf(game.lay), game.faces, game.on, rand);
    if (!nf) { showToast(t("toast.noShuffle")); return; }                    // R28
    closeDialogs();
    game.hist.push({ s: game.faces.slice() });
    game.faces = nf;
    sel = -1; hint = null;
    clockRun();
    saveSession();
    renderAll(true);
    sfx("shuffle");
    showToast(t("toast.shuffled"));
    live(t("live.shuffled"));
  }

  function win() {
    stopClock();
    game.el = Math.round(game.el);
    game.over = true; game.won = true;
    var rec = countWin(game.lay, game.el);
    saveSession();
    renderAll(false);
    sfx("win");
    live(t("live.won", { t: fmtTime(game.el) }));
    setTimeout(function () { resultDialog(rec); }, 300);
  }

  // ---------- 7. Render ----------
  function renderAll(rebuild) {
    renderToolbar();
    renderStatus();
    if (rebuild || $("board").getAttribute("data-lay") !== game.lay) buildBoard();
    paintBoard();
  }

  function renderToolbar() {
    [].forEach.call(document.querySelectorAll("#lay-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-lay") === (game ? game.lay : prefs.lay);
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var over = !game || game.over;
    $("undo-btn").disabled = over || !game.hist.length;
    $("hint-btn").disabled = over;
    $("shuffle-btn").disabled = over;
    $("zoom-btn").setAttribute("aria-pressed", prefs.zoom ? "true" : "false");
    paintSfxBtn();
  }

  function renderStatus() {
    if (!game) return;
    var left = countOn(game.on);
    $("left").textContent = String(left);
    tick();
    var msg, cls = "";
    if (game.won) { msg = t("turn.won"); cls = "done"; }
    else if (!started()) msg = t("turn.start");
    else {
      var n = freePairs(topoOf(game.lay), game.faces, game.on).length;
      msg = n ? (n === 1 ? t("turn.one") : t("turn.pairs", { n: n })) : t("turn.none");
      if (!n) cls = "warn";
    }
    $("turn").textContent = msg;
    $("turn").className = cls;
  }
  function tick() { if (game) $("time").textContent = fmtTime(elapsed()); }

  var TILE_ELS = [];
  var coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

  function buildBoard() {
    var b = $("board"), pos = LAYOUTS[game.lay], mz = 0, mx = 0, my = 0;
    b.innerHTML = "";
    b.setAttribute("data-lay", game.lay);
    b.setAttribute("aria-label", t("board.label", { lay: t("lay." + game.lay) }));
    pos.forEach(function (p) { mx = Math.max(mx, p[0] + 2); my = Math.max(my, p[1] + 2); mz = Math.max(mz, p[2]); });
    b.style.setProperty("--cols", String(mx));
    b.style.setProperty("--rows", String(my));
    b.style.setProperty("--mz", String(mz));
    TILE_ELS = [];
    pos.forEach(function (p, i) {
      var d = document.createElement("button");
      d.type = "button";
      d.className = "tile";
      d.tabIndex = -1;
      d.setAttribute("data-i", String(i));
      d.style.setProperty("--x", String(p[0]));
      d.style.setProperty("--y", String(p[1]));
      d.style.setProperty("--z", String(p[2]));
      d.style.zIndex = String(i + 1);           // positions are sorted by z, y, x
      d.innerHTML = faceSvg(game.faces[i]);
      b.appendChild(d);
      TILE_ELS.push(d);
    });
    layoutBoard();
  }

  function paintBoard() {
    if (!game) return;
    var topo = topoOf(game.lay);
    TILE_ELS.forEach(function (d, i) {
      var on = !!game.on[i];
      d.hidden = !on;
      if (!on) { d.classList.remove("sel", "hint", "cur", "free"); return; }
      var free = isFree(topo, game.on, i);
      d.classList.toggle("sel", i === sel);
      d.classList.toggle("hint", !!hint && (hint[0] === i || hint[1] === i));
      d.classList.toggle("cur", kbd && i === cur);
      d.classList.toggle("free", free);
      d.setAttribute("aria-label", t(free ? "tile.label" : "tile.blocked", { face: faceName(game.faces[i]) }));
    });
  }

  function layoutBoard() {
    var wrap = $("board-wrap"), b = $("board");
    if (!game) return;
    var cs = getComputedStyle(wrap);
    var W = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var H = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (W <= 0 || H <= 0) return;
    var cols = +b.style.getPropertyValue("--cols"), rows = +b.style.getPropertyValue("--rows"),
        mz = +b.style.getPropertyValue("--mz");
    // board = cols/2 tiles wide (+ the 3-D offset), rows/2 tiles of 4/3 tall
    var fw = cols / 2 + 0.12 * (mz + 1), fh = rows * 2 / 3 + 0.12 * (mz + 1);
    var tw = Math.min(W / fw, H / fh, TILE_MAX);
    if (prefs.zoom) tw = Math.min(Math.max(tw * ZOOM, coarse ? TOUCH_ZOOM : 0), 96);
    // a finger needs a tile at least TOUCH_MIN wide: on a phone the
    // Turtle then pans inside the board area (Fortress and Pyramid fit)
    if (coarse) tw = Math.max(tw, TOUCH_MIN);
    tw = Math.max(12, Math.floor(tw * 10) / 10);
    b.style.setProperty("--tw", tw + "px");
    wrap.classList.toggle("zoomed", tw * fw > W + 1 || tw * fh > H + 1);
  }

  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function shakeTile(i) {
    var d = TILE_ELS[i];
    if (!d || reduced) return;
    d.classList.remove("shake");
    void d.offsetWidth;
    d.classList.add("shake");
    setTimeout(function () { d.classList.remove("shake"); }, 300);
  }

  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 8. Dialogs ----------
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

  function resultDialog(rec) {
    if (!game || !game.won) return;           // replaced meanwhile
    closeDialogs();
    var s = totals(game.lay);
    var dlg = makeDialog("mahjong-result");
    dlg.appendChild(el("div", "dlg-title", t("res.title") + " · " + t("lay." + game.lay)));
    dlg.appendChild(el("div", "dlg-hero", fmtTime(game.el)));
    if (rec) dlg.appendChild(el("div", "dlg-badge", t("res.rec")));
    dlg.appendChild(row(t("res.best"), s.t ? fmtTime(s.t) : "–"));
    dlg.appendChild(row(t("res.wins"), String(s.w)));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("res.close"), "", function () { dlg.close(); }));
    var again = button(t("res.again"), "primary", function () { dlg.close(); newGame(false); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    again.focus();
  }

  function stuckDialog() {
    if (!game || game.over || freePairs(topoOf(game.lay), game.faces, game.on).length) return;
    if (document.querySelector("dialog[open]")) return;
    var dlg = makeDialog("mahjong-stuck");
    dlg.appendChild(el("div", "dlg-title", t("stuck.title")));
    dlg.appendChild(el("div", "dlg-msg", t("stuck.msg")));
    var acts = el("div", "dlg-actions wrap");
    acts.appendChild(button(t("stuck.new"), "", function () { dlg.close(); newGame(true); }));
    acts.appendChild(button(t("stuck.undo"), "", function () { dlg.close(); undo(); }));
    var sh = button(t("stuck.shuffle"), "primary", function () { dlg.close(); shuffle(); });
    acts.appendChild(sh);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    sh.focus();
  }

  function statsDialog() {
    var dlg = makeDialog("mahjong-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    LAYS.forEach(function (k) {
      var s = totals(k);
      if (s.w) empty = false;
      dlg.appendChild(row(t("lay." + k) + " · " + LAYOUTS[k].length,
        s.w ? fmtTime(s.t) + " · " + s.w : "–"));
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
    var dlg = makeDialog("mahjong-confirm");
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
    data = mergeMahjong(data, data);
    save();
    renderStatus();
    showToast(t("toast.reset"));
  }

  // ---------- 9. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "mahjong", title: String(text) })) return;
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
      if (kind === "tap") tone(880, 0, 0.04, "triangle", 0.08);
      else if (kind === "pair") { tone(660, 0, 0.06, "triangle", 0.12); tone(990, 0.05, 0.08, "triangle", 0.1); }
      else if (kind === "no") tone(180, 0, 0.12, "square", 0.06);
      else if (kind === "shuffle") [500, 600, 700].forEach(function (f, k) { tone(f, k * 0.05, 0.06, "triangle", 0.08); });
      else if (kind === "win") [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Toolbar icons (R9: injected by JS) ----------
  var UI_ICONS = {
    new:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    undo:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    hint:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
    zoom:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/></svg>',
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

  // ---------- 11. Input ----------
  function wirePointer() {
    $("board").addEventListener("click", function (e) {
      var d = e.target.closest ? e.target.closest(".tile") : null;
      if (!d) return;
      kbd = false;
      if (d.blur) d.blur();                      // keys keep driving the cursor
      pick(+d.getAttribute("data-i"));
    });
  }

  // The keyboard cursor walks over the free tiles: the nearest one in
  // the arrow's direction.
  function moveCursor(dx, dy) {
    var topo = topoOf(game.lay), pos = LAYOUTS[game.lay], best = -1, bestD = Infinity, i;
    var free = [];
    for (i = 0; i < topo.n; i++) if (isFree(topo, game.on, i)) free.push(i);
    if (!free.length) return;
    if (cur < 0 || !game.on[cur]) {
      cur = free[0];
    } else {
      var p = pos[cur];
      // in the 90° cone of the arrow first (nearest, straight ahead
      // preferred), else anywhere on that side
      free.forEach(function (j) {
        if (j === cur) return;
        var q = pos[j], vx = q[0] - p[0], vy = q[1] - p[1];
        var along = vx * dx + vy * dy, across = Math.abs(vx * dy) + Math.abs(vy * dx);
        if (along <= 0) return;
        var d = (across <= along ? 0 : 1000) + along + across * 2;
        if (d < bestD) { bestD = d; best = j; }
      });
      if (best >= 0) cur = best;
    }
    kbd = true;
    paintBoard();
    var d2 = TILE_ELS[cur];
    if (d2 && d2.scrollIntoView) d2.scrollIntoView({ block: "nearest", inline: "nearest" });
    live(faceName(game.faces[cur]));
  }

  var ARROWS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;   // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      if (ARROWS[e.code]) { e.preventDefault(); if (game && !game.over) moveCursor(ARROWS[e.code][0], ARROWS[e.code][1]); return; }
      var onTile = !!(document.activeElement && document.activeElement.classList &&
                      document.activeElement.classList.contains("tile"));
      if ((e.code === "Enter" || e.code === "Space") && kbd && cur >= 0 && (onTile || tag === "BODY" || tag === "MAIN" || tag === "DIV")) {
        e.preventDefault(); pick(cur); return;
      }
      if (e.repeat || e.shiftKey) return;
      if (e.code === "KeyN") { e.preventDefault(); newGame(true); return; }
      if (e.code === "KeyU" || e.code === "Backspace") { e.preventDefault(); undo(); return; }
      if (e.code === "KeyH") { e.preventDefault(); showHint(); return; }
      if (e.code === "KeyS") { e.preventDefault(); shuffle(); return; }
      if (e.code === "KeyZ") { e.preventDefault(); toggleZoom(); return; }
      if (e.code === "Escape" && sel >= 0) { sel = -1; paintBoard(); }
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

  function toggleZoom() {
    prefs.zoom = !prefs.zoom;
    savePrefs();
    layoutBoard();
    renderToolbar();
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
    api.registerSlice("mahjong", sliceGet, sliceSet, STORAGE_KEY, mergeMahjong);
  }

  function sliceGet() {
    return mergeMahjong(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeMahjong(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (game) renderStatus();
    // no toast on merge (sync feedback = taskbar dot)
  }

  // ---------- 13. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
  }

  function paintStatic() {
    [["undo-btn", "undo", "btn.undo"], ["new-btn", "new", "btn.new"], ["hint-btn", "hint", "btn.hint"],
     ["shuffle-btn", "shuffle", "btn.shuffle"], ["zoom-btn", "zoom", "btn.zoom"],
     ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    paintSfxBtn();
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#lay-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () {
        var lay = b.getAttribute("data-lay");
        if (game && lay === game.lay && !game.over) return;   // visible active state
        prefs.lay = lay; savePrefs(); newGame(true, t("toast.layout"));
      });
    });
    $("undo-btn").addEventListener("click", undo);
    $("hint-btn").addEventListener("click", showHint);
    $("shuffle-btn").addEventListener("click", shuffle);
    $("zoom-btn").addEventListener("click", toggleZoom);
    $("new-btn").addEventListener("click", function () { newGame(true); $("new-btn").blur(); });
    $("stats-btn").addEventListener("click", statsDialog);
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("tap");   // audible confirmation when turned on
    });
    wirePointer();

    var relayout = function () { layoutBoard(); };
    if (window.ResizeObserver) new ResizeObserver(relayout).observe($("board-wrap"));
    else window.addEventListener("resize", relayout);

    document.addEventListener("visibilitychange", function () { clockRun(); if (game) saveSession(); });
    window.addEventListener("pagehide", function () { if (game) saveSession(); });
    setInterval(tick, 500);

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
    if (game) { prefs.lay = game.lay; savePrefs(); }   // the resumed game decides the toolbar
    else { game = fresh(prefs.lay); saveSession(); }
    renderAll(true);
    clockRun();
  }

  boot();
})();
