// ============================================================
// orOS Studio — stems.worker.js (v1.0.0, Studio wave S1)
// One worker of a separation (studio/stems.js): ONNX Runtime Web
// (WebAssembly, one thread) runs Demucs on one 7.8 s segment at a time.
// Messages in:  { type: "init", urls: { js, mjs, wasm } (blob: URLs), model: Blob }
//               { type: "run", k, left, right (Float32Array SEG), length, delta }
// Messages out: { type: "ready" } | { type: "done", k, length, out }
//               (out: Float32Array(8 * length), [source][channel][sample],
//               still normalised) | { type: "error", code }
// ============================================================
/* global importScripts, ort, StudioStems */
"use strict";
importScripts("stems.js");
var S = self.StudioStems, session = null;

function fail(e) {
  var msg = String((e && e.message) || e);
  self.postMessage({ type: "error", code: /memory|allocat|out of bounds/i.test(msg) ? "memory" : "engine", msg: msg.slice(0, 200) });
}

self.onmessage = function (ev) {
  var m = ev.data || {};
  if (m.type === "init") {
    try { importScripts(m.urls.js); } catch (e) { fail(e); return; }
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = { mjs: m.urls.mjs, wasm: m.urls.wasm };
    m.model.arrayBuffer().then(function (buf) {
      return ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    }).then(function (s) { session = s; self.postMessage({ type: "ready" }); }, fail);
    return;
  }
  if (m.type === "run") {
    if (!session) { fail("no session"); return; }
    var feeds = {
      mix: new ort.Tensor("float32", (function () { var x = new Float32Array(2 * S.SEG); x.set(m.left, 0); x.set(m.right, S.SEG); return x; })(), [1, 2, S.SEG]),
      mag: new ort.Tensor("float32", S.magOf(m.left, m.right), [1, 4, S.BINS, S.FRAMES])
    };
    session.run(feeds).then(function (r) {
      var srcs = S.sourcesOf(r.spec.data, r.wave.data);
      var out = S.trimmed(srcs, m.length, m.delta);
      self.postMessage({ type: "done", k: m.k, length: m.length, out: out }, [out.buffer]);
    }, fail);
  }
};
