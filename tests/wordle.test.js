// Pure logic of Wordle: scoring with repeated letters, hard mode, the
// daily word, streaks, the word lists and the records merge.
// Run: node --test tests/
//
// The app is a browser IIFE with no exports, so the pure functions are
// cut out of the source by name and evaluated on their own. A renamed
// function fails here loudly ("missing function …").

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "wordle/wordle.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

// cmpStr's cut also takes isInt and randInt, the one-liners after it.
const W = (() => {
  const parts = [cut("  var DATA_VER", "  // ---------- 1.")];
  ["cmpStr", "normWord", "score", "hardCheck", "keyStates", "dayIndex", "dailyWord",
   "streaks", "shareText", "splitWords", "normDay", "dayKeyOk", "normFree", "normRow",
   "joinFree", "joinRows", "mergeWordle"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    parts.push(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function(parts.join("\n") +
    "\nreturn { LETTERS, KB_ROWS, EL_BY_CODE, normWord, score, hardCheck, keyStates, dayIndex," +
    " dailyWord, streaks, shareText, splitWords, mergeWordle };")();
})();

function words(lang) {
  const window = {};
  new Function("window", fs.readFileSync(path.join(__dirname, "..", `wordle/words-${lang}.js`), "utf8"))(window);
  const src = window.WORDLE_WORDS[lang];
  return { answers: W.splitWords(src.answers), extra: W.splitWords(src.extra), raw: src };
}

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);

test("wordle: scoring counts repeated letters exactly", () => {
  assert.equal(W.score("CRANE", "CRANE"), "ccccc");
  assert.equal(W.score("ABBEY", "BABES"), "ppcca");     // two Bs, both used
  assert.equal(W.score("SPEED", "ABIDE"), "aapap");      // one E in the answer: only the first is yellow
  assert.equal(W.score("EERIE", "THREE"), "pacac");
  assert.equal(W.score("LLAMA", "HELLO"), "ppaaa");      // two Ls in the answer, both yellow
  assert.equal(W.score("LLLLL", "HELLO"), "aacca");      // greens take the two Ls first
  assert.equal(W.score("OOOXX", "ROBOT"), "pcaaa");
});

test("wordle: scoring keeps letter counts against brute force", () => {
  const A = "ABCDE";
  for (let k = 0; k < 20000; k++) {
    let g = "", a = "";
    for (let i = 0; i < 5; i++) { g += A[rnd(5)]; a += A[rnd(5)]; }
    const sc = W.score(g, a);
    for (let i = 0; i < 5; i++) if (sc[i] === "c") assert.equal(g[i], a[i]);
    for (const l of A) {
      const inAns = [...a].filter((x) => x === l).length;
      const marked = [...g].filter((x, i) => x === l && sc[i] !== "a").length;
      const inGuess = [...g].filter((x) => x === l).length;
      assert.equal(marked, Math.min(inAns, inGuess), g + " " + a + " " + sc);
    }
  }
});

test("wordle: Greek words lose accents and the final sigma", () => {
  assert.equal(W.normWord("λόγος"), "ΛΟΓΟΣ");
  assert.equal(W.normWord("Προϊόν"), "ΠΡΟΙΟΝ");
  assert.equal(W.normWord("ΐ"), "Ι");
  assert.equal(W.normWord("crane!"), "CRANE");
  assert.equal(W.normWord(null), "");
});

test("wordle: hard mode keeps greens in place and uses every hint", () => {
  const ans = "CRANE";
  assert.equal(W.hardCheck([], ans, "ZZZZZ"), null);
  assert.equal(W.hardCheck(["CLOTH"], ans, "CRANE"), null);
  assert.equal(J(W.hardCheck(["CLOTH"], ans, "BRANE")), J({ kind: "c", l: "C", p: 1 }));
  assert.equal(J(W.hardCheck(["TRACE"], ans, "TRACK")), J({ kind: "c", l: "E", p: 5 }));
  assert.equal(J(W.hardCheck(["ENACT"], ans, "CRANK")), J({ kind: "p", l: "E" }));
  // two revealed Es must both come back
  assert.equal(J(W.hardCheck(["EERIE"], "THREE", "THREE")), "null");
  assert.equal(J(W.hardCheck(["EERIE"], "THREE", "THROE")), J({ kind: "p", l: "E" }));
});

test("wordle: keyboard keeps the best state per letter", () => {
  assert.equal(J(W.keyStates(["CLOTH", "CRANE"], "CRANE")),
    J({ C: "c", L: "a", O: "a", T: "a", H: "a", R: "c", A: "c", N: "c", E: "c" }));
  assert.equal(W.keyStates(["NACRE", "CRANE"], "CRANE").N, "c");
});

test("wordle: the daily word follows the calendar day", () => {
  assert.equal(W.dayIndex(new Date(2026, 0, 1)), 0);
  assert.equal(W.dayIndex(new Date(2026, 0, 1, 23, 59)), 0);
  assert.equal(W.dayIndex(new Date(2026, 2, 29, 12)), 87);        // across the DST change
  assert.equal(W.dayIndex(new Date(2027, 0, 1)), 365);
  assert.equal(W.dailyWord(["A", "B", "C"], 4), "B");
  assert.equal(W.dailyWord(["A", "B", "C"], -1), "C");
});

test("wordle: streaks count back from today or yesterday", () => {
  assert.equal(J(W.streaks({}, 10)), J({ cur: 0, best: 0 }));
  assert.equal(J(W.streaks({ 8: 3, 9: 1, 10: 6 }, 10)), J({ cur: 3, best: 3 }));
  assert.equal(J(W.streaks({ 8: 3, 9: 1 }, 10)), J({ cur: 2, best: 2 }));   // today not played yet
  assert.equal(J(W.streaks({ 8: 3, 9: 7, 10: 2 }, 10)), J({ cur: 1, best: 1 }));
  assert.equal(J(W.streaks({ 1: 2, 2: 2, 3: 2, 4: 2, 7: 1 }, 9)), J({ cur: 0, best: 4 }));
});

test("wordle: the copied result has squares, never the word", () => {
  const t = W.shareText("#5 EN", ["CLOTH", "CRANE"], "CRANE", true, true, false);
  assert.equal(t, "orOS Wordle #5 EN 2/6*\n\n🟩⬛⬛⬛⬛\n🟩🟩🟩🟩🟩");
  assert.ok(!/CRANE|CLOTH/.test(t));
  assert.ok(W.shareText("EL", ["ΛΟΓΟΣ"], "ΚΟΣΜΟ", false, false, true).startsWith("orOS Wordle EL X/6\n\n"));
});

for (const lang of ["en", "el"]) {
  test(`wordle: ${lang} word lists are clean`, () => {
    const { answers, extra, raw } = words(lang);
    assert.equal(raw.answers.length % 5, 0);
    assert.equal(raw.extra.length % 5, 0);
    assert.ok(answers.length > 1000, "answers " + answers.length);
    const all = answers.concat(extra), seen = new Set();
    const re = new RegExp("^[" + W.LETTERS[lang] + "]{5}$");
    for (const w of all) {
      assert.ok(re.test(w), "bad word " + w);
      assert.equal(W.normWord(w), w);
      assert.ok(!seen.has(w), "duplicate " + w);
      seen.add(w);
    }
    // every key of the on-screen keyboard is a letter, every letter has a key
    assert.equal([...W.KB_ROWS[lang].join("")].sort().join(""), [...W.LETTERS[lang]].sort().join(""));
  });
}

// W is ς on a Greek keyboard, so it types Σ like S.
test("wordle: Greek physical keys cover every letter once", () => {
  const v = Object.keys(W.EL_BY_CODE).filter((k) => k !== "KeyW").map((k) => W.EL_BY_CODE[k]);
  assert.equal(W.EL_BY_CODE.KeyW, "Σ");
  assert.equal(new Set(v).size, v.length);
  assert.equal(v.sort().join(""), [...W.LETTERS.el].sort().join(""));
});

test("wordle: records merge is a join and a reset drops older entries", () => {
  const M = W.mergeWordle;
  const st = () => {
    const days = {}, rows = {};
    for (let i = 0; i < rnd(5); i++) days[(rnd(2) ? "en:" : "el:") + rnd(4)] = { b: rnd(3) * 100, r: 1 + rnd(7) };
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      ["en", "el"].forEach((k) => {
        if (!rnd(2)) return;
        const h = [0, 0, 0, 0, 0, 0].map(() => rnd(4));
        const w = h.reduce((x, y) => x + y, 0);
        s[k] = { g: w + rnd(3) || 1, w, h };
      });
      rows["d" + rnd(4)] = { b: rnd(3) * 100, s };
    }
    return { ver: 1, br: rnd(4) ? 0 : rnd(3) * 100, days, rows };
  };
  for (let i = 0; i < 5000; i++) {
    const a = st(), b = st(), c = st(), sa = J(a);
    assert.equal(J(M(a, b)), J(M(b, a)));
    const m = M(a, b);
    assert.equal(J(M(m, m)), J(m));
    assert.equal(J(M(M(a, b), c)), J(M(a, M(b, c))));
    assert.equal(J(a), sa);
  }
  // one result per day: newer wins, same epoch keeps the better
  assert.equal(M({ days: { "en:5": { b: 1, r: 2 } } }, { days: { "en:5": { b: 2, r: 6 } } }).days["en:5"].r, 6);
  assert.equal(M({ days: { "en:5": { b: 2, r: 4 } } }, { days: { "en:5": { b: 2, r: 3 } } }).days["en:5"].r, 3);
  assert.equal(J(M({ days: { "en:5": { b: 2, r: 4 } } }, { br: 5 }).days), "{}");
  for (const bad of [{ "fr:1": { b: 0, r: 1 } }, { "en:x": { b: 0, r: 1 } }, { "en:1": { b: 0, r: 8 } }, { "en:1": { b: -1, r: 1 } }]) {
    assert.equal(J(M({ days: bad }, null).days), "{}", J(bad));
  }
  for (const bad of [{ g: 1, w: 2, h: [0, 0, 0, 0, 0, 0] }, { g: 0, w: 0, h: [0, 0, 0, 0, 0, 0] }, { g: 1, w: 0, h: [0] }]) {
    assert.equal(J(M({ rows: { d: { b: 0, s: { en: bad } } } }, null).rows), "{}", J(bad));
  }
});
