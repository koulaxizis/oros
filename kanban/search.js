// ============================================================
// orOS Kanban — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-kanban-data, never writes.
// One hit per card (text; notes, subtasks, extra info, board and
// column as text). The date shown is the due date. Archived boards
// are skipped (the Kanban deep link refuses them); deleted boards,
// columns and cards are not in the arrays (tombstone maps).
// Opens through the existing Kanban bridge (__orosOpenKanbanCard).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-kanban-data";
  var YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function dueMs(s) {
    var m = typeof s === "string" && YMD.exec(s);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 12).getTime() : 0;
  }
  function arr(a) { return Array.isArray(a) ? a : []; }

  var PROVIDER = {
    id: "kanban",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.boards)) return out;
      var gone = d.boardDeleted && typeof d.boardDeleted === "object" ? d.boardDeleted : {};
      d.boards.forEach(function (b) {
        if (!b || typeof b.id !== "string" || b.archived || gone[b.id]) return;
        arr(b.columns).forEach(function (c) {
          if (!c || typeof c.id !== "string") return;
          arr(c.cards).forEach(function (k) {
            if (!k || typeof k.id !== "string") return;
            var sub = arr(k.subtasks).map(function (s) { return s ? str(s.text) : ""; });
            var info = arr(k.info).map(function (x) {
              return x ? [str(x.label), str(x.value)].filter(Boolean).join(": ") : "";
            });
            out.push({
              id: k.id,
              title: str(k.text),
              text: [str(k.notes)].concat(sub, info, [str(b.name) + " › " + str(c.name)])
                .filter(Boolean).join(" · "),
              when: dueMs(k.due),
              target: { board: b.id, col: c.id, card: k.id }
            });
          });
        });
      });
      return out;
    },
    open: function (t, win) {
      if (t && typeof t.board === "string" && typeof t.col === "string" &&
          typeof t.card === "string" && win && typeof win.__orosOpenKanbanCard === "function") {
        win.__orosOpenKanbanCard(t.board, t.col, t.card);
      } else if (win && typeof win.__orosOpenAt === "function") {
        win.__orosOpenAt("kanban", null);
      }
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
