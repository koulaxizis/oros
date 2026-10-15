// Library "Import highlights" (library/import.js): Kindle My Clippings
// (notes joined to their highlight, bookmarks, localized meta lines),
// KOReader JSON (one book, many books, DocFragment chapters) and
// Markdown, Readwise CSV; matching a Library book by title + author;
// finding each quote in the book's text (curly quotes, spaces, block
// joins); page bookmarks for PDFs; stable ids; caps.
// Fixtures: tests/fixtures/library-import/
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const I = require(path.join(__dirname, "..", "library/import.js"));
const C = require(path.join(__dirname, "..", "library/core.js"));
const FX = path.join(__dirname, "fixtures", "library-import");
const fx = (n) => fs.readFileSync(path.join(FX, n), "utf8");

const HOBBIT = { id: "b0123456789abcdef", m: 5, fmt: "epub", title: "The Hobbit: or There and Back Again", by: "J. R. R. Tolkien" };
const HOBBIT2 = { id: "b0123456789abcde0", m: 5, fmt: "epub", title: "The Hobbit", by: "J. R. R. Tolkien" };
const REPORT = { id: "b1111111111111111", m: 5, fmt: "pdf", title: "Report", by: "Ann Author", pages: 3 };
const ODYSSEY = { id: "b2222222222222222", m: 5, fmt: "epub", title: "Η ΟΔΥΣΣΕΙΑ", by: "Ομηρος" };
// chapter texts as the reader counts them (block elements join with no space)
const HOBBIT_TEXT = [
  "Contents",
  "Chapter IAn Unexpected PartyIn a hole in the ground there lived a hobbit. Not a nasty, dirty, wet hole.",
  "By some curious chance one morning long ago.“Good Morning!” said Bilbo, and he meant it.The sun was shining."
];
const REPORT_PAGES = ["Title page", "Intro\nthe quick\nbrown fox jumps over\nthe lazy dog", "End"];

function ok(rec) { const n = C.normMark(Object.assign({ m: 10 }, rec)); assert.ok(n, "valid mark " + JSON.stringify(rec)); return n; }

test("Kindle: books, highlights, the note joins its highlight, bookmark, localized meta", () => {
  const r = I.parseText(fx("My Clippings.txt"), "My Clippings.txt");
  assert.equal(r.source, "kindle");
  assert.deepEqual(r.books.map((b) => [b.title, b.author]), [
    ["The Hobbit", "J.R.R. Tolkien"], ["Der Hobbit", "Tolkien, J.R.R."], ["Unknown Book: A Novel", "Some Writer"]]);
  const h = r.books[0];
  assert.equal(h.items.length, 4);
  assert.deepEqual(h.items.map((x) => x.t), ["hl", "bm", "hl", "hl"]);
  assert.equal(h.items[0].text, "In a hole in the ground there lived a hobbit.");
  assert.equal(h.items[0].note, "Famous first line");
  assert.equal(h.items[0].page, 12);
  assert.equal(h.items[0].lo, 123);
  assert.equal(new Date(h.items[0].date).getFullYear(), 2024);
  assert.equal(h.items[1].page, 30);
  const de = r.books[1].items[0];
  assert.equal(de.t, "hl");
  assert.equal(de.page, 5);
  assert.equal(de.lo, 50);
  const rg = I.dateRange(r);
  assert.ok(rg && rg.from < rg.to);
});

test("matching: folded title, subtitle, author check", () => {
  assert.equal(I.matchBook({ title: "The Hobbit", author: "J.R.R. Tolkien" }, [HOBBIT]).id, HOBBIT.id);   // main title
  assert.equal(I.matchBook({ title: "The Hobbit", author: "Tolkien, J.R.R." }, [HOBBIT, HOBBIT2]).id, HOBBIT2.id);   // exact wins
  assert.equal(I.matchBook({ title: "The Hobbit", author: "Someone Else" }, [HOBBIT2]), null);   // another author
  assert.equal(I.matchBook({ title: "The Hobbit", author: "" }, [HOBBIT2]).id, HOBBIT2.id);
  assert.equal(I.matchBook({ title: "Η Οδύσσεια", author: "Όμηρος" }, [ODYSSEY]).id, ODYSSEY.id);   // accents / case
  assert.equal(I.matchBook({ title: "Unknown Book: A Novel", author: "Some Writer" }, [HOBBIT, REPORT]), null);
});

test("locate: exact, curly quotes / nbsp, block joins, PDF line breaks, hint, misses", () => {
  const a = I.locate(HOBBIT_TEXT, "In a hole in the ground there lived a hobbit.", -1);
  assert.equal(a.s, 1);
  assert.equal(HOBBIT_TEXT[1].slice(a.a, a.b), "In a hole in the ground there lived a hobbit.");
  const b = I.locate(HOBBIT_TEXT, "\"Good Morning!\" said Bilbo, and he meant it.", -1);
  assert.equal(b.s, 2);
  assert.equal(HOBBIT_TEXT[2].slice(b.a, b.b), "“Good Morning!” said Bilbo, and he meant it.");
  const c = I.locate(HOBBIT_TEXT, "An Unexpected Party In a hole", -1);       // "PartyIn" joined in the text
  assert.equal(HOBBIT_TEXT[1].slice(c.a, c.b), "An Unexpected PartyIn a hole");
  const d = I.locate(REPORT_PAGES, "the quick brown fox", 1);
  assert.equal(d.s, 1);
  assert.equal(REPORT_PAGES[1].slice(d.a, d.b), "the quick\nbrown fox");
  assert.equal(I.locate(HOBBIT_TEXT, "This sentence is not in the book at all.", -1), null);
  assert.equal(I.locate(HOBBIT_TEXT, "ab", -1), null);
  // long quote with a changed middle: first and last words
  const long = "By some curious chance one morning long ago. Good Morning said Bilbo, and he meant it. The sun was shining.";
  const e = I.locate(HOBBIT_TEXT, long.replace("long ago", "long, long ago").replace("Good", "Good, good"), -1);
  assert.equal(e.s, 2);
  assert.equal(e.a, 0);
});

test("planBook (EPUB): located highlights become valid marks with context; misses counted", () => {
  const r = I.parseText(fx("My Clippings.txt"), "My Clippings.txt");
  const p = I.planBook(r.books[0], HOBBIT, { texts: HOBBIT_TEXT, fmt: "epub", marks: [] });
  assert.equal(p.found, 2);
  assert.equal(p.nopos, 2);           // a sentence not in the book; a Kindle bookmark in an EPUB
  assert.equal(p.add.length, 2);
  const m0 = ok(p.add[0]);
  assert.equal(m0.k, "hl");
  assert.equal(m0.loc, "e:1:" + HOBBIT_TEXT[1].indexOf("In a hole"));
  assert.equal(m0.q, "In a hole in the ground there lived a hobbit.");
  assert.equal(m0.n, "Famous first line");
  assert.ok(m0.pre && m0.suf);
  assert.ok(/^ki[0-9a-z]{14}$/.test(m0.id));
  // the same file again: nothing new
  const again = I.planBook(r.books[0], HOBBIT, { texts: HOBBIT_TEXT, fmt: "epub", marks: p.add.map((k) => Object.assign({ m: 9 }, k)) });
  assert.equal(again.add.length, 0);
  assert.equal(again.have, 2);
  // a highlight the person already made on the same words
  const mine = [{ id: "kmine0001", b: HOBBIT.id, k: "hl", loc: "e:1:5", end: "e:1:9", q: "In a hole in the ground there lived a hobbit.", m: 3 }];
  assert.equal(I.planBook(r.books[0], HOBBIT, { texts: HOBBIT_TEXT, fmt: "epub", marks: mine }).found, 1);
  // the file is not on this device: nothing can be placed
  const nf = I.planBook(r.books[0], HOBBIT, { texts: null, fmt: "epub", marks: [] });
  assert.equal(nf.add.length, 0);
  assert.equal(nf.nofile, 3);
});

test("KOReader JSON: one book, DocFragment chapter, colour, bookmark at chapter start", () => {
  const r = I.parseText(fx("koreader.json"), "odysseia.json");
  assert.equal(r.source, "koreader");
  assert.equal(r.books[0].title, "Η Οδύσσεια");
  const it = r.books[0].items;
  assert.equal(it[0].sec, 1);
  assert.equal(it[0].c, 1);
  assert.equal(it[0].note, "Η αρχή");
  assert.equal(it[1].t, "bm");
  const texts = ["Τίτλος", "ΡΑΨΩΔΙΑ ΑΆνδρα μοι έννεπε, Μούσα, πολύτροπον, ὃς μάλα πολλὰ", "Ραψωδία β"];
  const p = I.planBook(r.books[0], ODYSSEY, { texts, fmt: "epub", marks: [] });
  assert.equal(p.found, 1);
  assert.equal(p.page, 1);
  const hl = ok(p.add[0]);
  assert.equal(hl.c, 1);
  assert.equal(hl.loc, "e:1:" + texts[1].indexOf("Άνδρα"));
  const bm = ok(p.add[1]);
  assert.equal(bm.loc, "e:2:0");
});

test("KOReader JSON: many documents; PDF page bookmarks for what can't be found", () => {
  const r = I.parseText(fx("koreader-all.json"), "all.json");
  assert.deepEqual(r.books.map((b) => b.title), ["Report", "Elsewhere"]);
  const p = I.planBook(r.books[0], REPORT, { texts: REPORT_PAGES, fmt: "pdf", marks: [] });
  assert.equal(p.found, 1);
  assert.equal(p.page, 1);                    // the loose note → a page bookmark with the note
  const hl = ok(p.add[0]);
  assert.equal(hl.loc, "p:2:" + REPORT_PAGES[1].indexOf("the quick"));
  const bm = ok(p.add[1]);
  assert.equal(bm.k, "bm");
  assert.equal(bm.loc, "p:2:y0");
  assert.equal(bm.n, "a loose note");
});

test("KOReader Markdown: title, author, chapter, page, styled text, note", () => {
  const r = I.parseText(fx("koreader.md"), "hobbit.md");
  assert.equal(r.source, "koreader-md");
  const b = r.books[0];
  assert.equal(b.title, "The Hobbit");
  assert.equal(b.author, "J.R.R. Tolkien");
  assert.equal(b.items.length, 2);
  assert.equal(b.items[0].text, "In a hole in the ground there lived a hobbit.");
  assert.equal(b.items[0].note, "Famous first line");
  assert.equal(b.items[0].chapter, "Chapter 1: An Unexpected Party");
  assert.equal(b.items[0].page, 12);
  assert.equal(new Date(b.items[0].date).getHours(), 12);
  assert.equal(b.items[1].text, "\"Good Morning!\" said Bilbo, and he meant it.");
  const p = I.planBook(b, HOBBIT2, { texts: HOBBIT_TEXT, fmt: "epub", marks: [] });
  assert.equal(p.found, 2);
  assert.equal(ok(p.add[0]).lbl, "Chapter 1: An Unexpected Party");
});

test("Readwise CSV: books, notes, colours, page → PDF page bookmark when not found", () => {
  const r = I.parseText(fx("readwise.csv"), "readwise.csv");
  assert.equal(r.source, "readwise");
  assert.deepEqual(r.books.map((b) => b.title), ["The Hobbit", "Report"]);
  assert.equal(r.books[0].items[0].note, "First line, famous");
  assert.equal(r.books[1].items[0].c, 2);
  assert.equal(r.books[1].items[1].c, 3);
  // "jumps over" IS on page 2 (the hint is page 9: other pages are tried)
  const p = I.planBook(r.books[1], REPORT, { texts: REPORT_PAGES, fmt: "pdf", marks: [] });
  assert.equal(p.found, 2);
  // PDF file not here: page bookmarks keep the quotes (page 9 > 3 pages: skipped)
  const nf = I.planBook(r.books[1], REPORT, { texts: null, fmt: "pdf", marks: [] });
  assert.equal(nf.page, 1);
  assert.equal(nf.nofile, 1);
  assert.equal(ok(nf.add[0]).q, "the quick brown fox");
});

test("errors and caps", () => {
  assert.equal(I.parseText("", "x.txt").error, "empty");
  assert.equal(I.parseText("hello world", "x.txt").error, "bad");
  assert.equal(I.parseText("{\"a\":1}", "x.json").error, "bad");
  assert.equal(I.parseText("x".repeat(30 * 1024 * 1024 + 1), "x.txt").error, "big");
  let big = "";
  for (let i = 0; i < 20100; i++) big += "Book (A)\n- Your Highlight on page 1 | Location " + i + " | Added on Monday, 1 January 2024 12:00:00\n\nText " + i + "\n==========\n";
  const r = I.parseText(big, "My Clippings.txt");
  assert.equal(r.books[0].items.length, 20000);
  return I.readBytes(new TextEncoder().encode(fx("readwise.csv")), "r.csv").then((x) => assert.equal(x.source, "readwise"));
});
