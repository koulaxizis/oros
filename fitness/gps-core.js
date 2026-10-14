// ============================================================
// orOS Workouts — gps-core.js (pure, no DOM, v1.0.0)
// Outdoor sessions (walk / run / ride) recorded with the device's
// geolocation while the app is open. Track maths come from the Maps
// app's tracks-core.js (window.OrosMapsTracks: distM, accept (noise
// filter), simplifySeg, writeGpx), loaded by path and never changed.
//
// Stored on the workout as wo.g = { a, ps, sg: ["<seg>", ...] }:
//   a   activity "walk" | "run" | "ride"
//   ps  1 while paused (a pause ends a segment)
//   sg  segments, each a compact string: integer triples
//       (lat × 1e6, lon × 1e6, seconds since the workout start),
//       delta-coded per segment with the polyline varint alphabet
//       (ASCII 63–126), so a 10 km run is a few kilobytes.
// Distance = sum of the segments; time = sum of each segment's own
// duration (pauses do not count). Splits are cut at every whole km
// (or mile) by interpolating inside the segment that crosses it.
// window.OrosFitnessGps (module.exports in Node).
// ============================================================
(function (root) {
  "use strict";

  var MT = root.OrosMapsTracks || (typeof require === "function" ? require("../maps/tracks-core.js") : null);
  var ACTS = ["walk", "run", "ride"];
  var ACT_EX = { walk: "x-walk", run: "x-run", ride: "x-bike" };
  var MAX_SEGS = 60, MAX_CHARS = 600000, MAX_PTS = 40000;
  var SEG_RE = /^[\x3f-\x7e]*$/;
  var Q = 1e6;

  function isNum(v) { return typeof v === "number" && isFinite(v); }

  // ---------- varint coding (Google polyline alphabet) ----------
  function encInt(v) {
    v = v < 0 ? ~(v * 2) : v * 2;          // zigzag without 32-bit overflow on big values
    var s = "";
    while (v >= 0x20) { s += String.fromCharCode((0x20 | (v % 32)) + 63); v = Math.floor(v / 32); }
    return s + String.fromCharCode(v + 63);
  }
  function decInts(str) {
    var out = [], i = 0;
    while (i < str.length) {
      var res = 0, mul = 1, b;
      do {
        if (i >= str.length) return null;
        b = str.charCodeAt(i++) - 63;
        if (b < 0 || b > 63) return null;
        res += (b & 0x1f) * mul; mul *= 32;
      } while (b >= 0x20 && mul < 1e15);
      out.push(res % 2 ? -(res + 1) / 2 : res / 2);
    }
    return out;
  }

  // pts: [[lat, lon, ele, ms], ...] → string; t0 = workout start (ms)
  function encSeg(pts, t0) {
    var s = "", pl = 0, pn = 0, pt = 0;
    pts.forEach(function (p) {
      var la = Math.round(p[0] * Q), lo = Math.round(p[1] * Q), tt = Math.max(0, Math.round((p[3] - t0) / 1000));
      s += encInt(la - pl) + encInt(lo - pn) + encInt(tt - pt);
      pl = la; pn = lo; pt = tt;
    });
    return s;
  }
  function decSeg(str, t0) {
    var v = decInts(String(str || ""));
    if (!v || v.length % 3) return [];
    var out = [], la = 0, lo = 0, tt = 0;
    for (var i = 0; i < v.length; i += 3) {
      la += v[i]; lo += v[i + 1]; tt += v[i + 2];
      var lat = la / Q, lon = lo / Q;
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180 || tt < 0) return out;
      out.push([lat, lon, null, t0 + tt * 1000]);
    }
    return out;
  }

  // ---------- model ----------
  function normGps(g) {
    if (!g || typeof g !== "object" || ACTS.indexOf(g.a) < 0) return null;
    var sg = [], chars = 0;
    (Array.isArray(g.sg) ? g.sg : []).forEach(function (s) {
      if (typeof s !== "string" || !SEG_RE.test(s) || sg.length >= MAX_SEGS || chars + s.length > MAX_CHARS) return;
      chars += s.length;
      sg.push(s);
    });
    return { a: g.a, ps: g.ps ? 1 : 0, sg: sg };
  }
  function segsOf(g, t0) {
    return (g && Array.isArray(g.sg) ? g.sg : []).map(function (s) { return decSeg(s, t0); })
      .filter(function (s) { return s.length; });
  }

  // ---------- maths ----------
  function distM(a, b) { return MT.distM(a[0], a[1], b[0], b[1]); }
  function segDist(seg) {
    var d = 0;
    for (var i = 1; i < seg.length; i++) d += distM(seg[i - 1], seg[i]);
    return d;
  }
  // { dist: metres (rounded), time: seconds }
  function statsOf(segs) {
    var d = 0, t = 0;
    segs.forEach(function (seg) {
      d += segDist(seg);
      if (seg.length > 1) t += (seg[seg.length - 1][3] - seg[0][3]) / 1000;
    });
    return { dist: Math.round(d), time: Math.round(t) };
  }
  // Seconds per unit (1000 m or 1609.344 m); 0 when not computable.
  function pace(sec, metres, unitM) {
    return sec > 0 && metres > 0 ? sec / (metres / (unitM || 1000)) : 0;
  }
  // km/h (or mph with unitM = 1609.344)
  function speed(sec, metres, unitM) {
    return sec > 0 && metres > 0 ? (metres / (unitM || 1000)) / (sec / 3600) : 0;
  }
  // [{ n (1-based), d (metres in this split), t (seconds), full }]
  function splits(segs, unitM) {
    unitM = unitM || 1000;
    var out = [], cur = { d: 0, t: 0 };
    segs.forEach(function (seg) {
      for (var i = 1; i < seg.length; i++) {
        var a = seg[i - 1], b = seg[i], d = distM(a, b), dt = (b[3] - a[3]) / 1000;
        while (d > 0 && cur.d + d >= unitM) {
          var need = unitM - cur.d, f = need / d;
          cur.t += dt * f;
          out.push({ n: out.length + 1, d: unitM, t: Math.round(cur.t), full: true });
          d -= need; dt -= dt * f;
          cur = { d: 0, t: 0 };
        }
        cur.d += d; cur.t += dt;
      }
    });
    if (cur.d >= 1) out.push({ n: out.length + 1, d: Math.round(cur.d), t: Math.round(cur.t), full: false });
    return out;
  }
  function countPts(segs) { var n = 0; segs.forEach(function (s) { n += s.length; }); return n; }

  // Recording filter (Maps' own): null = drop this fix.
  function accept(last, fix) { return MT.accept(last, fix); }

  // Finished sessions are thinned (2 m) so the slice stays small.
  function thin(segs, tol) {
    return segs.map(function (s) { return MT.simplifySeg(s, tol || 2); });
  }

  function gpx(name, segs) {
    return MT.writeGpx({ name: name || "", segs: segs, wpts: [] })
      .replace('creator="orOS Maps"', 'creator="orOS Workouts"');
  }

  // SVG preview: one path per segment in a w × h box (equirectangular
  // with the latitude's cosine), north up. → { paths: ["M…"], start, end }
  function project(segs, w, h, pad) {
    pad = pad || 8;
    var s = 90, n = -90, west = 180, e = -180, any = false;
    segs.forEach(function (seg) {
      seg.forEach(function (p) {
        any = true;
        if (p[0] < s) s = p[0]; if (p[0] > n) n = p[0];
        if (p[1] < west) west = p[1]; if (p[1] > e) e = p[1];
      });
    });
    if (!any) return null;
    var kx = Math.cos((s + n) / 2 * Math.PI / 180);
    var sw = Math.max((e - west) * kx, 1e-6), sh = Math.max(n - s, 1e-6);
    var sc = Math.min((w - 2 * pad) / sw, (h - 2 * pad) / sh);
    var ox = (w - sw * sc) / 2, oy = (h - sh * sc) / 2;
    function xy(p) {
      return [Math.round((ox + (p[1] - west) * kx * sc) * 10) / 10, Math.round((oy + (n - p[0]) * sc) * 10) / 10];
    }
    var paths = segs.map(function (seg) {
      return seg.map(function (p, i) { var q = xy(p); return (i ? "L" : "M") + q[0] + " " + q[1]; }).join("");
    });
    var last = segs[segs.length - 1];
    return { paths: paths, start: xy(segs[0][0]), end: xy(last[last.length - 1]) };
  }

  var api = {
    ACTS: ACTS, ACT_EX: ACT_EX, MAX_PTS: MAX_PTS,
    encInt: encInt, decInts: decInts, encSeg: encSeg, decSeg: decSeg, normGps: normGps, segsOf: segsOf,
    statsOf: statsOf, pace: pace, speed: speed, splits: splits, countPts: countPts,
    accept: accept, thin: thin, gpx: gpx, project: project
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosFitnessGps = api;
})(typeof window !== "undefined" ? window : globalThis);
