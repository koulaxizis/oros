// ============================================================
// orOS Water — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only: reads oros-water-data, never writes. One top line: how
// much was drunk today against today's goal (water/core.js: dayTotal,
// goalFor, fmtAmount), once the app has been used. Nothing in Water
// is "due", so it never makes a day busy. Opens Water.
// ============================================================
(function (root) {
  "use strict";
  var W = { en: "Water: {a} of {g}", el: "Νερό: {a} από {g}" };

  var PROVIDER = {
    id: "water",
    keys: ["oros-water-data"],
    collect: function (ctx) {
      var C = root.orosWaterCore;
      if (!C) return [];
      var data = C.parse(ctx.readRaw(C.STORAGE_KEY));
      if (!data || !C.hasAny(data)) return [];
      var goal = C.goalFor(data, ctx.today), total = C.dayTotal(data, ctx.today);
      return [{ id: "day", kind: "info", title: (W[ctx.lang] || W.en)
        .replace("{a}", C.fmtAmount(total, data.prefs, ctx.lang)).replace("{g}", C.fmtAmount(goal, data.prefs, ctx.lang)) }];
    },
    open: function (target, win) {
      if (typeof win.__orosOpenApp === "function") win.__orosOpenApp("water");
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
