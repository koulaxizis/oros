// ============================================================
// orOS Screen Capture — the app inside the shell frame
// Flow: choose a source (getDisplayMedia: screen, window or tab)
// → live view → take a picture, after an optional delay → crop →
// save as PNG to Files › Pictures (optionally open it in Photo
// Lab) or copy it. The shared source stays open until the person
// stops it, so several pictures need one choice.
// Recording (wave 2): the same live view records with MediaRecorder
// (MP4 where the browser writes it, else WebM), with the shared
// source's sound and/or the microphone mixed in, pause and resume,
// up to MAX_BYTES held in memory → Files › Videos (optionally
// opened in Montage).
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
      "err.full":      "This device is out of storage space. The option was not saved.",
      "mode.label":    "What to make",
      "mode.shot":     "Screenshot",
      "mode.rec":      "Recording",
      "idle.leadRec":  "Record your screen, a window or a browser tab as a video.",
      "idle.hintRec":  "Your browser asks what to share. Nothing leaves this device: the video is saved in Files › Videos.",
      "opt.sys":       "Record the sound of the screen or tab",
      "opt.mic":       "Record the microphone",
      "opt.montage":   "Open in Montage after saving",
      "btn.rec":       "Start recording",
      "btn.pause":     "Pause",
      "btn.resume":    "Resume",
      "btn.end":       "Stop recording",
      "btn.rsave":     "Save to Videos",
      "btn.ragain":    "Record another",
      "live.hintRec":  "You can also take screenshots while you record.",
      "rec.paused":    "Paused",
      "clip.info":     "{time} · {size}",
      "file.rec":      "Screen recording",
      "toast.rsaved":  "Saved in Files › Videos as {name}",
      "toast.limit":   "The recording reached 1 GB and stopped.",
      "err.rec":       "This browser cannot record video.",
      "err.mic":       "The microphone was not allowed, so the recording has no microphone sound.",
      "err.nosys":     "The shared source sends no sound. In Chrome and Edge, a tab or the whole screen can share sound, a window cannot."
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
      "err.full":      "Ο χώρος αποθήκευσης της συσκευής γέμισε. Η επιλογή δεν αποθηκεύτηκε.",
      "mode.label":    "Τι θα κάνεις",
      "mode.shot":     "Στιγμιότυπο",
      "mode.rec":      "Εγγραφή",
      "idle.leadRec":  "Γράψε σε βίντεο την οθόνη σου, ένα παράθυρο ή μια καρτέλα του browser.",
      "idle.hintRec":  "Ο browser σε ρωτά τι θα μοιραστείς. Τίποτα δεν φεύγει από τη συσκευή: το βίντεο αποθηκεύεται στα Αρχεία › Videos.",
      "opt.sys":       "Εγγραφή του ήχου της οθόνης ή της καρτέλας",
      "opt.mic":       "Εγγραφή του μικροφώνου",
      "opt.montage":   "Άνοιγμα στο Μοντάζ μετά την αποθήκευση",
      "btn.rec":       "Έναρξη εγγραφής",
      "btn.pause":     "Παύση",
      "btn.resume":    "Συνέχεια",
      "btn.end":       "Τέλος εγγραφής",
      "btn.rsave":     "Αποθήκευση στα Videos",
      "btn.ragain":    "Νέα εγγραφή",
      "live.hintRec":  "Όσο γράφεις, μπορείς να τραβάς και στιγμιότυπα.",
      "rec.paused":    "Σε παύση",
      "clip.info":     "{time} · {size}",
      "file.rec":      "Εγγραφή οθόνης",
      "toast.rsaved":  "Αποθηκεύτηκε στα Αρχεία › Videos ως {name}",
      "toast.limit":   "Η εγγραφή έφτασε το 1 GB και σταμάτησε.",
      "err.rec":       "Αυτός ο browser δεν μπορεί να γράψει βίντεο.",
      "err.mic":       "Το μικρόφωνο δεν επιτράπηκε, οπότε η εγγραφή δεν έχει τον ήχο του.",
      "err.nosys":     "Η πηγή που μοιράζεσαι δεν στέλνει ήχο. Σε Chrome και Edge ήχο μοιράζονται μια καρτέλα ή όλη η οθόνη, όχι ένα παράθυρο."
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
    $("mode").setAttribute("aria-label", t("mode.label"));
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
    ["idle", "live", "shot", "rec"].forEach(function (v) { $("v-" + v).hidden = v !== view; });
    if (view === "live") renderLive();
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
    $("opt-sys").checked = prefs.sys;
    $("opt-mic").checked = prefs.mic;
    $("opt-montage").checked = prefs.montage;
    var recMode = prefs.mode === "rec";
    [].forEach.call($("mode").children, function (b) {
      var on = b.getAttribute("data-mode") === prefs.mode;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
    [].forEach.call(document.querySelectorAll(".rec-only"), function (n) { n.hidden = !recMode; });
    $("row-edit").hidden = recMode;
    $("idle-lead").textContent = t(recMode ? "idle.leadRec" : "idle.lead");
    $("idle-hint").textContent = t(recMode ? "idle.hintRec" : "idle.hint");
    var ok = supported() && (!recMode || canRecord());
    $("b-start").disabled = !ok;
    $("unsupported").hidden = ok;
    $("unsupported").textContent = t(supported() ? "err.rec" : "err.unsupported");
  }

  // The live view's buttons follow the mode and the recorder.
  function renderLive() {
    var recMode = prefs.mode === "rec", on = !!rec;
    $("b-rec").hidden = !recMode || on;
    $("b-pause").hidden = !on;
    $("b-end").hidden = !on;
    $("b-pause").textContent = t(on && rec.mr.state === "paused" ? "btn.resume" : "btn.pause");
    $("b-take").className = recMode ? "chip" : "chip pri big";
    $("rec-status").hidden = !on;
    $("live-hint").textContent = t(recMode ? "live.hintRec" : "live.hint");
  }

  // ---------- 5. Sharing ----------
  var stream = null;
  var counting = 0;          // countdown timer id

  function stopStream() {
    clearInterval(counting);
    counting = 0;
    $("count").textContent = "";
    if (rec) endRec();
    if (stream) stream.getTracks().forEach(function (tr) { try { tr.stop(); } catch (e) {} });
    stream = null;
    $("live").srcObject = null;
    $("b-again").textContent = t("btn.new");
  }

  function start() {
    if (!supported()) { renderOptions(); return; }
    var wantSound = prefs.mode === "rec" && prefs.sys;
    var opts = {
      video: { cursor: prefs.cursor ? "always" : "never" },
      audio: wantSound,
      selfBrowserSurface: "include",   // orOS itself is a fine thing to capture
      surfaceSwitching: "include"
    };
    if (wantSound) opts.systemAudio = "include";
    navigator.mediaDevices.getDisplayMedia(opts).then(function (s) {
      stopStream();
      stream = s;
      var tr = s.getVideoTracks()[0];
      if (tr) tr.addEventListener("ended", function () {
        if (stream !== s) return;
        var live = !$("v-live").hidden && !rec;
        stopStream();
        if (live) { show("idle"); toast(t("toast.ended")); }
      });
      var v = $("live");
      v.srcObject = s;
      try { v.play().catch(function () {}); } catch (e) {}
      $("b-again").textContent = t("btn.again");
      show("live");
      $(prefs.mode === "rec" ? "b-rec" : "b-take").focus();
    }, function (e) {
      toast(e && e.name === "NotAllowedError" ? t("err.denied") : t("err.fail"));
    });
  }

  // The delay, shown big on the live view, then cb().
  function countdown(cb) {
    var left = prefs.delay;
    if (!left) { cb(); return; }
    $("b-take").disabled = true;
    $("b-rec").disabled = true;
    $("count").textContent = String(left);
    counting = setInterval(function () {
      left--;
      if (left > 0) { $("count").textContent = String(left); return; }
      clearInterval(counting);
      counting = 0;
      $("count").textContent = "";
      $("b-take").disabled = false;
      $("b-rec").disabled = false;
      cb();
    }, 1000);
  }

  function take() {
    if (!stream || counting) return;
    // While recording, a picture comes at once: the delay was for the start.
    if (rec) grab(); else countdown(grab);
  }

  // ---------- 6. Recording ----------
  var rec = null;      // { mr, chunks, bytes, type, at, paused, pausedAt, extra[], ctx, tick }
  var clip = null;     // { blob, type, at, ms, url }

  function canRecord() {
    return !!(window.MediaRecorder && C.recType(function (x) {
      return typeof MediaRecorder.isTypeSupported !== "function" || MediaRecorder.isTypeSupported(x);
    }) !== null);
  }

  function micStream() {
    if (!prefs.mic) return Promise.resolve(null);
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then(null, function () { toast(t("err.mic")); return null; });
  }

  // One video track plus one sound track: a single source as it is,
  // the screen's sound and the microphone mixed in an AudioContext.
  function recStream(mic) {
    var video = stream.getVideoTracks()[0];
    var sources = [];
    if (prefs.sys) {
      var sys = stream.getAudioTracks();
      if (sys.length) sources.push(new MediaStream([sys[0]]));
      else toast(t("err.nosys"));
    }
    if (mic) sources.push(mic);
    if (sources.length < 2) {
      var one = sources[0] ? sources[0].getAudioTracks()[0] : null;
      return { stream: new MediaStream(one ? [video, one] : [video]), ctx: null };
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = new AC(), dest = ctx.createMediaStreamDestination();
    sources.forEach(function (src) { ctx.createMediaStreamSource(src).connect(dest); });
    return { stream: new MediaStream([video, dest.stream.getAudioTracks()[0]]), ctx: ctx };
  }

  function startRec() {
    if (!stream || rec || counting) return;
    countdown(function () {
      if (!stream) return;
      micStream().then(function (mic) {
        if (!stream || rec) { if (mic) mic.getTracks().forEach(function (tr) { tr.stop(); }); return; }
        var type = C.recType(function (x) {
          return typeof MediaRecorder.isTypeSupported !== "function" || MediaRecorder.isTypeSupported(x);
        });
        var parts = recStream(mic), mr;
        try { mr = new MediaRecorder(parts.stream, type ? { mimeType: type } : {}); }
        catch (e) {
          if (mic) mic.getTracks().forEach(function (tr) { tr.stop(); });
          if (parts.ctx) parts.ctx.close();
          toast(t("err.rec"));
          return;
        }
        var r = { mr: mr, chunks: [], bytes: 0, type: mr.mimeType || type || "video/webm", at: new Date(),
                  paused: 0, pausedAt: 0, mic: mic, ctx: parts.ctx, tick: 0 };
        mr.ondataavailable = function (ev) {
          if (!ev.data || !ev.data.size) return;
          r.chunks.push(ev.data);
          r.bytes += ev.data.size;
          if (r.bytes >= C.MAX_BYTES && rec === r) { toast(t("toast.limit")); endRec(); }
        };
        mr.onstop = function () { finishRec(r); };
        rec = r;
        mr.start(1000);
        r.tick = setInterval(paintRec, 500);
        paintRec();
        renderLive();
        $("b-end").focus();
      });
    });
  }

  function recMs(r) {
    var now = r.pausedAt || Date.now();
    return now - r.at.getTime() - r.paused;
  }

  function paintRec() {
    if (!rec) return;
    var paused = rec.mr.state === "paused";
    $("rec-time").textContent = paused ? t("rec.paused") + " " + C.clock(recMs(rec)) : C.clock(recMs(rec));
    // MP4 recorders may hold every chunk until the end: no size until one comes.
    $("rec-size").textContent = rec.bytes ? " · " + C.size(rec.bytes) : "";
    $("rec-status").classList.toggle("paused", paused);
  }

  function pauseRec() {
    if (!rec) return;
    if (rec.mr.state === "recording") { rec.mr.pause(); rec.pausedAt = Date.now(); }
    else if (rec.mr.state === "paused") { rec.mr.resume(); rec.paused += Date.now() - rec.pausedAt; rec.pausedAt = 0; }
    paintRec();
    renderLive();
  }

  function endRec() {
    var r = rec;
    if (!r) return;
    rec = null;
    clearInterval(r.tick);
    if (r.pausedAt) { r.paused += Date.now() - r.pausedAt; r.pausedAt = 0; }
    r.ms = recMs(r);
    try { if (r.mr.state !== "inactive") r.mr.stop(); else finishRec(r); }
    catch (e) { finishRec(r); }
    renderLive();
  }

  // The recorder's last chunk is in: the clip is ready to watch and save.
  function finishRec(r) {
    if (r.done) return;
    r.done = true;
    if (r.mic) r.mic.getTracks().forEach(function (tr) { try { tr.stop(); } catch (e) {} });
    if (r.ctx) { try { r.ctx.close(); } catch (e) {} }
    if (!r.bytes) { toast(t("err.rec")); if (stream) show("live"); else show("idle"); return; }
    dropClip();
    var blob = new Blob(r.chunks, { type: r.type.split(";")[0] });
    clip = { blob: blob, type: blob.type, at: r.at, ms: r.ms || recMs(r), url: URL.createObjectURL(blob) };
    var v = $("clip");
    v.src = clip.url;
    $("clip-info").textContent = t("clip.info", { time: C.clock(clip.ms), size: C.size(blob.size) });
    show("rec");
    $("b-rsave").focus();
  }

  function dropClip() {
    if (!clip) return;
    try { $("clip").pause(); } catch (e) {}
    $("clip").removeAttribute("src");
    try { $("clip").load(); } catch (e) {}
    URL.revokeObjectURL(clip.url);
    clip = null;
  }

  function saveRec() {
    if (!clip) return;
    var name = C.fileName(t("file.rec"), clip.at, C.recExt(clip.type));
    var blob = clip.blob;
    var F = fsApi();
    if (!F) { download(blob, name); return; }
    var n = 1;
    (function tryName() {
      var path = C.pathFor(name, n, C.VIDEOS);
      F.stat(path).then(function () { n++; if (n < 100) tryName(); else toast(t("err.save")); }, function () {
        F.write(path, blob).then(function () {
          toast(t("toast.rsaved", { name: path.slice(C.VIDEOS.length) }));
          if (prefs.montage) openAt("montage", { openFile: path });
        }, function () { toast(t("err.save")); });
      });
    })();
  }

  function recAgain() {
    dropClip();
    if (stream) show("live"); else start();
  }

  function recDiscard() {
    dropClip();
    show(stream ? "live" : "idle");
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

  // ---------- 7. Crop ----------
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

  // ---------- 8. Save and copy ----------
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
    $("opt-sys").addEventListener("change", function () { prefs.sys = this.checked; savePrefs(); });
    $("opt-mic").addEventListener("change", function () { prefs.mic = this.checked; savePrefs(); });
    $("opt-montage").addEventListener("change", function () { prefs.montage = this.checked; savePrefs(); });
    [].forEach.call($("mode").children, function (b) {
      b.addEventListener("click", function () { prefs.mode = b.getAttribute("data-mode"); savePrefs(); renderOptions(); });
    });
    $("b-rec").addEventListener("click", startRec);
    $("b-pause").addEventListener("click", pauseRec);
    $("b-end").addEventListener("click", endRec);
    $("b-rsave").addEventListener("click", saveRec);
    $("b-ragain").addEventListener("click", recAgain);
    $("b-rdrop").addEventListener("click", recDiscard);
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

  // ---------- 9. Boot (last, after every declaration) ----------
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
