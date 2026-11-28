// ============================================================
// orOS voices — natural voices on the device (voicekit/voicekit.js, v1.2.0)
// Reads text aloud with a Piper voice (VITS, ONNX) or a Kokoro voice
// (StyleTTS 2, ONNX) in ONNX Runtime Web
// (vendor/ort, MIT, the same runtime Atelier and Montage use), in a
// worker (voicekit/worker.js) so the page never stalls.
//   - nothing is downloaded until the person asks (Settings ›
//     Accessibility › Read aloud): the voice comes from orOS's own copy
//     (koulaxizis/oros-models-vision, GitHub Pages), each file is checked
//     by SHA-256 before it is kept in IndexedDB "oros-voices", and from
//     then on it works offline. "Remove" deletes it.
//   - the text never leaves the device (rule 30: local speech only).
//   - text becomes phonemes in orOS's own code, one file per language
//     (voicekit/greek.js, voicekit/german.js; MIT; espeak-ng is never
//     shipped).
//   - 1.1.0 (VOICE-2, Chris 2026-11-28): the German voice Thorsten
//     (de_DE-thorsten-medium, CC0); voices made with Piper 1.5 read some
//     vowel pairs as one sound (config vowel_clusters).
//   - 1.2.0 (VOICE-3, Chris 2026-11-28): the English voices Heart and
//     Michael (Kokoro-82M, Apache-2.0). They share one model, its
//     tokenizer and misaki's dictionaries (voicekit/english.js), so the
//     files are kept by path and the second voice adds only 0.5 MB.
//   OrosVoice.VOICES            the voices orOS knows (id → details)
//   OrosVoice.forLang(lang)     → the voice id for a language, or ""
//   OrosVoice.ofLang(lang)      → every voice id of a language
//   OrosVoice.ready(id)         → Promise<bool> (on this device?)
//   OrosVoice.prepare(id, progress(f)?, signal?) → Promise<true>
//   OrosVoice.download(id, progress(f)?, signal?) → Promise<true> (files only)
//   OrosVoice.forget(id | [ids]) → Promise (removes the voices)
//   OrosVoice.synth(id, text, { rate }) → Promise<{ audio: Float32Array, sampleRate }>
//   OrosVoice.play(clip)        → { done: Promise, stop() }
// Pure helpers (idsOf, scalesOf, filesOf) are unit-tested in node.
// UMD: module.exports in Node, window.OrosVoice in the browser.
// ============================================================
(function (root) {
  "use strict";

  var MIRROR = "https://koulaxizis.github.io/oros-models-vision/";
  // Files and their SHA-256 as koulaxizis/oros-models-vision index.json
  // records them (tools/mirror.py copies them unchanged from upstream).
  var VOICES = {
    "el-joy": {
      lang: "el", name: "Joy", mb: 63, licence: "CC BY-NC 4.0", free: false, g2p: "greek",
      dir: "piper-el-joy/el/el_GR/joy/medium/",
      model: { file: "el_GR-joy-medium.onnx", sha: "31b1d51dc72dd43a5429b67798e27599f8cdcfce8a80265bc6f50d932bf144bc", size: 63516050 },
      config: { file: "el_GR-joy-medium.onnx.json", sha: "451a8885a0ea72e4432fffe22e65a75bbd2e65f6757273d1a5a9ed8a3419852e", size: 7367 }
    },
    "de-thorsten": {
      lang: "de", name: "Thorsten", mb: 63, licence: "CC0", free: true, g2p: "german",
      dir: "piper-de-thorsten/de/de_DE/thorsten/medium/",
      model: { file: "de_DE-thorsten-medium.onnx", sha: "fd270eb3d1ebf91d763f8a0f949b1b1bebdfefaea18c3aaf8577dd34536e064f", size: 63221984 },
      config: { file: "de_DE-thorsten-medium.onnx.json", sha: "e5bb7410dcbbcc0be6f4544f6bc66612b315ab5cb3099ec44bb46d860bc7cca9", size: 6455 }
    },
    "en-heart": kokoroVoice("Heart", "af_heart", "d583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b"),
    "en-michael": kokoroVoice("Michael", "am_michael", "1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1")
  };
  // VOICE-3: Kokoro-82M (onnx-community's 8-bit export) and misaki's
  // American English dictionaries, shared by every Kokoro voice
  function kokoroVoice(name, file, sha) {
    return {
      lang: "en", name: name, mb: 99, licence: "Apache-2.0", free: true, g2p: "english", engine: "kokoro",
      dir: "kokoro-82m/",
      model: { file: "onnx/model_quantized.onnx", sha: "fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478", size: 92361116 },
      config: { file: "tokenizer.json", sha: "77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34", size: 3497 },
      style: { file: "voices/" + file + ".bin", sha: sha, size: 522240 },
      gold: { path: "misaki-en/us_gold.json", sha: "dc414872a49a28ae6c141463d502fd945f3b2fde040484fdc47d00cc4612686f", size: 3000469 },
      silver: { path: "misaki-en/us_silver.json", sha: "de8f67be911bb6c659187b4a65fd966b6a30e56350e0f790d763210b053ac475", size: 3099517 }
    };
  }
  // the first voice of a language is the one Automatic uses
  var LANG_VOICE = { el: "el-joy", de: "de-thorsten", en: "en-heart" };
  // the phonemes of each language: voicekit/<g2p>.js sets self[<global>]
  var G2P = { greek: "GreekVoice", german: "GermanVoice", english: "EnglishVoice" };
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
  // know are skipped. map = config.phoneme_id_map ({ "a": [14], … });
  // clusters = config.vowel_clusters ([["a", "ɪ"], …], Piper 1.5): such a
  // pair is one sound with an id of its own.
  function idsOf(ph, map, clusters) {
    var out = [], pad = (map._ || [0])[0], pairs = {};
    (clusters || []).forEach(function (c) { var k = c.join(""); if (map[k]) pairs[k] = 1; });
    function add(sym) { var v = map[sym]; if (v) for (var i = 0; i < v.length; i++) out.push(v[i]); return !!v; }
    add("^"); out.push(pad);
    var s = String(ph || "").normalize("NFD");
    for (var i = 0; i < s.length;) {
      var cp = s.codePointAt(i), ch = String.fromCodePoint(cp);
      var nx = i + ch.length < s.length ? String.fromCodePoint(s.codePointAt(i + ch.length)) : "";
      if (nx && pairs[ch + nx]) { add(ch + nx); out.push(pad); i += ch.length + nx.length; continue; }
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
  function ofLang(lang) {
    var l = String(lang || "").toLowerCase().split(/[-_]/)[0];
    return Object.keys(VOICES).filter(function (id) { return VOICES[id].lang === l; });
  }
  // A voice's own files: { role, key, path, sha }. Piper voices keep the
  // keys of 1.0 (id:model, id:config); Kokoro files are kept by path,
  // so voices that share a file share one copy.
  function filesOf(id) {
    var v = VOICES[id];
    if (!v) return [];
    return ["model", "config", "style", "gold", "silver"].filter(function (r) { return v[r]; }).map(function (r) {
      var f = v[r], path = f.path || v.dir + f.file;
      return { role: r, key: v.engine === "kokoro" ? "f:" + path : id + ":" + r, path: path, sha: f.sha };
    });
  }
  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }

  var pure = { VOICES: VOICES, G2P: G2P, idsOf: idsOf, scalesOf: scalesOf, forLang: forLang, ofLang: ofLang, filesOf: filesOf,
               hex: hex, MIRROR: MIRROR, RUNTIME: RUNTIME };
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
    }).concat(filesOf(id).map(function (f) {
      return { key: f.key, role: f.role, url: MIRROR + f.path, ver: f.sha, sha: f.sha };
    }));
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
    var byRole = {};
    return list.reduce(function (p, f) {
      return p.then(function () {
        return stored(f).then(function (b) {
          if (b) { got[f.key] = b; if (f.role) byRole[f.role] = b; return; }
          return fetchFile(f.url, function (n) { done += n; if (onProgress) onProgress(Math.min(0.99, done / total)); }, signal)
            .then(function (blob) { return checkSha(blob, f.sha); })
            .then(function (blob) {
              got[f.key] = blob;
              if (f.role) byRole[f.role] = blob;
              return tx("readwrite", function (s) { s.put({ v: f.ver, blob: blob }, f.key); });
            });
        });
      });
    }, Promise.resolve()).then(function () { if (onProgress) onProgress(1); got.role = byRole; return got; });
  }
  // Removes the voices' files that no other voice on this device uses.
  function forget(ids) {
    ids = [].concat(ids);
    stopWorker();
    var others = Object.keys(VOICES).filter(function (k) { return ids.indexOf(k) === -1; });
    return Promise.all(others.map(ready)).then(function (r) {
      var keep = {};
      others.forEach(function (k, i) { if (r[i]) fileList(k).forEach(function (f) { keep[f.key] = 1; }); });
      return tx("readwrite", function (s) {
        ids.forEach(function (id) { fileList(id).forEach(function (f) { if (!keep[f.key]) s.delete(f.key); }); });
      });
    }).catch(function () {});
  }

  // ---------- the workers ----------
  // One worker per voice; a Kokoro voice gets up to 3 (VOICE-3): ONNX
  // Runtime can use one core per worker here (threads need a cross-origin
  // isolated page), and Kokoro is heavier than Piper, so the next parts
  // of a text are made side by side while one plays. Fewer on a device
  // with little memory or few cores.
  function poolSize(id) {
    var v = VOICES[id], nav = root.navigator || {};
    if (!v || v.engine !== "kokoro") return 1;
    var cores = nav.hardwareConcurrency || 2, mem = nav.deviceMemory || 4;
    return mem >= 8 && cores >= 6 ? 3 : mem >= 4 && cores >= 4 ? 2 : 1;
  }
  var pool = [], workerFor = "", loadP = null, seq = 0, waiting = {};
  function stopWorker() {
    pool.forEach(function (p) { try { p.w.terminate(); } catch (e) {} });
    Object.keys(waiting).forEach(function (k) { waiting[k].reject(new Error("stopped")); });
    pool = []; workerFor = ""; loadP = null; waiting = {};
  }
  function ask(p, msg, transfer) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      waiting[id] = { resolve: resolve, reject: reject, p: p };
      p.busy++;
      msg.id = id;
      p.w.postMessage(msg, transfer || []);
    });
  }
  function spawn() {
    var p = { w: new Worker(BASE + "voicekit/worker.js"), busy: 0 };
    p.w.onmessage = function (e) {
      var m = e.data || {}, w = waiting[m.id];
      if (!w) return;
      delete waiting[m.id];
      w.p.busy--;
      if (m.ok) w.resolve(m.result); else w.reject(new Error(m.error || "worker"));
    };
    p.w.onerror = function () { stopWorker(); };
    return p;
  }
  function load(id, onProgress, signal) {
    if (loadP && workerFor === id) return loadP;
    stopWorker();
    workerFor = id;
    var my = loadP = files(id, onProgress, signal).then(function (f) {
      if (loadP !== my) throw new Error("stopped");
      var v = VOICES[id], R = f.role, kok = v.engine === "kokoro", n = poolSize(id);
      return Promise.all([R.config.text(), kok ? R.gold.text() : null, kok ? R.silver.text() : null]).then(function (t) {
        var config = JSON.parse(t[0]), started = [];
        for (var i = 0; i < n; i++) started.push(Promise.all([R.model.arrayBuffer(), kok ? R.style.arrayBuffer() : null]).then(function (b) {
          if (loadP !== my) throw new Error("stopped");
          var p = spawn();
          pool.push(p);
          var msg = {
            op: "init", js: f["rt:js"], mjs: f["rt:mjs"], wasm: f["rt:wasm"],
            g2p: BASE + "voicekit/" + v.g2p + ".js", g2pName: G2P[v.g2p], model: b[0], config: config
          }, transfer = [b[0]];
          if (kok) {   // VOICE-3
            msg.engine = "kokoro"; msg.kokoro = BASE + "voicekit/kokoro.js";
            msg.style = b[1]; msg.lexicon = [t[1], t[2]]; transfer.push(b[1]);
          }
          return ask(p, msg, transfer);
        }));
        return Promise.all(started).then(function () { return config; });
      });
    });
    my.catch(function () { if (loadP === my) stopWorker(); });
    return my;
  }

  function synth(id, text, opts) {
    opts = opts || {};
    return load(id, opts.progress, opts.signal).then(function (config) {
      if (!pool.length) throw new Error("stopped");
      var p = pool.reduce(function (a, b) { return b.busy < a.busy ? b : a; });   // the least busy worker
      var speed = Math.min(RATES_MAX, Math.max(RATES_MIN, Number(opts.rate) || 1));
      return ask(p, { op: "synth", text: String(text || ""), scales: scalesOf(config, opts.rate), speed: speed }).then(function (r) {
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
    VOICES: VOICES, forLang: forLang, ofLang: ofLang, ready: ready, forget: forget, synth: synth, play: play,
    ahead: poolSize,   // how many parts of a text are worth asking for at once
    download: function (id, onProgress, signal) { return files(id, onProgress, signal).then(function () { return true; }); },
    prepare: function (id, onProgress, signal) { return load(id, onProgress, signal).then(function () { return true; }); },
    unload: stopWorker
  };
})(typeof window !== "undefined" ? window : this);
