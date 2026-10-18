// ============================================================
// orOS Maps — overlays-core.js (StreetComplete-style overlays, maps
// wave 8B, v1.1.0: + buildings in maps wave 9)
// An overlay colours the streets or buildings around you by one
// property, so the gaps stand out at a glance, and a tap changes it:
//   - lit:       street lights (lit)
//   - surface:   road surface (surface)
//   - sidewalk:  sidewalks on each side (sidewalk, sidewalk:left/right/both)
//   - address:   house numbers on buildings (addr:housenumber)
// Changes are ordinary quest answers (quests-core.js): lit, surface and
// house numbers use the quests way_lit, way_surface and housenumber, so
// older versions keep them; sidewalks use the overlay-only quest
// "sidewalk". Written from the OSM wiki, no StreetComplete code or text.
//
// Pure functions only: Overpass query, parser (way geometry), colours,
// the options for a way and the tags an answer sets.
// API: window.OrosMapsOverlays (module.exports in Node).
// ============================================================
(function (root) {
  "use strict";
  var Q = root && root.OrosMapsQuests ? root.OrosMapsQuests :
    (typeof require === "function" ? require("./quests-core.js") : null);
  var P = root && root.OrosMapsPoi ? root.OrosMapsPoi :
    (typeof require === "function" ? require("./poi-core.js") : null);

  // ---------- texts ----------
  // ov.<overlay>.title / .q / .lg.<legend>, ov.lit.<option>, ov.sw.<option>.
  // Other languages: the "maps" pack.
  var STR = {
    en: {
      "ov.lit.title": "Street lights",
      "ov.lit.q": "Is {name} lit at night?",
      "ov.lit.lg.yes": "Lit",
      "ov.lit.lg.no": "Not lit",
      "ov.lit.lg.miss": "Not known yet",
      "ov.surface.title": "Surface",
      "ov.surface.q": "What is the surface of {name}?",
      "ov.surface.lg.paved": "Asphalt, concrete",
      "ov.surface.lg.stones": "Paving stones, cobbles",
      "ov.surface.lg.gravel": "Gravel",
      "ov.surface.lg.soft": "Ground, grass, sand",
      "ov.surface.lg.other": "Something else",
      "ov.surface.lg.miss": "Not known yet",
      "ov.sidewalk.title": "Sidewalks",
      "ov.sidewalk.q": "Where does {name} have a sidewalk?",
      "ov.sidewalk.lg.both": "Both sides",
      "ov.sidewalk.lg.one": "One side",
      "ov.sidewalk.lg.sep": "Separate path",
      "ov.sidewalk.lg.none": "No sidewalk",
      "ov.sidewalk.lg.miss": "Not known yet",
      "ov.address.title": "Addresses",
      "ov.address.q": "What is the house number of this building?",
      "ov.address.lg.num": "Has a number",
      "ov.address.lg.nonum": "No number or a house name",
      "ov.address.lg.miss": "Not known yet",
      "ov.building.title": "Buildings",
      "ov.building.q": "Floors and kind of this building",
      "ov.building.lg.num": "Floors and kind known",
      "ov.building.lg.yes": "One of them known",
      "ov.building.lg.miss": "Not known yet",
      "ov.lit.yes": "Yes, it has street lights",
      "ov.lit.24/7": "Lit day and night (tunnel)",
      "ov.lit.no": "No",
      "ov.sw.both": "On both sides",
      "ov.sw.left": "Only on the left of the arrows",
      "ov.sw.right": "Only on the right of the arrows",
      "ov.sw.separate": "Drawn as a separate path",
      "ov.sw.no": "No sidewalk"
    },
    el: {
      "ov.lit.title": "Φωτισμός δρόμων",
      "ov.lit.q": "Φωτίζεται τη νύχτα: {name};",
      "ov.lit.lg.yes": "Φωτίζεται",
      "ov.lit.lg.no": "Δεν φωτίζεται",
      "ov.lit.lg.miss": "Άγνωστο ακόμα",
      "ov.surface.title": "Επιφάνεια",
      "ov.surface.q": "Τι επιφάνεια έχει: {name};",
      "ov.surface.lg.paved": "Άσφαλτος, μπετόν",
      "ov.surface.lg.stones": "Πλάκες, καλντερίμι",
      "ov.surface.lg.gravel": "Χαλίκι",
      "ov.surface.lg.soft": "Χώμα, χορτάρι, άμμος",
      "ov.surface.lg.other": "Κάτι άλλο",
      "ov.surface.lg.miss": "Άγνωστο ακόμα",
      "ov.sidewalk.title": "Πεζοδρόμια",
      "ov.sidewalk.q": "Πού έχει πεζοδρόμιο: {name};",
      "ov.sidewalk.lg.both": "Και οι δύο πλευρές",
      "ov.sidewalk.lg.one": "Μία πλευρά",
      "ov.sidewalk.lg.sep": "Ξεχωριστό μονοπάτι",
      "ov.sidewalk.lg.none": "Χωρίς πεζοδρόμιο",
      "ov.sidewalk.lg.miss": "Άγνωστο ακόμα",
      "ov.address.title": "Διευθύνσεις",
      "ov.address.q": "Τι αριθμό έχει αυτό το κτίριο;",
      "ov.address.lg.num": "Έχει αριθμό",
      "ov.address.lg.nonum": "Χωρίς αριθμό ή με όνομα",
      "ov.address.lg.miss": "Άγνωστο ακόμα",
      "ov.building.title": "Κτίρια",
      "ov.building.q": "Όροφοι και είδος του κτιρίου",
      "ov.building.lg.num": "Γνωστοί όροφοι και είδος",
      "ov.building.lg.yes": "Γνωστό το ένα από τα δύο",
      "ov.building.lg.miss": "Άγνωστο ακόμα",
      "ov.lit.yes": "Ναι, έχει φώτα",
      "ov.lit.24/7": "Φωτίζεται μέρα νύχτα (τούνελ)",
      "ov.lit.no": "Όχι",
      "ov.sw.both": "Και στις δύο πλευρές",
      "ov.sw.left": "Μόνο αριστερά από τα βελάκια",
      "ov.sw.right": "Μόνο δεξιά από τα βελάκια",
      "ov.sw.separate": "Σχεδιασμένο ως ξεχωριστό μονοπάτι",
      "ov.sw.no": "Χωρίς πεζοδρόμιο"
    }
  };
  if (typeof window !== "undefined" && window.orosI18n) window.orosI18n.table(STR, "maps", window.orosI18n.lang());
  // { en, el, <pack language>… } of one key (English where a language lacks it)
  function L(k) {
    var r = {};
    Object.keys(STR).forEach(function (c) { var v = STR[c] && STR[c][k]; r[c] = v !== undefined ? v : STR.en[k]; });
    return r;
  }
  function fill(x, k) { var r = L(k); Object.keys(r).forEach(function (c) { x[c] = r[c]; }); return x; }

  var VER = "1.1.0";
  var LIM = { els: 2000, pts: 600 };
  // colours (fixed: they sit on the map, not on the page)
  var C = { yes: "#f2c200", no: "#5c6bc0", miss: "#e53935", paved: "#78909c", stones: "#a1887f",
    gravel: "#d4a54a", soft: "#7cb342", other: "#ab47bc", both: "#2e7d32", one: "#9ccc65", sep: "#1e88e5",
    none: "#757575", num: "#43a047", nonum: "#1e88e5" };

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function okLat(v) { return isNum(v) && v >= -90 && v <= 90; }
  function okLon(v) { return isNum(v) && v >= -180 && v <= 180; }
  function inList(v, list) { return typeof v === "string" && list.indexOf(v) >= 0; }
  function re(list) { return "^(" + list.join("|") + ")$"; }
  // An answer option; its text is STR "ov.<group>.<value>".
  function o(g, v, set) { return fill({ v: v, set: set }, "ov." + g + "." + v); }

  var LIT_HW = ["residential", "living_street", "pedestrian", "footway", "cycleway", "steps", "path", "service",
    "unclassified", "tertiary", "secondary", "primary"];
  var SURF_HW = ["residential", "living_street", "pedestrian", "service", "track", "path", "footway", "cycleway",
    "unclassified", "bridleway", "tertiary", "secondary", "primary", "steps"];
  var WALK_HW = ["residential", "living_street", "unclassified", "tertiary", "secondary", "primary"];
  var SURF_GROUP = {
    asphalt: "paved", concrete: "paved", "concrete:plates": "paved", paved: "paved", chipseal: "paved",
    paving_stones: "stones", sett: "stones", cobblestone: "stones", unhewn_cobblestone: "stones", bricks: "stones",
    compacted: "gravel", fine_gravel: "gravel", gravel: "gravel", pebblestone: "gravel",
    ground: "soft", dirt: "soft", earth: "soft", grass: "soft", sand: "soft", mud: "soft", unpaved: "soft"
  };

  // ---------- sidewalks: what each side has ----------
  // → { l, r } with "yes" | "no" | "separate" | "" (unknown); scheme:
  // "plain" (sidewalk=…), "sub" (sidewalk:left/right), "both" (sidewalk:both) or "" (nothing yet)
  var SW_VAL = { yes: "yes", no: "no", none: "no", separate: "separate" };
  function sides(t) {
    t = t || {};
    var l = "", r = "", scheme = "";
    if (typeof t.sidewalk === "string") {
      scheme = "plain";
      var s = t.sidewalk;
      if (s === "both") { l = r = "yes"; }
      else if (s === "left") { l = "yes"; r = "no"; }
      else if (s === "right") { l = "no"; r = "yes"; }
      else if (s === "no" || s === "none") { l = r = "no"; }
      else if (s === "separate") { l = r = "separate"; }
    }
    if (SW_VAL[t["sidewalk:both"]]) { l = r = SW_VAL[t["sidewalk:both"]]; scheme = scheme || "both"; }
    if (SW_VAL[t["sidewalk:left"]]) { l = SW_VAL[t["sidewalk:left"]]; scheme = scheme || "sub"; }
    if (SW_VAL[t["sidewalk:right"]]) { r = SW_VAL[t["sidewalk:right"]]; scheme = scheme || "sub"; }
    return { l: l, r: r, scheme: scheme };
  }
  var SW_OPTS = [
    o("sw", "both", { l: "yes", r: "yes" }),
    o("sw", "left", { l: "yes", r: "no" }),
    o("sw", "right", { l: "no", r: "yes" }),
    o("sw", "separate", { l: "separate", r: "separate" }),
    o("sw", "no", { l: "no", r: "no" })
  ];
  // Tags for a sidewalk choice, in the scheme the way already uses.
  function sidewalkSet(t, v) {
    var op = SW_OPTS.filter(function (x) { return x.v === v; })[0];
    if (!op) return null;
    var s = sides(t), l = op.set.l, r = op.set.r, set = {};
    if (s.scheme === "both") {
      if (l !== r) return null;            // can't write one side without removing sidewalk:both
      set["sidewalk:both"] = l;
    } else if (s.scheme === "sub") {
      set["sidewalk:left"] = l; set["sidewalk:right"] = r;
    } else {
      set.sidewalk = v;                   // both | left | right | separate | no
    }
    return set;
  }

  // ---------- overlays ----------
  var OVERLAYS = [
    { id: "lit", icon: "💡", qid: "way_lit", kind: "line", zoom: 16,
      sel: 'way["highway"~"' + re(LIT_HW) + '"]',
      applies: function (t) { return inList(t.highway, LIT_HW) && t.indoor !== "yes" && t.area !== "yes"; },
      legend: [["yes"], ["no"], ["miss"]],
      style: function (t) {
        if (t.lit === "no" || t.lit === "disused") return { c: C.no };
        if (t.lit) return { c: C.yes };
        return { c: C.miss, dash: true };
      },
      value: function (t) { return t.lit || ""; },
      options: function () {
        return [o("lit", "yes", { lit: "yes" }),
          o("lit", "24/7", { lit: "24/7" }),
          o("lit", "no", { lit: "no" })];
      } },
    { id: "surface", icon: "🛣️", qid: "way_surface", kind: "line", zoom: 16,
      sel: 'way["highway"~"' + re(SURF_HW) + '"]',
      applies: function (t) { return inList(t.highway, SURF_HW) && t.indoor !== "yes"; },
      legend: [["paved"], ["stones"],
        ["gravel"], ["soft"], ["other"],
        ["miss"]],
      style: function (t) {
        if (!t.surface) return { c: C.miss, dash: true };
        return { c: C[SURF_GROUP[t.surface] || "other"] };
      },
      value: function (t) { return t.surface || ""; },
      options: function () { return Q && Q.BY_ID.way_surface ? Q.BY_ID.way_surface.options : []; } },
    { id: "sidewalk", icon: "🚶", qid: "sidewalk", kind: "line", zoom: 16, arrows: true,
      sel: 'way["highway"~"' + re(WALK_HW) + '"]',
      applies: function (t) { return inList(t.highway, WALK_HW) && t.area !== "yes"; },
      legend: [["both"], ["one"], ["sep"],
        ["none"], ["miss"]],
      style: function (t) {
        var s = sides(t);
        if (!s.l && !s.r) return { c: C.miss, dash: true };
        if (s.l === "yes" && s.r === "yes") return { c: C.both };
        if (s.l === "yes" || s.r === "yes") return { c: C.one, dash: !s.l || !s.r };
        if (s.l === "separate" || s.r === "separate") return { c: C.sep };
        if (s.l === "no" && s.r === "no") return { c: C.none };
        return { c: C.miss, dash: true };
      },
      value: function (t) {
        var s = sides(t);
        return s.l || s.r ? (s.l || "?") + " | " + (s.r || "?") : "";
      },
      options: function (t) {
        var s = sides(t);
        return SW_OPTS.filter(function (x) { return s.scheme !== "both" || x.set.l === x.set.r; });
      } },
    { id: "address", icon: "🔢", qid: "housenumber", kind: "area", zoom: 17, text: true,
      sel: 'way["building"]',
      applies: function (t) { return !!t.building && t.building !== "no"; },
      legend: [["num"], ["nonum"],
        ["miss"]],
      style: function (t) {
        if (t["addr:housenumber"]) return { c: C.num };
        if (t.nohousenumber === "yes" || t["addr:housename"] || t["addr:conscriptionnumber"]) return { c: C.nonum };
        return { c: C.miss, dash: true };
      },
      value: function (t) { return t["addr:housenumber"] || (t.nohousenumber === "yes" ? "-" : t["addr:housename"] || ""); },
      options: function () { return []; } },
    // maps wave 9 (Every Door "Buildings"): floors and kind in one form
    { id: "building", icon: "🏢", qid: "building_levels", kind: "area", zoom: 17, form: true,
      sel: 'way["building"]',
      applies: function (t) { return !!t.building && t.building !== "no" && !t["building:part"]; },
      legend: [["num"], ["yes"],
        ["miss"]],
      style: function (t) {
        var lv = !!t["building:levels"], kd = !!t.building && t.building !== "yes";
        if (lv && kd) return { c: C.num };
        if (lv || kd) return { c: C.yes };
        return { c: C.miss, dash: true };
      },
      value: function (t) {
        var a = [];
        if (t["building:levels"]) a.push(t["building:levels"]);
        if (t.building && t.building !== "yes") a.push(t.building);
        return a.join(" · ");
      },
      options: function () { return []; } }
  ];
  OVERLAYS.forEach(function (x) {
    x.title = L("ov." + x.id + ".title");
    x.q = L("ov." + x.id + ".q");
    x.legend.forEach(function (l) { var k = "ov." + x.id + ".lg." + l[0]; l[1] = STR.en[k]; l[2] = STR.el[k]; });
  });
  var BY_ID = {};
  OVERLAYS.forEach(function (x) { BY_ID[x.id] = x; });
  // A legend line's text in a language (l = one entry of ov.legend).
  function legendText(ov, l, lang) { var r = L("ov." + ov.id + ".lg." + l[0]); return r[lang] || r.en; }
  function legendColor(k) { return C[k] || C.other; }

  // ---------- Overpass ----------
  function query(id, s, w, n, e) {
    var ov = BY_ID[id];
    if (!ov) return "";
    var b = [s, w, n, e].map(function (v) { return (+v).toFixed(6); }).join(",");
    return "[out:json][timeout:25];(" + ov.sel + "(" + b + "););out body geom qt " + LIM.els + ";";
  }
  // → [{ t: "w", id, lat, lon (middle), tags, geom: [[lat, lon]…] }]
  function parse(json, id) {
    var ov = BY_ID[id], out = [];
    var els = json && Array.isArray(json.elements) ? json.elements : [];
    els.forEach(function (x) {
      if (!x || x.type !== "way" || !isNum(x.id) || x.id <= 0 || Math.floor(x.id) !== x.id) return;
      if (!Array.isArray(x.geometry)) return;
      var geom = [];
      x.geometry.forEach(function (p) {
        if (p && okLat(p.lat) && okLon(p.lon) && geom.length < LIM.pts) geom.push([Math.round(p.lat * 1e7) / 1e7, Math.round(p.lon * 1e7) / 1e7]);
      });
      if (geom.length < 2) return;
      var tags = P.cleanTags(x.tags || {});
      if (ov && !ov.applies(tags)) return;
      var mid = middle(geom, ov && ov.kind === "area");
      out.push({ t: "w", id: x.id, lat: mid[0], lon: mid[1], tags: tags, geom: geom, ts: 0 });
    });
    return out.slice(0, LIM.els);
  }
  // A point on the line (halfway along it) or the middle of an area's box.
  function middle(geom, area) {
    if (area) {
      var s = 90, w = 180, n = -90, e = -180;
      geom.forEach(function (p) { s = Math.min(s, p[0]); n = Math.max(n, p[0]); w = Math.min(w, p[1]); e = Math.max(e, p[1]); });
      return [(s + n) / 2, (w + e) / 2];
    }
    var segs = [], tot = 0;
    for (var i = 1; i < geom.length; i++) { var d = dist(geom[i - 1], geom[i]); segs.push(d); tot += d; }
    var half = tot / 2;
    for (var j = 0; j < segs.length; j++) {
      if (half <= segs[j] || j === segs.length - 1) {
        var f = segs[j] ? Math.min(1, half / segs[j]) : 0;
        return [geom[j][0] + (geom[j + 1][0] - geom[j][0]) * f, geom[j][1] + (geom[j + 1][1] - geom[j][1]) * f];
      }
      half -= segs[j];
    }
    return geom[0];
  }
  function dist(a, b) {
    var k = Math.cos((a[0] + b[0]) / 2 * Math.PI / 180);
    var dx = (b[1] - a[1]) * k, dy = b[0] - a[0];
    return Math.sqrt(dx * dx + dy * dy) * 111320;
  }
  // Compass bearing a → b in degrees (0 = north, clockwise).
  function bearing(a, b) {
    var k = Math.cos((a[0] + b[0]) / 2 * Math.PI / 180);
    var deg = Math.atan2((b[1] - a[1]) * k, b[0] - a[0]) * 180 / Math.PI;
    return (deg + 360) % 360;
  }
  // Arrow points along a way for "left / right of the arrows": one per
  // segment longer than `step` metres (at least one), → [{ lat, lon, deg }].
  function arrows(geom, step) {
    var out = [];
    step = step || 40;
    for (var i = 1; i < geom.length && out.length < 30; i++) {
      var a = geom[i - 1], b = geom[i], d = dist(a, b);
      if (d < step && geom.length > 2) continue;
      out.push({ lat: (a[0] + b[0]) / 2, lon: (a[1] + b[1]) / 2, deg: Math.round(bearing(a, b)) });
    }
    if (!out.length) {
      var m = Math.floor((geom.length - 1) / 2);
      out.push({ lat: (geom[m][0] + geom[m + 1][0]) / 2, lon: (geom[m][1] + geom[m + 1][1]) / 2, deg: Math.round(bearing(geom[m], geom[m + 1])) });
    }
    return out;
  }

  // ---------- answers ----------
  // Tags an overlay choice sets on a way: → { set, was } or null (no change / bad).
  function answer(id, el, v) {
    var ov = BY_ID[id];
    if (!ov || !el) return null;
    var t = el.tags || {}, set = null;
    if (ov.id === "sidewalk") set = sidewalkSet(t, v);
    else if (ov.form) set = buildingSet(t, v);
    else if (ov.text) {
      var r = Q.answerSet(Q.BY_ID[ov.qid], { t: el.t, id: el.id, tags: t, ts: el.ts }, v);
      return r;
    } else {
      var op = ov.options(t).filter(function (x) { return x.v === v; })[0];
      if (op) { set = {}; Object.keys(op.set).forEach(function (k) { set[k] = op.set[k]; }); }
    }
    if (!set) return null;
    var was = {};
    Object.keys(set).forEach(function (k) {
      var cur = t[k] === undefined ? "" : t[k];
      if (cur === set[k]) delete set[k]; else was[k] = cur;
    });
    if (!Object.keys(set).length) return null;
    return { set: set, was: was };
  }
  // Buildings form { levels, type }: blank fields stay as they are.
  function buildingKinds() {
    return Q && Q.BY_ID.building_type ? Q.BY_ID.building_type.options : [];
  }
  function buildingSet(t, v) {
    if (!v || typeof v !== "object") return null;
    var set = {};
    var lv = String(v.levels === undefined || v.levels === null ? "" : v.levels).trim();
    if (lv) {
      if (!/^\d{1,3}$/.test(lv) || +lv < 1 || +lv > 200) return null;
      set["building:levels"] = String(+lv);
    }
    if (v.type) {
      var op = buildingKinds().filter(function (x) { return x.v === v.type; })[0];
      if (!op) return null;
      set.building = op.set.building;
    }
    return Object.keys(set).length ? set : null;
  }
  function text(ov, f, lang) { var x = ov && ov[f]; return x ? (x[lang] || x.en) : ""; }

  var api = {
    VER: VER, LIM: LIM, OVERLAYS: OVERLAYS, BY_ID: BY_ID, SW_OPTS: SW_OPTS,
    sides: sides, sidewalkSet: sidewalkSet, buildingSet: buildingSet, buildingKinds: buildingKinds, query: query, parse: parse, middle: middle,
    bearing: bearing, arrows: arrows, answer: answer, legendColor: legendColor, legendText: legendText, text: text
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosMapsOverlays = api;
})(typeof window !== "undefined" ? window : null);
