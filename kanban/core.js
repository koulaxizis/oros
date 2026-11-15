// ============================================================
// orOS Kanban — shared read-only core (v1.1.0)
// Cards with a due date in "oros-kanban-data", one copy for the
// Calendar's Kanban feed (calendar.js kanbanFeedOn) and the Today
// summary (kanban/today.js). Pure: no DOM, no storage, never writes.
//   dueCards(data, from, to, opts) → [{ board, col, card, last }] for
//     every card whose due date is in [from, to] ("" / null from = no
//     lower bound), in stored order. Archived boards are left out;
//     opts.skipLast also leaves out each board's LAST column (the
//     "Done" column by convention, Chris 2026-10-11). last = the card
//     sits in its board's last column.
//   startCards(data, from, to, opts) → the same shape for every card
//     whose plan start (card.start, Gantt G3) is in [from, to] and is
//     not its due day; milestones (card.ms) have no start of their
//     own. Calendar shows a "starts" mark on that day, Today a row.
// Exposes window.OrosKanbanCore and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

  function dueCards(data, from, to, opts) { return walk(data, from, to, opts, dueOf); }
  function startCards(data, from, to, opts) { return walk(data, from, to, opts, startOf); }
  function dueOf(card) { return typeof card.due === "string" && YMD_RE.test(card.due) ? card.due : null; }
  function startOf(card) {
    if (card.ms || typeof card.start !== "string" || !YMD_RE.test(card.start)) return null;
    return card.start === card.due ? null : card.start;
  }

  function walk(data, from, to, opts, dayOf) {
    opts = opts || {};
    var out = [];
    if (!data || typeof data !== "object" || !Array.isArray(data.boards)) return out;
    data.boards.forEach(function (bd) {
      if (!bd || typeof bd !== "object" || bd.archived || /^tpl-/.test(bd.id || "")) return;   // templates: archived "tpl-" boards
      var cols = Array.isArray(bd.columns) ? bd.columns : [];
      cols.forEach(function (col, ci) {
        if (!col || typeof col !== "object") return;
        var last = ci === cols.length - 1;
        if (last && opts.skipLast && cols.length > 1) return;
        (Array.isArray(col.cards) ? col.cards : []).forEach(function (card) {
          if (!card || typeof card !== "object") return;
          var day = dayOf(card);
          if (!day || (from && day < from) || (to && day > to)) return;
          out.push({ board: bd, col: col, card: card, last: last });
        });
      });
    });
    return out;
  }

  var api = { dueCards: dueCards, startCards: startCards };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosKanbanCore = api;
})(typeof window !== "undefined" ? window : globalThis);
