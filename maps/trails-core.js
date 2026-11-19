// ============================================================
// orOS Maps — trails-core.js (hiking and cycling, wave H1, v1.0.0)
//
// Pure helpers for "About this path": the Overpass queries, the
// nearest way to a point, and a plain-words reading of a way's tags
// (kind, surface, smoothness, hiking difficulty sac_scale, MTB
// difficulty mtb:scale, trail visibility, incline, width, who may use
// it) and of the hiking / cycling routes it belongs to.
//
// Returns i18n KEYS ("trl.…"), never text: trails.js translates. Tag
// values are taken only from fixed lists; a value outside the list is
// returned raw (shown with textContent) or dropped.
// No DOM, no network: tested in tests/maps-trails.test.js.
// ============================================================
(function (root) {
  "use strict";

  // Ways the reading is useful for (roads too: a bike or a walk
  // uses them), so a tap on a paved lane says "Residential street".
  var HW = ["path", "footway", "track", "cycleway", "bridleway", "steps", "pedestrian",
    "living_street", "residential", "unclassified", "service", "tertiary", "secondary",
    "primary", "trunk", "via_ferrata"];
  var ROUTES = ["hiking", "foot", "walking", "bicycle", "mtb"];

  function num(x) { return typeof x === "number" && isFinite(x); }
  function clampR(r) { r = Math.round(+r || 30); return Math.max(10, Math.min(80, r)); }
  function fix(n) { return (+n).toFixed(6); }

  // Ways within r metres of the point, with their geometry.
  function wayQuery(lat, lon, r) {
    if (!num(lat) || !num(lon)) return "";
    return "[out:json][timeout:15];way(around:" + clampR(r) + "," + fix(lat) + "," + fix(lon) +
      ")[highway~\"^(" + HW.join("|") + ")$\"];out tags geom;";
  }
  // The hiking / cycling routes one way belongs to.
  function routeQuery(wayId) {
    var id = Math.floor(+wayId);
    if (!(id > 0)) return "";
    return "[out:json][timeout:15];way(" + id + ");rel(bw)[type=route][route~\"^(" + ROUTES.join("|") + ")$\"];out tags;";
  }

  // Distance in metres from a point to a polyline (equirectangular
  // around the point: exact enough for tens of metres).
  function distToLine(lat, lon, pts) {
    if (!pts || !pts.length) return Infinity;
    var k = Math.cos(lat * Math.PI / 180), R = 6371000 * Math.PI / 180;
    function xy(p) { return [(p[1] - lon) * k * R, (p[0] - lat) * R]; }
    var best = Infinity, a = xy(pts[0]);
    if (pts.length === 1) return Math.sqrt(a[0] * a[0] + a[1] * a[1]);
    for (var i = 1; i < pts.length; i++) {
      var b = xy(pts[i]);
      var dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      var tt = l2 ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / l2)) : 0;
      var px = a[0] + tt * dx, py = a[1] + tt * dy;
      var d = Math.sqrt(px * px + py * py);
      if (d < best) best = d;
      a = b;
    }
    return best;
  }

  // Overpass JSON → the nearest way { id, tags, pts, dist } within
  // maxM metres, else null. Paths win a near tie over roads (a forest
  // path next to a lane is what a hiker taps).
  function nearestWay(json, lat, lon, maxM) {
    var els = json && Array.isArray(json.elements) ? json.elements : [];
    var best = null;
    els.forEach(function (e) {
      if (!e || e.type !== "way" || !Array.isArray(e.geometry) || !e.tags) return;
      var pts = [];
      e.geometry.forEach(function (g) { if (g && num(g.lat) && num(g.lon)) pts.push([g.lat, g.lon]); });
      if (!pts.length) return;
      var d = distToLine(lat, lon, pts);
      var score = d - (isTrail(e.tags.highway) ? 5 : 0);
      if (d <= (maxM || 30) && (!best || score < best.score)) best = { id: e.id, tags: e.tags, pts: pts, dist: d, score: score };
    });
    if (best) delete best.score;
    return best;
  }

  function isTrail(hw) {
    return ["path", "footway", "track", "cycleway", "bridleway", "steps", "via_ferrata"].indexOf(hw) >= 0;
  }

  var SAC = { hiking: 1, mountain_hiking: 2, demanding_mountain_hiking: 3, alpine_hiking: 4,
    demanding_alpine_hiking: 5, difficult_alpine_hiking: 6 };
  var VIS = ["excellent", "good", "intermediate", "bad", "horrible", "no"];
  var SMOOTH = ["excellent", "good", "intermediate", "bad", "very_bad", "horrible", "very_horrible", "impassable"];
  var SURF = {
    paved: "paved", asphalt: "asphalt", concrete: "concrete", "concrete:plates": "concrete", "concrete:lanes": "concrete",
    paving_stones: "paving", sett: "sett", cobblestone: "sett", unhewn_cobblestone: "sett", metal: "metal", wood: "wood",
    unpaved: "unpaved", compacted: "compacted", fine_gravel: "fine_gravel", gravel: "gravel", pebblestone: "gravel",
    rock: "rock", ground: "ground", dirt: "ground", earth: "ground", grass: "grass", grass_paver: "grass",
    sand: "sand", mud: "mud", woodchips: "woodchips", stepping_stones: "rock"
  };
  var PAVED = ["paved", "asphalt", "concrete", "paving", "sett", "metal", "wood"];
  var ACCESS = ["yes", "no", "designated", "permissive", "dismount", "private", "destination"];

  // A way's tags → rows [{ l: label key, v: value key } | { l, raw }],
  // in the order a hiker or cyclist reads them, plus a summary:
  // { kind, name, rows, sac (0-6), mtb (-1 or 0-6), paved (true/false/null) }.
  function describeWay(tags) {
    tags = tags || {};
    var hw = String(tags.highway || "");
    var rows = [];
    var kind = HW.indexOf(hw) >= 0 ? "trl.hw." + hw : "trl.hw.other";
    if (hw === "footway" && tags.footway === "sidewalk") kind = "trl.hw.sidewalk";
    if (hw === "path" && (tags.bicycle === "designated") && (tags.foot === "designated")) kind = "trl.hw.shared";
    var name = String(tags.name || tags.ref || "").slice(0, 120);

    var s = SURF[String(tags.surface || "")] || "";
    if (s) rows.push({ l: "trl.l.surface", v: "trl.surf." + s });
    if (hw === "track" && /^grade[1-5]$/.test(tags.tracktype || "")) rows.push({ l: "trl.l.tracktype", v: "trl.tt." + tags.tracktype });
    var sm = SMOOTH.indexOf(String(tags.smoothness || ""));
    if (sm >= 0) rows.push({ l: "trl.l.smooth", v: "trl.sm." + SMOOTH[sm] });

    var sac = SAC[String(tags.sac_scale || "")] || 0;
    if (sac) rows.push({ l: "trl.l.sac", v: "trl.sac." + sac });
    var mtb = -1, m = String(tags["mtb:scale"] || "").match(/^([0-6])[+-]?$/);
    if (m) { mtb = +m[1]; rows.push({ l: "trl.l.mtb", v: "trl.mtb." + mtb }); }
    var vis = VIS.indexOf(String(tags.trail_visibility || ""));
    if (vis >= 0) rows.push({ l: "trl.l.vis", v: "trl.vis." + VIS[vis] });

    var inc = String(tags.incline || "");
    if (/^-?\d{1,2}(\.\d)?%$/.test(inc)) rows.push({ l: "trl.l.incline", raw: inc });
    else if (inc === "up" || inc === "down") rows.push({ l: "trl.l.incline", v: "trl.inc." + inc });
    if (hw === "steps" && /^\d{1,4}$/.test(tags.step_count || "")) rows.push({ l: "trl.l.steps", raw: String(+tags.step_count) });
    var w = String(tags.width || "").replace(",", ".").match(/^(\d{1,2}(\.\d{1,2})?)\s*(m)?$/);
    if (w) rows.push({ l: "trl.l.width", raw: w[1] + " m" });

    ["foot", "bicycle", "horse"].forEach(function (k) {
      var a = String(tags[k] || "");
      if (ACCESS.indexOf(a) >= 0) rows.push({ l: "trl.l." + k, v: "trl.acc." + a });
    });
    if (tags.segregated === "yes" || tags.segregated === "no") rows.push({ l: "trl.l.segregated", v: "trl.yn." + tags.segregated });
    if (tags.lit === "yes" || tags.lit === "no") rows.push({ l: "trl.l.lit", v: "trl.yn." + tags.lit });
    if (tags.informal === "yes") rows.push({ l: "trl.l.informal", v: "trl.yn.yes" });

    return { kind: kind, name: name, rows: rows, sac: sac, mtb: mtb,
      paved: s ? PAVED.indexOf(s) >= 0 : null, trail: isTrail(hw) };
  }

  var NET = { iwn: "intl", nwn: "national", rwn: "regional", lwn: "local",
    icn: "intl", ncn: "national", rcn: "regional", lcn: "local" };
  var NET_ORDER = { intl: 0, national: 1, regional: 2, local: 3, "": 4 };

  // Overpass JSON of routes → [{ id, kind: "foot"|"bike"|"mtb", name,
  // ref, net: "intl"|…|"", colour (#rrggbb or ""), km (number or 0) }],
  // the widest network first.
  function routesOf(json) {
    var els = json && Array.isArray(json.elements) ? json.elements : [];
    var out = [];
    els.forEach(function (e) {
      if (!e || e.type !== "relation" || !e.tags) return;
      var tg = e.tags, r = String(tg.route || "");
      if (ROUTES.indexOf(r) < 0) return;
      var kind = r === "bicycle" ? "bike" : r === "mtb" ? "mtb" : "foot";
      var col = String(tg.colour || "").toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(col)) col = "";
      var km = parseFloat(String(tg.distance || "").replace(",", "."));
      if (!(km > 0 && km < 20000) || /mi/.test(String(tg.distance))) km = 0;
      out.push({ id: e.id, kind: kind, name: String(tg.name || "").slice(0, 120), ref: String(tg.ref || "").slice(0, 30),
        net: NET[String(tg.network || "")] || "", colour: col, km: km });
    });
    out.sort(function (a, b) { return NET_ORDER[a.net] - NET_ORDER[b.net] || (a.ref + a.name).localeCompare(b.ref + b.name) || a.id - b.id; });
    return out;
  }

  // Links that are always safe (built here from numbers only).
  function wtLink(r) {
    var host = r.kind === "bike" ? "cycling" : r.kind === "mtb" ? "mtb" : "hiking";
    return "https://" + host + ".waymarkedtrails.org/#route?id=" + Math.floor(+r.id);
  }
  function osmWayLink(id) { return "https://www.openstreetmap.org/way/" + Math.floor(+id); }

  var api = {
    HW: HW, ROUTES: ROUTES, wayQuery: wayQuery, routeQuery: routeQuery, distToLine: distToLine,
    nearestWay: nearestWay, describeWay: describeWay, routesOf: routesOf, wtLink: wtLink, osmWayLink: osmWayLink,
    isTrail: isTrail
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosMapsTrails = api;
})(typeof window !== "undefined" ? window : this);
