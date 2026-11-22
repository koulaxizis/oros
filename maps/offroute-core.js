// ============================================================
// orOS Maps — offroute-core.js (walking and cycling routes with no
// network, from the offline map packs; hiking and cycling wave H8,
// experimental, v1.0.0). Pure functions, no DOM, no network:
// Node-tested in tests/maps-offroute.test.js.
//
//   - The roads layer of the pack's vector tiles (Protomaps basemap:
//     kind highway / major_road / minor_road / path / other, kind_detail
//     = the OSM highway value) becomes a graph. Each tile is cut to its
//     own square (the buffer around a tile is dropped), so a way that
//     crosses a tile edge meets its other half there: real vertices are
//     joined by their exact place on the zoom's pixel grid, points on a
//     tile edge by a small tolerance along that edge. Ways that only
//     cross (a bridge over a street) never join.
//   - A cost per kind of way and mode (foot: never motorways, roads a
//     little dearer than paths; bike: cycleways cheaper, steps and
//     footways much dearer, one-way roads against the flow pushed).
//   - A* from the nearest usable point to each stop, leg by leg.
//   - The answer in the shape of an OSRM route (geometry, distance,
//     duration, legs with steps: depart, turns, arrive at each stop),
//     plus `offline: { mode, z, way }` with the kinds of way.
//
// Tiles carry no heights, so the walking time is the flat 4 km/h of the
// hiking rule (DIN 33466) and the bike time 15 km/h, slower on tracks,
// paths and steps. One-way, access and turn restrictions are not in the
// tiles: the route is a suggestion to check on the spot.
//
// API: window.OrosMapsOffRoute (module.exports in Node).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.0.0";
  var R = 6371008.8;
  var MAX_TILES = 400;           // tiles read for one route
  var MAX_SNAP = 500;            // metres from a stop to the nearest usable way
  var EDGE_TOL = 3;              // pixel units (of 4096) along a tile edge
  var MIN_ZOOM = 14;             // packs below this level have too few paths

  function num(x) { return typeof x === "number" && isFinite(x); }
  function okPt(p) { return p && num(p.lat) && num(p.lon) && p.lat >= -85 && p.lat <= 85 && p.lon >= -180 && p.lon <= 180; }
  function hav(aLat, aLon, bLat, bLon) {
    var r = Math.PI / 180, dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
    var s = Math.sin(dLat / 2), t = Math.sin(dLon / 2);
    var h = s * s + Math.cos(aLat * r) * Math.cos(bLat * r) * t * t;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function bearing(aLat, aLon, bLat, bLon) {
    var r = Math.PI / 180, y = Math.sin((bLon - aLon) * r) * Math.cos(bLat * r);
    var x = Math.cos(aLat * r) * Math.sin(bLat * r) - Math.sin(aLat * r) * Math.cos(bLat * r) * Math.cos((bLon - aLon) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }

  // ---------- tiles ----------
  function lonToX(lon, z) { return (lon + 180) / 360 * Math.pow(2, z); }
  function latToY(lat, z) {
    var r = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z);
  }
  function xToLon(x, z) { return x / Math.pow(2, z) * 360 - 180; }
  function yToLat(y, z) { var n = Math.PI - 2 * Math.PI * y / Math.pow(2, z); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); }

  // The box the route may use: the stops' box, a margin of a quarter of
  // its size (at least ~1.5 km) on every side. [w, s, e, n]
  function areaOf(pts) {
    var w = 180, s = 90, e = -180, n = -90;
    (pts || []).forEach(function (p) {
      if (!okPt(p)) return;
      w = Math.min(w, p.lon); e = Math.max(e, p.lon); s = Math.min(s, p.lat); n = Math.max(n, p.lat);
    });
    if (w > e) return null;
    var my = Math.max(0.0135, (n - s) * 0.25);
    var mx = Math.max(0.0135 / Math.max(0.2, Math.cos((s + n) / 2 * Math.PI / 180)), (e - w) * 0.25);
    return [Math.max(-180, w - mx), Math.max(-85, s - my), Math.min(180, e + mx), Math.min(85, n + my)];
  }
  function tilesOf(bbox, z) {
    var x0 = Math.floor(lonToX(bbox[0], z)), x1 = Math.floor(lonToX(bbox[2], z));
    var y0 = Math.floor(latToY(bbox[3], z)), y1 = Math.floor(latToY(bbox[1], z));
    var n = Math.pow(2, z) - 1, out = [];
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(n, x1); y1 = Math.min(n, y1);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES) return null;
    for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) out.push([z, x, y]);
    return out;
  }
  // The zoom to read: the pack's own top level (15 at most), one level
  // less when the area needs too many tiles; -1 when even that is too
  // big or the pack is too coarse.
  function pickZoom(bbox, maxz) {
    var top = Math.min(15, maxz | 0);
    for (var z = top; z >= Math.max(MIN_ZOOM, top - 1); z--) if (tilesOf(bbox, z)) return z;
    return -1;
  }

  // ---------- costs ----------
  // → { f: cost factor per metre, v: speed m/s } or null (not usable)
  var CLS = { cycleway: "cycleway", steps: "steps", track: "track", path: "path", footway: "path", pedestrian: "path", bridleway: "path" };
  function wayClass(kind, det) {
    if (kind === "path" || kind === "") {
      if (CLS[det]) return CLS[det];
      if (kind === "path") return "path";
    }
    if (kind === "highway" || kind === "major_road" || kind === "minor_road" || kind === "other") return "road";
    return "other";
  }
  function costOf(mode, kind, det) {
    if (kind === "rail" || kind === "ferry" || kind === "aerialway" || det === "construction" || det === "proposed" || det === "raceway") return null;
    var c = wayClass(kind, det);
    if (mode === "foot") {
      if (kind === "highway" || det === "motorway" || det === "motorway_link") return null;
      if (det === "trunk" || det === "trunk_link") return { f: 2.5, v: 1.11 };
      if (kind === "major_road") return { f: 1.4, v: 1.11 };
      if (c === "steps") return { f: 1.1, v: 0.7 };
      if (c === "cycleway") return { f: 1.2, v: 1.11 };
      if (c === "path" || c === "track") return { f: 1, v: 1.11 };
      if (det === "service") return { f: 1.15, v: 1.11 };
      return { f: 1.05, v: 1.11 };
    }
    if (mode === "bike") {
      if (kind === "highway" || det === "motorway" || det === "motorway_link") return null;
      if (det === "trunk" || det === "trunk_link") return { f: 3, v: 4.17 };
      if (kind === "major_road") return { f: det === "primary" ? 1.8 : 1.4, v: 4.17 };
      if (c === "cycleway") return { f: 0.8, v: 4.17 };
      if (c === "steps") return { f: 8, v: 0.5 };
      if (det === "footway" || det === "pedestrian") return { f: 2.2, v: 1.5 };
      if (c === "track") return { f: 1.3, v: 3.3 };
      if (c === "path") return { f: det === "bridleway" ? 2 : 1.5, v: 2.8 };
      if (det === "service") return { f: 1.2, v: 4.17 };
      return { f: 1, v: 4.17 };
    }
    return null;
  }
  function onewayOf(props) {
    var o = props.oneway;
    if (o === true || o === "yes" || o === 1 || o === "1") return 1;
    if (o === "-1" || o === -1) return -1;
    return 0;
  }

  // ---------- graph ----------
  // nodes: lat[], lon[], out[] (edge ids); edges: a, b, len, way, ow
  // (1 = only a→b by the flow); ways: { k, d, n } kind, detail, name.
  function newGraph(mode) {
    return { mode: mode, lat: [], lon: [], out: [], ea: [], eb: [], el: [], ew: [], eo: [],
      ways: [], wayKey: {}, keys: {}, edgeKeys: {} };
  }
  function nodeAt(g, key, lat, lon) {
    var i = g.keys[key];
    if (i !== undefined) return i;
    i = g.lat.length;
    g.keys[key] = i;
    g.lat.push(lat); g.lon.push(lon); g.out.push([]);
    return i;
  }
  // A point on a tile edge: the edge line ("v<gx>" or "h<gy>") and the
  // place along it, joined with a point within EDGE_TOL of it.
  function edgeNode(g, line, pos, lat, lon) {
    var b = Math.floor(pos / EDGE_TOL);
    for (var d = -1; d <= 1; d++) {
      var list = g.keys["e" + line + ":" + (b + d)];
      if (!list) continue;
      for (var j = 0; j < list.length; j++) if (Math.abs(list[j][0] - pos) <= EDGE_TOL) return list[j][1];
    }
    var i = g.lat.length;
    g.lat.push(lat); g.lon.push(lon); g.out.push([]);
    var k = "e" + line + ":" + b;
    (g.keys[k] = g.keys[k] || []).push([pos, i]);
    return i;
  }
  function wayId(g, kind, det, name) {
    var k = kind + "|" + det + "|" + name;
    var i = g.wayKey[k];
    if (i === undefined) { i = g.ways.length; g.ways.push({ k: kind, d: det, n: name }); g.wayKey[k] = i; }
    return i;
  }
  function addEdge(g, a, b, w, ow) {
    if (a === b) return;
    var key = a < b ? a + "-" + b : b + "-" + a;
    if (g.edgeKeys[key] !== undefined) return;     // the same piece from two tiles
    var len = hav(g.lat[a], g.lon[a], g.lat[b], g.lon[b]);
    var e = g.ea.length;
    g.edgeKeys[key] = e;
    g.ea.push(a); g.eb.push(b); g.el.push(len); g.ew.push(w); g.eo.push(ow);
    g.out[a].push(e); g.out[b].push(e);
  }
  // Liang-Barsky: the part of segment p→q inside [0, E]² as [t0, t1], or null.
  function clip(px, py, qx, qy, E) {
    var t0 = 0, t1 = 1, dx = qx - px, dy = qy - py;
    var P = [-dx, dx, -dy, dy], Q = [px, E - px, py, E - py];
    for (var i = 0; i < 4; i++) {
      if (P[i] === 0) { if (Q[i] < 0) return null; continue; }
      var r = Q[i] / P[i];
      if (P[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    return t0 < t1 ? [t0, t1] : null;
  }
  // Adds the usable ways of one decoded tile (offline-core decodeMvt).
  function addTile(g, layers, z, x, y) {
    var L = layers && layers.roads;
    if (!L || !Array.isArray(L.features)) return 0;
    var ext = L.extent || 4096, sc = 4096 / ext, E = 4096, added = 0;
    var Z = z + 12;                                   // the pixel grid: 4096 per tile
    function ll(gx, gy) { return [yToLat(gy, Z), xToLon(gx, Z)]; }
    function point(lx, ly, real) {
      var gx = x * E + lx, gy = y * E + ly;
      if (real) {
        var rx = Math.round(gx), ry = Math.round(gy), c = ll(rx, ry);
        return nodeAt(g, rx + "," + ry, c[0], c[1]);
      }
      var p = ll(gx, gy);
      if (lx <= 1e-6 || lx >= E - 1e-6) return edgeNode(g, "v" + Math.round(gx), gy, p[0], p[1]);
      return edgeNode(g, "h" + Math.round(gy), gx, p[0], p[1]);
    }
    L.features.forEach(function (f) {
      if (!f || f.type !== 2 || !Array.isArray(f.geom)) return;
      var pr = f.props || {};
      var kind = String(pr.kind || pr["pmap:kind"] || ""), det = String(pr.kind_detail || pr["pmap:kind_detail"] || "");
      if (!costOf(g.mode, kind, det)) return;
      var w = wayId(g, kind, det, String(pr.name || "").slice(0, 80)), ow = onewayOf(pr);
      f.geom.forEach(function (part) {
        for (var i = 0; i + 3 < part.length; i += 2) {
          var px = part[i] * sc, py = part[i + 1] * sc, qx = part[i + 2] * sc, qy = part[i + 3] * sc;
          var c = clip(px, py, qx, qy, E);
          if (!c) continue;
          var a = c[0] === 0 ? point(px, py, true) : point(px + (qx - px) * c[0], py + (qy - py) * c[0], false);
          var b = c[1] === 1 ? point(qx, qy, true) : point(px + (qx - px) * c[1], py + (qy - py) * c[1], false);
          if (ow === -1) addEdge(g, b, a, w, 1); else addEdge(g, a, b, w, ow);
          added++;
        }
      });
    });
    return added;
  }

  // ---------- search ----------
  function Heap() { this.k = []; this.v = []; }
  Heap.prototype.push = function (key, val) {
    var k = this.k, v = this.v, i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  };
  Heap.prototype.pop = function () {
    var k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop(), n = k.length;
    if (n) {
      var i = 0;
      for (;;) {
        var l = 2 * i + 1, r = l + 1, m = i, mk = lk;
        if (l < n && k[l] < mk) { m = l; mk = k[l]; }
        if (r < n && k[r] < mk) { m = r; mk = k[r]; }
        if (m === i) break;
        k[i] = k[m]; v[i] = v[m]; i = m;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  };
  // The edge cost from node `from` over edge e, or Infinity.
  function edgeCost(g, e, from) {
    var w = g.ways[g.ew[e]], c = costOf(g.mode, w.k, w.d);
    if (!c) return Infinity;
    var f = c.f;
    if (g.eo[e] === 1 && from !== g.ea[e]) {
      if (g.mode === "bike" && w.k !== "path") f *= 4;     // against a one-way road: pushing
    }
    return g.el[e] * f;
  }
  // The nearest point of the graph to p: on an edge (projected), within MAX_SNAP.
  function snap(g, p) {
    var best = null, kx = Math.cos(p.lat * Math.PI / 180) * 111320, ky = 110540;
    for (var e = 0; e < g.ea.length; e++) {
      var a = g.ea[e], b = g.eb[e];
      var ax = (g.lon[a] - p.lon) * kx, ay = (g.lat[a] - p.lat) * ky, bx = (g.lon[b] - p.lon) * kx, by = (g.lat[b] - p.lat) * ky;
      var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      var t = L2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
      var cx = ax + dx * t, cy = ay + dy * t, d = Math.sqrt(cx * cx + cy * cy);
      if (!best || d < best.d) best = { e: e, t: t, d: d, lat: p.lat + cy / ky, lon: p.lon + cx / kx };
    }
    return best && best.d <= MAX_SNAP ? best : null;
  }
  // A* from snapped point s to snapped point t: → { nodes: [...], edges: [...] } or null.
  function astar(g, s, t) {
    var N = g.lat.length, MIN = g.mode === "bike" ? 0.8 : 1;
    var gs = new Float64Array(N + 2), prevE = new Int32Array(N + 2), prevN = new Int32Array(N + 2), done = new Uint8Array(N + 2);
    for (var i = 0; i < N + 2; i++) { gs[i] = Infinity; prevE[i] = -1; prevN[i] = -1; }
    var S = N, T = N + 1;                       // the two snapped points as extra nodes
    var tLat = t.lat, tLon = t.lon;
    function h(n) { return hav(n === S ? s.lat : g.lat[n], n === S ? s.lon : g.lon[n], tLat, tLon) * MIN; }
    var heap = new Heap();
    gs[S] = 0;
    heap.push(h(S), S);
    // the snapped start reaches its edge's two ends (and the goal on the same edge)
    function startEdges(n) {
      var out = [], e = s.e, a = g.ea[e], b = g.eb[e], L = g.el[e];
      var c = edgeCost(g, e, a) / (L || 1), cb = edgeCost(g, e, b) / (L || 1);
      if (isFinite(c)) out.push([b, L * (1 - s.t) * c, e]);
      if (isFinite(cb)) out.push([a, L * s.t * cb, e]);
      if (t.e === e) {
        var fwd = t.t >= s.t;
        var cc = fwd ? c : cb;
        if (isFinite(cc)) out.push([T, Math.abs(t.t - s.t) * L * cc, e]);
      }
      return out;
    }
    var guard = 0;
    while (heap.k.length) {
      var n = heap.pop();
      if (done[n]) continue;
      done[n] = 1;
      if (n === T) break;
      if (++guard > 3000000) return null;
      var nexts = [];
      if (n === S) nexts = startEdges(n);
      else {
        var list = g.out[n];
        for (var j = 0; j < list.length; j++) {
          var e = list[j], o = g.ea[e] === n ? g.eb[e] : g.ea[e];
          var c = edgeCost(g, e, n);
          if (!isFinite(c)) continue;
          nexts.push([o, c, e]);
          if (e === t.e) {                       // the goal lies on this edge
            var L = g.el[e], part = g.ea[e] === n ? t.t : 1 - t.t;
            nexts.push([T, c * part, e]);
          }
        }
      }
      for (var q = 0; q < nexts.length; q++) {
        var m = nexts[q][0], ng = gs[n] + nexts[q][1];
        if (ng < gs[m]) {
          gs[m] = ng; prevN[m] = n; prevE[m] = nexts[q][2];
          heap.push(ng + (m === T ? 0 : h(m)), m);
        }
      }
    }
    if (!isFinite(gs[T])) return null;
    var nodes = [], edges = [], cur = T;
    while (cur !== -1) { nodes.push(cur); edges.push(prevE[cur]); cur = prevN[cur]; }
    nodes.reverse(); edges.reverse();
    return { nodes: nodes, edges: edges.slice(1) };
  }

  // ---------- the route ----------
  // pts: [{lat, lon}…] (start, stops, end). → { ok: true, legs: [{ pts:
  // [[lat, lon]…], ways: [way per segment], deg: [edges at each point] }] } or { err:
  // "pts" | "far" | "none" }
  function pusher(lp, ways, deg) {
    return function (lat, lon, w, d) {
      var l = lp[lp.length - 1];
      if (Math.abs(l[0] - lat) < 1e-9 && Math.abs(l[1] - lon) < 1e-9) return;
      lp.push([lat, lon]); ways.push(w); deg.push(d || 0);
    };
  }
  function route(g, pts) {
    pts = (pts || []).filter(okPt);
    if (pts.length < 2) return { err: "pts" };
    var sn = pts.map(function (p) { return snap(g, p); });
    if (sn.some(function (x) { return !x; })) return { err: "far" };
    var legs = [];
    for (var i = 0; i + 1 < sn.length; i++) {
      var r = astar(g, sn[i], sn[i + 1]);
      if (!r) return { err: "none" };
      var N = g.lat.length, lp = [[pts[i].lat, pts[i].lon]], ways = [], deg = [0];
      var push = pusher(lp, ways, deg);
      var w0 = g.ew[sn[i].e];
      push(sn[i].lat, sn[i].lon, w0);
      for (var k = 1; k < r.nodes.length; k++) {
        var nd = r.nodes[k], w = g.ew[r.edges[k - 1]];
        if (nd === N + 1) push(sn[i + 1].lat, sn[i + 1].lon, w);
        else push(g.lat[nd], g.lon[nd], w, g.out[nd].length);
      }
      push(pts[i + 1].lat, pts[i + 1].lon, ways.length ? ways[ways.length - 1] : w0);
      legs.push({ pts: lp, ways: ways, deg: deg });
    }
    return { ok: true, legs: legs };
  }

  function modOf(turn) {
    var a = Math.abs(turn), side = turn > 0 ? "right" : "left";
    if (a >= 165) return "uturn";
    if (a >= 120) return "sharp " + side;
    if (a >= 55) return side;
    return "slight " + side;
  }
  function speedOf(mode, way) {
    var c = costOf(mode, way.k, way.d);
    return c ? c.v : (mode === "bike" ? 4.17 : 1.11);
  }
  // → an OSRM-shaped answer { code, routes: [route] } or null.
  function toOsrm(g, res, z) {
    if (!res || !res.ok) return null;
    var coords = [], legsOut = [], total = 0, time = 0, kinds = {};
    res.legs.forEach(function (leg, li) {
      var P = leg.pts, W = leg.ways, cum = [0], dur = [0];
      for (var i = 1; i < P.length; i++) {
        var d = hav(P[i - 1][0], P[i - 1][1], P[i][0], P[i][1]), way = g.ways[W[i - 1]] || { k: "", d: "" };
        cum.push(cum[i - 1] + d);
        dur.push(dur[i - 1] + d / speedOf(g.mode, way));
        var cls = wayClass(way.k, way.d);
        kinds[cls] = (kinds[cls] || 0) + d;
      }
      // maneuvers: depart, turns where the way bends at a junction or
      // the name changes, arrive
      var marks = [{ i: 0, type: "depart", mod: "", w: W[0] }];
      // (points 1 and n-2 are where the stops meet the graph: no turn there)
      for (var j = 2; j + 2 < P.length; j++) {
        var b1 = bearing(P[j - 1][0], P[j - 1][1], P[j][0], P[j][1]), b2 = bearing(P[j][0], P[j][1], P[j + 1][0], P[j + 1][1]);
        var turn = ((b2 - b1 + 540) % 360) - 180;
        var wa = g.ways[W[j - 1]], wb = g.ways[W[j]];
        var named = wa && wb && wb.n && wa.n !== wb.n;
        var last = marks[marks.length - 1];
        if (cum[j] - cum[last.i] < 12) continue;
        if (!(leg.deg[j] >= 3)) continue;           // a bend of the way, not a junction
        if (Math.abs(turn) >= 35 || (named && Math.abs(turn) >= 20)) marks.push({ i: j, type: "turn", mod: modOf(turn), w: W[j] });
        else if (named) marks.push({ i: j, type: "new name", mod: "straight", w: W[j] });
      }
      marks.push({ i: P.length - 1, type: "arrive", mod: "", w: W[W.length - 1] });
      var steps = marks.map(function (m, k) {
        var nx = marks[k + 1], d = nx ? cum[nx.i] - cum[m.i] : 0, s = nx ? dur[nx.i] - dur[m.i] : 0;
        var way = g.ways[m.w];
        return { maneuver: { type: m.type, modifier: m.mod, location: [P[m.i][1], P[m.i][0]] },
          name: way && m.type !== "arrive" ? way.n : "", distance: Math.round(d), duration: Math.round(s) };
      });
      legsOut.push({ steps: steps, distance: Math.round(cum[cum.length - 1]), duration: Math.round(dur[dur.length - 1]) });
      total += cum[cum.length - 1];
      time += dur[dur.length - 1];
      P.forEach(function (p, i) {
        if (li > 0 && i === 0) return;
        coords.push([Math.round(p[1] * 1e6) / 1e6, Math.round(p[0] * 1e6) / 1e6]);
      });
    });
    var way = [];
    Object.keys(kinds).forEach(function (k) { if (kinds[k] >= 1) way.push({ k: k, m: Math.round(kinds[k]) }); });
    way.sort(function (a, b) { return b.m - a.m || (a.k < b.k ? -1 : 1); });
    return { code: "Ok", routes: [{ distance: Math.round(total), duration: Math.round(time),
      geometry: { type: "LineString", coordinates: coords }, legs: legsOut,
      offline: { mode: g.mode, z: z, way: way } }] };
  }

  var api = {
    VER: VER, MAX_TILES: MAX_TILES, MAX_SNAP: MAX_SNAP, MIN_ZOOM: MIN_ZOOM,
    areaOf: areaOf, tilesOf: tilesOf, pickZoom: pickZoom, costOf: costOf, wayClass: wayClass, clip: clip,
    newGraph: newGraph, addTile: addTile, snap: snap, route: route, toOsrm: toOsrm, hav: hav, bearing: bearing,
    lonToX: lonToX, latToY: latToY, xToLon: xToLon, yToLat: yToLat
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosMapsOffRoute = api;
})(typeof window !== "undefined" ? window : this);
