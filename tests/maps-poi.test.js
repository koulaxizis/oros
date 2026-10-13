// Pure logic of the Maps place editor (maps/poi-core.js, OSM upgrade
// wave 2): presets (match, search EN/EL), tag diff + rebase on the
// server's tags, "closed / gone", the API 0.6 XML (escaping,
// osmChange, diffResult), Overpass parsing, simple opening_hours, and
// the sync merge of the "mapsedits" slice.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const vm = require("vm");

const P = require(path.join(__dirname, "..", "maps/poi-core.js"));

function loadPresets() {
  const src = fs.readFileSync(path.join(__dirname, "..", "maps/presets-data.js"), "utf8");
  const ctx = { window: {} };
  vm.runInNewContext(src, ctx);
  return ctx.window.OrosMapsPresets;
}
const DATA = loadPresets();
const IDX = P.presetIndex(DATA);

test("presets data: credited, sane and bilingual", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "maps/presets-data.js"), "utf8");
  assert.match(src.slice(0, 600), /id-tagging-schema/);
  assert.match(src.slice(0, 600), /ISC/);
  assert.ok(DATA.presets.length > 300);
  const ids = new Set();
  for (const p of DATA.presets) {
    assert.ok(!ids.has(p.id), "duplicate preset " + p.id);
    ids.add(p.id);
    assert.ok(p.n && p.n.en, "preset without English name " + p.id);
    for (const f of p.f || []) assert.ok(DATA.fields[f], p.id + " uses missing field " + f);
  }
  const cafe = DATA.presets.find((p) => p.id === "amenity/cafe");
  assert.ok(cafe && cafe.n.el, "café has a Greek name");
  for (const f of DATA.more) assert.ok(DATA.fields[f], "more field " + f);
});

test("matchPreset picks the most specific preset", () => {
  assert.equal(P.matchPreset(IDX, { amenity: "cafe", name: "X" }).id, "amenity/cafe");
  assert.equal(P.matchPreset(IDX, { shop: "bakery" }).id, "shop/bakery");
  const fuel = P.matchPreset(IDX, { amenity: "fuel" });
  assert.equal(fuel.id, "amenity/fuel");
  // An unknown value falls back to the generic key preset when one exists.
  const gen = P.matchPreset(IDX, { shop: "zzzz-unknown" });
  assert.ok(!gen || gen.t.shop === "*");
  assert.equal(P.matchPreset(IDX, { highway: "residential" }), null);
});

test("searchPresets: English, Greek, accents and final sigma", () => {
  assert.equal(P.searchPresets(IDX, "cafe", "en", 5)[0].id, "amenity/cafe");
  const el = P.searchPresets(IDX, "φαρμακειο", "el", 5).map((p) => p.id);
  assert.ok(el.includes("amenity/pharmacy"), el.join());
  assert.deepEqual(P.searchPresets(IDX, "   ", "en"), []);
  assert.equal(P.fold("Καφές"), "καφεσ");
  assert.equal(P.fold("ΆΈΉ"), "αεη");
});

test("fieldsFor: name first, extra fields only when present, no typeCombo", () => {
  const cafe = P.matchPreset(IDX, { amenity: "cafe" });
  const f1 = P.fieldsFor(IDX, cafe, { amenity: "cafe" });
  assert.equal(f1[0], "name");
  for (const f of f1) assert.notEqual(IDX.fields[f].ty, "typeCombo");
  const extra = IDX.more.find((f) => !f1.includes(f) && IDX.fields[f] && IDX.fields[f].k);
  if (extra) {
    const f2 = P.fieldsFor(IDX, cafe, { amenity: "cafe", [IDX.fields[extra].k]: "x" });
    assert.ok(f2.includes(extra));
  }
});

test("diffTags + applySet round-trip", () => {
  const a = { amenity: "cafe", name: "Old", wifi: "yes" };
  const b = { amenity: "cafe", name: "New", phone: "+30 210" };
  const d = P.diffTags(a, b);
  assert.deepEqual(d.set, { name: "New", phone: "+30 210", wifi: "" });
  assert.deepEqual(d.was, { name: "Old", phone: "", wifi: "yes" });
  assert.deepEqual(P.applySet(a, d.set), b);
});

test("rebase: untouched keys follow the server, both-changed keys are conflicts", () => {
  const was = { name: "Old", opening_hours: "" };
  const set = { name: "New", opening_hours: "Mo-Fr 09:00-17:00" };
  // Server changed only an unrelated key: everything applies.
  let r = P.rebase({ amenity: "cafe", name: "Old", website: "https://x.gr" }, set, was);
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.tags, { amenity: "cafe", name: "New", opening_hours: "Mo-Fr 09:00-17:00", website: "https://x.gr" });
  // Server renamed it too: server value kept, conflict reported.
  r = P.rebase({ amenity: "cafe", name: "Other" }, set, was);
  assert.deepEqual(r.conflicts, ["name"]);
  assert.equal(r.tags.name, "Other");
  assert.equal(r.tags.opening_hours, "Mo-Fr 09:00-17:00");
  // Server already has the same value: no conflict.
  r = P.rebase({ amenity: "cafe", name: "New" }, set, was);
  assert.deepEqual(r.conflicts, []);
  // A delete of a key the server removed meanwhile is fine.
  r = P.rebase({ amenity: "cafe" }, { wifi: "" }, { wifi: "yes" });
  assert.deepEqual(r, { tags: { amenity: "cafe" }, conflicts: [] });
});

test("closedTags keeps address and building, drops the business", () => {
  const out = P.closedTags({
    shop: "bakery", name: "Φούρνος", opening_hours: "Mo-Sa 07:00-15:00", "addr:street": "Οδός",
    "addr:housenumber": "5", building: "yes", "payment:cash": "yes", "contact:phone": "1"
  }, "2026-10-13");
  assert.deepEqual(out, {
    "disused:shop": "bakery", "addr:street": "Οδός", "addr:housenumber": "5",
    building: "yes", check_date: "2026-10-13"
  });
});

test("isPlace / mainTag", () => {
  assert.deepEqual(P.mainTag({ name: "x", shop: "kiosk" }), { k: "shop", v: "kiosk" });
  assert.ok(P.isPlace({ amenity: "cafe" }));
  assert.ok(!P.isPlace({ amenity: "bench" }));
  assert.ok(!P.isPlace({ amenity: "waste_basket" }));
  assert.ok(!P.isPlace({ highway: "bus_stop" }));
});

test("XML: values are escaped, osmChange groups and orders operations", () => {
  assert.equal(P.esc(`<a href="x">&'\n`), "&lt;a href=&quot;x&quot;&gt;&amp;&apos;&#10;");
  const cs = P.changesetXml({ comment: 'Uploaded "<b>"', created_by: "orOS Maps 1.44.00" });
  assert.equal(cs, '<osm><changeset><tag k="comment" v="Uploaded &quot;&lt;b&gt;&quot;"/><tag k="created_by" v="orOS Maps 1.44.00"/></changeset></osm>');
  const x = P.osmChangeXml(77, [
    { op: "delete", type: "node", id: 5, version: 3, lat: 38, lon: 23 },
    { op: "modify", type: "way", id: 9, version: 2, nodes: [1, 2, 1], tags: { building: "yes", shop: "x" } },
    { op: "create", type: "node", id: -1, lat: 37.98381234567, lon: 23.7275, tags: { amenity: "cafe", name: "A&B" } },
    { op: "modify", type: "relation", id: 4, version: 1, members: [{ type: "way", ref: 9, role: "outer" }], tags: { type: "multipolygon" } }
  ]);
  assert.equal(x,
    '<osmChange version="0.6" generator="orOS Maps">' +
    '<create><node id="-1" changeset="77" lat="37.9838123" lon="23.7275"><tag k="amenity" v="cafe"/><tag k="name" v="A&amp;B"/></node></create>' +
    '<modify><way id="9" changeset="77" version="2"><nd ref="1"/><nd ref="2"/><nd ref="1"/><tag k="building" v="yes"/><tag k="shop" v="x"/></way>' +
    '<relation id="4" changeset="77" version="1"><member type="way" ref="9" role="outer"/><tag k="type" v="multipolygon"/></relation></modify>' +
    '<delete><node id="5" changeset="77" version="3" lat="38" lon="23"/></delete>' +
    "</osmChange>");
});

test("parseDiffResult", () => {
  const r = P.parseDiffResult('<?xml version="1.0"?><diffResult generator="OSM" version="0.6">' +
    '<node old_id="-1" new_id="123" new_version="1"/><way old_id="9" new_id="9" new_version="3"/>' +
    '<node old_id="5"/></diffResult>');
  assert.deepEqual(r, [
    { type: "node", old: -1, id: 123, version: 1 },
    { type: "way", old: 9, id: 9, version: 3 },
    { type: "node", old: 5, id: 0, version: 0 }
  ]);
  assert.deepEqual(P.parseDiffResult(null), []);
});

test("Overpass: query shape and strict parsing", () => {
  const q = P.overpassQuery(37.9, 23.7, 38, 23.8);
  assert.match(q, /^\[out:json\]/);
  assert.match(q, /nwr\["shop"\]\(37\.900000,23\.700000,38\.000000,23\.800000\);/);
  assert.match(q, /out center tags qt 600;$/);
  const got = P.parseOverpass({ elements: [
    { type: "node", id: 1, lat: 38, lon: 23, tags: { amenity: "cafe", name: "Α\u0007Β" } },
    { type: "way", id: 2, center: { lat: 38.1, lon: 23.1 }, tags: { shop: "supermarket" } },
    { type: "node", id: 3, lat: 38, lon: 23, tags: { amenity: "bench" } },
    { type: "node", id: -4, lat: 38, lon: 23, tags: { shop: "x" } },
    { type: "node", id: 5, lat: 99, lon: 23, tags: { shop: "x" } },
    { type: "area", id: 6, tags: { shop: "x" } },
    { type: "way", id: 7, tags: { shop: "x" } },
    null, "x"
  ] });
  assert.deepEqual(got, [
    { t: "n", id: 1, lat: 38, lon: 23, tags: { amenity: "cafe", name: "Α Β" } },
    { t: "w", id: 2, lat: 38.1, lon: 23.1, tags: { shop: "supermarket" } }
  ]);
  assert.deepEqual(P.parseOverpass("nope"), []);
});

test("opening_hours: parse/format the simple shape, null for anything richer", () => {
  const s = "Mo-Fr 09:00-14:00,17:00-21:00; Sa 09:00-15:00; Su off";
  const rows = P.parseOH(s);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].days, [1, 1, 1, 1, 1, 0, 0]);
  assert.deepEqual(rows[0].times, [["09:00", "14:00"], ["17:00", "21:00"]]);
  assert.equal(P.formatOH(rows), s);
  assert.equal(P.formatOH(P.parseOH("24/7")), "24/7");
  assert.equal(P.formatOH(P.parseOH("Mo,We 10:00-12:00")), "Mo,We 10:00-12:00");
  assert.equal(P.formatOH(P.parseOH("Mo,Tu,We 10:00-12:00")), "Mo-We 10:00-12:00");
  assert.deepEqual(P.parseOH("Sa-Mo 10:00-12:00")[0].days, [1, 0, 0, 0, 0, 1, 1]);
  assert.deepEqual(P.parseOH(""), []);
  for (const bad of ["Mo-Fr 09:00-17:00; PH off", "sunrise-sunset", "Mo 9-17", "Jan Mo 10:00-12:00", "Mo 25:00-26:00"]) {
    assert.equal(P.parseOH(bad), null, bad);
  }
});

function edit(id, m, extra) {
  return Object.assign({ id, m, dev: "devaaaa", op: "modify", t: "n", oid: 42, set: { name: "X" }, was: { name: "" } }, extra);
}

test("normEdit rejects junk and cleans values", () => {
  assert.equal(P.normEdit(null), null);
  assert.equal(P.normEdit(edit("bad id!", 1)), null);
  assert.equal(P.normEdit(edit("abcdef1", 1, { op: "rename" })), null);
  assert.equal(P.normEdit(edit("abcdef1", 1, { dev: "x" })), null);
  assert.equal(P.normEdit(edit("abcdef1", 1, { oid: -3 })), null);
  assert.equal(P.normEdit(edit("abcdef1", 1, { op: "create", lat: 200, lon: 0 })), null);
  assert.equal(P.normEdit(edit("abcdef1", 1, { op: "create", t: "w", lat: 1, lon: 1 })), null);
  assert.equal(P.normEdit(edit("abcdef1", 1, { op: "create", lat: 1, lon: 1, set: { name: "" } })), null);
  const e = P.normEdit(edit("abcdef1", 5, { set: { name: "A\nB", "bad=key": "x", note: 7 }, err: "x".repeat(500) }));
  assert.deepEqual(e.set, { name: "A B" });
  assert.equal(e.err.length, P.LIM.err);
  const c = P.normEdit({ id: "abcdef2", m: 1, dev: "devaaaa", op: "create", t: "n", lat: 37.123456789, lon: 23, set: { amenity: "cafe", x: "" } });
  assert.deepEqual([c.oid, c.lat, c.set, c.was], [0, 37.1234568, { amenity: "cafe" }, undefined]);
  const d = P.normEdit({ id: "abcdef3", m: 1, dev: "devaaaa", op: "delete", t: "n", oid: 9, lat: 1, lon: 1 });
  assert.equal(d.lat, undefined);
});

test("mergeEdits: LWW, tombs win, commutative and idempotent (fuzz)", () => {
  const a = { edits: { abcdef1: edit("abcdef1", 5, { set: { name: "A" } }) }, tombs: {} };
  const b = { edits: { abcdef1: edit("abcdef1", 7, { set: { name: "B" } }) }, tombs: {} };
  assert.equal(P.mergeEdits(a, b).edits.abcdef1.set.name, "B");
  assert.deepEqual(P.mergeEdits(a, { tombs: { abcdef1: 5 } }).edits, {});
  assert.equal(P.mergeEdits(a, { tombs: { abcdef1: 4 } }).edits.abcdef1.set.name, "A");

  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const ids = ["abcdef1", "abcdef2", "abcdef3", "abcdef4"];
  const make = () => {
    const d = { edits: {}, tombs: {} };
    for (const id of ids) {
      if (rnd(3)) d.edits[id] = edit(id, rnd(6), { set: { name: "v" + rnd(3) }, dev: rnd(2) ? "devaaaa" : "devbbbb" });
      if (!rnd(4)) d.tombs[id] = rnd(6);
    }
    return d;
  };
  for (let i = 0; i < 2000; i++) {
    const x = make(), y = make(), z = make();
    const xy = P.mergeEdits(x, y);
    assert.deepEqual(xy, P.mergeEdits(y, x));
    assert.deepEqual(P.mergeEdits(xy, xy), xy);
    assert.deepEqual(P.mergeEdits(P.mergeEdits(x, y), z), P.mergeEdits(x, P.mergeEdits(y, z)));
    assert.equal(JSON.stringify(P.normalizeEdits(xy)), JSON.stringify(xy));
  }
});

test("maps/index.html loads the place editor after the notes, presets are lazy", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "maps/index.html"), "utf8");
  const order = ["maps.js", "osm.js", "osm-api.js", "notes.js", "poi-core.js", "poi.js"]
    .map((f) => html.indexOf('src="' + f + "?v="));
  order.forEach((i) => assert.ok(i > 0));
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1]);
  assert.ok(!html.includes("presets-data.js"), "presets load on demand");
  const poi = fs.readFileSync(path.join(__dirname, "..", "maps/poi.js"), "utf8");
  assert.ok(!/\.innerHTML\s*=\s*(?!\s|ICON|'<svg)/.test(poi), "innerHTML only for static icons");
});
