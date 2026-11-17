// ============================================================
// orOS Transfer — universal search provider (v1.0.0)
// Declared in apps.json as "search": "search.js"; the shell loads it
// on the first menu search, never at boot. READ-ONLY: it reads the
// history slice oros-transfer-data and never writes. One hit per
// finished transfer (an entry a tombstone covers is left out): the
// names of its top files and folders as title, those names and the
// other device as text, its time as `when`. The history holds names
// only, never contents, codes or links. Opens through the generic deep
// link __orosOpenAt("transfer", { hist: id }): the History tab with
// that row in view.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-transfer-data";
  var ID_RE = /^[a-z0-9]{6,40}$/;

  function one(s, max) {
    return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  }

  var PROVIDER = {
    id: "transfer",
    keys: [KEY],
    // ctx = { q, words, fold, lang, limit, readJSON(key) }
    search: function (ctx) {
      var d = ctx.readJSON(KEY);
      if (!d || !Array.isArray(d.items)) return [];
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      var seen = {};
      return d.items.filter(function (x) {
        if (!x || typeof x.id !== "string" || !ID_RE.test(x.id) || tombs[x.id] || seen[x.id]) return false;
        if (!(+x.at > 0) || !one(x.what, 120)) return false;
        seen[x.id] = 1;
        return true;
      }).map(function (x) {
        var what = one(x.what, 120), dev = one(x.dev, 60);
        return { id: x.id, title: what.slice(0, 80), text: dev ? what + " · " + dev : what, when: +x.at, target: { hist: x.id } };
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
