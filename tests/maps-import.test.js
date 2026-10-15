// Maps "Import from another app" (maps/import.js): KMZ, Google Takeout
// saved places and lists, Google Timeline (on-device Timeline.json,
// iPhone variant, Records.json, Semantic Location History), TCX and
// FIT (a hand-built binary: little and big endian definitions,
// compressed timestamp headers, developer fields, skipped messages).
// Fixtures are built here from the documented shapes.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const IMP = require(path.join(__dirname, "..", "maps", "import.js"));
const T = require(path.join(__dirname, "..", "maps", "tracks-core.js"));
const Z = require(path.join(__dirname, "..", "atelier", "zip.js"));
const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const enc = s => new TextEncoder().encode(s);

// ---------- FIT builder ----------
const FIT_EPOCH = 631065600;               // unix seconds of the FIT epoch
const semi = d => Math.round(d * 2147483648 / 180);
function u(n, size, big) {
  const out = [];
  for (let i = 0; i < size; i++) out.push(Math.floor(n / Math.pow(256, i)) % 256);
  return big ? out.reverse() : out;
}
const s32 = n => (n < 0 ? n + 0x100000000 : n);
// fields: [[num, size, base]], dev: [[num, size, idx]]
function def(local, g, fields, big, dev) {
  const h = 0x40 | local | (dev ? 0x20 : 0);
  let b = [h, 0, big ? 1 : 0].concat(u(g, 2, big), [fields.length]);
  fields.forEach(f => { b = b.concat(f); });
  if (dev) { b.push(dev.length); dev.forEach(f => { b = b.concat(f); }); }
  return b;
}
function fitFile(records) {
  const data = [].concat(...records);
  const head = [14, 0x20].concat(u(2132, 2), u(data.length, 4), [0x2e, 0x46, 0x49, 0x54], [0, 0]);
  return new Uint8Array(head.concat(data, [0, 0]));
}
const T0 = Date.UTC(2024, 4, 10, 8, 0, 0) / 1000 - FIT_EPOCH;   // 10 May 2024 08:00Z
function sampleFit() {
  const recs = [];
  // file_id (global 0), little endian: serial_number (3), time_created (4)
  recs.push(def(0, 0, [[3, 4, 0x8c], [4, 4, 0x86]], false));
  recs.push([0x00].concat(u(3912345678, 4), u(T0, 4)));
  // record (global 20) little endian: timestamp, lat, long, altitude(u16), + one dev field of 3 bytes
  recs.push(def(1, 20, [[253, 4, 0x86], [0, 4, 0x85], [1, 4, 0x85], [2, 2, 0x84]], false, [[0, 3, 0]]));
  recs.push([0x01].concat(u(T0, 4), u(s32(semi(37.9755)), 4), u(s32(semi(23.7348)), 4), u((100 + 500) * 5, 2), [9, 9, 9]));
  // an event message (global 21) the decoder must skip by size
  recs.push(def(2, 21, [[253, 4, 0x86], [0, 1, 0], [1, 1, 0], [3, 4, 0x86]], false));
  recs.push([0x02].concat(u(T0 + 1, 4), [0, 0], u(0, 4)));
  // record redefined on local 3, big endian, enhanced_altitude (78), no timestamp:
  // its points come with compressed timestamp headers (local 3 → bits 5-6 = 3)
  recs.push(def(3, 20, [[0, 4, 0x85], [1, 4, 0x85], [78, 4, 0x86]], true));
  [5, 10, 40].forEach((dt, i) => {
    const off = (T0 + dt) & 0x1f;
    recs.push([0x80 | (3 << 5) | off].concat(u(s32(semi(37.976 + i * 0.001)), 4, true), u(s32(semi(-23.735 - i * 0.001)), 4, true), u((150 + 500) * 5, 4, true)));
  });
  // a record without a position (invalid 0x7fffffff) is skipped
  recs.push([0x01].concat(u(T0 + 50, 4), u(0x7fffffff, 4), u(0x7fffffff, 4), u(0xffff, 2), [0, 0, 0]));
  return fitFile(recs);
}

test("FIT: definitions, both endians, compressed timestamps, dev fields, skipped messages", () => {
  const f = IMP.parseFit(sampleFit());
  assert.ok(f);
  assert.equal(f.fileId, "3912345678-" + T0);
  assert.equal(f.pts.length, 4);
  assert.deepEqual(f.pts[0].slice(0, 3), [37.9755, 23.7348, 100]);
  assert.equal(f.pts[0][3], (FIT_EPOCH + T0) * 1000);
  assert.ok(Math.abs(f.pts[1][0] - 37.976) < 1e-6 && Math.abs(f.pts[1][1] + 23.735) < 1e-6);
  assert.equal(f.pts[1][2], 150, "enhanced altitude, big endian");
  assert.deepEqual(f.pts.slice(1).map(p => p[3] / 1000 - FIT_EPOCH - T0), [5, 10, 40], "compressed timestamps roll over 32 s");
  assert.equal(IMP.parseFit(new Uint8Array(20)), null);
  // a truncated file gives what was read so far, never throws
  const cut = sampleFit().slice(0, 60);
  assert.doesNotThrow(() => IMP.parseFit(cut));
});

test("FIT file → one track with a stable id", async () => {
  const bytes = sampleFit();
  assert.equal(IMP.kind("ride.fit", bytes), "new");
  const r = await IMP.parse({ name: "Morning ride.fit", bytes });
  assert.deepEqual(r.sources, ["fit"]);
  assert.equal(r.tracks.length, 1);
  assert.equal(r.tracks[0].name, "Morning ride");
  assert.equal(r.tracks[0].key, "fit|3912345678-" + T0);
  const id = IMP.trackId(r.tracks[0].key);
  assert.match(id, T.ID_RE, "valid track id for tracks-core");
  assert.equal(id, IMP.trackId("fit|3912345678-" + T0));
  // entryFor + GPX round trip works with the imported points
  const tr = { name: "x", segs: r.tracks[0].segs, wpts: [] };
  const e = T.entryFor(id, tr, { src: "import" }, 5);
  assert.equal(e.n, 4);
  assert.equal(T.parseAny(T.writeGpx(tr), "a.gpx").segs[0].length, 4);
});

test("TCX: activities and courses, positions only, stable key", () => {
  const tcx = `<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities><Activity Sport="Running"><Id>2024-05-10T06:00:00Z</Id>
   <Lap StartTime="2024-05-10T06:00:00Z"><Track>
    <Trackpoint><Time>2024-05-10T06:00:00Z</Time><Position><LatitudeDegrees>40.6401</LatitudeDegrees><LongitudeDegrees>22.9444</LongitudeDegrees></Position><AltitudeMeters>12.5</AltitudeMeters></Trackpoint>
    <Trackpoint><Time>2024-05-10T06:00:05Z</Time><HeartRateBpm><Value>120</Value></HeartRateBpm></Trackpoint>
    <Trackpoint><Time>2024-05-10T06:00:10Z</Time><Position><LatitudeDegrees>40.6405</LatitudeDegrees><LongitudeDegrees>22.9450</LongitudeDegrees></Position></Trackpoint>
   </Track></Lap><Creator><Name>Forerunner &amp; co</Name></Creator></Activity></Activities>
  <Courses><Course><Name>Hill loop</Name><Track>
    <Trackpoint><Position><LatitudeDegrees>40.1</LatitudeDegrees><LongitudeDegrees>22.1</LongitudeDegrees></Position></Trackpoint>
    <Trackpoint><Position><LatitudeDegrees>40.2</LatitudeDegrees><LongitudeDegrees>22.2</LongitudeDegrees></Position></Trackpoint>
  </Track></Course></Courses></TrainingCenterDatabase>`;
  assert.equal(IMP.kind("a.tcx", enc(tcx)), "new");
  const r = IMP.parseText(tcx, "run.tcx");
  assert.deepEqual(r.sources, ["tcx"]);
  assert.equal(r.tracks.length, 2);
  const a = r.tracks[0];
  assert.equal(a.name, "Running 2024-05-10");
  assert.equal(a.segs[0].length, 2, "a trackpoint without a position is skipped");
  assert.deepEqual(a.segs[0][0], [40.6401, 22.9444, 12.5, Date.UTC(2024, 4, 10, 6)]);
  assert.equal(r.tracks[1].name, "Hill loop");
  assert.equal(IMP.parseText(tcx, "run.tcx").tracks[0].key, a.key, "same file, same key");
});

function kml(name) {
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${name}</name>
  <Style id="s"><IconStyle><Icon><href>images/pin.png</href></Icon></IconStyle></Style>
  <Folder><name>Layer</name>
  <Placemark><name>Acropolis &amp; Museum</name><description><![CDATA[<b>Old</b> rock<script>x</script>]]></description><Point><coordinates>23.7257,37.9715,0</coordinates></Point></Placemark>
  <Placemark><name>Lycabettus</name><Point><coordinates>23.7432,37.9819</coordinates></Point></Placemark>
  <Placemark><name>Walk up</name><LineString><coordinates>23.73,37.97 23.74,37.98 23.745,37.982</coordinates></LineString></Placemark>
  <Placemark><name>Recorded</name><gx:Track><when>2024-05-01T10:00:00Z</when><when>2024-05-01T10:01:00Z</when>
    <gx:coord>23.7 37.9 50</gx:coord><gx:coord>23.71 37.91 55</gx:coord></gx:Track></Placemark>
  </Folder></Document></kml>`;
}

test("KMZ: doc.kml, pictures ignored, lines → tracks, points → places in a list", async () => {
  const bytes = Z.write([{ name: "images/pin.png", data: new Uint8Array([137, 80, 78, 71]) }, { name: "doc.kml", data: kml("Athens trip") }]);
  assert.equal(IMP.kind("Athens.kmz", bytes), "new");
  const r = await IMP.parse({ name: "Athens.kmz", bytes });
  assert.deepEqual(r.sources, ["kmz"]);
  assert.equal(r.tracks.length, 2);
  assert.deepEqual(r.tracks.map(t => t.name), ["Walk up", "Recorded"]);
  assert.equal(r.tracks[0].folder, "Athens trip");
  assert.equal(r.tracks[1].segs[0][0][3], Date.UTC(2024, 4, 1, 10));
  assert.equal(r.places.length, 2);
  assert.deepEqual(r.places[0], { lat: 37.9715, lon: 23.7257, name: "Acropolis & Museum", sub: "Old rock x", list: "Athens trip" });
  // the first .kml when there is no doc.kml; the list name falls back to the file
  const b2 = Z.write([{ name: "files/My list.kml", data: kml("").replace("<name></name>", "") }]);
  const r2 = await IMP.parse({ name: "export.kmz", bytes: b2 });
  assert.equal(r2.places[0].list, "My list");
  // again: same keys
  const r3 = await IMP.parse({ name: "Athens.kmz", bytes });
  assert.deepEqual(r3.tracks.map(t => t.key), r.tracks.map(t => t.key));
});

test("plain GPX / KML / GeoJSON stay on the old path", () => {
  assert.equal(IMP.kind("a.gpx", enc('<?xml version="1.0"?><gpx></gpx>')), "plain");
  assert.equal(IMP.kind("a.kml", enc('<kml></kml>')), "plain");
  assert.equal(IMP.kind("a.geojson", enc('{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"name":"x"},"geometry":{"type":"Point","coordinates":[1,2]}}]}')), "plain");
  assert.equal(IMP.kind("a.txt", enc("hello")), "");
});

test("Google Maps URL coordinates", () => {
  const c = IMP.coordsFromUrl;
  assert.deepEqual(c("https://www.google.com/maps/place/X/@37.1,23.2,17z/data=!3m1!4b1!4m5!3m4!1s0x0:0x0!8m2!3d37.9715!4d23.7257"), { lat: 37.9715, lon: 23.7257 }, "!3d!4d beats the viewport");
  assert.deepEqual(c("https://maps.google.com/?q=40.64,22.94"), { lat: 40.64, lon: 22.94 });
  assert.deepEqual(c("https://www.google.com/maps/search/?api=1&query=40.64%2C-22.94"), { lat: 40.64, lon: -22.94 });
  assert.deepEqual(c("https://www.google.com/maps/@-33.5,151.2,15z"), { lat: -33.5, lon: 151.2 });
  assert.equal(c("https://www.google.com/maps/place/Cafe/data=!4m2!3m1!1s0x14a1bd:0x1"), null);
  assert.equal(c("https://maps.google.com/?cid=123456"), null);
  assert.equal(c("https://maps.google.com/?q=95,10"), null, "out of range");
  assert.equal(c("https://maps.google.com/?q=0,0"), null);
});

test("Google Takeout Saved Places.json: old and new shapes, no location skipped", () => {
  const j = {
    type: "FeatureCollection",
    features: [
      { type: "Feature", geometry: { type: "Point", coordinates: [23.7275, 37.9838] },
        properties: { "Google Maps URL": "http://maps.google.com/?cid=1", Location: { Address: "Syntagma, Athens", "Business Name": "Grande Bretagne", "Geo Coordinates": { Latitude: "37.9760", Longitude: "23.7348" } },
          Published: "2019-01-01T10:00:00Z", Title: "Hotel", Updated: "2019-01-02T10:00:00Z" } },
      { type: "Feature", geometry: { type: "Point", coordinates: [22.9444, 40.6401] },
        properties: { date: "2023-03-01T10:00:00Z", google_maps_url: "http://maps.google.com/?cid=2", location: { address: "Thessaloniki", name: "White Tower" } } },
      { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] },
        properties: { google_maps_url: "http://maps.google.com/?cid=3", Comment: "No location information is available for this saved place" } },
      { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] },
        properties: { google_maps_url: "https://maps.google.com/?q=39.36,22.95", location: { name: "Volos" } } }
    ]
  };
  const txt = JSON.stringify(j);
  assert.equal(IMP.kind("Saved Places.json", enc(txt)), "new");
  const r = IMP.parseText(txt, "Takeout/Maps (your places)/Saved Places.json");
  assert.deepEqual(r.sources, ["gsaved"]);
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.places.map(p => [p.name, p.lat, p.lon, p.list]), [
    ["Grande Bretagne", 37.976, 23.7348, "Saved Places"],
    ["White Tower", 40.6401, 22.9444, "Saved Places"],
    ["Volos", 39.36, 22.95, "Saved Places"]
  ]);
  assert.equal(r.places[0].sub, "Syntagma, Athens");
});

test("Google Takeout Saved/*.csv lists: coordinates from URLs, rest skipped", () => {
  const csv = "Title,Note,URL,Tags,Comment\n,,,,\n" +
    "Cafe Avissinia,great view,\"https://www.google.com/maps/place/Avissinia/@37.97,23.72,17z/data=!3d37.9765!4d23.7231\",,\n" +
    "Mystery place,,https://www.google.com/maps/place/Mystery/data=!4m2!3m1!1s0x14:0x15,,\n" +
    "\"Pin, dropped\",,\"https://maps.google.com/?q=38.0,23.8\",,later\n";
  assert.equal(IMP.kind("Want to go.csv", enc(csv)), "new");
  const r = IMP.parseText(csv, "Takeout/Saved/Want to go.csv");
  assert.deepEqual(r.sources, ["glist"]);
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.places.map(p => [p.name, p.sub, p.lat, p.lon, p.list]), [
    ["Cafe Avissinia", "great view", 37.9765, 23.7231, "Want to go"],
    ["Pin, dropped", "later", 38, 23.8, "Want to go"]
  ]);
  assert.equal(IMP.parseText("a,b\n1,2\n", "x.csv"), null, "not a Google list");
});

// ---------- Timeline ----------
const TL = {
  semanticSegments: [
    { startTime: "2024-03-05T08:00:00.000+02:00", endTime: "2024-03-05T09:00:00.000+02:00",
      timelinePath: [
        { point: "37.9838°, 23.7275°", time: "2024-03-05T08:00:00.000+02:00" },
        { point: "37.9850°, 23.7300°", time: "2024-03-05T08:10:00.000+02:00" },
        { point: "37.9900°, 23.7400°", time: "2024-03-05T08:20:00.000+02:00" }
      ] },
    { startTime: "2024-03-05T09:00:00.000+02:00", endTime: "2024-03-05T17:00:00.000+02:00",
      visit: { hierarchyLevel: 0, probability: "0.9", topCandidate: { placeId: "ChIJwork", semanticType: "WORK", probability: "0.8", placeLocation: { latLng: "37.9900°, 23.7400°" } } } },
    { startTime: "2024-03-05T17:00:00.000+02:00", endTime: "2024-03-05T17:30:00.000+02:00",
      activity: { start: { latLng: "37.9900°, 23.7400°" }, end: { latLng: "37.9838°, 23.7275°" }, distanceMeters: 1500, topCandidate: { type: "WALKING", probability: 0.9 } } },
    { startTime: "2024-03-06T23:30:00.000+02:00", endTime: "2024-03-07T07:00:00.000+02:00",
      visit: { topCandidate: { placeId: "ChIJhome", semanticType: "HOME", placeLocation: { latLng: "37.9838°, 23.7275°" } } } },
    { startTime: "2024-03-09T12:00:00.000+02:00", endTime: "2024-03-09T13:00:00.000+02:00",
      visit: { topCandidate: { placeId: "ChIJwork", semanticType: "WORK", placeLocation: { latLng: "37.9900°, 23.7400°" } } } }
  ],
  rawSignals: [{ position: { LatLng: "37.9840°, 23.7280°", accuracyMeters: 10, altitudeMeters: 90, timestamp: "2024-03-05T08:05:00.000+02:00" } }],
  userLocationProfile: { frequentPlaces: [] }
};

test("Timeline.json (on device): days, segments split at gaps, visits, nothing without a range", () => {
  const txt = JSON.stringify(TL);
  assert.equal(IMP.kind("Timeline.json", enc(txt)), "new");
  const r = IMP.parseText(txt, "Timeline.json");
  assert.deepEqual(r.sources, ["timeline"]);
  assert.equal(r.tracks.length, 0, "no tracks until a range is picked");
  assert.equal(r.places.length, 0);
  assert.deepEqual(IMP.timelineRange(r.timeline), { first: "2024-03-05", last: "2024-03-09", days: 4 });
  assert.deepEqual(IMP.timelinePlan(r.timeline, "", ""), { tracks: [], places: [], points: 0 });
  assert.deepEqual(IMP.timelinePlan(r.timeline, "2024-03-09", "2024-03-05").tracks, [], "from after to");
  const p = IMP.timelinePlan(r.timeline, "2024-03-05", "2024-03-05");
  assert.equal(p.tracks.length, 1);
  const day = p.tracks[0];
  assert.equal(day.key, "tl|2024-03-05");
  // 08:00 08:05(raw) 08:10 08:20 | 09:00 visit start alone (40 min gap, then 8 h) |
  // 17:00 visit end = walk start, 17:30 walk end
  assert.deepEqual(day.segs.map(s => s.length), [4, 2]);
  assert.equal(day.segs[0][1][2], 90, "raw signal altitude");
  assert.deepEqual(p.places.map(x => [x.key, x.type, x.count]), [["ChIJwork", "WORK", 1]]);
  const all = IMP.timelinePlan(r.timeline, "2024-03-01", "2024-03-31");
  assert.deepEqual(all.places.map(x => [x.key, x.count, x.first, x.last]), [["ChIJwork", 2, "2024-03-05", "2024-03-09"], ["ChIJhome", 1, "2024-03-06", "2024-03-06"]]);
  assert.deepEqual(all.tracks.map(t => t.ymd), ["2024-03-05"], "days with a single point make no track");
  const off = IMP.timelinePlan(r.timeline, "2024-03-01", "2024-03-31", { tracks: false });
  assert.equal(off.tracks.length, 0);
  assert.equal(IMP.timelinePlan(r.timeline, "2024-03-01", "2024-03-31", { places: false }).places.length, 0);
});

test("Timeline: per-day point cap keeps the first and last point", () => {
  const path = [];
  for (let i = 0; i < 300; i++) path.push({ point: `geo:${(37 + i * 0.0001).toFixed(4)},23.5`, time: new Date(Date.UTC(2024, 0, 2, 9, 0, i * 5)).toISOString().replace("Z", "+00:00") });
  const r = IMP.parseText(JSON.stringify({ semanticSegments: [{ startTime: path[0].time, endTime: path[299].time, timelinePath: path }] }), "Timeline.json");
  const p = IMP.timelinePlan(r.timeline, "2024-01-02", "2024-01-02", { dayPts: 50 });
  const seg = p.tracks[0].segs[0];
  assert.equal(seg.length, 50);
  assert.equal(seg[0][0], 37);
  assert.equal(seg[49][0], 37.0299);
});

test("Timeline iPhone variant (array, geo: strings, minute offsets)", () => {
  const ios = [
    { startTime: "2024-06-01T10:00:00.000+03:00", endTime: "2024-06-01T11:00:00.000+03:00",
      timelinePath: [{ point: "geo:40.640100,22.944400", durationMinutesOffsetFromStartTime: "0" }, { point: "geo:40.650000,22.950000", durationMinutesOffsetFromStartTime: "12" }] },
    { startTime: "2024-06-01T11:00:00.000+03:00", endTime: "2024-06-01T12:00:00.000+03:00",
      visit: { hierarchyLevel: "0", topCandidate: { probability: "0.6", semanticType: "Unknown", placeID: "ChIJx", placeLocation: "geo:40.650000,22.950000" } } }
  ];
  const r = IMP.parseText(JSON.stringify(ios), "location-history.json");
  assert.deepEqual(r.sources, ["timeline"]);
  const p = IMP.timelinePlan(r.timeline, "2024-06-01", "2024-06-01");
  assert.equal(p.tracks[0].segs[0][1][3], Date.parse("2024-06-01T10:12:00+03:00"));
  assert.deepEqual(p.places.map(x => [x.key, x.type, x.lat]), [["ChIJx", "UNKNOWN", 40.65]]);
});

test("Takeout Records.json and Semantic Location History", async () => {
  const rec = { locations: [
    { latitudeE7: 379838000, longitudeE7: 237275000, accuracy: 10, altitude: 80, timestamp: "2015-07-01T12:00:00.000Z" },
    { latitudeE7: 379850000, longitudeE7: 237300000, timestampMs: String(Date.UTC(2015, 6, 1, 12, 5)) },
    { latitudeE7: 4294967296 - 338000000, longitudeE7: 1512000000, timestamp: "2015-07-02T12:00:00Z" },
    { latitudeE7: "x", longitudeE7: 1, timestamp: "2015-07-01T12:00:00Z" }
  ] };
  const r = IMP.parseText(JSON.stringify(rec), "Records.json");
  assert.deepEqual(r.sources, ["timeline"]);
  const days = Object.keys(r.timeline.days).sort();
  assert.equal(days.length, 2);
  assert.equal(r.timeline.days[days[1]][0][0], -33.8, "the old E7 overflow");
  const sem = { timelineObjects: [
    { activitySegment: { startLocation: { latitudeE7: 379838000, longitudeE7: 237275000 }, endLocation: { latitudeE7: 379900000, longitudeE7: 237400000 },
      duration: { startTimestamp: "2019-04-03T08:00:00Z", endTimestamp: "2019-04-03T08:20:00Z" },
      waypointPath: { waypoints: [{ latE7: 379850000, lngE7: 237300000 }] } } },
    { placeVisit: { location: { latitudeE7: 379900000, longitudeE7: 237400000, placeId: "ChIJmus", name: "National Museum", address: "Patision 44" },
      duration: { startTimestampMs: String(Date.UTC(2019, 3, 3, 8, 20)), endTimestampMs: String(Date.UTC(2019, 3, 3, 10, 0)) } } },
    { activitySegment: { duration: { startTimestamp: "2019-04-03T10:00:00Z", endTimestamp: "2019-04-03T10:30:00Z" },
      startLocation: { latitudeE7: 379900000, longitudeE7: 237400000 }, endLocation: { latitudeE7: 379838000, longitudeE7: 237275000 },
      simplifiedRawPath: { points: [{ latE7: 379870000, lngE7: 237350000, timestamp: "2019-04-03T10:15:00Z" }] } } }
  ] };
  // A Takeout ZIP with translated folder names: read by shape
  const bytes = Z.write([
    { name: "Takeout/Ιστορικό τοποθεσιών/Semantic Location History/2019/2019_APRIL.json", data: JSON.stringify(sem) },
    { name: "Takeout/Ιστορικό τοποθεσιών/Records.json", data: JSON.stringify(rec) },
    { name: "Takeout/Saved/Starred places.csv", data: "Title,Note,URL,Comment\nHome,,\"https://maps.google.com/?q=37.9,23.7\",\nX,,https://maps.google.com/?cid=1,\n" },
    { name: "Takeout/archive_browser.html", data: "<html></html>" }
  ]);
  assert.equal(IMP.kind("takeout.zip", bytes), "new");
  const z = await IMP.parse({ name: "takeout-20240101.zip", bytes });
  assert.deepEqual(z.sources.sort(), ["glist", "timeline"]);
  assert.equal(z.places.length, 1);
  assert.equal(z.places[0].list, "Starred places");
  assert.equal(z.skipped, 1);
  const p = IMP.timelinePlan(z.timeline, "2019-04-03", "2019-04-03");
  assert.equal(p.tracks.length, 1);
  assert.deepEqual(p.tracks[0].segs.map(s => s.length), [3, 3], "repeated times dropped; the visit splits the day");
  assert.deepEqual(p.places.map(x => [x.name, x.sub, x.count]), [["National Museum", "Patision 44", 1]]);
  assert.deepEqual(IMP.timelineRange(z.timeline).first, "2015-07-01");
});

test("merge several files, dedupe; plan: only what is missing, stable ids", async () => {
  const a = IMP.parseText("Title,URL\nA,\"https://maps.google.com/?q=1.5,2.5\"\nB,\"https://maps.google.com/?q=3.5,4.5\"\n", "L1.csv");
  const b = IMP.parseText("Title,URL\nA again,\"https://maps.google.com/?q=1.5,2.5\"\n", "L2.csv");
  const fit = await IMP.parse({ name: "r.fit", bytes: sampleFit() });
  const m = IMP.merge([a, b, fit, null]);
  assert.equal(m.places.length, 2, "same coordinates once");
  assert.deepEqual(m.sources, ["glist", "fit"]);
  const tid = IMP.trackId(fit.tracks[0].key);
  const pid = IMP.placeKey(1.5, 2.5);
  assert.equal(pid, "p1.500000,2.500000");
  const pl = IMP.plan(m.tracks, m.places, { tracks: { [tid]: 1 }, places: { [pid]: 1 } });
  assert.equal(pl.tracksThere, 1);
  assert.equal(pl.placesThere, 1);
  assert.deepEqual(pl.places.map(p => p.id), ["p3.500000,4.500000"]);
  const pl2 = IMP.plan(m.tracks, m.places, {});
  assert.equal(pl2.tracks[0].id, tid);
  assert.equal(pl2.tracks[0].start, (FIT_EPOCH + T0) * 1000);
  assert.deepEqual(IMP.trackRange(pl2.tracks), { first: "2024-05-10", last: "2024-05-10" });
  assert.equal(IMP.merge([null]), null);
});

test("hostile input: never throws, nothing from the file runs", async () => {
  const bad = ["", "{", "[]", "{\"semanticSegments\": 5}", "<kml><Placemark><name><script>x</script></name></Placemark></kml>",
    "{\"type\":\"FeatureCollection\",\"features\":[{\"properties\":{\"Location\":{}}}]}"];
  bad.forEach(s => assert.doesNotThrow(() => IMP.parseText(s, "x.json")));
  assert.equal(await IMP.parse({ name: "x.zip", bytes: new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]) }), null);
  assert.equal(await IMP.parse({ name: "x", bytes: new Uint8Array(0) }), null);
});

test("wiring: scripts, hooks, help, strings", () => {
  const html = read("maps/index.html");
  assert.match(html, /\.\.\/importkit\.js\?v=/);
  assert.match(html, /\.\.\/atelier\/zip\.js\?v=/);
  assert.ok(html.indexOf('"import.js?v=') > html.indexOf('"fav.js?v='), "import after fav.js");
  assert.ok(html.indexOf('"import-ui.js?v=') > html.indexOf('"import.js?v=') && html.indexOf('"import.js?v=') > html.indexOf("importkit.js"));
  const ui = read("maps/import-ui.js");
  assert.doesNotMatch(ui, /innerHTML|insertAdjacentHTML|outerHTML/, "file text never as HTML");
  assert.match(read("maps/maps.js"), /importPlaces:/);
  assert.match(read("maps/tracks.js"), /addImported:/);
  assert.match(read("maps/fav.js"), /importPins:/);
  ["en", "el"].forEach(l => {
    const h = read(`maps/help.${l}.txt`);
    ["KMZ", "Takeout", "Timeline", "TCX", "FIT"].forEach(k => assert.ok(h.includes(k), `${l} help mentions ${k}`));
  });
});
