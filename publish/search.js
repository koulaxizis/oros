// ============================================================
// orOS Publishing — universal search provider
// Declared in apps.json as "search": "search.js"; the shell loads it
// on the first menu search, never at boot. READ-ONLY: it reads
// oros-publish-data and never writes. Deleted titles are left out.
// Finds a title by its words, its people or any of its ISBNs (with
// or without hyphens, ISBN-10 too). Opening goes through the generic
// deep link __orosOpenAt({ title }).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-publish-data";

  function digits(s) { return String(s || "").replace(/[\s-]/g, ""); }
  function ten(isbn) {
    if (!/^978\d{10}$/.test(isbn)) return "";
    var d9 = isbn.slice(3, 12), sum = 0;
    for (var i = 0; i < 9; i++) sum += (+d9[i]) * (10 - i);
    var c = (11 - sum % 11) % 11;
    return d9 + (c === 10 ? "X" : String(c));
  }

  var PROVIDER = {
    id: "publish",
    keys: [KEY],
    // ctx = { q, words, fold, lang, limit, readJSON(key) }
    search: function (ctx) {
      var d = ctx.readJSON(KEY);
      if (!d || !Array.isArray(d.titles)) return [];
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      var blocks = (Array.isArray(d.blocks) ? d.blocks : []).map(function (b) { return b && typeof b.p === "string" ? b.p : ""; }).filter(Boolean);
      // The number as the house writes it (its block's groups), so a
      // search typed with hyphens finds it too.
      function hyph(isbn) {
        for (var i = 0; i < blocks.length; i++) {
          var pd = digits(blocks[i]);
          if (pd && isbn.indexOf(pd) === 0) return blocks[i] + "-" + isbn.slice(pd.length, 12) + "-" + isbn[12];
        }
        return "";
      }
      return d.titles.filter(function (it) {
        return it && typeof it.id === "string" && typeof it.t === "string" && it.t.trim() && !(tombs[it.id] >= it.m);
      }).map(function (it) {
        var ppl = (Array.isArray(it.ppl) ? it.ppl : []).map(function (p) { return p && typeof p.n === "string" ? p.n : ""; }).filter(Boolean);
        var isbns = [];
        (Array.isArray(it.fmts) ? it.fmts : []).forEach(function (f) {
          if (!f || typeof f.isbn !== "string" || !/^\d{13}$/.test(f.isbn)) return;
          isbns.push(f.isbn);
          var x = ten(f.isbn), h = hyph(f.isbn);
          if (x) isbns.push(x);
          if (h) isbns.push(h);
        });
        var hit = { id: it.id, title: it.t.slice(0, 120), when: it.m, target: { title: it.id } };
        var sub = [it.sub || "", ppl.join(", ")].filter(Boolean).join(" · ");
        hit.text = [sub, isbns.join(" "), it.ser || "", it.kw || "", String(it.blurb || "").slice(0, 600)].filter(Boolean).join(" · ");
        return hit;
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
