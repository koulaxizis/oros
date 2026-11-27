// CZ-1: Calendar time zones side by side (calendar/zones.js) — the
// "calzones" slice merge, the World clock reader, the hour columns,
// and the wiring in calendar.js / index.html / help / German pack.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const Z = require("../calendar/zones.js");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("sanitize: at most 3 places, valid zones only, no zone twice, city cleaned", () => {
  const d = Z.sanitize({ mtime: 5, zones: [
    { tz: "Europe/London", city: "London" }, { tz: "Not/AZone" }, { tz: "Europe/London", city: "Again" },
    { tz: "Asia/Tokyo", city: "  Tokyo\u0007 " }, { tz: "UTC" }, { tz: "America/New_York" }, "x", null
  ] });
  assert.deepStrictEqual(d, { zones: [{ tz: "Europe/London", city: "London" }, { tz: "Asia/Tokyo", city: "Tokyo" }, { tz: "UTC" }], mtime: 5 });
  assert.deepStrictEqual(Z.sanitize(null), { zones: [], mtime: 0 });
  assert.deepStrictEqual(Z.sanitize({ zones: "x", mtime: -3 }), { zones: [], mtime: 0 });
});

test("merge: newer wins, a tie is the same on every device, merge(x, null) is canonical", () => {
  const a = { zones: [{ tz: "Asia/Tokyo" }], mtime: 10 };
  const b = { zones: [{ tz: "Europe/London" }], mtime: 20 };
  assert.deepStrictEqual(Z.merge(a, b), Z.sanitize(b));
  assert.deepStrictEqual(Z.merge(b, a), Z.sanitize(b));
  const c = { zones: [{ tz: "Europe/Paris" }], mtime: 20 };
  assert.deepStrictEqual(Z.merge(b, c), Z.merge(c, b));
  // An emptied list (newer) wins over an older full one: removing sticks.
  assert.deepStrictEqual(Z.merge(b, { zones: [], mtime: 30 }), { zones: [], mtime: 30 });
  const once = Z.merge({ mtime: 7, zones: [{ city: " Tokyo ", tz: "Asia/Tokyo" }] }, null);
  assert.strictEqual(JSON.stringify(Z.merge(once, null)), JSON.stringify(once));
  assert.strictEqual(JSON.stringify(Z.merge(once, once)), JSON.stringify(once));
});

test("setZones stamps the change and keeps the limit", () => {
  const d = Z.setZones([{ tz: "UTC" }, { tz: "Asia/Tokyo" }, { tz: "Europe/London" }, { tz: "Europe/Paris" }], 1234);
  assert.strictEqual(d.mtime, 1234);
  assert.strictEqual(d.zones.length, Z.MAX);
});

test("worldClock reads the Time app's rows (objects and old strings), in order", () => {
  const wc = Z.worldClock({ zones: [{ tz: "Asia/Tokyo", mtime: 1 }, "Europe/London", { tz: "Bad/Zone" },
    { tz: "America/New_York", city: "New York", mtime: 2 }, { tz: "Asia/Tokyo" }] });
  assert.deepStrictEqual(wc, [{ tz: "Asia/Tokyo" }, { tz: "Europe/London" }, { tz: "America/New_York", city: "New York" }]);
  assert.deepStrictEqual(Z.worldClock(null), []);
  assert.deepStrictEqual(Z.worldClock({ zones: 3 }), []);
});

test("hourCells: the 24 local hours read in another zone, with the day difference", () => {
  const day = "2026-11-27";
  const cells = Z.hourCells(day, "UTC");
  assert.strictEqual(cells.length, 24);
  for (let h = 0; h < 24; h++) {
    const d = new Date(2026, 10, 27, h, 0, 0, 0);
    const hm = String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
    const dd = Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(2026, 10, 27)) / 86400000);
    assert.deepStrictEqual(cells[h], { hm, dd }, "hour " + h);
  }
  // Half-hour zone: minutes are kept.
  const ind = Z.hourCells(day, "Asia/Kolkata");
  const offMin = -new Date(2026, 10, 27, 0).getTimezoneOffset();
  if (offMin % 60 === 0) assert.ok(ind.every((c) => c.hm.endsWith(":30")));
  // The device's own zone reads the same hours.
  let local = "UTC";
  try { local = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) {}
  Z.hourCells(day, local).forEach((c, h) => assert.deepStrictEqual(c, { hm: String(h).padStart(2, "0") + ":00", dd: 0 }));
});

test("offsetMin / diffLabel / atLocal", () => {
  const now = Date.UTC(2026, 10, 27, 12, 0);
  const local = -new Date(now).getTimezoneOffset();
  assert.strictEqual(Z.offsetMin("UTC", now), -local);
  assert.strictEqual(Z.diffLabel(0), "0");
  assert.strictEqual(Z.diffLabel(120), "+2");
  assert.strictEqual(Z.diffLabel(-420), "−7");
  assert.strictEqual(Z.diffLabel(330), "+5:30");
  const a = Z.atLocal("2026-11-27", "09:15", "UTC");
  const d = new Date(2026, 10, 27, 9, 15);
  assert.strictEqual(a.hm, String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0"));
});

test("shortName: short heads for the Day view columns", () => {
  assert.strictEqual(Z.shortName("London"), "London");
  assert.strictEqual(Z.shortName("New York"), "NY");
  assert.strictEqual(Z.shortName("Los Angeles"), "LA");
  assert.strictEqual(Z.shortName("Νέα Υόρκη"), "ΝΥ");
  assert.strictEqual(Z.shortName("Johannesburg"), "Johann.");
  assert.strictEqual(Z.shortName("UTC"), "UTC");
});

test("wiring: script, menu, dialog, own slice, Day/Week views", () => {
  const html = read("calendar/index.html");
  assert.ok(html.indexOf('src="zones.js') > 0 && html.indexOf('src="zones.js') < html.indexOf('src="calendar.js'));
  assert.match(html, /id="mm-zones"/);
  assert.match(html, /<dialog id="zn-dlg"/);
  assert.match(html, /id="wk-zones"/);
  const js = read("calendar/calendar.js");
  assert.match(js, /registerSlice\(ZN\.SLICE,/);
  assert.strictEqual(Z.SLICE, "calzones");
  assert.strictEqual(Z.KEY, "oros-calendar-zones");
  assert.match(js, /localStorage\.getItem\("oros-time-data"/, "reads the Time app's World clock");
  assert.doesNotMatch(js.slice(js.indexOf("4b2z."), js.indexOf("4b2z.") + 12000), /setItem\("oros-time-data"/, "never writes the Time app's data");
  assert.match(js, /znHourLabels\(line, day, h, znCells\)/);
  assert.match(js, /renderWeekZones\(\);/);
  // The pull-fed setter never marks dirty.
  const reg = js.slice(js.indexOf("registerSlice(ZN.SLICE"), js.indexOf("ZN.KEY, ZN.merge);"));
  assert.doesNotMatch(reg, /dirty\(/);
  // innerHTML is not used for names (they come from synced data).
  const sec = js.slice(js.indexOf("4b2z."), js.indexOf("function openZonesDlg"));
  assert.doesNotMatch(sec, /innerHTML/);
});

test("strings: EN, EL and DE for every zn.* key; help in EN and EL", () => {
  const js = read("calendar/calendar.js");
  const at = js.indexOf('"mm.zones"');
  const enStart = js.lastIndexOf("en: {", at), elStart = js.indexOf("el: {", at);
  const en = js.slice(enStart, elStart);
  const el = js.slice(elStart, js.indexOf("en: {", elStart) > 0 ? js.indexOf("en: {", elStart) : undefined);
  const de = read("i18n/de/calendar.js");
  const keys = (en.match(/"(zn\.[a-z]+|mm\.zones)"/g) || []).map((k) => k.slice(1, -1));
  assert.ok(keys.length >= 12, "keys " + keys.join(","));
  keys.forEach((k) => {
    assert.ok(el.indexOf('"' + k + '"') >= 0, "el " + k);
    assert.ok(de.indexOf('"' + k + '"') >= 0, "de " + k);
  });
  assert.match(read("calendar/help.en.txt"), /World clock/);
  assert.match(read("calendar/help.el.txt"), /Παγκόσμια ώρα/);
});
