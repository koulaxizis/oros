// ============================================================
// orOS Mockups — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-mockups-data, never writes.
// One hit per mockup: its name as title, and as text the book's
// size, pages, binding and spine text.
// Opens through __orosOpenAt("mockups", { id }).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-mockups-data";
  // Runs in the shell, which loads only its own pack: a pack language shows English.
  var S = {
    en: { "search.name": "Book mockup", "bind.pb": "Paperback", "bind.hc": "Hardcover", "search.pages": "pages" },
    el: { "search.name": "Μακέτα βιβλίου", "bind.pb": "Χαρτόδετο", "bind.hc": "Σκληρόδετο", "search.pages": "σελίδες" }
  };
  var ID_RE = /^k[0-9a-z]{6,24}$/;

  function str(v) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""; }
  function n(v) { return typeof v === "number" && isFinite(v) ? Math.round(v * 10) / 10 : 0; }

  var PROVIDER = {
    id: "mockups",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [], lang = ctx.lang === "el" ? "el" : "en";
      if (!d || !Array.isArray(d.prj)) return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      d.prj.forEach(function (p) {
        if (!p || typeof p.id !== "string" || !ID_RE.test(p.id)) return;
        if (tombs[p.id] && tombs[p.id] >= p.m) return;
        var bk = p.bk && typeof p.bk === "object" ? p.bk : {}, art = p.art && typeof p.art === "object" ? p.art : {};
        var parts = [];
        if (n(bk.w) && n(bk.h)) parts.push(n(bk.w) + " × " + n(bk.h) + " mm");
        if (n(bk.pages)) parts.push(n(bk.pages) + " " + S[lang]["search.pages"]);
        if (bk.bind === "pb" || bk.bind === "hc") parts.push(S[lang]["bind." + bk.bind]);
        if (str(art.spT)) parts.push(str(art.spT));
        out.push({ id: p.id, title: str(p.nm) || S[lang]["search.name"], text: parts.join(" · "), target: { id: p.id } });
      });
      return out;
    },
    open: function (target, win) {
      if (win && typeof win.__orosOpenAt === "function") win.__orosOpenAt("mockups", target);
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
