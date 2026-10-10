// ============================================================
// orOS Maps — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-maps-data, never writes.
// One hit per saved place (its name, which the user may have
// renamed; the address line as text). Deleted places leave
// places[] and get a deleted{} tombstone; a row the tombstone
// covers is skipped too. Recent places (oros-maps-recent) are
// plain search results the user never named or kept: not searched.
// Opens through the existing Maps bridge (__orosOpenMaps):
// target { lat, lon, name }, the map centres on the place.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-maps-data";

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function num(v) { return typeof v === "number" && isFinite(v); }

  var PROVIDER = {
    id: "maps",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.places)) return out;
      var del = d.deleted && typeof d.deleted === "object" ? d.deleted : {};
      d.places.forEach(function (p) {
        if (!p || !num(p.lat) || !num(p.lon)) return;
        var id = "p" + p.lat.toFixed(6) + "," + p.lon.toFixed(6);   // = maps.js placeId()
        var ts = del[id];
        if (typeof ts === "number" && !(num(p.mtime) && p.mtime > ts)) return;
        var name = str(p.name);
        if (name === "?") name = "";
        out.push({
          id: id,
          title: name || str(p.sub) || (ctx.lang === "el" ? "Τοποθεσία χωρίς όνομα" : "Unnamed place"),
          text: name ? str(p.sub) : "",
          target: { lat: p.lat, lon: p.lon, name: name || str(p.sub) }
        });
      });
      return out;
    },
    open: function (target, win) {
      if (target && num(target.lat) && num(target.lon) && win && typeof win.__orosOpenMaps === "function") {
        win.__orosOpenMaps(target.lat, target.lon, typeof target.name === "string" ? target.name : "");
      } else if (win && typeof win.__orosOpenAt === "function") {
        win.__orosOpenAt("maps", null);
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
