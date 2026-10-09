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
  ["cmpStr", "isInt", "makeEngine", "normRow", "joinRows", "mergeChess"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    parts.push(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function(parts.join("\n") + "\nreturn { E: makeEngine(), makeEngine, mergeChess };")();
})();
const E = C.E;

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
