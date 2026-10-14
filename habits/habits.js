// ============================================================
// orOS Habits — Habit tracker (List · Calendar · Stats)
// Clean-room rewrite of the beta habits app (functional
// reference only — zero code carried over).
//
// Fixed vs beta (audit findings):
//   #1 "weekly" was a fake (always scheduled)  → days:[0..6]
//       subset model: 7 = daily, empty = any day
//   #2 longest streak ignored schedule         → schedule-aware
//   #3 overall rate mixed all-time vs 30d      → (Wave 3, noted)
//   #4 hardcoded EN months in EL mode          → STRINGS + Intl
//   #11 completions[] merge-hostile array      → comps entities
//       with tombstones, resurrect on re-toggle
//
// Contracts (§10): IIFE "use strict" ES5 · STRINGS en/el ·
// shared LABEL_COLORS · 16 inline SVG icons · Monday-first ·
// registerSlice 5-arg · strict mergeRow (no volatile defaults
// inside merge) · sliceSet never marks dirty · rescue backup
// for corrupt local data · boot marker from cache-busted URL.
//
// Wave 4 (v2 data): measurable habits (a number with a unit and a
// daily target, at least / at most), X times per week / month,
// habit strength (Loop-style score + chart), per-habit reminder time
// (shell engine + phone bridge), skipped days, a year heatmap, a
// note per check-in and the read-only Steps row from Health. Rules
// in core.js (OrosHabitsCore), data shape / merge / writes in
// model.js (OrosHabitsModel), the Steps feed in steps.js.
// ============================================================
(function () {
  "use strict";

  // ===== VERSION & LANGUAGE =====
  var SCRIPT_V = "";
  (function () {
    var src = (document.currentScript && document.currentScript.src) || "";
    var m = src.match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
  })();
  var LANG = "en";
  try {
    LANG = (window.parent && window.parent.orosLang) ||
           window.orosLang ||
           (localStorage.getItem("oros-lang") === "el" ? "el" : "en");
    if (LANG !== "el" && LANG !== "en") LANG = "en";
  } catch (e) { LANG = "en"; }
  document.documentElement.lang = LANG;

  // ===== STRINGS =====
  var STRINGS = {
    en: {
      "app.name":        "Habits",
      "add":             "Add habit",
      "edit":            "Edit habit",
      "name.label":      "Name",
      "icon.label":      "Icon",
      "color.label":     "Color",
      "days.label":      "Schedule",
      "days.daily":      "Every day",
      "days.any":        "Any day",
      "days.n":          "{n} days / week",
      "rename":          "Rename",
      "del":             "Delete",
      "cancel":          "Cancel",
      "save":            "Save",
      "freq.daily":      "Daily",
      "freq.any":        "Flexible",
      "streak":          "{n} day streak",
      "streaks":         "{n} day streaks",
      "streak.zero":     "No streak",
      "feed.open":       "Open {app}",
      "feed.badge":      "Auto",
      "today":           "Today",
      "this.week":       "This Week",
      "week.of":         "Week of {s}",
      "confirm.del":     "Delete this habit and its full history?",
      "empty.title":     "No habits yet",
      "empty.desc":      "Create your first habit to get started.",
      "empty.cta":       "Create Habit",
      "toast.created":  "Habit created",
      "toast.updated":  "Habit updated",
      "toast.deleted":   "Habit deleted",
      "toast.name.req":  "Name is required",
      "toast.merged":   "Updated from sync",
      "day.0": "Mon", "day.1": "Tue", "day.2": "Wed", "day.3": "Thu",
      "day.4": "Fri", "day.5": "Sat", "day.6": "Sun",
      "dkey.0": "M", "dkey.1": "T", "dkey.2": "W", "dkey.3": "T",
      "dkey.4": "F", "dkey.5": "S", "dkey.6": "S",
      "view.list": "List",
      "view.cal": "Calendar",
      "month.prev": "Previous month",
      "month.next": "Next month",
      "week.prev": "Previous week",
      "week.next": "Next week",
      "view.stats": "Stats",
      "range.30": "30d",
      "range.90": "90d",
      "range.all": "All",
      "stats.per.habit": "By habit",
      "stats.insights": "Insights",
      "stats.total.comps": "Check-offs",
      "stats.active.habits": "Active habits",
      "stats.avg.week": "Avg / week",
      "stats.perfect.days": "Perfect days",
      "stats.current": "current",
      "stats.longest": "longest",
      "stats.rate": "{n}% completed",
      "ins.none": "Not enough data for insights yet — keep checking in.",
      "ins.top": "{n} is your most consistent habit ({p}% completion).",
      "ins.perfect": "You completed every scheduled habit on {n} day(s).",
      "ins.up": "Trending up: {a}% → {b}% completion over the last month.",
      "ins.down": "Slipping a bit: {a}% → {b}% completion over the last month.",
      "settings": "Settings",
      "type.label": "Type",
      "type.bool": "Yes / No",
      "type.num": "Amount",
      "target.label": "Daily target",
      "cmp.ge": "At least",
      "cmp.le": "At most",
      "unit.label": "Unit",
      "unit.ph": "pages, steps, cups",
      "step.label": "Step for − / +",
      "freq.label": "Frequency",
      "freq.mode.days": "Days",
      "freq.mode.w": "Per week",
      "freq.mode.m": "Per month",
      "per.w.n": "{n} times a week",
      "per.m.n": "{n} times a month",
      "per.times": "Times",
      "freq.days": "{n} days/wk",
      "freq.w": "{n}×/wk",
      "freq.m": "{n}×/mo",
      "rem.label": "Reminder",
      "rem.none": "No reminder",
      "rem.at": "Reminder at {t}",
      "rem.note": "A notification at this time on days the habit still needs doing (orOS open, or the orOS Android app with reminders on).",
      "day.done": "Done",
      "day.skip": "Skip this day",
      "day.skip.hint": "Sick, on holiday… a skipped day doesn't break the streak.",
      "day.note": "Note",
      "day.note.ph": "Optional, a few words",
      "day.value": "Value",
      "target.ge": "at least {t}",
      "target.le": "at most {t}",
      "skipped": "Skipped",
      "strength": "Strength",
      "strength.tip": "Habit strength {n}%: it grows while you keep the habit; one missed day costs only a little.",
      "detail.chart": "Strength over time",
      "detail.notes": "Notes",
      "detail.edit": "Edit",
      "close": "Close",
      "year.prev": "Previous year",
      "year.next": "Next year",
      "streak.w": "{n} week streak",
      "streak.m": "{n} month streak",
      "unit.w": "wk",
      "unit.m": "mo",
      "period.w": "{a}/{b} this week",
      "period.m": "{a}/{b} this month",
      "stats.periods.w": "{n}% of weeks met",
      "stats.periods.m": "{n}% of months met",
      "stats.avg": "avg {v}",
      "set.steps": "Show steps from Health",
      "set.steps.goal": "Daily steps goal",
      "set.steps.hint": "A read-only row filled from the steps the Health app keeps (typed there, or from Health Connect with the orOS Android app).",
      "set.steps.none": "Health has no steps yet.",
      "err.target": "Enter a target above 0",
      "dec": "Less",
      "inc": "More",
      "dot.tip": "Click to tick · right-click or long-press for skip and note",
      "dot.tip.num": "Click to enter the value, skip or add a note",
      "less": "Less",
      "more": "More"
    },
    el: {
      "app.name":        "Συνήθειες",
      "add":             "Προσθήκη συνήθειας",
      "edit":            "Επεξεργασία συνήθειας",
      "name.label":      "Όνομα",
      "icon.label":      "Εικονίδιο",
      "color.label":     "Χρώμα",
      "days.label":      "Πρόγραμμα",
      "days.daily":      "Καθημερινά",
      "days.any":        "Οποιαδήποτε μέρα",
      "days.n":          "{n} ημέρες / εβδομάδα",
      "rename":          "Μετονομασία",
      "del":             "Διαγραφή",
      "cancel":          "Άκυρο",
      "save":            "Αποθήκευση",
      "freq.daily":      "Καθημερινά",
      "freq.any":        "Ευέλικτο",
      "streak":          "{n} ημέρες σερί",
      "streaks":         "{n} ημέρες σερί",
      "streak.zero":     "Χωρίς σερί",
      "feed.open":       "Άνοιγμα: {app}",
      "feed.badge":      "Αυτόματο",
      "today":           "Σήμερα",
      "this.week":       "Αυτή η εβδομάδα",
      "week.of":         "Εβδομάδα {s}",
      "confirm.del":     "Διαγραφή αυτής της συνήθειας και όλου του ιστορικού της;",
      "empty.title":     "Καμία συνήθεια ακόμα",
      "empty.desc":      "Δημιούργησε την πρώτη σου συνήθεια για να ξεκινήσεις.",
      "empty.cta":       "Δημιουργία συνήθειας",
      "toast.created":  "Δημιουργήθηκε συνήθεια",
      "toast.updated":  "Η συνήθεια ενημερώθηκε",
      "toast.deleted":   "Η συνήθεια διαγράφτηκε",
      "toast.name.req":  "Απαιτείται όνομα",
      "toast.merged":   "Ενημερώθηκε από συγχρονισμό",
      "day.0": "Δευ", "day.1": "Τρί", "day.2": "Τετ", "day.3": "Πέμ",
      "day.4": "Παρ", "day.5": "Σάβ", "day.6": "Κυρ",
      "dkey.0": "Δ", "dkey.1": "Τ", "dkey.2": "Τ", "dkey.3": "Π",
      "dkey.4": "Π", "dkey.5": "Σ", "dkey.6": "Κ",
      "view.list": "Λίστα",
      "view.cal": "Ημερολόγιο",
      "month.prev": "Προηγούμενος μήνας",
      "month.next": "Επόμενος μήνας",
      "week.prev": "Προηγούμενη εβδομάδα",
      "week.next": "Επόμενη εβδομάδα",
      "view.stats": "Στατιστικά",
      "range.30": "30 ημ",
      "range.90": "90 ημ",
      "range.all": "Όλα",
      "stats.per.habit": "Ανά συνήθεια",
      "stats.insights": "Ευρήματα",
      "stats.total.comps": "Καταγραφές",
      "stats.active.habits": "Ενεργές συνήθειες",
      "stats.avg.week": "Μ.Ο. / εβδ.",
      "stats.perfect.days": "Τέλειες μέρες",
      "stats.current": "τρέχον",
      "stats.longest": "μεγαλύτερο",
      "stats.rate": "{n}% ολοκλήρωση",
      "ins.none": "Ακόμα δεν υπάρχουν αρκετά δεδομένα για ευρήματα — συνέχισε!",
      "ins.top": "Το «{n}» είναι η πιο σταθερή σου συνήθεια ({p}% ολοκλήρωση).",
      "ins.perfect": "Ολοκλήρωσες όλες τις προγραμματισμένες συνήθειες σε {n} μέρες.",
      "ins.up": "Ανοδική τάση: {a}% → {b}% ολοκλήρωση τον τελευταίο μήνα.",
      "ins.down": "Μικρή πτώση: {a}% → {b}% ολοκλήρωση τον τελευταίο μήνα.",
      "settings": "Ρυθμίσεις",
      "type.label": "Τύπος",
      "type.bool": "Ναι / Όχι",
      "type.num": "Ποσότητα",
      "target.label": "Ημερήσιος στόχος",
      "cmp.ge": "Τουλάχιστον",
      "cmp.le": "Το πολύ",
      "unit.label": "Μονάδα",
      "unit.ph": "σελίδες, βήματα, φλιτζάνια",
      "step.label": "Βήμα για − / +",
      "freq.label": "Συχνότητα",
      "freq.mode.days": "Μέρες",
      "freq.mode.w": "Ανά εβδομάδα",
      "freq.mode.m": "Ανά μήνα",
      "per.w.n": "{n} φορές την εβδομάδα",
      "per.m.n": "{n} φορές τον μήνα",
      "per.times": "Φορές",
      "freq.days": "{n} μέρες/εβδ.",
      "freq.w": "{n}×/εβδ.",
      "freq.m": "{n}×/μήνα",
      "rem.label": "Υπενθύμιση",
      "rem.none": "Χωρίς υπενθύμιση",
      "rem.at": "Υπενθύμιση στις {t}",
      "rem.note": "Ειδοποίηση αυτή την ώρα τις μέρες που η συνήθεια μένει να γίνει (με το orOS ανοιχτό ή με την εφαρμογή orOS για Android και τις υπενθυμίσεις ενεργές).",
      "day.done": "Έγινε",
      "day.skip": "Παράλειψη μέρας",
      "day.skip.hint": "Αρρώστια, διακοπές… μια μέρα που παραλείπεις δεν σπάει το σερί.",
      "day.note": "Σημείωση",
      "day.note.ph": "Προαιρετικά, λίγες λέξεις",
      "day.value": "Τιμή",
      "target.ge": "τουλάχιστον {t}",
      "target.le": "το πολύ {t}",
      "skipped": "Παράλειψη",
      "strength": "Δύναμη",
      "strength.tip": "Δύναμη συνήθειας {n}%: μεγαλώνει όσο την κρατάς· μια χαμένη μέρα κοστίζει λίγο.",
      "detail.chart": "Η δύναμη στον χρόνο",
      "detail.notes": "Σημειώσεις",
      "detail.edit": "Επεξεργασία",
      "close": "Κλείσιμο",
      "year.prev": "Προηγούμενο έτος",
      "year.next": "Επόμενο έτος",
      "streak.w": "{n} εβδομάδες σερί",
      "streak.m": "{n} μήνες σερί",
      "unit.w": "εβδ",
      "unit.m": "μήν",
      "period.w": "{a}/{b} αυτή την εβδομάδα",
      "period.m": "{a}/{b} αυτόν τον μήνα",
      "stats.periods.w": "{n}% των εβδομάδων με επιτυχία",
      "stats.periods.m": "{n}% των μηνών με επιτυχία",
      "stats.avg": "μ.ό. {v}",
      "set.steps": "Εμφάνιση βημάτων από την Υγεία",
      "set.steps.goal": "Ημερήσιος στόχος βημάτων",
      "set.steps.hint": "Μια γραμμή μόνο για ανάγνωση, με τα βήματα που κρατά η εφαρμογή Υγεία (γραμμένα εκεί ή από το Health Connect με την εφαρμογή orOS για Android).",
      "set.steps.none": "Η Υγεία δεν έχει ακόμα βήματα.",
      "err.target": "Βάλε στόχο πάνω από 0",
      "dec": "Λιγότερο",
      "inc": "Περισσότερο",
      "dot.tip": "Πάτα για τσεκάρισμα · δεξί κλικ ή παρατεταμένο πάτημα για παράλειψη και σημείωση",
      "dot.tip.num": "Πάτα για τιμή, παράλειψη ή σημείωση",
      "less": "Λιγότερο",
      "more": "Περισσότερο"
    }
  };

  function t(key) {
    var p = STRINGS[LANG] || {};
    if (p[key] !== undefined) return p[key];
    if (STRINGS.en[key] !== undefined) return STRINGS.en[key];
    return key;
  }
  function fmt(key, n) { return t(key).replace("{n}", String(n)); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // Localized month/day formatting WITHOUT hardcoded EN tables (audit #4)
  function monthYearLabel(d) {
    var s = new Intl.DateTimeFormat(LANG === "el" ? "el-GR" : "en-GB",
      { month: "short", year: "numeric" }).format(d);
    return LANG === "el" ? s : s.replace(".", "");
  }
  function dayNum(d) {
    return new Intl.DateTimeFormat(LANG === "el" ? "el-GR" : "en-GB",
      { day: "numeric" }).format(d);
  }

  // ===== CONSTANTS =====
  var DATA_KEY = "oros-habits-data";
  var BROKEN_KEY = "oros-habits-data-broken";   // local rescue copy, never synced
  var DEVICE_KEY = "oros-habits-device";        // this device's id for value shares, never synced
  var HC = window.OrosHabitsCore;
  var M = window.OrosHabitsModel;
  var DATA_VER = M.DATA_VER;

  // Shared orOS vocabulary — same 8 colors as Notes/To-Do/Mood
  var COLORS = M.COLORS;

  // 16 handcrafted inline SVG icons (ForkAwesome exiled)
  var ICONS = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12.5 9.5 18 20 6.5"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2.5 14.6 8.6 21 9.4 16.4 13.9 17.6 20.3 12 17.1 6.4 20.3 7.6 13.9 3 9.4 9.4 8.6"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5C7 16.5 3 13.2 3 9.3 3 6.4 5.2 4.5 7.6 4.5c1.7 0 3.3.9 4.4 2.5 1.1-1.6 2.7-2.5 4.4-2.5 2.4 0 4.6 1.9 4.6 4.8 0 3.9-4 7.2-9 11.2z"/></svg>',
    fire: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c-4 0-7-2.8-7-6.5 0-2.7 1.5-4.4 2.8-5.9C9 8.2 10 7 10 5c2.5 1.3 4 3.2 4.6 5.3.7-.5 1.2-1.2 1.5-2.1C17.3 9.6 19 11.9 19 14.7 19 19 16 22 12 22z"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5V4.5C4 3.7 4.7 3 5.5 3H20v15.5H5.5A1.5 1.5 0 0 0 4 20zM4 20a1.5 1.5 0 0 0 1.5 1.5H20"/></svg>',
    music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17.5" r="3"/><circle cx="18" cy="15.5" r="3"/><path d="M9 17.5V5l12-2v12.5"/></svg>',
    bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1.2.9 2h5.2c0-.8.3-1.5.9-2A6 6 0 0 0 12 3z"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 5H3.5v1.5A4 4 0 0 0 7 10.5M17 5h3.5v1.5a4 4 0 0 1-3.5 4"/></svg>',
    leaf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20C4 11 10 4 20 4c0 10-7 16-16 16z"/><path d="M4 20c4-6 8-9 12-11"/></svg>',
    coffee: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M5 3.5c0 1 1 1 1 2M9 3.5c0 1 1 1 1 2M13 3.5c0 1 1 1 1 2"/></svg>',
    dumbbell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/></svg>',
    bed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6"/><path d="M3 18v-3h18v3M7 10V7h5v3"/></svg>',
    run: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="16" cy="4.5" r="2"/><path d="M6 17l3.5-3.5-2-4 3-3 3 3 3-.5M8 20.5l2.5-4 3 1.5 3-1M13 9.5l2 4"/></svg>'
  };
  var ICON_KEYS = Object.keys(ICONS);

  // misc UI icons
  var ICO_PLUS  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  var ICO_PEN   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4L8 20l-5 1 1-5z"/></svg>';
  var ICO_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>';
  var ICO_CHEVL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 6 9 12 15 18"/></svg>';
  var ICO_CHEVR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';
  var ICO_GEAR  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
  var ICO_BELL  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>';
  var ICO_MINUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>';
  var ICO_SNOW  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M4.9 6l14.2 12M4.9 18L19.1 6"/></svg>';
  var ICO_TODAY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="8.5" opacity="0.35"/></svg>';

  // ===== DATE HELPERS (Monday-first, LOCAL calendar day keys) =====
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dateKey(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function todayStart() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function addDays(d, n) {
    var x = new Date(d);
    x.setDate(x.getDate() + n);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  // Monday-first week start (platform-wide convention)
  function weekStart(d) {
    var x = new Date(d);
    var day = x.getDay();                 // 0=Sun … 6=Sat
    var diff = day === 0 ? -6 : 1 - day;  // Monday of this week
    x.setDate(x.getDate() + diff);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function weekDays(d) {
    var s = weekStart(d), out = [];
    for (var i = 0; i < 7; i++) out.push(addDays(s, i));
    return out;
  }

  // ===== DATA LAYER =====
  // Shape, normalize, merge and the per-day writes live in model.js
  // (OrosHabitsModel, tested in Node); this file keeps storage, the
  // rescue copy and the view.
  var db = null;   // { ver, habits:[], comps:[], set? }
  var IX = null;   // OrosHabitsCore.index(db), rebuilt after every change

  // This device's id: its share of a measurable day's value (two
  // devices adding on the same day both count). Device-local.
  var DEVICE = "";
  try { DEVICE = localStorage.getItem(DEVICE_KEY) || ""; } catch (e) { DEVICE = ""; }
  if (!M.DEV_RE.test(DEVICE)) {
    DEVICE = (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).replace(/[^a-z0-9]/g, "");
    try { localStorage.setItem(DEVICE_KEY, DEVICE); } catch (e) {}
  }

  // LOAD with rescue backup: corrupt raw data is copied verbatim
  // to BROKEN_KEY BEFORE any re-seed can destroy it.
  function dbLoad() {
    var raw = null;
    try { raw = localStorage.getItem(DATA_KEY); } catch (e) { raw = null; }
    if (!raw) return null;

    function rescue(reason, err) {
      try { localStorage.setItem(BROKEN_KEY, raw); } catch (e2) {}
      console.error("[orOS] habits: " + reason + " — raw data backed up to " + BROKEN_KEY, err || "");
    }

    var obj = null;
    try { obj = JSON.parse(raw); }
    catch (parseErr) { rescue("parse failed", parseErr); return null; }

    var norm = M.normalize(obj);
    if (!norm) { rescue("shape invalid"); return null; }
    return norm;
  }

  function dbPersist() {
    try { localStorage.setItem(DATA_KEY, JSON.stringify(db)); }
    catch (e) { console.error("[orOS] habits: persist failed:", e); }
  }

  function seedDb() {
    // Net-new installs start empty — habits are personal, no seeds
    return { ver: DATA_VER, habits: [], comps: [] };
  }

  function dbInit() {
    db = dbLoad();
    if (!db) { db = seedDb(); dbPersist(); }
    IX = null;
  }
  function ix() { if (!IX) IX = HC.index(db); return IX; }

  // ===== QUERY HELPERS =====
  function habitById(id) {
    for (var i = 0; i < db.habits.length; i++) {
      if (db.habits[i].id === id) return db.habits[i];
    }
    return null;
  }
  function livingHabits() {
    var out = [];
    for (var i = 0; i < db.habits.length; i++) {
      if (!db.habits[i].del) out.push(db.habits[i]);
    }
    return out;
  }
  // The rules live in habits/core.js (OrosHabitsCore), shared with the
  // Calendar feed, the Today summary and the shell's reminder engine.
  // Done: yes / no = ticked; measurable = the day's value meets the
  // target. Schedule: Monday = 0; empty days = flexible; X per week /
  // month = any day, judged per period.
  // HB-1: flexible habits are interactable everywhere but excluded
  // from rate-based metrics (perfect days, consistency ranking).
  function isDone(habitId, dateK) { return HC.isDone(ix(), habitId, dateK); }
  function isScheduledOn(habit, d) { return HC.isScheduledOn(habit, dateKey(d)); }
  function isSkipped(habitId, dateK) { return HC.isSkipped(ix(), habitId, dateK); }
  function noteOn(habitId, dateK) { return HC.noteOn(ix(), habitId, dateK); }
  function valueOn(habitId, dateK) { return HC.valueOn(ix(), habitId, dateK); }
  function isFlexible(habit) { return HC.isFlexible(habit); }
  function isNum(habit) { return HC.isNum(habit); }
  function freqBadge(habit) {
    var pr = HC.perOf(habit);
    if (pr) return fmt(pr.p === "w" ? "freq.w" : "freq.m", pr.n);
    if (!habit.days.length) return t("freq.any");
    if (habit.days.length === 7) return t("freq.daily");
    return fmt("freq.days", habit.days.length);
  }
  function todayKey() { return dateKey(todayStart()); }

  // ===== NUMBERS =====
  function fmtNum(v) {
    if (v === null || v === undefined || !isFinite(v)) return "";
    return new Intl.NumberFormat(LANG === "el" ? "el-GR" : "en-GB", { maximumFractionDigits: 2 }).format(v);
  }
  function fmtCompact(v) {
    if (v === null || !isFinite(v)) return "";
    var a = Math.abs(v);
    if (a >= 1000) {
      var k = a >= 10000 ? Math.round(v / 1000) : Math.round(v / 100) / 10;
      return fmtNum(k) + "k";
    }
    return fmtNum(a >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
  }
  function withUnit(v, u) { return fmtNum(v) + (u ? " " + u : ""); }
  function targetText(h) {
    return tpl(h.num.c === "le" ? "target.le" : "target.ge", { t: withUnit(h.num.t, h.num.u) });
  }
  function hm(min) { return pad(Math.floor(min / 60)) + ":" + pad(min % 60); }

  // ===== STREAKS + STRENGTH (core.js) =====
  // Days: a skipped or unscheduled day is transparent, a scheduled
  // missed day breaks, today not done yet is not a break. X per week /
  // month: whole periods.
  function streakInfo(habit) { return HC.streaks(ix(), habit, todayKey()); }
  function currentStreak(habit) { return streakInfo(habit).cur; }
  function longestStreak(habit) { return streakInfo(habit).best; }
  function strength(habit) { return HC.score(ix(), habit, todayKey()); }
  function streakTipOf(st) {
    if (!st.cur) return t("streak.zero");
    if (st.unit === "w") return fmt("streak.w", st.cur);
    if (st.unit === "m") return fmt("streak.m", st.cur);
    return fmt(st.cur === 1 ? "streak" : "streaks", st.cur);
  }
  function streakSuffix(st) { return st.unit === "w" ? " " + t("unit.w") : (st.unit === "m" ? " " + t("unit.m") : ""); }

  // ===== APP FEEDS (read-only rows from other apps) =====
  // Generic contract: a provider app ships ONE script that
  // habits/index.html loads before this file (../<app>/core.js) and
  // that pushes a record onto window.orosHabitFeeds:
  //   { id, app, name{en,el}, hint{en,el}, color "#rrggbb",
  //     icon (static inline SVG from the provider's own code),
  //     keys [localStorage keys it reads — Habits re-renders when
  //           one of them changes, e.g. after a pull],
  //     unit{en,el} (measurable rows only),
  //     read() → null (hide the row) | { days: {"YYYY-MM-DD": true},
  //              vals?: {"YYYY-MM-DD": number}, goal?: number } }
  // Feed rows are daily, never stored, never synced, never counted
  // in Stats; a tap opens the provider app. Providers: Water,
  // Workouts, Micro-Zen, Steps (habits/steps.js, from Health).
  var FEED_ID_RE = /^[a-z0-9-]{1,30}$/;
  var FEED_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
  function feedText(v) {
    if (typeof v === "string") return v.slice(0, 80);
    if (v && typeof v === "object") return String(v[LANG] || v.en || "").slice(0, 80);
    return "";
  }
  function feedRows() {
    var src = window.orosHabitFeeds, out = [], seen = {};
    if (!Array.isArray(src)) return out;
    for (var i = 0; i < src.length; i++) {
      var f = src[i];
      if (!f || typeof f.read !== "function" || !FEED_ID_RE.test(String(f.id)) ||
          !FEED_ID_RE.test(String(f.app)) || seen[f.id]) continue;
      var got = null;
      try { got = f.read(); } catch (e) { got = null; }
      if (!got || !got.days || typeof got.days !== "object") continue;
      seen[f.id] = true;
      var vals = got.vals && typeof got.vals === "object" ? got.vals : null;
      out.push({
        id: String(f.id),
        app: String(f.app),
        name: feedText(f.name) || String(f.id),
        hint: feedText(f.hint),
        unit: vals ? feedText(f.unit).slice(0, 16) : "",
        color: FEED_COLOR_RE.test(f.color) ? f.color : COLORS[3],
        icon: (typeof f.icon === "string" && f.icon.indexOf("<svg") === 0) ? f.icon : ICONS.check,
        days: got.days,
        vals: vals,
        goal: typeof got.goal === "number" && isFinite(got.goal) && got.goal > 0 ? got.goal : 0
      });
    }
    return out;
  }
  function feedKeys() {
    var src = window.orosHabitFeeds, out = [];
    if (!Array.isArray(src)) return out;
    for (var i = 0; i < src.length; i++) {
      if (src[i] && Array.isArray(src[i].keys)) out = out.concat(src[i].keys);
    }
    return out;
  }
  function feedDone(f, dateK) { return f.days[dateK] === true; }
  function feedVal(f, dateK) {
    var v = f.vals ? f.vals[dateK] : undefined;
    return typeof v === "number" && isFinite(v) ? v : null;
  }
  function feedTip(f, dateK) {
    var v = feedVal(f, dateK);
    if (v === null) return f.hint;
    return withUnit(v, f.unit) + (f.goal ? " / " + fmtNum(f.goal) : "");
  }
  // Every day counts (a feed has no schedule); today not done yet is
  // not a break — the same grace as currentStreak().
  function feedStreak(f) {
    var streak = 0, d = todayStart(), guard = 0;
    if (!feedDone(f, dateKey(d))) d = addDays(d, -1);
    while (guard++ < 3650 && feedDone(f, dateKey(d))) { streak++; d = addDays(d, -1); }
    return streak;
  }
  function openFeedApp(app) {
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosOpenApp === "function") window.parent.__orosOpenApp(app);
    } catch (e) {}
  }

  // ===== MUTATIONS (all funnel through save()) =====
  function touch(o) { o.mtime = Date.now(); }

  function save() {
    IX = null;
    dbPersist();
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function addHabit(fields) {
    var h = M.normHabit({
      id: M.uid(), name: fields.name, icon: fields.icon, color: fields.color,
      days: fields.days, num: fields.num, per: fields.per, rem: fields.rem,
      mtime: Date.now(), del: false
    });
    if (!h) return null;
    db.habits.push(h);
    save();
    return h;
  }

  // HB-9: writes ONLY the fields in `patch` onto the CURRENT row.
  // A field the user did not touch keeps whatever another device
  // wrote meanwhile; an edit newer than a tombstone resurrects (R17).
  // A null value removes an optional field (num, per, rem).
  function updateHabit(h, patch) {
    for (var k in patch) {
      if (!patch.hasOwnProperty(k)) continue;
      if (patch[k] === null) delete h[k]; else h[k] = patch[k];
    }
    if (h.per) h.days = [];
    h.del = false;
    touch(h);
    save();
  }

  function deleteHabit(h) {
    // tombstone the habit AND all its ticks — merge-propagated,
    // but a comp edit with fresher mtime still resurrects (R17)
    h.del = true;
    touch(h);
    var now = Date.now();
    for (var i = 0; i < db.comps.length; i++) {
      if (db.comps[i].habitId === h.id) {
        if (!db.comps[i].del) { db.comps[i].del = true; db.comps[i].mtime = Math.max(now, db.comps[i].mtime + 1); }
      }
    }
    save();
  }

  // Yes / no tick for a habit/day. Completion = entity with !del.
  // Un-complete = tombstone (LWW merge friendly). Re-complete =
  // resurrect with fresh mtime (model.js setTick).
  function toggleComp(habit, d) {
    M.setTick(db, habit.id, dateKey(d), undefined, Date.now());
    save();
  }
  function quickAdd(habit, dateK, sign) {
    if (!isNum(habit)) return;
    M.addValue(db, habit.id, dateK, DEVICE, sign * (habit.num.s || 1), Date.now());
    save();
  }

  // ===== MERGE ENGINE (model.js) =====
  // Deterministic and symmetric; habits LWW per row, completions
  // field by field (tick, value shares per device, skip, note), the
  // Steps setting as one record. HB-11: the merge returns the SAME
  // canonical form as the getter (rows sorted by id, empty
  // completion rows pruned by one rule, HB-3).
  function mergeData(local, remote) { return M.mergeData(local, remote); }

  // ===== SYNC REGISTRATION =====
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
    api.registerSlice("habits", sliceGet, sliceSet, DATA_KEY, mergeData);
  }

  function sliceGet() {
    // HB-3 / HB-11: canonical deep copy — live db rows never leak into
    // the sync layer; pruning is payload-internal, never wall clock.
    return M.canon(db);
  }

  function sliceSet(data, info) {
    if (!data || typeof data !== "object" ||
        !Array.isArray(data.habits) || !Array.isArray(data.comps)) return;
    var next = M.normalize(data);
    if (!next) return;
    db = next;
    IX = null;
    dbPersist();
    render();                          // pull-fed path: NEVER dirty
    refreshOpenDialogs();
    if (info && info.merged) transientNote(t("toast.merged"));
  }

    // ===== VIEW & RENDER =====

  var els = {};
  var period = todayStart();          // week navigation anchor
    // Wave 3: tri-state view + stats range. Device-local UI prefs —
  // NEVER in the sync slice. Migration: saved "cal" (v0.2.0) honored.
  var viewMode = "list";              // "list" | "cal" | "stats"
  var statRange = 30;                 // 30 | 90 | 0 (all-time)
  var VIEW_KEY = "oros-habits-view";
  var RANGE_KEY = "oros-habits-range";
  try {
    var savedView = localStorage.getItem(VIEW_KEY);
    viewMode = (savedView === "cal" || savedView === "stats") ? savedView : "list";
  } catch (e) { viewMode = "list"; }
  try {
    var savedRange = parseInt(localStorage.getItem(RANGE_KEY), 10);
    statRange = (savedRange === 30 || savedRange === 90 || savedRange === 0) ? savedRange : 30;
  } catch (e) { statRange = 30; }
  function setView(mode) {
    viewMode = mode;
    try { localStorage.setItem(VIEW_KEY, viewMode); } catch (e) {}
    render();
  }
  function setStatRange(r) {
    statRange = r;
    try { localStorage.setItem(RANGE_KEY, String(statRange)); } catch (e) {}
    render();
  }
 
    function dom() {
    els.btnAdd = document.getElementById("btn-add");
    els.btnPrev = document.getElementById("btn-prev");
    els.btnNext = document.getElementById("btn-next");
    els.plabel  = document.getElementById("period-label");
    els.view    = document.getElementById("view");
    els.toast   = document.getElementById("toast");
    els.btnVList = document.getElementById("btn-vlist");
    els.btnVCal  = document.getElementById("btn-vcal");
    els.btnVStats = document.getElementById("btn-vstats");
    els.btnNow   = document.getElementById("btn-now");
    els.btnSet   = document.getElementById("btn-set");
  }

  function shortMonth(d) {
    return new Intl.DateTimeFormat(LANG === "el" ? "el-GR" : "en-GB",
      { month: "short" }).format(d).replace(".", "");
  }
  function shortDate(d) { return dayNum(d) + " " + shortMonth(d); }

  // Wave 2: one anchor, two scales — list walks weeks (±7 days),
  // calendar walks months (1st-of-month ±1 month).
  function monthAdd(d, n) {
    var x = new Date(d);
    x.setDate(1);
    x.setMonth(x.getMonth() + n);
    return x;
  }
  function renderPeriod() {
    if (viewMode === "stats") {
      els.plabel.classList.remove("this-week");
      els.plabel.textContent = "";
      return;
    }
    if (viewMode !== "cal") {
      var ws = weekStart(period);
      var we = addDays(ws, 6);
      var thisWk = dateKey(ws) === dateKey(weekStart(todayStart()));
      els.plabel.classList.toggle("this-week", thisWk);
      if (thisWk) {
        els.plabel.textContent = t("this.week");
      } else {
        var range = shortDate(ws) + " – " + shortDate(we);
        els.plabel.textContent = t("week.of").replace("{s}", range);
      }
    } else {
      els.plabel.classList.remove("this-week");
      els.plabel.textContent = monthYearLabel(period);
    }
  }

    function renderStatics() {
    els.btnAdd.innerHTML = ICO_PLUS + "<span>" + esc(t("add")) + "</span>";
    els.btnAdd.title = t("add");
    els.btnAdd.setAttribute("aria-label", t("add"));
    els.btnVList.textContent = t("view.list");
    els.btnVCal.textContent = t("view.cal");
    els.btnVStats.textContent = t("view.stats");
    els.btnVList.classList.toggle("active", viewMode === "list");
    els.btnVCal.classList.toggle("active", viewMode === "cal");
    els.btnVStats.classList.toggle("active", viewMode === "stats");
    els.btnSet.innerHTML = ICO_GEAR;
    els.btnSet.title = t("settings");
    els.btnSet.setAttribute("aria-label", t("settings"));
    els.btnNow.innerHTML = ICO_TODAY;
    els.btnNow.title = t("today");
    els.btnNow.setAttribute("aria-label", t("today"));
    els.btnPrev.setAttribute("aria-label", t(viewMode === "cal" ? "month.prev" : "week.prev"));
    els.btnNext.setAttribute("aria-label", t(viewMode === "cal" ? "month.next" : "week.next"));
    els.btnPrev.innerHTML = ICO_CHEVL;
    els.btnNext.innerHTML = ICO_CHEVR;
    // stats view has no period navigation → disable the cluster
    els.btnPrev.disabled = viewMode === "stats";
    els.btnNow.disabled = viewMode === "stats";
    els.btnNext.disabled = viewMode === "stats";
    els.btnPrev.title = t(viewMode === "cal" ? "month.prev" : "week.prev");
    els.btnNext.title = t(viewMode === "cal" ? "month.next" : "week.next");
    document.title = t("app.name") + " · orOS";
  }

  // ---- day cells: one state vocabulary for list, calendar, heatmap ----
  function alphaHex(a) {
    var n = Math.max(0, Math.min(255, Math.round(a * 255)));
    return (n < 16 ? "0" : "") + n.toString(16);
  }
  function cellInfo(h, d, todayK) {
    var k = dateKey(d);
    var done = isDone(h.id, k);
    var skip = !done && isSkipped(h.id, k);
    var note = noteOn(h.id, k);
    var val = isNum(h) ? valueOn(h.id, k) : null;
    var future = k > todayK;
    var fixedOff = HC.isFixed(h) && !isScheduledOn(h, d);
    var prog = isNum(h) ? HC.progress(ix(), h, k) : (done ? 1 : 0);
    return {
      k: k, d: d, done: done, skip: skip, note: note, val: val, future: future,
      fixedOff: fixedOff, prog: prog, today: k === todayK,
      // past/today AND (scheduled OR flexible OR already holds something → undo)
      locked: future || (fixedOff && !done && !skip && !note && val === null)
    };
  }
  function cellTip(h, c) {
    var parts = [shortDate(c.d)];
    if (c.val !== null) parts.push(withUnit(c.val, h.num.u));
    if (c.skip) parts.push(t("skipped"));
    if (c.note) parts.push("“" + c.note + "”");
    if (!c.locked) parts.push(t(isNum(h) ? "dot.tip.num" : "dot.tip"));
    return parts.join(" · ");
  }
  function cellHtml(h, c, base, label, attrs) {
    var cls = base;
    if (c.done) cls += " completed";
    else if (c.skip) cls += " skipped";
    else if (c.prog > 0) cls += " partial";
    if (c.note) cls += " noted";
    if (c.today) cls += " today";
    if (c.future) cls += " future";
    if (c.fixedOff && !c.done && !c.skip) cls += " not-scheduled";
    var style = "";
    if (c.done) style = "background:" + h.color + ";border-color:" + h.color;
    else if (c.prog > 0 && !c.skip) style = "background:" + h.color + alphaHex(0.18 + 0.4 * c.prog) + ";border-color:" + h.color;
    var text = (isNum(h) && c.val !== null) ? fmtCompact(c.val) : label;
    var tip = cellTip(h, c);
    return '<button type="button" class="' + cls + '"' + (style ? ' style="' + style + '"' : "") +
      ' title="' + esc(tip) + '" aria-label="' + esc(h.name + " · " + tip) + '" ' + attrs + ">" + esc(text) + "</button>";
  }
  // small strength ring + percent
  function ringHtml(pct, color) {
    var r = 6, len = 2 * Math.PI * r, on = len * pct / 100;
    return '<svg class="ring" viewBox="0 0 16 16" aria-hidden="true">' +
      '<circle cx="8" cy="8" r="6" class="ring-bg"/>' +
      '<circle cx="8" cy="8" r="6" class="ring-fg" style="stroke:' + color + '" stroke-dasharray="' +
      on.toFixed(2) + " " + len.toFixed(2) + '" transform="rotate(-90 8 8)"/></svg>';
  }
  function strengthHtml(h, sc) {
    return '<span class="habit-strength" title="' + esc(tpl("strength.tip", { n: sc })) + '">' +
      ringHtml(sc, h.color) + "<span>" + sc + "%</span></span>";
  }
  function periodBadge(h) {
    var pr = HC.perOf(h);
    var txt = freqBadge(h);
    if (pr) {
      var pc = HC.periodCount(ix(), h, todayKey());
      txt += " · " + Math.min(pc.done + pc.skip, pr.n) + "/" + pr.n;
      return '<span class="habit-freq-badge" title="' + esc(tpl(pr.p === "w" ? "period.w" : "period.m",
        { a: pc.done + pc.skip, b: pr.n })) + '">' + esc(txt) + "</span>";
    }
    return '<span class="habit-freq-badge">' + esc(txt) + "</span>";
  }
  function bellHtml(h) {
    if (typeof h.rem !== "number") return "";
    var tip = tpl("rem.at", { t: hm(h.rem) });
    return '<span class="habit-bell" title="' + esc(tip) + '" aria-label="' + esc(tip) + '"><span class="ico">' + ICO_BELL + "</span></span>";
  }
  // measurable: today's value with quick − / +
  function qtyHtml(h) {
    if (!isNum(h)) return "";
    var v = valueOn(h.id, todayKey());
    var txt = fmtNum(v === null ? 0 : v) + " / " + withUnit(h.num.t, h.num.u);
    return '<span class="qty">' +
      '<button type="button" class="qbtn" data-act="dec" data-h="' + esc(h.id) + '" title="' + esc(t("dec")) + '" aria-label="' + esc(t("dec")) + '">' + ICO_MINUS + "</button>" +
      '<span class="qty-val" title="' + esc(t("today") + " · " + targetText(h)) + '">' + (h.num.c === "le" ? "≤ " : "") + esc(txt) + "</span>" +
      '<button type="button" class="qbtn" data-act="inc" data-h="' + esc(h.id) + '" title="' + esc(t("inc")) + '" aria-label="' + esc(t("inc")) + '">' + ICO_PLUS + "</button>" +
      "</span>";
  }
  function emptyHtml() {
    return '<div class="empty">' + ICONS.check +
      '<h2>' + esc(t("empty.title")) + "</h2>" +
      "<p>" + esc(t("empty.desc")) + "</p>" +
      '<button class="btn prim" data-act="new">' + esc(t("empty.cta")) + "</button>" +
      "</div>";
  }

  // ---- main render (list view, Wave 1) ----
  function render() {
    renderStatics();
    renderPeriod();
    if (viewMode === "stats") { renderStats(); return; }
    if (viewMode === "cal") { renderCalendar(); return; }

    var hs = livingHabits();
    var html = "";

    if (!hs.length) {
      html = emptyHtml();
    } else {
      var week = weekDays(period);
      var todayK = todayKey();
      html += '<div class="habit-list">';

      for (var i = 0; i < hs.length; i++) {
        var h = hs[i];
        var st = streakInfo(h);
        var sc = strength(h);

        // week dots — Monday-first
        var dots = "";
        for (var w = 0; w < 7; w++) {
          var c = cellInfo(h, week[w], todayK);
          dots += cellHtml(h, c, "wdot", t("dkey." + w), 'data-act="dot" data-h="' + esc(h.id) + '" data-i="' + w + '"');
        }

        html +=
          '<div class="habit-row" data-h="' + esc(h.id) + '">' +
            '<div class="habit-icon-box" data-act="detail" data-h="' + esc(h.id) + '" role="button" tabindex="0" title="' + esc(h.name) +
              '" style="background:' + h.color + '33;color:' + h.color + '">' +
              '<span class="ico">' + ICONS[h.icon] + "</span></div>" +
            '<div class="habit-info">' +
              '<div class="habit-name" data-act="detail" data-h="' + esc(h.id) + '" role="button" tabindex="0">' + esc(h.name) + "</div>" +
              '<div class="habit-meta">' +
                '<span class="habit-streak" title="' + esc(streakTipOf(st)) + '">' +
                  '<span class="ico">' + ICONS.fire + "</span>" +
                  '<span class="habit-streak-value' + (st.cur ? "" : " zero") + '">' + st.cur + esc(st.cur ? streakSuffix(st) : "") + "</span></span>" +
                strengthHtml(h, sc) +
                periodBadge(h) +
                bellHtml(h) +
                qtyHtml(h) +
              "</div></div>" +
            '<div class="week-dots">' + dots + "</div>" +
            '<div class="habit-actions">' +
              '<button type="button" class="btn ghost" data-act="edit" data-h="' + esc(h.id) + '" title="' + esc(t("rename")) + '" aria-label="' + esc(t("rename")) + '">' + ICO_PEN + "</button>" +
              '<button type="button" class="btn ghost" data-act="del"  data-h="' + esc(h.id) + '" title="' + esc(t("del")) + '" aria-label="' + esc(t("del")) + '">' + ICO_TRASH + "</button>" +
            "</div>" +
          "</div>";
      }
      html += "</div>";
    }
    html += feedListHtml();

    els.view.innerHTML = html;
  }

  // App feeds in the list view: same row anatomy, read-only dots
  // (spans), one action that opens the provider app. A measurable
  // feed (Steps) shows the value in its dots and today's value.
  function feedDotHtml(f, d, today, base, label) {
    var k = dateKey(d);
    var done = feedDone(f, k);
    var v = feedVal(f, k);
    var cls = base + " feed";
    var style = "";
    if (done) { cls += " completed"; style = "background:" + f.color + ";border-color:" + f.color; }
    else if (v !== null && f.goal) { cls += " partial"; style = "background:" + f.color + alphaHex(0.18 + 0.4 * Math.min(1, v / f.goal)) + ";border-color:" + f.color; }
    if (isSameDayLocal(d, today)) cls += " today";
    if (d > today) cls += " future";
    return '<span class="' + cls + '"' + (style ? ' style="' + style + '"' : "") + ' title="' + esc(shortDate(d) + (v !== null ? " · " + feedTip(f, k) : "")) + '">' +
      esc(v !== null ? fmtCompact(v) : label) + "</span>";
  }
  function feedListHtml() {
    var feeds = feedRows();
    if (!feeds.length) return "";
    var week = weekDays(period);
    var today = todayStart();
    var html = '<div class="habit-list feed-list">';
    for (var i = 0; i < feeds.length; i++) {
      var f = feeds[i];
      var st = feedStreak(f);
      var dots = "";
      for (var w = 0; w < 7; w++) dots += feedDotHtml(f, week[w], today, "wdot", t("dkey." + w));
      var streakTip = st ? fmt(st === 1 ? "streak" : "streaks", st) : t("streak.zero");
      var open = t("feed.open").replace("{app}", f.name);
      var tv = feedVal(f, dateKey(today));
      var valHtml = f.vals ? '<span class="qty-val feed-val">' + esc(fmtNum(tv === null ? 0 : tv) +
        (f.goal ? " / " + fmtNum(f.goal) : "") + (f.unit ? " " + f.unit : "")) + "</span>" : "";
      html +=
        '<div class="habit-row feed-row" data-feed="' + esc(f.id) + '">' +
          '<div class="habit-icon-box" style="background:' + f.color + '33;color:' + f.color + '">' +
            '<span class="ico">' + f.icon + "</span></div>" +
          '<div class="habit-info">' +
            '<div class="habit-name">' + esc(f.name) + "</div>" +
            '<div class="habit-meta">' +
              '<span class="habit-streak" title="' + esc(streakTip) + '">' +
                '<span class="ico">' + ICONS.fire + "</span>" +
                '<span class="habit-streak-value' + (st ? "" : " zero") + '">' + st + "</span></span>" +
              '<span class="habit-freq-badge" title="' + esc(f.hint) + '">' + esc(t("feed.badge")) + "</span>" +
              valHtml +
            "</div></div>" +
          '<div class="week-dots" title="' + esc(f.hint) + '">' + dots + "</div>" +
          '<div class="habit-actions">' +
            '<button type="button" class="btn ghost" data-act="feed-open" data-app="' + esc(f.app) +
              '" title="' + esc(open) + '" aria-label="' + esc(open) + '">' + ICO_CHEVR + "</button>" +
          "</div>" +
        "</div>";
    }
    return html + "</div>";
  }

  function isSameDayLocal(a, b) { return dateKey(a) === dateKey(b); }

  // ===== CALENDAR VIEW (Wave 2) =====
  // Rows = living habits (sticky gutter: name + streak), columns =
  // days of the month. Cells reuse the EXACT state vocabulary and
  // toggle rules of the list view (cellInfo / cellHtml): ONE data
  // path, two presentations. The gutter opens the habit's details.
  function monthDays(anchor) {
    var x = new Date(anchor);
    x.setDate(1);
    var out = [];
    var y = x.getFullYear(), m = x.getMonth();
    for (var i = 1; i <= 31; i++) {
      var d = new Date(y, m, i);
      if (d.getMonth() !== m) break;
      out.push(d);
    }
    return out;
  }

  function renderCalendar() {
    var hs = livingHabits();
    var feeds = feedRows();
    var days = monthDays(period);
    var today = todayStart();
    var todayK = dateKey(today);
    var html = "";

    if (!hs.length) html = emptyHtml();
    if (hs.length || feeds.length) {
      html += '<div class="cal-wrap"><table class="cal-table">';

      // header: day numbers of the month (today accented)
      html += '<thead><tr><th class="cal-gutter"></th>';
      for (var hd = 0; hd < days.length; hd++) {
        html += '<th class="cal-day-head' +
          (isSameDayLocal(days[hd], today) ? " today" : "") + '">' +
          dayNum(days[hd]) + "</th>";
      }
      html += "</tr></thead><tbody>";

      for (var r = 0; r < hs.length; r++) {
        var h = hs[r];
        var st = streakInfo(h);

        html +=
          "<tr>" +
            '<td class="cal-gutter"><div class="cal-gcell" data-act="detail" data-h="' + esc(h.id) +
              '" role="button" tabindex="0" title="' + esc(h.name) + '">' +
              '<span class="cal-gicon" style="background:' + h.color + "33;color:" + h.color + '">' +
                '<span class="ico">' + ICONS[h.icon] + "</span></span>" +
              '<span class="cal-gname">' + esc(h.name) + "</span>" +
              '<span class="cal-gstreak" title="' + esc(streakTipOf(st)) + '">' +
                '<span class="ico">' + ICONS.fire + "</span>" +
                '<span class="cal-gstreak-value' + (st.cur ? "" : " zero") + '">' + st.cur + "</span></span>" +
            "</div></td>";

        for (var c = 0; c < days.length; c++) {
          var ci = cellInfo(h, days[c], todayK);
          html += "<td>" + cellHtml(h, ci, "cdot", dayNum(days[c]), 'data-act="cdot" data-h="' + esc(h.id) + '" data-c="' + c + '"') + "</td>";
        }
        html += "</tr>";
      }
      // app feeds: same cells, read-only (spans), gutter opens the app
      for (var fr = 0; fr < feeds.length; fr++) {
        var f = feeds[fr];
        var fst = feedStreak(f);
        var fTip = fst ? fmt(fst === 1 ? "streak" : "streaks", fst) : t("streak.zero");
        var fOpen = t("feed.open").replace("{app}", f.name);
        html +=
          '<tr class="feed-tr">' +
            '<td class="cal-gutter"><div class="cal-gcell feed" data-act="feed-open" data-app="' + esc(f.app) +
              '" role="button" tabindex="0" title="' + esc(f.hint || fOpen) + '" aria-label="' + esc(fOpen) + '">' +
              '<span class="cal-gicon" style="background:' + f.color + "33;color:" + f.color + '">' +
                '<span class="ico">' + f.icon + "</span></span>" +
              '<span class="cal-gname">' + esc(f.name) + "</span>" +
              '<span class="cal-gstreak" title="' + esc(fTip) + '">' +
                '<span class="ico">' + ICONS.fire + "</span>" +
                '<span class="cal-gstreak-value' + (fst ? "" : " zero") + '">' + fst + "</span></span>" +
            "</div></td>";
        for (var fc = 0; fc < days.length; fc++) {
          html += "<td>" + feedDotHtml(f, days[fc], today, "cdot", dayNum(days[fc])) + "</td>";
        }
        html += "</tr>";
      }
      html += "</tbody></table></div>";
    }
    els.view.innerHTML = html;
  }

  // ===== STATS VIEW (Wave 3) =====
  // Read-only analytics over the SAME data path (core.js): no second
  // source of truth, no writes, nothing enters the sync slice. Range
  // pref (30/90/all) is device-local, like the view pref. Skipped days
  // leave the rates; X-per-period habits are rated per period.
  function parseDateKey(s) {
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    return p ? new Date(+p[1], +p[2] - 1, +p[3]) : null;
  }

  function rangeStart() {
    if (!statRange) {                    // all-time → earliest day with data
      var out = todayStart();
      var first = ix().first;
      for (var k in first) {
        if (!first.hasOwnProperty(k)) continue;
        var cd = parseDateKey(first[k]);
        if (cd && cd < out) out = cd;
      }
      return out;
    }
    return addDays(todayStart(), -(statRange - 1));
  }
  // X per period: periods met / periods counted (the current one only
  // once met: it is still running)
  function periodRate(h, start, today) {
    var pr = HC.perOf(h), sK = dateKey(start), tK = dateKey(today);
    var first = ix().first[h.id];
    if (!pr || !first) return { met: 0, total: 0 };
    var from = first > sK ? first : sK;
    var p = HC.periodStart(from, pr.p), cur = HC.periodStart(tK, pr.p), met = 0, total = 0, g = 0;
    while (p <= cur && g++ < 2000) {
      var ok = HC.periodMet(ix(), h, p);
      if (ok) met++;
      if (ok || p !== cur) total++;
      p = HC.addDays(HC.periodEnd(p, pr.p), 1);
    }
    return { met: met, total: total };
  }
  function computeStats(hs) {
    var start = rangeStart();
    var today = todayStart();
    var sK = dateKey(start), tK = dateKey(today);
    var per = [], i, j;
    for (i = 0; i < hs.length; i++) per.push({ h: hs[i], sched: 0, done: 0, sum: 0, logged: 0 });

    var byId = {};
    for (i = 0; i < hs.length; i++) byId[hs[i].id] = per[i];

    var totalComps = 0;
    var comps = db.comps;
    for (i = 0; i < comps.length; i++) {
      var p0 = byId[comps[i].habitId];
      // HB-5: skip comps whose habit has been deleted
      if (!p0 || comps[i].date < sK || comps[i].date > tK) continue;
      if (isDone(comps[i].habitId, comps[i].date)) totalComps++;
      if (isNum(p0.h)) {
        var v = HC.compValue(comps[i]);
        if (v !== null) { p0.sum += v; p0.logged++; }
      }
    }

    var perfect = 0, dayCount = 0;
    for (var d = new Date(start); d <= today; d = addDays(d, 1)) {
      dayCount++;
      var dk = dateKey(d);
      var any = false, allDone = true;
      for (j = 0; j < hs.length; j++) {
        if (isScheduledOn(hs[j], d) && !isSkipped(hs[j].id, dk)) {
          var dn = isDone(hs[j].id, dk);
          if (dk === tK && !dn) continue;          // today not done yet is not a miss
          any = true;
          per[j].sched++;
          if (dn) per[j].done++;
          else allDone = false;
        }
      }
      if (any && allDone) perfect++;
    }
    return {
      per: per,
      totalComps: totalComps,
      perfect: perfect,
      dayCount: dayCount,
      avgWeek: dayCount > 0 ? fmtNum(Math.round(totalComps / (dayCount / 7) * 10) / 10) : "0"
    };
  }
  function halfRate(hs, from, to) {
    var sched = 0, done = 0;
    for (var d = new Date(from); d <= to; d = addDays(d, 1)) {
      var dk = dateKey(d);
      for (var j = 0; j < hs.length; j++) {
        if (isScheduledOn(hs[j], d) && !isSkipped(hs[j].id, dk)) {
          sched++;
          if (isDone(hs[j].id, dk)) done++;
        }
      }
    }
    return sched ? Math.round((done / sched) * 100) : -1;
  }
  function tpl(key, vars) {
    var s = t(key);
    for (var k in vars) s = s.split("{" + k + "}").join(String(vars[k]));
    return s;
  }
  function genInsights(hs, sd) {
    var ins = [], i;
    // 1) most consistent habit (needs ≥7 scheduled days, ≥50% rate)
    var best = null;
    for (i = 0; i < sd.per.length; i++) {
      var p = sd.per[i];
      if (p.sched >= 7 && (!best || p.done / p.sched > best.done / best.sched)) best = p;
    }
    if (best && best.done / best.sched >= 0.5) {
      ins.push(tpl("ins.top", { n: esc(best.h.name), p: Math.round((best.done / best.sched) * 100) }));
    }
    // 2) perfect days (non-trivial threshold)
    if (sd.perfect >= 3) ins.push(tpl("ins.perfect", { n: sd.perfect }));
    // 3) 30-day trend: older 15d half vs recent 15d half
    var today = todayStart();
    var older = halfRate(hs, addDays(today, -29), addDays(today, -15));
    var recent = halfRate(hs, addDays(today, -14), today);
    if (older >= 0 && recent >= 0 && recent - older >= 8) ins.push(tpl("ins.up", { a: older, b: recent }));
    else if (older >= 0 && recent >= 0 && older - recent >= 8) ins.push(tpl("ins.down", { a: older, b: recent }));
    if (!ins.length) ins.push(t("ins.none"));
    return ins;
  }
  function statCard(num, lbl) {
    return '<div class="stat-card"><div class="stat-num">' + num + '</div>' +
      '<div class="stat-lbl">' + esc(lbl) + "</div></div>";
  }
  // strength sparkline over [fromK..today]
  function sparkHtml(h, fromK) {
    var ser = HC.scoreSeries(ix(), h, todayKey()).filter(function (p) { return p.d >= fromK; });
    if (ser.length < 2) return "";
    var pts = [], n = ser.length;
    for (var i = 0; i < n; i++) pts.push((i / (n - 1) * 100).toFixed(2) + "," + (22 - ser[i].s * 20).toFixed(2));
    return '<svg class="spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">' +
      '<polyline points="' + pts.join(" ") + '" style="stroke:' + h.color + '"/></svg>';
  }
  function renderStats() {
    var hs = livingHabits();
    if (!hs.length) {
      els.view.innerHTML = emptyHtml();
      return;
    }
    var sd = computeStats(hs);
    var start = rangeStart(), today = todayStart(), sK = dateKey(start);
    var html = '<div class="stat-wrap">';

    // range chips (reuse .day-chip styling)
    var ranges = [[30, "range.30"], [90, "range.90"], [0, "range.all"]];
    html += '<div class="range-row">';
    for (var r = 0; r < ranges.length; r++) {
      html += '<button type="button" class="day-chip' +
        (statRange === ranges[r][0] ? " on" : "") +
        '" data-act="rng" data-rng="' + ranges[r][0] + '">' + esc(t(ranges[r][1])) + "</button>";
    }
    html += "</div>";

    html += '<div class="stat-cards">' +
      statCard(sd.totalComps, t("stats.total.comps")) +
      statCard(hs.length, t("stats.active.habits")) +
      statCard(sd.avgWeek, t("stats.avg.week")) +
      statCard(sd.perfect, t("stats.perfect.days")) +
      "</div>";

    html += '<div class="stat-h">' + esc(t("stats.per.habit")) + "</div>";
    var rows = sd.per.map(function (p) {
      var pr = HC.perOf(p.h);
      if (pr) {
        var pq = periodRate(p.h, start, today);
        p.rate = pq.total ? pq.met / pq.total : 0;
        p.pct = Math.round(p.rate * 100);
        p.rateTip = tpl(pr.p === "w" ? "stats.periods.w" : "stats.periods.m", { n: p.pct });
      } else if (!isFlexible(p.h)) {
        p.rate = p.sched ? p.done / p.sched : 0;
        p.pct = Math.round(p.rate * 100);
        p.rateTip = tpl("stats.rate", { n: p.pct });
      } else {
        p.rate = -1;
      }
      return p;
    }).sort(function (a, b) { return b.rate - a.rate; });
    for (var i = 0; i < rows.length; i++) {
      var p = rows[i], h = p.h, st = streakInfo(h), sc = strength(h);
      var nums = t("stats.current") + " " + st.cur + streakSuffix(st) + " · " +
                 t("stats.longest") + " " + st.best + streakSuffix(st);
      if (p.rate < 0) {
        // HB-1b: flexible → raw count, no %, no bar.
        var cnt = 0;
        for (var q = 0; q < db.comps.length; q++) {
          var cq = db.comps[q];
          if (cq.habitId === h.id && cq.date >= sK && cq.date <= dateKey(today) && isDone(h.id, cq.date)) cnt++;
        }
        nums += " · " + cnt + " " + t("stats.total.comps").toLowerCase();
      } else {
        nums += " · " + p.pct + "%";
      }
      if (isNum(h) && p.logged) nums += " · " + tpl("stats.avg", { v: withUnit(Math.round(p.sum / p.logged * 100) / 100, h.num.u) });
      html += '<div class="srow" data-act="detail" data-h="' + esc(h.id) + '" role="button" tabindex="0">' +
        '<span class="cal-gicon" style="background:' + h.color + "33;color:" + h.color + '">' +
          '<span class="ico">' + ICONS[h.icon] + "</span></span>" +
        '<div class="srow-body">' +
          '<div class="srow-top">' +
            '<span class="srow-name">' + esc(h.name) + "</span>" +
            strengthHtml(h, sc) +
          "</div>" +
          '<div class="srow-nums"' + (p.rateTip ? ' title="' + esc(p.rateTip) + '"' : "") + ">" + esc(nums) + "</div>" +
          (p.rate >= 0 ? '<div class="sbar"><div class="sbar-fill" style="width:' + p.pct + "%;background:" + h.color + '"></div></div>' : "") +
          sparkHtml(h, sK) +
        "</div></div>";
    }

    html += '<div class="stat-h">' + esc(t("stats.insights")) + "</div>";
    var ins = genInsights(hs, sd);
    html += '<div class="insights">';
    for (var k = 0; k < ins.length; k++) {
      html += '<div class="insight"><span class="ico">' + ICONS.check + "</span>" +
        "<span>" + ins[k] + "</span></div>";
    }
    html += "</div></div>";
    els.view.innerHTML = html;
  }

  // ===== TOAST (lazy, top-right pinned) =====
  var toastTimer = null;
  function toast(msg) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.hidden = false;
    requestAnimationFrame(function () { els.toast.classList.add("show"); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove("show");
      setTimeout(function () { els.toast.hidden = true; }, 250);
    }, 2600);
  }

  // Unified notifications (orOS doctrine): informational toasts route
  // through orosNotifs.transient(). All habit toasts are non-undoing —
  // actions have confirm dialogs. Falls back to local toast when
  // standalone.
  function transientNote(text) {
    var api = null;
    try { api = window.parent.orosNotifs; } catch (e) {}
    if (!api && window.orosNotifs) api = window.orosNotifs;
    if (api && typeof api.transient === "function") {
      api.transient({ ns: "habits", title: text, body: "" });
    } else {
      toast(text);
    }
  }

  // ===== HABIT DIALOG (add / edit — one lazy modal) =====
  var dlgHabit = null;
  var editing = null;                 // habit object or null (add mode)
  var editBase = null;                // HB-9: field values shown at open
  var pickIcon = "check";
  var pickColor = COLORS[0];
  var pickDays = [false,false,false,false,false,false,false];
  var pickType = "bool";              // "bool" | "num"
  var pickFreq = "days";              // "days" | "w" | "m"

  function segHtml(id, opts) {
    var h = '<div class="seg seg-sm" role="group" id="' + id + '">';
    for (var i = 0; i < opts.length; i++) {
      h += '<button type="button" class="seg-btn" data-v="' + opts[i] + '"></button>';
    }
    return h + "</div>";
  }
  function ensureHabitDialog() {
    if (dlgHabit) return;
    dlgHabit = document.createElement("dialog");
    dlgHabit.className = "dlg-habit";
    dlgHabit.innerHTML =
      '<h3 id="hf-title"></h3>' +
      '<div class="dialog-form">' +
        '<div class="field"><label id="hf-namel" for="hf-name"></label>' +
          '<input type="text" id="hf-name" maxlength="200" autocomplete="off">' +
          '<div class="dialog-err" id="hf-err"></div></div>' +
        '<div class="field"><label id="hf-typel"></label>' + segHtml("hf-type", ["bool", "num"]) + "</div>" +
        '<div class="field" id="hf-numbox">' +
          '<label id="hf-targetl" for="hf-target"></label>' +
          '<div class="frow">' +
            '<select id="hf-cmp"><option value="ge"></option><option value="le"></option></select>' +
            '<input type="number" id="hf-target" min="0" step="any" inputmode="decimal">' +
            '<input type="text" id="hf-unit" maxlength="16" autocomplete="off">' +
          "</div>" +
          '<div class="frow frow-step"><label id="hf-stepl" for="hf-step"></label>' +
            '<input type="number" id="hf-step" min="0" step="any" inputmode="decimal"></div>' +
          '<div class="dialog-err" id="hf-terr"></div></div>' +
        '<div class="field"><label id="hf-iconl"></label>' +
          '<div class="icon-picker" id="hf-icons"></div></div>' +
        '<div class="field"><label id="hf-colorl"></label>' +
          '<div class="color-picker" id="hf-colors"></div></div>' +
        '<div class="field"><label id="hf-freql"></label>' + segHtml("hf-freq", ["days", "w", "m"]) +
          '<div class="days-selector" id="hf-days"></div>' +
          '<div class="frow" id="hf-perbox"><input type="number" id="hf-per" min="1" max="31" step="1" inputmode="numeric">' +
            '<span id="hf-perl" class="frow-lbl"></span></div>' +
          '<div class="field-hint" id="hf-daysl"></div></div>' +
        '<div class="field"><label id="hf-reml" for="hf-rem"></label>' +
          '<div class="frow"><input type="time" id="hf-rem">' +
            '<button type="button" class="btn ghost" id="hf-remclr"></button></div>' +
          '<div class="field-hint" id="hf-remhint"></div></div>' +
      "</div>" +
      '<div class="dialog-actions">' +
        '<button type="button" class="btn danger" id="hf-del" hidden></button>' +
        '<span style="flex:1"></span>' +
        '<button type="button" class="btn ghost" id="hf-cancel"></button>' +
        '<button type="button" class="btn prim" id="hf-save"></button>' +
      "</div>";
    document.body.appendChild(dlgHabit);

    document.getElementById("hf-cancel").addEventListener("click", function () { dlgHabit.close(); });
    document.getElementById("hf-save").addEventListener("click", saveHabitDialog);
    document.getElementById("hf-del").addEventListener("click", function () {
      if (!editing) return;
      dlgHabit.close();
      confirmDelete(editing);
    });
    // Enter in the name field submits
    document.getElementById("hf-name").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); saveHabitDialog(); }
    });
    document.getElementById("hf-type").addEventListener("click", function (e) {
      var b = e.target.closest("[data-v]");
      if (b) { pickType = b.getAttribute("data-v"); syncHabitDialog(); }
    });
    document.getElementById("hf-freq").addEventListener("click", function (e) {
      var b = e.target.closest("[data-v]");
      if (b) { pickFreq = b.getAttribute("data-v"); syncHabitDialog(); }
    });
    document.getElementById("hf-per").addEventListener("input", updateDaysHint);
    document.getElementById("hf-remclr").addEventListener("click", function () {
      document.getElementById("hf-rem").value = "";
    });
  }
  // show / hide the parts that depend on type and frequency
  function syncHabitDialog() {
    [].forEach.call(document.querySelectorAll("#hf-type .seg-btn"), function (b) {
      b.classList.toggle("active", b.getAttribute("data-v") === pickType);
      b.setAttribute("aria-pressed", b.getAttribute("data-v") === pickType ? "true" : "false");
    });
    [].forEach.call(document.querySelectorAll("#hf-freq .seg-btn"), function (b) {
      b.classList.toggle("active", b.getAttribute("data-v") === pickFreq);
      b.setAttribute("aria-pressed", b.getAttribute("data-v") === pickFreq ? "true" : "false");
    });
    document.getElementById("hf-numbox").hidden = pickType !== "num";
    document.getElementById("hf-days").hidden = pickFreq !== "days";
    document.getElementById("hf-perbox").hidden = pickFreq === "days";
    var per = document.getElementById("hf-per");
    per.max = pickFreq === "w" ? "7" : "31";
    updateDaysHint();
  }

  // pre (add mode only): M.asNew values (Assistant entry card) shown
  // in place of the empty defaults; nothing is saved until Save.
  function openHabitDialog(h, pre) {
    ensureHabitDialog();
    editing = h || null;
    var pr = h ? HC.perOf(h) : null;
    // HB-9: what the dialog showed at open — Save compares against
    // it and writes only what the user changed
    editBase = h ? { id: h.id, name: h.name, icon: h.icon, color: h.color,
                     days: h.days.slice(), num: h.num ? JSON.stringify(h.num) : "",
                     per: h.per ? JSON.stringify(h.per) : "",
                     rem: typeof h.rem === "number" ? h.rem : -1 } : null;

    // labels refreshed on EVERY open — language-safe without rebuild
    document.getElementById("hf-title").textContent = t(h ? "edit" : "add");
    document.getElementById("hf-namel").textContent = t("name.label");
    document.getElementById("hf-typel").textContent = t("type.label");
    document.querySelector('#hf-type [data-v="bool"]').textContent = t("type.bool");
    document.querySelector('#hf-type [data-v="num"]').textContent = t("type.num");
    document.getElementById("hf-targetl").textContent = t("target.label");
    document.querySelector('#hf-cmp [value="ge"]').textContent = t("cmp.ge");
    document.querySelector('#hf-cmp [value="le"]').textContent = t("cmp.le");
    document.getElementById("hf-cmp").setAttribute("aria-label", t("target.label"));
    var unitEl = document.getElementById("hf-unit");
    unitEl.placeholder = t("unit.ph");
    unitEl.setAttribute("aria-label", t("unit.label"));
    document.getElementById("hf-stepl").textContent = t("step.label");
    document.getElementById("hf-iconl").textContent = t("icon.label");
    document.getElementById("hf-colorl").textContent = t("color.label");
    document.getElementById("hf-freql").textContent = t("freq.label");
    document.querySelector('#hf-freq [data-v="days"]').textContent = t("freq.mode.days");
    document.querySelector('#hf-freq [data-v="w"]').textContent = t("freq.mode.w");
    document.querySelector('#hf-freq [data-v="m"]').textContent = t("freq.mode.m");
    document.getElementById("hf-per").setAttribute("aria-label", t("per.times"));
    document.getElementById("hf-reml").textContent = t("rem.label");
    document.getElementById("hf-remclr").textContent = t("rem.none");
    document.getElementById("hf-remhint").textContent = t("rem.note");
    document.getElementById("hf-cancel").textContent = t("cancel");
    document.getElementById("hf-save").textContent = t("save");
    var delBtn = document.getElementById("hf-del");
    delBtn.textContent = t("del");
    delBtn.hidden = !editing;

    document.getElementById("hf-err").textContent = "";
    document.getElementById("hf-terr").textContent = "";
    var nameEl = document.getElementById("hf-name");
    nameEl.value = h ? h.name : "";
    pickIcon = h ? (ICONS[h.icon] ? h.icon : "check") : "check";
    pickColor = h ? (COLORS.indexOf(h.color) !== -1 ? h.color : COLORS[0]) : COLORS[0];
    pickType = h && isNum(h) ? "num" : "bool";
    pickFreq = pr ? pr.p : "days";
    document.getElementById("hf-cmp").value = h && isNum(h) ? h.num.c : "ge";
    document.getElementById("hf-target").value = h && isNum(h) ? String(h.num.t) : "";
    unitEl.value = h && isNum(h) ? h.num.u : "";
    document.getElementById("hf-step").value = h && isNum(h) ? String(h.num.s) : "1";
    document.getElementById("hf-per").value = pr ? String(pr.n) : "3";
    document.getElementById("hf-rem").value = h && typeof h.rem === "number" ? hm(h.rem) : "";
    var i;
    for (i = 0; i < 7; i++) pickDays[i] = h ? (h.days.indexOf(i) !== -1) : false;
    if (!h && pre) {
      nameEl.value = pre.name;
      if (pre.per) { pickFreq = pre.per[0]; document.getElementById("hf-per").value = String(pre.per[1]); }
      for (i = 0; i < 7; i++) pickDays[i] = pre.days.indexOf(i) !== -1;
      if (pre.num) {
        pickType = "num";
        document.getElementById("hf-cmp").value = pre.num.c;
        document.getElementById("hf-target").value = pre.num.t ? String(pre.num.t) : "";
        unitEl.value = pre.num.u;
      }
      if (pre.rem >= 0) document.getElementById("hf-rem").value = hm(pre.rem);
    }

    // icon grid
    var iconGrid = document.getElementById("hf-icons");
    iconGrid.innerHTML = "";
    for (i = 0; i < ICON_KEYS.length; i++) {
      (function (key) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "icon-option" + (key === pickIcon ? " selected" : "");
        b.title = key;
        b.setAttribute("aria-label", key);
        b.innerHTML = '<span class="ico">' + ICONS[key] + "</span>";
        b.addEventListener("click", function () {
          pickIcon = key;
          iconGrid.querySelectorAll(".icon-option").forEach(function (x) { x.classList.remove("selected"); });
          b.classList.add("selected");
        });
        iconGrid.appendChild(b);
      })(ICON_KEYS[i]);
    }

    // color grid
    var colorGrid = document.getElementById("hf-colors");
    colorGrid.innerHTML = "";
    for (i = 0; i < COLORS.length; i++) {
      (function (col) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "color-option" + (col === pickColor ? " selected" : "");
        b.style.background = col;
        b.style.color = col;
        b.setAttribute("aria-label", col);
        b.addEventListener("click", function () {
          pickColor = col;
          colorGrid.querySelectorAll(".color-option").forEach(function (x) { x.classList.remove("selected"); });
          b.classList.add("selected");
        });
        colorGrid.appendChild(b);
      })(COLORS[i]);
    }

    // day chips — Monday-first, live hint underneath the picker
    var daysWrap = document.getElementById("hf-days");
    daysWrap.innerHTML = "";
    for (i = 0; i < 7; i++) {
      (function (idx) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "day-chip" + (pickDays[idx] ? " on" : "");
        b.textContent = t("day." + idx);
        b.addEventListener("click", function () {
          pickDays[idx] = !pickDays[idx];
          b.classList.toggle("on");
          updateDaysHint();
        });
        daysWrap.appendChild(b);
      })(i);
    }
    syncHabitDialog();

    dlgHabit.showModal();
    nameEl.focus();
  }

  // plain-language summary of the current schedule selection
  function perValue() {
    var n = parseInt(document.getElementById("hf-per").value, 10);
    var max = pickFreq === "w" ? 7 : 31;
    return isNaN(n) ? 1 : Math.max(1, Math.min(max, n));
  }
  function updateDaysHint() {
    var hint;
    if (pickFreq === "days") {
      var n = 0;
      for (var i = 0; i < 7; i++) if (pickDays[i]) n++;
      if (n === 0) hint = t("days.any");
      else if (n === 7) hint = t("days.daily");
      else hint = fmt("days.n", n);
    } else {
      hint = fmt(pickFreq === "w" ? "per.w.n" : "per.m.n", perValue());
    }
    document.getElementById("hf-perl").textContent = pickFreq === "m" ? t("freq.mode.m") : t("freq.mode.w");
    document.getElementById("hf-daysl").textContent = hint;
  }
  function parseNum(s) {
    var v = parseFloat(String(s || "").replace(",", "."));
    return isFinite(v) ? v : NaN;
  }

  function saveHabitDialog() {
    var name = document.getElementById("hf-name").value.trim();
    if (!name) {
      document.getElementById("hf-err").textContent = t("toast.name.req");
      document.getElementById("hf-name").focus();
      return;
    }
    var num = null;
    if (pickType === "num") {
      num = M.normNum({
        t: parseNum(document.getElementById("hf-target").value),
        u: document.getElementById("hf-unit").value,
        c: document.getElementById("hf-cmp").value,
        s: parseNum(document.getElementById("hf-step").value)
      });
      if (!num) {
        document.getElementById("hf-terr").textContent = t("err.target");
        document.getElementById("hf-target").focus();
        return;
      }
    }
    var per = pickFreq === "days" ? null : [pickFreq, perValue()];
    var days = [];
    if (!per) for (var i = 0; i < 7; i++) if (pickDays[i]) days.push(i);
    // days array is already ascending (loop order) — matches normalize
    var remV = document.getElementById("hf-rem").value, rem = -1;
    var rm = /^(\d{1,2}):(\d{2})/.exec(remV || "");
    if (rm && +rm[1] < 24 && +rm[2] < 60) rem = (+rm[1]) * 60 + (+rm[2]);

    if (editing) {
      // HB-9: a pull while the dialog was open replaced every row
      // object — `editing` is a detached copy. Resolve the row by id
      // and write only the fields that differ from what was shown.
      var base = editBase;
      var patch = {}, any = false;
      if (name !== base.name) { patch.name = name; any = true; }
      if (pickIcon !== base.icon) { patch.icon = pickIcon; any = true; }
      if (pickColor !== base.color) { patch.color = pickColor; any = true; }
      if (days.join(",") !== base.days.join(",")) { patch.days = days; any = true; }
      if ((num ? JSON.stringify(num) : "") !== base.num) { patch.num = num; any = true; }
      if ((per ? JSON.stringify(per) : "") !== base.per) { patch.per = per; any = true; }
      if (rem !== base.rem) { patch.rem = rem >= 0 ? rem : null; any = true; }
      var cur = habitById(base.id);
      if (!any && cur) { dlgHabit.close(); return; }   // zero-edit close stamps nothing
      if (!cur) {                                        // row vanished: keep the user's edit
        cur = M.normHabit({ id: base.id, name: name, icon: pickIcon, color: pickColor,
                            days: days, num: num, per: per, rem: rem >= 0 ? rem : undefined,
                            mtime: Date.now(), del: false });
        db.habits.push(cur);
        patch = {};
      }
      updateHabit(cur, patch);
      transientNote(t("toast.updated"));
    } else {
      addHabit({ name: name, icon: pickIcon, color: pickColor, days: days, num: num, per: per,
                 rem: rem >= 0 ? rem : undefined });
      transientNote(t("toast.created"));
    }
    dlgHabit.close();
    render();
    refreshOpenDialogs();
  }

  // ===== DAY DIALOG (value, done, skip, note for one habit/day) =====
  var dlgDay = null;
  var dayCtx = null;                  // { id, k, base: { done, skip, note, val } }

  function ensureDayDialog() {
    if (dlgDay) return;
    dlgDay = document.createElement("dialog");
    dlgDay.className = "dlg-day";
    dlgDay.innerHTML =
      '<h3 id="df-title"></h3>' +
      '<div class="df-sub" id="df-sub"></div>' +
      '<div class="dialog-form">' +
        '<div class="field" id="df-numbox"><label id="df-vall" for="df-val"></label>' +
          '<div class="stepper">' +
            '<button type="button" class="btn" id="df-dec"></button>' +
            '<input type="number" id="df-val" step="any" min="0" inputmode="decimal">' +
            '<button type="button" class="btn" id="df-inc"></button>' +
          "</div>" +
          '<div class="field-hint" id="df-target"></div></div>' +
        '<div class="field" id="df-donebox"><label class="check"><input type="checkbox" id="df-done"> <span id="df-donel"></span></label></div>' +
        '<div class="field"><label class="check"><input type="checkbox" id="df-skip"> <span id="df-skipl"></span></label>' +
          '<div class="field-hint" id="df-skiphint"></div></div>' +
        '<div class="field"><label id="df-notel" for="df-note"></label>' +
          '<textarea id="df-note" rows="2" maxlength="' + M.NOTE_LEN + '"></textarea></div>' +
      "</div>" +
      '<div class="dialog-actions">' +
        '<span style="flex:1"></span>' +
        '<button type="button" class="btn ghost" id="df-cancel"></button>' +
        '<button type="button" class="btn prim" id="df-save"></button>' +
      "</div>";
    document.body.appendChild(dlgDay);
    document.getElementById("df-cancel").addEventListener("click", function () { dlgDay.close(); });
    document.getElementById("df-save").addEventListener("click", saveDayDialog);
    function stepBy(sign) {
      var h = dayCtx && habitById(dayCtx.id);
      if (!h || !isNum(h)) return;
      var el = document.getElementById("df-val");
      var v = parseNum(el.value);
      if (isNaN(v)) v = 0;
      el.value = String(Math.max(0, Math.round((v + sign * h.num.s) * 100) / 100));
    }
    document.getElementById("df-dec").addEventListener("click", function () { stepBy(-1); });
    document.getElementById("df-inc").addEventListener("click", function () { stepBy(1); });
    document.getElementById("df-val").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); saveDayDialog(); }
    });
    document.getElementById("df-done").addEventListener("change", function () {
      if (this.checked) document.getElementById("df-skip").checked = false;
    });
    document.getElementById("df-skip").addEventListener("change", function () {
      if (this.checked) document.getElementById("df-done").checked = false;
    });
  }

  function openDayDialog(h, k) {
    if (!h || k > todayKey()) return;
    ensureDayDialog();
    if (dlgDay.open) return;
    var num = isNum(h);
    var c = HC.index(db).comps[h.id + "|" + k];
    var base = {
      done: !num && !!(c && !c.del),
      skip: isSkipped(h.id, k),
      note: noteOn(h.id, k),
      val: num ? valueOn(h.id, k) : null
    };
    dayCtx = { id: h.id, k: k, base: base };
    var d = parseDateKey(k);
    document.getElementById("df-title").textContent = h.name;
    document.getElementById("df-sub").textContent = new Intl.DateTimeFormat(LANG === "el" ? "el-GR" : "en-GB",
      { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
    document.getElementById("df-numbox").hidden = !num;
    document.getElementById("df-donebox").hidden = num;
    document.getElementById("df-vall").textContent = t("day.value") + (num && h.num.u ? " (" + h.num.u + ")" : "");
    document.getElementById("df-dec").innerHTML = ICO_MINUS;
    document.getElementById("df-dec").setAttribute("aria-label", t("dec"));
    document.getElementById("df-inc").innerHTML = ICO_PLUS;
    document.getElementById("df-inc").setAttribute("aria-label", t("inc"));
    document.getElementById("df-val").value = num && base.val !== null ? String(base.val) : "";
    document.getElementById("df-val").placeholder = "0";
    document.getElementById("df-target").textContent = num ? targetText(h) : "";
    document.getElementById("df-donel").textContent = t("day.done");
    document.getElementById("df-done").checked = base.done;
    document.getElementById("df-skipl").textContent = t("day.skip");
    document.getElementById("df-skip").checked = base.skip;
    document.getElementById("df-skiphint").textContent = t("day.skip.hint");
    document.getElementById("df-notel").textContent = t("day.note");
    var note = document.getElementById("df-note");
    note.value = base.note;
    note.placeholder = t("day.note.ph");
    document.getElementById("df-cancel").textContent = t("cancel");
    document.getElementById("df-save").textContent = t("save");
    dlgDay.showModal();
    (num ? document.getElementById("df-val") : document.getElementById("df-done")).focus();
  }

  // Writes only what changed since the dialog opened, on the CURRENT
  // row (a pull meanwhile keeps the other device's fields, HB-9).
  function saveDayDialog() {
    var ctx = dayCtx;
    var h = ctx && habitById(ctx.id);
    if (!h || h.del) { dlgDay.close(); return; }
    var now = Date.now(), changed = false, b = ctx.base;
    var skip = document.getElementById("df-skip").checked;
    var note = document.getElementById("df-note").value.trim().slice(0, M.NOTE_LEN);
    if (isNum(h)) {
      var raw = document.getElementById("df-val").value.trim();
      var v = raw === "" ? null : parseNum(raw);
      if (v !== null && !isNaN(v) && v !== b.val) {
        M.setValue(db, h.id, ctx.k, DEVICE, Math.max(0, Math.min(M.MAX_NUM, v)), now); changed = true;
      }
    } else {
      var done = document.getElementById("df-done").checked;
      if (done !== b.done) { M.setTick(db, h.id, ctx.k, done, now); changed = true; }
    }
    if (skip !== b.skip) { M.setSkip(db, h.id, ctx.k, skip, now); changed = true; }
    if (note !== b.note) { M.setNote(db, h.id, ctx.k, note, now); changed = true; }
    dlgDay.close();
    if (changed) { save(); render(); refreshOpenDialogs(); }
  }

  // ===== DETAIL DIALOG (strength, chart, streaks, year heatmap, notes) =====
  var dlgDetail = null;
  var detailId = null;
  var detailYear = 0;

  function ensureDetailDialog() {
    if (dlgDetail) return;
    dlgDetail = document.createElement("dialog");
    dlgDetail.className = "dlg-detail";
    dlgDetail.innerHTML = '<div id="dt-body"></div>' +
      '<div class="dialog-actions">' +
        '<button type="button" class="btn ghost" id="dt-edit"></button>' +
        '<span style="flex:1"></span>' +
        '<button type="button" class="btn prim" id="dt-close"></button>' +
      "</div>";
    document.body.appendChild(dlgDetail);
    document.getElementById("dt-close").addEventListener("click", function () { dlgDetail.close(); });
    document.getElementById("dt-edit").addEventListener("click", function () {
      var h = habitById(detailId);
      dlgDetail.close();
      if (h && !h.del) openHabitDialog(h);
    });
    dlgDetail.addEventListener("click", function (e) {
      var a = e.target.closest("[data-dt]");
      if (!a) return;
      var act = a.getAttribute("data-dt");
      if (act === "yprev") { detailYear--; renderDetail(); }
      else if (act === "ynext") { detailYear++; renderDetail(); }
      else if (act === "day") {
        var h = habitById(detailId);
        if (h) openDayDialog(h, a.getAttribute("data-k"));
      }
    });
    dlgDetail.addEventListener("keydown", function (e) {
      if ((e.key === "Enter" || e.key === " ") && e.target.getAttribute && e.target.getAttribute("data-dt") === "day") {
        e.preventDefault();
        var h = habitById(detailId);
        if (h) openDayDialog(h, e.target.getAttribute("data-k"));
      }
    });
  }
  function openDetail(h) {
    ensureDetailDialog();
    detailId = h.id;
    detailYear = todayStart().getFullYear();
    renderDetail();
    dlgDetail.showModal();
    var wrap = dlgDetail.querySelector(".hm-wrap");
    if (wrap) wrap.scrollLeft = wrap.scrollWidth;
    document.getElementById("dt-close").focus();
  }
  function refreshOpenDialogs() {
    if (dlgDetail && dlgDetail.open) renderDetail();
  }

  // Strength over time: the last 12 months (or since the first day)
  function chartHtml(h) {
    var todayK = todayKey();
    var ser = HC.scoreSeries(ix(), h, todayK);
    var from = HC.addDays(todayK, -364);
    ser = ser.filter(function (p) { return p.d >= from; });
    if (ser.length < 2) return "";
    var W = 600, H = 120, n = ser.length, pts = [];
    for (var i = 0; i < n; i++) pts.push((i / (n - 1) * W).toFixed(1) + "," + (H - 4 - ser[i].s * (H - 8)).toFixed(1));
    var area = "0," + H + " " + pts.join(" ") + " " + W + "," + H;
    var grid = "";
    [0.25, 0.5, 0.75].forEach(function (g) {
      var y = (H - 4 - g * (H - 8)).toFixed(1);
      grid += '<line x1="0" x2="' + W + '" y1="' + y + '" y2="' + y + '" class="grid"/>';
    });
    var d0 = parseDateKey(ser[0].d);
    return '<div class="dt-h">' + esc(t("detail.chart")) + "</div>" +
      '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="' +
        esc(t("detail.chart")) + '">' + grid +
        '<polygon points="' + area + '" style="fill:' + h.color + '" class="area"/>' +
        '<polyline points="' + pts.join(" ") + '" style="stroke:' + h.color + '" class="line"/></svg>' +
      '<div class="chart-x"><span>' + esc(shortDate(d0) + " " + d0.getFullYear()) + "</span><span>" + esc(t("today")) + "</span></div>";
  }
  // GitHub-style year: columns = weeks (Monday first), rows = weekdays
  function heatmapHtml(h) {
    var y = detailYear, todayK = todayKey();
    var jan1 = new Date(y, 0, 1), dec31 = new Date(y, 11, 31);
    var start = weekStart(jan1), CELL = 11, GAP = 2, TOP = 14, LEFT = 0;
    var weeks = Math.ceil((Math.round((dec31 - start) / 86400000) + 1) / 7);
    var W = LEFT + weeks * (CELL + GAP) + 14, H = TOP + 7 * (CELL + GAP);
    var out = "", months = "", lastM = -1;
    for (var w = 0; w < weeks; w++) {
      for (var r = 0; r < 7; r++) {
        var d = addDays(start, w * 7 + r);
        if (d.getFullYear() !== y) continue;
        if (d.getDate() <= 7 && r === 0 || (w === 0 && r === 0)) {
          if (d.getMonth() !== lastM) {
            lastM = d.getMonth();
            months += '<text x="' + (LEFT + w * (CELL + GAP)) + '" y="10" class="hm-m">' + esc(shortMonth(d)) + "</text>";
          }
        }
        var c = cellInfo(h, d, todayK);
        var x = LEFT + w * (CELL + GAP), yy = TOP + r * (CELL + GAP);
        var cls = "hm-c", fill = "";
        if (c.done) { cls += " on"; fill = h.color; }
        else if (c.skip) cls += " sk";
        else if (c.prog > 0) { cls += " part"; fill = h.color; }
        if (c.future) cls += " fu";
        if (c.fixedOff && !c.done) cls += " off";
        if (c.note) cls += " nt";
        var style = fill ? ' style="fill:' + fill + (c.done ? "" : ";fill-opacity:" + (0.25 + 0.5 * c.prog).toFixed(2)) + '"' : "";
        var act = c.locked ? "" : ' data-dt="day" data-k="' + c.k + '" tabindex="0" role="button"';
        out += '<rect x="' + x + '" y="' + yy + '" width="' + CELL + '" height="' + CELL + '" rx="2" class="' + cls + '"' + style + act + ">" +
          "<title>" + esc(cellTip(h, c)) + "</title></rect>";
      }
    }
    var curY = todayStart().getFullYear();
    var first = ix().first[h.id];
    var minY = first ? +first.slice(0, 4) : curY;
    return '<div class="dt-h hm-head">' +
        '<button type="button" class="btn ghost pbtn" data-dt="yprev" title="' + esc(t("year.prev")) + '" aria-label="' + esc(t("year.prev")) + '"' +
          (y <= minY ? " disabled" : "") + ">" + ICO_CHEVL + "</button>" +
        "<span>" + y + "</span>" +
        '<button type="button" class="btn ghost pbtn" data-dt="ynext" title="' + esc(t("year.next")) + '" aria-label="' + esc(t("year.next")) + '"' +
          (y >= curY ? " disabled" : "") + ">" + ICO_CHEVR + "</button></div>" +
      '<div class="hm-wrap"><svg class="hm" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '">' + months + out + "</svg></div>" +
      '<div class="hm-legend"><span class="hm-key on" style="background:' + h.color + '"></span>' + esc(t("day.done")) +
        (isNum(h) ? '<span class="hm-key part" style="background:' + h.color + '66"></span>' + esc(t("day.value")) : "") +
        '<span class="hm-key sk"></span>' + esc(t("skipped")) +
        '<span class="hm-key nt"></span>' + esc(t("day.note")) + "</div>";
  }
  function notesHtml(h) {
    var list = [];
    for (var i = 0; i < db.comps.length; i++) {
      var c = db.comps[i];
      if (c.habitId === h.id && c.nt && c.nt[0]) list.push(c);
    }
    if (!list.length) return "";
    list.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var html = '<div class="dt-h">' + esc(t("detail.notes")) + '</div><div class="dt-notes">';
    for (var j = 0; j < list.length && j < 12; j++) {
      var d = parseDateKey(list[j].date);
      html += '<div class="dt-note" data-dt="day" data-k="' + list[j].date + '" role="button" tabindex="0">' +
        '<span class="dt-nd">' + esc(shortDate(d) + " " + d.getFullYear()) + "</span>" +
        "<span>" + esc(list[j].nt[0]) + "</span></div>";
    }
    return html + "</div>";
  }
  function renderDetail() {
    var h = habitById(detailId);
    var body = document.getElementById("dt-body");
    if (!h || h.del) { if (dlgDetail.open) dlgDetail.close(); return; }
    var st = streakInfo(h), sc = strength(h);
    var total = 0;
    for (var i = 0; i < db.comps.length; i++) {
      if (db.comps[i].habitId === h.id && isDone(h.id, db.comps[i].date)) total++;
    }
    var sub = freqBadge(h) + (isNum(h) ? " · " + targetText(h) : "") +
      (typeof h.rem === "number" ? " · " + tpl("rem.at", { t: hm(h.rem) }) : "");
    body.innerHTML =
      '<div class="dt-top">' +
        '<span class="habit-icon-box" style="background:' + h.color + "33;color:" + h.color + '"><span class="ico">' + ICONS[h.icon] + "</span></span>" +
        '<div class="dt-titles"><h3>' + esc(h.name) + '</h3><div class="df-sub">' + esc(sub) + "</div></div>" +
      "</div>" +
      '<div class="stat-cards dt-cards">' +
        statCard('<span class="dt-ring">' + ringHtml(sc, h.color) + "</span>" + sc + "%", t("strength")) +
        statCard(st.cur + esc(streakSuffix(st)), t("stats.current")) +
        statCard(st.best + esc(streakSuffix(st)), t("stats.longest")) +
        statCard(total, t("stats.total.comps")) +
      "</div>" +
      chartHtml(h) +
      heatmapHtml(h) +
      notesHtml(h);
    // the current year opens on today (phones scroll the year sideways)
    var wrap = body.querySelector(".hm-wrap");
    if (wrap && detailYear === todayStart().getFullYear()) wrap.scrollLeft = wrap.scrollWidth;
    document.getElementById("dt-edit").textContent = t("detail.edit");
    document.getElementById("dt-close").textContent = t("close");
    dlgDetail.setAttribute("aria-label", h.name);
  }

  // ===== SETTINGS DIALOG (Steps row from Health) =====
  var dlgSet = null;
  function openSettings() {
    if (!dlgSet) {
      dlgSet = document.createElement("dialog");
      dlgSet.innerHTML =
        '<h3 id="sf-title"></h3>' +
        '<div class="dialog-form">' +
          '<div class="field"><label class="check"><input type="checkbox" id="sf-steps"> <span id="sf-stepsl"></span></label>' +
            '<div class="field-hint" id="sf-hint"></div></div>' +
          '<div class="field"><label id="sf-goall" for="sf-goal"></label>' +
            '<input type="number" id="sf-goal" min="100" max="200000" step="100" inputmode="numeric"></div>' +
          '<div class="field-hint" id="sf-none"></div>' +
        "</div>" +
        '<div class="dialog-actions"><span style="flex:1"></span>' +
          '<button type="button" class="btn ghost" id="sf-cancel"></button>' +
          '<button type="button" class="btn prim" id="sf-save"></button></div>';
      document.body.appendChild(dlgSet);
      document.getElementById("sf-cancel").addEventListener("click", function () { dlgSet.close(); });
      document.getElementById("sf-save").addEventListener("click", function () {
        var cur = M.settingsOf(db);
        var on = document.getElementById("sf-steps").checked;
        var g = parseInt(document.getElementById("sf-goal").value, 10);
        if (isNaN(g)) g = cur.sg;
        g = Math.max(100, Math.min(200000, g));
        var patch = {};
        if ((on ? 1 : 0) !== cur.st) patch.st = on;
        if (g !== cur.sg) patch.sg = g;
        dlgSet.close();
        if (Object.keys(patch).length) {
          M.setSettings(db, patch, Date.now());
          save();
          render();
        }
      });
    }
    var s = M.settingsOf(db);
    document.getElementById("sf-title").textContent = t("settings");
    document.getElementById("sf-stepsl").textContent = t("set.steps");
    document.getElementById("sf-hint").textContent = t("set.steps.hint");
    document.getElementById("sf-goall").textContent = t("set.steps.goal");
    document.getElementById("sf-steps").checked = !!s.st;
    document.getElementById("sf-goal").value = String(s.sg);
    var S = window.OrosHabitsSteps, has = false;
    try {
      var hd = JSON.parse(localStorage.getItem("oros-health-data"));
      has = !!(S && Object.keys(S.stepsByDay(hd)).length);
    } catch (e) { has = false; }
    document.getElementById("sf-none").textContent = has ? "" : t("set.steps.none");
    document.getElementById("sf-cancel").textContent = t("cancel");
    document.getElementById("sf-save").textContent = t("save");
    dlgSet.showModal();
  }

  // ===== CONFIRM DELETE DIALOG =====
  var dlgConfirm = null;
  function confirmDelete(h) {
    if (!dlgConfirm) {
      dlgConfirm = document.createElement("dialog");
      dlgConfirm.innerHTML =
        '<h3 id="cf-title"></h3>' +
        '<p class="confirm-body" id="cf-msg"></p>' +
        '<div class="dialog-actions">' +
          '<span style="flex:1"></span>' +
          '<button type="button" class="btn ghost" id="cf-no"></button>' +
          '<button type="button" class="btn danger" id="cf-yes"></button>' +
        "</div>";
      document.body.appendChild(dlgConfirm);
    }
    document.getElementById("cf-title").textContent = t("del");
    document.getElementById("cf-msg").textContent = t("confirm.del");
    document.getElementById("cf-no").textContent = t("cancel");
    document.getElementById("cf-yes").textContent = t("del");
    document.getElementById("cf-no").onclick = function () { dlgConfirm.close(); };
    var hid = h.id;
    document.getElementById("cf-yes").onclick = function () {
      dlgConfirm.close();
      // HB-9: resolve by id — a pull while this dialog was open
      // replaced the row object, and deleting the old copy saved nothing
      var cur = habitById(hid);
      if (cur && !cur.del) deleteHabit(cur);
      render();
      transientNote(t("toast.deleted"));
    };
    dlgConfirm.showModal();
  }

  // ===== EVENT WIRING =====
  // A day cell (list dot / calendar cell) → { h, d } or null
  function cellTarget(el) {
    var act = el.getAttribute("data-act");
    var h = habitById(el.getAttribute("data-h") || "");
    if (!h || (act !== "dot" && act !== "cdot")) return null;
    var d = act === "dot" ? weekDays(period)[parseInt(el.getAttribute("data-i"), 10)]
                          : monthDays(period)[parseInt(el.getAttribute("data-c"), 10)];
    return d ? { h: h, d: d } : null;
  }
  function cellLocked(h, d) { return cellInfo(h, d, todayKey()).locked; }
  // tap: yes / no toggles; measurable opens the day dialog
  function cellTap(h, d) {
    if (cellLocked(h, d)) return;
    if (isNum(h)) { openDayDialog(h, dateKey(d)); return; }
    var dk = dateKey(d);
    if (isSkipped(h.id, dk) && !isDone(h.id, dk)) { openDayDialog(h, dk); return; }
    if (HC.isFixed(h) && !isScheduledOn(h, d) && !isDone(h.id, dk)) { openDayDialog(h, dk); return; }
    toggleComp(h, d);
    render();
  }
  // Long-press (touch) or right-click: the day dialog
  var press = { timer: null, fired: 0, x: 0, y: 0 };
  function pressStart(e) {
    var el = e.target.closest && e.target.closest('[data-act="dot"],[data-act="cdot"]');
    press.fired = 0;
    clearTimeout(press.timer);
    if (!el || (e.pointerType === "mouse")) return;
    press.x = e.clientX; press.y = e.clientY;
    press.timer = setTimeout(function () {
      var c = cellTarget(el);
      if (!c || cellLocked(c.h, c.d)) return;
      press.fired = Date.now();
      openDayDialog(c.h, dateKey(c.d));
    }, 500);
  }
  function pressCancel(e) {
    if (e && e.type === "pointermove" && Math.abs(e.clientX - press.x) < 8 && Math.abs(e.clientY - press.y) < 8) return;
    clearTimeout(press.timer);
  }

  function wire() {
    els.btnAdd.addEventListener("click", function () { openHabitDialog(null); });
    els.btnSet.addEventListener("click", openSettings);
    els.btnPrev.addEventListener("click", function () {
      if (viewMode === "stats") return;
      period = viewMode === "cal" ? monthAdd(period, -1) : addDays(period, -7);
      render();
    });
    els.btnNext.addEventListener("click", function () {
      if (viewMode === "stats") return;
      period = viewMode === "cal" ? monthAdd(period, 1) : addDays(period, 7);
      render();
    });
    els.btnNow.addEventListener("click", function () {
      if (viewMode === "stats") return;
      period = todayStart();
      render();
    });
    els.btnVList.addEventListener("click", function () { setView("list"); });
    els.btnVCal.addEventListener("click", function () { setView("cal"); });
    els.btnVStats.addEventListener("click", function () { setView("stats"); });

    els.view.addEventListener("pointerdown", pressStart);
    els.view.addEventListener("pointerup", pressCancel);
    els.view.addEventListener("pointercancel", pressCancel);
    els.view.addEventListener("pointermove", pressCancel);
    els.view.addEventListener("contextmenu", function (e) {
      var el = e.target.closest('[data-act="dot"],[data-act="cdot"]');
      if (!el) return;
      e.preventDefault();
      clearTimeout(press.timer);
      if (press.fired && Date.now() - press.fired < 1500) return;   // the long-press already opened it
      press.fired = Date.now();                // a click that may follow is swallowed
      var c = cellTarget(el);
      if (c && !cellLocked(c.h, c.d)) openDayDialog(c.h, dateKey(c.d));
    });

    // delegated clicks inside the view
    els.view.addEventListener("click", function (e) {
      var actEl = e.target.closest("[data-act]");
      if (!actEl) return;
      if (press.fired && Date.now() - press.fired < 1500) { press.fired = 0; return; }   // long-press already handled
      var act = actEl.getAttribute("data-act");
      if (act === "rng") {                 // range chip: no habit row
        setStatRange(parseInt(actEl.getAttribute("data-rng"), 10));
        return;
      }
      if (act === "feed-open") {           // app feed row: open the provider
        openFeedApp(actEl.getAttribute("data-app"));
        return;
      }
      var hid = actEl.getAttribute("data-h");
      var h = hid ? habitById(hid) : null;
      if (!h) { if (act === "new") openHabitDialog(null); return; }

      if (act === "edit") {
        openHabitDialog(h);
      } else if (act === "del") {
        confirmDelete(h);
      } else if (act === "new") {
        openHabitDialog(null);
      } else if (act === "detail" || act === "gedit") {
        openDetail(h);
      } else if (act === "inc" || act === "dec") {
        quickAdd(h, todayKey(), act === "inc" ? 1 : -1);
        render();
      } else if (act === "dot" || act === "cdot") {
        var c = cellTarget(actEl);
        if (c) cellTap(c.h, c.d);
      }
    });
  }

  // role=button divs (feed gutter cells, habit names, stats rows):
  // Enter / Space act like a click.
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var tg = e.target;
    if (!tg || !tg.getAttribute || !tg.getAttribute("data-act") || tg.tagName === "BUTTON") return;
    if (tg.closest && tg.closest("dialog")) return;
    e.preventDefault();
    tg.click();
  });
  // A provider's data changed in another document (a pull applied by
  // the shell, the provider app in another tab): redraw the rows.
  window.addEventListener("storage", function (e) {
    if (!e.key || feedKeys().indexOf(e.key) === -1) return;
    if (document.querySelector("dialog[open]")) return;
    render();
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" &&
        !document.querySelector("dialog[open]")) render();   // feeds, and a new day
  });

  // ===== KEYBOARD (app shortcut + shell forwarding) =====
  document.addEventListener("keydown", function (e) {
    var inField = /^(INPUT|TEXTAREA|SELECT)$/.test(
      document.activeElement ? document.activeElement.tagName : "");
    var dialogOpen = document.querySelector("dialog[open]");

    if (dialogOpen) return;               // modal handles its own keys (Esc native)

    if (!inField && !e.ctrlKey && !e.metaKey && !e.altKey &&
        (e.key === "n" || e.key === "N")) {
      e.preventDefault();
      openHabitDialog(null);
      return;
    }
    // forward SHELL-OWNED combos only (Ctrl/Cmd+Alt+Shift+*) so
    // GLOBAL shortcuts (force push/pull, snapshot…) keep working
    // while the app iframe has focus (§10 — same rule as Weather).
    // Plain keys stay local — no synthetic-event spam on the shell.
    if (!inField && (e.ctrlKey || e.metaKey) && e.altKey && e.shiftKey) {
      forwardKey(e);
    }
  });

  function forwardKey(e) {
    var p = window.parent;
    if (!p || p === window) return;
    try {
      p.document.dispatchEvent(new KeyboardEvent("keydown", {
        key: e.key, code: e.code,
        ctrlKey: e.ctrlKey, shiftKey: e.shiftKey,
        altKey: e.altKey, metaKey: e.metaKey,
        bubbles: true
      }));
    } catch (err) { /* old engines — shell shortcuts still usable by focusing shell */ }
  }

  // ===== PALETTE INHERITANCE (§9 — parent shell vars win) =====
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft", "--panel-bg",
                  "--border", "--shadow", "--danger", "--ok", "--warn",
                  "--font-stack"];

  function inheritPalette() {
    var p = (window.parent && window.parent !== window) ? window.parent : null;
    var src = null;
    if (p) {
      try { src = p.getComputedStyle(p.document.documentElement); } catch (err) { src = null; }
    }
    var root = document.documentElement;
    if (src) {
      for (var i = 0; i < PAL_VARS.length; i++) {
        var v = src.getPropertyValue(PAL_VARS[i]).trim();
        if (v) root.style.setProperty(PAL_VARS[i], v);
      }
    }
    // standalone fallback palette from habits.css :root stays active
    // for any var the shell does not define.
  }

  function watchPalette() {
    inheritPalette();
    var p = (window.parent && window.parent !== window) ? window.parent : null;
    if (!p) return;
    // 1) shell broadcasts palette changes via postMessage
    window.addEventListener("message", function (e) {
      var d = e.data;
      if (!d || typeof d !== "object") return;
      if (d.type === "oros-palette") inheritPalette();
      if (d.type === "oros-lang" && (d.lang === "en" || d.lang === "el")) {
        LANG = d.lang;
        document.documentElement.lang = LANG;
        render();
      }
    });
    // 2) belt & braces — style/class swaps on the shell root
    try {
      var mo = new MutationObserver(function () { inheritPalette(); });
      mo.observe(p.document.documentElement,
        { attributes: true, attributeFilter: ["class", "style"] });
    } catch (err) { /* observer unavailable — message path still live */ }
  }

  // ===== PUBLIC HANDLE (debug / shell introspection) =====
  window.orosHabits = {
    version: SCRIPT_V || "?",
    dataVersion: DATA_VER,
    view: function () { return viewMode; },
    week: function () { return dateKey(weekStart(period)); },
    // H2/H3 (Wave 8/#TH2): the ONLY sanctioned deep-link entry —
    // the old receiver called render() out of scope and mutated a
    // .period property the handle never had. Navigation only:
    // period + re-render, never data, never sync. offsetDays=0 →
    // current week/month anchor; list walks weeks, cal anchors the
    // month containing that day.
    navigateByOffset: function (offsetDays) {
      var n = parseInt(offsetDays, 10);
      if (isNaN(n)) return;
      var anchor = todayStart();
      anchor.setDate(anchor.getDate() + n);
      anchor.setHours(0, 0, 0, 0);
      period = anchor;
      render();
    },
    stats: function () {
      return {
        habits: livingHabits().length,
        comps: db.comps.filter(function (c) { return !c.del; }).length
      };
    }
  };

  // ===== BOOT =====
  dom();
  dbInit();
  wire();
  registerSync();
  watchPalette();
  render();

  // Universal search deep link (shell __orosOpenAt / __orosTakeTarget):
  // target { habit: id }. Opens the habit's edit dialog, as its edit
  // button does. Unknown or deleted habit → no-op; an open dialog
  // (unsaved edits) wins → no-op.
  //   BR-W8-6 (Assistant entry card): { asNew: { name, days?, perWeek?,
  //   perMonth?, target?, unit?, cmp?, reminder? } } (M.asNew cleans
  //   it) opens the new-habit dialog prefilled; no name → no-op.
  function openSearchTarget(t) {
    if (t && t.asNew) {
      var pre = M.asNew(t.asNew);
      if (pre && !document.querySelector("dialog[open]")) openHabitDialog(null, pre);
      return;
    }
    var h = t && typeof t.habit === "string" ? habitById(t.habit) : null;
    if (!h || h.del) return;
    if (document.querySelector("dialog[open]")) return;
    openHabitDialog(h);
  }
  window.__orosOpenAt = openSearchTarget;
  try {
    if (window.parent && window.parent !== window &&
        typeof window.parent.__orosTakeTarget === "function") {
      var pendingTarget = window.parent.__orosTakeTarget("habits");
      if (pendingTarget) openSearchTarget(pendingTarget);
    }
  } catch (e) {}

  console.log("[orOS] habits.js " + (SCRIPT_V ? "v" + SCRIPT_V : "") + " booted");

})();


// ===== orOS deep-link receiver (Wave 8 / #TH2) =====
// Consumed by shell.js (__orosOpenHabits) and notifications.js
// (DL_BRIDGES → "habits:<offsetDays>"). Routes ONLY through the
// public handle (orosHabits.navigateByOffset) — the previous version
// called render() from THIS scope (ReferenceError — render is
// closure-private) and mutated orosHabits.period (silent no-op).
(function () {
  "use strict";

  // Live push (shell bridge calls this when app is running)
  window.__orosHabitsOpen = function (periodOffsetDays) {
    if (window.orosHabits &&
        typeof window.orosHabits.navigateByOffset === "function") {
      window.orosHabits.navigateByOffset(periodOffsetDays || 0);
    }
  };

  // Boot: consume a staged period from the shell while the app was
  // closed (sessionStorage — same origin, one-shot). Safe even at
  // script-parse time: the main IIFE sets the handle synchronously
  // before this point.
  try {
    var pending = sessionStorage.getItem("oros-habits-period");
    if (pending) {
      sessionStorage.removeItem("oros-habits-period");
      var off = parseInt(pending, 10) || 0;
      window.__orosHabitsOpen(off);
    }
  } catch (e) {}
})();