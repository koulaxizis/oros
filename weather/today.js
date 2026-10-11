// ============================================================
// orOS Weather — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only: reads the Weather app's cities (oros-weatherapp-data),
// its device-local forecast cache (oros-weatherapp-cache) and the
// shell's weather place (oros-weather); never writes, NEVER fetches.
// One top line for today: the city nearest the shell's place (within
// 0.15°, the briefing's rule), else the app's open city, else the
// first one: "Thessaloniki: 24° / 15° · rain 10%". A cache older
// than 24 hours, or without a row for today, says nothing.
// Temperatures follow the app's units (the cache is always °C).
// Opens Weather.
// ============================================================
(function (root) {
  "use strict";
  var NEAR_DEG = 0.15, DAY_MS = 86400000;
  var W = { en: { rain: "rain {p}%" }, el: { rain: "βροχή {p}%" } };

  function pickCity(data, pref) {
    var cities = data.cities.filter(function (c) {
      return c && typeof c.id === "string" && typeof c.lat === "number" && typeof c.lon === "number";
    });
    if (!cities.length) return null;
    if (pref && typeof pref.lat === "number" && typeof pref.lon === "number") {
      var best = null, bestD = Infinity;
      cities.forEach(function (c) {
        var d = Math.abs(c.lat - pref.lat) + Math.abs(c.lon - pref.lon);
        if (d < bestD) { bestD = d; best = c; }
      });
      if (best && bestD < NEAR_DEG) return best;
    }
    for (var i = 0; i < cities.length; i++) if (cities[i].id === data.active) return cities[i];
    return cities.slice().sort(function (a, b) { return (a.pos || 0) - (b.pos || 0); })[0];
  }
  function temp(c, imperial) {
    return typeof c === "number" && isFinite(c) ? Math.round(imperial ? c * 9 / 5 + 32 : c) + "°" : "–";
  }

  var PROVIDER = {
    id: "weather",
    keys: ["oros-weatherapp-data", "oros-weatherapp-cache", "oros-weather"],
    collect: function (ctx) {
      var data = ctx.readJSON("oros-weatherapp-data"), cache = ctx.readJSON("oros-weatherapp-cache");
      if (!data || !Array.isArray(data.cities) || !cache || typeof cache !== "object") return [];
      var city = pickCity(data, ctx.readJSON("oros-weather"));
      var p = city && cache[city.id];
      if (!p || typeof p.at !== "number" || ctx.now - p.at > DAY_MS || !Array.isArray(p.daily)) return [];
      var row = null;
      p.daily.forEach(function (d) { if (d && d.date === ctx.today) row = d; });
      if (!row) return [];
      var imp = data.units === "imperial", w = W[ctx.lang] || W.en;
      var text = temp(row.max, imp) + " / " + temp(row.min, imp);
      if (typeof row.pop === "number") text += " · " + w.rain.replace("{p}", Math.round(row.pop));
      return [{ id: "wx", kind: "info", title: (city.label || "") + ": " + text }];
    },
    open: function (target, win) {
      if (typeof win.__orosOpenWeather === "function") win.__orosOpenWeather();
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
