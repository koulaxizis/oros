// ============================================================
// orOS Mood — App logic (v0.25.0) — Waves 1–4
// Capturing how you feel must take seconds, not minutes.
// Entries are additive-primary; edits are LWW by mtime; deletes
// leave tombstones (merge-safe). Mood data is PERSONAL: it lives
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
//   4. Sync slice + palette
//   5. Wiring & boot
// Data:
//   slice "oros-mood-data" → travels (entries + custom columns)
//   "oros-mood-seen"        → device-local privacy-notice flag
//   DATA_VER 2: water/food/meds are TRIADIC null|"yes"|"no"
//   (Wave 1 booleans migrate: true→"yes", false→null — the old
//   unchecked state was never a conscious "no").
// Time-of-day derives from the entry timestamp — no UI for it.
// Day boundaries derive from the LOCAL calendar (render-side).
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-mood-data";
  var SEEN_KEY    = "oros-mood-seen";
  var DATA_VER    = 2;

  // ---------- 1. Constants, i18n, icons ----------
  var LANG = localStorage.getItem("oros-lang") === "el" ? "el" : "en";

  var STRINGS = {
    en: {
      "app.title":     "Mood",
      "recent.title":  "Recent entries",
      "privacy.title": "Private by design",
      "privacy.body":  "Your mood data never leaves your device — it syncs only through your own encrypted orOS cloud, and the local export is yours alone.",
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
      "l4.trigger":    "What triggered this? (optional)",
	  "l4.trig.title": "What triggered this?",
      "save":          "Save entry",
      "discard":       "Discard",
      "saved.toast":   "Saved",
      "recent.edit":   "Edit entry",
      "recent.del":    "Delete entry",
      "del.done":      "Deleted",
      "del.undo":      "Undo",
      "tod.morning":   "Morning",
      "tod.afternoon": "Afternoon",
      "tod.evening":   "Evening",
      "tod.night":     "Night",
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
      "tr.loc":          "When you're at “{x}”, you often feel {e} ({d}pt more than usual).",
      "tr.person":       "When you're with “{x}”, you often feel {e} ({d}pt more than usual).",
      "tr.hab":          "When you mark “{h}”, you often feel {e} ({d}pt more than usual).",
      "tr.freq":         "You mark “{h}” on {p}% of your logged days.",
      "tr.pair":         "When you feel {a}, you also mark {b} ({p}% of the time).",
      "tr.trig":         "When “{x}” triggers it, you often feel {e} ({d}pt more than usual).",
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
      "exp.row.days":    "Days logged"
    },
    el: {
      "app.title":     "Διάθεση",
      "recent.title":  "Πρόσφατες καταχωρήσεις",
      "privacy.title": "Ιδιωτικό εκ σχεδίασης",
      "privacy.body":  "Τα δεδομένα διάθεσης δεν φεύγουν ποτέ από τη συσκευή σου — συγχρονίζονται μόνο μέσα από το δικό σου κρυπτογραφημένο orOS cloud, και η τοπική εξαγωγή είναι μόνο δική σου.",
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
      "l4.trigger":    "Τι το προκάλεσε; (προαιρετικό)",
	  "l4.trig.title": "Τι το προκάλεσε;",
      "save":          "Αποθήκευση",
      "discard":       "Απόρριψη",
      "saved.toast":   "Αποθηκεύτηκε",
      "recent.edit":   "Επεξεργασία",
      "recent.del":    "Διαγραφή",
      "del.done":      "Διαγράφηκε",
      "del.undo":      "Αναίρεση",
      "tod.morning":   "Πρωί",
      "tod.afternoon": "Απόγευμα",
      "tod.evening":   "Βράδυ",
      "tod.night":     "Νύχτα",
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
      "ins.hab.days":    "{y} από {n} ημέρες με καταγραφή",
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
      "exp.row.days":    "Ημέρες με καταγραφή"
    }
  };

  function t(key) {
    var p = STRINGS[LANG] || STRINGS.en;
    return p[key] !== undefined ? p[key]
         : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
  }

  // Fixed emotion vocabulary — 9, immutable (statistics need a
  // stable dictionary). Colors are SYSTEM hues only.
  var EMOTIONS = [
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

  // Triadic habits — shared by the capture L3 AND the insights
  // adherence view (one vocabulary, two consumers).
    var HABITS = [
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
  var LOC_SEED = [
    { en: "At home",   el: "Στο σπίτι" },
    { en: "At work",   el: "Στη δουλειά" },
    { en: "Outdoors",  el: "Στη φύση" },
    { en: "Commute",   el: "Μετακίνηση" },
    { en: "Café & bars", el: "Καφέ & μπάρες" }
  ];
  var PERSON_SEED = [
    { en: "Alone",     el: "Μόνος" },
    { en: "Partner",   el: "Σύντροφος" },
    { en: "Kids",      el: "Παιδιά" },
    { en: "Family",    el: "Οικογένεια" },
    { en: "Friends",   el: "Φίλοι" },
    { en: "Colleagues", el: "Συνάδελφοι" }
  ];
  
    // Factory triggers — σπέρνονται ΜΙΑ φορά σε άδεια λίστα
  // (νέα στήλη = δεν είχε ποτέ στιγμή γέννησης). Η ελευθερία
  // (note/προσθήκη custom) μένει στον χρήστη.
  var TRIG_SEED = [
    { en: "Work deadline",  el: "Προθεσμία" },
    { en: "Argument",       el: "Έριδα" },
    { en: "Good news",      el: "Καλά νέα" },
    { en: "Exercise",       el: "Άσκηση" },
    { en: "Sick day",       el: "Μέρα αρρώστιας" },
    { en: "Late screens",   el: "Οθόνες αργά" }
  ];

  function emoByK(k) {
    for (var i = 0; i < EMOTIONS.length; i++) {
      if (EMOTIONS[i].k === k) return EMOTIONS[i];
    }
    return null;
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
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

// ---------- 2. Data model + storage ----------
// state = {
//   ver: 2, sm, om,
//   entries: [{ id, ts, mtime,
//               emotions: [{k, i}],   // k = EMOTIONS key, i = 1–5
//               loc, person,          // column-value ids | null
//               water, food, meds,    // TRIADIC null | "yes" | "no"
//               note, trigger }],     // strings ("" = unset)
//   cols: { loc:  [{id, label, mtime, pos}],
//           person: [{id, label, mtime, pos}] },
//   deleted: { <entryId|colValId>: <tombstone ts> }
// }
var state = null;

function newState() {
  var s = {
    ver: DATA_VER, sm: Date.now(), om: Date.now(),
    entries: [], deleted: {},
    cols: { loc: [], trig: [], person: [] }
  };
  // Seed the two columns ONCE (fresh installs only — existing
  // devices keep whatever the user has curated).
  s.cols.loc  = LOC_SEED.map(function (v, i) {
    return { id: uid(), label: LANG === "el" ? v.el : v.en, mtime: 0, pos: i };
  });
  s.cols.person = PERSON_SEED.map(function (v, i) {
    return { id: uid(), label: LANG === "el" ? v.el : v.en, mtime: 0, pos: i };
  });
  s.cols.trig = TRIG_SEED.map(function (v, i) {
    return { id: uid(), label: LANG === "el" ? v.el : v.en, mtime: 0, pos: i };
  });
  return s;
}

// One-time factory triggers — καλύπτει και existing installs
// (νέα στήλη). Ισχύει πλήρως η κουρτίνα του χρήστη μετά: renames/
// deletes μέσω Manage, πρόσθετες τιμές μέσω Add….
function seedTriggers() {
  state.cols.trig = TRIG_SEED.map(function (v, i) {
    return { id: uid(), label: LANG === "el" ? v.el : v.en, mtime: 0, pos: i };
  });
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
        thit = { id: uid(), label: trg, mtime: 0, pos: data.cols.trig.length };
        data.cols.trig.push(thit);
      }
      e.trig = thit.id;
    } else if (!e.trig) e.trig = null;
    e.trigger = "";                       // legacy string retired
    // DATA_VER 2: triadic habits. Wave-1 booleans migrate as:
    // true → "yes", false → null. The old unchecked state was
    // never a conscious "no" — honesty over retro-fitting.
        HABITS.forEach(function (h) { var f = h.f;
      if (e[f] === true)          e[f] = "yes";
      else if (e[f] === false || e[f] === "yes" || e[f] === "no") {
        // false → null handled below; explicit values stay
        if (e[f] === false) e[f] = null;
      } else e[f] = null;
    });
    if (typeof e.ts !== "number") e.ts = Date.now();
    if (typeof e.mtime !== "number") e.mtime = e.ts;
    e.loc = e.loc || null; e.person = e.person || null;
  });
  data.cols.loc.concat(data.cols.trig, data.cols.person).forEach(function (v) {
    if (typeof v.mtime !== "number") v.mtime = 0;
    if (typeof v.pos !== "number") v.pos = 0;
  });
  data.ver = DATA_VER;
  return data;
}

function load() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      var data = migrate(JSON.parse(raw));
      if (data) {
        state = data;
        if (!state.cols.trig.length) seedTriggers();
        return;
      }
    }
  } catch (e) { /* corrupted → fresh */ }
  state = newState();
  save();
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { /* quota */ }
  if (window.__orosSyncApi) window.__orosSyncApi.dirty();
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

// ---------- 2b. Merge engine (todo-contract, compact) ----------
// Deterministic + symmetric: merge(A,B) === merge(B,A).
//   · entries — union by id, content LWW by mtime (ties by
//     lexicographic JSON — identical both sides)
//   · column values — same, per column, by id
//   · tombstones — union with max ts; newer edits resurrect
//     (the undo-delete toast relies on this, same as weather)
//   · ordering — entries = DESC ts (derived at sort time, not
//     stored pos — a timeline has exactly ONE natural order);
//     column values = the om-larger side donates positions
// NOTE (DATA_VER 2): no merge changes — the triadic habit fields
// live INSIDE entries, which merge whole-object by mtime. Old
// devices merging Wave-1 entries simply produce unmigrated local
// reads until they run this version's migrate() — safe because
// neither side loses data.

function newerObj(a, b) {
  if ((a.mtime || 0) !== (b.mtime || 0)) {
    return (a.mtime || 0) > (b.mtime || 0) ? a : b;
  }
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

function mergeUnionList(a, b, tomb) {
  var map = {};
  (a || []).forEach(function (x) { map[x.id] = x; });
  (b || []).forEach(function (x) {
    map[x.id] = map[x.id] ? newerObj(map[x.id], x) : x;
  });
  var alive = [];
  Object.keys(map).forEach(function (id) {
    var ts = tomb ? tomb[id] : undefined;
    if (ts === undefined || (map[id].mtime || 0) > ts) alive.push(map[id]);
  });
  return alive;
}

function mergeCols(colsA, colsB, tomb) {
  var out = {};
  ["loc", "trig", "person"].forEach(function (name) {
    out[name] = mergeUnionList((colsA || {})[name], (colsB || {})[name], tomb);
  });
  return out;
}

function sortColVals(vals, omSideIsA, colA, colB) {
  var ref = omSideIsA ? (colA || []) : (colB || []);
  var idx = {};
  ref.forEach(function (v, i) { idx[v.id] = i; });
  vals.sort(function (x, y) {
    var ix = idx[x.id] !== undefined ? idx[x.id] : Infinity;
    var iy = idx[y.id] !== undefined ? idx[y.id] : Infinity;
    if (ix !== iy) return ix - iy;
    if ((x.mtime || 0) !== (y.mtime || 0)) return (y.mtime || 0) - (x.mtime || 0);
    return x.id < y.id ? -1 : (x.id > y.id ? 1 : 0);
  });
  vals.forEach(function (v, i) { v.pos = i; });
}

function mergeMoodStates(A, B) {
  var a = A || {}, b = B || {};

  var tomb = {};
  Object.keys(a.deleted || {}).forEach(function (id) { tomb[id] = a.deleted[id]; });
  Object.keys(b.deleted || {}).forEach(function (id) {
    tomb[id] = Math.max(tomb[id] || 0, b.deleted[id]);
  });

  var entries = mergeUnionList(a.entries, b.entries, tomb)
    .sort(function (x, y) { return y.ts - x.ts; });   // timeline order

  var omSideIsA = (a.om || 0) >= (b.om || 0);
  var cols = mergeCols(a.cols, b.cols, tomb);
  sortColVals(cols.loc,    omSideIsA, (a.cols || {}).loc,    (b.cols || {}).loc);
  sortColVals(cols.trig,   omSideIsA, (a.cols || {}).trig,   (b.cols || {}).trig);
  sortColVals(cols.person, omSideIsA, (a.cols || {}).person, (b.cols || {}).person);

  return {
    ver: DATA_VER,
    sm: Math.max(a.sm || 0, b.sm || 0),
    om: Math.max(a.om || 0, b.om || 0),
    entries: entries,
    cols: cols,
    deleted: tomb
  };
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
        "position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(8px);" +
        "z-index:1200;background:var(--panel-bg);border:1px solid var(--border);" +
        "border-radius:8px;box-shadow:0 4px 16px var(--shadow);padding:9px 14px;" +
        "font-size:13px;color:var(--text);opacity:0;transition:opacity .3s,transform .3s;" +
        "max-width:calc(100vw - 32px);";
      document.body.appendChild(toastEl);
    }
    if (toastAction) { toastAction.remove(); toastAction = null; }
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
    toastEl.style.transform = "translateX(-50%) translateY(0)";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 5000);
  }
  function hideToast() {
    if (!toastEl) return;
    toastEl.style.opacity = "0";
    toastEl.style.transform = "translateX(-50%) translateY(8px)";
    if (toastAction) { toastAction.remove(); toastAction = null; }
    toastEl.textContent = "";
  }

  // Privacy notice — first open on THIS device, then never again.
  function maybePrivacyNotice() {
    if (localStorage.getItem(SEEN_KEY)) return;
    var ov = document.createElement("dialog");
    ov.id = "privacy-dlg";
    ov.innerHTML =
      "<h3>" + esc(t("privacy.title")) + "</h3>" +
      "<p>" + esc(t("privacy.body")) + "</p>";
    var ok = document.createElement("button");
    ok.type = "button";
    ok.className = "prim";
    ok.textContent = "OK";
    ok.addEventListener("click", function () {
      localStorage.setItem(SEEN_KEY, "1");
      ov.close();
    });
    ov.appendChild(ok);
    document.body.appendChild(ov);
    ov.showModal();
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
    fresh.deleted = tomb;             // tombstones travel, merge-proof
    fresh.sm = now; fresh.om = now;
    state = fresh;
    save();
    resetCapture();
    renderAll();
    if (viewMode === "insights") renderInsights();
    showToast(t("rst.done"));
  }

  // --- capture state ---
  var editing   = null;   // entry id | null (new-entry mode)
  var managing = false;   // view state: chip management mode (rename/delete)
  var picked    = {};     // emotionKey → intensity 1–5
  var selLoc    = null;   // column-value id | null
  var selPerson = null;
  var selTrig   = null;   // trigger preset id | null
  var hab       = {};                     // TRIADIC null|"yes"|"no", keys = HABITS
  HABITS.forEach(function (h) { hab[h.f] = null; });

    function resetCapture() {
    editing = null;
    picked = {};
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
    var prevNote = $("fld-note") ? $("fld-note").value : "";   // read BEFORE clear
    host.innerHTML = "";

    // ---- L1: emotion grid ----
    var h1 = document.createElement("h2");
    h1.className = "sec-title";
    h1.textContent = t("l1.title");
    host.appendChild(h1);

    var grid = document.createElement("div");
    grid.id = "emogrid";
    EMOTIONS.forEach(function (em) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "emotile" + (picked[em.k] !== undefined ? " on" : "");
      b.style.color = em.col;                  // the TILE carries the hue
      b.title = t(em.i18n);
      b.setAttribute("aria-label", t(em.i18n));
      b.setAttribute("aria-pressed", picked[em.k] !== undefined ? "true" : "false");
      b.innerHTML = faceFor(em.k) +
        '<span class="emo-name">' + esc(t(em.i18n)) + "</span>";
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
        var em = emoByK(k);
        var row = document.createElement("div");
        row.className = "int-row";
        row.style.color = em.col;
        var lab = document.createElement("span");
        lab.className = "int-lab";
        lab.textContent = t(em.i18n);
        row.appendChild(lab);
        var sl = document.createElement("input");
        sl.type = "range";
        sl.id = "sl-" + k;
        sl.min = "1"; sl.max = "5"; sl.step = "1";
        sl.value = String(picked[k]);
        sl.setAttribute("aria-label", t(em.i18n));
        sl.addEventListener("input", function () {
          picked[k] = parseInt(sl.value, 10);
        });
        row.appendChild(sl);
        var num = document.createElement("span");
        num.className = "int-num";
        num.textContent = String(picked[k]);
        sl.addEventListener("input", function () {
          num.textContent = sl.value;
        });
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
        c.textContent = v.label;
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
        var row = document.createElement("div");
        row.className = "habrow";
        ["yes", "no"].forEach(function (side) {
          var hc = document.createElement("button");
          hc.type = "button";
          hc.className = "chip hab" + (hab[hh.f] === side ? " on" : "") +
            (side === "no" ? " neg" : "");
          hc.textContent = t(hh[side]);
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
      c.textContent = v.label;
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
        $("fld-note").value = last.note || "";
        // selTrig comes from loadEntryIntoCapture(last) above
        var mm = $("moodmain");
        if (mm) mm.scrollTop = 0;
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
  
    function buildCaptureKeepScroll() {
    var mm = $("moodmain");
    var st = mm ? mm.scrollTop : 0;
    buildCapture();
    if (mm) mm.scrollTop = st;
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
    inp.value = v.label;
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
      return o.id !== exceptId &&
        String(o.label).trim().toLowerCase() === norm;
    });
  }

  function applyChipRename(col, v, label) {
    label = String(label).trim();
    closeChipMenu();
    if (!label || label === v.label) return;
    if (colLabelExists(col, label, v.id)) { showToast(t("col.dup")); return; }
    v.label = label;
    v.mtime = Date.now();                // LWW — rename travels
    state.sm = Date.now();
    save();
    buildCapture();
    renderAll();                          // recent list shows labels live
    showToast(t("col.renamed"));
  }

  function deleteColVal(col, v) {
    closeChipMenu();
    state.cols[col] = (state.cols[col] || []).filter(function (x) {
      return x.id !== v.id;
    });
    state.deleted[v.id] = Date.now();    // tombstone — merge-safe
    if (col === "loc" && selLoc === v.id) selLoc = null;
    else if (col === "person" && selPerson === v.id) selPerson = null;
    else if (col === "trig" && selTrig === v.id) selTrig = null;
    state.sm = Date.now();
    save();
    buildCapture();
    renderAll();
    showToast(t("col.del.done"), t("col.del.undo"), function () {
      // resurrection: fresh mtime beats the tombstone (same
      // contract as entries)
      v.mtime = Date.now();
      state.cols[col].push(v);
      delete state.deleted[v.id];
      state.sm = Date.now();
      save();
      buildCapture();
      renderAll();
    });
  }

  function commitColVal(col, input) {
    var label = input.value.trim();
    if (!label) return;
    if (colLabelExists(col, label, null)) {
      showToast(t("col.dup"));            // no silent duplicates — ever again
      return;
    }
    var v = { id: uid(), label: label, mtime: Date.now(), pos: (state.cols[col] || []).length };
    state.cols[col].push(v);
    state.sm = Date.now();
    state.om = Date.now();
    save();
       if (col === "loc") selLoc = v.id;
    else if (col === "person") selPerson = v.id;
    else selTrig = v.id;
    buildCapture();
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
      editing = last.id;
      loadEntryIntoCapture(last);
      // BUG FIX: fields weren't prefilled — "Edit" overwrote the old
      // reflection with the empty DOM. Merge BOTH reflections.
      var vn = [last.note || "", $("fld-note").value.trim()].filter(Boolean);
      $("fld-note").value = vn.join("\n");
      selTrig = selTrig || last.trig || null;   // new pick wins, legacy fallback
      commitEntry(emos);
    }));
    g.appendChild(mk(t("recent.new"), "ghost", function () {
      commitEntry(emos);
    }));
    $("capture").insertBefore(g, $("capture").firstChild);
  }

  function loadEntryIntoCapture(e) {
    picked = {};
    (e.emotions || []).forEach(function (m) { picked[m.k] = m.i; });
    selLoc = e.loc; selPerson = e.person; selTrig = e.trig || null;
    HABITS.forEach(function (h) {
      hab[h.f] = (e[h.f] === "yes" || e[h.f] === "no") ? e[h.f] : null;
    });
  }

  function commitEntry(emos) {
    var note = $("fld-note") ? $("fld-note").value.trim() : "";
    var e;
    if (editing) {
      e = entryById(editing);
      if (!e) { e = { id: editing }; state.entries.push(e); }   // resurrection safety
      e.emotions = emos; e.loc = selLoc; e.person = selPerson;
      HABITS.forEach(function (h) { e[h.f] = hab[h.f]; });
      e.note = note; e.trig = selTrig; e.trigger = "";
      e.mtime = Date.now();
      // resurrection: this edit is newer than any tombstone
      if (state.deleted[e.id] !== undefined) delete state.deleted[e.id];
    } else {
      e = {
        id: uid(), ts: Date.now(), mtime: Date.now(),
        emotions: emos, loc: selLoc, person: selPerson,
        note: note, trig: selTrig, trigger: ""
      };
      HABITS.forEach(function (h) { e[h.f] = hab[h.f]; });
      state.entries.push(e);
    }
    state.entries.sort(function (x, y) { return y.ts - x.ts; });
    state.sm = Date.now();
    save();
    resetCapture();
    renderAll();
    showToast(t("saved.toast"));
  }

  function editEntry(id) {
    var e = entryById(id);
    if (!e) return;
    editing = id;
    loadEntryIntoCapture(e);
    buildCapture();
    $("fld-note").value = e.note || "";
    var mm = $("moodmain");
    if (mm) mm.scrollTop = 0; else window.scrollTo(0, 0);
  }

  // Delete — immediate + undo toast (same id, fresh mtime beats
  // the tombstone: resurrection is legitimate by merge contract).
  function deleteEntry(id) {
    var e = entryById(id);
    if (!e) return;
    state.entries = state.entries.filter(function (x) { return x.id !== id; });
    state.deleted[id] = Date.now();
    state.sm = Date.now();
    save();
    renderAll();
    if (editing === id) resetCapture();
    showToast(t("del.done"), t("del.undo"), function () {
      e.mtime = Date.now();               // fresh mtime > tombstone
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
    if (!keys.length) { host.hidden = true; return; }
    host.hidden = false;
    host.innerHTML = "";
    // last 7 calendar days, oldest → newest
    var out = [];
    for (var d = 6; d >= 0; d--) {
      var ts = Date.now() - d * 24 * 60 * 60 * 1000;
      out.push({ key: dayKey(ts), entry: days[dayKey(ts)] || null });
    }
    out.forEach(function (day, idx) {
      var wrap = document.createElement("span");
      wrap.className = "tdotwrap";
      var dot = document.createElement("span");
      dot.className = "tdot";
      if (day.entry) {
        var em = emoByK(day.entry.k);
        dot.style.background = em ? em.col : "var(--text-dim)";
        dot.title = t("emo." + day.entry.k) || "";
      } else {
        dot.className = "tdot hollow";    // no entry that day
      }
      wrap.appendChild(dot);
      var lb = document.createElement("span");
      lb.className = "twd";
      lb.textContent = new Date(Date.now() - (6 - idx) * 86400000)
        .toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB",
          { weekday: "narrow" });
      wrap.appendChild(lb);
      host.appendChild(wrap);
    });
  }
  
  var searchQ = "";   // view state: entries search text (never persisted)

    function searchHaystack(e) {
    var bits = [];
    var d = new Date(e.ts);
    bits.push(d.toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB",
      { weekday: "short", day: "numeric", month: "short" }));
    (e.emotions || []).forEach(function (m) {
      var em = emoByK(m.k);
      if (em) bits.push(t(em.i18n));
    });
    if (e.loc) { var L = colValById("loc", e.loc); if (L) bits.push(L.label); }
    if (e.person) { var P = colValById("person", e.person); if (P) bits.push(P.label); }
    HABITS.forEach(function (h) {
      if (e[h.f] === "yes" || e[h.f] === "no") bits.push(t(h[e[h.f]]));
    });
    if (e.trig) { var TV = colValById("trig", e.trig); if (TV) bits.push(TV.label); }
    bits.push(e.note || "");
    return bits.join(" ").toLowerCase();
  }

  function fillEntryList() {
    var list = $("entry-list");
    if (!list) return;
    list.innerHTML = "";
    var q = searchQ.trim().toLowerCase();
    var shown = 0;
    state.entries.forEach(function (e) {
      if (q && searchHaystack(e).indexOf(q) < 0) return;   // search scans ALL
      if (shown >= 30) return;                             // display cap stays
      shown++;

      var li = document.createElement("li");
      li.className = "entry";

      var when = document.createElement("span");
      when.className = "e-when";
      var d = new Date(e.ts);
      when.textContent =
        d.toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB",
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
        f.title = t(em.i18n) + " · " + m.i + "/5";
        faces.appendChild(f);
      });
      li.appendChild(faces);

      var ctx = document.createElement("span");
      ctx.className = "e-ctx";
      var bits = [];
      if (e.loc) { var L = colValById("loc", e.loc); if (L) bits.push(L.label); }
      if (e.person) { var P = colValById("person", e.person); if (P) bits.push(P.label); }
      HABITS.forEach(function (h) {
        if (e[h.f] === "yes" || e[h.f] === "no") bits.push(t(h[e[h.f]]));
      });
      ctx.textContent = bits.join(" · ");
      li.appendChild(ctx);

      if (e.note || e.trigger) {
        var sn = document.createElement("span");
        sn.className = "e-note";
        var tv = e.trig ? colValById("trig", e.trig) : null;
        var txt = (tv ? "[" + tv.label + "] " : "") + e.note;
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
  }

  function renderRecent() {
    var sec = $("recent"), list = $("entry-list");
    // hide when empty OR when the entries tab isn't the active view —
    // applyView owns visibility; this must never force-show.
    if (!state.entries.length || viewMode !== "entries") {
      sec.hidden = true;
      return;
    }
    sec.hidden = false;

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

    fillEntryList();
  }

  function renderAll() {
    renderThread();
    renderRecent();
    if (!$("capture").hidden) buildCaptureKeepScroll();   // labels may rename/delete
  }
  
    // ---------- 3b. Insights view (ALL render-time derived) ----------
  // Zero new storage keys, zero sync surface: every number here is
  // recomputed from state.entries at render time. Range selector
  // lives in view state, never persisted.

  var viewMode = "capture";              // "capture" | "insights"
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
      if (hf && e[hf[0]] !== hf[1]) return false;
      return true;
    });
  }

  function showTab(tab) {
    viewMode = tab;
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
      p[0].setAttribute("title", p[0] === b2 ? t("tab.ent") : t("insights"));
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
      lab.textContent = t(r.em.i18n);
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
        t("ins.avg").replace("{n}", r.avg.toFixed(1));
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
      lc.appendChild(mkFChip(v.label, insFilter.loc === v.id, function () {
        insFilter.loc = insFilter.loc === v.id ? null : v.id;
      }));
    });
    panel.appendChild(lc);

    var pc = mkGroup("l2.person");
    (state.cols.person || []).forEach(function (v) {
      pc.appendChild(mkFChip(v.label, insFilter.person === v.id, function () {
        insFilter.person = insFilter.person === v.id ? null : v.id;
      }));
    });
    panel.appendChild(pc);

    var hc = mkGroup("ins.habits.title");
    HABITS.forEach(function (h) {
      if (h.grp === "rit") return;          // basics group only
      ["yes", "no"].forEach(function (side) {
        hc.appendChild(mkFChip(t(h[side]),
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
        rc.appendChild(mkFChip(t(h[side]),
          insFilter.hab === h.f + ":" + side, function () {
            insFilter.hab = insFilter.hab === h.f + ":" + side ?
              null : h.f + ":" + side;
          }));
      });
    });
    panel.appendChild(rc);

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
      LANG === "el" ? "el-GR" : "en-GB",
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
        .toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB",
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
        dot.title = t("emo." + days[dk].k);
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

  function renderDayList(dayK) {
    var dl = $("day-list");
    if (!dl) return;
    dl.hidden = false;
    dl.innerHTML = "";
    var title = document.createElement("div");
    title.className = "col-lab";
    title.textContent = t("ins.day.entries") + " · " + dayK;
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
        f.title = t(em.i18n) + " · " + m.i + "/5";
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
      cur = new Date(cur.getTime() - 24 * 60 * 60 * 1000);
      if (!daySet[dayKey(cur.getTime())]) return { streak: 0, logged: logged };
    }
    while (daySet[dayKey(cur.getTime())]) {
      streak++;
      cur = new Date(cur.getTime() - 24 * 60 * 60 * 1000);
    }
    return { streak: streak, logged: logged };
  }

  // -- habits adherence: yes/no/day-over-logged-days strips.
  //    TWO subsections over the ONE HABITS array — grp decides
  //    the bucket, labelKey the dim subsection heading. --
  function renderHabits(host, es, grp) {
    var daySet = {};
    es.forEach(function (e) { daySet[dayKey(e.ts)] = 1; });
    var loggedDays = Object.keys(daySet).length;
    if (!loggedDays) return;

    HABITS.forEach(function (h) {
      if (h.grp !== grp) return;
      var yesDays = 0, noDays = 0;
      es.forEach(function (e) {
        if (e[h.f] === "yes") yesDays += 1;      // per-entry, not
        if (e[h.f] === "no")  noDays += 1;       // per-day — honest
      });
      var row = document.createElement("div");
      row.className = "dist-row";
      var lab = document.createElement("span");
      lab.className = "dist-lab";
      lab.textContent = t(h.yes);
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
      lab.textContent = v.label;
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
          .replace("{x}", v.label)
          .replace("{e}", t("emo." + b.k))
          .replace("{d}", b.d); });
    });
    (state.cols.person || []).forEach(function (v) {
      consider(sub.filter(function (e) { return e.person === v.id; }),
        function (b) { return t("tr.person")
          .replace("{x}", v.label)
          .replace("{e}", t("emo." + b.k))
          .replace("{d}", b.d); });
    });
    HABITS.forEach(function (h) {
      ["yes", "no"].forEach(function (side) {
        var cond = sub.filter(function (e) { return e[h.f] === side; });
        consider(cond, function (b) { return t("tr.hab")
          .replace("{h}", t(h[side]))
          .replace("{e}", t("emo." + b.k))
          .replace("{d}", b.d); });
        // tendency: a "no" habit marked ≥35% of logged days
        if (side === "no" && cond.length >= TR_MIN_N) {
          var p = Math.round(cond.length / sub.length * 100);
          if (p >= 35) out.push({ d: p, fn: t("tr.freq")
            .replace("{h}", t(h.no)).replace("{p}", p) });
        }
      });
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
            .replace("{a}", t("emo." + ea.k))
            .replace("{b}", t("emo." + eb.k))
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
      trigOrig[key] = s;                       // registry casing (single truth)
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
        .replace("{e}", t("emo." + b.k))
        .replace("{d}", b.d); });
    });

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
        .toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB",
          { weekday: "long" });
      li.appendChild(document.createTextNode(wdName + ": "));
      var em = emoByK(r.k);
      var sp = document.createElement("span");
      sp.style.color = em ? em.col : "";
      sp.textContent = t("emo." + r.k);
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
    if (top) mkKpi(t("rec.top"), t(top.i18n), topN + "×");

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
      lab.textContent = em ? t(em.i18n) : r.k;
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
      val.textContent = r.r.toFixed(1) + "/5";
      var dv = document.createElement("span");
      dv.className = "dist-delta " + (r.d > 0 ? "up" : "down");
      dv.textContent = (r.d > 0 ? "+" : "−") + Math.abs(r.d).toFixed(1);
      val.appendChild(dv);
      row.appendChild(val);
      host.appendChild(row);
    });
    var hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = t("ins.int.hint");
    host.appendChild(hint);
  }
  
    // ---------- PDF export ----------
  // jsPDF is VENDORED LOCALLY (vendor/jspdf.umd.min.js) — never a
  // CDN. Optional: if the file is absent, export degrades to a
  // toast error; nothing else breaks.
  var pdfLibLoading = false;
  function loadPdfLib(done) {
    if (window.jspdf && window.jspdf.jsPDF) { done(); return; }
    if (pdfLibLoading) return;
    pdfLibLoading = true;
    var cands = ["../vendor/jspdf.umd.min.js", "vendor/jspdf.umd.min.js"];
    var i = 0;
    (function next() {
      if (i >= cands.length) { pdfLibLoading = false; showToast(t("exp.err")); return; }
      var s = document.createElement("script");
      s.src = cands[i++];
      s.onload = function () { pdfLibLoading = false; done(); };
      s.onerror = function () { s.remove(); next(); };
      document.head.appendChild(s);
    })();
  }

  function exportPdf() {
    loadPdfLib(function () {
      var JS = window.jspdf.jsPDF;
      var doc = new JS({ unit: "pt", format: "a4" });
      var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
      var M = 48, y = M, page = 1;

      var footer = function () {
        doc.setFontSize(8); doc.setTextColor(150);
        doc.text("orOS Mood — " + t("app.title"), M, H - 28);
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
        new Date().toLocaleString(LANG === "el" ? "el-GR" : "en-GB"), M, y);
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
          doc.setFont(undefined, "bold");
          need(15);
          doc.text(t(r.em.i18n), M + 8, y);
          doc.setFont(undefined, "normal");
          doc.setTextColor(115);
          doc.text(r.c + "  ·  " + pct + "%  ·  " +
            t("ins.avg").replace("{n}", r.avg.toFixed(1)),
            W - M - 8, y, { align: "right" });
          y += 15;
        });
        y += 4;
      } else line(t("ins.ctx.none"));

      // 4. habits + rituals adherence (two grouped sections)
      var habGrpTitle = { hab: t("ins.habits.title"), rit: t("grp.rit") };
      ["hab", "rit"].forEach(function (grp) {
        var anyIn = false;
        HABITS.forEach(function (h) {
          if (h.grp !== grp) return;
          var yy = 0, nn = 0;
          fes.forEach(function (e) {
            if (e[h.f] === "yes") yy += 1;
            if (e[h.f] === "no") nn += 1;
          });
          if (!yy && !nn) return;
          if (!anyIn) { section(habGrpTitle[grp]); anyIn = true; }
          var tot = yy + nn;
          kv(t(h.yes), t("ins.hab.days")
            .replace("{y}", yy).replace("{n}", tot) +
            "  ·  " + Math.round(yy / tot * 100) + "%");
        });
        if (grp === "hab" && !anyIn) line(t("ins.ctx.none"));
      });
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
              .toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB",
                { weekday: "long" });
            kv(wdName, t("emo." + r.k) + "  ·  +" + r.d + "pt");
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
          kv(v.label, cnts[id] + "  ·  " + pct + "%");
        });
        y += 4;
      });

      footer();
      doc.save("oros-mood-" + dayKey(Date.now()) + ".pdf");
      showToast(t("exp.done"));
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

    // ---- calendar (ignores range AND filters) ----
    var d3 = document.createElement("h2");
    d3.className = "sec-title";
    d3.textContent = t("ins.cal.title");
    host.appendChild(d3);
    renderCalendar(host, state.entries);

    // ---- breakdowns (filtered) ----
    renderBreakdown(host, fes, "loc", "ins.loc.title");
    renderBreakdown(host, fes, "person", "ins.per.title");

    // ---- weekday patterns (filtered — respects both) ----
    renderWeekday(host, fes);

    // factory reset — far corner, away from accidental thumbs
    appendResetLink(host);
  }

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

    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };

    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("mood", sliceGet, sliceSet, STORAGE_KEY, mergeMoodStates);
  }

  function sliceGet() {
    return JSON.parse(JSON.stringify(state));
  }

  function sliceSet(data, info) {
    data = migrate(JSON.parse(JSON.stringify(data || null)));
    if (!data || !Array.isArray(data.entries)) return;

    window.__orosSyncApi._suppress = true;
    try {
      state = data;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } finally {
      window.__orosSyncApi._suppress = false;
    }

    // guard drifted state (post-condition of the merge)
    state.entries.sort(function (x, y) { return y.ts - x.ts; });
    state.cols.loc.forEach(function (v, i) { v.pos = i; });
    state.cols.person.forEach(function (v, i) { v.pos = i; });

    // drop edits that leave the UI halfway (editing a now-deleted
    // entry from another device) without yanking the keyboard
    if (editing !== null && !entryById(editing)) resetCapture();

    renderAll();                          // repaint live
    if (viewMode === "insights") renderInsights();   // live views too
    if (info && info.merged) showToast(t("saved.toast"));   // light ack
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

  // ---------- Boot ----------
   (function () {
    var m = (document.currentScript && document.currentScript.src || "")
      .match(/[?&]v=([^&#]+)/);
    console.log("mood.js v" + (m ? m[1] : "?") + " boot");
  })();
  load();
  applyI18n();
  paintStaticAria();
  wire();
  registerSync();
  inheritPalette();
  watchPalette();
  resetCapture();     // smart preselection fires here (suggestFor)
  renderAll();
  maybePrivacyNotice();   // device-local, one time, then never again
  
})();