// Pure logic of the Wheel of Fate: option normalization, ready sets,
// the saved-wheel merge (sync slice "wheel"), the fair draw and the
// spin geometry (the wheel stops on the drawn winner).
// Run: node --test tests/
//
// The app is a browser IIFE with no exports, so the constants and
// sections 2–4 are cut out of the source and evaluated on their own.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { webcrypto } = require("crypto");

const src = fs.readFileSync(path.join(__dirname, "..", "wheel/wheel.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
function build(lang) {
  return new Function("crypto",
    "var LANG = " + JSON.stringify(lang) + ";\n" +
    block("  var STORAGE_KEY", "  // ---------- 1.") +
    block("  function cmpStr(", "  function newId(") +
    block("  // ---------- 2. Wheel model", "  // ---------- 5. Storage") +
    "\nreturn { MIN_OPTS, MAX_OPTS, OPT_LEN, TAU, COLORS, SET_IDS, SETS, normOpt, normOpts, setOpts, segColor, inkFor," +
    " normSaved, mergeWheel, randInt, pointerIndex, spinTarget, easeOut };")(webcrypto);
}
const W = build("en");
const WEL = build("el");

const ID = "abc123def";
function saved(id, m, name, opts) { return { id, m, name, opts: opts || ["A", "B"] }; }
function data(wheels, tombs) { return { ver: 1, wheels: wheels || [], tombs: tombs || {} }; }

test("options: trimmed, spaces collapsed, empties dropped, capped", () => {
  assert.equal(W.normOpt("  Go   out  "), "Go out");
  assert.equal(W.normOpt("x".repeat(80)).length, W.OPT_LEN);
  assert.equal(W.normOpt(5), "");
  assert.deepEqual(W.normOpts(["a", " ", "", null, "b"]), ["a", "b"]);
  const many = Array.from({ length: 50 }, (_, i) => "o" + i);
  assert.equal(W.normOpts(many).length, W.MAX_OPTS);
  assert.deepEqual(W.normOpts("nope"), []);
});

test("ready sets: 2–30 valid options in both languages, same sizes", () => {
  assert.equal(W.SET_IDS.length, 9);
  W.SET_IDS.forEach((id) => {
    const en = W.SETS.en[id], el = W.SETS.el[id];
    assert.ok(en && el, id);
    assert.equal(en.length, el.length, id);
    [en, el].forEach((list) => {
      assert.ok(list.length >= W.MIN_OPTS && list.length <= W.MAX_OPTS, id);
      assert.deepEqual(W.normOpts(list), list, id);
    });
  });
  assert.deepEqual(WEL.setOpts("yesno"), ["Ναι", "Όχι"]);
  const s = W.setOpts("food"); s.push("x");
  assert.equal(W.setOpts("food").length, 6);                 // a copy, not the set
});

test("segment colours: neighbours differ, the last never matches the first", () => {
  for (let n = 2; n <= W.MAX_OPTS; n++) {
    for (let i = 0; i < n; i++) {
      assert.notEqual(W.segColor(i, n), W.segColor((i + 1) % n, n), `n=${n} i=${i}`);
    }
  }
  W.COLORS.forEach((c) => assert.match(W.inkFor(c), /^#(1b1b1b|ffffff)$/));
  assert.equal(W.inkFor("#f1c453"), "#1b1b1b");
  assert.equal(W.inkFor("#3a86ff"), "#ffffff");
});

test("fair draw: every outcome, no bias (chi-square over 60,000 draws)", () => {
  for (const n of [2, 3, 7, 30]) {
    const N = 60000, counts = new Array(n).fill(0);
    for (let k = 0; k < N; k++) {
      const r = W.randInt(n);
      assert.ok(Number.isInteger(r) && r >= 0 && r < n);
      counts[r]++;
    }
    const e = N / n, chi = counts.reduce((s, c) => s + (c - e) * (c - e) / e, 0);
    // 99.9th percentile of chi-square with n-1 degrees of freedom is < 3.5·(n-1)+11
    assert.ok(chi < 3.5 * (n - 1) + 11, `n=${n} chi=${chi}`);
  }
});

test("spin geometry: the wheel stops on the drawn segment", () => {
  for (let n = 2; n <= W.MAX_OPTS; n++) {
    for (let k = 0; k < 40; k++) {
      const win = W.randInt(n), r0 = Math.random() * 50 - 25, frac = 0.12 + 0.76 * Math.random();
      const turns = 4 + (k % 3);
      const r1 = W.spinTarget(r0, win, n, frac, turns);
      assert.ok(r1 >= r0 + turns * W.TAU && r1 < r0 + (turns + 1) * W.TAU, "always forward, whole turns");
      assert.equal(W.pointerIndex(r1, n), win, `n=${n} win=${win}`);
    }
  }
  assert.equal(W.pointerIndex(0, 4), 0);
  assert.equal(W.pointerIndex(-W.TAU / 4 - 0.01, 4), 1);
  assert.equal(W.easeOut(0), 0);
  assert.equal(W.easeOut(1), 1);
  assert.equal(W.easeOut(2), 1);
  assert.ok(W.easeOut(0.5) > 0.5);
});

test("normSaved drops bad wheels and clips names", () => {
  assert.equal(W.normSaved(saved("x", 1, "A")), null);                       // short id
  assert.equal(W.normSaved(saved(ID, 1.5, "A")), null);
  assert.equal(W.normSaved(saved(ID, 1, " ")), null);
  assert.equal(W.normSaved(saved(ID, 1, "One", ["only", " "])), null);       // < 2 options
  const x = W.normSaved(saved(ID, 1, "  Lunch   " + "x".repeat(60), [" a ", "b", ""]));
  assert.equal(x.name.length, 40);
  assert.deepEqual(x.opts, ["a", "b"]);
});

test("mergeWheel: symmetric, associative, idempotent, canonical, inputs untouched", () => {
  const A = data([saved("aaaaaa1", 10, "One"), saved("bbbbbb2", 20, "Two")]);
  const B = data([saved("aaaaaa1", 15, "One", ["X", "Y", "Z"]), saved("cccccc3", 5, "Three")], { bbbbbb2: 19 });
  const C = data([saved("dddddd4", 7, "Four")], { cccccc3: 6 });
  const snapA = JSON.stringify(A), snapB = JSON.stringify(B);
  const ab = W.mergeWheel(A, B);
  assert.deepEqual(ab, W.mergeWheel(B, A));
  assert.deepEqual(W.mergeWheel(W.mergeWheel(A, B), C), W.mergeWheel(A, W.mergeWheel(B, C)));
  assert.deepEqual(W.mergeWheel(ab, ab), ab);
  assert.equal(JSON.stringify(A), snapA);
  assert.equal(JSON.stringify(B), snapB);
  assert.deepEqual(ab.wheels.map((x) => x.id), ["aaaaaa1", "bbbbbb2", "cccccc3"]);
  assert.deepEqual(ab.wheels[0].opts, ["X", "Y", "Z"]);                      // newer m wins
});

test("mergeWheel: tombstones win ties, a newer edit resurrects, equal mtime agrees", () => {
  const live = data([saved(ID, 100, "Lunch")]);
  assert.deepEqual(W.mergeWheel(live, data([], { [ID]: 100 })).wheels, []);
  assert.equal(W.mergeWheel(live, data([], { [ID]: 99 })).wheels.length, 1);
  const A = data([saved(ID, 10, "Alpha")]), B = data([saved(ID, 10, "Beta")]);
  assert.deepEqual(W.mergeWheel(A, B), W.mergeWheel(B, A));
  assert.deepEqual(W.mergeWheel({ wheels: [null, 3, { id: ID }], tombs: { "BAD ID": 1, [ID]: -2 } }, undefined),
    { ver: 1, wheels: [], tombs: {} });
});
