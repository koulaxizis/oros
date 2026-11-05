// ============================================================
// orOS Timesheet — Today provider (v1.1.0)
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only: reads oros-timesheet-data, never writes. Nothing in
// Timesheet is "due", so it gives top lines only (timesheet/core.js:
// running, dayTotals): a timer that is running, and the time tracked
// today against the daily goal when there is one. Opens Timesheet on
// today (its own __orosOpenAt: { day }). T4 (v1.1.0): what is still
// to invoice (core.unbilled, the To invoice tab's own sums) as one
// more top line when it has an amount, opening that tab ({ tab: "bill" }).
// ============================================================
(function (root) {
  "use strict";
  var W = {
    en: { run: "Timer running since {t}", noproj: "no project", day: "Tracked today: {d}", goal: "Tracked today: {d} of {g}",
          bill: "To invoice: {d}", bill1: "1 client", billN: "{n} clients" },
    el: { run: "Το χρονόμετρο μετράει από τις {t}", noproj: "χωρίς έργο", day: "Σήμερα: {d}", goal: "Σήμερα: {d} από {g}",
          bill: "Προς τιμολόγηση: {d}", bill1: "1 πελάτης", billN: "{n} πελάτες" }
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
      if (typeof C.unbilled === "function") {
        var un = C.unbilled(data, ctx.today, ctx.now), bms = 0, amt = 0;
        un.forEach(function (r) { bms += r.ms; amt += r.amount; });
        // only when something is charged: time tracked without rates
        // (personal use) is not "to invoice"
        if (un.length && amt > 0) {
          var cur = data.prefs && data.prefs.cur || "EUR";
          var what = [bms > 0 ? C.fmtDur(bms) : "", amt > 0 ? C.fmtMoney(amt, cur, ctx.lang) : ""].filter(Boolean).join(" · ");
          out.push({ id: "bill", kind: "info", target: { tab: "bill" }, title: w.bill.replace("{d}", what),
                     text: un.length === 1 ? w.bill1 : w.billN.replace("{n}", un.length) });
        }
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
