// ============================================================
// orOS — atelier/smartai.js: Smart select and Colourize on the
// device (SC, v1.0.0), shared by Photo Lab and Atelier
// Chris 2026-11-28 («Ναι σε όλα, σύμφωνα με το πλάνο σου»):
//   - Smart select: click an object, it is selected. SlimSAM-77
//     (a pruned Segment Anything, Apache-2.0): its image encoder runs
//     once per picture (a few seconds), each click then only runs the
//     small mask decoder (a fraction of a second)
//   - Colourize: DDColor tiny (Apache-2.0) guesses the colours of a
//     black-and-white photo at 256 or 512 px; the colours are laid on
//     the picture's own lightness at its full size, so no detail is lost
// Both models come from the orOS model mirror koulaxizis/oros-models-
// vision (GitHub Pages), only when the person asks, and are kept only
// when their SHA-256 matches; they live in the IndexedDB
// "oros-atelier-ai" with the other picture tools (never synced, never in
// the service worker's caches) and run in ONNX Runtime Web (vendor/ort,
// MIT) through Atelier's loader atelier/cutout.js (AtelierCutout, loaded
// by the caller first). Nothing a model sees leaves the device.
// Exposes window.OrosSmartAI (browser) or module.exports (the pure
// steps, for the unit tests).
// ============================================================
(function (root) {
  "use strict";

  // ---------- The models ----------
  var MIRROR = "https://koulaxizis.github.io/oros-models-vision/";
  var MODELS = {
    samEnc: {
      key: "slimsam-enc",
      parts: [{ url: MIRROR + "slimsam-77-uniform/onnx/vision_encoder_quantized.onnx", size: 8882165 }],
      sha: "cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971"
    },
    samDec: {
      key: "slimsam-dec",
      parts: [{ url: MIRROR + "slimsam-77-uniform/onnx/prompt_encoder_mask_decoder_quantized.onnx", size: 4903810 }],
      sha: "cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2"
    },
    // over 95 MB, so the mirror keeps it in two parts; sha is the whole file's
    color: {
      key: "ddcolor-tiny",
      parts: [{ url: MIRROR + "ddcolor/ddcolor_tiny.onnx.part00", size: 95000000 },
              { url: MIRROR + "ddcolor/ddcolor_tiny.onnx.part01", size: 40696757 }],
      sha: "422bfa6f6d27d57106412d70874b4b8468bb29b777f16e3e15dfc9958f5b72cf"
    }
  };
  var RUNTIME_MB = 12;                                // ONNX Runtime, shared with Remove background
  var SAM_SIDE = 1024, SAM_GRID = 256;                // the encoder's input; the decoder's masks
  var MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ---------- Pure steps: Smart select ----------
  // A w × h picture → its size inside the encoder's 1024 square (long
  // side 1024, the rest padded).
  function samSize(w, h) {
    var k = SAM_SIDE / Math.max(w, h);
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), k: k };
  }
  // RGBA already at rw × rh → Float32Array 3 × 1024 × 1024 (CHW),
  // ImageNet-normalised, padded with 0 right and below (SamProcessor).
  function samPrep(rgba, rw, rh) {
    var plane = SAM_SIDE * SAM_SIDE, out = new Float32Array(3 * plane);
    for (var y = 0; y < rh; y++) {
      for (var x = 0; x < rw; x++) {
        var i = (y * rw + x) * 4, o = y * SAM_SIDE + x;
        for (var c = 0; c < 3; c++) out[c * plane + o] = (rgba[i + c] / 255 - MEAN[c]) / STD[c];
      }
    }
    return out;
  }
  // Points on the picture ({ x, y, add }) → the decoder's tensors' data,
  // in the 1024 square's coordinates (labels: 1 keep, 0 leave out).
  function samPoints(pts, k) {
    var xy = new Float32Array(pts.length * 2), lab = [];
    pts.forEach(function (p, i) { xy[i * 2] = (p.x + 0.5) * k; xy[i * 2 + 1] = (p.y + 0.5) * k; lab.push(p.add === false ? 0 : 1); });
    return { xy: xy, labels: lab };
  }
  // The decoder gives 3 masks with a quality score each; the first is
  // the whole object (a click on a shirt means the person, as in
  // Photoshop's Object selection), the others parts of it. part: the
  // best scored part instead. The whole object unless it scores far
  // below the best.
  function bestMask(scores, n, part) {
    var best = part && n > 1 ? 1 : 0, i;
    for (i = best + 1; i < n; i++) if (scores[i] > scores[best]) best = i;
    if (part) return best;
    var top = 0;
    for (i = 1; i < n; i++) if (scores[i] > scores[top]) top = i;
    return scores[0] >= scores[top] - 0.25 ? 0 : top;
  }
  // One 256 × 256 mask of logits (it covers the 1024 square) → alpha
  // 0..255 for an outW × outH copy of the picture (rw × rh of the 1024
  // square is the picture). soft: how many logits the edge takes (> 0).
  function samAlpha(logits, off, rw, rh, outW, outH, soft) {
    var out = new Uint8ClampedArray(outW * outH), s = soft || 1, g = SAM_GRID / SAM_SIDE;
    for (var y = 0; y < outH; y++) {
      var gy = clamp(((y + 0.5) * rh / outH) * g - 0.5, 0, SAM_GRID - 1), y0 = Math.floor(gy), y1 = Math.min(SAM_GRID - 1, y0 + 1), fy = gy - y0;
      for (var x = 0; x < outW; x++) {
        var gx = clamp(((x + 0.5) * rw / outW) * g - 0.5, 0, SAM_GRID - 1), x0 = Math.floor(gx), x1 = Math.min(SAM_GRID - 1, x0 + 1), fx = gx - x0;
        var v = (logits[off + y0 * SAM_GRID + x0] * (1 - fx) + logits[off + y0 * SAM_GRID + x1] * fx) * (1 - fy) +
                (logits[off + y1 * SAM_GRID + x0] * (1 - fx) + logits[off + y1 * SAM_GRID + x1] * fx) * fy;
        out[y * outW + x] = Math.round(clamp(0.5 + v / (2 * s), 0, 1) * 255);
      }
    }
    return out;
  }
  // A quick fingerprint of RGBA (every 7th byte): the encoder's result is
  // kept while the picture stays the same.
  function fingerprint(rgba, w, h) {
    var hsh = 2166136261 >>> 0;
    for (var i = 0; i < rgba.length; i += 7) { hsh ^= rgba[i]; hsh = Math.imul(hsh, 16777619) >>> 0; }
    return w + "x" + h + ":" + hsh.toString(16);
  }

  // ---------- Pure steps: Colourize (CIE L*a*b*, D65, as OpenCV's float Lab) ----------
  var WX = 0.950456, WZ = 1.088754;
  var LIN = new Float32Array(256);
  for (var li = 0; li < 256; li++) { var cv0 = li / 255; LIN[li] = cv0 <= 0.04045 ? cv0 / 12.92 : Math.pow((cv0 + 0.055) / 1.055, 2.4); }
  var GAMMA_N = 4096, GAMMA = new Uint8ClampedArray(GAMMA_N + 1);
  for (var gi = 0; gi <= GAMMA_N; gi++) { var lv = gi / GAMMA_N; GAMMA[gi] = Math.round((lv <= 0.0031308 ? 12.92 * lv : 1.055 * Math.pow(lv, 1 / 2.4) - 0.055) * 255); }
  function fLab(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
  function fInv(f) { return f > 0.206893 ? f * f * f : (f - 16 / 116) / 7.787; }
  // sRGB bytes → L* (0..100)
  function lightness(r, g, b) {
    var y = 0.212671 * LIN[r] + 0.715160 * LIN[g] + 0.072169 * LIN[b];
    return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
  }
  function lab(r, g, b) {
    var lr = LIN[r], lg = LIN[g], lb = LIN[b];
    var fx = fLab((0.412453 * lr + 0.357580 * lg + 0.180423 * lb) / WX);
    var y = 0.212671 * lr + 0.715160 * lg + 0.072169 * lb, fy = fLab(y);
    var fz = fLab((0.019334 * lr + 0.119193 * lg + 0.950227 * lb) / WZ);
    return [y > 0.008856 ? 116 * fy - 16 : 903.3 * y, 500 * (fx - fy), 200 * (fy - fz)];
  }
  // L*, a*, b* → sRGB bytes into out[o..o+2]
  function labToRgb(L, a, b, out, o) {
    var fy = (L + 16) / 116, X = fInv(fy + a / 500) * WX, Y = fInv(fy), Z = fInv(fy - b / 200) * WZ;
    var r = 3.240479 * X - 1.537150 * Y - 0.498535 * Z;
    var g = -0.969256 * X + 1.875992 * Y + 0.041556 * Z;
    var bl = 0.055648 * X - 0.204043 * Y + 1.057311 * Z;
    out[o] = GAMMA[Math.round(clamp(r, 0, 1) * GAMMA_N)];
    out[o + 1] = GAMMA[Math.round(clamp(g, 0, 1) * GAMMA_N)];
    out[o + 2] = GAMMA[Math.round(clamp(bl, 0, 1) * GAMMA_N)];
  }
  // RGBA at side × side → the model's input: its lightness as grey RGB
  // 0..1 (L* with a* = b* = 0, back to sRGB), CHW.
  function colorPrep(rgba, side) {
    var n = side * side, out = new Float32Array(3 * n), px = [0, 0, 0];
    for (var i = 0; i < n; i++) {
      labToRgb(lightness(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]), 0, 0, px, 0);
      out[i] = out[n + i] = out[2 * n + i] = px[0] / 255;
    }
    return out;
  }
  // The picture (RGBA w × h) + the model's a*b* (2 × side × side) →
  // RGBA w × h in place: the picture's own L*, the a*b* scaled up
  // (bilinear) and times amt (0..1); alpha untouched.
  function colorApply(rgba, w, h, ab, side, amt) {
    var plane = side * side, px = [0, 0, 0], k = amt == null ? 1 : amt;
    for (var y = 0; y < h; y++) {
      var sy = clamp((y + 0.5) * side / h - 0.5, 0, side - 1), y0 = Math.floor(sy), y1 = Math.min(side - 1, y0 + 1), fy = sy - y0;
      for (var x = 0; x < w; x++) {
        var sx = clamp((x + 0.5) * side / w - 0.5, 0, side - 1), x0 = Math.floor(sx), x1 = Math.min(side - 1, x0 + 1), fx = sx - x0;
        var i00 = y0 * side + x0, i01 = y0 * side + x1, i10 = y1 * side + x0, i11 = y1 * side + x1;
        var w00 = (1 - fx) * (1 - fy), w01 = fx * (1 - fy), w10 = (1 - fx) * fy, w11 = fx * fy;
        var a = ab[i00] * w00 + ab[i01] * w01 + ab[i10] * w10 + ab[i11] * w11;
        var b = ab[plane + i00] * w00 + ab[plane + i01] * w01 + ab[plane + i10] * w10 + ab[plane + i11] * w11;
        var o = (y * w + x) * 4;
        labToRgb(lightness(rgba[o], rgba[o + 1], rgba[o + 2]), a * k, b * k, px, 0);
        rgba[o] = px[0]; rgba[o + 1] = px[1]; rgba[o + 2] = px[2];
      }
    }
    return rgba;
  }

  var pure = {
    MODELS: MODELS, MIRROR: MIRROR, SAM_SIDE: SAM_SIDE, SAM_GRID: SAM_GRID,
    samSize: samSize, samPrep: samPrep, samPoints: samPoints, bestMask: bestMask, samAlpha: samAlpha,
    fingerprint: fingerprint, lightness: lightness, lab: lab, labToRgb: labToRgb, colorPrep: colorPrep, colorApply: colorApply
  };
  if (typeof module !== "undefined" && module.exports) { module.exports = pure; return; }

  // ---------- The model files: mirror → SHA-256 → IndexedDB ----------
  var DB = "oros-atelier-ai";
  function idb(mode, fn) {
    return new Promise(function (ok, fail) {
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function () { if (!req.result.objectStoreNames.contains("files")) req.result.createObjectStore("files"); };
      req.onerror = function () { fail(req.error); };
      req.onblocked = function () { fail(new Error("blocked")); };
      req.onsuccess = function () {
        var d = req.result, tx = d.transaction("files", mode), r = fn(tx.objectStore("files")), res;
        if (r) r.onsuccess = function () { res = r.result; };
        tx.oncomplete = function () { d.close(); ok(res); };
        tx.onerror = tx.onabort = function () { d.close(); fail(tx.error || new Error("idb")); };
      };
    });
  }
  function ver(m) { return m.key + "-" + m.sha.slice(0, 16); }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join(""); }
  function have(m) {
    return idb("readonly", function (s) { return s.get(m.key); }).then(function (r) { return !!(r && r.v === ver(m) && r.blob instanceof Blob); }, function () { return false; });
  }
  function total(m) { return m.parts.reduce(function (s, p) { return s + p.size; }, 0); }
  // Downloads every part (joined in order), checks the whole file's
  // SHA-256 and keeps it. onProgress(0..1).
  function fetchModel(m, onProgress, signal) {
    var all = total(m) || 1, got = 0, bufs = [];
    function one(p) {
      return fetch(p.url, { cache: "no-cache", signal: signal }).then(function (res) {
        if (!res.ok) throw new Error("http " + res.status);
        if (!res.body || !res.body.getReader) return res.blob().then(function (b) { got += b.size; bufs.push(b); });
        var rd = res.body.getReader();
        function pump() {
          return rd.read().then(function (r) {
            if (r.done) return;
            bufs.push(r.value); got += r.value.byteLength;
            if (onProgress) onProgress(Math.min(0.99, got / all));
            return pump();
          });
        }
        return pump();
      });
    }
    return m.parts.reduce(function (pr, p) { return pr.then(function () { return one(p); }); }, Promise.resolve()).then(function () {
      return new Blob(bufs).arrayBuffer();
    }).then(function (buf) {
      return crypto.subtle.digest("SHA-256", buf).then(function (d) {
        if (hex(d) !== m.sha) throw new Error("sha");
        var blob = new Blob([buf]);
        // kept only here: the runtime loader reads it from IndexedDB (it
        // would otherwise fetch the file again, unchecked)
        return idb("readwrite", function (s) { s.put({ v: ver(m), blob: blob }, m.key); }).then(function () { return blob; });
      });
    });
  }
  function runtimeSpec(CUT) { return CUT.list({ js: CUT.FILES.js, mjs: CUT.FILES.mjs, wasm: CUT.FILES.wasm }, CUT.FILES_VER); }
  // → how many MB a first use of the models downloads (0: all here)
  function needMb(CUT, list) {
    return Promise.all(list.map(have).concat([CUT.readyOf(runtimeSpec(CUT))])).then(function (l) {
      var mb = l[l.length - 1] ? 0 : RUNTIME_MB;
      list.forEach(function (m, i) { if (!l[i]) mb += Math.round(total(m) / 1e6); });
      return mb;
    }, function () { return RUNTIME_MB + list.reduce(function (s, m) { return s + Math.round(total(m) / 1e6); }, 0); });
  }
  // → the ONNX sessions of the models in list (in order), downloading
  // what is missing. onProgress(0..1) over all of it.
  var sessP = {};
  function sessions(CUT, list, onProgress, signal) {
    var mbAll = list.reduce(function (s, m) { return s + total(m); }, 0) || 1, done = 0;
    return list.reduce(function (pr, m) {
      return pr.then(function (acc) {
        if (sessP[m.key]) return sessP[m.key].then(function (s) { done += total(m); acc.push(s); return acc; });
        var p = sessP[m.key] = have(m).then(function (h) {
          if (h) return;
          return fetchModel(m, function (x) { if (onProgress) onProgress(Math.min(0.99, (done + x * total(m)) / mbAll)); }, signal);
        }).then(function () {
          var spec = runtimeSpec(CUT);
          spec[m.key] = { url: m.parts[0].url, v: ver(m) };
          return CUT.sessionOf(spec, m.key, RUNTIME_MB, null, signal);
        });
        p.catch(function () { if (sessP[m.key] === p) delete sessP[m.key]; });
        return p.then(function (s) { done += total(m); acc.push(s); return acc; });
      });
    }, Promise.resolve([]));
  }
  // Removes Smart select's and Colourize's files from this device.
  function forget() {
    sessP = {};
    return idb("readwrite", function (s) { Object.keys(MODELS).forEach(function (k) { s.delete(MODELS[k].key); }); }).catch(function () {});
  }
  function pause() { return new Promise(function (r) { setTimeout(r, 30); }); }
  function canvas(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function scaledData(src, w, h) {
    var c = canvas(w, h), g = c.getContext("2d", { willReadFrequently: true });
    g.imageSmoothingQuality = "high";
    g.drawImage(src, 0, 0, w, h);
    return g.getImageData(0, 0, w, h).data;
  }

  // ---------- Smart select ----------
  // A segmenter for one picture: segmenter(CUT, src, opts) → Promise<{
  //   w, h, select(points, part) → Promise<{ mask (logits), off, score }>,
  //   alpha(res, outW, outH, soft) → Uint8ClampedArray }>.
  // src: a canvas / image (any size); points in its own pixels. The
  // encoder's result is kept for the last picture (same fingerprint).
  var lastEnc = null;
  function segmenter(CUT, src, opts) {
    opts = opts || {};
    var w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
    if (!w || !h) return Promise.reject(new Error("decode"));
    var z = samSize(w, h), px = scaledData(src, z.w, z.h), fp = fingerprint(px, z.w, z.h);
    return sessions(CUT, [MODELS.samEnc, MODELS.samDec], opts.onProgress, opts.signal).then(function (ss) {
      var enc = ss[0], dec = ss[1], ort = root.ort;
      if (opts.signal && opts.signal.aborted) throw new Error("abort");
      var emb;
      if (lastEnc && lastEnc.fp === fp) emb = Promise.resolve(lastEnc.out);
      else {
        if (opts.onRun) opts.onRun();
        emb = pause().then(function () {
          var feeds = {};
          feeds[enc.inputNames[0]] = new ort.Tensor("float32", samPrep(px, z.w, z.h), [1, 3, SAM_SIDE, SAM_SIDE]);
          return enc.run(feeds);
        }).then(function (out) { lastEnc = { fp: fp, out: out }; return out; });
      }
      return emb.then(function (eo) {
        function select(points, part) {
          var p = samPoints(points, z.k), feeds = {}, n = points.length;
          dec.inputNames.forEach(function (name) {
            if (/point/.test(name)) feeds[name] = new ort.Tensor("float32", p.xy, [1, 1, n, 2]);
            else if (/label/.test(name)) feeds[name] = new ort.Tensor("int64", BigInt64Array.from(p.labels.map(function (v) { return BigInt(v); })), [1, 1, n]);
            else if (eo[name]) feeds[name] = eo[name];
          });
          return dec.run(feeds).then(function (o) {
            var masks = o.pred_masks || o[dec.outputNames.filter(function (k) { return /mask/.test(k); })[0]];
            var scores = o.iou_scores || o[dec.outputNames.filter(function (k) { return /iou|score/.test(k); })[0]];
            var k = masks.dims[2] || 1, best = bestMask(scores.data, k, part);
            return { mask: masks.data, off: best * SAM_GRID * SAM_GRID, score: scores.data[best] };
          });
        }
        return {
          w: w, h: h, select: select,
          alpha: function (r, outW, outH, soft) { return samAlpha(r.mask, r.off, z.w, z.h, outW, outH, soft); }
        };
      });
    });
  }

  // ---------- Colourize ----------
  // colorize(CUT, src, opts) → Promise<{ w, h, ab, side, apply(rgba, w, h, amt) }>
  // opts.side 256 | 512 (the model's input; 512 is better, 256 four
  // times faster).
  function colorize(CUT, src, opts) {
    opts = opts || {};
    var side = opts.side === 256 ? 256 : 512;
    var w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
    if (!w || !h) return Promise.reject(new Error("decode"));
    return sessions(CUT, [MODELS.color], opts.onProgress, opts.signal).then(function (ss) {
      var s = ss[0];
      if (opts.signal && opts.signal.aborted) throw new Error("abort");
      if (opts.onRun) opts.onRun();
      return pause().then(function () {
        var feeds = {};
        feeds[s.inputNames[0]] = new root.ort.Tensor("float32", colorPrep(scaledData(src, side, side), side), [1, 3, side, side]);
        return s.run(feeds);
      }).then(function (o) {
        var ab = o[s.outputNames[0]].data;
        return { w: w, h: h, ab: ab, side: side, apply: function (rgba, ww, hh, amt) { return colorApply(rgba, ww, hh, ab, side, amt); } };
      });
    });
  }

  root.OrosSmartAI = {
    MODELS: MODELS, RUNTIME_MB: RUNTIME_MB, needMb: needMb, forget: forget,
    segmenter: segmenter, colorize: colorize,
    samAlpha: samAlpha, colorApply: colorApply, fingerprint: fingerprint
  };
})(typeof window !== "undefined" ? window : this);
