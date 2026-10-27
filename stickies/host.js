// ============================================================
// orOS Sticky Notes — shell side (v1.1.0)
// Runs in the SHELL window (index.html loads it after
// notifications.js, with stickies/core.js before it). It
//   - keeps the synced slice "stickies" (oros-stickies-data); it is
//     the ONLY writer: the app asks through window.orosStickies
//   - draws the notes on the desktop (#sn-layer inside
//     #oros-desktop, so a running app hides them): free notes on a
//     wide screen, a row of cards at the top under 600 px
//   - rings (chime + wiggle + one inbox item) and fades notes at
//     their times, on the shell's clock tick (no timer of its own)
//   - owns the note editor (a centred dialog in the shell document,
//     also over the app), with Send to To-Do (BR-TD-ADD) and Copy to
//     Notes ({ add: { title, text } })
//   - plays a Ringtone Composer melody as the chime when the device
//     setting says so (reads oros-ringtones-data, never writes it;
//     ringtones/core.js is loaded on first need)
// Device-local (R10, never synced):
//   oros-stickies-pos    { <id>: { x, y, w, h, z, fold } } positions
//                        as fractions of the desktop + size in px
//   oros-stickies-prefs  { show, sound, color, pop }; sound is a
//                        built-in chime or "rt:<melody id>"
//   oros-stickies-local  { rung: { <id>: at } } rings this device
//                        already announced
// Nothing happens while orOS is closed; the next open catches up (a
// missed ring lands in the inbox without sound).
// Inert until apps.json lists "stickies" (orosStickiesEnv.registered).
// Sections:
//   1. Strings, helpers
//   2. Storage, slice, changes
//   3. Sound
//   4. Desktop: wide notes, narrow cards, add button, menu
//   5. Drag + resize
//   6. Editor dialog
//   7. Engine tick
//   8. Public API, deep link, boot
// ============================================================
(function (root) {
  "use strict";
  var C = root.StickiesCore;
  if (!C) return;                               // stale bundle without core.js
  var doc = root.document;

  var KEY = "oros-stickies-data";
  var POS_KEY = "oros-stickies-pos";
  var PREFS_KEY = "oros-stickies-prefs";
  var LOCAL_KEY = "oros-stickies-local";
  var SAVE_MS = 500;
  var LATE_MS = 2 * 60000;                       // a ring found later than this is announced without sound
  var NARROW_Q = "(max-width: 599px)";
  var SOUNDS = ["bell", "dingdong", "wind", "off"];
  var RT_RE = /^rt:[A-Za-z0-9_-]{1,64}$/;        // a Ringtone Composer melody
  var RT_KEY = "oros-ringtones-data";
  var RT_MAX_S = 15;                             // a melody chime stops after 15 s
  function validSound(v) { return SOUNDS.indexOf(v) >= 0 || RT_RE.test(String(v)); }
  // ringtones/core.js next to this file's folder, with the same ?v= stamp
  var RT_SRC = "ringtones/core.js";
  try {
    var cs0 = root.document && root.document.currentScript;
    if (cs0 && typeof cs0.src === "string" && /stickies\/host\.js(?=[?#]|$)/.test(cs0.src)) {
      RT_SRC = cs0.src.replace(/stickies\/host\.js(?=[?#]|$)/, "ringtones/core.js");
    }
  } catch (e) {}

  // ---------- 1. Strings, helpers ----------
  var STRINGS = {
    en: {
      note: "Sticky note", "new": "New sticky note", tidy: "Tidy up sticky notes", app: "Open Sticky Notes",
      more: "Note options", fold: "Fold", unfold: "Unfold", ph: "Write something…",
      done: "Done", snooze: "Snooze 10 min", close: "Close", del: "Delete", undo: "Undo",
      deleted: "Sticky note deleted", "note.empty": "(empty)",
      color: "Colour", text: "Text",
      "c.yellow": "Yellow", "c.pink": "Pink", "c.green": "Green", "c.blue": "Blue", "c.orange": "Orange", "c.lilac": "Lilac",
      ring: "Ring", "r.off": "Does not ring", "r.15m": "In 15 minutes", "r.1h": "In 1 hour", "r.evening": "In the evening at 20:00",
      "r.morning": "Tomorrow at 09:00", "r.custom": "At a time I pick…",
      vanish: "Vanish", "v.off": "Never", "v.1h": "In 1 hour", "v.today": "At the end of today",
      "v.tomorrow": "At the end of tomorrow", "v.week": "In a week", "v.custom": "At a time I pick…",
      onDone: "Also vanish when I press Done on the ring",
      rings: "Rings {when}", ringing: "Ringing since {when}", vanishes: "Vanishes {when}", vanishDone: "Vanishes when you press Done",
      past: "Pick a time in the future", full: "60 sticky notes are on the desktop. Delete one, or let one fade, first.",
      saveFail: "Could not save the sticky note: storage is full",
      "rel.min": "in {n} min", "rel.min1": "in 1 min", "rel.h": "in {n} h", "rel.h1": "in 1 h", "rel.ago1": "1 min ago", "rel.today": "today {t}", "rel.tomorrow": "tomorrow {t}",
      "rel.yesterday": "yesterday {t}", "rel.now": "now", "rel.ago": "{n} min ago",
      layer: "Sticky notes", strip: "Sticky notes",
      repeat: "Repeat", "rep.": "Once", "rep.daily": "Every day", "rep.weekdays": "Every weekday (Mon–Fri)", "rep.weekly": "Every week",
      "repf.daily": "every day", "repf.weekdays": "Mon–Fri", "repf.weekly": "every week",
      send: "Send to other apps", toTodo: "Send to To-Do", toNotes: "Copy to Notes", appName: "Sticky Notes",
      nothing: "Write something on the note first"
    },
    el: {
      note: "Post-it", "new": "Νέο post-it", tidy: "Τακτοποίηση των post-it", app: "Άνοιγμα της εφαρμογής Post-it",
      more: "Επιλογές για το post-it", fold: "Δίπλωμα", unfold: "Ξεδίπλωμα", ph: "Γράψε κάτι…",
      done: "Έγινε", snooze: "Ξανά σε 10 λεπτά", close: "Κλείσιμο", del: "Διαγραφή", undo: "Αναίρεση",
      deleted: "Το post-it διαγράφηκε", "note.empty": "(κενό)",
      color: "Χρώμα", text: "Κείμενο",
      "c.yellow": "Κίτρινο", "c.pink": "Ροζ", "c.green": "Πράσινο", "c.blue": "Μπλε", "c.orange": "Πορτοκαλί", "c.lilac": "Λιλά",
      ring: "Κουδούνισμα", "r.off": "Δεν χτυπάει", "r.15m": "Σε 15 λεπτά", "r.1h": "Σε 1 ώρα", "r.evening": "Το βράδυ στις 20:00",
      "r.morning": "Αύριο στις 09:00", "r.custom": "Σε ώρα που θα διαλέξω…",
      vanish: "Εξαφάνιση", "v.off": "Ποτέ", "v.1h": "Σε 1 ώρα", "v.today": "Στο τέλος της μέρας",
      "v.tomorrow": "Αύριο, στο τέλος της μέρας", "v.week": "Σε μία εβδομάδα", "v.custom": "Σε ώρα που θα διαλέξω…",
      onDone: "Να εξαφανιστεί και όταν πατήσω «Έγινε» στο κουδούνισμα",
      rings: "Χτυπάει {when}", ringing: "Χτυπάει από {when}", vanishes: "Εξαφανίζεται {when}", vanishDone: "Εξαφανίζεται όταν πατήσεις «Έγινε»",
      past: "Διάλεξε μια ώρα στο μέλλον", full: "Στην επιφάνεια υπάρχουν 60 post-it. Διάγραψε ένα ή άφησε κάποιο να ξεθωριάσει πρώτα.",
      saveFail: "Το post-it δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "rel.min": "σε {n} λεπτά", "rel.min1": "σε 1 λεπτό", "rel.h": "σε {n} ώρες", "rel.h1": "σε 1 ώρα", "rel.ago1": "πριν από 1 λεπτό", "rel.today": "σήμερα {t}", "rel.tomorrow": "αύριο {t}",
      "rel.yesterday": "χθες {t}", "rel.now": "τώρα", "rel.ago": "πριν από {n} λεπτά",
      layer: "Post-it", strip: "Post-it",
      repeat: "Επανάληψη", "rep.": "Μία φορά", "rep.daily": "Κάθε μέρα", "rep.weekdays": "Κάθε εργάσιμη (Δευ–Παρ)", "rep.weekly": "Κάθε εβδομάδα",
      "repf.daily": "κάθε μέρα", "repf.weekdays": "Δευ–Παρ", "repf.weekly": "κάθε εβδομάδα",
      send: "Αποστολή σε άλλες εφαρμογές", toTodo: "Αποστολή στις Εργασίες", toNotes: "Αντιγραφή στις Σημειώσεις", appName: "Post-it",
      nothing: "Γράψε πρώτα κάτι στο post-it"
    }
  };

  function env() { return root.orosStickiesEnv || null; }
  // orosI18n (../i18n.js, loaded by the shell): the full language
  // code, a pack language included; else the shell's "el" / "en".
  function lang() {
    var I = root.orosI18n;
    if (I) { try { return I.lang(); } catch (x) {} }
    var e = env(); try { return e && e.lang() === "el" ? "el" : "en"; } catch (x) { return "en"; }
  }
  // A pack language: English + the stickies pack. The shell loads only
  // its own pack, so this one is fetched on first need; once it is in,
  // the table is rebuilt and the next tick redraws the notes.
  var packAsked = {};
  function strings(l) {
    if (STRINGS[l]) return STRINGS[l];
    var I = root.orosI18n;
    if (!I) return STRINGS.en;
    var tab = I.table(STRINGS, "stickies", l);
    if (!packAsked[l] && typeof I.ensure === "function") {
      packAsked[l] = true;
      try { I.ensure(l, "stickies", function () { if (l !== "en" && l !== "el") delete STRINGS[l]; shownLang = ""; }); } catch (x) {}
    }
    return tab;
  }
  function T(k, p) {
    var tab = strings(lang()) || STRINGS.en;
    var s = tab[k] !== undefined ? tab[k] : (STRINGS.en[k] !== undefined ? STRINGS.en[k] : k);
    if (p) Object.keys(p).forEach(function (n) { s = s.split("{" + n + "}").join(String(p[n])); });
    return s;
  }
  function registered() { var e = env(); try { return !!(e && e.registered()); } catch (x) { return false; } }
  function running() { var e = env(); try { return !!(e && e.running()); } catch (x) { return false; } }
  function desktop() { return doc.getElementById("oros-desktop"); }
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function btn(cls, label, svg) {
    var b = el("button", cls);
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.title = label;
    if (svg) b.innerHTML = svg;                  // static markup from ICON only
    return b;
  }
  function locale() { var I = root.orosI18n; return I ? I.locale(lang()) : (lang() === "el" ? "el-GR" : "en-GB"); }
  function hm(d) {
    try { return d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", hour12: false }); }
    catch (e) { return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); }
  }
  // "in 5 min", "today 20:00", "tomorrow 09:00", "Mon 19/10 09:00"
  function when(ms, now) {
    var d = new Date(ms), diff = ms - now, n = new Date(now);
    if (diff >= 0 && diff < 60000) return T("rel.now");
    var mins = Math.ceil(diff / 60000), hrs = Math.round(diff / 3600000), ago = Math.max(1, Math.round(-diff / 60000));
    if (diff > 0 && mins < 60) return mins === 1 ? T("rel.min1") : T("rel.min", { n: mins });
    if (diff < 0 && ago < 60) return ago === 1 ? T("rel.ago1") : T("rel.ago", { n: ago });
    var day0 = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    var dd = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - day0) / 86400000 + 0.5);
    if (dd === 0) return diff > 0 && diff < 6 * 3600000 ? (hrs === 1 ? T("rel.h1") : T("rel.h", { n: hrs })) : T("rel.today", { t: hm(d) });
    if (dd === 1) return T("rel.tomorrow", { t: hm(d) });
    if (dd === -1) return T("rel.yesterday", { t: hm(d) });
    try {
      return d.toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "numeric" }).replace(",", "") + " " + hm(d);
    } catch (e) { return d.toISOString().slice(0, 16).replace("T", " "); }
  }
  function notify(text, action) {
    var N = root.orosNotifs;
    try {
      if (N && typeof N.transient === "function") {
        var c = { ns: "stickies", title: String(text) };
        if (action) c.action = action;
        N.transient(c);
      }
    } catch (e) {}
  }

  var ICON = {
    bell: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    glass: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 22h14M5 2h14M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2"/></svg>',
    more: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    fold: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
    unfold: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  // ---------- 2. Storage, slice, changes ----------
  var data = null;
  function readData() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {}
    if (raw) {
      try { return C.merge(JSON.parse(raw), null); }
      catch (e) {
        try { localStorage.setItem(KEY + "-broken", raw); } catch (x) {}
      }
    }
    return C.empty();
  }
  function cur() { if (!data) data = readData(); return data; }
  var saveFailShown = false;
  function writeData(d) {
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
      saveFailShown = false;
      return true;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; notify(T("saveFail")); }   // R30
      return false;
    }
  }
  function readJSON(key) {
    try { var o = JSON.parse(localStorage.getItem(key)); return o && typeof o === "object" ? o : null; }
    catch (e) { return null; }
  }
  function writeJSON(key, o) { try { localStorage.setItem(key, JSON.stringify(o)); } catch (e) {} }

  function prefs() {
    var p = readJSON(PREFS_KEY) || {};
    return {
      show: p.show !== false,
      sound: validSound(p.sound) ? p.sound : "bell",
      color: C.COLORS.indexOf(p.color) >= 0 ? p.color : "yellow",
      pop: p.pop === true
    };
  }
  function setPref(k, v) {
    var p = prefs();
    if (k === "show") p.show = v !== false;
    else if (k === "sound" && validSound(v)) { p.sound = v; if (RT_RE.test(v)) rtCore(); }
    else if (k === "color" && C.COLORS.indexOf(v) >= 0) p.color = v;
    else if (k === "pop") p.pop = v === true;
    else return false;
    writeJSON(PREFS_KEY, p);
    render();
    changed("prefs");
    return true;
  }

  var posCache = null;
  function positions() {
    if (!posCache) {
      var raw = readJSON(POS_KEY) || {};
      posCache = {};
      Object.keys(raw).forEach(function (id) { var p = C.normPos(raw[id]); if (p) posCache[id] = p; });
    }
    return posCache;
  }
  function savePositions() {
    var all = positions(), keep = {};
    C.live(cur()).forEach(function (n) { if (all[n.id]) keep[n.id] = all[n.id]; });
    posCache = keep;
    writeJSON(POS_KEY, keep);
  }
  var localCache = null;
  function local() {
    if (!localCache) {
      var o = readJSON(LOCAL_KEY) || {};
      localCache = { rung: o.rung && typeof o.rung === "object" && !Array.isArray(o.rung) ? o.rung : {} };
    }
    return localCache;
  }

  var listeners = [];
  function changed(why) { listeners.slice().forEach(function (fn) { try { fn(why); } catch (e) {} }); }

  // Every change goes through here: write, mark dirty, redraw.
  function commit(next) {
    var before = JSON.stringify(cur());
    if (JSON.stringify(next) === before) return true;
    if (!writeData(next)) return false;
    data = next;
    var s = root.orosSync;
    if (s && typeof s.markDirty === "function") s.markDirty();
    nextAt = -1;
    render();
    syncEditor();
    changed("data");
    return true;
  }

  function sliceGet() { flushText(); return C.merge(cur(), null); }      // canonical (R26)
  function sliceSet(incoming) {                                           // R6: never marks dirty
    if (!incoming || typeof incoming !== "object") return;
    var next = C.merge(incoming, null);
    if (JSON.stringify(next) === JSON.stringify(cur())) return;
    writeData(next);
    data = next;
    nextAt = -1;
    render();
    syncEditor();
    changed("data");
  }
  function registerSlice() {
    var s = root.orosSync;
    if (!s || typeof s.registerSlice !== "function") { setTimeout(registerSlice, 100); return; }
    // No storage key: this module is always live in the shell.
    s.registerSlice("stickies", sliceGet, sliceSet, null, C.merge);
  }

  // ---------- 3. Sound ----------
  var audio = null;
  function ctx() {
    if (audio) return audio;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try { audio = new AC(); } catch (e) { audio = null; }
    return audio;
  }
  function volume() {
    var N = root.orosNotifs, v = 0.7;
    try { if (N && typeof N.getSetting === "function") v = +N.getSetting("soundVolume", 0.7); } catch (e) {}
    return Math.max(0, Math.min(1, isFinite(v) ? v : 0.7)) * 0.35;
  }
  function tone(a, f, t0, dur, type, peak) {
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || "sine";
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  // ---- Ringtone Composer melodies (read only) ----
  var rtWait = null;
  function rtCore() {
    if (root.RingtonesCore) return Promise.resolve(root.RingtonesCore);
    if (rtWait) return rtWait;
    rtWait = new Promise(function (resolve) {
      var sc = doc.createElement("script");
      sc.src = RT_SRC;
      sc.onload = function () { resolve(root.RingtonesCore || null); };
      sc.onerror = function () { rtWait = null; resolve(null); };
      doc.head.appendChild(sc);
    });
    return rtWait;
  }
  function rtRead() {
    try { return JSON.parse(localStorage.getItem(RT_KEY) || "null"); } catch (e) { return null; }
  }
  // [{ id, name }] newest first, without the deleted ones. Light check
  // here (no core needed); playing goes through the core's own merge.
  function melodies() {
    var d = rtRead(), out = [];
    if (!d || !Array.isArray(d.melodies)) return out;
    var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
    d.melodies.forEach(function (m) {
      if (!m || typeof m.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(m.id) || typeof m.m !== "number") return;
      if (typeof tombs[m.id] === "number" && tombs[m.id] >= m.m) return;
      out.push({ id: m.id, name: String(m.name || "").replace(/\s+/g, " ").trim().slice(0, 60), m: m.m });
    });
    out.sort(function (x, y) { return y.m - x.m || (x.id < y.id ? -1 : 1); });
    return out.map(function (m) { return { id: m.id, name: m.name }; });
  }
  var rtNode = null;
  function stopMelody() { if (rtNode) { try { rtNode.stop(); } catch (e) {} rtNode = null; } }
  // fb: what plays instead when the melody is gone (the bell); maxS:
  // where a long melody fades out (RT_MAX_S)
  function playMelody(id, fb, maxS) {
    rtCore().then(function (R) {
      var raw = rtRead(), m = null;
      try { if (R && raw) m = R.findMelody(R.mergeRingtones(raw, null), id); } catch (e) { m = null; }
      if (!m) { if (typeof fb === "function") fb(); else play("bell"); return; }   // gone (or no core)
      var a = ctx();
      if (!a) return;
      try {
        if (a.state === "suspended") a.resume().catch(function () {});
        var v = volume();
        if (!v) return;
        var rate = 22050, smp = R.renderSamples(R.parseNotes(m.notes), m.bpm, m.voice, rate);
        var max = rate * Math.min(RT_MAX_S, maxS > 0 ? maxS : RT_MAX_S);
        if (smp.length > max) {                         // a soft end instead of a cut
          smp = smp.subarray(0, max);
          for (var i = 0, f = Math.round(rate * 0.4); i < f; i++) smp[max - f + i] *= 1 - i / f;
        }
        var buf = a.createBuffer(1, smp.length, rate);
        if (buf.copyToChannel) buf.copyToChannel(smp, 0); else buf.getChannelData(0).set(smp);
        var src = a.createBufferSource(), g = a.createGain();
        g.gain.value = Math.min(1, v * 2.2);
        src.buffer = buf;
        src.connect(g); g.connect(a.destination);
        stopMelody();
        rtNode = src;
        src.onended = function () { if (rtNode === src) rtNode = null; };
        src.start(a.currentTime + 0.03);
      } catch (e) {}
    });
  }

  function play(kind) {
    if (kind === "off") return;
    if (RT_RE.test(String(kind))) { playMelody(String(kind).slice(3)); return; }
    var a = ctx();
    if (!a) return;
    try {
      if (a.state === "suspended") a.resume().catch(function () {});
      var t = a.currentTime + 0.03, v = volume();
      if (!v) return;
      if (kind === "dingdong") {
        tone(a, 659.25, t, 1.1, "sine", v); tone(a, 1318.5, t, 0.5, "sine", v * 0.25);
        tone(a, 523.25, t + 0.55, 1.4, "sine", v); tone(a, 1046.5, t + 0.55, 0.6, "sine", v * 0.25);
      } else if (kind === "wind") {
        [1046.5, 1318.5, 1568, 1174.7, 1760, 1396.9].forEach(function (f, i) {
          tone(a, f, t + i * 0.16 + (i % 2) * 0.05, 1.3, "triangle", v * 0.45);
        });
      } else if (kind === "pop") {
        var o = a.createOscillator(), g = a.createGain();
        o.frequency.setValueAtTime(700, t); o.frequency.exponentialRampToValueAtTime(260, t + 0.12);
        g.gain.setValueAtTime(v * 0.6, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
        o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 0.16);
      } else {                                   // bell: a struck bell, twice
        [0, 0.9].forEach(function (d) {
          tone(a, 1046.5, t + d, 1.6, "sine", v);
          tone(a, 1046.5 * 2.76, t + d, 0.7, "sine", v * 0.3);
          tone(a, 1046.5 * 5.4, t + d, 0.3, "sine", v * 0.12);
        });
      }
    } catch (e) { /* no sound: the wiggle and the inbox item stand alone */ }
  }
  // Same rule as the inbox: notifications on, Sticky Notes on, no quiet hours.
  function soundAllowed(now) {
    var N = root.orosNotifs;
    if (!N) return true;
    try {
      if (typeof N.getSetting === "function" && N.getSetting("enabled", true) === false) return false;
      if (typeof N.getAppToggle === "function" && !N.getAppToggle("stickies")) return false;
      var qh = typeof N.getSetting === "function" ? N.getSetting("quietHours", {}) : {};
      if (qh && qh.enabled) {
        var h = new Date(now).getHours(), s = qh.quietHoursStart, e = qh.quietHoursEnd;
        s = typeof s === "number" ? s : 22; e = typeof e === "number" ? e : 8;
        if (s <= e ? (h >= s && h < e) : (h >= s || h < e)) return false;
      }
    } catch (x) {}
    return true;
  }
  // A browser lets sound start only after a tap or a key on the page:
  // every gesture wakes the audio up while a ring is waiting.
  function unlockAudio() {
    var d = cur(), now = Date.now();
    var waiting = C.live(d).some(function (n) { return n.ring && n.ring.at - now < 6 * 3600000; });
    if (!waiting) return;
    var a = ctx();
    try { if (a && a.state === "suspended") a.resume().catch(function () {}); } catch (e) {}
  }

  // ---------- 4. Desktop ----------
  var CSS = [
    "#sn-layer{position:fixed;top:calc(40px + env(safe-area-inset-top,0px));left:0;right:0;bottom:var(--tb-h,0px);",
    "z-index:2;pointer-events:none}",
    ".sn-note{position:absolute;display:flex;flex-direction:column;pointer-events:auto;border-radius:4px 4px 10px 4px;",
    "box-shadow:0 6px 18px rgba(0,0,0,.28),0 1px 2px rgba(0,0,0,.2);color:#2b2620;overflow:hidden;",
    "font:14px/1.4 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;transition:opacity .9s,transform .9s}",
    ".sn-note.sn-out,.sn-card.sn-out{opacity:0;transform:scale(.9) rotate(-2deg)}",
    ".sn-c-yellow{background:#fff3a6}.sn-c-pink{background:#ffc9de}.sn-c-green{background:#c8f0c0}",
    ".sn-c-blue{background:#c4e2ff}.sn-c-orange{background:#ffd4a8}.sn-c-lilac{background:#e2d2ff}",
    ":root[data-theme=dark] .sn-c-yellow{background:#ecdc84}:root[data-theme=dark] .sn-c-pink{background:#ebb2c8}",
    ":root[data-theme=dark] .sn-c-green{background:#b0d9a8}:root[data-theme=dark] .sn-c-blue{background:#a9cbec}",
    ":root[data-theme=dark] .sn-c-orange{background:#ebbd8f}:root[data-theme=dark] .sn-c-lilac{background:#ccbaf0}",
    ".sn-bar{display:flex;align-items:center;gap:2px;min-height:34px;padding:0 2px 0 8px;cursor:grab;",
    "background:rgba(0,0,0,.06);touch-action:none;-webkit-user-select:none;user-select:none}",
    ".sn-bar.sn-drag{cursor:grabbing}",
    ".sn-bar .sn-title{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:600;font-size:13px}",
    ".sn-flags{display:flex;align-items:center;gap:6px;flex:1;min-width:0;font-size:12px;opacity:.8;overflow:hidden}",
    ".sn-flag{display:inline-flex;align-items:center;gap:3px;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}",
    ".sn-flag svg{flex:none}",
    ".sn-ib{width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;flex:none;",
    "border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;opacity:.75}",
    ".sn-ib:hover,.sn-ib:focus-visible{background:rgba(0,0,0,.1);opacity:1}",
    ".sn-body{flex:1;min-height:0;overflow:auto;padding:6px 10px 10px;white-space:pre-wrap;overflow-wrap:anywhere;cursor:text;outline:none}",
    ".sn-body:focus-visible{box-shadow:inset 0 0 0 2px rgba(0,0,0,.35)}",
    ".sn-body .sn-ph{opacity:.5}",
    ".sn-line{min-height:1.4em}",
    ".sn-box{display:flex;gap:6px;align-items:flex-start}",
    ".sn-box input{margin:3px 0 0;width:16px;height:16px;flex:none;accent-color:#4a4030;cursor:pointer}",
    ".sn-box.sn-done span{text-decoration:line-through;opacity:.6}",
    ".sn-ta{flex:1;min-height:0;resize:none;border:0;outline:none;background:transparent;color:inherit;",
    "font:inherit;padding:6px 10px 10px;box-shadow:inset 0 0 0 2px rgba(0,0,0,.25)}",
    ".sn-ringbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 8px;background:rgba(0,0,0,.1);font-size:12px}",
    ".sn-ringbar span{flex:1;min-width:0;font-weight:600;display:inline-flex;align-items:center;gap:4px;white-space:nowrap}",
    ".sn-act{min-height:32px;padding:0 10px;border:1px solid rgba(0,0,0,.3);border-radius:7px;background:rgba(255,255,255,.55);",
    "color:#2b2620;font:600 12px system-ui,sans-serif;cursor:pointer}",
    ".sn-act:hover,.sn-act:focus-visible{background:rgba(255,255,255,.85)}",
    ".sn-rz{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;touch-action:none;",
    "background:linear-gradient(135deg,transparent 50%,rgba(0,0,0,.18) 50%)}",
    ".sn-ringing{animation:sn-wiggle 1.2s ease-in-out 3;outline:3px solid var(--accent,#e5a50a);outline-offset:2px}",
    ".sn-flash{animation:sn-flash .9s ease-in-out 2}",
    "@keyframes sn-wiggle{0%,100%{transform:rotate(0)}15%{transform:rotate(-3deg)}30%{transform:rotate(3deg)}45%{transform:rotate(-2deg)}60%{transform:rotate(2deg)}75%{transform:rotate(0)}}",
    "@keyframes sn-flash{50%{box-shadow:0 0 0 4px var(--accent,#e5a50a),0 6px 18px rgba(0,0,0,.28)}}",
    "#sn-add{position:fixed;left:14px;bottom:calc(var(--tb-h,0px) + 14px + env(safe-area-inset-bottom,0px));z-index:3;",
    "width:40px;height:40px;border-radius:50%;border:1px solid var(--border);background:color-mix(in srgb,var(--panel-bg) 80%,transparent);",
    "color:var(--accent);display:flex;align-items:center;justify-content:center;cursor:pointer;pointer-events:auto;",
    "box-shadow:0 2px 8px var(--shadow);opacity:.75}",
    "#sn-add:hover,#sn-add:focus-visible{opacity:1}",
    // narrow: a row of cards at the top of the desktop
    "#sn-strip{display:flex;gap:10px;overflow-x:auto;padding:12px 10px 4px;scroll-snap-type:x proximity;scroll-padding:0 10px;",
    "scrollbar-width:thin;-webkit-overflow-scrolling:touch}",
    ".sn-card{flex:none;width:150px;min-height:92px;scroll-snap-align:start;display:flex;flex-direction:column;",
    "border-radius:4px 4px 10px 4px;box-shadow:0 4px 12px rgba(0,0,0,.25);color:#2b2620;overflow:hidden;transition:opacity .9s,transform .9s}",
    ".sn-card>button.sn-open{flex:1;display:block;text-align:left;border:0;background:transparent;color:inherit;padding:8px 10px;",
    "font:13px/1.35 system-ui,sans-serif;cursor:pointer;min-height:44px}",
    ".sn-card .sn-txt{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere}",
    ".sn-card .sn-flags{margin-top:6px}",
    ".sn-card .sn-ringbar{padding:6px}",
    ".sn-card.sn-ringing{outline-offset:-3px}",
    ".sn-addcard{flex:none;width:44px;scroll-snap-align:start;align-self:stretch;min-height:92px;border:1px dashed var(--border);border-radius:10px;",
    "background:color-mix(in srgb,var(--panel-bg) 60%,transparent);color:var(--accent);display:flex;align-items:center;justify-content:center;cursor:pointer}",
    // menu
    ".sn-menu{position:fixed;z-index:1100;min-width:210px;max-width:calc(100vw - 16px);padding:4px;background:var(--panel-bg);",
    "color:var(--text);border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 24px var(--shadow)}",
    ".sn-menu button{display:block;width:100%;text-align:left;min-height:40px;padding:0 12px;border:0;border-radius:7px;",
    "background:transparent;color:var(--text);font-size:14px;cursor:pointer}",
    ".sn-menu button:hover,.sn-menu button:focus-visible{background:var(--accent-soft)}",
    // editor
    "#sn-sheet{border:1px solid var(--border);border-radius:12px;background:var(--panel-bg);color:var(--text);padding:0;",
    "width:min(420px,calc(100vw - 24px));max-height:calc(100dvh - 24px)}",
    "#sn-sheet::backdrop{background:rgba(0,0,0,.45)}",
    "#sn-sheet .sn-sh{display:flex;align-items:center;gap:8px;padding:10px 10px 10px 16px;border-bottom:1px solid var(--border)}",
    "#sn-sheet .sn-sh h2{flex:1;margin:0;font-size:16px}",
    "#sn-sheet .sn-sc{padding:12px 16px;display:flex;flex-direction:column;gap:12px}",
    "#sn-sheet textarea{width:100%;box-sizing:border-box;min-height:110px;resize:vertical;border:1px solid rgba(0,0,0,.2);border-radius:8px;",
    "padding:10px;font:15px/1.4 system-ui,sans-serif;color:#2b2620}",
    "#sn-sheet .sn-lbl{font-size:12px;font-weight:600;color:var(--text-dim);margin-bottom:6px;display:block}",
    "#sn-sheet .sn-sw{display:flex;gap:8px;flex-wrap:wrap}",
    "#sn-sheet .sn-sw button{width:36px;height:36px;border-radius:50%;border:2px solid rgba(0,0,0,.2);cursor:pointer}",
    "#sn-sheet .sn-sw button[aria-pressed=true]{border-color:var(--text);box-shadow:0 0 0 2px var(--accent)}",
    "#sn-sheet select,#sn-sheet input[type=datetime-local]{min-height:40px;width:100%;box-sizing:border-box;padding:0 8px;",
    "border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px}",
    "#sn-sheet input[type=datetime-local]{margin-top:6px}",
    "#sn-sheet .sn-st{font-size:12px;color:var(--text-dim);margin-top:4px;min-height:1em}",
    "#sn-sheet .sn-cb{display:flex;gap:8px;align-items:flex-start;font-size:13px;margin-top:8px}",
    "#sn-sheet .sn-cb input{margin-top:2px;width:18px;height:18px;flex:none}",
    "#sn-sheet .sn-sf{display:flex;gap:8px;justify-content:space-between;padding:10px 16px 14px;border-top:1px solid var(--border)}",
    "#sn-sheet .sn-btn{min-height:40px;padding:0 16px;border:1px solid var(--border);border-radius:8px;background:transparent;",
    "color:var(--text);font-size:14px;cursor:pointer}",
    "#sn-sheet .sn-btn.sn-pri{background:var(--accent);border-color:var(--accent);color:var(--bg)}",
    "#sn-sheet .sn-btn.sn-danger{color:var(--danger,#d9534f);border-color:var(--danger,#d9534f)}",
    "#sn-sheet .sn-ringnow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 10px;border-radius:8px;",
    "background:var(--accent-soft);font-size:13px;font-weight:600}",
    "#sn-sheet .sn-ringnow span{flex:1}",
    "#sn-sheet .sn-rep{margin-top:8px}",
    "#sn-sheet .sn-links{display:flex;gap:8px;flex-wrap:wrap}",
    "#sn-sheet .sn-links .sn-btn{flex:1 1 auto}",
    "@media (prefers-reduced-motion:reduce){.sn-ringing,.sn-flash{animation:none}.sn-note,.sn-card{transition:none}}",
    "[hidden]{display:none!important}"
  ].join("\n");
  function injectCss() {
    if (doc.getElementById("sn-css")) return;
    var s = el("style");
    s.id = "sn-css";
    s.textContent = CSS;
    doc.head.appendChild(s);
  }

  var mq = root.matchMedia ? root.matchMedia(NARROW_Q) : null;
  function narrow() { return !!(mq && mq.matches); }

  var editing = null;      // { id, ta } while a note's text is typed in place
  var textTimer = null;
  var shownLang = "";
  var ringingNow = {};     // id → true while the note shows its ring bar

  function sizeOf(layer) {
    return { W: layer.clientWidth || root.innerWidth, H: layer.clientHeight || (root.innerHeight - 40) };
  }
  function posFor(n, W, H) {
    var all = positions(), p = all[n.id];
    if (!p) {
      var boxes = [];
      C.live(cur()).forEach(function (m) { if (all[m.id]) boxes.push(C.box(all[m.id], W, H)); });
      var s = C.SIZE, spot = C.place(boxes, W, H, s.w, s.h);
      p = { x: spot.x, y: spot.y, w: s.w, h: s.h, z: topZ() + 1, fold: false };
      all[n.id] = p;
      savePositions();
    }
    return p;
  }
  function topZ() {
    var z = 0, all = positions();
    Object.keys(all).forEach(function (id) { if (all[id].z > z) z = all[id].z; });
    return z;
  }
  function raise(id) {
    var all = positions(), p = all[id];
    if (!p) return;
    var z = topZ();
    if (p.z === z && z > 0) return;
    p.z = z + 1;
    if (p.z > 5000) {                            // renumber now and then
      Object.keys(all).sort(function (a, b) { return all[a].z - all[b].z; }).forEach(function (k, i) { all[k].z = i + 1; });
    }
    savePositions();
    var node = doc.querySelector('#sn-layer [data-id="' + cssId(id) + '"]');
    if (node) node.style.zIndex = String(all[id].z);
  }
  function cssId(id) { return C.ID_RE.test(id) ? id : ""; }

  function flagsFor(n, now) {
    var f = el("span", "sn-flags");
    if (n.ring) {
      var r = el("span", "sn-flag");
      r.innerHTML = ICON.bell;
      r.appendChild(doc.createTextNode(when(n.ring.at, now) + (n.ring.rep ? " ↻" : "")));
      r.title = T(n.ring.at <= now ? "ringing" : "rings", { when: when(n.ring.at, now) }) + (n.ring.rep ? " · " + T("repf." + n.ring.rep) : "");
      f.appendChild(r);
    }
    if (n.vanish) {
      var v = el("span", "sn-flag");
      v.innerHTML = ICON.glass;
      if (n.vanish.at) v.appendChild(doc.createTextNode(when(n.vanish.at, now)));
      v.title = n.vanish.at ? T("vanishes", { when: when(n.vanish.at, now) }) : T("vanishDone");
      f.appendChild(v);
    }
    return f;
  }
  function ringBar(n, now) {
    var bar = el("div", "sn-ringbar");
    var s = el("span");
    s.innerHTML = ICON.bell;
    s.appendChild(doc.createTextNode(hm(new Date(n.ring.at))));
    bar.appendChild(s);
    var d = el("button", "sn-act", T("done"));
    d.type = "button";
    d.addEventListener("click", function (e) { e.stopPropagation(); answer(n.id, "done"); });
    var z = el("button", "sn-act", T("snooze"));
    z.type = "button";
    z.addEventListener("click", function (e) { e.stopPropagation(); answer(n.id, "snooze"); });
    bar.appendChild(d);
    bar.appendChild(z);
    return bar;
  }
  function answer(id, how) {
    var now = Date.now();
    commit(how === "done" ? C.ringDone(cur(), id, now) : C.snooze(cur(), id, now));
  }

  function bodyFor(n) {
    var b = el("div", "sn-body");
    b.tabIndex = 0;
    b.setAttribute("role", "button");
    b.setAttribute("aria-label", T("note") + ": " + (C.firstLine(n.text) || T("note.empty")));
    if (!n.text) { b.appendChild(el("span", "sn-ph", T("ph"))); return b; }
    C.lines(n.text).forEach(function (l, i) {
      if (!l.box) { b.appendChild(el("div", "sn-line", l.text)); return; }
      var row = el("label", "sn-box" + (l.done ? " sn-done" : ""));
      var cb = el("input");
      cb.type = "checkbox";
      cb.checked = l.done;
      cb.addEventListener("click", function (e) { e.stopPropagation(); });
      cb.addEventListener("change", function () { commit(C.setText(cur(), n.id, C.toggleLine(n.text, i), Date.now())); });
      row.appendChild(cb);
      row.appendChild(el("span", "", l.text));
      row.addEventListener("click", function (e) { e.stopPropagation(); });
      b.appendChild(row);
    });
    return b;
  }

  function buildNote(n, W, H, now) {
    var p = posFor(n, W, H), bx = C.box(p, W, H);
    var node = el("div", "sn-note sn-c-" + n.color + (C.isRinging(n, now) ? " sn-ringing" : ""));
    node.setAttribute("data-id", n.id);
    node.setAttribute("role", "group");
    node.setAttribute("aria-label", T("note"));
    node.style.left = bx.left + "px";
    node.style.top = bx.top + "px";
    node.style.width = bx.w + "px";
    node.style.height = bx.h + "px";
    node.style.zIndex = String(p.z);
    var bar = el("div", "sn-bar");
    if (p.fold) bar.appendChild(el("span", "sn-title", C.firstLine(n.text) || T("note")));
    else bar.appendChild(flagsFor(n, now));
    var fb = btn("sn-ib", p.fold ? T("unfold") : T("fold"), p.fold ? ICON.unfold : ICON.fold);
    fb.addEventListener("click", function (e) { e.stopPropagation(); setFold(n.id, !p.fold); });
    var mb = btn("sn-ib", T("more"), ICON.more);
    mb.addEventListener("click", function (e) { e.stopPropagation(); openEditor(n.id); });
    bar.appendChild(fb);
    bar.appendChild(mb);
    node.appendChild(bar);
    wireDrag(bar, node, n.id);
    node.addEventListener("pointerdown", function (e) {
      if (editing && editing.id === n.id && e.target && e.target.closest && e.target.closest(".sn-bar button")) holdEdit();
      raise(n.id);
    });
    if (!p.fold) {
      var body = bodyFor(n);
      body.addEventListener("click", function () { startEdit(n.id, node, body); });
      body.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startEdit(n.id, node, body); }
      });
      node.appendChild(body);
      if (C.isRinging(n, now)) node.appendChild(ringBar(n, now));
      var rz = el("div", "sn-rz");
      rz.setAttribute("aria-hidden", "true");
      wireResize(rz, node, n.id);
      node.appendChild(rz);
    } else if (C.isRinging(n, now)) {
      node.style.height = "";
      node.appendChild(ringBar(n, now));
    }
    return node;
  }

  function buildCard(n, now) {
    var card = el("div", "sn-card sn-c-" + n.color + (C.isRinging(n, now) ? " sn-ringing" : ""));
    card.setAttribute("data-id", n.id);
    card.setAttribute("role", "listitem");
    var open = el("button", "sn-open");
    open.type = "button";
    open.appendChild(el("div", "sn-txt", n.text ? C.lines(n.text).map(function (l) {
      return l.box ? (l.done ? "☑ " : "☐ ") + l.text : l.text;
    }).join("\n") : T("note.empty")));
    if (n.ring || n.vanish) open.appendChild(flagsFor(n, now));
    open.setAttribute("aria-label", T("note") + ": " + (C.firstLine(n.text) || T("note.empty")));
    open.addEventListener("click", function () { openEditor(n.id); });
    card.appendChild(open);
    if (C.isRinging(n, now)) card.appendChild(ringBar(n, now));
    return card;
  }

  function clearDesktop() {
    ["sn-layer", "sn-strip", "sn-add"].forEach(function (id) { var x = doc.getElementById(id); if (x) x.remove(); });
  }

  var fading = {};         // id → true while its fade-out plays
  function render() {
    var desk = desktop();
    if (!desk || !doc.body) return;
    if (!registered() || !prefs().show) { stopEdit(true); clearDesktop(); return; }
    injectCss();
    shownLang = lang();
    var now = Date.now();
    var notes = C.newestFirst(C.live(cur())).filter(function (n) { return !fading[n.id]; });
    ringingNow = {};
    notes.forEach(function (n) { if (C.isRinging(n, now)) ringingNow[n.id] = true; });
    if (narrow()) {
      stopEdit(true);
      ["sn-layer", "sn-add"].forEach(function (id) { var x = doc.getElementById(id); if (x) x.remove(); });
      var strip = doc.getElementById("sn-strip");
      if (!notes.length) { if (strip) strip.remove(); return; }
      if (!strip) {
        strip = el("div");
        strip.id = "sn-strip";
        strip.setAttribute("role", "list");
      }
      if (desk.firstChild !== strip) desk.insertBefore(strip, desk.firstChild);
      strip.setAttribute("aria-label", T("strip"));
      var sl = strip.scrollLeft;
      strip.textContent = "";
      var add = btn("sn-addcard", T("new"), ICON.plus);
      add.addEventListener("click", function () { newNote(); });
      strip.appendChild(add);
      notes.sort(function (a, b) { return (ringingNow[b.id] ? 1 : 0) - (ringingNow[a.id] ? 1 : 0); })
        .forEach(function (n) { strip.appendChild(buildCard(n, now)); });
      strip.scrollLeft = sl;
      return;
    }
    var s0 = doc.getElementById("sn-strip");
    if (s0) s0.remove();
    var layer = doc.getElementById("sn-layer");
    if (!layer) {
      layer = el("div");
      layer.id = "sn-layer";
      desk.appendChild(layer);
    }
    layer.setAttribute("aria-label", T("layer"));
    var addB = doc.getElementById("sn-add");
    if (!addB) {
      addB = btn("", T("new"), ICON.plus);
      addB.id = "sn-add";
      addB.addEventListener("click", function () { newNote(); });
      desk.appendChild(addB);
    } else { addB.setAttribute("aria-label", T("new")); addB.title = T("new"); }
    var sz = sizeOf(layer), keep = {};
    notes.slice().reverse().forEach(function (n) {
      keep[n.id] = true;
      var old = layer.querySelector('[data-id="' + cssId(n.id) + '"]');
      if (editing && editing.id === n.id && old) {           // keep the note being typed in
        var p = positions()[n.id], bx = p ? C.box(p, sz.W, sz.H) : null;
        if (bx) { old.style.left = bx.left + "px"; old.style.top = bx.top + "px"; }
        old.className = "sn-note sn-c-" + n.color + (ringingNow[n.id] ? " sn-ringing" : "");
        return;
      }
      var node = buildNote(n, sz.W, sz.H, now);
      if (old) {
        if (old.classList.contains("sn-ringing") && ringingNow[n.id]) node.style.animation = "none";   // wiggle once
        layer.replaceChild(node, old);
      } else layer.appendChild(node);
    });
    [].slice.call(layer.children).forEach(function (c) {
      if (!keep[c.getAttribute("data-id")]) c.remove();
    });
  }

  // In-place typing (wide screens).
  function startEdit(id, node, body) {
    if (editing && editing.id === id) return;
    stopEdit();
    var n = C.find(cur(), id);
    if (!n) return;
    var ta = el("textarea", "sn-ta");
    ta.value = n.text;
    ta.placeholder = T("ph");
    ta.setAttribute("aria-label", T("text"));
    ta.maxLength = C.MAX_LEN * 2;
    editing = { id: id, ta: ta, blank: !n.text };
    body.replaceWith(ta);
    ta.addEventListener("input", function () {
      clearTimeout(textTimer);
      textTimer = setTimeout(flushText, SAVE_MS);
    });
    ta.addEventListener("blur", function () { setTimeout(function () { if (editing && editing.ta === ta && !editing.hold && doc.activeElement !== ta) stopEdit(); }, 0); });
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); stopEdit(); }
    });
    try { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {}
    raise(id);
  }
  function flushText() {
    clearTimeout(textTimer); textTimer = null;
    if (!editing) return;
    var n = C.find(cur(), editing.id);
    if (n && C.cleanText(editing.ta.value) !== n.text) commit(C.setText(cur(), editing.id, editing.ta.value, Date.now()));
  }
  // A press on the note's own Fold / More button blurs the text box
  // before the click arrives. Ending the edit there would redraw the
  // note (the click is lost) and remove a still empty new note, so the
  // button's click ends the edit itself; a press that never becomes a
  // click (dragged off) ends it shortly after the pointer is let go.
  function holdEdit() {
    var ed = editing;
    ed.hold = true;
    function up() {
      doc.removeEventListener("pointerup", up, true);
      doc.removeEventListener("pointercancel", up, true);
      setTimeout(function () {
        if (editing !== ed || !ed.hold) return;
        ed.hold = false;
        if (doc.activeElement !== ed.ta) stopEdit();
      }, 700);
    }
    doc.addEventListener("pointerup", up, true);
    doc.addEventListener("pointercancel", up, true);
  }
  // quiet: the layer is being torn down (no redraw).
  // keep: a Fold / More press ends the edit; an empty new note stays.
  function stopEdit(quiet, keep) {
    if (!editing) return;
    var ed = editing;
    editing = null;
    if (ed.ta.isConnected !== false) {
      var n0 = C.find(cur(), ed.id);
      clearTimeout(textTimer); textTimer = null;
      if (n0 && C.cleanText(ed.ta.value) !== n0.text) commit(C.setText(cur(), ed.id, ed.ta.value, Date.now()));
    }
    var id = ed.id, wasBlank = ed.blank;
    var n = C.find(cur(), id);
    if (n && !n.text && wasBlank && !keep && !n.ring && !n.vanish) { commit(C.remove(cur(), id, Date.now())); return; }   // an empty new note goes away
    if (!quiet) render();
  }

  function setFold(id, on) {
    var all = positions();
    if (!all[id]) return;
    if (editing && editing.id === id) stopEdit(true, true);
    all[id].fold = !!on;
    savePositions();
    render();
  }

  // Desktop menu: right-click or long press on an empty spot.
  var menu = null;
  function closeMenu() { if (menu) { menu.remove(); menu = null; } }
  function openMenu(x, y) {
    closeMenu();
    menu = el("div", "sn-menu");
    menu.setAttribute("role", "menu");
    function item(label, fn) {
      var b = el("button", "", label);
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.addEventListener("click", function () { closeMenu(); fn(); });
      menu.appendChild(b);
      return b;
    }
    var first = item(T("new"), function () { newNote({ x: x, y: y }); });
    if (!narrow() && C.live(cur()).length > 1 && prefs().show) item(T("tidy"), tidy);
    item(T("app"), function () { var e = env(); if (e) e.open("stickies"); });
    doc.body.appendChild(menu);
    var r = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, root.innerWidth - r.width - 8)) + "px";
    menu.style.top = Math.max(8, Math.min(y, root.innerHeight - r.height - 8)) + "px";
    first.focus();
    menu.addEventListener("keydown", function (e) {
      var items = [].slice.call(menu.querySelectorAll("button")), i = items.indexOf(doc.activeElement);
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    });
  }
  // The shell's desktop menu (quickmenu.js) shows these items and owns
  // the right-click; without it this module opens its own menu.
  (root.__orosDeskItems = root.__orosDeskItems || []).push(function (x, y) {
    if (!registered()) return [];
    var out = [{ label: T("new"), run: function () { newNote({ x: x, y: y }); } }];
    if (!narrow() && C.live(cur()).length > 1 && prefs().show) out.push({ label: T("tidy"), run: tidy });
    out.push({ label: T("app"), run: function () { var e = env(); if (e) e.open("stickies"); } });
    return out;
  });
  function onContextMenu(e) {
    if (!registered()) return;
    if (root.orosQuick && root.orosQuick.ownsDesktop()) return;
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest(".ld-ic, .sn-note, .sn-card, .sn-addcard, #sn-add, #ld-dock, input, textarea, button, a")) return;
    if (!t.closest("#oros-desktop")) return;
    e.preventDefault();
    openMenu(e.clientX, e.clientY);
  }

  // ---------- 5. Drag + resize ----------
  function wireDrag(handle, node, id) {
    handle.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || (e.target.closest && e.target.closest("button"))) return;
      var layer = doc.getElementById("sn-layer");
      if (!layer) return;
      e.preventDefault();
      var sz = sizeOf(layer), sx = e.clientX, sy = e.clientY;
      var l0 = node.offsetLeft, t0 = node.offsetTop, moved = false;
      handle.classList.add("sn-drag");
      try { handle.setPointerCapture(e.pointerId); } catch (x) {}
      function move(ev) {
        var dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
        moved = true;
        node.style.left = Math.max(0, Math.min(sz.W - node.offsetWidth, l0 + dx)) + "px";
        node.style.top = Math.max(0, Math.min(sz.H - node.offsetHeight, t0 + dy)) + "px";
      }
      function up() {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        handle.classList.remove("sn-drag");
        if (!moved) return;
        var p = positions()[id];
        if (!p) return;
        p.x = sz.W ? node.offsetLeft / sz.W : 0;
        p.y = sz.H ? node.offsetTop / sz.H : 0;
        savePositions();
      }
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
  }
  function wireResize(handle, node, id) {
    handle.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      var sx = e.clientX, sy = e.clientY, w0 = node.offsetWidth, h0 = node.offsetHeight;
      try { handle.setPointerCapture(e.pointerId); } catch (x) {}
      function move(ev) {
        var s = C.clampSize(w0 + ev.clientX - sx, h0 + ev.clientY - sy);
        node.style.width = s.w + "px";
        node.style.height = s.h + "px";
      }
      function up() {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        var p = positions()[id];
        if (!p) return;
        var s = C.clampSize(node.offsetWidth, node.offsetHeight);
        p.w = s.w; p.h = s.h;
        savePositions();
        render();
      }
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
  }

  function tidy() {
    var layer = doc.getElementById("sn-layer");
    if (!layer) return;
    var sz = sizeOf(layer), all = positions(), ids = C.newestFirst(C.live(cur())).map(function (n) { return n.id; }), sizes = {};
    ids.forEach(function (id) {
      var p = all[id];
      sizes[id] = p ? { w: p.w, h: p.fold ? C.SIZE.fold : p.h } : { w: C.SIZE.w, h: C.SIZE.h };
    });
    var spots = C.tidy(ids, sizes, sz.W, sz.H);
    ids.forEach(function (id, i) {
      var p = all[id] || { w: C.SIZE.w, h: C.SIZE.h, fold: false };
      p.x = spots[id].x; p.y = spots[id].y; p.z = ids.length - i;
      all[id] = p;
    });
    savePositions();
    render();
  }

  // ---------- 6. Editor dialog ----------
  var sheet = null;        // { id, dlg, ta, timer, ... }
  function closeEditor() { if (sheet && sheet.dlg.open) sheet.dlg.close(); }

  function openEditor(id, focusText) {
    if (!C.find(cur(), id)) return;
    stopEdit(false, !!(editing && editing.id === id));   // the editor takes over an empty new note
    var n = C.find(cur(), id);                           // read after stopEdit saved the typed text
    if (!n) return;
    closeMenu();
    if (sheet) { sheet.dlg.close(); }
    injectCss();
    var dlg = el("dialog");
    dlg.id = "sn-sheet";
    dlg.setAttribute("aria-labelledby", "sn-sheet-h");
    var s = { id: id, dlg: dlg, timer: null };
    sheet = s;

    var head = el("div", "sn-sh");
    var h = el("h2", "", T("note"));
    h.id = "sn-sheet-h";
    head.appendChild(h);
    var x = btn("sn-ib", T("close"), ICON.close);
    x.style.color = "var(--text)";
    x.addEventListener("click", closeEditor);
    head.appendChild(x);
    dlg.appendChild(head);

    var body = el("div", "sn-sc");
    s.ringNow = el("div", "sn-ringnow");
    s.ringNowText = el("span");
    s.ringNow.appendChild(s.ringNowText);
    var dn = el("button", "sn-btn sn-pri", T("done")); dn.type = "button";
    dn.addEventListener("click", function () { answer(id, "done"); });
    var sz = el("button", "sn-btn", T("snooze")); sz.type = "button";
    sz.addEventListener("click", function () { answer(id, "snooze"); });
    s.ringNow.appendChild(dn); s.ringNow.appendChild(sz);
    body.appendChild(s.ringNow);

    var ta = el("textarea");
    ta.setAttribute("aria-label", T("text"));
    ta.placeholder = T("ph");
    ta.value = n.text;
    ta.rows = 5;
    s.ta = ta;
    ta.addEventListener("input", function () {
      clearTimeout(s.timer);
      s.timer = setTimeout(function () { flushSheet(s); }, SAVE_MS);
    });
    ta.addEventListener("blur", function () { flushSheet(s); });
    body.appendChild(ta);

    var cw = el("div");
    var cl = el("span", "sn-lbl", T("color"));
    cl.id = "sn-col-l";
    cw.appendChild(cl);
    var sw = el("div", "sn-sw");
    sw.setAttribute("role", "group");
    sw.setAttribute("aria-labelledby", "sn-col-l");
    s.swatches = {};
    C.COLORS.forEach(function (c) {
      var b = btn("sn-c-" + c, T("c." + c));
      b.addEventListener("click", function () { commit(C.setColor(cur(), id, c, Date.now())); });
      s.swatches[c] = b;
      sw.appendChild(b);
    });
    cw.appendChild(sw);
    body.appendChild(cw);

    // Ring
    var rw = el("div");
    var rl = el("label", "sn-lbl", T("ring"));
    rl.setAttribute("for", "sn-ring");
    rw.appendChild(rl);
    s.ring = el("select");
    s.ring.id = "sn-ring";
    ["off", "15m", "1h", "evening", "morning", "custom"].forEach(function (k) {
      var o = el("option", "", T("r." + k)); o.value = k; s.ring.appendChild(o);
    });
    rw.appendChild(s.ring);
    s.ringAt = el("input");
    s.ringAt.type = "datetime-local";
    s.ringAt.setAttribute("aria-label", T("ring"));
    rw.appendChild(s.ringAt);
    s.repW = el("div", "sn-rep");
    var repL = el("label", "sn-lbl", T("repeat"));
    repL.setAttribute("for", "sn-rep");
    s.rep = el("select");
    s.rep.id = "sn-rep";
    ["", "daily", "weekdays", "weekly"].forEach(function (k) {
      var o = el("option", "", T("rep." + k)); o.value = k; s.rep.appendChild(o);
    });
    s.repW.appendChild(repL);
    s.repW.appendChild(s.rep);
    rw.appendChild(s.repW);
    s.ringSt = el("div", "sn-st");
    s.ringSt.setAttribute("aria-live", "polite");
    rw.appendChild(s.ringSt);
    body.appendChild(rw);
    s.ring.addEventListener("change", function () {
      var k = s.ring.value, now = Date.now();
      if (k === "off") commit(C.setRing(cur(), id, 0, now));
      else if (k === "custom") { s.ringAt.hidden = false; if (!s.ringAt.value) s.ringAt.value = C.toLocalInput(C.pick("1h", now)); s.ringAt.focus(); }
      else commit(C.setRing(cur(), id, C.pick(k, now), now, s.rep.value));
      fillSheet();
    });
    s.rep.addEventListener("change", function () { commit(C.setRepeat(cur(), id, s.rep.value, Date.now())); });
    s.ringAt.addEventListener("change", function () {
      var at = C.fromLocalInput(s.ringAt.value), now = Date.now();
      if (!at) return;
      if (at <= now) { notify(T("past")); return; }
      commit(C.setRing(cur(), id, at, now, s.rep.value));
    });

    // Vanish
    var vw = el("div");
    var vl = el("label", "sn-lbl", T("vanish"));
    vl.setAttribute("for", "sn-van");
    vw.appendChild(vl);
    s.van = el("select");
    s.van.id = "sn-van";
    ["off", "1h", "today", "tomorrow", "week", "custom"].forEach(function (k) {
      var o = el("option", "", T("v." + k)); o.value = k; s.van.appendChild(o);
    });
    vw.appendChild(s.van);
    s.vanAt = el("input");
    s.vanAt.type = "datetime-local";
    s.vanAt.setAttribute("aria-label", T("vanish"));
    vw.appendChild(s.vanAt);
    s.vanSt = el("div", "sn-st");
    s.vanSt.setAttribute("aria-live", "polite");
    vw.appendChild(s.vanSt);
    var cbl = el("label", "sn-cb");
    s.onDone = el("input");
    s.onDone.type = "checkbox";
    cbl.appendChild(s.onDone);
    cbl.appendChild(el("span", "", T("onDone")));
    vw.appendChild(cbl);
    body.appendChild(vw);
    function vanishNow(at) {
      var od = s.onDone.checked;
      commit(C.setVanish(cur(), id, (at || od) ? { at: at, onDone: od } : null, Date.now()));
    }
    s.van.addEventListener("change", function () {
      var k = s.van.value, now = Date.now();
      if (k === "off") vanishNow(0);
      else if (k === "custom") { s.vanAt.hidden = false; if (!s.vanAt.value) s.vanAt.value = C.toLocalInput(C.pick("tomorrow", now)); s.vanAt.focus(); }
      else vanishNow(C.pick(k, now));
      fillSheet();
    });
    s.vanAt.addEventListener("change", function () {
      var at = C.fromLocalInput(s.vanAt.value), now = Date.now();
      if (!at) return;
      if (at <= now) { notify(T("past")); return; }
      vanishNow(at);
    });
    s.onDone.addEventListener("change", function () {
      var nn = C.find(cur(), id);
      vanishNow(nn && nn.vanish ? nn.vanish.at : 0);
    });
    // Send to other apps (only the ones installed here)
    var lw = el("div", "sn-links");
    lw.setAttribute("role", "group");
    lw.setAttribute("aria-label", T("send"));
    if (hasApp("todo")) {
      var tb = el("button", "sn-btn", T("toTodo")); tb.type = "button";
      tb.addEventListener("click", function () { flushSheet(s); sendTo(id, "todo"); });
      lw.appendChild(tb);
    }
    if (hasApp("notes")) {
      var nb = el("button", "sn-btn", T("toNotes")); nb.type = "button";
      nb.addEventListener("click", function () { flushSheet(s); sendTo(id, "notes"); });
      lw.appendChild(nb);
    }
    if (lw.firstChild) body.appendChild(lw);
    dlg.appendChild(body);

    var foot = el("div", "sn-sf");
    var del = el("button", "sn-btn sn-danger", T("del")); del.type = "button";
    del.addEventListener("click", function () { flushSheet(s); closeEditor(); removeWithUndo(id); });
    var ok = el("button", "sn-btn sn-pri", T("done")); ok.type = "button";
    ok.addEventListener("click", closeEditor);
    // the ring's "Done" and the dialog's "Done" never show together
    s.okBtn = ok;
    foot.appendChild(del);
    foot.appendChild(ok);
    dlg.appendChild(foot);

    dlg.addEventListener("close", function () {
      flushSheet(s);
      if (sheet === s) sheet = null;
      dlg.remove();
      var nn = C.find(cur(), id);
      if (nn && !nn.text && s.blank && !nn.ring && !nn.vanish) commit(C.remove(cur(), id, Date.now()));
    });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) closeEditor(); });
    s.blank = !n.text;
    doc.body.appendChild(dlg);
    fillSheet(true);
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    if (focusText || !n.text) { try { ta.focus(); } catch (e) {} } else { try { ok.focus(); } catch (e) {} }
  }
  function flushSheet(s) {
    clearTimeout(s.timer); s.timer = null;
    var n = C.find(cur(), s.id);
    if (n && C.cleanText(s.ta.value) !== n.text) commit(C.setText(cur(), s.id, s.ta.value, Date.now()));
  }
  // Keep the open editor in step with the data (own edits, a pull).
  function syncEditor() { if (sheet) fillSheet(false); }
  function fillSheet(first) {
    var s = sheet;
    if (!s) return;
    var n = C.find(cur(), s.id), now = Date.now();
    if (!n || n.faded) { closeEditor(); return; }
    if (!first && doc.activeElement !== s.ta && C.cleanText(s.ta.value) !== n.text) s.ta.value = n.text;
    s.ta.className = "sn-c-" + n.color;
    C.COLORS.forEach(function (c) { s.swatches[c].setAttribute("aria-pressed", c === n.color ? "true" : "false"); });
    var ringing = C.isRinging(n, now);
    s.ringNow.hidden = !ringing;
    if (ringing) s.ringNowText.textContent = T("ringing", { when: when(n.ring.at, now) });
    s.okBtn.className = ringing ? "sn-btn" : "sn-btn sn-pri";
    s.okBtn.textContent = ringing ? T("close") : T("done");
    if (doc.activeElement !== s.ring && doc.activeElement !== s.ringAt) {
      s.ring.value = n.ring ? "custom" : (s.ring.value === "custom" && !s.ringAt.hidden ? "custom" : "off");
      if (n.ring) s.ringAt.value = C.toLocalInput(n.ring.at);
      s.ringAt.hidden = s.ring.value !== "custom";
    }
    s.repW.hidden = !n.ring;
    if (doc.activeElement !== s.rep) s.rep.value = n.ring && n.ring.rep ? n.ring.rep : "";
    s.ringSt.textContent = n.ring ? T(ringing ? "ringing" : "rings", { when: when(n.ring.at, now) }) +
      (n.ring.rep ? " · " + T("repf." + n.ring.rep) : "") : "";
    if (doc.activeElement !== s.van && doc.activeElement !== s.vanAt) {
      var hasAt = !!(n.vanish && n.vanish.at);
      s.van.value = hasAt ? "custom" : (s.van.value === "custom" && !s.vanAt.hidden ? "custom" : "off");
      if (hasAt) s.vanAt.value = C.toLocalInput(n.vanish.at);
      s.vanAt.hidden = s.van.value !== "custom";
    }
    s.onDone.checked = !!(n.vanish && n.vanish.onDone);
    s.vanSt.textContent = n.vanish && n.vanish.at ? T("vanishes", { when: when(n.vanish.at, now) }) : "";
  }

  function hasApp(id) {
    try {
      var f = root.orosAssistInstalled;
      return typeof f === "function" && f().some(function (a) { return a && a.id === id; });
    } catch (e) { return false; }
  }
  // Prefill only: To-Do and Notes write with their own code (BR-TD-ADD,
  // Notes { add }), so each slice keeps one writer.
  function sendTo(id, app) {
    var n = C.find(cur(), id);
    if (!n || typeof root.__orosOpenAt !== "function") return;
    if (!C.firstLine(n.text)) { notify(T("nothing")); return; }
    closeEditor();
    if (app === "todo") root.__orosOpenAt("todo", { addItems: { from: T("appName"), items: C.todoItems(n.text) } });
    else root.__orosOpenAt("notes", { add: C.notePage(n.text) });
  }

  function removeWithUndo(id) {
    var n = C.find(cur(), id);
    if (!n) return;
    var copy = JSON.parse(JSON.stringify(n));
    if (!commit(C.remove(cur(), id, Date.now()))) return;
    notify(T("deleted"), { label: T("undo"), fn: function () { commit(C.revive(cur(), copy, Date.now())); } });
  }

  // .orosstickies (stickies/package.js, the app's "Open orOS file…"):
  // the notes a file adds, merged in with C.merge (never a replace, so
  // nothing here is lost; no position: render() finds each a free spot).
  // A creation time later than now + 5 min is pulled back (ordering).
  function addFromFile(next) {
    if (!next || typeof next !== "object" || !Array.isArray(next.notes)) return false;
    var lim = Date.now() + 5 * 60000;
    var notes = next.notes.map(function (n) {
      var c = clone(n);
      if (c && typeof c.ct === "number" && c.ct > lim) c.ct = lim;
      return c;
    });
    return commit(C.merge(cur(), { notes: notes }));
  }
  // Undo of a file open: the added notes go the way Delete goes
  // (tombstones, so the removal syncs); no message per note.
  function removeAdded(ids) {
    var d = cur(), now = Date.now();
    (Array.isArray(ids) ? ids : []).forEach(function (id) { d = C.remove(d, String(id || ""), now); });
    return commit(d);
  }

  // A new note: on the desktop (typing at once), or in the editor on a
  // phone, with the app open, or with the notes hidden on this device.
  function newNote(at) {
    if (!registered()) return null;
    var e = env();
    var r = C.create(cur(), { color: prefs().color }, Date.now());
    if (r.full) { notify(T("full")); return null; }
    if (!commit(r.data)) return null;
    var inPlace = !running() && prefs().show && !narrow();
    if (inPlace) {
      var layer = doc.getElementById("sn-layer");
      if (layer && at && typeof at.x === "number") {
        var sz = sizeOf(layer), lr = layer.getBoundingClientRect(), s = C.SIZE;
        positions()[r.id] = { x: Math.max(0, at.x - lr.left) / sz.W, y: Math.max(0, at.y - lr.top) / sz.H, w: s.w, h: s.h, z: topZ() + 1, fold: false };
        savePositions();
        render();
      }
      var node = layer && layer.querySelector('[data-id="' + cssId(r.id) + '"]');
      var body = node && node.querySelector(".sn-body");
      if (node && body) { startEdit(r.id, node, body); return r.id; }
    }
    if (e && !running()) { try { e.home(); } catch (x) {} }
    openEditor(r.id, true);
    return r.id;
  }

  // ---------- 7. Engine tick ----------
  var nextAt = -1;         // the next moment anything happens; -1 = recompute
  var lastRender = 0;
  function tick() {
    if (!registered()) { if (doc.getElementById("sn-layer") || doc.getElementById("sn-strip")) clearDesktop(); return; }
    var now = Date.now();
    if (shownLang !== lang() || !doc.getElementById(narrow() ? "sn-strip" : "sn-layer")) {
      if (prefs().show && (C.live(cur()).length || !narrow())) render();
    }
    if (nextAt === -1) nextAt = C.nextEvent(cur(), now - 1);
    var due = nextAt && now >= nextAt;
    if (due) {
      var r = C.due(cur(), now);
      if (r.faded.length || r.purged.length) fadeOut(r, now);
      nextAt = C.nextEvent(cur(), now);
    }
    announce(now);
    if (now - lastRender > 30000 && !editing) { lastRender = now; render(); syncEditor(); }   // "in 5 min" labels
  }

  // The fade-out plays on the notes that are on screen, then the data moves.
  function fadeOut(r, now) {
    var shown = r.faded.filter(function (id) {
      return doc.querySelector('#sn-layer [data-id="' + cssId(id) + '"], #sn-strip [data-id="' + cssId(id) + '"]');
    });
    if (editing && r.faded.indexOf(editing.id) >= 0) { flushText(); editing = null; }
    if (sheet && r.faded.indexOf(sheet.id) >= 0) closeEditor();
    if (shown.length && prefs().pop && soundAllowed(now)) play("pop");
    shown.forEach(function (id) {
      fading[id] = true;
      var node = doc.querySelector('#sn-layer [data-id="' + cssId(id) + '"], #sn-strip [data-id="' + cssId(id) + '"]');
      if (node) node.classList.add("sn-out");
    });
    var d = C.due(cur(), now);
    commit(d.data);
    if (shown.length) {
      // keep the fading copies until the animation ends
      setTimeout(function () { shown.forEach(function (id) { delete fading[id]; }); render(); }, 950);
    }
  }

  // Each ring is announced once per device: sound (when on time and
  // allowed), the wiggle, and one inbox item (deduped on every device
  // by its key).
  function announce(now) {
    var list = C.ringing(cur(), now), loc = local(), changedLoc = false, fresh = false;
    var live = {};
    list.forEach(function (n) {
      live[n.id] = true;
      if (loc.rung[n.id] === n.ring.at) return;
      loc.rung[n.id] = n.ring.at;
      changedLoc = true;
      fresh = true;
      var late = now - n.ring.at > LATE_MS;
      if (!late && soundAllowed(now)) play(prefs().sound);
      var N = root.orosNotifs;
      try {
        if (N && typeof N.emit === "function") {
          N.emit({
            ns: "stickies", key: "ring-" + n.id + "-" + n.ring.at, type: "reminder",
            title: T("note"), body: C.firstLine(n.text) || T("note.empty"), deepLink: "stickies:" + n.id
          });
        }
      } catch (e) {}
    });
    Object.keys(loc.rung).forEach(function (id) { if (!live[id]) { delete loc.rung[id]; changedLoc = true; } });
    if (changedLoc) writeJSON(LOCAL_KEY, loc);
    var shownRinging = Object.keys(ringingNow).length;
    if (fresh || shownRinging !== list.length) { render(); syncEditor(); }
  }

  // ---------- 8. Public API, deep link, boot ----------
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  // Show one note: back to the desktop, the note in front, a flash; on
  // a phone (or with the notes hidden here) the editor opens.
  function show(id) {
    var n = C.find(cur(), id);
    if (!n) { var e0 = env(); if (e0) e0.open("stickies"); return; }
    if (n.faded) { var e1 = env(); if (e1) e1.open("stickies"); return; }
    var e = env();
    if (e && running()) { try { e.home(); } catch (x) {} }
    if (narrow() || !prefs().show) { render(); openEditor(id); return; }
    var all = positions();
    if (all[id] && all[id].fold) { all[id].fold = false; savePositions(); }
    render();
    raise(id);
    var node = doc.querySelector('#sn-layer [data-id="' + cssId(id) + '"]');
    if (node) {
      node.classList.remove("sn-flash");
      void node.offsetWidth;
      node.classList.add("sn-flash");
      var b = node.querySelector(".sn-body");
      try { (b || node).focus(); } catch (x) {}
    }
  }

  root.__orosOpenStickies = function (id) { show(String(id || "")); };

  root.orosStickies = {
    VERSION: "1.1.0",
    tick: tick,
    registered: registered,
    data: function () { flushText(); return clone(cur()); },
    prefs: prefs,
    setPref: setPref,
    newNote: function () { return newNote(); },
    create: function (text) {
      var r = C.create(cur(), { text: text, color: prefs().color }, Date.now());
      if (r.full) { notify(T("full")); return null; }
      return commit(r.data) ? r.id : null;
    },
    edit: function (id) { openEditor(String(id || "")); },
    show: function (id) { show(String(id || "")); },
    remove: function (id) { removeWithUndo(String(id || "")); },
    restore: function (id) { return commit(C.restore(cur(), String(id || ""), Date.now())); },
    fade: function (id) { return commit(C.fadeNow(cur(), String(id || ""), Date.now())); },
    tidy: function () {
      if (narrow()) return false;
      var e = env();
      if (e && running()) { try { e.home(); } catch (x) {} }
      render();
      tidy();
      return true;
    },
    testSound: function (kind) { play(validSound(kind) ? kind : prefs().sound); },
    melodies: melodies,
    exportText: function () { flushText(); return C.toText(cur()); },
    addFromFile: addFromFile,
    removeAdded: removeAdded,
    // the message after a file open; Undo runs here in the shell, so it
    // still works once the app is closed
    fileAdded: function (text, ids) {
      ids = Array.isArray(ids) ? ids.map(String) : [];
      notify(String(text || ""), ids.length ? { label: T("undo"), fn: function () { removeAdded(ids); } } : null);
    },
    onChange: function (fn) {
      if (typeof fn !== "function") return function () {};
      listeners.push(fn);
      return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    }
  };

  // The melodies for every other sound picker of the shell (wave 5 of
  // the app links): Settings › Notifications plays one for each
  // notification, Time for an alarm or a timer. Read only, as above;
  // values are stored as "rt:<id>" by whoever picks one.
  root.orosMelodies = {
    list: melodies,
    play: function (id, fb, maxS) { playMelody(String(id || ""), fb, +maxS || 0); },
    stop: stopMelody
  };

  function boot() {
    registerSlice();
    // a pack language: fetch the stickies pack now, before the first note or editor
    try { strings(lang()); } catch (e) {}
    // a melody chime: have its core ready before the first ring
    if (RT_RE.test(prefs().sound)) setTimeout(function () { if (registered()) rtCore(); }, 4000);
    if (mq) {
      var onMq = function () { stopEdit(true); render(); };
      if (mq.addEventListener) mq.addEventListener("change", onMq); else if (mq.addListener) mq.addListener(onMq);
    }
    var rz = 0;
    root.addEventListener("resize", function () {
      if (rz) return;
      rz = root.requestAnimationFrame ? root.requestAnimationFrame(function () { rz = 0; if (!editing) render(); }) : 0;
    });
    doc.addEventListener("contextmenu", onContextMenu);
    doc.addEventListener("pointerdown", function (e) {
      if (menu && !menu.contains(e.target)) closeMenu();
      unlockAudio();
    }, true);
    doc.addEventListener("keydown", unlockAudio, true);
    root.addEventListener("pagehide", function () { flushText(); if (sheet) flushSheet(sheet); });
    doc.addEventListener("visibilitychange", function () {
      if (doc.visibilityState === "hidden") { flushText(); if (sheet) flushSheet(sheet); }
    });
  }
  boot();
})(window);
