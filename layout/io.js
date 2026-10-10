// ============================================================
// orOS Layout — files in and out (v1.0.0)
//   - PDF export (designkit/pdf.js + jsPDF, loaded on first use):
//     images are cut to their frames and resampled to the chosen
//     resolution first, so the PDF carries only what shows.
//   - .oroslayout package: the document + its images (base64) in
//     one JSON file; opened as a NEW document, every image checked
//     against its hash and decoded as an image before it is stored.
//   - PNG / JPG of one page (72, 150 or 300 dpi, at most 16 MP).
//   - Scribus .sla import (layout/sla.js) into a new document.
//   - Place image, import plain text.
// All file I/O goes through orosDialog (R33).
// ============================================================
(function () {
  "use strict";

  var LY = window.LY, M = LY.M, T = LY.T, P = LY.P, A = LY.A, t = LY.t;
  var ED = LY.ed;
  var PKG_KIND = "oros-layout-package", PKG_VER = 1;
  var PKG_MAX = 300 * 1024 * 1024, TXT_MAX = 2 * 1024 * 1024;

  function fileName(doc, ext) {
    var n = String(doc.name || "layout").replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 80) || "layout";
    return n + ext;
  }

  function saveBlob(blob, name, mime, desc, ext) {
    var dlg = LY.dialogHost();
    var types = [{ description: desc, accept: {} }];
    types[0].accept[mime] = [ext];
    if (dlg && typeof dlg.saveFile === "function") {
      return dlg.saveFile({ blob: blob, filename: name, mime: mime, types: types }).then(function (r) { return !!(r && r.ok); });
    }
    // standalone (no shell): classic download
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 40000);
    return Promise.resolve(true);
  }

  function pickFile(accept) {
    var dlg = LY.dialogHost();
    if (dlg && typeof dlg.openFile === "function") return dlg.openFile(accept);
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file"; inp.accept = accept;
      inp.addEventListener("change", function () { resolve(inp.files && inp.files[0] || null); });
      inp.click();
    });
  }

  // ---------- PDF ----------
  var jspdfP = null;
  function loadJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (jspdfP) return jspdfP;
    jspdfP = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "../vendor/jspdf.umd.min.js";
      s.onload = function () { if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF); else reject(new Error("jspdf")); };
      s.onerror = function () { jspdfP = null; reject(new Error("jspdf")); };
      document.head.appendChild(s);
    });
    return jspdfP;
  }

  function toBlob(cv, type, q) {
    return new Promise(function (resolve, reject) {
      cv.toBlob(function (b) { if (b) resolve(b); else reject(new Error("encode")); }, type, q);
    });
  }

  // Image items that show on the chosen pages (their own + master).
  function imageItems(doc, pageIds) {
    var want = {}, out = [], seen = {};
    pageIds.forEach(function (id) { want[id] = 1; });
    var order = M.pagesInOrder(doc);
    order.forEach(function (pg, idx) {
      if (!want[pg.id]) return;
      var list = M.itemsOn(doc, pg.id);
      list = M.masterItems(doc, pg, M.sideOf(doc, idx)).concat(list);
      list.forEach(function (it) { if (it.t === "img" && it.a && !it.hide && !seen[it.id]) { seen[it.id] = 1; out.push(it); } });
    });
    return out;
  }

  // The visible part of one image, resampled to `ppi` (never up).
  function cropImage(it, ppi) {
    var crop = P.imageCrop(it);
    if (!crop) return Promise.resolve(null);
    return A.load(it.a).then(function (img) {
      if (!img) return null;
      var k = (img.naturalWidth || img.width) / (it.iw || 1);
      var src = { x: crop.src.x * k, y: crop.src.y * k, w: crop.src.w * k, h: crop.src.h * k };
      var cw = Math.max(1, Math.round(Math.min(src.w, crop.rect.w / 72 * ppi)));
      var ch = Math.max(1, Math.round(Math.min(src.h, crop.rect.h / 72 * ppi)));
      var cv = document.createElement("canvas");
      cv.width = cw; cv.height = ch;
      var png = /\.png$/.test(it.a);
      cv.getContext("2d").drawImage(img, src.x, src.y, src.w, src.h, 0, 0, cw, ch);
      return toBlob(cv, png ? "image/png" : "image/jpeg", 0.9).then(function (b) { return b.arrayBuffer(); }).then(function (ab) {
        return { data: new Uint8Array(ab), fmt: png ? "PNG" : "JPEG", rect: crop.rect, alias: it.id + "-" + ppi };
      });
    });
  }

  var exporting = false;
  function exportPdf(opts) {
    var doc = LY.doc;
    if (!doc || exporting) return;
    LY.flushStory && LY.flushStory();
    exporting = true;
    LY.toast(t("exp.working"));
    var images = {}, JsPDF;
    loadJsPDF().then(function (J) {
      JsPDF = J;
      var chain = Promise.resolve();
      imageItems(doc, opts.pages).forEach(function (it) {
        chain = chain.then(function () { return cropImage(it, opts.ppi || 300); }).then(function (im) { if (im) images[it.id] = im; });
      });
      return chain;
    }).then(function () {
      var pdf = P.build(doc, { pages: opts.pages, spreads: opts.spreads, bleed: opts.bleed, marks: opts.marks, title: doc.name },
        { jsPDF: JsPDF, layout: ED.L, images: images });
      return saveBlob(pdf.output("blob"), fileName(doc, ".pdf"), "application/pdf", "PDF", ".pdf");
    }).then(function (ok) {
      exporting = false;
      if (ok) LY.toast(t("exp.done"));
    }, function (e) {
      exporting = false;
      try { console.error("[orOS] layout: PDF export failed", e); } catch (x) {}
      LY.toast(t("exp.fail"));
    });
  }

  // ---------- PNG / JPG of one page ----------
  var IMG_MAX_PX = 16e6;
  function exportImage(opts) {
    var doc = LY.doc;
    if (!doc || exporting) return;
    var order = M.pagesInOrder(doc), page = M.find(doc.pages, opts.page);
    if (!page) return;
    LY.flushStory && LY.flushStory();
    exporting = true;
    LY.toast(t("exp.working"));
    var scale = (opts.dpi || 150) / 72, w = doc.setup.w, h = doc.setup.h, capped = false;
    if (w * h * scale * scale > IMG_MAX_PX) { scale = Math.sqrt(IMG_MAX_PX / (w * h)); capped = true; }
    var chain = Promise.resolve();
    imageItems(doc, [page.id]).forEach(function (it) { chain = chain.then(function () { return A.load(it.a); }); });
    var jpg = opts.fmt === "jpg", n = order.indexOf(page) + 1;
    chain.then(function () {
      var cv = LY.R.renderPage(doc, page, ED.L, scale, { getImage: A.get, background: "#fff" });
      return toBlob(cv, jpg ? "image/jpeg" : "image/png", 0.92);
    }).then(function (blob) {
      var ext = jpg ? ".jpg" : ".png";
      return saveBlob(blob, fileName(doc, (order.length > 1 ? "-" + n : "") + ext), jpg ? "image/jpeg" : "image/png", jpg ? "JPEG" : "PNG", ext);
    }).then(function (ok) {
      exporting = false;
      if (ok) LY.toast(capped ? t("exp.capped", { n: Math.round(scale * 72) }) : t("exp.done"));
    }, function (e) {
      exporting = false;
      try { console.error("[orOS] layout: image export failed", e); } catch (x) {}
      LY.toast(t("exp.fail"));
    });
  }

  // ---------- Packages ----------
  function blobToB64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { var s = String(fr.result); resolve(s.slice(s.indexOf(",") + 1)); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsDataURL(blob);
    });
  }
  function b64ToBlob(b64, type) {
    var bin = atob(b64), n = bin.length, u = new Uint8Array(n);
    for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type: type });
  }
  function assetIds(doc) {
    var ids = {};
    doc.items.forEach(function (it) { if (it.t === "img" && it.a) ids[it.a] = 1; });
    return Object.keys(ids).sort();
  }

  function exportPackage(doc) {
    if (!doc) return;
    if (doc === LY.doc && LY.flushStory) LY.flushStory();
    doc = LY.findDoc(doc.id) || doc;
    var assets = {}, chain = Promise.resolve();
    assetIds(doc).forEach(function (id) {
      chain = chain.then(function () { return A.blob(id); }).then(function (b) {
        if (b) return blobToB64(b).then(function (s) { assets[id] = s; });
      });
    });
    chain.then(function () {
      var pkg = { kind: PKG_KIND, ver: PKG_VER, doc: doc, assets: assets };
      var blob = new Blob([JSON.stringify(pkg)], { type: "application/json" });
      return saveBlob(blob, fileName(doc, ".oroslayout"), "application/json", "orOS Layout", ".oroslayout");
    }).then(function (ok) { if (ok) LY.toast(t("exp.pkgDone")); }, function () { LY.toast(t("exp.fail")); });
  }

  // Open a file: a .oroslayout package, a Scribus .sla, an InDesign
  // .idml or a PDF (Affinity and others).
  function importPackage() {
    pickFile(".oroslayout,.sla,.idml,.pdf,application/json,.json,application/xml,text/xml,application/vnd.adobe.indesign-idml-package,application/pdf").then(function (f) {
      if (!f) return;
      if (/\.sla$/i.test(f.name || "")) return importSla(f);
      if (/\.idml$/i.test(f.name || "")) return importIdml(f);
      if (/\.pdf$/i.test(f.name || "") || f.type === "application/pdf") return importPdf(f);
      if (f.size > PKG_MAX) { LY.toast(t("imp.bad")); return; }
      return f.text().then(function (txt) {
        var pkg = null;
        try { pkg = JSON.parse(txt); } catch (e) {}
        var doc = pkg && pkg.kind === PKG_KIND && pkg.ver === PKG_VER ? M.normDoc(pkg.doc) : null;
        if (!doc) { LY.toast(t("imp.bad")); return; }
        // a NEW document: never overwrites or resurrects another one
        doc.id = M.newId("doc");
        doc.m = LY.now();
        var assets = pkg.assets && typeof pkg.assets === "object" ? pkg.assets : {};
        var failed = 0, chain = Promise.resolve();
        assetIds(doc).forEach(function (id) {
          var b64 = assets[id];
          if (typeof b64 !== "string" || !A.ID_RE.test(id)) { failed++; return; }
          chain = chain.then(function () {
            return A.put(id, b64ToBlob(b64, /\.png$/.test(id) ? "image/png" : "image/jpeg"));
          }).then(null, function () { failed++; });
        });
        return chain.then(function () {
          LY.addDoc(doc);
          LY.toast(failed ? t("imp.imgFail", { n: failed }) : t("imp.done"));
        });
      });
    }).then(null, function () { LY.toast(t("imp.bad")); });
  }

  // ---------- Images ----------
  // ---------- Scribus, InDesign ----------
  // A NEW document from another program's file; images inside the file
  // are stored like placed ones, linked images stay as empty frames
  // that keep the file name.
  var FOREIGN_MAX = 100 * 1024 * 1024;
  function baseName(f, ext) { return String(f.name || "").replace(ext, "").slice(0, 120); }
  function importSla(f) {
    if (f.size > FOREIGN_MAX || !window.LY_SLA) { LY.toast(t("sla.bad")); return; }
    LY.toast(t("sla.working"));
    return f.text().then(function (txt) {
      var res = null;
      try { res = window.LY_SLA.convert(txt, { now: LY.now(), name: baseName(f, /\.sla$/i) }); } catch (e) { res = null; }
      if (!res) { LY.toast(t("sla.bad")); return; }
      return addForeign(res, window.LY_SLA.inlineImage, t("sla.done", { p: res.stats.pages, n: res.stats.items }));
    }).then(null, function () { LY.toast(t("sla.bad")); });
  }
  function importIdml(f) {
    if (f.size > FOREIGN_MAX || !window.LY_IDML) { LY.toast(t("idml.bad")); return; }
    LY.toast(t("idml.working"));
    return f.arrayBuffer().then(function (buf) {
      return window.LY_IDML.open(buf, { now: LY.now(), name: baseName(f, /\.idml$/i) });
    }).then(function (res) {
      if (!res) { LY.toast(t("idml.bad")); return; }
      return addForeign(res, function (im) { return Promise.resolve(window.LY_IDML.imageBlob(im)); }, t("idml.done", { p: res.stats.pages, n: res.stats.items }));
    }).then(null, function () { LY.toast(t("idml.bad")); });
  }
  // PDF: text → editable frames, the rest → one picture per page
  function importPdf(f) {
    if (f.size > FOREIGN_MAX || !window.LY_PDFIN) { LY.toast(t("pdf.bad")); return; }
    LY.toast(t("pdf.start"));
    return f.arrayBuffer().then(function (buf) {
      return window.LY_PDFIN.open(buf, { now: LY.now(), name: baseName(f, /\.pdf$/i) }, A.importFile, function (k, n) {
        LY.toast(t("pdf.working", { n: k, t: n }));
      });
    }).then(function (res) {
      if (!res) { LY.toast(t("pdf.bad")); return; }
      LY.addDoc(res.doc);
      var msg = t("pdf.done", { p: res.stats.pages, n: res.stats.frames });
      if (res.stats.cut) msg += " " + t("pdf.cut", { n: res.stats.pages, t: res.stats.total });
      LY.toast(msg);
    }).then(null, function () { LY.toast(t("pdf.bad")); });
  }
  // res: { doc, images, linked, stats }; blobOf(image) → Promise of a
  // Blob or null
  function addForeign(res, blobOf, done) {
    var doc = res.doc, failed = 0, chain = Promise.resolve();
    res.images.forEach(function (im) {
      chain = chain.then(function () { return blobOf(im); }).then(function (blob) {
        if (!blob) { failed++; return; }
        blob.name = im.name;
        return A.importFile(blob).then(function (r) {
          var it = M.find(doc.items, im.item);
          if (!it) return;
          it.a = r.id; it.iw = r.w; it.ih = r.h;
        });
      }).then(null, function () { failed++; });
    });
    return chain.then(function () {
      LY.addDoc(M.normDoc(doc));
      var parts = [done];
      if (res.linked + failed) parts.push(t("sla.linked", { n: res.linked + failed }));
      if (res.stats.skipped) parts.push(t("sla.skipped", { n: res.stats.skipped }));
      LY.toast(parts.join(" "));
    });
  }

  function placeImage(itemId) {
    pickFile("image/*").then(function (f) {
      if (!f) return;
      return A.importFile(f).then(function (res) {
        LY.op(function (doc, now) {
          var it = M.find(doc.items, itemId);
          if (!it || it.t !== "img") return false;
          it.a = res.id; it.nm = res.name; it.iw = res.w; it.ih = res.h;
          it.ix = 0; it.iy = 0; it.isc = 1;
          if (it.fit === "custom") it.fit = "fill";
          M.touch(it, now);
        });
        LY.toast(t("img.placed"));
      }, function (e) {
        LY.toast(e && e.message === "nofs" ? t("img.nofs") : t("img.fail"));
      });
    });
  }

  // ---------- Text ----------
  // Plain text: one paragraph per line (blank lines dropped), into the
  // selected text frame's story (appended), or a new frame filling
  // the current page's margins.
  function importText() {
    if (!LY.doc) return;
    pickFile(".txt,.md,text/plain").then(function (f) {
      if (!f) return;
      if (f.size > TXT_MAX) { LY.toast(t("txt.fail")); return; }
      return f.text().then(function (txt) {
        var lines = String(txt).replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/\t/g, " ")
          .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").split("\n")
          .map(function (s) { return s.replace(/\s+$/, ""); }).filter(function (s) { return s.trim(); });
        if (!lines.length) { LY.toast(t("txt.fail")); return; }
        LY.flushStory && LY.flushStory();
        var sel = ED.selItems().filter(function (it) { return it.t === "text"; });
        var target = sel.length === 1 ? sel[0] : null, made = null;
        LY.op(function (doc, now) {
          var paras = lines.map(function (s) { return { ps: "ps-body", runs: [{ t: s }] }; });
          if (target) {
            var st = M.story(doc, target.story);
            if (!st) return false;
            st.h = [st.m].concat(st.h || []);
            st.paras = T.hasText(st) ? st.paras.concat(paras) : paras;
            M.touch(st, now);
            return;
          }
          var P0 = ED.curP();
          if (!P0) return false;
          var mb = ED.marginBox(doc, P0.side);
          var st2 = ED.newStory(doc, now, paras);
          made = ED.addItem(doc, { t: "text", pg: P0.id, side: P0.master ? P0.side : "", x: mb.x, y: mb.y, w: mb.w, h: mb.h, story: st2.id, cols: doc.setup.cols, gut: doc.setup.gut }, now);
          if (!made) return false;
        });
        if (made) ED.select([made.id]);
        LY.toast(t("txt.done"));
      });
    }).then(null, function () { LY.toast(t("txt.fail")); });
  }

  LY.io = {
    exportPdf: exportPdf, exportImage: exportImage, exportPackage: exportPackage, importPackage: importPackage,
    placeImage: placeImage, importText: importText
  };
})();
