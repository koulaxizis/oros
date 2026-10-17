// ============================================================
// orOS Budget — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today",
// after budget/feed.js. Read-only: reads oros-budget-data, never
// writes. The recurring entries (rent, salary, a yearly insurance)
// that fall today or in the next days, with their amount, from
// OrosBudgetFeed.rowsOn: the same occurrence rules as the app and
// the Calendar's Budget feed. Budget has no "paid" mark (it books a
// recurring entry itself when it opens), so a past day never shows.
// Budget is a sensitive app: in the summary by default, it can be
// switched off in the Today settings. Opens that recurring entry
// (__orosOpenAt: { rec }).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-budget-data";
  var KIND = { en: { o: "Expense", i: "Income" }, el: { o: "Έξοδο", i: "Έσοδο" } };

  // orosI18n (the shell's ../i18n.js): a pack language included.
  function i18n() { return typeof window !== "undefined" && window.orosI18n; }
  function money(cents, cur, lang) {
    try {
      return new Intl.NumberFormat(i18n() ? i18n().locale(lang) : (lang === "el" ? "el-GR" : "en-GB"), { style: "currency", currency: cur }).format(cents / 100);
    } catch (e) {
      return (cents / 100).toFixed(2) + " " + cur;
    }
  }

  var PROVIDER = {
    id: "budget",
    keys: [KEY],
    collect: function (ctx) {
      var F = root.OrosBudgetFeed, raw = ctx.readJSON(KEY);
      if (!F || !raw || typeof raw !== "object" || !Array.isArray(raw.rec) || !raw.rec.length) return [];
      var I = i18n(), lang = ctx.lang || "en", out = [];
      if (I && !KIND[lang]) I.table(KIND, "budget", lang);
      if (!KIND[lang]) lang = "en";
      for (var i = 0; i <= ctx.horizon; i++) {
        var day = ctx.addDays(ctx.today, i);
        F.rowsOn(raw, day, ctx.today, lang).forEach(function (r) {
          out.push({
            id: r.id + ":" + day,
            due: day,
            title: r.name || KIND[lang][r.k],
            text: (r.k === "o" ? "−" : "+") + money(r.a, r.cur, lang),
            kind: "event",
            target: { rec: r.id }
          });
        });
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
