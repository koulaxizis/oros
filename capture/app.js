// ============================================================
// orOS Screen Capture — the app inside the shell frame
// Flow: choose a source (getDisplayMedia: screen, window or tab)
// → live view → take a picture, after an optional delay → crop →
// save as PNG to Files › Pictures (optionally open it in Photo
// Lab) or copy it. The shared source stays open until the person
// stops it, so several pictures need one choice.
// Rules that apply to every orOS app:
//   - R8: this frame has no shell globals; read every shell API
//     from window.parent, guarded, so ?standalone still works;
//   - nothing leaves the device: no network, the picture goes to
//     the orOS disk (or a download with ?standalone);
//   - text goes in with textContent, never innerHTML.
// ============================================================
(function () {
  "use strict";

  var SCRIPT_V = "";
  (function () {
    var m = (document.currentScript && document.currentScript.src || "").match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    console.log("capture/app.js v" + (SCRIPT_V || "?") + " boot");
  })();

  var PREFS_KEY = "oros-capture-prefs";
  var C = window.CaptureCore;

  // ---------- 1. Language (every string in English and Greek) ----------
  var STR = {
    en: {
      "app.name":      "Screen Capture",
      "idle.lead":     "Take a picture of your screen, a window or a browser tab.",
      "idle.hint":     "Your browser asks what to share. Nothing leaves this device: the picture is saved in Files › Pictures.",
      "opt.delay":     "Delay",
      "opt.none":      "None",
      "opt.sec":       "{n} s",
      "opt.cursor":    "Show the mouse pointer",
      "opt.edit":      "Open in Photo Lab after saving",
      "btn.start":     "Choose what to capture",
      "btn.take":      "Take screenshot",
      "btn.stop":      "Stop sharing",
      "btn.save":      "Save to Pictures",
      "btn.copy":      "Copy",
      "btn.uncrop":    "Whole picture",
      "btn.again":     "Take another",
      "btn.new":       "Choose again",
      "btn.drop":      "Discard",
      "live.hint":     "You can take as many pictures as you like while sharing.",
      "shot.hint":     "Drag on the picture to keep only part of it.",
      "size":          "{w} × {h} pixels",
      "file.base":     "Screenshot",
      "toast.saved":   "Saved in Files › Pictures as {name}",
      "toast.copied":  "Copied. Paste it in another app.",
      "toast.ended":   "Sharing stopped.",
      "err.unsupported": "This browser cannot capture the screen. Phones and tablets do not offer it; use orOS on a computer (Chrome, Edge or Firefox).",
      "err.denied":    "Sharing was not allowed, so there is nothing to capture.",
      "err.fail":      "The screen could not be captured. Try again.",
      "err.empty":     "The shared source sent no picture yet. Wait a moment and try again.",
      "err.save":      "The picture could not be saved. Is the device out of space?",
      "err.copy":      "This browser cannot copy pictures. Save it instead.",
      "err.full":      "This device is out of storage space. The option was not saved."
    },
    el: {
      "app.name":      "Λήψη οθόνης",
      "idle.lead":     "Τράβηξε μια εικόνα της οθόνης σου, ενός παραθύρου ή μιας καρτέλας του browser.",
      "idle.hint":     "Ο browser σε ρωτά τι θα μοιραστείς. Τίποτα δεν φεύγει από τη συσκευή: η εικόνα αποθηκεύεται στα Αρχεία › Pictures.",
      "opt.delay":     "Καθυστέρηση",
      "opt.none":      "Καμία",
      "opt.sec":       "{n} δ",
      "opt.cursor":    "Να φαίνεται ο δείκτης του ποντικιού",
      "opt.edit":      "Άνοιγμα στο Εργαστήριο εικόνας μετά την αποθήκευση",
      "btn.start":     "Διάλεξε τι θα τραβήξεις",
      "btn.take":      "Λήψη",
      "btn.stop":      "Τέλος κοινής χρήσης",
      "btn.save":      "Αποθήκευση στα Pictures",
      "btn.copy":      "Αντιγραφή",
      "btn.uncrop":    "Όλη η εικόνα",
      "btn.again":     "Άλλη λήψη",
      "btn.new":       "Νέα επιλογή",
      "btn.drop":      "Απόρριψη",
      "live.hint":     "Όσο μοιράζεσαι, μπορείς να τραβήξεις όσες εικόνες θέλεις.",
      "shot.hint":     "Σύρε πάνω στην εικόνα για να κρατήσεις μόνο ένα κομμάτι της.",
      "size":          "{w} × {h} pixel",
      "file.base":     "Στιγμιότυπο",
      "toast.saved":   "Αποθηκεύτηκε στα Αρχεία › Pictures ως {name}",
      "toast.copied":  "Αντιγράφηκε. Επικόλλησέ το σε άλλη εφαρμογή.",
      "toast.ended":   "Η κοινή χρήση σταμάτησε.",
      "err.unsupported": "Αυτός ο browser δεν μπορεί να τραβήξει την οθόνη. Τα κινητά και τα tablet δεν το προσφέρουν· χρησιμοποίησε το orOS σε υπολογιστή (Chrome, Edge ή Firefox).",
      "err.denied":    "Η κοινή χρήση δεν επιτράπηκε, οπότε δεν υπάρχει τι να τραβήξω.",
      "err.fail":      "Η οθόνη δεν τραβήχτηκε. Δοκίμασε ξανά.",
      "err.empty":     "Η πηγή δεν έστειλε ακόμα εικόνα. Περίμενε λίγο και δοκίμασε ξανά.",
      "err.save":      "Η εικόνα δεν αποθηκεύτηκε. Μήπως γέμισε ο χώρος της συσκευής;",
      "err.copy":      "Αυτός ο browser δεν αντιγράφει εικόνες. Αποθήκευσέ την καλύτερα.",
      "err.full":      "Ο χώρος αποθήκευσης της συσκευής γέμισε. Η επιλογή δεν αποθηκεύτηκε."
    }
  };

  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  // orosI18n (../i18n.js): the full language code, a pack language included.
  var LANG = window.orosI18n ? window.orosI18n.lang() : appLang();
  if (window.orosI18n) window.orosI18n.table(STR, "capture", LANG);
  function t(k, vars) {
    var s = (STR[LANG] || STR.en)[k] || STR.en[k] || k;
    if (vars) s = s.replace(/\{(\w+)\}/g, function (m, n) { return vars[n] !== undefined ? String(vars[n]) : m; });
    return s;
  }

  function applyI18n() {
    document.documentElement.lang = LANG;
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    document.title = t("app.name") + " · orOS";
  }

  // ---------- 2. Options (this device only, no sync) ----------
  var prefs = C.prefs(null);
  function loadPrefs() {
    try { prefs = C.prefs(JSON.parse(localStorage.getItem(PREFS_KEY) || "null")); }
    catch (e) { prefs = C.prefs(null); }
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }
    catch (e) { toast(t("err.full")); }
  }

  function fsApi() {
    try { return (window.parent && window.parent.orosFS) || window.orosFS || null; }
    catch (e) { return window.orosFS || null; }
  }
  function openAt(app, target) {
    try {
      var p = window.parent;
      if (p && p !== window && typeof p.__orosOpenAt === "function") { p.__orosOpenAt(app, target); return true; }
    } catch (e) {}
    return false;
  }

  // ---------- 3. Palette: follow the shell's theme and skin (G3) ----------
  var PAL_VARS = ["--bg", "--text", "--text-dim", "--accent", "--accent-hover",
                  "--accent-soft", "--panel-bg", "--border", "--danger"];
  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme", pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }
  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] });
    } catch (e) { /* standalone */ }
  }

  // ---------- 4. Screen ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  var toastTimer = 0;
  function toast(msg) {
    var box = $("toast");
    box.textContent = msg;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, 3500);
  }

  function show(view) {
    ["idle", "live", "shot"].forEach(function (v) { $("v-" + v).hidden = v !== view; });
  }

  function supported() {
    return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function");
  }

  function renderOptions() {
    var box = $("delay");
    box.textContent = "";
    C.DELAYS.forEach(function (n) {
      var b = el("button", "chip" + (prefs.delay === n ? " on" : ""), n ? t("opt.sec", { n: n }) : t("opt.none"));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", prefs.delay === n ? "true" : "false");
      b.addEventListener("click", function () { prefs.delay = n; savePrefs(); renderOptions(); });
      box.appendChild(b);
    });
    $("opt-cursor").checked = prefs.cursor;
    $("opt-edit").checked = prefs.edit;
    var ok = supported();
    $("b-start").disabled = !ok;
    $("unsupported").hidden = ok;
  }

  // ---------- 5. Sharing ----------
  var stream = null;
  var counting = 0;          // countdown timer id

  function stopStream() {
    clearInterval(counting);
    counting = 0;
    $("count").textContent = "";
    if (stream) stream.getTracks().forEach(function (tr) { try { tr.stop(); } catch (e) {} });
    stream = null;
    $("live").srcObject = null;
    $("b-again").textContent = t("btn.new");
  }

  function start() {
    if (!supported()) { renderOptions(); return; }
    var opts = {
      video: { cursor: prefs.cursor ? "always" : "never" },
      audio: false,
      selfBrowserSurface: "include",   // orOS itself is a fine thing to capture
      surfaceSwitching: "include"
    };
    navigator.mediaDevices.getDisplayMedia(opts).then(function (s) {
      stopStream();
      stream = s;
      var tr = s.getVideoTracks()[0];
      if (tr) tr.addEventListener("ended", function () {
        if (stream !== s) return;
        stopStream();
        if (!$("v-live").hidden) { show("idle"); toast(t("toast.ended")); }
      });
      var v = $("live");
      v.srcObject = s;
      try { v.play().catch(function () {}); } catch (e) {}
      $("b-again").textContent = t("btn.again");
      show("live");
      $("b-take").focus();
    }, function (e) {
      toast(e && e.name === "NotAllowedError" ? t("err.denied") : t("err.fail"));
    });
  }

  function take() {
    if (!stream || counting) return;
    var left = prefs.delay;
    if (!left) { grab(); return; }
    $("b-take").disabled = true;
    $("count").textContent = String(left);
    counting = setInterval(function () {
      left--;
      if (left > 0) { $("count").textContent = String(left); return; }
      clearInterval(counting);
      counting = 0;
      $("count").textContent = "";
      $("b-take").disabled = false;
      grab();
    }, 1000);
  }

  // Wait for a frame drawn after the countdown left the screen (orOS
  // itself may be the shared tab), then copy it to the canvas.
  function freshFrame(v, cb) {
    var done = false;
    function go() { if (!done) { done = true; cb(); } }
    if (typeof v.requestVideoFrameCallback === "function") {
      requestAnimationFrame(function () { requestAnimationFrame(function () { v.requestVideoFrameCallback(go); }); });
      setTimeout(go, 400);          // a still source sends no new frame
    } else {
      setTimeout(go, 200);
    }
  }

  var shot = { canvas: null, crop: null };

  function grab() {
    var v = $("live");
    freshFrame(v, function () {
      var w = v.videoWidth, h = v.videoHeight;
      if (!w || !h) { toast(t("err.empty")); return; }
      var cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      try { cv.getContext("2d").drawImage(v, 0, 0, w, h); }
      catch (e) { toast(t("err.fail")); return; }
      shot.canvas = cv;
      shot.crop = null;
      var view = $("shot");
      view.width = w; view.height = h;
      view.getContext("2d").drawImage(cv, 0, 0);
      paintCrop();
      show("shot");
      $("b-save").focus();
    });
  }

  // ---------- 6. Crop ----------
  var drag = null;

  function paintCrop() {
    var sel = $("sel"), r = shot.crop, cv = shot.canvas;
    var st = cv ? C.rectStyle(r, cv.width, cv.height) : null;
    sel.hidden = !st;
    if (st) {
      sel.style.left = st.left + "%"; sel.style.top = st.top + "%";
      sel.style.width = st.width + "%"; sel.style.height = st.height + "%";
    }
    $("b-uncrop").hidden = !r;
    var w = r ? r.w : (cv ? cv.width : 0), h = r ? r.h : (cv ? cv.height : 0);
    $("size").textContent = t("size", { w: w, h: h });
  }

  function pointAt(ev) {
    var b = $("shot").getBoundingClientRect();
    return { x: ev.clientX - b.left, y: ev.clientY - b.top, w: b.width, h: b.height };
  }

  function wireCrop() {
    var box = $("crop-box");
    box.addEventListener("pointerdown", function (ev) {
      if (!shot.canvas || ev.button > 0) return;
      ev.preventDefault();
      try { box.setPointerCapture(ev.pointerId); } catch (e) {}
      drag = pointAt(ev);
    });
    box.addEventListener("pointermove", function (ev) {
      if (!drag) return;
      var p = pointAt(ev);
      shot.crop = C.cropRect(drag.x, drag.y, p.x, p.y, p.w, p.h, shot.canvas.width, shot.canvas.height);
      paintCrop();
    });
    function end() { drag = null; }
    box.addEventListener("pointerup", end);
    box.addEventListener("pointercancel", end);
  }

  // The picture to keep: the crop, or all of it.
  function finalCanvas() {
    var cv = shot.canvas, r = shot.crop;
    if (!r) return cv;
    var out = document.createElement("canvas");
    out.width = r.w; out.height = r.h;
    out.getContext("2d").drawImage(cv, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    return out;
  }

  function pngOf(cb) {
    finalCanvas().toBlob(function (b) { cb(b); }, "image/png");
  }

  // ---------- 7. Save and copy ----------
  function save() {
    if (!shot.canvas) return;
    var name = C.fileName(t("file.base"), new Date(), "png");
    pngOf(function (png) {
      if (!png) { toast(t("err.save")); return; }
      var F = fsApi();
      if (!F) { download(png, name); return; }
      var n = 1;
      (function tryName() {
        var path = C.pathFor(name, n);
        F.stat(path).then(function () { n++; if (n < 100) tryName(); else toast(t("err.save")); }, function () {
          F.write(path, png).then(function () {
            toast(t("toast.saved", { name: path.slice(C.FOLDER.length) }));
            if (prefs.edit) openAt("photolab", { openFile: path });
          }, function () { toast(t("err.save")); });
        });
      })();
    });
  }

  function download(blob, name) {
    var dlg = null;
    try { dlg = window.parent && window.parent.orosDialog; } catch (e) {}
    if (dlg && typeof dlg.saveFile === "function") { dlg.saveFile({ blob: blob, filename: name }); return; }
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 40000);
  }

  function copy() {
    if (!shot.canvas) return;
    if (!(navigator.clipboard && typeof navigator.clipboard.write === "function" && window.ClipboardItem)) {
      toast(t("err.copy")); return;
    }
    // The ClipboardItem takes a promise, so Safari keeps the click as
    // the user gesture while the PNG is encoded.
    var png = new Promise(function (resolve, reject) { pngOf(function (b) { b ? resolve(b) : reject(new Error("png")); }); });
    navigator.clipboard.write([new ClipboardItem({ "image/png": png })])
      .then(function () { toast(t("toast.copied")); }, function () { toast(t("err.copy")); });
  }

  function again() {
    shot.canvas = null;
    shot.crop = null;
    if (stream) { show("live"); $("b-take").focus(); }
    else start();
  }

  function discard() {
    shot.canvas = null;
    shot.crop = null;
    show(stream ? "live" : "idle");
  }

  function wire() {
    $("b-start").addEventListener("click", start);
    $("b-take").addEventListener("click", take);
    $("b-stop").addEventListener("click", function () { stopStream(); show("idle"); });
    $("b-save").addEventListener("click", save);
    $("b-copy").addEventListener("click", copy);
    $("b-uncrop").addEventListener("click", function () { shot.crop = null; paintCrop(); });
    $("b-again").addEventListener("click", again);
    $("b-drop").addEventListener("click", discard);
    $("opt-cursor").addEventListener("change", function () { prefs.cursor = this.checked; savePrefs(); });
    $("opt-edit").addEventListener("change", function () { prefs.edit = this.checked; savePrefs(); });
    wireCrop();
    window.addEventListener("pagehide", stopStream);

    // Contract Β: Ctrl+Alt+Shift belongs to the shell.
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null; try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
  }

  // ---------- 8. Boot (last, after every declaration) ----------
  function boot() {
    loadPrefs();
    applyI18n();
    wire();
    inheritPalette();
    watchPalette();
    renderOptions();
    show("idle");
  }
  boot();
})();
