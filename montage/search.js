// ============================================================
// orOS Montage — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-montage, never writes.
// Hits: one per project (its name; the words of its text clips as
// text). Deleted projects are not in the data (tombstones live in
// a separate map). Opens through the generic deep link: target
// { project } (receiver openTarget in montage.js).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-montage";
  // The shell runs this file, not the Montage page: a pack language reads
  // the "montage" pack when the shell has it, else English.
  var TEXT = {
    en: { "proj.untitled": "My video" },
    el: { "proj.untitled": "Το βίντεό μου" }
  };
  function text(lang) {
    var I = typeof window !== "undefined" && window.orosI18n;
    if (!TEXT[lang] && I && typeof lang === "string") I.table(TEXT, "montage", lang);
    return TEXT[lang] || TEXT.en;
  }

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : null; }

  var PROVIDER = {
    id: "montage",
    keys: [KEY],
    search: function (ctx) {
      var d = obj(ctx.readJSON(KEY)), out = [];
      var ps = d && obj(d.projects);
      if (!ps) return out;
      var untitled = text(ctx.lang)["proj.untitled"];
      Object.keys(ps).forEach(function (id) {
        var p = obj(ps[id]);
        if (!p || !/^[a-z0-9]{1,40}$/.test(id)) return;
        var words = [], items = obj(p.items) || {};
        Object.keys(items).forEach(function (k) {
          var it = obj(items[k]), tx = it && obj(it.text);
          if (it && it.k === "title" && tx && str(tx.t)) words.push(str(tx.t).replace(/\s+/g, " "));
        });
        out.push({
          id: "p:" + id,
          title: str(p.name) || untitled,
          text: words.join(" · ").slice(0, 300),
          when: typeof p.m === "number" ? p.m : 0,
          target: { project: id }
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
