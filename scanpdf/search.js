// ============================================================
// orOS Scanner & PDF — universal search provider
// Declared in apps.json as "search": "search.js"; the shell loads it
// on the first menu search, never at boot. READ-ONLY: it reads the
// device-local list of PDFs the app saved into Files
// (oros-scanpdf-index: name, the text read from their pages, when)
// and never writes. A PDF since deleted or moved in Files is left
// out (orOS disk stat). Opening goes through the generic deep link
// __orosOpenAt: target { paths: [path] } adds that PDF's pages.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-scanpdf-index";
  var MAX = 100;

  function clean(list) {
    var seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(function (e) {
      if (!e || typeof e.p !== "string" || e.p.indexOf("/internal/") !== 0 || seen[e.p]) return;
      seen[e.p] = true;
      out.push({ p: e.p, n: typeof e.n === "string" ? e.n : "", t: typeof e.t === "string" ? e.t : "",
                 d: Number(e.d) || 0 });
    });
    return out.slice(0, MAX);
  }

  var PROVIDER = {
    id: "scanpdf",
    keys: [KEY],
    // ctx = { q, words, fold, lang, limit, readJSON(key) }
    search: function (ctx) {
      var list = clean(ctx.readJSON(KEY));
      var fs = null;
      try { fs = root && root.orosFS; } catch (e) { fs = null; }
      function hit(e) {
        var name = e.n.trim() || e.p.slice(e.p.lastIndexOf("/") + 1).replace(/\.pdf$/i, "");
        return { id: e.p, title: name, text: e.t, when: e.d || undefined, target: { paths: [e.p] } };
      }
      if (!fs || typeof fs.stat !== "function") return list.map(hit);
      return Promise.all(list.map(function (e) {
        return Promise.resolve(fs.stat(e.p)).then(function (st) { return st ? hit(e) : null; }, function () { return null; });
      })).then(function (hits) { return hits.filter(Boolean); });
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
