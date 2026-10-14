// Podcasts wave 42: skip silence + voice boost decisions (podcasts/core.js
// section 14) and the forward-compatible prefs of the slice.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "podcasts/core.js")).OrosPodcastsCore;
const J = (x) => JSON.stringify(x);

test("rms and allZero", () => {
  assert.equal(C.rms(new Float32Array(0)), 0);
  assert.equal(C.rms(new Float32Array([0.5, -0.5, 0.5, -0.5])), 0.5);
  assert.equal(C.allZero(new Float32Array(8)), true);
  assert.equal(C.allZero(new Float32Array([0, 0, 1e-7])), false);
});

test("silence detector: quiet for 250 ms turns on, loud turns off at once, hysteresis", () => {
  let st = null;
  st = C.silenceStep(st, 0.001, 100);
  assert.deepEqual(st, { q: 100, silent: false });
  st = C.silenceStep(st, 0.001, 100);
  assert.equal(st.silent, false);
  st = C.silenceStep(st, 0.001, 100);
  assert.equal(st.silent, true, "300 ms of quiet");
  st = C.silenceStep(st, 0.015, 100);
  assert.equal(st.silent, true, "between the two thresholds: still silent (hysteresis)");
  st = C.silenceStep(st, 0.3, 100);
  assert.deepEqual(st, { q: 0, silent: false }, "speech: normal speed at once");
  st = C.silenceStep(st, 0.001, 200);
  st = C.silenceStep(st, 0.2, 100);
  assert.deepEqual(st, { q: 0, silent: false }, "a short pause never speeds up");
  assert.equal(C.silenceStep(null, 0, 5000).q, 1000, "a long gap between ticks counts at most 1 s");
});

test("silence speed: 3x the listening speed, between 2.5x and 4x; saved time", () => {
  assert.equal(C.silenceRate(1), 3);
  assert.equal(C.silenceRate(0.5), 2.5);
  assert.equal(C.silenceRate(2), 4);
  assert.equal(C.silenceRate(0), 3);
  // 10 s of wall time at 3x instead of 1x: 30 s of media, 20 s saved.
  assert.equal(C.silenceSaved(10, 1, 3), 20);
  assert.equal(C.silenceSaved(10, 2, 4), 10);
  assert.equal(C.silenceSaved(10, 3, 3), 0);
  assert.equal(C.silenceSaved(-1, 1, 3), 0);
});

test("statistics: saved silence lives in the third column, addListen keeps it", () => {
  const day = Date.UTC(2026, 9, 14, 12);
  let st = C.addSaved(null, day, 12.5);
  st = C.addListen(st, day, "s" + "a".repeat(12), 10, 1.5);
  st = C.addSaved(st, day, 2.5);
  st = C.addSaved(st, day, 500);                 // nonsense step ignored
  const k = C.dayKey(day);
  assert.deepEqual(st.d[k], [10, 15, 15]);
  const sm = C.statsSummary(st, day);
  assert.deepEqual(sm.all, { wall: 10, media: 15, saved: 5, silence: 15 });
  // Old rows (two columns) still read.
  assert.deepEqual(C.statsSummary({ d: { [k]: [60, 60] }, s: {} }, day).all.silence, 0);
});

test("CORS route: downloads always, probed hosts by cache, a day long", () => {
  const page = "https://oros.example";
  assert.equal(C.mediaOrigin("blob:https://oros.example/123", page), "local");
  assert.equal(C.mediaOrigin("https://oros.example/a.mp3", page), "same");
  assert.equal(C.mediaOrigin("https://cdn.example.com/x/a.mp3?t=1", page), "https://cdn.example.com");
  assert.equal(C.mediaOrigin("javascript:alert(1)", page), "");
  assert.equal(C.mediaOrigin("", page), "");
  const now = 1e12;
  assert.equal(C.fxRoute("local", {}, now), "yes");
  assert.equal(C.fxRoute("same", {}, now), "yes");
  assert.equal(C.fxRoute("", {}, now), "no");
  assert.equal(C.fxRoute("https://a.example", {}, now), "probe");
  let cache = C.fxRemember({}, "https://a.example", true, now);
  cache = C.fxRemember(cache, "https://b.example", false, now);
  cache = C.fxRemember(cache, "local", true, now);
  assert.deepEqual(Object.keys(cache).sort(), ["https://a.example", "https://b.example"]);
  assert.equal(C.fxRoute("https://a.example", cache, now + 1000), "yes");
  assert.equal(C.fxRoute("https://b.example", cache, now + 1000), "no");
  assert.equal(C.fxRoute("https://a.example", cache, now + 86400001), "probe", "asked again after a day");
  // At most 60 hosts, newest kept; junk rows dropped.
  let big = { junk: "x", old: [1, now - 2 * 86400000] };
  for (let i = 0; i < 70; i++) big = C.fxRemember(big, "https://h" + i + ".example", true, now + i);
  assert.equal(Object.keys(big).length, 60);
  assert.ok(big["https://h69.example"] && !big["https://h0.example"] && !big.junk && !big.old);
});

test("zero watchdog: counts only exact zeros while playing", () => {
  let z = 0;
  z = C.zeroWatch(z, true, true, 100);
  z = C.zeroWatch(z, true, true, 5000);
  assert.equal(z, 1100);
  assert.equal(C.zeroWatch(z, true, false, 100), 1100, "paused/buffering: unchanged");
  assert.equal(C.zeroWatch(z, false, true, 100), 0, "any sound resets it");
});

test("prefs: skip silence + voice boost sync LWW like the others; old data still loads", () => {
  let d = C.emptyData();
  d = C.setPref(d, "sil", 1, 10);
  d = C.setPref(d, "vb", 1, 11);
  assert.equal(C.prefOf(d, "sil"), 1);
  assert.equal(C.prefOf(C.emptyData(), "vb"), 0, "off by default");
  assert.equal(C.setPref(d, "sil", 2, 12), d, "bad value: unchanged");
  const other = C.setPref(C.emptyData(), "sil", 0, 20);
  const m1 = C.mergePodcasts(d, other), m2 = C.mergePodcasts(other, d);
  assert.equal(J(m1), J(m2), "symmetric");
  assert.deepEqual(m1.prefs, { sil: [0, 20], vb: [1, 11] });
  assert.equal(J(C.mergePodcasts(m1, null)), J(m1), "canonical: no re-upload loop");
});

test("prefs: keys from a newer version survive an older merge, bounded", () => {
  const prefs = {};
  for (let i = 0; i < 30; i++) prefs["k" + String(i).padStart(2, "0")] = [i, 1];
  prefs.text = ["x".repeat(101), 1];
  const m = C.mergePodcasts({ prefs }, { prefs: { k00: [5, 2] } });
  assert.equal(Object.keys(m.prefs).length, 20, "at most 20 foreign keys");
  assert.deepEqual(m.prefs.k00, [5, 2], "LWW per key");
  assert.equal(m.prefs.text, undefined, "long strings dropped");
});

test("prefs: two devices with different foreign keys still merge to a canonical, capped set", () => {
  const a = {}, b = {};
  for (let i = 0; i < 20; i++) { a["a" + String(i).padStart(2, "0")] = [1, 1]; b["b" + String(i).padStart(2, "0")] = [1, 1]; }
  const m = C.mergePodcasts({ prefs: a }, { prefs: Object.assign({ spd: [1.5, 3] }, b) });
  assert.equal(Object.keys(m.prefs).length, 21, "20 foreign keys + spd");
  assert.equal(J(C.mergePodcasts(m, null)), J(m), "a second pass changes nothing");
  assert.equal(J(C.mergePodcasts({ prefs: b }, { prefs: a })), J(C.mergePodcasts({ prefs: a }, { prefs: b })));
});
