// Studio .orosstudio (studio/package.js + bundle.js): one project packs
// into content.json (tracks, clips, MIDI notes, effect chains, automation,
// tempo, loop) with its audio and IR files in media/, reads back as a NEW
// project with fresh ids everywhere (sidechain keys and automation lanes
// follow their effects), and hostile content.json is cut down.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const C = require(path.join(ROOT, "studio", "core.js"));
const P = require(path.join(ROOT, "studio", "package.js"));

const MIME = "application/x-oros-studio";

function sample() {
  const d = C.emptyData();
  d.projects = [
    { id: "pabcdef1", m: 10, name: "Song", bpm: 96, sig: 3, vol: -2, loop: { on: true, a: 1, b: 5 },
      fx: [{ u: "fmaster01", id: "limiter", on: true, s: { 1: -0.5 } }] },
    { id: "pother01", m: 5, name: "Other", bpm: 120, sig: 4, vol: 0, loop: { on: false, a: 0, b: 0 }, fx: [] }
  ];
  d.tracks = [
    { id: "tvox0001", m: 10, p: "pabcdef1", name: "Vox", color: "#e06c75", vol: -3, pan: -20, mute: false, solo: true, ord: 0,
      fx: [{ u: "fconv001", id: "convolution", on: true, s: { 1: 0.3 }, f: { 2: "/internal/Studio/fx/Hall-sabcdefabcdef.wav" } },
           { u: "fduck001", id: "sc_ducker", on: false, s: { 1: -20, 2: 4 }, sc: "tkeys001" }],
      auto: [{ k: "vol", p: [[0, -3], [2, 0]] }, { k: "fx.fconv001.1", on: false, p: [[1, 0.1], [3, 0.9]] }] },
    { id: "tkeys001", m: 10, p: "pabcdef1", name: "Keys", color: "#4fc4cf", vol: 0, pan: 0, mute: true, solo: false, ord: 1, fx: [], inst: "epiano" },
    { id: "tzzz0001", m: 5, p: "pother01", name: "Elsewhere", color: "#4fc4cf", vol: 0, pan: 0, mute: false, solo: false, ord: 0, fx: [] }
  ];
  d.sources = [
    { id: "svox0001", m: 10, p: "pabcdef1", name: "take 1.wav", path: "/internal/Studio/audio/take-1-svox0001.wav", dur: 4, ch: 1 },
    { id: "sunused1", m: 10, p: "pabcdef1", name: "unused.wav", path: "/internal/Studio/audio/unused-sunused1.wav", dur: 1, ch: 2 }
  ];
  d.clips = [
    { id: "cvox0001", m: 10, p: "pabcdef1", t: "tvox0001", s: "svox0001", at: 0.5, off: 0.25, len: 3, gain: 2, fi: 0.1, fo: 0.2 },
    { id: "ckeys001", m: 10, p: "pabcdef1", t: "tkeys001", at: 0, off: 0, len: 2, gain: 0, fi: 0, fo: 0, name: "Riff",
      n: [[60, 0, 0.5, 100], [64, 0.5, 0.5, 90]] }
  ];
  return C.mergeStudio(d, d);
}

let n = 0;
const newId = (k) => k + "new" + String(++n).padStart(6, "0");

const SHA_A = "a".repeat(64), SHA_B = "b".repeat(64);
const keys = { src: { svox0001: SHA_A + ".wav" }, fx: { "/internal/Studio/fx/Hall-sabcdefabcdef.wav": SHA_B + ".wav" } };

test("build: only this project, every detail, media keys instead of disk paths", () => {
  const b = P.build(sample(), "pabcdef1", keys, { fxName: (id) => id.toUpperCase(), instName: (id) => "<" + id + ">" });
  const c = b.content;
  assert.equal(c.kind, "oros-studio-package");
  assert.equal(c.ver, 1);
  assert.equal(c.project.name, "Song");
  assert.equal(c.project.bpm, 96);
  assert.equal(c.project.sig, 3);
  assert.deepEqual(c.project.loop, { on: true, a: 1, b: 5 });
  assert.deepEqual(c.project.fx, [{ u: "fmaster01", id: "limiter", on: true, s: { 1: -0.5 } }]);
  assert.deepEqual(c.tracks.map((t) => t.id), ["tvox0001", "tkeys001"]);
  const vox = c.tracks[0];
  assert.deepEqual(vox.fx[0].f, { 2: { media: SHA_B + ".wav", name: "Hall" } });
  assert.equal(vox.fx[1].sc, "tkeys001");
  assert.equal(vox.auto.length, 2);
  assert.equal(c.tracks[1].inst, "epiano");
  assert.deepEqual(c.sources, [{ id: "svox0001", name: "take 1.wav", dur: 4, ch: 1, media: SHA_A + ".wav" }]);   // unused left out
  assert.equal(c.clips.length, 2);
  assert.deepEqual(c.clips.find((x) => x.id === "ckeys001").n, [[60, 0, 0.5, 100], [64, 0.5, 0.5, 90]]);
  assert.ok(!JSON.stringify(c).includes("/internal/"), "no disk paths in content.json");
  assert.match(b.tracksTxt, /^Song\n/);
  assert.match(b.tracksTxt, /1\. Vox — Audio, 1 clips, solo/);
  assert.match(b.tracksTxt, /2\. Keys — Instrument \(<epiano>\), 1 clips, muted/);
  assert.match(b.tracksTxt, /CONVOLUTION, SC_DUCKER/);
  assert.match(b.tracksTxt, /Riff \(2 notes\)/);
});

test("parse: a NEW project, fresh ids everywhere, links remapped, files to write", () => {
  const c = P.build(sample(), "pabcdef1", keys, {}).content;
  const r = P.parse(JSON.parse(JSON.stringify(c)), { newId, now: 1000 });
  assert.notEqual(r.project.id, "pabcdef1");
  assert.equal(r.project.m, 1000);
  assert.equal(r.project.name, "Song");
  assert.equal(r.project.fx[0].id, "limiter");
  assert.notEqual(r.project.fx[0].u, "fmaster01");
  assert.equal(r.tracks.length, 2);
  const [vox, keysT] = r.tracks;
  assert.ok(vox.id !== "tvox0001" && keysT.id !== "tkeys001");
  assert.ok(r.tracks.every((t) => t.p === r.project.id));
  assert.equal(vox.fx[1].sc, keysT.id, "sidechain key follows the track");
  const conv = vox.fx[0];
  assert.notEqual(conv.u, "fconv001");
  assert.match(conv.f[2], /^\/internal\/Studio\/fx\/Hall-f[a-z0-9]+\.wav$/);
  assert.deepEqual(vox.auto.map((l) => l.k), ["vol", "fx." + conv.u + ".1"], "lane follows its effect slot");
  assert.equal(vox.auto[1].on, false);
  assert.equal(keysT.inst, "epiano");
  assert.equal(r.sources.length, 1);
  assert.match(r.sources[0].path, /^\/internal\/Studio\/audio\/take-1-s[a-z0-9]+\.wav$/);
  const audio = r.clips.find((x) => x.s);
  assert.equal(audio.s, r.sources[0].id);
  assert.equal(audio.t, vox.id);
  assert.deepEqual([audio.at, audio.off, audio.len, audio.gain, audio.fi, audio.fo], [0.5, 0.25, 3, 2, 0.1, 0.2]);
  const midi = r.clips.find((x) => x.n);
  assert.equal(midi.name, "Riff");
  assert.equal(midi.t, keysT.id);
  assert.deepEqual(r.files.map((f) => f.key).sort(), [SHA_A + ".wav", SHA_B + ".wav"]);
  assert.ok(r.files.some((f) => f.path === conv.f[2]));
  assert.ok(r.files.some((f) => f.path === r.sources[0].path));
  // everything goes through core.js's normalisers and merges cleanly
  const d = C.mergeStudio(sample(), Object.assign(C.emptyData(), { projects: [r.project], tracks: r.tracks, sources: r.sources, clips: r.clips }));
  assert.equal(d.projects.length, 3);
  assert.equal(C.ofProject(d, "clips", r.project.id).length, 2);
});

test("parse: hostile or broken content is cut down, never throws past notpackage", () => {
  assert.throws(() => P.parse(null, { newId }), /notpackage/);
  assert.throws(() => P.parse({ kind: "oros-notes-package", project: {} }, { newId }), /notpackage/);
  const evil = {
    kind: "oros-studio-package", ver: 1,
    project: { name: "x".repeat(500), bpm: 99999, sig: 13, vol: 1e9, loop: { on: true, a: -5, b: 1e9 },
               fx: [{ u: "fbad0001", id: "../../evil", s: {} }, "junk"] },
    tracks: Array.from({ length: 20 }, (_, i) => ({ id: "t" + i, name: "<b>" + i, color: "red", vol: 99, pan: 900,
      fx: [{ u: "fok00001", id: "eq", s: { 1: 1, 999: 5, x: 3 }, f: { 2: { media: "../../etc/passwd", name: "a" }, 3: { media: SHA_A + ".wav", name: "../../x" } } }],
      auto: [{ k: "fx.fnotthere.1", p: [[0, 1]] }, { k: "eval", p: [[0, 1]] }] })),
    sources: [{ id: "s1", name: "a.wav", media: "../evil", dur: -4 }, { id: "s2", name: "b", media: SHA_B + ".mp3", dur: 2 }],
    clips: [{ id: "c1", t: "t0", s: "s1", at: -1, len: 1 }, { id: "c2", t: "t0", s: "s2", at: 0, len: 2 },
            { id: "c3", t: "nope", s: "s2", len: 1 }, { id: "c4", t: "t1", s: "missing", len: 1 },
            { id: "c5", t: "t1", n: [[200, 0, 1, 500], "x"], len: 1 }]
  };
  const r = P.parse(evil, { newId, now: 5 });
  assert.equal(r.project.name.length, C.MAX_NAME);
  assert.equal(r.project.bpm, C.MAX_BPM);
  assert.equal(r.project.sig, 4);
  assert.equal(r.project.fx.length, 0);
  assert.equal(r.tracks.length, C.MAX_TRACKS);
  r.tracks.forEach((t) => {
    assert.equal(t.color, C.COLORS[0]);
    assert.equal(t.pan, 100);
    assert.equal(t.auto, undefined);
    assert.deepEqual(Object.keys(t.fx[0].s), ["1"]);
    assert.deepEqual(Object.keys(t.fx[0].f), ["3"]);
    assert.ok(!t.fx[0].f[3].includes(".."));
  });
  assert.ok(r.files.every((f) => B.safePath(f.key) && /^[0-9a-f]{64}\.[a-z0-9]+$/.test(f.key)));
  assert.equal(r.clips.length, 3);                       // c1 (source without media, plays nothing), c2, c5
  assert.equal(r.sources.length, 2);
  assert.ok(r.files.every((f) => f.key !== "../evil"));
  const m = r.clips.find((c) => c.n);
  assert.deepEqual(m.n, [[127, 0, 1, 127]]);
});

test("a bundle round trip with media (bundle.js write → read)", async () => {
  const wav = C.wavBytes([new Float32Array([0, 0.5, -0.5, 0])], 8000, 16);
  const ir = C.wavBytes([new Float32Array([1, 0.2])], 8000, 16);
  const ka = (await B.sha256(wav)) + ".wav", kb = (await B.sha256(ir)) + ".wav";
  const k2 = { src: { svox0001: ka }, fx: { "/internal/Studio/fx/Hall-sabcdefabcdef.wav": kb } };
  const built = P.build(sample(), "pabcdef1", k2, {});
  const bytes = await B.write({ mime: MIME, app: "studio", schema: "studio/1", content: built.content,
    meta: { title: "Song", generator: "orOS Studio" }, media: { [ka]: wav, [kb]: ir },
    preview: [{ name: "tracks.txt", data: built.tracksTxt, type: "text/plain" }] });
  assert.equal(B.sniff(bytes.slice(0, 128)), MIME);
  const back = await B.read(bytes, { mime: MIME, big: true });
  assert.deepEqual(back.changed, []);
  assert.equal(back.meta.title, "Song");
  const r = P.parse(back.content, { newId, now: 9 });
  assert.equal(r.files.length, 2);
  r.files.forEach((f) => assert.ok(back.media[f.key], f.key));
  assert.deepEqual(Array.from(back.media[ka].bytes), Array.from(wav));
  assert.equal(back.media[ka].blob.size, wav.length);
  await assert.rejects(B.read(bytes, { mime: "application/x-oros-doc" }), /wrongtype/);
});
