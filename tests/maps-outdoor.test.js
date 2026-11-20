// Hiking and cycling, wave H2 (maps/outdoor-core.js): BRouter routes
// for Walk and Bike, read into the OSRM shape with the climb, the
// elevation profile, the surfaces and the kinds of way; and the wiring.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const OC = require(path.join(__dirname, "..", "maps", "outdoor-core.js"));
const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("kinds and defaults", () => {
  assert.equal(OC.kindOf("foot", "hiking").brf, "hiking-mountain");
  assert.equal(OC.kindOf("foot", "std").brf, null);
  assert.equal(OC.kindOf("bike", "road").brf, "fastbike");
  assert.equal(OC.kindOf("bike", "nope").id, "trekking", "unknown kind falls back to the default");
  assert.equal(OC.kindOf("car", "x"), null);
  OC.PROFILES.bike.concat(OC.PROFILES.foot).forEach(k => assert.ok(k.brf === null || /^[a-z0-9-]+$/.test(k.brf)));
});

test("server address: https, or http only on this computer", () => {
  assert.equal(OC.cleanBase(""), "");
  assert.equal(OC.cleanBase("  https://brouter.example.org/brouter/ "), "https://brouter.example.org/brouter");
  assert.equal(OC.cleanBase("http://localhost:17777/brouter"), "http://localhost:17777/brouter");
  assert.equal(OC.cleanBase("http://127.0.0.1:17777/brouter"), "http://127.0.0.1:17777/brouter");
  assert.equal(OC.cleanBase("http://brouter.de/brouter"), null);
  assert.equal(OC.cleanBase("https://u:p@brouter.de/brouter"), null);
  assert.equal(OC.cleanBase("https://brouter.de/brouter?x=1"), null);
  assert.equal(OC.cleanBase("javascript:alert(1)"), null);
});

test("route url: numbers only", () => {
  const u = OC.routeUrl("", "trekking", [{ lat: 37.97, lon: 23.72 }, { lat: "x", lon: 1 }, { lat: 38, lon: 23.8 }]);
  assert.equal(u, "https://brouter.de/brouter?lonlats=23.720000,37.970000%7C23.800000,38.000000&profile=trekking&alternativeidx=0&format=geojson&timode=3");
  assert.match(OC.routeUrl("http://localhost:17777/brouter", "mtb", [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }]), /^http:\/\/localhost:17777\/brouter\?lonlats=/);
  assert.equal(OC.routeUrl("", null, [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }]), "");
  assert.equal(OC.routeUrl("", "a&b", [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }]), "");
  assert.equal(OC.routeUrl("", "trekking", [{ lat: 1, lon: 2 }]), "");
});

test("DIN 33466 walking time", () => {
  assert.equal(OC.hikeTime(8000, 0, 0), 2 * 3600, "8 km flat = 2 h");
  // 8 km and 600 m up: 2 h horizontal, 2 h vertical → 2 + 1 = 3 h
  assert.equal(OC.hikeTime(8000, 600, 0), 3 * 3600);
  // 4 km, 900 m up: 1 h vs 3 h → 3 + 0.5
  assert.equal(OC.hikeTime(4000, 900, 0), 3.5 * 3600);
  assert.equal(OC.hikeTime(0, 0, 500), 3600);
});

test("climb: 5 m hysteresis", () => {
  assert.deepEqual(OC.climb([100, 102, 101, 103, 99, 100]), { up: 0, down: 0, min: 99, max: 103 });
  assert.deepEqual(OC.climb([100, 110, 120, 115, 108, null, 130]), { up: 42, down: 12, min: 100, max: 130 });
  assert.deepEqual(OC.climb([]), { up: 0, down: 0, min: null, max: null });
});

test("tags to surface and kind of way", () => {
  const P = OC.parseTags("highway=path surface=dirt bicycle=designated");
  assert.deepEqual(P, { highway: "path", surface: "dirt", bicycle: "designated" });
  assert.equal(OC.surfClass(P), "ground");
  assert.equal(OC.wayClass(P), "cycleway");
  assert.equal(OC.surfClass({ highway: "residential" }), "paved");
  assert.equal(OC.surfClass({ highway: "track" }), "unknown");
  assert.equal(OC.surfClass({ surface: "fine_gravel" }), "gravel");
  assert.equal(OC.wayClass({ highway: "steps" }), "steps");
  assert.equal(OC.wayClass({ highway: "track" }), "track");
  assert.equal(OC.wayClass({ highway: "footway" }), "path");
  assert.equal(OC.wayClass({ highway: "secondary" }), "road");
  assert.equal(OC.wayClass({}), "other");
});

// A small BRouter answer: three legs north along 23.0 E, ~111 m per 0.001°.
function sample(extra) {
  const coords = [];
  for (let i = 0; i <= 10; i++) coords.push([23, 38 + i * 0.001, 100 + i * 20]);   // 200 m up over ~1.1 km
  return { type: "FeatureCollection", features: [{ type: "Feature",
    properties: Object.assign({
      "track-length": "1112", "filtered ascend": "190", "plain-ascend": "200", "total-time": "300",
      voicehints: [[4, 2, 0, 300, -90], [7, 13, 2, 200, 0], [8, 99, 0, 0, 0], ["x", 5]],
      messages: [
        ["Longitude", "Latitude", "Elevation", "Distance", "CostPerKm", "ElevCost", "TurnCost", "NodeCost", "InitialCost", "WayTags", "NodeTags", "Time", "Energy"],
        ["23000000", "38003000", "160", "334", "1000", "0", "0", "0", "0", "highway=residential", "", "60", "0"],
        ["23000000", "38008000", "260", "556", "1500", "0", "0", "0", "0", "highway=path surface=dirt", "", "200", "0"],
        ["23000000", "38010000", "300", "222", "1100", "0", "0", "0", "0", "highway=track tracktype=grade2 surface=gravel", "", "40", "0"]
      ]
    }, extra || {}),
    geometry: { type: "LineString", coordinates: coords } }] };
}

test("BRouter → OSRM shape: walk", () => {
  const pts = [{ lat: 38, lon: 23 }, { lat: 38.005, lon: 23 }, { lat: 38.01, lon: 23 }];
  const j = OC.toOsrm(sample(), "foot", pts);
  assert.equal(j.code, "Ok");
  const r = j.routes[0];
  assert.equal(r.distance, 1112);
  assert.equal(r.duration, OC.hikeTime(1112, 190, 0), "walking time by DIN 33466 with BRouter's filtered ascend");
  assert.equal(r.geometry.coordinates.length, 11);
  assert.deepEqual(r.geometry.coordinates[0], [23, 38], "2D geometry");
  assert.equal(r.legs.length, 2, "one leg per stop");
  const s0 = r.legs[0].steps;
  assert.equal(s0[0].maneuver.type, "depart");
  assert.deepEqual([s0[1].maneuver.type, s0[1].maneuver.modifier], ["turn", "left"]);
  assert.equal(s0[s0.length - 1].maneuver.type, "arrive");
  const s1 = r.legs[1].steps;
  const rb = s1.find(s => s.maneuver.type === "roundabout");
  assert.equal(rb.maneuver.exit, 2);
  assert.equal(s1[s1.length - 1].maneuver.type, "arrive");
  const total = r.legs.reduce((a, l) => a + l.steps.reduce((b, s) => b + s.distance, 0), 0);
  assert.ok(Math.abs(total - 1112) <= 3, "step distances add up to the route: " + total);
  const o = r.outdoor;
  assert.equal(o.mode, "foot");
  assert.equal(o.up, 190);
  assert.equal(o.down, 0);
  assert.deepEqual([o.min, o.max], [100, 300]);
  assert.equal(o.prof.length, 11);
  assert.deepEqual(o.prof[0], [0, 100]);
  assert.equal(o.prof[10][0], 1112);
  assert.deepEqual(o.surf, [{ k: "ground", m: 556 }, { k: "paved", m: 334 }, { k: "gravel", m: 222 }]);
  assert.deepEqual(o.way.map(w => w.k), ["path", "road", "track"]);
});

test("BRouter → OSRM shape: bike time, no hints, broken input", () => {
  const r = OC.toOsrm(sample({ voicehints: undefined, messages: [["nothing"]] }), "bike", [{ lat: 38, lon: 23 }, { lat: 38.01, lon: 23 }]).routes[0];
  assert.equal(r.duration, 300, "bike time is BRouter's own");
  assert.equal(r.legs.length, 1);
  assert.deepEqual(r.legs[0].steps.map(s => s.maneuver.type), ["depart", "arrive"]);
  assert.deepEqual(r.outdoor.surf, []);
  const noTime = OC.toOsrm(sample({ "total-time": "" }), "bike", []).routes[0];
  assert.equal(noTime.duration, Math.round(1112 / (15 / 3.6)));
  assert.equal(OC.toOsrm(null, "foot", []), null);
  assert.equal(OC.toOsrm({ features: [{ geometry: { type: "Point", coordinates: [1, 2] } }] }, "foot", []), null);
  assert.equal(OC.toOsrm({ features: [{ geometry: { type: "LineString", coordinates: [[1, 2]] } }] }, "foot", []), null);
});

test("wiring: scripts, fallback, keys in EN, EL and DE, help, credits", () => {
  const html = read("maps/index.html");
  assert.ok(html.indexOf('src="trails.js') < html.indexOf("outdoor-core.js"));
  assert.ok(html.indexOf("outdoor-core.js") < html.indexOf('src="outdoor.js'));
  const maps = read("maps/maps.js");
  assert.match(maps, /mapsHost\.outdoorFetch/);
  assert.match(maps, /outdoorFailed/, "a failed trail route falls back to OSRM with a message");
  assert.match(read("maps/planner.js"), /outdoorFetch/);
  const ui = read("maps/outdoor.js");
  assert.doesNotMatch(ui, /innerHTML\s*=/);
  const vm = require("vm");
  const m = ui.match(/var STR = (\{[\s\S]*?\n  \});/);
  assert.ok(m, "STR table found");
  const STR = vm.runInNewContext("(" + m[1] + ")", {});
  const keys = new Set();
  ["foot", "bike"].forEach(md => OC.PROFILES[md].forEach(k => { keys.add("odr.k." + md + "." + k.id); keys.add("odr.h." + md + "." + k.id); }));
  ["paved", "gravel", "ground", "unknown"].forEach(k => keys.add("odr.s." + k));
  ["road", "track", "path", "cycleway", "steps", "other"].forEach(k => keys.add("odr.w." + k));
  for (const k of keys) { assert.ok(STR.en[k], "en " + k); assert.ok(STR.el[k], "el " + k); }
  assert.deepEqual(Object.keys(STR.en).sort(), Object.keys(STR.el).sort(), "EN and EL have the same keys");
  const de = read("i18n/de/maps.js");
  Object.keys(STR.en).forEach(k => assert.ok(de.indexOf('"' + k + '"') >= 0, "de " + k));
  assert.match(read("maps/help.en.txt"), /Walking and cycling routes/);
  assert.match(read("maps/help.el.txt"), /Διαδρομές με τα πόδια και με ποδήλατο/);
  assert.match(read("i18n/de/help/maps.txt"), /Routen zu Fuß und mit dem Rad/);
  assert.match(read("CREDITS.md"), /BRouter/);
  assert.match(read("shell.js"), /k: "cr\.brouter"/);
});
