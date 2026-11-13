// Studio wave A2: books (a book is chapters, each an ordinary Studio project).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const C = require(path.join(__dirname, "..", "studio/core.js"));
const P = (id, m, extra) => Object.assign({ id, m, name: id, bpm: 120, sig: 4, vol: 0, loop: { on: false, a: 0, b: 0 }, fx: [] }, extra || {});
const data = (extra) => Object.assign({ ver: 1, projects: [], tracks: [], sources: [], clips: [], tombs: {} }, extra || {});
const B = (id, m, extra) => Object.assign({ id, m, name: "Book " + id }, extra || {});

test("data without books keeps the very same bytes (no empty list is added)", () => {
  const d = data({ projects: [P("pproject1", 1)] });
  const m = C.mergeStudio(d, d);
  assert.equal("books" in m, false);
  assert.equal(JSON.stringify(m), JSON.stringify(C.mergeStudio(m, data())));
});

test("normBook keeps what is valid and drops the rest whole", () => {
  const b = C.normBook(B("bbook0001", 3, {
    ch: ["pchap0001", "pchap0002", "pchap0001", "bad", 5], open: "pchap0001", close: "pclose001", spec: "storytel",
    pub: { t: "t123", e: "e/../x" }, meta: { author: " Χρήστος ", narrator: "Νίκος", year: 2026, lang: "ell", x: 1 },
    rt: { path: "/internal/Studio/audio/rt-bbook0001.flac", dur: 30, floor: -63.27 }, sample: { p: "pchap0002", a: 10, b: 200 }, zz: 1
  }));
  assert.deepEqual(b.ch, ["pchap0001", "pchap0002"]);
  assert.equal(b.open, undefined, "the opening credits are not also a chapter");
  assert.equal(b.close, "pclose001");
  assert.equal(b.spec, "storytel");
  assert.deepEqual(b.pub, { t: "t123" });
  assert.deepEqual(b.meta, { author: "Χρήστος", narrator: "Νίκος", year: 2026, lang: "ell" });
  assert.deepEqual(b.rt, { path: "/internal/Studio/audio/rt-bbook0001.flac", dur: 30, floor: -63.3 });
  assert.deepEqual(b.sample, { p: "pchap0002", a: 10, b: 200 });
  assert.equal(b.zz, 1, "unknown fields ride along (A0)");
  assert.equal(C.normBook(B("bbook0001", 3, { spec: "audible", rt: { path: "/etc/passwd" }, sample: { p: "pchap1", a: 5, b: 1 } })).spec, "acx");
  assert.equal(C.normBook(B("xbook0001", 3)), null);
  assert.equal(C.normBook(B("bbook0001", -1)), null);
});

test("chapter fields on a project: both or neither", () => {
  assert.deepEqual([C.normProject(P("pchap0001", 1, { bk: "bbook0001", kind: "chapter" }))].map((p) => [p.bk, p.kind]), [["bbook0001", "chapter"]]);
  const bad = C.normProject(P("pchap0001", 1, { bk: "bbook0001", kind: "song" }));
  assert.equal(bad.bk, undefined); assert.equal(bad.kind, undefined);
  assert.equal(C.normProject(P("pchap0001", 1, { kind: "chapter" })).kind, undefined);
  const song = C.normProject(P("psong0001", 1));
  assert.equal(JSON.stringify(song), JSON.stringify(C.normProject(JSON.parse(JSON.stringify(song)))));
});

test("books merge like the other lists: newest wins, symmetric, idempotent, tombstones", () => {
  const a = data({ books: [B("bbook0001", 5, { ch: ["pchap0001"] }), B("bbook0002", 1)] });
  const b = data({ books: [B("bbook0001", 9, { name: "Newer", ch: ["pchap0001", "pchap0002"] }), B("bbook0003", 2)], tombs: { bbook0002: 3 } });
  const ab = C.mergeStudio(a, b), ba = C.mergeStudio(b, a);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba));
  assert.equal(JSON.stringify(C.mergeStudio(ab, ab)), JSON.stringify(ab));
  assert.deepEqual(ab.books.map((x) => x.id), ["bbook0001", "bbook0003"]);
  assert.equal(ab.books[0].name, "Newer");
  const many = data({ books: Array.from({ length: 50 }, (_, i) => B("b" + String(i).padStart(7, "0"), 1)) });
  assert.equal(C.mergeStudio(many, data()).books.length, C.MAX_BOOKS);
});

test("bookParts: credits around the chapters in order; a chapter that is gone drops out", () => {
  const d = C.mergeStudio(data({
    projects: [P("popen0001", 1, { bk: "bbook0001", kind: "open" }), P("pchap0001", 1, { bk: "bbook0001", kind: "chapter" }),
               P("pchap0002", 1, { bk: "bbook0001", kind: "chapter" }), P("pclose001", 1, { bk: "bbook0001", kind: "close" }),
               P("pother001", 1, { bk: "bbook0009", kind: "chapter" })],
    books: [B("bbook0001", 1, { ch: ["pchap0002", "pgone0001", "pchap0001", "pother001"], open: "popen0001", close: "pclose001" })]
  }), data());
  const parts = C.bookParts(d, d.books[0]);
  assert.deepEqual(parts.map((x) => [x.p.id, x.kind]), [["popen0001", "open"], ["pchap0002", "chapter"], ["pchap0001", "chapter"], ["pclose001", "close"]]);
  assert.equal(C.songCount(d), 0);
  assert.equal(C.chapterCount(d), 5);
});
