// ============================================================
// orOS Timesheet — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only: reads oros-timesheet-data, never writes. Nothing in
// Timesheet is "due", so it gives top lines only (timesheet/core.js:
// running, dayTotals): a timer that is running, and the time tracked
// today against the daily goal when there is one. Opens Timesheet on
// today (its own __orosOpenAt: { day }).
// ============================================================
(function (root) {
  "use strict";
  var W = {
    en: { run: "Timer running since {t}", noproj: "no project", day: "Tracked today: {d}", goal: "Tracked today: {d} of {g}" },
    el: { run: "Το χρονόμετρο μετράει από τις {t}", noproj: "χωρίς έργο", day: "Σήμερα: {d}", goal: "Σήμερα: {d} από {g}" }
  };

  var PROVIDER = {
    id: "timesheet",
    keys: ["oros-timesheet-data"],
    collect: function (ctx) {
      var C = root.orosTimesheetCore;
      if (!C) return [];
      var raw = ctx.readRaw(C.STORAGE_KEY);
      var data = raw ? C.parse(raw) : null;
      if (!data) return [];
      var w = W[ctx.lang] || W.en, out = [];
      var run = C.running(data)[0];
      if (run) {
        var p = C.project(data, run.p), d = new Date(run.s);
        var hm = (d.getHours() < 10 ? "0" : "") + d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
        out.push({ id: "run", kind: "info", title: w.run.replace("{t}", hm), text: p ? p.name : w.noproj,
                   target: { day: ctx.today } });
      }
      var ms = C.dayTotals(data, ctx.today, ctx.today, ctx.now)[ctx.today] || 0;
      var goal = data.prefs && data.prefs.goal ? data.prefs.goal * 60000 : 0;
      if (ms > 0 || goal) {
        out.push({ id: "day", kind: "info", target: { day: ctx.today },
                   title: goal ? w.goal.replace("{d}", C.fmtDur(ms)).replace("{g}", C.fmtDur(goal)) : w.day.replace("{d}", C.fmtDur(ms)) });
      }
      return out;
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
