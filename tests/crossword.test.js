// Pure logic of Crossword (fill-in / kriss-kross): the layout generator
// (connected, every run of letters is exactly one listed word, crossings
// agree), the solver and the given letters (unique solution), the daily
// puzzle, the grid helpers, the session check and the records merge.
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

const SRC = fs.readFileSync(path.join(__dirname, "..", "crossword/crossword.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

// One-liners ride along with the function after them: cmpStr takes
// isInt, statKeyOk takes normStat, setCh rides with nextCell's block.
const C = (() => {
  const parts = [cut("  var DATA_VER", "  // ---------- 1.")];
  ["cmpStr", "normWord", "hashStr", "seeded", "shuffled", "cellsOf", "canPlace", "spots", "layout", "crop",
   "solve", "solLetters", "chooseGivens", "randomPool", "buildPuzzle", "dayIndex", "dailyPuzzle", "slotMap",
   "readSlot", "placedWords", "isSolved", "wrongCells", "nextCell", "fmtTime", "streaks", "normDayRes",
   "dayKeyOk", "betterDay", "statKeyOk", "joinStat", "normRow", "joinRows", "mergeCW", "themeOk", "idxList",
   "validGame", "startFill"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    parts.push(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  parts.push(cut("  function setCh(", "\n\n"));
  return new Function(parts.join("\n") +
    "\nreturn { LEVELS, THEME_IDS, LETTERS, DAILY_SIZE, EMPTY, BLOCK, KB_ROWS, EL_BY_CODE, normWord, hashStr, seeded," +
    " cellsOf, canPlace, layout, crop, solve, chooseGivens, buildPuzzle, dayIndex, dailyPuzzle, slotMap, readSlot," +
    " placedWords, isSolved, wrongCells, nextCell, setCh, fmtTime, streaks, mergeCW, themeOk, validGame, startFill };")();
})();

// The shared word lists of Word Search (the documented header format).
function words(lang) {
  const window = {};
  new Function("window", fs.readFileSync(path.join(__dirname, "..", `wordsearch/words-${lang}.js`), "utf8"))(window);
  const src = window.WORDSEARCH_WORDS[lang];
  const split = (s) => s.split(" ").filter((w) => w);
  const common = {}, themes = {};
  Object.keys(src.common).forEach((k) => { common[k] = split(src.common[k]); });
  Object.keys(src.themes).forEach((k) => { themes[k] = split(src.themes[k]); });
  return { common, themes };
}
const LISTS = { en: words("en"), el: words("el") };

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);

// Every horizontal and vertical run of 2+ letters, as "r,c,d:WORD".
function runs(pz) {
  const out = [], { rows, cols, sol } = pz;
  for (const d of [0, 1]) {
    const A = d ? cols : rows, B = d ? rows : cols;
    for (let a = 0; a < A; a++) {
      let b = 0;
      while (b < B) {
        const at = (k) => (d ? sol[k * cols + a] : sol[a * cols + k]);
        if (at(b) === C.BLOCK) { b++; continue; }
        let e = b;
        while (e < B && at(e) !== C.BLOCK) e++;
        if (e - b >= 2) {
          let w = "";
          for (let k = b; k < e; k++) w += at(k);
          out.push((d ? b + "," + a : a + "," + b) + "," + d + ":" + w);
        }
        b = e;
      }
    }
  }
  return out.sort();
}

// A valid puzzle: letters of the alphabet, every run of letters is
// exactly one listed word (no stray words), connected, words distinct,
// crossings agree, the bounding box is tight, givens on letter cells.
function checkPuzzle(pz, lang, size, label) {
  const lv = C.LEVELS[size];
  assert.ok(pz.rows <= lv.n && pz.cols <= lv.n, label + " size " + pz.rows + "x" + pz.cols);
  assert.equal(pz.sol.length, pz.rows * pz.cols, label);
  for (const ch of pz.sol) assert.ok(ch === C.BLOCK || C.LETTERS[lang].includes(ch), label + " letter " + ch);
  assert.equal(new Set(pz.words.map((p) => p.w)).size, pz.words.length, label + " distinct");
  const placed = pz.words.map((p) => [p.r, p.c, p.d].join(",") + ":" + p.w).sort();
  assert.equal(J(runs(pz)), J(placed), label + " runs = words");
  pz.words.forEach((p) => assert.equal(C.readSlot(pz.sol, p, pz.cols), p.w, label));
  // connected (4-neighbours over letter cells)
  const letters = [];
  for (let i = 0; i < pz.sol.length; i++) if (pz.sol[i] !== C.BLOCK) letters.push(i);
  const seen = new Set([letters[0]]), stack = [letters[0]];
  while (stack.length) {
    const ix = stack.pop(), r = Math.floor(ix / pz.cols), c = ix % pz.cols;
    [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].forEach(([y, x]) => {
      const k = y * pz.cols + x;
      if (y >= 0 && x >= 0 && y < pz.rows && x < pz.cols && pz.sol[k] !== C.BLOCK && !seen.has(k)) { seen.add(k); stack.push(k); }
    });
  }
  assert.equal(seen.size, letters.length, label + " connected");
  // tight box: the first / last row and column hold a letter
  const rowHas = (r) => pz.sol.slice(r * pz.cols, (r + 1) * pz.cols).replace(/\./g, "").length > 0;
  const colHas = (c) => { for (let r = 0; r < pz.rows; r++) if (pz.sol[r * pz.cols + c] !== C.BLOCK) return true; return false; };
  assert.ok(rowHas(0) && rowHas(pz.rows - 1) && colHas(0) && colHas(pz.cols - 1), label + " cropped");
  // givens: 1 to lv.giv letter cells, sorted
  assert.ok(pz.giv.length >= 1 && pz.giv.length <= lv.giv, label + " givens " + pz.giv.length);
  assert.equal(J(pz.giv), J(pz.giv.slice().sort((a, b) => a - b)));
  pz.giv.forEach((ix) => assert.notEqual(pz.sol[ix], C.BLOCK, label));
}

test("crossword: Greek words lose accents and the final sigma; keyboards cover the alphabets", () => {
  assert.equal(C.normWord("λόγος"), "ΛΟΓΟΣ");
  assert.equal(C.normWord("Προϊόν"), "ΠΡΟΙΟΝ");
  assert.equal(C.normWord("x-ray!"), "XRAY");
  assert.equal(C.normWord(null), "");
  for (const lang of ["en", "el"]) {
    assert.equal(C.KB_ROWS[lang].join("").split("").sort().join(""), C.LETTERS[lang].split("").sort().join(""), lang);
  }
  // physical keys by position: every Greek letter is reachable
  assert.equal(new Set(Object.values(C.EL_BY_CODE)).size, 24);
  Object.keys(C.EL_BY_CODE).forEach((k) => assert.match(k, /^Key[A-Z]$/));
});

test("crossword: the shared Word Search lists have the documented shape", () => {
  for (const lang of ["en", "el"]) {
    const L = LISTS[lang], re = lang === "el" ? /^[Α-Ω]+$/ : /^[A-Z]+$/;
    assert.equal(Object.keys(L.common).join(), "3,4,5,6,7,8,9,10");
    Object.keys(L.common).forEach((k) => {
      assert.ok(L.common[k].length >= 100, lang + " " + k);
      L.common[k].forEach((w) => assert.ok(re.test(w) && w.length === +k, w));
    });
    C.THEME_IDS.forEach((id) => assert.ok(L.themes[id].length >= 20, lang + " " + id));
  }
});

test("crossword: a word goes in only where crossings agree and nothing touches side by side", () => {
  const n = 7, cells = Array(n * n).fill(""), own = Array(n * n).fill(0);
  const put = (w, r, c, d) => C.cellsOf({ w, r, c, d }, n).forEach((ix, j) => { cells[ix] = w[j]; own[ix] |= 1 << d; });
  put("HOUSE", 3, 1, 0);                                       // across, row 3, columns 1–5
  assert.equal(C.canPlace(cells, own, n, "SUN", 2, 3, 1), 1);    // down through the U
  assert.equal(C.canPlace(cells, own, n, "SAD", 2, 3, 1), -1);   // A ≠ U
  assert.equal(C.canPlace(cells, own, n, "HOUSE", 3, 1, 0), -1); // every letter already there
  assert.equal(C.canPlace(cells, own, n, "OUR", 3, 2, 0), -1);   // the cell before (H) is full
  assert.equal(C.canPlace(cells, own, n, "EGO", 3, 5, 0), -1);   // the E runs across already
  assert.equal(C.canPlace(cells, own, n, "CAT", 2, 1, 0), -1);   // side by side above HOUSE
  assert.equal(C.canPlace(cells, own, n, "TOE", 0, 1, 1), -1);   // would run into the H
  assert.equal(C.canPlace(cells, own, n, "SHE", 2, 1, 1), 1);    // down through the H
  assert.equal(C.canPlace(cells, own, n, "ELONGATED", 3, 5, 1), -1);  // out of the box
  put("SUN", 2, 3, 1);
  assert.equal(C.canPlace(cells, own, n, "ROT", 2, 2, 1), -1);   // crosses the O, but touches SUN
  assert.equal(C.canPlace(cells, own, n, "ASK", 2, 2, 0), -1);   // crosses SUN's S, but touches HOUSE
  assert.equal(C.canPlace(cells, own, n, "BUS", 0, 3, 1), -1);   // would end on SUN's S (no gap)
});

test("crossword: every layout is connected, every run of letters is one listed word", () => {
  const shares = [];
  for (const lang of ["en", "el"]) {
    for (const size of ["e", "m", "h"]) {
      const lv = C.LEVELS[size];
      for (const theme of ["random"].concat(C.THEME_IDS)) {
        for (let s = 0; s < (theme === "random" ? 10 : 1); s++) {
          const label = `${lang} ${size} ${theme} #${s}`;
          const pz = C.buildPuzzle(LISTS[lang], size, theme, C.seeded(C.hashStr(label)));
          assert.ok(pz, label);
          checkPuzzle(pz, lang, size, label);
          assert.ok(pz.words.length >= lv.lo && pz.words.length <= lv.hi, label + ": " + pz.words.length);
          if (theme === "random") pz.words.forEach((p) => assert.ok(LISTS[lang].common[p.w.length].includes(p.w), label));
          else {
            const share = pz.words.filter((p) => LISTS[lang].themes[theme].includes(p.w)).length;
            // mostly theme words (topped up with common words where the
            // theme's words do not cross enough)
            assert.ok(share * 5 >= pz.words.length * 2, label + " theme words " + share);
            shares.push(share / pz.words.length);
          }
        }
      }
    }
  }
  assert.ok(shares.reduce((a, b) => a + b, 0) / shares.length >= 0.7, "theme share");
});

test("crossword: the solver proves a unique solution; givens break ties", () => {
  let unique = 0, total = 0;
  for (const lang of ["en", "el"]) {
    for (const size of ["e", "m", "h"]) {
      for (let s = 0; s < 8; s++) {
        const pz = C.buildPuzzle(LISTS[lang], size, "random", C.seeded(1000 + s));
        const r = C.solve(pz, pz.giv, 3);
        total++;
        if (pz.uq) { unique++; assert.equal(r.n, 1, lang + size + s); assert.ok(!r.cut); }
        else assert.ok(r.n >= 2 || r.cut);
        // the real solution is always one of them
        const all = C.solve(pz, pz.sol.split("").map((ch, i) => i).filter((i) => pz.sol[i] !== C.BLOCK), 2);
        assert.equal(all.n, 1);
        assert.equal(J(all.sols[0]), J(pz.words.map((p, i) => i)));
      }
    }
  }
  assert.ok(unique >= total - 2, unique + "/" + total);
  // two same-length words that can swap: 2 solutions; a given letter
  // decides, and chooseGivens finds such a letter
  const swap = C.crop([{ w: "ART", r: 0, c: 0, d: 0 }, { w: "ANT", r: 0, c: 0, d: 1 }]);
  assert.equal(C.solve(swap, [], 5).n, 2);            // ART ↔ ANT share the A
  const ix = swap.words.findIndex((p) => p.w === "ART");
  const rCell = C.cellsOf(swap.words[ix], swap.cols)[1];
  assert.equal(C.solve(swap, [rCell], 5).n, 1);       // the given R decides
  const g = C.chooseGivens(swap, C.LEVELS.e, C.seeded(3));
  assert.ok(g.uq);
  assert.equal(C.solve(swap, g.giv, 5).n, 1);
});

test("crossword: the first given letter sits on a crossing of the most crossed word", () => {
  for (let s = 0; s < 30; s++) {
    const pz = C.buildPuzzle(LISTS.en, ["e", "m", "h"][s % 3], "random", C.seeded(77 + s));
    const cover = Array(pz.sol.length).fill(0);
    pz.words.forEach((p) => C.cellsOf(p, pz.cols).forEach((ix) => cover[ix]++));
    const cross = (p) => C.cellsOf(p, pz.cols).filter((ix) => cover[ix] > 1).length;
    const most = Math.max(...pz.words.map(cross));
    assert.ok(pz.giv.some((ix) => cover[ix] > 1 && pz.words.some((p) => cross(p) === most && C.cellsOf(p, pz.cols).includes(ix))), "seed " + s);
  }
});

test("crossword: the daily puzzle follows the date and the language only", () => {
  assert.equal(C.dayIndex(new Date(2026, 0, 1)), 0);
  assert.equal(C.dayIndex(new Date(2026, 2, 29, 23, 30)), 87);     // across the DST change
  for (const lang of ["en", "el"]) {
    const a = C.dailyPuzzle(LISTS[lang], lang, 281), b = C.dailyPuzzle(LISTS[lang], lang, 281);
    assert.equal(J(a), J(b));
    checkPuzzle(a, lang, C.DAILY_SIZE, "daily " + lang);
    assert.notEqual(C.dailyPuzzle(LISTS[lang], lang, 282).sol, a.sol);
  }
  assert.notEqual(C.dailyPuzzle(LISTS.en, "en", 5).sol, C.dailyPuzzle(LISTS.el, "el", 5).sol);
  assert.equal(C.hashStr("abc"), 0x1a47e90b);
  // a month of dailies: all valid, nearly all unique, quick
  const t0 = Date.now();
  let uq = 0;
  for (let d = 0; d < 30; d++) {
    const pz = C.dailyPuzzle(LISTS.el, "el", 300 + d);
    checkPuzzle(pz, "el", "m", "daily el " + d);
    uq += pz.uq ? 1 : 0;
  }
  assert.ok(uq >= 28, "unique " + uq);
  assert.ok(Date.now() - t0 < 6000, "slow: " + (Date.now() - t0));
});

test("crossword: slots, placed words, solved check, wrong letters, cursor moves", () => {
  // ART across at row 0, ANT down at column 0
  const pz = C.crop([{ w: "ART", r: 0, c: 0, d: 0 }, { w: "ANT", r: 0, c: 0, d: 1 }]);
  assert.equal(pz.sol, "ARTN..T..");
  const map = C.slotMap(pz.words, pz.rows, pz.cols);
  const ant = pz.words.findIndex((p) => p.w === "ANT"), art = 1 - ant;
  assert.equal(J(map[0]), J([art, ant]));
  assert.equal(J(map[1]), J([art, -1]));
  assert.equal(J(map[4]), J([-1, -1]));
  let fill = C.startFill(pz.sol, [0]);
  assert.equal(fill, "A--" + "-.." + "-..");
  assert.equal(C.placedWords(fill, pz.words, pz.cols).length, 0);
  fill = C.setCh(C.setCh(fill, 1, "R"), 2, "T");
  assert.equal(J(C.placedWords(fill, pz.words, pz.cols)), J([art]));
  assert.ok(!C.isSolved(fill, pz.words, pz.cols));
  fill = C.setCh(C.setCh(fill, 3, "N"), 6, "T");
  assert.ok(C.isSolved(fill, pz.words, pz.cols));
  // the other way round also fits every word: counts as solved
  const swapped = "ANTR..T..";
  assert.ok(C.isSolved(swapped, pz.words, pz.cols));
  assert.equal(C.placedWords(swapped, pz.words, pz.cols).length, 0);
  assert.equal(J(C.wrongCells(swapped, pz.sol, [0, 1, 2, 3, 4, 6])), J([1, 3]));
  assert.equal(J(C.wrongCells("A-X-..T..", pz.sol, [0, 1, 2, 3])), J([2]));
  // a word used twice is not a solution
  assert.ok(!C.isSolved("ARTR..T..", pz.words, pz.cols));
  // arrows jump over empty squares, stop at the edge
  const sol = "AB.C" + ".D.E" + "FG.H";       // 3 rows × 4 columns
  assert.equal(C.nextCell(sol, 3, 4, 1, 0, 1), 3);
  assert.equal(C.nextCell(sol, 3, 4, 3, 0, 1), -1);
  assert.equal(C.nextCell(sol, 3, 4, 0, 1, 0), 8);
  assert.equal(C.nextCell(sol, 3, 4, 8, -1, 0), 0);
});

test("crossword: a saved session is checked before it is resumed", () => {
  const pz = C.buildPuzzle(LISTS.el, "e", "random", C.seeded(5));
  const g = { lang: "el", mode: "f", day: 281, size: "e", theme: "random", rows: pz.rows, cols: pz.cols, sol: pz.sol,
    words: pz.words, giv: pz.giv, uq: pz.uq, fill: C.startFill(pz.sol, pz.giv), bad: [], rev: [],
    cur: pz.giv[0], dir: 0, hinted: false, ms: 0, done: false, ext: false };
  assert.ok(C.validGame(g, "el:f"));
  assert.ok(!C.validGame(g, "en:f"));
  const bad = (patch) => !C.validGame(Object.assign({}, g, patch), "el:f");
  const letterIx = pz.sol.split("").findIndex((ch, i) => ch !== C.BLOCK && !pz.giv.includes(i));
  const blockIx = pz.sol.indexOf(C.BLOCK);
  assert.ok(bad({ fill: g.fill.slice(1) }));
  assert.ok(bad({ fill: C.setCh(g.fill, letterIx, "Q") }));                 // not a Greek letter
  assert.ok(bad({ fill: C.setCh(g.fill, pz.giv[0], "-") }));                // a given erased
  assert.ok(bad({ sol: C.setCh(pz.sol, letterIx, "Ω") }) || pz.sol[letterIx] === "Ω");
  assert.ok(bad({ words: pz.words.slice(1) }));                             // a stray letter
  assert.ok(bad({ cur: blockIx >= 0 ? blockIx : -1 }));
  assert.ok(bad({ bad: [letterIx] }));                                      // marked wrong but empty
  assert.ok(!bad({ fill: C.setCh(g.fill, letterIx, "Α"), bad: [letterIx] }));
  assert.ok(bad({ rev: [letterIx] }));                                      // revealed but not there
  assert.ok(bad({ size: "x" }) && bad({ dir: 2 }) && bad({ ms: -1 }) && bad({ theme: "pirates" }));
  assert.ok(C.themeOk("random") && C.themeOk("sea") && !C.themeOk("u:abc123"));
});

test("crossword: times and streaks", () => {
  assert.equal(C.fmtTime(0), "0:00");
  assert.equal(C.fmtTime(65.9), "1:05");
  assert.equal(C.fmtTime(3725), "1:02:05");
  assert.equal(J(C.streaks({}, 10)), J({ cur: 0, best: 0 }));
  assert.equal(J(C.streaks({ 8: 1, 9: 1, 10: 1 }, 10)), J({ cur: 3, best: 3 }));
  assert.equal(J(C.streaks({ 8: 1, 9: 1 }, 10)), J({ cur: 2, best: 2 }));
  assert.equal(J(C.streaks({ 1: 1, 2: 1, 3: 1, 7: 1 }, 9)), J({ cur: 0, best: 3 }));
});

test("crossword: records merge is a join; a reset drops older results", () => {
  const M = C.mergeCW;
  const stat = () => { const t = rnd(3) ? rnd(4) * 30 + 30 : 0; return { n: rnd(5) + 1, t, d: t ? rnd(3) * 1000 + 1 : 0 }; };
  const st = () => {
    const rows = {}, days = {};
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      ["en:e", "en:m", "el:h"].forEach((k) => { if (rnd(2)) s[k] = stat(); });
      rows["dev00" + rnd(4)] = { b: rnd(3) * 100, s };
    }
    for (let i = 0; i < rnd(4); i++) days[["en", "el"][rnd(2)] + ":" + rnd(5)] = { b: rnd(3) * 100, t: rnd(5) * 20 + 1, h: rnd(2) };
    return { ver: 1, br: rnd(4) ? 0 : rnd(3) * 100, days, rows };
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
  // daily: newer epoch wins; equal epochs keep the better result (no reveal, then faster)
  const d = (v) => ({ days: { "en:3": v } });
  assert.equal(J(M(d({ b: 0, t: 90, h: 0 }), d({ b: 0, t: 40, h: 1 })).days["en:3"]), J({ b: 0, t: 90, h: 0 }));
  assert.equal(J(M(d({ b: 0, t: 90, h: 0 }), d({ b: 0, t: 40, h: 0 })).days["en:3"]), J({ b: 0, t: 40, h: 0 }));
  assert.equal(J(M(d({ b: 0, t: 40, h: 0 }), d({ b: 9, t: 99, h: 1 })).days["en:3"]), J({ b: 9, t: 99, h: 1 }));
  // free play: solved = max per device, best = the shorter time with its date
  const r = (s) => ({ rows: { dev001: { b: 0, s: { "en:m": s } } } });
  assert.equal(J(M(r({ n: 3, t: 80, d: 5 }), r({ n: 2, t: 60, d: 9 })).rows.dev001.s["en:m"]), J({ n: 3, t: 60, d: 9 }));
  assert.equal(J(M(r({ n: 3, t: 0, d: 0 }), r({ n: 1, t: 60, d: 9 })).rows.dev001.s["en:m"]), J({ n: 3, t: 60, d: 9 }));
  // a newer epoch replaces the whole row
  assert.equal(J(M({ rows: { dev001: { b: 0, s: { "en:m": { n: 9, t: 5, d: 1 } } } } },
    { rows: { dev001: { b: 7, s: { "el:e": { n: 1, t: 0, d: 0 } } } } }).rows.dev001), J({ b: 7, s: { "el:e": { n: 1, t: 0, d: 0 } } }));
  // reset: older entries drop
  const full = M({ days: { "en:1": { b: 0, t: 5, h: 0 } }, rows: { dev001: { b: 0, s: { "en:e": { n: 1, t: 5, d: 1 } } } } }, null);
  const reset = M(full, { br: 50 });
  assert.equal(J(reset), J({ ver: 1, br: 50, days: {}, rows: {} }));
  assert.equal(J(M(reset, full)), J(reset));
  // bad entries drop
  for (const bad of [{ n: 0, t: 0, d: 0 }, { n: 1, t: 5, d: 0 }, { n: 1, t: 0, d: 5 }, { n: 1.5, t: 0, d: 0 }, { n: 1, t: -1, d: 1 }]) {
    assert.equal(J(M(r(bad), null).rows), "{}", J(bad));
  }
  assert.equal(J(M({ days: { "en:x": { b: 0, t: 5, h: 0 }, "de:1": { b: 0, t: 5, h: 0 }, "en:2": { b: 0, t: 0, h: 0 }, "en:3": { b: 0, t: 5, h: 2 } } }, null).days), "{}");
  assert.equal(J(M({ rows: { dev001: { b: 0, s: { "fr:e": { n: 1, t: 0, d: 0 } } } } }, null).rows), "{}");
  assert.equal(J(M({ rows: { "BAD ID": { b: 0, s: { "en:e": { n: 1, t: 0, d: 0 } } } } }, null).rows), "{}");
  assert.equal(J(M(null, undefined)), J({ ver: 1, br: 0, days: {}, rows: {} }));
  // canonical: key order does not matter
  assert.equal(J(M({ days: { "el:2": { h: 0, t: 5, b: 0 }, "en:1": { b: 0, t: 5, h: 0 } } }, null)),
    J(M({ days: { "en:1": { b: 0, t: 5, h: 0 }, "el:2": { b: 0, t: 5, h: 0 } } }, null)));
});
