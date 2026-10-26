// Lyric Sync: the data model's sync rules (OROS_BIBLE.md Part I,
// R5/R17/R26), the sync steps, and the file formats.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../lyricsync/core.js");
const F = require("../lyricsync/formats.js");
const S = require("../lyricsync/search.js");

let n = 0;
const rand = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
const song = (id, mtime, extra) => Object.assign({ id, name: "Song " + id, ln: [{ id: "l1", t: "Hello", s: 1000, e: null }], mtime }, extra || {});
const D = (...items) => ({ ver: 1, items, tombs: {} });

test("merge is symmetric and settles at once", () => {
  const A = D(song("a", 100), song("b", 110));
  const B = D(song("a", 200, { name: "Renamed" }), song("c", 120));
  const ab = C.serialize(C.merge(A, B)), ba = C.serialize(C.merge(B, A));
  assert.equal(ab, ba);
  assert.equal(C.serialize(C.merge(JSON.parse(ab), B)), ab);
  assert.equal(C.find(JSON.parse(ab), "a").name, "Renamed");
  // a tie on mtime is settled by the JSON, not by the side
  const X = D(song("t", 300, { name: "x" })), Y = D(song("t", 300, { name: "y" }));
  assert.equal(C.serialize(C.merge(X, Y)), C.serialize(C.merge(Y, X)));
});

test("a delete wins over an older edit, a newer edit brings the song back", () => {
  const A = D(song("a", 100), song("b", 110));
  const del = C.remove(A, "a", 300);
  assert.deepEqual(C.merge(A, del).items.map((x) => x.id), ["b"]);
  const edited = C.put(A, song("a", 100, { name: "Back" }), 400);
  assert.deepEqual(C.merge(del, edited).items.map((x) => x.id), ["a", "b"]);
});

test("broken input is dropped, never repaired", () => {
  const d = C.normalize({ items: [{ name: "no id" }, null, { id: "x", ln: [{ t: "no id" }, { id: "k", t: 5, s: -3, e: 9 }], mtime: "y" }], tombs: { z: "bad" } });
  assert.equal(d.items.length, 1);
  assert.deepEqual(d.items[0].ln, [{ id: "k", t: "", s: null, e: null }]);
  assert.deepEqual(d.tombs, {});
  // an end before its start is dropped
  assert.equal(C.normalize(D(song("q", 5, { ln: [{ id: "l", t: "a", s: 500, e: 400 }] }))).items[0].ln[0].e, null);
});

test("lyrics text: blank lines start verses, and unchanged lines keep their times", () => {
  const lines = C.relyric([], "One\nTwo\n\n\nThree", rand);
  assert.deepEqual(lines.map((l) => [l.t, l.p || 0]), [["One", 0], ["Two", 0], ["Three", 1]]);
  let timed = C.startAt(C.startAt(C.startAt(lines, 0, 1000), 1, 2000), 2, 3000);
  const again = C.relyric(timed, "One\nTwo fixed\n\nThree\nFour", rand);
  assert.deepEqual(again.map((l) => [l.t, l.s]), [["One", 1000], ["Two fixed", null], ["Three", 3000], ["Four", null]]);
  assert.equal(again[0].id, timed[0].id);
  assert.equal(C.toText(again), "One\nTwo fixed\n\nThree\nFour");
});

test("tap, hold, end, nudge and the derived ends", () => {
  let L = C.relyric([], "a\nb\nc", rand);
  L = C.startAt(L, 0, 1000);
  L = C.startAt(L, 1, 2500); L = C.endAt(L, 1, 4000);        // hold
  L = C.startAt(L, 2, 6000);
  const T = C.timed(L, 9000);
  assert.deepEqual(T.map((x) => [x.s, x.e, x.ex]), [[1000, 2500, 0], [2500, 4000, 1], [6000, 9000, 0]]);
  assert.equal(C.lineAt(T, 3000), 1);
  assert.equal(C.lineAt(T, 5000), -1);                        // the pause
  // re-tapping an earlier line pulls a later explicit end in
  L = C.startAt(L, 1, 2000);
  assert.equal(L[1].e, null);
  L = C.endAt(C.startAt(L, 0, 1000), 0, 3000);
  L = C.startAt(L, 1, 2000);
  assert.equal(L[0].e, 2000);
  // nudge keeps the length, never goes below zero
  L = C.endAt(L, 1, 2600);
  L = C.nudge(L, 1, -100);
  assert.deepEqual([L[1].s, L[1].e], [1900, 2500]);
  assert.equal(C.nudge(L, 0, -5000)[0].s, 0);
  assert.equal(C.nextUntimed(C.clearTime(L, 1), 0), 1);
  assert.equal(C.timedCount(C.clearAll(L)), 0);
});

test("times as text", () => {
  assert.equal(C.fmt(62345, "lrc"), "01:02.34");
  assert.equal(C.fmt(3723456, "srt"), "01:02:03,456");
  assert.equal(C.fmt(62345, "vtt"), "00:01:02.345");
  assert.equal(C.fmt(62345, "clock"), "1:02.34");
  assert.equal(C.parseTime("1:02.5"), 62500);
  assert.equal(C.parseTime("62,25"), 62250);
  assert.equal(C.parseTime("1:02:03.250"), 3723250);
  assert.equal(C.parseTime("123:00"), 7380000);
  assert.equal(C.parseTime("abc"), null);
});

function sample() {
  let L = C.relyric([], "Hello & <world>\nSecond line\n\nVerse two", rand);
  L = C.startAt(L, 0, 1000); L = C.startAt(L, 1, 3500); L = C.endAt(L, 1, 5000); L = C.startAt(L, 2, 9000);
  return C.cleanProject({ id: "p", name: "Song", ar: "Me & You", al: "LP", lg: "en", dur: 60000, ln: L, mtime: 1 });
}

test("every export reads back with the same lines and times", () => {
  const p = sample();
  for (const k of ["lrc", "srt", "vtt", "ttml", "json"]) {
    const r = F.parse("x" + F.EXPORTS[k].ext, F.EXPORTS[k].fn(p));
    assert.deepEqual(r.lines.map((l) => [l.t, l.s]), [["Hello & <world>", 1000], ["Second line", 3500], ["Verse two", 9000]], k);
  }
  const lrc = F.toLrc(p);
  assert.match(lrc, /^\[ti:Song\]\n\[ar:Me & You\]\n\[al:LP\]\n\[length:01:00\]/);
  assert.match(lrc, /\[00:03\.50\]Second line\n\[00:05\.00\]\n\[00:09\.00\]Verse two/);   // the pause clears
  assert.equal(F.parse("x.lrc", lrc).lines[2].p, 1);
  const ttml = F.toTtml(p);
  assert.match(ttml, /Hello &amp; &lt;world&gt;/);
  assert.equal((ttml.match(/<div /g) || []).length, 2);
  assert.match(F.toVtt(p), /^WEBVTT\n/);
  assert.match(F.toSrt(p), /^1\n00:00:01,000 --> 00:00:03,500\nHello & <world>\n/);
  const back = F.parse("x.json", F.toJson(p));
  assert.deepEqual(back.lines.map((l) => [l.s, l.e, l.p]), [[1000, null, 0], [3500, 5000, 0], [9000, null, 1]]);
  assert.equal(F.toText(p), "Hello & <world>\nSecond line\n\nVerse two\n");
});

test("imports: LRC tags, offset, repeats and word stamps; TTML clock and offset times", () => {
  const r = F.parse("a.lrc", "[ti:T]\n[offset:500]\n[00:10.00][00:20.00]Chorus\n[00:12.00]<00:12.00>Word <00:12.50>by word\n[00:14.00]\n");
  assert.equal(r.name, "T");
  assert.deepEqual(r.lines.map((l) => [l.t, l.s, l.e]), [["Chorus", 9500, null], ["Word by word", 11500, 13500], ["Chorus", 19500, null]]);
  const tt = '<tt xml:lang="el"><body><div><p begin="1.5s" end="2500ms">A<br/>b</p></div><div><p begin="0:03.25" end="00:00:04.000"><span>x</span> <span>y</span></p></div></body></tt>';
  const q = F.parse("a.ttml", tt);
  assert.equal(q.lg, "el");
  assert.deepEqual(q.lines.map((l) => [l.t, l.s, l.e, l.p]), [["A b", 1500, 2500, 0], ["x y", 3250, 4000, 1]]);
  assert.equal(F.ttmlTime("00:00:01:15"), 1500);
  assert.equal(F.kindOf("", "WEBVTT\n\n"), "vtt");
  assert.equal(F.kindOf("", "1\n00:00:01,000 --> 00:00:02,000\nx"), "srt");
  assert.equal(F.kindOf("", "[00:01.00]x"), "lrc");
  assert.equal(F.parse("plain.txt", "a\n\nb").lines[1].p, 1);
  assert.throws(() => F.parse("x.lrc", "[ti:only tags]"));
  assert.throws(() => F.parse("x.json", '{"format":"other"}'));
});

test("search finds songs by words and skips deleted ones", () => {
  const d = D(song("a", 100, { ar: "Band" }), song("b", 100));
  d.tombs = { b: 100 };
  const hits = S.search({ readJSON: () => d });
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0].target, { song: "a" });
  assert.match(hits[0].text, /Band · Hello/);
});

// ---------- wave 2: words, singers, checks, karaoke formats ----------
function wordSample() {
  let L = C.relyric([], "Hello big world\nSecond line", rand);
  L = C.wordAt(L, 0, 0, 1000); L = C.wordAt(L, 0, 1, 1400); L = C.wordAt(L, 0, 2, 1900);
  L = C.startAt(L, 1, 3000); L = C.endAt(L, 1, 4500);
  L[1].v = 2;
  return C.cleanProject({ id: "w", name: "S", ar: "A", vn: ["Anna", "Bob"], dur: 9000, ln: L, mtime: 1 });
}

test("words: timing, moving with the line, bad word times dropped", () => {
  const p = wordSample();
  assert.deepEqual(p.ln[0].w, [1000, 1400, 1900]);
  assert.equal(p.ln[0].s, 1000);
  assert.ok(C.wordsDone(p.ln[0]));
  // re-timing word 1 earlier clears nothing before it, later words after it stay
  let L = C.wordAt(p.ln, 0, 1, 1200);
  assert.deepEqual(L[0].w, [1000, 1200, 1900]);
  // a word before an earlier word's time drops that later time
  L = C.wordAt(p.ln, 0, 0, 1500);
  assert.deepEqual([L[0].s, L[0].w], [1500, [1500, 1900, 2400]]);   // a re-tap moves the words with the line
  // nudge and setStart carry the words
  assert.deepEqual(C.nudge(p.ln, 0, 100)[0].w, [1100, 1500, 2000]);
  assert.deepEqual(C.setStart(p.ln, 0, 500)[0].w, [500, 900, 1400]);
  assert.deepEqual(C.shiftAll(p.ln, -200)[0].w, [800, 1200, 1700]);
  // a line end before a word drops the words; clearTime drops them
  assert.equal(C.endAt(p.ln, 0, 1500)[0].w, undefined);
  assert.equal(C.clearTime(p.ln, 0)[0].w, undefined);
  // drag on the waveform stays between neighbours
  assert.deepEqual(C.moveMark(p.ln, 0, 1, 5000)[0].w, [1000, 1900, 1900]);
  assert.deepEqual(C.moveMark(p.ln, 0, -1, 1200)[0].w.slice(0, 1), [1200]);
  assert.equal(C.moveMark(p.ln, 1, -1, 100)[1].s, 1001);
  // the merge keeps words; text edits keep them on unchanged lines
  assert.deepEqual(C.normalize({ items: [p] }).items[0].ln[0].w, [1000, 1400, 1900]);
  assert.equal(C.relyric(p.ln, "Hello big world\nOther", rand)[0].w.length, 3);
  assert.equal(C.cleanProject({ id: "x", ln: [{ id: "a", t: "a b", s: 5, e: null, w: [5] }], mtime: 1 }).ln[0].w, undefined);
  const T = C.timed(p.ln, 9000);
  assert.deepEqual(T[0].words.map((w) => [w.t, w.s, w.e]), [["Hello", 1000, 1400], ["big", 1400, 1900], ["world", 1900, 3000]]);
  assert.equal(T[1].v, 2);
});

test("quality check codes", () => {
  let L = C.relyric([], "a\n[Chorus]\nla la (x2)\n" + "x".repeat(90) + "\nlast one", rand);
  L = C.startAt(L, 0, 5000); L = C.startAt(L, 1, 5100); L = C.startAt(L, 2, 1000); L = C.startAt(L, 4, 30000);
  L = C.wordAt(L, 4, 0, 30000);
  const codes = C.issues(L, 60000).map((x) => x.i + ":" + x.code);
  for (const c of ["0:short", "1:label", "2:order", "2:label", "3:untimed", "3:long", "4:words"]) assert.ok(codes.includes(c), c + " in " + codes);
  assert.ok(codes.includes("1:gap"));                                   // 5.1 s → 30 s without an end
});

test("karaoke exports read back with their words and singers", () => {
  const p = wordSample();
  const elrc = F.toElrc(p);
  assert.match(elrc, /\[00:01\.00\]<00:01\.00>Hello <00:01\.40>big <00:01\.90>world <00:03\.00>/);
  assert.doesNotMatch(F.toLrc(p), /</);
  const vtt = F.toVtt(p);
  assert.match(vtt, /Hello <00:00:01\.400>big <00:00:01\.900>world/);
  const ttml = F.toTtml(p);
  assert.match(ttml, /itunes:timing="Word"/);
  assert.match(ttml, /<span begin="00:00:01\.400" end="00:00:01\.900">big<\/span>/);
  assert.match(ttml, /xml:id="v2"><ttm:name type="full">Bob/);
  assert.match(ttml, /ttm:agent="v2">Second line/);
  const ass = F.toAss(p);
  assert.match(ass, /Dialogue: 0,0:00:01\.00,0:00:03\.00,Default,Anna,0,0,0,,\{\\kf40\}Hello \{\\kf50\}big \{\\kf110\}world/);
  for (const [name, text] of [["a.lrc", elrc], ["a.vtt", vtt], ["a.ttml", ttml], ["a.ass", ass], ["a.json", F.toJson(p)]]) {
    const r = F.parse(name, text);
    assert.deepEqual(r.lines[0].w, [1000, 1400, 1900], name);
    assert.equal(r.lines[1].w, undefined, name);
  }
  const tr = F.parse("a.ttml", ttml);
  assert.deepEqual(tr.vn, ["Anna", "Bob"]);
  assert.equal(tr.lines[1].v, 2);
  assert.equal(F.parse("a.json", F.toJson(p)).lines[1].v, 2);
  assert.equal(F.kindOf("x", "[Script Info]\nTitle: t\n[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,hi"), "ass");
  // ASS braces in the text never become tags
  const q = C.cleanProject({ id: "b", ln: [{ id: "l", t: "a {b} c", s: 0, e: 1000 }], mtime: 1 });
  assert.match(F.toAss(q), /,,\{\\kf100\}a \(b\) c$/m);
});

// ---------- Wave 3: the orOS disk, the MP3 tag ----------
const ID3 = require("../lyricsync/id3.js");
const MC = require("../music/core.js").OrosMusicCore;

test("a song's disk path is kept only when clean, and finds its song", () => {
  assert.equal(C.diskPath("/internal/Music/Α/b.mp3"), "/internal/Music/Α/b.mp3");
  ["/internal/Music/../x.mp3", "/internal//x", "/internal/Music/", "x/internal/a", "/internal/a\\b", "/internal/a\u0001", 5, null]
    .forEach((v) => assert.equal(C.diskPath(v), "", String(v)));
  assert.equal(C.diskPath("/internal/" + "a".repeat(1100)), "");
  assert.equal(C.lrcPath("/internal/Music/Al/Song.name.mp3"), "/internal/Music/Al/Song.name.lrc");
  assert.equal(C.lrcPath("/internal/Music/noext"), "/internal/Music/noext.lrc");
  assert.equal(C.lrcPath("/etc/x.mp3"), "");
  const p = C.cleanProject({ id: "s1", src: "/internal/Music/a.mp3", ln: [] });
  assert.equal(p.src, "/internal/Music/a.mp3");
  assert.equal(C.cleanProject({ id: "s2", src: "/internal/../a.mp3", ln: [] }).src, undefined);
  let d = C.put(C.empty(), p, 10);
  d = C.put(d, { id: "s3", ln: [] }, 20);
  assert.equal(C.bySrc(d, "/internal/Music/a.mp3").id, "s1");
  assert.equal(C.bySrc(d, "/internal/Music/b.mp3"), null);
  // the path syncs: it survives merge and the canonical form
  assert.equal(C.merge(d, C.empty()).items.filter((x) => x.id === "s1")[0].src, "/internal/Music/a.mp3");
  assert.equal(C.serialize(C.merge(d, d)), C.serialize(d));
});

function mp3(tagFrames, major) {
  // a tiny MPEG frame header after an optional ID3 tag
  const audio = [0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4, 5, 6, 7, 8];
  if (!tagFrames) return new Uint8Array(audio);
  const body = [];
  tagFrames.forEach(([id, bytes]) => {
    const n = bytes.length;
    const size = major === 4 ? [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127] : [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
    body.push(...id.split("").map((c) => c.charCodeAt(0)), ...size, 0, 0, ...bytes);
  });
  body.push(0, 0, 0, 0);                                  // padding
  const n = body.length;
  return new Uint8Array([0x49, 0x44, 0x33, major, 0, 0, (n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127, ...body, ...audio]);
}
function rebuilt(file, lyrics) {
  const end = ID3.tagEnd(file.subarray(0, 10));
  const r = ID3.build(file.subarray(0, Math.max(10, end)), lyrics);
  if (!r) return null;
  const out = new Uint8Array(r.tag.length + file.length - r.cut);
  out.set(r.tag, 0);
  out.set(file.subarray(r.cut), r.tag.length);
  return out;
}

test("the MP3 copy carries the lyrics, keeps the other tags and the audio", () => {
  const lyrics = { text: "Γεια σου\nHello", lg: "el", lines: [{ s: 1000, t: "Γεια σου" }, { s: 2500, t: "Hello" }] };
  for (const major of [3, 4]) {
    const title = major === 4 ? [3, ...Buffer.from("Τίτλος", "utf8")] : [0, ...Buffer.from("Title")];
    const oldLy = [0, ...Buffer.from("eng"), 0, ...Buffer.from("old words")];
    const file = mp3([["TIT2", title], ["USLT", oldLy]], major);
    const out = rebuilt(file, lyrics);
    assert.ok(out, "v2." + major);
    assert.equal(out[3], major);
    const tags = MC.readTags({ head: out, size: out.length, name: "a.mp3" });
    assert.equal(tags.t, major === 4 ? "Τίτλος" : "Title");
    assert.equal(tags.ly, "Γεια σου\nHello");                // the old USLT is replaced, not kept
    const txt = Buffer.from(out).toString("latin1");
    assert.equal(txt.split("USLT").length - 1, 1);
    assert.equal(txt.split("SYLT").length - 1, 1);
    // the audio is untouched
    assert.deepEqual([...out.subarray(out.length - 12)], [0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4, 5, 6, 7, 8]);
    // made again from the copy: same result
    assert.deepEqual(rebuilt(out, lyrics), out);
  }
  // a file with no tag gets a v2.3 one
  const bare = mp3(null);
  assert.ok(ID3.isMp3(bare.subarray(0, 4), "x.bin", ""));
  const out = rebuilt(bare, lyrics);
  assert.equal(out[3], 3);
  assert.equal(MC.readTags({ head: out, size: out.length, name: "a.mp3" }).ly, "Γεια σου\nHello");
  assert.deepEqual([...out.subarray(out.length - 12)], [...bare]);
});

test("tags that cannot be rewritten safely make nothing", () => {
  const lyrics = { text: "a", lines: [] };
  const v22 = mp3([["TIT2", [0, 65]]], 3); v22[3] = 2;
  assert.equal(ID3.build(v22, lyrics), null);
  const unsync = mp3([["TIT2", [0, 65]]], 3); unsync[5] = 0x80;
  assert.equal(ID3.build(unsync, lyrics), null);
  const ext = mp3([["TIT2", [0, 65]]], 4); ext[5] = 0x40;
  assert.equal(ID3.build(ext, lyrics), null);
  const broken = mp3([["TIT2", [0, 65]]], 3); broken[14] = 0x7f;   // frame size past the tag
  assert.equal(ID3.build(broken, lyrics), null);
  assert.equal(ID3.isMp3(new Uint8Array([0x52, 0x49, 0x46, 0x46]), "a.wav", "audio/wav"), false);
  assert.equal(ID3.lang3("el-GR"), "ell");
  assert.equal(ID3.lang3(""), "und");
});

// ---------- Wave 4: rough sync from what Whisper heard ----------
const AL = require("../lyricsync/align.js");

test("rough sync lines the lyrics up with the heard words", () => {
  const lines = [{ t: "Hello big world" }, { t: "Second line here" }, { t: "" }, { t: "[Chorus]" }, { t: "Middle bit" }, { t: "And it ends now" }];
  const cues = [
    { start: 1, end: 3, text: " Hello, big world!" },
    { start: 4, end: 6, text: "second lie here" },       // a word heard wrong still matches by its neighbours
    { start: 9, end: 11, text: "and it end now yeah" }  // an extra word, a near miss
  ];
  const r = AL.align(lines, cues);
  assert.equal(r.starts[0], 1000);
  assert.equal(r.starts[1], 4000);
  assert.equal(r.starts[2], null);                       // blank line
  assert.equal(r.starts[3], null);                       // labels are never timed
  assert.ok(r.starts[4] > 4000 && r.starts[4] < 9000);   // between its neighbours by word count
  assert.equal(r.starts[5], 9000);
  assert.ok(r.matched >= 9 && r.words === 12);
  // Greek: accents, capitals and final sigma do not count
  const g = AL.align([{ t: "Καλημέρα κόσμε" }, { t: "Τι κάνεις σήμερα" }], [{ start: 2, end: 3, text: "ΚΑΛΗΜΕΡΑ ΚΟΣΜΕ" }, { start: 5, end: 7, text: "τι κανεισ σημερα" }]);
  assert.deepEqual(g.starts, [2000, 5000]);
});

test("rough sync never goes back in time and copes with nothing heard", () => {
  // the second line is heard first (a repeat): its time would go back, so it is dropped
  const lines = [{ t: "one two three" }, { t: "four five six" }, { t: "seven eight nine" }];
  const cues = [{ start: 1, end: 2, text: "one two three" }, { start: 0.2, end: 0.5, text: "four five six" }, { start: 6, end: 7, text: "seven eight nine" }];
  const r = AL.align(lines, cues);
  for (let i = 1; i < r.starts.length; i++) if (r.starts[i] !== null && r.starts[i - 1] !== null) assert.ok(r.starts[i] >= r.starts[i - 1]);
  assert.deepEqual(AL.align(lines, []).starts, [null, null, null]);
  assert.deepEqual(AL.align([], cues).starts, []);
  // a later word matched first moves the start back by the words before it
  const m = AL.align([{ t: "xyzzy plugh hello" }], [{ start: 10, end: 11, text: "hello" }]);
  assert.equal(m.starts[0], 10000 - 2 * 280);
  // heard words get times inside their cue by letter count
  const h = AL.heard([{ start: 0, end: 1, text: "ab abcdef" }]);
  assert.deepEqual(h.map((x) => x.ms), [0, 250]);
  assert.ok(AL.similar("gonna", "going") >= 0.6);
  assert.ok(AL.similar("love", "hate") < 0.6);
});

test("16 kHz mono samples from any sample rate", () => {
  const sr = 48000, n = 4800;
  const ch = [new Float32Array(n).fill(0.5), new Float32Array(n).fill(-0.5)];
  const buf = { sampleRate: sr, numberOfChannels: 2, length: n, getChannelData: (c) => ch[c] };
  const out = AL.to16k(buf);
  assert.equal(out.length, 1600);
  assert.ok(out.every((x) => Math.abs(x) < 1e-6));
  const one = { sampleRate: 16000, numberOfChannels: 1, length: 16000, getChannelData: () => new Float32Array(16000).fill(0.25) };
  assert.equal(AL.to16k(one, 0.5).length, 8000);
});
