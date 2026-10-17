// ============================================================
// orOS Minimalism — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today"
// (minimalism/core.js is already in the shell). Read-only: reads
// oros-minimalism-data, never writes. One row, "Today's proposal",
// while today's proposal is neither done nor skipped, once the app
// has been used at all (OrosMinimalismCore: the same rule as the
// daily nudge, which the "quiet the morning reminders" setting now
// covers). The proposal's text stays in the app (content.js is not
// loaded by the shell). Only today: a missed day is not a late task.
// Opens Minimalism on today (__orosOpenMinimalism(ymd)).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-minimalism-data";
  var TXT = { en: { "today.title": "Today's proposal", "today.text": "Done or skip, in the app" },
              el: { "today.title": "Η πρόταση της ημέρας", "today.text": "Έγινε ή παράλειψη, στην εφαρμογή" } };
  // Pack "minimalism": the shell runs this file, so a pack language reads
  // the "minimalism" pack when the shell has it, else English.
  function words(lang) {
    var I = root && root.orosI18n;
    if (I && I.known && I.known(lang) && !TXT[lang]) I.table(TXT, "minimalism", lang);
    return TXT[lang] || TXT.en;
  }

  var PROVIDER = {
    id: "minimalism",
    keys: [KEY],
    collect: function (ctx) {
      var C = root.OrosMinimalismCore, raw = ctx.readJSON(KEY);
      if (!C || !C.hasAny(raw) || C.engagedOn(raw, ctx.today)) return [];
      var w = words(ctx.lang);
      return [{ id: "day:" + ctx.today, due: ctx.today, kind: "task", title: w["today.title"], text: w["today.text"],
                target: { day: ctx.today } }];
    },
    open: function (target, win) {
      var day = target && typeof target.day === "string" ? target.day : "";
      if (day && typeof win.__orosOpenMinimalism === "function") win.__orosOpenMinimalism(day);
      else if (typeof win.__orosOpenApp === "function") win.__orosOpenApp("minimalism");
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
