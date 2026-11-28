// ============================================================
// orOS voices — natural voices on the device (voicekit/voicekit.js, v1.0.0)
// Reads text aloud with a Piper voice (VITS, ONNX) in ONNX Runtime Web
// (vendor/ort, MIT, the same runtime Atelier and Montage use), in a
// worker (voicekit/worker.js) so the page never stalls.
//   - nothing is downloaded until the person asks (Settings ›
//     Accessibility › Read aloud): the voice comes from orOS's own copy
//     (koulaxizis/oros-models-vision, GitHub Pages), each file is checked
//     by SHA-256 before it is kept in IndexedDB "oros-voices", and from
//     then on it works offline. "Remove" deletes it.
//   - the text never leaves the device (rule 30: local speech only).
//   - Greek text becomes phonemes in voicekit/greek.js (MIT; espeak-ng
//     is never shipped).
//   OrosVoice.VOICES            the voices orOS knows (id → details)
//   OrosVoice.forLang(lang)     → the voice id for a language, or ""
//   OrosVoice.ready(id)         → Promise<bool> (on this device?)
//   OrosVoice.prepare(id, progress(f)?, signal?) → Promise<true>
//   OrosVoice.forget(id)        → Promise (removes the voice)
//   OrosVoice.synth(id, text, { rate }) → Promise<{ audio: Float32Array, sampleRate }>
//   OrosVoice.play(clip)        → { done: Promise, stop() }
// Pure helpers (idsOf, scalesOf) are unit-tested in node.
// UMD: module.exports in Node, window.OrosVoice in the browser.
// ============================================================
(function (root) {
  "use strict";

  var MIRROR = "https://koulaxizis.github.io/oros-models-vision/";
  // Files and their SHA-256 as koulaxizis/oros-models-vision index.json
  // records them (tools/mirror.py copies them unchanged from upstream).
  var VOICES = {
    "el-joy": {
      lang: "el", name: "Joy", mb: 63, licence: "CC BY-NC 4.0",
      dir: "piper-el-joy/el/el_GR/joy/medium/",
      model: { file: "el_GR-joy-medium.onnx", sha: "31b1d51dc72dd43a5429b67798e27599f8cdcfce8a80265bc6f50d932bf144bc", size: 63516050 },
      config: { file: "el_GR-joy-medium.onnx.json", sha: "451a8885a0ea72e4432fffe22e65a75bbd2e65f6757273d1a5a9ed8a3419852e", size: 7367 }
    }
  };
  var LANG_VOICE = { el: "el-joy" };
  // The runtime comes from orOS itself (precached by nobody: kept with
  // the voice so it works offline).
  var RUNTIME = [
    { key: "rt:js", url: "vendor/ort/ort.wasm.min.js", type: "text/javascript" },
    { key: "rt:mjs", url: "vendor/ort/ort-wasm-simd-threaded.mjs", type: "text/javascript" },
    { key: "rt:wasm", url: "vendor/ort/ort-wasm-simd-threaded.wasm", type: "application/wasm" }
  ];
  var RUNTIME_VER = "1.22.0";
  var RATES_MIN = 0.5, RATES_MAX = 2.5;

  // ---------- pure ----------
  // Piper's input: ^ _ (each phoneme, _) $ ; phonemes the voice does not
  // know are skipped. map = config.phoneme_id_map ({ "a": [14], … }).
  function idsOf(ph, map) {
    var out = [], pad = (map._ || [0])[0];
    function add(sym) { var v = map[sym]; if (v) for (var i = 0; i < v.length; i++) out.push(v[i]); return !!v; }
    add("^"); out.push(pad);
    var s = String(ph || "").normalize("NFD");
    for (var i = 0; i < s.length;) {
      var cp = s.codePointAt(i), ch = String.fromCodePoint(cp);
      i += ch.length;
      if (add(ch)) out.push(pad);
    }
    add("$");
    return out;
  }
  // [noise, length, noise_w] from the voice's config; a faster rate is a
  // shorter length.
  function scalesOf(config, rate) {
    var inf = (config && config.inference) || {};
    var r = Math.min(RATES_MAX, Math.max(RATES_MIN, Number(rate) || 1));
    var len = (typeof inf.length_scale === "number" ? inf.length_scale : 1) / r;
    return [typeof inf.noise_scale === "number" ? inf.noise_scale : 0.667, len,
            typeof inf.noise_w === "number" ? inf.noise_w : 0.8];
  }
  function forLang(lang) { return LANG_VOICE[String(lang || "").toLowerCase().split(/[-_]/)[0]] || ""; }
  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }

  var pure = { VOICES: VOICES, idsOf: idsOf, scalesOf: scalesOf, forLang: forLang, hex: hex, MIRROR: MIRROR, RUNTIME: RUNTIME };
  if (typeof module === "object" && module.exports) { module.exports = pure; return; }

  // ---------- browser: where this file lives ----------
  var BASE = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/voicekit\/voicekit\.js(\?.*)?$/, "") : "./";
  })();

  // ---------- IndexedDB ----------
  var DB_NAME = "oros-voices", dbP = null;
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
  // every file of a voice: { key, url, ver, sha?, type }
  function fileList(id) {
    var v = VOICES[id];
    if (!v) return [];
    return RUNTIME.map(function (f) {
      return { key: f.key, url: BASE + f.url, ver: RUNTIME_VER, type: f.type };
    }).concat([
      { key: id + ":model", url: MIRROR + v.dir + v.model.file, ver: v.model.sha, sha: v.model.sha },
      { key: id + ":config", url: MIRROR + v.dir + v.config.file, ver: v.config.sha, sha: v.config.sha }
    ]);
  }
  function stored(f) {
    return tx("readonly", function (s) { return s.get(f.key); }).then(function (rec) {
      return rec && rec.v === f.ver && rec.blob instanceof Blob ? rec.blob : null;
    }, function () { return null; });
  }
  function ready(id) {
    var list = fileList(id);
    if (!list.length) return Promise.resolve(false);
    return Promise.all(list.map(stored)).then(function (l) { return l.every(Boolean); }, function () { return false; });
  }
  function fetchFile(url, onBytes, signal) {
    return fetch(url, { cache: "no-cache", signal: signal, credentials: "omit" }).then(function (res) {
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
  function checkSha(blob, sha) {
    if (!sha) return Promise.resolve(blob);
    return blob.arrayBuffer().then(function (buf) { return crypto.subtle.digest("SHA-256", buf); }).then(function (d) {
      if (hex(d) !== sha) throw new Error("sha");
      return blob;
    });
  }
  // Download what is missing, check it, keep it.
  function files(id, onProgress, signal) {
    var v = VOICES[id];
    if (!v) return Promise.reject(new Error("voice"));
    var list = fileList(id), got = {}, done = 0, total = (v.mb + 12) * 1024 * 1024;
    return list.reduce(function (p, f) {
      return p.then(function () {
        return stored(f).then(function (b) {
          if (b) { got[f.key] = b; return; }
          return fetchFile(f.url, function (n) { done += n; if (onProgress) onProgress(Math.min(0.99, done / total)); }, signal)
            .then(function (blob) { return checkSha(blob, f.sha); })
            .then(function (blob) {
              got[f.key] = blob;
              return tx("readwrite", function (s) { s.put({ v: f.ver, blob: blob }, f.key); });
            });
        });
      });
    }, Promise.resolve()).then(function () { if (onProgress) onProgress(1); return got; });
  }
  function forget(id) {
    stopWorker();
    var others = Object.keys(VOICES).filter(function (k) { return k !== id; });
    return Promise.all(others.map(ready)).then(function (r) {
      var keepRuntime = r.some(Boolean);
      return tx("readwrite", function (s) {
        s.delete(id + ":model"); s.delete(id + ":config");
        if (!keepRuntime) RUNTIME.forEach(function (f) { s.delete(f.key); });
      });
    }).catch(function () {});
  }

  // ---------- the worker ----------
  var worker = null, workerFor = "", loadP = null, seq = 0, waiting = {};
  function stopWorker() {
    if (worker) { try { worker.terminate(); } catch (e) {} }
    Object.keys(waiting).forEach(function (k) { waiting[k].reject(new Error("stopped")); });
    worker = null; workerFor = ""; loadP = null; waiting = {};
  }
  function ask(msg, transfer) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      waiting[id] = { resolve: resolve, reject: reject };
      msg.id = id;
      worker.postMessage(msg, transfer || []);
    });
  }
  function load(id, onProgress, signal) {
    if (loadP && workerFor === id) return loadP;
    stopWorker();
    workerFor = id;
    var my = loadP = files(id, onProgress, signal).then(function (f) {
      if (loadP !== my) throw new Error("stopped");
      worker = new Worker(BASE + "voicekit/worker.js");
      worker.onmessage = function (e) {
        var m = e.data || {}, w = waiting[m.id];
        if (!w) return;
        delete waiting[m.id];
        if (m.ok) w.resolve(m.result); else w.reject(new Error(m.error || "worker"));
      };
      worker.onerror = function () { stopWorker(); };
      return Promise.all([f[id + ":model"].arrayBuffer(), f[id + ":config"].text()]).then(function (r) {
        var config = JSON.parse(r[1]);
        return ask({
          op: "init", js: f["rt:js"], mjs: f["rt:mjs"], wasm: f["rt:wasm"],
          greek: BASE + "voicekit/greek.js", model: r[0], config: config
        }, [r[0]]).then(function () { return config; });
      });
    });
    my.catch(function () { if (loadP === my) stopWorker(); });
    return my;
  }

  function synth(id, text, opts) {
    opts = opts || {};
    return load(id, opts.progress, opts.signal).then(function (config) {
      return ask({ op: "synth", text: String(text || ""), scales: scalesOf(config, opts.rate) }).then(function (r) {
        return { audio: r.audio, sampleRate: r.sampleRate || (config.audio && config.audio.sample_rate) || 22050 };
      });
    });
  }

  // ---------- playback ----------
  var ctx = null;
  function play(clip) {
    var stopped = false, src = null, finish;
    var done = new Promise(function (resolve) { finish = resolve; });
    try {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!ctx) ctx = new AC();
      if (ctx.state === "suspended") ctx.resume();
      var buf = ctx.createBuffer(1, Math.max(1, clip.audio.length), clip.sampleRate);
      buf.copyToChannel ? buf.copyToChannel(clip.audio, 0) : buf.getChannelData(0).set(clip.audio);
      src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.onended = function () { finish(!stopped); };
      src.start();
    } catch (e) { finish(false); }
    return {
      done: done,
      stop: function () { if (stopped) return; stopped = true; try { src && src.stop(); } catch (e) {} finish(false); }
    };
  }

  root.OrosVoice = {
    VOICES: VOICES, forLang: forLang, ready: ready, forget: forget, synth: synth, play: play,
    prepare: function (id, onProgress, signal) { return load(id, onProgress, signal).then(function () { return true; }); },
    unload: stopWorker
  };
})(typeof window !== "undefined" ? window : this);
