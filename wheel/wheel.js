// ============================================================
// orOS Wheel of Fate — App logic (v1.0.0)
// A decision wheel: write the options, spin, let fate speak.
//   - 2–30 options, edited live (the wheel follows as you type)
//   - the winner is drawn first (crypto, fair), the spin only
//     lands there; ticks on every divider, confetti at the end
//   - "Remove from the wheel" for one-by-one draws (Undo)
//   - ready sets; your own wheels (synced); winners history
//     per wheel (this device only)
// Data:
//   - synced slice "wheel" (oros-wheel-data): saved wheels LWW +
//     tombstones (R5, R17, R26)
//   - device-local (R10): oros-wheel-prefs (open wheel, draft,
//     sound), oros-wheel-history (winners per wheel)
// Sections:
//   1. Constants, i18n, helpers
//   2. Wheel model: normalize, ready sets
//   3. Saved wheels: normalize, merge
//   4. Fair draw + spin geometry
//   5. Storage, prefs, history
//   6. Drawing
//   7. Spin: animation, ticks, sound, result
//   8. UI: options editor, sets, my wheels, history, toolbar
//   9. Dialogs + toasts
//  10. Keyboard (Contract Β)
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-wheel-data";
  var PREFS_KEY   = "oros-wheel-prefs";
  var HIST_KEY    = "oros-wheel-history";
  var DATA_VER    = 1;
  var MIN_OPTS    = 2;
  var MAX_OPTS    = 30;
  var OPT_LEN     = 50;
  var NAME_LEN    = 40;
  var MAX_WHEELS  = 40;
  var HIST_MAX    = 50;
  var HIST_WHEELS = 50;
  var DRAFT       = "_draft";
  var TAU         = Math.PI * 2;
  var MAX_W       = 3;          // an option can have double or triple chance
  var COLORS = ["#e85d75", "#f29e4c", "#f1c453", "#8bc34a", "#2ec4b6",
                "#3a86ff", "#7b61ff", "#c86bfa", "#ff7eb6", "#4dabf7"];

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = window.orosI18n ? window.orosI18n.lang() : appLang();

  var STRINGS = {
    en: {
      "spin": "Spin!", "spin.aria": "Spin the wheel (Space)", "spinning": "Spinning…",
      "sec.opts": "Options", "sec.sets": "Ready sets", "sec.mine": "My wheels", "sec.hist": "Winners",
      "opt.add": "Add an option…", "opt.aria": "Option {n}", "opt.del": "Remove option {n}",
      "opt.move": "Move option {n} (drag, or Alt + arrows)", "opt.count": "{n} of {max}",
      "opt.weight": "Chance of option {n}: {w}. Tap to change", "w.1": "normal", "w.2": "double", "w.3": "triple",
      "opt.need": "Add at least two options to spin.", "opt.full": "Up to {max} options",
      "draft": "New wheel", "btn.save": "Save wheel", "btn.new": "New wheel",
      "btn.sound": "Sound", "btn.shuffle": "Shuffle options",
      "mine.empty": "Save a wheel to keep it here.",
      "mine.rename": "Rename {name}", "mine.copy": "Copy {name}", "mine.del": "Delete {name}",
      "hist.empty": "No winners yet.", "hist.clear": "Clear",
      "res.title": "The wheel has spoken", "res.again": "Spin again", "res.remove": "Remove from the wheel",
      "res.close": "Close",
      "dlg.saveTitle": "Save wheel", "dlg.renameTitle": "Rename wheel", "dlg.name": "Name",
      "dlg.save": "Save", "dlg.cancel": "Cancel", "copy.suffix": "{name} (copy)",
      "toast.saved": "Wheel saved", "toast.deleted": "Wheel deleted", "toast.undo": "Undo",
      "toast.removed": "“{w}” left the wheel", "toast.cleared": "Winners cleared",
      "toast.newWheel": "New wheel", "toast.maxWheels": "Up to {n} saved wheels",
      "toast.save": "Could not save: storage is full", "toast.needName": "Give the wheel a name",
      "toast.min": "A wheel needs at least two options",
      "live.winner": "Winner: {w}",
      "set.yesno": "Yes / No", "set.food": "What to eat", "set.days": "Days of the week",
      "set.nums": "Numbers 1–10", "set.coin": "Heads or tails", "set.chores": "Chores",
      "set.movie": "Movie night", "set.todo": "What to do", "set.first": "Who goes first"
    },
    el: {
      "spin": "Γύρνα!", "spin.aria": "Γύρνα τον τροχό (Space)", "spinning": "Γυρίζει…",
      "sec.opts": "Επιλογές", "sec.sets": "Έτοιμα σετ", "sec.mine": "Οι τροχοί μου", "sec.hist": "Νικητές",
      "opt.add": "Πρόσθεσε επιλογή…", "opt.aria": "Επιλογή {n}", "opt.del": "Αφαίρεση επιλογής {n}",
      "opt.move": "Μετακίνηση επιλογής {n} (σύρε, ή Alt + βελάκια)", "opt.count": "{n} από {max}",
      "opt.weight": "Πιθανότητα επιλογής {n}: {w}. Πάτα για αλλαγή", "w.1": "κανονική", "w.2": "διπλή", "w.3": "τριπλή",
      "opt.need": "Πρόσθεσε τουλάχιστον δύο επιλογές για να γυρίσεις.", "opt.full": "Έως {max} επιλογές",
      "draft": "Νέος τροχός", "btn.save": "Αποθήκευση τροχού", "btn.new": "Νέος τροχός",
      "btn.sound": "Ήχος", "btn.shuffle": "Ανακάτεμα επιλογών",
      "mine.empty": "Αποθήκευσε έναν τροχό για να τον κρατήσεις εδώ.",
      "mine.rename": "Μετονομασία: {name}", "mine.copy": "Αντίγραφο: {name}", "mine.del": "Διαγραφή: {name}",
      "hist.empty": "Κανένας νικητής ακόμα.", "hist.clear": "Καθάρισμα",
      "res.title": "Ο τροχός αποφάσισε", "res.again": "Ξανά", "res.remove": "Βγάλ' τον από τον τροχό",
      "res.close": "Κλείσιμο",
      "dlg.saveTitle": "Αποθήκευση τροχού", "dlg.renameTitle": "Μετονομασία τροχού", "dlg.name": "Όνομα",
      "dlg.save": "Αποθήκευση", "dlg.cancel": "Άκυρο", "copy.suffix": "{name} (αντίγραφο)",
      "toast.saved": "Ο τροχός αποθηκεύτηκε", "toast.deleted": "Ο τροχός διαγράφηκε", "toast.undo": "Αναίρεση",
      "toast.removed": "Το «{w}» βγήκε από τον τροχό", "toast.cleared": "Οι νικητές καθαρίστηκαν",
      "toast.newWheel": "Νέος τροχός", "toast.maxWheels": "Έως {n} αποθηκευμένοι τροχοί",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος", "toast.needName": "Δώσε ένα όνομα στον τροχό",
      "toast.min": "Ο τροχός θέλει τουλάχιστον δύο επιλογές",
      "live.winner": "Νικητής: {w}",
      "set.yesno": "Ναι / Όχι", "set.food": "Τι θα φάμε", "set.days": "Μέρες της εβδομάδας",
      "set.nums": "Αριθμοί 1–10", "set.coin": "Κορώνα ή γράμματα", "set.chores": "Δουλειές του σπιτιού",
      "set.movie": "Βραδιά ταινίας", "set.todo": "Τι να κάνω", "set.first": "Ποιος παίζει πρώτος"
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "wheel", LANG);

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) {
      Object.keys(params).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(params[k]));
      });
    }
    return s;
  }

  function $(id) { return document.getElementById(id); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }

  function newId() {
    var r = new Uint32Array(2);
    crypto.getRandomValues(r);
    return Date.now().toString(36) + r[0].toString(36) + r[1].toString(36).slice(0, 4);
  }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("wheel.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Wheel model ----------
  // One option: text, spaces collapsed, ≤ 50. Empty ones drop out.
  function normOpt(s) {
    return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, OPT_LEN) : "";
  }
  function normOpts(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (s) {
      var o = normOpt(s);
      if (o && out.length < MAX_OPTS) out.push(o);
    });
    return out;
  }
  function normName(s) {
    return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, NAME_LEN) : "";
  }

  var SET_IDS = ["yesno", "food", "days", "nums", "coin", "chores", "movie", "todo", "first"];
  // Ready-set options, one key per option ("seto.<set>.<n>", pack
  // "wheel"). Picking a set copies them into the draft; a saved wheel
  // keeps its own text. SETS[lang][set] = [options] is built from it.
  var SET_TEXT = {
    en: {
      "seto.yesno.1": "Yes", "seto.yesno.2": "No",
      "seto.food.1": "Pizza", "seto.food.2": "Burger", "seto.food.3": "Souvlaki", "seto.food.4": "Pasta", "seto.food.5": "Salad", "seto.food.6": "Sushi",
      "seto.days.1": "Monday", "seto.days.2": "Tuesday", "seto.days.3": "Wednesday", "seto.days.4": "Thursday", "seto.days.5": "Friday", "seto.days.6": "Saturday", "seto.days.7": "Sunday",
      "seto.nums.1": "1", "seto.nums.2": "2", "seto.nums.3": "3", "seto.nums.4": "4", "seto.nums.5": "5", "seto.nums.6": "6", "seto.nums.7": "7", "seto.nums.8": "8", "seto.nums.9": "9", "seto.nums.10": "10",
      "seto.coin.1": "Heads", "seto.coin.2": "Tails",
      "seto.chores.1": "Dishes", "seto.chores.2": "Laundry", "seto.chores.3": "Vacuum", "seto.chores.4": "Trash", "seto.chores.5": "Shopping",
      "seto.movie.1": "Comedy", "seto.movie.2": "Action", "seto.movie.3": "Drama", "seto.movie.4": "Horror", "seto.movie.5": "Animation", "seto.movie.6": "Documentary",
      "seto.todo.1": "Go for a walk", "seto.todo.2": "Read", "seto.todo.3": "Board game", "seto.todo.4": "Cook something", "seto.todo.5": "Call a friend", "seto.todo.6": "Take a nap",
      "seto.first.1": "Player 1", "seto.first.2": "Player 2", "seto.first.3": "Player 3", "seto.first.4": "Player 4"
    },
    el: {
      "seto.yesno.1": "Ναι", "seto.yesno.2": "Όχι",
      "seto.food.1": "Πίτσα", "seto.food.2": "Μπέργκερ", "seto.food.3": "Σουβλάκι", "seto.food.4": "Μακαρόνια", "seto.food.5": "Σαλάτα", "seto.food.6": "Σούσι",
      "seto.days.1": "Δευτέρα", "seto.days.2": "Τρίτη", "seto.days.3": "Τετάρτη", "seto.days.4": "Πέμπτη", "seto.days.5": "Παρασκευή", "seto.days.6": "Σάββατο", "seto.days.7": "Κυριακή",
      "seto.nums.1": "1", "seto.nums.2": "2", "seto.nums.3": "3", "seto.nums.4": "4", "seto.nums.5": "5", "seto.nums.6": "6", "seto.nums.7": "7", "seto.nums.8": "8", "seto.nums.9": "9", "seto.nums.10": "10",
      "seto.coin.1": "Κορώνα", "seto.coin.2": "Γράμματα",
      "seto.chores.1": "Πιάτα", "seto.chores.2": "Πλυντήριο", "seto.chores.3": "Σκούπα", "seto.chores.4": "Σκουπίδια", "seto.chores.5": "Ψώνια",
      "seto.movie.1": "Κωμωδία", "seto.movie.2": "Δράση", "seto.movie.3": "Δράμα", "seto.movie.4": "Τρόμου", "seto.movie.5": "Κινούμενα σχέδια", "seto.movie.6": "Ντοκιμαντέρ",
      "seto.todo.1": "Βόλτα", "seto.todo.2": "Διάβασμα", "seto.todo.3": "Επιτραπέζιο", "seto.todo.4": "Μαγείρεμα", "seto.todo.5": "Τηλέφωνο σε φίλο", "seto.todo.6": "Υπνάκος",
      "seto.first.1": "Παίκτης 1", "seto.first.2": "Παίκτης 2", "seto.first.3": "Παίκτης 3", "seto.first.4": "Παίκτης 4"
    }
  };
  if (typeof window !== "undefined" && window.orosI18n) window.orosI18n.table(SET_TEXT, "wheel", LANG);
  var SETS = {};
  Object.keys(SET_TEXT).forEach(function (l) {
    SETS[l] = {};
    SET_IDS.forEach(function (id) {
      var list = [];
      for (var n = 1; SET_TEXT[l]["seto." + id + "." + n] !== undefined; n++) list.push(SET_TEXT[l]["seto." + id + "." + n]);
      SETS[l][id] = list;
    });
  });
  function setOpts(id) { return (SETS[LANG] || SETS.en)[id].slice(); }

  // Segment colours: the palette in turn; the last never matches the
  // first (they touch), nor its neighbour.
  function segColor(i, n) {
    var c = i % COLORS.length;
    if (n > 1 && i === n - 1 && c === 0) c = (n - 2) % COLORS.length === 1 ? 2 : 1;
    return COLORS[c];
  }
  // Black or white text, whichever reads better on the colour.
  function inkFor(hex) {
    var v = parseInt(hex.slice(1), 16);
    var lin = function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    var L = 0.2126 * lin(v >> 16 & 255) + 0.7152 * lin(v >> 8 & 255) + 0.0722 * lin(v & 255);
    return L > 0.33 ? "#1b1b1b" : "#ffffff";
  }

  // Weights: { option text: 2 | 3 } (×1 is the default and is not
  // stored). Keyed by text, so moving, shuffling or deleting rows
  // needs no bookkeeping; equal texts share their weight. Canonical:
  // only texts on the wheel, in sorted order.
  function normW(map, opts) {
    var out = {}, m = map && typeof map === "object" ? map : {};
    var seen = {};
    (opts || []).slice().sort(cmpStr).forEach(function (o) {
      if (seen[o]) return;
      seen[o] = 1;
      var v = Object.prototype.hasOwnProperty.call(m, o) ? m[o] : 1;
      if (isInt(v) && v >= 2 && v <= MAX_W) out[o] = v;
    });
    return out;
  }
  function weightsOf(opts, map) {
    var w = normW(map, opts);
    return opts.map(function (o) { return w[o] || 1; });
  }
  function hasW(map) { return !!map && Object.keys(map).length > 0; }

  // ---------- 3. Saved wheels ----------
  // saved = { id, m (mtime, ms), name, opts[2..30], w? (weights) }
  // data  = { ver: 1, wheels: [saved…] sorted by id, tombs: { id: deletedAt } }
  var ID_RE = /^[a-z0-9]{6,40}$/;

  function normSaved(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
        !isInt(x.m) || x.m < 0) return null;
    var name = normName(x.name), opts = normOpts(x.opts);
    if (!name || opts.length < MIN_OPTS) return null;
    var out = { id: x.id, m: x.m, name: name, opts: opts };
    var w = normW(x.w, opts);
    if (hasW(w)) out.w = w;
    return out;
  }

  // LWW per wheel (newer m wins; equal m: the larger canonical JSON),
  // tombstones max-merged, delete wins ties, a newer edit resurrects
  // (R17). Symmetric and canonical (R5, R26).
  function mergeWheel(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object") return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    var best = {};
    [a.wheels, b.wheels].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var x = normSaved(raw);
        if (!x) return;
        var cur = best[x.id];
        if (!cur || x.m > cur.m ||
            (x.m === cur.m && JSON.stringify(x) > JSON.stringify(cur))) best[x.id] = x;
      });
    });
    var wheels = [];
    Object.keys(best).sort(cmpStr).forEach(function (id) {
      if (id in tombs && tombs[id] >= best[id].m) return;
      wheels.push(best[id]);
    });
    var sortedTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sortedTombs[id] = tombs[id]; });
    return { ver: DATA_VER, wheels: wheels, tombs: sortedTombs };
  }

  // ---------- 4. Fair draw + spin geometry ----------
  // Uniform integer in [0, n): rejection sampling, no modulo bias.
  function randInt(n) {
    var lim = Math.floor(4294967296 / n) * n, r = new Uint32Array(1);
    do { crypto.getRandomValues(r); } while (r[0] >= lim);
    return r[0] % n;
  }
  function rand01() { return randInt(1000000) / 1000000; }

  // A weighted draw: option i wins with probability ws[i] / Σws.
  function pickWeighted(ws) {
    var total = 0, i;
    for (i = 0; i < ws.length; i++) total += ws[i];
    var r = randInt(total);
    for (i = 0; i < ws.length; i++) { r -= ws[i]; if (r < 0) return i; }
    return ws.length - 1;
  }

  // Segment edges as angles from the pointer: segment i covers
  // [edges[i], edges[i+1]). Equal slices without weights; with
  // weights, a ×2 option gets a slice twice as wide.
  function segEdges(n, ws) {
    var e = [0], total = 0, i, acc = 0;
    for (i = 0; i < n; i++) total += ws && ws[i] ? ws[i] : 1;
    for (i = 0; i < n; i++) { acc += ws && ws[i] ? ws[i] : 1; e.push(i === n - 1 ? TAU : TAU * acc / total); }
    return e;
  }

  // The wheel turns clockwise by `rot` radians; segment i covers its
  // edges clockwise from the pointer (top) at rot = 0.
  function mod(a, m) { return ((a % m) + m) % m; }
  function pointerIndex(rot, n, ws) {
    var a = mod(-rot, TAU), e = segEdges(n, ws);
    for (var i = 0; i < n; i++) if (a < e[i + 1]) return i;
    return n - 1;
  }
  // Where a spin from `rot0` ends so that segment `win` is under the
  // pointer, `frac` (0–1) into it, after `turns` full turns.
  function spinTarget(rot0, win, n, frac, turns, ws) {
    var e = segEdges(n, ws);
    var want = mod(-(e[win] + frac * (e[win + 1] - e[win])), TAU);
    return rot0 + turns * TAU + mod(want - rot0, TAU);
  }
  // Ease-out cubic: fast start, long slow finish.
  function easeOut(x) { x = x < 0 ? 0 : (x > 1 ? 1 : x); return 1 - Math.pow(1 - x, 3); }

  // ---------- 5. Storage, prefs, history ----------
  var data = null, prefs = null, hist = null;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.wheels)) {
          data = mergeWheel(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] wheel: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = { ver: DATA_VER, wheels: [], tombs: {} };
  }

  var saveFailShown = false;
  function saveNow() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    p = (p && typeof p === "object") ? p : {};
    var draft = Array.isArray(p.draft) ? p.draft.filter(function (s) { return typeof s === "string"; })
                                               .map(function (s) { return s.slice(0, OPT_LEN); }).slice(0, MAX_OPTS) : null;
    prefs = {
      cur: typeof p.cur === "string" && ID_RE.test(p.cur) ? p.cur : null,
      draft: draft && draft.length ? draft : setOpts("food"),
      dw: draft && draft.length ? normW(p.dw, normOpts(draft)) : {},
      sound: p.sound === 0 ? 0 : 1
    };
  }
  var prefsTimer = null;
  function savePrefs() { clearTimeout(prefsTimer); prefsTimer = setTimeout(savePrefsNow, 300); }
  function savePrefsNow() {
    clearTimeout(prefsTimer); prefsTimer = null;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // history = { <wheel id | "_draft">: [{ w, t }] newest first, ≤ 50 }
  function loadHist() {
    var h = null;
    try { h = JSON.parse(localStorage.getItem(HIST_KEY) || "null"); } catch (e) {}
    hist = {};
    if (!h || typeof h !== "object") return;
    Object.keys(h).forEach(function (k) {
      if (!Array.isArray(h[k])) return;
      var rows = h[k].filter(function (r) { return r && typeof r.w === "string" && r.w && isInt(r.t); })
                     .slice(0, HIST_MAX).map(function (r) { return { w: normOpt(r.w), t: r.t }; });
      if (rows.length) hist[k] = rows;
    });
  }
  function saveHist() {
    var keys = Object.keys(hist);
    if (keys.length > HIST_WHEELS) {           // forget the wheels spun longest ago
      keys.sort(function (a, b) { return hist[b][0].t - hist[a][0].t; });
      keys.slice(HIST_WHEELS).forEach(function (k) { delete hist[k]; });
    }
    try { localStorage.setItem(HIST_KEY, JSON.stringify(hist)); } catch (e) {}
  }

  // ---------- current wheel ----------
  // `rows` is what the editor shows (may hold an empty row while
  // typing); the wheel is drawn from normOpts(rows).
  var rows = [];
  var wts = {};             // weights of the open wheel (by option text)

  function curSaved() {
    if (!prefs.cur) return null;
    for (var i = 0; i < data.wheels.length; i++) if (data.wheels[i].id === prefs.cur) return data.wheels[i];
    return null;
  }
  function histKey() { return curSaved() ? prefs.cur : DRAFT; }
  function curOpts() { return normOpts(rows); }
  function curW() { return normW(wts, curOpts()); }
  function copyMap(m) { var o = {}; Object.keys(m || {}).forEach(function (k) { o[k] = m[k]; }); return o; }

  function loadCurrent() {
    var w = curSaved();
    if (!w) prefs.cur = null;
    rows = w ? w.opts.slice() : prefs.draft.slice();
    wts = copyMap(w ? w.w : prefs.dw);
  }

  // Store the rows into the open wheel (saved: debounced write + sync).
  var editTimer = null;
  function storeRows() {
    var w = curSaved();
    if (!w) { prefs.draft = rows.slice(); prefs.dw = curW(); savePrefs(); return; }
    clearTimeout(editTimer);
    editTimer = setTimeout(storeSavedNow, 600);
  }
  function storeSavedNow() {
    clearTimeout(editTimer); editTimer = null;
    var w = curSaved(), opts = curOpts(), cw = curW();
    if (!w || opts.length < MIN_OPTS ||
        (JSON.stringify(opts) === JSON.stringify(w.opts) && JSON.stringify(cw) === JSON.stringify(w.w || {}))) return;
    w.opts = opts;
    if (hasW(cw)) w.w = cw; else delete w.w;
    w.m = Math.max(Date.now(), w.m + 1);
    data = mergeWheel(data, data);
    saveNow();
  }

  // ---------- 6. Drawing ----------
  var cv = null, g = null, size = 0, rot = 0;

  function resize() {
    var box = $("wheel-box");
    if (!box) return;
    var r = box.getBoundingClientRect();
    var s = Math.max(120, Math.floor(Math.min(r.width, r.height)));
    var dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.style.width = cv.style.height = s + "px";
    cv.width = cv.height = Math.round(s * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    size = s;
    $("wheel-wrap").style.setProperty("--wheel", s + "px");
    draw();
  }

  function fitText(text, maxW, px) {
    g.font = "800 " + px + "px Nunito, 'Segoe UI', system-ui, sans-serif";
    if (g.measureText(text).width <= maxW) return text;
    var s = text;
    while (s.length > 1 && g.measureText(s + "…").width > maxW) s = s.slice(0, -1);
    return s.replace(/\s+$/, "") + "…";
  }

  function draw() {
    if (!g || !size) return;
    var opts = drawnOpts(), n = opts.length, e = segEdges(n, drawnWts());
    var c = size / 2, R = c - 4;
    g.clearRect(0, 0, size, size);
    var css = getComputedStyle(document.documentElement);
    var border = css.getPropertyValue("--border").trim() || "#322d20";
    var panel = css.getPropertyValue("--panel-bg").trim() || "#1d1a13";
    if (n < MIN_OPTS) {
      g.beginPath(); g.arc(c, c, R, 0, TAU);
      g.fillStyle = panel; g.fill();
      g.lineWidth = 2; g.setLineDash([8, 8]); g.strokeStyle = border; g.stroke(); g.setLineDash([]);
      return;
    }
    var base = -Math.PI / 2 + rot;
    for (var i = 0; i < n; i++) {
      var a0 = base + e[i], a1 = base + e[i + 1], s = a1 - a0, col = segColor(i, n);
      g.beginPath(); g.moveTo(c, c); g.arc(c, c, R, a0, a1); g.closePath();
      g.fillStyle = col; g.fill();
      g.lineWidth = Math.max(1, size / 260); g.strokeStyle = "rgba(0,0,0,0.25)"; g.stroke();
      // label, radial, from the hub out to the rim
      g.save();
      g.translate(c, c);
      var mid = a0 + s / 2;
      var inner = R * 0.3, maxW = R - inner - 16;
      var px = Math.max(9, Math.min(size / 18, inner * s * 0.9, 28));
      var txt = fitText(opts[i], maxW, px);
      g.fillStyle = inkFor(col);
      g.textBaseline = "middle";
      if (opts[i].length <= 3) {             // short labels (numbers, Yes / No) stand upright: 6 never reads 9
        g.font = "900 " + Math.round(Math.min(size / 11, R * s * 0.5, 40)) + "px Nunito, 'Segoe UI', system-ui, sans-serif";
        g.textAlign = "center";
        g.fillText(opts[i], Math.cos(mid) * R * 0.72, Math.sin(mid) * R * 0.72);
      } else if (Math.cos(mid) < -0.01) {            // left half: turn the label so it never reads upside down
        g.rotate(mid + Math.PI);
        g.textAlign = "left";
        g.fillText(txt, -(R - 12), 0);
      } else {
        g.rotate(mid);
        g.textAlign = "right";
        g.fillText(txt, R - 12, 0);
      }
      g.restore();
    }
    // rim + pegs on the dividers
    g.beginPath(); g.arc(c, c, R, 0, TAU);
    g.lineWidth = Math.max(3, size / 90); g.strokeStyle = border; g.stroke();
    var peg = Math.max(2, size / 110);
    for (var k = 0; k < n; k++) {
      var a = base + e[k];
      g.beginPath(); g.arc(c + Math.cos(a) * (R - peg * 1.6), c + Math.sin(a) * (R - peg * 1.6), peg, 0, TAU);
      g.fillStyle = "#ffffff"; g.fill();
    }
  }

  // ---------- 7. Spin ----------
  var spinning = false, spinOpts = null, spinWts = null, spinWin = -1, lastIdx = -1;

  // While a spin runs, the wheel shows the options it started with.
  function drawnOpts() { return spinning && spinOpts ? spinOpts : curOpts(); }
  function drawnWts() { return spinning && spinWts ? spinWts : weightsOf(curOpts(), wts); }

  function reducedMotion() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
  }

  function spin() {
    if (spinning || document.querySelector("dialog[open]")) return;
    storeSavedNow();
    var opts = curOpts(), n = opts.length;
    if (n < MIN_OPTS) { showToast(t("toast.min")); return; }
    ensureAudio();
    spinning = true;
    spinOpts = opts;
    spinWts = weightsOf(opts, wts);
    spinWin = pickWeighted(spinWts);                       // fate first, animation second
    var reduced = reducedMotion();
    var dur = reduced ? 1000 : 4000 + randInt(2001);
    var turns = reduced ? 1 : 4 + randInt(3);
    var r0 = mod(rot, TAU), r1 = spinTarget(r0, spinWin, n, 0.12 + 0.76 * rand01(), turns, spinWts);
    rot = r0;
    lastIdx = pointerIndex(rot, n, spinWts);
    setBusy(true);
    var t0 = performance.now();
    function frame(now) {
      var x = (now - t0) / dur;
      rot = r0 + (r1 - r0) * easeOut(x);
      var idx = pointerIndex(rot, n, spinWts);
      if (idx !== lastIdx) { lastIdx = idx; tick(); }
      draw();
      if (x < 1) { requestAnimationFrame(frame); return; }
      rot = mod(r1, TAU);
      draw();
      finish();
    }
    requestAnimationFrame(frame);
  }

  function finish() {
    var w = spinOpts[spinWin];
    spinning = false;
    spinOpts = null;
    spinWts = null;
    setBusy(false);
    var key = histKey();
    hist[key] = [{ w: w, t: Date.now() }].concat(hist[key] || []).slice(0, HIST_MAX);
    saveHist();
    renderHist();
    jingle();
    live(t("live.winner", { w: w }));
    confetti();
    resultDialog(w);
  }

  function setBusy(on) {
    document.body.classList.toggle("spinning", on);
    var b = $("spin-btn");
    b.textContent = on ? t("spinning") : t("spin");
    b.disabled = on;
    [].forEach.call(document.querySelectorAll("#panel input, #panel button, #tb-b button"), function (x) {
      if (x.id === "sound-btn") return;
      x.disabled = on;
    });
    if (!on) renderOpts();
  }

  function pointerBounce() {
    var p = $("pointer");
    p.classList.remove("hit");
    void p.offsetWidth;
    p.classList.add("hit");
  }

  // Sound: a short click per divider and a small jingle at the end.
  var actx = null, lastTick = 0;
  function ensureAudio() {
    if (!prefs.sound) return;
    try {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!actx && C) actx = new C();
      if (actx && actx.state === "suspended" && actx.resume) actx.resume();
    } catch (e) { actx = null; }
  }
  function blip(at, f, d, peak, type) {
    var o = actx.createOscillator(), gg = actx.createGain();
    o.type = type || "triangle";
    o.frequency.setValueAtTime(f, at);
    gg.gain.setValueAtTime(0.0001, at);
    gg.gain.linearRampToValueAtTime(peak, at + 0.003);
    gg.gain.exponentialRampToValueAtTime(0.0001, at + d);
    o.connect(gg); gg.connect(actx.destination);
    o.start(at); o.stop(at + d + 0.02);
  }
  function tick() {
    pointerBounce();
    if (!prefs.sound || !actx) return;
    var now = performance.now();
    if (now - lastTick < 35) return;           // fast spins: no buzz
    lastTick = now;
    try { blip(actx.currentTime, 1800 + randInt(300), 0.03, 0.12, "square"); } catch (e) {}
  }
  function jingle() {
    if (!prefs.sound || !actx) return;
    try {
      var at = actx.currentTime + 0.02;
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) { blip(at + i * 0.09, f, 0.25, 0.12); });
    } catch (e) {}
  }

  function confetti() {
    if (reducedMotion()) return;
    var host = $("confetti");
    host.innerHTML = "";
    for (var i = 0; i < 80; i++) {
      var p = el("i");
      p.style.left = (rand01() * 100) + "%";
      p.style.background = COLORS[i % COLORS.length];
      p.style.setProperty("--dx", (rand01() * 160 - 80) + "px");
      p.style.setProperty("--rz", (rand01() * 720 - 360) + "deg");
      p.style.animationDelay = (rand01() * 0.4) + "s";
      p.style.animationDuration = (1.8 + rand01() * 1.2) + "s";
      host.appendChild(p);
    }
    clearTimeout(confetti.timer);
    confetti.timer = setTimeout(function () { host.innerHTML = ""; }, 3600);
  }

  function resultDialog(w) {
    var dlg = makeDialog("wh-result");
    dlg.classList.add("res-dlg");
    dlg.appendChild(el("div", "dlg-title", t("res.title")));
    var big = el("div", "res-win", w);
    dlg.appendChild(big);
    var acts = el("div", "dlg-actions res-actions");
    var opts = curOpts();
    if (opts.length > MIN_OPTS && opts.indexOf(w) >= 0) {
      acts.appendChild(button(t("res.remove"), "", function () { dlg.close(); removeOption(w); }));
    }
    acts.appendChild(button(t("res.close"), "", function () { dlg.close(); }));
    var again = button(t("res.again"), "primary", function () { dlg.close(); setTimeout(spin, 0); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    again.focus();
  }

  // ---------- 8. UI ----------
  var UI = {
    sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
    mute:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
    save:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/></svg>',
    plus:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
    grip:  '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
    edit:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    copy:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    x:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>'
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function iconBtn(cls, svg, label, fn) {
    var b = el("button", cls);
    b.type = "button";
    b.innerHTML = svg;
    b.setAttribute("aria-label", label);
    b.title = label;
    if (fn) b.addEventListener("click", fn);
    return b;
  }

  function changed() {
    storeRows();
    draw();
    renderCount();
    renderSets();
    renderToolbar();
  }

  // Options editor
  function renderOpts() {
    var host = $("opts");
    var focusIdx = -1, caret = 0;
    var a = document.activeElement;
    if (a && a.classList && a.classList.contains("opt-in")) {
      focusIdx = parseInt(a.getAttribute("data-i"), 10);
      caret = a.selectionStart || 0;
    }
    host.innerHTML = "";
    rows.forEach(function (val, i) {
      var li = el("li", "opt");
      li.setAttribute("data-i", i);
      li.style.setProperty("--sw", segColorFor(i));
      var grip = iconBtn("grip", UI.grip, t("opt.move", { n: i + 1 }));
      grip.tabIndex = -1;
      wireDrag(grip, li);
      var inp = el("input", "opt-in");
      inp.value = val;
      inp.maxLength = OPT_LEN;
      inp.setAttribute("data-i", i);
      inp.setAttribute("aria-label", t("opt.aria", { n: i + 1 }));
      inp.autocomplete = "off";
      inp.addEventListener("input", function () {
        var was = normOpt(rows[i]), now = normOpt(inp.value);
        rows[i] = inp.value;
        // the weight follows the text being typed (unless another row keeps the old text)
        if (was !== now && wts[was] && curOpts().indexOf(was) < 0 && !wts[now]) { wts[now] = wts[was]; }
        if (was !== now && curOpts().indexOf(was) < 0) delete wts[was];
        changed();
        renderWeight(li, i);
      });
      inp.addEventListener("paste", function (e) { pasteLines(e, i); });
      inp.addEventListener("blur", function () {
        if (!normOpt(rows[i]) && rows.length > 1 && !document.body.classList.contains("dragging")) {
          setTimeout(function () {
            if (i < rows.length && !normOpt(rows[i]) && document.activeElement !== inp) {
              rows.splice(i, 1); changed(); renderOpts();
            }
          }, 0);
        }
      });
      inp.addEventListener("keydown", function (e) {
        if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          moveRow(i, i + (e.key === "ArrowUp" ? -1 : 1), true);
        } else if (e.key === "Enter") {
          e.preventDefault();
          var nx = document.querySelector('.opt-in[data-i="' + (i + 1) + '"]');
          (nx || $("add-in")).focus();
        }
      });
      var wb = el("button", "mini wt");
      wb.type = "button";
      wb.addEventListener("click", function () { cycleWeight(i); });
      var del = iconBtn("mini danger", UI.x, t("opt.del", { n: i + 1 }), function () { deleteRow(i); });
      li.appendChild(grip); li.appendChild(inp); li.appendChild(wb); li.appendChild(del);
      renderWeight(li, i);
      host.appendChild(li);
    });
    if (focusIdx >= 0) {
      var f = document.querySelector('.opt-in[data-i="' + Math.min(focusIdx, rows.length - 1) + '"]');
      if (f) { f.focus(); try { f.setSelectionRange(caret, caret); } catch (e) {} }
    }
    renderCount();
  }

  // ×1 / ×2 / ×3 next to each row: the option's chance.
  function renderWeight(li, i) {
    var b = li.querySelector(".wt"), o = normOpt(rows[i]), w = (o && wts[o]) || 1;
    if (!b) return;
    b.textContent = "×" + w;
    b.classList.toggle("on", w > 1);
    b.disabled = !o || spinning;
    b.setAttribute("aria-label", t("opt.weight", { n: i + 1, w: t("w." + w) }));
    b.title = b.getAttribute("aria-label");
  }
  function cycleWeight(i) {
    var o = normOpt(rows[i]);
    if (!o || spinning) return;
    var w = ((wts[o] || 1) % MAX_W) + 1;
    if (w === 1) delete wts[o]; else wts[o] = w;
    changed();
    [].forEach.call(document.querySelectorAll(".opt"), function (li) {
      renderWeight(li, parseInt(li.getAttribute("data-i"), 10));
    });
    live(t("opt.weight", { n: i + 1, w: t("w." + w) }).split(".")[0]);
  }

  // The swatch next to a row shows its segment colour (empty rows: none).
  function segColorFor(i) {
    var k = -1, n = curOpts().length;
    for (var j = 0; j <= i; j++) if (normOpt(rows[j])) k++;
    return normOpt(rows[i]) ? segColor(k, n) : "transparent";
  }

  function renderCount() {
    var n = curOpts().length;
    $("opt-count").textContent = t("opt.count", { n: n, max: MAX_OPTS });
    $("opt-need").hidden = n >= MIN_OPTS;
    var full = rows.length >= MAX_OPTS;
    $("add-in").disabled = full || spinning;
    $("add-in").placeholder = full ? t("opt.full", { max: MAX_OPTS }) : t("opt.add");
    $("spin-btn").disabled = spinning || n < MIN_OPTS;
    [].forEach.call(document.querySelectorAll(".opt"), function (li) {
      li.style.setProperty("--sw", segColorFor(parseInt(li.getAttribute("data-i"), 10)));
    });
  }

  function addLines(lines, at) {
    var room = MAX_OPTS - rows.length, added = 0;
    lines.forEach(function (s) {
      var o = normOpt(s);
      if (!o) return;
      if (added >= room) return;
      rows.splice(at + added, 0, o);
      added++;
    });
    if (lines.some(function (s) { return normOpt(s); }) && added < lines.filter(function (s) { return normOpt(s); }).length) {
      showToast(t("opt.full", { max: MAX_OPTS }));
    }
    return added;
  }

  // New wheel rows start empty; text added below fills their places.
  function dropEmptyRows() { rows = rows.filter(function (s) { return normOpt(s); }); }

  function pasteLines(e, i) {
    var txt = (e.clipboardData && e.clipboardData.getData("text")) || "";
    if (txt.indexOf("\n") < 0) return;
    e.preventDefault();
    var lines = txt.split(/\r?\n/);
    if (i === null) {
      dropEmptyRows();
      addLines(lines, rows.length);
    } else {
      rows[i] = lines.shift();
      addLines(lines, i + 1);
    }
    changed();
    renderOpts();
  }

  function addFromInput() {
    var inp = $("add-in"), v = normOpt(inp.value);
    if (!v) return;
    dropEmptyRows();
    if (rows.length >= MAX_OPTS) { showToast(t("opt.full", { max: MAX_OPTS })); return; }
    rows.push(v);
    inp.value = "";
    changed();
    renderOpts();
    inp.focus();
  }

  function deleteRow(i) {
    var gone = rows[i];
    rows.splice(i, 1);
    changed();
    renderOpts();
    if (normOpt(gone) && curOpts().length < MIN_OPTS) live(t("opt.need"));
  }

  function moveRow(from, to, keepFocus) {
    if (to < 0 || to >= rows.length || from === to) return;
    var v = rows.splice(from, 1)[0];
    rows.splice(to, 0, v);
    changed();
    renderOpts();
    if (keepFocus) {
      var f = document.querySelector('.opt-in[data-i="' + to + '"]');
      if (f) f.focus();
    }
  }

  // Drag a row by its grip (mouse and touch).
  function wireDrag(grip, li) {
    grip.addEventListener("pointerdown", function (e) {
      if (spinning) return;
      e.preventDefault();
      var from = parseInt(li.getAttribute("data-i"), 10), to = from;
      var items = [].slice.call(document.querySelectorAll(".opt"));
      var y0 = e.clientY, h = li.getBoundingClientRect().height + 6;
      document.body.classList.add("dragging");
      li.classList.add("drag");
      try { grip.setPointerCapture(e.pointerId); } catch (err) {}
      function move(ev) {
        var dy = ev.clientY - y0;
        to = Math.max(0, Math.min(items.length - 1, from + Math.round(dy / h)));
        li.style.transform = "translateY(" + dy + "px)";
        items.forEach(function (it, k) {
          var shift = 0;
          if (k !== from) {
            if (from < to && k > from && k <= to) shift = -h;
            if (from > to && k < from && k >= to) shift = h;
          }
          if (it !== li) it.style.transform = shift ? "translateY(" + shift + "px)" : "";
        });
      }
      function up() {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        grip.removeEventListener("pointercancel", up);
        document.body.classList.remove("dragging");
        items.forEach(function (it) { it.style.transform = ""; it.classList.remove("drag"); });
        if (to !== from) moveRow(from, to, false);
      }
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", up);
    });
  }

  function shuffleRows() {
    for (var i = rows.length - 1; i > 0; i--) {
      var j = randInt(i + 1), x = rows[i];
      rows[i] = rows[j]; rows[j] = x;
    }
    changed();
    renderOpts();
  }

  // "Remove from the wheel" (result dialog), with Undo.
  function removeOption(w) {
    var i = -1;
    rows.forEach(function (s, k) { if (i < 0 && normOpt(s) === w) i = k; });
    if (i < 0 || curOpts().length <= MIN_OPTS) return;
    var before = rows.slice();
    rows.splice(i, 1);
    changed();
    renderOpts();
    undoToast(t("toast.removed", { w: w }), function () {
      rows = before;
      changed();
      renderOpts();
    });
  }

  // Ready sets: load into a fresh draft (a saved wheel stays as it is).
  function buildSets() {
    var host = $("sets");
    host.innerHTML = "";
    SET_IDS.forEach(function (id) {
      var b = el("button", "chip", t("set." + id));
      b.type = "button";
      b.setAttribute("data-s", id);
      b.addEventListener("click", function () { openDraft(setOpts(id)); });
      host.appendChild(b);
    });
  }
  function renderSets() {
    var mine = JSON.stringify(curOpts());
    [].forEach.call(document.querySelectorAll("#sets .chip"), function (b) {
      var on = !curSaved() && JSON.stringify(setOpts(b.getAttribute("data-s"))) === mine;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function openDraft(opts) {
    storeSavedNow();
    var was = { cur: prefs.cur, draft: prefs.draft.slice(), dw: copyMap(prefs.dw), rows: rows.slice(), wts: copyMap(wts) };
    prefs.cur = null;
    prefs.draft = opts.slice();
    prefs.dw = {};
    rows = opts.slice();
    wts = {};
    savePrefs();
    renderAll();
    return was;
  }

  function newWheel() {
    var was = openDraft(["", ""]);
    var f = document.querySelector('.opt-in[data-i="0"]');
    if (f) f.focus();
    if (!was.cur && normOpts(was.draft).length) {
      undoToast(t("toast.newWheel"), function () {
        prefs.cur = null;
        prefs.draft = was.draft;
        prefs.dw = was.dw;
        rows = was.rows;
        wts = was.wts;
        savePrefs();
        renderAll();
      });
    }
  }

  function openSaved(id) {
    storeSavedNow();
    if (!curSaved()) { prefs.draft = rows.slice(); prefs.dw = curW(); }
    prefs.cur = id;
    loadCurrent();
    savePrefs();
    renderAll();
  }

  // My wheels
  function renderMine() {
    var host = $("mine");
    host.innerHTML = "";
    $("mine-empty").hidden = data.wheels.length > 0;
    data.wheels.slice().sort(function (a, b) { return cmpStr(a.name.toLowerCase(), b.name.toLowerCase()) || cmpStr(a.id, b.id); })
      .forEach(function (x) {
        var row = el("div", "mine-row");
        var b = el("button", "chip mine-chip", x.name);
        b.type = "button";
        var on = x.id === prefs.cur;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
        b.addEventListener("click", function () { openSaved(x.id); });
        row.appendChild(b);
        row.appendChild(iconBtn("mini", UI.edit, t("mine.rename", { name: x.name }), function () { nameDialog(x); }));
        row.appendChild(iconBtn("mini", UI.copy, t("mine.copy", { name: x.name }), function () { copyWheel(x); }));
        row.appendChild(iconBtn("mini danger", UI.x, t("mine.del", { name: x.name }), function () { deleteWheel(x.id); }));
        host.appendChild(row);
      });
  }

  function copyWheel(x) {
    if (data.wheels.length >= MAX_WHEELS) { showToast(t("toast.maxWheels", { n: MAX_WHEELS })); return; }
    storeSavedNow();
    var id = newId();
    data.wheels.push({ id: id, m: Date.now(), name: normName(t("copy.suffix", { name: x.name })), opts: x.opts.slice(), w: copyMap(x.w) });
    data = mergeWheel(data, data);
    saveNow();
    openSaved(id);
  }

  function deleteWheel(id) {
    var x = null;
    data.wheels.forEach(function (y) { if (y.id === id) x = y; });
    if (!x) return;
    storeSavedNow();
    var snapshot = JSON.parse(JSON.stringify(x));
    var wasOpen = prefs.cur === id;
    data.tombs[id] = Math.max(Date.now(), x.m);
    data = mergeWheel(data, data);
    saveNow();
    if (wasOpen) {                          // keep its options on the desk as a draft
      prefs.cur = null;
      prefs.draft = snapshot.opts.slice();
      prefs.dw = copyMap(snapshot.w);
      rows = snapshot.opts.slice();
      wts = copyMap(snapshot.w);
      savePrefs();
    }
    renderAll();
    undoToast(t("toast.deleted"), function () {
      // R17: a fresh mtime beats the tombstone
      snapshot.m = Math.max(Date.now(), (data.tombs[snapshot.id] || 0) + 1);
      data.wheels.push(snapshot);
      data = mergeWheel(data, data);
      saveNow();
      if (wasOpen) { prefs.cur = snapshot.id; loadCurrent(); savePrefs(); }
      renderAll();
    });
  }

  // Winners history (this device)
  function fmtTime(ts) {
    try {
      var d = new Date(ts), now = new Date();
      var opt = d.toDateString() === now.toDateString()
        ? { hour: "2-digit", minute: "2-digit" }
        : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
      return d.toLocaleString(window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB"), opt);
    } catch (e) { return ""; }
  }
  function renderHist() {
    var host = $("hist"), list = hist[histKey()] || [];
    host.innerHTML = "";
    list.forEach(function (r) {
      var li = el("li");
      li.appendChild(el("span", "h-w", r.w));
      li.appendChild(el("time", "h-t", fmtTime(r.t)));
      host.appendChild(li);
    });
    $("hist-empty").hidden = list.length > 0;
    $("hist-clear").hidden = list.length === 0;
  }
  function clearHist() {
    var key = histKey(), before = hist[key];
    if (!before) return;
    delete hist[key];
    saveHist();
    renderHist();
    undoToast(t("toast.cleared"), function () { hist[key] = before; saveHist(); renderHist(); });
  }

  function renderToolbar() {
    var w = curSaved();
    $("wheel-name").textContent = w ? w.name : t("draft");
    $("save-btn").hidden = !!w;
    var sb = $("sound-btn");
    sb.innerHTML = prefs.sound ? UI.sound : UI.mute;
    sb.setAttribute("aria-pressed", prefs.sound ? "true" : "false");
    sb.classList.toggle("on", !!prefs.sound);
  }

  function renderAll() {
    renderToolbar();
    renderOpts();
    renderSets();
    renderMine();
    renderHist();
    draw();
  }

  // ---------- 9. Dialogs + toasts ----------
  function nameDialog(existing) {
    if (!existing && data.wheels.length >= MAX_WHEELS) { showToast(t("toast.maxWheels", { n: MAX_WHEELS })); return; }
    if (!existing && curOpts().length < MIN_OPTS) { showToast(t("toast.min")); return; }
    var dlg = makeDialog("wh-name");
    dlg.appendChild(el("div", "dlg-title", t(existing ? "dlg.renameTitle" : "dlg.saveTitle")));
    var form = el("form");
    form.method = "dialog";
    var lab = el("label", "dlg-lbl", t("dlg.name"));
    lab.setAttribute("for", "wh-name-in");
    var inp = el("input");
    inp.id = "wh-name-in";
    inp.maxLength = NAME_LEN;
    inp.autocomplete = "off";
    var setName = "";
    SET_IDS.forEach(function (id) { if (JSON.stringify(setOpts(id)) === JSON.stringify(curOpts())) setName = t("set." + id); });
    inp.value = existing ? existing.name : setName;
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(lab); form.appendChild(inp); form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = normName(inp.value);
      if (!name) { showToast(t("toast.needName")); inp.focus(); return; }
      if (existing) {
        var x = null;
        data.wheels.forEach(function (y) { if (y.id === existing.id) x = y; });
        if (x) { x.name = name; x.m = Math.max(Date.now(), x.m + 1); }
      } else {
        var id = newId();
        data.wheels.push({ id: id, m: Date.now(), name: name, opts: curOpts(), w: curW() });
        if (hist[DRAFT]) { hist[id] = hist[DRAFT]; delete hist[DRAFT]; saveHist(); }
        prefs.cur = id;
        rows = curOpts();
        savePrefs();
        showToast(t("toast.saved"));
      }
      data = mergeWheel(data, data);
      saveNow();
      dlg.close();
      renderAll();
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    inp.focus();
    inp.select();
  }

  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
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

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "wheel", title: String(text) })) return;
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

  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 10. Keyboard ----------
  function wireKeyboard() {
    // Contract Β: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    // Space / Enter spin (not while typing, not on a button, not in a dialog)
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      var tg = e.target, tag = tg && tg.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return;
      if (document.querySelector("dialog[open]")) return;
      if (e.key === " " || e.code === "Space" || e.key === "Enter") { e.preventDefault(); spin(); }
    });
  }

  // Tap or flick the wheel to spin it.
  function wireWheelTouch() {
    var down = null;
    cv.addEventListener("pointerdown", function (e) { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    cv.addEventListener("pointerup", function (e) {
      if (!down) return;
      var d = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
      down = null;
      if (d < 8 || (d > 30 && dt < 600)) spin();
    });
    cv.addEventListener("pointercancel", function () { down = null; });
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
    draw();
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
    api.registerSlice("wheel", sliceGet, sliceSet, STORAGE_KEY, mergeWheel);
  }

  function sliceGet() {
    storeSavedNow();
    return mergeWheel(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.wheels)) return;
    var before = JSON.stringify(data.wheels);
    var openWas = curSaved();
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeWheel(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data.wheels) === before) return;   // no toast on merge (sync feedback = taskbar dot)
    var openNow = curSaved();
    if (openWas && !openNow) {                // deleted elsewhere: keep its options as a draft
      prefs.cur = null;
      prefs.draft = rows.slice();
      prefs.dw = curW();
      savePrefs();
    } else if (openNow && !spinning && editTimer === null &&
               (JSON.stringify(openNow.opts) !== JSON.stringify(curOpts()) ||
                JSON.stringify(openNow.w || {}) !== JSON.stringify(curW()))) {
      rows = openNow.opts.slice();           // edited elsewhere
      wts = copyMap(openNow.w);
      renderOpts();
      draw();
    }
    renderMine();
    renderToolbar();
    renderSets();
    renderHist();
  }

  // ---------- 12. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    $("spin-btn").textContent = t("spin");
    $("spin-btn").setAttribute("aria-label", t("spin.aria"));
    $("spin-btn").title = t("spin.aria");
    $("add-in").placeholder = t("opt.add");
    $("add-in").setAttribute("aria-label", t("opt.add"));
    $("add-btn").innerHTML = UI.plus;
    $("add-btn").setAttribute("aria-label", t("opt.add"));
    var sh = $("shuffle-btn");
    sh.innerHTML = UI.shuffle;
    sh.setAttribute("aria-label", t("btn.shuffle"));
    sh.title = t("btn.shuffle");
    var sb = $("sound-btn");
    sb.setAttribute("aria-label", t("btn.sound"));
    sb.title = t("btn.sound");
    $("save-btn").innerHTML = UI.save + "<span>" + t("btn.save") + "</span>";
    $("new-btn").innerHTML = UI.plus + "<span>" + t("btn.new") + "</span>";
    $("hist-clear").textContent = t("hist.clear");
  }

  function wire() {
    $("spin-btn").addEventListener("click", spin);
    $("add-btn").addEventListener("click", addFromInput);
    $("add-in").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); addFromInput(); }
    });
    $("add-in").addEventListener("paste", function (e) { pasteLines(e, null); });
    $("shuffle-btn").addEventListener("click", shuffleRows);
    $("save-btn").addEventListener("click", function () { nameDialog(null); });
    $("new-btn").addEventListener("click", newWheel);
    $("hist-clear").addEventListener("click", clearHist);
    $("sound-btn").addEventListener("click", function () {
      prefs.sound = prefs.sound ? 0 : 1;
      savePrefs();
      renderToolbar();
    });
    wireWheelTouch();
    try { new ResizeObserver(resize).observe($("wheel-box")); }
    catch (e) { window.addEventListener("resize", resize); }
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { savePrefsNow(); storeSavedNow(); }
    });
    window.addEventListener("pagehide", function () {
      savePrefsNow();
      storeSavedNow();
      try { if (actx) actx.close(); } catch (e) {}
    });
    wireKeyboard();
  }

  function boot() {
    cv = $("cv");
    g = cv.getContext("2d");
    load();
    loadPrefs();
    loadHist();
    loadCurrent();
    applyI18n();
    buildSets();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    renderAll();
    resize();
  }

  boot();
})();
