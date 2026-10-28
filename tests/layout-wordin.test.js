// orOS Layout — placing a Word / OpenDocument / RTF / HTML / Markdown
// file (layout/wordin.js, LY-WD): Writer's HTML becomes paragraphs with
// a role, and the document's mapping (setup.ext.wmap) gives each role
// its paragraph style. Synthetic text only.
// Run: node --test tests/layout-wordin.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const W = require(path.join(ROOT, "layout/wordin.js"));
const M = require(path.join(ROOT, "designkit/model.js"));

const text = (p) => p.runs.map((r) => r.t).join("");

test("parse: roles, the first paragraph after a heading or a blank line, centred, quotes, lists", () => {
  const html = "<h1>Chapter one</h1><p>The first paragraph.</p><p>A second one.</p>" +
    "<p></p><p>After a blank line.</p><h2>A part</h2><h4>Small heading</h4><p style=\"text-align: center\">* * *</p>" +
    "<blockquote><p>Quoted words.</p></blockquote><ul><li>one</li><li>two</li></ul><p>Last.</p>";
  const list = W.parse(html);
  assert.deepEqual(list.map((p) => p.role), ["h1", "p1", "p", "p", "p1", "h2", "h3", "center", "quote", "li", "li", "p"]);
  assert.deepEqual(list.map(text), ["Chapter one", "The first paragraph.", "A second one.", "", "After a blank line.", "A part", "Small heading", "* * *", "Quoted words.", "one", "two", "Last."]);
  // the empty paragraph stays an empty paragraph
  assert.deepEqual(list[3].runs, []);
  assert.deepEqual(W.counts(list), { h1: 1, p1: 2, p: 2, h2: 1, h3: 1, center: 1, quote: 1, li: 2 });
});

test("parse: bold, italic and underline runs; line breaks; spaces; entities", () => {
  const list = W.parse("<p>  A <strong>bold <em>and italic</em></strong> and <u>under</u>&nbsp;&nbsp;line&#33;<br>Next &amp; &#x3b1; &lt;x&gt;  </p>");
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].runs, [
    { t: "A " }, { t: "bold ", b: 1 }, { t: "and italic", b: 1, i: 1 }, { t: " and " }, { t: "under", u: 1 },
    { t: " line!\nNext & α <x>" }
  ]);
});

test("parse: footnote marks, comments, scripts, styles and a title are left out", () => {
  const list = W.parse("<html><head><title>Not text</title><style>p{color:red}</style></head><body>" +
    "<!-- a comment <p>hidden</p> --><p>Word<sup class=\"fn-ref\" data-fn=\"f1\">1</sup> and x<sup>2</sup>.</p>" +
    "<script>var x = 1;</script></body></html>");
  assert.deepEqual(list.map(text), ["Word and x2."]);
});

test("mapOf: the saved mapping where its style is there, else the seed style, else the base", () => {
  const d = M.newDoc({ name: "W", pages: 1 }, 1);
  const seed = W.mapOf(d);
  assert.deepEqual(seed, { h1: "ps-h1", h2: "ps-h2", h3: "ps-h3", p1: "ps-body", p: "ps-body", center: "ps-body", quote: "ps-quote", li: "ps-list" });
  d.pstyles.push({ id: "ps-first", m: 1, name: "First", base: "ps-body" });
  d.setup.ext = { wmap: { p1: "ps-first", h1: "ps-gone" } };
  const m = W.mapOf(d);
  assert.equal(m.p1, "ps-first");
  assert.equal(m.h1, "ps-h1");
  d.pstyles = d.pstyles.filter((s) => s.id !== "ps-quote");
  assert.equal(W.mapOf(d).quote, "ps-base");
});

test("paras: Layout paragraphs with the mapped style; the document keeps the mapping", () => {
  const d = M.newDoc({ name: "W", pages: 1 }, 1);
  const list = W.parse("<h1>Title</h1><p>First.</p><p>Then <em>this</em>.</p>");
  const map = Object.assign(W.mapOf(d), { p1: "ps-base" });
  const ps = W.paras(list, map);
  assert.deepEqual(ps, [
    { ps: "ps-h1", runs: [{ t: "Title" }] },
    { ps: "ps-base", runs: [{ t: "First." }] },
    { ps: "ps-body", runs: [{ t: "Then " }, { t: "this", i: 1 }, { t: "." }] }
  ]);
  d.setup.ext = { wmap: map };
  d.stories.push({ id: "st-w", m: 1, paras: ps });
  const n = M.normDoc(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(n.setup.ext.wmap, map);
  assert.deepEqual(n.stories.find((s) => s.id === "st-w").paras.map((p) => p.ps), ["ps-h1", "ps-base", "ps-body"]);
});

test("wiring: More › Place text reads Word files through Writer's reader; wordin.js is cached offline", () => {
  const io = fs.readFileSync(path.join(ROOT, "layout/io.js"), "utf8");
  assert.match(io, /TEXT_ACCEPT = "[^"]*\.docx[^"]*\.odt/);
  assert.match(io, /script\("\.\.\/writer\/io\.js", "WriterIO"\)/);
  assert.match(io, /script\("wordin\.js", "LY_WORDIN"\)/);
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  assert.ok(sw.includes('"layout/wordin.js",'));
  assert.ok(sw.includes('"writer/io.js",'));
});
