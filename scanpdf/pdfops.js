// ============================================================
// orOS Scanner & PDF — pdfops.js: writing PDFs with pdf-lib
// ------------------------------------------------------------
// load(lib, bytes)            -> Promise<{ doc, pages } | { err }>
//     err: "locked" (encrypted, even with an empty password: its
//     streams can't be copied), "bad" (not a readable PDF).
// build(lib, srcs, pages, prefs, meta) -> Promise<Uint8Array>
//     srcs: { <id>: { kind: "pdf", doc } | { kind: "image",
//             img: { bytes, type "jpg"|"png", w, h }, scan (a
//             scanned page: its own shape, no margin) } }
//     pages: the page list (core.js), in output order, with the
//            additions of each page (p.ov: signatures, text,
//            pictures, shapes, drawings).
//     meta: { title, opts (core.readDocOpts: page numbers,
//            watermark, title, author), font: { fontkit, bytes },
//            ocr: { "<src>:<idx>": ocr.record } (wave 4: text read
//            from the page, drawn under it as an invisible layer, so
//            the PDF can be searched and copied) }.
//            Text is drawn with the font given (Noto Sans: Greek and
//            Latin), embedded as a subset; without it, text fails
//            with code "font".
// geom(lib, srcs, p, prefs) -> { W, H, R, bx, by } of a list page:
//     its unturned size, how it shows turned, and its box origin.
// fromImages(lib, list, meta) -> Promise<Uint8Array>
//     list: [{ bytes (JPEG), w, h (page points), words? }]: one
//     picture per page, the page filled (Compress makes these);
//     words (wordsFor(…, true)) keep the text layer.
// wordsFor(lib, srcs, p, prefs, rec, display) -> where each word of
//     an ocr record goes on that page (ocr.place).
// stamp(lib, bytes, items, meta) -> Promise<Uint8Array> (signature
//     requests, sign-core.js): the PDF itself (not copied page by
//     page), with additions on some of its pages, a certificate page
//     at the end and a file attached. items: [{ pg (0-based), ov:
//     [core additions] }]; meta: { font (as build), cert: { title,
//     rows: [[label, value]], note }, attach: { name, bytes,
//     description, at (ms) } }. Same bytes and items give the same
//     pages, so the sender's copy matches the one the signer kept.
// Pages of a PDF are copied as they are (text, links on the page,
// fonts); bookmarks and forms of the whole file are not carried.
// A picture becomes one page sized by prefs (core.pageFor/fitRect).
// Rotation is set on the page (/Rotate), so nothing is redrawn.
// `lib` is window.PDFLib (vendor/pdf-lib, MIT) or require() in Node.
// UMD: window.ScanPdfOps, or module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module !== "undefined" && module.exports;
  var C = NODE ? require("./core.js") : root.ScanPdfCore;
  var O = NODE ? require("./ocr.js") : root.ScanPdfOcr;
  var PRODUCER = "orOS Scanner & PDF";

  function load(lib, bytes) {
    var data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return lib.PDFDocument.load(data, { updateMetadata: false }).then(function (doc) {
      var n = 0;
      try { n = doc.getPageCount(); } catch (e) { n = 0; }    // no page tree
      return n > 0 ? { doc: doc, pages: n } : { err: "bad" };
    }, function (e) {
      var name = e && (e.name || (e.constructor && e.constructor.name)) || "";
      if (/Encrypt/i.test(name) || /encrypt/i.test(String(e && e.message))) return { err: "locked" };
      return { err: "bad" };
    });
  }

  function codeErr(code) { var e = new Error(code); e.code = code; return e; }

  function geom(lib, srcs, p, prefs) {
    var s = srcs[p.src];
    if (s.kind === "pdf") {
      var pg = s.doc.getPage(p.idx), b = pg.getCropBox();
      return { W: b.width, H: b.height, R: C.normRot(pg.getRotation().angle + (p.rot || 0)), bx: b.x, by: b.y };
    }
    var size = C.pageFor(s.img.w, s.img.h, C.prefsFor(s, prefs));
    return { W: size[0], H: size[1], R: C.normRot(p.rot || 0), bx: 0, by: 0 };
  }
  function geomOf(lib, page, rot) {
    var b = page.getCropBox();
    return { W: b.width, H: b.height, R: C.normRot(rot), bx: b.x, by: b.y };
  }

  function needsFont(pages, opts, ocr) {
    if (opts.num.on || opts.wm.on) return true;
    return pages.some(function (p) {
      return !!recOf(ocr, p) || (p.ov || []).some(function (o) { return o.t === "text"; });
    });
  }
  function recOf(ocr, p) {
    var r = ocr && ocr[p.src + ":" + p.idx];
    return r && Array.isArray(r.words) && r.words.length ? r : null;
  }

  // The part of the unturned page the words were read from: the whole
  // page of a PDF, the picture on a picture page.
  function contentBox(srcs, p, prefs, g) {
    var s = srcs[p.src];
    if (s.kind === "pdf") return { left: 0, top: 0, w: g.W, h: g.H };
    var PP = C.prefsFor(s, prefs), r = C.fitRect(s.img.w, s.img.h, g.W, g.H, PP.margin);
    return { left: r.x, top: g.H - r.y - r.h, w: r.w, h: r.h };
  }
  function wordsFor(lib, srcs, p, prefs, rec, display) {
    if (!rec) return [];
    var g = geom(lib, srcs, p, prefs);
    return O.place(rec, contentBox(srcs, p, prefs, g), g, display);
  }

  // The invisible text layer (render mode 3, as scanners write it):
  // each word stretched (Tz) to the width it covers on the picture.
  function drawWords(lib, page, font, list) {
    if (!list || !list.length) return;
    page.setFont(font);
    var key = page.getFont()[1];
    var ops = [lib.pushGraphicsState(), lib.beginText(), lib.setTextRenderingMode(lib.TextRenderingMode.Invisible)];
    list.forEach(function (w, i) {
      var text = w.t + (i < list.length - 1 ? " " : "");
      var nat = font.widthOfTextAtSize(w.t, w.size);
      var tz = nat > 0 ? Math.min(500, Math.max(20, 100 * w.w / nat)) : 100;
      var a = w.A * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      ops.push(lib.setFontAndSize(key, w.size), lib.setCharacterSqueeze(Math.round(tz * 10) / 10),
               lib.setTextMatrix(c, s, -s, c, w.x, w.y), lib.showText(font.encodeText(text)));
    });
    ops.push(lib.endText(), lib.popGraphicsState());
    page.pushOperators.apply(page, ops);
  }

  // Additions, page number and watermark of one page.
  function decorate(lib, out, page, g, p, i, total, opts, font, images) {
    var S = Math.min(g.W, g.H), d = C.dispSize(g.W, g.H, g.R);
    function centre(px, py) { return [g.bx + px, g.by + g.H - py]; }
    var chain = Promise.resolve();
    (p.ov || []).forEach(function (raw) {
      var o = C.cleanOv(raw);
      if (!o || o.t === "field") return;          // a place to sign: travels beside the PDF
      chain = chain.then(function () {
        var c = centre(o.cx * g.W, o.cy * g.H);
        if (o.t === "img") {
          var ow = o.w * S, oh = o.h * S;
          return image(o.src).then(function (emb) {
            var a = C.anchor(c[0], c[1], -ow / 2, -oh / 2, o.A);
            page.drawImage(emb, { x: a.x, y: a.y, width: ow, height: oh, rotate: lib.degrees(o.A) });
          });
        }
        if (o.t === "shape" || o.t === "ink") { drawParts(lib, page, c, o, S); return; }
        var size = o.fs * S, tw = font.widthOfTextAtSize(o.text, size), col = C.COLORS[o.color];
        if (o.mw && tw > o.mw * S) { size *= o.mw * S / tw; tw = o.mw * S; }
        var a = C.anchor(c[0], c[1], -tw / 2, -C.BASELINE * size, o.A);
        page.drawText(o.text, { x: a.x, y: a.y, size: size, font: font, color: lib.rgb(col[0], col[1], col[2]), rotate: lib.degrees(o.A) });
      });
    });
    return chain.then(function () {
      if (opts.wm.on) {
        var text = opts.wm.text.trim(), ws = C.wmSize(font.widthOfTextAtSize(text, 1), d[0], d[1]);
        var tw = font.widthOfTextAtSize(text, ws), A = C.normRot(g.R) + 45;
        var c = centre(g.W / 2, g.H / 2), a = C.anchor(c[0], c[1], -tw / 2, -C.BASELINE * ws, A);
        page.drawText(text, { x: a.x, y: a.y, size: ws, font: font, color: lib.rgb(0.5, 0.5, 0.5),
                              opacity: C.WM_OP[opts.wm.op], rotate: lib.degrees(A) });
      }
      if (opts.num.on) {
        var ns = C.numSize(S), nt = C.numText(opts, i, total), nw = font.widthOfTextAtSize(nt, ns);
        var dc = C.numCenter(opts.num.pos, d[0], d[1], ns), u = C.fromDisp(dc[0], dc[1], g.W, g.H, g.R);
        var cc = centre(u[0], u[1]), na = C.anchor(cc[0], cc[1], -nw / 2, -C.BASELINE * ns, g.R);
        page.drawText(nt, { x: na.x, y: na.y, size: ns, font: font, color: lib.rgb(0.2, 0.2, 0.2), rotate: lib.degrees(g.R) });
      }
    });
    // One embedded picture per signature or picture, however many
    // pages carry it.
    function image(src) {
      if (!images[src]) {
        var bytes = C.dataUrlBytes(src);
        images[src] = src.indexOf("data:image/jpeg") === 0 ? out.embedJpg(bytes) : out.embedPng(bytes);
      }
      return images[src];
    }
  }

  // A shape or a drawing (core.ovParts) as vector paths around its
  // centre c, turned with it; round ends and corners, as on screen.
  function drawParts(lib, page, c, o, S) {
    page.pushOperators(lib.pushGraphicsState(), lib.setLineJoin(lib.LineJoinStyle.Round));
    C.ovParts(o, S).forEach(function (part) {
      var opt = { x: c[0], y: c[1], rotate: lib.degrees(o.A) };
      if (part.fill) { var f = C.COLORS[part.fill]; opt.color = lib.rgb(f[0], f[1], f[2]); opt.opacity = part.op; }
      if (part.stroke) {
        var k = C.COLORS[part.stroke];
        opt.borderColor = lib.rgb(k[0], k[1], k[2]);
        opt.borderWidth = part.sw;
        opt.borderOpacity = part.op;
        opt.borderLineCap = lib.LineCapStyle.Round;
      }
      page.drawSvgPath(part.d, opt);
    });
    page.pushOperators(lib.popGraphicsState());
  }

  function build(lib, srcs, pages, prefs, meta) {
    var P = C.readPrefs(prefs);
    var opts = C.readDocOpts(meta && meta.opts);
    var ocr = meta && meta.ocr;
    var fontP = null, images = {};
    return lib.PDFDocument.create().then(function (out) {
      // Each PDF source is copied in ONE copyPages call (shared fonts
      // and images are copied once), in the order the list uses them.
      var need = {}, order = [];
      pages.forEach(function (p) {
        var s = srcs[p.src];
        if (!s) throw new Error("source");
        if (s.kind !== "pdf") return;
        if (!need[p.src]) { need[p.src] = []; order.push(p.src); }
        need[p.src].push(p.idx);
      });
      var copied = {}, cursor = {};
      var chain = order.reduce(function (c, id) {
        return c.then(function () {
          return out.copyPages(srcs[id].doc, need[id]).then(function (list) { copied[id] = list; cursor[id] = 0; });
        });
      }, Promise.resolve());
      var embedded = {};
      function embed(id) {
        if (embedded[id]) return embedded[id];
        var img = srcs[id].img;
        embedded[id] = img.type === "jpg" ? out.embedJpg(img.bytes) : out.embedPng(img.bytes);
        return embedded[id];
      }
      if (needsFont(pages, opts, ocr)) {
        var f = meta && meta.font;
        if (!f || !f.fontkit || !f.bytes) throw codeErr("font");
        out.registerFontkit(f.fontkit);
        fontP = out.embedFont(f.bytes, { subset: true });
      }
      return chain.then(function () { return fontP; }).then(function (font) {
        return pages.reduce(function (c, p, i) {
          return c.then(function () {
            var s = srcs[p.src], page;
            if (s.kind === "pdf") {
              page = copied[p.src][cursor[p.src]++];
              out.addPage(page);
              var rot = C.normRot(page.getRotation().angle + (p.rot || 0));
              if (p.rot) page.setRotation(lib.degrees(rot));
              drawWords(lib, page, font, wordsFor(lib, srcs, p, P, recOf(ocr, p), false));
              return decorate(lib, out, page, geomOf(lib, page, rot), p, i, pages.length, opts, font, images);
            }
            return embed(p.src).then(function (emb) {
              var PP = C.prefsFor(s, P), w = s.img.w, h = s.img.h, size = C.pageFor(w, h, PP);
              var r = C.fitRect(w, h, size[0], size[1], PP.margin);
              page = out.addPage(size);
              page.drawImage(emb, { x: r.x, y: r.y, width: r.w, height: r.h });
              if (p.rot) page.setRotation(lib.degrees(C.normRot(p.rot)));
              drawWords(lib, page, font, wordsFor(lib, srcs, p, P, recOf(ocr, p), false));
              return decorate(lib, out, page, geomOf(lib, page, p.rot || 0), p, i, pages.length, opts, font, images);
            });
          });
        }, Promise.resolve());
      }).then(function () {
        var now = new Date();
        var title = opts.title || (meta && meta.title);
        if (title) out.setTitle(String(title).slice(0, 200));
        if (opts.author) out.setAuthor(opts.author);
        out.setProducer(PRODUCER);
        out.setCreator(PRODUCER);
        out.setCreationDate(now);
        out.setModificationDate(now);
        return out.save({ useObjectStreams: true });
      });
    });
  }

  // Compress: one JPEG per page, filling it. The pages come out
  // upright (the pictures were rendered turned), so no /Rotate.
  function fromImages(lib, list, meta) {
    var opts = C.readDocOpts(meta && meta.opts);
    var fontP = null;
    return lib.PDFDocument.create().then(function (out) {
      if (list.some(function (it) { return it.words && it.words.length; })) {
        var f = meta && meta.font;
        if (!f || !f.fontkit || !f.bytes) throw codeErr("font");
        out.registerFontkit(f.fontkit);
        fontP = out.embedFont(f.bytes, { subset: true });
      }
      return Promise.resolve(fontP).then(function (font) {
        return list.reduce(function (c, it) {
          return c.then(function () {
            return out.embedJpg(it.bytes).then(function (emb) {
              var page = out.addPage([it.w, it.h]);
              page.drawImage(emb, { x: 0, y: 0, width: it.w, height: it.h });
              if (font) drawWords(lib, page, font, it.words);
            });
          });
        }, Promise.resolve());
      }).then(function () {
        var now = new Date();
        var title = opts.title || (meta && meta.title);
        if (title) out.setTitle(String(title).slice(0, 200));
        if (opts.author) out.setAuthor(opts.author);
        out.setProducer(PRODUCER);
        out.setCreator(PRODUCER);
        out.setCreationDate(now);
        out.setModificationDate(now);
        return out.save({ useObjectStreams: true });
      });
    });
  }

  // ---------- Signature requests ----------
  var A4 = [595.28, 841.89];
  // Lines of text no wider than w points (words kept whole; a word
  // longer than the line, such as a hash, is cut where it must be).
  function wrap(font, text, size, w) {
    var out = [];
    String(text).split("\n").forEach(function (para) {
      var line = "";
      para.split(/\s+/).filter(Boolean).forEach(function (word) {
        var tryLine = line ? line + " " + word : word;
        if (font.widthOfTextAtSize(tryLine, size) <= w) { line = tryLine; return; }
        if (line) out.push(line);
        line = "";
        while (font.widthOfTextAtSize(word, size) > w && word.length > 1) {
          var n = word.length;
          while (n > 1 && font.widthOfTextAtSize(word.slice(0, n), size) > w) n--;
          out.push(word.slice(0, n));
          word = word.slice(n);
        }
        line = word;
      });
      out.push(line);
    });
    return out;
  }
  // The certificate: a title, then label / value rows, then a note,
  // on as many A4 pages as it needs.
  function certPages(lib, doc, font, cert) {
    var M = 48, LW = 150, size = 9.5, lead = 13, dark = lib.rgb(0.1, 0.1, 0.12), dim = lib.rgb(0.38, 0.38, 0.42);
    var page = null, y = 0;
    function newPage() { page = doc.addPage(A4); y = A4[1] - M; }
    function need(h) { if (!page || y - h < M) newPage(); }
    newPage();
    wrap(font, cert.title || "", 15, A4[0] - 2 * M).forEach(function (l) {
      page.drawText(l, { x: M, y: y - 15, size: 15, font: font, color: dark });
      y -= 20;
    });
    y -= 8;
    (cert.rows || []).forEach(function (r) {
      var ls = wrap(font, r[0] || "", size, LW - 10), vs = wrap(font, r[1] || "", size, A4[0] - 2 * M - LW);
      var n = Math.max(ls.length, vs.length);
      need(n * lead + 4);
      for (var i = 0; i < n; i++) {
        if (ls[i]) page.drawText(ls[i], { x: M, y: y - size, size: size, font: font, color: dim });
        if (vs[i]) page.drawText(vs[i], { x: M + LW, y: y - size, size: size, font: font, color: dark });
        y -= lead;
      }
      y -= 4;
    });
    if (cert.note) {
      y -= 6;
      wrap(font, cert.note, 8.5, A4[0] - 2 * M).forEach(function (l) {
        need(12);
        page.drawText(l, { x: M, y: y - 8.5, size: 8.5, font: font, color: dim });
        y -= 12;
      });
    }
  }
  function stamp(lib, bytes, items, meta) {
    var f = meta && meta.font;
    if (!f || !f.fontkit || !f.bytes) return Promise.reject(codeErr("font"));
    return load(lib, bytes).then(function (r) {
      if (r.err) throw codeErr(r.err);
      var doc = r.doc, images = {}, opts = C.readDocOpts(null);
      doc.registerFontkit(f.fontkit);
      return doc.embedFont(f.bytes, { subset: true }).then(function (font) {
        return (items || []).reduce(function (c, it) {
          return c.then(function () {
            if (!(it && it.pg >= 0 && it.pg < r.pages)) throw codeErr("bad");
            var page = doc.getPage(it.pg);
            return decorate(lib, doc, page, geomOf(lib, page, page.getRotation().angle), { ov: it.ov || [] },
                            0, 1, opts, font, images);
          });
        }, Promise.resolve()).then(function () {
          if (meta.cert) certPages(lib, doc, font, meta.cert);
          var at = new Date(meta.attach && meta.attach.at || 0);
          if (meta.attach) {
            return doc.attach(meta.attach.bytes, meta.attach.name, { mimeType: "application/json",
              description: meta.attach.description || "", creationDate: at, modificationDate: at });
          }
        }).then(function () {
          return doc.save({ useObjectStreams: true });
        });
      });
    });
  }
  // Where a page shows (its turn and size) in a PDF already made.
  function pageGeoms(lib, doc) {
    return doc.getPages().map(function (pg) { return geomOf(lib, pg, pg.getRotation().angle); });
  }

  var api = { load: load, build: build, geom: geom, fromImages: fromImages, wordsFor: wordsFor, PRODUCER: PRODUCER,
              stamp: stamp, pageGeoms: pageGeoms };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ScanPdfOps = api;
})(typeof window !== "undefined" ? window : this);
