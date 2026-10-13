// ============================================================
// orOS Maps — transit-core.js (public transport, maps wave 7,
// v1.0.0). Pure functions, no DOM, no network: Node-tested in
// tests/maps-transit.test.js.
//
// Public transport comes from Transitous (transitous.org): a free,
// community-run MOTIS server over open timetables (GTFS, GTFS-RT)
// and OpenStreetMap. No key, no account. Used for non-commercial,
// open-source apps, with the sources credited next to the results.
//
//   - planUrl / stoptimesUrl / stopsUrl / tripsUrl: the MOTIS API
//     requests (version v6, v5 kept as a fallback for an older
//     server).
//   - decodePolyline(): Google encoded polylines (MOTIS uses
//     precision 6 for legs, 5 for map trips; the field says which).
//   - normPlan / normStopTimes / normStops / normTrips: strict copies
//     of the server's answers. Unknown modes, bad numbers, bad colours
//     and oversized strings never reach the page.
//   - vehiclePos(): where a vehicle is now, along its segment, from
//     its departure and arrival times (Transitous live map style).
//   - itinText / itinTrack: an itinerary as text (sharing) and as a
//     track (tracks-core shape) for "Save as track".
//
// API: window.OrosMapsTransit (module.exports in Node).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.0.0";
  var BASE = "https://api.transitous.org/api/";
  var API_VERSIONS = ["v6", "v5"];
  var SOURCES_URL = "https://transitous.org/sources/";
  var STR_MAX = 120;
  var MAX_ITINS = 12, MAX_LEGS = 30, MAX_STOPS = 80, MAX_PTS = 20000;
  var MAX_ROWS = 60, MAX_MAP_STOPS = 600, MAX_SEGS = 800;

  // Mode → group (icon + line style) and a short emoji for lists.
  var MODES = {
    WALK: { g: "walk", e: "🚶" }, BIKE: { g: "bike", e: "🚲" }, RENTAL: { g: "bike", e: "🚲" },
    CAR: { g: "car", e: "🚗" }, CAR_PARKING: { g: "car", e: "🚗" }, ODM: { g: "car", e: "🚕" },
    FLEX: { g: "bus", e: "🚐" },
    TRANSIT: { g: "bus", e: "🚌" }, BUS: { g: "bus", e: "🚌" }, COACH: { g: "bus", e: "🚌" },
    TRAM: { g: "tram", e: "🚊" }, CABLE_CAR: { g: "tram", e: "🚋" },
    SUBWAY: { g: "subway", e: "🚇" }, METRO: { g: "subway", e: "🚇" },
    RAIL: { g: "rail", e: "🚆" }, HIGHSPEED_RAIL: { g: "rail", e: "🚄" },
    LONG_DISTANCE: { g: "rail", e: "🚆" }, NIGHT_RAIL: { g: "rail", e: "🚆" },
    REGIONAL_FAST_RAIL: { g: "rail", e: "🚆" }, REGIONAL_RAIL: { g: "rail", e: "🚆" },
    SUBURBAN: { g: "rail", e: "🚈" },
    FERRY: { g: "ferry", e: "⛴️" }, AIRPLANE: { g: "air", e: "✈️" },
    FUNICULAR: { g: "tram", e: "🚞" }, AERIAL_LIFT: { g: "tram", e: "🚡" },
    OTHER: { g: "bus", e: "🚌" }
  };
  var GROUP_COLOR = { walk: "8a8fa0", bike: "2e9e5b", car: "6d4aff", bus: "d9822b",
    tram: "c0392b", subway: "2c6fbb", rail: "4a5a6a", ferry: "1f8fb3", air: "7a5cc8" };
  var TIME_MODES = ["now", "depart", "arrive"];

  function okLat(v) { return typeof v === "number" && isFinite(v) && v >= -90 && v <= 90; }
  function okLon(v) { return typeof v === "number" && isFinite(v) && v >= -180 && v <= 180; }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  function str(v, max) {
    if (typeof v !== "string") return "";
    return v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max || STR_MAX);
  }
  function color(v) { return typeof v === "string" && /^[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : ""; }
  function ms(v) {
    if (typeof v !== "string" || v.length > 40) return null;
    var t = Date.parse(v);
    return isFinite(t) ? t : null;
  }
  function modeOf(m) { return typeof m === "string" && MODES[m] ? m : "OTHER"; }
  function groupOf(m) { return MODES[modeOf(m)].g; }
  function emojiOf(m) { return MODES[modeOf(m)].e; }
  function cur(v) { return typeof v === "string" && v.length <= 2000 && /^[A-Za-z0-9+\/=_.:|-]+$/.test(v) ? v : ""; }
  function fx(v) { return String(Math.round(v * 1e6) / 1e6); }
  function enc(v) { return encodeURIComponent(v); }

  // Text colour on a line badge: the feed's own, else black or white
  // by luminance (WCAG relative luminance, 0.179 threshold).
  function textOn(bg, given) {
    var g = color(given);
    if (g && g !== color(bg)) return g;
    var c = color(bg);
    if (!c) return "ffffff";
    var lum = [0, 2, 4].map(function (i) {
      var x = parseInt(c.substr(i, 2), 16) / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    var L = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
    return L > 0.179 ? "000000" : "ffffff";
  }

  // ---------- requests ----------
  function place(p) {
    if (p && typeof p.stopId === "string" && p.stopId && p.stopId.length <= 200) return p.stopId;
    if (!p || !okLat(p.lat) || !okLon(p.lon)) return "";
    return fx(p.lat) + "," + fx(p.lon);
  }
  //   opt: { from, to, time (ms|null), arriveBy, cursor, lang, n }
  function planUrl(base, ver, opt) {
    opt = opt || {};
    var f = place(opt.from), t = place(opt.to);
    if (!f || !t) return "";
    var q = "fromPlace=" + enc(f) + "&toPlace=" + enc(t);
    if (typeof opt.time === "number" && isFinite(opt.time)) q += "&time=" + enc(new Date(opt.time).toISOString());
    if (opt.arriveBy) q += "&arriveBy=true";
    q += "&numItineraries=" + Math.max(1, Math.min(10, opt.n || 5));
    q += "&detailedTransfers=false";
    var c = cur(opt.cursor);
    if (c) q += "&pageCursor=" + enc(c);
    if (opt.lang) q += "&language=" + enc(opt.lang);
    return base + ver + "/plan?" + q;
  }
  //   opt: { stopId, time (ms|null), n, cursor, lang }
  function stoptimesUrl(base, ver, opt) {
    opt = opt || {};
    if (typeof opt.stopId !== "string" || !opt.stopId || opt.stopId.length > 200) return "";
    var q = "stopId=" + enc(opt.stopId) + "&n=" + Math.max(1, Math.min(MAX_ROWS, opt.n || 20));
    if (typeof opt.time === "number" && isFinite(opt.time)) q += "&time=" + enc(new Date(opt.time).toISOString());
    var c = cur(opt.cursor);
    if (c) q += "&pageCursor=" + enc(c);
    if (opt.lang) q += "&language=" + enc(opt.lang);
    return base + ver + "/stoptimes?" + q;
  }
  function boxOk(b) {
    return b && okLat(b.s) && okLat(b.n) && okLon(b.w) && okLon(b.e) && b.s <= b.n && b.w <= b.e;
  }
  //   b: { s, w, n, e }
  function stopsUrl(base, ver, b, lang) {
    if (!boxOk(b)) return "";
    return base + ver + "/map/stops?min=" + enc(fx(b.s) + "," + fx(b.w)) + "&max=" + enc(fx(b.n) + "," + fx(b.e)) +
      (lang ? "&language=" + enc(lang) : "");
  }
  function tripsPrecision(zoom) { return zoom >= 11 ? 5 : zoom >= 8 ? 4 : zoom >= 5 ? 3 : 2; }
  function tripsUrl(base, ver, b, zoom, startMs, endMs) {
    if (!boxOk(b) || !isFinite(zoom) || !isFinite(startMs) || !isFinite(endMs) || endMs <= startMs) return "";
    var z = Math.max(0, Math.min(22, Math.round(zoom)));
    return base + ver + "/map/trips?zoom=" + z +
      "&min=" + enc(fx(b.s) + "," + fx(b.w)) + "&max=" + enc(fx(b.n) + "," + fx(b.e)) +
      "&startTime=" + enc(new Date(startMs).toISOString()) + "&endTime=" + enc(new Date(endMs).toISOString()) +
      "&precision=" + tripsPrecision(z);
  }

  // ---------- polylines ----------
  function decodePolyline(s, precision) {
    if (typeof s !== "string" || s.length > MAX_PTS * 12) return [];
    var p = typeof precision === "number" && precision >= 0 && precision <= 7 ? Math.round(precision) : 5;
    var f = Math.pow(10, p), out = [], i = 0, lat = 0, lon = 0;
    while (i < s.length && out.length < MAX_PTS) {
      var d = [0, 0];
      for (var k = 0; k < 2; k++) {
        var shift = 0, res = 0, b;
        do {
          if (i >= s.length) return out;
          b = s.charCodeAt(i++) - 63;
          if (b < 0 || b > 63) return out;
          res += (b & 0x1f) * Math.pow(2, shift);
          shift += 5;
        } while (b >= 0x20 && shift < 40);
        d[k] = (res % 2) ? -(res + 1) / 2 : res / 2;
      }
      lat += d[0]; lon += d[1];
      var la = lat / f, lo = lon / f;
      if (!okLat(la) || !okLon(lo)) return out;
      out.push([la, lo]);
    }
    return out;
  }
  function encodePolyline(pts, precision) {   // used by tests (round trip)
    var f = Math.pow(10, precision == null ? 5 : precision), out = "", pl = 0, po = 0;
    function one(v) {
      v = v < 0 ? -2 * v - 1 : 2 * v;
      var s = "";
      while (v >= 0x20) { s += String.fromCharCode((0x20 | (v % 32)) + 63); v = Math.floor(v / 32); }
      return s + String.fromCharCode(v + 63);
    }
    pts.forEach(function (p) {
      var la = Math.round(p[0] * f), lo = Math.round(p[1] * f);
      out += one(la - pl) + one(lo - po);
      pl = la; po = lo;
    });
    return out;
  }

  // ---------- answers (strict copies) ----------
  function normPlace(p) {
    if (!p || typeof p !== "object" || !okLat(p.lat) || !okLon(p.lon)) return null;
    return {
      name: str(p.name), stopId: str(p.stopId, 200), lat: p.lat, lon: p.lon,
      track: str(p.track || p.scheduledTrack, 12),
      arr: ms(p.arrival), dep: ms(p.departure),
      sArr: ms(p.scheduledArrival), sDep: ms(p.scheduledDeparture),
      cancelled: p.cancelled === true
    };
  }
  function normLeg(l) {
    if (!l || typeof l !== "object") return null;
    var from = normPlace(l.from), to = normPlace(l.to);
    var t0 = ms(l.startTime), t1 = ms(l.endTime);
    if (!from || !to || t0 == null || t1 == null || t1 < t0) return null;
    var mode = modeOf(l.mode), g = groupOf(mode);
    var geo = l.legGeometry && typeof l.legGeometry === "object" ? l.legGeometry : null;
    var pts = geo ? decodePolyline(geo.points, num(geo.precision) == null ? 6 : geo.precision) : [];
    if (pts.length < 2) pts = [[from.lat, from.lon], [to.lat, to.lon]];
    var bg = color(l.routeColor);
    var transit = ["walk", "bike", "car"].indexOf(g) < 0;
    return {
      mode: mode, g: g, transit: transit,
      t0: t0, t1: t1, s0: ms(l.scheduledStartTime), s1: ms(l.scheduledEndTime),
      rt: l.realTime === true, cancelled: l.cancelled === true,
      dist: num(l.distance), dur: num(l.duration) != null ? l.duration : Math.round((t1 - t0) / 1000),
      from: from, to: to,
      line: str(l.routeShortName || l.displayName, 24),
      lineLong: str(l.routeLongName),
      headsign: str(l.headsign),
      agency: str(l.agencyName),
      color: bg,
      textColor: bg ? textOn(bg, l.routeTextColor) : "",
      stops: Array.isArray(l.intermediateStops) ? l.intermediateStops.slice(0, MAX_STOPS).map(normPlace).filter(Boolean) : [],
      pts: pts
    };
  }
  function normItin(it) {
    if (!it || typeof it !== "object" || !Array.isArray(it.legs)) return null;
    var legs = it.legs.slice(0, MAX_LEGS).map(normLeg).filter(Boolean);
    if (!legs.length) return null;
    var t0 = ms(it.startTime), t1 = ms(it.endTime);
    if (t0 == null) t0 = legs[0].t0;
    if (t1 == null) t1 = legs[legs.length - 1].t1;
    var transitLegs = legs.filter(function (l) { return l.transit; });
    var walk = legs.reduce(function (a, l) { return a + (l.g === "walk" && l.dist ? l.dist : 0); }, 0);
    return {
      t0: t0, t1: t1, dur: num(it.duration) != null ? it.duration : Math.round((t1 - t0) / 1000),
      transfers: num(it.transfers) != null ? Math.max(0, it.transfers) : Math.max(0, transitLegs.length - 1),
      legs: legs, walk: Math.round(walk),
      rt: legs.some(function (l) { return l.rt; }),
      cancelled: legs.some(function (l) { return l.cancelled; }),
      direct: transitLegs.length === 0
    };
  }
  // Transit itineraries first (the server's order), a walk-only
  // "direct" answer last; duplicates (same legs, same times) dropped.
  function normPlan(j) {
    if (!j || typeof j !== "object") return { its: [], prev: "", next: "" };
    var all = [];
    (Array.isArray(j.itineraries) ? j.itineraries : []).forEach(function (x) { all.push(x); });
    (Array.isArray(j.direct) ? j.direct : []).forEach(function (x) { all.push(x); });
    var seen = {}, its = [];
    all.forEach(function (x) {
      var n = normItin(x);
      if (!n) return;
      var key = n.t0 + "|" + n.t1 + "|" + n.legs.map(function (l) { return l.mode + l.line; }).join(",");
      if (seen[key]) return;
      seen[key] = 1;
      its.push(n);
    });
    its = its.filter(function (n) { return !n.direct; }).concat(its.filter(function (n) { return n.direct; }));
    return { its: its.slice(0, MAX_ITINS), prev: cur(j.previousPageCursor), next: cur(j.nextPageCursor) };
  }
  function normStopTimes(j) {
    var out = { place: null, rows: [], prev: "", next: "" };
    if (!j || typeof j !== "object") return out;
    out.place = normPlace(j.place);
    out.prev = cur(j.previousPageCursor);
    out.next = cur(j.nextPageCursor);
    (Array.isArray(j.stopTimes) ? j.stopTimes : []).slice(0, MAX_ROWS).forEach(function (s) {
      if (!s || typeof s !== "object") return;
      var p = normPlace(s.place);
      if (!p) return;
      var t = p.dep != null ? p.dep : p.arr;
      if (t == null) return;
      var sched = p.dep != null ? p.sDep : p.sArr;
      var bg = color(s.routeColor);
      out.rows.push({
        t: t, sched: sched, rt: s.realTime === true, cancelled: s.cancelled === true || p.cancelled,
        mode: modeOf(s.mode), g: groupOf(s.mode),
        line: str(s.routeShortName || s.displayName, 24), headsign: str(s.headsign),
        color: bg, textColor: bg ? textOn(bg, s.routeTextColor) : "",
        track: p.track, stopName: p.name, agency: str(s.agencyName)
      });
    });
    out.rows.sort(function (a, b) { return a.t - b.t; });
    return out;
  }
  function normStops(j) {
    if (!Array.isArray(j)) return [];
    var seen = {}, out = [];
    j.slice(0, MAX_MAP_STOPS * 2).forEach(function (p) {
      var n = normPlace(p);
      if (!n || !n.stopId || seen[n.stopId]) return;
      seen[n.stopId] = 1;
      out.push({ id: n.stopId, name: n.name, lat: n.lat, lon: n.lon });
    });
    return out.slice(0, MAX_MAP_STOPS);
  }
  function normTrips(j) {
    if (!Array.isArray(j)) return [];
    var out = [];
    j.slice(0, MAX_SEGS).forEach(function (s) {
      if (!s || typeof s !== "object") return;
      var d = ms(s.departure), a = ms(s.arrival);
      if (d == null || a == null || a <= d) return;
      var pts = decodePolyline(s.polyline, num(s.precision) == null ? 5 : s.precision);
      if (pts.length < 2) return;
      var tr = Array.isArray(s.trips) && s.trips[0] && typeof s.trips[0] === "object" ? s.trips[0] : {};
      var bg = color(s.routeColor);
      var from = normPlace(s.from), to = normPlace(s.to);
      out.push({
        id: str(tr.tripId, 200), name: str(tr.displayName || tr.routeShortName, 24),
        mode: modeOf(s.mode), g: groupOf(s.mode), rt: s.realTime === true,
        dep: d, arr: a, sDep: ms(s.scheduledDeparture), sArr: ms(s.scheduledArrival),
        from: from ? from.name : "", to: to ? to.name : "",
        color: bg, textColor: bg ? textOn(bg, "") : "",
        pts: pts
      });
    });
    return out;
  }
  // Polylines for the zoom-dependent precision of map/trips: the
  // server encodes with the precision asked for, the decoder needs it.
  function withPrecision(list, p) {
    return Array.isArray(list) ? list.map(function (s) {
      if (s && typeof s === "object" && s.precision == null) { var c = {}; for (var k in s) c[k] = s[k]; c.precision = p; return c; }
      return s;
    }) : list;
  }

  // ---------- vehicles ----------
  function dist(a, b) {
    var R = 6371000, r = Math.PI / 180;
    var dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }
  //   seg: normTrips item → { lat, lon, heading } | null (not running now)
  function vehiclePos(seg, nowMs) {
    if (!seg || !Array.isArray(seg.pts) || seg.pts.length < 2) return null;
    if (nowMs < seg.dep || nowMs > seg.arr) return null;
    var f = (nowMs - seg.dep) / (seg.arr - seg.dep);
    var cum = [0];
    for (var i = 1; i < seg.pts.length; i++) cum.push(cum[i - 1] + dist(seg.pts[i - 1], seg.pts[i]));
    var total = cum[cum.length - 1];
    if (!(total > 0)) return { lat: seg.pts[0][0], lon: seg.pts[0][1], heading: 0 };
    var want = f * total;
    for (var j = 1; j < cum.length; j++) {
      if (cum[j] >= want) {
        var a = seg.pts[j - 1], b = seg.pts[j], span = cum[j] - cum[j - 1];
        var k = span > 0 ? (want - cum[j - 1]) / span : 0;
        var hd = Math.atan2((b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180), b[0] - a[0]) * 180 / Math.PI;
        return { lat: a[0] + (b[0] - a[0]) * k, lon: a[1] + (b[1] - a[1]) * k, heading: (hd + 360) % 360 };
      }
    }
    var last = seg.pts[seg.pts.length - 1];
    return { lat: last[0], lon: last[1], heading: 0 };
  }

  // ---------- time ----------
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function hhmm(t) { var d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  // Minutes late (+) or early (−), rounded; null without a schedule.
  function delayMin(t, sched) {
    if (t == null || sched == null) return null;
    return Math.round((t - sched) / 60000);
  }
  // <input type="datetime-local"> value ↔ ms (local time).
  function fromLocalInput(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(v || ""));
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
    return isFinite(d.getTime()) ? d.getTime() : null;
  }
  function toLocalInput(t) {
    var d = new Date(t);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  // Device-local preferences (never synced): { stops, live }
  function normPrefs(p) {
    p = p && typeof p === "object" ? p : {};
    return { stops: p.stops === 0 ? 0 : 1, live: p.live ? 1 : 0 };
  }

  // ---------- out ----------
  //   L: { walk, min, to, transfers } labels already in the UI language
  function itinText(it, L) {
    if (!it) return "";
    var lines = [hhmm(it.t0) + " → " + hhmm(it.t1) + " (" + Math.round(it.dur / 60) + " " + L.min + ")"];
    it.legs.forEach(function (l) {
      if (l.transit) {
        lines.push(hhmm(l.t0) + " " + emojiOf(l.mode) + " " + (l.line || "") +
          (l.headsign ? " → " + l.headsign : "") + " · " + l.from.name + (l.from.track ? " (" + l.from.track + ")" : "") +
          " → " + l.to.name + " " + hhmm(l.t1));
      } else {
        lines.push(hhmm(l.t0) + " " + emojiOf(l.mode) + " " + L.walk + " " + Math.round(l.dur / 60) + " " + L.min +
          (l.to.name ? " " + L.to + " " + l.to.name : ""));
      }
    });
    return lines.join("\n");
  }
  function itinTrack(it, name) {
    if (!it) return null;
    var seg = [];
    it.legs.forEach(function (l) {
      l.pts.forEach(function (p, i) {
        if (seg.length && i === 0) {
          var q = seg[seg.length - 1];
          if (q[0] === p[0] && q[1] === p[1]) return;
        }
        seg.push([p[0], p[1], null, null]);
      });
    });
    if (seg.length < 2) return null;
    var wpts = [];
    it.legs.forEach(function (l, i) {
      if (!l.transit) return;
      wpts.push({ lat: l.from.lat, lon: l.from.lon, ele: null, t: null, name: str((l.line ? l.line + " " : "") + l.from.name) });
      if (i === it.legs.length - 1 || !it.legs[i + 1].transit) {
        wpts.push({ lat: l.to.lat, lon: l.to.lon, ele: null, t: null, name: str(l.to.name) });
      }
    });
    return { name: str(name), segs: [seg], wpts: wpts };
  }

  var API = {
    VER: VER, BASE: BASE, API_VERSIONS: API_VERSIONS, SOURCES_URL: SOURCES_URL,
    MODES: MODES, GROUP_COLOR: GROUP_COLOR, TIME_MODES: TIME_MODES,
    modeOf: modeOf, groupOf: groupOf, emojiOf: emojiOf, textOn: textOn, color: color,
    planUrl: planUrl, stoptimesUrl: stoptimesUrl, stopsUrl: stopsUrl, tripsUrl: tripsUrl,
    tripsPrecision: tripsPrecision,
    decodePolyline: decodePolyline, encodePolyline: encodePolyline,
    normPlace: normPlace, normLeg: normLeg, normItin: normItin, normPlan: normPlan,
    normStopTimes: normStopTimes, normStops: normStops, normTrips: normTrips, withPrecision: withPrecision,
    vehiclePos: vehiclePos, hhmm: hhmm, delayMin: delayMin,
    fromLocalInput: fromLocalInput, toLocalInput: toLocalInput, normPrefs: normPrefs,
    itinText: itinText, itinTrack: itinTrack
  };
  if (typeof module === "object" && module.exports) module.exports = API;
  else root.OrosMapsTransit = API;
})(typeof window !== "undefined" ? window : this);
