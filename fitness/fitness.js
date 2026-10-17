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
//   - wave 29: supersets / circuits (linked entries, run round by
//     round), progression programs 5/3/1, GZCLP, Linear 5×5
//     (plan-core.js), outdoor walk / run / ride with GPS, splits and
//     GPX (gps-core.js over maps/tracks-core.js), exercise pictures
//     from wger.de on request (wger.js); section 7b
//   - import: Strong / Hevy CSV (section 4b), FitNotes, JEFIT, FIT,
//     TCX, GPX and bulk zips (import.js); preview, one write, Undo
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
  // orosI18n (../i18n.js): the full language code, a pack language included.
  var LANG = window.orosI18n ? window.orosI18n.lang() : appLang();

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
      "log.title": "Log a workout", "log.ex": "Activity",
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
      "set.sheet": "Open in Spreadsheet", "set.sheetCap": "Only the first {n} rows fit in one sheet", "set.sheetNone": "No finished sets yet",
      "set.json": "Backup (JSON)", "set.restore": "Restore from backup", "set.lib": "Exercise library",
      "set.osave": "orOS file (.orosworkouts)", "set.oopen": "Open orOS file…", "set.ofolder": "Unzipped orOS folder…",
      "set.metric": "Metric (kg, km, cm)", "set.imperial": "Imperial (lb, mi, in)",
      "set.restored": "Backup restored: {n} workouts", "set.badFile": "This file is not a Workouts backup",
      "set.import": "Import workouts (Strong, Hevy, FitNotes, JEFIT, FIT, TCX, GPX)",
      "imp.title": "Import workouts", "imp.bad": "This file is not a workout or activity export that can be read here",
      "imp.big": "This file is too large to import", "imp.undone": "Import undone",
      "imp.revive": "Also bring back {n} workouts deleted after an earlier import",
      "imp.actSum": "{src} · Activities to import: {n}", "imp.actDone": "Activities imported: {n}", "imp.files": "{n} files",
      "imp.k.run": "Runs: {n}", "imp.k.walk": "Walks: {n}", "imp.k.ride": "Rides: {n}", "imp.k.swim": "Swims: {n}", "imp.k.other": "Other: {n}",
      "imp.routes": "With a route: {n}", "imp.noRoute": "Without a route, to keep sync light: {n}",
      "imp.other": "Other sports come in with their time and a note, without exercises.",
      "imp.skipAct": "Already here, skipped: {n}", "imp.badFiles": "Files that could not be read: {n}",
      "imp.kcal": "{n} kcal", "imp.hr": "average heart rate {n}",
      "imp.summary": "{src} export · Workouts: {n} · Sets: {sets}", "imp.range": "{from} to {to}",
      "imp.ex": "Exercises already here: {m} · New exercises: {k}", "imp.newList": "New: {list}",
      "imp.skip": "Workouts already here, skipped: {n}",
      "imp.none": "Every workout in this file is already here.",
      "imp.unit": "Weights and distances in this file", "imp.go": "Import",
      "imp.done": "Workouts imported: {n}",
      "imp.tip": "You can rename new exercises or change their muscle group in the Exercise library.",
      "dlg.cancel": "Cancel", "dlg.ok": "OK", "dlg.save": "Save", "dlg.close": "Close", "dlg.delete": "Delete",
      "toast.undo": "Undo", "toast.save": "Could not save: storage is full", "toast.saved": "Saved",
      "day.0": "Mon", "day.1": "Tue", "day.2": "Wed", "day.3": "Thu", "day.4": "Fri", "day.5": "Sat", "day.6": "Sun",
      "unit.min": "{n} min", "unit.sets": "{n} sets",
      "csv.date": "Date", "csv.workout": "Workout", "csv.exercise": "Exercise", "csv.set": "Set",
      "csv.warm": "Warm-up", "csv.weight": "Weight ({u})", "csv.reps": "Reps", "csv.time": "Time (s)",
      "csv.dist": "Distance ({u})", "csv.e1rm": "Estimated 1RM ({u})", "csv.yes": "yes",
      "feed.deleted": "This workout no longer exists.",
      "ss.link": "Superset with the next exercise", "ss.unlink": "Unlink from the next exercise",
      "ss.superset": "Superset", "ss.circuit": "Circuit", "ss.round": "Round {n} of {of}",
      "ss.restRound": "Rest after the round {t}", "ss.now": "Now: {ex}", "ss.hint": "Linked exercises are done round by round: one set of each, then the rest.",
      "pl.title": "Progression programs", "pl.intro": "The app works out each session's sets and weights from your numbers and moves on after every finished workout.",
      "pl.new": "New progression program", "pl.pick": "Choose a template",
      "tpl.531": "5/3/1 (Wendler)", "tpl.gzclp": "GZCLP", "tpl.lin": "Linear 5×5",
      "tplD.531": "4 days: press, deadlift, bench, squat. Weeks of 5s, 3s and 5/3/1, then a deload week. The last set is “+”: as many reps as you can.",
      "tplD.gzclp": "4 days (A1, B1, A2, B2) in three tiers: heavy T1, volume T2, light T3. A missed session changes the sets and reps, not the weight.",
      "tplD.lin": "Two alternating days (A, B), 5 sets of 5. Every good session adds weight; three misses in a row take 10% off.",
      "pl.tm.531": "Training max (about 90% of your 1RM)", "pl.tm.gzclp": "5-rep max", "pl.tm.lin": "Starting weight",
      "pl.fromHist": "Filled in from your history; change them as you like.",
      "pl.round": "Round weights to ({u})", "pl.bbb": "Add 5 × 10 at 50% (Boring But Big)",
      "pl.needTm": "Enter a weight for every lift", "pl.create": "Create", "pl.next": "Next: {pos}",
      "pl.week": "Week {n}", "pl.deload": "Deload week", "pl.cycle": "Cycle {n}", "pl.day": "Day {d}",
      "pl.skip": "Skip this session", "pl.skipQ": "Skip this session? The program moves on to the next one.", "pl.skipped": "Session skipped",
      "pl.tms": "Training maxes", "pl.weights": "Working weights", "pl.edit": "Change numbers", "pl.saved": "Numbers saved", "pl.created": "Program created",
      "pl.sum": "Program", "pl.stale": "This workout was not the program's next session, so the program did not move on.",
      "pl.up": "{ex}: next time {w}", "pl.same": "{ex}: same weight next time ({w})",
      "pl.stage": "{ex}: next time {sets} at {w}", "pl.reset": "{ex}: starts again at {sets} with {w}",
      "pl.down": "{ex}: three misses in a row, down to {w}",
      "pl.miss": "{ex}: the + set missed its reps; this training max goes down 10% when the cycle ends",
      "pl.tmUp": "{ex}: new training max {w}", "pl.tmDown": "{ex}: training max down 10% to {w}",
      "pl.plus": "+ = as many reps as you can", "pl.t3": "T3: pick your weight the first time; it's kept for next time.",
      "gps.title": "Outdoor activity", "gps.walk": "Walk", "gps.run": "Run", "gps.ride": "Ride",
      "gps.hint": "Records your route with this device's location while Workouts stays open on screen.",
      "gps.dist": "Distance", "gps.time": "Time", "gps.pace": "Pace", "gps.speed": "Speed", "gps.lap": "This {u}",
      "gps.pause": "Pause", "gps.resume": "Resume", "gps.paused": "Paused", "gps.waiting": "Waiting for GPS…",
      "gps.acc": "GPS accuracy ±{m} m", "gps.denied": "Location is not allowed. Allow it for orOS in your browser or device settings, then tap Resume.",
      "gps.none": "This device or browser cannot give a location.", "gps.splits": "Splits", "gps.map": "Route",
      "gps.gpx": "Export GPX", "gps.noTrack": "No route was recorded.",
      "gps.screen": "Keep the screen on and Workouts open: most browsers stop the location when the screen turns off or the app goes to the background, and the route then jumps in a straight line.",
      "gps.perH": "{u}/h",
      "pic.show": "Show picture", "pic.loading": "Looking on wger.de…", "pic.none": "wger.de has no picture for this exercise.",
      "pic.offline": "You're offline. Pictures come from wger.de.", "pic.fail": "Could not reach wger.de. Try again later.",
      "pic.by": "Picture: {author}", "pic.byNone": "Picture: wger.de contributors", "pic.src": "Source: wger.de · {name}",
      "pic.note": "Fetched from wger.de only when you ask, then kept on this device. The closest match by name; it may show a variation.",
      "pic.forget": "Remove from this device", "pic.retry": "Search again"
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
      "log.title": "Καταγραφή προπόνησης", "log.ex": "Δραστηριότητα",
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
      "set.sheet": "Άνοιγμα στο Υπολογιστικό φύλλο", "set.sheetCap": "Χωρούν μόνο οι πρώτες {n} γραμμές σε ένα φύλλο", "set.sheetNone": "Δεν υπάρχουν ακόμα ολοκληρωμένα σετ",
      "set.json": "Αντίγραφο ασφαλείας (JSON)", "set.restore": "Επαναφορά από αντίγραφο", "set.lib": "Βιβλιοθήκη ασκήσεων",
      "set.osave": "Αρχείο orOS (.orosworkouts)", "set.oopen": "Άνοιγμα αρχείου orOS…", "set.ofolder": "Αποσυμπιεσμένος φάκελος orOS…",
      "set.metric": "Μετρικό (kg, km, cm)", "set.imperial": "Αγγλοσαξονικό (lb, mi, in)",
      "set.restored": "Έγινε επαναφορά: {n} προπονήσεις", "set.badFile": "Αυτό το αρχείο δεν είναι αντίγραφο της Προπόνησης",
      "set.import": "Εισαγωγή προπονήσεων (Strong, Hevy, FitNotes, JEFIT, FIT, TCX, GPX)",
      "imp.title": "Εισαγωγή προπονήσεων", "imp.bad": "Αυτό το αρχείο δεν είναι εξαγωγή προπονήσεων ή δραστηριοτήτων που διαβάζεται εδώ",
      "imp.big": "Το αρχείο είναι πολύ μεγάλο για εισαγωγή", "imp.undone": "Η εισαγωγή αναιρέθηκε",
      "imp.revive": "Επανέφερε και {n} προπονήσεις που διαγράφηκαν μετά από προηγούμενη εισαγωγή",
      "imp.actSum": "{src} · Δραστηριότητες για εισαγωγή: {n}", "imp.actDone": "Δραστηριότητες που μπήκαν: {n}", "imp.files": "{n} αρχεία",
      "imp.k.run": "Τρέξιμο: {n}", "imp.k.walk": "Περπάτημα: {n}", "imp.k.ride": "Ποδήλατο: {n}", "imp.k.swim": "Κολύμπι: {n}", "imp.k.other": "Άλλα: {n}",
      "imp.routes": "Με διαδρομή: {n}", "imp.noRoute": "Χωρίς διαδρομή, για να μένει ελαφρύς ο συγχρονισμός: {n}",
      "imp.other": "Τα άλλα αθλήματα μπαίνουν με τον χρόνο τους και μια σημείωση, χωρίς ασκήσεις.",
      "imp.skipAct": "Υπάρχουν ήδη και παραλείπονται: {n}", "imp.badFiles": "Αρχεία που δεν διαβάστηκαν: {n}",
      "imp.kcal": "{n} θερμίδες", "imp.hr": "μέσος καρδιακός ρυθμός {n}",
      "imp.summary": "Εξαγωγή {src} · Προπονήσεις: {n} · Σετ: {sets}", "imp.range": "{from} έως {to}",
      "imp.ex": "Ασκήσεις που υπάρχουν ήδη: {m} · Νέες ασκήσεις: {k}", "imp.newList": "Νέες: {list}",
      "imp.skip": "Προπονήσεις που υπάρχουν ήδη και παραλείπονται: {n}",
      "imp.none": "Όλες οι προπονήσεις του αρχείου υπάρχουν ήδη.",
      "imp.unit": "Βάρη και αποστάσεις στο αρχείο", "imp.go": "Εισαγωγή",
      "imp.done": "Προπονήσεις που μπήκαν: {n}",
      "imp.tip": "Μπορείς να μετονομάσεις τις νέες ασκήσεις ή να αλλάξεις τη μυϊκή τους ομάδα στη Βιβλιοθήκη ασκήσεων.",
      "dlg.cancel": "Άκυρο", "dlg.ok": "OK", "dlg.save": "Αποθήκευση", "dlg.close": "Κλείσιμο", "dlg.delete": "Διαγραφή",
      "toast.undo": "Αναίρεση", "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος", "toast.saved": "Αποθηκεύτηκε",
      "day.0": "Δευ", "day.1": "Τρί", "day.2": "Τετ", "day.3": "Πέμ", "day.4": "Παρ", "day.5": "Σάβ", "day.6": "Κυρ",
      "unit.min": "{n} λεπτά", "unit.sets": "{n} σετ",
      "csv.date": "Ημερομηνία", "csv.workout": "Προπόνηση", "csv.exercise": "Άσκηση", "csv.set": "Σετ",
      "csv.warm": "Προθέρμανση", "csv.weight": "Βάρος ({u})", "csv.reps": "Επαναλήψεις", "csv.time": "Χρόνος (δ)",
      "csv.dist": "Απόσταση ({u})", "csv.e1rm": "Εκτιμώμενο 1RM ({u})", "csv.yes": "ναι",
      "feed.deleted": "Αυτή η προπόνηση δεν υπάρχει πια.",
      "ss.link": "Σούπερ σετ με την επόμενη άσκηση", "ss.unlink": "Αποσύνδεση από την επόμενη άσκηση",
      "ss.superset": "Σούπερ σετ", "ss.circuit": "Κύκλωμα", "ss.round": "Γύρος {n} από {of}",
      "ss.restRound": "Ανάπαυση μετά τον γύρο {t}", "ss.now": "Τώρα: {ex}", "ss.hint": "Οι συνδεδεμένες ασκήσεις γίνονται γύρο γύρο: ένα σετ από την καθεμία και μετά ανάπαυση.",
      "pl.title": "Προγράμματα προόδου", "pl.intro": "Η εφαρμογή υπολογίζει τα σετ και τα βάρη κάθε προπόνησης από τα νούμερά σου και προχωρά μετά από κάθε ολοκληρωμένη προπόνηση.",
      "pl.new": "Νέο πρόγραμμα προόδου", "pl.pick": "Διάλεξε πρότυπο",
      "tpl.531": "5/3/1 (Wendler)", "tpl.gzclp": "GZCLP", "tpl.lin": "Γραμμικό 5×5",
      "tplD.531": "4 ημέρες: πιέσεις ώμων, άρση θανάτου, πιέσεις πάγκου, καθίσματα. Εβδομάδες με 5άρια, 3άρια και 5/3/1 και μετά μια εβδομάδα αποφόρτισης. Το τελευταίο σετ είναι «+»: όσες επαναλήψεις μπορείς.",
      "tplD.gzclp": "4 ημέρες (A1, B1, A2, B2) σε τρία επίπεδα: βαρύ T1, όγκος T2, ελαφρύ T3. Μια αποτυχημένη προπόνηση αλλάζει τα σετ και τις επαναλήψεις, όχι το βάρος.",
      "tplD.lin": "Δύο ημέρες εναλλάξ (A, B), 5 σετ των 5. Κάθε καλή προπόνηση προσθέτει βάρος· τρεις αποτυχίες στη σειρά αφαιρούν 10%.",
      "pl.tm.531": "Μέγιστο προπόνησης (περίπου 90% του 1RM σου)", "pl.tm.gzclp": "Μέγιστο 5 επαναλήψεων", "pl.tm.lin": "Αρχικό βάρος",
      "pl.fromHist": "Συμπληρώθηκαν από το ιστορικό σου· άλλαξέ τα όπως θέλεις.",
      "pl.round": "Στρογγυλοποίηση βαρών ανά ({u})", "pl.bbb": "Πρόσθεσε 5 × 10 στο 50% (Boring But Big)",
      "pl.needTm": "Βάλε βάρος για κάθε άσκηση", "pl.create": "Δημιουργία", "pl.next": "Επόμενη: {pos}",
      "pl.week": "Εβδομάδα {n}", "pl.deload": "Εβδομάδα αποφόρτισης", "pl.cycle": "Κύκλος {n}", "pl.day": "Ημέρα {d}",
      "pl.skip": "Παράλειψη αυτής της προπόνησης", "pl.skipQ": "Παράλειψη αυτής της προπόνησης; Το πρόγραμμα περνά στην επόμενη.", "pl.skipped": "Η προπόνηση παραλείφθηκε",
      "pl.tms": "Μέγιστα προπόνησης", "pl.weights": "Βάρη εργασίας", "pl.edit": "Αλλαγή νούμερων", "pl.saved": "Τα νούμερα αποθηκεύτηκαν", "pl.created": "Το πρόγραμμα δημιουργήθηκε",
      "pl.sum": "Πρόγραμμα", "pl.stale": "Αυτή η προπόνηση δεν ήταν η επόμενη του προγράμματος, οπότε το πρόγραμμα δεν προχώρησε.",
      "pl.up": "{ex}: την επόμενη φορά {w}", "pl.same": "{ex}: ίδιο βάρος την επόμενη φορά ({w})",
      "pl.stage": "{ex}: την επόμενη φορά {sets} με {w}", "pl.reset": "{ex}: ξεκινά ξανά με {sets} και {w}",
      "pl.down": "{ex}: τρεις αποτυχίες στη σειρά, κατεβαίνει στα {w}",
      "pl.miss": "{ex}: το σετ + δεν έπιασε τις επαναλήψεις· αυτό το μέγιστο προπόνησης πέφτει 10% στο τέλος του κύκλου",
      "pl.tmUp": "{ex}: νέο μέγιστο προπόνησης {w}", "pl.tmDown": "{ex}: το μέγιστο προπόνησης πέφτει 10% στα {w}",
      "pl.plus": "+ = όσες επαναλήψεις μπορείς", "pl.t3": "T3: διάλεξε το βάρος σου την πρώτη φορά· κρατιέται για την επόμενη.",
      "gps.title": "Δραστηριότητα στο ύπαιθρο", "gps.walk": "Περπάτημα", "gps.run": "Τρέξιμο", "gps.ride": "Ποδήλατο",
      "gps.hint": "Καταγράφει τη διαδρομή σου με την τοποθεσία αυτής της συσκευής όσο η Προπόνηση μένει ανοιχτή στην οθόνη.",
      "gps.dist": "Απόσταση", "gps.time": "Χρόνος", "gps.pace": "Ρυθμός", "gps.speed": "Ταχύτητα", "gps.lap": "Αυτό το {u}",
      "gps.pause": "Παύση", "gps.resume": "Συνέχεια", "gps.paused": "Σε παύση", "gps.waiting": "Αναμονή για GPS…",
      "gps.acc": "Ακρίβεια GPS ±{m} m", "gps.denied": "Η τοποθεσία δεν επιτρέπεται. Επίτρεψέ την για το orOS στις ρυθμίσεις του προγράμματος περιήγησης ή της συσκευής και πάτα Συνέχεια.",
      "gps.none": "Αυτή η συσκευή ή το πρόγραμμα περιήγησης δεν δίνει τοποθεσία.", "gps.splits": "Ενδιάμεσοι χρόνοι", "gps.map": "Διαδρομή",
      "gps.gpx": "Εξαγωγή GPX", "gps.noTrack": "Δεν καταγράφηκε διαδρομή.",
      "gps.screen": "Κράτα την οθόνη αναμμένη και την Προπόνηση ανοιχτή: τα περισσότερα προγράμματα περιήγησης σταματούν την τοποθεσία όταν σβήνει η οθόνη ή η εφαρμογή πάει στο παρασκήνιο, και τότε η διαδρομή κάνει άλμα σε ευθεία γραμμή.",
      "gps.perH": "{u}/ώ",
      "pic.show": "Εμφάνιση εικόνας", "pic.loading": "Αναζήτηση στο wger.de…", "pic.none": "Το wger.de δεν έχει εικόνα γι' αυτή την άσκηση.",
      "pic.offline": "Είσαι εκτός σύνδεσης. Οι εικόνες έρχονται από το wger.de.", "pic.fail": "Δεν ήταν δυνατή η σύνδεση με το wger.de. Δοκίμασε αργότερα.",
      "pic.by": "Εικόνα: {author}", "pic.byNone": "Εικόνα: συντελεστές του wger.de", "pic.src": "Πηγή: wger.de · {name}",
      "pic.note": "Έρχεται από το wger.de μόνο όταν το ζητάς και μετά κρατιέται σε αυτή τη συσκευή. Είναι η πιο κοντινή αντιστοιχία στο όνομα· μπορεί να δείχνει παραλλαγή.",
      "pic.forget": "Αφαίρεση από αυτή τη συσκευή", "pic.retry": "Νέα αναζήτηση"
    }
  };

  if (typeof window !== "undefined" && window.orosI18n) window.orosI18n.table(STRINGS, "fitness", LANG);
  // Dates, numbers and sorting in the language's locale.
  function loc() {
    return typeof window !== "undefined" && window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB");
  }
  // "el" or "en" for shared modules that pick between two inline texts.
  var LANG2 = LANG === "el" ? "el" : "en";
  // A decimal comma (Greek, German, ...) instead of a decimal point.
  var DEC_COMMA = LANG === "el";
  if (LANG !== "el" && LANG !== "en") {
    try { DEC_COMMA = (1.5).toLocaleString(loc()).indexOf(",") >= 0; } catch (e) { DEC_COMMA = false; }
  }

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
  // Names of the ready exercises, programs and program days, per
  // language (keys "seed.<exercise id>", "seed.<program id>" and
  // "seed.<program id>.<day id>"; pack languages through orosI18n).
  var SEED_STR = {
    en: {
      "seed.x-bench": "Bench press",
      "seed.x-incline": "Incline bench press",
      "seed.x-dbbench": "Dumbbell bench press",
      "seed.x-dbfly": "Dumbbell fly",
      "seed.x-pushup": "Push-up",
      "seed.x-dips": "Dips",
      "seed.x-deadlift": "Deadlift",
      "seed.x-row": "Barbell row",
      "seed.x-dbrow": "Dumbbell row",
      "seed.x-pullup": "Pull-up",
      "seed.x-chinup": "Chin-up",
      "seed.x-pulldown": "Lat pulldown",
      "seed.x-cablerow": "Seated cable row",
      "seed.x-backext": "Back extension",
      "seed.x-ohp": "Overhead press",
      "seed.x-dbshoulder": "Dumbbell shoulder press",
      "seed.x-latraise": "Lateral raise",
      "seed.x-facepull": "Face pull",
      "seed.x-rearfly": "Rear delt fly",
      "seed.x-curl": "Barbell curl",
      "seed.x-dbcurl": "Dumbbell curl",
      "seed.x-hammer": "Hammer curl",
      "seed.x-pushdown": "Triceps pushdown",
      "seed.x-skull": "Skull crusher",
      "seed.x-ohext": "Overhead triceps extension",
      "seed.x-closebench": "Close-grip bench press",
      "seed.x-squat": "Squat",
      "seed.x-frontsquat": "Front squat",
      "seed.x-legpress": "Leg press",
      "seed.x-lunge": "Lunge",
      "seed.x-bulgarian": "Bulgarian split squat",
      "seed.x-goblet": "Goblet squat",
      "seed.x-rdl": "Romanian deadlift",
      "seed.x-legcurl": "Leg curl",
      "seed.x-legext": "Leg extension",
      "seed.x-calf": "Calf raise",
      "seed.x-hipthrust": "Hip thrust",
      "seed.x-bridge": "Glute bridge",
      "seed.x-plank": "Plank",
      "seed.x-sideplank": "Side plank",
      "seed.x-crunch": "Crunch",
      "seed.x-legraise": "Hanging leg raise",
      "seed.x-twist": "Russian twist",
      "seed.x-abwheel": "Ab wheel rollout",
      "seed.x-run": "Running",
      "seed.x-walk": "Walking",
      "seed.x-bike": "Cycling",
      "seed.x-rowerg": "Rowing machine",
      "seed.x-swim": "Swimming",
      "seed.x-rope": "Jump rope",
      "seed.x-burpee": "Burpee",
      "seed.x-kbswing": "Kettlebell swing",
      "seed.x-clean": "Power clean",
      "seed.p-full": "Full Body 3×",
      "seed.p-ul": "Upper / Lower",
      "seed.p-ppl": "Push / Pull / Legs",
      "seed.p-full.a": "Full Body A",
      "seed.p-full.b": "Full Body B",
      "seed.p-ul.u": "Upper",
      "seed.p-ul.l": "Lower",
      "seed.p-ppl.push": "Push",
      "seed.p-ppl.pull": "Pull",
      "seed.p-ppl.legs": "Legs"
    },
    el: {
      "seed.x-bench": "Πιέσεις πάγκου",
      "seed.x-incline": "Πιέσεις σε κεκλιμένο πάγκο",
      "seed.x-dbbench": "Πιέσεις πάγκου με αλτήρες",
      "seed.x-dbfly": "Ανοίγματα με αλτήρες",
      "seed.x-pushup": "Κάμψεις",
      "seed.x-dips": "Βυθίσεις",
      "seed.x-deadlift": "Άρση θανάτου",
      "seed.x-row": "Κωπηλατική με μπάρα",
      "seed.x-dbrow": "Κωπηλατική με αλτήρα",
      "seed.x-pullup": "Έλξεις",
      "seed.x-chinup": "Έλξεις με ανάποδη λαβή",
      "seed.x-pulldown": "Έλξεις τροχαλίας",
      "seed.x-cablerow": "Κωπηλατική τροχαλίας",
      "seed.x-backext": "Εκτάσεις ραχιαίων",
      "seed.x-ohp": "Πιέσεις ώμων",
      "seed.x-dbshoulder": "Πιέσεις ώμων με αλτήρες",
      "seed.x-latraise": "Πλάγιες εκτάσεις",
      "seed.x-facepull": "Face pull",
      "seed.x-rearfly": "Ανοίγματα οπίσθιων ώμων",
      "seed.x-curl": "Κάμψεις δικεφάλων με μπάρα",
      "seed.x-dbcurl": "Κάμψεις δικεφάλων με αλτήρες",
      "seed.x-hammer": "Κάμψεις σφυριού",
      "seed.x-pushdown": "Εκτάσεις τρικεφάλων στην τροχαλία",
      "seed.x-skull": "Γαλλικές πιέσεις",
      "seed.x-ohext": "Εκτάσεις τρικεφάλων πάνω από το κεφάλι",
      "seed.x-closebench": "Πιέσεις πάγκου με κλειστή λαβή",
      "seed.x-squat": "Καθίσματα",
      "seed.x-frontsquat": "Μπροστινά καθίσματα",
      "seed.x-legpress": "Πρέσα ποδιών",
      "seed.x-lunge": "Προβολές",
      "seed.x-bulgarian": "Βουλγάρικα καθίσματα",
      "seed.x-goblet": "Καθίσματα goblet",
      "seed.x-rdl": "Ρουμανική άρση θανάτου",
      "seed.x-legcurl": "Κάμψεις ποδιών",
      "seed.x-legext": "Εκτάσεις ποδιών",
      "seed.x-calf": "Άνοδοι γαστροκνημίων",
      "seed.x-hipthrust": "Ώθηση ισχίων",
      "seed.x-bridge": "Γέφυρα γλουτών",
      "seed.x-plank": "Σανίδα",
      "seed.x-sideplank": "Πλάγια σανίδα",
      "seed.x-crunch": "Κοιλιακοί",
      "seed.x-legraise": "Ανυψώσεις ποδιών σε κρέμαση",
      "seed.x-twist": "Ρώσικες περιστροφές",
      "seed.x-abwheel": "Ρόδα κοιλιακών",
      "seed.x-run": "Τρέξιμο",
      "seed.x-walk": "Περπάτημα",
      "seed.x-bike": "Ποδήλατο",
      "seed.x-rowerg": "Κωπηλατική μηχανή",
      "seed.x-swim": "Κολύμπι",
      "seed.x-rope": "Σχοινάκι",
      "seed.x-burpee": "Burpees",
      "seed.x-kbswing": "Αιωρήσεις kettlebell",
      "seed.x-clean": "Power clean",
      "seed.p-full": "Όλο το σώμα 3×",
      "seed.p-ul": "Πάνω / Κάτω",
      "seed.p-ppl": "Ώθηση / Έλξη / Πόδια",
      "seed.p-full.a": "Όλο το σώμα Α",
      "seed.p-full.b": "Όλο το σώμα Β",
      "seed.p-ul.u": "Πάνω σώμα",
      "seed.p-ul.l": "Κάτω σώμα",
      "seed.p-ppl.push": "Ώθηση",
      "seed.p-ppl.pull": "Έλξη",
      "seed.p-ppl.legs": "Πόδια"
    }
  };
  if (typeof window !== "undefined" && window.orosI18n) window.orosI18n.table(SEED_STR, "fitness", LANG);
  // [id, group, kind] + English and Greek names from SEED_STR
  var SEED_EX = [
    ["x-bench", "chest", "wr"], ["x-incline", "chest", "wr"], ["x-dbbench", "chest", "wr"],
    ["x-dbfly", "chest", "wr"], ["x-pushup", "chest", "r"], ["x-dips", "chest", "r"],
    ["x-deadlift", "back", "wr"], ["x-row", "back", "wr"], ["x-dbrow", "back", "wr"],
    ["x-pullup", "back", "r"], ["x-chinup", "back", "r"], ["x-pulldown", "back", "wr"],
    ["x-cablerow", "back", "wr"], ["x-backext", "back", "r"], ["x-ohp", "shoulders", "wr"],
    ["x-dbshoulder", "shoulders", "wr"], ["x-latraise", "shoulders", "wr"], ["x-facepull", "shoulders", "wr"],
    ["x-rearfly", "shoulders", "wr"], ["x-curl", "biceps", "wr"], ["x-dbcurl", "biceps", "wr"],
    ["x-hammer", "biceps", "wr"], ["x-pushdown", "triceps", "wr"], ["x-skull", "triceps", "wr"],
    ["x-ohext", "triceps", "wr"], ["x-closebench", "triceps", "wr"], ["x-squat", "legs", "wr"],
    ["x-frontsquat", "legs", "wr"], ["x-legpress", "legs", "wr"], ["x-lunge", "legs", "wr"],
    ["x-bulgarian", "legs", "wr"], ["x-goblet", "legs", "wr"], ["x-rdl", "legs", "wr"],
    ["x-legcurl", "legs", "wr"], ["x-legext", "legs", "wr"], ["x-calf", "legs", "wr"],
    ["x-hipthrust", "glutes", "wr"], ["x-bridge", "glutes", "r"], ["x-plank", "core", "t"],
    ["x-sideplank", "core", "t"], ["x-crunch", "core", "r"], ["x-legraise", "core", "r"],
    ["x-twist", "core", "r"], ["x-abwheel", "core", "r"], ["x-run", "cardio", "dt"],
    ["x-walk", "cardio", "dt"], ["x-bike", "cardio", "dt"], ["x-rowerg", "cardio", "dt"],
    ["x-swim", "cardio", "dt"], ["x-rope", "cardio", "t"], ["x-burpee", "full", "r"],
    ["x-kbswing", "full", "wr"], ["x-clean", "full", "wr"]
  ].map(function (r) { return r.concat([SEED_STR.en["seed." + r[0]], SEED_STR.el["seed." + r[0]]]); });
  var SEED_MAP = {};
  SEED_EX.forEach(function (r) { SEED_MAP[r[0]] = { id: r[0], g: r[1], k: r[2], en: r[3], el: r[4], key: "seed." + r[0] }; });
  // Lower-body lifts take the larger progression step.
  var LOWER_IDS = { "x-deadlift": 1 };

  // Ready programs. Item: [exercise, sets, reps, repsTo, seconds, rest]
  function I(e, s, r, r2, sec, rest) { return { e: e, s: s, r: r || 0, r2: r2 || 0, t: sec || 0, w: 0, rest: rest || 0 }; }
  var SEED_PG = [
    { id: "p-full", days: [
      { id: "a", wd: [0, 4], it: [
        I("x-squat", 3, 5, 0, 0, 180), I("x-bench", 3, 5, 0, 0, 180), I("x-row", 3, 5, 0, 0, 150), I("x-plank", 3, 0, 0, 45, 60)] },
      { id: "b", wd: [2], it: [
        I("x-squat", 3, 5, 0, 0, 180), I("x-ohp", 3, 5, 0, 0, 150), I("x-deadlift", 1, 5, 0, 0, 180), I("x-pullup", 3, 6, 10, 0, 120)] }
    ] },
    { id: "p-ul", days: [
      { id: "u", wd: [0, 3], it: [
        I("x-bench", 4, 6, 8, 0, 150), I("x-row", 4, 6, 8, 0, 150), I("x-ohp", 3, 8, 10, 0, 120),
        I("x-pulldown", 3, 10, 12, 0, 90), I("x-curl", 3, 10, 12, 0, 60), I("x-pushdown", 3, 10, 12, 0, 60)] },
      { id: "l", wd: [1, 4], it: [
        I("x-squat", 4, 6, 8, 0, 180), I("x-rdl", 3, 8, 10, 0, 150), I("x-legpress", 3, 10, 12, 0, 120),
        I("x-legcurl", 3, 10, 12, 0, 90), I("x-calf", 4, 12, 15, 0, 60), I("x-plank", 3, 0, 0, 60, 60)] }
    ] },
    { id: "p-ppl", days: [
      { id: "push", wd: [0, 3], it: [
        I("x-bench", 4, 6, 8, 0, 150), I("x-incline", 3, 8, 10, 0, 120), I("x-ohp", 3, 8, 10, 0, 120),
        I("x-latraise", 3, 12, 15, 0, 60), I("x-pushdown", 3, 10, 12, 0, 60)] },
      { id: "pull", wd: [1, 4], it: [
        I("x-deadlift", 3, 5, 0, 0, 180), I("x-pullup", 3, 6, 10, 0, 120), I("x-row", 3, 8, 10, 0, 120),
        I("x-facepull", 3, 12, 15, 0, 60), I("x-curl", 3, 10, 12, 0, 60)] },
      { id: "legs", wd: [2, 5], it: [
        I("x-squat", 4, 6, 8, 0, 180), I("x-rdl", 3, 8, 10, 0, 150), I("x-legpress", 3, 10, 12, 0, 120),
        I("x-legcurl", 3, 10, 12, 0, 90), I("x-calf", 4, 12, 15, 0, 60)] }
    ] }
  ];
  // Names from SEED_STR: key, en, el on every program and day.
  SEED_PG.forEach(function (p) {
    function fill(o, key) { o.key = key; o.en = SEED_STR.en[key]; o.el = SEED_STR.el[key]; }
    fill(p, "seed." + p.id);
    p.days.forEach(function (d) { fill(d, "seed." + p.id + "." + d.id); });
  });
  // A ready exercise, program or day's name in the current language.
  function seedName(o) { return (SEED_STR[LANG] || SEED_STR.en)[o.key] || o.en; }

  // ---------- 3. Model: normalize, merge ----------
  // data = {
  //   ver: 1,
  //   ex:  [{ id, m, n, g, k, h }]      own exercises + edited ready ones
  //   pg:  [{ id, m, n, days: [{ id, n, wd[], it: [{ e, s, r, r2, t, w, rest }] }] }]
  //   wo:  [{ id, m, d, st, en, ti, p, pd, n, x: [{ e, tr, tr2, rest, s: [[w, r, t, dist, f]] }] }]
  //          en = 0 → the workout is still running
  //   pl:  [{ id, m, n, tp, rd, bb, k, tm{}, sl{}, fl{} }]   progression programs (plan-core.js)
  // Optional fields, written only when set (wave 29), so rows without
  // them keep their old canonical JSON:
  //   program item / workout entry  ln: 1  linked to the next one (superset, circuit)
  //   workout entry  pk: "t1:x-squat"  pr: [reps per working set]  am: 1  (last set "+")
  //   workout        pl: plan id, pp: plan position it was started at
  //                  g: { a, ps, sg[] }  outdoor GPS session (gps-core.js)
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
  var COLLS = ["ex", "pg", "wo", "bm", "pl"];
  var PK_RE = /^(m|a|t1|t2|t3|l):[a-z0-9-]{1,40}$/;
  var TPLS = ["531", "gzclp", "lin"];
  // The shared cores (plan-core.js, gps-core.js), also when this block
  // runs on its own in Node tests.
  function core(name) { return (typeof window !== "undefined" ? window : globalThis)[name] || null; }

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
    var v = { e: x.e, s: s, r: r, r2: r2, t: clampInt(x.t, 0, MAX_T), w: clampInt(x.w, 0, MAX_W), rest: clampInt(x.rest, 0, 3600) };
    if (x.ln) v.ln = 1;
    return v;
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
    var v = { e: x.e, tr: tr, tr2: tr2, rest: clampInt(x.rest, 0, 3600), s: s };
    if (x.ln) v.ln = 1;
    if (typeof x.pk === "string" && PK_RE.test(x.pk)) {
      v.pk = x.pk;
      v.pr = (Array.isArray(x.pr) ? x.pr : []).slice(0, MAX_SETS).map(function (n) { return clampInt(n, 0, MAX_R); });
      if (x.am) v.am = 1;
    }
    return v;
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
    var v = {
      id: x.id, m: x.m, d: x.d, st: x.st, en: en,
      ti: normStr(x.ti, NAME_LEN),
      p: typeof x.p === "string" && ID_RE.test(x.p) ? x.p : "",
      pd: typeof x.pd === "string" && DAYID_RE.test(x.pd) ? x.pd : "",
      n: normNote(x.n), x: xs
    };
    if (typeof x.pl === "string" && ID_RE.test(x.pl)) { v.pl = x.pl; v.pp = clampInt(x.pp, 0, 1000000); }
    var G = core("OrosFitnessGps");
    if (x.g && G) { var g = G.normGps(x.g); if (g) v.g = g; }
    return v;
  }
  // Progression program (plan-core.js): rd = plate step for rounding,
  // k = sessions done, tm = numbers per lift, sl = slot state, fl =
  // 5/3/1 lifts whose "+" set missed in this cycle.
  var SLOT_RE = /^(t1|t2|t3|l):[a-z0-9-]{1,40}$/;
  function normPl(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) || !stamp(x)) return null;
    if (TPLS.indexOf(x.tp) < 0) return null;
    var tm = {}, sl = {}, fl = {}, n = 0;
    if (x.tm && typeof x.tm === "object") Object.keys(x.tm).sort().forEach(function (k) {
      if (ID_RE.test(k) && n++ < 20) tm[k] = clampInt(x.tm[k], 0, MAX_W);
    });
    n = 0;
    if (x.sl && typeof x.sl === "object") Object.keys(x.sl).sort().forEach(function (k) {
      var s = x.sl[k];
      if (!SLOT_RE.test(k) || !s || typeof s !== "object" || n++ >= 30) return;
      sl[k] = { w: clampInt(s.w, 0, MAX_W), lv: clampInt(s.lv, 0, 2), b: clampInt(s.b, 0, MAX_W), f: clampInt(s.f, 0, 9) };
    });
    n = 0;
    if (x.fl && typeof x.fl === "object") Object.keys(x.fl).sort().forEach(function (k) {
      if (ID_RE.test(k) && x.fl[k] && n++ < 20) fl[k] = 1;
    });
    return { id: x.id, m: x.m, n: normStr(x.n, NAME_LEN), tp: x.tp, rd: clampInt(x.rd, 1, 100000) || 2500,
             bb: x.bb ? 1 : 0, k: clampInt(x.k, 0, 1000000), tm: tm, sl: sl, fl: fl };
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
  var NORM = { ex: normEx, pg: normPg, wo: normWo, bm: normBm, pl: normPl };

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
      // "pl" (wave 29) appears only once used, so data without
      // progression programs keeps its old canonical JSON.
      if (c !== "pl" || rows.length) out[c] = rows;
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
    var sep = DEC_COMMA ? "." : ",", mark = DEC_COMMA ? "," : ".";
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
      name: (row && row.n) || (seed ? seedName(seed) : "?"),
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
  // The rows of the CSV, heading first; num(v, dec) writes a number
  // (CSV: text with the language's decimal mark; sheet: a real number).
  function exportRows(d, num) {
    var set = settingsOf(d);
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
    return rows;
  }
  function buildCsv(d) {
    var sep = DEC_COMMA ? ";" : ",";
    var rows = exportRows(d, function (v, dec) {
      var p = Math.pow(10, dec), s = String(Math.round(v * p) / p);
      return DEC_COMMA ? s.replace(".", ",") : s;
    });
    return "﻿" + rows.map(function (r) {
      return r.map(function (c) { return csvCell(c, sep); }).join(sep);
    }).join("\r\n") + "\r\n";
  }

  // Assistant entry card (BR-W8-6, prefill only): the shell's
  // { asNew: { date?, start?, type?, minutes?, distanceKm?, note?,
  // from? } } → the values the "Log a workout" dialog opens with, or
  // null when there is no type, minutes, distance or note. date must
  // be a real day, not after today (else today); start is "HH:MM".
  // type names a timed or distance exercise (Running, Plank, an own
  // one: name in either language, any case, exactly one) or a GPS
  // word (run, walk, ride, bike, swim, row); it is also the title.
  // distanceKm (alias distance) is in km. Unknown fields are ignored.
  var LOG_ALIAS = { run: "x-run", running: "x-run", walk: "x-walk", walking: "x-walk", ride: "x-bike",
                    bike: "x-bike", cycling: "x-bike", swim: "x-swim", swimming: "x-swim", row: "x-rowerg" };
  function logExercises(d) {
    return allExercises(d).filter(function (i) { return i.k === "t" || i.k === "dt"; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, loc()); });
  }
  function normAsNew(d, x, today) {
    if (!x || typeof x !== "object") return null;
    var type = normStr(x.type, NAME_LEN), want = type.toLowerCase(), ex = "", n = 0;
    if (want) {
      logExercises(d).forEach(function (i) {
        var sd = SEED_MAP[i.id];
        if (i.name.toLowerCase() === want || (sd && (sd.en.toLowerCase() === want || sd.el.toLowerCase() === want || seedName(sd).toLowerCase() === want))) { ex = i.id; n++; }
      });
      if (n !== 1) ex = n ? "" : (LOG_ALIAS[want] || "");
    }
    var mins = typeof x.minutes === "number" && isFinite(x.minutes) ? Math.round(x.minutes) : 0;
    if (!(mins >= 1 && mins <= 1440)) mins = 0;
    var km = typeof x.distanceKm === "number" ? x.distanceKm : x.distance;
    var dist = typeof km === "number" && isFinite(km) && km > 0 ? Math.round(km * 1000) : 0;
    if (dist > MAX_D) dist = 0;
    var note = typeof x.note === "string" ? normNote(x.note.replace(/\r\n?/g, "\n").trim()) : "";
    if (!type && !mins && !dist && !note) return null;
    var day = parseYmd(x.date), tm = typeof x.start === "string" && /^(\d{1,2}):(\d{2})$/.exec(x.start.trim());
    return {
      ex: ex, ti: type, mins: mins, dist: dist, n: note,
      d: day && ymd(day) === x.date && x.date <= today ? x.date : today,
      st: tm && +tm[1] < 24 && +tm[2] < 60 ? pad2(+tm[1]) + ":" + tm[2] : ""
    };
  }

  // ---------- 4b. Import from Strong / Hevy (CSV) ----------
  // Both apps export one row per set. Columns are found by name, so
  // older and newer layouts both work:
  //   Strong: Date, Workout Name, Duration | Duration (sec), Exercise Name,
  //           Set Order (1, 2…, W, D, F, Rest Timer), Weight | Weight (kg|lbs),
  //           Reps, Distance | Distance (meters|km|miles), Seconds, Notes, Workout Notes
  //   Hevy:   title, start_time, end_time, description, exercise_title,
  //           exercise_notes, set_index, set_type (normal, warmup, dropset,
  //           failure), weight_kg | weight_lbs, reps, distance_km |
  //           distance_miles, duration_seconds
  // A column without a unit ("Weight") takes the unit the user picks.
  // Workout ids come from the file (source, start, title), so importing
  // the same file again skips what is already here, and a workout
  // deleted after an import stays deleted.
  var IMP_MAX = 20 * 1024 * 1024;
  var IMP_COLS = {
    start: ["date", "starttime"], end: ["endtime"], title: ["workoutname", "title"],
    dur: ["duration"], durS: ["durationsec"], ex: ["exercisename", "exercisetitle"],
    order: ["setorder"], type: ["settype"],
    w: ["weight"], wKg: ["weightkg"], wLb: ["weightlbs", "weightlb"], reps: ["reps"],
    dist: ["distance"], dM: ["distancemeters", "distancem"], dKm: ["distancekm"], dMi: ["distancemiles", "distancemi"],
    secs: ["seconds", "durationseconds"],
    note: ["workoutnotes", "description"], exNote: ["notes", "exercisenotes"]
  };
  // Common Strong / Hevy names that differ from the ready names here.
  // Keys are folded (impKey); a name equal to a ready English name
  // needs no line.
  var IMP_ALIAS = {
    "bench press barbell": "x-bench", "incline bench press barbell": "x-incline",
    "bench press dumbbell": "x-dbbench", "chest fly dumbbell": "x-dbfly", "push up": "x-pushup",
    "chest dip": "x-dips", "triceps dip": "x-dips", "deadlift barbell": "x-deadlift",
    "bent over row barbell": "x-row", "bent over one arm row dumbbell": "x-dbrow",
    "pull up": "x-pullup", "chin up": "x-chinup", "lat pulldown cable": "x-pulldown",
    "lat pulldown machine": "x-pulldown", "seated row cable": "x-cablerow",
    "seated cable row v grip cable": "x-cablerow", "back extension hyperextension": "x-backext",
    "overhead press barbell": "x-ohp", "strict military press barbell": "x-ohp",
    "shoulder press dumbbell": "x-dbshoulder", "seated overhead press dumbbell": "x-dbshoulder",
    "overhead press dumbbell": "x-dbshoulder", "lateral raise dumbbell": "x-latraise",
    "face pull cable": "x-facepull", "rear delt reverse fly dumbbell": "x-rearfly",
    "reverse fly dumbbell": "x-rearfly", "bicep curl barbell": "x-curl", "biceps curl barbell": "x-curl",
    "bicep curl dumbbell": "x-dbcurl", "biceps curl dumbbell": "x-dbcurl", "hammer curl dumbbell": "x-hammer",
    "triceps pushdown cable": "x-pushdown", "triceps pushdown": "x-pushdown",
    "triceps pushdown cable straight bar": "x-pushdown", "skullcrusher barbell": "x-skull",
    "skull crusher barbell": "x-skull", "triceps extension dumbbell": "x-ohext",
    "overhead triceps extension cable": "x-ohext", "bench press close grip barbell": "x-closebench",
    "close grip bench press barbell": "x-closebench", "squat barbell": "x-squat",
    "full squat barbell": "x-squat", "front squat barbell": "x-frontsquat", "leg press machine": "x-legpress",
    "lunge dumbbell": "x-lunge", "lunge barbell": "x-lunge", "bulgarian split squat dumbbell": "x-bulgarian",
    "goblet squat kettlebell": "x-goblet", "goblet squat dumbbell": "x-goblet",
    "romanian deadlift barbell": "x-rdl", "romanian deadlift dumbbell": "x-rdl",
    "lying leg curl machine": "x-legcurl", "seated leg curl machine": "x-legcurl",
    "leg extension machine": "x-legext", "standing calf raise machine": "x-calf",
    "standing calf raise": "x-calf", "seated calf raise machine": "x-calf", "hip thrust barbell": "x-hipthrust",
    "ab wheel": "x-abwheel", "running treadmill": "x-run", "running outdoor": "x-run",
    "cycling indoor": "x-bike", "rowing machine": "x-rowerg", "row machine": "x-rowerg",
    "kettlebell swing kettlebell": "x-kbswing", "power clean barbell": "x-clean", "burpees": "x-burpee",
    // FitNotes and JEFIT write the equipment first
    "flat barbell bench press": "x-bench", "barbell bench press": "x-bench", "incline barbell bench press": "x-incline",
    "barbell incline bench press": "x-incline", "flat dumbbell bench press": "x-dbbench", "dumbbell bench press": "x-dbbench",
    "flat dumbbell fly": "x-dbfly", "barbell squat": "x-squat", "barbell front squat": "x-frontsquat",
    "barbell deadlift": "x-deadlift", "barbell romanian deadlift": "x-rdl", "barbell row": "x-row",
    "barbell bent over row": "x-row", "bent over barbell row": "x-row", "one arm dumbbell row": "x-dbrow",
    "overhead press": "x-ohp", "barbell shoulder press": "x-ohp", "standing barbell military press": "x-ohp",
    "seated dumbbell press": "x-dbshoulder", "dumbbell shoulder press": "x-dbshoulder",
    "dumbbell lateral raise": "x-latraise", "lateral dumbbell raise": "x-latraise", "wide grip lat pulldown": "x-pulldown",
    "dumbbell hammer curl": "x-hammer", "ez bar curl": "x-curl", "rope push down": "x-pushdown",
    "lying leg curl": "x-legcurl", "machine leg press": "x-legpress",
    "barbell hip thrust": "x-hipthrust", "pull ups": "x-pullup", "push ups": "x-pushup"
  };
  // A bracketed equipment name that does not change the lift here.
  var IMP_PLAIN = /\s(barbell|bodyweight|machine|cable)$/;
  var IMP_GROUP = [
    [/plank|crunch|sit ?up|\babs?\b|leg raise|twist|wheel|hollow|v up/, "core"],
    [/run|walk|cycl|bike|swim|row(ing)? machine|rower|elliptical|stair|jump rope|treadmill|hiking/, "cardio"],
    [/hip thrust|glute|kickback|abduct/, "glutes"],
    [/curl/, "biceps"],
    [/tricep|pushdown|skull|dip/, "triceps"],
    [/squat|leg|lunge|calf|step up|deadlift/, "legs"],
    [/bench|chest|fly|crossover|push ?up|pec/, "chest"],
    [/row|pull|lat |chin|shrug|back/, "back"],
    [/shoulder|overhead|military|lateral|raise|delt|arnold/, "shoulders"]
  ];
  var IMP_MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  function impKey(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  function impHash(s) {
    var a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
    }
    return a.toString(36) + b.toString(36);
  }
  // RFC 4180 rows; the separator (, ; or tab) is the one the header uses most.
  function parseCsvRows(text) {
    text = String(text).replace(/^﻿/, "");
    var head = text.slice(0, text.search(/\r?\n|$/));
    var sep = ",", best = -1;
    [",", ";", "\t"].forEach(function (c) {
      var n = head.split(c).length;
      if (n > best) { best = n; sep = c; }
    });
    var rows = [], row = [], cell = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return c.trim(); }); });
  }
  function impNum(s) {
    s = String(s == null ? "" : s).trim();
    if (s.indexOf(".") < 0) s = s.replace(",", ".");
    var v = parseFloat(s);
    return isFinite(v) && v > 0 ? v : 0;
  }
  // "2023-01-15 08:30:00", "2023-01-15T08:30", "15 Jan 2023, 08:30" → local ms
  function impDate(s) {
    s = String(s || "").trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
    m = /^(\d{1,2}) ([A-Za-z]{3})[A-Za-z]*\.?,? (\d{4}),? (\d{1,2}):(\d{2})/.exec(s);
    if (m && IMP_MON[m[2].toLowerCase()] != null) return new Date(+m[3], IMP_MON[m[2].toLowerCase()], +m[1], +m[4], +m[5]).getTime();
    return NaN;
  }
  // Strong's "1h 5m", "45m", "50s" → seconds
  function impDur(s) {
    s = String(s || "");
    var h = /(\d+)\s*h/.exec(s), m = /(\d+)\s*m(?!s)/.exec(s), sec = /(\d+)\s*s/.exec(s);
    var v = (h ? +h[1] * 3600 : 0) + (m ? +m[1] * 60 : 0) + (sec ? +sec[1] : 0);
    if (!v && /^\d+$/.test(s.trim())) v = +s.trim();
    return v;
  }

  // Text → { src, unitKnown, rows: [{ key, start, end, title, note, ex, exNote, warm, w, r, t, dist }] }
  // with weights still in file units (w: number, wu: "kg" | "lb" | ""),
  // or null when the file is neither export.
  function parseImport(text) {
    var all = parseCsvRows(text);
    if (all.length < 2) return null;
    var head = all[0].map(function (h) { return h.toLowerCase().replace(/[^a-z#]/g, ""); });
    var col = {};
    Object.keys(IMP_COLS).forEach(function (k) {
      col[k] = -1;
      IMP_COLS[k].forEach(function (n) { if (col[k] < 0) col[k] = head.indexOf(n); });
    });
    if (col.start < 0 || col.ex < 0) return null;
    var src = col.type >= 0 || head.indexOf("exercisetitle") >= 0 ? "hevy" : "strong";
    var wu = col.wKg >= 0 ? "kg" : (col.wLb >= 0 ? "lb" : "");
    var du = col.dM >= 0 ? "m" : (col.dKm >= 0 ? "km" : (col.dMi >= 0 ? "mi" : ""));
    var unitKnown = !!(wu || col.w < 0) && !!(du || col.dist < 0);
    var get = function (r, k) { return col[k] >= 0 && r[col[k]] != null ? String(r[col[k]]).trim() : ""; };
    var rows = [];
    all.slice(1).forEach(function (r) {
      var ex = normStr(get(r, "ex"), NAME_LEN);
      var startS = get(r, "start"), start = impDate(startS);
      if (!ex || isNaN(start)) return;
      var order = get(r, "order").toLowerCase(), type = get(r, "type").toLowerCase();
      if (order.indexOf("rest") >= 0) return;          // Strong's rest-timer rows
      var w = wu === "kg" ? impNum(get(r, "wKg")) : (wu === "lb" ? impNum(get(r, "wLb")) : impNum(get(r, "w")));
      var dist = du === "m" ? impNum(get(r, "dM")) : (du === "km" ? impNum(get(r, "dKm")) : (du === "mi" ? impNum(get(r, "dMi")) : impNum(get(r, "dist"))));
      var reps = Math.round(impNum(get(r, "reps"))), secs = Math.round(impNum(get(r, "secs")));
      if (!w && !reps && !secs && !dist) return;
      var end = impDate(get(r, "end"));
      var dur = col.durS >= 0 ? Math.round(impNum(get(r, "durS"))) : impDur(get(r, "dur"));
      if (isNaN(end)) end = start + dur * 1000;
      var title = normStr(get(r, "title"), NAME_LEN);
      rows.push({
        key: src + "|" + startS + "|" + title, start: start, end: Math.max(start, end), title: title,
        note: get(r, "note"), ex: ex, exNote: normStr(get(r, "exNote"), 200),
        warm: order === "w" || type === "warmup" || type === "warm up",
        w: w, wu: wu, r: reps, t: secs, dist: dist, du: du
      });
    });
    return rows.length ? { src: src, unitKnown: unitKnown, rows: rows } : null;
  }

  // Which exercise here an imported name is. Kind first: a ready
  // exercise is used only when its measure fits the numbers in the file.
  function impKind(sets) {
    var w = 0, r = 0, t = 0, d = 0;
    sets.forEach(function (s) { if (s.w) w++; if (s.r) r++; if (s.t) t++; if (s.dist) d++; });
    if (d) return "dt";
    if (w) return "wr";
    if (r) return "r";
    return t ? "t" : "wr";
  }
  function impGroup(key) {
    for (var i = 0; i < IMP_GROUP.length; i++) if (IMP_GROUP[i][0].test(key)) return IMP_GROUP[i][1];
    return "full";
  }
  function impMatch(d, name, kind) {
    var key = impKey(name), plain = key.replace(IMP_PLAIN, "");
    var fits = function (id) {
      var k = SEED_MAP[id].k;
      return k === kind || (k === "wr" && kind === "r");
    };
    var cands = [IMP_ALIAS[key]];
    SEED_EX.forEach(function (s) { if (impKey(s[3]) === key || impKey(s[4]) === key) cands.push(s[0]); });
    cands.push(IMP_ALIAS[plain]);
    SEED_EX.forEach(function (s) { if (plain !== key && impKey(s[3]) === plain) cands.push(s[0]); });
    for (var i = 0; i < cands.length; i++) if (cands[i] && fits(cands[i])) return cands[i];
    var own = null, low = name.toLowerCase();
    (d.ex || []).forEach(function (x) { if (!own && !SEED_MAP[x.id] && x.n.toLowerCase() === low) own = x.id; });
    return own;
  }

  // Parsed file → rows to merge plus a summary for the preview.
  // unit: "kg" or "lb", only used where the file has no unit.
  // revive: workouts deleted here after an earlier import come back
  // (one step newer than their tombstone); otherwise they stay away.
  // Also used for FitNotes and JEFIT (import.js gives the same rows).
  function buildImport(d, parsed, unit, now, revive) {
    var wuF = function (s) { return wFactor((s.wu || unit) === "lb" ? "lb" : "kg"); };
    var duF = function (s) { var u = s.du || (unit === "lb" ? "mi" : "km"); return u === "m" ? 1 : dFactor(u); };
    var byName = {}, order = [];
    parsed.rows.forEach(function (s) {
      if (!byName[s.ex]) { byName[s.ex] = []; order.push(s.ex); }
      byName[s.ex].push(s);
    });
    var exId = {}, exRows = [], newNames = [], matched = 0;
    order.forEach(function (name) {
      var kind = impKind(byName[name]);
      var id = impMatch(d, name, kind);
      if (id) { exId[name] = id; matched++; return; }
      id = "ix-" + impHash(impKey(name) + "|" + kind);
      exId[name] = id;
      newNames.push(name);
      if (!findIn(d.ex, id)) exRows.push({ id: id, m: Math.max(now, ((d.tombs || {})["ex:" + id] || 0) + 1), n: name, g: impGroup(impKey(name)), k: kind, h: 0 });
    });
    var groups = {}, keys = [];
    parsed.rows.forEach(function (s) {
      if (!groups[s.key]) { groups[s.key] = []; keys.push(s.key); }
      groups[s.key].push(s);
    });
    var wos = [], skipped = 0, gone = 0, sets = 0, from = Infinity, to = 0, tombs = d.tombs || {};
    keys.forEach(function (k) {
      var rows = groups[k], first = rows[0];
      var id = "i-" + impHash(k);
      if (findIn(d.wo, id)) { skipped++; return; }
      if (("wo:" + id) in tombs) { gone++; if (!revive) return; }
      var x = [], notes = [], seenNote = {};
      if (first.note) notes.push(first.note);
      rows.forEach(function (s) {
        var last = x[x.length - 1];
        if (!last || last.name !== s.ex || last.s.length >= MAX_SETS) {
          if (x.length >= MAX_ITEMS) return;
          last = { name: s.ex, e: exId[s.ex], tr: 0, tr2: 0, rest: 0, s: [] };
          x.push(last);
        }
        last.s.push([Math.min(MAX_W, Math.round(s.w * wuF(s))), Math.min(MAX_R, s.r), Math.min(MAX_T, s.t),
                     Math.min(MAX_D, Math.round(s.dist * duF(s))), F_DONE | (s.warm ? F_WARM : 0)]);
        if (s.exNote && !seenNote[s.ex + s.exNote]) { seenNote[s.ex + s.exNote] = 1; notes.push(s.ex + ": " + s.exNote); }
      });
      var end = 0;
      rows.forEach(function (s) { end = Math.max(end, s.end); });
      x.forEach(function (e) { sets += e.s.length; delete e.name; });
      from = Math.min(from, first.start);
      to = Math.max(to, first.start);
      wos.push({ id: id, m: Math.max(now, (tombs["wo:" + id] || 0) + 1), d: ymd(new Date(first.start)), st: first.start, en: Math.max(first.start, end),
                 ti: first.title, p: "", pd: "", n: notes.join("\n"), x: x });
    });
    return { src: parsed.src, unitKnown: parsed.unitKnown, wo: wos, ex: exRows, skipped: skipped, gone: gone, sets: sets,
             matched: matched, newNames: newNames, from: wos.length ? ymd(new Date(from)) : "", to: wos.length ? ymd(new Date(to)) : "" };
  }
  function findIn(list, id) {
    for (var i = 0; list && i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
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
    if (!data[c]) data[c] = [];
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
    data[c] = (data[c] || []).filter(function (r) { return r.id !== id; });
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
      rest: p.rest && isInt(p.rest.end) && isInt(p.rest.total) ? { end: p.rest.end, total: p.rest.total, ex: normStr(p.rest.ex, NAME_LEN) } : null,
      gps: typeof p.gps === "string" && ID_RE.test(p.gps) ? p.gps : ""    // outdoor session recording on this device
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
    trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    skip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4l10 8-10 8z"/><path d="M19 5v14"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
    walk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4" r="2"/><path d="M11 21l2-6-3-3 1-5 3 3h3M9 9l-3 3M13 15l2 6"/></svg>',
    run: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="15" cy="4" r="2"/><path d="M4 17l4 1 2-4M10 14l3 2-1 5M13 16l-1-6 4 1 3 3M12 10L8 9l-2 3"/></svg>',
    ride: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><circle cx="15" cy="5" r="1.5"/><path d="M5.5 17l4-7h5l4 7M9.5 10L12 17h-1M12 10l2-3"/></svg>'
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
    if (LANG !== "en") {
      try { return wd + d.toLocaleDateString(loc(), { day: "numeric", month: "short", year: "numeric" }); } catch (e) {}
    }
    return wd + MONTHS.en[d.getMonth()].slice(0, 3) + " " + d.getDate() + ", " + d.getFullYear();
  }
  // A month's full name ("Oktober" in German) for month headings.
  function monthName(i) {
    if (MONTHS[LANG]) return MONTHS[LANG][i];
    try { return new Date(2026, i, 1).toLocaleDateString(loc(), { month: "long" }); } catch (e) { return MONTHS.en[i]; }
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
    var todays = window.OrosFitnessCore.plannedOn(data, ymd(new Date())).map(function (r) {   // fitness/core.js
      return dayRef(r.pg.id, r.day.id);
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

    // Progression programs: the next session of each
    if (plans().length) {
      var sPl = section(t("pl.title"));
      plans().forEach(function (pl) { sPl.appendChild(planCard(pl, !!act)); });
      v.appendChild(sPl);
    }

    // Outdoor GPS session
    var sg = section(t("gps.title"));
    var row = el("div", "gps-starts");
    ["walk", "run", "ride"].forEach(function (a) {
      var b = txtBtn("go-btn gps-go", UI[a], t("gps." + a), function () { startGps(a); });
      b.disabled = !!act;
      row.appendChild(b);
    });
    sg.appendChild(row);
    sg.appendChild(hint(t("gps.hint")));
    v.appendChild(sg);

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
    txt.appendChild(el("small", "", itemNames(r.day.it, function (i) { return exInfo(data, i.e).name; })));
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
    var entry = { e: exId, tr: item ? item.r : (prev ? prev.tr : 0), tr2: item ? item.r2 : (prev ? prev.tr2 : 0),
                  rest: item ? item.rest : (prev ? prev.rest : 0), s: sets };
    if (item && item.ln) entry.ln = 1;
    return entry;
  }
  // Names of program items or workout entries; linked ones (superset,
  // circuit) are joined with " + ".
  function itemNames(list, nameOf) {
    return list.map(function (i, k) { return nameOf(i) + (k < list.length - 1 ? (i.ln ? " + " : " · ") : ""); }).join("");
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
    if (w.g && !w.en) { renderGps(v, w); return; }
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

    // Supersets and circuits: linked entries share one box, run round by round.
    var P = core("OrosFitnessPlan"), nx = running ? P.nextUp(w.x) : null;
    if (w.en && w.g) v.appendChild(gpsSection(w, set));
    if (w.x.some(function (e) { return e.am; })) v.appendChild(hint(t("pl.plus")));
    P.groupsOf(w.x).forEach(function (g) {
      if (g[0] === g[1]) { v.appendChild(entryCard(w, w.x[g[0]], g[0], set, nx, false)); return; }
      var box = el("section", "grp"), head = el("div", "grp-h"), rd = P.roundOf(w.x, g);
      head.appendChild(el("b", "", t(g[1] - g[0] === 1 ? "ss.superset" : "ss.circuit")));
      var bits = [];
      if (running) bits.push(t("ss.round", { n: rd.at, of: rd.of }));
      bits.push(t("ss.restRound", { t: fmtTime(P.groupRest(w.x, g[0]) || set.rest) }));
      head.appendChild(el("small", "", bits.join(" · ")));
      box.appendChild(head);
      for (var i = g[0]; i <= g[1]; i++) box.appendChild(entryCard(w, w.x[i], i, set, nx, true));
      v.appendChild(box);
    });

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
          if (gpsLive && gpsLive.id === w.id) gpsStop();
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

  var TIER = { t1: "T1", t2: "T2", t3: "T3", a: "BBB", m: "5/3/1", l: "5×5" };
  function entryCard(w, e, ei, set, nx, inGroup) {
    var info = exInfo(data, e.e);
    var card = el(inGroup ? "div" : "section", "ex-card");
    var top = el("div", "ex-top");
    var nm = el("div", "ex-name");
    nm.appendChild(el("b", "", info.name));
    var meta = [];
    if (e.pk) meta.push(TIER[e.pk.slice(0, e.pk.indexOf(":"))] || "");
    if (e.tr || e.s.length) {
      var rr = e.tr ? (e.tr2 ? e.tr + "–" + e.tr2 : String(e.tr)) + (e.am ? "+" : "") : "";
      if (rr) meta.push(t("wo.target", { s: e.s.filter(function (s) { return !isWarm(s); }).length, r: rr }));
    }
    if (!inGroup) meta.push(t("wo.rest", { t: fmtTime(e.rest || set.rest) }));
    nm.appendChild(el("small", "", meta.join(" · ")));
    top.appendChild(nm);
    var mv = el("div", "ex-tools");
    mv.appendChild(iconBtn("mini", UI.image, t("pic.show") + ": " + info.name, function () { picDialog(e.e); }));
    if (ei < w.x.length - 1) {
      var lk = iconBtn("mini" + (e.ln ? " on" : ""), UI.link, t(e.ln ? "ss.unlink" : "ss.link"), function () {
        var x = findRow("wo", w.id);
        if (!x || !x.x[ei]) return;
        if (x.x[ei].ln) delete x.x[ei].ln; else x.x[ei].ln = 1;
        woChanged(x, true);
      });
      lk.setAttribute("aria-pressed", e.ln ? "true" : "false");
      mv.appendChild(lk);
    }
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
    var nWork = 0, lastWork = -1;
    e.s.forEach(function (s, si) { if (!isWarm(s)) lastWork = si; });
    e.s.forEach(function (s, si) {
      var warm = isWarm(s);
      if (!warm) nWork++;
      var row = setRow(w, e, ei, s, si, warm ? "W" : String(nWork) + (e.am && si === lastWork ? "+" : ""), info, set);
      if (nx && nx[0] === ei && nx[1] === si) row.classList.add("next");
      tbl.appendChild(row);
    });
    if (e.pk && e.pk.indexOf("t3:") === 0 && !e.s.some(function (s) { return s[0] > 0; })) card.appendChild(hint(t("pl.t3")));
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
      // Flow order: set after set, or a superset / circuit round by
      // round with the rest after the round (plan-core.js).
      var P = core("OrosFitnessPlan"), nxt = P.nextAfter(x.x, ei, si);
      var next = nxt ? exInfo(data, x.x[nxt[0]].e).name : null, g = P.groupAt(x.x, ei);
      if (g[0] === g[1]) startRest(e.rest || settings().rest, next);
      else if (P.restAfter(x.x, ei, si)) startRest(P.groupRest(x.x, ei) || settings().rest, next);
      else {
        if (prefs.rest) stopRest();
        if (next) live(t("ss.now", { ex: next }));
      }
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
    if (w.g) { gpsFinalize(w); if (!w.x.some(function (e) { return e.s.some(isDone); })) { showToast(t("gps.noTrack")); return; } }
    var done = 0, open = 0;
    w.x.forEach(function (e) { e.s.forEach(function (s) { if (isDone(s)) done++; else open++; }); });
    if (!done) { showToast(t("wo.noSets")); return; }
    var go = function () {
      var x = findRow("wo", id);
      if (!x) return;
      x.x.forEach(function (e) { e.s = e.s.filter(isDone); });
      x.x = x.x.filter(function (e) { return e.s.length; });
      x.en = Math.max(Date.now(), x.st + 60000);
      if (x.g) { gpsStop(); gpsThin(x); x.g.ps = 0; }
      touch(x);
      var notes = x.pl ? advancePlan(x) : null;
      saveNow(false);
      stopRest();
      editId = null;
      render();
      summaryDialog(x, notes);
    };
    if (open) confirmDialog(t("wo.finishQ") + " " + t("wo.finishOpen", { n: open }), t("wo.finish"), false, go);
    else go();
  }

  function summaryDialog(w, planNotes) {
    var set = settings();
    var dlg = makeDialog("fit-sum", t("sum.title"));
    dlg.appendChild(el("div", "sum-name", w.ti || t("wo.title")));
    dlg.appendChild(sumGrid(w, set));
    if (planNotes) {
      dlg.appendChild(el("div", "dlg-sub", t("pl.sum")));
      if (planNotes === "stale") dlg.appendChild(hint(t("pl.stale")));
      else {
        var pul = el("ul", "plan-notes");
        planNotes.forEach(function (n) { pul.appendChild(el("li", "", planNoteText(n))); });
        dlg.appendChild(pul);
      }
    }
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
                      .sort(function (a, b) { return a.name.localeCompare(b.name, loc()); });
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

  // ---------- 7b. Progression programs, outdoor GPS sessions, pictures ----------
  // The rules live in plan-core.js (OrosFitnessPlan) and gps-core.js
  // (OrosFitnessGps); this is their screen side.
  function plans() { return data.pl || []; }
  function planName(pl) { return pl.n || t("tpl." + pl.tp); }
  function planPos(pl) {
    var p = core("OrosFitnessPlan").position(pl);
    if (pl.tp === "531") {
      return t("pl.cycle", { n: p.cyc + 1 }) + " · " + (p.wk === 3 ? t("pl.deload") : t("pl.week", { n: p.wk + 1 })) +
        " · " + exInfo(data, p.lift).name;
    }
    return t("pl.cycle", { n: p.cyc + 1 }) + " · " + t("pl.day", { d: p.dayName });
  }
  // "Squat 5×3+ · 100 kg" for each exercise of the next session
  function sessionLines(pl) {
    var set = settings();
    return core("OrosFitnessPlan").session(pl).items.map(function (it) {
      var work = it.sets.filter(function (s) { return !s.warm; }), top = 0, plus = false;
      work.forEach(function (s) { top = Math.max(top, s.w); if (s.plus) plus = true; });
      var reps = work.map(function (s) { return s.r; });
      var same = reps.every(function (r) { return r === reps[0]; });
      return exInfo(data, it.e).name + " " + (same ? work.length + "×" + reps[0] : reps.join("/")) + (plus ? "+" : "") +
        (top ? " · " + fmtW(top, set.wu) + " " + set.wu : "");
    });
  }
  function planCard(pl, busy, tools) {
    var row = el("div", "day-card plan-card");
    var txt = el("div", "day-txt");
    txt.appendChild(el("b", "", planName(pl)));
    txt.appendChild(el("small", "", t("pl.next", { pos: planPos(pl) })));
    txt.appendChild(el("small", "dim", sessionLines(pl).join(" · ")));
    row.appendChild(txt);
    var side = el("div", "plan-side");
    (tools || []).forEach(function (b) { side.appendChild(b); });
    var b = txtBtn("go-btn", UI.play, t("train.start"), function () { startPlan(pl.id); });
    b.disabled = busy;
    side.appendChild(b);
    row.appendChild(side);
    return row;
  }
  function startPlan(plId) {
    var pl = findRow("pl", plId);
    if (!pl || activeWorkout()) return;
    var P = core("OrosFitnessPlan"), ses = P.session(pl), now = Date.now();
    var xs = ses.items.map(function (it) {
      var e = P.entryOf(it);
      // A slot without a weight yet (GZCLP T3 at first): last time's weight.
      if (!e.s.some(function (s) { return s[0] > 0; })) {
        var prev = lastEntry(data, e.e, now, null), pw = prev ? working(prev) : [];
        if (pw.length) e.s.forEach(function (s) { if (!isWarm(s)) s[0] = pw[pw.length - 1][0]; });
      }
      return e;
    });
    var w = normWo({ id: newId(), m: now, d: ymd(new Date(now)), st: now, en: 0, ti: planName(pl) + " · " + planPos(pl),
                     p: "", pd: "", n: "", x: xs, pl: pl.id, pp: ses.pos });
    putRow("wo", w);
    saveNow(true);
    announced = {};
    openEditor(w.id);
  }
  // A finished plan workout moves its program on (once).
  function advancePlan(x) {
    var pl = findRow("pl", x.pl);
    if (!pl) return null;
    var res = core("OrosFitnessPlan").advance(pl, x, settings());
    if (!res) return "stale";
    res.plan.m = Math.max(Date.now(), pl.m + 1);
    var np = normPl(res.plan);
    if (np) putRow("pl", np);
    return res.notes;
  }
  function stageText(pk, lv) {
    var P = core("OrosFitnessPlan"), tier = pk.slice(0, 2);
    if (tier === "t1") return P.T1[lv][0] + "×" + P.T1[lv][1] + "+";
    if (tier === "t2") return P.T2[lv][0] + "×" + P.T2[lv][1];
    return "";
  }
  function planNoteText(n) {
    var set = settings(), p = { ex: exInfo(data, n.e).name, w: fmtW(n.w, set.wu) + " " + set.wu };
    if (n.what === "stage" || n.what === "reset") p.sets = stageText(n.pk, n.lv || 0);
    return t("pl." + n.what, p);
  }

  // Programs tab: the progression programs and their numbers.
  function renderPlans(v) {
    var s = section(t("pl.title"));
    s.appendChild(hint(t("pl.intro")));
    var busy = !!activeWorkout();
    plans().forEach(function (pl) {
      s.appendChild(planCard(pl, busy, [
        iconBtn("mini", UI.edit, t("pl.edit") + ": " + planName(pl), function () { planNumbersDialog(pl.id); }),
        iconBtn("mini", UI.skip, t("pl.skip") + ": " + planName(pl), function () {
          confirmDialog(t("pl.skipQ"), t("pl.skip"), false, function () {
            var cur = findRow("pl", pl.id);
            if (!cur) return;
            var np = core("OrosFitnessPlan").skip(cur, settings());
            np.m = Math.max(Date.now(), cur.m + 1);
            putRow("pl", normPl(np));
            saveNow(false);
            render();
            showToast(t("pl.skipped"));
          });
        }),
        iconBtn("mini danger", UI.trash, t("pg.del") + ": " + planName(pl), function () {
          var row = removeRow("pl", pl.id);
          saveNow(false);
          render();
          undoToast(t("pg.deleted"), function () { restoreRow("pl", row); saveNow(false); render(); });
        })
      ]));
    });
    s.appendChild(txtBtn("wide-btn", UI.plus, t("pl.new"), newPlanDialog));
    v.appendChild(s);
  }
  function defRound() { return settings().wu === "lb" ? Math.round(5 * LB_G) : 2500; }
  function newPlanDialog() {
    var P = core("OrosFitnessPlan"), set = settings();
    var dlg = makeDialog("fit-plan", t("pl.new"));
    var form = el("form");
    form.method = "dialog";
    var tp = el("select");
    P.TPLS.forEach(function (x) { var o = el("option", "", t("tpl." + x)); o.value = x; tp.appendChild(o); });
    form.appendChild(field(t("pl.pick"), tp));
    var desc = el("p", "hint");
    form.appendChild(desc);
    var rd = input("text", fmtW(defRound(), set.wu), "decimal");
    form.appendChild(field(t("pl.round", { u: set.wu }), rd));
    var lifts = el("div", "plan-lifts");
    form.appendChild(lifts);
    var bbW = el("label", "chk"), bb = el("input");
    bb.type = "checkbox";
    bbW.appendChild(bb);
    bbW.appendChild(el("span", "", t("pl.bbb")));
    form.appendChild(bbW);
    var inputs = {};
    function paint() {
      var x = tp.value, rdG = parseW(rd.value, set.wu), any = false;
      desc.textContent = t("tplD." + x);
      bbW.hidden = x !== "531";
      lifts.innerHTML = "";
      var fin = finished(data);
      P.LIFTS[x].forEach(function (lift) {
        var best = bestsFor(fin, lift, "wr", null).e1 || 0;
        var sug = P.suggestStart(x, best, rdG > 0 ? rdG : defRound());
        if (sug) any = true;
        var i = input("text", sug ? fmtW(sug, set.wu) : "", "decimal");
        inputs[lift] = i;
        lifts.appendChild(field(exInfo(data, lift).name + " · " + t("pl.tm." + x) + " (" + set.wu + ")", i));
      });
      if (any) lifts.appendChild(hint(t("pl.fromHist")));
    }
    tp.addEventListener("change", function () { inputs = {}; paint(); });
    paint();
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("pl.create"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var x = tp.value, rdG = parseW(rd.value, set.wu), tm = {}, bad = false;
      rd.classList.toggle("bad", !(rdG > 0));
      if (!(rdG > 0)) return;
      P.LIFTS[x].forEach(function (lift) {
        var g = parseW(inputs[lift].value, set.wu);
        inputs[lift].classList.toggle("bad", !(g > 0));
        if (g > 0) tm[lift] = P.roundTo(g, rdG); else bad = true;
      });
      if (bad) { showToast(t("pl.needTm")); return; }
      var row = normPl({ id: newId(), m: Date.now(), n: "", tp: x, rd: rdG, bb: x === "531" && bb.checked ? 1 : 0,
                         k: 0, tm: tm, sl: P.initPlan(x, tm, rdG), fl: {} });
      if (!row) return;
      putRow("pl", row);
      saveNow(false);
      dlg.close();
      render();
      showToast(t("pl.created"));
    });
    dlg.appendChild(form);
    openDialog(dlg);
  }
  // Change a program's numbers: 5/3/1 training maxes, GZCLP / Linear
  // working weights, the plate step and BBB.
  function planNumbersDialog(plId) {
    var pl = findRow("pl", plId);
    if (!pl) return;
    var set = settings();
    var dlg = makeDialog("fit-plan", planName(pl));
    var form = el("form");
    form.method = "dialog";
    var rd = input("text", fmtW(pl.rd, set.wu), "decimal");
    form.appendChild(field(t("pl.round", { u: set.wu }), rd));
    form.appendChild(el("div", "dlg-sub", t(pl.tp === "531" ? "pl.tms" : "pl.weights")));
    var fields = [];
    if (pl.tp === "531") {
      Object.keys(pl.tm).forEach(function (lift) {
        var i = input("text", pl.tm[lift] ? fmtW(pl.tm[lift], set.wu) : "", "decimal");
        fields.push({ kind: "tm", key: lift, inp: i });
        form.appendChild(field(exInfo(data, lift).name + " (" + set.wu + ")", i));
      });
    } else {
      Object.keys(pl.sl).forEach(function (k) {
        var s = pl.sl[k], tier = k.slice(0, k.indexOf(":")), lift = k.slice(k.indexOf(":") + 1);
        var i = input("text", s.w ? fmtW(s.w, set.wu) : "", "decimal");
        fields.push({ kind: "sl", key: k, inp: i });
        var lbl = (tier === "l" ? "" : TIER[tier] + " · ") + exInfo(data, lift).name +
          (tier === "t1" || tier === "t2" ? " · " + stageText(k, s.lv) : "") + " (" + set.wu + ")";
        form.appendChild(field(lbl, i));
      });
    }
    var bb = null;
    if (pl.tp === "531") {
      var bbW = el("label", "chk");
      bb = el("input");
      bb.type = "checkbox";
      bb.checked = !!pl.bb;
      bbW.appendChild(bb);
      bbW.appendChild(el("span", "", t("pl.bbb")));
      form.appendChild(bbW);
    }
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var cur = findRow("pl", plId);
      if (!cur) { dlg.close(); return; }
      var x = JSON.parse(JSON.stringify(cur)), rdG = parseW(rd.value, set.wu), bad = !(rdG > 0);
      rd.classList.toggle("bad", !(rdG > 0));
      fields.forEach(function (f) {
        var raw = f.inp.value.trim(), g = raw === "" ? 0 : parseW(raw, set.wu);
        f.inp.classList.toggle("bad", isNaN(g));
        if (isNaN(g)) { bad = true; return; }
        if (f.kind === "tm") x.tm[f.key] = g; else x.sl[f.key].w = g;
      });
      if (bad) return;
      x.rd = rdG;
      if (bb) x.bb = bb.checked ? 1 : 0;
      x.m = Math.max(Date.now(), cur.m + 1);
      putRow("pl", normPl(x));
      saveNow(false);
      dlg.close();
      render();
      showToast(t("pl.saved"));
    });
    dlg.appendChild(form);
    openDialog(dlg);
  }

  function sumGrid(w, set) {
    var grid = el("div", "sum-grid"), cells;
    if (w.g) {
      var st = w.x[0] ? entryStats(w.x[0], "dt") : { dist: 0, time: 0 };
      if (!st.dist && w.x[0] && w.x[0].s[0]) st = { dist: w.x[0].s[0][3], time: w.x[0].s[0][2] };
      cells = [[t("gps.time"), fmtTime(st.time)], [t("gps.dist"), fmtDist(st.dist, set.du) + " " + set.du],
               w.g.a === "ride" ? [t("gps.speed"), fmtSpeed(st.time, st.dist, set)] : [t("gps.pace"), fmtPace(st.time, st.dist, set)]];
    } else {
      cells = [[t("sum.duration"), t("unit.min", { n: woMinutes(w) })], [t("sum.volume"), fmtVol(woVolume(w))], [t("sum.sets"), String(woSets(w))]];
    }
    cells.forEach(function (p) {
      var c = el("div", "sum-cell");
      c.appendChild(el("b", "", p[1]));
      c.appendChild(el("small", "", p[0]));
      grid.appendChild(c);
    });
    return grid;
  }
  function fmtPace(sec, m, set) {
    var p = core("OrosFitnessGps").pace(sec, m, dFactor(set.du));
    return p > 0 && p < 360000 ? fmtTime(p) + " /" + set.du : "–";
  }
  function fmtSpeed(sec, m, set) {
    var v = core("OrosFitnessGps").speed(sec, m, dFactor(set.du));
    return v > 0 ? fmtNum(v, 1) + " " + t("gps.perH", { u: set.du }) : "–";
  }

  // Outdoor sessions. The watch runs only on the device that started
  // (or resumed) it: prefs.gps holds that workout's id on this device.
  var gpsLive = null, gpsUi = null;
  function startGps(a) {
    if (activeWorkout()) return;
    var G = core("OrosFitnessGps"), now = Date.now();
    var w = normWo({ id: newId(), m: now, d: ymd(new Date(now)), st: now, en: 0, ti: t("gps." + a), p: "", pd: "", n: "",
                     x: [{ e: G.ACT_EX[a], tr: 0, tr2: 0, rest: 0, s: [[0, 0, 0, 0, 0]] }], g: { a: a, ps: 0, sg: [] } });
    putRow("wo", w);
    saveNow(true);
    announced = {};
    prefs.gps = w.id;
    savePrefs();
    gpsBegin(w);
    openEditor(w.id);
  }
  function gpsBegin(w) {
    var G = core("OrosFitnessGps");
    gpsStop();
    var closed = G.segsOf(w.g, w.st);
    gpsLive = { id: w.id, watch: null, seg: [], closed: closed, base: G.statsOf(closed), acc: 0, err: "",
                saved: Date.now(), segAt: w.g.sg.length };
    if (!navigator.geolocation) { gpsLive.err = "none"; return; }
    try {
      gpsLive.watch = navigator.geolocation.watchPosition(gpsFix, gpsErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
    } catch (e) { gpsLive.err = "none"; }
  }
  function gpsFix(pos) {
    var L = gpsLive, G = core("OrosFitnessGps");
    if (!L || !pos || !pos.coords) return;
    var x = findRow("wo", L.id);
    if (!x || x.en || !x.g || x.g.ps) { gpsStop(); return; }
    L.err = "";
    L.acc = Math.round(pos.coords.accuracy || 0);
    // A cached fix from before the start (or a clock in the future) takes the time of arrival.
    var now = Date.now(), tm = Math.round(pos.timestamp || 0);
    if (!(tm >= x.st && tm <= now + 2000)) tm = now;
    var fix = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy, t: tm };
    var p = G.accept(L.seg.length ? L.seg[L.seg.length - 1] : null, fix);
    if (p && G.countPts(L.closed) + L.seg.length < G.MAX_PTS) { L.seg.push([p[0], p[1], null, p[3]]); L.dirty = true; }
    if (Date.now() - L.saved > 10000) gpsFlush();
    gpsPaint();
  }
  function gpsErr(err) {
    var L = gpsLive;
    if (!L) return;
    if (err && err.code === 1) {
      L.err = "denied";
      try { navigator.geolocation.clearWatch(L.watch); } catch (e) {}
      L.watch = null;
    } else L.err = "wait";
    gpsPaint();
  }
  // The live segment into the row, distance and time into its one set.
  function gpsFlush() {
    var L = gpsLive, G = core("OrosFitnessGps"), x = L && findRow("wo", L.id);
    if (!x || !x.g || x.en) return;
    L.saved = Date.now();
    if (!L.dirty) return;
    L.dirty = false;
    if (L.seg.length) x.g.sg[L.segAt] = G.encSeg(L.seg, x.st);
    var st = gpsStats();
    if (x.x[0] && x.x[0].s[0]) { x.x[0].s[0][2] = st.time; x.x[0].s[0][3] = st.dist; }
    touch(x);
    saveNow(true);
  }
  function gpsStats() {
    var L = gpsLive, G = core("OrosFitnessGps"), cur = G.statsOf([L.seg]);
    return { dist: L.base.dist + cur.dist, time: L.base.time + cur.time };
  }
  function gpsStop() {
    if (!gpsLive) return;
    gpsFlush();
    if (gpsLive.watch !== null) { try { navigator.geolocation.clearWatch(gpsLive.watch); } catch (e) {} }
    gpsLive = null;
  }
  function gpsPause(id) {
    var x = findRow("wo", id);
    if (!x || !x.g) return;
    if (gpsLive && gpsLive.id === id) gpsStop();
    x = findRow("wo", id);
    x.g.ps = 1;
    woChanged(x, true);
  }
  function gpsResume(id) {
    var x = findRow("wo", id);
    if (!x || !x.g) return;
    x.g.ps = 0;
    prefs.gps = id;
    savePrefs();
    woChanged(x, false);
    gpsBegin(x);
    render();
  }
  // Before Finish: the whole track gives the set's distance and time.
  function gpsFinalize(w) {
    if (gpsLive && gpsLive.id === w.id) { gpsLive.dirty = true; gpsFlush(); }
    var G = core("OrosFitnessGps"), x = findRow("wo", w.id) || w;
    var st = G.statsOf(G.segsOf(x.g, x.st));
    if (!x.x.length) x.x.push({ e: G.ACT_EX[x.g.a], tr: 0, tr2: 0, rest: 0, s: [] });
    x.x[0].s = [[0, 0, st.time, st.dist, st.time > 0 || st.dist > 0 ? F_DONE : 0]];
  }
  // A finished track is thinned (2 m) to keep the synced slice small.
  function gpsThin(x) {
    var G = core("OrosFitnessGps");
    x.g.sg = G.thin(G.segsOf(x.g, x.st), 2).filter(function (s) { return s.length; })
      .map(function (s) { return G.encSeg(s, x.st); });
  }
  function exportGpx(w) {
    var G = core("OrosFitnessGps");
    var text = G.gpx(w.ti || t("gps." + w.g.a), G.segsOf(w.g, w.st));
    saveBlob(new Blob([text], { type: "application/gpx+xml" }), "orOS-workouts-" + w.d + "-" + w.g.a + ".gpx", "application/gpx+xml");
  }
  function mapSvg(segs) {
    var G = core("OrosFitnessGps"), W = 320, H = 200, pr = G.project(segs, W, H, 14);
    var s = sv("svg", { viewBox: "0 0 " + W + " " + H, "class": "gps-svg", role: "img", "aria-label": t("gps.map") });
    sv("rect", { x: 0, y: 0, width: W, height: H, rx: 10, "class": "gps-bg" }, s);
    if (!pr) return s;
    pr.paths.forEach(function (d) { sv("path", { d: d, "class": "gps-line" }, s); });
    sv("circle", { cx: pr.start[0], cy: pr.start[1], r: 5, "class": "gps-start" }, s);
    sv("circle", { cx: pr.end[0], cy: pr.end[1], r: 5, "class": "gps-end" }, s);
    return s;
  }
  function splitsList(sp, set) {
    var box = el("div", "gps-splits");
    sp.forEach(function (x) {
      var row = el("div", "gps-split");
      row.appendChild(el("span", "", x.full ? x.n + " " + set.du : fmtDist(x.d, set.du) + " " + set.du));
      row.appendChild(el("b", "", fmtTime(x.t)));
      row.appendChild(el("small", "", x.full ? "" : fmtPace(x.t, x.d, set)));
      box.appendChild(row);
    });
    return box;
  }
  // Route and splits of a finished (or edited) outdoor workout.
  function gpsSection(w, set) {
    var G = core("OrosFitnessGps"), segs = G.segsOf(w.g, w.st), s = section(t("gps.map"));
    if (!segs.length) { s.appendChild(hint(t("gps.noTrack"))); return s; }
    s.appendChild(mapSvg(segs));
    var sp = G.splits(segs, dFactor(set.du));
    if (sp.length) {
      s.appendChild(el("div", "dlg-sub", t("gps.splits")));
      s.appendChild(splitsList(sp, set));
    }
    return s;
  }

  function renderGps(v, w) {
    var set = settings();
    setTitle(w.ti || t("gps." + w.g.a));
    if (!w.g.ps && prefs.gps === w.id && !(gpsLive && gpsLive.id === w.id)) gpsBegin(w);
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
      setTitle(x.ti || t("gps." + x.g.a));
    });
    head.appendChild(ti);
    var clock = el("div", "wo-clock", fmtTime((Date.now() - w.st) / 1000));
    clock.setAttribute("aria-label", t("wo.elapsed"));
    head.appendChild(clock);
    v.appendChild(head);

    var box = el("section", "sec gps-live");
    var grid = el("div", "gps-grid");
    function cell(label) {
      var c = el("div", "gps-cell"), b = el("b", "", "–");
      c.appendChild(b);
      c.appendChild(el("small", "", label));
      grid.appendChild(c);
      return b;
    }
    gpsUi = { id: w.id, clock: clock,
              dist: cell(t("gps.dist") + " (" + set.du + ")"), time: cell(t("gps.time")),
              pace: cell(w.g.a === "ride" ? t("gps.speed") : t("gps.pace")), lap: cell(t("gps.lap", { u: set.du })) };
    box.appendChild(grid);
    gpsUi.status = el("p", "gps-status");
    gpsUi.status.setAttribute("role", "status");
    box.appendChild(gpsUi.status);
    gpsUi.map = el("div", "gps-map");
    box.appendChild(gpsUi.map);
    gpsUi.splits = el("div", "");
    box.appendChild(gpsUi.splits);
    var acts = el("div", "wo-actions gps-acts");
    acts.appendChild(button(t("wo.discard"), "danger", function () {
      confirmDialog(t("wo.discardQ"), t("wo.discard"), true, function () {
        if (gpsLive && gpsLive.id === w.id) gpsStop();
        removeRow("wo", w.id);
        saveNow(false);
        editId = null;
        render();
      });
    }));
    var recording = gpsLive && gpsLive.id === w.id && gpsLive.watch !== null && !w.g.ps;
    acts.appendChild(recording ? button(t("gps.pause"), "", function () { gpsPause(w.id); })
                               : button(t("gps.resume"), "", function () { gpsResume(w.id); }));
    acts.appendChild(button(t("wo.finish"), "primary", function () { finishWorkout(w.id); }));
    box.appendChild(acts);
    box.appendChild(hint(t("gps.screen")));
    v.appendChild(box);

    var ns = section(t("wo.note"));
    var ta = el("textarea", "note");
    ta.value = w.n;
    ta.maxLength = NOTE_LEN;
    ta.rows = 2;
    ta.setAttribute("aria-label", t("wo.note"));
    ta.addEventListener("change", function () {
      var x = findRow("wo", w.id);
      if (!x) return;
      x.n = normNote(ta.value);
      woChanged(x, false);
    });
    ns.appendChild(ta);
    v.appendChild(ns);
    gpsUi.mapAt = 0;
    gpsUi.nSplits = -1;
    gpsPaint();
    startTicker(gpsPaint);
  }
  function gpsPaint() {
    var U = gpsUi, G = core("OrosFitnessGps");
    if (!U || !U.dist || !document.body.contains(U.dist)) return;
    var x = findRow("wo", U.id);
    if (!x || !x.g) return;
    var set = settings(), unitM = dFactor(set.du), L = gpsLive && gpsLive.id === x.id ? gpsLive : null;
    var segs = L ? L.closed.concat(L.seg.length ? [L.seg] : []) : G.segsOf(x.g, x.st);
    var st = G.statsOf(segs), time = st.time;
    if (L && L.watch !== null && L.seg.length && !x.g.ps) time = L.base.time + Math.max(0, (Date.now() - L.seg[0][3]) / 1000);
    U.clock.textContent = fmtTime((Date.now() - x.st) / 1000);
    U.dist.textContent = fmtDist(st.dist, set.du);
    U.time.textContent = fmtTime(time);
    U.pace.textContent = x.g.a === "ride" ? fmtSpeed(time, st.dist, set) : fmtPace(time, st.dist, set);
    var sp = G.splits(segs, unitM), last = sp.length && !sp[sp.length - 1].full ? sp[sp.length - 1] : null;
    U.lap.textContent = last && last.d >= 50 ? (x.g.a === "ride" ? fmtSpeed(last.t, last.d, set) : fmtPace(last.t, last.d, set)) : "–";
    var msg;
    if (x.g.ps) msg = t("gps.paused");
    else if (!L) msg = t("gps.paused");
    else if (L.err === "denied") msg = t("gps.denied");
    else if (L.err === "none") msg = t("gps.none");
    else if (!L.acc || L.err === "wait") msg = t("gps.waiting");
    else msg = t("gps.acc", { m: L.acc });
    if (U.status.textContent !== msg) U.status.textContent = msg;
    if (Date.now() - U.mapAt > 5000) {
      U.mapAt = Date.now();
      U.map.innerHTML = "";
      if (segs.length) U.map.appendChild(mapSvg(segs));
    }
    var full = sp.filter(function (s) { return s.full; });
    if (full.length !== U.nSplits) {
      U.nSplits = full.length;
      U.splits.innerHTML = "";
      if (full.length) {
        U.splits.appendChild(el("div", "dlg-sub", t("gps.splits")));
        U.splits.appendChild(splitsList(full, set));
      }
    }
  }

  // Exercise pictures from wger.de (wger.js), only on request.
  function picDialog(exId) {
    var W = core("OrosFitnessWger"), info = exInfo(data, exId), seed = SEED_MAP[exId];
    var dlg = makeDialog("fit-pic", info.name, true);
    var body = el("div", "pic-body");
    dlg.appendChild(body);
    var acts = el("div", "dlg-actions");
    dlg.appendChild(acts);
    function link(text, href) {
      var a = el("a", "", text);
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      return a;
    }
    function actions(hasPic) {
      acts.innerHTML = "";
      if (hasPic) acts.appendChild(button(t("pic.forget"), "", function () { W.forget(exId); dlg.close(); }));
      else acts.appendChild(button(t("pic.retry"), "", look));
      var cb = button(t("dlg.close"), "primary", function () { dlg.close(); });
      acts.appendChild(cb);
      try { cb.focus(); } catch (e) {}
    }
    function show(row) {
      body.innerHTML = "";
      var fig = el("figure", "pic-fig");
      var img = el("img", "pic-img");
      img.alt = info.name;
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      W.imageSrc(row.u).then(function (src) { img.src = src; });
      fig.appendChild(img);
      var cap = el("figcaption", "pic-credit");
      var by = row.au ? t("pic.by", { author: row.au }) : t("pic.byNone");
      cap.appendChild(row.auu ? link(by, row.auu) : el("span", "", by));
      cap.appendChild(document.createTextNode(" · "));
      cap.appendChild(row.liu ? link(row.li, row.liu) : el("span", "", row.li));
      cap.appendChild(el("br"));
      cap.appendChild(link(t("pic.src", { name: row.nm || info.name }), row.pg || W.BASE));
      fig.appendChild(cap);
      body.appendChild(fig);
      body.appendChild(hint(t("pic.note")));
      actions(true);
    }
    function message(key) {
      body.innerHTML = "";
      body.appendChild(el("p", "dlg-text", t(key)));
      actions(false);
    }
    function look() {
      message("pic.loading");
      acts.innerHTML = "";
      acts.appendChild(button(t("dlg.close"), "primary", function () { dlg.close(); }));
      var terms = seed ? [seed.en] : [info.name];
      W.lookup(exId, terms).then(function (r) {
        if (!dlg.open) return;
        if (r && r.pic) show(r.pic); else message("pic.none");
      }, function (e) {
        if (dlg.open) message(e && e.offline ? "pic.offline" : "pic.fail");
      });
    }
    openDialog(dlg);
    if (!W) { message("pic.fail"); return; }
    var k = W.known(exId);
    if (k && k.pic) show(k.pic);
    else if (k && k.none) message("pic.none");
    else look();
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
          list.appendChild(el("h3", "month-h", monthName(+mk.slice(5) - 1) + " " + mk.slice(0, 4) + " · " + t("hist.count", { n: cnt })));
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
      .sort(function (a, b) { return a.name.localeCompare(b.name, loc()); });
  }

  function workoutDialog(id) {
    var w = findRow("wo", id), set = settings();
    if (!w) { showToast(t("feed.deleted")); return; }
    if (!w.en) { openEditor(w.id); return; }
    var dlg = makeDialog("fit-wo", w.ti || t("wo.title"), true);
    dlg.appendChild(el("div", "dlg-sub", fmtDate(w.d, true) + " · " + fmtClock(w.st) + "–" + fmtClock(w.en)));
    dlg.appendChild(sumGrid(w, set));
    if (w.g) dlg.appendChild(gpsSection(w, set));
    var P = core("OrosFitnessPlan");
    P.groupsOf(w.x).forEach(function (g) {
      var host = dlg;
      if (g[0] !== g[1]) {
        host = el("div", "wo-grp");
        host.appendChild(el("small", "grp-tag", t(g[1] - g[0] === 1 ? "ss.superset" : "ss.circuit")));
        dlg.appendChild(host);
      }
      for (var i = g[0]; i <= g[1]; i++) {
        var e = w.x[i], info = exInfo(data, e.e), box = el("div", "wo-ex");
        box.appendChild(el("b", "", info.name));
        box.appendChild(el("small", "", e.s.map(function (s) { return (isWarm(s) ? "W " : "") + setSummary(s, info, set); }).join(" · ")));
        host.appendChild(box);
      }
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
    if (w.g && w.g.sg.length) acts.appendChild(button(t("gps.gpx"), "", function () { exportGpx(w); }));
    acts.appendChild(button(t("hist.edit"), "", function () { dlg.close(); openEditor(w.id); }));
    acts.appendChild(button(t("dlg.close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    openDialog(dlg);
  }

  // A finished workout logged after the fact, from the Assistant's
  // entry card (normAsNew values; openSearchTarget asNew). Nothing is
  // written until Save: then one finished workout (title, date, start,
  // minutes, note) and, with an activity, one done set of it (time,
  // and distance for a distance exercise), as the History editor
  // would keep it. Cancel / Esc / backdrop leave no trace.
  function logDialog(pre) {
    var set = settings(), now = new Date();
    var dlg = makeDialog("fit-log", t("log.title"));
    var form = el("form");
    form.method = "dialog";
    var exs = logExercises(data);
    var sel = el("select");
    sel.appendChild(el("option", "", "—")).value = "";
    exs.forEach(function (i) { sel.appendChild(el("option", "", i.name)).value = i.id; });
    sel.value = pre.ex;
    form.appendChild(field(t("log.ex"), sel));
    var ti = input("text", pre.ti || (pre.ex ? exInfo(data, pre.ex).name : ""));
    ti.maxLength = NAME_LEN;
    form.appendChild(field(t("wo.title"), ti));
    var di = input("date", pre.d);
    di.max = ymd(now);
    form.appendChild(field(t("wo.date"), di));
    var back = new Date(now.getTime() - (pre.mins || 0) * 60000);
    var si = input("time", pre.st || pad2(back.getHours()) + ":" + pad2(back.getMinutes()));
    form.appendChild(field(t("wo.startTime"), si));
    var mi = input("number", pre.mins ? String(pre.mins) : "", "numeric");
    mi.min = "1"; mi.max = "1440";
    form.appendChild(field(t("wo.minutes"), mi));
    var dsi = input("text", pre.dist ? fmtDist(pre.dist, set.du) : "", "decimal");
    var dsf = field(t("gps.dist") + " (" + (set.du === "mi" ? t("col.mi") : t("col.km")) + ")", dsi);
    form.appendChild(dsf);
    var ta = el("textarea", "note");
    ta.value = pre.n;
    ta.maxLength = NOTE_LEN;
    ta.rows = 3;
    form.appendChild(field(t("wo.note"), ta));
    var syncKind = function () { dsf.hidden = !sel.value || exInfo(data, sel.value).k !== "dt"; };
    sel.addEventListener("change", function () {
      if (!ti.value.trim() && sel.value) ti.value = exInfo(data, sel.value).name;
      syncKind();
    });
    syncKind();
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var d = parseYmd(di.value), tm = /^(\d{2}):(\d{2})$/.exec(si.value), mins = parseInt(mi.value, 10);
      var dt = sel.value && !dsf.hidden && dsi.value.trim() ? parseDist(dsi.value, set.du) : 0;
      di.classList.toggle("bad", !d || di.value > ymd(new Date()));
      si.classList.toggle("bad", !tm);
      mi.classList.toggle("bad", !(mins >= 1 && mins <= 1440));
      dsi.classList.toggle("bad", isNaN(dt));
      if (!d || di.value > ymd(new Date()) || !tm || !(mins >= 1 && mins <= 1440) || isNaN(dt)) return;
      d.setHours(+tm[1], +tm[2], 0, 0);
      var w = { id: newId(), m: Date.now(), d: ymd(d), st: d.getTime(), en: d.getTime() + mins * 60000,
                ti: ti.value, p: "", pd: "", n: ta.value, x: [] };
      if (sel.value) w.x.push({ e: sel.value, tr: 0, tr2: 0, rest: 0, s: [[0, 0, mins * 60, dt, F_DONE]] });
      w = normWo(w);
      if (!w) return;
      putRow("wo", w);
      saveNow(false);
      dlg.close();
      setTab("history");
    });
    dlg.appendChild(form);
    openDialog(dlg);
    sel.focus();
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
      Object.keys(months).sort().reverse().slice(0, 12).map(function (k) { return [monthName(+k.slice(5) - 1) + " " + k.slice(0, 4), String(months[k])]; })));
    v.appendChild(s4);
  }

  // ---------- 10. Programs ----------
  var pgDraft = null;   // the program being edited (a copy until Save)
  function renderPrograms(v) {
    if (pgDraft) { renderPgEditor(v); return; }
    setTitle(t("tab.programs"));
    var s = section(t("pg.title"));
    if (!data.pg.length) s.appendChild(hint(t("pg.empty")));
    data.pg.slice().sort(function (a, b) { return a.n.localeCompare(b.n, loc()); }).forEach(function (p) {
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

    renderPlans(v);

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
      txt.appendChild(el("small", "", itemNames(r.day.it, function (i) {
        var info = exInfo(data, i.e), rr = info.k === "t" ? fmtTime(i.t) : (i.r2 ? i.r + "–" + i.r2 : String(i.r || ""));
        return info.name + (rr ? " " + i.s + "×" + rr : "");
      })));
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
        var info = exInfo(data, it.e), linkedIn = ii > 0 && d.it[ii - 1].ln;
        var row = el("div", "it-row" + (it.ln && ii < d.it.length - 1 ? " linked" : "") + (linkedIn ? " linked-in" : ""));
        var head = el("div", "ex-top");
        head.appendChild(el("b", "it-name", info.name));
        var tl = el("div", "ex-tools");
        if (ii < d.it.length - 1) {
          var lk = iconBtn("mini" + (it.ln ? " on" : ""), UI.link, t(it.ln ? "ss.unlink" : "ss.link"), function () {
            if (it.ln) delete it.ln; else it.ln = 1;
            render();
          });
          lk.setAttribute("aria-pressed", it.ln ? "true" : "false");
          tl.appendChild(lk);
        }
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
  // "Open in Spreadsheet" (Bible BR-S1): the CSV's sets as a new sheet
  // in the orOS Spreadsheet, with a SUM under reps, time and distance.
  // Shown only inside orOS.
  var SHEET_ROWS = 498;   // + heading + SUM row = the Spreadsheet's 500
  function openAtFn() {
    try {
      var p = window.parent;
      return p && p !== window && typeof p.__orosOpenAt === "function" ? p : null;
    } catch (e) { return null; }
  }
  function openInSheet() {
    var p = openAtFn();
    if (!p) return;
    var rows = exportRows(data, function (v, dec) { var f = Math.pow(10, dec); return Math.round(v * f) / f; });
    var head = rows.shift();
    if (!rows.length) { showToast(t("set.sheetNone")); return; }
    if (rows.length > SHEET_ROWS) { showToast(t("set.sheetCap", { n: SHEET_ROWS })); rows = rows.slice(0, SHEET_ROWS); }
    p.__orosOpenAt("spreadsheet", { newSheet: { name: t("app") + " " + ymd(new Date()), rows: [head].concat(rows), sum: [6, 7, 8] } });
  }
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

  // .orosworkouts (OBF-4e): own exercises, programs, progression
  // programs, finished workouts (with their routes) and body
  // measurements as one orOS file (../recordpkg.js + package.js).
  // Opening ADDS what this device lacks, with its ids; a record
  // already here (or deleted here) is kept as it is unless "Update
  // with newer versions" is ticked. The file never holds the settings
  // or a running workout. The result goes through mergeFit + saveNow
  // (so sync carries it); Undo deletes the added rows with removeRow,
  // so their tombstones sync.
  var RP = window.OrosRecordPkg || null, FPK = window.OrosFitnessPackage || null;
  var recFile = RP && FPK && window.OrosBundle ? RP.ui(FPK.withNames(function (id) { return exInfo(data, id).name; }), {
    lang: function () { return LANG2; },
    get: function () { return mergeFit(data, data); },
    title: function () { return t("app"); },
    set: function (next) {
      if (!next || typeof next !== "object" || !Array.isArray(next.wo)) return;
      data = mergeFit(next, next);
      saveNow(false);
      render();
    },
    deleteIds: function (ids) {
      var any = false;
      ids.forEach(function (id) {
        var c = FPK.kindOf(id, data);
        if (c && removeRow(c, id)) any = true;
      });
      if (any) saveNow(false);
      render();
      showToast(RP.str(LANG2, "undone"));
    },
    toast: function (text, undo) {
      if (undo) undoToast(text, undo);
      else showToast(text);
    }
  }) : null;

  // Import workouts: one entry point for every source. Strong / Hevy
  // (section 4b), FitNotes and JEFIT give sets; FIT, TCX, GPX and a
  // zip of them (import.js) give activities. Read → detect → preview
  // → ONE merge + ONE save (one dirty mark) → a toast with Undo.
  // Undo puts newer tombstones on exactly the rows this import added,
  // so a sync that already carried them cannot bring them back.
  var IMP_SRC = { strong: "Strong", hevy: "Hevy", fitnotes: "FitNotes", jefit: "JEFIT",
                  fit: "Garmin FIT", tcx: "TCX", gpx: "GPX", zip: "ZIP" };
  function impApi() { return window.OrosFitnessImport && window.OrosImportKit ? window.OrosFitnessImport : null; }
  function importCsv() {
    var X = impApi();
    if (!X) return;
    pickFile(X.ACCEPT).then(function (file) { if (file) importFile(file); });
  }
  // Also the handle for tests (Promise<bool>)
  function importFile(file) {
    var X = impApi();
    return window.OrosImportKit.readFile(file, X.MAX_FILE)
      .then(function (r) { return X.parse(r, { sets: parseImport }); })
      .then(function (res) {
        if (!res) { showToast(t("imp.bad")); return false; }
        var d = $("fit-set");
        if (d) d.close();
        if (res.kind === "sets") importDialog(res.parsed);
        else actsDialog(res);
        return true;
      }, function (e) {
        showToast(t(e && e.message === "toobig" ? "imp.big" : "imp.bad"));
        return false;
      });
  }
  function impRevive(gone, onChange) {
    var w = el("label", "chk"), c = el("input");
    c.type = "checkbox";
    c.addEventListener("change", function () { onChange(c.checked); });
    w.appendChild(c);
    w.appendChild(el("span", "", t("imp.revive", { n: gone })));
    return w;
  }
  // One merge, one save; the toast's Undo removes what was added.
  function impCommit(plan, msg) {
    data = mergeFit(data, { wo: plan.wo, ex: plan.ex });
    saveNow(false);
    render();
    var added = plan.wo.map(function (w) { return ["wo", w.id, w.m]; })
      .concat(plan.ex.map(function (x) { return ["ex", x.id, x.m]; }));
    var used = false;
    undoToast(msg, function () {
      if (used) return;
      used = true;
      added.forEach(function (r) {
        var row = findRow(r[0], r[1]);
        if (row && row.m === r[2]) removeRow(r[0], r[1]);     // edited since: the user's now
      });
      saveNow(false);
      render();
      showToast(t("imp.undone"));
    });
  }
  function importDialog(parsed) {
    var dlg = makeDialog("fit-imp", t("imp.title"));
    var unit = settings().wu, plan = null, revive = false;
    var body = el("div", "imp-body"), extra = el("div");
    var go = button(t("imp.go"), "primary", function () {
      if (!plan || !plan.wo.length) return;
      dlg.close();
      impCommit(plan, t("imp.done", { n: plan.wo.length }));
    });
    function paint() {
      plan = buildImport(data, parsed, unit, Date.now(), revive);
      body.innerHTML = "";
      var src = IMP_SRC[parsed.src] || "CSV";
      if (plan.wo.length) {
        body.appendChild(el("p", "", t("imp.summary", { src: src, n: plan.wo.length, sets: plan.sets })));
        body.appendChild(el("p", "", plan.from === plan.to ? fmtDate(plan.from)
          : t("imp.range", { from: fmtDate(plan.from), to: fmtDate(plan.to) })));
        body.appendChild(el("p", "", t("imp.ex", { m: plan.matched, k: plan.newNames.length })));
        if (plan.newNames.length) {
          var list = plan.newNames.slice(0, 12).join(", ") + (plan.newNames.length > 12 ? ", …" : "");
          body.appendChild(hint(t("imp.newList", { list: list })));
        }
      } else if (!plan.gone) body.appendChild(el("p", "", t("imp.none")));
      if (plan.skipped && plan.wo.length) body.appendChild(hint(t("imp.skip", { n: plan.skipped })));
      if (plan.newNames.length && plan.wo.length) body.appendChild(hint(t("imp.tip")));
      go.disabled = !plan.wo.length;
    }
    if (!parsed.unitKnown) {
      var sel = el("select");
      [["kg", t("set.metric")], ["lb", t("set.imperial")]].forEach(function (o) {
        var x = el("option", "", o[1]); x.value = o[0]; sel.appendChild(x);
      });
      sel.value = unit;
      sel.addEventListener("change", function () { unit = sel.value; paint(); });
      dlg.appendChild(field(t("imp.unit"), sel));
    }
    dlg.appendChild(body);
    paint();
    if (plan.gone) extra.appendChild(impRevive(plan.gone, function (v) { revive = v; paint(); }));
    dlg.appendChild(extra);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(go);
    dlg.appendChild(acts);
    openDialog(dlg);
  }
  // Activities (runs, rides, walks, swims…) from FIT / TCX / GPX / zip.
  function actNote(a) {
    var bits = [IMP_SRC[a.src] || ""];
    if (a.sport && a.ex) bits.push(a.sport);
    if (a.cal) bits.push(t("imp.kcal", { n: a.cal }));
    if (a.hr) bits.push(t("imp.hr", { n: a.hr }));
    return bits.filter(Boolean).join(" · ");
  }
  function actsDialog(res) {
    var X = impApi();
    var dlg = makeDialog("fit-imp", t("imp.title"));
    var plan = null, revive = false;
    var body = el("div", "imp-body"), extra = el("div");
    var go = button(t("imp.go"), "primary", function () {
      if (!plan || !plan.wo.length) return;
      dlg.close();
      impCommit({ wo: plan.wo, ex: [] }, t("imp.actDone", { n: plan.wo.length }));
    });
    function paint() {
      plan = X.buildActs(data, res.acts, { now: Date.now(), revive: revive, label: t, note: actNote });
      body.innerHTML = "";
      var src = IMP_SRC[res.src] || "";
      if (res.src === "zip") src += " · " + t("imp.files", { n: res.files });
      body.appendChild(el("p", "", t("imp.actSum", { src: src, n: plan.wo.length })));
      if (plan.wo.length) {
        body.appendChild(el("p", "", plan.from === plan.to ? fmtDate(plan.from)
          : t("imp.range", { from: fmtDate(plan.from), to: fmtDate(plan.to) })));
        var kinds = ["run", "walk", "ride", "swim", "other"].filter(function (k) { return plan.kinds[k]; })
          .map(function (k) { return t("imp.k." + k, { n: plan.kinds[k] }); });
        body.appendChild(el("p", "", kinds.join(" · ")));
        if (plan.routes) body.appendChild(hint(t("imp.routes", { n: plan.routes })));
        if (plan.noRoute) body.appendChild(hint(t("imp.noRoute", { n: plan.noRoute })));
        if (plan.kinds.other) body.appendChild(hint(t("imp.other")));
      } else if (!plan.gone) body.appendChild(el("p", "", t("imp.none")));
      if (plan.skipped) body.appendChild(hint(t("imp.skipAct", { n: plan.skipped })));
      if (res.bad) body.appendChild(hint(t("imp.badFiles", { n: res.bad })));
      go.disabled = !plan.wo.length;
    }
    dlg.appendChild(body);
    paint();
    if (plan.gone) extra.appendChild(impRevive(plan.gone, function (v) { revive = v; paint(); }));
    dlg.appendChild(extra);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(go);
    dlg.appendChild(acts);
    openDialog(dlg);
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
    if (openAtFn()) ex.appendChild(button(t("set.sheet"), "", openInSheet));
    ex.appendChild(button(t("set.json"), "", exportJson));
    ex.appendChild(button(t("set.restore"), "", restoreJson));
    ex.appendChild(button(t("set.import"), "", importCsv));
    // .orosworkouts: Save keeps the dialog open (like the exports); Open
    // and the folder close it first, since they change the data
    if (recFile) {
      [["fit-osave", "set.osave", false, function () { recFile.save(); }],
       ["fit-oopen", "set.oopen", true, function () { recFile.open(); }],
       ["fit-ofolder", "set.ofolder", true, function () { recFile.openFolder(); }]].forEach(function (o) {
        var b = button(t(o[1]), "", function () { if (o[2]) { dlg.close(); render(); } o[3](); });
        b.id = o[0];
        ex.appendChild(b);
      });
    }
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
        var rows = all.filter(function (x) { return x.g === g; }).sort(function (a, b) { return a.name.localeCompare(b.name, loc()); });
        if (!rows.length) return;
        list.appendChild(el("div", "pick-g", t("g." + g)));
        rows.forEach(function (x) {
          var r = el("div", "lib-row" + (x.h ? " off" : ""));
          r.appendChild(el("span", "", x.name + (x.seed ? "" : " · " + t("ex.mine"))));
          r.appendChild(iconBtn("mini", UI.image, t("pic.show") + ": " + x.name, function () { picDialog(x.id); }));
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
  // Today summary: { train: true } → the Train tab, where today's
  // program days wait with their Start button.
  // BR-W8-6 (Assistant entry card): { asNew: { date?, start?, type?,
  // minutes?, distanceKm?, note? } } → the "Log a workout" dialog
  // prefilled (normAsNew); nothing usable, an open dialog or a program
  // in the editor → no-op.
  function openSearchTarget(t) {
    // "Open with" an .orosworkouts file (fileopen.js): { openFile: { token } },
    // the File taken once with window.parent.__orosTakeFile(token)
    if (t && t.openFile) { if (recFile) recFile.openTarget(t.openFile); return; }
    // Single app (solo.js) icon shortcut { logNew: true }: a blank log.
    if (t && t.logNew === true) {
      if (!pgDraft && !document.querySelector("dialog[open]"))
        logDialog({ ex: "", ti: "", mins: 0, dist: 0, n: "", d: ymd(new Date()), st: "" });
      return;
    }
    if (t && t.asNew) {
      var pre = normAsNew(data, t.asNew, ymd(new Date()));
      if (pre && !pgDraft && !document.querySelector("dialog[open]")) logDialog(pre);
      return;
    }
    if (t && t.train === true) {
      if (!pgDraft && !document.querySelector("dialog[open]") && prefs.tab !== "train") setTab("train");
      return;
    }
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
      if (document.visibilityState === "hidden") {
        if (gpsLive) { gpsLive.saved = 0; gpsFlush(); }
        savePrefsNow(); flushPaced(); releaseWake();
      }
      else { renderRest(); updateWakeLock(); }
    });
    window.addEventListener("pagehide", function () {
      if (gpsLive) gpsFlush();
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
