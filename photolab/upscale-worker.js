// ============================================================
// orOS Photo Lab — upscale-worker.js: Enlarge with AI off the main
// thread (PL-UP, v1.0.0)
// enlarge.js hands it the ONNX Runtime Web files and the model (already
// downloaded and hash-checked) and then one picture at a time; the
// steps are upscale.js. Cancel = the page terminates this worker.
//   in:  { op: "init", js, mjs, wasm (blob URLs), model (ArrayBuffer) }
//        { op: "run", img { w, h, data }, k }
//   out: { op: "ready" } | { op: "tile", done, total }
//        | { op: "done", img } | { op: "error", e }
// ============================================================
/* global importScripts, self, ort */
importScripts("resample.js", "upscale.js");

var sess = null;

function fail(e) { self.postMessage({ op: "error", e: String((e && e.message) || e || "error") }); }

self.onmessage = function (ev) {
  var m = ev.data || {};
  if (m.op === "init") {
    try {
      if (!self.ort) importScripts(m.js);
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = { mjs: m.mjs, wasm: m.wasm };
    } catch (e) { fail(e); return; }
    ort.InferenceSession.create(new Uint8Array(m.model), { executionProviders: ["wasm"] }).then(function (s) {
      sess = s;
      self.postMessage({ op: "ready" });
    }, fail);
    return;
  }
  if (m.op === "run") {
    if (!sess) { fail("not ready"); return; }
    var U = self.PhotoLab.upscale;
    U.run(m.img, {
      k: m.k, R: self.PhotoLab.resample,
      infer: function (data, w, h) {
        var feeds = {};
        feeds[sess.inputNames[0]] = new ort.Tensor("float32", data, [1, 3, h, w]);
        return sess.run(feeds).then(function (o) { return o[sess.outputNames[0]].data; });
      },
      onTile: function (done, total) { self.postMessage({ op: "tile", done: done, total: total }); }
    }).then(function (img) {
      self.postMessage({ op: "done", img: img }, [img.data.buffer]);
    }, fail);
  }
};
