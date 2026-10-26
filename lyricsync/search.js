// ============================================================
// orOS Lyric Sync — universal search provider
// Declared in apps.json as "search": "search.js"; the shell loads it
// on the first menu search, never at boot. READ-ONLY: it reads
// oros-lyricsync-data and never writes. Deleted songs are left out.
// Finds a song by its title, artist, album or words; opening goes
// through the generic deep link __orosOpenAt({ song: id }).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-lyricsync-data";

  var PROVIDER = {
    id: "lyricsync",
    keys: [KEY],
    // ctx = { q, words, fold, lang, limit, readJSON(key) }
    search: function (ctx) {
      var d = ctx.readJSON(KEY);
      if (!d || !Array.isArray(d.items)) return [];
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      return d.items.filter(function (p) {
        return p && typeof p.id === "string" && !(tombs[p.id] >= p.mtime);
      }).map(function (p) {
        var str = function (v) { return typeof v === "string" ? v : ""; };
        var words = (Array.isArray(p.ln) ? p.ln : []).map(function (l) { return l && str(l.t); }).filter(Boolean).join(" / ");
        var title = str(p.name) || (words.slice(0, 60) || "♪");
        var text = [str(p.ar), str(p.al), words].filter(Boolean).join(" · ").replace(/\s+/g, " ").slice(0, 4000);
        return { id: p.id, title: title.slice(0, 80), text: text, when: p.mtime, target: { song: p.id } };
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
