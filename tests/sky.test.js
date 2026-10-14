// Moon & Sky (sky/): astronomy core against published values, the
// star catalogue, the Calendar feed, and the Time/Calendar hooks.
// Run: node --test tests/

"use strict";

process.env.TZ = "Europe/Athens";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const C = require("../sky/core.js");
const S = require("../sky/stars.js");

const MIN = 60000;
const ATHENS = [37.9838, 23.7275];
function near(actual, expected, tol, what) {
  assert.ok(Math.abs(actual - expected) <= tol,
    what + ": " + actual + " not within " + tol + " of " + expected);
}
function utc(s) { return Date.parse(s); }
function angDiff(a, b) { return Math.abs(((a - b + 540) % 360) - 180); }

test("Moon position matches Meeus example 47.a", () => {
  // 1992-04-12 00:00 TD: λ 133.162655°, β −3.229126°, Δ 368409.7 km
  const m = C.moonPos(Date.UTC(1992, 3, 12) - 69000);
  near(angDiff(m.lon, 133.162655), 0, 0.01, "longitude");
  near(m.lat, -3.229126, 0.01, "latitude");
  near(m.dist, 368409.7, 20, "distance");
});

test("Sun position matches Meeus example 25.a", () => {
  // 1992-10-13 00:00 TD: apparent RA 198.38083°, Dec −7.78507°
  const s = C.sunPos(Date.UTC(1992, 9, 13) - 69000);
  near(s.ra, 198.38083, 0.01, "RA");
  near(s.dec, -7.78507, 0.01, "Dec");
});

test("Moon phases of early 2026 (±1 hour of published times)", () => {
  const got = C.phasesBetween(utc("2026-01-01T00:00Z"), utc("2026-04-01T00:00Z"));
  const want = [
    [2, "2026-01-03T10:03Z"], [3, "2026-01-10T15:48Z"], [0, "2026-01-18T19:52Z"],
    [1, "2026-01-26T04:47Z"], [2, "2026-02-01T22:09Z"], [3, "2026-02-09T12:43Z"],
    [0, "2026-02-17T12:01Z"], [1, "2026-02-24T12:27Z"], [2, "2026-03-03T11:38Z"],
    [3, "2026-03-11T09:38Z"], [0, "2026-03-19T01:23Z"], [1, "2026-03-25T19:17Z"]
  ];
  assert.equal(got.length, want.length);
  want.forEach((w, i) => {
    assert.equal(got[i].q, w[0], "phase kind #" + i);
    near(got[i].t, utc(w[1]), 60 * MIN, "phase #" + i);
  });
});

test("next phase and phase names", () => {
  const t = utc("2026-10-12T12:00Z");
  near(C.nextPhase(t, 2), utc("2026-10-26T04:12Z"), 60 * MIN, "next full moon");
  near(C.nextPhase(t, 0), utc("2026-11-09T07:02Z"), 60 * MIN, "next new moon");
  assert.equal(C.moonPhase(utc("2026-03-03T11:38Z")).idx, 4);
  assert.equal(C.moonPhase(utc("2026-01-18T19:52Z")).idx, 0);
  const wax = C.moonPhase(utc("2026-10-14T18:00Z"));
  assert.equal(wax.idx, 1);
  assert.ok(wax.waxing && wax.illum > 0.05 && wax.illum < 0.4);
  near(C.moonPhase(utc("2026-10-15T15:50Z")).age, 5, 0.1, "age five days after new moon");
});

test("equinoxes and solstices 2026–2030 (±10 minutes)", () => {
  const want = {
    2026: ["2026-03-20T14:46Z", "2026-06-21T08:24Z", "2026-09-23T00:05Z", "2026-12-21T20:50Z"],
    2027: ["2027-03-20T20:25Z", "2027-06-21T14:11Z", "2027-09-23T06:02Z", "2027-12-22T02:42Z"],
    2028: ["2028-03-20T02:17Z", "2028-06-20T20:02Z", "2028-09-22T11:45Z", "2028-12-21T08:20Z"],
    2029: ["2029-03-20T08:02Z", "2029-06-21T01:48Z", "2029-09-22T17:38Z", "2029-12-21T14:14Z"],
    2030: ["2030-03-20T13:52Z", "2030-06-21T07:31Z", "2030-09-22T23:27Z", "2030-12-21T20:09Z"]
  };
  Object.keys(want).forEach((y) => {
    want[y].forEach((iso, q) => near(C.season(+y, q), utc(iso), 10 * MIN, y + " q" + q));
  });
});

test("sunrise, sunset and moonrise in Athens (±3 minutes)", () => {
  // 2026-06-21: sunrise 06:02, sunset 20:51 (EEST)
  const jun = C.sunDay(new Date(2026, 5, 21).getTime(), ATHENS[0], ATHENS[1]);
  near(jun.rise, new Date(2026, 5, 21, 6, 2).getTime(), 3 * MIN, "June sunrise");
  near(jun.set, new Date(2026, 5, 21, 20, 51).getTime(), 3 * MIN, "June sunset");
  // 2026-12-21: sunrise 07:38, sunset 17:10 (EET)
  const dec = C.sunDay(new Date(2026, 11, 21).getTime(), ATHENS[0], ATHENS[1]);
  near(dec.rise, new Date(2026, 11, 21, 7, 38).getTime(), 3 * MIN, "December sunrise");
  near(dec.set, new Date(2026, 11, 21, 17, 10).getTime(), 3 * MIN, "December sunset");
  assert.ok(dec.civilDusk > dec.set && dec.nautDusk > dec.civilDusk && dec.astroDusk > dec.nautDusk);
  assert.ok(dec.goldenPm[0] < dec.set && dec.goldenPm[1] > dec.set && dec.bluePm[1] === dec.civilDusk);
  // the full moon of 2026-03-03 rises around sunset and sets around sunrise
  const fm = C.moonDay(new Date(2026, 2, 3).getTime(), ATHENS[0], ATHENS[1]);
  const sd = C.sunDay(new Date(2026, 2, 3).getTime(), ATHENS[0], ATHENS[1]);
  near(fm.rise, sd.set, 60 * MIN, "full moon rises near sunset");
  // 2026-10-10 (PyEphem 4.2.1): moonrise 04:08:57 UT, moonset 15:32:38 UT
  const nm = C.moonDay(new Date(2026, 9, 10).getTime(), ATHENS[0], ATHENS[1]);
  near(nm.rise, utc("2026-10-10T04:08:57Z"), 3 * MIN, "moonrise");
  near(nm.set, utc("2026-10-10T15:32:38Z"), 3 * MIN, "moonset");
});

test("polar day and polar night", () => {
  const tromso = [69.65, 18.96];
  assert.equal(C.sunDay(new Date(2026, 5, 21).getTime(), tromso[0], tromso[1]).polar, "day");
  assert.equal(C.sunDay(new Date(2026, 11, 21).getTime(), tromso[0], tromso[1]).polar, "night");
  const mid = C.sunDay(new Date(2026, 5, 21).getTime(), tromso[0], tromso[1]);
  assert.equal(mid.astroDusk, null);
  assert.equal(mid.dayLength, C.DAY);
});

test("planet positions against a reference ephemeris (±0.2°)", () => {
  // Geocentric apparent RA/Dec and magnitude, 2026-01-01 00:00 UT,
  // from PyEphem 4.2.1 (XEphem's VSOP87 theory)
  const t = utc("2026-01-01T00:00Z");
  const want = {
    mercury: [268.52, -24.00, -0.4], venus: [280.06, -23.62, -3.8], mars: [283.88, -23.72, 1.3],
    jupiter: [113.12, 21.98, -2.5], saturn: [357.38, -3.60, 1.2]
  };
  Object.keys(want).forEach((p) => {
    const r = C.planetPos(p, t);
    near(angDiff(r.ra, want[p][0]), 0, 0.2, p + " RA");
    near(r.dec, want[p][1], 0.2, p + " Dec");
    near(r.mag, want[p][2], 0.5, p + " magnitude");
  });
});

test("eclipse table agrees with the Moon: dates, nodes, lunar types", () => {
  const list = C.eclipseList();
  assert.ok(list.length >= 40);
  list.forEach((e) => {
    const p = C.phaseNear(e.t, e.kind === "s" ? 0 : 2);
    near(p, e.t, 2 * 3600000, e.kind + " " + new Date(e.t).toISOString());
    assert.ok(Math.abs(C.moonPos(p).lat) < 1.6, "Moon near a node");
    if (e.kind === "l") assert.equal(C.lunarShadow(e.t).type, e.type, "lunar type " + new Date(e.t).toISOString());
  });
});

test("eclipses as seen from a place", () => {
  const find = (d) => C.eclipseList().find((e) => new Date(e.t).toISOString().startsWith(d));
  const madrid = C.eclipseLocal(find("2026-08-12"), 40.42, -3.70);
  assert.ok(madrid.visible && madrid.mag >= 1, "total in Madrid");
  const london = C.eclipseLocal(find("2026-08-12"), 51.5, -0.13);
  near(london.mag, 0.92, 0.04, "partial in London");
  assert.equal(C.eclipseLocal(find("2026-08-12"), ATHENS[0], ATHENS[1]).visible, false);
  near(C.eclipseLocal(find("2027-08-02"), ATHENS[0], ATHENS[1]).mag, 0.8, 0.06, "2027 in Athens");
  assert.equal(C.eclipseLocal(find("2026-03-03"), ATHENS[0], ATHENS[1]).visible, false);
  const nye = C.eclipseLocal(find("2028-12-31"), ATHENS[0], ATHENS[1]);
  assert.ok(nye.visible && nye.atMax);
});

test("events of a month and the Calendar feed", () => {
  const from = new Date(2026, 7, 1).getTime(), to = new Date(2026, 8, 1).getTime();
  const ev = C.eventsBetween(from, to, { lat: ATHENS[0], lon: ATHENS[1] });
  const kinds = ev.map((e) => e.kind + (e.q != null ? e.q : "") + (e.id || "") + (e.type || ""));
  assert.ok(kinds.includes("showerper"));
  assert.ok(kinds.includes("eclipsetotal"));
  assert.ok(kinds.includes("eclipsepartial"));
  assert.equal(ev.filter((e) => e.kind === "phase").length, 4);
  // feed rows for one day, both languages
  const en = C.feedFor("2026-08-12", "en").map((r) => r.title);
  assert.deepEqual(en, ["Perseids meteor shower peak", "New moon", "Solar eclipse (total)"]);
  const el = C.feedFor("2026-08-12", "el").map((r) => r.title);
  assert.deepEqual(el, ["Κορύφωση: Περσείδες", "Νέα Σελήνη", "Έκλειψη Ηλίου (ολική)"]);
  assert.equal(C.feedFor("2026-08-12", "en")[0].allDay, true);
  assert.deepEqual(C.feedFor("2026-03-20", "en").map((r) => r.title), ["March equinox"]);
  assert.deepEqual(C.feedFor("2026-02-30", "en"), []);
  assert.deepEqual(C.feedFor("nonsense", "en"), []);
  // a whole month: four main phases at least, one row per event
  let rows = 0;
  for (let d = 1; d <= 31; d++) rows += C.feedFor("2026-10-" + String(d).padStart(2, "0"), "en").length;
  assert.ok(rows >= 6 && rows <= 9, "October 2026 rows: " + rows);
});

test("supermoon flag on close full moons only", () => {
  const year = C.eventsBetween(new Date(2026, 0, 1).getTime(), new Date(2027, 0, 1).getTime());
  const fulls = year.filter((e) => e.kind === "phase" && e.q === 2);
  assert.ok(fulls.length >= 12);
  const supers = fulls.filter((e) => e.supermoon);
  assert.ok(supers.length >= 1 && supers.length <= 4);
  supers.forEach((e) => assert.ok(C.moonPos(e.t).dist < 360000));
});

test("star catalogue and constellations are consistent", () => {
  assert.ok(S.stars.length >= 150 && S.stars.length <= 320);
  S.stars.forEach((s) => {
    assert.ok(s[0] >= 0 && s[0] < 360 && s[1] >= -90 && s[1] <= 90 && s[2] < 6.5);
    assert.equal(typeof s[3], "string"); assert.equal(typeof s[4], "string");
  });
  const sirius = S.stars.find((s) => s[3] === "Sirius");
  assert.ok(sirius && sirius[4] === "Σείριος" && sirius[2] < -1);
  assert.ok(S.constellations.length >= 30);
  S.constellations.forEach((c) => {
    assert.ok(c[1] && c[2], c[0] + " names");
    c[3].forEach((seg) => {
      assert.ok(seg.length >= 2);
      seg.forEach((i) => assert.ok(Number.isInteger(i) && i >= 0 && i < S.stars.length));
    });
  });
  const ori = S.constellations.find((c) => c[0] === "Ori");
  assert.equal(ori[2], "Ωρίων");
  // Polaris stays within a degree of the pole after precession to 2026
  const pol = S.stars.find((s) => s[3] === "Polaris");
  assert.ok(C.precess(pol[0], pol[1], C.tOf(utc("2026-01-01T00:00Z"))).dec > 89);
});

test("helpers: dates, compass, crossings", () => {
  assert.equal(C.dateStr(C.parseDate("2026-10-10")), "2026-10-10");
  assert.equal(C.parseDate("2026-13-01"), null);
  assert.equal(C.compass8(0), 0); assert.equal(C.compass8(359), 0);
  assert.equal(C.compass8(135), 3); assert.equal(C.compass8(270), 6);
  const xs = C.crossings((t) => Math.sin(t / 1000), 0, 10000, 500);
  assert.equal(xs.length, 3);
  assert.equal(xs[0].up, false);
});

test("app wiring: palette contract, prefs, no sync slice, deep links", () => {
  const js = fs.readFileSync(path.join(ROOT, "sky/sky.js"), "utf8");
  assert.ok(js.includes("inheritPalette") && js.includes("watchPalette"));
  assert.ok(js.includes('"oros-sky-prefs"'));
  assert.ok(!js.includes("registerSlice"));
  assert.ok(js.includes('__orosTakeTarget("sky")'));
  assert.equal((js.match(/window\.__orosOpenAt\s*=(?!=)/g) || []).length, 1);
  const html = fs.readFileSync(path.join(ROOT, "sky/index.html"), "utf8");
  ["core.js", "stars.js", "sky.js", "sky.css"].forEach((f) => assert.ok(html.includes(f + "?v=")));
  assert.ok(fs.existsSync(path.join(ROOT, "sky/LICENSE-d3-celestial.txt")));
});

test("Time links to Moon & Sky and takes the location deep link", () => {
  const astro = fs.readFileSync(path.join(ROOT, "time/astro.js"), "utf8");
  assert.ok(astro.includes('__orosOpenAt("sky", {})'));
  assert.ok(astro.includes('target.astro === "location"'));
  assert.ok(astro.includes('__orosTakeTarget("time")'));
});

test("Calendar: Moon & Sky feed is wired and opt-in", () => {
  const cal = fs.readFileSync(path.join(ROOT, "calendar/calendar.js"), "utf8");
  const idx = fs.readFileSync(path.join(ROOT, "calendar/index.html"), "utf8");
  assert.ok(idx.includes('src="../sky/core.js?v='));
  assert.ok(cal.includes('{ id: "lbl-feed-sky"'));
  assert.ok(cal.includes(".concat(skyFeedOn(dateStr))"));
  assert.ok(/OPT_IN_FEEDS = \["lbl-feed-sky"[,\]]/.test(cal));
  assert.ok(/var labelVis = \{ "lbl-feed-sky": false[, ]/.test(cal));
  assert.ok(cal.includes('_openAt: { app: "sky", target: { date: dateStr } }'));
});
