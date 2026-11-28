// Files › Photos › a photo's description (files/captions-core.js,
// slice "files-captions"): set, merge, tombs, caps.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../files/captions-core.js");

const H1 = "a".repeat(64), H2 = "b".repeat(64);

test("set + textOf: by hash when sync knows the file, else by path", () => {
  let s = C.norm(null);
  s = C.set(s, "/internal/Pictures/a.jpg", H1, "  A dog\ton the beach  ", 1000);
  s = C.set(s, "/internal/Pictures/b.jpg", "", "A cat", 1000);
  assert.equal(C.textOf(s, "/internal/elsewhere/a.jpg", H1), "A dog on the beach");   // moved: the hash finds it
  assert.equal(C.textOf(s, "/internal/Pictures/b.jpg", ""), "A cat");
  assert.deepEqual(s.items.map((x) => x.k), ["h:" + H1, "p:/internal/Pictures/b.jpg"]);
});

test("set: an unchanged edit returns the same state (R27); stamps only go up", () => {
  let s = C.set(C.norm(null), "/internal/a.jpg", H1, "Old", 5000);
  assert.equal(C.set(s, "/internal/a.jpg", H1, "Old", 9000), s);
  const s2 = C.set(s, "/internal/a.jpg", H1, "New", 10);     // clock behind: still newer
  assert.equal(s2.items[0].m, 5001);
  assert.equal(C.set(C.norm(null), "/internal/a.jpg", H1, "", 10).items.length, 0);   // nothing to remove
});

test("remove keeps a tomb so an older copy cannot bring it back", () => {
  const old = C.set(C.norm(null), "/internal/a.jpg", H1, "A dog", 1000);
  const gone = C.set(old, "/internal/a.jpg", H1, "", 2000);
  assert.equal(C.textOf(gone, "/internal/a.jpg", H1), "");
  assert.equal(C.textOf(C.merge(gone, old), "/internal/a.jpg", H1), "");
  assert.equal(C.textOf(C.merge(old, gone), "/internal/a.jpg", H1), "");
});

test("merge: newer wins per photo, both devices' photos kept, same result both ways", () => {
  const a = C.set(C.set(C.norm(null), "/internal/a.jpg", H1, "From A", 1000), "/internal/x.jpg", H2, "Only on A", 1000);
  const b = C.set(C.norm(null), "/internal/a.jpg", H1, "From B, later", 2000);
  const m1 = C.merge(a, b), m2 = C.merge(b, a);
  assert.deepEqual(m1, m2);
  assert.equal(C.textOf(m1, "/internal/a.jpg", H1), "From B, later");
  assert.equal(C.textOf(m1, "/internal/x.jpg", H2), "Only on A");
  assert.deepEqual(C.norm(m1), m1);
  // Equal stamps: the larger text wins on every device.
  const c = C.set(C.norm(null), "/internal/a.jpg", H1, "Zebra", 2000);
  assert.equal(C.textOf(C.merge(b, c), "/internal/a.jpg", H1), "Zebra");
  assert.equal(C.textOf(C.merge(c, b), "/internal/a.jpg", H1), "Zebra");
});

test("norm: junk rows dropped, text cleaned and capped", () => {
  const s = C.norm({ items: [
    { k: "h:xyz", d: "bad key", m: 1 },
    { k: "p:relative", d: "bad path", m: 1 },
    { k: "h:" + H1, d: "no stamp" },
    { k: "h:" + H2, p: "/internal/b.jpg", d: "x".repeat(900) + "\u0007", m: 3 },
    "nope", null
  ] });
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].d.length, C.MAX_TEXT);
  assert.equal(C.norm("garbage").items.length, 0);
});

test("byPath: live descriptions by their last known path (search)", () => {
  let s = C.set(C.norm(null), "/internal/a.jpg", H1, "A dog", 1000);
  s = C.set(s, "/internal/b.jpg", H2, "Gone", 1000);
  s = C.set(s, "/internal/b.jpg", H2, "", 2000);
  const m = C.byPath(s);
  assert.deepEqual(Object.keys(m), ["/internal/a.jpg"]);
  assert.equal(m["/internal/a.jpg"], "A dog");
});

test("Files search provider: a photo's description is in its hit's text", async () => {
  delete require.cache[require.resolve("../files/search.js")];
  global.orosFS = { ls: async (p) => (p === "/internal" ? [{ name: "Pictures", dir: true }] : p === "/internal/Pictures" ? [{ name: "a.jpg" }, { name: "b.jpg" }] : []) };
  const P = require("../files/search.js");
  let s = C.set(C.norm(null), "/internal/Pictures/a.jpg", H1, "A dog on the beach", 1000);
  const ctx = (lang) => ({ q: "dog", words: ["dog"], code: lang, lang: lang, readJSON: (k) => (k === "oros-files-captions" ? s : null) });
  let hits = await P.search(ctx("el"));
  const a = hits.find((h) => h.id === "/internal/Pictures/a.jpg"), b = hits.find((h) => h.id === "/internal/Pictures/b.jpg");
  assert.equal(a.text, "/Pictures\nΠεριγραφή: A dog on the beach");
  assert.equal(b.text, "/Pictures");
  s = C.set(s, "/internal/Pictures/a.jpg", H1, "", 2000);
  hits = await P.search(ctx("en"));
  assert.equal(hits.find((h) => h.id === "/internal/Pictures/a.jpg").text, "/Pictures");
  delete global.orosFS;
});
