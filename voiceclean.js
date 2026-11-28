// ============================================================
// orOS — voiceclean.js: clean noise out of a voice, on the device
// (v1.0.0, wave K1). Studio, Montage and Notes load it when asked.
// The engine is DeepFilterNet3 (Hendrik Schröter, MIT or Apache-2.0):
// koulaxizis/oros-models-vision tools/deepfilter builds the official
// libDF runtime with the official model inside into one WebAssembly
// module that imports nothing (no JavaScript glue, no eval), checked
// there against a native build of the same code. orOS keeps it, checked
// against the SHA-256 below, in IndexedDB "oros-voiceclean" (one copy
// for every app, never synced, never in the service worker's precache),
// so after the first time it works offline.
//   - DeepFilterNet works at 48 kHz, one state per channel; its output is
//     DELAY samples late, which clean() takes back, so the cleaned sound
//     lines up with the original sample for sample
//   - a long sound is cut into CHUNK-second pieces that run side by side
//     in 1 to 4 workers (voiceclean.worker.js); each piece starts WARM
//     seconds early (the network listens itself in, that output is
//     dropped) and the pieces meet with an XF-second crossfade
//   - strength: the most the noise is turned down (attenuation limit),
//     LEVELS gentle 12 dB, medium 24 dB, full (no limit)
// Pure steps (plan, stitch, frames) are exported for the Node tests
// (tests/voiceclean.test.js), with the real module when it is there.
// Exposes window.OrosVoiceClean (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var RATE = 48000;
  var CHUNK = 30, WARM = 2, XF = 0.05;            // seconds
  var LEVELS = { gentle: 12, medium: 24, full: 100 };
  var MAX_SEC = 3 * 3600;                         // Studio's longest project
  var MONO_OVER = 20 * 60;                        // longer stereo sounds are cleaned as one voice (memory)

  // ---------- Pure ----------
  // The pieces of a sound of n samples: { a, b } the samples it gives,
  // { from, to } the samples it reads (warm-up before, crossfade after).
  function plan(n, rate) {
    rate = rate || RATE;
    var step = CHUNK * rate, warm = Math.round(WARM * rate), xf = Math.round(XF * rate), out = [];
    for (var a = 0; a < n || !out.length; a += step) {
      var b = Math.min(n, a + step);
      out.push({ a: a, b: b, from: Math.max(0, a - warm), to: Math.min(n, b + xf) });
      if (b >= n) break;
    }
    return out;
  }
  // Puts the cleaned pieces together. pieces[k]: Float32Array of the
  // samples from p.a to p.to (what the worker gives back after dropping
  // the warm-up). Where a piece ends past b, its tail fades out while the
  // next piece fades in.
  function stitch(n, parts, pieces) {
    var out = new Float32Array(n);
    for (var k = 0; k < parts.length; k++) {
      var p = parts[k], x = pieces[k], len = p.to - p.a;
      var fadeIn = k > 0 ? parts[k - 1].to - p.a : 0;     // overlap with the piece before
      for (var i = 0; i < len; i++) {
        var j = p.a + i, v = x[i];
        if (i < fadeIn) {
          var g = (i + 0.5) / fadeIn;
          out[j] = out[j] * (1 - g) + v * g;
        } else out[j] = v;                                // past b: the next piece fades it out
      }
    }
    return out;
  }
  // Runs one piece through a DeepFilterNet engine:
  // eng = { hop, delay, process(Float32Array hop) → Float32Array hop }.
  // input: the samples from p.from to p.to; skip = p.a - p.from.
  // → Float32Array of length (input.length - skip), lined up with input.
  function frames(eng, input, skip) {
    var hop = eng.hop, total = input.length + eng.delay;
    var nFrames = Math.ceil(total / hop), out = new Float32Array(nFrames * hop), buf = new Float32Array(hop);
    for (var f = 0; f < nFrames; f++) {
      var s = f * hop;
      buf.fill(0);
      if (s < input.length) buf.set(input.subarray(s, Math.min(input.length, s + hop)));
      out.set(eng.process(buf), s);
    }
    return out.slice(eng.delay + skip, eng.delay + input.length);
  }
  // A DeepFilterNet engine from the instantiated module's exports.
  function engine(E, atten) {
    var st = E.dfo_create(1, atten);
    if (!st) throw new Error("engine");
    var hop = E.dfo_hop(st), pi = E.dfo_alloc(hop * 4), po = E.dfo_alloc(hop * 4);
    return {
      hop: hop, delay: E.dfo_delay(st),
      process: function (x) {
        new Float32Array(E.memory.buffer, pi, hop).set(x);
        E.dfo_process(st, pi, po);
        return new Float32Array(E.memory.buffer, po, hop).slice();
      },
      free: function () { E.dfo_destroy(st); E.dfo_free(pi, hop * 4); E.dfo_free(po, hop * 4); }
    };
  }
  function level(k) { return LEVELS[k] || LEVELS.medium; }

  var pure = { RATE: RATE, CHUNK: CHUNK, WARM: WARM, XF: XF, LEVELS: LEVELS, MAX_SEC: MAX_SEC, MONO_OVER: MONO_OVER,
               plan: plan, stitch: stitch, frames: frames, engine: engine, level: level };
  if (typeof module === "object" && module.exports) { module.exports = pure; return; }

  // ---------- The module (IndexedDB "oros-voiceclean") ----------
  var MIRROR = "https://koulaxizis.github.io/oros-models-vision/deepfilter/";
  // deepfilter/build.json of koulaxizis/oros-models-vision (MODEL-PIN)
  // (upstream 7b14b895…, rustc 1.97.0, checked 118 dB against the native build)
  var WASM = { url: MIRROR + "deepfilter.wasm", size: 14104642, sha: "6bbf1c7a7bc45c8a1c774107042b6a47ca6a52c6c9506308082c9e96d0a4776f" };
  var APPROX_MB = 14;
  var DB_NAME = "oros-voiceclean", KEY = "dfn3";
  var dbP = null;
  function err(code) { var e = new Error(code); e.code = code; return e; }
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
  function stored() {
    return tx("readonly", function (s) { return s.get(KEY); }).then(function (rec) {
      return rec && rec.v === WASM.sha && rec.blob instanceof Blob ? rec.blob : null;
    }, function () { return null; });
  }
  function ready() { return WASM.sha ? stored().then(Boolean) : Promise.resolve(false); }
  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function download(onProgress, signal) {
    return fetch(WASM.url, { cache: "no-cache", signal: signal }).then(function (res) {
      if (!res.ok) throw err("download");
      var total = WASM.size || APPROX_MB * 1048576;
      if (!res.body || !res.body.getReader) return res.arrayBuffer();
      var reader = res.body.getReader(), parts = [], got = 0;
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return new Blob(parts).arrayBuffer();
          parts.push(r.value); got += r.value.byteLength;
          if (onProgress) onProgress(Math.min(0.99, got / total));
          return pump();
        });
      }
      return pump();
    }, function () { throw signal && signal.aborted ? err("cancelled") : err("download"); });
  }
  // → ArrayBuffer of the module (downloaded and checked once, then kept)
  function bytes(onProgress, signal) {
    if (!WASM.sha) return Promise.reject(err("unavailable"));
    return stored().then(function (b) {
      if (b) return b.arrayBuffer();
      return download(onProgress, signal).then(function (buf) {
        return crypto.subtle.digest("SHA-256", buf).then(function (h) {
          if (hex(h) !== WASM.sha) throw err("hash");
          return tx("readwrite", function (s) { s.put({ v: WASM.sha, blob: new Blob([buf], { type: "application/wasm" }) }, KEY); })
            .catch(function () { throw err("quota"); }).then(function () { if (onProgress) onProgress(1); return buf; });
        });
      });
    });
  }
  var modP = null;
  function compiled(onProgress, signal) {
    if (!modP) {
      modP = bytes(onProgress, signal).then(function (buf) { return WebAssembly.compile(buf); });
      modP.catch(function () { modP = null; });
    }
    return modP;
  }
  function forget() {
    modP = null;
    return tx("readwrite", function (s) { s.clear(); }).catch(function () {});
  }

  // ---------- Workers ----------
  function phone() {
    try { return matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 820; } catch (e) { return false; }
  }
  function workerCount(jobs) {
    var cores = navigator.hardwareConcurrency || 2, mem = navigator.deviceMemory || 4;
    var n = phone() || mem < 4 ? (cores >= 6 ? 2 : 1) : Math.max(1, Math.min(4, cores - 1, Math.floor(mem / 2)));
    return Math.max(1, Math.min(n, jobs || n));
  }
  // seconds of work per second of sound, one worker (measured: Chromium,
  // WebAssembly SIMD, 0.22); phones about three times slower
  function seconds(sec, channels) {
    var per = 0.25 * (phone() ? 3 : 1);
    return Math.max(1, Math.round(sec * Math.max(1, channels || 1) * per / workerCount()));
  }
  // the worker sits next to this file and has its version
  var self0 = (function () {
    try { var s = document.currentScript && document.currentScript.src; if (s) return s; } catch (e) {}
    return "";
  })();
  var workerUrl = self0 ? self0.replace(/voiceclean\.js/, "voiceclean.worker.js") : "voiceclean.worker.js";

  // planes: Float32Array per channel at 48 kHz (Studio, Montage and Notes
  // turn their sound into that first: at48k).
  // opts: { strength: gentle|medium|full, onDownload(f), onProgress(f, secondsLeft|null), signal }
  // → Promise<Float32Array[]> cleaned, same length.
  // Error codes: unavailable, download, hash, quota, cancelled, long, engine, memory.
  function clean(planes, opts) {
    opts = opts || {};
    var n = planes[0] ? planes[0].length : 0, signal = opts.signal;
    if (!n) return Promise.reject(err("engine"));
    if (n > MAX_SEC * RATE) return Promise.reject(err("long"));
    var atten = level(opts.strength), parts = plan(n);
    return compiled(opts.onDownload, signal).then(function (mod) {
      return new Promise(function (resolve, reject) {
        var jobs = [];
        planes.forEach(function (x, c) { parts.forEach(function (p, k) { jobs.push({ c: c, k: k }); }); });
        var pieces = planes.map(function () { return []; }), next = 0, done = 0, inFlight = 0, finished = false;
        var workers = [], t0 = Date.now();
        function stop(e) {
          if (finished) return;
          finished = true;
          workers.forEach(function (w) { try { w.terminate(); } catch (x) {} });
          if (e) reject(e);
        }
        if (signal) {
          if (signal.aborted) return stop(err("cancelled"));
          signal.addEventListener("abort", function () { stop(err("cancelled")); });
        }
        function give(w) {
          if (finished || next >= jobs.length) return;
          var j = jobs[next++], p = parts[j.k];
          var input = planes[j.c].slice(p.from, p.to);
          inFlight++;
          w.postMessage({ type: "run", id: next - 1, input: input, skip: p.a - p.from, atten: atten }, [input.buffer]);
        }
        function onMsg(w, e) {
          var m = e.data || {};
          if (finished) return;
          if (m.type === "ready") { give(w); return; }
          if (m.type === "error") { stop(err(m.code === "memory" ? "memory" : "engine")); return; }
          if (m.type !== "done") return;
          var j = jobs[m.id];
          pieces[j.c][j.k] = m.out;
          inFlight--; done++;
          if (opts.onProgress) {
            var secs = (Date.now() - t0) / 1000;
            opts.onProgress(Math.min(0.99, done / jobs.length), Math.round(secs / done * (jobs.length - done)));
          }
          if (next < jobs.length) give(w);
          else if (!inFlight) {
            stop(null);
            resolve(pieces.map(function (ps) { return stitch(n, parts, ps); }));
          }
        }
        var count = workerCount(jobs.length);
        for (var i = 0; i < count; i++) {
          var w;
          try { w = new Worker(workerUrl); } catch (e) { return stop(err("engine")); }
          w.onmessage = onMsg.bind(null, w);
          w.onerror = function () { stop(err("engine")); };
          w.postMessage({ type: "init", module: mod });
          workers.push(w);
        }
      });
    });
  }

  // An AudioBuffer (any rate) → Float32Array per channel at 48 kHz.
  // Stereo sounds longer than MONO_OVER, and stereo whose two sides are
  // the same, become one channel (a voice; memory).
  function at48k(buf) {
    var n = Math.max(1, Math.round(buf.duration * RATE));
    var ch = Math.min(2, buf.numberOfChannels);
    if (ch === 2 && (buf.duration > MONO_OVER || same(buf))) ch = 1;
    var OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    var oc = new OAC(ch, n, RATE), node = oc.createBufferSource();
    node.buffer = buf; node.connect(oc.destination); node.start(0);
    return oc.startRendering().then(function (r) {
      var out = [];
      for (var c = 0; c < ch; c++) out.push(r.getChannelData(c));
      return out;
    });
  }
  function same(buf) {
    var l = buf.getChannelData(0), r = buf.getChannelData(1), step = Math.max(1, Math.floor(l.length / 20000));
    for (var i = 0; i < l.length; i += step) if (Math.abs(l[i] - r[i]) > 1e-4) return false;
    return true;
  }
  // Any audio or video file (Blob) → AudioBuffer, decoded at 48 kHz.
  function decode(blob) {
    var OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    return blob.arrayBuffer().then(function (ab) {
      var oc = new OAC(1, 1, RATE);
      return new Promise(function (ok, fail) { oc.decodeAudioData(ab, ok, function () { fail(err("decode")); }); });
    });
  }
  // Float32 planes → WAV 16-bit Blob (for the 10-second preview).
  function wav(planes, rate) {
    var ch = planes.length, n = planes[0].length, b = new DataView(new ArrayBuffer(44 + n * ch * 2));
    function s(o, t) { for (var i = 0; i < t.length; i++) b.setUint8(o + i, t.charCodeAt(i)); }
    s(0, "RIFF"); b.setUint32(4, 36 + n * ch * 2, true); s(8, "WAVEfmt "); b.setUint32(16, 16, true);
    b.setUint16(20, 1, true); b.setUint16(22, ch, true); b.setUint32(24, rate, true); b.setUint32(28, rate * ch * 2, true);
    b.setUint16(32, ch * 2, true); b.setUint16(34, 16, true); s(36, "data"); b.setUint32(40, n * ch * 2, true);
    for (var i = 0, o = 44; i < n; i++) for (var c = 0; c < ch; c++, o += 2) {
      var v = Math.max(-1, Math.min(1, planes[c][i])); b.setInt16(o, v < 0 ? v * 32768 : v * 32767, true);
    }
    return new Blob([b.buffer], { type: "audio/wav" });
  }

  root.OrosVoiceClean = Object.assign({}, pure, {
    WASM: WASM, APPROX_MB: APPROX_MB, ready: ready, forget: forget, clean: clean, at48k: at48k,
    decode: decode, wav: wav, phone: phone, workerCount: workerCount, seconds: seconds
  });
})(typeof window !== "undefined" ? window : this);
