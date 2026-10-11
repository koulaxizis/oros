// ============================================================
// orOS Tree Sketcher — App logic (v1.0.0)
// A few sliders grow a tree that looks sketched by hand, a little
// different for every seed:
//   - six kinds of tree, four seasons, four drawing styles
//     (pencil, ink, chalk, colour), ground (none, grass, hill)
//   - branches, angle, randomness, leaves, wind; branches can sway
//   - the tree grows on screen (at once with reduced motion)
//   - my trees (synced recipes): open, duplicate, delete with Undo
//   - PNG (portrait, square, landscape), SVG, copy image
//   - "As wallpaper": the Wallpaper Generator's Tree style, set as
//     the orOS wallpaper through parent.orosWallpaper
// Data:
//   - synced slice "trees" (oros-trees-data): saved trees, LWW per
//     tree + tombstones (R5, R17, R26); only recipes, no pictures
//   - device-local (R10): oros-trees-prefs (last recipe, sway,
//     settings open, export shape, side panel)
// Deep link: __orosOpenAt("trees", { wall }) opens the tree of a
// wallpaper recipe (the Wallpaper Generator's "Shape the tree").
// Sections:
//   1. Constants, i18n, helpers
//   2. Storage + prefs
//   3. Drawing
//   4. The tree being made
//   5. Settings
//   6. My trees
//   7. PNG, SVG, copy, wallpaper
//   8. Toasts
//   9. Keyboard (Contract Β) + panel
//  10. Sync slice + palette + deep link
//  11. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C           = window.TreesCore;
  var STORAGE_KEY = "oros-trees-data";
  var PREFS_KEY   = "oros-trees-prefs";
  var SAVE_MS     = 500;
  var GROW_MS     = 1700;
  var SHAPES      = { portrait: [2400, 3000], square: [3000, 3000], landscape: [3840, 2160] };
  var SHAPE_IDS   = ["portrait", "square", "landscape"];

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
      "app.name": "Tree Sketcher",
      "sub.saved": "Saved", "sub.new": "Not saved",
      "btn.list": "My trees", "btn.closePanel": "Close", "btn.roll": "New tree (R)",
      "btn.save": "Save tree", "btn.saved": "Saved", "btn.new": "New tree",
      "tune.show": "Settings", "tune.hide": "Hide settings",
      "f.name": "Name of this tree", "f.name.ph": "Name",
      "f.seed": "Seed", "f.seed.hint": "The same seed and settings always grow the same tree. Try your name.",
      "sec.sp": "Kind of tree", "sec.season": "Season", "sec.ink": "Drawn with", "sec.ground": "Ground",
      "sp.oak": "Oak", "sp.willow": "Willow", "sp.cypress": "Cypress", "sp.olive": "Olive", "sp.bonsai": "Bonsai", "sp.wild": "Wild",
      "season.spring": "Spring", "season.summer": "Summer", "season.autumn": "Autumn", "season.winter": "Winter",
      "ink.pencil": "Pencil", "ink.ink": "Ink", "ink.chalk": "Chalk", "ink.colour": "Colour",
      "ground.none": "None", "ground.grass": "Grass", "ground.hill": "Hill",
      "f.br": "Branches", "f.ang": "Angle", "f.rnd": "Randomness", "f.fol": "Leaves", "f.wind": "Wind",
      "f.sway": "Branches move in the wind", "wind.calm": "Calm", "wind.left": "← {n}", "wind.right": "{n} →",
      "wind.leftText": "{n} to the left", "wind.rightText": "{n} to the right",
      "f.br.text": "{n} levels",
      "sec.out": "Download", "f.shape": "Shape of the picture",
      "shape.portrait": "Portrait", "shape.square": "Square", "shape.landscape": "Landscape",
      "btn.png": "PNG", "btn.svg": "SVG", "btn.copy": "Copy image",
      "btn.wall": "As wallpaper", "btn.isWall": "Your wallpaper",
      "sec.mine": "My trees",
      "mine.empty": "Trees you save appear here. They follow you to all your devices.",
      "item.open": "Open", "item.dup": "Duplicate", "item.delete": "Delete tree",
      "aria.tree": "{sp} in {season}, {br} levels of branches, drawn with {ink}.",
      "toast.saved": "Tree saved", "toast.deleted": "Tree deleted", "toast.undo": "Undo",
      "toast.copied": "Image copied", "toast.copyFail": "Could not copy the image",
      "toast.mineFull": "You have {n} trees, the most there can be",
      "toast.saveFail": "Could not save: storage is full", "toast.file": "Saved",
      "toast.dup": "Copy made", "toast.wall": "Set as your orOS wallpaper. Fine-tune it in the Wallpaper Generator.",
      "toast.fromWall": "The tree of your wallpaper",
      "live.grown": "New tree: {seed}"
    },
    el: {
      "app.name": "Σκιτσογράφος δέντρων",
      "sub.saved": "Αποθηκευμένο", "sub.new": "Δεν έχει αποθηκευτεί",
      "btn.list": "Τα δέντρα μου", "btn.closePanel": "Κλείσιμο", "btn.roll": "Νέο δέντρο (R)",
      "btn.save": "Αποθήκευση", "btn.saved": "Αποθηκεύτηκε", "btn.new": "Νέο δέντρο",
      "tune.show": "Ρυθμίσεις", "tune.hide": "Απόκρυψη ρυθμίσεων",
      "f.name": "Όνομα δέντρου", "f.name.ph": "Όνομα",
      "f.seed": "Σπόρος", "f.seed.hint": "Ο ίδιος σπόρος με τις ίδιες ρυθμίσεις βγάζει πάντα το ίδιο δέντρο. Δοκίμασε το όνομά σου.",
      "sec.sp": "Είδος δέντρου", "sec.season": "Εποχή", "sec.ink": "Σχέδιο με", "sec.ground": "Έδαφος",
      "sp.oak": "Βελανιδιά", "sp.willow": "Ιτιά", "sp.cypress": "Κυπαρίσσι", "sp.olive": "Ελιά", "sp.bonsai": "Μπονσάι", "sp.wild": "Άγριο",
      "season.spring": "Άνοιξη", "season.summer": "Καλοκαίρι", "season.autumn": "Φθινόπωρο", "season.winter": "Χειμώνας",
      "ink.pencil": "Μολύβι", "ink.ink": "Μελάνι", "ink.chalk": "Κιμωλία", "ink.colour": "Χρώμα",
      "ground.none": "Τίποτα", "ground.grass": "Γρασίδι", "ground.hill": "Λόφος",
      "f.br": "Κλαδιά", "f.ang": "Γωνία", "f.rnd": "Τυχαιότητα", "f.fol": "Φύλλα", "f.wind": "Άνεμος",
      "f.sway": "Τα κλαδιά κουνιούνται στον αέρα", "wind.calm": "Νηνεμία", "wind.left": "← {n}", "wind.right": "{n} →",
      "wind.leftText": "{n} προς τα αριστερά", "wind.rightText": "{n} προς τα δεξιά",
      "f.br.text": "{n} επίπεδα",
      "sec.out": "Λήψη", "f.shape": "Σχήμα εικόνας",
      "shape.portrait": "Κάθετο", "shape.square": "Τετράγωνο", "shape.landscape": "Οριζόντιο",
      "btn.png": "PNG", "btn.svg": "SVG", "btn.copy": "Αντιγραφή εικόνας",
      "btn.wall": "Ως ταπετσαρία", "btn.isWall": "Η ταπετσαρία σου",
      "sec.mine": "Τα δέντρα μου",
      "mine.empty": "Τα δέντρα που αποθηκεύεις εμφανίζονται εδώ. Σε ακολουθούν σε όλες τις συσκευές σου.",
      "item.open": "Άνοιγμα", "item.dup": "Διπλασιασμός", "item.delete": "Διαγραφή δέντρου",
      "aria.tree": "{sp}, {season}, {br} επίπεδα κλαδιών, σχέδιο με {ink}.",
      "toast.saved": "Το δέντρο αποθηκεύτηκε", "toast.deleted": "Το δέντρο διαγράφηκε", "toast.undo": "Αναίρεση",
      "toast.copied": "Η εικόνα αντιγράφηκε", "toast.copyFail": "Δεν έγινε αντιγραφή της εικόνας",
      "toast.mineFull": "Έχεις {n} δέντρα, όσα χωράνε",
      "toast.saveFail": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος", "toast.file": "Αποθηκεύτηκε",
      "toast.dup": "Έγινε αντίγραφο", "toast.wall": "Έγινε ταπετσαρία του orOS. Τη ρυθμίζεις στη Γεννήτρια ταπετσαριών.",
      "toast.fromWall": "Το δέντρο της ταπετσαρίας σου",
      "live.grown": "Νέο δέντρο: {seed}"
    }
  };

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
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function setLabel(b, label) { b.setAttribute("aria-label", label); b.title = label; }
  function reducedMotion() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
  }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("trees.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Storage + prefs ----------
  var data = { ver: 1, trees: [], tombs: {} };
  var prefs = null;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.trees)) {
          data = C.mergeTrees(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] trees: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = { ver: 1, trees: [], tombs: {} };
  }

  var saveFailShown = false, saveTimer = null;
  function save() {
    clearTimeout(saveTimer); saveTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.saveFail")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_MS);
  }
  function flush() { if (saveTimer) save(); }

  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    p = (p && typeof p === "object") ? p : {};
    prefs = {
      r: C.normRecipe(p.r) || C.normRecipe({ seed: C.randomSeed(Math.random) }),
      sway: p.sway !== false,
      tune: p.tune !== false,
      shape: SHAPE_IDS.indexOf(p.shape) >= 0 ? p.shape : "portrait",
      panel: p.panel !== false
    };
  }
  var prefsTimer = null;
  function savePrefs() {
    clearTimeout(prefsTimer); prefsTimer = null;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }
  function savePrefsSoon() { clearTimeout(prefsTimer); prefsTimer = setTimeout(savePrefs, 400); }

  // ---------- 3. Drawing ----------
  var model = null;          // the grown tree of rec
  var growT0 = 0;            // when the growing started (0 = grown)
  var frame = 0;             // the requested animation frame
  var swayOff = false;       // too slow to sway on this device
  var slowFrames = 0;

  function lookOf(r) { return C.look(r.ink, r.season); }

  function paintBg(ctx, w, h, L) {
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, L.bg[0]);
    g.addColorStop(1, L.bg[1]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (L.paper || L.ink === "chalk") {            // a little paper grain or chalk dust
      var rnd = C.prng(C.hash32("grain|" + L.ink)), n = Math.round(w * h / 900);
      ctx.fillStyle = L.ink === "chalk" ? "#ffffff" : "#7a6a50";
      for (var i = 0; i < n; i++) {
        ctx.globalAlpha = (L.ink === "chalk" ? 0.05 : 0.06) * rnd();
        ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 1.5, 1);
      }
      ctx.globalAlpha = 1;
    }
  }

  // Draws the tree on ctx (w × h px). opts: { upto, time }
  function drawTree(ctx, w, h, r, m, opts) {
    opts = opts || {};
    var L = lookOf(r);
    paintBg(ctx, w, h, L);
    var f = C.fit(m, w, h);
    var sway = null;
    if (opts.time !== undefined && r.wind) {
      var amp = f.k * 0.018 * Math.abs(r.wind) / 100, tm = opts.time / 1000, dir = r.wind > 0 ? 1 : -1;
      sway = function (x, y, s) {
        return s * amp * (Math.sin(tm * 1.7 + y * 4) * 0.8 + Math.sin(tm * 3.1 + x * 7) * 0.3 + 0.4 * dir);
      };
    }
    ctx.save();
    C.paint(m, L, C.canvasPen(ctx), { k: f.k, ox: f.ox, oy: f.oy, w: w, h: h, upto: opts.upto, sway: sway });
    ctx.restore();
  }

  function swaying() {
    return prefs.sway && !swayOff && rec.wind !== 0 && !reducedMotion() && document.visibilityState !== "hidden";
  }

  function render() {
    cancelAnimationFrame(frame); frame = 0;
    var cv = $("cv"), st = $("stage");
    var w = Math.max(80, st.clientWidth), h = Math.max(80, st.clientHeight);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    cv.style.width = w + "px"; cv.style.height = h + "px";
    var ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var upto = 1;
    if (growT0) {
      upto = Math.min(1, (now() - growT0) / GROW_MS);
      upto = 1 - Math.pow(1 - upto, 2);
      if (upto >= 1) growT0 = 0;
    }
    var t0 = now();
    var sw = !growT0 && swaying();
    drawTree(ctx, w, h, rec, model, { upto: upto, time: sw ? t0 : undefined });
    if (sw) {                                      // a slow device stops swaying
      if (now() - t0 > 45) { if (++slowFrames > 8) swayOff = true; } else slowFrames = 0;
    }
    if (growT0 || sw) frame = requestAnimationFrame(sw && !growT0 ? throttled : render);
  }
  var lastSway = 0;
  function throttled(ts) {
    if (ts - lastSway < 33) { frame = requestAnimationFrame(throttled); return; }   // ~30 frames a second
    lastSway = ts;
    render();
  }
  var renderQueued = false;
  function renderSoon() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () { renderQueued = false; render(); });
  }

  function describe(r) {
    return t("aria.tree", { sp: t("sp." + r.sp), season: t("season." + r.season).toLowerCase(),
                            br: r.br, ink: t("ink." + r.ink).toLowerCase() });
  }

  // ---------- 4. The tree being made ----------
  var cur = null;            // the open saved tree, or null for a new one
  var rec = null;            // the recipe on screen

  function regrow(animate) {
    model = C.grow(rec);
    growT0 = animate && !reducedMotion() ? now() : 0;
    $("cv").setAttribute("aria-label", describe(rec));
    render();
  }

  function renderHead() {
    $("title-view").textContent = t("app.name");
    $("title-sub").textContent = cur ? (cur.name + " · " + t("sub.saved")) : t("sub.new");
    var sb = $("save-btn");
    sb.textContent = cur ? t("btn.saved") : t("btn.save");
    sb.disabled = !!cur;
    sb.classList.toggle("done", !!cur);
    var ni = $("name-in");
    if (document.activeElement !== ni) ni.value = cur ? cur.name : pendingName;
    ni.placeholder = rec.seed;
    renderWallButton();
  }

  var pendingName = "";      // name typed for a tree not saved yet

  // A change of the recipe (from the settings). grow: how to show it.
  function setRecipe(patch, animate) {
    var next = {}, k;
    for (k in rec) next[k] = rec[k];
    for (k in patch) next[k] = patch[k];
    next = C.normRecipe(next);
    if (!next || C.sameRecipe(next, rec)) return;
    rec = next;
    prefs.r = rec; savePrefsSoon();
    if (cur) { cur.r = rec; touch(cur); saveSoon(); renderMineSoon(); }
    renderControls();
    regrow(animate);
    renderHead();
  }

  function touch(tr) { tr.m = Math.max(Date.now(), (data.tombs[tr.id] || 0) + 1, tr.m + 1); }

  function openTree(tr, keepPanel) {
    flush();
    cur = tr || null;
    if (tr) rec = C.normRecipe(tr.r);
    pendingName = "";
    prefs.r = rec; savePrefs();
    renderControls(); renderHead(); renderMine();
    regrow(true);
    if (!keepPanel) closePanelOnPhone();
  }

  function newTree() {
    flush();
    cur = null; pendingName = "";
    var r = {}, k;
    for (k in rec) r[k] = rec[k];
    r.seed = C.randomSeed(Math.random);
    rec = C.normRecipe(r);
    prefs.r = rec; savePrefs();
    renderControls(); renderHead(); renderMine();
    regrow(true);
    live(t("live.grown", { seed: rec.seed }));
  }

  function saveTree() {
    if (cur) return;
    if (data.trees.length >= C.MAX_TREES) { showToast(t("toast.mineFull", { n: C.MAX_TREES })); return; }
    var name = C.cleanName($("name-in").value) || rec.seed;
    var tr = { id: C.newId(Math.random), m: Date.now(), name: name, r: rec };
    data = C.mergeTrees(data, { trees: [tr], tombs: {} });
    save();
    cur = C.findTree(data, tr.id);
    pendingName = "";
    showToast(t("toast.saved"));
    renderHead(); renderMine();
  }

  function onName() {
    var v = $("name-in").value;
    if (!cur) { pendingName = v; return; }
    var name = C.cleanName(v);
    if (!name || name === cur.name) return;
    cur.name = name; touch(cur); saveSoon(); renderMineSoon();
    $("title-sub").textContent = cur.name + " · " + t("sub.saved");
  }

  // ---------- 5. Settings ----------
  function radioChips(host, values, curVal, label, onPick) {
    host.innerHTML = "";
    values.forEach(function (v) {
      var on = v === curVal;
      var b = el("button", "chip" + (on ? " on" : ""), label(v));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      b.addEventListener("click", function () { onPick(v); });
      host.appendChild(b);
    });
    host.onkeydown = function (e) {
      var d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0);
      if (!d) return;
      e.preventDefault();
      var i = values.indexOf(curVal), j = (i + d + values.length) % values.length;
      onPick(values[j]);
      var nb = host.querySelectorAll('[role="radio"]')[j];
      if (nb) nb.focus();
    };
  }

  function windText(v, aria) {
    if (!v) return t("wind.calm");
    return t((v < 0 ? "wind.left" : "wind.right") + (aria ? "Text" : ""), { n: Math.abs(v) });
  }

  function renderControls() {
    radioChips($("sps"), C.SPECIES, rec.sp, function (v) { return t("sp." + v); }, function (v) {
      if (v === rec.sp) return;
      var d = C.speciesDefaults(v);
      setRecipe({ sp: v, br: d.br, ang: d.ang, rnd: d.rnd, fol: d.fol }, true);
    });
    radioChips($("seasons"), C.SEASONS, rec.season, function (v) { return t("season." + v); }, function (v) { setRecipe({ season: v }, false); });
    radioChips($("inks"), C.INKS, rec.ink, function (v) { return t("ink." + v); }, function (v) { setRecipe({ ink: v }, false); });
    radioChips($("grounds"), C.GROUNDS, rec.ground, function (v) { return t("ground." + v); }, function (v) { setRecipe({ ground: v }, false); });
    ["br", "ang", "rnd", "fol", "wind"].forEach(function (k) {
      var inp = $(k + "-in");
      if (document.activeElement !== inp || String(inp.value) !== String(rec[k])) inp.value = rec[k];
      renderSliderText(k);
    });
    var si = $("seed-in");
    if (document.activeElement !== si) si.value = rec.seed;
    $("sway-in").checked = prefs.sway;
    $("sway-in").disabled = reducedMotion();
  }
  function renderSliderText(k) {
    var v = rec[k], out = $(k + "-out"), inp = $(k + "-in");
    var txt = k === "wind" ? windText(v) : (k === "ang" ? v + "°" : String(v));
    out.textContent = txt;
    inp.setAttribute("aria-valuetext", k === "wind" ? windText(v, true) : (k === "br" ? t("f.br.text", { n: v }) : txt));
  }

  function onSlider(k) {
    var v = parseInt($(k + "-in").value, 10);
    if (!isFinite(v)) return;
    var p = {}; p[k] = v;
    setRecipe(p, false);
  }

  var seedTimer = null;
  function onSeed() {
    clearTimeout(seedTimer);
    seedTimer = setTimeout(function () {
      var s = $("seed-in").value.replace(/\s+/g, " ").trim();
      if (s) setRecipe({ seed: s }, true);
    }, 350);
  }

  function renderTune() {
    var open = prefs.tune, b = $("tune-btn");
    $("tune").hidden = !open;
    b.setAttribute("aria-expanded", open ? "true" : "false");
    b.textContent = open ? t("tune.hide") : t("tune.show");
  }
  function toggleTune() { prefs.tune = !prefs.tune; savePrefs(); renderTune(); }

  function onSway() {
    prefs.sway = $("sway-in").checked; savePrefs();
    swayOff = false; slowFrames = 0;
    render();
  }

  // ---------- 6. My trees ----------
  var mineTimer = null;
  function renderMineSoon() { clearTimeout(mineTimer); mineTimer = setTimeout(renderMine, 600); }

  // Small pictures, drawn one per tick.
  var thumbJobs = [], thumbTimer = null, thumbCache = {};
  function thumb(node, r) {
    var key = JSON.stringify(r);
    if (thumbCache[key]) { node.style.backgroundImage = 'url("' + thumbCache[key] + '")'; return; }
    thumbJobs.push({ node: node, r: r, key: key });
    if (!thumbTimer) thumbTimer = setTimeout(drainThumbs, 30);
  }
  function drainThumbs() {
    thumbTimer = null;
    var job = thumbJobs.shift();
    if (!job) return;
    if (job.node.isConnected) {
      if (!thumbCache[job.key]) {
        var cv = document.createElement("canvas");
        cv.width = 96; cv.height = 120;
        drawTree(cv.getContext("2d"), 96, 120, job.r, C.grow(job.r), {});
        var keys = Object.keys(thumbCache);
        if (keys.length > 250) delete thumbCache[keys[0]];
        thumbCache[job.key] = cv.toDataURL("image/png");
      }
      job.node.style.backgroundImage = 'url("' + thumbCache[job.key] + '")';
    }
    if (thumbJobs.length) thumbTimer = setTimeout(drainThumbs, 0);
  }

  function renderMine() {
    clearTimeout(mineTimer);
    var host = $("mine"), list = C.newestFirst(data.trees);
    host.innerHTML = "";
    thumbJobs = [];
    $("mine-empty").hidden = list.length > 0;
    $("mine-count").textContent = list.length ? String(list.length) : "";
    list.forEach(function (tr) {
      var li = el("li", "row"), on = !!(cur && cur.id === tr.id);
      if (on) li.classList.add("on");
      var open = el("button", "row-open");
      open.type = "button";
      if (on) open.setAttribute("aria-current", "true");
      var th = el("span", "thumb");
      th.setAttribute("aria-hidden", "true");
      open.appendChild(th);
      var txt = el("span", "row-text");
      txt.appendChild(el("span", "row-name", tr.name));
      txt.appendChild(el("span", "row-sub", t("sp." + tr.r.sp) + " · " + t("season." + tr.r.season)));
      open.appendChild(txt);
      setLabel(open, t("item.open") + ": " + tr.name);
      open.addEventListener("click", function () { openTree(C.findTree(data, tr.id)); });
      li.appendChild(open);
      var dup = el("button", "icon-btn");
      dup.type = "button"; dup.innerHTML = ICON.dup;
      setLabel(dup, t("item.dup") + ": " + tr.name);
      dup.addEventListener("click", function () { duplicate(tr.id); });
      li.appendChild(dup);
      var d = el("button", "icon-btn del-btn");
      d.type = "button"; d.innerHTML = ICON.del;
      setLabel(d, t("item.delete") + ": " + tr.name);
      d.addEventListener("click", function () { deleteTree(tr.id); });
      li.appendChild(d);
      host.appendChild(li);
      thumb(th, tr.r);
    });
  }

  function duplicate(id) {
    var tr = C.findTree(data, id);
    if (!tr) return;
    if (data.trees.length >= C.MAX_TREES) { showToast(t("toast.mineFull", { n: C.MAX_TREES })); return; }
    var copy = JSON.parse(JSON.stringify(tr));
    copy.id = C.newId(Math.random); copy.m = Date.now();
    data = C.mergeTrees(data, { trees: [copy], tombs: {} });
    save();
    openTree(C.findTree(data, copy.id), true);
    showToast(t("toast.dup"));
  }

  function deleteTree(id) {
    var tr = C.findTree(data, id);
    if (!tr) return;
    var snap = JSON.parse(JSON.stringify(tr)), tombs = {};
    tombs[id] = Math.max(Date.now(), tr.m);
    data = C.mergeTrees(data, { trees: [], tombs: tombs });
    save();
    if (cur && cur.id === id) { cur = null; renderHead(); }      // the tree stays on screen, unsaved
    renderMine();
    undoToast(t("toast.deleted"), function () {
      snap.m = Math.max(Date.now(), (data.tombs[snap.id] || 0) + 1);   // R17
      data = C.mergeTrees(data, { trees: [snap], tombs: {} });
      save();
      openTree(C.findTree(data, snap.id), true);
    });
  }

  // ---------- 7. PNG, SVG, copy, wallpaper ----------
  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
  }
  function nameNow() { return cur ? cur.name : (C.cleanName($("name-in").value) || rec.seed); }

  function saveBlob(blob, name, mime, ext) {
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      var acc = {}; acc[mime] = ["." + ext];
      dlg.saveFile({ blob: blob, filename: name, mime: mime, types: [{ description: ext.toUpperCase(), accept: acc }] })
        .then(function (r) { if (r && r.ok) showToast(t("toast.file")); });
      return;                         // cancel (ok=false) = silent exit
    }
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    showToast(t("toast.file"));
  }

  function pngBlob(cb) {
    var wh = SHAPES[prefs.shape];
    var cv = document.createElement("canvas");
    cv.width = wh[0]; cv.height = wh[1];
    var ctx = cv.getContext("2d");
    if (!ctx) { cb(null); return; }
    drawTree(ctx, wh[0], wh[1], rec, model, {});
    if (cv.toBlob) cv.toBlob(function (b) { cv.width = cv.height = 0; cb(b); }, "image/png");
    else cb(null);
  }
  function downloadPng() {
    pngBlob(function (blob) { if (blob) saveBlob(blob, C.fileName(nameNow(), "png"), "image/png", "png"); });
  }
  function downloadSvg() {
    var wh = SHAPES[prefs.shape];
    var svg = C.toSVG(rec, Math.round(wh[0] / 2), Math.round(wh[1] / 2), nameNow());
    saveBlob(new Blob([svg], { type: "image/svg+xml" }), C.fileName(nameNow(), "svg"), "image/svg+xml", "svg");
  }
  function canCopyImage() {
    return !!(navigator.clipboard && navigator.clipboard.write && window.ClipboardItem);
  }
  function copyImage() {
    var fail = function () { showToast(t("toast.copyFail")); };
    try {
      // The blob is handed over as a promise so Safari keeps the click.
      var item = new window.ClipboardItem({ "image/png": new Promise(function (res, rej) {
        pngBlob(function (b) { if (b) res(b); else rej(new Error("no image")); });
      }) });
      navigator.clipboard.write([item]).then(function () { showToast(t("toast.copied")); }, fail);
    } catch (e) { fail(); }
  }
  function renderShapes() {
    var sel = $("shape-sel");
    sel.innerHTML = "";
    SHAPE_IDS.forEach(function (id) {
      var o = el("option", "", t("shape." + id) + " · " + SHAPES[id][0] + " × " + SHAPES[id][1]);
      o.value = id;
      sel.appendChild(o);
    });
    sel.value = prefs.shape;
  }

  function wallApi() {
    try {
      var w = window.parent && window.parent !== window && window.parent.orosWallpaper;
      var art = window.parent && window.parent.OrosWallArt;
      return (w && typeof w.setCustom === "function" && art && art.STYLES.indexOf("tree") >= 0) ? w : null;
    } catch (e) { return null; }
  }
  function renderWallButton() {
    var api = wallApi(), b = $("wall-btn");
    b.hidden = !api;                 // standalone: no desktop (R28)
    if (!api) return;
    var curW = null;
    try { curW = api.get(); } catch (e) {}
    var mine = null;
    try { mine = window.parent.OrosWallArt.normRecipe(C.toWallRecipe(rec)); } catch (e) {}
    var isSet = !!(curW && curW.active && !curW.picture && curW.recipe && mine && JSON.stringify(curW.recipe) === JSON.stringify(mine));
    b.classList.toggle("on", isSet);
    b.setAttribute("aria-pressed", isSet ? "true" : "false");
    b.textContent = t(isSet ? "btn.isWall" : "btn.wall");
  }
  function setWallpaper() {
    var api = wallApi();
    if (!api) return;
    var ok = false;
    try { ok = api.setCustom(C.toWallRecipe(rec)); } catch (e) { ok = false; }
    if (ok) showToast(t("toast.wall"));
    renderWallButton();
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "trees", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  // Undo toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, onUndo); }

  var toastTimer = null;
  function localToast(text, onUndo) {
    var box = $("toast");
    if (!box) return;
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

  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 9. Keyboard + panel ----------
  function typing(e) {
    var tg = e.target, tag = tg && tg.tagName;
    return tag === "INPUT" && tg.type !== "range" && tg.type !== "checkbox" || tag === "TEXTAREA" || tag === "SELECT";
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
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && phone() && document.body.classList.contains("panel-open")) {
        e.preventDefault(); setPanel(false); $("list-btn").focus(); return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
      if (e.key === "r" || e.key === "R") { e.preventDefault(); newTree(); }
    });
    $("name-in").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); if (!cur) saveTree(); else $("name-in").blur(); }
    });
  }

  // Panel: always there on a wide screen (can be hidden), a drawer on a phone.
  function phone() { return window.matchMedia("(max-width: 760px)").matches; }
  function setPanel(open) {
    document.body.classList.toggle("panel-open", open);
    $("list-btn").setAttribute("aria-expanded", open ? "true" : "false");
    $("scrim").hidden = !(open && phone());
    if (!phone()) { prefs.panel = open; savePrefs(); }
    setTimeout(render, 0);
  }
  function togglePanel() {
    var open = !document.body.classList.contains("panel-open");
    setPanel(open);
    if (open && phone()) { var first = $("panel").querySelector("button, input"); if (first) first.focus(); }
  }
  function closePanelOnPhone() { if (phone() && document.body.classList.contains("panel-open")) setPanel(false); }

  // ---------- 10. Sync slice + palette + deep link ----------
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
    api.registerSlice("trees", sliceGet, sliceSet, STORAGE_KEY, C.mergeTrees);
  }

  function sliceGet() { if (saveTimer) save(); return C.mergeTrees(data, data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.trees)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.mergeTrees(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;   // no toast on merge
    if (cur) {
      var fresh = C.findTree(data, cur.id);
      if (!fresh) { cur = null; }                   // deleted on another device: the tree stays, unsaved
      else {
        cur = fresh;
        if (!C.sameRecipe(fresh.r, rec)) {
          rec = C.normRecipe(fresh.r);
          prefs.r = rec; savePrefsSoon();
          renderControls(); regrow(false);
        }
      }
    }
    renderHead(); renderMine();
  }

  // Deep link (the Wallpaper Generator): { wall } opens that tree.
  function openTarget(target) {
    if (!target || typeof target !== "object") return;
    var r = target.wall ? C.fromWallRecipe(target.wall) : C.normRecipe(target.recipe);
    if (!r) return;
    flush();
    cur = null; pendingName = "";
    rec = r;
    prefs.r = rec; savePrefs();
    renderControls(); renderHead(); renderMine();
    regrow(true);
    closePanelOnPhone();
    if (target.wall) live(t("toast.fromWall"));
  }
  window.__orosOpenAt = function (target) { openTarget(target); };

  // ---------- 11. Wiring & boot ----------
  var ICON = {
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22v-7"/><path d="M12 15c-4.5 0-7-2.5-7-6a7 7 0 0 1 14 0c0 3.5-2.5 6-7 6z"/><path d="M12 15l-3-3M12 13l3-3"/></svg>',
    roll: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="16" cy="16" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="16" cy="8" r="1.2" fill="currentColor"/><circle cx="8" cy="16" r="1.2" fill="currentColor"/></svg>',
    del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    dup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
  };

  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    document.title = t("app.name") + " · orOS";
    $("list-btn").innerHTML = ICON.list; setLabel($("list-btn"), t("btn.list"));
    $("roll-btn").innerHTML = ICON.roll; setLabel($("roll-btn"), t("btn.roll"));
    $("roll2-btn").innerHTML = ICON.roll; setLabel($("roll2-btn"), t("btn.roll"));
    $("close-panel").innerHTML = ICON.del; setLabel($("close-panel"), t("btn.closePanel"));
    $("new-btn").insertAdjacentHTML("afterbegin", ICON.plus);
    $("name-in").placeholder = t("f.name.ph");
    $("copy-btn").hidden = !canCopyImage();
  }

  function wire() {
    ["br", "ang", "rnd", "fol", "wind"].forEach(function (k) {
      $(k + "-in").addEventListener("input", function () { onSlider(k); });
    });
    $("seed-in").addEventListener("input", onSeed);
    $("seed-in").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); clearTimeout(seedTimer); var s = $("seed-in").value.trim(); if (s) setRecipe({ seed: s }, true); }
    });
    $("name-in").addEventListener("input", onName);
    $("sway-in").addEventListener("change", onSway);
    $("tune-btn").addEventListener("click", toggleTune);
    $("list-btn").addEventListener("click", togglePanel);
    $("close-panel").addEventListener("click", function () { setPanel(false); $("list-btn").focus(); });
    $("scrim").addEventListener("click", function () { setPanel(false); });
    $("save-btn").addEventListener("click", saveTree);
    $("new-btn").addEventListener("click", newTree);
    $("roll-btn").addEventListener("click", newTree);
    $("roll2-btn").addEventListener("click", newTree);
    $("png-btn").addEventListener("click", downloadPng);
    $("svg-btn").addEventListener("click", downloadSvg);
    $("copy-btn").addEventListener("click", copyImage);
    $("wall-btn").addEventListener("click", setWallpaper);
    $("shape-sel").addEventListener("change", function () {
      prefs.shape = SHAPE_IDS.indexOf($("shape-sel").value) >= 0 ? $("shape-sel").value : "portrait";
      savePrefs();
    });
    var rz = null;
    window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(renderSoon, 80); });
    window.addEventListener("pagehide", function () { flush(); savePrefs(); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { flush(); savePrefs(); }
      else render();
    });
    wireKeyboard();
  }

  function boot() {
    load();
    loadPrefs();
    applyI18n();
    inheritPalette();
    rec = prefs.r;
    wire();
    registerSync();
    watchPalette();
    setPanel(!phone() && prefs.panel);
    renderShapes();
    renderTune();
    renderControls();
    renderHead();
    renderMine();
    regrow(true);
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === "function") {
        var pending = window.parent.__orosTakeTarget("trees");
        if (pending) openTarget(pending);
      }
    } catch (e) {}
  }

  boot();
})();
