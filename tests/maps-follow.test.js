// Hiking and cycling, wave H4 (maps/follow-core.js): following a track
// either way round, where you are on an out-and-back, the climb left,
// off / back with hysteresis, waypoints told once, time left, sunset.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const F = require(path.join(__dirname, "..", "maps", "follow-core.js"));
const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

// 1.1 km north, 100 m → 300 m, a point every ~22 m
const line = [];
for (let i = 0; i <= 50; i++) line.push([37.98 + i * 0.0002, 23.72, 100 + i * 4, null]);
const wpts = [{ lat: 37.985, lon: 23.7201, name: "Spring" }, { lat: 37.989, lon: 23.72, name: "Chapel" }, { lat: 38.1, lon: 23.72, name: "Far" }];

test("prepare: metres along, climb so far, waypoints on the line", () => {
  const f = F.prepare([line], wpts, false);
  assert.ok(Math.abs(f.total - 1112) < 3, f.total);
  assert.equal(f.up, 200);
  assert.equal(f.down, 0);
  assert.equal(f.ele, true);
  assert.deepEqual(f.wpts.map(w => w.name), ["Spring", "Chapel"], "a waypoint far from the line is left out");
  assert.ok(Math.abs(f.wpts[0].along - 556) < 3);
  assert.equal(f.moving, 0, "no times: no speed");
  const r = F.prepare([line], wpts, true);
  assert.equal(r.up, 0);
  assert.equal(r.down, 200);
  assert.deepEqual(r.wpts.map(w => w.name), ["Chapel", "Spring"]);
  assert.equal(F.prepare([[line[0]]], [], false), null);
});

test("climb left and time left", () => {
  const f = F.prepare([line], [], false);
  const half = F.remaining(f, 556);
  assert.ok(Math.abs(half.left - 556) < 3);
  assert.ok(half.up >= 96 && half.up <= 104, half.up);
  assert.equal(F.remaining(f, 5000).left, 0);
  // DIN: 1.1 km and 200 m up → 0.28 h vs 0.67 h → 0.67 + 0.14 h
  const s = F.eta({ left: 1112, up: 200, down: 0 }, 0);
  assert.ok(Math.abs(s - Math.round((200 / 300 + 1112 / 4000 / 2) * 3600)) <= 1);
  assert.equal(F.eta({ left: 1000, up: 0, down: 0 }, 2), 500, "the track's own speed");
  assert.equal(F.eta({ left: 0 }, 0), 0);
});

test("out and back: the nearer candidate to where you were wins", () => {
  const out = line.map(p => p.slice()), back = line.slice(0, -1).reverse().map(p => [p[0], p[1] + 0.00002, p[2], null]);
  const f = F.prepare([out.concat(back)], [], false);
  const fix = { lat: 37.985, lon: 23.72001 };
  assert.ok(F.locate(f, fix, null).along < 600, "no history: the first pass");
  assert.ok(F.locate(f, fix, 1600).along > 1600, "coming back: the second pass");
});

test("off the track: two fixes to say off, 25 m to say back, worse GPS widens it", () => {
  const st = { off: false, n: 0 };
  assert.equal(F.offTrack(st, 60, 5), "");
  assert.equal(F.offTrack(st, 60, 5), "off");
  assert.equal(F.offTrack(st, 60, 5), "");
  assert.equal(F.offTrack(st, 30, 5), "", "between 25 m and the limit: still off");
  assert.equal(F.offTrack(st, 10, 5), "back");
  const st2 = { off: false, n: 0 };
  F.offTrack(st2, 60, 60); assert.equal(F.offTrack(st2, 60, 60), "", "60 m accuracy: limit 70 m");
  F.offTrack(st2, 80, 5); assert.equal(st2.n, 1); F.offTrack(st2, 30, 5); assert.equal(st2.n, 0, "a near fix resets the count");
});

test("waypoints: told once within 100 m, the next one ahead", () => {
  const f = F.prepare([line], wpts, false), told = {};
  assert.equal(F.nextWpt(f, 100, told), null);
  const a = F.nextWpt(f, 480, told);
  assert.equal(a.w.name, "Spring");
  assert.ok(a.dist >= 70 && a.dist <= 80, a.dist);
  assert.equal(F.nextWpt(f, 500, told), null, "told once");
  assert.equal(F.ahead(f, 600).w.name, "Chapel");
  assert.equal(F.ahead(f, 1100), null);
});

test("sunrise and sunset", () => {
  const s = F.sunTimes(new Date("2026-06-21T09:00:00Z"), 37.98, 23.73);
  // Athens, midsummer: about 06:02 and 20:51 local (03:02 and 17:51 UTC)
  assert.ok(Math.abs(s.rise - Date.parse("2026-06-21T03:02:00Z")) < 5 * 60000, s.rise.toISOString());
  assert.ok(Math.abs(s.set - Date.parse("2026-06-21T17:51:00Z")) < 5 * 60000, s.set.toISOString());
  const w = F.sunTimes(new Date("2026-12-21T15:00:00Z"), 37.98, 23.73);
  assert.ok(Math.abs(w.set - Date.parse("2026-12-21T15:09:00Z")) < 5 * 60000, w.set.toISOString());
  assert.equal(F.sunTimes(new Date("2026-06-21T12:00:00Z"), 78, 15).polar, "day");
  assert.equal(F.sunTimes(new Date("2026-12-21T12:00:00Z"), 78, 15).polar, "night");
  assert.equal(F.sunTimes("x", 1, 2), null);
});

test("wiring: follow-core before tracks, alerts, voice hook, strings", () => {
  const html = read("maps/index.html");
  assert.ok(html.indexOf("follow-core.js") < html.indexOf('src="tracks.js'));
  const ui = read("maps/tracks.js");
  assert.match(ui, /FC\.prepare\(/);
  assert.match(ui, /navigator\.vibrate/);
  assert.match(ui, /oros-maps-follow/);
  assert.match(read("maps/maps.js"), /speak: function \(text\) \{[\s\S]{0,200}return speak\(String\(text \|\| ""\)\.slice\(0, 200\), true\);/);
  const vm = require("vm");
  const m = ui.match(/var STR = (\{[\s\S]*?\n  \});/);
  const STR = vm.runInNewContext("(" + m[1] + ")", {});
  const fw = Object.keys(STR.en).filter(k => /^trk\.fw\./.test(k));
  assert.ok(fw.length >= 15);
  const de = read("i18n/de/maps.js");
  fw.forEach(k => { assert.ok(STR.el[k], "el " + k); assert.ok(de.indexOf('"' + k + '"') >= 0, "de " + k); });
  assert.match(read("maps/help.en.txt"), /Follow the other way/);
  assert.match(read("maps/help.el.txt"), /Ακολούθησε αντίστροφα/);
  assert.match(read("i18n/de/help/maps.txt"), /In Gegenrichtung folgen/);
});
