// ============================================================
// orOS Mood — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today"
// (mood/core.js is already in the shell). Read-only: reads
// oros-mood-data, never writes. One row, "Mood check-in", while no
// mood is logged today, once the app has been used at all
// (OrosMoodCore: the same rule as the daily reminder). Only today: a
// missed day is not a late task. Mood is a sensitive app: OFF in the
// summary until the user switches it on (BR-TODAY-7). Opens Mood on
// the check-in (__orosOpenMood("checkin"), as the reminder does).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-mood-data";
  var TXT = { en: "Mood check-in", el: "Καταγραφή διάθεσης" };

  var PROVIDER = {
    id: "mood",
    keys: [KEY],
    collect: function (ctx) {
      var C = root.OrosMoodCore, raw = ctx.readJSON(KEY);
      if (!C || !C.hasAny(raw) || C.hasOn(raw, ctx.today)) return [];
      return [{ id: "checkin:" + ctx.today, due: ctx.today, kind: "task",
                title: TXT[ctx.lang] || TXT.en, target: { checkin: true } }];
    },
    open: function (target, win) {
      if (typeof win.__orosOpenMood === "function") win.__orosOpenMood("checkin");
      else if (typeof win.__orosOpenApp === "function") win.__orosOpenApp("mood");
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
