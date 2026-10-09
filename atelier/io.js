// ============================================================
// orOS Atelier — files in and out + the editor bar (v1.0.0)
//   - Download: PNG (optionally transparent), JPG, PDF. Pages are
//     drawn by draw.js at full resolution (what you see is what you
//     get, effects and filters included); a PDF holds one image per
//     page at 150 or 300 dpi (jsPDF, loaded on first use).
//   - .orosdesign package: the design + its images (base64) in one
//     JSON file; opened as a NEW design, every image checked against
//     its hash and decoded as an image before it is stored.
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

  // Everything a page needs before drawing at full size.
  function prepare(doc) {
    return T.load(AT.draw.fontKeys(doc)).then(function () {
      return Promise.all(AX.assetIds(doc).map(function (id) { return A.load(id); }));
    });
  }

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
    var chain = prepare(doc);
    var mime = o.type === "png" ? "image/png" : "image/jpeg";
    if (o.type === "pdf") {
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
      if (ok) AT.toast(AX.credits(doc).length ? t("exp.credits") : t("exp.done"));
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
    var st = { type: print ? "pdf" : "png", scale: 1, dpi: 300, transparent: false, pages: "all", side: 720 };
    var film = { video: 1, gif: 1 };
    var types = ["png", "jpg", "pdf"].concat(AT.motion && AT.motion.canVideo() ? ["video"] : [], AT.motion ? ["gif"] : []);
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
        body.appendChild(el("div", "fld-lbl", t("exp.size")));
        var opts = el("div", "pn-col");
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

  function exportPackage(doc) {
    if (!doc) return;
    if (doc === AT.doc) ED.exitText();
    doc = AT.findDoc(doc.id) || doc;
    var assets = {}, chain = Promise.resolve();
    AX.assetIds(doc).forEach(function (id) {
      chain = chain.then(function () { return A.blob(id); }).then(function (b) {
        if (b) return blobToB64(b).then(function (s) { assets[id] = s; });
      });
    });
    chain.then(function () {
      var pkg = { kind: PKG_KIND, ver: PKG_VER, doc: doc, assets: assets };
      var blob = new Blob([JSON.stringify(pkg)], { type: "application/json" });
      return saveBlob(blob, fileName(doc, ".orosdesign"), "application/json", "orOS Atelier", ".orosdesign");
    }).then(function (ok) { if (ok) AT.toast(t("pkg.done")); }, function () { AT.toast(t("exp.fail")); });
  }

  function importPackageFile(f) {
    return f.text().then(function (txt) {
      var pkg = null;
      try { pkg = JSON.parse(txt); } catch (e) {}
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
        if (typeof b64 !== "string" || !A.ID_RE.test(id)) { failed++; return; }
        chain = chain.then(function () {
          return A.put(id, b64ToBlob(b64, /\.png$/.test(id) ? "image/png" : "image/jpeg"));
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
          var r = window.AtelierPPTX.build(plan, assets, AT.now());
          AT.addDoc(r.doc);
          var lost = plan.skipped + r.missing;
          if (!quiet) AT.toast(lost ? t("imp.partial", { n: lost }) : t("imp.done"));
          return lost;
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
    pickFile(".orosdesign,.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation,image/*,.svg").then(function (f) {
      if (!f) return;
      if (f.size > PKG_MAX) { AT.toast(t("imp.bad")); return; }
      var nm = String(f.name || "").toLowerCase();
      var run = /\.pptx$/.test(nm) ? importPptxFile
        : /^image\//.test(f.type || "") || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(nm) ? importImageFile
        : importPackageFile;
      AT.toast(t("imp.working"));
      return run(f);
    }).then(null, function (e) { AT.toast(e && e.message === "nofs" ? t("img.nofs") : t("imp.bad")); });
  }

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
    var lines = MEDIA ? MEDIA.credits(list, AT.LANG) : [];
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

  // ---------- Resize ----------
  function resizeTo(w, h, unit) {
    AT.op(function (d, nw) {
      var W0 = d.setup.w, H0 = d.setup.h;
      var k = Math.min(w / W0, h / H0), ox = (w - W0 * k) / 2, oy = (h - H0 * k) / 2;
      d.setup.w = w; d.setup.h = h;
      d.setup.unit = unit === "mm" ? "mm" : "pt";
      d.setup.bleed = unit === "mm" ? 3 * M.PT_PER.mm : 0;
      d.m = Math.max(nw, d.m + 1);
      d.items.forEach(function (it) {
        if (it.ax && it.ax.bg) { it.x = 0; it.y = 0; it.w = w; it.h = h; }
        else {
          it.x = ox + it.x * k; it.y = oy + it.y * k; it.w *= k; it.h *= k; it.sw *= k;
          if (it.t === "img" && it.fit === "custom") { it.ix *= k; it.iy *= k; it.isc *= k; }
          if (it.ax && it.ax.k === "text") { it.ax.size = Math.round(it.ax.size * k * 10) / 10; it.h = AX.textHeight(M.normItem(it)); }
        }
        M.touch(it, nw);
      });
    });
    ED.fit();
    ED.renderPages();
  }
  function resizeDialog() {
    AT.openDialog(t("resize.title"), function (body, close) {
      body.appendChild(el("p", "hint", t("resize.note")));
      var list = el("div", "pn-col resize-list");
      AT.PRESETS.list.forEach(function (p) {
        var b = el("button", "menu-item", (AT.LANG === "el" ? p[3] : p[2]) + " · " + p[4] + " × " + p[5] + " " + p[6]);
        b.type = "button";
        b.addEventListener("click", function () { var s = AT.presetSize(p); close(); resizeTo(s.w, s.h, p[6]); });
        list.appendChild(b);
      });
      body.appendChild(list);
      var act = el("div", "dlg-actions");
      var c = el("button", "btn", t("btn.cancel")); c.type = "button";
      c.addEventListener("click", close);
      act.appendChild(c);
      body.appendChild(act);
    }, true);
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
        { label: t("more.pkg"), fn: function () { exportPackage(AT.doc); } },
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
    exportPackage: exportPackage, importAny: importAny, importPptx: importPptxFile, uploadImage: uploadImage,
    placePhoto: placePhoto, exportDialog: exportDialog, resizeTo: resizeTo
  };
})();
