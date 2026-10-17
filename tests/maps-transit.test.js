// Pure logic of Maps public transport (maps/transit-core.js, maps
// wave 7, Transitous / MOTIS): requests, polyline decoding, strict
// copies of plan / departures / stops / live trips, vehicle position,
// sharing text and "Save as track".
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const X = require("../maps/transit-core.js");
const T = require("../maps/tracks-core.js");

const B = X.BASE;
const A = { lat: 37.97, lon: 23.72 }, Z = { lat: 38.05, lon: 23.8 };
const iso = (s) => new Date(s).toISOString();

function leg(o) {
  return Object.assign({
    mode: "WALK", startTime: "2026-10-13T10:00:00Z", endTime: "2026-10-13T10:05:00Z",
    from: { name: "Start", lat: 37.97, lon: 23.72 }, to: { name: "Syntagma", lat: 37.975, lon: 23.735, stopId: "athens_1" },
    distance: 400, duration: 300,
    legGeometry: { points: X.encodePolyline([[37.97, 23.72], [37.975, 23.735]], 6), precision: 6, length: 2 }
  }, o);
}

test("planUrl: places, time, arriveBy, cursor, language; bad input → ''", () => {
  const u = X.planUrl(B, "v6", { from: A, to: Z, time: Date.UTC(2026, 9, 13, 10, 0), arriveBy: true, cursor: "abc=", lang: "el" });
  assert.equal(u, B + "v6/plan?fromPlace=37.97%2C23.72&toPlace=38.05%2C23.8&time=2026-10-13T10%3A00%3A00.000Z" +
    "&arriveBy=true&numItineraries=5&detailedTransfers=false&pageCursor=abc%3D&language=el");
  assert.match(X.planUrl(B, "v5", { from: { stopId: "x_1" }, to: Z }), /v5\/plan\?fromPlace=x_1&toPlace=/);
  assert.equal(X.planUrl(B, "v6", { from: A, to: { lat: 99, lon: 0 } }), "");
  assert.doesNotMatch(X.planUrl(B, "v6", { from: A, to: Z, cursor: "a b<" }), /pageCursor/);
  assert.doesNotMatch(X.planUrl(B, "v6", { from: A, to: Z }), /time=|arriveBy/);
});

test("stoptimes, stops and trips URLs", () => {
  assert.equal(X.stoptimesUrl(B, "v6", { stopId: "athens_1", n: 500 }), B + "v6/stoptimes?stopId=athens_1&n=60");
  assert.equal(X.stoptimesUrl(B, "v6", { stopId: "" }), "");
  assert.equal(X.stopsUrl(B, "v6", { s: 37.9, w: 23.7, n: 38, e: 23.8 }, "el"),
    B + "v6/map/stops?min=37.9%2C23.7&max=38%2C23.8&language=el");
  assert.equal(X.stopsUrl(B, "v6", { s: 38, w: 23.7, n: 37, e: 23.8 }), "");
  const t0 = Date.UTC(2026, 9, 13, 10), u = X.tripsUrl(B, "v6", { s: 37, w: 22, n: 39, e: 24 }, 9.4, t0, t0 + 60000);
  assert.match(u, /map\/trips\?zoom=9&min=37%2C22&max=39%2C24&startTime=2026-10-13T10%3A00%3A00\.000Z&endTime=2026-10-13T10%3A01%3A00\.000Z&precision=4$/);
  assert.equal(X.tripsUrl(B, "v6", { s: 37, w: 22, n: 39, e: 24 }, 9, t0, t0), "");
  assert.equal(X.tripsPrecision(15), 5);
  assert.equal(X.tripsPrecision(3), 2);
});

test("decodePolyline: Google sample, precision 6 round trip, garbage stops cleanly", () => {
  assert.deepEqual(X.decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5),
    [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  const pts = [[37.971234, 23.726543], [37.98, 23.7301], [38.0012, 23.69]];
  const back = X.decodePolyline(X.encodePolyline(pts, 6), 6);
  back.forEach((p, i) => { assert.ok(Math.abs(p[0] - pts[i][0]) < 1e-6 && Math.abs(p[1] - pts[i][1]) < 1e-6); });
  assert.deepEqual(X.decodePolyline(null), []);
  assert.deepEqual(X.decodePolyline("_p~iF~ps|U\u0001\u0002", 5), [[38.5, -120.2]]);
  assert.deepEqual(X.decodePolyline("_p~iF", 5), []);
});

test("normPlan: legs, colours, modes, transit first, duplicates dropped", () => {
  const bus = leg({
    mode: "BUS", startTime: "2026-10-13T10:06:00Z", endTime: "2026-10-13T10:30:00Z",
    scheduledStartTime: "2026-10-13T10:04:00Z", realTime: true,
    from: { name: "Syntagma", lat: 37.975, lon: 23.735, stopId: "athens_1", track: "A" },
    to: { name: "Kifisia", lat: 38.05, lon: 23.8, stopId: "athens_2" },
    routeShortName: "550", headsign: "Kifisia", routeColor: "FFD700", routeTextColor: "",
    intermediateStops: [{ name: "Mid", lat: 38, lon: 23.76 }, { name: "bad", lat: 500, lon: 0 }],
    legGeometry: { points: X.encodePolyline([[37.975, 23.735], [38, 23.76], [38.05, 23.8]], 6), precision: 6, length: 3 }
  });
  const it = { startTime: "2026-10-13T10:00:00Z", endTime: "2026-10-13T10:30:00Z", duration: 1800, transfers: 0, legs: [leg(), bus] };
  const direct = { startTime: "2026-10-13T10:00:00Z", endTime: "2026-10-13T11:40:00Z", duration: 6000, transfers: 0,
    legs: [leg({ endTime: "2026-10-13T11:40:00Z", to: { name: "Kifisia", lat: 38.05, lon: 23.8 }, distance: 9000 })] };
  const p = X.normPlan({ direct: [direct], itineraries: [it, it, { legs: [{ mode: "BUS" }] }],
    nextPageCursor: "NEXT", previousPageCursor: "<bad>" });
  assert.equal(p.its.length, 2);
  assert.equal(p.next, "NEXT");
  assert.equal(p.prev, "");
  const a = p.its[0];
  assert.equal(a.direct, false);
  assert.equal(a.transfers, 0);
  assert.equal(a.walk, 400);
  assert.equal(a.rt, true);
  const b = a.legs[1];
  assert.equal(b.g, "bus");
  assert.equal(b.transit, true);
  assert.equal(b.line, "550");
  assert.equal(b.color, "ffd700");
  assert.equal(b.textColor, "000000");          // dark text on yellow
  assert.equal(b.from.track, "A");
  assert.equal(b.stops.length, 1);
  assert.equal(b.pts.length, 3);
  assert.equal(X.delayMin(b.t0, b.s0), 2);
  assert.equal(p.its[1].direct, true);          // walk-only answer last
  assert.equal(X.normLeg(leg({ mode: "SPACESHIP" })).mode, "OTHER");
  assert.equal(X.normLeg(leg({ routeColor: "red;}" })).color, "");
  assert.equal(X.normLeg(leg({ endTime: "2026-10-13T09:00:00Z" })), null);
  assert.equal(X.normLeg(leg({ legGeometry: null })).pts.length, 2);   // straight line fallback
  assert.equal(X.normLeg(leg({ headsign: "x".repeat(500) + "\u0000" })).headsign.length, 120);
  assert.deepEqual(X.normPlan(null), { its: [], prev: "", next: "" });
});

test("textOn: given colour kept, else black or white by luminance", () => {
  assert.equal(X.textOn("003399", "FFFFFF"), "ffffff");
  assert.equal(X.textOn("003399", ""), "ffffff");
  assert.equal(X.textOn("ffffff", "ffffff"), "000000");  // same as background → computed
  assert.equal(X.textOn("bad", ""), "ffffff");
});

test("normStopTimes: departures sorted, realtime, cancelled, track", () => {
  const j = {
    place: { name: "Larissa Station", lat: 37.99, lon: 23.72, stopId: "hellenic_1" },
    nextPageCursor: "N",
    stopTimes: [
      { place: { name: "Larissa Station", lat: 37.99, lon: 23.72, departure: "2026-10-13T10:20:00Z", scheduledDeparture: "2026-10-13T10:15:00Z", track: "3" },
        mode: "REGIONAL_RAIL", realTime: true, headsign: "Chalkida", routeShortName: "Π1", routeColor: "003399" },
      { place: { name: "Larissa Station", lat: 37.99, lon: 23.72, departure: "2026-10-13T10:05:00Z", cancelled: true },
        mode: "HIGHSPEED_RAIL", headsign: "Thessaloniki", displayName: "IC 50" },
      { place: { name: "x", lat: 37.99, lon: 23.72 } },
      null
    ]
  };
  const s = X.normStopTimes(j);
  assert.equal(s.place.name, "Larissa Station");
  assert.equal(s.rows.length, 2);
  assert.equal(s.rows[0].line, "IC 50");
  assert.equal(s.rows[0].cancelled, true);
  assert.equal(s.rows[1].track, "3");
  assert.equal(s.rows[1].g, "rail");
  assert.equal(X.delayMin(s.rows[1].t, s.rows[1].sched), 5);
  assert.equal(s.next, "N");
  assert.deepEqual(X.normStopTimes("x").rows, []);
});

test("normStops and normTrips: strict, deduplicated", () => {
  const st = X.normStops([
    { name: "A", lat: 37.9, lon: 23.7, stopId: "s1" }, { name: "A again", lat: 37.9, lon: 23.7, stopId: "s1" },
    { name: "no id", lat: 37.9, lon: 23.7 }, { name: "bad", lat: "x", lon: 1, stopId: "s3" }]);
  assert.deepEqual(st, [{ id: "s1", name: "A", lat: 37.9, lon: 23.7 }]);
  assert.deepEqual(X.normStops({}), []);
  const seg = {
    trips: [{ tripId: "hellenic_T1", displayName: "IC 52" }], mode: "HIGHSPEED_RAIL", distance: 1000, realTime: true,
    from: { name: "Athens", lat: 38, lon: 23.7 }, to: { name: "Oinoi", lat: 38.2, lon: 23.7 },
    departure: "2026-10-13T10:00:00Z", arrival: "2026-10-13T10:20:00Z",
    scheduledDeparture: "2026-10-13T10:00:00Z", scheduledArrival: "2026-10-13T10:18:00Z",
    polyline: X.encodePolyline([[38, 23.7], [38.1, 23.7], [38.2, 23.7]], 4)
  };
  const tr = X.normTrips(X.withPrecision([seg, Object.assign({}, seg, { arrival: "2026-10-13T09:00:00Z" })], 4));
  assert.equal(tr.length, 1);
  assert.equal(tr[0].name, "IC 52");
  assert.equal(tr[0].g, "rail");
  assert.equal(tr[0].from, "Athens");
  assert.equal(tr[0].pts.length, 3);
  // Halfway in time → halfway along the line, heading north.
  const pos = X.vehiclePos(tr[0], Date.parse("2026-10-13T10:10:00Z"));
  assert.ok(Math.abs(pos.lat - 38.1) < 1e-6 && Math.abs(pos.lon - 23.7) < 1e-6);
  assert.ok(pos.heading < 1 || pos.heading > 359);
  assert.equal(X.vehiclePos(tr[0], Date.parse("2026-10-13T10:30:00Z")), null);
});

test("local time input round trip; prefs", () => {
  const t = X.fromLocalInput("2026-10-13T09:05");
  assert.equal(X.toLocalInput(t), "2026-10-13T09:05");
  assert.equal(X.hhmm(t), "09:05");
  assert.equal(X.fromLocalInput("2026-10-13 09:05"), null);
  assert.deepEqual(X.normPrefs(null), { stops: 1, live: 0 });
  assert.deepEqual(X.normPrefs({ stops: 0, live: 1, x: 2 }), { stops: 0, live: 1 });
});

test("itinText and itinTrack (Save as track, GPX round trip)", () => {
  const bus = leg({ mode: "BUS", startTime: "2026-10-13T10:06:00Z", endTime: "2026-10-13T10:30:00Z",
    from: { name: "Syntagma", lat: 37.975, lon: 23.735, track: "A" }, to: { name: "Kifisia", lat: 38.05, lon: 23.8 },
    routeShortName: "550", headsign: "Kifisia",
    legGeometry: { points: X.encodePolyline([[37.975, 23.735], [38.05, 23.8]], 6), precision: 6, length: 2 } });
  const it = X.normItin({ legs: [leg(), bus] });
  const txt = X.itinText(it, { walk: "Walk", min: "min", to: "to" });
  assert.match(txt, /→ .* \(30 min\)/);
  assert.match(txt, /🚶 Walk 5 min to Syntagma/);
  assert.match(txt, /🚌 550 → Kifisia · Syntagma \(A\) → Kifisia/);
  const tk = X.itinTrack(it, "Trip");
  assert.equal(tk.segs[0].length, 3);           // shared point at the stop kept once
  assert.deepEqual(tk.wpts.map((w) => w.name), ["550 Syntagma", "Kifisia"]);
  const gpx = T.writeGpx(tk);
  const back = T.parseGpx(gpx);
  assert.equal(back.segs[0].length, 3);
  assert.equal(X.itinTrack(null), null);
  assert.equal(iso("2026-10-13T10:00:00Z"), "2026-10-13T10:00:00.000Z");
});

test("stale timetables: nearest stops and verdict", () => {
  const stops = [
    { id: "far", lat: 37.99, lon: 23.74 }, { id: "near", lat: 37.9701, lon: 23.7201 },
    { id: "mid", lat: 37.972, lon: 23.722 }, { id: "", lat: 37.97, lon: 23.72 }, { id: "bad", lat: 200, lon: 0 }
  ];
  assert.deepEqual(X.nearestStops(stops, A.lat, A.lon, 2).map((s) => s.id), ["near", "mid"]);
  assert.equal(X.nearestStops(stops, A.lat, A.lon, 99).length, 3);
  assert.deepEqual(X.nearestStops(null, A.lat, A.lon), []);
  assert.deepEqual(X.nearestStops(stops, NaN, 0), []);
  // Stale only when there are stops and none has any departure.
  assert.equal(X.staleVerdict([0, 0, 0]), true);
  assert.equal(X.staleVerdict([0, 1]), false);
  assert.equal(X.staleVerdict([]), false);
  assert.equal(X.staleVerdict(null), false);
  // The departures request for the check: open-ended, one row.
  assert.equal(X.stoptimesUrl(B, "v6", { stopId: "gr-Athens-Bus_61593", n: 1 }),
    B + "v6/stoptimes?stopId=gr-Athens-Bus_61593&n=1");
});

test("OASA: stop code and live arrivals (strict copies)", () => {
  assert.equal(X.oasaStop("gr-Athens-Bus_61260"), "061260");
  assert.equal(X.oasaStop("gr-Athens-Bus_1234567"), "1234567");
  assert.equal(X.oasaStop("gr-Athens-Rail_61260"), "");
  assert.equal(X.oasaStop("gr-Athens-Bus_6a"), "");
  assert.equal(X.oasaStop(null), "");
  const routes = X.normOasaRoutes([
    { RouteCode: "1989", LineID: "Α2", RouteDescr: "ΑΚΑΔΗΜΙΑ - ΓΛΥΦΑΔΑ", RouteDescrEng: "AKADIMIA - GLYFADA" },
    { RouteCode: "x<1>", LineID: "BAD" }, null, "s"
  ], "el");
  assert.deepEqual(Object.keys(routes), ["1989"]);
  assert.equal(routes["1989"].line, "Α2");
  assert.equal(X.normOasaRoutes([{ RouteCode: "1", RouteDescr: "Α", RouteDescrEng: "A" }], "en")["1"].descr, "A");
  const rows = X.normOasaArrivals([
    { route_code: "1989", veh_code: "88017", btime2: "12" }, { route_code: "1989", veh_code: "88084", btime2: "1" },
    { route_code: "777", btime2: "5" }, { route_code: "1989", btime2: "-3" }, { route_code: "1989", btime2: "x" }, { btime2: "2" }
  ], routes);
  assert.deepEqual(rows.map((r) => [r.min, r.line, r.route]), [[1, "Α2", "1989"], [5, "", "777"], [12, "Α2", "1989"]]);
  assert.deepEqual(X.normOasaArrivals(null, routes), [], "null = no bus right now");
  assert.equal(X.normOasaArrivals(Array.from({ length: 50 }, () => ({ route_code: "1", btime2: "3" }))).length, 20);
});
