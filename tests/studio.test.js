// Pure logic of Studio (studio/core.js): the project data and its
// merge (sync slice "studio"), bars and beats, clip editing, mute and
// solo, peaks and WAV files; plus the wiring of the app.
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const C = require(path.join(__dirname, "..", "studio/core.js"));
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= (eps || 1e-6), a + " ≉ " + b);

const P = (id, m, x) => Object.assign({ id, m, name: "Song " + id, bpm: 120, sig: 4 }, x || {});
const T = (id, m, x) => Object.assign({ id, m, p: "pproject1", name: "Track " + id, color: C.COLORS[0], vol: 0, pan: 0 }, x || {});
const S = (id, m, x) => Object.assign({ id, m, p: "pproject1", name: "a.wav", path: "/internal/Studio/audio/a-" + id + ".wav", dur: 10, ch: 2 }, x || {});
const K = (id, m, x) => Object.assign({ id, m, p: "pproject1", t: "ttrack01", s: "ssource1", at: 1, off: 0, len: 4 }, x || {});
const data = (x) => Object.assign(C.emptyData(), x);

test("normalise: bounds, defaults and bad entities", () => {
  const p = C.normProject(P("pproject1", 5, { bpm: 999, sig: 9, vol: 40, loop: { on: true, a: 8, b: 2 } }));
  assert.equal(p.bpm, C.MAX_BPM);
  assert.equal(p.sig, 4);
  assert.equal(p.vol, C.VOL_MAX);
  assert.deepEqual(p.loop, { on: true, a: 2, b: 8 });                     // swapped
  assert.equal(C.normProject(P("pproject1", 5, { loop: { on: true, a: 3, b: 3 } })).loop.on, false);
  assert.equal(C.normProject(P("xproject1", 5)), null);                    // wrong kind of id
  assert.equal(C.normProject(P("pproject1", -1)), null);
  const t = C.normTrack(T("ttrack01", 1, { pan: 300, color: "#000000", name: "  a\u0000b  ", extra: 1 }));
  assert.equal(t.pan, 100);
  assert.equal(t.color, C.COLORS[0]);
  assert.equal(t.name, "a b");
  assert.equal("extra" in t, false);
  assert.equal(C.normSource(S("ssource1", 1, { path: "/internal/Notes/x.wav" })), null);   // only the Studio folder
  assert.equal(C.normSource(S("ssource1", 1, { path: "/internal/Studio/../x.wav" })), null);
  assert.equal(C.normClip(K("cclip001", 1, { len: 0 })), null);
  const k = C.normClip(K("cclip001", 1, { fi: 3, fo: 3, gain: 99 }));
  assert.equal(k.gain, C.GAIN_MAX);
  near(k.fi + k.fo, k.len);                                                // fades fit the clip
});

test("merge: symmetric, idempotent, canonical", () => {
  const A = data({ projects: [P("pproject1", 10)], tracks: [T("ttrack02", 5), T("ttrack01", 7)], clips: [K("cclip001", 3)] });
  const B = data({ projects: [P("pproject1", 12, { name: "Newer" })], tracks: [T("ttrack01", 6, { vol: -3 })], clips: [K("cclip002", 4)] });
  const ab = C.mergeStudio(A, B), ba = C.mergeStudio(B, A);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba));
  assert.equal(JSON.stringify(C.mergeStudio(ab, ab)), JSON.stringify(ab));
  assert.equal(ab.projects[0].name, "Newer");
  assert.equal(C.find(ab, "tracks", "ttrack01").m, 7);                       // the newer one
  assert.deepEqual(ab.tracks.map((x) => x.id), ["ttrack01", "ttrack02"]);    // sorted by id
  assert.equal(ab.clips.length, 2);
  // equal stamps: the larger JSON wins on both sides
  const x = data({ tracks: [T("ttrack01", 9, { vol: -1 })] }), y = data({ tracks: [T("ttrack01", 9, { vol: -2 })] });
  assert.equal(JSON.stringify(C.mergeStudio(x, y)), JSON.stringify(C.mergeStudio(y, x)));
});

test("merge: tombstones delete, a newer edit comes back (R17)", () => {
  const A = data({ clips: [K("cclip001", 5)] });
  const del = data({ tombs: { cclip001: 6 } });
  assert.equal(C.mergeStudio(A, del).clips.length, 0);
  assert.equal(C.mergeStudio(data({ clips: [K("cclip001", 6)] }), del).clips.length, 0);   // delete wins ties
  assert.equal(C.mergeStudio(data({ clips: [K("cclip001", 7)] }), del).clips.length, 1);
  const bad = C.mergeStudio(data({ tombs: { "nope": 5, cclip001: -1, cclip002: 1.5 } }), C.emptyData());
  assert.deepEqual(bad.tombs, {});
});

test("lookups: tracks in order, clips by time, next colour", () => {
  const d = C.mergeStudio(data({
    tracks: [T("ttrack0b", 1, { ord: 2 }), T("ttrack0a", 1, { ord: 1 }), T("ttrack0c", 1, { ord: 1, p: "pother01" })],
    clips: [K("cclip002", 1, { at: 5 }), K("cclip001", 1, { at: 2 })]
  }), C.emptyData());
  assert.deepEqual(C.tracksOf(d, "pproject1").map((x) => x.id), ["ttrack0a", "ttrack0b"]);
  assert.deepEqual(C.clipsOfTrack(d, "ttrack01").map((x) => x.id), ["cclip001", "cclip002"]);
  assert.equal(C.nextColor([{ color: C.COLORS[0] }, { color: C.COLORS[2] }]), C.COLORS[1]);
  assert.match(C.newId("c", Math.random), C.ID_RE);
});

test("time: bars, beats, snap, clock text", () => {
  near(C.beatSec(120), 0.5);
  near(C.barSec(120, 3), 1.5);
  assert.deepEqual(C.barBeat(0, 120, 4), { bar: 1, beat: 1, frac: 1e-9 });
  const bb = C.barBeat(2.75, 120, 4);
  assert.equal(bb.bar, 2); assert.equal(bb.beat, 2);
  near(C.snap(1.3, 120, 4, "beat"), 1.5);
  near(C.snap(1.3, 120, 4, "bar"), 2);
  near(C.snap(1.3, 120, 4, "off"), 1.3);
  near(C.snap(-1, 120, 4, "beat"), 0);
  assert.equal(C.fmtTime(83.5), "1:23.500");
  assert.equal(C.fmtTime(-2), "0:00.000");
});

test("mix: mute and solo", () => {
  const a = { vol: 0, mute: false, solo: false }, b = { vol: -6, mute: false, solo: true }, m = { vol: 0, mute: true, solo: true };
  assert.equal(C.anySolo([a, m]), false);                                   // a muted solo does not count
  assert.equal(C.anySolo([a, b]), true);
  assert.equal(C.trackGain(a, true), 0);
  near(C.trackGain(b, true), Math.pow(10, -6 / 20));
  assert.equal(C.trackGain(m, false), 0);
  assert.equal(C.dbToGain(C.VOL_MIN), 0);
});

test("clips: move, trim, split, fades, export range", () => {
  const c = C.normClip(K("cclip001", 1, { at: 2, off: 1, len: 4, fi: 1, fo: 1 }));
  assert.equal(C.moveClip(c, -3).at, 0);
  // trim left: the audio stays where it was
  const l = C.trimStart(c, 3, 10);
  near(l.at, 3); near(l.off, 2); near(l.len, 3);
  const l2 = C.trimStart(c, 0, 10);                                          // not before the file's start
  near(l2.at, 1); near(l2.off, 0); near(l2.len, 5);
  // trim right: not past the end of the file
  near(C.trimEnd(c, 20, 10).len, 9);
  near(C.trimEnd(c, 2, 10).len, C.MIN_LEN);
  const parts = C.splitClip(c, 4, "cclip002");
  near(parts[0].len, 2); near(parts[1].at, 4); near(parts[1].off, 3); near(parts[1].len, 2);
  assert.equal(parts[0].fo, 0); assert.equal(parts[1].fi, 0);
  assert.equal(parts[1].id, "cclip002");
  assert.equal(C.splitClip(c, 2, "cclip002"), null);                         // at the edge
  near(C.fadeGainAt(c, 0.5), 0.5); near(C.fadeGainAt(c, 2), 1); near(C.fadeGainAt(c, 3.75), 0.25);
  const pr = C.normProject(P("pproject1", 1, { loop: { on: true, a: 1, b: 3 } }));
  assert.deepEqual(C.exportRange(pr, [c]), { a: 1, b: 3 });
  pr.loop.on = false;
  assert.deepEqual(C.exportRange(pr, [c]), { a: 0, b: 6 });
});

test("peaks: min and max per bucket over both channels", () => {
  const p = C.peaks([new Float32Array([0, 0.5, -0.2, 0]), new Float32Array([0, -0.7, 0.1, 0.9])], 2);
  assert.deepEqual(Array.from(p).map((v) => Math.round(v * 10) / 10), [-0.7, 0.5, -0.2, 0.9]);
  assert.equal(C.peaks([], 3).length, 6);
});

test("WAV: 16 and 24 bit, mono and stereo", () => {
  const w16 = C.wavBytes([new Float32Array([0, 1, -1])], 44100, 16);
  const dv = new DataView(w16.buffer);
  assert.equal(String.fromCharCode(...w16.slice(0, 4)), "RIFF");
  assert.equal(dv.getUint16(22, true), 1);
  assert.equal(dv.getUint16(34, true), 16);
  assert.equal(dv.getUint32(40, true), 6);
  assert.equal(dv.getInt16(46, true), 32767);
  assert.equal(dv.getInt16(48, true), -32767);
  const w24 = C.wavBytes([new Float32Array([1, 0]), new Float32Array([-1, 0.5])], 48000, 24);
  const d2 = new DataView(w24.buffer);
  assert.equal(d2.getUint16(22, true), 2);
  assert.equal(d2.getUint16(32, true), 6);                                  // block align
  assert.equal(d2.getUint32(28, true), 48000 * 6);
  assert.equal(d2.getUint32(40, true), 12);
  const s24 = (o) => { const v = w24[o] | (w24[o + 1] << 8) | (w24[o + 2] << 16); return v & 0x800000 ? v - 0x1000000 : v; };
  assert.equal(s24(44), 8388607);
  assert.equal(s24(47), -8388607);
  assert.equal(s24(53), Math.round(0.5 * 8388607));
});

test("names: disk paths stay in the Studio folder", () => {
  assert.equal(C.sourcePath("sabc123", "My take.wav", "wav"), "/internal/Studio/audio/My-take-sabc123.wav");
  assert.equal(C.sourcePath("sabc123", "../../etc/x", "m p3"), "/internal/Studio/audio/etcx-sabc123.wav");
  assert.equal(C.sourcePath("sabc123", "κιθάρα 2.wav", "wav"), "/internal/Studio/audio/2-sabc123.wav");
  assert.equal(C.sourcePath("sabc123", "κιθάρα.wav", "wav"), "/internal/Studio/audio/sabc123.wav");
  assert.ok(C.normSource(S("sabc1234", 1, { path: C.sourcePath("sabc1234", "a:b*c", "flac") })));
  assert.equal(C.extOf("song.MP3", ""), "mp3");
  assert.equal(C.extOf("x", "audio/ogg"), "ogg");
  assert.equal(C.fileName("My song", "wav"), "My-song.wav");
});

test("app wiring: scripts, slice, palette, no code sinks", () => {
  const html = read("studio/index.html"), js = read("studio/studio.js");
  assert.ok(html.indexOf('src="core.js') < html.indexOf('src="studio.js'));
  assert.ok(js.includes('api.registerSlice("studio", sliceGet, sliceSet, STORAGE_KEY, C.mergeStudio)'));
  assert.ok(js.includes("inheritPalette") && js.includes("watchPalette"));          // guard G3
  assert.ok(js.includes('addModule("rec.worklet.js")'));
  assert.doesNotMatch(js, /\beval\(|new Function|insertAdjacentHTML|outerHTML\s*=|document\.write/);
  assert.doesNotMatch(js, /showSaveFilePicker|showOpenFilePicker/);                 // R33: through orosDialog
  // innerHTML only ever gets fixed icons or ""
  (js.match(/innerHTML\s*=\s*[^;]+;/g) || []).forEach((s) => assert.match(s, /innerHTML\s*=\s*(""|ICON\.|ICON\[|[a-z]+\s*&&|playing)/, s));
  // every STRINGS key exists in both languages
  const keys = (lang) => {
    const i = js.indexOf("    " + lang + ": {"), j = js.indexOf("\n    }", i);
    return (js.slice(i, j).match(/"[a-zA-Z0-9.]+":/g) || []).sort();
  };
  assert.deepEqual(keys("el"), keys("en"));
});

test("effects: chains normalise, survive merge, keep unknown effects", () => {
  const fx = C.normFx([
    { u: "fabc1234", id: "tilt", s: { 1: 40, "x": 3, 0: 1, 99: 2, 2: "5" } },
    { u: "fabc1234", id: "reverb" },                                         // duplicate slot id
    { u: "fdef5678", id: "../evil" },                                        // bad effect id
    { u: "fghi9012", id: "future_fx", on: false, f: { 2: "/internal/Studio/fx/ir-a.wav", 3: "/etc/passwd", 4: "/internal/Studio/../x" } },
    null, "x"
  ]);
  assert.deepEqual(fx, [
    { u: "fabc1234", id: "tilt", on: true, s: { 1: 40 } },
    { u: "fghi9012", id: "future_fx", on: false, s: {}, f: { 2: "/internal/Studio/fx/ir-a.wav" } }
  ]);
  const many = Array.from({ length: 12 }, (_, i) => ({ u: "fslot" + String(i).padStart(3, "0"), id: "tilt" }));
  assert.equal(C.normFx(many).length, C.MAX_FX);
  assert.deepEqual(C.normFx("nope"), []);
  // on tracks and on the project (master), through a merge
  const a = data({ projects: [P("pproject1", 5, { fx: [{ u: "fmaster01", id: "reverb", s: { 4: 50 } }] })], tracks: [T("ttrack01", 5, { fx: fx })] });
  const b = data({ projects: [P("pproject1", 3)], tracks: [T("ttrack01", 3)] });
  const m = C.mergeStudio(a, b);
  assert.deepEqual(m, C.mergeStudio(b, a));
  assert.equal(C.find(m, "projects", "pproject1").fx[0].id, "reverb");
  assert.equal(C.find(m, "tracks", "ttrack01").fx.length, 2);
  assert.deepEqual(C.normTrack(T("ttrack02", 1)).fx, []);
});

test("effects: slider positions, steps, values and IR file paths", () => {
  const lin = { i: 1, min: -12, max: 12, inc: 0.5, def: 0 };
  assert.equal(C.sliderFromPos(lin, 0), -12);
  assert.equal(C.sliderFromPos(lin, 1), 12);
  assert.equal(C.sliderFromPos(lin, 0.52), 0.5);                      // to the step
  near(C.sliderToPos(lin, 6), 0.75);
  assert.equal(C.sliderStep(lin, 99), 12);
  const log = { i: 2, min: 20, max: 20000, inc: 0, def: 1000, shape: "log" };
  near(C.sliderFromPos(log, 0.5), Math.sqrt(20 * 20000), 1e-3);
  near(C.sliderToPos(log, 632.455532), 0.5);
  for (let x = 0; x <= 1; x += 0.125) near(C.sliderToPos(log, C.sliderFromPos(log, x)), x, 1e-6);
  const flat = { i: 3, min: 0, max: 0, inc: 1, def: 0 };
  assert.equal(C.sliderToPos(flat, 0), 0);
  const rev = { i: 4, min: 10, max: -10, inc: 1, def: 0 };            // JSFX allows min > max
  assert.equal(C.sliderStep(rev, 50), 10);
  assert.equal(C.fxValue({ s: { 1: 3 } }, lin), 3);
  assert.equal(C.fxValue({ s: {} }, lin), 0);
  assert.equal(C.fxValue(null, log), 1000);
  const p = C.fxFilePath("fabc1234", "My Hall/IR.wav", "wav");
  assert.match(p, /^\/internal\/Studio\/fx\/[A-Za-z0-9_-]+-fabc1234\.wav$/);
});

test("effects: runtime files are static and loaded through validated ids", () => {
  const fxjs = read("studio/fx.js"), html = read("studio/index.html");
  const idx = JSON.parse(read("studio/nullfx/fx/index.json"));
  assert.ok(idx.effects.length >= 70);
  idx.effects.forEach((e) => {
    assert.match(e.id, /^[a-z0-9_]{1,40}$/);
    assert.ok(fs.existsSync(path.join(__dirname, "..", "studio/nullfx/fx", e.id + ".js")), e.id);
  });
  const dir = path.join(__dirname, "..", "studio/nullfx");
  const files = ["runtime/eel-rt.js", "runtime/null-fx.js", "runtime/null-gfx.js", "runtime/null-node.js", "runtime/null-worklet.js"]
    .concat(idx.effects.map((e) => "fx/" + e.id + ".js"));
  files.forEach((f) => assert.doesNotMatch(fs.readFileSync(path.join(dir, f), "utf8"), /\beval\(|new Function|importScripts|XMLHttpRequest|innerHTML|document\.write/, f));
  assert.doesNotMatch(fxjs, /\beval\(|new Function|insertAdjacentHTML|outerHTML\s*=|document\.write/);
  (fxjs.match(/innerHTML\s*=\s*[^;]+;/g) || []).forEach((s) => assert.match(s, /innerHTML\s*=\s*(""|'<svg[^']*'\s*\+\s*path\s*\+\s*'[^']*'|'<svg[^']*')/, s));
  assert.ok(fxjs.includes("if (!C.FX_ID_RE.test(id)) return Promise.reject"));
  ["nullfx/runtime/eel-rt.js", "nullfx/runtime/null-fx.js", "nullfx/runtime/null-gfx.js", "nullfx/runtime/null-node.js", "fx.js"]
    .forEach((s) => assert.ok(html.indexOf('src="' + s) >= 0 && html.indexOf('src="' + s) < html.indexOf('src="core.js'), s));
});

test("remote: codes, keys and frames", async () => {
  globalThis.window = globalThis;
  require(path.join(__dirname, "..", "studio/remote.js"));
  const T = globalThis.StudioRemote._test;
  for (let i = 0; i < 50; i++) assert.match(T.newCode(), /^[1-9][0-9]{5}$/);
  const a = await T.derive("123456"), b = await T.derive("123456"), c = await T.derive("123457");
  assert.match(a.room, /^[0-9a-f]{64}$/);
  assert.equal(a.room, b.room);
  assert.notEqual(a.room, c.room);
  const box = await T.seal(a.key, { k: "app", d: { t: "tp", a: "play" } });
  assert.doesNotMatch(box, /play/);                                         // the relay sees ciphertext
  assert.deepEqual(await T.unseal(b.key, box), { k: "app", d: { t: "tp", a: "play" } });
  assert.equal(await T.unseal(c.key, box), null);                           // wrong code: nothing
  assert.equal(await T.unseal(a.key, "!!not base64"), null);
  assert.equal(T.wsUrl("https://r.example/", a.room), "wss://r.example/rt/" + a.room);
});

test("remote: the PC checks every command from the tablet", () => {
  const calls = [];
  const snap = { tracks: [{ id: "ttrack001", fx: [] }] };
  const H = {
    C, t: (k) => k, el: () => ({}), setLabel: () => {}, ICON: {}, relay: "https://r.example",
    snapshot: () => snap, isPlaying: () => false,
    togglePlay: () => calls.push("play"), stop: () => calls.push("stop"), record: () => calls.push("rec"),
    toggleLoop: () => calls.push("loop"), toggleMetro: () => calls.push("metro"), seek: (s) => calls.push(["seek", s]),
    setBpm: (v) => calls.push(["bpm", v]), setMaster: (v) => calls.push(["mv", v]), setTrack: (id, f) => calls.push(["tr", id, f]),
    arm: (id) => calls.push(["arm", id]), toggleFx: (k, u, on) => calls.push(["fx", k, u, on])
  };
  const R = globalThis.StudioRemote(H), cmd = R._command;
  cmd({ t: "tp", a: "play" }); cmd({ t: "tp", a: "rm -rf" }); cmd(null); cmd({ t: 5 });
  cmd({ t: "seek", s: 12.5 }); cmd({ t: "seek", s: "12" }); cmd({ t: "seek", s: Infinity }); cmd({ t: "seek", s: -4 });
  cmd({ t: "bpm", v: 999 }); cmd({ t: "mv", v: -100 }); cmd({ t: "mv", v: 3.3 });
  cmd({ t: "tr", id: "ttrack001", f: { vol: 4.26, pan: 300, mute: true } });
  cmd({ t: "tr", id: "ttrack001", f: { mute: "yes" } });
  cmd({ t: "tr", id: "tother001", f: { vol: 0 } });                        // not a track of the project
  cmd({ t: "tr", id: "../x", f: { vol: 0 } });
  cmd({ t: "tr", id: "ttrack001", f: { name: "x", color: "red" } });        // fields the console does not own
  cmd({ t: "arm", id: "ttrack001" });
  cmd({ t: "fx", key: "master", u: "fabc1234", on: false }); cmd({ t: "fx", id: "ttrack001", u: "fabc1234", on: true });
  cmd({ t: "fx", key: "master", u: "<x>", on: false }); cmd({ t: "fx", key: "master", u: "fabc1234", on: 1 });
  assert.deepEqual(calls, [
    "play", ["seek", 12.5], ["seek", 0], ["bpm", C.MAX_BPM], ["mv", C.VOL_MIN], ["mv", 3.5],
    ["tr", "ttrack001", { vol: 4.5, pan: 100, mute: true }], ["arm", "ttrack001"],
    ["fx", "master", "fabc1234", false], ["fx", "ttrack001", "fabc1234", true]
  ]);
});

test("remote: wiring, strings and no code sinks", () => {
  const js = read("studio/remote.js"), html = read("studio/index.html"), studio = read("studio/studio.js");
  assert.doesNotMatch(js, /\beval\(|new Function|insertAdjacentHTML|outerHTML\s*=|document\.write/);
  (js.match(/innerHTML\s*=\s*[^;]+;/g) || []).forEach((s) => assert.match(s, /innerHTML\s*=\s*host\.ICON(\.[a-z]+;|\[)/, s));
  ["../qr/qr-encode.js", "remote.js"].forEach((s) => assert.ok(html.indexOf('src="' + s) >= 0 && html.indexOf('src="' + s) < html.indexOf('src="core.js'), s));
  (js.match(/t\("(rm\.[a-zA-Z.]*[a-zA-Z])"/g) || []).forEach((m) => {
    const k = m.slice(3, -1);
    assert.equal((studio.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length, 2, k);
  });
  ["remote-dlg", "join-dlg", "remote-ui", "ru-strips", "rm-qr", "rj-code", "more-remote", "more-join", "remote-ind"].forEach((id) => assert.ok(html.includes('id="' + id + '"'), id));
});
