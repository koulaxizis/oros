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
  // Same keys and English as shelf.js (orosI18n packs: pack "shelf").
  // The shell runs this file: a pack language reads the "shelf" pack
  // when the shell has it, else English.
  var S = {
    en: { "type.book": "Book", "type.film": "Film", "type.series": "Series", "type.album": "Music",
          "type.podcast": "Podcast", "type.game": "Game", "item.untitled": "Untitled",
          "st.want": "Want", "tab.now": "Now", "st.done": "Done", "st.drop": "Dropped",
          "rate": "Rating", "fav": "Favourite" },
    el: { "type.book": "Βιβλίο", "type.film": "Ταινία", "type.series": "Σειρά", "type.album": "Μουσική",
          "type.podcast": "Podcast", "type.game": "Παιχνίδι", "item.untitled": "Χωρίς τίτλο",
          "st.want": "Θέλω", "tab.now": "Τώρα", "st.done": "Ολοκληρώθηκε", "st.drop": "Το παράτησα",
          "rate": "Βαθμολογία", "fav": "Αγαπημένο" }
  };
  function words(lang) {
    var I = root && root.orosI18n;
    if (I && I.known(lang) && !S[lang]) I.table(S, "shelf", lang);
    return S[lang] || S.en;
  }

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function arr(a) { return Array.isArray(a) ? a : []; }

  var PROVIDER = {
    id: "shelf",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [], w = words(ctx.lang);
      if (!d || !Array.isArray(d.items)) return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      d.items.forEach(function (it) {
        if (!it || typeof it.id !== "string") return;
        if (typeof tombs[it.id] === "number" && tombs[it.id] >= (Number(it.m) || 0)) return;
        out.push({
          id: it.id,
          title: str(it.title) || w["item.untitled"],
          text: [(typeof it.type === "string" && w["type." + it.type]) || "",
                 (it.st === "now" ? w["tab.now"] : typeof it.st === "string" && w["st." + it.st]) || "",
                 typeof it.rate === "number" && it.rate > 0 ? w.rate + " " + it.rate / 2 + "/5" : "",
                 it.fav === 1 ? w.fav : "", str(it.by),
                 typeof it.year === "number" && it.year > 0 ? String(it.year) : "",
                 str(it.plat), arr(it.tags).map(str).filter(Boolean).join(", "),
                 str(it.rev), str(it.src)].filter(Boolean).join(" · "),
          target: { item: it.id },
          labels: arr(it.tags).map(str).filter(Boolean)
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
