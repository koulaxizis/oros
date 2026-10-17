// App interop (sound): Studio's Export dialog puts the mix into Music
// (/internal/Music, then { playPath }) and turns the instrument notes
// into a one-voice RTTTL melody for Ringtone Composer ({ importText }),
// which only fills its Import dialog. toRtttl is pure (studio/core.js)
// and its text is read back by ringtones/core.js with nothing skipped.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const C = require(path.join(ROOT, "studio/core.js"));
const R = require(path.join(ROOT, "ringtones/core.js"));

// 120 BPM: a 32nd note is 0.0625 s, a quarter 0.5 s
const N = (at, end, p) => ({ at, end, p });
const body = (tx) => tx.split(":").slice(2).join(":").split(",");
const back = (tx) => { const r = R.parseRTTTL(tx); assert.ok(r, "parsed"); assert.equal(r.skipped, 0, "nothing skipped"); return r; };

test("toRtttl: no notes → null; header, bpm clamp and name cleaning", () => {
  assert.equal(C.toRtttl([], 120, "x"), null);
  assert.equal(C.toRtttl(null, 120, "x"), null);
  const tx = C.toRtttl([N(0, 0.5, 69)], 120, "Μελωδία: one, two!");
  assert.equal(tx, "Μελωδία one two:d=4,o=5,b=120:4a4");
  assert.match(C.toRtttl([N(0, 1, 60)], 10, ""), /^Studio:d=4,o=5,b=40:/);
  assert.match(C.toRtttl([N(0, 1, 60)], 999, "a"), /b=300:/);
  const long = C.toRtttl([N(0, 0.5, 60)], 120, "x".repeat(80));
  assert.equal(long.split(":")[0].length, 40);
  assert.equal(back(long).name.length, 40);
});

test("toRtttl: overlapping notes keep the highest, a cut note does not come back", () => {
  // C4 0..0.5, C5 0.25..1: C4 for an eighth, then C5 for a dotted quarter
  assert.deepEqual(body(C.toRtttl([N(0, 0.5, 60), N(0.25, 1, 72)], 120, "a")), ["8c4", "4c5."]);
  // a short high note in the middle of a long low one: the low one does not resume
  assert.deepEqual(body(C.toRtttl([N(0, 2, 60), N(0.5, 1, 76)], 120, "a")), ["4c4", "4e5"]);
  // same start: the higher wins
  assert.deepEqual(body(C.toRtttl([N(0, 0.5, 64), N(0, 0.5, 67)], 120, "a")), ["4g4"]);
});

test("toRtttl: gaps become rests, leading silence is dropped, lengths split into allowed ones", () => {
  assert.deepEqual(body(C.toRtttl([N(3, 3.5, 69), N(4, 4.5, 71)], 120, "a")), ["4a4", "4p", "4b4"]);
  // 0.6 s ≈ 10 32nds → a quarter + a 16th
  assert.deepEqual(body(C.toRtttl([N(0, 0.6, 69)], 120, "a")), ["4a4", "16a4"]);
  // 3 s = 48 32nds → a dotted whole; 0.75 s = 12 → dotted quarter
  assert.deepEqual(body(C.toRtttl([N(0, 3, 69)], 120, "a")), ["1a4."]);
  assert.deepEqual(body(C.toRtttl([N(0, 0.75, 69)], 120, "a")), ["4a4."]);
  // a very short note still gets one 32nd
  assert.deepEqual(body(C.toRtttl([N(0, 0.01, 69)], 120, "a")), ["32a4"]);
  // quantized to the grid: 0.03 s off is the same 32nd
  assert.deepEqual(body(C.toRtttl([N(0.03, 0.53, 69)], 120, "a")), ["4a4"]);
  const lens = new Set();
  body(C.toRtttl([N(0, 0.37, 60), N(0.5, 2.3, 62), N(2.9, 3.05, 64)], 97, "a")).forEach((tk) => lens.add(parseInt(tk, 10)));
  lens.forEach((d) => assert.ok(R.LENGTHS.includes(d), "length " + d));
});

test("toRtttl: pitches fold into octaves 4..7 (A4 = 440 = MIDI 69)", () => {
  assert.deepEqual(body(C.toRtttl([N(0, 0.5, 69)], 120, "a")), ["4a4"]);
  assert.deepEqual(body(C.toRtttl([N(0, 0.5, 21)], 120, "a")), ["4a4"]);    // A0
  assert.deepEqual(body(C.toRtttl([N(0, 0.5, 127)], 120, "a")), ["4g7"]);   // G9
  assert.deepEqual(body(C.toRtttl([N(0, 0.5, 61)], 120, "a")), ["4c#4"]);
  assert.deepEqual(body(C.toRtttl([N(0, 0.5, 105)], 120, "a")), ["4a7"]);
  const r = back(C.toRtttl([N(0, 0.5, 69)], 120, "a"));
  assert.equal(R.freq(r.notes[0]), 440);
});

test("toRtttl: at most 255 notes; the text round-trips through RingtonesCore.parseRTTTL", () => {
  const many = [];
  for (let i = 0; i < 600; i++) many.push(N(i * 0.25, i * 0.25 + 0.2, 40 + (i * 7) % 60));
  const tx = C.toRtttl(many, 133, "Long one");
  assert.ok(body(tx).length <= 255);
  const r = back(tx);
  assert.equal(r.notes.length, body(tx).length);
  assert.equal(r.bpm, 133);
  assert.equal(r.name, "Long one");
  // one long rest is never more than 255 tokens either
  assert.ok(body(C.toRtttl([N(0, 0.1, 60), N(3000, 3001, 60)], 300, "a")).length <= 255);
  // random material: every token reads back, same pitch and length as written
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 30; k++) {
    const ns = [];
    for (let i = 0; i < 40; i++) { const a = rnd() * 20; ns.push(N(a, a + 0.02 + rnd() * 2, Math.floor(rnd() * 128))); }
    const t = C.toRtttl(ns, 40 + Math.floor(rnd() * 260), "R" + k);
    const rr = back(t);
    assert.equal(R.toRTTTL(rr.name, rr.bpm, rr.notes).length > 0, true);
    assert.deepEqual(rr.notes.map(R.token), body(t));
  }
});

test("Studio: Add to Music and Make a ringtone are wired, guarded and in EN and EL", () => {
  const html = src("studio/index.html"), js = src("studio/studio.js");
  assert.match(html, /id="export-music"[^>]*data-i18n="btn.toMusic"[^>]*hidden/);
  assert.match(html, /id="export-ring"[^>]*data-i18n="btn.ringtone"[^>]*hidden/);
  assert.match(js, /\$\("export-go"\)\.addEventListener\("click", function \(\) \{ doExport\("file"\); \}\)/);
  assert.match(js, /\$\("export-music"\)\.addEventListener\("click", function \(\) \{ doExport\("music"\); \}\)/);
  assert.match(js, /\$\("export-ring"\)\.addEventListener\("click", makeRingtone\)/);
  assert.match(js, /typeof w\.__orosOpenAt === "function"/);
  assert.match(js, /\$\("export-music"\)\.hidden = !musicFs\(\) \|\| !shellHas\(\)/);
  assert.match(js, /\$\("export-ring"\)\.hidden = !shellHas\(\)/);
  assert.match(js, /MUSIC_DIR = "\/internal\/Music"/);
  assert.match(js, /fs\.mkdir\(MUSIC_DIR\)/);
  assert.match(js, /" \(" \+ n \+ "\)"/);
  assert.match(js, /shellOpen\("music", \{ playPath: p \}\)/);
  assert.match(js, /shellOpen\("ringtones", \{ importText: \{ text: text \} \}\)/);
  assert.match(js, /C\.toRtttl\(/);
  const en = js.slice(js.indexOf("en: {"), js.indexOf("el: {")), el = js.slice(js.indexOf("el: {"));
  for (const k of ["btn.toMusic", "toast.toMusic", "toast.toMusicFail", "btn.ringtone", "toast.ringNoNotes"]) {
    assert.ok(en.includes('"' + k + '"'), k + " EN");
    assert.ok(el.includes('"' + k + '"'), k + " EL");
  }
  assert.ok(el.includes("Στη Μουσική") && el.includes("Κάνε το ήχο κλήσης"));
  assert.ok(el.includes("Ο Ήχος κλήσης χρειάζεται νότες: πρόσθεσε ένα κανάλι οργάνου."));
  const blk = js.slice(js.indexOf("9a. To other apps"), js.indexOf("9b. orOS file"));
  assert.doesNotMatch(blk, /innerHTML/);
  assert.match(src("studio/help.en.txt"), /Add to Music/);
  assert.match(src("studio/help.en.txt"), /Make a ringtone/);
  assert.match(src("studio/help.el.txt"), /Στη Μουσική/);
  assert.match(src("studio/help.el.txt"), /Κάνε το ήχο κλήσης/);
});

test("Music accepts { playPath } under its folder", () => {
  const m = src("music/music.js");
  assert.match(m, /typeof tg\.playPath === "string"/);
  assert.match(src("music/library.js"), /ROOT = "\/internal\/Music"/);
});

test("Ringtones: { importText } fills the Import dialog and does not import", () => {
  const js = src("ringtones/ringtones.js");
  const a = js.indexOf("function openTarget(tg)"), b = js.indexOf("window.__orosOpenAt = openTarget");
  assert.ok(a > 0 && b > a);
  const fn = js.slice(a, b);
  const imp = fn.slice(fn.indexOf("tg.importText"), fn.indexOf("tg.openFile.token"));
  assert.match(imp, /\$\("import-text"\)\.value = tx/);
  assert.match(imp, /openImport\(\)/);
  assert.doesNotMatch(imp, /doImport/);
  assert.match(js, /MAX_IMPORT_TEXT = 65536/);
  assert.match(imp, /tx\.length > MAX_IMPORT_TEXT/);
  assert.match(fn, /readImport\(f\)/, "openFile still works");
  assert.match(js.slice(a - 600, a), /importText: \{ text \}/, "documented");
  assert.match(src("ringtones/help.en.txt"), /Make a ringtone/);
  assert.match(src("ringtones/help.el.txt"), /Κάνε το ήχο κλήσης/);
});
