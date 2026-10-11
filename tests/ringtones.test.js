// Pure logic of the Ringtone Composer (ringtones/core.js): pitch and
// length of notes, RTTTL read and write, the old-phone keys, WAV
// output, the ready tunes and the melodies merge (sync slice
// "ringtones"); plus the wiring of the app.
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const C = require(path.join(__dirname, "..", "ringtones/core.js"));
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const mel = (id, m, extra) => Object.assign({ id, m, name: "Tune " + id, bpm: 120, voice: "square", notes: "4c5,4e5,4g5" }, extra || {});
const empty = () => ({ ver: 1, melodies: [], tombs: {} });
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= (eps || 1e-6), a + " ≉ " + b);

test("pitch: equal temperament, A4 = 440 Hz", () => {
  near(C.freq(C.mkNote(9, 4, 4)), 440);
  near(C.freq(C.mkNote(9, 5, 4)), 880);
  near(C.freq(C.mkNote(0, 4, 4)), 261.6256, 1e-3);           // middle C
  near(C.freq(C.mkNote(11, 7, 4)), 3951.066, 1e-2);
  assert.equal(C.freq(C.mkNote(-1, 5, 4)), 0);
});

test("length: bpm counts quarter notes, a dot adds half", () => {
  near(C.durMs(C.mkNote(0, 5, 4), 120), 500);
  near(C.durMs(C.mkNote(0, 5, 8), 120), 250);
  near(C.durMs(C.mkNote(0, 5, 1), 60), 4000);
  near(C.durMs(C.mkNote(0, 5, 4, true), 120), 750);
  near(C.durMs(C.mkNote(0, 5, 4), 10000), 60000 / C.MAX_BPM);  // clamped
  near(C.totalMs(C.parseNotes("4c5,8p,8d5"), 120), 1000);
});

test("tokens: always written in full, read leniently", () => {
  assert.equal(C.token(C.mkNote(1, 6, 8, true)), "8c#6.");
  assert.equal(C.token(C.mkNote(-1, 5, 16)), "16p");
  const t = (s) => C.token(C.parseToken(s, 4, 5));
  assert.equal(t("C#"), "4c#5");
  assert.equal(t("8 d_6"), "8d#6");
  assert.equal(t("4a."), "4a5.");
  assert.equal(t("4a.6"), "4a6.");
  assert.equal(t("h"), "4b5");
  assert.equal(t("e#"), "4f5");                                   // not on the keys: next natural
  assert.equal(t("b#7"), "4c7");                                   // stays inside 4..7
  assert.equal(t("2c9"), "2c7");
  assert.equal(C.parseToken("3c", 4, 5), null);                    // not a length
  assert.equal(C.parseToken("x", 4, 5), null);
  assert.equal(C.parseToken("", 4, 5), null);
  assert.deepEqual(C.parseNotes("4c5,junk,8p"), [C.mkNote(0, 5, 4), C.mkNote(-1, 5, 8)]);
  assert.equal(C.parseNotes(Array(400).fill("4c").join(",")).length, C.MAX_NOTES);
  assert.deepEqual(C.parseNotes(null), []);
});

test("RTTTL: reads phone tunes, defaults and all", () => {
  const r = C.parseRTTTL("Nokia:d=4,o=5,b=180:8e6,8d6,f#,g#,8c#6,8b,d,e,8b,8a,c#,e,2a");
  assert.equal(r.name, "Nokia");
  assert.equal(r.bpm, 180);
  assert.equal(r.notes.length, 13);
  assert.equal(C.notesText(r.notes), C.PRESETS[0].notes);
  const s = C.parseRTTTL("x::c,d");                                // spec defaults d=4, o=6, b=63
  assert.equal(s.bpm, 63);
  assert.equal(C.token(s.notes[0]), "4c6");
  assert.equal(C.parseRTTTL("Junk:d=4:zz,yy"), null);
  assert.equal(C.parseRTTTL("no colons"), null);
  assert.equal(C.parseRTTTL(null), null);
  const k = C.parseRTTTL("A:b=999:c,zz,d");
  assert.equal(k.bpm, C.MAX_BPM);
  assert.equal(k.skipped, 1);
  assert.equal(C.parseRTTTL("Multi\nline : d=8 , o=5 , b=100 :\nc,\nd").notes.length, 2);
});

test("RTTTL: what is written reads back the same", () => {
  C.PRESETS.forEach((p) => {
    const notes = C.parseNotes(p.notes);
    const txt = C.toRTTTL(p.en, p.bpm, notes);
    const back = C.parseRTTTL(txt);
    assert.equal(C.notesText(back.notes), p.notes, p.key);
    assert.equal(back.bpm, p.bpm);
    assert.ok(!/[:,]/.test(txt.split(":")[0]));
  });
  assert.equal(C.toRTTTL("Ode: to, joy", 120, C.parseNotes("4c5,8p,8d5")), "Ode to joy:d=8,o=5,b=120:4c,p,d");
  assert.ok(C.toRTTTL("", 120, C.parseNotes("4c5")).startsWith("orOS:"));
});

test("keys of an old phone", () => {
  assert.equal(C.token(C.keyNote(1, 8, 5)), "8c5");
  assert.equal(C.token(C.keyNote(7, 4, 6)), "4b6");
  const tk = (n) => C.token(n);
  assert.equal(tk(C.toggleSharp(C.parseToken("4c5"))), "4c#5");
  assert.equal(tk(C.toggleSharp(C.parseToken("4c#5"))), "4c5");
  assert.equal(tk(C.toggleSharp(C.parseToken("4e5"))), "4e5");     // E and B have no sharp
  assert.equal(tk(C.toggleSharp(C.parseToken("4b5"))), "4b5");
  assert.equal(tk(C.cycleOctave(C.parseToken("4c7"))), "4c4");
  assert.equal(tk(C.cycleOctave(C.parseToken("4c5"))), "4c6");
  assert.equal(tk(C.stepLength(C.parseToken("4c5"), true)), "2c5");
  assert.equal(tk(C.stepLength(C.parseToken("1c5"), true)), "1c5");
  assert.equal(tk(C.stepLength(C.parseToken("32c5"), false)), "32c5");
  assert.equal(tk(C.toggleDot(C.parseToken("4c5"))), "4c5.");
  assert.equal(tk(C.transpose(C.parseToken("4b5"), 1)), "4c6");
  assert.equal(tk(C.transpose(C.parseToken("4c4"), -3)), "4c4");    // stays in range
  assert.equal(tk(C.transpose(C.parseToken("8p"), 1)), "8p");
  assert.equal(C.noteName(C.parseToken("4c#6"), false), "C#6");
  assert.equal(C.noteName(C.parseToken("4c#6"), true), "ντο#6");
  assert.equal(C.noteName(C.parseToken("4p"), true), "–");
});

test("WAV: header and length", () => {
  const notes = C.parseNotes("4c5,4p,4e5");
  const rate = 8000;
  const smp = C.renderSamples(notes, 120, "square", rate);
  assert.equal(smp.length, Math.ceil(1.5 * rate) + Math.round(rate * 0.05));
  assert.ok(Math.max(...smp) <= 1 && Math.min(...smp) >= -1);
  const restPart = smp.slice(Math.round(0.5 * rate) + 10, Math.round(1.0 * rate) - 10);
  assert.ok(restPart.every((v) => v === 0));                        // a rest is silent
  assert.ok(smp.slice(100, 3000).some((v) => v !== 0));
  ["soft", "bell"].forEach((v) => assert.equal(C.renderSamples(notes, 120, v, rate).length, smp.length));
  const w = C.wavBytes(smp, rate), dv = new DataView(w.buffer);
  const s4 = (o) => String.fromCharCode(w[o], w[o + 1], w[o + 2], w[o + 3]);
  assert.equal(s4(0), "RIFF");
  assert.equal(s4(8), "WAVE");
  assert.equal(s4(12), "fmt ");
  assert.equal(s4(36), "data");
  assert.equal(dv.getUint32(4, true), w.length - 8);
  assert.equal(dv.getUint16(22, true), 1);
  assert.equal(dv.getUint32(24, true), rate);
  assert.equal(dv.getUint16(34, true), 16);
  assert.equal(dv.getUint32(40, true), smp.length * 2);
});

test("ready tunes: all read cleanly", () => {
  const keys = new Set();
  C.PRESETS.forEach((p) => {
    assert.ok(!keys.has(p.key)); keys.add(p.key);
    const notes = C.parseNotes(p.notes);
    assert.equal(notes.length, p.notes.split(",").length, p.key);
    assert.equal(C.notesText(notes), p.notes, p.key);
    assert.ok(p.en && p.el && p.bpm >= C.MIN_BPM && p.bpm <= C.MAX_BPM);
  });
});

test("mergeRingtones: LWW per melody, laws hold", () => {
  const A = { melodies: [mel("raaaaaa1", 5), mel("rbbbbbb1", 9, { name: "Old" })], tombs: {} };
  const B = { melodies: [mel("rbbbbbb1", 12, { name: "New", voice: "bell" }), mel("rcccccc1", 3)], tombs: {} };
  const ab = C.mergeRingtones(A, B), ba = C.mergeRingtones(B, A);
  assert.deepEqual(ab, ba);
  assert.deepEqual(C.mergeRingtones(ab, ab), ab);
  const D = { melodies: [mel("rdddddd1", 1)], tombs: { raaaaaa1: 2 } };
  assert.deepEqual(C.mergeRingtones(C.mergeRingtones(A, B), D), C.mergeRingtones(A, C.mergeRingtones(B, D)));
  assert.equal(C.findMelody(ab, "rbbbbbb1").name, "New");
  assert.equal(C.findMelody(ab, "rbbbbbb1").voice, "bell");
  const t1 = C.mergeRingtones({ melodies: [mel("reeeeee1", 7, { name: "A" })] }, { melodies: [mel("reeeeee1", 7, { name: "B" })] });
  const t2 = C.mergeRingtones({ melodies: [mel("reeeeee1", 7, { name: "B" })] }, { melodies: [mel("reeeeee1", 7, { name: "A" })] });
  assert.deepEqual(t1, t2);
});

test("mergeRingtones: tombstones, undo, junk", () => {
  const base = { melodies: [mel("raaaaaa1", 5)], tombs: {} };
  const del = C.mergeRingtones(base, { melodies: [], tombs: { raaaaaa1: 5 } });
  assert.equal(del.melodies.length, 0);
  assert.equal(C.mergeRingtones(del, { melodies: [mel("raaaaaa1", 6)] }).melodies.length, 1);
  assert.equal(C.mergeRingtones(del, { melodies: [mel("raaaaaa1", 4)] }).melodies.length, 0);
  const junk = C.mergeRingtones({
    melodies: [null, 7, { id: "bad", m: 1, notes: "4c5" }, { id: "rffffff1", m: -1, notes: "4c5" },
               { id: "rgggggg1", m: 2, notes: "zz,yy" },
               { id: "rhhhhhh1", m: 3, name: "  a\u0000b  ", bpm: 9999, voice: "kazoo", notes: "C,junk,8d.6", extra: 1 }],
    tombs: { bad: 1, riiiiii1: -1, rjjjjjj1: 4 }
  }, null);
  assert.deepEqual(junk.melodies, [{ id: "rhhhhhh1", m: 3, name: "a b", bpm: C.MAX_BPM, voice: "square", notes: "4c5,8d6." }]);
  assert.deepEqual(junk.tombs, { rjjjjjj1: 4 });
  assert.deepEqual(C.mergeRingtones(undefined, null), empty());
});

test("ids and file names", () => {
  assert.ok(C.ID_RE.test(C.newId(Math.random)));
  assert.equal(C.fileName("Ωδή στη Χαρά", "wav"), "Ωδή-στη-Χαρά.wav");
  assert.equal(C.fileName("../", "txt"), "ringtone.txt");
});

test("wiring: app, palette, sync, help", () => {
  const js = read("ringtones/ringtones.js"), html = read("ringtones/index.html");
  assert.ok(js.includes("inheritPalette") && js.includes("watchPalette"));            // guard G3
  assert.ok(/registerSlice\("ringtones", sliceGet, sliceSet, STORAGE_KEY, C\.mergeRingtones\)/.test(js));
  assert.ok(js.includes('"oros-ringtones-data"') && js.includes('"oros-ringtones-prefs"'));
  assert.ok(html.indexOf("core.js") < html.indexOf("ringtones.js"));
  for (const f of ["help.en.txt", "help.el.txt"]) assert.ok(fs.existsSync(path.join(__dirname, "..", "ringtones", f)));
});
