// Pure logic of Hangman: normalizing, revealing letters, misses and the
// end of a word, the word lists and the records merge.
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

const SRC = fs.readFileSync(path.join(__dirname, "..", "hangman/hangman.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

// cmpStr's cut also takes isInt and randInt, the one-liners after it.
const H = (() => {
  const parts = [cut("  var DATA_VER", "  // ---------- 1.")];
  ["cmpStr", "normWord", "reveal", "missesOf", "countIn", "outcome", "tryLetter", "splitList",
   "normCell", "normRow", "joinCell", "joinRows", "mergeHangman", "totals", "addResult", "letterFor"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    parts.push(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function(parts.join("\n") +
    "\nreturn { MAX_MISS, LEVEL_LEN, LETTERS, KB_ROWS, EL_BY_CODE, normWord, reveal, missesOf, countIn," +
    " outcome, tryLetter, splitList, mergeHangman, totals, addResult, letterFor };")();
})();

function words(lang) {
  const window = {};
  new Function("window", fs.readFileSync(path.join(__dirname, "..", `hangman/words-${lang}.js`), "utf8"))(window);
  return window.HANGMAN_WORDS[lang];
}

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);

test("hangman: Greek letters lose accents and the final sigma", () => {
  assert.equal(H.normWord("λόγος"), "ΛΟΓΟΣ");
  assert.equal(H.normWord("Προϊόν"), "ΠΡΟΙΟΝ");
  assert.equal(H.normWord("ΐ"), "Ι");
  assert.equal(H.normWord("ς"), "Σ");
  assert.equal(H.normWord("ά"), "Α");
  assert.equal(H.normWord("hello!"), "HELLO");
  assert.equal(H.normWord(null), "");
});

test("hangman: letters reveal every place they appear", () => {
  assert.equal(H.reveal("BANANA", ""), "______");
  assert.equal(H.reveal("BANANA", "A"), "_A_A_A");
  assert.equal(H.reveal("BANANA", "AN"), "_ANANA");
  assert.equal(H.reveal("BANANA", "ANXB"), "BANANA");
  assert.equal(H.countIn("BANANA", "A"), 3);
  assert.equal(H.countIn("BANANA", "Z"), 0);
  assert.deepEqual(H.missesOf("BANANA", "XANQ"), ["X", "Q"]);
});

test("hangman: six misses lose, every letter found wins", () => {
  assert.equal(H.MAX_MISS, 6);
  assert.equal(H.outcome("HOUSE", ""), "");
  assert.equal(H.outcome("HOUSE", "ABCDF"), "");          // 5 misses: still playing
  assert.equal(H.outcome("HOUSE", "ABCDFG"), "l");
  assert.equal(H.outcome("HOUSE", "HOUSE"), "w");
  assert.equal(H.outcome("HOUSE", "ABCDFHOUSE"), "w");    // 5 misses, then found
});

test("hangman: a letter is tried once and never after the end", () => {
  const A = H.LETTERS.en;
  let r = H.tryLetter("APPLE", "", "P", A);
  assert.equal(J(r), J({ ok: true, guessed: "P", hit: 2 }));
  r = H.tryLetter("APPLE", "P", "P", A);
  assert.equal(r.ok, false);                              // already tried
  assert.equal(H.tryLetter("APPLE", "", "Ω", A).ok, false);   // not this alphabet
  assert.equal(H.tryLetter("APPLE", "", "", A).ok, false);
  assert.equal(H.tryLetter("APPLE", "APLE", "Z", A).ok, false);   // already won
  assert.equal(H.tryLetter("APPLE", "BCDFGH", "A", A).ok, false); // already lost
  // random play: misses grow by one per wrong letter, the end is final
  for (let k = 0; k < 500; k++) {
    const w = ["BANANA", "ORANGE", "KIWIFRUIT", "STRAWBERRY"][rnd(4)];
    let g = "";
    const order = [...A].sort(() => Math.random() - 0.5);
    for (const l of order) {
      const before = H.missesOf(w, g).length, res = H.tryLetter(w, g, l, A);
      if (H.outcome(w, g)) { assert.equal(res.ok, false); continue; }
      assert.ok(res.ok);
      g = res.guessed;
      assert.equal(H.missesOf(w, g).length, before + (w.includes(l) ? 0 : 1));
    }
    const o = H.outcome(w, g);
    assert.ok(o === "w" || o === "l");
    if (o === "l") assert.equal(H.missesOf(w, g).length, 6);
    else assert.ok(H.missesOf(w, g).length < 6);
  }
});

for (const lang of ["en", "el"]) {
  test(`hangman: ${lang} word lists are clean`, () => {
    const src = words(lang), seen = new Set();
    const re = new RegExp("^[" + H.LETTERS[lang] + "]+$");
    for (const lv of ["e", "m", "h"]) {
      const list = H.splitList(src[lv]), [lo, hi] = H.LEVEL_LEN[lv];
      assert.ok(list.length >= 400, `${lang} ${lv}: ${list.length} words`);
      for (const w of list) {
        assert.ok(re.test(w), "bad word " + w);
        assert.ok(w.length >= lo && w.length <= hi, `${w} is not ${lo}–${hi} letters`);
        assert.equal(H.normWord(w), w);
        assert.ok(!seen.has(w), "duplicate " + w);
        seen.add(w);
      }
    }
    // a few words that must never come up (spot check of the filters)
    const blocked = lang === "en" ? /FUCK|SHIT|BITCH|WHORE|SLUT|PENIS|NIGG|RAPE|BIBLE|SHOTGUN/ : /^(ΜΑΛΑΚ|ΠΟΥΤΑΝ|ΠΟΥΣΤ|ΚΑΡΙΟΛ|ΓΑΜΗΣ|ΣΚΑΤΑ|ΠΟΥΛΙ$|ΧΡΙΣΤΕ$)/;
    assert.equal([...seen].filter((w) => blocked.test(w)).join(" "), "");
    // every key of the on-screen keyboard is a letter, every letter has a key
    assert.equal([...H.KB_ROWS[lang].join("")].sort().join(""), [...H.LETTERS[lang]].sort().join(""));
  });
}

test("hangman: keys by position; Greek follows the Greek keyboard", () => {
  assert.equal(H.letterFor({ code: "KeyQ", key: "q" }, "en"), "Q");
  assert.equal(H.letterFor({ code: "KeyU", key: "θ" }, "el"), "Θ");
  assert.equal(H.letterFor({ code: "KeyW", key: "ς" }, "el"), "Σ");
  assert.equal(H.letterFor({ code: "KeyQ", key: ";" }, "el"), "");
  assert.equal(H.letterFor({ code: "", key: "ά" }, "el"), "Α");
  assert.equal(H.letterFor({ code: "Digit1", key: "1" }, "en"), "");
  const v = Object.keys(H.EL_BY_CODE).filter((k) => k !== "KeyW").map((k) => H.EL_BY_CODE[k]);
  assert.equal(new Set(v).size, v.length);
  assert.equal(v.sort().join(""), [...H.LETTERS.el].sort().join(""));
});

test("hangman: streaks count wins in a row", () => {
  let c = null;
  [true, true, false, true, true, true, false].forEach((won, i) => { c = H.addResult(c, won, 100 + i); });
  assert.equal(J(c), J({ w: 5, l: 2, c: 0, m: 3, ts: 106 }));
  c = H.addResult(c, true, 50);                 // a clock behind: ts never goes back
  assert.equal(J(c), J({ w: 6, l: 2, c: 1, m: 3, ts: 106 }));
  const d = { rows: { a: { b: 0, s: { en: { w: 4, l: 1, c: 2, m: 3, ts: 10 } } }, b: { b: 0, s: { en: { w: 1, l: 0, c: 1, m: 1, ts: 20 } } } } };
  assert.equal(J(H.totals(d, "en")), J({ w: 5, l: 1, m: 3, c: 1 }));   // current streak of the last device
  assert.equal(J(H.totals(d, "el")), J({ w: 0, l: 0, m: 0, c: 0 }));
});

test("hangman: records merge is a join and a reset drops older rows", () => {
  const M = H.mergeHangman;
  const cell = () => { const w = rnd(6), l = rnd(4) + (w ? 0 : 1), m = rnd(w + 1), c = rnd(m + 1); return { w, l, c, m, ts: rnd(4) * 10 }; };
  const st = () => {
    const rows = {};
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      ["en", "el"].forEach((k) => { if (rnd(2)) s[k] = cell(); });
      rows["d" + rnd(4)] = { b: rnd(3) * 100, s };
    }
    return { ver: 1, br: rnd(4) ? 0 : rnd(3) * 100, rows };
  };
  for (let i = 0; i < 5000; i++) {
    const a = st(), b = st(), c = st(), sa = J(a), sb = J(b);
    assert.equal(J(M(a, b)), J(M(b, a)));
    const m = M(a, b);
    assert.equal(J(M(m, m)), J(m));
    assert.equal(J(M(M(a, b), c)), J(M(a, M(b, c))));
    assert.equal(J(a), sa);
    assert.equal(J(b), sb);
  }
  // the same device later: more games win
  const x = { rows: { d: { b: 0, s: { en: { w: 3, l: 1, c: 2, m: 2, ts: 50 } } } } };
  const y = { rows: { d: { b: 0, s: { en: { w: 3, l: 2, c: 0, m: 2, ts: 40 } } } } };
  assert.equal(J(M(x, y).rows.d.s.en), J({ w: 3, l: 2, c: 0, m: 2, ts: 40 }));
  // newer epoch wins, older than br drops
  assert.equal(M(x, { rows: { d: { b: 5, s: { en: { w: 1, l: 0, c: 1, m: 1, ts: 1 } } } } }).rows.d.s.en.w, 1);
  assert.equal(J(M(x, { br: 5, rows: {} }).rows), "{}");
  for (const bad of [{ w: 0, l: 0, c: 0, m: 0, ts: 0 }, { w: 1, l: 0, c: 2, m: 2, ts: 0 }, { w: 1, l: 0, c: 1, m: 0, ts: 0 },
    { w: -1, l: 2, c: 0, m: 0, ts: 0 }, { w: 1, l: 0, c: 1, m: 1 }, { w: 1.5, l: 0, c: 1, m: 1, ts: 0 }]) {
    assert.equal(J(M({ rows: { d: { b: 0, s: { en: bad } } } }, null).rows), "{}", J(bad));
  }
  assert.equal(J(M({ rows: { d: { b: -1, s: { en: { w: 1, l: 0, c: 1, m: 1, ts: 0 } } } } }, null).rows), "{}");
  assert.equal(J(M(null, undefined)), J({ ver: 1, br: 0, rows: {} }));
});
