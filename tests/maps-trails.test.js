// Hiking and cycling, wave H1 (maps/trails-core.js): the Overpass
// queries, the nearest way to a tap, the plain-words reading of a
// way's tags and of its routes, and the wiring.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const TC = require(path.join(__dirname, "..", "maps", "trails-core.js"));
const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("queries: numbers only, radius clamped", () => {
  const q = TC.wayQuery(37.97, 23.72, 25);
  assert.match(q, /^\[out:json\]\[timeout:15\];way\(around:25,37\.970000,23\.720000\)\[highway~"\^\(path\|footway/);
  assert.match(q, /out tags geom;$/);
  assert.match(TC.wayQuery(37.97, 23.72, 5000), /around:80,/);
  assert.match(TC.wayQuery(37.97, 23.72, 1), /around:10,/);
  assert.equal(TC.wayQuery(NaN, 23, 20), "");
  assert.equal(TC.routeQuery(123), '[out:json][timeout:15];way(123);rel(bw)[type=route][route~"^(hiking|foot|walking|bicycle|mtb)$"];out tags;');
  assert.equal(TC.routeQuery("1);out;("), "");
  assert.equal(TC.routeQuery(-4), "");
});

test("distance to a line", () => {
  // a line along the equator-ish latitude, 0.001° of latitude ≈ 111 m
  const line = [[38, 23], [38, 23.01]];
  assert.ok(Math.abs(TC.distToLine(38.001, 23.005, line) - 111.2) < 1);
  assert.ok(TC.distToLine(38, 23.005, line) < 0.01);
  // beyond the end: distance to the end point
  const d = TC.distToLine(38, 23.02, line);
  assert.ok(d > 870 && d < 880, d);
  assert.equal(TC.distToLine(38, 23, []), Infinity);
});

const way = (id, tags, pts) => ({ type: "way", id, tags, geometry: pts.map(p => ({ lat: p[0], lon: p[1] })) });

test("nearest way: within the radius, paths win a near tie", () => {
  const j = { elements: [
    way(1, { highway: "residential" }, [[38.0001, 23], [38.0001, 23.01]]),   // ~11 m
    way(2, { highway: "path" }, [[38.00014, 23], [38.00014, 23.01]]),        // ~15.6 m
    way(3, { highway: "track" }, [[38.002, 23], [38.002, 23.01]]),            // ~222 m
    { type: "node", id: 9 }, way(4, null, [[38, 23]]), way(5, { highway: "path" }, [])
  ] };
  const w = TC.nearestWay(j, 38, 23.005, 30);
  assert.equal(w.id, 2, "the path, 4.5 m further, still wins");
  assert.ok(w.dist > 15 && w.dist < 16.5);
  assert.equal(w.pts.length, 2);
  assert.equal(w.score, undefined);
  assert.equal(TC.nearestWay(j, 38, 23.005, 10), null);
  assert.equal(TC.nearestWay({ elements: [way(3, { highway: "track" }, [[38.002, 23], [38.002, 23.01]])] }, 38, 23.005, 30), null);
  assert.equal(TC.nearestWay(null, 38, 23, 30), null);
});

test("describe a mountain path", () => {
  const d = TC.describeWay({ highway: "path", name: "Μονοπάτι Ε4", surface: "dirt", sac_scale: "demanding_mountain_hiking",
    "mtb:scale": "3+", trail_visibility: "intermediate", incline: "12%", width: "0,8", bicycle: "dismount", foot: "designated",
    smoothness: "very_bad", lit: "no", informal: "yes", horse: "maybe" });
  assert.equal(d.kind, "trl.hw.path");
  assert.equal(d.name, "Μονοπάτι Ε4");
  assert.equal(d.sac, 3);
  assert.equal(d.mtb, 3);
  assert.equal(d.paved, false);
  assert.equal(d.trail, true);
  assert.deepEqual(d.rows, [
    { l: "trl.l.surface", v: "trl.surf.ground" },
    { l: "trl.l.smooth", v: "trl.sm.very_bad" },
    { l: "trl.l.sac", v: "trl.sac.3" },
    { l: "trl.l.mtb", v: "trl.mtb.3" },
    { l: "trl.l.vis", v: "trl.vis.intermediate" },
    { l: "trl.l.incline", raw: "12%" },
    { l: "trl.l.width", raw: "0.8 m" },
    { l: "trl.l.foot", v: "trl.acc.designated" },
    { l: "trl.l.bicycle", v: "trl.acc.dismount" },
    { l: "trl.l.lit", v: "trl.yn.no" },
    { l: "trl.l.informal", v: "trl.yn.yes" }
  ]);
});

test("describe: roads, tracks, steps, odd values dropped", () => {
  const r = TC.describeWay({ highway: "residential", surface: "asphalt", ref: "R1" });
  assert.equal(r.kind, "trl.hw.residential");
  assert.equal(r.name, "R1");
  assert.equal(r.paved, true);
  assert.equal(r.trail, false);
  const tr = TC.describeWay({ highway: "track", tracktype: "grade3" });
  assert.deepEqual(tr.rows, [{ l: "trl.l.tracktype", v: "trl.tt.grade3" }]);
  assert.equal(tr.paved, null);
  assert.deepEqual(TC.describeWay({ highway: "steps", step_count: "42", incline: "up" }).rows,
    [{ l: "trl.l.incline", v: "trl.inc.up" }, { l: "trl.l.steps", raw: "42" }]);
  const odd = TC.describeWay({ highway: "<img>", surface: "lava", sac_scale: "T9", "mtb:scale": "7", trail_visibility: "meh",
    incline: "<b>", width: "wide", segregated: "maybe", name: "x".repeat(300) });
  assert.equal(odd.kind, "trl.hw.other");
  assert.deepEqual(odd.rows, []);
  assert.equal(odd.name.length, 120);
  assert.equal(TC.describeWay({ highway: "footway", footway: "sidewalk" }).kind, "trl.hw.sidewalk");
  assert.equal(TC.describeWay({ highway: "path", foot: "designated", bicycle: "designated" }).kind, "trl.hw.shared");
  assert.deepEqual(TC.describeWay(null).rows, []);
});

test("routes: kinds, networks, colours, distance, order", () => {
  const rel = (id, tags) => ({ type: "relation", id, tags });
  const list = TC.routesOf({ elements: [
    rel(5, { route: "hiking", network: "lwn", name: "Local loop", colour: "#FF0000", distance: "7,5" }),
    rel(3, { route: "hiking", network: "iwn", ref: "E4", name: "European long distance path E4", distance: "10450" }),
    rel(4, { route: "bicycle", network: "ncn", ref: "EV11", colour: "red", distance: "12 mi" }),
    rel(6, { route: "mtb", name: "Ridge" }),
    rel(7, { route: "bus", name: "No" }), { type: "way", id: 1, tags: { route: "hiking" } }
  ] });
  assert.deepEqual(list.map(r => r.id), [3, 4, 5, 6]);
  assert.deepEqual(list[0], { id: 3, kind: "foot", name: "European long distance path E4", ref: "E4", net: "intl", colour: "", km: 10450 });
  assert.equal(list[1].kind, "bike");
  assert.equal(list[1].colour, "", "named colours are not passed to the page");
  assert.equal(list[1].km, 0, "miles are not read as km");
  assert.equal(list[2].colour, "#ff0000");
  assert.equal(list[2].km, 7.5);
  assert.equal(list[3].kind, "mtb");
  assert.equal(list[3].net, "");
  assert.deepEqual(TC.routesOf(null), []);
});

test("links are built from numbers", () => {
  assert.equal(TC.wtLink({ id: 3, kind: "foot" }), "https://hiking.waymarkedtrails.org/#route?id=3");
  assert.equal(TC.wtLink({ id: "4x", kind: "bike" }), "https://cycling.waymarkedtrails.org/#route?id=NaN");
  assert.equal(TC.wtLink({ id: 6.7, kind: "mtb" }), "https://mtb.waymarkedtrails.org/#route?id=6");
  assert.equal(TC.osmWayLink(12), "https://www.openstreetmap.org/way/12");
});

test("wiring: scripts, keys in EN, EL and DE, help, credits", () => {
  const html = read("maps/index.html");
  assert.ok(html.indexOf("trails-core.js") < html.indexOf('src="trails.js'));
  assert.ok(html.indexOf('src="maps.js') < html.indexOf("trails-core.js"));
  const ui = read("maps/trails.js");
  assert.doesNotMatch(ui, /innerHTML\s*=/, "OSM text never goes in as HTML");
  // every key the core can return has EN and EL text
  const vm = require("vm");
  const keys = new Set();
  const sample = [
    { highway: "path", surface: "gravel", smoothness: "good", sac_scale: "hiking", "mtb:scale": "0", trail_visibility: "good", incline: "up", foot: "yes", bicycle: "no", horse: "permissive", segregated: "yes", lit: "yes", informal: "yes" }
  ];
  TC.HW.concat(["other"]).forEach(h => keys.add("trl.hw." + h));
  sample.forEach(tg => TC.describeWay(tg).rows.forEach(r => { keys.add(r.l); if (r.v) keys.add(r.v); }));
  for (let i = 1; i <= 6; i++) keys.add("trl.sac." + i);
  for (let i = 0; i <= 6; i++) keys.add("trl.mtb." + i);
  ["intl", "national", "regional", "local"].forEach(n => keys.add("trl.net." + n));
  const box = { window: {}, document: {} };
  const m = ui.match(/var STR = (\{[\s\S]*?\n  \});/);
  assert.ok(m, "STR table found");
  const STR = vm.runInNewContext("(" + m[1] + ")", box);
  for (const k of keys) {
    assert.ok(STR.en[k], "en " + k);
    assert.ok(STR.el[k], "el " + k);
  }
  assert.deepEqual(Object.keys(STR.en).sort(), Object.keys(STR.el).sort(), "EN and EL have the same keys");
  const de = read("i18n/de/maps.js");
  Object.keys(STR.en).forEach(k => assert.ok(de.indexOf('"' + k + '"') >= 0, "de " + k));
  assert.match(read("maps/help.en.txt"), /About this path/);
  assert.match(read("maps/help.el.txt"), /Τι δρόμος είναι αυτός/);
  assert.match(read("CREDITS.md"), /Waymarked Trails/);
  assert.match(read("CREDITS.md"), /CyclOSM/);
});
