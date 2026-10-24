// ============================================================
// orOS Household — Today provider "Today at home" (BR-HH)
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only: reads the device-local list of what the others changed
// today (oros-household-recent, kept by household/engine.js through
// household/recent.js), never writes. One row per household:
// "<household> · Shopping: Nikos +3 ~1, −1".
// Opens the household in the Household app.
// ============================================================
(function (root) {
  "use strict";
  var R = root.OrosHouseRecent;
  if (!R) return;
  var PROVIDER = {
    id: "household",
    keys: [R.RECENT_KEY],
    collect: function (ctx) {
      var st = R.load(ctx.readJSON(R.RECENT_KEY));
      var p = String(ctx.today).split("-");
      var dayStart = new Date(+p[0], +p[1] - 1, +p[2]).getTime();
      return R.today(st, dayStart).map(function (x) {
        return { id: "hh:" + x.box, due: null, time: null, kind: "info",
                 title: (x.hh ? x.hh + " · " : "") + x.text, text: "", target: { box: x.box } };
      });
    },
    open: function (target, win) {
      if (target && typeof target.box === "string" && typeof win.__orosOpenAt === "function") win.__orosOpenAt("household", { box: target.box });
    }
  };
  (root.orosTodayProviders = root.orosTodayProviders || []).push(PROVIDER);
})(typeof window !== "undefined" ? window : globalThis);
