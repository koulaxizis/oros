// Pure logic of Chess: move generation (perft), check / mate /
// stalemate, the draw rules, SAN, the computer player and the records
// merge.
// Run: node --test tests/
//
// The app is a browser IIFE with no exports, so the pure functions are
// cut out of the source by name and evaluated on their own. A renamed
// function fails here loudly ("missing function …"). makeEngine is the
// same source the app hands to its Web Worker, so loading it alone also
// proves it needs nothing from the page.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "chess/chess.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

const C = (() => {
  const parts = [cut("  var DATA_VER", "  // ---------- 1.")];
  ["cmpStr", "isInt", "makeEngine", "makePgn", "makeChessCom", "makeLichess", "normRow", "joinRows", "mergeChess"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    parts.push(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function(parts.join("\n") + "\nreturn { E: makeEngine(), makeEngine, makePgn, makeChessCom, makeLichess, mergeChess };")();
})();
const E = C.E;
const PGN = C.makePgn(E);
const CC = C.makeChessCom(PGN.clean);
const LI = C.makeLichess(PGN, E);

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);
const KIWIPETE = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1";

// A seeded [0, 1) generator, so the tests that look at choices repeat.
function seeded(s) {
  return () => { s = (s * 1103515245 + 12345) >>> 0; return (s >>> 8) / 16777216; };
}

test("chess: perft from the start position (20, 400, 8902)", () => {
  const P = E.parseFen(E.START);
  assert.equal(E.perft(P, 1), 20);
  assert.equal(E.perft(P, 2), 400);
  assert.equal(E.perft(P, 3), 8902);
  assert.equal(E.toFen(P), E.START, "make / unmake leave the position as it was");
});

test("chess: perft from Kiwipete (48, 2039) and other known positions", () => {
  const K = E.parseFen(KIWIPETE);
  assert.equal(E.perft(K, 1), 48);
  assert.equal(E.perft(K, 2), 2039);
  assert.equal(E.perft(K, 3), 97862);
  assert.equal(E.toFen(K), KIWIPETE);
  // en passant pins, promotions with check, castling through check
  assert.equal(E.perft(E.parseFen("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1"), 4), 43238);
  assert.equal(E.perft(E.parseFen("r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1"), 3), 9467);
  assert.equal(E.perft(E.parseFen("rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8"), 3), 62379);
});

test("chess: checkmate and stalemate", () => {
  let r = E.replay(["f2f3", "e7e5", "g2g4", "d8h4"]);                     // fool's mate
  assert.deepEqual(E.status(r.pos), { over: true, result: "0-1", reason: "mate" });
  assert.equal(r.sans.join(" "), "f3 e5 g4 Qh4#");
  r = E.replay(["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"]);   // scholar's mate
  assert.deepEqual(E.status(r.pos), { over: true, result: "1-0", reason: "mate" });
  let P = E.parseFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
  assert.deepEqual(E.status(P), { over: true, result: "1/2", reason: "stalemate" });
  assert.equal(E.inCheck(P), false);
  P = E.parseFen("7k/8/8/8/8/8/8/5QK1 b - - 0 1");
  assert.equal(E.status(P).over, false);
  P = E.parseFen("k7/8/8/8/8/8/8/1q5K w - - 0 1");                          // check, one way out
  assert.ok(E.inCheck(P));
  assert.deepEqual(E.legalMoves(P).map(E.toUci).sort(), ["h1g2", "h1h2"]);
});

test("chess: draw rules (50 moves, threefold repetition, insufficient material)", () => {
  // 50-move rule: the 100th half-move without a capture or pawn move
  let P = E.parseFen("4k3/8/8/8/8/8/R7/4K3 w - - 99 80");
  assert.equal(E.status(P).over, false);
  E.makeMove(P, E.fromUci(P, "a2a3"));
  assert.deepEqual(E.status(P), { over: true, result: "1/2", reason: "fifty" });
  // a pawn move resets the count
  P = E.parseFen("4k3/8/8/8/8/8/P7/4K3 w - - 99 80");
  E.makeMove(P, E.fromUci(P, "a2a3"));
  assert.equal(P.h, 0);
  assert.equal(E.status(P).over, false);
  // threefold: the start position again after 4 and 8 half-moves
  const dance = ["g1f3", "g8f6", "f3g1", "f6g8"];
  assert.equal(E.status(E.replay(dance).pos).over, false);
  assert.equal(E.status(E.replay(dance.concat(dance.slice(0, 3))).pos).over, false);
  assert.deepEqual(E.status(E.replay(dance.concat(dance)).pos), { over: true, result: "1/2", reason: "rep" });
  // castling rights make a different position: the king walk does not repeat the start
  const walk = ["e2e4", "e7e5", "e1e2", "e8e7", "e2e1", "e7e8", "e1e2", "e8e7", "e2e1", "e7e8"];
  assert.equal(E.status(E.replay(walk).pos).over, false);
  // insufficient material
  const dead = (fen) => E.insufficient(E.parseFen(fen));
  assert.ok(dead("4k3/8/8/8/8/8/8/4K3 w - - 0 1"));                         // K v K
  assert.ok(dead("4k3/8/8/8/8/8/8/2B1K3 w - - 0 1"));                       // K+B v K
  assert.ok(dead("4k3/8/8/8/8/8/8/1N2K3 b - - 0 1"));                       // K+N v K
  assert.ok(dead("2b1k3/8/8/8/8/8/8/3BK3 w - - 0 1"));                      // bishops on the same colour
  assert.ok(!dead("3bk3/8/8/8/8/8/8/3BK3 w - - 0 1"));                      // opposite colours
  assert.ok(!dead("4k3/8/8/8/8/8/8/1NN1K3 w - - 0 1"));
  assert.ok(!dead("4k3/8/8/8/8/8/P7/4K3 w - - 0 1"));
  assert.ok(!dead("4k3/8/8/8/8/8/8/R3K3 w - - 0 1"));
  // the capture that leaves bare kings ends the game at once
  P = E.parseFen("4k3/8/8/8/8/8/3q4/4K3 w - - 0 1");
  E.makeMove(P, E.fromUci(P, "e1d2"));
  assert.deepEqual(E.status(P), { over: true, result: "1/2", reason: "material" });
});

test("chess: castling, en passant and promotion rules", () => {
  // castling: not out of, through or into check, not after the king moved
  let P = E.parseFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  let u = E.legalMoves(P).map(E.toUci);
  assert.ok(u.includes("e1g1") && u.includes("e1c1"));
  P = E.parseFen("r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1");                 // f2 rook: e1 in check? no, f1 attacked
  u = E.legalMoves(P).map(E.toUci);
  assert.ok(!u.includes("e1g1") && u.includes("e1c1"));
  P = E.parseFen("r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1");
  assert.ok(!E.legalMoves(P).map(E.toUci).includes("e1g1"));
  P = E.parseFen("4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1");
  E.makeMove(P, E.fromUci(P, "e1g1"));
  assert.equal(E.toFen(P), "4k3/8/8/8/8/8/8/R4RK1 b - - 1 1");
  // a rook capture removes the right on that side
  P = E.parseFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  E.makeMove(P, E.fromUci(P, "a1a8"));
  assert.equal(E.toFen(P).split(" ")[2], "Kk");
  // en passant: only right after the double step
  let r = E.replay(["e2e4", "a7a6", "e4e5", "d7d5"]);
  assert.equal(r.pos.ep, E.sqFrom("d6"));
  assert.ok(E.legalMoves(r.pos).map(E.toUci).includes("e5d6"));
  E.makeMove(r.pos, E.fromUci(r.pos, "e5d6"));
  assert.equal(r.pos.b[E.sqFrom("d5")], 0, "the passed pawn is taken");
  r = E.replay(["e2e4", "a7a6", "e4e5", "d7d5", "a2a3", "a6a5"]);
  assert.ok(!E.legalMoves(r.pos).map(E.toUci).includes("e5d6"), "too late");
  // promotion: four choices, the new piece on the board
  P = E.parseFen("8/4P3/8/8/8/8/k7/4K3 w - - 0 1");
  u = E.legalMoves(P).map(E.toUci).filter((x) => x.startsWith("e7e8")).sort();
  assert.deepEqual(u, ["e7e8b", "e7e8n", "e7e8q", "e7e8r"]);
  E.makeMove(P, E.fromUci(P, "e7e8n"));
  assert.equal(P.b[E.sqFrom("e8")], 2);
  assert.equal(E.fromUci(E.parseFen(E.START), "e2e5"), 0);
  assert.equal(E.replay(["e2e4", "e2e4"]), null);
});

test("chess: SAN with captures, checks, castling, disambiguation and promotion", () => {
  const sanOf = (fen, uci) => { const P = E.parseFen(fen); return E.san(P, E.fromUci(P, uci)); };
  assert.equal(E.replay(["e2e4", "d7d5", "e4d5", "d8d5", "b1c3", "d5a5", "g1f3", "c8g4", "f1e2", "b8c6", "e1g1", "e8c8"]).sans.join(" "),
    "e4 d5 exd5 Qxd5 Nc3 Qa5 Nf3 Bg4 Be2 Nc6 O-O O-O-O");
  assert.equal(sanOf("4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1", "b1d2"), "Nbd2");              // file tells
  assert.equal(sanOf("4k3/8/8/8/8/1N6/8/1N2K3 w - - 0 1", "b1d2"), "N1d2");             // rank tells
  assert.equal(sanOf("4k3/8/8/8/8/1N3N2/8/1N2K3 w - - 0 1", "b3d2"), "Nb3d2");          // both
  assert.equal(sanOf("4k3/8/8/8/8/8/8/R4RK1 w - - 0 1", "a1d1"), "Rad1");
  assert.equal(sanOf("4k3/8/8/R7/8/8/8/R3K3 w - - 0 1", "a1a3"), "R1a3");
  assert.equal(sanOf("4k3/8/8/8/8/8/8/R3KR2 w - - 0 1", "a1d1"), "Rd1");             // the other rook is blocked
  assert.equal(sanOf("3k4/4P3/8/8/8/8/8/4K3 w - - 0 1", "e7e8q"), "e8=Q+");
  assert.equal(sanOf("3k4/4P3/8/8/8/8/8/4K3 w - - 0 1", "e7e8n"), "e8=N");
  assert.equal(sanOf("3r1k2/4P3/8/8/8/8/8/4K3 w - - 0 1", "e7d8q"), "exd8=Q+");
  assert.equal(sanOf("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", "a1a8"), "Ra8#");
  const r = E.replay(["e2e4", "a7a6", "e4e5", "d7d5", "e5d6"]);
  assert.equal(r.sans[4], "exd6");
});

test("chess: the computer takes a mate in one at every level", () => {
  const cases = [
    ["6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1", "a1a8"],
    ["r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4", "h5f7"],
    ["r5k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1", "a8a1"]
  ];
  for (const lv of ["e", "m", "h"]) {
    for (const [fen, want] of cases) {
      for (let i = 0; i < 3; i++) {
        const P = E.parseFen(fen);
        const r = E.choose(P, lv, seeded(i * 7 + 1), 300);
        assert.equal(E.toUci(r.move), want, lv + " " + fen);
        assert.equal(E.toFen(P), fen, "the search leaves the position as it was");
      }
    }
  }
});

// After the computer's move: may the opponent win the queen? (taken by
// a cheaper piece, or taken where nothing protects it)
function queenHangs(fen, uci) {
  const P = E.parseFen(fen), side = P.t;
  E.makeMove(P, E.fromUci(P, uci));
  let q = -1;
  for (let s = 0; s < 120; s++) if (!(s & 0x88) && P.b[s] === 5 * side) q = s;
  if (q < 0) return true;                                // it was traded away or lost
  for (const m of E.legalMoves(P)) {
    if (E.mTo(m) !== q) continue;
    const by = Math.abs(P.b[E.mFrom(m)]);
    if (by < 5) return true;
    E.makeMove(P, m);
    const guarded = E.legalMoves(P).some((x) => E.mTo(x) === q);
    E.unmakeMove(P);
    if (!guarded) return true;
  }
  return false;
}

test("chess: Medium and Hard do not hang the queen", () => {
  const fens = [
    "rnbqkbnr/ppp1pppp/8/3p4/4Q3/8/PPPP1PPP/RNB1KBNR w KQkq - 0 3",      // attacked by a pawn
    "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5Q2/PPPP1PPP/RNB1KBNR w KQkq - 2 3",   // Qxf7+?? Kxf7
    "r5k1/1pp2ppp/p7/8/8/3Q4/PPP2PPP/6K1 w - - 0 1",                        // Qd8+?? Rxd8
    "rnb1kbnr/pppp1ppp/8/4p1q1/3P4/2N5/PPP1PPPP/R1BQKBNR b KQkq - 0 3"     // black queen hit by Bc1
  ];
  for (const lv of ["m", "h"]) {
    for (const fen of fens) {
      for (let i = 0; i < (lv === "h" ? 1 : 3); i++) {        // Medium picks among equals
        const P = E.parseFen(fen);
        const r = E.choose(P, lv, seeded(i * 13 + 5), 400);
        const uci = E.toUci(r.move);
        assert.ok(E.fromUci(E.parseFen(fen), uci), "legal " + uci);
        assert.ok(!queenHangs(fen, uci), lv + " hangs the queen with " + uci + " in " + fen);
      }
    }
  }
});

test("chess: Easy plays legal moves and sometimes worse ones on purpose", () => {
  const seen = new Set();
  const rng = seeded(42);
  for (let i = 0; i < 40; i++) {
    const P = E.parseFen(E.START);
    const r = E.choose(P, "e", rng, 200);
    assert.ok(E.fromUci(E.parseFen(E.START), E.toUci(r.move)));
    seen.add(E.toUci(r.move));
  }
  assert.ok(seen.size >= 4, "variety: " + [...seen].join(" "));
  // a whole quick game between two Easy players ends legally
  let moves = [], st = null;
  for (let ply = 0; ply < 400; ply++) {
    const r = E.replay(moves);
    st = E.status(r.pos);
    if (st.over) break;
    moves.push(E.toUci(E.choose(r.pos, "e", rng, 40).move));
  }
  assert.ok(moves.length > 0);
});

test("chess: Hard keeps to its time budget", () => {
  const P = E.parseFen(KIWIPETE);
  const t0 = Date.now();
  const r = E.choose(P, "h", Math.random, 500);
  const ms = Date.now() - t0;
  assert.ok(r.move && E.fromUci(E.parseFen(KIWIPETE), E.toUci(r.move)));
  assert.ok(ms < 1500, "took " + ms + " ms");
  assert.ok(r.depth >= 3, "depth " + r.depth);
});

test("chess: records merge is a join and a reset drops older rows", () => {
  const M = C.mergeChess, lvs = ["e", "m", "h"];
  const st = () => {
    const rows = {};
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      lvs.forEach((k) => { if (rnd(2)) s[k] = [rnd(5), rnd(5), rnd(5)]; });
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
  const x = { rows: { d: { b: 0, s: { m: [3, 1, 0] } } } };
  const y = { rows: { d: { b: 0, s: { m: [2, 2, 1], h: [0, 0, 4] } } } };
  assert.equal(J(M(x, y).rows.d.s), J({ m: [3, 2, 1], h: [0, 0, 4] }));
  assert.equal(J(M(x, { rows: { d: { b: 5, s: { e: [1, 0, 0] } } } }).rows.d), J({ b: 5, s: { e: [1, 0, 0] } }));   // newer epoch wins
  assert.equal(J(M(x, { br: 5, rows: {} }).rows), "{}");
  for (const bad of [[1, 2], [-1, 0, 0], [1.5, 0, 0], "3", null]) {
    assert.equal(J(M({ rows: { d: { b: 0, s: { m: bad } } } }, null).rows), "{}", J(bad));
  }
  assert.equal(J(M({ rows: { d: { b: -1, s: { m: [1, 0, 0] } } } }, null).rows), "{}");
  assert.equal(J(M(null, undefined)), J({ ver: 1, br: 0, rows: {} }));
});

// ---------- PGN ----------
const GAME = `[Event "Hoogovens \\"A\\""]
[Site "Wijk aan Zee NED"]
[Date "1999.01.20"]
[Round "4"]
[White "Kasparov, Garry"]
[Black "Topalov, Veselin"]
[Result "1-0"]
[WhiteElo "2812"]
[Annotator "someone"]

1. e4 d6 2. d4 Nf6 3. Nc3 g6 4. Be3 Bg7 5. Qd2 c6 6. f3 b5 7. Nge2 Nbd7 8. Bh6
Bxh6 9. Qxh6 Bb7 10. a3 e5 11. O-O-O Qe7 12. Kb1 a6 13. Nc1 O-O-O 14. Nb3 exd4
15. Rxd4 c5 16. Rd1 Nb6 17. g3 Kb8 18. Na5 Ba8 19. Bh3 d5 20. Qf4+ Ka7 21. Rhe1
d4 22. Nd5 Nbxd5 23. exd5 Qd6 24. Rxd4 cxd4 25. Re7+ Kb6 26. Qxd4+ Kxa5 27. b4+
Ka4 28. Qc3 Qxd5 29. Ra7 Bb7 30. Rxb7 Qc4 31. Qxf6 Kxa3 32. Qxa6+ Kxb4 33. c3+
Kxc3 34. Qa1+ Kd2 35. Qb2+ Kd1 36. Bf1 Rd2 37. Rd7 Rxd7 38. Bxc4 bxc4 39. Qxh8
Rd3 40. Qa8 c3 41. Qa4+ Ke1 42. f4 f5 43. Kc1 Rd2 44. Qa7 1-0
`;

test("pgn: a full game, its tags (known ones only) and its result", () => {
  const r = PGN.parse(GAME);
  assert.equal(r.games.length, 1);
  const g = r.games[0];
  assert.equal(g.moves.length, 87);
  assert.equal(g.result, "1-0");
  assert.equal(g.fen, "");
  assert.equal(g.stop, undefined);
  assert.equal(g.tags.Event, 'Hoogovens "A"');
  assert.equal(g.tags.White, "Kasparov, Garry");
  assert.equal(g.tags.WhiteElo, "2812");
  assert.equal(g.tags.Annotator, undefined, "tags outside the list are dropped");
  assert.equal(g.sans[20], "O-O-O");
  assert.equal(g.sans[86], "Qa7");
  assert.ok(E.replay(g.moves), "the moves replay");
});

test("pgn: comments, variations, NAGs, annotations and loose notation", () => {
  const r = PGN.parse(`; a line comment
1.e4 {a comment with (brackets) and 1-0 inside} e5 (1... c5 2. Nf3 (2. c3) d6) 2.Nf3 $1 Nc6!? 3. Bb5 a6
4. Ba4 Nf6 5. 0-0 Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 *`);
  assert.equal(r.games.length, 1);
  const g = r.games[0];
  assert.equal(g.moves.length, 20);
  assert.equal(g.result, "*");
  assert.equal(g.sans[8], "O-O");
  assert.equal(g.sans[17], "Nb8");
  assert.equal(g.sans[19], "Nbd7");
  // promotions without "=", "e.p." and over-specified moves
  const P = E.parseFen("4k3/1P6/8/3pP3/8/8/8/R3K2R w KQ d6 0 1");
  assert.equal(E.toUci(PGN.matchSan(P, "b8Q")), "b7b8q");
  assert.equal(E.toUci(PGN.matchSan(P, "b8=n")), "b7b8n");
  assert.equal(E.toUci(PGN.matchSan(P, "b8")), "b7b8q", "no piece named: a queen");
  assert.equal(E.toUci(PGN.matchSan(P, "exd6e.p.")), "e5d6");
  assert.equal(E.toUci(PGN.matchSan(P, "Ra1d1")), "a1d1");
  assert.equal(E.toUci(PGN.matchSan(P, "0-0")), "e1g1");
  assert.equal(PGN.matchSan(P, "Qd1"), 0, "no queen");
  assert.equal(PGN.matchSan(E.parseFen("4k3/8/8/8/8/8/4K3/R6R w - - 0 1"), "Rd1"), 0, "ambiguous: two rooks");
});

test("pgn: many games, a game from a position, an illegal move, other variants", () => {
  const r = PGN.parse(GAME + `
[Event "Two"]
1. d4 d5 2. Qd9 Nf6 *

[Event "Endgame"]
[SetUp "1"]
[FEN "8/P7/8/8/8/8/8/k6K b - - 3 60"]
60... Kb2 61. a8=Q *

[Variant "Chess960"]
[FEN "bqnb1rkr/pp3ppp/3ppn2/2p5/5P2/P2P4/NPP1P1PP/BQ1BNRKR w HFhf - 2 9"]
9. g3 *
`);
  assert.equal(r.games.length, 3, "the Chess960 game is left out");
  assert.deepEqual(r.games[1].moves, ["d2d4", "d7d5"]);
  assert.deepEqual(r.games[1].stop, { ply: 2, tok: "Qd9" });
  const e = r.games[2];
  assert.equal(e.fen, "8/P7/8/8/8/8/8/k6K b - - 3 60");
  assert.deepEqual(e.moves, ["a1b2", "a7a8q"]);
  assert.equal(PGN.parse("[FEN \"not a fen\"]\n1. e4 *").games.length, 0, "a bad FEN drops the game");
  assert.equal(PGN.parse("").games.length, 0);
  assert.equal(PGN.parse("hello world").games.length, 0);
  assert.equal(PGN.parse("x".repeat(PGN.MAX_TEXT + 1)).big, true);
});

test("pgn: write makes export PGN that reads back the same", () => {
  const g = PGN.parse(GAME).games[0];
  const out = PGN.write(g);
  assert.match(out, /^\[Event "Hoogovens \\"A\\""\]\n\[Site "Wijk aan Zee NED"\]\n\[Date "1999.01.20"\]\n\[Round "4"\]\n\[White "Kasparov, Garry"\]\n\[Black "Topalov, Veselin"\]\n\[Result "1-0"\]\n\[WhiteElo "2812"\]\n\n1\. e4 d6/);
  assert.ok(out.split("\n").every((l) => l.length <= 80));
  assert.match(out, /44\. Qa7 1-0\n$/);
  const back = PGN.parse(out).games[0];
  assert.deepEqual(back.moves, g.moves);
  assert.deepEqual(back.tags, g.tags);
  // from a position with black to move: SetUp / FEN and "60..."
  const e = PGN.write({ fen: "8/P7/8/8/8/8/8/k6K b - - 3 60", moves: ["a1b2", "a7a8q"], result: "*" });
  assert.match(e, /\[SetUp "1"\]\n\[FEN "8\/P7\/8\/8\/8\/8\/8\/k6K b - - 3 60"\]/);
  assert.match(e, /\n60\.\.\. Kb2 61\. a8=Q\+? \*\n$/);
  assert.match(PGN.write({ moves: [] }), /\[Result "\*"\]\n\n\*\n$/);
});

test("pgn: tag values can never break out of their tag or carry control characters", () => {
  const out = PGN.write({ tags: { White: 'A"] [Evil "x\n1. e4', Black: "B\\" }, moves: ["e2e4"], result: "1-0" });
  assert.match(out, /\[White "A\\"\] \[Evil \\"x 1\. e4"\]/);
  assert.match(out, /\[Black "B\\\\"\]/);
  assert.equal(PGN.parse(out).games[0].tags.White, 'A"] [Evil "x 1. e4');
  assert.equal(PGN.clean("a\u0000b c\td"), "a b c d");
  assert.equal(PGN.clean("x".repeat(500)).length, 120);
  const r = PGN.parse('[White "<img src=x onerror=alert(1)>"]\n1. e4 *');
  assert.equal(r.games[0].tags.White, "<img src=x onerror=alert(1)>", "kept as text; the app shows it with textContent");
});

// ---------- Chess.com published data ----------
test("chess.com: usernames and the only URLs orOS builds", () => {
  assert.equal(CC.okUser(" Hikaru "), "Hikaru");
  assert.equal(CC.okUser("a_b-c9"), "a_b-c9");
  ["", "ab", "x".repeat(26), "a/b", "a b", "../x", "é123", null, 5].forEach((u) => assert.equal(CC.okUser(u), "", String(u)));
  assert.equal(CC.playerUrl("Hikaru"), "https://api.chess.com/pub/player/hikaru");
  assert.equal(CC.playerUrl("Hikaru", "/stats"), "https://api.chess.com/pub/player/hikaru/stats");
  assert.equal(CC.monthUrl("Hikaru", "2024/05"), "https://api.chess.com/pub/player/hikaru/games/2024/05");
  assert.equal(CC.monthUrl("Hikaru", "https://evil.example/2024/05"), "");
  assert.equal(CC.monthUrl("Hikaru", "2024/5"), "");
});

test("chess.com: profile, stats, months", () => {
  assert.deepEqual(CC.profile({ username: "hikaru", name: "Hikaru\nNakamura", title: "GM", avatar: "x" }),
    { user: "hikaru", name: "Hikaru Nakamura", title: "GM" });
  assert.equal(CC.profile(null), null);
  const st = CC.stats({
    chess_rapid: { last: { rating: 2800 }, best: { rating: 2900 }, record: { win: 5, loss: 2, draw: 1 } },
    chess_blitz: { last: { rating: "3000" } },                        // not a number: left out
    chess_daily: { last: { rating: 2100.4 }, record: {} },
    chess960_daily: { last: { rating: 1 } },                          // other variants: left out
    tactics: { highest: { rating: 3100 } }
  });
  assert.deepEqual(st, [
    { kind: "rapid", last: 2800, best: 2900, w: 5, l: 2, d: 1 },
    { kind: "daily", last: 2100, best: null, w: 0, l: 0, d: 0 },
    { kind: "puzzles", last: null, best: 3100, w: 0, l: 0, d: 0 }
  ]);
  assert.deepEqual(CC.stats("x"), []);
  assert.deepEqual(CC.months({ archives: [
    "https://api.chess.com/pub/player/h/games/2023/12",
    "https://api.chess.com/pub/player/h/games/2024/02",
    "https://api.chess.com/pub/player/h/games/2024/02",
    "https://api.chess.com/pub/player/h/games/2024/13",
    "javascript:alert(1)", 7
  ] }), ["2024/02", "2023/12"]);
  assert.deepEqual(CC.months({}), []);
});

test("chess.com: a month's games (standard only, newest first) open as PGN", () => {
  const pgn = '[White "a"]\n[Black "b"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
  const gs = CC.games({ games: [
    { rules: "chess", pgn, end_time: 100, time_class: "blitz", white: { username: "a", rating: 1200 }, black: { username: "b<i>", rating: 1300 } },
    { rules: "chess", pgn: pgn.replace("0-1\"", "1/2-1/2\""), end_time: 300, time_class: "odd", white: {}, black: {} },
    { rules: "chess960", pgn, end_time: 200 },
    { rules: "chess", end_time: 400 },
    null
  ] });
  assert.equal(gs.length, 2);
  assert.equal(gs[0].end, 300);
  assert.equal(gs[0].kind, "");
  assert.equal(gs[0].white, "?");
  assert.deepEqual([gs[1].white, gs[1].black, gs[1].wr, gs[1].br, gs[1].result, gs[1].kind], ["a", "b<i>", 1200, 1300, "0-1", "blitz"]);
  const g = PGN.parse(gs[1].pgn).games[0];
  assert.deepEqual(g.moves, ["f2f3", "e7e5", "g2g4", "d8h4"]);
  const pz = CC.puzzle({ title: "Find it", pgn: '[FEN "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1"]\n[SetUp "1"]\n\n1. Rd8# *' });
  assert.equal(pz.title, "Find it");
  assert.deepEqual(PGN.parse(pz.pgn).games[0].moves, ["d1d8"]);
  assert.equal(CC.puzzle({ title: "x" }), null);
});

test("lichess: the sign-in URL (PKCE S256, no scope) and usernames", () => {
  const u = new URL(LI.authorizeUrl({ state: "st&x", challenge: "ch", redirect: "https://useoros.online/chess/lichess-callback.html" }));
  assert.equal(u.origin + u.pathname, "https://lichess.org/oauth");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("client_id"), "useoros.online");
  assert.equal(u.searchParams.get("redirect_uri"), "https://useoros.online/chess/lichess-callback.html");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("code_challenge"), "ch");
  assert.equal(u.searchParams.get("scope"), "");
  assert.equal(u.searchParams.get("state"), "st&x");
  assert.equal(LI.okUser(" DrNykterstein "), "DrNykterstein");
  ["", "a", "x".repeat(31), "a b", "a/../b", "<b>", 7, null].forEach((v) => assert.equal(LI.okUser(v), "", J(v)));
  assert.equal(LI.gamesPath("Some_One", 500),
    "/api/games/user/Some_One?max=100&opening=true&clocks=false&evals=false&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence");
  assert.equal(LI.gamesPath("../x", 5).indexOf(".."), -1, "a bad name never reaches the path");
});

test("lichess: account ratings, tokens and imported-game links", () => {
  const a = LI.account({ username: "Tester_1", title: "FM\u0000<script>", perfs: {
    blitz: { games: 120, rating: 1712.4, prov: false }, bullet: { games: 0, rating: 1500, prov: true },
    rapid: { games: 3, rating: 1490, prov: true }, puzzle: { games: 40, rating: 2001 }, chess960: { games: 9, rating: 1600 },
    classical: { rating: "x", games: 4 } } });
  assert.equal(a.user, "Tester_1");
  assert.ok(!/[\u0000-\u001f]/.test(a.title) && a.title.length <= 4);
  assert.deepEqual(a.perfs, [
    { kind: "blitz", rating: 1712, games: 120, prov: false },
    { kind: "rapid", rating: 1490, games: 3, prov: true },
    { kind: "puzzle", rating: 2001, games: 40, prov: false }]);
  assert.equal(LI.account({ username: "bad name" }), null);
  assert.equal(LI.account(null), null);
  assert.deepEqual(LI.tokenOf({ access_token: "lio_abcDEF123456", expires_in: 100 }, 1000), { token: "lio_abcDEF123456", exp: 101000 });
  assert.deepEqual(LI.tokenOf({ access_token: "lio_abcDEF123456" }, 1000), { token: "lio_abcDEF123456", exp: 0 });
  assert.equal(LI.tokenOf({ access_token: "a b\nc" }, 0), null);
  assert.equal(LI.tokenOf({}, 0), null);
  assert.equal(LI.importUrl({ id: "AbCd1234", url: "https://evil.example/" }), "https://lichess.org/AbCd1234");
  ["", "short", "AbCd1234/../x", "AbCd12345", null].forEach((id) => assert.equal(LI.importUrl({ id }), "", J(id)));
});

test("lichess: the daily puzzle opens at its start, with the solution after it", () => {
  const g = LI.puzzleGame({
    game: { pgn: "e4 e5 Bc4 Nc6 Qh5 Nf6", id: "x" },
    puzzle: { id: "K69di", rating: 1500, initialPly: 5, solution: ["h5f7"], themes: ["mateIn1", "short"] }
  });
  assert.equal(g.at, 6);
  assert.deepEqual(g.moves, ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"]);
  assert.equal(E.status(E.replay(g.moves, "").pos).reason, "mate");
  assert.equal(g.tags.Event, "Lichess · #K69di");
  assert.equal(g.rating, 1500);
  assert.deepEqual(g.themes, ["mateIn1", "short"]);
  // initialPly past the moves: the puzzle starts after the last one
  const g2 = LI.puzzleGame({ game: { pgn: "e4 e5 Bc4 Nc6 Qh5 Nf6" }, puzzle: { initialPly: 40, solution: ["h5f7", "zzzz"] } });
  assert.equal(g2.at, 6);
  assert.equal(g2.moves.length, 7, "the solution stops at its first bad move");
  // an earlier initialPly cuts the game there
  const g3 = LI.puzzleGame({ game: { pgn: "e4 e5 Bc4 Nc6 Qh5 Nf6" }, puzzle: { initialPly: 1, solution: ["g1f3"] } });
  assert.deepEqual(g3.moves, ["e2e4", "e7e5", "g1f3"]);
  assert.equal(g3.at, 2);
  assert.equal(LI.puzzleGame({ game: { pgn: "e4 e5" }, puzzle: { initialPly: 1, solution: ["e1e8"] } }), null, "no legal solution move");
  assert.equal(LI.puzzleGame({ game: { pgn: 5 }, puzzle: { solution: [] } }), null);
  assert.equal(LI.puzzleGame(null), null);
});
