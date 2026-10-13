// ============================================================
// orOS Maps — fav-core.js (favourite groups, maps wave 10C, v1.0.0)
//
// Pure logic, no DOM (tests/maps-fav.test.js):
//   - The synced slice "mapsfav" (key oros-maps-fav-data):
//       { ver: 1,
//         groups: { <gid>: { name, color, m } },
//         pins:   { <place id>: { g, m } },      g = "" → no group
//         tombs:  { <gid>: <ts> } }
//     Groups and pins are LWW by m (equal m → larger canonical JSON),
//     group tombstones max-union, a tomb ≥ m drops the group. A pin
//     is its own record (not a field of the place in slice "maps"):
//     an older version rewriting "maps" can't drop it.
//   - Which group a place is in, sorting, GPX of a group.
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.0.0";
  var LIM = { groups: 100, pins: 5000, tombs: 300, name: 60 };
  var COLORS = ["#87cf3e", "#e06c75", "#61afef", "#e5c07b", "#c678dd", "#56b6c2", "#d19a66", "#ff7eb6"];
  var GID_RE = /^g[a-z0-9]{4,24}$/;
  var PID_RE = /^p-?\d{1,3}\.\d{6},-?\d{1,3}\.\d{6}$/;

  function okM(m) { return typeof m === "number" && isFinite(m) && m > 0; }
  function cleanName(s) {
    if (typeof s !== "string") return "";
    return s.replace(/[\u0000-\u001f\u007f<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, LIM.name);
  }
  function canon(x) {
    if (x === null || typeof x !== "object") return JSON.stringify(x);
    if (Array.isArray(x)) return "[" + x.map(canon).join(",") + "]";
    return "{" + Object.keys(x).sort().map(function (k) { return JSON.stringify(k) + ":" + canon(x[k]); }).join(",") + "}";
  }
  function newId(now, rnd) {
    var r = typeof rnd === "number" ? rnd : Math.random();
    return "g" + (now || Date.now()).toString(36) + Math.floor(r * 1679616).toString(36);
  }

  function normGroup(x) {
    if (!x || typeof x !== "object" || !okM(x.m)) return null;
    var name = cleanName(x.name);
    if (!name) return null;
    return { name: name, color: COLORS.indexOf(x.color) >= 0 ? x.color : COLORS[0], m: x.m };
  }
  function normPin(x) {
    if (!x || typeof x !== "object" || !okM(x.m)) return null;
    return { g: typeof x.g === "string" && GID_RE.test(x.g) ? x.g : "", m: x.m };
  }
  // Keeps the newest `max` keys of a map of records (by m or ts).
  function newest(obj, max, mOf) {
    return Object.keys(obj).sort(function (a, b) { return mOf(obj[b]) - mOf(obj[a]) || (a < b ? -1 : 1); })
      .slice(0, max).sort();
  }

  function normalize(data) {
    var out = { ver: 1, groups: {}, pins: {}, tombs: {} };
    if (!data || typeof data !== "object") return out;
    var t = data.tombs && typeof data.tombs === "object" ? data.tombs : {}, tombs = {};
    Object.keys(t).forEach(function (id) { if (GID_RE.test(id) && okM(t[id])) tombs[id] = t[id]; });
    newest(tombs, LIM.tombs, function (v) { return v; }).forEach(function (id) { out.tombs[id] = tombs[id]; });
    var g = data.groups && typeof data.groups === "object" ? data.groups : {}, groups = {};
    Object.keys(g).forEach(function (id) {
      if (!GID_RE.test(id)) return;
      var x = normGroup(g[id]);
      if (!x || (out.tombs[id] !== undefined && out.tombs[id] >= x.m)) return;
      groups[id] = x;
    });
    newest(groups, LIM.groups, function (v) { return v.m; }).forEach(function (id) { out.groups[id] = groups[id]; });
    var p = data.pins && typeof data.pins === "object" ? data.pins : {}, pins = {};
    Object.keys(p).forEach(function (id) {
      if (!PID_RE.test(id)) return;
      var x = normPin(p[id]);
      if (x) pins[id] = x;
    });
    newest(pins, LIM.pins, function (v) { return v.m; }).forEach(function (id) { out.pins[id] = pins[id]; });
    return out;
  }
  function newer(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.m !== b.m) return a.m > b.m ? a : b;
    return canon(a) >= canon(b) ? a : b;
  }
  function merge(A, B) {
    var a = normalize(A), b = normalize(B), out = { groups: {}, pins: {}, tombs: {} };
    [a, b].forEach(function (x) {
      Object.keys(x.tombs).forEach(function (id) { out.tombs[id] = Math.max(out.tombs[id] || 0, x.tombs[id]); });
      Object.keys(x.groups).forEach(function (id) { out.groups[id] = newer(out.groups[id], x.groups[id]); });
      Object.keys(x.pins).forEach(function (id) { out.pins[id] = newer(out.pins[id], x.pins[id]); });
    });
    return normalize(out);
  }

  // The group a place is in now: "" when it has none or its group
  // was deleted (the pin stays; the place just shows ungrouped).
  function groupOf(data, pid) {
    var p = data && data.pins && data.pins[pid];
    return p && p.g && data.groups[p.g] ? p.g : "";
  }
  // Group ids by name (locale order), for lists and pickers.
  function order(data, lang) {
    var gs = (data && data.groups) || {};
    return Object.keys(gs).sort(function (a, b) {
      return gs[a].name.localeCompare(gs[b].name, lang || "en", { sensitivity: "base" }) || (a < b ? -1 : 1);
    });
  }
  // Same name (case and accents ignored) → the existing group.
  function findByName(data, name, lang) {
    var n = cleanName(name);
    if (!n) return "";
    var ids = order(data, lang);
    for (var i = 0; i < ids.length; i++) {
      if (data.groups[ids[i]].name.localeCompare(n, lang || "en", { sensitivity: "base" }) === 0) return ids[i];
    }
    return "";
  }
  // Places with their group, in list order: groups by name, then the
  // places without a group; inside a group the oldest first.
  function sections(data, places, lang) {
    var by = {}, out = [];
    (places || []).forEach(function (p) {
      var g = groupOf(data, p.id);
      (by[g] = by[g] || []).push(p);
    });
    function sortP(list) {
      return list.sort(function (x, y) { return ((x.mtime || 0) - (y.mtime || 0)) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0); });
    }
    order(data, lang).forEach(function (g) { out.push({ g: g, places: sortP(by[g] || []) }); });
    if (by[""]) out.push({ g: "", places: sortP(by[""]) });
    return out;
  }

  // GPX 1.1 with one waypoint per place (OsmAnd exports favourites
  // the same way; <type> carries the group name).
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }
  function toGpx(groupName, places) {
    var name = cleanName(groupName);
    var out = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<gpx version="1.1" creator="orOS Maps" xmlns="http://www.topografix.com/GPX/1/1">\n' +
      "<metadata>" + (name ? "<name>" + esc(name) + "</name>" : "") + "</metadata>\n";
    (places || []).forEach(function (p) {
      if (typeof p.lat !== "number" || typeof p.lon !== "number") return;
      out += '<wpt lat="' + p.lat + '" lon="' + p.lon + '"><name>' + esc(p.name || "?") + "</name>" +
        (p.sub ? "<desc>" + esc(p.sub) + "</desc>" : "") +
        (name ? "<type>" + esc(name) + "</type>" : "") + "</wpt>\n";
    });
    return out + "</gpx>\n";
  }
  // Waypoints of a parsed file (tracks-core parseAny) → places.
  function fromWpts(wpts, max) {
    var out = [], seen = {};
    (wpts || []).forEach(function (w) {
      if (out.length >= (max || 1000) || !w) return;
      var lat = +w.lat, lon = +w.lon;
      if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
      var key = lat.toFixed(6) + "," + lon.toFixed(6);
      if (seen[key]) return;
      seen[key] = 1;
      out.push({ lat: lat, lon: lon, name: cleanName(String(w.name || "")).slice(0, 120) || "?", sub: "" });
    });
    return out;
  }

  var api = {
    VER: VER, LIM: LIM, COLORS: COLORS, GID_RE: GID_RE, PID_RE: PID_RE,
    cleanName: cleanName, newId: newId, normalize: normalize, merge: merge,
    groupOf: groupOf, order: order, findByName: findByName, sections: sections,
    toGpx: toGpx, fromWpts: fromWpts
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosMapsFav = api;
})(typeof window !== "undefined" ? window : null);
