// ============================================================
// orOS Maps — .orosmap package (maps/package.js,
// window.OrosMapsPackage). "My places and tracks" as one orOS bundle
// (../bundle.js, docs/oros-bundle.md): the favourite groups and
// tracks the user ticks in the Save dialog (package-ui.js). Pure (no
// DOM, no storage), so the app and `node --test` run the same code.
//   build(sel, T)    the picked data in the app's own model →
//                    { content, preview[], title, created, modified }
//     sel = { title, places [{ id, name, sub, lat, lon, mtime }],
//             groups { gid: { name, color } }, pins { pid: gid },
//             tracks [{ entry (mapstracks index entry), tr (track) }] }
//     content = { kind: "oros-maps-package", ver: 1, title,
//                 groups [{ id, name, color }],
//                 places [{ id, name, sub, lat, lon, mtime, group }],
//                 tracks [{ id, name, color, folder, hidden, src, m,
//                           track { name, segs, wpts, trace? } }] }
//     preview = places.geojson (a Point per place, its group as a
//               property) + tracks.gpx (every track as a <trk>, with
//               its waypoints), what other map apps open
//   parse(content, o)  content.json → what the app writes: groups,
//                    places and tracks, checked and cut to the app's
//                    limits; each track goes through the strict GPX
//                    writer and reader of tracks-core.js. Ids are NOT
//                    kept: the app gives new ones. Throws
//                    Error("notpackage") for anything else.
// No offline tiles, no OpenStreetMap sign-in, no recording in
// progress: only the user's own lists and tracks. No media/.
// ============================================================
(function (root) {
  "use strict";

  var KIND = "oros-maps-package", VER = 1;
  var LIM = { groups: 100, places: 5000, tracks: 2000, name: 120, sub: 200, group: 60, folder: 60, title: 120 };
  var COLOR_RE = /^#[0-9a-f]{6}$/i;

  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
  function oneLine(v, max) {
    return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }
  function okLat(v) { return typeof v === "number" && isFinite(v) && v >= -90 && v <= 90; }
  function okLon(v) { return typeof v === "number" && isFinite(v) && v >= -180 && v <= 180; }
  function tracksCore(T) {
    if (T) return T;
    if (root && root.OrosMapsTracks) return root.OrosMapsTracks;
    if (typeof require === "function") { try { return require("./tracks-core.js"); } catch (e) {} }
    return null;
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  // A track in the app's model, points copied (no shared arrays).
  function copyTrack(tr) {
    var out = { name: str(tr && tr.name, LIM.name), segs: [], wpts: [] };
    ((tr && tr.segs) || []).forEach(function (s) {
      if (Array.isArray(s)) out.segs.push(s.map(function (p) { return Array.isArray(p) ? p.slice(0, 4) : p; }));
    });
    ((tr && tr.wpts) || []).forEach(function (w) { if (w && typeof w === "object") out.wpts.push(Object.assign({}, w)); });
    if (tr && typeof tr.trace === "string" && tr.trace) out.trace = tr.trace;
    return out;
  }

  // ---------- build ----------
  function build(sel, T) {
    sel = sel || {};
    T = tracksCore(T);
    var groups = sel.groups || {}, pins = sel.pins || {};
    var places = (sel.places || []).filter(function (p) { return p && typeof p.id === "string" && okLat(p.lat) && okLon(p.lon); });
    var used = {};
    var outPlaces = places.map(function (p) {
      var g = pins[p.id] && groups[pins[p.id]] ? pins[p.id] : "";
      if (g) used[g] = 1;
      return { id: p.id, name: str(p.name, LIM.name), sub: str(p.sub, LIM.sub), lat: p.lat, lon: p.lon, mtime: num(p.mtime), group: g };
    });
    var outGroups = Object.keys(used).sort().map(function (g) {
      return { id: g, name: str(groups[g].name, LIM.group), color: str(groups[g].color, 7) };
    });
    var outTracks = (sel.tracks || []).filter(function (x) { return x && x.entry && x.tr; }).map(function (x) {
      var e = x.entry;
      return { id: e.id, name: str(e.name, LIM.name), color: str(e.color, 7), folder: str(e.folder, LIM.folder),
        hidden: e.hidden ? 1 : 0, src: e.src === "import" ? "import" : "rec", m: num(e.m), track: copyTrack(x.tr) };
    });
    var created = 0, modified = 0;
    function seen(ms) { if (!ms) return; if (!created || ms < created) created = ms; if (ms > modified) modified = ms; }
    outPlaces.forEach(function (p) { seen(p.mtime); });
    outTracks.forEach(function (t) { seen(t.m); });
    var title = oneLine(sel.title, LIM.title);
    var content = { kind: KIND, ver: VER, title: title, groups: outGroups, places: outPlaces, tracks: outTracks };

    // preview: GeoJSON places + one GPX with every track
    var gname = {};
    outGroups.forEach(function (g) { gname[g.id] = g; });
    var geo = { type: "FeatureCollection", features: outPlaces.map(function (p) {
      var props = { name: p.name };
      if (p.sub) props.description = p.sub;
      if (p.group) { props.group = gname[p.group].name; props["marker-color"] = gname[p.group].color; }
      return { type: "Feature", geometry: { type: "Point", coordinates: [p.lon, p.lat] }, properties: props };
    }) };
    var preview = [{ name: "places.geojson", data: JSON.stringify(geo, null, 1) + "\n", type: "application/geo+json" }];
    if (T && outTracks.length) {
      var gpx = '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<gpx version="1.1" creator="orOS Maps" xmlns="http://www.topografix.com/GPX/1/1">\n' +
        "<metadata>" + (title ? "<name>" + esc(title) + "</name>" : "") + "</metadata>\n";
      outTracks.forEach(function (t) {
        var one = T.clone(t.track);
        one.name = t.name || t.track.name || "";
        var x = T.writeGpx(one);
        // the waypoints and the <trk> of the single-track file
        var a = x.indexOf("</metadata>\n"), b = x.lastIndexOf("</gpx>");
        if (a >= 0 && b > a) gpx += x.slice(a + 12, b);
      });
      preview.push({ name: "tracks.gpx", data: gpx + "</gpx>\n", type: "application/gpx+xml" });
    }
    return { content: content, preview: preview, title: title, created: created, modified: modified };
  }

  // ---------- parse ----------
  // o = { colors: group colours, trackColors, T (tracks-core) }
  function parse(content, o) {
    o = o || {};
    var T = tracksCore(o.T);
    if (!content || typeof content !== "object" || content.kind !== KIND) throw new Error("notpackage");
    var gColors = o.colors || [], tColors = o.trackColors || (T && T.COLORS) || [];
    var groups = [], gIndex = {};
    (Array.isArray(content.groups) ? content.groups : []).forEach(function (g) {
      if (groups.length >= LIM.groups || !g || typeof g.id !== "string" || gIndex[g.id] !== undefined) return;
      var name = oneLine(g.name, LIM.group);
      if (!name) return;
      var color = typeof g.color === "string" && gColors.indexOf(g.color.toLowerCase()) >= 0 ? g.color.toLowerCase() : "";
      gIndex[g.id] = groups.length;
      groups.push({ key: groups.length, name: name, color: color });
    });
    var places = [], pseen = {};
    (Array.isArray(content.places) ? content.places : []).forEach(function (p) {
      if (places.length >= LIM.places || !p || !okLat(p.lat) || !okLon(p.lon)) return;
      var k = p.lat.toFixed(6) + "," + p.lon.toFixed(6);
      if (pseen[k]) return;
      pseen[k] = 1;
      var g = typeof p.group === "string" && gIndex[p.group] !== undefined ? gIndex[p.group] : -1;
      places.push({ lat: p.lat, lon: p.lon, name: oneLine(p.name, LIM.name) || "?", sub: oneLine(p.sub, LIM.sub), group: g });
    });
    var tracks = [];
    (Array.isArray(content.tracks) ? content.tracks : []).forEach(function (x) {
      if (!T || tracks.length >= LIM.tracks || !x || typeof x !== "object" || !x.track || typeof x.track !== "object") return;
      var tr = cleanTrack(x.track, T);
      if (!tr) return;
      var name = oneLine(x.name, LIM.name) || tr.name;
      tracks.push({ name: name, color: typeof x.color === "string" && COLOR_RE.test(x.color) && tColors.indexOf(x.color.toLowerCase()) >= 0 ? x.color.toLowerCase() : "",
        folder: oneLine(x.folder, LIM.folder), hidden: x.hidden ? 1 : 0, tr: tr });
    });
    return { title: oneLine(content.title, LIM.title), groups: groups, places: places, tracks: tracks };
  }
  // Only numbers in range go to the GPX writer; tracks-core then reads
  // the GPX back with its strict scanner and limits (500,000 points…).
  function cleanTrack(raw, T) {
    var pts = 0, max = T.LIM.points;
    function pt(p) {
      if (!Array.isArray(p) || !okLat(p[0]) || !okLon(p[1]) || pts >= max) return null;
      var ele = typeof p[2] === "number" && isFinite(p[2]) && Math.abs(p[2]) < 100000 ? p[2] : null;
      var t = typeof p[3] === "number" && isFinite(p[3]) && p[3] > 0 && p[3] < 8.64e15 ? Math.round(p[3]) : null;
      pts++;
      return [p[0], p[1], ele, t];
    }
    var segs = [];
    (Array.isArray(raw.segs) ? raw.segs : []).slice(0, T.LIM.segs).forEach(function (s) {
      if (!Array.isArray(s)) return;
      var seg = [];
      s.forEach(function (p) { var q = pt(p); if (q) seg.push(q); });
      if (seg.length) segs.push(seg);
    });
    var wpts = [];
    (Array.isArray(raw.wpts) ? raw.wpts : []).slice(0, T.LIM.wpts).forEach(function (w) {
      if (!w || !okLat(w.lat) || !okLon(w.lon)) return;
      var q = pt([w.lat, w.lon, w.ele, w.t]);
      if (q) wpts.push({ lat: q[0], lon: q[1], ele: q[2], t: q[3], name: oneLine(w.name, LIM.name) });
    });
    if (!segs.length) return null;
    var draft = { name: oneLine(raw.name, LIM.name), segs: segs, wpts: wpts };
    if (typeof raw.trace === "string" && T.TRACE_RE.test(raw.trace)) draft.trace = raw.trace;
    var tr = T.parseAny(T.writeGpx(draft), "x.gpx");
    return tr && tr.segs.length ? tr : null;
  }

  var api = { KIND: KIND, VER: VER, LIM: LIM, build: build, parse: parse };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosMapsPackage = api;
})(typeof window !== "undefined" ? window : null);
