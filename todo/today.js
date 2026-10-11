// ============================================================
// orOS To-Do — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only: reads oros-todo-data, never writes. What is due is
// todo/core.js (openDue), the same the shell reminder and the
// Calendar feed use. Rows: open tasks that are late, due today or due
// in the next days, with their list. Each row offers "Done", which
// opens To-Do and ticks the task there with the app's own tick (Undo
// in To-Do); Today itself never writes. Opens the task through To-Do's
// own deep link (__orosOpenAt: { list, item }).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-todo-data";

  var PROVIDER = {
    id: "todo",
    keys: [KEY],
    collect: function (ctx) {
      var C = root.OrosTodoCore, raw = ctx.readJSON(KEY);
      if (!C || !raw) return [];
      var last = ctx.addDays(ctx.today, ctx.horizon);
      return C.openDue(raw).filter(function (x) { return x.item.due <= last; }).map(function (x) {
        return {
          id: x.list.id + "/" + x.item.id,
          due: x.item.due,
          title: typeof x.item.text === "string" ? x.item.text : "",
          text: typeof x.list.name === "string" ? x.list.name : "",
          kind: "task",
          target: { list: x.list.id, item: x.item.id },
          done: { list: x.list.id, item: x.item.id }
        };
      });
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
