// ============================================================
// orOS Files — docs-read.js: reading a document's text
// (Documents wave W2, DOCS-1). Loaded by docs.js on first use.
// ------------------------------------------------------------
// read(path, opts) -> Promise<{ text, src, pages, needOcr }>
//   src "txt"  plain text files (txt, md, csv, json, xml, html…)
//       "pdf"  the PDF's own text (PDF.js, through ctx.pdfOpen)
//       "ocr"  on-device text recognition: Tesseract.js, vendored in
//              vendor/tesseract/ with English and Greek, the same
//              engine and download cache as Scanner & PDF. Nothing
//              leaves the device.
//   opts { fs, pdfOpen, ocr: true when recognition may run, job:
//          { stop } (set stop to end early), onStep(kind, i, n) }
//   needOcr: a picture, or a PDF with almost no text of its own, that
//   was not recognised because opts.ocr was false.
// release() ends the recognition worker (also after 90 s idle).
// ============================================================
(function () {
  "use strict";

  var OCR_BASE = "../vendor/tesseract/";
  var OCR_CACHE = "oros-scanpdf-ocr";           // shared with Scanner & PDF: one download
  var TEXT_EXT = ["txt", "md", "markdown", "csv", "tsv", "json", "xml", "html", "htm", "log", "ini", "yaml", "yml", "rtf"];
  var IMG_EXT = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"];
  var PDF_PAGES = 60;                           // pages whose own text is read
  var OCR_PAGES = 10;                           // pages recognised at most
  var OCR_SIDE = 2400;                          // pixels on the long side for recognition
  var MAX_BYTES = 80 * 1048576;
  var MIN_PER_PAGE = 25;                        // fewer characters: a scan, not a text PDF

  function extOf(p) { var i = p.lastIndexOf("."); return i > 0 ? p.slice(i + 1).toLowerCase() : ""; }
  function err(code) { var e = new Error(code); e.code = code; return e; }
  function stopped(o) { return !!(o.job && o.job.stop); }
  function step(o, kind, i, n) { if (o.onStep) try { o.onStep(kind, i, n); } catch (e) {} }

  // ---------- the recognition engine ----------
  var engineP = null, worker = null, workerP = null, idleT = 0;
  function engine() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (engineP) return engineP;
    engineP = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = OCR_BASE + "tesseract.min.js";
      s.onload = function () { window.Tesseract ? res(window.Tesseract) : rej(err("ocr")); };
      s.onerror = function () { s.remove(); engineP = null; rej(err("offline")); };
      document.head.appendChild(s);
    });
    return engineP;
  }
  function getWorker() {
    clearTimeout(idleT);
    if (worker) return Promise.resolve(worker);
    if (workerP) return workerP;
    var base = new URL(OCR_BASE, location.href).href;
    workerP = engine().then(function (T) {
      return T.createWorker(["ell", "eng"], 1, {
        workerPath: base + "worker.min.js",
        corePath: base + "tesseract-core-lstm.js",
        langPath: base.replace(/\/$/, ""),
        workerBlobURL: false,
        cachePath: OCR_CACHE
      });
    }).then(function (w) { worker = w; workerP = null; return w; }, function (e) { workerP = null; throw e && e.code ? e : err("ocr"); });
    return workerP;
  }
  function idle() {
    clearTimeout(idleT);
    idleT = setTimeout(release, 90000);
  }
  function release() {
    clearTimeout(idleT);
    var w = worker;
    worker = null;
    if (w) try { w.terminate(); } catch (e) {}
  }
  function recognise(canvas) {
    return getWorker().then(function (w) { return w.recognize(canvas); }).then(function (r) {
      idle();
      return String((r && r.data && r.data.text) || "");
    });
  }

  // A canvas of a picture, white behind it, about OCR_SIDE pixels long.
  function pictureCanvas(blob) {
    if (typeof createImageBitmap !== "function") return Promise.reject(err("kind"));
    return createImageBitmap(blob).then(function (bmp) {
      var k = Math.min(2, OCR_SIDE / Math.max(bmp.width, bmp.height));
      var cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(bmp.width * k));
      cv.height = Math.max(1, Math.round(bmp.height * k));
      var x = cv.getContext("2d");
      x.fillStyle = "#fff"; x.fillRect(0, 0, cv.width, cv.height);
      x.drawImage(bmp, 0, 0, cv.width, cv.height);
      try { bmp.close(); } catch (e) {}
      return cv;
    }, function () { throw err("kind"); });
  }
  function pageCanvas(page) {
    var v = page.getViewport({ scale: 1 });
    var k = Math.min(4, OCR_SIDE / Math.max(v.width, v.height));
    var vp = page.getViewport({ scale: k });
    var cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(vp.width));
    cv.height = Math.max(1, Math.round(vp.height));
    var x = cv.getContext("2d");
    x.fillStyle = "#fff"; x.fillRect(0, 0, cv.width, cv.height);
    return page.render({ canvasContext: x, viewport: vp }).promise.then(function () { return cv; });
  }

  // ---------- kinds ----------
  function stripHtml(s) {
    return s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  }
  function readPdf(blob, o) {
    if (typeof o.pdfOpen !== "function") return Promise.reject(err("kind"));
    return blob.arrayBuffer().then(function (buf) { return o.pdfOpen(new Uint8Array(buf)); }).then(function (doc) {
      var n = Math.min(doc.numPages, PDF_PAGES), parts = [], chain = Promise.resolve();
      for (var i = 1; i <= n; i++) (function (k) {
        chain = chain.then(function () {
          if (stopped(o)) return;
          step(o, "pdf", k, n);
          return doc.getPage(k).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
            parts.push((tc.items || []).map(function (it) { return (it.str || "") + (it.hasEOL ? "\n" : " "); }).join(""));
          }, function () { parts.push(""); });
        });
      })(i);
      return chain.then(function () {
        var own = parts.join("\n\n");
        var thin = own.replace(/\s+/g, "").length < MIN_PER_PAGE * Math.max(1, n);
        if (!thin || stopped(o)) return finish(doc, { text: own, src: "pdf", pages: doc.numPages, needOcr: false });
        if (!o.ocr) return finish(doc, { text: own, src: "pdf", pages: doc.numPages, needOcr: true });
        var m = Math.min(doc.numPages, OCR_PAGES), read = [], c2 = Promise.resolve();
        for (var j = 1; j <= m; j++) (function (k) {
          c2 = c2.then(function () {
            if (stopped(o)) return;
            step(o, "ocr", k, m);
            return doc.getPage(k).then(pageCanvas).then(recognise).then(function (t) { read.push(t); });
          });
        })(j);
        return c2.then(function () {
          return finish(doc, { text: read.join("\n\n"), src: "ocr", pages: doc.numPages, needOcr: false });
        }, function (e) { finish(doc, null); throw e; });
      });
    });
  }
  function finish(doc, r) { try { doc.destroy(); } catch (e) {} return r; }

  function read(path, o) {
    o = o || {};
    var fs = o.fs, ext = extOf(path);
    if (!fs) return Promise.reject(err("fs"));
    var kind = TEXT_EXT.indexOf(ext) !== -1 ? "txt" : ext === "pdf" ? "pdf" : IMG_EXT.indexOf(ext) !== -1 ? "img" : "";
    if (!kind) return Promise.reject(err("kind"));
    return fs.stat(path).then(function (st) {
      if (!st || st.dir) throw err("gone");
      if ((st.size || 0) > MAX_BYTES) throw err("big");
      return fs.read(path);
    }, function () { throw err("gone"); }).then(function (blob) {
      if (kind === "txt") {
        return blob.text().then(function (s) {
          return { text: /^html?$/.test(ext) ? stripHtml(s) : s, src: "txt", pages: 0, needOcr: false };
        });
      }
      if (kind === "pdf") return readPdf(blob, o);
      if (!o.ocr) return { text: "", src: "", pages: 1, needOcr: true };
      step(o, "ocr", 1, 1);
      return pictureCanvas(blob).then(recognise).then(function (t) { return { text: t, src: "ocr", pages: 1, needOcr: false }; });
    });
  }
  function canRead(path) {
    var e = extOf(path);
    return TEXT_EXT.indexOf(e) !== -1 || e === "pdf" || IMG_EXT.indexOf(e) !== -1;
  }

  window.OrosDocsRead = { read: read, canRead: canRead, release: release };
})();
