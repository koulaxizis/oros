// Maps hiking and cycling wave H7: the 8 path, track, water and shelter
// quests (maps/quests-core.js 1.3.0), the "Cycle lanes" overlay
// (maps/overlays-core.js 1.2.0) and "Report a problem on this path"
// (maps/trails.js → an OpenStreetMap note).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const Q = require(path.join(__dirname, "..", "maps/quests-core.js"));
const V = require(path.join(__dirname, "..", "maps/overlays-core.js"));
const NOW = Date.UTC(2026, 10, 19, 9);
const YEAR = 365 * 86400000;
const node = (id, tags, ts) => ({ t: "n", id, lat: 39.5, lon: 21.8, tags, ts: ts || NOW - 86400000 });
const way = (id, tags, ts) => ({ t: "w", id, lat: 39.5, lon: 21.8, tags, ts: ts || NOW - 86400000 });
const ids = (els) => Q.openQuests(els, { now: NOW }).map((x) => x.el.t + x.el.id + ":" + x.q.id + ":" + x.mode);
const H7 = ["path_sac_scale", "trail_visibility", "track_type", "path_bicycle", "path_segregated", "steps_ramp_bike", "water_drinkable", "shelter_type"];

test("H7 quests exist, texts in EN and EL, every option has a title", () => {
  H7.forEach((id) => {
    const q = Q.BY_ID[id];
    assert.ok(q, id);
    assert.ok(Q.QUESTS.includes(q), id + " is a pin quest");
    assert.ok(q.title.en && q.title.el && q.q.en && q.q.el, id);
    (q.options || []).forEach((o) => assert.ok(o.en && o.el, id + " " + o.v));
  });
  assert.equal(Q.BY_ID.path_sac_scale.options.length, 6);
  assert.match(Q.BY_ID.path_sac_scale.options[0].en, /^T1/);
  assert.match(Q.BY_ID.path_sac_scale.options[5].en, /^T6/);
  // the overlay-only quest for cycle lanes is valid but never a pin
  assert.ok(Q.BY_ID.cycleway);
  assert.ok(!Q.QUESTS.some((q) => q.id === "cycleway"));
});

test("H7 quests apply where they should and nowhere else", () => {
  const els = [
    way(1, { highway: "path" }),
    way(2, { highway: "path", sac_scale: "mountain_hiking" }),
    way(3, { highway: "path", sac_scale: "hiking" }),
    way(4, { highway: "track" }),
    way(5, { highway: "footway", footway: "sidewalk" }),
    way(6, { highway: "path", bicycle: "designated", foot: "designated" }),
    way(7, { highway: "steps" }),
    node(8, { natural: "spring" }),
    node(9, { man_made: "water_tap", access: "private" }),
    node(10, { amenity: "shelter" }),
    node(11, { amenity: "shelter", highway: "bus_stop" }),
    way(12, { highway: "path", area: "yes" }),
    way(13, { highway: "path", foot: "no" })
  ];
  const got = ids(els);
  ["w1:path_sac_scale:new", "w1:path_bicycle:new", "w2:trail_visibility:new", "w4:track_type:new",
    "w6:path_segregated:new", "w7:steps_ramp_bike:new", "n8:water_drinkable:new", "n10:shelter_type:new"]
    .forEach((x) => assert.ok(got.includes(x), x));
  ["w2:path_sac_scale", "w3:trail_visibility", "w5:path_bicycle", "w6:path_bicycle", "n9:water_drinkable",
    "n11:shelter_type", "w12:path_sac_scale", "w13:path_sac_scale", "w1:trail_visibility"]
    .forEach((x) => assert.ok(!got.some((g) => g.startsWith(x + ":")), x));
});

test("H7 answers set the right tags; visibility and track surface come back for a re-check", () => {
  const p = way(1, { highway: "path" });
  assert.deepEqual(Q.answerSet(Q.BY_ID.path_sac_scale, p, "demanding_mountain_hiking", NOW).set, { sac_scale: "demanding_mountain_hiking" });
  assert.deepEqual(Q.answerSet(Q.BY_ID.path_bicycle, p, "dismount", NOW).set, { bicycle: "dismount" });
  assert.equal(Q.answerSet(Q.BY_ID.path_sac_scale, p, "T7", NOW), null);
  assert.deepEqual(Q.answerSet(Q.BY_ID.track_type, way(4, { highway: "track" }), "grade3", NOW).set, { tracktype: "grade3" });
  assert.deepEqual(Q.answerSet(Q.BY_ID.steps_ramp_bike, way(7, { highway: "steps" }), "yes", NOW).set, { "ramp:bicycle": "yes" });
  assert.deepEqual(Q.answerSet(Q.BY_ID.water_drinkable, node(8, { natural: "spring" }), "no", NOW).set, { drinking_water: "no" });
  assert.deepEqual(Q.answerSet(Q.BY_ID.shelter_type, node(10, { amenity: "shelter" }), "lean_to", NOW).set, { shelter_type: "lean_to" });
  // an old answer comes back after its re-check age
  const old = NOW - 9 * YEAR;
  const got = ids([way(20, { highway: "track", tracktype: "grade2" }, old),
    way(21, { highway: "path", sac_scale: "alpine_hiking", trail_visibility: "good" }, old),
    way(22, { highway: "track", tracktype: "grade2" })]);
  assert.ok(got.includes("w20:track_type:recheck"), got.join());
  assert.ok(got.includes("w21:trail_visibility:recheck"), got.join());
  assert.ok(!got.some((g) => g.startsWith("w22:track_type")));
});

test("Overpass asks for the H7 quests only when they are on", () => {
  const all = Q.overpassQuery(39, 21, 40, 22, []);
  assert.match(all, /"highway"="path"\]\[!"sac_scale"\]/);
  assert.match(all, /"natural"="spring"/);
  assert.match(all, /"amenity"="shelter"\]\[!"shelter_type"\]/);
  const off = Q.overpassQuery(39, 21, 40, 22, H7);
  assert.ok(!/sac_scale|natural"="spring|shelter_type/.test(off), off);
});

test("cycle lanes: sides in every scheme, colours, dashes for one side", () => {
  assert.deepEqual(V.cwSides({ cycleway: "lane" }), { l: "lane", r: "lane", scheme: "plain" });
  assert.deepEqual(V.cwSides({ "cycleway:both": "no" }), { l: "no", r: "no", scheme: "both" });
  assert.deepEqual(V.cwSides({ "cycleway:right": "track" }), { l: "", r: "track", scheme: "sub" });
  assert.deepEqual(V.cwSides({ cycleway: "none" }), { l: "no", r: "no", scheme: "plain" });
  assert.deepEqual(V.cwSides({ cycleway: "weird" }), { l: "", r: "", scheme: "" });
  const cw = V.BY_ID.cycleway;
  assert.equal(cw.style({ cycleway: "track" }).c, V.legendColor("track", "cycleway"));
  assert.equal(cw.style({ cycleway: "opposite_lane" }).c, V.legendColor("lane", "cycleway"));
  assert.equal(cw.style({ cycleway: "shared_lane" }).c, V.legendColor("shared", "cycleway"));
  assert.equal(cw.style({ cycleway: "separate" }).c, V.legendColor("sep", "cycleway"));
  assert.equal(cw.style({ cycleway: "no" }).c, V.legendColor("no", "cycleway"));
  assert.ok(cw.style({}).dash);
  assert.ok(cw.style({ "cycleway:right": "lane" }).dash, "only one side known");
  assert.ok(!cw.style({ "cycleway:left": "lane", "cycleway:right": "no" }).dash);
  // the better side colours the line
  assert.equal(cw.style({ "cycleway:left": "no", "cycleway:right": "track" }).c, V.legendColor("track", "cycleway"));
  // the cycleway colours do not change the colours of other overlays
  assert.equal(V.legendColor("no"), V.legendColor("no", "lit"));
  assert.ok(cw.applies({ highway: "residential" }) && cw.applies({ highway: "secondary" }));
  assert.ok(!cw.applies({ highway: "residential", area: "yes" }));
});

test("cycle lanes: an answer keeps the way's scheme and sets only what changes", () => {
  const w = (tags) => ({ t: "w", id: 5, tags, ts: NOW });
  assert.deepEqual(V.answer("cycleway", w({ highway: "residential" }), "lane"), { set: { "cycleway:both": "lane" }, was: { "cycleway:both": "" } });
  assert.deepEqual(V.answer("cycleway", w({ highway: "residential", cycleway: "no" }), "shared_lane").set, { cycleway: "shared_lane" });
  assert.deepEqual(V.answer("cycleway", w({ highway: "residential", "cycleway:right": "lane" }), "track").set,
    { "cycleway:left": "track", "cycleway:right": "track" });
  assert.equal(V.answer("cycleway", w({ highway: "residential", cycleway: "lane" }), "lane"), null, "no change");
  assert.equal(V.answer("cycleway", w({ highway: "residential" }), "opposite"), null, "not an offered choice");
  assert.deepEqual(V.BY_ID.cycleway.options({}).map((o) => o.v), ["track", "lane", "shared_lane", "share_busway", "separate", "no"]);
  V.BY_ID.cycleway.options({}).forEach((o) => assert.ok(o.en && o.el, o.v));
  // a cycleway answer is a valid entry of the "mapsquests" slice
  assert.ok(Q.BY_ID[V.BY_ID.cycleway.qid]);
});

test("report a problem on a path: wired to OpenStreetMap notes, every kind has a text in EN, EL and DE", () => {
  const ui = fs.readFileSync(path.join(__dirname, "..", "maps/trails.js"), "utf8");
  assert.match(ui, /window\.__orosMapsNotes\.newNote\(place\.lat, place\.lon, t\("trl\.prob\.text"/);
  const kinds = JSON.parse(ui.match(/var PROBS = (\[[^\]]+\])/)[1]);
  assert.deepEqual(kinds, ["blocked", "overgrown", "signs", "damaged", "gone", "danger", "other"]);
  const de = fs.readFileSync(path.join(__dirname, "..", "i18n/de/maps.js"), "utf8");
  ["trl.prob", "trl.prob.title", "trl.prob.text", "trl.cancel"].concat(kinds.map((k) => "trl.prob." + k)).forEach((k) => {
    const n = ui.split('"' + k + '":').length - 1;
    assert.equal(n, 2, k + " in EN and EL");
    assert.ok(de.includes('"' + k + '":'), k + " in DE");
  });
  assert.ok(/\{k\}[\s\S]*\{w\}[\s\S]*\{u\}/.test(ui.match(/"trl\.prob\.text": "[^"]*"/)[0]));
  const notes = fs.readFileSync(path.join(__dirname, "..", "maps/notes.js"), "utf8");
  assert.match(notes, /newNote: newNote/);
});
