// ============================================================
// orOS Maps — planner-core.js (OsmAnd "Plan a route", maps wave 10B,
// v1.0.0). Pure functions, no DOM, no network: Node-tested in
// tests/maps-planner.test.js.
//
//   - A plan: points [{lat, lon}] and one segment between each pair:
//     { mode: "foot" | "bike" | "car" | "line", line: [[lat, lon]…] }.
//     A routed segment's line comes from OSRM; "line" is straight.
//   - The whole line, its length, and samples along it for the
//     elevation profile (one every `step` m, at most `max`).
//   - Elevation: AWS Terrain Tiles (Terrarium PNG, free, no key):
//     which tile and pixel a point falls in, and how an RGB pixel
//     reads as metres.
//   - The plan as a track (tracks-core shape) for "Save to My tracks":
//     the line with elevations, the points as waypoints.
//
// API: window.OrosMapsPlanner (module.exports in Node).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.0.0";
  var MAX_PTS = 100;
  var MODES = ["foot", "bike", "car", "line"];
  var TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
  var TILE_Z = 13;                     // ≈ 19 m per pixel at 38° N
  var R = 6371000;

  function okLat(v) { return typeof v === "number" && isFinite(v) && v >= -90 && v <= 90; }
  function okLon(v) { return typeof v === "number" && isFinite(v) && v >= -180 && v <= 180; }
  function rad(x) { return x * Math.PI / 180; }
  function dist(a, b) {
    var dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }
  function mode(m) { return MODES.indexOf(m) >= 0 ? m : "foot"; }

  // OSRM GeoJSON coordinates [lon, lat] → [[lat, lon]…]; null if unusable.
  function lineFromOsrm(json) {
    var r = json && Array.isArray(json.routes) ? json.routes[0] : null;
    var c = r && r.geometry && Array.isArray(r.geometry.coordinates) ? r.geometry.coordinates : null;
    if (!c) return null;
    var out = [];
    c.forEach(function (p) {
      if (Array.isArray(p) && okLon(p[0]) && okLat(p[1])) out.push([p[1], p[0]]);
    });
    return out.length > 1 ? out : null;
  }
  function straight(a, b) { return [[a.lat, a.lon], [b.lat, b.lon]]; }

  // The whole line: segments joined, the shared point once.
  function fullLine(segs) {
    var out = [];
    (segs || []).forEach(function (s) {
      if (!s || !Array.isArray(s.line)) return;
      s.line.forEach(function (p, i) {
        if (i === 0 && out.length) {
          var q = out[out.length - 1];
          if (q[0] === p[0] && q[1] === p[1]) return;
        }
        out.push([p[0], p[1]]);
      });
    });
    return out;
  }
  function lineLength(line) {
    var s = 0;
    for (var i = 1; i < (line || []).length; i++) s += dist(line[i - 1], line[i]);
    return s;
  }
  // Points along the line, one every `step` metres (the first and last
  // always), at most `max` (the step grows to fit). → [{lat, lon, d}]
  function sample(line, step, max) {
    if (!Array.isArray(line) || line.length < 1) return [];
    if (line.length === 1) return [{ lat: line[0][0], lon: line[0][1], d: 0 }];
    var total = lineLength(line);
    max = max > 1 ? max : 300;
    step = Math.max(step > 0 ? step : 50, total / (max - 1));
    var out = [{ lat: line[0][0], lon: line[0][1], d: 0 }];
    var next = step, acc = 0;
    for (var i = 1; i < line.length; i++) {
      var a = line[i - 1], b = line[i], seg = dist(a, b);
      while (seg > 0 && next <= acc + seg && next < total) {
        var k = (next - acc) / seg;
        out.push({ lat: a[0] + k * (b[0] - a[0]), lon: a[1] + k * (b[1] - a[1]), d: next });
        next += step;
      }
      acc += seg;
    }
    var last = line[line.length - 1];
    out.push({ lat: last[0], lon: last[1], d: total });
    return out.slice(0, max);
  }

  // ---------- Terrarium tiles ----------
  // Web Mercator tile of a point at zoom z, and the pixel inside it.
  function tileFor(lat, lon, z) {
    z = z == null ? TILE_Z : z;
    var n = Math.pow(2, z);
    var x = (lon + 180) / 360 * n;
    var la = Math.max(-85.0511, Math.min(85.0511, lat));
    var y = (1 - Math.log(Math.tan(rad(la)) + 1 / Math.cos(rad(la))) / Math.PI) / 2 * n;
    var tx = Math.floor(x), ty = Math.floor(y);
    return { z: z, x: ((tx % n) + n) % n, y: Math.min(n - 1, Math.max(0, ty)),
      px: Math.min(255, Math.floor((x - tx) * 256)), py: Math.min(255, Math.floor((y - ty) * 256)) };
  }
  function tileUrl(t) {
    return TILE_URL.replace("{z}", t.z).replace("{x}", t.x).replace("{y}", t.y);
  }
  // Terrarium: height = R·256 + G + B/256 − 32768 (metres).
  function decode(r, g, b) {
    var h = r * 256 + g + b / 256 - 32768;
    return h < -12000 || h > 9000 ? null : Math.round(h * 10) / 10;
  }
  // Climb and descent with a 3 m threshold (GPS / DEM noise), min, max.
  function climb(eles) {
    var up = 0, down = 0, lo = Infinity, hi = -Infinity, ref = null;
    (eles || []).forEach(function (e) {
      if (typeof e !== "number" || !isFinite(e)) return;
      lo = Math.min(lo, e); hi = Math.max(hi, e);
      if (ref === null) { ref = e; return; }
      if (e - ref >= 3) { up += e - ref; ref = e; }
      else if (ref - e >= 3) { down += ref - e; ref = e; }
    });
    if (ref === null) return null;
    return { up: Math.round(up), down: Math.round(down), min: Math.round(lo), max: Math.round(hi) };
  }

  // ---------- as a track ----------
  //   samples [{lat, lon, d}], eles [m | null] (same length or none)
  function toTrack(name, pts, line, samples, eles) {
    var seg = [];
    if (samples && eles && samples.length === eles.length && samples.length > 1) {
      // Elevation known at the samples: the line's own vertices keep
      // their place, each with the elevation of the nearest sample.
      var cum = 0, j = 0;
      for (var i = 0; i < line.length; i++) {
        if (i) cum += dist(line[i - 1], line[i]);
        while (j < samples.length - 1 && Math.abs(samples[j + 1].d - cum) <= Math.abs(samples[j].d - cum)) j++;
        var e = eles[j];
        seg.push([line[i][0], line[i][1], typeof e === "number" ? e : null, null]);
      }
    } else {
      line.forEach(function (p) { seg.push([p[0], p[1], null, null]); });
    }
    if (seg.length < 2) return null;
    var wpts = (pts || []).filter(function (p) { return p && okLat(p.lat) && okLon(p.lon); })
      .map(function (p, i) { return { lat: p.lat, lon: p.lon, ele: null, t: null, name: String(i + 1) }; });
    var nm = String(name || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
    return { name: nm, segs: [seg], wpts: wpts };
  }

  var api = {
    VER: VER, MAX_PTS: MAX_PTS, MODES: MODES, TILE_Z: TILE_Z,
    dist: dist, mode: mode, lineFromOsrm: lineFromOsrm, straight: straight,
    fullLine: fullLine, lineLength: lineLength, sample: sample,
    tileFor: tileFor, tileUrl: tileUrl, decode: decode, climb: climb, toTrack: toTrack
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosMapsPlanner = api;
})(typeof window !== "undefined" ? window : this);
