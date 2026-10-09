// ============================================================
// orOS Spot the Difference — App logic (v1.0.0)
// Two pictures that look the same, except for a few differences: find
// them all. The pictures are drawn by the app (SVG) from a seed: a
// theme (park, sea, city, space) and many objects, none overlapping.
// The second picture changes N of them: missing, another colour,
// bigger or smaller, moved, or mirrored.
//   - levels Easy (5 differences), Medium (7), Hard (10): on harder
//     levels smaller objects can change, and by less
//   - tap / click a difference on either picture; a wrong tap costs
//     5 s, three quick wrong taps lock the pictures for 3 s (toast)
//   - Hint (H) circles one difference for a moment and costs 10 s
//   - keyboard: arrows move a crosshair, Enter / Space taps there;
//     N new game
//   - the pictures sit side by side, stacked on a portrait phone
//   - a game in progress (seed, found, time) is kept and resumes
// Data:
//   - synced slice "spot" (oros-spot-data): per level the best time
//     (and when) and the number of wins, as per-device rows (each device
//     only grows its own row; merge = per-row join) + a reset stamp br
//   - device-local (R10): oros-spot-prefs (level), oros-spot-session
//     (the game in progress), oros-spot-device (row id), oros-spot-sfx
//     (sound on/off)
// Sections:
//   1. Constants, i18n, helpers
//   2. Scene model (seeded RNG, object kinds, scenes, differences, hits)
//   3. Drawing (SVG)
//   4. Synced data: load / save / normalize / merge (R5, R26)
//   5. Device-local prefs + session
//   6. Game flow (new, tap, hint, lock, win)
//   7. Render (toolbar, status, pictures, marks)
//   8. Dialogs (result, records, confirm)
//   9. Toasts
//  10. Sound
//  11. Input (tap, keyboard crosshair, Contract Β)
//  12. Sync slice + palette
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-spot-data";
  var PREFS_KEY   = "oros-spot-prefs";
  var SESSION_KEY = "oros-spot-session";
  var DEVICE_KEY  = "oros-spot-device";
  var SFX_KEY     = "oros-spot-sfx";
  var DATA_VER    = 1;

  var VW = 400, VH = 300;                    // picture size (SVG units)
  var LEVELS = ["l1", "l2", "l3"];
  // n differences; min = smallest object (half-size) that may change;
  // hue = colour shift (degrees); grow / shrink = size change; move =
  // shortest move (units)
  var LEVEL = {
    l1: { n: 5,  min: 14, hue: 150, grow: 1.5,  shrink: 0.6,  move: 30 },
    l2: { n: 7,  min: 11, hue: 95,  grow: 1.36, shrink: 0.7,  move: 22 },
    l3: { n: 10, min: 8,  hue: 55,  grow: 1.26, shrink: 0.78, move: 16 }
  };
  var THEMES = ["park", "sea", "city", "space"];
  var TYPES = ["missing", "color", "size", "moved", "mirror"];
  var PAD = 4;                               // slack around a difference
  var GAP = 4;                               // space between two objects
  var MISS_MS = 5000, HINT_MS = 10000;       // time added by a wrong tap / a hint
  var LOCK_MS = 3000, QUICK_MS = 4000;       // 3 wrong taps within QUICK_MS → locked LOCK_MS
  var MAX_TIME = 360000000;
  var MAX_SEED = 2147483647;

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
      "lv.l1": "Easy · 5", "lv.l2": "Medium · 7", "lv.l3": "Hard · 10",
      "lvn.l1": "Easy", "lvn.l2": "Medium", "lvn.l3": "Hard",
      "btn.new": "New pictures (N)",
      "btn.hint": "Hint (H): +10 s",
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "st.time": "Time", "st.found": "Found",
      "turn.play": "Tap what differs, on either picture",
      "turn.keys": "Arrows move the crosshair, Enter taps",
      "turn.left": "{n} left",
      "turn.one": "1 left",
      "turn.won": "All found!",
      "turn.lock": "Too many misses: wait…",
      "pic.a": "Picture 1", "pic.b": "Picture 2",
      "pic.label": "{p}: {theme}. {f} of {n} differences found",
      "theme.park": "a park", "theme.sea": "the sea", "theme.city": "a city street", "theme.space": "outer space",
      "live.found": "Found one! {f} of {n}",
      "live.miss": "Nothing there: +5 s",
      "live.hint": "Hint: look inside the circle (+10 s)",
      "live.won": "All {n} found in {t}",
      "res.title": "All found",
      "res.time": "Time",
      "res.best": "Best time",
      "res.wins": "Wins",
      "res.misses": "Wrong taps · hints",
      "res.rec": "New best time!",
      "res.again": "New pictures",
      "res.close": "Close",
      "stats.title": "Records",
      "stats.head": "Best time · wins",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "confirm.reset": "Delete the records on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Records reset",
      "toast.newgame": "New pictures",
      "toast.level": "Level changed",
      "toast.undo": "Undo",
      "toast.lock": "Three misses in a row: the pictures are locked for 3 s",
      "toast.locked": "Locked for a moment: wait",
      "toast.already": "Already found",
      "toast.over": "All found: start new pictures (N)",
      "toast.save": "Could not save: storage is full"
    },
    el: {
      "lv.l1": "Εύκολο · 5", "lv.l2": "Μέτριο · 7", "lv.l3": "Δύσκολο · 10",
      "lvn.l1": "Εύκολο", "lvn.l2": "Μέτριο", "lvn.l3": "Δύσκολο",
      "btn.new": "Νέες εικόνες (N)",
      "btn.hint": "Βοήθεια (H): +10 δλ",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "st.time": "Χρόνος", "st.found": "Βρέθηκαν",
      "turn.play": "Πάτα ό,τι διαφέρει, σε όποια εικόνα θες",
      "turn.keys": "Τα βελάκια μετακινούν το στόχαστρο, το Enter πατάει",
      "turn.left": "Μένουν {n}",
      "turn.one": "Μένει 1",
      "turn.won": "Τις βρήκες όλες!",
      "turn.lock": "Πολλά λάθη: περίμενε…",
      "pic.a": "Εικόνα 1", "pic.b": "Εικόνα 2",
      "pic.label": "{p}: {theme}. Βρέθηκαν {f} από {n} διαφορές",
      "theme.park": "ένα πάρκο", "theme.sea": "η θάλασσα", "theme.city": "ένας δρόμος στην πόλη", "theme.space": "το διάστημα",
      "live.found": "Βρήκες μία! {f} από {n}",
      "live.miss": "Τίποτα εκεί: +5 δλ",
      "live.hint": "Βοήθεια: κοίτα μέσα στον κύκλο (+10 δλ)",
      "live.won": "Βρήκες και τις {n} σε {t}",
      "res.title": "Τις βρήκες όλες",
      "res.time": "Χρόνος",
      "res.best": "Καλύτερος χρόνος",
      "res.wins": "Νίκες",
      "res.misses": "Λάθος πατήματα · βοήθειες",
      "res.rec": "Νέο ρεκόρ χρόνου!",
      "res.again": "Νέες εικόνες",
      "res.close": "Κλείσιμο",
      "stats.title": "Ρεκόρ",
      "stats.head": "Καλύτερος χρόνος · νίκες",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.newgame": "Νέες εικόνες",
      "toast.level": "Άλλαξε το επίπεδο",
      "toast.undo": "Αναίρεση",
      "toast.lock": "Τρία λάθη στη σειρά: οι εικόνες κλειδώνουν για 3 δλ",
      "toast.locked": "Κλειδωμένο για λίγο: περίμενε",
      "toast.already": "Αυτή τη βρήκες ήδη",
      "toast.over": "Τις βρήκες όλες: ξεκίνα νέες εικόνες (N)",
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
    console.log("spot.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Scene model ----------
  // A seeded RNG (mulberry32): the same seed always draws the same
  // pictures, on every device.
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Object kinds, drawn in a local box of ±20 (w, h = half-extents
  // there). a: not symmetric (can be mirrored); nc: its colour does not
  // carry (no colour change); z: [y from, y to] of its centre, as a
  // part of the height; s: [smallest, biggest] scale (canvas units per
  // 20 local units); hue: [from, to]; max: at most this many.
  var KINDS = {
    tree:      { w: 14, h: 20, a: false, z: [0.62, 0.86], s: [16, 26], hue: [85, 135] },
    pine:      { w: 15, h: 20, a: false, z: [0.6, 0.86], s: [16, 26], hue: [120, 160] },
    flower:    { w: 12, h: 20, a: true,  z: [0.72, 0.94], s: [10, 15], hue: [0, 359] },
    bush:      { w: 17, h: 12, a: false, z: [0.66, 0.94], s: [12, 18], hue: [80, 140] },
    bird:      { w: 17, h: 11, a: true,  z: [0.08, 0.4], s: [9, 14], hue: [0, 359] },
    butterfly: { w: 16, h: 12, a: false, z: [0.12, 0.6], s: [8, 12], hue: [0, 359] },
    mushroom:  { w: 15, h: 16, a: true,  z: [0.75, 0.95], s: [8, 13], hue: [0, 40] },
    kite:      { w: 14, h: 20, a: true,  z: [0.1, 0.38], s: [12, 18], hue: [0, 359] },
    balloon:   { w: 11, h: 20, a: true,  z: [0.1, 0.45], s: [11, 16], hue: [0, 359] },
    cloud:     { w: 20, h: 11, a: true,  nc: true, z: [0.06, 0.3], s: [16, 26], hue: [0, 0] },
    sun:       { w: 19, h: 19, a: false, z: [0.08, 0.22], s: [16, 20], hue: [40, 52], max: 1 },
    duck:      { w: 16, h: 14, a: true,  z: [0.7, 0.94], s: [9, 13], hue: [45, 55] },
    house:     { w: 18, h: 20, a: true,  z: [0.5, 0.6], s: [20, 26], hue: [0, 359], max: 2 },
    boat:      { w: 18, h: 20, a: true,  z: [0.33, 0.38], s: [14, 22], hue: [0, 359] },
    fish:      { w: 18, h: 10, a: true,  z: [0.55, 0.85], s: [11, 18], hue: [0, 359] },
    rock:      { w: 18, h: 12, a: true,  nc: true, z: [0.88, 0.95], s: [11, 16], hue: [20, 40] },
    starfish:  { w: 15, h: 15, a: false, z: [0.86, 0.94], s: [9, 14], hue: [0, 40] },
    shell:     { w: 13, h: 12, a: true,  z: [0.86, 0.96], s: [8, 12], hue: [10, 50] },
    buoy:      { w: 10, h: 17, a: false, z: [0.38, 0.42], s: [12, 16], hue: [0, 359] },
    crab:      { w: 18, h: 11, a: false, z: [0.88, 0.95], s: [11, 15], hue: [0, 25] },
    jelly:     { w: 12, h: 18, a: false, z: [0.55, 0.8], s: [11, 16], hue: [260, 340] },
    car:       { w: 20, h: 11, a: true,  z: [0.83, 0.92], s: [16, 22], hue: [0, 359] },
    bus:       { w: 20, h: 12, a: true,  z: [0.82, 0.9], s: [24, 30], hue: [0, 359], max: 2 },
    lamp:      { w: 10, h: 20, a: true,  nc: true, z: [0.64, 0.68], s: [18, 22], hue: [40, 60] },
    cat:       { w: 12, h: 16, a: true,  z: [0.7, 0.72], s: [8, 11], hue: [20, 40] },
    sign:      { w: 14, h: 20, a: true,  z: [0.64, 0.68], s: [14, 18], hue: [0, 359] },
    hydrant:   { w: 10, h: 16, a: false, z: [0.69, 0.72], s: [9, 12], hue: [0, 20] },
    pot:       { w: 12, h: 17, a: false, z: [0.69, 0.72], s: [9, 13], hue: [10, 40] },
    planet:    { w: 20, h: 14, a: true,  z: [0.08, 0.92], s: [14, 26], hue: [0, 359] },
    moon:      { w: 14, h: 16, a: true,  z: [0.08, 0.92], s: [10, 16], hue: [40, 60] },
    rocket:    { w: 14, h: 20, a: true,  z: [0.1, 0.9], s: [14, 20], hue: [0, 359] },
    ufo:       { w: 20, h: 11, a: false, z: [0.1, 0.9], s: [14, 20], hue: [80, 200] },
    comet:     { w: 20, h: 12, a: true,  z: [0.08, 0.6], s: [14, 22], hue: [180, 220] },
    satellite: { w: 20, h: 12, a: true,  z: [0.1, 0.9], s: [12, 18], hue: [200, 240] },
    bigstar:   { w: 14, h: 14, a: false, z: [0.06, 0.94], s: [8, 13], hue: [40, 60] },
    asteroid:  { w: 14, h: 12, a: true,  nc: true, z: [0.1, 0.94], s: [10, 16], hue: [20, 40] }
  };
  var THEME_KINDS = {
    park:  ["tree", "pine", "flower", "flower", "bush", "bird", "butterfly", "mushroom", "kite", "balloon", "cloud", "sun", "duck", "house"],
    sea:   ["boat", "fish", "fish", "bird", "rock", "starfish", "shell", "buoy", "crab", "jelly", "cloud", "sun"],
    city:  ["car", "bus", "lamp", "cat", "sign", "hydrant", "pot", "bird", "cloud", "balloon", "tree"],
    space: ["planet", "moon", "rocket", "ufo", "comet", "satellite", "bigstar", "bigstar", "asteroid"]
  };
  var THEME_COUNT = { park: 30, sea: 28, city: 28, space: 26 };

  function between(r, a, b) { return a + (b - a) * r(); }

  // The box of an object: { x0, y0, x1, y1 }.
  function boxOf(p) {
    var k = KINDS[p.k], hw = k.w * p.s / 20, hh = k.h * p.s / 20;
    return { x0: p.x - hw, y0: p.y - hh, x1: p.x + hw, y1: p.y + hh };
  }
  function boxesMeet(a, b, gap) {
    return a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;
  }
  function inside(b, m) { return b.x0 >= m && b.y0 >= m && b.x1 <= VW - m && b.y1 <= VH - m; }
  // Half-size of an object (how big it looks).
  function sizeOf(p) { var k = KINDS[p.k]; return Math.max(k.w, k.h) * p.s / 20; }

  // Does p fit among props (skipping index skip), inside the picture?
  function fits(p, props, skip) {
    var b = boxOf(p);
    if (!inside(b, 2)) return false;
    for (var i = 0; i < props.length; i++) {
      if (i === skip || !props[i]) continue;
      if (boxesMeet(b, boxOf(props[i]), GAP)) return false;
    }
    return true;
  }

  // A scene: a theme, a background seed and objects that never overlap.
  function makeScene(seed) {
    var r = rng(seed), theme = THEMES[Math.floor(r() * THEMES.length)], kinds = THEME_KINDS[theme];
    var props = [], count = {}, want = THEME_COUNT[theme];
    for (var tries = 0; tries < 3000 && props.length < want; tries++) {
      var kn = kinds[Math.floor(r() * kinds.length)], K = KINDS[kn];
      if (K.max && (count[kn] || 0) >= K.max) continue;
      var p = { k: kn, s: Math.round(between(r, K.s[0], K.s[1]) * 10) / 10,
                x: Math.round(between(r, 10, VW - 10)), y: Math.round(between(r, K.z[0], K.z[1]) * VH),
                c: Math.round(between(r, K.hue[0], K.hue[1])), f: (K.a && r() < 0.5) ? -1 : 1 };
      if (!fits(p, props, -1)) continue;
      props.push(p);
      count[kn] = (count[kn] || 0) + 1;
    }
    return { theme: theme, bg: Math.floor(r() * 1e9), props: props };
  }

  // The circle that covers a difference (both places, for a move).
  function regionOf(a, b) {
    var A = boxOf(a), B = b ? boxOf(b) : A;
    var x0 = Math.min(A.x0, B.x0), y0 = Math.min(A.y0, B.y0), x1 = Math.max(A.x1, B.x1), y1 = Math.max(A.y1, B.y1);
    if (b && (a.x !== b.x || a.y !== b.y)) {
      // a move: the circle through the middle that holds both boxes
      var cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      var rr = Math.hypot(a.x - b.x, a.y - b.y) / 2 + Math.max(Math.hypot(A.x1 - A.x0, A.y1 - A.y0), Math.hypot(B.x1 - B.x0, B.y1 - B.y0)) / 2;
      return { x: Math.round(cx * 10) / 10, y: Math.round(cy * 10) / 10, r: Math.round((rr + PAD) * 10) / 10 };
    }
    return { x: Math.round((x0 + x1) / 2 * 10) / 10, y: Math.round((y0 + y1) / 2 * 10) / 10,
             r: Math.round((Math.hypot(x1 - x0, y1 - y0) / 2 + PAD) * 10) / 10 };
  }
  function circleInside(c) { return c.x - c.r >= 0 && c.y - c.r >= 0 && c.x + c.r <= VW && c.y + c.r <= VH; }
  function circlesMeet(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r + 2; }

  // One change of type ty to prop i; null when it does not fit.
  function change(ty, props, i, L, r) {
    var p = props[i], K = KINDS[p.k], q = { k: p.k, s: p.s, x: p.x, y: p.y, c: p.c, f: p.f };
    if (ty === "missing") return { after: null };
    if (ty === "color") {
      if (K.nc) return null;
      q.c = (p.c + L.hue + Math.round(r() * 30)) % 360;
      return { after: q };
    }
    if (ty === "mirror") {
      if (!K.a) return null;
      q.f = -p.f;
      return { after: q };
    }
    if (ty === "size") {
      q.s = Math.round(p.s * (r() < 0.5 ? L.grow : L.shrink) * 10) / 10;
      if (!fits(q, props, i)) { q.s = Math.round(p.s * L.shrink * 10) / 10; }
      return fits(q, props, i) ? { after: q } : null;
    }
    if (ty === "moved") {
      for (var k = 0; k < 24; k++) {
        var d = L.move * (1 + r() * 0.6), a = r() * Math.PI * 2;
        q.x = Math.round(p.x + Math.cos(a) * d);
        q.y = Math.round(p.y + Math.sin(a) * d);
        if (q.y < K.z[0] * VH - 6 || q.y > K.z[1] * VH + 6) continue;
        if (fits(q, props, i)) return { after: q };
      }
      return null;
    }
    return null;
  }

  // A puzzle for a seed and a level: the scene, the second picture and
  // exactly n differences, each in its own circle inside the picture.
  function makePuzzle(seed, lv) {
    var L = LEVEL[lv];
    for (var sub = 0; sub < 40; sub++) {
      var sc = makeScene((seed + sub * 7919) >>> 0), r = rng((seed ^ 0x5bd1e995) + sub);
      var props = sc.props, cands = [], i;
      for (i = 0; i < props.length; i++) if (sizeOf(props[i]) >= L.min) cands.push(i);
      // shuffled candidates; types in turn, starting anywhere
      for (i = cands.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), x = cands[i]; cands[i] = cands[j]; cands[j] = x; }
      var diffs = [], used = {}, ti = Math.floor(r() * TYPES.length), idle = 0;
      while (diffs.length < L.n && idle < TYPES.length) {
        var ty = TYPES[ti % TYPES.length], added = false;
        ti++;
        for (var c = 0; c < cands.length && !added; c++) {
          var idx = cands[c];
          if (used[idx]) continue;
          var ch = change(ty, props, idx, L, r);
          if (!ch) continue;
          var reg = regionOf(props[idx], ch.after);
          if (!circleInside(reg)) continue;
          var clash = false;
          for (var d = 0; d < diffs.length && !clash; d++) clash = circlesMeet(reg, diffs[d].reg);
          if (clash) continue;
          diffs.push({ i: idx, type: ty, after: ch.after, reg: reg });
          used[idx] = true;
          added = true;
        }
        idle = added ? 0 : idle + 1;
      }
      if (diffs.length !== L.n) continue;
      var propsB = props.map(function (p) { return p; });
      diffs.forEach(function (df) { propsB[df.i] = df.after; });
      diffs.sort(function (a, b) { return a.i - b.i; });
      return { seed: seed, lv: lv, theme: sc.theme, bg: sc.bg, props: props, propsB: propsB,
               diffs: diffs.map(function (df) { return { i: df.i, type: df.type, x: df.reg.x, y: df.reg.y, r: df.reg.r }; }) };
    }
    return null;
  }

  // Which difference a tap at (x, y) finds: its index, -2 when it is one
  // already found, -1 for none. extra widens every circle (fingers).
  function hitTest(diffs, found, x, y, extra) {
    var best = -1, bestD = Infinity;
    for (var i = 0; i < diffs.length; i++) {
      var d = Math.hypot(diffs[i].x - x, diffs[i].y - y) - diffs[i].r;
      if (d <= (extra || 0) && d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0 && found.indexOf(best) >= 0) return -2;
    return best;
  }

  // Three wrong taps within QUICK_MS lock the pictures.
  function shouldLock(missTimes, now) {
    var recent = missTimes.filter(function (m) { return now - m <= QUICK_MS; });
    return recent.length >= 3;
  }

  // ---------- 3. Drawing (SVG) ----------
  function hsl(h, s, l) { return "hsl(" + Math.round(((h % 360) + 360) % 360) + "," + s + "%," + l + "%)"; }

  function kindSvg(k, c) {
    var C = hsl(c, 65, 52), D = hsl(c, 55, 34), Lt = hsl(c, 75, 72);
    switch (k) {
      case "tree":
        return '<rect x="-3" y="2" width="6" height="18" rx="1.5" fill="#8a5a3b"/><circle cx="0" cy="-5" r="14" fill="' + hsl(c, 50, 38) + '"/><circle cx="-5" cy="-9" r="5" fill="' + hsl(c, 50, 48) + '"/>';
      case "pine":
        return '<rect x="-2.5" y="8" width="5" height="12" fill="#7a4e33"/><path d="M0 -20 L12 -4 L6 -4 L15 9 L-15 9 L-6 -4 L-12 -4 Z" fill="' + hsl(c, 45, 30) + '"/>';
      case "flower":
        return '<path d="M0 20 Q-2 8 0 -2" stroke="#3c8d3a" stroke-width="2.4" fill="none"/><ellipse cx="5" cy="11" rx="5" ry="2.4" transform="rotate(-30 5 11)" fill="#4caf50"/>' +
          [0, 72, 144, 216, 288].map(function (a) {
            var rad = a * Math.PI / 180;
            return '<circle cx="' + (Math.cos(rad) * 6.5).toFixed(1) + '" cy="' + (-8 + Math.sin(rad) * 6.5).toFixed(1) + '" r="5" fill="' + hsl(c, 75, 62) + '"/>';
          }).join("") + '<circle cx="0" cy="-8" r="4" fill="#f4c542"/>';
      case "bush":
        return '<circle cx="-8" cy="4" r="8" fill="' + hsl(c, 42, 34) + '"/><circle cx="8" cy="4" r="8" fill="' + hsl(c, 42, 34) + '"/><circle cx="0" cy="-2" r="10" fill="' + hsl(c, 45, 40) + '"/>';
      case "bird":
        return '<ellipse cx="-2" cy="2" rx="11" ry="7" fill="' + C + '"/><circle cx="8" cy="-4" r="6" fill="' + C + '"/><path d="M13 -5 L18 -3 L13 -1 Z" fill="#f39c12"/><circle cx="9.5" cy="-5.5" r="1.4" fill="#222"/><path d="M-6 0 Q-2 -9 4 0 Z" fill="' + D + '"/><path d="M-12 2 L-17 -2 L-16 5 Z" fill="' + D + '"/>';
      case "butterfly":
        return '<ellipse cx="-7" cy="-4" rx="7" ry="6" fill="' + C + '"/><ellipse cx="7" cy="-4" rx="7" ry="6" fill="' + C + '"/><ellipse cx="-5" cy="6" rx="5" ry="4.5" fill="' + Lt + '"/><ellipse cx="5" cy="6" rx="5" ry="4.5" fill="' + Lt + '"/><rect x="-1.2" y="-9" width="2.4" height="18" rx="1.2" fill="#3b2b20"/>';
      case "mushroom":
        return '<rect x="-4" y="0" width="8" height="15" rx="3" fill="#f3e6cf"/><path d="M-15 2 Q-15 -16 0 -16 Q15 -16 15 2 Z" fill="' + hsl(c, 70, 46) + '"/><circle cx="-7" cy="-7" r="2.6" fill="#fff"/><circle cx="3" cy="-11" r="2" fill="#fff"/><circle cx="8" cy="-4" r="1.8" fill="#fff"/>';
      case "kite":
        return '<path d="M0 -20 L11 -6 L0 8 L-11 -6 Z" fill="' + C + '"/><path d="M0 -20 V8 M-11 -6 H11" stroke="' + D + '" stroke-width="1.2"/><path d="M0 8 Q-4 13 -2 16 Q0 19 -6 20" stroke="#555" stroke-width="1" fill="none"/><path d="M-3 12 l-3 -2 l0 4 Z M-4 17 l-3 -2 l0 4 Z" fill="' + Lt + '"/>';
      case "balloon":
        return '<ellipse cx="0" cy="-7" rx="10" ry="12.5" fill="' + C + '"/><ellipse cx="-3.5" cy="-11" rx="2.6" ry="4" fill="#fff" opacity="0.45"/><path d="M-1.5 5.5 L1.5 5.5 L0 7.5 Z" fill="' + D + '"/><path d="M0 7.5 Q5 12 0 15 Q-4 18 3 20" stroke="#666" stroke-width="0.9" fill="none"/>';
      case "cloud":
        return '<g fill="#fff" opacity="0.93"><circle cx="-10" cy="3" r="7"/><circle cx="-1" cy="-3" r="9"/><circle cx="10" cy="2" r="8"/><rect x="-14" y="2" width="28" height="9" rx="4.5"/></g>';
      case "sun":
        var rays = "";
        for (var i = 0; i < 8; i++) {
          var a = i * Math.PI / 4;
          rays += '<path d="M' + (Math.cos(a) * 14).toFixed(1) + ' ' + (Math.sin(a) * 14).toFixed(1) + ' L' + (Math.cos(a) * 19).toFixed(1) + ' ' + (Math.sin(a) * 19).toFixed(1) + '"/>';
        }
        return '<g stroke="' + hsl(c, 95, 55) + '" stroke-width="2.6" stroke-linecap="round">' + rays + '</g><circle r="11" fill="' + hsl(c, 95, 60) + '"/>';
      case "duck":
        return '<ellipse cx="-2" cy="5" rx="12" ry="8" fill="' + hsl(c, 90, 58) + '"/><circle cx="7" cy="-6" r="6.5" fill="' + hsl(c, 90, 58) + '"/><path d="M12 -7 L17 -5 L12 -3 Z" fill="#e67e22"/><circle cx="8.5" cy="-7.5" r="1.3" fill="#222"/><path d="M-8 3 Q-2 -1 3 4" stroke="' + hsl(c, 80, 42) + '" stroke-width="1.6" fill="none"/>';
      case "house":
        return '<rect x="-15" y="-4" width="30" height="24" fill="' + hsl(c, 45, 68) + '"/><path d="M-18 -3 L0 -19 L18 -3 Z" fill="' + hsl(c + 180, 45, 40) + '"/><rect x="8" y="-17" width="5" height="9" fill="#7a5c4a"/><rect x="-10" y="6" width="8" height="14" fill="#7a5340"/><rect x="3" y="2" width="8" height="7" fill="#cfe9f7" stroke="#fff" stroke-width="1"/>';
      case "boat":
        return '<path d="M-18 8 L18 8 L12 18 L-12 18 Z" fill="' + C + '"/><path d="M-1 -20 V8" stroke="#5b4636" stroke-width="2"/><path d="M1 -18 L15 5 L1 5 Z" fill="#fdfdfd"/><path d="M-2 -14 L-11 5 L-2 5 Z" fill="' + Lt + '"/>';
      case "fish":
        return '<path d="M-10 0 L-18 -8 L-17 8 Z" fill="' + D + '"/><ellipse cx="2" cy="0" rx="13" ry="8.5" fill="' + C + '"/><path d="M-1 -8 Q3 -13 8 -7 Z" fill="' + D + '"/><circle cx="9" cy="-2" r="2" fill="#fff"/><circle cx="9.5" cy="-2" r="1" fill="#222"/><path d="M0 -4 Q-3 0 0 4" stroke="' + Lt + '" stroke-width="1.2" fill="none"/>';
      case "rock":
        return '<path d="M-18 12 L-14 -2 L-5 -10 L6 -9 L15 0 L18 12 Z" fill="#8a8580"/><path d="M-5 -10 L-1 2 L15 0" stroke="#6d6964" stroke-width="1.2" fill="none"/>';
      case "starfish":
        var pts = [];
        for (var s2 = 0; s2 < 10; s2++) {
          var a2 = -Math.PI / 2 + s2 * Math.PI / 5, rr2 = s2 % 2 ? 6 : 15;
          pts.push((Math.cos(a2) * rr2).toFixed(1) + "," + (Math.sin(a2) * rr2).toFixed(1));
        }
        return '<polygon points="' + pts.join(" ") + '" fill="' + hsl(c, 75, 60) + '" stroke="' + hsl(c, 70, 42) + '" stroke-width="1" stroke-linejoin="round"/>';
      case "shell":
        return '<path d="M-12 8 Q-14 -8 0 -11 Q12 -11 12 0 Q12 8 3 8 Q-4 8 -4 1 Q-4 -4 2 -4 Q6 -4 6 0" fill="' + hsl(c, 60, 72) + '" stroke="' + hsl(c, 55, 45) + '" stroke-width="1.6"/><path d="M-12 8 L12 8" stroke="' + hsl(c, 55, 45) + '" stroke-width="1.6"/>';
      case "buoy":
        return '<path d="M0 -17 V-9" stroke="#555" stroke-width="1.6"/><circle cx="0" cy="-17" r="2" fill="#f1c40f"/><path d="M-9 4 Q-9 -9 0 -9 Q9 -9 9 4 Z" fill="' + C + '"/><rect x="-9" y="-2" width="18" height="4" fill="#fff"/><rect x="-10" y="4" width="20" height="5" rx="2" fill="' + D + '"/>';
      case "crab":
        return '<g stroke="' + hsl(c, 70, 38) + '" stroke-width="1.8" fill="none"><path d="M-8 4 L-15 9 M-8 6 L-13 11 M8 4 L15 9 M8 6 L13 11 M-7 -2 L-12 -7 M7 -2 L12 -7"/></g><circle cx="-13" cy="-8" r="3.6" fill="' + hsl(c, 75, 52) + '"/><circle cx="13" cy="-8" r="3.6" fill="' + hsl(c, 75, 52) + '"/><ellipse cx="0" cy="2" rx="10" ry="7" fill="' + hsl(c, 75, 52) + '"/><circle cx="-3" cy="-4" r="1.4" fill="#222"/><circle cx="3" cy="-4" r="1.4" fill="#222"/>';
      case "jelly":
        return '<path d="M-11 0 Q-11 -16 0 -16 Q11 -16 11 0 Z" fill="' + hsl(c, 65, 70) + '" opacity="0.9"/><g stroke="' + hsl(c, 55, 58) + '" stroke-width="1.6" fill="none"><path d="M-7 0 Q-10 6 -6 11 Q-3 16 -7 18"/><path d="M0 0 Q-3 7 1 11 Q4 16 0 18"/><path d="M7 0 Q4 6 8 11 Q11 16 7 18"/></g>';
      case "car":
        return '<path d="M-19 4 Q-19 -2 -13 -2 L-9 -9 Q-7 -11 -3 -11 L6 -11 Q9 -11 11 -8 L14 -2 Q19 -2 19 3 L19 6 L-19 6 Z" fill="' + C + '"/><path d="M-7 -8 L-3 -9 L0 -9 L0 -3 L-10 -3 Z M3 -9 L6 -9 L10 -3 L3 -3 Z" fill="#cfe9f7"/><circle cx="-10" cy="6" r="4.5" fill="#2b2b2b"/><circle cx="10" cy="6" r="4.5" fill="#2b2b2b"/><circle cx="-10" cy="6" r="1.8" fill="#aaa"/><circle cx="10" cy="6" r="1.8" fill="#aaa"/><rect x="16" y="0" width="3" height="2.4" fill="#ffe08a"/>';
      case "bus":
        return '<rect x="-20" y="-11" width="40" height="18" rx="3" fill="' + C + '"/><g fill="#cfe9f7"><rect x="-17" y="-8" width="6" height="6"/><rect x="-9" y="-8" width="6" height="6"/><rect x="-1" y="-8" width="6" height="6"/></g><rect x="9" y="-8" width="7" height="15" fill="' + D + '"/><circle cx="-12" cy="7" r="4.2" fill="#2b2b2b"/><circle cx="11" cy="7" r="4.2" fill="#2b2b2b"/>';
      case "lamp":
        return '<rect x="-1.6" y="-14" width="3.2" height="34" fill="#4a4a52"/><path d="M0 -14 Q0 -20 7 -18" stroke="#4a4a52" stroke-width="2.6" fill="none"/><path d="M3 -17 L11 -17 L9 -12 L5 -12 Z" fill="#4a4a52"/><ellipse cx="7" cy="-11" rx="3" ry="2" fill="' + hsl(c, 95, 66) + '"/><rect x="-4" y="17" width="8" height="3" fill="#4a4a52"/>';
      case "cat":
        return '<path d="M5 14 Q14 14 11 4 Q10 0 12 -2" stroke="' + hsl(c, 55, 42) + '" stroke-width="2.6" fill="none" stroke-linecap="round"/><ellipse cx="-1" cy="7" rx="7" ry="9" fill="' + hsl(c, 60, 52) + '"/><circle cx="-1" cy="-7" r="6" fill="' + hsl(c, 60, 52) + '"/><path d="M-6 -10 L-6 -16 L-2 -12 Z M4 -10 L4 -16 L0 -12 Z" fill="' + hsl(c, 60, 52) + '"/><circle cx="-3" cy="-7" r="1" fill="#222"/><circle cx="1" cy="-7" r="1" fill="#222"/>';
      case "sign":
        return '<rect x="-1.5" y="-10" width="3" height="30" fill="#6d6d74"/><path d="M-12 -18 L6 -18 L13 -12 L6 -6 L-12 -6 Z" fill="' + C + '"/><path d="M-8 -12 H5" stroke="#fff" stroke-width="2"/>';
      case "hydrant":
        return '<rect x="-6" y="-8" width="12" height="22" rx="2" fill="' + hsl(c, 80, 46) + '"/><path d="M-7 -8 Q0 -16 7 -8 Z" fill="' + hsl(c, 80, 40) + '"/><rect x="-10" y="-2" width="20" height="4" rx="2" fill="' + hsl(c, 80, 40) + '"/><rect x="-8" y="13" width="16" height="3" fill="#555"/>';
      case "pot":
        return '<path d="M-8 4 L8 4 L6 17 L-6 17 Z" fill="' + hsl(c, 60, 45) + '"/><rect x="-9" y="2" width="18" height="3" fill="' + hsl(c, 60, 38) + '"/><g fill="#3f9a4a"><ellipse cx="-4" cy="-6" rx="3.5" ry="8" transform="rotate(-20 -4 -6)"/><ellipse cx="4" cy="-6" rx="3.5" ry="8" transform="rotate(20 4 -6)"/><ellipse cx="0" cy="-9" rx="3" ry="8"/></g>';
      case "planet":
        return '<circle r="11" fill="' + C + '"/><path d="M-11 -2 Q0 -5 11 -2" stroke="' + D + '" stroke-width="2" fill="none" opacity="0.6"/><ellipse rx="20" ry="5" transform="rotate(-18)" fill="none" stroke="' + Lt + '" stroke-width="2.4"/><path d="M-10.2 4 A11 11 0 0 0 10.2 4" fill="' + C + '" transform="rotate(-18)" opacity="0"/>';
      case "moon":
        return '<path d="M4 -16 A16 16 0 1 0 4 16 A12 12 0 1 1 4 -16 Z" fill="' + hsl(c, 50, 80) + '" transform="translate(-4 0)"/><circle cx="-9" cy="4" r="2" fill="' + hsl(c, 30, 65) + '"/>';
      case "rocket":
        return '<g transform="rotate(25)"><path d="M0 -20 Q8 -10 7 8 L-7 8 Q-8 -10 0 -20 Z" fill="#eceff4"/><circle cx="0" cy="-6" r="3.6" fill="' + C + '" stroke="#5b6170" stroke-width="1.2"/><path d="M-7 2 L-12 12 L-7 9 Z M7 2 L12 12 L7 9 Z" fill="' + C + '"/><path d="M-4 8 L0 17 L4 8 Z" fill="#f39c12"/></g>';
      case "ufo":
        return '<ellipse cx="0" cy="-3" rx="8" ry="7" fill="' + hsl(c, 60, 75) + '" opacity="0.9"/><ellipse cx="0" cy="2" rx="20" ry="6" fill="' + C + '"/><circle cx="-11" cy="2" r="1.6" fill="#fff59d"/><circle cx="0" cy="4" r="1.6" fill="#fff59d"/><circle cx="11" cy="2" r="1.6" fill="#fff59d"/>';
      case "comet":
        return '<path d="M5 -3 L-20 -11 L-16 -5 L-20 -1 Z" fill="' + hsl(c, 80, 75) + '" opacity="0.75"/><path d="M5 3 L-18 4 L-12 0 Z" fill="' + hsl(c, 80, 65) + '" opacity="0.6"/><circle cx="9" cy="0" r="8" fill="' + hsl(c, 85, 82) + '"/>';
      case "satellite":
        return '<rect x="-20" y="-5" width="13" height="10" fill="' + hsl(c, 60, 45) + '"/><path d="M-20 0 H-7 M-14 -5 V5" stroke="' + hsl(c, 60, 72) + '" stroke-width="0.8"/><rect x="-6" y="-6" width="11" height="12" rx="1.5" fill="#cfd4dc"/><path d="M5 0 H10" stroke="#cfd4dc" stroke-width="2"/><path d="M10 -9 Q20 0 10 9 Z" fill="#eceff4"/>';
      case "bigstar":
        var sp = [];
        for (var s3 = 0; s3 < 10; s3++) {
          var a3 = -Math.PI / 2 + s3 * Math.PI / 5, rr3 = s3 % 2 ? 5.6 : 14;
          sp.push((Math.cos(a3) * rr3).toFixed(1) + "," + (Math.sin(a3) * rr3).toFixed(1));
        }
        return '<polygon points="' + sp.join(" ") + '" fill="' + hsl(c, 95, 70) + '"/>';
      case "asteroid":
        return '<path d="M-13 -2 L-8 -11 L4 -12 L13 -4 L12 7 L2 12 L-10 9 Z" fill="#9b8f84"/><circle cx="-4" cy="-4" r="3" fill="#7d736a"/><circle cx="5" cy="4" r="2.2" fill="#7d736a"/>';
    }
    return "";
  }

  function propSvg(p) {
    var k = p.s / 20;
    return '<g transform="translate(' + p.x + ' ' + p.y + ') scale(' + (k * p.f).toFixed(3) + ' ' + k.toFixed(3) + ')">' + kindSvg(p.k, p.c) + '</g>';
  }

  // The background of a theme (the same in both pictures); id makes the
  // gradient ids unique per picture.
  function bgSvg(theme, bgSeed, id) {
    var r = rng(bgSeed), s = "", i;
    function grad(name, a, b) {
      return '<defs><linearGradient id="' + id + name + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient></defs>';
    }
    if (theme === "park") {
      s += grad("sky", "#8fcbef", "#e1f2fb") + '<rect width="400" height="300" fill="url(#' + id + 'sky)"/>';
      s += '<ellipse cx="' + Math.round(80 + r() * 60) + '" cy="168" rx="170" ry="52" fill="#93c96f"/><ellipse cx="' + Math.round(280 + r() * 60) + '" cy="172" rx="180" ry="46" fill="#82bd5f"/>';
      s += '<rect y="160" width="400" height="140" fill="#6fae4f"/><path d="M' + Math.round(150 + r() * 60) + ' 300 Q' + Math.round(180 + r() * 60) + ' 230 ' + Math.round(250 + r() * 60) + ' 160 L' + Math.round(262 + r() * 40) + ' 160 Q' + Math.round(230 + r() * 40) + ' 240 ' + Math.round(230 + r() * 50) + ' 300 Z" fill="#d9c79b" opacity="0.8"/>';
    } else if (theme === "sea") {
      s += grad("sky", "#9ed8f4", "#e8f7ff") + grad("sea", "#3ea1d8", "#164f8a") + '<rect width="400" height="300" fill="url(#' + id + 'sky)"/>';
      s += '<rect y="118" width="400" height="182" fill="url(#' + id + 'sea)"/>';
      for (i = 0; i < 7; i++) {
        var wx = Math.round(r() * 360), wy = Math.round(132 + r() * 40);
        s += '<path d="M' + wx + ' ' + wy + ' q8 -5 16 0 q8 5 16 0" stroke="#ffffff" stroke-width="1.4" fill="none" opacity="0.45"/>';
      }
      s += '<path d="M0 262 Q100 ' + Math.round(250 + r() * 10) + ' 200 262 T400 260 V300 H0 Z" fill="#e3cf9a"/>';
    } else if (theme === "city") {
      s += grad("sky", "#ffcf99", "#fff0de") + '<rect width="400" height="300" fill="url(#' + id + 'sky)"/>';
      var x = -10;
      while (x < 400) {
        var bw = Math.round(34 + r() * 40), bh = Math.round(70 + r() * 90), tone = Math.round(r() * 3);
        var col = ["#8d7f9e", "#a08e9f", "#7c7391", "#9a8a86"][tone];
        s += '<rect x="' + x + '" y="' + (205 - bh) + '" width="' + bw + '" height="' + bh + '" fill="' + col + '"/>';
        for (var wy2 = 205 - bh + 8; wy2 < 195; wy2 += 14) {
          for (var wx2 = x + 6; wx2 < x + bw - 8; wx2 += 11) {
            s += '<rect x="' + wx2 + '" y="' + wy2 + '" width="6" height="7" fill="' + (r() < 0.3 ? "#ffe9a8" : "#c9c2d6") + '" opacity="0.85"/>';
          }
        }
        x += bw + Math.round(r() * 6);
      }
      s += '<rect y="205" width="400" height="20" fill="#bfb7aa"/><rect y="225" width="400" height="75" fill="#64646d"/>';
      for (i = 0; i < 8; i++) s += '<rect x="' + (i * 52 + 8) + '" y="261" width="26" height="3" fill="#e8e3d6" opacity="0.8"/>';
    } else {
      s += grad("sky", "#0a0f2e", "#1b2152") + '<rect width="400" height="300" fill="url(#' + id + 'sky)"/>';
      s += '<ellipse cx="' + Math.round(80 + r() * 240) + '" cy="' + Math.round(80 + r() * 140) + '" rx="120" ry="50" fill="#6a3d9a" opacity="0.18"/>';
      for (i = 0; i < 70; i++) {
        s += '<circle cx="' + Math.round(r() * 400) + '" cy="' + Math.round(r() * 300) + '" r="' + (0.5 + r()).toFixed(1) + '" fill="#fff" opacity="' + (0.35 + r() * 0.6).toFixed(2) + '"/>';
      }
    }
    return s;
  }

  // One picture: background and objects, sorted top to bottom.
  function pictureSvg(pz, which) {
    var list = (which === "b" ? pz.propsB : pz.props).filter(function (p) { return !!p; });
    list = list.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    return bgSvg(pz.theme, pz.bg, "sp" + which) + list.map(propSvg).join("");
  }

  // ---------- 4. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                       // max-merged
  //   rows: { <deviceId>: { b: <epoch>,
  //                         s: { l1|l2|l3: { t: best time ms, ts: when, w: wins } } } }
  // }
  // Each device only ever writes ITS OWN row; a row counts from epoch b.
  // Merge per row: the newer epoch wins; equal epochs take, per level,
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
    LEVELS.forEach(function (k) {
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
    LEVELS.forEach(function (k) {
      var a = x.s[k], c = y.s[k];
      if (!a && !c) return;
      s[k] = (a && c) ? joinCell(a, c) : normCell(a || c);
    });
    return { b: x.b, s: s };
  }

  function mergeSpot(A, B) {
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

  // Best time and wins for a level, across every device.
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
          data = mergeSpot(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] spot: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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
    data = mergeSpot(data, data);
    save();
    return !before.t || tm < before.t;
  }

  // ---------- 5. Device-local prefs + session ----------
  var prefs = { lv: "l1" };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object" && LEVELS.indexOf(p.lv) >= 0) prefs.lv = p.lv;
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = { lv, seed, found: [diff index…], el (ms, incl. penalties),
  //          misses, hints, over }
  var game = null, puzzle = null;

  function validSession(g) {
    if (!g || typeof g !== "object" || LEVELS.indexOf(g.lv) < 0 || !isInt(g.seed) || g.seed < 0 ||
        g.seed > MAX_SEED || !Array.isArray(g.found) || !isInt(g.el) || g.el < 0 || g.el > MAX_TIME ||
        !isInt(g.misses) || g.misses < 0 || !isInt(g.hints) || g.hints < 0 || typeof g.over !== "boolean") return false;
    var n = LEVEL[g.lv].n, seen = {};
    for (var i = 0; i < g.found.length; i++) {
      var f = g.found[i];
      if (!isInt(f) || f < 0 || f >= n || seen[f]) return false;
      seen[f] = true;
    }
    return g.over === (g.found.length === n);
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
  var runFrom = 0;       // when the clock last started (0 = stopped)
  var missTimes = [];    // recent wrong taps (ms)
  var lockUntil = 0;
  var hintAt = -1, hintTimer = 0;
  var cursor = { x: VW / 2, y: VH / 2, on: false };

  function newSeed() { return Math.floor(rand() * MAX_SEED); }

  function fresh(lv) {
    var seed = newSeed(), pz = makePuzzle(seed, lv);
    for (var k = 0; !pz && k < 10; k++) { seed = newSeed(); pz = makePuzzle(seed, lv); }
    return { game: { lv: lv, seed: seed, found: [], el: 0, misses: 0, hints: 0, over: false }, puzzle: pz };
  }
  function inProgress() { return !!(game && !game.over && (game.found.length || game.misses || game.hints || elapsed() > 5000)); }

  function elapsed() {
    if (!game) return 0;
    return game.el + (runFrom ? Date.now() - runFrom : 0);
  }
  function stopClock() {
    if (runFrom && game) game.el = Math.min(MAX_TIME, game.el + Date.now() - runFrom);
    runFrom = 0;
  }
  function clockRun() {
    var go = !!(game && !game.over && document.visibilityState !== "hidden");
    if (go && !runFrom) runFrom = Date.now();
    if (!go && runFrom) { game.el = Math.min(MAX_TIME, game.el + Date.now() - runFrom); runFrom = 0; }
  }
  function addTime(ms) {
    stopClock();
    game.el = Math.min(MAX_TIME, game.el + ms);
    clockRun();
  }

  function setGame(g, pz) {
    game = g;
    puzzle = pz || makePuzzle(g.seed, g.lv);
    missTimes = []; lockUntil = 0; hintAt = -1; clearTimeout(hintTimer);
  }

  // A game in progress is never lost silently: Undo toast (R14).
  function newGame(announce, msg) {
    closeDialogs();
    stopClock();
    var prev = inProgress() ? JSON.parse(JSON.stringify(game)) : null;
    var f = fresh(prefs.lv);
    setGame(f.game, f.puzzle);
    saveSession();
    renderAll(true);
    clockRun();
    if (prev) {
      undoToast(msg || t("toast.newgame"), function () {
        prefs.lv = prev.lv; savePrefs();
        stopClock();
        setGame(prev, null);
        saveSession();
        renderAll(true);
        clockRun();
      });
    } else if (announce) {
      live(msg || t("toast.newgame"));
    }
  }

  // A tap at picture point (x, y) on picture which ("a" / "b").
  function tapAt(x, y, which, extra) {
    if (!game || document.querySelector("dialog[open]")) return;
    if (game.over) { showToast(t("toast.over")); return; }                       // R28
    var now = Date.now();
    if (now < lockUntil) { showToast(t("toast.locked")); shakePics(); return; }
    var hit = hitTest(puzzle.diffs, game.found, x, y, extra);
    if (hit === -2) { showToast(t("toast.already")); return; }
    if (hit >= 0) {
      game.found.push(hit);
      if (hintAt === hit) { hintAt = -1; clearTimeout(hintTimer); }
      sfx("found");
      if (game.found.length === puzzle.diffs.length) { win(); return; }
      saveSession();
      renderAll(false);
      live(t("live.found", { f: game.found.length, n: puzzle.diffs.length }));
      return;
    }
    // a miss: time, a mark, maybe a lock
    game.misses++;
    addTime(MISS_MS);
    missTimes.push(now);
    missTimes = missTimes.filter(function (m) { return now - m <= QUICK_MS; });
    sfx("miss");
    missMark(x, y, which);
    if (shouldLock(missTimes, now)) {
      missTimes = [];
      lockUntil = now + LOCK_MS;
      showToast(t("toast.lock"));
      renderStatus();
      $("pics").classList.add("locked");
      setTimeout(function () { $("pics").classList.remove("locked"); renderStatus(); }, LOCK_MS);
    } else {
      live(t("live.miss"));
    }
    saveSession();
    renderStatus();
  }

  function showHint() {
    if (!game || document.querySelector("dialog[open]")) return;
    if (game.over) { showToast(t("toast.over")); return; }
    var left = [];
    for (var i = 0; i < puzzle.diffs.length; i++) if (game.found.indexOf(i) < 0) left.push(i);
    hintAt = left[Math.floor(rand() * left.length)];
    game.hints++;
    addTime(HINT_MS);
    saveSession();
    renderAll(false);
    sfx("hint");
    live(t("live.hint"));
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { hintAt = -1; renderMarks(); }, 3000);
  }

  function win() {
    stopClock();
    game.el = Math.round(game.el);
    game.over = true;
    hintAt = -1;
    var rec = countWin(game.lv, game.el);
    saveSession();
    renderAll(false);
    sfx("win");
    live(t("live.won", { n: puzzle.diffs.length, t: fmtTime(game.el) }));
    setTimeout(function () { resultDialog(rec); }, 500);
  }

  // ---------- 7. Render ----------
  function renderAll(rebuild) {
    renderToolbar();
    renderStatus();
    if (rebuild) renderPictures();
    renderMarks();
  }

  function renderToolbar() {
    [].forEach.call(document.querySelectorAll("#lv-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-lv") === (game ? game.lv : prefs.lv);
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    $("hint-btn").disabled = !game || game.over;
    paintSfxBtn();
  }

  var usedKeys = false;
  function renderStatus() {
    if (!game) return;
    var n = puzzle.diffs.length, left = n - game.found.length;
    $("found").textContent = game.found.length + "/" + n;
    tick();
    var msg, cls = "";
    if (game.over) { msg = t("turn.won"); cls = "done"; }
    else if (Date.now() < lockUntil) { msg = t("turn.lock"); cls = "warn"; }
    else if (!game.found.length && !game.misses) msg = t(usedKeys ? "turn.keys" : "turn.play");
    else msg = left === 1 ? t("turn.one") : t("turn.left", { n: left });
    $("turn").textContent = msg;
    $("turn").className = cls;
    ["a", "b"].forEach(function (w) {
      $("pic-" + w).setAttribute("aria-label", t("pic.label", { p: t("pic." + w), theme: t("theme." + puzzle.theme), f: game.found.length, n: n }));
    });
  }
  function tick() { if (game) $("time").textContent = fmtTime(elapsed()); }

  var SVG_NS = "http://www.w3.org/2000/svg";
  function renderPictures() {
    ["a", "b"].forEach(function (w) {
      var svg = $("pic-" + w);
      svg.innerHTML = '<g class="art">' + pictureSvg(puzzle, w) + '</g><g class="marks"></g>';
    });
  }

  function circleEl(x, y, r, cls) {
    var c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", r);
    c.setAttribute("class", cls);
    return c;
  }

  // Found circles, the hint and the keyboard crosshair, on both pictures.
  function renderMarks() {
    ["a", "b"].forEach(function (w) {
      var g = $("pic-" + w).querySelector(".marks");
      if (!g) return;
      while (g.firstChild) g.removeChild(g.firstChild);
      game.found.forEach(function (i) {
        var d = puzzle.diffs[i];
        g.appendChild(circleEl(d.x, d.y, d.r + 1, "halo"));
        g.appendChild(circleEl(d.x, d.y, d.r, "found"));
      });
      if (hintAt >= 0) {
        var h = puzzle.diffs[hintAt];
        g.appendChild(circleEl(h.x, h.y, h.r + 14, "hint"));
      }
      if (cursor.on && !game.over) {
        var p = document.createElementNS(SVG_NS, "path");
        var x = cursor.x, y = cursor.y;
        p.setAttribute("d", "M" + (x - 12) + " " + y + " H" + (x - 4) + " M" + (x + 4) + " " + y + " H" + (x + 12) +
          " M" + x + " " + (y - 12) + " V" + (y - 4) + " M" + x + " " + (y + 4) + " V" + (y + 12));
        p.setAttribute("class", "cross");
        g.appendChild(p);
        g.appendChild(circleEl(x, y, 7, "cross-ring"));
      }
    });
  }

  function missMark(x, y, which) {
    if (reduced) return;
    var g = $("pic-" + which).querySelector(".marks");
    if (!g) return;
    var p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", "M" + (x - 7) + " " + (y - 7) + " L" + (x + 7) + " " + (y + 7) + " M" + (x + 7) + " " + (y - 7) + " L" + (x - 7) + " " + (y + 7));
    p.setAttribute("class", "miss");
    g.appendChild(p);
    setTimeout(function () { if (p.parentNode) p.parentNode.removeChild(p); }, 700);
  }

  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

  function shakePics() {
    if (reduced) return;
    var el = $("pics");
    el.classList.remove("shake");
    void el.offsetWidth;
    el.classList.add("shake");
    setTimeout(function () { el.classList.remove("shake"); }, 300);
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
    if (!game || !game.over) return;           // replaced meanwhile
    closeDialogs();
    var s = totals(game.lv);
    var dlg = makeDialog("spot-result");
    dlg.appendChild(el("div", "dlg-title", t("res.title") + " · " + t("lvn." + game.lv)));
    dlg.appendChild(el("div", "dlg-hero", fmtTime(game.el)));
    if (rec) dlg.appendChild(el("div", "dlg-badge", t("res.rec")));
    dlg.appendChild(row(t("res.misses"), game.misses + " · " + game.hints));
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

  function statsDialog() {
    var dlg = makeDialog("spot-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    LEVELS.forEach(function (k) {
      var s = totals(k);
      if (s.w) empty = false;
      dlg.appendChild(row(t("lv." + k), s.w ? fmtTime(s.t) + " · " + s.w : "–"));
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
    var dlg = makeDialog("spot-confirm");
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
    data = mergeSpot(data, data);
    save();
    renderStatus();
    showToast(t("toast.reset"));
  }

  // ---------- 9. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "spot", title: String(text) })) return;
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
      if (kind === "found") { tone(660, 0, 0.07, "triangle", 0.12); tone(990, 0.06, 0.1, "triangle", 0.1); }
      else if (kind === "miss") tone(170, 0, 0.14, "square", 0.06);
      else if (kind === "hint") tone(520, 0, 0.12, "sine", 0.12);
      else if (kind === "win") [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Toolbar icons (R9: injected by JS) ----------
  var UI_ICONS = {
    new:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    hint:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/></svg>',
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
    ["a", "b"].forEach(function (w) {
      var svg = $("pic-" + w);
      svg.addEventListener("pointerdown", function (e) {
        if (e.button !== undefined && e.button !== 0) return;
        var r = svg.getBoundingClientRect();
        if (!r.width) return;
        var x = (e.clientX - r.left) / r.width * VW, y = (e.clientY - r.top) / r.height * VH;
        // a finger is less precise than a mouse: the circles count wider
        var extra = (e.pointerType === "touch" || coarse) ? 8 : 3;
        if (cursor.on) { cursor.on = false; renderMarks(); }
        tapAt(x, y, w, extra);
      });
    });
  }

  var ARROWS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  var CURSOR_STEP = 8;

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;   // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      if (ARROWS[e.code]) {
        e.preventDefault();
        if (!game || game.over) { if (game) showToast(t("toast.over")); return; }
        var d = ARROWS[e.code], step = e.repeat ? CURSOR_STEP * 1.5 : CURSOR_STEP;
        if (!usedKeys) { usedKeys = true; renderStatus(); }
        if (cursor.on) {
          cursor.x = Math.max(0, Math.min(VW, cursor.x + d[0] * step));
          cursor.y = Math.max(0, Math.min(VH, cursor.y + d[1] * step));
        }
        cursor.on = true;
        renderMarks();
        return;
      }
      var onBtn = tag === "BUTTON";
      if ((e.code === "Enter" || e.code === "NumpadEnter" || e.code === "Space") && cursor.on && !onBtn) {
        e.preventDefault();
        if (!e.repeat) tapAt(cursor.x, cursor.y, "b", 3);
        return;
      }
      if (e.repeat || e.shiftKey) return;
      if (e.code === "KeyN") { e.preventDefault(); newGame(true); return; }
      if (e.code === "KeyH") { e.preventDefault(); showHint(); return; }
      if (e.code === "Escape" && cursor.on) { cursor.on = false; renderMarks(); }
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
    api.registerSlice("spot", sliceGet, sliceSet, STORAGE_KEY, mergeSpot);
  }

  function sliceGet() {
    return mergeSpot(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeSpot(incoming, incoming);
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
    [["hint-btn", "hint", "btn.hint"], ["new-btn", "new", "btn.new"],
     ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    paintSfxBtn();
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#lv-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () {
        var lv = b.getAttribute("data-lv");
        if (game && lv === game.lv && !game.over) return;   // visible active state
        prefs.lv = lv; savePrefs(); newGame(true, t("toast.level"));
      });
    });
    $("hint-btn").addEventListener("click", showHint);
    $("new-btn").addEventListener("click", function () { newGame(true); $("new-btn").blur(); });
    $("stats-btn").addEventListener("click", statsDialog);
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("found");   // audible confirmation when turned on
    });
    wirePointer();

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
    var g = loadSession(), pz = g ? makePuzzle(g.seed, g.lv) : null;
    if (g && pz) { setGame(g, pz); prefs.lv = g.lv; savePrefs(); }   // the resumed game decides the toolbar
    else { var f = fresh(prefs.lv); setGame(f.game, f.puzzle); saveSession(); }
    renderAll(true);
    clockRun();
  }

  boot();
})();
