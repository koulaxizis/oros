// ============================================================
// orOS Weather — Today provider (v1.1.0)
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
// Sky tonight (APP-ALIAS merge 4, was the Moon & Sky provider "sky"):
// the sky is computed, nothing stored (OrosSkyCore.feedFor, the same
// events as the Calendar's Moon & Sky feed): main moon phases,
// supermoons, equinoxes and solstices, meteor shower peaks, eclipses.
// Today's ones are top lines; the next days' are events on their
// day, with the time when the moment is exact. ../sky/core.js loads
// on the first build (same ?v as this file). Those rows open Weather
// on the Sky tonight tab at that date ({ sky: true, date }).
// ============================================================
(function (root) {
  "use strict";
  var NEAR_DEG = 0.15, DAY_MS = 86400000;
  var SELF = (root && root.document && root.document.currentScript && root.document.currentScript.src) || "";
  var skyCore = null;
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  // → Promise<OrosSkyCore | null>
  function loadSkyCore() {
    if (root.OrosSkyCore) return Promise.resolve(root.OrosSkyCore);
    if (skyCore) return skyCore;
    skyCore = new Promise(function (resolve) {
      if (!root.document) {
        try { resolve(require("../sky/core.js")); } catch (e) { resolve(null); }
        return;
      }
      var src;
      try {
        var u = new URL("../sky/core.js", SELF || root.location.href);
        var q = SELF ? new URL(SELF).search : "";
        src = u.pathname + q;
      } catch (e) { resolve(null); return; }
      var sc = root.document.createElement("script");
      sc.src = src;
      sc.onload = function () { resolve(root.OrosSkyCore || null); };
      sc.onerror = function () { skyCore = null; resolve(null); };
      root.document.head.appendChild(sc);
    });
    return skyCore;
  }
  function skyRows(S, ctx) {
    if (!S || typeof S.feedFor !== "function") return [];
    var out = [];
    for (var i = 0; i <= ctx.horizon; i++) {
      var day = ctx.addDays(ctx.today, i);
      S.feedFor(day, ctx.lang === "el" ? "el" : "en").forEach(function (e, k) {
        var d = new Date(e.t), hm = e.allDay ? null : pad2(d.getHours()) + ":" + pad2(d.getMinutes());
        out.push({ id: "sky:" + day + ":" + e.kind + ":" + k, due: day, kind: i === 0 ? "info" : "event",
                   time: hm, title: e.title, text: i === 0 && hm ? hm : "", target: { sky: true, date: day } });
      });
    }
    return out;
  }
  var W = { en: { "row.rain": "rain {p}%" }, el: { "row.rain": "βροχή {p}%" } };

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

  function weatherRows(ctx) {
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
    if (typeof row.pop === "number") text += " · " + w["row.rain"].replace("{p}", Math.round(row.pop));
    return [{ id: "wx", kind: "info", title: (city.label || "") + ": " + text }];
  }

  var PROVIDER = {
    id: "weather",
    keys: ["oros-weatherapp-data", "oros-weatherapp-cache", "oros-weather"],
    collect: function (ctx) {
      var wx = weatherRows(ctx);
      return loadSkyCore().then(function (S) {
        var sky = [];
        try { sky = skyRows(S, ctx); } catch (e) {}
        return wx.concat(sky);
      });
    },
    // Today's numbers for the tips of the day (BR-TODAY-16): °C, %.
    facts: function (ctx) {
      var data = ctx.readJSON("oros-weatherapp-data"), cache = ctx.readJSON("oros-weatherapp-cache");
      if (!data || !Array.isArray(data.cities) || !cache || typeof cache !== "object") return null;
      var city = pickCity(data, ctx.readJSON("oros-weather"));
      var p = city && cache[city.id];
      if (!p || typeof p.at !== "number" || ctx.now - p.at > DAY_MS || !Array.isArray(p.daily)) return null;
      var row = null;
      p.daily.forEach(function (d) { if (d && d.date === ctx.today) row = d; });
      if (!row) return null;
      var num = function (v) { return typeof v === "number" && isFinite(v) ? Math.round(v * 10) / 10 : null; };
      return { max: num(row.max), min: num(row.min), pop: num(row.pop), imp: data.units === "imperial" };
    },
    open: function (target, win) {
      if (target && target.sky === true && typeof win.__orosOpenAt === "function") { win.__orosOpenAt("weather", target); return; }
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
