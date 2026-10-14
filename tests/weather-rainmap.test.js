// Weather: the rain map core (weather/rainmap-core.js) — NASA GIBS
// IMERG half-hourly tile URLs, the DescribeDomains answer, the
// slider frames, the fallback probe times and the legend.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const R = require(path.join(__dirname, "..", "weather/rainmap-core.js"));

const T = Date.UTC(2026, 9, 14, 13, 30);   // 2026-10-14 13:30 UTC

test("isoTime floors to the half hour, UTC, GIBS format", () => {
  assert.equal(R.isoTime(T), "2026-10-14T13:30:00Z");
  assert.equal(R.isoTime(T + 29 * 60000 + 59000), "2026-10-14T13:30:00Z");
  assert.equal(R.isoTime(T - 1), "2026-10-14T13:00:00Z");
  assert.equal(R.isoTime(Date.UTC(2026, 0, 1, 0, 5)), "2026-01-01T00:00:00Z");
});

test("parseIso: date, date-time, bad input", () => {
  assert.equal(R.parseIso("2026-10-14T13:30:00Z"), T);
  assert.equal(R.parseIso("2026-10-14T13:30Z"), T);
  assert.equal(R.parseIso("2026-10-14T13:30:00.000Z"), T);
  assert.equal(R.parseIso("2026-10-13"), Date.UTC(2026, 9, 13));
  assert.equal(R.parseIso("PT30M"), null);
  assert.equal(R.parseIso(""), null);
  assert.equal(R.parseIso(null), null);
});

test("tile template and URL: layer, matrix set, time, z/y/x order", () => {
  assert.equal(R.tileTemplate(T),
    "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/IMERG_Precipitation_Rate_30min/default/2026-10-14T13:30:00Z/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png");
  assert.equal(R.tileUrl(T, 3, 2, 5),
    "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/IMERG_Precipitation_Rate_30min/default/2026-10-14T13:30:00Z/GoogleMapsCompatible_Level6/3/2/5.png");
  assert.equal(R.MAX_NATIVE_ZOOM, 6);
});

test("DescribeDomains URL", () => {
  assert.equal(R.domainsUrl(T - 86400000, T + 600000),
    "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/IMERG_Precipitation_Rate_30min/default/GoogleMapsCompatible_Level6/all/2026-10-13T13:30:00Z--2026-10-14T13:30:00Z.xml");
});

test("parseDomains: newest end of the time ranges", () => {
  const xml = `<?xml version="1.0"?><Domains xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1">
    <SpaceDomain><BoundingBox CRS="urn:ogc:def:crs:EPSG::3857"><LowerCorner>-20037508.34 -20037508.34</LowerCorner><UpperCorner>20037508.34 20037508.34</UpperCorner></BoundingBox></SpaceDomain>
    <DimensionDomain><ows:Identifier>time</ows:Identifier><Domain>2026-10-14/2026-10-14T13:30:00Z/PT30M</Domain><Size>1</Size></DimensionDomain></Domains>`;
  assert.equal(R.parseDomains(xml), T);
  // several ranges and an instant; the newest wins
  assert.equal(R.parseDomains("<Domain>2026-10-13/2026-10-13T20:00:00Z/PT30M,2026-10-14T01:00:00Z/2026-10-14T13:30:00Z/PT30M,2026-10-14T09:00:00Z</Domain>"), T);
  // never in the future
  const now = Date.UTC(2026, 9, 14, 12, 10);
  assert.equal(R.parseDomains("<Domain>2026-10-14/2026-10-14T13:30:00Z/PT30M</Domain>", now), Date.UTC(2026, 9, 14, 12, 0));
  // empty or junk
  assert.equal(R.parseDomains("<Domains><DimensionDomain><Domain></Domain><Size>0</Size></DimensionDomain></Domains>"), null);
  assert.equal(R.parseDomains("not xml"), null);
  assert.equal(R.parseDomains(null), null);
});

test("frames: 12 half hours ending at the newest, oldest first", () => {
  const f = R.frames(T + 5 * 60000);
  assert.equal(f.length, 12);
  assert.equal(f[11], T);
  assert.equal(f[0], T - 11 * 30 * 60000);
  for (let i = 1; i < f.length; i++) assert.equal(f[i] - f[i - 1], 30 * 60000);
  assert.equal(R.frames(T, 3).length, 3);
});

test("probeTimes: from 3 hours ago backwards, half-hour steps", () => {
  const now = Date.UTC(2026, 9, 14, 19, 25);
  const p = R.probeTimes(now);
  assert.equal(p.length, 24);
  assert.equal(p[0], Date.UTC(2026, 9, 14, 16, 0));
  assert.equal(p[1], Date.UTC(2026, 9, 14, 15, 30));
  assert.ok(p.every((x, i) => i === 0 || p[i - 1] - x === 30 * 60000));
});

test("hoursAgo counts to the middle of the half hour", () => {
  assert.equal(R.hoursAgo(T, Date.UTC(2026, 9, 14, 19, 25)), 5);
  assert.equal(R.hoursAgo(T, T), 0);
});

test("legend gradient and tick positions", () => {
  const g = R.legendGradient();
  assert.match(g, /^linear-gradient\(to right, rgb\(0,118,78\) 0%, /);
  assert.match(g, /rgb\(51,0,0\) 100%\)$/);
  assert.equal(R.legendPos(0.1), 0);
  assert.equal(R.legendPos(53), 100);
  assert.equal(R.legendPos(1000), 100);
  const p1 = R.legendPos(1), p10 = R.legendPos(10);
  assert.ok(p1 > 30 && p1 < 40 && p10 > 70 && p10 < 76);
  assert.match(R.legendGradient(R.LEGEND_SNOW), /rgb\(177,250,238\) 0%/);
});
