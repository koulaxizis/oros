// ============================================================
// orOS Maps — route-core.js (navigation extras + sharing, OSM
// upgrade wave 6, v1.0.0). Pure functions, no DOM, no network:
// Node-tested in tests/maps-route.test.js.
//
//   - routeUrl(): the OSRM request, with alternatives (two points
//     only: OSRM ignores them with stops) and one "avoid" class for
//     the car (the OSRM car profile excludes toll, motorway or ferry,
//     one class at a time).
//   - alternatives(): the routes OSRM returned, with the time and
//     distance difference to the first one.
//   - clock(): the arrival time as HH:MM, "+1" when it is tomorrow.
//   - lanesOf(): the turn lanes of a maneuver (OSRM intersection
//     lanes, or the slim copy kept in the offline snapshot), checked
//     against the known indications; laneShape() picks the arrow to
//     draw for a lane.
//   - Sharing: geo: URI (opens another maps app on Android), links to
//     openstreetmap.org (point, directions), orOS links (?lat/lon,
//     ?route) and their strict parsing on the way in.
//   - routeTrack(): a route as a track (tracks-core shape) for "Save
//     as track", with the start, stops and destination as waypoints.
//   - localVoice(): the voice for spoken guidance, only one installed
//     on this device (never a network voice that sends the text out).
//   - Heading-up navigation (v1.2.0): mapTurn() the map's next CSS
//     rotation, unwrapped so a 350° → 10° turn goes the short way;
//     turnBox() the size of the square map that still fills the
//     screen at any rotation.
//
// API: window.OrosMapsRoute (module.exports in Node).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.2.0";
  var MAX_PTS = 5;                       // start + 3 stops + end
  var MAX_LANES = 16;
  var LABEL_MAX = 120;
  var AVOID = ["toll", "motorway", "ferry"];
  var INDICATIONS = ["none", "uturn", "sharp right", "right", "slight right",
    "straight", "slight left", "left", "sharp left"];
  var OSM_ENGINE = { car: "fossgis_osrm_car", bike: "fossgis_osrm_bike", foot: "fossgis_osrm_foot" };
  // Modes an orOS route link may carry: the OSRM ones + public
  // transport (wave 7, opens the Public transport sheet).
  var LINK_MODES = ["car", "bike", "foot", "transit"];
  function linkMode(m) { return LINK_MODES.indexOf(m) >= 0 ? m : "car"; }

  function okLat(v) { return typeof v === "number" && isFinite(v) && v >= -90 && v <= 90; }
  function okLon(v) { return typeof v === "number" && isFinite(v) && v >= -180 && v <= 180; }
  function fx(v) { return String(Math.round(v * 1e5) / 1e5); }
  function cleanLabel(s) {
    return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
  }

  // ---------- OSRM request ----------
  //   pts: [{lat, lon}…]; opt: { alternatives, avoid, profile }
  function avoidFor(profile, avoid) {
    return profile === "car" && AVOID.indexOf(avoid) >= 0 ? avoid : "";
  }
  function routeUrl(base, pts, opt) {
    opt = opt || {};
    var q = "?overview=full&geometries=geojson&steps=true";
    if (opt.alternatives && pts.length === 2) q += "&alternatives=true";
    var ex = avoidFor(opt.profile, opt.avoid);
    if (ex) q += "&exclude=" + ex;
    return base + pts.map(function (p) { return p.lon + "," + p.lat; }).join(";") + q;
  }

  // ---------- alternatives ----------
  function alternatives(routes) {
    if (!Array.isArray(routes)) return [];
    var ok = routes.filter(function (r) {
      return r && typeof r.distance === "number" && typeof r.duration === "number" &&
        r.geometry && Array.isArray(r.geometry.coordinates) && r.geometry.coordinates.length > 1;
    }).slice(0, 3);
    if (!ok.length) return [];
    var d0 = ok[0].duration, s0 = ok[0].distance;
    return ok.map(function (r, i) {
      return { i: i, dur: r.duration, dist: r.distance, dDur: r.duration - d0, dDist: r.distance - s0 };
    });
  }

  // ---------- arrival clock ----------
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function clock(nowMs, sec) {
    var now = new Date(nowMs);
    var at = new Date(nowMs + Math.max(0, sec || 0) * 1000);
    var days = Math.round((new Date(at.getFullYear(), at.getMonth(), at.getDate()) -
      new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    return pad(at.getHours()) + ":" + pad(at.getMinutes()) + (days > 0 ? " +" + days : "");
  }

  // ---------- lanes ----------
  function cleanLanes(raw) {
    if (!Array.isArray(raw) || !raw.length || raw.length > MAX_LANES) return null;
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var l = raw[i];
      if (!l || typeof l !== "object") return null;
      var ind = Array.isArray(l.indications) ? l.indications : l.i;
      if (!Array.isArray(ind)) return null;
      ind = ind.filter(function (s) { return INDICATIONS.indexOf(s) >= 0; }).slice(0, 4);
      if (!ind.length) ind = ["none"];
      var ok = l.valid !== undefined ? !!l.valid : !!l.v;
      out.push({ i: ind, v: ok ? 1 : 0 });
    }
    // Lanes that all read "none" tell nothing worth drawing.
    var info = out.some(function (l) { return l.i.some(function (s) { return s !== "none"; }); });
    return info ? out : null;
  }
  //   step: OSRM step (intersections[0] is the maneuver) or slim { lanes }
  function lanesOf(step) {
    if (!step || typeof step !== "object") return null;
    if (step.lanes) return cleanLanes(step.lanes);
    var x = Array.isArray(step.intersections) ? step.intersections[0] : null;
    return x ? cleanLanes(x.lanes) : null;
  }
  // The arrow to draw: on a lane to take, the indication that matches
  // the maneuver; otherwise the lane's first one. "none" → straight.
  function laneShape(lane, modifier) {
    var pick = lane.i[0];
    if (lane.v && modifier && lane.i.indexOf(modifier) >= 0) pick = modifier;
    return pick === "none" ? "straight" : pick;
  }

  // ---------- sharing out ----------
  function geoUri(lat, lon, label) {
    if (!okLat(lat) || !okLon(lon)) return "";
    var c = fx(lat) + "," + fx(lon);
    var l = cleanLabel(label).replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
    return "geo:" + c + "?q=" + c + (l ? "(" + encodeURIComponent(l) + ")" : "");
  }
  function osmPointUrl(lat, lon, zoom) {
    if (!okLat(lat) || !okLon(lon)) return "";
    var z = Math.max(1, Math.min(19, Math.round(zoom || 17)));
    return "https://www.openstreetmap.org/?mlat=" + fx(lat) + "&mlon=" + fx(lon) +
      "#map=" + z + "/" + fx(lat) + "/" + fx(lon);
  }
  // openstreetmap.org directions take a start and an end, no stops.
  function osmDirUrl(from, to, profile) {
    if (!from || !to || !okLat(from.lat) || !okLon(from.lon) || !okLat(to.lat) || !okLon(to.lon)) return "";
    return "https://www.openstreetmap.org/directions?engine=" + (OSM_ENGINE[profile] || OSM_ENGINE.car) +
      "&route=" + encodeURIComponent(fx(from.lat) + "," + fx(from.lon) + ";" + fx(to.lat) + "," + fx(to.lon));
  }
  function orosPointLink(base, lat, lon, label) {
    if (!okLat(lat) || !okLon(lon)) return "";
    var l = cleanLabel(label);
    return base + "?lat=" + fx(lat) + "&lon=" + fx(lon) + (l ? "&label=" + encodeURIComponent(l) : "");
  }
  function orosRouteLink(base, pts, mode, toName) {
    if (!Array.isArray(pts) || pts.length < 2 || pts.length > MAX_PTS) return "";
    for (var i = 0; i < pts.length; i++) {
      if (!pts[i] || !okLat(pts[i].lat) || !okLon(pts[i].lon)) return "";
    }
    var r = pts.map(function (p) { return fx(p.lat) + "," + fx(p.lon); }).join(";");
    var l = cleanLabel(toName);
    return base + "?route=" + encodeURIComponent(r) + "&mode=" + linkMode(mode) +
      (l ? "&to=" + encodeURIComponent(l) : "");
  }

  // ---------- links coming in (strict) ----------
  var NUM_RE = /^-?\d{1,3}(\.\d{1,10})?$/;
  function parsePoint(latS, lonS) {
    latS = String(latS == null ? "" : latS).trim();
    lonS = String(lonS == null ? "" : lonS).trim();
    if (!NUM_RE.test(latS) || !NUM_RE.test(lonS)) return null;
    var lat = parseFloat(latS), lon = parseFloat(lonS);
    return okLat(lat) && okLon(lon) ? { lat: lat, lon: lon } : null;
  }
  function parseRoute(s) {
    if (typeof s !== "string" || s.length > 400) return null;
    var parts = s.split(";");
    if (parts.length < 2 || parts.length > MAX_PTS) return null;
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var c = parts[i].split(",");
      if (c.length !== 2) return null;
      var p = parsePoint(c[0], c[1]);
      if (!p) return null;
      out.push(p);
    }
    return out;
  }
  //   search: location.search → null | { point } | { route, mode, to }
  function parseLink(search) {
    var q;
    try { q = new URLSearchParams(String(search || "")); } catch (e) { return null; }
    if (q.has("route")) {
      var pts = parseRoute(q.get("route"));
      if (!pts) return null;
      var mode = q.get("mode");
      return { route: pts, mode: linkMode(mode), to: cleanLabel(q.get("to")) };
    }
    if (q.has("lat") && q.has("lon")) {
      var p = parsePoint(q.get("lat"), q.get("lon"));
      if (!p) return null;
      return { point: { lat: p.lat, lon: p.lon, label: cleanLabel(q.get("label")) } };
    }
    return null;
  }

  // ---------- route → track ----------
  //   coords: [[lon, lat]…] (GeoJSON); pts: [{lat, lon, name}…]
  function routeTrack(coords, name, pts) {
    if (!Array.isArray(coords)) return null;
    var seg = [];
    coords.forEach(function (c) {
      if (Array.isArray(c) && okLon(c[0]) && okLat(c[1])) seg.push([c[1], c[0], null, null]);
    });
    if (seg.length < 2) return null;
    var wpts = (pts || []).filter(function (p) { return p && okLat(p.lat) && okLon(p.lon); })
      .map(function (p) { return { lat: p.lat, lon: p.lon, ele: null, t: null, name: cleanLabel(p.name) }; });
    return { name: cleanLabel(name), segs: [seg], wpts: wpts };
  }

  // The voice to read with: only a voice installed on this device
  // (localService === true). A network voice (Chrome's "Google ..."
  // voices) sends the text to its server, so it is never picked; no
  // local voice for the language -> null (the caller says so and does
  // not speak). Same language first (the part before "-"), then the
  // exact tag, then the system default.
  function localVoice(voices, lang) {
    var want = String(lang || "").toLowerCase().replace(/_/g, "-").trim();
    var base = want.split("-")[0];
    if (!voices || !base) return null;
    var best = null, score = -1;
    for (var i = 0; i < (voices.length || 0); i++) {
      var v = voices[i];
      if (!v || v.localService !== true) continue;
      var vl = String(v.lang || "").toLowerCase().replace(/_/g, "-");
      if (vl.split("-")[0] !== base) continue;
      var sc = (vl === want ? 2 : 0) + (v["default"] === true ? 1 : 0);
      if (sc > score) { score = sc; best = v; }
    }
    return best;
  }

  // ---------- heading-up ----------
  // The map is turned by -heading so the direction of travel points
  // up. prev: the current rotation in degrees (any number, not wrapped:
  // CSS animates the plain difference); heading: compass degrees.
  // Returns the rotation closest to prev, or prev when heading is not
  // a number or the change is under minStep (GPS heading jitter).
  function mapTurn(prev, heading, minStep) {
    var p = typeof prev === "number" && isFinite(prev) ? prev : 0;
    if (typeof heading !== "number" || !isFinite(heading)) return p;
    var want = -(((heading % 360) + 360) % 360);
    var d = ((want - p) % 360 + 540) % 360 - 180;      // -180 … 180
    if (Math.abs(d) < (minStep || 0)) return p;
    return p + d;
  }
  // A square map side that covers a w × h screen at every rotation:
  // the screen's diagonal, rounded up; offsets centre it on the screen.
  function turnBox(w, h) {
    w = Math.max(0, +w || 0); h = Math.max(0, +h || 0);
    var side = Math.ceil(Math.sqrt(w * w + h * h));
    return { side: side, left: Math.floor((w - side) / 2), top: Math.floor((h - side) / 2) };
  }

  var API = {
    VER: VER, AVOID: AVOID, LINK_MODES: LINK_MODES, INDICATIONS: INDICATIONS, MAX_PTS: MAX_PTS,
    mapTurn: mapTurn, turnBox: turnBox,
    avoidFor: avoidFor, routeUrl: routeUrl, alternatives: alternatives, clock: clock,
    lanesOf: lanesOf, cleanLanes: cleanLanes, laneShape: laneShape,
    geoUri: geoUri, osmPointUrl: osmPointUrl, osmDirUrl: osmDirUrl,
    orosPointLink: orosPointLink, orosRouteLink: orosRouteLink,
    parsePoint: parsePoint, parseRoute: parseRoute, parseLink: parseLink,
    routeTrack: routeTrack, cleanLabel: cleanLabel, localVoice: localVoice
  };
  if (typeof module === "object" && module.exports) module.exports = API;
  else root.OrosMapsRoute = API;
})(typeof window !== "undefined" ? window : this);
