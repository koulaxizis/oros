// ============================================================
// orOS Garage — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only: reads oros-garage-data and the device-local prefs,
// never writes. What needs attention is garage/core.js (alerts,
// alertLine), the same the app and the shell reminder use. Rows:
// renewals (KTEO, insurance, road tax…) that expired or expire within
// the next days, and service plans that are due (by date or by km) or
// fall due within the next days. Tyre age / wear is left to the app
// (it can last for months and would make every day "busy").
// Archived vehicles never show. Opens through __orosOpenGarage(id).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-garage-data";

  var PROVIDER = {
    id: "garage",
    keys: [KEY, "oros-garage-prefs"],
    collect: function (ctx) {
      var C = root.OrosGarageCore, raw = ctx.readJSON(KEY);
      if (!C || !raw || !Array.isArray(raw.vehicles) || !raw.vehicles.length) return [];
      var prefs = C.readPrefs(ctx.readJSON("oros-garage-prefs"));
      var data = C.merge(raw, raw, ctx.now), out = [];
      C.alerts(data, ctx.today, prefs).forEach(function (a) {
        if (a.type === "tyre") return;
        var due;
        if (a.date && typeof a.left === "number") {
          if (a.left > ctx.horizon) return;
          due = a.date;
        } else if (a.level === "due") {
          due = ctx.today;                       // due by km, no date
        } else return;
        out.push({
          id: a.key,
          due: due,
          title: C.alertLine(a, data, ctx.lang),
          kind: "task",
          target: { id: a.id }
        });
      });
      return out;
    },
    open: function (target, win) {
      var id = target && typeof target.id === "string" ? target.id : "upcoming";
      if (typeof win.__orosOpenGarage === "function") win.__orosOpenGarage(id);
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
