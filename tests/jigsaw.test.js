// Pure logic of Jigsaw: cutting (every tab fits its neighbour's blank),
// snapping and groups, rotation and the solved check, the table and
// its slots, the crop, the picture check and the records merge.
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

const SRC = fs.readFileSync(path.join(__dirname, "..", "jigsaw/jigsaw.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

const NAMES = ["cmpStr", "isInt", "isNum", "clamp", "prng", "gridFor", "makeEdges", "edgeCurve", "reverseChain",
  "pieceSides", "pieceOutline", "isBorder", "rotVec", "home", "relPos", "neighbours", "members", "dist", "isPlaced",
  "joinGroups", "regularize", "snapGroup", "isSolved", "progress", "clampShift", "rotateGroup", "slotList",
  "tableFor", "tidyOrder", "cropRect", "sniffImage", "normCell", "normRow", "joinCell", "joinRows", "mergeJigsaw",
  "totals", "addSolve", "validGame"];

const J = (() => {
  const parts = [cut("  var DATA_VER", "  // ---------- 1.")];
  NAMES.forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    const end = SRC.indexOf("\n  }\n", i);
    const line = SRC.indexOf("\n", i);
    // one-line functions end on their own line
    parts.push(SRC.slice(i, SRC.slice(i, line).trim().endsWith("}") ? line + 1 : end + 4));
  });
  return new Function(parts.join("\n") +
    "\nreturn { COUNTS, KEYS, GRIDS, SNAP, FIT, PAD, " + NAMES.join(", ") + " };")();
})();

const S = JSON.stringify;
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-9);

function model(n, portrait, s) {
  const g = J.gridFor(n, portrait);
  return J.tableFor(g.cols, g.rows, s || 100, "c", portrait ? 0.6 : 1.6);
}
// Every piece at home: the solved state.
function solvedP(M) {
  const P = [];
  for (let i = 0; i < M.cols * M.rows; i++) { const h = J.home(M, i); P.push({ x: h.x, y: h.y, r: 0, g: 0, z: i }); }
  return P;
}
// Every piece loose, far from home and from each other.
function looseP(M) {
  const P = [];
  for (let i = 0; i < M.cols * M.rows; i++) P.push({ x: 5 + i * 0.001, y: 5, r: 0, g: i, z: i });
  return P;
}
const clone = (P) => P.map((p) => Object.assign({}, p));

test("jigsaw: grids per count, portrait swaps", () => {
  J.COUNTS.forEach((n) => {
    const l = J.gridFor(n, false), p = J.gridFor(n, true);
    assert.equal(l.cols * l.rows, n);
    assert.ok(l.cols >= l.rows);
    assert.equal(S(p), S({ cols: l.rows, rows: l.cols }));
  });
  assert.equal(J.gridFor(13, false), null);
});

test("jigsaw: the cut is the same for the same seed", () => {
  const a = J.makeEdges(15, 10, "c", J.prng(42)), b = J.makeEdges(15, 10, "c", J.prng(42)), c = J.makeEdges(15, 10, "c", J.prng(43));
  assert.equal(S(a), S(b));
  assert.notEqual(S(a), S(c));
  assert.equal(a.h.length, 9 * 15);
  assert.equal(a.v.length, 10 * 14);
  // both kinds of tabs occur, and squares are flat
  const ds = a.h.concat(a.v).map((e) => e.d);
  assert.ok(ds.includes(1) && ds.includes(-1));
  assert.ok(J.makeEdges(4, 3, "s", J.prng(1)).h.every((e) => e.d === 0));
  const r = J.prng(7);
  for (let i = 0; i < 1000; i++) { const x = r(); assert.ok(x >= 0 && x < 1); }
});

test("jigsaw: every tab fits its neighbour's blank, border sides are flat", () => {
  [[4, 3], [6, 4], [8, 6], [12, 8], [15, 10], [10, 15]].forEach(([cols, rows]) => {
    for (const shape of ["c", "s"]) {
      const E = J.makeEdges(cols, rows, shape, J.prng(cols * 31 + rows));
      const s = 100;
      for (let id = 0; id < cols * rows; id++) {
        const r = Math.floor(id / cols), c = id % cols, sd = J.pieceSides(E, id);
        if (shape === "c") {
          assert.equal(sd[0] === 0, r === 0);
          assert.equal(sd[3] === 0, c === 0);
          assert.equal(sd[2] === 0, r === rows - 1);
          assert.equal(sd[1] === 0, c === cols - 1);
        } else assert.ok(sd.every((x) => x === 0));
        const o = J.pieceOutline(E, id, s);
        // the outline is closed and continuous, clockwise
        assert.ok(near(o[0][0], 0) && near(o[0][1], 0));
        for (let k = 0; k < 4; k++) {
          const a = o[k], b = o[(k + 1) % 4];
          assert.ok(near(a[a.length - 2], b[0]) && near(a[a.length - 1], b[1]), "side " + k + " joins the next");
          assert.equal((a.length - 2) % 6, 0);
        }
        // tabs stay inside the canvas margin
        o.forEach((pts) => { for (let i = 0; i < pts.length; i++) assert.ok(pts[i] >= -J.PAD.c * s && pts[i] <= s + J.PAD.c * s); });
        // right neighbour: its left side is my right side, walked back
        if (c < cols - 1) {
          assert.equal(sd[1], -J.pieceSides(E, id + 1)[3]);
          const mine = o[1], theirs = J.pieceOutline(E, id + 1, s)[3];
          const back = J.reverseChain(theirs.map((v, i) => (i % 2 === 0 ? v + s : v)));
          assert.equal(mine.length, back.length);
          mine.forEach((v, i) => assert.ok(near(v, back[i], 1e-9)));
        }
        // neighbour below: its top side is my bottom side, walked back
        if (r < rows - 1) {
          assert.equal(sd[2], -J.pieceSides(E, id + cols)[0]);
          const mine = o[2], theirs = J.pieceOutline(E, id + cols, s)[0];
          const back = J.reverseChain(theirs.map((v, i) => (i % 2 === 1 ? v + s : v)));
          mine.forEach((v, i) => assert.ok(near(v, back[i], 1e-9)));
        }
        // a tab bulges out, a blank goes in
        if (shape === "c" && r < rows - 1) {
          const ys = o[2].filter((v, i) => i % 2 === 1);
          if (sd[2] === 1) assert.ok(Math.max(...ys) > s * 1.15);
          else assert.ok(Math.min(...ys) < s * 0.85);
        }
      }
    }
  });
});

test("jigsaw: the table leaves room for every loose piece, off the frame", () => {
  J.COUNTS.forEach((n) => {
    [false, true].forEach((portrait) => {
      [0.5, 1, 1.8].forEach((aspect) => {
        const g = J.gridFor(n, portrait), M = J.tableFor(g.cols, g.rows, 50, "c", aspect);
        const sl = J.slotList(M, "c");
        assert.ok(sl.length >= Math.ceil(n * 1.1), n + " pieces: " + sl.length + " slots");
        sl.forEach((p) => {
          assert.ok(p.x > 0 && p.x < M.tw && p.y > 0 && p.y < M.th);
          const inFrame = p.x > M.fx && p.x < M.fx + g.cols * 50 && p.y > M.fy && p.y < M.fy + g.rows * 50;
          assert.ok(!inFrame);
        });
        for (let i = 1; i < sl.length; i++) assert.ok(sl[i].d >= sl[i - 1].d);   // nearest first
      });
    });
  });
});

test("jigsaw: a piece clicks into its place and into a right neighbour", () => {
  const M = model(12, false);
  let P = looseP(M);
  // piece 5 dropped 15 px off its home: it lands exactly there
  const h5 = J.home(M, 5);
  P[5].x = h5.x + 15; P[5].y = h5.y - 10;
  let res = J.snapGroup(P, M, 5);
  assert.equal(S(res), S({ g: 5, joined: 0, placed: true }));
  assert.ok(J.isPlaced(P, M, 5));
  // 40 px off (more than SNAP × 100): nothing happens
  P = looseP(M);
  P[5].x = h5.x + 40; P[5].y = h5.y;
  res = J.snapGroup(P, M, 5);
  assert.equal(res.joined + (res.placed ? 1 : 0), 0);
  assert.equal(P[5].x, h5.x + 40);
  // two loose pieces away from the frame: 6 dropped right of 5
  P = looseP(M);
  P[5].x = 1000; P[5].y = 1000;
  P[6].x = 1100 + 12; P[6].y = 1000 + 9;
  res = J.snapGroup(P, M, 6);
  assert.equal(S(res), S({ g: 5, joined: 1, placed: false }));
  assert.equal(P[6].g, 5);
  assert.ok(near(P[6].x, 1100) && near(P[6].y, 1000));
  assert.ok(near(P[5].x, 1000));        // the one we clicked onto stays
  // a wrong neighbour (6 left of 5) never joins
  P = looseP(M);
  P[5].x = 1000; P[5].y = 1000; P[6].x = 900; P[6].y = 1000;
  res = J.snapGroup(P, M, 6);
  assert.equal(res.joined, 0);
});

test("jigsaw: groups move as one and take in what lines up", () => {
  const M = model(12, false);
  const P = looseP(M);
  // a 2-piece group 0+1, and piece 4 (below 0) already in line with it
  P[0].x = 600; P[0].y = 600; P[1].x = 700; P[1].y = 600; P[1].g = 0;
  P[4].x = 600 + 3; P[4].y = 700 - 2;
  P[5].x = 700 + 60; P[5].y = 700;   // below 1, too far for the second pass
  // drop the group 2 px off; it clicks onto 4 and stays clear of 5
  P[0].x += 2; P[1].x += 2;
  const res = J.snapGroup(P, M, 0);
  assert.equal(res.g, 0);
  assert.ok(res.joined >= 1);
  assert.deepEqual(J.members(P, 0), [0, 1, 4]);
  assert.equal(P[5].g, 5);
  // the group is exact relative to its anchor
  assert.ok(near(P[1].x - P[0].x, 100, 1e-9) && near(P[4].y - P[0].y, 100, 1e-9));
  // now 5 comes close: it joins the group of three
  P[5].x = P[1].x + 8; P[5].y = P[1].y + 100 + 5;
  const r2 = J.snapGroup(P, M, 5);
  assert.equal(r2.g, 0);
  assert.deepEqual(J.members(P, 0), [0, 1, 4, 5]);
  assert.equal(J.progress(P), Math.round(100 * 3 / 11));
  // a group joining a placed piece snaps exactly into the frame
  const Q = looseP(M);
  const h2 = J.home(M, 2);
  Q[2].x = h2.x; Q[2].y = h2.y;                 // placed
  Q[3].x = h2.x + 100 + 6; Q[3].y = h2.y + 7;  // right of 2
  Q[7].x = Q[3].x; Q[7].y = Q[3].y + 100; Q[7].g = 3;   // 3 + 7 as a group
  const r3 = J.snapGroup(Q, M, 3);
  assert.equal(r3.placed, true);
  [2, 3, 7].forEach((i) => assert.ok(J.isPlaced(Q, M, i), "piece " + i + " placed"));
});

test("jigsaw: rotation turns a group, joins need the same turn, solved needs upright", () => {
  const M = model(12, false);
  let P = solvedP(M);
  assert.ok(J.isSolved(P, M));
  // turn the whole picture around piece 5, four times = back
  const before = S(P);
  J.rotateGroup(P, M, 0, 5);
  assert.ok(!J.isSolved(P, M));
  assert.equal(P[0].r, 1);
  // after one turn the right neighbour sits below
  assert.ok(near(P[1].x, P[0].x, 1e-6) && near(P[1].y - P[0].y, 100, 1e-6));
  J.rotateGroup(P, M, 0, 5); J.rotateGroup(P, M, 0, 5); J.rotateGroup(P, M, 0, 5);
  assert.ok(J.isSolved(P, M));
  P.forEach((p, i) => assert.ok(near(p.x, JSON.parse(before)[i].x, 1e-6) && p.r === 0));
  // assembled anywhere on the table counts as solved; one piece off does not
  P = solvedP(M);
  P.forEach((p) => { p.x += 37; p.y -= 11; });
  assert.ok(J.isSolved(P, M));
  P[7].x += 30;
  assert.ok(!J.isSolved(P, M));
  P = solvedP(M); P[3].r = 2;
  assert.ok(!J.isSolved(P, M));
  // a turned piece never joins an upright neighbour, nor its home
  P = looseP(M);
  P[5].x = 1000; P[5].y = 1000;
  P[6].x = 1100; P[6].y = 1000; P[6].r = 1;
  assert.equal(J.snapGroup(P, M, 6).joined, 0);
  const h = J.home(M, 6);
  P[6].x = h.x; P[6].y = h.y;
  assert.equal(J.snapGroup(P, M, 6).placed, false);
  // two pieces turned the same way join along the turned direction
  P = looseP(M);
  P[5].x = 1000; P[5].y = 1000; P[5].r = 1;
  P[6].x = 1000 + 4; P[6].y = 1100 - 3; P[6].r = 1;   // 6 is right of 5 → below after a turn
  const res = J.snapGroup(P, M, 6);
  assert.equal(res.joined, 1);
  assert.ok(near(P[6].x, 1000) && near(P[6].y, 1100));
});

test("jigsaw: moving groups stay on the table", () => {
  const M = model(24, false);
  const P = looseP(M);
  P[0].x = 100; P[0].y = 100; P[1].x = 200; P[1].y = 100; P[1].g = 0;
  const sh = J.clampShift(P, M, [0, 1], -500, 1e6);
  assert.ok(P[0].x + sh[0] >= 0 && P[1].y + sh[1] <= M.th);
  const sh2 = J.clampShift(P, M, [0, 1], 10, 20);
  assert.equal(S(sh2), S([10, 20]));
});

test("jigsaw: tidy puts edge pieces first, in reading order", () => {
  const M = model(12, false);
  const P = looseP(M);
  P[5].x = 10; P[5].y = 900;   // inner
  P[0].x = 50; P[0].y = 900;   // edge
  P[6].x = 30; P[6].y = 100;   // inner
  P[11].x = 90; P[11].y = 100; // edge
  assert.deepEqual(J.tidyOrder(P, M, [5, 0, 6, 11]), [11, 0, 6, 5]);
  assert.ok(J.isBorder(M, 0) && J.isBorder(M, 11) && !J.isBorder(M, 5) && !J.isBorder(M, 6));
});

test("jigsaw: crop keeps the aspect and stays inside the picture", () => {
  let r = J.cropRect(4000, 3000, 1.5, 1);
  assert.ok(near(r.w / r.h, 1.5) && r.w === 4000 && near(r.y, (3000 - 4000 / 1.5) / 2));
  r = J.cropRect(1000, 3000, 1.5, 2, 0, 0);
  assert.ok(near(r.w, 500) && near(r.x, 0) && near(r.y, 0));
  r = J.cropRect(1000, 3000, 2 / 3, 1, 1e9, 1e9);
  assert.ok(near(r.x + r.w, 1000) && near(r.y + r.h, 3000) && near(r.w / r.h, 2 / 3));
  r = J.cropRect(800, 800, 4 / 3, 50);
  assert.ok(r.w >= 800 / 8 - 1e-9);   // zoom is capped
});

test("jigsaw: only raster pictures pass the byte check; SVG never does", () => {
  const b = (arr) => { const u = new Uint8Array(16); arr.forEach((v, i) => { u[i] = typeof v === "string" ? v.charCodeAt(0) : v; }); return u; };
  assert.equal(J.sniffImage(b([0xFF, 0xD8, 0xFF, 0xE0])), "jpeg");
  assert.equal(J.sniffImage(b([0x89, "P", "N", "G", 13, 10, 26, 10])), "png");
  assert.equal(J.sniffImage(b(["G", "I", "F", "8", "9", "a"])), "gif");
  assert.equal(J.sniffImage(b(["R", "I", "F", "F", 0, 0, 0, 0, "W", "E", "B", "P"])), "webp");
  assert.equal(J.sniffImage(b(["B", "M"])), "bmp");
  assert.equal(J.sniffImage(b([0, 0, 0, 0x20, "f", "t", "y", "p", "a", "v", "i", "f"])), "avif");
  const txt = (s) => Uint8Array.from(Buffer.from(s.padEnd(16, " ")));
  assert.equal(J.sniffImage(txt("<svg xmlns='http://www.w3.org/2000/svg'>")), null);
  assert.equal(J.sniffImage(txt("<?xml version='1.0'?><svg>")), null);
  assert.equal(J.sniffImage(txt("<html><script>")), null);
  assert.equal(J.sniffImage(b(["R", "I", "F", "F", 0, 0, 0, 0, "W", "A", "V", "E"])), null);
  assert.equal(J.sniffImage(new Uint8Array(4)), null);
  assert.equal(J.sniffImage(null), null);
});

test("jigsaw: a saved puzzle is checked and its groups made exact", () => {
  const M = model(12, false, 100);
  const img = { id: "abc", w: M.cols * 100, h: M.rows * 100 };
  const P = looseP(M);
  P[1].g = 0; P[1].x = P[0].x + 100.4; P[1].y = P[0].y - 0.3;   // a group, slightly off
  const G = { v: 1, img: "abc", n: 12, cols: M.cols, rows: M.rows, s: 100, shape: "c", rot: 0, seed: 99,
    fx: M.fx, fy: M.fy, tw: M.tw, th: M.th, p: P.map((p) => [p.x, p.y, p.r, p.g, p.z * 10]), el: 1234, done: 0, at: 1 };
  const v = J.validGame(G, img);
  assert.ok(v);
  assert.ok(near(v.P[1].x - v.P[0].x, 100) && near(v.P[1].y, v.P[0].y));
  assert.deepEqual(v.P.map((p) => p.z), [...Array(12).keys()]);
  const bad = (f) => { const g = JSON.parse(JSON.stringify(G)); f(g); return J.validGame(g, img); };
  assert.equal(bad((g) => { g.img = "zzz"; }), null);
  assert.equal(bad((g) => { g.n = 24; }), null);
  assert.equal(bad((g) => { g.p.pop(); }), null);
  assert.equal(bad((g) => { g.p[3][2] = 1; }), null);          // turned with rotation off
  assert.equal(bad((g) => { g.p[3][3] = 5; }), null);          // group named after a later piece
  assert.equal(bad((g) => { g.rot = 1; g.p[1][2] = 2; }), null); // group members turned differently
  assert.equal(bad((g) => { g.s = 101; }), null);              // picture size mismatch
  assert.equal(J.validGame(null, img), null);
  assert.equal(J.validGame(G, null), null);
});

// ---------- records merge ----------
const cell = (n, t, ts) => ({ n, t, ts });
function randomData(seed) {
  let x = seed;
  const r = (n) => { x = (x * 1103515245 + 12345) % 2147483648; return x % n; };
  const rows = {};
  ["devaaaaaa", "devbbbbbb", "devcccccc"].forEach((id) => {
    if (r(3) === 0) return;
    const s = {};
    J.KEYS.forEach((k) => { if (r(2)) s[k] = cell(1 + r(5), 1000 + r(5) * 1000, r(4) * 100); });
    rows[id] = { b: r(3) * 10, s };
  });
  return { ver: 1, br: r(2) ? 10 : 0, rows };
}

test("jigsaw: records merge is symmetric, associative, idempotent, inputs untouched", () => {
  for (let k = 1; k < 200; k++) {
    const A = randomData(k), B = randomData(k * 7 + 3), C = randomData(k * 13 + 5);
    const a0 = S(A), b0 = S(B);
    const AB = J.mergeJigsaw(A, B);
    assert.equal(S(AB), S(J.mergeJigsaw(B, A)));
    assert.equal(S(J.mergeJigsaw(AB, C)), S(J.mergeJigsaw(A, J.mergeJigsaw(B, C))));
    assert.equal(S(J.mergeJigsaw(AB, AB)), S(AB));
    assert.equal(S(J.mergeJigsaw(AB, null)), S(AB));
    assert.equal(S(A), a0); assert.equal(S(B), b0);
  }
});

test("jigsaw: best time, solved counts, reset and bad rows", () => {
  let d = { ver: 1, br: 0, rows: {} };
  let r = J.addSolve(d, "deviceaaa", "12", 90000, 1000);
  assert.equal(r.record, true);
  d = r.data;
  r = J.addSolve(d, "deviceaaa", "12", 95000, 2000);
  assert.equal(r.record, false);
  d = r.data;
  assert.equal(S(d.rows.deviceaaa.s["12"]), S(cell(2, 90000, 1000)));
  r = J.addSolve(d, "devicebbb", "12", 80000, 3000);
  assert.equal(r.record, true);
  d = r.data;
  assert.equal(S(J.totals(d, "12")), S({ n: 3, t: 80000, ts: 3000 }));
  assert.equal(S(J.totals(d, "48")), S({ n: 0, t: 0, ts: 0 }));
  // the same row seen by two devices: larger count, better time
  const x = { ver: 1, br: 0, rows: { deviceaaa: { b: 0, s: { "24": cell(3, 70000, 5) } } } };
  const y = { ver: 1, br: 0, rows: { deviceaaa: { b: 0, s: { "24": cell(5, 75000, 9), "96": cell(1, 4e5, 2) } } } };
  assert.equal(S(J.mergeJigsaw(x, y).rows.deviceaaa.s), S({ "24": cell(5, 70000, 5), "96": cell(1, 4e5, 2) }));
  // reset: br drops older rows; the next solve starts a fresh row
  d.br = 5000;
  d = J.mergeJigsaw(d, d);
  assert.equal(S(d.rows), "{}");
  const old = { ver: 1, br: 0, rows: { deviceaaa: { b: 0, s: { "12": cell(9, 1000, 1) } } } };
  assert.equal(S(J.mergeJigsaw(d, old).rows), "{}");
  r = J.addSolve(d, "deviceaaa", "12", 99000, 6000);
  assert.equal(S(r.data.rows.deviceaaa), S({ b: 5000, s: { "12": cell(1, 99000, 6000) } }));
  // bad cells, keys and ids drop
  const junk = { ver: 1, br: -3, rows: {
    deviceaaa: { b: 0, s: { "12": cell(0, 5, 5), "13": cell(1, 5, 5), "48": cell(1, 1.5, 5), "96": cell(1, 5, -1), "150": cell(2, 5, 5) } },
    "BAD ID": { b: 0, s: { "12": cell(1, 5, 5) } },
    devicebbb: { b: "x", s: { "12": cell(1, 5, 5) } },
    deviceccc: { b: 0, s: {} } } };
  assert.equal(S(J.mergeJigsaw(junk, junk)), S({ ver: 1, br: 0, rows: { deviceaaa: { b: 0, s: { "150": cell(2, 5, 5) } } } }));
  // canonical: keys sorted, fixed order
  const m = J.mergeJigsaw({ rows: { devzzzzzz: { b: 1, s: { "96": cell(1, 9, 9), "12": cell(1, 9, 9) } }, devaaaaaa: { b: 1, s: { "12": cell(1, 9, 9) } } } }, null);
  assert.deepEqual(Object.keys(m.rows), ["devaaaaaa", "devzzzzzz"]);
  assert.deepEqual(Object.keys(m.rows.devzzzzzz.s), ["12", "96"]);
});
