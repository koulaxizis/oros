// ============================================================
// orOS Montage — automatic subtitles: speech to text on the device
// with OpenAI's Whisper "tiny" model (MIT; ONNX export by Xenova for
// transformers.js, Apache-2.0) in ONNX Runtime Web (MIT, vendor/ort/,
// the same WebAssembly runtime Atelier uses). No library around it:
// the sound → log-mel picture, the greedy decoding with Whisper's
// timestamp rules and the byte-level BPE text are written here.
//   - nothing is downloaded until the user asks: then the runtime
//     (vendor/ort, this site) and the model (Hugging Face, about 42 MB)
//     are fetched once and kept in IndexedDB "oros-montage-ai", so it
//     works offline from then on; "Remove the speech model" deletes them
//   - the sound never leaves the device
//   MontageASR.ready() → Promise<bool> (model on this device?)
//   MontageASR.run(samples16k, { lang: "auto"|"en"|"el"|…, progress(f, stage),
//     cancelled() }) → Promise<{ lang, cues: [{ start, end, text }] }>
// The pure steps (melFilters, logMel, decimate, applyTimestampRules,
// segmentsFrom, decodeText, splitCue) are unit-tested in node.
// UMD: module.exports in Node, window.MontageASR in the browser.
// ============================================================
(function (root) {
  "use strict";

  var SR = 16000, N_FFT = 400, HOP = 160, N_MELS = 80, N_FRAMES = 3000, CHUNK = 30;
  var LAYERS = 4, HEADS = 6, HEAD_DIM = 64;           // whisper-tiny
  var EOT = 50257, SOT = 50258, TRANSCRIBE = 50359, NO_TS = 50363, TS0 = 50364, TS_STEP = 0.02;
  var MAX_TOKENS = 224, MAX_INITIAL_TS = 1;
  var HF = "https://huggingface.co/Xenova/whisper-tiny/resolve/main/";
  var FILES = {
    js:   "../vendor/ort/ort.wasm.min.js",
    mjs:  "../vendor/ort/ort-wasm-simd-threaded.mjs",
    wasm: "../vendor/ort/ort-wasm-simd-threaded.wasm",
    enc:  HF + "onnx/encoder_model_quantized.onnx",
    dec:  HF + "onnx/decoder_model_merged_quantized.onnx",
    vocab: HF + "vocab.json",
    gen:  HF + "generation_config.json"
  };
  var FILES_VER = "ort1.22.0-whisper-tiny-q8";
  var MODEL_MB = 42, RUNTIME_MB = 11;

  // ---------- Sound → log-mel ----------
  // librosa's mel filter bank (Slaney scale and norm), as Whisper uses:
  // n_mels rows of n_fft / 2 + 1 weights.
  function hzToMel(f) { return f < 1000 ? f * 3 / 200 : 15 + Math.log(f / 1000) / (Math.log(6.4) / 27); }
  function melToHz(m) { return m < 15 ? m * 200 / 3 : 1000 * Math.exp((m - 15) * (Math.log(6.4) / 27)); }
  function melFilters(sr, nFft, nMels) {
    sr = sr || SR; nFft = nFft || N_FFT; nMels = nMels || N_MELS;
    var nb = Math.floor(nFft / 2) + 1, fft = [], mel = [], i, j;
    for (i = 0; i < nb; i++) fft.push(i * sr / nFft);
    var lo = hzToMel(0), hi = hzToMel(sr / 2);
    for (i = 0; i < nMels + 2; i++) mel.push(melToHz(lo + (hi - lo) * i / (nMels + 1)));
    var out = new Float32Array(nMels * nb);
    for (i = 0; i < nMels; i++) {
      var en = 2 / (mel[i + 2] - mel[i]);
      for (j = 0; j < nb; j++) {
        var lower = (fft[j] - mel[i]) / (mel[i + 1] - mel[i]), upper = (mel[i + 2] - fft[j]) / (mel[i + 2] - mel[i + 1]);
        out[i * nb + j] = Math.max(0, Math.min(lower, upper)) * en;
      }
    }
    return out;
  }
  var tables = null;
  function dftTables() {
    if (tables) return tables;
    var nb = N_FFT / 2 + 1, cos = new Float32Array(nb * N_FFT), sin = new Float32Array(nb * N_FFT), win = new Float32Array(N_FFT);
    for (var n = 0; n < N_FFT; n++) win[n] = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / N_FFT);   // periodic Hann
    for (var k = 0; k < nb; k++) for (var m = 0; m < N_FFT; m++) {
      var a = 2 * Math.PI * k * m / N_FFT;
      cos[k * N_FFT + m] = Math.cos(a); sin[k * N_FFT + m] = Math.sin(a);
    }
    tables = { cos: cos, sin: sin, win: win, mel: melFilters() };
    return tables;
  }
  // 16 kHz samples (at most 30 s; padded with silence) → the model's
  // input: N_MELS × N_FRAMES floats, row by row, like Whisper's
  // log_mel_spectrogram (centred STFT with reflect padding, power,
  // mel, log10, floor at max − 8, (x + 4) / 4).
  function logMel(samples) {
    var T = dftTables(), nb = N_FFT / 2 + 1, total = SR * CHUNK, pad = N_FFT / 2;
    var x = new Float32Array(total);
    x.set(samples.length > total ? samples.subarray(0, total) : samples);
    var used = Math.min(samples.length, total);
    var at = function (i) {                               // reflect padding
      if (i < 0) i = -i;
      if (i >= total) i = 2 * (total - 1) - i;
      return x[i];
    };
    var spec = new Float32Array(N_MELS * N_FRAMES), frame = new Float32Array(N_FFT), pw = new Float32Array(nb), max = -Infinity;
    for (var f = 0; f < N_FRAMES; f++) {
      var start = f * HOP - pad, silent = start > used + 1, i;
      if (!silent) {
        for (i = 0; i < N_FFT; i++) frame[i] = at(start + i) * T.win[i];
        for (var k = 0; k < nb; k++) {
          var re = 0, im = 0, o = k * N_FFT;
          for (i = 0; i < N_FFT; i++) { re += frame[i] * T.cos[o + i]; im -= frame[i] * T.sin[o + i]; }
          pw[k] = re * re + im * im;
        }
      }
      for (var mI = 0; mI < N_MELS; mI++) {
        var s = 0;
        if (!silent) for (var b = 0; b < nb; b++) s += T.mel[mI * nb + b] * pw[b];
        var v = Math.log(Math.max(s, 1e-10)) / Math.LN10;
        spec[mI * N_FRAMES + f] = v;
        if (v > max) max = v;
      }
    }
    for (var q = 0; q < spec.length; q++) spec[q] = (Math.max(spec[q], max - 8) + 4) / 4;
    return spec;
  }
  // 48 kHz → 16 kHz: low-pass (windowed sinc, 7.2 kHz) and keep every
  // third sample.
  var FIR = null;
  function decimate3(x) {
    if (!FIR) {
      FIR = new Float32Array(63);
      var s = 0, c = 7200 / 48000;
      for (var i = 0; i < 63; i++) {
        var n = i - 31, w = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / 62) + 0.08 * Math.cos(4 * Math.PI * i / 62);
        FIR[i] = (n === 0 ? 2 * c : Math.sin(2 * Math.PI * c * n) / (Math.PI * n)) * w;
        s += FIR[i];
      }
      for (var j = 0; j < 63; j++) FIR[j] /= s;
    }
    var out = new Float32Array(Math.floor(x.length / 3));
    for (var o = 0; o < out.length; o++) {
      var acc = 0, c0 = o * 3;
      for (var t = 0; t < 63; t++) { var idx = c0 + t - 31; if (idx >= 0 && idx < x.length) acc += FIR[t] * x[idx]; }
      out[o] = acc;
    }
    return out;
  }

  // ---------- Decoding ----------
  // Whisper's rules for timestamp tokens, applied to one step's logits
  // (Float32Array over the vocabulary, changed in place); seq = tokens
  // sampled so far in this window (after the prompt).
  function applyTimestampRules(logits, seq, suppress, beginSuppress) {
    var V = logits.length, NEG = -Infinity, i;
    (suppress || []).forEach(function (id) { if (id < V) logits[id] = NEG; });
    logits[NO_TS] = NEG;
    if (!seq.length) (beginSuppress || []).forEach(function (id) { if (id < V) logits[id] = NEG; });
    var last = seq.length >= 1 && seq[seq.length - 1] >= TS0;
    var penult = seq.length < 2 || seq[seq.length - 2] >= TS0;
    if (last) {
      if (penult) for (i = TS0; i < V; i++) logits[i] = NEG;      // after a pair: text (or the end)
      else for (i = 0; i < EOT; i++) logits[i] = NEG;              // after text + one stamp: a stamp or the end
    }
    var stamps = seq.filter(function (t) { return t >= TS0; });
    if (stamps.length) {
      var lastTs = stamps[stamps.length - 1], upto = last && !penult ? lastTs : lastTs + 1;
      for (i = TS0; i < upto && i < V; i++) logits[i] = NEG;      // time never runs back
    }
    if (!seq.length) {
      for (i = 0; i < TS0; i++) logits[i] = NEG;                   // a window starts with a stamp
      for (i = TS0 + MAX_INITIAL_TS + 1; i < V; i++) logits[i] = NEG;
    }
    // a stamp wins when all stamps together are likelier than the best text token
    var m = NEG;
    for (i = 0; i < V; i++) if (logits[i] > m) m = logits[i];
    if (m === NEG) return logits;
    var sum = 0;
    for (i = 0; i < V; i++) if (logits[i] > NEG) sum += Math.exp(logits[i] - m);
    var lse = m + Math.log(sum), tsSum = 0, textMax = NEG;
    for (i = TS0; i < V; i++) if (logits[i] > NEG) tsSum += Math.exp(logits[i] - m);
    for (i = 0; i < TS0; i++) if (logits[i] > textMax) textMax = logits[i];
    if (tsSum > 0 && m + Math.log(tsSum) - lse > textMax - lse) for (i = 0; i < TS0; i++) logits[i] = NEG;
    return logits;
  }
  // The tokens of one window → segments [{ t0, t1, ids }] (seconds into
  // the window) and how far the window was used (seconds).
  function segmentsFrom(tokens, winLen) {
    var isTs = tokens.map(function (t) { return t >= TS0; }), segs = [];
    var single = isTs.length >= 2 && !isTs[isTs.length - 2] && isTs[isTs.length - 1];
    var cuts = [];
    for (var i = 1; i < tokens.length; i++) if (isTs[i] && isTs[i - 1]) cuts.push(i);
    var tsOf = function (t) { return (t - TS0) * TS_STEP; };
    if (cuts.length) {
      if (single) cuts.push(tokens.length);
      var from = 0;
      cuts.forEach(function (c) {
        var part = tokens.slice(from, c);
        if (part.length >= 2 && part[0] >= TS0 && part[part.length - 1] >= TS0) {
          segs.push({ t0: tsOf(part[0]), t1: tsOf(part[part.length - 1]), ids: part.slice(1, -1).filter(function (t) { return t < EOT; }) });
        }
        from = c;
      });
      var advance = single ? winLen : tsOf(tokens[cuts[cuts.length - 1] - 1]);
      return { segs: segs, advance: Math.max(advance, 0.5) };
    }
    var stamps = tokens.filter(function (t) { return t >= TS0; });
    var ids = tokens.filter(function (t) { return t < EOT; });
    if (ids.length) {
      var t1 = stamps.length && tsOf(stamps[stamps.length - 1]) > (stamps.length > 1 ? tsOf(stamps[0]) : 0) ? tsOf(stamps[stamps.length - 1]) : winLen;
      segs.push({ t0: stamps.length ? tsOf(stamps[0]) : 0, t1: t1, ids: ids });
    }
    return { segs: segs, advance: winLen };
  }
  // GPT-2 byte-level BPE: token text → bytes → UTF-8.
  var BYTE_OF = null;
  function byteMap() {
    if (BYTE_OF) return BYTE_OF;
    var bs = [], i;
    for (i = 33; i <= 126; i++) bs.push(i);
    for (i = 161; i <= 172; i++) bs.push(i);
    for (i = 174; i <= 255; i++) bs.push(i);
    var cs = bs.slice(), n = 0;
    for (i = 0; i < 256; i++) if (bs.indexOf(i) < 0) { bs.push(i); cs.push(256 + n); n++; }
    BYTE_OF = {};
    bs.forEach(function (b, k) { BYTE_OF[String.fromCharCode(cs[k])] = b; });
    return BYTE_OF;
  }
  function utf8(bytes) {
    var out = "", i = 0;
    while (i < bytes.length) {
      var b = bytes[i], cp, need;
      if (b < 0x80) { cp = b; need = 0; } else if (b >= 0xc0 && b < 0xe0) { cp = b & 31; need = 1; }
      else if (b >= 0xe0 && b < 0xf0) { cp = b & 15; need = 2; } else if (b >= 0xf0 && b < 0xf8) { cp = b & 7; need = 3; }
      else { i++; continue; }                         // a stray byte (a token cut mid-letter): dropped
      if (i + need >= bytes.length) break;           // a letter cut at the end: dropped
      var ok = true;
      for (var k = 1; k <= need; k++) { if ((bytes[i + k] & 0xc0) !== 0x80) { ok = false; break; } cp = (cp << 6) | (bytes[i + k] & 63); }
      if (!ok) { i++; continue; }
      out += String.fromCodePoint(cp);
      i += need + 1;
    }
    return out;
  }
  // token ids → text (vocabInv: id → token string)
  function decodeText(ids, vocabInv) {
    var map = byteMap(), bytes = [];
    ids.forEach(function (id) {
      var s = vocabInv[id];
      if (typeof s !== "string" || /^<\|.*\|>$/.test(s)) return;
      for (var i = 0; i < s.length; i++) { var b = map[s[i]]; if (b !== undefined) bytes.push(b); }
    });
    return utf8(bytes).replace(/\s+/g, " ").trim();
  }
  // A long line → pieces of at most maxChars (by words), the time
  // shared by length.
  function splitCue(c, maxChars) {
    maxChars = maxChars || 84;
    if (c.text.length <= maxChars) return [c];
    var words = c.text.split(" "), parts = [], cur = "";
    words.forEach(function (w) {
      if (cur && (cur + " " + w).length > maxChars) { parts.push(cur); cur = w; } else cur = cur ? cur + " " + w : w;
    });
    if (cur) parts.push(cur);
    var total = parts.reduce(function (n, p) { return n + p.length; }, 0), t = c.start, out = [];
    parts.forEach(function (p, i) {
      var end = i === parts.length - 1 ? c.end : t + (c.end - c.start) * p.length / total;
      out.push({ start: Math.round(t * 1000) / 1000, end: Math.round(end * 1000) / 1000, text: p });
      t = end;
    });
    return out;
  }

  // Transcribe 16 kHz samples with loaded models:
  //   m = { ort, enc, dec (InferenceSessions), vocabInv, gen (generation_config) }
  // → { lang, cues }. Works in node (onnxruntime-node) and the browser.
  async function transcribe(m, samples, opts) {
    opts = opts || {};
    var progress = opts.progress || function () {}, cancelled = opts.cancelled || function () { return false; };
    var T = m.ort.Tensor, gen = m.gen || {}, langIds = gen.lang_to_id || {};
    var suppress = Array.isArray(gen.suppress_tokens) ? gen.suppress_tokens : [];
    var beginSuppress = Array.isArray(gen.begin_suppress_tokens) ? gen.begin_suppress_tokens : [220, EOT];
    var total = samples.length / SR, seek = 0, cues = [], lang = opts.lang && opts.lang !== "auto" ? opts.lang : null;
    var emptyPast = function () { return new T("float32", new Float32Array(0), [1, HEADS, 0, HEAD_DIM]); };
    while (seek < total - 0.2) {
      if (cancelled()) throw new Error("cancelled");
      var a = Math.floor(seek * SR), win = samples.subarray(a, Math.min(samples.length, a + SR * CHUNK)), winLen = win.length / SR;
      progress(seek / total, "listen");
      // a quiet window is skipped whole
      var peak = 0;
      for (var pi = 0; pi < win.length; pi++) if (Math.abs(win[pi]) > peak) peak = Math.abs(win[pi]);
      if (peak < 0.003) { seek += winLen; continue; }
      await pause();
      var mel = logMel(win);
      var encOut = await m.enc.run({ input_features: new T("float32", mel, [1, N_MELS, N_FRAMES]) });
      var hidden = encOut.last_hidden_state;
      // the language: given, or the likeliest language token after SOT
      if (!lang) {
        var lo = await m.dec.run(decFeeds(T, [SOT], hidden, null, emptyPast));
        var lg = lo.logits.data, best = -Infinity;
        Object.keys(langIds).forEach(function (k) { var id = langIds[k]; if (lg[id] > best) { best = lg[id]; lang = k.replace(/[<|>]/g, ""); } });
        lang = lang || "en";
      }
      var langTok = langIds["<|" + lang + "|>"] || langIds["<|en|>"] || 50259;
      var prompt = [SOT, langTok, TRANSCRIBE], seq = [], past = null, input = prompt;
      while (seq.length < MAX_TOKENS) {
        if (cancelled()) throw new Error("cancelled");
        var out = await m.dec.run(decFeeds(T, input, hidden, past, emptyPast));
        var V = out.logits.dims[2], n = out.logits.dims[1];
        var logits = Float32Array.from(out.logits.data.subarray((n - 1) * V, n * V));
        applyTimestampRules(logits, seq, suppress, beginSuppress);
        var tok = 0, bv = -Infinity;
        for (var i = 0; i < V; i++) if (logits[i] > bv) { bv = logits[i]; tok = i; }
        if (tok === EOT || bv === -Infinity) break;
        seq.push(tok);
        past = presents(out, past);
        input = [tok];
        if (seq.length % 8 === 0) progress(Math.min(0.99, (seek + Math.min(winLen, lastStamp(seq))) / total), "write");
      }
      var r = segmentsFrom(seq, winLen);
      r.segs.forEach(function (s) {
        var text = decodeText(s.ids, m.vocabInv);
        if (!text || !(s.t1 > s.t0)) return;
        splitCue({ start: seek + s.t0, end: Math.min(total, seek + s.t1), text: text }, 84).forEach(function (c) { if (c.end - c.start >= 0.1) cues.push(c); });
      });
      seek += Math.min(winLen, r.advance);
    }
    progress(1, "write");
    return { lang: lang, cues: cues };
  }
  function lastStamp(seq) { for (var i = seq.length - 1; i >= 0; i--) if (seq[i] >= TS0) return (seq[i] - TS0) * TS_STEP; return 0; }
  function pause() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function decFeeds(T, ids, hidden, past, emptyPast) {
    var f = {
      input_ids: new T("int64", BigInt64Array.from(ids.map(function (x) { return BigInt(x); })), [1, ids.length]),
      encoder_hidden_states: hidden,
      use_cache_branch: new T("bool", [!!past], [1])
    };
    for (var l = 0; l < LAYERS; l++) ["decoder.key", "decoder.value", "encoder.key", "encoder.value"].forEach(function (k) {
      f["past_key_values." + l + "." + k] = past ? past[l + "." + k] : emptyPast();
    });
    return f;
  }
  // The cache for the next step: the new self-attention keys / values,
  // and the encoder ones from the first step (they never change).
  function presents(out, past) {
    var p = {};
    for (var l = 0; l < LAYERS; l++) {
      p[l + ".decoder.key"] = out["present." + l + ".decoder.key"];
      p[l + ".decoder.value"] = out["present." + l + ".decoder.value"];
      p[l + ".encoder.key"] = past ? past[l + ".encoder.key"] : out["present." + l + ".encoder.key"];
      p[l + ".encoder.value"] = past ? past[l + ".encoder.value"] : out["present." + l + ".encoder.value"];
    }
    return p;
  }
  function invertVocab(vocab) {
    var inv = [];
    Object.keys(vocab).forEach(function (k) { inv[vocab[k]] = k; });
    return inv;
  }

  var pure = {
    melFilters: melFilters, logMel: logMel, decimate3: decimate3, applyTimestampRules: applyTimestampRules,
    segmentsFrom: segmentsFrom, decodeText: decodeText, splitCue: splitCue, transcribe: transcribe, invertVocab: invertVocab,
    FILES: FILES, MODEL_MB: MODEL_MB, RUNTIME_MB: RUNTIME_MB, TS0: TS0, EOT: EOT
  };
  if (typeof module === "object" && module.exports) { module.exports = pure; return; }

  // ---------- Browser: files (IndexedDB) and runtime ----------
  var DB_NAME = "oros-montage-ai", dbP = null;
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
  function stored(name) {
    return tx("readonly", function (s) { return s.get(name); }).then(function (rec) {
      return rec && rec.v === FILES_VER && rec.blob instanceof Blob ? rec.blob : null;
    }, function () { return null; });
  }
  function ready() {
    return Promise.all(Object.keys(FILES).map(stored)).then(function (l) { return l.every(Boolean); }, function () { return false; });
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
  function files(onProgress, signal) {
    var names = Object.keys(FILES), got = {}, done = 0, total = (MODEL_MB + RUNTIME_MB) * 1024 * 1024;
    return names.reduce(function (p, name) {
      return p.then(function () {
        return stored(name).then(function (b) {
          if (b) { got[name] = b; return; }
          return fetchFile(FILES[name], function (n) { done += n; if (onProgress) onProgress(Math.min(0.99, done / total)); }, signal).then(function (blob) {
            got[name] = blob;
            return tx("readwrite", function (s) { s.put({ v: FILES_VER, blob: blob }, name); }).catch(function () {});
          });
        });
      });
    }, Promise.resolve()).then(function () { if (onProgress) onProgress(1); return got; });
  }
  function forget() { modelsP = null; return tx("readwrite", function (s) { s.clear(); }).catch(function () {}); }

  var modelsP = null;
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
  function models(onProgress, signal) {
    if (modelsP) return modelsP;
    modelsP = files(onProgress, signal).then(function (f) {
      return loadScript(f.js).then(function () {
        var ort = root.ort;
        if (!ort || !ort.InferenceSession) throw new Error("runtime");
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.proxy = false;
        ort.env.wasm.wasmPaths = {
          mjs: URL.createObjectURL(new Blob([f.mjs], { type: "text/javascript" })),
          wasm: URL.createObjectURL(new Blob([f.wasm], { type: "application/wasm" }))
        };
        var mk = function (b) { return b.arrayBuffer().then(function (buf) { return ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ["wasm"] }); }); };
        return Promise.all([mk(f.enc), mk(f.dec), f.vocab.text(), f.gen.text()]).then(function (r) {
          return { ort: ort, enc: r[0], dec: r[1], vocabInv: invertVocab(JSON.parse(r[2])), gen: JSON.parse(r[3]) };
        });
      });
    });
    modelsP.catch(function () { modelsP = null; });
    return modelsP;
  }

  // samples: Float32Array at 16 kHz (decimate3 a 48 kHz mix first)
  function run(samples, opts) {
    opts = opts || {};
    var progress = opts.progress || function () {};
    return models(function (f) { progress(f, "download"); }, opts.signal).then(function (m) {
      return transcribe(m, samples, opts);
    });
  }

  root.MontageASR = {
    ready: ready, run: run, forget: forget, decimate3: decimate3, MODEL_MB: MODEL_MB, RUNTIME_MB: RUNTIME_MB,
    melFilters: melFilters, logMel: logMel, splitCue: splitCue
  };
})(typeof window !== "undefined" ? window : this);
