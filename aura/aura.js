// ============================================================
// orOS Aura Painter — App logic (v1.0.0)
// Paint with light: drag a finger, a pen or the mouse and glowing
// strokes follow, brighter where colours cross.
//   - five brushes (glow, neon, sparks, mist, ribbon); size and
//     brightness; hand speed and pen pressure change the width
//   - palettes, any colour, rainbow strokes
//   - symmetry: mirror, kaleidoscope 4, 6, 8, 12
//   - "strokes fade away" play mode; undo/redo; clear with Undo
//   - backgrounds: black, deep blue, night purple, light
//   - my works (synced strokes): open, duplicate, delete with Undo
//   - PNG (screen size or double), replay, "Surprise" (a random
//     work, replayed), "As wallpaper" (this device only, through
//     parent.orosWallpaper.setImage)
// Data:
//   - synced slice "aura" (oros-aura-data): my works, LWW per work
//     + tombstones (R5, R17, R26); strokes, not pictures
//   - device-local (R10): oros-aura-prefs (brush, size, colour,
//     symmetry, background, fade, settings open, PNG size) and
//     oros-aura-draft (the unsaved work on the canvas)
// Deep link: __orosOpenAt("aura", { id }) opens a saved work,
// { surprise: true } makes a random one.
// Sections:
//   1. Constants, i18n, helpers
//   2. Storage + prefs
//   3. Drawing the canvas
//   4. Painting (pointer)
//   5. The work: history, new, save, open
//   6. Settings
//   7. My works
//   8. Replay, surprise
//   9. PNG, wallpaper
//  10. Toasts
//  11. Keyboard (Contract Β) + panel
//  12. Sync slice + palette + deep link
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C           = window.AuraCore;
  var STORAGE_KEY = "oros-aura-data";
  var PREFS_KEY   = "oros-aura-prefs";
  var DRAFT_KEY   = "oros-aura-draft";
  var SAVE_MS     = 600;
  var HISTORY     = 100;
  var MAX_PNG     = 7680;

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
      "app.name": "Aura Painter",
      "sub.saved": "Saved", "sub.new": "Not saved",
      "btn.list": "My works", "btn.closePanel": "Close",
      "btn.undo": "Undo (Ctrl+Z)", "btn.redo": "Redo (Ctrl+Y)", "btn.clear": "Clear the canvas",
      "btn.surprise": "Surprise: a random work",
      "btn.save": "Save", "btn.saved": "Saved", "btn.new": "New",
      "btn.stop": "Stop replay",
      "tune.show": "Brushes", "tune.hide": "Hide brushes",
      "f.name": "Name of this work", "f.name.ph": "Name",
      "name.default": "Light {n}",
      "sec.brush": "Brush", "sec.colour": "Colour", "sec.sym": "Symmetry", "sec.bg": "Background", "sec.play": "Play",
      "brush.glow": "Glow", "brush.neon": "Neon", "brush.sparks": "Sparks", "brush.mist": "Mist", "brush.ribbon": "Ribbon",
      "brush.key": "{name} ({n})",
      "f.pal": "Palette", "f.pick": "Any colour", "rainbow": "Rainbow", "sw.colour": "Colour {n}",
      "pal.aurora": "Aurora", "pal.sunset": "Sunset", "pal.ocean": "Ocean", "pal.neon": "Neon", "pal.fire": "Fire",
      "f.size": "Size", "f.glow": "Brightness",
      "sym.none": "Off", "sym.mirror": "Mirror", "sym.k": "×{n}", "sym.kText": "Kaleidoscope, {n} rays",
      "bg.black": "Black", "bg.blue": "Deep blue", "bg.purple": "Night purple", "bg.light": "Light",
      "f.fade": "Strokes fade away", "f.fade.hint": "For painting without an end. Fading strokes are not saved.",
      "meter": "{n} of {max} points", "meter.full": "The work is full: {max} points",
      "sec.out": "Download and more", "f.scale": "Picture size",
      "scale.1": "Screen size · {w} × {h}", "scale.2": "Double · {w} × {h}",
      "btn.png": "PNG", "btn.replay": "Replay", "btn.wall": "As wallpaper",
      "sec.mine": "My works",
      "mine.empty": "Works you save appear here. They follow you to all your devices.",
      "item.open": "Open", "item.dup": "Duplicate", "item.delete": "Delete work",
      "item.strokes": "{n} strokes", "item.stroke1": "1 stroke",
      "aria.cv": "Canvas for painting with light. {n} strokes.",
      "aria.cvEmpty": "Canvas for painting with light. Empty: drag to paint.",
      "toast.saved": "Work saved", "toast.deleted": "Work deleted", "toast.undo": "Undo",
      "toast.cleared": "Canvas cleared", "toast.newWork": "New canvas",
      "toast.empty": "Paint something first",
      "toast.full": "This work is full ({max} points). Save it and start a new one.",
      "toast.mineFull": "You have {n} works, the most there can be",
      "toast.saveFail": "Could not save: storage is full", "toast.file": "Saved",
      "toast.dup": "Copy made", "toast.wall": "Set as the wallpaper of this device",
      "toast.wallFail": "Could not set the wallpaper",
      "toast.surprise": "A surprise work. Save it if you like it.",
      "live.replay": "Replaying the work", "live.replayDone": "Replay finished"
    },
    el: {
      "app.name": "Ζωγραφική με φως",
      "sub.saved": "Αποθηκευμένο", "sub.new": "Δεν έχει αποθηκευτεί",
      "btn.list": "Τα έργα μου", "btn.closePanel": "Κλείσιμο",
      "btn.undo": "Αναίρεση (Ctrl+Z)", "btn.redo": "Επανάληψη ενέργειας (Ctrl+Y)", "btn.clear": "Καθαρισμός καμβά",
      "btn.surprise": "Έκπληξη: ένα τυχαίο έργο",
      "btn.save": "Αποθήκευση", "btn.saved": "Αποθηκεύτηκε", "btn.new": "Νέο",
      "btn.stop": "Διακοπή επανάληψης",
      "tune.show": "Πινέλα", "tune.hide": "Απόκρυψη πινέλων",
      "f.name": "Όνομα έργου", "f.name.ph": "Όνομα",
      "name.default": "Φως {n}",
      "sec.brush": "Πινέλο", "sec.colour": "Χρώμα", "sec.sym": "Συμμετρία", "sec.bg": "Φόντο", "sec.play": "Παιχνίδι",
      "brush.glow": "Λάμψη", "brush.neon": "Νέον", "brush.sparks": "Σπινθήρες", "brush.mist": "Ομίχλη", "brush.ribbon": "Κορδέλα",
      "brush.key": "{name} ({n})",
      "f.pal": "Παλέτα", "f.pick": "Οποιοδήποτε χρώμα", "rainbow": "Ουράνιο τόξο", "sw.colour": "Χρώμα {n}",
      "pal.aurora": "Βόρειο σέλας", "pal.sunset": "Ηλιοβασίλεμα", "pal.ocean": "Ωκεανός", "pal.neon": "Νέον", "pal.fire": "Φωτιά",
      "f.size": "Μέγεθος", "f.glow": "Φωτεινότητα",
      "sym.none": "Χωρίς", "sym.mirror": "Καθρέφτης", "sym.k": "×{n}", "sym.kText": "Καλειδοσκόπιο, {n} ακτίνες",
      "bg.black": "Μαύρο", "bg.blue": "Βαθύ μπλε", "bg.purple": "Μωβ νύχτας", "bg.light": "Ανοιχτό",
      "f.fade": "Οι πινελιές σβήνουν σιγά σιγά", "f.fade.hint": "Για ζωγραφική χωρίς τέλος. Οι πινελιές που σβήνουν δεν αποθηκεύονται.",
      "meter": "{n} από {max} σημεία", "meter.full": "Το έργο γέμισε: {max} σημεία",
      "sec.out": "Λήψη και άλλα", "f.scale": "Μέγεθος εικόνας",
      "scale.1": "Μέγεθος οθόνης · {w} × {h}", "scale.2": "Διπλάσιο · {w} × {h}",
      "btn.png": "PNG", "btn.replay": "Επανάληψη", "btn.wall": "Ως ταπετσαρία",
      "sec.mine": "Τα έργα μου",
      "mine.empty": "Τα έργα που αποθηκεύεις εμφανίζονται εδώ. Σε ακολουθούν σε όλες τις συσκευές σου.",
      "item.open": "Άνοιγμα", "item.dup": "Διπλασιασμός", "item.delete": "Διαγραφή έργου",
      "item.strokes": "{n} πινελιές", "item.stroke1": "1 πινελιά",
      "aria.cv": "Καμβάς για ζωγραφική με φως. {n} πινελιές.",
      "aria.cvEmpty": "Καμβάς για ζωγραφική με φως. Άδειος: σύρε για να ζωγραφίσεις.",
      "toast.saved": "Το έργο αποθηκεύτηκε", "toast.deleted": "Το έργο διαγράφηκε", "toast.undo": "Αναίρεση",
      "toast.cleared": "Ο καμβάς καθάρισε", "toast.newWork": "Νέος καμβάς",
      "toast.empty": "Ζωγράφισε κάτι πρώτα",
      "toast.full": "Το έργο γέμισε ({max} σημεία). Αποθήκευσέ το και ξεκίνα νέο.",
      "toast.mineFull": "Έχεις {n} έργα, όσα χωράνε",
      "toast.saveFail": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος", "toast.file": "Αποθηκεύτηκε",
      "toast.dup": "Έγινε αντίγραφο", "toast.wall": "Έγινε ταπετσαρία αυτής της συσκευής",
      "toast.wallFail": "Δεν έγινε ταπετσαρία",
      "toast.surprise": "Ένα έργο-έκπληξη. Αποθήκευσέ το αν σου αρέσει.",
      "live.replay": "Το έργο ξαναζωγραφίζεται", "live.replayDone": "Η επανάληψη τελείωσε"
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
  function num(n) { try { return n.toLocaleString(LANG === "el" ? "el-GR" : "en-GB"); } catch (e) { return String(n); } }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("aura.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Storage + prefs ----------
  var data = { ver: 1, works: [], tombs: {} };
  var prefs = null;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.works)) {
          data = C.mergeWorks(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] aura: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = { ver: 1, works: [], tombs: {} };
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
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, SAVE_MS); }
  function flush() { if (saveTimer) save(); if (draftTimer) saveDraft(); }

  function pick(v, list, dflt) { return list.indexOf(v) >= 0 ? v : dflt; }
  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    p = (p && typeof p === "object") ? p : {};
    var pal = pick(p.pal, C.PALETTE_IDS, "aurora");
    prefs = {
      brush: pick(p.brush, C.BRUSHES, "glow"),
      size: typeof p.size === "number" ? Math.max(1, Math.min(100, Math.round(p.size))) : 30,
      glow: typeof p.glow === "number" ? Math.max(10, Math.min(100, Math.round(p.glow))) : 75,
      pal: pal,
      colour: C.normColour(p.colour) && p.colour.charAt(0) === "#" ? p.colour.toLowerCase() : C.PALETTES[pal][0],
      rainbow: p.rainbow === true,
      hue: typeof p.hue === "number" ? Math.abs(Math.round(p.hue)) % 360 : 0,
      sym: pick(p.sym, C.SYMS, "none"),
      bg: pick(p.bg, C.BGS, "black"),
      fade: p.fade === true,
      tune: p.tune !== false,
      scale: p.scale === 2 ? 2 : 1
    };
  }
  var prefsTimer = null;
  function savePrefs() {
    clearTimeout(prefsTimer); prefsTimer = null;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }
  function savePrefsSoon() { clearTimeout(prefsTimer); prefsTimer = setTimeout(savePrefs, 400); }

  // The unsaved work on the canvas: this device only.
  var draftTimer = null;
  function loadDraft() {
    try {
      var d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (!d || typeof d !== "object") return null;
      var wk = C.normWork({ id: "adraft00", m: 0, name: "", w: d.w, h: d.h, bg: d.bg, st: d.st });
      return wk ? { w: wk.w, h: wk.h, bg: wk.bg, st: wk.st } : null;
    } catch (e) { return null; }
  }
  function saveDraft() {
    clearTimeout(draftTimer); draftTimer = null;
    try {
      if (cur || !work.st.length) localStorage.removeItem(DRAFT_KEY);
      else localStorage.setItem(DRAFT_KEY, JSON.stringify({ w: work.w, h: work.h, bg: work.bg, st: work.st }));
    } catch (e) {}
  }
  function saveDraftSoon() { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, SAVE_MS); }

  // A change to the strokes or background of the work on screen.
  function workChanged() {
    if (cur) { touch(cur); saveSoon(); renderMineSoon(); }
    else saveDraftSoon();
    renderHead();
  }
  function touch(wk) { wk.m = Math.max(Date.now(), (data.tombs[wk.id] || 0) + 1, wk.m + 1); }

  // ---------- 3. Drawing the canvas ----------
  var cur = null;            // the open saved work, or null
  var work = null;           // the work on screen { w, h, bg, st } (= cur when saved)
  var base = null;           // offscreen canvas with every finished stroke
  var stroke = null;         // the stroke being painted { b, c, s, g, y, pts }
  var fading = [];           // [{ st, born }] strokes of the fade mode
  var replay = null;         // the replay running
  var frame = 0;
  var pix = { w: 1, h: 1, dpr: 1 };

  function fadeMs() { return reducedMotion() ? 9000 : 4500; }
  function holdMs() { return reducedMotion() ? 2500 : 1200; }

  function stageSize() {
    var st = $("stage");
    var w = Math.max(80, st.clientWidth), h = Math.max(80, st.clientHeight);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    return { cw: w, ch: h, w: Math.round(w * dpr), h: Math.round(h * dpr), dpr: dpr };
  }

  // The canvas follows the stage; an empty unsaved work takes its shape.
  function resizeCanvas() {
    var s = stageSize(), cv = $("cv");
    if (cv.width !== s.w || cv.height !== s.h) { cv.width = s.w; cv.height = s.h; }
    cv.style.width = s.cw + "px"; cv.style.height = s.ch + "px";
    pix = { w: s.w, h: s.h, dpr: s.dpr };
    if (!cur && !work.st.length) {
      var sz = C.sizeFor(s.w, s.h);
      work.w = sz.w; work.h = sz.h;
    }
    rebuild();
  }

  function rebuild() {
    if (!base) base = document.createElement("canvas");
    if (base.width !== pix.w || base.height !== pix.h) { base.width = pix.w; base.height = pix.h; }
    var ctx = base.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    C.draw(ctx, work, pix.w, pix.h, { calm: reducedMotion() });
    shade(ctx);
    paint();
  }

  // Outside the work (another shape of screen): a little darker.
  function shade(ctx) {
    var f = C.fit(work, pix.w, pix.h);
    var x0 = Math.round(f.ox), y0 = Math.round(f.oy);
    if (x0 < 1 && y0 < 1) return;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = work.bg === "light" ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.05)";
    if (x0 >= 1) { ctx.fillRect(0, 0, x0, pix.h); ctx.fillRect(pix.w - x0, 0, x0, pix.h); }
    if (y0 >= 1) { ctx.fillRect(0, 0, pix.w, y0); ctx.fillRect(0, pix.h - y0, pix.w, y0); }
    ctx.restore();
  }

  function strokeOpts() {
    var f = C.fit(work, pix.w, pix.h);
    return { k: f.k, ox: f.ox, oy: f.oy, cx: work.w / 2, cy: work.h / 2,
             light: work.bg === "light", calm: reducedMotion() };
  }
  function withMode(ctx, fn) {
    ctx.save();
    ctx.globalCompositeOperation = work.bg === "light" ? "multiply" : "lighter";
    fn();
    ctx.restore();
  }

  function liveStroke() {
    if (!stroke || !stroke.pts.length) return null;
    return { b: stroke.b, c: stroke.c, s: stroke.s, g: stroke.g, y: stroke.y, p: C.encodePoints(stroke.pts) };
  }

  // The visible canvas = base + fading strokes + the stroke being painted.
  function paint() {
    var cv = $("cv"), ctx = cv.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    if (replay) { paintReplay(ctx); return; }
    ctx.drawImage(base, 0, 0);
    var o = strokeOpts(), tm = now(), alive = [];
    if (fading.length) {
      withMode(ctx, function () {
        fading.forEach(function (fd) {
          var age = tm - fd.born, a = age < holdMs() ? 1 : 1 - (age - holdMs()) / fadeMs();
          if (a <= 0) return;
          alive.push(fd);
          o.alpha = a;
          C.drawStroke(ctx, fd.st, o);
        });
      });
      fading = alive;
      o.alpha = undefined;
    }
    var ls = liveStroke();
    if (ls) withMode(ctx, function () { C.drawStroke(ctx, ls, o); });
    if (fading.length) loop();
  }

  function loop() {
    if (frame) return;
    frame = requestAnimationFrame(function () { frame = 0; paint(); });
  }

  function describe() {
    var n = work.st.length;
    $("cv").setAttribute("aria-label", n ? t("aria.cv", { n: n }) : t("aria.cvEmpty"));
  }

  // ---------- 4. Painting (pointer) ----------
  var activeId = null, lastPt = null, total = 0, fullShown = false;

  function toWork(e) {
    var r = $("cv").getBoundingClientRect(), f = C.fit(work, pix.w, pix.h);
    var px = (e.clientX - r.left) * pix.dpr, py = (e.clientY - r.top) * pix.dpr;
    return { x: (px - f.ox) / f.k, y: (py - f.oy) / f.k, t: e.timeStamp || now(),
             pen: e.pointerType === "pen" && e.pressure > 0 ? e.pressure : null };
  }

  function strokeColour() {
    if (!prefs.rainbow) return prefs.colour;
    return "r" + prefs.hue;
  }

  function onDown(e) {
    if (replay) { stopReplay(); return; }
    if (activeId !== null || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    activeId = e.pointerId;
    try { $("cv").setPointerCapture(e.pointerId); } catch (err) {}
    total = prefs.fade ? 0 : C.pointCount(work.st);
    fullShown = false;
    stroke = { b: prefs.brush, c: strokeColour(), s: prefs.size, g: prefs.glow, y: prefs.sym, pts: [], wv: 8 };
    lastPt = null;
    addPoint(toWork(e));
    paint();
  }

  function addPoint(p) {
    if (!stroke) return;
    if (stroke.pts.length >= C.MAX_STROKE) return;
    if (!prefs.fade && total + stroke.pts.length >= C.MAX_POINTS) {
      if (!fullShown) { fullShown = true; showToast(t("toast.full", { max: num(C.MAX_POINTS) })); }
      return;
    }
    var x = Math.round(Math.max(0, Math.min(work.w, p.x)));
    var y = Math.round(Math.max(0, Math.min(work.h, p.y)));
    var w;
    if (lastPt) {
      var dx = x - lastPt.x, dy = y - lastPt.y, d = Math.sqrt(dx * dx + dy * dy);
      var minD = Math.max(3, 2.5 / C.fit(work, pix.w, pix.h).k);
      if (d < minD) return;
      var dt = Math.max(1, p.t - lastPt.t);
      var target = p.pen !== null ? 2 + p.pen * 13 : Math.max(3, Math.min(13, 12.5 - (d / dt) * 2.2));
      stroke.wv = stroke.wv * 0.7 + target * 0.3;       // eased, so the width breathes
    } else if (p.pen !== null) {
      stroke.wv = 2 + p.pen * 13;
    }
    w = Math.round(Math.max(0, Math.min(15, stroke.wv)));
    stroke.pts.push({ x: x, y: y, w: w });
    lastPt = { x: x, y: y, t: p.t };
  }

  function onMove(e) {
    if (e.pointerId !== activeId || !stroke) return;
    e.preventDefault();
    var list = (typeof e.getCoalescedEvents === "function" && e.getCoalescedEvents()) || [];
    if (!list.length) list = [e];
    for (var i = 0; i < list.length; i++) addPoint(toWork(list[i]));
    if (!frame) frame = requestAnimationFrame(function () { frame = 0; paint(); });
  }

  function onUp(e) {
    if (e.pointerId !== activeId) return;
    activeId = null;
    var ls = liveStroke();
    stroke = null;
    if (!ls) { paint(); return; }
    if (prefs.rainbow) { prefs.hue = (prefs.hue + 47) % 360; savePrefsSoon(); }
    if (prefs.fade) {
      fading.push({ st: ls, born: now() });
      paint();
      return;
    }
    remember();
    work.st.push(ls);
    var ctx = base.getContext("2d");
    withMode(ctx, function () { C.drawStroke(ctx, ls, strokeOpts()); });
    paint();
    workChanged();
    renderTools();
  }

  // ---------- 5. The work: history, new, save, open ----------
  var undoStack = [], redoStack = [];

  function remember() {
    undoStack.push(work.st.slice());
    if (undoStack.length > HISTORY) undoStack.shift();
    redoStack = [];
  }
  function undo() {
    if (!undoStack.length || replay) return;
    redoStack.push(work.st.slice());
    work.st = undoStack.pop();
    afterStrokes();
  }
  function redo() {
    if (!redoStack.length || replay) return;
    undoStack.push(work.st.slice());
    work.st = redoStack.pop();
    afterStrokes();
  }
  function afterStrokes() { rebuild(); workChanged(); renderTools(); }

  function clearCanvas() {
    if (replay) stopReplay();
    if (!work.st.length && !fading.length) return;
    fading = [];
    if (!work.st.length) { paint(); return; }
    remember();
    work.st = [];
    afterStrokes();
    undoToast(t("toast.cleared"), function () { undo(); });
  }

  function blankWork() {
    var sz = C.sizeFor(pix.w, pix.h);
    return { w: sz.w, h: sz.h, bg: prefs.bg, st: [] };
  }

  // Replaces the work on screen; the old one comes back with Undo
  // when it was unsaved and not empty.
  function replaceWork(next, toastKey) {
    if (replay) stopReplay();
    flush();
    var old = (!cur && work.st.length) ? work : null;
    cur = null; work = next; fading = [];
    undoStack = []; redoStack = [];
    pendingName = "";
    saveDraft();
    afterOpen();
    if (old && toastKey) {
      undoToast(t(toastKey), function () {
        if (replay) stopReplay();
        cur = null; work = old; undoStack = []; redoStack = [];
        saveDraft(); afterOpen();
      });
    }
  }
  function newWork() { replaceWork(blankWork(), "toast.newWork"); }

  function afterOpen() {
    prefs.bg = work.bg; savePrefsSoon();
    rebuild(); renderHead(); renderTools(); renderMine();
  }

  var pendingName = "";
  function renderHead() {
    $("title-view").textContent = t("app.name");
    $("title-sub").textContent = cur ? (cur.name + " · " + t("sub.saved")) : t("sub.new");
    var sb = $("save-btn");
    sb.textContent = cur ? t("btn.saved") : t("btn.save");
    sb.disabled = !!cur;
    sb.classList.toggle("done", !!cur);
    var ni = $("name-in");
    if (document.activeElement !== ni) ni.value = cur ? cur.name : pendingName;
    describe();
    renderMeter();
  }

  function renderMeter() {
    var n = C.pointCount(work.st), m = $("meter");
    m.textContent = n >= C.MAX_POINTS ? t("meter.full", { max: num(C.MAX_POINTS) })
                                      : t("meter", { n: num(n), max: num(C.MAX_POINTS) });
    m.classList.toggle("warn", n >= C.MAX_POINTS * 0.9);
  }

  function saveWork() {
    if (cur) return;
    if (!work.st.length) { showToast(t("toast.empty")); return; }
    if (data.works.length >= C.MAX_WORKS) { showToast(t("toast.mineFull", { n: C.MAX_WORKS })); return; }
    var name = C.cleanName($("name-in").value) || t("name.default", { n: data.works.length + 1 });
    var wk = { id: C.newId(Math.random), m: Date.now(), name: name, w: work.w, h: work.h, bg: work.bg, st: work.st.slice() };
    data = C.mergeWorks(data, { works: [wk], tombs: {} });
    save();
    cur = C.findWork(data, wk.id);
    if (cur) work = cur;
    pendingName = "";
    saveDraft();
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

  function openWork(wk, keepPanel) {
    if (!wk) return;
    if (replay) stopReplay();
    flush();
    var hadDraft = !cur && work.st.length ? work : null;
    cur = wk; work = wk; fading = [];
    undoStack = []; redoStack = [];
    pendingName = "";
    if (hadDraft) {                     // the unsaved draft stays on this device for later
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ w: hadDraft.w, h: hadDraft.h, bg: hadDraft.bg, st: hadDraft.st })); } catch (e) {}
    }
    afterOpen();
    if (!keepPanel) closePanelOnPhone();
  }

  // ---------- 6. Settings ----------
  function radioChips(host, values, curVal, label, onPick, aria) {
    host.innerHTML = "";
    values.forEach(function (v) {
      var on = v === curVal;
      var b = el("button", "chip" + (on ? " on" : ""), label(v));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", on ? "true" : "false");
      if (aria) b.setAttribute("aria-label", aria(v));
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

  function symLabel(v) {
    if (v === "none" || v === "mirror") return t("sym." + v);
    return t("sym.k", { n: v.slice(1) });
  }
  function symAria(v) {
    if (v === "none" || v === "mirror") return t("sym." + v);
    return t("sym.kText", { n: v.slice(1) });
  }

  function setBrush(v) { prefs.brush = v; savePrefs(); renderTools(); }
  function setSym(v) { prefs.sym = v; savePrefs(); renderTools(); }
  function setBg(v) {
    if (v === work.bg) return;
    prefs.bg = v; savePrefs();
    work.bg = v;
    rebuild();
    if (work.st.length) workChanged();
    renderTools();
  }

  function renderTools() {
    radioChips($("brushes"), C.BRUSHES, prefs.brush, function (v) { return t("brush." + v); }, setBrush,
      function (v) { return t("brush.key", { name: t("brush." + v), n: C.BRUSHES.indexOf(v) + 1 }); });
    radioChips($("syms"), C.SYMS, prefs.sym, symLabel, setSym, symAria);
    radioChips($("bgs"), C.BGS, work.bg, function (v) { return t("bg." + v); }, setBg);
    renderSwatches();
    ["size", "glow"].forEach(function (k) {
      var inp = $(k + "-in");
      if (String(inp.value) !== String(prefs[k])) inp.value = prefs[k];
      $(k + "-out").textContent = String(prefs[k]);
    });
    $("fade-in").checked = prefs.fade;
    $("undo-btn").disabled = !undoStack.length;
    $("redo-btn").disabled = !redoStack.length;
    $("clear-btn").disabled = !work.st.length && !fading.length;
    var empty = !work.st.length;
    $("png-btn").disabled = empty;
    $("replay-btn").disabled = empty;
    $("wall-btn").disabled = empty;
  }

  function renderPalettes() {
    var sel = $("pal-sel");
    sel.innerHTML = "";
    C.PALETTE_IDS.forEach(function (id) {
      var o = el("option", "", t("pal." + id));
      o.value = id;
      sel.appendChild(o);
    });
    sel.value = prefs.pal;
  }

  function renderSwatches() {
    var host = $("swatches"), cols = C.PALETTES[prefs.pal];
    var values = cols.slice();
    if (values.indexOf(prefs.colour) < 0) values.push(prefs.colour);   // a picked colour shows too
    values.push("rainbow");
    var curVal = prefs.rainbow ? "rainbow" : prefs.colour;
    host.innerHTML = "";
    values.forEach(function (v, i) {
      var on = v === curVal;
      var b = el("button", "swatch" + (on ? " on" : "") + (v === "rainbow" ? " rainbow" : ""));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      if (v !== "rainbow") b.style.background = v;
      setLabel(b, v === "rainbow" ? t("rainbow") : t("sw.colour", { n: i + 1 }) + " " + v);
      b.addEventListener("click", function () { pickColour(v); });
      host.appendChild(b);
    });
    host.onkeydown = function (e) {
      var d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0);
      if (!d) return;
      e.preventDefault();
      var i = values.indexOf(curVal), j = (i + d + values.length) % values.length;
      pickColour(values[j]);
      var nb = host.querySelectorAll('[role="radio"]')[j];
      if (nb) nb.focus();
    };
    $("pick-in").value = prefs.colour;
  }

  function pickColour(v) {
    if (v === "rainbow") prefs.rainbow = true;
    else { prefs.rainbow = false; prefs.colour = v; }
    savePrefs(); renderSwatches();
  }

  function renderTune() {
    var open = prefs.tune, b = $("tune-btn");
    $("tune").hidden = !open;
    b.setAttribute("aria-expanded", open ? "true" : "false");
    b.textContent = open ? t("tune.hide") : t("tune.show");
  }
  function toggleTune() { prefs.tune = !prefs.tune; savePrefs(); renderTune(); }

  // ---------- 7. My works ----------
  var mineTimer = null;
  function renderMineSoon() { clearTimeout(mineTimer); mineTimer = setTimeout(renderMine, 800); }

  var thumbJobs = [], thumbTimer = null, thumbCache = {};
  function thumb(node, wk) {
    var key = wk.id + ":" + wk.m + ":" + wk.bg;
    if (thumbCache[key]) { node.style.backgroundImage = 'url("' + thumbCache[key] + '")'; return; }
    thumbJobs.push({ node: node, wk: wk, key: key });
    if (!thumbTimer) thumbTimer = setTimeout(drainThumbs, 30);
  }
  function drainThumbs() {
    thumbTimer = null;
    var job = thumbJobs.shift();
    if (!job) return;
    if (job.node.isConnected) {
      if (!thumbCache[job.key]) {
        var cv = document.createElement("canvas");
        cv.width = 128; cv.height = 96;
        C.draw(cv.getContext("2d"), job.wk, 128, 96, { calm: true });
        var keys = Object.keys(thumbCache);
        if (keys.length > 120) delete thumbCache[keys[0]];
        thumbCache[job.key] = cv.toDataURL("image/png");
      }
      job.node.style.backgroundImage = 'url("' + thumbCache[job.key] + '")';
    }
    if (thumbJobs.length) thumbTimer = setTimeout(drainThumbs, 0);
  }

  function renderMine() {
    clearTimeout(mineTimer);
    var host = $("mine"), list = C.newestFirst(data.works);
    host.innerHTML = "";
    thumbJobs = [];
    $("mine-empty").hidden = list.length > 0;
    $("mine-count").textContent = list.length ? list.length + " / " + C.MAX_WORKS : "";
    list.forEach(function (wk) {
      var li = el("li", "row"), on = !!(cur && cur.id === wk.id);
      if (on) li.classList.add("on");
      var open = el("button", "row-open");
      open.type = "button";
      if (on) open.setAttribute("aria-current", "true");
      var th = el("span", "thumb");
      th.setAttribute("aria-hidden", "true");
      open.appendChild(th);
      var txt = el("span", "row-text");
      txt.appendChild(el("span", "row-name", wk.name));
      txt.appendChild(el("span", "row-sub", wk.st.length === 1 ? t("item.stroke1") : t("item.strokes", { n: wk.st.length })));
      open.appendChild(txt);
      setLabel(open, t("item.open") + ": " + wk.name);
      open.addEventListener("click", function () { openWork(C.findWork(data, wk.id)); });
      li.appendChild(open);
      var dup = el("button", "icon-btn");
      dup.type = "button"; dup.innerHTML = ICON.dup;
      setLabel(dup, t("item.dup") + ": " + wk.name);
      dup.addEventListener("click", function () { duplicate(wk.id); });
      li.appendChild(dup);
      var d = el("button", "icon-btn del-btn");
      d.type = "button"; d.innerHTML = ICON.del;
      setLabel(d, t("item.delete") + ": " + wk.name);
      d.addEventListener("click", function () { deleteWork(wk.id); });
      li.appendChild(d);
      host.appendChild(li);
      thumb(th, wk);
    });
  }

  function duplicate(id) {
    var wk = C.findWork(data, id);
    if (!wk) return;
    if (data.works.length >= C.MAX_WORKS) { showToast(t("toast.mineFull", { n: C.MAX_WORKS })); return; }
    flush();
    var copy = JSON.parse(JSON.stringify(wk));
    copy.id = C.newId(Math.random); copy.m = Date.now();
    data = C.mergeWorks(data, { works: [copy], tombs: {} });
    save();
    openWork(C.findWork(data, copy.id), true);
    showToast(t("toast.dup"));
  }

  function deleteWork(id) {
    var wk = C.findWork(data, id);
    if (!wk) return;
    flush();
    var snap = JSON.parse(JSON.stringify(wk)), tombs = {};
    tombs[id] = Math.max(Date.now(), wk.m);
    data = C.mergeWorks(data, { works: [], tombs: tombs });
    save();
    if (cur && cur.id === id) {          // the picture stays on the canvas, unsaved
      cur = null;
      work = { w: snap.w, h: snap.h, bg: snap.bg, st: snap.st.slice() };
      saveDraft();
      renderHead();
    }
    renderMine();
    undoToast(t("toast.deleted"), function () {
      snap.m = Math.max(Date.now(), (data.tombs[snap.id] || 0) + 1);   // R17
      data = C.mergeWorks(data, { works: [snap], tombs: {} });
      save();
      openWork(C.findWork(data, snap.id), true);
    });
  }

  // ---------- 8. Replay, surprise ----------
  function startReplay() {
    if (!work.st.length || replay) return;
    if (activeId !== null) return;
    var counts = work.st.map(function (s) { var p = C.decodePoints(s.p); return p ? p.length : 1; });
    var all = counts.reduce(function (a, b) { return a + b; }, 0);
    var dur = Math.max(2500, Math.min(14000, all * 6));
    var rb = document.createElement("canvas");
    rb.width = pix.w; rb.height = pix.h;
    var rctx = rb.getContext("2d");
    rctx.fillStyle = C.BG_COLOUR[work.bg];
    rctx.fillRect(0, 0, pix.w, pix.h);
    shade(rctx);
    replay = { t0: now(), dur: dur, counts: counts, all: all, done: 0, base: rb };
    $("stop-btn").hidden = false;
    document.body.classList.add("replaying");
    live(t("live.replay"));
    replayTick();
  }
  function replayTick() {
    if (!replay) return;
    paint();
    if (replay) frame = requestAnimationFrame(function () { frame = 0; replayTick(); });
  }
  function paintReplay(ctx) {
    var r = replay, shown = Math.floor(Math.min(1, (now() - r.t0) / r.dur) * r.all);
    var i = 0, acc = 0;
    while (i < r.counts.length && acc + r.counts[i] <= shown) { acc += r.counts[i]; i++; }
    var o = strokeOpts(), bctx = r.base.getContext("2d");
    while (r.done < i) {                         // finished strokes go on the replay base once
      var s = work.st[r.done];
      withMode(bctx, function () { C.drawStroke(bctx, s, o); });
      r.done++;
    }
    ctx.drawImage(r.base, 0, 0);
    if (i < work.st.length && shown - acc > 0) {
      var part = shown - acc;
      o.upto = part;
      withMode(ctx, function () { C.drawStroke(ctx, work.st[i], o); });
    }
    if (shown >= r.all) { stopReplay(true); }
  }
  function stopReplay(finished) {
    if (!replay) return;
    replay = null;
    cancelAnimationFrame(frame); frame = 0;
    $("stop-btn").hidden = true;
    document.body.classList.remove("replaying");
    paint();
    if (finished) live(t("live.replayDone"));
  }

  function surpriseWork() {
    var w = C.surprise(Math.random, pix.w, pix.h);
    replaceWork({ w: w.w, h: w.h, bg: w.bg, st: w.st }, "toast.newWork");
    renderTools();
    live(t("toast.surprise"));
    startReplay();
  }

  // ---------- 9. PNG, wallpaper ----------
  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
  }
  function nameNow() { return cur ? cur.name : (C.cleanName($("name-in").value) || t("app.name")); }

  function saveBlob(blob, name, mime, ext) {
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      var acc = {}; acc[mime] = ["." + ext];
      dlg.saveFile({ blob: blob, filename: name, mime: mime, types: [{ description: ext.toUpperCase(), accept: acc }] })
        .then(function (r) { if (r && r.ok) showToast(t("toast.file")); });
      return;
    }
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    showToast(t("toast.file"));
  }

  // Picture size: the work's shape, long side = the screen's (× scale).
  function pngSize(scale) {
    var long = Math.min(MAX_PNG, Math.round(Math.max(pix.w, pix.h) * scale));
    var k = long / Math.max(work.w, work.h);
    return { w: Math.max(1, Math.round(work.w * k)), h: Math.max(1, Math.round(work.h * k)) };
  }
  function renderBlob(w, h, cb) {
    var cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    var ctx = cv.getContext("2d");
    if (!ctx) { cb(null); return; }
    C.draw(ctx, work, w, h, {});
    if (cv.toBlob) cv.toBlob(function (b) { cv.width = cv.height = 0; cb(b); }, "image/png");
    else cb(null);
  }
  function downloadPng() {
    if (!work.st.length) return;
    var sz = pngSize(prefs.scale);
    renderBlob(sz.w, sz.h, function (blob) {
      if (blob) saveBlob(blob, C.fileName(nameNow(), "png"), "image/png", "png");
    });
  }
  function renderScales() {
    var sel = $("scale-sel");
    sel.innerHTML = "";
    [1, 2].forEach(function (k) {
      var sz = pngSize(k);
      var o = el("option", "", t("scale." + k, { w: sz.w, h: sz.h }));
      o.value = String(k);
      sel.appendChild(o);
    });
    sel.value = String(prefs.scale);
  }

  function wallApi() {
    try {
      var w = window.parent && window.parent !== window && window.parent.orosWallpaper;
      return (w && typeof w.setImage === "function") ? w : null;
    } catch (e) { return null; }
  }
  function setWallpaper() {
    var api = wallApi();
    if (!api || !work.st.length) return;
    var p = window.parent, dpr = p.devicePixelRatio || 1;
    var w = Math.round(p.innerWidth * dpr), h = Math.round(p.innerHeight * dpr);
    var k = Math.min(1, 3840 / Math.max(w, h));
    w = Math.max(64, Math.round(w * k)); h = Math.max(64, Math.round(h * k));
    renderBlob(w, h, function (blob) {
      if (!blob) { showToast(t("toast.wallFail")); return; }
      var job;
      try { job = api.setImage(blob, { bg: C.BG_COLOUR[work.bg] }); } catch (e) { job = null; }
      Promise.resolve(job).then(function (ok) {
        showToast(t(ok ? "toast.wall" : "toast.wallFail"));
      });
    });
  }

  // ---------- 10. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "aura", title: String(text) })) return;
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

  // ---------- 11. Keyboard + panel ----------
  function typing(e) {
    var tg = e.target, tag = tg && tg.tagName;
    return tag === "INPUT" && tg.type !== "range" && tg.type !== "checkbox" && tg.type !== "color" ||
           tag === "TEXTAREA" || tag === "SELECT";
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
      if (e.key === "Escape") {
        if (replay) { e.preventDefault(); stopReplay(); return; }
        if (document.body.classList.contains("panel-open")) { e.preventDefault(); setPanel(false); $("list-btn").focus(); return; }
      }
      if (typing(e) || e.altKey) return;
      var k = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
        else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
        return;
      }
      var bi = "12345".indexOf(e.key);
      if (bi >= 0) { e.preventDefault(); setBrush(C.BRUSHES[bi]); return; }
      if (k === "s") {
        e.preventDefault();
        setSym(C.SYMS[(C.SYMS.indexOf(prefs.sym) + 1) % C.SYMS.length]);
        live(symAria(prefs.sym));
        return;
      }
      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        prefs.size = Math.max(1, Math.min(100, prefs.size + (e.key === "]" ? 5 : -5)));
        savePrefsSoon(); renderTools();
      }
    });
    $("name-in").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); if (!cur) saveWork(); else $("name-in").blur(); }
    });
  }

  // My works: a drawer over the canvas, on every screen.
  function setPanel(open) {
    document.body.classList.toggle("panel-open", open);
    $("list-btn").setAttribute("aria-expanded", open ? "true" : "false");
    $("scrim").hidden = !open;
  }
  function togglePanel() {
    var open = !document.body.classList.contains("panel-open");
    setPanel(open);
    if (open) { var first = $("panel").querySelector(".row-open, button"); if (first) first.focus(); }
  }
  function closePanelOnPhone() { if (document.body.classList.contains("panel-open")) setPanel(false); }

  // ---------- 12. Sync slice + palette + deep link ----------
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
    api.registerSlice("aura", sliceGet, sliceSet, STORAGE_KEY, C.mergeWorks);
  }

  function sliceGet() { if (saveTimer) save(); return C.mergeWorks(data, data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.works)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.mergeWorks(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;   // no toast on merge
    if (cur) {
      var fresh = C.findWork(data, cur.id);
      if (!fresh) {                                 // deleted on another device: the picture stays, unsaved
        work = { w: cur.w, h: cur.h, bg: cur.bg, st: cur.st.slice() };
        cur = null;
        saveDraft();
      } else if (fresh !== cur) {
        var changed = JSON.stringify(fresh.st) !== JSON.stringify(cur.st) || fresh.bg !== cur.bg;
        cur = fresh;
        if (activeId === null && !replay) {
          work = fresh;
          if (changed) { undoStack = []; redoStack = []; rebuild(); }
        } else work = fresh;
      }
    }
    renderHead(); renderTools(); renderMine();
  }

  // Deep link: { id } opens a saved work, { surprise: true } a random one.
  function openTarget(target) {
    if (!target || typeof target !== "object") return;
    if (target.surprise) { surpriseWork(); return; }
    if (typeof target.id === "string") openWork(C.findWork(data, target.id));
  }
  window.__orosOpenAt = function (target) { openTarget(target); };

  // ---------- 13. Wiring & boot ----------
  var ICON = {
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 15c2-4 4-6 6-3s3 1 4-2"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
    redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/></svg>',
    clear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z"/></svg>',
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
    $("undo-btn").innerHTML = ICON.undo; setLabel($("undo-btn"), t("btn.undo"));
    $("redo-btn").innerHTML = ICON.redo; setLabel($("redo-btn"), t("btn.redo"));
    $("clear-btn").innerHTML = ICON.clear; setLabel($("clear-btn"), t("btn.clear"));
    $("surprise-btn").innerHTML = ICON.spark; setLabel($("surprise-btn"), t("btn.surprise"));
    $("close-panel").innerHTML = ICON.del; setLabel($("close-panel"), t("btn.closePanel"));
    $("new-btn").insertAdjacentHTML("afterbegin", ICON.plus);
    $("stop-btn").textContent = t("btn.stop");
    $("name-in").placeholder = t("f.name.ph");
  }

  function wire() {
    var cv = $("cv");
    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointercancel", onUp);
    cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    ["size", "glow"].forEach(function (k) {
      $(k + "-in").addEventListener("input", function () {
        var v = parseInt($(k + "-in").value, 10);
        if (!isFinite(v)) return;
        prefs[k] = v; savePrefsSoon();
        $(k + "-out").textContent = String(v);
      });
    });
    $("pal-sel").addEventListener("change", function () {
      prefs.pal = C.PALETTE_IDS.indexOf($("pal-sel").value) >= 0 ? $("pal-sel").value : "aurora";
      if (!prefs.rainbow) prefs.colour = C.PALETTES[prefs.pal][0];
      savePrefs(); renderSwatches();
    });
    $("pick-in").addEventListener("input", function () {
      var v = C.normColour($("pick-in").value);
      if (v && v.charAt(0) === "#") { prefs.rainbow = false; prefs.colour = v; savePrefsSoon(); renderSwatches(); }
    });
    $("fade-in").addEventListener("change", function () {
      prefs.fade = $("fade-in").checked; savePrefs();
      if (!prefs.fade) { fading = []; paint(); }
      renderTools();
    });
    $("name-in").addEventListener("input", onName);
    $("tune-btn").addEventListener("click", toggleTune);
    $("list-btn").addEventListener("click", togglePanel);
    $("close-panel").addEventListener("click", function () { setPanel(false); $("list-btn").focus(); });
    $("scrim").addEventListener("click", function () { setPanel(false); });
    $("save-btn").addEventListener("click", saveWork);
    $("new-btn").addEventListener("click", newWork);
    $("undo-btn").addEventListener("click", undo);
    $("redo-btn").addEventListener("click", redo);
    $("clear-btn").addEventListener("click", clearCanvas);
    $("surprise-btn").addEventListener("click", surpriseWork);
    $("png-btn").addEventListener("click", downloadPng);
    $("replay-btn").addEventListener("click", startReplay);
    $("stop-btn").addEventListener("click", function () { stopReplay(); });
    $("wall-btn").addEventListener("click", setWallpaper);
    $("scale-sel").addEventListener("change", function () {
      prefs.scale = $("scale-sel").value === "2" ? 2 : 1; savePrefs();
    });
    $("scale-sel").addEventListener("focus", renderScales);
    var rz = null;
    window.addEventListener("resize", function () {
      clearTimeout(rz);
      rz = setTimeout(function () { if (replay) stopReplay(); resizeCanvas(); renderScales(); }, 120);
    });
    window.addEventListener("pagehide", function () { flush(); savePrefs(); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { flush(); savePrefs(); }
    });
    wireKeyboard();
  }

  function boot() {
    load();
    loadPrefs();
    applyI18n();
    inheritPalette();
    work = loadDraft() || { w: C.LONG, h: Math.round(C.LONG * 0.6), bg: prefs.bg, st: [] };
    wire();
    registerSync();
    watchPalette();
    setPanel(false);
    $("wall-btn").hidden = !wallApi();   // standalone: no desktop (R28)
    renderPalettes();
    renderTune();
    resizeCanvas();
    renderScales();
    renderTools();
    renderHead();
    renderMine();
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === "function") {
        var pending = window.parent.__orosTakeTarget("aura");
        if (pending) openTarget(pending);
      }
    } catch (e) {}
  }

  boot();
})();
