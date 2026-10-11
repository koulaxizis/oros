// ============================================================
// orOS Plant Care — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only: reads oros-plants-data and the device-local prefs
// (hemisphere), never writes. The schedule math is plants/core.js
// (tasks), the same the app, the Calendar feed and the shell
// reminder use. Rows: every watering / feeding / misting / repotting
// that is late, due today or due in the next days; outdoor watering
// today gets the rain hint from the Weather app's cache (no network).
// Opens through the shell bridge __orosOpenPlants(plantId).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-plants-data";
  var W = {
    en: { water: "water", fert: "feed", mist: "mist", repot: "repot", rain: "rain today, may not need water" },
    el: { water: "πότισμα", fert: "λίπανση", mist: "ψέκασμα", repot: "μεταφύτευση", rain: "βροχή σήμερα, ίσως δεν θέλει πότισμα" }
  };

  var PROVIDER = {
    id: "plants",
    keys: [KEY, "oros-plants-prefs"],
    collect: function (ctx) {
      var C = root.OrosPlantsCore, raw = ctx.readJSON(KEY);
      if (!C || !raw || !Array.isArray(raw.plants) || !raw.plants.length) return [];
      var w = W[ctx.lang] || W.en;
      var prefs = C.readPrefs(ctx.readJSON("oros-plants-prefs"));
      var data = C.merge(raw, raw, ctx.now);
      var wx = null;
      try {
        wx = C.weather(ctx.readJSON("oros-weatherapp-data"), ctx.readJSON("oros-weatherapp-cache"),
                       ctx.readJSON("oros-weather"), ctx.today, ctx.now);
      } catch (e) { wx = null; }
      return C.tasks(data, ctx.today, ctx.horizon, prefs.hemi).map(function (tk) {
        var text = tk.plant.room || "";
        if (tk.kind === "water" && tk.plant.out && tk.diff <= 0 && wx && wx.rain) text = text ? text + " · " + w.rain : w.rain;
        return {
          id: tk.key,
          due: tk.due,
          title: tk.plant.name + ": " + (w[tk.kind] || tk.kind),
          text: text,
          kind: "task",
          target: { plant: tk.plant.id }
        };
      });
    },
    open: function (target, win) {
      var id = target && typeof target.plant === "string" ? target.plant : "today";
      if (typeof win.__orosOpenPlants === "function") win.__orosOpenPlants(id);
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
