// ============================================================
// orOS Household — universal search provider (v1.0.0)
// Declared in apps.json as "search": "search.js"; the shell loads it
// on the first menu search, never at boot. READ-ONLY: it asks the
// shell's household engine (window.orosHousehold, household/engine.js)
// for its list and never writes. One hit per household: its name as
// title, the members' names and the titles of what is shared in it as
// text. Never codes, links, keys or invites. Without the engine (a
// stale bundle) the names come from the membership slice
// oros-household-data alone. Opens through the generic deep link
// __orosOpenAt("household", { box }): that household in the app.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-household-data";
  var BOX_RE = /^[A-Za-z0-9_-]{22}$/;

  function one(s, max) {
    return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  }
  function names(list, field, max) {
    return (Array.isArray(list) ? list : []).map(function (x) { return x && one(x[field], max); }).filter(Boolean);
  }
  function hit(box, name, people, docs) {
    var text = people.concat(docs).join(" · ");
    return { id: box, title: name, text: text.slice(0, 500), target: { box: box } };
  }
  function fromEngine(eng) {
    return eng.list().filter(function (h) { return h && typeof h.box === "string" && BOX_RE.test(h.box) && one(h.name, 80); })
      .map(function (h) { return hit(h.box, one(h.name, 80), names(h.members, "name", 40), names(h.docs, "title", 80)); });
  }
  function fromSlice(ctx) {
    var d = ctx.readJSON(KEY), hh = d && d.hh && typeof d.hh === "object" ? d.hh : null;
    if (!hh) return [];
    return Object.keys(hh).filter(function (b) { return BOX_RE.test(b) && hh[b] && one(hh[b].name, 80); })
      .map(function (b) { return hit(b, one(hh[b].name, 80), [], []); });
  }

  var PROVIDER = {
    id: "household",
    keys: [KEY],
    // ctx = { q, words, fold, lang, limit, readJSON(key) }
    search: function (ctx) {
      var eng = root && root.orosHousehold;
      if (!eng || typeof eng.list !== "function") return fromSlice(ctx);
      var ready = typeof eng.ready === "function" ? eng.ready() : null;
      return Promise.resolve(ready).then(function () { return fromEngine(eng); }, function () { return fromSlice(ctx); });
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
