// ============================================================
// orOS Calendar v0.3.0
// Views: Month (Monday-first grid), Week, Agenda, search.
// Event CRUD, labels (color-coded, filterable), start/end times,
// location, multi-day spans (dateEnd), recurrence, reminders.
// Data: localStorage "oros-calendar-data"
//   { ver: 1,
//     labels:  [ { id, name, color, mtime } ],
//     events:  [ { id, date: "YYYY-MM-DD",
//                  dateEnd: "YYYY-MM-DD" | null,  // v0.3: multi-day,
//                                              // plain events only
//                  start: "HH:MM" | null, end: "HH:MM" | null,
//                  title, note, location,
//                  labelId: string | null, mtime } ],
//     deleted: [ { id, mtime } ] }
// v0.1 legacy "time" → "start" at load (zero-loss migration).
// v0.3 legacy: no "dateEnd" → null = single-day (zero-loss).
// Multi-day + recurrence is a deliberate non-goal (see §3b notes):
// combining both opens a combinatorial hole in the occurrence math.
// id + mtime exist from day one for the Part 5 merge sync.
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

  /* ---------- 1. i18n ---------- */
  var LANG = "en";
  try {
    if (window.parent && window.parent.orosLang) LANG = window.parent.orosLang;
    else if (localStorage.getItem("oros-lang")) LANG = localStorage.getItem("oros-lang");
  } catch (e) {}

  var STR = {
    en: {
      "cal.today": "Today",
      "cal.prev": "Previous month",
      "cal.next": "Next month",
      "cal.export": "Export",
      "cal.stats": "Stats",
      "cal.search.ph": "Search events…",
      "vw.month": "Month",
      "vw.week": "Week",
      "vw.agenda": "Agenda",
      "cal.filters.lbl": "Labels",
      "wd": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      "months": ["January", "February", "March", "April", "May", "June",
                 "July", "August", "September", "October", "November", "December"],
      "day.today": "Today",
      "ev.add": "Add",
      "ev.dlg.new": "New event",
      "ev.dlg.edit": "Edit event",
      "ev.field.title": "Title",
      "ev.ph.title": "What's happening?",
      "ev.field.when": "Time",
      "ev.ph.start": "Start time…",
      "ev.end.none": "No end",
      "ev.allday": "All day",
      "ev.field.loc": "Location",
      "ev.ph.loc": "Where?",
      "ev.field.note": "Note",
      "ev.ph.note": "Details…",
      "ev.save": "Save",
      "ev.cancel": "Cancel",
      "ev.delete": "Delete event",
      "ev.delete.confirm": "Delete this event?",
      "ev.none": "No events",
      "ev.untitled": "(untitled)",
      "ev.alltime": "All day",
      "ev.err.title": "Enter a title first",
      "ev.err.time": "End time must be after start time",
      "ev.err.dateend": "End date must be on or after the start date",
      "ev.spanHint": "Multi-day event: {b} days total. Saving here moves the start to the selected day.",
      "ev.del.yes": "Delete",
      "del.done": "Event deleted",
      "undo": "Undo",
      "sync.merged": "Updated from sync",
      "exp.done": "Calendar exported (.ics)",
      "lbl.personal": "Personal",
      "lbl.work": "Work",
      "lbl.family": "Family",
      "lbl.feed.bday": "Birthdays",
      "lbl.feed.anniv": "Anniversaries",
      "lbl.feed.cycle": "Cycle",
      "lbl.feed.mood": "Mood",
      "lbl.feed.habits": "Habits",
      "lbl.feed.kanban": "Kanban",
      "feed.cycle.period": "Period",
      "feed.mood.entry": "Mood entry",
      "lbl.feed.custom": "Custom Feed",
      "lbl.feeds": "App feeds",
      "lbl.feed.ro": "Read-only — managed by its app",
      "lbl.manage": "Manage labels",
      "lbl.new": "New label",
      "lbl.ph.name": "Name…",
      "lbl.color": "Color",
      "lbl.done": "Done",
      "lbl.delete": "Delete",
      "lbl.inuse": "This label is used by events",
      "lbl.none": "No label",
      "lbl.empty": "No labels yet",
      "ev.field.repeat": "Repeat",
      "rep.none": "None",
      "rep.daily": "Daily",
      "rep.weekly": "Weekly",
      "rep.biweekly": "Every 2 weeks",
      "rep.monthly": "Monthly",
      "rep.yearly": "Yearly",
      "ev.field.until": "Until",
      "ev.field.dateend": "Ends on (day)",
      "ev.cont": "Day {a} of {b}",
      "ev.field.remind": "Reminder",
      "rem.none": "None",
      "rem.min": "{n} min before",
      "rem.hour": "{n} h before",
      "rem.day": "{n} day(s) before",
      "ser.edit.q": "Edit this occurrence or the whole series?",
      "ser.this": "This occurrence",
      "ser.all": "Entire series",
      "remind.toast": "Reminder",
      "ev.moved": "Moved",
      "srch.empty": "No events found",
      "ag.more": "Show more",
      "ag.empty": "Nothing scheduled in the next 30 days",
      "stat.title": "Statistics",
      "stat.kpi.total": "Events",
      "stat.kpi.upcoming": "Next 30 days",
      "stat.kpi.recurring": "Recurring",
      "stat.byLabel": "Events by label",
      "stat.perMonth": "{n} events stored"
    },
    el: {
      "cal.today": "Σήμερα",
      "cal.prev": "Προηγούμενος μήνας",
      "cal.next": "Επόμενος μήνας",
      "cal.export": "Εξαγωγή",
      "cal.stats": "Στατιστικά",
      "cal.search.ph": "Αναζήτηση συμβάντων…",
      "vw.month": "Μήνας",
      "vw.week": "Εβδομάδα",
      "vw.agenda": "Ατζέντα",
      "cal.filters.lbl": "Ετικέτες",
      "wd": ["Δευ", "Τρί", "Τετ", "Πέμ", "Παρ", "Σάβ", "Κυρ"],
      "months": ["Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος",
                 "Μάιος", "Ιούνιος", "Ιούλιος", "Αύγουστος",
                 "Σεπτέμβριος", "Οκτώβριος", "Νοέμβριος", "Δεκέμβριος"],
      "day.today": "Σήμερα",
      "ev.add": "Προσθήκη",
      "ev.dlg.new": "Νέο συμβάν",
      "ev.dlg.edit": "Επεξεργασία συμβάντος",
      "ev.field.title": "Τίτλος",
      "ev.ph.title": "Τι συμβαίνει;",
      "ev.field.when": "Ώρα",
      "ev.ph.start": "Ώρα έναρξης…",
      "ev.end.none": "Χωρίς λήξη",
      "ev.allday": "Όλη μέρα",
      "ev.field.loc": "Τοποθεσία",
      "ev.ph.loc": "Πού;",
      "ev.field.note": "Σημείωση",
      "ev.ph.note": "Λεπτομέρειες…",
      "ev.save": "Αποθήκευση",
      "ev.cancel": "Άκυρο",
      "ev.delete": "Διαγραφή συμβάντος",
      "ev.delete.confirm": "Να διαγραφεί αυτό το συμβάν;",
      "ev.none": "Κανένα συμβάν",
      "ev.untitled": "(χωρίς τίτλο)",
      "ev.alltime": "Όλη μέρα",
      "ev.err.title": "Δώσε πρώτα έναν τίτλο",
      "ev.err.time": "Η ώρα λήξης πρέπει να είναι μετά την έναρξη",
      "ev.err.dateend": "Η ημερομηνία λήξης πρέπει να είναι ίδια ή μετά την έναρξη",
      "ev.spanHint": "Πολυήμερο συμβάν: {b} μέρες συνολικά. Η αποθήκευση εδώ μεταφέρει την έναρξη στην επιλεγμένη μέρα.",
      "ev.del.yes": "Διαγραφή",
      "del.done": "Το συμβάν διαγράφηκε",
      "undo": "Αναίρεση",
      "sync.merged": "Ενημερώθηκε από συγχρονισμό",
      "exp.done": "Το ημερολόγιο εξήχθη (.ics)",
      "lbl.personal": "Προσωπικό",
      "lbl.work": "Εργασία",
      "lbl.family": "Οικογένεια",
      "lbl.feed.bday": "Γενέθλια",
      "lbl.feed.anniv": "Επέτειοι",
      "lbl.feed.cycle": "Κύκλος",
      "lbl.feed.mood": "Διάθεση",
      "lbl.feed.habits": "Συνήθειες",
      "lbl.feed.kanban": "Kanban",
      "feed.cycle.period": "Περίοδος",
      "feed.mood.entry": "Καταγραφή διάθεσης",
      "lbl.feed.custom": "Προσαρμοσμένο Feed",
      "lbl.feeds": "Ροές εφαρμογών",
      "lbl.feed.ro": "Μόνο ανάγνωση — διαχειρίζεται η εφαρμογή της",
      "lbl.manage": "Διαχείριση ετικετών",
      "lbl.new": "Νέα ετικέτα",
      "lbl.ph.name": "Όνομα…",
      "lbl.color": "Χρώμα",
      "lbl.done": "Τέλος",
      "lbl.delete": "Διαγραφή",
      "lbl.inuse": "Η ετικέτα χρησιμοποιείται από συμβάντα",
      "lbl.none": "Χωρίς ετικέτα",
      "lbl.empty": "Δεν υπάρχουν ετικέτες ακόμα",
      "ev.field.repeat": "Επανάληψη",
      "rep.none": "Καμία",
      "rep.daily": "Καθημερινά",
      "rep.weekly": "Εβδομαδιαία",
      "rep.biweekly": "Κάθε 2 εβδομάδες",
      "rep.monthly": "Μηνιαία",
      "rep.yearly": "Ετήσια",
      "ev.field.until": "Έως",
      "ev.field.dateend": "Λήξη (ημέρα)",
      "ev.cont": "Ημέρα {a} από {b}",
      "ev.field.remind": "Υπενθύμιση",
      "rem.none": "Καμία",
      "rem.min": "{n} λεπτά πριν",
      "rem.hour": "{n} ώρες πριν",
      "rem.day": "{n} μέρες πριν",
      "ser.edit.q": "Να επεξεργαστείς αυτή την εμφάνιση ή όλη τη σειρά;",
      "ser.this": "Αυτή η εμφάνιση",
      "ser.all": "Όλη η σειρά",
      "remind.toast": "Υπενθύμιση",
      "ev.moved": "Μετακινήθηκε",
      "srch.empty": "Κανένα αποτέλεσμα",
      "ag.more": "Περισσότερα",
      "ag.empty": "Τίποτα προγραμματισμένο τις επόμενες 30 μέρες",
      "stat.title": "Στατιστικά",
      "stat.kpi.total": "Συμβάντα",
      "stat.kpi.upcoming": "Επόμενες 30 μέρες",
      "stat.kpi.recurring": "Επαναλαμβανόμενα",
      "stat.byLabel": "Συμβάντα ανά ετικέτα",
      "stat.perMonth": "{n} συμβάντα αποθηκευμένα"
    }
  };
  function t(k) {
    return (STR[LANG] && STR[LANG][k] !== undefined) ? STR[LANG][k]
         : (STR.en[k] !== undefined ? STR.en[k] : k);
  }
  function applyI18n() {
    var els = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < els.length; i++) els[i].textContent = t(els[i].getAttribute("data-i18n"));
    var phs = document.querySelectorAll("[data-i18n-ph]");
    for (var j = 0; j < phs.length; j++) phs[j].placeholder = t(phs[j].getAttribute("data-i18n-ph"));
    var airs = document.querySelectorAll("[data-i18n-aria]");
    for (var k = 0; k < airs.length; k++) airs[k].setAttribute("aria-label", t(airs[k].getAttribute("data-i18n-aria")));
  }

  // Boot marker (stale-bundle detection — R3/R11) + live lang attr
  var SCRIPT_V = "";
  (function () {
    var m = (document.currentScript && document.currentScript.src || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("calendar.js v" + (SCRIPT_V || "?") + " boot");
  })();

  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // Lazy singleton toast (orOS standard: top-right, text node FIRST,
  // optional action button SECOND, 5s auto-hide, single-slot).
  var toastEl = null, toastTimer = null;
  function hideToast() {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    if (toastEl) toastEl.classList.remove("show");
  }
  function toast(text, actionLabel, actionFn) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "app-toast";
      document.body.appendChild(toastEl);
    }
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    toastEl.textContent = "";               // wipe before append
    toastEl.appendChild(document.createTextNode(text));
    if (actionLabel && typeof actionFn === "function") {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "app-toast-btn";
      b.textContent = actionLabel;
      b.addEventListener("click", function () {
        hideToast();
        actionFn();
      });
      toastEl.appendChild(b);
    }
    toastEl.classList.add("show");
    toastTimer = setTimeout(hideToast, 5000);
  }
  
  /* Unified notifications (orOS compliance): informational toasts
   route through the shell's orosNotifs.transient() — click
   feedback, no inbox, no toggle needed. Falls back to the local
   toast when the app runs standalone (no shell present).
   Undo-bearing toasts keep the local path (interactive action). */
function transientNote(title, body) {
  var api = null;
  try { api = window.parent.orosNotifs; } catch (e) {}
  if (!api && window.orosNotifs) api = window.orosNotifs;
  
  if (api && typeof api.transient === "function") {
    api.transient({ ns: "calendar", title: title, body: body || "" });
  } else {
    toast(title + (body ? " — " + body : ""));
  }
}

  /* ---------- 2. State ---------- */
  var DATA_KEY = "oros-calendar-data";
  var state = { ver: 1, labels: [], events: [], deleted: [] };

  // Whitelist — the sync-sanitizer contract (deterministic).
  // Declared HERE (moved up from §3b in v0.3): sanitizeEvent runs
  // at load and at merge time, so the presets must be initialized
  // before any sanitizer ever touches an event.
  var REMIND_PRESETS = [5, 15, 30, 60, 1440, 4320, 7200];

  // Fixed label palette — deterministic across devices (stored
  // verbatim inside the synced blob; theme-independent by design).
  var LABEL_PALETTE = [
    "#d4af37", "#a78bfa", "#7aa2f7", "#9ece6a",
    "#e06c75", "#ff9e64", "#4ec9b0", "#f28fb6"
  ];

  // CA3/CA4: THE single color source for both sanitizers. Brown
  // (#c8a96e) is reserved for the Contacts "Custom" feed label —
  // the user-facing picker still iterates LABEL_PALETTE only.
  // A color can never again "pass at load but die at merge".
  var VALID_COLORS = LABEL_PALETTE.concat(["#c8a96e"]);

  // Wave 2.1 — virtual feed labels (Contacts/Cycle/Mood/Habits feeds).
  // DELIBERATELY not in state.labels: they never travel in the synced
  // blob, can never be deleted/renamed from the label manager
  // (renderLblList iterates state.labels only), and carry no mtime.
  // Display-only constants; the name is painted via i18n at render time.
  // Colors come from LABEL_PALETTE so they match the design system.
  var FEED_LABELS = [
    { id: "lbl-feed-bday",    color: "#9ece6a" },   // green — Birthdays
    { id: "lbl-feed-anniv",   color: "#f28fb6" },   // pink — Anniversaries
    { id: "lbl-feed-cycle",   color: "#f28fb6" },   // pink — Cycle (same as anniv by design)
    { id: "lbl-feed-mood",    color: "#a78bfa" },   // purple — Mood
    { id: "lbl-feed-habits",  color: "#4ec9b0" },   // teal — Habits
    { id: "lbl-feed-kanban",  color: "#7aa2f7" },   // blue — Kanban (teal taken by Habits)
    { id: "lbl-feed-custom", color: "#c8a96e" }     // brown — Contacts custom event types
  ];
  function feedLabelName(l) {
    if (l.id === "lbl-feed-bday") return t("lbl.feed.bday");
    if (l.id === "lbl-feed-anniv") return t("lbl.feed.anniv");
    if (l.id === "lbl-feed-cycle") return t("lbl.feed.cycle");
    if (l.id === "lbl-feed-mood") return t("lbl.feed.mood");
    if (l.id === "lbl-feed-habits") return t("lbl.feed.habits");
    if (l.id === "lbl-feed-kanban") return t("lbl.feed.kanban");
    return t("lbl.feed.custom");
  }

  // Seeds for fresh installs (mtime 0 → any user edit wins the merge
  // everywhere; identical bytes on every device — no Date.now() here).
  function defaultLabels() {
    return [
      { id: "lbl-personal", name: t("lbl.personal"), color: LABEL_PALETTE[0], mtime: 0 },
      { id: "lbl-work",     name: t("lbl.work"),     color: LABEL_PALETTE[2], mtime: 0 },
      { id: "lbl-family",   name: t("lbl.family"),   color: LABEL_PALETTE[3], mtime: 0 }
    ];
  }

  // Untouched seeds (mtime 0) follow the ACTIVE language: the fixed
  // id map re-translates them at every boot. Any user edit (fresh
  // mtime) detaches the label forever. No markDirty on purpose — a
  // pure name swap has mtime 0, merge-inert on both devices.
  function reseedSeedNames() {
    var map = {
      "lbl-personal": t("lbl.personal"),
      "lbl-work":     t("lbl.work"),
      "lbl-family":   t("lbl.family")
    };
    var changed = false;
    state.labels.forEach(function (l) {
      if (l.mtime === 0 && map[l.id] && l.name !== map[l.id]) {
        l.name = map[l.id];
        changed = true;
      }
    });
    if (changed) {
      try { localStorage.setItem(DATA_KEY, JSON.stringify(state)); } catch (e) {}
    }
  }

  function sanitizeLabel(l) {
    if (!l || typeof l !== "object") return null;
    if (typeof l.id !== "string" || !l.id) return null;
    // CA4: single palette source (VALID_COLORS = LABEL_PALETTE + brown)
    if (VALID_COLORS.indexOf(l.color) === -1) return null;
    return {
      id: l.id,
      name: (typeof l.name === "string" ? l.name : "").slice(0, 40),
      color: l.color,
      mtime: (typeof l.mtime === "number" && isFinite(l.mtime)) ? l.mtime : 0
    };
  }

  function labelById(id) {
    for (var i = 0; i < state.labels.length; i++) {
      if (state.labels[i].id === id) return state.labels[i];
    }
    for (var f = 0; f < FEED_LABELS.length; f++) {
      if (FEED_LABELS[f].id === id) return FEED_LABELS[f];
    }
    return null;
  }
  function labelColor(labelId) {
    var l = labelById(labelId);
    if (l) return l.color;
    var acc = "";
    try {
      acc = getComputedStyle(document.documentElement)
        .getPropertyValue("--accent").trim();
    } catch (e) {}
    return acc || "#d4af37";
  }

  function sanitizeEvent(e) {
    if (!e || typeof e !== "object") return null;
    if (typeof e.id !== "string" || !e.id) return null;
    if (typeof e.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return null;
    // v0.1 legacy: single "time" field migrates to "start" (zero loss)
    var start = null;
    if (typeof e.start === "string" && /^\d{2}:\d{2}$/.test(e.start)) start = e.start;
    else if (typeof e.time === "string" && /^\d{2}:\d{2}$/.test(e.time)) start = e.time;
    var end = (typeof e.end === "string" && /^\d{2}:\d{2}$/.test(e.end)) ? e.end : null;
    // Audit #2 fix: this range guard existed TWICE — one dead no-op
    // removed. Corrupted range → no end.
    if (start && end && end < start) end = null;
    var labelId = (typeof e.labelId === "string" && e.labelId) ? e.labelId : null;
    var remindMin = (typeof e.remindMin === "number" &&
                     REMIND_PRESETS.indexOf(e.remindMin) !== -1)
      ? e.remindMin : null;
    // v0.3 multi-day: dateEnd is legal ONLY on plain (non-recurring)
    // events, and only when it lands on/after the anchor. A stray
    // value on a series or before the anchor is dropped, never fatal.
    var dateEnd = null;
    if (typeof e.dateEnd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.dateEnd)) {
      if (!validRecur(e.recur) && e.dateEnd >= e.date) dateEnd = e.dateEnd;
    }
    return {
      id: e.id,
      date: e.date,
      dateEnd: dateEnd,
      start: start,
      end: end,
      title: (typeof e.title === "string" ? e.title : "").slice(0, 80),
      note: (typeof e.note === "string" ? e.note : "").slice(0, 500),
      location: (typeof e.location === "string" ? e.location : "").slice(0, 150),
      labelId: labelId,
      recur: sanitizeRecur(e.recur),
      remindMin: remindMin,
      mtime: (typeof e.mtime === "number" && isFinite(e.mtime)) ? e.mtime : Date.now()
    };
  }

  // Tombstones: deletion markers — { id, mtime }. They travel in the
  // same blob (additive field, ver stays 1) so a delete on device A
  // can never be resurrected by device B's stale copy of the event.
  function sanitizeTomb(d) {
    if (!d || typeof d !== "object") return null;
    if (typeof d.id !== "string" || !d.id) return null;
    return {
      id: d.id,
      mtime: (typeof d.mtime === "number" && isFinite(d.mtime)) ? d.mtime : Date.now()
    };
  }

  function loadState() {
    try {
      var d = JSON.parse(localStorage.getItem(DATA_KEY));
      if (d && typeof d === "object" && Array.isArray(d.events)) {
        state.events = d.events.map(sanitizeEvent).filter(Boolean);
      }
      // Pre-sync blobs have no "deleted" → empty list, zero migration
      if (d && Array.isArray(d.deleted)) {
        state.deleted = d.deleted.map(sanitizeTomb).filter(Boolean);
      }
      // Seed ΜΟΝΟ όταν λείπει το κλειδί "labels" (φρέσκια
      // εγκατάσταση / v0.1 blob). Άδειο-but-παρόν array = ο χρήστης
      // τα σβήσε όλα — το σεβόμαστε, δεν τα φυτεύουμε ξανά.
      if (d && Array.isArray(d.labels)) {
        state.labels = d.labels.map(sanitizeLabel).filter(Boolean);
      } else {
        state.labels = defaultLabels();
        // CA1: persist NOW — merge-inert, NO markDirty. A fresh
        // install otherwise hands the merge an empty local blob,
        // and a labels-less peer wipes the seeds in setFromSync.
        // Writing immediately means the merge union sees them;
        // mtime 0 keeps cloud traffic at exactly zero.
        try { localStorage.setItem(DATA_KEY, JSON.stringify(state)); } catch (e2) {}
      }
    } catch (e) {
      if (!state.labels.length) state.labels = defaultLabels();
    }
  }
  function saveState() {
    try { localStorage.setItem(DATA_KEY, JSON.stringify(state)); } catch (e) {}
    markDirty();
  }

  // Shell sync bridge — canonical __orosSyncApi funnel (Part VII).
  function markDirty() {
    try {
      if (window.__orosSyncApi) window.__orosSyncApi.dirty();
    } catch (e) {}
  }

  /* ---------- 2b. Time picker (custom, 24h) ----------
     Browser-native <input type="time"> is AM/PM in some locales and
     its dropdown cannot be styled — replaced by this component.
     Menu: 15-minute slots, 00:00–23:45. Typing stays free-form:
     "9" → 09:00, "937" → 09:37 (any HH:MM survives, not just :15s).
     opts.noEnd: prepend a "no end" (empty) option. */
  function tpParse(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (/^\d{2}:\d{2}$/.test(s)) {
      var h1 = +s.slice(0, 2), m1 = +s.slice(3);
      return (h1 <= 23 && m1 <= 59) ? s : null;
    }
    var d = s.replace(/\D+/g, "");
    if (!d) return null;
    var hh, mm;
    if (d.length === 1 || d.length === 2) { hh = +d; mm = 0; }
    else if (d.length === 3) { hh = +d.slice(0, 1); mm = +d.slice(1); }
    else if (d.length === 4) { hh = +d.slice(0, 2); mm = +d.slice(2); }
    else return null;
    if (hh > 23 || mm > 59 || isNaN(hh) || isNaN(mm)) return null;
    return pad(hh) + ":" + pad(mm);
  }

  function makeTP(inputId, menuId, opts) {
    opts = opts || {};
    var input = $(inputId);
    var menu = $(menuId);
    var activeIdx = 0;
    var options = [];              // { label, value } — value "" = none

    if (opts.noEnd) {
      options.push({ label: "— " + t("ev.end.none"), value: "" });
    }
    for (var h = 0; h < 24; h++) {
      for (var m = 0; m < 60; m += 15) {
        options.push({ label: pad(h) + ":" + pad(m), value: pad(h) + ":" + pad(m) });
      }
    }

    function buildMenu() {
      menu.textContent = "";
      options.forEach(function (o, idx) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "tp-opt" + (o.value === "" ? " tp-none" : "");
        b.textContent = o.label;
        b.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
        b.addEventListener("click", function () { commit(o.value); });
        menu.appendChild(b);
      });
    }

    function setActive(idx) {
      activeIdx = idx;
      var kids = menu.children;
      for (var i = 0; i < kids.length; i++) {
        kids[i].classList.toggle("active", i === idx);
      }
      if (kids[idx]) kids[idx].scrollIntoView({ block: "nearest" });
    }

    function nearestIdx(val) {
      // exact slot, else the closest one at-or-below val
      var best = 0;
      for (var i = 0; i < options.length; i++) {
        if (options[i].value === val) return i;
        if (options[i].value && options[i].value <= val) best = i;
      }
      return best;
    }

    function open() {
      if (input.disabled) return;
      buildMenu();
      menu.hidden = false;
      var val = tpParse(input.value);
      setActive(nearestIdx(val || "09:00"));
    }
    function close() {
      menu.hidden = true;
    }

    function commit(value) {
      input.value = value;
      input.classList.remove("invalid");
      close();
    }

    input.addEventListener("focus", open);
    input.addEventListener("click", function (e) {
      e.stopPropagation();
      if (menu.hidden) open();
    });
    input.addEventListener("input", function () {
      // live feedback while typing: valid → normalized preview
      var v = tpParse(input.value);
      if (v) input.classList.remove("invalid");
    });
    input.addEventListener("keydown", function (e) {
      if (menu.hidden) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
          open();
          e.preventDefault();
        }
        return;
      }
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(Math.min(activeIdx + 1, options.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(activeIdx - 1, 0)); }
      else if (e.key === "Enter") {
        e.preventDefault();
        var raw = tpParse(input.value);
        if (raw && raw !== input.value) { commit(raw); return; }
        commit(options[activeIdx].value);
      }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "Tab") { close(); }
    });
    input.addEventListener("blur", function () {
      // leaving the field: normalize whatever was typed (or clear)
      setTimeout(close, 120);
      var v = tpParse(input.value);
      input.value = v || "";
      input.classList.toggle("invalid", !!input.value && !v);
    });

    // outside click closes the menu
    document.addEventListener("click", function (e) {
      if (!menu.hidden && !menu.parentNode.contains(e.target)) close();
    });

    return {
      open: open,
      close: close,
      value: function () { return tpParse(input.value); }
    };
  }

  /* ---------- 2c. Rollup holders (wired at boot) ---------- */
  var tpStart = null, tpEnd = null;

  /* ---------- 3. Date helpers + label visibility ---------- */
  function ymd(y, m, d) { return y + "-" + pad(m + 1) + "-" + pad(d); }
  function todayYMD() {
    var n = new Date();
    return ymd(n.getFullYear(), n.getMonth(), n.getDate());
  }
  // Both operate on "YYYY-MM-DD" strings only (local timezone math).
  function dparse(s) {
    var p = s.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]).getTime();
  }
  function dAdd(s, n) {
    var p = s.split("-");
    var dt = new Date(+p[0], +p[1] - 1, +p[2]);
    dt.setDate(dt.getDate() + n);
    return ymd(dt.getFullYear(), dt.getMonth(), dt.getDate());
  }

  // Label visibility: id -> true/false. Absent = visible. Chips row
  // toggles these; nothing is ever deleted by filtering.
  var labelVis = {};
  function labelVisible(labelId) {
    if (!labelId) return true;
    return labelVis[labelId] !== false;
  }

  /* ---------- 3b. Recurrence + multi-day engine ----------
     Masters stored in state.events with "recur". Occurrences are
     COMPUTED here — never stored. Algorithm mirrors shell.js
     calRemEachOccurrence 1:1 (sticky-clamp contract: Jan 31 →
     Feb 28 → Mar 31; D/W step days; interval 2 = bi-weekly;
     exdates skipped; "until" stops the walk). The reminder engine
     and this expansion MUST never disagree.
     MULTI-DAY (v0.3): plain events may span date → dateEnd. Spans
     and recurrence are mutually exclusive BY SANITIZER (see §2) —
     one engine per shape keeps occurrencesOn provable. */

  function validRecur(r) {
    return !!(r && typeof r === "object" &&
              /^[DWMY]$/.test(r.freq || ""));
  }

  function dimOfMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

  // Normalizer: interval 2 is legal ONLY on weekly (bi-weekly).
  // exdates deduped + SORTED → identical JSON.stringify on every
  // device → the merge tie-break stays deterministic.
  function sanitizeRecur(r) {
    if (!validRecur(r)) return null;
    var interval = (r.freq === "W" && r.interval === 2) ? 2 : 1;
    var until = (typeof r.until === "string" &&
                 /^\d{4}-\d{2}-\d{2}$/.test(r.until)) ? r.until : null;
    var exSet = {};
    if (Array.isArray(r.exdates)) {
      r.exdates.forEach(function (d) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) exSet[d] = true;
      });
    }
    return {
      freq: r.freq,
      interval: interval,
      until: until,
      exdates: Object.keys(exSet).sort()
    };
  }

  // Generator: walks occurrences in strict ascending date order.
  // cb(occYmd) — return false to stop. Exdate occurrences are
  // skipped (but the walk continues past them, so an occurrence
  // AFTER the exclusion is still reachable).
  function eachOccurrence(e, cb) {
    if (!validRecur(e.recur)) return;
    var p = e.date.split("-");
    var y = +p[0], m = +p[1] - 1;
    var origDay = +p[2];
    var d = origDay;
    var r = e.recur;
    var interval = (r.interval === 2) ? 2 : 1;
    var until = (typeof r.until === "string" &&
                 /^\d{4}-\d{2}-\d{2}$/.test(r.until)) ? r.until : null;
    var exSet = {};
    if (Array.isArray(r.exdates)) {
      for (var x = 0; x < r.exdates.length && x < 100; x++) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(r.exdates[x])) exSet[r.exdates[x]] = true;
      }
    }
    // Step budget must outlive any realistic series age (500 ≈ 16
    // months of dailies was too tight): D ≈ 110 years, W (incl. ×2)
    // ≈ 200 years, M/Y ≈ 50+ years. Reminders stop far earlier via
    // the horizon, occursOn exits at the target date — both cheap.
    var MAX_STEPS = (r.freq === "D") ? 40000 : (r.freq === "W") ? 5200 : 600;
    for (var step = 0; step < MAX_STEPS; step++) {
      var occYmd = ymd(y, m, d);
      if (until && occYmd > until) return;
      if (!exSet[occYmd]) {
        if (cb(occYmd) === false) return;
      }
      if (r.freq === "D") {
        d += interval;
      } else if (r.freq === "W") {
        d += 7 * interval;
      } else if (r.freq === "M") {
        m += interval;
        while (m > 11) { m -= 12; y++; }
        d = Math.min(origDay, dimOfMonth(y, m));   // sticky clamp
      } else if (r.freq === "Y") {
        y += interval;
        d = Math.min(origDay, dimOfMonth(y, m));   // Feb 29 → Feb 28
      } else {
        return;
      }
      // normalize day overflow from D/W stepping (max +14 days)
      var dim = dimOfMonth(y, m);
      if (d > dim) { d -= dim; m++; if (m > 11) { m = 0; y++; } }
    }
  }

  // The single truth of "does e occupy dateStr":
  //   - series: computed occurrences (exdates respected)
  //   - plain:  anchor day, or the whole date → dateEnd span
  function occursOn(e, dateStr) {
    if (validRecur(e.recur)) {
      if (e.recur.until && dateStr > e.recur.until) return false;
      var found = false;
      eachOccurrence(e, function (occYmd) {
        if (occYmd >= dateStr) {          // ascending walk: past the
          found = (occYmd === dateStr);   // target → answer is final
          return false;
        }
      });
      return found;
    }
    if (e.date > dateStr) return false;
    return dateStr <= (e.dateEnd || e.date);
  }

  // Multi-day span info: null on single-day events, otherwise
  // { days: total, idx: 1-based position of dateStr inside }.
  // Guards against span-crossing corruption (idx < 1 / > days).
  function spanInfo(e, dateStr) {
    if (validRecur(e.recur) || !e.dateEnd || e.dateEnd === e.date) return null;
    var days = Math.round((dparse(e.dateEnd) - dparse(e.date)) / 86400000) + 1;
    var idx = Math.round((dparse(dateStr) - dparse(e.date)) / 86400000) + 1;
    if (days < 1 || idx < 1 || idx > days) return null;
    return { days: days, idx: idx };
  }

  function recurDesc(e) {
    if (!validRecur(e.recur)) return "";
    var map = {
      "D-1":  ["Daily",         "Καθημερινά"],
      "W-1":  ["Weekly",        "Εβδομαδιαία"],
      "W-2":  ["Every 2 weeks", "Κάθε 2 εβδομάδες"],
      "M-1":  ["Monthly",       "Μηνιαία"],
      "Y-1":  ["Yearly",        "Ετήσια"]
    };
    var key = e.recur.freq + "-" + (e.recur.interval === 2 ? 2 : 1);
    return map[key] ? map[key][LANG === "el" ? 1 : 0] : "";
  }

  // Wave 2.1 — Contacts read-only feed. Same-origin iframe → shared
  // localStorage: reads the blob contacts.js owns. Read-only by
  // construction: absent/corrupt data → no feed events (standalone
  // Calendar unaffected). Feed events carry _feed/_contactId and
  // are NEVER written back (not stored, not synced, not exported).
  var CT_DATA_KEY = "oros-contacts-data";
  var contactsCache = { when: 0, data: {} };

  function contactsRaw() {
    // 1s micro-cache — month render calls eventsOn ~31× per paint.
    // Keeps a Contacts edit visible here within ~1s, without a
    // JSON.parse storm on every cell.
    var now = Date.now();
    if (now - contactsCache.when > 1000) {
      try {
        var d = JSON.parse(localStorage.getItem(CT_DATA_KEY));
        contactsCache.data = (d && typeof d === "object") ? d : {};
      } catch (e) { contactsCache.data = {}; }
      contactsCache.when = now;
    }
    return contactsCache.data;
  }

  // Mirrors contacts.js displayName() composition:
  // given+middle+family → nickname → org → "?"
  function ctName(c) {
    var parts = [c.given, c.middle, c.family].filter(Boolean);
    if (parts.length) return parts.join(" ");
    if (c.nickname) return c.nickname;
    if (c.org) return c.org;
    return "?";
  }

  function feedLabelIdFor(type) {
    if (type === "birthday") return "lbl-feed-bday";
    if (type === "anniversary") return "lbl-feed-anniv";
    return "lbl-feed-custom";
  }

  function contactsFeedOn(dateStr) {
    // dateStr "YYYY-MM-DD" → tail is the "MM-DD" the contact
    // events carry (yearless by design: the day is the whole story).
    var mmdd = dateStr.slice(5);
    var out = [];
    var cs = contactsRaw().contacts;
    if (!Array.isArray(cs)) return out;
    cs.forEach(function (c) {
      if (!c || typeof c !== "object" || typeof c.id !== "string") return;
      (Array.isArray(c.events) ? c.events : []).forEach(function (ev, ix) {
        if (!ev || typeof ev !== "object" || ev.day !== mmdd) return;
        var labelId = feedLabelIdFor(ev.type);
        if (!labelVisible(labelId)) return;
        var who = ctName(c);
        out.push({
          id: "feed-" + c.id + "-" + ix,        // per-render key, never stored
          title: (ev.type === "custom" && ev.label)
            ? who + " · " + ev.label.slice(0, 40)
            : who,
          labelId: labelId,
          start: null,                          // all-day → sorted last
          _feed: true,
          _contactId: c.id
        });
      });
    });
    return out;
  }
  
  // Wave 2.1 — Habits read-only feed. Reads completions from
  // oros-habits-data, injects completed habits as colored dots.
  // Same-origin localStorage → micro-cached for ~1s to avoid
  // JSON.parse storms during month render.
  var HBT_DATA_KEY = "oros-habits-data";
  var habitsCache = { when: 0, data: null };

  function habitsRaw() {
    var now = Date.now();
    if (now - habitsCache.when > 1000) {
      try {
        var d = JSON.parse(localStorage.getItem(HBT_DATA_KEY));
        habitsCache.data = (d && typeof d === "object" && Array.isArray(d.comps)) ? d : null;
      } catch (e) { habitsCache.data = null; }
      habitsCache.when = now;
    }
    return habitsCache.data;
  }

  function isHabitDoneOn(habitId, dateStr) {
    var data = habitsRaw();
    if (!data || !Array.isArray(data.comps)) return false;
    var compKey = habitId + "|" + dateStr;
    for (var i = 0; i < data.comps.length; i++) {
      var c = data.comps[i];
      if (c.id === compKey && !c.del) return true;
    }
    return false;
  }

  function habitsFeedOn(dateStr) {
    var data = habitsRaw();
    if (!data || !Array.isArray(data.habits) || !Array.isArray(data.comps)) return [];
    
    var out = [];
    var livingHabits = data.habits.filter(function (h) { return h && !h.del; });
    
    livingHabits.forEach(function (h) {
      if (isHabitDoneOn(h.id, dateStr)) {
        if (!labelVisible("lbl-feed-habits")) return;
        out.push({
          id: "habit-" + h.id + "-" + dateStr,
          title: h.name,
          labelId: "lbl-feed-habits",
          start: null,                    // all-day dot
          _feed: true,
          _habitId: h.id
        });
      }
    });
    
    return out;
  }

  // Wave 2.1 — Cycle read-only feed. Reads periods from
  // oros-cycle-data and paints every day inside a closed period
  // (start..end, inclusive) with the pink Cycle label. An OPEN
  // period (end null) paints ONLY its first day — projecting the
  // usual length forward would be a guess, and we never guess.
  // Tombstone map honored (stale open app on another tab).
  // Same-origin localStorage → micro-cached for ~1s.
  var CYC_DATA_KEY = "oros-cycle-data";
  var cycleCache = { when: 0, data: null };

  function cycleRaw() {
    var now = Date.now();
    if (now - cycleCache.when > 1000) {
      try {
        var d = JSON.parse(localStorage.getItem(CYC_DATA_KEY));
        cycleCache.data = (d && typeof d === "object") ? d : null;
      } catch (e) { cycleCache.data = null; }
      cycleCache.when = now;
    }
    return cycleCache.data;
  }

  function cycleFeedOn(dateStr) {
    var data = cycleRaw();
    if (!data || !Array.isArray(data.periods)) return [];
    if (!labelVisible("lbl-feed-cycle")) return [];

    var target = dparse(dateStr);   // local midnight of the cell
    var out = [];

    data.periods.forEach(function (p) {
      if (!p || typeof p !== "object" || typeof p.start !== "number" ||
          !isFinite(p.start)) return;
      if (data.deleted && data.deleted[p.id]) return;   // tombstone
      var ps = new Date(p.start);
      if (isNaN(ps.getTime())) return;
      ps.setHours(0, 0, 0, 0);
      var startTs = ps.getTime();
      var endTs = startTs;                                // open → day 1 only
      if (typeof p.end === "number" && isFinite(p.end) && p.end >= p.start) {
        var pe = new Date(p.end);
        if (!isNaN(pe.getTime())) {
          pe.setHours(0, 0, 0, 0);
          endTs = pe.getTime();
        }
      }
      if (target >= startTs && target <= endTs) {
        out.push({
          id: "cycle-" + p.id + "-" + dateStr,   // per-render key, never stored
          title: t("feed.cycle.period"),
          labelId: "lbl-feed-cycle",
          start: null,                           // all-day band
          _feed: true,
          _cycleId: p.id
        });
      }
    });
    return out;
  }

  // Wave 2.1 — Mood read-only feed. Reads entries from
  // oros-mood-data: every entry whose LOCAL calendar day matches
  // the cell becomes a purple all-day row. Title = note excerpt
  // when present, else the generic localized label. Tombstone
  // map honored. Micro-cached ~1s like the other feeds.
  var MOOD_DATA_KEY = "oros-mood-data";
  var moodCache = { when: 0, data: null };

  function moodRaw() {
    var now = Date.now();
    if (now - moodCache.when > 1000) {
      try {
        var d = JSON.parse(localStorage.getItem(MOOD_DATA_KEY));
        moodCache.data = (d && typeof d === "object" && Array.isArray(d.entries))
          ? d : null;
      } catch (e) { moodCache.data = null; }
      moodCache.when = now;
    }
    return moodCache.data;
  }

  function tsToLocalYmd(ts) {
    var dt = new Date(ts);
    if (isNaN(dt.getTime())) return null;
    return ymd(dt.getFullYear(), dt.getMonth(), dt.getDate());
  }

  function moodFeedOn(dateStr) {
    var data = moodRaw();
    if (!data || !Array.isArray(data.entries)) return [];
    if (!labelVisible("lbl-feed-mood")) return [];

    var out = [];
    data.entries.forEach(function (en) {
      if (!en || typeof en !== "object" ||
          typeof en.ts !== "number" || !isFinite(en.ts)) return;
      if (data.deleted && data.deleted[en.id]) return;   // tombstone
      if (tsToLocalYmd(en.ts) !== dateStr) return;
      out.push({
        id: "mood-" + en.id + "-" + dateStr,   // per-render key, never stored
        title: (typeof en.note === "string" && en.note.trim())
          ? en.note.trim().slice(0, 40)
          : t("feed.mood.entry"),
        labelId: "lbl-feed-mood",
        start: null,                            // all-day
        _feed: true,
        _moodId: en.id
      });
    });
    return out;
  }

  // Wave — Kanban read-only feed. Reads the multi-board blob
  // (oros-kanban-data) and surfaces every card carrying a due date
  // as an all-day event on that day. Title: "COLUMN · card text"
  // (decision record #3); the notes field lands in e.note, which
  // buildEvRow already renders (#4: description = detail, not
  // title clutter). ARCHIVED boards are skipped by design (#6):
  // hidden boards must not leak into the calendar. Feed rows are
  // never stored, synced or exported — micro-cached ~1s like the
  // other feeds.
  var KB_DATA_KEY = "oros-kanban-data";
  var kanbanCache = { when: 0, data: null };

  function kanbanRaw() {
    var now = Date.now();
    if (now - kanbanCache.when > 1000) {
      try {
        var d = JSON.parse(localStorage.getItem(KB_DATA_KEY));
        kanbanCache.data = (d && typeof d === "object" &&
                            Array.isArray(d.boards)) ? d : null;
      } catch (e) { kanbanCache.data = null; }
      kanbanCache.when = now;
    }
    return kanbanCache.data;
  }

  function kanbanFeedOn(dateStr) {
    var data = kanbanRaw();
    if (!data) return [];
    if (!labelVisible("lbl-feed-kanban")) return [];

    var out = [];
    (data.boards || []).forEach(function (bd) {
      if (!bd || bd.archived) return;            // archived board → skip
      (Array.isArray(bd.columns) ? bd.columns : []).forEach(function (col) {
        (Array.isArray(col.cards) ? col.cards : []).forEach(function (card) {
          if (!card || card.due !== dateStr) return;
          out.push({
            id: "kb-" + card.id + "-" + dateStr,   // per-render key, never stored
            title: (col.name || "").slice(0, 24) + " · " +
                   (card.text || "").slice(0, 60),
            labelId: "lbl-feed-kanban",
            start: null,                           // all-day event
            note: (card.notes || "").slice(0, 500),
            _feed: true,
            _kanban: { boardId: bd.id, colId: col.id, cardId: card.id }
          });
        });
      });
    });
    return out;
  }

    function eventsOn(dateStr) {
    return state.events.filter(function (e) {
      return occursOn(e, dateStr) && labelVisible(e.labelId);
    })
    .concat(contactsFeedOn(dateStr))
    .concat(habitsFeedOn(dateStr))
    .concat(cycleFeedOn(dateStr))
    .concat(moodFeedOn(dateStr))
    .concat(kanbanFeedOn(dateStr))
    .sort(function (a, b) {
      if (a.start === b.start) return 0;
      if (a.start === null) return 1;
      if (b.start === null) return -1;
      return a.start < b.start ? -1 : 1;
    });
  }

  // Wave 4 — click-through: any feed row → its owning app. The shell
  // owns every deep link (live iframe push or sessionStorage staging
  // + app open). One dispatcher, three contracts: Contacts / Cycle /
  // Mood. Habits rows carry no bridge yet → silently inert. Standalone
  // load (no parent shell): ignored — the source app is only a tab
  // away in that mode anyway.
  function openFeedRow(ev) {
    if (!ev || !ev._feed) return;
    try {
      var p = window.parent;
      if (!p) return;
      if (ev._contactId &&
          typeof p.__orosOpenContact === "function") {
        p.__orosOpenContact(ev._contactId);
      } else if (ev._cycleId &&
                 typeof p.__orosOpenCycle === "function") {
        p.__orosOpenCycle(ev._cycleId);
      } else if (ev._moodId &&
                 typeof p.__orosOpenMood === "function") {
        p.__orosOpenMood(ev._moodId);
      } else if (ev._kanban &&
                 typeof p.__orosOpenKanbanCard === "function") {
        p.__orosOpenKanbanCard(ev._kanban.boardId,
                               ev._kanban.colId,
                               ev._kanban.cardId);
      }
    } catch (e) {}
  }
  
  /* ---------- 4. View system + month grid ---------- */
  var viewYear, viewMonth;          // month currently displayed
  var selDate = null;               // "YYYY-MM-DD" or null
  var curView = "month";            // "month" | "week" | "agenda"
  var weekAnchor = null;            // Monday (YMD) of the shown week
  var searchQ = "";                 // non-empty → results overlay
  var AGENDA_STEP = 30;             // days per "show more" chunk

  function renderWeekdays() {
    var wd = $("cal-wd");
    wd.textContent = "";
    for (var i = 0; i < 7; i++) {
      var d = document.createElement("div");
      d.textContent = t("wd")[i];
      if (i >= 5) d.className = "wend";
      wd.appendChild(d);
    }
  }

  // Monday (YMD) of the week containing the given date.
  function mondayOf(dateStr) {
    var p = dateStr.split("-");
    var dt = new Date(+p[0], +p[1] - 1, +p[2]);
    var lead = (dt.getDay() + 6) % 7;
    dt.setDate(dt.getDate() - lead);
    return ymd(dt.getFullYear(), dt.getMonth(), dt.getDate());
  }

  function renderTitle() {
    var el = $("cal-title");
    if (curView === "agenda") { el.textContent = t("vw.agenda"); return; }
    if (curView === "week") {
      var m = t("months");
      var a = weekAnchor.split("-");
      var b = dAdd(weekAnchor, 6).split("-");
      var s1 = (+a[2]) + " " + m[+a[1] - 1].slice(0, 3);
      var s2 = (+b[2]) + " " + m[+b[1] - 1].slice(0, 3) + " " + b[0];
      el.textContent = s1 + " – " + s2;
      return;
    }
    el.textContent = t("months")[viewMonth] + " " + viewYear;
  }

  function renderGrid() {
    var grid = $("cal-grid");
    grid.textContent = "";

    // Monday-first offset: getDay(): Sun=0..Sat=6 → Mon-first index.
    var first = new Date(viewYear, viewMonth, 1);
    var lead = (first.getDay() + 6) % 7;
    var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    var prevMonth = new Date(viewYear, viewMonth, 0).getDate();

    var today = todayYMD();
    var cells = lead + daysInMonth;
    var rows = Math.ceil(cells / 7) * 7;   // pad trailing week

    for (var i = 0; i < rows; i++) {
      var dayNum, out = false, cellDate;
      if (i < lead) {
        dayNum = prevMonth - lead + 1 + i;
        out = true;
        var pm = viewMonth - 1, py = viewYear;
        if (pm < 0) { pm = 11; py--; }
        cellDate = ymd(py, pm, dayNum);
      } else if (i >= cells) {
        dayNum = i - cells + 1;
        out = true;
        var nm = viewMonth + 1, ny = viewYear;
        if (nm > 11) { nm = 0; ny++; }
        cellDate = ymd(ny, nm, dayNum);
      } else {
        dayNum = i - lead + 1;
        cellDate = ymd(viewYear, viewMonth, dayNum);
      }

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cal-cell";
      if (out) btn.className += " out";
      if (cellDate === today) btn.className += " today";
      if (selDate === cellDate) btn.className += " sel";

      var num = document.createElement("span");
      num.className = "cal-num";
      num.textContent = dayNum;
      btn.appendChild(num);

      var dots = document.createElement("span");
      dots.className = "ev-dot-row";
      var dayEvents = eventsOn(cellDate).slice(0, 6);
      for (var j = 0; j < dayEvents.length; j++) {
        var dot = document.createElement("span");
        dot.className = "ev-dot" + (dayEvents[j].start ? " timed" : "");
        dot.style.background = labelColor(dayEvents[j].labelId);
        dots.appendChild(dot);
      }
      btn.appendChild(dots);

      (function (cd) {
        btn.addEventListener("click", function () { selectDay(cd); });
        // Wave 3: drop target — accepts only calendar-event payloads
        // (the "cal-ev:" prefix check happens in the drop handler).
        btn.addEventListener("dragover", function (de) {
          var types = de.dataTransfer.types;
          if (types && Array.prototype.indexOf.call(types, "text/plain") !== -1) {
            de.preventDefault();               // required: makes the drop legal
            de.dataTransfer.dropEffect = "move";
            btn.classList.add("drop-target");
          }
        });
        btn.addEventListener("dragleave", function () {
          btn.classList.remove("drop-target");
        });
        btn.addEventListener("drop", function (de) {
          de.preventDefault();
          btn.classList.remove("drop-target");
          var raw = "";
          try { raw = de.dataTransfer.getData("text/plain") || ""; } catch (e2) {}
          if (raw.indexOf("cal-ev:") !== 0) return;
          moveEventToDate(raw.slice(7), cd);
        });
      })(cellDate);

      grid.appendChild(btn);
    }
  }

  /* ---------- 4b. Week view ---------- */
  function renderWeek() {
    var grid = $("week-grid");
    grid.textContent = "";
    var today = todayYMD();

    for (var i = 0; i < 7; i++) {
      var dayYmd = dAdd(weekAnchor, i);
      var p = dayYmd.split("-");

      // A11y fix: div + role="button" — the day column CONTAINS
      // .wk-ev buttons, so it must not itself be a button.
      var col = document.createElement("div");
      col.setAttribute("role", "button");
      col.tabIndex = 0;
      col.className = "wk-col" +
        (dayYmd === today ? " today" : "") +
        (selDate === dayYmd ? " sel" : "");

      var head = document.createElement("div");
      head.className = "wk-head";
      var dn = document.createElement("span");
      dn.className = "wk-dnum";
      dn.textContent = t("wd")[i] + " " + (+p[2]);
      head.appendChild(dn);
      col.appendChild(head);

      var body = document.createElement("div");
      body.className = "wk-body";
      var dayEvents = eventsOn(dayYmd);
      if (!dayEvents.length) {
        var em = document.createElement("div");
        em.className = "wk-empty";
        em.textContent = "—";
        body.appendChild(em);
      }
      dayEvents.forEach(function (e) {
        var sp = spanInfo(e, dayYmd);
        var ev = document.createElement("button");
        ev.type = "button";
        ev.className = "wk-ev";
        ev.style.borderLeftColor = labelColor(e.labelId);
        if (e.start) {
          var tm = document.createElement("span");
          tm.className = "wk-ev-time";
          tm.textContent = e.start;
          ev.appendChild(tm);
        }
        ev.appendChild(document.createTextNode(
          (sp && sp.idx > 1 ? "…" : "") +
          (e.title || t("ev.untitled")) +
          (sp ? " (" + sp.idx + "/" + sp.days + ")" : "") +
          (validRecur(e.recur) ? " ↻" : "")));
        (function (ee) {
          ev.addEventListener("click", function (evt) {
            evt.stopPropagation();
            if (ee._feed) { openFeedRow(ee); return; }
            if (validRecur(ee.recur)) showSerChooser(ee, dayYmd);
            else openDlg(ee);
          });
        })(e);
        body.appendChild(ev);
      });
      col.appendChild(body);

      (function (cd) {
        col.addEventListener("click", function () { selectDay(cd); });
        col.addEventListener("keydown", function (ke) {
          if (ke.key === "Enter" || ke.key === " ") {
            ke.preventDefault();
            selectDay(cd);
          }
        });
      })(dayYmd);

      grid.appendChild(col);
    }
  }

  /* ---------- 4c. Agenda view + search results ---------- */
  var agendaStart = null, agendaLimitDays = AGENDA_STEP;

  function renderAgenda() {
    var ul = $("agenda-list");
    ul.textContent = "";
    if (!agendaStart) agendaStart = todayYMD();
    var today = todayYMD();

    var shown = 0;
    for (var i = 0; i < agendaLimitDays; i++) {
      var dayYmd = dAdd(agendaStart, i);
      var dayEvents = eventsOn(dayYmd);
      if (!dayEvents.length) continue;

      var li = document.createElement("li");
      li.className = "ag-day" + (dayYmd === today ? " ag-today" : "");

      var head = document.createElement("div");
      head.className = "ag-day-head";
      var nm = document.createElement("span");
      nm.className = "ag-day-name";
      var p = dayYmd.split("-");
      var d = new Date(+p[0], +p[1] - 1, +p[2]);
      nm.textContent = t("wd")[(d.getDay() + 6) % 7] + " " +
        (+p[2]) + " " + t("months")[+p[1] - 1];
      var cnt = document.createElement("span");
      cnt.className = "ag-count";
      cnt.textContent = String(dayEvents.length);
      head.appendChild(nm);
      head.appendChild(cnt);
      li.appendChild(head);

      dayEvents.forEach(function (e) {
        li.appendChild(buildEvRow(e, dayYmd));
      });
      ul.appendChild(li);
      shown++;
    }

    if (!shown) {
      var emp = document.createElement("li");
      emp.className = "empty";
      emp.textContent = t("ag.empty");
      ul.appendChild(emp);
    }
    // Το κουμπί εμφανίζεται μόνο όταν το τρέχον παράθυρο είχε
    // περιεχόμενο — δίπλα σε μήνυμα κενού δεν προφέρουμε paginator.
    if (shown) {
      var more = document.createElement("button");
      more.type = "button";
      more.className = "mini ag-more";
      more.textContent = t("ag.more");
      more.addEventListener("click", function () {
        agendaLimitDays += AGENDA_STEP;
        renderAgenda();
      });
      ul.appendChild(more);
    }
  }

  function renderSearch() {
    var ul = $("search-results");
    ul.textContent = "";
    var q = searchQ.trim().toLowerCase();
    if (!q) return;

    var hits = state.events.filter(function (e) {
      return labelVisible(e.labelId) &&
        ((e.title || "").toLowerCase().indexOf(q) !== -1 ||
         (e.note || "").toLowerCase().indexOf(q) !== -1 ||
         (e.location || "").toLowerCase().indexOf(q) !== -1);
    }).sort(function (a, b) {
      return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
    });

    if (!hits.length) {
      var emp = document.createElement("li");
      emp.className = "res-empty";
      emp.textContent = t("srch.empty");
      ul.appendChild(emp);
      return;
    }
    hits.forEach(function (e) {
      var li = document.createElement("li");
      li.className = "res-row";
      var dt = document.createElement("span");
      dt.className = "res-date";
      var p = e.date.split("-");
      dt.textContent = (+p[2]) + " " + t("months")[+p[1] - 1].slice(0, 3) + " " + p[0] +
        (e.dateEnd ? " –" : "");
      var ti = document.createElement("span");
      ti.className = "res-title";
      ti.textContent = (e.title || t("ev.untitled")) +
        (validRecur(e.recur) ? " ↻" : "");
      li.appendChild(dt);
      li.appendChild(ti);
      li.addEventListener("click", function () {
        // jump: clear search, show that month, select the day
        setSearch("");
        var pd = e.date.split("-");
        viewYear = +pd[0];
        viewMonth = +pd[1] - 1;
        if (curView === "week") {
          weekAnchor = mondayOf(e.date);
        } else if (curView === "agenda") {
          // Agenda: τραβάμε το παράθυρο πίσω ώστε η εβδομάδα του
          // συμβάντος να οδηγεί τη λίστα.
          agendaStart = mondayOf(e.date);
          agendaLimitDays = AGENDA_STEP;
        }
        selectDay(e.date);
        var sec = document.querySelector(".sec");
        if (sec) sec.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      ul.appendChild(li);
    });
  }

  function setSearch(q) {
    searchQ = q;
    renderAll();
  }

  /* ---------- Pane switching — ONE place decides visibility ---------- */
  function syncPanes() {
    var searching = searchQ.trim().length > 0;
    var month = curView === "month" && !searching;
    var week = curView === "week" && !searching;
    var agenda = curView === "agenda" && !searching;
    $("cal-wd").hidden = !month;
    $("cal-grid").hidden = !month;
    $("week-grid").hidden = !week;
    $("agenda-list").hidden = !agenda;
    $("search-results").hidden = !searching;
  }

  function setView(v) {
    curView = v;
    ["month", "week", "agenda"].forEach(function (k) {
      var b = $("vw-" + k);
      if (b) b.classList.toggle("active", k === v);
    });
    if (v === "week") {
      weekAnchor = mondayOf(selDate || todayYMD());
    }
    if (v === "agenda") { agendaStart = todayYMD(); agendaLimitDays = AGENDA_STEP; }
    renderAll();
  }

  function renderAll() {
    renderTitle();
    syncPanes();
    var searching = searchQ.trim().length > 0;
    if (searching) { renderSearch(); return; }
    if (curView === "month") { renderWeekdays(); renderGrid(); }
    else if (curView === "week") { renderWeek(); }
    else if (curView === "agenda") { renderAgenda(); }
  }

  // View switcher + search wiring (guarded — stale HTML cannot crash)
  ["month", "week", "agenda"].forEach(function (k) {
    var b = $("vw-" + k);
    if (b) b.addEventListener("click", function () { setSearch(""); setView(k); });
  });
  if ($("search-in")) {
    $("search-in").addEventListener("input", function () {
      setSearch(this.value);
    });
    // Esc inside the field clears the search too (the global
    // keydown handler skips INPUT targets — special case here)
    $("search-in").addEventListener("keydown", function (e) {
      if (e.key === "Escape" && searchQ) {
        e.preventDefault();
        this.value = "";
        setSearch("");
      }
    });
  }

  /* ---------- 4d. Label filter chips ---------- */
  function renderChips() {
    var row = $("lbl-chips");
    row.textContent = "";
    state.labels.forEach(function (l) {
      var c = document.createElement("button");
      c.type = "button";
      c.className = "chip" + (labelVisible(l.id) ? "" : " off");
      var dot = document.createElement("span");
      dot.className = "chip-dot";
      dot.style.background = l.color;
      c.appendChild(dot);
      c.appendChild(document.createTextNode(l.name));
      c.addEventListener("click", function () {
        labelVis[l.id] = !labelVisible(l.id);
        renderChips();
        renderAll();
        renderDay();
      });
      row.appendChild(c);
    });
    FEED_LABELS.forEach(function (fl) {
      var fc = document.createElement("button");
      fc.type = "button";
      fc.className = "chip" + (labelVisible(fl.id) ? "" : " off");
      var fdot = document.createElement("span");
      fdot.className = "chip-dot";
      fdot.style.background = fl.color;
      fc.appendChild(fdot);
      fc.appendChild(document.createTextNode(feedLabelName(fl)));
      fc.addEventListener("click", function () {
        labelVis[fl.id] = !labelVisible(fl.id);
        renderChips();
        renderAll();
        renderDay();
      });
      row.appendChild(fc);
    });
    var mg = document.createElement("button");
    mg.type = "button";
    mg.className = "chip chip-manage";
    mg.textContent = "＋ " + t("lbl.manage");
    mg.addEventListener("click", openLblDlg);
    row.appendChild(mg);
  }

  /* ---------- 5. Day section ---------- */
  function selectDay(dateStr) {
    selDate = dateStr;
    renderAll();
    renderDay();
  }

  function timeSpan(e) {
    if (e.start === null) return t("ev.alltime");
    return e.start + (e.end ? " – " + e.end : "");
  }

  // Shared row builder — day list AND agenda use the exact same
  // markup + interactions (chooser logic included), so a click
  // behaves identically everywhere.
  function buildEvRow(e, dayYmd) {
    var li = document.createElement("li");
    li.className = "ev-row";

    var time = document.createElement("span");
    time.className = "ev-time";
    time.textContent = timeSpan(e);

    var main = document.createElement("div");
    main.className = "ev-main";
    var title = document.createElement("div");
    title.className = "ev-title";
    var titleTxt = document.createElement("span");
    titleTxt.className = "ev-title-text";
    titleTxt.textContent = e.title || t("ev.untitled");
    title.appendChild(titleTxt);
    if (validRecur(e.recur)) {
      var rp = document.createElement("span");
      rp.className = "ev-repeat";
      rp.title = recurDesc(e);
      rp.textContent = "↻";
      title.appendChild(rp);
    }

    var lb = e.labelId ? labelById(e.labelId) : null;
    if (lb) {
      var tag = document.createElement("span");
      tag.className = "ev-label";
      tag.style.background = lb.color;
      tag.textContent = (lb.name !== undefined) ? lb.name : feedLabelName(lb);
      title.appendChild(tag);
    }
    main.appendChild(title);

    var sp = spanInfo(e, dayYmd);
    if (sp) {
      var cont = document.createElement("div");
      cont.className = "ev-cont";
      cont.textContent = t("ev.cont")
        .replace("{a}", String(sp.idx))
        .replace("{b}", String(sp.days));
      main.appendChild(cont);
    }
    if (e.location) {
      var loc = document.createElement("div");
      loc.className = "ev-note ev-loc";
      loc.textContent = "▸ " + e.location;
      main.appendChild(loc);
    }
    if (e.note) {
      var note = document.createElement("div");
      note.className = "ev-note";
      note.textContent = e.note;
      main.appendChild(note);
    }
    li.appendChild(time);
    li.appendChild(main);
    (function (ev) {
      li.addEventListener("click", function () {
        // Wave 4: feed rows are read-only — one click deep-links
        // to the owning app (Contacts/Cycle/Mood), never the
        // event dialog.
        if (ev._feed) { openFeedRow(ev); return; }
        // Series occurrence → chooser first (this occurrence vs
        // the whole series). Saved overrides are plain events.
        if (validRecur(ev.recur)) showSerChooser(ev, dayYmd);
        else openDlg(ev);
      });
      // Wave 3 drag & drop (desktop): plain, SINGLE-day events +
      // overrides only. Series anchors and multi-day spans are
      // NOT draggable — moving a span by a mouse gesture would
      // silently redefine its duration.
      if (!ev._feed && !validRecur(ev.recur) && !ev.dateEnd) {
        li.draggable = true;
        li.addEventListener("dragstart", function (de) {
          try {
            de.dataTransfer.setData("text/plain", "cal-ev:" + ev.id);
            de.dataTransfer.effectAllowed = "move";
          } catch (e2) {}
          li.classList.add("dragging");
        });
        li.addEventListener("dragend", function () {
          li.classList.remove("dragging");
        });
      }
    })(e);
    return li;
  }

  function renderDay() {
    var head = $("day-title");
    if (!selDate) {
      head.textContent = "";
      $("ev-list").textContent = "";
      return;
    }
    var parts = selDate.split("-");
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    var txt = d.getDate() + " " + t("months")[d.getMonth()];
    if (selDate === todayYMD()) txt += " — " + t("day.today");
    head.textContent = txt;

    var ul = $("ev-list");
    ul.textContent = "";
    var list = eventsOn(selDate);
    if (!list.length) {
      var li0 = document.createElement("li");
      li0.className = "empty";
      li0.textContent = t("ev.none");
      ul.appendChild(li0);
      return;
    }
    list.forEach(function (e) { ul.appendChild(buildEvRow(e, selDate)); });
  }
  
  /* ---------- 6. Navigation (view-aware) ---------- */
  // Selection follows the viewed month: the day panel always shows
  // a date that is actually on screen (Add targets the visible day).
  function navStep(dir) {
    if (curView === "week") {
      weekAnchor = dAdd(weekAnchor, dir * 7);
      // Η επιλογή ταξιδεύει στην ΙΔΙΑ μέρα της εβδομάδας (shift 7
      // ημερών). Το clamp την κρατά πάντα μέσα στην ορατή εβδομάδα.
      var newSel = selDate ? dAdd(selDate, dir * 7) : weekAnchor;
      if (newSel < weekAnchor) newSel = weekAnchor;
      if (newSel > dAdd(weekAnchor, 6)) newSel = dAdd(weekAnchor, 6);
      selectDay(newSel);   // single paint
      return;
    }
    if (curView === "agenda") {
      agendaStart = dAdd(agendaStart || todayYMD(), dir * AGENDA_STEP);
      agendaLimitDays = AGENDA_STEP;
      renderAll();
      return;
    }
    // month
    viewMonth += dir;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    followView();
  }
  // Ακριβώς ΕΝΑ paint ανά πλοήγηση: αν η επιλογή μετακινείται,
  // το selectDay ζωγραφίζει· αλλιώς ζωγραφίζει εδώ.
  function followView() {
    if (selDate) {
      var p = selDate.split("-");
      if (+p[0] === viewYear && (+p[1] - 1) === viewMonth) {
        renderAll(); renderDay();
        return;
      }
      selectDay(ymd(viewYear, viewMonth, 1));   // paints internally
      return;
    }
    renderAll(); renderDay();
  }
  $("cal-prev").addEventListener("click", function () { navStep(-1); });
  $("cal-next").addEventListener("click", function () { navStep(1); });
  $("cal-today").addEventListener("click", function () {
    var n = new Date();
    viewYear = n.getFullYear();
    viewMonth = n.getMonth();
    agendaStart = todayYMD();
    agendaLimitDays = AGENDA_STEP;
    weekAnchor = mondayOf(todayYMD());
    $("search-in").value = "";
    searchQ = "";              // σιωπηλά — το selectDay κάνει το ΜΟΝΟ repaint
    selectDay(todayYMD());
  });

  /* ---------- 7. Event dialog (add & edit) ---------- */
  var editingId = null;

  // Label picker inside the dialog: chips + "none". Local only —
  // committed on Save (unlike the month-view chips which filter).
  var dlgLabelId = null;

  /* ---------- 7c. Dialog state + series helpers ---------- */
  // dlgMode: null = plain event / new, "master" = editing the whole
  // series, "occ" = editing ONE occurrence (override on save).
  // pendingOverride carries master id + occurrence date across
  // chooser → dialog → save.
  var dlgMode = null;
  var pendingOverride = null;

  function dlgReadRecur() {
    var sel = $("ev-repeat");
    if (!sel) return null;
    var v = sel.value;                  // "" | "D-1" | "W-1" | "W-2" | "M-1" | "Y-1"
    if (!v) return null;
    var p = v.split("-");
    var r = { freq: p[0], interval: p[1] === "2" ? 2 : 1 };
    var untilRaw = $("ev-until") ? $("ev-until").value : "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(untilRaw)) r.until = untilRaw;
    return sanitizeRecur(r);
  }

  // Multi-day end date: valid only when Repeat = None. An empty
  // or equal-to-anchor value = plain single-day event.
  function dlgReadDateEnd() {
    var row = $("ev-dateend-row");
    var inp = $("ev-date-end");
    if (!row || !inp || !inp.value) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inp.value)) return null;
    if (row.className.indexOf("show") === -1) return null;   // hidden → stale
    return inp.value;
  }

  function dlgReadRemind() {
    var sel = $("ev-remind");
    if (!sel || !sel.value) return null;
    var v = parseInt(sel.value, 10);
    return REMIND_PRESETS.indexOf(v) !== -1 ? v : null;
  }

  function remLabel(min) {
    if (min >= 1440) return t("rem.day").replace("{n}", String(Math.round(min / 1440)));
    if (min >= 60)   return t("rem.hour").replace("{n}", String(Math.round(min / 60)));
    return t("rem.min").replace("{n}", String(min));
  }

  // Occurrence exclusion on a master: push + SORT (the sanitized
  // shape keeps exdates sorted — merge determinism depends on it).
  function exdateMaster(masterId, occYmd) {
    for (var i = 0; i < state.events.length; i++) {
      var m = state.events[i];
      if (m.id === masterId && validRecur(m.recur)) {
        if (m.recur.exdates.indexOf(occYmd) === -1) {
          m.recur.exdates.push(occYmd);
          m.recur.exdates.sort();
        }
        m.mtime = Date.now();
        saveState();
        return true;
      }
    }
    console.warn("[Calendar] exdateMaster: master not found", masterId);
    return false;
  }

  // Chooser: recurring event clicked in the day panel → ask which
  // scope before opening the dialog. Override clones (already
  // split off) are plain events and skip this entirely.
  function showSerChooser(master, occYmd) {
    var dlg = $("ser-dlg");
    if (!dlg) { openDlg(master, "master"); return; }   // stale HTML — safe fallback
    $("ser-q").textContent = t("ser.edit.q");
    serCb = function (which) {
      if (which === "this") openDlgOccurrence(master, occYmd);
      else if (which === "all") openDlg(master, "master");
      // which === null → backdrop dismissal: pure cancel, nothing opens
    };
    dlg.showModal();
  }
  var serCb = null;

  function openDlgOccurrence(master, occYmd) {
    pendingOverride = { masterId: master.id, occYmd: occYmd };
    openDlg(master, "occ");
  }

  // Series chooser wiring + reminder select options + until-row
  // toggle — all guarded so a stale index.html cannot crash the app.
  if ($("ser-this") && $("ser-all")) {
    $("ser-this").addEventListener("click", function () {
      $("ser-dlg").close();
      if (serCb) serCb("this");
    });
    $("ser-all").addEventListener("click", function () {
      $("ser-dlg").close();
      if (serCb) serCb("all");
    });
    $("ser-dlg").addEventListener("click", function (ev) {
      if (ev.target === this) { this.close(); if (serCb) serCb(null); }
    });
    $("ser-dlg").addEventListener("cancel", function () {
      serCb = null;   // Esc: dismissed — never act on the stale callback
    });
  }
  if ($("ev-remind")) {
    var remSel = $("ev-remind");
    var noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = t("rem.none");
    remSel.appendChild(noneOpt);
    REMIND_PRESETS.forEach(function (m) {
      var o = document.createElement("option");
      o.value = String(m);
      o.textContent = remLabel(m);
      remSel.appendChild(o);
    });
  }
  if ($("ev-repeat")) {
    $("ev-repeat").addEventListener("change", function () {
      var uRow = $("ev-until-row");
      if (uRow) uRow.className = "dlg-row" + (this.value ? " show" : "");
      // Multi-day end is the OPPOSITE face: visible only on
      // Repeat = None (a series defines its own boundary via Until).
      var deRow = $("ev-dateend-row");
      if (deRow) deRow.className = "dlg-row" + (this.value ? "" : " show");
      var sh = $("ev-spanhint");
      // Series → κρυφό. Επιστροφή σε None → ξαναδείχνεται, αλλά
      // ΜΟΝΟ αν το openDlg γέμισε πραγματικά το κείμενο.
      if (sh) sh.hidden = !!this.value || !sh.textContent;
    });
  }

  function renderDlgLabels() {
    var row = $("ev-label-row");
    row.textContent = "";
    var mk = function (id, name, color) {
      var c = document.createElement("button");
      c.type = "button";
      c.className = "chip" + (dlgLabelId === id ? "" : " off");
      if (color) {
        var dot = document.createElement("span");
        dot.className = "chip-dot";
        dot.style.background = color;
        c.appendChild(dot);
      }
      c.appendChild(document.createTextNode(name));
      c.addEventListener("click", function () {
        dlgLabelId = id;
        renderDlgLabels();
      });
      row.appendChild(c);
    };
    mk(null, t("lbl.none"), null);
    state.labels.forEach(function (l) { mk(l.id, l.name, l.color); });
  }

  function openDlg(existing, mode) {
    dlgMode = mode || null;
    if (mode !== "occ") pendingOverride = null;   // kept by openDlgOccurrence
    editingId = (mode === "occ") ? null : (existing ? existing.id : null);
    $("ev-dlg-title").textContent = t(existing ? "ev.dlg.edit" : "ev.dlg.new");
    $("ev-title").value = existing ? existing.title : "";
    $("ev-start").value = existing && existing.start ? existing.start : "09:00";
    $("ev-end").value = existing && existing.end ? existing.end : "";
    $("ev-allday").checked = existing ? existing.start === null : false;
    $("ev-allday").dispatchEvent(new Event("change"));
    $("ev-location").value = existing ? existing.location : "";
    $("ev-note").value = existing ? existing.note : "";

    // Repeat: masters carry it; an occurrence override starts plain.
    var r = (mode === "occ") ? null : (existing ? existing.recur : null);
    var rv = validRecur(r) ? (r.freq + "-" + (r.interval === 2 ? 2 : 1)) : "";
    var repSel = $("ev-repeat");
    if (repSel) {
      repSel.value = rv;
      var uIn = $("ev-until");
      if (uIn) uIn.value = (rv && r.until) ? r.until : "";
      var uRow = $("ev-until-row");
      if (uRow) uRow.className = "dlg-row" + (rv ? " show" : "");
      var deRow = $("ev-dateend-row");
      var deIn = $("ev-date-end");
      if (deRow && deIn) {
        // Multi-day: prefilled from the event, offered only on
        // plain events (a series never carries a dateEnd).
        var hasEnd = (existing && existing.dateEnd && !rv) ? existing.dateEnd : "";
        deIn.value = hasEnd;
        deRow.className = "dlg-row" + (rv ? "" : " show");
      }
    }
    // Span hint (v0.3.1): editing an EXISTING multi-day event →
    // warn that Save re-anchors the start to the selected day.
    var sh = $("ev-spanhint");
    if (sh) {
      var bDays = (existing && existing.dateEnd && !rv)
        ? Math.round((dparse(existing.dateEnd) - dparse(existing.date)) / 86400000) + 1
        : 0;
      sh.textContent = bDays
        ? t("ev.spanHint").replace("{b}", String(bDays))
        : "";
      sh.hidden = !bDays;
    }
    // Reminder: prefilled from the event (occurrence inherits master's).
    var remSel = $("ev-remind");
    if (remSel) {
      remSel.value = (existing && existing.remindMin) ? String(existing.remindMin) : "";
    }

    dlgLabelId = existing ? existing.labelId : null;
    renderDlgLabels();
    // Occurrence mode keeps the delete button too — del-dlg-yes
    // routes occ-mode deletes to exdateMaster (the series lives on).
    $("ev-del-row").className = "dlg-row" +
      (existing ? " show" : "");
    $("ev-dlg").showModal();
    setTimeout(function () { $("ev-title").focus(); }, 50);
  }

  $("ev-allday").addEventListener("change", function () {
    var off = $("ev-allday").checked;
    $("ev-start").disabled = off;
    $("ev-end").disabled = off;
  });

  $("ev-add").addEventListener("click", function () {
    if (!selDate) selectDay(todayYMD());
    openDlg(null);
  });

  $("ev-save").addEventListener("click", function () {
    var title = $("ev-title").value.trim();
    if (!title) {
      var ti = $("ev-title");
      ti.classList.add("invalid");
      ti.focus();
      toast(t("ev.err.title"));
      setTimeout(function () { ti.classList.remove("invalid"); }, 1600);
      return;
    }
    if (!selDate) { $("ev-dlg").close(); return; }

    var start = tpStart ? tpStart.value() : null;
    var end = tpEnd ? tpEnd.value() : null;
    if ($("ev-allday").checked) { start = null; end = null; }
    if (start && end && end <= start) {
      $("ev-end").classList.add("invalid");
      $("ev-end").focus();
      toast(t("ev.err.time"));
      setTimeout(function () { $("ev-end").classList.remove("invalid"); }, 1600);
      return;
    }

    var recur = dlgReadRecur();
    var dateEnd = null;
    if (!recur) {
      dateEnd = dlgReadDateEnd();
      // Validation: end day must be on/after the anchor. The anchor
      // for edits of plain events is the SELECTED day (date follows
      // selDate below); for new events it IS selDate — same thing.
      if (dateEnd && dateEnd < selDate) {
        var deIn = $("ev-date-end");
        deIn.classList.add("invalid");
        deIn.focus();
        toast(t("ev.err.dateend"));
        setTimeout(function () { deIn.classList.remove("invalid"); }, 1600);
        return;
      }
    }

    var location = $("ev-location").value.trim().slice(0, 150);
    var note = $("ev-note").value.trim().slice(0, 500);
    var remindMin = dlgReadRemind();

    // "until" sanity: an end date at/before the anchor date would
    // kill every occurrence — drop it instead (series stays open).
    var anchorDate = selDate;
    if (editingId) {
      for (var ad = 0; ad < state.events.length; ad++) {
        if (state.events[ad].id === editingId) {
          anchorDate = state.events[ad].date;
          break;
        }
      }
    }
    if (recur && recur.until && recur.until <= anchorDate) recur.until = null;

    // "This occurrence" save → OVERRIDE: exdate on the master, then
    // a standalone copy here. The rest of the series is untouched.
    if (dlgMode === "occ" && pendingOverride) {
      exdateMaster(pendingOverride.masterId, pendingOverride.occYmd);
      state.events.push({
        id: uid(),
        date: pendingOverride.occYmd,
        dateEnd: dateEnd,
        start: start,
        end: end,
        title: title,
        note: note,
        location: location,
        labelId: dlgLabelId,
        recur: null,          // a single instance — never a series
        remindMin: remindMin,
        mtime: Date.now()
      });
      pendingOverride = null;
      dlgMode = null;
      saveState();
      $("ev-dlg").close();
      renderAll();
      renderDay();
      return;
    }

    if (editingId) {
      var found = false;
      for (var i = 0; i < state.events.length; i++) {
        if (state.events[i].id === editingId) {
          // A series keeps its anchor date — the recurrence math
          // depends on it. A plain event follows the selected day.
          var isSeries = validRecur(state.events[i].recur);
          state.events[i].title = title;
          state.events[i].start = start;
          state.events[i].end = end;
          state.events[i].location = location;
          state.events[i].note = note;
          state.events[i].labelId = dlgLabelId;
          if (!isSeries) state.events[i].date = selDate;
          // Plain edit: a cleared dateEnd = single-day again;
          // series edit can never set one (recur dominates).
          state.events[i].dateEnd = isSeries ? null : dateEnd;
          state.events[i].recur = recur;
          state.events[i].remindMin = remindMin;
          state.events[i].mtime = Date.now();
          found = true;
          break;
        }
      }
      // Edited while another device deleted it → resurrect with fresh input
      // (fresh mtime beats the tombstone, same contract as mood/time).
      if (!found) {
        state.events.push({
          id: editingId,
          date: selDate,
          dateEnd: dateEnd,
          start: start,
          end: end,
          title: title,
          note: note,
          location: location,
          labelId: dlgLabelId,
          recur: recur,
          remindMin: remindMin,
          mtime: Date.now()
        });
      }
      // Any edit outranks a stale tombstone (no phantom deletes survive).
      state.deleted = state.deleted.filter(function (d) {
        return d.id !== editingId;
      });
    } else {
      state.events.push({
        id: uid(),
        date: selDate,
        dateEnd: dateEnd,
        start: start,
        end: end,
        title: title,
        note: note,
        location: location,
        labelId: dlgLabelId,
        recur: recur,
        remindMin: remindMin,
        mtime: Date.now()
      });
    }
    // Web-notification permission: Save is a legal user gesture —
    // the ONLY moment we may ask. Fire-and-forget, no-op if already
    // decided or unsupported (the shell fires only when granted).
    if (remindMin && "Notification" in window &&
        Notification.permission === "default") {
      try { Notification.requestPermission(); } catch (e) {}
    }
    saveState();
    $("ev-dlg").close();
    renderAll();
    renderDay();
  });

  $("ev-cancel").addEventListener("click", function () { $("ev-dlg").close(); });
  // Outside-click close: a click whose target IS the dialog hit the backdrop.
  $("ev-dlg").addEventListener("click", function (ev) {
    if (ev.target === this) this.close();
  });

  /* Delete: themed confirm + UNDO (resurrection via fresh mtime —
     the merge contract already guarantees the tombstone is beaten). */
  var lastDeleted = null;

  $("ev-delete").addEventListener("click", function () {
    // Occurrence mode: delete THIS occurrence (exdate on the master).
    // editingId is null here by design — the pendingOverride pair
    // carries the identity instead.
    if (dlgMode === "occ" && pendingOverride) {
      var m = null;
      for (var oi = 0; oi < state.events.length; oi++) {
        if (state.events[oi].id === pendingOverride.masterId) { m = state.events[oi]; break; }
      }
      $("del-dlg-text").textContent =
        (m && m.title ? m.title : t("ev.untitled"));
      $("del-dlg").showModal();
      $("del-dlg-yes").focus();
      return;
    }
    if (!editingId) return;
    var ev = null;
    for (var i = 0; i < state.events.length; i++) {
      if (state.events[i].id === editingId) { ev = state.events[i]; break; }
    }
    $("del-dlg-text").textContent =
      (ev && ev.title ? ev.title : t("ev.untitled"));
    $("del-dlg").showModal();
    $("del-dlg-yes").focus();
  });

  var lastExdate = null;   // { id, ymd } — undo data for occurrence deletes

  $("del-dlg-yes").addEventListener("click", function () {
    // Deleting from occurrence mode = exdate on the master: the
    // series survives, this instance goes away. No tombstone — the
    // master is still very much alive.
    if (dlgMode === "occ" && pendingOverride) {
      exdateMaster(pendingOverride.masterId, pendingOverride.occYmd);
      lastExdate = {
        id: pendingOverride.masterId,
        ymd: pendingOverride.occYmd
      };
      saveState();
      pendingOverride = null;
      dlgMode = null;
      editingId = null;
      $("del-dlg").close();
      $("ev-dlg").close();
      renderAll();
      renderDay();
      toast(t("del.done"), t("undo"), undoExdate);
      return;
    }
    if (!editingId) { $("del-dlg").close(); return; }
    var ev = null;
    for (var i = 0; i < state.events.length; i++) {
      if (state.events[i].id === editingId) { ev = state.events[i]; break; }
    }
    state.events = state.events.filter(function (e) { return e.id !== editingId; });
    state.deleted.push({ id: editingId, mtime: Date.now() });
    saveState();
    lastDeleted = ev ? JSON.parse(JSON.stringify(ev)) : null;
    editingId = null;   // clear dangling state
    $("del-dlg").close();
    $("ev-dlg").close();
    renderAll();
    renderDay();
    if (lastDeleted) toast(t("del.done"), t("undo"), undoDelete);
  });

  $("del-dlg-no").addEventListener("click", function () {
    $("del-dlg").close();
  });

  // Outside-click close (same pattern as #ev-dlg)
  $("del-dlg").addEventListener("click", function (ev) {
    if (ev.target === this) this.close();
  });

  function undoDelete() {
    if (!lastDeleted) return;
    lastDeleted.mtime = Date.now();   // fresh: beats the tombstone
    state.events.push(lastDeleted);
    state.deleted = state.deleted.filter(function (d) {
      return d.id !== lastDeleted.id;
    });
    lastDeleted = null;
    saveState();
    renderAll();
    renderDay();
  }

  // Undo an occurrence delete: pull the date back out of the
  // master's exdates — the occurrence simply reappears.
  function undoExdate() {
    if (!lastExdate) return;
    for (var i = 0; i < state.events.length; i++) {
      var m = state.events[i];
      if (m.id === lastExdate.id && validRecur(m.recur)) {
        m.recur.exdates = m.recur.exdates.filter(function (d) {
          return d !== lastExdate.ymd;
        });
        m.mtime = Date.now();
        break;
      }
    }
    lastExdate = null;
    saveState();
    renderAll();
    renderDay();
  }

  /* ---------- 7d. Drag & drop move + undo (Wave 3) ---------- */
  // Plain SINGLE-DAY events + overrides only (see buildEvRow note).
  // A move = date change + fresh mtime → travels via sync merge.
  // Undo restores the old date with ANOTHER fresh mtime (beats
  // everything, same resurrection contract as undoDelete).
  var lastMoved = null;   // { id, fromYmd }

  function moveEventToDate(id, targetYmd) {
    var ev = null;
    for (var i = 0; i < state.events.length; i++) {
      if (state.events[i].id === id) { ev = state.events[i]; break; }
    }
    if (!ev || validRecur(ev.recur) || ev.dateEnd) return;   // defensive: spans/series never move by drag
    if (ev.date === targetYmd) { selectDay(targetYmd); return; }   // no-op drop on self

    lastMoved = { id: id, fromYmd: ev.date };
    ev.date = targetYmd;
    ev.mtime = Date.now();
    saveState();
    selectDay(targetYmd);   // day panel follows — selectDay paints once
    toast(t("ev.moved"), t("undo"), undoMove);
  }

  function undoMove() {
    if (!lastMoved) return;
    var backTo = lastMoved.fromYmd;   // capture BEFORE nulling —
    for (var i = 0; i < state.events.length; i++) {
      if (state.events[i].id === lastMoved.id) {
        state.events[i].date = backTo;
        state.events[i].mtime = Date.now();
        break;
      }
    }
    lastMoved = null;
    saveState();
    selectDay(backTo);   // day panel returns — selectDay paints once
  }

  /* ---------- 7a. Label management dialog ---------- */
  function nextFreeColor() {
    for (var i = 0; i < LABEL_PALETTE.length; i++) {
      var used = state.labels.some(function (l) { return l.color === LABEL_PALETTE[i]; });
      if (!used) return LABEL_PALETTE[i];
    }
    return LABEL_PALETTE[state.labels.length % LABEL_PALETTE.length];
  }

  var lblAddColor = null;          // chosen color for the NEXT new label
  function renderLblAddColors() {
    var wrap = $("lbl-add-colors");
    wrap.textContent = "";
    var def = nextFreeColor();
    LABEL_PALETTE.forEach(function (c) {
      var sw = document.createElement("button");
      sw.type = "button";
      sw.className = "lbl-swatch" +
        ((lblAddColor || def) === c ? " active" : "");
      sw.style.background = c;
      sw.setAttribute("aria-label", c);
      sw.addEventListener("click", function () {
        lblAddColor = c;
        renderLblAddColors();
      });
      wrap.appendChild(sw);
    });
  }

  function openLblDlg() {
    renderLblList();
    renderLblAddColors();
    $("lbl-dlg").showModal();
    $("lbl-new-name").focus();
  }

  function renderLblList() {
    var list = $("lbl-list");
    list.textContent = "";
    state.labels.forEach(function (l) {
      var row = document.createElement("div");
      row.className = "lbl-row";

      var dot = document.createElement("button");
      dot.type = "button";
      dot.className = "lbl-color-btn";
      dot.style.background = l.color;
      dot.setAttribute("aria-label", t("lbl.color"));
      dot.title = t("lbl.color");
      var pal = document.createElement("div");
      pal.className = "lbl-palette";
      pal.hidden = true;
      dot.addEventListener("click", function () {
        document.querySelectorAll(".lbl-palette").forEach(function (p) {
          if (p !== pal) p.hidden = true;
        });
        pal.hidden = !pal.hidden;
      });
      LABEL_PALETTE.forEach(function (c) {
        var sw = document.createElement("button");
        sw.type = "button";
        sw.className = "lbl-swatch" + (c === l.color ? " active" : "");
        sw.style.background = c;
        sw.setAttribute("aria-label", c);
        sw.addEventListener("click", function () {
          l.color = c;
          l.mtime = Date.now();   // color change propagates via merge
          saveState();
          renderLblList();
          renderChips();
          renderAll();
          renderDay();
        });
        pal.appendChild(sw);
      });
      row.appendChild(dot);

      var inp = document.createElement("input");
      inp.type = "text";
      inp.className = "lbl-name-in";
      inp.maxLength = 40;
      inp.value = l.name;
      inp.addEventListener("change", function () {
        l.name = inp.value.trim().slice(0, 40) || l.name;
        inp.value = l.name;
        l.mtime = Date.now();
        saveState();
        renderChips();
        renderAll();
        renderDay();
      });
      row.appendChild(inp);

      var del = document.createElement("button");
      del.type = "button";
      del.className = "btn danger lbl-del";
      del.textContent = t("lbl.delete");
      del.addEventListener("click", function () {
        var inUse = state.events.some(function (e) { return e.labelId === l.id; });
        if (inUse) { transientNote(t("lbl.inuse")); return; }
        state.labels = state.labels.filter(function (x) { return x.id !== l.id; });
        state.deleted.push({ id: l.id, mtime: Date.now() });   // label tombstone (shared list)
        delete labelVis[l.id];
        saveState();
        renderLblList();
        renderChips();
        renderAll();
        renderDay();
      });
      row.appendChild(del);
      row.appendChild(pal);   // color palette (toggled by the dot button)
      list.appendChild(row);
    });
    // Feed labels — visible but IMMUTABLE: born from FEED_LABELS,
    // never from state.labels, so no rename/delete/color controls.
    // Pure transparency: the user sees why these chips exist.
    if (FEED_LABELS.length) {
      var fh = document.createElement("div");
      fh.className = "lbl-feeds-head";
      fh.textContent = t("lbl.feeds");
      list.appendChild(fh);
      FEED_LABELS.forEach(function (fl) {
        var row = document.createElement("div");
        row.className = "lbl-row feed";

        var dot = document.createElement("span");
        dot.className = "lbl-color-dot";
        dot.style.background = fl.color;
        row.appendChild(dot);

        var nm = document.createElement("span");
        nm.className = "lbl-feed-name";
        nm.textContent = feedLabelName(fl);
        nm.title = t("lbl.feed.ro");
        row.appendChild(nm);

        var lk = document.createElement("span");
        lk.className = "lbl-lock";
        lk.textContent = "🔒";
        lk.title = t("lbl.feed.ro");
        lk.setAttribute("aria-hidden", "true");
        row.appendChild(lk);
        list.appendChild(row);
      });
    }
    if (!state.labels.length) {
      var emp = document.createElement("div");
      emp.className = "empty";
      emp.textContent = t("lbl.empty");
      list.appendChild(emp);
    }
  }

  $("lbl-add").addEventListener("click", function () {
    var name = $("lbl-new-name").value.trim().slice(0, 40);
    if (!name) {
      $("lbl-new-name").focus();
      return;
    }
    var id = "lbl-" + uid();
    state.labels.push({ id: id, name: name, color: lblAddColor || nextFreeColor(), mtime: Date.now() });
    $("lbl-new-name").value = "";
    lblAddColor = null;
    saveState();
    renderLblList();
    renderLblAddColors();
    renderChips();
  });
  $("lbl-new-name").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); $("lbl-add").click(); }
  });
  $("lbl-done").addEventListener("click", function () { $("lbl-dlg").close(); });
  $("lbl-dlg").addEventListener("click", function (ev) {
    if (ev.target === this) this.close();
  });
  
  /* ---------- 7b. Shell shortcut forwarding (Contract Β) ---------- */
  document.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
    var p = window.parent;
    if (!(p && p.orosShortcuts &&
        typeof p.orosShortcuts.handle === "function")) return;
    if (p.orosShortcuts.handle(e)) e.stopPropagation();
  }, true);

  /* ---------- 7e. ICS export (v0.3.0) ----------
     RFC 5545 subset: VEVENT with UID/DTSTART/DTEND/SUMMARY/
     DESCRIPTION/LOCATION/RRULE/EXDATE. All-day → VALUE=DATE;
     timed → floating local datetimes (no TZID — portable and
     faithful for personal calendars). Text escaping per spec. */
  function icsEsc(s) {
    return String(s == null ? "" : s)
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r?\n/g, "\\n");
  }
  function icsDt(dateYmd, hm) {
    var d = dateYmd.replace(/-/g, "");
    if (!hm) return d;                       // VALUE=DATE form
    return d + "T" + hm.replace(":", "") + "00";
  }
  function exportICS() {
    var L = [];
    L.push("BEGIN:VCALENDAR");
    L.push("VERSION:2.0");
    L.push("PRODID:-//orOS//Calendar//EN");
    L.push("CALSCALE:GREGORIAN");

    state.events.forEach(function (e) {
      L.push("BEGIN:VEVENT");
      L.push("UID:" + icsEsc(e.id) + "@oros.calendar");
      // 2000-01-01 fallback mtime as a stable STAMP source
      L.push("DTSTAMP:" + new Date(e.mtime || 946684800000).toISOString()
        .replace(/[-:]/g, "").replace(/\.\d+/, ""));
      if (e.start === null) {
        // all-day: DTEND is exclusive in RFC 5545 → +1 day
        var endDate = e.dateEnd ? dAdd(e.dateEnd, 1) : dAdd(e.date, 1);
        L.push("DTSTART;VALUE=DATE:" + icsDt(e.date));
        L.push("DTEND;VALUE=DATE:" + icsDt(endDate));
      } else {
        L.push("DTSTART:" + icsDt(e.date, e.start));
        L.push("DTEND:" + icsDt(e.dateEnd || e.date, e.end || e.start));
      }
      L.push("SUMMARY:" + icsEsc(e.title || t("ev.untitled")));
      if (e.note) L.push("DESCRIPTION:" + icsEsc(e.note));
      if (e.location) L.push("LOCATION:" + icsEsc(e.location));
      if (validRecur(e.recur)) {
        var FREQ_MAP = { D: "DAILY", W: "WEEKLY", M: "MONTHLY", Y: "YEARLY" };
        var rr = "RRULE:FREQ=" + FREQ_MAP[e.recur.freq];
        if (e.recur.interval === 2) rr += ";INTERVAL=2";
        if (e.recur.until) rr += ";UNTIL=" + icsDt(e.recur.until);
        L.push(rr);
        if (e.recur.exdates.length) {
          L.push("EXDATE;VALUE=DATE:" +
            e.recur.exdates.map(function (d) { return icsDt(d); }).join(","));
        }
      }
      var lb = e.labelId ? labelById(e.labelId) : null;
      if (lb) L.push("CATEGORIES:" + icsEsc(lb.name));
      if (typeof e.remindMin === "number" && e.remindMin > 0) {
        L.push("BEGIN:VALARM");
        L.push("ACTION:DISPLAY");
        L.push("TRIGGER:-PT" + e.remindMin + "M");
        L.push("DESCRIPTION:" + icsEsc(e.title || t("ev.untitled")));
        L.push("END:VALARM");
      }
      L.push("END:VEVENT");
    });

    L.push("END:VCALENDAR");

    var blob = new Blob([L.join("\r\n")], { type: "text/calendar;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "oros-calendar.ics";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    transientNote(t("exp.done"));
  }
  if ($("cal-export")) {
    $("cal-export").addEventListener("click", exportICS);
  }

  /* ---------- 7f. Stats dialog (v0.3.0) ---------- */
  function openStats() {
    var body = $("stat-body");
    body.textContent = "";

    var total = state.events.length;
    var recurring = state.events.filter(function (e) {
      return validRecur(e.recur);
    }).length;

    // upcoming 30 days — occurrences included, label-filter aware.
    // CP1 (Wave 2.1 close-out): state.events ONLY. eventsOn() now
    // injects the read-only Contacts feed, but "total" and byLabel
    // are store-backed — one truth for every KPI here: no feed
    // events in stats.
    var up = 0;
    var today = todayYMD();
    for (var i = 0; i < 30; i++) {
      up += state.events.filter(function (e) {
        return occursOn(e, dAdd(today, i)) && labelVisible(e.labelId);
      }).length;
    }

    var kpis = document.createElement("div");
    kpis.className = "stat-kpis";
    [["stat.kpi.total", total], ["stat.kpi.upcoming", up],
     ["stat.kpi.recurring", recurring]].forEach(function (pair) {
      var k = document.createElement("div");
      k.className = "stat-kpi";
      var b = document.createElement("b");
      b.textContent = String(pair[1]);
      var s = document.createElement("span");
      s.textContent = t(pair[0]);
      k.appendChild(b);
      k.appendChild(s);
      kpis.appendChild(k);
    });
    body.appendChild(kpis);

    // per-label distribution (bar share of labelled events)
    var byLbl = {};
    state.events.forEach(function (e) {
      var id = e.labelId || "";
      byLbl[id] = (byLbl[id] || 0) + 1;
    });
    var entries = Object.keys(byLbl).map(function (id) {
      return { id: id, count: byLbl[id] };
    }).sort(function (a, b) { return b.count - a.count; });

    if (entries.length) {
      var hdr = document.createElement("div");
      hdr.className = "ag-day-head";
      var hs = document.createElement("span");
      hs.className = "ag-day-name";
      hs.textContent = t("stat.byLabel");
      hdr.appendChild(hs);
      body.appendChild(hdr);

      var bars = document.createElement("div");
      bars.id = "stat-bars";
      var max = entries[0].count;
      entries.forEach(function (en) {
        var row = document.createElement("div");
        row.className = "stat-row";
        var nm = document.createElement("span");
        nm.className = "stat-lbl-name";
        var lb = en.id ? labelById(en.id) : null;
        nm.textContent = lb ? lb.name : t("lbl.none");
        var wrap = document.createElement("div");
        wrap.className = "stat-bar-wrap";
        var bar = document.createElement("div");
        bar.className = "stat-bar";
        bar.style.width = Math.max(4, Math.round(en.count / max * 100)) + "%";
        bar.style.background = lb ? lb.color : "var(--text-dim)";
        wrap.appendChild(bar);
        var num = document.createElement("span");
        num.className = "stat-num";
        num.textContent = String(en.count);
        row.appendChild(nm);
        row.appendChild(wrap);
        row.appendChild(num);
        bars.appendChild(row);
      });
      body.appendChild(bars);
    } else {
      var emp = document.createElement("div");
      emp.className = "stat-empty";
      emp.textContent = t("ev.none");
      body.appendChild(emp);
    }

    if (total > 0) {
      var sub = document.createElement("div");
      sub.className = "stat-sub";
      sub.textContent = t("stat.perMonth").replace("{n}", String(total));
      body.appendChild(sub);
    }
    $("stat-dlg").showModal();
  }
  if ($("cal-stats")) {
    $("cal-stats").addEventListener("click", openStats);
  }
  if ($("stat-done")) {
    $("stat-done").addEventListener("click", function () { $("stat-dlg").close(); });
  }
  if ($("stat-dlg")) {
    $("stat-dlg").addEventListener("click", function (ev) {
      if (ev.target === this) this.close();
    });
  }

  /* ---------- 7g. Keyboard navigation (v0.3.0) ----------
     ←/→ = prev/next (view-aware). Esc = clear search (when not in
     a dialog/input). Skipped whenever focus sits in a field — the
     time picker owns its own arrow keys, inputs own theirs. */
  document.addEventListener("keydown", function (e) {
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (document.querySelector("dialog[open]")) return;   // modal open
    if (e.key === "ArrowLeft") { e.preventDefault(); navStep(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); navStep(1); }
    else if (e.key === "Escape" && searchQ) {
      e.preventDefault();
      $("search-in").value = "";
      setSearch("");
    }
  });
  
  /* ---------- 8c. Deep-link consumer (Wave 1B) ----------
     The unified notification system routes "calendar:" payloads
     here (via the shell's __orosOpenCalendar bridge): the app
     navigates to the reminder's day, selects it, and opens the
     event (series → occurrence chooser, plain → edit dialog).
     Payload: { id: eventId, date: "YYYY-MM-DD" }. Stale/unknown
     ids (event deleted meanwhile, or tombstoned by sync) are
     dropped safely — the day selection alone still lands. */
  var CAL_PENDING_KEY = "oros-cal-pending";

  // Wave 6/#C1 — deep-link receiver RENAMED to match the
  // DL_BRIDGE contract (shell sends __orosOpenCalendar(evId, ymd)).
  // The DL_BRIDGE wraps this as a 2-arg call for backward-compat
  // with the shell's generic routing pattern.
  function __orosCalendarOpen(evId, ymd) {
    // CA2: the shell's live path calls __calDeepLink({ id, date }) —
    // an OBJECT payload — while the staged/boot path calls this with
    // two plain args. Normalize both contracts at the door.
    if (evId && typeof evId === "object") {
      ymd = evId.date;
      evId = evId.id;
    }
    if (typeof evId !== "string" || !evId) return;
    if (typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;
    var p = ymd.split("-");
    viewYear = +p[0];
    viewMonth = +p[1] - 1;
    if (curView !== "month") setView("month");
    var si = $("search-in");
    if (si) si.value = "";
    setSearch("");
    selectDay(ymd);

    var ev = null;
    for (var i = 0; i < state.events.length; i++) {
      if (state.events[i].id === evId) { ev = state.events[i]; break; }
    }
    if (!ev) return;   // deleted meanwhile — day selection suffices

    // Paint settle first (mirrors the checkReminders boot sweep
    // timing — dialogs need the paints finished before showModal).
    setTimeout(function () {
      if (validRecur(ev.recur)) showSerChooser(ev, ymd);
      else openDlg(ev);
    }, 60);
  }
  // The shell's live-path contract (verified in shell.js): it calls
  // contentWindow.__calDeepLink({ id, date }) — the object payload
  // normalized inside __orosCalendarOpen. The 2-arg shape stays
  // internal (boot staging + this file's own callers only).
  window.__calDeepLink = __orosCalendarOpen;


  /* ---------- 8. Boot ---------- */
  loadState();
  applyI18n();
  // Re-translate seeded labels if the store was freshly seeded with
  // the other language (seeds depend on LANG at seed time).
  reseedSeedNames();
  tpStart = makeTP("ev-start", "ev-start-menu");
  tpEnd = makeTP("ev-end", "ev-end-menu", { noEnd: true });
  var boot = new Date();
  viewYear = boot.getFullYear();
  viewMonth = boot.getMonth();
  renderChips();
  setView("month");
  selectDay(todayYMD());
  setTimeout(checkReminders, 1500);   // boot sweep (after paints settle)
  // Wave 6/#C1: staged deep link consumption — renamed from
  // deepLink() to __orosCalendarOpen() for DL_BRIDGE parity.
  try {
    var pend = sessionStorage.getItem(CAL_PENDING_KEY);
    if (pend) {
      sessionStorage.removeItem(CAL_PENDING_KEY);
      var pl = JSON.parse(pend);
      if (pl && typeof pl === "object" && pl.id && pl.date) {
        setTimeout(function () {
          __orosCalendarOpen(pl.id, pl.date);
        }, 100);
      }
    }
  } catch (e4) {}

  // Midnight rollover: grid "today", day title and ev-add must
  // follow the real calendar day without a re-open.
  var shownDay = todayYMD();
  setInterval(function () {
    var td = todayYMD();
    if (td === shownDay) return;
    shownDay = td;
    var n = new Date();
    viewYear = n.getFullYear();
    viewMonth = n.getMonth();
    renderAll();
    selectDay(td);
  }, 30000);
  // Immediate rollover check when the tab becomes visible again
  // (battery-friendly — same guard as To-Do audit #20).
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    var td = todayYMD();
    if (td === shownDay) return;
    shownDay = td;
    var n = new Date();
    viewYear = n.getFullYear();
    viewMonth = n.getMonth();
    renderAll();
    selectDay(td);
    checkReminders();   // catch-up sweep on tab-visible
  });
  // Open-tab sweep: covers a standalone foreground tab where neither
  // the shell tick nor visibilitychange ever fires (mobile PWA).
  // Doubling with the shell engine is impossible — the fired-log
  // dedupe key settles who wins.
  setInterval(checkReminders, 30000);
  
  // Wave 1B — start-moment label for emitted reminders (mirrors
  // the shell engine's calRemWhen: "20 Sep · 09:30", locale-aware).
  function remStartLabel(due) {
    var startTs = due.remTs + due.ev.remindMin * 60000;
    var loc = LANG === "el" ? "el-GR" : "en-GB";
    var d = new Date(startTs);
    return d.toLocaleDateString(loc, { day: "2-digit", month: "short" }) +
      " · " + d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
  }

  /* ---------- 8b. In-app reminder check ----------
     Belt-and-braces companion of the shell engine (shell.js 9e2):
     covers the standalone-load case (calendar opened directly,
     no parent shell). DEDUPE: both engines share the device-local
     "oros-cal-reminders-fired" key — whoever fires first wins,
     a reminder can never double-toast. Note: when orOS runs the
     app in its iframe, the shell is always alive, so this path
     is normally quiet. */

  var REM_FIRED_KEY = "oros-cal-reminders-fired";

  function remOccTs(e, occYmd) {
    var p = occYmd.split("-");
    var ts = new Date(+p[0], +p[1] - 1, +p[2], 0, 0, 0).getTime();
    if (e.start && /^\d{2}:\d{2}$/.test(e.start)) {
      ts += (+e.start.slice(0, 2)) * 3600000 + (+e.start.slice(3)) * 60000;
    }
    return ts;
  }

  function checkReminders() {
    var now = Date.now();
    var fired;
    try {
      var f = JSON.parse(localStorage.getItem(REM_FIRED_KEY));
      fired = Array.isArray(f) ? f : [];
    } catch (e2) { fired = []; }

    var due = null;   // earliest due wins — same doctrine as the shell
    // Walk horizon: today + 8 days. Largest preset is 5 days, so no
    // occurrence beyond it can have an open reminder window — and
    // ascending order lets us STOP the walk there (perf + correctness).
    var hz = new Date();
    hz.setDate(hz.getDate() + 8);
    var horizonYmd = ymd(hz.getFullYear(), hz.getMonth(), hz.getDate());
    state.events.forEach(function (e) {
      if (typeof e.remindMin !== "number" || e.remindMin <= 0) return;

      function check(ts, occYmd) {
        if (ts < now) return;                       // already started
        var remTs = ts - e.remindMin * 60000;
        if (remTs > now) return;                    // not due yet
        var remKey = "rem:" + e.id + ":" + occYmd;
        if (fired.indexOf(remKey) !== -1) return;
        if (!due || remTs < due.remTs) {
          due = { remTs: remTs, ev: e, remKey: remKey };
        }
      }

      if (validRecur(e.recur)) {
        eachOccurrence(e, function (occYmd) {
          if (occYmd > horizonYmd) return false;   // STOP: past horizon,
          check(remOccTs(e, occYmd), occYmd);      // nothing due further
        });
      } else {
        // Multi-day spans: the reminder anchors on the FIRST day —
        // the start of the event, per the v0.3 design note.
        check(remOccTs(e, e.date), e.date);
      }
    });

    if (!due) return;
    // Claim BEFORE notifying — whichever engine claims first, the
    // other must stay silent one tick later.
    fired.push(due.remKey);
    try {
      localStorage.setItem(REM_FIRED_KEY,
        JSON.stringify(fired.slice(-500)));
    } catch (e3) {}

    // Wave 1B: inside orOS (parent shell alive) the reminder flows
    // through the unified system — inbox + badge + styled toast +
    // per-app toggle + quiet hours. The emit key is the SAME remKey
    // the shell engine uses, so the inbox-level dedup makes a
    // double-fire impossible no matter which engine wins the race.
    // A null return (calendar notifs off / quiet hours / already in
    // inbox) is a USER DECISION — we never fall back to a local
    // toast, suppression is the point (same contract as shell T3).
    var pNotifs = null;
    try { pNotifs = window.parent && window.parent.orosNotifs; } catch (e4) {}
    if (pNotifs && typeof pNotifs.emit === "function") {
      pNotifs.emit({
        ns: "calendar",
        key: due.remKey,
        type: "reminder",
        title: (due.ev.title || t("ev.untitled")),
        body: remStartLabel(due),
        deepLink: "calendar:" + due.ev.id + ":" + due.remKey.split(":")[2]
      });
    } else {
      // Standalone load / stale shell without the module — the
      // legacy local toast stands alone (a reminder is never lost).
      toast(t("remind.toast") + " · " + (due.ev.title || t("ev.untitled")));
    }
  }

  /* ---------- 9. Sync slice registration ---------- */
  // Same self-registration contract as todo/kanban/notes: the app
  // registers itself, the engine persists the storageKey and builds
  // closed-app proxies on future boots. mergeFn = deterministic
  // entity-union with tombstones, so two devices editing (or
  // deleting!) concurrently converge instead of last-write-wins.
  //
  // LABEL SYNC DESIGN: labels reuse the SAME tombstone list as
  // events ("deleted"). A label delete pushes { id, mtime } there;
  // a label newer than its tombstone survives (rename = resurrect).
  // Benefits: zero schema additions, and feed-app labels (cycle/
  // habits stamping) can never be resurrected by a stale peer.

  // Strict merge-time sanitizers — DROP rows with invalid mtime.
  // Never Date.now() inside merge: non-determinism (Storage #6 precedent).
  function mergeSanitizeEv(e) {
    if (!e || typeof e !== "object") return null;
    if (typeof e.id !== "string" || !e.id) return null;
    if (typeof e.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return null;
    if (typeof e.mtime !== "number" || !isFinite(e.mtime)) return null;
    var start = (typeof e.start === "string" && /^\d{2}:\d{2}$/.test(e.start)) ? e.start : null;
    var end = (typeof e.end === "string" && /^\d{2}:\d{2}$/.test(e.end)) ? e.end : null;
    if (start && end && end < start) end = null;   // deterministic normalization
    // v0.3 multi-day: same contract as sanitizeEvent — plain events
    // only, dateEnd >= date. Identical rule on EVERY device, so the
    // JSON tie-break stays byte-deterministic.
    var dateEnd = null;
    if (typeof e.dateEnd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.dateEnd)) {
      if (!validRecur(e.recur) && e.dateEnd >= e.date) dateEnd = e.dateEnd;
    }
    var labelId = (typeof e.labelId === "string" && e.labelId) ? e.labelId : null;
    var remindMin = (typeof e.remindMin === "number" &&
                     REMIND_PRESETS.indexOf(e.remindMin) !== -1)
      ? e.remindMin : null;
    return {
      id: e.id,
      date: e.date,
      dateEnd: dateEnd,
      start: start,
      end: end,
      title: (typeof e.title === "string" ? e.title : "").slice(0, 80),
      note: (typeof e.note === "string" ? e.note : "").slice(0, 500),
      location: (typeof e.location === "string" ? e.location : "").slice(0, 150),
      labelId: labelId,
      recur: sanitizeRecur(e.recur),
      remindMin: remindMin,
      mtime: e.mtime
    };
  }
  function mergeSanitizeTomb(d) {
    if (!d || typeof d !== "object") return null;
    if (typeof d.id !== "string" || !d.id) return null;
    if (typeof d.mtime !== "number" || !isFinite(d.mtime)) return null;
    return { id: d.id, mtime: d.mtime };
  }
  function mergeSanitizeLabel(l) {
    if (!l || typeof l !== "object") return null;
    if (typeof l.id !== "string" || !l.id) return null;
    if (typeof l.mtime !== "number" || !isFinite(l.mtime)) return null;
    if (VALID_COLORS.indexOf(l.color) === -1) return null;
    return {
      id: l.id,
      name: (typeof l.name === "string" ? l.name : "").slice(0, 40),
      color: l.color,
      mtime: l.mtime
    };
  }

  // Deterministic entity merge: per id, bigger mtime wins; equal
  // mtimes broken by lexicographic JSON (same output on every
  // device regardless of processing order — the engine contract).
  // Tombstones beat events on ties (a delete must not resurrect).
  // A surviving NEWER event cancels its tombstone (resurrection).
  function mergeCalendars(local, remote) {
    var tomb = {};
    function takeTomb(d) {
      if (!tomb[d.id] || d.mtime > tomb[d.id].mtime) tomb[d.id] = d;
    }
    var byId = {};
    function takeEv(e) {
      var cur = byId[e.id];
      if (!cur || e.mtime > cur.mtime ||
          (e.mtime === cur.mtime && JSON.stringify(e) < JSON.stringify(cur))) {
        byId[e.id] = e;
      }
    }
    var lblById = {};
    function takeLbl(l) {
      var cur = lblById[l.id];
      if (!cur || l.mtime > cur.mtime ||
          (l.mtime === cur.mtime && JSON.stringify(l) < JSON.stringify(cur))) {
        lblById[l.id] = l;
      }
    }

    [local, remote].forEach(function (side) {
      if (!side || typeof side !== "object") return;
      (Array.isArray(side.deleted) ? side.deleted : [])
        .map(mergeSanitizeTomb).filter(Boolean).forEach(takeTomb);
      (Array.isArray(side.labels) ? side.labels : [])
        .map(mergeSanitizeLabel).filter(Boolean).forEach(takeLbl);
      (Array.isArray(side.events) ? side.events : [])
        .map(mergeSanitizeEv).filter(Boolean).forEach(takeEv);
    });

    var events = [], deleted = [], labels = [];
    Object.keys(byId).forEach(function (id) {
      var tb = tomb[id];
      if (tb && tb.mtime >= byId[id].mtime) return;   // delete wins (ties included)
      events.push(byId[id]);                           // survived (or resurrected):
      delete tomb[id];                                 // tombstone cancelled
    });
    // Labels obey the same tombstone contract as events: a label
    // dies unless it is NEWER than its tombstone (rename wins).
    Object.keys(lblById).forEach(function (id) {
      var tb = tomb[id];
      if (tb && tb.mtime >= lblById[id].mtime) return;  // label deleted
      labels.push(lblById[id]);                         // survived (or renamed)
      delete tomb[id];
    });
    Object.keys(tomb).forEach(function (id) { deleted.push(tomb[id]); });

    // Sorted by id → identical byte output on every device
    events.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    labels.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    deleted.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    return { ver: 1, labels: labels, events: events, deleted: deleted };
  }

  // Pull-fed setter: validates, adopts, repaints. NEVER markDirty
  // (pull → set → push would loop; the engine owns dirtiness here).
  function setFromSync(data, info) {
    if (!data || typeof data !== "object" || !Array.isArray(data.events)) return;
    var evs = data.events.map(sanitizeEvent).filter(Boolean);
    var dels = (Array.isArray(data.deleted) ? data.deleted : [])
      .map(sanitizeTomb).filter(Boolean);
    var lbls = Array.isArray(data.labels)
      ? data.labels.map(sanitizeLabel).filter(Boolean)
      : defaultLabels();   // παλιό-peer blob χωρίς labels → seed
    state = { ver: 1, labels: lbls, events: evs, deleted: dels };
    lastMoved = null;
    lastDeleted = null;
    lastExdate = null;
    // CA6: seeds follow the ACTIVE language after a live pull —
    // untouched (mtime 0) defaults re-translate; merge-inert, no dirty.
    reseedSeedNames();
    // Audit #7: sync arriving with a half-open dialog would leave
    // editingId pointing at a row that may no longer exist → the
    // next Save would resurrect a stale ghost. Safer: close the
    // dialog (user input is preserved in the fields, re-edit is one
    // click away; silent data surgery mid-edit is worse).
    try {
      if ($("ev-dlg") && $("ev-dlg").open) {
        editingId = null;
        dlgMode = null;
        pendingOverride = null;
        $("ev-dlg").close();
      }
    } catch (e2) {}
    try { localStorage.setItem(DATA_KEY, JSON.stringify(state)); } catch (e) {}
    renderAll();
    renderDay();          // selDate-aware (guarded when null)
    if (info && info.merged) toast(t("sync.merged"));   // receipt, not "Saved"
  }

  // Canonical dirty funnel (Part VII) — created BEFORE registration,
  // even when sync is absent (dirty becomes a safe no-op).
  var syncApi = (window.parent && window.parent.orosSync) || window.orosSync;
  window.__orosSyncApi = {
    dirty: function () {
      if (syncApi && typeof syncApi.markDirty === "function") syncApi.markDirty();
    }
  };

  try {
    if (syncApi && typeof syncApi.registerSlice === "function") {
      syncApi.registerSlice(
        "calendar",
        function () {     // getter: localStorage is the durable truth
          try {
            return JSON.parse(localStorage.getItem(DATA_KEY)) ||
              { ver: 1, labels: [], events: [], deleted: [] };
          } catch (e) {
            return { ver: 1, labels: [], events: [], deleted: [] };
          }
        },
        setFromSync,
        DATA_KEY,          // persisted → closed-app proxies on next boots
        mergeCalendars
      );
    }
  } catch (e) {
    // Standalone load = normal. A real registration crash = loudly
    // visible in the console instead of a silently dead sync.
    console.warn("[Calendar] sync registration failed:", e);
  }
})();