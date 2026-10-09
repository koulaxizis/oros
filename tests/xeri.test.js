// Pure logic of Xeri: the deal (a Jack never starts on the table), the
// capture rules, xeri and Jack-on-Jack xeri, the last capturer taking
// the rest, the points (21 a deal without xeri, 18 on 26–26), the match
// end, the three computer levels (only valid cards, never your hand),
// stored-match validation and the records merge.
// Run: node --test tests/
//
// cardkit.js is a plain script: it runs here against a fake window.
// xeri.js is a browser IIFE with no exports, so its pure functions are
// cut out of the source by name and evaluated on their own. A renamed
// function fails here loudly ("missing function …").

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

const SRC = fs.readFileSync(path.join(__dirname, "..", "xeri/xeri.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

// A function by name: a one-liner is its own line, else up to its closing brace.
function fn(name) {
  const i = SRC.indexOf("  function " + name + "(");
  if (i < 0) throw new Error("missing function " + name);
  const eol = SRC.indexOf("\n", i);
  if (/\}\s*$/.test(SRC.slice(i, eol))) return SRC.slice(i, eol + 1);
  return SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4);
}

const AI_NAMES = ["aiView", "pileVal", "pAny", "unseenByRank", "sameRankInHand", "scoreMedium", "scoreHard", "chooseCard"];
const X = (() => {
  const parts = [cut("  var DATA_VER", "  var CK =")];
  ["cmpStr", "isInt", "numCmp", "cloneG", "cardPts", "blankGame", "dealRound", "startDeal", "newMatch",
   "captureKind", "playCard", "advance", "dealScore", "matchWinner", "nextDeal", "validGame"]
    .concat(AI_NAMES, ["defaultData", "normCell", "normRow", "joinRows", "mergeXeri", "totals", "bumpCell"])
    .forEach((name) => parts.push(fn(name)));
  return new Function("CK", parts.join("\n") +
    "\nreturn { TARGETS, HAND_SIZES, JACK, cardPts, blankGame, startDeal, newMatch, captureKind, playCard," +
    " advance, dealScore, matchWinner, nextDeal, validGame, aiView, pAny, chooseCard, mergeXeri, totals, bumpCell };")(CK);
})();

const J = JSON.stringify;
const C = (code) => { const id = CK.parse(code); if (id < 0) throw new Error("bad card " + code); return id; };
const Cs = (s) => (s ? s.split(" ").map(C) : []);
const rndOf = (seed) => { const r = CK.seededRandom(seed); return (n) => Math.floor(r() * n); };
const rules = (o) => Object.assign({ lv: "m", tgt: 51, hs: 6, jx: false }, o || {});
const deck = (seed) => CK.seededShuffle(CK.newDeck(), seed);

// A hand-built position; the rest of the 52 cards go to the deck / piles
// so validGame still holds when a test wants it.
function pos(o) {
  const g = X.blankGame(rules(o.rules));
  g.dn = 1; g.lead = 0; g.turn = o.turn || 0;
  g.table = Cs(o.table); g.hands = [Cs(o.you), Cs(o.ai)];
  g.won = [Cs(o.won0), Cs(o.won1)];
  g.last = o.last === undefined ? -1 : o.last;
  const used = new Set([].concat(g.table, g.hands[0], g.hands[1], g.won[0], g.won[1]));
  const rest = CK.newDeck().filter((c) => !used.has(c));
  g.deck = o.deckAll ? rest : [];
  if (!o.deckAll) g.won[1] = g.won[1].concat(rest);   // keeps the 52 together
  return g;
}

// Plays a whole match: each side picks with chooseCard at its level
// (from aiView of its own seat); checks every step.
function playMatch(lv0, lv1, seed, r) {
  const rnd = rndOf(seed);
  let g = X.newMatch(rules(Object.assign({ lv: lv1 }, r)), deck(seed), rnd), steps = 0;
  const deals = [];
  for (;;) {
    while (g.phase === "play") {
      const who = g.turn, view = X.aiView(g, who);
      const i = X.chooseCard(view, who === 0 ? lv0 : lv1, rnd);
      assert.ok(Number.isInteger(i) && i >= 0 && i < g.hands[who].length, "valid card index");
      const before = g;
      const res = X.playCard(g, who, i);
      assert.equal(res.ev.card, before.hands[who][i]);
      g = X.advance(res.g);
      assert.ok(X.validGame(g), "valid after every card");
      if (++steps > 5000) throw new Error("runaway");
    }
    deals.push({ s: X.dealScore(g), g });
    if (g.phase === "over") return { g, deals };
    g = X.nextDeal(g, deck(seed + "-" + g.dn), rnd);
  }
}

// ---------- the deal ----------
test("xeri: a deal gives 6 + 6 cards and 4 on the table, never a Jack", () => {
  for (let s = 0; s < 300; s++) {
    const g = X.newMatch(rules(), deck("d" + s), rndOf("r" + s));
    assert.equal(g.hands[0].length, 6);
    assert.equal(g.hands[1].length, 6);
    assert.equal(g.table.length, 4);
    assert.equal(g.deck.length, 36);
    assert.ok(g.table.every((c) => CK.rank(c) !== X.JACK), "no Jack on the table");
    assert.equal(g.dn, 1);
    assert.equal(g.lead, 0, "you lead the first deal");
    assert.equal(g.turn, 0);
    assert.ok(X.validGame(g));
  }
  // a deck whose next table cards are Jacks: they go back, not on top
  // drawn from the end: 12 cards for the hands, then the four Jacks
  const plain = CK.newDeck().filter((c) => CK.rank(c) !== 11);
  const jacks = CK.newDeck().filter((c) => CK.rank(c) === 11);
  const g = X.newMatch(rules(), plain.slice(0, 36).concat(jacks, plain.slice(36)), rndOf(1));
  assert.ok(g.table.every((c) => CK.rank(c) !== 11));
  assert.deepEqual(g.table, plain.slice(32, 36).reverse(), "the next four plain cards");
  assert.ok(jacks.every((c) => g.deck.includes(c)), "the Jacks are back in the deck");
  assert.ok(X.validGame(g));
  const four = X.newMatch(rules({ hs: 4 }), deck("h4"), rndOf(2));
  assert.equal(four.hands[0].length, 4);
  assert.equal(four.deck.length, 40);
  assert.ok(X.validGame(four));
});

test("xeri: the deck refills both hands until it runs out", () => {
  [6, 4].forEach((hs) => {
    let g = X.newMatch(rules({ hs }), deck("refill" + hs), rndOf(3)), refills = 0;
    while (g.phase === "play") {
      const r = X.playCard(g, g.turn, 0);
      const n = X.advance(r.g);
      if (n.deck.length < r.g.deck.length) {
        refills++;
        assert.equal(n.hands[0].length, hs);
        assert.equal(n.hands[1].length, hs);
        assert.equal(n.turn, n.lead, "the leader plays first in every round");
      }
      g = n;
    }
    assert.equal(refills, hs === 6 ? 3 : 5);
  });
});

// ---------- capture ----------
test("xeri: same rank takes the table, a Jack always does, others pile up", () => {
  assert.equal(X.captureKind([], C("7H"), false), "");
  assert.equal(X.captureKind([], C("JH"), false), "", "a Jack on an empty table just lies there");
  assert.equal(X.captureKind(Cs("3S 9D 7C"), C("7H"), false), "c");
  assert.equal(X.captureKind(Cs("3S 9D 7C"), C("9H"), false), "", "only the top card counts");
  assert.equal(X.captureKind(Cs("3S 9D 7C"), C("JS"), false), "c");
  const g = pos({ table: "3S 9D 7C", you: "7H 2D", ai: "KC 4S" });
  const r = X.playCard(g, 0, 0);
  assert.equal(r.ev.cap, 4);
  assert.equal(r.ev.xeri, 0);
  assert.deepEqual(r.g.table, []);
  assert.deepEqual(r.g.won[0], Cs("3S 9D 7C 7H"));
  assert.equal(r.g.last, 0);
  assert.equal(r.g.turn, 1);
  assert.deepEqual(g.table, Cs("3S 9D 7C"), "the position is never mutated");
  const d = X.playCard(r.g, 1, 1);
  assert.equal(d.ev.cap, 0);
  assert.deepEqual(d.g.table, Cs("4S"));
  assert.equal(d.g.last, 0);
});

test("xeri: a lone card taken is a xeri (10), Jack on Jack 20, Jack on another card optional", () => {
  let g = pos({ table: "8D", you: "8S", ai: "KC" });
  let r = X.playCard(g, 0, 0);
  assert.equal(r.ev.xeri, 10);
  assert.deepEqual(r.g.xr, [[1, 0], [0, 0]]);
  g = pos({ table: "JD", you: "QS", ai: "JC" });
  r = X.playCard(g, 1, 0);
  assert.equal(r.ev.xeri, 20);
  assert.deepEqual(r.g.xr, [[0, 0], [0, 1]]);
  g = pos({ table: "5D", you: "JS", ai: "KC" });
  r = X.playCard(g, 0, 0);
  assert.equal(r.ev.cap, 2);
  assert.equal(r.ev.xeri, 0, "default: a plain capture");
  g = pos({ table: "5D", you: "JS", ai: "KC", rules: { jx: true } });
  r = X.playCard(g, 0, 0);
  assert.equal(r.ev.xeri, 10, "option on: a xeri");
  assert.deepEqual(r.g.xr[0], [1, 0]);
  g = pos({ table: "5D 5S", you: "5H", ai: "KC" });
  assert.equal(X.playCard(g, 0, 0).ev.xeri, 0, "two cards: no xeri");
});

test("xeri: the last capturer takes what is left at the end of the deal", () => {
  // last cards of the deal: you took last, then both drop
  let g = pos({ table: "", you: "4D", ai: "9C", won0: "KD QD", last: 0, turn: 0 });
  let r = X.playCard(g, 0, 0);
  r = X.playCard(X.advance(r.g), 1, 0);
  const end = X.advance(r.g);
  assert.notEqual(end.phase, "play");
  assert.deepEqual(end.table, []);
  assert.ok(Cs("4D 9C").every((c) => end.won[0].includes(c)), "the leftovers went to you");
  // the computer took last
  g = pos({ table: "2H", you: "4D", ai: "9C", last: 1, turn: 0 });
  r = X.playCard(g, 0, 0);
  r = X.playCard(r.g, 1, 0);
  const end2 = X.advance(r.g);
  assert.ok(Cs("2H 4D 9C").every((c) => end2.won[1].includes(c)));
  assert.ok(X.validGame(end2));
});

// ---------- points ----------
test("xeri: card points — 10♦ 2, 2♣ 1, K Q J 10 one each, 18 in all", () => {
  assert.equal(X.cardPts(C("10D")), 2);
  assert.equal(X.cardPts(C("2C")), 1);
  assert.equal(X.cardPts(C("2D")), 0);
  assert.equal(X.cardPts(C("AS")), 0);
  ["10S", "10H", "10C", "JD", "QH", "KS"].forEach((c) => assert.equal(X.cardPts(C(c)), 1, c));
  assert.equal(CK.newDeck().reduce((s, c) => s + X.cardPts(c), 0), 18);
  const g = pos({ won0: "KD QD JD 10D 10S 2C 5H", won1: "" });
  const s = X.dealScore(g);
  assert.equal(s[0].figs, 4, "K Q J 10♠, with 10♦ apart");
  assert.equal(s[0].td, 2);
  assert.equal(s[0].tc, 1);
  assert.equal(s[0].cards, 7);
  assert.equal(s[1].most, 3);
});

test("xeri: every deal is worth 21 without xeri, 18 on a 26–26 tie, plus the xeri", () => {
  let ties = 0, xeris = 0;
  for (let s = 0; s < 120; s++) {
    const { deals } = playMatch(["e", "m", "h"][s % 3], ["e", "m", "h"][(s + 1) % 3], "pts" + s, s % 4 ? {} : { tgt: 0 });
    deals.forEach(({ s: d, g }) => {
      const x = d[0].xeri + d[1].xeri;
      const tie = d[0].cards === d[1].cards;
      assert.equal(d[0].cards + d[1].cards, 52);
      assert.equal(d[0].total + d[1].total - x, tie ? 18 : 21);
      assert.equal(x, 10 * (g.xr[0][0] + g.xr[1][0]) + 20 * (g.xr[0][1] + g.xr[1][1]));
      if (tie) { ties++; assert.equal(d[0].most + d[1].most, 0); }
      xeris += g.xr[0][0] + g.xr[1][0] + g.xr[0][1] + g.xr[1][1];
    });
  }
  assert.ok(xeris > 0, "some xeri happened");
  // a hand-made tie
  const g = pos({ won0: CK.newDeck().slice(0, 26).map(CK.code).join(" ") });
  const d = X.dealScore(g);
  assert.equal(d[0].cards, 26);
  assert.equal(d[0].total + d[1].total, 18);
  void ties;
});

test("xeri: a match ends at the target, a tie there plays on, one deal can be a draw", () => {
  const m = (sc, tgt) => X.matchWinner({ sc, tgt });
  assert.equal(m([50, 20], 51), -1);
  assert.equal(m([51, 20], 51), 0);
  assert.equal(m([60, 72], 51), 1);
  assert.equal(m([55, 55], 51), -1, "a tie past the target: another deal");
  assert.equal(m([100, 90], 101), -1);
  assert.equal(m([12, 9], 0), 0);
  assert.equal(m([9, 9], 0), 2);
  for (let s = 0; s < 40; s++) {
    const tgt = [51, 101, 0][s % 3];
    const { g } = playMatch("h", "e", "match" + s, { tgt });
    assert.equal(g.phase, "over");
    assert.ok(X.matchWinner(g) >= 0);
    if (tgt) assert.ok(Math.max(g.sc[0], g.sc[1]) >= tgt);
    else assert.equal(g.log.length, 1);
    assert.equal(g.sc[0], g.log.reduce((a, d) => a + d[0], 0));
    assert.equal(X.nextDeal(g, deck(1), rndOf(1)), g, "no deal after the end");
  }
});

// ---------- computer ----------
test("xeri: every level plays only cards in its hand, all match long", () => {
  ["e", "m", "h"].forEach((lv) => {
    for (let s = 0; s < 12; s++) playMatch(lv, lv, lv + s, { hs: s % 2 ? 4 : 6, jx: s % 3 === 0 });
  });
});

test("xeri: the computer never reads your hand or the deck", () => {
  // 1. aiView carries the own hand, the open cards and counts, nothing else
  const rnd = rndOf("view");
  for (let s = 0; s < 100; s++) {
    let g = X.newMatch(rules(), deck("v" + s), rnd);
    for (let k = 0; k < (s % 11); k++) g = X.advance(X.playCard(g, g.turn, 0).g);
    if (g.phase !== "play") continue;
    const v = X.aiView(g, 1);
    assert.deepEqual(Object.keys(v).sort(), ["deck", "hand", "hs", "jx", "mine", "opp", "seen", "table"]);
    const hidden = new Set(g.hands[0].concat(g.deck));
    [v.hand, v.table, v.seen].forEach((list) => list.forEach((c) => assert.ok(!hidden.has(c), "a hidden card leaked")));
    assert.equal(v.opp, g.hands[0].length);
    assert.equal(v.deck, g.deck.length);
    // 2. shuffling your hand with the deck changes nothing it decides
    for (let k = 0; k < 4; k++) {
      const h = X.blankGame(rules());
      Object.assign(h, JSON.parse(J(g)));
      const pool = CK.seededShuffle(g.hands[0].concat(g.deck), "p" + s + k);
      h.hands[0] = pool.slice(0, g.hands[0].length);
      h.deck = pool.slice(g.hands[0].length);
      assert.equal(J(X.aiView(h, 1)), J(v));
      ["e", "m", "h"].forEach((lv) => {
        assert.equal(X.chooseCard(X.aiView(h, 1), lv, rndOf("c" + s)), X.chooseCard(v, lv, rndOf("c" + s)));
      });
    }
  }
  // 3. by structure: the computer's section never touches a game object
  const sec = cut("  // ---------- 3. Computer player", "  // ---------- 4. Synced data");
  const others = sec.slice(sec.indexOf("  function pileVal("));
  assert.ok(!/\bg\b/.test(others), "only aiView sees the game");
  assert.ok(!/(?<!view)\.deck\b|deck\[/.test(others), "no deck reads");
  const view = fn("aiView");
  assert.ok(!/deck\.(slice|concat|map|forEach)|deck\[/.test(view), "aiView copies no deck cards");
  assert.equal((view.match(/hands\[/g) || []).length, 2);
  assert.ok(/hands\[1 - me\]\.length/.test(view), "of your hand only its size");
  // 4. the app calls the computer through aiView alone
  assert.ok(/chooseCard\(aiView\(game, 1\), game\.lv, CK\.randInt\)/.test(SRC));
  assert.equal((SRC.match(/chooseCard\(/g) || []).length, 2, "one definition, one call");
});

test("xeri: the computer takes a xeri, Medium keeps Jacks, Hard counts cards", () => {
  const always = () => 0;
  // every level takes a lone 8 with its 8 (Easy 3 times in 4: rnd 0 → capture)
  ["e", "m", "h"].forEach((lv) => {
    const g = pos({ table: "8D", you: "2S 3S", ai: "4C 8S KH", turn: 1, deckAll: true });
    assert.equal(X.chooseCard(X.aiView(g, 1), lv, always), 1, lv);
  });
  // Medium and Hard capture with the 9, not with the Jack
  ["m", "h"].forEach((lv) => {
    const g = pos({ table: "3S 9D", you: "2S 3D", ai: "JC 9S 4H", turn: 1, deckAll: true });
    assert.equal(X.chooseCard(X.aiView(g, 1), lv, always), 1, lv);
  });
  // a Jack on a lone Jack beats everything
  ["m", "h"].forEach((lv) => {
    const g = pos({ table: "JD", you: "2S 3D", ai: "KS JC 4H", turn: 1, deckAll: true });
    assert.equal(X.chooseCard(X.aiView(g, 1), lv, always), 1, lv);
  });
  // Hard, empty table: drops the card whose rank is all out, not a live one
  const g = pos({ table: "", you: "2S 3D", ai: "KS 6C", won0: "6D 6H 6S", turn: 1, deckAll: true });
  assert.equal(X.chooseCard(X.aiView(g, 1), "h", always), 1, "the last 6 cannot be answered");
  // Hard: last card of the round with your hand known by elimination
  assert.ok(X.pAny(10, 0, 3) === 0 && X.pAny(10, 10, 1) === 1 && X.pAny(4, 1, 4) === 1);
  assert.ok(Math.abs(X.pAny(40, 4, 6) - (1 - (36 * 35 * 34 * 33 * 32 * 31) / (40 * 39 * 38 * 37 * 36 * 35))) < 1e-12);
});

test("xeri: Hard beats Easy over many deals, Medium beats Easy", () => {
  const sum = (a, b, n) => {
    let me = 0, them = 0;
    for (let s = 0; s < n; s++) {
      const { deals } = playMatch(a, b, a + b + s, { tgt: 0 });
      deals.forEach(({ s: d }) => { me += d[0].total; them += d[1].total; });
    }
    return [me, them];
  };
  const h = sum("h", "e", 150), m = sum("m", "e", 150);
  assert.ok(h[0] > h[1] * 1.15, "hard " + h);
  assert.ok(m[0] > m[1] * 1.05, "medium " + m);
});

// ---------- stored match ----------
test("xeri: a stored match is checked before it resumes", () => {
  const g = X.newMatch(rules(), deck("store"), rndOf(5));
  assert.ok(X.validGame(g));
  assert.ok(X.validGame(JSON.parse(J(g))));
  const bad = (f) => { const h = JSON.parse(J(g)); f(h); return X.validGame(h); };
  assert.equal(bad((h) => { h.hands[0].push(h.deck.pop()); }), false, "7 cards in a hand");
  assert.equal(bad((h) => { h.table[0] = h.hands[0][0]; }), false, "a card twice");
  assert.equal(bad((h) => { h.deck.pop(); }), false, "a card missing");
  assert.equal(bad((h) => { h.lv = "x"; }), false);
  assert.equal(bad((h) => { h.tgt = 77; }), false);
  assert.equal(bad((h) => { h.sc = [5, 0]; }), false, "points without a deal");
  assert.equal(bad((h) => { h.phase = "end"; }), false);
  assert.equal(bad((h) => { h.xr[0][0] = -1; }), false);
  assert.equal(X.validGame(null), false);
  assert.equal(X.validGame("x"), false);
  const { g: done } = playMatch("m", "m", "stored-end", {});
  assert.ok(X.validGame(JSON.parse(J(done))));
});

// ---------- records merge ----------
function rowsData(br, rows) { return { ver: 1, br, rows }; }

test("xeri: merge is symmetric, associative, idempotent and canonical", () => {
  const rnd = rndOf("merge");
  const ids = ["aaaaaa1", "bbbbbb2", "cccccc3"];
  const randData = () => {
    const rows = {};
    ids.forEach((id) => {
      if (rnd(3) === 0) return;
      const s = {};
      ["e", "m", "h"].forEach((lv) => {
        if (rnd(2)) return;
        const m = rnd(20), w = rnd(m + 1);
        s[lv] = [m, w, rnd(30), rnd(5), rnd(80) + 1];
      });
      rows[id] = { b: [0, 100, 200][rnd(3)], s };
    });
    return rowsData([0, 0, 150][rnd(3)], rows);
  };
  for (let k = 0; k < 400; k++) {
    const a = randData(), b = randData(), c = randData();
    const A = J(a), B = J(b);
    const ab = X.mergeXeri(a, b);
    assert.equal(J(ab), J(X.mergeXeri(b, a)), "symmetric");
    assert.equal(J(X.mergeXeri(ab, c)), J(X.mergeXeri(a, X.mergeXeri(b, c))), "associative");
    assert.equal(J(X.mergeXeri(ab, ab)), J(ab), "idempotent");
    assert.equal(J(X.mergeXeri(ab, null)), J(ab));
    assert.equal(J(a), A, "inputs untouched");
    assert.equal(J(b), B);
    assert.deepEqual(Object.keys(ab.rows), Object.keys(ab.rows).slice().sort());
    Object.values(ab.rows).forEach((r) => { assert.ok(r.b >= ab.br); Object.values(r.s).forEach((v) => assert.ok(v[1] <= v[0])); });
  }
});

test("xeri: per-device rows add up, a reset drops older rows, bad rows drop", () => {
  const a = rowsData(0, { dev0001: { b: 0, s: { m: [3, 2, 4, 1, 30] } } });
  const b = rowsData(0, { dev0002: { b: 0, s: { m: [2, 0, 1, 0, 41], h: [1, 1, 0, 0, 25] } } });
  const ab = X.mergeXeri(a, b);
  assert.deepEqual(X.totals(ab, "m"), [5, 2, 5, 1, 41]);
  assert.deepEqual(X.totals(ab, "h"), [1, 1, 0, 0, 25]);
  assert.deepEqual(X.totals(ab, "e"), [0, 0, 0, 0, 0]);
  // the same device, an older copy and a newer one: the newer counts win
  const older = rowsData(0, { dev0001: { b: 0, s: { m: [2, 1, 3, 1, 30] } } });
  assert.deepEqual(X.mergeXeri(a, older).rows.dev0001.s.m, [3, 2, 4, 1, 30]);
  // reset on one device: rows from before drop everywhere
  const reset = rowsData(500, {});
  const after = X.mergeXeri(ab, reset);
  assert.deepEqual(after.rows, {});
  assert.equal(after.br, 500);
  const fresh = rowsData(500, { dev0002: { b: 500, s: { e: [1, 1, 0, 0, 12] } } });
  assert.deepEqual(X.totals(X.mergeXeri(ab, fresh), "e"), [1, 1, 0, 0, 12]);
  assert.deepEqual(X.mergeXeri(ab, fresh).rows.dev0001, undefined);
  // bad rows and cells
  const junk = { ver: 1, br: -4, rows: {
    "BAD ID": { b: 0, s: { m: [1, 1, 0, 0, 1] } },
    dev0003: { b: 0, s: { m: [1, 2, 0, 0, 1] } },          // w > m
    dev0004: { b: "x", s: { m: [1, 0, 0, 0, 1] } },
    dev0005: { b: 0, s: { m: [1, 0, 0, 0], q: [1, 1, 1, 1, 1] } },
    dev0006: { b: 0, s: { m: [1, 0, 0, 0, 5000] } },       // best deal out of range
    dev0007: { b: 0, s: { m: [0, 0, 0, 0, 0] } },          // empty
    dev0008: { b: 0, s: { h: [2, 1, 1, 0, 33] } } } };
  const clean = X.mergeXeri(junk, junk);
  assert.equal(clean.br, 0);
  assert.deepEqual(Object.keys(clean.rows), ["dev0008"]);
  // bumpCell: a deal adds xeri and the best; a match adds m and w
  let c = X.bumpCell(null, { x: 1, j: 0, d: 24, m: 0, w: 0 });
  assert.deepEqual(c, [0, 0, 1, 0, 24]);
  c = X.bumpCell(c, { x: 0, j: 1, d: 19, m: 1, w: 1 });
  assert.deepEqual(c, [1, 1, 1, 1, 24]);
  c = X.bumpCell(c, { x: 0, j: 0, d: 2000, m: 1, w: 0 });
  assert.deepEqual(c, [2, 1, 1, 1, 999]);
});
