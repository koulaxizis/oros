// ============================================================
// orOS Game Center — Today provider (v1.0.0, CH-3)
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only: asks the shell side of the daily challenges
// (window.orosChallenges.peek, gamecenter/host.js) for today's goals
// as they stand; never makes the day's goals and never writes. One
// info row ("Game challenges: 1 of 3 done"), only when today's goals
// exist and the section is not hidden. The Assistant reads the same
// row through orosToday.agenda("gamecenter"). Opens the Game Center.
// ============================================================
(function (root) {
  "use strict";
  var W = {
    en: { "t.title": "Game challenges", "t.text": "{n} of {k} done", "t.all": "All done" },
    el: { "t.title": "Προκλήσεις παιχνιδιών", "t.text": "{n} από {k} έγιναν", "t.all": "Έγιναν όλες" }
  };
  function words(lang) {
    var I = root && root.orosI18n;
    if (I && I.known(lang) && !W[lang]) I.table(W, "gamecenter", lang);
    return W[lang] || W.en;
  }
  var PROVIDER = {
    id: "gamecenter",
    keys: ["oros-gamechal-data"],
    collect: function (ctx) {
      var H = root.orosChallenges, p = null;
      try { p = H && typeof H.peek === "function" ? H.peek() : null; } catch (e) { p = null; }
      if (!p || !p.goals.length) return [];
      var w = words(ctx.lang), k = p.goals.length, n = k - p.open;
      return [{ id: "chal", kind: "info",
        title: w["t.title"] + ": " + (p.open ? w["t.text"].replace("{n}", n).replace("{k}", k) : w["t.all"]) }];
    },
    open: function (target, win) {
      if (typeof win.__orosOpenApp === "function") win.__orosOpenApp("gamecenter");
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
