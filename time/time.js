// ============================================================
// orOS Time v0.1.1
// Clock (digital/analog/binary/flip/neon) · world clock ·
// alarms (24h + snooze + sound) · timer (+ fullscreen
// countdown overlay) · stopwatch · pomodoro · converter.
// Wave 5: world clock search by city (cities.js + clock-core.js),
// meeting planner, several named kitchen timers with their own
// sound, stopwatch with laps that survives closing (all device-local
// except the world-clock zones, see clock-core.js header).
// Alarms/timer/pomodoro FIRINGS run in the SHELL engine
// (parent window, same pattern as __orosWeatherUpdate) so they
// survive closing the app. This page only renders + registers.
// ============================================================
(function () {
  "use strict";

  /* ---------- 0. Shell palette inheritance (same-origin iframe) ---------- */
  // Function NAMES are load-bearing: bump-version.yml's G3 palette
  // guard greps every app's JS for inheritPalette + watchPalette.
  // Same contract as todo/kanban/notes/weather/mood.
  function inheritPalette() {
    try {
      var pDoc = window.parent.document;
      var pCs = window.parent.getComputedStyle(pDoc.documentElement);
      ["--bg", "--text", "--text-dim", "--accent", "--accent-hover",
       "--accent-soft", "--panel-bg", "--border", "--shadow"].forEach(function (v) {
        var val = pCs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
      var th = pDoc.documentElement.getAttribute("data-theme");
      if (th) document.documentElement.setAttribute("data-theme", th);
    } catch (e) { /* standalone load — CSS fallbacks apply */ }
  }
  // Live follow: theme/skin changes in the shell reach an OPEN app
  // without a re-open — the observer re-inherits on attribute change.
  function watchPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      if (typeof MutationObserver !== "function") return;
      new MutationObserver(inheritPalette).observe(pRoot, {
        attributes: true, attributeFilter: ["data-theme", "data-skin"]
      });
    } catch (e) { /* standalone — nothing to watch */ }
  }
  inheritPalette();
  watchPalette();

  /* ---------- 1. i18n (own packs; shell keys don't cover the app) ---------- */
  // orosI18n (../i18n.js): the full language code, a pack language included.
  var LANG = "en";
  if (window.orosI18n) LANG = window.orosI18n.lang();
  else try {
    if (window.parent && window.parent.orosLang) LANG = window.parent.orosLang;
    else if (localStorage.getItem("oros-lang")) LANG = localStorage.getItem("oros-lang");
  } catch (e) {}

  var STR = {
    en: {
      "sty.digital": "Digital", "sty.analog": "Analog", "sty.binary": "Binary",
      "sty.flip": "Flip", "sty.neon": "Neon",
      "zones.title": "World clock", "zones.add": "Add",
      "zones.cancel": "Cancel", "zones.none": "No zones yet",
      "zones.edit": "Change zone", "zones.del": "Delete zone",
      "zones.dlg.add": "Add a city or time zone", "zones.dlg.edit": "Change city or time zone",
      "zones.dlg.plan": "Add a place to the planner",
      "zones.ph": "Search a city or time zone…", "zones.res": "Cities and time zones",
      "zones.nomatch": "No city or time zone matches “{q}”.", "zones.taken": "already added",
      "z.today": "Today", "z.tom": "Tomorrow", "z.yest": "Yesterday", "z.h": "{d} h",
      "pl.title": "Meeting planner", "pl.date": "Date", "pl.len": "Length",
      "pl.wf": "Work from", "pl.wt": "until", "pl.add": "Add place", "pl.del": "Remove place",
      "pl.you": "You",
      "pl.lg.work": "working hours", "pl.lg.awake": "awake", "pl.lg.night": "night", "pl.lg.all": "everyone at work",
      "pl.hint": "Tap an hour to pick the meeting time. Up to 6 places.",
      "pl.cal": "Add to Calendar", "pl.copy": "Copy", "pl.copied": "Copied", "pl.meeting": "Meeting",
      "pl.len.30": "30 min", "pl.len.60": "1 hour", "pl.len.90": "1½ hours", "pl.len.120": "2 hours", "pl.len.180": "3 hours",
      "pl.nextday": "next day",
      "tab.alarm": "Alarm", "tab.timer": "Timer", "tab.stopwatch": "Stopwatch", "tab.pomodoro": "Pomodoro", "tab.stage": "Stage",
      "al.ph.label": "Label…", "al.daily": "Daily", "al.sound": "Sound",
      "al.add": "Add alarm", "al.none": "No alarms",
      "tm.start": "Start", "tm.reset": "Reset", "tm.done": "Timer finished",
      "tm.add": "Start", "tm.ph.name": "Name (e.g. Pasta)", "tm.name": "Timer name",
      "tm.hr": "Hours", "tm.min": "Minutes", "tm.sec": "Seconds", "tm.sound": "Sound",
      "tm.pause": "Pause", "tm.resume": "Resume", "tm.plus": "+1 min", "tm.restart": "Restart",
      "tm.del": "Delete timer", "tm.of": "of {t}", "tm.paused": "Paused", "tm.ended": "Time's up",
      "tm.none": "No timers yet. Set a time below and tap Start; several can run at once.",
      "tm.dflt": "Timer {n}", "tm.full": "Up to 20 timers.", "tm.preset": "{n} min",
      "snd.beep": "Beep", "snd.chime": "Chime", "snd.bell": "Bell", "snd.digital": "Digital", "snd.gentle": "Gentle",
      "snd.melodies": "Your melodies (Ringtone Composer)", "snd.gone": "A deleted melody (beeps)",
      "st.start": "Start", "st.stop": "Stop", "st.reset": "Reset",
      "st.lap": "Lap", "st.laptime": "Lap time", "st.total": "Total", "st.title": "Stopwatch",
      "st.copy": "Copy laps", "st.csv": "Save CSV", "st.copied": "Copied",
      "st.best": "fastest", "st.worst": "slowest",
      "pm.start": "Start", "pm.reset": "Reset", "pm.work": "Work", "pm.break": "Break",
      "pm.phase.work": "Focus", "pm.phase.break": "Break",
      "pm.done": "{n} session(s) completed",
      "pm.log": "Log focus in Timesheet", "pm.log.off": "Don't log", "pm.log.none": "No project",
      "pm.log.hint": "Each focus session is added to Timesheet as the task “Pomodoro”. Stopping early logs the minutes you focused.",
      "sn.title": "Snooze", "sn.5": "5 min", "sn.10": "10 min", "sn.15": "15 min",
      "conv.title": "Time zone converter",
      "conv.toggle.show": "Show", "conv.toggle.hide": "Hide", "conv.local": "You",
      "tab.astro": "Astro", "astro.panel": "Sun & Moon"
    },
    el: {
      "sty.digital": "Ψηφιακό", "sty.analog": "Αναλογικό", "sty.binary": "Δυαδικό",
      "sty.flip": "Αναδιπλούμενο", "sty.neon": "Νεόν",
      "zones.title": "Παγκόσμια ώρα", "zones.add": "Προσθήκη",
      "zones.cancel": "Άκυρο", "zones.none": "Δεν έχουν προστεθεί ζώνες",
      "zones.edit": "Αλλαγή ζώνης", "zones.del": "Διαγραφή ζώνης",
      "zones.dlg.add": "Προσθήκη πόλης ή ζώνης ώρας", "zones.dlg.edit": "Αλλαγή πόλης ή ζώνης ώρας",
      "zones.dlg.plan": "Προσθήκη τόπου στον σχεδιαστή",
      "zones.ph": "Αναζήτηση πόλης ή ζώνης ώρας…", "zones.res": "Πόλεις και ζώνες ώρας",
      "zones.nomatch": "Καμία πόλη ή ζώνη ώρας δεν ταιριάζει με «{q}».", "zones.taken": "υπάρχει ήδη",
      "z.today": "Σήμερα", "z.tom": "Αύριο", "z.yest": "Χθες", "z.h": "{d} ώρ.",
      "pl.title": "Σχεδιαστής συναντήσεων", "pl.date": "Ημερομηνία", "pl.len": "Διάρκεια",
      "pl.wf": "Εργασία από", "pl.wt": "έως", "pl.add": "Προσθήκη τόπου", "pl.del": "Αφαίρεση τόπου",
      "pl.you": "Εσύ",
      "pl.lg.work": "ώρες εργασίας", "pl.lg.awake": "ξύπνιοι", "pl.lg.night": "νύχτα", "pl.lg.all": "όλοι στη δουλειά",
      "pl.hint": "Πάτα μια ώρα για να διαλέξεις την ώρα της συνάντησης. Έως 6 τόποι.",
      "pl.cal": "Προσθήκη στο Ημερολόγιο", "pl.copy": "Αντιγραφή", "pl.copied": "Αντιγράφηκε", "pl.meeting": "Συνάντηση",
      "pl.len.30": "30 λεπτά", "pl.len.60": "1 ώρα", "pl.len.90": "1½ ώρα", "pl.len.120": "2 ώρες", "pl.len.180": "3 ώρες",
      "pl.nextday": "επόμενη μέρα",
      "tab.alarm": "Ξυπνητήρι", "tab.timer": "Αντίστροφη μέτρηση", "tab.stopwatch": "Χρονόμετρο", "tab.pomodoro": "Pomodoro", "tab.stage": "Σκηνή",
      "al.ph.label": "Ετικέτα…", "al.daily": "Καθημερινά", "al.sound": "Ήχος",
      "al.add": "Προσθήκη ξυπνητηριού", "al.none": "Κανένα ξυπνητήρι",
      "tm.start": "Έναρξη", "tm.reset": "Επαναφορά", "tm.done": "Η αντίστροφη μέτρηση ολοκληρώθηκε",
      "tm.add": "Έναρξη", "tm.ph.name": "Όνομα (π.χ. Μακαρόνια)", "tm.name": "Όνομα αντίστροφης μέτρησης",
      "tm.hr": "Ώρες", "tm.min": "Λεπτά", "tm.sec": "Δευτερόλεπτα", "tm.sound": "Ήχος",
      "tm.pause": "Παύση", "tm.resume": "Συνέχεια", "tm.plus": "+1 λεπτό", "tm.restart": "Ξανά",
      "tm.del": "Διαγραφή αντίστροφης μέτρησης", "tm.of": "από {t}", "tm.paused": "Σε παύση", "tm.ended": "Τέλος χρόνου",
      "tm.none": "Καμία αντίστροφη μέτρηση ακόμη. Όρισε χρόνο παρακάτω και πάτα Έναρξη· μπορούν να τρέχουν πολλές μαζί.",
      "tm.dflt": "Μέτρηση {n}", "tm.full": "Έως 20 αντίστροφες μετρήσεις.", "tm.preset": "{n} λεπτά",
      "snd.beep": "Μπιπ", "snd.chime": "Καμπανάκι", "snd.bell": "Καμπάνα", "snd.digital": "Ψηφιακό", "snd.gentle": "Απαλό",
      "snd.melodies": "Οι μελωδίες σου (Συνθέτης ήχων κλήσης)", "snd.gone": "Μελωδία που σβήστηκε (μπιπ)",
      "st.start": "Έναρξη", "st.stop": "Διακοπή", "st.reset": "Επαναφορά",
      "st.lap": "Γύρος", "st.laptime": "Χρόνος γύρου", "st.total": "Σύνολο", "st.title": "Χρονόμετρο",
      "st.copy": "Αντιγραφή γύρων", "st.csv": "Αποθήκευση CSV", "st.copied": "Αντιγράφηκε",
      "st.best": "ταχύτερος", "st.worst": "πιο αργός",
      "pm.start": "Έναρξη", "pm.reset": "Επαναφορά", "pm.work": "Εργασία", "pm.break": "Διάλειμμα",
      "pm.phase.work": "Εστίαση", "pm.phase.break": "Διάλειμμα",
      "pm.done": "{n} ολοκληρωμένες περίοδοι",
      "pm.log": "Καταγραφή στις Ώρες εργασίας", "pm.log.off": "Χωρίς καταγραφή", "pm.log.none": "Χωρίς έργο",
      "pm.log.hint": "Κάθε περίοδος εστίασης προστίθεται στις Ώρες εργασίας ως εργασία «Pomodoro». Αν σταματήσεις νωρίτερα, γράφονται τα λεπτά που δούλεψες.",
      "sn.title": "Αναβολή", "sn.5": "5 λεπτά", "sn.10": "10 λεπτά", "sn.15": "15 λεπτά",
      "conv.title": "Μετατροπέας ζωνών ώρας",
      "conv.toggle.show": "Εμφάνιση", "conv.toggle.hide": "Απόκρυψη", "conv.local": "Εσύ",
      "tab.astro": "Άστρο", "astro.panel": "Ήλιος & Σελήνη"
    }
  };
  if (window.orosI18n) window.orosI18n.table(STR, "time", LANG);
  function t(k) {
    return (STR[LANG] && STR[LANG][k] !== undefined) ? STR[LANG][k]
         : (STR.en[k] !== undefined ? STR.en[k] : k);
  }
  function applyI18n() {
    var els = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < els.length; i++) els[i].textContent = t(els[i].getAttribute("data-i18n"));
    var phs = document.querySelectorAll("[data-i18n-ph]");
    for (var j = 0; j < phs.length; j++) phs[j].placeholder = t(phs[j].getAttribute("data-i18n-ph"));
    var als = document.querySelectorAll("[data-i18n-al]");
    for (var k = 0; k < als.length; k++) als[k].setAttribute("aria-label", t(als[k].getAttribute("data-i18n-al")));
    // Re-render quick-zone chips AND zone list (both are dynamic, no data-i18n attribute)
    renderChips();
    renderZones();
  }

  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /* ---------- 2. State ---------- */
  var DATA_KEY = "oros-time-data";
  var lastMinuteKey = -1;
  var lastSubKey = -1, lastConvKey = -1;   // T3: minute-gates for face-sub / converter
  // zones = entities { tz, mtime }; zonesDeleted = tombstones { tz, mtime }
  // (same merge contract as Calendar). smtime stamps SCALAR-pref edits
  // only — a zone add/delete never clobbers the other device's
  // style/pomodoro/sound settings through the scalar LWW.
  // style: 0 digital · 1 analog · 2 binary · 3 flip · 4 neon
  var state = {
    ver: 1, style: 0, sound: true,
    zones: [], zonesDeleted: [],
    pmWork: 25, pmBreak: 5, pmDone: 0,
    smtime: 0, convOn: false,
    astro: null,   // written by astro.js — MUST round-trip or it gets wiped
    astroTomb: 0   // deletion stamp — a Clear must survive merges AND saveState
  };

  function sanitizeZone(z) {
    if (typeof z === "string" && z) return { tz: z, mtime: 0 };   // pre-sync migration
    if (!z || typeof z !== "object" || typeof z.tz !== "string" || !z.tz) return null;
    var out = {
      tz: z.tz,
      mtime: (typeof z.mtime === "number" && isFinite(z.mtime)) ? z.mtime : 0
    };
    // Wave 5: the city the row is named after (English name from
    // time/cities.js). Left out when empty, so a zone without one
    // keeps the exact pre-wave-5 bytes (TM-1).
    if (typeof z.city === "string" && z.city.trim()) out.city = z.city.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 60);
    return out;
  }
  function sanitizeZoneTomb(z) {
    if (!z || typeof z !== "object" || typeof z.tz !== "string" || !z.tz) return null;
    // #3: Date.now() here broke merge determinism — a malformed
    // remote tombstone got a DEVICE-LOCAL stamp inside mergeTime,
    // so two devices could compute different merges. A malformed
    // tombstone now gets 0: deterministic everywhere, and on any
    // tie the surviving zone wins — always the safe side.
    return {
      tz: z.tz,
      mtime: (typeof z.mtime === "number" && isFinite(z.mtime)) ? z.mtime : 0
    };
  }

  function loadState() {
    try {
      var d = JSON.parse(localStorage.getItem(DATA_KEY));
      if (d && typeof d === "object") {
        if (typeof d.style === "number") state.style = Math.min(4, Math.max(0, d.style));
        if (typeof d.sound === "boolean") state.sound = d.sound;
        if (Array.isArray(d.zones)) state.zones = d.zones.map(sanitizeZone).filter(Boolean);
        if (Array.isArray(d.zonesDeleted)) state.zonesDeleted = d.zonesDeleted.map(sanitizeZoneTomb).filter(Boolean);
        if (typeof d.pmWork === "number") state.pmWork = Math.min(120, Math.max(1, d.pmWork));
        if (typeof d.pmBreak === "number") state.pmBreak = Math.min(60, Math.max(1, d.pmBreak));
        if (typeof d.pmDone === "number") state.pmDone = d.pmDone;
        if (typeof d.smtime === "number" && isFinite(d.smtime)) state.smtime = d.smtime;
        if (typeof d.convOn === "boolean") state.convOn = d.convOn;
        if (typeof d.astroTomb === "number" && isFinite(d.astroTomb)) state.astroTomb = d.astroTomb;
        if (d.astro && typeof d.astro.lat === "number" && typeof d.astro.lon === "number") {
          var aM = (typeof d.astro.mtime === "number" && isFinite(d.astro.mtime)) ? d.astro.mtime : 0;
          // T4: same reconciliation contract as saveState/mergeTime —
          // a Clear (tomb ≥ mtime, deletion wins ties) must not be
          // resurrected into memory at load either.
          if (state.astroTomb > 0 && state.astroTomb >= aM) state.astro = null;
          else state.astro = { lat: d.astro.lat, lon: d.astro.lon, mtime: aM };
        }
      }
    } catch (e) {}
  }
  function saveState() {
    // #1: astro.js mutates DATA_KEY DIRECTLY (read→modify→write),
    // bypassing this in-memory state object. Re-read and adopt the
    // freshest astro state before persisting — BOTH directions:
    //   • a newer manual save (astro.js wrote mtime=now) must win
    //     over the stale in-memory copy, AND
    //   • a Clear (astro.js deleted it, left astroTomb=now) must
    //     NOT be resurrected by writing the stale copy back.
    try {
      var stored = JSON.parse(localStorage.getItem(DATA_KEY));
      if (stored && typeof stored === "object") {
        var sAstro = (stored.astro && typeof stored.astro.lat === "number" &&
                      typeof stored.astro.lon === "number") ? stored.astro : null;
        var sTomb = (typeof stored.astroTomb === "number" && isFinite(stored.astroTomb))
                  ? stored.astroTomb : 0;
        var cM = (state.astro && typeof state.astro.mtime === "number" &&
                  isFinite(state.astro.mtime)) ? state.astro.mtime : -1;
        if (sAstro && (sAstro.mtime || 0) > cM) state.astro = sAstro;
        var t = Math.max(sTomb, state.astroTomb || 0);
        state.astroTomb = t;
        // Deletion wins on tie (same contract as zone tombstones)
        if (t > 0 && t >= ((state.astro && state.astro.mtime) || 0)) state.astro = null;
      }
    } catch (e) { /* unreadable/empty — keep in-memory state */ }
    // TM-1: persist the canonical form (same bytes the getter and
    // the merge produce) — a stored blob in another key order made
    // every sync cycle "changed" and uploaded it again, forever.
    try { localStorage.setItem(DATA_KEY, JSON.stringify(canonTime(state))); } catch (e) {}
    markDirty();
  }

  // Shell sync bridge: same pattern as the other orOS apps. Every
  // saveState() is a USER edit → the engine must hear about it.
  function markDirty() {
    try {
      if (window.parent && window.parent.orosSync && window.parent.orosSync.markDirty) {
        window.parent.orosSync.markDirty();
      }
    } catch (e) {}
  }

  /* ---------- 3. Alarm store: shell engine when available ---------- */
  var alarmsApi;
  if (window.parent && window.parent.orosAlarms) {
    alarmsApi = window.parent.orosAlarms;      // single source of truth
  } else {
    // Standalone fallback: same storage key, in-app firing.
    var AK = "oros-alarms";
    function rd() {
      try { var a = JSON.parse(localStorage.getItem(AK)); return Array.isArray(a) ? a : []; }
      catch (e) { return []; }
    }
    function wr(l) { try { localStorage.setItem(AK, JSON.stringify(l)); } catch (e) {} }
    alarmsApi = {
      add: function (spec) {
        if (!spec || typeof spec.at !== "number" || spec.at <= Date.now()) return null;
        var a = { id: (typeof spec.id === "string" && /^tmr-[a-z0-9-]{1,60}$/.test(spec.id)) ? spec.id : "l" + Date.now().toString(36), at: Math.round(spec.at),
                  label: String(spec.label || "").slice(0, 60),
                  repeat: spec.repeat === "daily" ? "daily" : "once", state: "pending" };
        var l = rd(); l.push(a); wr(l); return a.id;
      },
      remove: function (id) { wr(rd().filter(function (a) { return a.id !== id; })); },
      list: function () { return rd(); }
    };
    setInterval(function () {
      var l = rd(), hit = null;
      for (var i = 0; i < l.length; i++) {
        if (l[i].state === "pending" && l[i].at <= Date.now()) { hit = l[i]; break; }
      }
      if (!hit) return;
      if (hit.repeat === "daily") {
        var d = new Date(hit.at); d.setDate(d.getDate() + 1); hit.at = d.getTime(); wr(l);
      } else {
        wr(l.filter(function (a) { return a.id !== hit.id; }));
      }
      // Top-right toast, identical anchoring to the shell's toasts.
      showToast(hit.label || t("tab.alarm"), { snooze: hit.repeat !== "daily" });
    }, 1000);
  }

  /* ---------- 3b. Shared toast + Web Audio beep (no deps) ---------- */
  // Top-right, below the clock — Linux-desktop convention, matching
  // every other orOS notification. Optional snooze buttons re-register
  // through alarmsApi, so snoozes work in BOTH engines when fired
  // in-page (standalone engine; the shell engine fires its own toast).
  function showToast(label, opts) {
    var toast = document.createElement("div");
    toast.setAttribute("role", "alert");
    toast.className = "oro-toast";
    var txt = document.createElement("span");
    txt.textContent = label;
    toast.appendChild(txt);
    if (opts && opts.snooze) {
      [5, 10, 15].forEach(function (m) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "sn-btn";
        b.textContent = t("sn." + m);
        b.addEventListener("click", function () {
          alarmsApi.add({ at: Date.now() + m * 60000, label: label, repeat: "once" });
          toast.remove();
        });
        toast.appendChild(b);
      });
    }
    document.body.appendChild(toast);
    setTimeout(function () { if (toast.parentNode) toast.remove(); }, (opts && opts.ttl) || 15000);
    toast.addEventListener("click", function (ev) {
      if (ev.target === toast) toast.remove();
    });
    beep(opts && opts.beeps);
  }

  var AC = null;
  // Called from click handlers (user gesture unlocks autoplay).
  function ensureAudio() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      if (!AC) AC = new Ctx();
      if (AC.state === "suspended") AC.resume();
      return AC;
    } catch (e) { return null; }
  }
  function beep(times) {
    if (!state.sound) return;
    var ac = ensureAudio();
    if (!ac) return;
    try {
      var t0 = ac.currentTime;
      for (var i = 0; i < (times || 2); i++) {
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = "sine";
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, t0 + i * 0.35);
        g.gain.exponentialRampToValueAtTime(0.18, t0 + i * 0.35 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.35 + 0.30);
        o.connect(g); g.connect(ac.destination);
        o.start(t0 + i * 0.35); o.stop(t0 + i * 0.35 + 0.32);
      }
    } catch (e) {}
  }

  /* ---------- 4. Faces ---------- */
  var binBits = [];
  function buildBinary() {
    var wrap = $("face-binary");
    wrap.innerHTML = "";
    binBits = [];
    for (var c = 0; c < 6; c++) {
      var col = document.createElement("div");
      col.className = "b-col";
      var rows = [];
      for (var b = 0; b < 4; b++) {
        var bit = document.createElement("div");
        bit.className = "b-bit";
        col.appendChild(bit);
        rows.push(bit);
      }
      wrap.appendChild(col);
      binBits.push(rows);
    }
  }

  var hands = {};
  function buildAnalog() {
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    var face = document.createElementNS(NS, "circle");
    face.setAttribute("cx", "50"); face.setAttribute("cy", "50"); face.setAttribute("r", "48");
    face.setAttribute("fill", "var(--panel-bg)");
    face.setAttribute("stroke", "var(--border)");
    face.setAttribute("stroke-width", "2");
    svg.appendChild(face);
    for (var i = 0; i < 12; i++) {
      var ang = i * Math.PI / 6;
      var tk = document.createElementNS(NS, "line");
      tk.setAttribute("x1", 50 + 42 * Math.sin(ang)); tk.setAttribute("y1", 50 - 42 * Math.cos(ang));
      tk.setAttribute("x2", 50 + 45 * Math.sin(ang)); tk.setAttribute("y2", 50 - 45 * Math.cos(ang));
      tk.setAttribute("stroke", "var(--text-dim)");
      tk.setAttribute("stroke-width", i % 3 === 0 ? "2.5" : "1");
      svg.appendChild(tk);
    }
    function mkHand(width, color) {
      var h = document.createElementNS(NS, "line");
      h.setAttribute("x1", "50"); h.setAttribute("y1", "50");
      h.setAttribute("x2", "50"); h.setAttribute("y2", "50");
      h.setAttribute("stroke", color);
      h.setAttribute("stroke-width", width);
      h.setAttribute("stroke-linecap", "round");
      svg.appendChild(h);
      return h;
    }
    hands.h = mkHand("4", "var(--text)");
    hands.m = mkHand("3", "var(--text)");
    hands.s = mkHand("1.5", "var(--accent)");
    $("face-analog").appendChild(svg);
  }
  function setHand(line, deg, len) {
    var a = (deg - 90) * Math.PI / 180;
    line.setAttribute("x2", (50 + len * Math.cos(a)).toFixed(2));
    line.setAttribute("y2", (50 + len * Math.sin(a)).toFixed(2));
  }
  function renderAnalog(now) {
    setHand(hands.h, ((now.getHours() % 12) + now.getMinutes() / 60) * 30, 26);
    setHand(hands.m, (now.getMinutes() + now.getSeconds() / 60) * 6, 38);
    setHand(hands.s, now.getSeconds() * 6, 41);
  }

  function renderBinary(now) {
    var digits = [
      Math.floor(now.getHours() / 10), now.getHours() % 10,
      Math.floor(now.getMinutes() / 10), now.getMinutes() % 10,
      Math.floor(now.getSeconds() / 10), now.getSeconds() % 10
    ];
    for (var c = 0; c < 6; c++) {
      for (var b = 0; b < 4; b++) {
        binBits[c][b].className = "b-bit" + ((digits[c] & (1 << b)) ? " on" : "");
      }
    }
  }

  // Flip clock: 6 single cards with a mid hinge; the .fl-flip
  // animation replays ONLY when a digit actually changes.
  var flCards = [], flLast = ["", "", "", "", "", ""];
  function buildFlip() {
    var wrap = $("face-flip");
    wrap.innerHTML = "";
    flCards = [];
    flLast = ["", "", "", "", "", ""];
    for (var c = 0; c < 6; c++) {
      var pair = document.createElement("div");
      pair.className = "fl-pair";
      var card = document.createElement("div");
      card.className = "fl-card";
      card.textContent = "0";
      var hinge = document.createElement("div");
      hinge.className = "fl-hinge";
      pair.appendChild(card);
      pair.appendChild(hinge);
      wrap.appendChild(pair);
      flCards.push(card);
      if (c === 1 || c === 3) {
        var sep = document.createElement("span");
        sep.className = "fl-sep";
        sep.textContent = ":";
        wrap.appendChild(sep);
      }
    }
  }
  function renderFlip(now) {
    var digits = [
      Math.floor(now.getHours() / 10), now.getHours() % 10,
      Math.floor(now.getMinutes() / 10), now.getMinutes() % 10,
      Math.floor(now.getSeconds() / 10), now.getSeconds() % 10
    ];
    for (var c = 0; c < 6; c++) {
      var d = String(digits[c]);
      if (d !== flLast[c]) {
        flLast[c] = d;
        var card = flCards[c];
        card.textContent = d;
        card.classList.remove("fl-flip");
        void card.offsetWidth;          // force reflow → restart animation
        card.classList.add("fl-flip");
      }
    }
  }

  function buildNeon() {
    var wrap = $("face-neon");
    wrap.innerHTML = "";
    var hm = document.createElement("span");
    hm.id = "neon-hm";
    hm.textContent = "--:--";
    var ss = document.createElement("span");
    ss.id = "neon-ss";
    ss.textContent = "";
    wrap.appendChild(hm);
    wrap.appendChild(ss);
  }
  function renderNeon(now) {
    $("neon-hm").textContent = pad(now.getHours()) + ":" + pad(now.getMinutes());
    $("neon-ss").textContent = pad(now.getSeconds());
  }

  function renderSub(now) {
    var loc = locTag();
    var d = now.toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    var off = -now.getTimezoneOffset();
    var sign = off >= 0 ? "+" : "-";
    $("face-sub").textContent = d + "  ·  UTC" + sign + pad(Math.floor(Math.abs(off) / 60)) + ":" + pad(Math.abs(off) % 60);
  }

  // NOTE: the faces are hidden via the [hidden] attribute; their
  // display:flex/grid lives behind :not([hidden]) in time.css
  // (patches CSS-A..D) or display would override `hidden` — that
  // was the original "binary always visible" bug.
  function applyStyle() {
    var s = state.style;
    $("face-digital").hidden = s !== 0;
    $("face-analog").hidden = s !== 1;
    $("face-binary").hidden = s !== 2;
    $("face-flip").hidden   = s !== 3;
    $("face-neon").hidden   = s !== 4;
    for (var i = 0; i < 5; i++) $("sty-" + i).className = "sty" + (i === s ? " active" : "");
  }

  /* ---------- 5. World clock (wave 5: any zone, search by city) ---------- */
  // Any IANA zone the browser knows (Intl.supportedValuesOf, else the
  // zones of the built-in city list), searched by city name in English
  // or Greek (time/cities.js through time/clock-core.js). A row is
  // still one per zone ({tz, mtime}); picking a city stores its English
  // name in `city` so the row is called after it.
  var CC = window.OrosClockCore;
  var QUICK_ZONES = ["Europe/Athens", "Europe/London", "America/New_York", "Asia/Tokyo"];
  var POPULAR = ["Athens", "London", "New York", "Paris", "Berlin", "Tokyo", "Dubai", "Los Angeles",
                 "Chicago", "Toronto", "Sydney", "Singapore", "Hong Kong", "Shanghai", "Mumbai",
                 "Istanbul", "Moscow", "Nicosia", "São Paulo", "Mexico City", "Johannesburg", "Auckland"];
  var LOCAL_TZ = (function () {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; }
  })();
  var zoneFmt = {};
  function zFmt(tz) {
    if (!zoneFmt[tz]) {
      zoneFmt[tz] = new Intl.DateTimeFormat(locTag(),
        { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });   // TM-5: 24h in Greek too
    }
    return zoneFmt[tz];
  }
  // A zone entity ({tz, city?}) or a bare tz → the name shown.
  function zoneName(z) {
    if (typeof z === "string") return CC.zoneLabel(z, "", LANG);
    return CC.zoneLabel(z.tz, z.city || "", LANG);
  }
  var REGION = null;
  try { REGION = new Intl.DisplayNames([window.orosI18n ? LANG : (LANG === "el" ? "el" : "en")], { type: "region" }); } catch (e) { REGION = null; }
  function regionName(cc) {
    if (!cc) return "";
    try { return REGION ? (REGION.of(cc) || cc) : cc; } catch (e) { return cc; }
  }
  // "Today, +2 h" · "Tomorrow, −7 h" against this device's time.
  function zoneSub(tz, now) {
    try {
      var off = CC.offsetMin(tz, now) - CC.offsetMin(LOCAL_TZ, now);
      var dd = CC.dayDiff(CC.partsIn(tz, now), CC.partsIn(LOCAL_TZ, now));
      var day = t(dd > 0 ? "z.tom" : dd < 0 ? "z.yest" : "z.today");
      return day + ", " + t("z.h").replace("{d}", CC.diffLabel(off));
    } catch (e) { return ""; }
  }

  function addZone(tz, city) {
    if (!tz || !CC.validZone(tz)) return;
    city = city || "";
    var cur = null;
    state.zones.forEach(function (z) { if (z.tz === tz) cur = z; });
    if (cur) {
      if ((cur.city || "") === city) return;
      // Same zone, another city: the row takes the new name.
      if (city) cur.city = city; else delete cur.city;
      cur.mtime = Date.now();
    } else {
      var z = { tz: tz, mtime: Date.now() };
      if (city) z.city = city;
      state.zones.push(z);
      // Re-add cancels an older deletion marker (resurrection)
      state.zonesDeleted = state.zonesDeleted.filter(function (d) { return d.tz !== tz; });
    }
    saveState();
    renderZones();
    planRender();
  }

  function renderZones() {
    var ul = $("zones");
    ul.innerHTML = "";
    if (!state.zones.length) {
      var li0 = document.createElement("li");
      li0.className = "empty";
      li0.textContent = t("zones.none");
      ul.appendChild(li0);
      renderChips();
      zoneTick();
      return;
    }
    state.zones.forEach(function (zc) {
      var tz = zc.tz;
      var li = document.createElement("li");
      li.className = "z-row editable";
      var main = document.createElement("div");
      main.className = "z-main";
      var nm = document.createElement("span");
      nm.className = "z-name edit-icon";     // #8: shows pencil on hover
      nm.textContent = zoneName(zc);
      nm.title = t("zones.edit");
      // Double-click → swap this zone's tz (edit-in-place)
      nm.addEventListener("dblclick", function () { openZoneDlg(tz, "edit"); });
      var sub = document.createElement("span");
      sub.className = "z-sub";
      sub.setAttribute("data-tz-sub", tz);
      main.appendChild(nm);
      main.appendChild(sub);
      var tm = document.createElement("span");
      tm.className = "z-time";
      tm.setAttribute("data-tz", tz);
      var del = document.createElement("button");
      del.type = "button";
      del.className = "z-del";
      var delLbl = t("zones.del");
      del.title = delLbl;
      del.setAttribute("aria-label", delLbl);   // glyph-only buttons need spoken text
      del.textContent = "✕";
      del.addEventListener("click", function () {
        state.zones = state.zones.filter(function (z) { return z.tz !== tz; });
        state.zonesDeleted.push({ tz: tz, mtime: Date.now() });
        saveState();
        renderZones();
        planRender();
      });
      li.appendChild(main); li.appendChild(tm); li.appendChild(del);
      ul.appendChild(li);
    });
    renderChips();
    zoneTick();
  }

  // Quick chips: common zones, hidden once added (de-duplicated).
  function renderChips() {
    var host = $("quick-zones");
    if (!host) return;
    host.innerHTML = "";
    var taken = {};
    state.zones.forEach(function (z) { taken[z.tz] = true; });
    QUICK_ZONES.forEach(function (tz) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "qchip";
      b.textContent = "+ " + zoneName(tz);
      if (taken[tz]) b.disabled = true;
      else b.addEventListener("click", function () { addZone(tz, ""); });
      host.appendChild(b);
    });
  }

  function zoneTick() {
    var now = Date.now();
    var cells = document.querySelectorAll("#zones .z-time");
    for (var i = 0; i < cells.length; i++) {
      var tz = cells[i].getAttribute("data-tz");
      try { cells[i].textContent = zFmt(tz).format(new Date(now)); } catch (e) {}
    }
    var subs = document.querySelectorAll("#zones .z-sub");
    for (var j = 0; j < subs.length; j++) {
      var s = zoneSub(subs[j].getAttribute("data-tz-sub"), now);
      if (subs[j].textContent !== s) subs[j].textContent = s;
    }
  }

  // One dialog, three modes: add a world-clock row, edit (swap) a row,
  // or add a place to the meeting planner.
  var dlgEditTz = null, dlgMode = "add";
  function dlgTaken() {
    var taken = {};
    if (dlgMode === "plan") planPlaces().forEach(function (p) { taken[p.tz + "|" + (p.city || "")] = true; });
    else state.zones.forEach(function (z) { if (z.tz !== dlgEditTz) taken[z.tz] = true; });
    return taken;
  }
  function popularPlaces() {
    var out = [];
    POPULAR.forEach(function (n) {
      CC.cities().some(function (c) {
        if (c.en !== n) return false;
        out.push({ kind: "city", tz: c.tz, city: c.en, en: c.en, el: c.el, cc: c.cc });
        return true;
      });
    });
    return out;
  }
  function zoneResults() {
    var q = $("zone-q").value;
    var ul = $("zone-res");
    ul.innerHTML = "";
    var list = q.trim() ? CC.searchPlaces(q, { limit: 40 }) : popularPlaces();
    var none = $("zone-none");
    none.hidden = list.length > 0;
    if (!list.length) none.textContent = t("zones.nomatch").replace("{q}", q.trim());
    var taken = dlgTaken(), now = Date.now();
    list.forEach(function (r) {
      var li = document.createElement("li");
      li.setAttribute("role", "presentation");
      var b = document.createElement("button");
      b.type = "button";
      b.className = "zr";
      b.setAttribute("role", "option");
      var isTaken = dlgMode === "plan" ? !!taken[r.tz + "|" + (r.city || "")] : !!taken[r.tz];
      var nm = document.createElement("span");
      nm.className = "zr-name";
      nm.textContent = r.kind === "city" ? (LANG === "el" ? r.el : r.en) : zoneName(r.tz);
      var sub = document.createElement("span");
      sub.className = "zr-sub";
      var bits = [];
      if (r.kind === "city") bits.push(regionName(r.cc));
      bits.push(r.tz.replace(/_/g, " "));
      if (isTaken) bits.push(t("zones.taken"));
      sub.textContent = bits.filter(Boolean).join(" · ");
      var tm = document.createElement("span");
      tm.className = "zr-time";
      try { tm.textContent = zFmt(r.tz).format(new Date(now)); } catch (e) { tm.textContent = ""; }
      var txt = document.createElement("span");
      txt.className = "zr-txt";
      txt.appendChild(nm); txt.appendChild(sub);
      b.appendChild(txt); b.appendChild(tm);
      if (isTaken) b.disabled = true;
      else b.addEventListener("click", function () { zonePick(r); });
      li.appendChild(b);
      ul.appendChild(li);
    });
  }
  function zonePick(r) {
    $("zone-dlg").close();
    var city = r.kind === "city" ? r.city : "";
    if (dlgMode === "plan") { planAddPlace(r.tz, city); return; }
    if (dlgMode === "edit" && dlgEditTz && r.tz !== dlgEditTz) {
      // Swap = tombstone the old tz + add the new one
      var old = dlgEditTz;
      state.zones = state.zones.filter(function (z) { return z.tz !== old; });
      state.zonesDeleted.push({ tz: old, mtime: Date.now() });
    }
    dlgEditTz = null;
    addZone(r.tz, city);
  }
  function openZoneDlg(editTz, mode) {
    dlgMode = mode || (editTz ? "edit" : "add");
    dlgEditTz = editTz || null;
    $("zone-dlg-h").textContent = t("zones.dlg." + dlgMode);
    $("zone-q").value = "";
    zoneResults();
    $("zone-dlg").showModal();
    try { $("zone-q").focus(); } catch (e) {}
  }
  var zqTimer = 0;
  $("zone-q").addEventListener("input", function () {
    clearTimeout(zqTimer);
    zqTimer = setTimeout(zoneResults, 80);
  });
  $("zone-q").addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    clearTimeout(zqTimer);
    zoneResults();
    var first = document.querySelector("#zone-res .zr:not([disabled])");
    if (first) first.click();
  });
  $("zone-add").addEventListener("click", function () { openZoneDlg(null, "add"); });
  $("zone-cancel").addEventListener("click", function () { dlgEditTz = null; $("zone-dlg").close(); });
  // Outside-click close: a click whose target IS the dialog hit the backdrop.
  $("zone-dlg").addEventListener("click", function (ev) {
    if (ev.target === this) { dlgEditTz = null; this.close(); }
  });

  /* ---------- 5b. Meeting planner (wave 5) ---------- */
  // 2–6 places, one 24-hour strip each, aligned in time (column i is
  // the same instant everywhere: local midnight of the chosen date in
  // the FIRST place + i hours). Working hours on weekdays are green,
  // 07–22 is "awake", the rest night; ★ marks hours when everyone is
  // at work. Pick a column → the slot in every place, Add to Calendar
  // (the shell's __orosOpenCalendarNew prefill, saved only on Save in
  // Calendar) or Copy. Device-local pref oros-time-plan: the places
  // (null = you + the first world-clock zones), working hours, length.
  var PLAN_KEY = "oros-time-plan";
  var LENS = [30, 60, 90, 120, 180];
  var plan = { open: false, places: null, wf: "09:00", wt: "17:00", len: 60 };
  var plSel = -1, plDate = "";
  var HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  function planLoad() {
    try {
      var d = JSON.parse(localStorage.getItem(PLAN_KEY));
      if (!d || typeof d !== "object") return;
      plan.open = d.open === true;
      if (Array.isArray(d.places)) {
        var seen = {};
        plan.places = d.places.filter(function (p) {
          if (!p || typeof p !== "object" || !CC.validZone(p.tz)) return false;
          var k = p.tz + "|" + (typeof p.city === "string" ? p.city : "");
          if (seen[k]) return false;
          seen[k] = 1;
          return true;
        }).slice(0, 6).map(function (p) {
          return { tz: p.tz, city: typeof p.city === "string" ? p.city.slice(0, 60) : "" };
        });
        if (plan.places.length < 2) plan.places = null;
      }
      if (HM_RE.test(d.wf)) plan.wf = d.wf;
      if (HM_RE.test(d.wt)) plan.wt = d.wt;
      if (LENS.indexOf(d.len) >= 0) plan.len = d.len;
    } catch (e) {}
  }
  function planSave() {
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(plan)); } catch (e) {}
  }
  function planPlaces() {
    if (plan.places && plan.places.length >= 2) return plan.places;
    var out = [{ tz: LOCAL_TZ, city: "" }];
    state.zones.forEach(function (z) {
      if (out.length < 4 && !out.some(function (p) { return p.tz === z.tz; })) out.push({ tz: z.tz, city: z.city || "" });
    });
    ["America/New_York", "Europe/London"].forEach(function (tz) {
      if (out.length < 2 && !out.some(function (p) { return p.tz === tz; })) out.push({ tz: tz, city: "" });
    });
    return out;
  }
  function planAddPlace(tz, city) {
    var list = planPlaces().slice();
    if (list.length >= 6) return;
    if (list.some(function (p) { return p.tz === tz && (p.city || "") === (city || ""); })) return;
    list.push({ tz: tz, city: city || "" });
    plan.places = list;
    planSave();
    planRender();
  }
  function planDel(i) {
    var list = planPlaces().slice();
    if (list.length <= 2) return;
    list.splice(i, 1);
    plan.places = list;
    planSave();
    planRender();
  }
  function todayYmd() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function planBase(places) {
    var v = /^\d{4}-\d{2}-\d{2}$/.test(plDate) ? plDate : todayYmd();
    var p = v.split("-");
    return CC.midnightIn(places[0].tz, +p[0], +p[1], +p[2]);
  }
  function locTag() { return window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB"); }
  function dayShort(c) {
    try {
      return new Intl.DateTimeFormat(locTag(), { weekday: "short", day: "numeric", timeZone: "UTC" })
        .format(new Date(Date.UTC(c.y, c.mo - 1, c.d, 12)));
    } catch (e) { return c.d + ""; }
  }
  function placeName(p) { return zoneName({ tz: p.tz, city: p.city || "" }); }
  function utcLabel(tz, ms) {
    var o = CC.offsetMin(tz, ms);
    return "UTC" + (o >= 0 ? "+" : "−") + Math.floor(Math.abs(o) / 60) + (Math.abs(o) % 60 ? ":" + pad(Math.abs(o) % 60) : "");
  }
  function planRender() {
    if (!$("pl-body") || $("pl-body").hidden) return;
    var places = planPlaces(), base = planBase(places);
    var res = CC.planRows(places.map(function (p) { return p.tz; }), base, { wf: plan.wf, wt: plan.wt });
    var grid = $("pl-grid"), keepScroll = grid.scrollLeft, fresh = !grid.firstChild;
    grid.innerHTML = "";
    var span = Math.max(1, Math.ceil(plan.len / 60));
    function inSel(i) { return plSel >= 0 && i >= plSel && i < plSel + span; }
    // Top row: ★ where everyone is at work.
    var top = document.createElement("div");
    top.className = "pl-row pl-top";
    var tl = document.createElement("div");
    tl.className = "pl-lab";
    top.appendChild(tl);
    res.allWork.forEach(function (all, i) {
      var c = document.createElement("span");
      c.className = "pl-c pl-star-c" + (inSel(i) ? " sel" : "");
      c.textContent = all ? "★" : "";
      c.setAttribute("data-i", i);
      top.appendChild(c);
    });
    grid.appendChild(top);
    res.rows.forEach(function (row, ri) {
      var p = places[ri];
      var r = document.createElement("div");
      r.className = "pl-row";
      var lab = document.createElement("div");
      lab.className = "pl-lab";
      var nm = document.createElement("span");
      nm.className = "pl-name";
      nm.textContent = placeName(p);
      var sub = document.createElement("span");
      sub.className = "pl-sub";
      sub.textContent = utcLabel(p.tz, base + 12 * 3600000) + (p.tz === LOCAL_TZ && !p.city ? " · " + t("pl.you") : "");
      var txt = document.createElement("span");
      txt.className = "pl-ltxt";
      txt.appendChild(nm); txt.appendChild(sub);
      lab.appendChild(txt);
      if (places.length > 2) {
        var del = document.createElement("button");
        del.type = "button";
        del.className = "pl-del";
        del.textContent = "✕";
        del.title = t("pl.del");
        del.setAttribute("aria-label", t("pl.del") + ": " + placeName(p));
        del.addEventListener("click", function () { planDel(ri); });
        lab.appendChild(del);
      }
      r.appendChild(lab);
      row.cells.forEach(function (c, i) {
        var cell = document.createElement("span");
        cell.className = "pl-c " + c.cls + (c.newDay ? " nd" : "") + (c.mi ? " half" : "") + (inSel(i) ? " sel" : "");
        cell.setAttribute("data-i", i);
        if (c.newDay) {
          var dl = document.createElement("small");
          dl.textContent = dayShort(c);
          cell.appendChild(dl);
        }
        var hv = document.createElement("b");
        hv.textContent = c.mi ? c.h + ":" + pad(c.mi) : String(c.h);
        cell.appendChild(hv);
        r.appendChild(cell);
      });
      grid.appendChild(r);
    });
    if (fresh) {
      // Start the strip at the working morning (or the current hour today).
      var at = 7, now = Date.now();
      if (now >= base && now < base + 24 * 3600000) at = Math.max(0, Math.floor((now - base) / 3600000) - 1);
      var cell0 = grid.querySelector(".pl-row:not(.pl-top) .pl-c");
      var cw = cell0 ? cell0.offsetWidth : 38;
      grid.scrollLeft = Math.max(0, at * cw);
    } else {
      grid.scrollLeft = keepScroll;
    }
    $("pl-add").disabled = places.length >= 6;
    planPickRender(places, base);
  }
  function fmtSlot(tz, ms) {
    try {
      return new Intl.DateTimeFormat(locTag(), { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(new Date(ms));
    } catch (e) { return ""; }
  }
  function planSlot(places, base) {
    var start = base + plSel * 3600000, end = start + plan.len * 60000;
    return places.map(function (p) {
      var s = CC.partsIn(p.tz, start), e = CC.partsIn(p.tz, end);
      var next = CC.dayDiff(e, s) !== 0;
      return { name: placeName(p), day: fmtSlot(p.tz, start), from: CC.hm(s), to: CC.hm(e), next: next };
    });
  }
  function planLines(places, base) {
    return planSlot(places, base).map(function (r) {
      return r.name + ": " + r.day + ", " + r.from + "–" + r.to + (r.next ? " (" + t("pl.nextday") + ")" : "");
    });
  }
  function calBridge() {
    try {
      if (window.parent && window.parent !== window && typeof window.parent.__orosOpenCalendarNew === "function") return window.parent.__orosOpenCalendarNew;
    } catch (e) {}
    return null;
  }
  function planPickRender(places, base) {
    var box = $("pl-pick");
    box.hidden = plSel < 0;
    $("pl-hint").hidden = plSel >= 0;
    if (plSel < 0) return;
    var ul = $("pl-pick-list");
    ul.innerHTML = "";
    planSlot(places, base).forEach(function (r) {
      var li = document.createElement("li");
      var n = document.createElement("b");
      n.textContent = r.name;
      var v = document.createElement("span");
      v.textContent = r.day + ", " + r.from + "–" + r.to + (r.next ? " (" + t("pl.nextday") + ")" : "");
      li.appendChild(n); li.appendChild(v);
      ul.appendChild(li);
    });
    $("pl-cal").hidden = !calBridge();
  }
  function planOpenSync() {
    $("pl-body").hidden = !plan.open;
    $("pl-toggle").textContent = t(plan.open ? "conv.toggle.hide" : "conv.toggle.show");
    $("pl-toggle").setAttribute("aria-expanded", plan.open ? "true" : "false");
    if (plan.open) {
      if (!$("pl-date").value) $("pl-date").value = plDate || todayYmd();
      $("pl-wf").value = plan.wf;
      $("pl-wt").value = plan.wt;
      $("pl-len").value = String(plan.len);
      planRender();
    }
  }
  function planFillLens() {
    var sel = $("pl-len");
    sel.innerHTML = "";
    LENS.forEach(function (n) {
      var o = document.createElement("option");
      o.value = String(n);
      o.textContent = t("pl.len." + n);
      sel.appendChild(o);
    });
    sel.value = String(plan.len);
  }
  $("pl-toggle").addEventListener("click", function () {
    plan.open = !plan.open;
    planSave();
    planOpenSync();
  });
  $("pl-date").addEventListener("change", function () {
    plDate = this.value;
    plSel = -1;
    $("pl-grid").innerHTML = "";
    planRender();
  });
  $("pl-len").addEventListener("change", function () {
    var n = parseInt(this.value, 10);
    if (LENS.indexOf(n) >= 0) { plan.len = n; planSave(); planRender(); }
  });
  ["pl-wf", "pl-wt"].forEach(function (id) {
    $(id).addEventListener("change", function () {
      if (!HM_RE.test(this.value)) { this.value = id === "pl-wf" ? plan.wf : plan.wt; return; }
      if (id === "pl-wf") plan.wf = this.value; else plan.wt = this.value;
      planSave();
      planRender();
    });
  });
  $("pl-grid").addEventListener("click", function (ev) {
    var c = ev.target && ev.target.closest ? ev.target.closest("[data-i]") : null;
    if (!c) return;
    var i = parseInt(c.getAttribute("data-i"), 10);
    plSel = plSel === i ? -1 : i;
    planRender();
  });
  $("pl-grid").setAttribute("tabindex", "0");
  $("pl-grid").addEventListener("keydown", function (ev) {
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    ev.preventDefault();
    if (plSel < 0) plSel = 9;
    else plSel = Math.max(0, Math.min(23, plSel + (ev.key === "ArrowRight" ? 1 : -1)));
    planRender();
    var cell = this.querySelector('.pl-row:not(.pl-top) .pl-c[data-i="' + plSel + '"]');
    if (cell && cell.scrollIntoView) cell.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  $("pl-add").addEventListener("click", function () { openZoneDlg(null, "plan"); });
  function copyText(text, btn, doneKey) {
    function ok() {
      var was = btn.textContent;
      btn.textContent = t(doneKey);
      setTimeout(function () { btn.textContent = was; }, 1500);
    }
    function legacy() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); ok(); } catch (e) {}
      ta.remove();
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(ok, legacy);
        return;
      }
    } catch (e) {}
    legacy();
  }
  $("pl-copy").addEventListener("click", function () {
    if (plSel < 0) return;
    var places = planPlaces(), base = planBase(places);
    var text = t("pl.meeting") + " · " + t("pl.len." + plan.len) + "\n" + planLines(places, base).join("\n");
    copyText(text, this, "pl.copied");
  });
  $("pl-cal").addEventListener("click", function () {
    var open = calBridge();
    if (plSel < 0 || !open) return;
    var places = planPlaces(), base = planBase(places);
    var start = new Date(base + plSel * 3600000), end = new Date(start.getTime() + plan.len * 60000);
    var ymdOf = function (d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
    var p = {
      date: ymdOf(start),
      title: t("pl.meeting"),
      start: pad(start.getHours()) + ":" + pad(start.getMinutes()),
      end: pad(end.getHours()) + ":" + pad(end.getMinutes()),
      note: planLines(places, base).join("\n")
    };
    if (ymdOf(end) !== p.date) p.dateEnd = ymdOf(end);
    try { open(p); } catch (e) {}
  });

  /* ---------- 6. Tabs ---------- */
  var tabBtns = document.querySelectorAll(".tab");
  for (var tb = 0; tb < tabBtns.length; tb++) {
    tabBtns[tb].addEventListener("click", function () {
      var pane = this.getAttribute("data-pane");
      for (var i = 0; i < tabBtns.length; i++) {
        var on = tabBtns[i].getAttribute("data-pane") === pane;
        if (on && pane === "pane-pomo") pmLogFill();
        if (on && pane === "pane-stop") setTimeout(swLoop, 0);
        tabBtns[i].className = "tab" + (on ? " active" : "");
        $(tabBtns[i].getAttribute("data-pane")).hidden = !on;
      }
    });
  }
  
  
  /* ---------- 7. Alarms ---------- */
  // #5 (24-hour): input[type=time] VALUE is always "HH:MM" 24h per
  // HTML spec; rendering below uses pad(getHours()) — never AM/PM.
  // Validation below additionally rejects anything non-24h-shaped.
  // T2: shared no-feedback fix — an invalid input shakes + focuses,
  // never a silent return (same gesture as the timer's T6 shake).
  function shakeInput(ids) {
    ids.forEach(function (id) {
      var el = $(id);
      var n = 0;
      var iv = setInterval(function () {
        el.style.transform = (n % 2 === 0) ? "translateX(3px)" : "translateX(-3px)";
        if (++n > 5) { clearInterval(iv); el.style.transform = ""; }
      }, 70);
    });
    $(ids[0]).focus();
  }
  function fmtAt(at) {
    var d = new Date(at);
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function renderAlarms() {
    var ul = $("alarm-list");
    ul.innerHTML = "";
    // T1: the page's OWN timer/pomodoro registrations are engine
    // bookkeeping, not user alarms — showing them in this list lets
    // the user delete them (killing the timer) and the pmWatchdog
    // mistakes that deletion for a COMPLETED pomodoro leg
    // (state.pmDone++ → synced everywhere). Hidden from view only.
    // Wave 5: every kitchen timer's alarm ("tmr-…") is hidden the same way.
    var hidden = {};
    if (pmAlarmId) hidden[pmAlarmId] = true;
    var list = alarmsApi.list().filter(function (a) {
      return a && !hidden[a.id] && !(typeof a.id === "string" && a.id.indexOf("tmr-") === 0);
    })
      .sort(function (a, b) { return a.at - b.at; });
    if (!list.length) {
      var li0 = document.createElement("li");
      li0.className = "empty";
      li0.textContent = t("al.none");
      ul.appendChild(li0);
      return;
    }
    list.forEach(function (a) {
      var li = document.createElement("li");
      li.className = "z-row";
      var main = document.createElement("div");
      main.className = "a-main";
      var tm = document.createElement("span");
      tm.className = "z-time";
      tm.textContent = fmtAt(a.at);
      var lb = document.createElement("span");
      lb.className = "a-lbl";
      lb.textContent = a.label || "";
      main.appendChild(tm);
      if (a.repeat === "daily") {
        var rp = document.createElement("span");
        rp.className = "a-rep";
        rp.textContent = t("al.daily");
        main.appendChild(rp);
      }
      main.appendChild(lb);
      var del = document.createElement("button");
      del.type = "button";
      del.className = "a-del";
      del.textContent = "✕";
      del.addEventListener("click", function () {
        alarmsApi.remove(a.id);
        renderAlarms();
      });
      li.appendChild(main); li.appendChild(del);
      ul.appendChild(li);
    });
  }
  $("al-add").addEventListener("click", function () {
    var v = $("al-time").value;
    // Strict 24h "HH:MM" — reject AM/PM shapes outright (#5).
    // T2: no more silent return — the invalid time input shakes.
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) { shakeInput(["al-time"]); return; }
    var parts = v.split(":");
    var d = new Date();
    d.setHours(+parts[0], +parts[1], 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);   // tomorrow
    var id = alarmsApi.add({
      at: d.getTime(),
      label: $("al-label").value.trim(),
      repeat: $("al-daily").checked ? "daily" : "once"
    });
    if (!id) { shakeInput(["al-time"]); return; }   // T2: engine rejection — visible too
    // T2: clear BOTH fields on success — no stale residue re-submitted
    $("al-time").value = "";
    $("al-label").value = "";
    renderAlarms();
  });
  // Sound toggle is a synced scalar pref (part of the smtime family)
  $("al-sound").addEventListener("change", function () {
    state.sound = !!$("al-sound").checked;
    state.smtime = Date.now();
    saveState();
  });

  /* ---------- 8. Timers (wave 5: several, named, kitchen style) ---------- */
  // Each timer is device-local (oros-time-timers, see clock-core.js)
  // and, while it runs, owns ONE pending shell alarm with the id
  // "tmr-<timer>-<n>" at its end time. The shell engine rings it even
  // with Time closed (and the Android app's reminder rows include it,
  // since they read the same alarm list); the shell keeps "tmr-"
  // alarms out of sync, so a kitchen timer rings on this device only.
  // The shell reads the timer's sound from oros-time-timers by alarm id.
  var TMR_KEY = "oros-time-timers";
  var timers = [];
  var ovOff = {};                        // timer id → end it was dismissed for
  function tmrLoad() {
    try { timers = CC.timerNorm(JSON.parse(localStorage.getItem(TMR_KEY))); } catch (e) { timers = []; }
  }
  function tmrSave() {
    try {
      if (timers.length) localStorage.setItem(TMR_KEY, JSON.stringify(timers));
      else localStorage.removeItem(TMR_KEY);
    } catch (e) {}
  }
  function tmrNewId() { return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).slice(0, 16); }
  function tmrLabel(tm) { return tm.name || t("tm.done"); }
  function alarmAlive(id) {
    if (!id) return null;
    var hit = null;
    try { alarmsApi.list().forEach(function (a) { if (a && a.id === id) hit = a; }); } catch (e) {}
    return hit;
  }
  // Keep the shell alarm in step with the timer: one "tmr-" alarm while
  // it runs, none otherwise.
  function tmrArm(tm) {
    if (tm.aid) { try { alarmsApi.remove(tm.aid); } catch (e) {} tm.aid = ""; }
    if (tm.st !== "run" || tm.end <= Date.now()) return tm;
    var aid = "tmr-" + tm.id + "-" + Date.now().toString(36);
    var id = null;
    try { id = alarmsApi.add({ id: aid, at: tm.end, label: tmrLabel(tm), repeat: "once" }); } catch (e) { id = null; }
    tm.aid = id || "";
    return tm;
  }
  function tmrSet(id, fn) {
    var now = Date.now();
    timers = timers.map(function (tm) {
      if (tm.id !== id) return tm;
      var nx = fn(tm, now);
      if (nx === tm) return tm;
      var armed = nx.st !== tm.st || nx.end !== tm.end || (nx.st === "run" && nx.name !== tm.name);
      return armed ? tmrArm(nx) : nx;
    });
    tmrSave();
    tmrRender();
  }
  // Boot / visibility: running timers whose end passed → done; a
  // running timer whose alarm vanished (and is still ahead) gets a new
  // one; "tmr-" alarms no timer owns any more are removed.
  function tmrReconcile() {
    var now = Date.now(), r = CC.timerTick(timers, now), changed = r.changed;
    // A done timer keeps its alarm id: the shell looks the sound up by
    // it when it rings, which can be a second after the page saw the end.
    timers = r.list.map(function (tm) {
      if (tm.st === "run" && !alarmAlive(tm.aid)) { changed = true; return tmrArm(tm); }
      if ((tm.st === "idle" || tm.st === "pause") && tm.aid) { changed = true; return tmrArm(tm); }
      return tm;
    });
    var own = {};
    timers.forEach(function (tm) { if (tm.aid) own[tm.aid] = 1; });
    try {
      alarmsApi.list().forEach(function (a) {
        if (a && typeof a.id === "string" && a.id.indexOf("tmr-") === 0 && !own[a.id] && a.at > now) alarmsApi.remove(a.id);
      });
    } catch (e) {}
    if (changed) tmrSave();
    return changed;
  }
  // The voices, then the Ringtone Composer melodies ("rt:<id>", read
  // through the shell's orosMelodies; a deleted one keeps its row).
  function melodyList() {
    try {
      var M = window.parent && window.parent !== window && window.parent.orosMelodies;
      return M && typeof M.list === "function" ? M.list() : [];
    } catch (e) { return []; }
  }
  function soundOptions(sel, cur) {
    sel.innerHTML = "";
    var add = function (box, v, label) {
      var o = document.createElement("option");
      o.value = v;
      o.textContent = label;
      box.appendChild(o);
    };
    CC.SOUNDS.forEach(function (s) { add(sel, s, t("snd." + s)); });
    var mel = melodyList(), gone = /^rt:/.test(cur || "") && !mel.some(function (m) { return "rt:" + m.id === cur; });
    if (mel.length || gone) {
      var g = document.createElement("optgroup");
      g.label = t("snd.melodies");
      mel.forEach(function (m) { add(g, "rt:" + m.id, m.name || "…"); });
      if (gone) add(g, cur, t("snd.gone"));
      sel.appendChild(g);
    }
    sel.value = cur || "beep";
  }
  // Preview: the shell's alarm voices when inside orOS, else a beep.
  function playSound(name) {
    try {
      if (window.parent && window.parent !== window && typeof window.parent.orosAlarmSound === "function") {
        window.parent.orosAlarmSound(name);
        return;
      }
    } catch (e) {}
    var was = state.sound;
    state.sound = true;
    beep(2);
    state.sound = was;
  }
  function tmrAddNew(ms, name, sound) {
    if (timers.length >= CC.MAX_TIMERS) { shakeInput(["tm-min"]); return false; }
    var n = 1, names = {};
    timers.forEach(function (tm) { names[tm.name] = 1; });
    var nm = String(name || "").trim();
    if (!nm) { while (names[t("tm.dflt").replace("{n}", n)]) n++; nm = t("tm.dflt").replace("{n}", n); }
    var tm = CC.timerNew(tmrNewId(), nm, ms, sound);
    tm = tmrArm(CC.timerStart(tm, Date.now()));
    timers.push(tm);
    tmrSave();
    tmrRender();
    return true;
  }
  // Command bar (commands/core.js, BR-CMD): { timer: { sec, label } }
  // starts a timer at once (the user's Enter in the bar is the Start
  // tap; Reset / ✕ undo it); { alarm: { at "HH:MM", label, daily } }
  // only fills the Alarm form, the user still presses Add. Called by
  // astro.js's __orosOpenAt receiver; true when the target was ours.
  window.__orosTimeCmd = function (tg) {
    if (!tg || typeof tg !== "object") return false;
    if (tg.timer && typeof tg.timer === "object") {
      var sec = tg.timer.sec;
      if (typeof sec !== "number" || !(sec >= 1) || sec > 360000) return true;
      if (typeof window.__orosTimeOpen === "function") window.__orosTimeOpen("timer");
      tmrAddNew(Math.round(sec) * 1000, typeof tg.timer.label === "string" ? tg.timer.label.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 40) : "");
      return true;
    }
    if (tg.alarm && typeof tg.alarm === "object") {
      var at = tg.alarm.at;
      if (typeof at !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) return true;
      if (typeof window.__orosTimeOpen === "function") window.__orosTimeOpen("alarm");
      $("al-time").value = at;
      $("al-label").value = typeof tg.alarm.label === "string" ? tg.alarm.label.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 60) : "";
      $("al-daily").checked = tg.alarm.daily === true;
      try { $("al-add").focus(); } catch (e) {}
      return true;
    }
    return false;
  };

  function tmrBtn(cls, text, fn, label) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = text;
    if (label) { b.title = label; b.setAttribute("aria-label", label); }
    b.addEventListener("click", fn);
    return b;
  }
  function tmrRender() {
    var ul = $("tmr-list");
    ul.innerHTML = "";
    if (!timers.length) {
      var li0 = document.createElement("li");
      li0.className = "empty";
      li0.textContent = t("tm.none");
      ul.appendChild(li0);
    }
    timers.forEach(function (tm) {
      var li = document.createElement("li");
      li.className = "tmr st-" + tm.st;
      li.setAttribute("data-id", tm.id);
      var top = document.createElement("div");
      top.className = "tmr-top";
      var nm = document.createElement("input");
      nm.type = "text";
      nm.className = "tmr-name";
      nm.maxLength = 40;
      nm.value = tm.name;
      nm.setAttribute("aria-label", t("tm.name"));
      nm.addEventListener("change", function () {
        var v = this.value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 40);
        tmrSet(tm.id, function (x) { return v === x.name ? x : Object.assign({}, x, { name: v }); });
      });
      top.appendChild(nm);
      top.appendChild(tmrBtn("a-del", "✕", function () {
        timers = timers.filter(function (x) {
          if (x.id === tm.id && x.aid) { try { alarmsApi.remove(x.aid); } catch (e) {} }
          return x.id !== tm.id;
        });
        tmrSave();
        tmrRender();
      }, t("tm.del")));
      li.appendChild(top);
      var tv = document.createElement("div");
      tv.className = "tmr-time";
      li.appendChild(tv);
      var sub = document.createElement("div");
      sub.className = "tmr-sub";
      li.appendChild(sub);
      var bar = document.createElement("div");
      bar.className = "tmr-bar";
      bar.appendChild(document.createElement("span"));
      li.appendChild(bar);
      var ctl = document.createElement("div");
      ctl.className = "tmr-ctl";
      var goTxt = tm.st === "run" ? t("tm.pause") : tm.st === "pause" ? t("tm.resume") : tm.st === "done" ? t("tm.restart") : t("tm.start");
      ctl.appendChild(tmrBtn("btn prim", goTxt, function () {
        ensureAudio();
        tmrSet(tm.id, function (x, now) { return x.st === "run" ? CC.timerPause(x, now) : CC.timerStart(x, now); });
      }));
      ctl.appendChild(tmrBtn("btn", t("tm.plus"), function () {
        tmrSet(tm.id, function (x, now) { return CC.timerAdd(x, 60000, now); });
      }));
      var rs = tmrBtn("btn", t("tm.reset"), function () {
        tmrSet(tm.id, function (x) { return CC.timerReset(x); });
      });
      if (tm.st === "idle" && tm.left === tm.dur) rs.disabled = true;
      ctl.appendChild(rs);
      var snd = document.createElement("select");
      snd.className = "tmr-snd";
      snd.setAttribute("aria-label", t("tm.sound"));
      soundOptions(snd, tm.sound);
      snd.addEventListener("change", function () {
        var v = this.value;
        playSound(v);
        tmrSet(tm.id, function (x) { return Object.assign({}, x, { sound: v }); });
      });
      ctl.appendChild(snd);
      li.appendChild(ctl);
      ul.appendChild(li);
    });
    tmrPaint();
  }
  // Per tick: numbers, bars, the overlay; a timer that just ended → done.
  function tmrPaint() {
    var now = Date.now();
    var r = CC.timerTick(timers, now);
    if (r.changed) {
      timers = r.list;
      tmrSave();
      tmrRender();
      return;
    }
    var soon = null;
    timers.forEach(function (tm) {
      var li = document.querySelector('#tmr-list .tmr[data-id="' + tm.id + '"]');
      if (!li) return;
      var left = CC.timerLeft(tm, now);
      var tv = li.querySelector(".tmr-time"), sub = li.querySelector(".tmr-sub"), bar = li.querySelector(".tmr-bar span");
      var txt = CC.fmtTimer(left);
      if (tv.textContent !== txt) tv.textContent = txt;
      var s = tm.st === "done" ? t("tm.ended") : t("tm.of").replace("{t}", CC.fmtTimer(tm.tot)) + (tm.st === "pause" ? " · " + t("tm.paused") : "");
      if (sub.textContent !== s) sub.textContent = s;
      bar.style.width = (CC.timerProgress(tm, now) * 100).toFixed(2) + "%";
      if (tm.st === "run" && tm.tot >= 120000 && left > 0 && left <= 60000 && ovOff[tm.id] !== tm.end && (!soon || tm.end < soon.end)) soon = tm;
    });
    // #4 countdown overlay: the soonest timer's last 60 s fill the screen
    // (timers of 2 minutes or more; a short one would open on it at once)
    var ov = $("tm-overlay");
    if (soon) {
      ov.hidden = false;
      ov.setAttribute("data-id", soon.id);
      $("tm-ov-name").textContent = soon.name;
      $("tm-ov-time").textContent = CC.fmtTimer(CC.timerLeft(soon, now));
    } else if (!ov.hidden) {
      ov.hidden = true;
    }
  }
  function tmrInputs() {
    var h = Math.max(0, Math.min(99, parseInt($("tm-hr").value, 10) || 0));
    var m = Math.max(0, Math.min(59, parseInt($("tm-min").value, 10) || 0));
    var s = Math.max(0, Math.min(59, parseInt($("tm-sec").value, 10) || 0));
    return ((h * 60 + m) * 60 + s) * 1000;
  }
  $("tm-start").addEventListener("click", function () {
    ensureAudio();
    var ms = tmrInputs();
    if (ms <= 0) {
      // T6: no silent no-op — the inputs shake so the user sees why.
      shakeInput(["tm-min", "tm-sec"]);
      return;
    }
    if (tmrAddNew(ms, $("tm-name").value, $("tm-sound").value)) $("tm-name").value = "";
  });
  $("tm-name").addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") { ev.preventDefault(); $("tm-start").click(); }
  });
  $("tm-sound").addEventListener("change", function () { playSound(this.value); });
  function tmrPresets() {
    var host = $("tm-presets");
    host.innerHTML = "";
    [1, 3, 5, 10, 15, 30].forEach(function (n) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "qchip";
      b.textContent = "+ " + t("tm.preset").replace("{n}", n);
      b.addEventListener("click", function () {
        ensureAudio();
        tmrAddNew(n * 60000, $("tm-name").value, $("tm-sound").value);
        $("tm-name").value = "";
      });
      host.appendChild(b);
    });
  }
  function ovDismiss() {
    var ov = $("tm-overlay"), id = ov.getAttribute("data-id");
    timers.forEach(function (tm) { if (tm.id === id) ovOff[id] = tm.end; });
    ov.hidden = true;
  }
  // Clicking the overlay dismisses it for THIS run (timer keeps going)
  $("tm-overlay").addEventListener("click", ovDismiss);
  // T3: Escape dismisses the fullscreen countdown the same way —
  // keyboard parity with the click, the timer keeps running.
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && !$("tm-overlay").hidden) {
      ovDismiss();
      ev.preventDefault();
    }
  });
  // Another tab / the shell may change the timers or alarms.
  window.addEventListener("storage", function (ev) {
    if (ev.key === TMR_KEY) { tmrLoad(); tmrRender(); }
    if (ev.key === SW_KEY) { swLoad(); swRender(); }
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") { tmrLoad(); tmrReconcile(); tmrRender(); swLoad(); swRender(); }
  });

  /* ---------- 9. Stopwatch (wave 5: laps, survives closing) ---------- */
  // Device-local oros-time-sw { run, start, base, laps } — computed
  // from the wall clock, so it keeps counting with Time (or orOS)
  // closed and resumes at the right value.
  var SW_KEY = "oros-time-sw";
  var sw = CC.swReset(), swRaf = 0;
  function swLoad() {
    try { sw = CC.swNorm(JSON.parse(localStorage.getItem(SW_KEY))); } catch (e) { sw = CC.swReset(); }
  }
  function swSave() {
    try {
      if (!sw.run && !sw.base && !sw.laps.length) localStorage.removeItem(SW_KEY);
      else localStorage.setItem(SW_KEY, JSON.stringify(sw));
    } catch (e) {}
  }
  function swPaint() {
    var now = Date.now(), el = CC.swElapsed(sw, now);
    $("st-display").textContent = CC.fmtSw(el);
    var ln = $("st-lapnow");
    if (sw.laps.length && (sw.run || el > sw.laps[sw.laps.length - 1])) {
      ln.hidden = false;
      ln.textContent = t("st.lap") + " " + (sw.laps.length + 1) + " · " + CC.fmtSw(el - sw.laps[sw.laps.length - 1]);
    } else {
      ln.hidden = true;
    }
  }
  function swRender() {
    $("st-go").textContent = t(sw.run ? "st.stop" : "st.start");
    $("st-lap").disabled = !sw.run;
    $("st-reset").disabled = sw.run || (!sw.base && !sw.laps.length);
    var ol = $("st-laps");
    ol.innerHTML = "";
    var rows = CC.lapRows(sw.laps);
    rows.slice().reverse().forEach(function (r) {
      var li = document.createElement("li");
      li.className = "st-lap-row" + (r.best ? " best" : "") + (r.worst ? " worst" : "");
      var n = document.createElement("span");
      n.className = "st-n";
      n.textContent = t("st.lap") + " " + r.n;
      var tag = document.createElement("span");
      tag.className = "st-tag";
      tag.textContent = r.best ? t("st.best") : r.worst ? t("st.worst") : "";
      var lp = document.createElement("span");
      lp.className = "st-lt";
      lp.textContent = CC.fmtSw(r.lap);
      var tot = document.createElement("span");
      tot.className = "st-tt";
      tot.textContent = CC.fmtSw(r.total);
      li.appendChild(n); li.appendChild(tag); li.appendChild(lp); li.appendChild(tot);
      ol.appendChild(li);
    });
    $("st-exp").hidden = !rows.length;
    swPaint();
    swLoop();
  }
  // Smooth hundredths while the Stopwatch tab is on screen.
  function swLoop() {
    if (swRaf || !sw.run || typeof requestAnimationFrame !== "function") return;
    var step = function () {
      swRaf = 0;
      if (!sw.run || $("pane-stop").hidden || document.hidden) return;
      swPaint();
      swRaf = requestAnimationFrame(step);
    };
    swRaf = requestAnimationFrame(step);
  }
  $("st-go").addEventListener("click", function () {
    sw = CC.swToggle(sw, Date.now());
    swSave();
    swRender();
  });
  $("st-lap").addEventListener("click", function () {
    sw = CC.swLap(sw, Date.now());
    swSave();
    swRender();
  });
  $("st-reset").addEventListener("click", function () {
    if (sw.run) return;
    sw = CC.swReset();
    swSave();
    swRender();
  });
  function lapRowsNow() {
    var rows = CC.lapRows(sw.laps);
    // A stopped watch past its last lap: the rest counts as a final lap.
    var el = CC.swElapsed(sw, Date.now());
    if (!sw.run && rows.length && el > rows[rows.length - 1].total) rows = CC.lapRows(sw.laps.concat([el]));
    return rows;
  }
  $("st-copy").addEventListener("click", function () {
    var text = CC.lapsText(lapRowsNow(), { title: t("st.title"), lap: t("st.lap") });
    copyText(text, this, "st.copied");
  });
  function saveCsv(text, name) {
    var host = null;
    try { host = window.orosDialog || window.parent.orosDialog || null; } catch (e) { host = null; }
    if (host && typeof host.saveFile === "function") {
      host.saveFile({ text: text, filename: name, mime: "text/csv", types: [{ description: "CSV", accept: { "text/csv": [".csv"] } }] });
      return;
    }
    var url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 40000);
  }
  $("st-csv").addEventListener("click", function () {
    var d = new Date();
    var name = "oros-stopwatch-" + d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
               "-" + pad(d.getHours()) + pad(d.getMinutes()) + ".csv";
    saveCsv("﻿" + CC.lapsCsv(lapRowsNow(), [t("st.lap"), t("st.laptime"), t("st.total"), t("st.lap") + " (ms)", t("st.total") + " (ms)"]), name);
  });

  /* ---------- 10. Pomodoro ---------- */
  var pmPhase = "work", pmRunning = false, pmEnd = 0, pmAlarmId = null;
  var pmStart = 0, pmLogged = false;   // Wave 7: the focus leg logged in Timesheet

  /* ---------- 10a. Timesheet link (Timesheet Wave 7, BR-TS-POMO) ---------- */
  // Time never writes Timesheet's data. A focus leg is put in the
  // device-local inbox (orosTimesheetCore.INBOX_KEY) when it starts,
  // with its planned end; Timesheet turns it into an entry once the
  // end has passed. The chosen project is a device-local pref.
  var TS = window.orosTimesheetCore || null;
  var PMLOG_KEY = "oros-time-pmlog";   // "" off · "-" no project · a project id
  function pmLogPref() {
    try { var v = localStorage.getItem(PMLOG_KEY); return typeof v === "string" ? v : ""; } catch (e) { return ""; }
  }
  function pmLogProjects() {
    if (!TS) return [];
    var d = null;
    try { d = TS.parse(localStorage.getItem(TS.STORAGE_KEY)); } catch (e) { d = null; }
    if (!d) return [];
    return TS.live(d.projects).filter(function (p) { return !p.arch; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, locTag()); });
  }
  function pmLogFill() {
    var sel = $("pm-log");
    if (!TS || !sel) return;
    $("pm-log-w").hidden = false;
    var cur = pmLogPref(), projects = pmLogProjects();
    sel.innerHTML = "";
    var add = function (v, label) {
      var o = document.createElement("option");
      o.value = v;
      o.textContent = label;
      sel.appendChild(o);
    };
    add("", t("pm.log.off"));
    add("-", t("pm.log.none"));
    projects.forEach(function (p) { add(p.id, p.name); });
    sel.value = cur;
    if (sel.value !== cur) sel.value = "";      // a deleted / archived project → off
    $("pm-log-hint").hidden = !sel.value;
  }
  function pmInbox(fn) {
    if (!TS) return;
    try {
      var list = fn(TS.inboxRead(localStorage.getItem(TS.INBOX_KEY)));
      if (list.length) localStorage.setItem(TS.INBOX_KEY, JSON.stringify(list));
      else localStorage.removeItem(TS.INBOX_KEY);
    } catch (e) {}
  }
  // A focus leg starts: log it with its planned end.
  function pmLogStart() {
    pmLogged = false;
    var v = TS ? $("pm-log").value : "";
    if (pmPhase !== "work" || !v) return;
    var p = v === "-" ? "" : v;
    pmInbox(function (list) { return TS.inboxPut(list, { s: pmStart, e: pmEnd, p: p }); });
    pmLogged = true;
  }
  // Stopped by hand: the entry ends now (dropped under a minute).
  function pmLogStop() {
    if (!pmLogged) return;
    var now = Date.now();
    pmInbox(function (list) { return TS.inboxEnd(list, pmStart, now); });
    pmLogged = false;
  }
  if ($("pm-log")) {
    $("pm-log").addEventListener("change", function () {
      try { localStorage.setItem(PMLOG_KEY, this.value); } catch (e) {}
      $("pm-log-hint").hidden = !this.value;
    });
  }
  function pmLen() { return (pmPhase === "work" ? state.pmWork : state.pmBreak) * 60 * 1000; }
  function pmPaint() {
    var left = pmRunning ? Math.max(0, pmEnd - Date.now()) : pmLen();
    var sec = Math.ceil(left / 1000);
    $("pm-display").textContent = pad(Math.floor(sec / 60)) + ":" + pad(sec % 60);
    $("pm-phase").textContent = t(pmPhase === "work" ? "pm.phase.work" : "pm.phase.break");
    $("pm-count").textContent = t("pm.done").replace("{n}", state.pmDone);
    $("pm-start").textContent = t(pmRunning ? "st.stop" : "pm.start");
  }
  function pmStop() {
    if (pmRunning) pmLogStop();
    pmRunning = false;
    if (pmAlarmId) { alarmsApi.remove(pmAlarmId); pmAlarmId = null; }
    pmRunSave();      // T4: stopped by hand — clear the runtime record
    pmPaint();
  }
  $("pm-start").addEventListener("click", function () {
    if (pmRunning) { pmStop(); return; }
    pmStart = Date.now();
    pmEnd = pmStart + pmLen();
    var id = alarmsApi.add({
      at: pmEnd,
      label: t(pmPhase === "work" ? "pm.phase.break" : "pm.phase.work")
    });
    if (!id) { pmRunning = false; pmPaint(); return; }   // engine rejected — stay idle
    pmRunning = true;
    pmAlarmId = id;
    pmLogStart();
    pmRunSave();      // T4: the leg must survive an app close
    pmPaint();
  });
  $("pm-reset").addEventListener("click", function () {
    pmStop();
    pmPhase = "work";
    pmPaint();
  });
  ["pm-work", "pm-break"].forEach(function (id) {
    $(id).addEventListener("change", function () {
      state.pmWork  = Math.min(120, Math.max(1, parseInt($("pm-work").value, 10)  || 25));
      state.pmBreak = Math.min(60,  Math.max(1, parseInt($("pm-break").value, 10) || 5));
      $("pm-work").value = state.pmWork;
      $("pm-break").value = state.pmBreak;
      state.smtime = Date.now();
      saveState();
      if (!pmRunning) pmPaint();
    });
  });

  // Detect a pomodoro leg FINISHED by the shell engine while this
  // page was open: our alarm vanished from the list → advance.
  function pmWatchdog() {
    if (!pmRunning) return;
    if (pmAlarmId && alarmsApi.list().every(function (a) { return a.id !== pmAlarmId; })) {
      if (pmPhase === "work") { state.pmDone++; saveState(); }
      pmPhase = pmPhase === "work" ? "break" : "work";
      pmRunning = false;
      pmAlarmId = null;
      pmLogged = false;   // finished: the inbox entry keeps its planned end
      pmRunSave();    // T4: leg finished live — clear the runtime record
      pmPaint();
    }
  }

  /* ---------- 10b. Pomodoro runtime persistence (T4) ---------- */
  // Runtime is device-local BY DESIGN (the sync blob carries pmDone,
  // never the live leg — section 14 doctrine holds). The leg record
  // lives in its own key so a close mid-leg reconciles at boot:
  // fired while closed → the session counts (pmDone syncs like any
  // edit); still running → the countdown resumes against the SAME
  // engine alarm. Swept by the factory reset ("oros-" prefix),
  // never synced.
  var PMRUN_KEY = "oros-time-pmrun";

  function pmRunSave() {
    try {
      if (!pmRunning) { localStorage.removeItem(PMRUN_KEY); return; }
      localStorage.setItem(PMRUN_KEY, JSON.stringify({
        phase: pmPhase, end: pmEnd, alarmId: pmAlarmId, start: pmStart, logged: pmLogged ? 1 : 0
      }));
    } catch (e) {}
  }

  function pmRunRestore() {
    var rt = null;
    try { rt = JSON.parse(localStorage.getItem(PMRUN_KEY)); } catch (e) { return; }
    if (!rt || typeof rt.end !== "number" || !isFinite(rt.end)) return;
    if (rt.end > Date.now()) {
      // Leg still running: resume only if the engine alarm survived
      var alive = rt.alarmId && alarmsApi.list().some(function (a) {
        return a.id === rt.alarmId;
      });
      if (alive) {
        pmPhase = rt.phase === "break" ? "break" : "work";
        pmRunning = true;
        pmEnd = rt.end;
        pmAlarmId = rt.alarmId;
        pmStart = typeof rt.start === "number" ? rt.start : 0;
        pmLogged = !!(rt.logged && pmStart);
        pmPaint();
      } else {
        localStorage.removeItem(PMRUN_KEY);   // orphaned record — drop
      }
      return;
    }
    // Leg FIRED while the app was closed — count it, advance phase
    if (rt.phase === "work") { state.pmDone++; saveState(); }
    pmPhase = rt.phase === "work" ? "break" : "work";
    pmRunning = false;
    pmAlarmId = null;
    localStorage.removeItem(PMRUN_KEY);
    pmPaint();
  }

  /* ---------- 11. Faces wiring ---------- */
  for (var si = 0; si < 5; si++) {
    (function (idx) {
      $("sty-" + idx).addEventListener("click", function () {
        state.style = idx;
        state.smtime = Date.now();
        saveState();
        applyStyle();
      });
    })(si);
  }

  /* ---------- 12. Converter ---------- */
  // Shows each zone + local device time side by side. Off by
  // default: the section head with its Show/Hide button always shows,
  // only the row is hidden. (Before 4.66.01 the whole section was
  // hidden, button included, so the converter could not be opened.)
  var convOn = false;
  function convRender() {
    if (!convOn) return;
    var host = $("conv-display");
    host.innerHTML = "";
    var cells = [];
    var mine = document.createElement("span");
    mine.className = "conv-cell";
    var mc = document.createElement("span"); mc.className = "conv-city"; mc.textContent = t("conv.local");
    var mt = document.createElement("span"); mt.className = "conv-t"; mt.textContent = pad(new Date().getHours()) + ":" + pad(new Date().getMinutes());
    mine.appendChild(mc); mine.appendChild(mt);
    cells.push(mine);
    state.zones.forEach(function (zc, i) {
      var ar = document.createElement("span");
      ar.className = "conv-arrow";
      ar.textContent = "↔";
      cells.push(ar);
      var cell = document.createElement("span");
      cell.className = "conv-cell";
      var c = document.createElement("span"); c.className = "conv-city"; c.textContent = zoneName(zc.tz);
      var v = document.createElement("span"); v.className = "conv-t";
      try { v.textContent = zFmt(zc.tz).format(new Date()); } catch (e) { v.textContent = "--:--"; }
      cell.appendChild(c); cell.appendChild(v);
      cells.push(cell);
    });
    cells.forEach(function (el) { host.appendChild(el); });
  }
  function convSync() {
    $("conv-display").hidden = !convOn;
    $("conv-toggle").setAttribute("aria-expanded", convOn ? "true" : "false");
    $("conv-toggle").textContent = t(convOn ? "conv.toggle.hide" : "conv.toggle.show");
    if (convOn) convRender();
  }
  $("conv-toggle").addEventListener("click", function () {
    convOn = !convOn;
    state.convOn = convOn;          // #7: travels in the smtime scalar family
    state.smtime = Date.now();
    saveState();
    convSync();
  });

  /* ---------- 12b. Contract B: shell shortcut forwarding ---------- */
  // Ctrl+Alt+Shift+<letter> combos are SHELL-owned (push/pull/
  // snapshot/export/info/updates/lang/reconnect). Focus inside
  // this iframe hides keystrokes from the parent document — the
  // capture-phase forward hands the raw event to the shell's
  // handler, which decides (the editable-target yield guard Χ5
  // lives there). Parity with todo/kanban/notes/writer.
  document.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
    var p = window.parent;
    if (!(p && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
    if (p.orosShortcuts.handle(e)) e.stopPropagation();
  }, true);

  /* ---------- 13. Master tick + boot ---------- */
  function tick() {
    var now = new Date();
    var s = state.style;
    if (s === 0) {
      $("big-hm").textContent = pad(now.getHours()) + ":" + pad(now.getMinutes());
      $("big-ss").textContent = pad(now.getSeconds());
    } else if (s === 1) {
      renderAnalog(now);
    } else if (s === 2) {
      renderBinary(now);
    } else if (s === 3) {
      renderFlip(now);
    } else {
      renderNeon(now);
    }
    // T3: face-sub (date + UTC offset) and the converter show
    // MINUTE-granularity values — painting them 4×/s rebuilt the
    // whole converter DOM for nothing. Gated on the same minute
    // boundary the alarm list already uses.
    var minuteKey = now.getHours() * 60 + now.getMinutes();
    if (minuteKey !== lastSubKey) { lastSubKey = minuteKey; renderSub(now); }
    zoneTick();
    if (convOn && minuteKey !== lastConvKey) { lastConvKey = minuteKey; convRender(); }
    tmrPaint();
    if (!swRaf) swPaint();
    if (pmRunning) {
      var left = Math.max(0, pmEnd - Date.now());
      var sec = Math.ceil(left / 1000);
      $("pm-display").textContent = pad(Math.floor(sec / 60)) + ":" + pad(sec % 60);
    }
    pmWatchdog();
    // Minute-boundary refresh of the alarm list ordering (once per minute)
    if (minuteKey !== lastMinuteKey) { lastMinuteKey = minuteKey; renderAlarms(); }
  }

  // Boot
  loadState();
  applyI18n();
  buildBinary();
  buildAnalog();
  buildFlip();
  buildNeon();
  applyStyle();
  $("al-sound").checked = state.sound;
  renderZones();
  renderAlarms();
  convOn = state.convOn;            // loadState ran above — safe to adopt now
  convSync();
  $("pm-work").value = state.pmWork;
  $("pm-break").value = state.pmBreak;
  pmPaint();
  pmLogFill();
  pmRunRestore();   // T4: reconcile a leg that fired/ran while closed
  // Wave 5: timers, stopwatch, meeting planner
  soundOptions($("tm-sound"), "beep");
  tmrPresets();
  tmrLoad();
  tmrReconcile();
  tmrRender();
  swLoad();
  swRender();
  planLoad();
  planFillLens();
  planOpenSync();
  tick();
  setInterval(tick, 250);   // smooth hands + fast bit-flips, trivial cost
  // #5: version derives from the cache-bust query (?v=…) — the
  // GitHub Action aligns it with shell.js, the single source of
  // truth. Never hardcoded: stale-bundle debugging relies on the
  // log matching the ACTUALLY loaded bundle.
  var SCRIPT_V = "0.1.1";
  try {
    var vm = document.currentScript && String(document.currentScript.src).match(/[?&]v=([^&]+)/);
    if (vm) SCRIPT_V = decodeURIComponent(vm[1]);
  } catch (e) {}
  console.log("[orOS] time.js v" + SCRIPT_V + " booted — styles 0–4, sound " + state.sound);

  /* ---------- 14. Sync slice registration ---------- */
  // Entity union for zones (tombstoned deletes, idempotent), LWW for
  // scalar prefs (style incl. flip/neon, sound, pomodoro durations)
  // via smtime, max() for the pmDone counter. Everything
  // deterministic (sorted output, lexical tie-breaks) — the engine
  // contract. Timer/stopwatch/pomodoro RUNTIME and alarms are
  // deliberately OUT of the slice: runtime state, device-local truth.

  function mergeTime(local, remote) {
    function pick(base) {
      if (!base || typeof base !== "object") return { zones: [], tombs: [] };
      return {
        zones: (Array.isArray(base.zones) ? base.zones : []).map(sanitizeZone).filter(Boolean),
        tombs: (Array.isArray(base.zonesDeleted) ? base.zonesDeleted : []).map(sanitizeZoneTomb).filter(Boolean)
      };
    }
    var a = pick(local), b = pick(remote);

    var tomb = {};
    a.tombs.concat(b.tombs).forEach(function (d) {
      if (!tomb[d.tz] || d.mtime > tomb[d.tz].mtime) tomb[d.tz] = d;
    });
    var zone = {};
    // Equal stamps (wave 5): the version with a city wins (a pre-wave-5
    // device drops the field), then the larger JSON — the same result
    // on every device, whatever the order.
    a.zones.concat(b.zones).forEach(function (z) {
      var cur = zone[z.tz];
      if (!cur || z.mtime > cur.mtime) { zone[z.tz] = z; return; }
      if (z.mtime < cur.mtime) return;
      var zc = z.city ? 1 : 0, cc = cur.city ? 1 : 0;
      if (zc !== cc) { if (zc > cc) zone[z.tz] = z; return; }
      if (JSON.stringify(z) > JSON.stringify(cur)) zone[z.tz] = z;
    });

    var zones = [], zonesDeleted = [];
    Object.keys(zone).forEach(function (tz) {
      if (tomb[tz] && tomb[tz].mtime >= zone[tz].mtime) return;   // delete wins (ties included)
      zones.push(zone[tz]);
      delete tomb[tz];                                            // survived/re-added
    });
    Object.keys(tomb).forEach(function (tz) { zonesDeleted.push(tomb[tz]); });
    zones.sort(function (x, y) { return x.tz < y.tz ? -1 : 1; });
    zonesDeleted.sort(function (x, y) { return x.tz < y.tz ? -1 : 1; });

    // Scalars: whole family from the side with newer smtime; ties
    // broken by lexical JSON (identical output on every device).
    var la = local || {}, rb = remote || {};
    var las = (typeof la.smtime === "number" && isFinite(la.smtime)) ? la.smtime : 0;
    var rbs = (typeof rb.smtime === "number" && isFinite(rb.smtime)) ? rb.smtime : 0;
    var pickLocal;
    if (las !== rbs) pickLocal = las > rbs;
    else pickLocal = JSON.stringify([la.style || 0, la.pmWork || 25, la.pmBreak || 5, la.sound !== false, la.convOn === true]) <=
                     JSON.stringify([rb.style || 0, rb.pmWork || 25, rb.pmBreak || 5, rb.sound !== false, rb.convOn === true]);

    var mA = (la.astro && typeof la.astro.lat === "number" && typeof la.astro.lon === "number") ? la.astro : null;
    var mB = (rb.astro && typeof rb.astro.lat === "number" && typeof rb.astro.lon === "number") ? rb.astro : null;
    var astro;
    if (mA && mB) {
      // TM-2: equal stamps → lexical JSON (was "local wins": two
      // devices could each keep their own copy)
      if ((mA.mtime || 0) !== (mB.mtime || 0)) astro = ((mB.mtime || 0) > (mA.mtime || 0)) ? mB : mA;
      else astro = JSON.stringify(mA) >= JSON.stringify(mB) ? mA : mB;
    } else {
      astro = mA || mB || null;
    }
    // #1: deletion tombstone — Clear on one device must reach the
    // others. Tomb wins on tie (zone-tombstone contract).
    var tA = (typeof la.astroTomb === "number" && isFinite(la.astroTomb)) ? la.astroTomb : 0;
    var tB = (typeof rb.astroTomb === "number" && isFinite(rb.astroTomb)) ? rb.astroTomb : 0;
    var astroTomb = Math.max(tA, tB);
    // TM-2: no tombstone (0) never erases a location — a location
    // saved before stamps existed (mtime 0) was dropped by every merge.
    if (astro && astroTomb > 0 && astroTomb >= (astro.mtime || 0)) astro = null;
    if (astro) astro = { lat: astro.lat, lon: astro.lon, mtime: (typeof astro.mtime === "number" && isFinite(astro.mtime)) ? astro.mtime : 0 };

    return {
      ver: 1,
      style:  pickLocal ? Math.min(4, la.style || 0) : Math.min(4, rb.style || 0),
      sound:  pickLocal ? (la.sound !== false) : (rb.sound !== false),
      convOn: pickLocal ? (la.convOn === true) : (rb.convOn === true),
      pmWork: pickLocal ? (la.pmWork || 25) : (rb.pmWork || 25),
      pmBreak: pickLocal ? (la.pmBreak || 5) : (rb.pmBreak || 5),
      pmDone: Math.max(la.pmDone || 0, rb.pmDone || 0),
      smtime: Math.max(las, rbs),
      zones: zones,
      zonesDeleted: zonesDeleted,
      astro: astro,
      astroTomb: astroTomb
    };
  }

  // TM-1: ONE canonical form for getter, storage and merge output
  // (fixed key order, zones / tombstones sorted by tz). The engine
  // compares JSON strings: any other order is "changed" every cycle.
  function canonTime(s) {
    return mergeTime(s, s);
  }

  // Pull-fed setter: validates, adopts, repaints. NEVER markDirty
  // (pull → set → push would loop; the engine owns dirtiness here).
  function setFromSync(data) {
    if (!data || typeof data !== "object") return;
    state.style   = (typeof data.style === "number" && data.style >= 0 && data.style <= 4) ? data.style : state.style;
    state.sound   = (typeof data.sound === "boolean") ? data.sound : state.sound;
    state.pmWork  = Math.min(120, Math.max(1, (typeof data.pmWork === "number") ? data.pmWork : state.pmWork));
    state.pmBreak = Math.min(60,  Math.max(1, (typeof data.pmBreak === "number") ? data.pmBreak : state.pmBreak));
    state.pmDone  = (typeof data.pmDone === "number") ? data.pmDone : state.pmDone;
    state.convOn  = (typeof data.convOn === "boolean") ? data.convOn : state.convOn;
    state.astroTomb = (typeof data.astroTomb === "number" && isFinite(data.astroTomb))
      ? data.astroTomb : state.astroTomb;
    state.smtime  = (typeof data.smtime === "number" && isFinite(data.smtime)) ? data.smtime : state.smtime;
    if (data.astro && typeof data.astro.lat === "number" && typeof data.astro.lon === "number") {
      state.astro = { lat: data.astro.lat, lon: data.astro.lon, mtime: data.astro.mtime || 0 };
    } else if ("astro" in data) {
      // Ετυμηγορία merge: το tombstone νίκησε → υιοθετείται ΚΑΙ η
      // διαγραφή. Το "astro" in data κρατά ασφαλές raw remote blob
      // χωρίς το κλειδί (παλιά carry) — εκεί δεν αγγίζουμε το τοπικό.
      state.astro = null;
    }
    state.zones        = (Array.isArray(data.zones) ? data.zones : []).map(sanitizeZone).filter(Boolean);
    state.zonesDeleted = (Array.isArray(data.zonesDeleted) ? data.zonesDeleted : []).map(sanitizeZoneTomb).filter(Boolean);
    try { localStorage.setItem(DATA_KEY, JSON.stringify(canonTime(state))); } catch (e) {}   // TM-1
    applyStyle();
    $("al-sound").checked = state.sound;
    // TM-6: a field the user is typing in is not overwritten by a pull
    // (its change event would then save the pulled value as an edit)
    if (document.activeElement !== $("pm-work")) $("pm-work").value = state.pmWork;
    if (document.activeElement !== $("pm-break")) $("pm-break").value = state.pmBreak;
    pmPaint();
    convOn = state.convOn;
    convSync();
    renderZones();
  }

  try {
    if (window.parent && window.parent.orosSync &&
        typeof window.parent.orosSync.registerSlice === "function") {
      window.parent.orosSync.registerSlice(
        "time",
        function () {     // getter: localStorage is the durable truth
          // TM-1: canonical — exactly what mergeTime returns for it
          var s;
          try { s = JSON.parse(localStorage.getItem(DATA_KEY)) || state; }
          catch (e) { s = state; }
          return canonTime(s);
        },
        setFromSync,
        DATA_KEY,          // persisted → closed-app proxies on next boots
        mergeTime
      );
    }
  } catch (e) { /* standalone preview — sync simply absent */ }
})();

// ===== orOS deep-link receiver (Wave 6 / #T3) =====
// Consumed by shell.js (__orosOpenTime) and notifications.js
// (DL_BRIDGES → "time:<target>"). Depends ONLY on the time.html
// DOM contract (.tab[data-pane] click switching) — no internals
// of this file are touched. Panes: pane-alarm / pane-timer /
// pane-stop / pane-pomo / pane-stage.
(function () {
  "use strict";

  // Shorthands from notification deepLinks + full pane ids pass
  // through unchanged ("alarms" → the alarm tab, etc.).
  var PANE_MAP = {
    alarms:   "pane-alarm",
    alarm:    "pane-alarm",
    timer:    "pane-timer",
    stopwatch:"pane-stop",
    stop:     "pane-stop",
    pomodoro: "pane-pomo",
    pomo:     "pane-pomo",
    stage:    "pane-stage"
  };

  function openPane(name) {
    var paneId = PANE_MAP[name] || name;
    var btn = document.querySelector('.tab[data-pane="' + paneId + '"]');
    if (btn) btn.click();   // existing tab wiring does the switch
  }

  // Live push (shell bridge calls this when the app is running)
  window.__orosTimeOpen = function (pane) {
    if (typeof pane !== "string" || !pane) return;
    openPane(pane);
  };

  // Boot: consume a pane staged by the shell while the app was
  // closed (sessionStorage — same origin, same tab; one-shot).
  try {
    var pending = sessionStorage.getItem("oros-time-open");
    if (pending) {
      sessionStorage.removeItem("oros-time-open");
      openPane(pending);
    }
  } catch (e) { /* storage blocked — navigation no-ops, nothing breaks */ }
})();