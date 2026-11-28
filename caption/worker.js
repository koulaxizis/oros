// ============================================================
// orOS captions — caption/worker.js (CAPTION v1)
// ------------------------------------------------------------
// Runs Florence-2 base-ft's four ONNX parts (vision encoder, token
// embeddings, text encoder, merged decoder) in ONNX Runtime Web
// (vendor/ort, MIT) off the page, so a description never freezes the
// app. caption.js sends the runtime and the model files as blobs it
// already checked (SHA-256) and kept in IndexedDB; nothing is fetched
// here except caption/core.js, from this site.
// Messages in:  { id, op: "load", js, mjs, wasm, vision, embed, enc, dec, vocab } (Blobs)
//               { id, op: "describe", px: Float32Array(3*768*768), task }
// Messages out: { id, ok: true, text? } | { id, ok: false, error }
// ============================================================
/* global ort, OrosCaptionCore */
"use strict";

importScripts("core.js" + (self.location.search || ""));
var CORE = self.OrosCaptionCore;
var S = { vision: null, embed: null, enc: null, dec: null }, dec = null;

function blobUrl(b, type) { return URL.createObjectURL(new Blob([b], { type: type })); }
function create(blob) {
  return blob.arrayBuffer().then(function (buf) {
    return ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  });
}

function load(m) {
  if (typeof ort === "undefined") importScripts(blobUrl(m.js, "text/javascript"));
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = { mjs: blobUrl(m.mjs, "text/javascript"), wasm: blobUrl(m.wasm, "application/wasm") };
  var jobs = ["vision", "embed", "enc", "dec"].map(function (k) {
    return S[k] ? null : create(m[k]).then(function (s) { S[k] = s; });
  });
  if (!dec) jobs.push(m.vocab.text().then(function (t) { dec = CORE.decoder(JSON.parse(t)); }));
  return Promise.all(jobs).then(function () { return null; });
}

function i64(ids) {
  var b = new BigInt64Array(ids.length);
  for (var i = 0; i < ids.length; i++) b[i] = BigInt(ids[i]);
  return b;
}
function embed(ids) {
  return S.embed.run({ input_ids: new ort.Tensor("int64", i64(ids), [1, ids.length]) }).then(function (o) { return o.inputs_embeds; });
}

function describe(px, task) {
  if (!S.dec || !dec) return Promise.reject(new Error("not-loaded"));
  var prompt = CORE.PROMPTS[task] || CORE.PROMPTS["short"], maxNew = CORE.MAX_NEW[task] || CORE.MAX_NEW["short"];
  var feat, mask, hidden, D = CORE.DIM;
  return S.vision.run({ pixel_values: new ort.Tensor("float32", px, [1, 3, CORE.SIZE, CORE.SIZE]) }).then(function (o) {
    feat = o.image_features;
    return embed(prompt);
  }).then(function (emb) {
    // Florence's encoder input: the picture's 577 vectors, then the prompt's.
    var ni = feat.dims[1], nt = emb.dims[1], n = ni + nt, all = new Float32Array(n * D);
    all.set(feat.data, 0);
    all.set(emb.data, ni * D);
    var mk = new BigInt64Array(n).fill(1n);
    mask = new ort.Tensor("int64", mk, [1, n]);
    return S.enc.run({ inputs_embeds: new ort.Tensor("float32", all, [1, n, D]), attention_mask: mask });
  }).then(function (o) {
    hidden = o.last_hidden_state;
    var past = {}, gen = [CORE.EOS], step = 0;
    S.dec.inputNames.forEach(function (nm) {
      if (nm.indexOf("past_key_values.") === 0) past[nm] = new ort.Tensor("float32", new Float32Array(0), [1, 12, 0, 64]);
    });
    function next(tok) {
      return embed([tok]).then(function (e) {
        var feeds = { encoder_attention_mask: mask, encoder_hidden_states: hidden, inputs_embeds: e,
                      use_cache_branch: new ort.Tensor("bool", new Uint8Array([step > 0 ? 1 : 0]), [1]) };
        Object.keys(past).forEach(function (k) { feeds[k] = past[k]; });
        return S.dec.run(feeds);
      }).then(function (out) {
        var lg = out.logits, V = lg.dims[2], T = lg.dims[1];
        var last = lg.data.subarray((T - 1) * V, T * V);
        var t = CORE.pick(last, gen, step);
        Object.keys(past).forEach(function (k) {
          // The encoder's keys and values are made on the first step and kept.
          if (step > 0 && k.indexOf(".encoder.") > 0) return;
          past[k] = out[k.replace("past_key_values", "present")];
        });
        gen.push(t);
        step++;
        if (t === CORE.EOS || step >= maxNew) return CORE.tidy(dec.text(gen));
        return next(t);
      });
    }
    return next(CORE.EOS);
  });
}

self.onmessage = function (e) {
  var m = e.data || {}, p;
  try {
    p = m.op === "load" ? load(m) : m.op === "describe" ? describe(m.px, m.task) : Promise.reject(new Error("op"));
  } catch (err) { p = Promise.reject(err); }
  p.then(function (text) {
    self.postMessage(typeof text === "string" ? { id: m.id, ok: true, text: text } : { id: m.id, ok: true });
  }, function (err) {
    self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) });
  });
};
