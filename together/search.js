// ============================================================
// orOS Together — universal search provider
// Declared in apps.json as "search": "search.js" with "searchOff":
// true (a relationship is private: search for it is opt-in). The
// shell loads it on the first menu search, never at boot. READ-ONLY:
// reads oros-together-data (and the names of linked people from
// oros-contacts-data) and never writes. Deleted rows are left out;
// a discreet relationship is found only by its initials.
// Opening goes through the generic deep link __orosOpenAt.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-together-data";

  function ok(r) { return r && typeof r.id === "string" && typeof r.m === "number"; }
  function initials(s) {
    return String(s || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return Array.from(w)[0].toUpperCase(); }).join("");
  }

  var PROVIDER = {
    id: "together",
    keys: [KEY, "oros-contacts-data"],
    // ctx = { q, words, fold, lang, limit, readJSON(key) }
    search: function (ctx) {
      var d = ctx.readJSON(KEY);
      if (!d || !Array.isArray(d.rels)) return [];
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      var ct = ctx.readJSON("oros-contacts-data"), names = {};
      if (ct && Array.isArray(ct.contacts)) ct.contacts.forEach(function (c) {
        if (!c || typeof c.id !== "string" || c.del) return;
        var n = [c.given, c.middle, c.family].filter(function (x) { return typeof x === "string" && x; }).join(" ") || c.nickname || "";
        if (n) names[c.id] = String(n).slice(0, 60);
      });
      var out = [];
      d.rels.forEach(function (r) {
        if (!ok(r) || tombs[r.id] >= r.m || typeof r.start !== "string") return;
        var people = (Array.isArray(r.people) ? r.people : []).map(function (p) {
          return p && ((p.c && names[p.c]) || (typeof p.n === "string" ? p.n : "")) || "";
        }).filter(Boolean);
        var title = typeof r.title === "string" && r.title ? r.title : people.join(" & ");
        if (r.discreet) { title = r.title ? initials(r.title) : people.map(initials).join(" & "); people = []; }
        if (!title) return;
        out.push({ id: r.id, title: title, text: (people.join(" ") + " " + r.start).trim(), when: r.m, target: { rel: r.id } });
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
