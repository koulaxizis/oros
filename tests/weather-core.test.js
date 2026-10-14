// Weather: the pure core (weather/core.js) — MeteoAlarm Atom + CAP
// parsers, the active list, the city's area (saved or guessed), the
// country from a code or a time zone, the "rain in the next 2 hours"
// slots and sentence (EN + EL), air quality + pollen hours and days,
// the model list and the multi-model compare answer.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const W = require(path.join(__dirname, "..", "weather/core.js"));

// ---------- MeteoAlarm ----------
const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">
  <id>https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-greece</id>
  <title>MeteoAlarm Greece</title>
  <updated>2026-10-14T08:35:26Z</updated>
  <entry>
    <cap:areaDesc>Kriti</cap:areaDesc>
    <cap:event>Moderate Wind warning</cap:event>
    <cap:sent>2026-10-14T04:10:00+00:00</cap:sent>
    <cap:onset>2026-10-15T04:00:00+00:00</cap:onset>
    <cap:expires>2026-10-15T08:00:00+00:00</cap:expires>
    <cap:certainty>Likely</cap:certainty>
    <cap:severity>Moderate</cap:severity>
    <cap:urgency>Expected</cap:urgency>
    <cap:message_type>Alert</cap:message_type>
    <cap:status>Actual</cap:status>
    <cap:scope>Public</cap:scope>
    <cap:identifier>2.49.0.0.300.0.GR.261014041000.A1</cap:identifier>
    <cap:geocode><valueName>EMMA_ID</valueName><value>GR016</value></cap:geocode>
    <link type="application/cap+xml" href="https://feeds.meteoalarm.org/api/v1/warnings/feeds-greece/abc?index_info=0&amp;index_area=0"/>
    <link rel="alternate" href="https://meteoalarm.org/en/live/region/GR"/>
    <title>Moderate Wind warning issued for Greece - Kriti</title>
  </entry>
  <entry>
    <cap:areaDesc>Central Makedonia</cap:areaDesc>
    <cap:event><![CDATA[Severe Thunderstorm warning]]></cap:event>
    <cap:onset>2026-10-14T06:00:00+00:00</cap:onset>
    <cap:expires>2026-10-14T20:00:00+00:00</cap:expires>
    <cap:severity>Severe</cap:severity>
    <cap:message_type>Alert</cap:message_type>
    <cap:status>Actual</cap:status>
    <cap:identifier>GR-2</cap:identifier>
    <cap:geocode><valueName>EMMA_ID</valueName><value>GR005</value></cap:geocode>
    <link type="application/cap+xml" href="https://feeds.meteoalarm.org/api/v1/warnings/feeds-greece/def"/>
    <title>Orange Thunderstorm Warning &amp; more</title>
  </entry>
  <entry>
    <cap:areaDesc>East Makedonia</cap:areaDesc>
    <cap:event>Minor Fog</cap:event>
    <cap:expires>2026-10-14T20:00:00+00:00</cap:expires>
    <cap:severity>Minor</cap:severity>
    <cap:status>Actual</cap:status>
    <cap:identifier>GR-3</cap:identifier>
  </entry>
  <entry>
    <cap:areaDesc>Attiki</cap:areaDesc>
    <cap:event>Extreme high-temperature</cap:event>
    <cap:expires>2026-10-13T20:00:00+00:00</cap:expires>
    <cap:severity>Extreme</cap:severity>
    <cap:status>Actual</cap:status>
    <cap:identifier>GR-4</cap:identifier>
  </entry>
  <entry>
    <cap:areaDesc>Attiki</cap:areaDesc>
    <cap:event>Moderate rain</cap:event>
    <cap:expires>2026-10-15T20:00:00+00:00</cap:expires>
    <cap:severity>Moderate</cap:severity>
    <cap:message_type>Cancel</cap:message_type>
    <cap:status>Actual</cap:status>
    <cap:identifier>GR-5</cap:identifier>
  </entry>
  <entry>
    <cap:areaDesc>Attiki</cap:areaDesc>
    <cap:event>Moderate rain</cap:event>
    <cap:expires>2026-10-15T20:00:00+00:00</cap:expires>
    <cap:severity>Moderate</cap:severity>
    <cap:status>Exercise</cap:status>
    <cap:identifier>GR-6</cap:identifier>
  </entry>
</feed>`;
const NOW = Date.parse("2026-10-14T10:00:00Z");

test("parseAtom reads the MeteoAlarm legacy Atom entries", () => {
  const list = W.parseAtom(ATOM);
  assert.equal(list.length, 6);
  const a = list[0];
  assert.equal(a.area, "Kriti");
  assert.deepEqual(a.geo, ["GR016"]);
  assert.equal(a.kind, "wind");
  assert.equal(a.level, 2);
  assert.equal(a.id, "2.49.0.0.300.0.GR.261014041000.A1");
  assert.equal(a.cap, "https://feeds.meteoalarm.org/api/v1/warnings/feeds-greece/abc?index_info=0&index_area=0");
  assert.equal(a.web, "https://meteoalarm.org/en/live/region/GR");
  assert.equal(a.onset, Date.parse("2026-10-15T04:00:00Z"));
  assert.equal(a.exp, Date.parse("2026-10-15T08:00:00Z"));
  assert.equal(a.msg, "Alert");
  const b = list[1];
  assert.equal(b.event, "Severe Thunderstorm warning");   // CDATA unwrapped
  assert.equal(b.kind, "storm");
  assert.equal(b.level, 3);
  assert.equal(b.title, "Orange Thunderstorm Warning & more");
  assert.equal(list[2].level, 1);
  assert.equal(list[3].kind, "heat");
  assert.equal(list[3].level, 4);
});

test("parseAtom refuses what is not a feed and never trusts links", () => {
  assert.equal(W.parseAtom("<html><body>hello</body></html>"), null);
  assert.equal(W.parseAtom(""), null);
  const evil = W.parseAtom(`<feed><entry><cap:areaDesc>Kriti &lt;img src=x onerror=alert(1)&gt; &amp; Chania</cap:areaDesc>
    <link type="application/cap+xml" href="javascript:alert(1)"/><cap:severity>Severe</cap:severity></entry></feed>`);
  assert.equal(evil.length, 1);
  assert.equal(evil[0].cap, "");
  assert.equal(evil[0].area, "Kriti & Chania");   // markup dropped; the app still uses textContent
});

test("activeList keeps real, live, yellow+ warnings, worst first", () => {
  const act = W.activeList(W.parseAtom(ATOM), NOW);
  assert.deepEqual(act.map((w) => w.id), ["GR-2", "2.49.0.0.300.0.GR.261014041000.A1"]);
  assert.deepEqual(W.activeList(null, NOW), []);
  assert.deepEqual(W.activeList([null, 3, { level: 2, id: "x", area: "a" }], NOW).length, 1);
});

test("levelOf: awareness parameter, then severity, then a colour word", () => {
  assert.equal(W.levelOf("3; orange; Severe", "Moderate", ""), 3);
  assert.equal(W.levelOf("", "Extreme", ""), 4);
  assert.equal(W.levelOf("", "", "Red warning for wind"), 4);
  assert.equal(W.levelOf("", "", "Yellow Snow-ice"), 2);
  assert.equal(W.levelOf("", "", "nothing"), 0);
  assert.equal(W.kindOf("", "10; Rain"), "rain");
  assert.equal(W.kindOf("Avalanches warning", ""), "avalanche");
  assert.equal(W.kindOf("Low-temperature", ""), "cold");
  assert.equal(W.kindOf("zzz", ""), "other");
});

test("forCity: a saved area wins; otherwise a guess from region and name", () => {
  const act = W.activeList(W.parseAtom(ATOM), NOW);
  // Greek region name from the geocoder ~ transliterated area of the feed
  let r = W.forCity(act, { label: "Θεσσαλονίκη", adm: "Κεντρική Μακεδονία" });
  assert.equal(r.how, "guess");
  assert.equal(r.area, "Central Makedonia");
  assert.deepEqual(r.mine.map((w) => w.id), ["GR-2"]);
  assert.equal(r.others.length, 1);
  r = W.forCity(act, { label: "Thessaloniki", adm: "Central Macedonia" });
  assert.equal(r.area, "Central Makedonia");
  r = W.forCity(act, { label: "Heraklion", adm: "Crete", wa: { n: "Kriti", g: "GR016" } });
  assert.equal(r.how, "saved");
  assert.deepEqual(r.mine.map((w) => w.area), ["Kriti"]);
  r = W.forCity(act, { label: "x", wa: { n: "", g: "GR005" } });   // by EMMA code
  assert.deepEqual(r.mine.map((w) => w.id), ["GR-2"]);
  r = W.forCity(act, { label: "My location" });
  assert.equal(r.how, "");
  assert.equal(r.mine.length, 0);
  assert.equal(r.others.length, 2);
  // two areas match equally ("makedonia"): no guess
  const two = W.activeList(W.parseAtom(ATOM.replace("Minor Fog", "Moderate Fog").replace("<cap:severity>Minor", "<cap:severity>Moderate")), NOW);
  r = W.forCity(two, { label: "Somewhere", adm: "Makedonia" });
  assert.equal(r.how, "");
  assert.deepEqual(W.areas(two).map((a) => a.n), ["Central Makedonia", "East Makedonia", "Kriti"]);
});

test("country: from the code, else from the time zone; feed URL", () => {
  assert.equal(W.slugFor("gr", ""), "greece");
  assert.equal(W.slugFor("", "Europe/Berlin"), "germany");
  assert.equal(W.slugFor("US", "America/New_York"), "");
  assert.equal(W.countryOf("", "Europe/Athens"), "GR");
  assert.equal(W.feedUrl("greece"), "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-greece");
  assert.equal(W.feedUrl("../x"), "");
  Object.values(W.COUNTRIES).forEach((s) => assert.ok(W.feedUrl(s), s));
  Object.values(W.ZONES).forEach((cc) => assert.ok(W.COUNTRIES[cc], cc));
});

const CAP = `<?xml version="1.0"?><alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>GR-2</identifier><status>Actual</status><msgType>Alert</msgType>
  <info><language>en-GB</language><event>Severe Thunderstorm</event><severity>Severe</severity>
    <senderName>Hellenic National Meteorological Service</senderName>
    <headline>Orange thunderstorm warning</headline>
    <description>Heavy storms &lt;b&gt;with hail&lt;/b&gt;.</description>
    <instruction>Stay indoors.</instruction><web>https://www.emy.gr/</web>
    <parameter><valueName>awareness_level</valueName><value>3; orange; Severe</value></parameter>
    <parameter><valueName>awareness_type</valueName><value>3; Thunderstorm</value></parameter>
  </info>
  <info><language>el-GR</language><event>Καταιγίδα</event><severity>Severe</severity>
    <headline>Πορτοκαλί προειδοποίηση</headline><description>Ισχυρές καταιγίδες.</description>
    <web>javascript:alert(1)</web>
    <parameter><valueName>awareness_level</valueName><value>3; orange; Severe</value></parameter>
  </info></alert>`;

test("parseCap picks the user's language, falls back to English", () => {
  const el = W.parseCap(CAP, "el");
  assert.equal(el.headline, "Πορτοκαλί προειδοποίηση");
  assert.equal(el.desc, "Ισχυρές καταιγίδες.");
  assert.equal(el.web, "");                 // not http(s): dropped
  assert.equal(el.level, 3);
  const en = W.parseCap(CAP, "en");
  assert.equal(en.desc, "Heavy storms with hail.");   // markup stripped
  assert.equal(en.instr, "Stay indoors.");
  assert.equal(en.kind, "storm");
  assert.equal(en.sender, "Hellenic National Meteorological Service");
  assert.equal(en.web, "https://www.emy.gr/");
  assert.equal(W.parseCap("<feed/>", "en"), null);
});

test("warnTitle in English and Greek", () => {
  assert.equal(W.warnTitle({ level: 3, kind: "storm" }, "en"), "Orange warning: thunderstorms");
  assert.equal(W.warnTitle({ level: 4, kind: "heat" }, "el"), "Κόκκινη προειδοποίηση: υψηλές θερμοκρασίες");
  assert.equal(W.warnTitle({ level: 2, kind: "nope" }, "en"), "Yellow warning: weather");
});

test("fold + tokens: accents, Greek letters, spelling variants", () => {
  assert.equal(W.fold("Αττική"), "atiki");
  assert.equal(W.fold("Attiki"), "atiki");
  assert.equal(W.fold("Île-de-France"), "ile de franke");
  assert.deepEqual(W.tokens("North East Aegean Islands"), ["nort", "east", "aegean"]);
});

// ---------- Rain in the next two hours ----------
function m15(start, values, snow) {
  const t0 = W.keyMin(start);
  const time = values.map((v, i) => {
    const d = new Date((t0 + i * 15) * 60000);
    return d.toISOString().slice(0, 16);
  });
  return { minutely_15: { time, precipitation: values, snowfall: snow || values.map(() => 0) } };
}

test("minutelySlots starts at the slot that holds now", () => {
  const d = m15("2026-10-14T09:45", [0.5, 0, 0, 0.2, 0.3, 0, 0, 0, 0, 0, 0]);
  const s = W.minutelySlots(d, "2026-10-14T10:07", 9);
  assert.equal(s[0].t, "2026-10-14T10:00");
  assert.equal(s.length, 9);
  assert.equal(W.minutelySlots({}, "2026-10-14T10:00"), null);
  assert.equal(W.minutelySlots({ minutely_15: { time: ["2026-10-14T10:00"], precipitation: [null] } }, "2026-10-14T10:00"), null);
});

test("nowcast + sentence: starts, stops, all, dry; EN and EL", () => {
  let s = W.minutelySlots(m15("2026-10-14T10:00", [0, 0, 0.3, 0.4, 0.2, 0, 0, 0, 0]), "2026-10-14T10:00");
  let nc = W.nowcast(s, "2026-10-14T10:00", 120);
  assert.deepEqual(nc, { state: "start", min: 30, rate: "light", snow: false });
  assert.equal(W.nowcastText(nc, "en", 120), "Light rain starts in ~30 min");
  assert.equal(W.nowcastText(nc, "el", 120), "Ασθενής βροχή σε ~30 λεπτά");
  // measured from now, not from the slot: 10:07 → 10:30 is ~25 min
  nc = W.nowcast(s, "2026-10-14T10:07", 120);
  assert.equal(nc.min, 23);
  assert.equal(W.nowcastText(nc, "en"), "Light rain starts in ~25 min");

  s = W.minutelySlots(m15("2026-10-14T10:00", [1, 1.5, 0.6, 0, 0, 0, 0, 0]), "2026-10-14T10:00");
  nc = W.nowcast(s, "2026-10-14T10:00", 120);
  assert.equal(nc.state, "stop");
  assert.equal(nc.rate, "moderate");
  assert.equal(W.nowcastText(nc, "en"), "Rain stops in ~45 min");
  assert.equal(W.nowcastText(nc, "el"), "Η βροχή σταματά σε ~45 λεπτά");

  s = W.minutelySlots(m15("2026-10-14T10:00", [3, 3, 3, 3, 3, 3, 3, 3]), "2026-10-14T10:00");
  nc = W.nowcast(s, "2026-10-14T10:00", 120);
  assert.equal(nc.state, "all");
  assert.equal(W.nowcastText(nc, "en", 120), "Heavy rain for the next 2 hours");
  assert.equal(W.nowcastText(nc, "el", 120), "Έντονη βροχή όλες τις επόμενες 2 ώρες");

  s = W.minutelySlots(m15("2026-10-14T10:00", [0, 0.05, 0, 0, 0, 0, 0, 0, 0.9]), "2026-10-14T10:00");
  nc = W.nowcast(s, "2026-10-14T10:00", 120);   // the 12:00 slot is beyond 2 hours
  assert.equal(nc.state, "dry");
  assert.equal(W.nowcastText(nc, "en", 120), "No rain in the next 2 hours");
  assert.equal(W.nowcastText(nc, "el", 120), "Χωρίς βροχή τις επόμενες 2 ώρες");

  s = W.minutelySlots(m15("2026-10-14T10:00", [0, 0, 0, 0, 0.3, 0.3, 0, 0], [0, 0, 0, 0, 0.2, 0.2, 0, 0]), "2026-10-14T10:00");
  nc = W.nowcast(s, "2026-10-14T10:00", 120);
  assert.equal(nc.snow, true);
  assert.equal(W.nowcastText(nc, "en"), "Snow starts in ~1 hour");
  assert.equal(W.nowcastText(nc, "el"), "Χιόνι σε ~1 ώρα");
  s = W.minutelySlots(m15("2026-10-14T10:00", [0, 0, 0, 0, 0, 0.3, 0.3, 0]), "2026-10-14T10:00");
  assert.equal(W.nowcastText(W.nowcast(s, "2026-10-14T10:00"), "en"), "Light rain starts in ~1 hour 15 min");
  assert.equal(W.nowcast(null, "2026-10-14T10:00"), null);
  assert.equal(W.nowcastText(null, "en"), "");
});

test("nowKey follows the city's offset", () => {
  assert.equal(W.nowKey(Date.parse("2026-10-14T10:07:30Z"), 3 * 3600), "2026-10-14T13:07");
  assert.equal(W.nowKey(Date.parse("2026-10-14T23:30:00Z"), -5 * 3600), "2026-10-14T18:30");
});

// ---------- Air quality + pollen ----------
function airResp(hours) {
  const h = { time: [] };
  W.AIR_VARS.forEach((v) => { h[v] = []; });
  hours.forEach((r) => {
    h.time.push(r.t);
    W.AIR_VARS.forEach((v) => h[v].push(r[v] === undefined ? null : r[v]));
  });
  return { hourly: h };
}

test("airHours + airDays: worst hour, main pollutant, pollen levels", () => {
  const d = airResp([
    { t: "2026-10-14T09:00", european_aqi: 90 },
    { t: "2026-10-14T10:00", european_aqi: 25, european_aqi_pm2_5: 25, european_aqi_pm10: 10, pm2_5: 12.4, olive_pollen: 20, grass_pollen: 3 },
    { t: "2026-10-14T11:00", european_aqi: 48, european_aqi_ozone: 48, european_aqi_pm2_5: 20, ozone: 110, olive_pollen: 120 },
    { t: "2026-10-15T00:00", european_aqi: 15, european_aqi_no2: 5, european_aqi_nitrogen_dioxide: 15, grass_pollen: 0 },
    { t: "2026-10-16T00:00", european_aqi: null }
  ]);
  const hours = W.airHours(d, "2026-10-14T10:00", 72);
  assert.equal(hours.length, 4);
  assert.equal(hours[0].a, 25);
  assert.equal(hours[0].c.pm25, 12.4);
  assert.deepEqual(hours[0].pol, { grass: 3, olive: 20 });
  const days = W.airDays(hours);
  assert.equal(days.length, 3);
  assert.equal(days[0].max, 48);
  assert.equal(days[0].at, "11:00");
  assert.equal(days[0].main, "o3");
  assert.equal(days[0].level, "moderate");
  assert.deepEqual(days[0].pollen.map((p) => [p.type, p.lvl]), [["olive", 3], ["grass", 1]]);
  assert.equal(days[1].main, "no2");
  assert.deepEqual(days[1].pollen, []);
  assert.deepEqual(days[1].pol, { grass: 0 });
  assert.equal(days[2].max, null);
  assert.equal(days[2].level, "");
  assert.equal(W.airHours({}, "2026-10-14T10:00"), null);
});

test("pollenLevel scales per plant group; aqiLevel bands", () => {
  assert.equal(W.pollenLevel("birch", 0), 0);
  assert.equal(W.pollenLevel("birch", 14), 1);
  assert.equal(W.pollenLevel("birch", 15), 2);
  assert.equal(W.pollenLevel("grass", 20), 3);
  assert.equal(W.pollenLevel("ragweed", 500), 4);
  assert.equal(W.aqiLevel(20), "good");
  assert.equal(W.aqiLevel(101), "epoor");
});

// ---------- Models ----------
test("models: ids are known; parseCompare reads suffixed columns", () => {
  assert.ok(W.okModel("best_match"));
  assert.ok(W.okModel("ecmwf_ifs025"));
  assert.ok(!W.okModel("evil"));
  const d = { daily: {
    time: ["2026-10-14", "2026-10-15"],
    temperature_2m_max_ecmwf_ifs025: [20, 21], temperature_2m_min_ecmwf_ifs025: [10, 11], precipitation_sum_ecmwf_ifs025: [0, 2.5],
    temperature_2m_max_gfs_seamless: [22, null], temperature_2m_min_gfs_seamless: [12, 13],
    temperature_2m_max_icon_seamless: [null, null], temperature_2m_min_icon_seamless: [null, null]
  } };
  const r = W.parseCompare(d, ["ecmwf_ifs025", "gfs_seamless", "icon_seamless"]);
  assert.deepEqual(r.dates, ["2026-10-14", "2026-10-15"]);
  assert.deepEqual(r.series.map((s) => s.model), ["ecmwf_ifs025", "gfs_seamless"]);   // no data → left out
  assert.deepEqual(r.series[0].rain, [0, 2.5]);
  assert.deepEqual(r.series[1].max, [22, null]);
  assert.deepEqual(r.series[1].rain, []);
  const one = W.parseCompare({ daily: { time: ["2026-10-14"], temperature_2m_max: [5], temperature_2m_min: [1] } }, ["gfs_seamless"]);
  assert.deepEqual(one.series[0].max, [5]);
  assert.equal(W.parseCompare({}, ["gfs_seamless"]), null);
});
