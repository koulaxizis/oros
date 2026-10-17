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
//            additions of each page (p.ov: signatures, text).
//     meta: { title, opts (core.readDocOpts: page numbers,
//            watermark, title, author), font: { fontkit, bytes } }.
//            Text is drawn with the font given (Noto Sans: Greek and
//            Latin), embedded as a subset; without it, text fails
//            with code "font".
// geom(lib, srcs, p, prefs) -> { W, H, R, bx, by } of a list page:
//     its unturned size, how it shows turned, and its box origin.
// fromImages(lib, list, meta) -> Promise<Uint8Array>
//     list: [{ bytes (JPEG), w, h (page points) }]: one picture per
//     page, the page filled (Compress makes these).
// Pages of a PDF are copied as they are (text, links on the page,
// fonts); bookmarks and forms of the whole file are not carried.
// A picture becomes one page sized by prefs (core.pageFor/fitRect).
// Rotation is set on the page (/Rotate), so nothing is redrawn.
// `lib` is window.PDFLib (vendor/pdf-lib, MIT) or require() in Node.
// UMD: window.ScanPdfOps, or module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var C = (typeof module !== "undefined" && module.exports) ? require("./core.js") : root.ScanPdfCore;
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

  function needsFont(pages, opts) {
    if (opts.num.on || opts.wm.on) return true;
    return pages.some(function (p) { return (p.ov || []).some(function (o) { return o.t === "text"; }); });
  }

  // Additions, page number and watermark of one page.
  function decorate(lib, out, page, g, p, i, total, opts, font, images) {
    var S = Math.min(g.W, g.H), d = C.dispSize(g.W, g.H, g.R);
    function centre(px, py) { return [g.bx + px, g.by + g.H - py]; }
    var chain = Promise.resolve();
    (p.ov || []).forEach(function (raw) {
      var o = C.cleanOv(raw);
      if (!o) return;
      chain = chain.then(function () {
        var c = centre(o.cx * g.W, o.cy * g.H);
        if (o.t === "img") {
          var ow = o.w * S, oh = o.h * S;
          return image(o.src).then(function (emb) {
            var a = C.anchor(c[0], c[1], -ow / 2, -oh / 2, o.A);
            page.drawImage(emb, { x: a.x, y: a.y, width: ow, height: oh, rotate: lib.degrees(o.A) });
          });
        }
        var size = o.fs * S, tw = font.widthOfTextAtSize(o.text, size), col = C.COLORS[o.color];
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
    // One embedded picture per signature, however many pages carry it.
    function image(src) {
      if (!images[src]) images[src] = out.embedPng(C.dataUrlBytes(src));
      return images[src];
    }
  }

  function build(lib, srcs, pages, prefs, meta) {
    var P = C.readPrefs(prefs);
    var opts = C.readDocOpts(meta && meta.opts);
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
      if (needsFont(pages, opts)) {
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
              return decorate(lib, out, page, geomOf(lib, page, rot), p, i, pages.length, opts, font, images);
            }
            return embed(p.src).then(function (emb) {
              var PP = C.prefsFor(s, P), w = s.img.w, h = s.img.h, size = C.pageFor(w, h, PP);
              var r = C.fitRect(w, h, size[0], size[1], PP.margin);
              page = out.addPage(size);
              page.drawImage(emb, { x: r.x, y: r.y, width: r.w, height: r.h });
              if (p.rot) page.setRotation(lib.degrees(C.normRot(p.rot)));
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
    return lib.PDFDocument.create().then(function (out) {
      return list.reduce(function (c, it) {
        return c.then(function () {
          return out.embedJpg(it.bytes).then(function (emb) {
            var page = out.addPage([it.w, it.h]);
            page.drawImage(emb, { x: 0, y: 0, width: it.w, height: it.h });
          });
        });
      }, Promise.resolve()).then(function () {
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

  var api = { load: load, build: build, geom: geom, fromImages: fromImages, PRODUCER: PRODUCER };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ScanPdfOps = api;
})(typeof window !== "undefined" ? window : this);
