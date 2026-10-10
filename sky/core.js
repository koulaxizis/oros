// ============================================================
// orOS Moon & Sky — core (v1.0.0)
// Pure astronomy, no DOM, fully offline. Loaded by sky.js
// (window.OrosSkyCore), by calendar/index.html (the "Moon & Sky"
// feed) and by the tests.
//
//   Sun:     Meeus ch. 25 (low accuracy, ~0.01°).
//   Moon:    Meeus ch. 47, main periodic terms (~10″ in longitude).
//   Planets: JPL Keplerian elements (Standish, 1800–2050), ~1′–10′.
//   Phases, equinoxes and solstices: solved from the positions above
//            (phases) and Meeus ch. 27 (seasons), a minute or two.
//   Rise, set and twilights: altitude crossings sampled every 10
//            minutes and refined by bisection.
//   Eclipses: dates and global type from a table (2026–2035); what
//            is seen from the user's place is computed (local
//            magnitude for the Sun, Moon above the horizon for the
//            Moon).
//
// All instants are Unix ms (UTC). "Local day" helpers use the
// device's time zone, like the rest of orOS.
// ============================================================
(function (root) {
  "use strict";

  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  var DAY = 86400000, MIN = 60000;
  var DELTA_T = 69;               // TT − UT in seconds (2020s)
  var AU_KM = 149597870.7;
  var EARTH_KM = 6378.14;

  function sin(d) { return Math.sin(d * D2R); }
  function cos(d) { return Math.cos(d * D2R); }
  function norm360(d) { d %= 360; return d < 0 ? d + 360 : d; }
  function norm180(d) { d = norm360(d); return d > 180 ? d - 360 : d; }
  function atan2d(y, x) { return Math.atan2(y, x) * R2D; }
  function asind(x) { return Math.asin(Math.max(-1, Math.min(1, x))) * R2D; }

  function jdOf(ms) { return ms / DAY + 2440587.5; }
  function msOf(jd) { return (jd - 2440587.5) * DAY; }
  // Julian centuries of Terrestrial Time since J2000.0
  function tOf(ms) { return (jdOf(ms) + DELTA_T / 86400 - 2451545) / 36525; }

  // ---------- Nutation and obliquity (Meeus ch. 22, short form) ----------
  function nutation(T) {
    var om = 125.04452 - 1934.136261 * T;
    var L = 280.4665 + 36000.7698 * T, Lm = 218.3165 + 481267.8813 * T;
    var dpsi = (-17.20 * sin(om) - 1.32 * sin(2 * L) - 0.23 * sin(2 * Lm) + 0.21 * sin(2 * om)) / 3600;
    var deps = (9.20 * cos(om) + 0.57 * cos(2 * L) + 0.10 * cos(2 * Lm) - 0.09 * cos(2 * om)) / 3600;
    var eps0 = 23.4392911 - (46.8150 * T + 0.00059 * T * T - 0.001813 * T * T * T) / 3600;
    return { dpsi: dpsi, eps: eps0 + deps };
  }

  function eclToEq(lon, lat, eps) {
    var ra = atan2d(sin(lon) * cos(eps) - Math.tan(lat * D2R) * sin(eps), cos(lon));
    var dec = asind(sin(lat) * cos(eps) + cos(lat) * sin(eps) * sin(lon));
    return { ra: norm360(ra), dec: dec };
  }

  // J2000 equatorial → equator of date (Meeus 21.4)
  function precess(ra0, dec0, T) {
    var z1 = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) / 3600;
    var z2 = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) / 3600;
    var th = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) / 3600;
    var A = cos(dec0) * sin(ra0 + z1);
    var B = cos(th) * cos(dec0) * cos(ra0 + z1) - sin(th) * sin(dec0);
    var C = sin(th) * cos(dec0) * cos(ra0 + z1) + cos(th) * sin(dec0);
    return { ra: norm360(atan2d(A, B) + z2), dec: asind(C) };
  }

  // ---------- Sun ----------
  function sunPos(ms) {
    var T = tOf(ms);
    var L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
    var M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
    var e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
    var C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M) +
            (0.019993 - 0.000101 * T) * sin(2 * M) + 0.000289 * sin(3 * M);
    var trueLon = L0 + C, nu = M + C;
    var R = 1.000001018 * (1 - e * e) / (1 + e * cos(nu));
    var om = 125.04 - 1934.136 * T;
    var lon = norm360(trueLon - 0.00569 - 0.00478 * sin(om));
    var n = nutation(T);
    var eq = eclToEq(lon, 0, n.eps);
    return { lon: lon, lat: 0, dist: R, ra: eq.ra, dec: eq.dec };
  }

  // ---------- Moon (Meeus ch. 47) ----------
  // D, M, M', F, Σl (1e-6 °), Σr (1e-3 km)
  var MOON_LR = [
    [0,0,1,0,6288774,-20905355],[2,0,-1,0,1274027,-3699111],[2,0,0,0,658314,-2955968],
    [0,0,2,0,213618,-569925],[0,1,0,0,-185116,48888],[0,0,0,2,-114332,-3149],
    [2,0,-2,0,58793,246158],[2,-1,-1,0,57066,-152138],[2,0,1,0,53322,-170733],
    [2,-1,0,0,45758,-204586],[0,1,-1,0,-40923,-129620],[1,0,0,0,-34720,108743],
    [0,1,1,0,-30383,104755],[2,0,0,-2,15327,10321],[0,0,1,2,-12528,0],
    [0,0,1,-2,10980,79661],[4,0,-1,0,10675,-34782],[0,0,3,0,10034,-23210],
    [4,0,-2,0,8548,-21636],[2,1,-1,0,-7888,24208],[2,1,0,0,-6766,30824],
    [1,0,-1,0,-5163,-8379],[1,1,0,0,4987,-16675],[2,-1,1,0,4036,-12831],
    [2,0,2,0,3994,-10445],[4,0,0,0,3861,-11650],[2,0,-3,0,3665,14403],
    [0,1,-2,0,-2689,-7003],[2,0,-1,2,-2602,0],[2,-1,-2,0,2390,10056],
    [1,0,1,0,-2348,6322],[2,-2,0,0,2236,-9884],[0,1,2,0,-2120,5751],
    [0,2,0,0,-2069,0],[2,-2,-1,0,2048,-4950],[2,0,1,-2,-1773,4130],
    [2,0,0,2,-1595,0],[4,-1,-1,0,1215,-3958],[0,0,2,2,-1110,0],
    [3,0,-1,0,-892,3258],[2,1,1,0,-810,2616],[4,-1,-2,0,759,-1897],
    [0,2,-1,0,-713,-2117],[2,2,-1,0,-700,2354],[2,1,-2,0,691,0],
    [2,-1,0,-2,596,0],[4,0,1,0,549,-1423],[0,0,4,0,537,-1117],
    [4,-1,0,0,520,-1571],[1,0,-2,0,-487,-1739],[2,1,0,-2,-399,0],
    [0,0,2,-2,-381,-4421],[1,1,1,0,351,0],[3,0,-2,0,-340,0],
    [4,0,-3,0,330,0],[2,-1,2,0,327,0],[0,2,1,0,-323,1165],
    [1,1,-1,0,299,0],[2,0,3,0,294,0],[2,0,-1,-2,0,8752]
  ];
  // D, M, M', F, Σb (1e-6 °)
  var MOON_B = [
    [0,0,0,1,5128122],[0,0,1,1,280602],[0,0,1,-1,277693],[2,0,0,-1,173237],
    [2,0,-1,1,55413],[2,0,-1,-1,46271],[2,0,0,1,32573],[0,0,2,1,17198],
    [2,0,1,-1,9266],[0,0,2,-1,8822],[2,-1,0,-1,8216],[2,0,-2,-1,4324],
    [2,0,1,1,4200],[2,1,0,-1,-3359],[2,-1,-1,1,2463],[2,-1,0,1,2211],
    [2,-1,-1,-1,2065],[0,1,-1,-1,-1870],[4,0,-1,-1,1828],[0,1,0,1,-1794],
    [0,0,0,3,-1749],[0,1,-1,1,-1565],[1,0,0,1,-1491],[0,1,1,1,-1475],
    [0,1,1,-1,-1410],[0,1,0,-1,-1344],[1,0,0,-1,-1335],[0,0,3,1,1107],
    [4,0,0,-1,1021],[4,0,-1,1,833]
  ];

  function moonPos(ms) {
    var T = tOf(ms), T2 = T * T, T3 = T2 * T, T4 = T3 * T;
    var Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000;
    var D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000;
    var M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000;
    var Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000;
    var F = 93.2720950 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000;
    var A1 = 119.75 + 131.849 * T, A2 = 53.09 + 479264.290 * T, A3 = 313.45 + 481266.484 * T;
    var E = 1 - 0.002516 * T - 0.0000074 * T2;
    var sl = 0, sr = 0, sb = 0, i, r, arg, ef;
    for (i = 0; i < MOON_LR.length; i++) {
      r = MOON_LR[i];
      arg = r[0] * D + r[1] * M + r[2] * Mp + r[3] * F;
      ef = r[1] === 0 ? 1 : (Math.abs(r[1]) === 1 ? E : E * E);
      sl += r[4] * ef * sin(arg);
      sr += r[5] * ef * cos(arg);
    }
    for (i = 0; i < MOON_B.length; i++) {
      r = MOON_B[i];
      arg = r[0] * D + r[1] * M + r[2] * Mp + r[3] * F;
      ef = r[1] === 0 ? 1 : (Math.abs(r[1]) === 1 ? E : E * E);
      sb += r[4] * ef * sin(arg);
    }
    sl += 3958 * sin(A1) + 1962 * sin(Lp - F) + 318 * sin(A2);
    sb += -2235 * sin(Lp) + 382 * sin(A3) + 175 * sin(A1 - F) + 175 * sin(A1 + F) +
          127 * sin(Lp - Mp) - 115 * sin(Lp + Mp);
    var n = nutation(T);
    var lon = norm360(Lp + sl / 1e6 + n.dpsi);
    var lat = sb / 1e6;
    var dist = 385000.56 + sr / 1000;
    var eq = eclToEq(lon, lat, n.eps);
    return { lon: lon, lat: lat, dist: dist, ra: eq.ra, dec: eq.dec,
             parallax: asind(EARTH_KM / dist) };
  }

  // ---------- Planets (JPL approximate elements, J2000 ecliptic) ----------
  // a, e, I, L, long.peri, long.node  and their rates per century
  var ELEM = {
    mercury: [[0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
              [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
    venus:   [[0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
              [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418]],
    earth:   [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
              [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]],
    mars:    [[1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
              [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
    jupiter: [[5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
              [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
    saturn:  [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
              [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]]
  };
  var PLANETS = ["mercury", "venus", "mars", "jupiter", "saturn"];

  function helio(name, T) {
    var el = ELEM[name], b = el[0], rt = el[1], k = [];
    for (var i = 0; i < 6; i++) k[i] = b[i] + rt[i] * T;
    var a = k[0], e = k[1], I = k[2], L = k[3], wb = k[4], om = k[5];
    var w = wb - om, M = norm180(L - wb);
    var Er = M * D2R + e * Math.sin(M * D2R);
    for (var j = 0; j < 8; j++) {
      Er -= (Er - e * Math.sin(Er) - M * D2R) / (1 - e * Math.cos(Er));
    }
    var xp = a * (Math.cos(Er) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(Er);
    var cw = cos(w), sw = sin(w), co = cos(om), so = sin(om), ci = cos(I), si = sin(I);
    return {
      x: (cw * co - sw * so * ci) * xp + (-sw * co - cw * so * ci) * yp,
      y: (cw * so + sw * co * ci) * xp + (-sw * so + cw * co * ci) * yp,
      z: (sw * si) * xp + (cw * si) * yp
    };
  }

  function planetPos(name, ms) {
    var T = tOf(ms);
    var ea = helio("earth", T), p = helio(name, T), dx, dy, dz, dist = 0;
    for (var it = 0; it < 2; it++) {              // light time
      var Tl = T - dist * 0.0057755183 / 36525;
      p = helio(name, Tl);
      dx = p.x - ea.x; dy = p.y - ea.y; dz = p.z - ea.z;
      dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    var lon = norm360(atan2d(dy, dx)), lat = asind(dz / dist);
    var eq0 = eclToEq(lon, lat, 23.4392911);       // J2000 equator
    var eq = precess(eq0.ra, eq0.dec, T);
    var r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
    var R = Math.sqrt(ea.x * ea.x + ea.y * ea.y + ea.z * ea.z);
    var ph = Math.acos(Math.max(-1, Math.min(1, (r * r + dist * dist - R * R) / (2 * r * dist)))) * R2D;
    var s = sunPos(ms);
    var elong = Math.acos(Math.max(-1, Math.min(1,
      sin(s.dec) * sin(eq.dec) + cos(s.dec) * cos(eq.dec) * cos(s.ra - eq.ra)))) * R2D;
    var mag = planetMag(name, r, dist, ph);
    if (name === "saturn") {              // the rings (Meeus ch. 41, 45)
      var ri = 28.075216 - 0.012998 * T, rom = 169.508470 + 1.394681 * T;
      var sB = sin(ri) * cos(lat) * sin(lon - rom) - cos(ri) * sin(lat);
      mag += -2.60 * Math.abs(sB) + 1.25 * sB * sB;
    }
    return { ra: eq.ra, dec: eq.dec, dist: dist, r: r, phase: ph, elong: elong, mag: mag };
  }

  function planetMag(name, r, d, i) {
    var l = 5 * Math.log(r * d) / Math.LN10;
    switch (name) {
      case "mercury": return -0.42 + l + 0.0380 * i - 0.000273 * i * i + 0.000002 * i * i * i;
      case "venus":   return -4.40 + l + 0.0009 * i + 0.000239 * i * i - 0.00000065 * i * i * i;
      case "mars":    return -1.52 + l + 0.016 * i;
      case "jupiter": return -9.40 + l + 0.005 * i;
      case "saturn":  return -8.68 + l + 0.044 * i;   // + rings, in planetPos
    }
    return 99;
  }

  // ---------- Observer ----------
  function gmst(ms) {
    var jd = jdOf(ms), T = (jd - 2451545) / 36525;
    return norm360(280.46061837 + 360.98564736629 * (jd - 2451545) +
                   0.000387933 * T * T - T * T * T / 38710000);
  }
  function altAz(ra, dec, ms, lat, lon) {
    var H = gmst(ms) + lon - ra;
    var alt = asind(sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(H));
    var az = norm360(atan2d(sin(H), cos(H) * sin(lat) - Math.tan(dec * D2R) * cos(lat)) + 180);
    return { alt: alt, az: az, ha: norm180(H) };
  }
  // Moon as seen from the observer (topocentric, Meeus ch. 40 with a
  // spherical Earth: good to a few arcseconds for our purposes).
  function moonTopo(ms, lat, lon) {
    var m = moonPos(ms);
    var H = gmst(ms) + lon - m.ra, sp = EARTH_KM / m.dist;
    var A = cos(m.dec) * sin(H);
    var B = cos(m.dec) * cos(H) - cos(lat) * sp;
    var C = sin(m.dec) - sin(lat) * sp;
    var q = Math.sqrt(A * A + B * B + C * C);
    var ra = norm360(gmst(ms) + lon - atan2d(A, B));
    return { ra: ra, dec: asind(C / q), dist: m.dist * q, lon: m.lon, lat: m.lat,
             parallax: m.parallax };
  }

  // Altitude including standard refraction near the horizon (Bennett).
  function refract(alt) {
    if (alt < -1.9) return alt;
    return alt + 1.02 / Math.tan((alt + 10.3 / (alt + 5.11)) * D2R) / 60;
  }

  function sunAlt(ms, lat, lon) { var s = sunPos(ms); return altAz(s.ra, s.dec, ms, lat, lon).alt; }

  // ---------- Crossings ----------
  // All instants in [t0, t1] where f crosses 0; up = rising.
  function crossings(f, t0, t1, step) {
    step = step || 10 * MIN;
    var out = [], ta = t0, fa = f(t0);
    while (ta < t1) {
      var tb = Math.min(t1, ta + step), fb = f(tb);
      if ((fa < 0) !== (fb < 0)) {
        var lo = ta, hi = tb, flo = fa;
        while (hi - lo > 5000) {
          var mid = (lo + hi) / 2, fm = f(mid);
          if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid;
        }
        out.push({ t: Math.round((lo + hi) / 2), up: fa < 0 });
      }
      ta = tb; fa = fb;
    }
    return out;
  }
  function firstOf(list, up) {
    for (var i = 0; i < list.length; i++) if (list[i].up === up) return list[i].t;
    return null;
  }

  function localMidnight(y, m, d) { return new Date(y, m, d).getTime(); }
  function dayStartOf(ms) { var d = new Date(ms); return localMidnight(d.getFullYear(), d.getMonth(), d.getDate()); }
  function nextDayStart(ms) { var d = new Date(ms); return localMidnight(d.getFullYear(), d.getMonth(), d.getDate() + 1); }
  function dateStr(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1) + "-" +
           (d.getDate() < 10 ? "0" : "") + d.getDate();
  }
  function parseDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
    if (!m) return null;
    var t = localMidnight(+m[1], +m[2] - 1, +m[3]);
    return dateStr(t) === s ? t : null;
  }

  // Sun for one local day: rise, set, noon; and for the night that
  // follows (evening of this day → morning of the next): twilights,
  // golden and blue hours.
  function sunDay(dayMs, lat, lon) {
    var t0 = dayStartOf(dayMs), t1 = nextDayStart(t0);
    var f = function (h) { return function (t) { return sunAlt(t, lat, lon) - h; }; };
    var rs = crossings(f(-0.833), t0, t1);
    var noon = null, best = -99;
    for (var t = t0; t <= t1; t += 10 * MIN) {
      var a = sunAlt(t, lat, lon);
      if (a > best) { best = a; noon = t; }
    }
    // refine noon (maximum) by golden-section-like scan
    for (var stepN = 5 * MIN; stepN >= 5000; stepN /= 4) {
      var bt = noon, ba = sunAlt(noon, lat, lon);
      for (var k = -4; k <= 4; k++) {
        var tt = noon + k * stepN, aa = sunAlt(tt, lat, lon);
        if (aa > ba) { ba = aa; bt = tt; }
      }
      noon = bt;
    }
    var maxAlt = sunAlt(noon, lat, lon);
    var minAlt = 99;
    for (t = t0; t <= t1; t += 20 * MIN) minAlt = Math.min(minAlt, sunAlt(t, lat, lon));
    var out = {
      rise: firstOf(rs, true), set: firstOf(rs, false), noon: noon,
      maxAlt: maxAlt,
      polar: rs.length ? null : (maxAlt > -0.833 ? "day" : "night")
    };
    // Morning events of this day (00:00 → noon) and evening events (noon → 24:00)
    function ev(h, up, from, to) { return firstOf(crossings(f(h), from, to), up); }
    out.civilDawn = ev(-6, true, t0, noon);   out.civilDusk = ev(-6, false, noon, t1);
    out.nautDawn = ev(-12, true, t0, noon);   out.nautDusk = ev(-12, false, noon, t1);
    out.astroDawn = ev(-18, true, t0, noon);  out.astroDusk = ev(-18, false, noon, t1);
    // golden hour: sun between −4° and +6°; blue hour: −6° to −4°
    var g6am = ev(6, true, t0, noon), g4am = ev(-4, true, t0, noon);
    var g6pm = ev(6, false, noon, t1), g4pm = ev(-4, false, noon, t1);
    out.goldenAm = (g4am && g6am) ? [g4am, g6am] : null;
    out.goldenPm = (g6pm && g4pm) ? [g6pm, g4pm] : null;
    out.blueAm = (out.civilDawn && g4am) ? [out.civilDawn, g4am] : null;
    out.bluePm = (g4pm && out.civilDusk) ? [g4pm, out.civilDusk] : null;
    out.dayLength = (out.rise && out.set) ? out.set - out.rise
                  : (out.polar === "day" ? DAY : (out.polar === "night" ? 0 : null));
    return out;
  }

  function moonAltGeoMinusH0(t, lat, lon) {
    var m = moonPos(t);
    // h0 = 0.7275π − 0.5667° (parallax, refraction and semi-diameter)
    return altAz(m.ra, m.dec, t, lat, lon).alt - (0.7275 * m.parallax - 0.5667);
  }
  function moonDay(dayMs, lat, lon) {
    var t0 = dayStartOf(dayMs), t1 = nextDayStart(t0);
    var cs = crossings(function (t) { return moonAltGeoMinusH0(t, lat, lon); }, t0, t1);
    return { rise: firstOf(cs, true), set: firstOf(cs, false),
             up: moonAltGeoMinusH0(t0, lat, lon) > 0 };
  }

  // ---------- Moon phase ----------
  var SYNODIC = 29.530588853;
  function elongation(ms) { return norm360(moonPos(ms).lon - sunPos(ms).lon); }
  function moonPhase(ms) {
    var m = moonPos(ms), s = sunPos(ms);
    var el = norm360(m.lon - s.lon);
    var psi = Math.acos(Math.max(-1, Math.min(1, cos(m.lat) * cos(m.lon - s.lon)))) * R2D;
    var R = s.dist * AU_KM;
    var i = atan2d(R * sin(psi), m.dist - R * cos(psi));
    var illum = (1 + cos(i)) / 2;
    // position angle of the bright limb (Meeus 48.5), from celestial north
    var chi = norm360(atan2d(cos(s.dec) * sin(s.ra - m.ra),
      sin(s.dec) * cos(m.dec) - cos(s.dec) * sin(m.dec) * cos(s.ra - m.ra)));
    var prevNew = phaseNear(ms - el / 360 * SYNODIC * DAY, 0);
    if (prevNew > ms) prevNew = phaseNear(prevNew - SYNODIC * DAY, 0);
    return {
      illum: illum, elong: el, waxing: el < 180, chi: chi,
      age: (ms - prevNew) / DAY,
      idx: phaseIndex(el), dist: m.dist
    };
  }
  // 0 new, 1 waxing crescent, 2 first quarter, 3 waxing gibbous,
  // 4 full, 5 waning gibbous, 6 last quarter, 7 waning crescent.
  // The four main phases get a ±1 day window (12.2° of elongation).
  function phaseIndex(el) {
    var w = 6.1;
    if (el < w || el > 360 - w) return 0;
    if (Math.abs(el - 90) < w) return 2;
    if (Math.abs(el - 180) < w) return 4;
    if (Math.abs(el - 270) < w) return 6;
    if (el < 90) return 1;
    if (el < 180) return 3;
    if (el < 270) return 5;
    return 7;
  }
  // Exact instant where elongation = q·90°, near guess ms.
  function phaseNear(guess, q) {
    var t = guess, target = q * 90;
    for (var i = 0; i < 12; i++) {
      var d = norm180(elongation(t) - target);
      t -= d / 12.190749 * DAY;
      if (Math.abs(d) < 1e-6) break;
    }
    return Math.round(t);
  }
  // Main phases in [from, to): [{ q: 0..3, t }]
  function phasesBetween(from, to) {
    var out = [];
    var el = elongation(from);
    var q = Math.ceil(el / 90 - 1e-9) % 4;
    var t = from + norm360(q * 90 - el) / 360 * SYNODIC * DAY;
    for (var guard = 0; guard < 200; guard++) {
      var exact = phaseNear(t, q);
      if (exact >= to) break;
      if (exact >= from && (!out.length || exact - out[out.length - 1].t > DAY)) out.push({ q: q, t: exact });
      q = (q + 1) % 4;
      t = exact + SYNODIC / 4 * DAY;
    }
    return out;
  }
  function nextPhase(ms, q) {
    var list = phasesBetween(ms, ms + 31 * DAY);
    for (var i = 0; i < list.length; i++) if (list[i].q === q) return list[i].t;
    return null;
  }

  // ---------- Equinoxes and solstices (Meeus ch. 27) ----------
  var SEASON_TERMS = [
    [485,324.96,1934.136],[203,337.23,32964.467],[199,342.08,20.186],[182,27.85,445267.112],
    [156,73.14,45036.886],[136,171.52,22518.443],[77,222.54,65928.934],[74,296.72,3034.906],
    [70,243.58,9037.513],[58,119.81,33718.147],[52,297.17,150.678],[50,21.02,2281.226],
    [45,247.54,29929.562],[44,325.15,31555.956],[29,60.93,4443.417],[18,155.12,67555.328],
    [17,288.79,4562.452],[16,198.04,62894.029],[14,199.76,31436.921],[12,95.39,14577.848],
    [12,287.11,31931.756],[12,320.81,34777.259],[9,227.73,1222.114],[8,15.45,16859.074]
  ];
  var SEASON_BASE = [
    [2451623.80984, 365242.37404, 0.05169, -0.00411, -0.00057],
    [2451716.56767, 365241.62603, 0.00325, 0.00888, -0.00030],
    [2451810.21715, 365242.01767, -0.11575, 0.00337, 0.00078],
    [2451900.05952, 365242.74049, -0.06223, -0.00823, 0.00032]
  ];
  // q: 0 March equinox, 1 June solstice, 2 September equinox, 3 December solstice
  function season(year, q) {
    var Y = (year - 2000) / 1000, b = SEASON_BASE[q];
    var jde0 = b[0] + b[1] * Y + b[2] * Y * Y + b[3] * Y * Y * Y + b[4] * Y * Y * Y * Y;
    var T = (jde0 - 2451545) / 36525;
    var W = 35999.373 * T - 2.47;
    var dl = 1 + 0.0334 * cos(W) + 0.0007 * cos(2 * W);
    var S = 0;
    for (var i = 0; i < SEASON_TERMS.length; i++) {
      var r = SEASON_TERMS[i];
      S += r[0] * cos(r[1] + r[2] * T);
    }
    var jde = jde0 + 0.00001 * S / dl;
    return Math.round(msOf(jde) - DELTA_T * 1000);
  }

  // ---------- Meteor showers (peak night, IMO working list) ----------
  // id, month (0-based), day of peak, ZHR, radiant RA, radiant Dec
  var SHOWERS = [
    ["qua", 0, 3, 110, 230, 49], ["lyr", 3, 22, 18, 271, 34], ["eta", 4, 6, 50, 338, -1],
    ["sda", 6, 30, 25, 340, -16], ["per", 7, 12, 100, 48, 58], ["dra", 9, 8, 10, 262, 54],
    ["ori", 9, 21, 20, 95, 16], ["leo", 10, 17, 15, 152, 22], ["gem", 11, 14, 150, 112, 33],
    ["urs", 11, 22, 10, 217, 76]
  ];
  function showersOf(year) {
    return SHOWERS.map(function (s) {
      return { id: s[0], t: localMidnight(year, s[1], s[2]), zhr: s[3], ra: s[4], dec: s[5] };
    });
  }
  // Radiant reaches at least 20° before dawn on the peak night?
  function showerVisible(sh, lat, lon) {
    var t0 = sh.t + 18 * 3600000, best = -90;
    for (var t = t0; t <= t0 + 12 * 3600000; t += 20 * MIN) {
      if (sunAlt(t, lat, lon) > -12) continue;
      best = Math.max(best, altAz(sh.ra, sh.dec, t, lat, lon).alt);
    }
    return best >= 20;
  }

  // ---------- Eclipses 2026–2035 ----------
  // [kind "s"|"l", type, UTC of greatest eclipse]
  // s: total, annular, hybrid, partial · l: total, partial, penumbral
  var ECLIPSES = [
    ["s","annular","2026-02-17T12:12"], ["l","total","2026-03-03T11:33"],
    ["s","total","2026-08-12T17:46"],   ["l","partial","2026-08-28T04:13"],
    ["s","annular","2027-02-06T16:00"], ["l","penumbral","2027-02-20T23:13"],
    ["l","penumbral","2027-07-18T16:03"], ["s","total","2027-08-02T10:07"],
    ["l","penumbral","2027-08-17T07:14"], ["l","partial","2028-01-12T04:13"],
    ["s","annular","2028-01-26T15:08"], ["l","partial","2028-07-06T18:20"],
    ["s","total","2028-07-22T02:56"],   ["l","total","2028-12-31T16:52"],
    ["s","partial","2029-01-14T17:13"], ["s","partial","2029-06-12T04:06"],
    ["l","total","2029-06-26T03:22"],   ["s","partial","2029-07-11T15:37"],
    ["s","partial","2029-12-05T15:03"], ["l","total","2029-12-20T22:42"],
    ["s","annular","2030-06-01T06:29"], ["l","partial","2030-06-15T18:33"],
    ["s","total","2030-11-25T06:51"],   ["l","penumbral","2030-12-09T22:28"],
    ["l","penumbral","2031-05-07T03:51"], ["s","annular","2031-05-21T07:16"],
    ["l","penumbral","2031-06-05T11:44"], ["l","penumbral","2031-10-30T07:45"],
    ["s","hybrid","2031-11-14T21:07"],  ["l","total","2032-04-25T15:13"],
    ["s","annular","2032-05-09T13:26"], ["l","total","2032-10-18T19:02"],
    ["s","partial","2032-11-03T05:34"], ["s","total","2033-03-30T18:02"],
    ["l","total","2033-04-14T19:13"],   ["s","partial","2033-09-23T13:54"],
    ["l","total","2033-10-08T10:55"],   ["s","total","2034-03-20T10:18"],
    ["l","penumbral","2034-04-03T19:05"], ["s","annular","2034-09-12T16:19"],
    ["l","partial","2034-09-28T02:46"], ["s","annular","2035-03-09T23:05"],
    ["l","penumbral","2035-02-22T09:05"], ["l","partial","2035-08-19T01:11"],
    ["s","total","2035-09-02T01:56"]
  ];
  function eclipseList() {
    return ECLIPSES.map(function (e) {
      return { kind: e[0], type: e[1], t: Date.parse(e[2] + ":00Z") };
    }).sort(function (a, b) { return a.t - b.t; });
  }

  // Lunar eclipse geometry at instant ms: Moon's distance from the
  // shadow axis vs. the umbra and penumbra (Meeus ch. 54, ×1.02).
  function lunarShadow(ms) {
    var m = moonPos(ms), s = sunPos(ms);
    var aRa = norm360(s.ra + 180), aDec = -s.dec;
    var sep = Math.acos(Math.max(-1, Math.min(1,
      sin(aDec) * sin(m.dec) + cos(aDec) * cos(m.dec) * cos(aRa - m.ra)))) * R2D;
    var pm = m.parallax, ps = 8.794 / 3600 / s.dist, ss = 0.2666 / s.dist;
    var sm = 0.2725 * pm;
    var umbra = 1.02 * (pm + ps - ss), pen = 1.02 * (pm + ps + ss);
    var type = sep < umbra - sm ? "total" : (sep < umbra + sm ? "partial" : (sep < pen + sm ? "penumbral" : null));
    return { sep: sep, umbra: umbra, pen: pen, sm: sm, type: type,
             umag: (umbra + sm - sep) / (2 * sm) };
  }

  // What the user sees of an eclipse.
  //   lunar: { visible, atMax, alt } — the Moon is above the horizon during
  //          some of the eclipse (umbral phases; the penumbral ones for a
  //          penumbral eclipse); atMax: also at greatest eclipse
  //   solar: { visible, mag, t } — largest local magnitude (fraction of the
  //          Sun's diameter covered) while the Sun is up, scanning ±3 h.
  function eclipseLocal(ecl, lat, lon) {
    if (ecl.kind === "l") {
      var moonUp = function (tm) {
        var mp = moonPos(tm);
        return altAz(mp.ra, mp.dec, tm, lat, lon).alt - mp.parallax;
      };
      var alt = moonUp(ecl.t), seen = alt > -0.5;
      for (var tl = ecl.t - 4 * 3600000; !seen && tl <= ecl.t + 4 * 3600000; tl += 5 * MIN) {
        var sh = lunarShadow(tl);
        var inIt = ecl.type === "penumbral" ? !!sh.type : (sh.type === "partial" || sh.type === "total");
        if (inIt && moonUp(tl) > -0.5) seen = true;
      }
      return { visible: seen, atMax: alt > -0.5, alt: alt };
    }
    var best = 0, bestT = null;
    for (var t = ecl.t - 3 * 3600000; t <= ecl.t + 3 * 3600000; t += 2 * MIN) {
      var s = sunPos(t);
      if (altAz(s.ra, s.dec, t, lat, lon).alt < -0.5) continue;
      var mt = moonTopo(t, lat, lon);
      var sep = Math.acos(Math.max(-1, Math.min(1,
        sin(s.dec) * sin(mt.dec) + cos(s.dec) * cos(mt.dec) * cos(s.ra - mt.ra)))) * R2D;
      var rs = 0.2666 / s.dist, rm = asind(0.2725 * EARTH_KM / mt.dist);
      var mag = (rs + rm - sep) / (2 * rs);
      if (mag > best) { best = mag; bestT = t; }
    }
    return { visible: best > 0.005, mag: Math.min(best, 1.1), t: bestT };
  }

  // ---------- Events of a period ----------
  // [{ t, kind: "phase"|"season"|"shower"|"eclipse", ... }] in [from, to)
  function eventsBetween(from, to, opts) {
    opts = opts || {};
    var out = [];
    phasesBetween(from, to).forEach(function (p) {
      var e = { t: p.t, kind: "phase", q: p.q };
      // A full moon closer than 360 000 km counts as a supermoon.
      if (p.q === 2 && moonPos(p.t).dist < 360000) e.supermoon = true;
      out.push(e);
    });
    var y0 = new Date(from).getFullYear(), y1 = new Date(to).getFullYear();
    for (var y = y0; y <= y1; y++) {
      for (var q = 0; q < 4; q++) {
        var ts = season(y, q);
        if (ts >= from && ts < to) out.push({ t: ts, kind: "season", q: q });
      }
      showersOf(y).forEach(function (s) {
        if (s.t >= from && s.t < to) {
          var e = { t: s.t, kind: "shower", id: s.id, zhr: s.zhr, allDay: true };
          if (opts.lat != null) {
            e.visible = showerVisible(s, opts.lat, opts.lon);
            e.moon = moonPhase(s.t + 26 * 3600000).illum;
          }
          out.push(e);
        }
      });
    }
    eclipseList().forEach(function (ec) {
      if (ec.t >= from && ec.t < to) {
        var e = { t: ec.t, kind: "eclipse", ekind: ec.kind, type: ec.type };
        if (opts.lat != null) e.local = eclipseLocal(ec, opts.lat, opts.lon);
        out.push(e);
      }
    });
    return out.sort(function (a, b) { return a.t - b.t; });
  }

  // ---------- Calendar feed ----------
  // Rows for one local date "YYYY-MM-DD": main phases, equinoxes and
  // solstices, meteor shower peaks, eclipses. Labels are resolved by
  // the caller (lang) so the Calendar shows them in its own language.
  var FEED_TXT = {
    en: { q0: "New moon", q1: "First quarter", q2: "Full moon", q3: "Last quarter",
          s0: "March equinox", s1: "June solstice", s2: "September equinox", s3: "December solstice",
          super: "Supermoon", shower: "{name} meteor shower peak",
          es: "Solar eclipse ({type})", el: "Lunar eclipse ({type})",
          total: "total", annular: "annular", hybrid: "hybrid", partial: "partial", penumbral: "penumbral",
          qua: "Quadrantids", lyr: "Lyrids", eta: "Eta Aquariids", sda: "Southern Delta Aquariids",
          per: "Perseids", dra: "Draconids", ori: "Orionids", leo: "Leonids", gem: "Geminids", urs: "Ursids" },
    el: { q0: "Νέα Σελήνη", q1: "Πρώτο τέταρτο", q2: "Πανσέληνος", q3: "Τελευταίο τέταρτο",
          s0: "Εαρινή ισημερία", s1: "Θερινό ηλιοστάσιο", s2: "Φθινοπωρινή ισημερία", s3: "Χειμερινό ηλιοστάσιο",
          super: "Υπερπανσέληνος", shower: "Κορύφωση: {name}",
          es: "Έκλειψη Ηλίου ({type})", el: "Έκλειψη Σελήνης ({type})",
          total: "ολική", annular: "δακτυλιοειδής", hybrid: "υβριδική", partial: "μερική", penumbral: "παρασκιά",
          qua: "Τεταρτημορίδες", lyr: "Λυρίδες", eta: "Ήτα Υδροχοΐδες", sda: "Νότιες Δέλτα Υδροχοΐδες",
          per: "Περσείδες", dra: "Δρακονίδες", ori: "Ωριωνίδες", leo: "Λεοντίδες", gem: "Διδυμίδες", urs: "Αρκτίδες" }
  };
  function feedText(lang, key) {
    var T = FEED_TXT[lang] || FEED_TXT.en;
    return T[key] !== undefined ? T[key] : FEED_TXT.en[key];
  }
  // Main phase q (0 new, 1 first quarter, 2 full, 3 last) as a word
  function eventTitle(e, lang) {
    if (e.kind === "phase") {
      var s = feedText(lang, "q" + e.q);
      return e.supermoon ? s + " · " + feedText(lang, "super") : s;
    }
    if (e.kind === "season") return feedText(lang, "s" + e.q);
    if (e.kind === "shower") return feedText(lang, "shower").replace("{name}", feedText(lang, e.id));
    if (e.kind === "eclipse") return feedText(lang, e.ekind === "s" ? "es" : "el").replace("{type}", feedText(lang, e.type));
    return "";
  }
  var feedCache = { key: "", list: null };
  function feedFor(dateS, lang) {
    var t0 = parseDate(dateS);
    if (t0 == null) return [];
    var d = new Date(t0);
    var mKey = d.getFullYear() + "-" + d.getMonth();
    if (feedCache.key !== mKey) {
      var from = localMidnight(d.getFullYear(), d.getMonth(), 1);
      var to = localMidnight(d.getFullYear(), d.getMonth() + 1, 1);
      feedCache = { key: mKey, list: eventsBetween(from, to) };
    }
    var t1 = nextDayStart(t0);
    return feedCache.list.filter(function (e) { return e.t >= t0 && e.t < t1; }).map(function (e) {
      return { t: e.t, allDay: !!e.allDay, kind: e.kind, title: eventTitle(e, lang) };
    });
  }

  // ---------- Misc ----------
  // Compass point of an azimuth: 0 N, 1 NE, … 7 NW
  function compass8(az) { return Math.round(norm360(az) / 45) % 8; }

  var api = {
    D2R: D2R, DAY: DAY, SYNODIC: SYNODIC, PLANETS: PLANETS,
    jdOf: jdOf, msOf: msOf, tOf: tOf, norm360: norm360, norm180: norm180,
    sunPos: sunPos, moonPos: moonPos, moonTopo: moonTopo, planetPos: planetPos,
    precess: precess, gmst: gmst, altAz: altAz, refract: refract, sunAlt: sunAlt,
    crossings: crossings, sunDay: sunDay, moonDay: moonDay,
    moonPhase: moonPhase, phaseIndex: phaseIndex, phaseNear: phaseNear,
    phasesBetween: phasesBetween, nextPhase: nextPhase,
    season: season, showersOf: showersOf, showerVisible: showerVisible,
    eclipseList: eclipseList, lunarShadow: lunarShadow, eclipseLocal: eclipseLocal,
    eventsBetween: eventsBetween, eventTitle: eventTitle, feedFor: feedFor, feedText: feedText,
    dayStartOf: dayStartOf, nextDayStart: nextDayStart, dateStr: dateStr, parseDate: parseDate,
    localMidnight: localMidnight, compass8: compass8
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosSkyCore = api;
})(typeof window !== "undefined" ? window : this);
