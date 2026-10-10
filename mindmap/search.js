// ============================================================
// orOS Mind Map — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-mindmap-data, never writes.
// One hit per node (its first line as the title; the rest of its
// text, the note, the link and the map's name as text). A map's
// central node (`<mapId>-r`) carries the map's name. The date is
// the node's last edit. Skipped: nodes or maps covered by a
// tombstone (tombs[id] >= m, as mm-core alive()), nodes of maps
// that are gone, empty nodes.
// Opens through the generic deep link: target { map, node }.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-mindmap-data";

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function lines(s) {
    return String(s || "").split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
  }
  function arr(a) { return Array.isArray(a) ? a : []; }

  var PROVIDER = {
    id: "mindmap",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.nodes)) return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      function dead(x) {
        var ts = Object.prototype.hasOwnProperty.call(tombs, x.id) ? tombs[x.id] : null;
        return typeof ts === "number" && ts >= (Number(x.m) || 0);
      }
      var maps = {};
      arr(d.maps).forEach(function (mp) {
        if (mp && typeof mp.id === "string" && !dead(mp)) maps[mp.id] = true;
      });
      var names = {};
      d.nodes.forEach(function (n) {
        if (n && typeof n.id === "string" && maps[n.map] && n.id === n.map + "-r" && !dead(n)) {
          names[n.map] = lines(n.text)[0] || "";
        }
      });
      var untitled = ctx.lang === "el" ? "Χωρίς τίτλο" : "Untitled";
      d.nodes.forEach(function (n) {
        if (!n || typeof n.id !== "string" || typeof n.map !== "string" || !maps[n.map] || dead(n)) return;
        var ls = lines(n.text);
        var note = str(n.note), url = str(n.url);
        if (!ls.length && !note && !url) return;
        var isRoot = n.id === n.map + "-r";
        out.push({
          id: n.id,
          title: (ls[0] || untitled).slice(0, 200),
          text: [ls.slice(1).join(" "), note, url, isRoot ? "" : (names[n.map] || untitled)]
            .filter(Boolean).join(" · "),
          when: typeof n.m === "number" ? n.m : 0,
          target: { map: n.map, node: n.id }
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
