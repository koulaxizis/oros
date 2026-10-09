// ============================================================
// orOS designkit — assets.js (v1.0.0)
// Images shared by Layout and Atelier, stored ONCE as files on the
// orOS disk (orosFS): /internal/Assets/<sha256>.<jpg|png>. Vault
// Drive syncs them per file, encrypted, like any other file; the
// documents keep only the id (never image bytes in localStorage,
// R30).
//   - import: decoded by the browser as an IMAGE (an SVG goes
//     through <img>, where scripts never run), downscaled to
//     MAX_SIDE, re-encoded (JPEG when opaque, PNG with alpha):
//     metadata and anything that is not pixels is dropped.
//   - get(id): a decoded, cached drawable, or null while the file is
//     missing (not synced yet); onChange() tells the caller when a
//     late file lands.
// Exposes orosDK.assets (browser only).
// ============================================================
(function (root) {
  "use strict";

  var FOLDER = "/internal/Assets";
  var MAX_SIDE = 3500;
  var ID_RE = /^[0-9a-f]{64}\.(jpg|png)$/;

  function fs() {
    try { return (root.parent && root.parent.orosFS) || root.orosFS || null; }
    catch (e) { return root.orosFS || null; }
  }
  function pathOf(id) { return FOLDER + "/" + id; }

  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function sha256(blob) {
    return blob.arrayBuffer().then(function (ab) { return root.crypto.subtle.digest("SHA-256", ab); }).then(hex);
  }

  // Blob → HTMLImageElement (works for SVG too; an <img> never runs
  // scripts or loads external resources of an SVG).
  function decode(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("decode")); };
      img.src = url;
    });
  }

  function hasAlpha(ctx, w, h) {
    // sample a grid instead of every pixel (large photos)
    var step = Math.max(1, Math.floor(Math.max(w, h) / 200));
    var data = ctx.getImageData(0, 0, w, h).data;
    for (var y = 0; y < h; y += step) {
      for (var x = 0; x < w; x += step) if (data[(y * w + x) * 4 + 3] < 250) return true;
    }
    return false;
  }

  function toBlob(cv, type, q) {
    return new Promise(function (resolve, reject) {
      cv.toBlob(function (b) { if (b) resolve(b); else reject(new Error("encode")); }, type, q);
    });
  }

  // File → { id, w, h, name }. Rejects "decode" for a file that is
  // not an image, "nofs" when the disk is unavailable.
  function importFile(file) {
    var F = fs();
    if (!F) return Promise.reject(new Error("nofs"));
    return decode(file).then(function (img) {
      var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      if (!w || !h) {            // an SVG without intrinsic size
        w = 1200; h = 1200;
      }
      var s = Math.min(1, MAX_SIDE / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
      var cv = document.createElement("canvas");
      cv.width = cw; cv.height = ch;
      var ctx = cv.getContext("2d");
      ctx.drawImage(img, 0, 0, cw, ch);
      var alpha = hasAlpha(ctx, cw, ch);
      return toBlob(cv, alpha ? "image/png" : "image/jpeg", 0.92).then(function (blob) {
        return sha256(blob).then(function (h256) {
          var id = h256 + (alpha ? ".png" : ".jpg");
          var path = pathOf(id);
          return F.stat(path).then(function () { return null; }, function () { return F.write(path, blob); })
            .then(function () {
              cache[id] = { img: null, p: null };
              return loadInto(id, blob).then(function () {
                return { id: id, w: cw, h: ch, name: String(file.name || "").slice(0, 120) };
              });
            });
        });
      });
    });
  }

  // ---------- Cache ----------
  var cache = {};               // id → { img, p (pending promise), miss }
  var listeners = [];
  function onChange(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; }
  function emit(id) { listeners.forEach(function (fn) { try { fn(id); } catch (e) {} }); }

  function loadInto(id, blob) {
    return decode(blob).then(function (img) {
      cache[id] = { img: img, p: null, miss: false };
      emit(id);
      return img;
    });
  }

  // Drawable or null (starts loading in the background).
  function get(id) {
    if (!ID_RE.test(id || "")) return null;
    var c = cache[id];
    if (c && c.img) return c.img;
    if (!c || (!c.p && !c.miss)) request(id);
    return null;
  }
  function request(id) {
    var F = fs();
    if (!F) return Promise.resolve(null);
    var c = cache[id] = cache[id] || { img: null, p: null, miss: false };
    if (c.img) return Promise.resolve(c.img);
    if (c.p) return c.p;
    c.p = F.read(pathOf(id)).then(function (blob) { return loadInto(id, blob); }, function () {
      cache[id] = { img: null, p: null, miss: true };
      return null;
    });
    return c.p;
  }
  // Retry everything that was missing (e.g. after a Vault sync).
  function retryMissing() {
    Object.keys(cache).forEach(function (id) { if (cache[id].miss) { cache[id].miss = false; request(id); } });
  }
  function isMissing(id) { var c = cache[id]; return !!(c && c.miss); }
  function load(id) { return request(id); }

  // Raw file (packages).
  function blob(id) {
    var F = fs();
    if (!F || !ID_RE.test(id || "")) return Promise.resolve(null);
    return F.read(pathOf(id)).catch(function () { return null; });
  }

  // A file from a package: verified against its name before it is
  // written (the hash IS the id), then decoded once as an image.
  function put(id, b) {
    var F = fs();
    if (!F || !ID_RE.test(id || "")) return Promise.reject(new Error("badid"));
    return sha256(b).then(function (h) {
      if (h + id.slice(64) !== id) throw new Error("hash");
      return decode(b);
    }).then(function () {
      var path = pathOf(id);
      return F.stat(path).then(function () { return null; }, function () { return F.write(path, b); });
    }).then(function () { cache[id] = { img: null, p: null, miss: false }; return id; });
  }

  root.orosDK = root.orosDK || {};
  root.orosDK.assets = {
    FOLDER: FOLDER, MAX_SIDE: MAX_SIDE, ID_RE: ID_RE,
    importFile: importFile, get: get, load: load, blob: blob, put: put,
    onChange: onChange, retryMissing: retryMissing, isMissing: isMissing, decode: decode
  };
})(window);
