// ============================================================
// orOS Quote — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only: reads oros-quote-data, never writes. Which quotes need a
// follow-up is quote/core.js (dueQuotes), the same the shell reminder
// uses: sent or accepted quotes whose due date passed, is today or
// comes in the next days. Opens the quote (__orosOpenQuote).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-quote-data";

  var PROVIDER = {
    id: "quote",
    keys: [KEY],
    collect: function (ctx) {
      var C = root.OrosQuoteCore, raw = ctx.readJSON(KEY);
      if (!C || !raw) return [];
      return C.dueQuotes(raw, ctx.addDays(ctx.today, ctx.horizon)).map(function (q) {
        var who = C.clientName(raw, q);
        return {
          id: q.id,
          due: q.dueDate,
          title: (typeof q.num === "string" && q.num ? q.num : q.id) + (who ? " · " + who : ""),
          kind: "task",
          target: { quote: q.id }
        };
      });
    },
    open: function (target, win) {
      if (target && typeof target.quote === "string" && typeof win.__orosOpenQuote === "function") win.__orosOpenQuote(target.quote);
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
