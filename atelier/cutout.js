// ============================================================
// orOS Atelier — cutout.js: remove a picture's background (v1.0.0)
// On the device, no key, no upload: the U²-Net "u2netp" model
// (Apache-2.0, vendor/u2netp/) runs in ONNX Runtime Web (MIT,
// vendor/ort/, WebAssembly, one thread). The model finds the main
// subject; everything else becomes transparent.
//   - the files (about 16 MB) are fetched once, on the first use,
//     and kept in this app's IndexedDB "oros-atelier-ai" (the
//     service worker's caches are renewed on every release), so it
//     works offline from then on
//   - pure steps (prep / toMask / alphaFor) are unit-tested in node
// Exposes window.AtelierCutout (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var S = 320;                                  // the model's input side
  var MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
  var FILES = {
    js:   "../vendor/ort/ort.wasm.min.js",
    mjs:  "../vendor/ort/ort-wasm-simd-threaded.mjs",
    wasm: "../vendor/ort/ort-wasm-simd-threaded.wasm",
    model: "../vendor/u2netp/u2netp.onnx"
  };
  var FILES_VER = "ort1.22.0-u2netp";           // a new value fetches them again
  var APPROX_MB = 16;
  var LO = 0.12, SPAN = 0.76;                   // the soft edge: below LO gone, above LO + SPAN kept

  // ---------- Pure steps ----------
  // RGBA (w × h) → Float32Array 3 × S × S (CHW), bilinear, scaled by
  // the brightest channel value, then normalized like ImageNet.
  function prep(rgba, w, h, side) {
    side = side || S;
    var max = 1e-6, i;
    for (i = 0; i < rgba.length; i += 4) {
      if (rgba[i] > max) max = rgba[i];
      if (rgba[i + 1] > max) max = rgba[i + 1];
      if (rgba[i + 2] > max) max = rgba[i + 2];
    }
    var out = new Float32Array(3 * side * side), plane = side * side;
    for (var y = 0; y < side; y++) {
      var sy = Math.min(h - 1, Math.max(0, (y + 0.5) * h / side - 0.5));
      var y0 = Math.floor(sy), y1 = Math.min(h - 1, y0 + 1), fy = sy - y0;
      for (var x = 0; x < side; x++) {
        var sx = Math.min(w - 1, Math.max(0, (x + 0.5) * w / side - 0.5));
        var x0 = Math.floor(sx), x1 = Math.min(w - 1, x0 + 1), fx = sx - x0;
        var a = (y0 * w + x0) * 4, b = (y0 * w + x1) * 4, c = (y1 * w + x0) * 4, d = (y1 * w + x1) * 4;
        for (var ch = 0; ch < 3; ch++) {
          var v = (rgba[a + ch] * (1 - fx) + rgba[b + ch] * fx) * (1 - fy) + (rgba[c + ch] * (1 - fx) + rgba[d + ch] * fx) * fy;
          out[ch * plane + y * side + x] = (v / max - MEAN[ch]) / STD[ch];
        }
      }
    }
    return out;
  }

  // The model's first output (S × S floats) → 0..255, stretched
  // between its own lowest and highest value.
  function toMask(pred, side) {
    side = side || S;
    var n = side * side, lo = Infinity, hi = -Infinity, i;
    for (i = 0; i < n; i++) { if (pred[i] < lo) lo = pred[i]; if (pred[i] > hi) hi = pred[i]; }
    var m = new Uint8ClampedArray(n), span = hi - lo || 1;
    for (i = 0; i < n; i++) m[i] = Math.round((pred[i] - lo) / span * 255);
    return m;
  }

  // Mask (side × side) → alpha (w × h), bilinear, with a soft
  // threshold: below lo is gone, above hi is kept, a ramp between
  // (clean edges without a hard cut).
  function alphaFor(mask, side, w, h, lo, hi) {
    side = side || S;
    lo = lo == null ? LO : lo; hi = hi == null ? LO + SPAN : hi;
    var out = new Uint8ClampedArray(w * h), span = (hi - lo) * 255;
    for (var y = 0; y < h; y++) {
      var sy = Math.min(side - 1, Math.max(0, (y + 0.5) * side / h - 0.5));
      var y0 = Math.floor(sy), y1 = Math.min(side - 1, y0 + 1), fy = sy - y0;
      for (var x = 0; x < w; x++) {
        var sx = Math.min(side - 1, Math.max(0, (x + 0.5) * side / w - 0.5));
        var x0 = Math.floor(sx), x1 = Math.min(side - 1, x0 + 1), fx = sx - x0;
        var v = (mask[y0 * side + x0] * (1 - fx) + mask[y0 * side + x1] * fx) * (1 - fy) +
                (mask[y1 * side + x0] * (1 - fx) + mask[y1 * side + x1] * fx) * fy;
        out[y * w + x] = Math.round((v - lo * 255) / span * 255);
      }
    }
    return out;
  }

  // alpha → into rgba (multiplied with the picture's own alpha).
  // Returns the share of the picture that stays (0..1).
  function applyAlpha(rgba, alpha) {
    var kept = 0, n = alpha.length;
    for (var i = 0; i < n; i++) {
      var a = Math.round(rgba[i * 4 + 3] * alpha[i] / 255);
      rgba[i * 4 + 3] = a;
      if (a > 127) kept++;
    }
    return n ? kept / n : 0;
  }

  var pure = { S: S, LO: LO, prep: prep, toMask: toMask, alphaFor: alphaFor, applyAlpha: applyAlpha, FILES: FILES, APPROX_MB: APPROX_MB };
  if (typeof module !== "undefined" && module.exports) { module.exports = pure; return; }

  // ---------- Files (IndexedDB) ----------
  var DB_NAME = "oros-atelier-ai";
  var dbP = null;
  function db() {
    if (!dbP) {
      dbP = new Promise(function (resolve, reject) {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () { if (!req.result.objectStoreNames.contains("files")) req.result.createObjectStore("files"); };
        req.onsuccess = function () { var d = req.result; d.onversionchange = function () { d.close(); dbP = null; }; resolve(d); };
        req.onerror = function () { reject(req.error); };
        req.onblocked = function () { reject(new Error("blocked")); };
      });
      dbP.catch(function () { dbP = null; });
    }
    return dbP;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction("files", mode), res, r = fn(t.objectStore("files"));
        if (r) r.onsuccess = function () { res = r.result; };
        t.oncomplete = function () { resolve(res); };
        t.onerror = t.onabort = function () { reject(t.error || new Error("idb")); };
      });
    });
  }
  // A file list: { name: { url, v } }. The runtime (js, mjs, wasm) is
  // shared by every picture tool, so it downloads once for all.
  function list(urls, v) {
    var o = {};
    Object.keys(urls).forEach(function (k) { o[k] = { url: urls[k], v: v }; });
    return o;
  }
  var CUT_FILES = list(FILES, FILES_VER);
  function stored(name, v) {
    return tx("readonly", function (s) { return s.get(name); }).then(function (rec) {
      return rec && rec.v === v && rec.blob instanceof Blob ? rec.blob : null;
    }, function () { return null; });
  }
  // Is everything here already? (no download needed)
  function readyOf(spec) {
    return Promise.all(Object.keys(spec).map(function (k) { return stored(k, spec[k].v); }))
      .then(function (l) { return l.every(Boolean); }, function () { return false; });
  }
  function ready() { return readyOf(CUT_FILES); }
  // fetch with progress: onBytes(n) for every chunk
  function fetchFile(url, onBytes, signal) {
    return fetch(url, { cache: "no-cache", signal: signal }).then(function (res) {
      if (!res.ok) throw new Error("http " + res.status);
      if (!res.body || !res.body.getReader) return res.blob().then(function (b) { onBytes(b.size); return b; });
      var reader = res.body.getReader(), parts = [];
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return new Blob(parts);
          parts.push(r.value); onBytes(r.value.byteLength);
          return pump();
        });
      }
      return pump();
    });
  }
  // → { name: Blob } for every file. onProgress(0..1) while downloading
  // (mb: about how much a first download is).
  function filesOf(spec, mb, onProgress, signal) {
    var names = Object.keys(spec), got = {}, done = 0, total = mb * 1024 * 1024;
    return names.reduce(function (p, name) {
      return p.then(function () {
        return stored(name, spec[name].v).then(function (b) {
          if (b) { got[name] = b; return; }
          return fetchFile(spec[name].url, function (n) {
            done += n;
            if (onProgress) onProgress(Math.min(0.99, done / total));
          }, signal).then(function (blob) {
            got[name] = blob;
            return tx("readwrite", function (s) { s.put({ v: spec[name].v, blob: blob }, name); }).catch(function () {});
          });
        });
      });
    }, Promise.resolve()).then(function () { if (onProgress) onProgress(1); return got; });
  }
  // Removes every picture tool (the runtime is shared).
  function forget() { sessions = {}; return tx("readwrite", function (s) { s.clear(); }).catch(function () {}); }

  // ---------- Runtime ----------
  var sessions = {}, wasmSet = false;
  function loadScript(blob) {
    return new Promise(function (resolve, reject) {
      if (root.ort && root.ort.InferenceSession) { resolve(); return; }
      var s = document.createElement("script");
      s.src = URL.createObjectURL(new Blob([blob], { type: "text/javascript" }));
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("script")); };
      document.head.appendChild(s);
    });
  }
  // The ONNX session for one model (key = its file name in the spec),
  // downloading the runtime and the model first when needed.
  function sessionOf(spec, model, mb, onProgress, signal) {
    if (sessions[model]) return sessions[model];
    var p = sessions[model] = filesOf(spec, mb, onProgress, signal).then(function (f) {
      return loadScript(f.js).then(function () {
        var ort = root.ort;
        if (!ort || !ort.InferenceSession) throw new Error("runtime");
        if (!wasmSet) {
          ort.env.wasm.numThreads = 1;
          ort.env.wasm.proxy = false;
          ort.env.wasm.wasmPaths = {
            mjs: URL.createObjectURL(new Blob([f.mjs], { type: "text/javascript" })),
            wasm: URL.createObjectURL(new Blob([f.wasm], { type: "application/wasm" }))
          };
          wasmSet = true;
        }
        return f[model].arrayBuffer().then(function (buf) {
          return ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ["wasm"] });
        });
      });
    });
    p.catch(function () { if (sessions[model] === p) sessions[model] = null; });
    return p;
  }
  function session(onProgress, signal) { return sessionOf(CUT_FILES, "model", APPROX_MB, onProgress, signal); }

  // A drawable (img / canvas / bitmap) → { w, h, render(lo, maxSide) }:
  // render gives a canvas (at most maxSide on its long side) with the
  // background transparent; lo 0..0.6 moves the soft edge (higher
  // = keeps less). The model runs once; render is cheap.
  function cut(src, opts) {
    opts = opts || {};
    var w = src.naturalWidth || src.videoWidth || src.width, h = src.naturalHeight || src.videoHeight || src.height;
    if (!w || !h) return Promise.reject(new Error("decode"));
    var base = document.createElement("canvas");
    base.width = w; base.height = h;
    base.getContext("2d").drawImage(src, 0, 0, w, h);
    return session(opts.onProgress, opts.signal).then(function (sess) {
      if (opts.signal && opts.signal.aborted) throw new Error("abort");
      if (opts.onRun) opts.onRun();
      // let the "Working…" text paint before the busy run
      return new Promise(function (r) { setTimeout(r, 30); }).then(function () {
        var small = scaled(base, 1024), g = small.getContext("2d", { willReadFrequently: true });
        var px = g.getImageData(0, 0, small.width, small.height).data;
        var feeds = {};
        feeds[sess.inputNames[0]] = new root.ort.Tensor("float32", prep(px, small.width, small.height, S), [1, 3, S, S]);
        return sess.run(feeds);
      }).then(function (out) {
        var mask = toMask(out[sess.outputNames[0]].data, S);
        return {
          w: w, h: h, mask: mask,
          render: function (lo, maxSide) {
            var cv = scaled(base, maxSide || Math.max(w, h)), cw = cv.width, ch = cv.height;
            var g2 = cv.getContext("2d", { willReadFrequently: true });
            var img = g2.getImageData(0, 0, cw, ch);
            lo = Math.max(0, Math.min(0.6, lo == null ? LO : lo));
            var kept = applyAlpha(img.data, alphaFor(mask, S, cw, ch, lo, Math.min(1, lo + SPAN)));
            g2.putImageData(img, 0, 0);
            cv.kept = kept;
            return cv;
          }
        };
      });
    });
  }
  // a copy at most `side` on its long side (the same canvas when it fits)
  function scaled(cv, side) {
    var k = Math.min(1, side / Math.max(cv.width, cv.height));
    var out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(cv.width * k)); out.height = Math.max(1, Math.round(cv.height * k));
    out.getContext("2d").drawImage(cv, 0, 0, out.width, out.height);
    return out;
  }

  root.AtelierCutout = {
    S: S, prep: prep, toMask: toMask, alphaFor: alphaFor, applyAlpha: applyAlpha,
    LO: LO, ready: ready, cut: cut, forget: forget, APPROX_MB: APPROX_MB,
    // for the other picture tools (inpaint.js)
    FILES: FILES, FILES_VER: FILES_VER, list: list, readyOf: readyOf, sessionOf: sessionOf, scaled: scaled
  };
})(typeof window !== "undefined" ? window : this);
