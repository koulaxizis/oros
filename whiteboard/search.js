// ============================================================
// orOS Whiteboard — universal search provider
// Declared in apps.json as "search": "search.js"; the shell loads it
// on the first menu search, never at boot. READ-ONLY: it reads
// oros-whiteboard-data and never writes. Deleted boards and objects
// are left out. Opening goes through the generic deep link
// __orosOpenAt with { board, obj }.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-whiteboard-data";
  var TEXT_KINDS = { note: 1, text: 1, shape: 1, arrow: 1, frame: 1 };

  function dead(tombs, r) {
    return Object.prototype.hasOwnProperty.call(tombs, r.id) && tombs[r.id] >= r.m;
  }

  var PROVIDER = {
    id: "whiteboard",
    keys: [KEY],
    // ctx = { q, words, fold, lang, limit, readJSON(key) }
    search: function (ctx) {
      var d = ctx.readJSON(KEY);
      if (!d || !Array.isArray(d.boards) || !Array.isArray(d.objs)) return [];
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      var names = {}, out = [];
      d.boards.forEach(function (b) {
        if (!b || typeof b.id !== "string" || dead(tombs, b)) return;
        var name = typeof b.name === "string" ? b.name.trim() : "";
        names[b.id] = name;
        if (name) out.push({ id: "b:" + b.id, title: name.slice(0, 80), text: name, when: b.m, target: { board: b.id } });
      });
      d.objs.forEach(function (o) {
        if (!o || typeof o.id !== "string" || !TEXT_KINDS[o.k] || typeof o.tx !== "string" ||
            !Object.prototype.hasOwnProperty.call(names, o.b) || dead(tombs, o)) return;
        var text = o.tx.replace(/\s+/g, " ").trim();
        if (!text) return;
        var title = text.slice(0, 80) + (names[o.b] ? " · " + names[o.b].slice(0, 40) : "");
        out.push({ id: o.id, title: title, text: text, when: o.m, target: { board: o.b, obj: o.id } });
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
