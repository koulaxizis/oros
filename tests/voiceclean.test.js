// Voice cleaning (voiceclean.js, wave K1): the pieces a long sound is cut
// into, how they are put back together, and the DeepFilterNet delay that
// is taken back so the cleaned sound lines up with the original.
// With VOICECLEAN_WASM=<path to deepfilter.wasm> the real module is run
// too (the file comes from koulaxizis/oros-models-vision; not in this repo).
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const V = require("../voiceclean.js");

// a fake engine: gives every frame back DELAY samples late, times gain
function fake(hop, delay, gain) {
  const line = new Float32Array(delay + hop);
  let held = 0;
  return {
    hop: hop, delay: delay,
    process(x) {
      const all = new Float32Array(held + hop);
      all.set(line.subarray(0, held)); all.set(x, held);
      const total = held + hop, out = new Float32Array(hop);
      // the first `delay` samples ever given are silence
      for (let i = 0; i < hop; i++) {
        const k = i + total - hop - delay;
        out[i] = k >= 0 ? all[k] * gain : 0;
      }
      const keep = Math.min(total, delay);
      line.set(all.subarray(total - keep, total));
      held = keep;
      return out;
    }
  };
}

test("plan: pieces cover the sound, warm-up before, crossfade after", () => {
  const R = 1000, n = 95 * R, parts = V.plan(n, R);
  assert.strictEqual(parts.length, 4);
  assert.deepStrictEqual(parts[0], { a: 0, b: 30 * R, from: 0, to: 30 * R + 50 });
  assert.deepStrictEqual(parts[1], { a: 30 * R, b: 60 * R, from: 28 * R, to: 60 * R + 50 });
  assert.deepStrictEqual(parts[3], { a: 90 * R, b: n, from: 88 * R, to: n });
  for (let k = 1; k < parts.length; k++) assert.strictEqual(parts[k].a, parts[k - 1].b);
  assert.deepStrictEqual(V.plan(10, R), [{ a: 0, b: 10, from: 0, to: 10 }]);
});

test("stitch: identical pieces give the sound back exactly; a step is crossfaded", () => {
  const R = 100, n = 7000, parts = V.plan(n, R), x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin(i / 7);
  const pieces = parts.map((p) => x.slice(p.a, p.to));
  const y = V.stitch(n, parts, pieces);
  for (let i = 0; i < n; i++) assert.ok(Math.abs(y[i] - x[i]) < 1e-6);
  // piece 0 all ones, piece 1 all zeros: a ramp down over the overlap
  const p2 = V.plan(5000, R), ones = p2.map((p, k) => new Float32Array(p.to - p.a).fill(k === 0 ? 1 : 0));
  const z = V.stitch(5000, p2, ones), b = p2[0].b, xf = p2[0].to - b;
  assert.strictEqual(z[b - 1], 1);
  assert.ok(z[b] >= 0.89 && z[b + xf - 1] <= 0.11);
  assert.strictEqual(z[b + xf], 0);
});

test("frames: the delay is taken back, the warm-up dropped", () => {
  const hop = 480, delay = 1440, x = new Float32Array(5000);
  for (let i = 0; i < x.length; i++) x[i] = (i % 97) / 97;
  const y = V.frames(fake(hop, delay, 1), x, 300);
  assert.strictEqual(y.length, x.length - 300);
  for (let i = 0; i < y.length; i++) assert.ok(Math.abs(y[i] - x[i + 300]) < 1e-7, "sample " + i);
});

test("levels: gentle 12 dB, medium 24 dB (default), full = no limit", () => {
  assert.strictEqual(V.level("gentle"), 12);
  assert.strictEqual(V.level("medium"), 24);
  assert.strictEqual(V.level("full"), 100);
  assert.strictEqual(V.level("x"), 24);
});

const WASM = process.env.VOICECLEAN_WASM;
test("the real module: lines up with the input and cuts noise", { skip: !WASM || !fs.existsSync(WASM) }, async () => {
  const { instance } = await WebAssembly.instantiate(fs.readFileSync(WASM), {});
  const E = instance.exports, R = V.RATE;
  // a voice-like tone (harmonics, gliding pitch) with syllables, plus noise
  let s = 1;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  const n = 4 * R, voice = new Float32Array(n), mix = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / R, f0 = 140 + 30 * Math.sin(2 * Math.PI * 0.7 * t);
    ph += 2 * Math.PI * f0 / R;
    let v = 0;
    for (let k = 1; k < 20; k++) v += Math.sin(k * ph) / k;
    voice[i] = Math.sin(2 * Math.PI * 1.5 * t) > -0.2 ? 0.25 * v : 0;
    mix[i] = voice[i] + 0.1 * rnd();
  }
  const eng = V.engine(E, 100);
  assert.strictEqual(eng.hop, 480);
  assert.strictEqual(eng.delay, 1440);
  const y = V.frames(eng, mix, 0);
  eng.free();
  assert.strictEqual(y.length, n);
  // lined up: the cleaned sound correlates best with the voice at lag 0
  function corr(lag) {
    let a = 0;
    for (let i = R; i < n - R; i++) a += y[i] * voice[i + lag];
    return a;
  }
  const c0 = corr(0);
  for (const lag of [-480, -240, -48, 48, 240, 480, 1440]) assert.ok(c0 > corr(lag), "lag " + lag);
  // noise in the pauses is cut by more than 15 dB
  let nIn = 0, nOut = 0;
  for (let i = R; i < n; i++) if (voice[i] === 0) { nIn += (mix[i]) ** 2; nOut += y[i] ** 2; }
  assert.ok(10 * Math.log10(nIn / nOut) > 15, "noise cut " + 10 * Math.log10(nIn / nOut));
});
