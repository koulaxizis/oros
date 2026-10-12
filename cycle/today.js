// ============================================================
// orOS Cycle — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today"
// (cycle/core.js is already in the shell). Read-only: reads
// oros-cycle-data, never writes. One line when the next period is
// expected within the summary's days, or seems late, from
// OrosCycleCore.nextPrediction: the same estimate as the app and its
// reminder. Expected → on that day ("Period expected"); late → a top
// line today ("Period seems late, expected 3 days ago") for at most
// LATE_MAX days, so a history no longer kept stops showing. Never a
// task. Cycle is a sensitive app: OFF in the summary until the user
// switches it on in the Today settings (BR-TODAY-7). Opens Cycle on
// that day (__orosOpenCycle(ymd), as the reminder does).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-cycle-data";
  var LATE_MAX = 14;
  var TXT = {
    en: { soon: "Period expected", late: "Period seems late", late1: "Expected 1 day ago", lateN: "Expected {n} days ago",
          est: "An estimate from your history" },
    el: { soon: "Αναμένεται περίοδος", late: "Η περίοδος φαίνεται να αργεί", late1: "Αναμενόταν πριν 1 ημέρα",
          lateN: "Αναμενόταν πριν {n} ημέρες", est: "Εκτίμηση από το ιστορικό σου" }
  };

  var PROVIDER = {
    id: "cycle",
    keys: [KEY],
    collect: function (ctx) {
      var C = root.OrosCycleCore, raw = ctx.readJSON(KEY);
      if (!C || !raw || !Array.isArray(raw.periods)) return [];
      var pr = C.nextPrediction(raw.periods);
      if (!pr) return [];
      var w = TXT[ctx.lang] || TXT.en, ymd = C.ymdOf(pr.start), d = ctx.diff(ctx.today, ymd);
      if (d > ctx.horizon || d < -LATE_MAX) return [];
      if (d >= 0) {
        return [{ id: "pred:" + ymd, due: ymd, kind: "event", title: w.soon, text: w.est, target: { day: ymd } }];
      }
      return [{ id: "late:" + ymd, due: ctx.today, kind: "info", title: w.late,
                text: -d === 1 ? w.late1 : w.lateN.replace("{n}", -d), target: { day: ymd } }];
    },
    open: function (target, win) {
      var day = target && typeof target.day === "string" ? target.day : "";
      if (day && typeof win.__orosOpenCycle === "function") win.__orosOpenCycle(day);
      else if (typeof win.__orosOpenApp === "function") win.__orosOpenApp("cycle");
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
