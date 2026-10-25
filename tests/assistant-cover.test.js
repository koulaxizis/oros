// Assistant book_cover (publisher P3b): the tool is offered only with
// Layout, its arguments are checked, and nothing made up gets through.
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../assistant/core.js");

test("book_cover is offered only when Layout is there, with its prompt line", () => {
  const names = (o) => C.toolsFor(o).map((t) => t.name);
  assert.ok(!names({ data: true }).includes("book_cover"));
  assert.ok(names({ cover: true }).includes("book_cover"));
  assert.match(C.systemPrompt({ lang: "el", now: 0, cover: true }), /book_cover/);
  assert.doesNotMatch(C.systemPrompt({ lang: "el", now: 0, cover: true, builtin: true }), /book_cover/);
});

test("book_cover arguments: cleaned, ISBN checked, trim from the list", () => {
  const n = C.normCover({ title: "  Άνθρωποι\nπου αξίζει ", author: "Βασίλης Τσεβάς", isbn: "978-0-306-40615-7", pages: "240",
    trim: "148x210", front_picture: 1, logo: "GL Avatar.png", price: "€14,90", evil: "<x>" });
  assert.equal(n.ok, true);
  assert.equal(n.cover.title, "Άνθρωποι που αξίζει");
  assert.equal(n.cover.isbn, "9780306406157");
  assert.equal(n.cover.pages, 240);
  assert.deepEqual([n.cover.w, n.cover.h], [148, 210]);
  assert.deepEqual(n.pics, { front: "1", logo: "GL Avatar.png" });
  assert.equal(n.cover.evil, undefined);
  assert.equal(C.normCover({ title: "T", trim: "999x1" }).cover.w, 140);
  assert.equal(C.normCover({ title: "T", isbn: "9780306406158" }).ok, false, "wrong check digit");
  assert.equal(C.normCover({ title: "T", isbn: "12345" }).ok, false);
  assert.equal(C.normCover({ title: "" }).ok, false);
  assert.equal(C.normCover(null).ok, false);
});
