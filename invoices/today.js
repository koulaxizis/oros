// ============================================================
// orOS Billing (Invoices) — Today provider (v1.3.0)
// Loaded by the shell (today/host.js) through apps.json "today"
// (after invoices/core.js). Read-only: reads oros-invoices-data,
// never writes. Which documents are due is invoices/core.js
// (dueRows), the same the Calendar feed and the shell reminder use:
// issued invoices, receipts and records with money still owed whose
// due date passed or comes within the summary's days, and received
// invoices still to pay the same way (wave 7, { bill }). Templates
// whose recurring draft is ready give one line each. Opens the
// document (generic deep link { invoice }) or Invoices itself.
// 1.2.0 (BR-TODAY-15): a tip on a document past its due day.
// 1.3.0 (app merge 7): the quotes are Billing's Quotes tab, so the
// rows the Quote app gave (quote/today.js: sent or accepted quotes
// whose due day passed or comes within the summary's days, from
// quote/core.js dueQuotes, which the shell page loads) come from here,
// read-only from oros-quote-data, and open { tab: "quotes", quote }.
// ============================================================
(function (root) {
  "use strict";
  var W = {
    en: { owes: "{a} owed", rec: "Recurring invoice ready to check: {n}", billPay: "To pay: {a}",
          "tdy.tipOwed": "Past its due day: a short, friendly reminder to the customer usually helps.",
          "tdy.tipBill": "Past its due day: pay it, or agree a new date with the supplier." },
    el: { owes: "οφείλονται {a}", rec: "Επαναλαμβανόμενο τιμολόγιο για έλεγχο: {n}", billPay: "Προς πληρωμή: {a}",
          "tdy.tipOwed": "Πέρασε η προθεσμία: μια σύντομη, φιλική υπενθύμιση στον πελάτη συνήθως βοηθά.",
          "tdy.tipBill": "Πέρασε η προθεσμία: πλήρωσέ το ή συμφώνησε νέα ημερομηνία με τον προμηθευτή." }
  };
  // orosI18n (the shell's ../i18n.js): a pack language included.
  function i18n() { return typeof window !== "undefined" && window.orosI18n; }
  function money(cents, cur, lang) {
    try {
      return new Intl.NumberFormat(i18n() ? i18n().locale(lang) : (lang === "el" ? "el-GR" : "en-GB"), { style: "currency", currency: cur }).format(cents / 100);
    } catch (e) { return (cents / 100).toFixed(2) + " " + cur; }
  }

  // The Quotes tab's rows (was quote/today.js).
  function quoteRows(ctx) {
    var Q = root.OrosQuoteCore, raw = null;
    try { raw = JSON.parse(ctx.readRaw("oros-quote-data")); } catch (e) { raw = null; }
    if (!Q || !raw) return [];
    return Q.dueQuotes(raw, ctx.addDays(ctx.today, ctx.horizon)).map(function (q) {
      var who = Q.clientName(raw, q);
      return {
        id: "q-" + q.id,
        due: q.dueDate,
        title: (typeof q.num === "string" && q.num ? q.num : q.id) + (who ? " · " + who : ""),
        kind: "task",
        target: { tab: "quotes", quote: q.id }
      };
    });
  }

  var PROVIDER = {
    id: "invoices",
    keys: ["oros-invoices-data", "oros-quote-data"],
    collect: function (ctx) {
      var C = root.OrosInvoicesCore;
      if (!C) return [];
      var data = C.parse(ctx.readRaw(C.STORAGE_KEY));
      var quotes = quoteRows(ctx);
      if (!data) return quotes;
      var I = i18n();
      if (I && ctx.lang && !W[ctx.lang]) I.table(W, "invoices", ctx.lang);
      var w = W[ctx.lang] || W.en, out = [];
      // a tip only on a document past its due day (BR-TODAY-15)
      function tipped(row, late, tip) { if (late) row.tip = tip; return row; }
      C.dueRows(data, ctx.today, ctx.addDays(ctx.today, ctx.horizon)).forEach(function (r) {
        out.push(tipped({
          id: r.id, due: r.due, kind: "task",
          title: (r.num || r.id) + (r.who ? " · " + r.who : ""),
          text: w.owes.replace("{a}", money(r.bal, r.cur, ctx.lang)),
          target: { invoice: r.id }
        }, r.due && r.due < ctx.today, w["tdy.tipOwed"]));
      });
      // received invoices (wave 7) still to pay whose due day passed or
      // comes within the summary's days
      var last = ctx.addDays(ctx.today, ctx.horizon);
      if (typeof C.billBalance === "function") C.live(data.bills || []).forEach(function (b) {
        if (!b.due || b.due > last) return;
        var bal = C.billBalance(data, b);
        if (bal <= 0) return;
        out.push(tipped({ id: "bill-" + b.id, due: b.due, kind: "task",
                   title: (b.num || "—") + " · " + b.sup.name, text: w.billPay.replace("{a}", money(bal, b.cur, ctx.lang)),
                   target: { bill: b.id } }, b.due < ctx.today, w["tdy.tipBill"]));
      });
      var seen = {};
      C.recurringDue(data, ctx.today).forEach(function (x) {
        if (seen[x.tpl.id] || C.anyId(data.docs, x.id)) return;   // its draft is made already
        seen[x.tpl.id] = true;
        out.push({ id: "rec-" + x.tpl.id, due: null, kind: "task",
                   title: w.rec.replace("{n}", x.tpl.name), target: { recurring: 1 } });
      });
      return out.concat(quotes);
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
