// Studio wave A1b: StudioEncode.id3v24, the one ID3v2.4 writer for every
// MP3 orOS makes (songs, audiobook chapters, podcast episodes).
// Read back by Music's own ID3 reader and, where it is installed, by ffprobe.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");
const E = require(path.join(__dirname, "..", "studio/encode.js"));
const M = require(path.join(__dirname, "..", "music/core.js")).OrosMusicCore;

// the tag writer Studio used before wave A1b, kept here to prove the same bytes
function oldId3Tag(title, tool) {
  let frames = [];
  const syncsafe = (n) => [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127];
  function frame(id, text) {
    if (!text) return;
    const body = [3].concat(E.utf8(text));
    frames = frames.concat([...id].map((c) => c.charCodeAt(0)), syncsafe(body.length), [0, 0], body);
  }
  frame("TIT2", String(title).slice(0, 200));
  frame("TSSE", tool);
  if (!frames.length) return new Uint8Array(0);
  return new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0].concat(syncsafe(frames.length), frames));
}
const unsync = (b, o) => ((b[o] & 127) << 21) | ((b[o + 1] & 127) << 14) | ((b[o + 2] & 127) << 7) | (b[o + 3] & 127);
// every frame of a v2.4 tag: [{ id, body }], checking each size
function frames(tag, o = 10, end = 10 + unsync(tag, 6)) {
  const out = [];
  while (o + 10 <= end && tag[o] !== 0) {
    const id = String.fromCharCode(...tag.subarray(o, o + 4)), n = unsync(tag, o + 4);
    assert.ok(o + 10 + n <= end, id + " fits in its tag");
    out.push({ id, body: tag.subarray(o + 10, o + 10 + n) });
    o += 10 + n;
  }
  return out;
}
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x90, 0x77, 0x53, 0xde]);

test("id3Tag (the old title tag) writes the very same bytes as before", () => {
  for (const t of ["Song", "Συννεφιασμένη Κυριακή", "x".repeat(300), "", "😀 emoji", "a/b \"c\""]) {
    assert.deepEqual(E.id3Tag(t, "orOS Studio"), oldId3Tag(t, "orOS Studio"), JSON.stringify(t));
  }
  assert.equal(E.id3v24({}).length, 0);
  assert.equal(E.id3v24(null).length, 0);
});

test("text, list, comment, TXXX, URL, cover and length read back in Music", () => {
  const tag = E.id3v24({
    title: "Κεφάλαιο 1", artist: ["Χρήστος", "Άλλος"], album: "Το βιβλίο", albumArtist: "Χρήστος", composer: "Αφηγητής",
    track: "1/12", disc: 1, date: "2026-11-13", genre: "Audiobook", publisher: "Γλαρόλυκοι", copyright: "© 2026",
    isrc: "GRA012600001", lang: "ell", length: 61234, comment: { lang: "ell", text: "Σχόλιο" },
    txxx: [{ desc: "ISBN", value: "978-618-00-0000-0" }, { desc: "REPLAYGAIN_TRACK_GAIN", value: "-3.20 dB" }],
    url: "https://glarolykoi.net/book", cover: { mime: "image/png", bytes: PNG }, tool: "orOS Studio"
  });
  const fr = frames(tag);
  assert.deepEqual(fr.map((f) => f.id), ["TIT2", "TPE1", "TPE2", "TALB", "TCOM", "TRCK", "TPOS", "TDRC", "TCON", "TPUB", "TCOP", "TSRC", "TLAN", "TLEN", "COMM", "TXXX", "TXXX", "WOAS", "APIC", "TSSE"]);
  assert.equal(Buffer.from(fr[1].body.subarray(1)).toString("utf8"), "Χρήστος\u0000Άλλος", "v2.4 list: values split by a zero byte");
  const r = M.parseId3v2(tag, "auto");
  assert.equal(r.t, "Κεφάλαιο 1"); assert.equal(r.al, "Το βιβλίο"); assert.equal(r.aa, "Χρήστος");
  assert.equal(r.n, "1/12"); assert.equal(r.y, "2026-11-13"); assert.equal(r.g, "Audiobook"); assert.equal(r.len, "61234");
  assert.equal(r.rgT, -3.2);
  assert.equal(r.pics.length, 1); assert.equal(r.pics[0].type, 3); assert.equal(r.pics[0].mime, "image/png");
  assert.deepEqual(Array.from(r.pics[0].data), Array.from(PNG));
  const woas = fr.find((f) => f.id === "WOAS");
  assert.equal(Buffer.from(woas.body).toString("latin1"), "https://glarolykoi.net/book", "URL frames have no encoding byte");
});

test("values that do not fit are left out whole", () => {
  const fr = frames(E.id3v24({ title: "  T\u0000i\u0007tle  ", track: "0", disc: "x", date: "2026-13", isrc: "bad", lang: "greek", length: -5,
    url: "javascript:alert(1)", cover: { mime: "image/svg+xml", bytes: PNG }, txxx: [{ desc: "", value: "v" }, { desc: "d" }], comment: "" }));
  assert.deepEqual(fr.map((f) => f.id), ["TIT2"]);
  assert.equal(Buffer.from(fr[0].body.subarray(1)).toString("utf8"), "Title");
  const padded = E.id3v24({ title: "a", padding: 100 });
  assert.equal(unsync(padded, 6), padded.length - 10);
  assert.ok(padded.subarray(padded.length - 100).every((b) => b === 0));
  assert.equal(frames(padded).length, 1);
});

test("chapters: CHAP frames in time order with a CTOC that lists them", () => {
  const tag = E.id3v24({ title: "Book", tocTitle: "Contents", chapters: [
    { start: 60000, end: 120000, title: "Δεύτερο", url: "https://example.org/2" },
    { id: "intro", start: 0, end: 60000, title: "Εισαγωγή" },
    { start: 90000, end: 100000, title: "overlaps: dropped" },
    { start: 5, end: 5 }, { id: "toc", start: 120000, end: 180000 }
  ] });
  const fr = frames(tag), chaps = fr.filter((f) => f.id === "CHAP"), toc = fr.find((f) => f.id === "CTOC");
  assert.equal(chaps.length, 3);
  const read = chaps.map((c) => {
    const b = c.body, z = b.indexOf(0), id = Buffer.from(b.subarray(0, z)).toString("latin1"), dv = new DataView(b.buffer, b.byteOffset + z + 1, 16);
    const sub = frames(b, z + 17, b.length);
    return { id, start: dv.getUint32(0), end: dv.getUint32(4), off: dv.getUint32(8), sub: sub.map((s) => s.id),
             title: sub[0] ? Buffer.from(sub[0].body.subarray(1)).toString("utf8") : "" };
  });
  assert.deepEqual(read.map((c) => [c.id, c.start, c.end, c.title]), [["intro", 0, 60000, "Εισαγωγή"], ["ch1", 60000, 120000, "Δεύτερο"], ["ch5", 120000, 180000, ""]]);
  assert.equal(read[0].off, 0xffffffff);
  assert.deepEqual(read[1].sub, ["TIT2", "WXXX"]);
  const tb = toc.body;
  assert.equal(Buffer.from(tb.subarray(0, 3)).toString(), "toc");
  assert.equal(tb[4], 3, "top level and ordered");
  assert.equal(tb[5], 3);
  assert.deepEqual(Buffer.from(tb.subarray(6, 6 + "intro ch1 ch5 ".length)).toString().split("\u0000"), ["intro", "ch1", "ch5", ""]);
  assert.deepEqual(frames(tb, 6 + "intro ch1 ch5 ".length, tb.length).map((f) => f.id), ["TIT2"]);
  const many = Array.from({ length: 300 }, (_, i) => ({ start: i * 1000, end: i * 1000 + 1000 }));
  assert.equal(frames(E.id3v24({ chapters: many })).filter((f) => f.id === "CHAP").length, 255);
});

test("an MP3 with the full tag plays and reads in ffprobe (skips without it)", (t) => {
  let has = true;
  try { execFileSync("ffprobe", ["-version"], { stdio: "ignore" }); } catch (e) { has = false; }
  if (!has) { t.skip("no ffprobe"); return; }
  const rate = 44100, n = rate * 3, pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) pcm[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / rate);
  const enc = new E.Mp3Encoder([pcm], rate, 128, { title: "Ch", tags: { artist: "Narrator", album: "Book", cover: { mime: "image/png", bytes: PNG },
    chapters: [{ start: 0, end: 1500, title: "One" }, { start: 1500, end: 3000, title: "Two" }] } });
  while (!enc.step(50)) {}
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "id3-")), "t.mp3");
  fs.writeFileSync(file, enc.bytes());
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_format", "-show_chapters", "-show_streams", "-of", "json", file]).toString());
  assert.equal(j.format.tags.title, "Ch"); assert.equal(j.format.tags.artist, "Narrator"); assert.equal(j.format.tags.album, "Book");
  assert.equal(j.format.tags.encoder, "orOS Studio");
  assert.deepEqual(j.chapters.map((c) => [c.start_time, c.end_time, c.tags.title]), [["0.000000", "1.500000", "One"], ["1.500000", "3.000000", "Two"]]);
  assert.ok(j.streams.some((s) => s.codec_name === "png" && s.disposition.attached_pic === 1), "cover attached");
  assert.ok(j.streams.some((s) => s.codec_name === "mp3"));
});
