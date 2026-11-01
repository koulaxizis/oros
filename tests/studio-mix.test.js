// Studio wave 39: automation lanes, sidechain keys, the chain processor,
// the MP3 encoder and the Ogg Opus muxer (studio/encode.js), and MIDI
// parsing (studio/midi.js). Pure logic, no browser.
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "studio/core.js"));
const E = require(path.join(ROOT, "studio/encode.js"));
const M = require(path.join(ROOT, "studio/midi.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= (eps || 1e-9), a + " ≉ " + b);
const T = (id, m, x) => Object.assign({ id, m, p: "pproject1", name: "Track " + id, color: C.COLORS[0], vol: 0, pan: 0 }, x || {});

// ---------- Automation ----------
test("automation: lanes normalise, keep order, drop what cannot play", () => {
  const fx = [{ u: "fabc1234", id: "tilt", s: {} }];
  const t = C.normTrack(T("ttrack01", 1, {
    fx,
    auto: [
      { k: "vol", p: [[2, -6], [1, 0], [1, -3], [1, -9], [5, "x"], [-4, 99], null] },
      { k: "fx.fabc1234.1", p: [[0, 3]] },
      { k: "fx.fzzz9999.1", p: [[0, 1]] },            // that effect is not on the track
      { k: "pan", on: false, p: [[0, 500]] },
      { k: "vol", p: [[9, 1]] },                       // duplicate lane
      { k: "bogus", p: [[0, 1]] },
      { k: "pan2", p: [] }
    ]
  }));
  assert.deepEqual(t.auto, [
    { k: "vol", p: [[0, 6], [1, 0], [1, -9], [2, -6]] },  // clamped, sorted, the middle of three at one time dropped
    { k: "fx.fabc1234.1", p: [[0, 3]] },
    { k: "pan", on: false, p: [[0, 100]] }
  ]);
  // a lane needs a point; removing the effect removes its lanes
  assert.deepEqual(C.setLane(t, "vol", { p: [] }).map((x) => x.k), ["fx.fabc1234.1", "pan"]);
  const noFx = C.normTrack(Object.assign({}, t, { fx: [] }));
  assert.deepEqual(noFx.auto.map((x) => x.k), ["vol", "pan"]);
  // limits
  const many = Array.from({ length: 400 }, (_, i) => [i, -1]);
  assert.equal(C.normAuto([{ k: "vol", p: many }]).length, 1);
  assert.equal(C.normAuto([{ k: "vol", p: many }])[0].p.length, C.MAX_PTS);
  assert.equal(C.normAuto(Array.from({ length: 30 }, (_, i) => ({ k: "fx.fslot" + String(i).padStart(3, "0") + ".1", p: [[0, 1]] })),
    Array.from({ length: 30 }, (_, i) => ({ u: "fslot" + String(i).padStart(3, "0") }))).length, C.MAX_LANES);
  assert.deepEqual(C.laneFx("fx.fabc1234.12"), { u: "fabc1234", i: 12 });
  assert.equal(C.laneFx("fx.fabc1234.99"), null);
  assert.equal(C.fxLaneKey("fabc1234", 3), "fx.fabc1234.3");
});

test("automation: values between points are a straight line, held at both ends", () => {
  const p = [[1, 0], [3, -10], [3, -20], [5, 10]];
  near(C.autoValueAt(p, 0), 0);                 // before the first point
  near(C.autoValueAt(p, 1), 0);
  near(C.autoValueAt(p, 2), -5);
  near(C.autoValueAt(p, 2.5), -7.5);
  near(C.autoValueAt(p, 3), -20);               // a step: the later point wins at its time
  near(C.autoValueAt(p, 4), -5);
  near(C.autoValueAt(p, 99), 10);               // after the last
  assert.ok(isNaN(C.autoValueAt([], 1)));
  // events for an AudioParam, from 2 s to 4.5 s
  assert.deepEqual(C.autoEvents(p, 2, 4.5), [
    { at: 0, v: -5, ramp: false },
    { at: 1, v: -10, ramp: true },
    { at: 1, v: -20, ramp: false },             // the jump
    { at: 2.5, v: 2.5, ramp: true }
  ]);
  // a loop pass that starts on a point and ends past the last
  assert.deepEqual(C.autoEvents(p, 1, 8), [
    { at: 0, v: 0, ramp: false }, { at: 2, v: -10, ramp: true }, { at: 2, v: -20, ramp: false },
    { at: 4, v: 10, ramp: true }, { at: 7, v: 10, ramp: true }
  ]);
  assert.deepEqual(C.autoEvents([], 0, 1), []);
  // the active lane of a track
  const tr = C.normTrack(T("ttrack01", 1, { auto: [{ k: "vol", p: [[0, -6]] }, { k: "pan", on: false, p: [[0, 10]] }] }));
  assert.equal(C.activeLane(tr, "vol").p[0][1], -6);
  assert.equal(C.activeLane(tr, "pan"), null);
});

test("automation and sidechain: projects from before keep the very same bytes", () => {
  // a slice written by Studio 1.3 (before automation and sidechain)
  const old = {
    ver: 1,
    projects: [{ id: "pproject1", m: 5, name: "Song", bpm: 120, sig: 4, vol: 0, loop: { on: false, a: 0, b: 0 }, fx: [{ u: "fmaster01", id: "reverb", on: true, s: { 4: 50 } }] }],
    tracks: [{ id: "ttrack01", m: 5, p: "pproject1", name: "Drums", color: C.COLORS[0], vol: -3, pan: 10, mute: false, solo: false, ord: 0, fx: [{ u: "fabc1234", id: "tilt", on: true, s: { 1: 2 } }] }],
    sources: [], clips: [], tombs: {}
  };
  assert.equal(JSON.stringify(C.mergeStudio(old, old)), JSON.stringify(old));
  // the new fields ride along through a merge, and win by their stamp
  const neu = JSON.parse(JSON.stringify(old));
  neu.tracks[0].m = 6;
  neu.tracks[0].auto = [{ k: "vol", p: [[0, -3], [4, -60]] }];
  neu.tracks[0].fx.push({ u: "fduck0001", id: "sidechain_ducker", on: true, s: {}, sc: "ttrack02" });
  const m1 = C.mergeStudio(old, neu), m2 = C.mergeStudio(neu, old);
  assert.deepEqual(m1, m2);
  assert.deepEqual(m1.tracks[0].auto, neu.tracks[0].auto);
  assert.equal(m1.tracks[0].fx[1].sc, "ttrack02");
  assert.equal(C.normFx([{ u: "fduck0001", id: "sidechain_ducker", sc: "../x" }])[0].sc, undefined);
});

test("sidechain: keys, loops and the connection plan", () => {
  const duck = (u, sc, on) => ({ u, id: "sidechain_ducker", on: on !== false, s: {}, sc });
  const A = C.normTrack(T("ttrackaa", 1, { fx: [duck("fduck0001", "ttrackbb")] }));
  const B = C.normTrack(T("ttrackbb", 1, { fx: [duck("fduck0002", "ttrackcc")] }));
  const Cc = C.normTrack(T("ttrackcc", 1, { fx: [duck("fduck0003", "ttrackaa"), duck("fduck0004", "ttrackbb", false)] }));
  assert.deepEqual(C.keysOf(Cc), ["ttrackaa"]);              // a bypassed effect does not listen
  const trs = [A, B, Cc];
  assert.equal(C.keyLoops(trs, "ttrackaa", "ttrackaa"), true);  // itself
  assert.equal(C.keyLoops([A], "ttrackcc", "ttrackaa"), false);  // b no longer hears c
  assert.equal(C.keyLoops(trs, "ttrackbb", "ttrackcc"), true);  // c hears a, a hears b
  // a loop that came in through sync: the edge that would close it is left out
  const plan = C.keyPlan(trs);
  assert.deepEqual(plan, { ttrackaa: { ttrackbb: true }, ttrackbb: { ttrackcc: true } });
  assert.deepEqual(C.keyPlan([A]), {});                       // a key track that is gone
});

test("sidechain + automation: the chain processor ducks on the key and follows its params", () => {
  let Proc = null;
  const posted = [];
  globalThis.sampleRate = 48000;
  globalThis.currentTime = 0;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: (m) => posted.push(m) }; } };
  globalThis.registerProcessor = (name, cls) => { assert.equal(name, "studio-fx-chain"); Proc = cls; };
  require(path.join(ROOT, "studio/nullfx/runtime/eel-rt.js"));
  require(path.join(ROOT, "studio/nullfx/runtime/null-fx.js"));
  require(path.join(ROOT, "studio/nullfx/fx/sidechain_ducker.js"));
  require(path.join(ROOT, "studio/fxchain.worklet.js"));
  assert.ok(Proc);
  assert.equal(Proc.parameterDescriptors.length, 16);
  const p = new Proc({ processorOptions: { chain: [{ uid: "fduck0001", id: "sidechain_ducker", sliders: {}, key: 1 }] } });
  const blk = (v) => [new Float32Array(128).fill(v), new Float32Array(128).fill(v)];
  const run = (key, n, params) => { const out = blk(0); for (let i = 0; i < n; i++) p.process([blk(0.5), key ? blk(0.9) : []], [out], params || {}); return out[0][127]; };
  near(run(false, 50), 0.5, 1e-6);                          // no key: untouched
  near(run(true, 300), 0.5 * Math.pow(10, -12 / 20), 1e-3);  // key over the threshold: down by the depth (-12 dB)
  // automation: param a0 drives the depth slider (2), stepped and clamped to its range
  p.onMessage({ type: "auto", map: [{ k: 0, uid: "fduck0001", i: 2, inc: 0.1, min: -40, max: 0 }] });
  near(run(true, 300, { a0: new Float32Array([-90]) }), 0.5 * Math.pow(10, -40 / 20), 1e-3);
  assert.equal(p.slots[0].fx.inst.getSlider(2), -40);
  run(true, 2, { a0: new Float32Array([-6.04]) });
  near(p.slots[0].fx.inst.getSlider(2), -6, 1e-9);
  // an unmapped or unset param changes nothing
  run(true, 2, { a0: new Float32Array([-3e38]) });
  near(p.slots[0].fx.inst.getSlider(2), -6, 1e-9);
  // a slot without a key listens to silence
  p.onMessage({ type: "chain", chain: [{ uid: "fduck0001", id: "sidechain_ducker", sliders: {}, key: 0 }] });
  p.onMessage({ type: "auto", map: [] });
  p.onMessage({ type: "slider", uid: "fduck0001", i: 2, v: -12 });
  near(run(true, 3000), 0.5, 1e-3);
  delete globalThis.registerProcessor; delete globalThis.AudioWorkletProcessor; delete globalThis.sampleRate; delete globalThis.currentTime;
});

test("instrument: NULL Drum Machine in the chain processor plays MIDI and the transport at their samples", () => {
  let Proc = null;
  const posted = [];
  globalThis.sampleRate = 48000;
  globalThis.currentTime = 0;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: (m) => posted.push(m) }; } };
  globalThis.registerProcessor = (name, cls) => { Proc = cls; };
  require(path.join(ROOT, "studio/nullfx/runtime/eel-rt.js"));
  require(path.join(ROOT, "studio/nullfx/runtime/null-fx.js"));
  require(path.join(ROOT, "studio/nullfx/fx/drum_machine.js"));
  delete require.cache[require.resolve(path.join(ROOT, "studio/fxchain.worklet.js"))];
  require(path.join(ROOT, "studio/fxchain.worklet.js"));
  const sr = 48000;
  // runs n blocks from frame `from` (the audio clock moves with them); returns both channels
  const run = (p, from, n) => {
    const L = new Float32Array(n * 128), R = new Float32Array(n * 128);
    for (let b = 0; b < n; b++) {
      globalThis.currentTime = (from + b * 128) / sr;
      const out = [new Float32Array(128), new Float32Array(128)];
      p.process([[]], [out], {});
      L.set(out[0], b * 128); R.set(out[1], b * 128);
    }
    return [L, R];
  };
  const first = (y) => { for (let i = 0; i < y[0].length; i++) if (y[0][i] !== 0 || y[1][i] !== 0) return i; return -1; };
  // Pattern Off: a note sent ahead sounds from its own sample; the input is ignored
  let p = new Proc({ processorOptions: { chain: [{ uid: "fdrum0001", id: "drum_machine", sliders: { 1: 0 } }] } });
  p.onMessage({ type: "midi", ev: [[(1000 + 77) / sr, 0x99, 36, 120], [(1000 + 900) / sr, 0x89, 36, 0]] });
  let y = run(p, 0, 40);
  assert.equal(first(y), 1077);
  // House (the default) starts with the transport at its sample; stop drops what waits
  p = new Proc({ processorOptions: { chain: [{ uid: "fdrum0001", id: "drum_machine", sliders: {} }] } });
  p.onMessage({ type: "time", at: 3000 / sr, playing: true, tempo: 120, position: 0 });
  y = run(p, 0, 60);
  assert.ok(Math.abs(first(y) - 3000) <= 1, "step 1 at the transport's sample (rounding: one sample): " + first(y));
  p.onMessage({ type: "midi", ev: [[1, 0x99, 38, 100]] });
  p.onMessage({ type: "time", playing: false });
  assert.equal(p.sched.midi.length, 0);
  // the drawn pattern (state) and a voice from the interface (vars); the hit flashes once
  const st = [1].concat(new Array(170).fill(0));
  st[1 + 160] = 16;
  p = new Proc({ processorOptions: { chain: [{ uid: "fdrum0001", id: "drum_machine", sliders: { 1: 1 }, state: st }] } });
  assert.equal(p.slots[0].fx.inst.mem.r(0), 0, "state from the chain item: the basic beat is gone");
  p.onMessage({ type: "vars", uid: "fdrum0001", vars: { dm_preview: 2, other: 5 } });
  y = run(p, 0, 4);
  assert.ok(first(y) >= 0 && first(y) < 128, "the snare from the interface sounds at once");
  p.onMessage({ type: "peek", uid: "fdrum0001", req: 7 });
  const live = posted.filter((m) => m.type === "live" && m.req === 7)[0];
  assert.equal(live.flash[0].data[1], 1, "the snare's hit, for the interface");
  p.onMessage({ type: "peek", uid: "fdrum0001", req: 8 });
  assert.equal(posted.filter((m) => m.req === 8)[0].flash[0].data[1], 0, "handed over once");
  // an export: MIDI and transport in processorOptions
  p = new Proc({ processorOptions: { chain: [{ uid: "fdrum0001", id: "drum_machine", sliders: { 1: 0 } }], midi: [[500 / sr, 0x99, 42, 90]], times: [{ at: 0, playing: true, position: 0, tempo: 120 }] } });
  assert.equal(first(run(p, 0, 10)), 500);
  delete globalThis.registerProcessor; delete globalThis.AudioWorkletProcessor; delete globalThis.sampleRate; delete globalThis.currentTime;
});

test("instrument: a multi-out instrument (NULL Drum Machine 3.0, 8 pins) is listed and plays all its pins", async () => {
  // the catalog: the real index.json through StudioFX's loadCatalog
  const idx = JSON.parse(read("studio/nullfx/fx/index.json"));
  const dm = idx.instruments.filter((e) => e.id === "drum_machine")[0];
  assert.ok(dm && dm.ins === 0 && dm.outs >= 2, "the synced catalog has the Drum Machine");
  globalThis.window = {};
  globalThis.fetch = async () => ({ ok: true, json: async () => idx });
  delete require.cache[require.resolve(path.join(ROOT, "studio/fx.js"))];
  require(path.join(ROOT, "studio/fx.js"));
  const F = globalThis.window.StudioFX({ C, t: (k) => k, el: () => null, setLabel: () => {}, version: "test" });
  await F.loadCatalog();
  const ids = F.instruments().map((e) => e.id);
  assert.ok(ids.includes("drum_machine"), "Drum Machine is an instrument again: " + ids.join(","));
  assert.ok(F.isInstrument("drum_machine"));
  idx.instruments.forEach((e) => assert.equal(ids.includes(e.id), e.ins === 0 && e.outs >= 2 && e.outs <= 16 && e.outs % 2 === 0, e.id));
  delete globalThis.window; delete globalThis.fetch;

  // the chain processor: Outputs = Groups puts snare, clap, hats and toms on pins 3-8;
  // Studio mixes them into pins 1/2, so the whole kit sounds in both modes, with no
  // error and no new buffers per block
  let Proc = null;
  const posted = [];
  globalThis.sampleRate = 48000;
  globalThis.currentTime = 0;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: (m) => posted.push(m) }; } };
  globalThis.registerProcessor = (name, cls) => { Proc = cls; };
  require(path.join(ROOT, "studio/nullfx/runtime/eel-rt.js"));
  require(path.join(ROOT, "studio/nullfx/runtime/null-fx.js"));
  require(path.join(ROOT, "studio/nullfx/fx/drum_machine.js"));
  delete require.cache[require.resolve(path.join(ROOT, "studio/fxchain.worklet.js"))];
  require(path.join(ROOT, "studio/fxchain.worklet.js"));
  const sr = 48000, BL = 40;
  // returns the chain's output (L, R), the energy on pins 3-8, and pins 1/2 as the effect wrote them
  const play = (groups, notes) => {
    const p = new Proc({ processorOptions: { chain: [{ uid: "fdrum0001", id: "drum_machine", sliders: { 1: 0, 63: groups } }], midi: notes.map((nt, j) => [(100 + j * 50) / sr, 0x99, nt, 120]) } });
    const s = p.slots[0];
    assert.equal(s.outs.length, 8);
    assert.equal(s.outs[0], p.a[0]);
    assert.equal(s.outs[1], p.a[1]);
    const extra = s.outs.slice(2);
    const L = new Float32Array(BL * 128), R = new Float32Array(BL * 128), own = new Float32Array(BL * 128);
    let side = 0;
    const mix = p.mixDown;
    p.mixDown = function (o, n) { own.set(o[0].subarray(0, n), cur * 128); return mix.call(this, o, n); };
    let cur = 0;
    for (; cur < BL; cur++) {
      globalThis.currentTime = cur * 128 / sr;
      const out = [new Float32Array(128), new Float32Array(128)];
      p.process([[]], [out], {});
      L.set(out[0], cur * 128); R.set(out[1], cur * 128);
      extra.forEach((x) => { for (let i = 0; i < 128; i++) side += x[i] * x[i]; });
    }
    assert.ok(s.outs.slice(2).every((x, i) => x === extra[i]), "the same buffers every block");
    assert.equal(s.bypass, false);
    return { L, R, side, own };
  };
  const energy = (y) => { let e = 0; for (let i = 0; i < y.L.length; i++) e += y.L[i] * y.L[i] + y.R[i] * y.R[i]; return e; };
  const kit = [36, 38, 42, 45];
  const main = play(0, kit);
  assert.ok(energy(main) > 0.01 && main.side === 0, "Main: pins 3-8 silent");
  assert.deepEqual(Array.from(main.L), Array.from(main.own), "Main: the output is the effect's own pins 1/2, sample for sample");
  const groups = play(1, kit);
  assert.ok(groups.side > 0.01, "Groups: snare, hats and toms on their own pins");
  const snare = play(1, [38]);
  assert.ok(energy(snare) > 0.01 && snare.side > 0.01, "Groups: the snare comes through the mix-down");
  let d = 0;
  for (let i = 0; i < main.L.length; i++) d = Math.max(d, Math.abs(main.L[i] - groups.L[i]), Math.abs(main.R[i] - groups.R[i]));
  assert.ok(d < 1e-4, "Groups mixed down sounds like Main (default kit, no drive): " + d);
  assert.equal(posted.filter((m) => m.type === "error" || m.type === "missing").length, 0);
  // a stereo effect still writes straight into the chain's pair
  const p2 = new Proc({ processorOptions: { chain: [{ uid: "fdrum0001", id: "drum_machine", sliders: {} }] } });
  assert.equal(p2.outsFor({ outPins: ["L", "R"] }), p2.a);
  assert.equal(p2.outsFor({ outPins: new Array(40).fill("x") }).length, 16);
  delete globalThis.registerProcessor; delete globalThis.AudioWorkletProcessor; delete globalThis.sampleRate; delete globalThis.currentTime;
});

// ---------- MP3 ----------
function parseFrames(bytes) {
  let o = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) o = 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]);
  const frames = [];
  const KB = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], SR = [44100, 48000, 32000];
  while (o + 4 <= bytes.length) {
    assert.equal(bytes[o], 0xff, "sync at " + o);
    assert.equal(bytes[o + 1], 0xfb, "MPEG-1 Layer III, no CRC at " + o);
    const kbps = KB[bytes[o + 2] >> 4], rate = SR[(bytes[o + 2] >> 2) & 3], pad = (bytes[o + 2] >> 1) & 1, mode = bytes[o + 3] >> 6;
    const len = Math.floor(144000 * kbps / rate) + pad;
    frames.push({ o, len, kbps, rate, pad, mode });
    o += len;
  }
  assert.equal(o, bytes.length, "frames fill the file");
  return frames;
}
// MSB-first bit reader
function Bits(b, pos) { this.b = b; this.p = pos * 8; }
Bits.prototype.get = function (n) { let v = 0; for (let i = 0; i < n; i++) { v = v * 2 + ((this.b[this.p >> 3] >> (7 - (this.p & 7))) & 1); this.p++; } return v; };

test("mp3: Huffman tables are complete prefix codes", () => {
  const H = E._test.HUFF;
  Object.keys(H).forEach((k) => {
    const a = H[k], codes = [];
    let kraft = 0;
    for (let i = 0; i < a.length; i += 2) { kraft += Math.pow(2, -a[i + 1]); codes.push(a[i].toString(2).padStart(a[i + 1], "0")); }
    near(kraft, 1, 1e-12);
    codes.forEach((c, i) => codes.forEach((d, j) => { if (i !== j) assert.ok(!d.startsWith(c), "table " + k + ": " + c + " is a prefix of " + d); }));
  });
  // ISO table 1 and count1 table B, as printed in the standard
  assert.deepEqual(H[1], [1, 1, 1, 3, 1, 2, 0, 3]);
  assert.deepEqual(H[33].filter((_, i) => i % 2 === 0), [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
});

test("mp3: frame sizes, headers, Info tag and side info", () => {
  // 44.1 kHz pads one byte where 144 * bitrate / rate adds up
  const sizes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => E.mp3FrameBytes(44100, 128, n));
  assert.ok(sizes.every((x) => x === 417 || x === 418));
  const avg = Array.from({ length: 441 }, (_, n) => E.mp3FrameBytes(44100, 128, n)).reduce((a, b) => a + b) / 441;
  near(avg, 144000 * 128 / 44100, 1e-9);
  assert.equal(E.mp3FrameBytes(48000, 192, 7), 576);
  assert.deepEqual(E.mp3Header(48000, 320, 2, false), [0xff, 0xfb, 0xe4, 0x04]);
  assert.deepEqual(E.mp3Header(44100, 128, 1, true), [0xff, 0xfb, 0x92, 0xc4]);
  assert.throws(() => E.mp3Header(22050, 128, 2, false));
  assert.throws(() => E.mp3Header(44100, 100, 2, false));

  const sr = 48000, n = sr, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / sr); R[i] = 0.25 * Math.sin(2 * Math.PI * 300 * i / sr); }
  const enc = new E.Mp3Encoder([L, R], sr, 192, { title: "Τραγούδι" });
  while (!enc.step(7)) { /* in slices */ }
  assert.equal(enc.progress(), 1);
  const bytes = enc.bytes();
  // ID3v2.4 with TIT2 in UTF-8
  assert.equal(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]), "ID3\u0004");
  const tagText = Buffer.from(bytes.subarray(0, 80)).toString("utf8");
  assert.ok(tagText.includes("TIT2") && tagText.includes("Τραγούδι") && tagText.includes("orOS Studio"));
  const frames = parseFrames(bytes);
  const audio = frames.slice(1);
  assert.equal(audio.length, Math.ceil((n + 576) / 1152) + 1);
  frames.forEach((f) => { assert.equal(f.kbps, 192); assert.equal(f.rate, sr); assert.equal(f.mode, 0); });
  // Info tag: frame count, bytes, encoder delay and padding, CRC
  const info = frames[0], io = info.o + 4 + 32;
  assert.equal(Buffer.from(bytes.subarray(io, io + 4)).toString("latin1"), "Info");
  const dv = new DataView(bytes.buffer, bytes.byteOffset);
  assert.equal(dv.getUint32(io + 8), audio.length);
  assert.equal(dv.getUint32(io + 12), bytes.length - frames[0].o);
  const lame = io + 120, delay = (bytes[lame + 21] << 4) | (bytes[lame + 22] >> 4), pad = ((bytes[lame + 22] & 15) << 8) | bytes[lame + 23];
  assert.equal(delay, E.ENC_DELAY);
  assert.equal(delay + n + pad, audio.length * 1152);         // a decoder that honours the tag plays exactly n samples
  assert.equal(dv.getUint16(lame + 34), E.crc16(bytes.subarray(info.o), lame + 34 - info.o));
  // side info of every audio frame: no reservoir, and the granules' bits fit the frame
  audio.forEach((f) => {
    const b = new Bits(bytes, f.o + 4);
    assert.equal(b.get(9), 0);                               // main_data_begin
    b.get(3); b.get(4); b.get(4);                            // private, scfsi
    let used = 0;
    for (let g = 0; g < 4; g++) {
      const p23 = b.get(12), bv = b.get(9), gain = b.get(8), sfc = b.get(4), ws = b.get(1);
      assert.ok(bv <= 288 && gain <= 255);
      assert.equal(sfc, 0); assert.equal(ws, 0);
      const ts = [b.get(5), b.get(5), b.get(5)];
      ts.forEach((x) => assert.ok([4, 14].indexOf(x) < 0, "table " + x + " does not exist"));
      b.get(4); b.get(3); b.get(1); b.get(1); b.get(1);
      used += p23;
    }
    assert.equal(b.p, (f.o + 36) * 8);
    assert.ok(used <= (f.len - 36) * 8, "main data fits");
  });
});

test("mp3: the bitstream decodes back to the quantised values", () => {
  // Read the first granule of a frame back with the encoder's own tables and
  // compare with what the encoder quantised.
  const Tt = E._test;
  const xr = new Float64Array(576);
  for (let i = 0; i < 576; i++) xr[i] = (i < 300 ? 0.02 * Math.sin(i * 0.37) * (1 + (i % 7)) : (i < 330 ? 0.0004 * ((i % 3) - 1) : 0)) * (i === 5 ? 40 : 1);
  const sfb = Tt.SFB_L[1];
  const q = Tt.quantise(xr, sfb, 2000);
  assert.ok(q.bits <= 2000 && q.bits > 0);
  // write the main data as the encoder does, then read it with an inverse table
  const enc = new E.Mp3Encoder([new Float32Array(0)], 48000, 128);
  assert.ok(enc);
  const inv = {};
  Object.keys(Tt.HUFF).forEach((k) => { inv[k] = {}; const a = Tt.HUFF[k]; for (let i = 0; i < a.length; i += 2) inv[k][a[i + 1] + ":" + a[i]] = i / 2; });
  // re-create the bits through the public path: one granule in a frame buffer
  const W = function (n) { this.buf = new Uint8Array(n); this.pos = 0; };
  W.prototype.put = function (val, n) { for (let i = n - 1; i >= 0; i--) { if ((val >> i) & 1) this.buf[this.pos >> 3] |= 128 >> (this.pos & 7); this.pos++; } };
  const w = new W(1000);
  // mirror of writeMain, through the encoder's tables
  const lay = q, ix = q.ix, bigEnd = lay.bv * 2;
  for (let i = 0; i < bigEnd; i += 2) {
    const tn = i < lay.e1 ? lay.tsel[0] : i < lay.e2 ? lay.tsel[1] : lay.tsel[2];
    if (!tn) continue;
    const T = Tt.TABLES[tn], x = ix[i], y = ix[i + 1], o = (Math.min(x, 15) * T.xlen + Math.min(y, 15)) * 2;
    w.put(T.a[o], T.a[o + 1]);
    if (x) { if (T.lin && x >= 15) w.put(x - 15, T.lin); w.put(xr[i] < 0 ? 1 : 0, 1); }
    if (y) { if (T.lin && y >= 15) w.put(y - 15, T.lin); w.put(xr[i + 1] < 0 ? 1 : 0, 1); }
  }
  for (let i = bigEnd; i < bigEnd + lay.count1 * 4; i += 4) {
    const v = ix[i] * 8 + ix[i + 1] * 4 + ix[i + 2] * 2 + ix[i + 3];
    if (lay.c1) w.put(15 - v, 4); else w.put(Tt.HUFF[32][v * 2], Tt.HUFF[32][v * 2 + 1]);
    for (let k = 0; k < 4; k++) if (ix[i + k]) w.put(xr[i + k] < 0 ? 1 : 0, 1);
  }
  assert.equal(w.pos, q.bits, "the bit count matches what is written");
  // decode
  const r = new Bits(w.buf, 0), out = new Int32Array(576);
  const readCode = (tbl) => { let code = 0; for (let len = 1; len <= 19; len++) { code = code * 2 + r.get(1); const hit = inv[tbl][len + ":" + code]; if (hit !== undefined) return hit; } throw new Error("bad code"); };
  for (let i = 0; i < bigEnd; i += 2) {
    const tn = i < lay.e1 ? lay.tsel[0] : i < lay.e2 ? lay.tsel[1] : lay.tsel[2];
    if (!tn) { out[i] = out[i + 1] = 0; continue; }
    const T = Tt.TABLES[tn], base = tn >= 24 ? 24 : tn >= 16 ? 16 : tn, v = readCode(base);
    let x = Math.floor(v / T.xlen), y = v % T.xlen;
    if (T.lin && x === 15) x += r.get(T.lin);
    if (x && r.get(1)) x = -x;
    if (T.lin && y === 15) y += r.get(T.lin);
    if (y && r.get(1)) y = -y;
    out[i] = x; out[i + 1] = y;
  }
  for (let i = bigEnd; i < bigEnd + lay.count1 * 4; i += 4) {
    const v = lay.c1 ? 15 - r.get(4) : readCode(32);
    const q4 = [(v >> 3) & 1, (v >> 2) & 1, (v >> 1) & 1, v & 1];
    for (let k = 0; k < 4; k++) out[i + k] = q4[k] && r.get(1) ? -q4[k] : q4[k];
  }
  for (let i = 0; i < 576; i++) assert.equal(Math.abs(out[i]), ix[i], "line " + i);
  for (let i = 0; i < 576; i++) if (ix[i]) assert.equal(out[i] < 0, xr[i] < 0, "sign " + i);
  // and the dequantised values come close to the input
  const step = Math.pow(2, (q.gain - 210) / 4);
  let err = 0, sig = 0;
  for (let i = 0; i < 576; i++) { const d = Math.sign(out[i]) * Math.pow(Math.abs(out[i]), 4 / 3) * step; err += (d - xr[i]) ** 2; sig += xr[i] ** 2; }
  assert.ok(10 * Math.log10(sig / err) > 15, "SNR " + 10 * Math.log10(sig / err));
});

test("mp3: silence and mono encode to valid frames", () => {
  const enc = new E.Mp3Encoder([new Float32Array(5000)], 44100, 128);
  while (!enc.step(100)) { /* go on */ }
  const fr = parseFrames(enc.bytes());
  assert.ok(fr.length >= 3);
  fr.forEach((f) => assert.equal(f.mode, 3));
  assert.throws(() => new E.Mp3Encoder([new Float32Array(10)], 22050, 128));
});

// ---------- Ogg Opus ----------
function oggPages(bytes) {
  const pages = [];
  let o = 0;
  while (o < bytes.length) {
    assert.equal(Buffer.from(bytes.subarray(o, o + 4)).toString("latin1"), "OggS");
    const nseg = bytes[o + 26], segs = Array.from(bytes.subarray(o + 27, o + 27 + nseg)), body = segs.reduce((a, b) => a + b, 0);
    const dv = new DataView(bytes.buffer, bytes.byteOffset + o);
    const page = bytes.slice(o, o + 27 + nseg + body);
    const crc = dv.getUint32(22, true);
    page[22] = page[23] = page[24] = page[25] = 0;
    assert.equal(E.oggCrc(page), crc, "page CRC");
    pages.push({ flags: bytes[o + 5], granule: dv.getUint32(6, true) + dv.getUint32(10, true) * 4294967296, serial: dv.getUint32(14, true), seq: dv.getUint32(18, true), segs, body: bytes.subarray(o + 27 + nseg, o + 27 + nseg + body) });
    o += 27 + nseg + body;
  }
  return pages;
}

test("ogg: CRC, lacing, page flags and granule positions", () => {
  assert.equal(E.oggCrc(new Uint8Array(0)), 0);
  assert.equal(E.oggCrc(Buffer.from("123456789")), 0x89a1897f);     // CRC-32/MPEG-2 check value
  const head = E.opusHead(2, 312, 48000);
  assert.equal(Buffer.from(head.subarray(0, 8)).toString("latin1"), "OpusHead");
  assert.equal(head[8], 1); assert.equal(head[9], 2);
  assert.equal(head[10] | (head[11] << 8), 312);
  const tags = E.opusTags("orOS", ["TITLE=Ωδή"]);
  assert.equal(Buffer.from(tags.subarray(0, 8)).toString("latin1"), "OpusTags");
  // packets of 960 samples, some longer than 255 bytes, and one that spans pages
  const pk = [];
  for (let i = 0; i < 40; i++) pk.push({ data: new Uint8Array(i === 7 ? 70000 : 100 + i * 9).fill(i), samples: 960 });
  const bytes = E.oggOpus(pk, { head, total: 40 * 960 - 500, title: "Ωδή", serial: 1234 });
  const pages = oggPages(bytes);
  assert.equal(pages[0].flags, 2);                                     // BOS, OpusHead alone
  assert.deepEqual(Array.from(pages[0].body), Array.from(head));
  assert.equal(pages[0].granule, 0);
  assert.ok(Buffer.from(pages[1].body).toString("utf8").includes("TITLE=Ωδή"));
  assert.equal(pages[pages.length - 1].flags & 4, 4);                  // EOS
  pages.forEach((p, i) => { assert.equal(p.seq, i); assert.equal(p.serial, 1234); });
  // the long packet spans pages: the continuation flag and an unset granule
  assert.ok(pages.some((p) => p.flags & 1));
  assert.ok(pages.some((p) => p.granule === 0xffffffff + 0xffffffff * 4294967296));
  // rebuild the packets from the lacing values
  const got = [];
  let cur = [];
  pages.slice(2).forEach((p) => {
    let o = 0;
    p.segs.forEach((s) => { cur.push(p.body.subarray(o, o + s)); o += s; if (s < 255) { got.push(Buffer.concat(cur)); cur = []; } });
  });
  assert.equal(got.length, pk.length);
  got.forEach((g, i) => assert.equal(g.length, pk[i].data.length));
  // granules count samples from the start (pre-skip included); the last one trims the end
  assert.equal(pages[pages.length - 1].granule, 312 + 40 * 960 - 500);
  const mids = pages.slice(2, -1).filter((p) => !(p.flags & 1) || p.granule < 1e15).map((p) => p.granule).filter((g) => g < 1e15);
  for (let i = 1; i < mids.length; i++) assert.ok(mids[i] > mids[i - 1]);
});

// ---------- MIDI ----------
test("midi: messages, notes and velocity", () => {
  assert.deepEqual(M.parse([0x90, 60, 100]), { type: "on", ch: 0, note: 60, vel: 100 });
  assert.deepEqual(M.parse([0x93, 64, 0]), { type: "off", ch: 3, note: 64, vel: 0 });      // note on, velocity 0
  assert.deepEqual(M.parse([0x80, 60, 64]), { type: "off", ch: 0, note: 60, vel: 64 });
  assert.deepEqual(M.parse([0xb0, 64, 127]), { type: "cc", ch: 0, cc: 64, val: 127 });       // sustain
  assert.deepEqual(M.parse([0xe0, 0, 64]), { type: "bend", ch: 0, val: 8192, bend: 0 });
  near(M.parse([0xe0, 127, 127]).bend, 1);
  near(M.parse([0xe0, 0, 0]).bend, -1);
  assert.equal(M.parse([0xf8]), null);                                                   // clock
  assert.equal(M.parse([0xf0, 1, 2, 0xf7]), null);                                       // sysex
  assert.equal(M.parse([0x40, 1, 2]), null);                                             // a data byte alone
  assert.equal(M.parse([0x90, 60]), null);                                               // too short
  assert.equal(M.parse(null), null);
  assert.deepEqual(M.parse(new Uint8Array([0x9f, 200, 255])), { type: "on", ch: 15, note: 72, vel: 127 });   // 7-bit data
  near(M.noteFreq(69), 440);
  near(M.noteFreq(60), 261.6255653005986, 1e-9);
  assert.equal(M.noteName(60), "C4");
  assert.equal(M.noteName(61), "C♯4");
  assert.equal(M.noteName(21), "A0");
  assert.equal(M.isBlack(61), true); assert.equal(M.isBlack(64), false);
  assert.equal(M.velGain(0), 0); assert.equal(M.velGain(127), 1);
  assert.ok(M.velGain(64) < 0.5);
  M.ORDER.forEach((id) => assert.ok(M.PRESETS[id], id));
});

// ---------- Wiring ----------
test("wave 39 wiring: scripts, strings, no code sinks, Web MIDI only on a click", () => {
  const html = read("studio/index.html"), js = read("studio/studio.js"), fx = read("studio/fx.js");
  ["encode.js", "midi.js"].forEach((f) => assert.ok(html.indexOf('src="' + f) > 0 && html.indexOf('src="' + f) < html.indexOf('src="studio.js'), f));
  assert.ok(fx.includes('addModule("fxchain.worklet.js?v="'));
  ["export-fmt", "export-kbps", "keys", "keys-btn", "kb-keys", "kb-connect", "track-auto"].forEach((id) => assert.ok(html.includes('id="' + id + '"'), id));
  [read("studio/encode.js"), read("studio/midi.js"), read("studio/fxchain.worklet.js")].forEach((src) =>
    assert.doesNotMatch(src, /\beval\(|new Function|innerHTML|insertAdjacentHTML|document\.write|MediaRecorder/));
  assert.doesNotMatch(js, /MediaRecorder/);
  // requestMIDIAccess lives in midi.js access(); studio.js calls it from the button, or when already allowed
  assert.doesNotMatch(js, /requestMIDIAccess/);
  assert.match(js, /\$\("kb-connect"\)\.addEventListener\("click", function \(\) \{ midiConnect\(true\); \}\);/);
  assert.match(js, /if \(prefs\.midi\) M\.known\(\)\.then\(function \(ok\) \{ if \(ok\) midiConnect\(false\); \}\);/);
  // the strings the new code uses exist in both languages
  ["au.", "kb.", "snd.", "fmt.", "export.", "fx.key"].forEach((pre) => {
    (js.match(new RegExp('t\\("(' + pre.replace(".", "\\.") + '[a-zA-Z.]*)"', "g")) || []).concat(fx.match(new RegExp('t\\("(' + pre.replace(".", "\\.") + '[a-zA-Z.]*)"', "g")) || []).forEach((m) => {
      const k = m.slice(3, -1);
      if (k.endsWith(".")) {                                 // a built key: "snd." + preset, "fmt." + format
        ({ "snd.": M.ORDER, "fmt.": ["wav", "mp3", "opus"] }[k] || []).forEach((id) => assert.equal((js.match(new RegExp('"' + k.replace(/\./g, "\\.") + id + '":', "g")) || []).length, 2, k + id));
        return;
      }
      assert.equal((js.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length, 2, k);
    });
  });
});
