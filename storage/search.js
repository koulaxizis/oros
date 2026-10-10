// ============================================================
// orOS Storage — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-storage-data, never writes.
// One hit per live entity (space, room, furniture, position, item):
// its name as the title; where it is (the path "Home › Kitchen ›
// Cupboard") and an item's note as text. Seeds without a rename use
// their name in ctx.lang. Tombstoned rows (del: true), and anything
// whose parent chain is deleted or missing, are skipped.
// Opens through the generic deep link: target { id } (receiver in
// storage.js: an item opens its position, anything else itself).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-storage-data";
  var TYPES = { space: 1, room: 1, furniture: 1, position: 1, item: 1 };

  function str(v) { return typeof v === "string" ? v.trim() : ""; }

  var PROVIDER = {
    id: "storage",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.ents)) return out;
      var el = ctx.lang === "el", byId = {};
      d.ents.forEach(function (e) {
        if (e && typeof e.id === "string" && TYPES[e.type] && !byId[e.id]) byId[e.id] = e;
      });
      function nameOf(e) {
        var n = str(e.name);
        if (n) return n;
        var bi = e.bi && typeof e.bi === "object" ? e.bi : {};
        return str(el ? bi.el || bi.en : bi.en || bi.el);
      }
      // the names of the live ancestors, root first; null when the
      // chain is broken (a deleted or missing parent) or loops
      function chain(e) {
        var names = [], seen = {}, cur = e;
        while (cur.parentId) {
          if (seen[cur.id]) return null;
          seen[cur.id] = true;
          cur = byId[cur.parentId];
          if (!cur || cur.del) return null;
          names.unshift(nameOf(cur));
        }
        return names;
      }
      Object.keys(byId).forEach(function (id) {
        var e = byId[id];
        if (e.del) return;
        var path = chain(e);
        if (!path) return;
        out.push({
          id: e.id,
          title: nameOf(e) || (el ? "Χωρίς όνομα" : "Unnamed"),
          text: [path.filter(Boolean).join(" › "), e.type === "item" ? str(e.note) : ""]
            .filter(Boolean).join(" · "),
          when: typeof e.mtime === "number" ? e.mtime : 0,
          target: { id: e.id }
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
