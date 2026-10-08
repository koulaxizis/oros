// Pure logic of the Sound Mixer: mix normalization, ready mixes, the
// saved-mix merge (sync slice "mixer"), level and sleep-timer math.
// Run: node --test tests/
//
// The app is a browser IIFE with no exports, so the constants and
// sections 2–3 are cut out of the source and evaluated on their own.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "mixer/mixer.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const MX = new Function(
  block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  function cmpStr(", "  function newId(") +
  block("  // ---------- 2. Mix model", "  // ---------- 4. Storage") +
  "\nreturn { CHANNELS, NOISE_COLORS, FADE_MS, PRESETS, PRESET_IDS, normMix, mixOf, sameMix, anyOn," +
  " levelGain, fadeFactor, fmtClock, normSaved, mergeMixer };")();

const ID = "abc123def";
function saved(id, m, name, levels) { return { id, m, name, mix: MX.mixOf(levels || { rain: 50 }) }; }
function data(mixes, tombs) { return { ver: 1, mixes: mixes || [], tombs: tombs || {} }; }

test("normMix fills every channel in order and clamps", () => {
  const m = MX.normMix({ ch: { rain: { o: true, v: 140 }, wind: { o: 1, v: -5 }, bogus: { o: 1, v: 3 } }, nc: "green" });
  assert.deepEqual(Object.keys(m.ch), MX.CHANNELS);
  assert.deepEqual(m.ch.rain, { o: 1, v: 100 });
  assert.deepEqual(m.ch.wind, { o: 1, v: 0 });
  assert.deepEqual(m.ch.birds, { o: 0, v: 50 });
  assert.equal(m.nc, "pink");
  assert.deepEqual(MX.normMix(m), m);                       // idempotent
  assert.deepEqual(MX.normMix(null), MX.normMix({}));
  assert.equal(MX.anyOn(MX.normMix(null)), false);
});

test("ready mixes are valid, distinct and each has a sound on", () => {
  assert.equal(MX.PRESET_IDS.length, 6);
  MX.PRESET_IDS.forEach((id) => {
    const p = MX.PRESETS[id];
    assert.deepEqual(MX.normMix(p), p, id);
    assert.ok(MX.anyOn(p), id);
  });
  for (let i = 0; i < MX.PRESET_IDS.length; i++)
    for (let j = i + 1; j < MX.PRESET_IDS.length; j++)
      assert.ok(!MX.sameMix(MX.PRESETS[MX.PRESET_IDS[i]], MX.PRESETS[MX.PRESET_IDS[j]]));
  assert.equal(MX.PRESETS.focus.nc, "brown");
});

test("sameMix compares normalized mixes", () => {
  const a = MX.mixOf({ rain: 60 });
  assert.ok(MX.sameMix(a, { ch: { rain: { o: 1, v: 60 } } }));
  assert.ok(!MX.sameMix(a, MX.mixOf({ rain: 61 })));
  assert.ok(!MX.sameMix(MX.mixOf({ noise: 40 }, "white"), MX.mixOf({ noise: 40 }, "brown")));
});

test("levelGain is squared and clamped", () => {
  assert.equal(MX.levelGain(0), 0);
  assert.equal(MX.levelGain(100), 1);
  assert.equal(MX.levelGain(50), 0.25);
  assert.equal(MX.levelGain(250), 1);
  assert.equal(MX.levelGain(NaN), 0);
});

test("fadeFactor holds at 1, then fades linearly over the last 30 s", () => {
  assert.equal(MX.FADE_MS, 30000);
  assert.equal(MX.fadeFactor(60 * 60000), 1);
  assert.equal(MX.fadeFactor(30000), 1);
  assert.equal(MX.fadeFactor(15000), 0.5);
  assert.equal(MX.fadeFactor(0), 0);
  assert.equal(MX.fadeFactor(-5), 0);
  assert.equal(MX.fadeFactor(NaN), 0);
});

test("fmtClock rounds up and shows hours only when needed", () => {
  assert.equal(MX.fmtClock(0), "0:00");
  assert.equal(MX.fmtClock(1), "0:01");
  assert.equal(MX.fmtClock(59001), "1:00");
  assert.equal(MX.fmtClock(15 * 60000), "15:00");
  assert.equal(MX.fmtClock(90 * 60000), "1:30:00");
  assert.equal(MX.fmtClock(-100), "0:00");
});

test("normSaved drops bad rows and trims names", () => {
  assert.equal(MX.normSaved({ id: "x", m: 1, name: "a" }), null);         // short id
  assert.equal(MX.normSaved({ id: ID, m: 1.5, name: "a" }), null);
  assert.equal(MX.normSaved({ id: ID, m: 1, name: "   " }), null);
  const x = MX.normSaved({ id: ID, m: 1, name: "  Late   night  " + "x".repeat(60), mix: null });
  assert.equal(x.name.length, 40);
  assert.ok(x.name.startsWith("Late night x"));
  assert.deepEqual(x.mix, MX.normMix(null));
});

test("mergeMixer: symmetric, associative, idempotent, canonical, inputs untouched", () => {
  const A = data([saved("aaaaaa1", 10, "One"), saved("bbbbbb2", 20, "Two")]);
  const B = data([saved("aaaaaa1", 15, "One renamed"), saved("cccccc3", 5, "Three")], { bbbbbb2: 19 });
  const C = data([saved("dddddd4", 7, "Four")], { cccccc3: 6 });
  const snapA = JSON.stringify(A), snapB = JSON.stringify(B);
  const ab = MX.mergeMixer(A, B);
  assert.deepEqual(ab, MX.mergeMixer(B, A));
  assert.deepEqual(MX.mergeMixer(MX.mergeMixer(A, B), C), MX.mergeMixer(A, MX.mergeMixer(B, C)));
  assert.deepEqual(MX.mergeMixer(ab, ab), ab);
  assert.equal(JSON.stringify(A), snapA);
  assert.equal(JSON.stringify(B), snapB);
  assert.deepEqual(ab.mixes.map((x) => x.id), ["aaaaaa1", "bbbbbb2", "cccccc3"]);   // sorted by id
  assert.equal(ab.mixes[0].name, "One renamed");                                    // newer m wins
  assert.equal(ab.mixes[1].name, "Two");                                            // edit after the tomb
});

test("mergeMixer: tombstones win ties, a newer edit resurrects", () => {
  const live = data([saved(ID, 100, "Night")]);
  assert.deepEqual(MX.mergeMixer(live, data([], { [ID]: 100 })).mixes, []);
  assert.equal(MX.mergeMixer(live, data([], { [ID]: 99 })).mixes.length, 1);
  const t = MX.mergeMixer(data([], { [ID]: 50 }), data([], { [ID]: 80 }));
  assert.equal(t.tombs[ID], 80);
});

test("mergeMixer: equal mtime picks the same winner on both sides", () => {
  const A = data([saved(ID, 10, "Alpha")]), B = data([saved(ID, 10, "Beta")]);
  assert.deepEqual(MX.mergeMixer(A, B), MX.mergeMixer(B, A));
});

test("mergeMixer survives junk", () => {
  const out = MX.mergeMixer({ mixes: [null, 5, { id: ID }], tombs: { "BAD ID": 3, [ID]: -1 } }, undefined);
  assert.deepEqual(out, { ver: 1, mixes: [], tombs: {} });
});
