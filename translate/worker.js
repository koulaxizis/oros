// ============================================================
// orOS translation worker (translate/worker.js, v1.0.0)
// Runs Mozilla's Bergamot translator (vendor/bergamot, MPL-2.0,
// unchanged) in this worker. translate/engine.js owns every file:
// it reads the runtime and the models from IndexedDB and posts them
// here, so nothing in this worker touches the network.
// Messages in:  { id, op: "init", glue: Blob, wasm: ArrayBuffer }
//               { id, op: "load", pair, model, lex, vocab }  (ArrayBuffers)
//               { id, op: "translate", legs: ["el-en"], texts: [{ text, html }] }
//               { id, op: "free", pair }
// Messages out: { id, ok: true, result } | { id, ok: false, error }
// The glue between Bergamot's wasm and JavaScript follows Bergamot's
// own translator-worker.js (bergamot-translator 0.4.9).
// ============================================================
/* global importScripts, WebAssembly */
var Module = {};
(function () {
  "use strict";

  var service = null, models = {};
  // Bergamot asks for these gemm functions from a "wasm_gemm" module;
  // the wasm carries its own versions under the fallback names.
  var GEMM = {
    int8_prepare_a: "int8PrepareAFallback",
    int8_prepare_b: "int8PrepareBFallback",
    int8_prepare_b_from_transposed: "int8PrepareBFromTransposedFallback",
    int8_prepare_b_from_quantized_transposed: "int8PrepareBFromQuantizedTransposedFallback",
    int8_prepare_bias: "int8PrepareBiasFallback",
    int8_multiply_and_add_bias: "int8MultiplyAndAddBiasFallback",
    int8_select_columns_of_b: "int8SelectColumnsOfBFallback"
  };
  function gemm() {
    var out = {};
    Object.keys(GEMM).forEach(function (k) {
      var name = GEMM[k];
      out[k] = function () { return Module.asm[name].apply(null, arguments); };
    });
    return out;
  }

  function init(m) {
    if (service) return Promise.resolve(true);
    return new Promise(function (resolve, reject) {
      Module.instantiateWasm = function (info, accept) {
        var imports = {};
        Object.keys(info).forEach(function (k) { imports[k] = info[k]; });
        imports.wasm_gemm = gemm();
        WebAssembly.instantiate(m.wasm, imports).then(function (r) { accept(r.instance); }, reject);
        return {};
      };
      Module.onRuntimeInitialized = function () {
        try { service = new Module.BlockingService({ cacheSize: 0 }); resolve(true); }
        catch (e) { reject(e); }
      };
      Module.onAbort = function (what) { reject(new Error("abort " + what)); };
      self.Module = Module;
      var url = URL.createObjectURL(m.glue);
      try { importScripts(url); } catch (e) { reject(e); }
      URL.revokeObjectURL(url);
    });
  }

  function aligned(buf, align) {
    var bytes = new Int8Array(buf);
    var mem = new Module.AlignedMemory(bytes.byteLength, align);
    mem.getByteArrayView().set(bytes);
    return mem;
  }
  // Marian options, as Bergamot's own worker sets them for these models.
  var CONFIG = [
    "beam-size: 1", "normalize: 1.0", "word-penalty: 0", "cpu-threads: 0",
    "gemm-precision: int8shiftAlphaAll", "skip-cost: true", "alignment: soft",
    "quiet: true", "quiet-translation: true", "max-length-break: 128",
    "mini-batch-words: 1024", "workspace: 128", "max-length-factor: 2.0"
  ].join("\n") + "\n";

  function load(m) {
    if (!service) throw new Error("not ready");
    if (models[m.pair]) return true;
    var vocabs = new Module.AlignedMemoryList();
    vocabs.push_back(aligned(m.vocab, 64));
    models[m.pair] = new Module.TranslationModel(CONFIG, aligned(m.model, 256), aligned(m.lex, 64), vocabs, null);
    return true;
  }

  function translate(m) {
    var legs = m.legs.map(function (p) {
      if (!models[p]) throw new Error("model " + p);
      return models[p];
    });
    var input = new Module.VectorString(), opts = new Module.VectorResponseOptions();
    m.texts.forEach(function (x) {
      input.push_back(x.text);
      opts.push_back({ alignment: false, html: !!x.html, qualityScores: false });
    });
    var res = legs.length > 1 ? service.translateViaPivoting(legs[0], legs[1], input, opts)
                              : service.translate(legs[0], input, opts);
    var out = [];
    for (var i = 0; i < m.texts.length; i++) out.push(res.get(i).getTranslatedText());
    input.delete(); opts.delete(); res.delete();
    return out;
  }

  function free(m) {
    if (models[m.pair]) { models[m.pair].delete(); delete models[m.pair]; }
    return true;
  }

  self.onmessage = function (e) {
    var m = e.data || {}, id = m.id;
    Promise.resolve().then(function () {
      if (m.op === "init") return init(m);
      if (m.op === "load") return load(m);
      if (m.op === "translate") return translate(m);
      if (m.op === "free") return free(m);
      throw new Error("op");
    }).then(function (result) {
      self.postMessage({ id: id, ok: true, result: result });
    }, function (err) {
      self.postMessage({ id: id, ok: false, error: String(err && err.message || err) });
    });
  };
})();
