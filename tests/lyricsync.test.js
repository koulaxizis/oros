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
