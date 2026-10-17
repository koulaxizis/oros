// ============================================================
// orOS Weather — forecast days for other apps (v1.0.0)
// Loaded by apps (Travel, Calendar) with ../weather/days.js.
// Read-only: reads the Weather app's cities (oros-weatherapp-data),
// its device-local forecast cache (oros-weatherapp-cache) and the
// shell's weather place (oros-weather); never writes, NEVER fetches.
//
//   OrosWeatherDays.forDates(["2026-10-17", …], opts?) →
//     { "2026-10-17": { icon, max, min, label, code, pop, city } }
//   only for dates the cache has a row for. opts = { lat, lon }: the
//   saved city nearest that point within NEAR_DEG, else nothing. No
//   opts: the city nearest the shell's place (today.js rule), else
//   the app's open city, else the first. A cache older than 36 h
//   gives nothing. Temperatures follow the app's units (the cache is
//   always °C); max/min are rounded numbers, label is "24° / 15°".
//   icon is an emoji: the Weather app draws inline SVGs inside
//   weather.js, so the same WMO grouping is copied here as emoji.
// The pure compute(dates, data, cache, place, opts, now) takes the
// parsed objects (node tests).
// ============================================================
(function (root) {
  "use strict";
  var NEAR_PLACE = 0.15, NEAR_DEG = 0.5, MAX_AGE = 36 * 3600000;

  // WMO code → emoji (same grouping as iconFor in weather.js, day icons)
  function iconOf(code) {
    var c = Number(code);
    if (!isFinite(c)) return "";
    if (c === 0) return "☀️";                                  // clear
    if (c === 1 || c === 2) return "⛅";                             // partly cloudy
    if (c === 3) return "☁️";                                  // overcast
    if (c === 45 || c === 48) return "🌫️";               // fog
    if (c >= 51 && c <= 67) return "🌧️";                 // drizzle / rain
    if (c >= 71 && c <= 77) return "🌨️";                 // snow
    if (c >= 80 && c <= 82) return "🌧️";                 // showers
    if (c === 85 || c === 86) return "🌨️";               // snow showers
    if (c >= 95) return "⛈️";                                  // thunderstorm
    return "☁️";
  }

  function num(v) { return typeof v === "number" && isFinite(v); }

  function validCities(data) {
    if (!data || !Array.isArray(data.cities)) return [];
    return data.cities.filter(function (c) {
      return c && typeof c.id === "string" && num(c.lat) && num(c.lon);
    });
  }
  function nearest(cities, lat, lon) {
    var best = null, bestD = Infinity;
    cities.forEach(function (c) {
      var d = Math.abs(c.lat - lat) + Math.abs(c.lon - lon);
      if (d < bestD) { bestD = d; best = c; }
    });
    return best ? { city: best, d: bestD } : null;
  }

  // The city to read: explicit point (strict), else today.js's rule.
  function pickCity(data, place, opts) {
    var cities = validCities(data);
    if (!cities.length) return null;
    if (opts && (opts.lat !== undefined || opts.lon !== undefined)) {
      if (!num(opts.lat) || !num(opts.lon)) return null;
      var n = nearest(cities, opts.lat, opts.lon);
      return n && Math.abs(n.city.lat - opts.lat) <= NEAR_DEG &&
             Math.abs(n.city.lon - opts.lon) <= NEAR_DEG ? n.city : null;
    }
    if (place && num(place.lat) && num(place.lon)) {
      var p = nearest(cities, place.lat, place.lon);
      if (p && p.d < NEAR_PLACE) return p.city;
    }
    for (var i = 0; i < cities.length; i++) if (cities[i].id === data.active) return cities[i];
    return cities.slice().sort(function (a, b) { return (a.pos || 0) - (b.pos || 0); })[0];
  }

  function compute(dates, data, cache, place, opts, now) {
    var out = {};
    if (!Array.isArray(dates) || !dates.length || !cache || typeof cache !== "object") return out;
    var city = pickCity(data, place, opts);
    var p = city && cache[city.id];
    if (!p || !num(p.at) || !Array.isArray(p.daily)) return out;
    if ((num(now) ? now : Date.now()) - p.at > MAX_AGE) return out;
    var imp = data.units === "imperial";
    var want = {};
    dates.forEach(function (d) { if (typeof d === "string") want[d] = 1; });
    p.daily.forEach(function (r) {
      if (!r || typeof r.date !== "string" || !want[r.date] || !num(r.max) || !num(r.min)) return;
      var hi = Math.round(imp ? r.max * 9 / 5 + 32 : r.max);
      var lo = Math.round(imp ? r.min * 9 / 5 + 32 : r.min);
      out[r.date] = {
        icon: iconOf(r.code), max: hi, min: lo, label: hi + "° / " + lo + "°",
        code: num(r.code) ? r.code : null, pop: num(r.pop) ? Math.round(r.pop) : null,
        city: typeof city.label === "string" ? city.label : ""
      };
    });
    return out;
  }

  function readJSON(key) {
    try { return JSON.parse(root.localStorage.getItem(key) || "null"); } catch (e) { return null; }
  }
  function forDates(dates, opts) {
    var data = readJSON("oros-weatherapp-data");
    if (!data || !Array.isArray(data.cities)) return {};
    return compute(dates, data, readJSON("oros-weatherapp-cache"), readJSON("oros-weather"), opts, Date.now());
  }

  var API = { forDates: forDates, compute: compute, pickCity: pickCity, iconOf: iconOf,
              NEAR_DEG: NEAR_DEG, MAX_AGE: MAX_AGE };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root && root.document) root.OrosWeatherDays = API;
})(typeof window !== "undefined" ? window : globalThis);
