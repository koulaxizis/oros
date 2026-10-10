// ============================================================
// orOS Media Shelf — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-shelf-data, never writes.
// One hit per item (book, film, series, music, podcast, game): its
// title; the kind, creator ("by"), year, platform, tags, review and
// source as text. The progress log (sess[]) and goals hold no user
// text and are not searched. Deleted items leave items[] (their
// tombstone lives in tombs{}); one whose tombstone is at or after
// its m is skipped too, the way the merge hides it.
// Opens through the generic deep link: target { item } (the item's
// details dialog).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-shelf-data";
  var TYPE = {
    en: { book: "Book", film: "Film", series: "Series", album: "Music", podcast: "Podcast", game: "Game" },
    el: { book: "Βιβλίο", film: "Ταινία", series: "Σειρά", album: "Μουσική", podcast: "Podcast", game: "Παιχνίδι" }
  };

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function arr(a) { return Array.isArray(a) ? a : []; }

  var PROVIDER = {
    id: "shelf",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [], el = ctx.lang === "el";
      if (!d || !Array.isArray(d.items)) return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      d.items.forEach(function (it) {
        if (!it || typeof it.id !== "string") return;
        if (typeof tombs[it.id] === "number" && tombs[it.id] >= (Number(it.m) || 0)) return;
        out.push({
          id: it.id,
          title: str(it.title) || (el ? "Χωρίς τίτλο" : "Untitled"),
          text: [(el ? TYPE.el : TYPE.en)[it.type] || "", str(it.by),
                 typeof it.year === "number" && it.year > 0 ? String(it.year) : "",
                 str(it.plat), arr(it.tags).map(str).filter(Boolean).join(", "),
                 str(it.rev), str(it.src)].filter(Boolean).join(" · "),
          target: { item: it.id }
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
