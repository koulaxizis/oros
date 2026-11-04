// ============================================================
// orOS Automations — universal search provider
// Declared in apps.json as "search": "search.js"; the shell loads it
// on the first menu search, never at boot. READ-ONLY: it reads
// oros-automations-data and never writes. Deleted rules are left out.
// Opening goes through the generic deep link __orosOpenAt { rule }.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-automations-data";

  var PROVIDER = {
    id: "automations",
    keys: [KEY],
    // ctx = { q, words, fold, lang, limit, readJSON(key) }
    search: function (ctx) {
      var d = ctx.readJSON(KEY);
      if (!d || !Array.isArray(d.rules)) return [];
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      return d.rules.filter(function (r) {
        return r && typeof r.id === "string" && typeof r.name === "string" && r.name.trim() &&
          !(tombs[r.id] >= r.m);
      }).map(function (r) {
        var name = r.name.replace(/\s+/g, " ").trim();
        var text = (Array.isArray(r["do"]) ? r["do"] : []).map(function (a) {
          return a && (a.text || a.title || a.subject || (Array.isArray(a.items) ? a.items.join(" ") : "")) || "";
        }).join(" ").replace(/\s+/g, " ").trim();
        return { id: r.id, title: name.slice(0, 80), text: (name + " " + text).slice(0, 500), when: r.m, target: { rule: r.id } };
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
