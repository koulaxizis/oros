// ============================================================
// orOS Label Maker — universal search provider (v1.0.0)
// Declared in apps.json as "search": "search.js"; the shell loads it
// on the first menu search, never at boot. READ-ONLY: it reads
// oros-labels-data and never writes. One hit per saved label (a label
// a tombstone covers is left out): its text as title, the last edit
// as `when`. Opens through the generic deep link
// __orosOpenAt("labels", { label: id }): the saved label on the tape.
// Self-contained (LabelsCore is not loaded in the shell).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-labels-data";
  var ID_RE = /^l[a-z0-9]{6,20}$/;

  function one(s) { return String(s).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim(); }

  var PROVIDER = {
    id: "labels",
    keys: [KEY],
    // ctx = { q, words, fold, lang, limit, readJSON(key) }
    search: function (ctx) {
      var d = ctx.readJSON(KEY);
      if (!d || !Array.isArray(d.labels)) return [];
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      var seen = {};
      return d.labels.filter(function (l) {
        if (!l || typeof l.id !== "string" || !ID_RE.test(l.id) || typeof l.text !== "string" || !one(l.text)) return false;
        if (typeof l.m !== "number" || tombs[l.id] >= l.m || seen[l.id]) return false;
        seen[l.id] = 1;
        return true;
      }).map(function (l) {
        var text = one(l.text);
        return { id: l.id, title: text.slice(0, 80), text: text.length > 80 ? text.slice(0, 200) : "", when: l.m, target: { label: l.id } };
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
