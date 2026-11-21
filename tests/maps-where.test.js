// Maps wave H6 (hiking and cycling): "Where am I" helpers in
// maps/where-core.js: coordinate formats, UTM (checked against the
// meridian arc and an independent Snyder series), the message text,
// the compass heading.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const W = require(path.join(__dirname, "..", "maps/where-core.js"));

// Snyder, Map Projections: A Working Manual (USGS PP 1395), p. 61
function snyder(lat, lon, lon0) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, r = Math.PI / 180;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2), p = lat * r;
  const N = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2), T = Math.tan(p) ** 2, C = ep2 * Math.cos(p) ** 2, A = (lon - lon0) * r * Math.cos(p);
  const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * p - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * p) +
    (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * p) - (35 * e2 ** 3 / 3072) * Math.sin(6 * p));
  const x = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120);
  const y = k0 * (M + N * Math.tan(p) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  return [500000 + x, lat < 0 ? y + 10000000 : y];
}

test("decimal degrees, DMS and degrees + decimal minutes", () => {
  assert.equal(W.dd(37.971542, 23.726472), "37.97154, 23.72647");
  assert.equal(W.dms(37.971542, 23.726472), "37°58′17.6″N 023°43′35.3″E");
  assert.equal(W.dms(-33.856784, -151.215297), "33°51′24.4″S 151°12′55.1″W");
  assert.equal(W.ddm(37.971542, 23.726472), "N 37°58.293′ E 23°43.588′");
  assert.equal(W.ddm(-0.5, -0.25), "S 0°30.000′ W 0°15.000′");
  // rounding carries into the next unit
  assert.equal(W.dms(10.99999999, 0), "11°00′00.0″N 000°00′00.0″E");
  assert.equal(W.dd(NaN, 1), "");
  assert.equal(W.dms(91, 0), "");
});

test("UTM: zone, band, false origin, meridian arc", () => {
  const eq = W.utm(0, 3);
  assert.deepEqual([eq.zone, eq.band, eq.e, eq.n], [31, "N", 500000, 0]);
  // on the central meridian the northing is k0 × the meridian arc (45°: 4 984 944.378 m)
  const m45 = W.utm(45, 9);
  assert.equal(m45.e, 500000);
  assert.ok(Math.abs(m45.nx - 0.9996 * 4984944.378) < 0.01, String(m45.nx));
  // southern hemisphere: 10 000 000 m false northing
  assert.equal(W.utm(-45, 9).n, 10000000 - m45.n);
  assert.equal(W.utm(-45, 9).hemi, "S");
  // zones and bands
  assert.equal(W.utm(37.97, 23.72).text.slice(0, 3), "34S");
  assert.equal(W.zoneOf(60, 5), 32, "Norway");
  assert.equal(W.zoneOf(78, 15), 33, "Svalbard");
  assert.equal(W.zoneOf(0, 180), 60);
  assert.equal(W.utm(84.5, 0), null, "UPS area");
  assert.equal(W.utm(-80.5, 0), null);
});

test("UTM agrees with an independent series off the meridian", () => {
  for (const [lat, lon] of [[37.971542, 23.726472], [40.6264, 22.9484], [35.3387, 25.1442], [-33.8568, 151.2153], [64.1466, -21.9426], [47.0, 11.9]]) {
    const u = W.utm(lat, lon), lon0 = (u.zone - 1) * 6 - 180 + 3;
    const s = snyder(lat, lon, lon0);
    assert.ok(Math.abs(u.ex - s[0]) < 0.05 && Math.abs(u.nx - s[1]) < 0.05, lat + "," + lon + ": " + [u.ex, u.nx] + " vs " + s);
  }
  // Athens, Syntagma: zone 34S, about 739 800 E, 4 206 000 N
  const a = W.utm(37.9755, 23.7348);
  assert.ok(a.e > 739000 && a.e < 741000 && a.n > 4205000 && a.n < 4208000, a.text);
});

test("the message to send for help", () => {
  const txt = W.smsText({ lat: 37.971542, lon: 23.726472, acc: 8.4, ele: 412.6, t: new Date(2026, 10, 19, 9, 5).getTime(), place: "Path to\nthe chapel",
    words: { at: "Η θέση μου", acc: "ακρίβεια", ele: "υψόμετρο", time: "ώρα" } });
  const lines = txt.split("\n");
  assert.equal(lines[0], "Η θέση μου: 37.97154, 23.72647");
  assert.equal(lines[1], "37°58′17.6″N 023°43′35.3″E");
  assert.match(lines[2], /^UTM 34S \d{6} \d{7}$/);
  assert.equal(lines[3], "ακρίβεια ±8 m, υψόμετρο 413 m");
  assert.equal(lines[4], "Path to the chapel");
  assert.equal(lines[5], "ώρα 09:05");
  assert.equal(lines[6], "https://www.openstreetmap.org/?mlat=37.97154&mlon=23.72647#map=17/37.97154/23.72647");
  assert.equal(W.smsText({ lat: 1, lon: 1 }).split("\n")[0], "My position: 1.00000, 1.00000");
  assert.equal(W.smsText({ lat: 200, lon: 1 }), "");
  assert.equal(W.smsHref("a b\nc&d"), "sms:?body=a%20b%0Ac%26d");
});

test("compass heading from device orientation", () => {
  assert.equal(W.heading({ webkitCompassHeading: 271.26 }), 271.3);
  assert.equal(W.heading({ absolute: true, alpha: 90 }), 270);
  assert.equal(W.heading({ absolute: true, alpha: 90 }, 90), 0);
  assert.equal(W.heading({ absolute: true, alpha: 0 }), 0);
  assert.equal(W.heading({ absolute: false, alpha: 90 }), null, "relative alpha is not a compass");
  assert.equal(W.heading(null), null);
  assert.deepEqual([0, 22, 23, 90, 180, 337, 338, 359].map(W.cardinal), [0, 0, 1, 2, 4, 7, 0, 0]);
  assert.equal(W.cardinal(null), -1);
});

test("Discover outdoor categories: union query, kind, height, drinking water", () => {
  const DC = require(path.join(__dirname, "..", "maps/discover-core.js"));
  assert.equal(DC.VER, "1.1.0");
  const ids = DC.CATS.map((c) => c.id);
  ["water", "shelter", "peak", "camp", "bike"].forEach((id) => assert.ok(ids.includes(id), id));
  const q = DC.nearbyQuery("water", 37.9, 23.7, 2000);
  assert.equal(q, '[out:json][timeout:20];(nwr["amenity"="drinking_water"](around:2000,37.9,23.7);nwr["natural"="spring"](around:2000,37.9,23.7);nwr["man_made"="water_tap"](around:2000,37.9,23.7);nwr["amenity"="water_point"](around:2000,37.9,23.7););out tags center 200;');
  assert.match(DC.nearbyQuery("restaurant", 37.9, 23.7, 2000), /^\[out:json\]\[timeout:20\];nwr\["amenity"="restaurant"\]\(around:2000,37\.9,23\.7\);out tags center 200;$/);
  const items = DC.parseNearby({ elements: [
    { type: "node", id: 1, lat: 37.901, lon: 23.7, tags: { natural: "spring", drinking_water: "no", seasonal: "summer" } },
    { type: "node", id: 2, lat: 37.902, lon: 23.7, tags: { amenity: "drinking_water" } },
    { type: "node", id: 3, lat: 37.903, lon: 23.7, tags: { man_made: "water_tap" } },
    { type: "node", id: 4, lat: 37.904, lon: 23.7, tags: { natural: "peak", name: "Ymittos", ele: "1,026" } },
    { type: "way", id: 5, center: { lat: 37.905, lon: 23.7 }, tags: { tourism: "alpine_hut", ele: "2100 m", fee: "yes" } },
    { type: "node", id: 6, lat: 37.906, lon: 23.7, tags: { natural: "peak", ele: "3500 ft" } },
    { type: "node", id: 7, lat: 37.907, lon: 23.7, tags: { natural: "peak", ele: "high" } }
  ] }, "water", { lat: 37.9, lon: 23.7 }, "en");
  const by = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.deepEqual([by.n1.kind, by.n1.drink, by.n1.seasonal], ["spring", "no", 1]);
  assert.deepEqual([by.n2.kind, by.n2.drink], ["drinking_water", "yes"]);
  assert.deepEqual([by.n3.kind, by.n3.drink], ["water_tap", ""]);
  assert.deepEqual([by.n4.kind, by.n4.ele, by.n4.name], ["peak", 1026, "Ymittos"]);
  assert.deepEqual([by.w5.kind, by.w5.ele, by.w5.fee], ["alpine_hut", 2100, 1]);
  assert.equal(by.n6.ele, 1067);
  assert.equal(by.n7.ele, null);
  assert.equal(DC.drinkOf({ amenity: "drinking_water", drinking_water: "no" }, "drinking_water"), "no");
  assert.equal(DC.eleOf("12000"), null);
});

test("the Where am I sheet is wired and has EN, EL and DE strings", () => {
  const fs = require("fs");
  const src = fs.readFileSync(path.join(__dirname, "..", "maps/where.js"), "utf8");
  assert.match(src, /call\.href = "tel:112"/);
  assert.match(src, /W\.smsHref\(smsText\(\)\)/);
  assert.doesNotMatch(src, /innerHTML = (?!'<svg)/, "text only through textContent");
  const html = fs.readFileSync(path.join(__dirname, "..", "maps/index.html"), "utf8");
  assert.ok(html.indexOf("where-core.js") > 0 && html.indexOf("where-core.js") < html.indexOf("where.js?"), "core before the UI");
  const maps = fs.readFileSync(path.join(__dirname, "..", "maps/maps.js"), "utf8");
  assert.match(maps, /meItems: \[\],/);
  const de = fs.readFileSync(path.join(__dirname, "..", "i18n/de/maps.js"), "utf8");
  const dsc = fs.readFileSync(path.join(__dirname, "..", "maps/discover.js"), "utf8");
  ["wh.call", "wh.sms", "wh.utm", "wh.compass.on", "wh.sun.left", "wh.d.7"].forEach((k) => {
    assert.equal(src.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.includes('"' + k + '":'), k + " DE");
  });
  ["dsc.cat.water", "dsc.k.spring", "dsc.f.unk", "dsc.k.bicycle_parking"].forEach((k) => {
    assert.equal(dsc.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.includes('"' + k + '":'), k + " DE");
  });
});
