// ============================================================
// orOS voices — the worker (voicekit/worker.js, v1.1.0)
// Runs a Piper voice in ONNX Runtime Web (vendor/ort, MIT). voicekit.js
// owns every file: it reads the runtime and the voice from IndexedDB and
// posts them here, so nothing in this worker touches the network.
// Messages in:  { id, op: "init", js, mjs, wasm (Blobs), g2p (URL of the
//                 language's phonemes, e.g. voicekit/german.js), g2pName
//                 (the global it sets, e.g. "GermanVoice"),
//                 model (ArrayBuffer), config (the voice's .onnx.json) }
//               { id, op: "synth", text, scales: [noise, length, noise_w] }
// Messages out: { id, ok: true, result } | { id, ok: false, error }
//   synth → { audio: Float32Array (mono, -1..1), sampleRate }
// ============================================================
/* global importScripts, ort */
(function () {
  "use strict";

  var session = null, config = null, g2p = null;
  var PAUSE = 0.2;             // seconds of quiet between two sentences (the voice's own sentence_silence wins)

  function blobUrl(b, type) { return URL.createObjectURL(new Blob([b], { type: type })); }

  function init(m) {
    importScripts(blobUrl(m.js, "text/javascript"));
    importScripts(m.g2p);
    g2p = self[m.g2pName];
    if (!g2p || typeof g2p.sentences !== "function") throw new Error("g2p");
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = { mjs: blobUrl(m.mjs, "text/javascript"), wasm: blobUrl(m.wasm, "application/wasm") };
    config = m.config || {};
    return ort.InferenceSession.create(new Uint8Array(m.model), { executionProviders: ["wasm"] }).then(function (s) {
      session = s;
      return true;
    });
  }

  // the same as idsOf in voicekit.js (tested there): Piper 1.5 voices
  // read the pairs in config.vowel_clusters as one sound
  function idsOf(ph) {
    var map = config.phoneme_id_map || {}, out = [], pad = (map._ || [0])[0], pairs = {};
    (config.vowel_clusters || []).forEach(function (c) { var k = c.join(""); if (map[k]) pairs[k] = 1; });
    function add(sym) { var v = map[sym]; if (v) for (var i = 0; i < v.length; i++) out.push(v[i]); return !!v; }
    add("^"); out.push(pad);
    var s = String(ph || "").normalize("NFD");
    for (var i = 0; i < s.length;) {
      var ch = String.fromCodePoint(s.codePointAt(i));
      var nx = i + ch.length < s.length ? String.fromCodePoint(s.codePointAt(i + ch.length)) : "";
      if (nx && pairs[ch + nx]) { add(ch + nx); out.push(pad); i += ch.length + nx.length; continue; }
      i += ch.length;
      if (add(ch)) out.push(pad);
    }
    add("$");
    return out;
  }

  function one(ph, scales) {
    var ids = idsOf(ph);
    var big = new BigInt64Array(ids.length);
    for (var i = 0; i < ids.length; i++) big[i] = BigInt(ids[i]);
    var feeds = {
      input: new ort.Tensor("int64", big, [1, ids.length]),
      input_lengths: new ort.Tensor("int64", new BigInt64Array([BigInt(ids.length)]), [1]),
      scales: new ort.Tensor("float32", new Float32Array(scales), [3])
    };
    if (session.inputNames.indexOf("sid") !== -1) feeds.sid = new ort.Tensor("int64", new BigInt64Array([0n]), [1]);
    return session.run(feeds).then(function (out) {
      var t = out[session.outputNames[0]];
      return t.data;
    });
  }

  function synth(m) {
    if (!session) return Promise.reject(new Error("init"));
    var sr = (config.audio && config.audio.sample_rate) || 22050;
    var list = g2p.sentences(m.text);
    var inf = config.inference || {};
    var gap = Math.round((typeof inf.sentence_silence === "number" ? inf.sentence_silence : PAUSE) * sr);
    var chunks = [], total = 0;
    return list.reduce(function (p, s) {
      return p.then(function () {
        return one(s.ph, m.scales).then(function (a) {
          if (chunks.length) { chunks.push(new Float32Array(gap)); total += gap; }
          chunks.push(a); total += a.length;
        });
      });
    }, Promise.resolve()).then(function () {
      var audio = new Float32Array(total), o = 0;
      chunks.forEach(function (c) { audio.set(c, o); o += c.length; });
      return { audio: audio, sampleRate: sr };
    });
  }

  self.onmessage = function (e) {
    var m = e.data || {};
    var p;
    try {
      p = m.op === "init" ? init(m) : m.op === "synth" ? synth(m) : Promise.reject(new Error("op"));
    } catch (err) { p = Promise.reject(err); }
    p.then(function (result) {
      var transfer = result && result.audio ? [result.audio.buffer] : [];
      self.postMessage({ id: m.id, ok: true, result: result }, transfer);
    }, function (err) {
      self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) });
    });
  };
})();
