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
  var IMG_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|svg|ico)$/i;
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
  function openPictureFile(file, asLayer) {
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
    var p = dlg && typeof dlg.openFile === "function" ? dlg.openFile("image/*") : Promise.resolve(null);
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
  var MIME = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
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
  function exportImage(fmt, q, scale, toPictures) {
    if (!st.doc) return;
    PL.busy(true);
    render(fmt, q, scale).then(function (blob) {
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
