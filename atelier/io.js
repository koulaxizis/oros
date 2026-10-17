// ============================================================
// orOS Atelier — files in and out + the editor bar (v1.0.0)
//   - Download: PNG (optionally transparent), JPG, PDF, PowerPoint
//     (.pptx, editable in Canva / PowerPoint: pptxout.js; what it
//     can't keep editable is drawn here as a picture). Pages are
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
    var pad = ax.k === "text" ? (ax.size || AX.TEXT_DEF.size) * 0.6 : ax.k === "icon" ? (it.sw || 2) * 2 + 2 : ax.k === "table" ? (it.sw || 0) : 0;
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
    var P = window.AtelierPDF, ids = pages.map(function (p) { return p.id; });
    var plan = P.plan(doc, ids), pics = {}, chain = Promise.resolve();
    plan.filter(P.needsPicture).forEach(function (p) {
      var it = M.find(doc.items, p.id);
      if (!it) return;
      chain = chain.then(function () { return pictureOf(doc, it, p, dpi); }).then(function (pic) { pics[p.id] = pic; });
    });
    return chain.then(function () {
      var pdf = P.build(doc, { pages: ids, title: doc.name || "" }, { jsPDF: J, pictures: pics, plan: plan });
      return saveBlob(pdf.output("blob"), fileName(doc, ".pdf"), "application/pdf", "PDF", ".pdf");
    });
  }

  var exporting = false;
  function doExport(o) {
    var doc = AT.doc;
    if (!doc || exporting) return;
    ED.exitText();
    exporting = true;
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
    var chain = prepare(doc, o.type === "pdf" ? o.dpi / 72 : o.type === "pptx" ? 3 : safeScale(doc, o.scale || 1));
    var mime = o.type === "png" ? "image/png" : "image/jpeg";
    if (o.type === "pptx") {
      chain = chain.then(function () { return exportPptx(doc, pages); });
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
    var types = ["png", "jpg", "pdf"].concat(window.AtelierPPTXOut ? ["pptx"] : [], AT.motion && AT.motion.canVideo() ? ["video"] : [], AT.motion ? ["gif"] : []);
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
        if (st.type !== "pptx") body.appendChild(el("div", "fld-lbl", st.type === "pdf" && window.AtelierPDF ? t("exp.pdfPics") : t("exp.size")));
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
        } else if (st.type === "pptx") {
          // one size: the design's own (scaled as a whole only past PowerPoint's limits)
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
          if (st.type !== "pdf" && !film[st.type] && st.pages === "all") body.appendChild(el("p", "hint", t("exp.zipNote")));
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
  function bundleFail(e) { AT.toast(e && e.code === "newer" ? t("imp.newer") : t("imp.bad")); }
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
      if (!doc || !doc.pages.length) { AT.toast(t("imp.bad")); return; }
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
      return chain.then(function () {
        AT.addDoc(M.normDoc(doc));
        AT.toast(failed ? t("imp.imgFail", { n: failed }) : t("imp.done"));
      });
    });
  }


  // PowerPoint (.pptx, e.g. "Download › Microsoft PowerPoint" in
  // Canva): parsed by pptx.js, every picture stored like an upload,
  // opened as a NEW design.
  var PPTX_MEDIA_MAX = 60 * 1024 * 1024;
  var MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml" };
  // quiet: no toast (Canva account import counts for itself); → elements lost
  function importPptxFile(f, quiet) {
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
            return A.importFile(file).then(function (res) { assets[p] = res; AT.noteUpload(res.id); });
          }).then(null, function (e) { if (e && e.message === "nofs") throw e; failed++; });
        });
        Object.keys(plan.svgs).forEach(function (k) {
          chain = chain.then(function () {
            return A.importFile(new File([plan.svgs[k]], "shape.svg", { type: "image/svg+xml" }));
          }).then(function (res) { assets[k] = res; }, function (e) { if (e && e.message === "nofs") throw e; failed++; });
        });
        return chain.then(function () {
          // the design's fonts first, so text boxes get their real size
          // (at most a few seconds; a font that does not come shows in Sans)
          var keys = [];
          window.AtelierPPTX.planFonts(plan).forEach(function (f) {
            AX.ensureFont(f.id, f.name);
            ["r", "b", "i", "bi"].forEach(function (v) { keys.push(f.id + "-" + v); });
          });
          if (!keys.length || navigator.onLine === false) return;
          return Promise.race([T.load(keys).then(null, function () {}), new Promise(function (r) { setTimeout(r, 12000); })]);
        }).then(function () {
          var r = window.AtelierPPTX.build(plan, assets, AT.now());
          AT.addDoc(r.doc);
          var lost = plan.skipped + r.missing;
          if (!quiet) AT.toast(lost ? t("imp.partial", { n: lost }) : t("imp.done"));
          return quiet ? { lost: lost, id: r.doc.id } : lost;
        });
      });
    });
  }

  // A picture (PNG, JPG, WebP, SVG…): a new design of its size
  function importImageFile(f) {
    return A.importFile(f).then(function (res) {
      AT.noteUpload(res.id);
      var nw = AT.now();
      var d = AX.newDesign({ name: String(f.name || "").replace(/\.[a-z0-9]+$/i, "").slice(0, 120), w: res.w, h: res.h, unit: "px" }, nw);
      var pg = M.pagesInOrder(d)[0];
      AX.addItem(d, pg.id, { k: "photo", a: res.id, iw: res.w, ih: res.h, nm: res.name || "", x: 0, y: 0, w: res.w, h: res.h, fit: "fill" }, nw);
      AT.addDoc(M.normDoc(d));
      AT.toast(t("imp.done"));
    });
  }

  // Home › Import: .orosdesign, .pptx or a picture
  function importAny() {
    pickFile(".orosdesign,.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation,image/*,.svg")
      .then(importAnyFile).then(null, importFail);
  }
  // Also the way in for a file from the system's "Open with" (shell fileopen.js).
  function importAnyFile(f) {
    if (!f) return;
    if (f.size > PKG_MAX) { AT.toast(t("imp.bad")); return; }
    var nm = String(f.name || "").toLowerCase();
    var run = /\.pptx$/.test(nm) ? importPptxFile
      : /^image\//.test(f.type || "") || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(nm) ? importImageFile
      : importPackageFile;
    AT.toast(t("imp.working"));
    return run(f);
  }
  function importFail(e) { AT.toast(e && e.message === "nofs" ? t("img.nofs") : t("imp.bad")); }
  function openFile(f) { return Promise.resolve(importAnyFile(f)).then(null, importFail); }

  // ---------- Images ----------
  function placePhoto(res) {
    var s = AT.doc.setup, k = Math.min(s.w * 0.6 / res.w, s.h * 0.6 / res.h);
    ED.add({ k: "photo", a: res.id, iw: res.w, ih: res.h, nm: res.name || "", w: res.w * k, h: res.h * k, fit: "fill" });
  }
  function uploadImage(replaceId) {
    pickFile("image/*").then(function (f) {
      if (!f) return;
      return A.importFile(f).then(function (res) {
        AT.noteUpload(res.id);
        if (replaceId && ED.find(replaceId)) {
          AT.editItems([replaceId], function (it) {
            it.a = res.id; it.nm = res.name; it.iw = res.w; it.ih = res.h;
            it.fit = "fill"; it.ix = 0; it.iy = 0; it.isc = 1;
            delete it.ax.cr;
            ["vid", "vs", "ve", "mu", "vol", "nl"].forEach(function (k) { delete it.ax[k]; });   // a picture now
          });
        } else placePhoto(res);
        AT.toast(t("img.added"));
        if (AT.renderDrawer) AT.renderDrawer();
      }, function (e) {
        AT.toast(e && e.message === "nofs" ? t("img.nofs") : t("img.fail"));
      });
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
  function resizeDialog() {
    var d = AT.doc;
    if (!d) return;
    var pick = {}, copies = true, custom = { on: false, w: Math.round(M.toUnit(d.setup.w, AT.unitLbl(d) === "mm" ? "mm" : "pt")), h: Math.round(M.toUnit(d.setup.h, AT.unitLbl(d) === "mm" ? "mm" : "pt")), unit: AT.unitLbl(d) === "mm" ? "mm" : "px" };
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
          out.push({ w: s.w, h: s.h, unit: p[6], label: AT.presetName(p) });
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
        go.textContent = t("resize.go", { n: n });
        go.disabled = !n || (!copies && n > 1);
        warn.hidden = copies || n <= 1;
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
      body.appendChild(warn);
      var act = el("div", "dlg-actions");
      var c = el("button", "btn", t("btn.cancel")); c.type = "button";
      c.addEventListener("click", close);
      go.addEventListener("click", function () {
        var s = sizes();
        if (!s.length) return;
        close();
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
        { label: t("more.bulk"), fn: function () { if (AT.bulk) AT.bulk.open(); } },
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
    exportPackage: exportPackage, importAny: importAny, importFolder: importFolder, openFile: openFile, importPptx: importPptxFile, uploadImage: uploadImage,
    placePhoto: placePhoto, pickFile: pickFile, saveBlob: saveBlob, exportDialog: exportDialog, resizeTo: resizeTo,
    sendTo: sendTo, canSend: canSend
  };
})();
