// ============================================================
// orOS Scanner & PDF — ocr.js: the pure parts of reading text
// ------------------------------------------------------------
// Text recognition itself is Tesseract.js (vendor/tesseract/, run by
// scanpdf.js in its own worker). This file turns what it found into
// an invisible text layer and a search index; no DOM, no storage.
//
// wordsFrom(data, iw, ih) -> { words, text }
//     data: Tesseract's result data with `blocks` (paragraphs ›
//     lines › words, bbox in pixels of the iw × ih picture read).
//     words: [{ t, x, y, w, h, b, s }] as fractions of the picture:
//     box (x, y top-left, w, h), b the baseline (y), s the line's
//     height (the font size the layer uses). text: lines joined by
//     "\n", paragraphs by a blank line.
// record(found, R, Wc, Hc, lang) -> { A, lang, words, text }
//     Words moved from the picture (the page as it showed, turned R
//     clockwise) onto the UNTURNED content box Wc × Hc: centre cx, cy
//     as fractions of it; w, h, b (baseline below the centre), s as
//     fractions of min(Wc, Hc). A = R, so the text turns with the
//     page later, like the additions of wave 2.
// place(rec, box, g, display) -> [{ t, x, y, size, w, A }]
//     Where to draw each word: box = the content box on the unturned
//     page { left, top, w, h } (points, top-left origin); g = { W, H,
//     R, bx, by } of the page (pdfops.geom). x, y is the start of the
//     baseline in PDF space, A its angle (counter-clockwise degrees),
//     w the width the word must fill. display: the page drawn upright
//     with no /Rotate (Compress makes these).
// cleanIndex(raw) / addToIndex(list, entry, now) -> the device-local
//     list of documents saved into Files, for universal search.
// UMD: window.ScanPdfOcr, or module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var C = (typeof module !== "undefined" && module.exports) ? require("./core.js") : root.ScanPdfCore;

  var LANGS = ["ell+eng", "ell", "eng"];
  var MIN_CONF = 35;               // words Tesseract is less sure of are noise on photos
  var MAX_WORDS = 6000;            // on one page
  var MAX_TEXT = 60000;            // characters of one page
  var INDEX_KEY = "oros-scanpdf-index";   // device-local (R10), never synced
  var INDEX_MAX = 100;             // documents
  var INDEX_TEXT = 4000;           // characters kept of each
  var INDEX_BYTES = 300000;        // the whole list, as JSON

  function arr(a) { return Array.isArray(a) ? a : []; }
  function num(n) { n = Number(n); return isFinite(n) ? n : 0; }
  function r5(n) { return Math.round(n * 100000) / 100000; }
  function r2(n) { return Math.round(n * 100) / 100; }

  // Tesseract sometimes reads Greek mu as the micro sign; control
  // characters never belong in the layer.
  var GREEK = /[\u0370-\u03ff\u1f00-\u1fff]/;
  function fixText(s) {
    s = String(s == null ? "" : s);
    if (s.normalize) s = s.normalize("NFC");
    s = s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "").trim();
    if (s.indexOf("\u00b5") !== -1 && GREEK.test(s)) s = s.replace(/\u00b5/g, "\u03bc");
    return s;
  }

  function wordsFrom(data, iw, ih) {
    iw = Math.max(1, num(iw)); ih = Math.max(1, num(ih));
    var words = [], paras = [], size = 0;
    arr(data && data.blocks).forEach(function (bl) {
      arr(bl && bl.paragraphs).forEach(function (pa) {
        var lines = [];
        arr(pa && pa.lines).forEach(function (ln) {
          var list = arr(ln && ln.words).filter(function (w) {
            return w && w.bbox && num(w.confidence) >= MIN_CONF && fixText(w.text);
          });
          if (!list.length) return;
          // the line's height: its tallest word (ascenders + descenders)
          var lh = 0;
          list.forEach(function (w) { lh = Math.max(lh, num(w.bbox.y1) - num(w.bbox.y0)); });
          var base = ln.baseline || null, lw = [];
          list.forEach(function (w) {
            var bb = w.bbox, x0 = num(bb.x0), y0 = num(bb.y0), x1 = num(bb.x1), y1 = num(bb.y1);
            if (x1 <= x0 || y1 <= y0) return;
            var t = fixText(w.text), cx = (x0 + x1) / 2, by = y1;
            if (base && num(base.x1) !== num(base.x0)) {
              by = num(base.y0) + (num(base.y1) - num(base.y0)) * (cx - num(base.x0)) / (num(base.x1) - num(base.x0));
            }
            // a baseline far off the word (a skewed line) falls back to its foot
            if (!(by >= y0 && by <= y1 + (y1 - y0) * 0.6)) by = y1;
            lw.push(t);
            if (words.length < MAX_WORDS && size < MAX_TEXT) {
              words.push({ t: t, x: r5(x0 / iw), y: r5(y0 / ih), w: r5((x1 - x0) / iw), h: r5((y1 - y0) / ih),
                           b: r5(by / ih), s: r5(lh / ih) });
              size += t.length + 1;
            }
          });
          if (lw.length) lines.push(lw.join(" "));
        });
        if (lines.length) paras.push(lines.join("\n"));
      });
    });
    return { words: words, text: paras.join("\n\n").slice(0, MAX_TEXT) };
  }

  function record(found, R, Wc, Hc, lang) {
    R = C.normRot(R);
    Wc = Math.max(1e-6, num(Wc)); Hc = Math.max(1e-6, num(Hc));
    var d = C.dispSize(Wc, Hc, R), S = Math.min(Wc, Hc);
    var words = arr(found && found.words).map(function (w) {
      var dcx = (w.x + w.w / 2) * d[0], dcy = (w.y + w.h / 2) * d[1];
      var u = C.fromDisp(dcx, dcy, Wc, Hc, R);
      return { t: w.t, cx: r5(u[0] / Wc), cy: r5(u[1] / Hc), w: r5(w.w * d[0] / S), h: r5(w.h * d[1] / S),
               b: r5((w.b * d[1] - dcy) / S), s: r5(w.s * d[1] / S) };
    });
    return { A: R, lang: LANGS.indexOf(lang) !== -1 ? lang : LANGS[0], words: words,
             text: String((found && found.text) || "") };
  }

  function place(rec, box, g, display) {
    if (!rec || !Array.isArray(rec.words) || !box || !g) return [];
    var S = Math.min(box.w, box.h), A0 = C.normRot(rec.A), out = [];
    var dh = C.dispSize(g.W, g.H, g.R)[1];
    rec.words.forEach(function (w) {
      if (!w || typeof w.t !== "string" || !w.t) return;
      var px = box.left + num(w.cx) * box.w, py = box.top + num(w.cy) * box.h, X, Y, A;
      if (display) {
        var v = C.toDisp(px, py, g.W, g.H, g.R);
        X = v[0]; Y = dh - v[1]; A = C.normRot(A0 - g.R);
      } else {
        X = g.bx + px; Y = g.by + g.H - py; A = A0;
      }
      var ww = num(w.w) * S, size = Math.max(1, num(w.s) * S);
      var a = C.anchor(X, Y, -ww / 2, -num(w.b) * S, A);
      out.push({ t: w.t, x: a.x, y: a.y, size: r2(size), w: r2(ww), A: A });
    });
    return out;
  }

  // ---------- Search index (documents saved into Files) ----------
  // [{ p: path, n: name, t: text, d: when saved (ms), k: pages }], newest first.
  function cleanEntry(e) {
    if (!e || typeof e !== "object" || typeof e.p !== "string") return null;
    var p = e.p.slice(0, 600);
    if (p.indexOf("/internal/") !== 0) return null;
    return { p: p, n: String(e.n || "").slice(0, 200), t: String(e.t || "").replace(/\s+/g, " ").trim().slice(0, INDEX_TEXT),
             d: Math.max(0, Math.round(num(e.d))), k: Math.max(0, Math.round(num(e.k))) };
  }
  function cleanIndex(raw) {
    var seen = {}, out = [];
    arr(raw).forEach(function (e) {
      var c = cleanEntry(e);
      if (!c || seen[c.p]) return;
      seen[c.p] = true;
      out.push(c);
    });
    return out.slice(0, INDEX_MAX);
  }
  function addToIndex(list, entry, now) {
    var c = cleanEntry(entry);
    var out = cleanIndex(list).filter(function (e) { return !c || e.p !== c.p; });
    if (c) { if (!c.d) c.d = num(now) || Date.now(); out.unshift(c); }
    out = out.slice(0, INDEX_MAX);
    // keep it small: drop the oldest until the list fits
    while (out.length > 1 && JSON.stringify(out).length > INDEX_BYTES) out.pop();
    return out;
  }

  var api = {
    LANGS: LANGS, MIN_CONF: MIN_CONF, MAX_WORDS: MAX_WORDS, INDEX_KEY: INDEX_KEY, INDEX_MAX: INDEX_MAX,
    INDEX_TEXT: INDEX_TEXT, INDEX_BYTES: INDEX_BYTES,
    fixText: fixText, wordsFrom: wordsFrom, record: record, place: place,
    cleanIndex: cleanIndex, addToIndex: addToIndex
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ScanPdfOcr = api;
})(typeof window !== "undefined" ? window : this);
