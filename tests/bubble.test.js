// Pure logic of Bubble Shooter: the hex grid, snapping a shot to a
// cell, the wall bounce, clusters, floating bubbles, scoring and the
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

const SRC = fs.readFileSync(path.join(__dirname, "..", "bubble/bubble.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

const B = (() => {
  const parts = [cut("  var COLS = 11;", "  // ---------- 1."),
    "var DATA_VER = 1;",
    "function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }",
    "function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }"];
  ["rowLen", "cellXY", "emptyGrid", "neighbors", "snapCell", "trace", "cluster", "floating", "colorsOn",
   "countBubbles", "lowestRow", "pickColor", "startGrid", "points", "settle",
   "normCell", "normRow", "joinCell", "joinRows", "mergeBubble"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    parts.push(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function(parts.join("\n") +
    "\nreturn { COLS, W, ROW_H, LOSE, ROWS, SHOOT_Y, HIT, LEVEL, rowLen, cellXY, emptyGrid, neighbors, snapCell," +
    " trace, cluster, floating, colorsOn, countBubbles, lowestRow, startGrid, points, settle, mergeBubble };")();
})();

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
// A grid from strings: one row per string, "." empty, digits colours;
// odd rows have one cell less.
function G(rows) {
  const g = B.emptyGrid();
  rows.forEach((s, r) => [...s].forEach((ch, c) => { if (ch !== ".") g[r][c] = +ch; }));
  return g;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const sortCells = (l) => l.map((p) => p.slice(0, 2)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);

test("bubble: the hex grid packs bubbles that just touch", () => {
  assert.equal(B.W, 22);
  assert.equal(B.rowLen(0), 11);
  assert.equal(B.rowLen(1), 10);
  // every neighbour is exactly two radii away, and neighbourhood is mutual
  for (let r = 0; r < B.ROWS; r++) {
    for (let c = 0; c < B.rowLen(r); c++) {
      const nb = B.neighbors(r, c), p = B.cellXY(r, c, 0);
      assert.ok(nb.length >= 2 && nb.length <= 6);
      assert.ok(p[0] >= 1 && p[0] <= B.W - 1);
      for (const [r2, c2] of nb) {
        assert.ok(Math.abs(dist(p, B.cellXY(r2, c2, 0)) - 2) < 1e-9, `${r},${c} → ${r2},${c2}`);
        assert.ok(B.neighbors(r2, c2).some((q) => q[0] === r && q[1] === c));
      }
      // and nothing else is that close
      let close = 0;
      for (let r2 = 0; r2 < B.ROWS; r2++) for (let c2 = 0; c2 < B.rowLen(r2); c2++) {
        if ((r2 !== r || c2 !== c) && dist(p, B.cellXY(r2, c2, 0)) < 2.01) close++;
      }
      assert.equal(close, nb.length);
    }
  }
  assert.equal(J(B.neighbors(2, 4).sort()), J([[1, 3], [1, 4], [2, 3], [2, 5], [3, 3], [3, 4]].sort()));
  assert.equal(J(B.neighbors(1, 4).sort()), J([[0, 4], [0, 5], [1, 3], [1, 5], [2, 4], [2, 5]].sort()));
  // the ceiling moves every row down
  assert.ok(Math.abs(B.cellXY(0, 0, 3)[1] - B.cellXY(3, 0, 0)[1]) < 1e-9);
});

test("bubble: a stopped shot snaps to the nearest empty cell that hangs on", () => {
  const g = G(["0.........."]);
  const at = B.cellXY(0, 0, 0);
  // just below-right of the bubble → row 1, cell 0 (odd row, shifted right)
  assert.equal(J(B.snapCell(g, 0, at[0] + 1, at[1] + 1.6)), J([1, 0]));
  // right beside it → its right neighbour on row 0
  assert.equal(J(B.snapCell(g, 0, at[0] + 2.1, at[1] + 0.1)), J([0, 1]));
  // at the ceiling, far away from everything → a row-0 cell under the point
  assert.equal(J(B.snapCell(g, 0, 15.2, 1)), J([0, 7]));
  // a cell that would hang from nothing is never chosen
  assert.equal(J(B.snapCell(g, 0, 10, 8)), J([0, 4]));          // not (3, 4): nothing to hang from
  // never an occupied cell, always next to a bubble or on row 0; random checks
  const r = prng(3);
  for (let k = 0; k < 400; k++) {
    const g2 = B.startGrid("l3", r), drop = Math.floor(r() * 3);
    const x = 1 + r() * 20, y = 1 + r() * 18;
    const [cr, cc] = B.snapCell(g2, drop, x, y);
    assert.equal(g2[cr][cc], -1);
    assert.ok(cr === 0 || B.neighbors(cr, cc).some(([a, b]) => g2[a][b] >= 0));
  }
});

test("bubble: shots bounce off the walls and stop at the wall of bubbles", () => {
  const empty = B.emptyGrid();
  // straight up: no bounce, ends on the ceiling, middle cell
  let tr = B.trace(empty, 0, 90);
  assert.equal(tr.bounces, 0);
  assert.equal(J(tr.cell), J([0, 5]));
  // a flat shot bounces; the angle mirrors (x reflects, y keeps going up)
  tr = B.trace(empty, 0, 30);
  assert.ok(tr.bounces >= 1);
  const b1 = tr.path[1];
  assert.ok(Math.abs(b1[0] - (B.W - 1)) < 1e-9, "first bounce on the right wall");
  const dy = B.SHOOT_Y - b1[1], dx = b1[0] - B.W / 2;
  assert.ok(Math.abs(Math.atan2(dy, dx) * 180 / Math.PI - 30) < 0.5);
  // after the bounce it heads left, at the mirrored angle
  const p2 = tr.path[2];
  assert.ok(p2[0] < b1[0]);
  assert.ok(Math.abs(Math.atan2(b1[1] - p2[1], b1[0] - p2[0]) * 180 / Math.PI - 30) < 0.5);
  // mirror symmetry: 30° and 150° land in mirrored cells
  const left = B.trace(empty, 0, 150);
  assert.equal(left.path[1][0], 1);
  assert.ok(Math.abs(B.cellXY(...tr.cell, 0)[0] + B.cellXY(...left.cell, 0)[0] - B.W) < 2.01);
  // the path stays inside the walls, whatever the angle
  for (let a = 8; a <= 172; a += 3.7) {
    const t2 = B.trace(B.startGrid("l2", prng(a * 10)), 1, a);
    t2.path.forEach(([x]) => assert.ok(x >= 1 - 1e-9 && x <= B.W - 1 + 1e-9));
    assert.ok(t2.cell);
  }
  // the aim line (one bounce at most) stops at the second wall
  const aim = B.trace(empty, 0, 12, 1);
  assert.equal(aim.bounces, 1);
  assert.equal(aim.cell, null);
  assert.equal(aim.path[aim.path.length - 1][0], 1);
  // hitting a bubble: it stops before passing through it
  const g = G([".....0....."]);
  tr = B.trace(g, 0, 90);
  const end = tr.path[tr.path.length - 1];
  assert.ok(dist(end, B.cellXY(0, 5, 0)) < B.HIT + 0.01 && dist(end, B.cellXY(0, 5, 0)) > B.HIT - 0.25);
  assert.ok(J(tr.cell) === J([1, 4]) || J(tr.cell) === J([1, 5]));
});

test("bubble: three or more of a colour pop, smaller groups stick", () => {
  // two red side by side, a red shot next to them → 3 pop
  let g = G(["00.1......."]);
  let res = B.settle(g, [1, 1], 0);
  assert.equal(res.popped.length, 3);
  assert.equal(res.grid[0][0], -1);
  assert.equal(res.grid[0][1], -1);
  assert.equal(res.grid[0][3], 1);
  assert.equal(res.gain, 30);
  // two only: stays
  res = B.settle(G(["0.1........"]), [1, 0], 0);
  assert.equal(res.popped.length, 0);
  assert.equal(res.grid[1][0], 0);
  assert.equal(res.gain, 0);
  // cluster follows hex neighbours only
  g = G(["0.0........", "0.........", "0.........."]);
  assert.equal(J(sortCells(B.cluster(g, 0, 0))), J([[0, 0], [1, 0], [2, 0]]));
  assert.equal(B.cluster(g, 0, 2).length, 1);
  assert.equal(B.cluster(g, 0, 1).length, 0);
  // inputs are untouched
  const before = J(g);
  B.settle(g, [0, 1], 0);
  assert.equal(J(g), before);
});

test("bubble: bubbles that hang from nothing fall, with a bonus", () => {
  // a column of blue hangs from a red pair; popping the reds drops the blues
  const g = G(["00.........", "1.........", "1.........."]);
  assert.equal(B.floating(g).length, 0);
  const res = B.settle(g, [0, 2], 0);
  assert.equal(res.popped.length, 3);
  assert.equal(J(sortCells(res.fell)), J([[1, 0], [2, 0]]));
  assert.equal(B.countBubbles(res.grid), 0);
  assert.equal(res.gain, 30 + 40);
  // floating finds every cut-off group, and only those
  const h = G(["1..........", "2.........", "...3.......", "..33......"]);
  assert.equal(J(sortCells(B.floating(h))), J([[2, 3], [3, 2], [3, 3]]));
  assert.equal(B.points(0, 5), 200);
  assert.equal(B.points(3, 10), 30 + 600);
  // random walls: after a settle nothing floats
  const r = prng(11);
  for (let k = 0; k < 300; k++) {
    const g2 = B.startGrid("l3", r);
    const tr = B.trace(g2, 0, 8 + r() * 164);
    const s = B.settle(g2, tr.cell, Math.floor(r() * 6));
    assert.equal(B.floating(s.grid).length, 0);
    assert.equal(B.countBubbles(s.grid), B.countBubbles(g2) + 1 - s.popped.length - s.fell.length);
  }
});

test("bubble: levels, colours on the board and the line", () => {
  for (const lv of ["l1", "l2", "l3"]) {
    const L = B.LEVEL[lv], g = B.startGrid(lv, prng(5));
    assert.equal(B.lowestRow(g, 0), L.rows - 1);
    assert.ok(B.colorsOn(g).every((c) => c < L.colors));
    assert.ok(L.rows - 1 + Math.floor(30 / L.every) < B.ROWS);
  }
  assert.equal(J(B.colorsOn(G(["3..5.......", "3........."]))), J([3, 5]));
  assert.equal(B.lowestRow(B.emptyGrid(), 4), -1);
  assert.equal(B.lowestRow(G(["1", "1"]), 9), 10);              // row 1 + drop 9 = 10: still above the line
  assert.ok(B.lowestRow(G(["1", "1"]), 10) >= B.LOSE);         // the ceiling pushed it over
});

test("bubble: records merge is a join and a reset drops older rows", () => {
  const M = B.mergeBubble, keys = ["l1", "l2", "l3"];
  const st = () => {
    const rows = {};
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      keys.forEach((k) => { if (rnd(2)) { const g = 1 + rnd(9); s[k] = { s: rnd(5) * 100, ts: rnd(3) * 1000, g, w: rnd(g + 1) }; } });
      rows["d" + rnd(4)] = { b: rnd(3) * 100, s };
    }
    return { ver: 1, br: rnd(4) ? 0 : rnd(3) * 100, rows };
  };
  for (let i = 0; i < 5000; i++) {
    const a = st(), b = st(), c = st(), sa = J(a);
    assert.equal(J(M(a, b)), J(M(b, a)));
    const m = M(a, b);
    assert.equal(J(M(m, m)), J(m));
    assert.equal(J(M(M(a, b), c)), J(M(a, M(b, c))));
    assert.equal(J(a), sa);
  }
  const x = { rows: { d: { b: 0, s: { l1: { s: 900, ts: 500, g: 3, w: 1 } } } } };
  const y = { rows: { d: { b: 0, s: { l1: { s: 900, ts: 300, g: 2, w: 2 }, l3: { s: 50, ts: 1, g: 1, w: 0 } } } } };
  assert.equal(J(M(x, y).rows.d.s.l1), J({ s: 900, ts: 300, g: 3, w: 2 }));        // tie: the earlier one
  assert.equal(J(M(x, { rows: { d: { b: 0, s: { l1: { s: 1200, ts: 900, g: 1, w: 0 } } } } }).rows.d.s.l1),
    J({ s: 1200, ts: 900, g: 3, w: 1 }));                                            // the higher score wins
  assert.equal(J(M(x, { rows: { d: { b: 1, s: { l2: { s: 1, ts: 1, g: 1, w: 1 } } } } }).rows.d.s), J({ l2: { s: 1, ts: 1, g: 1, w: 1 } }));
  assert.equal(J(M(x, { br: 5, rows: {} }).rows), "{}");
  for (const bad of [{ s: -1, ts: 1, g: 1, w: 0 }, { s: 5, ts: -1, g: 1, w: 0 }, { s: 5, ts: 1, g: 0, w: 0 },
                     { s: 5, ts: 1, g: 1, w: 2 }, { s: 5, ts: 1, g: 1 }, { s: 1.5, ts: 1, g: 1, w: 0 }, { s: 2e8, ts: 1, g: 1, w: 0 }]) {
    assert.equal(J(M({ rows: { d: { b: 0, s: { l1: bad } } } }, null).rows), "{}", J(bad));
  }
  assert.equal(J(M({ rows: { d: { b: 0, s: { l9: { s: 5, ts: 1, g: 1, w: 0 } } } } }, null).rows), "{}");
});
