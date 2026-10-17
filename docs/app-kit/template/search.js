// ============================================================
// orOS My App — universal search provider
// Declared in apps.json as "search": "search.js"; the shell loads it
// on the first menu search, never at boot. READ-ONLY: it reads
// oros-myapp-data and never writes. Deleted items are left out.
// Opening goes through the generic deep link __orosOpenAt.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-myapp-data";

  var PROVIDER = {
    id: "myapp",
    keys: [KEY],
    // ctx = { q, words, fold, lang, limit, readJSON(key) }
    search: function (ctx) {
      var d = ctx.readJSON(KEY);
      if (!d || !Array.isArray(d.items)) return [];
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      return d.items.filter(function (it) {
        return it && typeof it.id === "string" && typeof it.text === "string" && it.text.trim() &&
          !(tombs[it.id] >= it.mtime);
      }).map(function (it) {
        var text = it.text.replace(/\s+/g, " ").trim();
        return { id: it.id, title: text.slice(0, 80), text: text, when: it.mtime, target: { item: it.id } };
      });
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
