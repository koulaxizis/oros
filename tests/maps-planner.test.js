// Pure logic of "Plan a track" (maps/planner-core.js, maps wave 10B):
// OSRM lines, joining parts, sampling for the profile, Terrarium tile
// maths and decoding, climb, and the plan as a GPX track.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const PC = require(path.join(__dirname, "..", "maps", "planner-core.js"));
const T = require(path.join(__dirname, "..", "maps", "tracks-core.js"));
const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("modes and OSRM lines", () => {
  assert.deepEqual(PC.MODES, ["foot", "bike", "car", "line"]);
  assert.equal(PC.mode("bike"), "bike");
  assert.equal(PC.mode("plane"), "foot");
  const j = { routes: [{ geometry: { coordinates: [[23.7, 37.9], [23.71, 37.91], ["x", 1], [23.72, 37.92]] } }] };
  assert.deepEqual(PC.lineFromOsrm(j), [[37.9, 23.7], [37.91, 23.71], [37.92, 23.72]]);
  assert.equal(PC.lineFromOsrm({ routes: [] }), null);
  assert.equal(PC.lineFromOsrm({ routes: [{ geometry: { coordinates: [[1, 1]] } }] }), null);
  assert.equal(PC.lineFromOsrm(null), null);
  assert.deepEqual(PC.straight({ lat: 1, lon: 2 }, { lat: 3, lon: 4 }), [[1, 2], [3, 4]]);
});

test("parts joined into one line, length", () => {
  const segs = [{ line: [[0, 0], [0, 0.01]] }, { line: [[0, 0.01], [0.01, 0.01]] }, { line: null }];
  const l = PC.fullLine(segs);
  assert.deepEqual(l, [[0, 0], [0, 0.01], [0.01, 0.01]], "shared point once");
  assert.ok(Math.abs(PC.lineLength(l) - 2 * 1111.95) < 2);
  assert.deepEqual(PC.fullLine([]), []);
  assert.equal(PC.lineLength([]), 0);
});

test("samples along the line", () => {
  const line = [[0, 0], [0.009, 0]];               // ≈ 1000.8 m north
  const s = PC.sample(line, 100, 300);
  assert.equal(s.length, 12);                       // 0,100,…,1000, end
  assert.equal(s[0].d, 0);
  assert.ok(Math.abs(s[s.length - 1].d - 1000.75) < 0.5);
  assert.ok(Math.abs(s[5].d - 500) < 1e-6);
  assert.ok(Math.abs(s[5].lat - 0.0045) < 1e-5);
  const capped = PC.sample(line, 1, 50);
  assert.ok(capped.length <= 50, "at most max samples: " + capped.length);
  assert.ok(Math.abs(capped[capped.length - 1].d - PC.lineLength(line)) < 1e-6, "the end is kept");
  assert.deepEqual(PC.sample([[1, 2]], 10, 10), [{ lat: 1, lon: 2, d: 0 }]);
  assert.deepEqual(PC.sample([], 10, 10), []);
  // A bend: distances keep growing
  const b = PC.sample([[0, 0], [0.005, 0], [0.005, 0.005]], 50, 300);
  b.forEach((p, i) => { if (i) assert.ok(p.d > b[i - 1].d); });
});

test("Terrarium tiles: tile, pixel, URL, decoding", () => {
  // Athens at z13: tile 4635/3160 (checked with Python)
  const a = PC.tileFor(37.9715, 23.7257, 13);
  assert.equal(a.z, 13);
  assert.equal(a.x, 4635);
  assert.equal(a.y, 3160);
  assert.ok(a.px >= 0 && a.px <= 255 && a.py >= 0 && a.py <= 255);
  assert.equal(PC.tileUrl(a), "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/13/4635/3160.png");
  assert.equal(PC.tileFor(0, 0, 1).x, 1);
  assert.equal(PC.tileFor(0, 0, 1).y, 1);
  assert.equal(PC.tileFor(89.9, 179.999, 2).y, 0, "clamped at the pole");
  assert.equal(PC.TILE_Z, 13);
  assert.equal(PC.decode(128, 0, 0), 0);
  assert.equal(PC.decode(128, 100, 128), 100.5);
  assert.equal(PC.decode(127, 246, 0), -10);
  assert.equal(PC.decode(0, 0, 0), null, "nodata");
});

test("climb with a 3 m threshold", () => {
  assert.deepEqual(PC.climb([100, 101, 102, 104, 110, 108, 100, 101]), { up: 10, down: 10, min: 100, max: 110 });
  assert.deepEqual(PC.climb([5, 6, 5, 6, 5]), { up: 0, down: 0, min: 5, max: 6 }, "noise ignored");
  assert.deepEqual(PC.climb([null, 50, null, 60]), { up: 10, down: 0, min: 50, max: 60 });
  assert.equal(PC.climb([null, null]), null);
  assert.equal(PC.climb([]), null);
});

test("plan as a track: elevations on the vertices, points as waypoints, valid GPX", () => {
  const line = [[37.9, 23.7], [37.905, 23.7], [37.91, 23.7]];
  const samples = PC.sample(line, 100, 300);
  const eles = samples.map((p, i) => 100 + i);
  const tr = PC.toTrack("  My\nwalk ", [{ lat: 37.9, lon: 23.7 }, { lat: 37.91, lon: 23.7 }], line, samples, eles);
  assert.equal(tr.name, "My walk");
  assert.equal(tr.segs[0].length, 3);
  assert.equal(tr.segs[0][0][2], 100);
  assert.equal(tr.segs[0][2][2], eles[eles.length - 1]);
  assert.ok(Math.abs(tr.segs[0][1][2] - eles[Math.round((samples.length - 1) / 2)]) <= 1);
  assert.deepEqual(tr.wpts.map(w => w.name), ["1", "2"]);
  const noEle = PC.toTrack("x", [], line, null, null);
  assert.ok(noEle.segs[0].every(p => p[2] === null));
  assert.equal(PC.toTrack("x", [], [[1, 1]], null, null), null);
  // Round trip through the tracks module's GPX writer / reader
  const gpx = T.writeGpx(tr);
  const back = T.parseAny(gpx, "x.gpx");
  assert.equal(back.segs[0].length, 3);
  assert.equal(back.segs[0][0][2], 100);
  assert.equal(back.wpts.length, 2);
  assert.equal(back.name, "My walk");
});

test("wiring: scripts, precache, host routers, entry in My tracks", () => {
  const html = read("maps/index.html");
  assert.ok(html.indexOf('src="tracks.js') < html.indexOf('src="planner.js'));
  assert.ok(html.indexOf("planner-core.js") < html.indexOf('src="planner.js'));
  const sw = read("sw.js");
  assert.match(sw, /"maps\/planner-core\.js"/);
  assert.match(sw, /"maps\/planner\.js"/);
  assert.match(read("maps/maps.js"), /routerBase: ROUTER_BASE/);
  assert.match(read("maps/tracks.js"), /__orosMapsPlanner/);
  const pj = read("maps/planner.js");
  assert.match(pj, /img\.crossOrigin = "anonymous"/);
  assert.ok(!/innerHTML\s*=\s*[^'"]*name/.test(pj), "the name never through innerHTML");
});
