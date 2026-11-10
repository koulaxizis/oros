// ============================================================
// orOS Wallpaper Generator — App logic (v1.0.0)
// Generative wallpapers from a seed: six styles (waves, flow
// field, orbits, grid, nebula, tree), seven palettes (one follows the
// skin), density / chaos / grain / light background, any size up
// to 8192 px. The drawing itself lives in art.js, shared with the
// shell, which paints the "Mine" desktop wallpaper from the same
// recipe.
//   - export PNG / JPG through orosDialog (R33), drawn in slices
//     with a progress bar
//   - "Set as wallpaper": hands the recipe to the shell
//     (parent.orosWallpaper); the recipe syncs in the shell slice,
//     every device draws it at its own screen size; "On your desktop"
//     turns on a new picture every day and the live wallpaper
//   - favourites: synced, LWW + tombstones, delete with Undo
//   - the Tree style draws a Tree Sketcher tree; "Shape the tree"
//     opens it there (__orosOpenAt("trees", { wall: recipe }))
//   - Living land tab (LAND-1 W3): try the three land styles and
//     shapes on a sample desktop (land.js demo), keep favourite lands,
//     "Set as wallpaper" = shell orosWallpaper.setLand({style, seed})
// Data:
//   - synced slice "wallpaper" (oros-wallpaper-data): favourites
//     (R5, R17, R26)
//   - synced slice "wallpaper-lands" (oros-wallpaper-lands): favourite
//     lands, same merge; a slice of its own so an older bundle, which
//     knows neither, carries it untouched (no ping-pong)
//   - device-local (R10): oros-wallpaper-prefs (recipe being edited,
//     size)
// Sections:
//   1. Constants, i18n, helpers
//   2. Favourites model: normalize, merge
//   3. Storage + prefs
//   4. Sizes
//   5. Preview
//   6. Pickers (styles, palettes, settings, size)
//   7. Favourites list
//   8. Export
//   9. Set as orOS wallpaper
//  10. Dialogs + toasts
//  11. Keyboard (Contract Β)
//  12. Sync slice + palette
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var ART = window.OrosWallArt;
  var LAND = window.OrosLand || null;
  var STORAGE_KEY = "oros-wallpaper-data";
  var LANDS_KEY   = "oros-wallpaper-lands";
  var LAND_STYLES = ["islands", "hills", "garden"];
  var LAND_MAX_SEED = 999999;
  var PREFS_KEY   = "oros-wallpaper-prefs";
  var DATA_VER    = 1;
  var MAX_FAVS    = 60;
  var MAX_SIDE    = 8192;
  var MIN_SIDE    = 64;
  var BIG_PIXELS  = 4096 * 4096;    // above this: memory warning

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
      "seed": "Seed",
      "sec.style": "Style", "sec.pal": "Palette", "sec.tune": "Settings",
      "sec.size": "Size", "sec.favs": "Favourites",
      "st.waves": "Waves", "st.flow": "Flow field", "st.orbits": "Orbits",
      "st.grid": "Grid", "st.nebula": "Nebula", "st.tree": "Tree",
      "tree.hint": "Density sets the leaves and Chaos the randomness. The kind of tree, the season and the branches come from Tree Sketcher.",
      "tree.btn": "Shape the tree in Tree Sketcher",
      "pal.oros": "orOS skin", "pal.ember": "Ember", "pal.ocean": "Ocean", "pal.forest": "Forest",
      "pal.dusk": "Dusk", "pal.pastel": "Pastel", "pal.mono": "Mono",
      "f.dens": "Density", "f.chaos": "Chaos", "f.grain": "Film grain",
      "f.light": "Light background", "f.lightNo": "A nebula is always drawn at night.",
      "sz.screen": "This screen", "sz.phone": "Phone", "sz.iphone": "iPhone",
      "sz.fhd": "Desktop", "sz.qhd": "QHD", "sz.uw": "Ultrawide", "sz.4k": "4K",
      "sz.square": "Square", "sz.custom": "Custom",
      "sz.w": "Width in pixels", "sz.h": "Height in pixels",
      "sz.big": "Large sizes need a lot of memory. On a phone the export may fail.",
      "sz.max": "Each side from {min} to {max} pixels.",
      "favs.empty": "Tap the star to keep a design here.",
      "fav.open": "Open {name}", "fav.del": "Remove {name} from favourites",
      "btn.roll": "Random seed (R)", "btn.fav": "Keep in favourites", "btn.unfav": "Remove from favourites",
      "btn.set": "Set as wallpaper", "btn.isSet": "Your wallpaper", "btn.export": "Export",
      "sec.desk": "On your desktop",
      "desk.daily": "A new picture every day",
      "desk.dailyHint": "Same style and colours, a new seed at midnight. All your devices show the same picture.",
      "desk.live": "Live wallpaper",
      "desk.liveHint": "Soft lights drift over the picture. They pause while an app is open, and stay off if your device reduces motion.",
      "desk.need": "Set a design as your wallpaper first.",
      "exp.title": "Export", "exp.png": "PNG · lossless", "exp.jpg": "JPG · smaller file",
      "exp.size": "{w} × {h} pixels", "exp.close": "Close",
      "prog.title": "Drawing…", "prog.cancel": "Cancel",
      "toast.exported": "Exported", "toast.exportFail": "Export failed: not enough memory for this size",
      "toast.save": "Could not save: storage is full",
      "toast.faved": "Kept in favourites", "toast.unfaved": "Removed from favourites",
      "toast.undo": "Undo", "toast.maxFavs": "Up to {n} favourites",
      "toast.set": "Set as your orOS wallpaper",
      "toast.rolled": "New seed: {seed}",
      "live.preview": "Preview: {style}, {pal}",
      "mode.label": "What to make", "mode.art": "Patterns", "mode.land": "Living land",
      "land.shape": "Shape", "land.shapeAria": "Shape number, 0 to 999999",
      "lst.islands": "Islands", "lst.hills": "Hills", "lst.garden": "Garden",
      "land.hint": "Living land grows around your shortcuts, widgets and sticky notes. The preview shows a sample desktop; on yours the land follows what is there.",
      "land.favs.empty": "Tap the star to keep a land here.",
      "land.dims": "Sample desktop · {w} × {h}",
      "live.land": "Preview: Living land, {style}, shape {seed}",
      "btn.rollLand": "Random shape (R)",
      "toast.landSet": "Living land is your wallpaper",
      "toast.rolledLand": "New shape: {seed}"
    },
    el: {
      "seed": "Λέξη",
      "sec.style": "Στυλ", "sec.pal": "Παλέτα", "sec.tune": "Ρυθμίσεις",
      "sec.size": "Μέγεθος", "sec.favs": "Αγαπημένα",
      "st.waves": "Κύματα", "st.flow": "Ροή", "st.orbits": "Τροχιές",
      "st.grid": "Πλέγμα", "st.nebula": "Νεφέλωμα", "st.tree": "Δέντρο",
      "tree.hint": "Η Πυκνότητα ορίζει τα φύλλα και το Χάος την τυχαιότητα. Το είδος, η εποχή και τα κλαδιά έρχονται από τον Σκιτσογράφο δέντρων.",
      "tree.btn": "Σχήμα δέντρου στον Σκιτσογράφο",
      "pal.oros": "Χρώματα του orOS", "pal.ember": "Θράκα", "pal.ocean": "Ωκεανός", "pal.forest": "Δάσος",
      "pal.dusk": "Σούρουπο", "pal.pastel": "Παστέλ", "pal.mono": "Μονόχρωμο",
      "f.dens": "Πυκνότητα", "f.chaos": "Χάος", "f.grain": "Κόκκος φιλμ",
      "f.light": "Φωτεινό φόντο", "f.lightNo": "Το νεφέλωμα ζωγραφίζεται πάντα νύχτα.",
      "sz.screen": "Αυτή η οθόνη", "sz.phone": "Κινητό", "sz.iphone": "iPhone",
      "sz.fhd": "Υπολογιστής", "sz.qhd": "QHD", "sz.uw": "Ultrawide", "sz.4k": "4K",
      "sz.square": "Τετράγωνο", "sz.custom": "Δικό σου",
      "sz.w": "Πλάτος σε pixel", "sz.h": "Ύψος σε pixel",
      "sz.big": "Τα μεγάλα μεγέθη θέλουν πολλή μνήμη. Σε κινητό η εξαγωγή μπορεί να αποτύχει.",
      "sz.max": "Κάθε πλευρά από {min} έως {max} pixel.",
      "favs.empty": "Πάτα το αστέρι για να κρατήσεις ένα σχέδιο εδώ.",
      "fav.open": "Άνοιγμα του {name}", "fav.del": "Αφαίρεση του {name} από τα αγαπημένα",
      "btn.roll": "Τυχαία λέξη (R)", "btn.fav": "Στα αγαπημένα", "btn.unfav": "Αφαίρεση από τα αγαπημένα",
      "btn.set": "Ορισμός ως ταπετσαρία", "btn.isSet": "Η ταπετσαρία σου", "btn.export": "Εξαγωγή",
      "sec.desk": "Στην επιφάνεια εργασίας",
      "desk.daily": "Νέα εικόνα κάθε μέρα",
      "desk.dailyHint": "Ίδιο στυλ και χρώματα, νέα λέξη τα μεσάνυχτα. Όλες οι συσκευές σου δείχνουν την ίδια εικόνα.",
      "desk.live": "Ζωντανή ταπετσαρία",
      "desk.liveHint": "Απαλά φωτάκια ταξιδεύουν πάνω στην εικόνα. Σταματούν όσο είναι ανοιχτή μια εφαρμογή και δεν εμφανίζονται αν η συσκευή σου έχει μειωμένη κίνηση.",
      "desk.need": "Όρισε πρώτα ένα σχέδιο ως ταπετσαρία.",
      "exp.title": "Εξαγωγή", "exp.png": "PNG · χωρίς απώλειες", "exp.jpg": "JPG · μικρότερο αρχείο",
      "exp.size": "{w} × {h} pixel", "exp.close": "Κλείσιμο",
      "prog.title": "Ζωγραφίζω…", "prog.cancel": "Ακύρωση",
      "toast.exported": "Η εξαγωγή έγινε", "toast.exportFail": "Η εξαγωγή απέτυχε: δεν φτάνει η μνήμη για αυτό το μέγεθος",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "toast.faved": "Μπήκε στα αγαπημένα", "toast.unfaved": "Βγήκε από τα αγαπημένα",
      "toast.undo": "Αναίρεση", "toast.maxFavs": "Έως {n} αγαπημένα",
      "toast.set": "Έγινε ταπετσαρία του orOS",
      "toast.rolled": "Νέα λέξη: {seed}",
      "live.preview": "Προεπισκόπηση: {style}, {pal}",
      "mode.label": "Τι φτιάχνεις", "mode.art": "Μοτίβα", "mode.land": "Ζωντανό τοπίο",
      "land.shape": "Σχήμα", "land.shapeAria": "Αριθμός σχήματος, 0 έως 999999",
      "lst.islands": "Νησιά", "lst.hills": "Λόφοι", "lst.garden": "Κήπος",
      "land.hint": "Το Ζωντανό τοπίο μεγαλώνει γύρω από τις συντομεύσεις, τα widgets και τα αυτοκόλλητα σημειώματα. Η προεπισκόπηση δείχνει ένα δείγμα επιφάνειας· στη δική σου το τοπίο ακολουθεί ό,τι υπάρχει εκεί.",
      "land.favs.empty": "Πάτα το αστέρι για να κρατήσεις ένα τοπίο εδώ.",
      "land.dims": "Δείγμα επιφάνειας · {w} × {h}",
      "live.land": "Προεπισκόπηση: Ζωντανό τοπίο, {style}, σχήμα {seed}",
      "btn.rollLand": "Τυχαίο σχήμα (R)",
      "toast.landSet": "Το Ζωντανό τοπίο έγινε ταπετσαρία σου",
      "toast.rolledLand": "Νέο σχήμα: {seed}"
    }
  };

  if (window.orosI18n) window.orosI18n.table(STRINGS, "wallpaper", LANG);

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

  var UI_ICONS = {
    dice:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="16" cy="16" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="16" cy="8" r="1.2" fill="currentColor"/><circle cx="8" cy="16" r="1.2" fill="currentColor"/></svg>',
    star:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/></svg>',
    exp:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>',
    wall:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M5.5 14l4-4 3 3 2-2 4 3"/></svg>',
    x:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>'
  };

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("wallpaper.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Favourites model ----------
  // fav  = { id, m (mtime, ms), r: recipe }
  // data = { ver: 1, favs: [fav…] sorted by id, tombs: { id: deletedAt } }
  var ID_RE = /^[a-z0-9]{6,40}$/;

  function normFav(f) {
    if (!f || typeof f !== "object" || typeof f.id !== "string" || !ID_RE.test(f.id) ||
        !isInt(f.m) || f.m < 0) return null;
    var r = ART.normRecipe(f.r);
    if (!r) return null;
    return { id: f.id, m: f.m, r: r };
  }

  // A land = { style, seed } (shell wplandCanon without motion), or null.
  function landCanon(l) {
    if (!l || typeof l !== "object" || Array.isArray(l)) return null;
    if (!isInt(l.seed) || l.seed < 0 || l.seed > LAND_MAX_SEED) return null;
    return { style: LAND_STYLES.indexOf(l.style) >= 0 ? l.style : "islands", seed: l.seed };
  }

  // land fav = { id, m, l: land }
  function normLand(f) {
    if (!f || typeof f !== "object" || typeof f.id !== "string" || !ID_RE.test(f.id) ||
        !isInt(f.m) || f.m < 0) return null;
    var l = landCanon(f.l);
    if (!l) return null;
    return { id: f.id, m: f.m, l: l };
  }

  // LWW per favourite (newer m wins; equal m: the larger canonical
  // JSON), tombstones max-merged, delete wins ties, a newer edit
  // resurrects (R17). Symmetric and canonical (R5, R26). `norm` is
  // normFav (patterns) or normLand (lands).
  function mergeFavs(A, B, norm) {
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
    [a.favs, b.favs].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var f = norm(raw);
        if (!f) return;
        var cur = best[f.id];
        if (!cur || f.m > cur.m ||
            (f.m === cur.m && JSON.stringify(f) > JSON.stringify(cur))) best[f.id] = f;
      });
    });
    var favs = [];
    Object.keys(best).sort(cmpStr).forEach(function (id) {
      if (id in tombs && tombs[id] >= best[id].m) return;
      favs.push(best[id]);
    });
    var sortedTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sortedTombs[id] = tombs[id]; });
    return { ver: DATA_VER, favs: favs, tombs: sortedTombs };
  }
  function mergeWall(A, B) { return mergeFavs(A, B, normFav); }
  function mergeLands(A, B) { return mergeFavs(A, B, normLand); }

  // ---------- 3. Storage + prefs ----------
  var data = null;
  var prefs = null;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.favs)) {
          data = mergeWall(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] wallpaper: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = { ver: DATA_VER, favs: [], tombs: {} };
  }

  var lands = null;
  function loadLands() {
    var raw = null;
    try { raw = localStorage.getItem(LANDS_KEY); } catch (e) {}
    lands = { ver: DATA_VER, favs: [], tombs: {} };
    if (!raw) return;
    try {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.favs)) { lands = mergeLands(parsed, parsed); return; }
    } catch (e) {}
    try { localStorage.setItem(LANDS_KEY + "-broken", raw); } catch (e) {}
    try { console.error("[orOS] wallpaper: unreadable lands copied to " + LANDS_KEY + "-broken"); } catch (e) {}
  }
  function saveLandsNow() {
    try {
      localStorage.setItem(LANDS_KEY, JSON.stringify(lands));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
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

  var SIZE_IDS = ["screen", "phone", "iphone", "fhd", "qhd", "uw", "4k", "square", "custom"];
  var SIZES = {
    phone: [1080, 1920], iphone: [1170, 2532], fhd: [1920, 1080], qhd: [2560, 1440],
    uw: [3440, 1440], "4k": [3840, 2160], square: [2048, 2048]
  };

  function clampSide(v, dflt) {
    v = parseInt(v, 10);
    if (!isFinite(v)) return dflt;
    return Math.max(MIN_SIDE, Math.min(MAX_SIDE, v));
  }

  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    p = (p && typeof p === "object") ? p : {};
    // a fresh device starts from the "Mine" wallpaper, if there is one
    var mine = null;
    if (!p.r) {
      try { mine = wallApi() && wallApi().get().recipe; } catch (e) { mine = null; }
    }
    var deskLand = null;
    if (!p.land) {
      try { deskLand = wallApi() && wallApi().get().land; } catch (e) { deskLand = null; }
    }
    prefs = {
      mode: p.mode === "land" && LAND ? "land" : "art",
      land: landCanon(p.land) || landCanon(deskLand) || { style: "islands", seed: 1 },
      r: ART.normRecipe(p.r) || ART.normRecipe(mine) || ART.defaultRecipe(),
      size: SIZE_IDS.indexOf(p.size) >= 0 ? p.size : "screen",
      cw: clampSide(p.cw, 1920),
      ch: clampSide(p.ch, 1080)
    };
  }

  var prefsTimer = null;
  function savePrefs() {
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(savePrefsNow, 300);
  }
  function savePrefsNow() {
    clearTimeout(prefsTimer); prefsTimer = null;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  function recipe() { return prefs.r; }
  function isLand() { return prefs.mode === "land" && !!LAND; }

  function setLand(patch) {
    var l = { style: prefs.land.style, seed: prefs.land.seed }, k;
    for (k in patch) l[k] = patch[k];
    var n = landCanon(l);
    if (!n) return;
    prefs.land = n;
    savePrefs();
    renderControls();
    schedulePreview();
  }

  function setMode(m) {
    if (m === "land" && !LAND) return;
    if (prefs.mode === m) return;
    prefs.mode = m;
    savePrefs();
    renderMode();
    renderControls();
    schedulePreview();
  }

  function setRecipe(patch) {
    var r = {}, k;
    for (k in prefs.r) r[k] = prefs.r[k];
    for (k in patch) r[k] = patch[k];
    var n = ART.normRecipe(r);
    if (!n) return;
    prefs.r = n;
    savePrefs();
    renderControls();
    schedulePreview();
  }

  // ---------- 4. Sizes ----------
  function screenSize() {
    var dpr = window.devicePixelRatio || 1;
    var w = (window.screen && screen.width) || window.innerWidth || 1920;
    var h = (window.screen && screen.height) || window.innerHeight || 1080;
    return [clampSide(Math.round(w * dpr), 1920), clampSide(Math.round(h * dpr), 1080)];
  }

  // Living land: the desktop in CSS pixels (the land is drawn per screen)
  function landDesk() {
    var w = 0, h = 0;
    try { w = window.parent.innerWidth; h = window.parent.innerHeight; } catch (e) {}
    if (!w || !h) { w = (window.screen && screen.width) || 1440; h = (window.screen && screen.height) || 860; }
    return [Math.max(320, Math.min(3840, Math.round(w))), Math.max(320, Math.min(2160, Math.round(h)))];
  }

  function currentSize() {
    if (isLand()) return landDesk();
    if (prefs.size === "screen") return screenSize();
    if (prefs.size === "custom") return [prefs.cw, prefs.ch];
    return SIZES[prefs.size].slice();
  }

  function sizeLabel(id) {
    var wh = id === "screen" ? screenSize() : (id === "custom" ? null : SIZES[id]);
    return t("sz." + id) + (wh ? " · " + wh[0] + " × " + wh[1] : "");
  }

  // ---------- 5. Preview ----------
  function accent() {
    try {
      var a = window.parent && window.parent.orosAppTheme && window.parent.orosAppTheme.accent;
      if (a) return a;
    } catch (e) {}
    return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#d4af37";
  }

  var previewTimer = null, previewToken = 0;
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 60);
    scheduleThumbs();
  }

  function fitBox() {
    var st = $("stage"), wh = currentSize();
    var cs = getComputedStyle(st);
    var aw = st.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var ah = st.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 28;
    aw = Math.max(80, aw); ah = Math.max(80, ah);
    var s = Math.min(aw / wh[0], ah / wh[1]);
    return { w: Math.max(40, Math.floor(wh[0] * s)), h: Math.max(40, Math.floor(wh[1] * s)), full: wh };
  }

  function theme() {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  }

  // The land on a sample desktop, with faint tiles where the
  // shortcuts, the widget and the note would stand.
  function drawLand(ctx, pw, ph, vw, vh, l, ghosts) {
    var rects = LAND.demo(vw, vh);
    var fld = LAND.field(rects, vw, vh, l.seed, 0, l.style);
    var img = ctx.createImageData(pw, ph);
    LAND.paint(img, fld, LAND.palette(l.style, accent(), theme()), pw / vw, l.seed);
    ctx.putImageData(img, 0, 0);
    if (!ghosts) return;
    var s = pw / vw;
    rects.forEach(function (r) {
      var x = r.x * s, y = r.y * s, w = r.w * s, h = r.h * s, rad = Math.min(14 * s, w / 4);
      if (r.k === "tile") { x += w * 0.2; w *= 0.6; h *= 0.6; y += h * 0.1; }
      ctx.fillStyle = r.k === "tile" ? "rgba(255,255,255,0.30)" : "rgba(255,255,255,0.20)";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, rad); else ctx.rect(x, y, w, h);
      ctx.fill();
    });
  }

  function renderLandPreview(box, cv, pw, ph) {
    var l = prefs.land;
    $("dims").textContent = t("land.dims", { w: box.full[0], h: box.full[1] });
    try {
      var ctx = cv.getContext("2d");
      cv.width = pw; cv.height = ph;
      drawLand(ctx, pw, ph, box.full[0], box.full[1], l, true);
    } catch (e) { console.error("[orOS] wallpaper land preview", e); return; }
    cv.classList.remove("fresh");
    void cv.offsetWidth;
    cv.classList.add("fresh");
    cv.setAttribute("aria-label", t("live.land", { style: t("lst." + l.style), seed: l.seed }));
  }

  function renderPreview() {
    var box = fitBox();
    var cv = $("cv"), frame = $("frame");
    frame.style.width = box.w + "px";
    frame.style.height = box.h + "px";
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var pw = Math.round(box.w * dpr), ph = Math.round(box.h * dpr);
    if (isLand()) { ++previewToken; renderLandPreview(box, cv, pw, ph); return; }
    var buf = document.createElement("canvas");
    buf.width = pw; buf.height = ph;
    var token = ++previewToken;
    var r = recipe();
    $("dims").textContent = box.full[0] + " × " + box.full[1];
    ART.render(buf.getContext("2d"), pw, ph, r, {
      accent: accent(),
      cancelled: function () { return token !== previewToken; }
    }).then(function (done) {
      if (!done) return;
      cv.width = pw; cv.height = ph;
      cv.getContext("2d").drawImage(buf, 0, 0);
      cv.classList.remove("fresh");
      void cv.offsetWidth;
      cv.classList.add("fresh");
      cv.setAttribute("aria-label", t("live.preview", { style: t("st." + r.style), pal: t("pal." + r.pal) }));
    }).catch(function (e) { console.error("[orOS] wallpaper preview", e); });
  }

  // Small pictures (style picker + favourites), one per tick.
  var thumbQueue = [], thumbTimer = null, thumbCache = {};
  function thumbUrl(r, w, h) {
    var k = ART.key(r, accent()) + "|" + w + "x" + h;
    if (thumbCache[k]) return thumbCache[k];
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    ART.renderSync(c.getContext("2d"), w, h, r, { accent: accent() });
    var url = c.toDataURL("image/png");
    var keys = Object.keys(thumbCache);
    if (keys.length > 200) delete thumbCache[keys[0]];
    thumbCache[k] = url;
    return url;
  }
  function queueThumb(node, r, w, h) {
    thumbQueue.push({ node: node, r: r, w: w, h: h });
    if (!thumbTimer) thumbTimer = setTimeout(drainThumbs, 0);
  }
  function drainThumbs() {
    thumbTimer = null;
    var job = thumbQueue.shift();
    if (!job) return;
    if (job.node.isConnected) {
      var u = job.land ? landThumbUrl(job.land, job.w, job.h) : thumbUrl(job.r, job.w, job.h);
      job.node.style.backgroundImage = 'url("' + u + '")';
    }
    if (thumbQueue.length) thumbTimer = setTimeout(drainThumbs, 0);
  }
  var landThumbs = {};
  function landThumbUrl(l, w, h) {
    var k = l.style + "|" + l.seed + "|" + accent() + "|" + theme() + "|" + w + "x" + h;
    if (landThumbs[k]) return landThumbs[k];
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    drawLand(c.getContext("2d"), w, h, 1440, 900, l, false);
    var url = c.toDataURL("image/png");
    var keys = Object.keys(landThumbs);
    if (keys.length > 120) delete landThumbs[keys[0]];
    landThumbs[k] = url;
    return url;
  }
  function queueLandThumb(node, l, w, h) {
    thumbQueue.push({ node: node, land: l, w: w, h: h });
    if (!thumbTimer) thumbTimer = setTimeout(drainThumbs, 0);
  }

  var thumbsTimer = null;
  function scheduleThumbs() {
    clearTimeout(thumbsTimer);
    thumbsTimer = setTimeout(function () {
      thumbQueue = [];
      [].forEach.call(document.querySelectorAll("#styles .pick-btn"), function (b) {
        var r = {}, k;
        for (k in prefs.r) r[k] = prefs.r[k];
        r.style = b.getAttribute("data-v");
        queueThumb(b.querySelector(".pick-sw"), ART.normRecipe(r), 96, 60);
      });
      if (LAND) [].forEach.call(document.querySelectorAll("#land-styles .pick-btn"), function (b) {
        queueLandThumb(b.querySelector(".pick-sw"), { style: b.getAttribute("data-v"), seed: prefs.land.seed }, 96, 60);
      });
    }, 250);
  }

  // ---------- 6. Pickers ----------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function buildPicker(host, ids, prefix, field, paintSw) {
    host.setAttribute("aria-label", t(prefix === "st." ? "sec.style" : "sec.pal"));
    ids.forEach(function (id) {
      var b = el("button", "pick-btn");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("data-v", id);
      var sw = el("span", "pick-sw");
      if (paintSw) paintSw(sw, id);
      b.appendChild(sw);
      b.appendChild(el("span", "pick-lbl", t(prefix + id)));
      b.addEventListener("click", function () {
        var p = {}; p[field] = id;
        setRecipe(p);
      });
      host.appendChild(b);
    });
    host.addEventListener("keydown", function (e) {
      var keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      if (!keys[e.key]) return;
      e.preventDefault();
      var i = ids.indexOf(recipe()[field]);
      var n = ids[(i + keys[e.key] + ids.length) % ids.length];
      var p = {}; p[field] = n;
      setRecipe(p);
      var b = host.querySelector('[data-v="' + n + '"]');
      if (b) b.focus();
    });
  }

  function buildLandPicker() {
    var host = $("land-styles");
    host.setAttribute("aria-label", t("sec.style"));
    LAND_STYLES.forEach(function (id) {
      var b = el("button", "pick-btn");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("data-v", id);
      b.appendChild(el("span", "pick-sw"));
      b.appendChild(el("span", "pick-lbl", t("lst." + id)));
      b.addEventListener("click", function () { setLand({ style: id }); });
      host.appendChild(b);
    });
    host.addEventListener("keydown", function (e) {
      var keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      if (!keys[e.key]) return;
      e.preventDefault();
      var i = LAND_STYLES.indexOf(prefs.land.style);
      var n = LAND_STYLES[(i + keys[e.key] + LAND_STYLES.length) % LAND_STYLES.length];
      setLand({ style: n });
      var b = host.querySelector('[data-v="' + n + '"]');
      if (b) b.focus();
    });
  }

  // Tabs: Patterns | Living land (ARIA tabs, arrow keys move)
  function wireModes() {
    var bar = $("modes");
    if (!LAND) { bar.hidden = true; return; }
    bar.setAttribute("aria-label", t("mode.label"));
    ["art", "land"].forEach(function (m) {
      $("mode-" + m).addEventListener("click", function () { setMode(m); });
    });
    bar.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
      e.preventDefault();
      var m = (e.key === "Home") ? "art" : (e.key === "End") ? "land" : (prefs.mode === "land" ? "art" : "land");
      setMode(m);
      $("mode-" + m).focus();
    });
  }

  function renderMode() {
    var land = isLand();
    ["art", "land"].forEach(function (m) {
      var b = $("mode-" + m), on = (m === "land") === land;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle("on", on);
    });
    $("art-panel").hidden = land;
    $("land-panel").hidden = !land;
    $("export-btn").hidden = land;
    var seedIn = $("seed");
    seedIn.setAttribute("inputmode", land ? "numeric" : "text");
    seedIn.maxLength = land ? 6 : 40;
    seedIn.placeholder = land ? "1" : "orOS";
    seedIn.setAttribute("aria-label", t(land ? "land.shapeAria" : "seed"));
    $("seed-lbl").textContent = t(land ? "land.shape" : "seed");
    var rl = t(land ? "btn.rollLand" : "btn.roll");
    $("roll-btn").setAttribute("aria-label", rl);
    $("roll-btn").title = rl;
  }

  function paintPalSw(sw, id) {
    sw.innerHTML = "";
    var C = ART.colors({ seed: "x", style: "waves", pal: id, light: 0 }, accent());
    sw.style.background = C.bg;
    C.ink.forEach(function (c) {
      var s = el("i");
      s.style.background = c;
      sw.appendChild(s);
    });
  }

  function renderPicker(host, value) {
    [].forEach.call(host.querySelectorAll(".pick-btn"), function (b) {
      var on = b.getAttribute("data-v") === value;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
  }

  function buildSizeSelect() {
    var sel = $("size");
    sel.innerHTML = "";
    SIZE_IDS.forEach(function (id) {
      var o = el("option", "", sizeLabel(id));
      o.value = id;
      sel.appendChild(o);
    });
    sel.setAttribute("aria-label", t("sec.size"));
  }

  function renderLandControls() {
    var seedIn = $("seed");
    if (document.activeElement !== seedIn) seedIn.value = String(prefs.land.seed);
    renderPicker($("land-styles"), prefs.land.style);
    renderFavButton();
    renderSetButton();
  }

  function renderControls() {
    if (isLand()) { renderLandControls(); return; }
    var r = recipe();
    var seedIn = $("seed");
    if (document.activeElement !== seedIn) seedIn.value = r.seed;
    renderPicker($("styles"), r.style);
    renderPicker($("pals"), r.pal);
    $("dens").value = r.dens; $("dens-out").textContent = r.dens;
    $("chaos").value = r.chaos; $("chaos-out").textContent = r.chaos;
    $("grain").checked = !!r.grain;
    $("light").checked = !!r.light;
    $("light").disabled = r.style === "nebula";
    $("light-hint").hidden = r.style !== "nebula";
    $("tree-hint").hidden = r.style !== "tree";
    $("tree-btn").hidden = r.style !== "tree" || !openAtHost();
    $("size").value = prefs.size;
    $("custom-row").hidden = prefs.size !== "custom";
    if (document.activeElement !== $("cw")) $("cw").value = prefs.cw;
    if (document.activeElement !== $("ch")) $("ch").value = prefs.ch;
    var wh = currentSize();
    var hint = prefs.size === "custom" ? t("sz.max", { min: MIN_SIDE, max: MAX_SIDE }) : "";
    if (wh[0] * wh[1] > BIG_PIXELS) hint = (hint ? hint + " " : "") + t("sz.big");
    $("size-hint").textContent = hint;
    $("size-hint").hidden = !hint;
    renderFavButton();
    renderSetButton();
  }

  // ---------- 7. Favourites ----------
  function favOf(r) {
    var j = JSON.stringify(ART.normRecipe(r));
    for (var i = 0; i < data.favs.length; i++) {
      if (JSON.stringify(data.favs[i].r) === j) return data.favs[i];
    }
    return null;
  }

  function favName(f) { return f.r.seed + " · " + t("st." + f.r.style); }

  function landFavOf(l) {
    for (var i = 0; i < lands.favs.length; i++) {
      var f = lands.favs[i];
      if (f.l.style === l.style && f.l.seed === l.seed) return f;
    }
    return null;
  }
  function landName(f) { return t("lst." + f.l.style) + " · " + f.l.seed; }

  function toggleLandFav() {
    var f = landFavOf(prefs.land);
    if (f) { deleteLandFav(f.id); return; }
    if (lands.favs.length >= MAX_FAVS) { showToast(t("toast.maxFavs", { n: MAX_FAVS })); return; }
    lands.favs.push({ id: newId(), m: Date.now(), l: { style: prefs.land.style, seed: prefs.land.seed } });
    lands = mergeLands(lands, lands);
    saveLandsNow();
    renderLandFavs();
    renderFavButton();
    showToast(t("toast.faved"));
  }

  function deleteLandFav(id) {
    var f = null;
    for (var i = 0; i < lands.favs.length; i++) if (lands.favs[i].id === id) f = lands.favs[i];
    if (!f) return;
    var snapshot = JSON.parse(JSON.stringify(f));
    lands.tombs[id] = Math.max(Date.now(), f.m);
    lands = mergeLands(lands, lands);
    saveLandsNow();
    renderLandFavs();
    renderFavButton();
    undoToast(t("toast.unfaved"), function () {
      snapshot.m = Math.max(Date.now(), (lands.tombs[snapshot.id] || 0) + 1);   // R17
      lands.favs.push(snapshot);
      lands = mergeLands(lands, lands);
      saveLandsNow();
      renderLandFavs();
      renderFavButton();
    });
  }

  function renderLandFavs() {
    var host = $("land-favs");
    if (!host || !LAND) return;
    host.innerHTML = "";
    $("land-favs-empty").hidden = lands.favs.length > 0;
    lands.favs.slice().sort(function (a, b) { return b.m - a.m || cmpStr(a.id, b.id); }).forEach(function (f) {
      var item = el("div", "fav");
      var open = el("button", "fav-open");
      open.type = "button";
      open.setAttribute("aria-label", t("fav.open", { name: landName(f) }));
      open.title = landName(f);
      var sw = el("span", "fav-sw");
      open.appendChild(sw);
      open.appendChild(el("span", "fav-lbl", landName(f)));
      open.addEventListener("click", function () { setLand({ style: f.l.style, seed: f.l.seed }); });
      var del = el("button", "fav-del");
      del.type = "button";
      del.innerHTML = UI_ICONS.x;
      del.setAttribute("aria-label", t("fav.del", { name: landName(f) }));
      del.title = t("fav.del", { name: landName(f) });
      del.addEventListener("click", function () { deleteLandFav(f.id); });
      item.appendChild(open);
      item.appendChild(del);
      host.appendChild(item);
      queueLandThumb(sw, f.l, 160, 100);
    });
  }

  function renderFavButton() {
    var on = isLand() ? !!landFavOf(prefs.land) : !!favOf(recipe());
    var b = $("fav-btn");
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.classList.toggle("on", on);
    var lbl = t(on ? "btn.unfav" : "btn.fav");
    b.setAttribute("aria-label", lbl);
    b.title = lbl;
  }

  function toggleFav() {
    if (isLand()) { toggleLandFav(); return; }
    var f = favOf(recipe());
    if (f) { deleteFav(f.id); return; }
    if (data.favs.length >= MAX_FAVS) { showToast(t("toast.maxFavs", { n: MAX_FAVS })); return; }
    data.favs.push({ id: newId(), m: Date.now(), r: recipe() });
    data = mergeWall(data, data);
    saveNow();
    renderFavs();
    renderFavButton();
    showToast(t("toast.faved"));
  }

  function deleteFav(id) {
    var f = null;
    for (var i = 0; i < data.favs.length; i++) if (data.favs[i].id === id) f = data.favs[i];
    if (!f) return;
    var snapshot = JSON.parse(JSON.stringify(f));
    data.tombs[id] = Math.max(Date.now(), f.m);
    data = mergeWall(data, data);
    saveNow();
    renderFavs();
    renderFavButton();
    undoToast(t("toast.unfaved"), function () {
      // R17: a fresh mtime beats the tombstone
      snapshot.m = Math.max(Date.now(), (data.tombs[snapshot.id] || 0) + 1);
      data.favs.push(snapshot);
      data = mergeWall(data, data);
      saveNow();
      renderFavs();
      renderFavButton();
    });
  }

  function renderFavs() {
    var host = $("favs");
    host.innerHTML = "";
    $("favs-empty").hidden = data.favs.length > 0;
    // newest first
    data.favs.slice().sort(function (a, b) { return b.m - a.m || cmpStr(a.id, b.id); }).forEach(function (f) {
      var item = el("div", "fav");
      var open = el("button", "fav-open");
      open.type = "button";
      open.setAttribute("aria-label", t("fav.open", { name: favName(f) }));
      open.title = favName(f);
      var sw = el("span", "fav-sw");
      open.appendChild(sw);
      open.appendChild(el("span", "fav-lbl", f.r.seed));
      open.addEventListener("click", function () {
        prefs.r = ART.normRecipe(f.r);
        savePrefs();
        renderControls();
        schedulePreview();
      });
      var del = el("button", "fav-del");
      del.type = "button";
      del.innerHTML = UI_ICONS.x;
      del.setAttribute("aria-label", t("fav.del", { name: favName(f) }));
      del.title = t("fav.del", { name: favName(f) });
      del.addEventListener("click", function () { deleteFav(f.id); });
      item.appendChild(open);
      item.appendChild(del);
      host.appendChild(item);
      queueThumb(sw, f.r, 160, 100);
    });
  }

  // ---------- 8. Export ----------
  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
  }

  function downloadBlob(blob, fileName, mime, types) {
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      dlg.saveFile({ blob: blob, filename: fileName, mime: mime, types: types })
        .then(function (r) { if (r && r.ok) showToast(t("toast.exported")); });
      return;                         // cancel (ok=false) = silent exit
    }
    // Standalone fallback — classic download (no shell present).
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    showToast(t("toast.exported"));
  }

  function fileBase(r, wh) {
    var s = r.seed.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 24);
    return "wallpaper-" + r.style + "-" + (s || "seed") + "-" + wh[0] + "x" + wh[1];
  }

  function exportDialog() {
    var wh = currentSize();
    var dlg = makeDialog("wp-export");
    dlg.appendChild(el("div", "dlg-title", t("exp.title")));
    dlg.appendChild(el("div", "dlg-sub", t("exp.size", { w: wh[0], h: wh[1] })));
    var list = el("div", "exp-list");
    [["exp.png", "image/png", "png"], ["exp.jpg", "image/jpeg", "jpg"]].forEach(function (x) {
      list.appendChild(button(t(x[0]), "exp-btn", function () { dlg.close(); exportAs(x[1], x[2], wh); }));
    });
    dlg.appendChild(list);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("exp.close"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    list.firstChild.focus();
  }

  function exportAs(mime, ext, wh) {
    var r = recipe();
    var cancelled = false;
    var dlg = makeDialog("wp-progress");
    dlg.appendChild(el("div", "dlg-title", t("prog.title")));
    dlg.appendChild(el("div", "dlg-sub", t("exp.size", { w: wh[0], h: wh[1] })));
    var bar = el("div", "prog");
    var fill = el("span");
    bar.appendChild(fill);
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", "0");
    dlg.appendChild(bar);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("prog.cancel"), "", function () { cancelled = true; dlg.close(); }));
    dlg.appendChild(acts);
    dlg.addEventListener("cancel", function () { cancelled = true; });
    document.body.appendChild(dlg);
    dlg.showModal();

    var cv = document.createElement("canvas"), ctx = null;
    try {
      cv.width = wh[0]; cv.height = wh[1];
      ctx = cv.getContext("2d");
    } catch (e) { ctx = null; }
    if (!ctx) { dlg.close(); showToast(t("toast.exportFail")); return; }
    ART.render(ctx, wh[0], wh[1], r, {
      accent: accent(),
      cancelled: function () { return cancelled; },
      onProgress: function (f) {
        var p = Math.round(f * 100);
        fill.style.width = p + "%";
        bar.setAttribute("aria-valuenow", String(p));
      }
    }).then(function (done) {
      if (!done) return null;
      return new Promise(function (resolve) {
        cv.toBlob(function (b) { resolve(b || "fail"); }, mime, 0.92);
      });
    }).then(function (blob) {
      if (blob === null || cancelled) return;
      if (dlg.open) dlg.close();
      if (blob === "fail") { showToast(t("toast.exportFail")); return; }
      var types = [{ description: ext.toUpperCase(), accept: {} }];
      types[0].accept[mime] = ["." + ext];
      downloadBlob(blob, fileBase(r, wh) + "." + ext, mime, types);
    }).catch(function (e) {
      console.error("[orOS] wallpaper export", e);
      if (dlg.open) dlg.close();
      showToast(t("toast.exportFail"));
    }).then(function () {
      cv.width = cv.height = 0;   // give the memory back at once
    });
  }

  // ---------- 9. Set as orOS wallpaper ----------
  function wallApi() {
    try {
      var w = window.parent && window.parent !== window && window.parent.orosWallpaper;
      return (w && typeof w.setCustom === "function") ? w : null;
    } catch (e) { return null; }
  }

  function renderSetButton() {
    var api = wallApi(), b = $("set-btn");
    b.hidden = !api;                 // standalone: no desktop to set (R28)
    if (!api) return;
    var cur = null;
    try { cur = api.get(); } catch (e) {}
    if (isLand() && typeof api.setLand !== "function") { b.hidden = true; return; }
    var isSet = isLand()
      ? !!(cur && cur.land && cur.land.style === prefs.land.style && cur.land.seed === prefs.land.seed)
      : !!(cur && cur.active && !cur.picture && cur.recipe &&
           JSON.stringify(cur.recipe) === JSON.stringify(recipe()));
    b.classList.toggle("on", isSet);
    b.innerHTML = UI_ICONS.wall + "<span>" + t(isSet ? "btn.isSet" : "btn.set") + "</span>";
    b.setAttribute("aria-pressed", isSet ? "true" : "false");
    renderDesk(api, cur);
  }

  // "On your desktop": options of the "Mine" wallpaper, whatever
  // design it shows (shell orosWallpaper.setOptions; they sync with it).
  function renderDesk(api, cur) {
    var sec = $("desk-sec");
    sec.hidden = !api || typeof api.setOptions !== "function";
    if (sec.hidden) return;
    var mine = !!(cur && cur.active && !cur.picture && cur.recipe);
    $("desk-daily").disabled = !mine;
    $("desk-live").disabled = !mine;
    $("desk-daily").checked = mine && !!cur.daily;
    $("desk-live").checked = mine && !!cur.live;
    $("desk-need").hidden = mine;
  }
  function setDesk(k) {
    var api = wallApi();
    if (!api || typeof api.setOptions !== "function") return;
    var o = {};
    o[k] = $("desk-" + k).checked;
    try { api.setOptions(o); } catch (e) {}
    renderSetButton();
  }

  function setWallpaper() {
    var api = wallApi();
    if (!api) return;
    var ok = false;
    if (isLand()) {
      try { ok = typeof api.setLand === "function" && api.setLand({ style: prefs.land.style, seed: prefs.land.seed }); }
      catch (e) { ok = false; }
      if (ok) showToast(t("toast.landSet"));
      renderSetButton();
      return;
    }
    try { ok = api.setCustom(recipe()); } catch (e) { ok = false; }
    if (ok) showToast(t("toast.set"));
    renderSetButton();
  }

  // The Tree style: shape the tree in the Tree Sketcher.
  function openAtHost() {
    try {
      var p = window.parent;
      return (p && p !== window && typeof p.__orosOpenAt === "function") ? p : null;
    } catch (e) { return null; }
  }
  function shapeTree() {
    var p = openAtHost();
    if (p) p.__orosOpenAt("trees", { wall: recipe() });
  }

  // ---------- 10. Dialogs + toasts ----------
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  function makeDialog(id) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "mm-dlg";
    if (id !== "wp-progress") {
      dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    }
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
          n.transient({ ns: "wallpaper", title: String(text) })) return;
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

  // ---------- 11. Keyboard ----------
  function rollSeed() {
    if (isLand()) {
      var n = prefs.land.seed;
      while (n === prefs.land.seed) n = Math.floor(Math.random() * (LAND_MAX_SEED + 1));
      setLand({ seed: n });
      $("seed").value = String(n);
      live(t("toast.rolledLand", { seed: n }));
      return;
    }
    var s = ART.randomSeed();
    setRecipe({ seed: s });
    $("seed").value = s;
    live(t("toast.rolled", { seed: s }));
  }

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
    // R: new random seed (not while typing, not inside a dialog)
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.key !== "r" && e.key !== "R") return;
      var tg = e.target, tag = tg && tg.tagName;
      if (tag === "INPUT" && tg.type !== "range" && tg.type !== "checkbox") return;
      if (tag === "TEXTAREA" || tag === "SELECT" || (tg && tg.isContentEditable)) return;
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      rollSeed();
    });
  }

  // ---------- 12. Sync slice + palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft", "--accent-ink",
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
    // the "orOS" palette follows the skin
    if (data) {
      var sw = document.querySelector('#pals [data-v="oros"] .pick-sw');
      if (sw) paintPalSw(sw, "oros");
      schedulePreview();
      renderFavs();
      renderLandFavs();
      renderSetButton();
    }
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
    api.registerSlice("wallpaper", sliceGet, sliceSet, STORAGE_KEY, mergeWall);
    api.registerSlice("wallpaper-lands", landSliceGet, landSliceSet, LANDS_KEY, mergeLands);
  }

  function landSliceGet() {
    return mergeLands(lands, lands);   // canonical copy (R26)
  }

  function landSliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.favs)) return;
    var before = JSON.stringify(lands.favs);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      lands = mergeLands(incoming, incoming);
      localStorage.setItem(LANDS_KEY, JSON.stringify(lands));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(lands.favs) !== before) {
      renderLandFavs();
      renderFavButton();
    }
  }

  function sliceGet() {
    return mergeWall(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.favs)) return;
    var before = JSON.stringify(data.favs);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeWall(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data.favs) !== before) {   // no toast on merge (sync feedback = taskbar dot)
      renderFavs();
      renderFavButton();
    }
  }

  // ---------- 13. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    $("cw").setAttribute("aria-label", t("sz.w"));
    $("ch").setAttribute("aria-label", t("sz.h"));
    $("favs").setAttribute("aria-label", t("sec.favs"));
    $("land-favs").setAttribute("aria-label", t("sec.favs"));
    [["roll-btn", "dice", "btn.roll"], ["export-btn", "exp", "btn.export"], ["fav-btn", "star", "btn.fav"]]
      .forEach(function (x) {
        var b = $(x[0]);
        b.innerHTML = UI_ICONS[x[1]];
        b.setAttribute("aria-label", t(x[2]));
        b.title = t(x[2]);
      });
  }

  function wire() {
    var seedIn = $("seed");
    seedIn.placeholder = "orOS";
    seedIn.addEventListener("input", function () {
      if (isLand()) {
        var d = seedIn.value.replace(/[^0-9]/g, "").slice(0, 6);
        if (d !== seedIn.value) seedIn.value = d;
        if (d) setLand({ seed: parseInt(d, 10) });
        return;
      }
      var s = seedIn.value.replace(/\s+/g, " ").trim();
      setRecipe({ seed: s || "orOS" });
    });
    seedIn.addEventListener("blur", function () { seedIn.value = isLand() ? String(prefs.land.seed) : recipe().seed; });
    seedIn.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); seedIn.blur(); } });
    $("roll-btn").addEventListener("click", rollSeed);
    $("fav-btn").addEventListener("click", toggleFav);
    $("set-btn").addEventListener("click", setWallpaper);
    $("desk-daily").addEventListener("change", function () { setDesk("daily"); });
    $("desk-live").addEventListener("change", function () { setDesk("live"); });
    $("tree-btn").addEventListener("click", shapeTree);
    $("export-btn").addEventListener("click", exportDialog);
    $("panel").addEventListener("submit", function (e) { e.preventDefault(); });

    ["dens", "chaos"].forEach(function (k) {
      $(k).addEventListener("input", function () {
        var p = {}; p[k] = parseInt($(k).value, 10);
        setRecipe(p);
      });
    });
    ["grain", "light"].forEach(function (k) {
      $(k).addEventListener("change", function () {
        var p = {}; p[k] = $(k).checked ? 1 : 0;
        setRecipe(p);
      });
    });
    $("size").addEventListener("change", function () {
      prefs.size = $("size").value;
      savePrefs();
      renderControls();
      schedulePreview();
    });
    ["cw", "ch"].forEach(function (k) {
      $(k).addEventListener("change", function () {
        prefs[k] = clampSide($(k).value, prefs[k]);
        $(k).value = prefs[k];
        savePrefs();
        renderControls();
        schedulePreview();
      });
    });

    if (typeof ResizeObserver === "function") {
      var rTimer = null;
      new ResizeObserver(function () {
        clearTimeout(rTimer);
        rTimer = setTimeout(renderPreview, 120);
      }).observe($("stage"));
    } else {
      window.addEventListener("resize", schedulePreview);
    }
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") savePrefsNow();
    });
    window.addEventListener("pagehide", savePrefsNow);
    // the shell may change the desktop wallpaper while we are open
    window.addEventListener("focus", renderSetButton);

    wireKeyboard();
  }

  function boot() {
    load();
    loadLands();
    loadPrefs();
    applyI18n();
    buildPicker($("styles"), ART.STYLES, "st.", "style", null);
    if (LAND) buildLandPicker();
    wireModes();
    buildPicker($("pals"), ART.PALETTES, "pal.", "pal", paintPalSw);
    buildSizeSelect();
    wire();
    registerSync();
    renderMode();
    renderControls();
    inheritPalette();     // also draws the preview + favourites
    watchPalette();
  }

  boot();
})();
