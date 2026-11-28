// DICT-1: montage/vad.js pure steps (Silero VAD probabilities → speech,
// silences to cut, Whisper windows, the live phrase stepper).
const test = require("node:test");
const assert = require("node:assert");
const V = require("../montage/vad.js");
const fx = require("./fixtures/vad-joy-probs.json");

test("segments: real Silero probabilities of two Greek samples", () => {
  const segs = V.segments(fx.probs, fx.n);
  assert.ok(segs.length >= 2);
  // speech starts after the 0.5 s of silence and ends with the numbers
  assert.ok(segs[0].start >= 0.4 && segs[0].start < 1.3, "first start " + segs[0].start);
  const last = segs[segs.length - 1];
  assert.ok(last.end > 35 && last.end < 36, "last end " + last.end);
  // nothing in the 4 s gap between the samples (20.8 s .. 24.8 s)
  segs.forEach((s) => assert.ok(!(s.start < 24.5 && s.end > 21.2), JSON.stringify(s)));
  // sorted, no overlap
  for (let i = 1; i < segs.length; i++) assert.ok(segs[i].start >= segs[i - 1].end);
});

test("segments: short blips are dropped, padding is added", () => {
  const p = new Float32Array(100);
  p[10] = 0.9;                                   // one frame: too short
  for (let i = 40; i < 60; i++) p[i] = 0.9;      // 0.64 s of speech
  const segs = V.segments(p, 100 * V.FRAME);
  assert.strictEqual(segs.length, 1);
  assert.ok(Math.abs(segs[0].start - (40 * V.FRAME_SEC - 0.03)) < 0.002);
  assert.ok(Math.abs(segs[0].end - (60 * V.FRAME_SEC + 0.03)) < 0.002);
  assert.deepStrictEqual(V.segments(new Float32Array(50), 50 * V.FRAME), []);
});

test("silences: gaps ≥ minGap, shrunk next to speech", () => {
  const sp = [{ start: 1, end: 3 }, { start: 3.3, end: 5 }, { start: 7, end: 8 }];
  const cuts = V.silences(sp, 10, 0.6, 0.15);
  assert.deepStrictEqual(cuts, [{ start: 0, end: 0.85 }, { start: 5.15, end: 6.85 }, { start: 8.15, end: 10 }]);
  assert.deepStrictEqual(V.silences([], 4, 0.6, 0.15), [{ start: 0, end: 4 }]);
  assert.deepStrictEqual(V.silences([{ start: 0, end: 4 }], 4), []);
});

test("windows: neighbours joined up to maxSec, long speech cut", () => {
  const w = V.windows([{ start: 1, end: 5 }, { start: 6, end: 20 }, { start: 40, end: 45 }, { start: 50, end: 120 }], 28);
  assert.deepStrictEqual(w, [{ start: 1, end: 20 }, { start: 40, end: 45 }, { start: 50, end: 78 }, { start: 78, end: 106 }, { start: 106, end: 120 }]);
  w.forEach((x) => assert.ok(x.end - x.start <= 28));
  assert.deepStrictEqual(V.windows([]), []);
  // a pause longer than maxGap starts a new window
  assert.deepStrictEqual(V.windows([{ start: 0, end: 3 }, { start: 6, end: 8 }], 28, 2), [{ start: 0, end: 3 }, { start: 6, end: 8 }]);
  // the real samples: the 4 s gap between them splits the windows
  const real = V.windows(V.segments(fx.probs, fx.n));
  assert.ok(real.some((x) => x.end > 20.5 && x.end < 21.5) && real.some((x) => x.start > 24 && x.start < 25.5), JSON.stringify(real));
});

test("Stepper: start, end after the pause, short sounds dropped", () => {
  const st = new V.Stepper({ pause: 0.32 });       // 10 frames
  const evs = [];
  const run = (p, n) => { for (let i = 0; i < n; i++) { const e = st.step(p); if (e) evs.push(e); } };
  run(0, 5); run(0.9, 30); run(0, 12);
  assert.deepStrictEqual(evs, ["start", "end"]);
  run(0.9, 3); run(0, 12);                         // 3 frames < minSpeech 0.25 s (8 frames)
  assert.deepStrictEqual(evs, ["start", "end", "start", "drop"]);
  run(0, 40);
  assert.ok(st.quiet >= 40);
});

test("Stepper on the real probabilities finds the long pause", () => {
  const st = new V.Stepper({ pause: 1.5 });
  const evs = [];
  fx.probs.forEach((p, i) => { const e = st.step(p); if (e) evs.push([e, i]); });
  const ends = evs.filter((e) => e[0] === "end");
  assert.ok(ends.length >= 1);
  // the first phrase ends around the end of the story (~20.8 s)
  const t = ends[0][1] * V.FRAME_SEC;
  assert.ok(t > 20.5 && t < 23, "first end at " + t);
});

test("the model file is pinned to the mirror copy", () => {
  assert.match(V.FILE.url, /^https:\/\/koulaxizis\.github\.io\/oros-models-vision\/silero-vad\/silero_vad\.onnx$/);
  assert.strictEqual(V.FILE.sha.length, 64);
  assert.strictEqual(V.FILE.size, 2327524);
});
