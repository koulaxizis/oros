// orOS voices (VOICE-3): English text to Kokoro's phonemes (voicekit/
// english.js), Kokoro's input (voicekit/kokoro.js) and the English
// voices Heart and Michael in voicekit/voicekit.js. Words come from
// misaki's dictionaries, which the voice downloads (koulaxizis/
// oros-models-vision misaki-en/); here a few entries stand in for them.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const E = require(path.join(ROOT, "voicekit", "english.js"));
const K = require(path.join(ROOT, "voicekit", "kokoro.js"));
const V = require(path.join(ROOT, "voicekit", "voicekit.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const GOLD = {
  hello: "həlˈO", world: "wˈɜɹld", read: { DEFAULT: "ɹˈid", VBD: "ɹˈɛd" }, walk: "wˈɔk", stop: "stˈɑp",
  box: "bˈɑks", drop: "dɹˈɑp", play: "plˈA", carry: "kˈɛɹi", A: "ˈA", oh: "ˈO", dog: "dˈɔɡ", at: "æt"
};
const SILVER = { hello: "wrong", gizmo: "ɡˈɪzmO" };

test("words: the dictionary first (gold, then silver), in any case", () => {
  E.lexicon(GOLD, SILVER);
  assert.equal(E.word("hello"), "həlˈO");
  assert.equal(E.word("Hello"), "həlˈO");
  assert.equal(E.word("HELLO"), "həlˈO");
  assert.equal(E.word("gizmo"), "ɡˈɪzmO");
  assert.equal(E.word("read"), "ɹˈid");          // no tagger: the DEFAULT entry
  assert.equal(E.how("hello"), "dict");
});

test("words: endings on a known stem, two known words, letters, orOS", () => {
  E.lexicon(GOLD, SILVER);
  const cases = {
    walks: "wˈɔks", walked: "wˈɔkt", walking: "wˈɔkɪŋ", stopped: "stˈɑpt", stopping: "stˈɑpɪŋ",
    boxes: "bˈɑksᵻz", plays: "plˈAz", played: "plˈAd", carried: "kˈɛɹid",
    dropbox: "dɹˈɑpbˌɑks", USB: "jˌuˌɛsbˈi", PDF: "pˌidˌiˈɛf", orOS: "ˈɔɹˌOs"
  };
  for (const [w, ph] of Object.entries(cases)) assert.equal(E.word(w), ph, w);
  assert.equal(E.how("walked"), "stem");
  assert.equal(E.how("dropbox"), "compound");
  assert.equal(E.how("USB"), "spell");
  // a word nobody knows is still read, with a stress
  assert.match(E.word("flimber"), /^[^ ]*ˈ/);
  assert.equal(E.how("flimber"), "rules");
});

test("text: numbers, money, times, ordinals and short forms become words", () => {
  E.lexicon(GOLD, SILVER);
  assert.equal(E.number(0), "zero");
  assert.equal(E.number(21), "twenty one");
  assert.equal(E.number(115), "one hundred fifteen");
  assert.equal(E.number(2026), "two thousand twenty six");
  assert.equal(E.ordinal(3), "third");
  assert.equal(E.ordinal(22), "twenty second");
  const w = (t) => E.words(t).replace(/\s+/g, " ").replace(/ ([,.])/g, "$1").trim();
  assert.equal(w("In 1999, 25% of 1,234 users"), "In nineteen ninety nine, twenty five percent of one thousand two hundred thirty four users");
  assert.equal(w("It costs $3.50"), "It costs three dollars and fifty cents");
  assert.equal(w("€12.50"), "twelve euros and fifty cents");
  assert.equal(w("at 9:05 AM on the 3rd"), "at nine oh five A M on the third");
  assert.equal(w("e.g. Dr. Smith vs. Mr. Jones"), "for example Doctor Smith versus Mister Jones");
});

test("sentences: one entry per sentence, the, a and to said lighter", () => {
  E.lexicon(GOLD, SILVER);
  const s = E.sentences("Hello world! A dog at 9:05 AM.");
  assert.deepEqual(s.map((x) => x.text), ["Hello world!", "A dog at nine oh five A M ."]);
  assert.equal(s[0].ph, "həlˈO wˈɜɹld!");
  assert.match(s[1].ph, /^ɐ dˈɔɡ/);              // a before a word: ɐ
  assert.match(s[1].ph, /ˈA ˈɛm\.$/);           // but the A of A M is a letter
  assert.equal(E.sentences("the end")[0].ph.slice(0, 2), "ði");
  assert.deepEqual(E.sentences(""), []);
  assert.deepEqual(E.sentences("  \n "), []);
});

test("text: never runs code or keeps markup, any input gives plain phonemes", () => {
  E.lexicon(GOLD, SILVER);
  const s = E.sentences("<img src=x onerror=alert(1)> Ok?");
  assert.ok(s.every((x) => !/[<>=()]/.test(x.ph)));
  assert.doesNotThrow(() => E.sentences(null));
  assert.doesNotThrow(() => E.sentences("😀 🎉 \u0000 ∑∫"));
  assert.doesNotThrow(() => E.lexicon(null, "x"));
  assert.equal(E.word(""), "");
});

test("kokoro: ids from the tokenizer, long sentences cut to fit, the style row for the length", () => {
  const vocab = K.vocabOf({ model: { vocab: { "$": 0, ",": 3, ".": 4, " ": 16, "a": 43, "b": 44, "ˈ": 156, "O": 31 } } });
  assert.deepEqual(K.ids("ˈab.", vocab), [156, 43, 44, 4]);
  assert.deepEqual(K.ids("a☃b", vocab), [43, 44]);
  assert.deepEqual(K.vocabOf(null), {});
  assert.deepEqual(K.chunks("ab ab", vocab), ["ab ab"]);
  const long = Array(10).fill("ab ab, ab").join(" ");
  const parts = K.chunks(long, vocab, 20);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => K.ids(p, vocab).length <= 20), parts.join("|"));
  assert.equal(parts.join(" ").replace(/\s+/g, " "), long);
  assert.deepEqual(K.chunks("", vocab), []);
  const table = new Float32Array(510 * 256).map((_, i) => Math.floor(i / 256));
  assert.equal(K.style(table, 7)[0], 7);
  assert.equal(K.style(table, 7).length, 256);
  assert.equal(K.style(table, 9999)[0], 509);
  assert.equal(K.MAX, 510);
});

test("voicekit: the English voices Heart and Michael share one model, free for any use", () => {
  assert.equal(V.forLang("en"), "en-heart");
  assert.equal(V.forLang("en-GB"), "en-heart");
  assert.deepEqual(V.ofLang("en"), ["en-heart", "en-michael"]);
  assert.deepEqual(V.ofLang("el"), ["el-joy"]);
  for (const id of ["en-heart", "en-michael"]) {
    const v = V.VOICES[id];
    assert.equal(v.engine, "kokoro");
    assert.equal(v.licence, "Apache-2.0");
    assert.equal(v.free, true);
    assert.equal(V.G2P[v.g2p], "EnglishVoice");
    for (const r of ["model", "config", "style", "gold", "silver"]) assert.match(v[r].sha, /^[0-9a-f]{64}$/, id + " " + r);
    assert.ok(v.model.size < 95e6);
  }
  const h = V.filesOf("en-heart"), m = V.filesOf("en-michael");
  const shared = h.filter((f) => m.some((g) => g.key === f.key)).map((f) => f.role);
  assert.deepEqual(shared, ["model", "config", "gold", "silver"]);
  assert.equal(h.find((f) => f.role === "style").path, "kokoro-82m/voices/af_heart.bin");
  assert.equal(m.find((f) => f.role === "style").path, "kokoro-82m/voices/am_michael.bin");
  assert.equal(h.find((f) => f.role === "gold").path, "misaki-en/us_gold.json");
  // the Piper voices keep the keys of 1.0, so a downloaded voice stays
  assert.deepEqual(V.filesOf("el-joy").map((f) => f.key), ["el-joy:model", "el-joy:config"]);
  assert.ok(fs.existsSync(path.join(ROOT, "voicekit", "kokoro.js")));
});

test("wiring: the shell offers both voices in one download, Settings lists each, the worker runs Kokoro", () => {
  const shell = read("shell.js"), st = read("settings/settings.js"), worker = read("voicekit/worker.js");
  assert.match(shell, /en: \["en-heart", "en-michael"\]/);
  assert.match(shell, /OV\.download\(k,/);
  assert.match(shell, /OV\.forget\(ids\)/);
  assert.match(shell, /k: "cr\.kokoro"/);
  assert.match(shell, /k: "cr\.misaki"/);
  assert.match(st, /nv\.voices \|\|/);
  assert.match(st, /ac\.read\.nat\.many/);
  assert.match(worker, /importScripts\(m\.kokoro\)/);
  assert.match(worker, /input_ids/);
  assert.doesNotMatch(worker, /fetch\(/);
  const C = require(path.join(ROOT, "settings", "core.js"));
  for (const l of ["en", "el"]) assert.notEqual(C.t(l, "ac.read.nat.many"), "ac.read.nat.many", l);
  assert.ok(read("i18n/de/settings.js").includes('"ac.read.nat.many"'));
  for (const k of ["cr.kokoro", "cr.misaki"]) assert.ok(read("i18n/de/shell.js").includes('"' + k + '"'), "de " + k);
  for (const f of ["settings/help.en.txt", "settings/help.el.txt", "i18n/de/help/settings.txt"]) assert.match(read(f), /Michael/, f);
  assert.match(read("CREDITS.md"), /Kokoro-82M/);
  assert.match(read("CREDITS.md"), /misaki/);
});
