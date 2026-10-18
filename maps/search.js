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
// Since 1.47.00 also one hit per GPX track (oros-maps-tracks-data,
// slice mapstracks; tombstoned entries are already gone from it):
// target { track: id } through __orosOpenAt("maps", …).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-maps-data";
  var TKEY = "oros-maps-tracks-data";
  var TID = /^[a-z0-9]{6,40}$/;
  var STR = {
    en: { "srch.track": "Track", "srch.gpx": "GPX track", "srch.km": "{n} km", "srch.unnamed": "Unnamed place" },
    el: { "srch.track": "Διαδρομή", "srch.gpx": "Διαδρομή GPX", "srch.km": "{n} χλμ.", "srch.unnamed": "Τοποθεσία χωρίς όνομα" }
  };

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function num(v) { return typeof v === "number" && isFinite(v); }

  var PROVIDER = {
    id: "maps",
    keys: [KEY, TKEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [], K = STR[ctx.lang];
      // a pack language: the "maps" pack when loaded, else English
      if (!K && typeof ctx.lang === "string" && root && root.orosI18n) K = root.orosI18n.table(STR, "maps", ctx.lang);
      K = K || STR.en;
      var td = ctx.readJSON(TKEY);
      if (td && td.tracks && typeof td.tracks === "object") {
        Object.keys(td.tracks).forEach(function (k) {
          var e = td.tracks[k];
          if (!e || e.id !== k || !TID.test(k)) return;
          var km = num(e.dist) ? (e.dist / 1000).toFixed(1) : "";
          out.push({
            id: "t" + k,
            title: str(e.name) || K["srch.track"],
            text: K["srch.gpx"] + (km ? " · " + K["srch.km"].replace("{n}", km) : "") + (str(e.folder) ? " · " + str(e.folder) : ""),
            target: { track: k }
          });
        });
      }
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
          title: name || str(p.sub) || K["srch.unnamed"],
          text: name ? str(p.sub) : "",
          target: { lat: p.lat, lon: p.lon, name: name || str(p.sub) }
        });
      });
      return out;
    },
    open: function (target, win) {
      if (target && typeof target.track === "string" && TID.test(target.track) && win && typeof win.__orosOpenAt === "function") {
        win.__orosOpenAt("maps", { track: target.track });
        return;
      }
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
