// ============================================================
// orOS Habits v0.1.0 — Habit tracker (Wave 1 core: List view)
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
      "freq.n":          "{n}×/wk",
      "freq.any":        "Flexible",
      "streak":          "{n} day streak",
      "streaks":         "{n} day streaks",
      "streak.zero":     "No streak",
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
      "dkey.4": "F", "dkey.5": "S", "dkey.6": "S"
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
      "freq.n":          "{n}×/εβδ.",
      "freq.any":        "Ευέλικτο",
      "streak":          "{n} ημέρες σερί",
      "streaks":         "{n} ημέρες σερί",
      "streak.zero":     "Χωρίς σερί",
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
      "dkey.4": "Π", "dkey.5": "Σ", "dkey.6": "Κ"
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
  var DATA_VER = 1;

  // Shared orOS vocabulary — same 8 colors as Notes/To-Do/Mood
  var COLORS = ["#e06c75", "#ecc75f", "#87cf3e", "#4fc4cf",
                "#6d4aff", "#e09ecf", "#f28c5a", "#9aa4b0"];

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
  // weekday index 0..6 with MONDAY = 0 (schedule space)
  function schedIdx(d) { return (d.getDay() + 6) % 7; }

  // ===== DATA LAYER =====
  var db = null;   // { ver, habits:[], comps:[] }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Local-write normalizer (fills defaults for rows WE create)
  function habitDefaults(raw) {
    var days = [];
    if (Array.isArray(raw.days)) {
      var seen = {};
      for (var i = 0; i < raw.days.length; i++) {
        var dy = raw.days[i];
        if (typeof dy === "number" && dy >= 0 && dy <= 6 && !seen[dy]) {
          seen[dy] = true;
          days.push(dy);
        }
      }
      days.sort();
    }
    return {
      id:    (typeof raw.id === "string" && raw.id) ? raw.id : uid(),
      name:  (typeof raw.name === "string") ? raw.name.slice(0, 200) : "",
      icon:  (ICONS[raw.icon] ? raw.icon : "check"),
      color: (COLORS.indexOf(raw.color) !== -1 ? raw.color : COLORS[0]),
      days:  days,
      mtime: (typeof raw.mtime === "number" && isFinite(raw.mtime)) ? raw.mtime : Date.now(),
      del:   !!raw.del
    };
  }
  function compDefaults(raw) {
    return {
      id:     (typeof raw.id === "string" && raw.id) ? raw.id : "",
      habitId: (typeof raw.habitId === "string" && raw.habitId) ? raw.habitId : "",
      date:   (typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)) ? raw.date : "",
      mtime:  (typeof raw.mtime === "number" && isFinite(raw.mtime)) ? raw.mtime : Date.now(),
      del:    !!raw.del
    };
  }

  function normalize(obj) {
    if (!obj || typeof obj !== "object") return null;
    if (!Array.isArray(obj.habits) || !Array.isArray(obj.comps)) return null;
    var seenH = {}, habits = [], seenC = {}, comps = [];
    for (var i = 0; i < obj.habits.length; i++) {
      var h = habitDefaults(obj.habits[i]);
      if (!h.name && !h.del) continue;    // nameless living garbage
      if (seenH[h.id]) continue;
      seenH[h.id] = true;
      habits.push(h);
    }
    for (var j = 0; j < obj.comps.length; j++) {
      var c = compDefaults(obj.comps[j]);
      if (!c.id || !c.habitId || !c.date) continue;
      if (seenC[c.id]) continue;
      seenC[c.id] = true;
      comps.push(c);
    }
    return { ver: DATA_VER, habits: habits, comps: comps };
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

    var norm = normalize(obj);
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
  }

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
  // completed = comp entity exists AND not tombstoned
  function compKey(habitId, dateK) { return habitId + "|" + dateK; }
  function isDone(habitId, dateK) {
    for (var i = 0; i < db.comps.length; i++) {
      var c = db.comps[i];
      if (c.id === habitId + "|" + dateK) return !c.del;
    }
    return false;
  }
  // Schedule: empty days = flexible (any day counts), subset = those
  // weekdays only. Always consults the MONDAY-FIRST schedIdx.
  function isScheduledOn(habit, d) {
    if (!habit.days.length) return true;
    return habit.days.indexOf(schedIdx(d)) !== -1;
  }
  function freqBadge(habit) {
    if (!habit.days.length) return t("freq.any");
    if (habit.days.length === 7) return t("freq.daily");
    return fmt("freq.n", habit.days.length);
  }

  // ===== STREAK ENGINE (schedule-aware — audits #1, #2) =====
  // Consecutive chain walking backwards: completed day extends,
  // unscheduled day is SKIPPED (transparent), scheduled-but-missed
  // day breaks the chain.
  function currentStreak(habit) {
    var streak = 0;
    var d = todayStart();
    // today not done yet is NOT a break — grace starts from today
    if (!isDone(habit.id, dateKey(d))) d = addDays(d, -1);
    var guard = 0;
    while (guard++ < 3650) {
      if (isDone(habit.id, dateKey(d))) { streak++; d = addDays(d, -1); }
      else if (isScheduledOn(habit, d)) break;
      else d = addDays(d, -1);
    }
    return streak;
  }

  // Longest: same rule, scanned forward from the first comp.
  function longestStreak(habit) {
    var dates = [];
    for (var i = 0; i < db.comps.length; i++) {
      var c = db.comps[i];
      if (c.habitId === habit.id && !c.del) dates.push(c.date);
    }
    if (!dates.length) return 0;
    dates.sort();

    var longest = 0, current = 0;
    var d = new Date(dates[0] + "T00:00:00");
    var today = todayStart();
    var guard = 0;
    while (d <= today && guard++ < 3650) {
      if (isDone(habit.id, dateKey(d))) { current++; if (current > longest) longest = current; }
      else if (isScheduledOn(habit, d)) { current = 0; }
      // unscheduled days are skipped — current survives
      d = addDays(d, 1);
    }
    return longest;
  }

  // ===== MUTATIONS (all funnel through save()) =====
  function touch(o) { o.mtime = Date.now(); }

  function save() {
    dbPersist();
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function addHabit(name, icon, color, days) {
    var h = habitDefaults({
      id: uid(), name: name, icon: icon, color: color,
      days: days, mtime: Date.now(), del: false
    });
    db.habits.push(h);
    save();
    return h;
  }

  function updateHabit(h, name, icon, color, days) {
    h.name = name; h.icon = icon; h.color = color; h.days = days;
    touch(h);
    save();
  }

  function deleteHabit(h) {
    // tombstone the habit AND all its comps — merge-propagated,
    // but a comp edit with fresher mtime still resurrects (R17)
    h.del = true;
    touch(h);
    var now = Date.now();
    for (var i = 0; i < db.comps.length; i++) {
      if (db.comps[i].habitId === h.id) {
        if (!db.comps[i].del) { db.comps[i].del = true; db.comps[i].mtime = now; }
      }
    }
    save();
  }

  // Toggle completion for a habit/day. Completion = entity with
  // !del. Un-complete = tombstone (LWW merge friendly). Re-complete
  // = resurrect with fresh mtime.
  function toggleComp(habit, d) {
    var k = compKey(habit.id, dateKey(d));
    var comp = null;
    for (var i = 0; i < db.comps.length; i++) {
      if (db.comps[i].id === k) { comp = db.comps[i]; break; }
    }
    if (comp && !comp.del) {
      comp.del = true;
      touch(comp);
    } else if (comp) {
      comp.del = false;
      touch(comp);
    } else {
      db.comps.push(compDefaults({
        id: k, habitId: habit.id, date: dateKey(d),
        mtime: Date.now(), del: false
      }));
    }
    save();
  }

  // ===== MERGE ENGINE (deterministic, symmetric) =====
  // Strict mergeRow variants: NO volatile defaults (no uid(), no
  // Date.now()) — invalid rows are DROPPED so both devices compute
  // byte-identical merges (divergence-guard safe).
  function mergeHabitRow(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.id !== "string" || !raw.id) return null;
    if (typeof raw.name !== "string") return null;
    if (!(typeof raw.mtime === "number" && isFinite(raw.mtime))) return null;
    var days = [];
    if (Array.isArray(raw.days)) {
      var seen = {};
      for (var i = 0; i < raw.days.length; i++) {
        var dy = raw.days[i];
        if (typeof dy === "number" && dy >= 0 && dy <= 6 && !seen[dy]) { seen[dy] = true; days.push(dy); }
      }
      days.sort();
    }
    return {
      id: raw.id,
      name: raw.name.slice(0, 200),
      icon: ICONS[raw.icon] ? raw.icon : "check",
      color: COLORS.indexOf(raw.color) !== -1 ? raw.color : COLORS[0],
      days: days,
      mtime: raw.mtime,
      del: !!raw.del
    };
  }
  function mergeCompRow(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.id !== "string" || !raw.id) return null;
    if (typeof raw.habitId !== "string" || !raw.habitId) return null;
    if (!(typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date))) return null;
    if (!(typeof raw.mtime === "number" && isFinite(raw.mtime))) return null;
    return { id: raw.id, habitId: raw.habitId, date: raw.date, mtime: raw.mtime, del: !!raw.del };
  }

  function mergeBy(key, localArr, remoteArr, rowFn) {
    var map = {};
    function put(e) { map[e[key]] = e; }
    var i, r, l, ex;
    for (i = 0; i < remoteArr.length; i++) {
      r = rowFn(remoteArr[i]);
      if (r) put(r);
    }
    for (i = 0; i < localArr.length; i++) {
      l = rowFn(localArr[i]);
      if (!l) continue;
      ex = map[l[key]];
      if (!ex) { put(l); continue; }
      if (l.mtime > ex.mtime) put(l);
      else if (l.mtime < ex.mtime) put(ex);
      else if (l.del !== ex.del) put(l.del ? l : ex);      // tie → tombstone
      else put((l[key] || "") <= (ex[key] || "") ? l : ex); // final tie-break
    }
    var out = [];
    for (var k in map) if (map.hasOwnProperty(k)) out.push(map[k]);
    out.sort(function (a, b) { return a[key] < b[key] ? -1 : (a[key] > b[key] ? 1 : 0); });
    return out;
  }

  function mergeData(local, remote) {
    if (!local || !remote) return remote || local || null;
    return {
      ver: Math.max(local.ver || 1, remote.ver || 1),
      habits: mergeBy("id", local.habits || [], remote.habits || [], mergeHabitRow),
      comps: mergeBy("id", local.comps || [], remote.comps || [], mergeCompRow)
    };
  }

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
    // Prune dead tombstones (>30d) from the SHIPPED payload only —
    // never from db, so pruning can't trigger dirty loops.
    var CUTOFF = Date.now() - 30 * 24 * 60 * 60 * 1000;
    var comps = [];
    for (var i = 0; i < db.comps.length; i++) {
      if (db.comps[i].del && db.comps[i].mtime < CUTOFF) continue;
      comps.push(db.comps[i]);
    }
    return { ver: db.ver, habits: db.habits, comps: comps };
  }

  function sliceSet(data, info) {
    if (!data || typeof data !== "object" ||
        !Array.isArray(data.habits) || !Array.isArray(data.comps)) return;
    var next = normalize(data);
    if (!next) return;
    db = next;
    dbPersist();
    render();                          // pull-fed path: NEVER dirty
    if (info && info.merged) toast(t("toast.merged"));
  }

  // ===== VIEW & RENDER =====