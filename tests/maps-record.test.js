// Maps wave H5 (hiking and cycling): recording upgrades in
// maps/tracks-core.js v1.2.0: the activity kind (GPX <type>, Strava
// names, index entry), waypoint photos (strict link form), the speed
// limit per kind, splits per kilometre and the height filter of
// recorded tracks.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const T = require(path.join(__dirname, "..", "maps/tracks-core.js"));
const t0 = Date.UTC(2026, 9, 13, 8, 0, 0);
// a straight line north, `n` points `step` metres apart, `dt` s apart
function north(n, step, dt, ele) {
  const seg = [];
  for (let i = 0; i < n; i++) seg.push([37.9 + i * step / 111195, 23.7, ele ? ele(i) : null, t0 + i * dt * 1000]);
  return seg;
}

test("the activity kind goes into GPX <type> and comes back", () => {
  assert.equal(T.VER, "1.2.0");
  const tr = { name: "Ymittos", act: "hike", segs: [north(5, 50, 30)], wpts: [] };
  const gpx = T.writeGpx(tr);
  assert.match(gpx, /<trk><name>Ymittos<\/name><type>hike<\/type>/);
  assert.equal(T.parseGpx(gpx).act, "hike");
  // other apps' names
  for (const [w, k] of [["Hiking", "hike"], ["cycling", "bike"], ["MountainBikeRide", "mtb"], ["running", "run"], ["Walk", "walk"]]) {
    assert.equal(T.parseGpx(gpx.replace("<type>hike</type>", "<type>" + w + "</type>")).act, k, w);
  }
  // unknown or absent → no act; a bad kind is never written
  assert.equal(T.parseGpx(gpx.replace("<type>hike</type>", "<type>sailing</type>")).act, undefined);
  assert.doesNotMatch(T.writeGpx({ name: "", act: "<x>", segs: [north(3, 50, 30)] }), /<type>/);
  // a <type> inside a trkseg is not the track's
  const inner = T.writeGpx({ name: "", segs: [north(3, 50, 30)] }).replace("<trkseg>", "<trkseg><type>run</type>");
  assert.equal(T.parseGpx(inner).act, undefined);
  // clone / simplify keep it
  assert.equal(T.clone(tr).act, "hike");
  assert.equal(T.simplify(tr, 5).act, "hike");
});

test("the index entry keeps a valid act only", () => {
  const e = T.entryFor("abcdef123", { name: "x", act: "bike", segs: [north(5, 50, 10)], wpts: [] }, null, Date.now());
  assert.equal(e.act, "bike");
  const e2 = T.entryFor("abcdef123", { name: "x", act: "bike", segs: [north(5, 50, 10)] }, { act: "mtb" }, Date.now());
  assert.equal(e2.act, "mtb", "the user's choice wins over the file");
  assert.equal(T.normEntry(Object.assign({}, e, { act: "boat" })).act, undefined);
  const none = T.entryFor("abcdef123", { name: "x", segs: [north(5, 50, 10)] }, null, Date.now());
  assert.equal("act" in none, false, "absent stays absent (the slice shape of older entries)");
  const merged = T.mergeTracks({ tracks: { abcdef123: e } }, { tracks: {} });
  assert.equal(merged.tracks.abcdef123.act, "bike");
});

test("waypoint photos: only Photos/<id>-<n>.jpg is read back", () => {
  const tr = { name: "", segs: [north(3, 50, 30)], wpts: [{ lat: 37.9, lon: 23.7, ele: 400, t: t0, name: "Spring", photo: "Photos/abc123def-1.jpg" }] };
  const gpx = T.writeGpx(tr);
  assert.match(gpx, /<wpt [^>]*>.*<link href="Photos\/abc123def-1\.jpg"><type>image\/jpeg<\/type><\/link><\/wpt>/);
  const back = T.parseGpx(gpx);
  assert.equal(back.wpts[0].photo, "Photos/abc123def-1.jpg");
  assert.equal(back.wpts[0].name, "Spring");
  for (const bad of ["../x.jpg", "Photos/../../x-1.jpg", "https://evil.test/a-1.jpg", "Photos/ABC123def-1.jpg", "Photos/abc123def-1.png", "javascript:alert(1)"]) {
    const g = gpx.replace("Photos/abc123def-1.jpg", bad.replace(/&/g, "&amp;"));
    assert.equal(T.parseGpx(g).wpts[0].photo, undefined, bad);
  }
  // a bad photo is never written
  assert.doesNotMatch(T.writeGpx({ segs: [], wpts: [{ lat: 1, lon: 1, ele: null, t: null, name: "a", photo: "../a.jpg" }] }), /<link/);
});

test("the recording filter drops jumps faster than the kind can go", () => {
  const last = [37.9, 23.7, null, t0];
  // 60 m in 5 s = 12 m/s: fine on a bike, a jump on foot
  const fix = { lat: 37.9 + 60 / 111195, lon: 23.7, acc: 5, t: t0 + 5000 };
  assert.ok(T.accept(last, fix, "bike"));
  assert.equal(T.accept(last, fix, "hike"), null);
  assert.equal(T.accept(last, fix, "run"), null);
  assert.ok(T.accept(last, fix), "no kind: the old 70 m/s limit");
  assert.ok(T.accept(last, fix, "other"));
  // a walker's pace passes everywhere
  const walk = { lat: 37.9 + 7 / 111195, lon: 23.7, acc: 5, t: t0 + 5000 };
  T.ACTS.forEach(function (a) { assert.ok(T.accept(last, walk, a), a); });
});

test("splits per kilometre share a step across the mark", () => {
  // 2.5 km, 100 m every 60 s (6 km/h), climbing 1 m per point
  const tr = { segs: [north(26, 100, 60, (i) => 100 + i * 10)] };
  const sp = T.splits(tr, 1000);
  assert.equal(sp.length, 3);
  assert.deepEqual(sp.map((s) => s.len), [1000, 1000, 500]);
  sp.slice(0, 2).forEach((s) => assert.ok(Math.abs(s.ms - 600000) < 2000, "10 min per km: " + s.ms));
  assert.ok(Math.abs(sp[2].ms - 300000) < 2000);
  assert.deepEqual(sp.map((s) => s.up), [100, 100, 50]);
  assert.ok(Math.abs(sp[2].d - 2500) <= 1);
  // a point step longer than a split crosses two marks
  const big = T.splits({ segs: [[[37.9, 23.7, null, t0], [37.9 + 2500 / 111195, 23.7, null, t0 + 1000000]]] }, 1000);
  assert.deepEqual(big.map((s) => s.len), [1000, 1000, 500]);
  assert.ok(Math.abs(big[0].ms - 400000) < 2000);
  // no times: ms 0; gaps between segments add nothing
  const two = T.splits({ segs: [north(6, 100, 0), north(6, 100, 0).map((p) => [p[0] + 0.1, p[1], null, null])] });
  assert.equal(two.length, 1);
  assert.ok(Math.abs(two[0].len - 1000) <= 1);
  assert.equal(two[0].ms, 0);
  assert.deepEqual(T.splits({ segs: [] }), []);
});

test("the height filter tames GPS jitter on recorded tracks", () => {
  // flat at 300 m with ±4 m spikes every other point
  const jitter = north(60, 20, 10, (i) => 300 + (i % 2 ? 4 : -4) * (i % 3 === 0 ? 1 : 0));
  const tr = { segs: [jitter] };
  const raw = T.stats(tr), sm = T.stats(tr, { smooth: true });
  assert.ok(raw.up > 20, "the raw heights add up false climb: " + raw.up);
  assert.ok(sm.up <= 4, "smoothed: " + sm.up);
  // a real climb survives
  const hill = { segs: [north(50, 20, 10, (i) => 300 + i * 2)] };
  assert.ok(Math.abs(T.stats(hill, { smooth: true }).up - 98) <= 4);
  assert.deepEqual(T.smoothEle([[0, 0, null, 0], [0, 0, 5, 0]]), [null, 5]);
  // the index entry of a recorded track uses it, an import does not
  const rec = T.entryFor("abcdef123", tr, { src: "rec" }, Date.now());
  const imp = T.entryFor("abcdef123", tr, { src: "import" }, Date.now());
  assert.equal(rec.up, sm.up);
  assert.equal(imp.up, raw.up);
});

test("the UI wires the H5 pieces and has the strings in EN, EL and DE", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "maps/tracks.js"), "utf8");
  assert.match(src, /T\.accept\(prev, fix, rec\.act\)/);
  assert.match(src, /rec\.fast >= 3/);
  assert.match(src, /T\.splits\(tr, 1000/);
  assert.match(src, /T\.PHOTO_RE\.test\(rel\)/);
  assert.match(src, /photosInUse\(id\)/);
  const keys = ["trk.act", "trk.act.hike", "trk.rec.auto", "trk.rec.pt", "trk.pt.photo", "trk.sp", "trk.pts", "trk.pace"];
  const de = fs.readFileSync(path.join(__dirname, "..", "i18n/de/maps.js"), "utf8");
  keys.forEach(function (k) {
    assert.equal(src.split('"' + k + '":').length - 1, 2, k + " in EN and EL");
    assert.ok(de.indexOf('"' + k + '":') >= 0, k + " in DE");
  });
});
