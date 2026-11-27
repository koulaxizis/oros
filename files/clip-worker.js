// ============================================================
// orOS Files — clip-worker.js (search photos by description)
// ------------------------------------------------------------
// Runs CLIP's two ONNX models in ONNX Runtime Web (vendor/ort, MIT)
// off the page, so making the index never freezes Files. clip.js
// sends the runtime and the model files as blobs it already checked
// (SHA-256) and kept in IndexedDB; nothing is fetched here.
// Messages in:  { id, op: "load", js, mjs, wasm, vision?, text? } (Blobs)
//               { id, op: "image", px: Float32Array(3*224*224) }
//               { id, op: "text", ids: Int32Array(77) }
// Messages out: { id, ok: true, vec?: Float32Array } | { id, ok: false, error }
// ============================================================
/* global ort */
"use strict";

var sess = { vision: null, text: null };

function blobUrl(b, type) { return URL.createObjectURL(new Blob([b], { type: type })); }

function create(blob) {
  return blob.arrayBuffer().then(function (buf) {
    return ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  });
}

function pick(out, names) {
  for (var i = 0; i < names.length; i++) if (out[names[i]]) return out[names[i]];
  var k = Object.keys(out);
  return out[k[0]];
}

function load(m) {
  if (typeof ort === "undefined") importScripts(blobUrl(m.js, "text/javascript"));
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = { mjs: blobUrl(m.mjs, "text/javascript"), wasm: blobUrl(m.wasm, "application/wasm") };
  var jobs = [];
  if (m.vision && !sess.vision) jobs.push(create(m.vision).then(function (s) { sess.vision = s; }));
  if (m.text && !sess.text) jobs.push(create(m.text).then(function (s) { sess.text = s; }));
  return Promise.all(jobs).then(function () { return null; });
}

function image(px) {
  var s = sess.vision;
  if (!s) return Promise.reject(new Error("not-loaded"));
  var feeds = {};
  feeds[s.inputNames[0]] = new ort.Tensor("float32", px, [1, 3, 224, 224]);
  return s.run(feeds).then(function (out) { return new Float32Array(pick(out, ["image_embeds"]).data); });
}

function text(ids) {
  var s = sess.text;
  if (!s) return Promise.reject(new Error("not-loaded"));
  var n = ids.length, big = new BigInt64Array(n), mask = new BigInt64Array(n), seen = false, feeds = {};
  for (var i = 0; i < n; i++) {
    big[i] = BigInt(ids[i]);
    mask[i] = seen ? 0n : 1n;
    if (ids[i] === 49407) seen = true;
  }
  s.inputNames.forEach(function (nm) {
    feeds[nm] = new ort.Tensor("int64", /mask/.test(nm) ? mask : big, [1, n]);
  });
  return s.run(feeds).then(function (out) { return new Float32Array(pick(out, ["text_embeds"]).data); });
}

self.onmessage = function (e) {
  var m = e.data || {}, p;
  try {
    p = m.op === "load" ? load(m) : m.op === "image" ? image(m.px) : m.op === "text" ? text(m.ids) : Promise.reject(new Error("op"));
  } catch (err) { p = Promise.reject(err); }
  p.then(function (vec) {
    if (vec instanceof Float32Array) self.postMessage({ id: m.id, ok: true, vec: vec }, [vec.buffer]);
    else self.postMessage({ id: m.id, ok: true });
  }, function (err) {
    self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) });
  });
};
