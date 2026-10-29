// ============================================================
// orOS Photo Lab — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-photolab-data (the project index;
// the pictures themselves are files on the orOS disk), never writes.
// One hit per project: its name and size. The date is the project's
// last change (m). Skipped: projects covered by their tombstone
// (tombs[id] >= m, as core.js mergeIndex). Opens through the generic
// deep link: target { id }.
// It also makes Photo Lab one of the apps the Assistant may be
// allowed to read and change (AS-EDIT).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-photolab-data";

  var PROVIDER = {
    id: "photolab",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.projects)) return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      d.projects.forEach(function (p) {
        if (!p || typeof p.id !== "string") return;
        var m = Number(p.m) || 0;
        if (Object.prototype.hasOwnProperty.call(tombs, p.id) && tombs[p.id] >= m) return;
        var name = typeof p.name === "string" ? p.name.trim() : "";
        out.push({
          id: p.id,
          title: name || "Untitled",
          text: (Number(p.w) || 0) + " × " + (Number(p.h) || 0),
          when: m,
          target: { id: p.id }
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
