// ============================================================
// orOS Quote — shared read-only core (v1.0.0)
// Which quotes need a follow-up, one copy for the shell's due
// reminder (shell.js quoteCheckTick) and the Today summary
// (quote/today.js). Pure: no DOM, no storage, never writes.
//   dueQuotes(data, untilYmd) → the quotes that are "sent" or
//     "accepted" and have a due date on or before untilYmd, earliest
//     first (ties by id). Drafts, rejected and expired quotes, and
//     quotes without a due date, never count.
//   clientName(data, q)       → the client's name or "".
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

  var api = { dueQuotes: dueQuotes, clientName: clientName };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosQuoteCore = api;
})(typeof window !== "undefined" ? window : globalThis);
