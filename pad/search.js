// ============================================================
// orOS Pad: universal search provider
// Declared in apps.json as "search": "search.js"; the shell loads it
// on the first menu search, never at boot. READ-ONLY: reads only Pad's
// recent-files list (localStorage oros-pad-session, `recent`: paths on
// the orOS disk and on This computer, never any text) and never writes.
// Open tabs and their unsaved text stay in Pad (IndexedDB) and are not
// searched. Opening goes through Pad's deep links:
//   disk  __orosOpenAt("pad", { openPath: "/internal/…" })
//   pc    __orosOpenAt("pad", { openPc: "/home/…" })  (orOS USB / Portable)
// A path is checked with the same rules as pad/core.js cleanLoc.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-pad-session";

  function okPath(r) {
    if (!r || typeof r !== "object" || typeof r.path !== "string") return "";
    var p = r.path;
    if (r.kind === "disk") return /^\/internal\/./.test(p) && p.indexOf("..") < 0 && p.length <= 1024 ? "disk" : "";
    if (r.kind === "pc") return /^\/[^\0]+$/.test(p) && p.split("/").indexOf("..") < 0 && p.length <= 4096 ? "pc" : "";
    return "";
  }

  var PROVIDER = {
    id: "pad",
    keys: [KEY],
    // ctx = { q, words, fold, lang, limit, readJSON(key) }
    search: function (ctx) {
      var s = ctx.readJSON(KEY) || {};
      var hits = [], seen = {};
      (Array.isArray(s.recent) ? s.recent : []).slice(0, 20).forEach(function (r) {
        var kind = okPath(r);
        if (!kind || seen[kind + r.path]) return;
        seen[kind + r.path] = 1;
        var name = r.path.slice(r.path.lastIndexOf("/") + 1);
        if (!name) return;
        hits.push({
          id: kind + ":" + r.path,
          title: name.slice(0, 120),
          text: r.path,
          target: kind === "disk" ? { openPath: r.path } : { openPc: r.path }
        });
      });
      return hits;
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
