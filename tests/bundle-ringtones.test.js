// The .orostone file (Ringtones): pack a
// melody with bundle.js, read it back as a NEW item
// through the app's own rules, and the app wiring (save, open,
// unzipped folder, "Open with").
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const C = require(path.join(ROOT, "ringtones/core.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const names = (bytes) => {
  // the central directory names, in order
  const out = [], s = Buffer.from(bytes);
  for (let i = 0; i < s.length - 4; i++) if (s.readUInt32LE(i) === 0x02014b50) out.push(s.slice(i + 46, i + 46 + s.readUInt16LE(i + 28)).toString());
  return out;
};

test("ringtones: a melody round-trips as a new melody, with RTTTL and WAV previews", async () => {
  const x = { id: "rabcdef123", m: 1700000000000, name: "Ωδή", bpm: 140, voice: "bell", notes: "4e5,8p,8f#6.,2g4" };
  const opts = C.toneBundle(x, { lang: "en", date: new Date(2026, 0, 2) });
  const bytes = await B.write(opts);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-tone");
  const list = names(bytes);
  ["content.json", "preview/tone.rtttl", "preview/tone.wav"].forEach((n) => assert.ok(list.includes(n), n));
  const r = await B.read(bytes, { mime: C.TONE_MIME });
  assert.deepEqual(r.content, { kind: "oros-ringtones-package", ver: 1, melody: x });
  const y = C.toneFromBundle(r.content, () => 0.5, 1800000000000);
  assert.ok(C.ID_RE.test(y.id) && y.id !== x.id);
  assert.deepEqual(Object.assign({}, y, { id: x.id, m: x.m }), x);
  assert.equal(y.m, 1800000000000);
  // the RTTTL preview reads back as the same notes
  const rt = C.parseRTTTL(opts.preview[0].data);
  assert.equal(C.notesText(rt.notes), x.notes);
  // a long melody gets no WAV
  const long = Object.assign({}, x, { bpm: 40, notes: Array(40).fill("1c5").join(",") });
  assert.deepEqual(C.toneBundle(long, {}).preview.map((p) => p.name), ["tone.rtttl"]);
  assert.equal(C.toneBundle({ id: "bad" }, {}), null);
});

test("ringtones: a hostile file goes through normMelody", () => {
  assert.equal(C.toneFromBundle(null), null);
  assert.equal(C.toneFromBundle({ kind: "x", melody: {} }), null);
  assert.equal(C.toneFromBundle({ kind: "oros-ringtones-package", melody: { notes: "zz" } }), null);
  const y = C.toneFromBundle({ kind: "oros-ringtones-package", melody: { id: "../x", name: "a\nb", bpm: 9999, voice: "<x>", notes: "4c5" } }, Math.random, 7);
  assert.equal(y.name, "a b");
  assert.equal(y.bpm, C.MAX_BPM);
  assert.equal(y.voice, C.DEFAULT.voice);
  assert.ok(C.ID_RE.test(y.id));
});

test("wiring: bundle.js before the app, save / open / folder / Open with", () => {
  const rh = read("ringtones/index.html"), rj = read("ringtones/ringtones.js");
  assert.ok(rh.indexOf("core.js") < rh.indexOf("../bundle.js") && rh.indexOf("../bundle.js") < rh.indexOf("ringtones.js"));
  assert.ok(rh.includes('id="tone-btn"') && rh.includes('id="import-folder"') && rh.includes(".orostone"));
  ["saveTone", "importFolder", "OrosBundle", "C.TONE_MIME", '"newer"'].forEach((k) => assert.ok(rj.includes(k), k));
  for (const app of ["ringtones"]) {
    const en = read(app + "/help.en.txt"), el = read(app + "/help.el.txt");
    const x = app === "prompter" ? ".orosscript" : ".orostone";
    assert.ok(en.includes(x) && el.includes(x), app);
  }
});
