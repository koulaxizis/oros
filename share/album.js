// ============================================================
// orOS "Send to someone" — share/album.js (shell side, v1.0.0)
// Photo albums (share wave 4, kind "album"): turns the pictures an app
// hands over (Files: a selection or a folder; Photo Lab: the open
// picture) into what travels. Every photo is drawn again on a canvas,
// at most 2048 px on its long side, and saved as JPEG: the new file
// carries no EXIF, so no GPS position, camera serial or time leaves
// the device. The photos go into one byte run ("bin") next to the
// album's JSON (share/relay.js flag 2), ≤ 200 photos and ≤ BUDGET
// bytes; what does not fit is left out and counted.
//
// Loaded by the shell with share/send.js (lazy). Node tests load the
// pure parts (captionOf, place).
//
// API (window.OrosShareAlbum / module.exports):
//   MAX, EDGE, BUDGET
//   captionOf(name)                → caption from a file name ("" for camera names)
//   place(sizes, budget?)          → { at: [offsets], keep: n, total } (which fit)
//   prepare(items, opts)           → Promise<{ data: {t, p}, bin, skipped, cut, list }>
//      items: [{ blob? , path?, name?, c? }]
//      opts:  { title, read(path) → Promise<Blob>, onProgress(done, all),
//               faces?(canvas) → Promise<boxes> (Blur faces), signal? }
//   pack(list, title)              → { data, bin } again after a change
//   drawn(blob) / redraw(blob, hook?) / sourceOf(item, read)
// ============================================================
(function (root) {
  "use strict";

  var MAX = 200;
  var EDGE = 2048;
  var QUALITY = 0.85;
  var BUDGET = 25000000;            // photo bytes; the relay takes 25 MiB in all (relay/share.js)
  var PHOTO_MAX = 8388608;          // share/kinds.js normAlbum
  var IMG_RE = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif|tiff?)$/i;
  var CAMERA_RE = /^(img|dsc|dscn|dscf|pxl|mvimg|photo|image|screenshot|screen shot|wp|vid|gopr|p\d|sam|dji)[ _-]?[\d_ -]{3,}/i;

  // "Beach at sunset.jpg" → "Beach at sunset"; "IMG_2034.JPG" → "".
  function captionOf(name) {
    var b = String(name || "").replace(/^.*[\\\/]/, "").replace(/\.[a-z0-9]{1,5}$/i, "")
      .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
    if (!b || CAMERA_RE.test(b) || /^[\d\s_.:-]+$/.test(b)) return "";
    return b.slice(0, 300);
  }
  // Offsets for photos of these sizes, in order, while they fit.
  function place(sizes, budget) {
    var lim = budget || BUDGET, at = [], total = 0;
    for (var i = 0; i < sizes.length && at.length < MAX; i++) {
      if (sizes[i] > PHOTO_MAX || total + sizes[i] > lim) break;
      at.push(total);
      total += sizes[i];
    }
    return { at: at, keep: at.length, total: total };
  }
  function isPicture(name) { return IMG_RE.test(String(name || "")); }

  // ---------- Drawing (browser) ----------
  function decode(blob) {
    if (typeof createImageBitmap === "function") {
      return createImageBitmap(blob, { imageOrientation: "from-image" }).catch(function () { return viaImg(blob); });
    }
    return viaImg(blob);
  }
  function viaImg(blob) {
    return new Promise(function (ok, fail) {
      var url = URL.createObjectURL(blob), im = new Image();
      im.onload = function () { URL.revokeObjectURL(url); ok(im); };
      im.onerror = function () { URL.revokeObjectURL(url); fail(new Error("img")); };
      im.src = url;
    });
  }
  // One photo drawn again → a canvas (≤ EDGE, white under transparency),
  // or null. The same picture gives the same canvas, so face boxes found
  // on one drawing fit the next (share/faces.js review).
  function drawn(blob) {
    return decode(blob).then(function (img) {
      var w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
      if (!w0 || !h0) return null;
      var k = Math.min(1, EDGE / Math.max(w0, h0));
      var w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
      var c = document.createElement("canvas");
      c.width = w; c.height = h;
      var g = c.getContext("2d");
      g.fillStyle = "#ffffff";                    // JPEG has no transparency
      g.fillRect(0, 0, w, h);
      g.imageSmoothingQuality = "high";
      g.drawImage(img, 0, 0, w, h);
      if (img.close) try { img.close(); } catch (e) {}
      return c;
    }).then(null, function () { return null; });
  }
  // One photo → { bytes, w, h, f? } as a fresh JPEG (no EXIF), or null.
  // hook(canvas) (optional, "Blur faces"): changes the canvas before it
  // is saved and gives back what it found (f); when it fails the photo
  // fails, so a photo meant to be blurred never leaves unblurred.
  function redraw(blob, hook) {
    return drawn(blob).then(function (c) {
      if (!c) return null;
      return Promise.resolve(hook ? hook(c) : undefined).then(function (f) {
        return new Promise(function (ok) {
          c.toBlob(function (b) { var w = c.width, h = c.height; c.width = c.height = 0; ok(b ? { b: b, w: w, h: h } : null); }, "image/jpeg", QUALITY);
        }).then(function (r) {
          if (!r) return null;
          return r.b.arrayBuffer().then(function (ab) {
            var o = { bytes: new Uint8Array(ab), w: r.w, h: r.h };
            if (f !== undefined) o.f = f;
            return o;
          });
        });
      });
    }, function () { return null; }).then(null, function (e) {
      if (hook) throw e;
      return null;
    });
  }

  // opts.faces (optional): a hook for redraw (share/faces.js). A hook
  // that fails stops the whole preparation (Promise rejected).
  // The result also has list: [{ bytes, w, h, c, it, f? }] (it = the
  // item given) for pack() after a photo was done again.
  function prepare(items, opts) {
    opts = opts || {};
    var list = (items || []).slice(0, MAX), done = [], skipped = 0, cut = (items || []).length > MAX, used = 0;
    var progress = typeof opts.onProgress === "function" ? opts.onProgress : function () {};
    var i = 0;
    function next() {
      if (i >= list.length || cut) return Promise.resolve();
      if (opts.signal && opts.signal.aborted) return Promise.reject(new Error("abort"));
      var it = list[i++] || {};
      progress(i - 1, list.length);
      return sourceOf(it, opts.read).then(function (b) { return b ? redraw(b, opts.faces) : null; }).then(function (r) {
        if (!r || r.bytes.length > PHOTO_MAX) { skipped++; return next(); }
        if (used + r.bytes.length > BUDGET) { cut = true; return; }
        used += r.bytes.length;
        var c = typeof it.c === "string" ? it.c : captionOf(it.name || it.path || "");
        var e = { bytes: r.bytes, w: r.w, h: r.h, c: c, it: it };
        if (r.f !== undefined) e.f = r.f;
        done.push(e);
        return next();
      });
    }
    return next().then(function () {
      progress(list.length, list.length);
      var out = pack(done, opts.title);
      out.skipped = skipped;
      out.cut = cut;
      out.list = done.slice(0, out.data.p.length);
      return out;
    });
  }
  // The item's picture: its blob, or read(path); null when unreadable.
  function sourceOf(it, read) {
    if (it && it.blob) return Promise.resolve(it.blob);
    if (it && it.path && typeof read === "function") return Promise.resolve(read(it.path)).then(null, function () { return null; });
    return Promise.resolve(null);
  }
  // [{ bytes, w, h, c }] → { data: { t, p }, bin } (what fits, in order).
  function pack(done, title) {
    var pl = place(done.map(function (x) { return x.bytes.length; }));
    var bin = new Uint8Array(pl.total), p = [];
    for (var j = 0; j < pl.keep; j++) {
      bin.set(done[j].bytes, pl.at[j]);
      var q = { o: pl.at[j], n: done[j].bytes.length, m: "image/jpeg", w: done[j].w, h: done[j].h };
      if (done[j].c) q.c = done[j].c.slice(0, 300);
      p.push(q);
    }
    return { data: { t: String(title || "").slice(0, 120), p: p }, bin: bin };
  }

  var api = { MAX: MAX, EDGE: EDGE, BUDGET: BUDGET, captionOf: captionOf, place: place, isPicture: isPicture,
              drawn: drawn, redraw: redraw, prepare: prepare, pack: pack, sourceOf: sourceOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosShareAlbum = api;
})(typeof window !== "undefined" ? window : globalThis);
