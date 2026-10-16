// ============================================================
// orOS Health — App logic (v1.0.0)
// A log of health measurements with charts and a report for the
// doctor:
//   - blood pressure, weight (+ BMI), blood sugar, sleep, resting
//     heart rate, temperature, oxygen (SpO2) and your own kinds
//   - a colour per reading from known tables (ESC/ESH 2023, ADA,
//     WHO BMI) or the target your doctor gave you
//   - charts with the target band, averages, morning / evening
//     blood pressure, glucose by context, weight trend
//   - a printable report (Print → Save as PDF), CSV, JSON backup
//   - optional reminder times per kind (the shell fires them)
//   - Workouts' body weights shown read-only next to your own
// Data:
//   - synced slice "health" (oros-health-data), model and merge in
//     health/core.js (window.OrosHealthCore)
//   - device-local (R10): oros-health-prefs (tab, chart choices,
//     history filter, report period)
// Sections:
//   1. Constants, i18n, helpers
//   2. Numbers: units, parsing, formatting, CSV
//   3. Storage, prefs
//   4. UI shell: tabs, toolbar, toasts, dialogs
//   5. Home: one card per kind
//   6. Entry dialog
//   7. History
//   8. Charts
//   9. Report for the doctor (print) + CSV
//  10. Kind dialog (targets, reminders, own kinds)
//  11. Settings, export, restore
//  12. Keyboard, palette, sync slice, deep link, boot
// ============================================================
(function () {
  "use strict";

  var C = window.OrosHealthCore;
  var STORAGE_KEY = "oros-health-data";
  var PREFS_KEY   = "oros-health-prefs";
  var FIT_KEY     = "oros-fitness-data";     // Workouts, read only
  var DAY_MS      = 86400000;
  var PERIODS     = ["7", "30", "90", "365", "all"];
  var HIST_PAGE   = 150;

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
      "app": "Health",
      "tab.home": "Measurements", "tab.history": "History", "tab.charts": "Charts", "tab.report": "Report",
      "btn.settings": "Settings",
      "t.bp": "Blood pressure", "t.wt": "Weight", "t.gl": "Blood sugar", "t.sl": "Sleep",
      "t.hr": "Resting heart rate", "t.tp": "Temperature", "t.o2": "Oxygen (SpO₂)", "t.st": "Steps",
      "u.bpm": "bpm", "u.h": "h", "u.st": "steps",
      "home.add": "Add", "home.never": "No readings yet", "home.own": "Add your own kind",
      "home.ownHint": "For example cholesterol, INR or waist size.",
      "home.disclaimer": "Health records, it does not diagnose. The colours follow common tables (ESC/ESH 2023 for blood pressure, ADA for blood sugar, WHO for BMI) or the targets you set. For anything that worries you, talk to your doctor.",
      "home.fromFit": "from Workouts",
      "when.today": "Today {t}", "when.yday": "Yesterday {t}",
      "lv.ok": "In range", "lv.bord": "Borderline", "lv.high": "High", "lv.vhigh": "Very high", "lv.low": "Low",
      "lv.bp.bord": "High normal",
      "lv.wt.low": "Underweight", "lv.wt.ok": "Healthy weight", "lv.wt.bord": "Overweight", "lv.wt.high": "Obesity",
      "lv.sl.low": "Short", "lv.sl.ok": "Enough", "lv.sl.bord": "Long",
      "e.title.new": "New reading", "e.date": "Date", "e.time": "Time",
      "e.sys": "Systolic (upper)", "e.dia": "Diastolic (lower)", "e.pulse": "Pulse (optional)",
      "e.arm": "Arm", "e.pos": "Position", "e.none": "—",
      "arm.1": "Left", "arm.2": "Right",
      "pos.1": "Sitting", "pos.2": "Standing", "pos.3": "Lying down",
      "e.value": "Value", "e.ctx": "When",
      "ctx.0": "Random", "ctx.1": "Fasting", "ctx.2": "Before a meal", "ctx.3": "2 h after a meal", "ctx.4": "Bedtime",
      "e.bed": "Went to bed", "e.bedDate": "Night of", "e.wake": "Woke up", "e.slept": "Asleep: {d}",
      "e.quality": "Quality", "q.0": "Not given", "q.1": "1 · Very poor", "q.2": "2 · Poor", "q.3": "3 · Fair", "q.4": "4 · Good", "q.5": "5 · Very good",
      "e.note": "Note", "e.tags": "Tags", "e.tagsHint": "Separate with commas, e.g. after coffee, with medicine",
      "e.bmi": "BMI {b}", "e.bmiNeed": "Add your height in Settings to see your BMI.",
      "e.bad": "Check the highlighted fields.", "e.badBp": "The lower value must be below the upper one.",
      "e.del": "Delete reading", "e.deleted": "Reading deleted", "e.saved": "Saved",
      "dlg.cancel": "Cancel", "dlg.save": "Save", "dlg.close": "Close", "dlg.delete": "Delete",
      "toast.undo": "Undo", "toast.save": "Could not save: storage is full.",
      "hist.all": "All", "hist.empty": "No readings yet.", "hist.more": "Show older",
      "hist.fit": "This weight comes from Workouts. Change it there.",
      "ch.period.7": "7 days", "ch.period.30": "30 days", "ch.period.90": "90 days", "ch.period.365": "1 year", "ch.period.all": "All",
      "ch.none": "No readings in this period.", "ch.one": "One reading so far: the chart starts with the second.",
      "ch.avg": "Average", "ch.min": "Lowest", "ch.max": "Highest", "ch.n": "Readings",
      "ch.am": "Mornings (before 12:00)", "ch.pm": "Afternoons and evenings",
      "ch.pulse": "Average pulse", "ch.inTarget": "In range", "ch.change": "Change in the period",
      "ch.bmi": "Latest BMI", "ch.trend": "7-day average", "ch.quality": "Average quality",
      "ch.table": "Numbers as a table", "ch.ctxAll": "All times", "ch.kind": "Settings for {n}",
      "ch.band": "Shaded: the range in green on the cards", "ch.fitDots": "Hollow dots: weights from Workouts",
      "rp.title": "Report for the doctor", "rp.intro": "Pick a period and the measurements. Print opens your browser's print window, where you can also save a PDF.",
      "rp.from": "From", "rp.to": "To", "rp.kinds": "Measurements", "rp.notes": "Include notes and tags",
      "rp.name": "Name on the report (optional)", "rp.print": "Print or save as PDF", "rp.csv": "Spreadsheet (CSV)",
      "rp.none": "No readings in this period.", "rp.heading": "Health measurements",
      "rp.period": "Period: {a} to {b}", "rp.made": "Created on {d} with orOS Health",
      "rp.foot": "Readings taken at home and typed in by the patient. Colours follow ESC/ESH 2023 (blood pressure), ADA (blood sugar), WHO (BMI) or the patient's own targets.",
      "rp.col.date": "Date", "rp.col.time": "Time", "rp.col.value": "Value", "rp.col.details": "Details", "rp.col.status": "Status", "rp.col.note": "Note",
      "csv.date": "Date", "csv.time": "Time", "csv.kind": "Measurement", "csv.value": "Value", "csv.unit": "Unit",
      "csv.dia": "Diastolic", "csv.pulse": "Pulse", "csv.details": "Details", "csv.status": "Status",
      "csv.note": "Note", "csv.tags": "Tags", "csv.source": "Source", "csv.fit": "Workouts",
      "k.title.new": "Your own kind", "k.name": "Name", "k.unit": "Unit (optional)", "k.dc": "Decimals",
      "k.hide": "Hide this measurement", "k.targets": "Your target (from your doctor)",
      "k.targetsHint": "Leave empty to use the common tables.", "k.lo": "From", "k.hi": "To",
      "k.sysT": "Systolic", "k.diaT": "Diastolic",
      "k.rem": "Reminders", "k.remHint": "Reminders appear while orOS is open (also with this app closed). A reading taken up to an hour before the time counts.",
      "k.remAdd": "Add a time", "k.remDel": "Remove time",
      "k.del": "Delete this kind", "k.delAsk": "Delete “{n}” and its {c} readings on every synced device?",
      "k.deleted": "“{n}” deleted", "k.dup": "A kind with this name already exists.",
      "set.title": "Settings", "set.units": "Units", "set.wu": "Weight", "set.gu": "Blood sugar", "set.tu": "Temperature",
      "set.height": "Height ({u})", "set.heightHint": "Only used for the BMI.", "set.fit": "Show body weights from Workouts",
      "set.kinds": "Measurements", "set.hidden": "hidden", "set.edit": "Edit", "set.show": "Show", "set.hideKind": "Hide",
      "set.export": "Export", "set.csv": "All readings (CSV)", "set.json": "Backup (JSON)", "set.restore": "Restore from backup (merge)",
      "set.osave": "orOS file (.oroshealth)", "set.oopen": "Open orOS file…", "set.ofolder": "Unzipped orOS folder…",
      "set.restored": "Backup merged: {n} readings", "set.badFile": "This is not a Health backup.",
      "feed.gone": "That measurement no longer exists.",
      "imp.head": "Import", "imp.btn": "From another app…",
      "imp.hint": "Withings, OMRON connect, Samsung Health or Apple Health exports (ZIP, CSV or export.xml).",
      "imp.title": "Import from another app", "imp.reading": "Reading the file…", "imp.from": "From: {s}",
      "imp.range": "Readings from {a} to {b}", "imp.row": "{k}: {n} found, {a} new",
      "imp.have": "Already in Health: {n}", "imp.conv": "Converted for Health: {l}",
      "imp.conv.lb": "lb → kg", "imp.conv.mmol": "mmol/L → mg/dL", "imp.conv.f": "°F → °C", "imp.conv.frac": "SpO2 fraction → %",
      "imp.skipT": "Not imported",
      "imp.sk.comp": "Body fat, muscle, bone, water (Health keeps the weight only): {n}",
      "imp.sk.height": "Height (set it in Settings): {n}",
      "imp.sk.hrsDay": "Heart-rate samples: {n}, kept as {d} daily resting values (the day's lowest)",
      "imp.sk.hrs": "Heart-rate samples (the file's resting heart rate is used): {n}",
      "imp.sk.bad": "Out of range or unreadable: {n}", "imp.sk.dup": "Duplicates in the file: {n}",
      "imp.sk.half": "Blood pressure values without their pair: {n}", "imp.sk.other": "Over the limits: {n}",
      "imp.cut": "Only the newest {n} readings are imported; {c} older ones are left out.",
      "imp.keep": "Your own readings are never changed. Imported ones get the tag “{g}”.",
      "imp.none": "Nothing new to import: it's all in Health already.",
      "imp.go": "Import {n}", "imp.done": "Readings imported: {n}", "imp.undone": "Import undone",
      "imp.bad": "This file isn't an export Health can read.", "imp.empty": "No measurements Health can keep in this file.",
      "imp.big": "This file is too large to import.", "imp.ihb": "Irregular heartbeat", "imp.mv": "Body movement",
      "day.0": "Mon", "day.1": "Tue", "day.2": "Wed", "day.3": "Thu", "day.4": "Fri", "day.5": "Sat", "day.6": "Sun"
    },
    el: {
      "app": "Υγεία",
      "tab.home": "Μετρήσεις", "tab.history": "Ιστορικό", "tab.charts": "Γραφήματα", "tab.report": "Αναφορά",
      "btn.settings": "Ρυθμίσεις",
      "t.bp": "Πίεση", "t.wt": "Βάρος", "t.gl": "Σάκχαρο", "t.sl": "Ύπνος",
      "t.hr": "Σφυγμοί ηρεμίας", "t.tp": "Θερμοκρασία", "t.o2": "Οξυγόνο (SpO₂)", "t.st": "Βήματα",
      "u.bpm": "bpm", "u.h": "ώ", "u.st": "βήματα",
      "home.add": "Νέα", "home.never": "Καμία μέτρηση ακόμα", "home.own": "Πρόσθεσε δικό σου είδος",
      "home.ownHint": "Για παράδειγμα χοληστερίνη, INR ή περίμετρος μέσης.",
      "home.disclaimer": "Η Υγεία καταγράφει, δεν κάνει διάγνωση. Τα χρώματα ακολουθούν γνωστούς πίνακες (ESC/ESH 2023 για την πίεση, ADA για το σάκχαρο, ΠΟΥ για τον ΔΜΣ) ή τους στόχους που όρισες. Για ό,τι σε ανησυχεί, μίλα με τον γιατρό σου.",
      "home.fromFit": "από την Προπόνηση",
      "when.today": "Σήμερα {t}", "when.yday": "Χθες {t}",
      "lv.ok": "Εντός ορίων", "lv.bord": "Οριακά", "lv.high": "Υψηλά", "lv.vhigh": "Πολύ υψηλά", "lv.low": "Χαμηλά",
      "lv.bp.bord": "Υψηλή φυσιολογική",
      "lv.wt.low": "Λιποβαρές", "lv.wt.ok": "Φυσιολογικό βάρος", "lv.wt.bord": "Υπέρβαρο", "lv.wt.high": "Παχυσαρκία",
      "lv.sl.low": "Λίγος", "lv.sl.ok": "Επαρκής", "lv.sl.bord": "Πολύς",
      "e.title.new": "Νέα μέτρηση", "e.date": "Ημερομηνία", "e.time": "Ώρα",
      "e.sys": "Συστολική (μεγάλη)", "e.dia": "Διαστολική (μικρή)", "e.pulse": "Σφυγμοί (προαιρετικά)",
      "e.arm": "Χέρι", "e.pos": "Θέση", "e.none": "—",
      "arm.1": "Αριστερό", "arm.2": "Δεξί",
      "pos.1": "Καθιστός", "pos.2": "Όρθιος", "pos.3": "Ξαπλωμένος",
      "e.value": "Τιμή", "e.ctx": "Πότε",
      "ctx.0": "Τυχαία", "ctx.1": "Νηστεία", "ctx.2": "Πριν το φαγητό", "ctx.3": "2 ώρες μετά το φαγητό", "ctx.4": "Πριν τον ύπνο",
      "e.bed": "Έπεσα για ύπνο", "e.bedDate": "Νύχτα της", "e.wake": "Ξύπνησα", "e.slept": "Ύπνος: {d}",
      "e.quality": "Ποιότητα", "q.0": "Χωρίς βαθμό", "q.1": "1 · Πολύ κακός", "q.2": "2 · Κακός", "q.3": "3 · Μέτριος", "q.4": "4 · Καλός", "q.5": "5 · Πολύ καλός",
      "e.note": "Σημείωση", "e.tags": "Ετικέτες", "e.tagsHint": "Χώρισέ τις με κόμμα, π.χ. μετά από καφέ, με φάρμακο",
      "e.bmi": "ΔΜΣ {b}", "e.bmiNeed": "Γράψε το ύψος σου στις Ρυθμίσεις για να βλέπεις τον ΔΜΣ.",
      "e.bad": "Έλεγξε τα σημειωμένα πεδία.", "e.badBp": "Η μικρή πρέπει να είναι κάτω από τη μεγάλη.",
      "e.del": "Διαγραφή μέτρησης", "e.deleted": "Η μέτρηση διαγράφηκε", "e.saved": "Αποθηκεύτηκε",
      "dlg.cancel": "Άκυρο", "dlg.save": "Αποθήκευση", "dlg.close": "Κλείσιμο", "dlg.delete": "Διαγραφή",
      "toast.undo": "Αναίρεση", "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος.",
      "hist.all": "Όλα", "hist.empty": "Καμία μέτρηση ακόμα.", "hist.more": "Παλαιότερες",
      "hist.fit": "Αυτό το βάρος έρχεται από την Προπόνηση. Άλλαξέ το εκεί.",
      "ch.period.7": "7 μέρες", "ch.period.30": "30 μέρες", "ch.period.90": "90 μέρες", "ch.period.365": "1 έτος", "ch.period.all": "Όλα",
      "ch.none": "Καμία μέτρηση σε αυτή την περίοδο.", "ch.one": "Μία μέτρηση ως τώρα: το γράφημα ξεκινά με τη δεύτερη.",
      "ch.avg": "Μέσος όρος", "ch.min": "Χαμηλότερη", "ch.max": "Υψηλότερη", "ch.n": "Μετρήσεις",
      "ch.am": "Πρωινές (πριν τις 12:00)", "ch.pm": "Απογευματινές και βραδινές",
      "ch.pulse": "Μέσοι σφυγμοί", "ch.inTarget": "Εντός ορίων", "ch.change": "Μεταβολή στην περίοδο",
      "ch.bmi": "Τελευταίος ΔΜΣ", "ch.trend": "Μέσος όρος 7 ημερών", "ch.quality": "Μέση ποιότητα",
      "ch.table": "Οι αριθμοί σε πίνακα", "ch.ctxAll": "Όλες οι ώρες", "ch.kind": "Ρυθμίσεις για: {n}",
      "ch.band": "Σκιασμένο: το εύρος που στις κάρτες είναι πράσινο", "ch.fitDots": "Κενές κουκκίδες: βάρη από την Προπόνηση",
      "rp.title": "Αναφορά για τον γιατρό", "rp.intro": "Διάλεξε περίοδο και μετρήσεις. Η εκτύπωση ανοίγει το παράθυρο εκτύπωσης του browser, όπου μπορείς να σώσεις και PDF.",
      "rp.from": "Από", "rp.to": "Έως", "rp.kinds": "Μετρήσεις", "rp.notes": "Μαζί οι σημειώσεις και οι ετικέτες",
      "rp.name": "Όνομα στην αναφορά (προαιρετικό)", "rp.print": "Εκτύπωση ή αποθήκευση PDF", "rp.csv": "Υπολογιστικό φύλλο (CSV)",
      "rp.none": "Καμία μέτρηση σε αυτή την περίοδο.", "rp.heading": "Μετρήσεις υγείας",
      "rp.period": "Περίοδος: {a} έως {b}", "rp.made": "Δημιουργήθηκε στις {d} με την Υγεία του orOS",
      "rp.foot": "Μετρήσεις στο σπίτι, καταχωρισμένες από τον ίδιο τον ασθενή. Τα χρώματα ακολουθούν ESC/ESH 2023 (πίεση), ADA (σάκχαρο), ΠΟΥ (ΔΜΣ) ή τους στόχους του ασθενή.",
      "rp.col.date": "Ημερομηνία", "rp.col.time": "Ώρα", "rp.col.value": "Τιμή", "rp.col.details": "Λεπτομέρειες", "rp.col.status": "Κατάσταση", "rp.col.note": "Σημείωση",
      "csv.date": "Ημερομηνία", "csv.time": "Ώρα", "csv.kind": "Μέτρηση", "csv.value": "Τιμή", "csv.unit": "Μονάδα",
      "csv.dia": "Διαστολική", "csv.pulse": "Σφυγμοί", "csv.details": "Λεπτομέρειες", "csv.status": "Κατάσταση",
      "csv.note": "Σημείωση", "csv.tags": "Ετικέτες", "csv.source": "Πηγή", "csv.fit": "Προπόνηση",
      "k.title.new": "Δικό σου είδος", "k.name": "Όνομα", "k.unit": "Μονάδα (προαιρετικά)", "k.dc": "Δεκαδικά",
      "k.hide": "Απόκρυψη αυτής της μέτρησης", "k.targets": "Ο στόχος σου (από τον γιατρό)",
      "k.targetsHint": "Άφησέ τα κενά για τους γνωστούς πίνακες.", "k.lo": "Από", "k.hi": "Έως",
      "k.sysT": "Συστολική", "k.diaT": "Διαστολική",
      "k.rem": "Υπενθυμίσεις", "k.remHint": "Οι υπενθυμίσεις εμφανίζονται όσο το orOS είναι ανοιχτό (και με κλειστή αυτή την εφαρμογή). Μια μέτρηση έως μία ώρα νωρίτερα μετράει.",
      "k.remAdd": "Πρόσθεσε ώρα", "k.remDel": "Αφαίρεση ώρας",
      "k.del": "Διαγραφή αυτού του είδους", "k.delAsk": "Να διαγραφεί το «{n}» και οι {c} μετρήσεις του σε όλες τις συσκευές;",
      "k.deleted": "Το «{n}» διαγράφηκε", "k.dup": "Υπάρχει ήδη είδος με αυτό το όνομα.",
      "set.title": "Ρυθμίσεις", "set.units": "Μονάδες", "set.wu": "Βάρος", "set.gu": "Σάκχαρο", "set.tu": "Θερμοκρασία",
      "set.height": "Ύψος ({u})", "set.heightHint": "Χρειάζεται μόνο για τον ΔΜΣ.", "set.fit": "Εμφάνιση των βαρών από την Προπόνηση",
      "set.kinds": "Μετρήσεις", "set.hidden": "κρυφό", "set.edit": "Επεξεργασία", "set.show": "Εμφάνιση", "set.hideKind": "Απόκρυψη",
      "set.export": "Εξαγωγή", "set.csv": "Όλες οι μετρήσεις (CSV)", "set.json": "Αντίγραφο (JSON)", "set.restore": "Επαναφορά αντιγράφου (συγχώνευση)",
      "set.osave": "Αρχείο orOS (.oroshealth)", "set.oopen": "Άνοιγμα αρχείου orOS…", "set.ofolder": "Αποσυμπιεσμένος φάκελος orOS…",
      "set.restored": "Το αντίγραφο συγχωνεύτηκε: {n} μετρήσεις", "set.badFile": "Αυτό δεν είναι αντίγραφο της Υγείας.",
      "feed.gone": "Αυτή η μέτρηση δεν υπάρχει πια.",
      "imp.head": "Εισαγωγή", "imp.btn": "Από άλλη εφαρμογή…",
      "imp.hint": "Εξαγωγές από Withings, OMRON connect, Samsung Health ή Apple Health (ZIP, CSV ή export.xml).",
      "imp.title": "Εισαγωγή από άλλη εφαρμογή", "imp.reading": "Διαβάζεται το αρχείο…", "imp.from": "Από: {s}",
      "imp.range": "Μετρήσεις από {a} έως {b}", "imp.row": "{k}: βρέθηκαν {n}, νέες {a}",
      "imp.have": "Υπάρχουν ήδη στην Υγεία: {n}", "imp.conv": "Μετατράπηκαν για την Υγεία: {l}",
      "imp.conv.lb": "lb → kg", "imp.conv.mmol": "mmol/L → mg/dL", "imp.conv.f": "°F → °C", "imp.conv.frac": "κλάσμα SpO2 → %",
      "imp.skipT": "Δεν εισάγονται",
      "imp.sk.comp": "Λίπος, μύες, οστά, νερό (η Υγεία κρατά μόνο το βάρος): {n}",
      "imp.sk.height": "Ύψος (όρισέ το στις Ρυθμίσεις): {n}",
      "imp.sk.hrsDay": "Μετρήσεις παλμών: {n}, κρατιούνται ως {d} ημερήσιες τιμές ηρεμίας (η χαμηλότερη της ημέρας)",
      "imp.sk.hrs": "Μετρήσεις παλμών (χρησιμοποιούνται οι παλμοί ηρεμίας του αρχείου): {n}",
      "imp.sk.bad": "Εκτός ορίων ή δυσανάγνωστες: {n}", "imp.sk.dup": "Διπλές μέσα στο αρχείο: {n}",
      "imp.sk.half": "Τιμές πίεσης χωρίς το ζευγάρι τους: {n}", "imp.sk.other": "Πέρα από τα όρια: {n}",
      "imp.cut": "Εισάγονται μόνο οι {n} πιο πρόσφατες μετρήσεις· {c} παλαιότερες μένουν έξω.",
      "imp.keep": "Οι δικές σου μετρήσεις δεν αλλάζουν ποτέ. Όσες εισάγονται παίρνουν την ετικέτα «{g}».",
      "imp.none": "Τίποτα νέο για εισαγωγή: όλα υπάρχουν ήδη στην Υγεία.",
      "imp.go": "Εισαγωγή {n}", "imp.done": "Μετρήσεις που εισήχθησαν: {n}", "imp.undone": "Η εισαγωγή αναιρέθηκε",
      "imp.bad": "Αυτό το αρχείο δεν είναι εξαγωγή που διαβάζει η Υγεία.", "imp.empty": "Δεν υπάρχουν σε αυτό το αρχείο μετρήσεις που κρατά η Υγεία.",
      "imp.big": "Το αρχείο είναι πολύ μεγάλο για εισαγωγή.", "imp.ihb": "Αρρυθμία", "imp.mv": "Κίνηση σώματος",
      "day.0": "Δευ", "day.1": "Τρί", "day.2": "Τετ", "day.3": "Πέμ", "day.4": "Παρ", "day.5": "Σάβ", "day.6": "Κυρ"
    }
  };

  // Wave 2: medicines and symptoms (same keys in both languages).
  var STRINGS_MEDS = {
    en: {
      "tab.meds": "Medicines",
      "mv.today": "Today", "mv.list": "My medicines", "mv.hist": "History",
      "md.none": "No medicines yet. Add the ones you take to get today's doses, reminders and a count of what's left.",
      "md.add": "Add a medicine", "md.today": "Today · {d}", "md.noDoses": "No scheduled doses today.",
      "md.prn": "As needed", "md.takeNow": "Take a dose", "md.prnToday": "Today: {n} · last at {t}", "md.prnNone": "None today",
      "md.refill": "Refilled +{n}", "md.refilled": "{n}: {a} added",
      "md.left": "{left} left", "md.leftDays": "{left} left · {d}",
      "days.n": "about {n} days", "days.1": "about 1 day", "days.0": "less than a day",
      "md.adh30": "Taken: {p}% (last 30 days)", "md.stopped": "Stopped", "md.stoppedOn": "stopped",
      "md.disclaimer": "Health keeps a list, it does not give medical advice. Take your medicines as your doctor or pharmacist told you, and never change a dose because of what the app shows.",
      "ds.take": "Taken", "ds.skip": "Skip", "ds.snooze": "Snooze", "ds.undo": "Undo", "ds.edit": "Change",
      "st.taken": "Taken at {t}", "st.takenShort": "Taken", "st.skipped": "Skipped", "st.snoozed": "Snoozed until {t}",
      "st.upcoming": "Coming up", "st.due": "Due now", "st.late": "Late", "st.missed": "Missed",
      "sn.title": "Remind me again in", "sn.10": "10 minutes", "sn.30": "30 minutes", "sn.60": "1 hour",
      "toast.taken": "{n}: taken", "toast.skipped": "{n}: skipped", "toast.snoozed": "{n}: snoozed until {t}",
      "low.text": "{n}: {left} left, {d}", "low.textPrn": "{n}: {left} left", "low.out": "{n}: none left",
      "sch.d": "Every day", "sch.w": "On certain days", "sch.n": "Every few days", "sch.p": "As needed",
      "sch.every": "Every {n} days", "sch.until": "until {d}", "sch.from": "from {d}",
      "mdl.new": "New medicine", "mdl.name": "Name", "mdl.strength": "Strength (optional)", "mdl.strengthHint": "e.g. 500 mg",
      "mdl.form": "Form", "mdl.dose": "Dose ({u})", "mdl.sched": "How often", "mdl.days": "Days",
      "mdl.every": "Every how many days", "mdl.times": "Times", "mdl.timeAdd": "Add a time", "mdl.timeDel": "Remove time",
      "mdl.start": "Start", "mdl.end": "End (optional)", "mdl.remind": "Remind me at these times",
      "mdl.remHint": "Reminders appear while orOS is open (also with Health closed), for four hours after each time.",
      "mdl.stock": "Count what's left", "mdl.left": "Left now ({u})", "mdl.pack": "Pack size ({u})",
      "mdl.warn": "Warn me this many days before it runs out", "mdl.note": "Note",
      "mdl.stop": "Stop taking", "mdl.resume": "Taking it again", "mdl.del": "Delete medicine",
      "mdl.delAsk": "Delete “{n}” and its dose history on every synced device?", "mdl.deleted": "“{n}” deleted",
      "mdl.needTime": "Add at least one time.", "mdl.needDay": "Pick at least one day.",
      "dd.status": "Status", "dd.none": "Not marked", "dd.when": "Taken at", "dd.amount": "Amount ({u})",
      "dd.sched": "Planned for {d} {t}", "dd.prn": "As needed", "dd.delete": "Delete dose",
      "mh.all": "All medicines", "mh.counts": "{t} taken · {s} skipped · {m} missed", "mh.none": "No doses in this period.",
      "f.tab": "Tablet", "f.cap": "Capsule", "f.liq": "Liquid (ml)", "f.drop": "Drops", "f.inh": "Inhaler", "f.spray": "Spray",
      "f.inj": "Injection", "f.cream": "Cream or ointment", "f.patch": "Patch", "f.supp": "Suppository", "f.sach": "Sachet", "f.other": "Other",
      "u1.tab": "tablet", "un.tab": "tablets", "u1.cap": "capsule", "un.cap": "capsules", "u1.liq": "ml", "un.liq": "ml",
      "u1.drop": "drop", "un.drop": "drops", "u1.inh": "puff", "un.inh": "puffs", "u1.spray": "spray", "un.spray": "sprays",
      "u1.inj": "injection", "un.inj": "injections", "u1.cream": "application", "un.cream": "applications",
      "u1.patch": "patch", "un.patch": "patches", "u1.supp": "suppository", "un.supp": "suppositories",
      "u1.sach": "sachet", "un.sach": "sachets", "u1.other": "dose", "un.other": "doses",
      "sy.ha": "Headache", "sy.na": "Nausea", "sy.dz": "Dizziness", "sy.ft": "Tiredness", "sy.pn": "Pain",
      "sy.cg": "Cough", "sy.br": "Shortness of breath", "sy.pl": "Palpitations",
      "sy.card": "Symptoms", "sy.new": "New symptom", "sy.kind": "Symptom", "sy.int": "Intensity: {n}/10", "sy.intLbl": "Intensity",
      "sy.own": "Your own symptom…", "sy.ownTitle": "Your own symptom", "sy.del": "Delete symptom", "sy.deleted": "Symptom deleted",
      "sy.none": "None logged yet", "sy.avg": "Average intensity", "sy.max": "Highest", "sy.days": "Days with it",
      "sy.kindDel": "Delete “{n}” and its {c} entries on every synced device?", "sy.kinds": "Symptoms",
      "ch.marks": "Show symptoms and doses", "ch.marksHint": "Under the chart: dots for symptoms, ticks for doses taken",
      "rp.meds": "Medicines (list and doses taken)", "rp.syms": "Symptoms ({n})",
      "rp.medsH": "Medicines", "rp.symsH": "Symptoms",
      "rp.col.med": "Medicine", "rp.col.dose": "Dose", "rp.col.sched": "Schedule", "rp.col.taken": "Taken", "rp.col.course": "Course",
      "rp.col.sym": "Symptom", "rp.col.int": "Intensity",
      "rp.adh": "{p}% ({t} of {n})", "rp.prn": "{n} times", "rp.medFoot": "Doses as marked by the patient in orOS Health.",
      "csv.med": "Medicine", "csv.sym": "Symptom", "csv.sched": "Planned {t}"
    },
    el: {
      "tab.meds": "Φάρμακα",
      "mv.today": "Σήμερα", "mv.list": "Τα φάρμακά μου", "mv.hist": "Ιστορικό",
      "md.none": "Κανένα φάρμακο ακόμα. Πρόσθεσε όσα παίρνεις για να βλέπεις τις δόσεις της ημέρας, να έχεις υπενθυμίσεις και να ξέρεις πόσα σου έχουν μείνει.",
      "md.add": "Πρόσθεσε φάρμακο", "md.today": "Σήμερα · {d}", "md.noDoses": "Καμία προγραμματισμένη δόση σήμερα.",
      "md.prn": "Όταν χρειάζεται", "md.takeNow": "Πήρα μια δόση", "md.prnToday": "Σήμερα: {n} · τελευταία στις {t}", "md.prnNone": "Καμία σήμερα",
      "md.refill": "Αναπλήρωση +{n}", "md.refilled": "{n}: προστέθηκαν {a}",
      "md.left": "Έμειναν {left}", "md.leftDays": "Έμειναν {left} · {d}",
      "days.n": "για περίπου {n} μέρες", "days.1": "για περίπου 1 μέρα", "days.0": "για λιγότερο από μία μέρα",
      "md.adh30": "Λήψη: {p}% (τελευταίες 30 μέρες)", "md.stopped": "Σταματημένα", "md.stoppedOn": "σταματημένο",
      "md.disclaimer": "Η Υγεία κρατά μια λίστα, δεν δίνει ιατρικές συμβουλές. Παίρνε τα φάρμακά σου όπως σου είπε ο γιατρός ή ο φαρμακοποιός σου και μην αλλάζεις ποτέ δόση εξαιτίας όσων δείχνει η εφαρμογή.",
      "ds.take": "Το πήρα", "ds.skip": "Παράλειψη", "ds.snooze": "Αργότερα", "ds.undo": "Αναίρεση", "ds.edit": "Αλλαγή",
      "st.taken": "Το πήρες στις {t}", "st.takenShort": "Ελήφθη", "st.skipped": "Παραλείφθηκε", "st.snoozed": "Αναβολή έως τις {t}",
      "st.upcoming": "Επόμενη", "st.due": "Τώρα", "st.late": "Καθυστερεί", "st.missed": "Δεν ελήφθη",
      "sn.title": "Θύμισέ μου ξανά σε", "sn.10": "10 λεπτά", "sn.30": "30 λεπτά", "sn.60": "1 ώρα",
      "toast.taken": "{n}: ελήφθη", "toast.skipped": "{n}: παραλείφθηκε", "toast.snoozed": "{n}: αναβολή έως τις {t}",
      "low.text": "{n}: έμειναν {left}, {d}", "low.textPrn": "{n}: έμειναν {left}", "low.out": "{n}: δεν έμεινε τίποτα",
      "sch.d": "Κάθε μέρα", "sch.w": "Συγκεκριμένες μέρες", "sch.n": "Κάθε λίγες μέρες", "sch.p": "Όταν χρειάζεται",
      "sch.every": "Κάθε {n} μέρες", "sch.until": "έως {d}", "sch.from": "από {d}",
      "mdl.new": "Νέο φάρμακο", "mdl.name": "Όνομα", "mdl.strength": "Περιεκτικότητα (προαιρετικά)", "mdl.strengthHint": "π.χ. 500 mg",
      "mdl.form": "Μορφή", "mdl.dose": "Δόση ({u})", "mdl.sched": "Πόσο συχνά", "mdl.days": "Μέρες",
      "mdl.every": "Κάθε πόσες μέρες", "mdl.times": "Ώρες", "mdl.timeAdd": "Πρόσθεσε ώρα", "mdl.timeDel": "Αφαίρεση ώρας",
      "mdl.start": "Έναρξη", "mdl.end": "Λήξη (προαιρετικά)", "mdl.remind": "Υπενθύμιση σε αυτές τις ώρες",
      "mdl.remHint": "Οι υπενθυμίσεις εμφανίζονται όσο το orOS είναι ανοιχτό (και με κλειστή την Υγεία), για τέσσερις ώρες μετά από κάθε ώρα.",
      "mdl.stock": "Μέτρα πόσα έμειναν", "mdl.left": "Έμειναν τώρα ({u})", "mdl.pack": "Συσκευασία ({u})",
      "mdl.warn": "Ειδοποίησέ με τόσες μέρες πριν τελειώσει", "mdl.note": "Σημείωση",
      "mdl.stop": "Το σταμάτησα", "mdl.resume": "Το ξαναπαίρνω", "mdl.del": "Διαγραφή φαρμάκου",
      "mdl.delAsk": "Να διαγραφεί το «{n}» και το ιστορικό δόσεών του σε όλες τις συσκευές;", "mdl.deleted": "Το «{n}» διαγράφηκε",
      "mdl.needTime": "Πρόσθεσε τουλάχιστον μία ώρα.", "mdl.needDay": "Διάλεξε τουλάχιστον μία μέρα.",
      "dd.status": "Κατάσταση", "dd.none": "Χωρίς σημείωση", "dd.when": "Ώρα λήψης", "dd.amount": "Ποσότητα ({u})",
      "dd.sched": "Προγραμματισμένη {d} {t}", "dd.prn": "Όταν χρειάζεται", "dd.delete": "Διαγραφή δόσης",
      "mh.all": "Όλα τα φάρμακα", "mh.counts": "{t} ελήφθησαν · {s} παραλείφθηκαν · {m} δεν ελήφθησαν", "mh.none": "Καμία δόση σε αυτή την περίοδο.",
      "f.tab": "Δισκίο", "f.cap": "Κάψουλα", "f.liq": "Σιρόπι ή διάλυμα (ml)", "f.drop": "Σταγόνες", "f.inh": "Εισπνεόμενο", "f.spray": "Σπρέι",
      "f.inj": "Ένεση", "f.cream": "Κρέμα ή αλοιφή", "f.patch": "Επίθεμα", "f.supp": "Υπόθετο", "f.sach": "Φακελάκι", "f.other": "Άλλο",
      "u1.tab": "δισκίο", "un.tab": "δισκία", "u1.cap": "κάψουλα", "un.cap": "κάψουλες", "u1.liq": "ml", "un.liq": "ml",
      "u1.drop": "σταγόνα", "un.drop": "σταγόνες", "u1.inh": "εισπνοή", "un.inh": "εισπνοές", "u1.spray": "ψεκασμός", "un.spray": "ψεκασμοί",
      "u1.inj": "ένεση", "un.inj": "ενέσεις", "u1.cream": "επάλειψη", "un.cream": "επαλείψεις",
      "u1.patch": "επίθεμα", "un.patch": "επιθέματα", "u1.supp": "υπόθετο", "un.supp": "υπόθετα",
      "u1.sach": "φακελάκι", "un.sach": "φακελάκια", "u1.other": "δόση", "un.other": "δόσεις",
      "sy.ha": "Πονοκέφαλος", "sy.na": "Ναυτία", "sy.dz": "Ζάλη", "sy.ft": "Κούραση", "sy.pn": "Πόνος",
      "sy.cg": "Βήχας", "sy.br": "Δύσπνοια", "sy.pl": "Αίσθημα παλμών",
      "sy.card": "Συμπτώματα", "sy.new": "Νέο σύμπτωμα", "sy.kind": "Σύμπτωμα", "sy.int": "Ένταση: {n}/10", "sy.intLbl": "Ένταση",
      "sy.own": "Δικό σου σύμπτωμα…", "sy.ownTitle": "Δικό σου σύμπτωμα", "sy.del": "Διαγραφή συμπτώματος", "sy.deleted": "Το σύμπτωμα διαγράφηκε",
      "sy.none": "Κανένα ακόμα", "sy.avg": "Μέση ένταση", "sy.max": "Υψηλότερη", "sy.days": "Μέρες με το σύμπτωμα",
      "sy.kindDel": "Να διαγραφεί το «{n}» και οι {c} καταγραφές του σε όλες τις συσκευές;", "sy.kinds": "Συμπτώματα",
      "ch.marks": "Εμφάνιση συμπτωμάτων και δόσεων", "ch.marksHint": "Κάτω από το γράφημα: κουκκίδες για τα συμπτώματα, γραμμούλες για τις δόσεις που πήρες",
      "rp.meds": "Φάρμακα (λίστα και δόσεις που πάρθηκαν)", "rp.syms": "Συμπτώματα ({n})",
      "rp.medsH": "Φάρμακα", "rp.symsH": "Συμπτώματα",
      "rp.col.med": "Φάρμακο", "rp.col.dose": "Δόση", "rp.col.sched": "Πρόγραμμα", "rp.col.taken": "Λήψη", "rp.col.course": "Διάρκεια",
      "rp.col.sym": "Σύμπτωμα", "rp.col.int": "Ένταση",
      "rp.adh": "{p}% ({t} από {n})", "rp.prn": "{n} φορές", "rp.medFoot": "Δόσεις όπως τις σημείωσε ο ίδιος ο ασθενής στην Υγεία του orOS.",
      "csv.med": "Φάρμακο", "csv.sym": "Σύμπτωμα", "csv.sched": "Προγραμματισμένη {t}"
    }
  };
  // Wave 3: medical record (Medical ID, appointments, vaccines,
  // documents).
  var STRINGS_REC = {
    en: {
      "tab.record": "Record",
      "rv.id": "Medical ID", "rv.appt": "Appointments", "rv.vax": "Vaccines", "rv.docs": "Documents",
      "id.title": "Medical ID", "id.show": "Show Medical ID", "id.card": "Emergency card", "id.edit": "Edit",
      "id.empty": "Fill in your Medical ID, so that someone helping you in an emergency can see your allergies, conditions and medicines, and whom to call.",
      "id.name": "Name", "id.born": "Date of birth", "id.age": "{n} years old", "id.blood": "Blood type", "id.donor": "Organ donor",
      "id.yes": "Yes", "id.no": "No", "id.notGiven": "Not given",
      "id.notes": "Medical notes", "id.notesHint": "e.g. pacemaker, contact lenses, pregnant",
      "id.meds": "Show the medicines I take now", "id.al": "Allergies", "id.cn": "Conditions", "id.md": "Medicines",
      "id.ec": "Emergency contacts", "id.none": "None given",
      "id.qr": "Show a QR code", "id.qrHint": "A phone camera reads it as plain text. Nothing goes online.",
      "id.qrCut": "Shortened to fit the QR code.", "id.qrFail": "The QR code could not be made.",
      "id.call": "Call {n}", "id.head": "MEDICAL ID", "id.more": "+{n} more",
      "id.disclaimer": "The Medical ID shows what you typed, as you typed it. Keep it short and up to date: it does not replace your doctor's records.",
      "al.new": "New allergy", "al.name": "Allergic to", "al.nameHint": "e.g. penicillin, peanuts, bee stings", "al.sev": "Severity",
      "sev.0": "Not given", "sev.1": "Mild", "sev.2": "Moderate", "sev.3": "Severe",
      "al.r": "Reaction (optional)", "al.rHint": "e.g. rash, swelling, trouble breathing",
      "al.add": "Add an allergy", "al.del": "Delete allergy", "al.deleted": "Allergy deleted",
      "cn.new": "New condition", "cn.name": "Condition", "cn.nameHint": "e.g. type 2 diabetes, asthma", "cn.since": "Since (optional)",
      "cn.add": "Add a condition", "cn.del": "Delete condition", "cn.deleted": "Condition deleted",
      "ec.new": "Emergency contact", "ec.name": "Name", "ec.rel": "Relationship (optional)", "ec.relHint": "e.g. wife, son, neighbour",
      "ec.phone": "Phone", "ec.pick": "From Contacts", "ec.add": "Add a contact", "ec.del": "Delete contact", "ec.deleted": "Contact deleted",
      "ec.search": "Search contacts…", "ec.noContacts": "No contacts with a phone number.", "ec.badPhone": "Type a phone number.",
      "vx.new": "New vaccination", "vx.name": "Vaccine", "vx.nameHint": "e.g. tetanus, flu, hepatitis B", "vx.date": "Given on",
      "vx.next": "Next dose due (optional)", "vx.remind": "Remind me a week before and on the day",
      "vx.lot": "Batch number (optional)", "vx.add": "Add a vaccination", "vx.again": "Given again", "vx.del": "Delete vaccination",
      "vx.deleted": "Vaccination deleted", "vx.due": "Next dose {d}", "vx.overdue": "Next dose was due {d}", "vx.dueH": "Next doses",
      "vx.allH": "All vaccinations", "vx.given": "Given {d}",
      "vx.none": "No vaccinations yet. Add the ones on your vaccination card to be reminded before the next dose.",
      "vx.badNext": "The next dose must be after the day it was given.",
      "ap.new": "New appointment", "ap.dr": "Doctor", "ap.sp": "Specialty (optional)", "ap.spHint": "e.g. cardiologist, dentist",
      "ap.pl": "Place (optional)", "ap.plHint": "Address or clinic", "ap.date": "Date", "ap.time": "Time", "ap.du": "Duration",
      "ap.du0": "Not given", "ap.min": "{n} min", "ap.rm": "Remind me",
      "rm.-1": "No reminder", "rm.0": "At the time", "rm.15": "15 minutes before", "rm.30": "30 minutes before",
      "rm.60": "1 hour before", "rm.120": "2 hours before", "rm.1440": "1 day before", "rm.2880": "2 days before",
      "ap.map": "Show on the map", "ap.add": "Add an appointment", "ap.del": "Delete appointment", "ap.deleted": "Appointment deleted",
      "ap.upH": "Coming up", "ap.pastH": "Earlier", "ap.none": "No appointments yet. Add your next visit to be reminded and to see it in Today.",
      "ap.need": "Type the doctor or the specialty.",
      "ap.remHint": "Reminders appear while orOS is open, and through the orOS Android app with orOS closed.",
      "dc.new": "New document", "dc.kind": "Kind", "dk.lab": "Lab results", "dk.rx": "Prescription", "dk.img": "Imaging (X-ray, scan)",
      "dk.ltr": "Letter or discharge note", "dk.oth": "Other", "dc.name": "Title", "dc.nameHint": "e.g. blood test, cardiology letter",
      "dc.date": "Date", "dc.add": "Add a document", "dc.del": "Delete document", "dc.deleted": "Document deleted",
      "dc.none": "No documents yet. Keep lab results, prescriptions and letters here as photos or PDFs.",
      "dc.files": "{n} files", "dc.file1": "1 file", "dc.all": "All",
      "at.title": "Photos and PDFs", "at.hint": "Photos are made smaller and lose their location data. PDFs up to 10 MB.",
      "at.add": "Add a photo or PDF", "at.open": "Open file {n}", "at.pdf": "PDF", "at.missing": "Not on this device",
      "at.missingLong": "This file is not on this device yet. Sync your files with Vault Drive to bring it here.",
      "at.where": "Kept in Files, folder Health.", "at.openPdf": "Open", "at.save": "Save a copy", "at.remove": "Remove",
      "at.bad": "This file can't be added: a photo, or a PDF up to 10 MB.", "at.noDisk": "The orOS disk is not available.",
      "at.noFs": "Photos and PDFs can be added when Health runs inside orOS.",
      "pc.cut": "Cut along the dashed line and fold in the middle.", "pc.made": "Updated {d} · orOS Health",
      "pc.ice": "In an emergency call",
      "rec.dis": "Health keeps your record, it does not give medical advice."
    },
    el: {
      "tab.record": "Φάκελος",
      "rv.id": "Ιατρική ταυτότητα", "rv.appt": "Ραντεβού", "rv.vax": "Εμβόλια", "rv.docs": "Έγγραφα",
      "id.title": "Ιατρική ταυτότητα", "id.show": "Προβολή ιατρικής ταυτότητας", "id.card": "Κάρτα έκτακτης ανάγκης", "id.edit": "Επεξεργασία",
      "id.empty": "Συμπλήρωσε την ιατρική σου ταυτότητα, ώστε όποιος σε βοηθήσει σε έκτακτη ανάγκη να βλέπει αλλεργίες, παθήσεις και φάρμακα, και ποιον να ειδοποιήσει.",
      "id.name": "Όνομα", "id.born": "Ημερομηνία γέννησης", "id.age": "{n} ετών", "id.blood": "Ομάδα αίματος", "id.donor": "Δωρητής οργάνων",
      "id.yes": "Ναι", "id.no": "Όχι", "id.notGiven": "Δεν δόθηκε",
      "id.notes": "Ιατρικές σημειώσεις", "id.notesHint": "π.χ. βηματοδότης, φακοί επαφής, εγκυμοσύνη",
      "id.meds": "Να φαίνονται τα φάρμακα που παίρνω τώρα", "id.al": "Αλλεργίες", "id.cn": "Παθήσεις", "id.md": "Φάρμακα",
      "id.ec": "Επαφές έκτακτης ανάγκης", "id.none": "Καμία",
      "id.qr": "Προβολή κωδικού QR", "id.qrHint": "Η κάμερα ενός κινητού το διαβάζει ως απλό κείμενο. Τίποτα δεν πηγαίνει στο διαδίκτυο.",
      "id.qrCut": "Συντομεύτηκε για να χωρέσει στον κωδικό QR.", "id.qrFail": "Ο κωδικός QR δεν δημιουργήθηκε.",
      "id.call": "Κλήση: {n}", "id.head": "ΙΑΤΡΙΚΗ ΤΑΥΤΟΤΗΤΑ", "id.more": "+{n} ακόμα",
      "id.disclaimer": "Η ιατρική ταυτότητα δείχνει ό,τι έγραψες, όπως το έγραψες. Κράτα τη σύντομη και ενημερωμένη: δεν αντικαθιστά τον φάκελο του γιατρού σου.",
      "al.new": "Νέα αλλεργία", "al.name": "Αλλεργία σε", "al.nameHint": "π.χ. πενικιλίνη, φιστίκια, τσίμπημα μέλισσας", "al.sev": "Σοβαρότητα",
      "sev.0": "Δεν δόθηκε", "sev.1": "Ήπια", "sev.2": "Μέτρια", "sev.3": "Σοβαρή",
      "al.r": "Αντίδραση (προαιρετικά)", "al.rHint": "π.χ. εξάνθημα, πρήξιμο, δυσκολία στην αναπνοή",
      "al.add": "Πρόσθεσε αλλεργία", "al.del": "Διαγραφή αλλεργίας", "al.deleted": "Η αλλεργία διαγράφηκε",
      "cn.new": "Νέα πάθηση", "cn.name": "Πάθηση", "cn.nameHint": "π.χ. διαβήτης τύπου 2, άσθμα", "cn.since": "Από (προαιρετικά)",
      "cn.add": "Πρόσθεσε πάθηση", "cn.del": "Διαγραφή πάθησης", "cn.deleted": "Η πάθηση διαγράφηκε",
      "ec.new": "Επαφή έκτακτης ανάγκης", "ec.name": "Όνομα", "ec.rel": "Σχέση (προαιρετικά)", "ec.relHint": "π.χ. σύζυγος, γιος, γείτονας",
      "ec.phone": "Τηλέφωνο", "ec.pick": "Από τις Επαφές", "ec.add": "Πρόσθεσε επαφή", "ec.del": "Διαγραφή επαφής", "ec.deleted": "Η επαφή διαγράφηκε",
      "ec.search": "Αναζήτηση επαφών…", "ec.noContacts": "Καμία επαφή με τηλέφωνο.", "ec.badPhone": "Γράψε έναν αριθμό τηλεφώνου.",
      "vx.new": "Νέος εμβολιασμός", "vx.name": "Εμβόλιο", "vx.nameHint": "π.χ. τέτανος, γρίπη, ηπατίτιδα Β", "vx.date": "Έγινε στις",
      "vx.next": "Επόμενη δόση (προαιρετικά)", "vx.remind": "Θύμισέ μου μία εβδομάδα πριν και την ίδια μέρα",
      "vx.lot": "Αριθμός παρτίδας (προαιρετικά)", "vx.add": "Πρόσθεσε εμβόλιο", "vx.again": "Έγινε ξανά", "vx.del": "Διαγραφή εμβολίου",
      "vx.deleted": "Το εμβόλιο διαγράφηκε", "vx.due": "Επόμενη δόση {d}", "vx.overdue": "Η επόμενη δόση ήταν για {d}", "vx.dueH": "Επόμενες δόσεις",
      "vx.allH": "Όλα τα εμβόλια", "vx.given": "Έγινε {d}",
      "vx.none": "Κανένα εμβόλιο ακόμα. Πρόσθεσε όσα γράφει το βιβλιάριό σου για να σου θυμίζει την επόμενη δόση.",
      "vx.badNext": "Η επόμενη δόση πρέπει να είναι μετά τη μέρα που έγινε.",
      "ap.new": "Νέο ραντεβού", "ap.dr": "Γιατρός", "ap.sp": "Ειδικότητα (προαιρετικά)", "ap.spHint": "π.χ. καρδιολόγος, οδοντίατρος",
      "ap.pl": "Τόπος (προαιρετικά)", "ap.plHint": "Διεύθυνση ή ιατρείο", "ap.date": "Ημερομηνία", "ap.time": "Ώρα", "ap.du": "Διάρκεια",
      "ap.du0": "Δεν δόθηκε", "ap.min": "{n} λεπτά", "ap.rm": "Υπενθύμιση",
      "rm.-1": "Χωρίς υπενθύμιση", "rm.0": "Την ώρα του ραντεβού", "rm.15": "15 λεπτά πριν", "rm.30": "30 λεπτά πριν",
      "rm.60": "1 ώρα πριν", "rm.120": "2 ώρες πριν", "rm.1440": "1 μέρα πριν", "rm.2880": "2 μέρες πριν",
      "ap.map": "Στον χάρτη", "ap.add": "Πρόσθεσε ραντεβού", "ap.del": "Διαγραφή ραντεβού", "ap.deleted": "Το ραντεβού διαγράφηκε",
      "ap.upH": "Επόμενα", "ap.pastH": "Παλαιότερα", "ap.none": "Κανένα ραντεβού ακόμα. Πρόσθεσε την επόμενη επίσκεψη για να έχεις υπενθύμιση και να τη βλέπεις στη Σήμερα.",
      "ap.need": "Γράψε τον γιατρό ή την ειδικότητα.",
      "ap.remHint": "Οι υπενθυμίσεις εμφανίζονται όσο το orOS είναι ανοιχτό, και μέσω της εφαρμογής orOS για Android με κλειστό το orOS.",
      "dc.new": "Νέο έγγραφο", "dc.kind": "Είδος", "dk.lab": "Εξετάσεις", "dk.rx": "Συνταγή", "dk.img": "Απεικόνιση (ακτινογραφία, τομογραφία)",
      "dk.ltr": "Γνωμάτευση ή εξιτήριο", "dk.oth": "Άλλο", "dc.name": "Τίτλος", "dc.nameHint": "π.χ. αιματολογικές, γνωμάτευση καρδιολόγου",
      "dc.date": "Ημερομηνία", "dc.add": "Πρόσθεσε έγγραφο", "dc.del": "Διαγραφή εγγράφου", "dc.deleted": "Το έγγραφο διαγράφηκε",
      "dc.none": "Κανένα έγγραφο ακόμα. Κράτα εδώ εξετάσεις, συνταγές και γνωματεύσεις ως φωτογραφίες ή PDF.",
      "dc.files": "{n} αρχεία", "dc.file1": "1 αρχείο", "dc.all": "Όλα",
      "at.title": "Φωτογραφίες και PDF", "at.hint": "Οι φωτογραφίες μικραίνουν και χάνουν τα στοιχεία τοποθεσίας. PDF έως 10 MB.",
      "at.add": "Πρόσθεσε φωτογραφία ή PDF", "at.open": "Άνοιγμα αρχείου {n}", "at.pdf": "PDF", "at.missing": "Όχι σε αυτή τη συσκευή",
      "at.missingLong": "Αυτό το αρχείο δεν είναι ακόμα σε αυτή τη συσκευή. Συγχρόνισε τα αρχεία σου με το Vault Drive για να έρθει εδώ.",
      "at.where": "Φυλάσσεται στα Αρχεία, φάκελος Health.", "at.openPdf": "Άνοιγμα", "at.save": "Αποθήκευση αντιγράφου", "at.remove": "Αφαίρεση",
      "at.bad": "Αυτό το αρχείο δεν μπαίνει: φωτογραφία ή PDF έως 10 MB.", "at.noDisk": "Ο δίσκος του orOS δεν είναι διαθέσιμος.",
      "at.noFs": "Φωτογραφίες και PDF προστίθενται όταν η Υγεία τρέχει μέσα στο orOS.",
      "pc.cut": "Κόψε στη διακεκομμένη γραμμή και δίπλωσε στη μέση.", "pc.made": "Ενημέρωση {d} · Υγεία του orOS",
      "pc.ice": "Σε έκτακτη ανάγκη καλέστε",
      "rec.dis": "Η Υγεία κρατά τον φάκελό σου, δεν δίνει ιατρικές συμβουλές."
    }
  };
  ["en", "el"].forEach(function (l) {
    Object.keys(STRINGS_MEDS[l]).forEach(function (k) { STRINGS[l][k] = STRINGS_MEDS[l][k]; });
    Object.keys(STRINGS_REC[l]).forEach(function (k) { STRINGS[l][k] = STRINGS_REC[l][k]; });
  });

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
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function hm(d) { return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  function parseYmd(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function parseHm(s) {
    var m = /^(\d{2}):(\d{2})/.exec(s || "");
    return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : -1;
  }
  function atOf(ymdStr, hmStr) {
    var d = parseYmd(ymdStr), min = parseHm(hmStr);
    if (!d || min < 0) return NaN;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(min / 60), min % 60).getTime();
  }
  function wdIdx(d) { return (d.getDay() + 6) % 7; }
  function startOfDay(ms) { var d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

  function newId() {
    var r = new Uint32Array(2);
    crypto.getRandomValues(r);
    return Date.now().toString(36) + r[0].toString(36) + r[1].toString(36).slice(0, 4);
  }

  // ---------- 2. Numbers: units, parsing, formatting, CSV ----------
  function settings() { return C.settingsOf(data); }

  // Numbers with the language's decimal mark; trailing zeros dropped.
  function fmtNum(v, dec) {
    var p = Math.pow(10, dec);
    var s = (Math.round(v * p) / p).toFixed(dec);
    if (dec > 0) s = s.replace(/\.?0+$/, "");
    if (s === "-0") s = "0";
    var neg = s.charAt(0) === "-";
    if (neg) s = s.slice(1);
    var parts = s.split(".");
    var sep = LANG === "el" ? "." : ",", mark = LANG === "el" ? "," : ".";
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, sep);
    return (neg ? "−" : "") + parts.join(mark);
  }
  // The same number for an input field: no thousands mark, so
  // parseNum reads it back unchanged.
  function fmtEdit(v, dec) {
    var p = Math.pow(10, dec);
    var s = (Math.round(v * p) / p).toFixed(dec);
    if (dec > 0) s = s.replace(/\.?0+$/, "");
    if (s === "-0") s = "0";
    return LANG === "el" ? s.replace(".", ",") : s;
  }
  // "12,5", "12.5", " 12 " → 12.5. neg allows a leading minus (own kinds).
  function parseNum(str, neg) {
    var s = String(str == null ? "" : str).trim().replace(",", ".").replace("−", "-");
    var re = neg ? /^-?(\d+(\.\d+)?|\.\d+)$/ : /^(\d+(\.\d+)?|\.\d+)$/;
    if (!re.test(s)) return NaN;
    return parseFloat(s);
  }

  // A value slot: how one stored integer is shown.
  //   n plain integer · w weight · g glucose · t temperature
  //   min minutes shown as hours · k own kind (value × 1000)
  function slotKind(tid, i) {
    if (tid === "wt") return "w";
    if (tid === "gl") return "g";
    if (tid === "tp") return "t";
    if (tid === "sl") return i === 0 ? "min" : "n";
    if (C.isBuiltin(tid)) return "n";
    return "k";
  }
  function toDisp(kind, v) {
    if (kind === "w" || kind === "g" || kind === "t") return C.toUnit(kind, v, settings());
    if (kind === "min") return v / 60;
    if (kind === "k") return v / 1000;
    return v;
  }
  function fromDisp(kind, x) {
    if (typeof x !== "number" || !isFinite(x)) return NaN;
    if (kind === "w" || kind === "g" || kind === "t") return C.fromUnit(kind, x, settings());
    if (kind === "min") return Math.round(x * 60);
    if (kind === "k") return Math.round(x * 1000);
    return Math.round(x);
  }
  function decOf(kind, tid) {
    var set = settings();
    if (kind === "w" || kind === "t") return 1;
    if (kind === "g") return set.gu === "mmol" ? 1 : 0;
    if (kind === "min") return 1;
    if (kind === "k") { var ty = C.typeRow(data, tid); return ty ? ty.dc : 1; }
    return 0;
  }
  function fmtSlot(tid, i, v) { var k = slotKind(tid, i); return fmtNum(toDisp(k, v), decOf(k, tid)); }
  function unitOf(tid) {
    var set = settings();
    switch (tid) {
      case "bp": return "mmHg";
      case "wt": return set.wu;
      case "gl": return set.gu === "mmol" ? "mmol/L" : "mg/dL";
      case "sl": return t("u.h");
      case "hr": return t("u.bpm");
      case "tp": return set.tu === "f" ? "°F" : "°C";
      case "o2": return "%";
      case "st": return t("u.st");
    }
    var ty = C.typeRow(data, tid);
    return ty ? ty.u : "";
  }
  function typeName(tid) {
    if (C.isBuiltin(tid)) return t("t." + tid);
    var ty = C.typeRow(data, tid);
    return ty ? ty.n : "";
  }
  function fmtDur(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return LANG === "el" ? h + " ώ " + pad2(m) + " λ" : h + "h " + pad2(m) + "m";
  }
  // The main value of a reading, with its unit: "128/82 mmHg", "78.4 kg"
  function fmtValue(e) {
    if (e.t === "bp") return e.v[0] + "/" + e.v[1] + " mmHg";
    if (e.t === "sl") return fmtDur(e.v[0]);
    if (e.t === "o2") return e.v[0] + "%";
    var u = unitOf(e.t);
    return fmtSlot(e.t, 0, e.v[0]) + (u ? " " + u : "");
  }
  // Everything else about a reading, in one line.
  function fmtDetails(e) {
    var parts = [];
    if (e.t === "bp") {
      if (e.v[2]) parts.push(e.v[2] + " " + t("u.bpm"));
      if (e.a) parts.push(t("e.arm") + ": " + t("arm." + e.a));
      if (e.p) parts.push(t("pos." + e.p));
    } else if (e.t === "gl") parts.push(t("ctx." + e.c));
    else if (e.t === "sl") {
      parts.push(hm(new Date(e.at)) + "–" + hm(new Date(C.sleepEnd(e))));
      if (e.v[1]) parts.push(t("e.quality") + " " + e.v[1] + "/5");
    } else if (e.t === "wt") {
      var b = C.bmi(e.v[0], settings().h);
      if (b) parts.push(t("e.bmi", { b: fmtNum(b, 1) }));
    }
    if (e.src) parts.push(t("home.fromFit"));
    return parts.join(" · ");
  }
  function hasOwnTarget(tid) {
    var ty = C.typeRow(data, tid);
    return !!(ty && (ty.lo !== null || ty.hi !== null || ty.lo2 !== null || ty.hi2 !== null));
  }
  function levelText(e, lv) {
    if (!lv) return "";
    if (!hasOwnTarget(e.t)) {
      if (e.t === "bp" && lv === "bord") return t("lv.bp.bord");
      if (e.t === "wt" || e.t === "sl") return t("lv." + e.t + "." + lv);
    }
    return t("lv." + lv);
  }
  function badge(e) {
    var lv = C.classify(data, e);
    if (!lv) return null;
    return el("span", "lv lv-" + lv, levelText(e, lv));
  }

  function fmtDate(ms, withDay) {
    var d = new Date(ms);
    var wd = withDay ? t("day." + wdIdx(d)) + " " : "";
    return wd + d.getDate() + "/" + (d.getMonth() + 1) + "/" + d.getFullYear();
  }
  function fmtWhen(ms) {
    var today = startOfDay(Date.now()), day = startOfDay(ms), time = hm(new Date(ms));
    if (day === today) return t("when.today", { t: time });
    var n = new Date();
    if (day === new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1).getTime()) return t("when.yday", { t: time });
    return fmtDate(ms, true) + " " + time;
  }

  // CSV: Greek Excel wants ";" and a decimal comma; English wants ","
  // and a point. Cells a spreadsheet would run as a formula get an
  // apostrophe in front.
  function csvCell(v, sep) {
    var s = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (s.indexOf(sep) >= 0 || /["\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function csvNum(tid, i, v) {
    var k = slotKind(tid, i), p = Math.pow(10, Math.max(decOf(k, tid), k === "min" ? 2 : 0));
    var s = String(Math.round(toDisp(k, v) * p) / p);
    return LANG === "el" ? s.replace(".", ",") : s;
  }
  // entries: readings; more: [{ at, cells }] (symptoms, doses), in the
  // same columns, sorted in by time.
  function buildCsv(entries, more) {
    var sep = LANG === "el" ? ";" : ",";
    var body = [];
    entries.forEach(function (e) {
      var d = new Date(e.at), det = "";
      if (e.t === "bp") det = [e.a ? t("e.arm") + ": " + t("arm." + e.a) : "", e.p ? t("pos." + e.p) : ""].filter(Boolean).join(" · ");
      else if (e.t === "gl") det = t("ctx." + e.c);
      else if (e.t === "sl") det = hm(d) + "–" + hm(new Date(C.sleepEnd(e))) + (e.v[1] ? " · " + t("e.quality") + " " + e.v[1] + "/5" : "");
      var lv = C.classify(data, e);
      body.push({ at: e.at, cells: [ymd(d), hm(d), typeName(e.t),
                 e.t === "bp" ? e.v[0] : csvNum(e.t, 0, e.v[0]),
                 unitOf(e.t),
                 e.t === "bp" ? e.v[1] : "",
                 e.t === "bp" && e.v[2] ? e.v[2] : "",
                 det, levelText(e, lv), e.n || "", (e.g || []).join(", "), e.src ? t("csv.fit") : ""] });
    });
    body = body.concat(more || []);
    body.sort(function (a, b) { return a.at - b.at; });
    var rows = [[t("csv.date"), t("csv.time"), t("csv.kind"), t("csv.value"), t("csv.unit"), t("csv.dia"),
                 t("csv.pulse"), t("csv.details"), t("csv.status"), t("csv.note"), t("csv.tags"), t("csv.source")]]
      .concat(body.map(function (b) { return b.cells; }));
    return "﻿" + rows.map(function (r) {
      return r.map(function (c) { return csvCell(c, sep); }).join(sep);
    }).join("\r\n") + "\r\n";
  }

  // ---------- 3. Storage, prefs ----------
  var data = null, prefs = null;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.en)) {
          data = C.merge(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] health: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = C.emptyData();
  }

  var saveFailShown = false;
  function saveNow() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function findRow(c, id) {
    var list = data[c] || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function putRow(c, row) {
    var list = data[c];
    for (var i = 0; i < list.length; i++) if (list[i].id === row.id) { list[i] = row; return; }
    list.push(row);
    list.sort(function (a, b) { return cmpStr(a.id, b.id); });
  }
  // R27: a stamp moves only on a real change, always forward, and past
  // any tombstone of the same id (an edit after a delete resurrects).
  function nextM(c, id) {
    var old = findRow(c, id);
    return Math.max(Date.now(), (old ? old.m : 0) + 1, (data.tombs[c + ":" + id] || 0) + 1);
  }
  // Delete = tombstone at least as new as the row (it wins the tie).
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
  function editSettings(patch) {
    var s = JSON.parse(JSON.stringify(settings()));
    Object.keys(patch).forEach(function (k) { s[k] = patch[k]; });
    s.m = Math.max(Date.now(), (data.set ? data.set.m : 0) + 1);
    data.set = C.normSettings(s);
    saveNow();
  }
  // Built-in rows are written only when something changes.
  function editType(tid, patch) {
    var cur = C.typeRow(data, tid);
    if (!cur) return null;
    var row = JSON.parse(JSON.stringify(cur));
    Object.keys(patch).forEach(function (k) { row[k] = patch[k]; });
    row.m = nextM("ty", tid);
    var n = C.normType(row);
    if (!n) return null;
    putRow("ty", n);
    saveNow();
    return n;
  }

  // Workouts' body weights as read-only readings (never stored here).
  function fitEntries() {
    if (!settings().fw) return [];
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(FIT_KEY)); } catch (e) {}
    return C.fitnessWeights(raw).map(function (w) {
      return { id: "fit-" + w.d, m: 0, t: "wt", at: w.at, v: [w.g], c: 0, a: 0, p: 0, n: "", g: [], src: "fitness" };
    });
  }
  // Readings of one kind (or all, tid = ""), oldest first; weights
  // include Workouts when that is on.
  function readings(tid, withFit) {
    var list = data.en.filter(function (e) { return !tid || e.t === tid; });
    if (withFit && (!tid || tid === "wt")) list = list.concat(fitEntries());
    return list.sort(function (x, y) { return x.at - y.at || cmpStr(x.id, y.id); });
  }
  function visibleTypes() { return C.typeList(data).filter(function (ty) { return !ty.h; }); }

  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY)); } catch (e) {}
    p = p && typeof p === "object" ? p : {};
    var tabs = ["home", "meds", "history", "charts", "report", "record"];
    prefs = {
      tab: tabs.indexOf(p.tab) >= 0 ? p.tab : "home",
      ct: typeof p.ct === "string" && C.ID_RE.test(p.ct) ? p.ct : "bp",
      cp: PERIODS.indexOf(p.cp) >= 0 ? p.cp : "30",
      cc: typeof p.cc === "number" && p.cc >= -1 && p.cc < C.CTX.length ? p.cc : -1,
      hf: typeof p.hf === "string" && (p.hf === "" || C.ID_RE.test(p.hf)) ? p.hf : "",
      rd: typeof p.rd === "number" && [30, 90, 365].indexOf(p.rd) >= 0 ? p.rd : 30,
      rn: p.rn === 1 ? 1 : 0,
      rx: Array.isArray(p.rx) ? p.rx.filter(function (x) { return typeof x === "string" && C.ID_RE.test(x); }).slice(0, 40) : null,
      mv: ["today", "list", "hist"].indexOf(p.mv) >= 0 ? p.mv : "today",
      mh: [7, 30, 90].indexOf(p.mh) >= 0 ? p.mh : 30,
      cm: p.cm === 1 ? 1 : 0,
      rm: p.rm === 0 ? 0 : 1,
      rs: p.rs === 0 ? 0 : 1,
      rv: ["id", "appt", "vax", "docs"].indexOf(p.rv) >= 0 ? p.rv : "id",
      iq: p.iq === 1 ? 1 : 0,
      dk: C.DOC_KINDS.indexOf(p.dk) >= 0 ? p.dk : ""
    };
  }
  var prefsTimer = null;
  function savePrefs() { clearTimeout(prefsTimer); prefsTimer = setTimeout(savePrefsNow, 300); }
  function savePrefsNow() {
    clearTimeout(prefsTimer);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ---------- 4. UI shell: tabs, toolbar, toasts, dialogs ----------
  var SV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  var UI = {
    gear: SV + '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    home: SV + '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/><path d="M3.5 12h4l2-3 3 6 2-3h6"/></svg>',
    history: SV + '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
    chart: SV + '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg>',
    report: SV + '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>',
    plus: SV + '<path d="M12 5v14M5 12h14"/></svg>',
    trash: SV + '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    edit: SV + '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    eye: SV + '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: SV + '<path d="M3 3l18 18M10.6 5.1A10.9 10.9 0 0 1 12 5c7 0 11 7 11 7a18 18 0 0 1-3.2 4M6.6 6.6C3.4 8.6 1 12 1 12s4 7 11 7a10.6 10.6 0 0 0 5.4-1.6"/></svg>',
    x: SV + '<path d="M18 6L6 18M6 6l12 12"/></svg>',
    pill: SV + '<path d="M10.5 20.5a5 5 0 0 1-7-7l10-10a5 5 0 0 1 7 7z"/><path d="M8.5 8.5l7 7"/></svg>',
    sym: SV + '<path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/><circle cx="12" cy="12" r="3"/></svg>',
    check: SV + '<path d="M20 6L9 17l-5-5"/></svg>',
    clock: SV + '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    skip: SV + '<path d="M5 4l10 8-10 8z"/><path d="M19 5v14"/></svg>',
    bell: SV + '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    idcard: SV + '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 8v6M9 11h6M7 17h10"/></svg>',
    phone: SV + '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
    pin: SV + '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    file: SV + '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
    shield: SV + '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>',
    print: SV + '<path d="M6 9V2h12v7"/><rect x="6" y="14" width="12" height="8"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/></svg>',
    // one per kind
    bp: SV + '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/></svg>',
    wt: SV + '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8.5 9a4.5 4.5 0 0 1 7 0"/><path d="M12 9.5l1.5-2"/></svg>',
    gl: SV + '<path d="M12 2.7s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11z"/></svg>',
    sl: SV + '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    hr: SV + '<path d="M3 12h4l2-5 4 10 2-5h6"/></svg>',
    tp: SV + '<path d="M14 14.8V4.5a2 2 0 0 0-4 0v10.3a4 4 0 1 0 4 0z"/></svg>',
    o2: SV + '<circle cx="9" cy="12" r="5"/><path d="M17 15.5c0-1 2.5-1.6 2.5-3a1.3 1.3 0 0 0-2.5-.4M17 17.5h3"/></svg>',
    st: SV + '<path d="M8 3c1.7 0 2.5 1.6 2.5 4S9.4 11 8 11 5.5 9.4 5.5 7 6.3 3 8 3zM6 13.5h4V16a2 2 0 0 1-4 0zM16 7c1.7 0 2.5 1.6 2.5 4s-1.1 4-2.5 4-2.5-1.6-2.5-4S14.3 7 16 7zM14 17.5h4V20a2 2 0 0 1-4 0z"/></svg>',
    own: SV + '<path d="M4 20h16M6 16l4-6 4 3 4-7"/></svg>'
  };
  var TABS = [["home", "home"], ["meds", "pill"], ["history", "history"], ["charts", "chart"], ["report", "report"], ["record", "idcard"]];

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
  function kindIcon(tid) {
    var i = el("span", "k-ic");
    i.innerHTML = UI[C.isBuiltin(tid) || ["pill", "sym", "idcard", "file", "shield", "phone", "history"].indexOf(tid) >= 0 ? tid : "own"];
    i.setAttribute("aria-hidden", "true");
    return i;
  }
  function section(title) {
    var s = el("section", "sec");
    if (title) s.appendChild(el("h2", "", title));
    return s;
  }
  function hint(text) { return el("p", "hint", text); }
  function chips(items, cur, onPick, label) {
    var row = el("div", "chips");
    row.setAttribute("role", "group");
    if (label) row.setAttribute("aria-label", label);
    items.forEach(function (it) {
      var b = el("button", "chip" + (it[0] === cur ? " on" : ""), it[1]);
      b.type = "button";
      b.setAttribute("aria-pressed", it[0] === cur ? "true" : "false");
      b.addEventListener("click", function () { onPick(it[0]); });
      row.appendChild(b);
    });
    return row;
  }

  // Dialogs (R32: centered, scroll inside)
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function makeDialog(id, title) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "hl-dlg";
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () {
      parkToast();
      setTimeout(function () { dlg.remove(); }, 0);
    });
    if (title) dlg.appendChild(el("div", "dlg-title", title));
    return dlg;
  }
  function openDialog(dlg) { document.body.appendChild(dlg); dlg.showModal(); }
  function confirmDialog(text, okLabel, onOk) {
    var dlg = makeDialog("hl-confirm", null);
    dlg.appendChild(el("p", "dlg-text", text));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(okLabel, "danger", function () { dlg.close(); onOk(); }));
    dlg.appendChild(acts);
    openDialog(dlg);
  }
  function field(label, inp, cls) {
    var w = el("label", "fld" + (cls ? " " + cls : ""));
    w.appendChild(el("span", "fld-lbl", label));
    w.appendChild(inp);
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
  function select(opts, value) {
    var s = el("select");
    opts.forEach(function (o) {
      var x = el("option", "", o[1]);
      x.value = String(o[0]);
      s.appendChild(x);
    });
    s.value = String(value);
    return s;
  }

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "health", title: String(text) })) return;
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

  function setTab(tab) {
    if (prefs.tab !== tab) { prefs.tab = tab; savePrefs(); }
    render();
    var v = $("view");
    if (v) v.scrollTop = 0;
  }
  function renderNav() {
    var nav = $("nav");
    nav.innerHTML = "";
    TABS.forEach(function (tb) {
      var b = txtBtn("nav-btn" + (prefs.tab === tb[0] ? " on" : ""), UI[tb[1]], t("tab." + tb[0]), function () { setTab(tb[0]); });
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
  var histLimit = HIST_PAGE;
  function render() {
    pendingRender = false;
    renderNav();
    var v = $("view");
    v.innerHTML = "";
    if (prefs.tab === "meds") renderMeds(v);
    else if (prefs.tab === "history") renderHistory(v);
    else if (prefs.tab === "charts") renderCharts(v);
    else if (prefs.tab === "report") renderReport(v);
    else if (prefs.tab === "record") renderRecord(v);
    else renderHome(v);
  }

  // ---------- 5. Home: one card per kind ----------
  function renderHome(v) {
    setTitle(t("app"));
    var grid = el("div", "cards");
    var fit = fitEntries();
    visibleTypes().forEach(function (ty) {
      var last = null;
      data.en.forEach(function (e) { if (e.t === ty.id && (!last || e.at > last.at)) last = e; });
      if (ty.id === "wt") fit.forEach(function (e) { if (!last || e.at > last.at) last = e; });
      var card = el("div", "card");
      var open = el("button", "card-main");
      open.type = "button";
      var head = el("div", "card-head");
      head.appendChild(kindIcon(ty.id));
      head.appendChild(el("span", "card-name", typeName(ty.id)));
      if (ty.r.length) {
        var bell = el("span", "card-bell");
        bell.innerHTML = UI.bell;
        bell.title = ty.r.map(function (m) { return pad2(Math.floor(m / 60)) + ":" + pad2(m % 60); }).join(", ");
        head.appendChild(bell);
      }
      open.appendChild(head);
      if (last) {
        open.appendChild(el("div", "card-val", fmtValue(last)));
        var meta = el("div", "card-meta");
        var bd = badge(last);
        if (bd) meta.appendChild(bd);
        meta.appendChild(el("span", "card-when", fmtWhen(last.at) + (last.src ? " · " + t("home.fromFit") : "")));
        open.appendChild(meta);
      } else {
        open.appendChild(el("div", "card-none", t("home.never")));
      }
      open.addEventListener("click", function () {
        prefs.ct = ty.id;
        setTab("charts");
      });
      card.appendChild(open);
      card.appendChild(iconBtn("card-add", UI.plus, t("home.add") + ": " + typeName(ty.id), function () { entryDialog(ty.id, null); }));
      grid.appendChild(card);
    });
    grid.appendChild(symCard());
    var own = el("button", "card card-new");
    own.type = "button";
    own.innerHTML = UI.plus;
    own.appendChild(el("b", "", t("home.own")));
    own.appendChild(el("small", "", t("home.ownHint")));
    own.addEventListener("click", function () { kindDialog(null); });
    grid.appendChild(own);
    v.appendChild(grid);
    v.appendChild(el("p", "disclaimer", t("home.disclaimer")));
  }

  // The Symptoms card: the latest symptom; + logs a new one, the card
  // opens its chart.
  function symCard() {
    var last = symptoms("").pop() || null;
    var card = el("div", "card");
    var open = el("button", "card-main");
    open.type = "button";
    var head = el("div", "card-head");
    head.appendChild(kindIcon("sym"));
    head.appendChild(el("span", "card-name", t("sy.card")));
    open.appendChild(head);
    if (last) {
      open.appendChild(el("div", "card-val", symText(last)));
      var meta = el("div", "card-meta");
      meta.appendChild(el("span", "card-when", fmtWhen(last.at)));
      open.appendChild(meta);
    } else open.appendChild(el("div", "card-none", t("sy.none")));
    open.addEventListener("click", function () {
      prefs.ct = "sy-" + (last ? last.k : (visibleSymKinds()[0] || { id: "ha" }).id);
      setTab("charts");
    });
    card.appendChild(open);
    card.appendChild(iconBtn("card-add", UI.plus, t("home.add") + ": " + t("sy.card"), function () { symDialog(null, null); }));
    return card;
  }

  // ---------- 6. Entry dialog ----------
  // e = null → new reading of kind tid, now.
  function entryDialog(tid, e) {
    if (!C.typeRow(data, tid)) { showToast(t("feed.gone")); return; }
    var set = settings();
    var dlg = makeDialog("hl-entry", typeName(tid) + (e ? "" : " · " + t("e.title.new")));
    var form = el("form");
    form.method = "dialog";
    form.noValidate = true;
    var now = new Date(), f = {};
    var at = e ? new Date(e.at) : now;
    var row1 = el("div", "row2");

    if (tid === "sl") {
      // Sleep: bed time (night of) + wake time, both local.
      var bedDef = e ? at : new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getHours() < 18 ? 1 : 0), 23, 0);
      var wakeDef = e ? new Date(C.sleepEnd(e)) : new Date(bedDef.getFullYear(), bedDef.getMonth(), bedDef.getDate() + 1, 7, 0);
      f.date = input("date", ymd(bedDef));
      f.date.max = ymd(now);
      f.bed = input("time", hm(bedDef));
      f.wake = input("time", hm(wakeDef));
      form.appendChild(field(t("e.bedDate"), f.date));
      row1.appendChild(field(t("e.bed"), f.bed));
      row1.appendChild(field(t("e.wake"), f.wake));
      form.appendChild(row1);
      var dur = el("p", "hint dur");
      form.appendChild(dur);
      f.q = select([0, 1, 2, 3, 4, 5].map(function (q) { return [q, t("q." + q)]; }), e ? e.v[1] : 0);
      form.appendChild(field(t("e.quality"), f.q));
      var paintDur = function () {
        var m = sleepMinutes();
        dur.textContent = m > 0 ? t("e.slept", { d: fmtDur(m) }) : "";
      };
      [f.date, f.bed, f.wake].forEach(function (i) { i.addEventListener("input", paintDur); });
      setTimeout(paintDur, 0);
    } else {
      f.date = input("date", ymd(at));
      f.date.max = ymd(now);
      f.time = input("time", hm(at));
      row1.appendChild(field(t("e.date"), f.date));
      row1.appendChild(field(t("e.time"), f.time));
      form.appendChild(row1);
    }
    function sleepMinutes() {
      var b = atOf(f.date.value, f.bed.value), wm = parseHm(f.wake.value);
      if (isNaN(b) || wm < 0) return -1;
      var bd = new Date(b);
      var w = new Date(bd.getFullYear(), bd.getMonth(), bd.getDate(), Math.floor(wm / 60), wm % 60).getTime();
      if (w <= b) w = new Date(bd.getFullYear(), bd.getMonth(), bd.getDate() + 1, Math.floor(wm / 60), wm % 60).getTime();
      return Math.round((w - b) / 60000);
    }

    function numInput(i, label, cls) {
      var k = slotKind(tid, i);
      var val = e && e.v[i] ? fmtEdit(toDisp(k, e.v[i]), decOf(k, tid)) : "";
      var inp = input("text", val, (k === "n" ? "numeric" : "decimal"));
      inp.className = "num";
      f["v" + i] = inp;
      return field(label, inp, cls);
    }
    if (tid === "bp") {
      var r2 = el("div", "row2");
      r2.appendChild(numInput(0, t("e.sys") + " · mmHg"));
      r2.appendChild(numInput(1, t("e.dia") + " · mmHg"));
      form.appendChild(r2);
      form.appendChild(numInput(2, t("e.pulse") + " · " + t("u.bpm")));
      var r3 = el("div", "row2");
      f.a = select([[0, t("e.none")], [1, t("arm.1")], [2, t("arm.2")]], e ? e.a : 0);
      f.p = select([[0, t("e.none")], [1, t("pos.1")], [2, t("pos.2")], [3, t("pos.3")]], e ? e.p : 0);
      r3.appendChild(field(t("e.arm"), f.a));
      r3.appendChild(field(t("e.pos"), f.p));
      form.appendChild(r3);
    } else if (tid !== "sl") {
      var u = unitOf(tid);
      form.appendChild(numInput(0, t("e.value") + (u ? " · " + u : "")));
      if (tid === "gl") {
        f.c = select(C.CTX.map(function (x, i) { return [i, t("ctx." + i)]; }), e ? e.c : guessCtx(now));
        form.appendChild(field(t("e.ctx"), f.c));
      }
      if (tid === "wt") {
        var bmiLine = el("p", "hint");
        form.appendChild(bmiLine);
        var paintBmi = function () {
          if (!set.h) { bmiLine.textContent = t("e.bmiNeed"); return; }
          var g = fromDisp("w", parseNum(f.v0.value));
          var b = C.bmi(g, set.h);
          bmiLine.textContent = b ? t("e.bmi", { b: fmtNum(b, 1) }) : "";
        };
        f.v0.addEventListener("input", paintBmi);
        paintBmi();
      }
    }
    f.n = el("textarea");
    f.n.rows = 2;
    f.n.maxLength = C.NOTE_LEN;
    f.n.value = e ? e.n : "";
    form.appendChild(field(t("e.note"), f.n));
    f.g = input("text", e ? e.g.join(", ") : "");
    f.g.placeholder = t("e.tagsHint");
    form.appendChild(field(t("e.tags"), f.g));
    var err = el("p", "err");
    err.setAttribute("role", "alert");
    form.appendChild(err);

    var acts = el("div", "dlg-actions");
    if (e) {
      acts.appendChild(iconBtn("dlg-btn icon danger", UI.trash, t("e.del"), function () {
        dlg.close();
        var gone = removeRow("en", e.id);
        saveNow();
        render();
        undoToast(t("e.deleted"), function () { restoreRow("en", gone); saveNow(); render(); });
      }));
    }
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      err.textContent = "";
      var bad = false, row = { id: e ? e.id : newId(), m: 0, t: tid, v: [], c: 0, a: 0, p: 0 };
      function mark(inp, isBad) { inp.classList.toggle("bad", !!isBad); if (isBad) bad = true; }
      if (tid === "sl") {
        var mins = sleepMinutes();
        mark(f.bed, mins <= 0);
        mark(f.wake, mins <= 0);
        row.at = atOf(f.date.value, f.bed.value);
        row.v = [mins, Number(f.q.value)];
      } else {
        row.at = atOf(f.date.value, f.time.value);
        mark(f.date, !parseYmd(f.date.value));
        mark(f.time, parseHm(f.time.value) < 0);
        var spec = C.SPEC[tid] || [[-C.CUSTOM_MAX, C.CUSTOM_MAX, 1]];
        spec.forEach(function (sp, i) {
          var raw = f["v" + i].value.trim();
          if (!raw && !sp[2]) { row.v.push(0); mark(f["v" + i], false); return; }
          var x = fromDisp(slotKind(tid, i), parseNum(raw, !C.isBuiltin(tid)));
          var okv = !isNaN(x) && x >= sp[0] && x <= sp[1];
          mark(f["v" + i], !okv);
          row.v.push(okv ? x : 0);
        });
        if (tid === "bp" && !bad && row.v[1] >= row.v[0]) {
          mark(f.v1, true);
          err.textContent = t("e.badBp");
          return;
        }
        if (f.c) row.c = Number(f.c.value);
        if (f.a) row.a = Number(f.a.value);
        if (f.p) row.p = Number(f.p.value);
      }
      if (isNaN(row.at)) bad = true;
      if (bad) { err.textContent = t("e.bad"); return; }
      row.n = f.n.value;
      row.g = f.g.value.split(/[,;]/);
      row.m = nextM("en", row.id);
      var n = C.normEntry(row);
      if (!n) { err.textContent = t("e.bad"); return; }
      putRow("en", n);
      saveNow();
      dlg.close();
      render();
      live(t("e.saved") + ": " + typeName(tid) + " " + fmtValue(n));
    });
    dlg.appendChild(form);
    openDialog(dlg);
    var first = f.v0 || f.bed;
    if (first && !e) setTimeout(function () { try { first.focus(); } catch (x) {} }, 30);
  }
  // A sensible default for the glucose context by the clock.
  function guessCtx(d) {
    var h = d.getHours();
    if (h >= 5 && h < 10) return 1;
    if (h >= 22 || h < 2) return 4;
    return 0;
  }

  // ---------- 7. History ----------
  function renderHistory(v) {
    setTitle(t("tab.history"));
    var kinds = visibleTypes().filter(function (ty) {
      return data.en.some(function (e) { return e.t === ty.id; }) || (ty.id === "wt" && fitEntries().length);
    });
    var syms = symptoms("");
    var opts = kinds.map(function (k) { return [k.id, typeName(k.id)]; });
    if (syms.length) opts.push(["sy", t("sy.card")]);
    if (prefs.hf && !opts.some(function (o) { return o[0] === prefs.hf; })) prefs.hf = "";
    var s = section(null);
    if (opts.length > 1) {
      s.appendChild(chips([["", t("hist.all")]].concat(opts), prefs.hf, function (id) {
        prefs.hf = id;
        histLimit = HIST_PAGE;
        savePrefs();
        render();
      }, t("tab.history")));
    }
    var hidden = {};
    C.typeList(data).forEach(function (ty) { if (ty.h) hidden[ty.id] = 1; });
    var list = prefs.hf === "sy" ? [] : readings(prefs.hf, true).filter(function (e) { return !hidden[e.t] && C.typeRow(data, e.t); });
    if (!prefs.hf || prefs.hf === "sy") {
      list = list.concat(syms.map(function (e) { return { sym: e, id: e.id, at: e.at }; }));
      list.sort(function (x, y) { return x.at - y.at || cmpStr(x.id, y.id); });
    }
    list.reverse();
    if (!list.length) { s.appendChild(hint(t("hist.empty"))); v.appendChild(s); return; }
    v.appendChild(s);
    var day = "", box = null;
    list.slice(0, histLimit).forEach(function (e) {
      var dk = ymd(new Date(e.at));
      if (dk !== day) {
        day = dk;
        box = section(fmtDate(e.at, true));
        v.appendChild(box);
      }
      if (e.sym) { box.appendChild(symRow(e.sym)); return; }
      var row = el(e.src ? "div" : "button", "h-row" + (e.src ? " ro" : ""));
      if (!e.src) {
        row.type = "button";
        row.addEventListener("click", function () { entryDialog(e.t, findRow("en", e.id)); });
      } else row.title = t("hist.fit");
      row.appendChild(el("span", "h-time", hm(new Date(e.at))));
      row.appendChild(kindIcon(e.t));
      var mid = el("span", "h-mid");
      var top = el("span", "h-top");
      top.appendChild(el("b", "", fmtValue(e)));
      var bd = badge(e);
      if (bd) top.appendChild(bd);
      mid.appendChild(top);
      var sub = [typeName(e.t), fmtDetails(e)].filter(Boolean).join(" · ");
      mid.appendChild(el("small", "", sub));
      if (e.n || e.g.length) mid.appendChild(el("small", "h-note", [e.g.join(", "), e.n].filter(Boolean).join(" · ")));
      row.appendChild(mid);
      box.appendChild(row);
    });
    if (list.length > histLimit) {
      var more = section(null);
      more.appendChild(txtBtn("wide-btn", null, t("hist.more"), function () { histLimit += HIST_PAGE; render(); }));
      v.appendChild(more);
    }
  }

  function symRow(e) {
    var row = el("button", "h-row");
    row.type = "button";
    row.addEventListener("click", function () { symDialog(findRow("sy", e.id), null); });
    row.appendChild(el("span", "h-time", hm(new Date(e.at))));
    row.appendChild(kindIcon("sym"));
    var mid = el("span", "h-mid");
    var top = el("span", "h-top");
    top.appendChild(el("b", "", symName(e.k)));
    top.appendChild(el("span", "lv sy-lv sy-l" + (e.i >= 7 ? 3 : e.i >= 4 ? 2 : 1), e.i + "/10"));
    mid.appendChild(top);
    mid.appendChild(el("small", "", t("sy.card")));
    if (e.n || e.g.length) mid.appendChild(el("small", "h-note", [e.g.join(", "), e.n].filter(Boolean).join(" · ")));
    row.appendChild(mid);
    return row;
  }

  // ---------- 8. Charts ----------
  // Hand-made SVG. Lines in the shell's accent colour (a second series
  // in a muted tone), the target band shaded, a tooltip on hover / tap
  // and the same numbers as a table.
  var SVGNS = "http://www.w3.org/2000/svg";
  function sv(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }
  function chartWidth(host) {
    var w = host.clientWidth;
    if (!w) {
      var v = $("view"), cs = getComputedStyle(v);
      w = Math.min(760, v.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    }
    return Math.max(260, Math.min(900, (w || 340) - 2));
  }
  function niceStep(range) {
    if (!(range > 0)) return 1;
    var raw = range / 4, p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
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

  // opts: { series: [{ pts: [{x, y, tip, id}], cls, dots, hollow }],
  //         bands: [{ lo, hi }], fmtY, width, still (print), onOpen(id),
  //         marks: [{ x, kind "sy"|"dose", lvl, tip }] (a strip under
  //         the plot: symptoms and doses taken) }
  function lineChart(host, opts) {
    var wrap = el("div", "chart");
    host.appendChild(wrap);
    var marks = opts.marks || [];
    var W = opts.width || chartWidth(host), H = (opts.height || 200) + (marks.length ? 20 : 0), L = 46, R = 14, T = 14, B = marks.length ? 46 : 26;
    var svg = sv("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img" }, null);
    if (opts.label) svg.setAttribute("aria-label", opts.label);
    wrap.appendChild(svg);
    var all = [];
    opts.series.forEach(function (s) { all = all.concat(s.pts); });
    var minX = Infinity, maxX = -Infinity, lo = Infinity, hi = -Infinity;
    all.forEach(function (p) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); });
    if (opts.xFrom !== undefined) minX = Math.min(minX, opts.xFrom);
    if (opts.xTo !== undefined) maxX = Math.max(maxX, opts.xTo);
    if (maxX === minX) { minX -= DAY_MS; maxX += DAY_MS; }
    var pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.05 || 1;
    var step = niceStep(hi - lo + 2 * pad);
    var y0 = Math.floor((lo - pad) / step) * step, y1 = Math.ceil((hi + pad) / step) * step;
    if (lo >= 0 && y0 < 0) y0 = 0;
    if (y1 <= y0) y1 = y0 + step;
    var X = function (x) { return L + (W - L - R) * (x - minX) / (maxX - minX); };
    var Y = function (y) { return T + (H - T - B) * (1 - (y - y0) / (y1 - y0)); };
    (opts.bands || []).forEach(function (b) {
      var top = b.hi === null || b.hi === undefined ? y1 : Math.min(y1, b.hi);
      var bot = b.lo === null || b.lo === undefined ? y0 : Math.max(y0, b.lo);
      if (top <= bot) return;
      sv("rect", { x: L, width: W - L - R, y: Y(top), height: Y(bot) - Y(top), "class": "band" + (b.cls ? " " + b.cls : "") }, svg);
    });
    var dec = step < 1 ? (step < 0.1 ? 2 : 1) : 0;
    for (var gv = y0; gv <= y1 + step / 2; gv += step) {
      var gy = Y(gv);
      sv("line", { x1: L, x2: W - R, y1: gy, y2: gy, "class": "grid" }, svg);
      sv("text", { x: L - 6, y: gy + 4, "text-anchor": "end", "class": "ax" }, svg).textContent = fmtNum(gv, dec);
    }
    [[minX, "start"], [maxX, "end"]].forEach(function (a) {
      var d = new Date(a[0]);
      sv("text", { x: a[1] === "start" ? L : W - R, y: H - 6, "text-anchor": a[1], "class": "ax" }, svg)
        .textContent = d.getDate() + "/" + (d.getMonth() + 1) + (opts.years ? "/" + String(d.getFullYear()).slice(2) : "");
    });
    marks.forEach(function (mk) {
      if (mk.x < minX || mk.x > maxX) return;
      var g = mk.kind === "sy"
        ? sv("circle", { cx: X(mk.x), cy: H - 36, r: 4, "class": "mk-sy l" + mk.lvl }, svg)
        : sv("rect", { x: X(mk.x) - 1, y: H - 28, width: 2, height: 9, "class": "mk-dose" }, svg);
      sv("title", {}, g).textContent = mk.tip;
    });
    opts.series.forEach(function (s) {
      if (!s.pts.length) return;
      if (s.line !== false && s.pts.length > 1) {
        var path = s.pts.map(function (p, i) { return (i ? "L" : "M") + X(p.x).toFixed(1) + " " + Y(p.y).toFixed(1); }).join(" ");
        sv("path", { d: path, "class": "line " + (s.cls || "") }, svg);
      }
      if (s.dots !== false && (s.pts.length <= 60 || s.hollow)) {
        s.pts.forEach(function (p) {
          sv("circle", { cx: X(p.x), cy: Y(p.y), r: s.hollow ? 4 : 3.5, "class": "dot " + (s.cls || "") + (s.hollow ? " hollow" : "") }, svg);
        });
      }
    });
    if (opts.still) return wrap;
    var cross = sv("line", { y1: T, y2: H - B, "class": "cross", visibility: "hidden" }, svg);
    var hot = sv("circle", { r: 6, "class": "hot", visibility: "hidden" }, svg);
    var tip = tipLayer(wrap), cur = null;
    var picks = [];
    opts.series.forEach(function (s) { if (s.tipOk !== false) picks = picks.concat(s.pts); });
    function at(ev) {
      var r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) * (W / r.width), best = null;
      picks.forEach(function (p) { if (!best || Math.abs(X(p.x) - x) < Math.abs(X(best.x) - x)) best = p; });
      return best;
    }
    function show(p) {
      cur = p;
      cross.setAttribute("x1", X(p.x)); cross.setAttribute("x2", X(p.x)); cross.setAttribute("visibility", "visible");
      hot.setAttribute("cx", X(p.x)); hot.setAttribute("cy", Y(p.y)); hot.setAttribute("visibility", "visible");
      var scale = wrap.clientWidth / W || 1;
      tip(p.tip, X(p.x) * scale, Y(p.y) * scale);
    }
    function hide() { cur = null; cross.setAttribute("visibility", "hidden"); hot.setAttribute("visibility", "hidden"); tip(null); }
    svg.addEventListener("pointermove", function (ev) { if (ev.pointerType === "mouse") { var p = at(ev); if (p) show(p); } });
    svg.addEventListener("pointerleave", function (ev) { if (ev.pointerType === "mouse") hide(); });
    svg.addEventListener("click", function (ev) {
      var p = at(ev);
      if (!p) return;
      if ((ev.pointerType === "mouse" || p === cur) && opts.onOpen && p.id) opts.onOpen(p.id);
      else show(p);
    });
    return wrap;
  }

  // Bars per night (sleep). bars: [{ x, y, tip, id }]
  function barChart(host, opts) {
    var wrap = el("div", "chart");
    host.appendChild(wrap);
    var bars = opts.bars;
    var W = opts.width || chartWidth(host), H = 170, L = 34, R = 8, T = 14, B = 24;
    var svg = sv("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img" }, null);
    if (opts.label) svg.setAttribute("aria-label", opts.label);
    wrap.appendChild(svg);
    var max = 0;
    bars.forEach(function (b) { max = Math.max(max, b.y); });
    max = Math.max(10, Math.ceil(max / 2) * 2);
    var Y = function (v) { return T + (H - T - B) * (1 - v / max); };
    (opts.bands || []).forEach(function (b) {
      sv("rect", { x: L, width: W - L - R, y: Y(Math.min(max, b.hi)), height: Y(b.lo) - Y(Math.min(max, b.hi)), "class": "band" }, svg);
    });
    for (var gv = 0; gv <= max; gv += max > 12 ? 4 : 2) {
      sv("line", { x1: L, x2: W - R, y1: Y(gv), y2: Y(gv), "class": "grid" }, svg);
      sv("text", { x: L - 6, y: Y(gv) + 4, "text-anchor": "end", "class": "ax" }, svg).textContent = String(gv);
    }
    var slot = (W - L - R) / Math.max(1, bars.length), bw = Math.max(1.5, Math.min(26, slot - 2));
    var tip = opts.still ? null : tipLayer(wrap);
    bars.forEach(function (b, i) {
      var x = L + slot * i + (slot - bw) / 2;
      var r = sv("rect", { x: x, width: bw, y: Y(b.y), height: Math.max(1, Y(0) - Y(b.y)), rx: Math.min(3, bw / 3), "class": "bar" }, svg);
      if (tip) {
        r.addEventListener("pointerenter", function () { tip(b.tip, (x + bw / 2) * (wrap.clientWidth / W || 1), Y(b.y)); });
        r.addEventListener("pointerleave", function () { tip(null); });
        r.addEventListener("click", function () {
          if (opts.onOpen && b.id) opts.onOpen(b.id);
        });
      }
    });
    if (bars.length) {
      [[bars[0].x, "start"], [bars[bars.length - 1].x, "end"]].forEach(function (a) {
        var d = new Date(a[0]);
        sv("text", { x: a[1] === "start" ? L : W - R, y: H - 6, "text-anchor": a[1], "class": "ax" }, svg).textContent = d.getDate() + "/" + (d.getMonth() + 1);
      });
    }
    return wrap;
  }

  function periodStart(p) {
    if (p === "all") return -Infinity;
    return startOfDay(Date.now()) - (Number(p) - 1) * DAY_MS;
  }
  function tipOf(e) { return fmtDate(e.at, false) + " " + hm(new Date(e.at)) + " · " + fmtValue(e); }

  // The range that is green on the cards, in display units, for the
  // band behind a chart. Own target first.
  function bandsFor(tid, ctx) {
    var ty = C.typeRow(data, tid), set = settings(), k0 = slotKind(tid, 0);
    function d(v) { return v === null ? null : toDisp(k0, v); }
    if (hasOwnTarget(tid)) {
      if (tid === "bp") return [{ lo: ty.lo, hi: ty.hi }, { lo: ty.lo2, hi: ty.hi2, cls: "b2" }].filter(function (b) { return b.lo !== null || b.hi !== null; });
      return [{ lo: d(ty.lo), hi: d(ty.hi) }];
    }
    switch (tid) {
      case "bp": return [{ lo: 90, hi: 129 }, { lo: 60, hi: 84, cls: "b2" }];
      case "gl": return [{ lo: d(700), hi: d(ctx === 1 || ctx === 2 ? 990 : 1390) }];
      case "wt":
        if (!set.h) return [];
        var m = set.h / 1000;
        return [{ lo: toDisp("w", 18.5 * m * m * 1000), hi: toDisp("w", 24.9 * m * m * 1000) }];
      case "sl": return [{ lo: 7, hi: 9 }];
      case "hr": return [{ lo: 50, hi: 100 }];
      case "tp": return [{ lo: d(3500), hi: d(3740) }];
      case "o2": return [{ lo: 95, hi: 100 }];
    }
    return [];
  }

  function statGrid(items) {
    var g = el("div", "stats");
    items.forEach(function (it) {
      if (!it) return;
      var c = el("div", "stat");
      c.appendChild(el("span", "stat-l", it[0]));
      c.appendChild(el("b", "stat-v", it[1]));
      g.appendChild(c);
    });
    return g;
  }
  // Summary numbers of one kind over a list of readings (shared by the
  // Charts tab and the report).
  function summaryItems(tid, list) {
    var items = [], k0 = slotKind(tid, 0), dec = decOf(k0, tid), u = unitOf(tid);
    var fmt = function (v) { return fmtNum(toDisp(k0, v), dec); };
    if (tid === "bp") {
      var s = C.stats(list.map(function (e) { return e.v[0]; })), di = C.stats(list.map(function (e) { return e.v[1]; }));
      items.push([t("ch.avg"), Math.round(s.avg) + "/" + Math.round(di.avg) + " mmHg"]);
      items.push([t("ch.max"), s.max + "/" + di.max]);
      items.push([t("ch.min"), s.min + "/" + di.min]);
      var sp = C.bpSplit(list);
      if (sp.am) items.push([t("ch.am") + " (" + sp.am.n + ")", Math.round(sp.am.s) + "/" + Math.round(sp.am.d)]);
      if (sp.pm) items.push([t("ch.pm") + " (" + sp.pm.n + ")", Math.round(sp.pm.s) + "/" + Math.round(sp.pm.d)]);
      var pl = C.stats(list.filter(function (e) { return e.v[2]; }).map(function (e) { return e.v[2]; }));
      if (pl) items.push([t("ch.pulse"), Math.round(pl.avg) + " " + t("u.bpm")]);
    } else if (tid === "sl") {
      var sl = C.stats(list.map(function (e) { return e.v[0]; }));
      items.push([t("ch.avg"), fmtDur(Math.round(sl.avg))]);
      items.push([t("ch.min"), fmtDur(sl.min)]);
      items.push([t("ch.max"), fmtDur(sl.max)]);
      var q = C.stats(list.filter(function (e) { return e.v[1]; }).map(function (e) { return e.v[1]; }));
      if (q) items.push([t("ch.quality"), fmtNum(q.avg, 1) + "/5"]);
    } else {
      var st = C.stats(list.map(function (e) { return e.v[0]; }));
      var uu = u ? " " + u : "";
      items.push([t("ch.avg"), fmt(st.avg) + uu]);
      items.push([t("ch.min"), fmt(st.min) + uu]);
      items.push([t("ch.max"), fmt(st.max) + uu]);
      if (tid === "wt" && list.length > 1) {
        var ch = list[list.length - 1].v[0] - list[0].v[0];
        items.push([t("ch.change"), (ch > 0 ? "+" : "") + fmt(ch) + uu]);
        var b = C.bmi(list[list.length - 1].v[0], settings().h);
        if (b) items.push([t("ch.bmi"), fmtNum(b, 1)]);
      }
      if (tid === "gl") {
        var by = C.glucoseByCtx(list);
        Object.keys(by).sort().forEach(function (c) {
          items.push([t("ctx." + c) + " (" + by[c].n + ")", fmt(by[c].avg) + uu]);
        });
      }
    }
    var tt = C.timeInTarget(data, list);
    if (tt !== null) items.push([t("ch.inTarget"), Math.round(tt * 100) + "%"]);
    items.push([t("ch.n"), String(list.length)]);
    return items;
  }

  // Draw the chart of one kind into host. still = no interaction
  // (report); returns false when there is nothing to draw.
  function drawKind(host, tid, list, opt) {
    opt = opt || {};
    var k0 = slotKind(tid, 0), label = typeName(tid);
    var openFn = opt.still ? null : function (id) { var r = findRow("en", id); if (r) entryDialog(r.t, r); };
    if (tid === "sl") {
      if (!list.length) return false;
      barChart(host, {
        bars: list.map(function (e) { return { x: e.at, y: e.v[0] / 60, tip: fmtDate(e.at, true) + " · " + fmtDur(e.v[0]), id: e.id }; }),
        bands: bandsFor("sl"), width: opt.width, still: opt.still, label: label, onOpen: openFn
      });
      return true;
    }
    if (list.length < 2) return false;
    var series = [];
    if (tid === "bp") {
      series.push({ cls: "s1", pts: list.map(function (e) { return { x: e.at, y: e.v[0], tip: tipOf(e), id: e.id }; }) });
      series.push({ cls: "s2", pts: list.map(function (e) { return { x: e.at, y: e.v[1], tip: tipOf(e), id: e.id }; }) });
    } else {
      var own = list.filter(function (e) { return !e.src; }), fit = list.filter(function (e) { return e.src; });
      var pt = function (e) { return { x: e.at, y: toDisp(k0, e.v[0]), tip: tipOf(e) + (e.src ? " · " + t("home.fromFit") : ""), id: e.src ? null : e.id }; };
      if (tid === "wt" && list.length >= 7) {
        series.push({ cls: "avg", dots: false, tipOk: false, pts: C.movingAvg(list.map(pt), 7) });
      }
      series.push({ cls: "s1", pts: own.map(pt) });
      if (fit.length) series.push({ cls: "s1", line: false, hollow: true, pts: fit.map(pt) });
    }
    lineChart(host, {
      series: series, bands: bandsFor(tid, opt.ctx), width: opt.width, still: opt.still, label: label,
      years: opt.years, onOpen: openFn, marks: opt.marks
    });
    return true;
  }

  // The kind picker: measurements, then symptoms (those logged, and
  // the one asked for).
  function chartPicker(cur) {
    var pick = select(visibleTypes().map(function (k) { return [k.id, typeName(k.id)]; }), "");
    var used = {};
    symptoms("").forEach(function (e) { used[e.k] = 1; });
    var sk = visibleSymKinds().filter(function (k) { return used[k.id] || "sy-" + k.id === cur; });
    if (sk.length) {
      var og = document.createElement("optgroup");
      og.label = t("sy.card");
      sk.forEach(function (k) {
        var o = el("option", "", symName(k.id));
        o.value = "sy-" + k.id;
        og.appendChild(o);
      });
      pick.appendChild(og);
    }
    pick.value = cur;
    return pick;
  }
  function renderCharts(v) {
    setTitle(t("tab.charts"));
    var kinds = visibleTypes();
    var symK = /^sy-/.test(prefs.ct) ? prefs.ct.slice(3) : "";
    var symOk = symK && C.symKindRow(data, symK) && !C.symKindRow(data, symK).h;
    if (!symOk && !kinds.some(function (k) { return k.id === prefs.ct; })) { prefs.ct = kinds.length ? kinds[0].id : "bp"; symK = ""; }
    var tid = prefs.ct;
    var top = section(null);
    var pick = chartPicker(tid);
    pick.className = "kind-pick";
    pick.setAttribute("aria-label", t("rp.kinds"));
    pick.addEventListener("change", function () { prefs.ct = pick.value; savePrefs(); render(); });
    var head = el("div", "ch-head");
    head.appendChild(pick);
    if (symK) {
      head.appendChild(iconBtn("icon-btn", UI.plus, t("home.add") + ": " + symName(symK), function () { symDialog(null, symK); }));
      if (!C.isSymBuiltin(symK)) head.appendChild(iconBtn("icon-btn", UI.edit, t("ch.kind", { n: symName(symK) }), function () { symKindDialog(symK, null); }));
      top.appendChild(head);
      top.appendChild(chips(PERIODS.map(function (p) { return [p, t("ch.period." + p)]; }), prefs.cp, function (p) {
        prefs.cp = p; savePrefs(); render();
      }, t("rp.from")));
      v.appendChild(top);
      renderSymChart(v, symK);
      return;
    }
    head.appendChild(iconBtn("icon-btn", UI.plus, t("home.add") + ": " + typeName(tid), function () { entryDialog(tid, null); }));
    head.appendChild(iconBtn("icon-btn", UI.edit, t("ch.kind", { n: typeName(tid) }), function () { kindDialog(tid); }));
    top.appendChild(head);
    top.appendChild(chips(PERIODS.map(function (p) { return [p, t("ch.period." + p)]; }), prefs.cp, function (p) {
      prefs.cp = p; savePrefs(); render();
    }, t("rp.from")));
    if (tid === "gl") {
      top.appendChild(chips([[-1, t("ch.ctxAll")]].concat(C.CTX.map(function (x, i) { return [i, t("ctx." + i)]; })), prefs.cc, function (c) {
        prefs.cc = c; savePrefs(); render();
      }, t("e.ctx")));
    }
    v.appendChild(top);
    var from = periodStart(prefs.cp);
    var list = readings(tid, true).filter(function (e) { return e.at >= from; });
    if (tid === "gl" && prefs.cc >= 0) list = list.filter(function (e) { return e.c === prefs.cc; });
    var cs = section(null);
    if (!list.length) { cs.appendChild(hint(t("ch.none"))); v.appendChild(cs); return; }
    var canMark = tid !== "sl" && list.length > 1 && (data.sy.length || data.dl.some(function (l) { return l.s === "t"; }));
    var marks = canMark && prefs.cm ? chartMarks(list[0].at, Date.now() + 60000) : null;
    if (!drawKind(cs, tid, list, { ctx: prefs.cc, years: prefs.cp === "all" || prefs.cp === "365", marks: marks })) cs.appendChild(hint(t("ch.one")));
    else {
      var notes = [];
      if (bandsFor(tid, prefs.cc).length) notes.push(t("ch.band"));
      if (list.some(function (e) { return e.src; })) notes.push(t("ch.fitDots"));
      if (marks && marks.length) notes.push(t("ch.marksHint"));
      if (notes.length) cs.appendChild(hint(notes.join(" · ")));
    }
    if (canMark) {
      var mw = el("label", "chk");
      var mc = el("input");
      mc.type = "checkbox";
      mc.checked = !!prefs.cm;
      mc.addEventListener("change", function () { prefs.cm = mc.checked ? 1 : 0; savePrefs(); render(); });
      mw.appendChild(mc);
      mw.appendChild(el("span", "", t("ch.marks")));
      cs.appendChild(mw);
    }
    cs.appendChild(statGrid(summaryItems(tid, list)));
    cs.appendChild(tableFor(list.slice().reverse()));
    v.appendChild(cs);
  }
  // One symptom over time: intensity 1–10, its numbers and a table.
  function renderSymChart(v, k) {
    var from = periodStart(prefs.cp);
    var list = symptoms(k).filter(function (e) { return e.at >= from; });
    var cs = section(null);
    if (!list.length) { cs.appendChild(hint(t("ch.none"))); v.appendChild(cs); return; }
    if (list.length > 1) {
      lineChart(cs, {
        series: [{ cls: "s1", pts: list.map(function (e) {
          return { x: e.at, y: e.i, id: e.id, tip: fmtDate(e.at, false) + " " + hm(new Date(e.at)) + " · " + e.i + "/10" };
        }) }],
        label: symName(k), years: prefs.cp === "all" || prefs.cp === "365",
        onOpen: function (id) { var e = findRow("sy", id); if (e) symDialog(e, null); }
      });
    } else cs.appendChild(hint(t("ch.one")));
    cs.appendChild(statGrid(symSummary(list)));
    var det = el("details", "tbl");
    det.appendChild(el("summary", "", t("ch.table")));
    det.appendChild(symTable(list.slice().reverse(), true, false));
    cs.appendChild(det);
    v.appendChild(cs);
  }
  function symSummary(list) {
    var st = C.stats(list.map(function (e) { return e.i; })), days = {};
    list.forEach(function (e) { days[ymd(new Date(e.at))] = 1; });
    return [[t("sy.avg"), fmtNum(st.avg, 1) + "/10"], [t("sy.max"), st.max + "/10"],
            [t("sy.days"), String(Object.keys(days).length)], [t("ch.n"), String(list.length)]];
  }
  function symTable(list, withNotes, withName) {
    var tb = el("table"), tr = el("tr");
    [t("rp.col.date"), t("rp.col.time")].concat(withName ? [t("rp.col.sym")] : []).concat([t("rp.col.int")])
      .concat(withNotes ? [t("rp.col.note")] : []).forEach(function (h) { tr.appendChild(el("th", "", h)); });
    tb.appendChild(tr);
    list.forEach(function (e) {
      var row = el("tr");
      [fmtDate(e.at, false), hm(new Date(e.at))].concat(withName ? [symName(e.k)] : []).concat([e.i + "/10"])
        .forEach(function (c) { row.appendChild(el("td", "", c)); });
      if (withNotes) row.appendChild(el("td", "", [e.g.join(", "), e.n].filter(Boolean).join(" · ")));
      tb.appendChild(row);
    });
    return tb;
  }
  function tableFor(list) {
    var det = el("details", "tbl");
    det.appendChild(el("summary", "", t("ch.table")));
    det.appendChild(readingsTable(list, true));
    return det;
  }
  function readingsTable(list, withNotes) {
    var tb = el("table");
    var tr = el("tr");
    [t("rp.col.date"), t("rp.col.time"), t("rp.col.value"), t("rp.col.details"), t("rp.col.status")]
      .concat(withNotes ? [t("rp.col.note")] : []).forEach(function (h) { tr.appendChild(el("th", "", h)); });
    tb.appendChild(tr);
    list.forEach(function (e) {
      var row = el("tr"), lv = C.classify(data, e);
      [fmtDate(e.at, false), hm(new Date(e.at)), fmtValue(e), fmtDetails(e)].forEach(function (c) { row.appendChild(el("td", "", c)); });
      var st = el("td", lv ? "st-" + lv : "", levelText(e, lv));
      row.appendChild(st);
      if (withNotes) row.appendChild(el("td", "", [e.g.join(", "), e.n].filter(Boolean).join(" · ")));
      tb.appendChild(row);
    });
    return tb;
  }

  // ---------- 9. Report for the doctor (print) + CSV ----------
  var rpFrom = null, rpTo = null;
  function renderReport(v) {
    setTitle(t("rp.title"));
    var s = section(null);
    s.appendChild(hint(t("rp.intro")));
    var today = ymd(new Date());
    if (!rpTo) rpTo = today;
    if (!rpFrom) rpFrom = ymd(new Date(startOfDay(Date.now()) - (prefs.rd - 1) * DAY_MS));
    s.appendChild(chips([30, 90, 365].map(function (d) { return [d, t("ch.period." + d)]; }), rpTo === today && rpFrom === ymd(new Date(startOfDay(Date.now()) - (prefs.rd - 1) * DAY_MS)) ? prefs.rd : 0, function (d) {
      prefs.rd = d; savePrefs();
      rpTo = today;
      rpFrom = ymd(new Date(startOfDay(Date.now()) - (d - 1) * DAY_MS));
      render();
    }, t("rp.from")));
    var r2 = el("div", "row2");
    var fi = input("date", rpFrom), ti = input("date", rpTo);
    fi.max = today; ti.max = today;
    fi.addEventListener("change", function () { if (parseYmd(fi.value)) { rpFrom = fi.value; render(); } });
    ti.addEventListener("change", function () { if (parseYmd(ti.value)) { rpTo = ti.value; render(); } });
    r2.appendChild(field(t("rp.from"), fi));
    r2.appendChild(field(t("rp.to"), ti));
    s.appendChild(r2);
    v.appendChild(s);

    var from = parseYmd(rpFrom).getTime(), to = parseYmd(rpTo).getTime() + DAY_MS;
    if (from > to - DAY_MS) { var x = from; from = to - DAY_MS; to = x + DAY_MS; }
    var ks = section(t("rp.kinds"));
    var present = visibleTypes().filter(function (ty) {
      return readings(ty.id, true).some(function (e) { return e.at >= from && e.at < to; });
    });
    var meds = medsIn(from, to), syms = symptoms("").filter(function (e) { return e.at >= from && e.at < to; });
    if (!present.length && !meds.length && !syms.length) { ks.appendChild(hint(t("rp.none"))); v.appendChild(ks); return; }
    var chosen = {};
    present.forEach(function (ty) { chosen[ty.id] = !prefs.rx || prefs.rx.indexOf(ty.id) < 0; });
    present.forEach(function (ty) {
      var w = el("label", "chk");
      var c = el("input");
      c.type = "checkbox";
      c.checked = chosen[ty.id];
      c.addEventListener("change", function () {
        chosen[ty.id] = c.checked;
        var rx = (prefs.rx || []).filter(function (id) { return id !== ty.id; });
        if (!c.checked) rx.push(ty.id);
        prefs.rx = rx;
        savePrefs();
      });
      w.appendChild(c);
      w.appendChild(el("span", "", typeName(ty.id) + " (" + readings(ty.id, true).filter(function (e) { return e.at >= from && e.at < to; }).length + ")"));
      ks.appendChild(w);
    });
    function flag(key, label) {
      var w = el("label", "chk"), c = el("input");
      c.type = "checkbox";
      c.checked = !!prefs[key];
      c.addEventListener("change", function () { prefs[key] = c.checked ? 1 : 0; savePrefs(); });
      w.appendChild(c);
      w.appendChild(el("span", "", label));
      ks.appendChild(w);
    }
    if (meds.length) flag("rm", t("rp.meds"));
    if (syms.length) flag("rs", t("rp.syms", { n: syms.length }));
    var nw = el("label", "chk");
    var nc = el("input");
    nc.type = "checkbox";
    nc.checked = !!prefs.rn;
    nc.addEventListener("change", function () { prefs.rn = nc.checked ? 1 : 0; savePrefs(); });
    nw.appendChild(nc);
    nw.appendChild(el("span", "", t("rp.notes")));
    ks.appendChild(nw);
    var nm = input("text", settings().nm);
    nm.maxLength = 60;
    nm.addEventListener("change", function () { if (nm.value.trim() !== settings().nm) editSettings({ nm: nm.value }); });
    ks.appendChild(field(t("rp.name"), nm));
    var acts = el("div", "btn-col");
    acts.appendChild(txtBtn("wide-btn primary", UI.report, t("rp.print"), function () {
      if (nm.value.trim() !== settings().nm) editSettings({ nm: nm.value });
      printReport(present.filter(function (ty) { return chosen[ty.id]; }).map(function (ty) { return ty.id; }), from, to,
                  { meds: meds.length && prefs.rm ? meds : [], syms: syms.length && prefs.rs ? syms : [] });
    }));
    acts.appendChild(txtBtn("wide-btn", null, t("rp.csv"), function () {
      var ids = present.filter(function (ty) { return chosen[ty.id]; }).map(function (ty) { return ty.id; });
      var list = [], more = [];
      ids.forEach(function (id) { list = list.concat(readings(id, true).filter(function (e) { return e.at >= from && e.at < to; })); });
      list.sort(function (a, b) { return a.at - b.at; });
      if (syms.length && prefs.rs) more = more.concat(symCsvRows(syms));
      if (meds.length && prefs.rm) more = more.concat(doseCsvRows(meds, from, to));
      saveBlob(new Blob([buildCsv(list, more)], { type: "text/csv;charset=utf-8" }), stampName("csv"), "text/csv");
    }));
    ks.appendChild(acts);
    v.appendChild(ks);
  }

  // A sheet built for paper: header, then per kind the summary, the
  // chart and the readings. The browser's print window offers PDF.
  function printReport(ids, from, to, extra) {
    extra = extra || { meds: [], syms: [] };
    if (!ids.length && !extra.meds.length && !extra.syms.length) return;
    var host = $("print");
    host.innerHTML = "";
    var set = settings();
    host.appendChild(el("h1", "", t("rp.heading") + (set.nm ? " · " + set.nm : "")));
    host.appendChild(el("p", "pr-sub", t("rp.period", { a: fmtDate(from, false), b: fmtDate(to - DAY_MS, false) })));
    host.appendChild(el("p", "pr-sub", t("rp.made", { d: fmtDate(Date.now(), false) })));
    ids.forEach(function (id) {
      var list = readings(id, true).filter(function (e) { return e.at >= from && e.at < to; });
      if (!list.length) return;
      var sec = el("section", "pr-kind");
      var u = unitOf(id);
      sec.appendChild(el("h2", "", typeName(id) + (u && id !== "sl" ? " (" + u + ")" : "")));
      var sum = el("p", "pr-sum");
      sum.textContent = summaryItems(id, list).map(function (it) { return it[0] + ": " + it[1]; }).join(" · ");
      sec.appendChild(sum);
      drawKind(sec, id, list, { still: true, width: 680, years: to - from > 200 * DAY_MS });
      sec.appendChild(readingsTable(list, !!prefs.rn));
      host.appendChild(sec);
    });
    if (extra.meds.length) host.appendChild(printMeds(extra.meds, from, to));
    if (extra.syms.length) host.appendChild(printSyms(extra.syms));
    host.appendChild(el("p", "pr-foot", t("rp.foot") + (extra.meds.length ? " " + t("rp.medFoot") : "")));
    setTimeout(function () { window.print(); }, 60);
  }

  // Medicines whose course overlaps [from, to) (stopped ones too).
  function medsIn(from, to) {
    var a = ymd(new Date(from)), b = ymd(new Date(to - DAY_MS));
    return data.md.filter(function (m) { return m.sd <= b && (!m.ed || m.ed >= a); })
      .sort(function (x, y) { return x.ar - y.ar || cmpStr(x.n.toLowerCase(), y.n.toLowerCase()); });
  }
  function courseText(m) {
    return fmtDate(parseYmd(m.sd).getTime(), false) + " – " + (m.ed ? fmtDate(parseYmd(m.ed).getTime(), false) : "");
  }
  function printMeds(meds, from, to) {
    var sec = el("section", "pr-kind");
    sec.appendChild(el("h2", "", t("rp.medsH")));
    var a = ymd(new Date(from)), b = ymd(new Date(to - DAY_MS)), now = Date.now();
    var all = C.adherence({ md: meds, dl: data.dl }, "", a, b, now);
    if (all.pct !== null) {
      sec.appendChild(el("p", "pr-sum", t("mh.all") + ": " + t("rp.adh", { p: Math.round(all.pct * 100), t: all.taken, n: all.n }) +
        " · " + t("mh.counts", { t: all.taken, s: all.skipped, m: all.missed })));
    }
    var tb = el("table"), tr = el("tr");
    [t("rp.col.med"), t("rp.col.dose"), t("rp.col.sched"), t("rp.col.taken"), t("rp.col.course")].forEach(function (h) { tr.appendChild(el("th", "", h)); });
    tb.appendChild(tr);
    meds.forEach(function (m) {
      var row = el("tr"), taken = "";
      var ad = C.adherence(data, m.id, a, b, now);
      if (ad.pct !== null) taken = t("rp.adh", { p: Math.round(ad.pct * 100), t: ad.taken, n: ad.n });
      var prn = C.prnTaken(data, m.id, from, to).length;
      if (prn) taken = (taken ? taken + " · " : "") + t("rp.prn", { n: prn });
      [medLabel(m) + (m.ar ? " (" + t("md.stoppedOn") + ")" : ""), t("f." + m.f) + " · " + doseText(m, m.q), schedText(m), taken, courseText(m)]
        .forEach(function (c) { row.appendChild(el("td", "", c)); });
      tb.appendChild(row);
    });
    sec.appendChild(tb);
    return sec;
  }
  function printSyms(list) {
    var sec = el("section", "pr-kind");
    sec.appendChild(el("h2", "", t("rp.symsH")));
    var byK = {};
    list.forEach(function (e) { (byK[e.k] = byK[e.k] || []).push(e); });
    Object.keys(byK).sort(function (x, y) { return cmpStr(symName(x).toLowerCase(), symName(y).toLowerCase()); }).forEach(function (k) {
      sec.appendChild(el("p", "pr-sum", symName(k) + ": " + symSummary(byK[k]).map(function (it) { return it[0] + " " + it[1]; }).join(" · ")));
    });
    sec.appendChild(symTable(list, !!prefs.rn, true));
    return sec;
  }
  function symCsvRows(list) {
    return list.map(function (e) {
      var d = new Date(e.at);
      return { at: e.at, cells: [ymd(d), hm(d), symName(e.k), e.i, "/10", "", "", "", "", e.n || "", e.g.join(", "), t("csv.sym")] };
    });
  }
  // Every dose of the period that counts (taken, skipped, missed) and
  // every as-needed dose, one row each.
  function doseCsvRows(meds, from, to) {
    var out = [], now = Date.now(), idx = C.logIndex(data), sub = { md: meds, dl: data.dl };
    var b = ymd(new Date(to - DAY_MS));
    for (var day = ymd(new Date(from)), g = 0; day <= b && g < 4000; day = C.ymdAdd(day, 1), g++) {
      C.dosesOn(sub, day, now, idx).forEach(function (r) {
        if (["taken", "skipped", "late", "missed"].indexOf(r.state) < 0 || (r.pre && !r.log)) return;
        var tk = r.state === "taken", when = tk ? new Date(r.log.ta) : new Date(r.at);
        out.push({ at: r.at, cells: [r.d, hmMin(r.tm), medLabel(r.med), tk ? fmtEdit(r.log.q / 100, 2) : "", unitWord(r.med.f, tk ? r.log.q : r.med.q),
          "", "", t("csv.sched", { t: hmMin(r.tm) }) + (tk ? " · " + t("st.taken", { t: hm(when) }) : ""),
          r.state === "taken" ? t("st.takenShort") : r.state === "skipped" ? t("st.skipped") : t("st.missed"), "", "", t("csv.med")] });
      });
    }
    meds.forEach(function (m) {
      C.prnTaken(data, m.id, from, to).forEach(function (l) {
        var d = new Date(l.ta);
        out.push({ at: l.ta, cells: [ymd(d), hm(d), medLabel(m), fmtEdit(l.q / 100, 2), unitWord(m.f, l.q), "", "", t("dd.prn"), t("st.takenShort"), "", "", t("csv.med")] });
      });
    });
    return out;
  }

  // ---------- 10. Kind dialog (targets, reminders, own kinds) ----------
  // tid = null → a new own kind.
  function kindDialog(tid) {
    var ty = tid ? C.typeRow(data, tid) : null;
    if (tid && !ty) { showToast(t("feed.gone")); return; }
    var custom = !tid || !C.isBuiltin(tid);
    var dlg = makeDialog("hl-kind", tid ? typeName(tid) : t("k.title.new"));
    var form = el("form");
    form.method = "dialog";
    form.noValidate = true;
    var f = {};
    if (custom) {
      f.n = input("text", ty ? ty.n : "");
      f.n.maxLength = C.NAME_LEN;
      form.appendChild(field(t("k.name"), f.n));
      var r1 = el("div", "row2");
      f.u = input("text", ty ? ty.u : "");
      f.u.maxLength = C.UNIT_LEN;
      f.dc = select([0, 1, 2, 3].map(function (d) { return [d, String(d)]; }), ty ? ty.dc : 1);
      r1.appendChild(field(t("k.unit"), f.u));
      r1.appendChild(field(t("k.dc"), f.dc));
      form.appendChild(r1);
    }
    // Targets, shown in the user's units.
    form.appendChild(el("div", "dlg-sub", t("k.targets")));
    var k0 = tid ? slotKind(tid, 0) : "k";
    var dcFor = function () { return tid ? decOf(k0, tid) : 3; };
    function tIn(v) {
      var s = v === null || v === undefined ? "" : fmtEdit(toDisp(k0, v), Math.max(dcFor(), k0 === "min" ? 1 : 0));
      return input("text", s, "decimal");
    }
    if (tid === "bp") {
      var b1 = el("div", "row2"), b2 = el("div", "row2");
      f.lo = tIn(ty.lo); f.hi = tIn(ty.hi); f.lo2 = tIn(ty.lo2); f.hi2 = tIn(ty.hi2);
      b1.appendChild(field(t("k.sysT") + " · " + t("k.lo"), f.lo));
      b1.appendChild(field(t("k.sysT") + " · " + t("k.hi"), f.hi));
      b2.appendChild(field(t("k.diaT") + " · " + t("k.lo"), f.lo2));
      b2.appendChild(field(t("k.diaT") + " · " + t("k.hi"), f.hi2));
      form.appendChild(b1);
      form.appendChild(b2);
    } else {
      var b3 = el("div", "row2");
      f.lo = tIn(ty ? ty.lo : null); f.hi = tIn(ty ? ty.hi : null);
      var u = tid ? unitOf(tid) : "";
      b3.appendChild(field(t("k.lo") + (u ? " · " + u : ""), f.lo));
      b3.appendChild(field(t("k.hi") + (u ? " · " + u : ""), f.hi));
      form.appendChild(b3);
    }
    form.appendChild(hint(t("k.targetsHint")));

    // Reminders
    form.appendChild(el("div", "dlg-sub", t("k.rem")));
    var remBox = el("div", "rem-list");
    form.appendChild(remBox);
    var rems = ty ? ty.r.slice() : [];
    var addRem = txtBtn("dlg-btn", UI.plus, t("k.remAdd"), function () {
      if (rems.length >= C.MAX_REM) return;
      rems.push(rems.length ? Math.min(1439, rems[rems.length - 1] + 12 * 60) % 1440 : 8 * 60);
      paintRems();
    });
    function paintRems() {
      remBox.innerHTML = "";
      rems.forEach(function (m, i) {
        var row = el("div", "rem-row");
        var ti = input("time", pad2(Math.floor(m / 60)) + ":" + pad2(m % 60));
        ti.setAttribute("aria-label", t("k.rem") + " " + (i + 1));
        ti.addEventListener("change", function () { var x = parseHm(ti.value); if (x >= 0) rems[i] = x; });
        row.appendChild(ti);
        row.appendChild(iconBtn("mini", UI.x, t("k.remDel"), function () { rems.splice(i, 1); paintRems(); }));
        remBox.appendChild(row);
      });
      addRem.disabled = rems.length >= C.MAX_REM;
    }
    paintRems();
    form.appendChild(addRem);
    form.appendChild(hint(t("k.remHint")));

    if (tid) {
      var hw = el("label", "chk");
      f.h = el("input");
      f.h.type = "checkbox";
      f.h.checked = !!ty.h;
      hw.appendChild(f.h);
      hw.appendChild(el("span", "", t("k.hide")));
      form.appendChild(hw);
    }
    var err = el("p", "err");
    err.setAttribute("role", "alert");
    form.appendChild(err);

    var acts = el("div", "dlg-actions");
    if (tid && custom) {
      acts.appendChild(iconBtn("dlg-btn icon danger", UI.trash, t("k.del"), function () {
        var cnt = data.en.filter(function (e) { return e.t === tid; }).length;
        dlg.close();
        confirmDialog(t("k.delAsk", { n: ty.n, c: cnt }), t("dlg.delete"), function () { deleteKind(tid); });
      }));
    }
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      err.textContent = "";
      var bad = false, patch = {};
      function tgt(inp) {
        var raw = inp.value.trim();
        if (!raw) { inp.classList.remove("bad"); return null; }
        var kk = tid ? k0 : "k";
        var x = fromDisp(kk, parseNum(raw, custom));
        var okv = !isNaN(x) && Math.abs(x) <= C.CUSTOM_MAX;
        inp.classList.toggle("bad", !okv);
        if (!okv) bad = true;
        return okv ? x : null;
      }
      patch.lo = tgt(f.lo); patch.hi = tgt(f.hi);
      if (f.lo2) { patch.lo2 = tgt(f.lo2); patch.hi2 = tgt(f.hi2); }
      if (custom) {
        patch.n = f.n.value;
        patch.u = f.u.value;
        patch.dc = Number(f.dc.value);
        var nm = f.n.value.trim().toLowerCase();
        f.n.classList.toggle("bad", !nm);
        if (!nm) bad = true;
        if (nm && data.ty.some(function (x) { return x.id !== tid && !C.isBuiltin(x.id) && x.n.toLowerCase() === nm; })) {
          f.n.classList.add("bad");
          err.textContent = t("k.dup");
          return;
        }
      }
      if (bad) { err.textContent = t("e.bad"); return; }
      patch.r = rems;
      if (f.h) patch.h = f.h.checked ? 1 : 0;
      var id = tid;
      if (!id) {
        id = "c" + newId();
        var row = { id: id, m: Date.now(), n: "", u: "", dc: 1, h: 0, lo: null, hi: null, lo2: null, hi2: null, r: [] };
        Object.keys(patch).forEach(function (k) { row[k] = patch[k]; });
        row.m = nextM("ty", id);
        var n = C.normType(row);
        if (!n) { err.textContent = t("e.bad"); return; }
        putRow("ty", n);
        saveNow();
        prefs.ct = id;
        savePrefs();
      } else if (!editType(id, patch)) { err.textContent = t("e.bad"); return; }
      dlg.close();
      render();
    });
    dlg.appendChild(form);
    openDialog(dlg);
  }
  // An own kind goes with its readings; Undo brings both back.
  function deleteKind(tid) {
    var ty = findRow("ty", tid);
    if (!ty) return;
    var gone = data.en.filter(function (e) { return e.t === tid; }).map(function (e) { return removeRow("en", e.id); });
    removeRow("ty", tid);
    saveNow();
    render();
    undoToast(t("k.deleted", { n: ty.n }), function () {
      restoreRow("ty", ty);
      gone.forEach(function (e) { if (e) restoreRow("en", e); });
      saveNow();
      render();
    });
  }

  // ---------- 10b. Medicines: today, list, history, dialogs ----------
  // Model and rules in core.js (normMed, dosesOn, adherence, stockOf,
  // lowStock). A scheduled dose's log row is keyed by its slot, so
  // marking it on two devices merges into one row.
  function rand36(n) {
    var r = new Uint32Array(2), s = "";
    crypto.getRandomValues(r);
    s = r[0].toString(36) + r[1].toString(36);
    return (s + "000000000").slice(0, n);
  }
  function newMedId() { return "m" + Date.now().toString(36) + rand36(5); }
  function hmMin(min) { return pad2(Math.floor(min / 60)) + ":" + pad2(min % 60); }
  function fmtQty(q) { return fmtNum(q / 100, 2); }
  function unitWord(f, q) { return t((q > 0 && q <= 100 ? "u1." : "un.") + f); }
  function doseText(med, q) { return fmtQty(q) + " " + unitWord(med.f, q); }
  function medLabel(med) { return med.n + (med.s ? " " + med.s : ""); }
  function dayList(wd) {
    var out = [];
    for (var i = 0; i < 7; i++) if (wd & (1 << i)) out.push(t("day." + i));
    return out.join(", ");
  }
  function schedText(med) {
    var parts = [];
    if (med.k === "p") parts.push(t("sch.p"));
    else {
      if (med.k === "d") parts.push(t("sch.d"));
      else if (med.k === "w") parts.push(med.wd === 127 ? t("sch.d") : dayList(med.wd));
      else parts.push(t("sch.every", { n: med.ev }));
      parts.push(med.tm.map(hmMin).join(", "));
    }
    var today = ymd(new Date());
    if (med.sd > today) parts.push(t("sch.from", { d: fmtDate(parseYmd(med.sd).getTime(), false) }));
    if (med.ed) parts.push(t("sch.until", { d: fmtDate(parseYmd(med.ed).getTime(), false) }));
    return parts.join(" · ");
  }
  function stateText(r) {
    var l = r.log;
    switch (r.state) {
      case "taken": return t("st.taken", { t: hm(new Date(l.ta)) });
      case "skipped": return t("st.skipped");
      case "snoozed": return t("st.snoozed", { t: hm(new Date(l.zu)) });
      case "due": return t("st.due");
      case "late": return t("st.late");
      case "missed": return t("st.missed");
    }
    return "";
  }
  function smallBtn(label, svg, fn, cls) {
    var b = txtBtn("sm-btn" + (cls ? " " + cls : ""), svg, label, fn);
    return b;
  }
  function daysText(n) { return n >= 2 ? t("days.n", { n: n }) : t("days." + n); }
  function lowIds() {
    var ids = {};
    C.lowStock(data, Date.now()).forEach(function (x) { ids[x.md] = x; });
    return ids;
  }
  function stockText(med) {
    var s = C.stockOf(data, med);
    if (s === null) return "";
    var left = fmtQty(Math.max(0, s)) + " " + unitWord(med.f, Math.max(0, s)), d = C.daysLeft(data, med);
    return d === null ? t("md.left", { left: left }) : t("md.leftDays", { left: left, d: daysText(d) });
  }

  function renderMeds(v) {
    setTitle(t("tab.meds"));
    var top = section(null);
    top.appendChild(chips([["today", t("mv.today")], ["list", t("mv.list")], ["hist", t("mv.hist")]], prefs.mv, function (x) {
      prefs.mv = x; savePrefs(); render();
    }, t("tab.meds")));
    v.appendChild(top);
    if (!data.md.length) {
      var e = section(null);
      e.appendChild(hint(t("md.none")));
      e.appendChild(txtBtn("wide-btn primary", UI.plus, t("md.add"), function () { medDialog(null); }));
      v.appendChild(e);
    } else if (prefs.mv === "list") renderMedList(v);
    else if (prefs.mv === "hist") renderMedHist(v);
    else renderMedToday(v);
    v.appendChild(el("p", "disclaimer", t("md.disclaimer")));
  }

  function lowBanner(lw) {
    var med = lw.med, b = el("div", "low-ban");
    var left = fmtQty(lw.left) + " " + unitWord(med.f, lw.left);
    b.appendChild(el("span", "", lw.left <= 0 ? t("low.out", { n: medLabel(med) })
      : lw.days === null ? t("low.textPrn", { n: medLabel(med), left: left })
      : t("low.text", { n: medLabel(med), left: left, d: daysText(lw.days) })));
    b.appendChild(smallBtn(t("md.refill", { n: fmtQty(med.pk) }), UI.plus, function () { refill(med); }, "primary"));
    return b;
  }

  function renderMedToday(v) {
    var now = Date.now(), today = ymd(new Date(now));
    var lows = C.lowStock(data, now);
    if (lows.length) {
      var ls = section(null);
      lows.forEach(function (lw) { ls.appendChild(lowBanner(lw)); });
      v.appendChild(ls);
    }
    var s = section(t("md.today", { d: fmtDate(now, true) }));
    var live = { dl: data.dl, md: data.md.filter(function (m) { return !m.ar; }) };
    var rows = C.dosesOn(live, today, now);
    if (!rows.length) s.appendChild(hint(t("md.noDoses")));
    rows.forEach(function (r) { s.appendChild(doseRow(r)); });
    v.appendChild(s);
    var prn = data.md.filter(function (m) { return !m.ar && m.k === "p" && today >= m.sd && (!m.ed || today <= m.ed); });
    if (prn.length) {
      var ps = section(t("md.prn"));
      prn.sort(function (a, b) { return cmpStr(a.n.toLowerCase(), b.n.toLowerCase()); });
      prn.forEach(function (m) { ps.appendChild(prnRow(m, now)); });
      v.appendChild(ps);
    }
    var add = section(null);
    add.appendChild(txtBtn("wide-btn", UI.plus, t("md.add"), function () { medDialog(null); }));
    v.appendChild(add);
  }

  function doseRow(r) {
    var st = r.state, row = el("div", "dose st-" + st);
    row.appendChild(el("span", "dose-time", hmMin(r.tm)));
    var mid = el("div", "dose-mid");
    var top = el("div", "dose-top");
    top.appendChild(el("b", "", medLabel(r.med)));
    var tx = stateText(r);
    if (tx) top.appendChild(el("span", "ds-badge ds-" + st, tx));
    mid.appendChild(top);
    mid.appendChild(el("small", "", doseText(r.med, r.log && r.log.s === "t" ? r.log.q : r.med.q)));
    var acts = el("div", "dose-acts");
    if (st === "taken" || st === "skipped") {
      acts.appendChild(smallBtn(t("ds.edit"), UI.edit, function () { doseDialog(r); }));
      acts.appendChild(smallBtn(t("ds.undo"), null, function () { unmarkDose(r); }));
    } else {
      acts.appendChild(smallBtn(t("ds.take"), UI.check, function () { markDose(r, "t", 0); }, "primary"));
      acts.appendChild(smallBtn(t("ds.skip"), null, function () { markDose(r, "s", 0); }));
      acts.appendChild(smallBtn(t("ds.snooze"), UI.clock, function () { snoozeDialog(r); }));
    }
    mid.appendChild(acts);
    row.appendChild(mid);
    return row;
  }

  function putDose(row) {
    var n = C.normDose(row);
    if (!n) return null;
    putRow("dl", n);
    saveNow();
    return n;
  }
  // Back to how it was before (a snooze, or nothing).
  function revertDose(key, prev) {
    if (prev) {
      prev.m = nextM("dl", key);
      putDose(prev);
    } else if (removeRow("dl", key)) saveNow();
    render();
  }
  function markDose(r, s, zu) {
    var prev = r.log ? JSON.parse(JSON.stringify(r.log)) : null;
    var now = Date.now();
    var n = putDose({ id: r.key, m: nextM("dl", r.key), md: r.md, d: r.d, tm: r.tm, s: s, ta: now, q: r.med.q, zu: zu || 0 });
    if (!n) return;
    render();
    var msg = s === "t" ? t("toast.taken", { n: r.med.n }) : s === "s" ? t("toast.skipped", { n: r.med.n })
      : t("toast.snoozed", { n: r.med.n, t: hm(new Date(zu)) });
    live(msg);
    undoToast(msg, function () { revertDose(r.key, prev); });
  }
  function unmarkDose(r) {
    var prev = r.log ? JSON.parse(JSON.stringify(r.log)) : null;
    if (!prev) return;
    removeRow("dl", r.key);
    saveNow();
    render();
    undoToast(t("ds.undo") + ": " + r.med.n, function () { revertDose(r.key, prev); });
  }
  function snoozeDialog(r) {
    var dlg = makeDialog("hl-snooze", medLabel(r.med));
    dlg.appendChild(el("p", "dlg-text", t("sn.title")));
    var col = el("div", "btn-col");
    [10, 30, 60].forEach(function (m) {
      col.appendChild(button(t("sn." + m), "", function () { dlg.close(); markDose(r, "z", Date.now() + m * 60000); }));
    });
    dlg.appendChild(col);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    openDialog(dlg);
  }

  function prnRow(med, now) {
    var start = startOfDay(now), list = C.prnTaken(data, med.id, start, start + DAY_MS);
    var row = el("div", "dose");
    row.appendChild(kindIcon("pill"));
    var mid = el("div", "dose-mid");
    var top = el("div", "dose-top");
    top.appendChild(el("b", "", medLabel(med)));
    mid.appendChild(top);
    var last = list[list.length - 1];
    mid.appendChild(el("small", "", doseText(med, med.q) + " · " +
      (last ? t("md.prnToday", { n: list.length, t: hm(new Date(last.ta)) }) : t("md.prnNone"))));
    var stock = stockText(med);
    if (stock) mid.appendChild(el("small", "", stock));
    var acts = el("div", "dose-acts");
    acts.appendChild(smallBtn(t("md.takeNow"), UI.check, function () { takePrn(med); }, "primary"));
    if (last) acts.appendChild(smallBtn(t("ds.edit"), UI.edit, function () { doseDialog({ prn: true, med: med, log: last, key: last.id }); }));
    mid.appendChild(acts);
    row.appendChild(mid);
    return row;
  }
  function takePrn(med) {
    var now = Date.now(), dy = ymd(new Date(now));
    var id = med.id + "-" + dy.replace(/-/g, "") + "-p" + rand36(6);
    if (!putDose({ id: id, m: nextM("dl", id), md: med.id, d: dy, tm: -1, s: "t", ta: now, q: med.q })) return;
    render();
    var msg = t("toast.taken", { n: med.n });
    live(msg);
    undoToast(msg, function () { if (removeRow("dl", id)) saveNow(); render(); });
  }
  function refill(med) {
    var now = Date.now(), id = "r" + newId();
    var n = C.normRefill({ id: id, m: now, md: med.id, at: now, a: med.pk });
    if (!n) return;
    putRow("rf", n);
    saveNow();
    render();
    var msg = t("md.refilled", { n: med.n, a: doseText(med, med.pk) });
    live(msg);
    undoToast(msg, function () { if (removeRow("rf", id)) saveNow(); render(); });
  }

  function renderMedList(v) {
    var now = Date.now(), lows = lowIds();
    var byName = function (a, b) { return cmpStr(a.n.toLowerCase(), b.n.toLowerCase()) || cmpStr(a.id, b.id); };
    var act = data.md.filter(function (m) { return !m.ar; }).sort(byName);
    var stop = data.md.filter(function (m) { return m.ar; }).sort(byName);
    var s = section(null);
    act.forEach(function (m) { s.appendChild(medCard(m, now, lows)); });
    s.appendChild(txtBtn("wide-btn", UI.plus, t("md.add"), function () { medDialog(null); }));
    v.appendChild(s);
    if (stop.length) {
      var s2 = section(t("md.stopped"));
      stop.forEach(function (m) { s2.appendChild(medCard(m, now, lows)); });
      v.appendChild(s2);
    }
  }
  function medCard(m, now, lows) {
    var c = el("div", "med-card" + (m.ar ? " off" : ""));
    var main = el("button", "med-main");
    main.type = "button";
    main.appendChild(el("b", "", medLabel(m)));
    main.appendChild(el("small", "", [t("f." + m.f), doseText(m, m.q), schedText(m)].join(" · ")));
    var st = stockText(m);
    if (st) main.appendChild(el("small", "med-stock" + (lows[m.id] ? " low" : ""), st));
    if (m.k !== "p" || (m.ps && m.ps.length)) {
      var today = ymd(new Date(now));
      var a = C.adherence(data, m.id, ymd(new Date(startOfDay(now) - 29 * DAY_MS)), today, now);
      if (a.pct !== null) main.appendChild(el("small", "", t("md.adh30", { p: Math.round(a.pct * 100) })));
    }
    if (m.nt) main.appendChild(el("small", "h-note", m.nt));
    main.addEventListener("click", function () { medDialog(m.id); });
    c.appendChild(main);
    if (C.stockOf(data, m) !== null && !m.ar) {
      var rb = smallBtn(t("md.refill", { n: fmtQty(m.pk) }), UI.plus, function () { refill(m); });
      c.appendChild(rb);
    }
    return c;
  }

  // History: adherence per medicine and every dose of the period,
  // newest day first. A row opens the dose dialog (mark it later,
  // change the time it was taken).
  function renderMedHist(v) {
    var now = Date.now(), today = ymd(new Date(now));
    var s = section(null);
    s.appendChild(chips([7, 30, 90].map(function (d) { return [d, t("ch.period." + d)]; }), prefs.mh, function (d) {
      prefs.mh = d; savePrefs(); render();
    }, t("rp.from")));
    var from = ymd(new Date(startOfDay(now) - (prefs.mh - 1) * DAY_MS));
    var items = [], all = C.adherence(data, "", from, today, now);
    var counted = data.md.filter(function (m) { return C.adherence(data, m.id, from, today, now).pct !== null; }).length;
    if (all.pct !== null && counted > 1) items.push([t("mh.all"), Math.round(all.pct * 100) + "%"]);
    data.md.slice().sort(function (a, b) { return cmpStr(a.n.toLowerCase(), b.n.toLowerCase()); }).forEach(function (m) {
      var a = C.adherence(data, m.id, from, today, now);
      if (a.pct !== null) items.push([medLabel(m), Math.round(a.pct * 100) + "%"]);
    });
    if (items.length) s.appendChild(statGrid(items));
    if (all.n) s.appendChild(hint(t("mh.counts", { t: all.taken, s: all.skipped, m: all.missed })));
    v.appendChild(s);
    var idx = C.logIndex(data), any = false, day = today;
    for (var i = 0; i < prefs.mh; i++, day = C.ymdAdd(day, -1)) {
      var rows = C.dosesOn(data, day, now, idx).filter(function (r) {
        return r.state !== "upcoming" && !(r.pre && !r.log);
      });
      var d0 = parseYmd(day).getTime();
      C.prnTaken(data, "", d0, d0 + DAY_MS).forEach(function (l) {
        var med = C.medById(data, l.md);
        if (med) rows.push({ prn: true, med: med, log: l, key: l.id, at: l.ta, tm: -1, state: "taken" });
      });
      if (!rows.length) continue;
      rows.sort(function (a, b) { return a.at - b.at; });
      any = true;
      var box = section(fmtDate(d0, true));
      rows.forEach(function (r) { box.appendChild(histDoseRow(r)); });
      v.appendChild(box);
    }
    if (!any) {
      var e = section(null);
      e.appendChild(hint(t("mh.none")));
      v.appendChild(e);
    }
  }
  function histDoseRow(r) {
    var row = el("button", "h-row");
    row.type = "button";
    row.addEventListener("click", function () { doseDialog(r); });
    row.appendChild(el("span", "h-time", r.prn ? hm(new Date(r.log.ta)) : hmMin(r.tm)));
    row.appendChild(kindIcon("pill"));
    var mid = el("span", "h-mid");
    var top = el("span", "h-top");
    top.appendChild(el("b", "", medLabel(r.med)));
    var tx = r.prn ? t("dd.prn") : stateText(r);
    if (tx) top.appendChild(el("span", "ds-badge ds-" + (r.prn ? "taken" : r.state), tx));
    mid.appendChild(top);
    mid.appendChild(el("small", "", doseText(r.med, r.log && r.log.s === "t" ? r.log.q : r.med.q)));
    row.appendChild(mid);
    return row;
  }

  // One dose: mark it taken / skipped / not marked, the time it was
  // taken and the amount. r: a dosesOn row, or { prn, med, log, key }.
  function doseDialog(r) {
    var med = C.medById(data, r.med.id), log = r.log ? findRow("dl", r.log.id) : null;
    if (!med) { showToast(t("feed.gone")); return; }
    var dlg = makeDialog("hl-dose", medLabel(med));
    var form = el("form");
    form.method = "dialog";
    form.noValidate = true;
    form.appendChild(hint(r.prn ? t("dd.prn") : t("dd.sched", { d: fmtDate(r.at, true), t: hmMin(r.tm) })));
    var stSel = null;
    if (!r.prn) {
      stSel = select([["t", t("st.takenShort")], ["s", t("st.skipped")], ["", t("dd.none")]], log && log.s !== "z" ? log.s : "t");
      form.appendChild(field(t("dd.status"), stSel));
    }
    var now = Date.now();
    var when = new Date(log && log.s === "t" ? log.ta : (r.at && r.at < now ? r.at : now));
    var tk = el("div", "");
    var r2 = el("div", "row2");
    var di = input("date", ymd(when)), ti = input("time", hm(when));
    di.max = ymd(new Date(now));
    r2.appendChild(field(t("e.date"), di));
    r2.appendChild(field(t("dd.when"), ti));
    tk.appendChild(r2);
    var q0 = log && log.s === "t" ? log.q : med.q;
    var qi = input("text", fmtEdit(q0 / 100, 2), "decimal");
    qi.className = "num";
    tk.appendChild(field(t("dd.amount", { u: unitWord(med.f, 200) }), qi));
    form.appendChild(tk);
    function paint() { tk.hidden = !!stSel && stSel.value !== "t"; }
    if (stSel) stSel.addEventListener("change", paint);
    paint();
    var err = el("p", "err");
    err.setAttribute("role", "alert");
    form.appendChild(err);
    var acts = el("div", "dlg-actions");
    if (r.prn && log) {
      acts.appendChild(iconBtn("dlg-btn icon danger", UI.trash, t("dd.delete"), function () {
        dlg.close();
        var gone = removeRow("dl", log.id);
        saveNow();
        render();
        undoToast(t("dd.delete"), function () { restoreRow("dl", gone); saveNow(); render(); });
      }));
    }
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      err.textContent = "";
      var s = stSel ? stSel.value : "t", id = log ? log.id : r.key;
      if (!s) {
        if (log && removeRow("dl", id)) saveNow();
        dlg.close();
        render();
        return;
      }
      var row = { id: id, m: nextM("dl", id), md: med.id, d: r.prn ? log.d : r.d, tm: r.prn ? -1 : r.tm, s: s, ta: Date.now(), q: med.q };
      if (s === "t") {
        var at = atOf(di.value, ti.value), q = Math.round(parseNum(qi.value) * 100);
        di.classList.toggle("bad", isNaN(at));
        ti.classList.toggle("bad", isNaN(at));
        qi.classList.toggle("bad", !(q >= 1 && q <= C.QTY_MAX));
        if (isNaN(at) || !(q >= 1 && q <= C.QTY_MAX)) { err.textContent = t("e.bad"); return; }
        row.ta = at;
        row.q = q;
      } else if (log && log.s === "s") row.ta = log.ta;
      if (!putDose(row)) { err.textContent = t("e.bad"); return; }
      dlg.close();
      render();
    });
    dlg.appendChild(form);
    openDialog(dlg);
  }

  // Add or edit a medicine. id = null → new.
  function medDialog(id) {
    var m = id ? C.medById(data, id) : null;
    if (id && !m) { showToast(t("feed.gone")); return; }
    var today = ymd(new Date());
    var dlg = makeDialog("hl-med", m ? medLabel(m) : t("mdl.new"));
    dlg.classList.add("wide");
    var form = el("form");
    form.method = "dialog";
    form.noValidate = true;
    var f = {};
    f.n = input("text", m ? m.n : "");
    f.n.maxLength = C.MED_NAME;
    form.appendChild(field(t("mdl.name"), f.n));
    var r1 = el("div", "row2");
    f.s = input("text", m ? m.s : "");
    f.s.maxLength = C.STRENGTH_LEN;
    f.s.placeholder = t("mdl.strengthHint");
    f.f = select(C.FORMS.map(function (x) { return [x, t("f." + x)]; }), m ? m.f : "tab");
    r1.appendChild(field(t("mdl.strength"), f.s));
    r1.appendChild(field(t("mdl.form"), f.f));
    form.appendChild(r1);
    var r2 = el("div", "row2");
    f.q = input("text", fmtEdit((m ? m.q : 100) / 100, 2), "decimal");
    var qFld = field("", f.q);
    r2.appendChild(qFld);
    f.k = select(C.SCHED.map(function (k) { return [k, t("sch." + k)]; }), m ? m.k : "d");
    r2.appendChild(field(t("mdl.sched"), f.k));
    form.appendChild(r2);

    var wd = m && m.k === "w" ? m.wd : 127;
    var wdWrap = el("div", "fld");
    wdWrap.appendChild(el("span", "fld-lbl", t("mdl.days")));
    var wdRow = el("div", "chips wd-chips");
    wdRow.setAttribute("role", "group");
    wdRow.setAttribute("aria-label", t("mdl.days"));
    for (var i = 0; i < 7; i++) {
      (function (i) {
        var b = el("button", "chip", t("day." + i));
        b.type = "button";
        var paintB = function () { var on = !!(wd & (1 << i)); b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false"); };
        b.addEventListener("click", function () { wd ^= (1 << i); paintB(); });
        paintB();
        wdRow.appendChild(b);
      })(i);
    }
    wdWrap.appendChild(wdRow);
    form.appendChild(wdWrap);
    f.ev = input("text", String(m && m.k === "n" ? m.ev : 2), "numeric");
    var evWrap = field(t("mdl.every"), f.ev);
    form.appendChild(evWrap);

    var tmWrap = el("div", "");
    tmWrap.appendChild(el("div", "dlg-sub", t("mdl.times")));
    var tmBox = el("div", "rem-list");
    tmWrap.appendChild(tmBox);
    var times = m && m.tm.length ? m.tm.slice() : [480];
    var addT = txtBtn("dlg-btn", UI.plus, t("mdl.timeAdd"), function () {
      if (times.length >= C.MAX_TIMES) return;
      times.push(times.length ? (times[times.length - 1] + 4 * 60) % 1440 : 480);
      paintTimes();
    });
    function paintTimes() {
      tmBox.innerHTML = "";
      times.forEach(function (mm, i) {
        var row = el("div", "rem-row");
        var ti = input("time", hmMin(mm));
        ti.setAttribute("aria-label", t("mdl.times") + " " + (i + 1));
        ti.addEventListener("change", function () { var x = parseHm(ti.value); if (x >= 0) times[i] = x; });
        row.appendChild(ti);
        row.appendChild(iconBtn("mini", UI.x, t("mdl.timeDel"), function () { times.splice(i, 1); paintTimes(); }));
        tmBox.appendChild(row);
      });
      addT.disabled = times.length >= C.MAX_TIMES;
    }
    paintTimes();
    tmWrap.appendChild(addT);
    var rmW = el("label", "chk");
    f.rm = el("input");
    f.rm.type = "checkbox";
    f.rm.checked = m ? !!m.rm : true;
    rmW.appendChild(f.rm);
    rmW.appendChild(el("span", "", t("mdl.remind")));
    tmWrap.appendChild(rmW);
    tmWrap.appendChild(hint(t("mdl.remHint")));
    form.appendChild(tmWrap);

    var r3 = el("div", "row2");
    f.sd = input("date", m ? m.sd : today);
    f.ed = input("date", m ? m.ed : "");
    r3.appendChild(field(t("mdl.start"), f.sd));
    r3.appendChild(field(t("mdl.end"), f.ed));
    form.appendChild(r3);

    var cur = m ? C.stockOf(data, m) : null;
    var tw = el("label", "chk");
    f.trk = el("input");
    f.trk.type = "checkbox";
    f.trk.checked = cur !== null;
    tw.appendChild(f.trk);
    tw.appendChild(el("span", "", t("mdl.stock")));
    form.appendChild(tw);
    var stockBox = el("div", "row3 stock-box");
    f.left = input("text", cur !== null ? fmtEdit(Math.max(0, cur) / 100, 2) : "", "decimal");
    f.pk = input("text", fmtEdit((m ? m.pk : 3000) / 100, 2), "decimal");
    f.rw = input("text", String(m ? m.rw : 7), "numeric");
    var leftFld = field("", f.left), pkFld = field("", f.pk);
    stockBox.appendChild(leftFld);
    stockBox.appendChild(pkFld);
    stockBox.appendChild(field(t("mdl.warn"), f.rw));
    form.appendChild(stockBox);

    f.nt = el("textarea");
    f.nt.rows = 2;
    f.nt.maxLength = C.NOTE_LEN;
    f.nt.value = m ? m.nt : "";
    form.appendChild(field(t("mdl.note"), f.nt));
    var err = el("p", "err");
    err.setAttribute("role", "alert");
    form.appendChild(err);

    function paint() {
      var k = f.k.value, u = unitWord(f.f.value, 200);
      wdWrap.hidden = k !== "w";
      evWrap.hidden = k !== "n";
      tmWrap.hidden = k === "p";
      stockBox.hidden = !f.trk.checked;
      qFld.querySelector(".fld-lbl").textContent = t("mdl.dose", { u: u });
      leftFld.querySelector(".fld-lbl").textContent = t("mdl.left", { u: u });
      pkFld.querySelector(".fld-lbl").textContent = t("mdl.pack", { u: u });
    }
    [f.k, f.f, f.trk].forEach(function (x) { x.addEventListener("change", paint); });
    paint();

    var acts = el("div", "dlg-actions");
    if (m) {
      acts.appendChild(iconBtn("dlg-btn icon danger", UI.trash, t("mdl.del"), function () {
        dlg.close();
        confirmDialog(t("mdl.delAsk", { n: m.n }), t("dlg.delete"), function () { deleteMed(m.id); });
      }));
      acts.appendChild(button(m.ar ? t("mdl.resume") : t("mdl.stop"), "", function () { dlg.close(); stopMed(m.id, !m.ar); }));
    }
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      err.textContent = "";
      var bad = false;
      function mark(inp, isBad) { inp.classList.toggle("bad", !!isBad); if (isBad) bad = true; }
      var k = f.k.value, q = Math.round(parseNum(f.q.value) * 100), ev2 = parseInt(f.ev.value, 10);
      mark(f.n, !f.n.value.trim());
      mark(f.q, !(q >= 1 && q <= C.QTY_MAX));
      mark(f.sd, !C.validYmd(f.sd.value));
      mark(f.ed, f.ed.value && (!C.validYmd(f.ed.value) || f.ed.value < f.sd.value));
      if (k === "n") mark(f.ev, !(ev2 >= 2 && ev2 <= 90 && /^\d+$/.test(f.ev.value.trim())));
      var sk = -1, sa = 0, pk = 3000, rw = 7;
      if (f.trk.checked) {
        var left = Math.round(parseNum(f.left.value) * 100);
        pk = Math.round(parseNum(f.pk.value) * 100);
        rw = parseInt(f.rw.value, 10);
        mark(f.left, !(left >= 0 && left <= C.STOCK_MAX));
        mark(f.pk, !(pk >= 1 && pk <= C.STOCK_MAX));
        mark(f.rw, !(rw >= 0 && rw <= 60 && /^\d+$/.test(f.rw.value.trim())));
        if (!bad) {
          if (m && m.sk >= 0 && left === Math.max(0, cur)) { sk = m.sk; sa = m.sa; }
          else { sk = left; sa = Date.now(); }
        }
      } else if (m) { pk = m.pk; rw = m.rw; }
      if (bad) { err.textContent = t("e.bad"); return; }
      if (k !== "p" && !times.length) { err.textContent = t("mdl.needTime"); return; }
      if (k === "w" && !wd) { err.textContent = t("mdl.needDay"); return; }
      var mid = m ? m.id : newMedId();
      var row = {
        id: mid, m: nextM("md", mid), n: f.n.value, s: f.s.value, f: f.f.value, q: q, k: k,
        tm: k === "p" ? [] : times, wd: wd, ev: k === "n" ? ev2 : 1, sd: f.sd.value, ed: f.ed.value,
        rm: f.rm.checked ? 1 : 0, sk: sk, sa: sa, pk: pk, rw: rw, ar: m ? m.ar : 0,
        ca: m ? m.ca : Date.now(), nt: f.nt.value
      };
      var n = C.normMed(row);
      if (!n) { err.textContent = t("e.bad"); return; }
      n.ps = C.withHistory(m, n, today);
      n = C.normMed(n);
      putRow("md", n);
      saveNow();
      dlg.close();
      if (!m && prefs.mv === "hist") { prefs.mv = "today"; savePrefs(); }
      render();
    });
    dlg.appendChild(form);
    openDialog(dlg);
    if (!m) setTimeout(function () { try { f.n.focus(); } catch (x) {} }, 30);
  }
  // Stop: the course ends today (kept in the history); again: no end.
  function stopMed(id, stop) {
    var m = C.medById(data, id);
    if (!m) return;
    var row = JSON.parse(JSON.stringify(m)), today = ymd(new Date());
    row.ar = stop ? 1 : 0;
    if (stop && (!row.ed || row.ed > today)) row.ed = row.sd > today ? "" : today;
    if (!stop && row.ed && row.ed < today) row.ed = "";
    row.m = nextM("md", id);
    var n = C.normMed(row);
    if (!n) return;
    putRow("md", n);
    saveNow();
    render();
  }
  // A medicine goes with its doses and refills; Undo brings all back.
  function deleteMed(id) {
    var m = findRow("md", id);
    if (!m) return;
    var doses = data.dl.filter(function (l) { return l.md === id; }).map(function (l) { return removeRow("dl", l.id); });
    var fills = data.rf.filter(function (r) { return r.md === id; }).map(function (r) { return removeRow("rf", r.id); });
    removeRow("md", id);
    saveNow();
    render();
    undoToast(t("mdl.deleted", { n: m.n }), function () {
      restoreRow("md", m);
      doses.forEach(function (l) { if (l) restoreRow("dl", l); });
      fills.forEach(function (r) { if (r) restoreRow("rf", r); });
      saveNow();
      render();
    });
  }

  // ---------- 10c. Symptoms ----------
  function symName(k) {
    if (C.isSymBuiltin(k)) return t("sy." + k);
    var r = C.symKindRow(data, k);
    return r ? r.n : "";
  }
  function visibleSymKinds() { return C.symKindList(data).filter(function (k) { return !k.h; }); }
  function symVisible(e) { var r = C.symKindRow(data, e.k); return !!(r && !r.h); }
  function symptoms(k) {
    return data.sy.filter(function (e) { return (!k || e.k === k) && symVisible(e); })
      .sort(function (x, y) { return x.at - y.at || cmpStr(x.id, y.id); });
  }
  function symText(e) { return symName(e.k) + " " + e.i + "/10"; }

  // e = null → a new symptom (kind k or the last used one), now.
  function symDialog(e, k) {
    var kinds = visibleSymKinds();
    if (e && !C.symKindRow(data, e.k)) { showToast(t("feed.gone")); return; }
    var last = symptoms("").pop();
    var kind = e ? e.k : (k || (last ? last.k : kinds.length ? kinds[0].id : "ha"));
    var dlg = makeDialog("hl-sym", e ? symName(e.k) : t("sy.new"));
    var form = el("form");
    form.method = "dialog";
    form.noValidate = true;
    var opts = kinds.map(function (x) { return [x.id, symName(x.id)]; });
    if (!opts.some(function (o) { return o[0] === kind; })) opts.unshift([kind, symName(kind)]);
    opts.push(["__new", t("sy.own")]);
    var ks = select(opts, kind);
    ks.addEventListener("change", function () {
      if (ks.value !== "__new") return;
      dlg.close();
      symKindDialog(null, function (nid) { symDialog(null, nid); });
    });
    form.appendChild(field(t("sy.kind"), ks));
    var iv = e ? e.i : 5;
    var lbl = el("span", "fld-lbl", t("sy.int", { n: iv }));
    var rg = input("range", String(iv));
    rg.min = "1"; rg.max = "10"; rg.step = "1";
    rg.className = "int-range";
    rg.setAttribute("aria-label", t("sy.intLbl"));
    rg.addEventListener("input", function () { lbl.textContent = t("sy.int", { n: rg.value }); });
    var iw = el("div", "fld");
    iw.appendChild(lbl);
    iw.appendChild(rg);
    form.appendChild(iw);
    var now = new Date(), at = e ? new Date(e.at) : now;
    var r2 = el("div", "row2");
    var di = input("date", ymd(at)), ti = input("time", hm(at));
    di.max = ymd(now);
    r2.appendChild(field(t("e.date"), di));
    r2.appendChild(field(t("e.time"), ti));
    form.appendChild(r2);
    var nt = el("textarea");
    nt.rows = 2;
    nt.maxLength = C.NOTE_LEN;
    nt.value = e ? e.n : "";
    form.appendChild(field(t("e.note"), nt));
    var tg = input("text", e ? e.g.join(", ") : "");
    tg.placeholder = t("e.tagsHint");
    form.appendChild(field(t("e.tags"), tg));
    var err = el("p", "err");
    err.setAttribute("role", "alert");
    form.appendChild(err);
    var acts = el("div", "dlg-actions");
    if (e) {
      acts.appendChild(iconBtn("dlg-btn icon danger", UI.trash, t("sy.del"), function () {
        dlg.close();
        var gone = removeRow("sy", e.id);
        saveNow();
        render();
        undoToast(t("sy.deleted"), function () { restoreRow("sy", gone); saveNow(); render(); });
      }));
    }
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var when = atOf(di.value, ti.value);
      di.classList.toggle("bad", isNaN(when));
      ti.classList.toggle("bad", isNaN(when));
      if (isNaN(when) || ks.value === "__new") { err.textContent = t("e.bad"); return; }
      var id = e ? e.id : newId();
      var n = C.normSym({ id: id, m: nextM("sy", id), k: ks.value, at: when, i: Number(rg.value), n: nt.value, g: tg.value.split(/[,;]/) });
      if (!n) { err.textContent = t("e.bad"); return; }
      putRow("sy", n);
      saveNow();
      dlg.close();
      render();
      live(t("e.saved") + ": " + symText(n));
    });
    dlg.appendChild(form);
    openDialog(dlg);
  }

  // An own symptom kind (new or rename), or hide / delete. Built-in
  // kinds can only be hidden (Settings).
  function symKindDialog(k, onDone) {
    var row = k ? C.symKindRow(data, k) : null;
    var dlg = makeDialog("hl-symk", k ? symName(k) : t("sy.ownTitle"));
    var form = el("form");
    form.method = "dialog";
    form.noValidate = true;
    var nm = input("text", row ? row.n : "");
    nm.maxLength = C.NAME_LEN;
    form.appendChild(field(t("k.name"), nm));
    var err = el("p", "err");
    err.setAttribute("role", "alert");
    form.appendChild(err);
    var acts = el("div", "dlg-actions");
    if (row) {
      acts.appendChild(iconBtn("dlg-btn icon danger", UI.trash, t("k.del"), function () {
        var cnt = data.sy.filter(function (e) { return e.k === k; }).length;
        dlg.close();
        confirmDialog(t("sy.kindDel", { n: row.n, c: cnt }), t("dlg.delete"), function () { deleteSymKind(k); });
      }));
    }
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var name = nm.value.trim(), low = name.toLowerCase();
      nm.classList.toggle("bad", !name);
      if (!name) { err.textContent = t("e.bad"); return; }
      if (C.symKindList(data).some(function (x) { return x.id !== k && symName(x.id).toLowerCase() === low; })) {
        nm.classList.add("bad");
        err.textContent = t("k.dup");
        return;
      }
      var id = k || ("s" + newId());
      var n = C.normSymKind({ id: id, m: nextM("sk", id), n: name, h: row ? row.h : 0 });
      if (!n) { err.textContent = t("e.bad"); return; }
      putRow("sk", n);
      saveNow();
      dlg.close();
      render();
      if (onDone) onDone(id);
    });
    dlg.appendChild(form);
    openDialog(dlg);
    setTimeout(function () { try { nm.focus(); } catch (x) {} }, 30);
  }
  function editSymKind(k, patch) {
    var cur = C.symKindRow(data, k);
    if (!cur) return;
    var row = JSON.parse(JSON.stringify(cur));
    Object.keys(patch).forEach(function (x) { row[x] = patch[x]; });
    row.m = nextM("sk", k);
    var n = C.normSymKind(row);
    if (!n) return;
    putRow("sk", n);
    saveNow();
  }
  function deleteSymKind(k) {
    var row = findRow("sk", k);
    if (!row) return;
    var gone = data.sy.filter(function (e) { return e.k === k; }).map(function (e) { return removeRow("sy", e.id); });
    removeRow("sk", k);
    saveNow();
    render();
    undoToast(t("k.deleted", { n: row.n }), function () {
      restoreRow("sk", row);
      gone.forEach(function (e) { if (e) restoreRow("sy", e); });
      saveNow();
      render();
    });
  }

  // Marks under a measurement chart: symptoms (dots) and doses taken
  // (ticks) between from and to.
  function chartMarks(from, to) {
    var out = [];
    symptoms("").forEach(function (e) {
      if (e.at < from || e.at >= to) return;
      out.push({ x: e.at, kind: "sy", lvl: e.i >= 7 ? 3 : e.i >= 4 ? 2 : 1,
                 tip: fmtDate(e.at, false) + " " + hm(new Date(e.at)) + " · " + symText(e) });
    });
    data.dl.forEach(function (l) {
      if (l.s !== "t" || l.ta < from || l.ta >= to) return;
      var med = C.medById(data, l.md);
      if (!med) return;
      out.push({ x: l.ta, kind: "dose", tip: fmtDate(l.ta, false) + " " + hm(new Date(l.ta)) + " · " + medLabel(med) });
    });
    return out;
  }

  // ---------- 10e. Record (wave 3): Medical ID, appointments, vaccines, documents ----------
  function ymdText(s) { return s ? fmtDate(parseYmd(s).getTime(), false) : ""; }
  function apptTitle(a) { return a.dr && a.sp ? a.dr + " · " + a.sp : (a.dr || a.sp); }
  // A row of a record list: a main button (opens the editor), a bold
  // line and small lines under it.
  function recRow(icon, title, lines, onOpen, extra) {
    var c = el("div", "med-card rec-row");
    var main = el("button", "med-main");
    main.type = "button";
    var top = el("div", "rec-top");
    if (icon) top.appendChild(kindIcon(icon));
    top.appendChild(el("b", "", title));
    main.appendChild(top);
    lines.forEach(function (ln) {
      if (!ln) return;
      if (typeof ln === "string") main.appendChild(el("small", "", ln));
      else main.appendChild(ln);
    });
    main.addEventListener("click", onOpen);
    c.appendChild(main);
    (extra || []).forEach(function (x) { if (x) c.appendChild(x); });
    return c;
  }
  // Save one row of a record collection (normalized) or report bad.
  function putRec(c, row, norm) {
    var n = norm(row);
    if (!n) return null;
    putRow(c, n);
    saveNow();
    return n;
  }
  function deleteRec(c, id, msg, after) {
    var row = removeRow(c, id);
    if (!row) return;
    saveNow();
    render();
    if (after) after(row);
    undoToast(msg, function () { restoreRow(c, row); saveNow(); render(); });
  }
  // The usual editor shell: a form with fields, Delete (when editing),
  // Cancel and Save; onSave returns an error text or "" when saved.
  function recDialog(id, title, build, onSave, onDelete, delLabel, more) {
    var dlg = makeDialog(id, title);
    var form = el("form");
    form.method = "dialog";
    form.noValidate = true;
    build(form, dlg);
    var err = el("p", "err");
    err.setAttribute("role", "alert");
    form.appendChild(err);
    var acts = el("div", "dlg-actions");
    if (onDelete) acts.appendChild(iconBtn("dlg-btn icon danger", UI.trash, delLabel, function () { dlg.close(); onDelete(); }));
    (more || []).forEach(function (b) { acts.appendChild(b(dlg)); });
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      err.textContent = "";
      var e = onSave();
      if (e) { err.textContent = e; return; }
      dlg.close();
      render();
    });
    dlg.appendChild(form);
    openDialog(dlg);
    return dlg;
  }
  function textField(form, label, value, max, hintText) {
    var i = input("text", value || "");
    i.maxLength = max;
    if (hintText) i.placeholder = hintText;
    form.appendChild(field(label, i));
    return i;
  }
  function noteField(form, label, value) {
    var n = el("textarea");
    n.rows = 2;
    n.maxLength = C.NOTE_LEN;
    n.value = value || "";
    form.appendChild(field(label, n));
    return n;
  }
  function checkField(form, label, on) {
    var w = el("label", "chk"), c = el("input");
    c.type = "checkbox";
    c.checked = !!on;
    w.appendChild(c);
    w.appendChild(el("span", "", label));
    form.appendChild(w);
    return c;
  }
  function mapsQuery(place, label) {
    try {
      if (window.parent && window.parent !== window && typeof window.parent.__orosOpenMapsQuery === "function") {
        window.parent.__orosOpenMapsQuery(place, label || "");
        return true;
      }
    } catch (e) {}
    return false;
  }
  function canMaps() {
    try { return !!(window.parent && window.parent !== window && typeof window.parent.__orosOpenMapsQuery === "function"); }
    catch (e) { return false; }
  }
  function telLink(num, label) {
    var a = el("a", "sm-btn tel");
    a.href = "tel:" + String(num).replace(/[^0-9+]/g, "");
    a.target = "_top";
    a.innerHTML = UI.phone;
    a.appendChild(el("span", "", label));
    return a;
  }

  function renderRecord(v) {
    setTitle(t("tab.record"));
    var top = section(null);
    top.appendChild(chips([["id", t("rv.id")], ["appt", t("rv.appt")], ["vax", t("rv.vax")], ["docs", t("rv.docs")]], prefs.rv, function (x) {
      prefs.rv = x; savePrefs(); render();
    }, t("tab.record")));
    v.appendChild(top);
    if (prefs.rv === "appt") renderAppts(v);
    else if (prefs.rv === "vax") renderVax(v);
    else if (prefs.rv === "docs") renderDocs(v);
    else renderMedId(v);
    v.appendChild(el("p", "disclaimer", prefs.rv === "id" ? t("id.disclaimer") : t("rec.dis")));
  }

  // ----- Medical ID -----
  function sevText(n) { return t("sev." + n); }
  function idFacts(s) {
    var pf = s.pf, out = [];
    if (pf.bd) out.push([t("id.born"), ymdText(pf.bd) + (s.age !== null ? " · " + t("id.age", { n: s.age }) : "")]);
    if (pf.bt) out.push([t("id.blood"), pf.bt]);
    if (pf.od) out.push([t("id.donor"), pf.od === 1 ? t("id.yes") : t("id.no")]);
    return out;
  }
  function renderMedId(v) {
    var now = Date.now(), s = C.medicalId(data, now), pf = s.pf;
    var card = section(null);
    var box = el("div", "mid-box");
    var h = el("div", "mid-head");
    h.appendChild(kindIcon("shield"));
    h.appendChild(el("b", "", pf.nm || t("id.title")));
    box.appendChild(h);
    var facts = idFacts(s);
    if (facts.length) box.appendChild(statGrid(facts));
    var empty = !pf.m && !s.al.length && !s.cn.length && !s.ec.length;
    if (empty) box.appendChild(hint(t("id.empty")));
    if (pf.nt) box.appendChild(el("p", "mid-note", pf.nt));
    var acts = el("div", "btn-col");
    acts.appendChild(txtBtn("wide-btn primary", UI.idcard, t("id.show"), function () { showMedId(); }));
    acts.appendChild(txtBtn("wide-btn", UI.print, t("id.card"), function () { printCard(); }));
    acts.appendChild(txtBtn("wide-btn", UI.edit, t("id.edit"), profileDialog));
    box.appendChild(acts);
    card.appendChild(box);
    v.appendChild(card);

    var sa = section(t("id.al"));
    s.al.forEach(function (a) {
      var sv = el("small", "sev sev-" + a.sv, a.sv ? sevText(a.sv) : "");
      sa.appendChild(recRow(null, a.n, [a.sv ? sv : null, a.r, a.nt ? el("small", "h-note", a.nt) : null], function () { allergyDialog(a.id); }));
    });
    sa.appendChild(txtBtn("wide-btn", UI.plus, t("al.add"), function () { allergyDialog(null); }));
    v.appendChild(sa);

    var sc = section(t("id.cn"));
    s.cn.forEach(function (c) {
      sc.appendChild(recRow(null, c.n, [c.sd ? t("sch.from", { d: ymdText(c.sd) }) : "", c.nt ? el("small", "h-note", c.nt) : null],
        function () { condDialog(c.id); }));
    });
    sc.appendChild(txtBtn("wide-btn", UI.plus, t("cn.add"), function () { condDialog(null); }));
    v.appendChild(sc);

    if (s.md.length) {
      var sm = section(t("id.md"));
      s.md.forEach(function (m) {
        sm.appendChild(recRow("pill", medLabel(m), [[t("f." + m.f), doseText(m, m.q), schedText(m)].join(" · ")], function () {
          prefs.mv = "list"; savePrefs(); setTab("meds"); medDialog(m.id);
        }));
      });
      v.appendChild(sm);
    }

    var se = section(t("id.ec"));
    s.ec.forEach(function (c) {
      se.appendChild(recRow("phone", c.n, [[c.rl, c.ph].filter(Boolean).join(" · ")], function () { contactDialog(c.id); },
        [telLink(c.ph, t("id.call", { n: c.n }))]));
    });
    se.appendChild(txtBtn("wide-btn", UI.plus, t("ec.add"), function () { contactDialog(null); }));
    v.appendChild(se);
  }

  function editProfile(row) {
    row.m = Math.max(Date.now(), (data.pf ? data.pf.m : 0) + 1);
    var n = C.normProfile(row);
    if (!n) return false;
    data.pf = n;
    saveNow();
    return true;
  }
  function profileDialog() {
    var pf = C.profileOf(data), f = {};
    recDialog("hl-pf", t("id.title"), function (form) {
      f.nm = textField(form, t("id.name"), pf.nm || settings().nm, C.REC_NAME);
      var r = el("div", "row2");
      f.bd = input("date", pf.bd);
      f.bd.max = ymd(new Date());
      r.appendChild(field(t("id.born"), f.bd));
      f.bt = select([["", t("id.notGiven")]].concat(C.BLOOD.map(function (b) { return [b, b]; })), pf.bt);
      r.appendChild(field(t("id.blood"), f.bt));
      form.appendChild(r);
      f.od = select([[0, t("id.notGiven")], [1, t("id.yes")], [2, t("id.no")]], pf.od);
      form.appendChild(field(t("id.donor"), f.od));
      f.nt = noteField(form, t("id.notes"), pf.nt);
      f.nt.placeholder = t("id.notesHint");
      f.sm = checkField(form, t("id.meds"), pf.sm);
    }, function () {
      if (f.bd.value && !C.validYmd(f.bd.value)) { f.bd.classList.add("bad"); return t("e.bad"); }
      editProfile({ nm: f.nm.value, bd: f.bd.value, bt: f.bt.value, od: +f.od.value, nt: f.nt.value, sm: f.sm.checked ? 1 : 0 });
      return "";
    });
  }

  function allergyDialog(id) {
    var a = id ? findRow("al", id) : null, f = {};
    if (id && !a) { showToast(t("feed.gone")); return; }
    recDialog("hl-al", a ? a.n : t("al.new"), function (form) {
      f.n = textField(form, t("al.name"), a ? a.n : "", C.REC_NAME, t("al.nameHint"));
      f.sv = select([0, 1, 2, 3].map(function (n) { return [n, sevText(n)]; }), a ? a.sv : 0);
      form.appendChild(field(t("al.sev"), f.sv));
      f.r = textField(form, t("al.r"), a ? a.r : "", C.REACTION_LEN, t("al.rHint"));
      f.nt = noteField(form, t("e.note"), a ? a.nt : "");
    }, function () {
      var rid = a ? a.id : "a" + newId();
      if (!f.n.value.trim()) { f.n.classList.add("bad"); return t("e.bad"); }
      return putRec("al", { id: rid, m: nextM("al", rid), n: f.n.value, sv: +f.sv.value, r: f.r.value, nt: f.nt.value }, C.normAllergy) ? "" : t("e.bad");
    }, a ? function () { deleteRec("al", a.id, t("al.deleted")); } : null, t("al.del"));
    if (!a) setTimeout(function () { try { f.n.focus(); } catch (x) {} }, 30);
  }
  function condDialog(id) {
    var c = id ? findRow("cn", id) : null, f = {};
    if (id && !c) { showToast(t("feed.gone")); return; }
    recDialog("hl-cn", c ? c.n : t("cn.new"), function (form) {
      f.n = textField(form, t("cn.name"), c ? c.n : "", C.REC_NAME, t("cn.nameHint"));
      f.sd = input("date", c ? c.sd : "");
      f.sd.max = ymd(new Date());
      form.appendChild(field(t("cn.since"), f.sd));
      f.nt = noteField(form, t("e.note"), c ? c.nt : "");
    }, function () {
      var rid = c ? c.id : "c" + newId();
      if (!f.n.value.trim()) { f.n.classList.add("bad"); return t("e.bad"); }
      return putRec("cn", { id: rid, m: nextM("cn", rid), n: f.n.value, sd: f.sd.value, nt: f.nt.value }, C.normCond) ? "" : t("e.bad");
    }, c ? function () { deleteRec("cn", c.id, t("cn.deleted")); } : null, t("cn.del"));
    if (!c) setTimeout(function () { try { f.n.focus(); } catch (x) {} }, 30);
  }

  // Contacts (read only): people with at least one phone number.
  function contactChoices() {
    var ct = null;
    try { ct = JSON.parse(localStorage.getItem("oros-contacts-data") || "null"); } catch (e) {}
    if (!ct || !Array.isArray(ct.contacts)) return [];
    var gone = {};
    (Array.isArray(ct.deleted) ? ct.deleted : []).forEach(function (d) {
      if (d && typeof d.id === "string" && typeof d.mtime === "number") gone[d.id] = Math.max(gone[d.id] || 0, d.mtime);
    });
    function s(v) { return typeof v === "string" ? v.trim() : ""; }
    var out = [];
    ct.contacts.forEach(function (c) {
      if (!c || typeof c !== "object" || typeof c.id !== "string" || c.del) return;
      if (c.id in gone && gone[c.id] >= (typeof c.mtime === "number" ? c.mtime : 0)) return;
      var name = [s(c.given), s(c.middle), s(c.family)].filter(Boolean).join(" ") || s(c.nickname) || s(c.org);
      var phones = (Array.isArray(c.phones) ? c.phones : []).map(function (p) { return p && typeof p === "object" ? s(p.v) : s(p); })
        .filter(function (p) { return /\d/.test(p); });
      if (!name || !phones.length) return;
      out.push({ id: c.id, name: name.slice(0, C.REC_NAME), phones: phones });
    });
    return out.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; }).slice(0, 3000);
  }
  function pickContact(onPick) {
    var list = contactChoices();
    var dlg = makeDialog("hl-ct", t("ec.pick"));
    if (!list.length) dlg.appendChild(hint(t("ec.noContacts")));
    else {
      var q = input("search", "");
      q.placeholder = t("ec.search");
      q.setAttribute("aria-label", t("ec.search"));
      dlg.appendChild(q);
      var box = el("div", "pick-list");
      dlg.appendChild(box);
      var draw = function () {
        box.innerHTML = "";
        var w = q.value.trim().toLowerCase();
        list.filter(function (c) { return !w || c.name.toLowerCase().indexOf(w) >= 0; }).slice(0, 100).forEach(function (c) {
          c.phones.slice(0, 3).forEach(function (ph) {
            var b = el("button", "pick-btn");
            b.type = "button";
            b.appendChild(el("b", "", c.name));
            b.appendChild(el("small", "", ph));
            b.addEventListener("click", function () { dlg.close(); onPick(c, ph); });
            box.appendChild(b);
          });
        });
      };
      q.addEventListener("input", draw);
      draw();
    }
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }
  function contactDialog(id) {
    var c = id ? findRow("ec", id) : null, f = { ci: c ? c.ci : "" };
    if (id && !c) { showToast(t("feed.gone")); return; }
    recDialog("hl-ec", c ? c.n : t("ec.new"), function (form) {
      if (contactChoices().length) {
        form.appendChild(txtBtn("dlg-btn", UI.phone, t("ec.pick"), function () {
          pickContact(function (ct, ph) { f.n.value = ct.name; f.ph.value = ph; f.ci = ct.id; });
        }));
      }
      f.n = textField(form, t("ec.name"), c ? c.n : "", C.REC_NAME);
      f.rl = textField(form, t("ec.rel"), c ? c.rl : "", C.REL_LEN, t("ec.relHint"));
      f.ph = input("tel", c ? c.ph : "");
      f.ph.maxLength = C.PHONE_LEN;
      f.ph.autocomplete = "off";
      form.appendChild(field(t("ec.phone"), f.ph));
    }, function () {
      var rid = c ? c.id : "e" + newId();
      var bad = !f.n.value.trim();
      f.n.classList.toggle("bad", bad);
      if (!/\d/.test(f.ph.value)) { f.ph.classList.add("bad"); return t("ec.badPhone"); }
      if (bad) return t("e.bad");
      return putRec("ec", { id: rid, m: nextM("ec", rid), n: f.n.value, rl: f.rl.value, ph: f.ph.value, ci: f.ci }, C.normContact) ? "" : t("ec.badPhone");
    }, c ? function () { deleteRec("ec", c.id, t("ec.deleted")); } : null, t("ec.del"));
  }

  // ----- The Medical ID full screen, the QR code, the emergency card -----
  function qrLabels() {
    return { head: t("id.head"), name: t("id.name"), born: t("id.born"), blood: t("id.blood"), donor: t("id.donor"),
             yes: t("id.yes"), no: t("id.no"), al: t("id.al"), cn: t("id.cn"), md: t("id.md"), ec: t("id.ec"),
             nt: t("id.notes"), sev: [0, 1, 2, 3].map(sevText), more: t("id.more") };
  }
  var QR_MAX = 600;
  function fullIdText(s) { return C.idText(s, qrLabels(), 100000); }
  // QR Generator's encoder (../qr/qr-encode.js) drawn as one SVG path.
  function qrSvg(text, px) {
    var Q = window.orosQR, qr = null;
    if (!Q || typeof Q.encode !== "function") return null;
    try { qr = Q.encode(text, { ecl: "M" }); } catch (e) { return null; }
    var n = qr.size, m = 4, d = "";
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (qr.modules[y][x]) d += "M" + (x + m) + " " + (y + m) + "h1v1h-1z";
    var svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", "0 0 " + (n + 2 * m) + " " + (n + 2 * m));
    svg.setAttribute("width", px);
    svg.setAttribute("height", px);
    svg.setAttribute("shape-rendering", "crispEdges");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", t("id.qr"));
    var bg = document.createElementNS(SVGNS, "rect");
    bg.setAttribute("width", n + 2 * m);
    bg.setAttribute("height", n + 2 * m);
    bg.setAttribute("fill", "#fff");
    svg.appendChild(bg);
    var p = document.createElementNS(SVGNS, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "#000");
    svg.appendChild(p);
    return svg;
  }
  function idListBlock(host, label, items, fmt, cls) {
    var b = el("div", "mid-block" + (cls ? " " + cls : ""));
    b.appendChild(el("div", "mid-lbl", label));
    if (!items.length) b.appendChild(el("div", "mid-val dim", t("id.none")));
    items.forEach(function (it) { b.appendChild(fmt(it)); });
    host.appendChild(b);
  }
  var wakeLock = null;
  function showMedId() {
    var s = C.medicalId(data, Date.now()), pf = s.pf;
    var dlg = makeDialog("hl-mid", null);
    dlg.classList.add("mid-full");
    dlg.setAttribute("aria-label", t("id.title"));
    var bar = el("div", "mid-bar");
    bar.appendChild(kindIcon("shield"));
    bar.appendChild(el("span", "", t("id.title")));
    bar.appendChild(iconBtn("mini mid-x", UI.x, t("dlg.close"), function () { dlg.close(); }));
    dlg.appendChild(bar);
    var body = el("div", "mid-body");
    if (pf.nm) body.appendChild(el("div", "mid-name", pf.nm));
    var facts = idFacts(s);
    if (facts.length) {
      var fx = el("div", "mid-facts");
      facts.forEach(function (f) {
        var x = el("div", "mid-fact");
        x.appendChild(el("span", "mid-lbl", f[0]));
        x.appendChild(el("span", "mid-val", f[1]));
        fx.appendChild(x);
      });
      body.appendChild(fx);
    }
    idListBlock(body, t("id.al"), s.al, function (a) {
      var r = el("div", "mid-val");
      r.appendChild(el("b", "", a.n));
      if (a.sv) r.appendChild(el("span", "sev sev-" + a.sv, " · " + sevText(a.sv)));
      if (a.r) r.appendChild(el("span", "dim", " · " + a.r));
      return r;
    }, "warn");
    idListBlock(body, t("id.cn"), s.cn, function (c) { return el("div", "mid-val", c.n); });
    if (pf.sm) idListBlock(body, t("id.md"), s.md, function (m) { return el("div", "mid-val", medLabel(m) + " · " + doseText(m, m.q)); });
    if (pf.nt) idListBlock(body, t("id.notes"), [pf.nt], function (n) { return el("div", "mid-val mid-note", n); });
    idListBlock(body, t("id.ec"), s.ec, function (c) {
      var r = el("div", "mid-val mid-ec");
      var tx = el("span", "");
      tx.appendChild(el("b", "", c.n));
      tx.appendChild(document.createTextNode((c.rl ? " (" + c.rl + ")" : "") + " · " + c.ph));
      r.appendChild(tx);
      r.appendChild(telLink(c.ph, t("id.call", { n: c.n })));
      return r;
    });
    var qrBox = el("div", "mid-qr");
    var qc = el("label", "chk"), qi = el("input");
    qi.type = "checkbox";
    qi.checked = !!prefs.iq;
    qc.appendChild(qi);
    qc.appendChild(el("span", "", t("id.qr")));
    body.appendChild(qc);
    body.appendChild(qrBox);
    function paintQr() {
      qrBox.innerHTML = "";
      if (!prefs.iq) return;
      var txt = C.idText(s, qrLabels(), QR_MAX), svg = qrSvg(txt, 240);
      if (!svg) { qrBox.appendChild(hint(t("id.qrFail"))); return; }
      qrBox.appendChild(svg);
      qrBox.appendChild(hint(t("id.qrHint") + (txt !== fullIdText(s) ? " " + t("id.qrCut") : "")));
    }
    qi.addEventListener("change", function () { prefs.iq = qi.checked ? 1 : 0; savePrefs(); paintQr(); });
    paintQr();
    dlg.appendChild(body);
    dlg.addEventListener("close", function () {
      if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
    });
    openDialog(dlg);
    try {
      if (navigator.wakeLock && navigator.wakeLock.request) {
        navigator.wakeLock.request("screen").then(function (w) { if (dlg.open) wakeLock = w; else w.release(); }).catch(function () {});
      }
    } catch (e) {}
  }
  // A wallet card to print: front (name, blood type, allergies,
  // conditions) and back (medicines, notes, whom to call, QR code
  // when shown), side by side to cut out and fold.
  function printCard() {
    var s = C.medicalId(data, Date.now()), pf = s.pf, host = $("print");
    host.innerHTML = "";
    var wrap = el("div", "ec-wrap");
    var front = el("div", "ec-card"), back = el("div", "ec-card");
    var hd = el("div", "ec-head", t("id.head"));
    front.appendChild(hd);
    if (pf.nm) front.appendChild(el("div", "ec-name", pf.nm));
    var facts = idFacts(s).map(function (f) { return f[0] + ": " + f[1]; }).join(" · ");
    if (facts) front.appendChild(el("div", "ec-line", facts));
    function line(card, label, items, fmt) {
      if (!items.length) return;
      var p = el("div", "ec-line");
      p.appendChild(el("b", "", label + ": "));
      p.appendChild(document.createTextNode(items.map(fmt).join("; ")));
      card.appendChild(p);
    }
    line(front, t("id.al"), s.al, function (a) { return a.n + (a.sv ? " (" + sevText(a.sv) + ")" : ""); });
    line(front, t("id.cn"), s.cn, function (c) { return c.n; });
    if (!s.al.length) line(front, t("id.al"), [t("id.none")], function (x) { return x; });
    var inner = el("div", "ec-back");
    var col = el("div", "ec-col");
    line(col, t("id.md"), s.md, function (m) { return medLabel(m); });
    if (pf.nt) line(col, t("id.notes"), [pf.nt], function (x) { return x; });
    if (s.ec.length) {
      col.appendChild(el("div", "ec-line ec-ice", t("pc.ice")));
      s.ec.slice(0, 3).forEach(function (c) { col.appendChild(el("div", "ec-line", c.n + (c.rl ? " (" + c.rl + ")" : "") + " " + c.ph)); });
    }
    col.appendChild(el("div", "ec-foot", t("pc.made", { d: fmtDate(Date.now(), false) })));
    inner.appendChild(col);
    if (prefs.iq) {
      var svg = qrSvg(C.idText(s, qrLabels(), QR_MAX), 130);
      if (svg) { var q = el("div", "ec-qr"); q.appendChild(svg); inner.appendChild(q); }
    }
    back.appendChild(inner);
    wrap.appendChild(front);
    wrap.appendChild(back);
    host.appendChild(wrap);
    host.appendChild(el("p", "pr-foot", t("pc.cut")));
    setTimeout(function () { window.print(); }, 60);
  }

  // ----- Appointments -----
  var AP_LEADS = [-1, 0, 15, 30, 60, 120, 1440, 2880];
  var AP_DURS = [0, 15, 30, 45, 60, 90, 120];
  function apptWhen(a) {
    var s = fmtDate(a.at, true) + " " + hm(new Date(a.at));
    if (a.du) s += "–" + hm(new Date(a.at + a.du * 60000));
    return s;
  }
  function apptRow(a) {
    var extra = [];
    if (a.pl && canMaps()) extra.push(smallBtn(t("ap.map"), UI.pin, function () { mapsQuery(a.pl, apptTitle(a)); }));
    var lines = [apptWhen(a) + (a.rm >= 0 ? " · " + t("rm." + a.rm) : ""), a.pl, a.nt ? el("small", "h-note", a.nt) : null];
    return recRow("history", apptTitle(a), lines, function () { apptDialog(a.id); }, extra);
  }
  var apPast = 10;
  function renderAppts(v) {
    var now = Date.now(), start = startOfDay(now);
    var up = C.upcomingAppts(data, now);
    var past = data.ap.filter(function (a) { return a.at < start; }).sort(function (x, y) { return y.at - x.at; });
    var s = section(up.length ? t("ap.upH") : null);
    if (!data.ap.length) s.appendChild(hint(t("ap.none")));
    up.forEach(function (a) { s.appendChild(apptRow(a)); });
    s.appendChild(txtBtn("wide-btn" + (up.length ? "" : " primary"), UI.plus, t("ap.add"), function () { apptDialog(null); }));
    v.appendChild(s);
    if (past.length) {
      var p = section(t("ap.pastH"));
      past.slice(0, apPast).forEach(function (a) { p.appendChild(apptRow(a)); });
      if (past.length > apPast) p.appendChild(txtBtn("wide-btn", null, t("hist.more"), function () { apPast += 20; render(); }));
      v.appendChild(p);
    }
  }
  function datalist(id, values) {
    var dl = el("datalist");
    dl.id = id;
    var seen = {};
    values.forEach(function (x) {
      var k = x.toLowerCase();
      if (!x || seen[k]) return;
      seen[k] = 1;
      var o = el("option");
      o.value = x;
      dl.appendChild(o);
    });
    return dl;
  }
  function apptDialog(id, copyOf) {
    var a = id ? findRow("ap", id) : null, f = {};
    if (id && !a) { showToast(t("feed.gone")); return; }
    var src = a || copyOf || null;
    var at0 = a ? a.at : (function () { var d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.getTime(); })();
    recDialog("hl-ap", a ? apptTitle(a) : t("ap.new"), function (form) {
      form.appendChild(datalist("hl-dr-list", data.ap.map(function (x) { return x.dr; })));
      form.appendChild(datalist("hl-sp-list", data.ap.map(function (x) { return x.sp; })));
      f.dr = textField(form, t("ap.dr"), src ? src.dr : "", C.DR_LEN);
      f.dr.setAttribute("list", "hl-dr-list");
      f.sp = textField(form, t("ap.sp"), src ? src.sp : "", C.SPEC_LEN, t("ap.spHint"));
      f.sp.setAttribute("list", "hl-sp-list");
      var r = el("div", "row2");
      f.d = input("date", ymd(new Date(at0)));
      f.t = input("time", hm(new Date(at0)));
      r.appendChild(field(t("ap.date"), f.d));
      r.appendChild(field(t("ap.time"), f.t));
      form.appendChild(r);
      var r2 = el("div", "row2");
      f.du = select(AP_DURS.map(function (n) { return [n, n ? t("ap.min", { n: n }) : t("ap.du0")]; }), src ? (AP_DURS.indexOf(src.du) >= 0 ? src.du : 0) : 0);
      f.rm = select(AP_LEADS.map(function (n) { return [n, t("rm." + n)]; }), src && AP_LEADS.indexOf(src.rm) >= 0 ? src.rm : 60);
      r2.appendChild(field(t("ap.du"), f.du));
      r2.appendChild(field(t("ap.rm"), f.rm));
      form.appendChild(r2);
      form.appendChild(hint(t("ap.remHint")));
      f.pl = textField(form, t("ap.pl"), src ? src.pl : "", C.PLACE_LEN, t("ap.plHint"));
      if (canMaps()) {
        var mb = txtBtn("dlg-btn", UI.pin, t("ap.map"), function () { if (f.pl.value.trim()) mapsQuery(f.pl.value.trim(), f.dr.value.trim()); });
        form.appendChild(mb);
      }
      f.nt = noteField(form, t("e.note"), a ? a.nt : "");
    }, function () {
      var at = atOf(f.d.value, f.t.value);
      var bad = isNaN(at);
      f.d.classList.toggle("bad", bad);
      f.t.classList.toggle("bad", bad);
      if (bad) return t("e.bad");
      if (!f.dr.value.trim() && !f.sp.value.trim()) { f.dr.classList.add("bad"); return t("ap.need"); }
      var rid = a ? a.id : "p" + newId();
      return putRec("ap", { id: rid, m: nextM("ap", rid), dr: f.dr.value, sp: f.sp.value, pl: f.pl.value, at: at,
                            du: +f.du.value, rm: +f.rm.value, nt: f.nt.value }, C.normAppt) ? "" : t("e.bad");
    }, a ? function () { deleteRec("ap", a.id, t("ap.deleted")); } : null, t("ap.del"));
    if (!a) setTimeout(function () { try { f.dr.focus(); } catch (x) {} }, 30);
  }

  // ----- Vaccinations -----
  function vaxRow(x, open, today) {
    var due = "";
    if (open && x.nx) due = el("small", "vx-due" + (x.nx < today ? " late" : ""), x.nx < today ? t("vx.overdue", { d: ymdText(x.nx) }) : t("vx.due", { d: ymdText(x.nx) }));
    var lines = [t("vx.given", { d: ymdText(x.d) }) + (x.lt ? " · " + x.lt : ""), due, x.nt ? el("small", "h-note", x.nt) : null];
    var extra = open ? [smallBtn(t("vx.again"), UI.plus, function () { vaxDialog(null, x); })] : [];
    return recRow("shield", x.n, lines, function () { vaxDialog(x.id); }, extra);
  }
  function renderVax(v) {
    var today = ymd(new Date()), open = C.vaxOpen(data), openIds = {};
    open.forEach(function (x) { openIds[x.id] = 1; });
    if (open.length) {
      var s = section(t("vx.dueH"));
      open.forEach(function (x) { s.appendChild(vaxRow(x, true, today)); });
      v.appendChild(s);
    }
    var all = section(data.vx.length ? t("vx.allH") : null);
    if (!data.vx.length) all.appendChild(hint(t("vx.none")));
    data.vx.slice().sort(function (a, b) { return a.d < b.d ? 1 : a.d > b.d ? -1 : cmpStr(a.n, b.n); }).forEach(function (x) {
      all.appendChild(vaxRow(x, false, today));
    });
    all.appendChild(txtBtn("wide-btn" + (data.vx.length ? "" : " primary"), UI.plus, t("vx.add"), function () { vaxDialog(null); }));
    v.appendChild(all);
  }
  // again = a row whose next dose is now given: a new row with its name.
  function vaxDialog(id, again) {
    var x = id ? findRow("vx", id) : null, f = {};
    if (id && !x) { showToast(t("feed.gone")); return; }
    var today = ymd(new Date());
    recDialog("hl-vx", x ? x.n : again ? again.n : t("vx.new"), function (form) {
      form.appendChild(datalist("hl-vx-list", data.vx.map(function (y) { return y.n; })));
      f.n = textField(form, t("vx.name"), x ? x.n : again ? again.n : "", C.REC_NAME, t("vx.nameHint"));
      f.n.setAttribute("list", "hl-vx-list");
      var r = el("div", "row2");
      f.d = input("date", x ? x.d : today);
      f.nx = input("date", x ? x.nx : "");
      r.appendChild(field(t("vx.date"), f.d));
      r.appendChild(field(t("vx.next"), f.nx));
      form.appendChild(r);
      f.rm = checkField(form, t("vx.remind"), x ? (x.nx ? x.rm : 1) : 1);
      f.lt = textField(form, t("vx.lot"), x ? x.lt : "", C.LOT_LEN);
      f.nt = noteField(form, t("e.note"), x ? x.nt : "");
    }, function () {
      var bad = false;
      [[f.n, !f.n.value.trim()], [f.d, !C.validYmd(f.d.value)], [f.nx, f.nx.value && !C.validYmd(f.nx.value)]].forEach(function (p) {
        p[0].classList.toggle("bad", !!p[1]);
        if (p[1]) bad = true;
      });
      if (bad) return t("e.bad");
      if (f.nx.value && f.nx.value <= f.d.value) { f.nx.classList.add("bad"); return t("vx.badNext"); }
      var rid = x ? x.id : "v" + newId();
      return putRec("vx", { id: rid, m: nextM("vx", rid), n: f.n.value, d: f.d.value, nx: f.nx.value, rm: f.rm.checked ? 1 : 0,
                            lt: f.lt.value, nt: f.nt.value }, C.normVax) ? "" : t("e.bad");
    }, x ? function () { deleteRec("vx", x.id, t("vx.deleted")); } : null, t("vx.del"));
  }

  // ----- Documents and their files on the orOS disk -----
  // The document keeps file names only; each file sits in Files under
  // "Health" and syncs through Vault Drive when the user runs it, never
  // through the slice. Photos are re-drawn on a canvas (long side
  // 1600 px, JPEG 0.8, white background): no EXIF / location kept.
  // PDFs (≤ 10 MB, starting with "%PDF-") are kept as they are.
  var AT_MAX_IN = 40 * 1024 * 1024, PDF_MAX = 10 * 1024 * 1024;
  function fsApi() {
    try {
      var f = window.parent && window.parent !== window ? window.parent.orosFS : null;
      return f && typeof f.writeBlob === "function" && typeof f.readBlob === "function" && typeof f.rm === "function" ? f : null;
    } catch (e) { return null; }
  }
  function atRandom() { return rand36(8).replace(/[^a-z0-9]/g, "0"); }
  function isPdf(file) { return !!file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name || "")); }
  function encodeAttachment(file) {
    if (!file) return Promise.resolve(null);
    if (isPdf(file)) {
      if (file.size > PDF_MAX || !file.size) return Promise.resolve(null);
      return Promise.resolve(file.slice(0, 5).text ? file.slice(0, 5).text() : "%PDF-").then(function (h) {
        return h === "%PDF-" ? { blob: file.slice(0, file.size, "application/pdf"), ext: "pdf" } : null;
      }).catch(function () { return null; });
    }
    if (file.size > AT_MAX_IN) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { URL.revokeObjectURL(url); resolve(null); return; }
        var k = Math.min(1, 1600 / Math.max(w, h));
        var cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(w * k));
        cv.height = Math.max(1, Math.round(h * k));
        var g = cv.getContext("2d");
        g.fillStyle = "#fff";
        g.fillRect(0, 0, cv.width, cv.height);
        g.drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        cv.toBlob(function (b) { resolve(b && b.size ? { blob: b, ext: "jpg" } : null); }, "image/jpeg", 0.8);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }
  function rmFile(name) {
    var fs = fsApi(), path = C.atPath(name);
    if (!fs || !path) return Promise.resolve();
    return Promise.resolve(fs.rm(path)).catch(function () {});
  }
  // A deleted document keeps its files through the Undo window; then
  // any name no document points at any more leaves the disk.
  function dropFilesLater(names) {
    if (!names || !names.length || !fsApi()) return;
    var list = names.slice();
    setTimeout(function () {
      var used = C.attachmentsOf(data);
      list.forEach(function (n) { if (used.indexOf(n) < 0) rmFile(n); });
    }, 12000);
  }
  function openBlob(blob) {
    var u = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = u;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
  }
  // Files added while the editor is open are written at once and
  // removed again if it closes without saving; files taken off leave
  // the disk on save.
  function attachBox(dlg, doc, docId, dateIn) {
    var fs = fsApi();
    var cur = doc && doc.sc ? doc.sc.slice() : [], orig = cur.slice(), added = [], urls = [], done = false;
    var wrap = el("div", "fld");
    wrap.appendChild(el("span", "fld-lbl", t("at.title")));
    var grid = el("div", "at-grid");
    wrap.appendChild(grid);
    wrap.appendChild(hint(fs ? t("at.hint") : t("at.noFs")));
    function paint() {
      urls.forEach(function (u) { URL.revokeObjectURL(u); });
      urls = [];
      grid.innerHTML = "";
      cur.forEach(function (name, i) {
        var b = el("button", "at-th");
        b.type = "button";
        b.setAttribute("aria-label", t("at.open", { n: i + 1 }));
        b.addEventListener("click", function () { viewer(name); });
        grid.appendChild(b);
        if (/\.pdf$/.test(name)) { b.appendChild(el("span", "at-pdf", t("at.pdf"))); return; }
        if (!fs) { b.appendChild(el("span", "at-miss", t("at.missing"))); return; }
        Promise.resolve(fs.readBlob(C.atPath(name))).then(function (blob) {
          if (!blob) throw new Error("ENOENT");
          var u = URL.createObjectURL(blob);
          urls.push(u);
          var im = el("img");
          im.alt = "";
          im.src = u;
          b.appendChild(im);
        }).catch(function () { b.appendChild(el("span", "at-miss", t("at.missing"))); });
      });
      if (fs && cur.length < C.MAX_AT_FILES) {
        var add = el("button", "at-th at-add", "+");
        add.type = "button";
        add.setAttribute("aria-label", t("at.add"));
        add.title = t("at.add");
        add.addEventListener("click", pick);
        grid.appendChild(add);
      }
    }
    function pick() {
      pickFile("image/*,application/pdf,.pdf").then(function (file) {
        if (!file) return;
        return encodeAttachment(file).then(function (enc) {
          if (!enc) { showToast(t("at.bad")); return; }
          var name = C.atName(C.validYmd(dateIn.value) ? dateIn.value : ymd(new Date()), docId, atRandom(), enc.ext);
          if (!name) return;
          return Promise.resolve(fs.writeBlob(C.atPath(name), enc.blob)).then(function () {
            if (done) { rmFile(name); return; }
            added.push(name);
            cur.push(name);
            cur.sort(cmpStr);
            paint();
          });
        });
      }).catch(function () { showToast(t("at.noDisk")); });
    }
    function viewer(name) {
      var v = makeDialog("hl-at-view", t("at.title"));
      var box = el("div", "at-view");
      v.appendChild(box);
      var blobNow = null, pdf = /\.pdf$/.test(name);
      var acts = el("div", "dlg-actions");
      var openB = pdf ? button(t("at.openPdf"), "", function () { if (blobNow) openBlob(blobNow); }) : null;
      var saveB = button(t("at.save"), "", function () {
        if (blobNow) saveBlob(blobNow, name, pdf ? "application/pdf" : "image/jpeg");
      });
      if (openB) { openB.disabled = true; acts.appendChild(openB); }
      saveB.disabled = true;
      acts.appendChild(saveB);
      if (fs) Promise.resolve(fs.readBlob(C.atPath(name))).then(function (blob) {
        if (!blob) throw new Error("ENOENT");
        blobNow = pdf ? blob.slice(0, blob.size, "application/pdf") : blob;
        if (pdf) box.appendChild(el("div", "at-pdf big", t("at.pdf")));
        else {
          var u = URL.createObjectURL(blobNow), im = el("img");
          im.alt = t("at.title");
          im.src = u;
          box.appendChild(im);
          v.addEventListener("close", function () { setTimeout(function () { URL.revokeObjectURL(u); }, 1000); });
        }
        if (openB) openB.disabled = false;
        saveB.disabled = false;
      }).catch(function () { box.appendChild(hint(t("at.missingLong"))); });
      else box.appendChild(hint(t("at.missingLong")));
      v.appendChild(hint(t("at.where")));
      acts.appendChild(button(t("at.remove"), "danger", function () {
        v.close();
        cur = cur.filter(function (n) { return n !== name; });
        if (added.indexOf(name) >= 0) { added = added.filter(function (n) { return n !== name; }); rmFile(name); }
        paint();
      }));
      acts.appendChild(button(t("dlg.close"), "primary", function () { v.close(); }));
      v.appendChild(acts);
      document.body.appendChild(v);
      v.showModal();
    }
    dlg.addEventListener("close", function () {
      urls.forEach(function (u) { URL.revokeObjectURL(u); });
      if (!done) { done = true; added.forEach(rmFile); }
    });
    paint();
    return {
      wrap: wrap,
      names: function () { return cur.slice(); },
      commit: function () {
        done = true;
        var gone = orig.filter(function (n) { return cur.indexOf(n) < 0; });
        if (gone.length) setTimeout(function () {
          var used = C.attachmentsOf(data);
          gone.forEach(function (n) { if (used.indexOf(n) < 0) rmFile(n); });
        }, 0);
      }
    };
  }
  function renderDocs(v) {
    var s = section(null);
    if (!data.dc.length) s.appendChild(hint(t("dc.none")));
    else {
      var kinds = C.DOC_KINDS.filter(function (k) { return data.dc.some(function (d) { return d.k === k; }); });
      if (kinds.length > 1) {
        s.appendChild(chips([["", t("dc.all")]].concat(kinds.map(function (k) { return [k, t("dk." + k)]; })),
          kinds.indexOf(prefs.dk) >= 0 ? prefs.dk : "", function (k) { prefs.dk = k; savePrefs(); render(); }, t("dc.kind")));
      }
      var k = kinds.length > 1 && kinds.indexOf(prefs.dk) >= 0 ? prefs.dk : "";
      data.dc.filter(function (d) { return !k || d.k === k; })
        .sort(function (a, b) { return a.d < b.d ? 1 : a.d > b.d ? -1 : cmpStr(a.id, b.id); })
        .forEach(function (d) {
          var n = d.sc ? d.sc.length : 0;
          s.appendChild(recRow("file", d.n, [t("dk." + d.k) + " · " + ymdText(d.d) + (n ? " · " + (n === 1 ? t("dc.file1") : t("dc.files", { n: n })) : ""),
            d.nt ? el("small", "h-note", d.nt) : null], function () { docDialog(d.id); }));
        });
    }
    s.appendChild(txtBtn("wide-btn" + (data.dc.length ? "" : " primary"), UI.plus, t("dc.add"), function () { docDialog(null); }));
    v.appendChild(s);
  }
  function docDialog(id) {
    var d = id ? findRow("dc", id) : null, f = {}, box = null;
    if (id && !d) { showToast(t("feed.gone")); return; }
    var rid = d ? d.id : "d" + newId();
    recDialog("hl-dc", d ? d.n : t("dc.new"), function (form, dlg) {
      dlg.classList.add("wide");
      f.n = textField(form, t("dc.name"), d ? d.n : "", C.DOC_NAME, t("dc.nameHint"));
      var r = el("div", "row2");
      f.k = select(C.DOC_KINDS.map(function (k) { return [k, t("dk." + k)]; }), d ? d.k : "lab");
      f.d = input("date", d ? d.d : ymd(new Date()));
      r.appendChild(field(t("dc.kind"), f.k));
      r.appendChild(field(t("dc.date"), f.d));
      form.appendChild(r);
      box = attachBox(dlg, d, rid, f.d);
      form.appendChild(box.wrap);
      f.nt = noteField(form, t("e.note"), d ? d.nt : "");
    }, function () {
      var bad = !f.n.value.trim();
      f.n.classList.toggle("bad", bad);
      f.d.classList.toggle("bad", !C.validYmd(f.d.value));
      if (bad || !C.validYmd(f.d.value)) return t("e.bad");
      var row = { id: rid, m: nextM("dc", rid), k: f.k.value, n: f.n.value, d: f.d.value, nt: f.nt.value, sc: box.names() };
      if (!putRec("dc", row, C.normDoc)) return t("e.bad");
      box.commit();
      return "";
    }, d ? function () { deleteRec("dc", d.id, t("dc.deleted"), function (row) { dropFilesLater(row.sc || []); }); } : null, t("dc.del"));
    if (!d) setTimeout(function () { try { f.n.focus(); } catch (x) {} }, 30);
  }

  // ---------- 11. Settings, export, restore ----------
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
  function stampName(ext) { return "orOS-health-" + ymd(new Date()) + "." + ext; }
  function exportCsv() { saveBlob(new Blob([buildCsv(readings("", true))], { type: "text/csv;charset=utf-8" }), stampName("csv"), "text/csv"); }
  function exportJson() {
    var payload = { app: "health", ver: C.DATA_VER, data: C.merge(data, data) };
    saveBlob(new Blob([JSON.stringify(payload)], { type: "application/json" }), stampName("json"), "application/json");
  }
  // Restore goes through the merge: nothing local is deleted, the newer
  // row wins as on sync, tombstones in the file count.
  function restoreJson() {
    pickFile(".json,application/json").then(function (file) {
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) { showToast(t("set.badFile")); return; }
      var rd = new FileReader();
      rd.onload = function () {
        var obj = null;
        try { obj = JSON.parse(String(rd.result)); } catch (e) {}
        if (!obj || obj.app !== "health" || !obj.data || !Array.isArray(obj.data.en)) { showToast(t("set.badFile")); return; }
        data = C.merge(data, obj.data);
        saveNow();
        var d = $("hl-set");
        if (d) d.close();
        render();
        showToast(t("set.restored", { n: data.en.length }));
      };
      rd.readAsText(file);
    });
  }

  // ---------- .oroshealth (OBF-4e) ----------
  // Every record as one orOS file (../recordpkg.js + package.js), the
  // documents' photos and PDFs in media/ by <sha256>.<jpg|pdf>. Opening
  // ADDS what this device lacks, with its ids; a record already here (or
  // deleted here) is kept as it is unless "Update with newer versions"
  // is ticked. Settings and the Medical ID here stay as they are;
  // reminders come in off. The result goes through C.merge + saveNow
  // (sync dirty); Undo removes the added records with tombstones, as
  // undoImport does, and puts back the copies an update replaced.
  var RP = window.OrosRecordPkg || null, HPK = window.OrosHealthPackage || null;
  var fileUndo = null;
  // One document file of the bundle → Files › Health, only when that
  // name is not on the disk yet, through the checks of attaching one
  // (encodeAttachment: a PDF must start with "%PDF-", a picture is
  // re-drawn as a JPEG, no EXIF). → Promise<true when the file is there>
  function storeDocFile(name, key, media) {
    var fs = fsApi(), path = C.atPath(name);
    if (!fs || !path) return Promise.resolve(false);
    return Promise.resolve().then(function () { return fs.readBlob(path); })
      .then(function (b) { return !!b; }, function () { return false; })
      .then(function (there) {
        if (there) return true;
        var item = key && Object.prototype.hasOwnProperty.call(media, key) ? media[key] : null;
        if (!item || !(item.blob || item.bytes)) return false;
        var type = /\.pdf$/.test(name) ? "application/pdf" : "image/jpeg";
        var blob = item.blob ? item.blob.slice(0, item.blob.size, type) : new Blob([item.bytes], { type: type });
        return encodeAttachment(blob).then(function (enc) {
          if (!enc || enc.ext !== name.split(".").pop()) return false;
          return Promise.resolve(fs.writeBlob(path, enc.blob)).then(function () { return true; });
        });
      }).catch(function () { return false; });
  }
  var recFile = RP && HPK && window.OrosBundle ? RP.ui(HPK.DESC, {
    lang: function () { return LANG; },
    get: function () { return sliceGet(); },
    title: function () { return t("app"); },
    // media/: every file the documents name, read from the orOS disk;
    // state.ats = { "<file name>": "<media key>" } goes into content.json
    files: function (state) {
      var fs = fsApi(), B = window.OrosBundle, out = [], ats = {}, chain = Promise.resolve();
      if (!fs) return out;
      (state.dc || []).forEach(function (d) {
        HPK.atsOf(d).forEach(function (name) {
          chain = chain.then(function () {
            if (ats[name]) return;
            return Promise.resolve(fs.readBlob(C.atPath(name))).then(function (blob) {
              if (!blob || !blob.size) return;
              return B.digest(blob).then(function (dg) {
                var key = dg.sha + "." + name.split(".").pop();
                ats[name] = key;
                if (!out.some(function (f) { return f.key === key; }))
                  out.push({ key: key, blob: blob, type: /\.pdf$/.test(name) ? "application/pdf" : "image/jpeg" });
              });
            }).catch(function () {});
          });
        });
      });
      return chain.then(function () { state.ats = ats; return out; });
    },
    // the files of the documents this open adds (or updates); a name
    // whose file could not be stored leaves the document
    media: function (read, res) {
      var next = res.next, src = read && read.content && read.content.data;
      var ats = src && src.ats && typeof src.ats === "object" ? src.ats : {}, media = (read && read.media) || {};
      var want = {}, chain = Promise.resolve();
      res.addedIds.concat(res.updatedIds).forEach(function (id) { want[id] = 1; });
      (next.dc || []).forEach(function (d) {
        if (!want[d.id] || !d.sc) return;
        var kept = [];
        HPK.atsOf(d).forEach(function (name) {
          chain = chain.then(function () {
            return storeDocFile(name, typeof ats[name] === "string" ? ats[name] : "", media);
          }).then(function (ok) { if (ok) kept.push(name); });
        });
        chain = chain.then(function () { if (kept.length) d.sc = kept.sort(cmpStr); else delete d.sc; });
      });
      return chain.then(function () { return next; });
    },
    set: function (next, info) {
      var before = {}, prev = {}, upd = {};
      ((info && info.updatedIds) || []).forEach(function (id) { upd[id] = 1; });
      HPK.COLLS.forEach(function (c) {
        before[c] = {};
        data[c].forEach(function (x) {
          before[c][x.id] = 1;
          if (upd[x.id]) (prev[c] = prev[c] || []).push(JSON.parse(JSON.stringify(x)));
        });
      });
      data = C.merge(next, next);
      saveNow();
      var added = {};
      HPK.COLLS.forEach(function (c) {
        added[c] = data[c].filter(function (x) { return !before[c][x.id]; }).map(function (x) { return x.id; });
      });
      fileUndo = { added: added, prev: prev };
      var d = $("hl-set");
      if (d && d.open) d.close();
      render();
    },
    // Undo: what this open added goes again, with tombstones; a record
    // an update replaced gets its old copy back (stamped newer, so sync
    // carries it); files no document names any more leave the disk later.
    deleteIds: function () {
      var u = fileUndo, now = Date.now(), names = [];
      fileUndo = null;
      if (!u) return;
      HPK.COLLS.forEach(function (c) {
        var gone = {};
        (u.added[c] || []).forEach(function (id) { gone[id] = 1; });
        data[c] = data[c].filter(function (x) {
          if (!gone[x.id]) return true;
          var k = c + ":" + x.id;
          data.tombs[k] = Math.max(now, x.m, data.tombs[k] || 0);
          if (c === "dc") names = names.concat(x.sc || []);
          return false;
        });
        (u.prev[c] || []).forEach(function (row) {
          var cur = findRow(c, row.id);
          if (cur && c === "dc") names = names.concat(cur.sc || []);
          row.m = nextM(c, row.id);
          putRow(c, row);
        });
      });
      saveNow();
      render();
      dropFilesLater(names);
      showToast(recFile ? recFile.text("undone") : t("imp.undone"));
    },
    toast: function (text, undo) { if (undo) undoToast(text, undo); else showToast(text); }
  }) : null;

  // ---------- Import from another app ----------
  // Withings / OMRON / Samsung Health / Apple Health → readings.
  // Parsing and the plan are pure (import.js, OrosHealthImport); here:
  // pick → (progress) → preview → ONE write + one sync mark → toast
  // with Undo. Nothing from the file is inserted as HTML (el() sets
  // textContent). Apple's export.xml is streamed, never read whole.
  var IMP_ACCEPT = ".zip,.csv,.xml,.txt,application/zip,text/csv,text/xml,application/xml";
  var IMP_MAX_ADD = 25000;             // readings one import may add (localStorage)
  function startImport() {
    var I = window.OrosHealthImport;
    if (!I) return;
    var prog = null;
    Promise.resolve(pickFile(IMP_ACCEPT)).then(function (file) {
      if (!file) return null;                  // cancel = silent exit
      var bar = null;
      if (file.size > 4 * 1024 * 1024) {
        prog = makeDialog("hl-imp-prog", t("imp.title"));
        prog.appendChild(el("p", "dlg-text", t("imp.reading")));
        bar = el("progress", "imp-prog");
        bar.max = 1;
        prog.appendChild(bar);
        prog.addEventListener("cancel", function (e) { e.preventDefault(); });
        openDialog(prog);
      }
      return I.readBlob(file, String(file.name || ""), function (f) { if (bar) bar.value = f; });
    }).then(function (res) {
      if (prog) { prog.close(); prog = null; }
      if (!res) return;
      if (res.error) { showToast(t("imp." + (res.error === "big" || res.error === "empty" ? res.error : "bad"))); return; }
      importPreview(res);
    }).catch(function () {
      if (prog) prog.close();
      showToast(t("imp.bad"));
    });
  }
  function importPreview(res) {
    var I = window.OrosHealthImport;
    var pl = I.plan(res, data, IMP_MAX_ADD);
    var dlg = makeDialog("hl-imp", t("imp.title"));
    dlg.classList.add("wide");
    var tag = I.SRC_TAG[res.source] || res.source;
    dlg.appendChild(el("p", "dlg-text imp-src", t("imp.from", { s: tag })));
    if (pl.from) dlg.appendChild(hint(t("imp.range", { a: fmtDate(pl.from, false), b: fmtDate(pl.to, false) })));
    var ul = el("ul", "imp-list");
    C.BUILTIN.forEach(function (tid) {
      var p = pl.per[tid];
      if (p) ul.appendChild(el("li", "", t("imp.row", { k: typeName(tid), n: p.n, a: p.add })));
    });
    if (pl.have) ul.appendChild(el("li", "", t("imp.have", { n: pl.have })));
    dlg.appendChild(ul);
    var conv = ["lb", "mmol", "f", "frac"].filter(function (k) { return res.conv[k]; })
      .map(function (k) { return t("imp.conv." + k); });
    if (conv.length) dlg.appendChild(hint(t("imp.conv", { l: conv.join(", ") })));
    var sk = res.skip, skl = [];
    if (sk.comp) skl.push(t("imp.sk.comp", { n: sk.comp }));
    if (sk.height) skl.push(t("imp.sk.height", { n: sk.height }));
    if (sk.hrs) skl.push(res.hrDays ? t("imp.sk.hrsDay", { n: sk.hrs, d: res.hrDays }) : t("imp.sk.hrs", { n: sk.hrs }));
    ["half", "dup", "bad", "other"].forEach(function (k) { if (sk[k]) skl.push(t("imp.sk." + k, { n: sk[k] })); });
    if (skl.length) {
      dlg.appendChild(el("div", "dlg-sub", t("imp.skipT")));
      var su = el("ul", "imp-list dim");
      skl.forEach(function (s) { su.appendChild(el("li", "", s)); });
      dlg.appendChild(su);
    }
    if (pl.cut) dlg.appendChild(hint(t("imp.cut", { n: pl.add.length, c: pl.cut })));
    dlg.appendChild(hint(pl.add.length ? t("imp.keep", { g: tag }) : t("imp.none")));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    if (pl.add.length) {
      var go = button(t("imp.go", { n: pl.add.length }), "primary", function () {
        dlg.close();
        // planned again on the data as it is NOW (a pull may have landed)
        applyImport(I.plan(res, data, IMP_MAX_ADD));
      });
      go.id = "hl-imp-go";
      acts.appendChild(go);
    }
    dlg.appendChild(acts);
    openDialog(dlg);
  }
  // ONE write: new rows stamped past any tombstone of the same id (an
  // undone import can be imported again), then one saveNow() = one
  // sync mark.
  function applyImport(pl) {
    var now = Date.now(), have = {}, ids = [];
    data.en.forEach(function (e) { have[e.id] = 1; });
    pl.add.forEach(function (x) {
      if (have[x.id]) return;
      var fl = (x.fl || []).map(function (f) { return t("imp." + f); }).join(", ");
      var row = C.normEntry({ id: x.id, m: Math.max(now, (data.tombs["en:" + x.id] || 0) + 1), t: x.t, at: x.at, v: x.v,
        c: x.c, a: x.a, p: x.p, n: x.n && fl ? x.n + " · " + fl : (x.n || fl), g: x.g });
      if (!row) return;
      have[x.id] = 1;
      data.en.push(row);
      ids.push(x.id);
    });
    if (!ids.length) { showToast(t("imp.none")); return; }
    data.en.sort(function (a, b) { return cmpStr(a.id, b.id); });
    saveNow();
    render();
    undoToast(t("imp.done", { n: ids.length }), function () { undoImport(ids); });
  }
  // Undo on the CURRENT data: every imported row goes, tombstoned at
  // least as new as the row (a device that already pulled it drops it).
  function undoImport(ids) {
    var gone = {}, now = Date.now();
    ids.forEach(function (id) { gone[id] = 1; });
    data.en = data.en.filter(function (e) {
      if (!gone[e.id]) return true;
      var k = "en:" + e.id;
      data.tombs[k] = Math.max(now, e.m, data.tombs[k] || 0);
      return false;
    });
    saveNow();
    render();
    showToast(t("imp.undone"));
  }

  function settingsDialog() {
    var set = settings();
    var dlg = makeDialog("hl-set", t("set.title"));
    dlg.appendChild(el("div", "dlg-sub", t("set.units")));
    var u1 = el("div", "row3");
    var wu = select([["kg", "kg"], ["lb", "lb"]], set.wu);
    var gu = select([["mgdl", "mg/dL"], ["mmol", "mmol/L"]], set.gu);
    var tu = select([["c", "°C"], ["f", "°F"]], set.tu);
    u1.appendChild(field(t("set.wu"), wu));
    u1.appendChild(field(t("set.gu"), gu));
    u1.appendChild(field(t("set.tu"), tu));
    dlg.appendChild(u1);
    [[wu, "wu"], [gu, "gu"], [tu, "tu"]].forEach(function (p) {
      p[0].addEventListener("change", function () { var o = {}; o[p[1]] = p[0].value; editSettings(o); render(); });
    });
    var inch = set.wu === "lb";
    var hi = input("text", set.h ? fmtEdit(inch ? set.h / 25.4 : set.h / 10, inch ? 1 : 0) : "", "decimal");
    dlg.appendChild(field(t("set.height", { u: inch ? "in" : "cm" }), hi));
    dlg.appendChild(hint(t("set.heightHint")));
    hi.addEventListener("change", function () {
      var raw = hi.value.trim();
      if (!raw) { hi.classList.remove("bad"); if (settings().h) editSettings({ h: 0 }); render(); return; }
      var x = parseNum(raw), mm = Math.round(inch ? x * 25.4 : x * 10);
      var okv = !isNaN(x) && mm >= 500 && mm <= 2500;
      hi.classList.toggle("bad", !okv);
      if (okv && mm !== settings().h) { editSettings({ h: mm }); render(); }
    });
    var fw = el("label", "chk");
    var fc = el("input");
    fc.type = "checkbox";
    fc.checked = !!set.fw;
    fc.addEventListener("change", function () { editSettings({ fw: fc.checked ? 1 : 0 }); render(); });
    fw.appendChild(fc);
    fw.appendChild(el("span", "", t("set.fit")));
    dlg.appendChild(fw);

    dlg.appendChild(el("div", "dlg-sub", t("set.kinds")));
    var kl = el("div", "kind-list");
    function paintKinds() {
      kl.innerHTML = "";
      C.typeList(data).forEach(function (ty) {
        var r = el("div", "kind-row" + (ty.h ? " off" : ""));
        r.appendChild(kindIcon(ty.id));
        r.appendChild(el("span", "kind-n", typeName(ty.id) + (ty.h ? " · " + t("set.hidden") : "")));
        r.appendChild(iconBtn("mini", UI.edit, t("set.edit") + ": " + typeName(ty.id), function () { dlg.close(); kindDialog(ty.id); }));
        r.appendChild(iconBtn("mini", ty.h ? UI.eyeOff : UI.eye, (ty.h ? t("set.show") : t("set.hideKind")) + ": " + typeName(ty.id), function () {
          editType(ty.id, { h: ty.h ? 0 : 1 });
          paintKinds();
          render();
        }));
        kl.appendChild(r);
      });
    }
    paintKinds();
    dlg.appendChild(kl);
    dlg.appendChild(txtBtn("dlg-btn", UI.plus, t("home.own"), function () { dlg.close(); kindDialog(null); }));

    dlg.appendChild(el("div", "dlg-sub", t("sy.kinds")));
    var sl = el("div", "kind-list");
    function paintSyms() {
      sl.innerHTML = "";
      C.symKindList(data).forEach(function (k) {
        var r = el("div", "kind-row" + (k.h ? " off" : ""));
        r.appendChild(kindIcon("sym"));
        r.appendChild(el("span", "kind-n", symName(k.id) + (k.h ? " · " + t("set.hidden") : "")));
        if (!C.isSymBuiltin(k.id)) {
          r.appendChild(iconBtn("mini", UI.edit, t("set.edit") + ": " + symName(k.id), function () { dlg.close(); symKindDialog(k.id, null); }));
        }
        r.appendChild(iconBtn("mini", k.h ? UI.eyeOff : UI.eye, (k.h ? t("set.show") : t("set.hideKind")) + ": " + symName(k.id), function () {
          editSymKind(k.id, { h: k.h ? 0 : 1 });
          paintSyms();
          render();
        }));
        sl.appendChild(r);
      });
    }
    paintSyms();
    dlg.appendChild(sl);
    dlg.appendChild(txtBtn("dlg-btn", UI.plus, t("sy.own"), function () { dlg.close(); symKindDialog(null, null); }));

    dlg.appendChild(el("div", "dlg-sub", t("set.export")));
    var ex = el("div", "btn-col");
    ex.appendChild(button(t("set.csv"), "", exportCsv));
    ex.appendChild(button(t("set.json"), "", exportJson));
    ex.appendChild(button(t("set.restore"), "", restoreJson));
    if (recFile) {                       // .oroshealth (the record kit)
      [["osave", function () { recFile.save(); }], ["oopen", function () { recFile.open(); }],
       ["ofolder", function () { recFile.openFolder(); }]].forEach(function (o) {
        var b = button(t("set." + o[0]), "", function () { dlg.close(); o[1](); });
        b.id = "hl-" + o[0];
        ex.appendChild(b);
      });
    }
    dlg.appendChild(ex);
    if (window.OrosHealthImport && window.OrosImportKit) {
      dlg.appendChild(el("div", "dlg-sub", t("imp.head")));
      var im = el("div", "btn-col");
      var ib = button(t("imp.btn"), "", function () { dlg.close(); startImport(); });
      ib.id = "hl-imp-btn";
      im.appendChild(ib);
      dlg.appendChild(im);
      dlg.appendChild(hint(t("imp.hint")));
    }
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.close"), "primary", function () { dlg.close(); render(); }));
    dlg.appendChild(acts);
    openDialog(dlg);
  }

  // ---------- 12. Keyboard, palette, sync slice, deep link, boot ----------
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
    // 1–4 switch tabs (not while typing, not in a dialog)
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
    api.registerSlice("health", sliceGet, sliceSet, STORAGE_KEY, C.merge);
  }
  function sliceGet() { return C.merge(data, data); }   // canonical copy (R26)
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.en)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.merge(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;
    // Never repaint under the user's fingers; paint when they leave the field.
    if (typing() || document.querySelector("dialog[open]")) { pendingRender = true; return; }
    var v = $("view"), top = v.scrollTop;
    render();
    v.scrollTop = top;
  }

  // Deep link (reminder "health:<kind>" → a new reading of that kind).
  // Live push from the shell, or a one-shot staged id taken at boot.
  window.__orosHealthOpen = function (tid) {
    if (typeof tid !== "string" || !C.ID_RE.test(tid)) return;
    if (tid === "meds") {                      // a dose reminder or a refill warning
      var od = document.querySelector("dialog[open]");
      if (od) od.close();
      prefs.mv = "today";
      setTab("meds");
      return;
    }
    if (tid === "appts" || tid === "vax" || tid === "record") {   // wave 3 notices
      var od2 = document.querySelector("dialog[open]");
      if (od2) od2.close();
      prefs.rv = tid === "appts" ? "appt" : tid === "vax" ? "vax" : "id";
      savePrefs();
      setTab("record");
      return;
    }
    var ty = C.typeRow(data, tid);
    if (!ty) { showToast(t("feed.gone")); return; }
    if (prefs.tab !== "home") setTab("home");
    var open = document.querySelector("dialog[open]");
    if (open) open.close();
    entryDialog(tid, null);
  };
  function takePending() {
    var id = null;
    try {
      id = sessionStorage.getItem("oros-health-open");
      if (id) sessionStorage.removeItem("oros-health-open");
    } catch (e) {}
    if (!id) { try { id = new URLSearchParams(location.search).get("open"); } catch (e) {} }
    if (id) setTimeout(function () { window.__orosHealthOpen(id); }, 250);
  }

  // Universal search deep link (shell __orosOpenAt / __orosTakeTarget):
  // target { entry: id }. History tab, then the reading's edit dialog,
  // as a History row click does. Unknown reading → no-op; an open
  // dialog (unsaved edits) wins → no-op.
  // Wave 3 targets: { appt } / { vax } / { doc } / { al } / { cn } open
  // the Record tab and that row's editor; { id: 1 } the Medical ID.
  var REC_TARGETS = { appt: ["ap", "appt"], vax: ["vx", "vax"], doc: ["dc", "docs"], al: ["al", "id"], cn: ["cn", "id"] };
  function openRecordTarget(tg) {
    var key = null;
    Object.keys(REC_TARGETS).forEach(function (k) { if (!key && typeof tg[k] === "string") key = k; });
    if (!key && tg.id !== 1) return false;
    if (document.querySelector("dialog[open]")) return true;
    if (!key) { prefs.rv = "id"; savePrefs(); setTab("record"); return true; }
    var spec = REC_TARGETS[key], row = findRow(spec[0], tg[key]);
    if (!row) return true;
    prefs.rv = spec[1];
    savePrefs();
    setTab("record");
    var open = { appt: apptDialog, vax: vaxDialog, doc: docDialog, al: allergyDialog, cn: condDialog };
    open[key](row.id);
    return true;
  }
  function openSearchTarget(t) {
    // "Open with" an .oroshealth file (fileopen.js): { openFile: { token } },
    // the File taken once with window.parent.__orosTakeFile(token)
    if (t && t.openFile) { if (recFile) recFile.openTarget(t.openFile); return; }
    // Single app (solo.js) icon shortcuts: { add: kind } → a new
    // reading of that kind, as its reminder opens it.
    if (t && typeof t === "object" && typeof t.add === "string") { window.__orosHealthOpen(t.add); return; }
    if (t && typeof t === "object" && openRecordTarget(t)) return;
    if (t && (typeof t.med === "string" || typeof t.sym === "string")) {
      if (document.querySelector("dialog[open]")) return;
      if (typeof t.med === "string") {
        if (!C.medById(data, t.med)) return;
        prefs.mv = "list";
        setTab("meds");
        medDialog(t.med);
      } else {
        var sy = findRow("sy", t.sym);
        if (!sy) return;
        if (prefs.tab !== "history") setTab("history");
        symDialog(sy, null);
      }
      return;
    }
    var e = t && typeof t.entry === "string" ? findRow("en", t.entry) : null;
    if (!e || !C.typeRow(data, e.t)) return;
    if (document.querySelector("dialog[open]")) return;
    if (prefs.tab !== "history") setTab("history");
    entryDialog(e.t, e);
  }
  window.__orosOpenAt = openSearchTarget;
  function takeSearchTarget() {
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === "function") {
        var pendingTarget = window.parent.__orosTakeTarget("health");
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
        if (pendingRender && !typing() && !document.querySelector("dialog[open]")) {
          var v = $("view"), top = v.scrollTop;
          render();
          v.scrollTop = top;
        }
      }, 0);
    });
    document.addEventListener("close", function () {
      setTimeout(function () { if (pendingRender && !typing() && !document.querySelector("dialog[open]")) render(); }, 0);
    }, true);
    var rsT = null, lastW = $("view").clientWidth;
    window.addEventListener("resize", function () {
      clearTimeout(rsT);
      rsT = setTimeout(function () {
        var w = $("view").clientWidth;
        if (Math.abs(w - lastW) > 30 && prefs.tab === "charts" && !typing()) { lastW = w; render(); }
      }, 200);
    });
    // Workouts may change body weights in another frame or device.
    window.addEventListener("storage", function (e) {
      if (e.key === FIT_KEY && settings().fw && !typing() && !document.querySelector("dialog[open]")) render();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") savePrefsNow();
    });
    window.addEventListener("pagehide", savePrefsNow);
    window.addEventListener("afterprint", function () { var p = $("print"); if (p) p.innerHTML = ""; });
    wireKeyboard();
  }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "").match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("health.js v" + (m ? m[1] : "?") + " boot");
  })();

  function boot() {
    load();
    loadPrefs();
    document.title = t("app") + " · orOS";
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    render();
    takePending();
    takeSearchTarget();
  }

  boot();
})();
