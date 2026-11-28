// ============================================================
// orOS — semantic-worker.js (search by meaning, model runner, v1.0.0)
// ------------------------------------------------------------
// Runs multilingual-e5-small in ONNX Runtime Web (vendor/ort, MIT)
// off the page, so building the index never freezes orOS. semantic.js
// sends the runtime, semantic-core.js, the tokenizer and the model as
// Blobs it already checked (SHA-256) and kept in IndexedDB; nothing is
// fetched from the network here.
// Messages in:  { id, op: "load", js, mjs, wasm, core, tok, model } (Blobs)
//               { id, op: "embed", texts: [string] }  ("query: …" / "passage: …")
// Messages out: { id, ok: true, vecs?: [Float32Array(384)] } | { id, ok: false, error }
// ============================================================
/* global ort, OrosSemanticCore */
"use strict";

var sess = null, tok = null;

function blobUrl(b, type) { return URL.createObjectURL(new Blob([b], { type: type })); }

function load(m) {
  if (sess && tok) return Promise.resolve(null);
  if (typeof OrosSemanticCore === "undefined") importScripts(blobUrl(m.core, "text/javascript"));
  if (typeof ort === "undefined") importScripts(blobUrl(m.js, "text/javascript"));
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = { mjs: blobUrl(m.mjs, "text/javascript"), wasm: blobUrl(m.wasm, "application/wasm") };
  return m.tok.text().then(function (json) {
    tok = OrosSemanticCore.makeTokenizer(json);
    return m.model.arrayBuffer();
  }).then(function (buf) {
    return ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  }).then(function (s) { sess = s; return null; });
}

// A few texts at once, padded to the longest (the batch is small and
// its texts are about the same length, so little is wasted).
function embed(texts) {
  if (!sess || !tok) return Promise.reject(new Error("not-loaded"));
  var C = OrosSemanticCore;
  var rows = texts.map(function (t) { return tok.encode(t, C.MAX_TOKENS); });
  var n = rows.length, len = 0, lens = [];
  rows.forEach(function (r) { if (r.length > len) len = r.length; lens.push(r.length); });
  var ids = new BigInt64Array(n * len), mask = new BigInt64Array(n * len), types = new BigInt64Array(n * len);
  rows.forEach(function (r, i) {
    for (var j = 0; j < r.length; j++) { ids[i * len + j] = BigInt(r[j]); mask[i * len + j] = 1n; }
    for (var p = r.length; p < len; p++) ids[i * len + p] = 1n;   // <pad>
  });
  var feeds = {};
  sess.inputNames.forEach(function (nm) {
    var data = nm === "attention_mask" ? mask : nm === "token_type_ids" ? types : ids;
    feeds[nm] = new ort.Tensor("int64", data, [n, len]);
  });
  return sess.run(feeds).then(function (out) {
    var h = out.last_hidden_state || out[Object.keys(out)[0]];
    return C.pool(h.data, lens, n, len, C.DIM);
  });
}

self.onmessage = function (e) {
  var m = e.data || {}, p;
  try {
    p = m.op === "load" ? load(m) : m.op === "embed" ? embed(Array.isArray(m.texts) ? m.texts.map(String) : []) : Promise.reject(new Error("op"));
  } catch (err) { p = Promise.reject(err); }
  p.then(function (vecs) {
    if (Array.isArray(vecs)) self.postMessage({ id: m.id, ok: true, vecs: vecs }, vecs.map(function (v) { return v.buffer; }));
    else self.postMessage({ id: m.id, ok: true });
  }, function (err) {
    self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) });
  });
};
