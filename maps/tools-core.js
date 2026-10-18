// ============================================================
// orOS Maps — tools-core.js (OsmAnd style tools, maps wave 10A,
// v1.0.0). Pure functions, no DOM, no network: Node-tested in
// tests/maps-tools.test.js.
//
//   - Ruler: length of a line of points, area of a closed shape
//     (local flat projection, good for a few km), their display.
//   - Parking: the device-local "I parked here" record and when its
//     reminder is due.
//   - Speed limit: OSM maxspeed values (km/h, mph, "none", "walk"),
//     the Overpass query for the road ahead of a route (a corridor
//     around a few points of it) and the limit of the road the user
//     is on (nearest way that runs the same way as the route).
//
// API: window.OrosMapsTools (module.exports in Node).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.0.0";
  var R = 6371000;
  var MAX_PTS = 200;                    // ruler points
  var MAX_WAYS = 600;                   // speed limit ways kept in memory
  var MPH = 1.609344;

  function okLat(v) { return typeof v === "number" && isFinite(v) && v >= -90 && v <= 90; }
  function okLon(v) { return typeof v === "number" && isFinite(v) && v >= -180 && v <= 180; }
  function rad(x) { return x * Math.PI / 180; }

  // ---------- distances ----------
  //   a, b: [lat, lon]
  function dist(a, b) {
    var dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }
  function cleanPts(pts) {
    if (!Array.isArray(pts)) return [];
    return pts.filter(function (p) {
      return Array.isArray(p) && okLat(p[0]) && okLon(p[1]);
    }).slice(0, MAX_PTS);
  }
  // Total length; closed = back to the first point too.
  function length(pts, closed) {
    pts = cleanPts(pts);
    var s = 0;
    for (var i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
    if (closed && pts.length > 2) s += dist(pts[pts.length - 1], pts[0]);
    return s;
  }
  // Area (m²) of the shape the points enclose: shoelace on a flat
  // projection around the shape's middle latitude.
  function area(pts) {
    pts = cleanPts(pts);
    if (pts.length < 3) return 0;
    var lat0 = 0;
    pts.forEach(function (p) { lat0 += p[0]; });
    lat0 /= pts.length;
    var kx = R * Math.cos(rad(lat0)) * Math.PI / 180, ky = R * Math.PI / 180;
    var lon0 = pts[0][1];
    var s = 0;
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      var ax = (a[1] - lon0) * kx, ay = a[0] * ky, bx = (b[1] - lon0) * kx, by = b[0] * ky;
      s += ax * by - bx * ay;
    }
    return Math.abs(s) / 2;
  }
  // Decimal comma for el, de… (what the language's locale writes).
  function decComma(lang) {
    if (lang === "el") return true;
    if (!lang || lang === "en") return false;
    try { return (1.5).toLocaleString(lang).indexOf(",") >= 0; } catch (e) { return false; }
  }
  function num(v, d, lang) {
    var s = v.toFixed(d);
    return decComma(lang) ? s.replace(".", ",") : s;
  }
  // Units as Maps shows them (Greek: μ., χλμ., στρ. for 1000 m²).
  var UNITS = {
    en: { m: "m", km: "km", m2: "m²", ha: "ha", km2: "km²" },
    el: { m: "μ.", km: "χλμ.", m2: "τ.μ.", ha: "στρ.", km2: "τ.χλμ." }
  };
  // Pack languages (de…): UNITS[code] from the "maps" pack, English fallback.
  if (typeof window !== "undefined" && window.orosI18n) window.orosI18n.table(UNITS, "maps", window.orosI18n.lang());
  function fmtLen(m, lang) {
    if (!(m >= 0)) return "";
    var u = UNITS[lang] || UNITS.en;
    if (m < 1000) return Math.round(m) + " " + u.m;
    return num(m / 1000, m < 10000 ? 2 : 1, lang) + " " + u.km;
  }
  // Greek land is measured in στρέμματα (1000 m²), not hectares.
  function fmtArea(m2, lang) {
    if (!(m2 >= 0)) return "";
    var u = UNITS[lang] || UNITS.en;
    if (lang === "el") {
      if (m2 < 1000) return Math.round(m2) + " " + u.m2;
      if (m2 < 1e6) return num(m2 / 1000, 2, lang) + " " + u.ha;
      return num(m2 / 1e6, 2, lang) + " " + u.km2;
    }
    if (m2 < 10000) return Math.round(m2) + " " + u.m2;
    if (m2 < 1e6) return num(m2 / 10000, 2, lang) + " " + u.ha;
    return num(m2 / 1e6, 2, lang) + " " + u.km2;
  }

  // ---------- parking ----------
  //   { lat, lon, at (ms), until (ms, 0 = no reminder), note }
  function normPark(p) {
    if (!p || typeof p !== "object" || !okLat(p.lat) || !okLon(p.lon)) return null;
    var at = typeof p.at === "number" && isFinite(p.at) && p.at > 0 ? Math.round(p.at) : 0;
    if (!at) return null;
    var until = typeof p.until === "number" && isFinite(p.until) && p.until > at ? Math.round(p.until) : 0;
    var note = typeof p.note === "string"
      ? p.note.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) : "";
    return { lat: p.lat, lon: p.lon, at: at, until: until, note: note };
  }
  // Reminder choices: minutes from now (0 = none).
  var REMIND = [0, 30, 60, 120];
  function untilFor(nowMs, min) {
    return min > 0 ? nowMs + min * 60000 : 0;
  }
  // A time of day "HH:MM" → the next moment it happens (today, or
  // tomorrow when it already passed). null for a bad value.
  function untilAt(nowMs, hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
    if (!m) return null;
    var h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    var d = new Date(nowMs);
    d.setHours(h, mi, 0, 0);
    if (d.getTime() <= nowMs) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  function parkDue(p, nowMs) {
    p = normPark(p);
    return !!(p && p.until && nowMs >= p.until);
  }

  // ---------- speed limit ----------
  // OSM maxspeed → { v (as on the sign), mph, kmh } | { none: true } | null.
  // "50", "30 mph", "50;30" (first one), "walk" (≈ 6 km/h), "none"
  // (no limit, e.g. some Autobahn). Zone values like "GR:urban" are
  // left out: their number differs by country.
  function maxspeed(raw) {
    if (typeof raw !== "string") return null;
    var s = raw.split(";")[0].trim().toLowerCase();
    if (s === "none") return { none: true };
    if (s === "walk") return { v: 6, mph: false, kmh: 6 };
    var m = /^(\d{1,3})(?:\s*(mph|km\/h|kmh|kph))?$/.exec(s);
    if (!m) return null;
    var v = +m[1];
    if (v <= 0 || v > 300) return null;
    var mph = m[2] === "mph";
    return { v: v, mph: mph, kmh: mph ? Math.round(v * MPH) : v };
  }
  // Points of the route (coords [lon, lat], cum = metres per vertex)
  // between `from` and `to` metres, one every `step` metres.
  // → [[lat, lon]…]
  function corridor(coords, cum, from, to, step) {
    var out = [];
    if (!Array.isArray(coords) || coords.length < 2 || !Array.isArray(cum) || cum.length !== coords.length) return out;
    step = step > 0 ? step : 150;
    var total = cum[cum.length - 1];
    from = Math.max(0, from); to = Math.min(total, to);
    if (to <= from) return out;
    var i = 0;
    for (var a = from; ; a += step) {
      if (a > to) a = to;
      while (i < cum.length - 2 && cum[i + 1] < a) i++;
      var span = cum[i + 1] - cum[i];
      var k = span > 0 ? (a - cum[i]) / span : 0;
      k = Math.max(0, Math.min(1, k));
      var lat = coords[i][1] + k * (coords[i + 1][1] - coords[i][1]);
      var lon = coords[i][0] + k * (coords[i + 1][0] - coords[i][0]);
      out.push([Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6]);
      if (a >= to) break;
    }
    return out;
  }
  // Overpass: roads with a maxspeed within `r` metres of the line.
  function limitQuery(pts, r) {
    var line = pts.map(function (p) { return p[0] + "," + p[1]; }).join(",");
    return "[out:json][timeout:20];way[highway][maxspeed](around:" + (r || 20) + "," + line + ");out tags geom qt " + MAX_WAYS + ";";
  }
  function parseLimits(json) {
    var out = [];
    var els = json && Array.isArray(json.elements) ? json.elements : [];
    els.forEach(function (e) {
      if (!e || e.type !== "way" || typeof e.id !== "number" || !e.tags || !Array.isArray(e.geometry)) return;
      var ms = maxspeed(e.tags.maxspeed);
      if (!ms) return;
      var geom = e.geometry.filter(function (g) { return g && okLat(g.lat) && okLon(g.lon); })
        .map(function (g) { return [g.lat, g.lon]; });
      if (geom.length < 2) return;
      out.push({ id: e.id, ms: ms, geom: geom });
    });
    return out.slice(0, MAX_WAYS);
  }
  // Keep the newest ways first, one per id, at most MAX_WAYS.
  function mergeLimits(old, add) {
    var seen = {}, out = [];
    (add || []).concat(old || []).forEach(function (w) {
      if (!w || seen[w.id]) return;
      seen[w.id] = 1;
      out.push(w);
    });
    return out.slice(0, MAX_WAYS);
  }
  // Compass bearing a → b in degrees (0 = north).
  function bearing(a, b) {
    var y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
    var x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) -
      Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  // Angle between two directions, either way along a road (0–90).
  function lineDiff(a, b) {
    var d = Math.abs(a - b) % 180;
    return d > 90 ? 180 - d : d;
  }
  // The way the user is on: nearest within maxM; when `brg` (route
  // direction) is given, a way crossing it (> 35°) is skipped, so a
  // side street at a junction does not win.
  function limitAt(ways, lat, lon, brg, maxM) {
    if (!Array.isArray(ways) || !okLat(lat) || !okLon(lon)) return null;
    maxM = maxM > 0 ? maxM : 25;
    var kx = R * Math.cos(rad(lat)) * Math.PI / 180, ky = R * Math.PI / 180;
    var best = null, bestD = Infinity;
    ways.forEach(function (w) {
      for (var i = 0; i < w.geom.length - 1; i++) {
        var a = w.geom[i], b = w.geom[i + 1];
        var ax = (a[1] - lon) * kx, ay = (a[0] - lat) * ky;
        var bx = (b[1] - lon) * kx, by = (b[0] - lat) * ky;
        var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        var tt = l2 > 0 ? -(ax * dx + ay * dy) / l2 : 0;
        tt = Math.max(0, Math.min(1, tt));
        var px = ax + tt * dx, py = ay + tt * dy;
        var d = Math.sqrt(px * px + py * py);
        if (d > maxM || d >= bestD) continue;
        if (typeof brg === "number" && isFinite(brg) && l2 > 0 &&
            lineDiff(bearing(a, b), brg) > 35) continue;
        best = w; bestD = d;
      }
    });
    return best;
  }
  // Faster than the limit (km/h) by more than the margin.
  function over(speedKmh, ms, margin) {
    if (!ms || ms.none || !(speedKmh >= 0)) return false;
    return speedKmh > ms.kmh + (margin == null ? 5 : margin);
  }

  var api = {
    VER: VER, MAX_PTS: MAX_PTS, MAX_WAYS: MAX_WAYS, REMIND: REMIND,
    dist: dist, length: length, area: area, fmtLen: fmtLen, fmtArea: fmtArea,
    normPark: normPark, untilFor: untilFor, untilAt: untilAt, parkDue: parkDue,
    maxspeed: maxspeed, corridor: corridor, limitQuery: limitQuery, parseLimits: parseLimits,
    mergeLimits: mergeLimits, bearing: bearing, limitAt: limitAt, over: over
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosMapsTools = api;
})(typeof window !== "undefined" ? window : this);
