// DICT-2: dictation helpers (montage/listen.js) and the Whisper loop guard (asr.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../montage/listen.js");
const A = require("../montage/asr.js");

test("Resampler: 48 kHz → 16 kHz, block by block, no drift", () => {
  const r = new L.Resampler(48000);
  let n = 0;
  for (let b = 0; b < 100; b++) {
    const x = new Float32Array(4096).fill(0.5);
    const y = r.push(x);
    y.forEach((v) => assert.ok(Math.abs(v - 0.5) < 1e-6));
    n += y.length;
  }
  assert.ok(Math.abs(n - 409600 / 3) <= 1, String(n));
  // 44.1 kHz: a fractional step
  const r2 = new L.Resampler(44100);
  let m = 0;
  for (let b = 0; b < 50; b++) m += r2.push(new Float32Array(4410)).length;
  assert.ok(Math.abs(m - 80000) <= 1, String(m));
});

test("joinText: one space between phrases, none after an opening mark", () => {
  assert.equal(L.joinText("", "Γεια"), "Γεια");
  assert.equal(L.joinText("Γεια.", " σου "), "Γεια. σου");
  assert.equal(L.joinText("«", "Γεια"), "«Γεια");
  assert.equal(L.joinText("a", ""), "a");
});

test("loopAt: a stuck decoder is cut after the first copy", () => {
  assert.equal(A.loopAt([1, 2, 3]), -1);
  assert.equal(A.loopAt([5, 7, 7, 7]), -1);           // a word three times can be real
  assert.equal(A.loopAt([5, 7, 7, 7, 7]), 2);         // four times is not
  assert.equal(A.loopAt([1, 8, 9, 8, 9, 8, 9]), 3);   // "πως πως πως" as two tokens each
  assert.equal(A.loopAt([1, 2, 3, 4, 2, 3, 4, 2, 3, 4]), 4);
  assert.equal(A.loopAt([1, 2, 3, 4, 2, 3, 4]), -1);
});

test("Whisper small (DICT-3): own keys, the WebGPU runtime, parts from the large mirror", () => {
  const sm = A.fileList("small");
  assert.deepEqual(sm.map((f) => f.key), ["g.js", "g.mjs", "g.wasm", "small.enc", "small.dec", "small.vocab", "small.gen"]);
  assert.deepEqual(sm.slice(0, 3).map((f) => f.url), ["../vendor/ort/ort.webgpu.min.js", "../vendor/ort/ort-wasm-simd-threaded.jsep.mjs", "../vendor/ort/ort-wasm-simd-threaded.jsep.wasm"]);
  sm.slice(3).forEach((f) => assert.match(f.url, /^https:\/\/koulaxizis\.github\.io\/oros-models-large\/whisper-small\//));
  assert.equal(sm[3].url.endsWith("onnx/encoder_model_q4.onnx"), true);
  assert.equal(sm[4].url.endsWith("onnx/decoder_model_merged_q4.onnx"), true);
  assert.equal(A.MODELS.small.layers, 12);
  assert.equal(A.MODELS.small.heads, 12);
  assert.equal(A.MODELS.small.gpu, true);
});

test("the language you speak: a choice wins, else Greek/German orOS, else the browser's, else automatic among el/en/de", () => {
  const vm = require("node:vm"), fs = require("node:fs"), path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "../montage/asr.js"), "utf8");
  function load(store, langs) {
    const win = {
      localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
      navigator: { languages: langs, language: langs[0] }, document: { currentScript: null }
    };
    win.window = win;
    vm.runInNewContext(src, Object.assign(win, { Promise, Float32Array, Uint8Array, console }));
    return win.MontageASR;
  }
  assert.equal(load({}, ["en-US"]).speakLang("el"), "el");
  assert.equal(load({}, ["en-US"]).speakLang("de"), "de");
  assert.equal(load({}, ["en-US", "el-GR"]).speakLang("en"), "el");   // English orOS, Greek browser
  assert.equal(load({}, ["en-US"]).speakLang("en"), "auto");
  const store = {}, A2 = load(store, ["en-US"]);
  A2.setSpeakLang("el");
  assert.equal(A2.speakLang("en"), "el");
  assert.equal(A2.speakChoice(), "el");
  A2.setSpeakLang("xx");
  assert.equal(A2.speakChoice(), "el");
  A2.setSpeakLang("");
  assert.equal(A2.speakChoice(), "");
  assert.deepEqual(Array.from(A2.SPEAK_AUTO), ["el", "en", "de"]);
  // detection keeps to opts.langs; the Assistant and Notes pass them
  assert.match(src, /only && only\.indexOf\(code\) < 0/);
  assert.match(fs.readFileSync(path.join(__dirname, "../montage/listen.js"), "utf8"), /langs: o\.langs/);
  assert.match(fs.readFileSync(path.join(__dirname, "../assistant/assistant.js"), "utf8"), /langs: voLangs\(\)/);
});
