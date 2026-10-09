// Pure logic of Word Search: the generator (every word in the grid,
// once, in the allowed directions), the daily puzzle, selection lines,
// the word lists, own themes and the records merge.
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

const SRC = fs.readFileSync(path.join(__dirname, "..", "wordsearch/wordsearch.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

// One-liners ride along with the function after them: cmpStr takes isInt
// and randInt, reversed takes clash, statKeyOk takes normStat.
const W = (() => {
  const parts = [cut("  var DATA_VER", "  // ---------- 1.")];
  ["cmpStr", "normWord", "hashStr", "seeded", "shuffled", "letterWeights", "pickLetter", "cellsOf",
   "reversed", "placements", "occurrences", "generate", "randomPool", "buildPuzzle", "dayIndex",
   "dailyPuzzle", "snapEnd", "inLine", "matchWord", "fmtTime", "streaks", "normDayRes", "dayKeyOk",
   "betterDay", "statKeyOk", "joinStat", "normRow", "joinRows", "normName", "normThemeWords",
   "normTheme", "mergeWS", "themeOk", "parseWords"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    parts.push(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function("crypto", parts.join("\n") +
    "\nreturn { LEVELS, DIRS, THEME_IDS, LETTERS, WORD_RE, DAILY_SIZE, MAX_WORDS, normWord, hashStr, seeded," +
    " letterWeights, cellsOf, clash, occurrences, generate, buildPuzzle, dayIndex, dailyPuzzle, snapEnd," +
    " inLine, matchWord, fmtTime, streaks, mergeWS, normTheme, themeOk, parseWords };")(require("crypto").webcrypto);
})();

function words(lang) {
  const window = {};
  new Function("window", fs.readFileSync(path.join(__dirname, "..", `wordsearch/words-${lang}.js`), "utf8"))(window);
  const src = window.WORDSEARCH_WORDS[lang];
  const split = (s) => s.split(" ").filter((w) => w);
  const common = {}, themes = {};
  let all = [];
  Object.keys(src.common).forEach((k) => { common[k] = split(src.common[k]); all = all.concat(common[k]); });
  Object.keys(src.themes).forEach((k) => { themes[k] = split(src.themes[k]); });
  return { raw: src, common, themes, weights: W.letterWeights(lang, all) };
}
const LISTS = { en: words("en"), el: words("el") };

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);

// Every placed word: in bounds, an allowed direction, its letters in the
// grid, read exactly once (all 8 directions); no two words inside each other.
function checkPuzzle(pz, lang, size, label) {
  const lv = W.LEVELS[size], n = lv.n;
  assert.equal(pz.n, n, label);
  assert.equal(pz.grid.length, n * n, label);
  for (const ch of pz.grid) assert.ok(W.LETTERS[lang].includes(ch), label + " letter " + ch);
  pz.words.forEach((p, i) => {
    assert.ok(p.d >= 0 && p.d < lv.nd, label + " direction " + p.d);
    const er = p.r + W.DIRS[p.d][0] * (p.w.length - 1), ec = p.c + W.DIRS[p.d][1] * (p.w.length - 1);
    assert.ok(p.r >= 0 && p.c >= 0 && er >= 0 && ec >= 0 && p.r < n && p.c < n && er < n && ec < n, label + " bounds");
    assert.equal(W.cellsOf(p, n).map((ix) => pz.grid[ix]).join(""), p.w, label + " letters");
    assert.equal(W.occurrences(pz.grid, n, p.w), 1, label + " once: " + p.w);
    pz.words.forEach((q, j) => { if (j > i) assert.ok(!W.clash(p.w, q.w), label + " clash " + p.w + " " + q.w); });
  });
}

test("wordsearch: Greek words lose accents and the final sigma", () => {
  assert.equal(W.normWord("λόγος"), "ΛΟΓΟΣ");
  assert.equal(W.normWord("Προϊόν"), "ΠΡΟΙΟΝ");
  assert.equal(W.normWord("ice-cream!"), "ICECREAM");
  assert.equal(W.normWord(null), "");
});

for (const lang of ["en", "el"]) {
  test(`wordsearch: ${lang} word lists are clean`, () => {
    const L = LISTS[lang], re = lang === "el" ? /^[Α-Ω]+$/ : /^[A-Z]+$/;
    assert.equal(Object.keys(L.common).join(), "3,4,5,6,7,8,9,10");
    Object.keys(L.common).forEach((k) => {
      const list = L.common[k];
      assert.ok(list.length >= (k === "3" ? 100 : 400), lang + " " + k + ": " + list.length);
      assert.equal(new Set(list).size, list.length, "duplicates in " + k);
      list.forEach((w) => { assert.ok(re.test(w), w); assert.equal(w.length, +k, w); assert.equal(W.normWord(w), w); });
      assert.equal(J(list), J(list.slice().sort()));
    });
    assert.equal(Object.keys(L.themes).join(), W.THEME_IDS.join());
    W.THEME_IDS.forEach((id) => {
      const list = L.themes[id];
      assert.ok(list.length >= 30, id + ": " + list.length);
      assert.equal(new Set(list).size, list.length, "duplicates in " + id);
      list.forEach((w) => { assert.ok(re.test(w) && w.length >= 3 && w.length <= 12, id + " " + w); });
      // enough short words for the 8×8 grid
      assert.ok(list.filter((w) => w.length <= 8).length >= 14, id + " short words");
    });
    const all = [].concat(...Object.values(L.common), ...Object.values(L.themes));
    const blocked = lang === "en" ? /FUCK|SHIT|BITCH|WHORE|SLUT|PENIS|NIGG|^RAPE|^RAPIST|BIBLE|SHOTGUN|^SEX/ : /^(ΜΑΛΑΚ|ΠΟΥΤΑΝ|ΠΟΥΣΤ|ΚΑΡΙΟΛ|ΓΑΜΗΣ|ΣΚΑΤΑ|ΠΟΥΛΙ$|ΧΡΙΣΤΕ$|ΚΤΛ$|ΧΛΜ$)/;
    assert.equal(all.filter((w) => blocked.test(w)).join(" "), "");
    // the filler weights cover the whole alphabet
    assert.equal(L.weights.letters, W.LETTERS[lang]);
    assert.equal(L.weights.cum.length, W.LETTERS[lang].length);
  });
}

test("wordsearch: the generator places every word once, in the level's directions", () => {
  for (const lang of ["en", "el"]) {
    for (const size of ["e", "m", "h"]) {
      const lv = W.LEVELS[size];
      for (const theme of ["random"].concat(W.THEME_IDS)) {
        for (let s = 0; s < (theme === "random" ? 12 : 2); s++) {
          const label = `${lang} ${size} ${theme} #${s}`;
          const pz = W.buildPuzzle(LISTS[lang], size, theme, null, W.seeded(W.hashStr(label)));
          assert.ok(pz, label);
          checkPuzzle(pz, lang, size, label);
          if (theme === "random") assert.equal(pz.words.length, lv.k, label);
          else assert.ok(pz.words.length >= lv.k - 1, label + ": " + pz.words.length);
          if (theme !== "random") pz.words.forEach((p) => assert.ok(LISTS[lang].themes[theme].includes(p.w), label));
        }
      }
    }
  }
});

test("wordsearch: directions per level: easy across/down, medium + diagonals, hard + backwards", () => {
  assert.equal(J(W.DIRS.slice(0, W.LEVELS.e.nd)), J([[0, 1], [1, 0]]));
  assert.equal(J(W.DIRS.slice(0, W.LEVELS.m.nd)), J([[0, 1], [1, 0], [1, 1], [-1, 1]]));
  assert.equal(W.LEVELS.h.nd, 8);
  // every forward direction reads left to right or top to bottom
  W.DIRS.slice(0, 4).forEach((d) => assert.ok(d[1] === 1 || (d[1] === 0 && d[0] === 1)));
  W.DIRS.slice(4).forEach((d, i) => assert.equal(J(d), J([-W.DIRS[i][0], -W.DIRS[i][1]])));
  // hard puzzles do use backwards words
  let back = 0;
  for (let s = 0; s < 10; s++) {
    const pz = W.buildPuzzle(LISTS.en, "h", "random", null, W.seeded(s));
    back += pz.words.filter((p) => p.d >= 4).length;
  }
  assert.ok(back > 0);
});

test("wordsearch: own word lists, overlaps and words that hide inside each other", () => {
  const L = LISTS.en;
  // CAT is inside CATALOG, TAC backwards: never in one puzzle
  for (let s = 0; s < 30; s++) {
    const pz = W.buildPuzzle(L, "h", "u:x", ["CAT", "CATALOG", "TACO", "DOG", "GOD", "LEVEL", "NOON", "HORSE"], W.seeded(s));
    checkPuzzle(pz, "en", "h", "own #" + s);
    const ws = pz.words.map((p) => p.w);
    assert.ok(!(ws.includes("CAT") && ws.includes("CATALOG")));
    assert.ok(!(ws.includes("DOG") && ws.includes("GOD")));
  }
  // words longer than the grid are left out; a tiny list still works
  const pz = W.buildPuzzle(L, "e", "u:x", ["ELEPHANTS", "BEE", "ANT", "OWL"], W.seeded(1));
  checkPuzzle(pz, "en", "e", "tiny");
  assert.equal(pz.words.map((p) => p.w).sort().join(), "ANT,BEE,OWL");
  assert.equal(W.buildPuzzle(L, "e", "u:x", ["ELEPHANTS"], W.seeded(1)), null);
  // overlaps happen where letters match
  let shared = 0;
  for (let s = 0; s < 20; s++) {
    const q = W.buildPuzzle(L, "m", "animals", null, W.seeded(100 + s)), use = {};
    q.words.forEach((p) => W.cellsOf(p, q.n).forEach((ix) => { use[ix] = (use[ix] || 0) + 1; }));
    shared += Object.values(use).filter((v) => v > 1).length;
  }
  assert.ok(shared > 0);
});

test("wordsearch: the daily puzzle follows the date and the language only", () => {
  assert.equal(W.dayIndex(new Date(2026, 0, 1)), 0);
  assert.equal(W.dayIndex(new Date(2026, 2, 29, 23, 30)), 87);     // across the DST change
  for (const lang of ["en", "el"]) {
    const a = W.dailyPuzzle(LISTS[lang], lang, 281), b = W.dailyPuzzle(LISTS[lang], lang, 281);
    assert.equal(J(a), J(b));
    assert.ok(W.THEME_IDS.includes(a.theme));
    checkPuzzle(a, lang, W.DAILY_SIZE, "daily " + lang);
    assert.notEqual(J(W.dailyPuzzle(LISTS[lang], lang, 282).grid), J(a.grid));
  }
  assert.notEqual(W.dailyPuzzle(LISTS.en, "en", 5).grid, W.dailyPuzzle(LISTS.en, "el", 5).grid);
  // a fixed check value: the same grid on every device and every run
  const s = W.seeded(W.hashStr("wordsearch:en:0"));
  assert.equal([s(), s(), s()].map((x) => Math.floor(x * 1e6)).join(), (() => {
    const t = W.seeded(W.hashStr("wordsearch:en:0"));
    return [t(), t(), t()].map((x) => Math.floor(x * 1e6)).join();
  })());
  assert.equal(W.hashStr("abc"), 0x1a47e90b);
  // every theme comes up over a year
  const seen = new Set();
  for (let d = 0; d < 365; d++) { const r = W.seeded(W.hashStr("wordsearch:en:" + d)); seen.add(W.THEME_IDS[Math.floor(r() * 20)]); }
  assert.equal(seen.size, 20);
});

test("wordsearch: a drag snaps to a straight line inside the grid; a selection matches either way", () => {
  const a = { r: 2, c: 2 };
  assert.equal(J(W.snapEnd(a, 2, 7, 8)), J({ r: 2, c: 7 }));
  assert.equal(J(W.snapEnd(a, 3, 7, 8)), J({ r: 2, c: 7 }));     // almost across
  assert.equal(J(W.snapEnd(a, 6, 5, 8)), J({ r: 6, c: 6 }));     // 53°: nearer the diagonal
  assert.equal(J(W.snapEnd(a, 7, 3, 8)), J({ r: 7, c: 2 }));     // mostly down
  assert.equal(J(W.snapEnd(a, 5, 5, 8)), J({ r: 5, c: 5 }));
  assert.equal(J(W.snapEnd(a, 0, 4, 8)), J({ r: 0, c: 4 }));     // up-right
  assert.equal(J(W.snapEnd(a, 7, 7, 4)), J({ r: 3, c: 3 }));     // clipped to a 4×4 grid
  assert.equal(J(W.snapEnd(a, 2, 2, 8)), J(a));
  for (let i = 0; i < 2000; i++) {
    const n = 5 + rnd(11), p = { r: rnd(n), c: rnd(n) }, q = W.snapEnd(p, rnd(n), rnd(n), n);
    assert.ok(q.r >= 0 && q.c >= 0 && q.r < n && q.c < n);
    assert.ok((q.r === p.r && q.c === p.c) || W.inLine(p, q));
  }
  assert.ok(W.inLine({ r: 0, c: 0 }, { r: 3, c: 3 }));
  assert.ok(!W.inLine({ r: 0, c: 0 }, { r: 1, c: 3 }));
  assert.ok(!W.inLine({ r: 1, c: 1 }, { r: 1, c: 1 }));
  const ws = [{ w: "CAT", r: 0, c: 0, d: 0 }, { w: "DOG", r: 4, c: 4, d: 6 }];
  assert.equal(W.matchWord(ws, 8, { r: 0, c: 0 }, { r: 0, c: 2 }), 0);
  assert.equal(W.matchWord(ws, 8, { r: 0, c: 2 }, { r: 0, c: 0 }), 0);
  assert.equal(W.matchWord(ws, 8, { r: 2, c: 2 }, { r: 4, c: 4 }), 1);
  assert.equal(W.matchWord(ws, 8, { r: 0, c: 0 }, { r: 0, c: 3 }), -1);
});

test("wordsearch: times, streaks, theme ids", () => {
  assert.equal(W.fmtTime(0), "0:00");
  assert.equal(W.fmtTime(65.9), "1:05");
  assert.equal(W.fmtTime(3725), "1:02:05");
  assert.equal(J(W.streaks({}, 10)), J({ cur: 0, best: 0 }));
  assert.equal(J(W.streaks({ 8: 1, 9: 1, 10: 1 }, 10)), J({ cur: 3, best: 3 }));
  assert.equal(J(W.streaks({ 8: 1, 9: 1 }, 10)), J({ cur: 2, best: 2 }));
  assert.equal(J(W.streaks({ 1: 1, 2: 1, 3: 1, 7: 1 }, 9)), J({ cur: 0, best: 3 }));
  assert.ok(W.themeOk("random") && W.themeOk("sea") && W.themeOk("u:abc123def"));
  assert.ok(!W.themeOk("u:") && !W.themeOk("pirates") && !W.themeOk("u:AB"));
});

test("wordsearch: own theme words are parsed and normalized", () => {
  const p = W.parseWords("γάτα, σκύλος\n λιοντάρι;ψάρι  cat x1 γάτα ab", "el");
  assert.equal(p.ok.join(" "), "ΓΑΤΑ ΣΚΥΛΟΣ ΛΙΟΝΤΑΡΙ ΨΑΡΙ");
  assert.equal(p.bad.join(" "), "cat x1 ab");
  assert.equal(W.parseWords("Ice cream, X-ray, ok", "en").ok.join(" "), "ICE CREAM XRAY");
  const th = W.normTheme({ id: "abc123", m: 5, name: "  My   class ", lang: "en", words: ["cat", "Dog", "cat", "ψάρι", "owl", "x"] });
  assert.equal(J(th), J({ id: "abc123", m: 5, name: "My class", lang: "en", words: ["CAT", "DOG", "OWL"] }));
  assert.equal(J(W.normTheme(th)), J(th));
  assert.equal(W.normTheme({ id: "abc123", m: 5, name: "x", lang: "en", words: ["cat", "dog"] }), null);   // < 3 words
  assert.equal(W.normTheme({ id: "abc123", m: 5, name: " ", lang: "en", words: ["cat", "dog", "owl"] }), null);
  assert.equal(W.normTheme({ id: "abc123", m: 5, name: "x", lang: "de", words: ["cat", "dog", "owl"] }), null);
  const many = W.normTheme({ id: "abc123", m: 1, name: "x", lang: "en", words: Array.from({ length: 80 }, (_, i) => "W" + "ABCDEFGHIJ"[i % 10] + "KLMNOPQR"[Math.floor(i / 10)] + "Z") });
  assert.equal(many.words.length, W.MAX_WORDS);
});

test("wordsearch: records merge is a join; a reset drops older results; themes LWW + tombstones", () => {
  const M = W.mergeWS;
  const stat = () => { const t = rnd(3) ? rnd(4) * 30 + 30 : 0; return { n: rnd(5) + 1, t, d: t ? rnd(3) * 1000 + 1 : 0 }; };
  const theme = (id) => ({ id, m: rnd(4) * 10, name: ["Alpha", "Beta"][rnd(2)], lang: "en", words: [["CAT", "DOG", "OWL"], ["SUN", "SEA", "SKY", "AIR"]][rnd(2)] });
  const st = () => {
    const rows = {}, days = {}, themes = [], tombs = {};
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      ["en:e", "en:m", "el:h"].forEach((k) => { if (rnd(2)) s[k] = stat(); });
      rows["dev00" + rnd(4)] = { b: rnd(3) * 100, s };
    }
    for (let i = 0; i < rnd(4); i++) days[["en", "el"][rnd(2)] + ":" + rnd(5)] = { b: rnd(3) * 100, t: rnd(5) * 20 + 1, h: rnd(2) };
    for (let i = 0; i < rnd(3); i++) themes.push(theme("theme" + rnd(3)));
    for (let i = 0; i < rnd(2); i++) tombs["theme" + rnd(3)] = rnd(4) * 10;
    return { ver: 1, br: rnd(4) ? 0 : rnd(3) * 100, days, rows, themes, tombs };
  };
  for (let i = 0; i < 5000; i++) {
    const a = st(), b = st(), c = st(), sa = J(a), sb = J(b);
    assert.equal(J(M(a, b)), J(M(b, a)));
    const m = M(a, b);
    assert.equal(J(M(m, m)), J(m));
    assert.equal(J(M(m, a)), J(m));
    assert.equal(J(M(M(a, b), c)), J(M(a, M(b, c))));
    assert.equal(J(a), sa);
    assert.equal(J(b), sb);
  }
  // daily: newer epoch wins; equal epochs keep the better result (no hint, then faster)
  const d = (v) => ({ days: { "en:3": v } });
  assert.equal(J(M(d({ b: 0, t: 90, h: 0 }), d({ b: 0, t: 40, h: 1 })).days["en:3"]), J({ b: 0, t: 90, h: 0 }));
  assert.equal(J(M(d({ b: 0, t: 90, h: 0 }), d({ b: 0, t: 40, h: 0 })).days["en:3"]), J({ b: 0, t: 40, h: 0 }));
  assert.equal(J(M(d({ b: 0, t: 40, h: 0 }), d({ b: 9, t: 99, h: 1 })).days["en:3"]), J({ b: 9, t: 99, h: 1 }));
  // free play: solved = max per device, best = the shorter time with its date; devices add up elsewhere
  const r = (s) => ({ rows: { dev001: { b: 0, s: { "en:m": s } } } });
  assert.equal(J(M(r({ n: 3, t: 80, d: 5 }), r({ n: 2, t: 60, d: 9 })).rows.dev001.s["en:m"]), J({ n: 3, t: 60, d: 9 }));
  assert.equal(J(M(r({ n: 3, t: 0, d: 0 }), r({ n: 1, t: 60, d: 9 })).rows.dev001.s["en:m"]), J({ n: 3, t: 60, d: 9 }));
  // reset: older entries drop, themes stay
  const full = M({ days: { "en:1": { b: 0, t: 5, h: 0 } }, rows: { dev001: { b: 0, s: { "en:e": { n: 1, t: 5, d: 1 } } } },
    themes: [{ id: "theme1", m: 1, name: "A", lang: "en", words: ["CAT", "DOG", "OWL"] }] }, null);
  const reset = M(full, { br: 50 });
  assert.equal(J(reset.days), "{}");
  assert.equal(J(reset.rows), "{}");
  assert.equal(reset.themes.length, 1);
  // themes: the newer edit wins, a tomb deletes (ties too), a newer edit resurrects
  const t1 = { id: "theme1", m: 10, name: "Old", lang: "en", words: ["CAT", "DOG", "OWL"] };
  const t2 = { id: "theme1", m: 20, name: "New", lang: "en", words: ["CAT", "DOG", "OWL"] };
  assert.equal(M({ themes: [t1] }, { themes: [t2] }).themes[0].name, "New");
  assert.equal(M({ themes: [t2] }, { tombs: { theme1: 20 } }).themes.length, 0);
  assert.equal(M({ themes: [Object.assign({}, t2, { m: 30 })] }, { tombs: { theme1: 20 } }).themes.length, 1);
  // bad entries drop
  for (const bad of [{ n: 0, t: 0, d: 0 }, { n: 1, t: 5, d: 0 }, { n: 1, t: 0, d: 5 }, { n: 1.5, t: 0, d: 0 }, { n: 1, t: -1, d: 1 }]) {
    assert.equal(J(M(r(bad), null).rows), "{}", J(bad));
  }
  assert.equal(J(M({ days: { "en:x": { b: 0, t: 5, h: 0 }, "de:1": { b: 0, t: 5, h: 0 }, "en:2": { b: 0, t: 0, h: 0 }, "en:3": { b: 0, t: 5, h: 2 } } }, null).days), "{}");
  assert.equal(J(M({ rows: { dev001: { b: 0, s: { "fr:e": { n: 1, t: 0, d: 0 } } } } }, null).rows), "{}");
  assert.equal(J(M({ themes: [{ id: "BAD ID", m: 1, name: "x", lang: "en", words: ["CAT", "DOG", "OWL"] }] }, null).themes), "[]");
  assert.equal(J(M(null, undefined)), J({ ver: 1, br: 0, days: {}, rows: {}, themes: [], tombs: {} }));
});
