// AS-OCR (Assistant wave 5, Chris 2026-11-28): the text of pictures and
// scans on the orOS disk for the Assistant and its routines. files_read
// reads scanned pages of a PDF (a whole scan or a mixed PDF) on the
// device, pictures that are in the cloud only, and attached PDFs again.
// Run: node --test tests/assistant-ocr.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../assistant/core.js");
const SRC = fs.readFileSync(path.join(__dirname, "../assistant/assistant.js"), "utf8");

test("ocrPlan: a whole scan reads its first pages", () => {
  assert.deepEqual(C.ocrPlan([0, 3, 0, 0, 0, 0, 0], [true, true, true, true, true, true, true], 5), { pages: [0, 1, 2, 3, 4], left: 2 });
  // no picture found (old PDF.js, odd PDF): a whole scan is still read
  assert.deepEqual(C.ocrPlan([0, 0], [false, false], 5), { pages: [0, 1], left: 0 });
  assert.deepEqual(C.ocrPlan([0, 0, 0], [], 15), { pages: [0, 1, 2], left: 0 });
});

test("ocrPlan: a mixed PDF reads only its scanned pages, never a blank or title page", () => {
  const lens = [900, 4, 800, 0, 12, 700];
  const pics = [false, true, false, false, true, true];
  assert.deepEqual(C.ocrPlan(lens, pics, 5), { pages: [1, 4], left: 0 });
  assert.deepEqual(C.ocrPlan(lens, pics, 1), { pages: [1], left: 1 });
  // a page with enough text of its own is never read again, picture or not
  assert.deepEqual(C.ocrPlan([30, C.OCR_PAGE_MIN, C.OCR_PAGE_MIN - 1], [true, true, true], 5), { pages: [2], left: 0 });
  // a text PDF: nothing, so Tesseract is never loaded
  assert.deepEqual(C.ocrPlan([500, 0, 600], [false, false, false], 5), { pages: [], left: 0 });
  assert.deepEqual(C.ocrPlan(null, null, 5), { pages: [], left: 0 });
  assert.deepEqual(C.ocrPlan([0], [true], -3), { pages: [], left: 1 });
});

test("files_read: PDFs read scanned pages (ocr true: up to 15), pictures in the cloud only are fetched", () => {
  assert.match(SRC, /READ_PAGES = 40, OCR_PAGES = 5, OCR_PAGES_MORE = 15;/);
  assert.ok(SRC.includes("}), pics, opts && opts.ocr ? OCR_PAGES_MORE : OCR_PAGES);"), "the plan gets the pictures and the page cap");
  assert.match(SRC, /page\.getOperatorList\(\)/);
  assert.equal((SRC.match(/pdfBytesText\(bytes, null, \{ ocr: a\.ocr === true \}\)/g) || []).length, 2, "files_read and local:");
  assert.match(SRC, /kind === "image" && \(!st\.cloud \|\| \(st\.size \|\| 0\) <= PIC_CLOUD_MAX\)/);
  assert.match(SRC, /PIC_CLOUD_MAX = 60 \* 1024 \* 1024/);
  const t = C.TOOL_FILES_READ || C.toolsFor({ files: true }).find((x) => x.name === "files_read");
  assert.ok(t, "files_read schema");
  assert.match(t.params.properties.ocr.description, /A PDF: read up to 15 scanned pages/);
});

test("attached PDFs are read again (the reader lost in 9.00.00)", () => {
  assert.match(SRC, /function pdfAttText\(a, onProgress\) \{ return pdfBytesText\(b64Bytes\(attMem\[a\.id\]\), onProgress\); \}/);
  assert.match(SRC, /fn = k === "pdf" \? pdfAttText : k === "doc" \? docText : photoText/);
  // the Layout report helper keeps its own name and one argument
  assert.match(SRC, /function pdfText\(rep\) \{/);
  assert.doesNotMatch(SRC, /fn = k === "pdf" \? pdfText\b/);
});

test("routines may read pictures and scans (files_read is a read tool)", () => {
  assert.match(SRC, /files_list: 1, files_read: 1,/);
});
