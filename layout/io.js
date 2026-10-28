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
//   - Place image, import plain text, a picture sent from another app.
// All file I/O goes through orosDialog (R33).
// ============================================================
(function () {
  "use strict";

  var LY = window.LY, M = LY.M, T = LY.T, P = LY.P, A = LY.A, t = LY.t;
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
  function bundleFail(e) { LY.toast(e && e.code === "newer" ? t("imp.newer") : t("imp.bad")); }
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
      return window.OrosBundle.readFolder(files, { mime: BUNDLE_MIME }).then(fromBundle, bundleFail);
    }).then(null, function () { LY.toast(t("imp.bad")); });
  }

  // Open a file: a .oroslayout package, a Scribus .sla, an InDesign
  // .idml, a PDF or SVG pages (Affinity and others). Several SVG files
  // at once become one document, a page each (by file name); other
  // files picked together open one after another.
  var OPEN_ACCEPT = ".oroslayout,.sla,.gz,.idml,.pdf,.svg,application/json,.json,application/xml,text/xml,application/vnd.adobe.indesign-idml-package,application/pdf,image/svg+xml";
  function isSvg(f) { return /\.svg$/i.test(f.name || "") || f.type === "image/svg+xml"; }
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
      if (f.size > PKG_MAX) { LY.toast(t("imp.bad")); return; }
      return f.slice(0, 4).arrayBuffer().then(function (head) {
        if (window.OrosBundle.sniff(new Uint8Array(head)) !== null) {
          return f.arrayBuffer().then(function (ab) {
            return window.OrosBundle.read(new Uint8Array(ab), { mime: BUNDLE_MIME });
          }).then(fromBundle, bundleFail);
        }
        return f.text().then(function (txt) {
          var pkg = null;
          try { pkg = JSON.parse(txt); } catch (e) {}
          return openPackage(pkg);
        });
      });
    }).then(null, function () { LY.toast(t("imp.bad")); });
  }
  // pkg.assets: base64 (older JSON packages) or bytes (bundles)
  function openPackage(pkg) {
    return Promise.resolve().then(function () {
      var doc = pkg && pkg.kind === PKG_KIND && pkg.ver === PKG_VER ? M.normDoc(pkg.doc) : null;
      if (!doc) { LY.toast(t("imp.bad")); return; }
      // a NEW document: never overwrites or resurrects another one
      doc.id = M.newId("doc");
      doc.m = LY.now();
      var assets = pkg.assets && typeof pkg.assets === "object" ? pkg.assets : {};
      var failed = 0, chain = Promise.resolve();
      assetIds(doc).forEach(function (id) {
        var b64 = assets[id];
        if (!(typeof b64 === "string" || b64 instanceof Uint8Array) || !A.ID_RE.test(id)) { failed++; return; }
        chain = chain.then(function () {
          var type = /\.png$/.test(id) ? "image/png" : "image/jpeg";
          return A.put(id, typeof b64 === "string" ? b64ToBlob(b64, type) : new Blob([b64], { type: type }));
        }).then(null, function () { failed++; });
      });
      return chain.then(function () {
        LY.addDoc(doc);
        LY.toast(failed ? t("imp.imgFail", { n: failed }) : t("imp.done"));
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
    // a compressed .sla.gz is unpacked first (gzip magic, not the name)
    return f.arrayBuffer().then(function (buf) {
      var u = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
      return u[0] === 0x1f && u[1] === 0x8b ? window.LY_SLA.gunzip(buf) : new TextDecoder().decode(buf);
    }).then(function (txt) {
      var res = null;
      if (typeof txt !== "string") { LY.toast(t("sla.bad")); return; }
      try { res = window.LY_SLA.convert(txt, { now: LY.now(), name: baseName(f, /\.sla(\.gz)?$/i) }); } catch (e) { res = null; }
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
      var msg = t("pdf.done", { p: res.stats.pages, n: res.stats.frames, i: res.stats.pictures || 0 });
      if (res.stats.cut) msg += " " + t("pdf.cut", { n: res.stats.pages, t: res.stats.total });
      LY.toast(msg);
    }).then(null, function () { LY.toast(t("pdf.bad")); });
  }
  // Rebuild a print PDF: the PDF (its trim box) and, picked with it,
  // the original pictures and texts → a NEW document that looks like
  // the PDF, then the report of what landed where it was.
  var REBUILD_ACCEPT = ".pdf,application/pdf,image/*,.jpg,.jpeg,.png,.webp,.tif,.tiff,.txt,.md,.html,.htm";
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
      if (pdf.size > FOREIGN_MAX) { LY.toast(t("pdf.bad")); return; }
      return rebuild(pdf, files.filter(function (f) { return f !== pdf; }));
    }).then(null, function () { rebuilding = false; LY.toast(t("rb.bad")); });
  }
  // also for the Assistant: pdf (a File), sources (Files) → Promise of
  // the report, or null
  function rebuild(pdf, sources) {
    var RB = window.LY_REBUILD;
    if (!RB || rebuilding) return Promise.resolve(null);
    rebuilding = true;
    var stop = false;
    LY.toast(t("rb.start", { n: sources.length }), t("btn.cancel"), function () { stop = true; });
    return pdf.arrayBuffer().then(function (buf) {
      return RB.open(buf, sources, { now: LY.now(), name: baseName(pdf, /\.pdf$/i), lang: LY.BASE, cancelled: function () { return stop; } }, A.importFile, function (k, n) {
        LY.toast(t("rb.working", { n: k, t: n }), t("btn.cancel"), function () { stop = true; });
      });
    }).then(function (res) {
      rebuilding = false;
      if (res && res.cancelled) { LY.toast(t("rb.stopped")); return null; }
      if (!res) { LY.toast(t("rb.bad")); return null; }
      LY.addDoc(res.doc);
      LY.toast(t("rb.done", { p: res.report.pages }));
      reportDlg(res.report);
      return res.report;
    }, function (e) { rebuilding = false; throw e; });
  }
  function reportDlg(rep) {
    var c = rep.check || { lines: 0, inPlace: 0 };
    var pct = c.lines ? Math.floor(c.inPlace / c.lines * 1000) / 10 : 100;
    var fmt = function (v) { return LY.BASE === "el" ? String(v).replace(".", ",") : String(v); };
    LY.openDialog(t("rb.title"), function (body, close) {
      var p = function (txt, cls) { body.appendChild(el("p", cls || "", txt)); };
      p(t("rb.lines", { n: c.inPlace, t: c.lines, p: fmt(pct) }));
      p(t("rb.pics", { n: rep.pictures, o: rep.originals }));
      p(t("rb.styles", { n: rep.styles }));
      var fonts = (rep.fonts || []).filter(function (f) { return f.font && !/^noto/i.test(f.font); }).map(function (f) { return f.font; });
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
  // res: { doc, images, linked, stats }; blobOf(image) → Promise of a
  // Blob or null
  function addForeign(res, blobOf, done, skipKey) {
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
      if (res.stats.skipped) parts.push(t(skipKey || "sla.skipped", { n: res.stats.skipped }));
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
    exportPdf: exportPdf, pdfBlob: pdfBlob, saveBlob: saveBlob, fileName: fileName, exportImage: exportImage, exportPackage: exportPackage, importPackage: importPackage, importFolder: importFolder, openFile: openFile,
    placeImage: placeImage, importText: importText, placeFromBlob: placeFromBlob, rebuildPdf: rebuildPdf, rebuild: rebuild,
    // for the data merge (mergeui.js)
    saveBlob: saveBlob, pickFile: pickFile, loadJsPDF: loadJsPDF, fileName: fileName
  };
})();
