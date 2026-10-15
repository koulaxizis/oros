// Maps .orosmap (maps/package.js + bundle.js): the picked groups,
// places and tracks pack into content.json with a GeoJSON + GPX
// preview, read back without ids, and hostile content.json is cut down.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const P = require(path.join(ROOT, "maps", "package.js"));
const T = require(path.join(ROOT, "maps", "tracks-core.js"));
const FC = require(path.join(ROOT, "maps", "fav-core.js"));
const MIME = "application/x-oros-map";

const T0 = Date.UTC(2026, 5, 1, 8, 0, 0);
function sample() {
  const tr = { name: "Υμηττός", segs: [[[37.95, 23.80, 210, T0], [37.951, 23.801, 215, T0 + 60000], [37.953, 23.803, null, T0 + 120000]]],
    wpts: [{ lat: 37.95, lon: 23.8, ele: null, t: null, name: "Start" }],
    trace: "https://www.openstreetmap.org/user/me/traces/123" };
  const entry = T.entryFor("abc123def", tr, { name: "Morning hike", color: "#61afef", folder: "Hikes", hidden: 1, src: "rec" }, T0 + 5);
  return {
    title: "Athens <weekend>",
    places: [
      { id: "p37.975200,23.730200", name: "Κάβα \"Νο 1\"", sub: "Πλάκα", lat: 37.9752, lon: 23.7302, mtime: 100 },
      { id: "p37.971500,23.726700", name: "Acropolis", sub: "", lat: 37.9715, lon: 23.7267, mtime: 200 }
    ],
    groups: { gabcd1: { name: "Food", color: "#e06c75", m: 1 }, gzzzz9: { name: "Unused", color: "#61afef", m: 1 } },
    pins: { "p37.975200,23.730200": "gabcd1" },
    tracks: [{ entry, tr }]
  };
}

test("build: groups in use, places with their group, tracks with points, previews", () => {
  const b = P.build(sample(), T);
  const c = b.content;
  assert.equal(c.kind, "oros-maps-package");
  assert.equal(c.ver, 1);
  assert.equal(c.title, "Athens weekend");
  assert.deepEqual(c.groups, [{ id: "gabcd1", name: "Food", color: "#e06c75" }]);
  assert.deepEqual(c.places.map((p) => p.group), ["gabcd1", ""]);
  assert.equal(c.tracks.length, 1);
  assert.deepEqual(Object.keys(c.tracks[0]).sort(), ["color", "folder", "hidden", "id", "m", "name", "src", "track"]);
  assert.equal(c.tracks[0].folder, "Hikes");
  assert.equal(c.tracks[0].hidden, 1);
  assert.equal(c.tracks[0].track.segs[0].length, 3);
  assert.equal(c.tracks[0].track.trace, "https://www.openstreetmap.org/user/me/traces/123");
  assert.equal(b.created, 100);
  assert.equal(b.modified, T0 + 5);
  assert.deepEqual(b.preview.map((p) => p.name), ["places.geojson", "tracks.gpx"]);
  const geo = JSON.parse(b.preview[0].data);
  assert.equal(geo.type, "FeatureCollection");
  assert.deepEqual(geo.features[0].geometry.coordinates, [23.7302, 37.9752]);
  assert.equal(geo.features[0].properties.group, "Food");
  // the GPX preview is a valid file the app itself reads back
  const gpx = b.preview[1].data;
  assert.equal((gpx.match(/<trk>/g) || []).length, 1);
  assert.match(gpx, /<name>Morning hike<\/name>/);
  const back = T.parseAny(gpx, "tracks.gpx");
  assert.equal(back.segs[0].length, 3);
  assert.equal(back.wpts[0].name, "Start");
});

test("round trip through a real bundle: same data, no ids, colours kept", async () => {
  const b = P.build(sample(), T);
  const bytes = await B.write({ mime: MIME, app: "maps", schema: "maps/1", content: b.content,
    meta: { title: b.title, language: "el", generator: "orOS Maps" }, preview: b.preview, media: {} });
  assert.equal(B.sniff(bytes.subarray(0, 128)), MIME);
  const r = await B.read(bytes, { mime: MIME });
  const pl = P.parse(r.content, { colors: FC.COLORS, T });
  assert.equal(pl.title, "Athens weekend");
  assert.deepEqual(pl.groups, [{ key: 0, name: "Food", color: "#e06c75" }]);
  assert.deepEqual(pl.places, [
    { lat: 37.9752, lon: 23.7302, name: "Κάβα \"Νο 1\"", sub: "Πλάκα", group: 0 },
    { lat: 37.9715, lon: 23.7267, name: "Acropolis", sub: "", group: -1 }
  ]);
  assert.equal(pl.tracks.length, 1);
  const x = pl.tracks[0];
  assert.equal(x.name, "Morning hike");
  assert.equal(x.color, "#61afef");
  assert.equal(x.folder, "Hikes");
  assert.equal(x.hidden, 1);
  assert.deepEqual(x.tr.segs, sample().tracks[0].tr.segs);
  assert.equal(x.tr.trace, "https://www.openstreetmap.org/user/me/traces/123");
  assert.ok(!("id" in x) && !("id" in pl.places[0]), "ids never come back: the app makes new ones");
  // a bundle of another app is refused
  await assert.rejects(B.read(bytes, { mime: "application/x-oros-notes" }));
});

test("parse: hostile content is cut down", () => {
  assert.throws(() => P.parse({ kind: "other" }), /notpackage/);
  assert.throws(() => P.parse(null), /notpackage/);
  const pl = P.parse({
    kind: "oros-maps-package", ver: 1, title: "<b>x</b>\u0000",
    groups: [{ id: "g1", name: "<img src=x onerror=1>", color: "red" }, { id: "g1", name: "dup" }, { id: "g2", name: "  " }],
    places: [
      { lat: 91, lon: 0, name: "bad" }, { lat: "1", lon: 2 }, { lat: 1, lon: 2, name: 5, group: "g1" },
      { lat: 1.0000001, lon: 2, name: "same place" }, { lat: 3, lon: 4, name: "x".repeat(500), group: "nope" }
    ],
    tracks: [
      { name: "ok", color: "#ABCDEF", track: { segs: [[[1, 2, "e", "t"], [1.001, 2.001, 5, 1e20], ["x", 1]]], wpts: [{ lat: 1, lon: 2, name: "<w>" }], trace: "javascript:1" } },
      { name: "nopoints", track: { segs: [[["a", "b"]]] } },
      { name: "notrack" }, null
    ]
  }, { colors: FC.COLORS, T });
  assert.equal(pl.title, "b x /b");
  assert.equal(pl.groups.length, 1);
  assert.equal(pl.groups[0].color, "", "unknown colour → the app picks one");
  assert.ok(!/[<>]/.test(pl.groups[0].name));
  assert.equal(pl.places.length, 2);
  assert.equal(pl.places[0].name, "?");
  assert.equal(pl.places[0].group, 0);
  assert.equal(pl.places[1].name.length, 120);
  assert.equal(pl.places[1].group, -1);
  assert.equal(pl.tracks.length, 1);
  const tr = pl.tracks[0].tr;
  assert.equal(pl.tracks[0].color, "", "not one of the track colours");
  assert.deepEqual(tr.segs[0].map((p) => p.slice(0, 2)), [[1, 2], [1.001, 2.001]]);
  assert.equal(tr.segs[0][0][2], null);
  assert.equal(tr.trace, undefined);
});

test("wiring: scripts, receiver, accept list, strings", () => {
  const html = fs.readFileSync(path.join(ROOT, "maps", "index.html"), "utf8");
  const i = (s) => html.indexOf(s);
  assert.ok(i('src="../bundle.js') > 0 && i('src="../bundle.js') < i('src="package-ui.js'));
  assert.ok(i('src="tracks-core.js') < i('src="package.js') && i('src="package.js') < i('src="package-ui.js'));
  assert.ok(i('src="import-ui.js') < i('src="package-ui.js'));
  assert.match(fs.readFileSync(path.join(ROOT, "maps", "import-ui.js"), "utf8"), /PK\.isBundle\(r\.name, r\.bytes\)/);
  assert.match(fs.readFileSync(path.join(ROOT, "maps", "import.js"), "utf8"), /\.orosmap,application\/x-oros-map/);
  const ui = fs.readFileSync(path.join(ROOT, "maps", "package-ui.js"), "utf8");
  assert.match(ui, /"Unzipped orOS folder…"/);
  assert.match(ui, /"Αποσυμπιεσμένος φάκελος orOS…"/);
  assert.match(ui, /"orOS file \(\.orosmap\)"/);
  assert.match(ui, /"Αρχείο orOS \(\.orosmap\)"/);
  assert.ok(!/innerHTML/.test(ui), "names never through innerHTML");
});
