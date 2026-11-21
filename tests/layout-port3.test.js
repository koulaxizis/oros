// Layout: porting a folder of books (LY-PORT3): the plan of a picked
// folder (layout/port.js: which PDF and which pictures go with each
// Scribus or InDesign file), the report's numbers and CSV, and the page
// shift between our pages and the PDF's (layout/rebuild.js bestShift).
// Names here are made up; no real book is used.
// Run: node --test tests/layout-port3.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const P = require(path.join(ROOT, "layout/port.js"));
const RB = require(path.join(ROOT, "layout/rebuild.js"));

const F = (p) => ({ name: p.split("/").pop(), webkitRelativePath: p });
const planOf = (paths) => P.plan(paths.map(F));
const byPath = (res, p) => res.books.find((b) => b.path === p);

const SHELF = [
  "Books/Finished/Sea Garden/sea garden body.sla",
  "Books/Finished/Sea Garden/sea garden cover.sla",
  "Books/Finished/Sea Garden/images/wave.jpg",
  "Books/Finished/Sea Garden/images/sub/shell.png",
  "Books/Printer/Sea Garden print.pdf",
  "Books/Printer/Sea Garden cover.pdf",
  "Books/Finished/Night Owls/night owls.idml",
  "Books/Finished/Night Owls/owl.tif",
  "Books/Printer/Night Owls.pdf",
  "Books/Shop/Night Owls ebook.pdf",
  "Books/Finished/Stone Road/stone road.sla.gz",
  "Books/Printer/Glass Hours.pdf",
  "Books/Finished/Sea Garden/sea garden body.sla.autosave",
  "Books/Finished/Sea Garden/sea garden body.sla~",
  "Books/Finished/Sea Garden/._sea garden body.sla",
  "Books/Layout/sea garden body.sla",
  "Books/Finished/notes.txt"
];

test("port: a single book's own folder keeps its title words", () => {
  const res = planOf(["Sea Garden/sea garden body.sla", "Sea Garden/sea garden cover.sla", "Sea Garden/sea garden print.pdf", "Sea Garden/sea garden cover.pdf", "Sea Garden/sea garden.pdf"]);
  assert.equal(byPath(res, "Sea Garden/sea garden body.sla").pdfPath, "Sea Garden/sea garden print.pdf");
  assert.equal(byPath(res, "Sea Garden/sea garden cover.sla").pdfPath, "Sea Garden/sea garden cover.pdf");
});

test("port: book files are found, backups and Layout's own saves are left out", () => {
  const res = planOf(SHELF);
  assert.deepEqual(res.books.map((b) => b.path), [
    "Books/Finished/Night Owls/night owls.idml",
    "Books/Finished/Sea Garden/sea garden body.sla",
    "Books/Finished/Sea Garden/sea garden cover.sla",
    "Books/Finished/Stone Road/stone road.sla.gz"
  ]);
  assert.equal(byPath(res, "Books/Finished/Night Owls/night owls.idml").kind, "idml");
  assert.equal(byPath(res, "Books/Finished/Stone Road/stone road.sla.gz").kind, "sla");
  assert.equal(res.pdfs, 5);
  assert.equal(res.pictures, 3);
  assert.equal(res.more, 0);
});

test("port: a body takes the print PDF, a cover the cover PDF, never each other's", () => {
  const res = planOf(SHELF);
  assert.equal(byPath(res, "Books/Finished/Sea Garden/sea garden body.sla").pdfPath, "Books/Printer/Sea Garden print.pdf");
  assert.equal(byPath(res, "Books/Finished/Sea Garden/sea garden cover.sla").pdfPath, "Books/Printer/Sea Garden cover.pdf");
});

test("port: a print file prefers the printer's PDF over the shop's e-book", () => {
  const res = planOf(SHELF);
  assert.equal(byPath(res, "Books/Finished/Night Owls/night owls.idml").pdfPath, "Books/Printer/Night Owls.pdf");
});

test("port: no PDF that fits → none, never a guess", () => {
  const res = planOf(SHELF);
  const b = byPath(res, "Books/Finished/Stone Road/stone road.sla.gz");
  assert.equal(b.pdf, null);
  assert.equal(b.pdfPath, "");
});

test("port: two equally good PDFs → none", () => {
  const res = planOf(["A/Moon Tide/moon tide.sla", "B/Moon Tide.pdf", "C/Moon Tide.pdf", "D/x.pdf", "E/y.pdf"]);
  assert.equal(res.books[0].pdf, null);
});

test("port: the same name in the same folder wins", () => {
  const res = planOf(["W/Red Kite/red kite.sla", "W/Red Kite/red kite.pdf", "W/Other/red kite final.pdf"]);
  assert.equal(res.books[0].pdfPath, "W/Red Kite/red kite.pdf");
});

test("port: an e-book file takes an e-book PDF; only an e-book PDF with nothing better", () => {
  const res = planOf([
    "P/Blue Hill/blue hill ebook.sla", "Shop/Blue Hill e-book.pdf", "Printer/Blue Hill print.pdf",
    "P/Iron Bell/iron bell ebook.sla", "Printer/Iron Bell.pdf"
  ]);
  assert.equal(byPath(res, "P/Blue Hill/blue hill ebook.sla").pdfPath, "Shop/Blue Hill e-book.pdf");
  // a PDF that says nothing about its kind still fits when it is the only one
  assert.equal(byPath(res, "P/Iron Bell/iron bell ebook.sla").pdfPath, "Printer/Iron Bell.pdf");
});

test("port: Greek names, accents and case do not count", () => {
  const res = planOf(["Βιβλία/Το Φεγγάρι/το φεγγάρι σώμα.sla", "Τυπογραφείο/ΤΟ ΦΕΓΓΑΡΙ ΣΩΜΑ.pdf", "Τυπογραφείο/Το Φεγγάρι εξώφυλλο.pdf"]);
  assert.equal(res.books[0].pdfPath, "Τυπογραφείο/ΤΟ ΦΕΓΓΑΡΙ ΣΩΜΑ.pdf");
  assert.deepEqual(P.words("Τό Φεγγάρι e-book 2"), ["φεγγαρι", "ebook", "2"]);
});

test("port: a book's pictures are its folder's and the folders under it", () => {
  const res = planOf(SHELF);
  const b = byPath(res, "Books/Finished/Sea Garden/sea garden body.sla");
  assert.deepEqual(b.pics.map((f) => f.webkitRelativePath).sort(), [
    "Books/Finished/Sea Garden/images/sub/shell.png", "Books/Finished/Sea Garden/images/wave.jpg"
  ]);
  assert.equal(byPath(res, "Books/Finished/Night Owls/night owls.idml").pics.length, 1);
  assert.equal(byPath(res, "Books/Finished/Stone Road/stone road.sla.gz").pics.length, 0);
});

test("port: names show the folder and the file", () => {
  const res = planOf(SHELF);
  assert.equal(byPath(res, "Books/Finished/Night Owls/night owls.idml").name, "Night Owls · night owls");
  assert.equal(planOf(["solo.sla"]).books[0].name, "solo");
});

test("port: over the limit, the rest is counted, not planned", () => {
  const paths = [];
  for (let i = 0; i < P.MAX_BOOKS + 3; i++) paths.push(`B/book${i}.sla`);
  const res = planOf(paths);
  assert.equal(res.books.length, P.MAX_BOOKS);
  assert.equal(res.more, 3);
  assert.deepEqual(P.plan(null), { books: [], pdfs: 0, pictures: 0, more: 0 });
});

test("port: a book's numbers (mean, pages over 2 %, worst page)", () => {
  assert.deepEqual(P.scoreOf([]), { mean: null, over: 0, worst: null, worstPct: null });
  assert.deepEqual(P.scoreOf([{ page: 1, pct: 0.5 }, { page: 2, pct: 4.24 }, { page: 3, pct: 2.1 }]),
    { mean: 2.3, over: 2, worst: 2, worstPct: 4.24 });
});

test("port: CSV with a byte-order mark, quoting and no formulas", () => {
  const s = P.csv([["Book", "Mean %"], ["Sea, \"Garden\"", 1.5], ["=1+1", null], ["Φεγγάρι\nδύο", -3]]);
  assert.equal(s.charCodeAt(0), 0xfeff);
  assert.equal(s.slice(1), "Book,Mean %\r\n\"Sea, \"\"Garden\"\"\",1.5\r\n'=1+1,\r\n\"Φεγγάρι\nδύο\",'-3\r\n");
});

test("port: the page shift with the fewest differing pixels wins, ties go to 0", () => {
  assert.equal(RB.bestShift({ "-1": [9, 9, 9], 0: [5, 6, 5], 1: [1, 1, 2], 2: [7, 7, 7] }, 3), 1);
  assert.equal(RB.bestShift({ "-1": [2, 2], 0: [2, 2], 1: [2, 2] }, 2), 0);
  assert.equal(RB.bestShift({ 0: [5, 5, 5], 3: [0] }, 3), 0); // tried on one page only
  assert.equal(RB.bestShift({}, 3), 0);
  assert.equal(RB.bestShift({ "-2": [1, 1], 2: [1, 1] }, 2), -2);
});
