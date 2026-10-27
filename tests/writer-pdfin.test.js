// Writer's PDF import (writer/pdfin.js → WriterPdfIn). Node: the pure
// part (pieces → lines → paragraphs → HTML) on made-up pages. The real
// PDF.js run is in tests/convert-writer.test.js (Chromium).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const P = require(path.join(ROOT, "writer/pdfin.js"));

// A4 page, text column 72 … 523 pt; a letter is 0.5 × size wide
const L = 72, R = 523;
function piece(y, x, s, o) {
  o = o || {};
  const size = o.size || 11;
  return { s: s, x: x, y: y, w: o.w != null ? o.w : s.length * size * 0.5, size: size, b: !!o.b, i: !!o.i, rot: 0 };
}
const wide = (n) => (n * 11 * 0.5);
// a line that fills the column (justified)
function full(y, s, o) { return Object.assign(piece(y, L, s, o), { w: R - L }); }
function centred(y, s, o) {
  const size = (o && o.size) || 11, w = s.length * size * 0.5;
  return piece(y, (L + R) / 2 - w / 2, s, o);
}
const page = (pieces) => ({ w: 595, h: 842, pieces: pieces });

test("headings, alignment, bold and italic, paragraphs", () => {
  const r = P.fromPages([page([
    centred(80, "CONTRACT", { size: 18, b: true }),
    centred(110, "OF PUBLICATION", { size: 14, b: true }),
    piece(140, R - wide(16), "Athens, 1/1/2026"),
    full(170, "This agreement is made between the parties named below and sets out every"),
    full(184, "term that both of them accept, in full and without any reservation at all, so"),
    piece(198, L, "that it is clear."),
    piece(220, L, "Some "), piece(220, L + wide(5), "bold", { b: true }), piece(220, L + wide(9), " and "),
    piece(220, L + wide(14), "italic", { i: true }), piece(220, L + wide(20), " words."),
    piece(250, L, "Article 1: Object", { b: true }),
    piece(270, L, "Short line.")
  ])]);
  assert.equal(r.title, "CONTRACT");
  assert.equal(r.html,
    '<h1 style="text-align:center">CONTRACT</h1>' +
    '<h2 style="text-align:center">OF PUBLICATION</h2>' +
    '<p style="text-align:right">Athens, 1/1/2026</p>' +
    '<p style="text-align:justify">This agreement is made between the parties named below and sets out every ' +
    'term that both of them accept, in full and without any reservation at all, so that it is clear.</p>' +
    '<p>Some <strong>bold</strong> and <em>italic</em> words.</p>' +
    '<h3>Article 1: Object</h3>' +
    '<p>Short line.</p>');
});

test("ragged text wraps into one paragraph; a hyphen at a line end joins the word", () => {
  const r = P.fromPages([page([
    piece(100, L, "A left aligned paragraph whose lines stop where the next word does not fit and"),
    piece(114, L, "it goes on here with words, many words, words that are quite unusually bro-"),
    piece(128, L, "ken in two."),
    piece(150, L, "Next one.")
  ])]);
  assert.equal(r.html, "<p>A left aligned paragraph whose lines stop where the next word does not fit and " +
    "it goes on here with words, many words, words that are quite unusually broken in two.</p><p>Next one.</p>");
});

test("lists: numbers with their start, letters, bullets, nesting, a hanging second line", () => {
  const r = P.fromPages([page([
    piece(100, L, "1. First term."),
    full(114, "2. Second term, long enough to run past the end of the line and on to the"),
    piece(128, L + 14, "next one."),
    piece(150, L + 20, "a) a sub point"),
    piece(164, L + 20, "b) another"),
    piece(186, L, "Between them."),
    piece(208, L, "3. Third term."),
    piece(230, L, "• dot one"),
    piece(244, L, " dot two"),
    piece(266, L, "β) Greek letter")
  ])]);
  assert.equal(r.html,
    "<ol><li>First term.</li><li>Second term, long enough to run past the end of the line and on to the next one." +
    '<ol style="list-style-type:lower-alpha"><li>a sub point</li><li>another</li></ol></li></ol>' +
    "<p>Between them.</p>" +
    '<ol start="3"><li>Third term.</li></ol>' +
    "<ul><li>dot one</li><li>dot two</li></ul>" +
    '<ol start="2" style="list-style-type:lower-greek"><li>Greek letter</li></ol>');
});

test("markers: what is a list and what is not", () => {
  assert.deepEqual(P.markerOf("12) x"), { type: "ol", style: "", n: 12, cut: 4 });
  assert.equal(P.markerOf("iv. four").style, "lower-roman");
  assert.equal(P.markerOf("iv. four").n, 4);
  assert.equal(P.markerOf("Α. Παπαδόπουλος"), null, "a Greek capital is an initial");
  assert.equal(P.markerOf("A. Smith"), null);
  assert.equal(P.markerOf("στ) έκτο"), null, "no CSS form for στ");
  assert.equal(P.markerOf("-5% off"), null);
  assert.equal(P.markerOf("2026. A year"), null);
  assert.equal(P.markerOf("- item").type, "ul");
});

test("page furniture: repeated headers and page numbers go; a paragraph runs across pages", () => {
  const head = (y) => centred(y, "Publishing contract");
  const r = P.fromPages([
    page([head(40), full(100, "Text that starts on the first page and fills the whole line from edge to"), full(114, "edge so that it carries on"), centred(810, "1")]),
    page([head(40), piece(100, L, "over the page break."), piece(130, L, "Second paragraph."), centred(810, "Page 2 of 2")])
  ]);
  assert.equal(r.html, '<p style="text-align:justify">Text that starts on the first page and fills the whole line from edge to ' +
    "edge so that it carries on over the page break.</p><p>Second paragraph.</p>");
});

test("safety and limits: text is escaped, rotated text and empty pages are skipped, a scan is refused", () => {
  const r = P.fromPages([page([piece(100, L, "<img src=x onerror=alert(1)> & co"), Object.assign(piece(300, 20, "SIDEWAYS"), { rot: 90 })])]);
  assert.equal(r.html, "<p>&lt;img src=x onerror=alert(1)&gt; &amp; co</p>");
  assert.throws(() => P.fromPages([page([]), page([piece(100, L, "   ")])]), (e) => e.code === "notext");
  const src = fs.readFileSync(path.join(ROOT, "writer/pdfin.js"), "utf8");
  assert.match(src, /isEvalSupported: false/);
  assert.match(src, /enableXfa: false/);
  assert.doesNotMatch(src, /innerHTML|eval\(|new Function/);
});
