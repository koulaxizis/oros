// Writer tracked changes (writer/track.js): the edit diff used to mark
// insertions / deletions, accept / reject in html, attribute cleaning,
// the DOCX <w:ins>/<w:del> tags and the default author name.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const T = require(path.join(__dirname, "..", "writer/track.js"));

test("diffEdit: insertions, deletions, replacements", () => {
  assert.deepEqual(T.diffEdit("helo", "hello", 4), { p: 3, removed: "", inserted: "l" });
  assert.deepEqual(T.diffEdit("abc", "abXc", 3), { p: 2, removed: "", inserted: "X" });
  // caret decides the ambiguous case: "aa" + "a" typed at the start
  assert.deepEqual(T.diffEdit("aa", "aaa", 1), { p: 0, removed: "", inserted: "a" });
  assert.deepEqual(T.diffEdit("aa", "aaa", -1), { p: 2, removed: "", inserted: "a" });
  // a deletion
  assert.deepEqual(T.diffEdit("hello", "helo", 3), { p: 3, removed: "l", inserted: "" });
  // a keyboard autocorrect replacing a word
  assert.deepEqual(T.diffEdit("say teh end", "say the end", 7), { p: 5, removed: "eh", inserted: "he" });
  assert.deepEqual(T.diffEdit("", "new", 3), { p: 0, removed: "", inserted: "new" });
  assert.deepEqual(T.diffEdit("same", "same", 2), { p: 4, removed: "", inserted: "" });
  // emoji (surrogate pairs) stay whole
  const r = T.diffEdit("a😀", "a😃", -1);
  assert.equal(r.removed, "😀");
  assert.equal(r.inserted, "😃");
});

const INS = (id, txt) => `<ins class="tc" data-tc="${id}" data-au="Ann" data-ts="1">${txt}</ins>`;
const DEL = (id, txt) => `<del class="tc" data-tc="${id}" data-au="Ann" data-ts="1">${txt}</del>`;

test("resolveHtml: accept all / reject all", () => {
  const html = `<p>The ${DEL("t1", "old")}${INS("t2", "new")} <b>text</b> and <del>struck</del>.</p>`;
  assert.equal(T.resolveHtml(html, "accept"), "<p>The new <b>text</b> and <del>struck</del>.</p>");
  assert.equal(T.resolveHtml(html, "reject"), "<p>The old <b>text</b> and <del>struck</del>.</p>");
  assert.equal(T.hasChanges(html), true);
  assert.equal(T.hasChanges("<p>a <del>b</del> <ins>c</ins></p>"), false);
});

test("resolveHtml: one change by id; nested formatting inside a change", () => {
  const html = `<p>${INS("a", "one")} ${INS("b", "<em>two</em>")} ${DEL("c", "<del>x</del>y")}</p>`;
  assert.equal(T.resolveHtml(html, "accept", "a"), `<p>one ${INS("b", "<em>two</em>")} ${DEL("c", "<del>x</del>y")}</p>`);
  assert.equal(T.resolveHtml(html, "reject", "b"), `<p>${INS("a", "one")}  ${DEL("c", "<del>x</del>y")}</p>`);
  assert.equal(T.resolveHtml(html, "accept", "c"), `<p>${INS("a", "one")} ${INS("b", "<em>two</em>")} </p>`);
  assert.equal(T.resolveHtml(html, "reject", "c"), `<p>${INS("a", "one")} ${INS("b", "<em>two</em>")} <del>x</del>y</p>`);
  assert.equal(T.resolveHtml(html, "accept"), "<p>one <em>two</em> </p>");
  assert.equal(T.resolveHtml("<p>plain</p>", "accept"), "<p>plain</p>");
});

test("cleanAttrs: bounded, no markup", () => {
  assert.deepEqual(T.cleanAttrs("Ann <b>\"x\"</b>", "12.4", "tc1"), { au: "Ann bx/b", ts: 12, id: "tc1" });
  assert.deepEqual(T.cleanAttrs("x".repeat(100), "nope", "bad id!"), { au: "x".repeat(60), ts: 0, id: "" });
  assert.equal(T.cleanAttrs(null, -5, "").ts, 0);
});

test("colorIndex: stable, in range", () => {
  assert.equal(T.colorIndex("Ann"), T.colorIndex("Ann"));
  for (const n of ["", "Ann", "Μαρία", "Windows PC"]) {
    const i = T.colorIndex(n);
    assert.ok(i >= 0 && i < 8);
  }
});

test("DOCX tags: escaped author, ISO date", () => {
  assert.equal(T.docxOpen("ins", 3, "A & B", Date.UTC(2026, 9, 14, 10, 5, 0)),
    '<w:ins w:id="3" w:author="A &amp; B" w:date="2026-10-14T10:05:00Z">');
  assert.equal(T.docxOpen("del", 4, "", 0), '<w:del w:id="4" w:author="orOS">');
  assert.equal(T.docxClose("del"), "</w:del>");
  assert.equal(T.parseDocxDate("2026-10-14T10:05:00Z"), Date.UTC(2026, 9, 14, 10, 5, 0));
  assert.equal(T.parseDocxDate("junk"), 0);
});

test("deviceName", () => {
  assert.equal(T.deviceName("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari"), "Android phone");
  assert.equal(T.deviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "Windows PC");
  assert.equal(T.deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), "iPhone");
  assert.equal(T.deviceName(""), "orOS");
});
