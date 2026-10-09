// Pure logic of Mastermind: key-peg scoring with repeated colours, the
// code generator per level, legal rows, the end of a game and the
// records merge.
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

const SRC = fs.readFileSync(path.join(__dirname, "..", "mastermind/mastermind.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

// cmpStr's cut also takes isInt and randInt, the one-liners after it.
const M = (() => {
  const parts = [cut("  var DATA_VER", "  // ---------- 1.")];
  ["cmpStr", "makeCode", "score", "validRow", "normCell", "normRow", "joinCell", "joinRows",
   "mergeMastermind", "totals", "emptyRow", "finished", "colorForKey"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    parts.push(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function(parts.join("\n") +
    "\nreturn { TRIES, CONF, SYMBOLS, makeCode, score, validRow, mergeMastermind, totals, finished, colorForKey };")();
})();

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);
const S = (g, c) => { const r = M.score(g, c); return [r.b, r.w]; };

test("mastermind: key pegs count repeated colours exactly", () => {
  assert.deepEqual(S([0, 1, 2, 3], [0, 1, 2, 3]), [4, 0]);
  assert.deepEqual(S([3, 2, 1, 0], [0, 1, 2, 3]), [0, 4]);
  assert.deepEqual(S([4, 4, 5, 5], [0, 1, 2, 3]), [0, 0]);
  assert.deepEqual(S([0, 0, 1, 1], [0, 1, 1, 1]), [3, 0]);
  assert.deepEqual(S([1, 1, 0, 0], [0, 1, 2, 3]), [1, 1]);   // one 1 in the code: once
  assert.deepEqual(S([0, 0, 0, 0], [0, 1, 0, 2]), [2, 0]);   // extra 0s get nothing
  assert.deepEqual(S([1, 0, 0, 2], [0, 0, 1, 1]), [1, 2]);
  assert.deepEqual(S([2, 2, 3, 3, 4], [3, 3, 2, 2, 2]), [0, 4]);
  assert.deepEqual(S([5, 5, 5, 6, 7], [5, 6, 7, 5, 5]), [1, 4]);
});

test("mastermind: scoring against brute force (random codes with repeats)", () => {
  for (let k = 0; k < 20000; k++) {
    const n = 4 + rnd(2), C = 6 + rnd(3);
    const g = Array.from({ length: n }, () => rnd(C)), c = Array.from({ length: n }, () => rnd(C));
    const r = M.score(g, c);
    // brute force: mark exact matches, then greedily pair the rest
    const used = Array(n).fill(false), done = Array(n).fill(false);
    let b = 0, w = 0;
    for (let i = 0; i < n; i++) if (g[i] === c[i]) { b++; used[i] = done[i] = true; }
    for (let i = 0; i < n; i++) {
      if (done[i]) continue;
      for (let j = 0; j < n; j++) if (!used[j] && g[i] === c[j]) { used[j] = true; w++; break; }
    }
    assert.deepEqual([r.b, r.w], [b, w], J([g, c]));
    assert.ok(r.b + r.w <= n);
    // symmetric in the total of matches
    const s = M.score(c, g);
    assert.equal(s.b, r.b);
    assert.equal(s.w, r.w);
  }
});

test("mastermind: the generator respects the level", () => {
  assert.equal(J(M.CONF), J({ e: { pegs: 4, colors: 6, rep: false }, m: { pegs: 4, colors: 6, rep: true }, h: { pegs: 5, colors: 8, rep: true } }));
  assert.equal(M.SYMBOLS.length, 8);
  const rand = (n) => Math.floor(Math.random() * n);
  const seenRep = { m: false, h: false }, seenColour = { e: new Set(), m: new Set(), h: new Set() };
  for (let k = 0; k < 3000; k++) {
    for (const lv of ["e", "m", "h"]) {
      const c = M.makeCode(lv, rand), conf = M.CONF[lv];
      assert.equal(c.length, conf.pegs);
      assert.ok(M.validRow(c, lv), lv + " " + J(c));
      c.forEach((x) => { assert.ok(Number.isInteger(x) && x >= 0 && x < conf.colors); seenColour[lv].add(x); });
      if (lv === "e") assert.equal(new Set(c).size, 4, "easy repeats " + J(c));
      else if (new Set(c).size < c.length) seenRep[lv] = true;
    }
  }
  assert.ok(seenRep.m && seenRep.h, "repeats happen on Medium and Hard");
  assert.equal(seenColour.e.size, 6);
  assert.equal(seenColour.h.size, 8);
});

test("mastermind: legal rows per level", () => {
  assert.ok(M.validRow([0, 1, 2, 3], "e"));
  assert.ok(!M.validRow([0, 1, 1, 3], "e"));          // no repeats on Easy
  assert.ok(M.validRow([0, 1, 1, 3], "m"));
  assert.ok(!M.validRow([0, 1, 2, 6], "m"));          // only 6 colours
  assert.ok(!M.validRow([0, 1, 2], "m"));
  assert.ok(M.validRow([7, 7, 7, 7, 7], "h"));
  assert.ok(!M.validRow([0, 1, 2, 3, 8], "h"));
  assert.ok(!M.validRow([0, 1, 2, 3, -1], "h"));
  assert.ok(!M.validRow([0, 1, 2, "3"], "m"));
  assert.ok(!M.validRow(null, "e"));
});

test("mastermind: a game ends at the code or after 10 tries", () => {
  assert.equal(M.TRIES, 10);
  const code = [0, 1, 2, 3];
  assert.equal(M.finished({ code, rows: [] }), "");
  assert.equal(M.finished({ code, rows: [[3, 2, 1, 0]] }), "");
  assert.equal(M.finished({ code, rows: [[3, 2, 1, 0], [0, 1, 2, 3]] }), "w");
  const nine = Array(9).fill([4, 5, 4, 5]);
  assert.equal(M.finished({ code, rows: nine }), "");
  assert.equal(M.finished({ code, rows: nine.concat([[4, 4, 4, 4]]) }), "l");
  assert.equal(M.finished({ code, rows: nine.concat([[0, 1, 2, 3]]) }), "w");   // found on the last try
});

test("mastermind: digit keys pick colours by position", () => {
  assert.equal(M.colorForKey({ code: "Digit1", key: "1" }), 0);
  assert.equal(M.colorForKey({ code: "Numpad8", key: "8" }), 7);
  assert.equal(M.colorForKey({ code: "Digit3", key: "#" }), 2);    // AZERTY-like: the key's place counts
  assert.equal(M.colorForKey({ code: "", key: "4" }), 3);
  assert.equal(M.colorForKey({ code: "KeyA", key: "a" }), -1);
});

test("mastermind: records merge is a join and a reset drops older rows", () => {
  const MM = M.mergeMastermind;
  const cell = () => { const g = 1 + rnd(6), w = rnd(g + 1), bt = w ? 1 + rnd(10) : 0; return { g, w, bt, st: w ? Math.max(w, bt) + rnd(w * 10 - Math.max(w, bt) + 1) : 0 }; };
  const st = () => {
    const rows = {};
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      ["e", "m", "h"].forEach((k) => { if (rnd(2)) s[k] = cell(); });
      rows["d" + rnd(4)] = { b: rnd(3) * 100, s };
    }
    return { ver: 1, br: rnd(4) ? 0 : rnd(3) * 100, rows };
  };
  for (let i = 0; i < 5000; i++) {
    const a = st(), b = st(), c = st(), sa = J(a), sb = J(b);
    assert.equal(J(MM(a, b)), J(MM(b, a)));
    const m = MM(a, b);
    assert.equal(J(MM(m, m)), J(m));
    assert.equal(J(MM(MM(a, b), c)), J(MM(a, MM(b, c))));
    assert.equal(J(a), sa);
    assert.equal(J(b), sb);
  }
  const x = { rows: { d: { b: 0, s: { e: { g: 3, w: 2, bt: 4, st: 10 } } } } };
  const y = { rows: { d: { b: 0, s: { e: { g: 4, w: 1, bt: 3, st: 3 } } } } };
  assert.equal(J(MM(x, y).rows.d.s.e), J({ g: 4, w: 2, bt: 3, st: 10 }));
  assert.equal(J(MM(x, { rows: { d: { b: 0, s: { e: { g: 5, w: 0, bt: 0, st: 0 } } } } }).rows.d.s.e), J({ g: 5, w: 2, bt: 4, st: 10 }));
  assert.equal(J(MM(x, { br: 5, rows: {} }).rows), "{}");
  for (const bad of [{ g: 0, w: 0, bt: 0, st: 0 }, { g: 1, w: 2, bt: 3, st: 6 }, { g: 1, w: 1, bt: 0, st: 3 }, { g: 1, w: 0, bt: 3, st: 0 },
    { g: 1, w: 1, bt: 11, st: 11 }, { g: 2, w: 1, bt: 3, st: 12 }, { g: 1, w: 1, bt: 3 }]) {
    assert.equal(J(MM({ rows: { d: { b: 0, s: { e: bad } } } }, null).rows), "{}", J(bad));
  }
  // totals: best is the fewest tries, average over every win
  const d = MM({ rows: { a: { b: 0, s: { m: { g: 3, w: 2, bt: 4, st: 10 } } }, b: { b: 0, s: { m: { g: 2, w: 1, bt: 3, st: 3 } } } } }, null);
  const tt = M.totals(d, "m");
  assert.equal(J([tt.g, tt.w, tt.bt]), J([5, 3, 3]));
  assert.ok(Math.abs(tt.avg - 13 / 3) < 1e-9);
  assert.equal(M.totals(d, "e").avg, 0);
});
