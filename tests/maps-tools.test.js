// Pure logic of the OsmAnd style tools (maps/tools-core.js, maps wave
// 10A): ruler length and area, their display, the parking record and
// its reminder, OSM maxspeed values, the route corridor for the
// Overpass query, and picking the way the car is on.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const TC = require(path.join(__dirname, "..", "maps", "tools-core.js"));
const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");

test("ruler: length of a line and of a closed shape", () => {
  // 0.01° of latitude ≈ 1111.95 m
  const a = [40, 22], b = [40.01, 22], c = [40.01, 22.01];
  assert.ok(Math.abs(TC.length([a, b]) - 1111.95) < 1);
  const open = TC.length([a, b, c]);
  const closed = TC.length([a, b, c], true);
  assert.ok(closed > open);
  assert.ok(Math.abs(closed - open - TC.dist(c, a)) < 1e-6);
  assert.equal(TC.length([a]), 0);
  assert.equal(TC.length([]), 0);
  assert.equal(TC.length(null), 0);
  // Bad points are skipped, not NaN
  assert.ok(Math.abs(TC.length([a, [NaN, 1], b, "x", [100, 0]]) - 1111.95) < 1);
});

test("ruler: area of a square and a triangle", () => {
  // ~100 m × 100 m square at 38° N
  const lat = 38, dLat = 100 / 111195, dLon = 100 / (111195 * Math.cos(lat * Math.PI / 180));
  const sq = [[lat, 23], [lat + dLat, 23], [lat + dLat, 23 + dLon], [lat, 23 + dLon]];
  assert.ok(Math.abs(TC.area(sq) - 10000) < 30, String(TC.area(sq)));
  // Same in the other direction
  assert.ok(Math.abs(TC.area(sq.slice().reverse()) - 10000) < 30);
  assert.ok(Math.abs(TC.area(sq.slice(0, 3)) - 5000) < 20);
  assert.equal(TC.area(sq.slice(0, 2)), 0);
});

test("ruler: display in EN and EL (στρέμματα)", () => {
  assert.equal(TC.fmtLen(0, "en"), "0 m");
  assert.equal(TC.fmtLen(456.4, "en"), "456 m");
  assert.equal(TC.fmtLen(1234, "en"), "1.23 km");
  assert.equal(TC.fmtLen(1234, "el"), "1,23 χλμ.");
  assert.equal(TC.fmtLen(25400, "en"), "25.4 km");
  assert.equal(TC.fmtLen(80, "el"), "80 μ.");
  assert.equal(TC.fmtArea(950, "en"), "950 m²");
  assert.equal(TC.fmtArea(25000, "en"), "2.50 ha");
  assert.equal(TC.fmtArea(3000000, "en"), "3.00 km²");
  assert.equal(TC.fmtArea(950, "el"), "950 τ.μ.");
  assert.equal(TC.fmtArea(4250, "el"), "4,25 στρ.");
  assert.equal(TC.fmtArea(3000000, "el"), "3,00 τ.χλμ.");
  assert.equal(TC.fmtLen(NaN, "en"), "");
});

test("parking: record cleaned, reminder times", () => {
  const now = new Date(2026, 9, 13, 14, 5, 0).getTime();
  assert.equal(TC.normPark(null), null);
  assert.equal(TC.normPark({ lat: 91, lon: 0, at: now }), null);
  assert.equal(TC.normPark({ lat: 40, lon: 22 }), null, "no time = no record");
  const p = TC.normPark({ lat: 40.6, lon: 22.9, at: now, until: now - 5, note: " level\n-2 ,  spot 14 ", x: 1 });
  assert.deepEqual(p, { lat: 40.6, lon: 22.9, at: now, until: 0, note: "level -2 , spot 14" });
  assert.equal(TC.normPark({ lat: 1, lon: 1, at: now, note: "x".repeat(300) }).note.length, 120);
  assert.equal(TC.untilFor(now, 0), 0);
  assert.equal(TC.untilFor(now, 30), now + 30 * 60000);
  assert.deepEqual(TC.REMIND, [0, 30, 60, 120]);
  const later = TC.untilAt(now, "16:30");
  assert.equal(new Date(later).getHours(), 16);
  assert.equal(new Date(later).getDate(), 13);
  const tomorrow = TC.untilAt(now, "09:00");
  assert.equal(new Date(tomorrow).getDate(), 14, "a time already past is tomorrow");
  assert.equal(TC.untilAt(now, "14:05"), new Date(2026, 9, 14, 14, 5).getTime(), "now itself is tomorrow");
  assert.equal(TC.untilAt(now, "25:00"), null);
  assert.equal(TC.untilAt(now, ""), null);
  assert.equal(TC.untilAt(now, "7:5"), null);
  const q = { lat: 1, lon: 1, at: now, until: now + 1000 };
  assert.equal(TC.parkDue(q, now), false);
  assert.equal(TC.parkDue(q, now + 1000), true);
  assert.equal(TC.parkDue({ lat: 1, lon: 1, at: now }, now + 1e9), false, "no reminder is never due");
});

test("speed limit: OSM maxspeed values", () => {
  assert.deepEqual(TC.maxspeed("50"), { v: 50, mph: false, kmh: 50 });
  assert.deepEqual(TC.maxspeed("30 mph"), { v: 30, mph: true, kmh: 48 });
  assert.deepEqual(TC.maxspeed("70mph"), { v: 70, mph: true, kmh: 113 });
  assert.deepEqual(TC.maxspeed("90 km/h"), { v: 90, mph: false, kmh: 90 });
  assert.deepEqual(TC.maxspeed("50;30"), { v: 50, mph: false, kmh: 50 });
  assert.deepEqual(TC.maxspeed("none"), { none: true });
  assert.deepEqual(TC.maxspeed("walk"), { v: 6, mph: false, kmh: 6 });
  ["GR:urban", "signals", "", "0", "999", "fast", null, 50].forEach(v =>
    assert.equal(TC.maxspeed(v), null, String(v)));
  assert.equal(TC.over(56, TC.maxspeed("50")), true);
  assert.equal(TC.over(55, TC.maxspeed("50")), false, "5 km/h of slack");
  assert.equal(TC.over(200, { none: true }), false);
  assert.equal(TC.over(-1, TC.maxspeed("50")), false, "unknown speed");
  assert.equal(TC.over(54, TC.maxspeed("30 mph")), true, "mph compared in km/h (48 + 5)");
  assert.equal(TC.over(52, TC.maxspeed("30 mph")), false);
});

test("speed limit: corridor points along the route", () => {
  // Straight 1 km route north, 3 vertices
  const coords = [[22, 40], [22, 40.0045], [22, 40.009]];
  const cum = [0, 500.4, 1000.8];
  const pts = TC.corridor(coords, cum, 0, 1000.8, 250);
  assert.equal(pts.length, 6);           // 0 250 500 750 1000 1000.8
  assert.deepEqual(pts[0], [40, 22]);
  assert.deepEqual(pts[pts.length - 1], [40.009, 22]);
  pts.forEach((p, i) => { if (i) assert.ok(p[0] >= pts[i - 1][0]); });
  const c2 = TC.corridor(coords, cum, -50, 100, 150);
  assert.equal(c2.length, 2);
  assert.ok(Math.abs(c2[1][0] - 40.0009) < 1e-5);
  assert.equal(TC.corridor(coords, cum, 900, 2000, 150).length, 2, "clamped to the route's end");
  assert.deepEqual(TC.corridor(coords, cum, 1200, 2000, 150), []);
  assert.deepEqual(TC.corridor([[22, 40]], [0], 0, 10, 5), []);
  assert.deepEqual(TC.corridor(coords, [0, 1], 0, 10, 5), [], "mismatched index");
  const q = TC.limitQuery([[40, 22], [40.001, 22.002]], 20);
  assert.equal(q, "[out:json][timeout:20];way[highway][maxspeed](around:20,40,22,40.001,22.002);out tags geom qt 600;");
});

test("speed limit: Overpass parsing and merging", () => {
  const j = { elements: [
    { type: "way", id: 1, tags: { highway: "primary", maxspeed: "70" },
      geometry: [{ lat: 40, lon: 22 }, { lat: 40.01, lon: 22 }] },
    { type: "way", id: 2, tags: { highway: "residential", maxspeed: "GR:urban" },
      geometry: [{ lat: 40, lon: 22 }, { lat: 40, lon: 22.01 }] },
    { type: "way", id: 3, tags: { highway: "service", maxspeed: "20" }, geometry: [{ lat: 40, lon: 22 }] },
    { type: "node", id: 4, tags: { maxspeed: "50" } },
    { type: "way", id: 5, tags: { highway: "motorway", maxspeed: "none" },
      geometry: [{ lat: 41, lon: 22 }, { lat: "x", lon: 22 }, { lat: 41.1, lon: 22 }] }
  ] };
  const w = TC.parseLimits(j);
  assert.deepEqual(w.map(x => x.id), [1, 5]);
  assert.deepEqual(w[1].geom, [[41, 22], [41.1, 22]]);
  assert.deepEqual(TC.parseLimits(null), []);
  const m = TC.mergeLimits([{ id: 1, ms: { v: 50 } }, { id: 9 }], [{ id: 1, ms: { v: 70 } }]);
  assert.deepEqual(m.map(x => x.id), [1, 9]);
  assert.equal(m[0].ms.v, 70, "the newer read wins");
  const many = [];
  for (let i = 0; i < 700; i++) many.push({ id: i });
  assert.equal(TC.mergeLimits([], many).length, TC.MAX_WAYS);
});

test("speed limit: the way the car is on, not the side street", () => {
  const main = { id: 1, ms: TC.maxspeed("70"), geom: [[40, 22], [40.01, 22]] };      // north-south
  const side = { id: 2, ms: TC.maxspeed("30"), geom: [[40.005, 21.995], [40.005, 22.005]] }; // east-west
  const ways = [main, side];
  // At the junction: nearest is a tie, the route heads north → main road
  assert.equal(TC.limitAt(ways, 40.005, 22.00001, 0, 25).id, 1);
  // Heading east on the side street → side street
  assert.equal(TC.limitAt(ways, 40.005, 22.00001, 90, 25).id, 2);
  // Heading south still matches the north-south road (either way along it)
  assert.equal(TC.limitAt(ways, 40.005, 22.00001, 180, 25).id, 1);
  // No direction: nearest
  assert.equal(TC.limitAt(ways, 40.0051, 22.004, null, 25).id, 2);
  // Too far from both
  assert.equal(TC.limitAt(ways, 40.003, 22.003, 0, 25), null);
  assert.equal(TC.limitAt([], 40, 22, 0, 25), null);
  assert.equal(Math.round(TC.bearing([40, 22], [40.01, 22])), 0);
  assert.equal(Math.round(TC.bearing([40, 22], [40, 22.01])), 90);
});

test("wiring: scripts loaded, precached, HUD sign, Topo layer, reminder engine", () => {
  const html = read("maps/index.html");
  assert.ok(html.indexOf("tools-core.js") < html.indexOf('src="maps.js'), "core before maps.js");
  assert.ok(html.indexOf("transit.js") < html.indexOf('src="tools.js'), "tools.js after the modules");
  assert.match(html, /id="nav-limit" hidden/);
  const sw = read("sw.js");
  assert.match(sw, /"maps\/tools-core\.js"/);
  assert.match(sw, /"maps\/tools\.js"/);
  assert.match(sw, /"tile\.opentopomap\.org"/, "Topo tiles kept offline like the others");
  const mj = read("maps/maps.js");
  assert.match(mj, /tile\.opentopomap\.org/);
  assert.match(mj, /topo: layerTopo/);
  assert.match(mj, /limitTick\(lat, lon, p\.along, pos\.coords\.speed\)/);
  const shell = read("shell.js");
  assert.match(shell, /tickSafe\("parkCheckTick", parkCheckTickThrottled\)/);
  assert.match(shell, /deepLink: "maps:park"/);
  assert.match(shell, /name: "OpenTopoMap"/);
  const notifs = read("notifications.js");
  assert.ok(/KNOWN_APPS = \[[^\]]*'maps'/.test(notifs));
  assert.match(notifs, /maps:\s+function \(what\)/);
  assert.match(read("CREDITS.md"), /OpenTopoMap/);
  const tj = read("maps/tools.js");
  assert.ok(!/innerHTML\s*=\s*[^'"]*(note|p\.|draft)/.test(tj), "user text never through innerHTML");
});
