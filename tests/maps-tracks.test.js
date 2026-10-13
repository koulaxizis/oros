// Pure logic of the Maps GPX tracks (maps/tracks-core.js, OSM upgrade
// wave 3): GPX / KML / GeoJSON reading (strict, no DOM), GPX writing
// (round trip, escaping), statistics, the recording filter,
// simplification, the preview polyline, editing, and the sync merge of
// the "mapstracks" slice.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const T = require(path.join(__dirname, "..", "maps/tracks-core.js"));
const t0 = Date.UTC(2026, 9, 13, 8, 0, 0);

function line(n, opts) {
  opts = opts || {};
  const seg = [];
  for (let i = 0; i < n; i++) {
    const r7 = (v) => Math.round(v * 1e7) / 1e7;
    seg.push([r7(37.98 + i * 0.0001 * (opts.dLat ?? 1)), r7(23.72 + i * 0.0001 * (opts.dLon ?? 0)),
      opts.ele ? opts.ele(i) : null, opts.dt ? t0 + i * opts.dt : null]);
  }
  return seg;
}

test("GPX: tracks, segments, routes, waypoints, entities, CDATA, namespaces", () => {
  const g = `<?xml version="1.0"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="x">
 <metadata><name><![CDATA[Walk <b>&</b> talk]]></name></metadata>
 <wpt lat='38.1' lon='23.5'><ele>12.3</ele><name>Πηγή &amp; &#x3c;script&#62;</name></wpt>
 <trk><name>ignored</name>
  <trkseg>
   <trkpt lat="37.98" lon="23.72"><ele>100</ele><time>2026-10-13T08:00:00Z</time></trkpt>
   <trkpt lat="37.9801" lon="23.72"><ele>101.26</ele><time>2026-10-13T08:00:10.5+03:00</time></trkpt>
   <trkpt lat="91" lon="23.72"/><trkpt lat="1e1" lon="abc"/><trkpt lat="37.9802" lon="23.72"/>
  </trkseg>
  <trkseg><trkpt lat="37.99" lon="23.73"/></trkseg>
 </trk>
 <rte><name>r</name><rtept lat="37" lon="23"/><rtept lat="37.1" lon="23"/></rte>
 <gpx:trk xmlns:gpx="x"><gpx:trkseg><gpx:trkpt lat="1" lon="2"/></gpx:trkseg></gpx:trk>
</gpx>`;
  const tr = T.parseAny(g, "a.gpx");
  assert.equal(tr.name, "Walk <b>&</b> talk");
  assert.equal(tr.segs.length, 4);
  assert.deepEqual(tr.segs[0][0], [37.98, 23.72, 100, t0]);
  assert.equal(tr.segs[0][1][2], 101.3);
  assert.equal(tr.segs[0][1][3], Date.UTC(2026, 9, 13, 5, 0, 10, 500));
  assert.equal(tr.segs[0].length, 3, "bad points dropped");
  assert.deepEqual(tr.segs[2], [[1, 2, null, null]], "prefixed elements");
  assert.deepEqual(tr.segs[3], [[37, 23, null, null], [37.1, 23, null, null]], "route kept (after the tracks)");
  assert.deepEqual(tr.wpts, [{ lat: 38.1, lon: 23.5, ele: 12.3, t: null, name: "Πηγή & <script>" }]);
});

test("GPX: limits and junk", () => {
  assert.equal(T.parseAny("", "a.gpx"), null);
  assert.equal(T.parseAny("<gpx></gpx>", "a.gpx"), null);
  assert.equal(T.parseAny("hello", "a.txt"), null);
  assert.equal(T.parseAny(null), null);
  assert.equal(T.parseAny("x".repeat(T.LIM.chars + 1), "a.gpx"), null);
  assert.equal(T.parseTime("2026-10-13"), null);
  assert.equal(T.parseTime("1900-01-01T00:00:00Z"), null);
  assert.equal(T.decodeXml("&#0;&#xD800;a"), "  a");
  // Point budget: stops at LIM.points.
  const saved = T.LIM.points;
  T.LIM.points = 5;
  try {
    const pts = Array.from({ length: 9 }, (_, i) => `<trkpt lat="1.${i}" lon="2"/>`).join("");
    const tr = T.parseAny(`<gpx><trk><trkseg>${pts}</trkseg></trk></gpx>`);
    assert.equal(T.flatLen(tr), 5);
  } finally { T.LIM.points = saved; }
});

test("KML: LineString, gx:Track with times, Point", () => {
  const k = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><name>Trip</name>
  <Placemark><name>Line</name><LineString><coordinates>23.72,37.98,10 23.73,37.99,20
   23.74,38.0</coordinates></LineString></Placemark>
  <Placemark><gx:Track><when>2026-10-13T08:00:00Z</when><when>2026-10-13T08:01:00Z</when>
   <gx:coord>23.7 37.9 5</gx:coord><gx:coord>23.71 37.91 6</gx:coord></gx:Track></Placemark>
  <Placemark><name>Café</name><Point><coordinates>23.5,38.1,0</coordinates></Point></Placemark>
  </Document></kml>`;
  const tr = T.parseAny(k, "x.kml");
  assert.equal(tr.name, "Trip");
  assert.deepEqual(tr.segs[0], [[37.98, 23.72, 10, null], [37.99, 23.73, 20, null], [38, 23.74, null, null]]);
  assert.deepEqual(tr.segs[1], [[37.9, 23.7, 5, t0], [37.91, 23.71, 6, t0 + 60000]]);
  assert.deepEqual(tr.wpts, [{ lat: 38.1, lon: 23.5, ele: 0, t: null, name: "Café" }]);
});

test("GeoJSON: Feature / FeatureCollection / MultiLineString / coordTimes", () => {
  const j = JSON.stringify({ type: "FeatureCollection", features: [
    { type: "Feature", properties: { name: "Ride", coordTimes: ["2026-10-13T08:00:00Z", "2026-10-13T08:00:30Z"] },
      geometry: { type: "LineString", coordinates: [[23.72, 37.98, 50], [23.721, 37.981]] } },
    { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: [[[1, 2], [1.1, 2.1]], [[3, 4], [999, 4]]] } },
    { type: "Feature", properties: { name: "P" }, geometry: { type: "Point", coordinates: [5, 6] } },
    { type: "Feature", geometry: null }, null, 7
  ] });
  const tr = T.parseAny(j, "a.geojson");
  assert.equal(tr.name, "Ride");
  assert.deepEqual(tr.segs, [
    [[37.98, 23.72, 50, t0], [37.981, 23.721, null, t0 + 30000]],
    [[2, 1, null, null], [2.1, 1.1, null, null]],
    [[4, 3, null, null]]
  ]);
  assert.deepEqual(tr.wpts, [{ lat: 6, lon: 5, ele: null, t: null, name: "P" }]);
  assert.equal(T.parseAny("{bad json", "a.json"), null);
});

test("writeGpx: escaped and round-trips losslessly", () => {
  const tr = { name: 'A & "B" <c>', segs: [line(5, { ele: (i) => 100 + i, dt: 5000 }), line(2)],
    wpts: [{ lat: 1, lon: 2, ele: null, t: null, name: "<x>&" }] };
  const xml = T.writeGpx(tr);
  assert.match(xml, /<name>A &amp; &quot;B&quot; &lt;c&gt;<\/name>/);
  assert.ok(!/<x>/.test(xml));
  assert.match(xml, /creator="orOS Maps"/);
  assert.deepEqual(T.parseAny(xml, "a.gpx"), tr);
});

test("stats: distance, time, moving time, climb with hysteresis, top speed, bbox", () => {
  // 61 points 11.1 m apart every 5 s (~2.2 m/s), elevation noise ±1 m on a 30 m climb.
  const seg = line(61, { dt: 5000, ele: (i) => 100 + i * 0.5 + (i % 2 ? 1 : -1) });
  const st = T.stats({ segs: [seg] });
  assert.ok(Math.abs(st.dist - 667) <= 2, st.dist);
  assert.equal(st.dur, 300000);
  assert.equal(st.moving, 300000);
  assert.ok(st.up >= 27 && st.up <= 32, "climb " + st.up);
  assert.ok(st.down <= 3, "noise is not descent " + st.down);
  assert.ok(Math.abs(st.top - 2.2) < 0.1, st.top);
  assert.equal(st.n, 61);
  assert.equal(st.start, t0);
  assert.deepEqual(st.bbox.map((v) => +v.toFixed(4)), [37.98, 23.72, 37.986, 23.72]);
  // A long stop is not moving time; a gap between segments adds no distance.
  const stop = [[37.98, 23.72, null, t0], [37.98001, 23.72, null, t0 + 600000], [37.981, 23.72, null, t0 + 610000]];
  const s2 = T.stats({ segs: [stop, [[38.5, 23.72, null, t0 + 700000]]] });
  assert.equal(s2.moving, 10000);
  assert.ok(s2.dist < 120);
  assert.deepEqual(T.stats({ segs: [] }).bbox, null);
});

test("recording filter: accuracy, tiny moves, jumps, time order", () => {
  const f = (lat, lon, acc, dt) => ({ lat, lon, acc, t: t0 + dt, ele: 10 });
  const a = T.accept(null, f(37.98, 23.72, 8, 0));
  assert.deepEqual(a, [37.98, 23.72, 10, t0]);
  assert.equal(T.accept(null, f(37.98, 23.72, 60, 0)), null, "worse than 50 m");
  assert.equal(T.accept(a, f(37.98002, 23.72, 8, 5000)), null, "2 m move");
  assert.ok(T.accept(a, f(37.9801, 23.72, 8, 5000)), "11 m move");
  assert.equal(T.accept(a, f(37.9801, 23.72, 30, 5000)), null, "11 m < half of 30 m accuracy");
  assert.equal(T.accept(a, f(37.99, 23.72, 8, 5000)), null, "1.1 km in 5 s");
  assert.equal(T.accept(a, f(37.9801, 23.72, 8, -1000)), null, "older fix");
  assert.equal(T.accept(a, { lat: NaN, lon: 1, t: t0 }), null);
});

test("simplify keeps ends and shape, drops collinear points", () => {
  const straight = line(100);
  assert.equal(T.simplifySeg(straight, 1).length, 2);
  const zig = line(50).concat(line(50, { dLat: 0, dLon: 1 }).map((p) => [p[0] + 0.0049, p[1], null, null]));
  const s = T.simplifySeg(zig, 2);
  assert.ok(s.length >= 3 && s.length <= 5, s.length);
  assert.deepEqual(s[0], zig[0]);
  assert.deepEqual(s[s.length - 1], zig[zig.length - 1]);
  assert.equal(T.simplifySeg([[1, 2, null, null]], 5).length, 1);
});

test("polyline encode/decode and preview size", () => {
  const pts = [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]];
  assert.equal(T.encode(pts), "_p~iF~ps|U_ulLnnqC_mqNvxq`@");   // Google's reference example
  assert.deepEqual(T.decode("_p~iF~ps|U_ulLnnqC_mqNvxq`@"), pts);
  assert.deepEqual(T.decode("\u0000junk"), []);
  const big = { segs: [Array.from({ length: 20000 }, (_, i) => [37.9 + Math.sin(i / 50) * 0.01, 23.7 + i * 0.00002, null, null])] };
  const pv = T.preview(big);
  assert.ok(pv.length > 0 && pv.length <= T.LIM.prevChars);
  assert.ok(T.decode(pv).length <= T.LIM.prev);
});

test("profile: distance, elevation, speed, sampled", () => {
  const tr = { segs: [line(1000, { dt: 5000, ele: (i) => i })] };
  const p = T.profile(tr, 100);
  assert.ok(p.length <= 101);
  assert.equal(p[0].d, 0);
  assert.equal(p[p.length - 1].ele, 999);
  assert.ok(Math.abs(p[5].v - 2.22) < 0.05);
});

test("editing: trim, cut, split, join", () => {
  const tr = { name: "x", wpts: [], segs: [line(5), line(5).map((p) => [p[0] + 1, p[1], null, null])] };
  assert.equal(T.flatLen(tr), 10);
  assert.deepEqual(T.at(tr, 7), { s: 1, i: 2 });
  const tm = T.trim(tr, 3, 6);
  assert.equal(T.flatLen(tm), 4);
  assert.equal(tm.segs.length, 2);
  const c = T.cut(tr, 1, 2);
  assert.equal(T.flatLen(c), 8);
  assert.equal(c.segs.length, 3, "the cut makes a break");
  const sp = T.split(tr, 4);
  assert.equal(T.flatLen(sp[0]), 5);
  assert.equal(T.flatLen(sp[1]), 6);
  assert.equal(T.split(tr, 0), null);
  const j = T.join(sp[0], sp[1]);
  assert.equal(T.flatLen(j), 11);
  tm.segs[0][0][0] = 0;
  assert.notEqual(tr.segs[0][3][0], 0, "edits work on copies");
});

function entry(id, m, extra) {
  return Object.assign({ id, m, name: "T", color: "#61afef", dist: 100, start: t0, n: 2 }, extra);
}
test("normEntry cleans and rejects", () => {
  assert.equal(T.normEntry(entry("bad id", 1)), null);
  assert.equal(T.normEntry(entry("abcdef1", -1)), null);
  const e = T.normEntry(entry("abcdef1", 5, { name: "A\u0007B", color: "red", folder: "x".repeat(99), hidden: "yes",
    dist: -5, bbox: [1, 2, 0, 3], prev: "<svg>", src: "evil" }));
  assert.equal(e.name, "A B");
  assert.equal(e.color, T.COLORS[0]);
  assert.equal(e.folder.length, T.LIM.folder);
  assert.equal(e.hidden, 1);
  assert.equal(e.dist, 0);
  assert.equal(e.bbox, null);
  assert.equal(e.prev, "");
  assert.equal(e.src, "rec");
  assert.equal(T.pathOf("abcdef1"), "/internal/Maps/Tracks/abcdef1.gpx");
  assert.equal(T.pathOf("../x"), null);
});

test("entryFor keeps the user fields and computes the rest", () => {
  const tr = { name: "file name", segs: [line(30, { dt: 5000 })], wpts: [] };
  const e = T.entryFor("abcdef9", tr, { name: "Mine", color: "#98c379", folder: "Hikes", src: "import" }, 42);
  assert.equal(e.name, "Mine");
  assert.equal(e.folder, "Hikes");
  assert.equal(e.color, "#98c379");
  assert.equal(e.src, "import");
  assert.equal(e.n, 30);
  assert.equal(e.start, t0);
  assert.ok(e.prev.length > 0);
  assert.equal(T.entryFor("abcdef9", tr, null, 1).name, "file name");
});

test("mergeTracks: LWW, tombs, commutative, associative, idempotent (fuzz)", () => {
  const a = { tracks: { abcdef1: entry("abcdef1", 5, { name: "A" }) } };
  const b = { tracks: { abcdef1: entry("abcdef1", 7, { name: "B" }) } };
  assert.equal(T.mergeTracks(a, b).tracks.abcdef1.name, "B");
  assert.deepEqual(T.mergeTracks(a, { tombs: { abcdef1: 5 } }).tracks, {});
  assert.equal(T.mergeTracks(a, { tombs: { abcdef1: 4 } }).tracks.abcdef1.name, "A");
  let seed = 11;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const ids = ["abcdef1", "abcdef2", "abcdef3", "abcdef4"];
  const make = () => {
    const d = { tracks: {}, tombs: {} };
    for (const id of ids) {
      if (rnd(3)) d.tracks[id] = entry(id, rnd(6), { name: "n" + rnd(3), hidden: rnd(2), color: T.COLORS[rnd(3)] });
      if (!rnd(4)) d.tombs[id] = rnd(6);
    }
    return d;
  };
  for (let i = 0; i < 2000; i++) {
    const x = make(), y = make(), z = make();
    const xy = T.mergeTracks(x, y);
    assert.deepEqual(xy, T.mergeTracks(y, x));
    assert.deepEqual(T.mergeTracks(xy, xy), xy);
    assert.deepEqual(T.mergeTracks(T.mergeTracks(x, y), z), T.mergeTracks(x, T.mergeTracks(y, z)));
    assert.equal(JSON.stringify(T.normalizeTracks(xy)), JSON.stringify(xy));
  }
});

test("wiring: scripts in order, slice registered, recording database wiped on reset", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "maps/index.html"), "utf8");
  const order = ["notes.js", "poi.js", "tracks-core.js", "tracks.js"].map((f) => html.indexOf('src="' + f + "?v="));
  order.forEach((i) => assert.ok(i > 0));
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1]);
  const ui = fs.readFileSync(path.join(__dirname, "..", "maps/tracks.js"), "utf8");
  assert.match(ui, /registerSlice\("mapstracks", sliceGet, sliceSet, DATA_KEY, T\.mergeTracks\)/);
  assert.ok(!/\.innerHTML\s*=\s*(?!\s|ICON|'<svg)/.test(ui), "innerHTML only for static icons");
  const shell = fs.readFileSync(path.join(__dirname, "..", "shell.js"), "utf8");
  assert.match(shell, /"oros-maps-rec"/);
});

test("OSM trace link: kept in the GPX metadata, only exact openstreetmap.org trace URLs", () => {
  const url = T.traceUrl("https://www.openstreetmap.org", "Chris K", 12345);
  assert.equal(url, "https://www.openstreetmap.org/user/Chris%20K/traces/12345");
  assert.equal(T.traceUrl("https://master.apis.dev.openstreetmap.org", "Χρήστος", "7"),
    "https://master.apis.dev.openstreetmap.org/user/" + encodeURIComponent("Χρήστος") + "/traces/7");
  assert.equal(T.traceUrl("https://evil.example", "a", 1), null);
  assert.equal(T.traceUrl("https://www.openstreetmap.org", "a", "0"), null);
  assert.equal(T.traceUrl("https://www.openstreetmap.org", "", 5), null);

  const tr = { name: "Walk", segs: [line(5, { dt: 1000 })], wpts: [], trace: url };
  const gpx = T.writeGpx(tr);
  assert.match(gpx, /<metadata><name>Walk<\/name><link href="https:\/\/www\.openstreetmap\.org\/user\/Chris%20K\/traces\/12345"><text>OpenStreetMap<\/text><\/link><time>/);
  assert.equal(T.parseGpx(gpx).trace, url);
  assert.equal(T.parseAny(gpx, "x.gpx").trace, url);
  // No link → no field (old files read exactly as before)
  assert.ok(!("trace" in T.parseGpx(T.writeGpx({ name: "", segs: [line(3)], wpts: [] }))));
  // Hostile or foreign links are ignored on read and never written
  const bad = ["javascript:alert(1)", "https://www.openstreetmap.org.evil.com/user/a/traces/1",
    "https://www.openstreetmap.org/user/a/traces/1?x=\"><script>", "http://www.openstreetmap.org/user/a/traces/1",
    "https://www.openstreetmap.org/user/a/b/traces/1", "https://www.openstreetmap.org/user/a/traces/1/data"];
  bad.forEach((h) => {
    const x = '<gpx><metadata><link href="' + h.replace(/"/g, "&quot;") + '"/></metadata><trk><trkseg><trkpt lat="1" lon="2"/><trkpt lat="1.1" lon="2"/></trkseg></trk></gpx>';
    assert.ok(!("trace" in T.parseGpx(x)), h);
    assert.ok(!/<link/.test(T.writeGpx({ name: "", segs: [line(2)], wpts: [], trace: h })), h);
  });
  // Edits keep the link; the second half of a split is a new track without it
  assert.equal(T.clone(tr).trace, url);
  assert.equal(T.simplify(tr, 5).trace, url);
  assert.equal(T.trim(tr, 1, 3).trace, url);
  assert.equal(T.cut(tr, 1, 2).trace, url);
  const parts = T.split(tr, 2);
  assert.equal(parts[0].trace, url);
  assert.ok(!("trace" in parts[1]));
  assert.equal(tr.trace, url, "split leaves the source alone");
});

test("timedPoints counts points with a time (OSM traces need them)", () => {
  assert.equal(T.timedPoints({ segs: [line(4, { dt: 1000 }), line(3)] }), 4);
  assert.equal(T.timedPoints({ segs: [line(4)] }), 0);
  assert.equal(T.timedPoints({ segs: [] }), 0);
});

test("editing chain: trim, cut, split, join, simplify keep point order and counts", () => {
  const tr = { name: "A", segs: [line(10, { dt: 1000 }), line(6, { dt: 1000, dLon: 1 })], wpts: [{ lat: 1, lon: 2, ele: null, t: null, name: "w" }] };
  assert.equal(T.flatLen(tr), 16);
  const k = T.trim(tr, 3, 12);
  assert.equal(T.flatLen(k), 10);
  assert.deepEqual(k.segs.map((s) => s.length), [7, 3]);
  const c = T.cut(tr, 2, 4);
  assert.equal(T.flatLen(c), 13);
  assert.deepEqual(c.segs.map((s) => s.length), [2, 5, 6]);
  const j = T.join(k, c);
  assert.equal(T.flatLen(j), 23);
  assert.equal(j.wpts.length, 2);
  assert.equal(T.split(tr, 0), null);
  assert.equal(T.split(tr, 15), null);
  const sp = T.split(tr, 10);
  assert.equal(T.flatLen(sp[0]) + T.flatLen(sp[1]), 17, "split point in both halves");
  // the inputs are never changed
  assert.equal(T.flatLen(tr), 16);
  // straight line: simplify keeps the two ends of each segment
  assert.deepEqual(T.simplify(tr, 5).segs.map((s) => s.length), [2, 2]);
});

test("wiring 3B: GPX upload uses FormData without a forced Content-Type, link opened safely", () => {
  const api = fs.readFileSync(path.join(__dirname, "..", "maps/osm-api.js"), "utf8");
  assert.match(api, /opts\.body instanceof FormData/);
  const ui = fs.readFileSync(path.join(__dirname, "..", "maps/tracks.js"), "utf8");
  assert.match(ui, /"\/api\/0\.6\/gpx\/create"/);
  assert.match(ui, /vis\.value = "private"/);
  assert.match(ui, /T\.TRACE_RE\.test\(tr\.trace\)/);
  assert.match(ui, /rel = "noopener noreferrer"/);
});
