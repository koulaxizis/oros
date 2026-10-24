// ============================================================
// orOS Meal Planner — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today",
// after meals/core.js. Read-only: reads oros-meals-data, never
// writes. Today's plan as top lines, one per slot in the app's order
// ("Dinner: Fasolada, Salad"), from OrosMealsCore.planByDay, the
// same rows as the Calendar's Meals feed. A planned meal is not a
// task, so it never makes the daily notice ring on its own. Opens
// Meal Planner on that day (__orosOpenAt: { day }).
// Plans shared with a household (BR-HH wave 7) come from the shell's
// mirror oros-meals-hh (meals/house.js): the same lines, after the
// household's name ("Home · Dinner: Fasolada").
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-meals-data", HH_KEY = "oros-meals-hh";
  // Same keys and English as meals.js. A pack language: English + the
  // "meals" pack, when the shell has it loaded.
  var SLOT = {
    en: { "slot.b": "Breakfast", "slot.l": "Lunch", "slot.d": "Dinner", "slot.s": "Snack", "slot.x": "Extra" },
    el: { "slot.b": "Πρωινό", "slot.l": "Μεσημεριανό", "slot.d": "Βραδινό", "slot.s": "Σνακ", "slot.x": "Άλλο" }
  };

  var PROVIDER = {
    id: "meals",
    keys: [KEY, HH_KEY],
    collect: function (ctx) {
      var C = root.OrosMealsCore, raw = ctx.readJSON(KEY), hh = ctx.readJSON(HH_KEY);
      if (!C || typeof C.planByDay !== "function" || (!raw && !hh)) return [];
      if (!SLOT[ctx.lang] && root.orosI18n && ctx.lang) root.orosI18n.table(SLOT, "meals", ctx.lang);
      var names = SLOT[ctx.lang] || SLOT.en;
      var lines = function (d, pre, idp) {
        var rows = C.planByDay(d, ctx.lang)[ctx.today] || [];
        return rows.slice().sort(function (a, b) { return a.order - b.order; }).map(function (r) {
          return {
            id: idp + ctx.today + ":" + r.slot,
            due: ctx.today,
            title: pre + (r.name || names["slot." + r.slot] || r.slot) + ": " + r.what.join(", "),
            kind: "info",
            target: { day: ctx.today }
          };
        });
      };
      var out = raw ? lines(raw, "", "") : [];
      if (hh && typeof hh === "object" && Array.isArray(hh.plans)) {
        hh.plans.forEach(function (p) {
          if (!p || typeof p !== "object" || !p.data || typeof p.data !== "object") return;
          var name = typeof p.hh === "string" && p.hh ? p.hh : (typeof p.t === "string" ? p.t : "");
          out = out.concat(lines(p.data, name ? name + " · " : "", "hh:" + String(p.id || "").slice(0, 40) + ":"));
        });
      }
      return out;
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
