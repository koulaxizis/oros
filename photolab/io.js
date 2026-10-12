// ============================================================
// orOS Photo Lab — files in and out (v1.0.0)
//   - open a picture (PNG, JPG, WebP, GIF first frame, BMP, AVIF,
//     SVG…) as a new project, or place it as a new layer; the
//     browser decodes it as an IMAGE (an SVG through <img>, where
//     scripts never run), EXIF orientation applied, scaled down to
//     the device limit with a notice
//   - drag and drop, paste (system clipboard pictures or our own)
//   - export PNG / JPG / WebP through orosDialog (R33), or into
//     the shared Pictures folder of the orOS disk (/internal/
//     Pictures, Files shows it; Montage puts its frames there too)
//   - "Use as wallpaper" (parent.orosWallpaper.setImage, this
//     device only)
//   - project thumbnails for the home screen
// ============================================================
(function () {
  "use strict";

  var PL = window.PL, C = PL.C, st = PL.st;
  var MAX_FILE = 50 * 1024 * 1024;
  var PICTURES = "/internal/Pictures";
  var IMG_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|svg|ico|psd|ora)$/i;
  var LAYERED_MAX = 300 * 1024 * 1024;              // a PSD or OpenRaster file
  function t(k, p) { return PL.t(k, p); }

  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
  }
  function baseName(n) { return C.cleanName(String(n || "").replace(/\.[a-z0-9]{1,5}$/i, "")) || t("doc.untitled"); }

  // ---------- Decoding ----------
  function viaImg(blob) {
    return new Promise(function (ok, fail) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () {
        var w = img.naturalWidth || 1024, h = img.naturalHeight || 1024;
        ok({ src: img, w: w, h: h, done: function () { URL.revokeObjectURL(url); } });
      };
      img.onerror = function () { URL.revokeObjectURL(url); fail(new Error("decode")); };
      img.src = url;
    });
  }
  function source(blob) {
    var svg = /svg/i.test(blob.type || "");
    if (!svg && typeof createImageBitmap === "function") {
      return createImageBitmap(blob, { imageOrientation: "from-image" }).then(function (bm) {
        return { src: bm, w: bm.width, h: bm.height, done: function () { try { bm.close(); } catch (e) {} } };
      }, function () { return viaImg(blob); });
    }
    return viaImg(blob);
  }
  // → Promise<{ w, h, data, scaled }>
  function decode(blob) {
    if (!blob || blob.size > MAX_FILE) return Promise.reject(new Error("big"));
    return source(blob).then(function (s) {
      var fit = C.fitSize(s.w, s.h, PL.limits);
      var c = PL.view.canvas(fit.w, fit.h), g = c.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.drawImage(s.src, 0, 0, fit.w, fit.h);
      s.done();
      var d = g.getImageData(0, 0, fit.w, fit.h);
      c.width = c.height = 0;
      return { w: fit.w, h: fit.h, data: d.data, scaled: fit.scaled };
    });
  }
  function kindOf(file) {
    var n = String(file && file.name || "");
    if (/\.psd$/i.test(n) || /photoshop/i.test(file.type || "")) return "psd";
    if (/\.ora$/i.test(n) || /openraster/i.test(file.type || "")) return "ora";
    return "";
  }
  function openPictureFile(file, asLayer) {
    var kind = kindOf(file);
    if (kind) return openLayered(file, kind);
    PL.busy(true);
    return decode(file).then(function (img) {
      PL.busy(false);
      if (img.scaled) PL.toast(t("msg.scaled", { w: img.w, h: img.h }));
      if (asLayer && st.doc) PL.ops.pasteImage(img, null, null, baseName(file.name));
      else return PL.closeProject(true).then(function () { PL.newFromImage(img, baseName(file.name)); });
    }, function (e) {
      PL.busy(false);
      PL.toast(t(e && e.message === "big" ? "msg.tooBig" : "msg.notPicture"));
    });
  }
  function openPicture(asLayer) {
    var dlg = dialogHost();
    var p = dlg && typeof dlg.openFile === "function" ? dlg.openFile("image/*,.psd,.ora") : Promise.resolve(null);
    if (!dlg) PL.toast(t("msg.noDialogs"));
    return p.then(function (f) { if (f) return openPictureFile(f, asLayer); });
  }
  // A picture already on the orOS disk (e.g. Montage's frame grab).
  function openDiskPath(path) {
    var fs = PL.fs();
    if (!fs || typeof path !== "string" || path.indexOf("/internal/") !== 0 || path.indexOf("..") >= 0 || !IMG_EXT.test(path)) {
      PL.toast(t("msg.openFail")); return;
    }
    fs.read(path).then(function (b) {
      var name = path.split("/").pop();
      var type = /\.svg$/i.test(name) ? "image/svg+xml" : (b.type || "");
      return openPictureFile(new File([b], name, { type: type }), false);
    }).catch(function () { PL.toast(t("msg.openFail")); });
  }

  // ---------- Layered files (PSD, OpenRaster) ----------
  // Always a new project. Too big for this device: every layer is
  // scaled with the canvas (one notice). Over the layer limit: the
  // lowest layers are merged into one, so the picture looks the same.
  function openLayered(file, kind) {
    if (file.size > LAYERED_MAX) { PL.toast(t("msg.layeredBig")); return Promise.resolve(); }
    PL.busy(true);
    return file.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      if (kind === "psd") return PL.job("psd", { bytes: bytes, o: { maxPixels: PL.phone ? PL.limits.area * 2 : 120e6 } });
      return PL.ORA.read(bytes, window.AtelierZip).then(oraPixels);
    }).then(function (r) {
      var layers = r.layers;
      if (!layers.length && r.merged) layers = [{ name: t("layer.bg"), x: 0, y: 0, img: r.merged, op: 100, bl: "normal", vis: 1 }];
      if (!layers.length) throw new Error("empty");
      var fit = C.fitSize(r.w, r.h, PL.limits);
      if (fit.scaled) layers = scaleLayers(layers, fit.w / r.w);
      layers = capLayers(layers);
      return PL.closeProject(true).then(function () {
        PL.busy(false);
        PL.newFromLayers(fit.w, fit.h, baseName(file.name), layers);
        var notes = [];
        if (fit.scaled) notes.push(t("msg.scaled", { w: fit.w, h: fit.h }));
        if (r.skipped && (r.skipped.groups || r.skipped.masks)) notes.push(t("msg.layeredFlat"));
        if (r.skipped && (r.skipped.empty || r.skipped.missing)) notes.push(t("msg.layeredSkipped"));
        if (r.skipped && r.skipped.blends) notes.push(t("msg.layeredBlend"));
        if (layers.capped) notes.push(t("msg.layeredMerged", { n: C.MAX_LAYERS }));
        if (notes.length) PL.toast(notes.join(" "));
      });
    }).catch(function (e) {
      PL.busy(false);
      var m = e && e.message || "";
      PL.toast(t(m === "psd-mode" ? "msg.psdMode" : m === "psd-big" ? "msg.layeredBig" : m === "psd-zip" ? "msg.psdZip" : "msg.layeredFail"));
    });
  }
  // OpenRaster layers are PNGs: decoded by the browser, one by one.
  function oraPixels(r) {
    var out = [], chain = Promise.resolve();
    r.layers.forEach(function (L) {
      chain = chain.then(function () {
        return source(new Blob([L.png], { type: "image/png" })).then(function (s) {
          if (s.w * s.h > PL.limits.area) { s.done(); throw new Error("psd-big"); }
          out.push({ name: L.name, x: L.x, y: L.y, op: L.op, bl: L.bl, vis: L.vis, img: pixelsOf(s) });
        });
      });
    });
    return chain.then(function () {
      if (out.length || !r.merged) return { w: r.w, h: r.h, layers: out, merged: null, skipped: r.skipped };
      return source(new Blob([r.merged], { type: "image/png" })).then(function (s) {
        return { w: r.w, h: r.h, layers: [], merged: pixelsOf(s), skipped: r.skipped };
      });
    });
  }
  function pixelsOf(s) {
    var c = PL.view.canvas(s.w, s.h), g = c.getContext("2d");
    g.drawImage(s.src, 0, 0);
    s.done();
    var d = g.getImageData(0, 0, s.w, s.h).data;
    c.width = c.height = 0;
    return { w: s.w, h: s.h, data: d };
  }
  function scaleLayers(layers, k) {
    return layers.map(function (L) {
      var w = Math.max(1, Math.round(L.img.w * k)), h = Math.max(1, Math.round(L.img.h * k));
      return { name: L.name, x: Math.round(L.x * k), y: Math.round(L.y * k), op: L.op, bl: L.bl, vis: L.vis,
               img: PL.R.resize(L.img, w, h) };
    });
  }
  function capLayers(layers) {
    if (layers.length <= C.MAX_LAYERS) return layers;
    var n = layers.length - C.MAX_LAYERS + 1, low = layers.slice(0, n);
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    low.forEach(function (L) {
      if (!L.vis) return;
      x0 = Math.min(x0, L.x); y0 = Math.min(y0, L.y);
      x1 = Math.max(x1, L.x + L.img.w); y1 = Math.max(y1, L.y + L.img.h);
    });
    var merged = { name: t("layer.merged"), x: 0, y: 0, op: 100, bl: "normal", vis: 1, img: { w: 1, h: 1, data: new Uint8ClampedArray(4) } };
    if (x1 > x0) {
      var c = PL.view.canvas(x1 - x0, y1 - y0), g = c.getContext("2d"), tmp = PL.view.canvas(1, 1);
      low.forEach(function (L) {
        if (!L.vis) return;
        tmp.width = L.img.w; tmp.height = L.img.h;
        tmp.getContext("2d").putImageData(new ImageData(L.img.data, L.img.w, L.img.h), 0, 0);
        g.globalAlpha = L.op / 100;
        g.globalCompositeOperation = C.blendOp(L.bl);
        g.drawImage(tmp, L.x - x0, L.y - y0);
      });
      merged.x = x0; merged.y = y0;
      merged.img = { w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
      c.width = c.height = tmp.width = tmp.height = 0;
    }
    var out = [merged].concat(layers.slice(n));
    out.capped = true;
    return out;
  }

  // ---------- Clipboard ----------
  var clip = null;              // our own: { img, x, y }
  function setClipboard(img, x, y) {
    clip = { img: { w: img.w, h: img.h, data: new Uint8ClampedArray(img.data) }, x: x, y: y };
    // Also to the system clipboard as PNG, where the browser allows it.
    try {
      if (navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem === "function") {
        var c = PL.view.canvas(img.w, img.h);
        c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
        var blob = new Promise(function (ok) { c.toBlob(function (b) { ok(b); }, "image/png"); });
        navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).catch(function () {});
      }
    } catch (e) {}
    PL.toast(t("msg.copied"));
  }
  function pasteOwn() {
    if (!clip) { PL.toast(t("msg.clipEmpty")); return; }
    PL.ops.pasteImage({ w: clip.img.w, h: clip.img.h, data: new Uint8ClampedArray(clip.img.data) }, clip.x, clip.y);
  }
  function pasteBlob(b) {
    PL.busy(true);
    decode(b).then(function (img) {
      PL.busy(false);
      // Our own copy came back through the system clipboard: keep its place.
      if (clip && clip.img.w === img.w && clip.img.h === img.h) PL.ops.pasteImage(img, clip.x, clip.y);
      else PL.ops.pasteImage(img, null, null);
    }, function () { PL.busy(false); PL.toast(t("msg.notPicture")); });
  }
  function pasteFromMenu() {
    if (navigator.clipboard && navigator.clipboard.read) {
      navigator.clipboard.read().then(function (items) {
        for (var i = 0; i < items.length; i++) {
          var type = items[i].types.filter(function (x) { return /^image\//.test(x); })[0];
          if (type) return items[i].getType(type).then(pasteBlob);
        }
        pasteOwn();
      }, pasteOwn);
    } else pasteOwn();
  }

  // ---------- Export ----------
  var MIME = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", psd: "image/vnd.adobe.photoshop", ora: "image/openraster" };
  var LAYERED = { psd: 1, ora: 1 };
  function render(fmt, q, scale) {
    var c = PL.view.flatten(null, scale);
    if (fmt === "jpg") {                                  // JPEG has no transparency: white below
      var w = PL.view.canvas(c.width, c.height), g = w.getContext("2d");
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, w.width, w.height); g.drawImage(c, 0, 0);
      c.width = c.height = 0; c = w;
    }
    return new Promise(function (ok) {
      c.toBlob(function (b) { c.width = c.height = 0; ok(b); }, MIME[fmt], q);
    });
  }
  function fileName(ext) {
    return (C.cleanName(st.doc.name).replace(/[\\\/:*?"<>|]+/g, "-") || "picture") + "." + ext;
  }
  // ---------- Layered export (PSD, OpenRaster) ----------
  // Every layer as { name, x, y, img, op, bl, vis } (text and shapes
  // as their pixels), trimmed to its content, bottom → top.
  function layerPixels() {
    return st.doc.layers.map(function (L) {
      var o = { name: L.name, op: L.op, bl: L.bl, vis: L.vis, x: L.x, y: L.y, img: { w: 0, h: 0, data: new Uint8ClampedArray(0) } };
      if (L.k !== "raster") {
        var v = PL.ops.vectorPixels(L);
        o.x = v.x; o.y = v.y; o.img = v.img;
        return o;
      }
      var s = PL.surface(L.id), b = PL.T.contentBounds(s);
      if (b) { o.x = L.x + b.x; o.y = L.y + b.y; o.img = PL.T.readRect(s, b.x, b.y, b.w, b.h); }
      return o;
    });
  }
  function pngOf(img) {
    var c = PL.view.canvas(Math.max(1, img.w), Math.max(1, img.h));
    if (img.w && img.h) c.getContext("2d").putImageData(new ImageData(img.data, img.w, img.h), 0, 0);
    return new Promise(function (ok, fail) {
      c.toBlob(function (b) {
        c.width = c.height = 0;
        if (!b) { fail(new Error("png")); return; }
        b.arrayBuffer().then(function (x) { ok(new Uint8Array(x)); }, fail);
      }, "image/png");
    });
  }
  function renderLayered(fmt) {
    var d = st.doc, layers = layerPixels();
    var mc = PL.view.flatten(null, 1), merged = { w: d.w, h: d.h, data: mc.getContext("2d").getImageData(0, 0, d.w, d.h).data };
    mc.width = mc.height = 0;
    if (fmt === "psd") {
      return PL.job("psdWrite", { doc: { w: d.w, h: d.h, layers: layers, merged: merged } }).then(function (bytes) {
        return new Blob([bytes], { type: MIME.psd });
      });
    }
    var k = Math.min(1, 256 / Math.max(d.w, d.h));
    var out = { w: d.w, h: d.h, layers: [] }, chain = Promise.resolve();
    layers.forEach(function (L) {
      chain = chain.then(function () { return pngOf(L.img); }).then(function (png) {
        out.layers.push({ name: L.name, x: L.img.w ? L.x : 0, y: L.img.w ? L.y : 0, op: L.op, bl: L.bl, vis: L.vis, png: png });
      });
    });
    return chain.then(function () { return pngOf(merged); }).then(function (png) {
      out.merged = png;
      return pngOf(PL.R.resize(merged, d.w * k, d.h * k));
    }).then(function (thumb) {
      out.thumb = thumb;
      return new Blob([PL.ORA.write(out)], { type: MIME.ora });
    });
  }

  function exportImage(fmt, q, scale, toPictures) {
    if (!st.doc) return;
    PL.busy(true);
    (LAYERED[fmt] ? renderLayered(fmt) : render(fmt, q, scale)).then(function (blob) {
      PL.busy(false);
      if (!blob) { PL.toast(t("msg.exportFail")); return; }
      if (fmt === "webp" && blob.type !== "image/webp") { PL.toast(t("msg.noWebp")); fmt = "png"; }
      if (toPictures) return saveToPictures(blob, fileName(fmt));
      var dlg = dialogHost();
      if (!dlg || typeof dlg.saveFile !== "function") { PL.toast(t("msg.noDialogs")); return; }
      var acc = {}; acc[MIME[fmt]] = ["." + fmt];
      return dlg.saveFile({ blob: blob, filename: fileName(fmt), mime: MIME[fmt], types: [{ description: fmt.toUpperCase(), accept: acc }] })
        .then(function (r) { if (r && r.ok) PL.toast(t("msg.exported")); });
    }, function () { PL.busy(false); PL.toast(t("msg.exportFail")); });
  }
  function saveToPictures(blob, name) {
    var fs = PL.fs();
    if (!fs) { PL.toast(t("msg.noDisk")); return; }
    var dot = name.lastIndexOf("."), base = name.slice(0, dot), ext = name.slice(dot);
    function tryName(n) {
      var p = PICTURES + "/" + (n ? base + " (" + n + ")" : base) + ext;
      return fs.stat(p).then(function () { return n < 99 ? tryName(n + 1) : Promise.reject(new Error("name")); },
                             function () { return p; });
    }
    return tryName(0).then(function (p) {
      return fs.write(p, blob).then(function () { PL.toast(t("msg.savedPictures", { name: p.split("/").pop() })); });
    }).catch(function () { PL.toast(t("msg.saveFail")); });
  }

  // ---------- Wallpaper ----------
  function wallApi() {
    try {
      var w = window.parent && window.parent !== window && window.parent.orosWallpaper;
      return w && typeof w.setImage === "function" ? w : null;
    } catch (e) { return null; }
  }
  function setWallpaper() {
    var api = wallApi();
    if (!api || !st.doc) return;
    var k = Math.min(1, 3840 / Math.max(st.doc.w, st.doc.h));
    PL.busy(true);
    render("png", 1, k).then(function (blob) {
      PL.busy(false);
      var job;
      try { job = api.setImage(blob, { bg: "#000000" }); } catch (e) { job = null; }
      return Promise.resolve(job).then(function (ok) { PL.toast(t(ok ? "msg.wallpaper" : "msg.wallpaperFail")); });
    }, function () { PL.busy(false); PL.toast(t("msg.wallpaperFail")); });
  }

  // ---------- Thumbnails ----------
  function saveThumb() {
    var fs = PL.fs(), d = st.doc;
    if (!fs || !d) return;
    var k = Math.min(1, 320 / Math.max(d.w, d.h));
    var c = PL.view.flatten(null, k), w = PL.view.canvas(c.width, c.height), g = w.getContext("2d");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, w.width, w.height);   // the list shows clear areas as white
    g.drawImage(c, 0, 0);
    c.width = c.height = 0;
    var id = d.id;
    w.toBlob(function (b) { w.width = w.height = 0; if (b) PL.ST.saveThumb(fs, id, b).catch(function () {}); }, "image/jpeg", 0.8);
  }

  // ---------- Drop + paste events ----------
  function firstImage(list) {
    for (var i = 0; i < (list ? list.length : 0); i++) {
      var f = list[i];
      if (f && (/^image\//.test(f.type) || IMG_EXT.test(f.name || ""))) return f;
    }
    return null;
  }
  function wire() {
    document.addEventListener("dragover", function (e) { e.preventDefault(); document.body.classList.add("dropping"); });
    document.addEventListener("dragleave", function (e) { if (!e.relatedTarget) document.body.classList.remove("dropping"); });
    document.addEventListener("drop", function (e) {
      e.preventDefault();
      document.body.classList.remove("dropping");
      var f = firstImage(e.dataTransfer && e.dataTransfer.files);
      if (f) openPictureFile(f, !!st.doc);
      else if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) PL.toast(t("msg.notPicture"));
    });
    document.addEventListener("paste", function (e) {
      if (document.querySelector("dialog[open]")) return;
      var tg = e.target && e.target.tagName;
      if (tg === "INPUT" || tg === "TEXTAREA") return;
      var cd = e.clipboardData, f = cd && firstImage(cd.files);
      if (!f && cd && cd.items) {
        for (var i = 0; i < cd.items.length; i++) if (/^image\//.test(cd.items[i].type)) { f = cd.items[i].getAsFile(); break; }
      }
      e.preventDefault();
      if (f) pasteBlob(f); else pasteOwn();
    });
  }

  PL.io = {
    PICTURES: PICTURES, decode: decode, openPicture: openPicture, openPictureFile: openPictureFile,
    openDiskPath: openDiskPath, setClipboard: setClipboard, pasteFromMenu: pasteFromMenu,
    exportImage: exportImage, setWallpaper: setWallpaper, canWallpaper: function () { return !!wallApi(); },
    saveThumb: saveThumb, wire: wire
  };
})();
