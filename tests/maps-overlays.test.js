// Pure logic of the Maps overlays (maps/overlays-core.js, maps wave 8B):
// colours, sidewalk sides and schemes, answers → tags, Overpass query
// and way-geometry parsing, arrows, and that overlay answers stay valid
// in the "mapsquests" slice.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const V = require(path.join(__dirname, "..", "maps", "overlays-core.js"));
const Q = require(path.join(__dirname, "..", "maps", "quests-core.js"));

const way = (id, tags, geom) => ({ t: "w", id, lat: 38, lon: 23.7, ts: 0, tags, geom: geom || [[38, 23.7], [38.001, 23.7]] });

test("5 overlays, texts in EN and EL, each answer goes to a known quest", () => {
  assert.deepEqual(V.OVERLAYS.map(o => o.id), ["lit", "surface", "sidewalk", "address", "building"]);
  V.OVERLAYS.forEach(o => {
    ["title", "q"].forEach(f => { assert.ok(o[f].en && o[f].el, o.id + " " + f); });
    assert.ok(Q.BY_ID[o.qid], o.id + " → " + o.qid);
    o.legend.forEach(l => assert.ok(l[1] && l[2] && /^#[0-9a-f]{6}$/.test(V.legendColor(l[0]))));
  });
  // sidewalk is an overlay-only quest: valid, counted, never a pin or a setting
  assert.equal(Q.QUESTS.length, 36);
  assert.ok(!Q.QUESTS.some(q => q.id === "sidewalk"));
  assert.equal(Q.BY_ID.sidewalk.cat, "streets");
  assert.ok(!/sidewalk/.test(Q.overpassQuery(1, 2, 3, 4, [])));
});

test("colours: known, missing (dashed), other", () => {
  const lit = V.BY_ID.lit, sf = V.BY_ID.surface, ad = V.BY_ID.address;
  assert.equal(lit.style({ lit: "yes" }).c, V.legendColor("yes"));
  assert.equal(lit.style({ lit: "no" }).c, V.legendColor("no"));
  assert.ok(lit.style({}).dash);
  assert.equal(sf.style({ surface: "asphalt" }).c, V.legendColor("paved"));
  assert.equal(sf.style({ surface: "sett" }).c, V.legendColor("stones"));
  assert.equal(sf.style({ surface: "woodchips" }).c, V.legendColor("other"));
  assert.ok(sf.style({}).dash);
  assert.equal(ad.style({ "addr:housenumber": "5" }).c, V.legendColor("num"));
  assert.equal(ad.style({ nohousenumber: "yes" }).c, V.legendColor("nonum"));
  assert.ok(ad.style({ building: "yes" }).dash);
});

test("sidewalk sides in the three tagging schemes", () => {
  assert.deepEqual(V.sides({ sidewalk: "both" }), { l: "yes", r: "yes", scheme: "plain" });
  assert.deepEqual(V.sides({ sidewalk: "right" }), { l: "no", r: "yes", scheme: "plain" });
  assert.deepEqual(V.sides({ sidewalk: "none" }), { l: "no", r: "no", scheme: "plain" });
  assert.deepEqual(V.sides({ "sidewalk:left": "separate", "sidewalk:right": "no" }), { l: "separate", r: "no", scheme: "sub" });
  assert.deepEqual(V.sides({ "sidewalk:left": "yes" }), { l: "yes", r: "", scheme: "sub" });
  assert.deepEqual(V.sides({ "sidewalk:both": "no" }), { l: "no", r: "no", scheme: "both" });
  assert.deepEqual(V.sides({ highway: "residential" }), { l: "", r: "", scheme: "" });
  const sw = V.BY_ID.sidewalk;
  assert.equal(sw.style({ sidewalk: "both" }).c, V.legendColor("both"));
  assert.equal(sw.style({ sidewalk: "left" }).c, V.legendColor("one"));
  assert.equal(sw.style({ sidewalk: "separate" }).c, V.legendColor("sep"));
  assert.equal(sw.style({ sidewalk: "no" }).c, V.legendColor("none"));
  assert.ok(sw.style({}).dash);
});

test("sidewalk answers keep the way's scheme; one side is not offered over sidewalk:both", () => {
  assert.deepEqual(V.answer("sidewalk", way(1, { highway: "residential" }), "left"), { set: { sidewalk: "left" }, was: { sidewalk: "" } });
  assert.deepEqual(V.answer("sidewalk", way(1, { highway: "residential", sidewalk: "no" }), "both"), { set: { sidewalk: "both" }, was: { sidewalk: "no" } });
  assert.equal(V.answer("sidewalk", way(1, { sidewalk: "both" }), "both"), null, "same value: nothing to do");
  assert.deepEqual(V.answer("sidewalk", way(1, { "sidewalk:left": "yes", "sidewalk:right": "yes" }), "right"),
    { set: { "sidewalk:left": "no" }, was: { "sidewalk:left": "yes" } });
  assert.deepEqual(V.answer("sidewalk", way(1, { "sidewalk:both": "yes" }), "no"), { set: { "sidewalk:both": "no" }, was: { "sidewalk:both": "yes" } });
  assert.equal(V.answer("sidewalk", way(1, { "sidewalk:both": "yes" }), "left"), null);
  assert.deepEqual(V.BY_ID.sidewalk.options({ "sidewalk:both": "yes" }).map(o => o.v), ["both", "separate", "no"]);
  assert.equal(V.answer("sidewalk", way(1, {}), "maybe"), null);
});

test("lit, surface and address answers", () => {
  assert.deepEqual(V.answer("lit", way(1, { highway: "footway" }), "24/7"), { set: { lit: "24/7" }, was: { lit: "" } });
  assert.deepEqual(V.answer("surface", way(1, { highway: "track", surface: "gravel" }), "compacted"), { set: { surface: "compacted" }, was: { surface: "gravel" } });
  assert.equal(V.answer("surface", way(1, {}), "lava"), null);
  assert.deepEqual(V.answer("address", way(1, { building: "yes" }), "12A"), { set: { "addr:housenumber": "12A" }, was: { "addr:housenumber": "" } });
  assert.deepEqual(V.answer("address", way(1, { building: "yes" }), "none"), { set: { nohousenumber: "yes" }, was: { nohousenumber: "" } });
  assert.equal(V.answer("address", way(1, { building: "yes" }), "<b>"), null);
  assert.equal(V.answer("nope", way(1, {}), "yes"), null);
});

test("Overpass query and parsing of way geometry", () => {
  const q = V.query("lit", 37.9, 23.7, 38, 23.8);
  assert.match(q, /^\[out:json\]\[timeout:25\];\(way\["highway"~"\^\(residential\|.*"\]\(37\.900000,23\.700000,38\.000000,23\.800000\);\);out body geom qt 2000;$/);
  assert.match(V.query("address", 1, 2, 3, 4), /way\["building"\]/);
  assert.equal(V.query("nope", 1, 2, 3, 4), "");
  const j = { elements: [
    { type: "way", id: 7, tags: { highway: "residential", name: "<b>X</b>" }, geometry: [{ lat: 38, lon: 23.7 }, { lat: 38.002, lon: 23.7 }] },
    { type: "way", id: 8, tags: { highway: "motorway" }, geometry: [{ lat: 38, lon: 23.7 }, { lat: 38.002, lon: 23.7 }] },
    { type: "way", id: 9, tags: { highway: "residential" }, geometry: [{ lat: 38, lon: 23.7 }] },
    { type: "node", id: 10, lat: 38, lon: 23.7, tags: { highway: "residential" } },
    { type: "way", id: -1, tags: { highway: "residential" }, geometry: [{ lat: 38, lon: 23.7 }, { lat: 38.1, lon: 23.7 }] },
    { type: "way", id: 11, tags: { highway: "residential" }, geometry: [{ lat: 99, lon: 23.7 }, { lat: 38, lon: 23.7 }, { lat: 38.001, lon: 23.7 }] }
  ] };
  const out = V.parse(j, "lit");
  assert.deepEqual(out.map(x => x.id), [7, 11]);
  assert.equal(out[0].tags.name, "<b>X</b>", "kept as data (the page uses textContent)");
  assert.ok(Math.abs(out[0].lat - 38.001) < 1e-9 && out[0].lon === 23.7, "middle of the line");
  assert.equal(out[1].geom.length, 2, "bad points dropped");
  assert.deepEqual(V.parse(null, "lit"), []);
  const sq = V.parse({ elements: [{ type: "way", id: 5, tags: { building: "yes" }, geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 2 }, { lat: 2, lon: 2 }, { lat: 0, lon: 0 }] }] }, "address");
  assert.deepEqual([sq[0].lat, sq[0].lon], [1, 1], "middle of an area's box");
});

test("bearing and arrows", () => {
  assert.equal(Math.round(V.bearing([38, 23.7], [38.01, 23.7])), 0);
  assert.equal(Math.round(V.bearing([38, 23.7], [38, 23.71])), 90);
  assert.equal(Math.round(V.bearing([38, 23.7], [37.99, 23.7])), 180);
  const a = V.arrows([[38, 23.7], [38.001, 23.7], [38.001, 23.702]], 40);
  assert.equal(a.length, 2);
  assert.equal(a[0].deg, 0); assert.equal(a[1].deg, 90);
  assert.equal(V.arrows([[38, 23.7], [38.0001, 23.7]], 40).length, 1, "a short way still gets one arrow");
});

test("overlay answers survive the mapsquests normalizer and count for achievements", () => {
  const a = { id: "abcdefgh12", m: 5, dev: "dev1", srv: "live", q: "sidewalk", t: "w", oid: 7, lat: 38, lon: 23.7,
    set: { sidewalk: "both" }, was: { sidewalk: "" }, name: "" };
  const d = Q.normalize({ answers: { abcdefgh12: a } });
  assert.equal(d.answers.abcdefgh12.set.sidewalk, "both");
  const st = Q.addCount(Q.normStats(null), "dev1", "sidewalk", 3);
  assert.equal(Q.achievements(st).find(c => c.id === "streets").n, 3);
});
