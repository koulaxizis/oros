// Documents wave W2 (DOCS-1): what a document's text suggests
// (files/docs-text.js) and how the text is wired into Files.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const D = require("../files/docs-core.js");
const T = require("../files/docs-text.js");
const TODAY = "2026-11-13";

function withSender(name) {
  return D.ensureCorr(D.norm(null), name, 1000, "x").state;
}

test("clean: NFC, no control characters, capped", () => {
  assert.equal(T.clean("a\u0000b\r\nc\t d\n\n\n\ne"), "ab\nc  d\n\ne");
  assert.equal(T.clean("é"), "é");
  assert.equal(T.clean("x".repeat(50), 10).length, 10);
  assert.equal(T.clean(null), "");
});

test("dates: day first, month first only when it must be, words in three languages", () => {
  const iso = (s) => T.dates(s).map((d) => d.iso);
  assert.deepEqual(iso("12/10/2026"), ["2026-10-12"]);
  assert.deepEqual(iso("12/31/2025"), ["2025-12-31"], "31 cannot be a month");
  assert.deepEqual(iso("2026-02-30 and 31.12.26"), ["2026-12-31"], "an impossible date is no date");
  assert.deepEqual(iso("5 October 2026"), ["2026-10-05"]);
  assert.deepEqual(iso("Oct 5, 2026"), ["2026-10-05"]);
  assert.deepEqual(iso("12 Οκτωβρίου 2026"), ["2026-10-12"]);
  assert.deepEqual(iso("3. März 2026"), ["2026-03-03"]);
});

test("amounts: both decimal styles, currencies, totals", () => {
  const a = T.amounts("Subtotal 1.000,00 EUR Total 1.190,00 EUR and 2,345.67 $");
  assert.deepEqual(a.map((x) => [x.v, x.cur, x.tot]), [[1000, "EUR", false], [1190, "EUR", true], [2345.67, "USD", false]]);
  assert.equal(T.amounts("12.10.2026").length, 0, "a date is not money");
});

test("suggest: a Greek invoice", () => {
  const s = withSender("Power Co");
  const text = "POWER CO S.A.\nΤΙΜΟΛΟΓΙΟ\n" +
    "Ημερομηνία έκδοσης: 12/10/2026\n" +
    "Μερικό σύνολο 70,00 €\n" +
    "Σύνολο πληρωτέο: 84,20 €\n" +
    "Λήξη 15.11.2026";
  const g = T.suggest(text, s, { today: TODAY, lang: "el" });
  assert.equal(g.ty, "ty-invoice");
  assert.equal(g.co, s.corr[0].id, "a known sender is found by name");
  assert.equal(g.d, "2026-10-12");
  assert.equal(g.ex, "2026-11-15");
  assert.equal(g.amt, 84.2, "the total, not the subtotal");
  assert.equal(g.cur, "EUR");
});

test("suggest: English and German receipts, nothing from nothing", () => {
  const s = D.norm(null);
  assert.deepEqual(T.suggest("Receipt\nDate: Oct 5, 2026\nSubtotal $9.00\nTotal $10.50", s, { today: TODAY }),
    { ty: "ty-receipt", d: "2026-10-05", amt: 10.5, cur: "USD" });
  const de = T.suggest("Rechnung\nRechnungsdatum 3. März 2026\nGesamtbetrag 1.190,00 EUR", s, { today: TODAY });
  assert.equal(de.ty, "ty-invoice");
  assert.equal(de.d, "2026-03-03");
  assert.equal(de.amt, 1190);
  assert.deepEqual(T.suggest("", s, { today: TODAY }), {});
  assert.deepEqual(T.suggest("hello world 12 apples", s, { today: TODAY }), {}, "a plain number is no amount");
  const far = T.suggest("Invoice date 01/01/2099", s, { today: TODAY });
  assert.equal(far.d, undefined, "a date far in the future is not the document date");
});

test("suggest: the person's own types match by name; short words need whole words", () => {
  let s = D.putType(D.norm(null), { id: "ty-zz", n: "Payslip" }, 1000);
  assert.equal(T.suggest("Monthly payslip for October", s, { today: TODAY }).ty, "ty-zz");
  assert.equal(T.suggest("taxi ride", D.norm(null), { today: TODAY }).ty, undefined);
});

test("core: text paths, hidden folders hold no documents, file-time dates are marked", () => {
  assert.equal(D.textPath("d-abc"), "/internal/.docs/text/d-abc.txt");
  assert.equal(D.isDiskPath("/internal/.docs/text/d-abc.txt"), false);
  assert.equal(D.isDiskPath("/internal/.trash/x/a.pdf"), false);
  assert.equal(D.isDiskPath("/internal/Documents/a.pdf"), true);
  const d = D.makeDoc("/internal/a.pdf", { mtime: Date.UTC(2026, 0, 2) }, 1000, "r");
  assert.deepEqual(d.x, { fd: 1 });
  assert.equal(D.makeDoc("/internal/a.pdf", {}, 1000, "r").x, undefined);
});

test("wiring: text reading loads on demand; Files hides .docs; Scanner hands PDFs over", () => {
  const files = read("files/files.js");
  assert.match(files, /HIDDEN_ROOT = \[".trash", ".docs"\]/);
  assert.match(files, /pdfOpen: pdfOpen/);
  assert.match(read("files/search.js"), /e\.name === "\.docs"/);
  const docs = read("files/docs.js");
  assert.match(docs, /"docs-read\.js" \+ verQ\(\)/, "docs-read.js only when a text is read");
  assert.match(docs, /oros-files-docs-inbox/);
  assert.match(docs, /OCR_FLAG = "oros-files-docs-ocr"/);
  assert.ok(!/<script[^>]+docs-read/.test(read("files/index.html")));
  const rd = read("files/docs-read.js");
  assert.match(rd, /cachePath: OCR_CACHE/);
  assert.match(rd, /OCR_BASE = "\.\.\/vendor\/tesseract\/"/, "the vendored engine, no other server");
  const scan = read("scanpdf/scanpdf.js");
  assert.match(scan, /DOCS_INBOX = "oros-files-docs-inbox"/);
  assert.match(scan, /prefs\.docs === "on" && toDocsInbox\(path\)/);
});
