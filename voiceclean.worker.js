// ============================================================
// orOS — voiceclean.worker.js (v1.0.0, wave K1)
// One worker of a voice cleaning (voiceclean.js): DeepFilterNet3 as a
// WebAssembly module with no imports, one piece of one channel at a time.
// Messages in:  { type: "init", module: WebAssembly.Module }
//               { type: "run", id, input: Float32Array, skip, atten }
// Messages out: { type: "ready" } | { type: "done", id, out: Float32Array }
//               | { type: "error", code }
// ============================================================
/* global importScripts, OrosVoiceClean */
"use strict";
importScripts("voiceclean.js");
var V = self.OrosVoiceClean, exportsP = null;

function fail(e) {
  var msg = String((e && e.message) || e);
  self.postMessage({ type: "error", code: /memory|allocat|out of bounds|unreachable/i.test(msg) ? "memory" : "engine", msg: msg.slice(0, 200) });
}

self.onmessage = function (ev) {
  var m = ev.data || {};
  if (m.type === "init") {
    exportsP = WebAssembly.instantiate(m.module, {}).then(function (inst) { return inst.exports; });
    exportsP.then(function () { self.postMessage({ type: "ready" }); }, fail);
    return;
  }
  if (m.type === "run") {
    if (!exportsP) { fail("no module"); return; }
    exportsP.then(function (E) {
      var eng = V.engine(E, m.atten);
      try {
        var out = V.frames(eng, m.input, m.skip);
        self.postMessage({ type: "done", id: m.id, out: out }, [out.buffer]);
      } finally { eng.free(); }
    }).catch(fail);
  }
};
