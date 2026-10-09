// Pure logic of Tetris: SRS rotation and wall kicks (I included), the
// 7-bag randomizer, gravity and lock delay, hold, line clears, scoring
// and levels, top-out, and the records merge.
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

const SRC = fs.readFileSync(path.join(__dirname, "..", "tetris/tetris.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

// cmpStr's cut also takes isInt and rand, the one-liners after it.
const T = (() => {
  const parts = [cut("  var DATA_VER", "  // ---------- 1.")];
  ["cmpStr", "buildShapes", "copyGame", "nextBag", "fillQueue", "fits", "spawnPiece", "takeNext",
   "freshGame", "touched", "tryMove", "tryRotate", "dropDist", "clearLines", "lineScore", "levelOf",
   "gravityRows", "lockPiece", "hardDrop", "holdPiece", "tick",
   "normCell", "normRow", "joinCell", "joinRows", "mergeTetris"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    parts.push(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function("crypto", parts.join("\n") +
    "\nreturn { COLS, ROWS, HIDE, SHAPES, KICKS, KICKS_I, LOCK_FRAMES, MAX_RESETS, fits, nextBag, fillQueue," +
    " spawnPiece, takeNext, freshGame, tryMove, tryRotate, dropDist, clearLines, lineScore, levelOf," +
    " gravityRows, lockPiece, hardDrop, holdPiece, tick, mergeTetris };")(webcrypto);
})();

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);
// seeded RNG (mulberry32) so failures replay
function seeded(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const { COLS, ROWS, HIDE } = T;
const I = 0, O = 1, Tp = 2, S = 3, Z = 4, Jp = 5, L = 6;
const empty = () => new Array(COLS * ROWS).fill(0);
// a game with piece t placed by hand
const G = (t, r, x, y, board, extra) => Object.assign({
  start: 1, board: board || empty(), t, r, x, y, hold: -1, held: false, queue: [0, 1, 2, 3, 4, 5, 6],
  score: 0, lines: 0, level: 1, b2b: false, fall: 0, lockF: 0, resets: 0, low: y, pieces: 0, over: false
}, extra || {});
const cellsOf = (g) => T.SHAPES[g.t][g.r].map(([r, c]) => [g.y + r, g.x + c]);
// fill rows (bottom first) leaving the listed columns open
function rowsFull(board, count, holes) {
  for (let k = 0; k < count; k++) {
    const r = ROWS - 1 - k;
    for (let c = 0; c < COLS; c++) if (!holes.includes(c)) board[r * COLS + c] = 8 - 1;
  }
  return board;
}

test("tetris: four rotations of each piece come back, 4 cells in the box", () => {
  T.SHAPES.forEach((rots, t) => {
    assert.equal(rots.length, 4);
    rots.forEach((cells) => {
      assert.equal(new Set(cells.map(J)).size, 4);
      const n = t === I ? 4 : (t === O ? 2 : 3);
      cells.forEach(([r, c]) => assert.ok(r >= 0 && r < n && c >= 0 && c < n));
    });
  });
  // SRS states of I: row 1, column 2, row 2, column 1
  assert.equal(J(T.SHAPES[I][1].map((x) => x[1])), J([2, 2, 2, 2]));
  assert.equal(J(T.SHAPES[I][2].map((x) => x[0])), J([2, 2, 2, 2]));
  assert.equal(J(T.SHAPES[I][3].map((x) => x[1])), J([1, 1, 1, 1]));
  // T state R points right
  assert.ok(T.SHAPES[Tp][1].some(([r, c]) => r === 1 && c === 2));
});

test("tetris: SRS kick tables mirror each other (from→to = −(to→from))", () => {
  for (const tab of [T.KICKS, T.KICKS_I]) {
    assert.equal(Object.keys(tab).length, 8);
    for (const k of Object.keys(tab)) {
      const back = tab[k[1] + k[0]];
      tab[k].forEach(([dx, dy], i) => { assert.equal(back[i][0], -dx || 0); assert.equal(back[i][1], -dy || 0); });
      assert.equal(J(tab[k][0]), J([0, 0]));
    }
  }
  // guideline values (y up in the guideline = −dy here)
  assert.equal(J(T.KICKS["01"]), J([[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]]));
  assert.equal(J(T.KICKS_I["01"]), J([[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]]));
  assert.equal(J(T.KICKS_I["12"]), J([[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]]));
});

test("tetris: rotation in open space and I kicks off both walls", () => {
  const g = T.spawnPiece(G(I, 0, 0, 0), I);
  assert.equal(J([g.x, g.y, g.r]), J([3, HIDE - 1, 0]));
  const r1 = T.tryRotate(g, 1);
  assert.equal(r1.r, 1); assert.equal(r1.kick, 0);
  assert.ok(cellsOf(r1).every(([, c]) => c === 5));
  // vertical I on the left wall (column 0) turning to state 2: kick 2 (+2, 0)
  const left = G(I, 1, -2, 10);
  assert.ok(T.fits(left.board, I, 1, -2, 10));
  const k1 = T.tryRotate(left, 1);
  assert.equal(J([k1.r, k1.x, k1.y, k1.kick]), J([2, 0, 10, 2]));
  // vertical I on the right wall (column 9) turning back to 0: kick 2 (−1, 0)
  const right = G(I, 1, 7, 10);
  const k2 = T.tryRotate(right, -1);
  assert.equal(J([k2.r, k2.x, k2.y, k2.kick]), J([0, 6, 10, 2]));
  assert.ok(cellsOf(k2).every(([r, c]) => r === 11 && c >= 6 && c <= 9));
  // O never moves when it turns
  const o = T.tryRotate(G(O, 0, 4, 5), 1);
  assert.equal(J([o.r, o.x, o.y]), J([0, 4, 5]));
});

test("tetris: T kicks into a slot (T-spin style) and a boxed-in piece cannot turn", () => {
  // T pointing up above a T-shaped slot at the bottom: rotation uses a downward kick
  const b = empty();
  // bottom row: all full except column 4; row above: full except 3,4,5
  for (let c = 0; c < COLS; c++) { if (c !== 4) b[(ROWS - 1) * COLS + c] = 1; if (c < 3 || c > 5) b[(ROWS - 2) * COLS + c] = 1; }
  b[(ROWS - 3) * COLS + 2] = 1;                          // overhang at the left of the slot
  // T in state R (pointing right) just above, x=3: cells (y..y+2, col 4) + (y+1, col 5)
  const g = G(Tp, 1, 3, ROWS - 5);
  assert.ok(T.fits(b, Tp, 1, 3, ROWS - 5));
  const g2 = Object.assign({}, g, { board: b });
  const r = T.tryRotate(g2, 1);                         // R → 2 (pointing down)
  assert.ok(r, "rotation succeeds");
  // every kick result is the FIRST fitting kick of the table
  const kicks = T.KICKS["12"];
  const first = kicks.findIndex(([dx, dy]) => T.fits(b, Tp, 2, 3 + dx, ROWS - 5 + dy));
  assert.equal(r.kick, first);
  // a piece walled in on all sides cannot rotate
  const box = empty().map(() => 1);
  const inner = G(Jp, 0, 3, 8, box);
  for (const [r0, c0] of T.SHAPES[Jp][0]) box[(8 + r0) * COLS + 3 + c0] = 0;
  assert.equal(T.tryRotate(Object.assign({}, inner, { board: box }), 1), null);
  assert.equal(T.tryRotate(Object.assign({}, inner, { board: box }), -1), null);
});

test("tetris: rotation always takes the first kick that fits (random boards)", () => {
  const R = seeded(7);
  for (let k = 0; k < 4000; k++) {
    const b = empty();
    for (let i = 0; i < b.length; i++) if (Math.floor(i / COLS) > 6 && R() < 0.35) b[i] = 1;
    const t = Math.floor(R() * 7), r = Math.floor(R() * 4), x = Math.floor(R() * 12) - 2, y = Math.floor(R() * 20);
    if (!T.fits(b, t, r, x, y)) continue;
    const g = G(t, r, x, y, b), dir = R() < 0.5 ? 1 : -1, before = J(g);
    const res = T.tryRotate(g, dir);
    assert.equal(J(g), before, "input untouched");
    if (t === O) { assert.equal(res.r, r); continue; }
    const to = (r + dir + 4) % 4, tab = (t === I ? T.KICKS_I : T.KICKS)["" + r + to];
    const i = tab.findIndex(([dx, dy]) => T.fits(b, t, to, x + dx, y + dy));
    if (i < 0) assert.equal(res, null);
    else assert.equal(J([res.r, res.x, res.y, res.kick]), J([to, x + tab[i][0], y + tab[i][1], i]));
  }
});

test("tetris: the 7-bag deals every piece once per bag", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const R = seeded(seed);
    let g = T.freshGame(1, R);
    const seq = [g.t];
    for (let i = 0; i < 699; i++) {
      assert.ok(g.queue.length >= 7, "queue holds at least 7");
      g = T.takeNext(g, R);
      seq.push(g.t);
    }
    for (let i = 0; i < seq.length; i += 7) assert.equal(J(seq.slice(i, i + 7).sort()), J([0, 1, 2, 3, 4, 5, 6]), "bag " + i);
    // never more than 12 pieces between two of a kind
    const last = {};
    seq.forEach((p, i) => { if (last[p] !== undefined) assert.ok(i - last[p] <= 13); last[p] = i; });
  }
  // every piece is equally likely in each bag position (loose chi-square)
  const R = seeded(99), counts = Array.from({ length: 7 }, () => new Array(7).fill(0));
  for (let k = 0; k < 14000; k++) T.nextBag(R).forEach((p, i) => counts[i][p]++);
  for (const row of counts) for (const n of row) assert.ok(Math.abs(n - 2000) < 200, "count " + n);
  // fillQueue only ever appends whole bags
  assert.equal(T.fillQueue([3, 4], R).length, 9);
  assert.equal(T.fillQueue([0, 1, 2, 3, 4, 5, 6], R).length, 7);
});

test("tetris: line clears, scoring table, back-to-back and levels", () => {
  assert.equal(J(T.lineScore(0, 3, true)), J({ pts: 0, b2b: true }));
  assert.equal(J(T.lineScore(1, 1, false)), J({ pts: 100, b2b: false }));
  assert.equal(J(T.lineScore(2, 2, false)), J({ pts: 600, b2b: false }));
  assert.equal(J(T.lineScore(3, 1, true)), J({ pts: 500, b2b: false }));
  assert.equal(J(T.lineScore(4, 1, false)), J({ pts: 800, b2b: true }));
  assert.equal(J(T.lineScore(4, 2, true)), J({ pts: 2400, b2b: true }));
  assert.equal(T.levelOf(1, 9), 1);
  assert.equal(T.levelOf(1, 10), 2);
  assert.equal(T.levelOf(5, 25), 7);
  assert.equal(T.levelOf(10, 9999), 30);
  // gravity speeds up with the level
  for (let l = 1; l < 20; l++) assert.ok(T.gravityRows(l + 1) > T.gravityRows(l));
  assert.ok(Math.abs(T.gravityRows(1) - 1 / 60) < 1e-9);

  // clearLines keeps the rows above in order
  const b = empty();
  b[(ROWS - 3) * COLS + 0] = 3;
  rowsFull(b, 2, []);
  const cl = T.clearLines(b);
  assert.equal(cl.n, 2);
  assert.equal(J(cl.rows), J([ROWS - 2, ROWS - 1]));
  assert.equal(cl.board[(ROWS - 1) * COLS + 0], 3);
  assert.equal(cl.board.filter(Boolean).length, 1);

  // a Tetris with an I in the well: 800 + hard drop 2 a row; again: back-to-back
  const R = seeded(5);
  const well = rowsFull(empty(), 8, [9]);
  let g = G(I, 1, 7, HIDE, well);                      // vertical I over column 9
  const d = T.dropDist(g);
  let res = T.hardDrop(g, R);
  assert.equal(res.ev.lines, 4);
  assert.equal(res.g.score, 800 + 2 * d);
  assert.equal(res.g.lines, 4);
  assert.ok(res.g.b2b);
  const s1 = res.g.score;
  g = Object.assign({}, res.g, { t: I, r: 1, x: 7, y: HIDE });
  const d2 = T.dropDist(g);
  res = T.hardDrop(g, R);
  assert.equal(res.ev.lines, 4);
  assert.equal(res.g.score - s1, 1200 + 2 * d2);
  // the 10th line raises the level and scores at the old one
  const ten = rowsFull(empty(), 1, [0]);
  g = G(I, 1, -2, HIDE, ten, { lines: 9, start: 1, level: 1 });
  res = T.hardDrop(g, R);
  assert.equal(J([res.ev.lines, res.g.lines, res.g.level, res.ev.levelUp]), J([1, 10, 2, true]));
  assert.equal(res.g.score, 100 + 2 * T.dropDist(g));
  // inputs untouched
  assert.equal(ten.filter(Boolean).length, 9);
});

test("tetris: gravity, soft drop and the lock delay with its reset limit", () => {
  const R = seeded(3);
  let g = G(Tp, 0, 3, HIDE);
  for (let i = 0; i < 59; i++) g = T.tick(g, false, R).g;
  assert.equal(g.y, HIDE);
  g = T.tick(g, false, R).g;
  assert.equal(g.y, HIDE + 1, "one row a second at level 1");
  // soft drop: 20 rows a second and a point a row
  let s = G(Tp, 0, 3, HIDE);
  for (let i = 0; i < 30; i++) s = T.tick(s, true, R).g;
  assert.equal(s.y - HIDE, 10);
  assert.equal(s.score, 10);
  // on the floor it locks after LOCK_FRAMES ticks
  const fl = G(Tp, 0, 3, ROWS - 2);
  assert.equal(T.dropDist(fl), 0);
  let f = fl, ev = null, n = 0;
  while (!ev) { const r = T.tick(f, false, R); f = r.g; ev = r.ev; n++; }
  assert.equal(n, T.LOCK_FRAMES);
  assert.equal(f.pieces, 1);
  assert.equal(f.board.filter(Boolean).length, 4);
  // moving on the ground resets the delay, but only MAX_RESETS times
  f = fl; n = 0; ev = null;
  let dir = 1;
  while (!ev && n < 5000) {
    const r = T.tick(f, false, R); f = r.g; ev = r.ev; n++;
    if (!ev && f.lockF === 10) { const m = T.tryMove(f, dir, 0) || T.tryMove(f, -dir, 0); dir = -dir; if (m) f = m; }
  }
  assert.ok(ev, "it locks in the end");
  assert.ok(n <= (T.MAX_RESETS + 1) * 10 + T.LOCK_FRAMES + 1, "ticks " + n);
  assert.ok(n > T.MAX_RESETS * 10, "resets were used: " + n);
});

test("tetris: hold swaps once per piece", () => {
  const R = seeded(11);
  let g = T.freshGame(1, R);
  const first = g.t, nextUp = g.queue[0];
  const h = T.holdPiece(g, R);
  assert.equal(h.hold, first);
  assert.equal(h.t, nextUp);
  assert.ok(h.held);
  assert.equal(T.holdPiece(h, R), null, "a second hold is refused");
  // after the piece locks, hold works again and swaps back
  const locked = T.hardDrop(h, R).g;
  assert.ok(!locked.held);
  const sw = T.holdPiece(locked, R);
  assert.equal(sw.t, first);
  assert.equal(sw.hold, locked.t);
  assert.equal(J([sw.r, sw.y]), J([0, first === I ? HIDE - 1 : HIDE]));
});

test("tetris: top out — a blocked spawn or a lock above the field ends the game", () => {
  const R = seeded(2);
  // a stack up to the spawn rows: the next piece cannot appear
  const b = empty();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (c !== 0 && c !== 9) b[r * COLS + c] = 2;   // no line can clear
  let g = G(I, 1, -2, 0, b);                           // a vertical I in column 0, about to land
  const res = T.hardDrop(g, R);
  assert.ok(res.ev.over && res.g.over, "block out");
  assert.equal(T.tryMove(res.g, 1, 0), null);
  assert.equal(T.tryRotate(res.g, 1), null);
  assert.equal(T.holdPiece(res.g, R), null);
  // a spawn that only fits higher up moves up instead of ending the game
  const b2 = empty();
  for (let c = 0; c < COLS; c++) b2[(HIDE + 1) * COLS + c] = c === 0 ? 0 : 1;
  const sp = T.spawnPiece(G(Tp, 0, 0, 0, b2), Tp);
  assert.ok(!sp.over);
  assert.equal(sp.y, HIDE - 1);
  // a piece that locks entirely in the hidden rows: lock out
  const b3 = empty();
  for (let r = HIDE; r < ROWS; r++) b3[r * COLS + 0] = 1;
  const lo = T.lockPiece(G(O, 0, -0, 0, b3, { x: 0, y: 0 }), R);
  assert.ok(lo.ev.over);
  // a fresh game is not over
  assert.ok(!T.freshGame(10, R).over);
  assert.equal(T.freshGame(10, R).level, 10);
});

test("tetris: random games never overlap and keep their counts", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const R = seeded(seed);
    let g = T.freshGame([1, 5, 10][seed % 3], R), cleared = 0, last = 0;
    for (let step = 0; step < 6000 && !g.over; step++) {
      const a = Math.floor(R() * 8);
      let n = null, ev = null;
      if (a === 0) n = T.tryMove(g, -1, 0);
      else if (a === 1) n = T.tryMove(g, 1, 0);
      else if (a === 2) n = T.tryRotate(g, 1);
      else if (a === 3) n = T.tryRotate(g, -1);
      else if (a === 4) n = T.holdPiece(g, R);
      else if (a === 5 && R() < 0.2) { const r = T.hardDrop(g, R); n = r.g; ev = r.ev; }
      else { const r = T.tick(g, a === 6, R); n = r.g; ev = r.ev; }
      if (n) g = n;
      if (ev) cleared += ev.lines;
      assert.ok(g.score >= last); last = g.score;
      if (!g.over) {
        assert.ok(T.fits(g.board, g.t, g.r, g.x, g.y), "piece overlaps (seed " + seed + ")");
        assert.equal(g.level, T.levelOf(g.start, g.lines));
      }
      for (let r = 0; r < ROWS; r++) {
        let full = true;
        for (let c = 0; c < COLS; c++) if (!g.board[r * COLS + c]) full = false;
        assert.ok(!full, "a full row stayed");
      }
    }
    assert.equal(g.lines, cleared);
  }
});

test("tetris: records merge is a join and a reset drops older rows", () => {
  const M = T.mergeTetris, keys = ["l1", "l5", "l10"];
  const st = () => {
    const rows = {};
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      keys.forEach((k) => { if (rnd(3) === 0) s[k] = { n: rnd(5) * 100, ts: rnd(3) * 1000, l: rnd(30), g: 1 + rnd(9) }; });
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
  const x = { rows: { d: { b: 0, s: { l5: { n: 2000, ts: 500, l: 12, g: 3 } } } } };
  const y = { rows: { d: { b: 0, s: { l5: { n: 2000, ts: 300, l: 9, g: 5 }, l1: { n: 100, ts: 1, l: 1, g: 1 } } } } };
  assert.equal(J(M(x, y).rows.d.s), J({ l1: { n: 100, ts: 1, l: 1, g: 1 }, l5: { n: 2000, ts: 300, l: 12, g: 5 } }));
  assert.equal(J(M(x, { br: 5, rows: {} }).rows), "{}");
  // a newer epoch replaces the row
  assert.equal(M(x, { rows: { d: { b: 9, s: { l1: { n: 1, ts: 1, l: 0, g: 1 } } } } }).rows.d.b, 9);
  for (const bad of [{ n: -1, ts: 1, l: 0, g: 1 }, { n: 1, ts: 1, l: 0, g: 0 }, { n: 1, ts: 1, g: 1 }, { n: 1.5, ts: 1, l: 0, g: 1 }]) {
    assert.equal(J(M({ rows: { d: { b: 0, s: { l1: bad } } } }, null).rows), "{}", J(bad));
  }
  assert.equal(J(M({ rows: { d: { b: 0, s: { l2: { n: 1, ts: 1, l: 0, g: 1 } } } } }, null).rows), "{}");
  assert.equal(J(M(null, undefined)), J({ ver: 1, br: 0, rows: {} }));
});
