// Discover (maps/discover-core.js, maps wave 11): opening hours
// (parser + open now / next change), nearby places through Overpass,
// Wikipedia geosearch and Panoramax parsing, and the wiring.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const DC = require(path.join(__dirname, "..", "maps", "discover-core.js"));
const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

// 2026-10-13 is a Tuesday
const at = (s) => new Date(s);
const st = (h, d) => { const r = DC.status(h, at(d)); return [r.state, r.at ? r.at.getDate() + " " + String(r.at.getHours()).padStart(2, "0") + ":" + String(r.at.getMinutes()).padStart(2, "0") : null]; };

test("opening hours: weekdays, several ranges, overrides, additional rules", () => {
  const h = "Mo-Fr 08:00-17:00; Sa 09:00-13:00";
  assert.deepEqual(st(h, "2026-10-13T10:00"), ["open", "13 17:00"]);
  assert.deepEqual(st(h, "2026-10-13T17:00"), ["closed", "14 08:00"], "the end minute is closed");
  assert.deepEqual(st(h, "2026-10-17T14:00"), ["closed", "19 08:00"], "Saturday afternoon → Monday");
  assert.deepEqual(st("Mo-Su 08:00-12:00,17:00-21:00", "2026-10-13T13:00"), ["closed", "13 17:00"]);
  assert.deepEqual(st("Mo-Fr 08:00-12:00, We 16:00-18:00", "2026-10-14T17:00"), ["open", "14 18:00"], "',' adds");
  assert.deepEqual(st("Mo-Fr 08:00-20:00; We 10:00-12:00", "2026-10-14T09:00"), ["closed", "14 10:00"], "';' replaces");
  assert.deepEqual(st("Mo,We,Fr 10:00-14:00", "2026-10-13T11:00"), ["closed", "14 10:00"]);
  assert.deepEqual(st("Mo-Sa 09:00-21:00; Su off; PH off", "2026-10-18T10:00"), ["closed", "19 09:00"]);
  assert.deepEqual(st("Mo-Sa 09:00-21:00; Su,PH 10:00-14:00", "2026-10-18T11:00"), ["open", "18 14:00"], "PH dropped from a list");
  assert.deepEqual(st("08:00-20:00", "2026-10-13T21:00"), ["closed", "14 08:00"], "no weekday = every day");
  assert.deepEqual(st('Mo-Fr 09:00-17:00 "call ahead"', "2026-10-13T10:00"), ["open", "13 17:00"], "comments ignored");
  assert.deepEqual(st("Sa-Mo 10:00-12:00", "2026-10-19T11:00"), ["open", "19 12:00"], "range across the week end");
  assert.deepEqual(st("Mo-Fr", "2026-10-13T03:00"), ["open", "17 00:00"], "weekdays without times = all day");
});

test("opening hours: past midnight, 24/7, open end", () => {
  assert.deepEqual(st("Fr-Sa 22:00-04:00", "2026-10-17T02:00"), ["open", "17 04:00"], "Friday's night spills into Saturday");
  assert.deepEqual(st("Fr-Sa 22:00-04:00", "2026-10-13T02:00"), ["closed", "16 22:00"], "not on Tuesday");
  assert.deepEqual(st("24/7", "2026-10-13T03:00"), ["open", null]);
  assert.deepEqual(st("Mo-Su 00:00-24:00", "2026-10-13T03:00"), ["open", null], "joined into one run");
  assert.deepEqual(st("Mo-Su 18:00+", "2026-10-13T19:00"), ["open", "14 00:00"]);
  assert.deepEqual(st("Mo-Su 07:00-01:00", "2026-10-14T00:30"), ["open", "14 01:00"]);
});

test("opening hours: anything uncertain is unknown, never open", () => {
  ["Jan-Mar Mo-Fr 08:00-12:00", "sunrise-sunset", "Mo-Fr 08:00-12:00; week 1-10 Sa 09:00-10:00", "Mo[1] 10:00-12:00",
   "by appointment", "", null, 42, "PH off", "Mo-Fr 25:00-26:00", "x".repeat(700), "Mo-Fr 08:00-12;00"]
    .forEach(h => assert.equal(DC.status(h, at("2026-10-13T10:00")).state, "unknown", JSON.stringify(h)));
  assert.deepEqual(st("Mo-Fr off", "2026-10-13T10:00"), ["closed", null]);
});

test("nearby: categories, Overpass query, parsing and distance", () => {
  assert.ok(DC.CATS.length >= 10 && DC.CATS.every(c => c.id && c.q && c.icon));
  const q = DC.nearbyQuery("pharmacy", 37.9715123, 23.7257456, 99999);
  assert.equal(q, '[out:json][timeout:20];nwr["amenity"="pharmacy"](around:5000,37.971512,23.725746);out tags center 200;');
  assert.equal(DC.nearbyQuery("nope", 1, 1, 1), "");
  assert.match(DC.nearbyQuery("cafe", 1, 1, 10), /around:100,/);
  const from = { lat: 37.97, lon: 23.73 };
  const list = DC.parseNearby({ elements: [
    { type: "way", id: 2, center: { lat: 37.972, lon: 23.73 }, tags: { name: "Far", "name:el": "Μακριά", opening_hours: "24/7", website: "javascript:alert(1)" } },
    { type: "node", id: 1, lat: 37.9701, lon: 23.73, tags: { brand: "Chain", phone: "+30 210\n123", website: "https://ex.com/a", "addr:street": "Ermou", "addr:housenumber": "5" } },
    { type: "node", id: 1, lat: 37.9701, lon: 23.73, tags: { name: "dup" } },
    { type: "node", id: 3, tags: { name: "no position" } },
    { type: "area", id: 4, lat: 1, lon: 1, tags: {} }
  ] }, "pharmacy", from, "el");
  assert.deepEqual(list.map(p => p.id), ["n1", "w2"], "by distance, dupes and bad rows dropped");
  assert.equal(list[0].name, "Chain");
  assert.equal(list[0].phone, "+30 210 123");
  assert.equal(list[0].site, "https://ex.com/a");
  assert.equal(list[0].addr, "Ermou 5");
  assert.equal(list[0].d, 11);
  assert.equal(list[1].name, "Μακριά", "name in the app language");
  assert.equal(list[1].site, "", "only http(s) links");
  assert.deepEqual(DC.parseNearby(null, "cafe", from), []);
  assert.equal(DC.radiusFor({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }), 5000);
  assert.equal(DC.radiusFor({ lat: 0, lon: 0 }, { lat: 0, lon: 0.0001 }), 300);
});

test("Wikipedia geosearch: URL and parsing", () => {
  const u = DC.wikiUrl("el", 37.97, 23.72, 50000);
  assert.ok(u.startsWith("https://el.wikipedia.org/w/api.php?"));
  assert.match(u, /origin=\*/);
  assert.match(u, /ggsradius=10000&/);
  assert.match(u, /ggscoord=37\.97%7C23\.72/);
  assert.ok(DC.wikiUrl("xx", 0, 0).startsWith("https://en.wikipedia.org/"));
  const w = DC.parseWiki({ query: { pages: [
    { pageid: 5, title: "Ακρόπολη Αθηνών", description: "αρχαία ακρόπολη", coordinates: [{ lat: 37.9715, lon: 23.7257 }], thumbnail: { source: "https://upload.wikimedia.org/a.jpg" } },
    { pageid: 6, title: "Bad thumb", coordinates: [{ lat: 37.97, lon: 23.73 }], thumbnail: { source: "javascript:x" } },
    { pageid: 7, title: "No coords" }
  ] } }, "el", { lat: 37.97, lon: 23.73 });
  assert.deepEqual(w.map(x => x.title), ["Bad thumb", "Ακρόπολη Αθηνών"]);
  assert.equal(w[0].thumb, "");
  assert.equal(w[1].thumb, "https://upload.wikimedia.org/a.jpg");
  assert.equal(w[1].url, "https://el.wikipedia.org/wiki/" + encodeURIComponent("Ακρόπολη_Αθηνών"));
  assert.deepEqual(DC.parseWiki({}, "en"), []);
});

test("Panoramax: URL and parsing", () => {
  assert.equal(DC.photosUrl(37.97, 23.72, 37.98, 23.735, 500), "https://api.panoramax.xyz/api/search?bbox=23.72,37.97,23.735,37.98&limit=200");
  const p = DC.parsePhotos({ features: [
    { id: "abc-1", geometry: { coordinates: [23.72, 37.97] }, assets: { thumb: { href: "https://px.example/t.jpg" }, sd: { href: "https://px.example/sd.jpg" } },
      properties: { datetime: "2025-05-01T10:00:00Z", "view:azimuth": 90, license: "CC-BY-SA-4.0", providers: [{ name: "Ann" }] } },
    { id: "abc-1", geometry: { coordinates: [23.72, 37.97] }, assets: { sd: { href: "https://px.example/x.jpg" } } },
    { id: "bad id!", geometry: { coordinates: [1, 1] }, assets: { sd: { href: "https://x/y.jpg" } } },
    { id: "noimg", geometry: { coordinates: [1, 1] }, assets: { sd: { href: "http://x/y.jpg" } } }
  ] });
  assert.equal(p.length, 1);
  assert.deepEqual([p[0].lat, p[0].lon, p[0].az, p[0].by, p[0].lic], [37.97, 23.72, 90, "Ann", "CC-BY-SA-4.0"]);
  assert.equal(p[0].time, Date.parse("2025-05-01T10:00:00Z"));
  assert.equal(p[0].page, "https://api.panoramax.xyz/#focus=pic&pic=abc-1");
});

test("wiring: scripts, precache, mode button, no innerHTML with service text", () => {
  const html = read("maps/index.html");
  assert.ok(html.indexOf("discover-core.js") < html.indexOf('src="discover.js'));
  const sw = read("sw.js");
  assert.match(sw, /"maps\/discover-core\.js"/);
  assert.match(sw, /"maps\/discover\.js"/);
  const dj = read("maps/discover.js");
  assert.match(dj, /detail: "discover"/);
  assert.ok(!/innerHTML = (?!ICON;|'<svg)/.test(dj), "innerHTML only for fixed icons");
  assert.match(dj, /rel = "noopener noreferrer"/);
});
