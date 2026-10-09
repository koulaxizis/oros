// Pure logic of Hexagon Puzzle: the board, the cut into pieces (exact
// cover, connected, sizes 3–6), turning and moving pieces in axial
// coordinates, placement checks, the solved test, the hint, the
// keyboard cursor, stored-state checks and the records merge.
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
const { webcrypto } = require("crypto");

const SRC = fs.readFileSync(path.join(__dirname, "..", "hexagon/hexagon.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

// key, toPixel and minTime are one-liners, so they come in as blocks.
const F = (() => {
  const parts = [cut("  var DATA_VER", "  // ---------- 1."),
    cut("  function key(", "\n  function inBoard("),
    cut("  function toPixel(", "\n  // The hex under"),
    cut("  function minTime(", "\n  function joinRows(")];
  ["isInt", "cmpStr", "randInt", "inBoard", "boardCells", "rotate", "shapeOf", "placeCells", "grabAt",
   "connected", "groups", "partition", "occupancy", "canPlace", "isSolved", "isHome", "hintMove",
   "fromPixel", "stepCursor", "validPieces", "validState", "normCell", "normRow", "joinRows",
   "mergeHexagon"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    const line = SRC.indexOf("\n", i);
    const one = SRC.slice(i, line);
    if (/\}\s*$/.test(one) && one.split("{").length === one.split("}").length) { parts.push(one); return; }
    parts.push(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function("crypto", parts.join("\n") +
    "\nreturn { LEVELS, RADIUS, MIN_PIECE, MAX_PIECE, DIRS, randInt, key, inBoard, boardCells, rotate," +
    " shapeOf, placeCells, grabAt, connected, groups, partition, occupancy, canPlace, isSolved, isHome," +
    " hintMove, toPixel, fromPixel, stepCursor, validPieces, validState, mergeHexagon };")(webcrypto);
})();

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);
const sortKeys = (cells) => cells.map(F.key).sort().join(" ");

// A seeded RNG, so a failure can be replayed.
function seeded(seed) {
  let s = seed >>> 0;
  return (n) => { s = (s * 1664525 + 1013904223) >>> 0; return s % n; };
}

test("hexagon: board sizes are 19, 37 and 61 cells", () => {
  assert.deepEqual([2, 3, 4].map((R) => F.boardCells(R).length), [19, 37, 61]);
  assert.ok(F.inBoard(2, 2, -2) && !F.inBoard(2, 2, 1) && !F.inBoard(2, -3, 0));
});

test("hexagon: the cut covers the board exactly with connected pieces of 3–6 cells", () => {
  for (const R of [2, 3, 4]) {
    for (let s = 0; s < 150; s++) {
      const rng = s % 3 ? seeded(s * 7919 + R) : F.randInt;
      const pieces = F.partition(R, rng);
      const seen = new Set();
      for (const p of pieces) {
        assert.ok(p.length >= 3 && p.length <= 6, "size " + p.length);
        assert.ok(F.connected(p), "connected");
        for (const c of p) {
          assert.ok(F.inBoard(R, c[0], c[1]), "inside");
          assert.ok(!seen.has(F.key(c)), "no cell twice");
          seen.add(F.key(c));
        }
      }
      assert.equal(seen.size, F.boardCells(R).length, "every cell");
      assert.ok(F.validPieces(R, pieces));
    }
  }
});

test("hexagon: the cut is quick", () => {
  const t0 = Date.now();
  for (let i = 0; i < 100; i++) F.partition(4, F.randInt);
  assert.ok(Date.now() - t0 < 4000, "100 hard boards in " + (Date.now() - t0) + " ms");
});

test("hexagon: connected and groups", () => {
  assert.ok(F.connected([[0, 0], [1, 0], [1, 1]]));
  assert.ok(!F.connected([[0, 0], [2, 0]]));
  assert.ok(!F.connected([]));
  const left = {};
  [[0, 0], [1, 0], [3, 0], [3, 1]].forEach((c) => { left[F.key(c)] = c; });
  assert.deepEqual(F.groups(left).map((g) => g.length).sort(), [2, 2]);
});

test("hexagon: a turn of 60° keeps neighbours, six turns are a full circle", () => {
  for (let i = 0; i < 300; i++) {
    const c = [rnd(11) - 5, rnd(11) - 5];
    assert.deepEqual(F.rotate(c, 6), c);
    assert.deepEqual(F.rotate(F.rotate(c, 1), 5), c);
    assert.deepEqual(F.rotate(c, -1), F.rotate(c, 5));
    // distance to the origin is kept
    const d = (x) => (Math.abs(x[0]) + Math.abs(x[1]) + Math.abs(x[0] + x[1])) / 2;
    assert.equal(d(F.rotate(c, rnd(6))), d(c));
  }
  // the six directions go round in order (clockwise on screen, y down)
  for (let d = 0; d < 6; d++) assert.deepEqual(F.rotate(F.DIRS[d], 1), F.DIRS[(d + 1) % 6]);
  // a turned piece is still a piece: same size, connected
  const piece = [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]];
  for (let k = 0; k < 6; k++) {
    const cells = F.placeCells(piece, k, [0, 0]);
    assert.ok(F.connected(cells));
    assert.equal(new Set(cells.map(F.key)).size, piece.length);
  }
  // pixel turn: 60° on screen
  const p = F.toPixel(1, 0), q = F.toPixel(...F.rotate([1, 0], 1));
  const ang = Math.atan2(q[1], q[0]) - Math.atan2(p[1], p[0]);
  assert.ok(Math.abs(ang - Math.PI / 3) < 1e-9);
});

test("hexagon: moving a piece: placeCells and grabAt", () => {
  const piece = [[1, -1], [2, -1], [1, 0], [0, 1]];
  assert.equal(sortKeys(F.placeCells(piece, 0, [1, -1])), sortKeys(piece), "home place");
  const moved = F.placeCells(piece, 0, [3, 0]);
  moved.forEach((c, i) => assert.deepEqual([c[0] - piece[i][0], c[1] - piece[i][1]], [2, 1]), "translation");
  for (let rot = 0; rot < 6; rot++) {
    for (let g = 0; g < piece.length; g++) {
      const h = [rnd(5) - 2, rnd(5) - 2];
      const at = F.grabAt(piece, rot, g, h);
      assert.deepEqual(F.placeCells(piece, rot, at)[g], h, "the held cell lands under the pointer");
    }
  }
});

test("hexagon: pixel <-> hex round trip", () => {
  for (let q = -4; q <= 4; q++) {
    for (let r = -4; r <= 4; r++) {
      const p = F.toPixel(q, r);
      assert.deepEqual(F.fromPixel(p[0], p[1]), [q, r]);
      assert.deepEqual(F.fromPixel(p[0] + 0.6, p[1] - 0.4), [q, r], "inside the hex");
    }
  }
});

test("hexagon: placement validity, the solved test and the hint", () => {
  const R = 2, pieces = F.partition(R, seeded(42));
  let st = pieces.map(() => ({ rot: 0, at: null }));
  assert.ok(!F.isSolved(R, pieces, st));
  // home is always allowed on an empty board
  pieces.forEach((p, i) => assert.ok(F.canPlace(R, pieces, st, i, 0, p[0])));
  // outside: refused
  assert.ok(!F.canPlace(R, pieces, st, 0, 0, [5, 0]));
  st[0] = { rot: 0, at: pieces[0][0].slice() };
  assert.ok(F.isHome(pieces, st, 0) && !F.isHome(pieces, st, 1));
  // on another piece: refused (piece 1 with its first cell on a cell of piece 0)
  assert.ok(!F.canPlace(R, pieces, st, 1, 0, pieces[0][1]));
  // a piece may move onto its own old cells
  assert.ok(F.canPlace(R, pieces, st, 0, 0, pieces[0][0]));
  assert.ok(F.validState(R, pieces, st));
  // hints fill the board one piece at a time
  st = pieces.map(() => ({ rot: rnd(6), at: null }));
  let n = 0;
  while (!F.isSolved(R, pieces, st)) {
    const h = F.hintMove(pieces, st);
    assert.ok(h && F.validState(R, pieces, h.st));
    assert.ok(F.isHome(pieces, h.st, h.i));
    st = h.st;
    assert.ok(++n <= pieces.length);
  }
  assert.equal(F.hintMove(pieces, st), null);
  // the hint moves pieces in its way back to the tray
  const st2 = pieces.map(() => ({ rot: 0, at: null }));
  let tried = 0;
  for (let j = 1; j < pieces.length; j++) {
    for (let rot = 0; rot < 6; rot++) {
      for (const c of pieces[0]) {
        const at = F.grabAt(pieces[j], rot, 0, c);
        if (!F.canPlace(R, pieces, st2, j, rot, at)) continue;
        const s = st2.map((x) => ({ rot: x.rot, at: x.at }));
        s[j] = { rot, at };
        const h = F.hintMove(pieces, s);
        assert.equal(h.i, 0);
        assert.equal(h.st[j].at, null, "the blocker went back");
        assert.ok(F.validState(R, pieces, h.st));
        tried++;
      }
    }
  }
  assert.ok(tried > 0);
});

test("hexagon: any arrangement that fills the board wins, not only the cut", () => {
  const R = 2, pieces = F.partition(R, seeded(7));
  const st = pieces.map((p) => ({ rot: 0, at: p[0].slice() }));
  assert.ok(F.isSolved(R, pieces, st));
  // the whole board turned by 60°: every piece turned about the centre
  const st2 = pieces.map((p) => ({ rot: 1, at: F.rotate(p[0], 1) }));
  assert.ok(F.validState(R, pieces, st2));
  assert.ok(F.isSolved(R, pieces, st2), "a turned solution is a solution");
  st2[0] = { rot: 1, at: null };
  assert.ok(!F.isSolved(R, pieces, st2), "a piece in the tray: not solved");
});

test("hexagon: the keyboard cursor stays on the board", () => {
  for (const R of [2, 3, 4]) {
    let c = [0, 0], x = 0;
    for (let i = 0; i < 400; i++) {
      const s = F.stepCursor(R, c, x, "LRUD"[rnd(4)]);
      assert.ok(F.inBoard(R, s.c[0], s.c[1]));
      c = s.c; x = s.x;
    }
    // every cell can be reached
    const seen = new Set([F.key([0, 0])]), queue = [[[0, 0], 0]];
    while (queue.length) {
      const [cc, xx] = queue.shift();
      for (const d of "LRUD") {
        const s = F.stepCursor(R, cc, xx, d);
        if (!seen.has(F.key(s.c))) { seen.add(F.key(s.c)); queue.push([s.c, s.x]); }
      }
    }
    assert.equal(seen.size, F.boardCells(R).length);
  }
  assert.deepEqual(F.stepCursor(2, [2, 0], 0, "R").c, [2, 0], "edge: stays");
});

test("hexagon: stored puzzles and piece states are checked", () => {
  const R = 3, pieces = F.partition(R, seeded(3));
  assert.ok(F.validPieces(R, pieces));
  assert.ok(!F.validPieces(2, pieces), "wrong radius");
  assert.ok(!F.validPieces(R, pieces.slice(1)), "not full");
  const two = pieces.map((p) => p.slice()); two[0] = two[0].slice(0, 2);
  assert.ok(!F.validPieces(R, two), "too small");
  assert.ok(!F.validPieces(R, null) && !F.validPieces(R, []));
  const st = pieces.map(() => ({ rot: 0, at: null }));
  assert.ok(F.validState(R, pieces, st));
  assert.ok(!F.validState(R, pieces, st.slice(1)), "one state per piece");
  assert.ok(!F.validState(R, pieces, st.map((s, i) => i ? s : { rot: 6, at: null })), "turn 0–5");
  assert.ok(!F.validState(R, pieces, st.map((s, i) => i ? s : { rot: 0, at: [9, 9] })), "outside");
  const both = st.map((s, i) => i < 2 ? { rot: 0, at: pieces[0][0].slice() } : s);
  assert.ok(!F.validState(R, pieces, both), "two pieces on one cell");
});

test("hexagon: records merge is a join and a reset drops older rows", () => {
  const M = F.mergeHexagon, keys = ["e", "m", "h"];
  const st = () => {
    const rows = {};
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      keys.forEach((k) => {
        if (!rnd(2)) return;
        s[k] = { g: 1 + rnd(9), t: rnd(3) ? 1 + rnd(9e4) : 0 };
      });
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
  const x = { rows: { d: { b: 0, s: { m: { g: 4, t: 0 } } } } };
  const y = { rows: { d: { b: 0, s: { m: { g: 3, t: 40000 } } } } };
  assert.equal(J(M(x, y).rows.d.s.m), J({ g: 4, t: 40000 }));   // no time yet ≠ best time 0
  assert.equal(J(M({ rows: { d: { b: 9, s: { m: { g: 1, t: 5 } } } } }, y).rows.d), J({ b: 9, s: { m: { g: 1, t: 5 } } }), "newer epoch wins");
  assert.equal(J(M(x, { br: 5, rows: {} }).rows), "{}");
  for (const bad of [{ g: 0, t: 1 }, { g: 1, t: -1 }, { g: 1.5, t: 0 }, { g: 1 }, { g: 1, t: 4e8 }]) {
    assert.equal(J(M({ rows: { d: { b: 0, s: { e: bad } } } }, null).rows), "{}", J(bad));
  }
  assert.equal(J(M({ rows: { d: { b: 0, s: { x: { g: 1, t: 1 } } } } }, null).rows), "{}", "unknown level");
  assert.equal(J(M({ rows: { d: { b: -1, s: { e: { g: 1, t: 1 } } } } }, null).rows), "{}", "bad epoch");
});
