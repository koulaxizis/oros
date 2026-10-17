// Music wave 5 (music/core.js): ReplayGain and lyrics in the tags of
// every file type, the LRC parser, the LRCLIB match, the sound
// settings, the volume levelling factor and the crossfade curves.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "music/core.js")).OrosMusicCore;

const enc = (s) => Array.from(Buffer.from(s, "utf8"));
const lat = (s) => Array.from(Buffer.from(s, "latin1"));
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const ss = (n) => [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127];
const u8 = (a) => new Uint8Array(a);
function id3v24(frames) {
  const body = [];
  frames.forEach(([id, data]) => { body.push(...lat(id), ...ss(data.length), 0, 0, ...data); });
  return [...lat("ID3"), 4, 0, 0, ...ss(body.length), ...body];
}
function vorbisBlock(pairs) {
  const b = [...le32(4), ...lat("test"), ...le32(pairs.length)];
  pairs.forEach((p) => { const e = enc(p); b.push(...le32(e.length), ...e); });
  return b;
}
function box(type, body) { return [...be32(8 + body.length), ...lat(type), ...body]; }
function item(type, dtype, value) { return box(type, box("data", [...be32(dtype), ...be32(0), ...value])); }

test("ID3v2.4: ReplayGain in TXXX frames and lyrics in USLT", () => {
  const txxx = (k, v) => [3, ...enc(k), 0, ...enc(v)];
  const uslt = [3, ...lat("eng"), 0, ...enc("Πρώτος στίχος\r\nSecond line")];
  const head = u8(id3v24([
    ["TIT2", [3, ...enc("Song")]],
    ["TXXX", txxx("REPLAYGAIN_TRACK_GAIN", "-7.25 dB")], ["TXXX", txxx("replaygain_track_peak", "0.988")],
    ["TXXX", txxx("REPLAYGAIN_ALBUM_GAIN", "-6,10 dB")], ["TXXX", txxx("SOMETHING_ELSE", "12")],
    ["USLT", uslt]
  ]));
  const r = C.readTags({ head, size: head.length, name: "x.mp3" });
  assert.equal(r.t, "Song");
  assert.deepEqual(r.rg, { tg: -7.25, tp: 0.99, ag: -6.1 });
  assert.equal(r.ly, "Πρώτος στίχος\nSecond line");
  // UTF-16 USLT with an empty description
  const u16 = (s) => { const b = [0xff, 0xfe]; for (const ch of s) { const c = ch.charCodeAt(0); b.push(c & 255, c >> 8); } return b; };
  const head2 = u8(id3v24([["USLT", [1, ...lat("ell"), ...u16(""), 0, 0, ...u16("Λα λα")]]]));
  assert.equal(C.readTags({ head: head2, size: head2.length, name: "y.mp3" }).ly, "Λα λα");
  // Lyrics some taggers keep in TXXX (LYRICS / UNSYNCEDLYRICS / USLT): not a gain
  const head3 = u8(id3v24([["TXXX", [3, ...enc("UNSYNCEDLYRICS"), 0, ...enc("Words")]]]));
  const r3 = C.readTags({ head: head3, size: head3.length, name: "z.mp3" });
  assert.equal(r3.ly, "Words");
  assert.equal(r3.rg, null);
});

test("FLAC/Vorbis and Opus: REPLAYGAIN_* and R128 gains, LYRICS", () => {
  const blk = (type, data, last) => [(last ? 0x80 : 0) | type, (data.length >> 16) & 255, (data.length >> 8) & 255, data.length & 255, ...data];
  const si = new Array(34).fill(0);
  const vc = vorbisBlock(["TITLE=T", "REPLAYGAIN_TRACK_GAIN=+2.50 dB", "REPLAYGAIN_TRACK_PEAK=0.5", "LYRICS=[00:01.00]One", "REPLAYGAIN_ALBUM_GAIN=nonsense"]);
  const r = C.readTags({ head: u8([...lat("fLaC"), ...blk(0, si), ...blk(4, vc, true)]), size: 1e6, name: "x.flac" });
  assert.deepEqual(r.rg, { tg: 2.5, tp: 0.5 });
  assert.equal(r.ly, "[00:01.00]One");
  // Opus: R128_TRACK_GAIN is Q7.8 dB relative to -23 LUFS
  const oggPage = (p) => { const segs = []; let n = p.length; while (n >= 255) { segs.push(255); n -= 255; } segs.push(n);
    return [...lat("OggS"), 0, 0, ...le32(0), ...le32(0), ...le32(1), ...le32(0), ...le32(0), segs.length, ...segs, ...p]; };
  const opusHead = [...lat("OpusHead"), 1, 2, 0, 0, ...le32(48000), 0, 0, 0];
  const tags = [...lat("OpusTags"), ...vorbisBlock(["TITLE=O", "R128_TRACK_GAIN=-1280"])];
  const r2 = C.readTags({ head: u8([...oggPage(opusHead), ...oggPage(tags)]), size: 1e5, name: "x.opus" });
  assert.deepEqual(r2.rg, { tg: 0 });
  // A peak alone is no gain
  const r3 = C.readTags({ head: u8([...lat("fLaC"), ...blk(4, vorbisBlock(["REPLAYGAIN_TRACK_PEAK=0.9"]), true)]), size: 10, name: "x.flac" });
  assert.equal(r3.rg, null);
  assert.equal(r3.ly, "");
});

test("MP4: free-form iTunes ReplayGain and ©lyr", () => {
  const ff = (name, v) => box("----", [...box("mean", [0, 0, 0, 0, ...lat("com.apple.iTunes")]), ...box("name", [0, 0, 0, 0, ...lat(name)]),
    ...box("data", [...be32(1), ...be32(0), ...enc(v)])]);
  const ilst = box("ilst", [...item("©nam", 1, enc("M")), ...ff("replaygain_track_gain", "-3.40 dB"), ...ff("replaygain_album_peak", "1.02"),
    ...item("©lyr", 1, enc("Words"))]);
  const meta = box("meta", [0, 0, 0, 0, ...box("hdlr", new Array(25).fill(0)), ...ilst]);
  const moov = box("moov", [...box("udta", meta)]);
  const file = u8([...box("ftyp", lat("M4A isomM4A ")), ...moov]);
  const r = C.readTags({ head: file, size: file.length, name: "x.m4a" });
  assert.equal(r.t, "M");
  assert.deepEqual(r.rg, { tg: -3.4, ap: 1.02 });
  assert.equal(r.ly, "Words");
});

test("LRC: stamps, several per line, offset, word stamps, header tags", () => {
  const r = C.parseLrc("[ti:Song]\n[ar:Band]\n[offset:+250]\n[00:12.50]Πρώτη <00:13.00>γραμμή\n[00:20][01:02.123]Ρεφρέν\n\n[00:30.5]  Third  \nno stamp");
  assert.deepEqual(r.lines.map((x) => [x.t, x.s]), [[12.25, "Πρώτη γραμμή"], [19.75, "Ρεφρέν"], [30.25, "Third"], [61.87, "Ρεφρέν"]]);
  assert.ok(!/ti:|ar:/.test(r.plain));
  assert.equal(C.lrcAt(r.lines, 0), -1);
  assert.equal(C.lrcAt(r.lines, 12.2), 0);           // 50 ms early still counts
  assert.equal(C.lrcAt(r.lines, 25), 1);
  assert.equal(C.lrcAt(r.lines, 999), 3);
  assert.equal(C.lrcAt([], 5), -1);
  const p = C.parseLrc("Verse one\r\n\r\n\r\n\r\nVerse two\n");
  assert.deepEqual(p.lines, []);
  assert.equal(p.plain, "Verse one\n\nVerse two");
  assert.deepEqual(C.parseLrc(""), { lines: [], plain: "" });
  // Hostile input: huge and odd, never throws
  assert.doesNotThrow(() => C.parseLrc("[99:99.9999]".repeat(10000) + "[<>]".repeat(1000)));
});

test("LRCLIB search: same title and artist, length within 3 s, synced first", () => {
  const list = [
    { trackName: "Other", artistName: "Band", duration: 200, syncedLyrics: "[00:01]x" },
    { trackName: "Song", artistName: "Band", duration: 230, syncedLyrics: "[00:01]far" },
    { trackName: "song", artistName: "The Band", duration: 201, plainLyrics: "plain" },
    { trackName: "Song", artistName: "Band", duration: 202, syncedLyrics: "[00:01]best", plainLyrics: "p" },
    null, "x"
  ];
  const best = C.lrclibPick(list, { t: "Song", a: "Band", d: 200 });
  assert.equal(best.syncedLyrics, "[00:01]best");
  assert.equal(C.lrclibPick(list, { t: "Nope", a: "Band", d: 200 }), null);
  assert.equal(C.lrclibPick("not a list", { t: "Song", a: "Band" }), null);
  // No length known: any length matches
  assert.ok(C.lrclibPick(list, { t: "Song", a: "Band" }));
});

test("sound settings: defaults, clamps, presets", () => {
  const d = C.normSound(null);
  assert.deepEqual(d, { eq: { on: 0, p: "flat", g: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, xf: 0, gap: 1, rg: "auto", pre: 0 });
  const s = C.normSound({ eq: { on: true, p: "rock" }, xf: 40, gap: 0, rg: "album", pre: -20 });
  assert.deepEqual(s.eq.g, C.EQ_PRESETS.rock);
  assert.equal(s.eq.on, 1); assert.equal(s.xf, 12); assert.equal(s.gap, 0); assert.equal(s.rg, "album"); assert.equal(s.pre, -6);
  const c = C.normSound({ eq: { p: "custom", g: [30, -30, 1.26, "x", 0, 0, 0, 0, 0, 0] }, rg: "loud", xf: "abc" });
  assert.deepEqual(c.eq.g.slice(0, 4), [12, -12, 1.5, 0]);
  assert.equal(c.rg, "auto"); assert.equal(c.xf, 0);
  assert.equal(C.normSound({ eq: { p: "nope" } }).eq.p, "flat");
  Object.keys(C.EQ_PRESETS).forEach((k) => assert.equal(C.EQ_PRESETS[k].length, C.EQ_HZ.length, k));
  assert.equal(C.eqPreamp([0, 6, -3]), -6);
  assert.equal(C.eqPreamp([-2, -1]), -0);
});

test("ReplayGain factor: track/album/auto, pre-amp, never over the peak", () => {
  const rg = { tg: -6.02, tp: 0.5, ag: -12.04, ap: 0.6 };
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.01, a + " ≠ " + b);
  near(C.rgFactor(rg, "track", true, 0), 0.5);
  near(C.rgFactor(rg, "album", false, 0), 0.25);
  near(C.rgFactor(rg, "auto", true, 0), 0.25);
  near(C.rgFactor(rg, "auto", false, 0), 0.5);
  near(C.rgFactor(rg, "track", false, 6.02), 1);
  assert.equal(C.rgFactor(rg, "off", false, 0), 1);
  assert.equal(C.rgFactor(null, "auto", false, 0), 1);
  // A boost stops at 1 / peak
  near(C.rgFactor({ tg: 10, tp: 0.8 }, "track", false, 0), 1.25);
  // Only an album gain: used for track mode too
  near(C.rgFactor({ ag: -6.02 }, "track", false, 0), 0.5);
});

test("crossfade curves keep the power constant", () => {
  [0, 0.25, 0.5, 0.75, 1].forEach((x) => {
    const p = C.fadeOut(x) ** 2 + C.fadeIn(x) ** 2;
    assert.ok(Math.abs(p - 1) < 1e-9);
  });
  assert.equal(C.fadeOut(-1), 1); assert.equal(C.fadeIn(2), 1);
});
