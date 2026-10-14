// ============================================================
// orOS Montage — remove noise from a clip's sound, on the device.
// RNNoise (BSD-3, Jean-Marc Valin / Xiph.Org / Mozilla; v0.1.1 and its
// original model) compiled to WebAssembly without Emscripten:
// vendor/rnnoise/rnnoise.wasm (about 120 KB, no imports), fetched the
// first time someone uses it (vendor/rnnoise/build/ says how it was
// built). RNNoise takes 48 kHz sound in frames of 480 samples and gives
// each frame back 480 samples late; one state per channel.
//   MontageDenoise.clean(blob, { progress(f), cancelled() })
//     → Promise<File> the file's sound, cleaned, 48 kHz, as M4A (AAC),
//       else Ogg (Opus), else WAV; same timing as the original from its
//       first sound sample, so a clip's in / out points still fit.
// The streaming step (Stream: frames, the 480-sample delay, the
// int16 scale RNNoise wants) is unit-tested in node with the real wasm.
// UMD: module.exports in Node, window.MontageDenoise in the browser.
// ============================================================
(function (root) {
  "use strict";

  var FRAME = 480, RATE = 48000, DELAY = 480, SCALE = 32768;
  var WASM_URL = "../vendor/rnnoise/rnnoise.wasm";

  // One RNNoise instance (wasm memory is never freed inside: each job
  // makes a new instance from the compiled module).
  function engine(module) {
    var E = new WebAssembly.Instance(module, {}).exports;
    var pin = E.malloc(FRAME * 4), pout = E.malloc(FRAME * 4), states = [];
    return {
      // frame (Float32Array 480, -1..1) of channel ch → cleaned copy
      frame: function (ch, data) {
        if (!states[ch]) states[ch] = E.rnnoise_create(0);
        var a = new Float32Array(E.memory.buffer, pin, FRAME);
        for (var i = 0; i < FRAME; i++) a[i] = data[i] * SCALE;
        E.rnnoise_process_frame(states[ch], pout, pin);
        var b = new Float32Array(E.memory.buffer, pout, FRAME), out = new Float32Array(FRAME);
        for (var j = 0; j < FRAME; j++) out[j] = Math.max(-1, Math.min(1, b[j] / SCALE));
        return out;
      }
    };
  }

  // Sound in chunks of any length (planar: one Float32Array a channel)
  // → cleaned sound in chunks, in step with the input: the first DELAY
  // samples RNNoise gives back are dropped, and flush() pushes the last
  // ones out with silence.
  function Stream(eng, channels) {
    var held = [], skip = [], got = [], gave = [], i;
    for (i = 0; i < channels; i++) { held.push(new Float32Array(0)); skip.push(DELAY); got.push(0); gave.push(0); }
    function run(ch, input) {
      var out = frames(ch, input);
      got[ch] += input.length; gave[ch] += out.length;
      return out;
    }
    function frames(ch, input) {
      var all = new Float32Array(held[ch].length + input.length);
      all.set(held[ch]); all.set(input, held[ch].length);
      var n = Math.floor(all.length / FRAME), out = new Float32Array(n * FRAME);
      for (var f = 0; f < n; f++) out.set(eng.frame(ch, all.subarray(f * FRAME, (f + 1) * FRAME)), f * FRAME);
      held[ch] = all.slice(n * FRAME);
      var cut = Math.min(skip[ch], out.length);
      skip[ch] -= cut;
      return out.subarray(cut);
    }
    this.push = function (planes) { return planes.map(function (p, ch) { return run(ch, p); }); };
    // the rest: what is held plus the delay, as silence goes in
    this.flush = function () {
      return held.map(function (h, ch) {
        var want = got[ch] - gave[ch];
        var out = frames(ch, new Float32Array(DELAY + FRAME)).subarray(0, want);
        gave[ch] += out.length;
        return out;
      });
    };
  }

  var pure = { Stream: Stream, engine: engine, FRAME: FRAME, RATE: RATE, DELAY: DELAY };
  if (typeof module === "object" && module.exports) { module.exports = pure; return; }

  // ---------- Browser ----------
  var modP = null;
  function wasm() {
    if (!modP) {
      modP = fetch(WASM_URL).then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.arrayBuffer();
      }).then(function (buf) { return WebAssembly.compile(buf); });
      modP.catch(function () { modP = null; });
    }
    return modP;
  }

  function soundFormat(M) {
    return M.getFirstEncodableAudioCodec(["aac", "opus"], { numberOfChannels: 2, sampleRate: RATE }).then(function (ac) {
      if (ac === "aac") return { ext: "m4a", mime: "audio/mp4", ac: ac, fmt: new M.Mp4OutputFormat({ fastStart: "in-memory" }) };
      if (ac === "opus") return { ext: "ogg", mime: "audio/ogg", ac: ac, fmt: new M.OggOutputFormat() };
      return { ext: "wav", mime: "audio/wav", ac: "pcm-s16", fmt: new M.WavOutputFormat() };
    }, function () { return { ext: "wav", mime: "audio/wav", ac: "pcm-s16", fmt: new M.WavOutputFormat() }; });
  }

  async function clean(blob, opts) {
    opts = opts || {};
    var M = root.Mediabunny, progress = opts.progress || function () {}, cancelled = opts.cancelled || function () { return false; };
    if (!M) throw new Error("decode");
    var mod = await wasm(), eng = engine(mod);
    var input = new M.Input({ source: new M.BlobSource(blob), formats: M.ALL_FORMATS });
    try {
      var at = await input.getPrimaryAudioTrack();
      if (!at || !(await at.canDecode())) { var e = new Error("nosound"); e.code = "nosound"; throw e; }
      var chans = Math.min(2, Math.max(1, at.numberOfChannels || 1));
      var fmt = await soundFormat(M), target = new M.BufferTarget();
      var output = new M.Output({ format: fmt.fmt, target: target });
      var stream = new Stream(eng, chans), t0 = null, sent = 0;
      var conv = await M.Conversion.init({
        input: input, output: output,
        video: { discard: true },
        audio: {
          numberOfChannels: chans, sampleRate: RATE, codec: fmt.ac, bitrate: 128e3, forceTranscode: true,
          process: function (sample) {
            if (cancelled()) { conv.cancel(); return null; }
            if (t0 === null) t0 = sample.timestamp;
            var planes = [];
            for (var c = 0; c < chans; c++) {
              var buf = new Float32Array(sample.numberOfFrames);
              sample.copyTo(buf, { format: "f32-planar", planeIndex: Math.min(c, sample.numberOfChannels - 1) });
              planes.push(buf);
            }
            var outp = stream.push(planes), n = outp[0].length;
            if (!n) return null;
            var data = new Float32Array(n * chans);
            for (var c2 = 0; c2 < chans; c2++) data.set(outp[c2], c2 * n);
            var res = new M.AudioSample({ data: data, format: "f32-planar", numberOfChannels: chans, sampleRate: RATE, timestamp: t0 + sent / RATE });
            sent += n;
            return res;
          }
        }
      });
      if (!conv.isValid) throw new Error("decode");
      conv.onProgress = function (f) { progress(Math.min(0.99, f)); };
      await conv.execute();
      if (cancelled()) throw new Error("cancelled");
      progress(1);
      var name = String(opts.name || "sound").replace(/\.[^.]+$/, "").slice(0, 60) + " (clean)." + fmt.ext;
      return new File([target.buffer], name, { type: fmt.mime });
    } finally {
      if (input.dispose) input.dispose();
    }
  }

  root.MontageDenoise = { clean: clean, Stream: Stream, FRAME: FRAME, RATE: RATE };
})(typeof window !== "undefined" ? window : this);
