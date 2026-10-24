// ============================================================
// orOS Maps — hh-core.js (places shared with a household, BR-HH)
//
// Pure logic, no DOM (tests/maps-hh.test.js). A household's places
// folder is a household document of kind "places"
// (household/engine.js). One item per place:
//   "p:<lat E6>_<lon E6>"  v = { name, sub, note, lat, lon }
// The id comes from the coordinates (like the own saved places), so
// the same place added by two people at once is one place. Every
// field of a place is one value, so a rename and a note written at
// the same time keep the newer whole place.
//   itemId(lat, lon)    → the item id
//   valueOf(place)      → the cleaned value, or null
//   build(view)         → [{ id, name, sub, note, lat, lon, by, t }]
//                          by: member of the last change, t: its stamp
//   change(view, place) → { set } that adds or updates one place
//   copyOf(view)        → [{ name, sub, lat, lon }] the own copy
//                          (the note goes after the name in sub)
// Exposes window.OrosMapsHH and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var LIM = { name: 120, sub: 200, note: 500, places: 2500 };
  var ID_RE = /^p:-?\d{1,9}_-?\d{1,10}$/;

  function cleanLine(s, max) {
    return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  }
  function cleanNote(s) {
    if (typeof s !== "string") return "";
    return s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, LIM.note);
  }
  function okLat(v) { return typeof v === "number" && isFinite(v) && v >= -90 && v <= 90; }
  function okLon(v) { return typeof v === "number" && isFinite(v) && v >= -180 && v <= 180; }
  function e6(v) { return Math.round(v * 1e6); }
  function itemId(lat, lon) { return "p:" + e6(lat) + "_" + e6(lon); }

  function valueOf(p) {
    if (!p || typeof p !== "object" || !okLat(p.lat) || !okLon(p.lon)) return null;
    var name = cleanLine(p.name, LIM.name) || "?";
    return { name: name, sub: cleanLine(p.sub, LIM.sub), note: cleanNote(p.note),
             lat: e6(p.lat) / 1e6, lon: e6(p.lon) / 1e6 };
  }

  function build(view) {
    var out = [];
    ((view && view.items) || []).forEach(function (it) {
      if (!ID_RE.test(it.id)) return;
      var v = valueOf(it.v);
      if (!v || itemId(v.lat, v.lon) !== it.id) return;
      v.id = it.id;
      v.by = typeof it._by === "string" ? it._by : "";
      v.t = typeof it._t === "number" ? it._t : 0;
      out.push(v);
    });
    out.sort(function (a, b) { return a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
    return out.slice(0, LIM.places);
  }

  function change(view, place) {
    var v = valueOf(place);
    if (!v) return null;
    var id = itemId(v.lat, v.lon), set = {};
    var cur = ((view && view.items) || []).filter(function (it) { return it.id === id; })[0];
    if (cur && JSON.stringify(valueOf(cur.v)) === JSON.stringify(v)) return null;     // nothing new: nothing to send
    set[id] = { v: v };
    return { set: set };
  }

  function copyOf(view) {
    return build(view).map(function (p) {
      var sub = p.note ? (p.sub ? p.sub + " · " : "") + p.note.replace(/\s+/g, " ") : p.sub;
      return { name: p.name, sub: sub.slice(0, LIM.sub), lat: p.lat, lon: p.lon };
    });
  }

  var api = { LIM: LIM, ID_RE: ID_RE, itemId: itemId, valueOf: valueOf, build: build, change: change, copyOf: copyOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosMapsHH = api;
})(typeof window !== "undefined" ? window : globalThis);
