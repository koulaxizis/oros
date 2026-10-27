// ============================================================
// orOS Writer — convert.js: other documents → .orosdoc (Converter)
// OrosConvert.writer turns .docx .odt .rtf .html .htm .md .markdown
// .txt .pdf into the same .orosdoc that Writer makes with Open, then
// "Save as orOS file": the same parsers and the same bundle code
// (writer/io.js, shared with writer.js), and the same steps between
// them (a new document with Writer's defaults, the editor's
// serialisation, footnotes numbered). Only the ids and the dates
// are new, as they are in Writer.
// Loading this file boots nothing: no DOM, no storage, no UI. The
// Converter loads `deps` first (bundle.js, track.js, io.js);
// convert() needs a browser (DOMParser, DecompressionStream).
// UMD: window.OrosConvert.writer in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var FROM = [".docx", ".odt", ".rtf", ".html", ".htm", ".md", ".markdown", ".txt", ".pdf"];
  var MAX = 100 * 1024 * 1024;     // bigger files are refused ("toobig")
  var MIME = "application/x-oros-doc";

  var TEXT = {
    en: {
      untitled: "Untitled",
      pictures: "{n} picture(s) in the file are not kept: Writer does not open pictures from DOCX or ODT files.",
      rtf: "RTF: tables come as plain text and pictures are not kept.",
      pdf: "PDF: the text, headings, bold and italic, alignment and lists are kept; pictures and tables are not. Check the result against the PDF.",
      linked: "{n} picture(s) are linked from the web and stay links: they are not stored in the file.",
      empty: "The file has no text."
    },
    el: {
      untitled: "Χωρίς τίτλο",
      pictures: "{n} εικόνα(-ες) του αρχείου δεν κρατιούνται: ο Επεξεργαστής δεν ανοίγει εικόνες από αρχεία DOCX ή ODT.",
      rtf: "RTF: οι πίνακες έρχονται ως απλό κείμενο και οι εικόνες δεν κρατιούνται.",
      pdf: "PDF: κρατιούνται το κείμενο, οι επικεφαλίδες, τα έντονα και τα πλάγια, η στοίχιση και οι λίστες· οι εικόνες και οι πίνακες όχι. Έλεγξε το αποτέλεσμα με το PDF.",
      linked: "{n} εικόνα(-ες) είναι σύνδεσμοι στο διαδίκτυο και μένουν σύνδεσμοι: δεν αποθηκεύονται στο αρχείο.",
      empty: "Το αρχείο δεν έχει κείμενο."
    }
  };

  function fail(code, msg) {
    var e = new Error(msg || code);
    e.code = code;
    return e;
  }

  function io() {
    if (root.WriterIO) return root.WriterIO;
    if (typeof require === "function") { try { return require("./io.js"); } catch (e) {} }
    return null;
  }

  function extOf(name) {
    var m = /\.([^.\/\\]+)$/.exec(String(name || ""));
    return m ? "." + m[1].toLowerCase() : "";
  }

  // Same id shape as Writer's uid()
  function uid() {
    return "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // The file name: the source's own name, cleaned the way Writer cleans
  // a title for a file name (ioBaseName).
  function outName(name, untitled) {
    var base = String(name || "").replace(/^.*[\/\\]/, "").replace(/\.[^.]+$/, "");
    base = base.replace(/[\\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120);
    return (base || untitled) + ".orosdoc";
  }

  function readBuf(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(new Error("read fail")); };
      fr.readAsArrayBuffer(file);
    });
  }

  // Writer reads text files with FileReader.readAsText (UTF-8, a BOM
  // decides otherwise); do the same.
  function readText(file) {
    if (typeof FileReader === "undefined") return file.text();
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(new Error("read fail")); };
      fr.readAsText(file);
    });
  }

  // Names in a ZIP's central directory (no inflating): to count the
  // pictures a DOCX / ODT carries.
  function zipNames(buf) {
    var u8 = new Uint8Array(buf), dv = new DataView(buf), eocd = -1, out = [];
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return out;
    var count = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true);
    for (var n = 0; n < count && p + 46 <= u8.length; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      out.push(new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl)));
      p += 46 + nl + xl + cl;
    }
    return out;
  }

  // Writer's Open, mode "new" (ioApplyImport → createDoc → renderEditor):
  // the payload becomes a fresh document with Writer's defaults; the
  // editor's serialisation is adopted and footnotes are numbered 1…n.
  function openAsNew(W, parsed) {
    var prep = W.prepareImport(parsed);
    var now = Date.now();
    var doc = {
      id: uid(),
      title: (parsed.title || "").trim() || "",
      author: "",
      tags: [],
      category: "",
      html: prep.html || "",
      footnotes: [],
      comments: [],
      versions: [],
      pageSize: "a4",
      margins: { top: 25, bottom: 25, left: 25, right: 25 },
      header: "", footer: "",
      goal: null,
      mtime: now,
      del: false,
      fm: null
    };
    doc.fm = { c: now, m: now, p: now, g: now };
    doc.footnotes = prep.footnotes;
    doc.comments = prep.comments;
    if (parsed.author) doc.author = parsed.author;
    if (parsed.category) doc.category = parsed.category;
    if (Array.isArray(parsed.tags) && parsed.tags.length) doc.tags = parsed.tags.slice();
    // renderEditor: editor.innerHTML = doc.html, renumberFootnotes(),
    // then doc.html = the editor's own serialisation
    var ed = W.inertDiv();
    ed.innerHTML = doc.html;
    Array.prototype.forEach.call(ed.querySelectorAll("sup.fn-ref"), function (ref, i) {
      var n = String(i + 1);
      if (ref.textContent !== n) ref.textContent = n;
    });
    doc.html = ed.innerHTML;
    return doc;
  }

  // "Save as orOS file" (ioExportOrosDoc): content.json + the standalone
  // page, tracked changes shown accepted in the page (ioExportClone).
  function saveAsBundle(W, doc, lang, untitled) {
    var obj = W.docContent(doc);
    var html = doc.html;
    if (root.WriterTrack && root.WriterTrack.hasChanges(html)) html = root.WriterTrack.resolveHtml(html, "accept");
    var page = W.standaloneHtml(doc, W.cloneOf(html), lang, untitled);
    return W.writeBundle(obj, doc, page, lang);
  }

  function convert(file, opts) {
    opts = opts || {};
    // Any language code; a pack language (orosI18n, ../i18n.js) reads the
    // "writer" pack when it is loaded, else English. The page and bundle
    // keep "el" / "en".
    var code = typeof opts.lang === "string" ? opts.lang : "en";
    if (!TEXT[code] && root.orosI18n) root.orosI18n.table(TEXT, "writer", code);
    var L = TEXT[code] || TEXT.en;
    var lang = code === "el" ? "el" : "en";
    var progress = function (v) { if (typeof opts.onProgress === "function") { try { opts.onProgress(v); } catch (e) {} } };
    var warnings = [];
    return Promise.resolve().then(function () {
      if (!file || typeof file.size !== "number") throw fail("bad", "no file");
      var ext = extOf(file.name);
      if (FROM.indexOf(ext) === -1) throw fail("unsupported", "unsupported: " + (ext || file.name));
      if (file.size > MAX) throw fail("toobig", "file too big");
      var W = io();
      if (!W || typeof DOMParser === "undefined" || !root.OrosBundle) throw fail("bad", "needs a browser with bundle.js and writer/io.js");
      var x = ext.slice(1);
      progress(0);
      var parse;
      if (x === "pdf") {
        parse = readBuf(file).then(function (buf) {
          progress(0.2);
          if (!root.WriterPdfIn) throw new Error("pdfin.js is not loaded");
          warnings.push(L.pdf);
          return root.WriterPdfIn.open(buf);
        });
      } else if (x === "docx" || x === "odt") {
        parse = readBuf(file).then(function (buf) {
          progress(0.2);
          var pics = zipNames(buf).filter(function (n) {
            return x === "docx" ? /^word\/media\/./.test(n) : /^Pictures\/./.test(n);
          }).length;
          if (pics) warnings.push(L.pictures.replace("{n}", String(pics)));
          return W.parseZipBuf(buf, x);
        });
      } else {
        parse = readText(file).then(function (text) {
          progress(0.2);
          if (x === "rtf") warnings.push(L.rtf);
          return W.parseTextOf(text, x);
        });
      }
      return parse.then(null, function (e) {
        throw fail("bad", "unreadable: " + (e && e.message || e));
      }).then(function (parsed) {
        progress(0.5);
        var doc = openAsNew(W, parsed);
        var box = W.inertDiv();
        box.innerHTML = doc.html;
        if (!box.textContent.trim() && !box.querySelector("img,table,hr")) warnings.push(L.empty);
        var linked = Array.prototype.filter.call(box.querySelectorAll("img"), function (im) {
          return /^(https?:)?\/\//i.test(im.getAttribute("src") || "");
        }).length;
        if (linked) warnings.push(L.linked.replace("{n}", String(linked)));
        return saveAsBundle(W, doc, lang, L.untitled);
      }).then(function (bytes) {
        progress(1);
        return { blob: new Blob([bytes], { type: MIME }), name: outName(file.name, L.untitled), warnings: warnings };
      });
    });
  }

  var api = {
    app: "writer", to: ".orosdoc", mime: MIME,
    from: FROM.slice(),
    deps: ["bundle.js", "writer/track.js", "writer/io.js", "writer/pdfin.js"],
    maxSize: MAX,
    convert: convert
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.OrosConvert = root.OrosConvert || {};
    root.OrosConvert.writer = api;
  }
})(typeof window !== "undefined" ? window : this);
