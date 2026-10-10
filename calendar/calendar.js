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
      "cal.maps": "Show on map",
      "ev.err.time": "End time must be after start time",
      "ev.err.dateend": "End date must be on or after the start date",
      "ev.spanHint": "Multi-day event: {b} days total. Saving here moves the start to the selected day.",
      "ev.del.yes": "Delete",
      "del.done": "Event deleted",
      "undo": "Undo",
      "toast.quota": "Storage is full: changes are not saved on this device",
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
      "lbl.feed.todo": "To-Do",
      "lbl.feed.fitness": "Workouts",
      "feed.cycle.period": "Period",
      "feed.mood.entry": "Mood entry",
      "lbl.feed.pet": "Screen Pet",
      "lbl.feed.plants": "Plants",
      "lbl.feed.chores": "Chores",
      "lbl.feed.garage": "Garage",
      "lbl.feed.travel": "Travel",
      "feed.travel.day": "{name} · day {n}/{of}",
      "lbl.feed.meals": "Meals",
      "feed.meals.b": "Breakfast", "feed.meals.l": "Lunch", "feed.meals.d": "Dinner", "feed.meals.s": "Snack", "feed.meals.x": "Extra",
      "lbl.feed.budget": "Budget",
      "feed.garage.exp": "{vehicle}: {what} expires",
      "feed.garage.expired": "{vehicle}: {what} expired",
      "feed.garage.svc": "{vehicle}: {what} due",
      "feed.garage.kteo": "KTEO", "feed.garage.ins": "insurance", "feed.garage.tax": "road tax",
      "feed.garage.kek": "emissions card", "feed.garage.road": "roadside assistance",
      "feed.garage.lic": "driving licence", "feed.garage.other": "renewal", "feed.garage.service": "service",
      "feed.plants.done": "{name}: {kind} done",
      "feed.plants.due": "{name}: {kind} due",
      "feed.plants.water": "watering", "feed.plants.fert": "fertilizing", "feed.plants.mist": "misting", "feed.plants.repot": "repotting",
      "lbl.feed.petcare": "Pet health",
      "lbl.feed.baby": "Baby",
      "feed.pc.due": "{name}: {what} due", "feed.pc.done": "{name}: {what}", "feed.pc.bday": "🎂 {name} turns {n}",
      "feed.pc.deworm": "deworming", "feed.pc.visit": "vet visit", "feed.pc.recheck": "recheck",
      "feed.pc.medDue": "{name}: last day of {what}", "feed.pc.food": "food runs out",
      "feed.pc.care.bath": "bath", "feed.pc.care.nails": "nail trim", "feed.pc.care.brush": "brushing",
      "feed.pc.care.teeth": "teeth", "feed.pc.care.ears": "ear cleaning", "feed.pc.care.litter": "litter change",
      "feed.pc.care.cage": "cage cleaning", "feed.pc.care.tank": "tank water change",
      "feed.pet.feed": "{name} was fed",
      "feed.pet.pet": "{name} was petted",
      "feed.pet.sleep": "{name} went to sleep",
      "feed.pet.wake": "{name} woke up",
      "feed.pet.newpet": "{name} joined the family",
      "feed.pet.catch": "{name} caught the ball",
      "feed.pet.bday": "{name}'s birthday",
      "lbl.feed.custom": "Custom Feed",
      "lbl.feed.hol": "Holidays",
      "lbl.feed.nameday": "Name days",
      "lbl.feed.obs": "World days",
      "lbl.feed.time": "Work time",
      "lbl.feed.famtree": "Death anniversaries",
      "feed.famtree.one": "{name} · 1 year since death",
      "feed.famtree.n": "{name} · {n} years since death",
      "feed.time.noproj": "No project",
      "nd.line": "Name days:",
      "nd.contact": "{name}: name day",
      "nd.more": "+{n} more",
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
      "cal.maps": "Εμφάνιση στον χάρτη",
      "ev.err.time": "Η ώρα λήξης πρέπει να είναι μετά την έναρξη",
      "ev.err.dateend": "Η ημερομηνία λήξης πρέπει να είναι ίδια ή μετά την έναρξη",
      "ev.spanHint": "Πολυήμερο συμβάν: {b} μέρες συνολικά. Η αποθήκευση εδώ μεταφέρει την έναρξη στην επιλεγμένη μέρα.",
      "ev.del.yes": "Διαγραφή",
      "del.done": "Το συμβάν διαγράφηκε",
      "undo": "Αναίρεση",
      "toast.quota": "Ο χώρος αποθήκευσης γέμισε: οι αλλαγές δεν αποθηκεύονται σε αυτή τη συσκευή",
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
      "lbl.feed.todo": "Εργασίες",
      "lbl.feed.fitness": "Προπόνηση",
      "feed.cycle.period": "Περίοδος",
      "feed.mood.entry": "Καταγραφή διάθεσης",
      "lbl.feed.pet": "Screen Pet",
      "lbl.feed.plants": "Φυτά",
      "lbl.feed.chores": "Δουλειές",
      "lbl.feed.garage": "Γκαράζ",
      "lbl.feed.travel": "Ταξίδια",
      "feed.travel.day": "{name} · μέρα {n}/{of}",
      "lbl.feed.meals": "Γεύματα",
      "feed.meals.b": "Πρωινό", "feed.meals.l": "Μεσημεριανό", "feed.meals.d": "Βραδινό", "feed.meals.s": "Σνακ", "feed.meals.x": "Άλλο",
      "lbl.feed.budget": "Προϋπολογισμός",
      "feed.garage.exp": "{vehicle}: λήγει {what}",
      "feed.garage.expired": "{vehicle}: έληξε {what}",
      "feed.garage.svc": "{vehicle}: σέρβις ({what})",
      "feed.garage.kteo": "ΚΤΕΟ", "feed.garage.ins": "ασφάλεια", "feed.garage.tax": "τέλη κυκλοφορίας",
      "feed.garage.kek": "κάρτα καυσαερίων", "feed.garage.road": "οδική βοήθεια",
      "feed.garage.lic": "δίπλωμα οδήγησης", "feed.garage.other": "ανανέωση", "feed.garage.service": "σέρβις",
      "feed.plants.done": "{name}: έγινε {kind}",
      "feed.plants.due": "{name}: ώρα για {kind}",
      "feed.plants.water": "πότισμα", "feed.plants.fert": "λίπανση", "feed.plants.mist": "ψέκασμα", "feed.plants.repot": "μεταφύτευση",
      "lbl.feed.petcare": "Υγεία ζώων",
      "lbl.feed.baby": "Μωρό",
      "feed.pc.due": "{name}: ώρα για {what}", "feed.pc.done": "{name}: {what}", "feed.pc.bday": "🎂 {name}: γενέθλια ({n})",
      "feed.pc.deworm": "αποπαρασίτωση", "feed.pc.visit": "επίσκεψη στον κτηνίατρο", "feed.pc.recheck": "επανεξέταση",
      "feed.pc.medDue": "{name}: τελευταία μέρα για {what}", "feed.pc.food": "νέο σακί τροφής",
      "feed.pc.care.bath": "μπάνιο", "feed.pc.care.nails": "κόψιμο νυχιών", "feed.pc.care.brush": "βούρτσισμα",
      "feed.pc.care.teeth": "δόντια", "feed.pc.care.ears": "καθάρισμα αυτιών", "feed.pc.care.litter": "αλλαγή άμμου",
      "feed.pc.care.cage": "καθάρισμα κλουβιού", "feed.pc.care.tank": "αλλαγή νερού ενυδρείου",
      "feed.pet.feed": "{name} ταΐστηκε",
      "feed.pet.pet": "{name} χαϊδεύτηκε",
      "feed.pet.sleep": "{name} πήγε για ύπνο",
      "feed.pet.wake": "{name} ξύπνησε",
      "feed.pet.newpet": "{name} ήρθε στην οικογένεια",
      "feed.pet.catch": "{name} έπιασε την μπάλα",
      "feed.pet.bday": "Γενέθλια του/της {name}",
      "lbl.feed.custom": "Προσαρμοσμένο Feed",
      "lbl.feed.hol": "Αργίες",
      "lbl.feed.nameday": "Ονομαστικές εορτές",
      "lbl.feed.obs": "Παγκόσμιες ημέρες",
      "lbl.feed.time": "Ώρες εργασίας",
      "lbl.feed.famtree": "Επέτειοι θανάτου",
      "feed.famtree.one": "{name} · 1 χρόνος από τον θάνατο",
      "feed.famtree.n": "{name} · {n} χρόνια από τον θάνατο",
      "feed.time.noproj": "Χωρίς έργο",
      "nd.line": "Γιορτάζουν:",
      "nd.contact": "Γιορτάζει: {name}",
      "nd.more": "+{n} ακόμη",
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
    // CA-13: ένα toast με Undo μένει ≥8s (κανόνας orOS)
    toastTimer = setTimeout(hideToast, actionLabel ? 8000 : 5000);
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
  var RESCUE_KEY = "oros-calendar-data-broken";   // CA-12: αντίγραφο μη αναγνώσιμων δεδομένων
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
    { id: "lbl-feed-todo",    color: "#e06c75" },   // red — To-Do due dates
    { id: "lbl-feed-fitness", color: "#f28c5a" },   // orange — finished workouts
    { id: "lbl-feed-pet",    color: "#b39ddb" },   // light purple — Screen Pet (distinct from Mood #a78bfa)
    { id: "lbl-feed-plants", color: "#8bc34a" },   // leaf green — Plant Care (distinct from Birthdays #9ece6a)
    { id: "lbl-feed-chores", color: "#c678dd" },   // magenta — Chore Wheel (distinct from Mood #a78bfa)
    { id: "lbl-feed-petcare", color: "#e0af68" },  // amber — Pet Health Book (real pets; Screen Pet is lbl-feed-pet)
    { id: "lbl-feed-garage", color: "#ecc75f" },   // amber — Garage renewals + service
    { id: "lbl-feed-travel", color: "#2bb3a3" },   // sea green — Travel trips + timed itinerary
    { id: "lbl-feed-meals",  color: "#ff9e64" },   // orange — Meal Planner plan
    { id: "lbl-feed-budget", color: "#2bb673" },   // emerald — Budget recurring entries (distinct from the lime greens)
    { id: "lbl-feed-baby",   color: "#f4a3c8" },   // soft pink — Baby milestones, health, monthly age
    { id: "lbl-feed-custom", color: "#c8a96e" },    // brown — Contacts custom event types
    { id: "lbl-feed-hol",     color: "#ef6b5b" },   // coral red — Greek public holidays
    { id: "lbl-feed-nameday", color: "#ffb74d" },   // amber — contacts who have a name day
    { id: "lbl-feed-obs",     color: "#64b5f6" },   // sky blue — world / internet days
    { id: "lbl-feed-time",    color: "#56b6c2" },   // cyan — Timesheet work time per project
    { id: "lbl-feed-famtree", color: "#9aa4b0" }    // slate grey — Family Tree death anniversaries
  ];
  function feedLabelName(l) {
    if (l.id === "lbl-feed-bday") return t("lbl.feed.bday");
    if (l.id === "lbl-feed-anniv") return t("lbl.feed.anniv");
    if (l.id === "lbl-feed-cycle") return t("lbl.feed.cycle");
    if (l.id === "lbl-feed-mood") return t("lbl.feed.mood");
    if (l.id === "lbl-feed-habits") return t("lbl.feed.habits");
    if (l.id === "lbl-feed-kanban") return t("lbl.feed.kanban");
    if (l.id === "lbl-feed-pet") return t("lbl.feed.pet");
    if (l.id === "lbl-feed-todo") return t("lbl.feed.todo");
    if (l.id === "lbl-feed-plants") return t("lbl.feed.plants");
    if (l.id === "lbl-feed-chores") return t("lbl.feed.chores");
    if (l.id === "lbl-feed-petcare") return t("lbl.feed.petcare");
    if (l.id === "lbl-feed-garage") return t("lbl.feed.garage");
    if (l.id === "lbl-feed-travel") return t("lbl.feed.travel");
    if (l.id === "lbl-feed-meals") return t("lbl.feed.meals");
    if (l.id === "lbl-feed-budget") return t("lbl.feed.budget");
    if (l.id === "lbl-feed-baby") return t("lbl.feed.baby");
    if (l.id === "lbl-feed-fitness") return t("lbl.feed.fitness");
    if (l.id === "lbl-feed-hol") return t("lbl.feed.hol");
    if (l.id === "lbl-feed-nameday") return t("lbl.feed.nameday");
    if (l.id === "lbl-feed-obs") return t("lbl.feed.obs");
    if (l.id === "lbl-feed-time") return t("lbl.feed.time");
    if (l.id === "lbl-feed-famtree") return t("lbl.feed.famtree");
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

  // CA-7: untouched seeds (mtime 0) are STORED with one canonical
  // (English) name on every device and translated only on screen
  // (lblName). Before, each device wrote its own language at mtime 0:
  // the EN and EL blobs never matched, and every pull on the EL
  // device re-ran the setter (dialog closed, Undo lost, toast).
  var SEED_NAMES = {
    "lbl-personal": ["Personal", "lbl.personal"],
    "lbl-work":     ["Work",     "lbl.work"],
    "lbl-family":   ["Family",   "lbl.family"]
  };
  function canonSeedName(l) {
    if (l && l.mtime === 0 && SEED_NAMES[l.id]) l.name = SEED_NAMES[l.id][0];
    return l;
  }
  function lblName(l) {
    if (l && l.mtime === 0 && SEED_NAMES[l.id]) return t(SEED_NAMES[l.id][1]);
    return l ? l.name : "";
  }
  // A seed the user edits keeps the name it SHOWED (Greek on an EL
  // device), not the canonical English one.
  function stampLabel(l) {
    if (l.mtime === 0 && SEED_NAMES[l.id]) l.name = lblName(l);
    l.mtime = Date.now();
  }
  function reseedSeedNames() {
    state.labels.forEach(canonSeedName);
  }

  function sanitizeLabel(l) {
    if (!l || typeof l !== "object") return null;
    if (typeof l.id !== "string" || !l.id) return null;
    // CA4: single palette source (VALID_COLORS = LABEL_PALETTE + brown)
    if (VALID_COLORS.indexOf(l.color) === -1) return null;
    return canonSeedName({
      id: l.id,
      name: (typeof l.name === "string" ? l.name : "").slice(0, 40),
      color: l.color,
      mtime: (typeof l.mtime === "number" && isFinite(l.mtime)) ? l.mtime : 0
    });
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
    var raw = null;
    try { raw = localStorage.getItem(DATA_KEY); } catch (e0) { raw = null; }
    try {
      var d = JSON.parse(raw);
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
        // (CA-7: the write itself is writeStore() at the end.)
      }
    } catch (e) {
      // CA-12: unreadable blob → keep a copy before anything
      // overwrites it (the first save would otherwise destroy it).
      if (raw) { try { localStorage.setItem(RESCUE_KEY, raw); } catch (e3) {} }
      if (!state.labels.length) state.labels = defaultLabels();
    }
    writeStore();
  }

  // CA-7: the disk holds exactly what the getter hands to sync —
  // the merge's canonical form (sorted by id, sanitized, canonical
  // seed names). The closed-app proxy then reads the same bytes.
  var quotaWarned = false;
  function writeStore() {
    try {
      localStorage.setItem(DATA_KEY, JSON.stringify(mergeCalendars(state, null)));
      quotaWarned = false;
    } catch (e) {
      // R30: one message per failure streak, never silence.
      if (!quotaWarned) { quotaWarned = true; transientNote(t("toast.quota")); }
    }
  }
  function saveState() {
    writeStore();
    markDirty();
  }

  // Shell sync bridge — canonical __orosSyncApi funnel (Part VII).
  function markDirty() {
    try {
      if (window.__orosSyncApi) window.__orosSyncApi.dirty();
    } catch (e) {}
  }

  // orosDialog lives in the parent shell (same-origin iframe).
  // Standalone PWA mode -> null -> caller uses local fallback.
  function dialogHost() {
    try {
      return window.orosDialog || window.parent.orosDialog || null;
    } catch (e) { return null; }
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

  // Wave — To-Do read-only feed. Reads "oros-todo-data" (written
  // by todo.js, same-origin shared localStorage) and surfaces
  // every UNCOMPLETED task whose due date lands on the cell as an
  // all-day red row. Completed tasks are skipped — a due date
  // already taken care of is not calendar noise. Feed rows are
  // never stored, synced or exported; micro-cached ~1s like the
  // other feeds. Corrupt/absent blob simply yields no rows —
  // standalone Calendar unaffected.
  var TODO_DATA_KEY = "oros-todo-data";
  var todoCache = { when: 0, data: null };

  function todoRaw() {
    var now = Date.now();
    if (now - todoCache.when > 1000) {
      try {
        var d = JSON.parse(localStorage.getItem(TODO_DATA_KEY));
        todoCache.data = (d && typeof d === "object" &&
                          Array.isArray(d.lists)) ? d : null;
      } catch (e) { todoCache.data = null; }
      todoCache.when = now;
    }
    return todoCache.data;
  }

  function todoFeedOn(dateStr) {
    var data = todoRaw();
    if (!data) return [];
    if (!labelVisible("lbl-feed-todo")) return [];

    var out = [];
    (data.lists || []).forEach(function (list) {
      (Array.isArray(list.items) ? list.items : []).forEach(function (item) {
        if (!item || item.done || item.due !== dateStr) return;
        out.push({
          id: "tdo-" + item.id + "-" + dateStr,   // per-render key, never stored
          title: (item.text || "").slice(0, 60),
          labelId: "lbl-feed-todo",
          start: null,                           // all-day
          note: (item.notes || "").slice(0, 500),
          _feed: true,
          _todo: { listId: list.id, itemId: item.id }
        });
      });
    });
    return out;
  }

  // Workouts read-only feed. Reads "oros-fitness-data" (written by
  // fitness.js) and surfaces every FINISHED workout as an all-day row
  // on its day: "Push · 18:30 · 52′". A running workout (en = 0) is
  // left out. Feed rows are never stored, synced or exported;
  // micro-cached ~1s like the other feeds. Corrupt/absent data
  // yields no rows.
  var FIT_DATA_KEY = "oros-fitness-data";
  var fitCache = { when: 0, data: null };

  function fitRaw() {
    var now = Date.now();
    if (now - fitCache.when > 1000) {
      try {
        var d = JSON.parse(localStorage.getItem(FIT_DATA_KEY));
        fitCache.data = (d && typeof d === "object" && Array.isArray(d.wo)) ? d : null;
      } catch (e) { fitCache.data = null; }
      fitCache.when = now;
    }
    return fitCache.data;
  }

  function fitnessFeedOn(dateStr) {
    var data = fitRaw();
    if (!data) return [];
    if (!labelVisible("lbl-feed-fitness")) return [];
    var out = [];
    data.wo.forEach(function (w) {
      if (!w || w.d !== dateStr || typeof w.id !== "string" ||
          !(typeof w.en === "number" && w.en > 0) || typeof w.st !== "number") return;
      var st = new Date(w.st), mins = Math.max(0, Math.round((w.en - w.st) / 60000));
      var hhmm = (st.getHours() < 10 ? "0" : "") + st.getHours() + ":" +
                 (st.getMinutes() < 10 ? "0" : "") + st.getMinutes();
      var title = (typeof w.ti === "string" && w.ti) ? w.ti : t("lbl.feed.fitness");
      out.push({
        id: "fit-" + w.id,                       // per-render key, never stored
        title: (title.slice(0, 40) + " · " + hhmm + " · " + mins + "′"),
        labelId: "lbl-feed-fitness",
        start: null,                             // all-day
        note: (typeof w.n === "string" ? w.n : "").slice(0, 500),
        _feed: true,
        _fitnessId: w.id
      });
    });
    return out;
  }

  // Timesheet read-only feed (Timesheet Wave 4). Reads
  // "oros-timesheet-data" with timesheet/core.js (the SAME file the
  // app runs; index.html loads it) and shows one all-day row per
  // project per day: "Website · 2:15" (▶ while its timer runs).
  // Exact times, no rounding; an entry across midnight counts on
  // each day. The chip's on/off state is remembered on this device
  // (STICKY_FEEDS). Click → Timesheet on that day. Never stored,
  // synced or exported; parsed at most once a second.
  var TS_DATA_KEY = "oros-timesheet-data";
  var tsCache = { when: 0, raw: null, data: null };
  function tsData() {
    var C = window.orosTimesheetCore;
    if (!C) return null;
    var now = Date.now();
    if (now - tsCache.when > 1000) {
      tsCache.when = now;
      var raw = null;
      try { raw = localStorage.getItem(TS_DATA_KEY); } catch (e) { raw = null; }
      if (raw !== tsCache.raw) {
        tsCache.raw = raw;
        tsCache.data = raw ? C.parse(raw) : null;
      }
    }
    return tsCache.data;
  }
  function timesheetFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-time")) return [];
    var data = tsData();
    if (!data || !data.entries.length) return [];
    var C = window.orosTimesheetCore;
    return C.dayFeed(data, dateStr, Date.now()).filter(function (r) {
      return r.ms >= 60000;                    // under a minute: not worth a row
    }).map(function (r) {
      var name = r.name || t("feed.time.noproj");
      return {
        id: "ts-" + dateStr + "-" + (r.pid || "none"),   // per-render key, never stored
        title: (r.running ? "▶ " : "") + name.slice(0, 40) + " · " + C.fmtDur(r.ms),
        labelId: "lbl-feed-time",
        start: null,                             // all-day
        note: r.notes.join(" · ").slice(0, 500),
        _feed: true,
        _openAt: { app: "timesheet", target: { day: dateStr } }
      };
    });
  }

  // Family Tree read-only feed (familytree/ft-core.js, loaded by
  // index.html): every year on the day of an exact death date (29 Feb
  // also on 28 Feb of common years), "Name · N years since death".
  // The day index is rebuilt only when the stored blob changes.
  // Click → Family Tree centred on the person (generic deep link).
  var FT_DATA_KEY = "oros-familytree-data";
  var ftCache = { when: 0, raw: null, idx: null };
  function ftIndex() {
    var F = window.FTCore;
    if (!F) return null;
    var now = Date.now();
    if (now - ftCache.when > 1000) {
      ftCache.when = now;
      var raw = null;
      try { raw = localStorage.getItem(FT_DATA_KEY); } catch (e) { raw = null; }
      if (raw !== ftCache.raw) {
        ftCache.raw = raw;
        ftCache.idx = null;
        try { if (raw) ftCache.idx = F.deathDays(JSON.parse(raw)); } catch (e) { ftCache.idx = null; }
      }
    }
    return ftCache.idx;
  }
  function familyTreeFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-famtree")) return [];
    var idx = ftIndex();
    if (!idx) return [];
    return window.FTCore.deathAnniversaries(idx, dateStr).map(function (r) {
      return {
        id: "ft-" + dateStr + "-" + r.pid,       // per-render key, never stored
        title: t(r.years === 1 ? "feed.famtree.one" : "feed.famtree.n")
                 .replace("{name}", r.name.slice(0, 60)).replace("{n}", String(r.years)),
        labelId: "lbl-feed-famtree",
        start: null,                             // all-day
        _feed: true,
        _openAt: { app: "familytree", target: { person: r.pid } }
      };
    });
  }

  // Wave 5 — Screen Pet read-only feed (pet.js v0.3). Two sources:
  //   1. "oros-pet-data" (SYNCED identity) → birthday row on every
  //      local-day anniversary of birthTs (birth day excluded) —
  //      every device agrees on the day, even with an empty log.
  //   2. "oros-pet-events" (DEVICE-LOCAL rolling log) → care rows
  //      (fed/petted/sleep/wake/new pet/catch) on their day.
  // Opt-out: "oros-pet-calendar-sync" === "0" (device-local, shell
  // toggle). Feed rows are never stored, synced or exported;
  // micro-cached ~1s like the other feeds. Corrupt/absent blobs
  // simply yield no rows — standalone load is unaffected.
  var PET_DATA_KEY   = "oros-pet-data";
  var PET_LOG_KEY    = "oros-pet-events";
  var PET_OPTOUT_KEY = "oros-pet-calendar-sync";
  var petCache = { when: 0, optOut: false, petData: null, logData: null };

  function petRaw() {
    var now = Date.now();
    if (now - petCache.when > 1000) {
      try {
        petCache.optOut = localStorage.getItem(PET_OPTOUT_KEY) === "0";
        petCache.petData = JSON.parse(localStorage.getItem(PET_DATA_KEY)) || null;
        petCache.logData = JSON.parse(localStorage.getItem(PET_LOG_KEY)) || null;
      } catch (e) {
        petCache.petData = null;
        petCache.logData = null;
      }
      petCache.when = now;
    }
    return petCache;
  }

  // Log type → i18n title key. "birthday" log entries are skipped:
  // the computed birthTs row above is the richer source and the
  // two must never double up on the same cell.
  var PET_TITLE_KEYS = {
    feed:   "feed.pet.feed",
    pet:    "feed.pet.pet",
    sleep:  "feed.pet.sleep",
    wake:   "feed.pet.wake",
    newpet: "feed.pet.newpet",
    catch:  "feed.pet.catch"
  };

  function petFeedOn(dateStr) {
    var c = petRaw();
    if (c.optOut) return [];
    if (!labelVisible("lbl-feed-pet")) return [];

    var out = [];
    var pet = (c.petData && c.petData.pet &&
               typeof c.petData.pet === "object") ? c.petData.pet : null;

    // 1. Birthday — computed from the synced birthTs
    if (pet && typeof pet.birthTs === "number" && isFinite(pet.birthTs)) {
      var b = new Date(pet.birthTs);
      var pd = dateStr.split("-");
      var cell = new Date(+pd[0], +pd[1] - 1, +pd[2]);
      if (!isNaN(cell.getTime()) && cell.getMonth() === b.getMonth() &&
          cell.getDate() === b.getDate() &&
          cell.getFullYear() > b.getFullYear()) {
        out.push({
          id: "pet-bday-" + dateStr,        // per-render key, never stored
          title: t("feed.pet.bday")
            .replace("{name}", String(pet.name || "?")),
          labelId: "lbl-feed-pet",
          start: null,                      // all-day
          _feed: true,
          _petOpen: true
        });
      }
    }

    // 2. Care events from the device-local log (local YMD match —
    // same convention as the Mood feed's tsToLocalYmd)
    var events = (c.logData && Array.isArray(c.logData.events))
      ? c.logData.events : [];
    events.forEach(function (ev) {
      if (!ev || typeof ev.ts !== "number" || !isFinite(ev.ts)) return;
      var key = PET_TITLE_KEYS[String(ev.type)];
      if (key === undefined) return;
      if (tsToLocalYmd(ev.ts) !== dateStr) return;
      out.push({
        id: "pet-" + ev.id + "-" + dateStr, // per-render key, never stored
        title: t(key)
          .replace("{name}", String(ev.name || (pet && pet.name) || "?")),
        labelId: "lbl-feed-pet",
        start: null,                        // all-day
        _feed: true,
        _petOpen: true,
        _petEvId: String(ev.id)
      });
    });
    return out;
  }

  // Chore Wheel read-only feed (chores/core.js, loaded by index.html:
  // the same who-does-what as the app and the shell reminder). Each
  // chore shows on the day its period starts (a weekly one on its
  // Monday, a monthly one on the 1st), ✓ when done. With "who are you
  // on this device" set in the app, only your own chores; otherwise
  // everyone's, with the name. Only ±60 days around today. Rows are
  // never stored; micro-cached ~1s like the other feeds.
  var CHORES_DATA_KEY = "oros-chores-data";
  var choresCache = { when: 0, data: null, me: "", today: 0 };

  function choresRaw() {
    var now = Date.now();
    var Core = window.OrosChoresCore;
    if (!Core) return null;
    if (now - choresCache.when > 1000) {
      choresCache.data = null;
      try {
        var d = JSON.parse(localStorage.getItem(CHORES_DATA_KEY));
        if (d && typeof d === "object" && Array.isArray(d.tasks) && d.tasks.length) {
          choresCache.data = Core.mergeChores(d, d, now);
          choresCache.me = Core.readPrefs(JSON.parse(localStorage.getItem("oros-chores-prefs"))).me;
          choresCache.today = Core.localDn(new Date(now));
        }
      } catch (e) { choresCache.data = null; }
      choresCache.when = now;
    }
    return choresCache.data ? choresCache : null;
  }

  function choresFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-chores")) return [];
    var c = choresRaw();
    if (!c) return [];
    var Core = window.OrosChoresCore, n = Core.ymdToDn(dateStr);
    if (isNaN(n) || Math.abs(n - c.today) > 60) return [];
    var mine = !!(c.me && Core.memberById(c.data, c.me));
    return Core.feedRows(c.data, n, c.me).map(function (r) {
      var title = (r.state === 1 ? "✓ " : "") + (r.task.icon ? r.task.icon + " " : "") + r.task.name;
      if (!mine && r.name) title += " · " + r.name;
      return {
        id: "chr-" + r.key,                     // per-render key, never stored
        title: title.slice(0, 80),
        labelId: "lbl-feed-chores",
        start: null,                            // all-day
        _feed: true,
        _choresDay: dateStr
      };
    });
  }

  // Plant Care read-only feed (plants/core.js, loaded by index.html:
  // the same schedule math as the app and the shell reminder).
  // Past days and today: what was done (skips are not shown).
  // Today: every task due or late. Future days: only each task's
  // NEXT due day, never a projection months ahead. Rows are never
  // stored; micro-cached ~1s like the other feeds.
  var PLANTS_DATA_KEY = "oros-plants-data";
  var plantsCache = { when: 0, data: null, today: "", due: null };

  function plantsRaw() {
    var now = Date.now();
    var Core = window.OrosPlantsCore;
    if (!Core) return null;
    if (now - plantsCache.when > 1000) {
      plantsCache.data = null;
      plantsCache.due = null;
      try {
        var d = JSON.parse(localStorage.getItem(PLANTS_DATA_KEY));
        if (d && typeof d === "object" && Array.isArray(d.plants)) {
          plantsCache.data = Core.merge(d, d, now);
          var prefs = Core.readPrefs(JSON.parse(localStorage.getItem("oros-plants-prefs")));
          plantsCache.today = Core.ymdOf(new Date(now));
          plantsCache.due = Core.tasks(plantsCache.data, plantsCache.today, 400, prefs.hemi);
        }
      } catch (e) { plantsCache.data = null; plantsCache.due = null; }
      plantsCache.when = now;
    }
    return plantsCache.data ? plantsCache : null;
  }

  function plantsFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-plants")) return [];
    var c = plantsRaw();
    if (!c) return [];
    var names = {};
    c.data.plants.forEach(function (p) { names[p.id] = p.name; });
    var out = [];
    if (dateStr <= c.today) {
      c.data.log.forEach(function (e) {
        if (e.d !== dateStr || e.s || !names[e.p]) return;
        out.push({
          id: "plt-" + e.id,                    // per-render key, never stored
          title: t("feed.plants.done").replace("{name}", names[e.p])
                   .replace("{kind}", t("feed.plants." + e.k)),
          labelId: "lbl-feed-plants",
          start: null,                          // all-day
          _feed: true,
          _plantId: e.p
        });
      });
    }
    if (dateStr >= c.today) {
      c.due.forEach(function (tk) {
        if (dateStr === c.today ? tk.due > dateStr : tk.due !== dateStr) return;
        out.push({
          id: "plt-" + tk.key + "-" + dateStr,  // per-render key, never stored
          title: t("feed.plants.due").replace("{name}", tk.plant.name)
                   .replace("{kind}", t("feed.plants." + tk.kind)),
          labelId: "lbl-feed-plants",
          start: null,
          _feed: true,
          _plantId: tk.plant.id
        });
      });
    }
    return out;
  }

  // Pet Health Book read-only feed (petcare/core.js, loaded by
  // index.html: the same "what is due" math as the app and the shell
  // reminder). Past days and today: vaccines, deworming and vet
  // visits that happened. Today: everything due or late. Future
  // days: only each item's NEXT due day. Birthdays every year (full
  // birth dates only). Pets that are gone show their history, no
  // due dates. Rows are never stored; micro-cached ~1s.
  var PETCARE_DATA_KEY = "oros-petcare-data";
  var petcareCache = { when: 0, data: null, today: "", due: null };

  function petcareRaw() {
    var now = Date.now();
    var Core = window.OrosPetcareCore;
    if (!Core) return null;
    if (now - petcareCache.when > 1000) {
      petcareCache.data = null;
      petcareCache.due = null;
      try {
        var d = JSON.parse(localStorage.getItem(PETCARE_DATA_KEY));
        if (d && typeof d === "object" && Array.isArray(d.pets)) {
          petcareCache.data = Core.merge(d, d, now);
          petcareCache.today = Core.ymdOf(new Date(now));
          petcareCache.due = Core.items(petcareCache.data, petcareCache.today);
        }
      } catch (e) { petcareCache.data = null; petcareCache.due = null; }
      petcareCache.when = now;
    }
    return petcareCache.data ? petcareCache : null;
  }

  function petcareWhat(kind, sub, label) {
    if (kind === "vacc") return label;
    if (kind === "deworm") return t("feed.pc.deworm") + (label ? " (" + label + ")" : "");
    if (kind === "visit") return label || t("feed.pc.visit");
    if (kind === "recheck") return t("feed.pc.recheck") + (label ? " (" + label + ")" : "");
    if (kind === "care") return t("feed.pc.care." + sub);
    return t("feed.pc.food");
  }

  function petcareFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-petcare")) return [];
    var c = petcareRaw();
    if (!c) return [];
    var Core = window.OrosPetcareCore;
    var names = {}, out = [];
    function row(id, title, petId) {
      out.push({
        id: "pcf-" + id,                        // per-render key, never stored
        title: title,
        labelId: "lbl-feed-petcare",
        start: null,                            // all-day
        _feed: true,
        _petcareId: petId
      });
    }
    c.data.pets.forEach(function (p) {
      names[p.id] = p.name;
      var n = p.gone ? 0 : Core.birthdayOn(p, dateStr);
      if (n) row("bd-" + p.id + "-" + dateStr, t("feed.pc.bday").replace("{name}", p.name).replace("{n}", n), p.id);
    });
    if (dateStr <= c.today) {
      c.data.recs.forEach(function (r) {
        if (r.d !== dateStr || !names[r.p] ||
            (r.k !== "vacc" && r.k !== "deworm" && r.k !== "visit")) return;
        row(r.id, t("feed.pc.done").replace("{name}", names[r.p])
                     .replace("{what}", petcareWhat(r.k, "", r.n)), r.p);
      });
    }
    if (dateStr >= c.today) {
      c.due.forEach(function (it) {
        if (dateStr === c.today ? it.due > dateStr : it.due !== dateStr) return;
        var title = it.kind === "med"
          ? t("feed.pc.medDue").replace("{name}", it.pet.name).replace("{what}", it.label)
          : t("feed.pc.due").replace("{name}", it.pet.name)
              .replace("{what}", petcareWhat(it.kind === "visit" ? "recheck" : it.kind, it.sub, it.label));
        row(it.key + "-" + dateStr, title, it.pet.id);
      });
    }
    return out;
  }

  // Baby read-only feed (baby/core.js, loaded by index.html: the
  // same rows the app's own data gives). Milestones, vaccines and
  // doctor visits on their day; "N months old today" up to 2 years,
  // then birthdays. Deleted children stay out. Rows are never
  // stored; micro-cached ~1s like the other feeds.
  var babyCache = { when: 0, data: null };

  function babyData() {
    var now = Date.now();
    var Core = window.orosBabyCore;
    if (!Core) return null;
    if (now - babyCache.when > 1000) {
      babyCache.data = null;
      try { babyCache.data = Core.parse(localStorage.getItem(Core.STORAGE_KEY)); } catch (e) {}
      babyCache.when = now;
    }
    return babyCache.data;
  }

  function babyFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-baby")) return [];
    var d = babyData();
    if (!d || !d.kids.length) return [];
    return window.orosBabyCore.calendarRows(d, dateStr, LANG === "el" ? "el" : "en").map(function (r) {
      return {
        id: "bbf-" + r.id,                      // per-render key, never stored
        title: r.title,
        labelId: "lbl-feed-baby",
        start: null,                            // all-day
        _feed: true,
        _babyOpen: true
      };
    });
  }

  // Garage read-only feed (garage/core.js, loaded by index.html: the
  // same math as the app and the shell reminder). Renewals on their
  // expiry day, service plans on their due (or estimated) day; only
  // the NEXT occurrence, never a projection. Anything already passed
  // shows on today. Archived vehicles stay out. Rows are never
  // stored; micro-cached ~1s like the other feeds.
  var GARAGE_DATA_KEY = "oros-garage-data";
  var garageCache = { when: 0, rows: null, today: "" };

  function garageRows() {
    var now = Date.now();
    var Core = window.OrosGarageCore;
    if (!Core) return null;
    if (now - garageCache.when > 1000) {
      garageCache.rows = null;
      try {
        var d = JSON.parse(localStorage.getItem(GARAGE_DATA_KEY));
        if (d && typeof d === "object" && Array.isArray(d.vehicles) && d.vehicles.length) {
          d = Core.merge(d, d, now);
          var today = Core.ymdOf(new Date(now)), names = {}, rows = [];
          d.vehicles.forEach(function (v) { if (!v.arch) names[v.id] = v.name; });
          d.renewals.forEach(function (r) {
            if (!names[r.v]) return;
            var what = r.kind === "other" && r.label ? r.label : t("feed.garage." + r.kind);
            rows.push({ day: r.exp < today ? today : r.exp, id: r.id, key: "r" + r.id,
              title: t(r.exp < today ? "feed.garage.expired" : "feed.garage.exp")
                .replace("{vehicle}", names[r.v]).replace("{what}", what) });
          });
          d.plans.forEach(function (p) {
            if (!names[p.v]) return;
            var st = Core.planStatus(p, d, today);
            if (!st.when && st.level !== "due") return;
            var item = p.item === "other" && p.label ? p.label : t("feed.garage.service");
            if (p.item !== "other") item = Core.itemName(p.item, LANG);
            rows.push({ day: !st.when || st.when < today ? today : st.when, id: p.id, key: "p" + p.id,
              title: t("feed.garage.svc").replace("{vehicle}", names[p.v]).replace("{what}", item) });
          });
          garageCache.rows = rows;
          garageCache.today = today;
        }
      } catch (e) { garageCache.rows = null; }
      garageCache.when = now;
    }
    return garageCache.rows;
  }

  function garageFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-garage")) return [];
    var rows = garageRows();
    if (!rows || dateStr < garageCache.today) return [];
    var out = [];
    rows.forEach(function (r) {
      if (r.day !== dateStr) return;
      out.push({
        id: "grg-" + r.key + "-" + dateStr,     // per-render key, never stored
        title: r.title,
        labelId: "lbl-feed-garage",
        start: null,                            // all-day
        _feed: true,
        _garageId: r.id
      });
    });
    return out;
  }

  // Travel read-only feed (travel/core.js, loaded by index.html: the
  // same reading as the shell reminder). Each trip shows on every day
  // of its dates (all-day, "Rome · day 2/5"); itinerary entries that
  // have a day and a time show at that time. Rows are never stored;
  // micro-cached ~1s like the other feeds. Click → the trip in Travel
  // (timed rows open its itinerary).
  var TRAVEL_DATA_KEY = "oros-travel-data";
  var travelCache = { when: 0, rows: null };

  function travelRows() {
    var now = Date.now();
    var Core = window.OrosTravelCore;
    if (!Core) return null;
    if (now - travelCache.when > 1000) {
      travelCache.rows = null;
      try {
        var raw = localStorage.getItem(TRAVEL_DATA_KEY);
        if (raw) travelCache.rows = Core.feedRows(Core.trips(JSON.parse(raw)));
      } catch (e) { travelCache.rows = null; }
      travelCache.when = now;
    }
    return travelCache.rows;
  }

  function travelFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-travel")) return [];
    var rows = travelRows();
    if (!rows) return [];
    var Core = window.OrosTravelCore, out = [];
    rows.forEach(function (r) {
      if (r.day !== dateStr) return;
      var title = r.kind === "trip"
        ? (r.of > 1 ? t("feed.travel.day").replace("{name}", r.name).replace("{n}", r.n).replace("{of}", r.of) : r.name)
        : Core.entryTitle(r.entry, LANG);
      out.push({
        id: "trv-" + r.key,                     // per-render key, never stored
        title: title,
        labelId: "lbl-feed-travel",
        start: r.start,                         // null = all-day
        end: r.end,
        _feed: true,
        _travel: { trip: r.trip, tab: r.kind === "trip" ? "" : "plan" }
      });
    });
    return out;
  }

  // Meal Planner read-only feed (meals/core.js, loaded by index.html).
  // One all-day row per planned meal: "Dinner: Fasolada, Salad", in the
  // slots the app shows, with the user's own slot names. Ready recipes
  // are named in this device's language; deleted recipes are left out.
  // Rows are never stored; micro-cached ~1s like the other feeds.
  var MEALS_DATA_KEY = "oros-meals-data";
  var mealsCache = { when: 0, rows: null };

  function mealsRows() {
    var now = Date.now();
    var Core = window.OrosMealsCore;
    if (!Core) return null;
    if (now - mealsCache.when > 1000) {
      mealsCache.rows = null;
      try {
        var raw = JSON.parse(localStorage.getItem(MEALS_DATA_KEY));
        if (raw && typeof raw === "object" && raw.pl && typeof raw.pl === "object") {
          var d = Core.mergeMeals(raw, raw), names = {}, rows = {};
          Core.allRecipes(d, LANG).forEach(function (r) { names[r.id] = r.t; });
          d.set.sl.forEach(function (sl, order) {
            Object.keys(d.pl).forEach(function (k) {
              var i = k.indexOf("|"), day = k.slice(0, i);
              if (k.slice(i + 1) !== sl) return;
              var what = d.pl[k].it.map(function (it) { return it.r ? names[it.r] : it.t; })
                .filter(Boolean);
              if (!what.length) return;
              (rows[day] = rows[day] || []).push({
                key: sl, order: order,
                title: (d.set.nm[sl] || t("feed.meals." + sl)) + ": " + what.join(", ")
              });
            });
          });
          mealsCache.rows = rows;
        }
      } catch (e) { mealsCache.rows = null; }
      mealsCache.when = now;
    }
    return mealsCache.rows;
  }

  function mealsFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-meals")) return [];
    var rows = mealsRows();
    if (!rows || !rows[dateStr]) return [];
    return rows[dateStr].slice().sort(function (a, b) { return a.order - b.order; }).map(function (r) {
      return {
        id: "mls-" + dateStr + "-" + r.key,       // per-render key, never stored
        title: r.title,
        labelId: "lbl-feed-meals",
        start: null,                              // all-day
        _feed: true,
        _openAt: { app: "meals", target: { day: dateStr } }
      };
    });
  }

  // Budget read-only feed (budget/feed.js, loaded by index.html: the
  // same occurrence rules as the app). Upcoming occurrences of the
  // recurring entries, today and later only (earlier ones are real
  // entries in Budget by then). "Rent −€500.00" / "Salary +€1,200.00".
  // Rows are never stored; the blob is micro-cached ~1s like the
  // other feeds. Click → Budget opens that recurring entry.
  var BUDGET_DATA_KEY = "oros-budget-data";
  var budgetCache = { when: 0, data: null, fmt: null, fmtCur: "", fmtLang: "" };

  function budgetData() {
    var now = Date.now();
    if (now - budgetCache.when > 1000) {
      budgetCache.data = null;
      try {
        var d = JSON.parse(localStorage.getItem(BUDGET_DATA_KEY));
        if (d && typeof d === "object" && Array.isArray(d.rec) && d.rec.length) budgetCache.data = d;
      } catch (e) {}
      budgetCache.when = now;
    }
    return budgetCache.data;
  }
  function budgetMoney(cents, cur) {
    if (!budgetCache.fmt || budgetCache.fmtCur !== cur || budgetCache.fmtLang !== LANG) {
      try {
        budgetCache.fmt = new Intl.NumberFormat(LANG === "el" ? "el-GR" : "en-GB", { style: "currency", currency: cur });
      } catch (e) {
        budgetCache.fmt = { format: function (v) { return v.toFixed(2) + " " + cur; } };
      }
      budgetCache.fmtCur = cur;
      budgetCache.fmtLang = LANG;
    }
    return budgetCache.fmt.format(cents / 100);
  }

  function budgetFeedOn(dateStr) {
    var F = window.OrosBudgetFeed;
    if (!F || !labelVisible("lbl-feed-budget")) return [];
    var d = budgetData();
    if (!d) return [];
    return F.rowsOn(d, dateStr, todayYMD(), LANG).map(function (r) {
      return {
        id: "bud-" + r.id + "-" + dateStr,      // per-render key, never stored
        title: (r.name ? r.name + " " : "") + (r.k === "o" ? "\u2212" : "+") + budgetMoney(r.a, r.cur),
        labelId: "lbl-feed-budget",
        start: null,                            // all-day
        _feed: true,
        _budgetRec: r.id
      };
    });
  }

  /* ---------- 3d. Name days, holidays, world days ----------
     Data and rules live in namedays.js (window.OrosNamedays, pure).
     Three chips, all read-only virtual rows, never stored in the
     synced blob:
       - Holidays: Greek public holidays (fixed + from Orthodox Easter).
       - Name days: the day view's "Name days:" line, plus one row per
         CONTACT whose first name has a name day (click → Contacts).
       - World days: observances from days.json. The file is fetched
         from our own site at most once a week and cached on this
         device (DAYS_KEY); the service worker's precached copy is
         the offline fallback. Nothing leaves the device but that GET.
     The on/off state of these three chips is remembered on this
     device (FEEDVIS_KEY, outside sync); the other feeds reset to
     visible on every load as before. */
  var ND = window.OrosNamedays || null;
  var FEEDVIS_KEY = "oros-cal-feedvis";
  var DAYS_KEY = "oros-cal-days";
  var DAYS_MAX_AGE = 7 * 86400000;
  var STICKY_FEEDS = ["lbl-feed-hol", "lbl-feed-nameday", "lbl-feed-obs", "lbl-feed-time"];
  var daysData = null;

  function loadFeedVis() {
    try {
      var v = JSON.parse(localStorage.getItem(FEEDVIS_KEY) || "{}");
      STICKY_FEEDS.forEach(function (id) { if (v && v[id] === false) labelVis[id] = false; });
    } catch (e) {}
  }
  function saveFeedVis(id) {
    if (STICKY_FEEDS.indexOf(id) === -1) return;
    var v = {};
    STICKY_FEEDS.forEach(function (k) { if (!labelVisible(k)) v[k] = false; });
    try { localStorage.setItem(FEEDVIS_KEY, JSON.stringify(v)); } catch (e) {}
  }

  function loadDays() {
    if (!ND) return;
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(DAYS_KEY) || "null"); } catch (e) {}
    if (cached && typeof cached === "object") daysData = ND.cleanDays(cached.data);
    var fresh = cached && typeof cached.at === "number" &&
                Date.now() - cached.at < DAYS_MAX_AGE && cached.at <= Date.now();
    if (fresh && daysData) return;
    if (typeof fetch !== "function") return;
    // One URL per week: a new week is a cache miss in the service
    // worker (exact-match), so this reaches the network when online;
    // offline, the SW's ignoreSearch fallback answers with its copy.
    var week = Math.floor(Date.now() / DAYS_MAX_AGE);
    fetch("days.json?w=" + week, { cache: "no-cache" }).then(function (r) {
      return r && r.ok ? r.json() : null;
    }).then(function (json) {
      var clean = ND.cleanDays(json);
      if (!clean) return;
      daysData = clean;
      try { localStorage.setItem(DAYS_KEY, JSON.stringify({ at: Date.now(), data: clean })); } catch (e) {}
      renderAll();
      renderDay();
    }).catch(function () {});
  }

  function holidaysFeedOn(dateStr) {
    if (!ND || !labelVisible("lbl-feed-hol")) return [];
    return ND.holidaysOn(dateStr).map(function (h) {
      return { id: "hol-" + h.id + "-" + dateStr, title: LANG === "el" ? h.el : h.en,
               labelId: "lbl-feed-hol", start: null, _feed: true };
    });
  }
  function isHoliday(dateStr) {
    return !!(ND && labelVisible("lbl-feed-hol") && ND.holidaysOn(dateStr).length);
  }
  function observancesFeedOn(dateStr) {
    if (!ND || !daysData || !labelVisible("lbl-feed-obs")) return [];
    return ND.observancesOn(dateStr, daysData).map(function (o) {
      return { id: "obs-" + o.id + "-" + dateStr, title: LANG === "el" ? o.el : o.en,
               labelId: "lbl-feed-obs", start: null, _feed: true };
    });
  }
  function namedayContactsOn(dateStr) {
    if (!ND || !labelVisible("lbl-feed-nameday")) return [];
    var cs = contactsRaw().contacts;
    if (!Array.isArray(cs)) return [];
    var out = [];
    cs.forEach(function (c) {
      if (!c || typeof c !== "object" || typeof c.id !== "string") return;
      var first = (typeof c.given === "string" && c.given.trim()) ? c.given
                : (typeof c.nickname === "string" ? c.nickname : "");
      if (!first || !ND.celebrates(first, dateStr)) return;
      out.push({ id: "nd-" + c.id + "-" + dateStr,          // per-render key, never stored
                 title: t("nd.contact").replace("{name}", ctName(c)),
                 labelId: "lbl-feed-nameday", start: null, _feed: true, _contactId: c.id });
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
    .concat(todoFeedOn(dateStr))
    .concat(fitnessFeedOn(dateStr))
    .concat(petFeedOn(dateStr))
    .concat(plantsFeedOn(dateStr))
    .concat(choresFeedOn(dateStr))
    .concat(petcareFeedOn(dateStr))
    .concat(garageFeedOn(dateStr))
    .concat(travelFeedOn(dateStr))
    .concat(mealsFeedOn(dateStr))
    .concat(budgetFeedOn(dateStr))
    .concat(babyFeedOn(dateStr))
    .concat(holidaysFeedOn(dateStr))
    .concat(namedayContactsOn(dateStr))
    .concat(observancesFeedOn(dateStr))
    .concat(timesheetFeedOn(dateStr))
    .concat(familyTreeFeedOn(dateStr))
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
      } else if (ev._todo &&
                 typeof p.__orosOpenTodo === "function") {
        p.__orosOpenTodo(ev._todo.listId);
      } else if (ev._plantId &&
                 typeof p.__orosOpenPlants === "function") {
        p.__orosOpenPlants(ev._plantId);
      } else if (ev._choresDay &&
                 typeof p.__orosOpenChores === "function") {
        p.__orosOpenChores(ev._choresDay);
      } else if (ev._petcareId &&
                 typeof p.__orosOpenPetcare === "function") {
        p.__orosOpenPetcare(ev._petcareId);
      } else if (ev._garageId &&
                 typeof p.__orosOpenGarage === "function") {
        p.__orosOpenGarage(ev._garageId);
      } else if (ev._travel &&
                 typeof p.__orosOpenTravel === "function") {
        p.__orosOpenTravel(ev._travel.trip, ev._travel.tab);
      } else if (ev._openAt &&
                 typeof p.__orosOpenAt === "function") {
        p.__orosOpenAt(ev._openAt.app, ev._openAt.target);
      } else if (ev._budgetRec &&
                 typeof p.__orosOpenAt === "function") {
        p.__orosOpenAt("budget", { rec: ev._budgetRec });
      } else if (ev._fitnessId &&
                 typeof p.__orosOpenFitness === "function") {
        p.__orosOpenFitness(ev._fitnessId);
      } else if (ev._babyOpen &&
                 typeof p.__orosOpenApp === "function") {
        p.__orosOpenApp("baby");
      } else if (ev._petOpen &&
                 typeof p.__orosOpenPet === "function") {
        // Screen Pet is a SHELL component — the bridge lives on the
        // parent, not this iframe. Care rows pass the log entry id;
        // the birthday row passes null (plain log, no highlight).
        p.__orosOpenPet(ev._petEvId || null);
      }
    } catch (e) {}
  }

  /* Wave 7 — Calendar → Maps geocode bridge (same contract as
     Bookmarks/Contacts): shell first (live push or staged +
     open), standalone fallback opens /maps/?q= in a new tab. */
  function openInMaps(query, label) {
    if (typeof query !== "string" || !query.trim()) return;
    try {
      if (window.parent &&
          typeof window.parent.__orosOpenMapsQuery === "function") {
        window.parent.__orosOpenMapsQuery(query.trim(), label || "");
        return;
      }
    } catch (e) { /* cross-origin guard */ }
    window.open("/maps/?q=" + encodeURIComponent(query.trim()),
      "_blank", "noopener,noreferrer");
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
      if (isHoliday(cellDate)) btn.className += " hol";

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
        (selDate === dayYmd ? " sel" : "") +
        (isHoliday(dayYmd) ? " hol" : "");

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
        if (e.location && !e._feed) {
          var wloc = document.createElement("span");
          wloc.className = "wk-ev-loc map-link";
          wloc.textContent = "▸ " + e.location;
          wloc.title = t("cal.maps");
          (function (lq, lbl) {
            wloc.addEventListener("click", function (evt) {
              evt.stopPropagation();
              openInMaps(lq, lbl);
            });
          })(e.location, e.title || "");
          ev.appendChild(wloc);
        }
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
      if (e.location) {
        var slo = document.createElement("span");
        slo.className = "res-loc map-link";
        slo.textContent = "▸ " + e.location;
        slo.title = t("cal.maps");
        (function (lq, lbl) {
          slo.addEventListener("click", function (evt) {
            evt.stopPropagation();
            openInMaps(lq, lbl);
          });
        })(e.location, e.title || "");
        li.appendChild(slo);
      }
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
      c.appendChild(document.createTextNode(lblName(l)));
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
        saveFeedVis(fl.id);
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
      loc.className = "ev-note ev-loc map-link";
      loc.textContent = "▸ " + e.location;
      if (!e._feed) {
        loc.title = t("cal.maps");
        (function (lq, lbl) {
          loc.addEventListener("click", function (evt) {
            evt.stopPropagation();
            openInMaps(lq, lbl);
          });
        })(e.location, e.title || "");
      }
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

  // "Name days: …" under the day title. Greek names in both
  // languages (a Greek custom); long lists fold behind "+N more".
  var ND_SHOW = 8;
  function renderNamedayLine() {
    var el = $("nd-line");
    if (!el) return;
    el.textContent = "";
    var names = (ND && selDate && labelVisible("lbl-feed-nameday")) ? ND.namesOn(selDate) : [];
    el.hidden = !names.length;
    if (!names.length) return;
    var lab = document.createElement("span");
    lab.className = "nd-lab";
    lab.textContent = t("nd.line") + " ";
    el.appendChild(lab);
    var txt = document.createElement("span");
    txt.textContent = names.slice(0, ND_SHOW).join(", ");
    el.appendChild(txt);
    if (names.length > ND_SHOW) {
      var more = document.createElement("button");
      more.type = "button";
      more.className = "nd-more";
      more.textContent = t("nd.more").replace("{n}", String(names.length - ND_SHOW));
      more.addEventListener("click", function () {
        txt.textContent = names.join(", ");
        more.remove();
      });
      el.appendChild(document.createTextNode(" "));
      el.appendChild(more);
    }
  }

  function renderDay() {
    var head = $("day-title");
    if (!selDate) {
      if ($("nd-line")) { $("nd-line").textContent = ""; $("nd-line").hidden = true; }
      head.textContent = "";
      $("ev-list").textContent = "";
      return;
    }
    var parts = selDate.split("-");
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    var txt = d.getDate() + " " + t("months")[d.getMonth()];
    if (selDate === todayYMD()) txt += " — " + t("day.today");
    head.textContent = txt;
    renderNamedayLine();

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
  var dlgBase = null;      // CA-8: field values the open dialog started from

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
    state.labels.forEach(function (l) { mk(l.id, lblName(l), l.color); });
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
    // CA-8: what the dialog showed at open — a pull may update every
    // field the user has not touched since.
    dlgBase = (existing && mode !== "occ") ? {
      selDate: selDate, date: existing.date, title: existing.title,
      note: existing.note, location: existing.location,
      remind: (existing.remindMin ? String(existing.remindMin) : ""),
      labelId: existing.labelId
    } : null;
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
      transientNote(t("ev.err.title"));
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
      transientNote(t("ev.err.time"));
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
        transientNote(t("ev.err.dateend"));
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
          // CA-8: the user did not change the day but another device
          // moved the event → keep the live date.
          var keepLiveDate = dlgBase && selDate === dlgBase.selDate &&
                             state.events[i].date !== dlgBase.date;
          if (!isSeries && !keepLiveDate) state.events[i].date = selDate;
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
    var undoId = lastDeleted.id;      // CA-10: never a duplicate id
    state.events = state.events.filter(function (e) { return e.id !== undoId; });
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

  // CA-11: a pull replaces state.labels with new objects. Handlers
  // resolve the label by id at click time; one deleted meanwhile on
  // another device is brought back by the edit (newer than its
  // tombstone — the merge contract for labels).
  function liveLabel(snap) {
    for (var i = 0; i < state.labels.length; i++) {
      if (state.labels[i].id === snap.id) return state.labels[i];
    }
    var back = { id: snap.id, name: snap.name, color: snap.color, mtime: snap.mtime };
    state.labels.push(back);
    state.deleted = state.deleted.filter(function (d) { return d.id !== snap.id; });
    return back;
  }

  function renderLblList() {
    var list = $("lbl-list");
    list.textContent = "";
    state.labels.forEach(function (l0) {
      var l = { id: l0.id, name: l0.name, color: l0.color, mtime: l0.mtime };
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
          var lv = liveLabel(l);
          lv.color = c;
          stampLabel(lv);         // color change propagates via merge
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
      inp.value = lblName(l);
      inp.addEventListener("change", function () {
        var lv = liveLabel(l);
        var nm = inp.value.trim().slice(0, 40);
        stampLabel(lv);
        if (nm) lv.name = nm;
        inp.value = lv.name;
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
    var done = function () { transientNote(t("exp.done")); };
    var dlg = dialogHost();

    if (dlg && typeof dlg.saveFile === "function") {
      dlg.saveFile({
        blob: blob,
        filename: "oros-calendar.ics",
        mime: "text/calendar;charset=utf-8",
        types: [{ description: "iCalendar",
                  accept: { "text/calendar": [".ics"] } }]
      }).then(function (r) { if (r && r.ok) done(); });
      return;                         // cancel (ok=false) = silent exit
    }

    // Standalone fallback — classic download (no shell present).
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "oros-calendar.ics";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    done();
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
  var CAL_NEW_KEY = "oros-cal-new";

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

  /* Wave 8 — Maps → Calendar "plan route" receiver: navigates to
     the date, selects it and opens the New Event dialog prefilled
     (title / location / start time). Payload: { date: "YYYY-MM-DD",
     title?: string, location?: string, start?: "HH:MM" }. Invalid
     or absent date = silent no-op (the Maps side guards first,
     this is the belt-and-braces layer). */
  function __orosCalendarNew(p) {
    if (!p || typeof p !== "object") return;
    if (typeof p.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return;
    var pd = p.date.split("-");
    viewYear = +pd[0];
    viewMonth = +pd[1] - 1;
    if (curView !== "month") setView("month");
    var si = $("search-in");
    if (si) si.value = "";
    setSearch("");
    selectDay(p.date);
    setTimeout(function () {
      openDlg(null);
      if (typeof p.title === "string" && p.title.trim()) {
        $("ev-title").value = p.title.trim().slice(0, 80);
      }
      if (typeof p.location === "string" && p.location.trim()) {
        $("ev-location").value = p.location.trim().slice(0, 150);
      }
      if (typeof p.note === "string" && p.note.trim()) {
        $("ev-note").value = p.note.trim().slice(0, 500);
      }
      if (typeof p.start === "string" && /^\d{2}:\d{2}$/.test(p.start)) {
        $("ev-allday").checked = false;
        $("ev-allday").dispatchEvent(new Event("change"));
        $("ev-start").value = p.start;
      }
    }, 60);
  }
  window.__calNewEvent = __orosCalendarNew;


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
  loadFeedVis();
  loadDays();
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
  // Wave 8: staged "new event" payload from Maps (shell staged it
  // while the Calendar app was not running).
  try {
    var pendNew = sessionStorage.getItem(CAL_NEW_KEY);
    if (pendNew) {
      sessionStorage.removeItem(CAL_NEW_KEY);
      var pn = JSON.parse(pendNew);
      if (pn && typeof pn === "object" && pn.date) {
        setTimeout(function () { __orosCalendarNew(pn); }, 250);
      }
    }
  } catch (e5) {}
  // Standalone deep-link: /calendar/?new={json} — Maps opened the
  // Calendar in a new tab (no shell present in that context).
  try {
    var urlNew = new URLSearchParams(location.search).get("new");
    if (urlNew) {
      var un = JSON.parse(urlNew);
      if (un && typeof un === "object" && un.date) {
        setTimeout(function () { __orosCalendarNew(un); }, 400);
      }
    }
  } catch (e6) {}

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
    // CA4: VALID_COLORS = LABEL_PALETTE + brown (#c8a96e for
    // Contacts custom events). Both merge and load sanitizers
    // must agree — if one drops brown, the other resurrects it.
    if (VALID_COLORS.indexOf(l.color) === -1) return null;
    // CA-7: untouched seeds carry the canonical name in every blob
    // (an older EL device may still send its Greek seed names).
    return canonSeedName({
      id: l.id,
      name: (typeof l.name === "string" ? l.name : "").slice(0, 40),
      color: l.color,
      mtime: l.mtime
    });
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
  // CA-8 (A67 Q1): a pull never closes the open event dialog. Fields
  // the user has not touched since opening follow the live event;
  // typed fields stay. Save edits by id (a remotely deleted event is
  // brought back by the edit — the existing resurrect path).
  function refreshOpenDlg() {
    var dlg = $("ev-dlg");
    if (!dlg || !dlg.open || !dlgBase || !editingId) return;
    var live = null;
    for (var i = 0; i < state.events.length; i++) {
      if (state.events[i].id === editingId) { live = state.events[i]; break; }
    }
    if (!live) return;
    var follow = function (id, key, val) {
      var el = $(id);
      if (el && el.value === dlgBase[key] && val !== dlgBase[key]) {
        el.value = val;
        dlgBase[key] = val;
      }
    };
    follow("ev-title", "title", live.title);
    follow("ev-note", "note", live.note);
    follow("ev-location", "location", live.location);
    follow("ev-remind", "remind", live.remindMin ? String(live.remindMin) : "");
    if (dlgLabelId === dlgBase.labelId && live.labelId !== dlgBase.labelId) {
      dlgLabelId = live.labelId;
      dlgBase.labelId = live.labelId;
    }
    renderDlgLabels();
  }

  function setFromSync(data, info) {
    if (!data || typeof data !== "object" || !Array.isArray(data.events)) return;
    var evs = data.events.map(sanitizeEvent).filter(Boolean);
    var dels = (Array.isArray(data.deleted) ? data.deleted : [])
      .map(sanitizeTomb).filter(Boolean);
    var lbls = Array.isArray(data.labels)
      ? data.labels.map(sanitizeLabel).filter(Boolean)
      : defaultLabels();   // παλιό-peer blob χωρίς labels → seed
    state = { ver: 1, labels: lbls, events: evs, deleted: dels };
    // CA-10: Undo data survives a pull (R28) — undoDelete/undoMove/
    // undoExdate all work by id on the live state.
    reseedSeedNames();
    refreshOpenDlg();
    writeStore();         // no markDirty: this IS the sync result
    // INVALIDATE ALL FEED CACHES — sync may have just pulled fresh
    // data for Contacts/Cycle/Mood/Habits/Kanban; the 1s micro-cache
    // would otherwise serve stale reads on the immediate renderAll()
    contactsCache = { when: 0, data: {} };
    habitsCache = { when: 0, data: null };
    cycleCache = { when: 0, data: null };
    moodCache = { when: 0, data: null };
    kanbanCache = { when: 0, data: null };
    todoCache = { when: 0, data: null };
    fitCache = { when: 0, data: null };
    petCache = { when: 0, optOut: false, petData: null, logData: null };
    renderAll();
    renderDay();          // selDate-aware (guarded when null)
    // CA-9: no "Updated from sync" toast — a receipt on every pull
    // is noise, and the changed data is already on screen.
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
        function () {     // getter: localStorage is the durable truth,
          // CA-7: always in the merge's canonical form (merge(get, get)
          // = get), so an unchanged device never re-uploads.
          try {
            return mergeCalendars(JSON.parse(localStorage.getItem(DATA_KEY)), null);
          } catch (e) {
            return mergeCalendars(state, null);
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