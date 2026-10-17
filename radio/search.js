// ============================================================
// orOS Radio — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-radio-data, never writes.
// One hit per favourite station the user kept (name; country,
// tags and homepage as text). Removed favourites leave favorites[]
// and get a deleted{} tombstone; a row the tombstone covers is
// skipped too. Recents (device-local, played, not kept) and the
// API cache are not searched.
// Opens through the existing Radio bridge (__orosOpenRadio):
// target = the stationuuid, the app opens and plays it.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-radio-data";

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function tagsOf(v) {
    if (Array.isArray(v)) return v.map(str).filter(Boolean).join(", ");
    return str(v).split(",").map(str).filter(Boolean).join(", ");
  }

  // The one text of its own (pack "radio"). The shell runs this file,
  // not the Radio page: a pack language shows the "radio" pack line
  // when the shell has it, else English.
  var S = {
    en: { "station.unnamed": "Unnamed station" },
    el: { "station.unnamed": "Σταθμός χωρίς όνομα" }
  };
  function unnamed(lang) {
    var I = root && root.orosI18n;
    var tab = S[lang] || (I && lang ? I.table(S, "radio", lang) : S.en);
    return tab["station.unnamed"] || S.en["station.unnamed"];
  }

  var PROVIDER = {
    id: "radio",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [], seen = {};
      if (!d || !Array.isArray(d.favorites)) return out;
      var del = d.deleted && typeof d.deleted === "object" ? d.deleted : {};
      d.favorites.forEach(function (f) {
        if (!f || typeof f.stationuuid !== "string" || !f.stationuuid || seen[f.stationuuid]) return;
        var ts = del[f.stationuuid];
        if (typeof ts === "number" && !(typeof f.mtime === "number" && f.mtime > ts)) return;
        seen[f.stationuuid] = true;
        out.push({
          id: f.stationuuid,
          title: str(f.name) || unnamed(ctx.lang),
          text: [str(f.country), tagsOf(f.tags), str(f.homepage)].filter(Boolean).join(" · "),
          target: f.stationuuid
        });
      });
      return out;
    },
    open: function (target, win) {
      if (typeof target === "string" && target && win && typeof win.__orosOpenRadio === "function") {
        win.__orosOpenRadio(target);
      } else if (win && typeof win.__orosOpenAt === "function") {
        win.__orosOpenAt("radio", null);
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
