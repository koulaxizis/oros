// ============================================================
// orOS — LIVE-TEXT: copy text from a picture (ocrkit.js, ocrkit-ui.js)
// Tesseract itself runs only in the browser (checked in Chromium);
// these tests feed ocrkit.js what Tesseract returns.
// ============================================================
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const K = require(path.join(ROOT, "ocrkit.js"));

const W = (text, x0, y0, x1, y1, confidence) => ({ text, confidence: confidence == null ? 90 : confidence, bbox: { x0, y0, x1, y1 } });
// two paragraphs: "Καλη-" / "μέρα φίλε" and "Call 210 1234567"
const DATA = { blocks: [{ paragraphs: [
  { lines: [{ words: [W("Καλη-", 10, 10, 60, 30)] }, { words: [W("μέρα", 10, 40, 50, 60), W("φίλε", 60, 40, 100, 60), W("~", 0, 0, 2, 2, 12)] }] },
  { lines: [{ words: [W("Call", 10, 100, 40, 120), W("210", 45, 100, 70, 120), W("1234567", 75, 100, 150, 120)] }] }
] }] };

test("wordsOf: reading order, fractions, line and paragraph numbers, low confidence dropped", () => {
  const w = K.wordsOf(DATA, 200, 200);
  assert.deepEqual(w.map((x) => x.t), ["Καλη-", "μέρα", "φίλε", "Call", "210", "1234567"]);
  assert.deepEqual(w.map((x) => x.ln), [0, 1, 1, 2, 2, 2]);
  assert.deepEqual(w.map((x) => x.pa), [0, 0, 0, 1, 1, 1]);
  assert.deepEqual([w[1].x, w[1].y, w[1].w, w[1].h], [0.05, 0.2, 0.2, 0.1]);
});

test("wordsOf: bad input gives no words; control characters and micro sign cleaned", () => {
  assert.deepEqual(K.wordsOf(null, 10, 10), []);
  assert.deepEqual(K.wordsOf({ blocks: [{ paragraphs: [{ lines: [{ words: [W("x", 5, 5, 5, 9)] }] }] }] }, 10, 10), []);
  const w = K.wordsOf({ blocks: [{ paragraphs: [{ lines: [{ words: [W("\u0007µήλο", 0, 0, 5, 5)] }] }] }] }, 10, 10);
  assert.equal(w[0].t, "μήλο");
});

test("textOf: lines, paragraphs and a word broken at the line end", () => {
  const w = K.wordsOf(DATA, 200, 200);
  assert.equal(K.textOf(w), "Καλημέρα φίλε\n\nCall 210 1234567");
  assert.equal(K.textOf(w, [5, 4, 4]), "210 1234567");
  assert.equal(K.textOf(w, [0]), "Καλη-");
  assert.equal(K.textOf(w, [2, 3]), "φίλε\n\nCall");
  assert.equal(K.textOf([], null), "");
  // a capital after the hyphen is not a broken word
  const v = [{ t: "orOS-", ln: 0, pa: 0 }, { t: "Drive", ln: 1, pa: 0 }];
  assert.equal(K.textOf(v), "orOS-\nDrive");
});

test("between, lineOf, paraOf, inRect, nearest", () => {
  const w = K.wordsOf(DATA, 200, 200);
  assert.deepEqual(K.between(w, 4, 1), [1, 2, 3, 4]);
  assert.deepEqual(K.between(w, 9, 9), [5]);
  assert.deepEqual(K.between([], 0, 1), []);
  assert.deepEqual(K.lineOf(w, 1), [1, 2]);
  assert.deepEqual(K.paraOf(w, 4), [3, 4, 5]);
  assert.deepEqual(K.lineOf(w, 40), []);
  assert.deepEqual(K.inRect(w, { x: 0, y: 0.18, w: 0.6, h: 0.15 }), [1, 2]);
  assert.deepEqual(K.inRect(w, { x: 0.6, y: 0.33, w: -0.6, h: -0.15 }), [1, 2]);   // dragged up and left
  assert.deepEqual(K.inRect(w, { x: 0.9, y: 0.9, w: 0.05, h: 0.05 }), []);
  assert.equal(K.nearest(w, 0.15, 0.25), 1);
  assert.equal(K.nearest(w, 0.27, 0.21), 1);
  assert.equal(K.nearest(w, 0.99, 0.55), 5);
  assert.equal(K.nearest([], 0.5, 0.5), -1);
});

test("fit: long side at SIDE, small pictures at most twice", () => {
  assert.equal(K.fit(4800, 1200), 0.5);
  assert.equal(K.fit(300, 200), 2);
  assert.equal(K.fit(0, 0), 1);
  assert.equal(K.SIDE, 2400);
  assert.equal(K.MIN_CONF, 35);
});

test("one engine and one yes: the same files, cache and flag as Scanner & PDF and Documents", () => {
  const kit = read("ocrkit.js"), docs = read("files/docs.js"), dr = read("files/docs-read.js");
  assert.match(kit, /cachePath: CACHE/);
  assert.match(kit, /var CACHE = "oros-scanpdf-ocr"/);
  assert.match(dr, /OCR_CACHE = "oros-scanpdf-ocr"/);
  assert.equal(K.FLAG, "oros-files-docs-ocr");
  assert.match(docs, /OCR_FLAG = "oros-files-docs-ocr"/);
  assert.match(kit, /\{ text: true, blocks: true \}/);
  for (const f of ["tesseract.min.js", "worker.min.js", "tesseract-core-lstm.js", "ell.traineddata.gz", "eng.traineddata.gz"]) {
    assert.ok(fs.existsSync(path.join(ROOT, "vendor/tesseract", f)), f);
  }
});

test("the Text mode writes nothing found as HTML, and every string is in EN, EL and DE", () => {
  const ui = read("ocrkit-ui.js");
  assert.doesNotMatch(ui, /innerHTML\s*=\s*(?!""\s*;)\S/);
  assert.doesNotMatch(ui, /insertAdjacentHTML|outerHTML|eval\(|new Function/);
  global.window = undefined;
  const src = ui.match(/var STR = (\{[\s\S]*?\n  \});/)[1];
  const STR = Function("return " + src)();
  const keys = Object.keys(STR.en).sort();
  assert.deepEqual(Object.keys(STR.el).sort(), keys);
  assert.deepEqual(Object.keys(STR.de).sort(), keys);
  keys.forEach((k) => ["en", "el", "de"].forEach((l) => assert.ok(STR[l][k].trim(), l + " " + k)));
});

test("Files loads the kit only on the Text press, never in its page", () => {
  const html = read("files/index.html"), js = read("files/files.js"), ph = read("files/photos.js");
  assert.doesNotMatch(html, /ocrkit/);
  assert.match(js, /"\.\.\/ocrkit\.js"/);
  assert.match(js, /injectTextButton\(path, name\)/);
  assert.match(js, /ocr: ocrKit/);
  assert.match(ph, /ctx\.ocr\(\)/);
  ["pv.text", "pv.textTip", "pv.textFail"].forEach((k) => assert.match(read("i18n/de/files.js"), new RegExp('"' + k.replace(".", "\\.") + '"')));
  assert.match(read("i18n/de/files.js"), /"ph\.text"/);
});

test("Capture and Photo Lab: Text loads the kit on use; strings in EN, EL and DE", () => {
  const cap = read("capture/app.js"), capHtml = read("capture/index.html");
  assert.match(capHtml, /id="b-text"[^>]*data-i18n="btn\.text"/);
  assert.doesNotMatch(capHtml, /ocrkit/);
  assert.match(cap, /"\.\.\/ocrkit\.js"/);
  assert.match(cap, /region: region/);
  ["btn.text", "err.text"].forEach((k) => {
    assert.equal((cap.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k);
    assert.match(read("i18n/de/capture.js"), new RegExp('"' + k.replace(".", "\\.") + '"'));
  });
  const pan = read("photolab/panels.js"), str = read("photolab/strings.js");
  assert.match(pan, /\{ id: "ocrText", run: copyTextOfPicture, on: has \}/);
  assert.match(pan, /K\.open\(\{ canvas: c/);
  assert.doesNotMatch(read("photolab/index.html"), /ocrkit/);
  ["menu.ocrText", "msg.ocrFail"].forEach((k) => {
    assert.equal((str.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k);
    assert.match(read("i18n/de/photolab.js"), new RegExp('"' + k.replace(".", "\\.") + '"'));
  });
  const ui = read("ocrkit-ui.js");
  assert.match(ui, /o\.region/);
  assert.match(ui, /if \(stage && e\.key !== "Escape"\) e\.stopPropagation\(\)/);
});
