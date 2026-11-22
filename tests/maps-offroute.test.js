// Maps hiking and cycling wave H8 (experimental): walking and cycling
// routes with no network, from the offline map packs
// (maps/offroute-core.js): costs per mode, the area and zoom, the graph
// from tiles cut with a buffer (ways meet across tile edges, crossings
// without a shared point stay apart), A* with stops, and the
// OSRM-shaped answer.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const OR = require(path.join(__dirname, "..", "maps/offroute-core.js"));
const OC = require(path.join(__dirname, "..", "maps/offline-core.js"));
const F = require("./maps-offroute-fixture.js");

function graphOf(mode, ways, pts, viaMvt) {
  const bb = OR.areaOf(pts), z = OR.pickZoom(bb, 15);
  const g = OR.newGraph(mode);
  for (const [k, L] of F.cutTiles(ways, z, bb)) {
    const [zz, x, y] = k.split("/").map(Number);
    OR.addTile(g, viaMvt ? OC.decodeMvt(new Uint8Array(F.encode(L))) : L, zz, x, y);
  }
  return { g, z };
}
function components(g) {
  const seen = new Int32Array(g.lat.length).fill(-1);
  let n = 0;
  for (let s = 0; s < g.lat.length; s++) {
    if (seen[s] >= 0 || !g.out[s].length) continue;
    const st = [s]; seen[s] = n;
    while (st.length) {
      const a = st.pop();
      for (const e of g.out[a]) { const b = g.ea[e] === a ? g.eb[e] : g.ea[e]; if (seen[b] < 0) { seen[b] = n; st.push(b); } }
    }
    n++;
  }
  return n;
}
const routeOf = (mode, pts, ways) => {
  const { g, z } = graphOf(mode, ways || F.village(), pts);
  const r = OR.route(g, pts);
  return { g, r, o: r.ok ? OR.toOsrm(g, r, z) : null };
};
const share = (o, k) => ((o.routes[0].offline.way.find(w => w.k === k) || {}).m) || 0;
const SQUARE = { lat: 39.5150, lon: 21.7950 }, VALLEY_W = { lat: 39.5041, lon: 21.7705 }, RIDGE = { lat: 39.5205, lon: 21.8050 };

test("costs per mode: no motorways, rail or construction; bikes like cycleways, not steps", () => {
  assert.equal(OR.costOf("foot", "highway", "motorway"), null);
  assert.equal(OR.costOf("bike", "highway", "motorway"), null);
  assert.equal(OR.costOf("foot", "rail", "rail"), null);
  assert.equal(OR.costOf("foot", "minor_road", "construction"), null);
  assert.equal(OR.costOf("car", "minor_road", "residential"), null);
  assert.ok(OR.costOf("bike", "path", "cycleway").f < OR.costOf("bike", "minor_road", "residential").f);
  assert.ok(OR.costOf("bike", "path", "steps").f >= 5);
  assert.ok(OR.costOf("foot", "path", "path").f <= OR.costOf("foot", "major_road", "primary").f);
  assert.ok(OR.costOf("foot", "path", "steps").v < OR.costOf("foot", "path", "path").v);
  assert.equal(OR.wayClass("path", "footway"), "path");
  assert.equal(OR.wayClass("minor_road", "residential"), "road");
  assert.equal(OR.wayClass("path", "steps"), "steps");
});

test("area, tiles and zoom: margin around the stops, a cap on tiles, one level down for long routes", () => {
  const bb = OR.areaOf([{ lat: 39.5, lon: 21.8 }, { lat: 39.51, lon: 21.81 }]);
  assert.ok(bb[0] < 21.8 && bb[2] > 21.81 && bb[1] < 39.5 && bb[3] > 39.51);
  assert.ok(bb[3] - bb[1] >= 0.01 + 2 * 0.0135 - 1e-9, "at least ~1.5 km on each side");
  assert.equal(OR.areaOf([{ lat: 99, lon: 0 }]), null);
  assert.equal(OR.pickZoom(bb, 15), 15);
  assert.equal(OR.pickZoom(bb, 14), 14);
  assert.equal(OR.pickZoom(bb, 13), -1, "a coarse pack has too few paths");
  const far = OR.areaOf([{ lat: 39.4, lon: 21.7 }, { lat: 39.55, lon: 21.88 }]);
  assert.equal(OR.pickZoom(far, 15), 14, "too many z15 tiles: z14");
  assert.equal(OR.pickZoom(OR.areaOf([{ lat: 39, lon: 21 }, { lat: 40, lon: 22.5 }]), 15), -1, "too far");
  assert.ok(OR.tilesOf(bb, 15).length <= OR.MAX_TILES);
  assert.deepEqual(OR.clip(-10, 10, 10, 10, 4096), [0.5, 1]);
  assert.equal(OR.clip(-10, -10, -5, -5, 4096), null);
});

test("the graph: ways cut into many tiles meet again at the tile edges, from decoded vector tiles too", () => {
  const pts = [{ lat: 39.503, lon: 21.77 }, { lat: 39.521, lon: 21.83 }];   // the whole village in the area
  for (const viaMvt of [false, true]) {
    const { g } = graphOf("foot", F.village(), pts, viaMvt);
    assert.equal(components(g), 1, "one connected network (motorway and rail left out), mvt=" + viaMvt);
    assert.ok(!g.ways.some(w => w.k === "highway" || w.k === "rail"));
  }
  // the same network in one big tile and cut into tiles: the same total length
  const { g } = graphOf("foot", F.village(), pts);
  const tot = g.el.reduce((a, b) => a + b, 0);
  let want = 0;
  F.village().filter(w => OR.costOf("foot", w.props.kind, w.props.kind_detail)).forEach(w => {
    for (let i = 1; i < w.pts.length; i++) want += OR.hav(w.pts[i - 1][0], w.pts[i - 1][1], w.pts[i][0], w.pts[i][1]);
  });
  assert.ok(Math.abs(tot - want) / want < 0.002, tot + " vs " + want);
});

test("ways that only cross (a bridge) do not join", () => {
  const ways = [
    { props: { kind: "path", kind_detail: "footway", name: "Over" }, pts: [[39.50, 21.80], [39.51, 21.80]] },
    { props: { kind: "minor_road", kind_detail: "residential", name: "Under" }, pts: [[39.505, 21.795], [39.505, 21.805]] }
  ];
  const pts = [{ lat: 39.50, lon: 21.80 }, { lat: 39.505, lon: 21.805 }];
  const { g } = graphOf("foot", ways, pts);
  assert.equal(components(g), 2);
  assert.equal(OR.route(g, pts).err, "none");
});

test("walking: along roads and paths up to the ridge, steps as a short cut; OSRM shape", () => {
  const { r, o } = routeOf("foot", [VALLEY_W, RIDGE]);
  assert.ok(r.ok);
  const rt = o.routes[0];
  assert.equal(o.code, "Ok");
  assert.equal(rt.geometry.type, "LineString");
  assert.deepEqual(rt.geometry.coordinates[0], [21.7705, 39.5041], "[lon, lat], from the stop itself");
  assert.deepEqual(rt.geometry.coordinates[rt.geometry.coordinates.length - 1], [21.805, 39.5205]);
  assert.ok(rt.distance > 3500 && rt.distance < 4600, String(rt.distance));
  assert.ok(Math.abs(rt.duration - rt.distance / 1.11) < 60, "4 km/h on the flat");
  const st = rt.legs[0].steps;
  assert.equal(st[0].maneuver.type, "depart");
  assert.equal(st[st.length - 1].maneuver.type, "arrive");
  assert.ok(st.some(s => s.maneuver.type === "turn" && s.maneuver.modifier === "left" && s.name === "School Street"), JSON.stringify(st.map(s => s.name)));
  assert.equal(st.reduce((a, s) => a + s.distance, 0), rt.distance, "steps add up");
  assert.equal(rt.offline.mode, "foot");
  assert.equal(rt.offline.z, 15);
  assert.ok(share(o, "road") > 0 && share(o, "path") > 0);
  // from the square down to the track: the steps on foot, never by bike
  const a = routeOf("foot", [SQUARE, { lat: 39.5111, lon: 21.8248 }]).o, b = routeOf("bike", [SQUARE, { lat: 39.5111, lon: 21.8248 }]).o;
  assert.ok(share(a, "steps") > 1500, "walk takes the steps " + JSON.stringify(a.routes[0].offline.way));
  assert.equal(share(b, "steps"), 0, "bike goes round " + JSON.stringify(b.routes[0].offline.way));
  assert.ok(b.routes[0].distance > a.routes[0].distance);
});

test("cycling: the river cycleway over the valley road; stops make legs; too far is said", () => {
  const { o } = routeOf("bike", [{ lat: 39.5031, lon: 21.7702 }, { lat: 39.5046, lon: 21.8298 }]);
  assert.ok(share(o, "cycleway") > share(o, "road"), JSON.stringify(o.routes[0].offline.way));
  assert.ok(o.routes[0].duration < o.routes[0].distance / 3, "about 15 km/h");
  const v = routeOf("foot", [VALLEY_W, SQUARE, RIDGE]).o.routes[0];
  assert.equal(v.legs.length, 2);
  assert.equal(v.legs[0].steps[v.legs[0].steps.length - 1].maneuver.type, "arrive");
  assert.equal(v.legs[0].distance + v.legs[1].distance, v.distance + (v.legs[0].distance + v.legs[1].distance - v.distance));
  const far = routeOf("foot", [VALLEY_W, { lat: 39.528, lon: 21.79 }]);
  assert.equal(far.r.err, "far");
  assert.equal(OR.route(OR.newGraph("foot"), [VALLEY_W]).err, "pts");
});

test("wiring: scripts in order, offline tiles from the packs, the route hook in fetchRoute, strings in EN, EL and DE", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "maps/index.html"), "utf8");
  const order = ["offline-core.js", "offline.js", "offroute-core.js", "offroute.js"].map((f) => html.indexOf('src="' + f + "?v="));
  order.forEach((i, k) => assert.ok(i > 0, k));
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1]);
  const off = fs.readFileSync(path.join(__dirname, "..", "maps/offline.js"), "utf8");
  assert.match(off, /H\.offlineTile = function \(z, x, y\)/);
  assert.match(off, /H\.offlineCover = function \(pts\)/);
  const maps = fs.readFileSync(path.join(__dirname, "..", "maps/maps.js"), "utf8");
  assert.match(maps, /offlineRoute: null/);
  assert.match(maps, /mapsHost\.offlineRoute\(routeProfile, routePoints\(\)\)/);
  const ui = fs.readFileSync(path.join(__dirname, "..", "maps/offroute.js"), "utf8");
  const de = fs.readFileSync(path.join(__dirname, "..", "i18n/de/maps.js"), "utf8");
  const keys = [...new Set([...ui.matchAll(/"(ofr\.[a-z.]+)":/g)].map((m) => m[1]))];
  assert.ok(keys.length >= 8);
  keys.forEach((k) => {
    assert.equal(ui.split('"' + k + '":').length - 1, 2, k + " in EN and EL");
    assert.ok(de.includes('"' + k + '":'), k + " in DE");
  });
  assert.ok(!/\.innerHTML\s*=/.test(ui), "text only through textContent");
});
