// ============================================================
// orOS Habits — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today",
// after habits/core.js. Read-only: reads oros-habits-data, never
// writes. One row per habit scheduled for today and not ticked yet
// (OrosHabitsCore.dueOn, the app's own rule). Flexible habits (no
// weekdays) are never "due", so they stay out. Past days are not
// shown: a missed habit is not a late task. Opens Habits on the
// current period (__orosOpenHabits(0)), where the habit is ticked.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-habits-data";

  var PROVIDER = {
    id: "habits",
    keys: [KEY],
    collect: function (ctx) {
      var C = root.OrosHabitsCore, raw = ctx.readJSON(KEY);
      if (!C || !raw) return [];
      return C.dueOn(raw, ctx.today).map(function (h) {
        return {
          id: h.id,
          due: ctx.today,
          title: h.name,
          kind: "task",
          target: { habit: h.id }
        };
      });
    },
    open: function (target, win) {
      if (typeof win.__orosOpenHabits === "function") win.__orosOpenHabits(0);
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
