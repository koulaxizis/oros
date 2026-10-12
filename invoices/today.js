// ============================================================
// orOS Invoices — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today"
// (after invoices/core.js). Read-only: reads oros-invoices-data,
// never writes. Which documents are due is invoices/core.js
// (dueRows), the same the Calendar feed and the shell reminder use:
// issued invoices, receipts and records with money still owed whose
// due date passed or comes within the summary's days. Templates
// whose recurring draft is ready give one line each. Opens the
// document (generic deep link { invoice }) or Invoices itself.
// ============================================================
(function (root) {
  "use strict";
  var W = {
    en: { owes: "{a} owed", rec: "Recurring invoice ready to check: {n}" },
    el: { owes: "οφείλονται {a}", rec: "Επαναλαμβανόμενο τιμολόγιο για έλεγχο: {n}" }
  };
  function money(cents, cur, lang) {
    try {
      return new Intl.NumberFormat(lang === "el" ? "el-GR" : "en-GB", { style: "currency", currency: cur }).format(cents / 100);
    } catch (e) { return (cents / 100).toFixed(2) + " " + cur; }
  }

  var PROVIDER = {
    id: "invoices",
    keys: ["oros-invoices-data"],
    collect: function (ctx) {
      var C = root.OrosInvoicesCore;
      if (!C) return [];
      var data = C.parse(ctx.readRaw(C.STORAGE_KEY));
      if (!data) return [];
      var w = W[ctx.lang] || W.en, out = [];
      C.dueRows(data, ctx.today, ctx.addDays(ctx.today, ctx.horizon)).forEach(function (r) {
        out.push({
          id: r.id, due: r.due, kind: "task",
          title: (r.num || r.id) + (r.who ? " · " + r.who : ""),
          text: w.owes.replace("{a}", money(r.bal, r.cur, ctx.lang)),
          target: { invoice: r.id }
        });
      });
      var seen = {};
      C.recurringDue(data, ctx.today).forEach(function (x) {
        if (seen[x.tpl.id] || C.anyId(data.docs, x.id)) return;   // its draft is made already
        seen[x.tpl.id] = true;
        out.push({ id: "rec-" + x.tpl.id, due: null, kind: "task",
                   title: w.rec.replace("{n}", x.tpl.name), target: { recurring: 1 } });
      });
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
