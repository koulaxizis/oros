// ============================================================
// orOS Quote — shared read-only core (v1.1.0)
// Which quotes need a follow-up, one copy for the shell's due
// reminder (shell.js quoteCheckTick) and the Today summary
// (quote/today.js). Pure: no DOM, no storage, never writes.
//   dueQuotes(data, untilYmd) → the quotes that are "sent" or
//     "accepted" and have a due date on or before untilYmd, earliest
//     first (ties by id). Drafts, rejected and expired quotes, and
//     quotes without a due date, never count.
//   clientName(data, q)       → the client's name or "".
//   total(q)                  → the quote's total with VAT, the same
//     sum as quote.js calcTotals (line discount, global discount, VAT).
//   forClient(data, who)      → BR-CRM-Q (CRM Lite, read-only): the
//     quotes of one customer, who = { name, afm }. A quote belongs to
//     it when its client's tax id equals afm (spaces ignored) or its
//     client's name equals name (case and accents ignored). Deleted
//     quotes never count. Newest date first (ties by num, then id).
//     → [{ id, num, date, due, status, cur, total }]
// Exposes window.OrosQuoteCore and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

  function dueQuotes(data, untilYmd) {
    if (!data || typeof data !== "object" || !Array.isArray(data.quotes)) return [];
    return data.quotes.filter(function (q) {
      return q && typeof q === "object" && typeof q.id === "string" && q.id &&
             (q.status === "sent" || q.status === "accepted") &&
             typeof q.dueDate === "string" && YMD_RE.test(q.dueDate) && q.dueDate <= untilYmd;
    }).sort(function (a, b) {
      return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
  }

  function clientName(data, q) {
    if (!q || !q.clientId || !data || !Array.isArray(data.clients)) return "";
    for (var i = 0; i < data.clients.length; i++) {
      var c = data.clients[i];
      if (c && c.id === q.clientId) return typeof c.name === "string" ? c.name : "";
    }
    return "";
  }

  function r2(n) { return Math.round(n * 100) / 100; }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }
  function total(q) {
    var sub = 0, vat = 0, g = num(q && q.gDisc);
    ((q && q.items) || []).forEach(function (it) {
      if (!it || typeof it !== "object") return;
      var line = num(it.qty) * num(it.price) * (1 - num(it.disc) / 100);
      sub += line;
      vat += line * (1 - g / 100) * (num(it.vat) / 100);
    });
    return r2(r2(r2(sub) * (1 - g / 100)) + r2(vat));
  }
  function fold(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
  }
  function forClient(data, who) {
    if (!data || typeof data !== "object" || !Array.isArray(data.quotes) || !who) return [];
    var name = fold(who.name), afm = String(who.afm || "").replace(/\s+/g, "");
    if (!name && !afm) return [];
    var mine = {};
    (Array.isArray(data.clients) ? data.clients : []).forEach(function (c) {
      if (!c || typeof c !== "object" || typeof c.id !== "string") return;
      var tax = String(c.taxId || "").replace(/\s+/g, "");
      if ((afm && tax && tax === afm) || (name && fold(c.name) === name)) mine[c.id] = true;
    });
    var gone = data.deleted && typeof data.deleted === "object" ? data.deleted : {};
    return data.quotes.filter(function (q) {
      return q && typeof q === "object" && typeof q.id === "string" && q.id && !gone[q.id] && mine[q.clientId];
    }).map(function (q) {
      return { id: q.id, num: String(q.num || ""), date: YMD_RE.test(q.date || "") ? q.date : "",
               due: YMD_RE.test(q.dueDate || "") ? q.dueDate : "", status: String(q.status || "draft"),
               cur: q.currency === "USD" ? "USD" : "EUR", total: total(q) };
    }).sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.num < b.num ? 1 : a.num > b.num ? -1 : (a.id < b.id ? 1 : -1));
    });
  }

  var api = { dueQuotes: dueQuotes, clientName: clientName, total: total, forClient: forClient };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosQuoteCore = api;
})(typeof window !== "undefined" ? window : globalThis);
