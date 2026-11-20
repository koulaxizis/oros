// ============================================================
// orOS Maps — follow-core.js (hiking and cycling, wave H4, v1.0.0)
//
// Following a track the way hikers do (Wikiloc style), pure helpers:
//   - prepare(): the line with metres along it, the climb so far at
//     every point (so the climb LEFT is one subtraction), the track's
//     waypoints placed along it; optionally the other way round.
//   - locate(): where you are on it. On an out-and-back or a loop the
//     same spot is on the line twice; the candidate nearest to where
//     you were last wins, so the distance left does not jump.
//   - offTrack(): off / back with hysteresis (two fixes beyond the
//     limit to say "off", 25 m to say "back"), the limit growing with
//     a poor GPS accuracy.
//   - nextWpt(): the next waypoint ahead, told once at 100 m.
//   - eta(): time left (DIN 33466 hiking rule on foot, or the track's
//     own moving speed), sunTimes(): sunrise and sunset for a day and a
//     place (the sunrise equation, about a minute off), for the
//     "you'd arrive after sunset" warning.
// No DOM, no network: tested in tests/maps-follow.test.js.
// ============================================================
(function (root) {
  "use strict";

  function num(x) { return typeof x === "number" && isFinite(x); }
  function distM(a0, a1, b0, b1) {
    var r = Math.PI / 180, dLat = (b0 - a0) * r, dLon = (b1 - a1) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a0 * r) * Math.cos(b0 * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * 6371000 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  // segs: [[[lat, lon, ele?, t?]…]…]; wpts: [{ lat, lon, name }]
  // → { pts: [[lat, lon, along]], total, cu: [climb so far], cd: [descent
  //     so far], up, down, ele: bool, wpts: [{ name, along, lat, lon }],
  //     moving: m/s from the track's times or 0 } or null
  function prepare(segs, wpts, reverse) {
    var raw = [], times = [];
    (segs || []).forEach(function (s) {
      (Array.isArray(s) ? s : []).forEach(function (p) {
        if (Array.isArray(p) && num(p[0]) && num(p[1])) { raw.push([p[0], p[1], num(p[2]) ? p[2] : null]); times.push(num(p[3]) ? p[3] : null); }
      });
    });
    if (raw.length < 2) return null;
    // the track's own moving speed (before turning it round)
    var mvD = 0, mvT = 0;
    for (var k = 1; k < raw.length; k++) {
      if (times[k] === null || times[k - 1] === null) continue;
      var dt = (times[k] - times[k - 1]) / 1000, dd = distM(raw[k - 1][0], raw[k - 1][1], raw[k][0], raw[k][1]);
      if (dt > 0 && dt < 600 && dd / dt > 0.3 && dd / dt < 40) { mvD += dd; mvT += dt; }
    }
    if (reverse) raw.reverse();
    var pts = [], cu = [], cd = [], d = 0, up = 0, down = 0, ref = null, hasEle = false;
    raw.forEach(function (p, i) {
      if (i) d += distM(raw[i - 1][0], raw[i - 1][1], p[0], p[1]);
      if (p[2] !== null) {
        hasEle = true;
        if (ref === null) ref = p[2];
        else if (p[2] - ref >= 5) { up += p[2] - ref; ref = p[2]; }
        else if (ref - p[2] >= 5) { down += ref - p[2]; ref = p[2]; }
      }
      pts.push([p[0], p[1], d]);
      cu.push(up); cd.push(down);
    });
    var f = { pts: pts, total: d, cu: cu, cd: cd, up: Math.round(up), down: Math.round(down), ele: hasEle, wpts: [],
      moving: mvT > 60 ? mvD / mvT : 0 };
    (wpts || []).forEach(function (w) {
      if (!w || !num(w.lat) || !num(w.lon)) return;
      var at = locate(f, { lat: w.lat, lon: w.lon }, null);
      if (at.off <= 200) f.wpts.push({ name: String(w.name || "").slice(0, 80), along: at.along, lat: w.lat, lon: w.lon });
    });
    f.wpts.sort(function (a, b) { return a.along - b.along; });
    return f;
  }

  // → { off: metres from the line, along: metres along it }
  function locate(f, fix, prevAlong) {
    var kx = 111320 * Math.cos(fix.lat * Math.PI / 180), ky = 110540;
    var cand = [], best = Infinity;
    for (var i = 1; i < f.pts.length; i++) {
      var a = f.pts[i - 1], b = f.pts[i];
      var ax = (a[1] - fix.lon) * kx, ay = (a[0] - fix.lat) * ky, bx = (b[1] - fix.lon) * kx, by = (b[0] - fix.lat) * ky;
      var dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      var u = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      var ex = ax + u * dx, ey = ay + u * dy, dd = Math.sqrt(ex * ex + ey * ey);
      cand.push([dd, a[2] + u * (b[2] - a[2])]);
      if (dd < best) best = dd;
    }
    // With a last position, any pass within 20 m of the nearest may be
    // the one you are on; without one, only (nearly) the nearest.
    var pick = null, tol = num(prevAlong) ? 20 : 3;
    cand.forEach(function (c) {
      if (c[0] > best + tol) return;
      if (!pick) { pick = c; return; }
      if (num(prevAlong)) { if (Math.abs(c[1] - prevAlong) < Math.abs(pick[1] - prevAlong)) pick = c; }
      else if (c[1] < pick[1]) pick = c;
    });
    return { off: pick[0], along: pick[1] };
  }

  function idxAt(f, along) {
    var lo = 0, hi = f.pts.length - 1;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (f.pts[mid][2] <= along) lo = mid; else hi = mid - 1; }
    return lo;
  }
  // → { left, up, down } still ahead
  function remaining(f, along) {
    var i = idxAt(f, along);
    return { left: Math.max(0, f.total - along), up: Math.max(0, Math.round(f.up - f.cu[i])), down: Math.max(0, Math.round(f.down - f.cd[i])) };
  }

  // st: { off: bool, n } (kept by the caller) → "off" | "back" | ""
  function offTrack(st, off, acc) {
    var lim = 40 + Math.min(num(acc) ? acc : 0, 80) / 2;
    if (!st.off) {
      if (off > lim) { st.n = (st.n || 0) + 1; if (st.n >= 2) { st.off = true; st.n = 0; return "off"; } }
      else st.n = 0;
      return "";
    }
    if (off < 25) { st.off = false; st.n = 0; return "back"; }
    return "";
  }

  // told: { index: true } (kept by the caller) → { w, i, dist } to tell, or null
  function nextWpt(f, along, told) {
    for (var i = 0; i < f.wpts.length; i++) {
      var w = f.wpts[i], dist = w.along - along;
      if (dist < -20 || told[i]) continue;
      if (dist <= 100) { told[i] = true; return { w: w, i: i, dist: Math.max(0, Math.round(dist)) }; }
      return null;
    }
    return null;
  }
  // the next waypoint ahead (to show), or null
  function ahead(f, along) {
    for (var i = 0; i < f.wpts.length; i++) if (f.wpts[i].along > along + 5) return { w: f.wpts[i], dist: Math.round(f.wpts[i].along - along) };
    return null;
  }

  // seconds left; speed = the track's moving speed (m/s), 0 = on foot by DIN 33466
  function eta(rem, speed) {
    if (!rem || !(rem.left > 0)) return 0;
    if (speed > 0) return Math.round(rem.left / speed);
    var h = rem.left / 4000, v = (rem.up || 0) / 300 + (rem.down || 0) / 500;
    return Math.round((Math.max(h, v) + Math.min(h, v) / 2) * 3600);
  }

  // Sunrise and sunset (Date, or null on a polar day / night) for the
  // day of `date` at lat / lon.
  function sunTimes(date, lat, lon) {
    if (!(date instanceof Date) || !num(lat) || !num(lon)) return null;
    var r = Math.PI / 180;
    var J = date.getTime() / 86400000 + 2440587.5;
    var n = Math.round(J - 2451545.0 + 0.0008 - lon / 360);   // the solar noon nearest to `date`
    var Js = n - lon / 360;
    var M = (357.5291 + 0.98560028 * Js) % 360;
    var C = 1.9148 * Math.sin(M * r) + 0.02 * Math.sin(2 * M * r) + 0.0003 * Math.sin(3 * M * r);
    var lam = (M + C + 180 + 102.9372) % 360;
    var Jt = 2451545.0 + Js + 0.0053 * Math.sin(M * r) - 0.0069 * Math.sin(2 * lam * r);
    var sd = Math.sin(lam * r) * Math.sin(23.4397 * r), cdl = Math.cos(Math.asin(sd));
    var cw = (Math.sin(-0.833 * r) - Math.sin(lat * r) * sd) / (Math.cos(lat * r) * cdl);
    if (cw < -1 || cw > 1) return { rise: null, set: null, polar: cw < -1 ? "day" : "night" };
    var w = Math.acos(cw) / r;
    function dt(j) { return new Date((j - 2440587.5) * 86400000); }
    return { rise: dt(Jt - w / 360), set: dt(Jt + w / 360), polar: "" };
  }

  var api = { prepare: prepare, locate: locate, remaining: remaining, offTrack: offTrack, nextWpt: nextWpt, ahead: ahead,
    eta: eta, sunTimes: sunTimes, distM: distM };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosMapsFollow = api;
})(typeof window !== "undefined" ? window : this);
