// ============================================================
// orOS Files — clip.js (search photos by description, runtime)
// ------------------------------------------------------------
// OpenAI CLIP ViT-B/32 (MIT; int8 ONNX export by Xenova, Apache-2.0)
// on the device, for Files › Photos "Search by description".
//   - nothing is downloaded until the person asks: then the runtime
//     (vendor/ort on this site, ~11 MB) and the two models (~150 MB,
//     from our own copy on GitHub Pages, koulaxizis/oros-models-vision)
//     are fetched once, checked against the SHA-256 written below and
//     kept in IndexedDB "oros-files-clip" (store "files")
//   - the index (one 512-number vector per photo, 512 bytes packed) is
//     in the same database (store "vecs"), keyed like the thumbnails
//     (photos.js thumbKey): never synced, never in the service worker's
//     precache, in the factory-reset list (shell.js)
//   - photos and words never leave the device; the models run in
//     clip-worker.js so making the index does not freeze the page
// API (Promises):
//   OrosClip.MB                    → download size in MB (runtime + models)
//   OrosClip.ready()               → bool (every file on this device)
//   OrosClip.install(progress(f), cancelled()) → true   (errors: .code
//                                    download | hash | quota | cancelled)
//   OrosClip.remove()              → true (files and the index)
//   OrosClip.embedImage(blob)      → Float32Array(512)
//   OrosClip.embedText(text)       → Float32Array(512)
//   OrosClip.vecs()                → [{ k, v: Int8Array }]
//   OrosClip.putVec(k, vec) / dropVecs(keys) / count()
// Needs clip-core.js (window.OrosClipCore) loaded first.
// ============================================================
(function (root) {
  "use strict";

  var CORE = root.OrosClipCore;
  if (!CORE) return;
  // clip-worker.js gets the same ?v= stamp as this file.
  var SELF_V = (function () {
    var s = document.currentScript, m = s && /\?v=[^#]*/.exec(s.src || "");
    return m ? m[0] : "";
  })();
  var MIRROR = "https://koulaxizis.github.io/oros-models-vision/clip-vit-base-patch32/";
  var VER = "clip-b32-q8-1";            // a new value fetches the models again
  var RT_VER = "ort1.22.0";
  // size = bytes, sha = SHA-256 (from oros-models-vision index.json)
  var FILES = {
    vision: { url: MIRROR + "onnx/vision_model_quantized.onnx", v: VER, size: 89117001, sha: "583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299" },
    text:   { url: MIRROR + "onnx/text_model_quantized.onnx", v: VER, size: 64504507, sha: "73baab855d406190da9faa498cfedf65f15cf309f4cc7385b7b032e6d08e5c3a" },
    vocab:  { url: MIRROR + "vocab.json", v: VER, size: 862328, sha: "5047b556ce86ccaf6aa22b3ffccfc52d391ea4accdab9c2f2407da5b742d4363" },
    merges: { url: MIRROR + "merges.txt", v: VER, size: 524619, sha: "9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a" },
    js:     { url: "../vendor/ort/ort.wasm.min.js", v: RT_VER },
    mjs:    { url: "../vendor/ort/ort-wasm-simd-threaded.mjs", v: RT_VER },
    wasm:   { url: "../vendor/ort/ort-wasm-simd-threaded.wasm", v: RT_VER }
  };
  var RUNTIME_BYTES = 11300000;
  function modelBytes() { return ["vision", "text", "vocab", "merges"].reduce(function (s, k) { return s + FILES[k].size; }, 0); }
  var MB = Math.round((modelBytes() + RUNTIME_BYTES) / 1048576);

  function err(code) { var e = new Error(code); e.code = code; return e; }

  // ---------- IndexedDB ----------
  var DB_NAME = "oros-files-clip", dbP = null;
  function db() {
    if (!dbP) {
      dbP = new Promise(function (resolve, reject) {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
          var d = req.result;
          if (!d.objectStoreNames.contains("files")) d.createObjectStore("files");
          if (!d.objectStoreNames.contains("vecs")) d.createObjectStore("vecs");
        };
        req.onsuccess = function () { var d = req.result; d.onversionchange = function () { d.close(); dbP = null; }; resolve(d); };
        req.onerror = function () { reject(req.error); };
        req.onblocked = function () { reject(new Error("blocked")); };
      });
      dbP.catch(function () { dbP = null; });
    }
    return dbP;
  }
  function tx(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(store, mode), res, r = fn(t.objectStore(store));
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
    return tx("files", "readonly", function (s) { return s.get(k); }).then(function (rec) {
      return rec && rec.v === FILES[k].v && rec.blob instanceof Blob ? rec.blob : null;
    }, function () { return null; });
  }
  function ready() {
    return Promise.all(Object.keys(FILES).map(stored)).then(function (l) { return l.every(Boolean); }, function () { return false; });
  }

  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function fetchBlob(url, onBytes, cancelled) {
    return fetch(url, { cache: "no-cache", credentials: "omit" }).then(function (res) {
      if (!res.ok) throw err("download");
      if (!res.body || !res.body.getReader) return res.blob().then(function (b) { onBytes(b.size); return b; });
      var reader = res.body.getReader(), parts = [];
      function pump() {
        if (cancelled && cancelled()) { try { reader.cancel(); } catch (e) { /* gone */ } throw err("cancelled"); }
        return reader.read().then(function (r) {
          if (r.done) return new Blob(parts);
          parts.push(r.value); onBytes(r.value.byteLength);
          return pump();
        });
      }
      return pump();
    }, function (e) { throw e && e.code ? e : err("download"); });
  }
  function getFile(k, onBytes, cancelled) {
    var f = FILES[k];
    return stored(k).then(function (b) {
      if (b) { onBytes(b.size); return b; }
      return fetchBlob(f.url, onBytes, cancelled).then(function (blob) {
        var check = f.sha ? blob.arrayBuffer().then(function (buf) {
          if (f.size && buf.byteLength !== f.size) throw err("hash");
          return crypto.subtle.digest("SHA-256", buf).then(function (d) { if (hex(d) !== f.sha) throw err("hash"); });
        }) : Promise.resolve();
        return check.then(function () {
          return tx("files", "readwrite", function (s) { s.put({ v: f.v, blob: blob }, k); }).then(function () { return blob; });
        });
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
  var worker = null, wid = 0, waiting = {}, loaded = null, tok = null;
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
      var f = {};
      pairs.forEach(function (x) { f[x[0]] = x[1]; });
      worker = new Worker("clip-worker.js" + SELF_V);
      worker.onmessage = function (e) {
        var m = e.data || {}, w = waiting[m.id];
        if (!w) return;
        delete waiting[m.id];
        if (m.ok) w.resolve(m.vec || true); else w.reject(err(m.error || "engine"));
      };
      worker.onerror = function () {
        Object.keys(waiting).forEach(function (id) { waiting[id].reject(err("engine")); });
        waiting = {};
      };
      return Promise.all([f.vocab.text(), f.merges.text()]).then(function (t) {
        tok = CORE.tokenizer(JSON.parse(t[0]), t[1]);
        return call({ op: "load", js: f.js, mjs: f.mjs, wasm: f.wasm, vision: f.vision, text: f.text });
      });
    });
    loaded.catch(function () { stop(); });
    return loaded;
  }
  function stop() {
    if (worker) { try { worker.terminate(); } catch (e) { /* gone */ } }
    worker = null; loaded = null; tok = null; waiting = {};
  }

  // A picture (Blob) → the 224 × 224 centre square → CLIP vector.
  function decode(blob) {
    if (root.createImageBitmap) return createImageBitmap(blob);
    return new Promise(function (resolve, reject) {
      var img = new Image(), u = URL.createObjectURL(blob);
      img.onload = function () { URL.revokeObjectURL(u); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(u); reject(err("image")); };
      img.src = u;
    });
  }
  function embedImage(blob) {
    return boot().then(function () { return decode(blob); }).then(function (bmp) {
      var w = bmp.width, h = bmp.height, box = CORE.cropBox(w, h), S = CORE.SIZE;
      var cv = document.createElement("canvas");
      cv.width = S; cv.height = S;
      var g = cv.getContext("2d", { willReadFrequently: true });
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";
      g.drawImage(bmp, box.sx, box.sy, box.sw, box.sh, 0, 0, S, S);
      if (bmp.close) bmp.close();
      var px = CORE.pixels(g.getImageData(0, 0, S, S).data, S, S);
      return call({ op: "image", px: px }, [px.buffer]);
    });
  }
  function embedText(text) {
    return boot().then(function () {
      var ids = tok.encode(text);
      return call({ op: "text", ids: ids }, [ids.buffer]);
    });
  }

  // ---------- index ----------
  function vecs() {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var out = [], t = d.transaction("vecs", "readonly"), c = t.objectStore("vecs").openCursor();
        c.onsuccess = function () {
          var cur = c.result;
          if (!cur) return;
          var r = cur.value;
          if (r && r.v === VER && r.e instanceof Int8Array) out.push({ k: cur.key, v: r.e });
          cur.continue();
        };
        t.oncomplete = function () { resolve(out); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }
  function putVec(k, vec) { return tx("vecs", "readwrite", function (s) { s.put({ v: VER, e: CORE.pack(vec) }, k); }); }
  function dropVecs(keys) {
    if (!keys || !keys.length) return Promise.resolve();
    return tx("vecs", "readwrite", function (s) { keys.forEach(function (k) { s.delete(k); }); });
  }
  function count() { return tx("vecs", "readonly", function (s) { return s.count(); }).then(function (n) { return n || 0; }, function () { return 0; }); }
  function remove() {
    stop();
    return Promise.all([
      tx("files", "readwrite", function (s) { s.clear(); }),
      tx("vecs", "readwrite", function (s) { s.clear(); })
    ]).then(function () { return true; });
  }

  root.OrosClip = {
    MB: MB, VER: VER, FILES: FILES, ready: ready, install: install, remove: remove, stop: stop,
    embedImage: embedImage, embedText: embedText, vecs: vecs, putVec: putVec, dropVecs: dropVecs, count: count
  };
})(typeof window !== "undefined" ? window : this);
