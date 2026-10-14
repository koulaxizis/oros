// Play on two devices (remote-play.js + each game's net section): the
// message filter, and per game the checks a device makes on what the
// other one sends: Connect 4 and Backgammon (the host keeps the game,
// the guest adopts checked pictures), Xeri (the guest never sees the
// host's cards) and Battleship (each fleet stays on its own device; the
// answers are checked as they come and against the fleet at the end).
// Run: node --test tests/
//
// The games are browser IIFEs with no exports, so the pure functions are
// cut out of the source by name and evaluated on their own. A renamed
// function fails here loudly ("missing function …").

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { webcrypto } = require("crypto");

function load(file, names, preludes, ret, extra) {
  const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const parts = preludes.map(([from, to]) => {
    const i = src.indexOf(from), j = src.indexOf(to, i);
    if (i < 0 || j < 0) throw new Error("missing block " + from);
    return src.slice(i, j);
  });
  names.forEach((name) => {
    const i = src.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    const eol = src.indexOf("\n", i);
    parts.push(/\}\s*$/.test(src.slice(i, eol)) ? src.slice(i, eol + 1) : src.slice(i, src.indexOf("\n  }\n", i) + 4));
  });
  return new Function("crypto", "performance", "window",
    (extra || "") + parts.join("\n") + "\nreturn {" + ret + "};")(webcrypto, performance, { performance });
}
const J = JSON.stringify;
const clone = (x) => JSON.parse(J(x));

// ---------- remote-play.js ----------
const RP = (() => {
  const win = {};
  new Function("window", fs.readFileSync(path.join(__dirname, "..", "remote-play.js"), "utf8"))(win);
  return win.OrosRemotePlay;
})();

test("remote play: a message is a plain object with a short lower-case type", () => {
  assert.ok(RP.okMsg({ t: "st" }));
  assert.ok(RP.okMsg({ t: "_bye" }));
  [null, undefined, "st", 5, [], ["st"], {}, { t: 5 }, { t: "ST" }, { t: "" }, { t: "a-b" }, { t: "abcdefghijklm" }]
    .forEach((m) => assert.equal(RP.okMsg(m), false, J(m)));
  assert.equal(J(Object.keys(RP.STR.en).sort()), J(Object.keys(RP.STR.el).sort()), "every string in EN and EL");
});

// ---------- Connect 4 ----------
const C4 = load("connect4/connect4.js",
  ["cmpStr", "isInt", "emptyBoard", "lineAt", "wins", "replay", "validSession", "netMove", "netView", "netAdopt"],
  [["  var DATA_VER", "  // ---------- 1."], ["  var DIRS", "  function lineAt("]],
  "replay, netMove, netView, netAdopt");

test("connect4 on two devices: the host takes only the guest's move, in turn", () => {
  const g = { mode: "net", lv: "m", starter: 1, ai: 2, moves: [3], done: false, series: [0, 0] };
  const b = C4.replay(g.moves, g.starter);
  assert.equal(C4.netMove(g, b, { t: "mv", n: 1, c: 4 }), 4);
  assert.equal(C4.netMove(g, b, { t: "mv", n: 0, c: 4 }), -1, "a stale move");
  assert.equal(C4.netMove(g, b, { t: "mv", n: 1, c: 7 }), -1, "no such column");
  assert.equal(C4.netMove(g, b, { t: "mv", n: 1, c: "4" }), -1);
  const b2 = C4.replay([3, 4], 1);
  assert.equal(C4.netMove(Object.assign({}, g, { moves: [3, 4] }), b2, { t: "mv", n: 2, c: 4 }), -1, "not the guest's turn");
  const full = { mode: "net", lv: "m", starter: 1, ai: 2, moves: [0, 0, 0, 0, 0, 0], done: false, series: [0, 0] };
  assert.equal(C4.netMove(full, C4.replay(full.moves, 1), { t: "mv", n: 6, c: 0 }), -1, "a full column");
});

test("connect4 on two devices: the guest adopts a checked picture only", () => {
  const g = { mode: "net", lv: "m", starter: 1, ai: 2, moves: [3, 4, 3, 4], done: false, series: [1, 2] };
  const a = C4.netAdopt(C4.netView(g));
  assert.equal(a.ai, 1, "the guest's opponent is player 1");
  assert.equal(J(a.moves), J(g.moves));
  assert.equal(J(a.series), J([1, 2]));
  assert.equal(C4.netAdopt(Object.assign(C4.netView(g), { moves: [3, 3, 3, 3, 3, 3, 3] })), null, "an impossible column");
  assert.equal(C4.netAdopt(Object.assign(C4.netView(g), { done: true })), null, "over without a win");
  // play goes on after a win: refused
  assert.equal(C4.netAdopt(Object.assign(C4.netView(g), { moves: [3, 4, 3, 4, 3, 4, 3, 4] })), null);
  assert.ok(C4.netAdopt(Object.assign(C4.netView(g), { moves: [3, 4, 3, 4, 3, 4, 3], done: true })));
  assert.equal(C4.netAdopt({ t: "st", moves: "3" }), null);
});

// ---------- Backgammon ----------
const BG = (() => {
  const src = fs.readFileSync(path.join(__dirname, "..", "backgammon/backgammon.js"), "utf8");
  const cut = (from, to) => {
    const i = src.indexOf(from), j = src.indexOf(to, i);
    if (i < 0 || j < 0) throw new Error("missing block " + from);
    return src.slice(i, j);
  };
  const fn = (name) => {
    const i = src.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    return src.slice(i, src.indexOf("\n  }\n", i) + 4);
  };
  const parts = [cut("  var LEVELS", "  // ---------- 1."), cut("  function cmpStr(", "  function reducedMotion("),
    cut("  // ---------- 2. Board model", "  // ---------- 4. Synced data")];
  ["validC", "validDice", "validSession", "netCheck", "netView", "netAdopt"].forEach((n) => parts.push(fn(n)));
  return new Function("crypto", "performance", "window", parts.join("\n") +
    "\nreturn { startPos, netCheck, netView, netAdopt };")(webcrypto, performance, { performance });
})();

function bgGame(o) {
  return Object.assign({ mode: "net", lv: "m", ai: 1, c: BG.startPos(), phase: "move", turn: 1, dice: [3, 5], rem: [3, 5],
                         hist: [], mv: [], series: [0, 0], last: null, tie: 0, pts: 0 }, o || {});
}
test("backgammon on two devices: the host checks the guest's intents by turn and number", () => {
  const g = bgGame();
  assert.equal(BG.netCheck(g, { t: "to", ns: 4, f: 24, to: 21 }, 4), "to");
  assert.equal(BG.netCheck(g, { t: "to", ns: 3, f: 24, to: 21 }, 4), "", "a stale picture");
  assert.equal(BG.netCheck(g, { t: "to", ns: 4, f: 26, to: 21 }, 4), "", "no such point");
  assert.equal(BG.netCheck(g, { t: "to", ns: 4, f: "24", to: 21 }, 4), "");
  assert.equal(BG.netCheck(g, { t: "undo", ns: 4 }, 4), "", "nothing to undo");
  assert.equal(BG.netCheck(g, { t: "done", ns: 4 }, 4), "done");
  assert.equal(BG.netCheck(bgGame({ turn: 0 }), { t: "to", ns: 4, f: 24, to: 21 }, 4), "", "the host's turn");
  assert.equal(BG.netCheck(bgGame({ phase: "roll" }), { t: "roll", ns: 4 }, 4), "roll");
  assert.equal(BG.netCheck(bgGame({ phase: "roll", turn: 0 }), { t: "roll", ns: 4 }, 4), "");
  assert.equal(BG.netCheck(bgGame({ phase: "done", winner: 0 }), { t: "to", ns: 4, f: 24, to: 21 }, 4), "");
  assert.equal(BG.netCheck(bgGame({ phase: "done", winner: 0 }), { t: "again", ns: 4 }, 4), "again");
  assert.equal(BG.netCheck(Object.assign(bgGame(), { mode: "ai" }), { t: "done", ns: 4 }, 4), "", "not a game on two devices");
});
test("backgammon on two devices: the guest's picture has the sides turned and is checked", () => {
  const g = bgGame({ ai: 1 });
  const m = BG.netView(g, 7);
  assert.equal(m.ns, 7);
  assert.equal(m.g.ai, 0, "the host is the guest's opponent");
  assert.equal(g.ai, 1, "the host's game is not changed");
  const a = BG.netAdopt(clone(m));
  assert.ok(a);
  assert.equal(BG.netAdopt(Object.assign(clone(m), { ns: "7" })), null);
  const bad = clone(m); bad.g.c = [[1], [2]];
  assert.equal(BG.netAdopt(bad), null, "a broken board");
  const bad2 = clone(m); bad2.g.ai = 1;
  assert.equal(BG.netAdopt(bad2), null);
  const bad3 = clone(m); bad3.g.series = [-1, 0];
  assert.equal(BG.netAdopt(bad3), null);
});

// ---------- Xeri ----------
const CK = (() => {
  const win = { crypto: webcrypto };
  new Function("window", fs.readFileSync(path.join(__dirname, "..", "cardkit/cardkit.js"), "utf8"))(win);
  return win.orosCards;
})();
const XR = (() => {
  const src = fs.readFileSync(path.join(__dirname, "..", "xeri/xeri.js"), "utf8");
  const i0 = src.indexOf("  var DATA_VER"), j0 = src.indexOf("  var CK =", i0);
  if (i0 < 0 || j0 < 0) throw new Error("missing block DATA_VER");
  const parts = [src.slice(i0, j0)];
  ["cmpStr", "isInt", "numCmp", "cloneG", "cardPts", "blankGame", "dealRound", "startDeal", "newMatch",
   "captureKind", "playCard", "advance", "dealScore", "matchWinner", "nextDeal", "validGame",
   "netSide", "netView", "netGame", "netPlay"].forEach((name) => {
    const i = src.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    const eol = src.indexOf("\n", i);
    parts.push(/\}\s*$/.test(src.slice(i, eol)) ? src.slice(i, eol + 1) : src.slice(i, src.indexOf("\n  }\n", i) + 4));
  });
  return new Function("CK", parts.join("\n") + "\nreturn { newMatch, playCard, netView, netGame, netPlay, validGame };")(CK);
})();
const xrRnd = (seed) => { const r = CK.seededRandom(seed); return (n) => Math.floor(r() * n); };
function xrMatch(seed) {
  const g = XR.newMatch({ lv: "m", tgt: 51, hs: 6, jx: false }, CK.seededShuffle(CK.newDeck(), seed), xrRnd(seed));
  g.net = true;
  return g;
}
test("xeri on two devices: the guest's picture holds its own cards only, 52 in all", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const g = xrMatch(seed);
    const m = XR.netView(g, 3, null);
    const text = J(m);
    // none of the host's hand or the deck is in the message
    const sent = m.g.hand.concat(m.g.table, m.g.won[0], m.g.won[1]);
    g.hands[0].concat(g.deck).forEach((c) => assert.ok(sent.indexOf(c) < 0, "hidden card " + c + " sent"));
    assert.equal(J(m.g.hand), J(g.hands[1]), "the guest's own hand");
    assert.equal(m.g.opp, g.hands[0].length, "the host's hand as a count");
    assert.equal(m.g.deck, g.deck.length, "the deck as a count");
    assert.ok(!("hands" in m.g) && !Array.isArray(m.g.deck), "no hidden card ids: " + text.slice(0, 80));
    const v = XR.netGame(m.g);
    assert.ok(v, "the picture rebuilds");
    assert.equal(v.hands[1].length, g.hands[0].length);
    assert.ok(v.hands[1].every((c) => c === 0) && v.deck.every((c) => c === 0), "hidden cards are blanks");
    assert.equal(v.turn, 1 - g.turn, "the sides turned");
  }
});
test("xeri on two devices: a forged picture and a card not in the guest's hand are refused", () => {
  const g = xrMatch(5);
  const m = XR.netView(g, 1, null);
  const dup = clone(m.g); dup.hand[0] = dup.table[0];
  assert.equal(XR.netGame(dup), null, "a card twice");
  const more = clone(m.g); more.deck += 1;
  assert.equal(XR.netGame(more), null, "53 cards");
  const big = clone(m.g); big.opp = 7;
  assert.equal(XR.netGame(big), null);
  assert.equal(XR.netGame(null), null);
  // the guest plays: only a card it holds, in turn, on the current picture
  const h = clone(g);
  h.turn = 1;
  const card = h.hands[1][2];
  assert.equal(XR.netPlay(h, { t: "play", ns: 4, c: card }, 4), 2);
  assert.equal(XR.netPlay(h, { t: "play", ns: 3, c: card }, 4), -1, "a stale picture");
  assert.equal(XR.netPlay(h, { t: "play", ns: 4, c: h.hands[0][0] }, 4), -1, "the host's card");
  h.turn = 0;
  assert.equal(XR.netPlay(h, { t: "play", ns: 4, c: card }, 4), -1, "the host's turn");
});

// ---------- Battleship ----------
const BS = load("battleship/battleship.js",
  ["cmpStr", "coord", "shipCells", "inBounds", "occupancy", "around", "fleetProblem", "randomFleet", "fleetComplete",
   "seaView", "shotResult", "validShots", "fresh", "netFresh", "netValid", "netEnemyView", "netShotIn", "netResMsg",
   "netResIn", "netFleetCheck"],
  [["  var DATA_VER", "  // ---------- 1."]],
  "FLEET, shipCells, randomFleet, shotResult, netFresh, netValid, netEnemyView, netShotIn, netResMsg, netResIn, netFleetCheck",
  "function isInt(v) { return typeof v === \"number\" && isFinite(v) && Math.floor(v) === v; }\nvar prefs = { level: \"m\", noTouch: false };\n");

const bsRnd = (seed) => { let s = seed; return (n) => { s = (s * 1103515245 + 12345) % 2147483648; return s % n; }; };
// Two devices in memory: each its own fleet, messages passed by hand.
function bsPair(seed, nt) {
  const H = BS.netFresh(11, nt, true), G = BS.netFresh(11, nt, false);
  H.mine = BS.randomFleet(bsRnd(seed), nt);
  G.mine = BS.randomFleet(bsRnd(seed + 99), nt);
  [H, G].forEach((g) => { g.ready = g.peerReady = true; g.phase = "play"; g.sel = -1; g.turn = g.first; });
  return { H, G };
}
// One shot from a to b, as the game does it (netFire → netShot → netRes).
function bsShoot(a, b, q) {
  a.pend = q;
  const shot = { t: "shot", gid: a.gid, n: a.myShots.length, q };
  const s = BS.netShotIn(b, shot);
  assert.ok(s && !s.dup);
  const res = clone(BS.netResMsg(b, shot.n, q, s.r));
  b.aiShots.push(q);
  if (s.r.win) { b.phase = "done"; b.winner = "ai"; } else b.turn = "me";
  const r = BS.netResIn(a, res);
  assert.ok(r, "an honest answer is taken: " + J(res));
  a.pend = -1;
  a.myShots.push(q);
  a.myRes.push({ h: r.h, s: r.s });
  if (r.ship) a.theirs[r.s] = r.ship;
  if (r.win) { a.phase = "done"; a.winner = "me"; } else a.turn = "ai";
  return { res, r };
}

test("battleship on two devices: who fires first alternates with the game number", () => {
  assert.equal(BS.netFresh(11, false, true).first, "me");
  assert.equal(BS.netFresh(11, false, false).first, "ai");
  assert.equal(BS.netFresh(12, false, true).first, "ai");
  assert.equal(BS.netFresh(12, false, false).first, "me");
  assert.ok(BS.netValid(BS.netFresh(12, true, false)));
});

test("battleship on two devices: a whole game, the fleets stay hidden until the end", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { H, G } = bsPair(seed, seed % 2 === 0);
    const order = (s) => { const a = []; for (let q = 0; q < 100; q++) a.push(q); return a.sort((x, y) => ((x * 37 + s) % 101) - ((y * 37 + s) % 101)); };
    const qs = { H: order(seed), G: order(seed + 5) };
    let guard = 0;
    while (H.phase === "play" && G.phase === "play" && guard++ < 250) {
      const [a, b, k] = H.turn === "me" ? [H, G, "H"] : [G, H, "G"];
      const { res } = bsShoot(a, b, qs[k].shift());
      // an answer reveals at most the ship just sunk
      if (res.sunk < 0) assert.ok(!("ship" in res));
      // what a device knows of the other sea: never a ship that is not sunk
      [H, G].forEach((g) => g.theirs.forEach((s, i) => { if (s) assert.ok(g.myRes.some((x) => x.s === i)); }));
      assert.ok(BS.netValid(H) && BS.netValid(G));
    }
    assert.ok(H.phase === "done" && G.phase === "done", "the game ends on both devices");
    assert.notEqual(H.winner, G.winner);
    const w = H.winner === "me" ? H : G;
    assert.equal(BS.netEnemyView(w).afloat.length, 0, "the winner sank all five");
    assert.equal(BS.netEnemyView(w).sunk.length, 5);
    // at the end the fleets cross and every answer matches
    const fh = BS.netFleetCheck(H, clone(G.mine)), fg = BS.netFleetCheck(G, clone(H.mine));
    assert.ok(fh && fh.ok && fg && fg.ok);
  }
});

test("battleship on two devices: a shot is answered once, again the same, out of turn never", () => {
  const { H, G } = bsPair(3, false);
  assert.equal(H.first, "me");
  assert.equal(BS.netShotIn(H, { t: "shot", gid: 11, n: 0, q: 5 }), null, "the guest may not fire first");
  assert.equal(BS.netShotIn(G, { t: "shot", gid: 12, n: 0, q: 5 }), null, "another game");
  assert.equal(BS.netShotIn(G, { t: "shot", gid: 11, n: 0, q: 100 }), null, "off the sea");
  assert.equal(BS.netShotIn(G, { t: "shot", gid: 11, n: 1, q: 5 }), null, "a shot from the future");
  const first = bsShoot(H, G, 44).res;
  // the same shot again (it was lost on the way back): the same answer, nothing changes
  const again = BS.netShotIn(G, { t: "shot", gid: 11, n: 0, q: 44 });
  assert.ok(again.dup);
  assert.equal(J(BS.netResMsg(G, 0, 44, again.r)), J(first));
  assert.equal(G.aiShots.length, 1);
  assert.equal(BS.netShotIn(G, { t: "shot", gid: 11, n: 0, q: 45 }), null, "a different square under an old number");
});

test("battleship on two devices: answers that cannot be true are refused", () => {
  const { H, G } = bsPair(7, false);
  // aim at the guest's destroyer (2 squares) to have a real sink to forge around
  const d = BS.shipCells(G.mine[4], 2);
  H.pend = d[0];
  const base = { t: "res", gid: 11, n: 0, q: d[0] };
  assert.equal(BS.netResIn(H, Object.assign({}, base, { hit: false, sunk: 4, win: false })), null, "sunk by a miss");
  assert.equal(BS.netResIn(H, Object.assign({}, base, { hit: true, sunk: -1, win: true })), null, "a win with ships left");
  assert.equal(BS.netResIn(H, Object.assign({}, base, { hit: true, sunk: 4, win: false, ship: G.mine[4] })), null,
    "sunk after one hit of two");
  assert.equal(BS.netResIn(H, Object.assign({}, base, { q: d[1], hit: true, sunk: -1, win: false })), null, "not the square fired at");
  assert.equal(BS.netResIn(H, Object.assign({}, base, { hit: "yes", sunk: -1, win: false })), null);
  assert.ok(BS.netResIn(H, Object.assign({}, base, { hit: true, sunk: -1, win: false })), "the true answer");
  bsShoot(H, G, d[0]);
  bsShoot(G, H, 0);
  H.pend = d[1];
  const sink = { t: "res", gid: 11, n: 1, q: d[1], hit: true, sunk: 4, win: false };
  assert.equal(BS.netResIn(H, Object.assign({}, sink, { ship: { r: 9, c: 8, v: false } })), null, "a ship not where the hits are");
  assert.equal(BS.netResIn(H, Object.assign({}, sink, { ship: { r: -1, c: 0, v: true } })), null, "off the sea");
  assert.equal(BS.netResIn(H, Object.assign({}, sink, { ship: null })), null);
  const ok = BS.netResIn(H, Object.assign({}, sink, { ship: clone(G.mine[4]) }));
  assert.ok(ok && ok.s === 4 && J(ok.ship) === J(G.mine[4]));
});

test("battleship on two devices: a fleet that does not match the answers shows as such", () => {
  const { H, G } = bsPair(9, false);
  // the guest answers "miss" to a shot that hit
  const q = BS.shipCells(G.mine[0], 5)[2];
  H.pend = q;
  const lie = BS.netResIn(H, { t: "res", gid: 11, n: 0, q, hit: false, sunk: -1, win: false });
  assert.ok(lie, "a miss cannot be told from a lie while the game lasts");
  H.myShots.push(q); H.myRes.push({ h: false, s: -1 }); H.pend = -1;
  H.phase = "done"; H.winner = "ai";
  const f = BS.netFleetCheck(H, clone(G.mine));
  assert.ok(f && f.ok === false, "the fleet at the end tells");
  assert.equal(BS.netFleetCheck(H, G.mine.slice(0, 4)), null, "four ships is no fleet");
  assert.equal(BS.netFleetCheck(H, [null, null, null, null, null]), null);
  // ships that overlap: a fleet, but not a legal one
  const ov = clone(G.mine); ov[1] = clone(ov[0]); ov[1].c = Math.min(ov[1].c, 6);
  const fo = BS.netFleetCheck(H, ov);
  assert.ok(!fo || fo.ok === false);
});
