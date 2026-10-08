// ============================================================
// orOS Workouts — Habits feed provider (v1.0.0)
// Loaded by habits/index.html before habits.js. Adds one read-only
// row, "Workouts", to Habits through the generic
// window.orosHabitFeeds registry: a day counts when it has a
// finished workout. Reads oros-fitness-data only; never writes.
// The row hides when the user turns it off in Workouts › Settings
// (synced setting set.hb = 0) or when there is no workout yet.
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

  var FEED = {
    id: "fitness",
    app: "fitness",
    name: { en: "Workouts", el: "Προπόνηση" },
    hint: { en: "A finished workout in the Workouts app", el: "Μια ολοκληρωμένη προπόνηση στην εφαρμογή Προπόνηση" },
    color: "#f28c5a",
    icon: ICON,
    keys: [STORAGE_KEY],
    read: function () {
      var data = null;
      try { data = JSON.parse(root.localStorage.getItem(STORAGE_KEY)); } catch (e) {}
      return workoutDays(data);
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = { FEED: FEED, workoutDays: workoutDays };
  if (root && root.document) {
    var feeds = root.orosHabitFeeds = root.orosHabitFeeds || [];
    for (var i = 0; i < feeds.length; i++) if (feeds[i] && feeds[i].id === FEED.id) return;
    feeds.push(FEED);
  }
})(typeof window !== "undefined" ? window : globalThis);
