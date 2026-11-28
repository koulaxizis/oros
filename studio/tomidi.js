// ============================================================
// orOS Studio — tomidi.js: sound to MIDI notes, on the device
// (v1.0.0, wave K4). Spotify's Basic Pitch (Apache-2.0): the model
// nmp.onnx (unchanged, mirrored by koulaxizis/oros-models-vision, checked
// against the SHA-256 below) runs in ONNX Runtime Web (vendor/ort) in a
// worker (tomidi.worker.js); turning its output into notes is a port of
// basic_pitch.inference (windows, unwrap) and basic_pitch.note_creation
// (output_to_notes_polyphonic with the melodia trick, model_frames_to_time),
// the same steps and numbers, checked against basic-pitch 0.4.0 by
// tests/studio-tomidi.test.js.
//   - the model hears 22,050 Hz mono in windows of 43,844 samples that
//     overlap by 30 frames (256 samples each); it gives per frame 88
//     "note", 88 "onset" and 264 "contour" values (piano keys A0..C8)
//   - kinds: "poly" (chords: guitar, piano) or "melody" (one note at a
//     time: whistling, humming, singing, a solo line): the strongest
//     notes win where notes overlap
//   - sensitivity 1..5 (3 = Basic Pitch's defaults: onset 0.5, frame 0.3)
//   - quantise: 0 (off), 8 or 16 (eighths or sixteenths at the project's
//     tempo)
// Nothing is downloaded until the person asks; the model (0.23 MB) is
// kept in IndexedDB "oros-studio-ai" next to the stems model.
// Exposes window.StudioToMidi (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var SR = 22050, HOP = 256;
  var N_SAMPLES = SR * 2 - HOP;                 // 43844: the model's window
  var FPS = Math.floor(SR / HOP);               // 86
  var ANNOT_FRAMES = FPS * 2;                   // 172
  var OVERLAP_FRAMES = 30, OVERLAP = OVERLAP_FRAMES * HOP;
  var STEP = N_SAMPLES - OVERLAP;               // 36164
  var MIDI_OFFSET = 21, MAX_FREQ_IDX = 87, ENERGY_TOL = 11;
  var MIN_NOTE_MS = 127.70;
  var MAX_SEC = 15 * 60;
  var SENS = { 1: [0.7, 0.45], 2: [0.6, 0.37], 3: [0.5, 0.3], 4: [0.4, 0.25], 5: [0.3, 0.2] };   // [onset, frame]

  // ---------- Windows (basic_pitch.inference) ----------
  // The windows of a sound of n samples (half an overlap of silence first).
  function windows(n) {
    var padded = n + OVERLAP / 2, out = [];
    for (var i = 0; i < padded; i += STEP) out.push(i - OVERLAP / 2);   // start in the original sound
    return out;
  }
  function windowAt(x, start) {
    var w = new Float32Array(N_SAMPLES);
    for (var i = 0; i < N_SAMPLES; i++) {
      var j = start + i;
      if (j >= 0 && j < x.length) w[i] = x[j];
    }
    return w;
  }
  // outs: per window a Float32Array(frames * bins) → one (n_frames x bins)
  // Float32Array: half the overlap dropped at both ends of every window,
  // cut to the original length.
  function unwrap(outs, framesPer, bins, nSamples) {
    var half = OVERLAP_FRAMES / 2, keep = framesPer - 2 * half;
    var total = Math.floor(nSamples * (FPS / SR)), out = new Float32Array(total * bins), row = 0;
    for (var w = 0; w < outs.length && row < total; w++) {
      for (var f = half; f < framesPer - half && row < total; f++, row++) {
        out.set(outs[w].subarray(f * bins, (f + 1) * bins), row * bins);
      }
    }
    void keep;
    return { data: out, frames: total };
  }

  // ---------- Notes (basic_pitch.note_creation) ----------
  function at(m, bins, t, f) { return m[t * bins + f]; }
  // get_infered_onsets, n_diff 2
  function inferOnsets(onsets, frames, T, B) {
    var diff = new Float64Array(T * B), maxOn = 0, maxDiff = 0, t, f;
    for (t = 0; t < T * B; t++) if (onsets[t] > maxOn) maxOn = onsets[t];
    for (t = 0; t < T; t++) for (f = 0; f < B; f++) {
      var cur = frames[t * B + f], d = Infinity;
      for (var n = 1; n <= 2; n++) {
        var prev = t - n >= 0 ? frames[(t - n) * B + f] : 0;
        d = Math.min(d, cur - prev);
      }
      if (d < 0 || t < 2) d = 0;
      diff[t * B + f] = d;
      if (d > maxDiff) maxDiff = d;
    }
    var out = new Float64Array(T * B);
    for (t = 0; t < T * B; t++) {
      var v = maxDiff > 0 ? maxOn * diff[t] / maxDiff : NaN;
      out[t] = Math.max(onsets[t], v);
      if (v !== v) out[t] = NaN;        // numpy: 0/0 gives nan, and max() with nan is nan
    }
    return out;
  }
  // output_to_notes_polyphonic: → [[startFrame, endFrame, pitch, amplitude]]
  function notesOf(frames, onsets, T, opts) {
    opts = opts || {};
    var B = 88, onsetThresh = opts.onset != null ? opts.onset : 0.5, frameThresh = opts.frame != null ? opts.frame : 0.3;
    var minLen = opts.minLen != null ? opts.minLen : Math.round(MIN_NOTE_MS / 1000 * (SR / HOP));
    var melodia = opts.melodia !== false, t, f;
    var fr = Float64Array.from(frames.subarray(0, T * B)), on = Float64Array.from(onsets.subarray(0, T * B));
    if (opts.minFreq) { var lo = Math.round(hzToMidi(opts.minFreq) - MIDI_OFFSET); for (t = 0; t < T; t++) for (f = 0; f < Math.min(B, lo); f++) { fr[t * B + f] = 0; on[t * B + f] = 0; } }
    if (opts.maxFreq) { var hi = Math.round(hzToMidi(opts.maxFreq) - MIDI_OFFSET); for (t = 0; t < T; t++) for (f = Math.max(0, hi); f < B; f++) { fr[t * B + f] = 0; on[t * B + f] = 0; } }
    on = inferOnsets(on, fr, T, B);
    // peaks along time (scipy argrelmax, mode clip: an edge is never a peak)
    var peaks = [];
    for (t = 1; t < T - 1; t++) for (f = 0; f < B; f++) {
      var v = on[t * B + f];
      if (v > on[(t - 1) * B + f] && v > on[(t + 1) * B + f] && v >= onsetThresh) peaks.push([t, f]);
    }
    peaks.reverse();                    // backwards in time (numpy order reversed)
    var energy = Float64Array.from(fr), notes = [];
    function clear(a, b, fi) {
      for (var i = a; i < b; i++) {
        energy[i * B + fi] = 0;
        if (fi < MAX_FREQ_IDX) energy[i * B + fi + 1] = 0;
        if (fi > 0) energy[i * B + fi - 1] = 0;
      }
    }
    function mean(a, b, fi) { var s = 0; for (var i = a; i < b; i++) s += fr[i * B + fi]; return s / (b - a); }
    peaks.forEach(function (p) {
      var start = p[0], fi = p[1];
      if (start >= T - 1) return;
      var i = start + 1, k = 0;
      while (i < T - 1 && k < ENERGY_TOL) {
        if (energy[i * B + fi] < frameThresh) k++; else k = 0;
        i++;
      }
      i -= k;
      if (i - start <= minLen) return;
      clear(start, i, fi);
      notes.push([start, i, fi + MIDI_OFFSET, mean(start, i, fi)]);
    });
    if (melodia) {
      for (;;) {
        var best = -Infinity, bi = 0;
        for (t = 0; t < T * B; t++) if (energy[t] > best) { best = energy[t]; bi = t; }
        if (!(best > frameThresh)) break;
        var mid = Math.floor(bi / B), fq = bi % B;
        energy[bi] = 0;
        var j = mid + 1, kk = 0;
        while (j < T - 1 && kk < ENERGY_TOL) {
          if (energy[j * B + fq] < frameThresh) kk++; else kk = 0;
          energy[j * B + fq] = 0;
          if (fq < MAX_FREQ_IDX) energy[j * B + fq + 1] = 0;
          if (fq > 0) energy[j * B + fq - 1] = 0;
          j++;
        }
        var end = j - 1 - kk;
        j = mid - 1; kk = 0;
        while (j > 0 && kk < ENERGY_TOL) {
          if (energy[j * B + fq] < frameThresh) kk++; else kk = 0;
          energy[j * B + fq] = 0;
          if (fq < MAX_FREQ_IDX) energy[j * B + fq + 1] = 0;
          if (fq > 0) energy[j * B + fq - 1] = 0;
          j--;
        }
        var st = j + 1 + kk;
        if (end - st <= minLen) continue;
        notes.push([st, end, fq + MIDI_OFFSET, mean(st, end, fq)]);
      }
    }
    return notes;
  }
  function hzToMidi(hz) { return 12 * (Math.log2(hz) - Math.log2(440)) + 69; }
  // model_frames_to_time
  function frameTime(i) {
    var offset = (HOP / SR) * (ANNOT_FRAMES - N_SAMPLES / HOP) + 0.0018;
    return i * HOP / SR - offset * Math.floor(i / ANNOT_FRAMES);
  }

  // ---------- Notes for Studio ----------
  // raw notes → Studio notes [pitch, start, len, vel] (seconds), sorted.
  function toStudio(raw, opts) {
    opts = opts || {};
    var list = raw.map(function (n) {
      var s = frameTime(n[0]), e = frameTime(n[1]);
      return { p: n[2], s: s, e: e, a: n[3] };
    }).filter(function (n) { return n.e > n.s; });
    if (opts.kind === "melody") list = melody(list);
    var q = opts.quant && opts.bpm ? 60 / opts.bpm * 4 / opts.quant : 0;
    var out = list.map(function (n) {
      var s = n.s, e = n.e;
      if (q) { s = Math.round(s / q) * q; e = Math.max(s + q, Math.round(e / q) * q); }
      return [n.p, round4(Math.max(0, s)), round4(e - Math.max(0, s)), Math.max(1, Math.min(127, Math.round(127 * n.a)))];
    });
    out.sort(function (a, b) { return a[1] - b[1] || a[0] - b[0]; });
    return out;
  }
  // one note at a time: the strongest notes stay, a weaker note that
  // overlaps one of them goes
  function melody(list) {
    var kept = [];
    list.slice().sort(function (a, b) { return (b.a * (b.e - b.s)) - (a.a * (a.e - a.s)) || a.s - b.s; }).forEach(function (n) {
      for (var i = 0; i < kept.length; i++) if (n.s < kept[i].e - 1e-6 && kept[i].s < n.e - 1e-6) return;
      kept.push(n);
    });
    return kept;
  }
  function round4(x) { return Math.round(x * 1e4) / 1e4; }
  function thresholds(sens) { var s = SENS[sens] || SENS[3]; return { onset: s[0], frame: s[1] }; }

  var pure = { SR: SR, HOP: HOP, N_SAMPLES: N_SAMPLES, FPS: FPS, STEP: STEP, OVERLAP: OVERLAP, MAX_SEC: MAX_SEC,
               windows: windows, windowAt: windowAt, unwrap: unwrap, inferOnsets: inferOnsets, notesOf: notesOf,
               frameTime: frameTime, toStudio: toStudio, melody: melody, thresholds: thresholds, hzToMidi: hzToMidi };
  if (typeof module === "object" && module.exports) { module.exports = pure; return; }

  // ---------- Model (IndexedDB "oros-studio-ai", store "files") ----------
  var MIRROR = "https://koulaxizis.github.io/oros-models-vision/basic-pitch/";
  // basic-pitch/ of koulaxizis/oros-models-vision index.json (spotify/basic-pitch fa5997af…)
  var MODEL = { url: MIRROR + "nmp.onnx", size: 230444, sha: "2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec" };
  var KEY = "basicpitch";
  function err(code) { var e = new Error(code); e.code = code; return e; }
  function db() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open("oros-studio-ai", 1);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains("files")) d.createObjectStore("files");
        if (!d.objectStoreNames.contains("parts")) d.createObjectStore("parts");
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function idb(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction("files", mode), res, r = fn(t.objectStore("files"));
        if (r) r.onsuccess = function () { res = r.result; };
        t.oncomplete = function () { d.close(); resolve(res); };
        t.onerror = t.onabort = function () { d.close(); reject(t.error || new Error("idb")); };
      });
    });
  }
  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function ready() {
    return idb("readonly", function (s) { return s.get(KEY); }).then(function (r) { return !!(r && r.v === MODEL.sha); }, function () { return false; });
  }
  function model(signal) {
    return idb("readonly", function (s) { return s.get(KEY); }).catch(function () { return null; }).then(function (rec) {
      if (rec && rec.v === MODEL.sha && rec.blob instanceof Blob) return rec.blob.arrayBuffer();
      return fetch(MODEL.url, { cache: "no-cache", signal: signal }).then(function (r) {
        if (!r.ok) throw err("download");
        return r.arrayBuffer();
      }, function () { throw signal && signal.aborted ? err("cancelled") : err("download"); }).then(function (buf) {
        return crypto.subtle.digest("SHA-256", buf).then(function (h) {
          if (hex(h) !== MODEL.sha) throw err("hash");
          return idb("readwrite", function (s) { s.put({ v: MODEL.sha, blob: new Blob([buf]) }, KEY); })
            .catch(function () {}).then(function () { return buf; });
        });
      });
    });
  }
  function forget() { return idb("readwrite", function (s) { s.delete(KEY); }).catch(function () {}); }

  // An AudioBuffer → Float32Array, 22,050 Hz mono.
  function at22k(buf) {
    var n = Math.max(1, Math.round(buf.duration * SR));
    var OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    var oc = new OAC(1, n, SR), node = oc.createBufferSource();
    node.buffer = buf; node.connect(oc.destination); node.start(0);
    return oc.startRendering().then(function (r) { return r.getChannelData(0); });
  }

  // x: Float32Array 22,050 Hz mono. opts: { kind, sens, quant, bpm,
  // onProgress(f), signal } → Promise<[[pitch, start, len, vel]]> (seconds).
  // Error codes: download, hash, cancelled, long, engine, empty.
  function convert(x, opts) {
    opts = opts || {};
    if (x.length > MAX_SEC * SR) return Promise.reject(err("long"));
    var signal = opts.signal;
    return model(signal).then(function (buf) {
      return new Promise(function (resolve, reject) {
        var w;
        try { w = new Worker("tomidi.worker.js?v=" + (root.STUDIO_VER || "")); } catch (e) { reject(err("engine")); return; }
        var starts = windows(x.length), k = 0, notesOut = [], onsetsOut = [], framesPer = 0, done = false;
        function end(e, v) {
          if (done) return;
          done = true;
          try { w.terminate(); } catch (x2) {}
          if (e) reject(e); else resolve(v);
        }
        if (signal) signal.addEventListener("abort", function () { end(err("cancelled")); });
        function next() {
          if (k >= starts.length) return finish();
          var win = windowAt(x, starts[k]);
          w.postMessage({ type: "run", k: k, x: win }, [win.buffer]);
        }
        function finish() {
          var nt = unwrap(notesOut, framesPer, 88, x.length), on = unwrap(onsetsOut, framesPer, 88, x.length);
          var th = thresholds(opts.sens);
          var raw = notesOf(nt.data, on.data, nt.frames, { onset: th.onset, frame: th.frame });
          var out = toStudio(raw, opts);
          if (!out.length) return end(err("empty"));
          end(null, out);
        }
        w.onerror = function () { end(err("engine")); };
        w.onmessage = function (e) {
          var m = e.data || {};
          if (m.type === "ready") return next();
          if (m.type === "error") return end(err("engine"));
          if (m.type !== "done") return;
          framesPer = m.frames;
          notesOut[m.k] = m.note; onsetsOut[m.k] = m.onset;
          k++;
          if (opts.onProgress) opts.onProgress(Math.min(0.99, k / starts.length));
          next();
        };
        w.postMessage({ type: "init", model: buf }, [buf]);
      });
    });
  }

  root.StudioToMidi = Object.assign({}, pure, { MODEL: MODEL, ready: ready, forget: forget, at22k: at22k, convert: convert });
})(typeof window !== "undefined" ? window : this);
