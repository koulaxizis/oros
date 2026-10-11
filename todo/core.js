// ============================================================
// orOS To-Do — shared read-only core (v1.0.0)
// What is due in "oros-todo-data", one copy for every reader: the
// shell's due reminder (shell.js todoCheckTick), the Calendar's
// To-Do feed (calendar.js todoFeedOn) and the Today summary
// (todo/today.js). Pure: no DOM, no storage, never writes.
//   openDue(data)            → [{ list, item }] every task that is not
//                              done and has a valid due date (lists and
//                              tasks in stored order)
//   dueOn(data, ymd)         → the open tasks due on that day
//   dueSummary(data, ymd)    → { count, earliest, earliestList } of the
//                              open tasks due on or before that day
//                              ("due or overdue", the shell reminder)
// Deleted lists and tasks are gone from the blob (state.deleted only
// keeps their ids), so every list / task present is live.
// Exposes window.OrosTodoCore and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

  function openDue(data) {
    var out = [];
    if (!data || typeof data !== "object" || !Array.isArray(data.lists)) return out;
    data.lists.forEach(function (list) {
      if (!list || typeof list !== "object" || !Array.isArray(list.items)) return;
      list.items.forEach(function (item) {
        if (!item || typeof item !== "object" || item.done) return;
        if (typeof item.due !== "string" || !YMD_RE.test(item.due)) return;
        out.push({ list: list, item: item });
      });
    });
    return out;
  }

  function dueOn(data, ymd) {
    return openDue(data).filter(function (x) { return x.item.due === ymd; });
  }

  function dueSummary(data, ymd) {
    var count = 0, earliest = null, earliestList = null;
    openDue(data).forEach(function (x) {
      if (x.item.due > ymd) return;
      count++;
      if (earliest === null || x.item.due < earliest) { earliest = x.item.due; earliestList = x.list.id; }
    });
    return { count: count, earliest: earliest, earliestList: earliestList };
  }

  var api = { openDue: openDue, dueOn: dueOn, dueSummary: dueSummary };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosTodoCore = api;
})(typeof window !== "undefined" ? window : globalThis);
