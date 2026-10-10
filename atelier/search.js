// ============================================================
// orOS Atelier — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-atelier-data, never writes.
// One hit per design (its name; the words of its text boxes —
// items with ax.k "text", in page order — and of any designkit
// stories as text). The date is the last edit (the newest entity
// stamp, like designkit maxM()). Skipped: designs covered by their
// doc tombstone (dt[id] >= newest stamp, as mergeData); items and
// stories covered by an entity tombstone (doc.tombs[id] >= m).
// Opens through the generic deep link: target { doc }.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-atelier-data";
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
    id: "atelier",
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
        function live(e) {
          return e && typeof e.id === "string" && !(own(tombs, e.id) && tombs[e.id] >= (Number(e.m) || 0));
        }
        var pos = {};
        arr(doc.pages).forEach(function (p) { if (p && typeof p.id === "string") pos[p.id] = Number(p.pos) || 0; });
        var boxes = arr(doc.items).filter(function (it) {
          return live(it) && it.ax && it.ax.k === "text" && typeof it.ax.tx === "string" && own(pos, it.pg);
        }).sort(function (a, b) {
          return pos[a.pg] - pos[b.pg] || (Number(a.y) || 0) - (Number(b.y) || 0) || (Number(a.x) || 0) - (Number(b.x) || 0);
        }).map(function (it) { return it.ax.tx; });
        var stories = arr(doc.stories).filter(live).map(storyText);
        var text = boxes.concat(stories).join(" ").replace(/\s+/g, " ").trim();
        var name = typeof doc.name === "string" ? doc.name.trim() : "";
        out.push({
          id: doc.id,
          title: name || (ctx.lang === "el" ? "Σχέδιο χωρίς τίτλο" : "Untitled design"),
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
