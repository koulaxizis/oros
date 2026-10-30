// Studio sample instruments (Studio v1.9.0): the SFZ subset reader and
// region picker (studio/sfz.js), the voices it schedules, track.smp in
// core.js and .orosstudio packages, the pack list (studio/sounds.js) and
// the wiring in studio.js, index.html and sw.js.
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const S = require(path.join(ROOT, "studio", "sfz.js"));
const C = require(path.join(ROOT, "studio", "core.js"));
const P = require(path.join(ROOT, "studio", "package.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("parse: headers inherit, note names, a sample name with spaces, comments", () => {
  const r = S.parse([
    "// a comment",
    "<control> default_path=Keys\\Piano\\ octave_offset=0",
    "<global> ampeg_release=0.6 volume=-3",
    "<group> lovel=0 hivel=63 /* soft */",
    "<region> sample=Soft C4.wav lokey=c4 hikey=d#4 pitch_keycenter=c4",
    "<region> sample=Soft E4.wav key=e4 volume=2",
    "<group> lovel=64",
    "<region> sample=Loud C4.wav lokey=60 hikey=64 pitch_keycenter=62 tune=-12 transpose=1"
  ].join("\n"));
  assert.deepEqual(r.warnings, []);
  assert.equal(r.regions.length, 3);
  const [a, b, c] = r.regions;
  assert.deepEqual([a.sample, a.lokey, a.hikey, a.center, a.lovel, a.hivel, a.volume, a.release], ["Keys/Piano/Soft C4.wav", 60, 63, 60, 0, 63, -3, 0.6]);
  assert.deepEqual([b.sample, b.lokey, b.hikey, b.center, b.volume], ["Keys/Piano/Soft E4.wav", 64, 64, 64, 2]);
  assert.deepEqual([c.lovel, c.hivel, c.center, c.tune], [64, 127, 62, 88], "a new <group> drops the old group's opcodes");
  assert.equal(S.note("a0"), 21);
  assert.equal(S.note("C-1"), 0);
  assert.equal(S.note("bb3"), 58);
  assert.ok(isNaN(S.note("h2")));
});

test("parse: refuses samples outside the folder, unknown opcodes are named once, bounds", () => {
  const r = S.parse("<region> sample=../../etc/x.wav\n<region> sample=/abs.wav\n<region> sample=c:\\x.wav\n<region> sample=ok/../a.wav cutoff=200\n<region> sample=b.wav cutoff=300 trigger=legato\n<region> sample=c.wav lokey=70 hikey=60");
  assert.deepEqual(r.regions.map((x) => x.sample), ["a.wav"]);
  assert.ok(r.warnings.includes("cutoff ignored"));
  assert.equal(r.warnings.filter((w) => w === "cutoff ignored").length, 1);
  assert.ok(r.warnings.some((w) => /outside the folder/.test(w)));
  assert.ok(r.warnings.includes("trigger=legato not played"));
  assert.equal(S.samplePath("a\\b\\c.wav"), "a/b/c.wav");
  assert.equal(S.samplePath("https://x/y.wav"), null);
  const many = S.parse(Array.from({ length: S.MAX_REGIONS + 5 }, (_, i) => "<region> sample=s" + i + ".wav").join("\n"));
  assert.equal(many.regions.length, S.MAX_REGIONS);
  assert.ok(many.warnings.some((w) => /only the first/.test(w)));
  assert.deepEqual(S.samples(S.parse("<region> sample=a.wav <region> sample=b.wav <region> sample=a.wav").regions), ["a.wav", "b.wav"]);
});

test("pick: key and velocity ranges, round robin per range, random layers, release triggers", () => {
  const { regions } = S.parse([
    "<group> seq_length=2 <region> sample=rr1.wav lokey=60 hikey=62 seq_position=1 <region> sample=rr2.wav lokey=60 hikey=62 seq_position=2",
    "<group> <region> sample=lo.wav lokey=63 hikey=63 hirand=0.5 <region> sample=hi.wav lokey=63 hikey=63 lorand=0.5",
    "<region> sample=rel.wav lokey=60 hikey=60 trigger=release",
    "<region> sample=soft.wav lokey=70 hikey=70 hivel=40 <region> sample=loud.wav lokey=70 hikey=70 lovel=41"
  ].join("\n"));
  const rr = {};
  const names = (l) => l.map((x) => x.sample).join();
  assert.deepEqual([1, 2, 3].map(() => names(S.pick(regions, 61, 100, "attack", rr, 0.1))), ["rr1.wav", "rr2.wav", "rr1.wav"]);
  assert.equal(names(S.pick(regions, 63, 100, "attack", rr, 0.2)), "lo.wav");
  assert.equal(names(S.pick(regions, 63, 100, "attack", rr, 0.7)), "hi.wav");
  assert.equal(names(S.pick(regions, 60, 100, "release", rr, 0.7)), "rel.wav");
  assert.equal(names(S.pick(regions, 70, 40, "attack", rr, 0)), "soft.wav");
  assert.equal(names(S.pick(regions, 70, 41, "attack", rr, 0)), "loud.wav");
  assert.equal(names(S.pick(regions, 90, 41, "attack", rr, 0)), "");
});

test("velocity and the decoded sample's start (encoder padding skipped)", () => {
  const r = { veltrack: 100 };
  assert.equal(S.velAmp(r, 127), 1);
  assert.ok(Math.abs(S.velAmp(r, 64) - (64 / 127) ** 2) < 1e-12);
  assert.equal(S.velAmp({ veltrack: 0 }, 10), 1);
  const buf = (lead, n) => {
    const d = new Float32Array(n);
    for (let i = lead; i < n; i++) d[i] = 0.5;
    return { length: n, sampleRate: 44100, numberOfChannels: 2, getChannelData: (ch) => (ch ? new Float32Array(n) : d) };
  };
  assert.equal(S.lead(buf(1105, 20000)), 1105);
  assert.equal(S.lead(buf(0, 20000)), 0);
  assert.equal(S.lead(buf(30000, 40000)), 0, "more than 0.1 s of silence is the sound itself");
});

// a minimal Web Audio stand-in: records starts, stops and gain ramps
function fakeCtx() {
  const log = [];
  const param = (name) => ({ value: 1, events: [], setValueAtTime(v, t) { this.events.push(["set", v, t]); }, linearRampToValueAtTime(v, t) { this.events.push(["lin", v, t]); },
    setTargetAtTime(v, t, c) { this.events.push(["tgt", v, t, c]); }, cancelScheduledValues() {}, cancelAndHoldAtTime(t) { this.events.push(["hold", t]); }, name });
  const node = () => ({ connect() {}, disconnect() {} });
  return {
    log, currentTime: 0,
    createBufferSource() {
      const s = Object.assign(node(), { playbackRate: param("rate"), loop: false, start(t, off) { log.push(["start", t, off, s]); }, stop(t) { log.push(["stop", t]); } });
      return s;
    },
    createGain() { return Object.assign(node(), { gain: param("gain") }); },
    createStereoPanner() { return Object.assign(node(), { pan: param("pan") }); }
  };
}

test("playNote: pitch from the key centre, start after the padding, release after the note, then the release sample", () => {
  const { regions } = S.parse("<global> ampeg_release=0.4 <region> sample=a.mp3 lokey=0 hikey=127 pitch_keycenter=60 volume=6 <region> sample=r.mp3 lokey=0 hikey=127 trigger=release");
  const mk = (lead) => { const n = 44100; const d = new Float32Array(n).fill(0.25); d.fill(0, 0, lead); return { length: n, duration: 1, sampleRate: 44100, numberOfChannels: 1, getChannelData: () => d }; };
  const inst = new S.Instrument(regions, { "a.mp3": mk(1105), "r.mp3": mk(0) });
  const ctx = fakeCtx();
  const h = S.playNote(ctx, {}, inst, 72, 127, 1, 0.5, 1);
  const starts = ctx.log.filter((x) => x[0] === "start");
  assert.equal(starts.length, 2);
  assert.equal(starts[0][1], 1);
  assert.ok(Math.abs(starts[0][2] - 1105 / 44100) < 1e-12, "starts where the sound starts");
  assert.ok(Math.abs(starts[0][3].playbackRate.value - 2) < 1e-12, "an octave up");
  assert.equal(starts[1][1], 1.5, "the release sample starts at the note's end");
  assert.ok(h.end >= 1.5 && h.end <= 2.6);
  const g = ctx.log.filter((x) => x[0] === "start")[0][3];
  assert.ok(g, "source recorded");
  assert.equal(typeof h.stop, "function");
  assert.equal(typeof h.disconnect, "function");
  assert.equal(inst.leads["a.mp3"], 1105);
});

test("Live: notes, sustain pedal, all notes off, voice limit", () => {
  const { regions } = S.parse("<region> sample=a.mp3 ampeg_release=0.2");
  const d = new Float32Array(44100).fill(0.1);
  const inst = new S.Instrument(regions, { "a.mp3": { length: 44100, duration: 1, sampleRate: 44100, numberOfChannels: 1, getChannelData: () => d } });
  const ctx = fakeCtx();
  const L = new S.Live(ctx, {}, inst);
  L.noteOn(60, 100);
  assert.equal(L.voices.length, 1);
  L.setSustain(true);
  L.noteOff(60);
  assert.equal(L.voices[0].sus, true, "held by the pedal");
  L.setSustain(false);
  assert.equal(L.voices[0].sus, false);
  for (let i = 0; i < S.MAX_VOICES + 10; i++) L.noteOn(30 + (i % 60), 90);
  assert.ok(L.voices.length <= S.MAX_VOICES);
  L.midi({ type: "cc", cc: 123, val: 0 });
  assert.ok(L.voices.every((v) => !v.held));
});

test("track.smp: kept when valid, dropped otherwise, carried in packages", () => {
  const base = { id: "ttrack01", m: 1, p: "pproject1", name: "Piano", color: C.COLORS[0], inst: "piano" };
  assert.equal(C.normTrack(Object.assign({}, base, { smp: "vsco-upright-piano" })).smp, "vsco-upright-piano");
  assert.ok(!("smp" in C.normTrack(base)), "older tracks keep their bytes");
  assert.ok(!("smp" in C.normTrack(Object.assign({}, base, { smp: "../x" }))));
  assert.ok(!("smp" in C.normTrack(Object.assign({}, base, { smp: "A".repeat(10) }))));
  assert.ok(!("smp" in C.normTrack(Object.assign({}, base, { smp: undefined }))));
  const d = C.mergeStudio(C.emptyData(), Object.assign(C.emptyData(), {
    projects: [{ id: "pproject1", m: 1, name: "Song", bpm: 120, sig: 4 }],
    tracks: [Object.assign({}, base, { smp: "vsco-harp" })]
  }));
  const c = P.build(d, "pproject1", { src: {} }, {}).content;
  assert.equal(c.tracks[0].smp, "vsco-harp");
  let n = 0;
  const r = P.parse(JSON.parse(JSON.stringify(c)), { newId: (k) => k + "new" + String(++n).padStart(6, "0"), now: 5 });
  assert.equal(r.tracks[0].smp, "vsco-harp");
  assert.equal(r.tracks[0].inst, "piano", "the built-in fallback travels too");
});

test("sounds.js: the pack list is cleaned, downloads are kept in oros-sounds", async () => {
  const src = read("studio/sounds.js");
  const kept = {};
  const root = {
    caches: { open: () => Promise.resolve({ match: (u) => Promise.resolve(kept[u] || null), put: (u, r) => { kept[u] = r; return Promise.resolve(); }, keys: () => Promise.resolve([]) }) }
  };
  const index = { version: 1, packs: [
    { id: "vsco-harp", name: "Harp", category: "Strings", kind: "piano", lic: "cc0", by: "Versilian Studios", url: "https://github.com/sgossner/VSCO-2-CE", sfz: "instrument.sfz", bytes: 1000, files: 3 },
    { id: "../bad", name: "x", sfz: "a.sfz", bytes: 1 },
    { id: "huge", name: "x", sfz: "a.sfz", bytes: 1e9 },
    { id: "odd-kind", name: "x", sfz: "a.sfz", bytes: 10, kind: "<b>", url: "javascript:x" }
  ] };
  const res = (body) => ({ ok: true, json: () => Promise.resolve(body), clone() { return this; } });
  const fetched = [];
  const fetch = (u) => { fetched.push(u); return Promise.resolve(res(index)); };
  new Function("window", "fetch", src)(root, fetch);
  const SND = root.StudioSounds;
  const list = await SND.catalog();
  assert.deepEqual(list.map((p) => p.id), ["vsco-harp", "odd-kind"]);
  assert.equal(SND.find("odd-kind").kind, "piano");
  assert.equal(SND.find("odd-kind").url, "");
  assert.equal(fetched[0], "https://koulaxizis.github.io/oros-sounds/packs/index.json");
  assert.ok(kept[fetched[0]], "the list is kept for offline");
  assert.equal(SND.CACHE, "oros-sounds");
  assert.equal(SND.isReady([]), true);
  assert.equal(SND.isReady(["vsco-harp"]), false);
});

test("wiring: scripts, offline cache, sound lists, playback, export and credits", () => {
  const html = read("studio/index.html"), js = read("studio/studio.js"), sw = read("sw.js");
  const order = ["midi.js", "sfz.js", "sounds.js", "studio.js"].map((f) => html.indexOf('src="' + f + "?"));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), "sfz.js and sounds.js load before studio.js");
  assert.match(sw, /"studio\/sfz\.js",/);
  assert.match(sw, /"studio\/sounds\.js",/);
  assert.match(sw, /var SOUNDS_CACHE = "oros-sounds";/);
  assert.match(sw, /var keep = \[[^\]]*SOUNDS_CACHE/);
  assert.ok(!/oros-sounds\/packs\/[a-z]/.test(sw), "no pack is precached");
  assert.match(js, /SFZ\.playNote\(a, n\.input, si, q\.p, q\.v, at, dur, q\.g\)/);
  assert.match(js, /return SND\.ensure\(audio\(\) \|\| oc, projSmps\(\)\)/, "the export waits for every instrument");
  assert.match(js, /new SFZ\.Live\(actx, synthOut, si\)/);
  assert.match(js, /C\.credits\(data, proj\.id\)\.concat\(smpCredits\(\)\)/);
  assert.match(js, /o\.value = "sm:" \+ e\.id/);
  ["smp.group", "smp.loading", "smp.step", "smp.ready", "smp.fail", "smp.exportFail", "smp.credit"].forEach((k) => {
    assert.equal((js.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k + " in EN and EL");
  });
});
