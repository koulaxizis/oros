// Night Light (nightlight.js, NIGHT-1): sun times, schedules, fades,
// the Quick settings tap, colours, and the wiring in the page, the
// shell, Quick settings, Settings, the strings and help.
"use strict";

process.env.TZ = "Europe/Athens";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const N = require(path.join(ROOT, "nightlight.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi || 0).getTime();
const ATHENS = { lat: 37.98, lon: 23.73, label: "Athens" };
const near = (ms, y, mo, d, h, mi, tolMin) =>
  assert.ok(Math.abs(ms - at(y, mo, d, h, mi)) <= (tolMin || 3) * 60000,
    new Date(ms).toString() + " vs " + new Date(at(y, mo, d, h, mi)).toString());

test("sun times: Athens in June, December and November (within 3 minutes)", () => {
  let s = N.sunTimes(at(2026, 6, 21, 10), ATHENS.lat, ATHENS.lon);
  near(s.rise, 2026, 6, 21, 6, 2); near(s.set, 2026, 6, 21, 20, 51);
  s = N.sunTimes(at(2026, 12, 21, 10), ATHENS.lat, ATHENS.lon);
  near(s.rise, 2026, 12, 21, 7, 37); near(s.set, 2026, 12, 21, 17, 9);
  // Any hour of the day gives that day's times.
  const late = N.sunTimes(at(2026, 12, 21, 23, 50), ATHENS.lat, ATHENS.lon);
  assert.equal(late.set, s.set);
});

test("sun times: polar day and polar night", () => {
  assert.deepEqual(N.sunTimes(at(2026, 6, 21, 12), 78.2, 15.6), { polar: "day" });
  assert.deepEqual(N.sunTimes(at(2026, 12, 21, 12), 78.2, 15.6), { polar: "night" });
  const p = { on: true, sched: "sun" };
  assert.equal(N.state(p, at(2026, 12, 21, 12), { lat: 78.2, lon: 15.6 }).level, 1);
  assert.equal(N.state(p, at(2026, 6, 21, 23), { lat: 78.2, lon: 15.6 }).level, 0);
});

test("normalize: defaults, bad values, same from/to", () => {
  assert.deepEqual(N.normalize(null), N.DEFAULTS);
  const o = N.normalize({ on: "yes", sched: "x", from: "25:00", to: "7:5", warmth: 400, hold: { until: "x" } });
  assert.equal(o.on, false); assert.equal(o.sched, "sun");
  assert.equal(o.from, "21:00"); assert.equal(o.to, "07:00");
  assert.equal(o.warmth, 100); assert.equal(o.hold, null);
  assert.notEqual(N.normalize({ from: "07:00", to: "07:00" }).to, "07:00");
  assert.equal(N.normalize({ from: "7:30" }).from, "07:30");
  assert.equal(N.halfHours().length, 48);
  assert.equal(N.halfHours()[47], "23:30");
});

test("own hours across midnight, with 20-minute fades", () => {
  const p = { on: true, sched: "times", from: "22:00", to: "06:30" };
  assert.equal(N.state(p, at(2026, 11, 15, 21, 59)).level, 0);
  assert.equal(N.state(p, at(2026, 11, 15, 22, 10)).level, 0.5);
  assert.equal(N.state(p, at(2026, 11, 15, 23, 0)).level, 1);
  assert.equal(N.state(p, at(2026, 11, 16, 3, 0)).level, 1);       // last night's
  assert.equal(N.state(p, at(2026, 11, 16, 6, 20)).level, 0.5);
  assert.equal(N.state(p, at(2026, 11, 16, 6, 30)).level, 0);
  assert.equal(N.state(p, at(2026, 11, 16, 3, 0)).until, at(2026, 11, 16, 6, 30));
  assert.equal(N.state(p, at(2026, 11, 16, 12, 0)).until, at(2026, 11, 16, 22, 0));
  // Same-day hours.
  const q = { on: true, sched: "times", from: "13:00", to: "15:00" };
  assert.equal(N.state(q, at(2026, 11, 16, 14, 0)).level, 1);
  assert.equal(N.state(q, at(2026, 11, 16, 16, 0)).level, 0);
});

test("off, always, and sunset without a place (20:00-07:00)", () => {
  assert.equal(N.state({ on: false, sched: "always" }, at(2026, 11, 15, 23)).level, 0);
  assert.equal(N.state({ on: true, sched: "always" }, at(2026, 11, 15, 12)).level, 1);
  const p = { on: true, sched: "sun" };
  assert.equal(N.state(p, at(2026, 11, 15, 19, 0), null).level, 0);
  assert.equal(N.state(p, at(2026, 11, 15, 21, 0), null).level, 1);
  assert.equal(N.state(p, at(2026, 11, 16, 6, 0), null).level, 1);
  // With Athens: warm by 17:40 (sunset 17:14), not at 16:00.
  assert.equal(N.state(p, at(2026, 11, 15, 17, 40), ATHENS).level, 1);
  assert.equal(N.state(p, at(2026, 11, 15, 16, 0), ATHENS).level, 0);
});

test("Quick settings tap: off until next evening, on now until morning, always", () => {
  const night = at(2026, 11, 15, 23, 0), noon = at(2026, 11, 16, 13, 0);
  const p = { on: true, sched: "sun" };
  const off = N.toggled(p, night, ATHENS);
  let st = N.state(off, night, ATHENS);
  assert.equal(st.level, 0);
  assert.ok(st.held);
  near(st.until, 2026, 11, 16, 17, 13);                             // back at the next sunset
  assert.equal(N.state(off, at(2026, 11, 16, 18, 0), ATHENS).level, 1);
  const back = N.toggled(off, night, ATHENS);
  assert.equal(N.state(back, night, ATHENS).level, 1);
  assert.equal(back.hold, null);

  const on = N.toggled({ on: false, sched: "sun" }, noon, ATHENS);
  assert.equal(on.on, true);
  st = N.state(on, noon, ATHENS);
  assert.equal(st.level, 1);
  near(st.until, 2026, 11, 17, 7, 7);                               // until the next sunrise
  const off2 = N.toggled(on, noon, ATHENS);
  assert.equal(N.state(off2, noon, ATHENS).level, 0);

  const a = N.toggled({ on: true, sched: "always" }, noon);
  assert.equal(a.on, false);
  assert.equal(N.toggled(a, noon).on, true);
});

test("colours: warmth to kelvin, kelvin to the white point", () => {
  assert.equal(N.kelvin(50, 0), 6500);
  assert.equal(N.kelvin(0, 1), 5500);
  assert.equal(N.kelvin(100, 1), 2700);
  assert.equal(N.kelvin(50, 1), 4100);
  assert.deepEqual(N.whiteOf(6500), [255, 255, 255]);
  const w = N.whiteOf(2700);
  assert.equal(w[0], 255);
  assert.ok(w[1] > w[2] && w[2] < 120, String(w));
  const m = N.whiteOf(4100);
  assert.ok(m[1] > w[1] && m[2] > w[2], "4100 K is less warm than 2700 K");
});

test("wiring: page order, shell attach, Settings bridge, Quick settings", () => {
  const html = read("index.html");
  const q = html.indexOf('src="qsettings.js?v='), n = html.indexOf('src="nightlight.js?v='), s = html.indexOf('src="shell.js?v=');
  assert.ok(q > 0 && q < n && n < s, "nightlight.js loads after qsettings.js, before shell.js");
  assert.match(html, /<link rel="preload" as="script" href="nightlight\.js\?v=/);
  const sh = read("shell.js");
  assert.match(sh, /window\.orosNight\.attach\(\{ loc: wxLoc \}\);/);
  assert.match(sh, /night: window\.orosNight \? window\.orosNight\.snapshot\(\) : null,/);
  assert.match(sh, /if \(\/\^night:\/\.test\(name\)\) \{/);
  const qs = read("qsettings.js");
  assert.match(qs, /root\.orosNight\.toggleNow\(\)/);
  assert.match(qs, /\{ section: "appearance", item: "night" \}/);
  const C = require(path.join(ROOT, "settings/core.js"));
  assert.equal(C.scopeOf("night"), "device");
  assert.ok(read("settings/core.js").includes('["night", "appearance", "nl.on", "nl.title", null, "night"]'));
  assert.match(read("settings/settings.js"), /if \(s\.night\) secNight\(host, s\.night\);/);
});

test("the extension's part: data-oros-sys-night and the oros-night event", () => {
  const src = read("nightlight.js");
  assert.match(src, /getAttribute\("data-oros-sys-night"\) === "1"/);
  assert.match(src, /new CustomEvent\("oros-night", \{ detail: String\(k\) \}\)/);
  assert.match(src, /pointerEvents = "none"/);
  assert.match(src, /mixBlendMode = "multiply"/);
});

test("strings: nl.* in Settings EN, EL, DE; qs.night* in the shell; help", () => {
  const src = read("settings/settings.js") + read("settings/core.js");
  const keys = new Set((src.match(/"nl\.[a-z.]+"/g) || []).map((k) => k.slice(1, -1)));
  ["nl.sched.sun", "nl.sched.times", "nl.sched.always", "nl.sun.polarday", "nl.sun.polarnight"].forEach((k) => keys.add(k));
  const core = read("settings/core.js");
  const en = core.slice(0, core.indexOf("\n    el: {"));
  const el = core.slice(core.indexOf("\n    el: {"));
  const de = read("i18n/de/settings.js");
  for (const k of keys) {
    if (k.endsWith(".")) continue;
    assert.ok(en.includes('"' + k + '":'), "EN " + k);
    assert.ok(el.includes('"' + k + '":'), "EL " + k);
    assert.ok(de.includes('"' + k + '":'), "DE " + k);
  }
  for (const k of ["w.night", "w.night-when", "w.night-warmth"]) {
    assert.ok(en.includes('"' + k + '":') && el.includes('"' + k + '":') && de.includes('"' + k + '":'), k);
  }
  const tr = read("translations.js"), sde = read("i18n/de/shell.js");
  for (const k of ["qs.night", "qs.night.more", "qs.night.until", "qs.night.from"]) {
    assert.equal(tr.split('"' + k + '":').length, 3, "EN+EL " + k);
    assert.ok(sde.includes('"' + k + '":'), "DE " + k);
  }
  assert.match(read("help/topics/appearance.en.txt"), /^## Night Light$/m);
  assert.match(read("help/topics/appearance.el.txt"), /^## Νυχτερινός φωτισμός$/m);
  assert.match(read("i18n/de/help/topics/appearance.txt"), /^## Nachtlicht$/m);
});
