// App interop, everyday wave C: weather/days.js gives other apps the
// Weather app's cached forecast per date (read-only, never fetches);
// Travel shows it on each itinerary day; Calculator and Unit
// Converter send their result as text through the shell's Send to….
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const D = require(path.join(ROOT, "weather/days.js"));

const NOW = Date.UTC(2026, 9, 17, 9, 0);
const HOUR = 3600000;
const data = (extra) => Object.assign({
  units: "metric", active: "ath",
  cities: [
    { id: "ath", label: "Athens", lat: 37.98, lon: 23.73, pos: 0 },
    { id: "skg", label: "Thessaloniki", lat: 40.64, lon: 22.94, pos: 1 }
  ]
}, extra || {});
const cache = (at) => ({
  ath: { at: at, daily: [
    { date: "2026-10-17", code: 0, max: 24.4, min: 15.2, pop: 10 },
    { date: "2026-10-18", code: 61, max: 20, min: 14, pop: 70 }
  ] },
  skg: { at: at, daily: [
    { date: "2026-10-17", code: 3, max: 18, min: 9, pop: 0 },
    { date: "2026-10-19", code: 95, max: 17, min: 10 }
  ] }
});

test("days.js: no options reads the city near the shell's place, else the open city", () => {
  const near = D.compute(["2026-10-17"], data(), cache(NOW - HOUR), { lat: 40.6, lon: 22.95 }, null, NOW);
  assert.equal(near["2026-10-17"].city, "Thessaloniki");
  assert.equal(near["2026-10-17"].label, "18° / 9°");
  const far = D.compute(["2026-10-17"], data(), cache(NOW - HOUR), { lat: 51.5, lon: -0.1 }, null, NOW);
  assert.equal(far["2026-10-17"].city, "Athens", "no city near the place: the open one");
  const first = D.compute(["2026-10-17"], data({ active: null }), cache(NOW - HOUR), null, undefined, NOW);
  assert.equal(first["2026-10-17"].city, "Athens", "else the first by position");
});

test("days.js: a point picks the nearest saved city within 0.5°, else nothing", () => {
  const r = D.compute(["2026-10-17", "2026-10-18"], data(), cache(NOW - HOUR), null, { lat: 37.9, lon: 23.6 }, NOW);
  assert.deepEqual(Object.keys(r).sort(), ["2026-10-17", "2026-10-18"]);
  assert.deepEqual(r["2026-10-17"], { icon: "☀️", max: 24, min: 15, label: "24° / 15°", code: 0, pop: 10, city: "Athens" });
  assert.equal(r["2026-10-18"].icon, "🌧️");
  assert.deepEqual(D.compute(["2026-10-17"], data(), cache(NOW - HOUR), null, { lat: 45, lon: 10 }, NOW), {}, "too far");
  assert.deepEqual(D.compute(["2026-10-17"], data(), cache(NOW - HOUR), null, { lat: "x", lon: 1 }, NOW), {}, "bad point");
});

test("days.js: a cache older than 36 hours gives nothing", () => {
  assert.equal(Object.keys(D.compute(["2026-10-17"], data(), cache(NOW - 35 * HOUR), null, null, NOW)).length, 1);
  assert.deepEqual(D.compute(["2026-10-17"], data(), cache(NOW - 37 * HOUR), null, null, NOW), {});
  assert.deepEqual(D.compute(["2026-10-17"], data(), { ath: { daily: [] } }, null, null, NOW), {});
});

test("days.js: imperial converts at read time (the cache stays °C)", () => {
  const r = D.compute(["2026-10-17"], data({ units: "imperial" }), cache(NOW), null, null, NOW);
  assert.equal(r["2026-10-17"].max, 76);
  assert.equal(r["2026-10-17"].min, 59);
  assert.equal(r["2026-10-17"].label, "76° / 59°");
});

test("days.js: missing rows, bad rows and missing data give nothing for that date", () => {
  const c = cache(NOW);
  c.ath.daily.push({ date: "2026-10-20", code: 1, max: null, min: 5 });
  const r = D.compute(["2026-10-17", "2026-10-19", "2026-10-20", 5], data(), c, null, null, NOW);
  assert.deepEqual(Object.keys(r), ["2026-10-17"]);
  assert.deepEqual(D.compute(["2026-10-17"], data({ cities: [] }), c, null, null, NOW), {});
  assert.deepEqual(D.compute(["2026-10-17"], data(), null, null, null, NOW), {});
  assert.deepEqual(D.compute([], data(), c, null, null, NOW), {});
  assert.equal(typeof D.forDates, "function");
});

test("days.js stays read-only and offline", () => {
  const s = src("weather/days.js");
  assert.doesNotMatch(s, /fetch\(|XMLHttpRequest|setItem|removeItem/);
  assert.match(s, /root\.OrosWeatherDays = API/);
  assert.match(s, /module\.exports = API/);
});

test("Travel shows each day's forecast from the helper, with EN/EL labels and help", () => {
  const html = src("travel/index.html"), js = src("travel/travel.js");
  assert.match(html, /<script src="\.\.\/weather\/days\.js\?v=[\d.]+"><\/script>[\s\S]*travel\.js/);
  assert.match(js, /W\.forDates\(days, \{ lat: g\.lat, lon: g\.lon \}\)/);
  assert.match(js, /var g = trip\.geo;/);
  assert.ok(js.includes('"wx.day": "Forecast: {t}"'));
  assert.ok(js.includes('"wx.day": "Πρόγνωση: {t}"'));
  assert.match(src("travel/help.en.txt"), /Weather\]\(app:weather\) forecast/);
  assert.match(src("travel/help.el.txt"), /Καιρό\]\(app:weather\)/);
});

const SENDERS = {
  calculator: { js: "calculator/calculator.js", en: "Send to…", el: "Αποστολή σε…", title: 't("calc.title")' },
  units: { js: "units/units.js", en: "Send to…", el: "Αποστολή σε…", title: 't("app.name")' }
};

test("Calculator and Unit Converter send their result as text, only with the bridge", () => {
  for (const [app, c] of Object.entries(SENDERS)) {
    const s = src(c.js);
    assert.match(s, /window\.parent\.orosSend \? window\.parent\.orosSend : null/, app + " checks the bridge");
    assert.ok(s.includes('api.open({ kind: "text", data: { title: ' + c.title + ", text: "), app + " sends text");
    assert.ok(s.includes('"' + c.en + '"'), app + " EN label");
    assert.ok(s.includes('"' + c.el + '"'), app + " EL label");
    assert.match(s, /hidden = !sendApi\(\)/, app + " hides the button without the bridge");
    const at = s.indexOf("function sendApi");
    assert.doesNotMatch(s.slice(at, s.indexOf("api.open(", at)), /innerHTML\s*=\s*[^"'I]/, app + " builds no HTML from data");
    assert.match(src(app + "/help.en.txt"), /Send to…/, app + " help EN");
    assert.match(src(app + "/help.el.txt"), /Αποστολή σε…/, app + " help EL");
  }
  assert.match(src("calculator/index.html"), /id="calc-send"[^>]*hidden/);
  assert.match(src("units/index.html"), /id="copy"[^\n]*\n\s*<button type="button" id="send" class="icon-btn" hidden>/);
});

test("Calendar shows the cached forecast on its days", () => {
  const s = fs.readFileSync(path.join(__dirname, "..", "calendar/calendar.js"), "utf8");
  assert.match(fs.readFileSync(path.join(__dirname, "..", "calendar/index.html"), "utf8"), /<script src="\.\.\/weather\/days\.js\?v=[^"]+"><\/script>\s*<script src="calendar\.js/);
  assert.match(s, /window\.OrosWeatherDays\.forDates\(dates\)/);
  assert.ok(s.includes('"wx.day": "Forecast: {t}"') && s.includes('"wx.day": "Πρόγνωση: {t}"'));
});
