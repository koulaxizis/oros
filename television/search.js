// ============================================================
// orOS Television — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-television-data, never writes.
// One hit per favourite channel the user kept (name; country,
// categories, languages and website as text). Removed favourites
// leave favorites[] and get a deleted{} tombstone; a row the
// tombstone covers is skipped too. Recents (device-local) and the
// channel catalog (Cache Storage) are not searched.
// Opens through the existing Television bridge
// (__orosOpenTelevision): target = the channel id, the app opens
// and plays it.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-television-data";

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function joinList(v) { return (Array.isArray(v) ? v : []).map(str).filter(Boolean).join(", "); }

  var PROVIDER = {
    id: "television",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [], seen = {};
      if (!d || !Array.isArray(d.favorites)) return out;
      var del = d.deleted && typeof d.deleted === "object" ? d.deleted : {};
      d.favorites.forEach(function (f) {
        if (!f || typeof f.id !== "string" || !f.id || seen[f.id]) return;
        var ts = del[f.id];
        if (typeof ts === "number" && !(typeof f.mtime === "number" && f.mtime > ts)) return;
        seen[f.id] = true;
        out.push({
          id: f.id,
          title: str(f.name) || (ctx.lang === "el" ? "Κανάλι χωρίς όνομα" : "Unnamed channel"),
          text: [str(f.country), joinList(f.categories), joinList(f.languages), str(f.website)]
            .filter(Boolean).join(" · "),
          target: f.id
        });
      });
      return out;
    },
    open: function (target, win) {
      if (typeof target === "string" && target && win && typeof win.__orosOpenTelevision === "function") {
        win.__orosOpenTelevision(target);
      } else if (win && typeof win.__orosOpenAt === "function") {
        win.__orosOpenAt("television", null);
      }
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
