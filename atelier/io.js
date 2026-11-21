// ============================================================
// orOS Atelier — files in and out + the editor bar (v1.0.0)
//   - Download: PNG (optionally transparent), JPG, PDF, PowerPoint
//     (.pptx, editable in Canva / PowerPoint: pptxout.js; what it
//     can't keep editable is drawn here as a picture), Web page (a
//     ZIP site: webout.js; photos, charts, blurred effects drawn here). Pages are
//     drawn by draw.js at full resolution (what you see is what you
//     get, effects and filters included); a PDF holds one image per
//     page at 150 or 300 dpi (jsPDF, loaded on first use).
//   - .orosdesign package: an orOS bundle (bundle.js): a ZIP with the
//     design (content.json), its pictures and clips (media/) and a
//     thumbnail; older JSON packages (images as base64) still open.
//     Opened as a NEW design, every image checked against its hash
//     and decoded as an image before it is stored. An unzipped
//     bundle opens too (Import › Unzipped folder).
//   - Uploads: images go through designkit/assets.js (re-encoded,
//     metadata dropped, stored once on the orOS disk).
//   - Resize, credits, copy / paste, rename.
// All file I/O goes through orosDialog (R33).
// ============================================================
(function () {
  "use strict";

  var AT = window.AT, M = AT.M, T = AT.T, A = AT.A, AX = AT.AX, t = AT.t, $ = AT.$, el = AT.el;
  var ED = AT.ed, MEDIA = window.orosDK.media;
  var PKG_KIND = "oros-atelier-package", PKG_VER = 1;
  var PKG_MAX = 300 * 1024 * 1024;
  var MAX_SIDE = 16384, MAX_PIXELS = 16.7e6;      // safe canvas limits (iOS Safari)

  function fileName(doc, ext, n) {
    var b = String(doc.name || "design").replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 80) || "design";
    return b + (n ? "-" + n : "") + ext;
  }

  function saveBlob(blob, name, mime, desc, ext) {
    var dlg = AT.dialogHost();
    var types = [{ description: desc, accept: {} }];
    types[0].accept[mime] = [ext];
    if (dlg && typeof dlg.saveFile === "function") {
      return dlg.saveFile({ blob: blob, filename: name, mime: mime, types: types }).then(function (r) { return !!(r && r.ok); });
    }
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 40000);
    return Promise.resolve(true);
  }

  function pickFile(accept) {
    var dlg = AT.dialogHost();
    if (dlg && typeof dlg.openFile === "function") return dlg.openFile(accept);
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file"; inp.accept = accept;
      inp.addEventListener("change", function () { resolve(inp.files && inp.files[0] || null); });
      inp.click();
    });
  }

  function toBlob(cv, type, q) {
    return new Promise(function (resolve, reject) {
      cv.toBlob(function (b) { if (b) resolve(b); else reject(new Error("encode")); }, type, q);
    });
  }

  // ---------- Export ----------
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

  // px per pt, capped to what a canvas can hold
  function safeScale(doc, scale) {
    var w = doc.setup.w * scale, h = doc.setup.h * scale;
    var k = Math.min(1, MAX_SIDE / Math.max(w, h), Math.sqrt(MAX_PIXELS / (w * h)));
    return scale * k;
  }
  function pixelSize(doc, scale) {
    var s = safeScale(doc, scale);
    return { w: Math.round(doc.setup.w * s), h: Math.round(doc.setup.h * s) };
  }

  // Everything a page needs before drawing at full size (scale: px
  // per pt, for the chart pictures).
  function prepare(doc, scale) {
    return T.load(AT.draw.fontKeys(doc)).then(function () {
      return Promise.all(AX.assetIds(doc).map(function (id) { return A.load(id); }));
    }).then(function () { return AT.charts ? AT.charts.prepare(doc, scale || 2) : null; });
  }
  AT.prepareDoc = prepare;

  function renderForExport(doc, pg, scale, transparent) {
    var skip = null;
    if (transparent) {
      var bg = AX.background(doc, pg.id);
      if (bg) { skip = {}; skip[bg.id] = 1; }
    }
    if (!skip) return AT.draw.renderPage(doc, pg, safeScale(doc, scale), { maxSide: 0, background: "#ffffff" });
    var s = safeScale(doc, scale), cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(doc.setup.w * s)); cv.height = Math.max(1, Math.round(doc.setup.h * s));
    var ctx = cv.getContext("2d");
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.beginPath(); ctx.rect(0, 0, doc.setup.w, doc.setup.h); ctx.clip();
    AT.draw.drawPage(ctx, doc, pg, { maxSide: 0, clean: true, skip: skip });
    return cv;
  }

  // PowerPoint: the images as they are stored, and every element that
  // can't stay editable drawn alone (no rotation: the slide rotates it)
  var PPTX_SIDE = 3000;
  function rasterItem(doc, it) {
    var ax = it.ax;
    var pad = ax.k === "text" ? (ax.size || AX.TEXT_DEF.size) * 0.6 : ax.k === "icon" ? (it.sw || 2) * 2 + 2 : ax.k === "table" ? (it.sw || 0) :
      ax.k === "photo" && window.AtelierPhotoFx ? window.AtelierPhotoFx.pad(it, window.AtelierPhotoFx.of(it)) : 0;
    var W = it.w + pad * 2, H = it.h + pad * 2;
    var s = Math.max(0.05, Math.min(3, PPTX_SIDE / Math.max(W, H)));
    var cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(W * s)); cv.height = Math.max(1, Math.round(H * s));
    var ctx = cv.getContext("2d");
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.translate(pad - it.x, pad - it.y);
    var c = {};
    Object.keys(it).forEach(function (k) { c[k] = it[k]; });
    c.rot = 0;
    AT.draw.drawItem(ctx, doc, c, { maxSide: 0, clean: true });
    return toBlob(cv, "image/png").then(function (b) { return b.arrayBuffer(); })
      .then(function (ab) { return { png: new Uint8Array(ab), pad: pad }; });
  }
  function exportPptx(doc, pages) {
    var O = window.AtelierPPTXOut, need = O.needs(doc), media = {}, out = null;
    var chain = Promise.resolve();
    need.assets.forEach(function (id) {
      chain = chain.then(function () { return A.blob(id); }).then(function (b) { return b ? b.arrayBuffer() : null; })
        .then(function (ab) { if (ab) media["a:" + id] = new Uint8Array(ab); });
    });
    var only = {};
    pages.forEach(function (p) { only[p.id] = 1; });
    need.raster.forEach(function (id) {
      var it = doc.items.filter(function (x) { return x.id === id; })[0];
      if (!it || !only[it.pg]) return;
      chain = chain.then(function () { return rasterItem(doc, it); }).then(function (r) { media["r:" + id] = r; });
    });
    return chain.then(function () {
      var r = O.build(doc, media, { pages: pages.map(function (p) { return p.id; }) });
      out = r.out;
      return saveBlob(new Blob([r.bytes], { type: O.MIME }), fileName(doc, ".pptx"), O.MIME, "PowerPoint", ".pptx");
    }).then(function (ok) { return ok ? { pics: out.raster } : false; });
  }

  // PDF with real text (pdfout.js): every element that the PDF can't
  // draw itself is drawn here as a picture at `dpi` (no rotation, no
  // transparency: the PDF applies both), photos cut to their shape
  // by the PDF's clipping path.
  function pictureOf(doc, it, p, dpi) {
    var pad = p.pad, W = Math.max(1, it.w) + 2 * pad, H = Math.max(1, it.h) + 2 * pad;
    var s = Math.max(0.05, Math.min(dpi / 72, MAX_SIDE / Math.max(W, H), Math.sqrt(MAX_PIXELS / (W * H))));
    if (it.ax.k === "photo" && it.iw) s = Math.min(s, Math.max(1, it.iw / it.w * 1.2));
    var cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(W * s)); cv.height = Math.max(1, Math.round(H * s));
    var ctx = cv.getContext("2d");
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.translate(pad - it.x, pad - it.y);
    var c = JSON.parse(JSON.stringify(it));
    c.rot = 0; c.op = 100;
    var o = { maxSide: 0, clean: true };
    if (p.kind === "photo") delete c.ax.shp;
    if (p.kind === "textfx") o.passFilter = function (q) { return q.blur > 0; };
    AT.draw.drawItem(ctx, doc, c, o);
    var jpeg = p.kind === "photo" ? !/\.png$/.test(it.a || "") : (it.ax.bg && it.ax.k === "shape");
    return toBlob(cv, jpeg ? "image/jpeg" : "image/png", 0.9).then(function (b) { return b.arrayBuffer(); }).then(function (ab) {
      return { data: new Uint8Array(ab), fmt: jpeg ? "JPEG" : "PNG", x: -pad, y: -pad, w: W, h: H };
    });
  }
  function exportPdf(doc, pages, dpi, J) {
    return pdfBlob(doc, pages, dpi, J).then(function (b) {
      return saveBlob(b, fileName(doc, ".pdf"), "application/pdf", "PDF", ".pdf");
    });
  }
  function pdfBlob(doc, pages, dpi, J) {
    var P = window.AtelierPDF, ids = pages.map(function (p) { return p.id; });
    var plan = P.plan(doc, ids), pics = {}, chain = Promise.resolve();
    plan.filter(P.needsPicture).forEach(function (p) {
      var it = M.find(doc.items, p.id);
      if (!it) return;
      chain = chain.then(function () { return pictureOf(doc, it, p, dpi); }).then(function (pic) { pics[p.id] = pic; });
    });
    return chain.then(function () {
      var pdf = P.build(doc, { pages: ids, title: doc.name || "" }, { jsPDF: J, pictures: pics, plan: plan });
      return pdf.output("blob");
    });
  }

  // Web page (webout.js): a ZIP with index.html, style.css, img/ and
  // fonts/. Pictures at 2 px per point (sharp on phones), photos cut
  // to their shape by the page itself.
  var WEB_DPI = 144;
  function nativeOfl() {
    return fetch("../vendor/noto/OFL.txt", { credentials: "omit" }).then(function (r) { return r.ok ? r.text() : null; }, function () { return null; });
  }
  function exportWeb(doc, pages) {
    var WB = window.AtelierWeb, ids = pages.map(function (p) { return p.id; });
    var plan = WB.plan(doc, ids), pics = {}, chain = Promise.resolve(), ofl = null;
    plan.filter(WB.needsPicture).forEach(function (p) {
      var it = M.find(doc.items, p.id);
      if (!it) return;
      chain = chain.then(function () { return pictureOf(doc, it, p, WEB_DPI); }).then(function (pic) { pics[p.id] = pic; });
    });
    return chain.then(nativeOfl).then(function (txt) {
      ofl = txt;
      var out = WB.build(doc, {
        pages: ids, title: doc.name || "", lang: AT.LANG,
        credits: MEDIA ? MEDIA.credits(AX.credits(doc), AT.BASE) : [],
        maxWidth: AT.isPrint(doc) ? doc.setup.w * 4 / 3 : doc.setup.w,
        fontNote: t("exp.web")
      }, { plan: plan, pictures: pics, ofl: ofl });
      var zip = window.AtelierZip.write(out.files, new Date());
      return saveBlob(new Blob([zip], { type: "application/zip" }), fileName(doc, " (web).zip"), "application/zip", "ZIP", ".zip");
    }).then(function (ok) { return ok ? { web: 1 } : false; });
  }

  // SVG (VEC-4, webout.svgFile): a page or some of its elements as one
  // SVG file; pictures drawn as for the web page, embedded.
  function svgOf(doc, pg, ids) {
    var WB = window.AtelierWeb, pics = {}, chain = Promise.resolve();
    var plan = WB.plan(doc, [pg]).filter(function (p) { return !ids || ids.indexOf(p.id) >= 0; });
    plan.filter(WB.needsPicture).forEach(function (p) {
      var it = M.find(doc.items, p.id);
      if (!it) return;
      chain = chain.then(function () { return pictureOf(doc, it, p, WEB_DPI); }).then(function (pic) { pics[p.id] = pic; });
    });
    return chain.then(function () { return WB.svgFile(doc, pg, { ids: ids }, { plan: plan, pictures: pics }); });
  }
  function exportSvg(doc, pages) {
    var ok = true, c2 = Promise.resolve();
    pages.forEach(function (pg, i) {
      c2 = c2.then(function () { return svgOf(doc, pg.id, null); }).then(function (r) {
        if (!r) return;
        return saveBlob(new Blob([r.svg], { type: "image/svg+xml" }), fileName(doc, ".svg", pages.length > 1 ? i + 1 : 0), "image/svg+xml", "SVG", ".svg")
          .then(function (x) { ok = ok && x; });
      });
    });
    return c2.then(function () { return ok; });
  }
  // The picked elements: "copy" to the clipboard (as SVG and as text),
  // "save" as a file.
  function svgSelection(mode) {
    var doc = AT.doc, ids = ED.sel.slice();
    if (!doc || !ids.length) return;
    ED.exitText();
    prepare(doc, WEB_DPI / 72).then(function () { return svgOf(doc, ED.pg, ids); }).then(function (r) {
      if (!r) { AT.toast(t("svg.none")); return; }
      if (mode === "save") {
        return saveBlob(new Blob([r.svg], { type: "image/svg+xml" }), fileName(doc, ".svg"), "image/svg+xml", "SVG", ".svg")
          .then(function (ok) { if (ok) AT.toast(t("exp.done")); });
      }
      var cb = navigator.clipboard, done = function () { AT.toast(t("svg.copied")); };
      if (!cb) { AT.toast(t("svg.noClip")); return; }
      var plain = function () { return cb.writeText(r.svg).then(done); };
      if (typeof ClipboardItem === "function" && cb.write && ClipboardItem.supports && ClipboardItem.supports("image/svg+xml")) {
        return cb.write([new ClipboardItem({ "image/svg+xml": new Blob([r.svg], { type: "image/svg+xml" }), "text/plain": new Blob([r.svg], { type: "text/plain" }) })])
          .then(done, plain);
      }
      return plain();
    }).then(null, function (e) {
      try { console.error("[orOS] atelier: svg failed", e); } catch (x) {}
      AT.toast(t("svg.noClip"));
    });
  }

  // Every page of a design as files, not saved (automations, recipes.js):
  // o = { fmt png|jpg|pdf, scale, dpi } → [{ name, blob }]
  function renderFiles(doc, o) {
    var pages = M.pagesInOrder(doc);
    var chain = prepare(doc, o.fmt === "pdf" ? o.dpi / 72 : safeScale(doc, o.scale || 1));
    if (o.fmt === "pdf") {
      return chain.then(loadJsPDF).then(function (J) { return pdfBlob(doc, pages, o.dpi, J); })
        .then(function (b) { return [{ name: fileName(doc, ".pdf"), blob: b }]; });
    }
    var mime = o.fmt === "png" ? "image/png" : "image/jpeg", ext = o.fmt === "png" ? ".png" : ".jpg", out = [];
    return chain.then(function () {
      var c2 = Promise.resolve();
      pages.forEach(function (pg, i) {
        c2 = c2.then(function () {
          return toBlob(renderForExport(doc, pg, o.scale || 1, false), mime, 0.92).then(function (b) {
            out.push({ name: fileName(doc, ext, pages.length > 1 ? i + 1 : 0), blob: b });
          });
        });
      });
      return c2.then(function () { return out; });
    });
  }

  var exporting = false;
  function doExport(o) {
    var doc = AT.doc;
    if (!doc || exporting) return;
    ED.exitText();
    exporting = true;
    // Record (recipes.js) notes a download of the whole design
    if (/^(png|jpg|pdf)$/.test(o.type) && o.pages !== "cur") AT.emit("rc-note", { op: "export", fmt: o.type, scale: o.scale || 1, dpi: o.dpi || 300 });
    AT.toast(t("exp.working"));
    if (o.type === "video" || o.type === "gif") {
      AT.motion.exportFilm({ type: o.type, side: o.side, pages: o.pages }, function (blob, ext, mime) {
        return saveBlob(blob, fileName(doc, ext), mime, o.type === "gif" ? "GIF" : t("exp.video"), ext);
      }).then(function (ok) {
        exporting = false;
        if (ok) AT.toast(AX.credits(doc).length ? t("exp.credits") : t("exp.done"));
      }, function (e) {
        exporting = false;
        try { console.error("[orOS] atelier: film export failed", e); } catch (x) {}
        AT.toast(t("exp.fail"));
      });
      return;
    }
    var pages = M.pagesInOrder(doc);
    if (o.pages === "cur") pages = pages.filter(function (p) { return p.id === ED.pg; });
    var chain = prepare(doc, o.type === "pdf" ? o.dpi / 72 : o.type === "pptx" ? 3 : o.type === "web" || o.type === "svg" ? WEB_DPI / 72 : safeScale(doc, o.scale || 1));
    var mime = o.type === "png" ? "image/png" : "image/jpeg";
    if (o.type === "pptx") {
      chain = chain.then(function () { return exportPptx(doc, pages); });
    } else if (o.type === "web") {
      chain = chain.then(function () { return exportWeb(doc, pages); });
    } else if (o.type === "svg") {
      chain = chain.then(function () { return exportSvg(doc, pages); });
    } else if (o.type === "pdf" && !o.flat && window.AtelierPDF) {
      chain = chain.then(loadJsPDF).then(function (J) { return exportPdf(doc, pages, o.dpi, J); });
    } else if (o.type === "pdf") {
      var J;
      chain = chain.then(loadJsPDF).then(function (j) {
        J = j;
        var w = doc.setup.w, h = doc.setup.h, orient = w > h ? "l" : "p";
        var pdf = new J({ unit: "pt", format: [w, h], orientation: orient, compress: true });
        pdf.setProperties({ title: doc.name || "", creator: "orOS Atelier" });
        var c2 = Promise.resolve();
        pages.forEach(function (pg, i) {
          c2 = c2.then(function () {
            var cv = renderForExport(doc, pg, o.dpi / 72, false);
            return toBlob(cv, "image/jpeg", 0.92).then(function (b) { return b.arrayBuffer(); }).then(function (ab) {
              if (i > 0) pdf.addPage([w, h], orient);
              pdf.addImage(new Uint8Array(ab), "JPEG", 0, 0, w, h, "pg" + i, "NONE");
            });
          });
        });
        return c2.then(function () {
          return saveBlob(pdf.output("blob"), fileName(doc, ".pdf"), "application/pdf", "PDF", ".pdf");
        });
      });
    } else {
      chain = chain.then(function () {
        var ok = true, c2 = Promise.resolve();
        pages.forEach(function (pg, i) {
          c2 = c2.then(function () {
            var cv = renderForExport(doc, pg, o.scale, o.type === "png" && o.transparent);
            return toBlob(cv, mime, 0.92).then(function (b) {
              var ext = o.type === "png" ? ".png" : ".jpg";
              return saveBlob(b, fileName(doc, ext, pages.length > 1 ? i + 1 : 0), mime, o.type.toUpperCase(), ext);
            }).then(function (r) { ok = ok && r; });
          });
        });
        return c2.then(function () { return ok; });
      });
    }
    chain.then(function (ok) {
      exporting = false;
      if (ok && ok.pics) AT.toast(t("exp.pptxPics", { n: ok.pics }));
      else if (ok && ok.web) AT.toast(AX.credits(doc).length ? t("exp.credits") : t("exp.webDone"));
      else if (ok) AT.toast(AX.credits(doc).length ? t("exp.credits") : t("exp.done"));
    }, function (e) {
      exporting = false;
      try { console.error("[orOS] atelier: export failed", e); } catch (x) {}
      AT.toast(t("exp.fail"));
    });
  }

  function exportDialog() {
    var doc = AT.doc;
    if (!doc) return;
    var print = AT.isPrint(doc), multi = doc.pages.length > 1;
    var st = { type: print ? "pdf" : "png", scale: 1, dpi: 300, transparent: false, pages: "all", side: 720, flat: false };
    var film = { video: 1, gif: 1 };
    var types = ["png", "jpg", "pdf"].concat(window.AtelierPPTXOut ? ["pptx"] : [], window.AtelierWeb && window.AtelierZip ? ["web"] : [], window.AtelierWeb ? ["svg"] : [], AT.motion && AT.motion.canVideo() ? ["video"] : [], AT.motion ? ["gif"] : []);
    AT.openDialog(t("exp.title"), function (body, close) {
      function render() {
        body.innerHTML = "";
        body.appendChild(el("div", "fld-lbl", t("exp.type")));
        var seg = el("div", "seg" + (types.length > 3 ? " wrap" : ""));
        types.forEach(function (k) {
          var b = el("button", "seg-btn" + (st.type === k ? " on" : ""), t("exp." + k));
          b.type = "button";
          b.addEventListener("click", function () { st.type = k; render(); });
          seg.appendChild(b);
        });
        body.appendChild(seg);
        var secs = 0;
        if (film[st.type]) {
          var pl = M.pagesInOrder(doc);
          if (st.pages === "cur") pl = pl.filter(function (p) { return p.id === ED.pg; });
          secs = Math.ceil(AT.motion.duration(doc, pl));
        }
        body.appendChild(el("p", "hint", t("exp." + st.type + "Hint", { s: secs })));
        var opts = el("div", "pn-col");
        if (st.type !== "pptx" && st.type !== "web" && st.type !== "svg") body.appendChild(el("div", "fld-lbl", st.type === "pdf" && window.AtelierPDF ? t("exp.pdfPics") : t("exp.size")));
        function radio(name, label, on, fn) {
          var l = el("label", "chk");
          var r = el("input"); r.type = "radio"; r.name = name; r.checked = on;
          r.addEventListener("change", fn);
          l.appendChild(r); l.appendChild(el("span", "", label));
          opts.appendChild(l);
        }
        if (film[st.type]) {
          var sides = st.type === "gif" ? [480, 720] : [720, 1080];
          if (sides.indexOf(st.side) < 0) st.side = sides[0];
          sides.forEach(function (d) {
            var fs = AT.motion.filmSize(doc, d);
            radio("side", fs.w + " × " + fs.h + " px", st.side === d, function () { st.side = d; });
          });
        } else if (st.type === "pptx" || st.type === "web" || st.type === "svg") {
          // one size: the design's own (scaled as a whole only past PowerPoint's limits;
          // a web page fits the screen it is shown on)
        } else if (print || st.type === "pdf") {
          [150, 300].forEach(function (d) {
            var ps = pixelSize(doc, d / 72);
            radio("dpi", t("exp.dpi" + d) + (st.type === "pdf" ? "" : " · " + ps.w + " × " + ps.h + " px"), st.dpi === d, function () { st.dpi = d; st.scale = d / 72; });
          });
          st.scale = st.dpi / 72;
        } else {
          [1, 2, 3].forEach(function (k) {
            var ps = pixelSize(doc, k);
            radio("scale", t("exp.scale" + k, { w: ps.w, h: ps.h }), st.scale === k, function () { st.scale = k; });
          });
        }
        body.appendChild(opts);
        if (st.type === "pdf" && window.AtelierPDF) {
          var fl = el("label", "chk");
          var fb = el("input"); fb.type = "checkbox"; fb.checked = !!st.flat;
          fb.addEventListener("change", function () { st.flat = fb.checked; });
          fl.appendChild(fb); fl.appendChild(el("span", "", t("exp.pdfFlat")));
          body.appendChild(fl);
        }
        if (st.type === "png") {
          var c = el("label", "chk");
          var cb = el("input"); cb.type = "checkbox"; cb.checked = st.transparent;
          cb.addEventListener("change", function () { st.transparent = cb.checked; });
          c.appendChild(cb); c.appendChild(el("span", "", t("exp.transparent")));
          body.appendChild(c);
        }
        if (multi) {
          body.appendChild(el("div", "fld-lbl", t("exp.pages")));
          var s2 = el("div", "seg");
          ["all", "cur"].forEach(function (k) {
            var b = el("button", "seg-btn" + (st.pages === k ? " on" : ""), t("exp." + k));
            b.type = "button";
            b.addEventListener("click", function () { st.pages = k; render(); });
            s2.appendChild(b);
          });
          body.appendChild(s2);
          if (st.type !== "pdf" && st.type !== "web" && !film[st.type] && st.pages === "all") body.appendChild(el("p", "hint", t("exp.zipNote")));
        }
        if (AX.credits(doc).length) body.appendChild(el("p", "hint", t("exp.credits")));
        var act = el("div", "dlg-actions");
        var cc = el("button", "btn", t("btn.cancel")); cc.type = "button";
        var go = el("button", "btn primary", t("exp.go")); go.type = "button";
        cc.addEventListener("click", close);
        go.addEventListener("click", function () { close(); doExport(st); });
        act.appendChild(cc); act.appendChild(go);
        body.appendChild(act);
      }
      render();
    });
  }

  // ---------- Packages ----------
  function b64ToBlob(b64, type) {
    var bin = atob(b64), n = bin.length, u = new Uint8Array(n);
    for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type: type });
  }

  // .orosdesign = an orOS bundle (bundle.js, docs/oros-bundle.md): a
  // ZIP with content.json (the package without its assets), media/<id>
  // (pictures, clips) and a thumbnail of the first page.
  var BUNDLE_MIME = "application/x-oros-design";
  function thumbOf(doc) {
    var pg = M.pagesInOrder(doc)[0];
    if (!pg) return Promise.resolve(null);
    return prepare(doc, 1).then(function () {
      return toBlob(renderForExport(doc, pg, 512 / Math.max(doc.setup.w, doc.setup.h), false), "image/png");
    }).then(null, function () { return null; });
  }
  var DKF = window.orosDK.fonts;
  function ownFontFiles(doc) {
    var out = {};
    AX.docFonts(doc).forEach(function (e) { ["r", "b", "i", "bi"].forEach(function (v) { if (e[v]) out[e[v]] = 1; }); });
    return Object.keys(out);
  }
  function exportPackage(doc) {
    if (!doc) return;
    if (doc === AT.doc) ED.exitText();
    doc = AT.findDoc(doc.id) || doc;
    var media = {}, chain = Promise.resolve();
    AX.assetIds(doc).forEach(function (id) {
      chain = chain.then(function () { return A.blob(id); }).then(function (b) { if (b) media[id] = b; });
    });
    // videos and sounds travel the same way (video.js checks them back in)
    if (AT.video) AX.clipIds(doc).forEach(function (id) {
      chain = chain.then(function () { return AT.video.blob(id); }).then(function (b) { if (b) media[id] = b; });
    });
    // and the design's own font files (<sha256>.ttf, as Layout's packages)
    ownFontFiles(doc).forEach(function (name) {
      chain = chain.then(function () { return DKF ? DKF.blob(name) : null; }).then(function (b) { if (b) media[name] = b; });
    });
    chain.then(function () { return thumbOf(doc); }).then(function (thumb) {
      return window.OrosBundle.write({
        mime: BUNDLE_MIME, app: "atelier", schema: "atelier/" + PKG_VER,
        content: { kind: PKG_KIND, ver: PKG_VER, doc: doc },
        meta: { title: doc.name || "", modified: doc.m, id: doc.id, language: AT.LANG, generator: "orOS Atelier" },
        media: media, thumbnail: thumb, date: new Date()
      });
    }).then(function (bytes) {
      return saveBlob(new Blob([bytes], { type: BUNDLE_MIME }), fileName(doc, ".orosdesign"), BUNDLE_MIME, "orOS Atelier", ".orosdesign");
    }).then(function (ok) { if (ok) AT.toast(t("pkg.done")); }, function () { AT.toast(t("exp.fail")); });
  }

  // A picture or clip from a package: base64 (older JSON packages) or bytes (bundles)
  function isAsset(v) { return typeof v === "string" || v instanceof Uint8Array; }
  function assetBlob(v, type) { return typeof v === "string" ? b64ToBlob(v, type) : new Blob([v], { type: type }); }
  function bundleFail(e) { say(e && e.code === "newer" ? t("imp.newer") : t("imp.bad")); }
  // A bundle (or an unzipped bundle folder) → the package object the
  // JSON reader takes, with the media bytes as its assets.
  function fromBundle(r) {
    var pkg = r && r.content && typeof r.content === "object" ? r.content : null;
    if (pkg) {
      pkg.assets = {};
      Object.keys(r.media).forEach(function (k) { pkg.assets[k] = r.media[k].bytes; });
    }
    return importPackageObj(pkg);
  }
  function importPackageFile(f) {
    return f.slice(0, 4).arrayBuffer().then(function (head) {
      if (window.OrosBundle.sniff(new Uint8Array(head)) !== null) {
        return f.arrayBuffer().then(function (ab) {
          return window.OrosBundle.read(new Uint8Array(ab), { mime: BUNDLE_MIME });
        }).then(fromBundle, bundleFail);
      }
      return f.text().then(function (txt) {
        var pkg = null;
        try { pkg = JSON.parse(txt); } catch (e) {}
        // a design's own file in Files › Atelier opens that design (AT-DISK)
        if (!batching && AT.openStored && AT.openStored(f.name, pkg)) return;
        return importPackageObj(pkg);
      });
    });
  }
  // Home › Import › Unzipped folder: a .orosdesign someone unzipped
  // (and maybe changed: a picture swapped, a text fixed by hand).
  function importFolder() {
    window.OrosBundle.pickFolder().then(function (files) {
      if (!files) return;
      AT.toast(t("imp.working"));
      return window.OrosBundle.readFolder(files, { mime: BUNDLE_MIME }).then(fromBundle, bundleFail);
    }).then(null, importFail);
  }

  function importPackageObj(pkg) {
    return Promise.resolve().then(function () {
      var doc = pkg && pkg.kind === PKG_KIND && pkg.ver === PKG_VER && pkg.doc && typeof pkg.doc === "object" ? M.normDoc(pkg.doc) : null;
      if (!doc || !doc.pages.length) { say(t("imp.bad")); return; }
      // a NEW design: never overwrites or resurrects another one
      doc.id = M.newId("doc");
      var nw = AT.now();
      doc.m = nw;
      M.COLLECTIONS.forEach(function (c) { (doc[c] || []).forEach(function (e) { e.m = nw; }); });
      doc.tombs = {};
      var assets = pkg.assets && typeof pkg.assets === "object" ? pkg.assets : {};
      var failed = 0, chain = Promise.resolve();
      AX.assetIds(doc).forEach(function (id) {
        var b64 = assets[id];
        if (!isAsset(b64) || !A.ID_RE.test(id)) { failed++; return; }
        chain = chain.then(function () {
          return A.put(id, assetBlob(b64, /\.png$/.test(id) ? "image/png" : "image/jpeg"));
        }).then(null, function () { failed++; });
      });
      if (AT.video) AX.clipIds(doc).forEach(function (id) {
        var b64 = assets[id];
        if (!isAsset(b64)) { failed++; return; }
        chain = chain.then(function () {
          return AT.video.put(id, assetBlob(b64, window.AtelierClips.mimeOf(id)));
        }).then(null, function () { failed++; });
      });
      // own fonts: kept on this disk (a font the package lacks may be
      // here already; else its text shows in the stand-in)
      if (DKF) ownFontFiles(doc).forEach(function (name) {
        var b = assets[name];
        if (!isAsset(b)) return;
        chain = chain.then(function () { return DKF.put(name, assetBlob(b, "font/ttf"), { cff: true }); }).then(null, function () {});
      });
      return chain.then(function () {
        AT.addDoc(M.normDoc(doc), batching);
        say(failed ? t("imp.imgFail", { n: failed }) : t("imp.done"));
      });
    });
  }


  // PowerPoint (.pptx, e.g. "Download › Microsoft PowerPoint" in
  // Canva): parsed by pptx.js, every picture stored like an upload,
  // opened as a NEW design.
  var PPTX_MEDIA_MAX = 60 * 1024 * 1024;
  var MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml" };
  // quiet: no toast (Canva account import counts for itself); → elements lost
  // The fonts the file carries → kept on the orOS disk as own fonts
  // (designkit/fonts.js; PostScript outlines too: the PDF draws their
  // text as a picture) and registered: { typeface: { id, name, fb, r,
  // b, i, bi } }. A font that cannot be read or kept is left out (its
  // text keeps the stand-in).
  var FONT_MAX = 16 * 1024 * 1024;
  function ownFonts(zip, plan) {
    var DKF = window.orosDK.fonts, out = {}, chain = Promise.resolve();
    if (!DKF || !plan.fonts || !plan.fonts.length) return Promise.resolve(out);
    plan.fonts.forEach(function (e) {
      var files = {};
      ["r", "b", "i", "bi"].forEach(function (v) {
        if (!e[v]) return;
        chain = chain.then(function () { return zip.bytes(e[v], FONT_MAX); }).then(function (b) {
          var ttf = b && window.AtelierPPTX.eot(b);
          if (!ttf) return null;
          return DKF.importFile(new File([ttf], "font.ttf", { type: "font/ttf" }), { cff: true });
        }).then(function (rec) { if (rec && rec.file) files[v] = rec; }, function () {});
      });
      chain = chain.then(function () {
        var r = files.r || files.b || files.i || files.bi;
        if (!r) return;
        var ent = { id: DKF.ufIdOf(r.file), name: e.name, fb: r.fb === "serif" || r.fb === "mono" ? r.fb : "sans", r: r.file };
        ["b", "i", "bi"].forEach(function (v) { if (files[v]) ent[v] = files[v].file; });
        out[e.name] = ent;
      });
    });
    return chain.then(function () {
      AX.useDocFonts({ setup: { ext: { fonts: Object.keys(out).map(function (k) { return out[k]; }) } } });
      return out;
    });
  }
  // opts.real { w, h }: the design's own size in points (pptx.js rebox)
  function importPptxFile(f, quiet, opts) {
    var fonts = {};
    return f.arrayBuffer().then(function (ab) {
      var zip = window.AtelierZip.open(new Uint8Array(ab));
      var name = String(f.name || "").replace(/\.pptx$/i, "").slice(0, 120);
      return window.AtelierPPTX.parse(zip, name).then(function (plan) {
        var assets = {}, failed = 0, chain = Promise.resolve();
        Object.keys(plan.media).forEach(function (p) {
          chain = chain.then(function () { return zip.bytes(p, PPTX_MEDIA_MAX); }).then(function (b) {
            if (!b) { failed++; return; }
            var ext = (p.split(".").pop() || "").toLowerCase();
            var file = new File([b], p.split("/").pop(), { type: MIME[ext] || "application/octet-stream" });
            return A.importFile(file).then(function (res) {
              assets[p] = res; AT.noteUpload(res.id);
              // a moving GIF also keeps the GIF itself (CV-A)
              if (ext === "gif" && AT.video && AT.video.importGif) {
                return AT.video.importGif(file).then(function (gid) { if (gid) assets[p] = { id: res.id, w: res.w, h: res.h, gif: gid }; });
              }
            });
          }).then(null, function (e) { if (e && e.message === "nofs") throw e; failed++; });
        });
        // videos and sounds (CV-A): stored like an upload of a clip
        Object.keys(plan.clips || {}).forEach(function (p) {
          if (!AT.video) { failed++; return; }
          chain = chain.then(function () { return zip.bytes(p, PPTX_MEDIA_MAX); }).then(function (b) {
            if (!b) { failed++; return; }
            return AT.video.importClip(new File([b], p.split("/").pop())).then(function (res) {
              assets[p] = { clip: res.id, dur: res.dur };
              if (res.poster) AT.noteUpload(res.poster.id);
            });
          }).then(null, function (e) { if (e && e.message === "nofs") throw e; failed++; });
        });
        Object.keys(plan.svgs).forEach(function (k) {
          chain = chain.then(function () {
            return A.importFile(new File([plan.svgs[k]], "shape.svg", { type: "image/svg+xml" }));
          }).then(function (res) { assets[k] = res; }, function (e) { if (e && e.message === "nofs") throw e; failed++; });
        });
        return chain.then(function () { return ownFonts(zip, plan); }).then(function (own) {
          fonts = own;
          // the design's fonts first, so text boxes get their real size
          // (at most a few seconds; a font that does not come shows in Sans)
          var keys = [];
          Object.keys(own).forEach(function (n) {
            ["r", "b", "i", "bi"].forEach(function (v) { keys.push(own[n].id + "-" + v); });
          });
          if (navigator.onLine !== false) window.AtelierPPTX.planFonts(plan, own).forEach(function (f) {
            AX.ensureFont(f.id, f.name);
            ["r", "b", "i", "bi"].forEach(function (v) { keys.push(f.id + "-" + v); });
          });
          if (!keys.length) return;
          return Promise.race([T.load(keys).then(null, function () {}), new Promise(function (r) { setTimeout(r, 12000); })]);
        }).then(function () {
          var r = window.AtelierPPTX.build(plan, assets, AT.now(), fonts, opts && opts.real ? { real: opts.real } : null);
          return (opts && opts.pdf ? canvaLook(r.doc, opts.pdf) : Promise.resolve()).then(function () {
            AT.addDoc(r.doc, batching);
            var lost = plan.skipped + r.missing;
            if (!quiet) say(lost ? t("imp.partial", { n: lost }) : t("imp.done"));
            return quiet ? { lost: lost, id: r.doc.id } : lost;
          });
        });
      });
    });
  }

  // ---------- SVG as shapes (VEC-4) ----------
  // Layout's reader (layout/sla.js + layout/svgin.js) and svgin.js load
  // on the first SVG opened as shapes (precached, not in the page).
  var svgReading = null;
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var sc = document.createElement("script");
      sc.src = src;
      sc.onload = res; sc.onerror = function () { rej(new Error("load")); };
      document.head.appendChild(sc);
    });
  }
  function svgReader() {
    if (window.LY_SVGIN && window.AtelierSvgIn) return Promise.resolve();
    if (!svgReading) {
      svgReading = (window.LY_SLA ? Promise.resolve() : loadScript("../layout/sla.js"))
        .then(function () { return window.LY_SVGIN ? null : loadScript("../layout/svgin.js"); })
        .then(function () { return window.AtelierSvgIn ? null : loadScript("svgin.js"); })
        .then(null, function (e) { svgReading = null; throw e; });
    }
    return svgReading;
  }
  function isSvg(f) { return /\.svg$/i.test(String(f && f.name || "")) || (f && f.type) === "image/svg+xml"; }
  // "shapes" | "pic" | null (closed)
  function askSvg() {
    return new Promise(function (resolve) {
      var done = false;
      function pick(v) { if (!done) { done = true; resolve(v); } }
      AT.openDialog(t("imp.svgAs"), function (body, close) {
        [["shapes", "imp.svgShapes", "imp.svgShapesHint"], ["pic", "imp.svgPic", "imp.svgPicHint"]].forEach(function (o, i) {
          var b = el("button", "btn block two" + (i ? "" : " primary"));
          b.type = "button";
          b.appendChild(el("span", "", t(o[1])));
          b.appendChild(el("span", "hint", t(o[2])));
          b.addEventListener("click", function () { pick(o[0]); close(); });
          body.appendChild(b);
        });
        var act = el("div", "dlg-actions"), cc = el("button", "btn", t("btn.cancel"));
        cc.type = "button";
        cc.addEventListener("click", function () { pick(null); close(); });
        act.appendChild(cc);
        body.appendChild(act);
      });
      var d = $("dlg");
      if (d) d.addEventListener("close", function () { pick(null); }, { once: true });
    });
  }
  // The file read as shapes: { page (parse()), name } or null.
  function readSvg(f) {
    return svgReader().then(function () { return f.text(); }).then(function (txt) {
      var pg = window.LY_SVGIN.parse(txt);
      return pg && (pg.items.length || pg.pieces.length) ? pg : null;
    });
  }
  // Specs into a design's page, pictures stored first; one undo step.
  function placeSpecs(doc, pgId, res, nw) {
    var chain = Promise.resolve(), assets = {};
    res.images.forEach(function (im) {
      chain = chain.then(function () {
        var blob = window.LY_SVGIN.imageBlob(im);
        if (!blob) return;
        var ext = (im.mime.split("/")[1] || "png").replace("jpeg", "jpg").replace("svg+xml", "svg");
        return A.importFile(new File([blob], (im.name || "svg-image") + "." + ext, { type: blob.type })).then(function (r) {
          AT.noteUpload(r.id); assets[im.i] = r;
        }, function () {});
      });
    });
    return chain.then(function () {
      var made = [];
      function add(d, now) {
        res.specs.forEach(function (sp, i) {
          if (sp.k === "photo") {
            var r = assets[i];
            if (!r) return;
            sp.a = r.id; sp.iw = r.w; sp.ih = r.h; sp.nm = r.name || "";
          }
          var it = AX.addItem(d, pgId, sp, now);
          if (it) made.push(it.id);
        });
      }
      if (doc) add(doc, nw);
      else AT.op(function (d, now) { add(d, now); if (!made.length) return false; });
      return made;
    });
  }

  // Canva's text effects and curved text (CV-F2): read from Canva's PDF
  // of the same design (atelier/canvafx.js, PDF.js through Layout's
  // reader; both load on first use). A PDF that cannot be read changes
  // nothing.
  function canvaLook(doc, pdf) {
    return pdfReader().then(function () { return window.AtelierCanvaFx ? null : loadScript("canvafx.js"); })
      .then(function () { return isFile(pdf) ? pdf : pdf && pdf.get ? pdf.get() : null; })
      .then(function (f) { return f ? f.arrayBuffer() : null; })
      .then(function (buf) { return buf ? window.AtelierCanvaFx.glyphs(buf) : null; })
      .then(function (pages) {
        if (!pages) return;
        var res = window.AtelierCanvaFx.apply(doc, pages, AX, AT.M);
        return canvaPics(doc, pages, res.pics).then(null, function () {}).then(function () { if (pages.close) pages.close(); });
      })
      .then(null, function () {});
  }
  // Canva's outline, glow or lift around a text is a picture in its PDF
  // (CV-F4): put it under the text, where the PDF has it. Only a picture
  // with see-through parts (an effect, not a photo) comes in.
  function canvaPics(doc, pages, pics) {
    var chain = Promise.resolve(), R = window.LY_PDFIN;
    (pics || []).forEach(function (p) {
      chain = chain.then(function () { return p.im.img || pdfObj(pages[p.k].page, p.im.id); }).then(function (obj) {
        var cv = obj && R.imageCanvas(obj);
        if (!cv || !seeThrough(cv)) return;
        return new Promise(function (res) { cv.toBlob(res, "image/png"); }).then(function (blob) {
          if (!blob) return;
          return A.importFile(new File([blob], "canva-effect.png", { type: "image/png" })).then(function (r) {
            AT.noteUpload(r.id);
            var it = p.it, z = it.z;
            doc.items.forEach(function (o) { if (o.pg === it.pg && o.z >= z && !(o.ax && o.ax.bg)) o.z++; });
            var pic = AX.addItem(doc, it.pg, { k: "photo", a: r.id, iw: r.w, ih: r.h, fit: "fill", nm: "", x: Math.round(p.im.x * 100) / 100, y: Math.round(p.im.y * 100) / 100, w: Math.round(p.im.w * 100) / 100, h: Math.round(p.im.h * 100) / 100, z: z }, AT.now());
            if (pic && it.grp) pic.grp = it.grp;
          });
        });
      }).then(null, function (e) { if (e && e.message === "nofs") throw e; });
    });
    return chain;
  }
  // a picture of a PDF page once PDF.js has it (it may still be coming)
  function pdfObj(page, id) {
    var objs = /^g_/.test(id) ? page.commonObjs : page.objs;
    return new Promise(function (res) {
      var t = setTimeout(function () { res(null); }, 5000);
      try { objs.get(id, function (v) { clearTimeout(t); res(v); }); } catch (e) { clearTimeout(t); res(null); }
    });
  }
  function seeThrough(cv) {
    try {
      var w = Math.min(cv.width, 200), h = Math.min(cv.height, 200), c = document.createElement("canvas");
      c.width = w; c.height = h;
      var x = c.getContext("2d", { willReadFrequently: true });
      x.drawImage(cv, 0, 0, w, h);
      var d = x.getImageData(0, 0, w, h).data, clear = 0;
      for (var i = 3; i < d.length; i += 4) if (d[i] < 8) clear++;
      return clear >= w * h * 0.2;
    } catch (e) { return false; }
  }

  // ---------- PDF as a design (PS-3: Canva's PDF download) ----------
  // Layout's reader (layout/sla.js, layout/pdfin.js, PDF.js) and
  // pdfin.js load on the first PDF opened (precached, not in the page).
  var pdfReading = null;
  function pdfReader() {
    if (window.LY_PDFIN && window.AtelierPdfIn) return Promise.resolve();
    if (!pdfReading) {
      pdfReading = (window.LY_SLA ? Promise.resolve() : loadScript("../layout/sla.js"))
        .then(function () { return window.LY_PDFIN ? null : loadScript("../layout/pdfin.js"); })
        .then(function () { return window.AtelierPdfIn ? null : loadScript("pdfin.js"); })
        .then(null, function (e) { pdfReading = null; throw e; });
    }
    return pdfReading;
  }
  function isPdf(f) { return /\.pdf$/i.test(String(f && f.name || "")) || (f && f.type) === "application/pdf"; }
  function importPdfFile(f) {
    var name = String(f.name || "").replace(/\.pdf$/i, "").slice(0, 120);
    return pdfReader().then(function () { return f.arrayBuffer(); }).then(function (buf) {
      var store = function (blob) {
        return A.importFile(new File([blob], blob.name || "pdf.png", { type: blob.type || "image/png" })).then(function (r) { AT.noteUpload(r.id); return r; });
      };
      return window.LY_PDFIN.open(buf, { name: name, now: AT.now() }, store);
    }).then(function (res) {
      var plan = res && window.AtelierPdfIn.toDesign(res.doc);
      if (!plan) { say(t("imp.pdfFail")); return; }
      var nw = AT.now();
      var d = AX.newDesign({ name: name || "PDF", w: plan.setup.w, h: plan.setup.h, unit: plan.setup.unit, pages: plan.pages.length }, nw);
      var pages = M.pagesInOrder(d), made = 0;
      plan.pages.forEach(function (specs, i) {
        var pg = pages[i];
        if (!pg) return;
        specs.forEach(function (sp) { if (AX.addItem(d, pg.id, sp, nw)) made++; });
      });
      AT.addDoc(M.normDoc(d), batching);
      if (!batching) say(res.stats && res.stats.cut ? t("imp.pdfCut", { n: plan.pages.length, all: res.stats.total }) : t("imp.pdfDone"));
    });
  }

  // A picture (PNG, JPG, WebP, SVG…): a new design of its size; an SVG
  // may come in as editable shapes instead (asked; shapes when many)
  function importImageFile(f) {
    if (isSvg(f)) {
      return (batching ? Promise.resolve("shapes") : askSvg()).then(function (how) {
        if (!how) return;
        if (how === "pic") return importPicture(f);
        return readSvg(f).then(function (pg) {
          if (!pg) { say(t("imp.svgFail")); return importPicture(f); }
          var nw = AT.now();
          var d = AX.newDesign({ name: String(f.name || "").replace(/\.[a-z0-9]+$/i, "").slice(0, 120), w: Math.round(pg.w), h: Math.round(pg.h), unit: "px" }, nw);
          var page = M.pagesInOrder(d)[0];
          var res = window.AtelierSvgIn.toSpecs(pg, { x: 0, y: 0, w: d.setup.w, h: d.setup.h }, { bg: true });
          var back = AX.background(d, page.id);
          if (res.bg && back) back.ax.fc = res.bg;
          return placeSpecs(d, page.id, res, nw).then(function () {
            AT.addDoc(M.normDoc(d), batching);
            say(res.skipped + res.linked ? t("imp.partial", { n: res.skipped + res.linked }) : t("imp.done"));
          });
        }, function () { say(t("imp.svgFail")); return importPicture(f); });
      });
    }
    return importPicture(f);
  }
  function importPicture(f) {
    return A.importFile(f).then(function (res) { return withGif(f, res); }).then(function (res) {
      AT.noteUpload(res.id);
      var nw = AT.now();
      var d = AX.newDesign({ name: String(f.name || "").replace(/\.[a-z0-9]+$/i, "").slice(0, 120), w: res.w, h: res.h, unit: "px" }, nw);
      var pg = M.pagesInOrder(d)[0];
      var spec = { k: "photo", a: res.id, iw: res.w, ih: res.h, nm: res.name || "", x: 0, y: 0, w: res.w, h: res.h, fit: "fill" };
      if (res.gif) spec.ext = { gif: res.gif };
      AX.addItem(d, pg.id, spec, nw);
      AT.addDoc(M.normDoc(d), batching);
      say(t("imp.done"));
    });
  }

  // Home › Import: .orosdesign, .pptx or a picture
  function importAny() {
    pickFiles(".orosdesign,.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pdf,application/pdf,image/*,.svg,.zip,application/zip")
      .then(importMany).then(null, importFail);
  }
  // Also the way in for a file from the system's "Open with" (shell fileopen.js).
  function importAnyFile(f) {
    if (!f) return;
    if (f.size > PKG_MAX) { say(t("imp.bad")); return; }
    var nm = String(f.name || "").toLowerCase();
    var run = /\.pptx$/.test(nm) ? importPptxFile
      : isPdf(f) ? importPdfFile
      : /^image\//.test(f.type || "") || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(nm) ? importImageFile
      : importPackageFile;
    say(t("imp.working"));
    return run(f);
  }
  function importFail(e) { AT.toast(e && e.message === "nofs" ? t("img.nofs") : t("imp.bad")); }
  function openFile(f) { return Promise.resolve(importAnyFile(f)).then(null, importFail); }

  // ---------- Many files at once (AC5) ----------
  // Home › Import › From files takes one or more files, and a .zip of
  // packages (.orosdesign, .pptx inside; e.g. a folder zipped on the
  // computer). Home › Import › From a folder in Files takes every
  // package in a folder of the orOS disk and its subfolders. One after
  // another, each a new design as with one file; Home stays open and
  // one toast tells how many came in and how many could not.
  var batching = false;
  function say(msg) { if (!batching) AT.toast(msg); }
  var BATCH_MAX = 500, DEPTH_MAX = 4;
  var PKG_RE = /\.(orosdesign|pptx)$/i;
  function pickFiles(accept) {
    var dlg = AT.dialogHost();
    if (dlg && typeof dlg.openFiles === "function") return dlg.openFiles(accept);
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file"; inp.accept = accept; inp.multiple = true;
      inp.addEventListener("change", function () { resolve(inp.files ? [].slice.call(inp.files) : null); });
      inp.click();
    });
  }
  function docIds() { return ((AT.data() || {}).docs || []).map(function (d) { return d.id; }); }
  // A picked file comes from the shell's window when its file dialog
  // (dialogs.js) is used, so a type check against this frame's Blob is
  // false for it: tell a file from a disk entry by what it can do.
  function isFile(f) { return !!f && typeof f.arrayBuffer === "function" && typeof f.slice === "function"; }
  // files: File objects, or { name, get() → Promise<Blob> } for the disk
  function importMany(files) {
    files = (files || []).filter(Boolean);
    if (!files.length) return Promise.resolve();
    if (files.length === 1 && isFile(files[0]) && !/\.zip$/i.test(files[0].name || "")) return openFile(files[0]);
    var ok = 0, bad = 0, n = 0, full = false;
    // a design counts once it is stored (AT.keepStored: on the disk
    // written and read back, else in localStorage); a full storage
    // stops the batch and keeps what fit
    function one(f, real, pdf) {
      if (n >= BATCH_MAX || full) { bad++; return Promise.resolve(); }
      n++;
      var before = docIds();
      return Promise.resolve().then(function () { return real || pdf ? importPptxFile(f, false, { real: real, pdf: pdf }) : importAnyFile(f); })
        .then(null, function (e) { if (e && e.message === "nofs") throw e; })
        .then(function () {
          var added = docIds().filter(function (id) { return before.indexOf(id) < 0; });
          if (!added.length) { bad++; return; }
          return AT.keepStored(added).then(function (kept) {
            if (kept.length) ok++;
            else { bad++; full = true; }
          });
        });
    }
    // a zip is read piece by piece (designkit/zipin.js): only its
    // directory and one package at a time are in memory
    function zipOf(f) {
      return window.orosZipIn.list(f).then(function (entries) {
        var chain = Promise.resolve();
        entries.filter(function (e) { return PKG_RE.test(e.name) && !/(^|\/)(__MACOSX\/|\.)/.test(e.name); })
          .sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }).forEach(function (e) {
            chain = chain.then(function () { return e.get(PKG_MAX); }).then(function (b) {
              return one(new File([b], e.name.split("/").pop()));
            }, function () { bad++; });
          });
        return chain;
      }, function () { bad++; });
    }
    batching = true;
    AT.toast(t("imp.working"));
    var chain = Promise.resolve();
    // a .pptx with Canva's PDF of the same design beside it: the PDF
    // gives the real size of a slide Canva had to shrink (past 56 in) and
    // the text effects and curves (CV-F2);
    // the PDF itself is not imported a second time
    var pair = pairs(files);
    files.forEach(function (f) {
      chain = chain.then(function () {
        if (pair.skip.indexOf(f) >= 0) return;
        var mate = pair.pdf.get(f);
        return Promise.resolve().then(function () { return isFile(f) ? f : f.get(); }).then(function (file) {
          if (!file) { bad++; return; }
          if (/\.zip$/i.test(file.name || "")) return zipOf(file);
          if (mate) return Promise.resolve(isFile(mate) ? mate : mate.get()).then(function (pf) { return pdfSize(pf).then(function (real) { return one(file, real, pf); }); });
          return one(file);
        }).then(null, function (e) { if (e && e.message === "nofs") throw e; bad++; });
      });
    });
    return chain.then(function () {
      batching = false;
      if (AT.doc) AT.goHome(); else AT.renderHome();
      AT.toast(bad ? t("imp.manyBad", { n: ok, bad: bad }) : t("imp.many", { n: ok }));
    }, function (e) {
      batching = false;
      AT.renderHome();
      importFail(e);
    });
  }
  // files → { pdf: Map(pptx → its PDF), skip: [those PDFs] } (same
  // name before the extension, any case)
  function pairs(files) {
    var base = function (f) { return String(f && f.name || "").toLowerCase().replace(/\.[a-z0-9]+$/, ""); };
    var pdfs = {}, out = { pdf: new Map(), skip: [] };
    files.forEach(function (f) { if (/\.pdf$/i.test(f && f.name || "")) pdfs[base(f)] = f; });
    files.forEach(function (f) {
      var m = /\.pptx$/i.test(f && f.name || "") && pdfs[base(f)];
      if (m) { out.pdf.set(f, m); out.skip.push(m); }
    });
    return out;
  }
  // A PDF's first page size in points { w, h }, or null (read from its
  // /MediaBox as plain text; a PDF that hides it in a compressed
  // object stream gives null)
  function pdfSize(f) {
    if (!f) return Promise.resolve(null);
    return f.slice(0, 4 * 1024 * 1024).arrayBuffer().then(function (ab) {
      var txt = new TextDecoder("latin1").decode(new Uint8Array(ab));
      var m = /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/.exec(txt);
      if (!m) return null;
      var w = Math.abs(+m[3] - +m[1]), h = Math.abs(+m[4] - +m[2]);
      return w > 0 && h > 0 && w < 200000 && h < 200000 ? { w: w, h: h } : null;
    }).then(null, function () { return null; });
  }

  // Home › Import › From a folder in Files: a small browser of the
  // orOS disk's folders; "Import" takes this folder and its subfolders.
  function diskFs() {
    try { return (window.parent && window.parent.orosFS) || window.orosFS || null; }
    catch (e) { return window.orosFS || null; }
  }
  var ROOT = "/internal";
  function lsOf(fs, path) {
    return Promise.resolve(typeof fs.ready === "function" ? fs.ready() : null).then(function () { return fs.ls(path); })
      .then(function (en) { return (en || []).filter(function (e) { return e && typeof e.name === "string" && e.name.charAt(0) !== "."; }); }, function () { return []; });
  }
  // every package under path (subfolders to DEPTH_MAX), sorted by path
  function packagesIn(fs, path) {
    var out = [];
    function walk(p, depth) {
      return lsOf(fs, p).then(function (en) {
        var chain = Promise.resolve(), decks = {};
        // a PDF beside a .pptx of the same name comes along (Canva's
        // PDF of the design: real size, text effects, CV-F2)
        en.forEach(function (e) { if (!e.dir && /\.pptx$/i.test(e.name)) decks[e.name.toLowerCase().replace(/\.pptx$/, "")] = 1; });
        en.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }).forEach(function (e) {
          var q = p + "/" + e.name;
          // the Trash, and Atelier's own designs (AT-DISK), are not imported
          if (e.dir) { if (depth < DEPTH_MAX && q !== ROOT + "/Trash" && q !== AT.DISK_DIR) chain = chain.then(function () { return walk(q, depth + 1); }); }
          else if (PKG_RE.test(e.name) && out.length < BATCH_MAX) out.push(q);
          else if (/\.pdf$/i.test(e.name) && decks[e.name.toLowerCase().replace(/\.pdf$/, "")]) out.push(q);
        });
        return chain;
      });
    }
    return walk(path, 0).then(function () { return out; });
  }
  function importDisk() {
    var fs = diskFs();
    if (!fs) { AT.toast(t("img.nofs")); return; }
    var cwd = ROOT, gen = 0;
    AT.openDialog(t("imp.diskTitle"), function (body, close) {
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
        importMany(paths.map(function (p) {
          return { name: p, get: function () {
            return fs.read(p).then(function (b) { return b ? new File([b], p.split("/").pop()) : null; });
          } };
        }));
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
          en.filter(function (e) { return e.dir && !(path === ROOT && e.name === "Trash") && path + "/" + e.name !== AT.DISK_DIR; })
            .sort(function (a, b) { return a.name < b.name ? -1 : 1; })
            .forEach(function (e) {
              var b = el("button", "btn small block", "📁 " + e.name); b.type = "button";
              b.addEventListener("click", function () { go(path + "/" + e.name); });
              list.appendChild(b);
            });
          return packagesIn(fs, path);
        }).then(function (ps) {
          if (my !== gen || !ps) return;
          paths = ps;
          var n = ps.filter(function (q) { return PKG_RE.test(q); }).length;
          o.disabled = !n;
          found.textContent = n ? t("imp.diskFound", { n: n }) : t("imp.diskNone");
        });
      }
      go(ROOT);
    }, true);
  }

  // ---------- Images ----------
  function placePhoto(res) {
    var s = AT.doc.setup, k = Math.min(s.w * 0.6 / res.w, s.h * 0.6 / res.h);
    var spec = { k: "photo", a: res.id, iw: res.w, ih: res.h, nm: res.name || "", w: res.w * k, h: res.h * k, fit: "fill" };
    if (res.gif) spec.ext = { gif: res.gif };
    ED.add(spec);
  }
  // An SVG put on the open page as shapes, in the middle, at most 60%
  // of the page; picked afterwards.
  function placeSvgShapes(f) {
    return readSvg(f).then(function (pg) {
      if (!pg || !AT.doc) return false;
      var st = AT.doc.setup, k = Math.min(st.w * 0.6 / pg.w, st.h * 0.6 / pg.h, 1);
      var w = pg.w * k, h = pg.h * k;
      var res = window.AtelierSvgIn.toSpecs(pg, { x: (st.w - w) / 2, y: (st.h - h) / 2, w: w, h: h });
      return placeSpecs(null, ED.pg, res).then(function (ids) {
        if (!ids.length) return false;
        ED.select(ids);
        AT.toast(res.skipped + res.linked ? t("imp.svgSome", { n: ids.length, m: res.skipped + res.linked }) : t("imp.svgAdded", { n: ids.length }), t("btn.undo"), AT.undo);
        return true;
      });
    }).then(null, function () { return false; });
  }
  function uploadImage(replaceId) {
    pickFile("image/*").then(function (f) {
      if (!f) return;
      if (!replaceId && isSvg(f)) {
        return askSvg().then(function (how) {
          if (how === "shapes") return placeSvgShapes(f).then(function (ok) { if (!ok) { AT.toast(t("imp.svgFail")); return placeAsPicture(f); } });
          if (how === "pic") return placeAsPicture(f);
        });
      }
      return placeAsPicture(f, replaceId);
    });
  }
  // a moving GIF also keeps the GIF itself (CV-A): res.gif = its id
  function withGif(f, res) {
    var gif = /\.gif$/i.test(f.name || "") || f.type === "image/gif";
    if (!gif || !AT.video || !AT.video.importGif) return Promise.resolve(res);
    return AT.video.importGif(f).then(function (id) { if (id) res.gif = id; return res; });
  }
  function placeAsPicture(f, replaceId) {
    return A.importFile(f).then(function (res) { return withGif(f, res); }).then(function (res) {
      AT.noteUpload(res.id);
      if (replaceId && ED.find(replaceId)) {
        AT.editItems([replaceId], function (it) {
          it.a = res.id; it.nm = res.name; it.iw = res.w; it.ih = res.h;
          it.fit = "fill"; it.ix = 0; it.iy = 0; it.isc = 1;
          delete it.ax.cr;
          ["vid", "vs", "ve", "mu", "vol", "nl"].forEach(function (k) { delete it.ax[k]; });   // a picture now
          if (res.gif) { it.ext = it.ext || {}; it.ext.gif = res.gif; }
          else if (it.ext && it.ext.gif) { delete it.ext.gif; if (!Object.keys(it.ext).length) delete it.ext; }
        });
      } else placePhoto(res);
      AT.toast(t("img.added"));
      if (AT.renderDrawer) AT.renderDrawer();
    }, function (e) {
      AT.toast(e && e.message === "nofs" ? t("img.nofs") : t("img.fail"));
    });
  }

  // ---------- Credits ----------
  function creditsDialog() {
    var list = AX.credits(AT.doc);
    var lines = MEDIA ? MEDIA.credits(list, AT.BASE) : [];
    AT.openDialog(t("credits.title"), function (body, close) {
      if (!lines.length) body.appendChild(el("p", "hint", t("credits.none")));
      lines.forEach(function (s) { body.appendChild(el("p", "credit-line", s)); });
      var act = el("div", "dlg-actions");
      if (lines.length) {
        var cp = el("button", "btn", t("credits.copy")); cp.type = "button";
        cp.addEventListener("click", function () {
          try { navigator.clipboard.writeText(lines.join("\n")).then(function () { AT.toast(t("credits.copied")); }); } catch (e) {}
        });
        act.appendChild(cp);
      }
      var c = el("button", "btn primary", t("btn.close")); c.type = "button";
      c.addEventListener("click", close);
      act.appendChild(c);
      body.appendChild(act);
    });
  }

  // ---------- Resize (magic resize: atelier/relayout.js) ----------
  var RL = window.AtelierRelayout;
  function textH(it) { return AX.textHeight(M.normItem(it)); }
  function relaid(d, w, h, unit) { return RL.relayout(d, w, h, { unit: unit, textHeight: textH }); }
  // this design itself, one size (undo brings the old size back)
  function resizeTo(w, h, unit) {
    AT.op(function (d, nw) {
      var r = relaid(d, w, h, unit);
      d.setup = r.setup;
      d.items = r.items;
      d.m = Math.max(nw, d.m + 1);
      d.items.forEach(function (it) { M.touch(it, nw); });
    });
    ED.fit();
    ED.renderPages();
  }
  // copies in each size, saved next to this design
  function resizeCopies(sizes) {
    var src = AT.doc;
    if (!src) return;
    var name = AT.docTitle(src);
    var list = sizes.map(function (s) {
      var c = relaid(src, s.w, s.h, s.unit);
      c.name = t("resize.copy", { name: name, size: s.label }).slice(0, 120);
      return c;
    });
    var ids = AT.addCopies(list, src.id);
    if (ids.length === 1) AT.toast(t("resize.made", { n: 1 }), t("resize.open"), function () { AT.openDoc(ids[0]); });
    else AT.toast(t("resize.made", { n: ids.length }));
  }
  // Magic Switch (CV-2b): the copies' texts translated on the device
  // with the shared Translate panel (../translate/panel.js, loaded on
  // first use); with no size picked, one copy at this size.
  function translatePanel(o, fail) {
    if (window.OrosTranslatePanel) { window.OrosTranslatePanel.open(o); return; }
    var v = window.orosI18n && window.orosI18n.ver, sc = document.createElement("script");
    sc.src = "../translate/panel.js" + (v ? "?v=" + encodeURIComponent(v) : "");
    sc.onload = function () { if (window.OrosTranslatePanel) window.OrosTranslatePanel.open(o); else fail(); };
    sc.onerror = fail;
    document.head.appendChild(sc);
  }
  function switchCopies(sizes) {
    var src = AT.doc;
    if (!src) return;
    var tx = RL.textSegments(src);
    if (!tx.segs.length) { AT.toast(t("resize.noText")); if (sizes.length) resizeCopies(sizes); return; }
    var here = sizes.length ? sizes : [{ w: src.setup.w, h: src.setup.h, unit: AT.unitLbl(src) === "mm" ? "mm" : "px", label: t("resize.same") }];
    translatePanel({ segments: tx.segs, lang: AT.LANG, actions: [{ label: t("resize.trMake", { n: here.length }), run: function (res) {
      var cur = AT.findDoc(src.id) || src;
      var tdoc = RL.translated(cur, tx.map, res.segments || []);
      var TR = window.OrosTranslate, lang = res.to ? (TR && TR.name ? TR.name(res.to, AT.LANG) : res.to) : "";
      var name = AT.docTitle(cur);
      var list = here.map(function (z) {
        var c = relaid(tdoc, z.w, z.h, z.unit);
        c.name = t("resize.copyLang", { name: name, size: z.label, lang: lang }).slice(0, 120);
        return c;
      });
      var ids = AT.addCopies(list, cur.id);
      if (ids.length === 1) AT.toast(t("resize.made", { n: 1 }), t("resize.open"), function () { AT.openDoc(ids[0]); });
      else AT.toast(t("resize.made", { n: ids.length }));
    } }] }, function () { AT.toast(t("resize.trFail")); });
  }
  function resizeDialog() {
    var d = AT.doc;
    if (!d) return;
    var pick = {}, copies = true, tr = false, custom = { on: false, w: Math.round(M.toUnit(d.setup.w, AT.unitLbl(d) === "mm" ? "mm" : "pt")), h: Math.round(M.toUnit(d.setup.h, AT.unitLbl(d) === "mm" ? "mm" : "pt")), unit: AT.unitLbl(d) === "mm" ? "mm" : "px" };
    AT.openDialog(t("resize.title"), function (body, close) {
      body.appendChild(el("p", "hint", t("resize.note")));
      var list = el("div", "rs-list");
      var go = el("button", "btn primary", ""); go.type = "button";
      var warn = el("p", "hint warn", t("resize.one"));
      function sizes() {
        var out = [];
        AT.PRESETS.list.forEach(function (p, i) {
          if (!pick[i]) return;
          var s = AT.presetSize(p);
          out.push({ w: s.w, h: s.h, unit: p[6], label: AT.presetName(p), id: p[0] });
        });
        if (custom.on && custom.w > 0 && custom.h > 0) {
          var mm = custom.unit === "mm";
          out.push({ w: mm ? M.fromUnit(custom.w, "mm") : custom.w, h: mm ? M.fromUnit(custom.h, "mm") : custom.h, unit: custom.unit,
            label: custom.w + " × " + custom.h + " " + custom.unit });
        }
        return out;
      }
      function update() {
        var n = sizes().length;
        go.textContent = tr && copies ? t("resize.goTr", { n: Math.max(1, n) }) : t("resize.go", { n: n });
        go.disabled = tr && copies ? false : !n || (!copies && n > 1);
        warn.hidden = copies || n <= 1;
        trRow.hidden = !copies;
      }
      function row(label, sub, on, fn, extra) {
        var r = el("label", "rs-row");
        var cb = el("input"); cb.type = "checkbox"; cb.checked = on;
        cb.addEventListener("change", function () { fn(cb.checked); update(); });
        r.appendChild(cb);
        var tx = el("span", "rs-txt");
        tx.appendChild(el("span", "rs-name", label));
        tx.appendChild(el("span", "rs-dim", sub));
        r.appendChild(tx);
        if (extra) r.appendChild(extra);
        list.appendChild(r);
      }
      AT.PRESETS.list.forEach(function (p, i) {
        var s = AT.presetSize(p);
        var same = Math.abs(s.w - d.setup.w) < 0.5 && Math.abs(s.h - d.setup.h) < 0.5;
        row(AT.presetName(p), p[4] + " × " + p[5] + " " + p[6] + (same ? " · " + t("resize.current") : ""), false,
          function (v) { if (v) pick[i] = 1; else delete pick[i]; });
      });
      // custom size
      var cw = el("div", "rs-custom");
      function num(lbl, key) {
        var f = el("label", "fld");
        f.appendChild(el("span", "fld-lbl", lbl));
        var i = el("input", "inp num"); i.type = "number"; i.min = "1"; i.max = "20000"; i.value = custom[key];
        i.addEventListener("input", function () { custom[key] = Math.max(0, Math.min(20000, +i.value || 0)); update(); });
        f.appendChild(i);
        cw.appendChild(f);
      }
      num(t("resize.w"), "w"); num(t("resize.h"), "h");
      var us = el("select", "inp sm");
      ["px", "mm"].forEach(function (u) { var o = el("option", "", u); o.value = u; if (u === custom.unit) o.selected = true; us.appendChild(o); });
      us.addEventListener("change", function () { custom.unit = us.value; update(); });
      cw.appendChild(us);
      row(t("resize.custom"), "", false, function (v) { custom.on = v; });
      list.appendChild(cw);
      body.appendChild(list);
      var keep = el("label", "rs-keep");
      var kc = el("input"); kc.type = "checkbox"; kc.checked = true;
      kc.addEventListener("change", function () { copies = kc.checked; update(); });
      keep.appendChild(kc);
      keep.appendChild(el("span", "", t("resize.copies")));
      body.appendChild(keep);
      var trRow = el("label", "rs-keep");
      var tc = el("input"); tc.type = "checkbox"; tc.checked = false;
      tc.addEventListener("change", function () { tr = tc.checked; update(); });
      trRow.appendChild(tc);
      trRow.appendChild(el("span", "", t("resize.translate")));
      body.appendChild(trRow);
      body.appendChild(warn);
      var act = el("div", "dlg-actions");
      var c = el("button", "btn", t("btn.cancel")); c.type = "button";
      c.addEventListener("click", close);
      go.addEventListener("click", function () {
        var s = sizes();
        if (tr && copies) { close(); switchCopies(s); return; }
        if (!s.length) return;
        close();
        AT.emit("rc-note", { op: "resize", copies: copies ? 1 : 0, sizes: s.map(function (z) {
          var mm = z.unit === "mm";
          return { w: mm ? Math.round(M.toUnit(z.w, "mm") * 10) / 10 : Math.round(z.w), h: mm ? Math.round(M.toUnit(z.h, "mm") * 10) / 10 : Math.round(z.h), u: mm ? "mm" : "px", p: z.id || "" };
        }) });
        if (copies) resizeCopies(s);
        else resizeTo(s[0].w, s[0].h, s[0].unit);
      });
      act.appendChild(c); act.appendChild(go);
      body.appendChild(act);
      update();
    }, true);
  }

  // ---------- Send to… (the shell's sheet: Mail, Layout, a person) ----------
  // The current page as PNG (as Download draws it, long side ≤ 4096 px),
  // saved in /internal/Pictures first: the receivers take a disk path.
  var PICTURES = "/internal/Pictures";
  function parentApi(name) {
    try { return window.parent !== window && window.parent[name] ? window.parent[name] : null; }
    catch (e) { return null; }
  }
  function canSend() { return !!(parentApi("orosSend") && parentApi("orosFS")); }
  function savePicture(fs, blob, name) {
    var dot = name.lastIndexOf("."), base = name.slice(0, dot), ext = name.slice(dot);
    function tryName(n) {
      var p = PICTURES + "/" + base + (n > 1 ? " (" + n + ")" : "") + ext;
      return fs.stat(p).then(function (s) {
        if (!s) return p;
        return n < 99 ? tryName(n < 2 ? 2 : n + 1) : Promise.reject(new Error("name"));
      }, function () { return p; });
    }
    return fs.mkdir(PICTURES).then(null, function () {}).then(function () { return tryName(1); })
      .then(function (p) { return fs.write(p, blob).then(function () { return p; }); });
  }
  function sendTo() {
    var doc = AT.doc, api = parentApi("orosSend"), fs = parentApi("orosFS");
    if (!doc || !api || !fs || exporting) return;
    var pg = M.pagesInOrder(doc).filter(function (p) { return p.id === ED.pg; })[0] || M.pagesInOrder(doc)[0];
    if (!pg) return;
    ED.exitText();
    exporting = true;
    var k = Math.min(1, 4096 / Math.max(doc.setup.w, doc.setup.h));
    prepare(doc, safeScale(doc, k)).then(function () {
      return toBlob(renderForExport(doc, pg, k, false), "image/png");
    }).then(function (b) {
      return savePicture(fs, b, fileName(doc, ".png"));
    }).then(function (p) {
      exporting = false;
      var it = { path: p, name: p.split("/").pop() };
      var opts = { kind: "files", data: { items: [it] } };
      if (parentApi("orosShare")) opts.share = { kind: "album", data: { t: "" }, photos: [it] };
      api.open(opts);
    }, function (e) {
      exporting = false;
      try { console.error("[orOS] atelier: send failed", e); } catch (x) {}
      AT.toast(t("send.fail"));
    });
  }

  // ---------- Editor bar ----------
  function refreshBar() {
    $("ed-undo").disabled = !AT.canUndo();
    $("ed-redo").disabled = !AT.canRedo();
  }
  AT.on("boot", function () {
    AT.setIcon($("ed-back"), "back", t("ed.back"));
    AT.setIcon($("ed-undo"), "undo", t("ed.undo"));
    AT.setIcon($("ed-redo"), "redo", t("ed.redo"));
    AT.setIcon($("ed-zout"), "minus", t("ed.zout"));
    AT.setIcon($("ed-zin"), "plus", t("ed.zin"));
    AT.setIcon($("ed-more"), "more", t("ed.more"));
    $("ed-zoom").title = t("ed.fit");
    $("ed-name").title = t("ed.rename");
    var ex = $("ed-export");
    ex.innerHTML = AT.icon("download");
    ex.appendChild(el("span", "ex-lbl", t("ed.export")));
    ex.setAttribute("aria-label", t("ed.export"));
    $("ed-back").addEventListener("click", AT.goHome);
    $("ed-name").addEventListener("click", function () { if (AT.doc) AT.renameDoc(AT.doc.id); });
    $("ed-undo").addEventListener("click", AT.undo);
    $("ed-redo").addEventListener("click", AT.redo);
    $("ed-zout").addEventListener("click", function () { ED.zoomBy(0.8); });
    $("ed-zin").addEventListener("click", function () { ED.zoomBy(1.25); });
    $("ed-zoom").addEventListener("click", ED.fit);
    ex.addEventListener("click", exportDialog);
    $("ed-more").addEventListener("click", function () {
      AT.menu($("ed-more"), [
        { label: t("more.present"), fn: AT.motion ? AT.motion.present : function () {} },
        { sep: true },
        { label: t("more.resize"), fn: resizeDialog },
        { label: t("more.collage"), hide: !AT.collage, fn: function () { AT.collage.open(); } },
        { label: t("more.bulk"), fn: function () { if (AT.bulk) AT.bulk.open(); } },
        { label: t("more.recipes"), hide: !AT.recipes, fn: function () { AT.recipes.open(); } },
        { label: t("more.record"), hide: !AT.recipes || AT.recipes.recording(), fn: function () { AT.recipes.record(); } },
        { label: t("more.mockup"), disabled: !(AT.mockup && AT.mockup.can()), fn: function () { AT.mockup.open(); } },
        { label: t("more.pkg"), fn: function () { exportPackage(AT.doc); } },
        { label: t("more.sendTo"), hide: !canSend(), fn: sendTo },
        { label: t("more.credits"), fn: creditsDialog },
        { sep: true },
        { label: t("more.selall"), fn: ED.selectAll },
        { label: t("more.copy"), disabled: !ED.sel.length, fn: ED.copy },
        { label: t("more.paste"), disabled: !ED.hasClip(), fn: ED.paste }
      ]);
    });
    refreshBar();
  });
  AT.on("doc", refreshBar);
  AT.on("open", refreshBar);
  AT.on("remote", refreshBar);

  AT.io = {
    exportPackage: exportPackage, importAny: importAny, importFolder: importFolder, importDisk: importDisk, importMany: importMany, openFile: openFile, importPptx: importPptxFile, pdfSize: pdfSize, uploadImage: uploadImage,
    placePhoto: placePhoto, pickFile: pickFile, saveBlob: saveBlob, exportDialog: exportDialog, resizeTo: resizeTo,
    renderFiles: renderFiles, relaid: relaid, svgOf: svgOf, svgSelection: svgSelection,
    sendTo: sendTo, canSend: canSend, resizeDialog: resizeDialog, switchCopies: switchCopies
  };
})();
