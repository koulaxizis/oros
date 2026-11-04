// ============================================================
// orOS Budget — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today",
// after budget/feed.js. Read-only: reads oros-budget-data, never
// writes. The recurring entries (rent, salary, a yearly insurance)
// that fall today or in the next days, with their amount, from
// OrosBudgetFeed.rowsOn: the same occurrence rules as the app and
// the Calendar's Budget feed. Budget has no "paid" mark (it books a
// recurring entry itself when it opens), so a past day never shows.
// Also a loan's next installment and a card's unpaid statement due
// in the horizon (RM-1, budget/loans.js).
// Budget is a sensitive app: in the summary by default, it can be
// switched off in the Today settings. Opens that recurring entry
// (__orosOpenAt: { rec }).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-budget-data";
  var KIND = { en: { o: "Expense", i: "Income", loan: "Loan installment", card: "Card payment due" },
               el: { o: "Έξοδο", i: "Έσοδο", loan: "Δόση δανείου", card: "Πληρωμή κάρτας" } };

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
      if (!raw || typeof raw !== "object") return [];
      var I = i18n(), lang = ctx.lang || "en", out = [];
      var hasRec = F && Array.isArray(raw.rec) && raw.rec.length;
      if (I && !KIND[lang]) I.table(KIND, "budget", lang);
      if (!KIND[lang]) lang = "en";
      for (var i = 0; i <= ctx.horizon; i++) {
        var day = ctx.addDays(ctx.today, i);
        if (hasRec) F.rowsOn(raw, day, ctx.today, lang).forEach(function (r) {
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
      // RM-1: a loan's next installment and a card statement still unpaid
      // (budget/loans.js and budget/plan.js, loaded by the shell)
      var L = root.OrosBudgetLoans, P = root.OrosBudgetPlan;
      if (L && typeof L.remindersDue === "function") {
        var cur = raw.set && typeof raw.set.cur === "string" && /^[A-Z]{3}$/.test(raw.set.cur) ? raw.set.cur : "EUR";
        var due = [];
        try { due = L.remindersDue(raw, ctx.today, P, ctx.horizon); } catch (e) { due = []; }
        due.forEach(function (d) {
          out.push({
            id: d.key,
            due: d.next,
            title: KIND[lang][d.kind] + ", " + String(d.n || "").slice(0, 80),
            text: "\u2212" + money(d.a, cur, lang),
            kind: "event",
            target: {}
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
