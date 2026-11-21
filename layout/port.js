// ============================================================
// orOS Layout — Port a folder of books (LY-PORT3, v1.0.0)
// A folder picked from the computer (Home › Open › Port a folder of
// books) holds a publisher's past work: one folder per book with its
// Scribus (.sla, .sla.gz) or InDesign (.idml) files, their pictures and
// often the PDFs that went to the printer or the shop. This plans the
// run (which file, with which pictures and which PDF) and writes its
// report; io.js opens each file as a new document and compares it
// with its PDF (rebuild.js compare / shiftOf).
//   - "body", "print", "e-book", "cover" (and the Greek words) in a
//     name say what kind of file it is: such words are not counted as
//     shared, a different kind costs; words most folders share (the
//     publisher's filing folders) are not counted either.
//   - A book file's pictures are the pictures in its own folder and
//     the folders under it (a Scribus "Collect for output" folder).
//   - Its PDF is the one whose name and folder share the most words
//     with the book file's own name and folder (accents and case do
//     not count; Dice score at least 0.5), and better than every other
//     PDF; a cover and a body, or an e-book and a print file, never
//     take each other's PDF, an e-book and a print file only when
//     nothing fits better. No clear PDF → none (never a guess).
//   - Scribus's backups (.sla.autosave, *~), macOS's "._" files and
//     anything in a "Layout" folder (Layout's own saves) are left out.
// Exposes LY_PORT (browser) or module.exports (Node tests).
// ============================================================
(function (root) {
  "use strict";

  var SRC = /\.(sla(\.gz)?|idml)$/i, PDF = /\.pdf$/i, PIC = /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i;
  var MAX_BOOKS = 500, MAX_PICS = 4000;
  // a cover and a body never take each other's PDF; an e-book file and
  // a print one only when nothing else fits (a shop's PDF is often
  // named after the book alone)
  var COVER = /(^|[^a-z\u03b1-\u03c9])(cover|εξωφυλλο|αναπτυγμα)/, EBOOK = /(^|[^a-z])(ebook|epub)/, PRINT = /(^|[^a-z\u03b1-\u03c9])(body|print|printer|σωμα)/;
  // those words say the kind, not the book: they are not counted as words
  var KIND_WORD = /^(cover|εξωφυλλο|αναπτυγμα|ebook\d*|epub|body|print|printer|σωμα)$/;

  function rel(f) { return String((f && (f.webkitRelativePath || f.relPath)) || (f && f.name) || "").replace(/\\/g, "/").replace(/^\/+/, ""); }
  function dirOf(p) { var i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); }
  function baseOf(p) { return p.slice(p.lastIndexOf("/") + 1); }
  function stem(p) { return baseOf(p).replace(/\.(sla(\.gz)?|idml|pdf)$/i, ""); }
  function plain(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function words(s) {
    return plain(s).replace(/e-book/g, "ebook").split(/[^a-z0-9α-ωа-я]+/).filter(function (w) { return w.length >= 3 || /\d/.test(w); });
  }
  function kindsOf(s) { var p = plain(s).replace(/e-book/g, "ebook"); return { c: COVER.test(p), e: EBOOK.test(p), p: PRINT.test(p) }; }
  // an e-book file and a printer's PDF (or the other way round) cost
  // most; a print file and a PDF that says nothing, a little
  function kindCost(a, b) { return (a.e && b.p) || (a.p && b.e) ? 0.5 : a.p !== b.p ? 0.25 : 0; }
  function skip(p) {
    var b = baseOf(p);
    return /^\._/.test(b) || /~$/.test(b) || /\.autosave$/i.test(b) || /(^|\/)layout(\/|$)/i.test(dirOf(p));
  }

  // files (File list with webkitRelativePath) → { books: [{ path, name,
  // kind "sla" | "idml", file, pics: [File], pdf: File | null,
  // pdfPath }], pdfs, pictures, more (books left out over the limit) }
  function plan(files) {
    var list = Array.prototype.slice.call(files || []).filter(function (f) { return f && !skip(rel(f)); });
    var srcs = list.filter(function (f) { return SRC.test(rel(f)); }).sort(function (a, b) { return rel(a) < rel(b) ? -1 : rel(a) > rel(b) ? 1 : 0; });
    var pdfs = list.filter(function (f) { return PDF.test(rel(f)); }), pics = list.filter(function (f) { return PIC.test(rel(f)); });
    // a file's words: its name and its two folders'; words that most
    // folders share (the publisher's filing: "Finished", "Printer") say
    // nothing about the book and are dropped
    function raw(p) { var d = dirOf(p); return words(baseOf(dirOf(d)) + " " + baseOf(d) + " " + stem(p)); }
    // counted per folder, so a book's own files (body, cover, its PDFs
    // side by side) never make its title look like a filing word
    var df = {}, dirs = {}, nd = 0;
    srcs.concat(pdfs).forEach(function (f) {
      var p = rel(f), d = dirOf(p);
      if (!dirs[d]) { dirs[d] = {}; nd++; }
      raw(p).forEach(function (w) { if (!dirs[d][w]) { dirs[d][w] = 1; df[w] = (df[w] || 0) + 1; } });
    });
    var often = Math.max(3, nd * 0.25);
    function tokens(p) {
      var seen = {}, out = [];
      raw(p).forEach(function (w) { if (df[w] <= often && !seen[w] && !KIND_WORD.test(w)) { seen[w] = 1; out.push(w); } });
      return out;
    }
    var pdfTok = pdfs.map(function (f) { var p = rel(f); return { f: f, p: p, t: tokens(p), k: kindsOf(baseOf(p)) }; });
    var books = srcs.slice(0, MAX_BOOKS).map(function (f) {
      var p = rel(f), d = dirOf(p), t = tokens(p), k = kindsOf(baseOf(p));
      var own = pics.filter(function (q) { var r = rel(q); return d ? r.indexOf(d + "/") === 0 : r.indexOf("/") < 0; }).slice(0, MAX_PICS);
      var best = null, bs = 0, second = 0;
      pdfTok.forEach(function (c) {
        if (c.k.c !== k.c || !t.length) return;
        var hit = 0, set = {};
        c.t.forEach(function (w) { set[w] = 1; });
        t.forEach(function (w) { if (set[w]) hit++; });
        var sc = (c.t.length ? 2 * hit / (t.length + c.t.length) : 0) - kindCost(k, c.k);
        // the same name in the same folder beats everything
        if (stem(c.p).toLowerCase() === stem(p).toLowerCase() && dirOf(c.p) === d) sc += 1;
        if (sc > bs) { second = bs; bs = sc; best = c; } else if (sc > second) second = sc;
      });
      var pdf = best && bs >= 0.5 && bs > second ? best : null;
      var dn = baseOf(d), sn = stem(p);
      return {
        path: p, kind: /\.idml$/i.test(p) ? "idml" : "sla", file: f, pics: own,
        name: (dn && d.indexOf("/") >= 0 ?dn + " · " + sn : sn).slice(0, 120),
        pdf: pdf ? pdf.f : null, pdfPath: pdf ? pdf.p : ""
      };
    });
    return { books: books, pdfs: pdfs.length, pictures: pics.length, more: Math.max(0, srcs.length - MAX_BOOKS) };
  }

  // a book's compare result → its numbers: mean %, pages over 2 %, the
  // page that differs most
  function scoreOf(pages) {
    pages = pages || [];
    if (!pages.length) return { mean: null, over: 0, worst: null, worstPct: null };
    var sum = 0, w = pages[0];
    pages.forEach(function (p) { sum += p.pct; if (p.pct > w.pct) w = p; });
    return { mean: Math.round(sum / pages.length * 10) / 10, over: pages.filter(function (p) { return p.pct > 2; }).length, worst: w.page, worstPct: w.pct };
  }

  // rows (arrays) → CSV text (RFC 4180, a byte-order mark so
  // spreadsheet programs read Greek right)
  function csv(rows) {
    return "﻿" + rows.map(function (r) {
      return r.map(function (v) {
        var s = v === null || v === undefined ? "" : String(v);
        // a cell that a spreadsheet would run as a formula stays text
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return /[",\n\r;]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;
      }).join(",");
    }).join("\r\n") + "\r\n";
  }

  var api = { plan: plan, scoreOf: scoreOf, csv: csv, words: words, MAX_BOOKS: MAX_BOOKS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_PORT = api;
})(typeof window !== "undefined" ? window : this);
