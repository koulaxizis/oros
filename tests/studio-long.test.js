// Studio projects up to three hours (Πλανόδιο, 2026-11-21): the limits
// (core.js MAX_SEC, podcast.js LIM.dur), a two-hour project with a clip
// at 1:59:00, markers and an export range, and the long mix in parts
// (core.js partPlan / joinPart): the streaming MP3 encoder writes the
// same bytes as the whole-buffer one, the loudness meter fed in parts
// reports what one pass reports, and parts joined give the whole mix.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "studio", "core.js"));
const P = require(path.join(ROOT, "studio", "podcast.js"));
const E = require(path.join(ROOT, "studio", "encode.js"));
const M = require(path.join(ROOT, "studio", "meter.js"));
const K = require(path.join(ROOT, "studio", "package.js"));

function noise(n, seed) {
  let x = seed || 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { x = (x * 16807) % 2147483647; out[i] = ((x / 2147483647) - 0.5) * 0.6 * Math.sin(i / 900); }
  return out;
}

test("the limits are three hours, in Studio and in Publish as podcast", () => {
  assert.equal(C.MAX_SEC, 10800);
  assert.equal(P.LIM.dur, 10800);
  assert.equal(C.LONG_SEC, 3600, "up to an hour the mix is one part, as before");
});

test("a two-hour project: a clip at 1:59:00, markers past the hour, the export range", () => {
  const d = C.emptyData();
  const mk = [{ id: "kmarkaa0001", t: 0, n: "Αρχή" }, { id: "kmarkaa0002", t: 3725.5, n: "Δεύτερη ώρα" }, { id: "kmarkaa0003", t: 7140, n: "Τέλος" }];
  d.projects = [{ id: "pplanod01", m: 1, name: "Πλανόδιο", bpm: 120, sig: 4, vol: 0, loop: { on: false, a: 5400, b: 6300 }, fx: [], mk }];
  d.tracks = [{ id: "tvoice001", m: 1, p: "pplanod01", name: "Φωνή", color: C.COLORS[0], vol: 0, pan: 0, ord: 0, fx: [] }];
  d.sources = [{ id: "stalk0001", m: 1, p: "pplanod01", name: "talk.wav", path: "/internal/Studio/audio/talk-stalk0001.wav", dur: 7200, ch: 1 }];
  d.clips = [
    { id: "cwhole001", m: 1, p: "pplanod01", t: "tvoice001", s: "stalk0001", at: 0, off: 0, len: 7140, gain: 0, fi: 0, fo: 0 },
    { id: "clast0001", m: 1, p: "pplanod01", t: "tvoice001", s: "stalk0001", at: 7140, off: 7140, len: 60, gain: 0, fi: 0, fo: 2 }
  ];
  const data = C.mergeStudio(d, d);
  const clips = C.ofProject(data, "clips", "pplanod01");
  const last = clips.find((c) => c.id === "clast0001");
  assert.deepEqual([last.at, last.off, last.len], [7140, 7140, 60], "nothing is cut at the old one-hour limit");
  assert.equal(C.find(data, "sources", "stalk0001").dur, 7200);
  assert.equal(C.projectEnd(clips), 7200);
  assert.deepEqual(C.exportRange(C.find(data, "projects", "pplanod01"), clips), { a: 0, b: 7200 });
  const looped = Object.assign({}, C.find(data, "projects", "pplanod01"), { loop: { on: true, a: 5400, b: 6300 } });
  assert.deepEqual(C.exportRange(C.normProject(looped), clips), { a: 5400, b: 6300 }, "an export range past the hour");
  assert.equal(C.moveClip(last, 10000).at, 10000);
  assert.equal(C.moveClip(last, 99999).at, C.MAX_SEC);
  assert.equal(C.fmtTime(7140), "1:59:00.000");
  assert.equal(C.fmtTime(754.5), "12:34.500", "under an hour as before");
  // the markers become the episode's chapters, past the hour too
  const marks = P.normMarkers(C.find(data, "projects", "pplanod01").mk);
  assert.deepEqual(marks.map((x) => x.t), [0, 3725.5, 7140]);
  assert.deepEqual(P.chapters(marks, 7200, "Intro").map((c) => [c.start, c.end, c.title]),
    [[0, 3725.5, "Αρχή"], [3725.5, 7140, "Δεύτερη ώρα"], [7140, 7200, "Τέλος"]]);
  const ep = P.normEp({ file: "/internal/Studio/Podcasts/hshow0001/044-planodio.mp3", bytes: 9, dur: 7200 });
  assert.equal(ep.dur, 7200);
  // and through the .orosstudio package
  const pk = K.parse(JSON.parse(JSON.stringify(K.build(data, "pplanod01", {}, {}).content)), { newId: (k) => C.newId(k, Math.random), now: 2 });
  assert.equal(pk.clips.find((c) => c.at === 7140).len, 60);
  assert.deepEqual(pk.project.mk.map((x) => x.t), [0, 3725.5, 7140]);
});

test("partPlan: one part up to an hour, five-minute parts after, every sample once", () => {
  const short = C.partPlan({ a: 0, b: 3600 }, 44100);
  assert.deepEqual(short, [{ a: 0, b: 3600, skip: 0, len: 3600 * 44100, tail: 0, xf: 0, off: 0 }]);
  const r = { a: 12.5, b: 12.5 + 7200 }, rate = 44100, plan = C.partPlan(r, rate);
  assert.equal(plan.length, 24);
  let at = 0;
  plan.forEach((p, i) => {
    assert.equal(p.off, at);
    assert.equal(p.skip, i ? C.PART_PRE * rate : 0);
    assert.equal(p.tail, i < plan.length - 1 ? Math.round(C.PART_XF * rate) : 0);
    assert.ok(Math.abs((p.b - p.a) * rate - (p.skip + p.len + p.tail)) < 1e-3);
    assert.ok(Math.abs(p.a - (r.a + (p.off - p.skip) / rate)) < 1e-9);
    at += p.len;
  });
  assert.equal(at, 7200 * rate);
  assert.ok(C.partPlan({ a: 0, b: C.MAX_SEC }, 48000).every((p) => (p.skip + p.len + p.tail) * 2 * 4 < 128 * 1024 * 1024),
    "a part of a three-hour stereo mix at 48 kHz stays under 128 MB");
});

test("joinPart: parts rendered from the same signal give the whole mix", () => {
  const rate = 8000, r = { a: 0, b: 3700 };
  const plan = C.partPlan(r, rate);
  assert.equal(plan.length, 13);
  const sig = (i) => Math.sin(i / 37) * 0.5;               // what the renderer would give at sample i
  const whole = new Float32Array(plan.reduce((n, p) => n + p.len, 0));
  let tail = null;
  for (const p of plan) {
    const n = p.skip + p.len + p.tail, L = new Float32Array(n), R = new Float32Array(n);
    for (let i = 0; i < n; i++) { L[i] = sig(p.off - p.skip + i); R[i] = -L[i]; }
    const j = C.joinPart([L, R], p, tail);
    assert.equal(j.out[0].length, p.len);
    whole.set(j.out[0], p.off);
    tail = j.tail;
    if (p.tail) assert.notEqual(tail[0].buffer, L.buffer, "the tail is a copy, the part's buffer can go");
  }
  let worst = 0;
  for (let i = 0; i < whole.length; i++) worst = Math.max(worst, Math.abs(whole[i] - Math.fround(sig(i))));
  assert.ok(worst < 1e-6, "worst " + worst);
  // a seam where the two renders differ is faded over, never a jump
  const p1 = plan[1], a = new Float32Array(p1.skip + p1.len + p1.tail).fill(1);
  const j = C.joinPart([a], p1, [new Float32Array(p1.xf).fill(0)]);
  assert.ok(j.out[0][0] < 0.01 && j.out[0][p1.xf - 1] > 0.99 && j.out[0][p1.xf] === 1);
});

test("streaming MP3: parts pushed as they come give the same bytes as the whole buffer", () => {
  for (const [ch, kbps, n] of [[1, 96, 44100 * 7 + 123], [2, 128, 44100 * 5 + 1], [1, 64, 1152 * 3]]) {
    const chans = Array.from({ length: ch }, (_, c) => noise(n, 7 + c));
    const tags = { title: "Πλανόδιο 44", chapters: [{ start: 0, end: 2000, title: "Αρχή" }, { start: 2000, end: Math.round(n / 44.1), title: "Τέλος" }] };
    const whole = new E.Mp3Encoder(chans, 44100, kbps, { title: tags.title, tags });
    while (!whole.step(50)) { /* */ }
    const s = new E.Mp3Encoder(null, 44100, kbps, { title: tags.title, tags, channels: ch, samples: n });
    let at = 0, k = 0;
    const sizes = [1000, 50000, 777, 100000, 1152, 30000];
    while (at < n) {
      const len = Math.min(sizes[k++ % sizes.length], n - at);
      s.push(chans.map((d) => d.slice(at, at + len)));
      at += len;
      while (true) { const before = s.done; if (s.step(7) || s.done === before) break; }
    }
    while (!s.step(50)) { /* */ }
    assert.deepEqual(Buffer.from(s.bytes()), Buffer.from(whole.bytes()), ch + " ch, " + kbps + " kbit/s");
  }
  const s = new E.Mp3Encoder(null, 44100, 96, { channels: 1, samples: 10 });
  assert.throws(() => s.push([new Float32Array(11)]), /more samples/);
  assert.throws(() => new E.Mp3Encoder(null, 44100, 96, { channels: 1 }), /samples/);
  const empty = new E.Mp3Encoder(null, 44100, 96, { channels: 1, samples: 0 });
  assert.equal(empty.step(100), true);
});

test("loudness: a long mix measured part by part reports what one pass reports", () => {
  const rate = 48000, L = noise(rate * 9 + 50, 3), R = noise(rate * 9 + 50, 4);
  const one = M.analyse([L, R], rate);
  const A = M.Analysis.parts(rate, 2);
  for (let at = 0; at < L.length; at += 100000) A.feed([L.subarray(at, at + 100000), R.subarray(at, at + 100000)]);
  const parts = A.result();
  assert.equal(parts.ch, 2);
  for (const k of ["i", "lra", "tp", "sp", "rms", "floor", "dur", "clip"]) {
    if (Number.isFinite(one[k])) assert.ok(Math.abs(parts[k] - one[k]) < 1e-9, k + ": " + parts[k] + " vs " + one[k]);
    else assert.equal(parts[k], one[k], k);
  }
});

test("a long WAV: one header for the whole mix, then the parts' samples", () => {
  const a = [noise(1000, 1), noise(1000, 2)], b = [noise(500, 3), noise(500, 4)];
  const whole = C.wavBytes([Float32Array.from([...a[0], ...b[0]]), Float32Array.from([...a[1], ...b[1]])], 44100, 24);
  const parts = Buffer.concat([C.wavHeader(1500, 2, 44100, 24), C.wavBytes(a, 44100, 24).subarray(44), C.wavBytes(b, 44100, 24).subarray(44)]);
  assert.deepEqual(parts, Buffer.from(whole));
});
