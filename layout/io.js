// ============================================================
// orOS Layout — files in and out (v1.0.0)
//   - PDF export (designkit/pdf.js + jsPDF, loaded on first use):
//     images are cut to their frames and resampled to the chosen
//     resolution first, so the PDF carries only what shows.
//   - .oroslayout package: an orOS bundle (bundle.js): a ZIP with the
//     document (content.json), its images (media/) and a thumbnail;
//     older JSON packages (images as base64) still open, and so does
//     an unzipped bundle folder. Opened as a NEW document, every image
//     checked against its hash and decoded before it is stored.
//   - PNG / JPG of one page (72, 150 or 300 dpi, at most 16 MP).
//   - Scribus .sla / .sla.gz import (layout/sla.js) into a new document.
//   - Rebuild a print PDF with its original pictures (layout/rebuild.js)
//     and show what landed where it was.
//   - Many packages at once: picked together, a .zip of them (read a
//     piece at a time, designkit/zipin.js) or a folder in Files.
//   - Place image, import plain text, a picture sent from another app.
// All file I/O goes through orosDialog (R33).
// ============================================================
(function () {
  "use strict";

  var LY = window.LY, M = LY.M, T = LY.T, P = LY.P, A = LY.A, F = LY.F, t = LY.t;
  var ED = LY.ed, el = LY.el;
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
  // → Promise of an array of Files (empty when none were picked)
  function pickFiles(accept) {
    var dlg = LY.dialogHost();
    var pick = dlg && typeof dlg.openFiles === "function" ? dlg.openFiles(accept) : new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file"; inp.accept = accept; inp.multiple = true;
      inp.addEventListener("change", function () { resolve(inp.files ? Array.prototype.slice.call(inp.files) : null); });
      inp.click();
    });
    return pick.then(function (files) { return (Array.isArray(files) ? files : files ? [files] : []).filter(Boolean); });
  }

  // → Promise of a greyscale copy of a picture (luminance 0.299 R +
  // 0.587 G + 0.114 B, at most 4000 px a side). white: clear parts
  // become white and the copy is a JPEG; else a picture with clear
  // parts stays a PNG with them.
  var GREY_SIDE = 4000;
  function greyBlob(blob, white) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth || 1200, h = img.naturalHeight || 1200, k = Math.min(1, GREY_SIDE / Math.max(w, h));
        var cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
        var ctx = cv.getContext("2d");
        if (white) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height); }
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        var px = ctx.getImageData(0, 0, cv.width, cv.height), d = px.data, clear = false;
        for (var i = 0; i < d.length; i += 4) {
          var y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
          d[i] = d[i + 1] = d[i + 2] = y;
          if (d[i + 3] < 255) clear = true;
        }
        ctx.putImageData(px, 0, 0);
        var png = !white && clear;
        cv.toBlob(function (b) { if (b) resolve(b); else reject(new Error("encode")); }, png ? "image/png" : "image/jpeg", 0.92);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("decode")); };
      img.src = url;
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

  // A PDF of any document (not only the open one) → Promise<Blob>.
  // opts: pages (ids, default all), spreads, bleed, marks, ppi.
  function pdfBlob(doc, opts) {
    var images = {}, JsPDF;
    var pages = opts.pages || M.pagesInOrder(doc).map(function (p) { return p.id; });
    return loadJsPDF().then(function (J) {
      JsPDF = J;
      var chain = Promise.resolve();
      imageItems(doc, pages).forEach(function (it) {
        chain = chain.then(function () { return cropImage(it, opts.ppi || 300); }).then(function (im) { if (im) images[it.id] = im; });
      });
      return chain;
    }).then(function () {
      var L = doc === LY.doc && ED.L ? ED.L : LY.R.computeLayout(doc);
      var pdf = P.build(doc, { pages: pages, spreads: !!(opts.spreads && doc.setup.facing), bleed: opts.bleed, marks: opts.marks, title: doc.name },
        { jsPDF: JsPDF, layout: L, images: images });
      return pdf.output("blob");
    });
  }

  var exporting = false;
  function exportPdf(opts) {
    var doc = LY.doc;
    if (!doc || exporting) return;
    LY.flushStory && LY.flushStory();
    exporting = true;
    LY.toast(t("exp.working"));
    pdfBlob(doc, opts).then(function (blob) {
      return saveBlob(blob, fileName(doc, ".pdf"), "application/pdf", "PDF", ".pdf");
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
  // The font files of the user's families the styles use (LY-FONT):
  // they travel in the package, so the document looks the same on a
  // device that never had them.
  function fontFiles(doc) {
    var used = {}, out = {};
    F.famsUsed(doc).forEach(function (id) { used[id] = 1; });
    F.docFonts(doc).forEach(function (e) {
      if (!used[e.id]) return;
      ["r", "b", "i", "bi"].forEach(function (v) { if (e[v]) out[e[v]] = 1; });
    });
    return Object.keys(out).sort();
  }

  // .oroslayout = an orOS bundle (bundle.js, docs/oros-bundle.md): a
  // ZIP with content.json (the package without its assets), media/<id>
  // (images) and a thumbnail of the first page (when the document is
  // the open one: its text layout is at hand).
  var BUNDLE_MIME = "application/x-oros-layout";
  function thumbOf(doc) {
    var page = M.pagesInOrder(doc)[0];
    if (!page || doc !== LY.doc || !ED.L) return Promise.resolve(null);
    var chain = Promise.resolve();
    imageItems(doc, [page.id]).forEach(function (it) { chain = chain.then(function () { return A.load(it.a); }); });
    return chain.then(function () {
      var cv = LY.R.renderPage(doc, page, ED.L, 512 / Math.max(doc.setup.w, doc.setup.h), { getImage: A.get, background: "#fff" });
      return toBlob(cv, "image/png");
    }).then(null, function () { return null; });
  }
  function exportPackage(doc) {
    if (!doc) return;
    if (doc === LY.doc && LY.flushStory) LY.flushStory();
    doc = LY.findDoc(doc.id) || doc;
    var media = {}, chain = Promise.resolve();
    assetIds(doc).forEach(function (id) {
      chain = chain.then(function () { return A.blob(id); }).then(function (b) { if (b) media[id] = b; });
    });
    fontFiles(doc).forEach(function (name) {
      chain = chain.then(function () { return F.blob(name); }).then(function (b) { if (b) media[name] = b; });
    });
    chain.then(function () { return thumbOf(doc); }).then(function (thumb) {
      return window.OrosBundle.write({
        mime: BUNDLE_MIME, app: "layout", schema: "layout/" + PKG_VER,
        content: { kind: PKG_KIND, ver: PKG_VER, doc: doc },
        meta: { title: doc.name || "", modified: doc.m, id: doc.id, language: LY.LANG, generator: "orOS Layout" },
        media: media, thumbnail: thumb, date: new Date()
      });
    }).then(function (bytes) {
      return saveBlob(new Blob([bytes], { type: BUNDLE_MIME }), fileName(doc, ".oroslayout"), BUNDLE_MIME, "orOS Layout", ".oroslayout");
    }).then(function (ok) { if (ok) LY.toast(t("exp.pkgDone")); }, function () { LY.toast(t("exp.fail")); });
  }
  function bundleFail(e) { say(e && e.code === "newer" ? t("imp.newer") : t("imp.bad")); }
  function fromBundle(r) {
    var pkg = r && r.content && typeof r.content === "object" ? r.content : null;
    if (pkg) {
      pkg.assets = {};
      Object.keys(r.media).forEach(function (k) { pkg.assets[k] = r.media[k].bytes; });
    }
    return openPackage(pkg);
  }
  // Home › Open › Unzipped folder: a .oroslayout someone unzipped
  // (and maybe changed: an image swapped, a text fixed by hand).
  function importFolder() {
    window.OrosBundle.pickFolder().then(function (files) {
      if (!files) return;
      // a Scribus "Collect for output" folder: the .sla and its pictures
      var list = Array.prototype.slice.call(files), sla = list.filter(function (f) { return /\.sla(\.gz)?$/i.test(f.name || ""); })[0];
      if (sla && !list.some(function (f) { return f.name === "content.json"; })) return importSla(sla, list.filter(isPicture), list.filter(isPdf)[0]);
      return window.OrosBundle.readFolder(files, { mime: BUNDLE_MIME }).then(fromBundle, bundleFail);
    }).then(null, function () { LY.toast(t("imp.bad")); });
  }

  // Open a file: a .oroslayout package, a Scribus .sla, an InDesign
  // .idml, a PDF or SVG pages (Affinity and others). Several SVG files
  // at once become one document, a page each (by file name); other
  // files picked together open one after another.
  var OPEN_ACCEPT = ".oroslayout,.zip,application/zip,.sla,.gz,.idml,.pdf,.svg,application/json,.json,application/xml,text/xml,application/vnd.adobe.indesign-idml-package,application/pdf,image/svg+xml,image/*,.jpg,.jpeg,.png,.gif,.webp,.tif,.tiff";
  function isSvg(f) { return /\.svg$/i.test(f.name || "") || f.type === "image/svg+xml"; }
  function isPdf(f) { return /\.pdf$/i.test(f.name || "") || f.type === "application/pdf"; }
  function isPicture(f) { return /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(f.name || "") || /^image\/(jpeg|png|gif|webp|bmp|tiff)$/.test(f.type || ""); }
  function importPackage() {
    var dlg = LY.dialogHost();
    var pick = dlg && typeof dlg.openFiles === "function" ? dlg.openFiles(OPEN_ACCEPT) : new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file"; inp.accept = OPEN_ACCEPT; inp.multiple = true;
      inp.addEventListener("change", function () { resolve(inp.files ? Array.prototype.slice.call(inp.files) : null); });
      inp.click();
    });
    pick.then(function (files) {
      files = (Array.isArray(files) ? files : files ? [files] : []).filter(Boolean);
      if (!files.length) return;
      if (files.every(isSvg)) return importSvg(files);
      if (files.every(isPkgOrZip) && (files.length > 1 || isZip(files[0]))) return importMany(files);
      // a Scribus file picked with pictures: they are its linked
      // pictures; with a PDF: its print PDF, for the line breaks
      var sla = files.filter(function (f) { return /\.sla(\.gz)?$/i.test(f.name || ""); });
      if (sla.length === 1 && files.length > 1) {
        var pics = files.filter(isPicture), pdf = files.filter(isPdf)[0];
        files = files.filter(function (f) { return f !== sla[0] && f !== pdf && pics.indexOf(f) < 0; });
        var first = importSla(sla[0], pics, pdf);
        files.forEach(function (f) { first = Promise.resolve(first).then(function () { return openFile(f); }); });
        return first;
      }
      var chain = Promise.resolve();
      files.forEach(function (f) { chain = chain.then(function () { return openFile(f); }); });
      return chain;
    }, function () { LY.toast(t("imp.bad")); });
  }
  // Also the way in for a file from the system's "Open with" (shell fileopen.js).
  function openFile(f) {
    return Promise.resolve(f).then(function (f) {
      if (!f) return;
      if (/\.sla(\.gz)?$/i.test(f.name || "")) return importSla(f);
      if (/\.idml$/i.test(f.name || "")) return importIdml(f);
      if (/\.pdf$/i.test(f.name || "") || f.type === "application/pdf") return importPdf(f);
      if (isSvg(f)) return importSvg([f]);
      if (f.size > PKG_MAX) { say(t("imp.bad")); return; }
      return f.slice(0, 4).arrayBuffer().then(function (head) {
        if (window.OrosBundle.sniff(new Uint8Array(head)) !== null) {
          return f.arrayBuffer().then(function (ab) {
            return window.OrosBundle.read(new Uint8Array(ab), { mime: BUNDLE_MIME });
          }).then(fromBundle, bundleFail);
        }
        return f.text().then(function (txt) {
          var pkg = null;
          try { pkg = JSON.parse(txt); } catch (e) {}
          if (!batch && LY.openStored && LY.openStored(f.name, pkg)) return;
          return openPackage(pkg);
        });
      });
    }).then(null, function () { say(t("imp.bad")); });
  }
  // pkg.assets: base64 (older JSON packages) or bytes (bundles)
  function openPackage(pkg) {
    return Promise.resolve().then(function () {
      var doc = pkg && pkg.kind === PKG_KIND && pkg.ver === PKG_VER ? M.normDoc(pkg.doc) : null;
      if (!doc) { say(t("imp.bad")); return; }
      // a NEW document: never overwrites or resurrects another one
      doc.id = M.newId("doc");
      doc.m = LY.now();
      var assets = pkg.assets && typeof pkg.assets === "object" ? pkg.assets : {};
      var failed = 0, fontsFailed = 0, chain = Promise.resolve();
      assetIds(doc).forEach(function (id) {
        var b64 = assets[id];
        if (!(typeof b64 === "string" || b64 instanceof Uint8Array) || !A.ID_RE.test(id)) { failed++; return; }
        chain = chain.then(function () {
          var type = /\.png$/.test(id) ? "image/png" : "image/jpeg";
          return A.put(id, typeof b64 === "string" ? b64ToBlob(b64, type) : new Blob([b64], { type: type }));
        }).then(null, function () { failed++; });
      });
      // a font missing from the package may already be on this disk
      fontFiles(doc).forEach(function (name) {
        var b = assets[name];
        chain = chain.then(function () {
          if (b instanceof Uint8Array || typeof b === "string") return F.put(name, typeof b === "string" ? b64ToBlob(b, "font/ttf") : new Blob([b], { type: "font/ttf" }));
          return F.blob(name).then(function (have) { if (!have) throw new Error("nofont"); });
        }).then(null, function () { fontsFailed++; });
      });
      return chain.then(function () {
        if (batch) return batch.add(doc, failed, fontsFailed);
        LY.addDoc(doc);
        LY.toast(failed ? t("imp.imgFail", { n: failed }) : fontsFailed ? t("imp.fontFail", { n: fontsFailed }) : t("imp.done"));
      });
    }).then(null, function () { say(t("imp.bad")); });
  }

  // ---------- Many packages at once ----------
  // Home › Open › A file takes several .oroslayout files and .zip files
  // of them (e.g. a folder zipped on the computer); Home › Open › A
  // folder in Files takes every package in a folder of the orOS disk
  // and its subfolders. One after another, each a new document as with
  // one file; Home stays open and one toast tells how many came in.
  // Documents live in the shared localStorage (R30): the first one that
  // does not fit is taken back and the rest are not opened, so nothing
  // is shown that a reload would lose.
  var batch = null;
  function say(msg) { if (!batch) LY.toast(msg); }
  var BATCH_MAX = 500, DEPTH_MAX = 4, PKG_RE = /\.oroslayout$/i;
  function isZip(f) { return /\.zip$/i.test(f.name || "") || f.type === "application/zip"; }
  function isPkgOrZip(f) { return PKG_RE.test(f.name || "") || isZip(f); }
  function byName(a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }
  // files: Files, or { name, get() → Promise<File|null> } (the disk).
  // → Promise of { ok, bad, full, imgFail }
  function importMany(files) {
    files = (files || []).filter(Boolean);
    if (!files.length || batch) return Promise.resolve(null);
    var res = { ok: 0, bad: 0, full: 0, imgFail: 0 }, n = 0;
    batch = {
      // a document counts once it is stored (on the disk: written and
      // read back; else in localStorage)
      add: function (doc, failed) {
        if (res.full) return;
        return Promise.resolve(LY.addDocQuiet(doc)).then(function (ok) {
          if (!ok) { res.full = 1; return; }
          res.ok++;
          if (failed) res.imgFail++;
        });
      }
    };
    function one(f) {
      if (res.full) return;
      if (n >= BATCH_MAX) { res.bad++; return; }
      n++;
      var before = res.ok;
      return openFile(f).then(function () { if (res.ok === before && !res.full) res.bad++; });
    }
    function zipOf(f) {
      return window.orosZipIn.list(f).then(function (entries) {
        var chain = Promise.resolve();
        entries.filter(function (e) { return PKG_RE.test(e.name) && !/(^|\/)(__MACOSX\/|\.)/.test(e.name); }).sort(byName).forEach(function (e) {
          chain = chain.then(function () {
            if (res.full) return;
            return e.get(PKG_MAX).then(function (b) { return one(new File([b], e.name.split("/").pop())); }, function () { res.bad++; });
          });
        });
        return chain;
      }, function () { res.bad++; });
    }
    LY.toast(t("imp.manyWorking"));
    var chain = Promise.resolve();
    files.forEach(function (f) {
      chain = chain.then(function () {
        if (res.full) return;
        // a picked File may come from the shell's window (orosDialog), where
        // a Blob check by class fails across windows: tell a file by what it can do
        return Promise.resolve(typeof f.arrayBuffer === "function" ? f : f.get()).then(function (file) {
          if (!file) { res.bad++; return; }
          return isZip(file) ? zipOf(file) : one(file);
        }).then(null, function () { res.bad++; });
      });
    });
    return chain.then(function () {
      batch = null;
      if (LY.doc) LY.goHome(); else LY.renderHome();
      LY.toast(res.full ? t("imp.full", { n: res.ok }) : res.bad ? t("imp.manyBad", { n: res.ok, bad: res.bad }) : t("imp.many", { n: res.ok }));
      return res;
    });
  }

  // Home › Open › A folder in Files: a small browser of the orOS disk's
  // folders; "Open" takes this folder and its subfolders.
  function diskFs() {
    try { return (window.parent && window.parent.orosFS) || window.orosFS || null; }
    catch (e) { return window.orosFS || null; }
  }
  var ROOT = "/internal";
  function lsOf(fs, path) {
    return Promise.resolve(typeof fs.ready === "function" ? fs.ready() : null).then(function () { return fs.ls(path); })
      .then(function (en) { return (en || []).filter(function (e) { return e && typeof e.name === "string" && e.name.charAt(0) !== "."; }); }, function () { return []; });
  }
  // Layout's own document files (LY-DISK) and the Trash are never
  // imported again as copies.
  var SKIP_DIRS = [ROOT + "/Trash", ROOT + "/Layout"];
  // every package under path (subfolders to DEPTH_MAX), sorted by path
  function packagesIn(fs, path) {
    var out = [];
    function walk(p, depth) {
      if (SKIP_DIRS.indexOf(p) >= 0) return Promise.resolve();
      return lsOf(fs, p).then(function (en) {
        var chain = Promise.resolve();
        en.sort(byName).forEach(function (e) {
          var q = p + "/" + e.name;
          if (e.dir) { if (depth < DEPTH_MAX && SKIP_DIRS.indexOf(q) < 0) chain = chain.then(function () { return walk(q, depth + 1); }); }
          else if (PKG_RE.test(e.name) && out.length < BATCH_MAX) out.push(q);
        });
        return chain;
      });
    }
    return walk(path, 0).then(function () { return out; });
  }
  function diskItems(fs, paths) {
    return paths.map(function (p) {
      return { name: p, get: function () {
        return fs.read(p).then(function (b) { return b ? new File([b], p.split("/").pop()) : null; });
      } };
    });
  }
  function importDisk() {
    var fs = diskFs();
    if (!fs) { LY.toast(t("img.nofs")); return; }
    var cwd = ROOT, gen = 0;
    LY.openDialog(t("imp.diskTitle"), function (body, close) {
      var bar = el("div", "pn-row");
      var up = el("button", "btn small", t("imp.diskUp")); up.type = "button";
      var where = el("span", "hint");
      bar.appendChild(up); bar.appendChild(where);
      var list = el("div", "imp-dirs");
      var found = el("p", "hint");
      var act = el("div", "dlg-actions");
      var c = el("button", "btn", t("btn.cancel")); c.type = "button";
      var o = el("button", "btn primary", t("imp.diskGo")); o.type = "button";
      act.appendChild(c); act.appendChild(o);
      body.appendChild(bar); body.appendChild(list); body.appendChild(found); body.appendChild(act);
      var paths = [];
      c.addEventListener("click", close);
      up.addEventListener("click", function () { if (cwd !== ROOT) go(cwd.replace(/\/[^\/]+$/, "") || ROOT); });
      o.addEventListener("click", function () {
        if (!paths.length) return;
        close();
        importMany(diskItems(fs, paths));
      });
      function go(path) {
        cwd = path;
        var my = ++gen;
        up.disabled = path === ROOT;
        where.textContent = path === ROOT ? "/" : path.slice(ROOT.length);
        list.textContent = "";
        found.textContent = t("imp.diskLooking");
        o.disabled = true;
        lsOf(fs, path).then(function (en) {
          if (my !== gen) return;
          en.filter(function (e) { return e.dir && !(path === ROOT && e.name === "Trash"); }).sort(byName).forEach(function (e) {
            var b = el("button", "btn small block", "\ud83d\udcc1 " + e.name); b.type = "button";
            b.addEventListener("click", function () { go(path + "/" + e.name); });
            list.appendChild(b);
          });
          return packagesIn(fs, path);
        }).then(function (ps) {
          if (my !== gen || !ps) return;
          paths = ps;
          o.disabled = !ps.length;
          found.textContent = ps.length ? t("imp.diskFound", { n: ps.length }) : t("imp.diskNone");
        });
      }
      go(ROOT);
    }, true);
  }

  // ---------- Images ----------
  // ---------- Scribus, InDesign ----------
  // A NEW document from another program's file; images inside the file
  // are stored like placed ones, linked images stay as empty frames
  // that keep the file name.
  var FOREIGN_MAX = 100 * 1024 * 1024;
  function baseName(f, ext) { return String(f.name || "").replace(ext, "").slice(0, 120); }
  // pics: the pictures picked with the file (its linked pictures, by
  // name); pdf: its print PDF, whose line breaks the text takes.
  // → Promise of a report (the Assistant's card) or null:
  // { sla: 1, pages, items, skipped, placed, missing, fit }
  function importSla(f, pics, pdf) {
    if (f.size > FOREIGN_MAX || !window.LY_SLA) { LY.toast(t("sla.bad")); return Promise.resolve(null); }
    LY.toast(t("sla.working"));
    // a compressed .sla.gz is unpacked first (gzip magic, not the name)
    return f.arrayBuffer().then(function (buf) {
      var u = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
      return u[0] === 0x1f && u[1] === 0x8b ? window.LY_SLA.gunzip(buf) : new TextDecoder().decode(buf);
    }).then(function (txt) {
      var res = null;
      if (typeof txt !== "string") { LY.toast(t("sla.bad")); return; }
      try { res = window.LY_SLA.convert(txt, { now: LY.now(), name: baseName(f, /\.sla(\.gz)?$/i) }); } catch (e) { res = null; }
      if (!res) { LY.toast(t("sla.bad")); return; }
      var fit = null;
      return useSrcFonts(res.doc).then(function () { return pdf ? fitToPdf(res.doc, pdf) : { msg: "" }; }).then(function (fr) {
        fit = fr.rep || null;
        return addForeign(res, window.LY_SLA.inlineImage, t("sla.done", { p: res.stats.pages, n: res.stats.items }) + fr.msg, "", pics);
      }).then(function (pl) {
        return { sla: 1, pages: res.stats.pages, items: res.stats.items, skipped: res.stats.skipped, placed: pl.placed, missing: pl.missing, fit: fit };
      });
    }).then(null, function () { LY.toast(t("sla.bad")); return null; });
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
      var msg = t("pdf.done", { p: res.stats.pages, n: res.stats.frames, i: res.stats.pictures || 0 });
      if (res.stats.cut) msg += " " + t("pdf.cut", { n: res.stats.pages, t: res.stats.total });
      LY.toast(msg);
    }).then(null, function () { LY.toast(t("pdf.bad")); });
  }
  // Rebuild a print PDF: the PDF (its trim box) and, picked with it,
  // the original pictures and texts → a NEW document that looks like
  // the PDF, then the report of what landed where it was.
  var REBUILD_ACCEPT = ".pdf,application/pdf,image/*,.jpg,.jpeg,.png,.webp,.tif,.tiff,.txt,.md,.html,.htm,.af";
  var rebuilding = false;
  function rebuildPdf() {
    var RB = window.LY_REBUILD, dlg = LY.dialogHost();
    if (!RB || rebuilding) return;
    var pick = dlg && typeof dlg.openFiles === "function" ? dlg.openFiles(REBUILD_ACCEPT) : new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file"; inp.accept = REBUILD_ACCEPT; inp.multiple = true;
      inp.addEventListener("change", function () { resolve(inp.files ? Array.prototype.slice.call(inp.files) : null); });
      inp.click();
    });
    return pick.then(function (files) {
      files = (Array.isArray(files) ? files : files ? [files] : []).filter(Boolean);
      if (!files.length) return;
      var pdf = files.filter(function (f) { return /\.pdf$/i.test(f.name || "") || f.type === "application/pdf"; })[0];
      if (!pdf) { LY.toast(t("rb.noPdf")); return; }
      framesDlg(function (thread) {
        rebuild(pdf, files.filter(function (f) { return f !== pdf; }), { thread: thread }).then(null, function () { LY.toast(t("rb.bad")); });
      });
    }).then(null, function () { rebuilding = false; LY.toast(t("rb.bad")); });
  }
  // Text frames per page (every line where it was, the default) or an
  // article's frames going on from page to page (LY-THR); the choice
  // is kept for the session.
  var rbThread = false;
  function framesDlg(go) {
    var U = LY.ui;
    LY.openDialog(t("rb.frames"), function (body, close) {
      var wrap = el("div"), hint = el("p", "hint");
      function draw() {
        wrap.innerHTML = "";
        wrap.appendChild(U.seg([["page", t("rb.perPage")], ["thread", t("rb.thread")]], rbThread ? "thread" : "page", function (v) { rbThread = v === "thread"; draw(); }));
        hint.textContent = t(rbThread ? "rb.threadHint" : "rb.perPageHint");
      }
      draw();
      body.appendChild(wrap);
      body.appendChild(hint);
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      act.appendChild(U.btn(t("btn.cancel"), close));
      act.appendChild(U.btn(t("rb.go"), function () { close(); go(rbThread); }, "primary"));
      body.appendChild(act);
    });
  }
  // also for the Assistant: pdf (a File), sources (Files), opts
  // { chat: the Assistant's conversation, for "Back to the Assistant",
  // thread: frames that go on from page to page }
  // → Promise of the report, or null. A print PDF may be big (pictures
  // at 300 ppi): up to REBUILD_MAX.
  var REBUILD_MAX = 1024 * 1024 * 1024;
  function rebuild(pdf, sources, opts) {
    var RB = window.LY_REBUILD;
    if (!RB || rebuilding) return Promise.resolve(null);
    if (pdf.size > REBUILD_MAX) { LY.toast(t("rb.bad")); return Promise.resolve(null); }
    rebuilding = true;
    var stop = false;
    LY.toast(t("rb.start", { n: sources.length }), t("btn.cancel"), function () { stop = true; });
    return pdf.arrayBuffer().then(function (buf) {
      return RB.open(buf, sources, { now: LY.now(), name: baseName(pdf, /\.pdf$/i), lang: LY.BASE, thread: !!(opts && opts.thread), cancelled: function () { return stop; }, matchFonts: matchFonts }, A.importFile, function (k, n) {
        LY.toast(t("rb.working", { n: k, t: n }), t("btn.cancel"), function () { stop = true; });
      });
    }).then(function (res) {
      rebuilding = false;
      if (res && res.cancelled) { LY.toast(t("rb.stopped")); return null; }
      if (!res) { LY.toast(t("rb.bad")); return null; }
      LY.addDoc(res.doc);
      LY.toast(t("rb.done", { p: res.report.pages }));
      reportDlg(res.report, opts && opts.chat);
      return res.report;
    }, function (e) { rebuilding = false; throw e; });
  }
  // The line breaks of a document's own print PDF (Scribus import):
  // → Promise of { msg: a sentence for the message, rep: matchPdf's
  // report or null }.
  function fitToPdf(doc, pdf) {
    var RB = window.LY_REBUILD, bad = { msg: " " + t("sla.fitBad"), rep: null };
    if (!RB || pdf.size > REBUILD_MAX) return Promise.resolve(bad);
    LY.toast(t("sla.fitting"));
    return pdf.arrayBuffer().then(function (buf) { return RB.pdfText(buf); }).then(function (txt) {
      if (!txt) return bad;
      var rep = RB.matchPdf(doc, txt.pages, { fitName: t("sla.fitStyle"), lang: LY.BASE === "el" ? "el" : "en", now: LY.now() });
      if (!rep.matched) return { msg: bad.msg, rep: rep };
      return { msg: " " + t("sla.fit", { n: rep.inPlace, t: rep.checked }), rep: rep };
    }).then(null, function () { return bad; });
  }
  // Font names from a PDF or another program's file → the same families
  // on the orOS disk or at Fontsource, loaded (LY-FONT); a family that
  // does not load is left out, so our fonts stand in for it.
  function matchFonts(names) {
    return F.library().then(function (lib) {
      var out = {}, chain = Promise.resolve();
      names.slice(0, 60).forEach(function (nm) {
        chain = chain.then(function () { return F.match(nm, lib, { offline: navigator.onLine === false }); }).then(function (e) { if (e) out[nm] = e; });
      });
      return chain.then(function () {
        var list = Object.keys(out).map(function (k) { return out[k]; });
        var keys = F.register({ setup: { ext: { fonts: list } }, pstyles: list.map(function (e) { return { ext: { fam: e.id } }; }), cstyles: [] });
        return T.load(keys).then(null, function () {}).then(function () {
          Object.keys(out).forEach(function (k) { if (!T.isLoaded(out[k].id + "-r")) delete out[k]; });
          return out;
        });
      });
    });
  }
  // Styles that name their font (ext.srcFont, from another program's
  // file) get that family when it is found; nothing changes otherwise.
  function useSrcFonts(doc) {
    var styles = doc.pstyles.concat(doc.cstyles), names = {};
    styles.forEach(function (s) { if (s.ext && typeof s.ext.srcFont === "string") names[s.ext.srcFont] = 1; });
    if (!Object.keys(names).length) return Promise.resolve();
    return matchFonts(Object.keys(names)).then(function (found) {
      var list = F.docFonts(doc);
      styles.forEach(function (s) {
        var e = s.ext && found[s.ext.srcFont];
        if (!e) return;
        s.ext.fam = e.id; s.font = e.fb;
        list = F.withEntry(list, e);
      });
      if (list.length) { doc.setup.ext = doc.setup.ext || {}; doc.setup.ext.fonts = list; }
    }, function () {});
  }
  function reportDlg(rep, chat) {
    var c = rep.check || { lines: 0, inPlace: 0 };
    var pct = c.lines ? Math.floor(c.inPlace / c.lines * 1000) / 10 : 100;
    var fmt = function (v) { return LY.BASE === "el" ? String(v).replace(".", ",") : String(v); };
    LY.openDialog(t("rb.title"), function (body, close) {
      var p = function (txt, cls) { body.appendChild(el("p", cls || "", txt)); };
      p(t("rb.lines", { n: c.inPlace, t: c.lines, p: fmt(pct) }));
      p(t("rb.pics", { n: rep.pictures, o: rep.originals }));
      p(t("rb.styles", { n: rep.styles }));
      if (rep.threads) p(t("rb.threads", { n: rep.threads.stories, f: rep.threads.frames }), "hint");
      if (rep.af && rep.af.failed) p(t("rb.afBad"), "hint");
      else if (rep.af) {
        p(t("rb.af", { n: rep.af.pictures }), "hint");
        if (rep.af.styles.length) p(t("rb.afStyles", { s: rep.af.styles.join(", ") }), "hint");
        if (rep.af.fonts.length) p(t("rb.afFonts", { f: rep.af.fonts.join(", ") }), "hint");
      }
      var fonts = (rep.fonts || []).filter(function (f) { return f.font && !f.as && !/^noto/i.test(f.font); }).map(function (f) { return f.font; });
      var same = {};
      (rep.fonts || []).forEach(function (f) { if (f.as) same[f.as] = 1; });
      if (Object.keys(same).length) p(t("rb.fontsSame", { f: Object.keys(same).join(", ") }), "hint");
      if (fonts.length) p(t("rb.fonts", { f: fonts.join(", ") }), "hint");
      if (rep.numberStart !== null && rep.numberStart !== 1) p(t("rb.numbers", { n: rep.numberStart }), "hint");
      if (rep.cut) p(t("pdf.cut", { n: rep.pages, t: rep.total }), "hint");
      var off = (rep.framesOff || []).slice(0, 200);
      if (off.length) {
        p(t("rb.off"), "hint");
        var ul = el("ul", "pf-list"), order = M.pagesInOrder(LY.doc);
        off.forEach(function (x) {
          var pg = order[x.page - 1], li = el("li"), b = el("button", "pf-item warn");
          if (!pg) return;
          b.type = "button";
          b.appendChild(el("span", "pf-dot"));
          b.appendChild(el("span", "", t("pf.page", { n: x.page }) + " · " + t("rb.offLine", { n: Math.max(x.moved, Math.abs(x.got - x.want)) })));
          b.addEventListener("click", function () { close(); ED.gotoItem(x.id); });
          li.appendChild(b);
          ul.appendChild(li);
        });
        body.appendChild(ul);
      }
      var act = el("div", "dlg-actions"), ok = el("button", "btn primary", t("btn.close"));
      ok.type = "button";
      ok.addEventListener("click", close);
      act.appendChild(el("span", "spacer"));
      if (chat) {
        var bk = el("button", "btn", t("rb.back"));
        bk.type = "button";
        bk.addEventListener("click", function () {
          close();
          try { window.parent.__orosOpenAt("assistant", { chat: chat }); } catch (e) {}
        });
        act.appendChild(bk);
      }
      act.appendChild(ok);
      body.appendChild(act);
    }, true);
  }
  // SVG pages (Affinity: File › Export › SVG, text not as curves)
  function importSvg(files) {
    var S = window.LY_SVGIN;
    if (!S || files.some(function (f) { return f.size > S.MAX_FILE; })) { LY.toast(t("svg.bad")); return; }
    LY.toast(t("svg.working"));
    files = files.slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name), undefined, { numeric: true }); });
    var parsed = [], chain = Promise.resolve();
    files.forEach(function (f) {
      chain = chain.then(function () { return f.text(); }).then(function (txt) {
        var p = null;
        try { p = S.parse(txt); } catch (e) { p = null; }
        if (p) parsed.push(p);
      });
    });
    return chain.then(function () {
      var res = null;
      try { res = parsed.length ? S.convert(parsed, { now: LY.now(), name: baseName(files[0], /\.svg$/i) }) : null; } catch (e) { res = null; }
      if (!res) { LY.toast(t("svg.bad")); return; }
      return addForeign(res, function (im) { return Promise.resolve(S.imageBlob(im)); }, t("svg.done", { p: res.stats.pages, n: res.stats.items }), "svg.skipped");
    }).then(null, function () { LY.toast(t("svg.bad")); });
  }
  // res: { doc, images, linked, links?, stats }; blobOf(image) →
  // Promise of a Blob or null; pics: Files for res.links, by name.
  // → Promise of { placed: linked pictures found, missing }
  function addForeign(res, blobOf, done, skipKey, pics) {
    var doc = res.doc, failed = 0, found = 0, chain = Promise.resolve();
    function put(itemId, blob) {
      return A.importFile(blob).then(function (r) {
        var it = M.find(doc.items, itemId);
        if (!it) return;
        it.a = r.id; it.iw = r.w; it.ih = r.h;
        placeAs(it);
      });
    }
    res.images.forEach(function (im) {
      chain = chain.then(function () { return blobOf(im); }).then(function (blob) {
        if (!blob) { failed++; return; }
        blob.name = im.name;
        return put(im.item, blob);
      }).then(null, function () { failed++; });
    });
    var byName = picsByName(pics);
    (res.links || []).forEach(function (ln) {
      var f = byName[nameKey(ln.name)];
      if (!f) return;
      chain = chain.then(function () { return put(ln.item, f); }).then(function () { found++; }, function () {});
    });
    return chain.then(function () {
      LY.addDoc(M.normDoc(doc));
      var parts = [done], left = res.linked - found + failed;
      if (left) parts.push(t("sla.linked", { n: left }));
      if (res.stats.skipped) parts.push(t(skipKey || "sla.skipped", { n: res.stats.skipped }));
      if (left && res.links) LY.toast(parts.join(" "), t("sla.find"), relinkPick);
      else LY.toast(parts.join(" "));
      return { placed: found, missing: left };
    });
  }
  var nameKey = function (n) { return window.LY_SLA.nameKey(n); }, placeAs = function (it) { window.LY_SLA.placePicture(it); };
  function picsByName(pics) {
    var out = {};
    (pics || []).forEach(function (f) { var k = nameKey(f.name); if (k && !out[k]) out[k] = f; });
    return out;
  }
  // Later: pick the missing pictures; frames of the open document that
  // name them get them, placed as they were.
  function relinkPick() {
    return pickFiles("image/*").then(function (files) {
      if (files.length) return relink(files);
    }).then(null, function () { LY.toast(t("img.fail")); });
  }
  function relink(files) {
    var doc = LY.doc, byName = picsByName(files), want = {}, chain = Promise.resolve(), got = {};
    if (!doc) return Promise.resolve(0);
    doc.items.forEach(function (it) { if (it.t === "img" && !it.a && it.nm && byName[nameKey(it.nm)]) want[nameKey(it.nm)] = byName[nameKey(it.nm)]; });
    Object.keys(want).forEach(function (k) {
      chain = chain.then(function () { return A.importFile(want[k]); }).then(function (r) { got[k] = r; }, function () {});
    });
    return chain.then(function () {
      var n = 0;
      LY.op(function (d) {
        d.items.forEach(function (it) {
          var r = it.t === "img" && !it.a && it.nm ? got[nameKey(it.nm)] : null;
          if (!r) return;
          it.a = r.id; it.iw = r.w; it.ih = r.h;
          placeAs(it);
          n++;
        });
        return n > 0;
      });
      var left = LY.doc.items.filter(function (it) { return it.t === "img" && !it.a && it.nm; }).length;
      LY.toast(t("sla.relinked", { n: n }) + (left ? " " + t("sla.linked", { n: left }) : ""));
      return n;
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
          it.ix = 0; it.iy = 0; it.isc = 1; LY.R.uniform(it);
          if (it.fit === "custom") it.fit = "fill";
          M.touch(it, now);
        });
        LY.toast(t("img.placed"));
      }, function (e) {
        LY.toast(e && e.message === "nofs" ? t("img.nofs") : t("img.fail"));
      });
    });
  }

  // A picture from another app ("Send to…" → the deep link
  // { placeImage }): a new image frame on the current page, as large as
  // the margins allow with the picture's proportions, centred, one Undo
  // step. No document open → a new one with the New document defaults,
  // named after the picture.
  var IMG_MAX = 50 * 1024 * 1024;
  function placeFromBlob(blob, name) {
    name = String(name || "").slice(0, 120);
    if (!blob || !blob.size || blob.size > IMG_MAX) { LY.toast(t("img.fail")); return Promise.resolve(false); }
    var file = new File([blob], name || "picture", { type: blob.type || "" });
    return A.importFile(file).then(function (res) {
      if (!LY.doc) {
        var s = LY.newDocSetup();
        s.name = name.replace(/\.[^.]+$/, "").trim() || t("doc.untitled");
        LY.createDoc(s);
        if (!LY.doc) return false;
      }
      LY.flushStory && LY.flushStory();
      var P0 = ED.curP(), made = null;
      if (!P0) { LY.toast(t("img.fail")); return false; }
      LY.op(function (doc, now) {
        var mb = ED.marginBox(doc, P0.side);
        var k = Math.min(mb.w / res.w, mb.h / res.h), w = res.w * k, h = res.h * k;
        made = ED.addItem(doc, { t: "img", pg: P0.id, side: P0.master ? P0.side : "",
                                 x: mb.x + (mb.w - w) / 2, y: mb.y + (mb.h - h) / 2, w: w, h: h }, now);
        if (!made) return false;
        made.a = res.id; made.nm = res.name; made.iw = res.w; made.ih = res.h;
      });
      if (!made) return false;
      ED.select([made.id]);
      LY.toast(t("img.sent"));
      return true;
    }, function (e) {
      LY.toast(e && e.message === "nofs" ? t("img.nofs") : t("img.fail"));
      return false;
    });
  }

  // ---------- Text ----------
  // Plain text: one paragraph per line (blank lines dropped). A Word,
  // OpenDocument, RTF, HTML or Markdown file: read by Writer's own
  // reader (writer/io.js) and given paragraph styles through the
  // document's mapping (layout/wordin.js, LY-WD), chosen in a dialog.
  // Either goes into the selected text frame's story (appended), or a
  // new frame filling the current page's margins.
  var TEXT_ACCEPT = ".txt,.md,.markdown,.docx,.odt,.rtf,.html,.htm,text/plain";
  var DOC_MAX = 64 * 1024 * 1024;
  function script(src, name) {
    if (window[name]) return Promise.resolve(window[name]);
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { if (window[name]) res(window[name]); else rej(new Error(name)); };
      s.onerror = function () { rej(new Error(name)); };
      document.head.appendChild(s);
    });
  }
  function importText() {
    if (!LY.doc) return;
    pickFile(TEXT_ACCEPT).then(function (f) {
      if (!f) return;
      var ext = (/\.([a-z]+)$/i.exec(f.name || "") || ["", "txt"])[1].toLowerCase();
      if (ext !== "txt") return importDoc(f, ext);
      if (f.size > TXT_MAX) { LY.toast(t("txt.fail")); return; }
      return f.text().then(function (txt) {
        var lines = String(txt).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/\t/g, " ")
          .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").split("\n")
          .map(function (s) { return s.replace(/\s+$/, ""); }).filter(function (s) { return s.trim(); });
        if (!lines.length) { LY.toast(t("txt.fail")); return; }
        // the body style of the document's Word mapping (LY-WD), if any
        var wm = LY.doc.setup.ext && LY.doc.setup.ext.wmap, ps = wm && M.find(LY.doc.pstyles, wm.p) ? wm.p : "ps-body";
        var fx = houseFix(lines.map(function (s) { return { ps: ps, runs: [{ t: s }] }; }));
        placeParas(fx.paras, null);
        LY.toast(t("txt.done") + fx.note);
      });
    }).then(null, function () { LY.toast(t("txt.fail")); });
  }
  function importDoc(f, ext) {
    return readDoc(f, ext).then(function (r) {
      var W = window.LY_WORDIN, n = r && W.counts(r.list);
      if (!n || !Object.keys(n).length) { LY.toast(t("txt.fail")); return; }
      mapDlg(W, n, function (map) {
        var fx = houseFix(W.paras(r.list, map));
        placeParas(fx.paras, map);
        LY.toast(t("wd.done", { n: r.list.length }) + fx.note);
      });
    });
  }
  // A text or document file → Promise of { list (wordin paragraphs with
  // roles), pictures (how many the file has; not placed) } or null.
  // Plain text: one paragraph per line, blank lines kept as empty ones.
  // opts.pics: the pictures as entries of the list (LY-IN), and the
  // footnotes' marks as runs with notes: [{ id, text }] (LY-NT)
  function readDoc(f, ext, opts) {
    var po = opts && opts.pics ? { pics: 1, notes: 1 } : null;
    ext = ext || (/\.([a-z]+)$/i.exec(f.name || "") || ["", "txt"])[1].toLowerCase();
    if (f.size > (ext === "txt" ? TXT_MAX : DOC_MAX)) return Promise.resolve(null);
    var zip = ext === "docx" || ext === "odt";
    return Promise.all([script("../writer/io.js", "WriterIO"), script("wordin.js", "LY_WORDIN"), zip ? f.arrayBuffer() : f.text()]).then(function (r) {
      var IO = r[0], W = r[1];
      if (ext === "txt") {
        var esc = function (x) { return x.replace(/&/g, "&amp;").replace(/</g, "&lt;"); };
        var html = String(r[2]).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n").map(function (x) { return "<p>" + esc(x) + "</p>"; }).join("");
        return { list: W.parse(html), pictures: 0 };
      }
      return Promise.resolve(zip ? IO.parseZipBuf(r[2], ext) : IO.parseTextOf(r[2], ext)).then(function (pl) {
        var html = String(pl && pl.html || "");
        return { list: W.parse(html, po), pictures: (html.match(/<img\b/gi) || []).length, notes: po && Array.isArray(pl.footnotes) ? pl.footnotes : [] };
      });
    });
  }
  // a document made from a house style (LY-HS) fixes quotes, dashes,
  // ellipses and spaces as its rules say; words never change
  function houseFix(paras) {
    var H = window.LY_HOUSE, h = H && H.houseOf(LY.doc);
    if (!h) return { paras: paras, note: "" };
    var r = H.fixText(paras, h.rules), n = r.n.quotes + r.n.dash + r.n.ellipsis + r.n.spaces;
    return { paras: r.paras, note: n ? " · " + t("hs.fixed", { n: n }) : "" };
  }
  // one row per kind of paragraph the file has: its paragraph style
  function mapDlg(W, n, go) {
    var doc = LY.doc, map = W.mapOf(doc);
    var opts = doc.pstyles.map(function (s) { return [s.id, LY.label(s.name) || s.id]; });
    LY.openDialog(t("wd.title"), function (body, close) {
      body.appendChild(el("p", "hint", t("wd.hint")));
      W.ROLES.forEach(function (r) {
        if (!n[r]) return;
        body.appendChild(LY.ui.field(t("wd." + r) + " (" + n[r] + ")", LY.ui.select(opts, map[r], function (v) { map[r] = v; })));
      });
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      act.appendChild(LY.ui.btn(t("btn.cancel"), close));
      act.appendChild(LY.ui.btn(t("wd.go"), function () { close(); go(map); }, "primary"));
      body.appendChild(act);
    });
  }
  // paragraphs into the selected text frame or a new one; map: the
  // mapping to keep with the document (setup.ext.wmap), or null
  function placeParas(paras, map) {
    LY.flushStory && LY.flushStory();
    var sel = ED.selItems().filter(function (it) { return it.t === "text"; });
    var target = sel.length === 1 ? sel[0] : null, made = null;
    LY.op(function (doc, now) {
      var x = doc.setup.ext || {};
      if (map && JSON.stringify(x.wmap) !== JSON.stringify(map)) {
        x.wmap = map;
        doc.setup.ext = x;
        doc.m = now;
      }
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
  }

  LY.io = {
    exportPdf: exportPdf, pdfBlob: pdfBlob, saveBlob: saveBlob, fileName: fileName, exportImage: exportImage, exportPackage: exportPackage, importPackage: importPackage, importFolder: importFolder, openFile: openFile, importMany: importMany, importDisk: importDisk, packagesIn: packagesIn,
    placeImage: placeImage, importText: importText, readDoc: readDoc, TEXT_ACCEPT: TEXT_ACCEPT, openSla: importSla, isPicture: isPicture, placeFromBlob: placeFromBlob, rebuildPdf: rebuildPdf, rebuild: rebuild,
    // for the data merge (mergeui.js)
    saveBlob: saveBlob, pickFile: pickFile, pickFiles: pickFiles, greyBlob: greyBlob, loadJsPDF: loadJsPDF, fileName: fileName
  };
})();
