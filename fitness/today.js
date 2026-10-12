// ============================================================
// orOS Workouts — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today",
// after fitness/core.js. Read-only: reads oros-fitness-data, never
// writes. One row per program day planned for today
// (OrosFitnessCore.plannedOn, the same list as the Train tab's
// "Today"), left out once a finished workout of that program day is
// logged today (doneOn). Only today: a skipped session is not a late
// task. Opens Workouts on the Train tab ({ train: true }).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-fitness-data";
  var DAY_N = { en: "Day {n}", el: "Ημέρα {n}" };
  var EX = { en: "{n} exercises", el: "{n} ασκήσεις" };
  var EX1 = { en: "1 exercise", el: "1 άσκηση" };

  var PROVIDER = {
    id: "fitness",
    keys: [KEY],
    collect: function (ctx) {
      var C = root.OrosFitnessCore, raw = ctx.readJSON(KEY);
      if (!C || !raw) return [];
      var lang = ctx.lang === "el" ? "el" : "en";
      return C.plannedOn(raw, ctx.today).filter(function (r) {
        return !C.doneOn(raw, ctx.today, r.pg.id, r.day.id);
      }).map(function (r) {
        var idx = r.pg.days.indexOf(r.day) + 1, n = r.day.it.length;
        var dayName = typeof r.day.n === "string" && r.day.n ? r.day.n : DAY_N[lang].replace("{n}", idx);
        var pgName = typeof r.pg.n === "string" ? r.pg.n : "";
        return {
          id: r.pg.id + "/" + r.day.id,
          due: ctx.today,
          title: dayName,
          text: (pgName ? pgName + " · " : "") + (n === 1 ? EX1[lang] : EX[lang].replace("{n}", n)),
          kind: "task",
          target: { train: true }
        };
      });
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
