// ============================================================
// orOS Typing Tutor: universal search provider
// Declared in apps.json as "search": "search.js"; the shell loads it
// on the first menu search, never at boot. READ-ONLY: reads My texts
// (oros-typing-texts, slice "typingtexts") and never writes. Deleted
// texts (tombstone ≥ the text's m) are left out. Opening goes through
// the deep link __orosOpenAt("typing", { text: "m:<id>" }), which
// shows the text on the Texts screen.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-typing-texts";
  var ID_RE = /^t[a-z0-9]{4,20}$/;

  function flat(s) { return String(s || "").replace(/\s+/g, " ").trim(); }

  var PROVIDER = {
    id: "typing",
    keys: [KEY],
    // ctx = { q, words, fold, lang, limit, readJSON(key) }
    search: function (ctx) {
      var d = ctx.readJSON(KEY) || {};
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      var hits = [];
      (Array.isArray(d.items) ? d.items : []).forEach(function (x) {
        if (!x || typeof x.id !== "string" || !ID_RE.test(x.id) || typeof x.t !== "string") return;
        if (tombs[x.id] >= x.m) return;
        var body = flat(x.t);
        var title = flat(x.n) || body.split(" ").slice(0, 6).join(" ");
        if (!title) return;
        hits.push({ id: "text:" + x.id, title: title.slice(0, 80), text: body.slice(0, 2000), target: { text: "m:" + x.id } });
      });
      return hits;
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
