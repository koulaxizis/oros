// ============================================================
// orOS Studio — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-studio-data, never writes.
// One hit per project: its name, and the names of its tracks (in the
// project's order) as text.
// The date is the project's last change (m). Deleted projects are not
// in the data (core.js mergeStudio drops what a tombstone covers).
// Opens through the generic deep link: target { project } (receiver
// openTarget in studio.js).
// It also makes Studio one of the apps the Assistant may be allowed
// to read and change (AS-EDIT).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-studio-data";

  function str(v) { return typeof v === "string" ? v.trim() : ""; }

  var PROVIDER = {
    id: "studio",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.projects)) return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      var tracks = Array.isArray(d.tracks) ? d.tracks : [];
      d.projects.forEach(function (p) {
        if (!p || typeof p.id !== "string" || !/^p[a-z0-9]{6,20}$/.test(p.id)) return;
        var m = Number(p.m) || 0;
        if (Object.prototype.hasOwnProperty.call(tombs, p.id) && tombs[p.id] >= m) return;
        var names = tracks.filter(function (t) { return t && t.p === p.id && str(t.name); })
          .sort(function (a, b) { return (Number(a.ord) || 0) - (Number(b.ord) || 0); }).map(function (t) { return str(t.name); });
        out.push({
          id: p.id,
          title: str(p.name) || "Studio",
          text: names.join(" · ").slice(0, 300),
          when: m,
          target: { project: p.id }
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
