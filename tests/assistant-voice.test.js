// SOLO-AS W2: voice input in the Assistant through montage/asr.js
// (local Whisper, "tiny" or "base"); the text waits in the message box.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const C = require(path.join(ROOT, "assistant/core.js"));
const A = require(path.join(ROOT, "montage/asr.js"));
const S = require(path.join(ROOT, "solo.js"));

test("asr models: tiny keeps its keys and version, base has its own, runtime is shared", () => {
  assert.deepEqual(Object.keys(A.MODELS), ["tiny", "base", "small"]);   // small: DICT-3
  assert.equal(A.modelOf(undefined), "tiny");
  assert.equal(A.modelOf("large"), "tiny");
  assert.equal(A.modelOf("base"), "base");
  const tiny = A.fileList("tiny"), base = A.fileList("base");
  assert.deepEqual(tiny.map((f) => f.key), ["js", "mjs", "wasm", "enc", "dec", "vocab", "gen"]);
  assert.deepEqual(base.map((f) => f.key), ["js", "mjs", "wasm", "base.enc", "base.dec", "base.vocab", "base.gen"]);
  // a tiny model downloaded before W2 stays valid: same keys, URLs, version
  tiny.forEach((f) => { assert.equal(f.url, A.FILES[f.key]); assert.equal(f.ver, "ort1.22.0-whisper-tiny-q8"); });
  base.slice(0, 3).forEach((f, i) => assert.deepEqual(f, tiny[i]));
  base.slice(3).forEach((f) => {
    assert.match(f.url, /^https:\/\/huggingface\.co\/Xenova\/whisper-base\/resolve\/main\//);
    assert.equal(f.ver, "ort1.22.0-whisper-base-q8");
  });
  assert.deepEqual(base.slice(3).map((f) => f.name), ["enc", "dec", "vocab", "gen"]);
  assert.equal(A.MODELS.base.layers, 6);
  assert.equal(A.MODELS.base.heads, 8);
  assert.equal(A.MODELS.tiny.layers, 4);
});

test("asr: transcribe feeds as many decoder layers as the model has", () => {
  const src = read("montage/asr.js");
  assert.match(src, /for \(var l = 0; l < \(layers \|\| LAYERS\); l\+\+\) \["decoder\.key"/);
  assert.match(src, /decFeeds\(T, input, hidden, past, emptyPast, layers\)/);
  assert.match(src, /presents\(out, past, layers\)/);
  // forget(model) keeps the shared runtime, forget() clears everything (Montage)
  const fg = src.slice(src.indexOf("function forget("), src.indexOf("var modelsP"));
  assert.match(fg, /if \(!model\) \{ modelsP = \{\}; return tx\("readwrite", function \(s\) \{ s\.clear\(\); \}\)/);
  assert.match(fg, /RUNTIME\.indexOf\(f\.name\) < 0\) s\.delete\(f\.key\)/);   // both runtime builds stay
  assert.match(src, /prepare: function \(model, onProgress, signal\)/);
});

test("voiceText / voiceJoin: clean cues, never lose what the box holds", () => {
  assert.equal(C.voiceText([{ text: " Hello " }, { text: "[Music]" }, { text: "(applause)" }, { text: "Hello" }, { text: "there\n" }]), "Hello there");
  assert.equal(C.voiceText([{ text: "Γεια" }, { text: "Γεια" }, { text: "σου" }]), "Γεια σου");
  assert.equal(C.voiceText(null), "");
  assert.equal(C.voiceText([{ text: "x".repeat(30000) }]).length, 20000);
  assert.equal(C.voiceJoin("", "Hi"), "Hi");
  assert.equal(C.voiceJoin("   ", "Hi"), "Hi");
  assert.equal(C.voiceJoin("Remind me ", "tomorrow"), "Remind me tomorrow");
});

test("assistant.js: microphone records locally, text goes to the box, nothing is sent by itself", () => {
  const src = read("assistant/assistant.js");
  const vo = src.slice(src.indexOf("// ---------- 13a. Voice input"), src.indexOf("// ---------- 13. Wiring & boot"));
  assert.ok(vo.length > 1000);
  assert.doesNotMatch(vo, /SpeechRecognition|webkitSpeech|send\(\)/);
  assert.doesNotMatch(vo, /fetch\(/);                      // the sound goes nowhere: asr.js runs it here
  assert.match(vo, /sc\.src = "\.\.\/montage\/asr\.js"/);
  assert.match(vo, /box\.value = C\.voiceJoin\(box\.value, text\)\.slice\(0, MAX_INPUT\)/);
  assert.match(vo, /model: prefs\.voice \|\| "tiny"/);
  assert.match(vo, /var VO_MAX_MS = 120000;/);
  // the model downloads before the first recording
  const ask = vo.slice(vo.indexOf("function voAsk("), vo.indexOf("function voFetch("));
  assert.match(ask, /voFetch\(ASR, want\)/);
  assert.match(ask, /LANG === "el" \? "base" : "tiny"/);
  assert.match(vo, /ASR\.prepare\(model,/);
  // the stream is released after each recording
  assert.match(vo, /getTracks\(\)\.forEach\(function \(tr\) \{ try \{ tr\.stop\(\); \}/);
  // device-local choice, only known values
  assert.match(src, /if \(p\.voice === "tiny" \|\| p\.voice === "base"\) prefs\.voice = p\.voice;/);
  assert.match(src, /\$\("mic-btn"\)\.addEventListener\("click", voTap\)/);
  assert.match(src, /tg && tg\.listen === 1 && !busy && !document\.querySelector\("dialog\[open\]"\)\) \{ newChat\(\); voTap\(\); return true; \}/);
  assert.match(src, /voSettings\(body\)/);
  const html = read("assistant/index.html");
  assert.match(html, /<button type="button" class="icon-btn mic" id="mic-btn"[^>]*hidden>/);
  assert.match(html, /id="vo-note" class="vo-note" role="status" hidden/);
  assert.ok(html.indexOf('id="mic-btn"') < html.indexOf('id="send-btn"'));
});

test("voice strings in English, Greek and German", () => {
  const src = read("assistant/assistant.js"), de = read("i18n/de/assistant.js");
  const keys = ["vo.btn", "vo.stop", "vo.rec", "vo.run", "vo.dl", "vo.title", "vo.need", "vo.tiny", "vo.base", "vo.go",
    "vo.none", "vo.fail", "vo.net", "vo.mic", "vo.max", "set.voice", "set.voiceNone", "set.voiceHas", "set.voiceRm", "set.voiceHint"];
  keys.forEach((k) => {
    const n = src.split('"' + k + '":').length - 1;
    assert.equal(n, 2, k + " in EN and EL");
    assert.ok(de.indexOf('"' + k + '":') > 0, k + " in DE");
  });
});

test("single app: Speak shortcut opens the Assistant listening", () => {
  assert.deepEqual(S.APPS.assistant.shortcuts.map((x) => x.do), ["speak", "brief"]);
  assert.deepEqual(S.shortcut("assistant", "speak").target, { listen: 1 });
  const m = JSON.parse(read("assistant/manifest.webmanifest"));
  assert.ok(m.shortcuts.some((x) => /do=speak/.test(x.url)), "manifest has the Speak shortcut");
  assert.match(read("i18n/de/solo.js"), /"sc\.assistant\.speak": "Sprechen"/);
});
