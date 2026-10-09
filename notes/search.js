// ============================================================
// orOS Notes — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-notes-data, never writes.
// One hit per page (title + plain text). Deleted pages are not in
// pages[] (tombstones live in tombs{}), so nothing else to skip.
// Opens through the generic deep link: target { page, nb }.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-notes-data";

  function firstLine(s) {
    return String(s || "").split("\n").map(function (l) { return l.trim(); })
      .filter(Boolean)[0] || "";
  }

  var PROVIDER = {
    id: "notes",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.pages)) return out;
      var nbName = {};
      (Array.isArray(d.notebooks) ? d.notebooks : []).forEach(function (nb) {
        if (nb && typeof nb.id === "string") nbName[nb.id] = String(nb.name || "");
      });
      d.pages.forEach(function (p) {
        if (!p || typeof p.id !== "string") return;
        var text = typeof p.text === "string" ? p.text : "";
        var title = String(p.title || "").trim() || firstLine(text).slice(0, 60) ||
                    (ctx.lang === "el" ? "Χωρίς τίτλο" : "Untitled");
        out.push({
          id: p.id,
          title: title,
          text: text,
          when: typeof p.mtime === "number" ? p.mtime : 0,
          target: { page: p.id, nb: typeof p.nb === "string" ? p.nb : null }
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
