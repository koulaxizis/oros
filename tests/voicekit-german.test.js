// orOS voices (VOICE-2): German text to phonemes (voicekit/german.js) and
// the German voice in voicekit/voicekit.js. The phonemes are checked
// against what espeak-ng gives the same words (tests/fixtures/
// voicekit-german.tsv), because the German Piper voices learned
// espeak-ng's phonemes; espeak-ng itself is never part of orOS.
// German spelling says less about stress than Greek (compounds, foreign
// words), so the bar is lower than Greek's 99%: most misses are where a
// light or main stress falls, which the voice still says clearly.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const G = require(path.join(ROOT, "voicekit", "german.js"));
const V = require(path.join(ROOT, "voicekit", "voicekit.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const strip = (s) => s.replace(/[ˈˌ]/g, "");

test("words: the fixture words sound as espeak-ng says them (75% exactly, 80% the same sounds)", () => {
  const rows = read("tests/fixtures/voicekit-german.tsv").split("\n")
    .filter((l) => l && l[0] !== "#").map((l) => l.split("\t"));
  assert.ok(rows.length >= 3500);
  let exact = 0, sounds = 0;
  const bad = [];
  for (const [w, e] of rows) {
    const g = G.word(w).normalize("NFD"), want = e.normalize("NFD");
    if (g === want) exact++; else bad.push(w + "=" + g + "≠" + want);
    if (strip(g) === strip(want)) sounds++;
  }
  const a = exact / rows.length, b = sounds / rows.length;
  assert.ok(a >= 0.75, `exact only ${(a * 100).toFixed(1)}%; first misses: ${bad.slice(0, 8).join(" ")}`);
  assert.ok(b >= 0.80, `sounds only ${(b * 100).toFixed(1)}%`);
});

test("words: the rules of German spelling", () => {
  const cases = {
    "Sprechen": "ʃpɾˈɛçən", "Stadt": "ʃtˈat", "Schritt": "ʃrˈɪt",            // sp st at the start, r after ʃ
    "ich": "ɪç", "nach": "nˈɑːx", "Buch": "bˈuːx", "Nacht": "nˈaxt",          // ich-Laut, ach-Laut
    "sechs": "zˈɛks", "Tag": "tˈɑːk", "Tage": "tˈɑːɡə",                       // chs, final devoicing
    "zwei": "tsvˈaɪ", "Leute": "lˈɔøtə", "Haus": "hˈaʊs",                     // z w, diphthongs
    "Wörter": "vˈœɾtɜ", "Fenster": "fˈɛnstɜ", "lesen": "lˈeːzən",             // -er, s between vowels
    "Ausgabe": "ˈaʊsɡˌɑːbə", "Synchronisierung": "zˌʏnkɾoːniːzˈiːrʊŋ",
    "Information": "ˌɪnfɔɾmatsjˈoːn", "Datei": "datˈaɪ", "Tabelle": "tabˈɛlə",  // stressed foreign endings
    "Familie": "famˈiːlɪə", "verändern": "fɛɾˈɛndɜn", "zurück": "tsuːrˈʏk",
    "und": "ˈʊnt", "der": "dɛɾ", "eine": "ˌaɪnə",                              // short words
    "PDF": "pˌeːdˌeːˈɛf", "orOS": "ˈoːɾ ˈoːs"
  };
  for (const [w, ph] of Object.entries(cases)) assert.equal(G.word(w).normalize("NFD"), ph.normalize("NFD"), w);
});

test("sentences: one entry per sentence, short words lose their stress inside one", () => {
  const s = G.sentences("Hallo Welt! Wie geht es dir? Gut und schön.");
  assert.deepEqual(s.map((x) => x.text), ["Hallo Welt!", "Wie geht es dir?", "Gut und schön."]);
  assert.equal(s[2].ph, "ɡˈuːt ʊnt ʃˈøːn.");
  assert.deepEqual(G.sentences(""), []);
  assert.deepEqual(G.sentences("  \n "), []);
});

test("text: numbers, money, dates, times and short forms become words", () => {
  assert.equal(G.number(0), "null");
  assert.equal(G.number(21), "ein und zwanzig");
  assert.equal(G.number(115), "ein hundert fünfzehn");
  assert.equal(G.number(2026), "zwei tausend sechs und zwanzig");
  assert.equal(G.ordinal(3), "dritte");
  assert.equal(G.ordinal(20), "zwanzigste");
  const w = (t) => G.words(t).replace(/\s+/g, " ").trim();
  assert.equal(w("Es kostet 12,50 €"), "Es kostet zwölf Euro fünfzig");
  assert.equal(w("am 5.12.2026"), "am fünfte Dezember zwei tausend sechs und zwanzig");
  assert.equal(w("im Jahr 1999"), "im Jahr neunzehn hundert neun und neunzig");
  assert.equal(w("um 14:30 Uhr"), "um vierzehn Uhr dreißig");
  assert.equal(w("2.345 Dateien"), "zwei tausend drei hundert fünf und vierzig Dateien");
  assert.equal(w("1,5 Liter"), "eins Komma fünf Liter");
  assert.equal(w("24% mehr"), "vier und zwanzig Prozent mehr");
  assert.equal(w("der 3. Platz"), "der dritte Platz");
  assert.equal(w("z.B. das, usw."), "zum Beispiel das, und so weiter");
});

test("text: never runs code or keeps markup, any input gives plain phonemes", () => {
  const s = G.sentences("<img src=x onerror=alert(1)> Gut?");
  assert.ok(s.every((x) => !/[<>=()]/.test(x.ph)));
  assert.doesNotThrow(() => G.sentences(null));
  assert.doesNotThrow(() => G.sentences("😀 🎉 \u0000 ∑∫"));
  assert.equal(G.word(""), "");
  assert.equal(G.word("123"), "");
});

test("voicekit: Piper 1.5 vowel pairs are one id, older voices read them apart", () => {
  const map = { "_": [0], "^": [1], "$": [2], "a": [14], "ɪ": [74], "aɪ": [161], "t": [32] };
  assert.deepEqual(V.idsOf("taɪ", map, [["a", "ɪ"]]), [1, 0, 32, 0, 161, 0, 2]);
  assert.deepEqual(V.idsOf("taɪ", map), [1, 0, 32, 0, 14, 0, 74, 0, 2]);
  assert.deepEqual(V.idsOf("taɪ", { ...map, "aɪ": undefined }, [["a", "ɪ"]]), [1, 0, 32, 0, 14, 0, 74, 0, 2]);
});

test("voicekit: the German voice Thorsten from orOS's own copy, SHA-256 pinned, free for any use", () => {
  assert.equal(V.forLang("de"), "de-thorsten");
  assert.equal(V.forLang("de-AT"), "de-thorsten");
  assert.equal(V.forLang("el"), "el-joy");
  const v = V.VOICES["de-thorsten"];
  assert.equal(v.licence, "CC0");
  assert.equal(v.free, true);
  assert.equal(V.VOICES["el-joy"].free, false);
  assert.equal(v.g2p, "german");
  assert.equal(V.G2P[v.g2p], "GermanVoice");
  assert.equal(V.G2P[V.VOICES["el-joy"].g2p], "GreekVoice");
  assert.match(v.model.sha, /^[0-9a-f]{64}$/);
  assert.match(v.config.sha, /^[0-9a-f]{64}$/);
  assert.ok(v.model.size < 95e6);
  for (const id of Object.keys(V.VOICES)) assert.ok(fs.existsSync(path.join(ROOT, "voicekit", V.VOICES[id].g2p + ".js")), id);
});

test("wiring: the shell offers Thorsten, Settings states each licence, the worker loads the voice's language", () => {
  const shell = read("shell.js"), st = read("settings/settings.js"), worker = read("voicekit/worker.js");
  assert.match(shell, /de: "de-thorsten"/);
  assert.match(shell, /k: "cr\.piper-thorsten"/);
  assert.match(st, /ac\.read\.nat\.hint" \+ free/);
  assert.match(worker, /importScripts\(m\.g2p\)/);
  assert.doesNotMatch(worker, /GreekVoice/);
  assert.doesNotMatch(worker, /fetch\(/);
  const C = require(path.join(ROOT, "settings", "core.js"));
  for (const k of ["ac.read.nat.hint.free", "ac.read.nat.ready.free"]) {
    for (const l of ["en", "el"]) assert.notEqual(C.t(l, k), k, l + " " + k);
    assert.ok(read("i18n/de/settings.js").includes('"' + k + '"'), "de " + k);
  }
  for (const f of ["settings/help.en.txt", "settings/help.el.txt", "i18n/de/help/settings.txt"]) assert.match(read(f), /Thorsten/, f);
  assert.match(read("CREDITS.md"), /de_DE-thorsten-medium/);
});
