// ============================================================
// orOS Base — universal search provider
// Declared in apps.json as "search": "search.js"; the shell loads it
// on the first menu search, never at boot. READ-ONLY: it reads
// oros-base-data and never writes. One hit per record (title = its
// primary field, text = the other text, choices and numbers, then
// "base › table"); one per base. Deleted rows are not in the stored
// arrays (the slice is normalized), tombstones are checked anyway.
// Opens through the generic deep link __orosOpenAt("base", {…}).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-base-data";
  var MAX = 5000;          // records looked at per search

  function arr(a) { return Array.isArray(a) ? a : []; }
  function str(v) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""; }

  var PROVIDER = {
    id: "base",
    keys: [KEY],
    // ctx = { q, words, fold, lang, limit, readJSON(key) }
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || typeof d !== "object") return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      function live(x) { return x && typeof x.id === "string" && !(tombs[x.id] >= (x.m || 0)); }
      var bases = {}, tables = {}, fields = {}, byTable = {};
      arr(d.bases).forEach(function (b) {
        if (!live(b)) return;
        bases[b.id] = b;
        out.push({ id: "b:" + b.id, title: str(b.name), text: "", when: b.m || 0, target: { base: b.id } });
      });
      arr(d.tables).forEach(function (t) { if (live(t) && bases[t.base]) { tables[t.id] = t; byTable[t.id] = []; } });
      arr(d.fields).forEach(function (f) {
        if (!live(f) || !tables[f.tb]) return;
        fields[f.id] = f;
        byTable[f.tb].push(f);
      });
      Object.keys(byTable).forEach(function (k) { byTable[k].sort(function (a, b) { return (a.ord || 0) - (b.ord || 0) || (a.id < b.id ? -1 : 1); }); });
      function choice(f, id) {
        var ch = f.opt && Array.isArray(f.opt.ch) ? f.opt.ch : [];
        for (var i = 0; i < ch.length; i++) if (ch[i] && ch[i].id === id) return str(ch[i].n);
        return "";
      }
      function txt(f, v) {
        if (v === undefined || v === null) return "";
        if (f.type === "select") return choice(f, v);
        if (f.type === "multi") return arr(v).map(function (x) { return choice(f, x); }).filter(Boolean).join(", ");
        if (f.type === "check") return "";
        if (typeof v === "string") return str(v).slice(0, 300);
        if (typeof v === "number") return String(v);
        return "";
      }
      var n = 0;
      arr(d.recs).forEach(function (r) {
        if (n >= MAX || !live(r) || !tables[r.t] || !r.v || typeof r.v !== "object") return;
        n++;
        var t = tables[r.t], b = bases[t.base], list = byTable[r.t] || [];
        var pf = t.pf && fields[t.pf] && fields[t.pf].tb === r.t ? fields[t.pf] : list[0];
        var title = pf ? txt(pf, r.v[pf.id]) : "";
        var rest = list.filter(function (f) { return f !== pf; }).map(function (f) { return txt(f, r.v[f.id]); }).filter(Boolean);
        rest.push(str(b.name) + " › " + str(t.name));
        out.push({
          id: r.id,
          title: title || str(t.name),
          text: rest.join(" · "),
          when: r.m || 0,
          target: { base: b.id, table: t.id, rec: r.id }
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
