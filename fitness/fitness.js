// ============================================================
// orOS Workouts — App logic (v1.0.0)
// A workout logger: programs, sets and reps, records, progress.
//   - exercise library (ready + your own), 4 kinds of measure:
//     weight × reps, reps, time, distance + time
//   - programs with days (Push / Pull / Legs…), optional weekdays
//   - the workout screen: sets prefilled from last time, one-tap
//     ticks, a rest timer on this device, records as they happen
//   - progression hint (+2.5 kg / +5 kg), history, charts, body
//     measurements, CSV / JSON export, JSON restore (merge)
// Data:
//   - synced slice "fitness" (oros-fitness-data): exercises,
//     programs, workouts, body entries LWW by m + tombstones,
//     settings LWW (R5, R17, R26). Weights in grams, distances in
//     metres, lengths in millimetres, times in seconds: integers.
//   - device-local (R10): oros-fitness-prefs (tab, chart choices,
//     rest timer, sound)
// Sections:
//   1. Constants, i18n, helpers
//   2. Ready exercises + programs
//   3. Model: normalize, merge
//   4. Numbers: units, parsing, records, progression, stats, CSV
//   5. Storage, prefs, sync pacing
//   6. UI shell: tabs, toolbar, toasts, dialogs
//   7. Train: start screen + workout editor + rest timer
//   8. History
//   9. Progress: charts
//  10. Programs
//  11. Body
//  12. Settings, export, restore
//  13. Keyboard, palette, sync slice, deep link, boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-fitness-data";
  var PREFS_KEY   = "oros-fitness-prefs";
  var DATA_VER    = 1;
  var NAME_LEN    = 60;
  var NOTE_LEN    = 1000;
  var MAX_SETS    = 30;
  var MAX_ITEMS   = 40;
  var MAX_DAYS    = 14;
  var MAX_W       = 2000000;          // 2 t in grams
  var MAX_R       = 10000;
  var MAX_T       = 7 * 24 * 3600;    // seconds
  var MAX_D       = 1000000;          // 1000 km in metres
  var MAX_MM      = 5000;             // 5 m in millimetres
  var DAY_MS      = 86400000;
  var SYNC_PACE   = 180000;           // a running workout reaches sync at most every 3 min
  var KINDS       = ["wr", "r", "t", "dt"];
  var GROUPS      = ["chest", "back", "shoulders", "biceps", "triceps", "legs", "glutes", "core", "cardio", "full"];
  var LB_G        = 453.59237;
  var MI_M        = 1609.344;
  var IN_MM       = 25.4;
  var F_DONE = 1, F_WARM = 2;

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
      "app": "Workouts",
      "tab.train": "Train", "tab.history": "History", "tab.progress": "Progress",
      "tab.programs": "Programs", "tab.body": "Body", "nav.programs": "Programs",
      "btn.settings": "Settings",
      "train.today": "Today", "train.todayNone": "No program day is set for today.",
      "train.empty": "Empty workout", "train.emptySub": "Add exercises as you go",
      "train.from": "Start from a program", "train.week": "This week",
      "train.weekStat": "{n} workouts · {sets} sets", "train.last": "Last: {date}",
      "train.start": "Start", "train.resume": "Resume workout", "train.running": "Workout in progress",
      "wo.title": "Workout", "wo.addEx": "Add exercise", "wo.finish": "Finish",
      "wo.done": "Done", "wo.discard": "Discard workout", "wo.note": "Notes",
      "wo.elapsed": "Duration", "wo.addSet": "Add set", "wo.warm": "Warm-up set",
      "wo.delSet": "Remove set {n}", "wo.tick": "Set {n} done", "wo.untick": "Set {n} not done",
      "wo.moveUp": "Move up", "wo.moveDown": "Move down", "wo.removeEx": "Remove exercise",
      "wo.prev": "Last time", "wo.prevNone": "First time", "wo.suggest": "Try {w}",
      "wo.suggestAria": "Use the suggested weight {w} for every set",
      "wo.target": "Target {s} × {r}", "wo.rest": "Rest {t}",
      "wo.discardQ": "Discard this workout? Nothing of it will be kept.",
      "wo.finishQ": "Finish the workout?", "wo.finishOpen": "{n} sets are not ticked; they will be left out.",
      "wo.noSets": "Tick at least one set to finish.",
      "wo.editTitle": "Edit workout", "wo.date": "Date", "wo.startTime": "Start", "wo.minutes": "Minutes",
      "col.set": "Set", "col.kg": "kg", "col.lb": "lb", "col.reps": "Reps", "col.time": "Time",
      "col.km": "km", "col.mi": "mi",
      "sum.title": "Workout done", "sum.duration": "Duration", "sum.volume": "Volume",
      "sum.sets": "Sets", "sum.records": "New records", "sum.none": "No new records this time.",
      "rest.title": "Rest", "rest.skip": "Skip", "rest.plus": "+15 s", "rest.minus": "−15 s",
      "rest.over": "Rest is over", "rest.next": "Next: {ex}",
      "pr.weight": "Heaviest weight", "pr.e1rm": "Best estimated 1RM", "pr.reps": "Most reps",
      "pr.volume": "Most volume in a workout", "pr.time": "Longest time", "pr.dist": "Longest distance",
      "pr.toast": "New record · {ex}: {what}",
      "hist.empty": "No workouts yet. Your finished workouts show up here.",
      "hist.filterEx": "All exercises", "hist.filterPg": "All programs", "hist.search": "Search notes",
      "hist.del": "Delete workout", "hist.edit": "Edit", "hist.deleted": "Workout deleted",
      "hist.count": "{n} workouts", "hist.prs": "{n} records",
      "prog.exercise": "Exercise", "prog.metric": "Measure", "prog.range": "Period",
      "prog.none": "Finish a workout to see your progress here.",
      "prog.noData": "No data for this exercise in this period.",
      "prog.records": "Records", "prog.perWeek": "Workouts per week", "prog.groups": "Sets per muscle group, this week",
      "prog.year": "Training days, last 12 months", "prog.table": "Show as table",
      "prog.weekOf": "Week of {d}", "prog.week": "Week", "prog.count": "Workouts", "prog.day": "{n} workouts",
      "m.e1rm": "Estimated 1RM", "m.top": "Heaviest set", "m.volume": "Volume", "m.reps": "Most reps",
      "m.time": "Longest time", "m.dist": "Distance", "m.pace": "Pace (min/km)", "m.paceMi": "Pace (min/mi)",
      "r.1m": "1 month", "r.3m": "3 months", "r.6m": "6 months", "r.1y": "1 year", "r.all": "All",
      "pg.title": "My programs", "pg.ready": "Ready programs", "pg.empty": "No programs of your own yet. Copy a ready one or create a new one.",
      "pg.new": "New program", "pg.use": "Copy to my programs", "pg.edit": "Edit", "pg.del": "Delete program",
      "pg.deleted": "Program deleted", "pg.copied": "Program copied", "pg.name": "Program name",
      "pg.addDay": "Add day", "pg.dayName": "Day name", "pg.days": "Weekdays", "pg.delDay": "Remove day",
      "pg.addItem": "Add exercise", "pg.sets": "Sets", "pg.reps": "Reps", "pg.repsTo": "to", "pg.weight": "Weight",
      "pg.secs": "Seconds", "pg.restS": "Rest (s)", "pg.save": "Save", "pg.needName": "Give the program a name",
      "pg.needDay": "A program needs at least one day with an exercise",
      "pg.dayN": "Day {n}", "pg.exCount": "{n} exercises",
      "body.title": "Body", "body.add": "Add measurement", "body.weight": "Body weight", "body.waist": "Waist",
      "body.chest": "Chest", "body.arm": "Arm", "body.date": "Date", "body.empty": "No measurements yet.",
      "body.deleted": "Measurement deleted", "body.del": "Delete measurement",
      "ex.pick": "Choose an exercise", "ex.search": "Search exercises", "ex.new": "New exercise",
      "ex.name": "Name", "ex.group": "Muscle group", "ex.kind": "Measure", "ex.hide": "Hide",
      "ex.unhide": "Show", "ex.hidden": "Hidden exercises", "ex.edit": "Edit exercise", "ex.mine": "Mine",
      "ex.needName": "Give the exercise a name", "ex.lib": "Exercise library",
      "kind.wr": "Weight × reps", "kind.r": "Reps", "kind.t": "Time", "kind.dt": "Distance + time",
      "g.chest": "Chest", "g.back": "Back", "g.shoulders": "Shoulders", "g.biceps": "Biceps",
      "g.triceps": "Triceps", "g.legs": "Legs", "g.glutes": "Glutes", "g.core": "Core",
      "g.cardio": "Cardio", "g.full": "Full body",
      "set.title": "Settings", "set.wu": "Weight unit", "set.du": "Distance unit", "set.incU": "Step, upper body",
      "set.incL": "Step, lower body", "set.rest": "Default rest (s)", "set.sound": "Sound when rest ends",
      "set.vib": "Vibrate when rest ends", "set.habits": "Show workouts in Habits", "set.export": "Export", "set.csv": "All sets (CSV)",
      "set.json": "Backup (JSON)", "set.restore": "Restore from backup", "set.lib": "Exercise library",
      "set.metric": "Metric (kg, km, cm)", "set.imperial": "Imperial (lb, mi, in)",
      "set.restored": "Backup restored: {n} workouts", "set.badFile": "This file is not a Workouts backup",
      "dlg.cancel": "Cancel", "dlg.ok": "OK", "dlg.save": "Save", "dlg.close": "Close", "dlg.delete": "Delete",
      "toast.undo": "Undo", "toast.save": "Could not save: storage is full", "toast.saved": "Saved",
      "day.0": "Mon", "day.1": "Tue", "day.2": "Wed", "day.3": "Thu", "day.4": "Fri", "day.5": "Sat", "day.6": "Sun",
      "unit.min": "{n} min", "unit.sets": "{n} sets",
      "csv.date": "Date", "csv.workout": "Workout", "csv.exercise": "Exercise", "csv.set": "Set",
      "csv.warm": "Warm-up", "csv.weight": "Weight ({u})", "csv.reps": "Reps", "csv.time": "Time (s)",
      "csv.dist": "Distance ({u})", "csv.e1rm": "Estimated 1RM ({u})", "csv.yes": "yes",
      "feed.deleted": "This workout no longer exists."
    },
    el: {
      "app": "Προπόνηση",
      "tab.train": "Προπόνηση", "tab.history": "Ιστορικό", "tab.progress": "Πρόοδος",
      "tab.programs": "Προγράμματα", "tab.body": "Σώμα", "nav.programs": "Πλάνα",
      "btn.settings": "Ρυθμίσεις",
      "train.today": "Σήμερα", "train.todayNone": "Δεν έχει οριστεί ημέρα προγράμματος για σήμερα.",
      "train.empty": "Κενή προπόνηση", "train.emptySub": "Πρόσθεσε ασκήσεις στην πορεία",
      "train.from": "Έναρξη από πρόγραμμα", "train.week": "Αυτή την εβδομάδα",
      "train.weekStat": "{n} προπονήσεις · {sets} σετ", "train.last": "Τελευταία: {date}",
      "train.start": "Έναρξη", "train.resume": "Συνέχεια προπόνησης", "train.running": "Προπόνηση σε εξέλιξη",
      "wo.title": "Προπόνηση", "wo.addEx": "Προσθήκη άσκησης", "wo.finish": "Τέλος",
      "wo.done": "Έτοιμο", "wo.discard": "Απόρριψη προπόνησης", "wo.note": "Σημειώσεις",
      "wo.elapsed": "Διάρκεια", "wo.addSet": "Προσθήκη σετ", "wo.warm": "Σετ προθέρμανσης",
      "wo.delSet": "Αφαίρεση σετ {n}", "wo.tick": "Το σετ {n} έγινε", "wo.untick": "Το σετ {n} δεν έγινε",
      "wo.moveUp": "Πάνω", "wo.moveDown": "Κάτω", "wo.removeEx": "Αφαίρεση άσκησης",
      "wo.prev": "Την προηγούμενη φορά", "wo.prevNone": "Πρώτη φορά", "wo.suggest": "Δοκίμασε {w}",
      "wo.suggestAria": "Βάλε το προτεινόμενο βάρος {w} σε όλα τα σετ",
      "wo.target": "Στόχος {s} × {r}", "wo.rest": "Ανάπαυση {t}",
      "wo.discardQ": "Απόρριψη αυτής της προπόνησης; Δεν θα κρατηθεί τίποτα.",
      "wo.finishQ": "Τέλος της προπόνησης;", "wo.finishOpen": "{n} σετ δεν είναι τσεκαρισμένα· θα μείνουν έξω.",
      "wo.noSets": "Τσέκαρε τουλάχιστον ένα σετ για να τελειώσεις.",
      "wo.editTitle": "Επεξεργασία προπόνησης", "wo.date": "Ημερομηνία", "wo.startTime": "Έναρξη", "wo.minutes": "Λεπτά",
      "col.set": "Σετ", "col.kg": "kg", "col.lb": "lb", "col.reps": "Επαν.", "col.time": "Χρόνος",
      "col.km": "km", "col.mi": "mi",
      "sum.title": "Η προπόνηση τελείωσε", "sum.duration": "Διάρκεια", "sum.volume": "Όγκος",
      "sum.sets": "Σετ", "sum.records": "Νέα ρεκόρ", "sum.none": "Κανένα νέο ρεκόρ αυτή τη φορά.",
      "rest.title": "Ανάπαυση", "rest.skip": "Παράλειψη", "rest.plus": "+15 δ", "rest.minus": "−15 δ",
      "rest.over": "Η ανάπαυση τελείωσε", "rest.next": "Επόμενο: {ex}",
      "pr.weight": "Μεγαλύτερο βάρος", "pr.e1rm": "Καλύτερο εκτιμώμενο 1RM", "pr.reps": "Περισσότερες επαναλήψεις",
      "pr.volume": "Μεγαλύτερος όγκος σε μία προπόνηση", "pr.time": "Μεγαλύτερος χρόνος", "pr.dist": "Μεγαλύτερη απόσταση",
      "pr.toast": "Νέο ρεκόρ · {ex}: {what}",
      "hist.empty": "Καμία προπόνηση ακόμα. Οι προπονήσεις που τελειώνεις εμφανίζονται εδώ.",
      "hist.filterEx": "Όλες οι ασκήσεις", "hist.filterPg": "Όλα τα προγράμματα", "hist.search": "Αναζήτηση στις σημειώσεις",
      "hist.del": "Διαγραφή προπόνησης", "hist.edit": "Επεξεργασία", "hist.deleted": "Η προπόνηση διαγράφηκε",
      "hist.count": "{n} προπονήσεις", "hist.prs": "{n} ρεκόρ",
      "prog.exercise": "Άσκηση", "prog.metric": "Μέτρηση", "prog.range": "Περίοδος",
      "prog.none": "Τελείωσε μια προπόνηση για να δεις εδώ την πρόοδό σου.",
      "prog.noData": "Δεν υπάρχουν δεδομένα γι' αυτή την άσκηση σε αυτή την περίοδο.",
      "prog.records": "Ρεκόρ", "prog.perWeek": "Προπονήσεις ανά εβδομάδα", "prog.groups": "Σετ ανά μυϊκή ομάδα, αυτή την εβδομάδα",
      "prog.year": "Ημέρες προπόνησης, τελευταίοι 12 μήνες", "prog.table": "Εμφάνιση ως πίνακας",
      "prog.weekOf": "Εβδομάδα {d}", "prog.week": "Εβδομάδα", "prog.count": "Προπονήσεις", "prog.day": "{n} προπονήσεις",
      "m.e1rm": "Εκτιμώμενο 1RM", "m.top": "Βαρύτερο σετ", "m.volume": "Όγκος", "m.reps": "Περισσότερες επαναλήψεις",
      "m.time": "Μεγαλύτερος χρόνος", "m.dist": "Απόσταση", "m.pace": "Ρυθμός (λεπτά/km)", "m.paceMi": "Ρυθμός (λεπτά/mi)",
      "r.1m": "1 μήνας", "r.3m": "3 μήνες", "r.6m": "6 μήνες", "r.1y": "1 χρόνος", "r.all": "Όλα",
      "pg.title": "Τα προγράμματά μου", "pg.ready": "Έτοιμα προγράμματα", "pg.empty": "Κανένα δικό σου πρόγραμμα ακόμα. Αντέγραψε ένα έτοιμο ή φτιάξε καινούργιο.",
      "pg.new": "Νέο πρόγραμμα", "pg.use": "Αντιγραφή στα δικά μου", "pg.edit": "Επεξεργασία", "pg.del": "Διαγραφή προγράμματος",
      "pg.deleted": "Το πρόγραμμα διαγράφηκε", "pg.copied": "Το πρόγραμμα αντιγράφηκε", "pg.name": "Όνομα προγράμματος",
      "pg.addDay": "Προσθήκη ημέρας", "pg.dayName": "Όνομα ημέρας", "pg.days": "Ημέρες της εβδομάδας", "pg.delDay": "Αφαίρεση ημέρας",
      "pg.addItem": "Προσθήκη άσκησης", "pg.sets": "Σετ", "pg.reps": "Επαν.", "pg.repsTo": "έως", "pg.weight": "Βάρος",
      "pg.secs": "Δευτερόλεπτα", "pg.restS": "Ανάπαυση (δ)", "pg.save": "Αποθήκευση", "pg.needName": "Δώσε ένα όνομα στο πρόγραμμα",
      "pg.needDay": "Το πρόγραμμα θέλει τουλάχιστον μία ημέρα με άσκηση",
      "pg.dayN": "Ημέρα {n}", "pg.exCount": "{n} ασκήσεις",
      "body.title": "Σώμα", "body.add": "Νέα μέτρηση", "body.weight": "Βάρος σώματος", "body.waist": "Μέση",
      "body.chest": "Στήθος", "body.arm": "Μπράτσο", "body.date": "Ημερομηνία", "body.empty": "Καμία μέτρηση ακόμα.",
      "body.deleted": "Η μέτρηση διαγράφηκε", "body.del": "Διαγραφή μέτρησης",
      "ex.pick": "Διάλεξε άσκηση", "ex.search": "Αναζήτηση ασκήσεων", "ex.new": "Νέα άσκηση",
      "ex.name": "Όνομα", "ex.group": "Μυϊκή ομάδα", "ex.kind": "Μέτρηση", "ex.hide": "Απόκρυψη",
      "ex.unhide": "Εμφάνιση", "ex.hidden": "Κρυμμένες ασκήσεις", "ex.edit": "Επεξεργασία άσκησης", "ex.mine": "Δικές μου",
      "ex.needName": "Δώσε ένα όνομα στην άσκηση", "ex.lib": "Βιβλιοθήκη ασκήσεων",
      "kind.wr": "Βάρος × επαναλήψεις", "kind.r": "Επαναλήψεις", "kind.t": "Χρόνος", "kind.dt": "Απόσταση + χρόνος",
      "g.chest": "Στήθος", "g.back": "Πλάτη", "g.shoulders": "Ώμοι", "g.biceps": "Δικέφαλοι",
      "g.triceps": "Τρικέφαλοι", "g.legs": "Πόδια", "g.glutes": "Γλουτοί", "g.core": "Κορμός",
      "g.cardio": "Αερόβια", "g.full": "Όλο το σώμα",
      "set.title": "Ρυθμίσεις", "set.wu": "Μονάδα βάρους", "set.du": "Μονάδα απόστασης", "set.incU": "Βήμα, πάνω σώμα",
      "set.incL": "Βήμα, κάτω σώμα", "set.rest": "Προεπιλεγμένη ανάπαυση (δ)", "set.sound": "Ήχος στο τέλος της ανάπαυσης",
      "set.vib": "Δόνηση στο τέλος της ανάπαυσης", "set.habits": "Εμφάνιση των προπονήσεων στις Συνήθειες", "set.export": "Εξαγωγή", "set.csv": "Όλα τα σετ (CSV)",
      "set.json": "Αντίγραφο ασφαλείας (JSON)", "set.restore": "Επαναφορά από αντίγραφο", "set.lib": "Βιβλιοθήκη ασκήσεων",
      "set.metric": "Μετρικό (kg, km, cm)", "set.imperial": "Αγγλοσαξονικό (lb, mi, in)",
      "set.restored": "Έγινε επαναφορά: {n} προπονήσεις", "set.badFile": "Αυτό το αρχείο δεν είναι αντίγραφο της Προπόνησης",
      "dlg.cancel": "Άκυρο", "dlg.ok": "OK", "dlg.save": "Αποθήκευση", "dlg.close": "Κλείσιμο", "dlg.delete": "Διαγραφή",
      "toast.undo": "Αναίρεση", "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος", "toast.saved": "Αποθηκεύτηκε",
      "day.0": "Δευ", "day.1": "Τρί", "day.2": "Τετ", "day.3": "Πέμ", "day.4": "Παρ", "day.5": "Σάβ", "day.6": "Κυρ",
      "unit.min": "{n} λεπτά", "unit.sets": "{n} σετ",
      "csv.date": "Ημερομηνία", "csv.workout": "Προπόνηση", "csv.exercise": "Άσκηση", "csv.set": "Σετ",
      "csv.warm": "Προθέρμανση", "csv.weight": "Βάρος ({u})", "csv.reps": "Επαναλήψεις", "csv.time": "Χρόνος (δ)",
      "csv.dist": "Απόσταση ({u})", "csv.e1rm": "Εκτιμώμενο 1RM ({u})", "csv.yes": "ναι",
      "feed.deleted": "Αυτή η προπόνηση δεν υπάρχει πια."
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
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function clampInt(v, lo, hi) { return isInt(v) && v >= lo && v <= hi ? v : 0; }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function parseYmd(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  // Monday = 0 (same weekday space as Habits)
  function wdIdx(d) { return (d.getDay() + 6) % 7; }
  function weekStart(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - wdIdx(x));
    return x;
  }

  function newId() {
    var r = new Uint32Array(2);
    crypto.getRandomValues(r);
    return Date.now().toString(36) + r[0].toString(36) + r[1].toString(36).slice(0, 4);
  }

  // ---------- 2. Ready exercises + programs ----------
  // Ids are language-independent (Spreadsheet SS-2): the name is
  // painted per language at render time. A ready exercise reaches
  // the slice only when the user hides or edits it.
  // [id, group, kind, English, Greek]
  var SEED_EX = [
    ["x-bench", "chest", "wr", "Bench press", "Πιέσεις πάγκου"],
    ["x-incline", "chest", "wr", "Incline bench press", "Πιέσεις σε κεκλιμένο πάγκο"],
    ["x-dbbench", "chest", "wr", "Dumbbell bench press", "Πιέσεις πάγκου με αλτήρες"],
    ["x-dbfly", "chest", "wr", "Dumbbell fly", "Ανοίγματα με αλτήρες"],
    ["x-pushup", "chest", "r", "Push-up", "Κάμψεις"],
    ["x-dips", "chest", "r", "Dips", "Βυθίσεις"],
    ["x-deadlift", "back", "wr", "Deadlift", "Άρση θανάτου"],
    ["x-row", "back", "wr", "Barbell row", "Κωπηλατική με μπάρα"],
    ["x-dbrow", "back", "wr", "Dumbbell row", "Κωπηλατική με αλτήρα"],
    ["x-pullup", "back", "r", "Pull-up", "Έλξεις"],
    ["x-chinup", "back", "r", "Chin-up", "Έλξεις με ανάποδη λαβή"],
    ["x-pulldown", "back", "wr", "Lat pulldown", "Έλξεις τροχαλίας"],
    ["x-cablerow", "back", "wr", "Seated cable row", "Κωπηλατική τροχαλίας"],
    ["x-backext", "back", "r", "Back extension", "Εκτάσεις ραχιαίων"],
    ["x-ohp", "shoulders", "wr", "Overhead press", "Πιέσεις ώμων"],
    ["x-dbshoulder", "shoulders", "wr", "Dumbbell shoulder press", "Πιέσεις ώμων με αλτήρες"],
    ["x-latraise", "shoulders", "wr", "Lateral raise", "Πλάγιες εκτάσεις"],
    ["x-facepull", "shoulders", "wr", "Face pull", "Face pull"],
    ["x-rearfly", "shoulders", "wr", "Rear delt fly", "Ανοίγματα οπίσθιων ώμων"],
    ["x-curl", "biceps", "wr", "Barbell curl", "Κάμψεις δικεφάλων με μπάρα"],
    ["x-dbcurl", "biceps", "wr", "Dumbbell curl", "Κάμψεις δικεφάλων με αλτήρες"],
    ["x-hammer", "biceps", "wr", "Hammer curl", "Κάμψεις σφυριού"],
    ["x-pushdown", "triceps", "wr", "Triceps pushdown", "Εκτάσεις τρικεφάλων στην τροχαλία"],
    ["x-skull", "triceps", "wr", "Skull crusher", "Γαλλικές πιέσεις"],
    ["x-ohext", "triceps", "wr", "Overhead triceps extension", "Εκτάσεις τρικεφάλων πάνω από το κεφάλι"],
    ["x-closebench", "triceps", "wr", "Close-grip bench press", "Πιέσεις πάγκου με κλειστή λαβή"],
    ["x-squat", "legs", "wr", "Squat", "Καθίσματα"],
    ["x-frontsquat", "legs", "wr", "Front squat", "Μπροστινά καθίσματα"],
    ["x-legpress", "legs", "wr", "Leg press", "Πρέσα ποδιών"],
    ["x-lunge", "legs", "wr", "Lunge", "Προβολές"],
    ["x-bulgarian", "legs", "wr", "Bulgarian split squat", "Βουλγάρικα καθίσματα"],
    ["x-goblet", "legs", "wr", "Goblet squat", "Καθίσματα goblet"],
    ["x-rdl", "legs", "wr", "Romanian deadlift", "Ρουμανική άρση θανάτου"],
    ["x-legcurl", "legs", "wr", "Leg curl", "Κάμψεις ποδιών"],
    ["x-legext", "legs", "wr", "Leg extension", "Εκτάσεις ποδιών"],
    ["x-calf", "legs", "wr", "Calf raise", "Άνοδοι γαστροκνημίων"],
    ["x-hipthrust", "glutes", "wr", "Hip thrust", "Ώθηση ισχίων"],
    ["x-bridge", "glutes", "r", "Glute bridge", "Γέφυρα γλουτών"],
    ["x-plank", "core", "t", "Plank", "Σανίδα"],
    ["x-sideplank", "core", "t", "Side plank", "Πλάγια σανίδα"],
    ["x-crunch", "core", "r", "Crunch", "Κοιλιακοί"],
    ["x-legraise", "core", "r", "Hanging leg raise", "Ανυψώσεις ποδιών σε κρέμαση"],
    ["x-twist", "core", "r", "Russian twist", "Ρώσικες περιστροφές"],
    ["x-abwheel", "core", "r", "Ab wheel rollout", "Ρόδα κοιλιακών"],
    ["x-run", "cardio", "dt", "Running", "Τρέξιμο"],
    ["x-walk", "cardio", "dt", "Walking", "Περπάτημα"],
    ["x-bike", "cardio", "dt", "Cycling", "Ποδήλατο"],
    ["x-rowerg", "cardio", "dt", "Rowing machine", "Κωπηλατική μηχανή"],
    ["x-swim", "cardio", "dt", "Swimming", "Κολύμπι"],
    ["x-rope", "cardio", "t", "Jump rope", "Σχοινάκι"],
    ["x-burpee", "full", "r", "Burpee", "Burpees"],
    ["x-kbswing", "full", "wr", "Kettlebell swing", "Αιωρήσεις kettlebell"],
    ["x-clean", "full", "wr", "Power clean", "Power clean"]
  ];
  var SEED_MAP = {};
  SEED_EX.forEach(function (r) { SEED_MAP[r[0]] = { id: r[0], g: r[1], k: r[2], en: r[3], el: r[4] }; });
  // Lower-body lifts take the larger progression step.
  var LOWER_IDS = { "x-deadlift": 1 };

  // Ready programs. Item: [exercise, sets, reps, repsTo, seconds, rest]
  function I(e, s, r, r2, sec, rest) { return { e: e, s: s, r: r || 0, r2: r2 || 0, t: sec || 0, w: 0, rest: rest || 0 }; }
  var SEED_PG = [
    { id: "p-full", en: "Full Body 3×", el: "Όλο το σώμα 3×", days: [
      { id: "a", en: "Full Body A", el: "Όλο το σώμα Α", wd: [0, 4], it: [
        I("x-squat", 3, 5, 0, 0, 180), I("x-bench", 3, 5, 0, 0, 180), I("x-row", 3, 5, 0, 0, 150), I("x-plank", 3, 0, 0, 45, 60)] },
      { id: "b", en: "Full Body B", el: "Όλο το σώμα Β", wd: [2], it: [
        I("x-squat", 3, 5, 0, 0, 180), I("x-ohp", 3, 5, 0, 0, 150), I("x-deadlift", 1, 5, 0, 0, 180), I("x-pullup", 3, 6, 10, 0, 120)] }
    ] },
    { id: "p-ul", en: "Upper / Lower", el: "Πάνω / Κάτω", days: [
      { id: "u", en: "Upper", el: "Πάνω σώμα", wd: [0, 3], it: [
        I("x-bench", 4, 6, 8, 0, 150), I("x-row", 4, 6, 8, 0, 150), I("x-ohp", 3, 8, 10, 0, 120),
        I("x-pulldown", 3, 10, 12, 0, 90), I("x-curl", 3, 10, 12, 0, 60), I("x-pushdown", 3, 10, 12, 0, 60)] },
      { id: "l", en: "Lower", el: "Κάτω σώμα", wd: [1, 4], it: [
        I("x-squat", 4, 6, 8, 0, 180), I("x-rdl", 3, 8, 10, 0, 150), I("x-legpress", 3, 10, 12, 0, 120),
        I("x-legcurl", 3, 10, 12, 0, 90), I("x-calf", 4, 12, 15, 0, 60), I("x-plank", 3, 0, 0, 60, 60)] }
    ] },
    { id: "p-ppl", en: "Push / Pull / Legs", el: "Ώθηση / Έλξη / Πόδια", days: [
      { id: "push", en: "Push", el: "Ώθηση", wd: [0, 3], it: [
        I("x-bench", 4, 6, 8, 0, 150), I("x-incline", 3, 8, 10, 0, 120), I("x-ohp", 3, 8, 10, 0, 120),
        I("x-latraise", 3, 12, 15, 0, 60), I("x-pushdown", 3, 10, 12, 0, 60)] },
      { id: "pull", en: "Pull", el: "Έλξη", wd: [1, 4], it: [
        I("x-deadlift", 3, 5, 0, 0, 180), I("x-pullup", 3, 6, 10, 0, 120), I("x-row", 3, 8, 10, 0, 120),
        I("x-facepull", 3, 12, 15, 0, 60), I("x-curl", 3, 10, 12, 0, 60)] },
      { id: "legs", en: "Legs", el: "Πόδια", wd: [2, 5], it: [
        I("x-squat", 4, 6, 8, 0, 180), I("x-rdl", 3, 8, 10, 0, 150), I("x-legpress", 3, 10, 12, 0, 120),
        I("x-legcurl", 3, 10, 12, 0, 90), I("x-calf", 4, 12, 15, 0, 60)] }
    ] }
  ];

  // ---------- 3. Model: normalize, merge ----------
  // data = {
  //   ver: 1,
  //   ex:  [{ id, m, n, g, k, h }]      own exercises + edited ready ones
  //   pg:  [{ id, m, n, days: [{ id, n, wd[], it: [{ e, s, r, r2, t, w, rest }] }] }]
  //   wo:  [{ id, m, d, st, en, ti, p, pd, n, x: [{ e, tr, tr2, rest, s: [[w, r, t, dist, f]] }] }]
  //          en = 0 → the workout is still running
  //   bm:  [{ id: "YYYY-MM-DD", m, w, wa, ch, ar }]
  //   set: { m, wu, du, incU, incL, rest }
  //   tombs: { "<coll>:<id>": deletedAt }
  // }
  // Every collection is sorted by id; LWW per row by m, equal m → the
  // larger canonical JSON; a tombstone wins ties, a newer edit
  // resurrects (R17). The merge is symmetric and idempotent (R26).
  var ID_RE = /^[a-z0-9-]{1,40}$/;
  var DAYID_RE = /^[a-z0-9]{1,12}$/;
  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
  var COLLS = ["ex", "pg", "wo", "bm"];

  function normStr(s, max) {
    if (typeof s !== "string") return "";
    return s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  }
  function normNote(s) {
    if (typeof s !== "string") return "";
    return s.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").slice(0, NOTE_LEN);
  }
  function stamp(x) { return isInt(x.m) && x.m >= 0; }

  function normEx(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) || !stamp(x)) return null;
    var seed = SEED_MAP[x.id];
    var n = normStr(x.n, NAME_LEN);
    if (!seed && !n) return null;
    return {
      id: x.id, m: x.m, n: n,
      g: GROUPS.indexOf(x.g) >= 0 ? x.g : (seed ? seed.g : "full"),
      k: seed ? seed.k : (KINDS.indexOf(x.k) >= 0 ? x.k : "wr"),     // a ready exercise keeps its measure
      h: x.h ? 1 : 0
    };
  }

  function normItem(x) {
    if (!x || typeof x !== "object" || typeof x.e !== "string" || !ID_RE.test(x.e)) return null;
    var s = clampInt(x.s, 1, MAX_SETS) || 1;
    var r = clampInt(x.r, 0, MAX_R), r2 = clampInt(x.r2, 0, MAX_R);
    if (r2 && r2 <= r) r2 = 0;
    return { e: x.e, s: s, r: r, r2: r2, t: clampInt(x.t, 0, MAX_T), w: clampInt(x.w, 0, MAX_W), rest: clampInt(x.rest, 0, 3600) };
  }
  function normWd(list) {
    var seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(function (d) {
      if (isInt(d) && d >= 0 && d <= 6 && !seen[d]) { seen[d] = 1; out.push(d); }
    });
    return out.sort();
  }
  function normDay(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !DAYID_RE.test(x.id)) return null;
    var it = [];
    (Array.isArray(x.it) ? x.it : []).forEach(function (i) {
      var v = normItem(i);
      if (v && it.length < MAX_ITEMS) it.push(v);
    });
    return { id: x.id, n: normStr(x.n, NAME_LEN), wd: normWd(x.wd), it: it };
  }
  function normPg(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) || !stamp(x)) return null;
    var n = normStr(x.n, NAME_LEN);
    if (!n) return null;
    var seen = {}, days = [];
    (Array.isArray(x.days) ? x.days : []).forEach(function (d) {
      var v = normDay(d);
      if (v && !seen[v.id] && days.length < MAX_DAYS) { seen[v.id] = 1; days.push(v); }
    });
    return { id: x.id, m: x.m, n: n, days: days };
  }

  function normSet(s) {
    if (!Array.isArray(s)) return null;
    return [clampInt(s[0], 0, MAX_W), clampInt(s[1], 0, MAX_R), clampInt(s[2], 0, MAX_T),
            clampInt(s[3], 0, MAX_D), clampInt(s[4], 0, 3)];
  }
  function normEntry(x) {
    if (!x || typeof x !== "object" || typeof x.e !== "string" || !ID_RE.test(x.e)) return null;
    var s = [];
    (Array.isArray(x.s) ? x.s : []).forEach(function (r) {
      var v = normSet(r);
      if (v && s.length < MAX_SETS) s.push(v);
    });
    var tr = clampInt(x.tr, 0, MAX_R), tr2 = clampInt(x.tr2, 0, MAX_R);
    if (tr2 && tr2 <= tr) tr2 = 0;
    return { e: x.e, tr: tr, tr2: tr2, rest: clampInt(x.rest, 0, 3600), s: s };
  }
  function normWo(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) || !stamp(x)) return null;
    if (typeof x.d !== "string" || !YMD_RE.test(x.d) || !isInt(x.st) || x.st < 0) return null;
    var en = isInt(x.en) && x.en >= x.st ? x.en : 0;
    var xs = [];
    (Array.isArray(x.x) ? x.x : []).forEach(function (e) {
      var v = normEntry(e);
      if (v && xs.length < MAX_ITEMS) xs.push(v);
    });
    return {
      id: x.id, m: x.m, d: x.d, st: x.st, en: en,
      ti: normStr(x.ti, NAME_LEN),
      p: typeof x.p === "string" && ID_RE.test(x.p) ? x.p : "",
      pd: typeof x.pd === "string" && DAYID_RE.test(x.pd) ? x.pd : "",
      n: normNote(x.n), x: xs
    };
  }
  function normBm(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !YMD_RE.test(x.id) || !stamp(x)) return null;
    var v = { id: x.id, m: x.m, w: clampInt(x.w, 0, 1000000), wa: clampInt(x.wa, 0, MAX_MM),
              ch: clampInt(x.ch, 0, MAX_MM), ar: clampInt(x.ar, 0, MAX_MM) };
    return (v.w || v.wa || v.ch || v.ar) ? v : null;
  }
  var DEF_SET = { m: 0, wu: "kg", du: "km", incU: 2500, incL: 5000, rest: 90, hb: 1 };
  function normSettings(x) {
    if (!x || typeof x !== "object" || !stamp(x)) return null;
    return {
      m: x.m,
      wu: x.wu === "lb" ? "lb" : "kg",
      du: x.du === "mi" ? "mi" : "km",
      incU: clampInt(x.incU, 1, 100000) || DEF_SET.incU,
      incL: clampInt(x.incL, 1, 100000) || DEF_SET.incL,
      rest: clampInt(x.rest, 0, 3600),
      hb: x.hb === 0 ? 0 : 1          // the read-only row in Habits (fitness/core.js)
    };
  }
  var NORM = { ex: normEx, pg: normPg, wo: normWo, bm: normBm };

  function canonPick(cur, x) {
    return !cur || x.m > cur.m || (x.m === cur.m && JSON.stringify(x) > JSON.stringify(cur));
  }

  function mergeFit(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object") return;
      Object.keys(tm).forEach(function (k) {
        var i = k.indexOf(":");
        if (i < 0 || COLLS.indexOf(k.slice(0, i)) < 0 || !isInt(tm[k]) || tm[k] < 0) return;
        if (!(k in tombs) || tm[k] > tombs[k]) tombs[k] = tm[k];
      });
    });
    var out = { ver: DATA_VER };
    COLLS.forEach(function (c) {
      var best = {};
      [a[c], b[c]].forEach(function (list) {
        if (!Array.isArray(list)) return;
        list.forEach(function (raw) {
          var x = NORM[c](raw);
          if (x && canonPick(best[x.id], x)) best[x.id] = x;
        });
      });
      var rows = [];
      Object.keys(best).sort(cmpStr).forEach(function (id) {
        var k = c + ":" + id;
        if (k in tombs && tombs[k] >= best[id].m) return;
        rows.push(best[id]);
      });
      out[c] = rows;
    });
    var sa = normSettings(a.set), sb = normSettings(b.set);
    out.set = sa && sb ? (canonPick(sa, sb) ? sb : sa) : (sa || sb || null);
    var sorted = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (k) { sorted[k] = tombs[k]; });
    out.tombs = sorted;
    return out;
  }
  function emptyData() { return { ver: DATA_VER, ex: [], pg: [], wo: [], bm: [], set: null, tombs: {} }; }

  // ---------- 4. Numbers: units, parsing, records, progression, stats, CSV ----------
  function settingsOf(d) { return (d && d.set) || DEF_SET; }

  // Numbers with the language's decimal mark; trailing zeros dropped.
  function fmtNum(v, dec) {
    var p = Math.pow(10, dec);
    var s = (Math.round(v * p) / p).toFixed(dec);
    if (dec > 0) s = s.replace(/\.?0+$/, "");
    var parts = s.split(".");
    var sep = LANG === "el" ? "." : ",", mark = LANG === "el" ? "," : ".";
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, sep);
    return parts.join(mark);
  }
  // "12,5", "12.5", " 12 " → 12.5; "1.234,5" (el) is not accepted on
  // purpose: weights never need a thousands mark, so the last , or .
  // is the decimal mark and anything else is an error.
  function parseNum(str) {
    if (typeof str === "number") return isFinite(str) ? str : NaN;
    var s = String(str == null ? "" : str).trim().replace(",", ".");
    if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return NaN;
    return parseFloat(s);
  }
  function wFactor(u) { return u === "lb" ? LB_G : 1000; }
  function fmtW(g, u) { return fmtNum(g / wFactor(u), u === "lb" ? 1 : 2); }
  function parseW(str, u) {
    var v = parseNum(str);
    if (isNaN(v)) return NaN;
    var g = Math.round(v * wFactor(u));
    return g <= MAX_W ? g : NaN;
  }
  function dFactor(u) { return u === "mi" ? MI_M : 1000; }
  function fmtDist(m, u) { return fmtNum(m / dFactor(u), 2); }
  function parseDist(str, u) {
    var v = parseNum(str);
    if (isNaN(v)) return NaN;
    var m = Math.round(v * dFactor(u));
    return m <= MAX_D ? m : NaN;
  }
  function lenFactor(u) { return u === "mi" ? IN_MM : 10; }    // cm or in
  function fmtLen(mm, u) { return fmtNum(mm / lenFactor(u), 1); }
  function parseLen(str, u) {
    var v = parseNum(str);
    if (isNaN(v)) return NaN;
    var mm = Math.round(v * lenFactor(u));
    return mm <= MAX_MM ? mm : NaN;
  }
  // Seconds ↔ "m:ss" / "h:mm:ss"; a bare number is seconds.
  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? h + ":" + pad2(m) + ":" + pad2(s) : m + ":" + pad2(s);
  }
  function parseTime(str) {
    var s = String(str == null ? "" : str).trim();
    if (/^\d+$/.test(s)) { var n = parseInt(s, 10); return n <= MAX_T ? n : NaN; }
    var m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(s);
    if (!m) return NaN;
    var v = (m[1] ? parseInt(m[1], 10) * 3600 : 0) + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
    if (+m[3] > 59 || (m[1] && +m[2] > 59)) return NaN;
    return v <= MAX_T ? v : NaN;
  }
  function parseReps(str) {
    var s = String(str == null ? "" : str).trim();
    if (!/^\d+$/.test(s)) return NaN;
    var n = parseInt(s, 10);
    return n <= MAX_R ? n : NaN;
  }

  // Estimated one-rep max (Epley). Beyond 12 reps the estimate is
  // noise, so those sets do not count for it.
  function e1rm(w, r) {
    if (!(w > 0) || !(r >= 1) || r > 12) return 0;
    return r === 1 ? w : Math.round(w * (1 + r / 30));
  }

  function exInfo(d, id) {
    var row = null;
    (d.ex || []).forEach(function (x) { if (x.id === id) row = x; });
    var seed = SEED_MAP[id];
    if (!row && !seed) return { id: id, name: "?", g: "full", k: "wr", h: 0, seed: false, known: false };
    return {
      id: id,
      name: (row && row.n) || (seed ? (LANG === "el" ? seed.el : seed.en) : "?"),
      g: row ? row.g : seed.g,
      k: seed ? seed.k : row.k,
      h: row ? row.h : 0,
      seed: !!seed,
      known: true
    };
  }
  function allExercises(d) {
    var ids = {};
    SEED_EX.forEach(function (r) { ids[r[0]] = 1; });
    (d.ex || []).forEach(function (x) { ids[x.id] = 1; });
    return Object.keys(ids).map(function (id) { return exInfo(d, id); });
  }
  function isLower(info) { return info.g === "legs" || info.g === "glutes" || !!LOWER_IDS[info.id]; }

  function isDone(s) { return (s[4] & F_DONE) === F_DONE; }
  function isWarm(s) { return (s[4] & F_WARM) === F_WARM; }
  function working(entry) { return entry.s.filter(function (s) { return isDone(s) && !isWarm(s); }); }

  // What one exercise entry achieved (working sets only).
  function entryStats(entry, kind) {
    var ws = working(entry), r = { sets: ws.length, top: 0, topR: 0, e1: 0, vol: 0, reps: 0, time: 0, dist: 0, pace: 0 };
    ws.forEach(function (s) {
      if (kind === "wr") {
        if (s[1] >= 1 && (s[0] > r.top || (s[0] === r.top && s[1] > r.topR))) { r.top = s[0]; r.topR = s[1]; }
        r.e1 = Math.max(r.e1, e1rm(s[0], s[1]));
        r.vol += s[0] * s[1];
        r.reps = Math.max(r.reps, s[1]);
      } else if (kind === "r") {
        r.reps = Math.max(r.reps, s[1]);
        r.vol += s[1];
      } else if (kind === "t") {
        r.time = Math.max(r.time, s[2]);
      } else {
        r.dist += s[3];
        r.time += s[2];
      }
    });
    if (kind === "dt" && r.dist > 0 && r.time > 0) r.pace = r.time / (r.dist / 1000);   // s per km
    return r;
  }

  function finished(d) { return (d.wo || []).filter(function (w) { return w.en > 0; }); }
  function byStart(a, b) { return a.st - b.st || cmpStr(a.id, b.id); }

  // Best values for one exercise over the given workouts.
  var PR_KEYS = { wr: ["top", "e1", "reps", "vol"], r: ["reps"], t: ["time"], dt: ["dist"] };
  var PR_LABEL = { top: "pr.weight", e1: "pr.e1rm", reps: "pr.reps", vol: "pr.volume", time: "pr.time", dist: "pr.dist" };
  function bestsFor(wos, exId, kind, skipId) {
    var best = {};
    wos.forEach(function (w) {
      if (w.id === skipId) return;
      w.x.forEach(function (e) {
        if (e.e !== exId) return;
        var st = entryStats(e, kind);
        PR_KEYS[kind].forEach(function (k) { if (st[k] > (best[k] || 0)) best[k] = st[k]; });
      });
    });
    return best;
  }
  // Records a workout set against everything finished before it.
  // The first time an exercise is done is not a record (nothing to beat).
  function recordsOf(d, wo) {
    var before = finished(d).filter(function (w) { return w.id !== wo.id && w.st < wo.st; });
    var out = [], seen = {};
    wo.x.forEach(function (e) {
      if (seen[e.e]) return;
      seen[e.e] = 1;
      var info = exInfo(d, e.e);
      var merged = { e: e.e, s: [] };
      wo.x.forEach(function (y) { if (y.e === e.e) merged.s = merged.s.concat(y.s); });
      var st = entryStats(merged, info.k);
      var prev = bestsFor(before, e.e, info.k, wo.id);
      if (!Object.keys(prev).length) return;
      PR_KEYS[info.k].forEach(function (k) {
        if (st[k] > 0 && st[k] > (prev[k] || 0)) out.push({ e: e.e, k: k, v: st[k] });
      });
    });
    return out;
  }
  function fmtRecord(rec, kind, set) {
    if (rec.k === "reps") return String(rec.v);
    if (rec.k === "time") return fmtTime(rec.v);
    if (rec.k === "dist") return fmtDist(rec.v, set.du) + " " + set.du;
    if (kind === "r" && rec.k === "vol") return String(rec.v);
    return fmtW(rec.v, set.wu) + " " + set.wu;
  }

  // The last finished entry of an exercise before a moment.
  function lastEntry(d, exId, beforeSt, skipId) {
    var best = null, bestSt = -1;
    finished(d).forEach(function (w) {
      if (w.id === skipId || w.st >= beforeSt) return;
      w.x.forEach(function (e) {
        if (e.e === exId && working(e).length && w.st > bestSt) { best = e; bestSt = w.st; }
      });
    });
    return best;
  }
  // Progression hint: every working set of the last session reached
  // the top of the rep target → one step heavier. Only a hint.
  function suggestW(prev, info, set) {
    if (!prev || info.k !== "wr") return 0;
    var target = prev.tr2 || prev.tr;
    if (!target) return 0;
    var ws = working(prev);
    if (!ws.length) return 0;
    var planned = prev.s.filter(function (s) { return !isWarm(s); }).length;
    if (ws.length < planned) return 0;
    var top = 0, ok = true;
    ws.forEach(function (s) { top = Math.max(top, s[0]); if (s[1] < target) ok = false; });
    if (!ok || !top) return 0;
    return Math.min(MAX_W, top + (isLower(info) ? set.incL : set.incU));
  }

  function woVolume(wo) {
    var v = 0;
    wo.x.forEach(function (e) { working(e).forEach(function (s) { v += s[0] * s[1]; }); });
    return v;
  }
  function woSets(wo) {
    var n = 0;
    wo.x.forEach(function (e) { n += working(e).length; });
    return n;
  }
  function woMinutes(wo) { return wo.en > wo.st ? Math.round((wo.en - wo.st) / 60000) : 0; }

  // Weekly counts, oldest first: [{ start: Date, n }]
  function perWeek(wos, now, weeks) {
    var ws0 = weekStart(now), out = [];
    for (var i = weeks - 1; i >= 0; i--) {
      var s = new Date(ws0.getFullYear(), ws0.getMonth(), ws0.getDate() - 7 * i);
      out.push({ start: s, key: ymd(s), n: 0 });
    }
    var first = out[0].key;
    wos.forEach(function (w) {
      if (w.d < first) return;
      var k = ymd(weekStart(parseYmd(w.d)));
      out.forEach(function (b) { if (b.key === k) b.n++; });
    });
    return out;
  }
  // Working sets per muscle group from a day on.
  function groupSets(d, wos, fromYmd) {
    var out = {};
    GROUPS.forEach(function (g) { out[g] = 0; });
    wos.forEach(function (w) {
      if (w.d < fromYmd) return;
      w.x.forEach(function (e) { out[exInfo(d, e.e).g] += working(e).length; });
    });
    return out;
  }
  function dayCounts(wos) {
    var out = {};
    wos.forEach(function (w) { out[w.d] = (out[w.d] || 0) + 1; });
    return out;
  }

  // One point per workout for an exercise and a measure.
  var METRICS = { wr: ["e1", "top", "vol", "reps"], r: ["reps", "vol"], t: ["time"], dt: ["dist", "pace", "time"] };
  function seriesFor(d, exId, metric, fromYmd) {
    var info = exInfo(d, exId), pts = [];
    finished(d).slice().sort(byStart).forEach(function (w) {
      if (fromYmd && w.d < fromYmd) return;
      var merged = { e: exId, s: [] };
      w.x.forEach(function (e) { if (e.e === exId) merged.s = merged.s.concat(e.s); });
      if (!merged.s.length) return;
      var v = entryStats(merged, info.k)[metric];
      if (v > 0) pts.push({ x: w.st, y: v, id: w.id, d: w.d });
    });
    return pts;
  }

  // CSV: one row per set. Greek Excel wants ";" and a decimal comma;
  // English wants "," and a point. Cells that a spreadsheet would run
  // as a formula are prefixed with an apostrophe.
  function csvCell(v, sep) {
    var s = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (s.indexOf(sep) >= 0 || /["\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function buildCsv(d) {
    var set = settingsOf(d), sep = LANG === "el" ? ";" : ",";
    var num = function (v, dec) {
      var p = Math.pow(10, dec), s = String(Math.round(v * p) / p);
      return LANG === "el" ? s.replace(".", ",") : s;
    };
    var rows = [[t("csv.date"), t("csv.workout"), t("csv.exercise"), t("csv.set"), t("csv.warm"),
                 t("csv.weight", { u: set.wu }), t("csv.reps"), t("csv.time"),
                 t("csv.dist", { u: set.du }), t("csv.e1rm", { u: set.wu })]];
    finished(d).slice().sort(byStart).forEach(function (w) {
      w.x.forEach(function (e) {
        var info = exInfo(d, e.e), n = 0;
        e.s.forEach(function (s) {
          if (!isDone(s)) return;
          n++;
          var hasW = info.k === "wr", e1 = hasW ? e1rm(s[0], s[1]) : 0;
          rows.push([w.d, w.ti, info.name, n, isWarm(s) ? t("csv.yes") : "",
                     hasW ? num(s[0] / wFactor(set.wu), 2) : "",
                     (info.k === "wr" || info.k === "r") ? s[1] : "",
                     (info.k === "t" || info.k === "dt") ? s[2] : "",
                     info.k === "dt" ? num(s[3] / dFactor(set.du), 3) : "",
                     e1 ? num(e1 / wFactor(set.wu), 1) : ""]);
        });
      });
    });
    return "﻿" + rows.map(function (r) {
      return r.map(function (c) { return csvCell(c, sep); }).join(sep);
    }).join("\r\n") + "\r\n";
  }

  // ---------- 5. Storage, prefs, sync pacing ----------
  var data = null, prefs = null;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.wo)) {
          data = mergeFit(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] fitness: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = emptyData();
  }

  // A running workout changes on every set. Writing it locally each
  // time keeps it safe; telling sync each time would upload after
  // every set (5 s debounce in sync.js). So while a workout runs the
  // slice is marked dirty at most every SYNC_PACE, and at once when
  // it ends, when the app hides or closes.
  var paceTimer = null;
  function dirtyNow() {
    clearTimeout(paceTimer);
    paceTimer = null;
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }
  function dirtyPaced() {
    if (!paceTimer) paceTimer = setTimeout(dirtyNow, SYNC_PACE);
  }
  function flushPaced() { if (paceTimer) dirtyNow(); }

  var saveFailShown = false;
  function saveNow(paced) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }   // R30
    }
    if (paced) dirtyPaced(); else dirtyNow();
  }

  // R27: the stamp moves only on a real change, and always forward.
  function touch(row) { row.m = Math.max(Date.now(), (row.m || 0) + 1); }
  function sortColl(c) { data[c].sort(function (a, b) { return cmpStr(a.id, b.id); }); }
  function findRow(c, id) {
    var list = data[c] || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function putRow(c, row) {
    var i, list = data[c];
    for (i = 0; i < list.length; i++) if (list[i].id === row.id) { list[i] = row; return; }
    list.push(row);
    sortColl(c);
  }
  // Delete = tombstone at least as new as the row (it wins the tie).
  // Undo = the row comes back one step newer than the tombstone.
  function removeRow(c, id) {
    var row = findRow(c, id);
    if (!row) return null;
    data[c] = data[c].filter(function (r) { return r.id !== id; });
    var k = c + ":" + id;
    data.tombs[k] = Math.max(Date.now(), row.m, data.tombs[k] || 0);
    return row;
  }
  function restoreRow(c, row) {
    row.m = Math.max(Date.now(), (data.tombs[c + ":" + row.id] || 0) + 1);
    putRow(c, row);
  }
  function settings() { return settingsOf(data); }
  function editSettings(patch) {
    var s = JSON.parse(JSON.stringify(settings()));
    Object.keys(patch).forEach(function (k) { s[k] = patch[k]; });
    s.m = Math.max(Date.now(), (data.set ? data.set.m : 0) + 1);
    data.set = normSettings(s);
    saveNow(false);
  }

  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY)); } catch (e) {}
    p = p && typeof p === "object" ? p : {};
    var tabs = ["train", "history", "progress", "programs", "body"];
    prefs = {
      tab: tabs.indexOf(p.tab) >= 0 ? p.tab : "train",
      pe: typeof p.pe === "string" ? p.pe : "",
      pm: typeof p.pm === "string" ? p.pm : "",
      pr: ["1m", "3m", "6m", "1y", "all"].indexOf(p.pr) >= 0 ? p.pr : "3m",
      snd: p.snd === 0 ? 0 : 1,
      vib: p.vib === 0 ? 0 : 1,
      rest: p.rest && isInt(p.rest.end) && isInt(p.rest.total) ? { end: p.rest.end, total: p.rest.total, ex: normStr(p.rest.ex, NAME_LEN) } : null
    };
  }
  var prefsTimer = null;
  function savePrefs() { clearTimeout(prefsTimer); prefsTimer = setTimeout(savePrefsNow, 300); }
  function savePrefsNow() {
    clearTimeout(prefsTimer);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ---------- 6. UI shell: tabs, toolbar, toasts, dialogs ----------
  var UI = {
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    dumbbell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12"/></svg>',
    history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    body: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4.5" r="2"/><path d="M5 9h14M12 9v6M12 15l-3 6M12 15l3 6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 5.1A10.9 10.9 0 0 1 12 5c7 0 11 7 11 7a18 18 0 0 1-3.2 4M6.6 6.6C3.4 8.6 1 12 1 12s4 7 11 7a10.6 10.6 0 0 0 5.4-1.6"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>'
  };
  var TABS = [["train", "dumbbell"], ["history", "history"], ["progress", "chart"], ["programs", "list"], ["body", "body"]];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function iconBtn(cls, svg, label, fn) {
    var b = el("button", cls);
    b.type = "button";
    b.innerHTML = svg;            // our own constant markup only
    b.setAttribute("aria-label", label);
    b.title = label;
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function txtBtn(cls, svg, label, fn) {
    var b = el("button", cls);
    b.type = "button";
    if (svg) b.innerHTML = svg;
    b.appendChild(el("span", "", label));
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function section(title) {
    var s = el("section", "sec");
    if (title) s.appendChild(el("h2", "", title));
    return s;
  }
  function hint(text) { return el("p", "hint", text); }

  var MONTHS = {
    en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    el: ["Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος", "Μάιος", "Ιούνιος", "Ιούλιος", "Αύγουστος", "Σεπτέμβριος", "Οκτώβριος", "Νοέμβριος", "Δεκέμβριος"]
  };
  var MONTHS_GEN = ["Ιανουαρίου", "Φεβρουαρίου", "Μαρτίου", "Απριλίου", "Μαΐου", "Ιουνίου", "Ιουλίου", "Αυγούστου", "Σεπτεμβρίου", "Οκτωβρίου", "Νοεμβρίου", "Δεκεμβρίου"];
  function fmtDate(ys, withDay) {
    var d = parseYmd(ys);
    if (!d) return ys;
    var wd = withDay ? t("day." + wdIdx(d)) + " " : "";
    if (LANG === "el") return wd + d.getDate() + " " + MONTHS_GEN[d.getMonth()] + " " + d.getFullYear();
    return wd + MONTHS.en[d.getMonth()].slice(0, 3) + " " + d.getDate() + ", " + d.getFullYear();
  }
  function fmtShort(ys) {
    var d = parseYmd(ys);
    return d ? d.getDate() + "/" + (d.getMonth() + 1) : ys;
  }
  function fmtClock(ms) { var d = new Date(ms); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  function fmtVol(g) { return fmtNum(g / wFactor(settings().wu), 0) + " " + settings().wu; }

  // Dialogs (R32: centered, scroll inside)
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function makeDialog(id, title, wide) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "mm-dlg" + (wide ? " wide" : "");
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () {
      parkToast();
      setTimeout(function () { dlg.remove(); }, 0);
    });
    if (title) dlg.appendChild(el("div", "dlg-title", title));
    return dlg;
  }
  function openDialog(dlg) { document.body.appendChild(dlg); dlg.showModal(); }
  function confirmDialog(text, okLabel, danger, onOk) {
    var dlg = makeDialog("fit-confirm", null);
    dlg.appendChild(el("p", "dlg-text", text));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(okLabel, danger ? "danger" : "primary", function () { dlg.close(); onOk(); }));
    dlg.appendChild(acts);
    openDialog(dlg);
  }
  function field(label, input) {
    var w = el("label", "fld");
    w.appendChild(el("span", "fld-lbl", label));
    w.appendChild(input);
    return w;
  }
  function input(type, value, mode) {
    var i = el("input");
    i.type = type || "text";
    if (value !== undefined && value !== null) i.value = value;
    if (mode) i.inputMode = mode;
    i.autocomplete = "off";
    return i;
  }

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "fitness", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  function undoToast(text, onUndo) { localToast(text, onUndo); }
  var toastTimer = null;
  function localToast(text, onUndo) {
    var box = $("toast");
    if (!box) return;
    hostToast();
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

  // Tabs. The Train tab has two faces: the start screen and the
  // workout editor (editId). Leaving the tab keeps a running workout.
  var editId = null;
  function setTab(tab) {
    if (prefs.tab !== tab) { prefs.tab = tab; savePrefs(); }
    if (tab !== "train") editId = null;
    render();
    var v = $("view");
    if (v) v.scrollTop = 0;
  }
  function renderNav() {
    var nav = $("nav");
    nav.innerHTML = "";
    TABS.forEach(function (tb) {
      var b = txtBtn("nav-btn" + (prefs.tab === tb[0] ? " on" : ""), UI[tb[1]],
                     t(tb[0] === "programs" ? "nav.programs" : "tab." + tb[0]), function () { setTab(tb[0]); });
      b.setAttribute("aria-label", t("tab." + tb[0]));
      b.setAttribute("aria-current", prefs.tab === tb[0] ? "page" : "false");
      nav.appendChild(b);
    });
  }
  function setTitle(text) { $("title").textContent = text; }

  var pendingRender = false;
  function typing() {
    var a = document.activeElement;
    return !!(a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT") && $("view").contains(a));
  }
  function render() {
    pendingRender = false;
    stopTickers();
    renderNav();
    var v = $("view");
    v.innerHTML = "";
    var tab = prefs.tab;
    if (tab === "train") {
      var w = editId ? findRow("wo", editId) : null;
      if (editId && !w) editId = null;
      if (w) renderEditor(v, w); else renderTrain(v);
    } else if (tab === "history") renderHistory(v);
    else if (tab === "progress") renderProgress(v);
    else if (tab === "programs") renderPrograms(v);
    else renderBody(v);
    renderRest();
    updateWakeLock();
  }

  // ---------- 7. Train: start screen + workout editor + rest timer ----------
  function activeWorkout() {
    var best = null;
    (data.wo || []).forEach(function (w) { if (!w.en && (!best || w.st > best.st)) best = w; });
    return best;
  }
  function seedPg(id) {
    for (var i = 0; i < SEED_PG.length; i++) if (SEED_PG[i].id === id) return SEED_PG[i];
    return null;
  }
  function seedName(o) { return LANG === "el" ? o.el : o.en; }
  // A program day in one shape, own or ready: { pg, day, name, pgName }
  function dayRef(pgId, dayId) {
    var p = findRow("pg", pgId), sp = p ? null : seedPg(pgId), days = p ? p.days : (sp ? sp.days : []);
    for (var i = 0; i < days.length; i++) {
      if (days[i].id === dayId) {
        return { pg: pgId, day: days[i], name: p ? (days[i].n || t("pg.dayN", { n: i + 1 })) : seedName(days[i]),
                 pgName: p ? p.n : seedName(sp) };
      }
    }
    return null;
  }

  function renderTrain(v) {
    setTitle(t("app"));
    var act = activeWorkout();
    if (act) {
      var s = section(null);
      var card = el("button", "run-card");
      card.type = "button";
      card.appendChild(el("span", "run-k", t("train.running")));
      card.appendChild(el("span", "run-t", act.ti || t("wo.title")));
      var tick = el("span", "run-time", fmtTime((Date.now() - act.st) / 1000));
      card.appendChild(tick);
      card.appendChild(el("span", "run-go", t("train.resume")));
      card.addEventListener("click", function () { openEditor(act.id); });
      startTicker(function () { tick.textContent = fmtTime((Date.now() - act.st) / 1000); });
      s.appendChild(card);
      v.appendChild(s);
    }

    // Today
    var today = wdIdx(new Date()), todays = [];
    data.pg.forEach(function (p) {
      p.days.forEach(function (d) { if (d.wd.indexOf(today) >= 0 && d.it.length) todays.push(dayRef(p.id, d.id)); });
    });
    var st = section(t("train.today"));
    if (todays.length) todays.forEach(function (r) { st.appendChild(dayCard(r, !!act)); });
    else st.appendChild(hint(t("train.todayNone")));
    var empty = el("button", "big-btn");
    empty.type = "button";
    empty.disabled = !!act;
    empty.innerHTML = UI.plus;
    var eb = el("span", "");
    eb.appendChild(el("b", "", t("train.empty")));
    eb.appendChild(el("small", "", t("train.emptySub")));
    empty.appendChild(eb);
    empty.addEventListener("click", function () { startWorkout(null); });
    st.appendChild(empty);
    v.appendChild(st);

    // This week
    var fin = finished(data), ws = ymd(weekStart(new Date())), n = 0, sets = 0, last = null;
    fin.forEach(function (w) {
      if (w.d >= ws) { n++; sets += woSets(w); }
      if (!last || w.st > last.st) last = w;
    });
    var sw = section(t("train.week"));
    sw.appendChild(el("p", "stat-line", t("train.weekStat", { n: n, sets: sets })));
    if (last) sw.appendChild(el("p", "hint", t("train.last", { date: fmtDate(last.d, true) })));
    v.appendChild(sw);

    // All program days
    var sp = section(t("train.from"));
    var any = false;
    data.pg.forEach(function (p) {
      var days = p.days.filter(function (d) { return d.it.length; });
      if (!days.length) return;
      any = true;
      sp.appendChild(el("h3", "sub-h", p.n));
      days.forEach(function (d) { sp.appendChild(dayCard(dayRef(p.id, d.id), !!act)); });
    });
    var det = el("details", "ready");
    if (!any) det.open = true;
    det.appendChild(el("summary", "", t("pg.ready")));
    SEED_PG.forEach(function (p) {
      det.appendChild(el("h3", "sub-h", seedName(p)));
      p.days.forEach(function (d) { det.appendChild(dayCard(dayRef(p.id, d.id), !!act)); });
    });
    sp.appendChild(det);
    v.appendChild(sp);
  }

  function dayCard(r, busy) {
    var row = el("div", "day-card");
    var txt = el("div", "day-txt");
    txt.appendChild(el("b", "", r.name));
    txt.appendChild(el("small", "", r.day.it.map(function (i) { return exInfo(data, i.e).name; }).join(" · ")));
    var wd = r.day.wd.map(function (d) { return t("day." + d); }).join(" ");
    if (wd) txt.appendChild(el("small", "dim", wd));
    row.appendChild(txt);
    var b = txtBtn("go-btn", UI.play, t("train.start"), function () { startWorkout(r); });
    b.disabled = busy;
    row.appendChild(b);
    return row;
  }

  // Fill a new entry from last time (weights and reps per set) or
  // from the program's target when the exercise is new.
  function makeEntry(exId, item, at) {
    var info = exInfo(data, exId), prev = lastEntry(data, exId, at, null);
    var prevWork = prev ? prev.s.filter(function (s) { return !isWarm(s); }) : [];
    var n = item ? item.s : (prevWork.length || 3);
    var sets = [];
    for (var i = 0; i < n; i++) {
      var p = prevWork[Math.min(i, prevWork.length - 1)];
      var s = p ? [p[0], p[1], p[2], p[3], 0] : [item ? item.w : 0, item ? item.r : 0, item ? item.t : 0, 0, 0];
      if (item && !p) {
        if (info.k === "wr" || info.k === "r") s[1] = item.r || 0;
      }
      sets.push(s);
    }
    return { e: exId, tr: item ? item.r : (prev ? prev.tr : 0), tr2: item ? item.r2 : (prev ? prev.tr2 : 0),
             rest: item ? item.rest : (prev ? prev.rest : 0), s: sets };
  }

  function startWorkout(ref) {
    if (activeWorkout()) return;
    var now = Date.now();
    var w = { id: newId(), m: now, d: ymd(new Date(now)), st: now, en: 0,
              ti: ref ? ref.name : t("wo.title"), p: ref ? ref.pg : "", pd: ref ? ref.day.id : "", n: "", x: [] };
    if (ref) ref.day.it.forEach(function (it) { w.x.push(makeEntry(it.e, it, now)); });
    w = normWo(w);
    putRow("wo", w);
    saveNow(true);
    announced = {};
    openEditor(w.id);
  }
  function openEditor(id) {
    editId = id;
    if (prefs.tab !== "train") { prefs.tab = "train"; savePrefs(); }
    render();
    $("view").scrollTop = 0;
  }

  // Every editor change goes through here: stamp, write, pace.
  function woChanged(w, rerender) {
    touch(w);
    saveNow(!w.en);
    if (rerender) {
      var v = $("view"), top = v.scrollTop;
      render();
      v.scrollTop = top;
    }
  }

  var announced = {};   // records already toasted in this session: "e|k" → value
  function checkRecords(w) {
    if (w.en) return;
    var fresh = {}, order = [];
    recordsOf(data, w).forEach(function (r) {
      var key = r.e + "|" + r.k;
      if (announced[key] >= r.v) return;
      announced[key] = r.v;
      if (!fresh[r.e]) { fresh[r.e] = []; order.push(r.e); }
      fresh[r.e].push(r);
    });
    order.forEach(function (e) {      // one toast per exercise
      var info = exInfo(data, e);
      showToast("🏆 " + t("pr.toast", { ex: info.name, what: fresh[e].map(function (r) {
        return t(PR_LABEL[r.k]) + " " + fmtRecord(r, info.k, settings());
      }).join(", ") }));
    });
  }

  function renderEditor(v, w) {
    var set = settings(), running = !w.en;
    setTitle(running ? (w.ti || t("wo.title")) : t("wo.editTitle"));
    var head = el("section", "sec wo-head");
    var ti = input("text", w.ti);
    ti.maxLength = NAME_LEN;
    ti.className = "wo-ti";
    ti.setAttribute("aria-label", t("wo.title"));
    ti.addEventListener("change", function () {
      var x = findRow("wo", w.id);
      if (!x) return;
      x.ti = normStr(ti.value, NAME_LEN);
      woChanged(x, false);
      if (running) setTitle(x.ti || t("wo.title"));
    });
    head.appendChild(ti);
    if (running) {
      var clock = el("div", "wo-clock", fmtTime((Date.now() - w.st) / 1000));
      clock.setAttribute("aria-label", t("wo.elapsed"));
      startTicker(function () { clock.textContent = fmtTime((Date.now() - w.st) / 1000); });
      head.appendChild(clock);
    } else {
      var row = el("div", "wo-when");
      var di = input("date", w.d);
      var si = input("time", fmtClock(w.st));
      var mi = input("number", String(woMinutes(w)), "numeric");
      mi.min = "0"; mi.max = "1440";
      var apply = function () {
        var x = findRow("wo", w.id), d = parseYmd(di.value), tm = /^(\d{2}):(\d{2})$/.exec(si.value), mins = parseInt(mi.value, 10);
        if (!x || !d || !tm || !(mins >= 0 && mins <= 1440)) return;
        d.setHours(+tm[1], +tm[2], 0, 0);
        x.d = ymd(d); x.st = d.getTime(); x.en = x.st + Math.max(1, mins) * 60000;
        woChanged(x, false);
      };
      [di, si, mi].forEach(function (i) { i.addEventListener("change", apply); });
      row.appendChild(field(t("wo.date"), di));
      row.appendChild(field(t("wo.startTime"), si));
      row.appendChild(field(t("wo.minutes"), mi));
      head.appendChild(row);
    }
    v.appendChild(head);

    w.x.forEach(function (e, ei) { v.appendChild(entryCard(w, e, ei, set)); });

    var add = txtBtn("wide-btn", UI.plus, t("wo.addEx"), function () {
      pickExercise(function (exId) {
        var x = findRow("wo", w.id);
        if (!x || x.x.length >= MAX_ITEMS) return;
        x.x.push(makeEntry(exId, null, x.st));
        woChanged(x, true);
      });
    });
    v.appendChild(add);

    var ns = section(t("wo.note"));
    var ta = el("textarea", "note");
    ta.value = w.n;
    ta.maxLength = NOTE_LEN;
    ta.rows = 3;
    ta.setAttribute("aria-label", t("wo.note"));
    ta.addEventListener("change", function () {
      var x = findRow("wo", w.id);
      if (!x) return;
      x.n = normNote(ta.value);
      woChanged(x, false);
    });
    ns.appendChild(ta);
    v.appendChild(ns);

    var acts = el("div", "wo-actions");
    if (running) {
      acts.appendChild(button(t("wo.discard"), "danger", function () {
        confirmDialog(t("wo.discardQ"), t("wo.discard"), true, function () {
          removeRow("wo", w.id);
          saveNow(false);
          stopRest();
          editId = null;
          render();
        });
      }));
      acts.appendChild(button(t("wo.finish"), "primary", function () { finishWorkout(w.id); }));
    } else {
      acts.appendChild(button(t("hist.del"), "danger", function () { deleteWorkout(w.id); }));
      acts.appendChild(button(t("wo.done"), "primary", function () { editId = null; setTab("history"); }));
    }
    v.appendChild(acts);
  }

  function setLabel(info) {
    var u = settings();
    if (info.k === "wr") return [u.wu === "lb" ? t("col.lb") : t("col.kg"), t("col.reps")];
    if (info.k === "r") return [t("col.reps")];
    if (info.k === "t") return [t("col.time")];
    return [u.du === "mi" ? t("col.mi") : t("col.km"), t("col.time")];
  }
  function setSummary(s, info, set) {
    if (info.k === "wr") return fmtW(s[0], set.wu) + " " + set.wu + " × " + s[1];
    if (info.k === "r") return s[1] + "×";
    if (info.k === "t") return fmtTime(s[2]);
    return fmtDist(s[3], set.du) + " · " + fmtTime(s[2]);
  }

  function entryCard(w, e, ei, set) {
    var info = exInfo(data, e.e);
    var card = el("section", "ex-card");
    var top = el("div", "ex-top");
    var nm = el("div", "ex-name");
    nm.appendChild(el("b", "", info.name));
    var meta = [];
    if (e.tr || e.s.length) {
      var rr = e.tr ? (e.tr2 ? e.tr + "–" + e.tr2 : String(e.tr)) : "";
      if (rr) meta.push(t("wo.target", { s: e.s.filter(function (s) { return !isWarm(s); }).length, r: rr }));
    }
    meta.push(t("wo.rest", { t: fmtTime(e.rest || set.rest) }));
    nm.appendChild(el("small", "", meta.join(" · ")));
    top.appendChild(nm);
    var mv = el("div", "ex-tools");
    var up = iconBtn("mini", UI.up, t("wo.moveUp"), function () { moveEntry(w.id, ei, -1); });
    up.disabled = ei === 0;
    var dn = iconBtn("mini", UI.down, t("wo.moveDown"), function () { moveEntry(w.id, ei, 1); });
    dn.disabled = ei === w.x.length - 1;
    mv.appendChild(up);
    mv.appendChild(dn);
    mv.appendChild(iconBtn("mini danger", UI.x, t("wo.removeEx"), function () {
      var x = findRow("wo", w.id);
      if (!x || !x.x[ei]) return;
      var gone = x.x.splice(ei, 1)[0];
      woChanged(x, true);
      undoToast(info.name, function () {
        var y = findRow("wo", w.id);
        if (!y) return;
        y.x.splice(Math.min(ei, y.x.length), 0, gone);
        woChanged(y, true);
      });
    }));
    top.appendChild(mv);
    card.appendChild(top);

    var prev = lastEntry(data, e.e, w.st, w.id);
    var prevWork = prev ? prev.s.filter(function (s) { return !isWarm(s) && isDone(s); }) : [];
    var hintRow = el("div", "ex-prev");
    hintRow.appendChild(el("span", "", prev ? t("wo.prev") + ": " + prevWork.map(function (s) { return setSummary(s, info, set); }).join(", ")
                                               : t("wo.prevNone")));
    var sug = suggestW(prev, info, set);
    if (sug && !w.en && e.s.some(function (s) { return !isWarm(s) && !isDone(s) && s[0] < sug; })) {
      var chip = el("button", "sug-chip", "↑ " + t("wo.suggest", { w: fmtW(sug, set.wu) + " " + set.wu }));
      chip.type = "button";
      chip.setAttribute("aria-label", t("wo.suggestAria", { w: fmtW(sug, set.wu) + " " + set.wu }));
      chip.addEventListener("click", function () {
        var x = findRow("wo", w.id);
        if (!x || !x.x[ei]) return;
        x.x[ei].s.forEach(function (s) { if (!isWarm(s) && !isDone(s)) s[0] = sug; });
        woChanged(x, true);
      });
      hintRow.appendChild(chip);
    }
    card.appendChild(hintRow);

    var tbl = el("div", "sets k-" + info.k);
    var hdr = el("div", "set-row set-hdr");
    hdr.appendChild(el("span", "c-n", t("col.set")));
    setLabel(info).forEach(function (l) { hdr.appendChild(el("span", "c-v", l)); });
    hdr.appendChild(el("span", "c-ok", ""));
    tbl.appendChild(hdr);
    var nWork = 0;
    e.s.forEach(function (s, si) {
      var warm = isWarm(s);
      if (!warm) nWork++;
      tbl.appendChild(setRow(w, e, ei, s, si, warm ? "W" : String(nWork), info, set));
    });
    card.appendChild(tbl);

    var foot = el("div", "ex-foot");
    foot.appendChild(txtBtn("link-btn", UI.plus, t("wo.addSet"), function () { addSet(w.id, ei, false); }));
    foot.appendChild(txtBtn("link-btn dim", UI.plus, t("wo.warm"), function () { addSet(w.id, ei, true); }));
    card.appendChild(foot);
    return card;
  }

  function setRow(w, e, ei, s, si, label, info, set) {
    var row = el("div", "set-row" + (isDone(s) ? " done" : "") + (isWarm(s) ? " warm" : ""));
    var num = iconBtn("c-n set-n", "", t("wo.delSet", { n: label }), function () {
      var x = findRow("wo", w.id);
      if (!x || !x.x[ei] || !x.x[ei].s[si]) return;
      var gone = x.x[ei].s.splice(si, 1)[0];
      woChanged(x, true);
      undoToast(t("wo.delSet", { n: label }), function () {
        var y = findRow("wo", w.id);
        if (!y || !y.x[ei]) return;
        y.x[ei].s.splice(Math.min(si, y.x[ei].s.length), 0, gone);
        woChanged(y, true);
      });
    });
    num.textContent = label;
    row.appendChild(num);

    function cell(value, mode, parse, fmt, idx, aria) {
      var i = input("text", fmt(value), mode);
      i.className = "c-v";
      i.setAttribute("aria-label", aria + " · " + t("col.set") + " " + label);
      i.addEventListener("focus", function () { try { i.select(); } catch (er) {} });
      i.addEventListener("input", function () {
        var raw = i.value.trim(), v = raw === "" ? 0 : parse(raw);
        i.classList.toggle("bad", isNaN(v));
        if (isNaN(v)) return;
        var x = findRow("wo", w.id);
        if (!x || !x.x[ei] || !x.x[ei].s[si]) return;
        if (x.x[ei].s[si][idx] === v) return;
        x.x[ei].s[si][idx] = v;
        woChanged(x, false);
      });
      i.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") { ev.preventDefault(); i.blur(); }
      });
      return i;
    }
    var lbl = setLabel(info);
    if (info.k === "wr") {
      row.appendChild(cell(s[0], "decimal", function (r) { return parseW(r, set.wu); }, function (g) { return g ? fmtW(g, set.wu) : ""; }, 0, lbl[0]));
      row.appendChild(cell(s[1], "numeric", parseReps, function (n) { return n ? String(n) : ""; }, 1, lbl[1]));
    } else if (info.k === "r") {
      row.appendChild(cell(s[1], "numeric", parseReps, function (n) { return n ? String(n) : ""; }, 1, lbl[0]));
    } else if (info.k === "t") {
      row.appendChild(cell(s[2], "text", parseTime, function (n) { return n ? fmtTime(n) : ""; }, 2, lbl[0]));
    } else {
      row.appendChild(cell(s[3], "decimal", function (r) { return parseDist(r, set.du); }, function (m) { return m ? fmtDist(m, set.du) : ""; }, 3, lbl[0]));
      row.appendChild(cell(s[2], "text", parseTime, function (n) { return n ? fmtTime(n) : ""; }, 2, lbl[1]));
    }
    var ok = iconBtn("c-ok tick" + (isDone(s) ? " on" : ""), UI.check,
                     t(isDone(s) ? "wo.untick" : "wo.tick", { n: label }), function () { toggleSet(w.id, ei, si); });
    ok.setAttribute("aria-pressed", isDone(s) ? "true" : "false");
    row.appendChild(ok);
    return row;
  }

  function toggleSet(woId, ei, si) {
    var x = findRow("wo", woId);
    if (!x || !x.x[ei] || !x.x[ei].s[si]) return;
    var e = x.x[ei], s = e.s[si];
    s[4] ^= F_DONE;
    woChanged(x, true);
    if (isDone(s) && !x.en) {
      if (!isWarm(s)) checkRecords(x);
      var next = null;
      for (var i = si + 1; i < e.s.length; i++) if (!isDone(e.s[i])) { next = exInfo(data, e.e).name; break; }
      if (!next) for (var j = ei + 1; j < x.x.length; j++) if (x.x[j].s.some(function (q) { return !isDone(q); })) { next = exInfo(data, x.x[j].e).name; break; }
      startRest(e.rest || settings().rest, next);
    }
  }
  function addSet(woId, ei, warm) {
    var x = findRow("wo", woId);
    if (!x || !x.x[ei] || x.x[ei].s.length >= MAX_SETS) return;
    var e = x.x[ei], last = null;
    e.s.forEach(function (s) { if (isWarm(s) === warm) last = s; });
    var s = last ? [last[0], last[1], last[2], last[3], warm ? F_WARM : 0] : [0, 0, 0, 0, warm ? F_WARM : 0];
    if (warm) {
      var firstWork = e.s.filter(function (q) { return !isWarm(q); })[0];
      if (!last && firstWork) s = [Math.round(firstWork[0] / 2), firstWork[1], firstWork[2], firstWork[3], F_WARM];
      var at = 0;
      while (at < e.s.length && isWarm(e.s[at])) at++;
      e.s.splice(at, 0, s);
    } else e.s.push(s);
    woChanged(x, true);
  }
  function moveEntry(woId, ei, dir) {
    var x = findRow("wo", woId), j = ei + dir;
    if (!x || j < 0 || j >= x.x.length) return;
    var tmp = x.x[ei]; x.x[ei] = x.x[j]; x.x[j] = tmp;
    woChanged(x, true);
  }

  function finishWorkout(id) {
    var w = findRow("wo", id);
    if (!w) return;
    var done = 0, open = 0;
    w.x.forEach(function (e) { e.s.forEach(function (s) { if (isDone(s)) done++; else open++; }); });
    if (!done) { showToast(t("wo.noSets")); return; }
    var go = function () {
      var x = findRow("wo", id);
      if (!x) return;
      x.x.forEach(function (e) { e.s = e.s.filter(isDone); });
      x.x = x.x.filter(function (e) { return e.s.length; });
      x.en = Math.max(Date.now(), x.st + 60000);
      touch(x);
      saveNow(false);
      stopRest();
      editId = null;
      render();
      summaryDialog(x);
    };
    if (open) confirmDialog(t("wo.finishQ") + " " + t("wo.finishOpen", { n: open }), t("wo.finish"), false, go);
    else go();
  }

  function summaryDialog(w) {
    var set = settings();
    var dlg = makeDialog("fit-sum", t("sum.title"));
    dlg.appendChild(el("div", "sum-name", w.ti || t("wo.title")));
    var grid = el("div", "sum-grid");
    [[t("sum.duration"), t("unit.min", { n: woMinutes(w) })], [t("sum.volume"), fmtVol(woVolume(w))], [t("sum.sets"), String(woSets(w))]]
      .forEach(function (p) {
        var c = el("div", "sum-cell");
        c.appendChild(el("b", "", p[1]));
        c.appendChild(el("small", "", p[0]));
        grid.appendChild(c);
      });
    dlg.appendChild(grid);
    var recs = recordsOf(data, w);
    dlg.appendChild(el("div", "dlg-sub", t("sum.records")));
    if (!recs.length) dlg.appendChild(hint(t("sum.none")));
    var ul = el("ul", "rec-list");
    recs.forEach(function (r) {
      var info = exInfo(data, r.e), li = el("li", "");
      li.innerHTML = UI.trophy;
      li.appendChild(el("span", "", info.name + " · " + t(PR_LABEL[r.k]) + ": " + fmtRecord(r, info.k, set)));
      ul.appendChild(li);
    });
    dlg.appendChild(ul);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    openDialog(dlg);
    live(t("sum.title"));
  }

  function deleteWorkout(id) {
    var row = removeRow("wo", id);
    if (!row) return;
    saveNow(false);
    if (editId === id) editId = null;
    var d = $("fit-wo");
    if (d) d.close();
    if (prefs.tab === "train") prefs.tab = "history";
    render();
    undoToast(t("hist.deleted"), function () {
      restoreRow("wo", row);
      saveNow(false);
      render();
    });
  }

  // Exercise picker: search + list by muscle group, hidden ones left out.
  function pickExercise(onPick) {
    var dlg = makeDialog("fit-pick", t("ex.pick"), true);
    var q = input("search", "");
    q.placeholder = t("ex.search");
    q.setAttribute("aria-label", t("ex.search"));
    dlg.appendChild(q);
    var list = el("div", "pick-list");
    dlg.appendChild(list);
    function paint() {
      list.innerHTML = "";
      var needle = q.value.trim().toLowerCase();
      var all = allExercises(data).filter(function (x) {
        if (needle) return x.name.toLowerCase().indexOf(needle) >= 0 || t("g." + x.g).toLowerCase().indexOf(needle) >= 0;
        return !x.h;
      });
      GROUPS.forEach(function (g) {
        var rows = all.filter(function (x) { return x.g === g; })
                      .sort(function (a, b) { return a.name.localeCompare(b.name, LANG); });
        if (!rows.length) return;
        list.appendChild(el("div", "pick-g", t("g." + g)));
        rows.forEach(function (x) {
          var b = el("button", "pick-item");
          b.type = "button";
          b.appendChild(el("span", "", x.name));
          b.appendChild(el("small", "", t("kind." + x.k)));
          b.addEventListener("click", function () { dlg.close(); onPick(x.id); });
          list.appendChild(b);
        });
      });
    }
    q.addEventListener("input", paint);
    paint();
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("ex.new"), "primary", function () {
      dlg.close();
      exerciseDialog(null, function (id) { onPick(id); });
    }));
    dlg.appendChild(acts);
    openDialog(dlg);
    q.focus();
  }

  function exerciseDialog(info, onSaved) {
    var dlg = makeDialog("fit-ex", t(info ? "ex.edit" : "ex.new"));
    var form = el("form");
    form.method = "dialog";
    var name = input("text", info ? info.name : "");
    name.maxLength = NAME_LEN;
    form.appendChild(field(t("ex.name"), name));
    var g = el("select");
    GROUPS.forEach(function (x) { var o = el("option", "", t("g." + x)); o.value = x; g.appendChild(o); });
    g.value = info ? info.g : "chest";
    form.appendChild(field(t("ex.group"), g));
    var k = el("select");
    KINDS.forEach(function (x) { var o = el("option", "", t("kind." + x)); o.value = x; k.appendChild(o); });
    k.value = info ? info.k : "wr";
    k.disabled = !!(info && (info.seed || usedExercise(info.id)));   // a measure never changes under logged sets
    form.appendChild(field(t("ex.kind"), k));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var n = normStr(name.value, NAME_LEN);
      if (!n && !(info && info.seed)) { showToast(t("ex.needName")); name.focus(); return; }
      var row = info ? findRow("ex", info.id) : null;
      if (info && info.seed && n === seedName(SEED_MAP[info.id])) n = "";   // unchanged ready name stays translatable
      if (row) { row.n = n; row.g = g.value; if (!k.disabled) row.k = k.value; touch(row); }
      else row = { id: info ? info.id : newId(), m: Date.now(), n: n, g: g.value, k: info ? info.k : k.value, h: info ? info.h : 0 };
      row = normEx(row);
      if (!row) return;
      putRow("ex", row);
      saveNow(false);
      dlg.close();
      if (onSaved) onSaved(row.id);
      else render();
    });
    dlg.appendChild(form);
    openDialog(dlg);
    name.focus();
  }
  function usedExercise(id) {
    return data.wo.some(function (w) { return w.x.some(function (e) { return e.e === id; }); });
  }
  function setHidden(id, h) {
    var row = findRow("ex", id), info = exInfo(data, id);
    if (!row) row = { id: id, m: Date.now(), n: "", g: info.g, k: info.k, h: 0 };
    row.h = h ? 1 : 0;
    touch(row);
    putRow("ex", normEx(row));
    saveNow(false);
  }

  // Rest timer: on this device only (never the shell's synced alarms,
  // which would upload per set and ring on every device).
  var restIv = null, restEndedFor = 0;
  function startRest(sec, next) {
    if (!(sec > 0)) { stopRest(); return; }
    prefs.rest = { end: Date.now() + sec * 1000, total: sec, ex: next || "" };
    savePrefs();
    renderRest();
  }
  function stopRest() {
    prefs.rest = null;
    savePrefs();
    renderRest();
  }
  function shiftRest(d) {
    if (!prefs.rest) return;
    prefs.rest.end += d * 1000;
    prefs.rest.total = Math.max(1, prefs.rest.total + d);
    if (prefs.rest.end <= Date.now()) { stopRest(); return; }
    savePrefs();
    paintRest();
  }
  function renderRest() {
    var bar = $("rest");
    clearInterval(restIv);
    restIv = null;
    if (!prefs.rest || prefs.rest.end <= Date.now() || !activeWorkout()) {
      if (prefs.rest && prefs.rest.end <= Date.now()) { prefs.rest = null; savePrefs(); }
      bar.hidden = true;
      document.body.classList.remove("resting");
      return;
    }
    bar.innerHTML = "";
    var lab = el("div", "rest-txt");
    lab.appendChild(el("small", "", t("rest.title")));
    lab.appendChild(el("b", "rest-time", ""));
    if (prefs.rest.ex) lab.appendChild(el("small", "rest-next", t("rest.next", { ex: prefs.rest.ex })));
    bar.appendChild(lab);
    var prog = el("div", "rest-prog");
    prog.appendChild(el("i", ""));
    bar.appendChild(prog);
    var btns = el("div", "rest-btns");
    btns.appendChild(button(t("rest.minus"), "", function () { shiftRest(-15); }));
    btns.appendChild(button(t("rest.plus"), "", function () { shiftRest(15); }));
    btns.appendChild(button(t("rest.skip"), "primary", stopRest));
    bar.appendChild(btns);
    bar.hidden = false;
    document.body.classList.add("resting");
    paintRest();
    restIv = setInterval(paintRest, 250);
  }
  function paintRest() {
    var r = prefs.rest, bar = $("rest");
    if (!r || bar.hidden) return;
    var left = Math.max(0, Math.ceil((r.end - Date.now()) / 1000));
    var tm = bar.querySelector(".rest-time"), fill = bar.querySelector(".rest-prog i");
    if (tm) tm.textContent = fmtTime(left);
    if (fill) fill.style.width = Math.min(100, 100 * left / Math.max(1, r.total)) + "%";
    if (left <= 0) restOver(r);
  }
  function restOver(r) {
    if (restEndedFor === r.end) return;
    restEndedFor = r.end;
    if (prefs.snd) chime();
    if (prefs.vib) { try { navigator.vibrate && navigator.vibrate([250, 120, 250]); } catch (e) {} }
    live(t("rest.over"));
    var shown = false;
    try {
      if (document.hidden && window.Notification && Notification.permission === "granted") {
        new Notification(t("rest.over"), { body: r.ex ? t("rest.next", { ex: r.ex }) : "", tag: "oros-fitness-rest" });
        shown = true;
      }
    } catch (e) {}
    if (!shown) showToast(t("rest.over"));
    stopRest();
  }
  var actx = null;
  function chime() {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") actx.resume();
      var at = actx.currentTime + 0.02;
      [880, 1175].forEach(function (f, i) {
        var o = actx.createOscillator(), g = actx.createGain();
        o.type = "sine";
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, at + i * 0.22);
        g.gain.exponentialRampToValueAtTime(0.25, at + i * 0.22 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, at + i * 0.22 + 0.35);
        o.connect(g); g.connect(actx.destination);
        o.start(at + i * 0.22); o.stop(at + i * 0.22 + 0.4);
      });
    } catch (e) {}
  }

  // Tickers (elapsed clocks) live only while their view is painted.
  var tickers = [];
  function startTicker(fn) { tickers.push(setInterval(fn, 1000)); }
  function stopTickers() { tickers.forEach(clearInterval); tickers = []; }

  // Keep the screen on while a running workout is on screen.
  var wakeLock = null;
  function updateWakeLock() {
    var want = prefs.tab === "train" && editId && activeWorkout() && activeWorkout().id === editId && !document.hidden;
    if (want && !wakeLock && navigator.wakeLock && navigator.wakeLock.request) {
      wakeLock = "pending";
      navigator.wakeLock.request("screen").then(function (l) {
        wakeLock = l;
        l.addEventListener("release", function () { if (wakeLock === l) wakeLock = null; });
        if (!(prefs.tab === "train" && editId)) releaseWake();
      }, function () { wakeLock = null; });
    } else if (!want) releaseWake();
  }
  function releaseWake() {
    if (wakeLock && wakeLock !== "pending") { try { wakeLock.release(); } catch (e) {} }
    if (wakeLock !== "pending") wakeLock = null;
  }

  // ---------- 8. History ----------
  var histFilter = { e: "", p: "", q: "", shown: 40 };
  function renderHistory(v) {
    setTitle(t("tab.history"));
    var fin = finished(data).slice().sort(function (a, b) { return b.st - a.st || cmpStr(b.id, a.id); });
    if (!fin.length) { v.appendChild(section(null)).appendChild(hint(t("hist.empty"))); return; }

    var bar = el("div", "filters");
    var se = el("select");
    se.setAttribute("aria-label", t("prog.exercise"));
    var o0 = el("option", "", t("hist.filterEx")); o0.value = ""; se.appendChild(o0);
    usedExIds(fin).forEach(function (x) { var o = el("option", "", x.name); o.value = x.id; se.appendChild(o); });
    se.value = histFilter.e;
    var sp = el("select");
    sp.setAttribute("aria-label", t("tab.programs"));
    var p0 = el("option", "", t("hist.filterPg")); p0.value = ""; sp.appendChild(p0);
    var pgs = {};
    fin.forEach(function (w) { if (w.p) pgs[w.p] = 1; });
    Object.keys(pgs).forEach(function (id) {
      var p = findRow("pg", id), s = seedPg(id);
      if (!p && !s) return;
      var o = el("option", "", p ? p.n : seedName(s)); o.value = id; sp.appendChild(o);
    });
    sp.value = histFilter.p;
    var q = input("search", histFilter.q);
    q.placeholder = t("hist.search");
    q.setAttribute("aria-label", t("hist.search"));
    bar.appendChild(se); bar.appendChild(sp); bar.appendChild(q);
    v.appendChild(bar);
    var list = el("div", "hist-list");
    v.appendChild(list);

    function paint() {
      list.innerHTML = "";
      var needle = histFilter.q.trim().toLowerCase();
      var rows = fin.filter(function (w) {
        if (histFilter.e && !w.x.some(function (e) { return e.e === histFilter.e; })) return false;
        if (histFilter.p && w.p !== histFilter.p) return false;
        if (needle && (w.n + " " + w.ti).toLowerCase().indexOf(needle) < 0) return false;
        return true;
      });
      var month = "", shown = rows.slice(0, histFilter.shown);
      shown.forEach(function (w) {
        var mk = w.d.slice(0, 7);
        if (mk !== month) {
          month = mk;
          var cnt = rows.filter(function (r) { return r.d.slice(0, 7) === mk; }).length;
          list.appendChild(el("h3", "month-h", MONTHS[LANG][+mk.slice(5) - 1] + " " + mk.slice(0, 4) + " · " + t("hist.count", { n: cnt })));
        }
        var b = el("button", "hist-card");
        b.type = "button";
        b.appendChild(el("b", "", w.ti || t("wo.title")));
        b.appendChild(el("small", "", fmtDate(w.d, true) + " · " + fmtClock(w.st)));
        b.appendChild(el("small", "dim", t("unit.min", { n: woMinutes(w) }) + " · " + fmtVol(woVolume(w)) + " · " + t("unit.sets", { n: woSets(w) })));
        b.addEventListener("click", function () { workoutDialog(w.id); });
        list.appendChild(b);
      });
      if (rows.length > shown.length) {
        list.appendChild(txtBtn("wide-btn", null, "+" + (rows.length - shown.length), function () {
          histFilter.shown += 40;
          paint();
        }));
      }
      if (!rows.length) list.appendChild(hint(t("prog.noData")));
    }
    se.addEventListener("change", function () { histFilter.e = se.value; histFilter.shown = 40; paint(); });
    sp.addEventListener("change", function () { histFilter.p = sp.value; histFilter.shown = 40; paint(); });
    q.addEventListener("input", function () { histFilter.q = q.value; histFilter.shown = 40; paint(); });
    paint();
  }
  function usedExIds(wos) {
    var ids = {};
    wos.forEach(function (w) { w.x.forEach(function (e) { ids[e.e] = 1; }); });
    return Object.keys(ids).map(function (id) { return exInfo(data, id); })
      .sort(function (a, b) { return a.name.localeCompare(b.name, LANG); });
  }

  function workoutDialog(id) {
    var w = findRow("wo", id), set = settings();
    if (!w) { showToast(t("feed.deleted")); return; }
    if (!w.en) { openEditor(w.id); return; }
    var dlg = makeDialog("fit-wo", w.ti || t("wo.title"), true);
    dlg.appendChild(el("div", "dlg-sub", fmtDate(w.d, true) + " · " + fmtClock(w.st) + "–" + fmtClock(w.en)));
    var grid = el("div", "sum-grid");
    [[t("sum.duration"), t("unit.min", { n: woMinutes(w) })], [t("sum.volume"), fmtVol(woVolume(w))], [t("sum.sets"), String(woSets(w))]]
      .forEach(function (p) {
        var c = el("div", "sum-cell");
        c.appendChild(el("b", "", p[1]));
        c.appendChild(el("small", "", p[0]));
        grid.appendChild(c);
      });
    dlg.appendChild(grid);
    w.x.forEach(function (e) {
      var info = exInfo(data, e.e), box = el("div", "wo-ex");
      box.appendChild(el("b", "", info.name));
      box.appendChild(el("small", "", e.s.map(function (s) { return (isWarm(s) ? "W " : "") + setSummary(s, info, set); }).join(" · ")));
      dlg.appendChild(box);
    });
    var recs = recordsOf(data, w);
    if (recs.length) {
      var ul = el("ul", "rec-list");
      recs.forEach(function (r) {
        var info = exInfo(data, r.e), li = el("li", "");
        li.innerHTML = UI.trophy;
        li.appendChild(el("span", "", info.name + " · " + t(PR_LABEL[r.k]) + ": " + fmtRecord(r, info.k, set)));
        ul.appendChild(li);
      });
      dlg.appendChild(ul);
    }
    if (w.n) dlg.appendChild(el("p", "wo-note", w.n));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.delete"), "danger", function () { dlg.close(); deleteWorkout(w.id); }));
    acts.appendChild(button(t("hist.edit"), "", function () { dlg.close(); openEditor(w.id); }));
    acts.appendChild(button(t("dlg.close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    openDialog(dlg);
  }

  // ---------- 9. Progress: charts ----------
  // Hand-made SVG, one series per chart in the shell's accent colour,
  // so no legend: the chart title names the series. Every chart has
  // a hover / tap tooltip and the same numbers as a table.
  var SVGNS = "http://www.w3.org/2000/svg";
  function sv(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }
  // Charts are drawn before their section joins the page, so the
  // width comes from the view's content box (max 760 px, see CSS).
  function chartWidth(host) {
    var w = host.clientWidth;
    if (!w) {
      var v = $("view"), cs = getComputedStyle(v);
      w = Math.min(760, v.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    }
    return Math.max(260, Math.min(900, (w || 340) - 2));
  }
  function niceMax(v) {
    if (!(v > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10)), f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function tableFor(head, rows) {
    var det = el("details", "tbl");
    det.appendChild(el("summary", "", t("prog.table")));
    var tb = el("table");
    var tr = el("tr");
    head.forEach(function (h) { tr.appendChild(el("th", "", h)); });
    tb.appendChild(tr);
    rows.forEach(function (r) {
      var row = el("tr");
      r.forEach(function (c) { row.appendChild(el("td", "", c)); });
      tb.appendChild(row);
    });
    det.appendChild(tb);
    return det;
  }
  function tipLayer(wrap) {
    var tip = el("div", "tip");
    tip.hidden = true;
    wrap.appendChild(tip);
    return function (text, x, y) {
      if (text === null) { tip.hidden = true; return; }
      tip.textContent = text;
      tip.hidden = false;
      var w = wrap.clientWidth, tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(w - tw, x - tw / 2)) + "px";
      tip.style.top = Math.max(0, y - tip.offsetHeight - 10) + "px";
    };
  }

  // Line over time. pts: [{x: ms, y, id?}], fmtY(value) → text
  function lineChart(host, pts, fmtY, onOpen) {
    var wrap = el("div", "chart");
    host.appendChild(wrap);
    var W = chartWidth(host), H = 200, L = 52, R = 14, T = 14, B = 26;
    var svg = sv("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img" }, null);
    wrap.appendChild(svg);
    var minX = pts[0].x, maxX = pts[pts.length - 1].x;
    if (maxX === minX) { minX -= DAY_MS; maxX += DAY_MS; }
    var lo = Infinity, hi = -Infinity;
    pts.forEach(function (p) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); });
    var pad = (hi - lo) * 0.1 || hi * 0.05 || 1;
    var step = niceMax((hi - lo + 2 * pad) / 3) / 2;
    if ((hi - lo + 2 * pad) / step > 4) step *= 2;
    var y0 = Math.max(0, Math.floor((lo - pad) / step) * step), y1 = Math.ceil((hi + pad) / step) * step;
    if (y1 <= y0) y1 = y0 + step;
    var X = function (x) { return L + (W - L - R) * (x - minX) / (maxX - minX); };
    var Y = function (y) { return T + (H - T - B) * (1 - (y - y0) / (y1 - y0)); };
    for (var gv = y0; gv <= y1 + step / 2; gv += step) {
      var gy = Y(gv);
      sv("line", { x1: L, x2: W - R, y1: gy, y2: gy, "class": "grid" }, svg);
      sv("text", { x: L - 6, y: gy + 4, "text-anchor": "end", "class": "ax" }, svg).textContent = fmtY(gv);
    }
    [[minX, "start"], [maxX, "end"]].forEach(function (a) {
      sv("text", { x: a[1] === "start" ? L : W - R, y: H - 6, "text-anchor": a[1], "class": "ax" }, svg)
        .textContent = fmtShort(ymd(new Date(a[0])));
    });
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + X(p.x).toFixed(1) + " " + Y(p.y).toFixed(1); }).join(" ");
    sv("path", { d: d, "class": "line" }, svg);
    if (pts.length <= 40) pts.forEach(function (p) { sv("circle", { cx: X(p.x), cy: Y(p.y), r: 4, "class": "dot" }, svg); });
    var last = pts[pts.length - 1];
    sv("text", { x: Math.min(X(last.x), W - R), y: Y(last.y) - 9, "text-anchor": "end", "class": "lbl" }, svg).textContent = fmtY(last.y);
    var cross = sv("line", { y1: T, y2: H - B, "class": "cross", visibility: "hidden" }, svg);
    var hot = sv("circle", { r: 6, "class": "hot", visibility: "hidden" }, svg);
    var tip = tipLayer(wrap), cur = -1;
    function at(ev) {
      var r = svg.getBoundingClientRect(), x = ev.clientX - r.left, best = 0;
      pts.forEach(function (p, i) { if (Math.abs(X(p.x) - x) < Math.abs(X(pts[best].x) - x)) best = i; });
      return best;
    }
    function show(i) {
      cur = i;
      var p = pts[i];
      cross.setAttribute("x1", X(p.x)); cross.setAttribute("x2", X(p.x)); cross.setAttribute("visibility", "visible");
      hot.setAttribute("cx", X(p.x)); hot.setAttribute("cy", Y(p.y)); hot.setAttribute("visibility", "visible");
      tip(fmtDate(ymd(new Date(p.x)), false) + " · " + fmtY(p.y), X(p.x), Y(p.y));
    }
    function hide() { cur = -1; cross.setAttribute("visibility", "hidden"); hot.setAttribute("visibility", "hidden"); tip(null); }
    svg.addEventListener("pointermove", function (ev) { if (ev.pointerType === "mouse") show(at(ev)); });
    svg.addEventListener("pointerleave", function (ev) { if (ev.pointerType === "mouse") hide(); });
    svg.addEventListener("click", function (ev) {
      var i = at(ev);
      if ((ev.pointerType === "mouse" || i === cur) && onOpen && pts[i].id) onOpen(pts[i].id);
      else show(i);
    });
    return wrap;
  }

  // Vertical bars. bars: [{ label, v, tip }]
  function barChart(host, bars, fmtV) {
    var wrap = el("div", "chart");
    host.appendChild(wrap);
    var W = chartWidth(host), H = 160, L = 30, R = 8, T = 14, B = 24;
    var svg = sv("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img" }, null);
    wrap.appendChild(svg);
    var max = niceMax(Math.max.apply(null, bars.map(function (b) { return b.v; }).concat([1])));
    var Y = function (v) { return T + (H - T - B) * (1 - v / max); };
    [0, max / 2, max].forEach(function (gv) {
      sv("line", { x1: L, x2: W - R, y1: Y(gv), y2: Y(gv), "class": "grid" }, svg);
      sv("text", { x: L - 6, y: Y(gv) + 4, "text-anchor": "end", "class": "ax" }, svg).textContent = fmtV(gv);
    });
    var slot = (W - L - R) / bars.length, bw = Math.max(4, Math.min(28, slot - 2));
    var tip = tipLayer(wrap);
    bars.forEach(function (b, i) {
      var x = L + slot * i + (slot - bw) / 2, y = Y(b.v), h = Math.max(0, H - B - y);
      if (h > 0) {
        var r = Math.min(4, bw / 2, h);
        sv("path", { d: "M" + x + " " + (H - B) + "V" + (y + r) + "Q" + x + " " + y + " " + (x + r) + " " + y +
                     "H" + (x + bw - r) + "Q" + (x + bw) + " " + y + " " + (x + bw) + " " + (y + r) + "V" + (H - B) + "Z", "class": "bar" }, svg);
      }
      if (i % Math.ceil(bars.length / 6) === 0 || i === bars.length - 1)
        sv("text", { x: x + bw / 2, y: H - 6, "text-anchor": "middle", "class": "ax" }, svg).textContent = b.label;
      var hit = sv("rect", { x: L + slot * i, y: T, width: slot, height: H - T - B, "class": "hit" }, svg);
      var on = function () { tip(b.tip, x + bw / 2, y); };
      hit.addEventListener("pointerenter", on);
      hit.addEventListener("click", on);
      hit.addEventListener("pointerleave", function (ev) { if (ev.pointerType === "mouse") tip(null); });
    });
    return wrap;
  }

  // Horizontal bars with text labels (muscle groups).
  function hbarChart(host, rows) {
    var box = el("div", "hbars");
    var max = Math.max.apply(null, rows.map(function (r) { return r.v; }).concat([1]));
    rows.forEach(function (r) {
      var row = el("div", "hb-row");
      row.appendChild(el("span", "hb-l", r.label));
      var track = el("span", "hb-track");
      var fill = el("i", "");
      fill.style.width = (100 * r.v / max) + "%";
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el("span", "hb-v", String(r.v)));
      box.appendChild(row);
    });
    host.appendChild(box);
  }

  // Training days of the last 53 weeks, one cell per day.
  function heatmap(host, counts) {
    var wrap = el("div", "chart");
    host.appendChild(wrap);
    var W = chartWidth(host), weeks = 53;
    var cell = Math.max(3, Math.min(14, Math.floor((W - 26) / weeks) - 2)), gap = 2, step = cell + gap;
    var H = 7 * step + 18;
    var svg = sv("svg", { width: Math.min(W, 26 + weeks * step), height: H, role: "img" }, null);
    wrap.appendChild(svg);
    var start = weekStart(new Date());
    start.setDate(start.getDate() - 7 * (weeks - 1));
    var today = ymd(new Date()), tip = tipLayer(wrap);
    [0, 2, 4].forEach(function (r) {
      sv("text", { x: 0, y: 14 + r * step + cell - 1, "class": "ax" }, svg).textContent = t("day." + r);
    });
    for (var wk = 0; wk < weeks; wk++) {
      for (var d = 0; d < 7; d++) {
        var day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + wk * 7 + d), key = ymd(day);
        if (key > today) continue;
        if (day.getDate() === 1 && d === 0 || (day.getDate() <= 7 && d === 0))
          sv("text", { x: 26 + wk * step, y: 9, "class": "ax" }, svg).textContent = String(day.getMonth() + 1);
        var n = counts[key] || 0;
        var rc = sv("rect", { x: 26 + wk * step, y: 14 + d * step, width: cell, height: cell, rx: Math.min(2, cell / 3),
                              "class": "hm l" + Math.min(3, n) }, svg);
        (function (k, c, x, y) {
          var on = function () { tip(fmtDate(k, true) + " · " + t("prog.day", { n: c }), x, y); };
          rc.addEventListener("pointerenter", on);
          rc.addEventListener("click", on);
        })(key, n, 26 + wk * step + cell / 2, 14 + d * step);
      }
    }
    svg.addEventListener("pointerleave", function () { tip(null); });
    return wrap;
  }

  function rangeFrom(r) {
    var d = new Date();
    if (r === "all") return "";
    var months = { "1m": 1, "3m": 3, "6m": 6, "1y": 12 }[r] || 3;
    d.setMonth(d.getMonth() - months);
    return ymd(d);
  }
  function metricFmt(metric, set) {
    if (metric === "e1" || metric === "top") return function (v) { return fmtW(v, set.wu) + " " + set.wu; };
    if (metric === "vol") return function (v) { return fmtNum(v / wFactor(set.wu), 0); };
    if (metric === "reps") return function (v) { return fmtNum(v, 0); };
    if (metric === "time") return function (v) { return fmtTime(v); };
    if (metric === "dist") return function (v) { return fmtDist(v, set.du) + " " + set.du; };
    return function (v) { return fmtTime(set.du === "mi" ? v * MI_M / 1000 : v); };     // pace, s per km or mi
  }
  function metricName(metric, kind, set) {
    if (metric === "vol" && kind === "r") return t("csv.reps");
    if (metric === "pace") return set.du === "mi" ? t("m.paceMi") : t("m.pace");
    return t({ e1: "m.e1rm", top: "m.top", vol: "m.volume", reps: "m.reps", time: "m.time", dist: "m.dist" }[metric]);
  }

  function renderProgress(v) {
    setTitle(t("tab.progress"));
    var set = settings(), fin = finished(data);
    if (!fin.length) { v.appendChild(section(null)).appendChild(hint(t("prog.none"))); return; }
    var exs = usedExIds(fin);
    if (!exs.some(function (x) { return x.id === prefs.pe; })) {
      // default: the exercise done most often
      var cnt = {};
      fin.forEach(function (w) { w.x.forEach(function (e) { cnt[e.e] = (cnt[e.e] || 0) + 1; }); });
      prefs.pe = exs.slice().sort(function (a, b) { return (cnt[b.id] || 0) - (cnt[a.id] || 0); })[0].id;
    }
    var info = exInfo(data, prefs.pe);
    if (METRICS[info.k].indexOf(prefs.pm) < 0) prefs.pm = METRICS[info.k][0];

    var s1 = section(null);
    var bar = el("div", "filters");
    var se = el("select");
    se.setAttribute("aria-label", t("prog.exercise"));
    exs.forEach(function (x) { var o = el("option", "", x.name); o.value = x.id; se.appendChild(o); });
    se.value = prefs.pe;
    se.addEventListener("change", function () { prefs.pe = se.value; prefs.pm = ""; savePrefs(); render(); });
    var sm = el("select");
    sm.setAttribute("aria-label", t("prog.metric"));
    METRICS[info.k].forEach(function (m) { var o = el("option", "", metricName(m, info.k, set)); o.value = m; sm.appendChild(o); });
    sm.value = prefs.pm;
    sm.addEventListener("change", function () { prefs.pm = sm.value; savePrefs(); render(); });
    bar.appendChild(se); bar.appendChild(sm);
    s1.appendChild(bar);
    var seg = el("div", "seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", t("prog.range"));
    ["1m", "3m", "6m", "1y", "all"].forEach(function (r) {
      var b = el("button", prefs.pr === r ? "on" : "", t("r." + r));
      b.type = "button";
      b.setAttribute("aria-pressed", prefs.pr === r ? "true" : "false");
      b.addEventListener("click", function () { prefs.pr = r; savePrefs(); render(); });
      seg.appendChild(b);
    });
    s1.appendChild(seg);
    s1.appendChild(el("h2", "", info.name + " · " + metricName(prefs.pm, info.k, set)));
    var pts = seriesFor(data, prefs.pe, prefs.pm, rangeFrom(prefs.pr)), fy = metricFmt(prefs.pm, set);
    if (pts.length) {
      lineChart(s1, pts, fy, workoutDialog);
      s1.appendChild(tableFor([t("body.date"), metricName(prefs.pm, info.k, set)],
        pts.slice().reverse().map(function (p) { return [fmtDate(p.d, false), fy(p.y)]; })));
    } else s1.appendChild(hint(t("prog.noData")));
    // records
    var best = bestsFor(fin, prefs.pe, info.k, null);
    var keys = PR_KEYS[info.k].filter(function (k) { return best[k] > 0; });
    if (keys.length) {
      s1.appendChild(el("h3", "sub-h", t("prog.records")));
      var ul = el("ul", "rec-list");
      keys.forEach(function (k) {
        var li = el("li", "");
        li.innerHTML = UI.trophy;
        li.appendChild(el("span", "", t(PR_LABEL[k]) + ": " + fmtRecord({ k: k, v: best[k] }, info.k, set)));
        ul.appendChild(li);
      });
      s1.appendChild(ul);
    }
    v.appendChild(s1);

    var s2 = section(t("prog.perWeek"));
    var weeks = perWeek(fin, new Date(), 12);
    barChart(s2, weeks.map(function (w) {
      return { label: fmtShort(w.key), v: w.n, tip: t("prog.weekOf", { d: fmtShort(w.key) }) + " · " + t("prog.day", { n: w.n }) };
    }), function (x) { return fmtNum(x, 1); });
    s2.appendChild(tableFor([t("prog.week"), t("prog.count")],
      weeks.slice().reverse().map(function (w) { return [fmtDate(w.key, false), String(w.n)]; })));
    v.appendChild(s2);

    var s3 = section(t("prog.groups"));
    var gs = groupSets(data, fin, ymd(weekStart(new Date())));
    var rows = GROUPS.filter(function (g) { return gs[g] > 0; }).map(function (g) { return { label: t("g." + g), v: gs[g] }; });
    if (rows.length) hbarChart(s3, rows); else s3.appendChild(hint(t("prog.noData")));
    v.appendChild(s3);

    var s4 = section(t("prog.year"));
    var counts = dayCounts(fin);
    heatmap(s4, counts);
    var months = {};
    Object.keys(counts).forEach(function (k) { months[k.slice(0, 7)] = (months[k.slice(0, 7)] || 0) + counts[k]; });
    s4.appendChild(tableFor([t("body.date"), t("prog.count")],
      Object.keys(months).sort().reverse().slice(0, 12).map(function (k) { return [MONTHS[LANG][+k.slice(5) - 1] + " " + k.slice(0, 4), String(months[k])]; })));
    v.appendChild(s4);
  }

  // ---------- 10. Programs ----------
  var pgDraft = null;   // the program being edited (a copy until Save)
  function renderPrograms(v) {
    if (pgDraft) { renderPgEditor(v); return; }
    setTitle(t("tab.programs"));
    var s = section(t("pg.title"));
    if (!data.pg.length) s.appendChild(hint(t("pg.empty")));
    data.pg.slice().sort(function (a, b) { return a.n.localeCompare(b.n, LANG); }).forEach(function (p) {
      s.appendChild(pgCard(p.n, p.days.map(function (d, i) { return dayRef(p.id, d.id) || { name: t("pg.dayN", { n: i + 1 }), day: d }; }), [
        iconBtn("mini", UI.edit, t("pg.edit") + ": " + p.n, function () { pgDraft = JSON.parse(JSON.stringify(p)); render(); }),
        iconBtn("mini danger", UI.trash, t("pg.del") + ": " + p.n, function () {
          var row = removeRow("pg", p.id);
          saveNow(false);
          render();
          undoToast(t("pg.deleted"), function () { restoreRow("pg", row); saveNow(false); render(); });
        })
      ]));
    });
    s.appendChild(txtBtn("wide-btn", UI.plus, t("pg.new"), function () {
      pgDraft = { id: newId(), m: 0, n: "", days: [{ id: "d1", n: "", wd: [], it: [] }] };
      render();
    }));
    v.appendChild(s);

    var r = section(t("pg.ready"));
    SEED_PG.forEach(function (p) {
      r.appendChild(pgCard(seedName(p), p.days.map(function (d) { return dayRef(p.id, d.id); }), [
        iconBtn("mini", UI.copy, t("pg.use") + ": " + seedName(p), function () { copySeed(p); })
      ]));
    });
    v.appendChild(r);
  }
  function pgCard(name, refs, tools) {
    var card = el("div", "pg-card");
    var top = el("div", "ex-top");
    top.appendChild(el("b", "pg-name", name));
    var tb = el("div", "ex-tools");
    tools.forEach(function (b) { tb.appendChild(b); });
    top.appendChild(tb);
    card.appendChild(top);
    refs.forEach(function (r) {
      var row = el("div", "pg-day");
      var txt = el("div", "day-txt");
      var wd = r.day.wd.map(function (d) { return t("day." + d); }).join(" ");
      txt.appendChild(el("b", "", r.name + (wd ? " · " + wd : "")));
      txt.appendChild(el("small", "", r.day.it.map(function (i) {
        var info = exInfo(data, i.e), rr = info.k === "t" ? fmtTime(i.t) : (i.r2 ? i.r + "–" + i.r2 : String(i.r || ""));
        return info.name + (rr ? " " + i.s + "×" + rr : "");
      }).join(" · ")));
      row.appendChild(txt);
      if (r.pg && r.day.it.length) {
        var go = iconBtn("mini go", UI.play, t("train.start") + ": " + r.name, function () { startWorkout(r); });
        go.disabled = !!activeWorkout();
        row.appendChild(go);
      }
      card.appendChild(row);
    });
    return card;
  }
  // A copy translates the ready names into the current language: from
  // here on they are the user's own text.
  function copySeed(p) {
    var row = normPg({ id: newId(), m: Date.now(), n: seedName(p),
      days: p.days.map(function (d) { return { id: d.id, n: seedName(d), wd: d.wd, it: d.it }; }) });
    putRow("pg", row);
    saveNow(false);
    showToast(t("pg.copied"));
    render();
  }

  function renderPgEditor(v) {
    var set = settings();
    setTitle(pgDraft.n || t("pg.new"));
    var s = section(null);
    var nm = input("text", pgDraft.n);
    nm.maxLength = NAME_LEN;
    nm.addEventListener("input", function () { pgDraft.n = nm.value; });
    s.appendChild(field(t("pg.name"), nm));
    v.appendChild(s);

    pgDraft.days.forEach(function (d, di) {
      var box = el("section", "ex-card");
      var top = el("div", "ex-top");
      var dn = input("text", d.n);
      dn.maxLength = NAME_LEN;
      dn.placeholder = t("pg.dayN", { n: di + 1 });
      dn.setAttribute("aria-label", t("pg.dayName"));
      dn.addEventListener("input", function () { d.n = dn.value; });
      top.appendChild(dn);
      var rm = iconBtn("mini danger", UI.trash, t("pg.delDay"), function () { pgDraft.days.splice(di, 1); render(); });
      rm.disabled = pgDraft.days.length < 2;
      top.appendChild(rm);
      box.appendChild(top);
      var wdRow = el("div", "wd-row");
      wdRow.setAttribute("role", "group");
      wdRow.setAttribute("aria-label", t("pg.days"));
      for (var k = 0; k < 7; k++) (function (k) {
        var on = d.wd.indexOf(k) >= 0, b = el("button", "wd" + (on ? " on" : ""), t("day." + k));
        b.type = "button";
        b.setAttribute("aria-pressed", on ? "true" : "false");
        b.addEventListener("click", function () {
          var i = d.wd.indexOf(k);
          if (i >= 0) d.wd.splice(i, 1); else d.wd.push(k);
          d.wd.sort();
          render();
        });
        wdRow.appendChild(b);
      })(k);
      box.appendChild(wdRow);

      d.it.forEach(function (it, ii) {
        var info = exInfo(data, it.e), row = el("div", "it-row");
        var head = el("div", "ex-top");
        head.appendChild(el("b", "it-name", info.name));
        var tl = el("div", "ex-tools");
        var up = iconBtn("mini", UI.up, t("wo.moveUp"), function () { var x = d.it[ii]; d.it[ii] = d.it[ii - 1]; d.it[ii - 1] = x; render(); });
        up.disabled = ii === 0;
        var dw = iconBtn("mini", UI.down, t("wo.moveDown"), function () { var x = d.it[ii]; d.it[ii] = d.it[ii + 1]; d.it[ii + 1] = x; render(); });
        dw.disabled = ii === d.it.length - 1;
        tl.appendChild(up); tl.appendChild(dw);
        tl.appendChild(iconBtn("mini danger", UI.x, t("wo.removeEx"), function () { d.it.splice(ii, 1); render(); }));
        head.appendChild(tl);
        row.appendChild(head);
        var g = el("div", "it-grid");
        function num(label, val, onv, mode, fmt, parse) {
          var i = input("text", fmt(val), mode || "numeric");
          i.addEventListener("input", function () {
            var x = i.value.trim() === "" ? 0 : parse(i.value);
            i.classList.toggle("bad", isNaN(x));
            if (!isNaN(x)) onv(x);
          });
          g.appendChild(field(label, i));
        }
        var intF = function (n) { return n ? String(n) : ""; };
        num(t("pg.sets"), it.s, function (x) { it.s = Math.max(1, Math.min(MAX_SETS, x)); }, "numeric", intF, parseReps);
        if (info.k === "wr" || info.k === "r") {
          num(t("pg.reps"), it.r, function (x) { it.r = x; }, "numeric", intF, parseReps);
          num(t("pg.repsTo"), it.r2, function (x) { it.r2 = x; }, "numeric", intF, parseReps);
        }
        if (info.k === "wr") num(t("pg.weight") + " (" + set.wu + ")", it.w, function (x) { it.w = x; }, "decimal",
                                 function (g2) { return g2 ? fmtW(g2, set.wu) : ""; }, function (r) { return parseW(r, set.wu); });
        if (info.k === "t") num(t("col.time"), it.t, function (x) { it.t = x; }, "text", function (n) { return n ? fmtTime(n) : ""; }, parseTime);
        num(t("pg.restS"), it.rest, function (x) { it.rest = Math.min(3600, x); }, "numeric", intF, parseReps);
        row.appendChild(g);
        box.appendChild(row);
      });
      box.appendChild(txtBtn("link-btn", UI.plus, t("pg.addItem"), function () {
        pickExercise(function (exId) {
          if (d.it.length >= MAX_ITEMS) return;
          var info = exInfo(data, exId);
          d.it.push({ e: exId, s: 3, r: info.k === "wr" || info.k === "r" ? 8 : 0, r2: info.k === "wr" ? 12 : 0,
                      t: info.k === "t" ? 60 : 0, w: 0, rest: 0 });
          render();
        });
      }));
      v.appendChild(box);
    });
    if (pgDraft.days.length < MAX_DAYS) {
      v.appendChild(txtBtn("wide-btn", UI.plus, t("pg.addDay"), function () {
        var n = 1;
        while (pgDraft.days.some(function (d) { return d.id === "d" + n; })) n++;
        pgDraft.days.push({ id: "d" + n, n: "", wd: [], it: [] });
        render();
      }));
    }
    var acts = el("div", "wo-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { pgDraft = null; render(); }));
    acts.appendChild(button(t("pg.save"), "primary", function () {
      var x = JSON.parse(JSON.stringify(pgDraft));
      x.n = normStr(x.n, NAME_LEN);
      if (!x.n) { showToast(t("pg.needName")); return; }
      x.days = x.days.filter(function (d) { return d.it.length; });
      if (!x.days.length) { showToast(t("pg.needDay")); return; }
      var old = findRow("pg", x.id);
      x.m = Math.max(Date.now(), (old ? old.m : 0) + 1);
      var row = normPg(x);
      if (!row) return;
      putRow("pg", row);
      saveNow(false);
      pgDraft = null;
      showToast(t("toast.saved"));
      render();
    }));
    v.appendChild(acts);
  }

  // ---------- 11. Body ----------
  function renderBody(v) {
    setTitle(t("body.title"));
    var set = settings(), lu = set.du === "mi" ? "in" : "cm";
    var s = section(null);
    s.appendChild(txtBtn("wide-btn", UI.plus, t("body.add"), function () { bodyDialog(null); }));
    v.appendChild(s);
    if (!data.bm.length) { s.appendChild(hint(t("body.empty"))); return; }
    [["w", "body.weight", function (x) { return fmtW(x, set.wu) + " " + set.wu; }],
     ["wa", "body.waist", function (x) { return fmtLen(x, set.du) + " " + lu; }],
     ["ch", "body.chest", function (x) { return fmtLen(x, set.du) + " " + lu; }],
     ["ar", "body.arm", function (x) { return fmtLen(x, set.du) + " " + lu; }]].forEach(function (m) {
      var pts = data.bm.filter(function (b) { return b[m[0]] > 0; })
        .map(function (b) { return { x: parseYmd(b.id).getTime(), y: b[m[0]], d: b.id }; });
      if (pts.length < 2) return;
      var sec = section(t(m[1]));
      lineChart(sec, pts, m[2], null);
      v.appendChild(sec);
    });
    var ls = section(null);
    data.bm.slice().reverse().forEach(function (b) {
      var row = el("div", "bm-row");
      var txt = el("button", "bm-txt");
      txt.type = "button";
      txt.appendChild(el("b", "", fmtDate(b.id, true)));
      var parts = [];
      if (b.w) parts.push(fmtW(b.w, set.wu) + " " + set.wu);
      if (b.wa) parts.push(t("body.waist") + " " + fmtLen(b.wa, set.du) + " " + lu);
      if (b.ch) parts.push(t("body.chest") + " " + fmtLen(b.ch, set.du) + " " + lu);
      if (b.ar) parts.push(t("body.arm") + " " + fmtLen(b.ar, set.du) + " " + lu);
      txt.appendChild(el("small", "", parts.join(" · ")));
      txt.addEventListener("click", function () { bodyDialog(b); });
      row.appendChild(txt);
      row.appendChild(iconBtn("mini danger", UI.trash, t("body.del"), function () {
        var gone = removeRow("bm", b.id);
        saveNow(false);
        render();
        undoToast(t("body.deleted"), function () { restoreRow("bm", gone); saveNow(false); render(); });
      }));
      ls.appendChild(row);
    });
    v.appendChild(ls);
  }
  function bodyDialog(b) {
    var set = settings(), lu = set.du === "mi" ? "in" : "cm";
    var dlg = makeDialog("fit-bm", t("body.add"));
    var form = el("form");
    form.method = "dialog";
    var di = input("date", b ? b.id : ymd(new Date()));
    di.max = ymd(new Date());
    form.appendChild(field(t("body.date"), di));
    var f = {};
    [["w", t("body.weight") + " (" + set.wu + ")", function (x) { return fmtW(x, set.wu); }],
     ["wa", t("body.waist") + " (" + lu + ")", function (x) { return fmtLen(x, set.du); }],
     ["ch", t("body.chest") + " (" + lu + ")", function (x) { return fmtLen(x, set.du); }],
     ["ar", t("body.arm") + " (" + lu + ")", function (x) { return fmtLen(x, set.du); }]].forEach(function (m) {
      var i = input("text", b && b[m[0]] ? m[2](b[m[0]]) : "", "decimal");
      f[m[0]] = i;
      form.appendChild(field(m[1], i));
    });
    di.addEventListener("change", function () {
      var ex = findRow("bm", di.value);
      ["w", "wa", "ch", "ar"].forEach(function (k) {
        f[k].value = ex && ex[k] ? (k === "w" ? fmtW(ex[k], set.wu) : fmtLen(ex[k], set.du)) : "";
      });
    });
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!YMD_RE.test(di.value)) return;
      var row = { id: di.value, m: 0 }, bad = false;
      ["w", "wa", "ch", "ar"].forEach(function (k) {
        var raw = f[k].value.trim();
        var x = raw === "" ? 0 : (k === "w" ? parseW(raw, set.wu) : parseLen(raw, set.du));
        f[k].classList.toggle("bad", isNaN(x));
        if (isNaN(x)) bad = true; else row[k] = x;
      });
      if (bad) return;
      var old = findRow("bm", row.id);
      row.m = Math.max(Date.now(), (old ? old.m : 0) + 1, (data.tombs["bm:" + row.id] || 0) + 1);
      var n = normBm(row);
      if (!n) {
        if (old) { removeRow("bm", row.id); saveNow(false); }
        dlg.close(); render(); return;
      }
      putRow("bm", n);
      saveNow(false);
      dlg.close();
      render();
    });
    dlg.appendChild(form);
    openDialog(dlg);
  }

  // ---------- 12. Settings, export, restore ----------
  function dialogHost() {
    if (window.orosDialog) return window.orosDialog;
    try { return window.parent.orosDialog || null; } catch (e) { return null; }
  }
  function saveBlob(blob, name, mime) {
    var dh = dialogHost();
    if (dh && typeof dh.saveFile === "function") { dh.saveFile({ blob: blob, filename: name, mime: mime }); return; }
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 40000);
  }
  function pickFile(accept) {
    var dh = dialogHost();
    if (dh && typeof dh.openFile === "function") return dh.openFile(accept);
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file";
      inp.accept = accept;
      inp.style.display = "none";
      inp.addEventListener("change", function () { resolve(inp.files && inp.files[0] ? inp.files[0] : null); inp.remove(); });
      inp.addEventListener("cancel", function () { resolve(null); inp.remove(); });
      document.body.appendChild(inp);
      inp.click();
    });
  }
  function stampName(ext) { return "orOS-workouts-" + ymd(new Date()) + "." + ext; }
  function exportCsv() { saveBlob(new Blob([buildCsv(data)], { type: "text/csv;charset=utf-8" }), stampName("csv"), "text/csv"); }
  function exportJson() {
    var payload = { app: "fitness", ver: DATA_VER, data: mergeFit(data, data) };
    saveBlob(new Blob([JSON.stringify(payload)], { type: "application/json" }), stampName("json"), "application/json");
  }
  // Restore goes through the merge: nothing local is deleted, the
  // newer row wins as on sync, tombstones in the file count.
  function restoreJson() {
    pickFile(".json,application/json").then(function (file) {
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) { showToast(t("set.badFile")); return; }
      var rd = new FileReader();
      rd.onload = function () {
        var obj = null;
        try { obj = JSON.parse(String(rd.result)); } catch (e) {}
        if (!obj || obj.app !== "fitness" || !obj.data || !Array.isArray(obj.data.wo)) { showToast(t("set.badFile")); return; }
        data = mergeFit(data, obj.data);
        saveNow(false);
        var d = $("fit-set");
        if (d) d.close();
        render();
        showToast(t("set.restored", { n: finished(data).length }));
      };
      rd.readAsText(file);
    });
  }

  function settingsDialog() {
    var set = settings();
    var dlg = makeDialog("fit-set", t("set.title"));
    var sys = el("select");
    [["metric", t("set.metric")], ["imperial", t("set.imperial")]].forEach(function (o) {
      var x = el("option", "", o[1]); x.value = o[0]; sys.appendChild(x);
    });
    sys.value = set.wu === "lb" ? "imperial" : "metric";
    dlg.appendChild(field(t("set.wu"), sys));
    var incU = input("text", fmtW(set.incU, set.wu), "decimal"), incL = input("text", fmtW(set.incL, set.wu), "decimal");
    var incUf = field(t("set.incU") + " (" + set.wu + ")", incU), incLf = field(t("set.incL") + " (" + set.wu + ")", incL);
    dlg.appendChild(incUf);
    dlg.appendChild(incLf);
    var rest = input("text", String(set.rest), "numeric");
    dlg.appendChild(field(t("set.rest"), rest));
    function check(label, on, fn) {
      var w = el("label", "chk");
      var c = el("input");
      c.type = "checkbox";
      c.checked = !!on;
      c.addEventListener("change", function () { fn(c.checked); });
      w.appendChild(c);
      w.appendChild(el("span", "", label));
      dlg.appendChild(w);
    }
    check(t("set.sound"), prefs.snd, function (v) { prefs.snd = v ? 1 : 0; savePrefs(); if (v) chime(); });
    check(t("set.vib"), prefs.vib, function (v) { prefs.vib = v ? 1 : 0; savePrefs(); });
    check(t("set.habits"), set.hb, function (v) { editSettings({ hb: v ? 1 : 0 }); });
    sys.addEventListener("change", function () {
      var imp = sys.value === "imperial";
      // keep the steps natural in the new unit: 2.5 / 5 kg ↔ 5 / 10 lb
      editSettings({ wu: imp ? "lb" : "kg", du: imp ? "mi" : "km",
                     incU: imp ? Math.round(5 * LB_G) : 2500, incL: imp ? Math.round(10 * LB_G) : 5000 });
      dlg.close();
      render();
      settingsDialog();
    });
    [[incU, "incU"], [incL, "incL"]].forEach(function (p) {
      p[0].addEventListener("change", function () {
        var g = parseW(p[0].value, set.wu);
        p[0].classList.toggle("bad", !(g > 0));
        if (g > 0 && g !== settings()[p[1]]) { var o = {}; o[p[1]] = g; editSettings(o); }
      });
    });
    rest.addEventListener("change", function () {
      var n = parseReps(rest.value);
      rest.classList.toggle("bad", isNaN(n) || n > 3600);
      if (!isNaN(n) && n <= 3600 && n !== settings().rest) editSettings({ rest: n });
    });
    dlg.appendChild(el("div", "dlg-sub", t("set.export")));
    var ex = el("div", "btn-col");
    ex.appendChild(button(t("set.csv"), "", exportCsv));
    ex.appendChild(button(t("set.json"), "", exportJson));
    ex.appendChild(button(t("set.restore"), "", restoreJson));
    ex.appendChild(button(t("set.lib"), "", function () { dlg.close(); libraryDialog(); }));
    dlg.appendChild(ex);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.close"), "primary", function () { dlg.close(); render(); }));
    dlg.appendChild(acts);
    openDialog(dlg);
  }

  function libraryDialog() {
    var dlg = makeDialog("fit-lib", t("ex.lib"), true);
    var list = el("div", "pick-list");
    dlg.appendChild(list);
    function paint() {
      list.innerHTML = "";
      var all = allExercises(data);
      GROUPS.forEach(function (g) {
        var rows = all.filter(function (x) { return x.g === g; }).sort(function (a, b) { return a.name.localeCompare(b.name, LANG); });
        if (!rows.length) return;
        list.appendChild(el("div", "pick-g", t("g." + g)));
        rows.forEach(function (x) {
          var r = el("div", "lib-row" + (x.h ? " off" : ""));
          r.appendChild(el("span", "", x.name + (x.seed ? "" : " · " + t("ex.mine"))));
          r.appendChild(iconBtn("mini", UI.edit, t("ex.edit") + ": " + x.name, function () {
            dlg.close();
            exerciseDialog(x, function () { libraryDialog(); });
          }));
          r.appendChild(iconBtn("mini", x.h ? UI.eyeOff : UI.eye, (x.h ? t("ex.unhide") : t("ex.hide")) + ": " + x.name, function () {
            setHidden(x.id, !x.h);
            paint();
          }));
          list.appendChild(r);
        });
      });
    }
    paint();
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ex.new"), "", function () { dlg.close(); exerciseDialog(null, function () { libraryDialog(); }); }));
    acts.appendChild(button(t("dlg.close"), "primary", function () { dlg.close(); render(); }));
    dlg.appendChild(acts);
    openDialog(dlg);
  }

  // ---------- 13. Keyboard, palette, sync slice, deep link, boot ----------
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
    // 1–5 switch tabs (not while typing, not in a dialog)
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      var tg = e.target, tag = tg && tg.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (document.querySelector("dialog[open]")) return;
      var n = parseInt(e.key, 10);
      if (n >= 1 && n <= TABS.length) { e.preventDefault(); setTab(TABS[n - 1][0]); }
    });
  }

  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow", "--danger"];
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
    var api = syncApi();
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("fitness", sliceGet, sliceSet, STORAGE_KEY, mergeFit);
  }
  function sliceGet() { return mergeFit(data, data); }   // canonical copy (R26)
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.wo)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeFit(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;
    // SS-4: never repaint under the user's fingers; paint when they leave the field.
    if (typing() || pgDraft) { pendingRender = true; return; }
    if (document.querySelector("dialog[open]")) { pendingRender = true; return; }
    var v = $("view"), top = v.scrollTop;
    render();
    v.scrollTop = top;
  }

  // Deep link (Calendar feed → this workout). Live push from the shell,
  // or a one-shot staged id taken at boot.
  window.__orosFitnessOpen = function (id) {
    if (typeof id !== "string" || !ID_RE.test(id)) return;
    var w = findRow("wo", id);
    if (!w) { showToast(t("feed.deleted")); return; }
    if (!w.en) { openEditor(id); return; }
    if (prefs.tab !== "history") setTab("history");
    workoutDialog(id);
  };
  function takePending() {
    var id = null;
    try {
      id = sessionStorage.getItem("oros-fitness-open");
      if (id) sessionStorage.removeItem("oros-fitness-open");
    } catch (e) {}
    if (!id) { try { id = new URLSearchParams(location.search).get("open"); } catch (e) {} }
    if (id) setTimeout(function () { window.__orosFitnessOpen(id); }, 250);
  }

  // Universal search deep link (shell __orosOpenAt / __orosTakeTarget):
  // target { pg: id }. Programs tab with that program in its editor, as
  // its edit button does. Unknown program → no-op; an open dialog or a
  // program already in the editor (unsaved edits) wins → no-op.
  function openSearchTarget(t) {
    var p = t && typeof t.pg === "string" ? findRow("pg", t.pg) : null;
    if (!p || pgDraft || document.querySelector("dialog[open]")) return;
    pgDraft = JSON.parse(JSON.stringify(p));
    setTab("programs");
  }
  window.__orosOpenAt = openSearchTarget;
  function takeSearchTarget() {
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === "function") {
        var pendingTarget = window.parent.__orosTakeTarget("fitness");
        if (pendingTarget) openSearchTarget(pendingTarget);
      }
    } catch (e) {}
  }

  function wire() {
    $("set-btn").innerHTML = UI.gear;
    $("set-btn").setAttribute("aria-label", t("btn.settings"));
    $("set-btn").title = t("btn.settings");
    $("set-btn").addEventListener("click", settingsDialog);
    $("nav").setAttribute("aria-label", t("app"));
    $("view").addEventListener("focusout", function () {
      setTimeout(function () {
        if (pendingRender && !typing() && !pgDraft && !document.querySelector("dialog[open]")) {
          var v = $("view"), top = v.scrollTop;
          render();
          v.scrollTop = top;
        }
      }, 0);
    });
    document.addEventListener("close", function () {
      setTimeout(function () { if (pendingRender && !typing() && !pgDraft && !document.querySelector("dialog[open]")) render(); }, 0);
    }, true);
    var rsT = null, lastW = 0;
    window.addEventListener("resize", function () {
      clearTimeout(rsT);
      rsT = setTimeout(function () {
        var w = $("view").clientWidth;
        if (Math.abs(w - lastW) > 30 && prefs.tab !== "train" && !typing() && !pgDraft) { lastW = w; render(); }
      }, 200);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { savePrefsNow(); flushPaced(); releaseWake(); }
      else { renderRest(); updateWakeLock(); }
    });
    window.addEventListener("pagehide", function () {
      savePrefsNow();
      flushPaced();
      try { if (actx) actx.close(); } catch (e) {}
    });
    wireKeyboard();
  }

  function applyI18n() {
    document.title = t("app") + " · orOS";
  }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "").match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("fitness.js v" + (m ? m[1] : "?") + " boot");
  })();

  function boot() {
    load();
    loadPrefs();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    var act = activeWorkout();
    if (act && prefs.tab === "train") editId = act.id;
    render();
    takePending();
    takeSearchTarget();
  }

  boot();
})();
