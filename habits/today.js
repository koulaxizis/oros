// ============================================================
// orOS Habits — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today",
// after habits/core.js. Read-only: reads oros-habits-data, never
// writes. One row per habit scheduled for today and not done yet
// (OrosHabitsCore.dueOn, the app's own rule): fixed weekdays on their
// days, "X times per week / month" while the period's count is not
// met; skipped days stay out. Flexible habits (no weekdays) are never
// "due", so they stay out. A measurable habit shows today's value and
// target in its title ("Read · 4 / 10 pages"). Past days are not
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
      var ix = C.index(raw);
      return C.dueOn(ix, ctx.today).map(function (h) {
        var title = h.name;
        if (C.isNum(h)) {
          var v = C.valueOn(ix, h.id, ctx.today);
          title += " · " + (h.num.c === "le" ? "≤ " : "") + (v === null ? 0 : v) + " / " + h.num.t + (h.num.u ? " " + h.num.u : "");
        }
        return {
          id: h.id,
          due: ctx.today,
          title: title,
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
