// ============================================================
// orOS Plant Care — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only: reads oros-plants-data, the device-local prefs
// (hemisphere) and the household gardens' mirror oros-plants-hh
// (plants/house.js: only the plants that remind this person), never
// writes. The schedule math is plants/core.js
// (tasks), the same the app, the Calendar feed and the shell
// reminder use. Rows: every watering / feeding / misting / repotting
// that is late, due today or due in the next days; outdoor watering
// today gets the rain hint from the Weather app's cache (no network).
// Opens through the shell bridge __orosOpenPlants(plantId). "Done"
// opens Plant Care, which logs the task with its own button's code
// (__orosOpenAt: { done: { plant, kind } }, Undo there).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-plants-data", HH_KEY = "oros-plants-hh";
  var W = {
    en: { water: "water", fert: "feed", mist: "mist", repot: "repot", rain: "rain today, may not need water" },
    el: { water: "πότισμα", fert: "λίπανση", mist: "ψέκασμα", repot: "μεταφύτευση", rain: "βροχή σήμερα, ίσως δεν θέλει πότισμα" }
  };
  // Pack "plants": the shell runs this file, so a pack language reads
  // the "plants" pack when the shell has it, else English.
  function words(lang) {
    var I = root && root.orosI18n;
    if (I && I.known(lang) && !W[lang]) I.table(W, "plants", lang);
    return W[lang] || W.en;
  }

  var PROVIDER = {
    id: "plants",
    keys: [KEY, "oros-plants-prefs", HH_KEY],
    collect: function (ctx) {
      var C = root.OrosPlantsCore, raw = ctx.readJSON(KEY), all = [];
      if (!C) return [];
      if (raw && Array.isArray(raw.plants) && raw.plants.length) all.push(C.merge(raw, raw, ctx.now));
      // gardens shared with a household: only the plants that remind
      // this person (plants/house.js mirror, BR-HH)
      var hh = ctx.readJSON(HH_KEY);
      (hh && Array.isArray(hh.gardens) ? hh.gardens : []).forEach(function (g) {
        if (!g || !g.data || typeof g.data !== "object") return;
        var d = C.merge(g.data, g.data, ctx.now), mine = Array.isArray(g.mine) ? g.mine : [];
        d.plants = d.plants.filter(function (p) { return mine.indexOf(p.id) >= 0; });
        if (d.plants.length) all.push(d);
      });
      if (!all.length) return [];
      var w = words(ctx.lang);
      var prefs = C.readPrefs(ctx.readJSON("oros-plants-prefs"));
      var out = [];
      all.forEach(function (data) { out = out.concat(rowsOf(C, data, ctx, prefs, w)); });
      return out;
    },
    open: function (target, win) {
      var id = target && typeof target.plant === "string" ? target.plant : "today";
      if (typeof win.__orosOpenPlants === "function") win.__orosOpenPlants(id);
    }
  };
  function rowsOf(C, data, ctx, prefs, w) {
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
        target: { plant: tk.plant.id },
        done: { plant: tk.plant.id, kind: tk.kind }
      };
    });
  }

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
