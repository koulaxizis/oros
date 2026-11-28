// ============================================================
// orOS — where someone speaks: Silero VAD v6.2 (MIT, Silero Team) on
// the device, in the ONNX Runtime Web that montage/asr.js already
// loads (vendor/ort). DICT-1.
//   - the model (2.3 MB, our unchanged copy in koulaxizis/oros-models-
//     vision, SHA-256 checked) is fetched only when a feature that
//     needs it is used, then kept in the same IndexedDB as the speech
//     model ("oros-montage-ai"); Montage's "Remove the speech model"
//     removes it too
//   - the sound never leaves the device
// Used by: Montage (Remove silences, and subtitles skip the silences),
// Notes (dictation, voice-note transcription), the Assistant (voice
// input stops by itself).
//   OrosVAD.probs(samples16k, { cancelled, progress(f) }) → Promise<Float32Array>
//     one speech probability per 32 ms frame (512 samples)
//   OrosVAD.speech(samples16k, opts) → Promise<[{ start, end }]> seconds
//   OrosVAD.stream(opts) → { ready, push(samples16k), flush(), speaking(), close() }
//     live use: calls opts.onStart(), opts.onPhrase(samples16k, start, end)
//     when a phrase ends (a pause), opts.onIdle(ms) on silence
// The pure steps (segments, silences, windows, Stepper) are unit-tested
// in node. Needs montage/asr.js (window.MontageASR) for the runtime.
// UMD: module.exports in Node, window.OrosVAD in the browser.
// ============================================================
(function (root) {
  "use strict";

  var SR = 16000, FRAME = 512, CTX = 64, FRAME_SEC = FRAME / SR;
  var FILE = {
    key: "vad", ver: "silero-vad-6.2",
    url: "https://koulaxizis.github.io/oros-models-vision/silero-vad/silero_vad.onnx",
    size: 2327524, sha: "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3"
  };
  var MB = 2.3;
  // Silero's own defaults (utils_vad.get_speech_timestamps)
  var DEF = { threshold: 0.5, minSpeech: 0.25, minSilence: 0.1, pad: 0.03 };

  function opt(o, k) { return o && typeof o[k] === "number" ? o[k] : DEF[k]; }

  // ---------- Probabilities → speech segments ----------
  // probs: one per FRAME samples; total: the number of samples.
  // As get_speech_timestamps: speech starts at a frame ≥ threshold, ends
  // after minSilence below threshold − 0.15; shorter than minSpeech is
  // dropped; each segment gets pad on both sides (half the gap each when
  // two are closer than 2 × pad). → [{ start, end }] in seconds.
  function segments(probs, total, o) {
    var thr = opt(o, "threshold"), neg = Math.max(0.01, thr - 0.15);
    var minSpeech = opt(o, "minSpeech") * SR, minSil = opt(o, "minSilence") * SR, pad = opt(o, "pad") * SR;
    var out = [], on = false, start = 0, tempEnd = 0;
    for (var i = 0; i < probs.length; i++) {
      var p = probs[i], at = i * FRAME;
      if (p >= thr && tempEnd) tempEnd = 0;
      if (p >= thr && !on) { on = true; start = at; continue; }
      if (p < neg && on) {
        if (!tempEnd) tempEnd = at;
        if (at - tempEnd < minSil) continue;
        if (tempEnd - start > minSpeech) out.push([start, tempEnd]);
        on = false; tempEnd = 0;
      }
    }
    if (on && total - start > minSpeech) out.push([start, total]);
    for (var k = 0; k < out.length; k++) {
      var s = out[k];
      if (k === 0) s[0] = Math.max(0, s[0] - pad);
      if (k < out.length - 1) {
        var gap = out[k + 1][0] - s[1];
        if (gap < 2 * pad) { s[1] += gap / 2; out[k + 1][0] = Math.max(0, out[k + 1][0] - gap / 2); }
        else { s[1] = Math.min(total, s[1] + pad); out[k + 1][0] = Math.max(0, out[k + 1][0] - pad); }
      } else s[1] = Math.min(total, s[1] + pad);
    }
    return out.map(function (s) { return { start: round(s[0] / SR), end: round(s[1] / SR) }; });
  }
  function round(x) { return Math.round(x * 1000) / 1000; }

  // ---------- Speech → the silences to cut (Montage) ----------
  // The gaps between speech (and before the first / after the last)
  // that last at least minGap seconds, each shrunk by keep seconds on
  // the sides that touch speech so words are not clipped.
  // → [{ start, end }] in seconds, sorted, inside [0, dur].
  function silences(speech, dur, minGap, keep) {
    minGap = minGap > 0 ? minGap : 0.6; keep = keep >= 0 ? keep : 0.15;
    var out = [], prev = 0;
    var edges = (speech || []).concat([{ start: dur, end: dur, last: true }]);
    for (var i = 0; i < edges.length; i++) {
      var a = prev, b = Math.min(dur, edges[i].start);
      var a2 = i === 0 ? a : a + keep, b2 = edges[i].last ? b : b - keep;
      if (b - a >= minGap && b2 - a2 > 0.05) out.push({ start: round(a2), end: round(b2) });
      prev = Math.max(prev, edges[i].end);
    }
    return out;
  }

  // ---------- Speech → Whisper windows ----------
  // Whisper hears 30 s at a time. Neighbouring speech segments are put
  // in one window while it stays ≤ maxSec (the short pauses inside stay
  // in, up to maxGap seconds each); a longer segment is cut into maxSec
  // pieces. Long silences are never sent to Whisper (there it invents
  // words). → [{ start, end }] in seconds.
  function windows(speech, maxSec, maxGap) {
    maxSec = maxSec > 0 ? maxSec : 28; maxGap = maxGap > 0 ? maxGap : 2;
    var out = [], cur = null;
    (speech || []).forEach(function (s) {
      if (cur && s.end - cur.start <= maxSec && s.start - cur.end <= maxGap) { cur.end = s.end; return; }
      if (cur) out.push(cur);
      var a = s.start;
      while (s.end - a > maxSec) { out.push({ start: a, end: round(a + maxSec) }); a = round(a + maxSec); }
      cur = { start: a, end: s.end };
    });
    if (cur) out.push(cur);
    return out;
  }

  // ---------- Live: frame probabilities → phrases ----------
  // Fed one probability per frame; says when a phrase starts, when it
  // ends (after `pause` seconds below the lower threshold) and how long
  // it has been quiet. Frames are counted from the first push.
  //   step(p) → null | "start" | "end"
  function Stepper(o) {
    this.thr = opt(o, "threshold"); this.neg = Math.max(0.01, this.thr - 0.15);
    this.pauseF = Math.max(1, Math.round((o && o.pause > 0 ? o.pause : 0.7) / FRAME_SEC));
    this.minF = Math.max(1, Math.round(opt(o, "minSpeech") / FRAME_SEC));
    this.reset();
  }
  Stepper.prototype.reset = function () {
    this.i = 0; this.on = false; this.start = 0; this.below = 0; this.quiet = 0; this.loud = 0;
  };
  Stepper.prototype.step = function (p) {
    var i = this.i++, ev = null;
    if (!this.on) {
      this.quiet++;
      if (p >= this.thr) {
        this.loud++;
        if (this.loud === 1) this.start = i;
        if (this.loud >= 2) { this.on = true; this.below = 0; this.quiet = 0; ev = "start"; }
      } else if (p < this.neg) this.loud = 0;
      return ev;
    }
    if (p < this.neg) this.below++; else if (p >= this.thr) this.below = 0;
    if (this.below >= this.pauseF) {
      this.on = false; this.loud = 0; this.quiet = this.below;
      this.end = i - this.below + 1;
      return this.end - this.start >= this.minF ? "end" : "drop";
    }
    return null;
  };

  var pure = {
    SR: SR, FRAME: FRAME, FRAME_SEC: FRAME_SEC, FILE: FILE, MB: MB, DEF: DEF,
    segments: segments, silences: silences, windows: windows, Stepper: Stepper
  };
  if (typeof module === "object" && module.exports) { module.exports = pure; return; }

  // ---------- Browser ----------
  var sessP = null;
  function asr() {
    if (root.MontageASR && root.MontageASR.runtime) return Promise.resolve(root.MontageASR);
    return Promise.reject(new Error("no-asr"));
  }
  function ready() {
    return asr().then(function (A) { return A.has(FILE); }).catch(function () { return false; });
  }
  function session(onProgress, signal) {
    if (sessP) return sessP;
    var p = sessP = asr().then(function (A) {
      return A.runtime(onProgress, signal).then(function (ort) {
        return A.file(FILE, null, signal).then(function (blob) { return blob.arrayBuffer(); }).then(function (buf) {
          return ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ["wasm"] });
        }).then(function (s) { return { ort: ort, s: s }; });
      });
    });
    p.catch(function () { if (sessP === p) sessP = null; });
    return p;
  }
  // One model run carries its state (and the last 64 samples) to the next.
  function Runner(m) {
    this.m = m; this.ctx = new Float32Array(CTX);
    this.state = new m.ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
    this.sr = new m.ort.Tensor("int64", BigInt64Array.from([BigInt(SR)]), []);
  }
  Runner.prototype.frame = function (f) {
    var self = this, T = this.m.ort.Tensor, inp = new Float32Array(CTX + FRAME);
    inp.set(this.ctx); inp.set(f, CTX);
    this.ctx = f.slice(FRAME - CTX);
    var s = this.m.s, feeds = { input: new T("float32", inp, [1, CTX + FRAME]), state: this.state, sr: this.sr };
    var A = root.MontageASR, go = function () { return s.run(feeds); };
    // one model run at a time across VAD and Whisper (the WebGPU build allows no other)
    return (A && A.exclusive ? A.exclusive(go) : go()).then(function (o) {
      self.state = o.stateN;
      return o.output.data[0];
    });
  };
  function probs(samples, o) {
    o = o || {};
    var cancelled = o.cancelled || function () { return false; }, progress = o.progress || function () {};
    return session(o.onDownload, o.signal).then(async function (m) {
      var r = new Runner(m), n = Math.floor(samples.length / FRAME), out = new Float32Array(n);
      for (var i = 0; i < n; i++) {
        if (i % 256 === 0) {
          if (cancelled()) throw new Error("cancelled");
          progress(i / n);
          await new Promise(function (res) { setTimeout(res, 0); });
        }
        out[i] = await r.frame(samples.subarray(i * FRAME, (i + 1) * FRAME));
      }
      progress(1);
      return out;
    });
  }
  function speech(samples, o) {
    return probs(samples, o).then(function (p) { return segments(p, samples.length, o); });
  }
  // Live: push 16 kHz samples as they come. A phrase is handed over with
  // 0.2 s before its start, cut at the pause.
  function stream(o) {
    o = o || {};
    var st = new Stepper(o), keepPre = Math.round(0.2 * SR), maxSec = o.maxSec || 28;
    var pend = new Float32Array(0), hist = [], histLen = 0, phrase = [], phraseLen = 0, chain = Promise.resolve(), runner = null, dead = false;
    function cat(list, len) { var out = new Float32Array(len), at = 0; list.forEach(function (a) { out.set(a, at); at += a.length; }); return out; }
    function give() {
      if (!phraseLen) return;
      var s = cat(phrase, phraseLen); phrase = []; phraseLen = 0;
      if (o.onPhrase) o.onPhrase(s);
    }
    function feed(f) {
      return runner.frame(f).then(function (p) {
        if (dead) return;
        var ev = st.step(p);
        if (st.on || ev === "end" || ev === "drop") { phrase.push(f); phraseLen += f.length; }
        else { hist.push(f); histLen += f.length; while (histLen - hist[0].length >= keepPre) { histLen -= hist.shift().length; } }
        if (ev === "start") {
          phrase = hist.concat(phrase); phraseLen += histLen; hist = []; histLen = 0;
          if (o.onStart) o.onStart();
        } else if (ev === "end") give();
        else if (ev === "drop") { phrase = []; phraseLen = 0; }
        else if (st.on && phraseLen >= maxSec * SR) give();   // a very long phrase goes in pieces
        if (!st.on && o.onIdle) o.onIdle(st.quiet * FRAME_SEC * 1000);
      });
    }
    return {
      ready: session(o.onDownload, o.signal).then(function (m) { runner = new Runner(m); return true; }),
      push: function (samples) {
        if (dead) return chain;
        var all = new Float32Array(pend.length + samples.length);
        all.set(pend); all.set(samples, pend.length);
        var n = Math.floor(all.length / FRAME);
        pend = all.slice(n * FRAME);
        for (var i = 0; i < n; i++) (function (f) { chain = chain.then(function () { return runner ? feed(f) : null; }); })(all.slice(i * FRAME, (i + 1) * FRAME));
        return chain;
      },
      // the person stopped: what was being said goes too
      flush: function () {
        return chain.then(function () { if (st.on && phraseLen >= st.minF * FRAME) give(); phrase = []; phraseLen = 0; st.reset(); });
      },
      speaking: function () { return st.on; },
      close: function () { dead = true; }
    };
  }

  root.OrosVAD = {
    ready: ready, probs: probs, speech: speech, stream: stream, MB: MB,
    segments: segments, silences: silences, windows: windows,
    prepare: function (onProgress, signal) { return session(onProgress, signal).then(function () { return true; }); }
  };
})(typeof window !== "undefined" ? window : this);
