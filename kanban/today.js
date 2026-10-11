// ============================================================
// orOS Kanban — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today":
// ["core.js", "today.js"]. Read-only: reads oros-kanban-data, never
// writes. Which cards are due is kanban/core.js (dueCards), the same
// the Calendar feed uses, here without each board's last column (the
// "Done" column). Rows: cards whose due date passed, is today or
// comes in the next days, with their board and column; archived
// boards stay out. Opens the card (__orosOpenKanbanCard).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-kanban-data";

  var PROVIDER = {
    id: "kanban",
    keys: [KEY],
    collect: function (ctx) {
      var C = root.OrosKanbanCore, raw = ctx.readJSON(KEY);
      if (!C || !raw) return [];
      return C.dueCards(raw, null, ctx.addDays(ctx.today, ctx.horizon), { skipLast: true }).map(function (x) {
        return {
          id: x.board.id + "/" + x.card.id,
          due: x.card.due,
          title: typeof x.card.text === "string" ? x.card.text : "",
          text: (typeof x.board.name === "string" ? x.board.name + " · " : "") + (typeof x.col.name === "string" ? x.col.name : ""),
          kind: "task",
          target: { board: x.board.id, col: x.col.id, card: x.card.id }
        };
      });
    },
    open: function (target, win) {
      if (!target || typeof win.__orosOpenKanbanCard !== "function") return;
      win.__orosOpenKanbanCard(String(target.board || ""), String(target.col || ""), String(target.card || ""));
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
