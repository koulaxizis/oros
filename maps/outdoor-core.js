// ============================================================
// orOS Maps — outdoor-core.js (hiking and cycling routes, wave H2, v1.0.0)
//
// Walk and Bike routes from BRouter (free, open source, knows the
// climbs, the path kinds and the surfaces), turned into the same
// shape as an OSRM route so the route bar, Directions and spoken
// navigation work unchanged:
//   { distance, duration, geometry: { type, coordinates [[lon, lat]] },
//     legs: [{ steps: [OSRM-like step] }], outdoor: { … } }
// `outdoor` adds what OSRM has not: the elevation profile, the climb
// and descent, and how much of the route runs on each surface and
// each kind of way (OsmAnd's route analysis).
//
// Walking time follows the DIN 33466 hiking rule (4 km/h on the flat,
// 300 m/h up, 500 m/h down: the larger part plus half the smaller), so
// a climb counts; bike time is BRouter's own.
// No DOM, no network: tested in tests/maps-outdoor.test.js.
// ============================================================
(function (root) {
  "use strict";

  // Kinds per mode, in menu order. brf = the BRouter profile; null =
  // the standard OSRM router (what Maps used before this wave).
  var PROFILES = {
    foot: [{ id: "hiking", brf: "hiking-mountain" }, { id: "std", brf: null }],
    bike: [{ id: "trekking", brf: "trekking" }, { id: "road", brf: "fastbike" }, { id: "quiet", brf: "fastbike-verylowtraffic" },
      { id: "gravel", brf: "gravel" }, { id: "mtb", brf: "mtb" }, { id: "std", brf: null }]
  };
  var DEFAULT = { foot: "hiking", bike: "trekking" };
  var BASE = "https://brouter.de/brouter";

  function kindOf(mode, id) {
    var list = PROFILES[mode];
    if (!list) return null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return kindOf(mode, DEFAULT[mode]);
  }
  function num(x) { return typeof x === "number" && isFinite(x); }

  // A base the person typed: https only (http only for their own
  // computer), no query, no credentials. "" = the default server.
  function cleanBase(s) {
    s = String(s || "").trim().replace(/\/+$/, "");
    if (!s) return "";
    var m = s.match(/^(https:\/\/[a-z0-9.-]+(:\d{1,5})?|http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?)(\/[A-Za-z0-9._~\/-]*)?$/i);
    return m ? s : null;
  }

  function routeUrl(base, brf, pts) {
    var ok = (pts || []).filter(function (p) { return p && num(p.lat) && num(p.lon); });
    if (!brf || ok.length < 2 || !/^[a-z0-9-]+$/.test(brf)) return "";
    return (base || BASE) + "?lonlats=" + ok.map(function (p) { return (+p.lon).toFixed(6) + "," + (+p.lat).toFixed(6); }).join("%7C") +
      "&profile=" + brf + "&alternativeidx=0&format=geojson&timode=3";
  }

  function rad(x) { return x * Math.PI / 180; }
  function hav(a, b) {   // [lon, lat]
    var dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * 6371000 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  // DIN 33466 walking time in seconds.
  function hikeTime(dist, up, down) {
    var h = (dist || 0) / 4000, v = (up || 0) / 300 + (down || 0) / 500;
    return Math.round((Math.max(h, v) + Math.min(h, v) / 2) * 3600);
  }

  // Climb and descent with a 5 m hysteresis, so GPS-like noise in the
  // elevation model does not add up.
  function climb(eles) {
    var up = 0, down = 0, ref = null, lo = Infinity, hi = -Infinity;
    (eles || []).forEach(function (e) {
      if (!num(e)) return;
      if (e < lo) lo = e;
      if (e > hi) hi = e;
      if (ref === null) { ref = e; return; }
      if (e - ref >= 5) { up += e - ref; ref = e; }
      else if (ref - e >= 5) { down += ref - e; ref = e; }
    });
    return { up: Math.round(up), down: Math.round(down), min: lo === Infinity ? null : Math.round(lo), max: hi === -Infinity ? null : Math.round(hi) };
  }

  // BRouter voice hint command codes (FormatJson) → OSRM maneuver.
  var CMD = {
    1: ["continue", "straight"], 2: ["turn", "left"], 3: ["turn", "slight left"], 4: ["turn", "sharp left"],
    5: ["turn", "right"], 6: ["turn", "slight right"], 7: ["turn", "sharp right"], 8: ["fork", "slight left"],
    9: ["fork", "slight right"], 10: ["continue", "uturn"], 11: ["continue", "uturn"], 12: ["continue", "straight"],
    13: ["roundabout", "right"], 14: ["roundabout", "left"], 15: ["continue", "uturn"], 16: ["continue", "straight"],
    17: ["fork", "slight left"], 18: ["fork", "slight right"]
  };

  var SURF = {
    paved: ["paved", "asphalt", "concrete", "concrete:plates", "concrete:lanes", "paving_stones", "sett", "cobblestone", "unhewn_cobblestone", "metal", "wood", "chipseal"],
    gravel: ["compacted", "fine_gravel", "gravel", "pebblestone", "unpaved"],
    ground: ["ground", "dirt", "earth", "grass", "grass_paver", "sand", "mud", "rock", "woodchips", "stepping_stones"]
  };
  function surfClass(tags) {
    var s = tags.surface || "";
    for (var k in SURF) if (SURF[k].indexOf(s) >= 0) return k;
    if (!s && /^(motorway|trunk|primary|secondary|tertiary|residential|living_street|unclassified)(_link)?$/.test(tags.highway || "")) return "paved";
    return "unknown";
  }
  function wayClass(tags) {
    var h = tags.highway || "";
    if (h === "cycleway" || (h === "path" && tags.bicycle === "designated")) return "cycleway";
    if (h === "steps") return "steps";
    if (h === "track") return "track";
    if (/^(path|footway|bridleway|pedestrian)$/.test(h)) return "path";
    if (h) return "road";
    return "other";
  }
  function parseTags(s) {
    var out = {};
    String(s || "").split(/\s+/).forEach(function (kv) {
      var i = kv.indexOf("=");
      if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
    });
    return out;
  }
  // [{ k, m }] sorted by metres, scaled so the parts add up to `total`.
  function shares(map, total) {
    var sum = 0, out = [];
    Object.keys(map).forEach(function (k) { sum += map[k]; });
    if (!(sum > 0)) return [];
    Object.keys(map).forEach(function (k) { if (map[k] > 0) out.push({ k: k, m: Math.round(map[k] * total / sum) }); });
    out.sort(function (a, b) { return b.m - a.m || (a.k < b.k ? -1 : 1); });
    return out;
  }

  // Up to n [metres along, elevation] pairs for the profile chart.
  function profile(cum, eles, n) {
    var out = [], len = cum.length;
    if (!len) return out;
    var step = Math.max(1, Math.ceil(len / (n || 200)));
    for (var i = 0; i < len; i += step) if (num(eles[i])) out.push([Math.round(cum[i]), Math.round(eles[i])]);
    if ((len - 1) % step && num(eles[len - 1])) out.push([Math.round(cum[len - 1]), Math.round(eles[len - 1])]);
    return out;
  }

  // Index of the route vertex nearest to p, searching from `from`.
  function nearestIdx(coords, p, from) {
    var best = -1, bd = Infinity;
    for (var i = from || 0; i < coords.length; i++) {
      var d = hav(coords[i], [p.lon, p.lat]);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // BRouter GeoJSON → { routes: [route] } like OSRM, or null.
  //   mode: "foot" | "bike"; pts: the route points (start, stops, end)
  function toOsrm(json, mode, pts) {
    var f = json && Array.isArray(json.features) ? json.features[0] : null;
    var g = f && f.geometry;
    if (!g || g.type !== "LineString" || !Array.isArray(g.coordinates) || g.coordinates.length < 2) return null;
    var coords = [], eles = [];
    g.coordinates.forEach(function (c) {
      if (Array.isArray(c) && num(c[0]) && num(c[1])) { coords.push([c[0], c[1]]); eles.push(num(c[2]) ? c[2] : null); }
    });
    if (coords.length < 2) return null;
    var cum = [0];
    for (var i = 1; i < coords.length; i++) cum.push(cum[i - 1] + hav(coords[i - 1], coords[i]));
    var props = f.properties || {};
    var dist = parseFloat(props["track-length"]);
    if (!(dist > 0)) dist = cum[cum.length - 1];
    var cl = climb(eles);
    var asc = parseFloat(props["filtered ascend"]);
    if (asc >= 0) cl.up = Math.round(asc);
    var dur;
    if (mode === "foot") dur = hikeTime(dist, cl.up, cl.down);
    else {
      dur = parseFloat(props["total-time"]);
      if (!(dur > 0)) dur = Math.round(dist / (15 / 3.6));
    }
    var k = cum[cum.length - 1] > 0 ? dist / cum[cum.length - 1] : 1;   // BRouter's metres onto ours

    // maneuvers: depart, the voice hints, an arrive at each stop and the end
    var marks = [{ idx: 0, type: "depart", mod: "" }];
    var hints = Array.isArray(props.voicehints) ? props.voicehints : [];
    hints.forEach(function (h) {
      if (!Array.isArray(h) || !num(h[0]) || !CMD[h[1]]) return;
      var idx = Math.max(1, Math.min(coords.length - 2, Math.round(h[0])));
      var m = { idx: idx, type: CMD[h[1]][0], mod: CMD[h[1]][1] };
      if (m.type === "roundabout") m.exit = num(h[2]) && h[2] > 0 ? Math.round(h[2]) : 1;
      marks.push(m);
    });
    var stops = (pts || []).slice(1, -1), from = 1;
    stops.forEach(function (p, n) {
      if (!p || !num(p.lat) || !num(p.lon)) return;
      var idx = nearestIdx(coords, p, from);
      if (idx < 0) return;
      from = idx;
      marks.push({ idx: idx, type: "arrive", mod: "", via: n + 1 });
    });
    marks.push({ idx: coords.length - 1, type: "arrive", mod: "" });
    marks.sort(function (a, b) { return a.idx - b.idx || (a.type === "arrive" ? -1 : 1); });

    var legs = [{ steps: [] }];
    marks.forEach(function (m, j) {
      var next = marks[j + 1];
      var d = next ? (cum[next.idx] - cum[m.idx]) * k : 0;
      var st = { maneuver: { type: m.type, modifier: m.mod, location: coords[m.idx] }, name: "", distance: Math.round(d),
        duration: dist > 0 ? Math.round(dur * d / dist) : 0 };
      if (m.exit) st.maneuver.exit = m.exit;
      legs[legs.length - 1].steps.push(st);
      if (m.via) legs.push({ steps: [] });   // joinLegs numbers the stop from the leg's end
    });

    // surfaces and kinds of way, from the messages table
    var surf = {}, way = {};
    var msg = Array.isArray(props.messages) ? props.messages : [];
    var head = Array.isArray(msg[0]) ? msg[0] : [];
    var cD = head.indexOf("Distance"), cT = head.indexOf("WayTags");
    if (cD >= 0 && cT >= 0) {
      msg.slice(1).forEach(function (row) {
        if (!Array.isArray(row)) return;
        var m = parseFloat(row[cD]);
        if (!(m > 0)) return;
        var tg = parseTags(row[cT]);
        var s = surfClass(tg), w = wayClass(tg);
        surf[s] = (surf[s] || 0) + m;
        way[w] = (way[w] || 0) + m;
      });
    }

    var route = {
      distance: Math.round(dist), duration: Math.round(dur),
      geometry: { type: "LineString", coordinates: coords },
      legs: legs,
      outdoor: { mode: mode, up: cl.up, down: cl.down, min: cl.min, max: cl.max,
        prof: profile(cum.map(function (c) { return c * k; }), eles, 200),
        surf: shares(surf, Math.round(dist)), way: shares(way, Math.round(dist)) }
    };
    return { code: "Ok", routes: [route] };
  }

  var api = {
    PROFILES: PROFILES, DEFAULT: DEFAULT, BASE: BASE, kindOf: kindOf, cleanBase: cleanBase, routeUrl: routeUrl,
    hikeTime: hikeTime, climb: climb, toOsrm: toOsrm, parseTags: parseTags, surfClass: surfClass, wayClass: wayClass,
    CMD: CMD
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosMapsOutdoor = api;
})(typeof window !== "undefined" ? window : this);
