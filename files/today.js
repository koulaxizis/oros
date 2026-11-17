// ============================================================
// orOS Files — Today provider for Documents (v1.0.0, DOCS-1 W3)
// Loaded by the shell (today/host.js) through apps.json "today",
// after files/docs-due.js. Read-only: reads oros-files-docs, never
// writes. Rows: documents that expire within the Today horizon (or
// expired up to a week ago: a task, so it can be late) and
// documents whose keep-until date passed this week (shown today as
// a note; nothing is ever deleted). A private document shows its
// type only (docs-due.js nameOf). Opens the document in Files.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-files-docs";

  var PROVIDER = {
    id: "files",
    keys: [KEY],
    collect: function (ctx) {
      var D = root.OrosDocsDue, raw = ctx.readJSON(KEY);
      if (!D || !raw || !Array.isArray(raw.docs) || !raw.docs.length) return [];
      var out = [];
      D.alerts(raw, ctx.today).forEach(function (a) {
        if (a.kind === "ex") {
          if (a.left > ctx.horizon) return;
          out.push({ id: a.key, due: a.date, title: D.alertLine(a, raw, ctx.lang), kind: "task", target: { doc: a.id } });
        } else {
          out.push({ id: a.key, due: ctx.today, title: D.alertLine(a, raw, ctx.lang), kind: "info", target: { doc: a.id } });
        }
      });
      return out;
    },
    open: function (target, win) {
      if (typeof win.__orosOpenAt !== "function") return;
      var id = target && typeof target.doc === "string" ? target.doc : "";
      win.__orosOpenAt("files", id ? { doc: id } : { docs: "soon" });
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
