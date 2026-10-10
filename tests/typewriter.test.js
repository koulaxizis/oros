// Pure logic of the Typewriter (typewriter/core.js): typewriter-mode
// editing (nothing is erased: a backspace strikes, edits move to the
// end, autocorrect strikes the old word), word counts without struck
// letters, stable ink, and the pages merge (sync slice "typewriter").
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const C = require(path.join(__dirname, "..", "typewriter/core.js"));
const X = C.STRIKE;
const page = (id, m, extra) => Object.assign({ id, m, title: "", text: "text " + id, goal: 0 }, extra || {});
const empty = () => ({ ver: 1, pages: [], tombs: {} });

test("strike: backspace strikes letters going back on the same line", () => {
  assert.equal(C.strike("abc", 1), "abc" + X);
  assert.equal(C.strike("abc", 2), "ab" + X + "c" + X);
  assert.equal(C.strike("ab" + X, 1), "a" + X + "b" + X);          // skips the struck letter
  assert.equal(C.strike("ab ", 1), "ab" + X + " ");                 // spaces are never struck
  assert.equal(C.strike("ab\ncd", 5), "ab\nc" + X + "d" + X);       // never goes past a line break
  assert.equal(C.strike("ab\n", 1), "ab\n");
  assert.equal(C.strike("", 3), "");
  assert.equal(C.strike("😀a", 2), "😀" + X + "a" + X);              // whole characters, not halves
});

test("typewriterEdit: nothing is erased", () => {
  assert.equal(C.typewriterEdit("abc", "abcd"), "abcd");                           // typed at the end
  assert.equal(C.typewriterEdit("abc", "ab"), "ab" + "c" + X);                     // backspace
  assert.equal(C.typewriterEdit("abc", "a"), "a" + "b" + X + "c" + X);
  assert.equal(C.typewriterEdit("ab" + X, "a"), "a" + X + "b" + X);                // a deleted stroke strikes the next letter
  assert.equal(C.typewriterEdit("abc", "aXbc"), "abcX");                           // insert in the middle → end
  assert.equal(C.typewriterEdit("teh ", "the "), "t" + X + "e" + X + "h" + X + " the ");   // autocorrect
  assert.equal(C.typewriterEdit("one two three", "one three"), "one t" + X + "w" + X + "o" + X + " three");
  assert.equal(C.typewriterEdit("abc", ""), "a" + X + "b" + X + "c" + X);         // select all + delete
  assert.equal(C.typewriterEdit("abc", "abc"), "abc");
  assert.equal(C.typewriterEdit("a", "a" + X), "a");                               // a stroke cannot be typed in
  const kept = C.keptText(C.typewriterEdit("Hello wrld", "Hello w") + "orld");
  assert.equal(kept, "Hello world");
});

test("cleanText, keptText, plainText", () => {
  assert.equal(C.cleanText("a\r\nb\rc\td\u0000e\u0007"), "a\nb\nc    de");
  assert.equal(C.cleanText(null), "");
  assert.equal(C.cleanText("x".repeat(C.MAX_TEXT + 5)).length, C.MAX_TEXT);
  assert.ok(!/[\ud800-\udbff]$/.test(C.cleanText("x".repeat(C.MAX_TEXT - 1) + "😀")));
  const s = "ab" + X + "c";
  assert.equal(C.keptText(s), "ac");
  assert.equal(C.plainText(s), "abc");
});

test("wordCount: any script, struck letters left out", () => {
  assert.equal(C.wordCount(""), 0);
  assert.equal(C.wordCount("Καλημέρα κόσμε, it's 2026 — well-known!"), 5);
  assert.equal(C.wordCount("one " + C.strikeAll("two") + " three"), 2);
  assert.equal(C.wordCount("  \n\n  "), 0);
});

test("ink: the same letter in the same place always looks the same", () => {
  const a = C.inkOf("p1:0", 3, "a");
  assert.equal(C.inkOf("p1:0", 3, "a"), a);
  for (let i = 0; i < 200; i++) { const k = C.inkOf("p1:" + i, i, "e"); assert.ok(k >= 0 && k < 8); }
  const kinds = new Set(Array.from({ length: 100 }, (_, i) => C.inkOf("s", i, "e")));
  assert.ok(kinds.size >= 6, "ink should vary");
  assert.equal(C.column("ab\nc" + X + "de"), 3);
});

test("merge: commutative, associative, idempotent; LWW per page", () => {
  const A = C.mergeTypewriter({ pages: [page("paaaaaa", 10), page("pbbbbbb", 5)], tombs: { pccccccc: 4 } }, empty());
  const B = C.mergeTypewriter({ pages: [page("pbbbbbb", 7, { text: "newer" }), page("pccccccc", 3)] }, empty());
  const D = C.mergeTypewriter({ pages: [page("pdddddd", 1)], tombs: { paaaaaa: 9 } }, empty());
  const j = (x) => JSON.stringify(x);
  assert.equal(j(C.mergeTypewriter(A, B)), j(C.mergeTypewriter(B, A)));
  assert.equal(j(C.mergeTypewriter(C.mergeTypewriter(A, B), D)), j(C.mergeTypewriter(A, C.mergeTypewriter(B, D))));
  assert.equal(j(C.mergeTypewriter(A, A)), j(A));
  const M = C.mergeTypewriter(A, B);
  assert.deepEqual(M.pages.map((p) => p.id), ["paaaaaa", "pbbbbbb"]);
  assert.equal(C.findPage(M, "pbbbbbb").text, "newer");
  assert.equal(C.findPage(M, "pccccccc"), null);
});

test("merge: delete wins ties, a newer edit resurrects (Undo, R17)", () => {
  const saved = C.mergeTypewriter({ pages: [page("paaaaaa", 10)] }, empty());
  const del = C.mergeTypewriter({ tombs: { paaaaaa: 10 } }, empty());
  assert.equal(C.mergeTypewriter(saved, del).pages.length, 0);
  const back = C.mergeTypewriter(C.mergeTypewriter(saved, del), { pages: [page("paaaaaa", 11)] });
  assert.equal(back.pages.length, 1);
  const t1 = C.mergeTypewriter({ pages: [page("paaaaaa", 5, { text: "A" })] }, empty());
  const t2 = C.mergeTypewriter({ pages: [page("paaaaaa", 5, { text: "B" })] }, empty());
  assert.equal(JSON.stringify(C.mergeTypewriter(t1, t2)), JSON.stringify(C.mergeTypewriter(t2, t1)));
});

test("merge: junk dropped, fields cleaned", () => {
  const good = page("paaaaaa", 1);
  const M = C.mergeTypewriter({
    pages: [null, 7, "x", {}, Object.assign({}, good, { id: "bad" }), Object.assign({}, good, { m: -1 }),
            Object.assign({}, good, { m: 2.5 }),
            Object.assign({}, good, { id: "pbbbbbb", title: "  A\ttitle\u0000 " + "t".repeat(200), text: "a\r\nb", goal: -5 }),
            Object.assign({}, good, { id: "pcccccc", goal: 1e9 })],
    tombs: { "bad id": 1, pdddddd: -1, peeeeee: "2", pffffff: 3 }
  }, { pages: "nope", tombs: [] });
  assert.deepEqual(M.pages.map((p) => p.id), ["pbbbbbb", "pcccccc"]);
  const b = C.findPage(M, "pbbbbbb");
  assert.equal(b.title.length, C.MAX_TITLE);
  assert.ok(b.title.startsWith("A title"));
  assert.equal(b.text, "a\nb");
  assert.equal(b.goal, 0);
  assert.equal(C.findPage(M, "pcccccc").goal, C.MAX_GOAL);
  assert.deepEqual(M.tombs, { pffffff: 3 });
  assert.deepEqual(C.mergeTypewriter(null, undefined), empty());
});

test("newId, newestFirst, displayTitle, fileName", () => {
  let s = 7;
  const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const ids = new Set(Array.from({ length: 50 }, () => C.newId(r)));
  assert.equal(ids.size, 50);
  ids.forEach((id) => assert.ok(C.ID_RE.test(id), id));
  assert.deepEqual(C.newestFirst([page("paaaaaa", 1), page("pbbbbbb", 3), page("pcccccc", 3)]).map((p) => p.id),
                   ["pbbbbbb", "pcccccc", "paaaaaa"]);
  assert.equal(C.displayTitle({ title: "T", text: "x" }, "New"), "T");
  assert.equal(C.displayTitle({ title: "", text: "\n\n  First line here\nsecond" }, "New"), "First line here");
  assert.equal(C.displayTitle({ title: "", text: C.strikeAll("gone") }, "New"), "New");
  assert.equal(C.fileName("Γράμμα: σε μένα / 2026?"), "Γράμμα-σε-μένα-2026.txt");
  assert.equal(C.fileName("..."), "typewriter.txt");
});

test("app: strings match in both languages, every id and key exists", () => {
  const js = fs.readFileSync(path.join(__dirname, "..", "typewriter/typewriter.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "typewriter/index.html"), "utf8");
  const S = new Function(js.slice(js.indexOf("  var STRINGS"), js.indexOf("  function t(")) + "\nreturn STRINGS;")();
  assert.deepEqual(Object.keys(S.el).sort(), Object.keys(S.en).sort());
  [...html.matchAll(/data-i18n(?:-ph)?="([^"]+)"/g)].forEach((m) => assert.ok(m[1] in S.en, m[1]));
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, "duplicate id");
  [...js.matchAll(/\$\("([a-z-]+)"\)/g)].forEach((m) => assert.ok(ids.includes(m[1]) || m[1] === "end", "missing #" + m[1]));
  assert.match(js, /inheritPalette/);
  assert.match(js, /watchPalette/);
});
