// ============================================================
// orOS Maps — import.js ("Import from another app", v1.0.0)
// Reads a file the user exported from another maps or sports app and
// turns it into tracks (My tracks) and saved places (Saved places,
// in a group per list). Pure: no DOM, no storage, no network;
// import-ui.js runs the picker, the preview, the writes and the Undo.
// Plain GPX, KML and GeoJSON keep their own path (tracks-core.js
// parseAny, tracks.js / fav.js); kind() tells the two apart.
//
// Sources (detected from zip entries, magic bytes, XML / JSON shape,
// CSV headers):
//   kmz       a ZIP with doc.kml (or the first .kml; pictures are
//             ignored): Organic Maps, OsmAnd, Google My Maps, Google
//             Earth. Each Placemark with a line is a track (folder =
//             the document name), each Point a place in a list named
//             after the document. The KML itself is read by
//             tracks-core.js parseKml, one Placemark at a time.
//   gsaved    Google Takeout › Maps (your places) › "Saved Places.json"
//             (GeoJSON; properties Title, Google Maps URL, Location
//             { Address, Business Name, Geo Coordinates }, Published,
//             Updated; newer: properties.location { name, address }
//             with geometry.coordinates). [0, 0] = no location.
//   glist     Google Takeout › Saved › "<list>.csv" (Title, Note, URL,
//             Comment, Tags): the coordinates are read from the URL
//             (!3dLAT!4dLON, q= / query= / ll=, /@lat,lon); rows
//             without them are counted as skipped (no geocoding).
//   timeline  Google Timeline: the on-device export "Timeline.json"
//             (semanticSegments: timelinePath points, visits,
//             activities; rawSignals; the iPhone variant is an array
//             with "geo:lat,lon"), Takeout "Records.json" (locations
//             latitudeE7 / longitudeE7 / timestamp) and "Semantic
//             Location History/YYYY/YYYY_MONTH.json" (timelineObjects:
//             activitySegment paths, placeVisit). Kept as points per
//             day and visits; timelinePlan() turns a date range the
//             user picked into one track per day and visited places.
//   tcx       Garmin Training Center XML (Activity / Course › Track ›
//             Trackpoint: Time, Position, AltitudeMeters).
//   fit       Garmin FIT activity file: a small decoder that reads
//             record messages (global 20: timestamp, position_lat /
//             position_long in semicircles, altitude, enhanced_altitude)
//             and file_id (global 0, for the stable id). Definition
//             messages, little / big endian, compressed timestamp
//             headers and developer fields are understood; every
//             other message is skipped by its defined size.
//   A Takeout ZIP: every .json / .csv / .tcx / .fit entry is read by
//   its shape (Takeout folder names are translated, so not by name).
//
// parse({ name, bytes }) → Promise<result | null>; merge(results).
// Result: { sources: [..], tracks: [{ key, name, folder, segs }],
//           places: [{ lat, lon, name, sub, list }], skipped,
//           timeline: null | { days: { ymd: [pt] }, visits: [..] } }
//   pt = [lat, lon, ele|null, t|null] as in tracks-core.js.
// Stable ids: a track is trackId(key) ("imp" + two hashes of the
// source key: activity id, FIT file id, Timeline day…), so importing
// again adds only what is missing; a place's id is Maps' own one from
// its coordinates (maps.js placeId), a list is a group by name.
// Caps: file / entry sizes, points (per file, per day), places, days.
// UMD: window.OrosMapsImport in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  function kit() { return NODE ? require("../importkit.js") : root.OrosImportKit; }
  function core() { return NODE ? require("./tracks-core.js") : root.OrosMapsTracks; }

  var MAX_FILE = 100 * 1024 * 1024;   // a picked file (Records.json can be big)
  var MAX_ENTRY = 80 * 1024 * 1024;   // inflated bytes per zip entry
  var MAX_ZIP_READ = 300 * 1024 * 1024; // inflated bytes per zip, all entries
  var MAX_ZIP_FILES = 1500;           // entries read from one zip
  var MAX_POINTS = 500000;            // track points per file (tracks-core LIM)
  var MAX_TL_POINTS = 3000000;        // Timeline points read in all
  var MAX_VISITS = 100000;
  var MAX_PLACES = 5000;
  var MAX_TRACKS = 2000;
  var DAY_PTS = 5000;                 // points kept per Timeline day
  var GAP_MS = 30 * 60 * 1000;        // a new segment after 30 min without a point
  var NAME_LEN = 120, SUB_LEN = 200, LIST_LEN = 60;
  var FIT_EPOCH = 631065600000;       // 1989-12-31T00:00:00Z in ms
  var SEMI = 180 / 2147483648;        // semicircles → degrees
  var ACCEPT = ".kmz,.kml,.gpx,.geojson,.json,.csv,.tcx,.fit,.zip," +
    "application/vnd.google-earth.kmz,application/vnd.google-earth.kml+xml,application/gpx+xml," +
    "application/geo+json,application/json,text/csv,application/zip";

  // ---------- small helpers ----------
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function okLat(v) { return isNum(v) && v >= -90 && v <= 90; }
  function okLon(v) { return isNum(v) && v >= -180 && v <= 180; }
  function okT(v) { return isNum(v) && v >= Date.UTC(1990, 0, 1) && v <= Date.UTC(2200, 0, 1); }
  function r7(v) { return Math.round(v * 1e7) / 1e7; }
  function mk(lat, lon, ele, t) {
    if (!okLat(lat) || !okLon(lon) || (lat === 0 && lon === 0)) return null;
    var e = isNum(ele) && ele > -12000 && ele < 12000 ? Math.round(ele * 10) / 10 : null;
    return [r7(lat), r7(lon), e, okT(t) ? t : null];
  }
  function clean(v, n) { return kit().clean(v, n); }
  // Text from a file that may hold HTML (KML descriptions): tags out.
  function plain(v, n) { return clean(String(v == null ? "" : v).replace(/<[^>]*>/g, " "), n); }
  function base(name) {
    var s = String(name || "").replace(/\\/g, "/");
    return s.slice(s.lastIndexOf("/") + 1).replace(/\.[a-z0-9]+$/i, "");
  }
  function num(v) {
    if (isNum(v)) return v;
    var s = String(v == null ? "" : v).trim();
    return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? +s : NaN;
  }
  // ISO time (with or without offset / fraction), epoch ms, or null
  function time(v) {
    if (v == null || v === "") return null;
    if (isNum(v)) return okT(v) ? v : null;
    var s = String(v).trim();
    if (/^\d{12,14}$/.test(s)) return okT(+s) ? +s : null;
    var t = core().parseTime(s);
    if (t == null && /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/.test(s)) {
      t = Date.parse(s.replace(" ", "T"));
      if (!okT(t)) t = null;
    }
    return t;
  }
  function localYmd(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  // The day of a point: the date written in the source when it carries
  // its own UTC offset (the day the user lived it), else this device's.
  function dayOf(str, ms) {
    var s = typeof str === "string" ? str.trim() : "";
    if (/^\d{4}-\d\d-\d\dT[\d:.]+[+-]\d\d:?\d\d$/.test(s)) return s.slice(0, 10);
    return localYmd(ms);
  }
  function hash7(s) { return ("0000000" + kit().hash(s)).slice(-7); }
  function trackId(key) { var k = String(key); return "imp" + hash7(k) + hash7("~" + k); }
  function placeKey(lat, lon) { return "p" + lat.toFixed(6) + "," + lon.toFixed(6); }

  // ---------- tiny XML scanner (same rules as tracks-core.js) ----------
  function blocks(text, tag) {
    var re = new RegExp("<(?:[\\w-]+:)?" + tag + "\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?" + tag + "\\s*>)", "g");
    var out = [], m;
    while ((m = re.exec(text))) out.push({ attrs: m[1] || "", inner: m[2] || "" });
    return out;
  }
  function child(inner, tag) {
    var m = new RegExp("<(?:[\\w-]+:)?" + tag + "\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?" + tag + ">").exec(inner || "");
    return m ? core().decodeXml(m[1]) : null;
  }
  function attr(attrs, name) {
    var m = new RegExp("(?:^|\\s)" + name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)')").exec(attrs || "");
    return m ? (m[2] !== undefined ? m[2] : m[3]) : null;
  }

  // ---------- result ----------
  function empty() { return { sources: [], tracks: [], places: [], skipped: 0, timeline: null }; }
  function addSource(r, s) { if (r.sources.indexOf(s) < 0) r.sources.push(s); }
  function addPlace(r, lat, lon, name, sub, list) {
    var p = mk(lat, lon, null, null);
    if (!p) { r.skipped++; return false; }
    name = clean(name, NAME_LEN);
    sub = clean(sub, SUB_LEN);
    r.places.push({ lat: p[0], lon: p[1], name: name || "?", sub: sub === name ? "" : sub, list: clean(list, LIST_LEN) });
    return true;
  }
  function addTrack(r, key, name, folder, segs) {
    segs = (segs || []).filter(function (s) { return s.length > 1; });
    if (!segs.length) return false;
    r.tracks.push({ key: String(key), name: clean(name, NAME_LEN), folder: clean(folder, LIST_LEN), segs: segs });
    return true;
  }
  function firstPt(segs) { return segs && segs[0] && segs[0][0] ? segs[0][0] : null; }
  function ptKey(p) { return p ? p[0] + "," + p[1] + "," + (p[3] || "") : ""; }

  // ---------- KMZ / KML (via tracks-core.js parseKml) ----------
  function kmlInto(r, text, fileName) {
    var T = core();
    var docB = blocks(text, "Document")[0];
    var docName = docB ? child(docB.inner.replace(/<(?:[\w-]+:)?(?:Placemark|Folder)\b[\s\S]*$/, ""), "name") : null;
    var list = clean(docName, LIST_LEN) || clean(base(fileName), LIST_LEN);
    var pms = blocks(text, "Placemark"), budget = MAX_POINTS, nP = 0;
    for (var i = 0; i < pms.length && budget > 0; i++) {
      var pm = pms[i];
      var one = T.parseKml("<kml><Placemark>" + pm.inner + "</Placemark></kml>");
      var pname = clean(child(pm.inner, "name"), NAME_LEN);
      if (one.segs.length) {
        var segs = [];
        one.segs.forEach(function (s) {
          if (budget <= 0) return;
          var cut = s.slice(0, budget);
          budget -= cut.length;
          segs.push(cut);
        });
        var fp = firstPt(segs);
        addTrack(r, "kml|" + list + "|" + pname + "|" + ptKey(fp) + "|" + segs.length, pname || list, list, segs);
      } else if (one.wpts.length && nP < MAX_PLACES) {
        var w = one.wpts[0];
        if (addPlace(r, w.lat, w.lon, pname, plain(child(pm.inner, "description"), SUB_LEN), list)) nP++;
      }
    }
  }
  function kmzDoc(names) {
    var kmls = names.filter(function (n) { return /\.kml$/i.test(n); });
    var doc = kmls.filter(function (n) { return /(^|\/)doc\.kml$/i.test(n); })
      .sort(function (a, b) { return a.length - b.length; })[0];
    return doc || kmls[0] || "";
  }

  // ---------- TCX ----------
  function tcxInto(r, text, fileName) {
    var acts = blocks(text, "Activity");
    var courses = blocks(text, "Course");
    var budget = MAX_POINTS;
    acts.concat(courses).forEach(function (a) {
      var id = clean(child(a.inner, "Id"), 80);
      var name = clean(child(a.inner.replace(/<(?:[\w-]+:)?(?:Lap|Track)\b[\s\S]*$/, ""), "Name"), NAME_LEN);
      var sport = clean(attr(a.attrs, "Sport"), 40);
      var segs = [];
      blocks(a.inner, "Track").forEach(function (trk) {
        var seg = [];
        blocks(trk.inner, "Trackpoint").forEach(function (tp) {
          if (budget <= 0) return;
          var pb = blocks(tp.inner, "Position")[0], pos = pb ? pb.inner : "";
          if (!pos) return;
          var p = mk(num(child(pos, "LatitudeDegrees")), num(child(pos, "LongitudeDegrees")),
            num(child(tp.inner, "AltitudeMeters")), time(child(tp.inner, "Time")));
          if (p) { seg.push(p); budget--; }
        });
        if (seg.length) segs.push(seg);
      });
      var fp = firstPt(segs);
      var key = "tcx|" + (id || name) + "|" + ptKey(fp);
      addTrack(r, key, name || (sport && id ? sport + " " + id.slice(0, 10) : "") || base(fileName), "", segs);
    });
  }

  // ---------- FIT ----------
  function rd(b, p, size, big) {
    var v = 0, i;
    if (big) for (i = 0; i < size; i++) v = v * 256 + b[p + i];
    else for (i = size - 1; i >= 0; i--) v = v * 256 + b[p + i];
    return v;
  }
  // bytes → { pts: [pt], fileId: "" } or null (not a FIT file)
  function parseFit(bytes) {
    if (!bytes || bytes.length < 14) return null;
    var out = { pts: [], fileId: "" }, pos = 0, files = 0;
    while (pos + 12 <= bytes.length && files < 32) {
      var hs = bytes[pos];
      if ((hs !== 12 && hs !== 14) || pos + hs > bytes.length) break;
      if (bytes[pos + 8] !== 0x2e || bytes[pos + 9] !== 0x46 || bytes[pos + 10] !== 0x49 || bytes[pos + 11] !== 0x54) break;
      var size = rd(bytes, pos + 4, 4, false);
      var start = pos + hs, end = Math.min(bytes.length, start + size);
      fitRecords(bytes, start, end, out);
      files++;
      pos = end + 2;                      // the file's CRC
    }
    return files ? out : null;
  }
  function fitRecords(b, p, end, out) {
    var defs = {}, st = { last: 0 };
    while (p < end && out.pts.length < MAX_POINTS) {
      var h = b[p++], def;
      if (h & 0x80) {                     // compressed timestamp header
        def = defs[(h >> 5) & 3];
        if (!def) return;
        var off = h & 0x1f, ts = st.last - (st.last & 0x1f) + off;
        if (off < (st.last & 0x1f)) ts += 0x20;
        st.last = ts;
        p = fitData(b, p, end, def, st, out, ts);
      } else if (h & 0x40) {              // definition message
        if (p + 5 > end) return;
        var big = b[p + 1] === 1, g = rd(b, p + 2, 2, big), n = b[p + 4], fields = [], sz = 0;
        p += 5;
        if (p + n * 3 > end) return;
        for (var i = 0; i < n; i++, p += 3) { fields.push({ num: b[p], size: b[p + 1] }); sz += b[p + 1]; }
        if (h & 0x20) {                   // developer fields: only their size matters
          if (p >= end) return;
          var nd = b[p++];
          if (p + nd * 3 > end) return;
          for (var j = 0; j < nd; j++, p += 3) sz += b[p + 1];
        }
        defs[h & 0x0f] = { g: g, big: big, fields: fields, size: sz };
      } else {                            // data message
        def = defs[h & 0x0f];
        if (!def) return;
        p = fitData(b, p, end, def, st, out, null);
      }
      if (p < 0) return;
    }
  }
  function fitData(b, p, end, def, st, out, cts) {
    if (p + def.size > end) return -1;
    var v = {}, q = p;
    def.fields.forEach(function (f) {
      if (f.size === 1 || f.size === 2 || f.size === 4) v[f.num] = { n: rd(b, q, f.size, def.big), s: f.size };
      q += f.size;
    });
    var ts = v[253] && v[253].s === 4 && v[253].n !== 0xffffffff ? v[253].n : null;
    if (ts !== null) st.last = ts;
    if (def.g === 0 && !out.fileId) {
      var sn = v[3] && v[3].n !== 0 && v[3].n !== 0xffffffff ? v[3].n : "";
      var tc = v[4] && v[4].n !== 0xffffffff ? v[4].n : "";
      if (sn !== "" || tc !== "") out.fileId = sn + "-" + tc;
    }
    if (def.g === 20) {
      var t = ts !== null ? ts : cts;
      var la = v[0] && v[0].s === 4 ? v[0].n : 0x7fffffff, lo = v[1] && v[1].s === 4 ? v[1].n : 0x7fffffff;
      if (la !== 0x7fffffff && lo !== 0x7fffffff) {
        la = la > 0x7fffffff ? la - 0x100000000 : la;
        lo = lo > 0x7fffffff ? lo - 0x100000000 : lo;
        var ele = null;
        if (v[78] && v[78].s === 4 && v[78].n !== 0xffffffff) ele = v[78].n / 5 - 500;
        else if (v[2] && v[2].s === 2 && v[2].n !== 0xffff) ele = v[2].n / 5 - 500;
        var pt = mk(la * SEMI, lo * SEMI, ele, t !== null && t !== undefined ? FIT_EPOCH + t * 1000 : null);
        if (pt) out.pts.push(pt);
      }
    }
    return p + def.size;
  }
  function fitInto(r, bytes, fileName) {
    var f = parseFit(bytes);
    if (!f || !f.pts.length) return false;
    var key = "fit|" + (f.fileId || ptKey(f.pts[0]));
    addTrack(r, key, base(fileName), "", splitGaps(f.pts, GAP_MS));
    return true;
  }
  function splitGaps(pts, gap) {
    var segs = [], cur = [];
    pts.forEach(function (p, i) {
      var prev = i ? pts[i - 1] : null;
      if (prev && p[3] && prev[3] && p[3] - prev[3] > gap) { if (cur.length) segs.push(cur); cur = []; }
      cur.push(p);
    });
    if (cur.length) segs.push(cur);
    return segs;
  }

  // ---------- Google Takeout: saved places + lists ----------
  // Coordinates from a Google Maps link, or null.
  var URL_RES = [
    /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
    /[?&](?:q|query|ll|center|destination)=(-?\d{1,3}(?:\.\d+)?)\s*(?:,|%2C)\s*(?:\+|%20)?(-?\d{1,3}(?:\.\d+)?)(?![\d.])/i,
    /\/@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
    /\/(?:place|search|dir)\/(-?\d{1,3}(?:\.\d+)?)\s*(?:,|%2C)\s*(?:\+|%20)?(-?\d{1,3}(?:\.\d+)?)(?![\d.])/i
  ];
  function coordsFromUrl(u) {
    var s = String(u || "");
    for (var i = 0; i < URL_RES.length; i++) {
      var m = URL_RES[i].exec(s);
      if (m) {
        var p = mk(+m[1], +m[2], null, null);
        if (p) return { lat: p[0], lon: p[1] };
      }
    }
    return null;
  }
  function isGSaved(j) {
    if (!j || j.type !== "FeatureCollection" || !Array.isArray(j.features)) return false;
    for (var i = 0; i < j.features.length && i < 50; i++) {
      var p = j.features[i] && j.features[i].properties;
      if (p && typeof p === "object" && (p["Google Maps URL"] || p.google_maps_url || p.Location ||
        (p.location && typeof p.location === "object"))) return true;
    }
    return false;
  }
  function gsavedInto(r, j, fileName) {
    var list = clean(base(fileName), LIST_LEN) || "Saved Places";
    j.features.slice(0, MAX_PLACES * 2).forEach(function (f) {
      if (!f || typeof f !== "object" || r.places.length >= MAX_PLACES) return;
      var p = f.properties && typeof f.properties === "object" ? f.properties : {};
      var loc = p.Location && typeof p.Location === "object" ? p.Location : (p.location && typeof p.location === "object" ? p.location : {});
      var geo = loc["Geo Coordinates"] && typeof loc["Geo Coordinates"] === "object" ? loc["Geo Coordinates"] : null;
      var lat = geo ? num(geo.Latitude) : NaN, lon = geo ? num(geo.Longitude) : NaN;
      if (!mk(lat, lon) && f.geometry && Array.isArray(f.geometry.coordinates)) {
        lat = num(f.geometry.coordinates[1]); lon = num(f.geometry.coordinates[0]);
      }
      if (!mk(lat, lon)) {
        var c = coordsFromUrl(p["Google Maps URL"] || p.google_maps_url);
        if (c) { lat = c.lat; lon = c.lon; }
      }
      var name = loc["Business Name"] || p.Title || loc.name || loc.Address || loc.address || "";
      var sub = loc.Address || loc.address || "";
      addPlace(r, lat, lon, name, sub, list);
    });
  }
  function isGList(head) {
    var K = kit();
    return K.col(head, ["URL"]) >= 0 && K.col(head, ["Title"]) >= 0;
  }
  function glistInto(r, text, fileName) {
    var K = kit(), t = K.records(text, { maxRows: MAX_PLACES * 2 });
    if (!isGList(t.head)) return false;
    var list = clean(base(fileName), LIST_LEN) || "Saved";
    t.rows.forEach(function (row) {
      var title = K.get(row, ["Title"]), url = K.get(row, ["URL"]);
      var note = K.get(row, ["Note"]), comment = K.get(row, ["Comment"]);
      if (!clean(title) && !clean(url)) return;           // the blank row under the header
      if (r.places.length >= MAX_PLACES) { r.skipped++; return; }
      var c = coordsFromUrl(url);
      if (!c) { r.skipped++; return; }
      addPlace(r, c.lat, c.lon, title || note, note || comment, list);
    });
    return true;
  }

  // ---------- Google Timeline ----------
  function tlNew() { return { days: {}, visits: [], n: 0 }; }
  function tlAdd(tl, lat, lon, ele, t, str) {
    if (tl.n >= MAX_TL_POINTS || t == null) return;
    var p = mk(lat, lon, ele, t);
    if (!p || p[3] == null) return;
    var d = dayOf(str, t);
    (tl.days[d] = tl.days[d] || []).push(p);
    tl.n++;
  }
  function tlVisit(tl, key, lat, lon, name, sub, type, t, str) {
    if (tl.visits.length >= MAX_VISITS || t == null) return;
    var p = mk(lat, lon, null, t);
    if (!p) return;
    tl.visits.push({ key: String(key || placeKey(p[0], p[1])), ymd: dayOf(str, t), lat: p[0], lon: p[1],
      name: clean(name, NAME_LEN), sub: clean(sub, SUB_LEN), type: clean(type, 40).toUpperCase() });
  }
  // "37.98°, 23.72°", "geo:37.98,23.72", { latLng: … } → { lat, lon }
  function latLng(v) {
    if (v && typeof v === "object") v = v.latLng || v.LatLng || v.point || v.placeLocation;
    if (typeof v !== "string") return null;
    var a = v.replace(/^\s*geo:/i, "").replace(/°/g, "").split(",");
    if (a.length < 2) return null;
    var p = mk(num(a[0]), num(a[1]), null, null);
    return p ? { lat: p[0], lon: p[1] } : null;
  }
  function e7(v) {
    var n = num(v);
    if (!isNum(n)) return NaN;
    if (n > 1800000000) n -= 4294967296;       // an old Takeout overflow
    return n / 1e7;
  }
  function isTimeline(j) {
    if (!j || typeof j !== "object") return "";
    if (Array.isArray(j.semanticSegments) || Array.isArray(j.rawSignals)) return "timeline";
    if (Array.isArray(j.timelineObjects)) return "semantic";
    if (Array.isArray(j.locations) && j.locations.length && j.locations[0] && j.locations[0].latitudeE7 !== undefined) return "records";
    if (Array.isArray(j) && j.length && j[0] && typeof j[0] === "object" && (j[0].startTime || j[0].endTime) &&
      (j[0].visit || j[0].activity || j[0].timelinePath)) return "timeline";
    return "";
  }
  function timelineInto(r, j) {
    var tl = r.timeline || (r.timeline = tlNew());
    var segs = Array.isArray(j) ? j : (Array.isArray(j.semanticSegments) ? j.semanticSegments : []);
    segs.forEach(function (s) {
      if (!s || typeof s !== "object") return;
      var st = time(s.startTime), et = time(s.endTime);
      if (Array.isArray(s.timelinePath)) {
        s.timelinePath.forEach(function (x) {
          if (!x) return;
          var c = latLng(x.point), t = time(x.time);
          if (t == null && st != null && isNum(num(x.durationMinutesOffsetFromStartTime))) t = st + num(x.durationMinutesOffsetFromStartTime) * 60000;
          if (c) tlAdd(tl, c.lat, c.lon, null, t, typeof x.time === "string" ? x.time : s.startTime);
        });
      }
      if (s.visit && typeof s.visit === "object") {
        var tc = s.visit.topCandidate || {};
        var c2 = latLng(tc.placeLocation);
        if (c2) {
          tlAdd(tl, c2.lat, c2.lon, null, st, s.startTime);
          tlAdd(tl, c2.lat, c2.lon, null, et, s.endTime);
          tlVisit(tl, tc.placeId || tc.placeID, c2.lat, c2.lon, "", "", tc.semanticType, st, s.startTime);
        }
      }
      if (s.activity && typeof s.activity === "object") {
        var a = latLng(s.activity.start), b = latLng(s.activity.end);
        if (a) tlAdd(tl, a.lat, a.lon, null, st, s.startTime);
        if (b) tlAdd(tl, b.lat, b.lon, null, et, s.endTime);
      }
    });
    (Array.isArray(j.rawSignals) ? j.rawSignals : []).forEach(function (x) {
      var p = x && x.position;
      if (!p || typeof p !== "object") return;
      var c = latLng(p.LatLng || p.latLng);
      if (c) tlAdd(tl, c.lat, c.lon, num(p.altitudeMeters), time(p.timestamp), p.timestamp);
    });
  }
  function recordsInto(r, j) {
    var tl = r.timeline || (r.timeline = tlNew());
    j.locations.forEach(function (x) {
      if (!x || typeof x !== "object") return;
      var t = time(x.timestamp != null ? x.timestamp : (x.timestampMs != null ? +x.timestampMs : null));
      tlAdd(tl, e7(x.latitudeE7), e7(x.longitudeE7), num(x.altitude), t, x.timestamp);
    });
  }
  function durOf(d) {
    d = d && typeof d === "object" ? d : {};
    return {
      s: time(d.startTimestamp != null ? d.startTimestamp : (d.startTimestampMs != null ? +d.startTimestampMs : null)),
      e: time(d.endTimestamp != null ? d.endTimestamp : (d.endTimestampMs != null ? +d.endTimestampMs : null)),
      ss: d.startTimestamp, es: d.endTimestamp
    };
  }
  function semanticInto(r, j) {
    var tl = r.timeline || (r.timeline = tlNew());
    j.timelineObjects.forEach(function (o) {
      if (!o || typeof o !== "object") return;
      var a = o.activitySegment, v = o.placeVisit;
      if (a && typeof a === "object") {
        var d = durOf(a.duration), sl = a.startLocation || {}, el = a.endLocation || {};
        tlAdd(tl, e7(sl.latitudeE7), e7(sl.longitudeE7), null, d.s, d.ss);
        var raw = a.simplifiedRawPath && Array.isArray(a.simplifiedRawPath.points) ? a.simplifiedRawPath.points : [];
        raw.forEach(function (x) {
          var t = time(x.timestamp != null ? x.timestamp : (x.timestampMs != null ? +x.timestampMs : null));
          tlAdd(tl, e7(x.latE7 != null ? x.latE7 : x.latitudeE7), e7(x.lngE7 != null ? x.lngE7 : x.longitudeE7), null, t, x.timestamp);
        });
        var wp = !raw.length && a.waypointPath && Array.isArray(a.waypointPath.waypoints) ? a.waypointPath.waypoints : [];
        wp.forEach(function (x, i) {           // no times: spread over the segment
          if (d.s == null || d.e == null) return;
          var t = Math.round(d.s + (d.e - d.s) * (i + 1) / (wp.length + 1));
          tlAdd(tl, e7(x.latE7), e7(x.lngE7), null, t, d.ss);
        });
        tlAdd(tl, e7(el.latitudeE7), e7(el.longitudeE7), null, d.e, d.es);
      }
      if (v && typeof v === "object") {
        var dv = durOf(v.duration), l = v.location || {};
        var lat = e7(l.latitudeE7), lon = e7(l.longitudeE7);
        tlAdd(tl, lat, lon, null, dv.s, dv.ss);
        tlAdd(tl, lat, lon, null, dv.e, dv.es);
        tlVisit(tl, l.placeId, lat, lon, l.name, l.address, l.semanticType, dv.s, dv.ss);
      }
    });
  }
  // Day range of a timeline: { first, last, days } (ymd strings)
  function timelineRange(tl) {
    if (!tl) return null;
    var ds = Object.keys(tl.days);
    tl.visits.forEach(function (v) { if (!tl.days[v.ymd]) ds.push(v.ymd); });
    ds = ds.filter(function (d, i) { return ds.indexOf(d) === i; }).sort();
    return ds.length ? { first: ds[0], last: ds[ds.length - 1], days: ds.length } : null;
  }
  // What a date range [from, to] (inclusive ymd) of a timeline
  // becomes: tracks: one per day { key "tl|ymd", ymd, segs } (points
  // sorted, repeated ones dropped, a new segment after a 30 min gap,
  // at most opts.dayPts points), places: one per visited place
  // { key, lat, lon, name, sub, type, count, first, last } (most
  // visited first, at most opts.maxPlaces).
  function timelinePlan(tl, from, to, opts) {
    opts = opts || {};
    var out = { tracks: [], places: [], points: 0 };
    if (!tl || !/^\d{4}-\d\d-\d\d$/.test(from || "") || !/^\d{4}-\d\d-\d\d$/.test(to || "") || from > to) return out;
    var max = opts.dayPts || DAY_PTS;
    if (opts.tracks !== false) {
      Object.keys(tl.days).filter(function (d) { return d >= from && d <= to; }).sort().forEach(function (d) {
        var pts = tl.days[d].slice().sort(function (a, b) { return a[3] - b[3]; });
        var uniq = [];
        pts.forEach(function (p) {
          var q = uniq[uniq.length - 1];
          if (q && q[3] === p[3]) return;
          if (q && q[0] === p[0] && q[1] === p[1] && p[3] - q[3] < GAP_MS) return;
          uniq.push(p);
        });
        if (uniq.length > max) {
          var step = (uniq.length - 1) / (max - 1), res = [];
          for (var i = 0; i < max; i++) res.push(uniq[Math.round(i * step)]);
          uniq = res;
        }
        var segs = splitGaps(uniq, GAP_MS).filter(function (s) { return s.length > 1; });
        if (!segs.length) return;
        out.points += segs.reduce(function (n, s) { return n + s.length; }, 0);
        out.tracks.push({ key: "tl|" + d, ymd: d, segs: segs });
      });
    }
    if (opts.places !== false) {
      var by = {};
      tl.visits.forEach(function (v) {
        if (v.ymd < from || v.ymd > to) return;
        var x = by[v.key];
        if (!x) x = by[v.key] = { key: v.key, lat: v.lat, lon: v.lon, name: v.name, sub: v.sub, type: v.type, count: 0, first: v.ymd, last: v.ymd };
        x.count++;
        if (!x.name && v.name) x.name = v.name;
        if (!x.sub && v.sub) x.sub = v.sub;
        if (v.ymd < x.first) x.first = v.ymd;
        if (v.ymd > x.last) x.last = v.ymd;
      });
      out.places = Object.keys(by).map(function (k) { return by[k]; })
        .sort(function (a, b) { return b.count - a.count || (a.key < b.key ? -1 : 1); })
        .slice(0, opts.maxPlaces || 1000);
    }
    return out;
  }

  // ---------- detection ----------
  function isFit(b) { return !!b && b.length >= 12 && (b[0] === 12 || b[0] === 14) && b[8] === 0x2e && b[9] === 0x46 && b[10] === 0x49 && b[11] === 0x54; }
  function head(bytes, n) {
    try { return kit().text(bytes.subarray(0, n)); } catch (e) { return ""; }
  }
  // "new": a source of this file; "plain": GPX / KML / GeoJSON for the
  // existing path (tracks-core.js parseAny); "": unknown.
  function kind(name, bytes) {
    if (!bytes || !bytes.length) return "";
    if (kit().isZip(bytes) || isFit(bytes)) return "new";
    var h = head(bytes, 65536), lname = String(name || "").toLowerCase();
    if (/<(?:[\w-]+:)?TrainingCenterDatabase\b/.test(h) || /\.tcx$/.test(lname)) return "new";
    if (/<(?:[\w-]+:)?(gpx|kml)\b/.test(h.slice(0, 4000)) || /\.(gpx|kml)$/.test(lname)) return "plain";
    if (/^\s*[\[{]/.test(h)) {
      if (/"(semanticSegments|timelineObjects|rawSignals|latitudeE7|Google Maps URL|google_maps_url|Geo Coordinates)"/.test(h) ||
        /^\s*\[\s*\{\s*"(endTime|startTime)"/.test(h)) return "new";
      return "plain";
    }
    if (/\.csv$/.test(lname) || /^\s*"?Title"?\s*[,;\t]/i.test(h)) return "new";
    return "";
  }

  // ---------- parse ----------
  function intoText(r, text, name) {
    var t = String(text || "");
    if (/<(?:[\w-]+:)?TrainingCenterDatabase\b/.test(t.slice(0, 4000))) { addSource(r, "tcx"); tcxInto(r, t, name); return true; }
    if (/<(?:[\w-]+:)?kml\b/.test(t.slice(0, 4000))) { addSource(r, "kmz"); kmlInto(r, t, name); return true; }
    if (/^\s*[\[{]/.test(t)) {
      var j = kit().json(t);
      if (!j) return false;
      if (isGSaved(j)) { addSource(r, "gsaved"); gsavedInto(r, j, name); return true; }
      var tk = isTimeline(j);
      if (tk === "timeline") { addSource(r, "timeline"); timelineInto(r, j); return true; }
      if (tk === "records") { addSource(r, "timeline"); recordsInto(r, j); return true; }
      if (tk === "semantic") { addSource(r, "timeline"); semanticInto(r, j); return true; }
      return false;
    }
    if (isGList(kit().csv(t.slice(0, 4000)).head)) { addSource(r, "glist"); return glistInto(r, t, name); }
    return false;
  }
  function intoZip(r, bytes, name) {
    var z;
    try { z = kit().unzip(bytes); } catch (e) { return Promise.resolve(false); }
    var names = z.names;
    var doc = kmzDoc(names);
    var isKmz = /\.kmz$/i.test(name || "") || (doc && !names.some(function (n) { return /\.(json|csv|tcx|fit)$/i.test(n); }));
    if (isKmz && doc) {
      return z.text(doc, MAX_ENTRY).then(function (t) {
        if (!t) return false;
        addSource(r, "kmz");
        kmlInto(r, t, /(^|\/)doc\.kml$/i.test(doc) ? name : doc);
        return true;
      });
    }
    var list = names.filter(function (n) { return /\.(json|csv|tcx|fit)$/i.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n); })
      .slice(0, MAX_ZIP_FILES);
    var read = 0, any = false;
    return list.reduce(function (p, n) {
      return p.then(function () {
        if (read + z.size(n) > MAX_ZIP_READ) return;
        read += z.size(n);
        return z.bytes(n, MAX_ENTRY).then(function (b) {
          if (!b) return;
          if (/\.fit$/i.test(n)) { if (fitInto(r, b, n)) { addSource(r, "fit"); any = true; } return; }
          if (intoText(r, kit().text(b), n)) any = true;
        }, function () {});
      });
    }, Promise.resolve()).then(function () { return any; });
  }
  // { name, bytes } → Promise<result | null>
  function parse(file) {
    var r = empty();
    var name = String((file && file.name) || ""), bytes = file && file.bytes;
    if (!bytes || !bytes.length || bytes.length > MAX_FILE) return Promise.resolve(null);
    var p;
    if (kit().isZip(bytes)) p = intoZip(r, bytes, name);
    else if (isFit(bytes)) { p = Promise.resolve(fitInto(r, bytes, name)); addSource(r, "fit"); }
    else p = Promise.resolve(intoText(r, kit().text(bytes), name));
    return p.then(function (ok) { return finish(r, ok); }, function () { return null; });
  }
  // Same text without a file (tests, a pasted export).
  function parseText(text, name) { var r = empty(); return finish(r, intoText(r, text, name)); }
  function finish(r, ok) {
    if (!ok) return null;
    dedupe(r);
    if (r.timeline && !Object.keys(r.timeline.days).length && !r.timeline.visits.length) r.timeline = null;
    if (!r.tracks.length && !r.places.length && !r.timeline && !r.skipped) return null;
    return r;
  }
  function dedupe(r) {
    var seenT = {}, seenP = {};
    r.tracks = r.tracks.filter(function (t) {
      if (seenT[t.key]) return false;
      seenT[t.key] = 1;
      return true;
    }).slice(0, MAX_TRACKS);
    r.places = r.places.filter(function (p) {
      var k = placeKey(p.lat, p.lon);
      if (seenP[k]) return false;
      seenP[k] = 1;
      return true;
    }).slice(0, MAX_PLACES);
  }
  // Several files picked at once → one result.
  function merge(list) {
    var r = empty();
    (list || []).forEach(function (x) {
      if (!x) return;
      x.sources.forEach(function (s) { addSource(r, s); });
      r.tracks = r.tracks.concat(x.tracks);
      r.places = r.places.concat(x.places);
      r.skipped += x.skipped;
      if (x.timeline) {
        var tl = r.timeline || (r.timeline = tlNew());
        Object.keys(x.timeline.days).forEach(function (d) {
          tl.days[d] = (tl.days[d] || []).concat(x.timeline.days[d]);
        });
        tl.visits = tl.visits.concat(x.timeline.visits).slice(0, MAX_VISITS);
        tl.n += x.timeline.n;
      }
    });
    dedupe(r);
    return r.tracks.length || r.places.length || r.timeline || r.skipped ? r : null;
  }

  // ---------- plan: what is new against what Maps has ----------
  // have = { tracks: { id: 1 }, places: { pid: 1 } }. Returns
  // { tracks: [{ id, key, name, folder, segs, start }], places: [..],
  //   tracksThere, placesThere }: only what is missing; the rest is
  // counted as already there and left exactly as the user has it.
  function plan(tracks, places, have) {
    have = have || {};
    var ht = have.tracks || {}, hp = have.places || {};
    var out = { tracks: [], places: [], tracksThere: 0, placesThere: 0 };
    (tracks || []).forEach(function (t) {
      var id = trackId(t.key);
      if (ht[id]) { out.tracksThere++; return; }
      var s = firstPt(t.segs);
      out.tracks.push({ id: id, key: t.key, name: t.name, folder: t.folder, segs: t.segs, start: s && s[3] ? s[3] : 0 });
    });
    (places || []).forEach(function (p) {
      var pid = placeKey(p.lat, p.lon);
      if (hp[pid]) { out.placesThere++; return; }
      out.places.push({ id: pid, lat: p.lat, lon: p.lon, name: p.name, sub: p.sub, list: p.list });
    });
    return out;
  }
  // First and last day of the tracks' points (ymd, local), or null.
  function trackRange(tracks) {
    var lo = Infinity, hi = -Infinity;
    (tracks || []).forEach(function (t) {
      t.segs.forEach(function (s) {
        s.forEach(function (p) { if (p[3]) { if (p[3] < lo) lo = p[3]; if (p[3] > hi) hi = p[3]; } });
      });
    });
    return isFinite(lo) ? { first: localYmd(lo), last: localYmd(hi) } : null;
  }

  var API = {
    VER: "1.0.0", ACCEPT: ACCEPT, MAX_FILE: MAX_FILE, DAY_PTS: DAY_PTS, MAX_TRACKS: MAX_TRACKS,
    kind: kind, parse: parse, parseText: parseText, merge: merge,
    parseFit: parseFit, coordsFromUrl: coordsFromUrl, latLng: latLng,
    timelineRange: timelineRange, timelinePlan: timelinePlan,
    plan: plan, trackRange: trackRange, trackId: trackId, placeKey: placeKey
  };
  if (NODE) module.exports = API;
  else root.OrosMapsImport = API;
})(typeof self !== "undefined" ? self : this);
