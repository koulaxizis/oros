// orOS voices (VOICE-1): Greek text to phonemes (voicekit/greek.js) and
// the pure helpers of voicekit/voicekit.js. The phonemes are checked
// against what espeak-ng gives the same words (tests/fixtures/
// voicekit-greek.tsv), because the Greek Piper voices learned
// espeak-ng's phonemes; espeak-ng itself is never part of orOS.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const G = require(path.join(ROOT, "voicekit", "greek.js"));
const V = require(path.join(ROOT, "voicekit", "voicekit.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("words: at least 99% of the fixture words sound as espeak-ng says them", () => {
  const rows = read("tests/fixtures/voicekit-greek.tsv").split("\n")
    .filter((l) => l && l[0] !== "#").map((l) => l.split("\t"));
  assert.ok(rows.length > 3000);
  const bad = rows.filter(([w, e]) => G.word(w).normalize("NFD") !== e);
  const share = 1 - bad.length / rows.length;
  assert.ok(share >= 0.99, `only ${(share * 100).toFixed(2)}%; first misses: ${bad.slice(0, 10).map((b) => b.join("=")).join(" ")}`);
});

test("words: the rules of Greek spelling", () => {
  const cases = {
    "καλημέρα": "kˌalimˈera",       // secondary stress two syllables before
    "μπαμπάς": "babˈas", "ντομάτα": "domˈata", "πάντα": "pˈada",
    "γκρι": "ɡrˈi", "άγγελος": "ˈaŋɡelˌos", "συγχρονισμός": "sˌiŋxronismˈos", "έλεγξε": "ˈeleɣksˌe",
    "τσάι": "tsˈaɪ", "τζάκι": "dzˈaci", "προϊόν": "proɪˈon", "βοηθός": "voɪθˈos",
    "αυγό": "avɣˈo", "ευχαριστώ": "ˌefxaristˈo", "αυτιά": "ˌaftiˈa",
    "και": "ke", "κι": "cˈi", "για": "jˈa", "χρόνια": "xrˈoɲa", "ήλιος": "ˈiʎos", "πιο": "pçˈo",
    "πλαίσιο": "plˈesjo", "άδεια": "ˈaðça", "ίδια": "ˈiðja", "ίδιο": "ˈiðiˌo", "βοήθεια": "voˈiθça",
    "γλώσσα": "ɣlˈossa", "σάββατο": "sˈavatˌo", "λάμψη": "lˈampsi",
    "είναι": "ˌine", "αλλά": "alˌa", "άλλα": "ˈala",           // said lighter, or not
    "ΚΑΛΗΜΕΡΑ": "kˌalimˈera", "καλημερα": "kˌalimˈera"        // no accents: last but one
  };
  for (const [w, ph] of Object.entries(cases)) assert.equal(G.word(w).normalize("NFD"), ph.normalize("NFD"), w);
});

test("sentences: a final ν joins the next word as Greek speakers say it", () => {
  const ph = (t) => G.sentences(t).map((s) => s.ph).join(" | ");
  assert.equal(ph("τον πατέρα"), "tom batˈera");
  assert.equal(ph("τον τοίχο"), "ton dˈixo");
  assert.equal(ph("τον κόσμο"), "toŋ ɡˈosmo");
  assert.equal(ph("την ψυχή"), "tim bziçˈi");
  assert.equal(ph("δεν ξέρω"), "ðˈeŋ ɡzˈero");
  assert.equal(ph("τον βλέπω"), "ton vlˈepo");
});

test("sentences: one entry per sentence, Greek ; is a question, · a pause", () => {
  const s = G.sentences("Γεια σου! Τι κάνεις; Καλά, εσύ· μια χαρά.");
  assert.deepEqual(s.map((x) => x.ph), ["jˈa su!", "tˈi kˈanis?", "kalˈa, esˈi; mɲa xarˈa."]);
  assert.equal(s[1].text, "Τι κάνεις;");
  assert.deepEqual(G.sentences(""), []);
  assert.deepEqual(G.sentences("  \n "), []);
});

test("text: numbers, money, dates, times and short forms become words", () => {
  assert.equal(G.number(0), "μηδέν");
  assert.equal(G.number(21), "είκοσι ένα");
  assert.equal(G.number(115), "εκατόν δεκαπέντε");
  assert.equal(G.number(2026), "δύο χιλιάδες είκοσι έξι");
  assert.equal(G.number(1500), "χίλια πεντακόσια");
  assert.equal(G.number(234000), "διακόσιες τριάντα τέσσερις χιλιάδες");
  assert.equal(G.number(3000000), "τρία εκατομμύρια");
  const w = (t) => G.words(t).replace(/\s+/g, " ").trim();
  assert.equal(w("Έχω 3 μήλα."), "Έχω τρία μήλα.");
  assert.equal(w("Κοστίζει 12,50 €"), "Κοστίζει δώδεκα ευρώ και πενήντα λεπτά");
  assert.equal(w("2.345 ευρώ"), "δύο χιλιάδες τριακόσια σαράντα πέντε ευρώ");
  assert.equal(w("ΦΠΑ 24%"), "φι πι άλφα είκοσι τέσσερα τοις εκατό");
  assert.equal(w("στις 14:30"), "στις δεκατέσσερις και τριάντα");
  assert.equal(w("στις 5/12/2026"), "στις πέντε Δεκεμβρίου δύο χιλιάδες είκοσι έξι");
  assert.equal(w("το 1ο, η 3η, ο 25ος"), "το πρώτο , η τρίτη , ο εικοστός πέμπτος");
  assert.equal(w("π.χ. ένα"), "παραδείγματος χάρη ένα");
  assert.equal(w("κ.λπ."), "και λοιπά");
  assert.equal(w("τηλ. 2101234567"), "τηλέφωνο δύο ένα μηδέν ένα δύο τρία τέσσερα πέντε έξι επτά");
  assert.equal(w("το orOS"), "το οροσ");
});

test("text: never runs code or keeps markup, any input gives plain phonemes", () => {
  const s = G.sentences("<img src=x onerror=alert(1)> Καλό;");
  assert.ok(s.every((x) => !/[<>=()]/.test(x.ph)));
  assert.doesNotThrow(() => G.sentences(null));
  assert.doesNotThrow(() => G.sentences("😀 🎉 \u0000 ∑∫"));
});

test("voicekit: Piper ids are ^ _ (phoneme _)… $ and unknown symbols are skipped", () => {
  const map = { "_": [0], "^": [1], "$": [2], " ": [3], "a": [14], "ˈ": [120], "k": [23] };
  assert.deepEqual(V.idsOf("kˈa", map), [1, 0, 23, 0, 120, 0, 14, 0, 2]);
  assert.deepEqual(V.idsOf("k☃a", map), [1, 0, 23, 0, 14, 0, 2]);
  assert.deepEqual(V.idsOf("", map), [1, 0, 2]);
});

test("voicekit: speed is the length scale, kept in a safe range", () => {
  const cfg = { inference: { noise_scale: 0.6, length_scale: 1, noise_w: 0.8 } };
  assert.deepEqual(V.scalesOf(cfg, 1), [0.6, 1, 0.8]);
  assert.deepEqual(V.scalesOf(cfg, 2), [0.6, 0.5, 0.8]);
  assert.deepEqual(V.scalesOf(cfg, 100), [0.6, 1 / 2.5, 0.8]);
  assert.deepEqual(V.scalesOf({}, "x"), [0.667, 1, 0.8]);
});

test("voicekit: one Greek voice from orOS's own copy, SHA-256 pinned, licence stated", () => {
  assert.equal(V.forLang("el"), "el-joy");
  assert.equal(V.forLang("el-GR"), "el-joy");
  assert.equal(V.forLang("en"), "");
  const v = V.VOICES["el-joy"];
  assert.equal(v.licence, "CC BY-NC 4.0");
  assert.match(v.model.sha, /^[0-9a-f]{64}$/);
  assert.match(v.config.sha, /^[0-9a-f]{64}$/);
  assert.ok(V.MIRROR.startsWith("https://koulaxizis.github.io/oros-models-vision/"));
  assert.equal(V.hex(new Uint8Array([0, 15, 255]).buffer), "000fff");
});

test("wiring: the shell, Read aloud and Settings use the natural voice", () => {
  const shell = read("shell.js"), ra = read("readaloud.js"), st = read("settings/settings.js");
  assert.match(shell, /voicekit\/voicekit\.js\?v=/);
  assert.match(shell, /natural: natFor/);
  assert.match(shell, /case "read\.natGet"/);
  assert.match(ra, /function speakNatural\(nid\)/);
  assert.match(st, /function natRow\(nv\)/);
  const worker = read("voicekit/worker.js");
  assert.doesNotMatch(worker, /fetch\(/);           // the worker never touches the network
  const C = require(path.join(ROOT, "settings", "core.js"));
  for (const k of ["ac.read.nat", "ac.read.nat.opt", "ac.read.nat.hint", "ac.read.nat.ready", "ac.read.nat.get",
    "ac.read.nat.pct", "ac.read.nat.cancel", "ac.read.nat.remove", "ac.read.nat.err"]) {
    for (const l of ["en", "el"]) assert.notEqual(C.t(l, k), k, l + " " + k);
    assert.ok(read("i18n/de/settings.js").includes('"' + k + '"'), "de " + k);
  }
});
