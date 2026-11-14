// Vector tools, wave V1: designkit/vector.js (outlines as editable
// points) and designkit/pathedit.js (the pen and point editing, with
// a fake host).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const V = require(path.join(ROOT, "designkit/vector.js"));
const PE = require(path.join(ROOT, "designkit/pathedit.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const FX = require(path.join(ROOT, "designkit/fx.js"));

const close = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-6);
function sameCmds(a, b, eps) {
  assert.equal(a.length, b.length, JSON.stringify(a) + " vs " + JSON.stringify(b));
  a.forEach((c, i) => {
    assert.equal(c[0], b[i][0]);
    for (let k = 1; k < c.length; k++) assert.ok(close(c[k], b[i][k], eps || 1e-6), c + " vs " + b[i]);
  });
}

// ---------- designkit/vector.js ----------

test("commands → points → commands keeps every shape of the library", () => {
  FX.SHAPES.forEach((sh) => {
    const cmds = FX.shapePath(sh.id, 120, 80, { round: 30 });
    const back = V.toCmds(V.fromCmds(cmds));
    // a closed outline that ends on its first point keeps that point once
    const want = V.toCmds(V.fromCmds(back));
    sameCmds(back, want);
    const b1 = V.bounds(cmds), b2 = V.bounds(back);
    assert.ok(close(b1.x, b2.x, 1e-6) && close(b1.w, b2.w, 1e-6) && close(b1.h, b2.h, 1e-6), sh.id);
  });
});

test("fromCmds: kinds from the handles, closed paths, a closing point that repeats the first", () => {
  const ps = V.fromCmds([["M", 0, 0], ["C", 0, -10, 20, -10, 20, 0], ["C", 20, 5, 10, 10, 0, 0], ["Z"]]);
  assert.equal(ps.length, 1);
  assert.equal(ps[0].closed, true);
  assert.equal(ps[0].n.length, 2);                 // the last point was the first one
  const sq = V.fromCmds([["M", 0, 0], ["L", 10, 0], ["L", 10, 10], ["Z"], ["M", 20, 20], ["L", 30, 30]]);
  assert.equal(sq.length, 2);
  assert.equal(sq[0].closed, true);
  assert.equal(sq[1].closed, false);
  assert.deepEqual(sq[0].n.map((n) => n.k), ["c", "c", "c"]);
  const smooth = V.fromCmds([["M", 0, 0], ["C", 5, 0, 10, 10, 20, 10], ["C", 30, 10, 35, 0, 40, 0]]);
  assert.equal(smooth[0].n[1].k, "y");             // handles on one line, same length
  const sm2 = V.fromCmds([["M", 0, 0], ["C", 5, 0, 10, 10, 20, 10], ["C", 40, 10, 35, 0, 40, 0]]);
  assert.equal(sm2[0].n[1].k, "s");
});

test("toCmds: straight segments stay lines, a 1-point path draws nothing", () => {
  const ps = [{ closed: false, n: [{ x: 0, y: 0, ix: 0, iy: 0, ox: 0, oy: 0 }, { x: 5, y: 5, ix: 5, iy: 5, ox: 5, oy: 5 }] },
    { closed: false, n: [{ x: 1, y: 1, ix: 1, iy: 1, ox: 1, oy: 1 }] }];
  assert.deepEqual(V.toCmds(ps), [["M", 0, 0], ["L", 5, 5]]);
});

test("bounds follow the curve, not its handles", () => {
  const b = V.bounds([["M", 0, 0], ["C", 0, -40, 100, -40, 100, 0]]);
  assert.ok(close(b.y, -30, 1e-9));                 // the top of the curve is ¾ of the way to the handles
  assert.ok(close(b.w, 100) && close(b.h, 30, 1e-9));
});

test("reframe: the box holds the outline where it is, rotated boxes too", () => {
  const frame = { x: 100, y: 50, w: 200, h: 100, rot: 30 };
  const ps = V.fromCmds(V.ellCmds(200, 100));
  // move the right-hand point 50 out: the box grows to the right
  ps[0].n[1].x += 50; ps[0].n[1].ix += 50; ps[0].n[1].ox += 50;
  const r = V.reframe(frame, ps);
  assert.ok(r.w > 200 && close(r.h, 100, 1e-3));
  assert.equal(r.rot, 30);
  // every point lands on the same page spot as before
  function page(fr, x, y) {
    const a = fr.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), dx = x - fr.w / 2, dy = y - fr.h / 2;
    return [fr.x + fr.w / 2 + dx * c - dy * s, fr.y + fr.h / 2 + dx * s + dy * c];
  }
  const before = page(frame, ps[0].n[2].x, ps[0].n[2].y);
  const u = r.unit[3];                               // the 3rd segment ends on point 2? find it by value
  void u;
  const back = V.fromCmds(V.scaled(r.unit, r.w, r.h));
  const after = page(r, back[0].n[2].x, back[0].n[2].y);
  assert.ok(close(before[0], after[0], 2e-3) && close(before[1], after[1], 2e-3));
  // units in 0..1 for the points
  r.unit.forEach((c) => { if (c[0] !== "Z") { assert.ok(c[c.length - 2] > -1e-9 && c[c.length - 2] < 1 + 1e-9); } });
  // and the model keeps it
  assert.ok(M.parsePath(M.pathText(r.unit)));
});

test("reframe: a straight line still gets a box (MIN_BOX), from page points", () => {
  const r = V.reframe({ x: 0, y: 0, w: 0, h: 0, rot: 0 }, V.fromCmds([["M", 10, 20], ["L", 110, 20]]));
  assert.ok(close(r.x, 10) && close(r.w, 100) && close(r.h, V.MIN_BOX));
  assert.ok(close(r.y, 20 - V.MIN_BOX / 2));
  assert.deepEqual(r.unit, [["M", 0, 0.5], ["L", 1, 0.5]]);
});

test("nearest + split: a new point on the curve, the shape unchanged", () => {
  const ps = V.fromCmds([["M", 0, 0], ["C", 0, -40, 100, -40, 100, 0]]);
  const q = V.nearest(ps, 50, -40);
  assert.ok(close(q.t, 0.5, 1e-4) && close(q.x, 50, 1e-3) && close(q.y, -30, 1e-3));
  const before = V.at(V.bez(ps[0], [0, 1]), 0.25);
  const ni = V.split(ps, q.pi, q.si, q.t);
  assert.equal(ni, 1);
  assert.equal(ps[0].n.length, 3);
  // the first half now runs 0..1 where it ran 0..0.5
  const after = V.at(V.bez(ps[0], [0, 1]), 0.5);
  assert.ok(close(before[0], after[0], 1e-3) && close(before[1], after[1], 1e-3));
  assert.equal(ps[0].n[1].k, "y");
  // a straight segment stays straight
  const ln = V.fromCmds([["M", 0, 0], ["L", 10, 0], ["L", 10, 10], ["Z"]]);
  V.split(ln, 0, 2, 0.5);                              // the closing segment
  assert.equal(ln[0].n.length, 4);
  assert.deepEqual(V.toCmds(ln).map((c) => c[0]), ["M", "L", "L", "L", "Z"]);
  assert.ok(close(ln[0].n[3].x, 5) && close(ln[0].n[3].y, 5));
});

test("handles: smooth keeps the other side on its line, symmetric mirrors, Alt frees", () => {
  const n = { x: 0, y: 0, ix: -10, iy: 0, ox: 20, oy: 0, k: "s" };
  V.moveHandle(n, "o", 0, 30);
  assert.ok(close(n.ix, 0, 1e-9) && close(n.iy, -10, 1e-9));
  n.k = "y";
  V.moveHandle(n, "i", 5, 0);
  assert.ok(close(n.ox, -5) && close(n.oy, 0, 1e-9));
  V.moveHandle(n, "o", 0, 7, true);
  assert.equal(n.k, "c");
  assert.ok(close(n.ix, 5) && close(n.iy, 0));
});

test("setKind builds handles between the neighbours; straight drops them", () => {
  const ps = V.fromCmds([["M", 0, 0], ["L", 30, 30], ["L", 60, 0]]);
  V.setKind(ps, 0, 1, "s");
  const n = ps[0].n[1];
  assert.equal(n.k, "s");
  assert.ok(close(n.iy, 30) && n.ix < 30 && n.ox > 30);        // along the line between 0,0 and 60,0
  assert.equal(V.kindOf(n), "y");                                // equal neighbours → equal handles
  V.straight(n);
  assert.deepEqual(V.toCmds(ps).map((c) => c[0]), ["M", "L", "L"]);
  // an end of an open path gets no handle on its open side
  V.setKind(ps, 0, 0, "y");
  assert.ok(close(ps[0].n[0].ix, 0) && close(ps[0].n[0].iy, 0));
});

test("remove, break, join and close", () => {
  let ps = V.fromCmds([["M", 0, 0], ["L", 10, 0], ["L", 10, 10], ["L", 0, 10], ["Z"]]);
  assert.ok(V.breakAt(ps, 0, 2));
  assert.equal(ps[0].closed, false);
  assert.equal(ps[0].n.length, 5);
  assert.ok(close(ps[0].n[0].x, 10) && close(ps[0].n[0].y, 10) && close(ps[0].n[4].x, 10));
  // break an open path in the middle → two paths
  assert.ok(V.breakAt(ps, 0, 2));
  assert.equal(ps.length, 2);
  assert.equal(ps[0].n.length + ps[1].n.length, 6);
  assert.equal(V.breakAt(ps, 0, 0), false);           // an end does not break
  // join them back (the shared point becomes one)
  assert.ok(V.join(ps, { pi: 0, ni: ps[0].n.length - 1 }, { pi: 1, ni: 0 }));
  assert.equal(ps.length, 1);
  assert.equal(ps[0].n.length, 5);
  // close: first and last on the same spot → one point
  assert.ok(V.setClosed(ps, 0, true));
  assert.equal(ps[0].n.length, 4);
  assert.equal(ps[0].closed, true);
  // join two ends of one open path closes it
  ps = V.fromCmds([["M", 0, 0], ["L", 10, 0], ["L", 10, 10]]);
  assert.ok(V.join(ps, { pi: 0, ni: 0 }, { pi: 0, ni: 2 }));
  assert.equal(ps[0].closed, true);
  // join different paths with a gap: a line between them
  ps = V.fromCmds([["M", 0, 0], ["L", 10, 0], ["M", 30, 0], ["L", 40, 0]]);
  assert.ok(V.join(ps, { pi: 0, ni: 0 }, { pi: 1, ni: 1 }));
  assert.deepEqual(V.toCmds(ps), [["M", 10, 0], ["L", 0, 0], ["L", 40, 0], ["L", 30, 0]]);
  // remove: a path left with one point goes, nothing left = null
  ps = V.fromCmds([["M", 0, 0], ["L", 10, 0], ["L", 10, 10], ["M", 50, 50], ["L", 60, 60]]);
  const left = V.removeNodes(ps, { "1:0": 1, "0:1": 1 });
  assert.equal(left.length, 1);
  assert.equal(left[0].n.length, 2);
  assert.equal(V.removeNodes(ps, { "0:0": 1, "0:1": 1, "0:2": 1, "1:0": 1 }), null);
});

test("rect and ellipse outlines, text and pack", () => {
  assert.deepEqual(V.rectCmds(10, 5, 0), [["M", 0, 0], ["L", 10, 0], ["L", 10, 5], ["L", 0, 5], ["Z"]]);
  const rr = V.rectCmds(100, 50, 10);
  const b = V.bounds(rr);
  assert.ok(close(b.w, 100) && close(b.h, 50));
  assert.ok(close(V.bounds(V.ellCmds(80, 40)).w, 80, 1e-9));
  assert.equal(V.text([["M", 0.123456, -0], ["L", 1, 0.5], ["Z"]]), "M0.1235 0L1 0.5Z");
  const big = [];
  for (let i = 0; i < 300; i++) big.push(["C", i / 301, 0.123456, 0.654321, 0.111111, 0.999999, 0.5]);
  big.unshift(["M", 0, 0]);
  const p = V.pack(big, 1e6);
  assert.ok(Array.isArray(p) && p.every((s) => s.length <= 4000));
  assert.equal(V.pack(big, 1000), null);
  assert.equal(typeof V.pack([["M", 0, 0], ["L", 1, 1]], 100), "string");
});

// ---------- designkit/pathedit.js ----------

function fakeHost(opts) {
  const h = {
    k: (opts && opts.k) || 1, made: null, sets: [], begins: 0, ends: 0, exited: 0, said: [],
    toScreen: (x, y) => [x * h.k, y * h.k], toSpace: (sx, sy) => [sx / h.k, sy / h.k],
    begin() { h.begins++; }, end() { h.ends++; },
    set(paths) { if (opts && opts.limit && V.count(paths) > opts.limit) return false; h.sets.push(V.toCmds(paths)); return true; },
    create(paths) { h.made = V.toCmds(paths); return true; },
    exit() { h.exited++; }, redraw() {}, say(s) { h.said.push(s); }, accent: "#09f"
  };
  return h;
}
const ev = (sx, sy, o) => Object.assign({ sx, sy, shift: false, alt: false, touch: false }, o || {});

test("pen: taps make corners, a drag makes a smooth point, the first point closes", () => {
  const h = fakeHost();
  const S = PE.session(h, { mode: "pen" });
  S.down(ev(0, 0)); S.up(ev(0, 0));
  S.down(ev(100, 0)); S.move(ev(120, 30)); S.move(ev(150, 50)); S.up(ev(150, 50));
  S.down(ev(100, 100)); S.up(ev(100, 100));
  assert.equal(S.paths[0].n.length, 3);
  assert.equal(S.paths[0].n[1].k, "y");
  assert.ok(close(S.paths[0].n[1].ix, 50) && close(S.paths[0].n[1].iy, -50));
  S.down(ev(2, 1)); S.up(ev(2, 1));                    // on the first point
  assert.equal(h.exited, 1);
  assert.equal(h.made[h.made.length - 1][0], "Z");
  assert.equal(S.isOpen(), false);
});

test("pen: Enter finishes an open path, Backspace takes the last point back, one point is not a path", () => {
  const h = fakeHost();
  const S = PE.session(h, { mode: "pen" });
  S.down(ev(0, 0)); S.up(ev(0, 0));
  assert.equal(S.key({ key: "Enter" }), true);
  assert.equal(h.made, null);                           // one point: nothing made, still drawing
  assert.ok(h.said.length);
  S.down(ev(50, 0)); S.up(ev(50, 0));
  S.down(ev(50, 50)); S.up(ev(50, 50));
  S.key({ key: "Backspace" });
  assert.equal(S.paths[0].n.length, 2);
  S.key({ key: "Enter" });
  assert.deepEqual(h.made, [["M", 0, 0], ["L", 50, 0]]);
  // Shift keeps the next point at 45° steps
  const h2 = fakeHost();
  const S2 = PE.session(h2, { mode: "pen" });
  S2.down(ev(0, 0)); S2.up(ev(0, 0));
  S2.down(ev(100, 7, { shift: true })); S2.up(ev(100, 7));
  assert.ok(close(S2.paths[0].n[1].y, 0, 1e-9));
  assert.equal(S2.actions().find((a) => a.id === "closeP").disabled, true);
  S2.act("cancel");
  assert.equal(h2.made, null);
  assert.equal(h2.exited, 1);
});

test("nodes: drag a point is one undo step; marquee, kinds and delete", () => {
  const h = fakeHost();
  const S = PE.session(h, { mode: "nodes", cmds: [["M", 0, 0], ["L", 100, 0], ["L", 100, 100], ["L", 0, 100], ["Z"]] });
  assert.equal(S.down(ev(100, 0)), true);
  S.move(ev(110, 5)); S.move(ev(120, 10)); S.up(ev(120, 10));
  assert.equal(h.begins, 1);
  assert.equal(h.ends, 1);
  assert.deepEqual(h.sets[h.sets.length - 1][1], ["L", 120, 10]);
  // marquee (mouse on empty space) picks the two left points
  assert.equal(S.down(ev(-20, -20)), true);
  S.move(ev(30, 130)); S.up(ev(30, 130));
  assert.deepEqual(S.selected().map((e) => e.ni).sort(), [0, 3]);
  S.act("smooth");
  assert.deepEqual(S.actions().find((a) => a.id === "smooth").on, true);
  S.act("del");
  assert.equal(S.paths[0].n.length, 2);
  // deleting what is left is refused
  S.select([{ pi: 0, ni: 0 }, { pi: 0, ni: 1 }]);
  S.act("del");
  assert.equal(S.paths[0].n.length, 2);
  assert.ok(h.said.length);
});

test("nodes: a touch on empty space is the app's (pan), a tap there leaves; double-tap the outline adds a point", () => {
  const h = fakeHost();
  const S = PE.session(h, { mode: "nodes", cmds: [["M", 0, 0], ["L", 100, 0], ["L", 100, 100]] });
  assert.equal(S.down(ev(300, 300, { touch: true })), false);
  S.down(ev(50, 2)); S.up(ev(50, 2));
  S.down(ev(50, 2)); S.up(ev(50, 2));
  assert.equal(S.paths[0].n.length, 4);
  assert.deepEqual(S.selected(), [{ pi: 0, ni: 1 }]);
  S.tapEmpty();                                         // first tap: points let go
  assert.equal(S.selected().length, 0);
  S.tapEmpty();                                         // second: done
  assert.equal(h.exited, 1);
});

test("nodes: a refused write (too many points) puts the outline back", () => {
  const h = fakeHost({ limit: 3 });
  const S = PE.session(h, { mode: "nodes", cmds: [["M", 0, 0], ["L", 100, 0], ["L", 100, 100]] });
  S.select([{ pi: 0, ni: 0 }]);
  S.act("add");
  assert.equal(S.paths[0].n.length, 3);
  assert.ok(h.said.length);
});

test("nodes: break, join, close / open and handles", () => {
  const h = fakeHost();
  const S = PE.session(h, { mode: "nodes", cmds: [["M", 0, 0], ["C", 0, -40, 100, -40, 100, 0], ["L", 100, 50]] });
  S.select([{ pi: 0, ni: 1 }]);
  S.act("break");
  assert.equal(S.paths.length, 2);
  S.select([{ pi: 0, ni: 1 }, { pi: 1, ni: 0 }]);
  assert.equal(S.actions().find((a) => a.id === "join").disabled, false);
  S.act("join");
  assert.equal(S.paths.length, 1);
  S.select([]);
  S.act("closeP");
  assert.equal(S.paths[0].closed, true);
  assert.equal(S.actions().find((a) => a.id === "closeP").label, PE.str("pe.open"));
  // drag the out handle of point 0 (shown once the point is picked)
  S.select([{ pi: 0, ni: 0 }]);
  assert.equal(S.down(ev(0, -40)), true);
  S.move(ev(10, -60)); S.up(ev(10, -60));
  assert.ok(close(S.paths[0].n[0].ox, 10) && close(S.paths[0].n[0].oy, -60));
  S.key({ key: "Escape" });                              // points let go
  assert.equal(h.exited, 0);
  S.key({ key: "Escape" });
  assert.equal(h.exited, 1);
});

test("pathedit strings: English and Greek have the same keys", () => {
  assert.deepEqual(Object.keys(PE.STR.en).sort(), Object.keys(PE.STR.el).sort());
});
