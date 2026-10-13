// ============================================================
// orOS Library — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-library-data, never writes.
// One hit per book (title; author, format, tags as text) and one per
// highlight or bookmark with a note (its quote and note; opens the
// book at that place). Records hidden by a tombstone are skipped the
// way the merge hides them.
// Opens through the generic deep link: target { book, loc? }.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-library-data";

  function str(v) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""; }
  function arr(a) { return Array.isArray(a) ? a : []; }
  function hidden(tombs, x) { return typeof tombs[x.id] === "number" && tombs[x.id] >= (Number(x.m) || 0); }

  var PROVIDER = {
    id: "library",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [], el = ctx.lang === "el";
      if (!d || !Array.isArray(d.books)) return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      var titles = {};
      d.books.forEach(function (b) {
        if (!b || typeof b.id !== "string" || hidden(tombs, b)) return;
        titles[b.id] = str(b.title) || (el ? "Χωρίς τίτλο" : "Untitled");
        out.push({
          id: b.id,
          title: titles[b.id],
          text: [str(b.by), String(b.kind || b.fmt || "epub").toUpperCase(), arr(b.tags).map(str).filter(Boolean).join(", "),
                 typeof b.year === "number" ? String(b.year) : ""].filter(Boolean).join(" · "),
          target: { book: b.id }
        });
      });
      arr(d.marks).forEach(function (k) {
        if (!k || typeof k.id !== "string" || hidden(tombs, k) || !titles[k.b]) return;
        if (k.k !== "hl" && !str(k.n)) return;
        out.push({
          id: k.id,
          title: titles[k.b] + " · " + (k.k === "hl" ? (el ? "Υπογράμμιση" : "Highlight") : (el ? "Σελιδοδείκτης" : "Bookmark")),
          text: [str(k.q).slice(0, 300), str(k.n).slice(0, 300)].filter(Boolean).join(" · "),
          target: { book: k.b, loc: k.loc }
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
