// ============================================================
// orOS Label Maker — App logic (v1.0.0)
// Type a word and it is pressed letter by letter into plastic tape:
// raised, whitened letters, like the old embossed labels.
//   - keyboard or the letter wheel (turn it, press the handle)
//   - seven tape colours, 9 or 12 mm, straight or round ends, margin
//   - a click from Web Audio for every letter (off at first)
//   - my labels (synced): open, duplicate, delete with Undo
//   - recent: the last 10 labels made on this device
//   - PNG with a transparent background, copy image, A4 print sheet
//     at real size
// Data:
//   - synced slice "labels" (oros-labels-data): saved labels, LWW per
//     label + tombstones (R5, R17, R26)
//   - device-local (R10): oros-labels-prefs (mode, sound, tape,
//     width, ends, margin, wheel set, copies, recent, side panel)
// Deep link: __orosOpenAt("labels", { text }) starts a new label with
// that text (Storage's "Label" button); { openFile: { token } } opens
// an .oroslabels file from the system's "Open with".
// Sections:
//   1. Constants, i18n, helpers
//   2. Storage + prefs
//   3. Drawing the tape
//   4. The label being made
//   5. Typing + the wheel
//   6. Sounds
//   7. Options (tape, width, ends, margin)
//   8. My labels + recent
//   9. PNG, copy, print
//   9b. The .oroslabels file (save, open, unzipped folder)
//  10. Toasts
//  11. Keyboard (Contract Β) + panel
//  12. Sync slice + palette + deep link
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C           = window.LabelsCore;
  var STORAGE_KEY = "oros-labels-data";
  var PREFS_KEY   = "oros-labels-prefs";
  var SAVE_MS     = 500;
  var RECENT_MS   = 1500;
  var PNG_DPI     = 300;
  var SETS        = [C.LATIN, C.GREEK, C.DIGITS + C.SYMBOLS];

  // Tape colour, letter colour (the whitened plastic), and the gloss.
  var TAPE_COL = {
    red:    { bg: "#c4212d", fg: "#fff6f2", dark: false },
    black:  { bg: "#1c1c1f", fg: "#f4f4f4", dark: false },
    blue:   { bg: "#1f4fa6", fg: "#f3f7ff", dark: false },
    green:  { bg: "#1c7537", fg: "#f2fff5", dark: false },
    yellow: { bg: "#f1c618", fg: "#1a1a1a", dark: true },
    white:  { bg: "#f3f2ec", fg: "#1a1a1a", dark: true },
    clear:  { bg: "rgba(226,232,238,0.30)", fg: "#ffffff", dark: false, clear: true }
  };

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  // orosI18n (../i18n.js): the full language code, a pack language included.
  var LANG = window.orosI18n ? window.orosI18n.lang() : appLang();

  var STRINGS = {
    en: {
      "app.name": "Label Maker",
      "sub.letters": "{n} / {max} letters", "sub.saved": "Saved", "sub.new": "Not saved",
      "f.text": "Text of the label", "f.text.ph": "Type a word…",
      "tape.aria": "Label: {text}. {tape} tape, {w} mm.", "tape.blank": "Empty label. {tape} tape, {w} mm.",
      "btn.list": "My labels", "btn.closePanel": "Close",
      "mode.wheel": "Letter wheel: on", "mode.keys": "Letter wheel: off",
      "sound.on": "Sound: on", "sound.off": "Sound: off",
      "wheel.sets": "Letters on the wheel", "set.0": "ABC", "set.1": "ΑΒΓ", "set.2": "123 &?",
      "wheel.dial": "Letter wheel", "wheel.press": "Press", "wheel.space": "Space", "wheel.back": "Remove last",
      "wheel.prev": "Turn back", "wheel.next": "Turn on",
      "wheel.hint": "Turn the wheel with a finger, the mouse wheel or the arrow keys, then press.",
      "wheel.space.name": "space",
      "sec.tape": "Tape", "sec.width": "Width", "sec.cut": "Ends", "sec.margin": "Margin",
      "tape.red": "Red", "tape.black": "Black", "tape.blue": "Blue", "tape.green": "Green",
      "tape.yellow": "Yellow", "tape.white": "White", "tape.clear": "Clear",
      "width.9": "9 mm", "width.12": "12 mm",
      "cut.straight": "Straight", "cut.round": "Round",
      "margin.0": "Narrow", "margin.1": "Normal", "margin.2": "Wide",
      "btn.save": "Save label", "btn.saved": "Saved", "btn.new": "New label",
      "btn.png": "Download PNG", "btn.copy": "Copy image", "btn.print": "Print",
      "sec.mine": "My labels", "sec.recent": "Recent", "sec.print": "Print sheet",
      "mine.empty": "Labels you save appear here. They follow you to all your devices.",
      "recent.empty": "The last labels you made on this device appear here.",
      "item.open": "Open", "item.dup": "Duplicate", "item.delete": "Delete label", "item.pick": "Print this label",
      "f.copies": "Copies of each", "btn.printSheet": "Print A4 sheet",
      "print.cur": "Prints the label on the tape.", "print.sel": "Prints the {n} labels you ticked.",
      "print.sel1": "Prints the label you ticked.",
      "toast.saved": "Label saved", "toast.deleted": "Label deleted", "toast.undo": "Undo",
      "toast.copied": "Image copied", "toast.copyFail": "Could not copy the image",
      "toast.empty": "Type something first", "toast.full": "A label takes up to {n} letters",
      "toast.skipped": "Left out what the tape cannot print",
      "toast.mineFull": "You have {n} labels, the most there can be",
      "toast.saveFail": "Could not save: storage is full", "toast.file": "Saved",
      "toast.dup": "Copy made", "toast.from": "Label ready: {text}",
      "btn.oros": "orOS file (.oroslabels)", "sec.file": "orOS file",
      "file.open": "Open an orOS file…", "file.folder": "Unzipped orOS folder…",
      "file.hint": "Saves the labels you ticked, or the label on the tape. Opening a file adds its labels to My labels.",
      "toast.opened": "{n} labels added", "toast.opened1": "Label added",
      "toast.openedSome": "{n} labels added; the rest did not fit ({max} at most)",
      "toast.bad": "This is not a Label Maker file", "toast.newer": "This file was made by a newer orOS. Update orOS to open it.",
      "csv.text": "Text"
    },
    el: {
      "app.name": "Ετικετογράφος",
      "sub.letters": "{n} / {max} γράμματα", "sub.saved": "Αποθηκευμένη", "sub.new": "Δεν έχει αποθηκευτεί",
      "f.text": "Κείμενο ετικέτας", "f.text.ph": "Γράψε μια λέξη…",
      "tape.aria": "Ετικέτα: {text}. Ταινία {tape}, {w} χιλ.", "tape.blank": "Κενή ετικέτα. Ταινία {tape}, {w} χιλ.",
      "btn.list": "Οι ετικέτες μου", "btn.closePanel": "Κλείσιμο",
      "mode.wheel": "Τροχός γραμμάτων: ανοιχτός", "mode.keys": "Τροχός γραμμάτων: κλειστός",
      "sound.on": "Ήχος: ανοιχτός", "sound.off": "Ήχος: κλειστός",
      "wheel.sets": "Γράμματα στον τροχό", "set.0": "ABC", "set.1": "ΑΒΓ", "set.2": "123 &?",
      "wheel.dial": "Τροχός γραμμάτων", "wheel.press": "Πάτημα", "wheel.space": "Κενό", "wheel.back": "Αφαίρεση τελευταίου",
      "wheel.prev": "Γύρισμα πίσω", "wheel.next": "Γύρισμα μπροστά",
      "wheel.hint": "Γύρισε τον τροχό με το δάχτυλο, τη ροδέλα του ποντικιού ή τα βελάκια, και πάτα.",
      "wheel.space.name": "κενό",
      "sec.tape": "Ταινία", "sec.width": "Πλάτος", "sec.cut": "Άκρες", "sec.margin": "Περιθώριο",
      "tape.red": "Κόκκινη", "tape.black": "Μαύρη", "tape.blue": "Μπλε", "tape.green": "Πράσινη",
      "tape.yellow": "Κίτρινη", "tape.white": "Λευκή", "tape.clear": "Διάφανη",
      "width.9": "9 χιλ.", "width.12": "12 χιλ.",
      "cut.straight": "Ίσιες", "cut.round": "Στρογγυλές",
      "margin.0": "Στενό", "margin.1": "Κανονικό", "margin.2": "Φαρδύ",
      "btn.save": "Αποθήκευση", "btn.saved": "Αποθηκεύτηκε", "btn.new": "Νέα ετικέτα",
      "btn.png": "Λήψη PNG", "btn.copy": "Αντιγραφή εικόνας", "btn.print": "Εκτύπωση",
      "sec.mine": "Οι ετικέτες μου", "sec.recent": "Πρόσφατες", "sec.print": "Φύλλο εκτύπωσης",
      "mine.empty": "Οι ετικέτες που αποθηκεύεις εμφανίζονται εδώ. Σε ακολουθούν σε όλες τις συσκευές σου.",
      "recent.empty": "Οι τελευταίες ετικέτες που έφτιαξες σε αυτή τη συσκευή εμφανίζονται εδώ.",
      "item.open": "Άνοιγμα", "item.dup": "Διπλασιασμός", "item.delete": "Διαγραφή ετικέτας", "item.pick": "Εκτύπωση αυτής της ετικέτας",
      "f.copies": "Αντίτυπα από την καθεμία", "btn.printSheet": "Εκτύπωση φύλλου Α4",
      "print.cur": "Τυπώνει την ετικέτα της ταινίας.", "print.sel": "Τυπώνει τις {n} ετικέτες που τσέκαρες.",
      "print.sel1": "Τυπώνει την ετικέτα που τσέκαρες.",
      "toast.saved": "Η ετικέτα αποθηκεύτηκε", "toast.deleted": "Η ετικέτα διαγράφηκε", "toast.undo": "Αναίρεση",
      "toast.copied": "Η εικόνα αντιγράφηκε", "toast.copyFail": "Δεν έγινε αντιγραφή της εικόνας",
      "toast.empty": "Γράψε πρώτα κάτι", "toast.full": "Μια ετικέτα χωράει έως {n} γράμματα",
      "toast.skipped": "Έμειναν έξω όσα δεν τυπώνει η ταινία",
      "toast.mineFull": "Έχεις {n} ετικέτες, όσες χωράνε",
      "toast.saveFail": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος", "toast.file": "Αποθηκεύτηκε",
      "toast.dup": "Έγινε αντίγραφο", "toast.from": "Έτοιμη ετικέτα: {text}",
      "btn.oros": "Αρχείο orOS (.oroslabels)", "sec.file": "Αρχείο orOS",
      "file.open": "Άνοιγμα αρχείου orOS…", "file.folder": "Αποσυμπιεσμένος φάκελος orOS…",
      "file.hint": "Αποθηκεύει τις ετικέτες που τσέκαρες ή την ετικέτα της ταινίας. Όταν ανοίγεις ένα αρχείο, οι ετικέτες του προστίθενται στις ετικέτες σου.",
      "toast.opened": "Προστέθηκαν {n} ετικέτες", "toast.opened1": "Προστέθηκε η ετικέτα",
      "toast.openedSome": "Προστέθηκαν {n} ετικέτες· οι υπόλοιπες δεν χωρούσαν (έως {max})",
      "toast.bad": "Αυτό δεν είναι αρχείο του Ετικετογράφου", "toast.newer": "Το αρχείο φτιάχτηκε από νεότερο orOS. Ενημέρωσε το orOS για να το ανοίξεις.",
      "csv.text": "Κείμενο"
    }
  };

  if (window.orosI18n) window.orosI18n.table(STRINGS, "labels", LANG);

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

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("labels.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Storage + prefs ----------
  var data = { ver: 1, labels: [], tombs: {} };
  var prefs = null;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.labels)) {
          data = C.mergeLabels(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] labels: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = { ver: 1, labels: [], tombs: {} };
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
  function flush() { if (saveTimer) save(); if (recentTimer) pushRecentNow(); }

  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    p = (p && typeof p === "object") ? p : {};
    var st = C.normStyle(p);
    var copies = parseInt(p.copies, 10);
    prefs = {
      mode: p.mode === "wheel" ? "wheel" : "keys",
      sound: p.sound === true,
      tape: st.tape, width: st.width, cut: st.cut, margin: st.margin,
      set: p.set === 1 || p.set === 2 ? p.set : (LANG === "el" ? 1 : 0),
      copies: isFinite(copies) && copies >= 1 ? Math.min(copies, 60) : 1,
      recent: (Array.isArray(p.recent) ? p.recent : []).slice(0, C.MAX_RECENT).reverse()
        .reduce(function (acc, x) { return C.pushRecent(acc, x, false); }, []),
      panel: p.panel !== false
    };
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ---------- 3. Drawing the tape ----------
  var FONT = '"Arial Narrow", "Roboto Condensed", "Liberation Sans Narrow", "DejaVu Sans Condensed", "Helvetica Neue", Arial, sans-serif';

  function tapePath(ctx, g, k) {
    var L = g.len * k, H = g.w * k, r = g.round ? H / 2 : Math.min(0.35 * k, H / 6);
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(L - r, 0);
    ctx.arcTo(L, 0, L, r, r);
    ctx.lineTo(L, H - r);
    ctx.arcTo(L, H, L - r, H, r);
    ctx.lineTo(r, H);
    ctx.arcTo(0, H, 0, H - r, r);
    ctx.lineTo(0, r);
    ctx.arcTo(0, 0, r, 0, r);
    ctx.closePath();
  }

  // Draws label lab at k pixels per mm, from (0,0). press: { i, p } the
  // letter being pressed and how far (0..1), for the typing effect.
  function drawTape(ctx, lab, k, press) {
    var g = C.geometry(lab), col = TAPE_COL[lab.tape] || TAPE_COL.red;
    var L = g.len * k, H = g.w * k;
    ctx.save();
    tapePath(ctx, g, k);
    ctx.fillStyle = col.bg;
    ctx.fill();
    ctx.save();
    ctx.clip();
    // The plastic: a gloss along the top, a shade along the bottom.
    var gl = ctx.createLinearGradient(0, 0, 0, H);
    gl.addColorStop(0, "rgba(255,255,255," + (col.clear ? 0.30 : col.dark ? 0.35 : 0.20) + ")");
    gl.addColorStop(0.18, "rgba(255,255,255,0.04)");
    gl.addColorStop(0.75, "rgba(0,0,0,0)");
    gl.addColorStop(1, "rgba(0,0,0," + (col.clear ? 0.10 : 0.22) + ")");
    ctx.fillStyle = gl;
    ctx.fillRect(0, 0, L, H);
    // Fine lengthwise grain, the same for the same text.
    var seed = C.hash32(lab.text || "");
    ctx.strokeStyle = col.dark ? "rgba(0,0,0,0.035)" : "rgba(255,255,255,0.035)";
    ctx.lineWidth = Math.max(1, k * 0.05);
    for (var s = 0; s < 6; s++) {
      var y = ((seed >>> (s * 4)) & 15) / 15 * H;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(L, y); ctx.stroke();
    }
    // The letters: pressed out of the plastic, whitened by the press.
    var chars = Array.from(lab.text || "");
    var fs = g.capH / 0.72 * k;
    ctx.font = "bold " + fs.toFixed(2) + "px " + FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    var base = (g.w / 2 + g.capH / 2) * k;
    // One squeeze for every letter (from a wide one), so narrow letters
    // keep the same stroke; only letters wider still are squeezed more.
    var sxBase = Math.min(1, g.pitch * 0.84 * k / (ctx.measureText("N").width || fs * 0.7));
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      if (ch === " ") continue;
      var e = C.emboss(i, ch);
      var p = press && press.i === i ? press.p : 1;
      var cx = (g.x0 + (i + 0.5 + e.dx) * g.pitch) * k;
      var cy = base + e.dy * g.capH * k + (1 - p) * 0.4 * k;
      var mw = ctx.measureText(ch).width || fs * 0.6;
      var sx = sxBase;
      if (mw * sx > g.pitch * 0.95 * k) sx = g.pitch * 0.95 * k / mw;
      sx *= e.sx;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(e.rot * Math.PI / 180);
      ctx.scale(sx, 1);
      ctx.globalAlpha = p;
      // stress halo round the letter, then shadow, light edge and face
      if (!col.dark) {
        ctx.fillStyle = "rgba(255,255,255," + (0.10 * e.white).toFixed(3) + ")";
        ctx.fillText(ch, 0, -0.05 * k);
        ctx.fillText(ch, 0.12 * k, 0.05 * k);
      }
      ctx.fillStyle = col.clear ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.42)";
      ctx.fillText(ch, 0.14 * k, 0.2 * k);
      ctx.fillStyle = col.dark ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.35)";
      ctx.fillText(ch, -0.08 * k, -0.1 * k);
      ctx.globalAlpha = p * (col.dark ? 1 : e.white);
      ctx.fillStyle = col.fg;
      ctx.fillText(ch, 0, 0);
      ctx.restore();
    }
    ctx.restore();
    // Edge of the tape.
    tapePath(ctx, g, k);
    ctx.lineWidth = Math.max(1, k * 0.08);
    ctx.strokeStyle = col.clear ? "rgba(140,150,160,0.75)" : "rgba(0,0,0,0.30)";
    ctx.stroke();
    ctx.restore();
  }

  // A canvas of the label at k px/mm (turned upright when rot).
  function tapeCanvas(lab, k, rot) {
    var g = C.geometry(lab);
    var cv = document.createElement("canvas");
    var W = Math.ceil(g.len * k), H = Math.ceil(g.w * k);
    cv.width = rot ? H : W; cv.height = rot ? W : H;
    var ctx = cv.getContext("2d");
    if (rot) { ctx.translate(H, 0); ctx.rotate(Math.PI / 2); }
    drawTape(ctx, lab, k, null);
    return cv;
  }

  // ---------- 4. The label being made ----------
  var cur = null;            // the open saved label, or null for a new one
  var lab = null;            // what is on the tape: { text, tape, width, cut, margin }
  var press = null;          // { i, t0 } the letter being pressed
  var editSession = 0;       // a new label starts a new session (recent)

  function styleNow() { return { text: lab.text, tape: lab.tape, width: lab.width, cut: lab.cut, margin: lab.margin }; }

  function renderTape() {
    var cv = $("tape"), wrap = $("tape-wrap");
    var g = C.geometry(lab);
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    var avail = Math.max(120, wrap.clientWidth - 24);
    var k = Math.min(avail / g.len, 9.5);
    var W = g.len * k, H = g.w * k;
    cv.style.width = W.toFixed(1) + "px";
    cv.style.height = H.toFixed(1) + "px";
    cv.width = Math.ceil(W * dpr); cv.height = Math.ceil(H * dpr);
    var ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var pr = null;
    if (press) {
      var p = (performance.now() - press.t0) / 140;
      if (p >= 1) press = null;
      else pr = { i: press.i, p: Math.max(0, p) };
    }
    drawTape(ctx, lab, k, pr);
    var tape = t("tape." + lab.tape).toLowerCase();
    cv.setAttribute("aria-label", lab.text ? t("tape.aria", { text: lab.text, tape: tape, w: lab.width })
                                           : t("tape.blank", { tape: tape, w: lab.width }));
    if (press) requestAnimationFrame(renderTape);
  }

  function renderHead() {
    $("title-view").textContent = t("app.name");
    var n = C.length(lab.text);
    $("title-sub").textContent = (cur ? t("sub.saved") : (lab.text ? t("sub.new") : "")) ||
                                 t("sub.letters", { n: n, max: C.MAX_LEN });
    $("count").textContent = n + "/" + C.MAX_LEN;
    $("count").classList.toggle("full", n >= C.MAX_LEN);
    var sb = $("save-btn");
    sb.textContent = cur ? t("btn.saved") : t("btn.save");
    sb.disabled = !!cur || !lab.text.trim();
    sb.classList.toggle("done", !!cur);
  }

  function setText(text, opts) {
    opts = opts || {};
    var before = lab.text;
    var clean = C.cleanText(text, !opts.trim);
    if (clean === before) { renderHead(); return; }
    lab.text = clean;
    var grew = clean.length > before.length && clean.indexOf(before) === 0;
    if (grew && !reducedMotion()) press = { i: C.length(clean) - 1, t0: performance.now() };
    else press = null;
    if (grew) soundPress();
    if (cur) {
      var stored = clean.replace(/ $/, "");
      if (stored) { cur.text = stored; touch(cur); saveSoon(); renderMineSoon(); }
    }
    recentSoon();
    renderTape(); renderHead();
  }

  function touch(l) { l.m = Math.max(Date.now(), (data.tombs[l.id] || 0) + 1, l.m + 1); }

  function openLabel(l, keepFocus) {
    flush();
    cur = l || null;
    var s = l ? C.normStyle(l) : { text: "", tape: prefs.tape, width: prefs.width, cut: prefs.cut, margin: prefs.margin };
    lab = s;
    editSession++;
    press = null;
    $("text-in").value = lab.text;
    renderOptions(); renderTape(); renderHead(); renderMine();
    if (!keepFocus) closePanelOnPhone();
  }
  // A new label with this style and text (recent, deep link).
  function startFrom(style, text) {
    flush();
    cur = null;
    lab = C.normStyle(style);
    if (text !== undefined) lab.text = C.cleanText(text);
    editSession++;
    press = null;
    $("text-in").value = lab.text;
    renderOptions(); renderTape(); renderHead(); renderMine();
    closePanelOnPhone();
    recentSoon();
  }

  function saveLabel() {
    var text = lab.text.replace(/ $/, "");
    if (!text) { showToast(t("toast.empty")); return; }
    if (cur) return;
    if (data.labels.length >= C.MAX_LABELS) { showToast(t("toast.mineFull", { n: C.MAX_LABELS })); return; }
    var l = { id: C.newId(Math.random), m: Date.now(), text: text, tape: lab.tape, width: lab.width, cut: lab.cut, margin: lab.margin };
    data = C.mergeLabels(data, { labels: [l], tombs: {} });
    save();
    cur = C.findLabel(data, l.id);
    lab.text = text; $("text-in").value = text;
    pushRecentNow();
    soundCut();
    showToast(t("toast.saved"));
    renderHead(); renderMine();
  }
  function newLabel() {
    openLabel(null, true);
    $("text-in").focus();
  }

  // ---------- 5. Typing + the wheel ----------
  var lastWarn = 0;
  function onInput() {
    var inp = $("text-in"), raw = inp.value;
    var clean = C.cleanText(raw, true);
    var now = Date.now();
    if (now - lastWarn > 3000) {
      var rawN = C.length(raw.replace(/\s+/g, "")), cleanN = C.length(clean.replace(/ /g, ""));
      if (C.length(clean) >= C.MAX_LEN && rawN > cleanN) { lastWarn = now; showToast(t("toast.full", { n: C.MAX_LEN })); }
      else if (rawN > cleanN) { lastWarn = now; live(t("toast.skipped")); }
    }
    if (inp.value !== clean) {
      var pos = inp.selectionStart, cut = C.length(raw) - C.length(clean);
      inp.value = clean;
      try { var q = Math.max(0, Math.min(clean.length, pos - cut)); inp.setSelectionRange(q, q); } catch (e) {}
    }
    setText(clean);
  }

  // The wheel: one set of letters round a dial, the chosen one at the top.
  var wheelI = 0;
  function setChars() { return Array.from(SETS[prefs.set]); }
  function renderSets() {
    var host = $("sets");
    host.innerHTML = "";
    SETS.forEach(function (s, i) {
      var b = el("button", "chip" + (i === prefs.set ? " on" : ""), t("set." + i));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", i === prefs.set ? "true" : "false");
      b.addEventListener("click", function () {
        prefs.set = i; savePrefs(); wheelI = 0; renderSets(); renderWheel(true);
      });
      host.appendChild(b);
    });
  }
  function renderWheel(rebuild) {
    var chars = setChars(), n = chars.length, ring = $("ring");
    if (wheelI >= n) wheelI = 0;
    if (rebuild || ring.childNodes.length !== n) {
      ring.innerHTML = "";
      chars.forEach(function (c, i) {
        var s = el("span", "rl", c);
        s.style.transform = "rotate(" + (i * 360 / n) + "deg)";
        ring.appendChild(s);
      });
      ringTurn = -wheelI * 360 / n;
    }
    [].forEach.call(ring.childNodes, function (s, i) { s.classList.toggle("on", i === wheelI); });
    ring.style.transform = "rotate(" + ringTurn + "deg)";
    $("press-ch").textContent = chars[wheelI];
    var d = $("dial");
    d.setAttribute("aria-valuemax", String(n));
    d.setAttribute("aria-valuenow", String(wheelI + 1));
    d.setAttribute("aria-valuetext", chars[wheelI]);
  }
  var ringTurn = 0;
  function turn(dlt) {
    var n = setChars().length;
    wheelI = C.wheelStep(wheelI, dlt, n);
    ringTurn -= dlt * 360 / n;                 // keeps turning the short way
    renderWheel(false);
    soundTick();
  }
  function pressWheel() {
    if (C.length(lab.text) >= C.MAX_LEN) { showToast(t("toast.full", { n: C.MAX_LEN })); return; }
    var ch = setChars()[wheelI];
    $("text-in").value = lab.text + ch;
    setText(lab.text + ch);
    var d = $("dial");
    d.classList.remove("pressed"); void d.offsetWidth; d.classList.add("pressed");
    live(ch);
  }
  function wheelSpace() {
    if (!lab.text || / $/.test(lab.text)) return;
    $("text-in").value = lab.text + " ";
    setText(lab.text + " ");
    live(t("wheel.space.name"));
  }
  function wheelBack() {
    if (!lab.text) return;
    var v = Array.from(lab.text).slice(0, -1).join("");
    $("text-in").value = v;
    setText(v);
  }

  // Turning by dragging round the centre of the dial.
  var drag = null;
  function dialAngle(e) {
    var r = $("dial").getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
  }
  function onDialDown(e) {
    if (e.target.closest && e.target.closest("#press-btn")) return;
    drag = { a: dialAngle(e), acc: 0, id: e.pointerId };
    try { $("dial").setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  }
  function onDialMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var a = dialAngle(e), d = a - drag.a;
    if (d > 180) d -= 360; if (d < -180) d += 360;
    drag.a = a; drag.acc += d;
    var step = 360 / setChars().length;
    while (drag.acc <= -step) { drag.acc += step; turn(1); }   // turning anticlockwise brings the next letter up
    while (drag.acc >= step) { drag.acc -= step; turn(-1); }
  }
  function onDialUp(e) { if (drag && e.pointerId === drag.id) drag = null; }
  function onDialWheel(e) {
    e.preventDefault();
    turn(e.deltaY > 0 || e.deltaX > 0 ? 1 : -1);
  }
  function onDialKey(e) {
    var k = e.key;
    if (k === "ArrowRight" || k === "ArrowDown") { e.preventDefault(); turn(1); }
    else if (k === "ArrowLeft" || k === "ArrowUp") { e.preventDefault(); turn(-1); }
    else if (k === "PageDown") { e.preventDefault(); turn(5); }
    else if (k === "PageUp") { e.preventDefault(); turn(-5); }
    else if (k === "Home") { e.preventDefault(); turn(-wheelI); }
    else if (k === "Enter" || k === " ") { e.preventDefault(); pressWheel(); }
    else if (k === "Backspace") { e.preventDefault(); wheelBack(); }
  }

  function renderMode() {
    var on = prefs.mode === "wheel", b = $("mode-btn");
    $("wheel").hidden = !on;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    setLabel(b, on ? t("mode.wheel") : t("mode.keys"));
    if (on) { renderSets(); renderWheel(true); }
  }
  function toggleMode() {
    prefs.mode = prefs.mode === "wheel" ? "keys" : "wheel"; savePrefs(); renderMode();
    live(prefs.mode === "wheel" ? t("mode.wheel") : t("mode.keys"));
    if (prefs.mode === "wheel") $("dial").focus(); else $("text-in").focus();
  }

  // ---------- 6. Sounds (Web Audio, made on the spot) ----------
  var actx = null, noiseBuf = null;
  function audio() {
    if (!prefs.sound) return null;
    try {
      if (!actx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        actx = new AC();
        noiseBuf = actx.createBuffer(1, Math.floor(actx.sampleRate * 0.3), actx.sampleRate);
        var d = noiseBuf.getChannelData(0);
        for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (actx.state === "suspended") actx.resume();
      return actx;
    } catch (e) { return null; }
  }
  function noise(a, at, dur, freq, q, vol) {
    var src = a.createBufferSource(), bp = a.createBiquadFilter(), g = a.createGain();
    src.buffer = noiseBuf;
    bp.type = "bandpass"; bp.frequency.value = freq; bp.Q.value = q;
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(bp); bp.connect(g); g.connect(a.destination);
    src.start(at, Math.random() * 0.2, dur + 0.02);
  }
  function tone(a, at, freq, dur, vol, type) {
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || "sine"; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(a.destination);
    o.start(at); o.stop(at + dur + 0.02);
  }
  // The squeeze: a hard plastic clack, then the tape stepping on.
  function soundPress() {
    var a = audio(); if (!a) return;
    var at = a.currentTime;
    noise(a, at, 0.03, 1800 + Math.random() * 600, 1.2, 0.45);
    tone(a, at, 140 + Math.random() * 25, 0.06, 0.3, "triangle");
    noise(a, at + 0.09, 0.025, 4200, 3, 0.12);
  }
  function soundTick() {
    var a = audio(); if (!a) return;
    noise(a, a.currentTime, 0.012, 5200, 4, 0.10);
  }
  function soundCut() {
    var a = audio(); if (!a) return;
    var at = a.currentTime;
    noise(a, at, 0.05, 3000, 1.5, 0.35);
    noise(a, at + 0.05, 0.03, 900, 1, 0.25);
  }
  function renderSound() {
    var b = $("sound-btn");
    b.innerHTML = prefs.sound ? ICON.soundOn : ICON.soundOff;
    b.setAttribute("aria-pressed", prefs.sound ? "true" : "false");
    setLabel(b, prefs.sound ? t("sound.on") : t("sound.off"));
  }
  function toggleSound() {
    prefs.sound = !prefs.sound; savePrefs(); renderSound();
    if (prefs.sound) soundPress();
  }

  // ---------- 7. Options ----------
  function radioChips(host, values, curVal, label, onPick, swatch) {
    host.innerHTML = "";
    values.forEach(function (v) {
      var on = v === curVal;
      var b = el("button", swatch ? "swatch" : "chip" + (on ? " on" : ""));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      if (swatch) {
        b.setAttribute("data-tape", v);
        setLabel(b, label(v));
        b.appendChild(el("span", "sw-dot", "A"));
      } else b.textContent = label(v);
      b.addEventListener("click", function () { onPick(v); });
      host.appendChild(b);
    });
    // arrow keys move along a radio group
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
  function pickStyle(key, v) {
    if (lab[key] === v) return;
    lab[key] = v;
    prefs[key] = v; savePrefs();
    if (cur) { cur[key] = v; touch(cur); saveSoon(); renderMineSoon(); }
    recentSoon();
    renderOptions(); renderTape(); renderHead();
  }
  function renderOptions() {
    radioChips($("tapes"), C.TAPES, lab.tape, function (v) { return t("tape." + v); }, function (v) { pickStyle("tape", v); }, true);
    radioChips($("widths"), C.WIDTHS, lab.width, function (v) { return t("width." + v); }, function (v) { pickStyle("width", v); });
    radioChips($("cuts"), C.CUTS, lab.cut, function (v) { return t("cut." + v); }, function (v) { pickStyle("cut", v); });
    radioChips($("margins"), C.MARGINS, lab.margin, function (v) { return t("margin." + v); }, function (v) { pickStyle("margin", v); });
  }

  // ---------- 8. My labels + recent ----------
  var picked = {};             // ids ticked for the print sheet (this visit only)
  var mineTimer = null;
  function renderMineSoon() { clearTimeout(mineTimer); mineTimer = setTimeout(renderMine, 600); }

  // A small tape drawn with CSS, for the lists.
  function miniTape(s) {
    var m = el("span", "mini", s.text);
    m.setAttribute("data-tape", s.tape);
    if (s.cut === "round") m.classList.add("round");
    if (s.width === 9) m.classList.add("w9");
    return m;
  }

  function renderMine() {
    clearTimeout(mineTimer);
    var host = $("mine"), list = C.newestFirst(data.labels);
    host.innerHTML = "";
    $("mine-empty").hidden = list.length > 0;
    $("mine-count").textContent = list.length ? String(list.length) : "";
    Object.keys(picked).forEach(function (id) { if (!C.findLabel(data, id)) delete picked[id]; });
    list.forEach(function (l) {
      var li = el("li", "row"), on = !!(cur && cur.id === l.id);
      if (on) li.classList.add("on");
      var pickBox = el("label", "pick-box");
      var pick = el("input", "pick");
      pick.type = "checkbox";
      pickBox.appendChild(pick);
      pick.checked = !!picked[l.id];
      setLabel(pick, t("item.pick") + ": " + l.text);
      pick.addEventListener("change", function () {
        if (pick.checked) picked[l.id] = 1; else delete picked[l.id];
        renderPrintNote();
      });
      li.appendChild(pickBox);
      var open = el("button", "row-open");
      open.type = "button";
      if (on) open.setAttribute("aria-current", "true");
      open.appendChild(miniTape(l));
      setLabel(open, t("item.open") + ": " + l.text);
      open.addEventListener("click", function () { openLabel(C.findLabel(data, l.id)); });
      li.appendChild(open);
      var dup = el("button", "icon-btn");
      dup.type = "button"; dup.innerHTML = ICON.dup;
      setLabel(dup, t("item.dup") + ": " + l.text);
      dup.addEventListener("click", function () { duplicate(l.id); });
      li.appendChild(dup);
      var d = el("button", "icon-btn del-btn");
      d.type = "button"; d.innerHTML = ICON.del;
      setLabel(d, t("item.delete") + ": " + l.text);
      d.addEventListener("click", function () { deleteLabel(l.id); });
      li.appendChild(d);
      host.appendChild(li);
    });
    renderPrintNote();
  }

  function duplicate(id) {
    var l = C.findLabel(data, id);
    if (!l) return;
    if (data.labels.length >= C.MAX_LABELS) { showToast(t("toast.mineFull", { n: C.MAX_LABELS })); return; }
    var copy = JSON.parse(JSON.stringify(l));
    copy.id = C.newId(Math.random); copy.m = Date.now();
    data = C.mergeLabels(data, { labels: [copy], tombs: {} });
    save();
    openLabel(C.findLabel(data, copy.id), true);
    showToast(t("toast.dup"));
  }

  function deleteLabel(id) {
    var l = C.findLabel(data, id);
    if (!l) return;
    var snap = JSON.parse(JSON.stringify(l)), tombs = {};
    tombs[id] = Math.max(Date.now(), l.m);
    data = C.mergeLabels(data, { labels: [], tombs: tombs });
    delete picked[id];
    save();
    if (cur && cur.id === id) { cur = null; renderHead(); }      // the tape keeps the text, now unsaved
    renderMine();
    undoToast(t("toast.deleted"), function () {
      snap.m = Math.max(Date.now(), (data.tombs[snap.id] || 0) + 1);   // R17
      data = C.mergeLabels(data, { labels: [snap], tombs: {} });
      save();
      openLabel(C.findLabel(data, snap.id), true);
    });
  }

  var recentTimer = null, recentSession = -1;
  function recentSoon() {
    clearTimeout(recentTimer);
    recentTimer = setTimeout(pushRecentNow, RECENT_MS);
  }
  function pushRecentNow() {
    clearTimeout(recentTimer); recentTimer = null;
    if (!lab || !lab.text.trim()) return;
    var same = recentSession === editSession;
    var next = C.pushRecent(prefs.recent, styleNow(), same);
    recentSession = editSession;
    if (JSON.stringify(next) === JSON.stringify(prefs.recent)) return;
    prefs.recent = next; savePrefs();
    renderRecent();
  }
  function renderRecent() {
    var host = $("recent");
    host.innerHTML = "";
    $("recent-empty").hidden = prefs.recent.length > 0;
    prefs.recent.forEach(function (s) {
      var li = el("li", "row");
      var open = el("button", "row-open");
      open.type = "button";
      open.appendChild(miniTape(s));
      setLabel(open, t("item.open") + ": " + s.text);
      open.addEventListener("click", function () { startFrom(s); });
      li.appendChild(open);
      host.appendChild(li);
    });
  }

  // ---------- 9. PNG, copy, print ----------
  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
  }
  function pngBlob(l, cb) {
    var cv = tapeCanvas(l, PNG_DPI / 25.4, false);
    if (cv.toBlob) cv.toBlob(function (b) { cb(b); }, "image/png");
    else cb(null);
  }
  function hasText() {
    if (lab.text.trim()) return true;
    showToast(t("toast.empty")); return false;
  }
  function downloadPng() {
    if (!hasText()) return;
    pushRecentNow();
    var l = styleNow();
    pngBlob(l, function (blob) {
      if (!blob) return;
      var name = C.fileName(l.text), dlg = dialogHost();
      if (dlg && typeof dlg.saveFile === "function") {
        dlg.saveFile({ blob: blob, filename: name, mime: "image/png",
                       types: [{ description: "PNG", accept: { "image/png": [".png"] } }] })
          .then(function (r) { if (r && r.ok) showToast(t("toast.file")); });
        return;                       // cancel (ok=false) = silent exit
      }
      var url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
      showToast(t("toast.file"));
    });
  }
  function canCopyImage() {
    return !!(navigator.clipboard && navigator.clipboard.write && window.ClipboardItem);
  }
  function copyImage() {
    if (!hasText()) return;
    pushRecentNow();
    var fail = function () { showToast(t("toast.copyFail")); };
    try {
      // The blob is handed over as a promise so Safari keeps the click.
      var item = new window.ClipboardItem({ "image/png": new Promise(function (res, rej) {
        pngBlob(styleNow(), function (b) { if (b) res(b); else rej(new Error("no image")); });
      }) });
      navigator.clipboard.write([item]).then(function () { showToast(t("toast.copied")); }, fail);
    } catch (e) { fail(); }
  }

  function printList() {
    var ids = Object.keys(picked).filter(function (id) { return C.findLabel(data, id); });
    if (ids.length) {
      return C.newestFirst(data.labels).filter(function (l) { return picked[l.id]; });
    }
    return lab.text.trim() ? [styleNow()] : [];
  }
  function renderPrintNote() {
    var n = Object.keys(picked).length;
    $("print-note").textContent = n ? (n === 1 ? t("print.sel1") : t("print.sel", { n: n })) : t("print.cur");
    var ci = $("copies-in");
    if (document.activeElement !== ci) ci.value = String(prefs.copies);
  }
  function onCopies() {
    var n = parseInt($("copies-in").value, 10);
    if (!isFinite(n) || n < 1) return;
    prefs.copies = Math.min(n, 60); savePrefs();
  }
  // Builds the A4 sheets (shown only in print) and prints them.
  function printSheet() {
    var list = printList();
    if (!list.length) { showToast(t("toast.empty")); return; }
    pushRecentNow();
    var items = [];
    list.forEach(function (l) { for (var c = 0; c < prefs.copies; c++) items.push(l); });
    var pages = C.sheetLayout(items.map(C.geometry));
    var host = $("sheet"), k = PNG_DPI / 25.4, cache = {};
    host.innerHTML = "";
    pages.forEach(function (pg) {
      var page = el("div", "sheet-page");
      pg.forEach(function (it) {
        var l = items[it.i], key = JSON.stringify(l) + (it.rot ? "r" : "");
        if (!cache[key]) cache[key] = tapeCanvas(l, k, it.rot).toDataURL("image/png");
        var box = el("div", "sheet-item");
        box.style.left = it.x + "mm"; box.style.top = it.y + "mm";
        box.style.width = it.w + "mm"; box.style.height = it.h + "mm";
        var img = el("img");
        img.src = cache[key]; img.alt = "";
        box.appendChild(img);
        page.appendChild(box);
      });
      host.appendChild(page);
    });
    setTimeout(function () { try { window.print(); } catch (e) {} }, 60);
  }

  // ---------- 9b. The .oroslabels file (bundle.js) ----------
  // Saves what Print would print (the ticked labels, or the label on
  // the tape) with the copies count. Opening one always adds NEW saved
  // labels (fresh ids, cleaned as typed text is), ticks them for the
  // print sheet and opens the first; nothing is overwritten.
  var FILE_MAX = 8 * 1024 * 1024;        // labels are text: a real file is a few KB
  var THUMB_MAX = 512, THUMB_ROWS = 8;

  // preview/thumbnail.png: the first labels one under the other.
  function thumbBlob(list, cb) {
    try {
      var shown = list.slice(0, THUMB_ROWS), gap = 2, maxLen = 0, totalH = 0;
      shown.forEach(function (l) { var g = C.geometry(l); maxLen = Math.max(maxLen, g.len); totalH += g.w + gap; });
      totalH += gap;
      var k = Math.min(THUMB_MAX / (maxLen + 2 * gap), THUMB_MAX / totalH, 12);
      var cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.ceil((maxLen + 2 * gap) * k));
      cv.height = Math.max(1, Math.ceil(totalH * k));
      var ctx = cv.getContext("2d"), y = gap;
      shown.forEach(function (l) {
        var g = C.geometry(l);
        ctx.save();
        ctx.translate((cv.width - g.len * k) / 2, y * k);
        drawTape(ctx, l, k, null);
        ctx.restore();
        y += g.w + gap;
      });
      if (!cv.toBlob) { cb(null); return; }
      cv.toBlob(function (b) {
        if (!b) { cb(null); return; }
        b.arrayBuffer().then(function (ab) { cb(new Uint8Array(ab)); }, function () { cb(null); });
      }, "image/png");
    } catch (e) { cb(null); }
  }
  function csvName(kind, v) {
    if (kind === "tape") return t("tape." + v);
    if (kind === "width") return t("width." + v);
    if (kind === "cut") return t("cut." + v);
    return t("margin." + v);
  }
  function saveOros() {
    var B = window.OrosBundle, list = printList();
    if (!list.length) { showToast(t("toast.empty")); return; }
    if (!B) { showToast(t("toast.saveFail")); return; }
    flush();
    var opts = C.labelsBundle(list, { copies: prefs.copies, lang: LANG === "el" ? "el" : "en", date: new Date(), name: csvName,
      csvHead: [t("csv.text"), t("sec.tape"), t("sec.width"), t("sec.cut"), t("sec.margin")] });
    if (!opts) { showToast(t("toast.empty")); return; }
    thumbBlob(opts.content.labels, function (png) {
      if (png) opts.thumbnail = png;
      B.write(opts).then(function (bytes) {
        var blob = new Blob([bytes], { type: C.LABELS_MIME }), name = C.sheetFileName(list[0].text), dlg = dialogHost();
        if (dlg && typeof dlg.saveFile === "function") {
          dlg.saveFile({ blob: blob, filename: name, mime: C.LABELS_MIME,
                         types: [{ description: t("btn.oros"), accept: { "application/x-oros-labels": [".oroslabels"] } }] })
            .then(function (r) { if (r && r.ok) showToast(t("toast.file")); });
          return;                     // cancel (ok=false) = silent exit
        }
        var url = URL.createObjectURL(blob), a = document.createElement("a");
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
        showToast(t("toast.file"));
      }, function () { showToast(t("toast.saveFail")); });
    });
  }
  function fromBundle(r) {
    var room = C.MAX_LABELS - data.labels.length;
    if (room <= 0) { showToast(t("toast.mineFull", { n: C.MAX_LABELS })); return; }
    var got = C.labelsFromBundle(r && r.content, Math.random, Date.now(), room);
    if (!got || !got.labels.length) { showToast(t("toast.bad")); return; }
    var total = r.content.labels.length;
    data = C.mergeLabels(data, { labels: got.labels, tombs: {} });
    save();
    prefs.copies = got.copies; savePrefs();
    picked = {};
    if (got.labels.length > 1) got.labels.forEach(function (l) { picked[l.id] = 1; });
    openLabel(C.findLabel(data, got.labels[0].id), true);
    var n = got.labels.length;
    showToast(n < total ? t("toast.openedSome", { n: n, max: C.MAX_LABELS })
                        : (n === 1 ? t("toast.opened1") : t("toast.opened", { n: n })));
  }
  function bundleFail(e) {
    try { console.error("[orOS] labels: .oroslabels not read:", e && (e.code || e.message)); } catch (er) {}
    showToast(e && e.code === "newer" ? t("toast.newer") : t("toast.bad"));
  }
  // A picked or handed-over file: only an .oroslabels bundle, sniffed
  // from its first bytes ("PK…mimetype"), never trusted by its name.
  function readFile(f) {
    var B = window.OrosBundle;
    if (!f || !B || !f.slice) return;
    f.slice(0, 128).arrayBuffer().then(function (head) {
      if (B.sniff(new Uint8Array(head)) === null || f.size > FILE_MAX) { showToast(t("toast.bad")); return; }
      return f.arrayBuffer()
        .then(function (ab) { return B.read(new Uint8Array(ab), { mime: C.LABELS_MIME }); })
        .then(fromBundle, bundleFail);
    }, function () { showToast(t("toast.bad")); });
  }
  function openOros() {
    var inp = $("file-input");
    inp.value = "";
    inp.onchange = function () { readFile(inp.files && inp.files[0]); };
    inp.click();
  }
  // An unzipped .oroslabels folder (maybe changed by hand)
  function importFolder() {
    var B = window.OrosBundle;
    if (!B) return;
    B.pickFolder().then(function (files) {
      if (!files) return;
      return B.readFolder(files, { mime: C.LABELS_MIME }).then(fromBundle, bundleFail);
    });
  }

  // ---------- 10. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "labels", title: String(text) })) return;
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
        e.preventDefault(); setPanel(false); $("list-btn").focus();
      }
    });
    $("text-in").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); if (!cur && lab.text.trim()) saveLabel(); }
    });
  }

  // Panel: always there on a wide screen (can be hidden), a drawer on a phone.
  function phone() { return window.matchMedia("(max-width: 760px)").matches; }
  function setPanel(open) {
    document.body.classList.toggle("panel-open", open);
    $("list-btn").setAttribute("aria-expanded", open ? "true" : "false");
    $("scrim").hidden = !(open && phone());
    if (!phone()) { prefs.panel = open; savePrefs(); }
    setTimeout(renderTape, 0);
  }
  function togglePanel() {
    var open = !document.body.classList.contains("panel-open");
    setPanel(open);
    if (open && phone()) { var first = $("panel").querySelector("button, input"); if (first) first.focus(); }
  }
  function closePanelOnPhone() { if (phone() && document.body.classList.contains("panel-open")) setPanel(false); }

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
    api.registerSlice("labels", sliceGet, sliceSet, STORAGE_KEY, C.mergeLabels);
  }

  function sliceGet() { if (saveTimer) save(); return C.mergeLabels(data, data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.labels)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.mergeLabels(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;   // no toast on merge
    if (cur) {
      var fresh = C.findLabel(data, cur.id);
      if (!fresh) { cur = null; }                   // deleted on another device: the tape stays, unsaved
      else {
        cur = fresh;
        if (document.activeElement !== $("text-in") && !C.sameStyle(C.normStyle(fresh), C.normStyle(lab))) {
          lab = C.normStyle(fresh);
          $("text-in").value = lab.text;
          renderOptions(); renderTape();
        }
      }
    }
    renderHead(); renderMine();
  }

  // Deep links: { text } (Storage's "Label" button) starts a new label;
  // { openFile: { token } } is an .oroslabels from the system's "Open
  // with" (shell fileopen.js), taken once and read as "Open" reads one.
  function openTarget(target) {
    if (target && typeof target === "object" && target.openFile && typeof target.openFile.token === "string") {
      var f = null;
      try {
        var p = window.parent;
        if (p && p !== window && typeof p.__orosTakeFile === "function") f = p.__orosTakeFile(target.openFile.token);
      } catch (e) { f = null; }
      if (f) readFile(f);
      return;
    }
    if (!target || typeof target.text !== "string") return;
    var text = C.cleanText(target.text);
    startFrom({ tape: prefs.tape, width: prefs.width, cut: prefs.cut, margin: prefs.margin }, text);
    if (text) live(t("toast.from", { text: text }));
    try { $("text-in").focus({ preventScroll: true }); } catch (e) {}
  }
  window.__orosOpenAt = function (target) { openTarget(target); };

  // ---------- 13. Wiring & boot ----------
  var ICON = {
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><path d="M7.5 7.5h.01"/></svg>',
    wheel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>',
    soundOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    soundOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M16 9l5 5M21 9l-5 5"/></svg>',
    del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    dup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
  };

  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    [].forEach.call(document.querySelectorAll("[data-i18n-ph]"), function (n) {
      n.placeholder = t(n.getAttribute("data-i18n-ph"));
    });
    [].forEach.call(document.querySelectorAll("[data-i18n-aria]"), function (n) {
      n.setAttribute("aria-label", t(n.getAttribute("data-i18n-aria")));
    });
    document.title = t("app.name") + " · orOS";
    $("list-btn").innerHTML = ICON.list; setLabel($("list-btn"), t("btn.list"));
    $("mode-btn").innerHTML = ICON.wheel;
    $("close-panel").innerHTML = ICON.del; setLabel($("close-panel"), t("btn.closePanel"));
    $("prev-btn").innerHTML = ICON.prev; setLabel($("prev-btn"), t("wheel.prev"));
    $("next-btn").innerHTML = ICON.next; setLabel($("next-btn"), t("wheel.next"));
    $("new-btn").insertAdjacentHTML("afterbegin", ICON.plus);
    $("dial").setAttribute("aria-label", t("wheel.dial"));
    $("copy-btn").hidden = !canCopyImage();
    var hasBundle = !!window.OrosBundle;     // ../bundle.js (the .oroslabels file)
    $("oros-btn").hidden = !hasBundle;
    $("file-sec").hidden = !hasBundle;
  }

  function wire() {
    var inp = $("text-in");
    var composing = false;
    inp.addEventListener("compositionstart", function () { composing = true; });
    inp.addEventListener("compositionend", function () { composing = false; onInput(); });
    inp.addEventListener("input", function (e) { if (!composing && !(e && e.isComposing)) onInput(); });
    inp.addEventListener("blur", function () {
      if (/ $/.test(lab.text)) { setText(lab.text, { trim: true }); inp.value = lab.text; }
    });
    $("mode-btn").addEventListener("click", toggleMode);
    $("sound-btn").addEventListener("click", toggleSound);
    $("list-btn").addEventListener("click", togglePanel);
    $("close-panel").addEventListener("click", function () { setPanel(false); $("list-btn").focus(); });
    $("scrim").addEventListener("click", function () { setPanel(false); });
    $("save-btn").addEventListener("click", saveLabel);
    $("new-btn").addEventListener("click", newLabel);
    $("png-btn").addEventListener("click", downloadPng);
    $("copy-btn").addEventListener("click", copyImage);
    $("print-btn").addEventListener("click", printSheet);
    $("print2-btn").addEventListener("click", printSheet);
    $("oros-btn").addEventListener("click", saveOros);
    $("file-open").addEventListener("click", openOros);
    $("file-folder").addEventListener("click", importFolder);
    $("copies-in").addEventListener("input", onCopies);
    $("copies-in").addEventListener("change", renderPrintNote);
    var dial = $("dial");
    dial.addEventListener("pointerdown", onDialDown);
    dial.addEventListener("pointermove", onDialMove);
    dial.addEventListener("pointerup", onDialUp);
    dial.addEventListener("pointercancel", onDialUp);
    dial.addEventListener("wheel", onDialWheel, { passive: false });
    dial.addEventListener("keydown", onDialKey);
    $("press-btn").addEventListener("click", pressWheel);
    $("press2-btn").addEventListener("click", pressWheel);
    $("prev-btn").addEventListener("click", function () { turn(-1); });
    $("next-btn").addEventListener("click", function () { turn(1); });
    $("space-btn").addEventListener("click", wheelSpace);
    $("back-btn").addEventListener("click", wheelBack);
    var rz = null;
    window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(renderTape, 80); });
    window.addEventListener("pagehide", flush);
    window.addEventListener("afterprint", function () { $("sheet").innerHTML = ""; });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(); });
    wireKeyboard();
  }

  function boot() {
    load();
    loadPrefs();
    applyI18n();
    inheritPalette();
    lab = { text: "", tape: prefs.tape, width: prefs.width, cut: prefs.cut, margin: prefs.margin };
    renderSound();
    wire();
    registerSync();
    watchPalette();
    setPanel(!phone() && prefs.panel);
    openLabel(null, true);
    renderMode();
    renderRecent();
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === "function") {
        var pending = window.parent.__orosTakeTarget("labels");
        if (pending) openTarget(pending);
      }
    } catch (e) {}
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(renderTape);
  }

  boot();
})();
