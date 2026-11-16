// Studio wave A4a: studio/aac.js, our own AAC-LC encoder (for M4B audiobooks).
// Every stream is read again here by a small independent decoder (ADTS
// header, raw_data_block syntax, sections, scale factors, Huffman-coded
// spectra with signs and escapes, a direct inverse MDCT with overlap-add)
// that must use up each frame to the last bit, and by ffmpeg where it is
// installed.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");
const A = require(path.join(__dirname, "..", "studio/aac.js"));

const FRAME = 1024, N = 2048;
function Reader(b, o, end) { this.b = b; this.p = o * 8; this.end = end * 8; }
Reader.prototype.bit = function () { assert.ok(this.p < this.end, "read past the frame"); const v = (this.b[this.p >> 3] >> (7 - (this.p & 7))) & 1; this.p++; return v; };
Reader.prototype.u = function (n) { let v = 0; for (let i = 0; i < n; i++) v = v * 2 + this.bit(); return v; };
// codeword lookup: "len:code" → index
function lookup(codes, bits) { const m = new Map(); codes.forEach((c, i) => m.set(bits[i] + ":" + c, i)); return m; }
const B = A._test.BOOKS;
const HUFF = [null].concat(B.slice(1).map((x) => lookup(x.c, x.b)));
const SFH = lookup(A._test.SFC, A._test.SFB);
function huff(r, map) { let c = 0; for (let l = 1; l <= 19; l++) { c = c * 2 + r.bit(); const i = map.get(l + ":" + c); if (i !== undefined) return i; } throw new Error("no codeword"); }
const DIM = [0, 4, 4, 4, 4, 2, 2, 2, 2, 2, 2, 2], SIGNED = [0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0], LAV = [0, 1, 1, 2, 2, 4, 4, 7, 7, 12, 12, 16];

// one individual_channel_stream (common_window 0) → dequantised spectrum
function readIcs(r, swb) {
  const gg = r.u(8);
  assert.equal(r.u(1), 0, "ics_reserved_bit"); assert.equal(r.u(2), 0, "only long"); r.u(1);
  const maxSfb = r.u(6); assert.equal(r.u(1), 0, "no prediction");
  const cbOf = []; let k = 0;
  while (k < maxSfb) {
    const cb = r.u(4); assert.ok(cb <= 11, "book " + cb);
    let len = 0, l; do { l = r.u(5); len += l; } while (l === 31);
    assert.ok(len > 0 || cb === 0);
    for (let i = 0; i < len; i++) cbOf.push(cb); k += len;
  }
  assert.equal(k, maxSfb, "sections cover max_sfb");
  const sf = []; let g = gg;
  for (let b = 0; b < maxSfb; b++) { if (cbOf[b]) { g += huff(r, SFH) - 60; assert.ok(g >= 0 && g <= 255); } sf.push(g); }
  assert.equal(r.u(1), 0, "pulse"); assert.equal(r.u(1), 0, "tns"); assert.equal(r.u(1), 0, "gain control");
  const spec = new Float64Array(FRAME);
  for (let b = 0; b < maxSfb; b++) {
    const cb = cbOf[b]; if (!cb) continue;
    const dim = DIM[cb], lav = LAV[cb], mod = SIGNED[cb] ? 2 * lav + 1 : lav + 1, gain = Math.pow(2, (sf[b] - 100) / 4);
    for (let i = swb[b]; i < swb[b + 1]; i += dim) {
      let idx = huff(r, HUFF[cb]); const v = [];
      for (let j = dim - 1; j >= 0; j--) { v[j] = idx % mod; idx = Math.floor(idx / mod); }
      for (let j = 0; j < dim; j++) {
        if (SIGNED[cb]) v[j] -= lav;
        else if (v[j] && r.bit()) v[j] = -v[j];
      }
      if (cb === 11) for (let j = 0; j < 2; j++) if (Math.abs(v[j]) === 16) {
        let n = 4; while (r.bit()) n++;
        const m = (1 << n) + r.u(n); assert.ok(m >= 16 && m <= 8191); v[j] = v[j] < 0 ? -m : m;
      }
      for (let j = 0; j < dim; j++) spec[i + j] = Math.sign(v[j]) * Math.pow(Math.abs(v[j]), 4 / 3) * gain;
    }
  }
  return spec;
}
const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000];
// ADTS stream → { rate, ch, frames, pcm: [Float64Array] } (pcm in -1..1, the priming frame included)
function decode(buf) {
  let o = 0, rate = 0, ch = 0, frames = 0; const out = [], prev = [];
  const cos = new Float64Array(N * FRAME);
  for (let n = 0; n < N; n++) for (let k = 0; k < FRAME; k++) cos[n * FRAME + k] = Math.cos(2 * Math.PI / N * (n + 0.5 + FRAME / 2) * (k + 0.5));
  const win = Float64Array.from({ length: N }, (_, n) => Math.sin(Math.PI * (n + 0.5) / N));
  while (o < buf.length) {
    const h = new Reader(buf, o, o + 7);
    assert.equal(h.u(12), 0xfff, "sync"); assert.equal(h.u(1), 0, "MPEG-4"); assert.equal(h.u(2), 0); assert.equal(h.u(1), 1, "no CRC");
    assert.equal(h.u(2), 1, "AAC LC"); const ri = h.u(4); h.u(1); const cc = h.u(3); h.u(4);
    const len = h.u(13); h.u(11); assert.equal(h.u(2), 0, "one raw block");
    rate = RATES[ri]; ch = cc; const swb = A._test.swbOf(rate);
    const r = new Reader(buf, o + 7, o + len), specs = [];
    const id = r.u(3); r.u(4);
    if (ch === 1) { assert.equal(id, 0, "SCE"); specs.push(readIcs(r, swb)); }
    else { assert.equal(id, 1, "CPE"); assert.equal(r.u(1), 0, "no common window"); specs.push(readIcs(r, swb), readIcs(r, swb)); }
    assert.equal(r.u(3), 7, "END");
    assert.ok(o * 8 + len * 8 - r.p < 8, "frame used to its last byte");
    for (let c = 0; c < ch; c++) {
      const y = new Float64Array(N), X = specs[c];
      for (let k = 0; k < FRAME; k++) if (X[k]) for (let n = 0; n < N; n++) y[n] += X[k] * cos[n * FRAME + k];
      for (let n = 0; n < N; n++) y[n] *= 2 / N * win[n];
      if (!out[c]) { out[c] = []; prev[c] = new Float64Array(FRAME); }
      const pcm = new Float64Array(FRAME);
      for (let n = 0; n < FRAME; n++) pcm[n] = (prev[c][n] + y[n]) / 32768;
      prev[c] = y.slice(FRAME); out[c].push(pcm);
    }
    o += len; frames++;
  }
  return { rate, ch, frames, pcm: out.map((l) => { const a = new Float64Array(l.length * FRAME); l.forEach((p, i) => a.set(p, i * FRAME)); return a; }) };
}
function snr(ref, got, delay, from, to) {
  let s = 0, e = 0;
  for (let i = from; i < to; i++) { s += ref[i] * ref[i]; const d = got[i + delay] - ref[i]; e += d * d; }
  return 10 * Math.log10(s / e);
}
let seed = 5; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
function signal(rate, sec, f0, amp) {
  const n = Math.round(rate * sec), x = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / rate; x[i] = amp * (0.7 * Math.sin(2 * Math.PI * f0 * t) + 0.25 * Math.sin(2 * Math.PI * f0 * 2.5 * t) * (0.5 + 0.5 * Math.sin(t * 7))) + 0.003 * rnd(); }
  return x;
}

test("codebooks are complete prefix codes of the right sizes", () => {
  const sizes = [0, 81, 81, 81, 81, 81, 81, 64, 64, 169, 169, 289];
  const check = (codes, bits) => {
    const s = codes.map((c, i) => { assert.ok(c < 2 ** bits[i]); return c.toString(2).padStart(bits[i], "0"); }).sort();
    for (let i = 0; i + 1 < s.length; i++) assert.ok(!s[i + 1].startsWith(s[i]), "prefix-free");
    assert.ok(Math.abs(bits.reduce((t, b) => t + 2 ** -b, 0) - 1) < 1e-12, "complete");
  };
  for (let cb = 1; cb <= 11; cb++) { assert.equal(B[cb].c.length, sizes[cb]); assert.equal(B[cb].b.length, sizes[cb]); check(B[cb].c, B[cb].b); }
  assert.equal(A._test.SFC.length, 121); check(A._test.SFC, A._test.SFB);
  for (const r of [48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000]) { const s = A._test.swbOf(r); assert.equal(s[0], 0); assert.equal(s[s.length - 1], 1024); }
});

test("the fast MDCT matches the direct formula", () => {
  const M = new A._test.Mdct(), z = new Float64Array(N), out = new Float64Array(FRAME);
  for (let i = 0; i < N; i++) z[i] = rnd();
  M.run(z, out, 1);
  let worst = 0;
  for (let k = 0; k < FRAME; k += 7) {
    let s = 0; for (let n = 0; n < N; n++) s += z[n] * Math.sin(Math.PI * (n + 0.5) / N) * Math.cos(Math.PI / FRAME * (n + 0.5 + FRAME / 2) * (k + 0.5));
    worst = Math.max(worst, Math.abs(s - out[k]));
  }
  assert.ok(worst < 1e-9, "error " + worst);
});

test("mono and stereo decode with our reader at every rate, near the bit rate", () => {
  for (const [rate, ch, kbps, min] of [[44100, 1, 64, 35], [48000, 2, 128, 35], [22050, 1, 32, 35], [16000, 1, 24, 35], [8000, 1, 16, 35], [32000, 2, 96, 35]]) {
    const sec = 1.5, chans = [], f0 = rate > 16000 ? 330 : 220;
    for (let c = 0; c < ch; c++) chans.push(signal(rate, sec, f0 * (1 + c * 0.5), 0.4));
    const e = A.encode(chans, rate, kbps), adts = e.adts(), d = decode(adts);
    const n = chans[0].length;
    assert.equal(d.rate, rate); assert.equal(d.ch, ch);
    assert.equal(d.frames, Math.ceil(n / FRAME) + 1, "one priming frame");
    assert.equal(e.units().length, d.frames);
    const real = (adts.length - 7 * d.frames) * 8 / (d.frames * FRAME / rate) / 1000;
    assert.ok(real < kbps * 1.1, rate + " Hz: " + real.toFixed(1) + " kbit/s for " + kbps);
    for (let c = 0; c < ch; c++) {
      const s = snr(chans[c], d.pcm[c], e.delay, FRAME, n - FRAME);
      assert.ok(s > min, rate + " Hz ch " + c + ": SNR " + s.toFixed(1) + " dB");
    }
  }
});

test("silence, a near full-scale square (escapes) and inputs shorter than a frame", () => {
  const rate = 44100;
  const z = A.encode([new Float32Array(3000)], rate, 64), dz = decode(z.adts());
  assert.equal(dz.frames, 4); assert.ok(dz.pcm[0].every((v) => v === 0));
  const sq = new Float32Array(rate).map((_, i) => (Math.floor(i / 50) % 2 ? 0.98 : -0.98));
  const e = A.encode([sq], rate, 160), d = decode(e.adts());
  let big = 0; for (let i = 0; i < rate; i++) big = Math.max(big, Math.abs(d.pcm[0][i]));
  assert.ok(big > 0.8, "loud output " + big);
  assert.ok(snr(sq, d.pcm[0], e.delay, FRAME, rate - FRAME) > 10);
  const one = A.encode([Float32Array.of(0.5)], 48000, 64);
  assert.equal(decode(one.adts()).frames, 2);
});

test("AudioSpecificConfig and the encoder's limits", () => {
  const m = A.encode([new Float32Array(10)], 44100, 64), s = A.encode([new Float32Array(10), new Float32Array(10)], 48000, 128);
  assert.deepEqual(Array.from(m.asc()), [0x12, 0x08]);
  assert.deepEqual(Array.from(s.asc()), [0x11, 0x90]);
  assert.equal(m.delay, 1024);
  assert.throws(() => new A.Encoder([new Float32Array(10)], 96000, 64), /rate/);
  assert.throws(() => new A.Encoder([], 44100, 64), /channels/);
  const e = new A.Encoder([new Float32Array(44100)], 44100, 64);
  assert.equal(e.progress(), 0); while (!e.step(5)) assert.ok(e.progress() < 1); assert.equal(e.progress(), 1);
});

test("ffmpeg decodes the stream, where it is installed", (t) => {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch (e) { t.skip("no ffmpeg"); return; }
  const rate = 44100, x = signal(rate, 2, 300, 0.4), y = signal(rate, 2, 450, 0.3);
  const e = A.encode([x, y], rate, 128), dir = fs.mkdtempSync(path.join(os.tmpdir(), "aac-")), f = path.join(dir, "t.aac");
  fs.writeFileSync(f, e.adts());
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", f, "-f", "f32le", "-"], { maxBuffer: 1 << 26 });
  const d = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4), L = new Float64Array(d.length / 2), R = new Float64Array(d.length / 2);
  for (let i = 0; i < L.length; i++) { L[i] = d[2 * i]; R[i] = d[2 * i + 1]; }
  assert.equal(L.length, (Math.ceil(x.length / FRAME) + 1) * FRAME);
  assert.ok(snr(x, L, 1024, FRAME, x.length - FRAME) > 35);
  assert.ok(snr(y, R, 1024, FRAME, y.length - FRAME) > 35);
  // our reader and ffmpeg agree sample by sample
  const ours = decode(e.adts());
  let worst = 0; for (let i = 0; i < L.length; i++) worst = Math.max(worst, Math.abs(L[i] - ours.pcm[0][i]));
  assert.ok(worst < 1e-4, "readers differ by " + worst);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a stream in pieces gives the very same frames as the whole input", () => {
  const rate = 44100, x = signal(rate, 2.3, 260, 0.4), whole = A.encode([x], rate, 64);
  const s = new A.Stream(1, rate, 64);
  for (const [a, b] of [[0, 1], [1, 1500], [1500, 1500], [1500, 30000], [30000, x.length]]) s.push([x.subarray(a, b)]);
  s.end();
  assert.equal(s.n, x.length);
  assert.equal(s.units().length, whole.units().length);
  s.units().forEach((u, i) => assert.deepEqual(Array.from(u), Array.from(whole.units()[i]), "frame " + i));
  assert.throws(() => s.push([x]), /ended/);
});
