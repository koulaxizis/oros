// Studio wave 40: instrument (MIDI) tracks, MIDI clips in the synced
// data, piano roll edits and Standard MIDI Files (studio/notes.js), the
// loop library (studio/loops.js), the drum kit and scheduled notes
// (studio/midi.js), and the page wiring. Pure logic, no browser.
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "studio/core.js"));
const N = require(path.join(ROOT, "studio/notes.js"));
const L = require(path.join(ROOT, "studio/loops.js"));
const M = require(path.join(ROOT, "studio/midi.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= (eps || 1e-9), a + " ≉ " + b);
const P = "pproject1";
const T = (id, m, x) => Object.assign({ id, m, p: P, name: "Track", color: C.COLORS[0], vol: 0, pan: 0 }, x || {});
const K = (id, m, x) => Object.assign({ id, m, p: P, t: "ttrack001", at: 0, off: 0, len: 2, gain: 0, fi: 0, fo: 0 }, x || {});

// ---------- Data ----------
test("data: MIDI clips normalise; audio clips and tracks keep their bytes", () => {
  const c = C.normClip(K("cmidi0001", 1, { at: 1, len: 4, name: "  Riff\u0000 ", n: [[60.4, 1, 0.5, 90], [200, -1, 0, 50], [64, 0, 1, 300], "x", [61, 0.5, 0.25]] }));
  assert.deepEqual(Object.keys(c), ["id", "m", "p", "t", "at", "off", "len", "gain", "fi", "fo", "name", "n"]);
  assert.equal(c.name, "Riff");
  assert.deepEqual(c.n, [[64, 0, 1, 127], [61, 0.5, 0.25, 100], [60, 1, 0.5, 90]]);   // the zero-length note dropped, the rest clamped and in time order
  assert.equal(c.s, undefined);
  assert.ok(C.isMidi(c));
  // no name: no key
  assert.equal("name" in C.normClip(K("cmidi0002", 1, { n: [] })), false);
  // an audio clip is what it was, and needs its source
  const a = K("caudio001", 1, { s: "ssource01" });
  assert.deepEqual(Object.keys(C.normClip(a)), ["id", "m", "p", "t", "s", "at", "off", "len", "gain", "fi", "fo"]);
  assert.equal(C.normClip(K("caudio002", 1)), null);                      // neither a source nor notes
  assert.equal(C.normClip(K("caudio003", 1, { s: "ssource01", n: [[60, 0, 1, 1]] })).n, undefined);
  assert.equal(C.isMidi(C.normClip(a)), false);
  // the instrument is written only when set; unknown ids from a newer Studio ride along
  assert.equal("inst" in C.normTrack(T("ttrack001", 1)), false);
  assert.equal(C.normTrack(T("ttrack001", 1, { inst: "drums" })).inst, "drums");
  assert.equal(C.normTrack(T("ttrack001", 1, { inst: "harp_2" })).inst, "harp_2");
  assert.equal("inst" in C.normTrack(T("ttrack001", 1, { inst: "../x" })), false);
  // at most MAX_NOTES
  const many = []; for (let i = 0; i < C.MAX_NOTES + 50; i++) many.push([60, i * 0.01, 0.01, 100]);
  assert.equal(C.normClip(K("cmidi0003", 1, { len: 30, n: many })).n.length, C.MAX_NOTES);
});

test("data: a slice from before wave 40 keeps the very same bytes; MIDI clips merge like any clip", () => {
  const old = {
    ver: 1,
    projects: [{ id: P, m: 5, name: "Song", bpm: 120, sig: 4, vol: 0, loop: { on: false, a: 0, b: 0 }, fx: [] }],
    tracks: [{ id: "ttrack001", m: 5, p: P, name: "Vox", color: C.COLORS[0], vol: 0, pan: 0, mute: false, solo: false, ord: 0, fx: [] }],
    sources: [{ id: "ssource01", m: 5, p: P, name: "take", path: "/internal/Studio/audio/take-ssource01.wav", dur: 3, ch: 2 }],
    clips: [{ id: "caudio001", m: 5, p: P, t: "ttrack001", s: "ssource01", at: 0, off: 0, len: 3, gain: 0, fi: 0, fo: 0 }],
    tombs: {}
  };
  assert.equal(JSON.stringify(C.mergeStudio(old, old)), JSON.stringify(old));
  const neu = JSON.parse(JSON.stringify(old));
  neu.tracks.push({ id: "ttrack002", m: 6, p: P, name: "Keys", color: C.COLORS[1], vol: 0, pan: 0, mute: false, solo: false, ord: 1, fx: [], inst: "epiano" });
  neu.clips.push({ id: "cmidi0001", m: 6, p: P, t: "ttrack002", at: 2, off: 0, len: 2, gain: 0, fi: 0, fo: 0, n: [[60, 0, 0.5, 100]] });
  const m1 = C.mergeStudio(old, neu), m2 = C.mergeStudio(neu, old);
  assert.deepEqual(m1, m2);
  assert.equal(JSON.stringify(C.mergeStudio(m1, m1)), JSON.stringify(m1));
  assert.equal(m1.tracks[1].inst, "epiano");
  assert.deepEqual(m1.clips[1].n, [[60, 0, 0.5, 100]]);
  // a newer edit of the notes wins; a tombstone removes the clip
  const edited = JSON.parse(JSON.stringify(m1));
  edited.clips[1].m = 9; edited.clips[1].n = [[62, 0, 1, 80]];
  assert.deepEqual(C.mergeStudio(m1, edited).clips[1].n, [[62, 0, 1, 80]]);
  const gone = C.mergeStudio(m1, { tombs: { cmidi0001: 10 } });
  assert.equal(gone.clips.some((c) => c.id === "cmidi0001"), false);
  // what an older Studio does: its normClip needs a source, so its own copy has no MIDI clips;
  // merging that copy back in loses nothing (the union keeps them)
  const olderCopy = JSON.parse(JSON.stringify(m1));
  olderCopy.clips = olderCopy.clips.filter((c) => c.s);
  delete olderCopy.tracks[1].inst;
  assert.deepEqual(C.mergeStudio(m1, olderCopy), m1);
});

test("clips: split keeps each note in its half, retime follows the tempo, clipNotes plays the window", () => {
  const c = C.normClip(K("cmidi0001", 1, { at: 2, len: 4, n: [[60, 0, 1, 100], [62, 1, 2.5, 90], [64, 3, 0.5, 80]] }));
  const [a, b] = C.splitClip(c, 3.5, "cmidi0002");
  assert.deepEqual(a.n, [[60, 0, 1, 100], [62, 1, 2.5, 90]]);
  assert.deepEqual(b.n, [[64, 3, 0.5, 80]]);
  near(b.off, 1.5); near(b.at, 3.5);
  // the right half plays its note at its own time; the left half cuts the long note at its end
  assert.deepEqual(C.clipNotes(b, 0, 99).map((q) => [q.p, q.at, q.end]), [[64, 5, 5.5]]);
  assert.deepEqual(C.clipNotes(a, 0, 99).map((q) => [q.p, q.at, q.end]), [[60, 2, 3], [62, 3, 3.5]]);
  // from the middle: a note already sounding starts at `from`; the range end cuts
  assert.deepEqual(C.clipNotes(c, 2.5, 4).map((q) => [q.p, q.at, q.end]), [[60, 2.5, 3], [62, 3, 4]]);
  // gain and fades scale the notes
  const g = C.clipNotes(Object.assign({}, c, { gain: -6, fi: 2 }), 0, 99);
  near(g[0].g, 0, 1e-9); near(g[1].g, C.dbToGain(-6) * 0.5, 1e-9);
  // 120 -> 60 BPM: twice as long, the same bars and beats
  const r = C.retimeClip(c, 2);
  assert.deepEqual([r.at, r.len, r.n[1]], [4, 8, [62, 2, 5, 90]]);
  assert.equal(C.retimeClip(C.normClip(K("caudio001", 1, { s: "ssource01" })), 2).at, 0);   // audio stays
});

// ---------- Piano roll edits ----------
test("notes: grid, snapping on the project's grid, move, resize, velocity, delete", () => {
  near(N.gridSec(120, "1/16"), 0.125); near(N.gridSec(120, "1/8t"), 1 / 6); assert.equal(N.gridSec(120, "off"), 0);
  // a clip starting at 0.3 s: its content time snaps to project multiples of the step
  near(N.snapT(0.1, 0.3, 0.25), 0.2); near(N.floorT(0.24, 0.3, 0.25), 0.2); near(N.floorT(0.1, 0.3, 0.25), -0.05); near(N.snapT(0.1, 0, 0), 0.1);
  const notes = [[60, 0, 0.5, 100], [64, 0.5, 0.5, 90], [67, 1, 0.5, 80]];
  let r = N.moveNotes(notes, [0, 2], 0.25, 2, 0);
  assert.deepEqual(r.notes, [[62, 0.25, 0.5, 100], [64, 0.5, 0.5, 90], [69, 1.25, 0.5, 80]]);
  assert.deepEqual(r.sel, [0, 2]);
  // the group keeps its shape at the edges: no note before `min`, no pitch out of range
  r = N.moveNotes(notes, [0, 1], -5, 100, 0);
  assert.deepEqual(r.notes.map((q) => q.slice(0, 2)), [[123, 0], [127, 0.5], [67, 1]]);
  r = N.moveNotes(notes, [2], -2, 0, 0.5);
  assert.deepEqual(r.notes[r.sel[0]], [67, 0.5, 0.5, 80]);
  r = N.resizeNotes(notes, [1], -1, 0.125);
  assert.deepEqual(r.notes[1], [64, 0.5, 0.125, 90]);
  r = N.setVel(notes, [0, 1], 300);
  assert.deepEqual(r.notes.map((q) => q[3]), [127, 127, 80]);
  r = N.deleteNotes(notes, [1]);
  assert.deepEqual(r, { notes: [[60, 0, 0.5, 100], [67, 1, 0.5, 80]], sel: [] });
  // moving a note past another keeps the selection on it
  r = N.moveNotes(notes, [0], 2, 0, 0);
  assert.deepEqual(r.notes[r.sel[0]], [60, 2, 0.5, 100]);
  assert.equal(r.sel[0], 2);
  // adding: sorted in, selected
  r = N.addNote(notes, [50, 0.75, 0.25, 70]);
  assert.deepEqual(r.notes[r.sel[0]], [50, 0.75, 0.25, 70]);
  assert.equal(r.notes.length, 4);
  const full = []; for (let i = 0; i < N.MAX_NOTES; i++) full.push([60, i, 0.1, 100]);
  assert.equal(N.addNote(full, [60, 0, 1, 1]), null);
  // the notes come out in the clip's own order (core's normaliser keeps the indices)
  const k = C.normClip(K("cmidi0001", 1, { len: 9, n: r.notes }));
  assert.deepEqual(k.n, r.notes);
});

test("notes: quantize, box selection, copy and paste", () => {
  const notes = [[60, 0.1, 0.2, 100], [62, 0.37, 0.2, 100], [64, 0.8, 0.1, 100]];
  let r = N.quantize(notes, [], 0, 0.25, 1);                     // none selected: all
  assert.deepEqual(r.notes.map((q) => q[1]), [0, 0.25, 0.75]);
  assert.deepEqual(r.sel, []);
  r = N.quantize(notes, [1], 0, 0.25, 0.5);                      // half way, one note
  assert.deepEqual(r.notes.map((q) => q[1]), [0.1, 0.31, 0.8]);
  r = N.quantize(notes, [], 0.1, 0.25, 1);                       // the clip starts at 0.1 s: the project's grid
  assert.deepEqual(r.notes.map((q) => q[1]), [0.15, 0.4, 0.9]);
  assert.deepEqual(N.inRect(notes, 0, 0.4, 59, 62), [0, 1]);
  assert.deepEqual(N.inRect(notes, 0.5, 0.31, 70, 50), [1]);
  const cp = N.copyNotes(notes, [1, 2]);
  assert.deepEqual(cp, { notes: [[62, 0, 0.2, 100], [64, 0.43, 0.1, 100]], from: 0.37, span: 0.53 });
  r = N.pasteNotes(notes, cp, 1);
  assert.equal(r.notes.length, 5);
  assert.deepEqual(r.sel.map((i) => r.notes[i]), [[62, 1, 0.2, 100], [64, 1.43, 0.1, 100]]);
  assert.equal(N.copyNotes(notes, []), null);
  near(N.notesEnd(notes), 0.9);
});

// ---------- Standard MIDI Files ----------
test("smf: write and read back, type 0 and 1, drums on channel 10, programs", () => {
  const song = { bpm: 96, sig: 3, name: "Song", tracks: [
    { name: "Keys", ch: 0, prog: 4, notes: [[60, 0, 1, 100], [64, 0, 1, 90], [67, 1.5, 0.5, 80]] },
    { name: "Drums", ch: 9, prog: null, notes: [[36, 0, 0.25, 110], [38, 1, 0.25, 100]] }] };
  const t1 = N.readSmf(N.writeSmf(song, 1));
  assert.equal(t1.format, 1); assert.equal(t1.ppq, 480); assert.equal(t1.bpm, 96); assert.deepEqual(t1.sig, [3, 4]);
  assert.deepEqual(t1.tracks.map((p) => [p.name, p.ch, p.prog, p.notes]), [["Keys", 0, 4, song.tracks[0].notes], ["Drums", 9, null, song.tracks[1].notes]]);
  const t0 = N.readSmf(N.writeSmf(song, 0));
  assert.equal(t0.format, 0);
  assert.deepEqual(t0.tracks.map((p) => [p.ch, p.notes.length]), [[0, 3], [9, 2]]);   // one track split by channel
  assert.equal(N.instFor(t0.tracks[0].prog, 0), "epiano");
  assert.equal(N.instFor(null, 9), "drums");
  assert.equal(N.instFor(34, 1), "bass"); assert.equal(N.instFor(49, 1), "strings"); assert.equal(N.instFor(18, 1), "organ"); assert.equal(N.instFor(81, 1), "lead"); assert.equal(N.instFor(127, 1), "piano");
  ["piano", "epiano", "organ", "bass", "strings", "lead"].forEach((i) => assert.equal(N.instFor(N.programFor(i), 0), i));
  // header bytes
  const b = N.writeSmf(song, 0);
  assert.deepEqual(Array.from(b.slice(0, 14)), [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0]);
});

test("smf: running status, note-on with velocity 0, SMPTE time, unclosed notes, bad files", () => {
  const vlq = (n) => { const o = [n & 0x7f]; while ((n >>= 7)) o.unshift((n & 0x7f) | 0x80); return o; };
  const trk = (ev) => [0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, ev.length].concat(ev);
  const head = (fmt, n, div) => [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, fmt, 0, n, (div >> 8) & 255, div & 255];
  // tempo 120, then running status: on C4, on E4, (240 ticks) on C4 vel 0 (= off), off E4 via 0x80
  const ev = [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20,
    0, 0x90, 60, 100, 0, 64, 90, ...vlq(240), 60, 0, 0, 0x80, 64, 0,
    0, 0xf0, 2, 1, 0xf7,                                       // a sysex in between
    0, 0x91, 67, 70,                                           // never released
    ...vlq(480), 0xb1, 7, 100, 0, 0xff, 0x2f, 0];
  const r = N.readSmf(new Uint8Array(head(0, 1, 480).concat(trk(ev))));
  assert.equal(r.bpm, 120);
  assert.deepEqual(r.tracks.map((p) => [p.ch, p.notes]), [[0, [[60, 0, 0.5, 100], [64, 0, 0.5, 90]]], [1, [[67, 0.5, 1, 70]]]]);
  // SMPTE 25 fps x 40 ticks: read as 120 BPM (500 ticks a beat)
  const s = N.readSmf(new Uint8Array(head(0, 1, ((256 - 25) << 8) | 40).concat(trk([0, 0x90, 60, 100, ...vlq(500), 0x80, 60, 0, 0, 0xff, 0x2f, 0]))));
  assert.deepEqual(s.tracks[0].notes, [[60, 0, 1, 100]]);
  assert.throws(() => N.readSmf(new Uint8Array([1, 2, 3])));
  assert.throws(() => N.readSmf(new Uint8Array(head(0, 1, 480).concat(trk([0, 0x40, 1])))));      // data with no status
  assert.throws(() => N.readSmf(new TextEncoder().encode("MThd but not really a midi file at all")));
  // beats <-> seconds
  assert.deepEqual(N.toSec([[60, 1, 0.5, 100]], 120), [[60, 0.5, 0.25, 100]]);
  assert.deepEqual(N.toBeats([[60, 0.5, 0.25, 100]], 120), [[60, 1, 0.5, 100]]);
});

// ---------- Loops ----------
test("loops: every loop is complete, in range and fits its bars", () => {
  const ids = new Set();
  assert.ok(L.LOOPS.length >= 24);
  L.LOOPS.forEach((l) => {
    assert.ok(!ids.has(l.id), "duplicate " + l.id); ids.add(l.id);
    assert.ok(L.GENRES.includes(l.g) && L.KINDS.includes(l.k), l.id);
    assert.ok(M.PRESETS[l.inst], l.id + " instrument");
    assert.ok(l.bars >= 1 && l.bars <= 4 && l.bpm >= 60 && l.bpm <= 160, l.id);
    const pats = l.k === "drums" ? Object.values(l.lanes) : [l.rhythm];
    pats.forEach((s) => assert.ok(s.length === 16 || s.length === l.bars * 16, l.id + " pattern length"));
    const n = L.notesOf(l);
    assert.ok(n.length >= 4, l.id + " has notes");
    n.forEach((q) => {
      assert.ok(q[0] >= 24 && q[0] <= 96 && q[1] >= 0 && q[2] > 0 && q[1] + q[2] <= L.beatsOf(l) + 1e-9 && q[3] >= 1 && q[3] <= 127, l.id + " " + q);
      if (l.k === "drums") assert.ok(M.drumKind(q[0]), l.id + " drum " + q[0]);
    });
    assert.deepEqual(n, n.slice().sort(C.cmpNote));
  });
  // every style has drums, bass and keys
  L.GENRES.forEach((g) => L.KINDS.forEach((k) => assert.ok(L.filter({ g, k }).length >= 1, g + " " + k)));
  assert.equal(L.tempoBand(76), "slow"); assert.equal(L.tempoBand(90), "mid"); assert.equal(L.tempoBand(120), "fast");
  assert.ok(L.filter({ tempo: "slow" }).every((l) => l.bpm < 90));
  assert.equal(L.numberOf(L.byId("pop-d2")), 2);
  // at the project's tempo: seconds, and the clip a loop makes is valid
  const l = L.byId("pop-b1"), secs = N.toSec(L.notesOf(l), 100);
  const c = C.normClip(K("cmidi0001", 1, { len: L.beatsOf(l) * 0.6, n: secs }));
  assert.equal(c.n.length, L.notesOf(l).length);
  // swing pushes every second sixteenth late
  const lofi = L.notesOf(L.byId("lofi-d1")).filter((q) => q[0] === 42);
  assert.ok(lofi.every((q) => Math.abs(q[1] * 2 - Math.round(q[1] * 2)) < 1e-9));            // eighths: on the beat or the "and"
});

// ---------- Instruments ----------
test("instruments: the drum kit map, and scheduled notes on a stand-in audio context", () => {
  assert.ok(M.ORDER.includes("drums") && M.PRESETS.drums.kit);
  assert.equal(M.drumKind(36), "kick"); assert.equal(M.drumKind(38), "snare"); assert.equal(M.drumKind(42), "hat");
  assert.equal(M.drumKind(46), "ohat"); assert.equal(M.drumKind(49), "crash"); assert.equal(M.drumKind(60), "");
  // a stand-in context: records what was started and stopped
  const log = [];
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime(v) { if (!(v > 0)) throw new Error("exp ramp to " + v); }, setTargetAtTime() {}, cancelScheduledValues() {} });
  const node = (kind) => ({ kind, connect() {}, disconnect() {}, gain: param(), frequency: param(), detune: param(), Q: param(), type: "",
    start(t) { log.push([kind, "start", t]); }, stop(t) { log.push([kind, "stop", t]); } });
  const ctx = { sampleRate: 48000, currentTime: 0,
    createGain: () => node("gain"), createOscillator: () => node("osc"), createBiquadFilter: () => node("filter"),
    createBufferSource: () => node("noise"), createBuffer: (ch, n) => ({ sampleRate: 48000, getChannelData: () => new Float32Array(n) }) };
  const h = M.playNote(ctx, node("out"), "piano", 60, 100, 1, 0.5, 1);
  assert.ok(log.some((x) => x[0] === "osc" && x[1] === "start" && x[2] === 1));
  assert.ok(h.end > 1.5 && typeof h.stop === "function" && typeof h.disconnect === "function");
  Object.keys(M.drumKind ? { 35: 1, 36: 1, 37: 1, 38: 1, 39: 1, 41: 1, 42: 1, 44: 1, 46: 1, 49: 1, 51: 1, 54: 1, 56: 1, 60: 1 } : {}).forEach((n) => {
    log.length = 0;
    const d = M.playNote(ctx, node("out"), "drums", +n, 100, 2, 0.1, 0.5);
    assert.ok(log.some((x) => x[1] === "start" && x[2] >= 2), "drum " + n + " starts");
    assert.ok(d.end > 2);
    d.stop(); d.disconnect();
  });
  assert.equal(M.playNote(ctx, node("out"), "drums", 36, 0, 0, 0.1, 1).end, 0.05);   // velocity 0: nothing
  assert.ok(M.playNote(ctx, node("out"), "unknown", 60, 100, 0, 0.5, 1).end > 0.5); // an unknown instrument plays as piano
});

// ---------- Wiring ----------
test("wave 40 wiring: scripts, elements, strings in both languages, no code sinks", () => {
  const html = read("studio/index.html"), js = read("studio/studio.js"), roll = read("studio/roll.js");
  const at = (f) => html.indexOf('src="' + f);
  ["notes.js", "loops.js", "roll.js"].forEach((f) => assert.ok(at(f) > at("midi.js") && at(f) < at("studio.js"), f));
  ["loops-btn", "loops", "lp-list", "lp-genre", "lp-tempo", "lp-kind", "add-dlg", "add-insts", "add-audio", "pr-dlg", "pr-grid", "pr-keys",
   "pr-ruler", "pr-vstems", "pr-grid-sel", "pr-vel", "pr-quant", "pr-import", "pr-export", "notes-btn", "fi-field", "fo-field",
   "track-inst", "track-newclip", "track-midi", "kb-target"].forEach((id) => assert.ok(html.includes('id="' + id + '"'), id));
  [read("studio/notes.js"), read("studio/loops.js"), roll].forEach((src) =>
    assert.doesNotMatch(src, /\beval\(|new Function|insertAdjacentHTML|document\.write|outerHTML/));
  // roll.js puts only its own icons or nothing into innerHTML
  (roll.match(/innerHTML\s*=\s*[^;]+;/g) || []).forEach((m) => assert.match(m, /innerHTML\s*=\s*(""|ICON\.[a-z]+|ICON\[x\[1\]\]|x\[2\]|preview && preview\.id === l\.id \? ICON\.stop : ICON\.play);/, m));
  // every key the new code uses exists in English and Greek
  const src = js + roll;
  const keys = new Set();
  (src.match(/t\("((?:pr|lp|mi|tk|dr)\.[a-zA-Z0-9.]*)"/g) || []).forEach((m) => keys.add(m.slice(3, -1)));
  const built = { "lp.g": L.GENRES, "lp.k": L.KINDS, "dr.": ["kick", "snare", "rim", "clap", "hat", "pedal", "ohat", "crash", "ride", "shaker", "cow", "tom1", "tom2", "tom3"] };
  keys.forEach((k) => {
    if (built[k]) { built[k].forEach((id) => assert.equal((js.match(new RegExp('"' + (k + id).replace(/\./g, "\\.") + '":', "g")) || []).length, 2, k + id)); return; }
    assert.equal((js.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length, 2, k);
  });
  // every drum the kit names has a name in both languages
  Object.keys(M.PRESETS).forEach((id) => assert.equal((js.match(new RegExp('"snd\\.' + id + '":', "g")) || []).length, 2, "snd." + id));
  ["pr.g4", "pr.g8", "pr.g16", "pr.g32", "pr.g8t", "pr.g16t", "pr.goff"].forEach((k) => assert.equal((js.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length, 2, k));
  // the old limit is gone from the help, both languages have the same sections
  const en = read("studio/help.en.txt"), el = read("studio/help.el.txt");
  assert.doesNotMatch(en, /No MIDI tracks yet/);
  assert.equal((en.match(/^## /gm) || []).length, (el.match(/^## /gm) || []).length);
});
