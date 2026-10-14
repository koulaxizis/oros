// Pure logic of the Maps navigation extras and sharing
// (maps/route-core.js, OSM upgrade wave 6): the OSRM request
// (alternatives, avoid), alternatives summary, arrival clock, turn
// lanes, share links out and strict parsing of links coming in, and
// a route turned into a track.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../maps/route-core.js");
const T = require("../maps/tracks-core.js");

const A = { lat: 37.97, lon: 23.72 }, B = { lat: 38.05, lon: 23.8 }, C = { lat: 38, lon: 23.75 };
const BASE = "https://router.project-osrm.org/route/v1/driving/";

test("routeUrl: alternatives only with two points, avoid only for the car", () => {
  assert.equal(R.routeUrl(BASE, [A, B], {}),
    BASE + "23.72,37.97;23.8,38.05?overview=full&geometries=geojson&steps=true");
  assert.match(R.routeUrl(BASE, [A, B], { alternatives: true }), /&alternatives=true$/);
  assert.doesNotMatch(R.routeUrl(BASE, [A, C, B], { alternatives: true }), /alternatives/);
  assert.match(R.routeUrl(BASE, [A, B], { profile: "car", avoid: "toll" }), /&exclude=toll$/);
  assert.doesNotMatch(R.routeUrl(BASE, [A, B], { profile: "bike", avoid: "toll" }), /exclude/);
  assert.doesNotMatch(R.routeUrl(BASE, [A, B], { profile: "car", avoid: "toll,motorway" }), /exclude/);
  assert.doesNotMatch(R.routeUrl(BASE, [A, B], { profile: "car", avoid: "x&y=1" }), /exclude|y=1/);
});

test("alternatives: differences to the first route, bad entries dropped, at most 3", () => {
  const g = { coordinates: [[0, 0], [1, 1]] };
  const alts = R.alternatives([
    { distance: 1000, duration: 600, geometry: g },
    { distance: 900, duration: 720, geometry: g },
    { distance: 5, duration: 5, geometry: { coordinates: [[0, 0]] } },
    { distance: 1200, duration: 660, geometry: g },
    { distance: 1300, duration: 700, geometry: g }
  ]);
  assert.equal(alts.length, 3);
  assert.deepEqual(alts[1], { i: 1, dur: 720, dist: 900, dDur: 120, dDist: -100 });
  assert.equal(alts[2].dDur, 60);
  assert.deepEqual(R.alternatives(null), []);
  assert.deepEqual(R.alternatives([{ distance: "1" }]), []);
});

test("clock: HH:MM, +1 past midnight", () => {
  const now = new Date(2026, 9, 13, 14, 5, 0).getTime();
  assert.equal(R.clock(now, 0), "14:05");
  assert.equal(R.clock(now, 27 * 60), "14:32");
  assert.equal(R.clock(now, 10 * 3600), "00:05 +1");
  assert.equal(R.clock(now, -50), "14:05");
});

test("lanes: OSRM intersection lanes and the slim copy, unknown indications dropped", () => {
  const step = { intersections: [{ lanes: [
    { indications: ["left"], valid: false },
    { indications: ["straight", "right"], valid: true },
    { indications: ["<img>", "right"], valid: true }
  ] }] };
  const l = R.lanesOf(step);
  assert.deepEqual(l, [{ i: ["left"], v: 0 }, { i: ["straight", "right"], v: 1 }, { i: ["right"], v: 1 }]);
  assert.deepEqual(R.lanesOf({ lanes: l }), l);
  assert.equal(R.laneShape(l[1], "right"), "right");
  assert.equal(R.laneShape(l[1], "left"), "straight");
  assert.equal(R.laneShape(l[0], "left"), "left");
  assert.equal(R.laneShape({ i: ["none"], v: 1 }, "left"), "straight");
  assert.equal(R.lanesOf({ intersections: [{ lanes: [{ indications: ["none"], valid: true }] }] }), null);
  assert.equal(R.lanesOf({ intersections: [{}] }), null);
  assert.equal(R.lanesOf({ lanes: new Array(17).fill({ i: ["left"], v: 1 }) }), null);
  assert.equal(R.lanesOf(null), null);
});

test("share links out: geo:, openstreetmap.org, orOS", () => {
  assert.equal(R.geoUri(37.971234567, 23.72, "Καφέ (Πλάκα)"),
    "geo:37.97123,23.72?q=37.97123,23.72(" + encodeURIComponent("Καφέ Πλάκα") + ")");
  assert.equal(R.geoUri(37.97, 23.72, ""), "geo:37.97,23.72?q=37.97,23.72");
  assert.equal(R.geoUri(91, 0, "x"), "");
  assert.equal(R.osmPointUrl(37.97, 23.72, 16), "https://www.openstreetmap.org/?mlat=37.97&mlon=23.72#map=16/37.97/23.72");
  assert.equal(R.osmDirUrl(A, B, "bike"),
    "https://www.openstreetmap.org/directions?engine=fossgis_osrm_bike&route=37.97%2C23.72%3B38.05%2C23.8");
  assert.equal(R.osmDirUrl(A, null, "car"), "");
  const base = "https://useoros.online/maps/";
  assert.equal(R.orosPointLink(base, 37.97, 23.72, "A&B"), base + "?lat=37.97&lon=23.72&label=A%26B");
  assert.equal(R.orosRouteLink(base, [A, C, B], "foot", "Home"),
    base + "?route=37.97%2C23.72%3B38%2C23.75%3B38.05%2C23.8&mode=foot&to=Home");
  assert.equal(R.orosRouteLink(base, [A], "car"), "");
  assert.equal(R.orosRouteLink(base, [A, B, A, B, A, B], "car"), "");
  assert.match(R.orosRouteLink(base, [A, B], "plane"), /mode=car$/);
});

test("links coming in: round trip, strict parsing", () => {
  const base = "https://x/maps/";
  const link = R.orosRouteLink(base, [A, C, B], "bike", "Σπίτι");
  const got = R.parseLink(link.slice(base.length));
  assert.deepEqual(got, { route: [A, C, B], mode: "bike", to: "Σπίτι" });
  assert.deepEqual(R.parseLink(R.orosPointLink(base, 37.97, 23.72, "Cafe").slice(base.length)),
    { point: { lat: 37.97, lon: 23.72, label: "Cafe" } });
  assert.equal(R.parseLink("?lat=91&lon=0"), null);
  assert.equal(R.parseLink("?lat=1e3&lon=0"), null);
  assert.equal(R.parseLink("?lat=37&lon=Infinity"), null);
  assert.equal(R.parseLink("?route=37,23"), null);
  assert.equal(R.parseLink("?route=1,1;2,2;3,3;4,4;5,5;6,6"), null);
  assert.equal(R.parseLink("?route=1,1;2,2,2"), null);
  assert.equal(R.parseLink("?q=athens"), null);
  assert.equal(R.parseLink("?route=1,1;2,2&mode=<x>").mode, "car");
  assert.equal(R.parseLink("?route=1,1;2,2&mode=transit").mode, "transit");
  assert.match(R.orosRouteLink("https://x/maps/", [A, B], "transit"), /mode=transit$/);
  assert.equal(R.parseLink("?lat=1&lon=2&label=" + encodeURIComponent("a\u0000b" + "x".repeat(300))).point.label.length, 120);
});

test("routeTrack: a route as a track that tracks-core writes and reads back", () => {
  const coords = [[23.72, 37.97], [23.75, 38], ["x", 1], [23.8, 38.05]];
  const tr = R.routeTrack(coords, "Route to <Home>", [Object.assign({ name: "Start" }, A), Object.assign({ name: "Home" }, B)]);
  assert.equal(tr.segs[0].length, 3);
  assert.deepEqual(tr.segs[0][0], [37.97, 23.72, null, null]);
  assert.equal(tr.wpts.length, 2);
  const gpx = T.writeGpx(tr);
  assert.match(gpx, /Route to &lt;Home&gt;/);
  const back = T.parseGpx(gpx);
  assert.equal(back.segs[0].length, 3);
  assert.equal(back.wpts.length, 2);
  assert.equal(R.routeTrack([[1, 1]], "x", []), null);
  assert.equal(R.routeTrack(null), null);
});

// Voices: only installed ones (localService === true), never a network
// voice that sends the text to its server (removed Google 2026-10-14).
const LV = R.localVoice;
const VOICES = [
  { name: "Google ελληνικά", lang: "el-GR", localService: false, default: false },
  { name: "Google US English", lang: "en-US", localService: false, default: true },
  { name: "Daniel", lang: "en-GB", localService: true, default: false },
  { name: "Samantha", lang: "en_US", localService: true, default: false },
  { name: "Karen", lang: "en-AU", localService: true, default: true },
  { name: "Odd", lang: "de-DE" }
];
test("localVoice: local voices only, same language, exact tag, then default", () => {
  assert.equal(LV(VOICES, "en-US").name, "Samantha");
  assert.equal(LV(VOICES, "en-GB").name, "Daniel");
  assert.equal(LV(VOICES, "en").name, "Karen");
  assert.equal(LV(VOICES, "EN_au").name, "Karen");
  // only a network voice for Greek → none
  assert.equal(LV(VOICES, "el-GR"), null);
  assert.equal(LV(VOICES, "el"), null);
  // localService missing or truthy-but-not-true is not trusted
  assert.equal(LV(VOICES, "de"), null);
  assert.equal(LV([{ lang: "fr-FR", localService: 1 }], "fr"), null);
  assert.equal(LV([{ lang: "fr-FR", localService: true }], "fr").lang, "fr-FR");
  for (const v of VOICES) if (LV(VOICES, v.lang)) assert.equal(LV(VOICES, v.lang).localService, true);
  assert.equal(LV([], "en"), null);
  assert.equal(LV(null, "en"), null);
  assert.equal(LV(VOICES, ""), null);
  assert.equal(LV([null, undefined], "en"), null);
});

test("maps.js: guidance speaks only with an explicit local voice", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "../maps/maps.js"), "utf8");
  const fn = src.slice(src.indexOf("function speak(text, urgent)"), src.indexOf("// ---------- HUD painting"));
  assert.match(fn, /var v = navVoice\(\);\s*if \(!v\) return false;/);
  assert.match(fn, /u\.voice = v;/);
  assert.match(src, /RC\.localVoice\(/);
  assert.doesNotMatch(src, /SpeechRecognition/);
});
