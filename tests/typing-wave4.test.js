// Typing Tutor wave 4: polytonic Greek, Dvorak, Colemak
// (OROS_BIBLE.md Part III Typing Tutor).
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../typing/core.js");
const K = require("../typing/layouts.js");
const W = require("../typing/words.js");
const CO = require("../typing/course.js");
const TX = require("../typing/texts.js");
const R = require("../typing/rain.js");

const src = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const keys = (lay, ch) => (K.strokes(lay, ch) || []).map((s) => s.code + (s.shift ? "+" : ""));
const T0 = new Date(2026, 10, 1, 18).getTime();

test("Dvorak and Colemak: the letters on their keys, all 26 typeable, same fingers", () => {
  assert.deepEqual(keys("dv", "u"), ["KeyF"]);
  assert.deepEqual(keys("dv", "h"), ["KeyJ"]);
  assert.deepEqual(keys("dv", "'"), ["KeyQ"]);
  assert.deepEqual(keys("dv", "\""), ["KeyQ+"]);
  assert.deepEqual(keys("dv", "s"), ["Semicolon"]);
  assert.deepEqual(keys("dv", "["), ["Minus"]);
  assert.deepEqual(keys("cm", "t"), ["KeyF"]);
  assert.deepEqual(keys("cm", "n"), ["KeyJ"]);
  assert.deepEqual(keys("cm", "o"), ["Semicolon"]);
  assert.deepEqual(keys("cm", ";"), ["KeyP"]);
  for (const lay of ["dv", "cm"]) {
    for (const ch of "abcdefghijklmnopqrstuvwxyz") {
      assert.equal(K.strokes(lay, ch).length, 1, lay + " types " + ch);
      assert.deepEqual(keys(lay, ch.toUpperCase()), [keys(lay, ch)[0] + "+"]);
    }
    assert.equal(K.get(lay).words, "en");
  }
  assert.equal(CO.label("dv", "h1"), "u h");
  assert.equal(CO.label("cm", "h1"), "t n");
});

test("polytonic: the dead keys in X11 Compose order (iota, accent, breathing)", () => {
  assert.deepEqual(keys("elp", "ἀ"), ["Semicolon+", "KeyA"]);
  assert.deepEqual(keys("elp", "ἁ"), ["Quote+", "KeyA"]);
  assert.deepEqual(keys("elp", "ὰ"), ["Quote", "KeyA"]);
  assert.deepEqual(keys("elp", "ά"), ["Semicolon", "KeyA"]);
  assert.deepEqual(keys("elp", "ἄ"), ["Semicolon", "Semicolon+", "KeyA"]);
  assert.deepEqual(keys("elp", "ᾄ"), ["BracketRight", "Semicolon", "Semicolon+", "KeyA"]);
  assert.deepEqual(keys("elp", "ῷ"), ["BracketRight", "BracketLeft", "KeyV"]);
  assert.deepEqual(keys("elp", "ΐ"), ["Semicolon", "BracketLeft+", "KeyI"]);
  assert.deepEqual(keys("elp", "ῥ"), ["Quote+", "KeyR"]);
  assert.deepEqual(keys("elp", "Ὅ"), ["Semicolon", "Quote+", "KeyO+"]);
  assert.deepEqual(keys("elp", "ᾼ"), ["BracketRight", "KeyA+"]);
  // the plain letters are the Greek layout's
  for (const ch of "αβγδεζηθικλμνξοπρστυφχψωςΑΩ") assert.deepEqual(keys("elp", ch), keys("el", ch));
  // a decomposed input reads as the same letter
  assert.deepEqual(K.strokes("elp", "ἄ"), K.strokes("elp", "ἄ"));
  // key caps show the marks
  assert.deepEqual(K.cap("elp", "BracketRight"), ["ͺ", ""]);
  // a key press tells the family, not el from elp
  assert.equal(K.guess("KeyA", "α", false), "el");
  assert.equal(K.guess("KeyY", "f", false), "dv");
  assert.equal(K.guess("KeyY", "j", false), "cm");
  assert.equal(K.guess("KeyA", "a", false), "");
});

test("polytonic course: six lessons of marks, each brings one dead key", () => {
  const ls = CO.lessons("elp");
  assert.deepEqual(ls.map((l) => l.id), ["g1", "g2", "g3", "g4", "g5", "g6"]);
  assert.ok(ls[5].fin);
  assert.ok(!CO.has("elp", "h1") && CO.has("elp", "g1") && !CO.has("el", "g1"));
  assert.equal(CO.build("elp", "h1", 1), "", "a main-course lesson builds nothing on polytonic");
  const g1 = CO.allowed("elp", CO.indexOf("g1"));
  assert.ok(g1["ἀ"] && g1["ἄ"] && g1["ά"] && g1["Α"] && g1["κ"]);
  assert.ok(!g1["ἁ"] && !g1["ᾶ"] && !g1["ᾳ"]);
  assert.ok(CO.allowed("elp", CO.indexOf("g2"))["ἁ"]);
  assert.ok(CO.allowed("elp", CO.indexOf("g3"))["ῆ"]);
  assert.ok(CO.allowed("elp", CO.indexOf("g4"))["ᾳ"]);
  assert.ok(CO.fresh("elp", 0).includes("ἀ") && !CO.fresh("elp", 0).includes("α"));
  ls.forEach((l, i) => {
    const ok = CO.allowed("elp", i);
    for (const seed of [1, 5]) {
      const text = CO.build("elp", l.id, seed);
      assert.ok(text.length > 80, l.id + " has text");
      for (const ch of Array.from(text)) assert.ok(ok[ch], l.id + ": '" + ch + "' learned");
    }
  });
  assert.ok(/[.]/.test(CO.build("elp", "g6", 2)), "the final text has sentences");
  assert.ok(CO.testText("elp", 3, 40).split(" ").length === 40);
  // before any lesson: Letter rain uses the plain letters
  const rl = R.letters("elp", -1);
  assert.ok(rl.includes("α") && !rl.includes("ἀ"));
});

test("polytonic words, sentences and passages type on the polytonic layout", () => {
  assert.ok(W.WORDS.elp.length >= 200);
  for (const w of W.WORDS.elp.concat(W.SENTENCES.elp)) {
    for (const ch of Array.from(w.normalize("NFC"))) assert.ok(K.strokes("elp", ch), "'" + w + "': " + ch);
  }
  const ids = TX.library("elp").map((x) => x.id);
  assert.ok(ids.includes("elp-odyssey") && ids.includes("el-ithaki"), "polytonic shows its own and the Greek passages");
  for (const x of TX.LIB.filter((p) => p.l === "elp")) assert.equal(TX.clean("elp", x.t).dropped, 0, x.id);
  assert.deepEqual(TX.library("dv").map((x) => x.id), TX.library("en").map((x) => x.id));
  assert.ok(!TX.library("el").some((x) => x.l === "elp"));
});

test("data: the new layouts keep their settings, progress and records", () => {
  let d = C.setPrefs(C.empty(), { lay: "dv" }, T0);
  assert.equal(C.normalize(d).set.lay, "dv");
  d = C.record(d, { lay: "elp", lesson: "g1", chars: 100, errors: 2, ms: 60000, keys: { "ἀ": [3, 1, 900] } }, T0 + 1, "aaa");
  d = C.record(d, { lay: "cm", test: 1, chars: 200, errors: 0, ms: 60000, keys: {} }, T0 + 2, "aaa");
  const m = C.merge(C.empty(), JSON.parse(C.serialize(d)));
  assert.ok(C.progress(m, "elp", "g1").s >= 1);
  assert.equal(m.best["cm|1"].w, 40);
  assert.deepEqual(C.keyStats(m, "elp")["ἀ"], { r: 3, w: 1, ms: 900 });
});

test("wiring: per-layout course, several dead keys, family check, strings", () => {
  const app = src("typing/app.js");
  for (const k of ["CO.lessons(L)", "CO.has(lay(), id)", "deadPending++", "K.get(lay()).base", "CO.isPoly(L)", "x.yd || x.y"]) assert.ok(app.includes(k), k);
  assert.ok(!app.includes("CO.lessons()"), "every lesson list is the layout's");
  const de = src("i18n/de/typing.js");
  assert.ok(de.includes("\"grp.poly\"") && de.includes("\"lay.hintPoly\""));
  for (const f of ["typing/help.en.txt", "typing/help.el.txt", "i18n/de/help/typing.txt"]) assert.match(src(f), /Dvorak/, f);
});
