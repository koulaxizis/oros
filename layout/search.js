// ============================================================
// orOS Layout — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-layout-data, never writes.
// One hit per document (its name; the text of all its stories, in
// story order, as text). The date is the last edit (the newest
// entity stamp, like designkit maxM()). Skipped: documents covered
// by their doc tombstone (dt[id] >= newest stamp, as mergeData) and
// stories covered by an entity tombstone (doc.tombs[id] >= m).
// Opens through the generic deep link: target { doc }.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-layout-data";
  var COLLS = ["pages", "masters", "items", "stories", "pstyles", "cstyles", "swatches", "guides", "rec"];

  function arr(a) { return Array.isArray(a) ? a : []; }
  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function maxM(doc) {
    var m = Number(doc.m) || 0;
    COLLS.forEach(function (c) { arr(doc[c]).forEach(function (e) { if (e && e.m > m) m = e.m; }); });
    var tm = doc.tombs && typeof doc.tombs === "object" ? doc.tombs : {};
    Object.keys(tm).forEach(function (k) { if (tm[k] > m) m = tm[k]; });
    return m;
  }
  function storyText(s) {
    return arr(s.paras).map(function (p) {
      return p ? arr(p.runs).map(function (r) { return r && typeof r.t === "string" ? r.t : ""; }).join("") : "";
    }).join(" ");
  }

  var PROVIDER = {
    id: "layout",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.docs)) return out;
      var dt = d.dt && typeof d.dt === "object" ? d.dt : {};
      d.docs.forEach(function (doc) {
        if (!doc || typeof doc.id !== "string") return;
        var m = maxM(doc);
        if (own(dt, doc.id) && dt[doc.id] >= m) return;
        var tombs = doc.tombs && typeof doc.tombs === "object" ? doc.tombs : {};
        var text = arr(doc.stories).filter(function (s) {
          return s && typeof s.id === "string" && !(own(tombs, s.id) && tombs[s.id] >= (Number(s.m) || 0));
        }).map(storyText).join(" ").replace(/\s+/g, " ").trim();
        var name = typeof doc.name === "string" ? doc.name.trim() : "";
        out.push({
          id: doc.id,
          title: name || (ctx.lang === "el" ? "Χωρίς τίτλο" : "Untitled"),
          text: text,
          when: m,
          target: { doc: doc.id }
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
