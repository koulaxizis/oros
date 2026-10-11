// ============================================================
// orOS Kanban — shared read-only core (v1.0.0)
// Cards with a due date in "oros-kanban-data", one copy for the
// Calendar's Kanban feed (calendar.js kanbanFeedOn) and the Today
// summary (kanban/today.js). Pure: no DOM, no storage, never writes.
//   dueCards(data, from, to, opts) → [{ board, col, card, last }] for
//     every card whose due date is in [from, to] ("" / null from = no
//     lower bound), in stored order. Archived boards are left out;
//     opts.skipLast also leaves out each board's LAST column (the
//     "Done" column by convention, Chris 2026-10-11). last = the card
//     sits in its board's last column.
// Exposes window.OrosKanbanCore and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

  function dueCards(data, from, to, opts) {
    opts = opts || {};
    var out = [];
    if (!data || typeof data !== "object" || !Array.isArray(data.boards)) return out;
    data.boards.forEach(function (bd) {
      if (!bd || typeof bd !== "object" || bd.archived) return;
      var cols = Array.isArray(bd.columns) ? bd.columns : [];
      cols.forEach(function (col, ci) {
        if (!col || typeof col !== "object") return;
        var last = ci === cols.length - 1;
        if (last && opts.skipLast && cols.length > 1) return;
        (Array.isArray(col.cards) ? col.cards : []).forEach(function (card) {
          if (!card || typeof card !== "object" || typeof card.due !== "string" || !YMD_RE.test(card.due)) return;
          if (from && card.due < from) return;
          if (to && card.due > to) return;
          out.push({ board: bd, col: col, card: card, last: last });
        });
      });
    });
    return out;
  }

  var api = { dueCards: dueCards };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosKanbanCore = api;
})(typeof window !== "undefined" ? window : globalThis);
