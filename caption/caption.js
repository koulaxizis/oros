// ============================================================
// orOS captions — caption/caption.js (CAPTION v1, runtime)
// ------------------------------------------------------------
// Describes a picture in words on the device, with Microsoft's
// Florence-2 base-ft (MIT; int8 ONNX export by onnx-community,
// Apache-2.0). Photos uses it for a photo's description, Writer and
// Layout for alt text. Any app frame loads
//   <script src="../modelfetch.js"></script>
//   <script src="../caption/core.js"></script>
//   <script src="../caption/caption.js"></script>
// and gets window.OrosCaption.
//   - nothing is downloaded until the person asks: then the runtime
//     (vendor/ort on this site, ~11 MB) and the model (~263 MB, from
//     our own copy on GitHub Pages, koulaxizis/oros-models-large) are
//     fetched once, checked against the SHA-256 written below (each
//     part and the whole file, modelfetch.js) and kept in IndexedDB
//     "oros-caption" (store "files"): never synced, never in the
//     service worker's precache, in the factory-reset list (shell.js)
//   - the picture never leaves the device; the model runs in
//     caption/worker.js so the app does not freeze
//   - the model writes English; describeIn() passes the words through
//     the translation on the device (translate/engine.js) when the app
//     loaded it and the direction is installed, else it says so
//     (.translated false) and returns the English
// API (Promises; errors carry .code: not-installed | download | hash |
//      quota | cancelled | image | engine):
//   OrosCaption.MB                 → download size in MB (runtime + model)
//   OrosCaption.ready()            → bool (every file on this device)
//   OrosCaption.install(progress(f), cancelled()) → true
//   OrosCaption.remove()           → true
//   OrosCaption.describe(blob, { task: "short" | "detail" }) → English text
//   OrosCaption.describeIn(blob, lang, { task }) → { text, lang, en, translated }
//   OrosCaption.stop()             → frees the worker (memory)
// ============================================================
(function (root) {
  "use strict";

  var CORE = root.OrosCaptionCore, FETCH = root.OrosModelFetch;
  if (!CORE) return;
  var SELF = (function () {
    var s = document.currentScript, src = (s && s.src) || "", m = /\?v=[^#]*/.exec(src);
    return { dir: src ? src.replace(/[?#].*$/, "").replace(/[^/]*$/, "") : "../caption/", v: m ? m[0] : "" };
  })();
  var MIRROR = "https://koulaxizis.github.io/oros-models-large/florence-2-base-ft/";
  var VER = "florence2-base-ft-q8-1";     // a new value fetches the model again
  var RT_VER = "ort1.22.0";
  // size = bytes, sha = SHA-256 of the whole file, parts = the ≤95 MB
  // pieces GitHub Pages serves (oros-models-large index.json).
  var FILES = {
    vision: { url: MIRROR + "onnx/vision_encoder_quantized.onnx", v: VER, size: 93746540, sha: "3b79d54f23f666f731549db23cb070c35a979ce19cbd9720e90e67a78dc9768c" },
    embed:  { url: MIRROR + "onnx/embed_tokens_quantized.onnx", v: VER, size: 39390433, sha: "6b2258db1c8ee9b160576ccde3cd3814d83a2edaed0dd1c6ca9ff3c38fa62214" },
    enc:    { url: MIRROR + "onnx/encoder_model_quantized.onnx", v: VER, size: 43651493, sha: "f4ad7a68f1fb875d3bcf735ea14a7021b7ba7e83baf7cf10289881b4ed6d9b85" },
    dec:    { url: MIRROR + "onnx/decoder_model_merged_quantized.onnx", v: VER, size: 98177697, sha: "f22f52f980c33df0efa15932c2f3db6d9d3595ce6387eca938b8cfe23dc4c641",
              parts: [{ size: 95000000, sha: "0deb644a146f9d7173c22178e971b01a7b21022d9183996099a16bab612c7e13" },
                      { size: 3177697, sha: "adcd8ffc5ebc568b52aa48057ae36e7568aed8a99d86c9975f777968b4cace55" }] },
    vocab:  { url: MIRROR + "vocab.json", v: VER, size: 1099884, sha: "394fdc63c71aabe0a9b97117f5d62fb5fcc4d59b2b3ea929a3929e6a53217b3c" },
    js:     { url: SELF.dir + "../vendor/ort/ort.wasm.min.js", v: RT_VER, local: true },
    mjs:    { url: SELF.dir + "../vendor/ort/ort-wasm-simd-threaded.mjs", v: RT_VER, local: true },
    wasm:   { url: SELF.dir + "../vendor/ort/ort-wasm-simd-threaded.wasm", v: RT_VER, local: true }
  };
  var RUNTIME_BYTES = 11300000;
  function modelBytes() { return ["vision", "embed", "enc", "dec", "vocab"].reduce(function (s, k) { return s + FILES[k].size; }, 0); }
  var MB = Math.round((modelBytes() + RUNTIME_BYTES) / 1048576);

  function err(code) { var e = new Error(code); e.code = code; return e; }

  // ---------- IndexedDB ----------
  var DB_NAME = "oros-caption", dbP = null;
  function db() {
    if (!dbP) {
      dbP = new Promise(function (resolve, reject) {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
          if (!req.result.objectStoreNames.contains("files")) req.result.createObjectStore("files");
        };
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
        t.onerror = t.onabort = function () {
          var e = t.error || new Error("idb");
          reject(e && e.name === "QuotaExceededError" ? err("quota") : e);
        };
      });
    });
  }
  function stored(k) {
    return tx("readonly", function (s) { return s.get(k); }).then(function (rec) {
      return rec && rec.v === FILES[k].v && rec.blob instanceof Blob ? rec.blob : null;
    }, function () { return null; });
  }
  function ready() {
    return Promise.all(Object.keys(FILES).map(stored)).then(function (l) { return l.every(Boolean); }, function () { return false; });
  }

  // The runtime comes from this site (same files the precache knows);
  // the model through modelfetch.js (parts + SHA-256).
  function fetchLocal(url, onBytes) {
    return fetch(url, { credentials: "same-origin" }).then(function (res) {
      if (!res.ok) throw err("download");
      return res.blob();
    }, function () { throw err("download"); }).then(function (b) { onBytes(b.size); return b; });
  }
  function getFile(k, onBytes, cancelled) {
    var f = FILES[k];
    return stored(k).then(function (b) {
      if (b) { onBytes(b.size); return b; }
      var got;
      if (f.local) got = fetchLocal(f.url, onBytes);
      else if (!FETCH) got = Promise.reject(err("download"));
      else got = FETCH.get(f, { onBytes: onBytes, cancelled: cancelled });
      return got.then(function (blob) {
        return tx("readwrite", function (s) { s.put({ v: f.v, blob: blob }, k); }).then(function () { return blob; });
      });
    });
  }
  function install(progress, cancelled) {
    var total = modelBytes() + RUNTIME_BYTES, done = 0;
    function onBytes(n) { done += n; if (progress) progress(Math.min(0.99, done / total)); }
    return Object.keys(FILES).reduce(function (p, k) {
      return p.then(function () {
        if (cancelled && cancelled()) throw err("cancelled");
        return getFile(k, onBytes, cancelled);
      });
    }, Promise.resolve()).then(function () { if (progress) progress(1); return true; });
  }

  // ---------- worker ----------
  var worker = null, wid = 0, waiting = {}, loaded = null;
  function call(msg, transfer) {
    return new Promise(function (resolve, reject) {
      msg.id = ++wid;
      waiting[msg.id] = { resolve: resolve, reject: reject };
      worker.postMessage(msg, transfer || []);
    });
  }
  function boot() {
    if (loaded) return loaded;
    loaded = Promise.all(Object.keys(FILES).map(function (k) {
      return stored(k).then(function (b) { if (!b) throw err("not-installed"); return [k, b]; });
    })).then(function (pairs) {
      var m = { op: "load" };
      pairs.forEach(function (x) { m[x[0]] = x[1]; });
      worker = new Worker(SELF.dir + "worker.js" + SELF.v);
      worker.onmessage = function (e) {
        var r = e.data || {}, w = waiting[r.id];
        if (!w) return;
        delete waiting[r.id];
        if (r.ok) w.resolve(r.text != null ? r.text : true); else w.reject(err("engine"));
      };
      worker.onerror = function () {
        Object.keys(waiting).forEach(function (id) { waiting[id].reject(err("engine")); });
        waiting = {};
      };
      return call(m);
    });
    loaded.catch(function () { stop(); });
    return loaded;
  }
  function stop() {
    if (worker) { try { worker.terminate(); } catch (e) { /* gone */ } }
    worker = null; loaded = null; waiting = {};
  }

  function decode(blob) {
    if (root.createImageBitmap) return createImageBitmap(blob).catch(function () { throw err("image"); });
    return new Promise(function (resolve, reject) {
      var img = new Image(), u = URL.createObjectURL(blob);
      img.onload = function () { URL.revokeObjectURL(u); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(u); reject(err("image")); };
      img.src = u;
    });
  }
  // The whole picture stretched to 768 × 768 (Florence's processor),
  // on white so a transparent PNG reads as it looks on a page.
  function describe(blob, opts) {
    var task = opts && opts.task === "detail" ? "detail" : "short";
    return boot().then(function () { return decode(blob); }).then(function (bmp) {
      var S = CORE.SIZE, cv = document.createElement("canvas");
      cv.width = S; cv.height = S;
      var g = cv.getContext("2d", { willReadFrequently: true });
      g.fillStyle = "#fff";
      g.fillRect(0, 0, S, S);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";
      g.drawImage(bmp, 0, 0, bmp.width, bmp.height, 0, 0, S, S);
      if (bmp.close) bmp.close();
      var px = CORE.pixels(g.getImageData(0, 0, S, S).data, S, S);
      return call({ op: "describe", px: px, task: task }, [px.buffer]);
    });
  }
  function describeIn(blob, lang, opts) {
    return describe(blob, opts).then(function (en) {
      var out = { text: en, lang: "en", en: en, translated: false };
      var T = root.OrosTranslate;
      if (!lang || lang === "en" || !en || !T) return out;
      return T.status("en", lang).then(function (st) {
        if (!st || !st.ok) return out;
        return T.translate(en, { from: "en", to: lang, engine: "bergamot" }).then(function (r) {
          var txt = r && r.text ? CORE.tidy(r.text) : "";
          return txt ? { text: txt, lang: lang, en: en, translated: true } : out;
        });
      }).catch(function () { return out; });
    });
  }
  function remove() {
    stop();
    return tx("readwrite", function (s) { s.clear(); }).then(function () { return true; });
  }

  root.OrosCaption = {
    MB: MB, VER: VER, FILES: FILES, ready: ready, install: install, remove: remove, stop: stop,
    describe: describe, describeIn: describeIn
  };
})(typeof window !== "undefined" ? window : this);
