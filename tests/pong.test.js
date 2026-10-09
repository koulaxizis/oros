// Pure logic of Pong: the serve (alternating), the physics step (walls,
// paddle angles, speed-up, no tunnelling at top speed), scoring and the
// end of a game, the computer's limits (reaction, error, top speed:
// beatable) and the records merge.
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

const SRC = fs.readFileSync(path.join(__dirname, "..", "pong/pong.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

const P = (() => {
  const parts = [cut("  var DATA_VER", "  // ---------- 1."), "  var MAX_TO = 11, MAX_N = 999999;"];
  ["cmpStr", "isInt", "isNum", "freshGame", "copyGame", "clampPaddle", "serveDir", "predictY", "predictHit",
   "paddleBounce", "aiMove", "scorePoint", "step",
   "normCell", "normRow", "joinCell", "joinRows", "mergePong"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    const j = SRC.indexOf("\n  }\n", i), k = SRC.indexOf("\n", i);
    // one-line helpers end on their own line
    parts.push(SRC.slice(i, SRC.slice(i, k).trim().endsWith("}") ? k + 1 : j + 4));
  });
  return new Function("crypto", parts.join("\n") +
    "\nreturn { W, H, PX, PW, PH, BR, DT, SERVE_V, MAX_V, HIT_UP, MAX_BOUNCE, SERVE_ANGLE, KEY_V, WAIT, AI," +
    " freshGame, predictY, predictHit, paddleBounce, step, mergePong };")(webcrypto);
})();

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);
function seeded(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const NONE = { dir: [0, 0], target: [null, null] };
const FACE0 = P.PX + P.PW, FACE1 = P.W - P.PX - P.PW;
const WAIT_STEPS = Math.ceil(P.WAIT / P.DT) + 1;
// a 2-player game with the ball in flight
const G = (ball, extra) => Object.assign(P.freshGame("2", 7, false), { wait: 0, ball }, extra || {});
const vel = (deg, v, side) => ({ vx: (side ? -1 : 1) * Math.cos(deg * Math.PI / 180) * v, vy: Math.sin(deg * Math.PI / 180) * v });
const run = (g, n, R, inp) => {
  const evs = [];
  for (let i = 0; i < n && !g.over; i++) { const r = P.step(g, typeof inp === "function" ? inp(g) : (inp || NONE), R); g = r.g; evs.push(r.ev); }
  return { g, evs };
};

test("pong: the serve waits, then leaves from the centre toward the other side", () => {
  const R = seeded(1);
  for (const first of [false, true]) {
    let g = P.freshGame("2", 7, first);
    assert.equal(g.serve, first ? 1 : 0);
    const out = run(g, WAIT_STEPS, R);
    const k = out.evs.findIndex((e) => e.serve);
    assert.ok(k > 0 && Math.abs((k + 1) * P.DT - P.WAIT) < 2 * P.DT, "serve after the wait");
    const b = out.g.ball, v = Math.hypot(b.vx, b.vy);
    assert.ok(Math.abs(v - P.SERVE_V) < 1e-9);
    assert.equal(Math.sign(b.vx), first ? -1 : 1, "toward the receiver");
    assert.ok(Math.abs(Math.atan2(b.vy, Math.abs(b.vx))) <= P.SERVE_ANGLE + 1e-9);
  }
  // paddles move while the ball waits; the ball stays in the middle
  const w = run(P.freshGame("2", 7, false), 20, R, { dir: [1, -1], target: [null, null] }).g;
  assert.ok(w.py[0] > P.H / 2 && w.py[1] < P.H / 2 && w.ball.x === P.W / 2 && w.ball.vx === 0);
});

test("pong: walls reflect; the paddle angle depends on where the ball meets it", () => {
  const R = seeded(2);
  let g = run(G({ x: 400, y: 30, ...vel(-40, 500, 0) }), 20, R).g;
  assert.ok(g.ball.vy > 0 && g.ball.y >= P.BR);
  g = run(G({ x: 400, y: P.H - 30, ...vel(40, 500, 1) }), 20, R).g;
  assert.ok(g.ball.vy < 0 && g.ball.y <= P.H - P.BR);
  for (const side of [0, 1]) {
    for (const rel of [-1, -0.5, 0, 0.5, 1]) {
      const py = 250, y = py + rel * (P.PH / 2 + P.BR);
      const x = side ? FACE1 - P.BR - 30 : FACE0 + P.BR + 30;
      const g0 = G({ x, y, vx: side ? 600 : -600, vy: 0 }, { py: [py, py], v: 600 });
      const out = run(g0, 20, R);
      assert.ok(out.evs.some((e) => e.hit === side), "hit " + side + " " + rel);
      const b = out.g.ball;
      assert.equal(Math.sign(b.vx), side ? -1 : 1, "goes back");
      const ang = Math.atan2(b.vy, Math.abs(b.vx));
      assert.ok(Math.abs(ang - rel * P.MAX_BOUNCE) < 0.03, "angle " + ang + " for " + rel);
      assert.ok(Math.abs(out.g.v - 600 * P.HIT_UP) < 1e-9, "faster after a return");
      assert.ok(Math.abs(Math.hypot(b.vx, b.vy) - out.g.v) < 1e-6);
    }
  }
  // the speed-up stops at the top speed
  const fast = run(G({ x: FACE0 + 40, y: 250, vx: -P.MAX_V, vy: 0 }, { py: [250, 250], v: P.MAX_V }), 20, R);
  assert.ok(fast.evs.some((e) => e.hit === 0) && fast.g.v === P.MAX_V);
  // a ball moving away through the paddle line is not bounced back
  const away = run(G({ x: FACE0 - 2, y: 250, vx: 300, vy: 0 }, { py: [250, 250] }), 5, R);
  assert.ok(!away.evs.some((e) => e.hit >= 0) && away.g.ball.vx > 0);
});

test("pong: no tunnelling through a paddle at top speed", () => {
  const R = seeded(3);
  for (let k = 0; k < 2000; k++) {
    const side = k % 2, py = 60 + R() * (P.H - 120);
    // aim at a random point of the paddle face from 100–300 units away
    const ty = py + (R() * 2 - 1) * (P.PH / 2 + P.BR - 0.5), deg = (R() * 2 - 1) * 54;
    const dist = 100 + R() * 200, a = deg * Math.PI / 180;
    const fx = side ? FACE1 - P.BR : FACE0 + P.BR;
    const sx = fx - (side ? 1 : -1) * Math.cos(a) * dist, sy = ty - Math.sin(a) * dist;
    if (sy < P.BR + 1 || sy > P.H - P.BR - 1) continue;
    const g = G({ x: sx, y: sy, vx: (side ? 1 : -1) * Math.cos(a) * P.MAX_V, vy: Math.sin(a) * P.MAX_V }, { py: [py, py], v: P.MAX_V });
    // skip shots that bounce off a wall before they arrive
    const ny = sy + Math.sin(a) * dist;
    if (ny < P.BR || ny > P.H - P.BR) continue;
    const out = run(g, 80, R);
    assert.ok(out.evs.some((e) => e.hit === side), "missed the paddle " + J({ k, side, py, ty, deg }));
    assert.ok(!out.evs.some((e) => e.point >= 0), "no point " + k);
  }
});

test("pong: a ball past a paddle scores; the serve alternates; first to 7 or 11 wins", () => {
  const R = seeded(4);
  // past the left paddle: a point for the right
  let out = run(G({ x: 100, y: 40, vx: -500, vy: 0 }, { py: [400, 250] }), 120, R);
  const ev = out.evs.find((e) => e.point >= 0);
  assert.equal(ev.point, 1);
  assert.equal(J(out.g.s), J([0, 1]));
  assert.ok(out.g.wait > 0 && out.g.ball.x === P.W / 2 && out.g.v === P.SERVE_V);
  // serve alternates: 0 served first, now 1 serves
  assert.equal(out.g.serve, 1);
  out = run(out.g, WAIT_STEPS, R);
  assert.ok(out.g.ball.vx < 0, "right serves toward the left");
  // nobody moves: every serve goes out on the receiver's side, alternating
  for (const to of [7, 11]) {
    let g = P.freshGame("2", to, false), serves = [];
    for (let s = 0; s < 20000 && !g.over; s++) {
      // each paddle runs away from the ball so every serve scores
      const r = P.step(g, { dir: [0, 0], target: [g.ball.y < 250 ? 1e9 : -1e9, g.ball.y < 250 ? 1e9 : -1e9] }, R);
      if (r.ev.serve) serves.push(r.g.serve);
      g = r.g;
    }
    assert.ok(g.over);
    assert.ok(g.s[0] === to || g.s[1] === to);
    assert.equal(g.winner, g.s[0] === to ? 0 : 1);
    serves.forEach((s, i) => assert.equal(s, i % 2, "serve " + i));
    assert.equal(Math.abs(g.s[0] - g.s[1]) <= to, true);
    // a finished game does not move any more
    const r = P.step(g, { dir: [1, 1], target: [null, null] }, R);
    assert.equal(r.g, g);
  }
  // the input game is never changed
  const g0 = G({ x: 100, y: 40, vx: -500, vy: 0 }), s0 = J(g0);
  run(g0, 50, R);
  assert.equal(J(g0), s0);
});

test("pong: predictY matches the ball's real path with wall bounces", () => {
  const R = seeded(5);
  for (let k = 0; k < 300; k++) {
    const deg = 10 + R() * 44, v = 400 + R() * 600, y = 30 + R() * 440;
    const g = G({ x: 200, y, ...vel((R() < 0.5 ? -1 : 1) * deg, v, 0) }, { v });
    const tx = FACE1 - P.BR, want = P.predictY(g.ball.x, g.ball.y, g.ball.vx, g.ball.vy, tx);
    // the right paddle moves away from the arrival point so it does not interfere
    let cur = g;
    for (let s = 0; s < 2000; s++) {
      const r = P.step(cur, { dir: [0, 0], target: [null, want > P.H / 2 ? 0 : 1e9] }, R);
      if (r.g.ball.x >= tx || r.ev.point >= 0) {
        // crossed the line in this step: compare at the crossing
        const b0 = cur.ball, b1 = r.g.ball;
        const f = (tx - b0.x) / (b1.x - b0.x);
        assert.ok(r.ev.point < 0 && f >= 0 && f <= 1);
        const yy = b0.y + (b1.y - b0.y) * f;
        assert.ok(Math.abs(yy - want) < 2, "predicted " + want + " got " + yy);
        break;
      }
      cur = r.g;
    }
  }
});

test("pong: the computer reacts late, aims with an error and has a top speed", () => {
  for (const lv of ["e", "m", "h"]) {
    const p = P.AI[lv], R = seeded(6);
    let g = Object.assign(P.freshGame(lv, 7, false), { wait: 0, ball: { x: 300, y: 50, ...vel(35, 700, 0) }, v: 700 });
    let aims = 0, lastTy = g.ai.ty, lastChange = -1e9;
    for (let s = 0; s < 3000 && !g.over; s++) {
      const prev = g;
      // the left paddle follows the ball perfectly so rallies go on
      const r = P.step(g, { dir: [0, 0], target: [g.ball.y, null] }, R);
      g = r.g;
      if (r.ev.point >= 0) { lastChange = -1e9; lastTy = g.ai.ty; continue; }   // it looks again at once
      const moved = Math.abs(g.py[1] - prev.py[1]);
      assert.ok(moved <= p.v * P.DT + 1e-9, lv + ": paddle too fast " + moved);
      if (g.ai.ty !== lastTy) {
        assert.ok((s - lastChange) * P.DT >= p.react - P.DT - 1e-9 || lastChange < 0, lv + ": looked again too soon");
        lastChange = s; lastTy = g.ai.ty; aims++;
      }
    }
    assert.ok(aims > 5, lv + " aims");
  }
  // the computer ignores the inputs of the right paddle
  const R = seeded(7);
  const a = run(P.freshGame("h", 7, false), 30, R, { dir: [0, 1], target: [null, 0] }).g;
  assert.ok(Math.abs(a.py[1] - P.H / 2) < P.AI.h.err, "vs Computer the right paddle is the computer's");
  // 2 players: the right paddle obeys its keys
  const b = run(P.freshGame("2", 7, false), 30, R, { dir: [0, 1], target: [null, null] }).g;
  assert.ok(Math.abs(b.py[1] - (P.H / 2 + 30 * P.KEY_V * P.DT)) < 1e-6);
});

test("pong: every level is beatable, and harder levels concede fewer points", () => {
  // a fair human player: looks again every 0.2 s, misjudges by up to
  // ±30 (more after a wall bounce), aims a little off-centre to angle
  // the ball toward the far wall, and moves at most 600 units / s
  const human = (R) => {
    let t = 0, ty = P.H / 2;
    return (g) => {
      const b = g.ball;
      t -= P.DT;
      if (t <= 0) {
        t = 0.2;
        if (g.wait <= 0 && b.vx < 0) {
          const h = P.predictHit(b.x, b.y, b.vx, b.vy, FACE0 + P.BR);
          ty = h.y + (R() * 2 - 1) * 30 * (1 + h.b) + (h.y < P.H / 2 ? -1 : 1) * 30;
        } else ty = P.H / 2;
      }
      const d = ty - g.py[0], lim = 600 * P.DT;
      return { dir: [0, 0], target: [g.py[0] + Math.max(-lim, Math.min(lim, d)), null] };
    };
  };
  const share = {};
  for (const lv of ["e", "m", "h"]) {
    let you = 0, cpu = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const R = seeded(7 * seed + 1);
      const out = run(P.freshGame(lv, 7, seed % 2 === 0), 400000, R, human(seeded(seed)));
      assert.ok(out.g.over, lv + ": the game ends");
      you += out.g.s[0]; cpu += out.g.s[1];
    }
    share[lv] = you / (you + cpu);
  }
  assert.ok(share.h > 0.05, "hard is beatable: " + J(share));
  assert.ok(share.e > 0.6, "easy is easy: " + J(share));
  assert.ok(share.e > share.m && share.m > share.h, "easy > medium > hard: " + J(share));
  // and the computer returns the ball and wins against a player who
  // stays in a corner
  for (const lv of ["e", "m", "h"]) {
    const out = run(P.freshGame(lv, 7, false), 200000, seeded(9), { dir: [0, 0], target: [0, null] });
    assert.ok(out.g.over && out.g.winner === 1, lv + ": the computer wins " + J(out.g.s));
    assert.ok(out.evs.some((e) => e.hit === 1), lv + ": the computer returns the ball");
  }
});

test("pong: records merge is a join and a reset drops older rows", () => {
  const M = P.mergePong, levels = ["e", "m", "h"];
  const st = () => {
    const rows = {};
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      levels.forEach((k) => {
        if (rnd(2) === 0) {
          const w = rnd(4), l = rnd(4) + (w ? 0 : 1);
          s[k] = { w, l, m: w ? rnd(8) : 0, ts: rnd(3) * 1000 };
        }
      });
      if (rnd(2) === 0) s.p2 = { g: 1 + rnd(9) };
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
  const x = { rows: { d: { b: 0, s: { m: { w: 3, l: 1, m: 4, ts: 500 }, p2: { g: 2 } } } } };
  const y = { rows: { d: { b: 0, s: { m: { w: 2, l: 5, m: 4, ts: 300 }, h: { w: 0, l: 1, m: 0, ts: 0 } } } } };
  assert.equal(J(M(x, y).rows.d.s), J({ m: { w: 3, l: 5, m: 4, ts: 300 }, h: { w: 0, l: 1, m: 0, ts: 0 }, p2: { g: 2 } }));
  // a newer epoch replaces the row; a reset stamp drops older rows
  assert.equal(J(M(x, { rows: { d: { b: 5, s: { p2: { g: 1 } } } } }).rows.d), J({ b: 5, s: { p2: { g: 1 } } }));
  assert.equal(J(M(x, { br: 5, rows: {} }).rows), "{}");
  for (const bad of [{ w: 0, l: 0, m: 0, ts: 0 }, { w: 0, l: 1, m: 2, ts: 1 }, { w: 1, l: 0, m: 12, ts: 1 },
                     { w: -1, l: 2, m: 0, ts: 0 }, { w: 1, l: 0, m: 1 }, { w: 1.5, l: 0, m: 1, ts: 1 }]) {
    assert.equal(J(M({ rows: { d: { b: 0, s: { e: bad } } } }, null).rows), "{}", J(bad));
  }
  assert.equal(J(M({ rows: { d: { b: 0, s: { p2: { g: 0 } } } } }, null).rows), "{}");
  assert.equal(J(M({ rows: { d: { b: 0, s: { x: { g: 1 } } } } }, null).rows), "{}");
  assert.equal(J(M({ rows: { d: { b: -1, s: { p2: { g: 1 } } } } }, null).rows), "{}");
});
