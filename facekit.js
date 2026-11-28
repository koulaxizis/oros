// ============================================================
// orOS Core — facekit.js: find faces and blur them (FACE-BLUR, v1.0.0)
// ------------------------------------------------------------
// The shared engine behind "Blur faces" when photos are sent to
// someone (share/faces.js, every album sender: Photos, Files, Photo
// Lab) and Photo Lab's Select › Faces / Filter › Blur faces.
//
// FACE DETECTION ONLY, NEVER RECOGNITION: the model says where a face
// is (a box and a score), nothing about whose face it is. No face
// data is kept, synced or sent; the boxes live only while a dialog is
// open. Everything runs on the device.
//
// Model: YuNet (face_detection_yunet_2023mar.onnx, OpenCV Zoo, MIT,
// © Shiqi Yu and contributors, ≈ 230 KB), mirrored unchanged in
// koulaxizis/oros-models-vision (GitHub Pages) and SHA-256 checked
// before it is used. It runs in the vendored ONNX Runtime Web
// (vendor/ort/) through Atelier's loader (atelier/cutout.js
// sessionOf), so the runtime and the model sit in the IndexedDB
// "oros-atelier-ai" every picture tool shares: downloaded once, on
// the person's request, offline after that.
//
// Loaded on first use (never at boot) from the app's page:
// "<base>/facekit.js?v=<version>"; it finds atelier/cutout.js next to
// itself.
//
// API (window.OrosFaces, or module.exports in Node for the pure parts):
//   SIDE, THR, MODEL, STYLES
//   fit(w, h, side?)            → { k, w, h } scale into side × side
//   toInput(rgba, w, h)         → Float32Array 1×3×640×640 (BGR, 0..255,
//                                 top-left, the rest 0)
//   decode(outs, k, ox, oy, thr?) → [{ x, y, w, h, s }] in source pixels
//   nms(boxes, iou?)            → the boxes left after non-maximum
//                                 suppression (highest score first)
//   tiles(w, h)                 → [] or four overlapping regions of a
//                                 big picture (small faces in groups)
//   head(box, W?, H?)           → { cx, cy, rx, ry } the ellipse that
//                                 covers the head (a bit more than the box)
//   blurInto(rgba, W, H, boxes, style?, opts?) → the count blurred;
//       style "blur" (default) | "pixelate" | "fill". opts.layer: write
//       only the faces (alpha = the soft ellipse, the rest transparent)
//       instead of mixing into the picture. A box with off: true is skipped.
//   hit(boxes, x, y)            → index of the box whose ellipse holds
//                                 the point, else -1
//   Browser only:
//   ready()                     → Promise<bool> everything is on the device
//   needMB()                    → Promise<number> what a first use downloads
//   detect(src, opts)           → Promise<boxes> in src pixels;
//       opts { signal, onProgress(0..1), onRun() }
//   blurCanvas(canvas, boxes, style) → count, in place
//   editor(canvas, boxes, L)    → { el, boxes(), redraw() } a picture with
//       the faces outlined: tap a face to keep it clear (dashed) or blur
//       it again, drag on the picture to add a face that was missed.
//       L: { hint, kept } strings.
// ============================================================
(function (root) {
  "use strict";

  var SIDE = 640;                  // YuNet 2023mar's fixed input
  var THR = 0.6;                   // lower than OpenCV's 0.9: a missed face is worse than a blurred ear
  var IOU = 0.3;
  var STRIDES = [8, 16, 32];
  var STYLES = ["blur", "pixelate", "fill"];
  var MIRROR = "https://koulaxizis.github.io/oros-models-vision/";
  var MODEL = {
    url: MIRROR + "yunet/face_detection_yunet_2023mar.onnx",
    v: "yunet-2023mar",
    sha: "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    bytes: 232589
  };

  // ---------- Pure steps ----------
  function fit(w, h, side) {
    side = side || SIDE;
    var k = Math.min(1, side / Math.max(w, h));
    return { k: k, w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }
  // RGBA (w × h, w and h ≤ SIDE) → BGR planes at the top-left of a
  // SIDE × SIDE input, the rest black (OpenCV's FaceDetectorYN pads the
  // same way; the model takes raw 0..255 values).
  function toInput(rgba, w, h) {
    var plane = SIDE * SIDE, out = new Float32Array(3 * plane);
    for (var y = 0; y < h && y < SIDE; y++) {
      for (var x = 0; x < w && x < SIDE; x++) {
        var i = (y * w + x) * 4, o = y * SIDE + x;
        out[o] = rgba[i + 2];
        out[plane + o] = rgba[i + 1];
        out[2 * plane + o] = rgba[i];
      }
    }
    return out;
  }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  // outs: { cls_8, obj_8, bbox_8, … } (flat Float32Arrays). k: the scale
  // the region was drawn at; ox, oy: the region's place in the source.
  function decode(outs, k, ox, oy, thr) {
    thr = thr == null ? THR : thr;
    var res = [];
    STRIDES.forEach(function (st) {
      var cls = outs["cls_" + st], obj = outs["obj_" + st], bb = outs["bbox_" + st];
      if (!cls || !obj || !bb) return;
      var cols = SIDE / st, n = cls.length;
      for (var i = 0; i < n; i++) {
        var s = Math.sqrt(clamp01(cls[i]) * clamp01(obj[i]));
        if (!(s >= thr)) continue;
        var r = Math.floor(i / cols), c = i - r * cols;
        var cx = (c + bb[i * 4]) * st, cy = (r + bb[i * 4 + 1]) * st;
        var w = Math.exp(bb[i * 4 + 2]) * st, h = Math.exp(bb[i * 4 + 3]) * st;
        if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) continue;
        res.push({ x: ox + (cx - w / 2) / k, y: oy + (cy - h / 2) / k, w: w / k, h: h / k, s: s });
      }
    });
    return res;
  }
  function iouOf(a, b) {
    var x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
    var x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
    var i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    var u = a.w * a.h + b.w * b.h - i;
    return u > 0 ? i / u : 0;
  }
  // Also drops a box mostly inside a bigger kept one (a face found
  // twice, whole and in a tile's cut).
  function nms(boxes, iou) {
    iou = iou == null ? IOU : iou;
    var list = boxes.slice().sort(function (a, b) { return b.s - a.s; }), keep = [];
    list.forEach(function (b) {
      for (var j = 0; j < keep.length; j++) {
        var k = keep[j];
        if (iouOf(b, k) > iou) return;
        var x0 = Math.max(b.x, k.x), y0 = Math.max(b.y, k.y);
        var x1 = Math.min(b.x + b.w, k.x + k.w), y1 = Math.min(b.y + b.h, k.y + k.h);
        var inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
        if (inter > 0.7 * Math.min(b.w * b.h, k.w * k.h)) return;
      }
      keep.push(b);
    });
    return keep;
  }
  // A big picture (long side over 2 × SIDE) is also looked at in four
  // overlapping quarters, so faces of a group photo are not too small.
  function tiles(w, h) {
    if (Math.max(w, h) <= 2 * SIDE) return [];
    var tw = Math.round(w * 0.58), th = Math.round(h * 0.58), out = [];
    [0, w - tw].forEach(function (x) {
      [0, h - th].forEach(function (y) { out.push({ x: x, y: y, w: tw, h: th }); });
    });
    return out;
  }
  // The model's box is the face from brows to chin; the ellipse also
  // takes the forehead, hair line and ears.
  function head(b) {
    return { cx: b.x + b.w / 2, cy: b.y + b.h * 0.4, rx: b.w * 0.66, ry: b.h * 0.72 };
  }
  function hit(boxes, x, y) {
    for (var i = boxes.length - 1; i >= 0; i--) {
      var e = head(boxes[i]), dx = (x - e.cx) / e.rx, dy = (y - e.cy) / e.ry;
      if (dx * dx + dy * dy <= 1) return i;
    }
    return -1;
  }

  // One face: its ellipse's box clipped to the picture → the effect
  // (blur / pixelate / fill) in a patch, then mixed in with a soft edge.
  function rng(seed) {
    var s = seed >>> 0 || 1;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function boxBlur(p, w, h, r) {
    var tmp = new Float32Array(p.length), x, y, c, k;
    for (y = 0; y < h; y++) for (c = 0; c < 3; c++) {
      var acc = 0, cnt = 0;
      for (k = -r; k <= r; k++) { if (k >= 0 && k < w) { acc += p[(y * w + k) * 3 + c]; cnt++; } }
      for (x = 0; x < w; x++) {
        tmp[(y * w + x) * 3 + c] = acc / cnt;
        var o = x - r, n = x + r + 1;
        if (o >= 0) { acc -= p[(y * w + o) * 3 + c]; cnt--; }
        if (n < w) { acc += p[(y * w + n) * 3 + c]; cnt++; }
      }
    }
    for (x = 0; x < w; x++) for (c = 0; c < 3; c++) {
      var a2 = 0, n2 = 0;
      for (k = -r; k <= r; k++) { if (k >= 0 && k < h) { a2 += tmp[(k * w + x) * 3 + c]; n2++; } }
      for (y = 0; y < h; y++) {
        p[(y * w + x) * 3 + c] = a2 / n2;
        var o2 = y - r, m2 = y + r + 1;
        if (o2 >= 0) { a2 -= tmp[(o2 * w + x) * 3 + c]; n2--; }
        if (m2 < h) { a2 += tmp[(m2 * w + x) * 3 + c]; n2++; }
      }
    }
  }
  function mosaic(p, w, h, cell) {
    for (var y0 = 0; y0 < h; y0 += cell) for (var x0 = 0; x0 < w; x0 += cell) {
      var y1 = Math.min(h, y0 + cell), x1 = Math.min(w, x0 + cell), s = [0, 0, 0], n = 0, x, y, c;
      for (y = y0; y < y1; y++) for (x = x0; x < x1; x++) { for (c = 0; c < 3; c++) s[c] += p[(y * w + x) * 3 + c]; n++; }
      for (y = y0; y < y1; y++) for (x = x0; x < x1; x++) for (c = 0; c < 3; c++) p[(y * w + x) * 3 + c] = s[c] / n;
    }
  }
  function blurInto(rgba, W, H, boxes, style, opts) {
    style = STYLES.indexOf(style) >= 0 ? style : "blur";
    opts = opts || {};
    var layer = !!opts.layer, done = 0;
    var src = layer ? new Uint8ClampedArray(rgba) : rgba;
    if (layer) for (var z = 3; z < rgba.length; z += 4) rgba[z] = 0;
    (boxes || []).forEach(function (b, bi) {
      if (!b || b.off) return;
      var e = head(b);
      if (!(e.rx >= 1 && e.ry >= 1)) return;
      var x0 = Math.max(0, Math.floor(e.cx - e.rx)), y0 = Math.max(0, Math.floor(e.cy - e.ry));
      var x1 = Math.min(W, Math.ceil(e.cx + e.rx)), y1 = Math.min(H, Math.ceil(e.cy + e.ry));
      var w = x1 - x0, h = y1 - y0;
      if (w <= 0 || h <= 0) return;
      var p = new Float32Array(w * h * 3), x, y, c;
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        var i = ((y + y0) * W + x + x0) * 4, j = (y * w + x) * 3;
        p[j] = src[i]; p[j + 1] = src[i + 1]; p[j + 2] = src[i + 2];
      }
      var R = Math.min(e.rx, e.ry);
      if (style === "fill") {
        for (j = 0; j < p.length; j += 3) { p[j] = 58; p[j + 1] = 58; p[j + 2] = 64; }
      } else if (style === "pixelate") {
        mosaic(p, w, h, Math.max(3, Math.round(R / 4)));
      } else {
        // a coarse mosaic first (≈ 7 cells across the face: what makes it
        // unreadable), then smoothed so it looks like a blur, then a little
        // noise so no smooth gradient is left to work back from
        var cell = Math.max(2, Math.round(R / 3.5));
        mosaic(p, w, h, cell);
        boxBlur(p, w, h, cell);
        boxBlur(p, w, h, cell);
        var rnd = rng((Math.round(b.x) * 73856093) ^ (Math.round(b.y) * 19349663) ^ (bi + 1));
        for (var j = 0; j < p.length; j++) p[j] += (rnd() - 0.5) * 16;
      }
      var fe = Math.max(1.5, R * 0.12);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        var dx = (x + x0 + 0.5 - e.cx) / e.rx, dy = (y + y0 + 0.5 - e.cy) / e.ry;
        var d = Math.sqrt(dx * dx + dy * dy), a = clamp01((1 - d) * R / fe);
        if (a <= 0) continue;
        var q = ((y + y0) * W + x + x0) * 4, t = (y * w + x) * 3;
        if (layer) {
          // the soft edge goes into alpha; a pixel two faces share keeps the stronger
          var na = Math.round(a * src[q + 3]);
          if (na < rgba[q + 3]) continue;
          rgba[q] = p[t]; rgba[q + 1] = p[t + 1]; rgba[q + 2] = p[t + 2]; rgba[q + 3] = na;
        } else {
          for (c = 0; c < 3; c++) rgba[q + c] = rgba[q + c] * (1 - a) + p[t + c] * a;
        }
      }
      done++;
    });
    return done;
  }

  var pure = { SIDE: SIDE, THR: THR, MODEL: MODEL, STYLES: STYLES, fit: fit, toInput: toInput, decode: decode,
    nms: nms, tiles: tiles, head: head, hit: hit, blurInto: blurInto };
  if (typeof module !== "undefined" && module.exports) { module.exports = pure; return; }

  // ---------- Loader (browser) ----------
  var me = (document.currentScript && document.currentScript.src) || "";
  var verM = me.match(/[?&]v=([^&#]+)/);
  function near(path) { return new URL(path + (verM ? "?v=" + verM[1] : ""), me || location.href).href; }
  var cutP = null;
  function cutout() {
    if (root.AtelierCutout) return Promise.resolve(root.AtelierCutout);
    if (!cutP) {
      cutP = new Promise(function (ok, fail) {
        var s = document.createElement("script");
        s.src = near("atelier/cutout.js");
        s.onload = function () { if (root.AtelierCutout) ok(root.AtelierCutout); else fail(new Error("cutout")); };
        s.onerror = function () { fail(new Error("cutout")); };
        document.head.appendChild(s);
      });
      cutP.catch(function () { cutP = null; });
    }
    return cutP;
  }
  // Atelier's runtime entries (same names and version, so one download
  // serves every picture tool) + YuNet.
  function specOf(CUT, modelUrl) {
    var spec = CUT.list(CUT.FILES, CUT.FILES_VER);
    delete spec.model;                       // not the background model
    spec.yunet = { url: modelUrl || MODEL.url, v: MODEL.v };
    return spec;
  }
  function runtimeSpec(CUT) { var s = specOf(CUT); delete s.yunet; return s; }
  function ready() {
    return cutout().then(function (CUT) { return CUT.readyOf(specOf(CUT)); }, function () { return false; });
  }
  function needMB() {
    return cutout().then(function (CUT) {
      return CUT.readyOf(runtimeSpec(CUT)).then(function (rt) {
        return CUT.readyOf({ yunet: { v: MODEL.v } }).then(function (m) {
          return (rt ? 0 : 11) + (m ? 0 : 0.3);
        });
      });
    });
  }
  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  // The model from the mirror, checked against its SHA-256 before
  // anything else sees it → a blob: URL Atelier's loader fetches and
  // keeps (so nothing unchecked is ever stored).
  function verified(signal) {
    return fetch(MODEL.url, { cache: "no-cache", signal: signal, credentials: "omit" }).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.arrayBuffer();
    }).then(function (buf) {
      if (!root.crypto || !crypto.subtle) throw new Error("crypto");
      return crypto.subtle.digest("SHA-256", buf).then(function (d) {
        if (hex(d) !== MODEL.sha) throw new Error("checksum");
        return URL.createObjectURL(new Blob([buf], { type: "application/octet-stream" }));
      });
    });
  }
  var sessP = null;
  function session(onProgress, signal) {
    if (sessP) return sessP;
    var p = sessP = cutout().then(function (CUT) {
      return CUT.readyOf({ yunet: { v: MODEL.v } }).then(function (have) {
        return have ? null : verified(signal);
      }).then(function (blobUrl) {
        return needMB().then(function (mb) {
          // with the model already kept, a URL that cannot be fetched: if
          // the kept copy cannot be read, nothing unchecked is downloaded
          return CUT.sessionOf(specOf(CUT, blobUrl || "about:invalid"), "yunet", Math.max(0.3, mb), onProgress, signal).then(function (s) {
            if (blobUrl) URL.revokeObjectURL(blobUrl);
            return s;
          }, function (e) { if (blobUrl) URL.revokeObjectURL(blobUrl); throw e; });
        });
      });
    });
    p.catch(function () { if (sessP === p) sessP = null; });
    return p;
  }

  // ---------- Detection (browser) ----------
  var queue = Promise.resolve();         // one run at a time (one wasm thread)
  function canvas(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function pass(sess, src, r) {
    var f = fit(r.w, r.h), c = canvas(f.w, f.h), g = c.getContext("2d", { willReadFrequently: true });
    g.imageSmoothingQuality = "high";
    g.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, f.w, f.h);
    var px = g.getImageData(0, 0, f.w, f.h).data, feeds = {};
    c.width = c.height = 0;
    feeds[sess.inputNames[0]] = new root.ort.Tensor("float32", toInput(px, f.w, f.h), [1, 3, SIDE, SIDE]);
    return sess.run(feeds).then(function (out) {
      var o = {};
      Object.keys(out).forEach(function (k) { o[k] = out[k].data; });
      return decode(o, f.k, r.x, r.y);
    });
  }
  function detect(src, opts) {
    opts = opts || {};
    var W = src.naturalWidth || src.videoWidth || src.width, H = src.naturalHeight || src.videoHeight || src.height;
    if (!W || !H) return Promise.reject(new Error("decode"));
    return session(opts.onProgress, opts.signal).then(function (sess) {
      var job = queue.then(function () {
        if (opts.signal && opts.signal.aborted) throw new Error("abort");
        if (opts.onRun) opts.onRun();
        var regions = [{ x: 0, y: 0, w: W, h: H }].concat(tiles(W, H)), all = [];
        return regions.reduce(function (p, r) {
          return p.then(function () {
            if (opts.signal && opts.signal.aborted) throw new Error("abort");
            return pass(sess, src, r).then(function (l) { all = all.concat(l); });
          });
        }, Promise.resolve()).then(function () {
          return nms(all).map(function (b) {
            return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h), s: Math.round(b.s * 100) / 100 };
          }).sort(function (a, b) { return a.x - b.x || a.y - b.y; });
        });
      });
      queue = job.catch(function () {});
      return job;
    });
  }
  function blurCanvas(cv, boxes, style) {
    var live = (boxes || []).filter(function (b) { return !b.off; });
    if (!live.length) return 0;
    var g = cv.getContext("2d", { willReadFrequently: true });
    var img = g.getImageData(0, 0, cv.width, cv.height);
    var n = blurInto(img.data, cv.width, cv.height, live, style);
    g.putImageData(img, 0, 0);
    return n;
  }

  // ---------- Review (browser) ----------
  // A picture with the faces on it: solid outline = blurred, dashed =
  // kept clear. Tap a face to switch; drag on the picture to add one.
  function editor(src, boxes, L) {
    L = L || {};
    var W = src.width, H = src.height, list = boxes.map(function (b) { return Object.assign({}, b); });
    var wrap = document.createElement("div");
    wrap.className = "fk-ed";
    var cv = canvas(W, H);
    cv.className = "fk-cv";
    cv.style.touchAction = "none";
    cv.setAttribute("role", "img");
    if (L.label) cv.setAttribute("aria-label", L.label);
    wrap.appendChild(cv);
    var g = cv.getContext("2d"), drag = null;
    function paint() {
      g.drawImage(src, 0, 0);
      var lw = Math.max(2, Math.round(Math.max(W, H) / 300));
      list.forEach(function (b) {
        var e = head(b);
        g.save();
        g.beginPath();
        g.ellipse(e.cx, e.cy, e.rx, e.ry, 0, 0, Math.PI * 2);
        g.lineWidth = lw * 2; g.strokeStyle = "rgba(0,0,0,0.65)"; g.setLineDash(b.off ? [lw * 4, lw * 3] : []); g.stroke();
        g.lineWidth = lw; g.strokeStyle = b.off ? "#ffffff" : "#ffd23f"; g.stroke();
        if (!b.off) { g.fillStyle = "rgba(255,210,63,0.18)"; g.fill(); }
        g.restore();
      });
      if (drag && drag.on) {
        g.save(); g.setLineDash([lw * 3, lw * 2]); g.lineWidth = lw; g.strokeStyle = "#ffd23f";
        g.strokeRect(Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
        g.restore();
      }
    }
    function at(ev) {
      var r = cv.getBoundingClientRect();
      return { x: (ev.clientX - r.left) * W / (r.width || 1), y: (ev.clientY - r.top) * H / (r.height || 1) };
    }
    cv.addEventListener("pointerdown", function (ev) {
      var p = at(ev);
      drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, on: false, id: ev.pointerId };
      try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
    });
    cv.addEventListener("pointermove", function (ev) {
      if (!drag || ev.pointerId !== drag.id) return;
      var p = at(ev);
      drag.x1 = p.x; drag.y1 = p.y;
      var r = cv.getBoundingClientRect(), moved = Math.hypot(p.x - drag.x0, p.y - drag.y0) * (r.width || W) / W;
      if (moved > 8) drag.on = true;
      if (drag.on) paint();
    });
    function end(ev) {
      if (!drag || ev.pointerId !== drag.id) return;
      var d = drag; drag = null;
      if (d.on) {
        var w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
        if (w > 4 && h > 4) {
          // the drawn rectangle is the whole head: back to a model-sized box
          var bw = w / 1.32, bh = h / 1.44, cx = (d.x0 + d.x1) / 2, cy = (d.y0 + d.y1) / 2;
          list.push({ x: Math.round(cx - bw / 2), y: Math.round(cy - 0.4 * bh), w: Math.round(bw), h: Math.round(bh), s: 1, m: 1 });
        }
      } else {
        var i = hit(list, d.x0, d.y0);
        if (i >= 0) {
          if (list[i].m) list.splice(i, 1);           // a face added by hand goes away
          else list[i].off = !list[i].off;
        }
      }
      paint();
      if (L.onChange) L.onChange(list);
    }
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", function () { drag = null; paint(); });
    paint();
    return { el: wrap, canvas: cv, boxes: function () { return list.map(function (b) { return Object.assign({}, b); }); }, redraw: paint };
  }

  root.OrosFaces = Object.assign({}, pure, {
    ready: ready, needMB: needMB, detect: detect, blurCanvas: blurCanvas, editor: editor
  });
})(typeof window !== "undefined" ? window : this);
