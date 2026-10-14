// ============================================================
// orOS Weather — rain map core (pure, no DOM, never fetches)
// NASA GIBS, layer IMERG_Precipitation_Rate_30min (half-hourly
// IMERG Early Run precipitation rate, mm/h). Public, no key,
// CORS-enabled WMTS. Times are the START of each half hour
// (hh:00 / hh:30 UTC); the data shows up about 5–7 hours late.
// GIBS facts this file relies on (checked 2026-10-14):
//   - tile matrix set GoogleMapsCompatible_Level6 (zoom 0..6)
//   - time in the REST path as YYYY-MM-DDThh:mm:ssZ
//   - DescribeDomains answers "<Domain>start/end/PT30M</Domain>"
//   - a time without data answers with an error, not a blank tile
// Node tests: tests/weather-rainmap.test.js.
// Exposed as window.OrosRainMapCore; module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var LAYER = "IMERG_Precipitation_Rate_30min";
  var BASE = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/";
  var MATRIX = "GoogleMapsCompatible_Level6";
  var MAX_NATIVE_ZOOM = 6;
  var STEP_MS = 30 * 60 * 1000;
  var STEPS = 12;                       // 6 hours of half-hour frames
  var PROBE_FROM_H = 3;                 // newest time worth probing (h ago)
  var PROBE_COUNT = 24;                 // probes back to ~15 h ago

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // Half-hour floor of a moment (ms since epoch, UTC).
  function floorStep(ms) { return Math.floor(ms / STEP_MS) * STEP_MS; }

  // "2026-10-14T13:30:00Z" — the time format of the GIBS REST path.
  function isoTime(ms) {
    var d = new Date(floorStep(ms));
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) +
      "T" + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":00Z";
  }

  // Parse an ISO date ("2026-10-13") or date-time ("…T13:30:00Z",
  // "…T13:30Z", "…T13:30:00.000Z") as UTC → ms, or null.
  function parseIso(s) {
    var m = /^\s*(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z?)?\s*$/.exec(String(s == null ? "" : s));
    if (!m) return null;
    var ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    return isFinite(ms) ? ms : null;
  }

  // Leaflet template for one time: {z}/{y}/{x} stay for Leaflet.
  function tileTemplate(ms) {
    return BASE + LAYER + "/default/" + isoTime(ms) + "/" + MATRIX + "/{z}/{y}/{x}.png";
  }
  // One concrete tile (z = level, y = row, x = column).
  function tileUrl(ms, z, y, x) {
    return tileTemplate(ms).replace("{z}", String(z)).replace("{y}", String(y)).replace("{x}", String(x));
  }

  // DescribeDomains: the times GIBS has between two moments.
  function domainsUrl(fromMs, toMs) {
    return BASE + "1.0.0/" + LAYER + "/default/" + MATRIX + "/all/" +
      isoTime(fromMs) + "--" + isoTime(toMs) + ".xml";
  }

  // The newest time in a DescribeDomains answer, or null.
  // The time Domain is a comma list of "start/end/period" ranges or
  // single instants. The space domain has no <Domain> text, so the
  // first <Domain> with a date in it is the time one.
  function parseDomains(xml, nowMs) {
    var re = /<(?:[\w-]+:)?Domain>([^<]*)<\/(?:[\w-]+:)?Domain>/g, m, best = null;
    while ((m = re.exec(String(xml == null ? "" : xml)))) {
      String(m[1]).split(",").forEach(function (part) {
        var bits = part.trim().split("/");
        var end = bits.length >= 2 ? bits[1] : bits[0];
        var ms = parseIso(end);
        if (ms === null) return;
        ms = floorStep(ms);
        if (typeof nowMs === "number" && ms > nowMs) ms = floorStep(nowMs);
        if (best === null || ms > best) best = ms;
      });
    }
    return best;
  }

  // The frames for the slider: STEPS half hours ending at latest,
  // oldest first.
  function frames(latestMs, n) {
    n = n || STEPS;
    var out = [], end = floorStep(latestMs);
    for (var i = n - 1; i >= 0; i--) out.push(end - i * STEP_MS);
    return out;
  }

  // Times to probe (newest first) when DescribeDomains can't be read:
  // from PROBE_FROM_H hours ago back, one half hour at a time.
  function probeTimes(nowMs, count) {
    count = count || PROBE_COUNT;
    var out = [], start = floorStep(nowMs - PROBE_FROM_H * 3600 * 1000);
    for (var i = 0; i < count; i++) out.push(start - i * STEP_MS);
    return out;
  }

  // Whole hours (rounded down, ≥ 0) between a frame and now.
  function hoursAgo(frameMs, nowMs) {
    // IMERG times are the START of the half hour: count to its middle.
    var h = Math.floor((nowMs - (frameMs + STEP_MS / 2)) / 3600000);
    return h < 0 ? 0 : h;
  }

  // Legend: the GIBS IMERG rain colour map (mm/h, log steps).
  var LEGEND = [
    { v: 0.1, rgb: [0, 118, 78] },
    { v: 0.22, rgb: [0, 156, 20] },
    { v: 0.5, rgb: [78, 195, 0] },
    { v: 1.1, rgb: [218, 234, 0] },
    { v: 2.5, rgb: [255, 144, 17] },
    { v: 5.6, rgb: [255, 38, 38] },
    { v: 12.6, rgb: [206, 0, 0] },
    { v: 28, rgb: [119, 0, 0] },
    { v: 53, rgb: [51, 0, 0] }
  ];
  var LEGEND_SNOW = [
    { v: 0.1, rgb: [177, 250, 238] },
    { v: 0.5, rgb: [99, 167, 218] },
    { v: 2.5, rgb: [65, 60, 215] },
    { v: 12.6, rgb: [122, 9, 188] },
    { v: 53, rgb: [58, 3, 48] }
  ];
  // A CSS linear-gradient for a legend bar (log scale 0.1 → 53 mm/h).
  function legendGradient(stops) {
    stops = stops || LEGEND;
    var lo = Math.log(stops[0].v), hi = Math.log(stops[stops.length - 1].v);
    return "linear-gradient(to right, " + stops.map(function (s) {
      var pct = Math.round(1000 * (Math.log(s.v) - lo) / (hi - lo)) / 10;
      return "rgb(" + s.rgb.join(",") + ") " + pct + "%";
    }).join(", ") + ")";
  }
  // Position (0..100 %) of a value on that log bar, for tick labels.
  function legendPos(v, stops) {
    stops = stops || LEGEND;
    var lo = Math.log(stops[0].v), hi = Math.log(stops[stops.length - 1].v);
    var p = 100 * (Math.log(v) - lo) / (hi - lo);
    return Math.max(0, Math.min(100, Math.round(p * 10) / 10));
  }

  var api = {
    LAYER: LAYER, MATRIX: MATRIX, MAX_NATIVE_ZOOM: MAX_NATIVE_ZOOM,
    STEP_MS: STEP_MS, STEPS: STEPS, LEGEND: LEGEND, LEGEND_SNOW: LEGEND_SNOW,
    floorStep: floorStep, isoTime: isoTime, parseIso: parseIso,
    tileTemplate: tileTemplate, tileUrl: tileUrl, domainsUrl: domainsUrl,
    parseDomains: parseDomains, frames: frames, probeTimes: probeTimes,
    hoursAgo: hoursAgo, legendGradient: legendGradient, legendPos: legendPos
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosRainMapCore = api;
})(typeof window !== "undefined" ? window : this);
