// Pure logic of Solitaire and of the shared cardkit module: the deck,
// crypto and seeded shuffles, the Microsoft FreeCell deals, move rules
// of Klondike / FreeCell / Spider, scoring, undo (positions are never
// mutated), auto-complete, tap targets, hints, stored-game validation
// and the records merge.
// Run: node --test tests/
//
// cardkit.js is a plain script: it runs here against a fake window.
// solitaire.js is a browser IIFE with no exports, so its pure functions
// are cut out of the source by name and evaluated on their own. A
// renamed function fails here loudly ("missing function …").

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { webcrypto } = require("crypto");

const CK = (() => {
  const win = { crypto: webcrypto };
  new Function("window", fs.readFileSync(path.join(__dirname, "..", "cardkit/cardkit.js"), "utf8"))(win);
  return win.orosCards;
})();

const SRC = fs.readFileSync(path.join(__dirname, "..", "solitaire/solitaire.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

// cmpStr's cut also takes isInt, numCmp and fmtTime (the one-liners after it).
const S = (() => {
  const parts = [cut("  var DATA_VER", "  var CK ="), cut("  var BESTS", "  function defaultData")];
  ["cmpStr", "cloneG", "blank", "dealKlondike", "msDeal", "dealFreeCell", "spiderDeck", "dealSpider",
   "pileOf", "scored", "fits", "linked", "runFrom", "maxRun", "canPlace", "flipTop", "collectRuns",
   "applyMove", "drawStock", "dealWhy", "dealRow", "isWon", "canAuto", "foundFor", "autoStep",
   "bestTarget", "allMoves", "moveValue", "findHint", "scoreNow", "keyOf", "intCards", "validGame",
   "defaultData", "normCell", "normRow", "pickBest", "joinCell", "joinRows", "mergeSolitaire",
   "totals", "bumpCell"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    parts.push(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function("CK", parts.join("\n") +
    "\nreturn { KEYS, COLS, dealKlondike, msDeal, dealFreeCell, spiderDeck, dealSpider, pileOf, runFrom," +
    " maxRun, canPlace, applyMove, drawStock, dealWhy, dealRow, isWon, canAuto, foundFor, autoStep," +
    " bestTarget, allMoves, findHint, scoreNow, keyOf, validGame, mergeSolitaire, totals, bumpCell, fmtTime };")(CK);
})();

const J = JSON.stringify;
const C = (code) => { const id = CK.parse(code); if (id < 0) throw new Error("bad card " + code); return id; };
const codes = (arr) => arr.map((c) => CK.code(c).replace(/^10/, "T"));

// An empty table of a variant, to build positions by hand. Cards not
// placed anywhere are put on the foundations / stock so the position
// stays a full deck when a test needs validGame.
function table(v, o, cols) {
  const g = { v, o, deal: v === "f" ? 1 : 0, tab: cols.map((c) => c.map(C)), down: cols.map(() => 0),
    st: [], wa: [], fd: v === "s" ? [] : [[], [], [], []], fc: v === "f" ? [[], [], [], []] : [], mv: 0, sc: 0, ps: 0 };
  return g;
}

// ---------- cardkit ----------
test("cardkit: ids, ranks, suits, colours and codes", () => {
  assert.equal(CK.VERSION, "1.0.0");
  assert.deepEqual(CK.SUITS, ["S", "H", "D", "C"]);
  for (let id = 0; id < 52; id++) {
    assert.equal(CK.make(CK.rank(id), CK.suit(id)), id);
    assert.equal(CK.parse(CK.code(id)), id);
    assert.equal(CK.isRed(id), CK.suit(id) === 1 || CK.suit(id) === 2);
  }
  assert.equal(CK.code(C("QH")), "QH");
  assert.equal(CK.parse("TD"), CK.parse("10D"));
  assert.equal(CK.parse("1X"), -1);
  assert.equal(CK.parse(null), -1);
  assert.equal(CK.cardName(C("QH"), "en"), "Queen of hearts");
  assert.equal(CK.cardName(C("QH"), "el"), "Ντάμα κούπα");
  assert.equal(CK.cardName(C("AS"), "el"), "Άσσος μπαστούνι");
  assert.equal(CK.cardName(C("7C"), "en"), "7 of clubs");
  assert.equal(CK.rankLabel(13, "el"), "Ρ");
  assert.equal(CK.rankLabel(11), "J");
});

test("cardkit: full decks and Spider decks", () => {
  const d = CK.newDeck();
  assert.equal(d.length, 52);
  assert.equal(new Set(d).size, 52);
  assert.deepEqual([...d].sort((a, b) => a - b), Array.from({ length: 52 }, (_, i) => i));
  const two = CK.newDeck({ suits: ["S", "H"], copies: 4 });
  assert.equal(two.length, 104);
  assert.ok(two.every((c) => CK.suit(c) < 2));
  assert.equal(two.filter((c) => c === C("KH")).length, 4);
  assert.throws(() => CK.newDeck({ suits: [7] }));
});

test("cardkit: crypto shuffle is a fair permutation", () => {
  const base = CK.newDeck();
  const a = CK.shuffle(base.slice());
  assert.deepEqual([...a].sort((x, y) => x - y), base);
  assert.notEqual(J(a), J(CK.shuffle(base.slice())));          // 1 / 52! to fail
  for (let i = 0; i < 1000; i++) { const r = CK.randInt(7); assert.ok(r >= 0 && r < 7 && Number.isInteger(r)); }
  // where the ace of spades lands: roughly uniform over 52 places
  const counts = new Array(52).fill(0), N = 10400;
  for (let k = 0; k < N; k++) counts[CK.shuffle(base.slice()).indexOf(0)]++;
  const exp = N / 52, chi = counts.reduce((s, c) => s + (c - exp) ** 2 / exp, 0);
  assert.ok(chi < 110, "chi-square " + chi.toFixed(1));        // 51 dof: p ≈ 1e-6 to fail by chance
});

test("cardkit: seeded shuffle is repeatable", () => {
  const base = CK.newDeck();
  const a = CK.seededShuffle(base.slice(), 617), b = CK.seededShuffle(base.slice(), 617);
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort((x, y) => x - y), base);
  assert.notDeepEqual(a, CK.seededShuffle(base.slice(), 618));
  assert.deepEqual(CK.seededShuffle(base.slice(), "xeri"), CK.seededShuffle(base.slice(), "xeri"));
  const r = CK.seededRandom(1);
  for (let i = 0; i < 1000; i++) { const x = r(); assert.ok(x >= 0 && x < 1); }
});

// ---------- FreeCell deals ----------
test("freecell: deals #1 and #617 match the Microsoft layouts", () => {
  const rows = (n) => {
    const g = S.dealFreeCell(n), out = [];
    for (let r = 0; r < 7; r++) out.push(g.tab.filter((c) => c.length > r).map((c) => codes([c[r]])[0]).join(" "));
    return out;
  };
  assert.deepEqual(rows(1), [
    "JD 2D 9H JC 5D 7H 7C 5H",
    "KD KC 9S 5S AD QC KH 3H",
    "2S KS 9D QD JS AS AH 3C",
    "4C 5C TS QH 4H AC 4D 7S",
    "3S TD 4S TH 8H 2C JH 7D",
    "6D 8S 8D QS 6C 3D 8C TC",
    "6S 9C 2H 6H"]);
  assert.deepEqual(rows(617), [
    "7D AD 5C 3S 5S 8C 2D AH",
    "TD 7S QD AC 6D 8H AS KH",
    "TH QC 3H 9D 6S 8D 3D TC",
    "KD 5H 9S 3C 8S 7H 4D JS",
    "4C QS 9C 9H 7C 6H 2C 2S",
    "4S TS 2H 5D JC 6C JH QH",
    "JD KS KC 4H"]);
  const g = S.dealFreeCell(32000);
  assert.ok(S.validGame(g));
  assert.deepEqual(g.tab.map((c) => c.length), [7, 7, 7, 7, 6, 6, 6, 6]);
});

// ---------- Klondike ----------
test("klondike: the deal, draw 1 / 3 and turning the waste over", () => {
  const g = S.dealKlondike(CK.newDeck(), 3, true);
  assert.ok(S.validGame(g));
  assert.deepEqual(g.tab.map((c) => c.length), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(g.down, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(g.st.length, 24);
  assert.equal(S.keyOf(g), "k3c");
  let n = S.drawStock(g);
  assert.equal(n.wa.length, 3);
  assert.equal(n.st.length, 21);
  assert.equal(n.wa[2], g.st[21]);                   // the third card drawn is on top
  for (let k = 0; k < 7; k++) n = S.drawStock(n);
  assert.equal(n.st.length, 0);
  n = Object.assign(S.drawStock(n), {});            // turn over
  assert.equal(n.st.length, 24);
  assert.equal(n.wa.length, 0);
  assert.equal(n.ps, 1);
  assert.deepEqual(n.st, g.st);                      // the same order again
  assert.equal(n.mv, 9);
  const empty = Object.assign(S.dealKlondike(CK.newDeck(), 1, false), { st: [], wa: [] });
  assert.equal(S.drawStock(empty), null);
});

test("klondike: building down in alternating colours, kings to empty columns", () => {
  const g = table("k", "1c", [["KS", "QH"], [], ["JC"], ["JD"], ["QS"], ["9H"], ["KD"]]);
  assert.equal(S.canPlace(g, "t2", [C("JC")], "t0"), "");       // J♣ on Q♥
  assert.equal(S.canPlace(g, "t3", [C("JD")], "t0"), "rule");   // J♦ on Q♥: same colour
  assert.equal(S.canPlace(g, "t4", [C("QS")], "t1"), "rule");   // only a king to an empty column
  assert.equal(S.canPlace(g, "t6", [C("KD")], "t1"), "");
  assert.equal(S.canPlace(g, "t5", [C("9H")], "f0"), "rule");   // foundation starts with an ace
  assert.equal(S.canPlace(g, "t0", [C("KS"), C("QH")], "f0"), "rule");
  assert.deepEqual(S.runFrom(g, "t0", 0), [C("KS"), C("QH")]);
  g.down[0] = 1;
  assert.equal(S.runFrom(g, "t0", 0), null);                    // face down
});

test("klondike: classic score and turning a card", () => {
  let g = table("k", "1c", [["5C", "4H"], ["AH"], ["5S"], ["3C"], [], [], []]);
  g.down[0] = 1;
  g.wa = [C("2H")];
  assert.equal(S.canPlace(g, "t1", [C("AH")], "f0"), "");
  g = S.applyMove(g, "t1", 0, "f0");                 // A♥ up: +10
  assert.equal(g.sc, 10);
  assert.equal(S.canPlace(g, "w0", [C("2H")], "f0"), "");
  g = S.applyMove(g, "w0", 0, "f0");                 // 2♥ waste → foundation: +10
  assert.equal(g.sc, 20);
  assert.equal(S.canPlace(g, "t0", [C("4H")], "t2"), "");
  g = S.applyMove(g, "t0", 1, "t2");                 // 4♥ on 5♠; the 5♣ turns: +5
  assert.equal(g.down[0], 0);
  assert.equal(g.sc, 25);
  assert.deepEqual(S.runFrom(g, "f0", 1), [C("2H")]);
  assert.equal(S.canPlace(g, "f0", [C("2H")], "t3"), "");
  g = S.applyMove(g, "f0", 1, "t3");                 // foundation → column: −15
  assert.equal(g.sc, 10);
  assert.equal(g.mv, 4);
  const n = table("k", "1n", [["AH"], [], [], [], [], [], []]);
  assert.equal(S.applyMove(n, "t0", 0, "f0").sc, 0); // no score
  // recycle penalties, never below 0
  const r = Object.assign(S.dealKlondike(CK.newDeck(), 1, true), { sc: 150 });
  r.wa = r.st; r.st = [];
  assert.equal(S.drawStock(r).sc, 50);
  const r3 = Object.assign(S.dealKlondike(CK.newDeck(), 3, true), { sc: 10 });
  r3.wa = r3.st; r3.st = [];
  assert.equal(S.drawStock(r3).sc, 0);
});

test("klondike: time penalty and the win bonus", () => {
  const g = Object.assign(table("k", "1c", [[], [], [], [], [], [], []]), { sc: 500 });
  assert.equal(S.scoreNow(g, 9999, false), 500);
  assert.equal(S.scoreNow(g, 25000, false), 496);
  assert.equal(S.scoreNow(g, 100000, true), 480 + 7000);
  assert.equal(S.scoreNow(g, 20000, true), 496);                   // no bonus under 30 s
  assert.equal(S.scoreNow(Object.assign({}, g, { o: "1n" }), 100000, true), 0);
  assert.equal(S.fmtTime(3723000), "1:02:03");
  assert.equal(S.fmtTime(61000), "1:01");
});

// ---------- FreeCell ----------
test("freecell: multi-card moves need free cells and empty columns", () => {
  const g = table("f", "", [["KS", "QH", "JC", "TD"], ["KH"], ["2C"], ["3C"], ["4C"], ["5C"], ["6C"], ["7C"]]);
  g.fc = [[C("8C")], [C("9C")], [C("TC")], []];      // one free cell, no empty column
  const run = S.runFrom(g, "t0", 1);                  // Q♥ J♣ 10♦
  assert.equal(run.length, 3);
  assert.equal(S.maxRun(g, false), 2);
  assert.equal(S.canPlace(g, "t0", run, "t1"), "rule");          // Q♥ on K♥
  assert.equal(S.canPlace(g, "t0", run.slice(1), "t1"), "rule");
  g.tab[1] = [C("KC")];
  assert.equal(S.canPlace(g, "t0", run, "t1"), "cells");         // 3 > 2
  g.fc[0] = [];                                                  // two free cells → 3
  assert.equal(S.maxRun(g, false), 3);
  assert.equal(S.canPlace(g, "t0", run, "t1"), "");
  g.tab[7] = [];                                                 // + one empty column → 6, to it → 3
  g.fc[0] = [C("7C")];
  assert.equal(S.maxRun(g, false), 4);
  assert.equal(S.maxRun(g, true), 2);
  assert.equal(S.canPlace(g, "t0", run, "t7"), "cells");
  assert.equal(S.canPlace(g, "t0", run.slice(1), "t7"), "");
  assert.equal(S.canPlace(g, "t0", [C("TD")], "c3"), "");        // free cell
  assert.equal(S.canPlace(g, "t0", [C("TD")], "c0"), "rule");    // taken
  assert.equal(S.canPlace(g, "t0", run, "c3"), "rule");
  assert.equal(S.runFrom(g, "f0", 0), null);
});

// ---------- Spider ----------
test("spider: the deal, runs of one suit, dealing rows, completed runs", () => {
  [1, 2, 4].forEach((s) => {
    const d = S.spiderDeck(s);
    assert.equal(d.length, 104);
    assert.equal(new Set(d.map((c) => CK.suit(c))).size, s);
    const g = S.dealSpider(CK.shuffle(d.slice()), s);
    assert.ok(S.validGame(g));
    assert.deepEqual(g.tab.map((c) => c.length), [6, 6, 6, 6, 5, 5, 5, 5, 5, 5]);
    assert.equal(g.st.length, 50);
    assert.equal(g.sc, 500);
  });
  const g = table("s", "2", [["9H", "8S", "7S"], ["9S"], ["5H"], ["4H"], ["3H"], ["2H"], ["AH"], ["KH"], ["QH"], ["JH"]]);
  assert.equal(S.runFrom(g, "t0", 0), null);                    // 9♥ 8♠: two suits
  assert.equal(S.runFrom(g, "t0", 1).length, 2);
  assert.equal(S.canPlace(g, "t0", [C("8S"), C("7S")], "t1"), "");     // any suit below
  assert.equal(S.canPlace(g, "t0", [C("7S")], "t2"), "rule");
  assert.equal(S.canPlace(g, "t2", [C("5H")], "f0"), "rule");          // no foundation moves
  assert.equal(S.dealWhy(g), "stock");
  g.st = CK.newDeck({ suits: [0], copies: 1 }).slice(0, 10);
  assert.equal(S.dealWhy(g), "");
  const e = Object.assign({}, g, { tab: g.tab.map((c, i) => (i === 3 ? [] : c)) });
  assert.equal(S.dealWhy(e), "empty");
  const n = S.dealRow(g);
  assert.equal(n.st.length, 0);
  assert.ok(n.tab.every((c, i) => c.length === g.tab[i].length + 1));
  assert.equal(n.sc, 0);                                         // 0 − 1, floored
  // a K→A run of one suit leaves the column and turns the card under it
  const run = ["KS", "QS", "JS", "TS", "9S", "8S", "7S", "6S", "5S", "4S", "3S", "2S"].map(C);
  const r = table("s", "1", [["5S"], ["AS"], [], [], [], [], [], [], [], []]);
  r.tab[0] = [C("9S")].concat(run);
  r.down[0] = 1;
  r.sc = 500;
  const done = S.applyMove(r, "t1", 0, "t0");
  assert.equal(done.fd.length, 1);
  assert.deepEqual(done.fd[0], run.concat([C("AS")]).reverse());  // ace at the bottom
  assert.deepEqual(done.tab[0], [C("9S")]);
  assert.equal(done.down[0], 0);
  assert.equal(done.sc, 500 - 1 + 100);
});

// ---------- undo, auto-complete, taps, hints ----------
test("solitaire: moves never change the position they start from (undo)", () => {
  const g = S.dealKlondike(CK.shuffle(CK.newDeck()), 1, true), before = J(g);
  const moves = S.allMoves(g);
  moves.forEach((m) => S.applyMove(g, m.src, m.i, m.dst));
  S.drawStock(g);
  assert.equal(J(g), before);
  const sp = S.dealSpider(CK.shuffle(S.spiderDeck(4)), 4), sb = J(sp);
  S.dealRow(sp);
  S.allMoves(sp).forEach((m) => S.applyMove(sp, m.src, m.i, m.dst));
  assert.equal(J(sp), sb);
});

test("solitaire: random play keeps every card (all three variants)", () => {
  const fresh = [() => S.dealKlondike(CK.shuffle(CK.newDeck()), 3, true),
                 () => S.dealFreeCell(1 + CK.randInt(32000)),
                 () => S.dealSpider(CK.shuffle(S.spiderDeck(2)), 2)];
  for (let round = 0; round < 60; round++) {
    let g = fresh[round % 3]();
    for (let step = 0; step < 120; step++) {
      const ms = S.allMoves(g);
      const k = CK.randInt(ms.length + 1);
      let n;
      if (k === ms.length) n = g.v === "k" ? S.drawStock(g) : (g.v === "s" ? S.dealRow(g) : null);
      else n = S.applyMove(g, ms[k].src, ms[k].i, ms[k].dst);
      if (!n) continue;
      assert.ok(S.validGame(n), "invalid after " + (k === ms.length ? "stock" : J(ms[k])));
      assert.ok(n.down.every((d, c) => d === 0 || d < n.tab[c].length));
      g = n;
    }
  }
});

test("solitaire: auto-complete finishes an open Klondike and a sorted FreeCell", () => {
  // Klondike: everything open, stock and waste empty
  let g = S.dealKlondike(CK.newDeck(), 1, false);
  g = Object.assign(g, { st: [], wa: [], down: [0, 0, 0, 0, 0, 0, 0], tab: [[], [], [], [], [], [], []],
    fd: [0, 1, 2, 3].map((s) => CK.newDeck({ suits: [s] }).slice(0, 10)) });
  g.tab[0] = [C("KS"), C("QH"), C("JS")];
  g.tab[1] = [C("KH"), C("QS"), C("JH")];
  g.tab[2] = [C("KD"), C("QC"), C("JD")];
  g.tab[3] = [C("KC"), C("QD"), C("JC")];
  assert.ok(S.validGame(g));
  assert.ok(S.canAuto(g));
  let n = 0;
  while (!S.isWon(g) && n++ < 60) { const s = S.autoStep(g); assert.ok(s); g = S.applyMove(g, s.src, s.i, s.dst); }
  assert.ok(S.isWon(g));
  assert.equal(n, 12);
  assert.equal(S.canAuto(g), false);
  // a hidden card or a stock card stops it
  const h = S.dealKlondike(CK.newDeck(), 1, false);
  assert.equal(S.canAuto(h), false);
  // FreeCell: every column falls in rank toward its top (suits mixed)
  let f = table("f", "", [["KS", "QD", "JS"], ["KH", "QS"], ["KD", "QH", "JD"], ["KC", "QC", "JC"], [], [], [], ["JH"]]);
  f.fd = [0, 1, 2, 3].map((s) => CK.newDeck({ suits: [s] }).slice(0, 10));
  assert.ok(S.validGame(f));
  assert.ok(S.canAuto(f));
  n = 0;
  while (!S.isWon(f) && n++ < 60) { const s = S.autoStep(f); assert.ok(s); f = S.applyMove(f, s.src, s.i, s.dst); }
  assert.ok(S.isWon(f));
  const blocked = table("f", "", [["JS", "QD"], [], [], [], [], [], [], []]);
  assert.equal(S.canAuto(blocked), false);
  assert.equal(S.canAuto(S.dealSpider(S.spiderDeck(1), 1)), false);
});

test("solitaire: a tap picks the best place", () => {
  // foundation first
  const g = table("k", "1c", [["AH"], ["9S"], ["8H"], [], [], [], []]);
  assert.equal(J(S.bestTarget(g, "t0", 0)), J({ dst: "f0", why: "" }));
  assert.equal(J(S.bestTarget(g, "t2", 0)), J({ dst: "t1", why: "" }));
  assert.equal(S.bestTarget(g, "t1", 0).dst, "");                       // 9♠: nowhere
  // a king alone in its column does not hop to another empty column
  const k = table("k", "1c", [["KH"], [], [], [], [], [], []]);
  assert.equal(S.bestTarget(k, "t0", 0).dst, "");
  k.wa = [C("KS")];
  assert.equal(S.bestTarget(k, "w0", 0).dst, "t1");
  // Spider: same suit first
  const s = table("s", "2", [["7H"], ["8S"], ["8H"], [], [], [], [], [], [], []]);
  assert.equal(S.bestTarget(s, "t0", 0).dst, "t2");
  // FreeCell: a free cell when no column takes it; a run too long says why
  const f = table("f", "", [["5C"], ["9D"], ["9H"], ["2C"], ["3C"], ["4C"], ["6C"], ["7C"]]);
  assert.equal(S.bestTarget(f, "t0", 0).dst, "c0");
  const r = table("f", "", [["KS", "QH", "JC", "TD", "9S"], ["KC"], ["2C"], ["3C"], ["4C"], ["5C"], ["6C"], ["7C"]]);
  r.fc = [[C("8C")], [C("9C")], [C("TC")], [C("AD")]];
  assert.equal(J(S.bestTarget(r, "t0", 1)), J({ dst: "", why: "cells" }));
});

test("solitaire: hints prefer foundations and revealing cards", () => {
  const g = table("k", "1c", [["5C", "4H"], ["AH"], ["6D"], [], [], [], []]);
  g.down[0] = 1;
  assert.equal(J(S.findHint(g)), J({ src: "t1", i: 0, dst: "f0" }));
  const r = table("k", "1c", [["5C", "4H"], ["5S"], [], [], [], [], []]);
  r.down[0] = 1;
  assert.equal(J(S.findHint(r)), J({ src: "t0", i: 1, dst: "t1" }));   // turns the 5♣
  const stuck = table("k", "1c", [["9C"], ["5S"], [], [], [], [], []]);
  assert.equal(S.findHint(stuck), null);
  stuck.st = [C("2H")];
  assert.equal(J(S.findHint(stuck)), J({ src: "s0", i: -1, dst: "" }));
  // no back-and-forth: a run already on a fitting card is not a hint
  const loop = table("k", "1c", [["9H", "8S"], ["9D"], [], [], [], [], []]);
  assert.equal(S.findHint(loop), null);
});

test("solitaire: stored games are checked before they are resumed", () => {
  const g = S.dealKlondike(CK.shuffle(CK.newDeck()), 1, true);
  assert.ok(S.validGame(g));
  assert.ok(S.validGame(S.dealFreeCell(617)));
  const bad = (f) => { const x = JSON.parse(J(g)); f(x); return S.validGame(x); };
  assert.equal(bad((x) => { x.st.pop(); }), false);                      // a card missing
  assert.equal(bad((x) => { x.st[0] = x.st[1]; }), false);               // a card twice
  assert.equal(bad((x) => { x.fd[0] = [x.st.pop()]; }), CK.rank(g.st[g.st.length - 1]) === 1);
  assert.equal(bad((x) => { x.down[6] = 9; }), false);
  assert.equal(bad((x) => { x.v = "x"; }), false);
  assert.equal(bad((x) => { x.o = "2c"; }), false);
  assert.equal(bad((x) => { x.mv = -1; }), false);
  assert.equal(bad((x) => { x.tab.pop(); }), false);
  assert.equal(S.validGame(null), false);
  assert.equal(S.validGame(Object.assign(S.dealFreeCell(5), { deal: 32001 })), false);
});

// ---------- records merge ----------
test("solitaire: a played game, a win and the bests", () => {
  let c = S.bumpCell(null, { won: false });
  assert.equal(J(c), J({ p: 1, w: 0, k: 0 }));
  c = S.bumpCell(c, { won: true, ms: 200000, moves: 120, score: 3000, streak: 1, ts: 100 });
  assert.equal(J(c), J({ p: 1, w: 1, k: 1, t: 200000, tt: 100, m: 120, mt: 100, s: 3000, st: 100 }));
  c = S.bumpCell(S.bumpCell(c, { won: false }), { won: true, ms: 250000, moves: 110, score: null, streak: 2, ts: 200 });
  assert.equal(c.p, 2);
  assert.equal(c.w, 2);
  assert.equal(c.k, 2);
  assert.equal(c.t, 200000);                       // slower: kept
  assert.equal(c.m, 110);                          // fewer moves: new
  assert.equal(c.mt, 200);
  assert.equal(c.s, 3000);
});

function randCell() {
  const p = 1 + CK.randInt(9), w = CK.randInt(p + 1), k = CK.randInt(w + 1);
  const c = { p, w, k };
  if (w) {
    c.t = 1000 * (1 + CK.randInt(5)); c.tt = CK.randInt(4);
    c.m = 50 + CK.randInt(5); c.mt = CK.randInt(4);
    if (CK.randInt(2)) { c.s = CK.randInt(5) * 100; c.st = CK.randInt(4); }
  }
  return c;
}
function randData() {
  const d = { ver: 1, br: CK.randInt(3), rows: {} };
  ["a", "b", "c"].forEach((id) => {
    if (CK.randInt(4) === 0) return;
    const s = {};
    S.KEYS.forEach((k) => { if (CK.randInt(3) === 0) s[k] = randCell(); });
    d.rows[id] = { b: CK.randInt(3), s };
  });
  return d;
}

test("solitaire: merge is a join (symmetric, associative, idempotent, canonical)", () => {
  for (let i = 0; i < 3000; i++) {
    const a = randData(), b = randData(), c = randData();
    const A = J(a), B = J(b);
    const ab = S.mergeSolitaire(a, b);
    assert.equal(J(ab), J(S.mergeSolitaire(b, a)));
    assert.equal(J(S.mergeSolitaire(ab, ab)), J(ab));
    assert.equal(J(S.mergeSolitaire(S.mergeSolitaire(a, b), c)), J(S.mergeSolitaire(a, S.mergeSolitaire(b, c))));
    assert.equal(J(S.mergeSolitaire(ab, a)), J(ab));
    assert.equal(J(a), A);
    assert.equal(J(b), B);
    Object.keys(ab.rows).forEach((id) => assert.ok(ab.rows[id].b >= ab.br));
    assert.deepEqual(Object.keys(ab.rows), Object.keys(ab.rows).slice().sort());
  }
});

test("solitaire: reset stamp, bad rows and totals", () => {
  const d = { ver: 1, br: 0, rows: {
    a: { b: 0, s: { k1c: { p: 3, w: 2, k: 2, t: 90000, tt: 5, m: 100, mt: 5, s: 4000, st: 5 } } },
    b: { b: 0, s: { k1c: { p: 2, w: 1, k: 1, t: 80000, tt: 9, m: 130, mt: 9 }, f: { p: 1, w: 0, k: 0 } } },
    c: { b: 0, s: { k1c: { p: 1, w: 3, k: 0 } } },          // more wins than games: dropped
    d: { b: -1, s: { f: { p: 1, w: 0, k: 0 } } },           // bad epoch
    e: { b: 0, s: { zz: { p: 1, w: 0, k: 0 } } }            // unknown key
  } };
  const m = S.mergeSolitaire(d, d);
  assert.deepEqual(Object.keys(m.rows), ["a", "b"]);
  const tot = S.totals(m, "k1c");
  assert.equal(J(tot), J({ p: 5, w: 3, k: 2, t: 80000, tt: 9, m: 100, mt: 5, s: 4000, st: 5 }));
  assert.equal(J(S.totals(m, "s4")), J({ p: 0, w: 0, k: 0 }));
  // bests without a win are dropped
  assert.equal(J(S.mergeSolitaire({ rows: { a: { b: 0, s: { f: { p: 1, w: 0, k: 0, t: 5, tt: 1 } } } } }, null).rows.a.s.f),
    J({ p: 1, w: 0, k: 0 }));
  // a reset (br) on one device wipes the older rows everywhere
  const r = S.mergeSolitaire(m, { ver: 1, br: 10, rows: { b: { b: 10, s: { f: { p: 1, w: 1, k: 1, t: 5000, tt: 11, m: 90, mt: 11 } } } } });
  assert.equal(r.br, 10);
  assert.deepEqual(Object.keys(r.rows), ["b"]);
  assert.equal(r.rows.b.s.f.w, 1);
  assert.equal(r.rows.b.s.k1c, undefined);
  // same epoch: the better best wins, the earlier one on a tie
  const x = S.mergeSolitaire({ rows: { a: { b: 1, s: { f: { p: 2, w: 1, k: 1, t: 5000, tt: 7, m: 90, mt: 7 } } } } },
                             { rows: { a: { b: 1, s: { f: { p: 3, w: 1, k: 1, t: 5000, tt: 3, m: 95, mt: 3 } } } } });
  assert.equal(J(x.rows.a.s.f), J({ p: 3, w: 1, k: 1, t: 5000, tt: 3, m: 90, mt: 7 }));
});
