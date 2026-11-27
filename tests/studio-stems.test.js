// Studio stem separation (studio/stems.js, wave S1): the STFT, its inverse
// and the splitting must be the very steps of demucs. The fixture was
// written by the NumPy copy tools/demucs_spec.py of koulaxizis/oros-models-vision,
// which is checked against torch.stft / torch.istft there.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const S = require("../studio/stems.js");
const FX = require("./fixtures/studio-stems-spec.json");

// Park-Miller, the same numbers as the fixture's generator
function rng(seed) {
  let s = seed;
  return function (n) {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; out[i] = Math.fround(s / 2147483647 - 0.5); }
    return out;
  };
}

test("fft: forward then inverse gives the input back", () => {
  const r = rng(7), re = r(S.NFFT), im = r(S.NFFT), a = Float64Array.from(re), b = Float64Array.from(im);
  S.fft(re, im, -1); S.fft(re, im, 1);
  for (let i = 0; i < S.NFFT; i++) {
    assert.ok(Math.abs(re[i] / S.NFFT - a[i]) < 1e-12);
    assert.ok(Math.abs(im[i] / S.NFFT - b[i]) < 1e-12);
  }
});

test("reflect padding is numpy's (no repeated edge)", () => {
  assert.deepStrictEqual(Array.from(S.reflect([1, 2, 3, 4], 2, 3)), [3, 2, 1, 2, 3, 4, 3, 2, 1]);
});

test("spec and ispec match demucs (fixture from NumPy/torch)", () => {
  const r = rng(FX.seed), x = r(FX.n), z = S.spec(x);
  assert.strictEqual(z.frames, FX.T);
  FX.specIdx.forEach((k, i) => {
    assert.ok(Math.abs(z.re[k] - FX.specRe[i]) < 1e-9, "re " + k);
    assert.ok(Math.abs(z.im[k] - FX.specIm[i]) < 1e-9, "im " + k);
  });
  const re = r(S.BINS * FX.T), im = r(S.BINS * FX.T), y = S.ispec(re, im, FX.T, FX.n);
  FX.ispecIdx.forEach((k, i) => assert.ok(Math.abs(y[k] - FX.ispec[i]) < 1e-9, "ispec " + k));
});

test("a segment's STFT has the model's shape", () => {
  const x = new Float32Array(S.SEG), mag = S.magOf(x, x);
  assert.strictEqual(S.FRAMES, Math.ceil(S.SEG / S.HOP));
  assert.strictEqual(mag.length, 4 * S.BINS * S.FRAMES);
});

test("plan, chunk and weights follow apply_model", () => {
  assert.strictEqual(S.STRIDE, Math.floor(0.75 * S.SEG));
  assert.deepStrictEqual(S.plan(S.SEG * 2), [0, S.STRIDE, 2 * S.STRIDE]);
  const w = S.weight();
  assert.strictEqual(w.length, S.SEG);
  assert.strictEqual(Math.max(...w.subarray(S.SEG / 2 - 2, S.SEG / 2 + 2)), 1);
  assert.ok(w[0] > 0 && w[S.SEG - 1] > 0);
  // a short last chunk is centred: it takes samples before its offset
  const x = new Float32Array(400000).map((_, i) => i + 1), c = S.chunk(x, 300000);
  assert.strictEqual(c.length, 100000);
  assert.strictEqual(c.delta, S.SEG - 100000);
  assert.strictEqual(c.seg[0], 300000 - Math.floor(c.delta / 2) + 1);
  assert.strictEqual(c.seg[S.SEG - 1], 0);
  // the first chunk of a short song: zeros on both sides
  const y = new Float32Array(1000).fill(1), d = S.chunk(y, 0);
  assert.strictEqual(d.seg[Math.floor(d.delta / 2)], 1);
  assert.strictEqual(d.seg[Math.floor(d.delta / 2) - 1], 0);
});

test("regions written one by one equal the whole weighted sum", () => {
  const L = Math.round(2.6 * S.STRIDE), offs = S.plan(L), w = S.weight(), st = { mean: 0.1, std: 2 };
  const segs = offs.map((o, k) => {
    const length = Math.min(L - o, S.SEG), data = new Float32Array(8 * length);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin(i * 0.001 + k);
    return { data, length };
  });
  // the reference: one accumulator for the whole song
  const acc = new Float64Array(8 * L), sw = new Float64Array(L);
  offs.forEach((o, k) => {
    const s = segs[k];
    for (let i = 0; i < s.length; i++) {
      sw[o + i] += w[i];
      for (let r = 0; r < 8; r++) acc[r * L + o + i] += w[i] * s.data[r * s.length + i];
    }
  });
  const got = {};
  offs.forEach((o, k) => {
    got[k] = segs[k];
    const reg = S.region(k, offs, L, got, st), n = reg.length / 8;
    for (let i = 0; i < n; i += 997) for (let r = 0; r < 8; r++) {
      const want = acc[r * L + o + i] / sw[o + i] * st.std + st.mean;
      assert.ok(Math.abs(reg[r * n + i] - want) < 1e-5, k + " " + i);
    }
  });
});

test("stats use the mono mix and the unbiased deviation", () => {
  const st = S.stats(new Float32Array([1, 3]), new Float32Array([1, 3]));
  assert.strictEqual(st.mean, 2);
  assert.ok(Math.abs(st.std - Math.SQRT2) < 1e-7);
});

test("instrumental is drums + bass + other", () => {
  const p = [0, 1, 2, 3].map((s) => [new Float32Array([s, s]), new Float32Array([s * 2, s * 2])]);
  const o = S.inst(p);
  assert.deepStrictEqual(Array.from(o[0]), [3, 3]);
  assert.deepStrictEqual(Array.from(o[1]), [6, 6]);
});
