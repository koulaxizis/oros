// ============================================================
// orOS Studio — stems.js: separate a song into vocals, drums, bass
// and the rest, on the device (v1.0.0, Studio wave S1).
// The model is Meta's Demucs v4 "htdemucs" (MIT), exported to ONNX by
// koulaxizis/oros-models-vision tools/export_demucs.py and served from
// that repository's GitHub Pages. The ONNX graph has no STFT: this file
// does the STFT and its inverse exactly as demucs does (the NumPy copy
// tools/demucs_spec.py there is checked against PyTorch), and splits a
// song exactly as demucs' apply_model (tools/demucs_ref.py): 7.8 s
// segments, 25% overlap, triangle weights, the whole track normalised
// by its mono mean and standard deviation.
//   - nothing is downloaded until the person asks: then the model
//     (~90 MB, checked against the SHA-256 below) and ONNX Runtime Web
//     (vendor/ort, ~11 MB) are kept in this app's IndexedDB
//     "oros-studio-ai" (never synced, never in the service worker's
//     precache), so it works offline from then on
//   - the work runs in 1 to 4 workers (studio/stems.worker.js), one
//     segment each at a time; ONNX Runtime has one thread per worker
//     because orOS is not cross-origin isolated
//   - every finished stretch of the song is kept in IndexedDB, so a
//     separation that was stopped (tab closed, Studio closed) goes on
//     from there the next time
// Pure steps (fft, spec, ispec, plan, chunk, weight, region, inst)
// are exported for the Node tests (tests/studio-stems.test.js).
// Exposes window.StudioStems (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var SR = 44100;
  var NFFT = 4096, HOP = 1024, BINS = 2048;
  var SEG = 343980;                       // int(7.8 * 44100): the model's segment
  var FRAMES = 336;                       // ceil(SEG / HOP)
  var OVERLAP = 0.25;
  var STRIDE = Math.floor((1 - OVERLAP) * SEG);
  var SOURCES = ["drums", "bass", "other", "vocals"];   // the model's order
  var MAX_SEC = 900;                      // 15 minutes at most per separation

  // ---------- FFT (radix 2, in place, size 4096) ----------
  var COS = new Float64Array(NFFT / 2), SIN = new Float64Array(NFFT / 2), REV = new Uint16Array(NFFT);
  (function () {
    for (var i = 0; i < NFFT / 2; i++) { COS[i] = Math.cos(2 * Math.PI * i / NFFT); SIN[i] = Math.sin(2 * Math.PI * i / NFFT); }
    var bits = 12;
    for (var j = 0; j < NFFT; j++) {
      var r = 0, v = j;
      for (var b = 0; b < bits; b++) { r = (r << 1) | (v & 1); v >>= 1; }
      REV[j] = r;
    }
  })();
  // sign -1: forward (e^-i), +1: inverse without the 1/N
  function fft(re, im, sign) {
    var n = NFFT, i, j, t;
    for (i = 0; i < n; i++) {
      j = REV[i];
      if (j > i) { t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (var size = 2; size <= n; size <<= 1) {
      var half = size >> 1, step = n / size;
      for (i = 0; i < n; i += size) {
        for (j = 0; j < half; j++) {
          var k = j * step, wr = COS[k], wi = sign * SIN[k];
          var a = i + j, b2 = a + half;
          var xr = re[b2] * wr - im[b2] * wi, xi = re[b2] * wi + im[b2] * wr;
          re[b2] = re[a] - xr; im[b2] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  }

  // torch.hann_window(4096) (periodic)
  var WIN = new Float64Array(NFFT);
  for (var wi0 = 0; wi0 < NFFT; wi0++) WIN[wi0] = 0.5 - 0.5 * Math.cos(2 * Math.PI * wi0 / NFFT);

  // numpy / torch "reflect" padding (the edge sample is not repeated)
  function reflect(x, l, r) {
    var n = x.length, out = new Float64Array(n + l + r), i;
    for (i = 0; i < out.length; i++) {
      var k = i - l;
      while (k < 0 || k >= n) { if (k < 0) k = -k; if (k >= n) k = 2 * (n - 1) - k; }
      out[i] = x[k];
    }
    return out;
  }

  // HTDemucs._spec for one channel of one segment (length SEG) →
  // re, im: Float64Array(BINS * FRAMES), [bin][frame]
  function spec(x) {
    var L = x.length, le = Math.ceil(L / HOP), pad = HOP / 2 * 3;
    var p = reflect(reflect(x, pad, pad + le * HOP - L), NFFT / 2, NFFT / 2);
    var re = new Float64Array(BINS * le), im = new Float64Array(BINS * le);
    var fr = new Float64Array(NFFT), fi = new Float64Array(NFFT), scale = 1 / Math.sqrt(NFFT);
    for (var t = 0; t < le; t++) {
      var start = (t + 2) * HOP;            // the first two frames are dropped
      for (var i = 0; i < NFFT; i++) { fr[i] = p[start + i] * WIN[i]; fi[i] = 0; }
      fft(fr, fi, -1);
      for (var f = 0; f < BINS; f++) { re[f * le + t] = fr[f] * scale; im[f * le + t] = fi[f] * scale; }
    }
    return { re: re, im: im, frames: le };
  }

  // The model's "mag" input [4, 2048, 336]: L re, L im, R re, R im
  function magOf(left, right) {
    var a = spec(left), b = spec(right), n = BINS * a.frames, out = new Float32Array(4 * n);
    out.set(a.re, 0); out.set(a.im, n); out.set(b.re, 2 * n); out.set(b.im, 3 * n);
    return out;
  }

  // window² envelope of the inverse STFT (all FRAMES + 4 frames count)
  var ENV = null;
  function envelope(total, frames) {
    var e = new Float64Array(total);
    for (var j = 0; j < frames; j++) for (var i = 0; i < NFFT; i++) e[j * HOP + i] += WIN[i] * WIN[i];
    return e;
  }

  // HTDemucs._ispec for one channel: re/im [bin][frame] (BINS × T) →
  // Float64Array(length). `add` (optional) is added in place and returned.
  function ispec(re, im, T, length, add) {
    var pad = HOP / 2 * 3, le = HOP * Math.ceil(length / HOP) + 2 * pad;
    var Tall = T + 4, full = (Tall - 1) * HOP + NFFT;
    if (!ENV || ENV.length !== full) ENV = envelope(full, Tall);
    var acc = new Float64Array(full);
    var fr = new Float64Array(NFFT), fi = new Float64Array(NFFT), scale = Math.sqrt(NFFT) / NFFT;
    for (var t = 0; t < T; t++) {
      fr[0] = re[t]; fi[0] = 0;                       // irfft ignores the DC imaginary part
      for (var f = 1; f < BINS; f++) {
        var r = re[f * T + t], q = im[f * T + t];
        fr[f] = r; fi[f] = q; fr[NFFT - f] = r; fi[NFFT - f] = -q;
      }
      fr[BINS] = 0; fi[BINS] = 0;                     // the Nyquist bin the model does not make
      fft(fr, fi, 1);
      var start = (t + 2) * HOP;
      for (var i = 0; i < NFFT; i++) acc[start + i] += fr[i] * scale * WIN[i];
    }
    var out = add || new Float64Array(length), off = NFFT / 2 + pad;
    for (var n = 0; n < length; n++) out[n] += acc[off + n] / ENV[off + n];
    return out;
  }

  // The model's outputs for one segment → [source][channel] Float64Array(SEG)
  function sourcesOf(specOut, waveOut) {
    var n = BINS * FRAMES, res = [];
    for (var s = 0; s < 4; s++) {
      var chans = [];
      for (var c = 0; c < 2; c++) {
        var base = (s * 4 + c * 2) * n;
        var w = new Float64Array(SEG), wbase = (s * 2 + c) * SEG;
        for (var i = 0; i < SEG; i++) w[i] = waveOut[wbase + i];
        chans.push(ispec(specOut.subarray(base, base + n), specOut.subarray(base + n, base + 2 * n), FRAMES, SEG, w));
      }
      res.push(chans);
    }
    return res;
  }

  // ---------- Splitting (demucs apply_model, split=True, shifts=0) ----------
  function plan(L) { var o = []; for (var off = 0; off < L; off += STRIDE) o.push(off); return o; }
  var WEIGHT = null;
  function weight() {
    if (WEIGHT) return WEIGHT;
    var w = new Float64Array(SEG), h = Math.floor(SEG / 2), i, max = 0;
    for (i = 0; i < h; i++) w[i] = i + 1;
    for (i = h; i < SEG; i++) w[i] = SEG - i;
    for (i = 0; i < SEG; i++) if (w[i] > max) max = w[i];
    for (i = 0; i < SEG; i++) w[i] /= max;
    return (WEIGHT = w);
  }
  // TensorChunk(mix, offset, SEG).padded(SEG) for one channel
  function chunk(x, offset) {
    var total = x.length, length = Math.min(total - offset, SEG), delta = SEG - length;
    var start = offset - Math.floor(delta / 2), out = new Float32Array(SEG);
    var cs = Math.max(0, start), ce = Math.min(total, start + SEG);
    out.set(x.subarray(cs, ce), cs - start);
    return { seg: out, length: length, delta: delta };
  }
  // mean and (unbiased) standard deviation of the mono mix
  function stats(left, right) {
    var n = left.length, sum = 0, i;
    for (i = 0; i < n; i++) sum += (left[i] + right[i]) / 2;
    var mean = sum / n, sq = 0;
    for (i = 0; i < n; i++) { var d = (left[i] + right[i]) / 2 - mean; sq += d * d; }
    return { mean: mean, std: Math.sqrt(sq / Math.max(1, n - 1)) + 1e-8 };
  }
  // A segment's result → its part of the song, center-trimmed:
  // Float32Array(4 * 2 * length), [source][channel][sample]
  function trimmed(srcs, length, delta) {
    var a = Math.floor(delta / 2), out = new Float32Array(8 * length);
    for (var s = 0; s < 4; s++) for (var c = 0; c < 2; c++) {
      var x = srcs[s][c], base = (s * 2 + c) * length;
      for (var i = 0; i < length; i++) out[base + i] = x[a + i];
    }
    return out;
  }
  // Region k = [offsets[k], offsets[k + 1]) (or to the end) is final once
  // segments k - 1 and k are done: no other segment reaches it.
  // got: { k: { data, length } } (trimmed results). → Float32Array
  // (8 * regionLength), de-normalised with the track's mean and std.
  function region(k, offsets, L, got, st) {
    var a = offsets[k], b = k + 1 < offsets.length ? offsets[k + 1] : L, n = b - a;
    var w = weight(), cur = got[k], prev = k > 0 ? got[k - 1] : null, out = new Float32Array(8 * n);
    var po = k > 0 ? offsets[k - 1] : 0;
    for (var i = 0; i < n; i++) {
      var pos = a + i, wc = i < cur.length ? w[i] : 0, wp = 0, j = pos - po;
      if (prev && j < prev.length) wp = w[j];
      var sw = wc + wp;
      for (var r = 0; r < 8; r++) {
        var v = (i < cur.length ? wc * cur.data[r * cur.length + i] : 0) + (wp ? wp * prev.data[r * prev.length + j] : 0);
        out[r * n + i] = v / sw * st.std + st.mean;
      }
    }
    return out;
  }
  // 4 stems [source][channel] → 2 stems: vocals and the rest ("inst")
  function inst(parts) {
    var n = parts[0][0].length, o = [new Float32Array(n), new Float32Array(n)];
    for (var c = 0; c < 2; c++) for (var i = 0; i < n; i++) o[c][i] = parts[0][c][i] + parts[1][c][i] + parts[2][c][i];
    return o;
  }

  var pure = {
    SR: SR, SEG: SEG, FRAMES: FRAMES, BINS: BINS, NFFT: NFFT, HOP: HOP, STRIDE: STRIDE, OVERLAP: OVERLAP,
    SOURCES: SOURCES, MAX_SEC: MAX_SEC,
    fft: fft, reflect: reflect, spec: spec, magOf: magOf, ispec: ispec, sourcesOf: sourcesOf,
    plan: plan, weight: weight, chunk: chunk, stats: stats, trimmed: trimmed, region: region, inst: inst
  };
  if (typeof module !== "undefined" && module.exports) { module.exports = pure; return; }
  // inside the worker only the pure steps are needed
  if (typeof document === "undefined") { root.StudioStems = pure; return; }

  // ---------- Files (IndexedDB "oros-studio-ai") ----------
  var MIRROR = "https://koulaxizis.github.io/oros-models-vision/demucs/";
  // demucs/export.json of koulaxizis/oros-models-vision (checkpoint 8726e21a…, checked 52-84 dB against demucs)
  var MODEL = { url: MIRROR + "htdemucs.onnx", size: 90561712, sha: "621c14f9c9d3d275475955d0caf7f1e5c001dc30a3e40da79df7286a1b82ca13" };
  var ORT_V = "ort1.22.0";
  var FILES = {
    js:   { url: "../vendor/ort/ort.wasm.min.js", v: ORT_V },
    mjs:  { url: "../vendor/ort/ort-wasm-simd-threaded.mjs", v: ORT_V },
    wasm: { url: "../vendor/ort/ort-wasm-simd-threaded.wasm", v: ORT_V },
    model: null                                    // set from MODEL in files()
  };
  var APPROX_MB = Math.round((MODEL.size || 90237721) / 1048576) + 11;
  var DB_NAME = "oros-studio-ai";
  var dbP = null;
  function db() {
    if (!dbP) {
      dbP = new Promise(function (resolve, reject) {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
          var d = req.result;
          if (!d.objectStoreNames.contains("files")) d.createObjectStore("files");
          if (!d.objectStoreNames.contains("parts")) d.createObjectStore("parts");
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
        t.onerror = t.onabort = function () { reject(t.error || new Error("idb")); };
      });
    });
  }
  function stored(name) {
    return tx("files", "readonly", function (s) { return s.get(name); }).then(function (rec) {
      return rec && FILES[name] && rec.v === FILES[name].v && rec.blob instanceof Blob ? rec.blob : null;
    }, function () { return null; });
  }
  function ready() {
    FILES.model = { url: MODEL.url, v: MODEL.sha, sha: MODEL.sha };
    return Promise.all(Object.keys(FILES).map(stored)).then(function (l) { return l.every(Boolean); }, function () { return false; });
  }
  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function err(code) { var e = new Error(code); e.code = code; return e; }
  function fetchFile(url, onBytes, signal) {
    return fetch(url, { cache: "no-cache", signal: signal }).then(function (res) {
      if (!res.ok) throw err("download");
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
    }, function (e) { throw signal && signal.aborted ? err("cancelled") : err("download"); });
  }
  // → { js, mjs, wasm, model } Blobs; onProgress(0..1) while downloading
  function files(onProgress, signal) {
    if (!MODEL.sha) return Promise.reject(err("unavailable"));
    FILES.model = { url: MODEL.url, v: MODEL.sha, sha: MODEL.sha };
    var got = {}, done = 0, total = APPROX_MB * 1048576;
    return Object.keys(FILES).reduce(function (p, name) {
      return p.then(function () {
        return stored(name).then(function (b) {
          if (b) { got[name] = b; return; }
          return fetchFile(FILES[name].url, function (n) {
            done += n;
            if (onProgress) onProgress(Math.min(0.99, done / total));
          }, signal).then(function (blob) {
            var check = FILES[name].sha
              ? blob.arrayBuffer().then(function (buf) { return crypto.subtle.digest("SHA-256", buf); }).then(function (h) {
                if (hex(h) !== FILES[name].sha) throw err("hash");
              })
              : Promise.resolve();
            return check.then(function () {
              got[name] = blob;
              return tx("files", "readwrite", function (s) { s.put({ v: FILES[name].v, blob: blob }, name); })
                .catch(function () { throw err("quota"); });
            });
          });
        });
      });
    }, Promise.resolve()).then(function () { if (onProgress) onProgress(1); return got; });
  }
  // Removes the model, the runtime copy and any unfinished separation.
  function forget() {
    return Promise.all([
      tx("files", "readwrite", function (s) { s.clear(); }),
      tx("parts", "readwrite", function (s) { s.clear(); })
    ]).catch(function () {});
  }

  // ---------- How many workers ----------
  function phone() {
    try { return matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 820; } catch (e) { return false; }
  }
  function workerCount() {
    var cores = navigator.hardwareConcurrency || 2, mem = navigator.deviceMemory || 4;
    if (phone() || mem < 4) return 1;
    return Math.max(1, Math.min(4, cores - 1, Math.floor(mem / 2)));
  }

  // ---------- Unfinished separations (parts store) ----------
  // key "<job>|<k>" → { v: 1, n: region length, data: Float32Array(8 * n) }
  function partKey(job, k) { return job + "|" + k; }
  function partsDone(job, count) {
    return tx("parts", "readonly", function (s) { return s.getAllKeys(); }).then(function (keys) {
      var done = {};
      (keys || []).forEach(function (key) {
        var i = String(key).lastIndexOf("|");
        if (String(key).slice(0, i) === job) done[+String(key).slice(i + 1)] = true;
      });
      for (var k = 0; k < count && done[k]; k++);
      return k;                                   // the first region still to do
    }, function () { return 0; });
  }
  function dropJob(job) {
    return tx("parts", "readwrite", function (s) {
      var r = s.openCursor();
      r.onsuccess = function () {
        var c = r.result;
        if (!c) return;
        if (String(c.key).slice(0, String(c.key).lastIndexOf("|")) === job) c.delete();
        c.continue();
      };
    }).catch(function () {});
  }
  // Is a separation of this job half done? → share done (0..1) or 0
  function pending(job, seconds) {
    var count = plan(Math.round(seconds * SR)).length;
    return partsDone(job, count).then(function (k) { return k > 0 && k < count ? k / count : 0; });
  }

  // ---------- Separation ----------
  // left, right: Float32Array at 44.1 kHz (the same array twice for mono).
  // opts: { job (a stable id: the same source again goes on where it
  //   stopped), onDownload(f), onProgress(f, secondsLeft|null), signal }
  // → Promise<{ drums, bass, other, vocals: [Float32Array L, Float32Array R] }>
  // Error codes: unavailable, download, hash, quota, cancelled, long, engine, memory.
  function separate(left, right, opts) {
    opts = opts || {};
    var L = left.length;
    if (L > MAX_SEC * SR) return Promise.reject(err("long"));
    if (!L) return Promise.reject(err("engine"));
    var signal = opts.signal, job = opts.job || ("j" + Date.now());
    var offsets = plan(L), count = offsets.length;
    var st = stats(left, right);
    var norm = [new Float32Array(L), new Float32Array(L)];
    for (var i = 0; i < L; i++) { norm[0][i] = (left[i] - st.mean) / st.std; norm[1][i] = (right[i] - st.mean) / st.std; }

    return files(opts.onDownload, signal).then(function (f) {
      return partsDone(job, count).then(function (first) { return run(f, first); });
    });

    function run(f, first) {
      return new Promise(function (resolve, reject) {
        var urls = {
          js: URL.createObjectURL(new Blob([f.js], { type: "text/javascript" })),
          mjs: URL.createObjectURL(new Blob([f.mjs], { type: "text/javascript" })),
          wasm: URL.createObjectURL(new Blob([f.wasm], { type: "application/wasm" }))
        };
        var startSeg = Math.max(0, first - 1), next = startSeg, got = {}, written = first, inFlight = 0;
        var workers = [], finished = false, t0 = 0, segDone = 0, segTotal = count - startSeg;
        var n = Math.min(workerCount(), segTotal);
        function stop(e) {
          if (finished) return;
          finished = true;
          workers.forEach(function (w) { try { w.terminate(); } catch (x) {} });
          Object.keys(urls).forEach(function (k) { URL.revokeObjectURL(urls[k]); });
          if (e) reject(e);
        }
        if (signal) {
          if (signal.aborted) return stop(err("cancelled"));
          signal.addEventListener("abort", function () { stop(err("cancelled")); });
        }
        function progress() {
          if (!opts.onProgress) return;
          var frac = (startSeg + segDone) / count;
          var secs = (Date.now() - t0) / 1000, rest = segDone ? secs / segDone * (segTotal - segDone) : null;   // workers run side by side: done/second already counts them
          opts.onProgress(Math.min(0.99, frac), rest == null ? null : Math.round(rest));
        }
        function give(w) {
          if (finished || next >= count) return;
          var k = next++, a = chunk(norm[0], offsets[k]), b = chunk(norm[1], offsets[k]);
          inFlight++;
          w.postMessage({ type: "run", k: k, left: a.seg, right: b.seg, length: a.length, delta: a.delta }, [a.seg.buffer, b.seg.buffer]);
        }
        // write every region whose two segments are in; drop what no region needs
        function flush() {
          var chain = Promise.resolve();
          while (written < count && got[written] && (written === 0 || got[written - 1])) {
            var k = written, data = region(k, offsets, L, got, st);
            (function (k, data) {
              chain = chain.then(function () {
                return tx("parts", "readwrite", function (s) { s.put({ v: 1, n: data.length / 8, data: data }, partKey(job, k)); });
              });
            })(k, data);
            if (k > 0) delete got[k - 1];
            written++;
          }
          return chain;
        }
        var writing = Promise.resolve();
        function onResult(w, e) {
          var m = e.data || {};
          if (finished) return;
          if (m.type === "ready") { give(w); return; }
          if (m.type === "error") { stop(err(m.code === "memory" ? "memory" : "engine")); return; }
          if (m.type !== "done") return;
          inFlight--; segDone++;
          got[m.k] = { data: m.out, length: m.length };
          writing = writing.then(flush).catch(function () { stop(err("quota")); });
          progress();
          if (next < count) give(w);
          else if (!inFlight) writing.then(function () { if (!finished) assemble(); });
        }
        function assemble() {
          finished = true;
          workers.forEach(function (w) { try { w.terminate(); } catch (x) {} });
          Object.keys(urls).forEach(function (k) { URL.revokeObjectURL(urls[k]); });
          var out = {};
          SOURCES.forEach(function (s) { out[s] = [new Float32Array(L), new Float32Array(L)]; });
          var k = 0;
          function step() {
            if (k >= count) { dropJob(job); return resolve(out); }
            return tx("parts", "readonly", function (s) { return s.get(partKey(job, k)); }).then(function (rec) {
              if (!rec) throw err("engine");
              var n = rec.n, at = offsets[k];
              for (var s = 0; s < 4; s++) for (var c = 0; c < 2; c++) {
                out[SOURCES[s]][c].set(rec.data.subarray((s * 2 + c) * n, (s * 2 + c + 1) * n), at);
              }
              k++;
              return step();
            });
          }
          step().catch(function (e) { reject(e.code ? e : err("engine")); });
        }
        if (first >= count) { assemble(); return; }
        t0 = Date.now();
        for (var wi = 0; wi < n; wi++) {
          var w;
          try { w = new Worker("stems.worker.js?v=" + (root.STUDIO_VER || "")); } catch (e) { return stop(err("engine")); }
          w.onmessage = onResult.bind(null, w);
          w.onerror = function () { stop(err("engine")); };
          w.postMessage({ type: "init", urls: urls, model: f.model });
          workers.push(w);
        }
      });
    }
  }

  root.StudioStems = Object.assign({}, pure, {
    MODEL: MODEL, APPROX_MB: APPROX_MB, ready: ready, files: files, forget: forget,
    workerCount: workerCount, phone: phone, pending: pending, dropJob: dropJob, separate: separate
  });
})(typeof window !== "undefined" ? window : this);
