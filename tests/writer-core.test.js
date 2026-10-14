// Pure logic of Writer (writer/core.js): statistics, sentence bounds
// (Focus mode), PDF line breaking / alignment / table columns / image
// size, dictation joining and typewriter scrolling.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "writer/core.js"));

test("countWords: punctuation alone is not a word; Greek counts", () => {
  assert.equal(C.countWords("one - two"), 2);
  assert.equal(C.countWords("Καλημέρα κόσμε, τι κάνεις;"), 4);
  assert.equal(C.countWords("   "), 0);
  assert.equal(C.countWords("3.14 is pi"), 3);
});

test("textStats: words, characters, paragraphs, sentences, times", () => {
  const s = C.textStats("Hello world. How are you?\n\nFine thanks", "en");
  assert.equal(s.words, 7);
  assert.equal(s.chars, "Hello world. How are you?".length + "Fine thanks".length);
  assert.equal(s.charsNoSpaces, "Helloworld.Howareyou?".length + "Finethanks".length);
  assert.equal(s.paragraphs, 2);
  assert.equal(s.sentences, 3);
  assert.equal(s.readMin, 7 / C.READ_WPM);
  assert.equal(s.speakMin, 7 / C.SPEAK_WPM);
  const e = C.textStats("", "en");
  assert.deepEqual([e.words, e.chars, e.paragraphs, e.sentences], [0, 0, 0, 0]);
  // non-breaking spaces are spaces; emoji count as one character
  assert.equal(C.textStats("a b 😀", "en").charsNoSpaces, 3);
});

test("sentences: Greek question mark only in Greek; decimals stay whole", () => {
  assert.equal(C.countSentences("Τι κάνεις; Καλά.", "el"), 2);
  assert.equal(C.countSentences("First; second.", "en"), 1);
  assert.equal(C.countSentences("Pi is 3.14 today. Yes!", "en"), 2);
  assert.equal(C.countSentences("He said \"Stop.\" Then left.", "en"), 2);
  assert.equal(C.countSentences("Wait… what?! Ok", "en"), 3);
  assert.equal(C.countSentences("line one\nline two", "en"), 2);
  assert.equal(C.countSentences("— . —", "en"), 0);
});

test("sentenceAt: the sentence around the caret", () => {
  const t = "One two. Three four! Five";
  assert.deepEqual(C.sentenceAt(t, 0, "en"), { s: 0, e: 8 });
  assert.deepEqual(C.sentenceAt(t, 8, "en"), { s: 0, e: 8 });      // right after the stop
  assert.deepEqual(C.sentenceAt(t, 9, "en"), { s: 9, e: 20 });     // in the next one
  assert.deepEqual(C.sentenceAt(t, t.length, "en"), { s: 21, e: 25 });
  assert.equal(C.sentenceAt("   ", 1, "en"), null);
  assert.deepEqual(C.sentenceRanges("  Hi.  ", "en"), [{ s: 2, e: 5 }]);
});

test("roundMinutes", () => {
  assert.deepEqual(C.roundMinutes(0), { lt1: true, n: 0 });
  assert.deepEqual(C.roundMinutes(0.4), { lt1: true, n: 0 });
  assert.deepEqual(C.roundMinutes(0.6), { lt1: false, n: 1 });
  assert.deepEqual(C.roundMinutes(12.5), { lt1: false, n: 13 });
});

const tk = (w, sp, br) => ({ w, sp: !!sp, br: !!br });

test("breakLines: wraps at maxW, keeps glued tokens together", () => {
  // "aaa bbb ccc" with width 3 each, space 1, maxW 7 → "aaa bbb" / "ccc"
  let L = C.breakLines([tk(3), tk(3, 1), tk(3, 1)], 7, 1);
  assert.deepEqual(L.map(l => [l.from, l.to, l.w, l.gaps, l.hard]), [[0, 2, 7, 1, false], [2, 3, 3, 0, true]]);
  // "aaa bb" + "," glued: the cluster bb, moves as one
  L = C.breakLines([tk(3), tk(2, 1), tk(1)], 6, 1);
  assert.deepEqual(L.map(l => [l.from, l.to]), [[0, 1], [1, 3]]);
  // forced break; a trailing break adds no empty line
  L = C.breakLines([tk(2), tk(0, 0, 1), tk(2), tk(0, 0, 1)], 50, 1);
  assert.deepEqual(L.map(l => [l.from, l.to, l.hard]), [[0, 1, true], [2, 3, true]]);
  // empty input → one empty line; an overlong word stays on its own line
  assert.equal(C.breakLines([], 10, 1).length, 1);
  L = C.breakLines([tk(2), tk(20, 1), tk(2, 1)], 10, 1);
  assert.deepEqual(L.map(l => [l.from, l.to]), [[0, 1], [1, 2], [2, 3]]);
});

test("alignLine: left, center, right, justify (not the last line)", () => {
  const line = { w: 6, gaps: 2, hard: false };
  assert.deepEqual(C.alignLine(line, 10, "left"), { x: 0, extra: 0 });
  assert.deepEqual(C.alignLine(line, 10, "center"), { x: 2, extra: 0 });
  assert.deepEqual(C.alignLine(line, 10, "right"), { x: 4, extra: 0 });
  assert.deepEqual(C.alignLine(line, 10, "justify"), { x: 0, extra: 2 });
  assert.deepEqual(C.alignLine(Object.assign({}, line, { hard: true }), 10, "justify"), { x: 0, extra: 0 });
});

test("colWidths: sums to the total, short columns narrower, minimum kept", () => {
  const w = C.colWidths([5, 40, 5], 150, 15);
  assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 150) < 1e-9);
  assert.ok(w[1] > w[0] && w[0] === w[2]);
  const m = C.colWidths([0, 60, 60, 60], 100, 20);
  assert.ok(m.every(x => x >= 20 - 1e-9));
  assert.ok(Math.abs(m.reduce((a, b) => a + b, 0) - 100) < 1e-9);
  assert.deepEqual(C.colWidths([], 100, 10), []);
});

test("fitBox: 96 dpi, never enlarged, fits both ways", () => {
  const b = C.fitBox(96, 48, 100, 100);
  assert.ok(Math.abs(b.w - 25.4) < 1e-9 && Math.abs(b.h - 12.7) < 1e-9);
  const big = C.fitBox(4000, 2000, 170, 250);
  assert.ok(Math.abs(big.w - 170) < 1e-9 && Math.abs(big.h - 85) < 1e-9);
  const tall = C.fitBox(500, 5000, 170, 100);
  assert.ok(Math.abs(tall.h - 100) < 1e-9);
});

test("joinDictation: spaces and capitals", () => {
  assert.equal(C.joinDictation("", "hello world", "en"), "Hello world");
  assert.equal(C.joinDictation("Hi.", "next one", "en"), " Next one");
  assert.equal(C.joinDictation("Hi. ", "next", "en"), "Next");
  assert.equal(C.joinDictation("I said", "hello", "en"), " hello");
  assert.equal(C.joinDictation("word", ", then", "en"), ", then");
  assert.equal(C.joinDictation("(", "aside", "en"), "aside");
  assert.equal(C.joinDictation("Τι κάνεις;", "όλα καλά", "el"), " Όλα καλά");
  assert.equal(C.joinDictation("line\n", "new", "en"), "New");
  assert.equal(C.joinDictation("x", "   ", "en"), "");
});

test("centerDelta", () => {
  assert.equal(C.centerDelta(300, 0, 600), 0);
  assert.equal(C.centerDelta(302, 0, 600), 0);
  assert.equal(C.centerDelta(500, 100, 600), 100);
  assert.equal(C.centerDelta(100, 0, 600), -200);
});
