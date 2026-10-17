// ============================================================
// orOS Scanner & PDF — pdfops.js: writing PDFs with pdf-lib
// ------------------------------------------------------------
// load(lib, bytes)            -> Promise<{ doc, pages } | { err }>
//     err: "locked" (encrypted, even with an empty password: its
//     streams can't be copied), "bad" (not a readable PDF).
// build(lib, srcs, pages, prefs, meta) -> Promise<Uint8Array>
//     srcs: { <id>: { kind: "pdf", doc } | { kind: "image",
//             img: { bytes, type "jpg"|"png", w, h } } }
//     pages: the page list (core.js), in output order.
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

  function build(lib, srcs, pages, prefs, meta) {
    var P = C.readPrefs(prefs);
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
      return chain.then(function () {
        return pages.reduce(function (c, p) {
          return c.then(function () {
            var s = srcs[p.src], page;
            if (s.kind === "pdf") {
              page = copied[p.src][cursor[p.src]++];
              out.addPage(page);
              if (p.rot) page.setRotation(lib.degrees(C.normRot(page.getRotation().angle + p.rot)));
              return;
            }
            return embed(p.src).then(function (emb) {
              var w = s.img.w, h = s.img.h, size = C.pageFor(w, h, P);
              var r = C.fitRect(w, h, size[0], size[1], P.margin);
              page = out.addPage(size);
              page.drawImage(emb, { x: r.x, y: r.y, width: r.w, height: r.h });
              if (p.rot) page.setRotation(lib.degrees(C.normRot(p.rot)));
            });
          });
        }, Promise.resolve());
      }).then(function () {
        var now = new Date();
        if (meta && meta.title) out.setTitle(String(meta.title).slice(0, 200));
        out.setProducer(PRODUCER);
        out.setCreator(PRODUCER);
        out.setCreationDate(now);
        out.setModificationDate(now);
        return out.save({ useObjectStreams: true });
      });
    });
  }

  var api = { load: load, build: build, PRODUCER: PRODUCER };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ScanPdfOps = api;
})(typeof window !== "undefined" ? window : this);
