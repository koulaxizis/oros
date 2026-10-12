// Pure logic of the Case Converter (textcase/core.js): Greek upper and
// lower case (accents, diaeresis, final sigma), sentence and title
// case, Greek → Latin (ELOT 743, Greeklish), mixed letters, code
// cases, Unicode styles and back, My words (the merge of sync slice
// "textcase"), prefs; plus the wiring of the app.
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const C = require(path.join(__dirname, "..", "textcase/core.js"));
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const cv = (m, s, o) => C.convert(m, s, o).text;

test("Greek UPPERCASE: no accents, diaeresis kept or added, lone ή keeps it", () => {
  assert.equal(C.upper("καλημέρα κόσμε"), "ΚΑΛΗΜΕΡΑ ΚΟΣΜΕ");
  assert.equal(C.upper("τσάι ρολόι κέικ Μάιος"), "ΤΣΑΪ ΡΟΛΟΪ ΚΕΪΚ ΜΑΪΟΣ");
  assert.equal(C.upper("αϊτός προϋπόθεση ΐ"), "ΑΪΤΟΣ ΠΡΟΫΠΟΘΕΣΗ Ϊ");
  assert.equal(C.upper("ευχή είναι ουρανός"), "ΕΥΧΗ ΕΙΝΑΙ ΟΥΡΑΝΟΣ", "accent on the second vowel: still a diphthong");
  assert.equal(C.upper("άυλος"), "ΑΫΛΟΣ");
  assert.equal(C.upper("εσύ ή εγώ; ήλιος"), "ΕΣΥ Ή ΕΓΩ; ΗΛΙΟΣ");
  assert.equal(C.upper("ὁ Ἀθηναῖος"), "Ο ΑΘΗΝΑΙΟΣ", "polytonic marks go too");
  assert.equal(C.upper("ΚΑΛΗΜΈΡΑ"), "ΚΑΛΗΜΕΡΑ");
});

test("lowercase: final sigma, Turkish and German through the language", () => {
  assert.equal(C.lower("ΟΔΟΣ ΑΣΤΕΡΟΣ. Σ ΚΑΛΗΜΕΡΑ,ΤΟΣ (ΜΑΣ)"), "οδος αστερος. σ καλημερα,τος (μας)");
  assert.equal(C.fixSigma("σοφοσ καςα"), "σοφος κασα");
  assert.equal(C.upper("istanbul", "tr"), "İSTANBUL");
  assert.equal(C.lower("ISPARTA", "tr"), "ısparta");
  assert.equal(C.upper("straße"), "STRASSE");
  assert.equal(C.upper("café"), "CAFÉ", "other languages keep their accents");
});

test("Sentence case: Greek question mark, abbreviations, new lines, English I", () => {
  assert.equal(cv("sentence", "ΓΕΙΑ ΣΟΥ. ΤΙ ΚΑΝΕΙΣ; ΚΑΛΑ π.χ. ΑΥΤΟ\nνέα γραμμή"),
    "Γεια σου. Τι κανεις; Καλα π.χ. αυτο\nΝέα γραμμή");
  assert.equal(cv("sentence", "hello; world. «ok» yes! i think i'm fine"), "Hello; world. «Ok» yes! I think I'm fine",
    "; ends a sentence only after Greek");
  assert.equal(cv("sentence", "όλα καλά."), "Όλα καλά.", "the capital keeps its accent");
  assert.equal(cv("sentence", "3 apples. e.g. pears"), "3 apples. E.g. pears");
  assert.equal(cv("sentence", "we met nasa", { words: ["NASA"] }), "We met NASA");
});

test("Title Case and Capitalize Each Word", () => {
  assert.equal(cv("title", "THE LORD OF THE RINGS: the return of the king"), "The Lord of the Rings: The Return of the King");
  assert.equal(cv("title", "ο άρχοντας των δαχτυλιδιών και η επιστροφή του βασιλιά"),
    "Ο Άρχοντας των Δαχτυλιδιών και η Επιστροφή του Βασιλιά");
  assert.equal(cv("title", "a tale of two cities of"), "A Tale of Two Cities Of", "first and last word always");
  assert.equal(cv("title", "don't stop well-known"), "Don't Stop Well-Known");
  assert.equal(cv("capital", "the lord of the rings"), "The Lord Of The Rings");
  assert.equal(cv("title", "my iphone on wi-fi at mcdonald's", { words: ["iPhone", "Wi-Fi", "McDonald's"] }),
    "My iPhone on Wi-Fi at McDonald's");
});

test("tOGGLE and aLtErNaTiNg keep the final sigma right", () => {
  assert.equal(cv("toggle", "hELLO ΚΑΛΗΜΈΡΑ"), "Hello καλημέρα");
  assert.equal(cv("toggle", "ΚΌΣΜΟΣ"), "κόσμος");
  assert.equal(cv("alt", "hello κόσμος"), "hElLo ΚόΣμΟς");
});

test("Remove accents", () => {
  assert.equal(cv("noaccents", "καλημέρα αϊτός café naïve Ήλιος"), "καλημερα αιτος cafe naive Ηλιος");
});

test("Greek → Latin: ELOT 743 and Greeklish", () => {
  assert.equal(cv("elot", "Θεσσαλονίκη ΘΕΣΣΑΛΟΝΙΚΗ Χρήστος ψάρι"), "Thessaloniki THESSALONIKI Christos psari");
  assert.equal(cv("elot", "Αύγουστος ευχαριστώ Ευάγγελος αυτό"), "Avgoustos efcharisto Evangelos afto");
  assert.equal(cv("elot", "Μπάμπης λάμπα Σάμπ αγγελος άγχος έλεγξε"), "Bampis lampa Sab angelos anchos elenxe");
  assert.equal(cv("elot", "αϋπνία Ουρανός Ψ"), "aypnia Ouranos Ps");
  assert.equal(cv("greeklish", "Καλημέρα Χρήστο, τι κάνεις; Μπαμπάς ευχαριστώ ουρανός"),
    "Kalhmera Xrhsto, ti kaneis; Bampas euxaristw ouranos");
  assert.equal(cv("elot", "Hello κόσμε 123"), "Hello kosme 123", "other text untouched");
});

test("Fix mixed letters", () => {
  const r = C.convert("mixed", "ΑΘHΝΑ και Aθήνα, Hello wοrld, ΑΒΕ test, ΧΑΡΑ");
  assert.equal(r.text, "ΑΘΗΝΑ και Αθήνα, Hello world, ΑΒΕ test, ΧΑΡΑ");
  assert.equal(r.n, 3);
  assert.ok(/Η/.test(r.text.split(" ")[0]) && !/[A-Z]/.test(r.text.split(" ")[0]));
  assert.equal(C.convert("mixed", "nothing here").n, 0);
});

test("Code cases, per line, Greek in Latin letters or kept", () => {
  assert.equal(cv("camel", "Hello world API\nΚαλημέρα κόσμε\nparseHTMLString"), "helloWorldApi\nkalimeraKosme\nparseHtmlString");
  assert.equal(cv("pascal", "hello world"), "HelloWorld");
  assert.equal(cv("snake", "XMLHttpRequest v2"), "xml_http_request_v2");
  assert.equal(cv("kebab", "Καλή χρονιά", { keepGreek: true }), "καλη-χρονια");
  assert.equal(cv("constant", "Καλή χρονιά"), "KALI_CHRONIA");
  assert.equal(cv("dot", "a b"), "a.b");
  assert.equal(cv("path", "src Main file"), "src/main/file");
  assert.equal(cv("train", "hello big world"), "Hello-Big-World");
  assert.equal(cv("snake", "one\n\n  two  words "), "one\n\ntwo_words");
});

test("Styles: Latin, digits, Greek where Unicode has it, and back to plain", () => {
  assert.equal(cv("bold", "Hi 12 Αω"), "𝐇𝐢 𝟏𝟐 𝚨𝛚");
  assert.equal(cv("italic", "h"), "ℎ", "the italic h lives elsewhere");
  assert.equal(cv("double", "CHR"), "ℂℍℝ");
  assert.equal(cv("mono", "Γα"), "Γα", "no Greek monospace: unchanged");
  assert.equal(cv("smallcaps", "Hi"), "Hɪ");
  assert.equal(cv("wide", "A b!"), "Ａ　ｂ！");
  assert.equal(cv("circled", "a1 0"), "ⓐ① ⓪");
  assert.equal(cv("strike", "ab c"), "a̶b̶ c̶");
  for (const st of C.STYLES) {
    const s = "Hello World 123 Αθήνα";
    assert.equal(cv("plain", cv(st, s)), s, st);
  }
});

test("Selection only converts the range; counts", () => {
  const r = C.convertRange("upper", "one two three", 4, 7);
  assert.deepEqual(r, { text: "one TWO three", n: 0, start: 4, end: 7 });
  assert.equal(C.convertRange("upper", "ab", 1, 1).text, "AB", "empty range: all");
  assert.equal(C.convertRange("elot", "α θ", 2, 3).end, 4, "the range grows with the result");
  assert.deepEqual(C.counts("Γεια σου κόσμε\nhello 👍🏽 don't"), { chars: 28, words: 5, lines: 2 });
  assert.deepEqual(C.counts(""), { chars: 0, words: 0, lines: 0 });
});

test("language detection", () => {
  assert.equal(C.langOf("Καλημέρα hello"), "el");
  assert.equal(C.langOf("hello world κ"), "en");
  assert.equal(C.langOf("anything", "tr"), "tr");
  assert.equal(C.langOf("x", "xx"), "en");
});

test("My words: seed, add, remove, merge (symmetric, canonical, tombstones)", () => {
  const s = C.seeded(null);
  assert.equal(s.words.length, C.SEEDS.length);
  assert.ok(s.words.every((w) => w.m === 1 && w.id === C.wordId(w.w)));
  assert.deepEqual(s.words.map((w) => w.id), s.words.map((w) => w.id).slice().sort());
  // a device with deletions is not re-seeded
  const del = C.removeWord(s, C.wordId("PDF"), 100);
  assert.ok(!del.words.some((w) => w.w === "PDF"));
  assert.equal(C.seeded(del).words.length, C.SEEDS.length - 1);
  assert.equal(C.seeded({ ver: 1, words: [], tombs: { [C.wordId("x")]: 5 } }).words.length, 0);
  // a fresh device seeding later never brings a deleted word back
  assert.ok(!C.mergeWords(C.seeded(null), del).words.some((w) => w.w === "PDF"));

  let r = C.addWord(s, "  McDonald's ", 200);
  assert.ok(r.ok);
  assert.equal(C.addWord(r.data, "McDonald's", 300).why, "same", "no mtime move without a change");
  const r2 = C.addWord(r.data, "MCDONALD'S", 300);
  assert.equal(r2.data.words.filter((w) => C.foldKey(w.w) === "mcdonald's").length, 1, "same id, new casing");
  assert.equal(C.addWord(s, "two words", 1).why, "bad");
  assert.equal(C.addWord(s, "x".repeat(41), 1).why, "bad");
  assert.equal(C.addWord(s, "<b>", 1).why, "bad");
  assert.equal(C.addWord(s, "...", 1).why, "bad");

  const A = r.data, B = C.removeWord(C.addWord(s, "orOS", 50).data, C.wordId("NASA"), 400);
  const ab = C.mergeWords(A, B), ba = C.mergeWords(B, A);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba), "symmetric (R5)");
  assert.equal(JSON.stringify(C.mergeWords(ab, ab)), JSON.stringify(ab), "idempotent (R26)");
  assert.ok(!ab.words.some((w) => w.w === "NASA") && ab.words.some((w) => w.w === "McDonald's"));
  // delete wins ties; a newer edit resurrects
  const id = C.wordId("Zed");
  const tie = C.mergeWords({ words: [{ id, w: "Zed", m: 9 }] }, { tombs: { [id]: 9 } });
  assert.equal(tie.words.length, 0);
  const back = C.mergeWords(tie, { words: [{ id, w: "ZED", m: 10 }] });
  assert.equal(back.words[0].w, "ZED");
  // equal m: larger canonical JSON wins on both sides
  const x1 = { id, w: "Zed", m: 3 }, x2 = { id, w: "ZED", m: 3 };
  assert.equal(C.mergeWords({ words: [x1] }, { words: [x2] }).words[0].w, C.mergeWords({ words: [x2] }, { words: [x1] }).words[0].w);
  // junk is dropped
  const junk = C.mergeWords({ words: [{ id: "wx", w: "Zed", m: 1 }, { id, w: "Zed", m: -1 }, null, "x"], tombs: { bad: 1, [id]: "2" } }, null);
  assert.deepEqual(junk, { ver: 1, words: [], tombs: {} });
});

test("My words cap", () => {
  let d = { ver: 1, words: [], tombs: {} };
  for (let i = 0; i < C.MAX_WORDS; i++) d = C.addWord(d, "w" + i, 10).data;
  assert.equal(d.words.length, C.MAX_WORDS);
  assert.equal(C.addWord(d, "more", 11).why, "full");
  assert.ok(C.addWord(d, "W1", 11).ok, "changing an existing word is allowed");
});

test("prefs: defaults and validation", () => {
  assert.deepEqual(C.readPrefs(null), { tab: "basic", mode: "upper", lang: "auto", sel: false, keepGreek: false });
  assert.deepEqual(C.readPrefs({ tab: "code", mode: "snake", lang: "el", sel: true, keepGreek: true }),
    { tab: "code", mode: "snake", lang: "el", sel: true, keepGreek: true });
  assert.deepEqual(C.readPrefs({ tab: "x", mode: "eval", lang: "fr", sel: "yes" }), C.readPrefs(null));
  for (const m of C.MODES) assert.equal(typeof C.convert(m, "Αβγ abc").text, "string", m);
});

test("wiring: app, palette, sync, deep link, help", () => {
  const js = read("textcase/textcase.js"), html = read("textcase/index.html");
  assert.ok(js.includes("inheritPalette") && js.includes("watchPalette"));            // guard G3
  assert.ok(js.includes('api.registerSlice("textcase", sliceGet, sliceSet, C.DATA_KEY, C.mergeWords)'));
  const core = read("textcase/core.js");
  assert.ok(core.includes('"oros-textcase-data"') && core.includes('"oros-textcase-prefs"') && core.includes('"oros-textcase-draft"'));
  assert.equal((js.match(/window\.__orosOpenAt = /g) || []).length, 1);
  assert.ok(js.includes('__orosTakeTarget("textcase")'));
  assert.ok(html.indexOf("core.js") < html.indexOf("textcase.js"));
  assert.ok(!/innerHTML\s*=(?!\s*ICON\.)/.test(js), "no innerHTML except the icons");
  assert.ok(!/\b(alert|confirm|prompt)\(/.test(js), "R14");
  for (const f of ["help.en.txt", "help.el.txt"]) assert.ok(fs.existsSync(path.join(__dirname, "..", "textcase", f)));
  for (const f of ["textcase/core.js", "textcase/textcase.js"]) assert.ok(!/[\u2028\u2029\ufeff]/.test(read(f)), f);
  // every key the app uses exists in both languages
  const en = js.slice(js.indexOf("en: {"), js.indexOf("el: {")), el = js.slice(js.indexOf("el: {"), js.indexOf("function t("));
  const keys = [...en.matchAll(/"([a-z]+\.[A-Za-z0-9.]+)":/g)].map((m) => m[1]);
  for (const k of keys) assert.ok(el.includes('"' + k + '":'), "el " + k);
  for (const m of C.MODES) if (!C.TABS.code.includes(m)) assert.ok(keys.includes("m." + m), "label " + m);
});
