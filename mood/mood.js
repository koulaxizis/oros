// ============================================================
// orOS Mood — App logic (version stamped by CI) — Clean release
// Capturing how you feel must take seconds, not minutes.
// Entries are additive-primary; edits are LWW per field (fm);
// deletes leave tombstones (merge-safe). Mood data is PERSONAL: it lives
// in this device's localStorage and travels ONLY through the
// encrypted orOS sync slice — no network calls, ever, besides
// the sync engine itself.
// Sections:
//   1. Constants, i18n, emotion vocabulary, icons, helpers
//   2. Data model + storage (entries, columns, tombstones)
//   2b. Merge engine (todo-contract, compact)
//   3. Capture flow (L1–L4) + chip menu (rename/delete)
//   3b. Insights view (distributions, calendar, streak,
//       habits, breakdowns — ALL render-time derived)
//   3c. Import from another app (Daylio, Bearable, eMoods, CSV)
//   4. Sync slice + palette
//   5. Wiring & boot
// Data:
//   slice "oros-mood-data" → travels (entries + custom columns)
//   DATA_VER 3: triggers live in cols.trig (ids), triadic
//   habits (water/food/meds = null|"yes"|"no").
// Time-of-day derives from the entry timestamp — no UI for it.
// Day boundaries derive from the LOCAL calendar (render-side).
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-mood-data";
  var DATA_VER    = 3;

  // ---------- 1. Constants, i18n, icons ----------
  var LANG = window.orosI18n ? window.orosI18n.lang()
           : (localStorage.getItem("oros-lang") === "el" ? "el" : "en");
  // Dates and numbers in the active language (en-GB / el-GR / de-DE …)
  function loc() { return window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB"); }
  // One decimal for display: en / el keep "3.0" as before, a pack
  // language gets its own decimal mark (German "3,0").
  function fix1(n) {
    if (LANG === "en" || LANG === "el") return n.toFixed(1);
    return n.toLocaleString(loc(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  var STRINGS = {
    en: {
      "app.title":     "Mood",
      "recent.title":  "Recent entries",
      "l1.title":      "How do you feel?",
      "l1.multi":      "You can pick more than one",
      "l2.title":      "Where & with whom",
      "l2.loc":        "Location",
      "l2.person":     "Person",
      "l2.none":       "None",
      "l2.add":        "Add…",
      "l2.add.ph":     "New value…",
      "l2.manage":     "Manage…",
      "ins.basics":    "The basics",
      "wat.yes":       "Drank enough water",
      "wat.no":        "Not enough water",
      "food.yes":      "Eaten",
      "food.no":       "Hungry",
      "meds.yes":      "Took medication",
      "meds.no":       "Skipped medication",
      "slp.yes":       "Slept well",
      "slp.no":        "Didn't sleep enough",
      "mv.yes":        "Moved / exercised",
      "mv.no":         "Sedentary day",
      "som.yes":       "Feeling well physically",
      "som.no":        "Not well physically",
      "caf.yes":       "Had coffee",
      "caf.no":        "No coffee",
      "alc.yes":       "Had alcohol",
      "alc.no":        "No alcohol",
      "scr.yes":       "Lots of screens",
      "scr.no":        "Mostly offline",
      "rit.med.yes":   "Meditated",
      "rit.med.no":    "Didn't meditate",
      "rit.read.yes":  "Read a book",
      "rit.read.no":   "Didn't read",
      "rit.tv.yes":    "Watched TV",
      "rit.tv.no":     "Didn't watch TV",
      "rit.mus.yes":   "Listened to music",
      "rit.mus.no":    "Didn't listen to music",
      "rit.gam.yes":   "Played videogames",
      "rit.gam.no":    "Didn't play videogames",
      "rit.cook.yes":  "Cooked my food",
      "rit.out.no":    "Ordered takeout",
      "rit.walk.yes":  "Went for a walk",
      "rit.walk.no":   "Stayed in",
      "rit.nap.yes":   "Took a nap",
      "rit.nap.no":    "No nap",
      "rit.jrn.yes":   "Journaled",
      "rit.jrn.no":    "Didn't journal",
      "rit.cho.yes":   "Did chores",
      "rit.cho.no":    "Skipped chores",
      "rit.bed.yes":   "Went to bed on time",
      "rit.bed.no":    "Stayed up late",
      "rit.outd.yes":  "Spent time outdoors",
      "rit.outd.no":   "Mostly indoors",
      "grp.rit":       "Rituals",
      "l4.note":       "Reflection (optional)",
      "l4.trig.title": "What triggered this?",
      "save":          "Save entry",
      "discard":       "Discard",
      "saved.toast":   "Saved",
      "recent.edit":   "Edit entry",
      "recent.del":    "Delete entry",
      "del.done":      "Deleted",
      "del.undo":      "Undo",
      "must.feel":     "Pick at least one feeling to save",
      "recent.q":      "Logged {time} ago — update it?",
      "recent.new":    "New entry",
      "rst.btn":       "Factory reset",
      "rst.body1":     "This permanently erases ALL mood entries and ALL custom values (locations, people) on every synced device. There is no undo.",
      "rst.yes1":      "Continue",
      "rst.body2":     "Last chance: entries, custom locations and people, and every statistic built on them will be erased. This cannot be undone.",
      "rst.yes2":      "Erase everything",
      "rst.cancel":    "Cancel",
      "rst.done":      "Fresh start — everything erased",
      "col.menu.rename": "Rename",
      "col.menu.del":    "Delete",
      "col.dup":         "That value already exists",
      "col.renamed":     "Renamed",
      "col.del.done":    "Deleted",
      "col.del.undo":    "Undo",
      "insights":        "Insights",
      "capture":         "Capture",
      "ins.r7":          "7 days",
      "ins.r30":         "30 days",
      "ins.rall":        "All",
      "ins.empty":       "No entries yet — your stats will appear with your first check-in.",
      "ins.dist.title":  "How you felt",
      "ins.avg":         "avg {n}",
      "ins.habits.title":"Habits",
      "ins.hab.days":    "{y} of {n} logged days",
      "ins.streak.val":  "{n} days in a row",
      "ins.logged":      "Logged days: {n}",
      "ins.cal.title":   "Calendar",
      "ins.cal.prev":    "Previous month",
      "ins.cal.next":    "Next month",
      "ins.cal.today":   "Today",
      "ins.day.entries": "Entries",
      "ins.loc.title":   "Locations",
      "ins.per.title":   "People",
      "ins.ctx.none":    "Nothing logged in this range.",
      "ins.filters":     "Filters",
      "ins.showing":     "Showing {x} of {y} entries",
      "ins.clear":       "Clear filters",
      "tab.ent":         "Entries",
      "ent.search":      "Search entries…",
      "ins.trends.title":"Patterns",
      "tr.loc":          "When you're at \u201C{x}\u201D, you often feel {e} ({d}pt more than usual).",
      "tr.person":       "When you're with \u201C{x}\u201D, you often feel {e} ({d}pt more than usual).",
      "tr.hab":          "When you mark \u201C{h}\u201D, you often feel {e} ({d}pt more than usual).",
      "tr.freq":         "You mark \u201C{h}\u201D on {p}% of your logged days.",
      "tr.pair":         "When you feel {a}, you also mark {b} ({p}% of the time).",
      "tr.trig":         "When \u201C{x}\u201D triggers it, you often feel {e} ({d}pt more than usual).",
      "tr.per":          "On period days, you often feel {e} ({d}pt more than usual).",
      "ins.int.title":   "Intensity shifts",
      "ins.int.hint":    "Average intensity now vs earlier in this range",
      "ins.dow.title":   "By weekday",
      "ins.mom.title":   "This week vs last",
      "mom.pos":         "Share of entries with positive feelings (happy · calm · excited)",
      "mom.this":        "This week",
      "mom.prev":        "Last week",
      "rep.last":        "Repeat last",
      "rec.title":       "Weekly recap",
      "rec.top":         "Top feeling",
      "rec.pos":         "Positive share",
      "rec.entries":     "Entries this week",
      "exp.btn":         "Export PDF",
      "exp.done":        "PDF exported",
      "exp.err":         "PDF library not found (vendor/jspdf missing).",
      "exp.summary":     "Overview",
      "exp.row.entries": "Entries in range",
      "exp.row.days":    "Days logged",
      "exp.font.err":   "Greek font not found (vendor/NotoSans-Regular.ttf) — Greek text may not render in the PDF.",
      "exp.sheet":      "Open in Spreadsheet",
      "exp.sheetCap":   "Only the first {n} entries fit in one sheet",
      "exp.sheetHead":  "Date|Time|Feelings|Location|With|Trigger|Habits|Activities|Note",
      "ent.empty":      "No entries yet — they'll appear here after your first check-in.",
      "ent.noRes":      "No entries match \u201C{q}\u201D.",
      "grp.own":        "Your activities",
      "vc.open":        "Moods, activities & goals…",
      "vc.title":       "Moods, activities & goals",
      "vc.close":       "Close",
      "vc.tab.emo":     "Feelings",
      "vc.tab.act":     "Activities",
      "vc.tab.goal":    "Goals",
      "vc.hint.emo":    "Rename, give an emoji, reorder or hide any feeling, or add your own. Hidden feelings leave Capture; your old entries keep them.",
      "vc.hint.act":    "Rename both sides of a pair, give an emoji, reorder or hide, or add your own activities (tap once in Capture to mark them).",
      "vc.hint.goal":   "A goal counts the days you mark an activity, per week (Monday to Sunday) or per month.",
      "vc.up":          "Move up",
      "vc.down":        "Move down",
      "vc.icon":        "Emoji",
      "vc.name":        "Name",
      "vc.yes":         "Name (yes)",
      "vc.no":          "Name (no)",
      "vc.hide":        "Hide",
      "vc.show":        "Show",
      "vc.color":       "Colour",
      "vc.pos":         "Positive",
      "vc.add.emo":     "Add a feeling",
      "vc.add.act":     "Add an activity",
      "vc.added":       "Added",
      "gl.title":       "Goals",
      "gl.none":        "No goals yet. Example: “Moved / exercised” 3 times a week.",
      "gl.add":         "Add a goal",
      "gl.manage":      "Edit goals",
      "gl.del":         "Delete goal",
      "gl.act":         "Activity",
      "gl.times":       "Times",
      "gl.timesPer":    "× per",
      "gl.period":      "Period",
      "gl.week":        "week",
      "gl.month":       "month",
      "gl.per.w":       "{n}× a week",
      "gl.per.m":       "{n}× a month",
      "gl.prog":        "{d} of {n}",
      "gl.prog.w":      "{d} of {n} this week",
      "gl.prog.m":      "{d} of {n} this month",
      "gl.done":        "Reached",
      "gl.hist.w":      "Reached in {m} of the last {k} weeks",
      "gl.hist.m":      "Reached in {m} of the last {k} months",
      "px.title":       "Year in pixels",
      "px.prev":        "Previous year",
      "px.next":        "Next year",
      "px.empty":       "No entries in this year.",
      "seed.loc.0":     "At home",
      "seed.loc.1":     "At work",
      "seed.loc.2":     "Outdoors",
      "seed.loc.3":     "Commute",
      "seed.loc.4":     "Café & bars",
      "seed.per.0":     "Alone",
      "seed.per.1":     "Partner",
      "seed.per.2":     "Kids",
      "seed.per.3":     "Family",
      "seed.per.4":     "Friends",
      "seed.per.5":     "Colleagues",
      "seed.trig.0":    "Work deadline",
      "seed.trig.1":    "Argument",
      "seed.trig.2":    "Good news",
      "seed.trig.3":    "Exercise",
      "seed.trig.4":    "Sick day",
      "seed.trig.5":    "Late screens"
    },
    el: {
      "app.title":     "Διάθεση",
      "recent.title":  "Πρόσφατες καταχωρήσεις",
      "l1.title":      "Πώς νιώθεις;",
      "l1.multi":      "Μπορείς να διαλέξεις περισσότερα από ένα",
      "l2.title":      "Πού & με ποιον",
      "l2.loc":        "Τοποθεσία",
      "l2.person":     "Άνθρωπος",
      "l2.none":       "Κανένα",
      "l2.add":        "Προσθήκη…",
      "l2.add.ph":     "Νέα τιμή…",
      "l2.manage":     "Διαχείριση…",
      "ins.basics":    "Τα βασικά",
      "wat.yes":       "Ήπια αρκετό νερό",
      "wat.no":        "Δεν ήπια αρκετό νερό",
      "food.yes":      "Φαγωμένος",
      "food.no":       "Νηστικός",
      "meds.yes":      "Πήρα φάρμακα",
      "meds.no":       "Δεν πήρα φάρμακα",
      "slp.yes":       "Κοιμήθηκα καλά",
      "slp.no":        "Δεν κοιμήθηκα αρκετά",
      "mv.yes":        "Κινήθηκα",
      "mv.no":         "Καθιστική μέρα",
      "som.yes":       "Σωματικά καλά",
      "som.no":        "Σωματικά άρρωστος",
      "caf.yes":       "Ήπια καφέ",
      "caf.no":        "Καθόλου καφές",
      "alc.yes":       "Ήπια αλκοόλ",
      "alc.no":        "Καθόλου αλκοόλ",
      "scr.yes":       "Πολλές ώρες σε οθόνες",
      "scr.no":        "Σχεδόν εκτός οθονών",
      "rit.med.yes":   "Διαλογίστηκα",
      "rit.med.no":    "Δεν διαλογίστηκα",
      "rit.read.yes":  "Διάβασα βιβλίο",
      "rit.read.no":   "Δεν διάβασα",
      "rit.tv.yes":    "Έβλεπα τηλεόραση",
      "rit.tv.no":     "Δεν έβλεπα τηλεόραση",
      "rit.mus.yes":   "Άκουσα μουσική",
      "rit.mus.no":    "Δεν άκουσα μουσική",
      "rit.gam.yes":   "Έπαιξα βιντεοπαιχνίδια",
      "rit.gam.no":    "Δεν έπαιξα βιντεοπαιχνίδια",
      "rit.cook.yes":  "Μαγείρεψα",
      "rit.out.no":    "Παρήγγειλα απ' έξω",
      "rit.walk.yes":  "Πήγα βόλτα",
      "rit.walk.no":   "Έμεινα σπίτι",
      "rit.nap.yes":   "Έκανα σιέστα",
      "rit.nap.no":    "Χωρίς σιέστα",
      "rit.jrn.yes":   "Έγραψα στο ημερολόγιο",
      "rit.jrn.no":    "Δεν έγραψα στο ημερολόγιο",
      "rit.cho.yes":   "Έκανα δουλειές σπιτιού",
      "rit.cho.no":    "Παρέλειψα τις δουλειές",
      "rit.bed.yes":   "Κοιμήθηκα νωρίς",
      "rit.bed.no":    "Έμεινα ξύπνιος αργά",
      "rit.outd.yes":  "Βγήκα έξω",
      "rit.outd.no":   "Έμεινα κυρίως μέσα",
      "grp.rit":       "Ιεροτελεστίες",
      "l4.note":       "Σκέψη (προαιρετικό)",
      "l4.trig.title": "Τι το προκάλεσε;",
      "save":          "Αποθήκευση",
      "discard":       "Απόρριψη",
      "saved.toast":   "Αποθηκεύτηκε",
      "recent.edit":   "Επεξεργασία",
      "recent.del":    "Διαγραφή",
      "del.done":      "Διαγράφηκε",
      "del.undo":      "Αναίρεση",
      "must.feel":     "Διάλεξε τουλάχιστον ένα συναίσθημα για αποθήκευση",
      "recent.q":      "Καταχωρήθηκε πριν {time} — να ενημερωθεί;",
      "recent.new":    "Νέα καταχώρηση",
      "rst.btn":       "Επαναφορά εργοστασιακών",
      "rst.body1":     "Θα διαγραφούν ΟΛΕΣ οι καταχωρήσεις διάθεσης και ΟΛΕΣ οι custom τιμές (τοποθεσίες, άνθρωποι) από κάθε συγχρονισμένη συσκευή. Χωρίς αναίρεση.",
      "rst.yes1":      "Συνέχεια",
      "rst.body2":     "Τελευταία ευκαιρία: καταχωρήσεις, custom τοποθεσίες/άνθρωποι και όλα τα στατιστικά που βασίζονται σε αυτά σβήνουν. Δεν γίνεται αναίρεση.",
      "rst.yes2":      "Σβήσε τα όλα",
      "rst.cancel":    "Ακύρωση",
      "rst.done":      "Καθαρή αρχή — όλα διαγράφτηκαν",
      "col.menu.rename": "Μετονομασία",
      "col.menu.del":    "Διαγραφή",
      "col.dup":         "Υπάρχει ήδη αυτή η τιμή",
      "col.renamed":     "Μετονομάστηκε",
      "col.del.done":    "Διαγράφηκε",
      "col.del.undo":    "Αναίρεση",
      "insights":        "Στατιστικά",
      "capture":         "Καταγραφή",
      "ins.r7":          "7 ημέρες",
      "ins.r30":         "30 ημέρες",
      "ins.rall":        "Όλα",
      "ins.empty":       "Καμία καταχώρηση ακόμα — τα στατιστικά θα εμφανιστούν με την πρώτη καταγραφή.",
      "ins.dist.title":  "Πώς ένιωθες",
      "ins.avg":         "μέσο {n}",
      "ins.habits.title":"Συνήθειες",
      "ins.hab.days":    "{y} από {n} ημέρες καταγραφής",
      "ins.streak.val":  "{n} συνεχόμενες ημέρες",
      "ins.logged":      "Ημέρες με καταγραφή: {n}",
      "ins.cal.title":   "Ημερολόγιο",
      "ins.cal.prev":    "Προηγούμενος μήνας",
      "ins.cal.next":    "Επόμενος μήνας",
      "ins.cal.today":   "Σήμερα",
      "ins.day.entries": "Καταχωρήσεις",
      "ins.loc.title":   "Τοποθεσίες",
      "ins.per.title":   "Άνθρωποι",
      "ins.ctx.none":    "Τίποτα καταγεγραμμένο σε αυτό το εύρος.",
      "ins.filters":     "Φίλτρα",
      "ins.showing":     "Εμφανίζονται {x} από {y} καταχωρήσεις",
      "ins.clear":       "Καθαρισμός φίλτρων",
      "tab.ent":         "Καταχωρήσεις",
      "ent.search":      "Αναζήτηση καταχωρήσεων…",
      "ins.trends.title":"Τάσεις",
      "tr.loc":          "Όταν είσαι «{x}», νιώθεις συχνότερα {e} (κατά {d}pt πάνω από το σύνηθες).",
      "tr.person":       "Με «{x}» νιώθεις συχνότερα {e} (κατά {d}pt πάνω από το σύνηθες).",
      "tr.hab":          "Όταν σημειώνεις «{h}», νιώθεις συχνότερα {e} (κατά {d}pt πάνω από το σύνηθες).",
      "tr.freq":         "Σημειώνεις «{h}» στο {p}% των ημερών με καταγραφή.",
      "tr.pair":         "Όταν νιώθεις {a}, σημειώνεις και {b} ({p}% των φορών).",
      "tr.trig":         "Όταν σε «πυροδοτεί» «{x}», νιώθεις συχνότερα {e} (κατά {d}pt πάνω από το σύνηθες).",
      "tr.per":          "Κατά τις ημέρες περιόδου νιώθεις συχνότερα {e} (κατά {d}pt πάνω από το σύνηθες).",
      "ins.int.title":   "Αλλαγές έντασης",
      "ins.int.hint":    "Μέση ένταση τώρα vs νωρίτερα στο εύρος",
      "ins.dow.title":   "Ανά ημέρα της εβδομάδας",
      "ins.mom.title":   "Αυτή η εβδομάδα vs προηγούμενη",
      "mom.pos":         "Ποσοστό καταχωρήσεων με θετικά συναισθήματα (χαρούμενος · ήρεμος · ενθουσιασμένος)",
      "mom.this":        "Αυτή η εβδομάδα",
      "mom.prev":        "Προηγούμενη εβδομάδα",
      "rep.last":        "Επανάληψη τελευταίας",
      "rec.title":       "Εβδομαδιαία ανασκόπηση",
      "rec.top":         "Κορυφαίο συναίσθημα",
      "rec.pos":         "Θετικό μερίδιο",
      "rec.entries":     "Καταχωρήσεις εβδομάδας",
      "exp.btn":         "Εξαγωγή PDF",
      "exp.done":        "Το PDF εξήχθη",
      "exp.err":         "Δεν βρέθηκε η βιβλιοθήκη PDF (λείπει το vendor/jspdf).",
      "exp.summary":     "Επισκόπηση",
      "exp.row.entries": "Καταχωρήσεις στο εύρος",
      "exp.row.days":    "Ημέρες με καταγραφή",
      "exp.font.err":   "Δεν βρέθηκε η ελληνική γραμματοσειρά (vendor/NotoSans-Regular.ttf) — τα ελληνικά μπορεί να μη φανούν στο PDF.",
      "exp.sheet":      "Άνοιγμα στο Υπολογιστικό φύλλο",
      "exp.sheetCap":   "Χωρούν μόνο οι πρώτες {n} καταχωρήσεις σε ένα φύλλο",
      "exp.sheetHead":  "Ημερομηνία|Ώρα|Συναισθήματα|Τοποθεσία|Με ποιον|Αιτία|Συνήθειες|Δραστηριότητες|Σημείωση",
      "ent.empty":      "Καμία καταχώρηση ακόμα — θα εμφανιστούν εδώ μετά την πρώτη καταγραφή.",
      "ent.noRes":      "Καμία καταχώρηση δεν ταιριάζει με «{q}».",
      "grp.own":        "Οι δραστηριότητές σου",
      "vc.open":        "Διαθέσεις, δραστηριότητες & στόχοι…",
      "vc.title":       "Διαθέσεις, δραστηριότητες & στόχοι",
      "vc.close":       "Κλείσιμο",
      "vc.tab.emo":     "Συναισθήματα",
      "vc.tab.act":     "Δραστηριότητες",
      "vc.tab.goal":    "Στόχοι",
      "vc.hint.emo":    "Μετονόμασε, δώσε emoji, άλλαξε σειρά ή κρύψε όποιο συναίσθημα θέλεις, ή πρόσθεσε δικά σου. Όσα κρύβεις φεύγουν από την Καταγραφή· οι παλιές καταχωρήσεις τα κρατούν.",
      "vc.hint.act":    "Μετονόμασε και τις δύο πλευρές ενός ζεύγους, δώσε emoji, άλλαξε σειρά ή κρύψε, ή πρόσθεσε δικές σου δραστηριότητες (ένα πάτημα στην Καταγραφή τις σημειώνει).",
      "vc.hint.goal":   "Ένας στόχος μετρά τις μέρες που σημειώνεις μια δραστηριότητα, ανά εβδομάδα (Δευτέρα έως Κυριακή) ή ανά μήνα.",
      "vc.up":          "Πιο πάνω",
      "vc.down":        "Πιο κάτω",
      "vc.icon":        "Emoji",
      "vc.name":        "Όνομα",
      "vc.yes":         "Όνομα (ναι)",
      "vc.no":          "Όνομα (όχι)",
      "vc.hide":        "Απόκρυψη",
      "vc.show":        "Εμφάνιση",
      "vc.color":       "Χρώμα",
      "vc.pos":         "Θετικό",
      "vc.add.emo":     "Νέο συναίσθημα",
      "vc.add.act":     "Νέα δραστηριότητα",
      "vc.added":       "Προστέθηκε",
      "gl.title":       "Στόχοι",
      "gl.none":        "Κανένας στόχος ακόμα. Παράδειγμα: «Κινήθηκα» 3 φορές την εβδομάδα.",
      "gl.add":         "Νέος στόχος",
      "gl.manage":      "Επεξεργασία στόχων",
      "gl.del":         "Διαγραφή στόχου",
      "gl.act":         "Δραστηριότητα",
      "gl.times":       "Φορές",
      "gl.timesPer":    "φορές ανά",
      "gl.period":      "Περίοδος",
      "gl.week":        "εβδομάδα",
      "gl.month":       "μήνα",
      "gl.per.w":       "{n} φορές την εβδομάδα",
      "gl.per.m":       "{n} φορές τον μήνα",
      "gl.prog":        "{d} από {n}",
      "gl.prog.w":      "{d} από {n} αυτή την εβδομάδα",
      "gl.prog.m":      "{d} από {n} αυτόν τον μήνα",
      "gl.done":        "Επιτεύχθηκε",
      "gl.hist.w":      "Επιτεύχθηκε σε {m} από τις τελευταίες {k} εβδομάδες",
      "gl.hist.m":      "Επιτεύχθηκε σε {m} από τους τελευταίους {k} μήνες",
      "px.title":       "Η χρονιά σε pixel",
      "px.prev":        "Προηγούμενο έτος",
      "px.next":        "Επόμενο έτος",
      "px.empty":       "Καμία καταχώρηση σε αυτό το έτος.",
      "seed.loc.0":     "Στο σπίτι",
      "seed.loc.1":     "Στη δουλειά",
      "seed.loc.2":     "Στη φύση",
      "seed.loc.3":     "Μετακίνηση",
      "seed.loc.4":     "Καφέ & μπάρες",
      "seed.per.0":     "Μόνος",
      "seed.per.1":     "Σύντροφος",
      "seed.per.2":     "Παιδιά",
      "seed.per.3":     "Οικογένεια",
      "seed.per.4":     "Φίλοι",
      "seed.per.5":     "Συνάδελφοι",
      "seed.trig.0":    "Προθεσμία",
      "seed.trig.1":    "Έριδα",
      "seed.trig.2":    "Καλά νέα",
      "seed.trig.3":    "Άσκηση",
      "seed.trig.4":    "Μέρα αρρώστιας",
      "seed.trig.5":    "Οθόνες αργά"
    }
  };

  if (window.orosI18n) window.orosI18n.table(STRINGS, "mood", LANG);

  function t(key) {
    var p = STRINGS[LANG] || STRINGS.en;
    return p[key] !== undefined ? p[key]
         : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
  }

  // Fixed emotion vocabulary — 9, immutable (statistics need a
  // stable dictionary). Colors are SYSTEM hues only.
  var BUILTIN_EMOS = [
    { k: "happy",    i18n: "emo.happy",    col: "#87cf3e" },
    { k: "calm",     i18n: "emo.calm",     col: "#51a2da" },
    { k: "excited",  i18n: "emo.excited",  col: "#8c5ec7" },
    { k: "sad",      i18n: "emo.sad",      col: "#5277c3" },
    { k: "angry",    i18n: "emo.angry",    col: "#e06c75" },
    { k: "anxious",  i18n: "emo.anxious",  col: "#e0a44c" },
    { k: "tired",    i18n: "emo.tired",    col: "#9aa0ae" },
    { k: "stressed", i18n: "emo.stressed", col: "#ff7043" },
    { k: "numb",     i18n: "emo.numb",     col: "#6d4aff" }
  ];
  STRINGS.en["emo.happy"]    = "Happy";
  STRINGS.en["emo.calm"]     = "Calm";
  STRINGS.en["emo.excited"]  = "Excited";
  STRINGS.en["emo.sad"]      = "Sad";
  STRINGS.en["emo.angry"]    = "Angry";
  STRINGS.en["emo.anxious"]  = "Anxious";
  STRINGS.en["emo.tired"]    = "Tired";
  STRINGS.en["emo.stressed"] = "Stressed";
  STRINGS.en["emo.numb"]     = "Numb";
  STRINGS.el["emo.happy"]    = "Χαρούμενος";
  STRINGS.el["emo.calm"]     = "Ήρεμος";
  STRINGS.el["emo.excited"]  = "Ενθουσιασμένος";
  STRINGS.el["emo.sad"]      = "Λυπημένος";
  STRINGS.el["emo.angry"]    = "Θυμωμένος";
  STRINGS.el["emo.anxious"]  = "Αγχωμένος";
  STRINGS.el["emo.tired"]    = "Κουρασμένος";
  STRINGS.el["emo.stressed"] = "Πιεσμένος";
  STRINGS.el["emo.numb"]     = "Άδειος";
  if (window.orosI18n) window.orosI18n.table(STRINGS, "mood", LANG);

  // Triadic habits — shared by the capture L3 AND the insights
  // adherence view (one vocabulary, two consumers).
  var BUILTIN_HABITS = [
    // grp "hab" — the basics: health & physiology
    { f: "water",    grp: "hab", yes: "wat.yes",      no: "wat.no"      },
    { f: "food",     grp: "hab", yes: "food.yes",     no: "food.no"     },
    { f: "sleep",    grp: "hab", yes: "slp.yes",      no: "slp.no"      },
    { f: "move",     grp: "hab", yes: "mv.yes",       no: "mv.no"       },
    { f: "som",      grp: "hab", yes: "som.yes",      no: "som.no"      },
    { f: "caf",      grp: "hab", yes: "caf.yes",      no: "caf.no"      },
    { f: "alc",      grp: "hab", yes: "alc.yes",      no: "alc.no"      },
    { f: "scr",      grp: "hab", yes: "scr.yes",      no: "scr.no"      },
    { f: "meds",     grp: "hab", yes: "meds.yes",     no: "meds.no"     },
    // grp "rit" — daily rituals: leisure, mindfulness, home
    { f: "meditate", grp: "rit", yes: "rit.med.yes",  no: "rit.med.no"  },
    { f: "read",     grp: "rit", yes: "rit.read.yes", no: "rit.read.no" },
    { f: "tv",       grp: "rit", yes: "rit.tv.yes",   no: "rit.tv.no"   },
    { f: "music",    grp: "rit", yes: "rit.mus.yes",  no: "rit.mus.no"  },
    { f: "games",    grp: "rit", yes: "rit.gam.yes",  no: "rit.gam.no"  },
    { f: "cook",     grp: "rit", yes: "rit.cook.yes", no: "rit.out.no"  },
    { f: "walk",     grp: "rit", yes: "rit.walk.yes", no: "rit.walk.no" },
    { f: "nap",      grp: "rit", yes: "rit.nap.yes",  no: "rit.nap.no"  },
    { f: "journal",  grp: "rit", yes: "rit.jrn.yes",  no: "rit.jrn.no"  },
    { f: "chores",   grp: "rit", yes: "rit.cho.yes",  no: "rit.cho.no"  },
    { f: "bedtime",  grp: "rit", yes: "rit.bed.yes",  no: "rit.bed.no"  },
    { f: "outdoor",  grp: "rit", yes: "rit.outd.yes", no: "rit.outd.no" }
  ];

  // Seed values for the two custom columns (editable, deletable —
  // they live in STATE once seeded, not in this constant).
  // The factory values live in STRINGS as seed.<col>.<i>; en / el are
  // what saved seeds carry in bi (a pack language shows its own text
  // through seedText, saved data is never rewritten).
  function seedList(col, n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var k = "seed." + col + "." + i;
      out.push({ k: k, en: STRINGS.en[k], el: STRINGS.el[k] });
    }
    return out;
  }
  var LOC_SEED = seedList("loc", 5);
  var PERSON_SEED = seedList("per", 6);
  // Factory triggers: seeded ONCE into an empty list (a new column
  // never had a birth moment). Notes and own values stay the user's.
  var TRIG_SEED = seedList("trig", 6);
  // A seed's label in the active language (birth text for new seeds).
  function seedText(v) { return LANG === "el" ? v.el : LANG === "en" ? v.en : t(v.k); }

  // ---- Wave 30: custom feelings and activities (mood/vocab.js) ----
  // EMOTIONS / HABITS are now DERIVED from the built-ins plus the
  // user's vocabulary (state.vocab), rebuilt by refreshVocab() after
  // every load, pull and edit. Built-in keys never change, so old
  // entries keep their meaning; a hidden item only leaves Capture.
  //   EMOTIONS: [{k, label, col, ic, hid, builtin, pos}] in display order
  //   HABITS:   [{f, grp, yes, no, ic, hid}] built-in pairs, display order
  //   CUST_ACTS: [{id, label, ic, hid}] the user's own activities
  var V = window.OrosMoodVocab;
  var EMOTIONS = [], HABITS = [], CUST_ACTS = [];
  var POS_BUILTIN = ["happy", "calm", "excited"];
  var POS_EMOS = POS_BUILTIN.slice();
  var EMO_IDX = {}, ACT_IDX = {};
  function vocabOf() { return (state && state.vocab) || {}; }
  function refreshVocab() {
    var vo = vocabOf(), em = V.defMap(vo.emo), am = V.defMap(vo.act);
    var bE = {}, bH = {};
    BUILTIN_EMOS.forEach(function (x) { bE[x.k] = x; });
    BUILTIN_HABITS.forEach(function (x) { bH[x.f] = x; });
    EMOTIONS = V.orderIds(BUILTIN_EMOS.map(function (x) { return x.k; }), vo.emo, vo.eo).map(function (id) {
      var b = bE[id], d = em[id] || {};
      return {
        k: id, builtin: !!b,
        label: d.lab || (b ? t(b.i18n) : id),
        col: d.col || (b ? b.col : "#9aa0ae"),
        ic: d.ic || "", hid: !!d.hid,
        pos: b ? POS_BUILTIN.indexOf(id) >= 0 : !!d.pos
      };
    });
    POS_EMOS = EMOTIONS.filter(function (x) { return x.pos; }).map(function (x) { return x.k; });
    HABITS = []; CUST_ACTS = [];
    V.orderIds(BUILTIN_HABITS.map(function (x) { return x.f; }), vo.act, vo.ao).forEach(function (id) {
      var b = bH[id], d = am[id] || {};
      if (b) HABITS.push({ f: id, grp: b.grp, yes: b.yes, no: b.no,
                           labYes: d.lab || "", labNo: d.no || "", ic: d.ic || "", hid: !!d.hid });
      else CUST_ACTS.push({ id: id, label: d.lab || "?", ic: d.ic || "", hid: !!d.hid });
    });
    EMO_IDX = {}; ACT_IDX = {};
    EMOTIONS.forEach(function (x) { EMO_IDX[x.k] = x; });
    CUST_ACTS.forEach(function (x) { ACT_IDX[x.id] = x; });
  }
  function emoByK(k) { return EMO_IDX[k] || null; }
  function emoLabel(k) { var e = emoByK(k); return e ? e.label : String(k); }
  // A habit side's text: the user's own label, else the translation.
  function habLbl(h, side) {
    var own = side === "yes" ? h.labYes : h.labNo;
    return own || t(h[side]);
  }
  function habText(h, side) { return (h.ic && side === "yes" ? h.ic + " " : "") + habLbl(h, side); }
  function actById(id) { return ACT_IDX[id] || null; }
  function actText(a) { return (a.ic ? a.ic + " " : "") + a.label; }
  // Any activity a goal can count: built-in habit field or custom id.
  function anyActText(id) {
    if (V.isCustomId(id)) { var a = actById(id); return a ? actText(a) : "?"; }
    for (var i = 0; i < HABITS.length; i++) if (HABITS[i].f === id) return habText(HABITS[i], "yes");
    return id;
  }

  // Emotion face SVGs — one geometric family: circle face +
  // mouth + eyes variations. Color via currentColor (the TILE
  // carries the hue, not the glyph).
  var FA = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
  var FACE_HAPPY   = '<svg ' + FA + '><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.4"/></svg>';
  var FACE_CALM    = '<svg ' + FA + '><circle cx="12" cy="12" r="9"/><path d="M9 13.5h6"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.4"/></svg>';
  var FACE_EXCITED = '<svg ' + FA + '><circle cx="12" cy="12" r="9"/><path d="M8.5 13.5c1 1.8 2.1 2.6 3.5 2.6s2.5-.8 3.5-2.6"/><path d="M7.5 9.5l2 1M16.5 9.5l-2 1" /></svg>';
  var FACE_SAD     = '<svg ' + FA + '><circle cx="12" cy="12" r="9"/><path d="M8.5 16c.9-1.2 2.1-1.8 3.5-1.8s2.6.6 3.5 1.8"/><path d="M9 10h.01M15 10h.01" stroke-width="2.4"/></svg>';
  var FACE_ANGRY   = '<svg ' + FA + '><circle cx="12" cy="12" r="9"/><path d="M8.5 16c.9-1.2 2.1-1.8 3.5-1.8s2.6.6 3.5 1.8"/><path d="M8 9.5l2.5 1.2M16 9.5l-2.5 1.2"/></svg>';
  var FACE_ANXIOUS = '<svg ' + FA + '><circle cx="12" cy="12" r="9"/><path d="M9 15.5c.6-1.5 1.7-2.3 3-2.3s2.4.8 3 2.3"/><path d="M8.5 9.5l1.5 1M15.5 9.5l-1.5 1M12 8.2v.01" stroke-width="1.4"/></svg>';
  var FACE_TIRED   = '<svg ' + FA + '><circle cx="12" cy="12" r="9"/><path d="M9 14.5h6"/><path d="M8 9.8q1 .9 2 0M14 9.8q1 .9 2 0" stroke-width="1.4"/></svg>';
  var FACE_STRESSED= '<svg ' + FA + '><circle cx="12" cy="12" r="9"/><path d="M9 15.5h6"/><path d="M9 9.2h.01M15 9.2h.01" stroke-width="2.4"/><path d="M12 4.5v1.2M17.5 6.5l-.9.9M6.5 6.5l.9.9" stroke-width="1.2"/></svg>';
  var FACE_NUMB    = '<svg ' + FA + '><circle cx="12" cy="12" r="9"/><path d="M9 12h6"/><path d="M9 9h.01M15 9h.01" stroke-width="2.4"/></svg>';

  function faceFor(k) {
    var ex = emoByK(k);
    if (ex && (ex.ic || !ex.builtin)) {
      return '<span class="emo-ic" aria-hidden="true">' + esc(ex.ic || "\u2022") + "</span>";
    }
    switch (k) {
      case "happy":    return FACE_HAPPY;
      case "calm":     return FACE_CALM;
      case "excited":  return FACE_EXCITED;
      case "sad":      return FACE_SAD;
      case "angry":    return FACE_ANGRY;
      case "anxious":  return FACE_ANXIOUS;
      case "tired":    return FACE_TIRED;
      case "stressed": return FACE_STRESSED;
      case "numb":     return FACE_NUMB;
    }
    return FACE_CALM;
  }

  // Time of day — DERIVED, never stored, never asked:
  // 5–11 morning · 11–17 afternoon · 17–22 evening · else night.
  function tod(ts) {
    var h = new Date(ts).getHours();
    if (h >= 5  && h < 11) return "morning";
    if (h >= 11 && h < 17) return "afternoon";
    if (h >= 17 && h < 22) return "evening";
    return "night";
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function esc(s) {
    // the two quotes as \u escapes: the i18n string scanner reads a
    // bare quote in a regex as the start of a string
    return String(s).replace(/[&<>\u0022\u0027]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

// ---------- 2. Data model + storage ----------
// state = {
//   ver: 3, sm, om,
//   entries: [{ id, ts, mtime,
//               emotions: [{k, i}],   // k = EMOTIONS key, i = 1–5
//               loc, person,          // column-value ids | null
//               water, food, meds,    // TRIADIC null | "yes" | "no"
//               note, trigger,        // strings ("" = unset)
//               fm? }],               // MO-3: field -> stamp, added at
//                                     // the first edit (absent = mtime)
//   cols: { loc:  [{id, label, mtime, pos}],
//           person: [{id, label, mtime, pos}],
//           trig: [{id, label, mtime, pos}] },
//   deleted: { <entryId|colValId>: <tombstone ts> }
// }
var state = null;

function newState() {
  // MO-8: no "now" stamps on a fresh state. om decides whose chip
  // order wins in a merge; a new device holding only the seeds used
  // to win it and pushed the user's own chips to the end.
  var s = {
    ver: DATA_VER, sm: 0, om: 0,
    trigSeeded: true,
    entries: [], deleted: {},
    cols: { loc: [], trig: [], person: [] }
  };
  // Seed the three columns ONCE (fresh installs only — existing
  // devices keep whatever the user has curated).
  // #10: DETERMINISTIC seed ids — two fresh installs that sync
  // must NOT union into duplicate chips. Positional, stable.
  s.cols.loc  = LOC_SEED.map(function (v, i) {
    return { id: "seed-loc-" + i, label: seedText(v),
             bi: { en: v.en, el: v.el }, mtime: 0, pos: i };
  });
  s.cols.person = PERSON_SEED.map(function (v, i) {
    return { id: "seed-per-" + i, label: seedText(v),
             bi: { en: v.en, el: v.el }, mtime: 0, pos: i };
  });
  s.cols.trig = TRIG_SEED.map(function (v, i) {
    return { id: "seed-trig-" + i, label: seedText(v),
             bi: { en: v.en, el: v.el }, mtime: 0, pos: i };
  });
  return s;
}

// One-time factory triggers — καλύπτει και existing installs
// (νέα στήλη). Ισχύει πλήρως η κουρτίνα του χρήστη μετά: renames/
// deletes μέσω Manage, πρόσθετες τιμές μέσω Add….
function seedTriggers() {
  state.cols.trig = TRIG_SEED.map(function (v, i) {
    return { id: "seed-trig-" + i, label: seedText(v),
             bi: { en: v.en, el: v.el }, mtime: 0, pos: i };
  });
  state.trigSeeded = true;
  state.sm = Date.now();
  save();
}

function migrate(data) {
  if (!data || !Array.isArray(data.entries)) return null;
  if (!data.cols || !Array.isArray(data.cols.loc)) data.cols = { loc: [], trig: [], person: [] };
  if (!Array.isArray(data.cols.trig)) data.cols.trig = [];
  if (!Array.isArray(data.cols.person)) data.cols.person = [];
  if (!data.deleted || typeof data.deleted !== "object") data.deleted = {};
  if (typeof data.sm !== "number") data.sm = 0;
  if (typeof data.om !== "number") data.om = 0;
  data.entries.forEach(function (e) {
    if (!Array.isArray(e.emotions)) e.emotions = [];
    if (!e.note) e.note = "";
    // DATA_VER 3: triggers live in cols.trig (ids). Legacy
    // free-text strings migrate into matching presets
    // (case-insensitive trim); deterministic creation order =
    // stored entry order — both devices converge identically.
    var trg = (e.trigger || "").trim();
    if (!e.trig && trg) {
      var tnorm = trg.toLowerCase(), thit = null;
      data.cols.trig.forEach(function (v) {
        if (!thit && String(v.label).trim().toLowerCase() === tnorm) thit = v;
      });
      if (!thit) {
        thit = { id: "mig-trig-" + tnorm, label: trg, mtime: 0, pos: data.cols.trig.length };
        data.cols.trig.push(thit);
      }
      e.trig = thit.id;
    } else if (!e.trig) e.trig = null;
    e.trigger = "";                       // legacy string retired
    // DATA_VER 2: triadic habits. Wave-1 booleans migrate as:
    // true → "yes", false → null. The old unchecked state was
    // never a conscious "no" — honesty over retro-fitting.
    BUILTIN_HABITS.forEach(function (h) { var f = h.f;
      if (e[f] === true)          e[f] = "yes";
      else if (e[f] === false || e[f] === "yes" || e[f] === "no") {
        // false → null handled below; explicit values stay
        if (e[f] === false) e[f] = null;
      } else e[f] = null;
    });
    if (typeof e.ts !== "number") e.ts = Date.now();
    if (typeof e.mtime !== "number") e.mtime = e.ts;
    e.loc = e.loc || null; e.person = e.person || null;
    // Wave 30: custom activities (optional; absent = none)
    if (e.acts !== undefined) {
      var na = V.normActs(e.acts);
      if (na) e.acts = na;
      else if (e.fm && typeof e.fm === "object" && typeof e.fm.acts === "number") e.acts = null;
      else delete e.acts;
    }
  });
  // Wave 30: vocabulary + goals — normalised, and only kept when there
  // is something in them (an untouched install keeps the old shape).
  var nv = V.mergeVocab(data.vocab, null);
  if (nv) data.vocab = nv; else delete data.vocab;
  var ng = V.mergeGoals(data.goals, null);
  if (ng) data.goals = ng; else delete data.goals;
  data.cols.loc.concat(data.cols.trig, data.cols.person).forEach(function (v) {
    if (typeof v.mtime !== "number") v.mtime = 0;
    if (typeof v.pos !== "number") v.pos = 0;
  });
  // B2: backfill bilingual ids on EXISTING installs. Match by
  // normalized label against the factory seeds — a RENAMED seed
  // stops matching and stays a custom value (correct). Runs on
  // every migrate; touches nothing once bi exists.
  var SEEDSETS = {
    loc: LOC_SEED.map(function (v) { return v; }),
    person: PERSON_SEED.map(function (v) { return v; }),
    trig: TRIG_SEED.map(function (v) { return v; })
  };
  ["loc", "person", "trig"].forEach(function (cname) {
    (data.cols[cname] || []).forEach(function (v) {
      if (v.bi) return;                                  // already bilingual
      var nl = normLabel(v.label);
      (SEEDSETS[cname] || []).some(function (sv) {
        // #8: normLabel already lowercases — dead comparisons gone
        if (normLabel(sv.en) === nl || normLabel(sv.el) === nl) {
          v.bi = { en: sv.en, el: sv.el };
          return true;
        }
        return false;
      });
    });
  });
  // #7: pre-flag data (ver < 3) has lived through the trigger
  // feature's birth at least once — mark it seeded so a
  // deliberately emptied trig column never respawns defaults
  // on the next boot cycle. Trade-off: a pre-ver3 install whose
  // user never touched triggers also skips the factory presets.
  if (data.trigSeeded === undefined &&
      typeof data.ver === "number" && data.ver < DATA_VER) {
    data.trigSeeded = true;
  }
  data.ver = DATA_VER;
  return data;
}

// MO-7: unreadable data is copied verbatim to a device-local key
// BEFORE the fresh state is written over it (never synced).
var BROKEN_KEY = "oros-mood-data-broken";
function load() {
  var raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
  if (raw) {
    var data = null, err = null;
    try { data = migrate(JSON.parse(raw)); } catch (e) { data = null; err = e; }
    if (data) {
      state = data;
      refreshVocab();
      if (!state.cols.trig.length && !state.trigSeeded) seedTriggers();
      return;
    }
    try { localStorage.setItem(BROKEN_KEY, raw); } catch (e2) {}
    try { console.error("[orOS] mood: unreadable data, raw copy kept in " + BROKEN_KEY, err || ""); } catch (e3) {}
  }
  state = newState();
  refreshVocab();
  save();
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { /* quota */ }
  if (window.__orosSyncApi) window.__orosSyncApi.dirty();
}

// orosDialog lives in the parent shell (same-origin iframe).
// Standalone PWA mode -> null -> caller uses local fallback.
function dialogHost() {
  try {
    return window.orosDialog || window.parent.orosDialog || null;
  } catch (e) { return null; }
}

function entryById(id) {
  for (var i = 0; i < state.entries.length; i++) {
    if (state.entries[i].id === id) return state.entries[i];
  }
  return null;
}
function colValById(col, id) {
  if (!id) return null;
  var arr = state.cols[col] || [];
  for (var i = 0; i < arr.length; i++) {
    if (arr[i].id === id) return arr[i];
  }
  return null;
}

// B2: DISPLAY label for a column value. Bilingual seeds carry
// bi {en, el} and render in the ACTIVE language — the stored
// label is just the birth-time snapshot. Custom / renamed
// values have no bi: the user's typed text is their only truth
// (renaming a seed REMOVES bi in applyChipRename).
// A bilingual seed's table key, from its saved English text.
function seedKeyOf(en) {
  var all = LOC_SEED.concat(PERSON_SEED, TRIG_SEED);
  for (var i = 0; i < all.length; i++) if (all[i].en === en) return all[i].k;
  return null;
}
function colLabel(v) {
  if (!v) return "";
  if (v.bi && v.bi[LANG]) return v.bi[LANG];
  if (v.bi && LANG !== "en" && LANG !== "el") {
    var sk = seedKeyOf(v.bi.en);
    if (sk) return t(sk);
  }
  return v.label;
}

// ---------- 2b. Merge engine (todo-contract, compact) ----------
// Deterministic + symmetric: merge(A,B) === merge(B,A), byte for
// byte, and the getter returns exactly what the merge returns
// (MO-1: both go through canonState).
//   · entries — union by id, FIELD BY FIELD (MO-3): every field has
//     its own stamp in e.fm, so a note written on one device and a
//     habit marked on another both survive. An entry without fm
//     (never edited by this version) stamps every field with its
//     mtime; two such versions still merge whole-object, exactly as
//     before (ties by lexicographic JSON — identical both sides)
//   · column values — whole-value LWW by mtime (only the label
//     changes), per column, by id
//   · tombstones — union with max ts; newer edits resurrect
//     (the undo-delete toast relies on this, same as weather)
//   · ordering — entries = DESC ts, tie → id (derived at sort time,
//     not stored pos — a timeline has exactly ONE natural order);
//     column values = the om-larger side donates positions, tie →
//     the two id sequences compared as sequences (pickRef)
//   · canonState — tombstones sorted by id and pruned by DATA time
//     (never this device's clock); seed tombstones never expire
// NOTE (DATA_VER 3): fm is additive. A device on the previous
// mood.js carries it along whole and bumps only mtime when it edits;
// such an entry (mtime newer than every field stamp) is read as
// "every field changed at mtime", which is what that edit meant.

var ENTRY_FIELDS = ["emotions", "loc", "person", "trig", "note"]
  .concat(BUILTIN_HABITS.map(function (h) { return h.f; }), ["acts"]);
// Wave 30: OPTIONAL fields carry a stamp in fm only once an entry has
// them (field or stamp present). Entries that never used custom
// activities keep their exact old canonical shape — a device still on
// the previous mood.js would otherwise drop the extra stamp on every
// merge and both devices would upload forever.
var OPT_FIELDS = { acts: true };
function hasOpt(e, f) {
  return !!e && (e[f] !== undefined || (hasFm(e) && typeof e.fm[f] === "number"));
}
function fmFields(e) {
  return ENTRY_FIELDS.filter(function (f) { return !OPT_FIELDS[f] || hasOpt(e, f); });
}
var TOMB_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

function hasFm(e) { return !!(e && e.fm && typeof e.fm === "object"); }
function touchedByOldCode(e) {
  if (!hasFm(e)) return false;
  var mx = 0;
  for (var i = 0; i < ENTRY_FIELDS.length; i++) {
    var v = e.fm[ENTRY_FIELDS[i]];
    if (typeof v === "number" && v > mx) mx = v;
  }
  return (e.mtime || 0) > mx;
}
function fieldStamp(e, f) {
  if (!hasFm(e) || touchedByOldCode(e)) return e.mtime || 0;
  return (typeof e.fm[f] === "number") ? e.fm[f] : 0;
}
function ensureFm(e) {
  var fm = {}, fs = fmFields(e);
  for (var i = 0; i < fs.length; i++) fm[fs[i]] = fieldStamp(e, fs[i]);
  e.fm = fm;
}
function touchField(e, f, now) {
  ensureFm(e);
  e.fm[f] = now;
  e.mtime = now;
}
// Restore after a delete (Undo): the whole entry is new again.
function stampEntryNewest(e, now) {
  if (hasFm(e)) {
    var fm = {}, fs = fmFields(e);
    for (var i = 0; i < fs.length; i++) fm[fs[i]] = now;
    e.fm = fm;
  }
  e.mtime = now;
}

function newerObj(a, b) {
  if ((a.mtime || 0) !== (b.mtime || 0)) {
    return (a.mtime || 0) > (b.mtime || 0) ? a : b;
  }
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

// Two versions of ONE entry → one entry, field by field (MO-3).
function mergeEntry(x, y) {
  if (JSON.stringify(x) === JSON.stringify(y)) return x;
  if (!hasFm(x) && !hasFm(y)) return newerObj(x, y);
  var base = newerObj(x, y), out = {};
  Object.keys(base).forEach(function (k) { out[k] = base[k]; });
  var fm = {};
  ENTRY_FIELDS.forEach(function (f) {
    if (OPT_FIELDS[f] && !hasOpt(x, f) && !hasOpt(y, f)) return;   // never used on either side
    var sx = fieldStamp(x, f), sy = fieldStamp(y, f), w;
    if (sx !== sy) w = (sx > sy) ? x : y;
    else {
      var jx = JSON.stringify(x[f] === undefined ? null : x[f]);
      var jy = JSON.stringify(y[f] === undefined ? null : y[f]);
      w = (jx >= jy) ? x : y;                 // tie → same pick on both devices
    }
    if (w[f] === undefined) delete out[f];
    else out[f] = JSON.parse(JSON.stringify(w[f]));
    fm[f] = Math.max(sx, sy);
  });
  out.fm = fm;
  out.mtime = Math.max(x.mtime || 0, y.mtime || 0);
  return out;
}

function isAlive(x, tomb) {
  var ts = tomb ? tomb[x.id] : undefined;
  return ts === undefined || (x.mtime || 0) > ts;
}
// A version older than the tombstone is dead BEFORE it meets the
// other side: a field edited before the delete must not ride along
// when a newer edit elsewhere brings the entry back (the result
// would otherwise depend on the order devices merged in).
function mergeUnionList(a, b, tomb, pick) {
  var map = {};
  pick = pick || newerObj;
  (a || []).forEach(function (x) { if (isAlive(x, tomb)) map[x.id] = x; });
  (b || []).forEach(function (x) {
    if (!isAlive(x, tomb)) return;
    map[x.id] = map[x.id] ? pick(map[x.id], x) : x;
  });
  var alive = [];
  Object.keys(map).forEach(function (id) { alive.push(map[id]); });
  return alive;
}

function mergeCols(colsA, colsB, tomb) {
  var out = {};
  ["loc", "trig", "person"].forEach(function (name) {
    out[name] = mergeUnionList((colsA || {})[name], (colsB || {})[name], tomb);
  });
  return out;
}

// Which side's column order is the reference: larger om wins; a TIE
// compares the two id sequences (restricted to the survivors) as
// sequences — the same decision on both devices, and the merged
// order (reference + appended newcomers) picks itself again.
function pickRef(aArr, bArr, aOm, bOm, survivors) {
  if ((aOm || 0) !== (bOm || 0)) return (aOm || 0) > (bOm || 0) ? aArr : bArr;
  var alive = {};
  (survivors || []).forEach(function (v) { alive[v.id] = true; });
  var seq = function (arr) {
    return (arr || []).map(function (v) { return v.id; })
      .filter(function (id) { return alive[id]; });
  };
  var ka = seq(aArr), kb = seq(bArr), n = Math.min(ka.length, kb.length);
  for (var i = 0; i < n; i++) {
    if (ka[i] !== kb[i]) return ka[i] > kb[i] ? aArr : bArr;
  }
  return ka.length >= kb.length ? aArr : bArr;
}

function sortColVals(vals, ref) {
  var idx = {};
  (ref || []).forEach(function (v, i) { idx[v.id] = i; });
  vals.sort(function (x, y) {
    var ix = idx[x.id] !== undefined ? idx[x.id] : Infinity;
    var iy = idx[y.id] !== undefined ? idx[y.id] : Infinity;
    if (ix !== iy) return ix - iy;
    if ((x.mtime || 0) !== (y.mtime || 0)) return (y.mtime || 0) - (x.mtime || 0);
    return x.id < y.id ? -1 : (x.id > y.id ? 1 : 0);
  });
  vals.forEach(function (v, i) { v.pos = i; });
}

// #10: label-normalized dedupe. Devices that seeded the same
// value with DIFFERENT ids (pre-deterministic-id installs) still
// converge to one chip. Winner: newest mtime, tie → smaller id
// (deterministic & symmetric — merge(A,B) === merge(B,A)).
// Losers are remapped onto the winner in entries too, so no
// entry orphans into "not logged".
function normLabel(s) {
  return String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");
}
function dedupeCols(cols, entries) {
  var remap = {};
  ["loc", "trig", "person"].forEach(function (name) {
    var arr = cols[name] || [];
    var byLabel = {};
    arr.forEach(function (v) {
      var nl = normLabel(v.label);
      (byLabel[nl] = byLabel[nl] || []).push(v);
    });
    Object.keys(byLabel).forEach(function (nl) {
      var dup = byLabel[nl];
      if (dup.length < 2) return;
      dup.sort(function (a, b) {
        if ((b.mtime || 0) !== (a.mtime || 0)) return (b.mtime || 0) - (a.mtime || 0);
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
      });
      for (var i = 1; i < dup.length; i++) remap[dup[i].id] = dup[0].id;
    });
    cols[name] = arr.filter(function (v) { return !remap[v.id]; });
  });
  if (Object.keys(remap).length) {
    entries.forEach(function (e) {
      if (e.loc && remap[e.loc]) e.loc = remap[e.loc];
      if (e.person && remap[e.person]) e.person = remap[e.person];
      if (e.trig && remap[e.trig]) e.trig = remap[e.trig];
    });
  }
}

// ---- canonical form (MO-1) ----
// One shape for the getter and the merge result. Two devices that
// deleted different things used to hold the same tombstones in a
// different key order; the serialized states never matched and both
// uploaded on every sync cycle.
// Prune cutoff: 30 days before the NEWEST stamp in the data (entries,
// column values, tombstones) — the same rule the getter always used.
function newestStamp(st) {
  var mx = 0;
  (st.entries || []).forEach(function (e) { if ((e.mtime || 0) > mx) mx = e.mtime; });
  ["loc", "trig", "person"].forEach(function (c) {
    ((st.cols || {})[c] || []).forEach(function (v) { if ((v.mtime || 0) > mx) mx = v.mtime; });
  });
  var del = st.deleted || {};
  Object.keys(del).forEach(function (id) { if ((del[id] || 0) > mx) mx = del[id]; });
  return mx;
}
// MO-2: the tombstone of a factory value (seed-*) never expires.
// Every new device creates the seeds again (same ids, stamp 0); once
// the 30 days were over, a value the user had deleted came back on
// every device.
function isSeedId(id) { return String(id).indexOf("seed-") === 0; }
function canonDeleted(st) {
  var src = st.deleted || {}, out = {};
  var cutoff = newestStamp(st) - TOMB_LIFETIME_MS;
  Object.keys(src).sort().forEach(function (id) {
    if (typeof src[id] !== "number") return;
    if (isSeedId(id) || src[id] >= cutoff) out[id] = src[id];
  });
  return out;
}
function canonEntry(src) {
  var e = {};
  Object.keys(src).forEach(function (k) { e[k] = src[k]; });
  if (hasFm(src)) {                       // field stamps always spelled out
    var fm = {}, fs = fmFields(src);
    for (var i = 0; i < fs.length; i++) fm[fs[i]] = fieldStamp(src, fs[i]);
    e.fm = fm;
  }
  return e;
}
function byTsDesc(x, y) {
  if (x.ts !== y.ts) return y.ts - x.ts;
  return x.id < y.id ? -1 : (x.id > y.id ? 1 : 0);
}
var TOP_KEYS = ["ver", "trigSeeded", "sm", "om", "entries", "cols", "deleted", "vocab", "goals"];
function canonState(st) {
  var s = JSON.parse(JSON.stringify(st || {})), out = {};
  out.ver = s.ver;
  out.trigSeeded = !!s.trigSeeded;
  out.sm = s.sm || 0;
  out.om = s.om || 0;
  out.entries = (s.entries || []).map(canonEntry).sort(byTsDesc);
  out.cols = {};
  ["loc", "trig", "person"].forEach(function (c) {
    out.cols[c] = ((s.cols || {})[c] || []).map(function (v, i) {
      var o = {};
      Object.keys(v).forEach(function (k) { o[k] = v[k]; });
      o.pos = i;
      return o;
    });
  });
  out.deleted = canonDeleted(s);
  // Wave 30: present only when non-empty (see mood/vocab.js)
  var cv = V.mergeVocab(s.vocab, null);
  if (cv) out.vocab = cv;
  var cg = V.mergeGoals(s.goals, null);
  if (cg) out.goals = cg;
  Object.keys(s).sort().forEach(function (k) {
    if (TOP_KEYS.indexOf(k) === -1) out[k] = s[k];
  });
  return out;
}

function mergeMoodStates(A, B) {
  // Inputs are never written to: everything below works on copies.
  var a = JSON.parse(JSON.stringify(A || {}));
  var b = JSON.parse(JSON.stringify(B || {}));

  var tomb = {};
  Object.keys(a.deleted || {}).forEach(function (id) { tomb[id] = a.deleted[id]; });
  Object.keys(b.deleted || {}).forEach(function (id) {
    tomb[id] = Math.max(tomb[id] || 0, b.deleted[id]);
  });

  var entries = mergeUnionList(a.entries, b.entries, tomb, mergeEntry);

  var cols = mergeCols(a.cols, b.cols, tomb);
  dedupeCols(cols, entries);
  ["loc", "trig", "person"].forEach(function (c) {
    var ca = (a.cols || {})[c], cb = (b.cols || {})[c];
    sortColVals(cols[c], pickRef(ca, cb, a.om, b.om, cols[c]));
  });

  return canonState({
    ver: DATA_VER,
    // #1: travels with the slice — if EITHER side has ever
    // seeded (i.e. the user chose to empty the column), the
    // merged state must know it. Dropping it respawns deleted
    // triggers after the next pull → boot cycle.
    trigSeeded: !!(a.trigSeeded || b.trigSeeded),
    sm: Math.max(a.sm || 0, b.sm || 0),
    om: Math.max(a.om || 0, b.om || 0),
    entries: entries,
    cols: cols,
    deleted: tomb,
    vocab: V.mergeVocab(a.vocab, b.vocab),
    goals: V.mergeGoals(a.goals, b.goals)
  });
}

  // ---------- 3. Capture flow + recent list ----------

  // Micro-keys (added here, not in Part 1's STRINGS — same trick
  // as weather's "today")
  STRINGS.en["rel.now"] = "just now";
  STRINGS.en["rel.min"] = "{n} min ago";
  STRINGS.en["rel.hr"]  = "{n} h ago";
  STRINGS.el["rel.now"] = "μόλις τώρα";
  STRINGS.el["rel.min"] = "πριν {n} λ";
  STRINGS.el["rel.hr"]  = "πριν {n} ώ";
  // Everyday interop: one day's entries (Diary's mood line opens
  // Mood at { day }), and "Write about it" hands an entry to Diary
  STRINGS.en["day.only"] = "Only {d}";
  STRINGS.en["day.all"]  = "Show all days";
  STRINGS.en["day.none"] = "No entries on this day.";
  STRINGS.en["wr.btn"]   = "Write about it";
  STRINGS.en["wr.head"]  = "Mood: {m}";
  STRINGS.el["day.only"] = "Μόνο {d}";
  STRINGS.el["day.all"]  = "Όλες οι μέρες";
  STRINGS.el["day.none"] = "Καμία καταχώρηση αυτή τη μέρα.";
  STRINGS.el["wr.btn"]   = "Γράψε γι' αυτό";
  STRINGS.el["wr.head"]  = "Διάθεση: {m}";
  if (window.orosI18n) window.orosI18n.table(STRINGS, "mood", LANG);

  function relTime(ts) {
    var m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1)  return t("rel.now");
    if (m < 60) return t("rel.min").replace("{n}", m);
    return t("rel.hr").replace("{n}", Math.floor(m / 60));
  }

  // Lazy toast (weather pattern — index ships no toast node)
  var toastEl = null, toastTimer = null, toastAction = null;
  function showToast(text, actionLabel, actionFn) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.style.cssText =
        "position:fixed;top:calc(12px + env(safe-area-inset-top,0px));right:12px;transform:translateY(-8px);" +
        "z-index:1200;background:var(--panel-bg);border:1px solid var(--border);" +
        "border-radius:8px;box-shadow:0 4px 16px var(--shadow);padding:9px 14px;" +
        "font-size:13px;color:var(--text);opacity:0;transition:opacity .3s,transform .3s;" +
        "max-width:calc(100vw - 32px);";
      document.body.appendChild(toastEl);
    }
    if (toastAction) { toastAction.remove(); toastAction = null; }
    toastEl.textContent = "";                              // stale text dies here
    toastEl.appendChild(document.createTextNode(text));   // text FIRST

    if (actionLabel && typeof actionFn === "function") {
      toastAction = document.createElement("button");
      toastAction.type = "button";
      toastAction.textContent = actionLabel;
      toastAction.style.cssText =
        "margin-left:10px;background:transparent;color:var(--accent);" +
        "border:none;border-left:1px solid var(--border);padding:0 0 0 10px;" +
        "font-size:13px;font-weight:700;cursor:pointer;";
      toastAction.addEventListener("click", function () {
        actionFn();
        hideToast();
      });
      toastEl.appendChild(toastAction);                  // action SECOND
    }
    void toastEl.offsetWidth;
    toastEl.style.opacity = "1";
    toastEl.style.transform = "translateY(0)";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 5000);
  }
  function hideToast() {
    if (!toastEl) return;
    toastEl.style.opacity = "0";
    toastEl.style.transform = "translateY(-8px)";
    setTimeout(function () {
      // guard: a re-show within the window raised opacity again —
      // never wipe the NEW text
      if (toastEl.style.opacity === "0") toastEl.textContent = "";
      if (toastAction) { toastAction.remove(); toastAction = null; }
    }, 320);
  }

  // Unified notifications (orOS doctrine): informational toasts
  // route through orosNotifs.transient() (ns "mood" — already in
  // KNOWN_APPS). Undo-bearing toasts (del.done, col.del.done) stay
  // LOCAL per doctrine; must.feel is form validation, never migrates.
  // Falls back to the local toast when standalone.
  function transientNote(text) {
    var api = null;
    try { api = window.parent.orosNotifs; } catch (e) {}
    if (!api && window.orosNotifs) api = window.orosNotifs;
    if (api && typeof api.transient === "function") {
      api.transient({ ns: "mood", title: text, body: "" });
    } else {
      showToast(text);
    }
  }

  // Factory reset — double custom confirmation (destructive
  // actions get TWO doors; tombstones make it merge-proof).
  function askReset() {
    var dlg1 = document.createElement("dialog");
    dlg1.className = "rst-dlg";
    dlg1.innerHTML =
      "<h3>" + esc(t("rst.btn")) + "</h3>" +
      "<p>" + esc(t("rst.body1")) + "</p>";
    var c1 = document.createElement("button");
    c1.type = "button";
    c1.className = "ghost";
    c1.textContent = t("rst.cancel");
    c1.addEventListener("click", function () { dlg1.close(); dlg1.remove(); });
    var y1 = document.createElement("button");
    y1.type = "button";
    y1.className = "prim danger";
    y1.textContent = t("rst.yes1");
    y1.addEventListener("click", function () {
      dlg1.close(); dlg1.remove();
      askResetConfirm();
    });
    dlg1.appendChild(c1);
    dlg1.appendChild(y1);
    document.body.appendChild(dlg1);
    dlg1.addEventListener("close", function () { dlg1.remove(); });  // Esc too
    dlg1.showModal();
  }

  function askResetConfirm() {
    var dlg2 = document.createElement("dialog");
    dlg2.className = "rst-dlg";
    dlg2.innerHTML =
      "<h3>" + esc(t("rst.btn")) + "</h3>" +
      "<p>" + esc(t("rst.body2")) + "</p>";
    var c2 = document.createElement("button");
    c2.type = "button";
    c2.className = "ghost";
    c2.textContent = t("rst.cancel");
    c2.addEventListener("click", function () { dlg2.close(); dlg2.remove(); });
    var y2 = document.createElement("button");
    y2.type = "button";
    y2.className = "prim danger";
    y2.textContent = t("rst.yes2");
    y2.addEventListener("click", function () {
      dlg2.close(); dlg2.remove();
      factoryReset();
    });
    dlg2.appendChild(c2);
    dlg2.appendChild(y2);
    document.body.appendChild(dlg2);
    dlg2.addEventListener("close", function () { dlg2.remove(); });  // Esc too
    dlg2.showModal();
  }

  function factoryReset() {
    var now = Date.now();
    // carry OLD tombstones + tombstone everything that ever lived
    var tomb = {};
    Object.keys(state.deleted || {}).forEach(function (id) {
      tomb[id] = state.deleted[id];
    });
    state.entries.forEach(function (e) { tomb[e.id] = now; });
    ["loc", "trig", "person"].forEach(function (c) {
      (state.cols[c] || []).forEach(function (v) { tomb[v.id] = now; });
    });
    var fresh = newState();           // fresh uids — no collisions
    // Wave 30: own feelings / activities / orders go on every device
    // (vocab.rs), goals are deleted (soft delete, x).
    if (state.vocab) fresh.vocab = { rs: now };
    if (state.goals) {
      fresh.goals = JSON.parse(JSON.stringify(state.goals)).map(function (g) {
        g.x = 1; g.mtime = Math.max(now, (g.mtime || 0) + 1); return g;
      });
    }
    // Newborn seeds share ids with their own predecessors' tombstones
    // (deterministic ids) — a fresh mtime beats the tombstone, same
    // resurrection contract as undo-delete. Renamed seeds on other
    // devices also lose to the newer mtime → true pristine state.
    // MD-1: mergeUnionList requires STRICT mtime > ts. Stamping
    // seeds with `now` (= the tombstone ts, same synchronous block)
    // made them lose the equality on merge → empty columns after
    // the first post-reset sync. +1 guarantees strict victory.
    ["loc", "person", "trig"].forEach(function (c) {
      (fresh.cols[c] || []).forEach(function (v) { v.mtime = now + 1; });
    });
    fresh.deleted = tomb;             // tombstones travel, merge-proof
    fresh.sm = now; fresh.om = now;
    state = fresh;
    save();
    refreshVocab();
    pxYear = null;
    // #16: view ghosts die with the data they pointed at
    insFilter = { loc: null, person: null, hab: null };
    insFiltersOpen = false;
    searchQ = "";
    calMonth = null;
    resetCapture();
    renderAll();
    if (viewMode === "insights") renderInsights();
    transientNote(t("rst.done"));
  }

  // --- capture state ---
  var editing   = null;   // entry id | null (new-entry mode)
  var editBase  = null;   // MO-4: the entry's values when the form took them
  var pendingNote = null;  // #3: note carried by an in-flight editEntry
  var managing = false;   // view state: chip management mode (rename/delete)
  var picked    = {};     // emotionKey → intensity 1–5
  var selLoc    = null;   // column-value id | null
  var selPerson = null;
  var selTrig   = null;   // trigger preset id | null
  var hab       = {};                     // TRIADIC null|"yes"|"no", keys = HABITS
  BUILTIN_HABITS.forEach(function (h) { hab[h.f] = null; });
  var selActs   = {};                     // wave 30: custom activity id → true

  function resetCapture() {
    editing = null;
    editBase = null;
    pendingNote = null;   // #3: stale edit-notes never leak
    picked = {};
    selActs = {};
    // Smart preselection (changelog contract): most-used value in
    // the CURRENT time-of-day bucket → most recent → pos 0.
    // FACTS ONLY (loc/person) — feelings and triggers are never
    // preselected: they must be conscious picks, default effect
    // would pollute the statistics.
    selLoc    = suggestFor("loc");
    selPerson = suggestFor("person");
    selTrig   = null;
    buildCapture();
  }

  // Smart preselection: most-used value in the CURRENT time-of-day
  // bucket; tie/fallback → most recent. First-ever entry → the
  // column's first value (pos 0). Level: helpful, never blocking.
  function suggestFor(col) {
    var bucket = tod(Date.now());
    var counts = {};
    state.entries.forEach(function (e) {
      if (tod(e.ts) !== bucket || !e[col]) return;
      counts[e[col]] = (counts[e[col]] || 0) + 1;
    });
    var best = null, bestN = 0;
    Object.keys(counts).forEach(function (id) {
      if (counts[id] > bestN) { best = id; bestN = counts[id]; }
    });
    if (best && colValById(col, best)) return best;
    for (var i = 0; i < state.entries.length; i++) {
      if (state.entries[i][col] && colValById(col, state.entries[i][col])) {
        return state.entries[i][col];
      }
    }
    var arr = state.cols[col] || [];
    return arr.length ? arr[0].id : null;
  }

  function buildCapture() {
    var host = $("capture");
    // #3: an in-flight edit carries ITS note; everything else
    // keeps whatever the user typed (draft survives rebuilds)
    var prevNote = (editing !== null && pendingNote !== null) ?
      pendingNote : ($("fld-note") ? $("fld-note").value : "");
    pendingNote = null;
    var prevAdd = { loc: "", person: "", trig: "" };           // #12: same for Add…
    ["loc", "person", "trig"].forEach(function (c) {
      var ip = document.getElementById("add-in-" + c);
      if (ip) prevAdd[c] = ip.value;
    });
    var mm = $("moodmain");
    var keepScroll = mm ? mm.scrollTop : 0;   // taps mid-form never jump to top
    // MO-5: a rebuild must not take the keyboard away — remember the
    // focused field (by id) and its caret, restore both at the end.
    var ae = document.activeElement, keepFocus = null;
    if (ae && ae.id && host.contains(ae)) {
      keepFocus = { id: ae.id, a: null, b: null };
      try { keepFocus.a = ae.selectionStart; keepFocus.b = ae.selectionEnd; } catch (e) {}
    }
    host.innerHTML = "";

    // ---- L1: emotion grid ----
    var h1 = document.createElement("h2");
    h1.className = "sec-title";
    h1.textContent = t("l1.title");
    host.appendChild(h1);

    var grid = document.createElement("div");
    grid.id = "emogrid";
    EMOTIONS.forEach(function (em) {
      // wave 30: a hidden feeling stays visible only while picked
      if (em.hid && picked[em.k] === undefined) return;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "emotile" + (picked[em.k] !== undefined ? " on" : "");
      b.style.color = em.col;                  // the TILE carries the hue
      b.title = em.label;
      b.setAttribute("aria-label", em.label);
      b.setAttribute("aria-pressed", picked[em.k] !== undefined ? "true" : "false");
      b.innerHTML = faceFor(em.k) +
        '<span class="emo-name">' + esc(em.label) + "</span>";
      b.addEventListener("click", function () {
        if (picked[em.k] !== undefined) delete picked[em.k];
        else picked[em.k] = 3;                  // default intensity: mid
        buildCapture();
        if (picked[em.k] !== undefined) {
          // focus the new slider for keyboard users
          var sl = document.getElementById("sl-" + em.k);
          if (sl) sl.focus();
        }
      });
      grid.appendChild(b);
    });
    host.appendChild(grid);

    // ---- L1b: intensity sliders (only for picked emotions) ----
    var pickedKeys = Object.keys(picked);
    if (pickedKeys.length) {
      var ints = document.createElement("div");
      ints.id = "intensities";
      var sub = document.createElement("div");
      sub.className = "hint";
      sub.textContent = t("l1.multi");
      ints.appendChild(sub);
      pickedKeys.forEach(function (k) {
        var em = emoByK(k) || { k: k, label: k, col: "var(--text-dim)" };
        var row = document.createElement("div");
        row.className = "int-row";
        row.style.color = em.col;
        var lab = document.createElement("span");
        lab.className = "int-lab";
        lab.textContent = em.label;
        row.appendChild(lab);
        var sl = document.createElement("input");
        sl.type = "range";
        sl.id = "sl-" + k;
        sl.min = "1"; sl.max = "5"; sl.step = "1";
        sl.value = String(picked[k]);
        sl.setAttribute("aria-label", em.label);
        var num = document.createElement("span");
        num.className = "int-num";
        num.textContent = String(picked[k]);
        sl.addEventListener("input", function () {
          picked[k] = parseInt(sl.value, 10);
          num.textContent = sl.value;
        });
        row.appendChild(sl);
        row.appendChild(num);
        ints.appendChild(row);
      });
      host.appendChild(ints);
    }

    // ---- L2: Location & Person columns ----
    var h2 = document.createElement("h2");
    h2.className = "sec-title";
    h2.textContent = t("l2.title");
    host.appendChild(h2);

    var l2cols = document.createElement("div");
    l2cols.className = "l2cols";
    ["loc", "person"].forEach(function (col) {
      var wrap = document.createElement("div");
      wrap.className = "colwrap";
      var lab = document.createElement("div");
      lab.className = "col-lab";
      lab.textContent = t(col === "loc" ? "l2.loc" : "l2.person");
      wrap.appendChild(lab);

      var chips = document.createElement("div");
      chips.className = "chips";
      (state.cols[col] || []).forEach(function (v) {
        var c = document.createElement("button");
        c.type = "button";
        c.className = "chip" + (managing ? " mgmt" : "") +
          (((col === "loc") ? selLoc : selPerson) === v.id ? " on" : "");
        c.textContent = colLabel(v);
        c.addEventListener("click", function (ev) {
          if (managing) {                       // manage mode: tap = menu
            ev.stopPropagation();              // don't let the document closer kill it
            openChipMenu(col, v, c.getBoundingClientRect());
            return;
          }
          if (col === "loc") selLoc = (selLoc === v.id) ? null : v.id;
          else selPerson = (selPerson === v.id) ? null : v.id;
          buildCapture();
        });
        attachChipMenu(c, col, v);          // long-press / right-click
        chips.appendChild(c);
      });
      // None (explicit)
      var none = document.createElement("button");
      none.type = "button";
      none.className = "chip ghost" +
        ((col === "loc" ? selLoc : selPerson) === null ? " on" : "");
      none.textContent = t("l2.none");
      none.addEventListener("click", function () {
        if (col === "loc") selLoc = null; else selPerson = null;
        buildCapture();
      });
      chips.appendChild(none);
      // visible affordance: rename/delete without hidden gestures
      var mgmt = document.createElement("button");
      mgmt.type = "button";
      mgmt.className = "chip ghost" + (managing ? " on" : "");
      mgmt.textContent = t("l2.manage");
      mgmt.addEventListener("click", function () {
        managing = !managing;
        buildCapture();
      });
      chips.appendChild(mgmt);
      wrap.appendChild(chips);

      // inline Add
      var addRow = document.createElement("div");
      addRow.className = "addrow";
      var addIn = document.createElement("input");
      addIn.type = "text";
      addIn.id = "add-in-" + col;
      addIn.value = prevAdd[col];
      addIn.placeholder = t("l2.add.ph");
      addIn.maxLength = 40;
      addIn.setAttribute("aria-label", t("l2.add"));
      var addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "prim";
      addBtn.textContent = t("l2.add");
      addBtn.addEventListener("click", function () {
        commitColVal(col, addIn);
      });
      addIn.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); commitColVal(col, addIn); }
      });
      addRow.appendChild(addIn); addRow.appendChild(addBtn);
      wrap.appendChild(addRow);
      l2cols.appendChild(wrap);
    });
    host.appendChild(l2cols);

    // ---- L3: triadic habits ("this or that") ----
    // TWO visually separate blocks over the ONE HABITS array:
    // the basics on top, rituals as their own titled section.
    // Same visual rhythm as #intensities. Re-tapping the ACTIVE
    // chip returns to unknown.
    var mkHabBlock = function (grp, titleKey, panelId) {
      var h = document.createElement("h2");
      h.className = "sec-title";
      h.textContent = t(titleKey);
      host.appendChild(h);
      var panel = document.createElement("div");
      panel.className = "habpanel";
      panel.id = panelId;
      HABITS.forEach(function (hh) {
        if (hh.grp !== grp) return;
        if (hh.hid && !hab[hh.f]) return;     // wave 30: hidden unless marked
        var row = document.createElement("div");
        row.className = "habrow";
        ["yes", "no"].forEach(function (side) {
          var hc = document.createElement("button");
          hc.type = "button";
          hc.className = "chip hab" + (hab[hh.f] === side ? " on" : "") +
            (side === "no" ? " neg" : "");
          hc.textContent = habText(hh, side);
          hc.setAttribute("aria-pressed", hab[hh.f] === side ? "true" : "false");
          hc.addEventListener("click", function () {
            hab[hh.f] = (hab[hh.f] === side) ? null : side;   // re-tap = unknown
            buildCapture();
          });
          row.appendChild(hc);
        });
        panel.appendChild(row);
      });
      host.appendChild(panel);
    };
    mkHabBlock("hab", "ins.basics", "habits");
    mkHabBlock("rit", "grp.rit", "rituals");

    // ---- L3a (wave 30): the user's own activities — tap = done ----
    var shownActs = CUST_ACTS.filter(function (a) { return !a.hid || selActs[a.id]; });
    if (shownActs.length) {
      var ha = document.createElement("h2");
      ha.className = "sec-title";
      ha.textContent = t("grp.own");
      host.appendChild(ha);
      var ap = document.createElement("div");
      ap.className = "chips own-acts";
      ap.id = "own-acts";
      shownActs.forEach(function (a) {
        var c = document.createElement("button");
        c.type = "button";
        c.className = "chip" + (selActs[a.id] ? " on" : "");
        c.textContent = actText(a);
        c.setAttribute("aria-pressed", selActs[a.id] ? "true" : "false");
        c.addEventListener("click", function () {
          if (selActs[a.id]) delete selActs[a.id]; else selActs[a.id] = true;
          buildCapture();
        });
        ap.appendChild(c);
      });
      host.appendChild(ap);
    }

    // ---- L3b: trigger presets (closed list, like Location) ----
    // Chips + None + Manage + inline Add — same vocabulary model
    // as the columns; trends stay normalized (top-6 engine).
    var h3b = document.createElement("h2");
    h3b.className = "sec-title";
    h3b.textContent = t("l4.trig.title");
    host.appendChild(h3b);

    var trigChips = document.createElement("div");
    trigChips.className = "chips";
    (state.cols.trig || []).forEach(function (v) {
      var c = document.createElement("button");
      c.type = "button";
      c.className = "chip" + (managing ? " mgmt" : "") +
        (selTrig === v.id ? " on" : "");
      c.textContent = colLabel(v);
      c.addEventListener("click", function (ev) {
        if (managing) {
          ev.stopPropagation();
          openChipMenu("trig", v, c.getBoundingClientRect());
          return;
        }
        selTrig = (selTrig === v.id) ? null : v.id;
        buildCapture();
      });
      attachChipMenu(c, "trig", v);       // long-press / right-click
      trigChips.appendChild(c);
    });
    var tnone = document.createElement("button");
    tnone.type = "button";
    tnone.className = "chip ghost" + (selTrig === null ? " on" : "");
    tnone.textContent = t("l2.none");
    tnone.addEventListener("click", function () {
      selTrig = null; buildCapture();
    });
    trigChips.appendChild(tnone);
    var tmgmt = document.createElement("button");
    tmgmt.type = "button";
    tmgmt.className = "chip ghost" + (managing ? " on" : "");
    tmgmt.textContent = t("l2.manage");
    tmgmt.addEventListener("click", function () {
      managing = !managing; buildCapture();
    });
    trigChips.appendChild(tmgmt);
    host.appendChild(trigChips);

    var tAddRow = document.createElement("div");
    tAddRow.className = "addrow";
    var tAddIn = document.createElement("input");
    tAddIn.type = "text";
    tAddIn.id = "add-in-trig";
    tAddIn.value = prevAdd.trig;
    tAddIn.placeholder = t("l2.add.ph");
    tAddIn.maxLength = 40;
    tAddIn.setAttribute("aria-label", t("l2.add"));
    var tAddBtn = document.createElement("button");
    tAddBtn.type = "button";
    tAddBtn.className = "prim";
    tAddBtn.textContent = t("l2.add");
    tAddBtn.addEventListener("click", function () {
      commitColVal("trig", tAddIn);
    });
    tAddIn.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); commitColVal("trig", tAddIn); }
    });
    tAddRow.appendChild(tAddIn); tAddRow.appendChild(tAddBtn);
    host.appendChild(tAddRow);

    // ---- L4: reflection ----
    var h4 = document.createElement("h2");
    h4.className = "sec-title";
    h4.textContent = t("l4.note");
    host.appendChild(h4);
    var note = document.createElement("textarea");
    note.id = "fld-note";
    note.rows = 2;
    note.maxLength = 2000;
    note.value = prevNote;
    host.appendChild(note);

    // ---- actions ----
    var acts = document.createElement("div");
    acts.className = "acts";
    var saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "prim big";
    saveBtn.textContent = t("save");
    saveBtn.addEventListener("click", saveEntry);
    acts.appendChild(saveBtn);
    if (!editing && state.entries.length) {
      var rep = document.createElement("button");
      rep.type = "button";
      rep.className = "ghost";
      rep.textContent = t("rep.last");
      rep.addEventListener("click", function () {
        var last = state.entries[0];
        if (!last) return;
        loadEntryIntoCapture(last);
        buildCapture();
        // MO6: a half-typed draft is precious (same rule as the
        // deep-link): repeat fills the old note ONLY when the
        // user hasn't typed anything new.
        var nb = $("fld-note");
        if (nb && !nb.value.trim()) nb.value = last.note || "";
        // selTrig comes from loadEntryIntoCapture(last) above
        var mm2 = $("moodmain");
        if (mm2) mm2.scrollTop = 0;
      });
      acts.appendChild(rep);
    }
    if (editing) {
      var disc = document.createElement("button");
      disc.type = "button";
      disc.className = "ghost";
      disc.textContent = t("discard");
      disc.addEventListener("click", resetCapture);
      acts.appendChild(disc);
    }
    host.appendChild(acts);
    // wave 30: customise feelings, activities and goals
    var cz = document.createElement("button");
    cz.type = "button";
    cz.className = "rst-link cz-link";
    cz.id = "cz-open";
    cz.textContent = t("vc.open");
    cz.addEventListener("click", function () { openVocab("emo"); });
    host.appendChild(cz);
    if (mm) mm.scrollTop = keepScroll;
    if (keepFocus) {
      var fe = document.getElementById(keepFocus.id);
      if (fe) {
        try { fe.focus({ preventScroll: true }); } catch (e) { fe.focus(); }
        if (typeof keepFocus.a === "number") {
          try { fe.setSelectionRange(keepFocus.a, keepFocus.b); } catch (e) {}
        }
        if (mm) mm.scrollTop = keepScroll;
      }
    }
  }

  // ---- chip context menu: rename / delete column values ----
  // Long-press (touch) or right-click (pointer) on ANY chip.
  // Custom UI only — no native dialogs, per standing rule.
  var chipMenu = null;
  function closeChipMenu() {
    if (chipMenu) { chipMenu.remove(); chipMenu = null; }
  }
  document.addEventListener("click", function (e) {
    if (chipMenu && !chipMenu.contains(e.target)) closeChipMenu();
  });
  document.addEventListener("contextmenu", function (e) {
    if (chipMenu && !chipMenu.contains(e.target)) closeChipMenu();
  });

  function attachChipMenu(el, col, v) {
    var lpTimer = null, lpFired = false;
    el.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      e.stopPropagation();               // don't let the document closer eat it
      openChipMenu(col, v, el.getBoundingClientRect());
    });
    el.addEventListener("touchstart", function () {
      lpFired = false;
      lpTimer = setTimeout(function () {
        lpFired = true;
        openChipMenu(col, v, el.getBoundingClientRect());
      }, 450);
    }, { passive: true });
    el.addEventListener("touchmove", function () {
      clearTimeout(lpTimer);
    }, { passive: true });
    el.addEventListener("touchend", function (e) {
      clearTimeout(lpTimer);
      if (lpFired) e.preventDefault();   // swallow the synthetic click
    });
  }

  function openChipMenu(col, v, rect) {
    closeChipMenu();
    var m = document.createElement("div");
    m.className = "ctxmenu";
    m.setAttribute("role", "menu");

    var mkItem = function (label, cls, fn) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ctxitem" + (cls ? " " + cls : "");
      b.textContent = label;
      b.addEventListener("click", fn);
      m.appendChild(b);
      return b;
    };
    mkItem(t("col.menu.rename"), "", function () { beginChipRename(m, col, v); });
    mkItem(t("col.menu.del"), "danger", function () { deleteColVal(col, v); });

    document.body.appendChild(m);
    // position near the chip, clamped to the viewport
    void m.offsetWidth;                            // layout first
    var mw = m.offsetWidth, mh = m.offsetHeight;
    var x = Math.max(8, Math.min(rect.left, window.innerWidth - mw - 8));
    var y = rect.bottom + 6;
    if (y + mh > window.innerHeight - 8) y = Math.max(8, rect.top - mh - 6);
    m.style.left = x + "px";
    m.style.top = y + "px";
    m.style.opacity = "1";                // turn it on — it was born at 0
    chipMenu = m;
  }

  function beginChipRename(m, col, v) {
    m.innerHTML = "";
    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "ctxren";
    inp.maxLength = 40;
    inp.value = colLabel(v);   // B2: edit WHAT YOU SEE
    inp.setAttribute("aria-label", t("col.menu.rename"));
    m.appendChild(inp);
    var go = document.createElement("button");
    go.type = "button";
    go.className = "ctxitem prim-line";
    go.textContent = t("save");
    go.addEventListener("click", function () { applyChipRename(col, v, inp.value); });
    m.appendChild(go);
    var no = document.createElement("button");
    no.type = "button";
    no.className = "ctxitem";
    no.textContent = t("discard");
    no.addEventListener("click", closeChipMenu);
    m.appendChild(no);
    inp.focus();
    inp.select();
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); applyChipRename(col, v, inp.value); }
      if (e.key === "Escape") closeChipMenu();
    });
    // stop the document-click closer from eating clicks inside
    m.addEventListener("click", function (e) { e.stopPropagation(); });
  }

  function colLabelExists(col, label, exceptId) {
    var norm = String(label).trim().toLowerCase();
    return (state.cols[col] || []).some(function (o) {
      if (o.id === exceptId) return false;
      // D7: BOTH spellings count — typing the Greek seed while the
      // chip shows Greek must not bypass dup detection via bi
      return String(o.label).trim().toLowerCase() === norm ||
             String(colLabel(o)).trim().toLowerCase() === norm;
    });
  }

  function applyChipRename(col, v, label) {
    label = String(label).trim().normalize("NFC");
    closeChipMenu();
    // MO-6: the menu was opened on the value as it was then; a pull
    // since may have replaced it. Work on the one the data holds now.
    v = colValById(col, v.id);
    if (!v) { renderAll(); return; }      // deleted elsewhere meanwhile
    if (!label || label === v.label) return;
    if (colLabelExists(col, label, v.id)) { transientNote(t("col.dup")); return; }
    v.label = label;
    delete v.bi;   // B2: a hand-renamed value is a CUSTOM value now
    v.mtime = Date.now();                // LWW — rename travels
    state.sm = Date.now();
    save();
    renderAll();                          // recent list shows labels live (paints capture too)
    transientNote(t("col.renamed"));
  }

  function deleteColVal(col, v) {
    closeChipMenu();
    v = colValById(col, v.id);            // MO-6: the current value, not the menu's copy
    if (!v) { renderAll(); return; }
    var snap = JSON.parse(JSON.stringify(v));
    state.cols[col] = (state.cols[col] || []).filter(function (x) {
      return x.id !== v.id;
    });
    state.deleted[v.id] = Date.now();    // tombstone — merge-safe
    if (col === "loc" && selLoc === v.id) selLoc = null;
    else if (col === "person" && selPerson === v.id) selPerson = null;
    else if (col === "trig" && selTrig === v.id) selTrig = null;
    state.sm = Date.now();
    save();
    renderAll();
    showToast(t("col.del.done"), t("col.del.undo"), function () {
      // MO-6: already back (an edit from another device revived it)
      // → nothing to restore, and never a second copy.
      if (colValById(col, snap.id)) return;
      // resurrection: fresh mtime beats the tombstone (same
      // contract as entries)
      snap.mtime = Date.now();
      state.cols[col].push(snap);
      delete state.deleted[snap.id];
      state.sm = Date.now();
      save();
      renderAll();
    });
  }

  function commitColVal(col, input) {
    var label = input.value.trim().normalize("NFC");
    if (!label) return;
    if (colLabelExists(col, label, null)) {
      transientNote(t("col.dup"));            // no silent duplicates — ever again
      return;
    }
    input.value = "";                     // consumed — don't resurrect via prevAdd
    var v = { id: uid(), label: label, mtime: Date.now(), pos: (state.cols[col] || []).length };
    state.cols[col].push(v);
    state.sm = Date.now();
    state.om = Date.now();
    save();
    if (col === "loc") selLoc = v.id;
    else if (col === "person") selPerson = v.id;
    else selTrig = v.id;
    buildCapture();   // keepScroll restores the viewport — no mid-form jump
  }

  // ---- edit buffer vs data (MO-4) ----
  // One comparable shape for an entry and for the form. Emotions
  // compare as a set (order of picking does not matter).
  function normEmos(list) {
    return (list || []).map(function (m) { return [m.k, m.i]; })
      .sort(function (x, y) { return x[0] < y[0] ? -1 : (x[0] > y[0] ? 1 : 0); });
  }
  function actsOfForm() {
    return V.normActs(Object.keys(selActs).filter(function (k) { return selActs[k]; }));
  }
  function entryValues(e) {
    var v = {
      emotions: normEmos(e.emotions),
      loc: e.loc || null, person: e.person || null, trig: e.trig || null,
      note: e.note || "", acts: V.normActs(e.acts)
    };
    HABITS.forEach(function (h) {
      v[h.f] = (e[h.f] === "yes" || e[h.f] === "no") ? e[h.f] : null;
    });
    return v;
  }
  function noteValue() {
    var nb = $("fld-note");
    if (nb) return nb.value.trim();
    return pendingNote !== null ? String(pendingNote).trim() : "";
  }
  function formValues() {
    var v = {
      emotions: normEmos(Object.keys(picked).map(function (k) { return { k: k, i: picked[k] }; })),
      loc: selLoc || null, person: selPerson || null, trig: selTrig || null,
      note: noteValue(), acts: actsOfForm()
    };
    BUILTIN_HABITS.forEach(function (h) { v[h.f] = hab[h.f] || null; });
    return v;
  }
  function sameVal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function setFormField(f, val) {
    if (f === "emotions") {
      picked = {};
      (val || []).forEach(function (p) { picked[p[0]] = p[1]; });
    } else if (f === "loc") selLoc = val;
    else if (f === "person") selPerson = val;
    else if (f === "trig") selTrig = val;
    else if (f === "acts") {
      selActs = {};
      (val || []).forEach(function (id) { selActs[id] = true; });
    } else if (f === "note") {
      var nb = $("fld-note");
      if (nb) nb.value = val; else pendingNote = val;
    } else hab[f] = val;
  }
  // After a pull: every field the user has NOT changed in the form
  // follows the data; what they changed stays theirs.
  function followEdit() {
    if (editing === null || !editBase) return;
    var e = entryById(editing);
    if (!e) return;
    var now = entryValues(e), cur = formValues();
    ENTRY_FIELDS.forEach(function (f) {
      if (!sameVal(cur[f], editBase[f])) return;        // user's own change
      if (!sameVal(now[f], cur[f])) setFormField(f, now[f]);
      editBase[f] = now[f];
    });
  }

  // ---- save flow ----
  function saveEntry() {
    var emos = Object.keys(picked).map(function (k) {
      return { k: k, i: picked[k] };
    });
    if (!emos.length) { showToast(t("must.feel")); return; }

    if (!editing && state.entries.length) {
      var last = state.entries[0];     // entries are ts-desc sorted
      if (Date.now() - last.ts < 60 * 60 * 1000) {
        askRecentGuard(last, emos);
        return;
      }
    }
    commitEntry(emos);
  }

  // Soft guard: "Logged 20 min ago — update it?" Inline panel, no
  // native confirm() (retired in weather, retired here too).
  function askRecentGuard(last, emos) {
    var g = $("guard");
    if (g) g.remove();
    g = document.createElement("div");
    g.id = "guard";
    g.innerHTML = "<span>" + esc(t("recent.q").replace("{time}", relTime(last.ts))) + "</span>";
    var mk = function (label, cls, fn) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.textContent = label;
      b.addEventListener("click", function () { g.remove(); fn(); });
      return b;
    };
    g.appendChild(mk(t("recent.edit"), "prim", function () {
      last = entryById(last.id) || last;   // the entry as it is NOW
      editing = last.id;
      editBase = entryValues(last);
      // EDIT = fold the fresh picks INTO the recent entry. No
      // loadEntryIntoCapture here: it would overwrite the fresh
      // loc/person/habits/trig with the old entry's values.
      var vn = [last.note || "", $("fld-note").value.trim()].filter(Boolean);
      $("fld-note").value = vn.join("\n");
      selTrig = selTrig || last.trig || null;   // fresh pick wins, legacy fallback
      // MO1: same fallback for loc/person/habits — an untouched
      // field is NOT a conscious "erase it". Without this, a quick
      // re-check-in inside the 1h window silently wiped the
      // previous entry's habit marks. Fresh picks always win.
      selLoc = selLoc || last.loc || null;
      selPerson = selPerson || last.person || null;
      BUILTIN_HABITS.forEach(function (h) {
        if (hab[h.f] === null &&
            (last[h.f] === "yes" || last[h.f] === "no")) hab[h.f] = last[h.f];
      });
      (V.normActs(last.acts) || []).forEach(function (id) { selActs[id] = true; });   // marks are additive
      commitEntry(emos);
    }));
    g.appendChild(mk(t("recent.new"), "ghost", function () {
      commitEntry(emos);
    }));
    // Above the Save button (the .acts row) — visible where the
    // user's thumb already is, no scroll-up hunting.
    var acts = $("capture").querySelector(".acts");
    if (acts) {
      $("capture").insertBefore(g, acts);
      if (g.scrollIntoView) g.scrollIntoView({ block: "nearest" });
    } else {
      $("capture").insertBefore(g, $("capture").firstChild);
    }
  }

  function loadEntryIntoCapture(e) {
    picked = {};
    (e.emotions || []).forEach(function (m) { picked[m.k] = m.i; });
    selLoc = e.loc; selPerson = e.person; selTrig = e.trig || null;
    BUILTIN_HABITS.forEach(function (h) {
      hab[h.f] = (e[h.f] === "yes" || e[h.f] === "no") ? e[h.f] : null;
    });
    selActs = {};
    (V.normActs(e.acts) || []).forEach(function (id) { selActs[id] = true; });
  }

  function commitEntry(emos) {
    var note = $("fld-note") ? $("fld-note").value.trim() : "";
    var e, wrote = true;
    if (editing) {
      // MO-4: write back ONLY what the user changed in the form; a
      // field they left alone keeps whatever the data holds now
      // (possibly an edit that arrived from another device).
      var now = Date.now();
      var vals = {
        emotions: emos, loc: selLoc || null, person: selPerson || null,
        trig: selTrig || null, note: note, acts: actsOfForm()
      };
      BUILTIN_HABITS.forEach(function (h) { vals[h.f] = hab[h.f] || null; });
      var fv = formValues();
      e = entryById(editing);
      if (!e) {                                   // resurrection safety
        e = { id: editing, ts: (editBase && editBase.ts) || now, trigger: "" };
        ENTRY_FIELDS.forEach(function (f) {
          if (OPT_FIELDS[f] && vals[f] === null) return;          // optional: absent = none
          e[f] = vals[f];
        });
        stampEntryNewest(e, now);
        state.entries.push(e);
      } else {
        var cur = entryValues(e);
        wrote = false;
        ENTRY_FIELDS.forEach(function (f) {
          if (editBase && sameVal(fv[f], editBase[f])) return;   // untouched
          if (sameVal(fv[f], cur[f])) return;                     // already so
          e[f] = vals[f];
          touchField(e, f, now);                                  // MO-3
          wrote = true;
        });
      }
      // resurrection: this edit is newer than any tombstone
      if (state.deleted[e.id] !== undefined && e.mtime > state.deleted[e.id]) delete state.deleted[e.id];
    } else {
      e = {
        id: uid(), ts: Date.now(), mtime: Date.now(),
        emotions: emos, loc: selLoc, person: selPerson,
        note: note, trig: selTrig, trigger: ""
      };
      BUILTIN_HABITS.forEach(function (h) { e[h.f] = hab[h.f]; });
      var na = actsOfForm();
      if (na) e.acts = na;                // wave 30: only when used
      state.entries.push(e);
    }
    if (wrote) {                          // an edit that changed nothing writes nothing
      state.entries.sort(function (x, y) { return y.ts - x.ts; });
      state.sm = Date.now();
      save();
    }
    resetCapture();
    renderAll();
    transientNote(t("saved.toast"));
  }

  function editEntry(id) {
    var e = entryById(id);
    if (!e) return;
    editing = id;
    editBase = entryValues(e);
    editBase.ts = e.ts;
    loadEntryIntoCapture(e);
    pendingNote = e.note || "";         // #3: BEFORE showTab — applyView's
                                        // single buildCapture consumes it
    showTab("capture");                 // #8: the form must actually SHOW
    var mm = $("moodmain");
    if (mm) mm.scrollTop = 0; else window.scrollTo(0, 0);
  }

  // Delete — immediate + undo toast (same id, fresh mtime beats
  // the tombstone: resurrection is legitimate by merge contract).
  function deleteEntry(id) {
    var e = entryById(id);
    if (!e) return;
    e = JSON.parse(JSON.stringify(e));    // MO-6: Undo restores THIS copy
    state.entries = state.entries.filter(function (x) { return x.id !== id; });
    state.deleted[id] = Date.now();
    state.sm = Date.now();
    save();
    renderAll();
    if (editing === id) resetCapture();
    showToast(t("del.done"), t("del.undo"), function () {
      // MO-6: already back (an edit from another device revived it)
      // → its newer content stays; no second copy, no restamp.
      if (entryById(id)) return;
      stampEntryNewest(e, Date.now());    // fresh mtime > tombstone
      state.entries.push(e);
      state.entries.sort(function (x, y) { return y.ts - x.ts; });
      delete state.deleted[id];
      state.sm = Date.now();
      save();
      renderAll();
    });
  }

  // ---- 7-day thread ----
  // One dot per day; color = the day's HIGHEST-intensity emotion;
  // hollow dot = day had NO entry at all. (Absence ≠ neutral
  // mood — visually distinct too.)
  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function renderThread() {
    var host = $("thread");
    var days = {};
    state.entries.forEach(function (e) {
      var k = dayKey(e.ts);
      var best = null, bi = -1;
      (e.emotions || []).forEach(function (m) {
        if (m.i > bi) { bi = m.i; best = m.k; }
      });
      if (best && (!days[k] || bi > days[k].i)) {
        days[k] = { k: best, i: bi };
      }
    });
    var keys = Object.keys(days);
    // Capture-tab-only contract (mirror of applyView): renderAll
    // also fires from entries/insights context (entry delete, sync
    // pull) — never leak the thread into those views.
    host.hidden = (viewMode !== "capture") || !keys.length;
    if (host.hidden) return;
    host.innerHTML = "";
    // last 7 calendar days, oldest → newest
    var out = [];
    for (var d = 6; d >= 0; d--) {
      var dd = new Date();                     // DST-safe calendar step
      dd.setDate(dd.getDate() - d);
      out.push({ key: dayKey(dd.getTime()),
                 entry: days[dayKey(dd.getTime())] || null });
    }
    out.forEach(function (day, idx) {
      var wrap = document.createElement("span");
      wrap.className = "tdotwrap";
      var dot = document.createElement("span");
      dot.className = "tdot";
      if (day.entry) {
        var em = emoByK(day.entry.k);
        dot.style.background = em ? em.col : "var(--text-dim)";
        dot.title = emoLabel(day.entry.k) || "";
      } else {
        dot.className = "tdot hollow";    // no entry that day
      }
      wrap.appendChild(dot);
      var lb = document.createElement("span");
      lb.className = "twd";
      var lbd = new Date();                    // DST-safe calendar step
      lbd.setDate(lbd.getDate() - (6 - idx));
      lb.textContent = lbd.toLocaleDateString(loc(),
          { weekday: "narrow" });
      wrap.appendChild(lb);
      host.appendChild(wrap);
    });
  }

  var searchQ = "";   // view state: entries search text (never persisted)

  function searchHaystack(e) {
    var bits = [];
    var d = new Date(e.ts);
    bits.push(d.toLocaleDateString(loc(),
      { weekday: "short", day: "numeric", month: "short" }));
    (e.emotions || []).forEach(function (m) {
      var em = emoByK(m.k);
      if (em) bits.push(em.label);
    });
    if (e.loc) { var L = colValById("loc", e.loc); if (L) bits.push(L.label, colLabel(L)); }
    if (e.person) { var P = colValById("person", e.person); if (P) bits.push(P.label, colLabel(P)); }
    HABITS.forEach(function (h) {
      if (e[h.f] === "yes" || e[h.f] === "no") bits.push(habLbl(h, e[h.f]));
    });
    (e.acts || []).forEach(function (id) { var A = actById(id); if (A) bits.push(A.label); });
    if (e.trig) { var TV = colValById("trig", e.trig); if (TV) bits.push(TV.label, colLabel(TV)); }
    bits.push(e.note || "");
    return bits.join(" ").toLowerCase();
  }

  function fillEntryList() {
    var list = $("entry-list");
    if (!list) return;
    list.innerHTML = "";
    var q = searchQ.trim().toLowerCase();
    var shown = 0;
    var wr = diaryBridge();
    state.entries.forEach(function (e) {
      if (dayFilter && dayKey(e.ts) !== dayFilter) return; // { day } deep link
      if (q && searchHaystack(e).indexOf(q) < 0) return;   // search scans ALL
      if (shown >= 30) return;                             // display cap stays
      shown++;

      var li = document.createElement("li");
      li.className = "entry";

      var when = document.createElement("span");
      when.className = "e-when";
      var d = new Date(e.ts);
      when.textContent =
        d.toLocaleDateString(loc(),
          { weekday: "short", day: "numeric", month: "short" }) +
        " · " + pad(d.getHours()) + ":" + pad(d.getMinutes());
      li.appendChild(when);

      var faces = document.createElement("span");
      faces.className = "e-faces";
      (e.emotions || []).forEach(function (m) {
        var em = emoByK(m.k);
        if (!em) return;
        var f = document.createElement("span");
        f.className = "e-face";
        f.style.color = em.col;
        f.innerHTML = faceFor(m.k);
        f.title = em.label + " · " + m.i + "/5";
        faces.appendChild(f);
      });
      li.appendChild(faces);

      var ctx = document.createElement("span");
      ctx.className = "e-ctx";
      var bits = [];
      if (e.loc) { var L = colValById("loc", e.loc); if (L) bits.push(colLabel(L)); }
      if (e.person) { var P = colValById("person", e.person); if (P) bits.push(colLabel(P)); }
      HABITS.forEach(function (h) {
        if (e[h.f] === "yes" || e[h.f] === "no") bits.push(habLbl(h, e[h.f]));
      });
      (e.acts || []).forEach(function (id) { var A = actById(id); if (A) bits.push(actText(A)); });
      ctx.textContent = bits.join(" · ");
      li.appendChild(ctx);

      if (e.note || e.trig) {
        var sn = document.createElement("span");
        sn.className = "e-note";
        var tv = e.trig ? colValById("trig", e.trig) : null;
        var txt = (tv ? "[" + colLabel(tv) + "] " : "") + e.note;
        sn.textContent = txt.length > 90 ? txt.slice(0, 89) + "…" : txt;
        sn.title = txt;
        li.appendChild(sn);
      }

      var btns = document.createElement("span");
      btns.className = "e-btns";
      var eb = document.createElement("button");
      eb.type = "button";
      eb.className = "e-act";
      eb.title = t("recent.edit");
      eb.setAttribute("aria-label", t("recent.edit"));
      eb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>';
      eb.addEventListener("click", function () { editEntry(e.id); });
      btns.appendChild(eb);
      if (wr) {                             // "Write about it" → Diary (prefill only)
        var wb = document.createElement("button");
        wb.type = "button";
        wb.className = "e-act";
        wb.title = t("wr.btn");
        wb.setAttribute("aria-label", t("wr.btn"));
        wb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M8 7h7M8 11h5"/></svg>';
        wb.addEventListener("click", function () { writeInDiary(e); });
        btns.appendChild(wb);
      }
      var db = document.createElement("button");
      db.type = "button";
      db.className = "e-act del";
      db.title = t("recent.del");
      db.setAttribute("aria-label", t("recent.del"));
      db.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      db.addEventListener("click", function () { deleteEntry(e.id); });
      btns.appendChild(db);
      li.appendChild(btns);

      list.appendChild(li);
    });
    // #5: explicit no-results state when the query matches nothing
    if ((q || dayFilter) && !shown) {
      var nr = document.createElement("li");   // li inside ul — valid HTML
      nr.id = "empty-note";
      nr.textContent = q ? t("ent.noRes").replace("{q}", searchQ.trim()) : t("day.none");
      list.appendChild(nr);
    }
  }

  // ---- Everyday interop (BR-W8-6) ----
  // { day: "YYYY-MM-DD" } (Diary's mood line): the Entries tab showing
  // only that day, with a "Show all days" way out. View state only.
  var dayFilter = null;
  function openDayEntries(ymd) {
    showTab("entries");                   // clears any older day first
    dayFilter = ymd;
    renderRecent();
    var mm = $("moodmain");
    if (mm) mm.scrollTop = 0; else window.scrollTo(0, 0);
  }
  function renderDayBar(sec, list) {
    var bar = document.getElementById("ent-day");
    if (!dayFilter) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "ent-day";
      sec.insertBefore(bar, list);
    }
    bar.textContent = "";
    var lb = document.createElement("span");
    lb.className = "ent-day-lbl";
    var p = dayFilter.split("-");
    lb.textContent = t("day.only").replace("{d}", new Date(+p[0], +p[1] - 1, +p[2])
      .toLocaleDateString(loc(), { weekday: "short", day: "numeric", month: "short", year: "numeric" }));
    bar.appendChild(lb);
    var all = document.createElement("button");
    all.type = "button";
    all.className = "link-btn";
    all.textContent = t("day.all");
    all.addEventListener("click", function () { dayFilter = null; renderRecent(); });
    bar.appendChild(all);
  }
  // "Write about it": Diary opens that entry's day with the longer
  // entry PREFILLED (Diary contract { write: { date, text } }); Diary
  // saves nothing until the user edits or keeps it there.
  function diaryBridge() {
    try {
      var p = window.parent;
      if (!p || p === window || typeof p.__orosOpenAt !== "function") return null;
      if (typeof p.orosAssistInstalled === "function" &&
          !p.orosAssistInstalled().some(function (a) { return a && a.id === "diary"; })) return null;
      return p;
    } catch (e) { return null; }
  }
  function writeInDiary(e) {
    var p = diaryBridge();
    if (!p || !e) return;
    var names = (e.emotions || []).map(function (m) { return emoLabel(m.k); }).join(", ");
    var text = names ? t("wr.head").replace("{m}", names) : "";
    if (e.note) text += (text ? "\n\n" : "") + e.note;
    p.__orosOpenAt("diary", { write: { date: dayKey(e.ts), text: text } });
  }

  function renderRecent() {
    var sec = $("recent"), list = $("entry-list");
    // hide when empty OR when the entries tab isn't the active view —
    // applyView owns visibility; this must never force-show.
    if (viewMode !== "entries") { sec.hidden = true; return; }
    sec.hidden = false;
    var staleEmp = document.getElementById("empty-note");
    if (staleEmp) staleEmp.remove();
    if (!state.entries.length) {           // #15: message, not a blank panel
      var staleSr = document.getElementById("ent-search");   // #N4
      if (staleSr) staleSr.remove();
      renderDayBar(sec, list);
      var emp = document.createElement("div");
      emp.id = "empty-note";
      emp.textContent = t("ent.empty");
      sec.insertBefore(emp, list);
      list.innerHTML = "";
      return;
    }

    // search row: created ONCE, survives re-renders — typing
    // re-fills ONLY the list, so focus never drops.
    var sr = document.getElementById("ent-search");
    if (!sr) {
      sr = document.createElement("input");
      sr.type = "search";
      sr.id = "ent-search";
      sr.placeholder = t("ent.search");
      sr.value = searchQ;
      sr.setAttribute("aria-label", t("ent.search"));
      sr.addEventListener("input", function () {
        searchQ = sr.value;
        fillEntryList();
      });
      sec.insertBefore(sr, list);
    }
    renderDayBar(sec, list);

    fillEntryList();
  }

  function renderAll() {
    renderThread();
    renderRecent();
    if (!$("capture").hidden) buildCapture();   // labels may rename/delete
  }

  // ---------- 3b. Insights view (ALL render-time derived) ----------
  // Zero new storage keys, zero sync surface: every number here is
  // recomputed from state.entries at render time. Range selector
  // lives in view state, never persisted.

  var viewMode = "capture";              // "capture" | "entries" | "insights"
  var insRange = 30;                      // 7 | 30 | 0 (0 = all)
  var calMonth = null;                    // null = current month

  function rangeStart() {
    if (!insRange) return 0;              // all time
    return Date.now() - insRange * 24 * 60 * 60 * 1000;
  }
  function entriesInRange() {
    var from = rangeStart();
    return state.entries.filter(function (e) { return e.ts >= from; });
  }

  // Wave 3 filters — view state only, never persisted. hab is
  // encoded "field:side" e.g. "water:no".
  var insFilter = { loc: null, person: null, hab: null };
  var insFiltersOpen = false;

  function filtersActive() {
    return !!(insFilter.loc || insFilter.person || insFilter.hab);
  }

  function applyFilters(es) {
    var f = insFilter;
    var hf = f.hab ? f.hab.split(":") : null;
    return es.filter(function (e) {
      if (f.loc && e.loc !== f.loc) return false;
      if (f.person && e.person !== f.person) return false;
      if (hf && hf[0] === "@") return V.marks(e, hf[1]);   // wave 30: "@:<custom id>"
      if (hf && e[hf[0]] !== hf[1]) return false;
      return true;
    });
  }

  function showTab(tab) {
    viewMode = tab;
    dayFilter = null;                     // a tab tap shows every day again
    applyView();
  }

  function applyView() {
    var cap = $("capture"), rec = $("recent"),
        thr = $("thread"), ins = $("insights");
    var b1 = $("cap-btn"), b2 = $("ent-btn"), b3 = $("ins-btn");
    if (cap) cap.hidden = (viewMode !== "capture");
    if (rec) rec.hidden = (viewMode !== "entries");
    if (ins) ins.hidden = (viewMode !== "insights");
    if (thr) thr.hidden = (viewMode !== "capture") || !state.entries.length;
    [[b1, viewMode === "capture"],
     [b2, viewMode === "entries"],
     [b3, viewMode === "insights"]].forEach(function (p) {
      if (!p[0]) return;
      p[0].classList.toggle("on", p[1]);
      p[0].setAttribute("aria-pressed", p[1] ? "true" : "false");
      p[0].setAttribute("title",
        p[0] === b1 ? t("capture") :
        p[0] === b2 ? t("tab.ent")  : t("insights"));
    });
    if (viewMode === "insights") {
      calMonth = null;                    // reopen on current month
      renderInsights();
    } else if (viewMode === "entries") {
      renderRecent();
    } else {
      renderAll();
    }
  }

  // -- distribution: counts + avg intensity per emotion; when a
  //    baseline (unfiltered) set is passed, each row gains the
  //    vs-overall delta in percentage points ("Πότε X, πώς ένιωθα;")
  function emoStats(es) {
    var n = {}, sums = {};
    es.forEach(function (e) {
      var seen = {};
      (e.emotions || []).forEach(function (m) {
        if (seen[m.k]) return;               // prevalence: once per entry
        seen[m.k] = true;
        n[m.k] = (n[m.k] || 0) + 1;
        sums[m.k] = (sums[m.k] || 0) + (m.i || 0);
      });
    });
    return { n: n, sums: sums };
  }

  function renderDistribution(host, es, baseEs) {
    var st = emoStats(es);
    var bst = (baseEs && baseEs.length) ? emoStats(baseEs) : null;
    var rows = EMOTIONS.map(function (em) {
      var c = st.n[em.k] || 0;
      return { em: em, n: c, avg: c ? st.sums[em.k] / c : 0 };
    }).filter(function (r) { return r.n > 0; })
      .sort(function (a, b) { return b.n - a.n; });
    if (!rows.length) return;

    var max = rows[0].n;
    rows.forEach(function (r) {
      var row = document.createElement("div");
      row.className = "dist-row";
      row.style.color = r.em.col;
      var lab = document.createElement("span");
      lab.className = "dist-lab";
      lab.textContent = r.em.label;
      row.appendChild(lab);
      var bar = document.createElement("div");
      bar.className = "dist-bar";
      var fill = document.createElement("div");
      fill.className = "dist-fill";
      fill.style.width = Math.max(6, Math.round(r.n / max * 100)) + "%";
      fill.style.background = r.em.col;
      bar.appendChild(fill);
      row.appendChild(bar);
      var val = document.createElement("span");
      val.className = "dist-val";
      val.textContent = String(r.n) + " · " +
        t("ins.avg").replace("{n}", fix1(r.avg));
      if (bst) {
        var share = r.n / es.length * 100;
        var bshare = (bst.n[r.em.k] || 0) / baseEs.length * 100;
        var d = Math.round(share - bshare);
        if (d !== 0) {
          var dv = document.createElement("span");
          dv.className = "dist-delta" + (d > 0 ? " up" : " down");
          dv.textContent = (d > 0 ? "+" : "−") + Math.abs(d) + "pt";
          val.appendChild(dv);
        }
      }
      row.appendChild(val);
      host.appendChild(row);
    });
  }

  // -- filter panel: three single-select groups (Location,
  //    Person, Habits). Tap active chip again to clear it. --
  function mkFChip(label, isActive, toggle) {
    var c = document.createElement("button");
    c.type = "button";
    c.className = "chip" + (isActive ? " on" : "");
    c.textContent = label;
    c.addEventListener("click", function () {
      toggle();
      renderInsights();
    });
    return c;
  }

  function buildFilterPanel(host) {
    var panel = document.createElement("div");
    panel.className = "fpanel";

    var mkGroup = function (titleKey) {
      var h = document.createElement("div");
      h.className = "col-lab";
      h.textContent = t(titleKey);
      panel.appendChild(h);
      var chips = document.createElement("div");
      chips.className = "chips";
      return chips;
    };

    var lc = mkGroup("l2.loc");
    (state.cols.loc || []).forEach(function (v) {
      lc.appendChild(mkFChip(colLabel(v), insFilter.loc === v.id, function () {
        insFilter.loc = insFilter.loc === v.id ? null : v.id;
      }));
    });
    panel.appendChild(lc);

    var pc = mkGroup("l2.person");
    (state.cols.person || []).forEach(function (v) {
      pc.appendChild(mkFChip(colLabel(v), insFilter.person === v.id, function () {
        insFilter.person = insFilter.person === v.id ? null : v.id;
      }));
    });
    panel.appendChild(pc);

    var hc = mkGroup("ins.habits.title");
    HABITS.forEach(function (h) {
      if (h.grp === "rit") return;          // basics group only
      ["yes", "no"].forEach(function (side) {
        hc.appendChild(mkFChip(habLbl(h, side),
          insFilter.hab === h.f + ":" + side, function () {
            insFilter.hab = insFilter.hab === h.f + ":" + side ?
              null : h.f + ":" + side;
          }));
      });
    });
    panel.appendChild(hc);

    var rc = mkGroup("grp.rit");            // rituals group
    HABITS.forEach(function (h) {
      if (h.grp !== "rit") return;
      ["yes", "no"].forEach(function (side) {
        rc.appendChild(mkFChip(habLbl(h, side),
          insFilter.hab === h.f + ":" + side, function () {
            insFilter.hab = insFilter.hab === h.f + ":" + side ?
              null : h.f + ":" + side;
          }));
      });
    });
    panel.appendChild(rc);

    if (CUST_ACTS.length) {                 // wave 30: own activities
      var oc = mkGroup("grp.own");
      CUST_ACTS.forEach(function (a) {
        var key = "@:" + a.id;
        oc.appendChild(mkFChip(actText(a), insFilter.hab === key, function () {
          insFilter.hab = insFilter.hab === key ? null : key;
        }));
      });
      panel.appendChild(oc);
    }

    if (filtersActive()) {
      var cb = document.createElement("button");
      cb.type = "button";
      cb.className = "rst-link";
      cb.textContent = t("ins.clear");
      cb.addEventListener("click", function () {
        insFilter = { loc: null, person: null, hab: null };
        renderInsights();
      });
      panel.appendChild(cb);
    }
    host.appendChild(panel);
  }

  // -- calendar: month grid, filled/hollow dots (same contract
  //    as the 7-day thread), click a day → that day's entries --
  function renderCalendar(host, es) {
    var now = new Date();
    var base = calMonth ? new Date(calMonth.y, calMonth.m, 1) :
      new Date(now.getFullYear(), now.getMonth(), 1);

    // headline: ‹ month year › + Today
    var head = document.createElement("div");
    head.className = "cal-head";
    var prev = document.createElement("button");
    prev.type = "button";
    prev.className = "cal-nav";
    prev.textContent = "‹";
    prev.setAttribute("aria-label", t("ins.cal.prev"));
    prev.addEventListener("click", function () {
      calMonth = { y: base.getFullYear() - (base.getMonth() === 0 ? 1 : 0),
                   m: base.getMonth() === 0 ? 11 : base.getMonth() - 1 };
      renderInsights();
    });
    head.appendChild(prev);
    var mt = document.createElement("span");
    mt.className = "cal-month";
    mt.textContent = base.toLocaleDateString(
      loc(),
      { month: "long", year: "numeric" });
    head.appendChild(mt);
    var next = document.createElement("button");
    next.type = "button";
    next.className = "cal-nav";
    next.textContent = "›";
    next.setAttribute("aria-label", t("ins.cal.next"));
    next.addEventListener("click", function () {
      calMonth = { y: base.getFullYear() + (base.getMonth() === 11 ? 1 : 0),
                   m: base.getMonth() === 11 ? 0 : base.getMonth() + 1 };
      renderInsights();
    });
    head.appendChild(next);
    if (calMonth) {                        // "Today" only when navigated away
      var td = document.createElement("button");
      td.type = "button";
      td.className = "cal-today";
      td.textContent = t("ins.cal.today");
      td.addEventListener("click", function () {
        calMonth = null;
        renderInsights();
      });
      head.appendChild(td);
    }
    host.appendChild(head);

    // weekday header (Mon-first, locale names)
    var wk = document.createElement("div");
    wk.className = "cal-wk";
    for (var i = 0; i < 7; i++) {
      var wd = document.createElement("span");
      wd.textContent = new Date(2024, 0, 1 + i)  // Mon Jan 1, 2024 week
        .toLocaleDateString(loc(),
          { weekday: "narrow" });
      wk.appendChild(wd);
    }
    host.appendChild(wk);

    // day-by-day map: highest-intensity emotion per day
    var days = {};
    es.forEach(function (e) {
      var k = dayKey(e.ts);
      var best = null, bi = -1;
      (e.emotions || []).forEach(function (m) {
        if (m.i > bi) { bi = m.i; best = m.k; }
      });
      if (best && (!days[k] || bi > days[k].i)) days[k] = { k: best, i: bi };
    });

    var grid = document.createElement("div");
    grid.className = "cal-grid";
    var first = new Date(base.getFullYear(), base.getMonth(), 1);
    var lead = (first.getDay() + 6) % 7;   // Monday-first offset
    for (var e2 = 0; e2 < lead; e2++) {
      var padEl = document.createElement("span");
      padEl.className = "cal-cell empty";
      grid.appendChild(padEl);
    }
    var dim = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    var todayK = dayKey(Date.now());
    for (var d2 = 1; d2 <= dim; d2++) {
      var dt = new Date(base.getFullYear(), base.getMonth(), d2);
      var dk = dayKey(dt.getTime());
      var cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cal-cell" + (dk === todayK ? " today" : "");
      var dot = document.createElement("span");
      dot.className = "tdot";
      if (days[dk]) {
        var em = emoByK(days[dk].k);
        dot.style.background = em ? em.col : "var(--text-dim)";
        dot.title = emoLabel(days[dk].k);
      } else {
        dot.className = "tdot hollow";     // absence ≠ neutral
      }
      cell.appendChild(dot);
      var dn = document.createElement("span");
      dn.className = "cal-d";
      dn.textContent = String(d2);
      cell.appendChild(dn);
      if (days[dk]) {
        (function (kk) {
          cell.addEventListener("click", function () { renderDayList(kk); });
        })(dk);
      } else {
        cell.disabled = true;
      }
      grid.appendChild(cell);
    }
    host.appendChild(grid);

    // day-detail target (filled by renderDayList)
    var dl = document.createElement("div");
    dl.id = "day-list";
    dl.hidden = true;
    host.appendChild(dl);
  }

  function renderDayList(dayK, hostId) {
    var dl = $(hostId || "day-list");
    if (!dl) return;
    dl.hidden = false;
    dl.innerHTML = "";
    var dparts = dayK.split("-");              // "YYYY-MM-DD" → local Date
    var dstr = new Date(+dparts[0], +dparts[1] - 1, +dparts[2])
      .toLocaleDateString(loc(),
        { weekday: "short", day: "numeric", month: "long", year: "numeric" });
    var title = document.createElement("div");
    title.className = "col-lab";
    title.textContent = t("ins.day.entries") + " · " + dstr;
    dl.appendChild(title);
    var list = document.createElement("ul");
    state.entries.forEach(function (e) {
      if (dayKey(e.ts) !== dayK) return;
      var li = document.createElement("li");
      li.className = "entry";
      var when = document.createElement("span");
      when.className = "e-when";
      var d = new Date(e.ts);
      when.textContent = pad(d.getHours()) + ":" + pad(d.getMinutes());
      li.appendChild(when);
      var faces = document.createElement("span");
      faces.className = "e-faces";
      (e.emotions || []).forEach(function (m) {
        var em = emoByK(m.k);
        if (!em) return;
        var f = document.createElement("span");
        f.className = "e-face";
        f.style.color = em.col;
        f.innerHTML = faceFor(m.k);
        f.title = em.label + " · " + m.i + "/5";
        faces.appendChild(f);
      });
      li.appendChild(faces);
      if (e.note) {
        var sn = document.createElement("span");
        sn.className = "e-ctx";
        sn.textContent = e.note.length > 60 ?
          e.note.slice(0, 59) + "…" : e.note;
        li.appendChild(sn);
      }
      list.appendChild(li);
    });
    dl.appendChild(list);
  }

  // -- streak (strict) + logged days, over the SELECTED range --
  // Strict = consecutive days with ≥1 entry; a missed day breaks
  // it. Integrity rule: absence is never imputed as neutral.
  function streakInfo(es) {
    var daySet = {};
    es.forEach(function (e) { daySet[dayKey(e.ts)] = true; });
    var logged = Object.keys(daySet).length;

    // walk BACKWARD from today (or yesterday if nothing today yet)
    var streak = 0;
    var cur = new Date();
    if (!daySet[dayKey(cur.getTime())]) {
      cur.setDate(cur.getDate() - 1);          // DST-safe calendar step
      if (!daySet[dayKey(cur.getTime())]) return { streak: 0, logged: logged };
    }
    while (daySet[dayKey(cur.getTime())]) {
      streak++;
      cur.setDate(cur.getDate() - 1);          // DST-safe calendar step
    }
    return { streak: streak, logged: logged };
  }

  // -- habits adherence: yes/no/day-over-logged-days strips.
  //    TWO subsections over the ONE HABITS array — grp decides
  //    the bucket, labelKey the dim subsection heading. --
  function renderHabits(host, es, grp) {
    var daySet = {};
    es.forEach(function (e) { daySet[dayKey(e.ts)] = 1; });
    if (!Object.keys(daySet).length) return;
    if (grp === "own") { renderOwnActs(host, es, daySet); return; }

    HABITS.forEach(function (h) {
      if (h.grp !== grp) return;
      // MD-3: per-DAY counting — the label says "logged days",
      // so two check-ins in one day count once. Within a day
      // "yes" outranks "no" (positive evidence wins).
      var marks = {};
      es.forEach(function (e) {
        if (e[h.f] !== "yes" && e[h.f] !== "no") return;
        var mk = dayKey(e.ts);
        if (e[h.f] === "yes" || marks[mk] !== "yes") marks[mk] = e[h.f];
      });
      var yesDays = 0, noDays = 0;
      Object.keys(marks).forEach(function (mk) {
        if (marks[mk] === "yes") yesDays++; else noDays++;
      });
      if (!yesDays && !noDays) return;   // #1: no "0 of 0" ghost rows
      var row = document.createElement("div");
      row.className = "dist-row";
      var lab = document.createElement("span");
      lab.className = "dist-lab";
      lab.textContent = habLbl(h, "yes");
      row.appendChild(lab);
      var bar = document.createElement("div");
      bar.className = "dist-bar";
      var fill = document.createElement("div");
      fill.className = "dist-fill";
      fill.style.width =
        Math.max(4, Math.round(yesDays / (yesDays + noDays || 1) * 100)) + "%";
      fill.style.background = "var(--accent)";   // neutral metric → OS hue
      bar.appendChild(fill);
      row.appendChild(bar);
      var val = document.createElement("span");
      val.className = "dist-val";
      val.textContent = t("ins.hab.days")
        .replace("{y}", yesDays).replace("{n}", yesDays + noDays);
      row.appendChild(val);
      host.appendChild(row);
    });
  }

  // -- wave 30: the user's own activities — days marked over the
  //    logged days (they have no "no" side) --
  function ownActDays(es, id) {
    var d = {};
    es.forEach(function (e) { if (V.marks(e, id)) d[dayKey(e.ts)] = 1; });
    return Object.keys(d).length;
  }
  function renderOwnActs(host, es, daySet) {
    var nDays = Object.keys(daySet).length;
    CUST_ACTS.forEach(function (a) {
      var yesDays = ownActDays(es, a.id);
      if (!yesDays) return;
      var row = document.createElement("div");
      row.className = "dist-row";
      var lab = document.createElement("span");
      lab.className = "dist-lab";
      lab.textContent = actText(a);
      row.appendChild(lab);
      var bar = document.createElement("div");
      bar.className = "dist-bar";
      var fill = document.createElement("div");
      fill.className = "dist-fill";
      fill.style.width = Math.max(4, Math.round(yesDays / nDays * 100)) + "%";
      fill.style.background = "var(--accent)";
      bar.appendChild(fill);
      row.appendChild(bar);
      var val = document.createElement("span");
      val.className = "dist-val";
      val.textContent = t("ins.hab.days").replace("{y}", yesDays).replace("{n}", nDays);
      row.appendChild(val);
      host.appendChild(row);
    });
  }

  // -- Location / Person breakdowns (Option A: entries pointing
  //    at a deleted value count as "not logged" for that column;
  //    everything else about them still counts) --
  function renderBreakdown(host, es, col, titleKey) {
    var counts = {}, order = [];
    es.forEach(function (e) {
      var id = e[col];
      if (!id) return;
      if (!colValById(col, id)) return;    // deleted value → skip
      if (counts[id] === undefined) order.push(id);
      counts[id] = (counts[id] || 0) + 1;
    });
    if (!order.length) return;
    order.sort(function (a, b) { return counts[b] - counts[a]; });

    var h = document.createElement("h2");
    h.className = "sec-title";
    h.textContent = t(titleKey);
    host.appendChild(h);
    order.slice(0, 8).forEach(function (id) {
      var v = colValById(col, id);
      var row = document.createElement("div");
      row.className = "dist-row";
      var lab = document.createElement("span");
      lab.className = "dist-lab";
      lab.textContent = colLabel(v);
      row.appendChild(lab);
      var bar = document.createElement("div");
      bar.className = "dist-bar";
      var fill = document.createElement("div");
      fill.className = "dist-fill";
      fill.style.width =
        Math.max(6, Math.round(counts[id] / counts[order[0]] * 100)) + "%";
      fill.style.background = "var(--accent)";   // neutral metric → OS hue
      bar.appendChild(fill);
      row.appendChild(bar);
      var val = document.createElement("span");
      val.className = "dist-val";
      val.textContent = String(counts[id]);
      row.appendChild(val);
      host.appendChild(row);
    });
  }

  function appendResetLink(host) {
    var rst = document.createElement("button");
    rst.type = "button";
    rst.className = "rst-link";
    rst.textContent = t("rst.btn");
    rst.addEventListener("click", askReset);
    host.appendChild(rst);
  }

  // ---------- Trends engine (Wave 3.5) ----------
  // Transparent stats: for each context (loc / person / habit
  // yes-no side), find the emotion MOST over-represented vs the
  // range baseline. Guards against lying: min sample per
  // condition, min delta, capped sentence count.
  var TR_MIN_N  = 5;    // min entries per condition
  var TR_DELTA  = 12;   // min percentage points
  var TR_MAX    = 6;    // max sentences shown
  var POS_EMOS  = ["happy", "calm", "excited"];   // momentum uses this

  function condDelta(cond, base) {
    if (!cond.length || !base.length) return null;
    var st = emoStats(cond), bs = emoStats(base);
    var best = null, bd = 0;
    EMOTIONS.forEach(function (em) {
      var cn = st.n[em.k] || 0;
      if (cn < 2) return;
      var d = Math.round((cn / cond.length -
        (bs.n[em.k] || 0) / base.length) * 100);
      if (d > bd && d >= TR_DELTA) { bd = d; best = { k: em.k, d: d }; }
    });
    return best;
  }

  function buildTrends(sub, base) {
    var out = [];
    var consider = function (cond, render) {
      if (cond.length < TR_MIN_N) return;
      var b = condDelta(cond, base);
      if (b) out.push({ d: b.d, fn: render(b) });
    };
    (state.cols.loc || []).forEach(function (v) {
      consider(sub.filter(function (e) { return e.loc === v.id; }),
        function (b) { return t("tr.loc")
          .replace("{x}", colLabel(v))
          .replace("{e}", emoLabel(b.k))
          .replace("{d}", b.d); });
    });
    (state.cols.person || []).forEach(function (v) {
      consider(sub.filter(function (e) { return e.person === v.id; }),
        function (b) { return t("tr.person")
          .replace("{x}", colLabel(v))
          .replace("{e}", emoLabel(b.k))
          .replace("{d}", b.d); });
    });
    HABITS.forEach(function (h) {
      ["yes", "no"].forEach(function (side) {
        var cond = sub.filter(function (e) { return e[h.f] === side; });
        consider(cond, function (b) { return t("tr.hab")
          .replace("{h}", habLbl(h, side))
          .replace("{e}", emoLabel(b.k))
          .replace("{d}", b.d); });
        // tendency: a "no" habit marked ≥35% of logged days
        if (side === "no" && cond.length >= TR_MIN_N) {
          var p = Math.round(cond.length / sub.length * 100);
          if (p >= 35) out.push({ d: p, fn: t("tr.freq")
            .replace("{h}", habLbl(h, "no")).replace("{p}", p) });
        }
      });
    });
    CUST_ACTS.forEach(function (a) {         // wave 30: own activities
      consider(sub.filter(function (e) { return V.marks(e, a.id); }),
        function (b) { return t("tr.hab")
          .replace("{h}", a.label)
          .replace("{e}", emoLabel(b.k))
          .replace("{d}", b.d); });
    });
    // -- co-occurrence pairs: "when you feel X, you also mark Y" --
    // Guarded: ≥40% co-occurrence AND ≥20pt above that emotion's
    // general prevalence (else every pair with itself-heavy sets leaks).
    var bSt = emoStats(sub);
    EMOTIONS.forEach(function (ea) {
      var withA = sub.filter(function (e) {
        return (e.emotions || []).some(function (m) { return m.k === ea.k; });
      });
      if (withA.length < TR_MIN_N) return;
      EMOTIONS.forEach(function (eb) {
        if (eb.k === ea.k) return;
        var coN = withA.filter(function (e) {
          return (e.emotions || []).some(function (m) { return m.k === eb.k; });
        }).length;
        if (coN < 2) return;
        var coPct = Math.round(coN / withA.length * 100);
        var basePct = Math.round((bSt.n[eb.k] || 0) / sub.length * 100);
        if (coPct - basePct >= 20 && coPct >= 40) {
          out.push({ d: coPct - basePct, fn: t("tr.pair")
            .replace("{a}", emoLabel(ea.k))
            .replace("{b}", emoLabel(eb.k))
            .replace("{p}", coPct) });
        }
      });
    });

    // -- trigger-based conditions (top 6 triggers by usage) --
    var trigCount = {}, trigOrig = {};
    sub.forEach(function (e) {
      if (!e.trig) return;
      var v = colValById("trig", e.trig);
      if (!v) return;
      var s = String(v.label).trim();
      if (!s) return;
      var key = s.toLowerCase();
      trigCount[key] = (trigCount[key] || 0) + 1;
      trigOrig[key] = colLabel(v);   // DISPLAY in active language;
                                     // matching below stays on stored label
    });
    Object.keys(trigCount).sort(function (a, b) {
      return trigCount[b] - trigCount[a];
    }).slice(0, 6).forEach(function (tk) {
      var cond = sub.filter(function (e) {
        if (!e.trig) return false;
        var v = colValById("trig", e.trig);
        return !!v && String(v.label).trim().toLowerCase() === tk;
      });
      consider(cond, function (b) { return t("tr.trig")
        .replace("{x}", trigOrig[tk])
        .replace("{e}", emoLabel(b.k))
        .replace("{d}", b.d); });
    });

    // -- cross-app: period days (Wave 2.2) — READ-ONLY peek at
    //    the Cycle app's slice in the shared localStorage (same
    //    origin). Absent / corrupt data contributes NOTHING;
    //    this section never writes, ever. --
    try {
      var craw = localStorage.getItem("oros-cycle-data");
      if (craw) {
        var cd = JSON.parse(craw);
        if (cd && Array.isArray(cd.periods)) {
          var cycDays = {};
          cd.periods.forEach(function (p) {
            if (!p || typeof p.start !== "number") return;
            var pend = (p.end === null) ? Date.now() :
              ((typeof p.end === "number") ? p.end : p.start);
            if (pend < p.start) pend = p.start;
            if ((pend - p.start) / 86400000 > 60) return;   // pathological guard
            var cur = new Date(p.start);                     // DST-safe walk
            while (cur.getTime() <= pend) {
              cycDays[dayKey(cur.getTime())] = true;
              cur.setDate(cur.getDate() + 1);
            }
          });
          var pcond = sub.filter(function (e) { return cycDays[dayKey(e.ts)]; });
          consider(pcond, function (b) { return t("tr.per")
            .replace("{e}", emoLabel(b.k))
            .replace("{d}", b.d); });
        }
      }
    } catch (err) { /* not our data — ignore silently */ }

    out.sort(function (a, b) { return b.d - a.d; });
    return out.slice(0, TR_MAX).map(function (o) { return o.fn; });
  }

  // -- weekday patterns: emotion most over-represented per day
  //    of week vs the range overall --
  function renderWeekday(host, es) {
    if (es.length < 7) return;
    var base = emoStats(es);
    var buckets = [[], [], [], [], [], [], []];   // 0=Sun..6=Sat
    es.forEach(function (e) { buckets[new Date(e.ts).getDay()].push(e); });
    var rows = [];
    buckets.forEach(function (bk, wd) {
      if (bk.length < 3) return;
      var st = emoStats(bk);
      var best = null, bd = 0;
      EMOTIONS.forEach(function (em) {
        var cn = st.n[em.k] || 0;
        if (cn < 2) return;
        var d = Math.round((cn / bk.length -
          (base.n[em.k] || 0) / es.length) * 100);
        if (d > bd && d >= 10) { bd = d; best = { k: em.k, d: d }; }
      });
      if (best) rows.push({ wd: wd, k: best.k, d: best.d });
    });
    if (!rows.length) return;
    rows.sort(function (a, b) { return ((a.wd + 6) % 7) - ((b.wd + 6) % 7); });
    var h = document.createElement("h2");
    h.className = "sec-title";
    h.textContent = t("ins.dow.title");
    host.appendChild(h);
    var box = document.createElement("div");
    box.className = "trlist";
    rows.forEach(function (r) {
      var li = document.createElement("div");
      li.className = "tr-line";
      var wdName = new Date(2024, 0, 1 + ((r.wd + 6) % 7))   // Mon Jan 1 2024
        .toLocaleDateString(loc(),
          { weekday: "long" });
      li.appendChild(document.createTextNode(wdName + ": "));
      var em = emoByK(r.k);
      var sp = document.createElement("span");
      sp.style.color = em ? em.col : "";
      sp.textContent = emoLabel(r.k);
      li.appendChild(sp);
      var dv = document.createElement("span");
      dv.className = "dist-delta up";
      dv.textContent = " +" + r.d + "pt";
      li.appendChild(dv);
      box.appendChild(li);
    });
    host.appendChild(box);
  }

  // -- weekly momentum: positive-feelings share, this week vs
  //    the previous one. Time-based → ignores filters (streak
  //    family), respects only the selected range --
  function renderMomentum(host, es) {
    var now = Date.now();
    var wk = es.filter(function (e) { return e.ts >= now - 7 * 86400000; });
    var pw = es.filter(function (e) {
      return e.ts >= now - 14 * 86400000 && e.ts < now - 7 * 86400000;
    });
    if (wk.length < 3 || pw.length < 3) return;
    var posShare = function (set) {
      var n = set.filter(function (e) {
        return (e.emotions || []).some(function (m) {
          return POS_EMOS.indexOf(m.k) >= 0;
        });
      }).length;
      return Math.round(n / set.length * 100);
    };
    var a = posShare(wk), b = posShare(pw), d = a - b;
    var h = document.createElement("h2");
    h.className = "sec-title";
    h.textContent = t("ins.mom.title");
    host.appendChild(h);
    var box = document.createElement("div");
    [[t("mom.prev"), b], [t("mom.this"), a]].forEach(function (r, idx) {
      var row = document.createElement("div");
      row.className = "dist-row";
      var lab = document.createElement("span");
      lab.className = "dist-lab";
      lab.textContent = r[0];
      row.appendChild(lab);
      var bar = document.createElement("div");
      bar.className = "dist-bar";
      var fill = document.createElement("div");
      fill.className = "dist-fill";
      fill.style.width = Math.max(4, r[1]) + "%";
      fill.style.background = "var(--accent)";
      bar.appendChild(fill);
      row.appendChild(bar);
      var val = document.createElement("span");
      val.className = "dist-val";
      val.textContent = r[1] + "%";
      if (idx === 1 && d !== 0) {
        var dv = document.createElement("span");
        dv.className = "dist-delta " + (d > 0 ? "up" : "down");
        dv.textContent = (d > 0 ? "+" : "−") + Math.abs(d) + "pt";
        val.appendChild(dv);
      }
      row.appendChild(val);
      box.appendChild(row);
    });
    host.appendChild(box);
    var hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = t("mom.pos");
    host.appendChild(hint);
  }

  // -- weekly recap: KPI card at the top of insights (numbers,
  //    top feeling, positive share vs last week) --
  function renderRecap(host, es) {
    var now = Date.now();
    var wk = es.filter(function (e) { return e.ts >= now - 7 * 86400000; });
    if (!wk.length) return;

    var card = document.createElement("div");
    card.className = "recap-card";
    var h = document.createElement("div");
    h.className = "col-lab";
    h.textContent = t("rec.title");
    card.appendChild(h);
    var row = document.createElement("div");
    row.className = "recap-row";
    card.appendChild(row);

    var mkKpi = function (lab, val, delta, dir) {
      var k = document.createElement("div");
      k.className = "recap-kpi";
      var v = document.createElement("div");
      v.className = "recap-val";
      v.textContent = val;
      if (delta) {
        var dv = document.createElement("span");
        dv.className = "dist-delta " + (dir === "up" ? "up" : "down");
        dv.textContent = delta;
        v.appendChild(dv);
      }
      var l = document.createElement("div");
      l.className = "recap-lab";
      l.textContent = lab;
      k.appendChild(v); k.appendChild(l);
      row.appendChild(k);
    };

    mkKpi(t("rec.entries"), String(wk.length));

    var st = emoStats(wk);
    var top = null, topN = 0;
    EMOTIONS.forEach(function (em) {
      var c = st.n[em.k] || 0;
      if (c > topN) { topN = c; top = em; }
    });
    if (top) mkKpi(t("rec.top"), top.label, topN + "×", "up");

    var posShare = function (set) {
      var n = set.filter(function (e) {
        return (e.emotions || []).some(function (m) {
          return POS_EMOS.indexOf(m.k) >= 0;
        });
      }).length;
      return set.length ? Math.round(n / set.length * 100) : null;
    };
    var pw = es.filter(function (e) {
      return e.ts >= now - 14 * 86400000 && e.ts < now - 7 * 86400000;
    });
    var d = posShare(wk);
    var deltaTxt = "", dirCls = "";
    if (pw.length >= 3) {
      var dd = d - posShare(pw);
      if (dd !== 0) {
        dirCls = dd > 0 ? "up" : "down";
        deltaTxt = (dd > 0 ? "+" : "−") + Math.abs(dd) + "pt";
      }
    }
    mkKpi(t("rec.pos"), d + "%", deltaTxt, dirCls);
    host.appendChild(card);
  }

  // -- intensity trend: avg intensity per emotion, recent half
  //    vs earlier half of the (filtered) range. Frequency says
  //    HOW OFTEN; this says HOW STRONGLY. Min 3 samples per side.
  function renderIntensity(host, es) {
    if (es.length < 8) return;
    var half = Math.floor(es.length / 2);
    var rec = es.slice(0, half), oldr = es.slice(half);   // ts-desc order
    var avgs = function (set) {
      var st = emoStats(set), out = {};
      Object.keys(st.n).forEach(function (k) {
        if (st.n[k] >= 3) out[k] = st.sums[k] / st.n[k];
      });
      return out;
    };
    var rm = avgs(rec), om = avgs(oldr);
    var rows = [];
    Object.keys(rm).forEach(function (k) {
      if (om[k] === undefined) return;
      var d = +(rm[k] - om[k]).toFixed(1);
      if (Math.abs(d) < 0.4) return;             // noise floor
      rows.push({ k: k, r: rm[k], d: d });
    });
    if (!rows.length) return;
    rows.sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); });
    rows = rows.slice(0, 5);

    var h = document.createElement("h2");
    h.className = "sec-title";
    h.textContent = t("ins.int.title");
    host.appendChild(h);
    rows.forEach(function (r) {
      var em = emoByK(r.k);
      var row = document.createElement("div");
      row.className = "dist-row";
      row.style.color = em ? em.col : "";
      var lab = document.createElement("span");
      lab.className = "dist-lab";
      lab.textContent = em ? em.label : r.k;
      row.appendChild(lab);
      var bar = document.createElement("div");
      bar.className = "dist-bar";
      var fill = document.createElement("div");
      fill.className = "dist-fill";
      fill.style.width = Math.round(r.r / 5 * 100) + "%";   // of max 5
      fill.style.background = em ? em.col : "var(--accent)";
      bar.appendChild(fill);
      row.appendChild(bar);
      var val = document.createElement("span");
      val.className = "dist-val";
      val.textContent = fix1(r.r) + "/5";
      var dv = document.createElement("span");
      dv.className = "dist-delta " + (r.d > 0 ? "up" : "down");
      dv.textContent = (r.d > 0 ? "+" : "−") + fix1(Math.abs(r.d));
      val.appendChild(dv);
      row.appendChild(val);
      host.appendChild(row);
    });
    var hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = t("ins.int.hint");
    host.appendChild(hint);
  }

  // ---------- Wave 30: goals, year in pixels, customisation ----------
  function goalTitle(g, plain) {
    var name;
    if (plain) {
      if (V.isCustomId(g.act)) { var a = actById(g.act); name = a ? a.label : "?"; }
      else {
        name = g.act;
        HABITS.forEach(function (h) { if (h.f === g.act) name = habLbl(h, "yes"); });
      }
    } else name = anyActText(g.act);
    return name + " · " + t(g.per === "m" ? "gl.per.m" : "gl.per.w").replace("{n}", g.n);
  }

  function renderGoals(host) {
    var goals = V.liveGoals(state.goals);
    var h = document.createElement("h2");
    h.className = "sec-title";
    h.textContent = t("gl.title");
    host.appendChild(h);
    var box = document.createElement("div");
    box.className = "goal-list";
    box.id = "goal-list";
    if (!goals.length) {
      var em = document.createElement("div");
      em.className = "hint";
      em.textContent = t("gl.none");
      box.appendChild(em);
    }
    var now = Date.now();
    goals.forEach(function (g) {
      var p = V.goalProgress(state.entries, g, now, g.per === "m" ? 6 : 8);
      var card = document.createElement("div");
      card.className = "goal-card" + (p.ok ? " ok" : "");
      var top = document.createElement("div");
      top.className = "goal-top";
      var nm = document.createElement("span");
      nm.className = "goal-name";
      nm.textContent = goalTitle(g);
      top.appendChild(nm);
      var val = document.createElement("span");
      val.className = "goal-val";
      val.textContent = t(g.per === "m" ? "gl.prog.m" : "gl.prog.w")
        .replace("{d}", p.done).replace("{n}", p.n);
      top.appendChild(val);
      card.appendChild(top);
      var bar = document.createElement("div");
      bar.className = "dist-bar";
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", String(p.n));
      bar.setAttribute("aria-valuenow", String(Math.min(p.done, p.n)));
      bar.setAttribute("aria-label", goalTitle(g));
      var fill = document.createElement("div");
      fill.className = "dist-fill";
      fill.style.width = Math.max(p.done ? 4 : 0, p.pct) + "%";
      fill.style.background = p.ok ? "#87cf3e" : "var(--accent)";
      bar.appendChild(fill);
      card.appendChild(bar);
      var hist = document.createElement("div");
      hist.className = "hint goal-hist";
      hist.textContent = (p.ok ? t("gl.done") + " · " : "") +
        t(g.per === "m" ? "gl.hist.m" : "gl.hist.w")
          .replace("{m}", p.met).replace("{k}", p.past.length);
      card.appendChild(hist);
      box.appendChild(card);
    });
    host.appendChild(box);
    var mg = document.createElement("button");
    mg.type = "button";
    mg.className = "chip ghost";
    mg.id = "goal-manage";
    mg.textContent = goals.length ? t("gl.manage") : t("gl.add");
    mg.addEventListener("click", function () { openVocab("goal"); });
    host.appendChild(mg);
  }

  var pxYear = null;                       // view state: year shown (null = this year)
  function renderPixels(host) {
    var thisYear = new Date().getFullYear();
    var years = V.yearsWithData(state.entries, thisYear);
    var y = pxYear || thisYear;
    var h = document.createElement("h2");
    h.className = "sec-title";
    h.textContent = t("px.title");
    host.appendChild(h);
    var head = document.createElement("div");
    head.className = "cal-head";
    var prev = document.createElement("button");
    prev.type = "button";
    prev.className = "cal-nav";
    prev.textContent = "‹";
    prev.setAttribute("aria-label", t("px.prev"));
    prev.disabled = y <= years[0];
    prev.addEventListener("click", function () { pxYear = y - 1; renderInsights(); });
    head.appendChild(prev);
    var yt = document.createElement("span");
    yt.className = "cal-month";
    yt.textContent = String(y);
    head.appendChild(yt);
    var next = document.createElement("button");
    next.type = "button";
    next.className = "cal-nav";
    next.textContent = "›";
    next.setAttribute("aria-label", t("px.next"));
    next.disabled = y >= thisYear;
    next.addEventListener("click", function () { pxYear = y + 1 >= thisYear ? null : y + 1; renderInsights(); });
    head.appendChild(next);
    host.appendChild(head);

    var px = V.yearPixels(state.entries, y);
    var grid = document.createElement("div");
    grid.className = "px-grid";
    grid.id = "px-grid";
    var corner = document.createElement("span");
    corner.className = "px-h";
    grid.appendChild(corner);
    for (var m = 1; m <= 12; m++) {
      var mh = document.createElement("span");
      mh.className = "px-h";
      mh.textContent = new Date(2024, m - 1, 1).toLocaleDateString(
        loc(), { month: "narrow" });
      grid.appendChild(mh);
    }
    var todayK = dayKey(Date.now()), used = {};
    for (var d = 1; d <= 31; d++) {
      var dn = document.createElement("span");
      dn.className = "px-d";
      dn.textContent = (d === 1 || d % 5 === 0) ? String(d) : "";
      grid.appendChild(dn);
      for (var mm = 1; mm <= 12; mm++) {
        if (d > V.daysIn(y, mm)) {
          var no = document.createElement("span");
          no.className = "px-cell none";
          grid.appendChild(no);
          continue;
        }
        var dk = y + "-" + pad(mm) + "-" + pad(d);
        var cell = document.createElement("button");
        cell.type = "button";
        cell.className = "px-cell" + (dk === todayK ? " today" : "");
        var dl = new Date(y, mm - 1, d).toLocaleDateString(loc(),
          { day: "numeric", month: "long" });
        if (px[dk]) {
          var em = emoByK(px[dk].k);
          cell.style.background = em ? em.col : "var(--text-dim)";
          used[px[dk].k] = 1;
          cell.setAttribute("aria-label", dl + ": " + emoLabel(px[dk].k));
          cell.title = dl + " · " + emoLabel(px[dk].k);
          (function (kk) {
            cell.addEventListener("click", function () {
              var prevOn = grid.querySelector(".px-cell.sel");
              if (prevOn) prevOn.classList.remove("sel");
              this.classList.add("sel");
              renderDayList(kk, "px-day-list");
            });
          })(dk);
        } else {
          cell.disabled = true;
          cell.setAttribute("aria-label", dl);
        }
        grid.appendChild(cell);
      }
    }
    host.appendChild(grid);
    var keys = Object.keys(used);
    if (keys.length) {
      var lg = document.createElement("div");
      lg.className = "px-legend";
      EMOTIONS.forEach(function (em) {
        if (!used[em.k]) return;
        var it = document.createElement("span");
        it.className = "px-lg";
        var sw = document.createElement("span");
        sw.className = "px-sw";
        sw.style.background = em.col;
        it.appendChild(sw);
        it.appendChild(document.createTextNode(em.label));
        lg.appendChild(it);
      });
      host.appendChild(lg);
    } else {
      var ne = document.createElement("div");
      ne.className = "hint";
      ne.textContent = t("px.empty");
      host.appendChild(ne);
    }
    var pl = document.createElement("div");
    pl.id = "px-day-list";
    pl.className = "day-list";
    pl.hidden = true;
    host.appendChild(pl);
  }

  // ---- customisation: data writes ----
  function vocabWrite(fn) {
    var vo = state.vocab ? JSON.parse(JSON.stringify(state.vocab)) : {};
    fn(vo);
    state.vocab = V.mergeVocab(vo, null) || undefined;
    if (!state.vocab) delete state.vocab;
    state.sm = Date.now();
    save();
    refreshVocab();
    renderAll();
    if (viewMode === "insights") renderInsights();
  }
  // Patch one definition (creates it); empty fields are dropped.
  function setDef(list, id, patch) {
    vocabWrite(function (vo) {
      var arr = vo[list] = Array.isArray(vo[list]) ? vo[list] : [];
      var d = null;
      arr.forEach(function (x) { if (x && x.id === id) d = x; });
      if (!d) { d = { id: id }; arr.push(d); }
      Object.keys(patch).forEach(function (k) {
        if (patch[k] === null || patch[k] === "" || patch[k] === false) delete d[k];
        else d[k] = patch[k];
      });
      d.mtime = Math.max(Date.now(), (d.mtime || 0) + 1);
    });
  }
  function moveDef(list, id, dir) {
    var ids = list === "emo" ? EMOTIONS.map(function (x) { return x.k; })
      : HABITS.map(function (x) { return x.f; }).concat(CUST_ACTS.map(function (x) { return x.id; }));
    var next = V.moveId(ids, id, dir);
    vocabWrite(function (vo) {
      var key = list === "emo" ? "eo" : "ao";
      var old = vo[key] && vo[key].m ? vo[key].m : 0;
      vo[key] = { ids: next, m: Math.max(Date.now(), old + 1) };
    });
  }
  function labelTaken(list, label, exceptId) {
    var n = normLabel(label);
    if (list === "emo") {
      return EMOTIONS.some(function (x) { return x.k !== exceptId && normLabel(x.label) === n; });
    }
    return HABITS.some(function (h) {
      return h.f !== exceptId && (normLabel(habLbl(h, "yes")) === n || normLabel(habLbl(h, "no")) === n);
    }) || CUST_ACTS.some(function (a) { return a.id !== exceptId && normLabel(a.label) === n; });
  }
  function goalsWrite(fn) {
    var gs = state.goals ? JSON.parse(JSON.stringify(state.goals)) : [];
    gs = fn(gs) || gs;
    var mg = V.mergeGoals(gs, null);
    if (mg) state.goals = mg; else delete state.goals;
    state.sm = Date.now();
    save();
    if (viewMode === "insights") renderInsights();
  }

  // ---- customisation dialog: Feelings · Activities · Goals ----
  var vcDlg = null, vcTab = "emo";
  function openVocab(tab) {
    vcTab = tab || "emo";
    if (vcDlg) { try { vcDlg.close(); } catch (e) {} vcDlg.remove(); }
    var d = document.createElement("dialog");
    d.className = "rst-dlg vc-dlg";
    d.id = "vc-dlg";
    d.setAttribute("aria-label", t("vc.title"));
    d.addEventListener("close", function () { d.remove(); if (vcDlg === d) vcDlg = null; });
    document.body.appendChild(d);
    vcDlg = d;
    d.showModal();
    paintVocab();
  }
  function paintVocab() {
    var d = vcDlg;
    if (!d) return;
    var keepScroll = d.querySelector(".vc-body") ? d.querySelector(".vc-body").scrollTop : 0;
    d.innerHTML = "";
    var head = document.createElement("div");
    head.className = "vc-head";
    var h = document.createElement("h3");
    h.textContent = t("vc.title");
    head.appendChild(h);
    var x = document.createElement("button");
    x.type = "button";
    x.className = "e-act vc-x";
    x.setAttribute("aria-label", t("vc.close"));
    x.title = t("vc.close");
    x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    x.addEventListener("click", function () { d.close(); });
    head.appendChild(x);
    d.appendChild(head);
    var tabs = document.createElement("div");
    tabs.className = "chips vc-tabs";
    tabs.setAttribute("role", "tablist");
    [["emo", "vc.tab.emo"], ["act", "vc.tab.act"], ["goal", "vc.tab.goal"]].forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (vcTab === p[0] ? " on" : "");
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", vcTab === p[0] ? "true" : "false");
      b.textContent = t(p[1]);
      b.addEventListener("click", function () { vcTab = p[0]; paintVocab(); });
      tabs.appendChild(b);
    });
    d.appendChild(tabs);
    var body = document.createElement("div");
    body.className = "vc-body";
    d.appendChild(body);
    if (vcTab === "goal") paintGoalTab(body);
    else paintListTab(body, vcTab);
    body.scrollTop = keepScroll;
  }

  var EYE_ON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.9 9.9 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
  function mkIconIn(val, label) {
    var ic = document.createElement("input");
    ic.type = "text";
    ic.className = "vc-ic";
    ic.maxLength = 8;
    ic.value = val || "";
    ic.placeholder = "🙂";
    ic.setAttribute("aria-label", label);
    ic.title = label;
    return ic;
  }
  function mkLabIn(val, ph, label) {
    var li = document.createElement("input");
    li.type = "text";
    li.className = "vc-lab";
    li.maxLength = V.LAB_MAX;
    li.value = val || "";
    li.placeholder = ph || "";
    li.setAttribute("aria-label", label);
    return li;
  }
  function mkSmallBtn(txt, label, fn, cls) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "vc-btn" + (cls ? " " + cls : "");
    b.textContent = txt;
    b.setAttribute("aria-label", label);
    b.title = label;
    b.addEventListener("click", fn);
    return b;
  }

  function paintListTab(body, list) {
    var hint = document.createElement("p");
    hint.className = "hint vc-hint";
    hint.textContent = t(list === "emo" ? "vc.hint.emo" : "vc.hint.act");
    body.appendChild(hint);
    var rows = list === "emo" ? EMOTIONS.map(function (x) { return { id: x.k, emo: x }; })
      : HABITS.map(function (x) { return { id: x.f, hab: x }; })
          .concat(CUST_ACTS.map(function (x) { return { id: x.id, act: x }; }));
    var ul = document.createElement("ul");
    ul.className = "vc-list";
    rows.forEach(function (r, idx) {
      var li = document.createElement("li");
      li.className = "vc-row";
      var hidden = r.emo ? r.emo.hid : (r.hab ? r.hab.hid : r.act.hid);
      if (hidden) li.classList.add("off");
      var mv = document.createElement("span");
      mv.className = "vc-mv";
      var up = mkSmallBtn("↑", t("vc.up"), function () { moveDef(list, r.id, -1); paintVocab(); });
      up.disabled = idx === 0;
      var dn = mkSmallBtn("↓", t("vc.down"), function () { moveDef(list, r.id, 1); paintVocab(); });
      dn.disabled = idx === rows.length - 1;
      mv.appendChild(up); mv.appendChild(dn);
      li.appendChild(mv);
      var curIc = r.emo ? r.emo.ic : (r.hab ? r.hab.ic : r.act.ic);
      if (r.emo) {                           // what the tile shows now, in its colour
        var pv = document.createElement("span");
        pv.className = "vc-face";
        pv.style.color = r.emo.col;
        pv.innerHTML = faceFor(r.id);
        li.appendChild(pv);
      }
      var ic = mkIconIn(curIc, t("vc.icon"));
      if (r.emo && r.emo.builtin && !r.emo.ic) ic.placeholder = "";
      ic.addEventListener("change", function () {
        var v = V.cleanIcon(ic.value);
        if (!v && r.act) { ic.value = curIc; return; }       // a custom activity keeps an icon
        setDef(list, r.id, { ic: v || null });
        paintVocab();
      });
      li.appendChild(ic);
      var labs = document.createElement("span");
      labs.className = "vc-labs";
      if (r.emo) {
        var b0 = null;
        BUILTIN_EMOS.forEach(function (x) { if (x.k === r.id) b0 = x; });
        var defLab = b0 ? t(b0.i18n) : "";
        var li1 = mkLabIn(r.emo.label, defLab, t("vc.name"));
        li1.addEventListener("change", function () { commitLabel(list, r.id, li1, defLab, "lab"); });
        labs.appendChild(li1);
        if (!r.emo.builtin) {
          var opts = document.createElement("span");
          opts.className = "vc-opts";
          V.CUSTOM_COLORS.forEach(function (c) {
            var sw = document.createElement("button");
            sw.type = "button";
            sw.className = "vc-sw" + (c === r.emo.col ? " on" : "");
            sw.style.background = c;
            sw.setAttribute("aria-label", t("vc.color") + " " + c);
            sw.setAttribute("aria-pressed", c === r.emo.col ? "true" : "false");
            sw.addEventListener("click", function () { setDef(list, r.id, { col: c }); paintVocab(); });
            opts.appendChild(sw);
          });
          var pl = document.createElement("label");
          pl.className = "vc-pos";
          var pc = document.createElement("input");
          pc.type = "checkbox";
          pc.checked = !!r.emo.pos;
          pc.addEventListener("change", function () { setDef(list, r.id, { pos: pc.checked }); });
          pl.appendChild(pc);
          pl.appendChild(document.createTextNode(" " + t("vc.pos")));
          opts.appendChild(pl);
          labs.appendChild(opts);
        }
      } else if (r.hab) {
        var ly = mkLabIn(habLbl(r.hab, "yes"), t(r.hab.yes), t("vc.yes"));
        ly.addEventListener("change", function () { commitLabel(list, r.id, ly, t(r.hab.yes), "lab"); });
        var ln = mkLabIn(habLbl(r.hab, "no"), t(r.hab.no), t("vc.no"));
        ln.classList.add("neg");
        ln.addEventListener("change", function () { commitLabel(list, r.id, ln, t(r.hab.no), "no"); });
        labs.appendChild(ly); labs.appendChild(ln);
      } else {
        var la = mkLabIn(r.act.label, "", t("vc.name"));
        la.addEventListener("change", function () { commitLabel(list, r.id, la, "", "lab"); });
        labs.appendChild(la);
      }
      li.appendChild(labs);
      var hb = mkSmallBtn("", (hidden ? t("vc.show") : t("vc.hide")), function () {
          setDef(list, r.id, { hid: !hidden });
          paintVocab();
        }, "vc-hide");
      hb.innerHTML = hidden ? EYE_OFF : EYE_ON;
      hb.setAttribute("aria-pressed", hidden ? "true" : "false");
      li.appendChild(hb);
      ul.appendChild(li);
    });
    body.appendChild(ul);

    // add a custom one
    var add = document.createElement("div");
    add.className = "vc-add";
    var al = document.createElement("div");
    al.className = "col-lab";
    al.textContent = t(list === "emo" ? "vc.add.emo" : "vc.add.act");
    add.appendChild(al);
    var row = document.createElement("div");
    row.className = "addrow";
    var nic = mkIconIn("", t("vc.icon"));
    nic.id = "vc-new-ic-" + list;
    var nlab = mkLabIn("", t("l2.add.ph"), t("vc.name"));
    nlab.id = "vc-new-lab-" + list;
    var ab = document.createElement("button");
    ab.type = "button";
    ab.className = "prim";
    ab.id = "vc-new-add-" + list;
    ab.textContent = t("l2.add");
    var doAdd = function () {
      var label = V.str(nlab.value, V.LAB_MAX);
      if (!label) { nlab.focus(); return; }
      if (labelTaken(list, label, null)) { transientNote(t("col.dup")); return; }
      var id = "c-" + uid();
      var patch = { lab: label, ic: V.cleanIcon(nic.value) || (list === "emo" ? "🙂" : "⭐") };
      if (list === "emo") {
        var nCustom = EMOTIONS.filter(function (x) { return !x.builtin; }).length;
        patch.col = V.CUSTOM_COLORS[nCustom % V.CUSTOM_COLORS.length];
      }
      setDef(list, id, patch);
      paintVocab();
      var b2 = vcDlg && vcDlg.querySelector(".vc-body");
      if (b2) b2.scrollTop = b2.scrollHeight;
      transientNote(t("vc.added"));
    };
    ab.addEventListener("click", doAdd);
    nlab.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); doAdd(); } });
    row.appendChild(nic); row.appendChild(nlab); row.appendChild(ab);
    add.appendChild(row);
    body.appendChild(add);
  }

  // A label typed in the dialog: empty or the default text = back to
  // the translation (so a language switch keeps working).
  function commitLabel(list, id, input, defText, field) {
    var v = V.str(input.value, V.LAB_MAX);
    var patch = {};
    if (!v || v === defText) {
      if (!defText) { paintVocab(); return; }               // a custom item needs a name
      patch[field] = null;
    } else {
      if (labelTaken(list, v, id)) { transientNote(t("col.dup")); paintVocab(); return; }
      patch[field] = v;
    }
    setDef(list, id, patch);
  }

  function paintGoalTab(body) {
    var hint = document.createElement("p");
    hint.className = "hint vc-hint";
    hint.textContent = t("vc.hint.goal");
    body.appendChild(hint);
    var goals = V.liveGoals(state.goals);
    var ul = document.createElement("ul");
    ul.className = "vc-list";
    goals.forEach(function (g) {
      var li = document.createElement("li");
      li.className = "vc-row";
      var nm = document.createElement("span");
      nm.className = "vc-gname";
      nm.textContent = goalTitle(g);
      li.appendChild(nm);
      li.appendChild(mkSmallBtn(t("col.menu.del"), t("gl.del"), function () {
        goalsWrite(function (gs) {
          gs.forEach(function (x) { if (x.id === g.id) { x.x = 1; x.mtime = Math.max(Date.now(), (x.mtime || 0) + 1); } });
        });
        paintVocab();
        showToast(t("col.del.done"), t("col.del.undo"), function () {
          goalsWrite(function (gs) {
            gs.forEach(function (x) { if (x.id === g.id) { delete x.x; x.mtime = Math.max(Date.now(), (x.mtime || 0) + 1); } });
          });
          paintVocab();
        });
      }, "danger"));
      ul.appendChild(li);
    });
    body.appendChild(ul);
    if (goals.length >= V.GOALS_MAX) return;
    var add = document.createElement("div");
    add.className = "vc-add vc-goal-add";
    var al = document.createElement("div");
    al.className = "col-lab";
    al.textContent = t("gl.add");
    add.appendChild(al);
    var sel = document.createElement("select");
    sel.id = "gl-act";
    sel.setAttribute("aria-label", t("gl.act"));
    var mkGroup = function (label, items) {
      if (!items.length) return;
      var og = document.createElement("optgroup");
      og.label = label;
      items.forEach(function (it) {
        var o = document.createElement("option");
        o.value = it[0];
        o.textContent = it[1];
        og.appendChild(o);
      });
      sel.appendChild(og);
    };
    mkGroup(t("grp.own"), CUST_ACTS.filter(function (a) { return !a.hid; })
      .map(function (a) { return [a.id, actText(a)]; }));
    mkGroup(t("ins.basics"), HABITS.filter(function (h) { return h.grp === "hab" && !h.hid; })
      .map(function (h) { return [h.f, habText(h, "yes")]; }));
    mkGroup(t("grp.rit"), HABITS.filter(function (h) { return h.grp === "rit" && !h.hid; })
      .map(function (h) { return [h.f, habText(h, "yes")]; }));
    add.appendChild(sel);
    var row = document.createElement("div");
    row.className = "addrow vc-goal-row";
    var n = document.createElement("input");
    n.type = "number";
    n.id = "gl-n";
    n.min = "1"; n.max = "31"; n.value = "3";
    n.setAttribute("aria-label", t("gl.times"));
    var per = document.createElement("select");
    per.id = "gl-per";
    per.setAttribute("aria-label", t("gl.period"));
    [["w", "gl.week"], ["m", "gl.month"]].forEach(function (p) {
      var o = document.createElement("option");
      o.value = p[0]; o.textContent = t(p[1]);
      per.appendChild(o);
    });
    var times = document.createElement("span");
    times.className = "hint";
    times.textContent = t("gl.timesPer");
    var ab = document.createElement("button");
    ab.type = "button";
    ab.className = "prim";
    ab.id = "gl-add";
    ab.textContent = t("l2.add");
    ab.addEventListener("click", function () {
      var g = V.normGoal({ id: "g-" + uid(), act: sel.value, n: parseInt(n.value, 10) || 1,
                           per: per.value, mtime: Date.now() });
      if (!g) return;
      goalsWrite(function (gs) { gs.push(g); });
      paintVocab();
      transientNote(t("vc.added"));
    });
    row.appendChild(n); row.appendChild(times); row.appendChild(per); row.appendChild(ab);
    add.appendChild(row);
    body.appendChild(add);
  }

  // ---------- PDF export ----------
  // jsPDF is VENDORED LOCALLY (vendor/jspdf.umd.min.js) — never a
  // CDN. Optional: if the file is absent, export degrades to a
  // toast error; nothing else breaks.
  var pdfLibLoading = false, pdfLibPending = [];
  function loadPdfLib(done) {
    if (window.jspdf && window.jspdf.jsPDF) { done(); return; }
    pdfLibPending.push(done);            // #2: clicks queue, never vanish
    if (pdfLibLoading) return;
    pdfLibLoading = true;
    // #13: currentScript is null inside a click handler — MV is
    // captured ONCE at boot now (was always "" before)
    var MV = SCRIPT_V;
    var cands = ["../vendor/jspdf.umd.min.js"];   // mood/ has no vendor/ — verified in repo
    var i = 0;
    (function next() {
      if (i >= cands.length) {
        pdfLibLoading = false;
        pdfLibPending.splice(0);   // queued requests die — error toast is the receipt
        transientNote(t("exp.err"));
        return;
      }
      var s = document.createElement("script");
      s.src = cands[i++] + (MV ? "?v=" + MV : "");
      s.onload = function () {
        pdfLibLoading = false;
        pdfLibPending.splice(0).forEach(function (cb) { cb(); });
      };
      s.onerror = function () { s.remove(); next(); };
      document.head.appendChild(s);
    })();
  }

  // #11: jsPDF's built-in fonts are WinAnsi-only — Greek needs a
  // vendored Unicode TTF (same vendor/ rule, no CDN). Lazy-loaded
  // ONLY for el; missing file = toast + Latin fallback.
  var FONT_FILE = "../vendor/NotoSans-Regular.ttf";
  function loadPdfFont(done) {
    if (LANG !== "el" || window.__moodPdfFont) { done(); return; }
    fetch(FONT_FILE + (SCRIPT_V ? "?v=" + SCRIPT_V : ""))
      .then(function (r) { if (!r.ok) throw 0; return r.blob(); })
      .then(function (b) {
        return new Promise(function (res) {
          var fr = new FileReader();
          fr.onload = function () { res(fr.result.split(",")[1]); };
          fr.readAsDataURL(b);
        });
      })
      .then(function (b64) {
        window.__moodPdfFont = { file: "NotoSans-Regular.ttf", b64: b64 };
        done();
      })
      .catch(function () { transientNote(t("exp.font.err")); done(); });
  }

  // B1: NFC funnel for the PDF. Mobile keyboards often emit
  // DECOMPOSED Greek (NFD: base letter + separate combining
  // accent); jsPDF draws the combining mark as its own glyph →
  // the "garbled symbols" on SOME elements (mostly user-TYPED
  // labels — UI strings from source are already NFC).
  function pdfClean(s) {
    if (Array.isArray(s)) return s.map(pdfClean);
    return String(s).normalize("NFC");
  }

  // "Open in Spreadsheet" (Bible BR-S1): a new sheet in the orOS
  // Spreadsheet with the entries the PDF covers (range + filters),
  // the same columns as the mood.csv of the .orosmood file, newest
  // first. Plain text cells only; the receiver adds no SUM here.
  var SHEET_ROWS = 499;   // + heading = the Spreadsheet's 500
  function sheetBridge() {
    try {
      var p = window.parent;
      return p && p !== window && typeof p.__orosOpenAt === "function" ? p : null;
    } catch (e) { return null; }
  }
  function openInSheet() {
    var p = sheetBridge();
    if (!p) return;
    var es = entriesInRange();
    if (filtersActive()) es = applyFilters(es);
    es = es.slice().sort(function (a, b) { return b.ts - a.ts || (a.id < b.id ? -1 : 1); });
    if (!es.length) { transientNote(t("ins.ctx.none")); return; }
    if (es.length > SHEET_ROWS) {
      transientNote(t("exp.sheetCap").replace("{n}", SHEET_ROWS));
      es = es.slice(0, SHEET_ROWS);
    }
    var cv = function (col, id) { return colLabel(colValById(col, id)); };
    var rows = [t("exp.sheetHead").split("|")].concat(es.map(function (e) {
      var d = new Date(e.ts);
      var feel = (e.emotions || []).map(function (m) { return emoLabel(m.k) + " " + m.i + "/5"; }).join("; ");
      var habs = [];
      HABITS.forEach(function (h) { if (e[h.f] === "yes" || e[h.f] === "no") habs.push(habLbl(h, e[h.f])); });
      var acts = (e.acts || []).map(function (id) { var a = actById(id); return a ? a.label : id; }).join("; ");
      return [dayKey(e.ts), pad(d.getHours()) + ":" + pad(d.getMinutes()), feel, cv("loc", e.loc),
              cv("person", e.person), cv("trig", e.trig), habs.join("; "), acts, e.note || ""];
    }));
    p.__orosOpenAt("spreadsheet", { newSheet: { name: t("app.title") + " " + dayKey(Date.now()), rows: rows } });
  }

  function exportPdf() {
    loadPdfLib(function () {
      loadPdfFont(function () {
      var JS = window.jspdf.jsPDF;
      var doc = new JS({ unit: "pt", format: "a4" });
      // B1: every doc.text call funnels through pdfClean
      var docText = doc.text.bind(doc);
      doc.text = function (s, x, y, opts) {
        return docText(pdfClean(s), x, y, opts);
      };
      var FONT = window.__moodPdfFont ? "NotoSans" : "helvetica";
      if (window.__moodPdfFont) {
        doc.addFileToVFS(window.__moodPdfFont.file, window.__moodPdfFont.b64);
        doc.addFont(window.__moodPdfFont.file, "NotoSans", "normal");
        doc.addFont(window.__moodPdfFont.file, "NotoSans", "bold");
      }
      doc.setFont(FONT, "normal");
      var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
      var M = 48, y = M, page = 1;

      var footer = function () {
        doc.setFontSize(8); doc.setTextColor(150);
        doc.text("orOS Mood — " + t("app.title"), M, H - 28);
        doc.text("Made with orOS | useoros.online", W / 2, H - 28, { align: "center" });
        doc.text(String(page), W - M, H - 28, { align: "right" });
      };
      var newPage = function () { footer(); doc.addPage(); page++; y = M; };
      var need = function (h) { if (y + h > H - 44) newPage(); };
      var section = function (txt) {
        need(36);
        doc.setFontSize(12); doc.setTextColor(109, 74, 255);
        doc.text(txt, M, y); y += 8;
        doc.setDrawColor(109, 74, 255); doc.setLineWidth(0.8);
        doc.line(M, y, W - M, y); y += 16;
      };
      var kv = function (lab, val) {   // two-column stat row
        need(17);
        doc.setFontSize(10); doc.setTextColor(25);
        doc.text(lab, M + 8, y);
        doc.setTextColor(115);
        doc.text(val, W - M - 8, y, { align: "right" });
        y += 15;
      };
      var line = function (txt, indent) {
        txt = pdfClean(txt);   // measure the SAME string the draw funnel sees
        doc.setFontSize(10); doc.setTextColor(25);
        var w = doc.splitTextToSize(txt, W - M * 2 - (indent || 0));
        need(w.length * 13 + 4);
        doc.text(w, M + (indent || 0), y);
        y += w.length * 13 + 4;
      };

      var es = entriesInRange();
      var active = filtersActive();
      var fes = active ? applyFilters(es) : es;
      var rangeLbl = insRange === 7 ? t("ins.r7") :
        insRange === 30 ? t("ins.r30") : t("ins.rall");

      // header block
      doc.setFontSize(20); doc.setTextColor(20);
      doc.text(t("app.title") + " — " + t("insights"), M, M + 6);
      doc.setFontSize(9); doc.setTextColor(130);
      y = M + 28;
      doc.text(rangeLbl + " · " +
        new Date().toLocaleString(loc()), M, y);
      y += 14;
      if (active) {
        doc.text(t("ins.showing")
          .replace("{x}", fes.length).replace("{y}", es.length), M, y);
        y += 14;
      }
      y += 8;

      // 1. overview
      section(t("exp.summary"));
      var si = streakInfo(es);
      kv(t("exp.row.entries"), String(fes.length));
      kv(t("exp.row.days"), String(si.logged));
      kv(t("ins.streak.val").replace("{n}", si.streak),
        t("ins.logged").replace("{n}", si.logged));
      y += 4;

      // 2. patterns (auto observations)
      var tr = buildTrends(fes, es);
      if (tr.length) {
        section(t("ins.trends.title"));
        tr.forEach(function (s) { line("• " + s, 8); });
        y += 4;
      }

      // 3. distribution — n · share% · avg intensity
      section(t("ins.dist.title"));
      var dst = emoStats(fes);
      var rowsE = EMOTIONS.map(function (em) {
        var c = dst.n[em.k] || 0;
        return { em: em, c: c, avg: c ? dst.sums[em.k] / c : 0 };
      }).filter(function (r) { return r.c > 0; })
        .sort(function (a, b) { return b.c - a.c; });
      if (rowsE.length) {
        rowsE.forEach(function (r) {
          var pct = Math.round(r.c / fes.length * 100);
          doc.setFontSize(10); doc.setTextColor(20);
          doc.setFont(FONT, "bold");
          need(15);
          doc.text(r.em.label, M + 8, y);
          doc.setFont(FONT, "normal");
          doc.setTextColor(115);
          doc.text(r.c + "  ·  " + pct + "%  ·  " +
            t("ins.avg").replace("{n}", fix1(r.avg)),
            W - M - 8, y, { align: "right" });
          y += 15;
        });
        y += 4;
      } else line(t("ins.ctx.none"));

      // 4. habits + rituals adherence (two grouped sections)
      var habGrpTitle = { hab: t("ins.habits.title"), rit: t("grp.rit"), own: t("grp.own") };
      ["hab", "rit"].forEach(function (grp) {
        var anyIn = false;
        HABITS.forEach(function (h) {
          if (h.grp !== grp) return;
          // MD-3b: per-day, same as renderHabits — the PDF must
          // agree with the on-screen numbers.
          var mks = {};
          fes.forEach(function (e) {
            if (e[h.f] !== "yes" && e[h.f] !== "no") return;
            var dk = dayKey(e.ts);
            if (e[h.f] === "yes" || mks[dk] !== "yes") mks[dk] = e[h.f];
          });
          var yy = 0, nn = 0;
          Object.keys(mks).forEach(function (dk) {
            if (mks[dk] === "yes") yy++; else nn++;
          });
          if (!yy && !nn) return;
          if (!anyIn) { section(habGrpTitle[grp]); anyIn = true; }
          var tot = yy + nn;
          kv(habLbl(h, "yes"), t("ins.hab.days")
            .replace("{y}", yy).replace("{n}", tot) +
            "  ·  " + Math.round(yy / tot * 100) + "%");
        });
        if (!anyIn) line(t("ins.ctx.none"));   // #4: same fallback, both groups
      });
      // wave 30: own activities (days marked over logged days)
      var ownDays = {};
      fes.forEach(function (e) { ownDays[dayKey(e.ts)] = 1; });
      var ownN = Object.keys(ownDays).length, ownAny = false;
      CUST_ACTS.forEach(function (a) {
        var yy = ownActDays(fes, a.id);
        if (!yy || !ownN) return;
        if (!ownAny) { section(habGrpTitle.own); ownAny = true; }
        kv(a.label, t("ins.hab.days").replace("{y}", yy).replace("{n}", ownN) +
          "  ·  " + Math.round(yy / ownN * 100) + "%");
      });
      // wave 30: goals
      var pdfGoals = V.liveGoals(state.goals);
      if (pdfGoals.length) {
        section(t("gl.title"));
        pdfGoals.forEach(function (g) {
          var gp = V.goalProgress(state.entries, g, Date.now(), 0);
          kv(goalTitle(g, true),
            t("gl.prog").replace("{d}", gp.done).replace("{n}", gp.n));
        });
      }
      y += 4;
      y += 4;

      // 5. weekly momentum
      var wkNow = Date.now();
      var psOf = function (set) {
        var n = set.filter(function (e) {
          return (e.emotions || []).some(function (m) {
            return POS_EMOS.indexOf(m.k) >= 0;
          });
        }).length;
        return set.length ? Math.round(n / set.length * 100) : null;
      };
      var pa = psOf(es.filter(function (e) { return e.ts >= wkNow - 7 * 86400000; }));
      if (pa !== null) {
        section(t("ins.mom.title"));
        kv(t("mom.this"), pa + "%");
        var pb = psOf(es.filter(function (e) {
          return e.ts >= wkNow - 14 * 86400000 && e.ts < wkNow - 7 * 86400000;
        }));
        if (pb !== null) kv(t("mom.prev"), pb + "%");
        y += 4;
      }

      // 6. by weekday
      if (fes.length >= 7) {
        var baseSt = emoStats(fes);
        var bks = [[], [], [], [], [], [], []];
        fes.forEach(function (e) { bks[new Date(e.ts).getDay()].push(e); });
        var wrows = [];
        bks.forEach(function (bk, wd) {
          if (bk.length < 3) return;
          var bst = emoStats(bk);
          var best = null, bd = 0;
          EMOTIONS.forEach(function (em) {
            var cn = bst.n[em.k] || 0;
            if (cn < 2) return;
            var dd = Math.round((cn / bk.length -
              (baseSt.n[em.k] || 0) / fes.length) * 100);
            if (dd > bd && dd >= 10) { bd = dd; best = { k: em.k, d: dd }; }
          });
          if (best) wrows.push({ wd: wd, k: best.k, d: best.d });
        });
        if (wrows.length) {
          section(t("ins.dow.title"));
          wrows.sort(function (a, b) {
            return ((a.wd + 6) % 7) - ((b.wd + 6) % 7);
          });
          wrows.forEach(function (r) {
            var wdName = new Date(2024, 0, 1 + ((r.wd + 6) % 7))
              .toLocaleDateString(loc(),
                { weekday: "long" });
            kv(wdName, emoLabel(r.k) + "  ·  +" + r.d + "pt");
          });
          y += 4;
        }
      }

      // 7. breakdowns
      [["loc", "ins.loc.title"], ["person", "ins.per.title"]].forEach(function (p) {
        var cnts = {}, ord = [];
        fes.forEach(function (e) {
          var id = e[p[0]];
          if (!id || !colValById(p[0], id)) return;
          if (cnts[id] === undefined) ord.push(id);
          cnts[id] = (cnts[id] || 0) + 1;
        });
        if (!ord.length) return;
        section(t(p[1]));
        ord.sort(function (a, b) { return cnts[b] - cnts[a]; });
        ord.slice(0, 8).forEach(function (id) {
          var v = colValById(p[0], id);
          var pct = Math.round(cnts[id] / fes.length * 100);
          kv(colLabel(v), cnts[id] + "  ·  " + pct + "%");
        });
        y += 4;
      });

      footer();
      // Native save via orosDialog; jsPDF's own doc.save() (which
      // does an ad-hoc anchor-download) is retired — same rule
      // as every other orOS app (see cycle.js).
      var fname = "oros-mood-" + dayKey(Date.now()) + ".pdf";
      var done = function () { transientNote(t("exp.done")); };
      var pdfBlob = doc.output("blob");
      var dlg = dialogHost();
      if (dlg && typeof dlg.saveFile === "function") {
        dlg.saveFile({
          blob: pdfBlob,
          filename: fname,
          mime: "application/pdf",
          types: [{ description: "PDF",
                    accept: { "application/pdf": [".pdf"] } }]
        }).then(function (r) { if (r && r.ok) done(); });
      } else {
        // Standalone fallback — classic download (no shell present).
        var url = URL.createObjectURL(pdfBlob);
        var a = document.createElement("a");
        a.href = url;
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        done();
      }
      });
    });
  }

  function renderInsights() {
    var host = $("insights");
    if (!host) return;
    host.innerHTML = "";

    // ---- top row: range selector + Filters toggle ----
    var top = document.createElement("div");
    top.className = "ins-top";
    var rs = document.createElement("div");
    rs.className = "ins-ranges";
    [[7, "ins.r7"], [30, "ins.r30"], [0, "ins.rall"]].forEach(function (r) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (insRange === r[0] ? " on" : "");
      b.textContent = t(r[1]);
      b.addEventListener("click", function () {
        insRange = r[0];
        renderInsights();
      });
      rs.appendChild(b);
    });
    top.appendChild(rs);
    var fb = document.createElement("button");
    fb.type = "button";
    fb.className = "chip" + (insFiltersOpen ? " on" : "");
    fb.textContent = t("ins.filters");
    fb.setAttribute("aria-pressed", insFiltersOpen ? "true" : "false");
    fb.addEventListener("click", function () {
      insFiltersOpen = !insFiltersOpen;
      renderInsights();
    });
    top.appendChild(fb);
    var pdf = document.createElement("button");
    pdf.type = "button";
    pdf.className = "chip ghost";
    pdf.textContent = t("exp.btn");
    pdf.addEventListener("click", exportPdf);
    top.appendChild(pdf);
    // "Open in Spreadsheet" (Bible BR-S1): only inside orOS
    if (sheetBridge()) {
      var sb = document.createElement("button");
      sb.type = "button";
      sb.className = "chip ghost";
      sb.textContent = t("exp.sheet");
      sb.addEventListener("click", openInSheet);
      top.appendChild(sb);
    }
    var imp = document.createElement("button");
    imp.type = "button";
    imp.className = "chip ghost";
    imp.id = "imp-btn";
    imp.textContent = t("imp.btn");
    imp.addEventListener("click", startImport);
    top.appendChild(imp);
    // .orosmood (OBF-4e): save every record as one orOS file, open one
    // (adds what is missing) or its unzipped folder
    if (recFile) {
      [["oros-save", "oros.save", "save", function () { recFile.save(); }],
       ["oros-open", "oros.open", "open", function () { recFile.open(); }],
       ["oros-folder", "oros.folder", "folder", function () { recFile.openFolder(); }]].forEach(function (b) {
        var ob = document.createElement("button");
        ob.type = "button";
        ob.className = "chip ghost";
        ob.id = b[0];
        ob.textContent = t(b[1]);
        ob.title = recFile.text(b[2]);
        ob.addEventListener("click", b[3]);
        top.appendChild(ob);
      });
    }
    host.appendChild(top);

    var es = entriesInRange();
    if (!es.length) {
      var em = document.createElement("div");
      em.id = "empty-note";
      em.textContent = t("ins.empty");
      host.appendChild(em);
      appendResetLink(host);
      return;
    }

    // ---- filter panel (open state only; view state, never persisted) ----
    if (insFiltersOpen) buildFilterPanel(host);

    var active = filtersActive();
    var fes = active ? applyFilters(es) : es;

    // status line: only when a filter cuts the set
    if (active) {
      var fl = document.createElement("div");
      fl.className = "fline dim";
      fl.textContent = t("ins.showing")
        .replace("{x}", fes.length).replace("{y}", es.length);
      host.appendChild(fl);
    }

    renderRecap(host, es);
    renderGoals(host);                       // wave 30 (time-based, unfiltered)

    // ---- TRENDS: auto-generated observations ----
    // Computed on the filtered set against the range baseline —
    // filters and trends cooperate naturally.
    var tr = buildTrends(fes, es);
    if (tr.length) {
      var tt = document.createElement("h2");
      tt.className = "sec-title";
      tt.textContent = t("ins.trends.title");
      host.appendChild(tt);
      var tl = document.createElement("div");
      tl.className = "trlist";
      tr.forEach(function (s) {
        var li = document.createElement("div");
        li.className = "tr-line";
        li.textContent = s;
        tl.appendChild(li);
      });
      host.appendChild(tl);
    }

    // ---- distribution (+ vs-overall deltas when filtered) ----
    var d1 = document.createElement("h2");
    d1.className = "sec-title";
    d1.textContent = t("ins.dist.title");
    host.appendChild(d1);
    var dist = document.createElement("div");
    renderDistribution(dist, fes, active ? es : null);
    if (!dist.childNodes.length) dist.textContent = t("ins.ctx.none");
    host.appendChild(dist);

    // ---- streak + logged days (UNFILTERED — filters don't touch it) ----
    var si = streakInfo(es);
    var stk = document.createElement("div");
    stk.className = "ins-streak";
    stk.innerHTML =
      '<span class="ins-big">' + si.streak + "</span> " +
      esc(t("ins.streak.val").replace("{n}", "")) +
      ' · <span class="dim">' +
      esc(t("ins.logged").replace("{n}", si.logged)) + "</span>";
    host.appendChild(stk);

    // ---- weekly momentum (time-based, ignores filters) ----
    renderMomentum(host, es);

    // ---- intensity trend (filtered) ----
    renderIntensity(host, fes);

    // ---- habits (filtered) ----
    var d2 = document.createElement("h2");
    d2.className = "sec-title";
    d2.textContent = t("ins.habits.title");
    host.appendChild(d2);
    var hb = document.createElement("div");
    if (fes.length) renderHabits(hb, fes, "hab");
    if (!hb.childNodes.length) hb.textContent = t("ins.ctx.none");
    host.appendChild(hb);

    // ---- rituals (filtered) ----
    var d4 = document.createElement("h2");
    d4.className = "sec-title";
    d4.textContent = t("grp.rit");
    host.appendChild(d4);
    var rb = document.createElement("div");
    if (fes.length) renderHabits(rb, fes, "rit");
    if (!rb.childNodes.length) rb.textContent = t("ins.ctx.none");
    host.appendChild(rb);

    // ---- own activities (wave 30, filtered) ----
    if (CUST_ACTS.length) {
      var d5 = document.createElement("h2");
      d5.className = "sec-title";
      d5.textContent = t("grp.own");
      host.appendChild(d5);
      var ob = document.createElement("div");
      if (fes.length) renderHabits(ob, fes, "own");
      if (!ob.childNodes.length) ob.textContent = t("ins.ctx.none");
      host.appendChild(ob);
    }

    // ---- calendar (ignores range AND filters) ----
    var d3 = document.createElement("h2");
    d3.className = "sec-title";
    d3.textContent = t("ins.cal.title");
    host.appendChild(d3);
    renderCalendar(host, state.entries);

    // ---- year in pixels (wave 30; ignores range AND filters) ----
    renderPixels(host);

    // ---- breakdowns (filtered) ----
    renderBreakdown(host, fes, "loc", "ins.loc.title");
    renderBreakdown(host, fes, "person", "ins.per.title");

    // ---- weekday patterns (filtered — respects both) ----
    renderWeekday(host, fes);

    // factory reset — far corner, away from accidental thumbs
    appendResetLink(host);
  }

  // ---------- 3c. Import from another app (mood/import.js) ----------
  // Daylio (CSV or .daylio backup), Bearable, eMoods or any CSV with a
  // date and a mood. Flow: pick a file → read + detect → preview (how
  // each mood name maps, new activities, dates) → ONE write + one sync
  // mark → toast with Undo. Imported entries are new entries with stable
  // ids ("imp-…"): a second import of the same file adds only what is
  // new, and nothing the user already has is ever changed. File content
  // is shown with textContent only.
  STRINGS.en["imp.btn"]      = "Import…";
  STRINGS.en["imp.title"]    = "Import from another app";
  STRINGS.en["imp.bad"]      = "This file couldn't be read. Use a Daylio CSV or backup, a Bearable or eMoods CSV, or a CSV with a date and a mood column.";
  STRINGS.en["imp.big"]      = "This file is too large to import.";
  STRINGS.en["imp.src.daylio"]    = "Daylio (CSV)";
  STRINGS.en["imp.src.daylio-bk"] = "Daylio (backup)";
  STRINGS.en["imp.src.bearable"]  = "Bearable";
  STRINGS.en["imp.src.emoods"]    = "eMoods";
  STRINGS.en["imp.src.generic"]   = "CSV file";
  STRINGS.en["imp.count"]    = "Entries: {n}";
  STRINGS.en["imp.map"]      = "How moods map";
  STRINGS.en["imp.map.hint"] = "Mood records feelings, not a score: each mood becomes one feeling with a strength. Change any of them here.";
  STRINGS.en["imp.map.em"]   = "Feelings come from the depression, elevation, irritability and anxiety ratings (0–3); a day with all four at 0 becomes Calm. Sleep and the other columns go into the note.";
  STRINGS.en["imp.skip"]     = "Skip";
  STRINGS.en["imp.unknown"]  = "Unknown mood: pick a feeling or it will be skipped.";
  STRINGS.en["imp.hab"]      = "Marked in your habits: {list}";
  STRINGS.en["imp.newAct"]   = "New activities: {list}";
  STRINGS.en["imp.newEmo"]   = "New feelings: {list}";
  STRINGS.en["imp.have"]     = "Already in Mood (left as they are): {n}";
  STRINGS.en["imp.skipped"]  = "Rows skipped (no date or no mood): {n}";
  STRINGS.en["imp.capped"]   = "Only the latest {max} entries are imported; {n} older ones are left out.";
  STRINGS.en["imp.nothing"]  = "Nothing new to import.";
  STRINGS.en["imp.go"]       = "Import {n}";
  STRINGS.en["imp.cancel"]   = "Cancel";
  STRINGS.en["imp.done"]     = "Entries imported: {n}";
  STRINGS.en["imp.undo"]     = "Undo";
  STRINGS.en["imp.undone"]   = "Import undone";
  STRINGS.en["imp.full"]     = "Not enough storage on this device for this import. Nothing was changed.";
  STRINGS.en["imp.w.dep"]    = "Depressed";
  STRINGS.en["imp.w.ele"]    = "Elevated";
  STRINGS.en["imp.w.irr"]    = "Irritable";
  STRINGS.en["imp.w.anx"]    = "Anxiety";
  STRINGS.en["imp.w.slp"]    = "Sleep";
  STRINGS.en["imp.w.more"]   = "More activities";
  STRINGS.el["imp.btn"]      = "Εισαγωγή…";
  STRINGS.el["imp.title"]    = "Εισαγωγή από άλλη εφαρμογή";
  STRINGS.el["imp.bad"]      = "Δεν ήταν δυνατό να διαβαστεί αυτό το αρχείο. Χρησιμοποίησε CSV ή αντίγραφο ασφαλείας του Daylio, CSV του Bearable ή του eMoods, ή ένα CSV με στήλη ημερομηνίας και διάθεσης.";
  STRINGS.el["imp.big"]      = "Το αρχείο είναι πολύ μεγάλο για εισαγωγή.";
  STRINGS.el["imp.src.daylio"]    = "Daylio (CSV)";
  STRINGS.el["imp.src.daylio-bk"] = "Daylio (αντίγραφο ασφαλείας)";
  STRINGS.el["imp.src.bearable"]  = "Bearable";
  STRINGS.el["imp.src.emoods"]    = "eMoods";
  STRINGS.el["imp.src.generic"]   = "Αρχείο CSV";
  STRINGS.el["imp.count"]    = "Καταχωρήσεις: {n}";
  STRINGS.el["imp.map"]      = "Πώς μεταφέρονται οι διαθέσεις";
  STRINGS.el["imp.map.hint"] = "Το Mood καταγράφει συναισθήματα, όχι βαθμό: κάθε διάθεση γίνεται ένα συναίσθημα με ένταση. Μπορείς να αλλάξεις οποιαδήποτε εδώ.";
  STRINGS.el["imp.map.em"]   = "Τα συναισθήματα βγαίνουν από τις βαθμολογίες κατάθλιψης, ανεβασμένης διάθεσης, ευερεθιστότητας και άγχους (0–3)· μια μέρα με όλες στο 0 γίνεται Ήρεμος. Ο ύπνος και οι υπόλοιπες στήλες μπαίνουν στη σημείωση.";
  STRINGS.el["imp.skip"]     = "Παράλειψη";
  STRINGS.el["imp.unknown"]  = "Άγνωστη διάθεση: διάλεξε συναίσθημα, αλλιώς θα παραλειφθεί.";
  STRINGS.el["imp.hab"]      = "Σημειώνονται στις συνήθειές σου: {list}";
  STRINGS.el["imp.newAct"]   = "Νέες δραστηριότητες: {list}";
  STRINGS.el["imp.newEmo"]   = "Νέα συναισθήματα: {list}";
  STRINGS.el["imp.have"]     = "Υπάρχουν ήδη στο Mood (μένουν όπως είναι): {n}";
  STRINGS.el["imp.skipped"]  = "Γραμμές που παραλείπονται (χωρίς ημερομηνία ή διάθεση): {n}";
  STRINGS.el["imp.capped"]   = "Εισάγονται μόνο οι {max} πιο πρόσφατες καταχωρήσεις· {n} παλαιότερες μένουν έξω.";
  STRINGS.el["imp.nothing"]  = "Δεν υπάρχει κάτι νέο για εισαγωγή.";
  STRINGS.el["imp.go"]       = "Εισαγωγή {n}";
  STRINGS.el["imp.cancel"]   = "Άκυρο";
  STRINGS.el["imp.done"]     = "Καταχωρήσεις που εισήχθησαν: {n}";
  STRINGS.el["imp.undo"]     = "Αναίρεση";
  STRINGS.el["imp.undone"]   = "Η εισαγωγή αναιρέθηκε";
  STRINGS.el["imp.full"]     = "Δεν υπάρχει αρκετός χώρος στη συσκευή για αυτή την εισαγωγή. Δεν άλλαξε τίποτα.";
  STRINGS.el["imp.w.dep"]    = "Κατάθλιψη";
  STRINGS.el["imp.w.ele"]    = "Ανεβασμένη διάθεση";
  STRINGS.el["imp.w.irr"]    = "Ευερεθιστότητα";
  STRINGS.el["imp.w.anx"]    = "Άγχος";
  STRINGS.el["imp.w.slp"]    = "Ύπνος";
  STRINGS.el["imp.w.more"]   = "Άλλες δραστηριότητες";
  if (window.orosI18n) window.orosI18n.table(STRINGS, "mood", LANG);

  var IMP_ACCEPT = ".csv,.tsv,.txt,.daylio,.zip,.json,text/csv,text/plain,application/zip,application/octet-stream";
  var IMP_LIST_MAX = 24;                  // names shown per preview line

  function impWords() {
    return { depressed: t("imp.w.dep"), elevated: t("imp.w.ele"), irritable: t("imp.w.irr"),
             anxiety: t("imp.w.anx"), sleep: t("imp.w.slp"), more: t("imp.w.more") };
  }
  // What Mood knows now, for prepare(): feelings (current labels plus
  // the English and Greek names of the built-ins), own activities and
  // both sides of every built-in pair in both languages.
  function impCtx(steps) {
    var emos = [], habits = [];
    EMOTIONS.forEach(function (x) { emos.push({ k: x.k, label: x.label }); });
    BUILTIN_EMOS.forEach(function (b) {
      emos.push({ k: b.k, label: STRINGS.en[b.i18n] });
      emos.push({ k: b.k, label: STRINGS.el[b.i18n] });
      if (LANG !== "en" && LANG !== "el") emos.push({ k: b.k, label: t(b.i18n) });
    });
    HABITS.forEach(function (h) {
      habits.push({ f: h.f, yes: STRINGS.en[h.yes], no: STRINGS.en[h.no] });
      habits.push({ f: h.f, yes: STRINGS.el[h.yes], no: STRINGS.el[h.no] });
      if (LANG !== "en" && LANG !== "el") habits.push({ f: h.f, yes: t(h.yes), no: t(h.no) });
      habits.push({ f: h.f, yes: habLbl(h, "yes"), no: habLbl(h, "no") });
    });
    return {
      steps: steps, emos: emos, habits: habits,
      acts: CUST_ACTS.map(function (a) { return { id: a.id, label: a.label }; }),
      habitFields: BUILTIN_HABITS.map(function (h) { return h.f; }),
      colors: V.CUSTOM_COLORS,
      nCustomEmo: EMOTIONS.filter(function (x) { return !x.builtin; }).length,
      lab: impWords()
    };
  }

  function localPickFile(accept) {
    return new Promise(function (resolve) {
      var i = document.createElement("input");
      i.type = "file"; i.accept = accept;
      i.addEventListener("change", function () { resolve(i.files && i.files[0] ? i.files[0] : null); });
      i.click();
    });
  }
  function startImport() {
    var dlg = dialogHost();
    var pick = dlg && typeof dlg.openFile === "function" ? dlg.openFile(IMP_ACCEPT) : localPickFile(IMP_ACCEPT);
    Promise.resolve(pick).then(function (file) {
      if (file) importFile(file);            // cancel = silent exit
    }).catch(function () {});
  }
  // Also the entry point for tests / the harness: a File (or Blob with
  // a name). Resolves once the preview is open (or the error shown).
  function importFile(file) {
    var I = window.OrosMoodImport, KIT = window.OrosImportKit;
    if (!I || !KIT) { showToast(t("imp.bad")); return Promise.resolve(); }
    return KIT.readFile(file, I.MAX_FILE).then(function (f) {
      return I.read(f.name, f.bytes, impWords()).then(function (parsed) {
        openImportPreview(parsed, f.name);
      });
    }).catch(function (err) {
      showToast(err && err.message === "toobig" ? t("imp.big") : t("imp.bad"));
    });
  }

  function fmtImpDay(ts) {
    return new Date(ts).toLocaleDateString(loc(),
      { day: "numeric", month: "short", year: "numeric" });
  }
  function nameList(arr) {
    var out = arr.slice(0, IMP_LIST_MAX).join(", ");
    return arr.length > IMP_LIST_MAX ? out + ", … (+" + (arr.length - IMP_LIST_MAX) + ")" : out;
  }
  function stepText(g) {
    var s = window.OrosMoodImport.STEPS[g];
    return s ? emoLabel(s.k) + " · " + s.i + "/5" : t("imp.skip");
  }

  var impDlg = null;
  function openImportPreview(parsed, fileName) {
    var I = window.OrosMoodImport;
    if (impDlg) { try { impDlg.close(); } catch (e) {} }
    var steps = {};
    parsed.moods.forEach(function (m) { steps[m.label] = m.g || 0; });
    var prep = null, fresh = 0;

    var d = document.createElement("dialog");
    d.className = "rst-dlg imp-dlg";
    d.setAttribute("aria-label", t("imp.title"));
    d.addEventListener("close", function () { d.remove(); if (impDlg === d) impDlg = null; });
    impDlg = d;
    var h = document.createElement("h3");
    h.textContent = t("imp.title");
    d.appendChild(h);
    var body = document.createElement("div");
    body.className = "imp-body";
    d.appendChild(body);

    var src = document.createElement("p");
    src.className = "imp-src";
    src.textContent = t("imp.src." + parsed.source) + " · " + KITclean(fileName);
    body.appendChild(src);
    var sum = document.createElement("p");
    sum.className = "imp-sum";
    body.appendChild(sum);

    if (parsed.moods.length || parsed.source === "emoods") {
      var mh = document.createElement("div");
      mh.className = "col-lab";
      mh.textContent = t("imp.map");
      body.appendChild(mh);
      var hint = document.createElement("p");
      hint.className = "imp-hint";
      hint.textContent = parsed.moods.length ? t("imp.map.hint") : t("imp.map.em");
      body.appendChild(hint);
    }
    if (parsed.moods.length) {
      var ul = document.createElement("ul");
      ul.className = "imp-map";
      parsed.moods.forEach(function (m, idx) {
        var li = document.createElement("li");
        var lab = document.createElement("label");
        lab.className = "imp-mood";
        lab.setAttribute("for", "imp-step-" + idx);
        lab.textContent = m.label + " (" + m.n + ")";
        li.appendChild(lab);
        var sel = document.createElement("select");
        sel.id = "imp-step-" + idx;
        [1, 2, 3, 4, 5, 0].forEach(function (g) {
          var o = document.createElement("option");
          o.value = String(g);
          o.textContent = stepText(g);
          sel.appendChild(o);
        });
        sel.value = String(steps[m.label] || 0);
        sel.addEventListener("change", function () {
          steps[m.label] = +sel.value;
          li.classList.toggle("unk", !steps[m.label]);
          recompute();
        });
        li.appendChild(sel);
        if (!m.g) {
          li.classList.add("unk");
          var u = document.createElement("div");
          u.className = "imp-unk";
          u.textContent = t("imp.unknown");
          li.appendChild(u);
        }
        ul.appendChild(li);
      });
      body.appendChild(ul);
    }
    var notes = document.createElement("div");
    notes.className = "imp-notes";
    body.appendChild(notes);

    var foot = document.createElement("div");
    foot.className = "imp-foot";
    var cb = document.createElement("button");
    cb.type = "button";
    cb.className = "ghost";
    cb.textContent = t("imp.cancel");
    cb.addEventListener("click", function () { d.close(); });
    var go = document.createElement("button");
    go.type = "button";
    go.className = "prim";
    go.id = "imp-go";
    go.addEventListener("click", function () {
      if (!prep || !fresh) return;
      d.close();
      commitImport(prep);
    });
    foot.appendChild(cb);
    foot.appendChild(go);
    d.appendChild(foot);

    function line(text) {
      var p = document.createElement("p");
      p.textContent = text;
      notes.appendChild(p);
    }
    function recompute() {
      prep = I.prepare(parsed, impCtx(steps));
      var have = {};
      state.entries.forEach(function (e) { have[e.id] = 1; });
      fresh = prep.entries.filter(function (e) { return !have[e.id]; }).length;
      var st = prep.stats;
      sum.textContent = t("imp.count").replace("{n}", st.n) +
        (st.n ? " · " + fmtImpDay(st.from) + (fmtImpDay(st.to) !== fmtImpDay(st.from) ? " – " + fmtImpDay(st.to) : "") : "");
      notes.textContent = "";
      if (st.habits.length) {
        line(t("imp.hab").replace("{list}", nameList(st.habits.map(function (x) {
          var hb = null;
          HABITS.forEach(function (hh) { if (hh.f === x.f) hb = hh; });
          return x.name + " → " + (hb ? habLbl(hb, x.side) : x.f);
        }))));
      }
      if (prep.defs.act.length) line(t("imp.newAct").replace("{list}", nameList(prep.defs.act.map(function (x) { return x.lab; }))));
      if (prep.defs.emo.length) line(t("imp.newEmo").replace("{list}", nameList(prep.defs.emo.map(function (x) { return x.lab; }))));
      if (st.n - fresh > 0) line(t("imp.have").replace("{n}", st.n - fresh));
      if (st.skipped) line(t("imp.skipped").replace("{n}", st.skipped));
      if (st.capped) line(t("imp.capped").replace("{max}", I.MAX_ITEMS).replace("{n}", st.capped));
      if (!fresh) line(t("imp.nothing"));
      go.textContent = t("imp.go").replace("{n}", fresh);
      go.disabled = !fresh;
    }
    recompute();
    document.body.appendChild(d);
    d.showModal();
  }
  function KITclean(s) { return window.OrosImportKit.clean(s, 80); }

  // ONE write (checked: a full storage changes nothing) + one sync mark.
  function commitImport(prep) {
    var I = window.OrosMoodImport;
    var prevJson = JSON.stringify(state);
    var res = I.apply(state, prep, Date.now());
    if (!res.added.length) { transientNote(t("imp.nothing")); return; }
    var next = res.state;
    var nv = V.mergeVocab(next.vocab, null);
    if (nv) next.vocab = nv; else delete next.vocab;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
    catch (e) {
      try { localStorage.setItem(STORAGE_KEY, prevJson); } catch (e2) {}
      showToast(t("imp.full"));
      return;
    }
    state = next;
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
    refreshVocab();
    renderAll();
    if (viewMode === "insights") renderInsights();
    var postJson = JSON.stringify(state);
    showToast(t("imp.done").replace("{n}", res.added.length), t("imp.undo"), function () {
      // Untouched since → back to the exact old data; moved on (a pull,
      // an edit) → only the import leaves. Either way the imported ids
      // get tombstones and the new activities / feelings are hidden, so
      // a copy that already synced goes too.
      var prev = JSON.parse(prevJson);
      var base = JSON.stringify(state) === postJson ? prev : state;
      var s = I.undo(base, prev, res, Date.now());
      var uv = V.mergeVocab(s.vocab, null);
      if (uv) s.vocab = uv; else delete s.vocab;
      state = s;
      save();
      refreshVocab();
      renderAll();
      if (viewMode === "insights") renderInsights();
      transientNote(t("imp.undone"));
    });
  }
  window.__orosMoodImportFile = importFile;

  // ---------- 3d. orOS file (.orosmood, ../recordpkg.js + package.js) ----------
  // Every entry, own value, feeling / activity definition and goal as
  // one orOS file. Opening ADDS what this device lacks, with its ids;
  // a record already here (or deleted here) is kept as it is unless
  // "Update with newer versions" is ticked. The result goes through
  // migrate + one checked write + the sync mark; Undo removes the
  // added records the app's own way (entries and own values get
  // tombstones, feelings and activities are hidden, goals soft-deleted).
  STRINGS.en["oros.save"]   = "orOS file (.orosmood)";
  STRINGS.en["oros.open"]   = "Open orOS file…";
  STRINGS.en["oros.folder"] = "Unzipped orOS folder…";
  STRINGS.el["oros.save"]   = "Αρχείο orOS (.orosmood)";
  STRINGS.el["oros.open"]   = "Άνοιγμα αρχείου orOS…";
  STRINGS.el["oros.folder"] = "Αποσυμπιεσμένος φάκελος orOS…";
  if (window.orosI18n) window.orosI18n.table(STRINGS, "mood", LANG);

  var RP = window.OrosRecordPkg || null, MPK = window.OrosMoodPackage || null;
  var recAdded = null;                    // the last open's added ids, per collection
  // Values of opened files that foldCols folded into one here, by id
  // ({ fileId: localId }): this device only, so the same file opened
  // again finds nothing new (package.js tombIds reads it).
  var FOLD_KEY = "oros-mood-folded", FOLD_MAX = 2000;
  function foldedMap() {
    try {
      var m = JSON.parse(localStorage.getItem(FOLD_KEY) || "{}");
      return m && typeof m === "object" && !Array.isArray(m) ? m : {};
    } catch (e) { return {}; }
  }
  function addFolded(map) {
    var m = foldedMap(), ks;
    Object.keys(map).forEach(function (k) { delete m[k]; m[k] = map[k]; });
    ks = Object.keys(m);
    ks.slice(0, Math.max(0, ks.length - FOLD_MAX)).forEach(function (k) { delete m[k]; });
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(m)); } catch (e) {}
  }
  function afterRecChange() {
    refreshVocab();
    renderAll();
    if (viewMode === "insights") renderInsights();
  }
  var recFile = RP && MPK && window.OrosBundle ? RP.ui(MPK.DESC, {
    lang: function () { return LANG === "el" ? "el" : "en"; },
    get: function () { var s = canonState(state); s.__folded = foldedMap(); return s; },
    title: function () { return t("app.title"); },
    set: function (next, info) {
      var prev = canonState(state), ids = (info && info.addedIds) || [];
      var data = migrate(JSON.parse(JSON.stringify(next)));
      if (!data) return;
      delete data.__folded;
      var folded = MPK.foldCols(prev, data, ids).folded;   // a value whose name is here → the one here
      var nv = V.mergeVocab(data.vocab, null);
      if (nv) data.vocab = nv; else delete data.vocab;
      var ng = V.mergeGoals(data.goals, null);
      if (ng) data.goals = ng; else delete data.goals;
      data.entries.sort(byTsDesc);
      ["loc", "trig", "person"].forEach(function (c) { data.cols[c].forEach(function (v, i) { v.pos = i; }); });
      data.sm = Date.now();
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
      catch (e) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e2) {}
        showToast(t("imp.full"));
        return;
      }
      state = data;
      addFolded(folded);
      recAdded = MPK.addedByColl(prev, state, ids);
      if (window.__orosSyncApi) window.__orosSyncApi.dirty();
      afterRecChange();
    },
    deleteIds: function (ids) {
      var now = Date.now(), a = recAdded || MPK.addedByColl({}, canonState(state), ids), want = {};
      ids.forEach(function (id) { want[id] = 1; });
      function pick(list) { var o = {}; list.forEach(function (id) { if (want[id]) o[id] = 1; }); return o; }
      var ge = pick(a.entries);
      state.entries = state.entries.filter(function (e) { return !ge[e.id]; });
      Object.keys(ge).forEach(function (id) { state.deleted[id] = Math.max(state.deleted[id] || 0, now); });
      ["loc", "trig", "person"].forEach(function (c) {
        var gv = pick(a[c]);
        state.cols[c] = state.cols[c].filter(function (v) { return !gv[v.id]; });
        Object.keys(gv).forEach(function (id) { state.deleted[id] = Math.max(state.deleted[id] || 0, now); });
      });
      // the vocabulary never shrinks: an added feeling / activity is hidden
      ["emo", "act"].forEach(function (k) {
        var gd = pick(a[k]);
        ((state.vocab || {})[k] || []).forEach(function (d) {
          if (!gd[d.id]) return;
          d.hid = true;
          d.mtime = Math.max(now, (d.mtime || 0) + 1);
        });
      });
      var gg = pick(a.goals);
      (state.goals || []).forEach(function (g) {
        if (!gg[g.id]) return;
        g.x = 1;
        g.mtime = Math.max(now, (g.mtime || 0) + 1);
      });
      recAdded = null;
      state.sm = now;
      save();
      afterRecChange();
      transientNote(RP.str(LANG === "el" ? "el" : "en", "undone"));
    },
    toast: function (text, undo) {
      if (undo) showToast(text, t("del.undo"), undo);
      else showToast(text);
    }
  }) : null;

  // ---------- 4. Sync slice + palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        document.documentElement.style.setProperty(v, cs.getPropertyValue(v).trim());
      });
    } catch (e) { /* standalone — fallback palette stands */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  function registerSync() {
    var api = (window.parent && window.parent.orosSync) || window.orosSync;
    // __orosSyncApi is defined at boot (MO2) — only the slice
    // registration needs the engine here.
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("mood", sliceGet, sliceSet, STORAGE_KEY, mergeMoodStates);
  }

  function sliceGet() {
    // MO-1: the canonical copy — exactly what mergeMoodStates returns
    // for this state (tombstones sorted and pruned by data time, see
    // canonState). Payload-only: local state is not rewritten here.
    return canonState(state);
  }

  // What the capture form shows, apart from what the user types:
  // a pull that changes none of it leaves the form alone (MO-5).
  function captureSig() {
    return JSON.stringify([state.cols, state.vocab || null, state.entries.length > 0, editing, formValues()]);
  }

  function sliceSet(data, info) {
    data = migrate(JSON.parse(JSON.stringify(data || null)));
    if (!data || !Array.isArray(data.entries)) return;
    // Echo: nothing new → no rewrite, no re-render.
    if (JSON.stringify(canonState(data)) === JSON.stringify(canonState(state))) return;
    var sigBefore = captureSig();

    window.__orosSyncApi._suppress = true;
    try {
      state = data;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } finally {
      window.__orosSyncApi._suppress = false;
    }

    // guard drifted state (post-condition of the merge)
    state.entries.sort(byTsDesc);
    state.cols.loc.forEach(function (v, i) { v.pos = i; });
    state.cols.trig.forEach(function (v, i) { v.pos = i; });
    state.cols.person.forEach(function (v, i) { v.pos = i; });
    refreshVocab();
    // wave 30: an open customisation dialog follows, unless the user
    // is typing in it (their text stays; the next change repaints)
    if (vcDlg && !(document.activeElement && vcDlg.contains(document.activeElement) &&
        /^(INPUT|SELECT)$/.test(document.activeElement.tagName))) paintVocab();

    renderThread();
    renderRecent();
    if (editing !== null && !entryById(editing)) {
      // the entry being edited was deleted elsewhere: leave edit mode
      resetCapture();
    } else {
      followEdit();                       // MO-4: untouched fields follow the data
      // MO-5: rebuild only when something the form shows changed;
      // buildCapture keeps focus and caret when it must rebuild.
      if (!$("capture").hidden && captureSig() !== sigBefore) buildCapture();
    }
    if (viewMode === "insights") renderInsights();   // live views too
    // (No toast per merge: it fired on every sync cycle that brought
    // anything, on top of whatever the user was doing.)
  }

  // Contract Β: shell-owned combos forward FIRST (capture phase).
  document.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
    var p = window.parent;
    if (!(p && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
    if (p.orosShortcuts.handle(e)) e.stopPropagation();
  }, true);

  // ---------- 5. Wiring & boot ----------
  function applyI18n() {
    var n = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < n.length; i++) {
      n[i].textContent = t(n[i].getAttribute("data-i18n"));
    }
    var p = document.querySelectorAll("[data-i18n-ph]");
    for (var k = 0; k < p.length; k++) {
      p[k].setAttribute("placeholder", t(p[k].getAttribute("data-i18n-ph")));
    }
  }

  // R9 parity: static buttons ship EMPTY in HTML, JS paints
  // aria-labels/titles/icons at boot. pencil · list · bar-chart.
  function paintStaticAria() {
    var cap = $("cap-btn");
    if (cap) {
      cap.setAttribute("aria-label", t("capture"));
      cap.setAttribute("title", t("capture"));
      cap.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>' +
        '<path d="M14 5l5 5"/></svg>';
    }
    var ent = $("ent-btn");
    if (ent) {
      ent.setAttribute("aria-label", t("tab.ent"));
      ent.setAttribute("title", t("tab.ent"));
      ent.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M4 6h16M4 12h16M4 18h10"/></svg>';
    }
    var ib = $("ins-btn");
    if (ib) {
      ib.setAttribute("aria-label", t("insights"));
      ib.setAttribute("title", t("insights"));
      ib.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>';
    }
  }

  function wire() {
    // Three tabs — full takeover, one active at a time
    $("cap-btn").addEventListener("click", function () { showTab("capture"); });
    $("ent-btn").addEventListener("click", function () { showTab("entries"); });
    $("ins-btn").addEventListener("click", function () { showTab("insights"); });
  }

  // Wave 4 — deep-link receiver. The shell (__orosOpenMood) calls
  // this on the LIVE iframe when the Mood app is already open; a
  // closed app gets the staged-ID path at boot (Patch 2 below).
  // entryId = state.entries[].id. Opens the entry in edit mode —
  // the entry IS the mood app's natural destination (Discard is
  // always one tap away, and the recent-guard still applies).
  window.__orosMoodOpen = function (entryId) {
    // "mood:checkin" — notification deep link: land on the
    // capture tab FRESH. No resetCapture(): a half-typed draft
    // is precious, buildCapture already preserves it.
    if (entryId === "checkin") {
      showTab("capture");
      var mc = $("moodmain");
      if (mc) mc.scrollTop = 0; else window.scrollTo(0, 0);
      return;
    }
    if (typeof entryId !== "string" || !entryId) return;
    if (!entryById(entryId)) return;      // deleted elsewhere — land on capture
    editEntry(entryId);
  };

  // ---------- Boot ----------
  var SCRIPT_V = "";
  (function () {
    var m = (document.currentScript && document.currentScript.src || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;   // #18: lang attr follows locale
    console.log("mood.js v" + (SCRIPT_V || "?") + " boot");
  })();
  // MO2: dirty hook BEFORE load() — the fresh-install / seed path
  // calls save() at boot, and (weather's WA2 lesson) the hook used
  // to live inside registerSync, which runs after load(). Slice
  // registration still comes later: registerSlice may collect on
  // registration (SY6) and state must exist by then.
  window.__orosSyncApi = {
    _suppress: false,
    dirty: function () {
      var api = (window.parent && window.parent.orosSync) || window.orosSync;
      if (this._suppress) return;
      if (api && typeof api.markDirty === "function") api.markDirty();
    }
  };
  load();
  applyI18n();
  paintStaticAria();
  wire();
  registerSync();
  inheritPalette();
  watchPalette();
  resetCapture();     // smart preselection fires here (suggestFor)
  renderThread();     // #17: renderAll would rebuild capture a 2nd time
  renderRecent();

  // boot: paint the DEFAULT tab's active state (applyView only
  // fires on tab clicks — without this, no button looks "on")
  var b0 = $("cap-btn");
  if (b0) {
    b0.classList.add("on");
    b0.setAttribute("aria-pressed", "true");
  }

  // Boot-time deep-link take: the shell staged an entry ID (Mood
  // was closed when the Calendar feed row was clicked). Consume
  // exactly ONCE — the parent funnel owns the take when we run in
  // the shell; standalone reads sessionStorage directly (nothing
  // there in that mode — staging only happens via the shell).
  // Order matters: AFTER resetCapture(), so the form exists before
  // editEntry fills it (one harmless extra capture paint).
  var pendingMood = null;
  try {
    if (window.parent && window.parent !== window &&
        typeof window.parent.__orosMoodTakePending === "function") {
      pendingMood = window.parent.__orosMoodTakePending();
    } else {
      var mid = sessionStorage.getItem("oros-mood-open");
      if (mid) {
        sessionStorage.removeItem("oros-mood-open");
        pendingMood = mid;
      }
    }
  } catch (e) { pendingMood = null; }
  if (pendingMood) __orosMoodOpen(pendingMood);

  // Single app (solo.js) icon shortcut { checkin: true }: the capture
  // tab, as the check-in reminder opens it.
  // Diary's mood line { day: "YYYY-MM-DD" }: that day's entries.
  // "Open with" an .orosmood file (fileopen.js): { openFile: { token } },
  // the File taken once with window.parent.__orosTakeFile(token)
  window.__orosOpenAt = function (tg) {
    if (tg && typeof tg === "object" && tg.openFile) { if (recFile) recFile.openTarget(tg.openFile); return; }
    if (tg && typeof tg === "object" && tg.checkin === true) __orosMoodOpen("checkin");
    else if (tg && typeof tg === "object" && typeof tg.day === "string" &&
             /^\d{4}-\d{2}-\d{2}$/.test(tg.day)) openDayEntries(tg.day);
  };
  try {
    if (window.parent && window.parent !== window && typeof window.parent.__orosTakeTarget === "function")
      window.__orosOpenAt(window.parent.__orosTakeTarget("mood"));
  } catch (e) {}

})();