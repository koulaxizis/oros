// ============================================================
// orOS Time — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only: lists the shell's alarms (window.orosAlarms.list(), the
// same list the Time app shows), never adds or removes one. Rows:
// alarms that ring later today, at their time. A running timer or
// Pomodoro is a "once" alarm set less than 3 hours ahead: left out
// (it rings by itself within the hour), like any such short alarm.
// Opens the Alarms tab of Time (__orosOpenTime("alarms")).
// ============================================================
(function (root) {
  "use strict";
  var W = { en: "Alarm", el: "Ξυπνητήρι" };
  var SHORT_MS = 3 * 3600000;      // shorter than this from now and "once": a timer

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  var PROVIDER = {
    id: "time",
    keys: ["oros-alarms"],
    collect: function (ctx) {
      var A = root.orosAlarms, list = [];
      try { list = A && typeof A.list === "function" ? A.list() : []; } catch (e) { list = []; }
      var out = [];
      (Array.isArray(list) ? list : []).forEach(function (a) {
        if (!a || typeof a.at !== "number" || a.at < ctx.now) return;
        var d = new Date(a.at);
        var day = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
        if (day !== ctx.today) return;
        if (a.repeat !== "daily" && a.mtime && a.at - a.mtime < SHORT_MS) return;
        out.push({ id: String(a.id), due: day, time: pad(d.getHours()) + ":" + pad(d.getMinutes()),
                   kind: "event", title: a.label || (W[ctx.lang] || W.en) });
      });
      return out;
    },
    open: function (target, win) {
      if (typeof win.__orosOpenTime === "function") win.__orosOpenTime("alarms");
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
