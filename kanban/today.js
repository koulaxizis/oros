// ============================================================
// orOS Kanban — Today provider (v1.1.0)
// Loaded by the shell (today/host.js) through apps.json "today":
// ["core.js", "today.js"]. Read-only: reads oros-kanban-data, never
// writes. Which cards are due is kanban/core.js (dueCards), the same
// the Calendar feed uses, here without each board's last column (the
// "Done" column). Rows: cards whose due date passed, is today or
// comes in the next days, with their board and column; archived
// boards stay out. Opens the card (__orosOpenKanbanCard).
// 1.1.0 (Gantt G3): a card whose planned start (card.start) is today
// gives a "Starts today" row (kind event, so it never turns late).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-kanban-data";
  var W = { en: { "tdy.start": "Starts today" }, el: { "tdy.start": "Ξεκινά σήμερα" } };
  function i18n() { return typeof window !== "undefined" && window.orosI18n; }

  var PROVIDER = {
    id: "kanban",
    keys: [KEY],
    collect: function (ctx) {
      var C = root.OrosKanbanCore, raw = ctx.readJSON(KEY);
      if (!C || !raw) return [];
      var I = i18n();
      if (I && ctx.lang && !W[ctx.lang]) I.table(W, "kanban", ctx.lang);
      var w = W[ctx.lang] || W.en;
      function where(x) { return (typeof x.board.name === "string" ? x.board.name + " · " : "") + (typeof x.col.name === "string" ? x.col.name : ""); }
      var starts = typeof C.startCards === "function" ? C.startCards(raw, ctx.today, ctx.today, { skipLast: true }).map(function (x) {
        return {
          id: x.board.id + "/" + x.card.id + "/start",
          due: ctx.today,
          title: typeof x.card.text === "string" ? x.card.text : "",
          text: w["tdy.start"] + " · " + where(x),
          kind: "event",
          target: { board: x.board.id, col: x.col.id, card: x.card.id }
        };
      }) : [];
      return C.dueCards(raw, null, ctx.addDays(ctx.today, ctx.horizon), { skipLast: true }).map(function (x) {
        return {
          id: x.board.id + "/" + x.card.id,
          due: x.card.due,
          title: typeof x.card.text === "string" ? x.card.text : "",
          text: where(x),
          kind: "task",
          target: { board: x.board.id, col: x.col.id, card: x.card.id }
        };
      }).concat(starts);
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
