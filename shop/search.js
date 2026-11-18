// ============================================================
// orOS Shop — universal search provider
// Declared in apps.json as "search": "search.js" with "searchOff":
// true (money figures: opt-in, like Budget). READ-ONLY: reads
// oros-shop-data and never writes. Finds the products, partners and
// consignment resellers of the last read, with their figures; a hit
// opens the matching tab filtered on that name (__orosOpenAt).
// Through the same provider the orOS Gate's search_data finds them.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-shop-data";
  var S = {
    en: { prod: "{q} sold this year", part: "To pay {m}", store: "{s} sold, {o} on shelf" },
    el: { prod: "{q} πουλήθηκαν φέτος", part: "Προς πληρωμή {m}", store: "{s} πουλήθηκαν, {o} στο ράφι" }
  };
  function tr(lang, k, p) {
    if (lang && !S[lang] && root.orosI18n) root.orosI18n.table(S, "shop", lang);
    var s = (S[lang] || S.en)[k] || S.en[k];
    Object.keys(p || {}).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }
  function amount(c, cur) { var v = ((Number(c) || 0) / 100).toFixed(2); return cur ? v + " " + cur : v; }
  function isObj(o) { return !!o && typeof o === "object" && !Array.isArray(o); }

  var PROVIDER = {
    id: "shop",
    keys: [KEY],
    // ctx = { q, words, fold, lang, limit, readJSON(key) }
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!isObj(d) || !isObj(d.shops)) return out;
      Object.keys(d.shops).sort().forEach(function (a) {
        var e = d.shops[a];
        if (!isObj(e) || typeof e.a !== "string") return;
        var x = isObj(e.x) ? e.x : {}, cur = typeof e.cur === "string" ? e.cur : "", when = Number(e.m) || 0;
        var prods = isObj(x.titles) && Array.isArray(x.titles.rows) ? x.titles.rows : (isObj(e.base) && Array.isArray(e.base.top) ? e.base.top : []);
        prods.forEach(function (p) {
          if (!isObj(p) || typeof p.n !== "string" || !p.n) return;
          var text = tr(ctx.lang, "prod", { q: Number(p.q) || 0 }) + (p.s !== undefined ? " · " + amount(p.s, cur) : "");
          out.push({ id: a + ":p:" + (p.id || p.n), title: p.n, text: text, when: when, target: { shop: a, view: "products", q: p.n } });
        });
        (isObj(x.splits) && Array.isArray(x.splits.rows) ? x.splits.rows : []).forEach(function (p) {
          if (!isObj(p) || typeof p.n !== "string" || !p.n) return;
          out.push({ id: a + ":s:" + p.n, title: p.n, text: tr(ctx.lang, "part", { m: amount(p.rem, cur) }), when: when, target: { shop: a, view: "partners", q: p.n } });
        });
        (isObj(x.stores) && Array.isArray(x.stores.rows) ? x.stores.rows : []).forEach(function (p) {
          if (!isObj(p) || typeof p.n !== "string" || !p.n) return;
          out.push({ id: a + ":c:" + (p.id || p.n), title: p.n, text: tr(ctx.lang, "store", { s: Number(p.sold) || 0, o: Number(p.open) || 0 }) + (p.city ? " · " + p.city : ""),
                     when: when, target: { shop: a, view: "stores", q: p.n } });
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
