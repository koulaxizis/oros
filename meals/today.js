// ============================================================
// orOS Meal Planner — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today",
// after meals/core.js. Read-only: reads oros-meals-data, never
// writes. Today's plan as top lines, one per slot in the app's order
// ("Dinner: Fasolada, Salad"), from OrosMealsCore.planByDay, the
// same rows as the Calendar's Meals feed. A planned meal is not a
// task, so it never makes the daily notice ring on its own. Opens
// Meal Planner on that day (__orosOpenAt: { day }).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-meals-data";
  var SLOT = {
    en: { b: "Breakfast", l: "Lunch", d: "Dinner", s: "Snack", x: "Extra" },
    el: { b: "Πρωινό", l: "Μεσημεριανό", d: "Βραδινό", s: "Σνακ", x: "Άλλο" }
  };

  var PROVIDER = {
    id: "meals",
    keys: [KEY],
    collect: function (ctx) {
      var C = root.OrosMealsCore, raw = ctx.readJSON(KEY);
      if (!C || typeof C.planByDay !== "function" || !raw) return [];
      var names = SLOT[ctx.lang] || SLOT.en;
      var rows = C.planByDay(raw, ctx.lang)[ctx.today] || [];
      return rows.slice().sort(function (a, b) { return a.order - b.order; }).map(function (r) {
        return {
          id: ctx.today + ":" + r.slot,
          due: ctx.today,
          title: (r.name || names[r.slot] || r.slot) + ": " + r.what.join(", "),
          kind: "info",
          target: { day: ctx.today }
        };
      });
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
