// Pure logic of the Every Door style tools (maps/everydoor-core.js,
// maps wave 9): completeness, quick add, entrance tags, Overpass
// parsing with node ids, snapping to a building outline, inserting a
// node into a way, and the sync merge of the "mapsentr" slice.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const ED = require(path.join(__dirname, "..", "maps", "everydoor-core.js"));
const P = require(path.join(__dirname, "..", "maps", "poi-core.js"));

test("completeness: name and opening hours where they belong", () => {
  assert.deepEqual(ED.missing({ shop: "bakery" }), ["name", "opening_hours"]);
  assert.deepEqual(ED.missing({ shop: "bakery", name: "Φούρνος", opening_hours: "Mo-Sa 07:00-15:00" }), []);
  assert.deepEqual(ED.missing({ amenity: "cafe", brand: "X" }), ["opening_hours"]);
  assert.deepEqual(ED.missing({ amenity: "cafe", name: "X", "opening_hours:signed": "no" }), []);
  assert.deepEqual(ED.missing({ amenity: "atm" }), [], "an ATM needs neither");
  assert.deepEqual(ED.missing({ amenity: "place_of_worship" }), ["name"]);
  assert.deepEqual(ED.missing({ shop: "vacant" }), ["name"]);
  assert.deepEqual(ED.missing({ highway: "residential" }), []);
  assert.deepEqual(ED.missing({ "disused:shop": "bakery", disused: "yes" }), []);
});

test("quick add: 16 things, texts in EN and EL, valid tags, copies", () => {
  assert.equal(ED.MICRO.length, 16);
  ED.MICRO.forEach(x => {
    assert.ok(x.en && x.el && x.icon, x.id);
    assert.deepEqual(P.cleanTags(x.tags), x.tags);
  });
  const a = ED.microTags("bollard"); a.barrier = "x";
  assert.deepEqual(ED.microTags("bollard"), { barrier: "bollard" });
  assert.equal(ED.microTags("nope"), null);
});

test("entrance tags: kinds, letter, flats, step-free; bad input refused", () => {
  assert.deepEqual(ED.entranceTags({ type: "staircase", ref: "Β", flats: "5 - 8", wheelchair: "no" }),
    { tags: { entrance: "staircase", ref: "Β", "addr:flats": "5-8", wheelchair: "no" } });
  assert.deepEqual(ED.entranceTags({ type: "main", flats: "1;2;3" }), { tags: { entrance: "main", "addr:flats": "1;2;3" } });
  assert.deepEqual(ED.entranceTags({ type: "main", flats: "1–4" }), { tags: { entrance: "main", "addr:flats": "1-4" } });
  assert.deepEqual(ED.entranceTags({ type: "door" }), { error: "type" });
  assert.deepEqual(ED.entranceTags({ type: "main", ref: "ABCDE" }), { error: "ref" });
  assert.deepEqual(ED.entranceTags({ type: "main", ref: "<b>" }), { error: "ref" });
  assert.deepEqual(ED.entranceTags({ type: "main", flats: "1-8<script>" }), { error: "flats" });
  assert.deepEqual(ED.entranceTags({ type: "main", wheelchair: "maybe" }), { error: "wheelchair" });
  assert.deepEqual(ED.entranceForm({ entrance: "staircase", ref: "A", "addr:flats": "1-4" }), { type: "staircase", ref: "A", flats: "1-4", wheelchair: "" });
  assert.equal(ED.entranceForm({ entrance: "door" }).type, "yes");
  assert.equal(ED.entranceForm({}).type, "main");
});

test("Overpass query and parsing: buildings with node ids, entrance nodes", () => {
  assert.match(ED.query(37.9, 23.7, 38, 23.8), /way\["building"\]\(37\.900000,23\.700000,38\.000000,23\.800000\);node\["entrance"\]\(.*\);\);out body geom qt 3000;$/);
  const sq = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]].map(([a, b]) => ({ lat: 38 + a * 1e-4, lon: 23.7 + b * 1e-4 }));
  const r = ED.parse({ elements: [
    { type: "way", id: 10, nodes: [1, 2, 3, 4, 1], geometry: sq, tags: { building: "yes" } },
    { type: "way", id: 11, nodes: [1, 2, 3], geometry: sq.slice(0, 3), tags: { building: "yes" } },
    { type: "way", id: 12, nodes: [1, 2, 3, 4, 1], geometry: sq.slice(0, 4), tags: { building: "yes" } },
    { type: "node", id: 5, lat: 38, lon: 23.7, tags: { entrance: "main", ref: "<i>A</i>" } },
    { type: "node", id: 6, lat: 38, lon: 23.7, tags: { barrier: "gate" } },
    { type: "node", id: -7, lat: 38, lon: 23.7, tags: { entrance: "yes" } }
  ] });
  assert.deepEqual(r.ways.map(w => w.id), [10]);
  assert.deepEqual(r.ways[0].nodes, [1, 2, 3, 4, 1]);
  assert.deepEqual(r.ents.map(e => e.id), [5]);
  assert.equal(r.ents[0].tags.ref, "<i>A</i>", "kept as data (textContent on the page)");
  assert.deepEqual(ED.parse(null), { ways: [], ents: [] });
});

test("snapping to the outline: nearest edge, corners, too far", () => {
  const w = { id: 10, nodes: [1, 2, 3, 4, 1], geom: [[38, 23.7], [38, 23.7001], [38.0001, 23.7001], [38.0001, 23.7], [38, 23.7]] };
  // just south of the south edge, in its middle
  const s = ED.snap([w], [37.99999, 23.70005], 5, 1);
  assert.equal(s.wid, 10); assert.equal(s.a, 1); assert.equal(s.b, 2); assert.equal(s.vertex, 0);
  assert.ok(Math.abs(s.lat - 38) < 1e-7 && Math.abs(s.lon - 23.70005) < 1e-7, "on the edge");
  assert.ok(s.d > 1 && s.d < 1.2);
  const c = ED.snap([w], [37.999995, 23.7000005], 5, 1);
  assert.equal(c.vertex, 1, "next to a corner → the corner");
  assert.deepEqual([c.lat, c.lon], [38, 23.7]);
  assert.equal(ED.snap([w], [37.999, 23.70005], 5, 1), null, "100 m away");
  const e = ED.snap([w], [38.00005, 23.70011], 5, 1);
  assert.equal(e.a, 2); assert.equal(e.b, 3, "east edge");
});

test("insert a node between two neighbours, in either order", () => {
  assert.deepEqual(ED.insertNode([1, 2, 3, 4, 1], 2, 3, -1), [1, 2, -1, 3, 4, 1]);
  assert.deepEqual(ED.insertNode([1, 2, 3, 4, 1], 3, 2, -1), [1, 2, -1, 3, 4, 1]);
  assert.deepEqual(ED.insertNode([1, 2, 3, 4, 1], 4, 1, -2), [1, 2, 3, 4, -2, 1]);
  assert.equal(ED.insertNode([1, 2, 3, 4, 1], 1, 3, -1), null, "not an edge any more");
  assert.equal(ED.insertNode(null, 1, 2, -1), null);
});

test("slice mapsentr: strict items, LWW merge, tombs", () => {
  const c = { id: "aaaaaa1111", m: 10, dev: "dev1", srv: "live", op: "create", wid: 10, a: 1, b: 2, lat: 38, lon: 23.7, set: { entrance: "main", "addr:flats": "1-8" } };
  const mo = { id: "bbbbbb2222", m: 11, dev: "dev2", srv: "live", op: "modify", oid: 5, lat: 38, lon: 23.7, set: { ref: "" }, was: { ref: "A" } };
  const d = ED.normalize({ items: { aaaaaa1111: c, bbbbbb2222: mo,
    cccccc3333: Object.assign({}, c, { id: "cccccc3333", a: 1, b: 1 }),
    dddddd4444: Object.assign({}, c, { id: "dddddd4444", set: { "addr:flats": "1" } }),
    eeeeee5555: Object.assign({}, mo, { id: "eeeeee5555", oid: 0 }) } });
  assert.deepEqual(Object.keys(d.items), ["aaaaaa1111", "bbbbbb2222"]);
  assert.equal(d.items.bbbbbb2222.set.ref, "", "a modify may remove a field");
  assert.equal(d.items.bbbbbb2222.was.ref, "A");
  const newer = Object.assign({}, c, { m: 20, set: { entrance: "staircase" } });
  const m1 = ED.merge({ items: { aaaaaa1111: c } }, { items: { aaaaaa1111: newer } });
  assert.equal(m1.items.aaaaaa1111.set.entrance, "staircase");
  assert.deepEqual(ED.merge(m1, { items: { aaaaaa1111: c } }), m1, "idempotent / LWW");
  const m2 = ED.merge(m1, { tombs: { aaaaaa1111: 21 } });
  assert.deepEqual(m2.items, {});
  assert.deepEqual(ED.merge({ items: { aaaaaa1111: c } }, { items: { aaaaaa1111: newer } }), ED.merge({ items: { aaaaaa1111: newer } }, { items: { aaaaaa1111: c } }), "commutative");
  assert.deepEqual(ED.normalize("x"), { ver: 1, items: {}, tombs: {} });
});

test("buildings overlay: floors and kind, blank keeps", () => {
  const V = require(path.join(__dirname, "..", "maps", "overlays-core.js"));
  const w = (tags) => ({ t: "w", id: 1, tags });
  assert.deepEqual(V.answer("building", w({ building: "yes" }), { levels: "4", type: "apartments" }),
    { set: { "building:levels": "4", building: "apartments" }, was: { "building:levels": "", building: "yes" } });
  assert.deepEqual(V.answer("building", w({ building: "house" }), { levels: "2", type: "" }), { set: { "building:levels": "2" }, was: { "building:levels": "" } });
  assert.equal(V.answer("building", w({ building: "house", "building:levels": "2" }), { levels: "2" }), null);
  assert.equal(V.answer("building", w({}), { levels: "0" }), null);
  assert.equal(V.answer("building", w({}), { levels: "2.5" }), null);
  assert.equal(V.answer("building", w({}), { type: "castle" }), null);
  const st = V.BY_ID.building.style;
  assert.equal(st({ building: "house", "building:levels": "2" }).c, V.legendColor("num"));
  assert.equal(st({ building: "yes", "building:levels": "2" }).c, V.legendColor("yes"));
  assert.ok(st({ building: "yes" }).dash);
});
