// Studio wave A1: the loudness and level meter (studio/meter.js).
// EBU Tech 3341 / 3342 cases built from sines, the ACX-style levels, and
// the same numbers as NULL Loudness Meter (the translated JSFX that
// Studio ships in studio/nullfx) on the same signal.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const M = require("../studio/meter.js");

function sine(sr, sec, dbfs, hz, ch, phase) {
  const n = Math.round(sr * sec), a = Math.pow(10, dbfs / 20), out = [];
  for (let c = 0; c < ch; c++) {
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = a * Math.sin(2 * Math.PI * hz * i / sr + (phase || 0));
    out.push(x);
  }
  return out;
}
function cat(parts) {
  const ch = parts[0].length, n = parts.reduce((s, p) => s + p[0].length, 0), out = [];
  for (let c = 0; c < ch; c++) { const x = new Float32Array(n); let o = 0; parts.forEach((p) => { x.set(p[c], o); o += p[c].length; }); out.push(x); }
  return out;
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || "") + " got " + a + ", want " + b + " ± " + tol);

test("A1: EBU Tech 3341 integrated loudness, cases 1-5 (48 kHz stereo)", () => {
  const sr = 48000;
  near(M.analyse(sine(sr, 20, -23, 1000, 2), sr).i, -23, 0.1, "case 1");
  near(M.analyse(sine(sr, 20, -33, 1000, 2), sr).i, -33, 0.1, "case 2");
  near(M.analyse(cat([sine(sr, 10, -36, 1000, 2), sine(sr, 60, -23, 1000, 2), sine(sr, 10, -36, 1000, 2)]), sr).i, -23, 0.1, "case 3");
  near(M.analyse(cat([sine(sr, 10, -72, 1000, 2), sine(sr, 10, -36, 1000, 2), sine(sr, 60, -23, 1000, 2),
    sine(sr, 10, -36, 1000, 2), sine(sr, 10, -72, 1000, 2)]), sr).i, -23, 0.1, "case 4");
  near(M.analyse(cat([sine(sr, 20, -26, 1000, 2), sine(sr, 20.1, -20, 1000, 2), sine(sr, 20, -26, 1000, 2)]), sr).i, -23, 0.1, "case 5");
});

test("A1: momentary and short-term of a steady tone, also at 44.1 kHz", () => {
  [44100, 48000].forEach((sr) => {
    const m = new M.Meter(sr, 2);
    m.push(sine(sr, 3.5, -23, 1000, 2));
    const r = m.read();
    near(r.m, -23, 0.1, "momentary " + sr);
    near(r.s, -23, 0.1, "short-term " + sr);
    near(r.i, -23, 0.1, "integrated " + sr);
  });
});

test("A1: EBU Tech 3342 loudness range, cases 1-4", () => {
  const sr = 48000, s = (sec, d) => sine(sr, sec, d, 1000, 2);
  near(M.analyse(cat([s(20, -20), s(20, -30)]), sr).lra, 10, 1, "case 1");
  near(M.analyse(cat([s(20, -20), s(20, -15)]), sr).lra, 5, 1, "case 2");
  near(M.analyse(cat([s(20, -40), s(20, -20)]), sr).lra, 20, 1, "case 3");
  near(M.analyse(cat([s(20, -50), s(20, -35), s(20, -20), s(20, -35), s(20, -50)]), sr).lra, 15, 1, "case 4");
});

test("A1: true peak finds the peak between samples", () => {
  const sr = 48000;
  // fs/4 at 45 degrees: every sample sits at 0.707 of the real peak
  const r = M.analyse(sine(sr, 1, 0, sr / 4, 2, Math.PI / 4), sr);
  near(r.sp, -3.01, 0.02, "sample peak");
  near(r.tp, 0, 0.6, "true peak");
  assert.ok(r.tp > r.sp + 2.4);
  const q = M.analyse(sine(sr, 1, -6, 1000, 1), sr);
  near(q.tp, -6, 0.05);
});

test("A1: the meter gives the same numbers as NULL Loudness Meter", () => {
  globalThis.NULLRT = require("../studio/nullfx/runtime/eel-rt.js");
  const HOST = require("../studio/nullfx/runtime/null-fx.js");
  globalThis.NULLFXHost = HOST;
  require(path.join(__dirname, "../studio/nullfx/fx/loudness_meter.js"));
  const FX = globalThis.NULLFX.loudness_meter;
  [44100, 48000].forEach((sr) => {
    // two tones, noise and dynamics, different in each channel, Float64 for both
    const n = sr * 8, L = new Float64Array(n), R = new Float64Array(n);
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296 * 2 - 1; };
    for (let i = 0; i < n; i++) {
      const t = i / sr, env = (t % 1.3) < 0.6 ? 1 : (t % 2.9 < 1 ? 0.05 : 0.3);
      L[i] = 0.4 * env * (Math.sin(2 * Math.PI * 220 * t) + 0.3 * rnd());
      R[i] = 0.3 * env * (Math.sin(2 * Math.PI * 3150 * t) + 0.2 * rnd());
    }
    const e = new HOST.Effect(FX, globalThis.NULLRT, { srate: sr, blockSize: 256, playing: true, sliders: {} });
    const o = [new Float64Array(256), new Float64Array(256)];
    for (let k = 0; k < n; k += 256) {
      const c = Math.min(256, n - k);
      e.process([L.subarray(k, k + c), R.subarray(k, k + c)], [o[0].subarray(0, c), o[1].subarray(0, c)], c, 2);
    }
    const m = new M.Meter(sr, 2);
    m.push([L, R]);
    const r = m.read(), v = (k) => e.inst.getVar(k);
    const pairs = [["i", "lm_int"], ["lra", "lm_lra"], ["m", "lm_m"], ["s", "lm_s"], ["mmax", "lm_mmax"], ["smax", "lm_smax"], ["tp", "lm_tpmax"], ["sp", "lm_spmax"]];
    pairs.forEach(([a, b]) => near(r[a], v(b), 1e-9, sr + " " + a + " vs " + b));
    assert.ok(r.i > -40 && r.i < -5, "a real measurement: " + r.i);
  });
});

test("A1: levels for ACX: RMS, noise floor, room tone, digital silence, DC, clipping", () => {
  const sr = 44100;
  // 0.8 s room tone (noise at about -65 dBFS RMS), 10 s voice-like tone, 2 s room tone
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296 * 2 - 1; };
  const noise = (sec) => { const n = Math.round(sr * sec), x = new Float32Array(n), a = Math.pow(10, -65 / 20) * Math.sqrt(3); for (let i = 0; i < n; i++) x[i] = a * rnd(); return [x]; };
  const voice = sine(sr, 10, -17, 300, 1);
  const file = cat([noise(0.8), voice, noise(2)]);
  const r = M.analyse(file, sr);
  near(r.floor, -65, 1, "noise floor");
  near(r.head, 0.8, 0.02, "head");
  near(r.tail, 2, 0.02, "tail");
  near(r.rms, -17 - 3.01 + 10 * Math.log10(10 / 12.8), 0.1, "whole-file RMS");
  assert.equal(r.zero < 0.001, true);
  assert.equal(r.clip, 0);
  const rows = M.check(r, "acx"), by = Object.fromEntries(rows.map((x) => [x.k, x]));
  assert.equal(by.floor.ok, true);
  assert.equal(by.head.ok, true);
  assert.equal(by.tail.ok, true);
  assert.equal(by.peak.ok, true);                                           // a -17 dBFS peak is under -3
  assert.equal(by.rms.ok, true);                                            // about -21.1 dBFS, inside -23..-18

});

test("A1: digital silence, clipping and DC are reported", () => {
  const sr = 48000;
  const z = [new Float32Array(sr / 2)];
  const loud = [new Float32Array(sr).fill(0)];
  for (let i = 0; i < sr; i++) loud[0][i] = Math.sin(i / 10) > 0.99 ? 1 : 0.2 * Math.sin(i / 10) + 0.05;
  const r = M.analyse(cat([z, loud]), sr);
  near(r.zero, 0.5, 0.001, "digital silence");
  assert.ok(r.clip > 0);
  assert.ok(r.dc > -40, "DC offset seen: " + r.dc);
  const by = Object.fromEntries(M.check(r, "acx").map((x) => [x.k, x]));
  assert.equal(by.zero.ok, false);
  assert.equal(by.clip.ok, false);
});

test("A1: platform targets and the gain an audiobook needs", () => {
  const rep = { i: -9, tp: -0.3, sp: -0.5, rms: -25, floor: -70 };
  assert.deepEqual(M.platform(rep, "spotify"), { id: "spotify", target: -14, tp: -1, gain: -5, over: true });
  assert.equal(M.platform({ i: -20, tp: -6 }, "spotify").gain, 5);          // raised while the peak stays under -1
  assert.equal(M.platform({ i: -20, tp: -3 }, "spotify").gain, 2);          // only as far as the peak allows
  assert.equal(M.platform({ i: -20, tp: -3 }, "youtube").gain, 0);          // YouTube only turns down
  assert.equal(M.platform({ i: -20, tp: -3 }, "apple").gain, 4);
  assert.equal(M.platform({ i: -200 }, "apple"), null);
  const g = M.gainFor({ rms: -26, tp: -9, sp: -9.5, floor: -68 }, "acx");
  assert.equal(g.gain, 5.5);
  assert.equal(g.limit, false);
  assert.equal(g.noisy, false);
  const h = M.gainFor({ rms: -26, tp: -4, sp: -4, floor: -64 }, "acx");
  assert.equal(h.limit, true);                                             // the limiter must catch the peaks
  assert.equal(h.noisy, true);                                             // the noise rises above -60
});
