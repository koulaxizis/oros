// Studio sound to MIDI (studio/tomidi.js, wave K4): the windows, the
// unwrap and the note finding must be Spotify basic-pitch's own steps.
// The fixture was written by basic-pitch 0.4.0 with its nmp.onnx in
// onnxruntime on a test sound (A4, then C5+E5, then G3, 22,050 Hz): the
// unwrapped "note" and "onset" outputs (quantised to 1/65535, both sides
// read the same numbers) and the notes output_to_notes_polyphonic found
// in them (defaults, and onset 0.3 / frame 0.2 = sensitivity 5).
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const T = require("../studio/tomidi.js");
const FX = require("./fixtures/studio-tomidi.json");

function plane(b64) {
  const b = Buffer.from(b64, "base64"), u = new Uint16Array(b.buffer, b.byteOffset, b.length / 2), out = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) out[i] = u[i] / 65535;
  return out;
}
function same(a, b) {
  assert.strictEqual(a.length, b.length, "count " + a.length + " vs " + b.length);
  const key = (n) => n[0] + ":" + n[1] + ":" + n[2];
  const A = a.map(key).sort(), B = b.map(key).sort();
  assert.deepStrictEqual(A, B);
  const amp = Object.fromEntries(b.map((n) => [key(n), n[3]]));
  a.forEach((n) => assert.ok(Math.abs(n[3] - amp[key(n)]) < 1e-6));
}

test("constants are basic-pitch's", () => {
  assert.strictEqual(T.N_SAMPLES, 43844);
  assert.strictEqual(T.FPS, 86);
  assert.strictEqual(T.STEP, 43844 - 30 * 256);
});

test("windows: as many as basic-pitch reads", () => {
  assert.strictEqual(T.windows(FX.nSamples).length, FX.windows);
  assert.strictEqual(T.windows(1).length, 1);
});

test("unwrap: half the overlap off both ends, cut to the sound", () => {
  const per = 172, bins = 2, outs = [0, 1].map((w) => { const a = new Float32Array(per * bins); for (let f = 0; f < per; f++) a[f * bins] = w * 1000 + f; return a; });
  const u = T.unwrap(outs, per, bins, 3 * 22050);
  assert.strictEqual(u.frames, Math.floor(3 * 22050 * 86 / 22050));
  assert.strictEqual(u.data[0], 15);                // frame 15 of window 0
  assert.strictEqual(u.data[(per - 30 - 1) * bins], per - 16);
  assert.strictEqual(u.data[(per - 30) * bins], 1015);   // then window 1 from its frame 15
});

test("notes: the same as basic-pitch (defaults and sensitivity 5)", () => {
  const nt = plane(FX.note), on = plane(FX.onset);
  same(T.notesOf(nt, on, FX.frames, { onset: 0.5, frame: 0.3 }), FX.notes);
  const s5 = T.thresholds(5);
  same(T.notesOf(nt, on, FX.frames, { onset: s5.onset, frame: s5.frame }), FX.notesSens5);
  assert.deepStrictEqual(T.thresholds(3), { onset: 0.5, frame: 0.3 });
});

test("frame times: model_frames_to_time", () => {
  FX.times.forEach((v, j) => assert.ok(Math.abs(T.frameTime(j * 37) - v) < 1e-9, "frame " + j * 37));
});

test("Studio notes: melody keeps the strongest, quantise snaps to the grid", () => {
  const nt = plane(FX.note), on = plane(FX.onset);
  const raw = T.notesOf(nt, on, FX.frames, {});
  const poly = T.toStudio(raw, {});
  assert.strictEqual(poly.length, raw.length);
  poly.forEach((n) => { assert.ok(n[0] >= 21 && n[0] <= 108); assert.ok(n[2] > 0); assert.ok(n[3] >= 1 && n[3] <= 127); });
  const mel = T.toStudio(raw, { kind: "melody" });
  for (let i = 0; i < mel.length; i++) for (let j = i + 1; j < mel.length; j++) {
    assert.ok(!(mel[j][1] < mel[i][1] + mel[i][2] - 1e-6 && mel[i][1] < mel[j][1] + mel[j][2] - 1e-6), "overlap");
  }
  assert.ok(mel.some((n) => n[0] === 69) && mel.some((n) => n[0] === 55));
  const q = T.toStudio(raw, { quant: 16, bpm: 120 });      // a sixteenth = 0.125 s
  q.forEach((n) => { assert.ok(Math.abs(n[1] / 0.125 - Math.round(n[1] / 0.125)) < 1e-6); assert.ok(n[2] >= 0.125 - 1e-9); });
});
