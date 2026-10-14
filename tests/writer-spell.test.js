// Writer spelling (writer/spell.js): the Hunspell-compatible checker
// on the real vendored dictionaries (vendor/hunspell, en_US + el_GR),
// suggestions, Greek accents and capitals, tokens, "my dictionary".
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const S = require(path.join(__dirname, "..", "writer/spell.js"));
const V = path.join(__dirname, "..", "vendor/hunspell");

function load(name, enc) {
  const dec = new TextDecoder(enc);
  return new S.Dictionary(dec.decode(fs.readFileSync(path.join(V, name + ".aff"))),
    dec.decode(zlib.gunzipSync(fs.readFileSync(path.join(V, name + ".dic.gz")))));
}
const en = load("en_US", "utf-8");
const el = load("el_GR", "iso-8859-7");

test("licence files ship with the dictionaries", () => {
  assert.match(fs.readFileSync(path.join(V, "README_en_US.txt"), "utf8"), /Kevin Atkinson/);
  assert.match(fs.readFileSync(path.join(V, "README_el_GR.txt"), "utf8"), /MPL 1\.1\/GPL 2\.0\/LGPL 2\.1/);
});

test("English: words, affixes, case, apostrophes", () => {
  for (const w of ["the", "running", "walked", "cats", "quickly", "reruns", "unhappiness", "don't", "don’t", "Hello", "HELLO", "Paris"])
    assert.equal(en.spell(w), true, w);
  for (const w of ["teh", "recieve", "colour", "paris", "xyzzy", "speling"])
    assert.equal(en.spell(w), false, w);
});

test("English suggestions: best first, in the word's case", () => {
  assert.equal(en.suggest("teh")[0], "the");
  assert.equal(en.suggest("Teh")[0], "The");
  assert.equal(en.suggest("recieve")[0], "receive");
  assert.equal(en.suggest("speling")[0], "spelling");
  assert.equal(en.suggest("paris")[0], "Paris");
  assert.ok(en.suggest("alot").includes("a lot"));
  assert.ok(en.suggest("HELO").includes("HELLO"));
  assert.ok(en.suggest("teh", 3).length <= 3);
});

test("Greek: accents, final sigma, capitals without accents", () => {
  for (const w of ["καλημέρα", "Καλημέρα", "ΚΑΛΗΜΕΡΑ", "σπίτι", "ΣΠΙΤΙ", "Αθήνα", "ΑΘΗΝΑ", "πρωτεΐνη", "ΠΡΩΤΕΪΝΗ", "ΟΔΟΣ", "οδός", "ξαναενοχλούσαμε"])
    assert.equal(el.spell(w), true, w);
  for (const w of ["καλημερα", "σπιτι", "αθήνα", "εισαι", "οδόσ"])
    assert.equal(el.spell(w), false, w);
});

test("Greek suggestions: the accent first", () => {
  assert.equal(el.suggest("καλημερα")[0], "καλημέρα");
  assert.deepEqual(el.suggest("σπιτι"), ["σπίτι"]);
  assert.equal(el.suggest("εισαι")[0], "είσαι");
  assert.equal(el.suggest("ευχαρηστώ")[0], "ευχαριστώ");
  assert.equal(el.suggest("αθηνα")[0], "Αθήνα");
  assert.equal(el.suggest("Καλημερα")[0], "Καλημέρα");
});

test("a tiny dictionary: flags, conditions, cross products, forbidden, needaffix", () => {
  const aff = [
    "SET UTF-8", "TRY abcdefghijklmnopqrstuvwxyz", "FORBIDDENWORD X", "NEEDAFFIX N",
    "PFX U Y 1", "PFX U 0 un .",
    "SFX S Y 2", "SFX S y ies [^aeiou]y", "SFX S 0 s [^y]",
    "SFX D N 1", "SFX D 0 ed [^e]"
  ].join("\n");
  const dic = "5\nhappy/US\ncity/S\nwalk/DU\nwalks/X\nbas/N\n";
  const d = new S.Dictionary(aff, dic);
  assert.equal(d.spell("happy"), true);
  assert.equal(d.spell("unhappy"), true);
  assert.equal(d.spell("cities"), true);
  assert.equal(d.spell("citys"), false);       // condition [^y]
  assert.equal(d.spell("walked"), true);
  assert.equal(d.spell("unwalked"), false);     // D does not cross
  assert.equal(d.spell("walks"), false);        // forbidden word
  assert.equal(d.spell("bas"), false);          // needs an affix
  assert.equal(d.spell("CITIES"), true);
});

test("FLAG long / num", () => {
  const d1 = new S.Dictionary("FLAG long\nSFX Aa Y 1\nSFX Aa 0 s .", "1\ncat/Aa\n");
  assert.equal(d1.spell("cats"), true);
  const d2 = new S.Dictionary("FLAG num\nSFX 12 Y 1\nSFX 12 0 s .", "1\ndog/7,12\n");
  assert.equal(d2.spell("dogs"), true);
  assert.equal(d2.spell("doggs"), false);
});

test("tokens: words with offsets; links, mail, codes and digits skipped", () => {
  const txt = "Hello world, see https://x.com or me@x.gr; 3rd don't Καλημέρα κόσμε! foo_bar abc123 well-known";
  const t = S.tokens(txt);
  assert.deepEqual(t.map(x => x.w), ["Hello", "world", "see", "or", "don't", "Καλημέρα", "κόσμε", "well", "known"]);
  t.forEach(x => assert.equal(txt.slice(x.s, x.e), x.w));
  assert.deepEqual(S.tokens("'quoted' end").map(x => x.w), ["quoted", "end"]);
});

test("shouldCheck and scriptOf", () => {
  assert.equal(S.shouldCheck("a"), false);
  assert.equal(S.shouldCheck("iPhone"), false);
  assert.equal(S.shouldCheck("NASA"), false);
  assert.equal(S.shouldCheck("HELLO"), true);
  assert.equal(S.shouldCheck("Hello"), true);
  assert.equal(S.scriptOf("Καλή"), "el");
  assert.equal(S.scriptOf("café"), "en");
  assert.equal(S.scriptOf("Привет"), "");
});

test("my dictionary: merge is symmetric and idempotent, removals stick", () => {
  const a = { foo: 10, bar: 5, gone: -20 };
  const b = { foo: -12, bar: 5, gone: 15, baz: 3 };
  const m1 = S.mergeUserDict(a, b), m2 = S.mergeUserDict(b, a);
  assert.deepEqual(m1, m2);
  assert.deepEqual(m1, { bar: 5, baz: 3, foo: -12, gone: -20 });
  assert.deepEqual(S.mergeUserDict(m1, m1), m1);
  assert.deepEqual(S.userDictWords(m1), ["bar", "baz"]);
  // equal stamps: the removal wins on both sides
  assert.deepEqual(S.mergeUserDict({ x: 7 }, { x: -7 }), { x: -7 });
  // junk is dropped
  assert.deepEqual(S.mergeUserDict({ "two words": 1, "<b>": 2, ok: "x", fine: 4 }, null), { fine: 4 });
  // the cap keeps words over old removals
  const big = {};
  for (let i = 0; i < S.USER_MAX; i++) big["w" + i] = i + 1;
  big.old = -1;
  const capped = S.mergeUserDict(big, { extra: 99999 });
  assert.equal(Object.keys(capped).length, S.USER_MAX);
  assert.equal(capped.extra, 99999);
  assert.equal("old" in capped, false);
});

test("userHas: case forms of a listed word", () => {
  const set = new Set(["foo", "Kubernetes", "καλησπέρα"]);
  assert.equal(S.userHas(set, "foo"), true);
  assert.equal(S.userHas(set, "Foo"), true);
  assert.equal(S.userHas(set, "FOO"), true);
  assert.equal(S.userHas(set, "Kubernetes"), true);
  assert.equal(S.userHas(set, "KUBERNETES"), true);
  assert.equal(S.userHas(set, "kubernetes"), false);
  assert.equal(S.userHas(set, "ΚΑΛΗΣΠΕΡΑ"), true);
  assert.equal(S.userHas(set, "bar"), false);
});
