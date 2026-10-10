// ============================================================
// orOS Timesheet — App logic (v1.0.0)
// Work time per project and client:
//   - one running timer (start / stop / resume); it keeps running
//     with the app closed and travels to the other devices
//   - entries by hand (start–end or a duration), edit, delete, Undo
//   - week grid, reports with rates and amounts, "invoiced" marks
//   - CSV export of a report, JSON backup + restore (a merge)
// Rounding is a report setting: stored times are never rounded.
// The model (normalize, merge, day pieces, reports, CSV) lives in
// core.js.
// Data:
//   - synced slice "timesheet" (oros-timesheet-data), see core.js
//   - device-local (R10): oros-timesheet-prefs { tab, lastP, rep{} }
// Sections:
//   1. i18n + helpers
//   2. Storage
//   3. Edits: timer, entries, projects, clients, prefs
//   4. Render: timer + day
//   5. Render: week
//   6. Render: report
//   7. Render: projects
//   8. Dialogs: entry, project, client, settings
//   9. Files: CSV, backup, restore
//  10. Toasts
//  11. Keyboard (Contract Β)
//  12. Sync slice + palette
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C = window.orosTimesheetCore;
  var STORAGE_KEY = C.STORAGE_KEY;
  var PREFS_KEY = "oros-timesheet-prefs";
  var FORGOT_MS = 10 * C.HOUR;

  // ---------- 1. i18n + helpers ----------
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
      "app": "Timesheet", "settings": "Settings",
      "tab.timer": "Timer", "tab.week": "Week", "tab.report": "Reports", "tab.projects": "Projects",
      "today": "Today", "yesterday": "Yesterday", "prev": "Previous day", "next": "Next day",
      "wprev": "Previous week", "wnext": "Next week", "thisWeek": "This week",
      "run.start": "Start", "run.stop": "Stop", "run.desc": "What are you working on?",
      "run.since": "since {t}", "run.sinceDay": "since {d}, {t}", "run.idle": "Not running",
      "run.others": "{n} timers are running (started on different devices).",
      "run.stopOne": "Stop", "noProject": "No project", "goneProject": "Deleted project",
      "forgot": "The timer has been running for {d}. Forgot to stop it?",
      "forgot.fix": "Fix end time", "forgot.ok": "It's fine",
      "entries.empty": "No time logged on this day.", "add.entry": "Add time by hand",
      "entry.edit": "Edit {p}, {a}", "entry.resume": "Continue: {p}", "entry.running": "running",
      "entry.billed": "Invoiced", "day.total": "Total {d}", "goal.of": "{d} of {g}",
      "week.empty": "No time logged this week.", "week.project": "Project", "week.total": "Total",
      "rep.range": "Period", "rep.from": "From", "rep.to": "To", "rep.client": "Client",
      "rep.project": "Project", "rep.bill": "Billable", "rep.billed": "Invoiced", "rep.group": "Group by",
      "range.thisWeek": "This week", "range.lastWeek": "Last week", "range.thisMonth": "This month",
      "range.lastMonth": "Last month", "range.thisYear": "This year", "range.custom": "Custom",
      "all": "All", "allClients": "All clients", "allProjects": "All projects", "noClient": "No client",
      "bill.bill": "Billable only", "bill.non": "Non-billable only",
      "billed.open": "Not invoiced", "billed.done": "Invoiced",
      "group.project": "Project", "group.client": "Client", "group.day": "Day",
      "col.hours": "Hours", "col.bill": "Billable", "col.amount": "Amount", "col.total": "Total",
      "rep.empty": "Nothing in this period.",
      "rep.noteRound": "Times rounded {mode} to {n} min per entry (Settings). Stored times are exact.",
      "rep.noteExact": "Exact times, no rounding.", "rep.up": "up", "rep.near": "to the nearest",
      "rep.csv": "Export CSV", "rep.mark": "Mark {n} as invoiced", "rep.unmark": "Unmark {n} invoiced",
      "rep.markNone": "Nothing billable left to invoice", "rep.running": "Includes a running timer (counted up to now).",
      "proj.empty": "No projects yet. Add one, or just start the timer: time without a project is kept too.",
      "add.project": "New project", "add.client": "New client", "proj.archived": "Archived ({n})",
      "proj.nobill": "not billable", "proj.rate": "{r}/h", "proj.total": "{d} in total",
      "dlg.entry": "Time entry", "dlg.newEntry": "Add time", "dlg.project": "Project", "dlg.newProject": "New project",
      "dlg.client": "Client", "dlg.newClient": "New client", "dlg.settings": "Settings",
      "dlg.save": "Save", "dlg.cancel": "Cancel", "dlg.del": "Delete", "dlg.add": "Add", "dlg.stop": "Stop now",
      "f.project": "Project", "f.desc": "Description", "f.sdate": "Start date", "f.stime": "Start",
      "f.edate": "End date", "f.etime": "End", "f.dur": "Duration", "f.durHint": "e.g. 1:30, 1,5 (hours) or 90m",
      "f.running": "Running: it ends when you stop it.", "f.billed": "Invoiced",
      "f.name": "Name", "f.client": "Client", "f.color": "Colour", "f.rate": "Hourly rate",
      "f.rateHint": "Empty: {r} from {src}.", "f.rateNone": "Empty: no rate.", "src.client": "the client",
      "src.default": "Settings", "f.billable": "Billable", "f.archived": "Archived (hidden from the timer)",
      "f.cur": "Currency", "f.defRate": "Default hourly rate", "f.goal": "Daily goal",
      "f.goalHint": "Hours per day, e.g. 8 or 7:30. Empty: no goal.",
      "f.round": "Rounding in reports", "f.roundMode": "Round", "round.off": "Off", "round.n": "{n} min",
      "round.up": "Up", "round.near": "To the nearest",
      "f.roundHint": "Applies to reports and CSV only. Your entries keep their exact times.",
      "set.data": "Data", "set.backup": "Back up (JSON)", "set.restore": "Restore from backup",
      "set.restoreHint": "A restore merges with what is here: nothing is replaced or lost.",
      "toast.save": "Could not save: storage is full", "toast.started": "Started: {p}",
      "toast.stopped": "Stopped: {p}, {d}", "toast.added": "Added {d}", "toast.deleted": "Entry deleted",
      "toast.saved": "Saved", "toast.undo": "Undo", "toast.badTime": "The end must be after the start",
      "toast.badDur": "Could not read that duration", "toast.badMoney": "Could not read that amount",
      "toast.badName": "Give it a name", "toast.overlap": "Saved. It overlaps another entry.",
      "toast.projDel": "Project deleted", "toast.cliDel": "Client deleted",
      "toast.projBusy": "This project has {n} entries. Archive it instead, to keep them.",
      "toast.cliBusy": "This client has {n} projects. Move or delete them first.",
      "toast.marked": "{n} entries marked invoiced", "toast.unmarked": "{n} entries unmarked",
      "toast.exported": "Exported", "toast.badFile": "This is not a Timesheet backup",
      "toast.restored": "Restored: {n} new entries", "toast.restored1": "Restored: 1 new entry", "toast.restoredNone": "Restored: nothing new",
      "toast.tooLong": "An entry can be at most 366 days long",
      "live.started": "Timer started", "live.stopped": "Timer stopped"
    },
    el: {
      "app": "Ώρες εργασίας", "settings": "Ρυθμίσεις",
      "tab.timer": "Χρονόμετρο", "tab.week": "Εβδομάδα", "tab.report": "Αναφορές", "tab.projects": "Έργα",
      "today": "Σήμερα", "yesterday": "Χθες", "prev": "Προηγούμενη μέρα", "next": "Επόμενη μέρα",
      "wprev": "Προηγούμενη εβδομάδα", "wnext": "Επόμενη εβδομάδα", "thisWeek": "Αυτή την εβδομάδα",
      "run.start": "Έναρξη", "run.stop": "Διακοπή", "run.desc": "Τι κάνεις τώρα;",
      "run.since": "από τις {t}", "run.sinceDay": "από {d}, {t}", "run.idle": "Δεν μετράει",
      "run.others": "Τρέχουν {n} χρονόμετρα (ξεκίνησαν σε διαφορετικές συσκευές).",
      "run.stopOne": "Διακοπή", "noProject": "Χωρίς έργο", "goneProject": "Διαγραμμένο έργο",
      "forgot": "Το χρονόμετρο μετράει εδώ και {d}. Μήπως ξέχασες να το σταματήσεις;",
      "forgot.fix": "Διόρθωση λήξης", "forgot.ok": "Εντάξει",
      "entries.empty": "Καμία καταγραφή αυτή τη μέρα.", "add.entry": "Προσθήκη χρόνου με το χέρι",
      "entry.edit": "Επεξεργασία: {p}, {a}", "entry.resume": "Συνέχεια: {p}", "entry.running": "μετράει",
      "entry.billed": "Τιμολογήθηκε", "day.total": "Σύνολο {d}", "goal.of": "{d} από {g}",
      "week.empty": "Καμία καταγραφή αυτή την εβδομάδα.", "week.project": "Έργο", "week.total": "Σύνολο",
      "rep.range": "Περίοδος", "rep.from": "Από", "rep.to": "Έως", "rep.client": "Πελάτης",
      "rep.project": "Έργο", "rep.bill": "Χρέωση", "rep.billed": "Τιμολόγηση", "rep.group": "Ομαδοποίηση",
      "range.thisWeek": "Αυτή την εβδομάδα", "range.lastWeek": "Προηγούμενη εβδομάδα", "range.thisMonth": "Αυτόν τον μήνα",
      "range.lastMonth": "Προηγούμενος μήνας", "range.thisYear": "Φέτος", "range.custom": "Επιλογή ημερομηνιών",
      "all": "Όλα", "allClients": "Όλοι οι πελάτες", "allProjects": "Όλα τα έργα", "noClient": "Χωρίς πελάτη",
      "bill.bill": "Μόνο χρεώσιμα", "bill.non": "Μόνο μη χρεώσιμα",
      "billed.open": "Δεν τιμολογήθηκαν", "billed.done": "Τιμολογήθηκαν",
      "group.project": "Έργο", "group.client": "Πελάτης", "group.day": "Μέρα",
      "col.hours": "Ώρες", "col.bill": "Χρεώσιμες", "col.amount": "Ποσό", "col.total": "Σύνολο",
      "rep.empty": "Τίποτα σε αυτή την περίοδο.",
      "rep.noteRound": "Οι χρόνοι στρογγυλεύονται {mode} στα {n} λεπτά ανά καταγραφή (Ρυθμίσεις). Οι αποθηκευμένοι χρόνοι μένουν ακριβείς.",
      "rep.noteExact": "Ακριβείς χρόνοι, χωρίς στρογγυλοποίηση.", "rep.up": "προς τα πάνω", "rep.near": "στο πλησιέστερο",
      "rep.csv": "Εξαγωγή CSV", "rep.mark": "Σήμανση {n} ως τιμολογημένων", "rep.unmark": "Αναίρεση τιμολόγησης ({n})",
      "rep.markNone": "Δεν έμεινε κάτι χρεώσιμο για τιμολόγηση", "rep.running": "Περιλαμβάνει χρονόμετρο που μετράει (μέχρι τώρα).",
      "proj.empty": "Δεν υπάρχουν έργα ακόμα. Πρόσθεσε ένα ή απλώς ξεκίνα το χρονόμετρο: ο χρόνος χωρίς έργο κρατιέται κι αυτός.",
      "add.project": "Νέο έργο", "add.client": "Νέος πελάτης", "proj.archived": "Αρχειοθετημένα ({n})",
      "proj.nobill": "χωρίς χρέωση", "proj.rate": "{r}/ώρα", "proj.total": "{d} συνολικά",
      "dlg.entry": "Καταγραφή χρόνου", "dlg.newEntry": "Προσθήκη χρόνου", "dlg.project": "Έργο", "dlg.newProject": "Νέο έργο",
      "dlg.client": "Πελάτης", "dlg.newClient": "Νέος πελάτης", "dlg.settings": "Ρυθμίσεις",
      "dlg.save": "Αποθήκευση", "dlg.cancel": "Άκυρο", "dlg.del": "Διαγραφή", "dlg.add": "Προσθήκη", "dlg.stop": "Διακοπή τώρα",
      "f.project": "Έργο", "f.desc": "Περιγραφή", "f.sdate": "Ημερομηνία έναρξης", "f.stime": "Έναρξη",
      "f.edate": "Ημερομηνία λήξης", "f.etime": "Λήξη", "f.dur": "Διάρκεια", "f.durHint": "π.χ. 1:30, 1,5 (ώρες) ή 90λ",
      "f.running": "Μετράει ακόμα: λήγει όταν το σταματήσεις.", "f.billed": "Τιμολογήθηκε",
      "f.name": "Όνομα", "f.client": "Πελάτης", "f.color": "Χρώμα", "f.rate": "Χρέωση ανά ώρα",
      "f.rateHint": "Κενό: {r} από {src}.", "f.rateNone": "Κενό: χωρίς χρέωση.", "src.client": "τον πελάτη",
      "src.default": "τις Ρυθμίσεις", "f.billable": "Χρεώσιμο", "f.archived": "Αρχειοθετημένο (κρυφό στο χρονόμετρο)",
      "f.cur": "Νόμισμα", "f.defRate": "Προεπιλεγμένη χρέωση ανά ώρα", "f.goal": "Ημερήσιος στόχος",
      "f.goalHint": "Ώρες τη μέρα, π.χ. 8 ή 7:30. Κενό: χωρίς στόχο.",
      "f.round": "Στρογγυλοποίηση στις αναφορές", "f.roundMode": "Στρογγυλοποίηση", "round.off": "Όχι", "round.n": "{n} λεπτά",
      "round.up": "Προς τα πάνω", "round.near": "Στο πλησιέστερο",
      "f.roundHint": "Ισχύει μόνο στις αναφορές και στο CSV. Οι καταγραφές σου κρατούν τους ακριβείς χρόνους.",
      "set.data": "Δεδομένα", "set.backup": "Αντίγραφο ασφαλείας (JSON)", "set.restore": "Επαναφορά από αντίγραφο",
      "set.restoreHint": "Η επαναφορά ενώνεται με ό,τι υπάρχει: τίποτα δεν αντικαθίσταται ούτε χάνεται.",
      "toast.save": "Η αποθήκευση απέτυχε: ο χώρος γέμισε", "toast.started": "Ξεκίνησε: {p}",
      "toast.stopped": "Σταμάτησε: {p}, {d}", "toast.added": "Προστέθηκε {d}", "toast.deleted": "Η καταγραφή διαγράφηκε",
      "toast.saved": "Αποθηκεύτηκε", "toast.undo": "Αναίρεση", "toast.badTime": "Η λήξη πρέπει να είναι μετά την έναρξη",
      "toast.badDur": "Δεν κατάλαβα αυτή τη διάρκεια", "toast.badMoney": "Δεν κατάλαβα αυτό το ποσό",
      "toast.badName": "Δώσε ένα όνομα", "toast.overlap": "Αποθηκεύτηκε. Επικαλύπτεται με άλλη καταγραφή.",
      "toast.projDel": "Το έργο διαγράφηκε", "toast.cliDel": "Ο πελάτης διαγράφηκε",
      "toast.projBusy": "Το έργο έχει {n} καταγραφές. Αρχειοθέτησέ το για να τις κρατήσεις.",
      "toast.cliBusy": "Ο πελάτης έχει {n} έργα. Μετακίνησέ τα ή διάγραψέ τα πρώτα.",
      "toast.marked": "{n} καταγραφές σημειώθηκαν ως τιμολογημένες", "toast.unmarked": "Αναιρέθηκε η τιμολόγηση σε {n} καταγραφές",
      "toast.exported": "Έγινε εξαγωγή", "toast.badFile": "Αυτό δεν είναι αντίγραφο των Ωρών εργασίας",
      "toast.restored": "Επαναφορά: {n} νέες καταγραφές", "toast.restored1": "Επαναφορά: 1 νέα καταγραφή", "toast.restoredNone": "Επαναφορά: τίποτα καινούριο",
      "toast.tooLong": "Μια καταγραφή μπορεί να κρατά έως 366 μέρες",
      "live.started": "Το χρονόμετρο ξεκίνησε", "live.stopped": "Το χρονόμετρο σταμάτησε"
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
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function locale() { return LANG === "el" ? "el-GR" : "en-GB"; }
  function money(cents) { return C.fmtMoney(cents, data.prefs.cur, LANG); }
  function dur(ms) { return C.fmtDur(ms); }
  function hours(ms) { return C.fmtHours(ms, LANG); }

  var UI = {
    left:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 6 9 12 15 18"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>',
    gear:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    play:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5z"/></svg>',
    stop:  '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    plus:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    timer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/></svg>',
    week:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 3v3M16 3v3M8 13.5h2M14 13.5h2M8 17h2"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/></svg>',
    folder:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12.5 10 17 19 7"/></svg>'
  };

  function newId() { return C.newId(); }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("timesheet.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Storage ----------
  var data = null, prefs = null;
  var dayKey = "";          // the day on the Timer tab
  var weekKey = "";         // Monday of the week on the Week tab
  var draft = { p: "", desc: "" };   // the next timer's fields (page memory)
  var forgotOk = {};        // running entries the user said are fine (session)

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    data = C.parse(raw);
    if (data) return;
    try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
    try { console.error("[orOS] timesheet: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    data = C.empty();
  }

  var saveFailShown = false;
  function saveNow() {
    data = C.normalize(data);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  var TABS = ["timer", "week", "report", "projects"];
  var RANGES = ["thisWeek", "lastWeek", "thisMonth", "lastMonth", "thisYear", "custom"];
  function loadPrefs() {
    var v = null;
    try { v = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    v = (v && typeof v === "object") ? v : {};
    var r = (v.rep && typeof v.rep === "object") ? v.rep : {};
    var str = function (x) { return typeof x === "string" ? x : ""; };
    prefs = {
      tab: TABS.indexOf(v.tab) >= 0 ? v.tab : "timer",
      lastP: str(v.lastP),
      rep: {
        range: RANGES.indexOf(r.range) >= 0 ? r.range : "thisMonth",
        from: C.validDay(r.from) ? r.from : "",
        to: C.validDay(r.to) ? r.to : "",
        client: str(r.client), project: str(r.project),
        bill: ["", "bill", "non"].indexOf(r.bill) >= 0 ? r.bill : "",
        billed: ["", "open", "done"].indexOf(r.billed) >= 0 ? r.billed : "",
        group: ["project", "client", "day"].indexOf(r.group) >= 0 ? r.group : "project"
      }
    };
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  function todayKey() { return C.dayKey(new Date()); }
  function stamp(prev) { return Math.max(Date.now(), (prev || 0) + 1); }
  function findIn(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function findEntry(id) { var x = findIn(data.entries, id); return x && !x.del ? x : null; }
  function projLabel(pid) {
    if (!pid) return t("noProject");
    var p = C.project(data, pid);
    return p ? p.name : t("goneProject");
  }
  function projColor(pid) {
    var p = C.project(data, pid);
    return p ? C.COLORS[p.color] : "var(--text-dim)";
  }
  function liveCount(list, fn) {
    var n = 0;
    list.forEach(function (x) { if (!x.del && fn(x)) n++; });
    return n;
  }

  // ---------- 3. Edits ----------
  // Start: every running timer stops first (one at a time), then a
  // new entry opens with the draft's project and description.
  function startTimer(p, desc) {
    var now = Date.now();
    stopAll(now, true);
    var id = newId();
    data.entries.push({ id: id, p: p || "", desc: C.cleanText(desc, C.LIM.desc), s: now, e: 0, billed: 0, m: now });
    prefs.lastP = p || "";
    savePrefs();
    saveNow();
    draft.desc = "";
    goDay(todayKey());
    live(t("live.started"));
  }
  function stopEntry(x, now, quiet) {
    var e = Math.max(now, x.s + 1000);
    if (e - x.s > C.MAX_SPAN) e = x.s + C.MAX_SPAN;
    x.e = e;
    x.m = stamp(x.m);
    if (!quiet) showToast(t("toast.stopped", { p: projLabel(x.p), d: dur(x.e - x.s) }));
  }
  function stopAll(now, quiet) {
    var list = C.running(data), any = false;
    list.forEach(function (x) {
      var cur = findEntry(x.id);
      if (cur) { stopEntry(cur, now, quiet || list.length > 1); any = true; }
    });
    return any;
  }
  function toggleTimer() {
    var run = C.running(data);
    if (run.length) {
      var x = run[0];
      draft.p = x.p;
      stopAll(Date.now(), false);
      saveNow();
      renderAll();
      live(t("live.stopped"));
      return;
    }
    startTimer($("run-proj").value, $("run-desc").value);
  }
  function stopOne(id) {
    var x = findEntry(id);
    if (!x || x.e !== 0) return;
    stopEntry(x, Date.now(), false);
    saveNow();
    renderAll();
  }
  function resume(x) {
    startTimer(C.project(data, x.p) ? x.p : "", x.desc);
  }

  // The running entry follows the timer fields as they change.
  var descTimer = null;
  function runFieldChanged(which) {
    var run = C.running(data);
    if (which === "p") { prefs.lastP = $("run-proj").value; savePrefs(); }
    if (!run.length) {
      draft.p = $("run-proj").value;
      draft.desc = $("run-desc").value;
      return;
    }
    var x = findEntry(run[0].id);
    if (!x) return;
    if (which === "p") {
      if (x.p === $("run-proj").value) return;
      x.p = $("run-proj").value;
      x.m = stamp(x.m);
      saveNow();
      renderDay();
      return;
    }
    clearTimeout(descTimer);
    descTimer = setTimeout(flushDesc, 700);
  }
  function flushDesc() {
    clearTimeout(descTimer);
    descTimer = null;
    var run = C.running(data);
    if (!run.length) return;
    var x = findEntry(run[0].id), v = C.cleanText($("run-desc").value, C.LIM.desc);
    if (!x || x.desc === v) return;
    x.desc = v;
    x.m = stamp(x.m);
    saveNow();
    renderDay();
  }

  function addEntry(rec) {
    var now = Date.now();
    var x = { id: newId(), p: rec.p, desc: rec.desc, s: rec.s, e: rec.e, billed: rec.billed, m: now };
    data.entries.push(x);
    saveNow();
    return x;
  }
  function editEntry(id, rec) {
    var x = findEntry(id);
    if (!x) return null;
    var same = x.p === rec.p && x.desc === rec.desc && x.s === rec.s && x.e === rec.e && x.billed === rec.billed;
    if (same) return x;
    x.p = rec.p; x.desc = rec.desc; x.s = rec.s; x.e = rec.e; x.billed = rec.billed;
    x.m = stamp(x.m);
    saveNow();
    return x;
  }
  // Delete = tombstone with a fresh stamp (R17); Undo brings it back
  // with a newer stamp still, so it wins over the tombstone everywhere.
  function deleteEntry(id) {
    var x = findEntry(id);
    if (!x) return;
    var snap = JSON.parse(JSON.stringify(x));
    replaceIn(data.entries, { id: id, m: stamp(x.m), del: 1 });
    saveNow();
    renderAll();
    undoToast(t("toast.deleted"), function () {
      var cur = findIn(data.entries, id);
      snap.m = stamp(cur ? cur.m : snap.m);
      replaceIn(data.entries, snap);
      saveNow();
      renderAll();
    });
  }
  function replaceIn(list, rec) {
    for (var i = 0; i < list.length; i++) if (list[i].id === rec.id) { list[i] = rec; return; }
    list.push(rec);
  }

  function saveProject(id, rec) {
    var cur = id ? findIn(data.projects, id) : null;
    if (cur && !cur.del) {
      var same = cur.name === rec.name && cur.client === rec.client && cur.color === rec.color &&
                 cur.rate === rec.rate && cur.bill === rec.bill && cur.arch === rec.arch;
      if (same) return cur.id;
      rec.id = cur.id;
      rec.m = stamp(cur.m);
    } else {
      rec.id = newId();
      rec.m = Date.now();
    }
    replaceIn(data.projects, rec);
    saveNow();
    return rec.id;
  }
  function deleteProject(id) {
    var n = liveCount(data.entries, function (x) { return x.p === id; });
    if (n) { showToast(t("toast.projBusy", { n: n })); return false; }
    var cur = findIn(data.projects, id);
    if (!cur) return true;
    var snap = JSON.parse(JSON.stringify(cur));
    replaceIn(data.projects, { id: id, m: stamp(cur.m), del: 1 });
    saveNow();
    renderAll();
    undoToast(t("toast.projDel"), function () {
      var c = findIn(data.projects, id);
      snap.m = stamp(c ? c.m : snap.m);
      replaceIn(data.projects, snap);
      saveNow();
      renderAll();
    });
    return true;
  }
  function saveClient(id, rec) {
    var cur = id ? findIn(data.clients, id) : null;
    if (cur && !cur.del) {
      if (cur.name === rec.name && cur.rate === rec.rate) return cur.id;
      rec.id = cur.id;
      rec.m = stamp(cur.m);
    } else {
      rec.id = newId();
      rec.m = Date.now();
    }
    replaceIn(data.clients, rec);
    saveNow();
    return rec.id;
  }
  function deleteClient(id) {
    var n = liveCount(data.projects, function (p) { return p.client === id; });
    if (n) { showToast(t("toast.cliBusy", { n: n })); return false; }
    var cur = findIn(data.clients, id);
    if (!cur) return true;
    var snap = JSON.parse(JSON.stringify(cur));
    replaceIn(data.clients, { id: id, m: stamp(cur.m), del: 1 });
    saveNow();
    renderAll();
    undoToast(t("toast.cliDel"), function () {
      var c = findIn(data.clients, id);
      snap.m = stamp(c ? c.m : snap.m);
      replaceIn(data.clients, snap);
      saveNow();
      renderAll();
    });
    return true;
  }
  function setPrefs(next) {
    var p = C.normPrefs(next);
    if (JSON.stringify(p) === JSON.stringify(data.prefs)) return;
    data.prefs = p;
    data.pm = stamp(data.pm);
    saveNow();
  }
  // Invoiced marks on a set of entries; Undo puts each one back.
  function markBilled(ids, flag) {
    var changed = [];
    ids.forEach(function (id) {
      var x = findEntry(id);
      if (!x || x.billed === flag) return;
      x.billed = flag;
      x.m = stamp(x.m);
      changed.push(id);
    });
    if (!changed.length) return;
    saveNow();
    renderAll();
    undoToast(t(flag ? "toast.marked" : "toast.unmarked", { n: changed.length }), function () {
      changed.forEach(function (id) {
        var x = findEntry(id);
        if (!x) return;
        x.billed = flag ? 0 : 1;
        x.m = stamp(x.m);
      });
      saveNow();
      renderAll();
    });
  }

  // ---------- 4. Render: timer + day ----------
  function dayLabel(key) {
    var tk = todayKey();
    if (key === tk) return t("today");
    if (key === C.addDays(tk, -1)) return t("yesterday");
    try {
      return new Intl.DateTimeFormat(locale(), { weekday: "short", day: "numeric", month: "short" })
        .format(C.keyDate(key));
    } catch (e) { return key; }
  }
  function shortDate(key) {
    try {
      return new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short" }).format(C.keyDate(key));
    } catch (e) { return key; }
  }

  // Options: "No project", then live projects grouped by client.
  function fillProjectSelect(sel, current, withArchived) {
    sel.innerHTML = "";
    var none = el("option", "", t("noProject"));
    none.value = "";
    sel.appendChild(none);
    var groups = {}, order = [];
    C.live(data.projects).forEach(function (p) {
      if (p.arch && !withArchived && p.id !== current) return;
      var c = C.client(data, p.client), k = c ? c.id : "";
      if (!groups[k]) { groups[k] = { c: c, list: [] }; order.push(k); }
      groups[k].list.push(p);
    });
    order.sort(function (a, b) {
      if (!a) return -1; if (!b) return 1;
      return groups[a].c.name.localeCompare(groups[b].c.name, locale());
    });
    order.forEach(function (k) {
      var g = groups[k], host = sel;
      if (g.c) { host = el("optgroup"); host.label = g.c.name; sel.appendChild(host); }
      g.list.sort(function (a, b) { return a.name.localeCompare(b.name, locale()); });
      g.list.forEach(function (p) {
        var o = el("option", "", p.name);
        o.value = p.id;
        host.appendChild(o);
      });
    });
    if (current && !C.project(data, current)) {
      var gone = el("option", "", t("goneProject"));
      gone.value = current;
      sel.appendChild(gone);
    }
    sel.value = current || "";
    if (sel.value !== (current || "")) sel.value = "";
  }

  function renderRun() {
    var now = Date.now(), run = C.running(data), x = run[0] || null;
    var btn = $("run-btn"), card = $("run-card");
    card.classList.toggle("on", !!x);
    btn.innerHTML = (x ? UI.stop : UI.play) + "<span></span>";
    btn.lastChild.textContent = t(x ? "run.stop" : "run.start");
    btn.setAttribute("aria-pressed", x ? "true" : "false");
    var sel = $("run-proj"), desc = $("run-desc");
    var pid = x ? x.p : (draft.p || prefs.lastP);
    if (document.activeElement !== sel) fillProjectSelect(sel, C.project(data, pid) || (x && x.p) ? pid : "", false);
    if (document.activeElement !== desc && !descTimer) desc.value = x ? x.desc : draft.desc;
    sel.style.setProperty("--dot", projColor(sel.value));
    tickRun(now);

    var others = $("others");
    others.innerHTML = "";
    others.hidden = run.length < 2;
    if (run.length > 1) {
      others.appendChild(el("li", "o-head", t("run.others", { n: run.length })));
      run.forEach(function (r) {
        var li = el("li", "o-row");
        var dot = el("i", "dot");
        dot.style.background = projColor(r.p);
        li.appendChild(dot);
        li.appendChild(el("span", "o-name", projLabel(r.p) + (r.desc ? " · " + r.desc : "")));
        li.appendChild(el("span", "o-dur", dur(now - r.s)));
        var b = el("button", "mini-btn", t("run.stopOne"));
        b.type = "button";
        b.addEventListener("click", function () { stopOne(r.id); });
        li.appendChild(b);
        others.appendChild(li);
      });
    }
    renderForgot(now);
  }
  function tickRun(now) {
    var x = C.running(data)[0] || null;
    $("run-clock").textContent = x ? C.fmtDur(now - x.s, true) : "0:00:00";
    var since = "";
    if (x) {
      var k = C.dayKeyOf(x.s);
      since = k === todayKey() ? t("run.since", { t: C.hhmm(x.s) }) : t("run.sinceDay", { d: shortDate(k), t: C.hhmm(x.s) });
    } else since = t("run.idle");
    $("run-since").textContent = since;
  }
  function renderForgot(now) {
    var x = C.running(data)[0] || null, box = $("forgot");
    var show = !!x && now - x.s >= FORGOT_MS && !forgotOk[x.id];
    box.hidden = !show;
    if (show) $("forgot-text").textContent = t("forgot", { d: dur(now - x.s) });
  }

  function renderDay() {
    var now = Date.now(), tk = todayKey();
    if (dayKey > tk) dayKey = tk;
    $("day-btn").textContent = dayLabel(dayKey);
    $("day-btn").classList.toggle("is-today", dayKey === tk);
    $("next-btn").disabled = dayKey >= tk;
    var total = C.dayTotals(data, dayKey, dayKey, now)[dayKey] || 0;
    $("day-total").textContent = t("day.total", { d: dur(total) });
    var goal = data.prefs.goal * 60000, gb = $("goal");
    gb.hidden = !goal;
    if (goal) {
      $("goal-fill").style.width = Math.min(100, Math.round(total / goal * 100)) + "%";
      gb.classList.toggle("met", total >= goal);
      gb.title = t("goal.of", { d: dur(total), g: dur(goal) });
      $("day-total").textContent = t("goal.of", { d: dur(total), g: dur(goal) });
    }
    var host = $("entries"), list = C.dayEntries(data, dayKey, now).reverse();
    host.innerHTML = "";
    var lo = C.dayStart(dayKey), hi = C.dayStart(C.addDays(dayKey, 1));
    list.forEach(function (x) {
      var li = el("li", "ent" + (x.e === 0 ? " running" : ""));
      var b = el("button", "ent-main");
      b.type = "button";
      var dot = el("i", "dot");
      dot.style.background = projColor(x.p);
      b.appendChild(dot);
      var txt = el("span", "ent-txt");
      var c = C.projectClient(data, C.project(data, x.p));
      txt.appendChild(el("span", "ent-p", projLabel(x.p) + (c ? " · " + c.name : "")));
      if (x.desc) txt.appendChild(el("span", "ent-d", x.desc));
      b.appendChild(txt);
      var end = C.endOf(x, now);
      var range = (x.s < lo ? "‹ " : "") + C.hhmm(x.s) + "–" + (x.e === 0 ? t("entry.running") : C.hhmm(end)) + (end > hi ? " ›" : "");
      var meta = el("span", "ent-meta");
      meta.appendChild(el("span", "ent-r", range));
      var ms = Math.min(end, hi) - Math.max(x.s, lo);
      meta.appendChild(el("span", "ent-dur", dur(ms)));
      if (x.billed) {
        var bl = el("span", "ent-billed");
        bl.innerHTML = UI.check;
        bl.title = t("entry.billed");
        bl.setAttribute("aria-label", t("entry.billed"));
        meta.appendChild(bl);
      }
      b.appendChild(meta);
      b.setAttribute("aria-label", t("entry.edit", { p: projLabel(x.p), a: range + ", " + dur(ms) }));
      b.addEventListener("click", function () { entryDialog(x.id, null); });
      li.appendChild(b);
      if (x.e !== 0) {
        var r = el("button", "icon-btn ent-go");
        r.type = "button";
        r.innerHTML = UI.play;
        r.setAttribute("aria-label", t("entry.resume", { p: projLabel(x.p) }));
        r.title = r.getAttribute("aria-label");
        r.addEventListener("click", function () { resume(x); });
        li.appendChild(r);
      }
      host.appendChild(li);
    });
    $("entries-empty").hidden = list.length > 0;
  }

  // ---------- 5. Render: week ----------
  function renderWeek() {
    var now = Date.now(), tk = todayKey();
    var thisMon = C.weekStart(tk);
    if (weekKey > thisMon) weekKey = thisMon;
    var sun = C.addDays(weekKey, 6);
    $("week-btn").textContent = weekKey === thisMon ? t("thisWeek") : shortDate(weekKey) + " – " + shortDate(sun);
    $("week-btn").classList.toggle("is-today", weekKey === thisMon);
    $("wnext-btn").disabled = weekKey >= thisMon;
    var g = C.weekGrid(data, weekKey, now);
    $("week-total").textContent = t("day.total", { d: dur(g.total) });
    var dayName = function (k, style) {
      try { return new Intl.DateTimeFormat(locale(), { weekday: style }).format(C.keyDate(k)); } catch (e) { return k; }
    };

    // Desktop: project × day table
    var wrap = $("week-grid");
    wrap.innerHTML = "";
    var tbl = el("table", "wk");
    var thead = el("thead"), hr = el("tr");
    hr.appendChild(el("th", "wk-p", t("week.project")));
    g.keys.forEach(function (k) {
      var th = el("th", k === tk ? "today" : "");
      var b = el("button", "wk-day");
      b.type = "button";
      b.appendChild(el("span", "", dayName(k, "short")));
      b.appendChild(el("small", "", String(+k.slice(8))));
      b.disabled = k > tk;
      b.addEventListener("click", function () { goDay(k); setTab("timer"); });
      th.appendChild(b);
      hr.appendChild(th);
    });
    hr.appendChild(el("th", "wk-t", t("week.total")));
    thead.appendChild(hr);
    tbl.appendChild(thead);
    var tb = el("tbody");
    g.rows.forEach(function (r) {
      var tr = el("tr");
      var th = el("th", "wk-p");
      var dot = el("i", "dot");
      dot.style.background = projColor(r.p);
      th.appendChild(dot);
      th.appendChild(el("span", "", projLabel(r.p)));
      tr.appendChild(th);
      r.days.forEach(function (ms, i) { tr.appendChild(el("td", g.keys[i] === tk ? "today" : "", ms ? dur(ms) : "")); });
      tr.appendChild(el("td", "wk-t", dur(r.total)));
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    var tf = el("tfoot"), fr = el("tr");
    fr.appendChild(el("th", "wk-p", t("week.total")));
    g.cols.forEach(function (ms, i) { fr.appendChild(el("td", g.keys[i] === tk ? "today" : "", ms ? dur(ms) : "")); });
    fr.appendChild(el("td", "wk-t", dur(g.total)));
    tf.appendChild(fr);
    tbl.appendChild(tf);
    wrap.appendChild(tbl);
    wrap.hidden = !g.rows.length;

    // Phone: one card per day
    var list = $("week-list");
    list.innerHTML = "";
    if (g.rows.length) {
      g.keys.forEach(function (k, i) {
        if (!g.cols[i]) return;
        var card = el("button", "wl-day" + (k === tk ? " today" : ""));
        card.type = "button";
        var head = el("div", "wl-head");
        head.appendChild(el("span", "", dayName(k, "long") + " " + shortDate(k)));
        head.appendChild(el("span", "wl-sum", dur(g.cols[i])));
        card.appendChild(head);
        g.rows.forEach(function (r) {
          if (!r.days[i]) return;
          var row = el("div", "wl-row");
          var dot = el("i", "dot");
          dot.style.background = projColor(r.p);
          row.appendChild(dot);
          row.appendChild(el("span", "wl-name", projLabel(r.p)));
          row.appendChild(el("span", "", dur(r.days[i])));
          card.appendChild(row);
        });
        card.addEventListener("click", function () { goDay(k); setTab("timer"); });
        list.appendChild(card);
      });
    }
    list.hidden = !g.rows.length;
    $("week-empty").hidden = g.rows.length > 0;
  }

  // ---------- 6. Render: report ----------
  function rangeKeys() {
    var tk = todayKey(), r = prefs.rep;
    switch (r.range) {
      case "thisWeek": return [C.weekStart(tk), C.addDays(C.weekStart(tk), 6)];
      case "lastWeek": var lm = C.addDays(C.weekStart(tk), -7); return [lm, C.addDays(lm, 6)];
      case "lastMonth": var pm = C.addDays(C.monthStart(tk), -1); return [C.monthStart(pm), C.monthEnd(pm)];
      case "thisYear": return [tk.slice(0, 4) + "-01-01", tk.slice(0, 4) + "-12-31"];
      case "custom":
        var f = r.from || C.monthStart(tk), to = r.to || tk;
        return f <= to ? [f, to] : [to, f];
      default: return [C.monthStart(tk), C.monthEnd(tk)];
    }
  }
  function filterObj() {
    var r = prefs.rep;
    return { client: r.client, project: r.project, bill: r.bill, billed: r.billed, group: r.group };
  }
  function fillSelect(sel, opts, value) {
    sel.innerHTML = "";
    opts.forEach(function (o) {
      var op = el("option", "", o[1]);
      op.value = o[0];
      sel.appendChild(op);
    });
    sel.value = value;
    if (sel.value !== value) sel.selectedIndex = 0;
    return sel.value;
  }
  function renderFilters() {
    var r = prefs.rep;
    fillSelect($("f-range"), RANGES.map(function (k) { return [k, t("range." + k)]; }), r.range);
    var keys = rangeKeys();
    $("f-from").value = keys[0];
    $("f-to").value = keys[1];
    $("f-from-w").hidden = $("f-to-w").hidden = r.range !== "custom";
    var cl = [["", t("allClients")], ["-", t("noClient")]];
    C.live(data.clients).sort(function (a, b) { return a.name.localeCompare(b.name, locale()); })
      .forEach(function (c) { cl.push([c.id, c.name]); });
    r.client = fillSelect($("f-client"), cl, r.client);
    var pl = [["", t("allProjects")], ["-", t("noProject")]];
    C.live(data.projects).filter(function (p) {
      return !r.client || (r.client === "-" ? !C.client(data, p.client) : p.client === r.client);
    }).sort(function (a, b) { return a.name.localeCompare(b.name, locale()); })
      .forEach(function (p) { pl.push([p.id, p.name]); });
    r.project = fillSelect($("f-project"), pl, r.project);
    r.bill = fillSelect($("f-bill"), [["", t("all")], ["bill", t("bill.bill")], ["non", t("bill.non")]], r.bill);
    r.billed = fillSelect($("f-billed"), [["", t("all")], ["open", t("billed.open")], ["done", t("billed.done")]], r.billed);
    r.group = fillSelect($("f-group"), [["project", t("group.project")], ["client", t("group.client")], ["day", t("group.day")]], r.group);
  }
  function groupLabel(key) {
    var g = prefs.rep.group;
    if (g === "day") return dayLabel(key);
    if (g === "client") { var c = C.client(data, key); return c ? c.name : t("noClient"); }
    return projLabel(key);
  }
  var repState = null;
  function renderReport() {
    var now = Date.now(), keys = rangeKeys(), f = filterObj();
    var rep = C.report(data, keys[0], keys[1], f, now);
    repState = { keys: keys, f: f, rep: rep };
    var p = data.prefs, note = p.round
      ? t("rep.noteRound", { n: p.round, mode: t(p.rup ? "rep.up" : "rep.near") })
      : t("rep.noteExact");
    var runIn = C.running(data).some(function (x) { return rep.ids.indexOf(x.id) >= 0; });
    $("rep-note").textContent = note + (runIn ? " " + t("rep.running") : "");

    var tbl = $("rep-table");
    tbl.innerHTML = "";
    var showMoney = rep.total.amount > 0;
    var thead = el("thead"), hr = el("tr");
    hr.appendChild(el("th", "r-name", t("group." + f.group)));
    hr.appendChild(el("th", "num", t("col.hours")));
    hr.appendChild(el("th", "num r-bill", t("col.bill")));
    if (showMoney) hr.appendChild(el("th", "num", t("col.amount")));
    thead.appendChild(hr);
    tbl.appendChild(thead);
    var tb = el("tbody");
    rep.rows.forEach(function (r) {
      var tr = el("tr");
      var th = el("th", "r-name");
      if (f.group === "project") {
        var dot = el("i", "dot");
        dot.style.background = projColor(r.key);
        th.appendChild(dot);
      }
      th.appendChild(el("span", "", groupLabel(r.key)));
      tr.appendChild(th);
      var h = el("td", "num");
      h.appendChild(el("span", "", dur(r.ms)));
      h.appendChild(el("small", "", hours(r.ms)));
      tr.appendChild(h);
      tr.appendChild(el("td", "num r-bill", r.billMs ? dur(r.billMs) : "–"));
      if (showMoney) tr.appendChild(el("td", "num", r.amount ? money(r.amount) : "–"));
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    var tf = el("tfoot"), fr = el("tr");
    fr.appendChild(el("th", "r-name", t("col.total")));
    var th2 = el("td", "num");
    th2.appendChild(el("span", "", dur(rep.total.ms)));
    th2.appendChild(el("small", "", hours(rep.total.ms)));
    fr.appendChild(th2);
    fr.appendChild(el("td", "num r-bill", rep.total.billMs ? dur(rep.total.billMs) : "–"));
    if (showMoney) fr.appendChild(el("td", "num", money(rep.total.amount)));
    tf.appendChild(fr);
    tbl.appendChild(tf);
    tbl.hidden = !rep.rows.length;
    $("rep-empty").hidden = rep.rows.length > 0;
    $("rep-csv").disabled = !rep.rows.length;

    // Invoiced marks: in an "Invoiced" view the button undoes them.
    var mark = $("rep-mark");
    if (f.billed === "done") {
      repState.markIds = rep.ids;
      repState.markFlag = 0;
      mark.textContent = t("rep.unmark", { n: rep.ids.length });
      mark.disabled = !rep.ids.length;
    } else {
      var open = C.report(data, keys[0], keys[1],
        { client: f.client, project: f.project, bill: "bill", billed: "open", group: f.group }, now).ids;
      open = open.filter(function (id) { var x = findEntry(id); return x && x.e !== 0; });
      repState.markIds = open;
      repState.markFlag = 1;
      mark.textContent = open.length ? t("rep.mark", { n: open.length }) : t("rep.markNone");
      mark.disabled = !open.length;
    }
  }

  // ---------- 7. Render: projects ----------
  function projTotals() {
    var now = Date.now(), out = {};
    data.entries.forEach(function (x) {
      if (x.del) return;
      out[x.p] = (out[x.p] || 0) + (C.endOf(x, now) - x.s);
    });
    return out;
  }
  function projRow(p, totals) {
    var b = el("button", "p-row");
    b.type = "button";
    var dot = el("i", "dot");
    dot.style.background = C.COLORS[p.color];
    b.appendChild(dot);
    var txt = el("span", "p-txt");
    txt.appendChild(el("span", "p-name", p.name));
    var bits = [];
    if (!p.bill) bits.push(t("proj.nobill"));
    else {
      var rate = C.rateOf(data, p.id);
      if (rate) bits.push(t("proj.rate", { r: money(rate) }));
    }
    if (totals[p.id]) bits.push(t("proj.total", { d: dur(totals[p.id]) }));
    if (bits.length) txt.appendChild(el("span", "p-sub", bits.join(" · ")));
    b.appendChild(txt);
    b.addEventListener("click", function () { projectDialog(p.id); });
    return b;
  }
  function renderProjects() {
    var totals = projTotals(), host = $("plist"), arch = $("parch-list");
    host.innerHTML = "";
    arch.innerHTML = "";
    var clients = C.live(data.clients).sort(function (a, b) { return a.name.localeCompare(b.name, locale()); });
    var projects = C.live(data.projects).sort(function (a, b) { return a.name.localeCompare(b.name, locale()); });
    var nArch = 0;
    function group(c) {
      var box = el("section", "p-group");
      var head = el("div", "p-head");
      if (c) {
        var hb = el("button", "p-client");
        hb.type = "button";
        hb.appendChild(el("span", "", c.name));
        if (c.rate) hb.appendChild(el("small", "", t("proj.rate", { r: money(c.rate) })));
        hb.addEventListener("click", function () { clientDialog(c.id); });
        head.appendChild(hb);
      } else head.appendChild(el("span", "p-client plain", t("noClient")));
      box.appendChild(head);
      var mine = projects.filter(function (p) { return c ? p.client === c.id : !C.client(data, p.client); });
      var shown = 0;
      mine.forEach(function (p) {
        if (p.arch) { nArch++; arch.appendChild(projRow(p, totals)); return; }
        box.appendChild(projRow(p, totals));
        shown++;
      });
      if (c || shown) host.appendChild(box);
      if (c && !shown) {
        var add = el("button", "mini-btn p-add", t("add.project"));
        add.type = "button";
        add.addEventListener("click", function () { projectDialog(null, c.id); });
        box.appendChild(add);
      }
    }
    group(null);
    clients.forEach(group);
    $("plist-empty").hidden = projects.length > 0 || clients.length > 0;
    $("parch").hidden = !nArch;
    $("parch-sum").textContent = t("proj.archived", { n: nArch });
  }

  var tab = "timer";
  function setTab(name) {
    tab = TABS.indexOf(name) >= 0 ? name : "timer";
    prefs.tab = tab;
    savePrefs();
    TABS.forEach(function (k) {
      var b = $("tab-" + k), on = k === tab;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
      $("v-" + k).hidden = !on;
    });
    renderTab();
    $("main").scrollTop = 0;
  }
  function renderTab() {
    if (tab === "timer") { renderRun(); renderDay(); }
    else if (tab === "week") renderWeek();
    else if (tab === "report") { renderFilters(); renderReport(); }
    else renderProjects();
  }
  function renderAll() { renderTab(); }

  function goDay(key) {
    var tk = todayKey();
    dayKey = key > tk ? tk : key;
    if (tab === "timer") { renderRun(); renderDay(); }
  }
  function shiftDay(n) { goDay(C.addDays(dayKey, n)); }
  function shiftWeek(n) { weekKey = C.addDays(weekKey, 7 * n); renderWeek(); }

  // ---------- 8. Dialogs ----------
  function makeDialog(id, title) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "mm-dlg";
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () {
      parkToast();
      setTimeout(function () { dlg.remove(); }, 0);
    });
    dlg.appendChild(el("div", "dlg-title", title));
    return dlg;
  }
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function field(labelText, input, note) {
    var w = el("div", "fld");
    var lab = el("label", "dlg-lbl", labelText);
    if (!input.id) input.id = "f-" + newId();
    lab.setAttribute("for", input.id);
    w.appendChild(lab);
    w.appendChild(input);
    if (note) w.appendChild(el("p", "hint", note));
    return w;
  }
  function input(type, value) {
    var i = el("input");
    i.type = type;
    i.value = value === null || value === undefined ? "" : String(value);
    return i;
  }
  function checkRow(labelText, checked) {
    var lab = el("label", "check");
    var box = el("input");
    box.type = "checkbox";
    box.checked = !!checked;
    lab.appendChild(box);
    lab.appendChild(el("span", "", labelText));
    return { row: lab, box: box };
  }
  function actions(form, left, okLabel) {
    var acts = el("div", "dlg-actions");
    (left || []).forEach(function (b) { acts.appendChild(b); });
    acts.appendChild(el("span", "spacer"));
    acts.appendChild(button(t("dlg.cancel"), "", function () { form.closest("dialog").close(); }));
    var ok = button(okLabel || t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
  }
  function openDialog(dlg, focus) {
    document.body.appendChild(dlg);
    dlg.showModal();
    if (focus) { focus.focus(); if (focus.select) try { focus.select(); } catch (e) {} }
  }
  // date "YYYY-MM-DD" + time "HH:MM" → local ms, NaN when invalid.
  function readStamp(dateIn, timeIn) {
    if (!C.validDay(dateIn.value)) return NaN;
    var m = /^(\d{1,2}):(\d{2})/.exec(String(timeIn.value));
    if (!m || +m[1] > 23 || +m[2] > 59) return NaN;
    var d = C.keyDate(dateIn.value);
    d.setHours(+m[1], +m[2], 0, 0);
    return d.getTime();
  }
  // Where a new entry on `key` ends by default: now on today, else
  // an hour after the day's last entry (or 10:00). Typing a duration
  // moves the start back from it, so nothing lands in the future.
  function defaultEnd(key) {
    var now = Date.now(), last = 0;
    if (key === todayKey()) return now - now % 60000;
    C.dayEntries(data, key, now).forEach(function (x) { last = Math.max(last, C.endOf(x, now)); });
    var e = last && C.dayKeyOf(last) === key ? last + C.HOUR : C.dayStart(key) + 10 * C.HOUR;
    e = Math.min(e, C.dayStart(C.addDays(key, 1)) - 60000);
    return e - e % 60000;
  }

  function entryDialog(id, preset) {
    var x = id ? findEntry(id) : null;
    if (id && !x) return;
    // preset.stop: a running entry opened to set its end ("forgot").
    var stopping = !!(x && x.e === 0 && preset && preset.stop);
    var isNew = !x, running = !!(x && x.e === 0 && !stopping);
    var dlg = makeDialog("ts-entry", t(isNew ? "dlg.newEntry" : "dlg.entry"));
    dlg.classList.add("wide");
    var form = el("form");
    form.method = "dialog";

    var sel = el("select");
    fillProjectSelect(sel, x ? x.p : (preset && preset.p) || prefs.lastP || "", false);
    form.appendChild(field(t("f.project"), sel));
    var desc = input("text", x ? x.desc : "");
    desc.maxLength = C.LIM.desc;
    form.appendChild(field(t("f.desc"), desc));

    var e0 = x ? (running ? 0 : (x.e || Math.max(Date.now(), x.s + 60000))) : defaultEnd(dayKey);
    var s0 = x ? x.s : Math.max(C.dayStart(dayKey), e0 - C.HOUR);
    var sd = input("date", C.dayKeyOf(s0)), st = input("time", C.hhmm(s0));
    var r1 = el("div", "fld-row");
    r1.appendChild(field(t("f.sdate"), sd));
    r1.appendChild(field(t("f.stime"), st));
    form.appendChild(r1);
    var ed = input("date", e0 ? C.dayKeyOf(e0) : ""), et = input("time", e0 ? C.hhmm(e0) : "");
    var du = input("text", e0 ? C.fmtDur(e0 - s0) : "");
    du.inputMode = "decimal";
    du.autocomplete = "off";
    var r2 = el("div", "fld-row");
    r2.appendChild(field(t("f.edate"), ed));
    r2.appendChild(field(t("f.etime"), et));
    var durF = field(t("f.dur"), du, t("f.durHint"));
    if (running) form.appendChild(el("p", "hint run-note", t("f.running")));
    else { form.appendChild(r2); form.appendChild(durF); }

    // The duration and the end follow each other.
    function syncDur() {
      var s = readStamp(sd, st), e = readStamp(ed, et);
      if (!isNaN(s) && !isNaN(e) && e > s) du.value = C.fmtDur(e - s);
    }
    // New entry, start untouched: the duration moves the start back
    // from the end; otherwise it moves the end on from the start.
    var startTouched = !isNew;
    function syncEnd() {
      var s = readStamp(sd, st), e = readStamp(ed, et), m = C.parseDuration(du.value);
      if (isNaN(m) || m <= 0) return;
      if (!startTouched && !isNaN(e)) {
        s = e - m * 60000;
        sd.value = C.dayKeyOf(s);
        st.value = C.hhmm(s);
        return;
      }
      if (isNaN(s)) return;
      e = s + m * 60000;
      ed.value = C.dayKeyOf(e);
      et.value = C.hhmm(e);
    }
    [ed, et].forEach(function (n) { n.addEventListener("change", syncDur); });
    du.addEventListener("change", syncEnd);
    [sd, st].forEach(function (n) {
      n.addEventListener("change", function () {
        startTouched = true;
        if (C.parseDuration(du.value) > 0) syncEnd(); else syncDur();
      });
    });

    var billed = checkRow(t("f.billed"), x ? x.billed : 0);
    if (!running) form.appendChild(billed.row);

    var left = [];
    if (!isNew) left.push(button(t("dlg.del"), "danger", function () { dlg.close(); deleteEntry(id); }));
    if (running) left.push(button(t("dlg.stop"), "", function () { dlg.close(); stopOne(id); }));
    actions(form, left, isNew ? t("dlg.add") : t("dlg.save"));

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var s = readStamp(sd, st);
      if (isNaN(s)) { showToast(t("toast.badTime")); st.focus(); return; }
      var e = 0;
      if (!running) {
        if (document.activeElement === du || (!et.value && du.value)) syncEnd();
        e = readStamp(ed, et);
        if (isNaN(e) && du.value) {
          var m = C.parseDuration(du.value);
          if (isNaN(m) || m <= 0) { showToast(t("toast.badDur")); du.focus(); return; }
          e = s + m * 60000;
        }
        if (isNaN(e) || e <= s) { showToast(t("toast.badTime")); et.focus(); return; }
        if (e - s > C.MAX_SPAN) { showToast(t("toast.tooLong")); et.focus(); return; }
      } else if (s >= Date.now()) { showToast(t("toast.badTime")); st.focus(); return; }
      var rec = {
        p: sel.value, desc: C.cleanText(desc.value, C.LIM.desc), s: s, e: e,
        billed: running ? 0 : (billed.box.checked ? 1 : 0)
      };
      var cur = isNew ? null : findEntry(id);
      if (!isNew && !cur) { dlg.close(); return; }          // deleted elsewhere meanwhile
      if (!isNew && cur.e !== 0 && running) { dlg.close(); renderAll(); return; }   // stopped elsewhere
      dlg.close();
      var saved;
      if (isNew) {
        saved = addEntry(rec);
        undoToast(t("toast.added", { d: dur(rec.e - rec.s) }), function () { deleteSilently(saved.id); });
      } else saved = editEntry(id, rec);
      prefs.lastP = rec.p;
      savePrefs();
      if (saved && C.overlaps(data, saved, Date.now()).length && !isNew) showToast(t("toast.overlap"));
      if (isNew) dayKey = C.dayKeyOf(rec.s) > todayKey() ? todayKey() : C.dayKeyOf(rec.s);
      renderAll();
    });
    dlg.appendChild(form);
    openDialog(dlg, isNew ? du : null);
  }
  function deleteSilently(id) {
    var x = findEntry(id);
    if (!x) return;
    replaceIn(data.entries, { id: id, m: stamp(x.m), del: 1 });
    saveNow();
    renderAll();
  }

  function rateHint(rateIn, clientId) {
    var c = clientId ? C.client(data, clientId) : null;
    if (c && c.rate) return t("f.rateHint", { r: money(c.rate), src: t("src.client") });
    if (data.prefs.rate) return t("f.rateHint", { r: money(data.prefs.rate), src: t("src.default") });
    return t("f.rateNone");
  }
  function moneyIn(cents) {
    var i = input("text", C.moneyInput(cents, LANG));
    i.inputMode = "decimal";
    i.autocomplete = "off";
    i.placeholder = "0";
    return i;
  }

  function projectDialog(id, presetClient) {
    var p = id ? C.project(data, id) : null;
    if (id && !p) return;
    var dlg = makeDialog("ts-project", t(p ? "dlg.project" : "dlg.newProject"));
    dlg.classList.add("wide");
    var form = el("form");
    form.method = "dialog";
    var name = input("text", p ? p.name : "");
    name.maxLength = C.LIM.name;
    form.appendChild(field(t("f.name"), name));
    var cli = el("select");
    var opts = [["", t("noClient")]];
    C.live(data.clients).sort(function (a, b) { return a.name.localeCompare(b.name, locale()); })
      .forEach(function (c) { opts.push([c.id, c.name]); });
    fillSelect(cli, opts, p ? p.client : (presetClient || ""));
    form.appendChild(field(t("f.client"), cli));

    var colorBox = el("div", "swatches");
    colorBox.setAttribute("role", "radiogroup");
    var color = p ? p.color : (C.live(data.projects).length % C.COLORS.length);
    var group = "c-" + newId();
    C.COLORS.forEach(function (hex, i) {
      var lab = el("label", "sw");
      var r = el("input");
      r.type = "radio";
      r.name = group;
      r.value = String(i);
      r.checked = i === color;
      r.setAttribute("aria-label", t("f.color") + " " + (i + 1));
      var chip = el("span", "");
      chip.style.background = hex;
      lab.appendChild(r);
      lab.appendChild(chip);
      colorBox.appendChild(lab);
    });
    var cw = el("div", "fld");
    cw.appendChild(el("div", "dlg-lbl", t("f.color")));
    cw.appendChild(colorBox);
    form.appendChild(cw);

    var rate = moneyIn(p ? p.rate : 0);
    var rateF = field(t("f.rate") + " (" + data.prefs.cur + ")", rate, rateHint(rate, cli.value));
    form.appendChild(rateF);
    cli.addEventListener("change", function () { rateF.lastChild.textContent = rateHint(rate, cli.value); });
    var bill = checkRow(t("f.billable"), p ? p.bill : 1);
    form.appendChild(bill.row);
    var arch = checkRow(t("f.archived"), p ? p.arch : 0);
    if (p) form.appendChild(arch.row);

    var left = [];
    if (p) left.push(button(t("dlg.del"), "danger", function () { if (deleteProject(id)) dlg.close(); }));
    actions(form, left, p ? t("dlg.save") : t("dlg.add"));
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var nm = C.cleanText(name.value, C.LIM.name);
      if (!nm) { showToast(t("toast.badName")); name.focus(); return; }
      var cents = C.parseMoney(rate.value);
      if (isNaN(cents) || !C.inRange(cents, C.LIM.rate)) { showToast(t("toast.badMoney")); rate.focus(); return; }
      var picked = colorBox.querySelector("input:checked");
      if (id && !C.project(data, id)) { dlg.close(); return; }    // deleted elsewhere meanwhile
      var newPid = saveProject(id, {
        name: nm, client: cli.value, color: picked ? +picked.value : 0, rate: cents,
        bill: bill.box.checked ? 1 : 0, arch: p && arch.box.checked ? 1 : 0
      });
      dlg.close();
      if (!id && !C.running(data).length) { draft.p = newPid; prefs.lastP = newPid; savePrefs(); }
      renderAll();
      showToast(t("toast.saved"));
    });
    dlg.appendChild(form);
    openDialog(dlg, p ? null : name);
  }

  function clientDialog(id) {
    var c = id ? C.client(data, id) : null;
    if (id && !c) return;
    var dlg = makeDialog("ts-client", t(c ? "dlg.client" : "dlg.newClient"));
    var form = el("form");
    form.method = "dialog";
    var name = input("text", c ? c.name : "");
    name.maxLength = C.LIM.name;
    form.appendChild(field(t("f.name"), name));
    var rate = moneyIn(c ? c.rate : 0);
    form.appendChild(field(t("f.rate") + " (" + data.prefs.cur + ")", rate,
      data.prefs.rate ? t("f.rateHint", { r: money(data.prefs.rate), src: t("src.default") }) : t("f.rateNone")));
    var left = [];
    if (c) left.push(button(t("dlg.del"), "danger", function () { if (deleteClient(id)) dlg.close(); }));
    actions(form, left, c ? t("dlg.save") : t("dlg.add"));
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var nm = C.cleanText(name.value, C.LIM.name);
      if (!nm) { showToast(t("toast.badName")); name.focus(); return; }
      var cents = C.parseMoney(rate.value);
      if (isNaN(cents) || !C.inRange(cents, C.LIM.rate)) { showToast(t("toast.badMoney")); rate.focus(); return; }
      if (id && !C.client(data, id)) { dlg.close(); return; }
      saveClient(id, { name: nm, rate: cents });
      dlg.close();
      renderAll();
      showToast(t("toast.saved"));
    });
    dlg.appendChild(form);
    openDialog(dlg, c ? null : name);
  }

  function settingsDialog() {
    var p = data.prefs;
    var dlg = makeDialog("ts-settings", t("dlg.settings"));
    dlg.classList.add("wide");
    var form = el("form");
    form.method = "dialog";
    var cur = el("select");
    fillSelect(cur, C.CURRENCIES.map(function (c) { return [c, c]; }), p.cur);
    var rate = moneyIn(p.rate);
    var r1 = el("div", "fld-row");
    r1.appendChild(field(t("f.cur"), cur));
    r1.appendChild(field(t("f.defRate"), rate));
    form.appendChild(r1);
    var goal = input("text", p.goal ? C.fmtDur(p.goal * 60000) : "");
    goal.inputMode = "decimal";
    goal.placeholder = "8:00";
    form.appendChild(field(t("f.goal"), goal, t("f.goalHint")));
    var round = el("select");
    fillSelect(round, C.ROUNDS.map(function (n) { return [String(n), n ? t("round.n", { n: n }) : t("round.off")]; }), String(p.round));
    var mode = el("select");
    fillSelect(mode, [["1", t("round.up")], ["0", t("round.near")]], String(p.rup));
    var r2 = el("div", "fld-row");
    r2.appendChild(field(t("f.round"), round));
    r2.appendChild(field(t("f.roundMode"), mode));
    form.appendChild(r2);
    form.appendChild(el("p", "hint", t("f.roundHint")));

    form.appendChild(el("h3", "dlg-h", t("set.data")));
    var bk = button(t("set.backup"), "block", exportBackup);
    form.appendChild(bk);
    var rs = button(t("set.restore"), "block", function () { dlg.close(); restoreBackup(); });
    form.appendChild(rs);
    form.appendChild(el("p", "hint", t("set.restoreHint")));

    actions(form, [], t("dlg.save"));
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var cents = C.parseMoney(rate.value);
      if (isNaN(cents) || !C.inRange(cents, C.LIM.rate)) { showToast(t("toast.badMoney")); rate.focus(); return; }
      var g = String(goal.value).trim() ? C.parseDuration(goal.value) : 0;
      if (isNaN(g) || !C.inRange(g, C.LIM.goal)) { showToast(t("toast.badDur")); goal.focus(); return; }
      setPrefs({ cur: cur.value, rate: cents, goal: g, round: +round.value, rup: +mode.value });
      dlg.close();
      renderAll();
      showToast(t("toast.saved"));
    });
    dlg.appendChild(form);
    openDialog(dlg, null);
  }

  // ---------- 9. Files ----------
  function dialogHost() {
    if (window.orosDialog) return window.orosDialog;
    try { return window.parent.orosDialog || null; } catch (e) { return null; }
  }
  function saveText(text, name, mime, ext, desc) {
    var host = dialogHost();
    var types = [{ description: desc }];
    types[0].accept = {};
    types[0].accept[mime] = [ext];
    if (host && typeof host.saveFile === "function") {
      host.saveFile({ text: text, filename: name, mime: mime, types: types })
        .then(function (r) { if (r && r.ok) showToast(t("toast.exported")); });
      return;
    }
    var url = URL.createObjectURL(new Blob([text], { type: mime }));
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 40000);
  }
  function exportCsv() {
    if (!repState) return;
    var text = C.toCsv(data, repState.keys[0], repState.keys[1], repState.f, Date.now(), LANG);
    saveText(text, "oros-timesheet-" + repState.keys[0] + "_" + repState.keys[1] + ".csv", "text/csv", ".csv", "CSV");
  }
  function exportBackup() {
    saveText(C.toBackup(data), "oros-timesheet-backup-" + todayKey() + ".json", "application/json", ".json", "JSON");
  }
  function localPickFile(accept) {
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file";
      if (accept) inp.accept = accept;
      inp.style.display = "none";
      inp.addEventListener("change", function () {
        var f = inp.files && inp.files[0] ? inp.files[0] : null;
        inp.remove();
        resolve(f);
      });
      inp.addEventListener("cancel", function () { inp.remove(); resolve(null); });
      document.body.appendChild(inp);
      inp.click();
    });
  }
  function restoreBackup() {
    var host = dialogHost();
    var pick = host && typeof host.openFile === "function"
      ? host.openFile(".json,application/json") : localPickFile(".json,application/json");
    pick.then(function (file) {
      if (!file) return;                      // cancel: silent exit
      return file.text().then(function (text) {
        var incoming = C.fromBackup(text);
        if (!incoming) { showToast(t("toast.badFile")); return; }
        var before = {};
        data.entries.forEach(function (x) { if (!x.del) before[x.id] = true; });
        data = C.mergeTimesheet(data, incoming);
        var added = 0;
        data.entries.forEach(function (x) { if (!x.del && !before[x.id]) added++; });
        saveNow();
        renderAll();
        showToast(added === 1 ? t("toast.restored1") : (added ? t("toast.restored", { n: added }) : t("toast.restoredNone")));
      });
    }).catch(function () { showToast(t("toast.badFile")); });
  }

  // ---------- 10. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "timesheet", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  // Undo toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, onUndo); }

  var toastTimer = null, undoFn = null;
  function localToast(text, onUndo) {
    var box = $("toast");
    if (!box) return;
    hostToast();
    box.innerHTML = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    undoFn = onUndo || null;
    if (onUndo) {
      var b = el("button", "", t("toast.undo"));
      b.type = "button";
      b.addEventListener("click", runUndo);
      box.appendChild(b);
    }
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); undoFn = null; }, onUndo ? 8000 : 4000);
  }
  function runUndo() {
    var fn = undoFn;
    undoFn = null;
    $("toast").classList.remove("show");
    clearTimeout(toastTimer);
    if (fn) fn();
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
      var tg = e.target, tag = tg && tg.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        if (tg.id === "run-desc" && e.key === "Enter") { e.preventDefault(); flushDesc(); if (!C.running(data).length) toggleTimer(); }
        return;
      }
      if (document.querySelector("dialog[open]")) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        if (undoFn) { e.preventDefault(); runUndo(); }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.code === "KeyS") { e.preventDefault(); setTab("timer"); toggleTimer(); }
      else if (e.code === "KeyN") { e.preventDefault(); entryDialog(null, null); }
      else if (tab === "timer" && e.key === "ArrowLeft" && tag !== "BUTTON") { e.preventDefault(); shiftDay(-1); }
      else if (tab === "timer" && e.key === "ArrowRight" && tag !== "BUTTON") { e.preventDefault(); shiftDay(1); }
      else if (tab === "week" && e.key === "ArrowLeft" && tag !== "BUTTON") { e.preventDefault(); shiftWeek(-1); }
      else if (tab === "week" && e.key === "ArrowRight" && tag !== "BUTTON") { e.preventDefault(); shiftWeek(1); }
    });
  }

  // ---------- 12. Sync slice + palette ----------
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
    api.registerSlice("timesheet", sliceGet, sliceSet, STORAGE_KEY, C.mergeTimesheet);
  }
  function sliceGet() {
    return C.normalize(data);   // canonical copy (R26)
  }
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.entries)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.mergeTimesheet(data, incoming);   // local edits are already on disk; the merge keeps them
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;   // no toast (sync feedback = taskbar dot)
    renderAll();
  }

  // ---------- 13. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    document.title = t("app") + " · orOS";
    function iconBtn(id, svg, label) {
      var b = $(id);
      b.innerHTML = svg;
      b.setAttribute("aria-label", label);
      b.title = label;
    }
    iconBtn("prev-btn", UI.left, t("prev"));
    iconBtn("next-btn", UI.right, t("next"));
    iconBtn("wprev-btn", UI.left, t("wprev"));
    iconBtn("wnext-btn", UI.right, t("wnext"));
    iconBtn("set-btn", UI.gear, t("settings"));
    var icons = { timer: UI.timer, week: UI.week, report: UI.chart, projects: UI.folder };
    TABS.forEach(function (k) {
      var b = $("tab-" + k);
      b.innerHTML = icons[k] + "<span></span>";
      b.lastChild.textContent = t("tab." + k);
      b.title = t("tab." + k);
    });
    $("run-desc").placeholder = t("run.desc");
    $("run-desc").setAttribute("aria-label", t("run.desc"));
    $("run-proj").setAttribute("aria-label", t("f.project"));
    $("forgot-fix").textContent = t("forgot.fix");
    $("forgot-ok").textContent = t("forgot.ok");
    $("add-entry").innerHTML = UI.plus + "<span></span>";
    $("add-entry").lastChild.textContent = t("add.entry");
    $("add-project").innerHTML = UI.plus + "<span></span>";
    $("add-project").lastChild.textContent = t("add.project");
    $("add-client").innerHTML = UI.plus + "<span></span>";
    $("add-client").lastChild.textContent = t("add.client");
    $("rep-csv").textContent = t("rep.csv");
    $("day-btn").title = t("today");
    $("week-btn").title = t("thisWeek");
  }

  function wire() {
    TABS.forEach(function (k) { $("tab-" + k).addEventListener("click", function () { setTab(k); }); });
    $("set-btn").addEventListener("click", settingsDialog);
    $("run-btn").addEventListener("click", function () { flushDesc(); toggleTimer(); });
    $("run-proj").addEventListener("change", function () { runFieldChanged("p"); $("run-proj").style.setProperty("--dot", projColor($("run-proj").value)); });
    $("run-desc").addEventListener("input", function () { runFieldChanged("desc"); });
    $("run-desc").addEventListener("blur", flushDesc);
    $("forgot-fix").addEventListener("click", function () {
      var x = C.running(data)[0];
      if (x) entryDialogStop(x.id);
    });
    $("forgot-ok").addEventListener("click", function () {
      var x = C.running(data)[0];
      if (x) forgotOk[x.id] = true;
      renderForgot(Date.now());
    });
    $("prev-btn").addEventListener("click", function () { shiftDay(-1); });
    $("next-btn").addEventListener("click", function () { shiftDay(1); });
    $("day-btn").addEventListener("click", function () { goDay(todayKey()); });
    $("add-entry").addEventListener("click", function () { entryDialog(null, null); });
    $("wprev-btn").addEventListener("click", function () { shiftWeek(-1); });
    $("wnext-btn").addEventListener("click", function () { shiftWeek(1); });
    $("week-btn").addEventListener("click", function () { weekKey = C.weekStart(todayKey()); renderWeek(); });
    function onFilter(key, idn) {
      $(idn).addEventListener("change", function () {
        prefs.rep[key] = $(idn).value;
        if (key === "client") prefs.rep.project = "";
        savePrefs();
        renderFilters();
        renderReport();
      });
    }
    onFilter("range", "f-range");
    onFilter("client", "f-client");
    onFilter("project", "f-project");
    onFilter("bill", "f-bill");
    onFilter("billed", "f-billed");
    onFilter("group", "f-group");
    ["f-from", "f-to"].forEach(function (idn) {
      $(idn).addEventListener("change", function () {
        if (!C.validDay($(idn).value)) return;
        prefs.rep[idn === "f-from" ? "from" : "to"] = $(idn).value;
        savePrefs();
        renderReport();
      });
    });
    $("rep-csv").addEventListener("click", exportCsv);
    $("rep-mark").addEventListener("click", function () {
      if (repState && repState.markIds.length) markBilled(repState.markIds, repState.markFlag);
    });
    $("add-project").addEventListener("click", function () { projectDialog(null, ""); });
    $("add-client").addEventListener("click", function () { clientDialog(null); });

    // The clock: every second while a timer runs and the app is seen;
    // a full refresh every 30 s (midnight, the "forgot" banner).
    var lastFull = 0;
    setInterval(function () {
      if (document.hidden) return;
      var now = Date.now();
      if (tab === "timer" && C.running(data).length) {
        tickRun(now);
        if (now - lastFull >= 30000) {
          lastFull = now;
          if (!document.querySelector("dialog[open]")) { renderDay(); renderForgot(now); }
        }
      } else if (now - lastFull >= 30000) {
        lastFull = now;
        if (!document.querySelector("dialog[open]") && tab !== "projects") renderTab();
      }
    }, 1000);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) flushDesc();
      else if (!document.querySelector("dialog[open]")) renderAll();
    });
    window.addEventListener("pagehide", flushDesc);
    wireKeyboard();
  }
  // "Fix end time" on a forgotten timer: the entry dialog with end
  // fields (prefilled with now); Cancel leaves the timer running.
  function entryDialogStop(id) {
    var x = findEntry(id);
    if (x && x.e === 0) entryDialog(id, { stop: true });
  }

  function boot() {
    load();
    loadPrefs();
    dayKey = todayKey();
    weekKey = C.weekStart(dayKey);
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    setTab(prefs.tab);
  }

  boot();

  // Universal search deep link (shell __orosOpenAt / __orosTakeTarget):
  // target { entry } | { project } | { client }. An entry: the Timer
  // tab on its day, then its dialog; a project or a client: the
  // Projects tab, then its dialog. Unknown ids or an open dialog → no-op.
  function openSearchTarget(t) {
    if (!t || typeof t !== "object" || document.querySelector("dialog[open]")) return;
    if (typeof t.entry === "string") {
      var x = findEntry(t.entry);
      if (!x) return;
      dayKey = C.dayKeyOf(x.s);
      setTab("timer");
      entryDialog(x.id, null);
    } else if (typeof t.project === "string") {
      if (!C.project(data, t.project)) return;
      setTab("projects");
      projectDialog(t.project, "");
    } else if (typeof t.client === "string") {
      if (!C.client(data, t.client)) return;
      setTab("projects");
      clientDialog(t.client);
    }
  }
  window.__orosOpenAt = openSearchTarget;
  try {
    if (window.parent && window.parent !== window &&
        typeof window.parent.__orosTakeTarget === "function") {
      var pendingTarget = window.parent.__orosTakeTarget("timesheet");
      if (pendingTarget) openSearchTarget(pendingTarget);
    }
  } catch (e) {}
})();
