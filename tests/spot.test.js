// Pure logic of Spot the Difference: seeded scenes, puzzles with
// exactly N detectable differences that never overlap and stay inside
// the picture, hit testing, the miss lock and the records merge.
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

const SRC = fs.readFileSync(path.join(__dirname, "..", "spot/spot.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

const S = (() => {
  const parts = [cut("  var VW = 400", "  // ---------- 1."), cut("  var KINDS = {", "  function between("),
    "var DATA_VER = 1;",
    "function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }",
    "function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }"];
  ["rng", "between", "boxOf", "boxesMeet", "inside", "sizeOf", "fits", "makeScene", "regionOf", "circleInside",
   "circlesMeet", "change", "makePuzzle", "hitTest", "shouldLock", "hsl", "kindSvg", "propSvg", "bgSvg", "pictureSvg",
   "normCell", "normRow", "joinCell", "joinRows", "mergeSpot"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    parts.push(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function(parts.join("\n") +
    "\nreturn { VW, VH, LEVEL, KINDS, THEMES, QUICK_MS, makeScene, makePuzzle, hitTest, shouldLock, pictureSvg, propSvg," +
    " boxOf, sizeOf, regionOf, mergeSpot };")();
})();

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
const boxIn = (b, c) => [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].every(([x, y]) => Math.hypot(x - c.x, y - c.y) <= c.r + 1e-6);

test("spot: scenes are seeded, full and never overlap", () => {
  const themes = new Set();
  for (let seed = 1; seed < 400; seed++) {
    const sc = S.makeScene(seed * 104729);
    assert.equal(J(sc), J(S.makeScene(seed * 104729)), "same seed, same scene");
    themes.add(sc.theme);
    assert.ok(sc.props.length >= 20, "only " + sc.props.length + " objects");
    sc.props.forEach((p, i) => {
      assert.ok(S.KINDS[p.k]);
      const b = S.boxOf(p);
      assert.ok(b.x0 >= 0 && b.y0 >= 0 && b.x1 <= S.VW && b.y1 <= S.VH, "outside " + J(p));
      for (let j = i + 1; j < sc.props.length; j++) {
        const q = S.boxOf(sc.props[j]);
        assert.ok(!(b.x0 < q.x1 && q.x0 < b.x1 && b.y0 < q.y1 && q.y0 < b.y1), "overlap " + J(p) + J(sc.props[j]));
      }
    });
  }
  assert.equal(themes.size, S.THEMES.length);
  // every kind draws something
  for (const k of Object.keys(S.KINDS)) assert.ok(S.propSvg({ k, s: 20, x: 50, y: 50, c: 120, f: 1 }).length > 60, k);
});

for (const lv of ["l1", "l2", "l3"]) {
  test(`spot: ${lv} puzzles have exactly ${S.LEVEL[lv].n} detectable differences, apart, inside the picture`, () => {
    const L = S.LEVEL[lv], types = {};
    for (let s = 0; s < 250; s++) {
      const seed = (s * 2654435761) % 2147483647;
      const pz = S.makePuzzle(seed, lv);
      assert.ok(pz, "no puzzle for seed " + seed);
      assert.equal(J(pz), J(S.makePuzzle(seed, lv)), "same seed, same puzzle");
      assert.equal(pz.diffs.length, L.n);
      assert.equal(pz.props.length, pz.propsB.length);
      // the two pictures differ in exactly the changed objects
      const changed = new Set(pz.diffs.map((d) => d.i));
      assert.equal(changed.size, L.n);
      pz.props.forEach((p, i) => {
        if (!changed.has(i)) assert.equal(J(pz.propsB[i]), J(p));
        else assert.notEqual(J(pz.propsB[i]), J(p));
      });
      pz.diffs.forEach((d, k) => {
        const a = pz.props[d.i], b = pz.propsB[d.i], K = S.KINDS[a.k];
        types[d.type] = (types[d.type] || 0) + 1;
        // inside the picture, apart from every other difference
        assert.ok(d.x - d.r >= 0 && d.y - d.r >= 0 && d.x + d.r <= S.VW && d.y + d.r <= S.VH, "circle outside " + J(d));
        for (let m = k + 1; m < pz.diffs.length; m++) {
          const e = pz.diffs[m];
          assert.ok(Math.hypot(d.x - e.x, d.y - e.y) >= d.r + e.r, "circles overlap " + J(d) + J(e));
        }
        // the circle holds the object, before and after
        assert.ok(boxIn(S.boxOf(a), d), "circle misses the object " + J(d));
        if (b) assert.ok(boxIn(S.boxOf(b), d), "circle misses the changed object " + J(d));
        // big enough, and changed enough to see
        assert.ok(S.sizeOf(a) >= L.min, "too small " + J(a));
        if (d.type === "missing") assert.equal(b, null);
        else if (d.type === "color") { assert.ok(!K.nc); assert.ok(hueDist(a.c, b.c) >= 40, "hue " + a.c + "→" + b.c); assert.equal(J({ ...b, c: 0 }), J({ ...a, c: 0 })); }
        else if (d.type === "size") { const r = b.s / a.s; assert.ok(r >= L.grow - 0.02 || r <= L.shrink + 0.02, "size " + r); }
        else if (d.type === "moved") assert.ok(Math.hypot(b.x - a.x, b.y - a.y) >= L.move - 1, "moved " + J([a, b]));
        else if (d.type === "mirror") { assert.ok(K.a, a.k + " is symmetric"); assert.equal(b.f, -a.f); }
        else assert.fail("type " + d.type);
        // a changed object still fits among the others (no overlap)
        if (b) {
          const bb = S.boxOf(b);
          pz.propsB.forEach((q, j) => {
            if (j === d.i || !q) return;
            const qb = S.boxOf(q);
            assert.ok(!(bb.x0 < qb.x1 && qb.x0 < bb.x1 && bb.y0 < qb.y1 && qb.y0 < bb.y1), "changed object overlaps " + J(b));
          });
        }
        // and draws differently
        if (b) assert.notEqual(S.propSvg(a), S.propSvg(b));
      });
      assert.notEqual(S.pictureSvg(pz, "a").replace(/spa/g, "spX"), S.pictureSvg(pz, "b").replace(/spb/g, "spX"));
    }
    for (const ty of ["missing", "color", "size", "moved", "mirror"]) assert.ok(types[ty] > 50, lv + " " + J(types));
  });
}

test("spot: harder levels have more, smaller and subtler differences", () => {
  const [a, b, c] = ["l1", "l2", "l3"].map((k) => S.LEVEL[k]);
  assert.deepEqual([a.n, b.n, c.n], [5, 7, 10]);
  assert.ok(a.min > b.min && b.min > c.min);
  assert.ok(a.hue > b.hue && b.hue > c.hue && c.hue >= 40);
  assert.ok(a.grow > b.grow && b.grow > c.grow && a.shrink < b.shrink && b.shrink < c.shrink);
  assert.ok(a.move > b.move && b.move > c.move);
});

test("spot: a tap finds the difference under it, on either picture", () => {
  const diffs = [{ x: 50, y: 50, r: 20 }, { x: 120, y: 50, r: 30 }, { x: 300, y: 200, r: 15 }];
  assert.equal(S.hitTest(diffs, [], 50, 50, 0), 0);
  assert.equal(S.hitTest(diffs, [], 65, 50, 0), 0);
  assert.equal(S.hitTest(diffs, [], 95, 50, 0), 1);
  assert.equal(S.hitTest(diffs, [], 300, 216, 0), -1);              // just outside
  assert.equal(S.hitTest(diffs, [], 300, 216, 3), 2);               // a finger's slack
  assert.equal(S.hitTest(diffs, [], 200, 120, 8), -1);
  assert.equal(S.hitTest(diffs, [1], 120, 60, 0), -2);              // found already
  assert.equal(S.hitTest(diffs, [0], 72, 50, 8), -2);              // within both slacks: the nearer edge wins (0, found)
  // on real puzzles, the centre of each circle finds it
  for (let s = 1; s < 60; s++) {
    const pz = S.makePuzzle(s * 31337, ["l1", "l2", "l3"][s % 3]);
    pz.diffs.forEach((d, i) => assert.equal(S.hitTest(pz.diffs, [], d.x, d.y, 8), i));
  }
});

test("spot: three quick misses lock the pictures", () => {
  assert.equal(S.shouldLock([1000, 2000], 2500), false);
  assert.equal(S.shouldLock([1000, 2000, 3000], 3000), true);
  assert.equal(S.shouldLock([1000, 2000, 3000 + S.QUICK_MS], 3000 + S.QUICK_MS), false);   // the first is too old
  assert.equal(S.shouldLock([], 0), false);
});

test("spot: records merge is a join and a reset drops older rows", () => {
  const M = S.mergeSpot, keys = ["l1", "l2", "l3"];
  const st = () => {
    const rows = {};
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      keys.forEach((k) => { if (rnd(2)) s[k] = { t: 1000 + rnd(30) * 1000, ts: rnd(3) * 1000, w: 1 + rnd(9) }; });
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
  const x = { rows: { d: { b: 0, s: { l1: { t: 90000, ts: 500, w: 3 } } } } };
  const y = { rows: { d: { b: 0, s: { l1: { t: 90000, ts: 300, w: 2 }, l3: { t: 5000, ts: 1, w: 1 } } } } };
  assert.equal(J(M(x, y).rows.d.s.l1), J({ t: 90000, ts: 300, w: 3 }));
  assert.equal(J(M(x, { rows: { d: { b: 0, s: { l1: { t: 80000, ts: 900, w: 1 } } } } }).rows.d.s.l1), J({ t: 80000, ts: 900, w: 3 }));
  assert.equal(J(M(x, { rows: { d: { b: 1, s: { l2: { t: 1, ts: 1, w: 1 } } } } }).rows.d.s), J({ l2: { t: 1, ts: 1, w: 1 } }));
  assert.equal(J(M(x, { br: 5, rows: {} }).rows), "{}");
  for (const bad of [{ t: 0, ts: 1, w: 1 }, { t: 5, ts: -1, w: 1 }, { t: 5, ts: 1, w: 0 }, { t: 5, ts: 1 }, { t: 1.5, ts: 1, w: 1 }, { t: 4e8, ts: 1, w: 1 }]) {
    assert.equal(J(M({ rows: { d: { b: 0, s: { l1: bad } } } }, null).rows), "{}", J(bad));
  }
  assert.equal(J(M({ rows: { d: { b: 0, s: { l9: { t: 5, ts: 1, w: 1 } } } } }, null).rows), "{}");
});
