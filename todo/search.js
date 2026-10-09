// ============================================================
// orOS To-Do — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-todo-data, never writes.
// One hit per list (its name) and one per task (text, with notes,
// extra info and the list name as text). The date shown is the due
// date. Deleted lists/tasks are not in the arrays (deleted{} map).
// Opens through the generic deep link: target { list, item? }.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-todo-data";
  var YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function dueMs(s) {
    var m = typeof s === "string" && YMD.exec(s);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 12).getTime() : 0;
  }

  var PROVIDER = {
    id: "todo",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.lists)) return out;
      d.lists.forEach(function (l) {
        if (!l || typeof l.id !== "string") return;
        var lname = str(l.name);
        if (lname) out.push({ id: "l:" + l.id, title: lname, text: "", target: { list: l.id } });
        (Array.isArray(l.items) ? l.items : []).forEach(function (it) {
          if (!it || typeof it.id !== "string") return;
          var info = (Array.isArray(it.info) ? it.info : []).map(function (x) {
            return x ? [str(x.label), str(x.value)].filter(Boolean).join(": ") : "";
          }).filter(Boolean);
          out.push({
            id: it.id,
            title: str(it.text),
            text: [str(it.notes)].concat(info).concat([lname]).filter(Boolean).join(" · "),
            when: dueMs(it.due),
            target: { list: l.id, item: it.id }
          });
        });
      });
      return out;
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
