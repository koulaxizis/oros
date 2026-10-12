// ============================================================
// orOS Stock — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only: reads oros-stock-data, never writes. The rules are
// stock/core.js (OrosStockCore, loaded by the shell for the low-stock
// engine too). Rows:
//   - one info line "To reorder: N" while products are at or below
//     their minimum (opens the Reorder tab);
//   - purchase orders still expected (sent / partly received) whose
//     expected day is past or inside the horizon, as tasks on that
//     day: a late delivery shows under Overdue (opens the order).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-stock-data";
  var S = {
    en: { low: "To reorder: {n}", po: "Delivery expected: {no}", from: "from {s}", items: "{n} products to come" },
    el: { low: "Για παραγγελία: {n}", po: "Αναμένεται παράδοση: {no}", from: "από {s}", items: "έρχονται {n} προϊόντα" }
  };
  function tr(lang, k, p) {
    var s = (S[lang === "el" ? "el" : "en"])[k];
    Object.keys(p || {}).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }

  var PROVIDER = {
    id: "stock",
    keys: [KEY],
    collect: function (ctx) {
      var C = root.OrosStockCore, raw = ctx.readJSON(KEY);
      if (!C || !raw || !Array.isArray(raw.items) || !raw.items.length) return [];
      var data = C.merge(raw, raw, ctx.now), out = [];
      var low = C.lowList(data);
      if (low.length) out.push({ id: "low", due: null, title: tr(ctx.lang, "low", { n: low.length }), kind: "info", target: { view: "reorder" } });
      var last = ctx.addDays(ctx.today, ctx.horizon), sups = {};
      (data.sups || []).forEach(function (s) { sups[s.id] = s.name; });
      C.poViews(data).forEach(function (v) {
        if (!v.open || !v.po.exp || v.po.exp > last) return;
        var n = v.lines.filter(function (l) { return l.left > 0; }).length;
        out.push({
          id: "po-" + v.po.id,
          due: v.po.exp,
          title: tr(ctx.lang, "po", { no: v.po.no || "—" }),
          text: [v.po.sup && sups[v.po.sup] ? tr(ctx.lang, "from", { s: sups[v.po.sup] }) : "", tr(ctx.lang, "items", { n: n })].filter(Boolean).join(" · "),
          kind: "task",
          target: { po: v.po.id }
        });
      });
      return out;
    }
    // no open(): Today falls back to __orosOpenAt("stock", target)
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
