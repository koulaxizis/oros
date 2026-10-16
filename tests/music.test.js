// Pure logic of the Music app (music/core.js): tags of every file
// type (built byte by byte here), Greek legacy tags, track keys, the
// merge of the sync slice "music", the mutations, the play queue and
// the library views.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "music/core.js")).OrosMusicCore;

// ---------- byte builders ----------
const enc = (s) => Array.from(Buffer.from(s, "utf8"));
const lat = (s) => Array.from(Buffer.from(s, "latin1"));
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const ss = (n) => [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1];
const u8 = (a) => new Uint8Array(a);

function id3v23(frames) {
  const body = [];
  frames.forEach(([id, data]) => { body.push(...lat(id), ...be32(data.length), 0, 0, ...data); });
  return [...lat("ID3"), 3, 0, 0, ...ss(body.length), ...body];
}
function id3v24(frames) {
  const body = [];
  frames.forEach(([id, data]) => { body.push(...lat(id), ...ss(data.length), 0, 0, ...data); });
  return [...lat("ID3"), 4, 0, 0, ...ss(body.length), ...body];
}
const txt0 = (s) => [0, ...lat(s)];
const txt3 = (s) => [3, ...enc(s)];
const txt1 = (s) => { const b = [1, 0xff, 0xfe]; for (const ch of s) { const c = ch.charCodeAt(0); b.push(c & 255, c >> 8); } return b; };
// One MPEG1 Layer III frame header (128 kbps, 44.1 kHz, stereo) + Xing with a frame count.
function mp3Frame(frames) {
  const f = new Array(417).fill(0);
  f[0] = 0xff; f[1] = 0xfb; f[2] = 0x90; f[3] = 0x00;
  const x = 4 + 32;
  lat("Xing").forEach((c, i) => { f[x + i] = c; });
  f[x + 7] = 1;
  be32(frames).forEach((c, i) => { f[x + 8 + i] = c; });
  return f;
}

test("ID3v2.3: Latin-1, UTF-16, genre number, track of total, front cover", () => {
  const apic = [0, ...lat("image/jpeg"), 0, 3, ...lat("cover"), 0, ...JPEG];
  const head = u8([...id3v23([
    ["TIT2", txt1("Song")], ["TPE1", txt0("The Band")], ["TALB", txt0("Album")],
    ["TRCK", txt0("3/12")], ["TPOS", txt0("1/2")], ["TCON", txt0("(17)")], ["TYER", txt0("1999")], ["APIC", apic]
  ]), ...mp3Frame(1000)]);
  const r = C.readTags({ head, size: head.length + 100000, name: "x.mp3" });
  assert.equal(r.t, "Song"); assert.equal(r.a, "The Band"); assert.equal(r.al, "Album");
  assert.equal(r.n, 3); assert.equal(r.dn, 1); assert.equal(r.g, "Rock"); assert.equal(r.y, 1999);
  assert.equal(r.fmt, "mp3");
  assert.equal(r.pic.mime, "image/jpeg"); assert.equal(r.pic.data[0], 0xff);
  // Xing: 1000 frames × 1152 samples / 44100 Hz ≈ 26 s
  assert.equal(r.dur, 26);
});

test("ID3v2.4: UTF-8 Greek, album artist, recording date", () => {
  const head = u8(id3v24([["TIT2", txt3("Συννεφιασμένη Κυριακή")], ["TPE1", txt3("Βασίλης Τσιτσάνης")],
    ["TPE2", txt3("Διάφοροι")], ["TDRC", txt3("1948-05-01")]]));
  const r = C.readTags({ head, size: head.length, name: "a.mp3" });
  assert.equal(r.t, "Συννεφιασμένη Κυριακή"); assert.equal(r.a, "Βασίλης Τσιτσάνης");
  assert.equal(r.aa, "Διάφοροι"); assert.equal(r.y, 1948);
});

test("Greek tags written in Windows-1253 are read as Greek (auto), Latin-1 accents stay Latin", () => {
  const greek = Buffer.from([0xc3, 0xe9, 0xdc, 0xed, 0xed, 0xe7, 0xf2]);   // Γιάννης in cp1253
  assert.equal(C.decodeLegacy(u8(greek), "auto"), "Γιάννης");
  assert.equal(C.decodeLegacy(u8(lat("Café Señor")), "auto"), "Café Señor");
  assert.equal(C.decodeLegacy(u8(greek), "latin").length, 7);
  assert.notEqual(C.decodeLegacy(u8(greek), "latin"), "Γιάννης");
  // ID3v1 at the end of the file, in cp1253
  const tag = new Array(128).fill(0);
  lat("TAG").forEach((c, i) => { tag[i] = c; });
  [...greek].forEach((c, i) => { tag[3 + i] = c; });
  lat("Artist").forEach((c, i) => { tag[33 + i] = c; });
  tag[126] = 7; tag[127] = 13;
  const r = C.readTags({ head: u8(mp3Frame(10)), tail: u8(tag), size: 5000, name: "song.mp3" });
  assert.equal(r.t, "Γιάννης"); assert.equal(r.a, "Artist"); assert.equal(r.n, 7); assert.equal(r.g, "Pop");
});

function vorbisBlock(pairs) {
  const b = [...le32(4), ...lat("test"), ...le32(pairs.length)];
  pairs.forEach((p) => { const e = enc(p); b.push(...le32(e.length), ...e); });
  return b;
}
function flacPic(data) {
  const mime = lat("image/jpeg");
  return [...be32(3), ...be32(mime.length), ...mime, ...be32(0), ...be32(0), ...be32(0), ...be32(0), ...be32(0), ...be32(data.length), ...data];
}

test("FLAC: STREAMINFO length, Vorbis comments, PICTURE block", () => {
  const si = new Array(34).fill(0);
  // 44100 Hz (20 bits) at byte 10, total samples 44100 * 200
  const sr = 44100, total = 44100 * 200;
  si[10] = (sr >> 12) & 255; si[11] = (sr >> 4) & 255; si[12] = ((sr & 15) << 4) | 0x02;
  si[13] = 0x00; be32(total).forEach((c, i) => { si[14 + i] = c; });
  const vc = vorbisBlock(["TITLE=Ωδή", "ARTIST=Χορωδία", "ALBUM=Live", "TRACKNUMBER=5", "GENRE=Classical", "DATE=2001"]);
  const pic = flacPic(JPEG);
  const blk = (type, data, last) => [(last ? 0x80 : 0) | type, (data.length >> 16) & 255, (data.length >> 8) & 255, data.length & 255, ...data];
  const head = u8([...lat("fLaC"), ...blk(0, si), ...blk(4, vc), ...blk(6, pic, true)]);
  const r = C.readTags({ head, size: 1e7, name: "x.flac" });
  assert.equal(r.fmt, "flac"); assert.equal(r.t, "Ωδή"); assert.equal(r.a, "Χορωδία"); assert.equal(r.n, 5);
  assert.equal(r.g, "Classical"); assert.equal(r.y, 2001); assert.equal(r.dur, 200); assert.equal(r.pic.mime, "image/jpeg");
});

function oggPage(packetsData, granule) {
  const segs = [], data = [];
  packetsData.forEach((p) => {
    let n = p.length;
    while (n >= 255) { segs.push(255); n -= 255; }
    segs.push(n);
    data.push(...p);
  });
  const g = [...le32(granule), ...le32(0)];
  return [...lat("OggS"), 0, 0, ...g, ...le32(1), ...le32(0), ...le32(0), segs.length, ...segs, ...data];
}

test("Ogg: Vorbis comments and length from the last page, Opus with pre-skip", () => {
  const ident = [1, ...lat("vorbis"), ...le32(0), 2, ...le32(48000), ...new Array(14).fill(0)];
  const comm = [3, ...lat("vorbis"), ...vorbisBlock(["TITLE=" + "A".repeat(300), "ARTIST=Duo"]), 1];
  const head = u8([...oggPage([ident], 0), ...oggPage([comm], 0)]);
  const tail = u8(oggPage([[1, 2, 3]], 48000 * 61));
  const r = C.readTags({ head, tail, size: 1e6, name: "x.ogg" });
  assert.equal(r.fmt, "ogg"); assert.equal(r.a, "Duo"); assert.equal(r.t.length, 200); assert.equal(r.dur, 61);
  const opusHead = [...lat("OpusHead"), 1, 2, 0x38, 0x01, ...le32(48000), 0, 0, 0];
  const opusTags = [...lat("OpusTags"), ...vorbisBlock(["TITLE=Νύχτα"])];
  const h2 = u8([...oggPage([opusHead], 0), ...oggPage([opusTags], 0)]);
  const r2 = C.readTags({ head: h2, tail: u8(oggPage([[0]], 48000 * 10 + 312)), size: 1e5, name: "x.opus" });
  assert.equal(r2.t, "Νύχτα"); assert.equal(r2.dur, 10);
});

function box(type, body) { return [...be32(8 + body.length), ...lat(type), ...body]; }
function item(type, dtype, value) { return box(type, box("data", [...be32(dtype), ...be32(0), ...value])); }

test("MP4: mvhd length, ilst text, track number, cover; moov found with mp4Box", () => {
  const mvhd = box("mvhd", [0, 0, 0, 0, ...be32(0), ...be32(0), ...be32(1000), ...be32(185000), ...new Array(80).fill(0)]);
  const ilst = box("ilst", [
    ...item("©nam", 1, enc("Τραγούδι")), ...item("©ART", 1, enc("Τραγουδίστρια")), ...item("©alb", 1, enc("Δίσκος")),
    ...item("trkn", 0, [0, 0, 0, 9, 0, 12, 0, 0]), ...item("covr", 13, JPEG)
  ]);
  const meta = box("meta", [0, 0, 0, 0, ...box("hdlr", new Array(25).fill(0)), ...ilst]);
  const moov = box("moov", [...mvhd, ...box("udta", meta)]);
  const ftyp = box("ftyp", lat("M4A isomM4A "));
  const file = u8([...ftyp, ...box("mdat", new Array(64).fill(7)), ...moov]);
  // The head holds only ftyp + mdat: walk to moov with mp4Box.
  let o = 0, found = null;
  while (o < file.length) {
    const b = C.mp4Box(file.subarray(o, o + 16));
    if (!b) break;
    if (b.type === "moov") { found = file.subarray(o, o + b.size); break; }
    o += b.size;
  }
  assert.ok(found);
  const r = C.readTags({ head: file.subarray(0, 40), moov: found, size: file.length, name: "x.m4a" });
  assert.equal(r.fmt, "mp4"); assert.equal(r.t, "Τραγούδι"); assert.equal(r.a, "Τραγουδίστρια"); assert.equal(r.al, "Δίσκος");
  assert.equal(r.n, 9); assert.equal(r.dur, 185); assert.equal(r.pic.mime, "image/jpeg");
});

test("WAV: length from fmt + data, RIFF INFO title; files with no tags fall back to the name", () => {
  const fmt = [...lat("fmt "), ...le32(16), 1, 0, 2, 0, ...le32(44100), ...le32(176400), 4, 0, 16, 0];
  const info = [...lat("INFO"), ...lat("INAM"), ...le32(6), ...lat("Hello"), 0];
  const list = [...lat("LIST"), ...le32(info.length), ...info];
  const data = [...lat("data"), ...le32(176400 * 3)];
  const head = u8([...lat("RIFF"), ...le32(0), ...lat("WAVE"), ...fmt, ...list, ...data]);
  const r = C.readTags({ head, size: head.length + 176400 * 3, name: "rec.wav" });
  assert.equal(r.fmt, "wav"); assert.equal(r.t, "Hello"); assert.equal(r.dur, 3);
  const r2 = C.readTags({ head: u8([1, 2, 3]), size: 3, name: "Music/07 - Nick Cave - Into My Arms.ogg" });
  assert.equal(r2.t, "Into My Arms"); assert.equal(r2.a, "Nick Cave"); assert.equal(r2.n, 7);
});

test("a broken or hostile file never throws and never yields a non-image cover", () => {
  const evil = u8([...id3v23([["APIC", [0, ...lat("image/svg+xml"), 0, 3, 0, ...lat("<svg onload=alert(1)>")]]])]);
  const r = C.readTags({ head: evil, size: evil.length, name: "e.mp3" });
  assert.equal(r.pic, null);
  for (let i = 0; i < 50; i++) {
    const junk = u8(Array.from({ length: 200 }, (_, j) => (j * 37 + i * 11) & 255));
    junk.set(lat(["ID3", "fLaC", "OggS", "RIFF"][i % 4]), 0);
    assert.doesNotThrow(() => C.readTags({ head: junk, tail: junk, size: 200, name: "j" }));
  }
});

test("track keys: same song, same key on every device; untagged files by name", () => {
  const a = C.trackKey({ t: "Ταξίδι", a: "Ά Μουσικός", al: "Δίσκος" }, "/internal/Music/x.mp3");
  const b = C.trackKey({ t: "ταξιδι", a: "α μουσικος", al: "δισκος" }, "/internal/Music/other/y.flac");
  assert.equal(a, b);
  assert.match(a, /^l:[0-9a-z]+$/);
  assert.notEqual(C.trackKey({ t: "" }, "/a/1.mp3"), C.trackKey({ t: "" }, "/a/2.mp3"));
  assert.equal(C.fold("Σύννεφος ΣΚΙΆ"), "συννεφοσ σκια");
});

// ---------- data model ----------
const ref = (k, t) => ({ k: "l:" + k, t: t || k, a: "A" });

test("merge: likes LWW per song, playlists LWW with tombstones, idempotent and commutative", () => {
  let d = C.emptyData();
  d = C.setLike(d, ref("aaaaaa1"), true, 1000);
  const made = C.addPl(d, "Road", [ref("aaaaaa1"), ref("bbbbbb2")], 1100, 0.5);
  d = made.data;
  const other = C.setLike(C.renamePl(d, made.id, "Road trip", 2000), ref("aaaaaa1"), false, 2100);
  const mine = C.addToPl(d, made.id, [ref("cccccc3")], 1500);
  const m1 = C.mergeMusic(mine, other), m2 = C.mergeMusic(other, mine);
  assert.deepEqual(m1, m2);
  assert.deepEqual(C.mergeMusic(m1, m1), m1);
  assert.equal(C.findPl(m1, made.id).n, "Road trip");      // the newer playlist edit wins as a whole
  assert.equal(C.isLiked(m1, "l:aaaaaa1"), false);
  // Delete wins ties; a newer edit resurrects
  const del = C.deletePl(m1, made.id, 2000);
  assert.equal(C.findPl(C.mergeMusic(del, m1), made.id), null);
  const later = C.renamePl(m1, made.id, "Back", 3000);
  assert.equal(C.findPl(C.mergeMusic(del, later), made.id).n, "Back");
});

test("merge drops junk and keeps limits; liked list newest first", () => {
  const d = C.mergeMusic({ likes: [{ k: "bad", m: 1 }, { k: "l:abcdef1", m: 5, t: "x" }, { k: "l:abcdef2", m: 9, t: "y" }],
    pls: [{ id: "nope", m: 1 }, { id: "pabcdefghij", m: 3, n: "<b>x</b>", it: [{ k: "l:abcdef1", t: "a" }, { k: "?" }] }],
    tombs: { evil: 5 } }, null);
  assert.equal(d.likes.length, 2);
  assert.equal(d.pls.length, 1);
  assert.equal(d.pls[0].it.length, 1);
  assert.deepEqual(d.tombs, {});
  assert.deepEqual(C.likedList(d).map((l) => l.k), ["l:abcdef2", "l:abcdef1"]);
});

test("playlist edits: move, remove", () => {
  const made = C.addPl(C.emptyData(), "P", [ref("aaaaaa1"), ref("bbbbbb2"), ref("cccccc3")], 10, 0.1);
  let d = C.movePl(made.data, made.id, 0, 2, 20);
  assert.deepEqual(C.findPl(d, made.id).it.map((r) => r.k), ["l:bbbbbb2", "l:cccccc3", "l:aaaaaa1"]);
  d = C.removeFromPl(d, made.id, 1, 30);
  assert.deepEqual(C.findPl(d, made.id).it.map((r) => r.k), ["l:bbbbbb2", "l:aaaaaa1"]);
});

// ---------- queue ----------
function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
const list = ["a", "b", "c", "d", "e"].map((x) => ({ k: "l:" + x + "00000", t: x }));

test("queue: in order, next up first, repeat all wraps, end stops", () => {
  let q = C.qStart(null, list, 1, {}, rng(1));
  assert.equal(q.cur.t, "b");
  q = C.qAddNext(q, [{ k: "l:zz00000", t: "z" }]);
  let r = C.qNext(q, false); assert.equal(r.item.t, "z");
  r = C.qNext(r.q, false); assert.equal(r.item.t, "c");
  r = C.qPrev(r.q); assert.equal(r.item.t, "b");
  r = C.qNext(r.q); r = C.qNext(r.q); r = C.qNext(r.q); assert.equal(r.item.t, "e");
  assert.equal(C.qNext(r.q).item, null);
  r.q.rep = "all";
  assert.equal(C.qNext(r.q).item.t, "a");
});

test("queue: repeat one repeats unless Next is pressed; shuffle keeps the current song and plays all", () => {
  let q = C.qRepeat(C.qStart(null, list, 2, {}, rng(2)), "one");
  assert.equal(C.qNext(q, false).item.t, "c");
  assert.equal(C.qNext(q, true).item.t, "d");
  q = C.qShuffle(C.qStart(null, list, 2, {}, rng(3)), true, rng(4));
  assert.equal(q.cur.t, "c");
  const seen = [q.cur.t];
  let r = { q };
  for (let i = 0; i < 4; i++) { r = C.qNext(r.q); seen.push(r.item.t); }
  assert.deepEqual(seen.slice().sort(), ["a", "b", "c", "d", "e"]);
  // Shuffle off: list order again from the current song
  const off = C.qShuffle(r.q, false);
  assert.equal(off.ord.join(""), "01234");
  assert.equal(off.ctx[off.ord[off.at]].t, r.item.t);
});

test("queue: upcoming + jump + remove from next up", () => {
  let q = C.qAddLast(C.qStart(null, list, 0, {}, rng(5)), [{ k: "l:x100000", t: "x1" }, { k: "l:x200000", t: "x2" }]);
  const up = C.qUpcoming(q);
  assert.deepEqual(up.up.map((i) => i.t), ["x1", "x2"]);
  assert.deepEqual(up.next.map((i) => i.t), ["b", "c", "d", "e"]);
  const j = C.qJump(q, 1);
  assert.equal(j.item.t, "x2"); assert.equal(j.q.up.length, 0);
  const j2 = C.qJump(q, 3);              // 2 up-next rows, then the list: b, [c]
  assert.equal(j2.item.t, "c");
  assert.equal(C.qRemoveUp(q, 0).up[0].t, "x2");
});

// ---------- library ----------
const lib = [
  { p: "/internal/Music/A/1.mp3", k: "l:1", t: "One", a: "Άλφα", al: "Πρώτος", n: 2, g: "Rock; Pop", add: 3 },
  { p: "/internal/Music/A/2.mp3", k: "l:2", t: "Two", a: "Άλφα", al: "Πρώτος", n: 1, g: "Rock", add: 2 },
  { p: "/internal/Music/B/3.mp3", k: "l:3", t: "Three", a: "Guest", aa: "Βήτα", al: "Second", n: 1, add: 1 },
  { p: "/internal/Music/x.mp3", k: "l:4", t: "Loose", a: "", al: "", add: 9 }
];

test("library: albums sorted by track number, artists include guests, genres split, folders", () => {
  const al = C.albums(lib, "el");
  assert.equal(al.length, 2);
  const first = al.filter((a) => a.n === "Πρώτος")[0];
  assert.deepEqual(first.list.map((r) => r.t), ["Two", "One"]);
  const ar = C.artists(lib, "el").map((a) => a.n);
  assert.ok(ar.includes("Guest") && ar.includes("Βήτα") && ar.includes("Άλφα"));
  assert.deepEqual(C.genres(lib, "en").map((g) => g.n + g.list.length), ["Pop1", "Rock2"]);
  const fv = C.folderView(lib, "/internal/Music");
  assert.deepEqual(fv.dirs.map((d) => d.n + d.c), ["A2", "B1"]);
  assert.deepEqual(fv.files.map((r) => r.t), ["Loose"]);
  assert.deepEqual(C.sortTracks(lib, "added").map((r) => r.k), ["l:4", "l:1", "l:2", "l:3"]);
});

test("search is accent- and case-free; refs resolve by key, else title + artist", () => {
  const r = C.search(lib, "αλφα one", "el");
  assert.deepEqual(r.songs.map((s) => s.t), ["One"]);
  assert.equal(C.search(lib, "ΠΡΩΤΟΣ", "el").albums.length, 1);
  const res = C.resolver(lib);
  assert.equal(res({ k: "l:2" }).t, "Two");
  assert.equal(res({ k: "l:zzz", t: "three", a: "guest" }).k, "l:3");
  assert.equal(res({ k: "l:zzz", t: "nope", a: "x" }), null);
});

test("history counts plays and keeps 50 recent, newest first", () => {
  let h = null;
  for (let i = 0; i < 60; i++) h = C.addPlay(h, { k: "l:" + (i % 55), t: "t" + i }, i);
  assert.equal(h.r.length, 50);
  assert.equal(h.r[0].t, "t59");
  assert.equal(h.c["l:0"], 2);
  assert.equal(C.fmtTime(3725), "1:02:05");
  assert.equal(C.fmtTime(65), "1:05");
});
