// ============================================================
// orOS Cycle — App logic (v0.1.00)
// Tracking the menstrual cycle must be seconds, not minutes.
// Data model mirrors mood.js v0.27.00 verbatim: entities are
// LWW by mtime; deletes leave tombstones (merge-safe); day
// records use DETERMINISTIC ids (the date itself) so two
// devices logging the same day converge instead of duplicating.
// Cycle data is among the most PERSONAL data an app can hold:
// it lives in this device's localStorage and travels ONLY
// through the encrypted orOS sync slice — no network calls,
// ever, besides the sync engine itself.
// Sections:
//   1. Constants, i18n, symptom/medication vocabularies, helpers
//   2. Data model + storage (periods, days, columns, tombstones)
//   2b. Merge engine (deterministic + symmetric)
//   3. Calendar view + day editor + days list
//   3b. Insights view (averages + breakdowns — render-derived)
//   4. Sync slice + palette
//   5. Wiring & boot
// Data:
//   slice "oros-cycle-data" → travels (periods, days, columns)
//   periods: [{ id, start, end|null, flow: 1|2|3, mtime }]
//   days:    [{ id:"d-YYYY-MM-DD", day, mtime, sym:[ids],
//               meds:[{id, med, at}], note }]
//   cols:    { sym:[{id,label,bi,mtime,pos}], med:[...] }
// Absence of data is never imputed: an unlogged day is
// UNKNOWN, never "no period". All honesty rules of mood.js
// apply unchanged.
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-cycle-data";
  var DATA_VER    = 1;

  // ---------- 1. Constants, i18n, vocabularies, helpers ----------
  var LANG = localStorage.getItem("oros-lang") === "el" ? "el" : "en";

  var STRINGS = {
    en: {
      "app.title":     "Cycle",
      "tab.cal":       "Calendar",
      "tab.days":      "Days",
      "tab.ins":       "Insights",
      "cal.prev":      "Previous month",
      "cal.next":      "Next month",
      "cal.today":     "Today",
      "ci.none":       "First period not logged yet",
      "ci.next":       "expected",
      "ci.late":       "~{n} days late",
      "pred.disc":     "Predictions are estimates from your own averages — not medical advice, not a contraception method.",
      "pred.hint":     "Dashed days = predicted period (estimate)",
      "rem.title":     "Reminders",
      "rem.on":        "Reminders on",
      "rem.off":       "Reminders off",
      "rem.soon":      "Period expected in ~{n} days",
      "rem.late":      "Period appears overdue — expected ~{n} days ago",
      "ci.cycle":      "Day {n} of cycle",
      "ci.in":         "Day {n} of period",
      "dg.back":       "Back to calendar",
      "dg.sofar":      "Day {n}",
      "per.title":     "Period",
      "per.start":     "Start period",
      "per.endhere":   "End period here",
      "per.remove":    "Remove this period",
      "per.ongoing":   "Ongoing",
      "per.flow":      "Flow",
      "flow.1":        "Light",
      "flow.2":        "Normal",
      "flow.3":        "Heavy",
      "sym.title":     "Symptoms",
      "sym.none":      "None",
      "sym.add":       "Add…",
      "sym.add.ph":    "New symptom…",
      "sym.manage":    "Manage…",
      "med.title":     "Pain relief",
      "med.take":      "Take",
      "med.log":       "Taken today",
      "med.add":       "Add…",
      "med.add.ph":    "New medication…",
      "med.manage":    "Manage…",
      "med.none":      "Nothing taken yet",
      "med.at":        "at {h}",
      "note.title":    "Notes (optional)",
      "save":          "Save day",
      "saved.toast":   "Saved",
      "del.done":      "Deleted",
      "del.undo":      "Undo",
      "days.title":    "Logged days",
      "day.edit":      "Edit day",
      "day.del":       "Delete day",
      "days.search":   "Search days…",
      "days.empty":    "No logged days yet — they'll appear here after your first entry.",
      "cal.empty":     "Tap any day to log it",
      "ins.empty":     "No periods logged yet — your stats will appear with your first cycle.",
      "ins.rall":      "All",
      "ins.r6":        "6 months",
      "ins.need3":     "At least 2 periods needed for cycle averages.",
      "ins.avg.cycle": "Avg cycle",
      "ins.avg.per":   "Avg period",
      "ins.periods":   "Periods logged",
      "ins.sym.title": "Most frequent symptoms",
      "ins.med.title": "Pain relief taken",
      "ins.days.n":    "{n} days",
      "ins.ctx.none":  "Nothing logged in this range.",
      "col.menu.rename": "Rename",
      "col.menu.del":    "Delete",
      "col.dup":         "That value already exists",
      "col.renamed":     "Renamed",
      "col.del.done":    "Deleted",
      "col.del.undo":    "Undo",
      "rst.btn":       "Factory reset",
      "rst.body1":     "This permanently erases ALL cycle data — periods, symptoms, medications, notes and custom values — on every synced device. There is no undo.",
      "rst.yes1":      "Continue",
      "rst.body2":     "Last chance: every period, day log, custom symptom and medication, and every statistic built on them will be erased. This cannot be undone.",
      "rst.yes2":      "Erase everything",
      "rst.cancel":    "Cancel",
      "rst.done":      "Fresh start — everything erased",
      "sync.pull":     "Updated from sync",
      "per.warn":     "Overlaps another period — not saved",
      "xm.title":     "Mood on period days",
      "xm.dur":       "Period days",
      "xm.oth":       "Other days",
      "xm.tr":        "On period days you often feel {e} (+{d}pt vs other days).",
      "xm.pos":       "Share of entries with positive feelings (happy · calm · excited)",
      "xm.disc":      "Observational comparison with your Mood app data — correlations, not causes.",
      "rep.btn":      "Doctor report",
      "rep.title":    "Doctor Report",
      "rep.over":     "Overview",
      "rep.periods":  "Period log",
      "rep.var":      "Cycle variability",
      "rep.days":     "{a}–{b} days between starts",
      "rep.cluster":  "mostly on period days",
      "rep.onper":    "Intakes on period days",
      "rep.notes":    "Notes",
      "rep.disc":     "Self-tracked data, informational only — not a medical diagnosis or advice.",
      "exp.done":     "PDF exported",
      "exp.err":      "PDF library not found (vendor/jspdf missing).",
      "exp.font.err": "Greek font not found (vendor/NotoSans-Regular.ttf) — Greek text may not render in the PDF."
    },
    el: {
      "app.title":     "Κύκλος",
      "tab.cal":       "Ημερολόγιο",
      "tab.days":      "Ημέρες",
      "tab.ins":       "Στατιστικά",
      "cal.prev":      "Προηγούμενος μήνας",
      "cal.next":      "Επόμενος μήνας",
      "cal.today":     "Σήμερα",
      "ci.none":       "Καμία περίοδος καταγεγραμμένη ακόμα",
      "ci.next":       "αναμενόμενη",
      "ci.late":       "~{n} ημέρες αργεί",
      "pred.disc":     "Οι προβλέψεις είναι εκτιμήσεις από τους δικούς σου μέσους όρους — όχι ιατρική συμβουλή, όχι μέθοδος αντισύλληψης.",
      "pred.hint":     "Διακεκομμένες ημέρες = προβλεπόμενη περίοδος (εκτίμηση)",
      "rem.title":     "Υπενθυμίσεις",
      "rem.on":        "Υπενθυμίσεις ενεργές",
      "rem.off":       "Υπενθυμίσεις ανενεργές",
      "rem.soon":      "Η περίοδος αναμένεται σε ~{n} ημέρες",
      "rem.late":      "Η περίοδος φαίνεται να αργεί — αναμενόταν πριν ~{n} ημέρες",
      "ci.cycle":      "Ημέρα {n} του κύκλου",
      "ci.in":         "Ημέρα {n} της περιόδου",
      "dg.back":       "Πίσω στο ημερολόγιο",
      "dg.sofar":      "Ημέρα {n}",
      "per.title":     "Περίοδος",
      "per.start":     "Έναρξη περιόδου",
      "per.endhere":   "Λήξη περιόδου εδώ",
      "per.remove":    "Αφαίρεση περιόδου",
      "per.ongoing":   "Σε εξέλιξη",
      "per.flow":      "Ροή",
      "flow.1":        "Ελαφριά",
      "flow.2":        "Κανονική",
      "flow.3":        "Βαριά",
      "sym.title":     "Συμπτώματα",
      "sym.none":      "Κανένα",
      "sym.add":       "Προσθήκη…",
      "sym.add.ph":    "Νέο σύμπτωμα…",
      "sym.manage":    "Διαχείριση…",
      "med.title":     "Ανακούφιση πόνου",
      "med.take":      "Λήψη",
      "med.log":       "Λήψεις σήμερα",
      "med.add":       "Προσθήκη…",
      "med.add.ph":    "Νέο φάρμακο…",
      "med.manage":    "Διαχείριση…",
      "med.none":      "Καμία λήψη ακόμα",
      "med.at":        "στις {h}",
      "note.title":    "Σημειώσεις (προαιρετικό)",
      "save":          "Αποθήκευση ημέρας",
      "saved.toast":   "Αποθηκεύτηκε",
      "del.done":      "Διαγράφηκε",
      "del.undo":      "Αναίρεση",
      "days.title":    "Ημέρες με καταγραφή",
      "day.edit":      "Επεξεργασία ημέρας",
      "day.del":       "Διαγραφή ημέρας",
      "days.search":   "Αναζήτηση ημερών…",
      "days.empty":    "Καμία ημέρα με καταγραφή ακόμα — θα εμφανιστούν εδώ μετά την πρώτη καταγραφή.",
      "cal.empty":     "Πάτησε μια ημέρα για καταγραφή",
      "ins.empty":     "Καμία περίοδος καταγεγραμμένη ακόμα — τα στατιστικά θα εμφανιστούν με τον πρώτο κύκλο.",
      "ins.rall":      "Όλα",
      "ins.r6":        "6 μήνες",
      "ins.need3":     "Χρειάζονται τουλάχιστον 2 περίοδοι για μέσο κύκλο.",
      "ins.avg.cycle": "Μέσος κύκλος",
      "ins.avg.per":   "Μέση περίοδος",
      "ins.periods":   "Περίοδοι καταγεγραμμένες",
      "ins.sym.title": "Συχνότερα συμπτώματα",
      "ins.med.title": "Λήψεις παυσίπονων",
      "ins.days.n":    "{n} ημέρες",
      "ins.ctx.none":  "Τίποτα καταγεγραμμένο σε αυτό το εύρος.",
      "col.menu.rename": "Μετονομασία",
      "col.menu.del":    "Διαγραφή",
      "col.dup":         "Υπάρχει ήδη αυτή η τιμή",
      "col.renamed":     "Μετονομάστηκε",
      "col.del.done":    "Διαγράφηκε",
      "col.del.undo":    "Αναίρεση",
      "rst.btn":       "Επαναφορά εργοστασιακών",
      "rst.body1":     "Θα διαγραφούν ΟΛΑ τα δεδομένα κύκλου — περίοδοι, συμπτώματα, φάρμακα, σημειώσεις και custom τιμές — από κάθε συγχρονισμένη συσκευή. Χωρίς αναίρεση.",
      "rst.yes1":      "Συνέχεια",
      "rst.body2":     "Τελευταία ευκαιρία: κάθε περίοδος, καταγραφή ημέρας, custom σύμπτωμα και φάρμακο, και όλα τα στατιστικά που βασίζονται σε αυτά σβήνουν. Δεν γίνεται αναίρεση.",
      "rst.yes2":      "Σβήσε τα όλα",
      "rst.cancel":    "Ακύρωση",
      "rst.done":      "Καθαρή αρχή — όλα διαγράφτηκαν",
      "sync.pull":     "Ενημερώθηκε από συγχρονισμό",
      "per.warn":      "Επικαλύπτει άλλη περίοδο — δεν αποθηκεύτηκε",
      "xm.title":      "Διάθεση στις ημέρες περιόδου",
      "xm.dur":        "Ημέρες περιόδου",
      "xm.oth":        "Άλλες ημέρες",
      "xm.tr":         "Στις ημέρες περιόδου νιώθεις συχνότερα {e} (+{d}pt από τις άλλες ημέρες).",
      "xm.pos":        "Ποσοστό καταχωρήσεων με θετικά συναισθήματα (χαρούμενος · ήρεμος · ενθουσιασμένος)",
      "xm.disc":       "Παρατηρητική σύγκριση με τα δεδομένα της εφαρμογής Διάθεση — συσχετίσεις, όχι αιτιότητες.",
      "rep.btn":       "Αναφορά γιατρου",
      "rep.title":     "Αναφορά γιατρού",
      "rep.over":      "Επισκόπηση",
      "rep.periods":   "Κατάλογος περιόδων",
      "rep.var":       "Μεταβλητότητα κύκλου",
      "rep.days":      "{a}–{b} ημέρες μεταξύ εναρτήσεων",
      "rep.cluster":   "κυρίως σε ημέρες περιόδου",
      "rep.onper":     "Λήψεις σε ημέρες περιόδου",
      "rep.notes":     "Σημειώσεις",
      "rep.disc":      "Δεδομένα αυτο-καταγραφής, μόνο ενημερωτικά — όχι ιατρική διάγνωση ή συμβουλή.",
      "exp.done":      "Το PDF εξήχθη",
      "exp.err":       "Δεν βρέθηκε η βιβλιοθήκη PDF (λείπει το vendor/jspdf).",
      "exp.font.err":  "Δεν βρέθηκε η ελληνική γραμματοσειρά (vendor/NotoSans-Regular.ttf) — τα ελληνικά μπορεί να μη φανούν στο PDF."
    }
  };

  function t(key) {
    var p = STRINGS[LANG] || STRINGS.en;
    return p[key] !== undefined ? p[key]
         : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
  }

  // Symptom presets — bilingual seeds, editable and deletable by
  // the user AFTER birth (they live in STATE once seeded, not in
  // this constant). Bilingual ids (bi) so a Greek device and an
  // English device converge to the SAME chip after sync.
  var SYM_SEED = [
    { en: "Cramps",            el: "Σπασμοί" },
    { en: "Headache",          el: "Πονοκέφαλος" },
    { en: "Migraine",          el: "Ημικρανία" },
    { en: "Nausea",            el: "Ναυτία" },
    { en: "Breast tenderness", el: "Ευαισθησία στήθους" },
    { en: "Back pain",         el: "Πόνος στη μέση" },
    { en: "Fatigue",           el: "Κούραση" },
    { en: "Acne",              el: "Ακμή" },
    { en: "Bloating",          el: "Φούσκωμα" },
    { en: "Mood swings",       el: "Ακαθοριστία διάθεσης" },
    { en: "Insomnia",          el: "Αϋπνία" }
  ];

  // Pain-relief presets — same vocabulary model as symptoms.
  var MED_SEED = [
    { en: "Paracetamol", el: "Παρακεταμόλη" },
    { en: "Ibuprofen",   el: "Ιβουπροφαίνη" },
    { en: "Naproxen",    el: "Ναπροξένη" },
    { en: "Heat pad",    el: "Θερμοφόρα" }
  ];

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function $(id) { return document.getElementById(id); }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Local-calendar day keys — the CLOCK of the whole app. Both
  // directions deterministic: ts ↔ "YYYY-MM-DD" local midnight.
  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function dayTsFromKey(k) {
    var p = k.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]).getTime();
  }
  var DAY_MS = 24 * 60 * 60 * 1000;

  // ---------- 2. Data model + storage ----------
  // state = {
  //   ver: 1, sm, om,
  //   periods: [{ id, start, end|null, flow: 1|2|3, mtime }],
  //            start/end = LOCAL MIDNIGHT ms; end null = ongoing
  //   days:    [{ id: "d-YYYY-MM-DD", day, mtime, sym: [colIds],
  //              meds: [{ id, med, at }], note }],
  //            DETERMINISTIC ids: two devices logging the same
  //            calendar day converge through the union-by-id
  //            merge instead of duplicating (same spirit as the
  //            mood seed ids — no coincidence unions)
  //   cols:    { sym: [{id, label, bi, mtime, pos}],
  //              med: [{id, label, bi, mtime, pos}] },
  //   deleted: { <periodId|dayId|colValId|medIntakeId>: ts }
  // }
  var state = null;

  function newState() {
    var s = {
      ver: DATA_VER, sm: Date.now(), om: Date.now(),
      periods: [], days: [], deleted: {},
      cols: { sym: [], med: [] },
      prefs: { remind: true }
    };
    // Seeds — ONCE per fresh install; deterministic ids so two
    // fresh installs that sync do NOT union into duplicate chips
    s.cols.sym = SYM_SEED.map(function (v, i) {
      return { id: "seed-sym-" + i, label: LANG === "el" ? v.el : v.en,
               bi: { en: v.en, el: v.el }, mtime: 0, pos: i };
    });
    s.cols.med = MED_SEED.map(function (v, i) {
      return { id: "seed-med-" + i, label: LANG === "el" ? v.el : v.en,
               bi: { en: v.en, el: v.el }, mtime: 0, pos: i };
    });
    return s;
  }

  function migrate(data) {
    if (!data || typeof data !== "object") return null;
    if (!Array.isArray(data.periods) || !Array.isArray(data.days)) return null;
    if (!data.cols || !Array.isArray(data.cols.sym)) data.cols = { sym: [], med: [] };
    if (!Array.isArray(data.cols.med)) data.cols.med = [];
    if (!data.deleted || typeof data.deleted !== "object") data.deleted = {};
    if (typeof data.sm !== "number") data.sm = 0;
    if (typeof data.om !== "number") data.om = 0;
    if (!data.prefs || typeof data.prefs !== "object") data.prefs = { remind: true };
    if (typeof data.prefs.remind !== "boolean") data.prefs.remind = true;

    data.periods.forEach(function (p) {
      if (typeof p.start !== "number") p.start = 0;
      if (p.end !== null && typeof p.end !== "number") p.end = null;
      if (p.end !== null && p.end < p.start) p.end = null;   // sanity
      if (p.flow !== 1 && p.flow !== 2 && p.flow !== 3) p.flow = 2;
      if (typeof p.mtime !== "number") p.mtime = 0;
      p.start = dayTsFromKey(dayKey(p.start));                 // snap to midnight
      if (p.end !== null) p.end = dayTsFromKey(dayKey(p.end));
    });

    data.days.forEach(function (d) {
      if (!Array.isArray(d.sym)) d.sym = [];
      if (!Array.isArray(d.meds)) d.meds = [];
      if (!d.note) d.note = "";
      if (typeof d.day !== "number") d.day = dayTsFromKey(d.id.replace(/^d-/, ""));
      if (typeof d.mtime !== "number") d.mtime = 0;
      d.meds = d.meds.filter(function (m) { return m && m.id && m.med; });
    });

    data.cols.sym.concat(data.cols.med).forEach(function (v) {
      if (typeof v.mtime !== "number") v.mtime = 0;
      if (typeof v.pos !== "number") v.pos = 0;
      if (typeof v.label !== "string" || !v.label) v.label = "?";
    });

    // deterministic day ids — a legacy nondeterministic id
    // regenerates from its own date; content survives
    data.days.forEach(function (d) {
      var want = "d-" + dayKey(d.day);
      if (d.id !== want) d.id = want;
    });

    data.ver = DATA_VER;
    return data;
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = migrate(JSON.parse(raw));
        if (data) { state = data; return; }
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

  // ---- lookups ----
  function periodById(id) {
    for (var i = 0; i < state.periods.length; i++) {
      if (state.periods[i].id === id) return state.periods[i];
    }
    return null;
  }
  function dayById(id) {
    for (var i = 0; i < state.days.length; i++) {
      if (state.days[i].id === id) return state.days[i];
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
  // the period covering a given day (start ≤ day ≤ end|null-∞)
  function periodCovering(ts) {
    var found = null;
    state.periods.forEach(function (p) {
      var end = (p.end === null) ? Infinity : p.end;
      if (ts >= p.start && ts <= end) found = p;
    });
    return found;
  }

  // Bilingual display label — same contract as mood.js (B2):
  // seeds render in the ACTIVE language; hand-renamed values
  // have no bi and render their typed label.
  function colLabel(v) {
    if (!v) return "";
    if (v.bi && v.bi[LANG]) return v.bi[LANG];
    return v.label;
  }

  // ---------- 2b. Merge engine (deterministic + symmetric) ----------
  // merge(A,B) === merge(B,A) — the todo/mood contract, adapted:
  //   · periods  — union by uid, whole-object LWW by mtime
  //                (a period is ONE atomic decision; partial
  //                day-granular merging would lie about intent)
  //   · days     — union by DETERMINISTIC date id, whole-object
  //                LWW by mtime (the day is the atomic unit)
  //   · columns  — union by id, LWW; label-normalized dedupe
  //                (pre-deterministic-id installs converge)
  //   · tombstones — union with max ts; newer mtime resurrects
  //   · ordering — days = ASC day (a calendar has exactly ONE
  //                natural order); column values = om-larger
  //                side donates positions
  // MED INTAKES: nested inside days (whole-day LWW). A delete
  // of one intake is a day edit (fresh mtime wins the whole
  // day) — honest, and trivially merge-safe at Wave 1 scale.

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

  function normLabel(s) {
    return String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");
  }

  function dedupeCols(cols, days) {
    var remap = {};
    ["sym", "med"].forEach(function (name) {
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
      days.forEach(function (d) {
        (d.sym || []).forEach(function (sid, i) {
          if (remap[sid]) d.sym[i] = remap[sid];
        });
        (d.meds || []).forEach(function (m) {
          if (m.med && remap[m.med]) m.med = remap[m.med];
        });
      });
    }
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

  function mergeCycleStates(A, B) {
    var a = A || {}, b = B || {};

    var tomb = {};
    Object.keys(a.deleted || {}).forEach(function (id) { tomb[id] = a.deleted[id]; });
    Object.keys(b.deleted || {}).forEach(function (id) {
      tomb[id] = Math.max(tomb[id] || 0, b.deleted[id]);
    });

    var periods = mergeUnionList(a.periods, b.periods, tomb)
      .sort(function (x, y) { return y.start - x.start; });   // newest first

    var days = mergeUnionList(a.days, b.days, tomb)
      .sort(function (x, y) { return x.day - y.day; });       // calendar order

    var omSideIsA = (a.om || 0) >= (b.om || 0);
    var cols = {};
    cols.sym = mergeUnionList((a.cols || {}).sym, (b.cols || {}).sym, tomb);
    cols.med = mergeUnionList((a.cols || {}).med, (b.cols || {}).med, tomb);
    dedupeCols(cols, days);
    sortColVals(cols.sym, omSideIsA, (a.cols || {}).sym, (b.cols || {}).sym);
    sortColVals(cols.med, omSideIsA, (a.cols || {}).med, (b.cols || {}).med);

    return {
      ver: DATA_VER,
      sm: Math.max(a.sm || 0, b.sm || 0),
      om: Math.max(a.om || 0, b.om || 0),
      periods: periods,
      days: days,
      cols: cols,
      prefs: (omSideIsA ? a : b).prefs || { remind: true },
      deleted: tomb
    };
  }

  // ---------- 3. Calendar view + day editor + days list ----------

  // Lazy toast (mood/weather pattern — this page ships no toast node)
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
    toastEl.textContent = "";
    toastEl.appendChild(document.createTextNode(text));

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
      toastEl.appendChild(toastAction);
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
    if (toastAction) { toastAction.remove(); toastAction = null; }
    toastEl.textContent = "";
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
    var tomb = {};
    Object.keys(state.deleted || {}).forEach(function (id) {
      tomb[id] = state.deleted[id];
    });
    state.periods.forEach(function (p) { tomb[p.id] = now; });
    state.days.forEach(function (d) { tomb[d.id] = now; });
    ["sym", "med"].forEach(function (c) {
      (state.cols[c] || []).forEach(function (v) { tomb[v.id] = now; });
    });
    var fresh = newState();
    ["sym", "med"].forEach(function (c) {
      (fresh.cols[c] || []).forEach(function (v) { v.mtime = now + 1; });
    });
    fresh.deleted = tomb;               // tombstones travel, merge-proof
    fresh.sm = now; fresh.om = now;
    state = fresh;
    save();
    searchQ = "";
    calMonth = null;
    openDay = null;
    renderAll();
    showToast(t("rst.done"));
  }

  // ---- view state (never persisted) ----
  var viewMode = "calendar";            // "calendar" | "days" | "insights"
  var calMonth = null;                  // null = current month
  var openDay = null;                   // "d-YYYY-MM-DD" | null
  var managing = false;                // chip management mode (rename/delete)
  var searchQ = "";

  function showTab(tab) {
    viewMode = tab;
    openDay = null;                     // leaving the editor resets it
    applyView();
  }

  function applyView() {
    var cal = $("calview"), dl = $("dayslist"),
        ci = $("cycleinfo"), ins = $("insights"), dv = $("dayview");
    var b1 = $("cal-btn"), b2 = $("day-btn"), b3 = $("ins-btn");
    var inEditor = (viewMode === "calendar" && openDay !== null);
    if (cal) cal.hidden = (viewMode !== "calendar") || inEditor;
    if (dv)  dv.hidden  = !inEditor;
    if (ci)  ci.hidden  = (viewMode !== "calendar") || inEditor ||
                          !(state.periods.length || state.days.length);
    if (dl)  dl.hidden  = (viewMode !== "days");
    if (ins) ins.hidden = (viewMode !== "insights");
    [[b1, viewMode === "calendar"],
     [b2, viewMode === "days"],
     [b3, viewMode === "insights"]].forEach(function (p) {
      if (!p[0]) return;
      p[0].classList.toggle("on", p[1]);
      p[0].setAttribute("aria-pressed", p[1] ? "true" : "false");
      p[0].setAttribute("title",
        p[0] === b1 ? t("tab.cal") :
        p[0] === b2 ? t("tab.days") : t("tab.ins"));
    });
    if (viewMode === "insights") {
      renderInsights();
    } else if (viewMode === "days") {
      renderDaysList();
    } else if (inEditor) {
      renderDayEditor(openDay);
    } else {
      renderCalendar();
      renderCycleInfo();
    }
  }

  // ---- derived cycle math (render-side only; predictions are
  //      Wave 2 — this is REPORTING, not forecasting) ----
  // periods sorted newest-start first (merge guarantees it)
  function sortedPeriods() {
    return state.periods.slice()
      .sort(function (a, b) { return b.start - a.start; });
  }
  // avg cycle length = mean gap between CONSECUTIVE starts,
  // needs ≥2 starts. Null until then — honesty over guessing.
  function avgCycleLen() {
    var ps = sortedPeriods().slice().reverse();   // oldest first
    if (ps.length < 2) return null;
    var gaps = [];
    for (var i = 1; i < ps.length; i++) {
      gaps.push(Math.round((ps[i].start - ps[i - 1].start) / DAY_MS));
    }
    var sum = 0;
    gaps.forEach(function (g) { sum += g; });
    return Math.round(sum / gaps.length);
  }
  function avgPeriodLen() {
    var ps = sortedPeriods().filter(function (p) { return p.end !== null; });
    if (ps.length < 1) return null;
    var sum = 0;
    ps.forEach(function (p) {
      sum += Math.round((p.end - p.start) / DAY_MS) + 1;   // inclusive
    });
    return Math.round(sum / ps.length);
  }

  // ---------- predictions (Wave 2) ----------
  // An ESTIMATE built from the user's OWN history: next start =
  // last start + avg cycle length; window = avg period length.
  // Render-time derived only — never stored, never authoritative,
  // and always escorted by the disclaimer (pred.disc).
  function nextPrediction() {
    var avg = avgCycleLen();
    if (avg === null) return null;
    var last = sortedPeriods()[0];
    var len = avgPeriodLen();
    if (len === null) len = 5;   // no ended period in history yet
    var start = last.start + avg * DAY_MS;
    return { start: start, end: start + (len - 1) * DAY_MS, avg: avg };
  }
  function dayInPrediction(ts) {
    var pr = nextPrediction();
    return !!pr && ts >= pr.start && ts <= pr.end;
  }

  // Reminder at app open: soon (≤2 days) or overdue. Toast only —
  // no native notifications (R14 spirit), no timer while closed.
  function maybeRemind() {
    if (!state.prefs || !state.prefs.remind) return;
    var pr = nextPrediction();
    if (!pr) return;
    var daysLeft = Math.ceil((pr.start - todayTs()) / DAY_MS);
    if (daysLeft > 2) return;
    if (daysLeft >= 0) {
      showToast(t("rem.soon").replace("{n}", Math.max(1, daysLeft)));
    } else {
      showToast(t("rem.late").replace("{n}", -daysLeft));
    }
  }

  // Cycle info strip — where you are RIGHT NOW. Facts only.
  function renderCycleInfo() {
    var host = $("cycleinfo");
    if (!host) return;
    host.innerHTML = "";
    var ps = sortedPeriods();
    if (!ps.length) {
      if (!state.days.length) { host.hidden = true; return; }
      host.hidden = false;
      host.textContent = t("ci.none");
      return;
    }
    host.hidden = false;
    var last = ps[0];
    var cov = periodCovering(new Date().setHours(0, 0, 0, 0));
    if (cov) {
      var n = Math.round((todayTs() - cov.start) / DAY_MS) + 1;
      host.innerHTML =
        '<span class="ci-big">' + n + "</span> " +
        esc(t("ci.in").replace("{n}", "")) +
        (cov.end === null ? " · " + esc(t("per.ongoing")) : "");
      return;
    }
    var dnum = Math.round((todayTs() - last.start) / DAY_MS) + 1;
    var html =
      '<span class="ci-big">' + dnum + "</span> " +
      esc(t("ci.cycle").replace("{n}", ""));
    var pr = nextPrediction();
    if (pr) {
      var daysLeft = Math.ceil((pr.start - todayTs()) / DAY_MS);
      if (daysLeft >= 0) {
        html += ' · <span class="dim">' + esc(t("ci.next")) +
          " ~" + daysLeft + "</span>";
      } else {
        html += ' · <span class="dim">' +
          esc(t("ci.late").replace("{n}", -daysLeft)) + "</span>";
      }
    }
    host.innerHTML = html;
  }
  function todayTs() {
    var d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  // ---------- calendar ----------
  function renderCalendar() {
    var host = $("calview");
    if (!host) return;
    host.innerHTML = "";

    var now = new Date();
    var base = calMonth ? new Date(calMonth.y, calMonth.m, 1) :
      new Date(now.getFullYear(), now.getMonth(), 1);

    // month header: ‹ month year › + Today
    var head = document.createElement("div");
    head.className = "cal-head";
    var prev = document.createElement("button");
    prev.type = "button";
    prev.className = "cal-nav";
    prev.textContent = "‹";
    prev.setAttribute("aria-label", t("cal.prev"));
    prev.addEventListener("click", function () {
      calMonth = { y: base.getFullYear() - (base.getMonth() === 0 ? 1 : 0),
                   m: base.getMonth() === 0 ? 11 : base.getMonth() - 1 };
      renderCalendar();
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
    next.setAttribute("aria-label", t("cal.next"));
    next.addEventListener("click", function () {
      calMonth = { y: base.getFullYear() + (base.getMonth() === 11 ? 1 : 0),
                   m: base.getMonth() === 11 ? 0 : base.getMonth() + 1 };
      renderCalendar();
    });
    head.appendChild(next);
    if (calMonth) {
      var td = document.createElement("button");
      td.type = "button";
      td.className = "cal-today";
      td.textContent = t("cal.today");
      td.addEventListener("click", function () {
        calMonth = null;
        renderCalendar();
      });
      head.appendChild(td);
    }
    host.appendChild(head);

    // weekday header (Mon-first, locale names — mood calendar contract)
    var wk = document.createElement("div");
    wk.className = "cal-wk";
    for (var i = 0; i < 7; i++) {
      var wd = document.createElement("span");
      wd.textContent = new Date(2024, 0, 1 + i)
        .toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB",
          { weekday: "narrow" });
      wk.appendChild(wd);
    }
    host.appendChild(wk);

    // day index: which day-record exists (for the accent mark)
    var dayMap = {};
    state.days.forEach(function (d) { dayMap[d.id] = d; });

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
      var ts = dt.getTime();
      var dk = "d-" + dayKey(ts);
      var cell = document.createElement("button");
      cell.type = "button";
      var per = periodCovering(ts);
      // an ongoing period never paints FUTURE days — the grid
      // would read as "bleeding forever". Render-side only:
      // periodCovering itself stays untouched.
      if (per && per.end === null && ts > todayTs()) per = null;
      var cls = "cal-cell";
      if (per) cls += " per" + per.flow;
      else if (dayInPrediction(ts)) cls += " pred";
      if (dk === "d-" + todayK) cls += " today";
      cell.className = cls;

      var num = document.createElement("span");
      num.className = "cal-d";
      num.textContent = String(d2);
      cell.appendChild(num);
      if (per) {
        num.style.color = "#e06c75";
        num.style.fontWeight = "700";
      }

      if (dayMap[dk]) {
        var mk = document.createElement("span");
        mk.className = "cal-mark";
        cell.appendChild(mk);
      } else {
        var nm = document.createElement("span");
        nm.className = "cal-nomark";
        cell.appendChild(nm);
      }

      (function (dayId) {
        cell.addEventListener("click", function () {
          openDay = dayId;
          managing = false;
          applyView();
        });
      })(dk);
      grid.appendChild(cell);
    }
    host.appendChild(grid);

    // hint line — teaches the single gesture this view has
    if (!state.days.length && !state.periods.length) {
      var hl = document.createElement("div");
      hl.className = "hint";
      hl.style.textAlign = "center";
      hl.style.marginTop = "12px";
      hl.textContent = t("cal.empty");
      host.appendChild(hl);
    }

    // prediction legend — only when there IS a prediction
    if (nextPrediction()) {
      var lg = document.createElement("div");
      lg.className = "hint";
      lg.style.textAlign = "center";
      lg.style.marginTop = "12px";
      lg.textContent = t("pred.hint");
      host.appendChild(lg);
    }

    // reminder toggle — always visible (a setting for the future
    // too), sync-scoped through state.prefs
    var rt = document.createElement("button");
    rt.type = "button";
    rt.className = "chip ghost" + (state.prefs.remind ? " on" : "");
    rt.style.margin = "14px auto 0";
    rt.style.display = "flex";
    rt.style.alignItems = "center";
    rt.style.gap = "6px";
    rt.title = t("rem.title");
    rt.setAttribute("aria-pressed", state.prefs.remind ? "true" : "false");
    rt.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">' +
      '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>' +
      '<path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>' +
      "<span></span>";
    rt.lastChild.textContent =
      state.prefs.remind ? t("rem.on") : t("rem.off");
    rt.addEventListener("click", function () {
      state.prefs.remind = !state.prefs.remind;
      state.sm = Date.now();
      state.om = Date.now();   // prefs resolve by om-donor in merge —
                               // a prefs edit MUST travel through om
      save();
      renderCalendar();
    });
    host.appendChild(rt);
  }

  // ---------- day editor ----------
  function renderDayEditor(dayId) {
    var host = $("dayview");
    if (!host) return;
    host.innerHTML = "";

    var ts = dayTsFromKey(dayId.replace(/^d-/, ""));
    var rec = dayById(dayId);
    var per = periodCovering(ts);

    // back + date title
    var dh = document.createElement("div");
    dh.id = "dayhead";
    var back = document.createElement("button");
    back.type = "button";
    back.className = "backbtn";
    back.textContent = "‹";
    back.setAttribute("aria-label", t("dg.back"));
    back.addEventListener("click", function () {
      openDay = null;
      applyView();
    });
    dh.appendChild(back);
    var ttl = document.createElement("span");
    ttl.textContent = new Date(ts).toLocaleDateString(
      LANG === "el" ? "el-GR" : "en-GB",
      { weekday: "long", day: "numeric", month: "long" });
    dh.appendChild(ttl);
    host.appendChild(dh);

    // ---- Period section ----
    var ph = document.createElement("h2");
    ph.className = "sec-title";
    ph.textContent = t("per.title");
    host.appendChild(ph);

    if (per) {
      // inside a period: flow chips (edit the WHOLE period —
      // Wave 1 granularity: flow is a period-level property),
      // end-here, remove
      var fl = document.createElement("div");
      fl.className = "chips";
      [1, 2, 3].forEach(function (f) {
        var c = document.createElement("button");
        c.type = "button";
        c.className = "chip flow" + (per.flow === f ? " on" : "");
        c.textContent = t("flow." + f);
        c.setAttribute("aria-pressed", per.flow === f ? "true" : "false");
        c.addEventListener("click", function () {
          if (per.flow === f) return;
          per.flow = f;
          per.mtime = Date.now();
          state.sm = Date.now();
          save();
          buildEditorChromeless();
        });
        fl.appendChild(c);
      });
      host.appendChild(fl);

      var since = Math.round((ts - per.start) / DAY_MS) + 1;
      var fh = document.createElement("div");
      fh.className = "hint";
      fh.style.margin = "6px 2px 0";
      fh.textContent = t("dg.sofar").replace("{n}", since) +
        (per.end === null ? " · " + t("per.ongoing") : "");
      host.appendChild(fh);

      var perActs = document.createElement("div");
      perActs.className = "acts";

      if (per.end === null && ts < todayTs()) {
        var endHere = document.createElement("button");
        endHere.type = "button";
        endHere.className = "ghost";
        endHere.textContent = t("per.endhere");
        endHere.addEventListener("click", function () {
          per.end = ts;
          per.mtime = Date.now();
          state.sm = Date.now();
          save();
          buildEditorChromeless();
          showToast(t("saved.toast"));
        });
        perActs.appendChild(endHere);
      }
      if (per.end !== null && ts === per.end && per.end !== per.start) {
        var extHere = document.createElement("button");
        extHere.type = "button";
        extHere.className = "ghost";
        extHere.textContent = t("per.endhere");
        extHere.addEventListener("click", function () {
          per.end = ts + DAY_MS;
          per.mtime = Date.now();
          state.sm = Date.now();
          save();
          buildEditorChromeless();
          showToast(t("saved.toast"));
        });
        perActs.appendChild(extHere);
      }
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "prim danger";
      rm.textContent = t("per.remove");
      rm.addEventListener("click", function () {
        removePeriod(per.id);
      });
      perActs.appendChild(rm);
      host.appendChild(perActs);
    } else {
      // not in a period: start one HERE (overlap-guarded)
      var st = document.createElement("button");
      st.type = "button";
      st.className = "prim big";
      st.style.marginTop = "6px";
      st.textContent = t("per.start");
      st.addEventListener("click", function () {
        startPeriodAt(ts);
      });
      host.appendChild(st);
    }

    // ---- Symptoms (multi-select chips + None-less: absence =
    //      unmarked. Same vocabulary model as mood columns) ----
    var sh = document.createElement("h2");
    sh.className = "sec-title";
    sh.textContent = t("sym.title");
    host.appendChild(sh);

    var syms = (rebuildDraft && openDay === dayId)
      ? rebuildDraft.sym.slice()
      : (rec ? (rec.sym || []).slice() : []);
    rebuildDraft = null;
    var symChips = document.createElement("div");
    symChips.className = "chips";
    (state.cols.sym || []).forEach(function (v) {
      var c = document.createElement("button");
      c.type = "button";
      c.className = "chip" + (managing ? " mgmt" : "") +
        (syms.indexOf(v.id) >= 0 ? " on" : "");
      c.textContent = colLabel(v);
      c.addEventListener("click", function (ev) {
        if (managing) {
          ev.stopPropagation();
          openChipMenu("sym", v, c.getBoundingClientRect());
          return;
        }
        var i = syms.indexOf(v.id);
        if (i >= 0) syms.splice(i, 1); else syms.push(v.id);
        buildEditorChromeless();   // re-render without losing note
      });
      attachChipMenu(c, "sym", v);
      symChips.appendChild(c);
    });
    host.appendChild(symChips);

    var sAddRow = document.createElement("div");
    sAddRow.className = "addrow";
    var sAddIn = document.createElement("input");
    sAddIn.type = "text";
    sAddIn.placeholder = t("sym.add.ph");
    sAddIn.maxLength = 40;
    sAddIn.setAttribute("aria-label", t("sym.add"));
    var sAddBtn = document.createElement("button");
    sAddBtn.type = "button";
    sAddBtn.className = "prim";
    sAddBtn.textContent = t("sym.add");
    sAddBtn.addEventListener("click", function () {
      commitColVal("sym", sAddIn, function (nv) {
        syms.push(nv.id);
        buildEditorChromeless();
      });
    });
    sAddIn.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        commitColVal("sym", sAddIn, function (nv) {
          syms.push(nv.id);
          buildEditorChromeless();
        });
      }
    });
    sAddRow.appendChild(sAddIn); sAddRow.appendChild(sAddBtn);
    host.appendChild(sAddRow);

    var sMgmt = document.createElement("button");
    sMgmt.type = "button";
    sMgmt.className = "chip ghost" + (managing ? " on" : "");
    sMgmt.style.marginTop = "6px";
    sMgmt.textContent = t("sym.manage");
    sMgmt.addEventListener("click", function () {
      managing = !managing;
      buildEditorChromeless();
    });
    host.appendChild(sMgmt);

    // ---- Meds: take chips + timestamped intake log ----
    var mh = document.createElement("h2");
    mh.className = "sec-title";
    mh.textContent = t("med.title");
    host.appendChild(mh);

    // (kept as [] when no record yet — the TAKE below creates it)

    var medChips = document.createElement("div");
    medChips.className = "chips";
    (state.cols.med || []).forEach(function (v) {
      var c = document.createElement("button");
      c.type = "button";
      c.className = "chip" + (managing ? " mgmt" : "");
      c.textContent = colLabel(v);
      c.title = t("med.take");
      c.addEventListener("click", function (ev) {
        if (managing) {
          ev.stopPropagation();
          openChipMenu("med", v, c.getBoundingClientRect());
          return;
        }
        takeMed(ts, v.id);   // stamps NOW into THIS day's log
        buildEditorChromeless();
      });
      attachChipMenu(c, "med", v);
      medChips.appendChild(c);
    });
    host.appendChild(medChips);

    var mAddRow = document.createElement("div");
    mAddRow.className = "addrow";
    var mAddIn = document.createElement("input");
    mAddIn.type = "text";
    mAddIn.placeholder = t("med.add.ph");
    mAddIn.maxLength = 40;
    mAddIn.setAttribute("aria-label", t("med.add"));
    var mAddBtn = document.createElement("button");
    mAddBtn.type = "button";
    mAddBtn.className = "prim";
    mAddBtn.textContent = t("med.add");
    mAddBtn.addEventListener("click", function () {
      commitColVal("med", mAddIn, function (nv) {
        takeMed(ts, nv.id);
        buildEditorChromeless();
      });
    });
    mAddIn.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        commitColVal("med", mAddIn, function (nv) {
          takeMed(ts, nv.id);
          buildEditorChromeless();
        });
      }
    });
    mAddRow.appendChild(mAddIn); mAddRow.appendChild(mAddBtn);
    host.appendChild(mAddRow);

    var mMgmt = document.createElement("button");
    mMgmt.type = "button";
    mMgmt.className = "chip ghost" + (managing ? " on" : "");
    mMgmt.style.marginTop = "6px";
    mMgmt.textContent = t("med.manage");
    mMgmt.addEventListener("click", function () {
      managing = !managing;
      buildEditorChromeless();
    });
    host.appendChild(mMgmt);

    // intake log for THIS day
    var mlHost = document.createElement("div");
    mlHost.className = "medlog";
    var lab = document.createElement("div");
    lab.className = "col-lab";
    lab.textContent = t("med.log");
    mlHost.appendChild(lab);
    var mlist = document.createElement("div");
    var entries = rec ? (rec.meds || []) : [];
    if (!entries.length) {
      var none = document.createElement("div");
      none.className = "hint";
      none.textContent = t("med.none");
      mlist.appendChild(none);
    } else {
      entries.slice().sort(function (a, b) { return b.at - a.at; })
        .forEach(function (m) {
          var row = document.createElement("div");
          row.className = "medrow";
          var mv = colValById("med", m.med);
          var nm = document.createElement("span");
          nm.className = "med-name";
          nm.textContent = mv ? colLabel(mv) : "?";
          row.appendChild(nm);
          var wh = document.createElement("span");
          wh.className = "med-when";
          var md = new Date(m.at);
          wh.textContent = t("med.at").replace("{h}",
            pad(md.getHours()) + ":" + pad(md.getMinutes()));
          row.appendChild(wh);
          var del = document.createElement("button");
          del.type = "button";
          del.className = "med-del";
          del.setAttribute("aria-label", t("day.del"));
          del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
          del.addEventListener("click", function () {
            // the intake list belongs to the day record; removing
            // one intake = a day edit (fresh mtime, whole-day LWW)
            var r = dayById(dayId);
            if (!r) return;
            r.meds = r.meds.filter(function (x) { return x.id !== m.id; });
            r.mtime = Date.now();
            pruneIfEmpty(r);
            state.sm = Date.now();
            save();
            refreshInView();
          });
          row.appendChild(del);
          mlist.appendChild(row);
        });
    }
    mlHost.appendChild(mlist);
    host.appendChild(mlHost);

    // ---- Note ----
    var nh = document.createElement("h2");
    nh.className = "sec-title";
    nh.textContent = t("note.title");
    host.appendChild(nh);
    var note = document.createElement("textarea");
    note.id = "fld-note";
    note.rows = 2;
    note.maxLength = 2000;
    note.value = rec ? (rec.note || "") : "";
    host.appendChild(note);

    // ---- Save ----
    var acts = document.createElement("div");
    acts.className = "acts";
    var saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "prim big";
    saveBtn.textContent = t("save");
    saveBtn.addEventListener("click", function () { saveDay(dayId); });
    acts.appendChild(saveBtn);
    host.appendChild(acts);

    // held closure state so chromeless rebuilds keep selections
    dayDraft = {
      dayId: dayId, sym: syms, note: note,
      ts: ts
    };
  }

  // draft handle for the editor (rebuilt on chip taps; the
  // textarea value travels through prevNote like mood.js)
  var dayDraft = null;
  // one-shot selection snapshot for chromeless rebuilds — set
  // by buildEditorChromeless, consumed (and cleared) by the
  // next renderDayEditor. Never persists across sessions.
  var rebuildDraft = null;

  // rebuild the editor WITHOUT resetting the note — the mood
  // "buildCapture keep-scroll" contract, adapted: selections
  // travel through rebuildDraft (snapshot of the live array,
  // consumed exactly once by the next render), the note
  // travels via keepNote. rec.sym is NEVER mutated before
  // Save — the draft is the only source of truth while the
  // editor is open.
  function buildEditorChromeless() {
    if (!dayDraft || openDay === null) return;
    var keepNote = $("fld-note") ? $("fld-note").value : "";
    rebuildDraft = { sym: dayDraft.sym.slice() };
    var mm = $("cyclemain");
    var keepScroll = mm ? mm.scrollTop : 0;
    renderDayEditor(openDay);
    if ($("fld-note")) $("fld-note").value = keepNote;
    if (mm) mm.scrollTop = keepScroll;
  }

  // context-aware refresh: in-editor → note-preserving rebuild;
  // editor closed → full renderAll (menu lists, calendar, etc.)
  function refreshInView() {
    if (dayDraft && viewMode === "calendar" && openDay !== null) {
      buildEditorChromeless();
    } else {
      renderAll();
    }
  }

  // Take a medication: NOW-stamped intake in THIS day record.
  // Editing a PAST day logs the time as... NOW (you took it now
  // but remember it for that day — the day you ATTACH it to is
  // the calendar day, the clock never lies about when).
  function takeMed(dayTs_, medId) {
    var id = "d-" + dayKey(dayTs_);
    var rec = dayById(id);
    if (!rec) {
      rec = { id: id, day: dayTsFromKey(dayKey(dayTs_)),
              mtime: Date.now(), sym: [], meds: [], note: "" };
      state.days.push(rec);
    }
    rec.meds.push({ id: uid(), med: medId, at: Date.now() });
    rec.mtime = Date.now();
    state.sm = Date.now();
    state.om = Date.now();
    save();
    showToast(t("saved.toast"));
  }

  // Start period AT a day — OVERLAP-GUARDED: a new period may
  // not intersect any existing one. Single source of rejection.
  function startPeriodAt(ts) {
    var clash = state.periods.some(function (p) {
      var end = (p.end === null) ? Infinity : p.end;
      return ts <= end && (ts + DAY_MS) > p.start;
    });
    if (clash) { showToast(t("per.warn")); return; }
    state.periods.push({
      id: uid(), start: ts, end: null, flow: 2, mtime: Date.now()
    });
    state.sm = Date.now();
    state.om = Date.now();
    save();
    renderAll();
    showToast(t("saved.toast"));
  }

  // Remove period — immediate + undo toast (fresh mtime beats
  // the tombstone: resurrection is legitimate by merge contract)
  function removePeriod(id) {
    var p = periodById(id);
    if (!p) return;
    state.periods = state.periods.filter(function (x) { return x.id !== id; });
    state.deleted[id] = Date.now();
    state.sm = Date.now();
    save();
    openDay = null;
    renderAll();
    showToast(t("del.done"), t("del.undo"), function () {
      p.mtime = Date.now();
      state.periods.push(p);
      delete state.deleted[id];
      state.sm = Date.now();
      save();
      renderAll();
    });
  }

  // Save day — upsert; an empty day record PRUNES itself (and
  // tombstones — a remotely resurrected empty day is garbage).
  function pruneIfEmpty(rec) {
    if (!rec.sym.length && !rec.meds.length && !rec.note) {
      state.days = state.days.filter(function (x) { return x.id !== rec.id; });
      state.deleted[rec.id] = Date.now();
      return true;
    }
    return false;
  }

  function saveDay(dayId) {
    var note = $("fld-note") ? $("fld-note").value.trim() : "";
    var ts = dayTsFromKey(dayId.replace(/^d-/, ""));
    var rec = dayById(dayId);
    var sym = dayDraft ? dayDraft.sym.slice() : [];

    if (!rec) {
      if (!sym.length && !note) {          // nothing to save — nothing saved
        openDay = null;
        applyView();
        return;
      }
      rec = { id: dayId, day: ts, mtime: Date.now(),
              sym: sym, meds: [], note: note };
      state.days.push(rec);
    } else {
      rec.sym = sym;
      rec.note = note;
      rec.mtime = Date.now();
      if (pruneIfEmpty(rec)) {
        state.sm = Date.now();
        save();
        openDay = null;
        renderAll();
        showToast(t("saved.toast"));
        return;
      }
    }
    state.sm = Date.now();
    save();
    renderAll();
    showToast(t("saved.toast"));
  }

  // ---- chip context menu: rename / delete column values ----
  // (verbatim mood contract: long-press / right-click, custom
  //  UI only — no native dialogs, per standing rule)
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
      e.stopPropagation();
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
      if (lpFired) e.preventDefault();
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
    void m.offsetWidth;
    var mw = m.offsetWidth, mh = m.offsetHeight;
    var x = Math.max(8, Math.min(rect.left, window.innerWidth - mw - 8));
    var y = rect.bottom + 6;
    if (y + mh > window.innerHeight - 8) y = Math.max(8, rect.top - mh - 6);
    m.style.left = x + "px";
    m.style.top = y + "px";
    m.style.opacity = "1";
    chipMenu = m;
  }

  function beginChipRename(m, col, v) {
    m.innerHTML = "";
    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "ctxren";
    inp.maxLength = 40;
    inp.value = colLabel(v);
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
    m.addEventListener("click", function (e) { e.stopPropagation(); });
  }

  // rename needs a "discard" key — mood has it via capture flow;
  // here it ships explicitly (same label)
  STRINGS.en["discard"] = "Discard";
  STRINGS.el["discard"] = "Απόρριψη";

  function colLabelExists(col, label, exceptId) {
    var norm = String(label).trim().toLowerCase();
    return (state.cols[col] || []).some(function (o) {
      if (o.id === exceptId) return false;
      return String(o.label).trim().toLowerCase() === norm ||
             String(colLabel(o)).trim().toLowerCase() === norm;
    });
  }

  function applyChipRename(col, v, label) {
    label = String(label).trim().normalize("NFC");
    closeChipMenu();
    if (!label || label === v.label) return;
    if (colLabelExists(col, label, v.id)) { showToast(t("col.dup")); return; }
    v.label = label;
    delete v.bi;   // a hand-renamed value is a CUSTOM value now
    v.mtime = Date.now();
    state.sm = Date.now();
    save();
    refreshInView();
    showToast(t("col.renamed"));
  }

  function deleteColVal(col, v) {
    closeChipMenu();
    state.cols[col] = (state.cols[col] || []).filter(function (x) {
      return x.id !== v.id;
    });
    state.deleted[v.id] = Date.now();
    // day records holding the deleted value: drop the reference
    state.days.forEach(function (d) {
      if (col === "sym" && d.sym) {
        d.sym = d.sym.filter(function (s) { return s !== v.id; });
        d.mtime = Date.now();
      }
      if (col === "med" && d.meds) {
        d.meds = d.meds.filter(function (m) { return m.med !== v.id; });
        d.mtime = Date.now();
      }
    });
    state.sm = Date.now();
    save();
    refreshInView();
    showToast(t("col.del.done"), t("col.del.undo"), function () {
      v.mtime = Date.now();
      state.cols[col].push(v);
      delete state.deleted[v.id];
      state.sm = Date.now();
      save();
      refreshInView();
    });
  }

  function commitColVal(col, input, after) {
    var label = input.value.trim().normalize("NFC");
    if (!label) return;
    if (colLabelExists(col, label, null)) {
      showToast(t("col.dup"));
      return;
    }
    input.value = "";
    var v = { id: uid(), label: label, mtime: Date.now(),
              pos: (state.cols[col] || []).length };
    state.cols[col].push(v);
    state.sm = Date.now();
    state.om = Date.now();
    save();
    after(v);
  }

  // ---------- days list ----------
  function dayHaystack(d) {
    var bits = [];
    bits.push(new Date(d.day).toLocaleDateString(
      LANG === "el" ? "el-GR" : "en-GB",
      { weekday: "short", day: "numeric", month: "short", year: "numeric" }));
    (d.sym || []).forEach(function (sid) {
      var v = colValById("sym", sid);
      if (v) { bits.push(v.label, colLabel(v)); }
    });
    (d.meds || []).forEach(function (m) {
      var v = colValById("med", m.med);
      if (v) { bits.push(v.label, colLabel(v)); }
    });
    bits.push(d.note || "");
    return bits.join(" ").toLowerCase();
  }

  function fillDayRows() {
    var list = $("day-list");
    if (!list) return;
    list.innerHTML = "";
    var q = searchQ.trim().toLowerCase();
    var shown = 0;
    state.days.slice().sort(function (a, b) { return b.day - a.day; })
      .forEach(function (d) {
        if (q && dayHaystack(d).indexOf(q) < 0) return;
        if (shown >= 60) return;
        shown++;

        var li = document.createElement("li");
        li.className = "dayrow";

        var when = document.createElement("span");
        when.className = "dr-when";
        when.textContent = new Date(d.day).toLocaleDateString(
          LANG === "el" ? "el-GR" : "en-GB",
          { weekday: "short", day: "numeric", month: "short" });
        li.appendChild(when);

        var per = periodCovering(d.day);
        if (per) {
          var fd = document.createElement("span");
          fd.className = "dr-flow f" + per.flow;
          fd.title = t("per.title") + " · " + t("flow." + per.flow);
          li.appendChild(fd);
        }

        var ctx = document.createElement("span");
        ctx.className = "dr-ctx";
        var bits = [];
        (d.sym || []).forEach(function (sid) {
          var v = colValById("sym", sid);
          if (v) bits.push(colLabel(v));
        });
        (d.meds || []).forEach(function (m) {
          var v = colValById("med", m.med);
          if (v) bits.push(colLabel(v));
        });
        ctx.textContent = bits.join(" · ");
        li.appendChild(ctx);

        if (d.note) {
          var sn = document.createElement("span");
          sn.className = "dr-note";
          sn.textContent = d.note.length > 90 ?
            d.note.slice(0, 89) + "…" : d.note;
          sn.title = d.note;
          li.appendChild(sn);
        }

        var btns = document.createElement("span");
        btns.className = "dr-btns";
        var eb = document.createElement("button");
        eb.type = "button";
        eb.className = "dr-act";
        eb.title = t("day.edit");
        eb.setAttribute("aria-label", t("day.edit"));
        eb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>';
        eb.addEventListener("click", function () {
          openDay = d.id;
          managing = false;
          viewMode = "calendar";
          applyView();
        });
        btns.appendChild(eb);
        var db = document.createElement("button");
        db.type = "button";
        db.className = "dr-act del";
        db.title = t("day.del");
        db.setAttribute("aria-label", t("day.del"));
        db.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
        db.addEventListener("click", function () { deleteDay(d.id); });
        btns.appendChild(db);
        li.appendChild(btns);

        list.appendChild(li);
      });
  }

  function deleteDay(id) {
    var d = dayById(id);
    if (!d) return;
    state.days = state.days.filter(function (x) { return x.id !== id; });
    state.deleted[id] = Date.now();
    state.sm = Date.now();
    save();
    if (openDay === id) openDay = null;
    renderAll();
    showToast(t("del.done"), t("del.undo"), function () {
      d.mtime = Date.now();
      state.days.push(d);
      delete state.deleted[id];
      state.sm = Date.now();
      save();
      renderAll();
    });
  }

  function renderDaysList() {
    var sec = $("dayslist"), list = $("day-list");
    if (!sec || !list) return;
    var staleEmp = document.getElementById("empty-note");
    if (staleEmp) staleEmp.remove();
    if (!state.days.length) {
      var staleSr = document.getElementById("day-search");
      if (staleSr) staleSr.remove();
      var emp = document.createElement("div");
      emp.id = "empty-note";
      emp.textContent = t("days.empty");
      sec.insertBefore(emp, list);
      list.innerHTML = "";
      return;
    }
    var sr = document.getElementById("day-search");
    if (!sr) {
      sr = document.createElement("input");
      sr.type = "search";
      sr.id = "day-search";
      sr.placeholder = t("days.search");
      sr.value = searchQ;
      sr.setAttribute("aria-label", t("days.search"));
      sr.addEventListener("input", function () {
        searchQ = sr.value;
        fillDayRows();
      });
      sec.insertBefore(sr, list);
    }
    fillDayRows();
  }

  function renderAll() {
    if (viewMode === "calendar" && openDay !== null) {
      renderDayEditor(openDay);
    } else if (viewMode === "calendar") {
      renderCalendar();
      renderCycleInfo();
    } else if (viewMode === "days") {
      renderDaysList();
    }
  }

  // ---------- 3b. Insights view (Wave 1: reporting only) ----------
  // ALL render-time derived — zero new storage keys, zero sync
  // surface. Predictions/fertility windows are Wave 2 and will
  // come WITH their medical disclaimer string (mood's
  // "Private by design" precedent: disclaimers ship WITH the
  // feature, not before it).
  var insRange = 0;                     // 0 = all time | 182 days

  function daysInRange() {
    if (!insRange) return state.days.slice();
    var from = todayTs() - insRange * DAY_MS;
    return state.days.filter(function (d) { return d.day >= from; });
  }
  function periodsInRange() {
    // a period counts if it STARTS inside the window
    if (!insRange) return state.periods.slice();
    var from = todayTs() - insRange * DAY_MS;
    return state.periods.filter(function (p) { return p.start >= from; });
  }

  function renderInsights() {
    var host = $("insights");
    if (!host) return;
    host.innerHTML = "";

    // range selector
    var top = document.createElement("div");
    top.className = "ins-top";
    var rs = document.createElement("div");
    rs.className = "ins-ranges";
    [[182, "ins.r6"], [0, "ins.rall"]].forEach(function (r) {
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
    var pdf = document.createElement("button");
    pdf.type = "button";
    pdf.className = "chip ghost";
    pdf.textContent = t("rep.btn");
    pdf.addEventListener("click", exportDoctorReport);
    top.appendChild(pdf);
    host.appendChild(top);

    if (!state.periods.length && !state.days.length) {
      var em = document.createElement("div");
      em.id = "empty-note";
      em.textContent = t("ins.empty");
      host.appendChild(em);
      appendResetLink(host);
      return;
    }

    // ---- recap card: the three cycle facts ----
    var ps = periodsInRange();
    var avgC = avgCycleLen();           // computed over ALL history —
    var avgP = avgPeriodLen();          // an average is honest only at
                                        // full sample size
    var card = document.createElement("div");
    card.className = "recap-card";
    var ch = document.createElement("div");
    ch.className = "col-lab";
    ch.textContent = t("tab.ins");
    card.appendChild(ch);
    var row = document.createElement("div");
    row.className = "recap-row";
    card.appendChild(row);

    var mkKpi = function (lab, val) {
      var k = document.createElement("div");
      k.className = "recap-kpi";
      var v = document.createElement("div");
      v.className = "recap-val";
      v.textContent = val;
      var l = document.createElement("div");
      l.className = "recap-lab";
      l.textContent = lab;
      k.appendChild(v); k.appendChild(l);
      row.appendChild(k);
    };

    if (avgC !== null) mkKpi(t("ins.avg.cycle"),
      t("ins.days.n").replace("{n}", avgC));
    if (avgP !== null) mkKpi(t("ins.avg.per"),
      t("ins.days.n").replace("{n}", avgP));
    mkKpi(t("ins.periods"), String(ps.length));
    if (avgC === null && state.periods.length < 3) {
      var hint = document.createElement("div");
      hint.className = "hint";
      hint.style.marginTop = "8px";
      hint.textContent = t("ins.need3");
      card.appendChild(hint);
    }
    host.appendChild(card);

    // ---- prediction card: the estimate + its escort ----
    var pr = nextPrediction();
    if (pr) {
      var pc = document.createElement("div");
      pc.className = "recap-card";
      var pl = document.createElement("div");
      pl.className = "col-lab";
      pl.textContent = t("ci.next");
      pc.appendChild(pl);
      var prw = document.createElement("div");
      prw.className = "recap-row";
      var pk = document.createElement("div");
      pk.className = "recap-kpi";
      var pv = document.createElement("div");
      pv.className = "recap-val";
      pv.textContent = new Date(pr.start).toLocaleDateString(
        LANG === "el" ? "el-GR" : "en-GB",
        { weekday: "short", day: "numeric", month: "short" });
      var plb = document.createElement("div");
      plb.className = "recap-lab";
      plb.textContent = t("ins.avg.per") + " ~" +
        (Math.round((pr.end - pr.start) / DAY_MS) + 1) + "d";
      pk.appendChild(pv); pk.appendChild(plb);
      prw.appendChild(pk);
      pc.appendChild(prw);
      var pd = document.createElement("div");
      pd.className = "hint";
      pd.style.marginTop = "8px";
      pd.textContent = t("pred.disc");
      pc.appendChild(pd);
      host.appendChild(pc);
    }

    // ---- cross-app: mood during period days (read-only) ----
    renderMoodSection(host);

    // ---- symptom frequency (range-filtered, render-derived) ----
    var ds = daysInRange();
    var symCount = {}, symOrder = [];
    ds.forEach(function (d) {
      (d.sym || []).forEach(function (sid) {
        if (!colValById("sym", sid)) return;   // deleted value → skip
        if (symCount[sid] === undefined) symOrder.push(sid);
        symCount[sid] = (symCount[sid] || 0) + 1;
      });
    });
    if (symOrder.length) {
      symOrder.sort(function (a, b) { return symCount[b] - symCount[a]; });
      var sh = document.createElement("h2");
      sh.className = "sec-title";
      sh.textContent = t("ins.sym.title");
      host.appendChild(sh);
      var sb = document.createElement("div");
      var maxSym = symCount[symOrder[0]];   // top of the sorted list
      symOrder.slice(0, 8).forEach(function (sid) {
        var v = colValById("sym", sid);
        sb.appendChild(mkDistRow(colLabel(v), symCount[sid],
          Math.round(symCount[sid] / ds.length * 100), maxSym));
      });
      host.appendChild(sb);
    }

    // ---- meds taken (intake COUNTS, not days — honest per-pill) ----
    var medCount = {}, medOrder = [];
    ds.forEach(function (d) {
      (d.meds || []).forEach(function (m) {
        if (!colValById("med", m.med)) return;
        if (medCount[m.med] === undefined) medOrder.push(m.med);
        medCount[m.med] = (medCount[m.med] || 0) + 1;
      });
    });
    if (medOrder.length) {
      medOrder.sort(function (a, b) { return medCount[b] - medCount[a]; });
      var mh2 = document.createElement("h2");
      mh2.className = "sec-title";
      mh2.textContent = t("ins.med.title");
      host.appendChild(mh2);
      var mb = document.createElement("div");
      var maxMed = medCount[medOrder[0]];   // top of the sorted list
      medOrder.slice(0, 8).forEach(function (mid) {
        var v = colValById("med", mid);
        mb.appendChild(mkDistRow(colLabel(v), medCount[mid], null, maxMed));
      });
      host.appendChild(mb);
    }

    if (!symOrder.length && !medOrder.length &&
        !state.periods.length) {
      var nn = document.createElement("div");
      nn.className = "hint";
      nn.textContent = t("ins.ctx.none");
      host.appendChild(nn);
    }

    appendResetLink(host);
  }

  // one dist-row builder — neutral metrics → OS hue (mood rule)
  function mkDistRow(label, n, pct, maxN) {
    var row = document.createElement("div");
    row.className = "dist-row";
    var lab = document.createElement("span");
    lab.className = "dist-lab";
    lab.textContent = label;
    row.appendChild(lab);
    var bar = document.createElement("div");
    bar.className = "dist-bar";
    var fill = document.createElement("div");
    fill.className = "dist-fill";
    // proportional to the TOP item of this group (min 4% so a
    // single low count is still visible as a sliver)
    fill.style.width = (maxN ? Math.max(4, Math.round(n / maxN * 100)) : 60) + "%";
    fill.style.background = "var(--accent)";
    bar.appendChild(fill);
    row.appendChild(bar);
    var val = document.createElement("span");
    val.className = "dist-val";
    val.textContent = String(n) + (pct !== null ? " · " + pct + "%" : "");
    row.appendChild(val);
    return row;
  }

  // ---------- cross-app: Mood read-back (Wave 2.2) ----------
  // The Mood app's fixed emotion vocabulary, mirrored READ-ONLY:
  // mood.js documents its dictionary as IMMUTABLE (stable keys
  // for statistics), so keying on it is a contract, not a hope.
  // Unknown keys are ignored. Reading "oros-mood-data" is safe:
  // same origin, shared localStorage, defensive parse, zero
  // writes — ever.
  var MOOD_KEY = "oros-mood-data";
  var XEMO_LABEL = {
    happy:    { en: "Happy",    el: "Χαρούμενος" },
    calm:     { en: "Calm",     el: "Ήρεμος" },
    excited:  { en: "Excited",  el: "Ενθουσιασμένος" },
    sad:      { en: "Sad",      el: "Λυπημένος" },
    angry:    { en: "Angry",    el: "Θυμωμένος" },
    anxious:  { en: "Anxious",  el: "Αγχωμένος" },
    tired:    { en: "Tired",    el: "Κουρασμένος" },
    stressed: { en: "Stressed", el: "Πιεσμένος" },
    numb:     { en: "Numb",     el: "Άδειος" }
  };
  var XPOS = { happy: 1, calm: 1, excited: 1 };   // mood's POS_EMOS mirror

  function xemoLabel(k) {
    var v = XEMO_LABEL[k];
    return v ? (v[LANG] || v.en) : k;
  }

  function readMoodEntries() {
    try {
      var raw = localStorage.getItem(MOOD_KEY);
      if (!raw) return [];
      var d = JSON.parse(raw);
      if (!d || !Array.isArray(d.entries)) return [];
      return d.entries.filter(function (e) {
        return e && typeof e.ts === "number" &&
               Array.isArray(e.emotions);
      });
    } catch (err) { return []; }        // absent/garbage → no section
  }

  function periodDayKeys() {
    var keys = {};
    state.periods.forEach(function (p) {
      if (typeof p.start !== "number") return;
      var end = (p.end === null) ? Date.now() :
        ((typeof p.end === "number") ? p.end : p.start);
      if (end < p.start) end = p.start;
      if ((end - p.start) / DAY_MS > 60) return;   // pathological guard
      var cur = new Date(p.start);                  // DST-safe walk
      while (cur.getTime() <= end) {
        keys[dayKey(cur.getTime())] = true;
        cur.setDate(cur.getDate() + 1);
      }
    });
    return keys;
  }

  // "Mood on period days" — during-period vs other-days mood
  // entries, same honesty guards as every trend engine: min
  // 5 samples PER SIDE, min +12pt delta, max 2 sentences. All
  // render-derived; nothing stored, nothing synced.
  function renderMoodSection(host) {
    var mes = readMoodEntries();
    if (!mes.length || !state.periods.length) return;
    if (insRange) {
      var from = todayTs() - insRange * DAY_MS;
      mes = mes.filter(function (e) { return e.ts >= from; });
    }
    var pkeys = periodDayKeys();
    var dur = mes.filter(function (e) { return pkeys[dayKey(e.ts)]; });
    var oth = mes.filter(function (e) { return !pkeys[dayKey(e.ts)]; });
    if (dur.length < 5 || oth.length < 5) return;

    var h = document.createElement("h2");
    h.className = "sec-title";
    h.textContent = t("xm.title");
    host.appendChild(h);

    // prevalence per emotion key (fraction of entries)
    var prev = function (set) {
      var n = {};
      set.forEach(function (e) {
        var seen = {};
        (e.emotions || []).forEach(function (m) {
          if (!m || typeof m.k !== "string" || seen[m.k]) return;
          seen[m.k] = true;
          n[m.k] = (n[m.k] || 0) + 1;
        });
      });
      Object.keys(n).forEach(function (k) { n[k] /= set.length; });
      return n;
    };
    var pd = prev(dur), od = prev(oth);
    var hits = [];
    Object.keys(XEMO_LABEL).forEach(function (k) {
      var d = Math.round(((pd[k] || 0) - (od[k] || 0)) * 100);
      if (d >= 12) hits.push({ k: k, d: d });
    });
    hits.sort(function (a, b) { return b.d - a.d; });
    hits.slice(0, 2).forEach(function (r) {
      var li = document.createElement("div");
      li.className = "hint";
      li.style.margin = "2px 2px 8px";
      li.textContent = t("xm.tr")
        .replace("{e}", xemoLabel(r.k))
        .replace("{d}", r.d);
      host.appendChild(li);
    });

    // positive share — two bars (mood's momentum visual contract)
    var posShare = function (set) {
      var n = 0;
      set.forEach(function (e) {
        if ((e.emotions || []).some(function (m) {
          return m && XPOS[m.k];
        })) n++;
      });
      return Math.round(n / set.length * 100);
    };
    [[t("xm.dur"), posShare(dur)], [t("xm.oth"), posShare(oth)]]
      .forEach(function (r) {
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
        row.appendChild(val);
        host.appendChild(row);
      });
    var ph = document.createElement("div");
    ph.className = "hint";
    ph.style.marginTop = "4px";
    ph.textContent = t("xm.pos");
    host.appendChild(ph);

    var disc = document.createElement("div");
    disc.className = "hint";
    disc.style.marginTop = "8px";
    disc.textContent = t("xm.disc");
    host.appendChild(disc);
  }

  function appendResetLink(host) {
    var rst = document.createElement("button");
    rst.type = "button";
    rst.className = "rst-link";
    rst.textContent = t("rst.btn");
    rst.addEventListener("click", askReset);
    host.appendChild(rst);
  }

  // ---------- Doctor Report PDF (Wave 2.3) ----------
  // jsPDF VENDORED LOCALLY (vendor/jspdf.umd.min.js) — never a
  // CDN. Optional: if the file is absent, export degrades to a
  // toast error; nothing else breaks. Greek needs the vendored
  // Unicode TTF (mood's B1 NFC funnel applies verbatim — mobile
  // keyboards emit NFD, jsPDF draws combining marks as glyphs).
  var pdfLibLoading = false;
  function loadPdfLib(done) {
    if (window.jspdf && window.jspdf.jsPDF) { done(); return; }
    if (pdfLibLoading) return;
    pdfLibLoading = true;
    var cands = ["../vendor/jspdf.umd.min.js"];   // cycle/ has no vendor/
    var i = 0;
    (function next() {
      if (i >= cands.length) { pdfLibLoading = false; showToast(t("exp.err")); return; }
      var s = document.createElement("script");
      s.src = cands[i++] + (SCRIPT_V ? "?v=" + SCRIPT_V : "");
      s.onload = function () { pdfLibLoading = false; done(); };
      s.onerror = function () { s.remove(); next(); };
      document.head.appendChild(s);
    })();
  }

  var FONT_FILE = "../vendor/NotoSans-Regular.ttf";
  function loadPdfFont(done) {
    if (LANG !== "el" || window.__cyclePdfFont) { done(); return; }
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
        window.__cyclePdfFont = { file: "NotoSans-Regular.ttf", b64: b64 };
        done();
      })
      .catch(function () { showToast(t("exp.font.err")); done(); });
  }

  function pdfClean(s) {
    if (Array.isArray(s)) return s.map(pdfClean);
    return String(s).normalize("NFC");
  }

  function exportDoctorReport() {
    if (!state.periods.length && !state.days.length) {
      showToast(t("ins.empty"));
      return;
    }
    loadPdfLib(function () {
      loadPdfFont(function () {
      var JS = window.jspdf.jsPDF;
      var doc = new JS({ unit: "pt", format: "a4" });
      var docText = doc.text.bind(doc);
      doc.text = function (s, x, y, opts) {
        return docText(pdfClean(s), x, y, opts);
      };
      var FONT = window.__cyclePdfFont ? "NotoSans" : "helvetica";
      if (window.__cyclePdfFont) {
        doc.addFileToVFS(window.__cyclePdfFont.file, window.__cyclePdfFont.b64);
        doc.addFont(window.__cyclePdfFont.file, "NotoSans", "normal");
        doc.addFont(window.__cyclePdfFont.file, "NotoSans", "bold");
      }
      doc.setFont(FONT, "normal");
      var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
      var M = 48, y = M, page = 1;
      var loc = LANG === "el" ? "el-GR" : "en-GB";

      var footer = function () {
        doc.setFontSize(8); doc.setTextColor(150);
        doc.text("orOS Cycle — " + t("app.title"), M, H - 28);
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
      var kv = function (lab, val) {
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
      var dstr = function (ts) {
        return new Date(ts).toLocaleDateString(loc,
          { day: "numeric", month: "short", year: "numeric" });
      };

      // data — respects the selected range, same contract as
      // mood's export (the range chip on screen = the range on paper)
      var ps = periodsInRange();
      var ds = daysInRange();
      var rangeLbl = insRange ? t("ins.r6") : t("ins.rall");

      doc.setFontSize(20); doc.setTextColor(20);
      doc.text(t("rep.title"), M, M + 6);
      doc.setFontSize(9); doc.setTextColor(130);
      y = M + 28;
      doc.text(rangeLbl + " · " + new Date().toLocaleString(loc), M, y);
      y += 18;

      // 1. overview — the three cycle facts + variability
      section(t("rep.over"));
      var avgC = avgCycleLen(), avgP = avgPeriodLen();
      if (avgC !== null) kv(t("ins.avg.cycle"),
        t("ins.days.n").replace("{n}", avgC));
      if (avgP !== null) kv(t("ins.avg.per"),
        t("ins.days.n").replace("{n}", avgP));
      kv(t("ins.periods"), String(ps.length));
      var asc = ps.slice().sort(function (a, b) { return a.start - b.start; });
      var gaps = [];
      for (var gi = 1; gi < asc.length; gi++)
        gaps.push(Math.round((asc[gi].start - asc[gi - 1].start) / DAY_MS));
      if (gaps.length >= 2) {
        var mn = gaps[0], mx = gaps[0];
        gaps.forEach(function (g) { mn = Math.min(mn, g); mx = Math.max(mx, g); });
        kv(t("rep.var"), t("rep.days").replace("{a}", mn).replace("{b}", mx));
      }
      y += 4;

      // 2. period log (oldest → newest)
      if (ps.length) {
        section(t("rep.periods"));
        ps.slice().sort(function (a, b) { return a.start - b.start; })
          .forEach(function (p, i) {
            need(15);
            var to = (p.end === null) ? t("per.ongoing") : dstr(p.end);
            var dur = (p.end === null) ? "—" :
              ((Math.round((p.end - p.start) / DAY_MS) + 1) + "d");
            doc.setFontSize(10); doc.setTextColor(25);
            doc.text((i + 1) + ".", M + 8, y);
            doc.text(dstr(p.start) + " – " + to, M + 28, y);
            doc.setTextColor(115);
            doc.text(dur + " · " + t("flow." + p.flow),
              W - M - 8, y, { align: "right" });
            y += 15;
          });
        y += 4;
      }

      // 3. symptoms + period-day clustering + 4. pain relief
      if (ds.length) {
        var pkeys = periodDayKeys();
        var symCount = {}, symPer = {}, symOrder = [];
        ds.forEach(function (d) {
          var onPer = !!pkeys[dayKey(d.day)];
          (d.sym || []).forEach(function (sid) {
            if (!colValById("sym", sid)) return;
            if (symCount[sid] === undefined) {
              symOrder.push(sid); symCount[sid] = 0; symPer[sid] = 0;
            }
            symCount[sid]++;
            if (onPer) symPer[sid]++;
          });
        });
        if (symOrder.length) {
          section(t("ins.sym.title"));
          symOrder.sort(function (a, b) { return symCount[b] - symCount[a]; });
          symOrder.forEach(function (sid) {
            // honest marker: ≥3 occurrences AND ≥70% land on
            // period days — nothing claimed on thinner evidence
            var extra = (symCount[sid] >= 3 &&
              symPer[sid] / symCount[sid] >= 0.7)
              ? " · " + t("rep.cluster") : "";
            kv(colLabel(colValById("sym", sid)),
              String(symCount[sid]) + extra);
          });
          y += 4;
        }

        var medCount = {}, medOrder = [];
        var medPer = 0, medN = 0;
        ds.forEach(function (d) {
          var onPer = !!pkeys[dayKey(d.day)];
          (d.meds || []).forEach(function (m) {
            if (!colValById("med", m.med)) return;
            if (medCount[m.med] === undefined) {
              medOrder.push(m.med); medCount[m.med] = 0;
            }
            medCount[m.med]++; medN++;
            if (onPer) medPer++;
          });
        });
        if (medN) {
          section(t("ins.med.title"));
          medOrder.sort(function (a, b) { return medCount[b] - medCount[a]; });
          medOrder.slice(0, 8).forEach(function (mid) {
            kv(colLabel(colValById("med", mid)), String(medCount[mid]));
          });
          kv(t("rep.onper"), Math.round(medPer / medN * 100) + "%");
          y += 4;
        }

        // 5. day notes (what the doctor actually asks about)
        var noted = ds.filter(function (d) { return d.note; });
        if (noted.length) {
          section(t("rep.notes"));
          noted.forEach(function (d) {
            line(dstr(d.day) + " — " + d.note, 8);
          });
        }
      }

      // disclaimer — the escort travels to paper too
      need(30);
      doc.setFontSize(9); doc.setTextColor(130);
      doc.text(doc.splitTextToSize(t("rep.disc"), W - M * 2), M, y);

      footer();
      doc.save("oros-cycle-" + dayKey(Date.now()) + ".pdf");
      showToast(t("exp.done"));
      });
    });
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
    api.registerSlice("cycle", sliceGet, sliceSet, STORAGE_KEY, mergeCycleStates);
  }

  function sliceGet() {
    return JSON.parse(JSON.stringify(state));
  }

  function sliceSet(data, info) {
    data = migrate(JSON.parse(JSON.stringify(data || null)));
    if (!data || !Array.isArray(data.periods) ||
        !Array.isArray(data.days)) return;

    window.__orosSyncApi._suppress = true;
    try {
      state = data;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } finally {
      window.__orosSyncApi._suppress = false;
    }

    // post-condition of the merge: canonical ordering
    state.periods.sort(function (x, y) { return y.start - x.start; });
    state.days.sort(function (x, y) { return x.day - y.day; });
    state.cols.sym.forEach(function (v, i) { v.pos = i; });
    state.cols.med.forEach(function (v, i) { v.pos = i; });

    // a day being edited may have been deleted remotely — drop
    // the editor without yanking the keyboard from under it
    if (openDay !== null && !dayById(openDay) &&
        viewMode === "calendar") {
      openDay = null;
    }

    // unsaved edits survive a remote pull while the editor is
    // open: the note and the symptom draft travel through the
    // SAME one-shot channel the chip taps use. A remote DELETE
    // of the open day still closes the editor (checked above),
    // so rebuildDraft is never left unconsumed.
    var syncKeepNote = null;
    var syncKeepScroll = 0;
    var syncingInEditor = (dayDraft && viewMode === "calendar" &&
                           openDay !== null);
    if (syncingInEditor) {
      syncKeepNote = $("fld-note") ? $("fld-note").value : null;
      var mm = $("cyclemain");
      syncKeepScroll = mm ? mm.scrollTop : 0;
      rebuildDraft = { sym: dayDraft.sym.slice() };
    }
    renderAll();
    if (syncingInEditor && openDay !== null && $("fld-note")) {
      $("fld-note").value = syncKeepNote;
      var mm2 = $("cyclemain");
      if (mm2) mm2.scrollTop = syncKeepScroll;
    }
    if (viewMode === "insights") renderInsights();
    if (info && info.merged) showToast(t("sync.pull"));
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
  // aria-labels/titles/icons at boot. calendar · list · bar-chart.
  function paintStaticAria() {
    var cal = $("cal-btn");
    if (cal) {
      cal.setAttribute("aria-label", t("tab.cal"));
      cal.setAttribute("title", t("tab.cal"));
      cal.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="3" y="5" width="18" height="16" rx="2"/>' +
        '<path d="M8 3v4M16 3v4M3 10h18"/></svg>';
    }
    var dy = $("day-btn");
    if (dy) {
      dy.setAttribute("aria-label", t("tab.days"));
      dy.setAttribute("title", t("tab.days"));
      dy.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M4 6h16M4 12h16M4 18h10"/></svg>';
    }
    var ib = $("ins-btn");
    if (ib) {
      ib.setAttribute("aria-label", t("tab.ins"));
      ib.setAttribute("title", t("tab.ins"));
      ib.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>';
    }
  }

  function wire() {
    $("cal-btn").addEventListener("click", function () { showTab("calendar"); });
    $("day-btn").addEventListener("click", function () { showTab("days"); });
    $("ins-btn").addEventListener("click", function () { showTab("insights"); });
  }

  // ---------- Boot ----------
  var SCRIPT_V = "";
  (function () {
    var m = (document.currentScript && document.currentScript.src || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;   // lang attr follows locale
    console.log("cycle.js v" + (SCRIPT_V || "?") + " boot");
  })();
  load();
  applyI18n();
  paintStaticAria();
  wire();
  registerSync();
  inheritPalette();
  watchPalette();
  applyView();
  setTimeout(maybeRemind, 900);   // after the first paint settles

})();