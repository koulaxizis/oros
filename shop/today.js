// ============================================================
// orOS Shop — Today provider
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only: reads oros-shop-data (the last read of each shop),
// never writes, never calls the shop. Rows:
//   - one info line per shop read today: today's orders and sales
//     (opens Today);
//   - one info line while products are out of stock (orOS Connect
//     stock area; opens Today);
//   - consignment resellers to settle: a task on the day the
//     earliest open delivery falls due, inside the horizon or past
//     it (Overdue) (opens Consignments on that reseller).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-shop-data";
  var S = {
    en: { sales: "Shop today: {o} orders · {g}", out: "Out of stock: {n} products", settle: "Settle consignment: {s}", open: "{n} on shelf · owed {m}" },
    el: { sales: "Κατάστημα σήμερα: {o} παραγγελίες · {g}", out: "Εξαντλημένα: {n} προϊόντα", settle: "Εκκαθάριση παρακαταθήκης: {s}", open: "{n} στο ράφι · οφείλουν {m}" }
  };
  function tr(lang, k, p) {
    if (lang && !S[lang] && root.orosI18n) root.orosI18n.table(S, "shop", lang);
    var s = (S[lang] || S.en)[k] || S.en[k];
    Object.keys(p || {}).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }
  function isObj(o) { return !!o && typeof o === "object" && !Array.isArray(o); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dayOf(ms) { var d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function amount(c, cur) { var v = ((Number(c) || 0) / 100).toFixed(2); return cur ? v + " " + cur : v; }

  var PROVIDER = {
    id: "shop",
    keys: [KEY],
    collect: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!isObj(d) || !isObj(d.shops)) return out;
      var ids = Object.keys(d.shops).sort();
      var last = ctx.addDays(ctx.today, ctx.horizon);
      ids.forEach(function (a) {
        var e = d.shops[a];
        if (!isObj(e) || !(Number(e.m) > 0)) return;
        var x = isObj(e.x) ? e.x : {}, cur = typeof e.cur === "string" ? e.cur : "";
        if (dayOf(e.m) === ctx.today) {
          var s = isObj(x.sales) && isObj(x.sales.today) ? x.sales.today : (isObj(e.base) && isObj(e.base.today) ? e.base.today : null);
          if (s && Number(s.o) > 0) {
            out.push({ id: "sales-" + a, due: null, kind: "info", target: { shop: a, view: "today" },
                       title: tr(ctx.lang, "sales", { o: s.o, g: amount(s.g, cur) }) });
          }
        }
        if (isObj(x.stock) && Number(x.stock.oc) > 0) {
          out.push({ id: "out-" + a, due: null, kind: "info", title: tr(ctx.lang, "out", { n: x.stock.oc }), target: { shop: a, view: "today" } });
        }
        (isObj(x.stores) && Array.isArray(x.stores.rows) ? x.stores.rows : []).forEach(function (r) {
          if (!isObj(r) || !r.n || !r.due || !(Number(r.open) > 0) || r.due > last) return;
          out.push({ id: "settle-" + a + "-" + (r.id || r.n), due: r.due, kind: "task",
                     title: tr(ctx.lang, "settle", { s: r.n }), text: tr(ctx.lang, "open", { n: r.open, m: amount(r.owed, cur) }),
                     target: { shop: a, view: "stores", q: r.n } });
        });
      });
      return out;
    }
    // no open(): Today falls back to __orosOpenAt("shop", target)
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
