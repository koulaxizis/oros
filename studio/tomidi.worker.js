// ============================================================
// orOS Studio — tomidi.worker.js (v1.0.0, wave K4)
// Runs Spotify's Basic Pitch model (studio/tomidi.js) in ONNX Runtime
// Web (WebAssembly, one thread), one 2-second window at a time.
// Messages in:  { type: "init", model: ArrayBuffer }
//               { type: "run", k, x: Float32Array(43844) }
// Messages out: { type: "ready" } | { type: "done", k, frames, note, onset }
//               (note, onset: Float32Array(frames * 88)) | { type: "error" }
// ============================================================
/* global importScripts, ort */
"use strict";
var session = null;
function fail(e) { self.postMessage({ type: "error", msg: String((e && e.message) || e).slice(0, 200) }); }

self.onmessage = function (ev) {
  var m = ev.data || {};
  if (m.type === "init") {
    try { importScripts("../vendor/ort/ort.wasm.min.js"); } catch (e) { fail(e); return; }
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = { mjs: new URL("../vendor/ort/ort-wasm-simd-threaded.mjs", self.location).href,
                               wasm: new URL("../vendor/ort/ort-wasm-simd-threaded.wasm", self.location).href };
    ort.InferenceSession.create(new Uint8Array(m.model), { executionProviders: ["wasm"] })
      .then(function (s) { session = s; self.postMessage({ type: "ready" }); }, fail);
    return;
  }
  if (m.type === "run") {
    if (!session) { fail("no session"); return; }
    var feeds = {};
    feeds[session.inputNames[0]] = new ort.Tensor("float32", m.x, [1, m.x.length, 1]);
    session.run(feeds).then(function (r) {
      // basic-pitch names: StatefulPartitionedCall:1 note, :2 onset, :0 contour
      var note = r["StatefulPartitionedCall:1"], onset = r["StatefulPartitionedCall:2"];
      var frames = note.dims[1];
      var a = new Float32Array(note.data), b = new Float32Array(onset.data);
      self.postMessage({ type: "done", k: m.k, frames: frames, note: a, onset: b }, [a.buffer, b.buffer]);
    }, fail);
  }
};
