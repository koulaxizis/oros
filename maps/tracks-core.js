// ============================================================
// orOS Maps — tracks-core.js (GPX tracks, OSM upgrade wave 3, v1.0.0).
// Pure functions, no DOM, no network: Node-tested in
// tests/maps-tracks.test.js.
//
//   - Read GPX 1.0/1.1 (tracks, routes, waypoints), KML (LineString,
//     gx:Track, Point) and GeoJSON (LineString, MultiLineString,
//     Point) with a strict string scanner: no DOM, no entities beyond
//     the five XML ones and numeric references, coordinates only as
//     numbers in range, names as plain text. 20 MB / 500,000 points.
//   - Write GPX 1.1 (escaped).
//   - Statistics (distance, time, moving time, climb with a 3 m
//     hysteresis, top speed over ≥ 10 s), the recording noise filter,
//     Douglas-Peucker simplification, Google polyline encoding for the
//     small preview line kept in the index.
//   - Editing on the flat point list: trim, split, join, cut a range,
//     simplify (the UI keeps the previous version for Undo).
//   - The synced slice "mapstracks" (key oros-maps-tracks-data):
//       { ver, tracks{id: entry}, tombs{id: ts} }
//     entry = { id, m, name, color, folder, hidden, start, dur, moving,
//               dist, up, down, n, bbox[s,w,n,e], prev, src }
//     The points themselves live in the GPX file
//     /internal/Maps/Tracks/<id>.gpx (Vault Drive syncs it); `prev`
//     (≤ 300 points) lets every device draw the track before the file
//     arrives. LWW by m (equal m → larger canonical JSON); a tomb ≥ m
//     drops the entry.
//
// A track: { name, segs: [[pt, ...], ...], wpts: [{lat, lon, ele, t, name}] }
// pt = [lat, lon, ele | null, t (ms) | null]
//
// API: window.OrosMapsTracks (module.exports in Node).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.0.0";
  var LIM = { chars: 20 * 1024 * 1024, points: 500000, wpts: 2000, name: 120, folder: 60,
    tracks: 2000, tombs: 4000, prev: 300, prevChars: 8000, segs: 500 };
  var DIR = "/internal/Maps/Tracks";
  var COLORS = ["#e06c75", "#61afef", "#98c379", "#e5c07b", "#c678dd", "#56b6c2", "#d19a66", "#ff7eb6"];
  var ID_RE = /^[a-z0-9]{6,40}$/;
  var COLOR_RE = /^#[0-9a-f]{6}$/;
  var T_MIN = Date.UTC(1990, 0, 1), T_MAX = Date.UTC(2200, 0, 1);

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function okM(v) { return isNum(v) && v >= 0 && v <= 8.64e15 && Math.floor(v) === v; }
  function okLat(v) { return isNum(v) && v >= -90 && v <= 90; }
  function okLon(v) { return isNum(v) && v >= -180 && v <= 180; }
  function okT(v) { return isNum(v) && v >= T_MIN && v <= T_MAX; }
  function canon(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
  }
  function cleanText(s, max) {
    if (typeof s !== "string") return "";
    s = s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    return s.length > max ? s.slice(0, max) : s;
  }
  function r7(v) { return Math.round(v * 1e7) / 1e7; }
  function r1(v) { return Math.round(v * 10) / 10; }

  // ---------- geometry ----------
  var R = 6371008.8;
  function distM(lat1, lon1, lat2, lon2) {
    var toR = Math.PI / 180;
    var dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // ---------- reading ----------
  function decodeXml(s) {
    s = String(s || "");
    var cd = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
    if (cd) return cd[1];
    return s.replace(/<[^>]*>/g, "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, function (_, e) {
      var l = e.toLowerCase();
      if (l === "amp") return "&";
      if (l === "lt") return "<";
      if (l === "gt") return ">";
      if (l === "quot") return '"';
      if (l === "apos") return "'";
      var n = l.charAt(1) === "x" ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
      if (!isFinite(n) || n < 32 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return " ";
      try { return String.fromCodePoint(n); } catch (x) { return " "; }
    });
  }
  var ATTR_RE = {};
  function attr(attrs, name) {
    var re = ATTR_RE[name] || (ATTR_RE[name] = new RegExp("(?:^|\\s)" + name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)')"));
    var m = re.exec(attrs);
    return m ? (m[2] !== undefined ? m[2] : m[3]) : null;
  }
  var CHILD_RE = {};
  function child(inner, tag) {
    var re = CHILD_RE[tag] || (CHILD_RE[tag] = new RegExp("<(?:[\\w-]+:)?" + tag + "\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?" + tag + ">"));
    var m = re.exec(inner || "");
    return m ? decodeXml(m[1]) : null;
  }
  function num(s) {
    if (s === null || s === undefined) return NaN;
    s = String(s).trim();
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
    return +s;
  }
  function parseTime(s) {
    if (!s) return null;
    s = String(s).trim();
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:?\d\d)?$/.test(s)) return null;
    var v = Date.parse(s);
    return okT(v) ? v : null;
  }
  function mkPt(lat, lon, ele, t) {
    if (!okLat(lat) || !okLon(lon)) return null;
    var e = isNum(ele) && ele > -12000 && ele < 12000 ? r1(ele) : null;
    return [r7(lat), r7(lon), e, okT(t) ? t : null];
  }
  function blocks(text, tag) {
    var re = new RegExp("<(?:[\\w-]+:)?" + tag + "\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?" + tag + "\\s*>)", "g");
    var out = [], m;
    while ((m = re.exec(text))) out.push({ attrs: m[1] || "", inner: m[2] || "" });
    return out;
  }

  function Budget() { this.n = 0; }
  Budget.prototype.take = function () { this.n++; return this.n <= LIM.points; };

  function gpxPoints(inner, tag, bud) {
    var seg = [];
    var list = blocks(inner, tag);
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      var p = mkPt(num(attr(b.attrs, "lat")), num(attr(b.attrs, "lon")), num(child(b.inner, "ele")), parseTime(child(b.inner, "time")));
      if (!p) continue;
      if (!bud.take()) break;
      seg.push(p);
    }
    return seg;
  }
  function wptOf(lat, lon, ele, t, name) {
    var p = mkPt(lat, lon, ele, t);
    if (!p) return null;
    return { lat: p[0], lon: p[1], ele: p[2], t: p[3], name: cleanText(name || "", LIM.name) };
  }

  function parseGpx(text) {
    var bud = new Budget(), segs = [], wpts = [];
    var meta = blocks(text, "metadata")[0];
    var name = meta ? child(meta.inner, "name") : null;
    blocks(text, "trk").forEach(function (trk) {
      if (!name) name = child(trk.inner.replace(/<(?:[\w-]+:)?trkseg\b[\s\S]*$/, ""), "name");
      var ss = blocks(trk.inner, "trkseg");
      if (!ss.length) ss = [{ inner: trk.inner }];
      ss.forEach(function (s) { var seg = gpxPoints(s.inner, "trkpt", bud); if (seg.length) segs.push(seg); });
    });
    blocks(text, "rte").forEach(function (rte) {
      if (!name) name = child(rte.inner.replace(/<(?:[\w-]+:)?rtept\b[\s\S]*$/, ""), "name");
      var seg = gpxPoints(rte.inner, "rtept", bud);
      if (seg.length) segs.push(seg);
    });
    blocks(text, "wpt").forEach(function (w) {
      if (wpts.length >= LIM.wpts) return;
      var x = wptOf(num(attr(w.attrs, "lat")), num(attr(w.attrs, "lon")), num(child(w.inner, "ele")), parseTime(child(w.inner, "time")), child(w.inner, "name"));
      if (x) wpts.push(x);
    });
    return { name: cleanText(name || "", LIM.name), segs: segs, wpts: wpts };
  }

  function kmlCoords(s, bud) {
    var seg = [];
    String(s || "").trim().split(/\s+/).forEach(function (tok) {
      var c = tok.split(",");
      if (c.length < 2) return;
      var p = mkPt(num(c[1]), num(c[0]), c.length > 2 ? num(c[2]) : NaN, null);
      if (p && bud.take()) seg.push(p);
    });
    return seg;
  }
  function parseKml(text) {
    var bud = new Budget(), segs = [], wpts = [], name = null;
    var doc = blocks(text, "Document")[0];
    if (doc) name = child(doc.inner.replace(/<(?:[\w-]+:)?Placemark\b[\s\S]*$/, ""), "name");
    blocks(text, "Placemark").forEach(function (pm) {
      var pname = child(pm.inner, "name");
      blocks(pm.inner, "LineString").forEach(function (ls) {
        var seg = kmlCoords(child(ls.inner, "coordinates"), bud);
        if (seg.length) { segs.push(seg); if (!name) name = pname; }
      });
      blocks(pm.inner, "Track").forEach(function (tr) {
        var whens = blocks(tr.inner, "when").map(function (w) { return parseTime(decodeXml(w.inner)); });
        var seg = [];
        blocks(tr.inner, "coord").forEach(function (c, i) {
          var v = decodeXml(c.inner).trim().split(/\s+/);
          var p = mkPt(num(v[1]), num(v[0]), num(v[2]), whens[i]);
          if (p && bud.take()) seg.push(p);
        });
        if (seg.length) { segs.push(seg); if (!name) name = pname; }
      });
      if (wpts.length < LIM.wpts) {
        var pt = blocks(pm.inner, "Point")[0];
        if (pt) {
          var c = String(child(pt.inner, "coordinates") || "").trim().split(",");
          var x = wptOf(num(c[1]), num(c[0]), num(c[2]), null, pname);
          if (x) wpts.push(x);
        }
      }
    });
    return { name: cleanText(name || "", LIM.name), segs: segs, wpts: wpts };
  }

  function parseGeoJson(text) {
    var j;
    try { j = JSON.parse(text); } catch (e) { return null; }
    var bud = new Budget(), segs = [], wpts = [], name = "";
    function line(coords, times) {
      if (!Array.isArray(coords)) return;
      var seg = [];
      for (var i = 0; i < coords.length; i++) {
        var c = coords[i];
        if (!Array.isArray(c)) continue;
        var t = times && typeof times[i] === "string" ? parseTime(times[i]) : (times && isNum(times[i]) ? times[i] : null);
        var p = mkPt(c[1], c[0], c[2], t);
        if (p && bud.take()) seg.push(p);
      }
      if (seg.length) segs.push(seg);
    }
    function geom(g, props) {
      if (!g || typeof g !== "object") return;
      var times = props && Array.isArray(props.coordTimes) ? props.coordTimes : null;
      if (g.type === "LineString") line(g.coordinates, times);
      else if (g.type === "MultiLineString" && Array.isArray(g.coordinates)) {
        g.coordinates.forEach(function (c, i) { line(c, times && Array.isArray(times[i]) ? times[i] : null); });
      } else if (g.type === "Point" && Array.isArray(g.coordinates) && wpts.length < LIM.wpts) {
        var x = wptOf(g.coordinates[1], g.coordinates[0], g.coordinates[2], null, props && typeof props.name === "string" ? props.name : "");
        if (x) wpts.push(x);
      } else if (g.type === "GeometryCollection" && Array.isArray(g.geometries)) {
        g.geometries.forEach(function (x) { geom(x, null); });
      }
    }
    function feat(f) {
      if (!f || typeof f !== "object") return;
      if (f.type === "Feature") {
        var before = segs.length;
        geom(f.geometry, f.properties);
        if (!name && segs.length > before && f.properties && typeof f.properties.name === "string") name = f.properties.name;
      } else if (f.type === "FeatureCollection" && Array.isArray(f.features)) f.features.forEach(feat);
      else geom(f, null);
    }
    feat(j);
    return { name: cleanText(name, LIM.name), segs: segs, wpts: wpts };
  }

  // Any supported file → track, or null (unknown / empty / too big).
  function parseAny(text, fileName) {
    if (typeof text !== "string" || !text || text.length > LIM.chars) return null;
    var head = text.slice(0, 2000);
    var tr = null;
    if (/<(?:[\w-]+:)?gpx\b/.test(head) || /\.gpx$/i.test(fileName || "")) tr = parseGpx(text);
    else if (/<(?:[\w-]+:)?kml\b/.test(head) || /\.kml$/i.test(fileName || "")) tr = parseKml(text);
    else if (/^\s*[\[{]/.test(head)) tr = parseGeoJson(text);
    if (!tr || (!tr.segs.length && !tr.wpts.length)) return null;
    if (tr.segs.length > LIM.segs) tr.segs = tr.segs.slice(0, LIM.segs);
    return tr;
  }

  // ---------- writing ----------
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }
  function iso(t) { return new Date(t).toISOString().replace(/\.000Z$/, "Z"); }
  function ptXml(tag, p, name) {
    var s = "<" + tag + ' lat="' + p[0] + '" lon="' + p[1] + '">';
    if (p[2] !== null && p[2] !== undefined) s += "<ele>" + p[2] + "</ele>";
    if (p[3]) s += "<time>" + iso(p[3]) + "</time>";
    if (name) s += "<name>" + esc(name) + "</name>";
    return s + "</" + tag + ">";
  }
  function writeGpx(tr) {
    var name = cleanText(tr.name || "", LIM.name);
    var first = firstTime(tr);
    var out = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<gpx version="1.1" creator="orOS Maps" xmlns="http://www.topografix.com/GPX/1/1">\n' +
      "<metadata>" + (name ? "<name>" + esc(name) + "</name>" : "") + (first ? "<time>" + iso(first) + "</time>" : "") + "</metadata>\n";
    (tr.wpts || []).forEach(function (w) { out += ptXml("wpt", [w.lat, w.lon, w.ele, w.t], w.name) + "\n"; });
    out += "<trk>" + (name ? "<name>" + esc(name) + "</name>" : "") + "\n";
    (tr.segs || []).forEach(function (seg) {
      out += "<trkseg>\n";
      seg.forEach(function (p) { out += ptXml("trkpt", p) + "\n"; });
      out += "</trkseg>\n";
    });
    return out + "</trk>\n</gpx>\n";
  }

  // ---------- statistics ----------
  function firstTime(tr) {
    for (var i = 0; i < (tr.segs || []).length; i++) {
      for (var j = 0; j < tr.segs[i].length; j++) if (tr.segs[i][j][3]) return tr.segs[i][j][3];
    }
    return null;
  }
  function stats(tr) {
    var dist = 0, moving = 0, up = 0, down = 0, n = 0, top = 0;
    var s = 90, w = 180, nn = -90, e = -180, t0 = null, t1 = null;
    (tr.segs || []).forEach(function (seg) {
      var ref = null, win = [];
      for (var i = 0; i < seg.length; i++) {
        var p = seg[i];
        n++;
        if (p[0] < s) s = p[0]; if (p[0] > nn) nn = p[0];
        if (p[1] < w) w = p[1]; if (p[1] > e) e = p[1];
        if (p[3]) { if (t0 === null || p[3] < t0) t0 = p[3]; if (t1 === null || p[3] > t1) t1 = p[3]; }
        if (p[2] !== null) {
          if (ref === null) ref = p[2];
          else if (p[2] - ref >= 3) { up += p[2] - ref; ref = p[2]; }
          else if (ref - p[2] >= 3) { down += ref - p[2]; ref = p[2]; }
        }
        if (i === 0) continue;
        var q = seg[i - 1];
        var d = distM(q[0], q[1], p[0], p[1]);
        dist += d;
        if (p[3] && q[3] && p[3] > q[3]) {
          var dt = (p[3] - q[3]) / 1000;
          if (dt < 300 && d / dt > 0.5) moving += dt * 1000;
          win.push([d, dt]);
          var wd = 0, wt = 0;
          for (var k = win.length - 1; k >= 0 && wt < 10; k--) { wd += win[k][0]; wt += win[k][1]; }
          if (wt >= 10 && wt < 120) top = Math.max(top, wd / wt);
          if (win.length > 64) win.shift();
        }
      }
    });
    return {
      dist: Math.round(dist), dur: t0 !== null && t1 !== null ? t1 - t0 : 0, moving: Math.round(moving),
      up: Math.round(up), down: Math.round(down), n: n, top: Math.round(top * 10) / 10,
      start: t0, bbox: n ? [s, w, nn, e] : null
    };
  }

  // Elevation / speed profile for the chart: [{d (m), ele, v (m/s)}],
  // at most `max` samples.
  function profile(tr, max) {
    var out = [], d = 0;
    (tr.segs || []).forEach(function (seg) {
      for (var i = 0; i < seg.length; i++) {
        var p = seg[i], v = null;
        if (i > 0) {
          var q = seg[i - 1], dd = distM(q[0], q[1], p[0], p[1]);
          d += dd;
          if (p[3] && q[3] && p[3] > q[3]) v = dd / ((p[3] - q[3]) / 1000);
        }
        out.push({ d: d, ele: p[2], v: v !== null && v < 100 ? v : null });
      }
    });
    if (out.length <= (max || 400)) return out;
    var step = out.length / (max || 400), res = [];
    for (var j = 0; j < (max || 400); j++) res.push(out[Math.floor(j * step)]);
    res.push(out[out.length - 1]);
    return res;
  }

  // ---------- recording filter ----------
  // fix = { lat, lon, acc (m), ele?, t (ms), spd? }. Returns a point to
  // keep, or null.
  function accept(last, fix) {
    if (!fix || !okLat(fix.lat) || !okLon(fix.lon) || !okT(fix.t)) return null;
    if (isNum(fix.acc) && fix.acc > 50) return null;
    var p = mkPt(fix.lat, fix.lon, fix.ele, fix.t);
    if (!p || !last) return p;
    var d = distM(last[0], last[1], p[0], p[1]);
    var dt = last[3] ? (p[3] - last[3]) / 1000 : 0;
    if (dt <= 0 && last[3]) return null;
    var minMove = Math.max(3, (isNum(fix.acc) ? fix.acc : 10) / 2);
    if (d < minMove) return null;
    if (dt > 0 && d / dt > 70) return null;          // > 250 km/h: a GPS jump
    return p;
  }

  // ---------- simplification ----------
  function simplifySeg(seg, tol) {
    if (seg.length < 3) return seg.slice();
    var lat0 = seg[0][0] * Math.PI / 180, kx = R * Math.PI / 180 * Math.cos(lat0), ky = R * Math.PI / 180;
    var xy = seg.map(function (p) { return [p[1] * kx, p[0] * ky]; });
    var keep = new Uint8Array(seg.length);
    keep[0] = keep[seg.length - 1] = 1;
    var stack = [[0, seg.length - 1]];
    while (stack.length) {
      var r = stack.pop(), a = r[0], b = r[1];
      var ax = xy[a][0], ay = xy[a][1], bx = xy[b][0], by = xy[b][1];
      var dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      var best = -1, bi = -1;
      for (var i = a + 1; i < b; i++) {
        var px = xy[i][0] - ax, py = xy[i][1] - ay, dd;
        if (len2 === 0) dd = px * px + py * py;
        else {
          var u = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
          var ex = px - u * dx, ey = py - u * dy;
          dd = ex * ex + ey * ey;
        }
        if (dd > best) { best = dd; bi = i; }
      }
      if (bi > 0 && best > tol * tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
    }
    return seg.filter(function (_, i) { return keep[i]; });
  }
  function simplify(tr, tol) {
    return { name: tr.name, wpts: (tr.wpts || []).slice(), segs: tr.segs.map(function (s) { return simplifySeg(s, tol); }) };
  }

  // ---------- preview polyline (Google encoding, precision 5) ----------
  function encode(points) {
    var out = "", pl = 0, pn = 0;
    function enc(v) {
      v = v < 0 ? ~(v << 1) : v << 1;
      var s = "";
      while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
      return s + String.fromCharCode(v + 63);
    }
    points.forEach(function (p) {
      var la = Math.round(p[0] * 1e5), lo = Math.round(p[1] * 1e5);
      out += enc(la - pl) + enc(lo - pn);
      pl = la; pn = lo;
    });
    return out;
  }
  function decode(str) {
    var out = [], i = 0, la = 0, lo = 0;
    str = String(str || "");
    while (i < str.length) {
      var vals = [];
      for (var k = 0; k < 2; k++) {
        var res = 0, sh = 0, b;
        do {
          if (i >= str.length) return out;
          b = str.charCodeAt(i++) - 63;
          if (b < 0 || b > 63) return out;
          res |= (b & 0x1f) << sh; sh += 5;
        } while (b >= 0x20 && sh < 35);
        vals.push(res & 1 ? ~(res >> 1) : res >> 1);
      }
      la += vals[0]; lo += vals[1];
      var lat = la / 1e5, lon = lo / 1e5;
      if (!okLat(lat) || !okLon(lon)) return out;
      out.push([lat, lon]);
    }
    return out;
  }
  // Up to LIM.prev points over all segments, segments joined by a
  // "break" (the UI draws a polyline per run of points with gaps < 2 km).
  function preview(tr) {
    var all = [];
    tr.segs.forEach(function (s) { all = all.concat(s); });
    if (!all.length) return "";
    var tol = 5, pts = all;
    for (var k = 0; k < 12; k++) {
      pts = [];
      tr.segs.forEach(function (s) { pts = pts.concat(simplifySeg(s, tol)); });
      if (pts.length <= LIM.prev) break;
      tol *= 2;
    }
    if (pts.length > LIM.prev) {
      var step = pts.length / LIM.prev, res = [];
      for (var i = 0; i < LIM.prev; i++) res.push(pts[Math.floor(i * step)]);
      pts = res;
    }
    var s2 = encode(pts);
    return s2.length > LIM.prevChars ? s2.slice(0, 0) : s2;
  }

  // ---------- editing (flat index over all segments) ----------
  function flatLen(tr) { return tr.segs.reduce(function (n, s) { return n + s.length; }, 0); }
  function at(tr, idx) {
    for (var i = 0; i < tr.segs.length; i++) {
      if (idx < tr.segs[i].length) return { s: i, i: idx };
      idx -= tr.segs[i].length;
    }
    return null;
  }
  function clone(tr) {
    return { name: tr.name, wpts: (tr.wpts || []).map(function (w) { return Object.assign({}, w); }),
      segs: tr.segs.map(function (s) { return s.map(function (p) { return p.slice(); }); }) };
  }
  // Keep only points [from, to] (inclusive).
  function trim(tr, from, to) {
    var out = clone(tr), k = 0;
    out.segs = tr.segs.map(function (s) {
      var r = [];
      s.forEach(function (p) { if (k >= from && k <= to) r.push(p.slice()); k++; });
      return r;
    }).filter(function (s) { return s.length; });
    return out;
  }
  // Remove points [from, to]; the gap becomes a segment break.
  function cut(tr, from, to) {
    var out = clone(tr), k = 0, segs = [];
    tr.segs.forEach(function (s) {
      var cur = [];
      s.forEach(function (p) {
        if (k >= from && k <= to) { if (cur.length) segs.push(cur); cur = []; }
        else cur.push(p.slice());
        k++;
      });
      if (cur.length) segs.push(cur);
    });
    out.segs = segs;
    return out;
  }
  // Two tracks: points [0, idx] and [idx, end] (the split point in both).
  function split(tr, idx) {
    var n = flatLen(tr);
    if (idx <= 0 || idx >= n - 1) return null;
    return [trim(tr, 0, idx), trim(tr, idx, n - 1)];
  }
  function join(a, b) {
    var out = clone(a);
    clone(b).segs.forEach(function (s) { out.segs.push(s); });
    (b.wpts || []).forEach(function (w) { if (out.wpts.length < LIM.wpts) out.wpts.push(Object.assign({}, w)); });
    return out;
  }

  // ---------- slice "mapstracks" ----------
  function normEntry(e) {
    if (!e || typeof e !== "object") return null;
    if (typeof e.id !== "string" || !ID_RE.test(e.id) || !okM(e.m)) return null;
    var o = { id: e.id, m: e.m };
    o.name = cleanText(e.name, LIM.name);
    o.color = typeof e.color === "string" && COLOR_RE.test(e.color) ? e.color : COLORS[0];
    o.folder = cleanText(e.folder, LIM.folder);
    o.hidden = e.hidden ? 1 : 0;
    o.start = okT(e.start) ? e.start : 0;
    ["dur", "moving", "dist", "up", "down", "n"].forEach(function (k) {
      o[k] = isNum(e[k]) && e[k] >= 0 && e[k] <= 1e12 ? Math.round(e[k]) : 0;
    });
    o.bbox = Array.isArray(e.bbox) && e.bbox.length === 4 && okLat(e.bbox[0]) && okLon(e.bbox[1]) && okLat(e.bbox[2]) && okLon(e.bbox[3]) &&
      e.bbox[0] <= e.bbox[2] && e.bbox[1] <= e.bbox[3] ? e.bbox.map(r7) : null;
    o.prev = typeof e.prev === "string" && e.prev.length <= LIM.prevChars && /^[\x3f-\x7e]*$/.test(e.prev) ? e.prev : "";
    o.src = e.src === "import" ? "import" : "rec";
    return o;
  }
  function normalizeTracks(data) {
    var out = { ver: 1, tracks: {}, tombs: {} };
    if (!data || typeof data !== "object") return out;
    var t = data.tombs && typeof data.tombs === "object" ? data.tombs : {};
    var tombs = {};
    Object.keys(t).forEach(function (id) { if (ID_RE.test(id) && okM(t[id])) tombs[id] = t[id]; });
    var tids = Object.keys(tombs);
    if (tids.length > LIM.tombs) {
      tids.sort(function (a, b) { return tombs[b] - tombs[a] || (a < b ? -1 : 1); });
      tids.slice(LIM.tombs).forEach(function (id) { delete tombs[id]; });
    }
    Object.keys(tombs).sort().forEach(function (id) { out.tombs[id] = tombs[id]; });
    var src = data.tracks && typeof data.tracks === "object" ? data.tracks : {};
    var ok = {};
    Object.keys(src).forEach(function (k) {
      var e = normEntry(src[k]);
      if (!e || e.id !== k) return;
      if (out.tombs[k] !== undefined && out.tombs[k] >= e.m) return;
      ok[k] = e;
    });
    Object.keys(ok).sort(function (a, b) { return ok[b].m - ok[a].m || (a < b ? -1 : 1); })
      .slice(0, LIM.tracks).sort().forEach(function (id) { out.tracks[id] = ok[id]; });
    return out;
  }
  function newer(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.m !== b.m) return a.m > b.m ? a : b;
    return canon(a) >= canon(b) ? a : b;
  }
  function mergeTracks(A, B) {
    var a = normalizeTracks(A), b = normalizeTracks(B);
    var tombs = {}, tracks = {};
    [a.tombs, b.tombs].forEach(function (t) {
      Object.keys(t).forEach(function (id) { tombs[id] = Math.max(tombs[id] || 0, t[id]); });
    });
    [a.tracks, b.tracks].forEach(function (ts) {
      Object.keys(ts).forEach(function (id) { tracks[id] = newer(tracks[id], ts[id]); });
    });
    return normalizeTracks({ tracks: tracks, tombs: tombs });
  }
  function pathOf(id) { return typeof id === "string" && ID_RE.test(id) ? DIR + "/" + id + ".gpx" : null; }

  // Index entry for a track (keeps the user fields of `base`).
  function entryFor(id, tr, base, m) {
    var st = stats(tr);
    return normEntry({
      id: id, m: m, name: (base && base.name) || tr.name || "",
      color: base && base.color, folder: base && base.folder, hidden: base && base.hidden,
      start: st.start || (base && base.start) || 0, dur: st.dur, moving: st.moving, dist: st.dist,
      up: st.up, down: st.down, n: st.n, bbox: st.bbox, prev: preview(tr), src: (base && base.src) || "rec"
    });
  }

  var api = {
    VER: VER, LIM: LIM, DIR: DIR, COLORS: COLORS, ID_RE: ID_RE,
    distM: distM, decodeXml: decodeXml, parseTime: parseTime,
    parseGpx: parseGpx, parseKml: parseKml, parseGeoJson: parseGeoJson, parseAny: parseAny,
    esc: esc, writeGpx: writeGpx, stats: stats, profile: profile, accept: accept,
    simplifySeg: simplifySeg, simplify: simplify, encode: encode, decode: decode, preview: preview,
    flatLen: flatLen, at: at, clone: clone, trim: trim, cut: cut, split: split, join: join,
    normEntry: normEntry, normalizeTracks: normalizeTracks, mergeTracks: mergeTracks,
    pathOf: pathOf, entryFor: entryFor, canon: canon
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosMapsTracks = api;
})(typeof window !== "undefined" ? window : this);
