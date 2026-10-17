// ============================================================
// orOS Workouts — core.js (shared read-only rules, v1.1.0)
// 1. Habits feed provider. Loaded by habits/index.html before
//    habits.js. Adds one read-only row, "Workouts", to Habits through
//    the generic window.orosHabitFeeds registry: a day counts when it
//    has a finished workout. The row hides when the user turns it off
//    in Workouts › Settings (synced setting set.hb = 0) or when there
//    is no workout yet.
// 2. The training plan of a day (window.OrosFitnessCore), one copy
//    for the Workouts app (Train tab, fitness/index.html loads this
//    file) and the Today summary (fitness/today.js):
//      plannedOn(data, ymd) → [{ pg, day }] program days whose
//        weekdays (Monday = 0) hold that day and that have exercises,
//        in program order
//      doneOn(data, ymd, pgId, dayId) → a finished workout of that
//        program day on that date
// Reads oros-fitness-data only; never writes.
// ============================================================
(function (root) {
  "use strict";
  var STORAGE_KEY = "oros-fitness-data";
  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12"/></svg>';

  // { days: {"YYYY-MM-DD": true} } or null
  function workoutDays(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.wo)) return null;
    if (data.set && data.set.hb === 0) return null;
    var days = {}, any = false;
    data.wo.forEach(function (w) {
      if (w && typeof w.d === "string" && YMD_RE.test(w.d) &&
          typeof w.en === "number" && w.en > 0) { days[w.d] = true; any = true; }
    });
    return any ? { days: days } : null;
  }

  function wdOf(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
    if (!m) return -1;
    return (new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() + 6) % 7;
  }
  function plannedOn(data, ymd) {
    var wd = wdOf(ymd), out = [];
    if (wd < 0 || !data || !Array.isArray(data.pg)) return out;
    data.pg.forEach(function (p) {
      if (!p || typeof p.id !== "string" || !Array.isArray(p.days)) return;
      p.days.forEach(function (d) {
        if (d && Array.isArray(d.wd) && d.wd.indexOf(wd) >= 0 && Array.isArray(d.it) && d.it.length) {
          out.push({ pg: p, day: d });
        }
      });
    });
    return out;
  }
  function doneOn(data, ymd, pgId, dayId) {
    if (!data || !Array.isArray(data.wo)) return false;
    return data.wo.some(function (w) {
      return w && w.d === ymd && typeof w.en === "number" && w.en > 0 && w.p === pgId && w.pd === dayId;
    });
  }

  // The Habits row's name and hint (Habits shows them in its own
  // language, English for a pack language).
  var TXT = {
    en: { "feed.name": "Workouts", "feed.hint": "A finished workout in the Workouts app" },
    el: { "feed.name": "Προπόνηση", "feed.hint": "Μια ολοκληρωμένη προπόνηση στην εφαρμογή Προπόνηση" }
  };
  var FEED = {
    id: "fitness",
    app: "fitness",
    name: { en: TXT.en["feed.name"], el: TXT.el["feed.name"] },
    hint: { en: TXT.en["feed.hint"], el: TXT.el["feed.hint"] },
    color: "#f28c5a",
    icon: ICON,
    keys: [STORAGE_KEY],
    read: function () {
      var data = null;
      try { data = JSON.parse(root.localStorage.getItem(STORAGE_KEY)); } catch (e) {}
      return workoutDays(data);
    }
  };

  var API = { plannedOn: plannedOn, doneOn: doneOn };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { FEED: FEED, workoutDays: workoutDays, plannedOn: plannedOn, doneOn: doneOn };
  }
  if (root) root.OrosFitnessCore = API;
  if (root && root.document) {
    var feeds = root.orosHabitFeeds = root.orosHabitFeeds || [];
    for (var i = 0; i < feeds.length; i++) if (feeds[i] && feeds[i].id === FEED.id) return;
    feeds.push(FEED);
  }
})(typeof window !== "undefined" ? window : globalThis);
