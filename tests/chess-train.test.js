// Chess training (chess/train.js): puzzle packs in the Lichess layout,
// the puzzle history merge (a join), the Glicko-1 rating, picking,
// opening names by position, and the data files that ship with it.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const T = require("../chess/train.js");
const SRC = fs.readFileSync(path.join(__dirname, "..", "chess/chess.js"), "utf8");
const E = (() => {
  const i = SRC.indexOf("  function makeEngine(");
  return new Function(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4) + "\nreturn makeEngine();")();
})();
function loadData(file, name) {
  const win = {};
  new Function("window", "self", fs.readFileSync(path.join(__dirname, "..", "chess", file), "utf8"))(win, win);
  return win[name];
}
const J = JSON.stringify;

test("chess train: a pack line in the Lichess layout and in the short form", () => {
  const full = "00sHx,q3k1nr/1pp1nQpp/3p4/1P2p3/4P3/B1PP1b2/B5PP/5K2 b k - 0 17,e8d7 a2e6 d7d8 f7f8,1760,80,83,72,mate mateIn2 middlegame short,https://lichess.org/yyznGmXs/black#34,Italian_Game";
  const p = T.parseLine(full);
  assert.equal(p.id, "00sHx");
  assert.deepEqual(p.moves, ["e8d7", "a2e6", "d7d8", "f7f8"]);
  assert.equal(p.r, 1760);
  assert.equal(p.rd, 80);
  assert.deepEqual(p.th, ["mate", "mateIn2", "middlegame", "short"]);
  const s = T.parseLine("or0001,6k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 0 1,g8f8 d1d8,900,mate mateIn1 backRankMate");
  assert.equal(s.r, 900);
  assert.equal(s.rd, 90, "the short form gets a default deviation");
  // bad lines are skipped, header too, ids unique
  const pk = T.parsePack(["PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags",
    full, full, "bad id!,x,e2e4 e7e5,1000,", "zz1,8/8/8/8/8/8/8/8 w - - 0 1,e2e4,1000,x", "zz2,8/8 w - - 0 1,e2e4 e7e5,abc,"].join("\n"));
  assert.equal(pk.length, 1);
  assert.ok(T.checkPuzzle(E, p), "every move legal");
  assert.equal(T.checkPuzzle(E, p).side, "w", "you answer for white");
  assert.equal(T.checkPuzzle(E, Object.assign({}, p, { moves: ["e8d7", "a2a1"] })), null, "an illegal move drops the puzzle");
});

test("chess train: the last move of a puzzle may be another mate", () => {
  // white mates on the back rank: Rd8# (also Re8# is listed? no: only one rook) -> two rooks give two mates
  const p = { fen: "6k1/5ppp/8/8/8/8/5PPP/R2R2K1 b - - 0 1", moves: ["g8h8", "d1d8"] };
  const P = E.parseFen(p.fen);
  E.makeMove(P, E.fromUci(P, "g8h8"));
  assert.ok(T.rightMove(E, P, p, 1, "d1d8"));
  assert.ok(T.rightMove(E, P, p, 1, "a1a8"), "another mate in one is right too");
  assert.ok(!T.rightMove(E, P, p, 1, "d1d7"));
  const q = { moves: ["g8h8", "d1d7", "h8g8", "d7d8"] };
  assert.ok(!T.rightMove(E, P, q, 1, "a1a8"), "a move before the last must be the line's");
});

test("chess train: the history merge is a join (symmetric, associative, idempotent)", () => {
  const M = T.mergeHistory;
  const a = { p1: [100, 1, 100], p2: [200, 0, 0] };
  const b = { p2: [150, 1, 150], p3: [300, 0, 0] };
  const c = { p2: [200, 0, 900], p3: [300, 0, 400], bad: "x", "no way!": [1, 1, 1] };
  assert.equal(J(M(a, b)), J(M(b, a)));
  assert.equal(J(M(M(a, b), c)), J(M(a, M(b, c))));
  assert.equal(J(M(a, a)), J(M(a, null)));
  const m = M(M(a, b), c);
  assert.deepEqual(m.p2, [150, 1, 900], "the earliest first try wins, the latest solve is kept");
  assert.deepEqual(m.p3, [300, 0, 400]);
  assert.ok(!("bad" in m) && !("no way!" in m));
  assert.equal(J(M(a, b, 160)), J({ p2: [200, 0, 0], p3: [300, 0, 0] }), "the reset stamp drops older first tries");
  const before = J(a);
  M(a, b);
  assert.equal(J(a), before, "inputs untouched");
  // record: first try sets, a later solve only marks it
  let h = T.record({}, "x1", false, 10);
  assert.deepEqual(h.x1, [10, 0, 0]);
  h = T.record(h, "x1", true, 20);
  assert.deepEqual(h.x1, [10, 0, 20]);
  h = T.record(h, "x1", false, 30);
  assert.deepEqual(h.x1, [10, 0, 20]);
});

test("chess train: Glicko rating goes up on a win, down on a loss, and is the same in any merge order", () => {
  const byId = { a: { r: 1500, rd: 80 }, b: { r: 1800, rd: 80 }, c: { r: 1200, rd: 80 } };
  const won = T.rating({ a: [1, 1, 1] }, byId), lost = T.rating({ a: [1, 0, 0] }, byId);
  assert.ok(won.r > 1500 && lost.r < 1500);
  assert.ok(won.rd < 350);
  const upset = T.rating({ b: [1, 1, 1] }, byId).r - 1500, easy = T.rating({ c: [1, 1, 1] }, byId).r - 1500;
  assert.ok(upset > easy, "beating a harder puzzle gains more");
  const h1 = T.mergeHistory({ a: [1, 1, 1] }, { b: [2, 0, 0], c: [3, 1, 3] });
  const h2 = T.mergeHistory({ c: [3, 1, 3], b: [2, 0, 0] }, { a: [1, 1, 1] });
  assert.equal(J(T.rating(h1, byId)), J(T.rating(h2, byId)));
  assert.equal(T.rating({ gone: [1, 1, 1] }, byId).n, 0, "a puzzle no pack has does not count");
});

test("chess train: picking unseen puzzles near the rating, by theme; retry list", () => {
  const list = [];
  for (let i = 0; i < 40; i++) list.push({ id: "p" + i, r: 800 + i * 50, rd: 80, th: i % 2 ? ["fork"] : ["mateIn1"] });
  let s = 7;
  const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return (s >>> 8) / 16777216; };
  for (let k = 0; k < 20; k++) {
    const p = T.pick(list, {}, { theme: "fork", r: 1500, rnd });
    assert.ok(p.th.includes("fork"));
    assert.ok(Math.abs(p.r - 1500) <= 450, "near the rating: " + p.r);
  }
  const all = {};
  list.forEach((p) => { if (p.id !== "p3") all[p.id] = [1, 1, 1]; });
  assert.equal(T.pick(list, all, { theme: "fork", r: 1500, rnd }).id, "p3", "unseen first");
  assert.equal(T.pick(list, {}, { theme: "nothing", rnd }), null);
  const h = { p1: [5, 0, 0], p2: [3, 0, 0], p3: [1, 0, 9], p4: [2, 1, 2] };
  assert.deepEqual(T.toRetry(list, h).map((p) => p.id), ["p2", "p1"]);
});

test("chess train: the shipped puzzle pack loads, every puzzle legal, themes counted", () => {
  const packs = loadData("puzzles-pack.js", "OrosChessPacks");
  assert.ok(Array.isArray(packs) && packs.length >= 1);
  const list = T.parsePack(packs[0].csv);
  assert.ok(list.length >= 100, "a usable pack: " + list.length);
  list.forEach((p) => {
    assert.ok(T.checkPuzzle(E, p), "legal: " + p.id);
    assert.equal(p.moves.length % 2, 0, "opponent move + an answer, ends with yours: " + p.id);
    // a mate theme ends in mate
    if (p.th.includes("mate")) {
      const P = E.parseFen(p.fen);
      p.moves.forEach((u) => E.makeMove(P, E.fromUci(P, u)));
      assert.ok(E.inCheck(P) && E.legalMoves(P).length === 0, "mate: " + p.id);
    }
  });
  const th = T.themeCounts(list).map((x) => x.theme);
  ["mateIn1", "mateIn2", "fork"].forEach((k) => assert.ok(th.includes(k), k));
});

test("chess train: opening names from the Lichess table, also by transposition", () => {
  const list = T.parseOpenings(loadData("openings-data.js", "OrosChessOpenings"));
  assert.ok(list && list.length > 3000);
  const ix = T.indexOpenings(E, list);
  const name = (ucis) => { const o = T.nameOf(E, list, ix, ucis.split(" ")); return o && o.eco + " " + o.name; };
  assert.equal(name("e2e4 c7c5"), "B20 Sicilian Defense");
  assert.match(name("e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6"), /^B90 Sicilian Defense: Najdorf Variation/);
  assert.equal(name("e2e4 e7e5 g1f3 b8c6 f1b5"), "C60 Ruy Lopez");
  // Queen's Gambit Declined by a different move order
  assert.equal(name("c2c4 e7e6 d2d4 d7d5"), name("d2d4 d7d5 c2c4 e7e6"));
  // after the book: the last named position
  assert.equal(name("e2e4 c7c5 a2a3 a7a6 h2h3 h7h6 b2b3"), name("e2e4 c7c5 a2a3"));
  assert.equal(T.nameOf(E, list, ix, []), null);
  // every line replays legally and the families list covers all
  assert.equal(T.families(list).reduce((n, f) => n + f.lines.length, 0), list.length);
  assert.equal(T.parseOpenings("A|B\nZ99|0|||e2e4"), null, "bad rows refuse the table");
  assert.equal(T.defaultSide({ family: "Sicilian Defense" }), "b");
  assert.equal(T.defaultSide({ family: "Ruy Lopez" }), "w");
});

test("chess train: chess.js merges the puzzle history into the synced slice", () => {
  globalThis.OrosChessTrain = T;
  const parts = [SRC.slice(SRC.indexOf("  var DATA_VER"), SRC.indexOf("  // ---------- 1."))];
  ["cmpStr", "isInt", "normRow", "joinRows", "mergeChess"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    parts.push(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  const M = new Function(parts.join("\n") + "\nreturn mergeChess;")();
  assert.equal(J(M(null, null)), J({ ver: 1, br: 0, rows: {} }), "no puzzles: the old shape");
  const a = { rows: {}, pz: { x1: [10, 0, 0] } }, b = { rows: {}, pz: { x1: [5, 1, 5], y2: [7, 0, 0] }, pbr: 6 };
  assert.equal(J(M(a, b)), J(M(b, a)));
  assert.equal(J(M(a, b)), J({ ver: 1, br: 0, rows: {}, pbr: 6, pz: { x1: [10, 0, 0], y2: [7, 0, 0] } }));
  assert.equal(J(M(M(a, b), b)), J(M(a, b)));
});
