// Pure logic of Breakout: the hand-made levels, the physics step (no
// tunnelling at top speed, paddle angles, walls), brick hits, level
// clear, life loss, power-ups and the records merge.
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

const SRC = fs.readFileSync(path.join(__dirname, "..", "breakout/breakout.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

// cmpStr's cut also takes isInt and rand, the one-liners after it.
const B = (() => {
  const parts = [cut("  var DATA_VER", "  // ---------- 1."), "  function isNum(v) { return typeof v === \"number\" && isFinite(v); }"];
  ["cmpStr", "levelBricks", "levelSpeed", "paddleW", "stuckBall", "freshGame", "copyGame", "bricksLeft",
   "brickAt", "paddleBounce", "launchDir", "hitBrick", "resetBall", "step",
   "normCell", "normRow", "joinCell", "joinRows", "mergeBreakout"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    parts.push(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function("crypto", parts.join("\n") +
    "\nreturn { W, H, R, BCOLS, BROWS, BW, BH, BLEFT, BTOP, PADDLE_Y, PADDLE_W, PADDLE_WIDE, MAX_V, MAX_ANGLE," +
    " LEVELS, DT, LIVES, MAX_LIVES, SLOW_F, levelBricks, levelSpeed, freshGame, bricksLeft, brickAt, paddleBounce," +
    " launchDir, step, mergeBreakout };")(webcrypto);
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
const NONE = { dir: 0, target: null, launch: false };
const emptyBricks = () => new Array(B.BROWS * B.BCOLS).fill(0);
// a game with the ball in flight
const G = (ball, extra) => Object.assign(B.freshGame(true), { ball: Object.assign({ stuck: false, off: 0 }, ball) }, extra || {});
const run = (g, n, R, inp) => {
  const evs = [];
  for (let i = 0; i < n && !g.over; i++) { const r = B.step(g, inp || NONE, R); g = r.g; evs.push(r.ev); }
  return { g, evs };
};

test("breakout: 8 hand-made levels, 12 columns of . 1 2 3, then they repeat faster", () => {
  assert.ok(B.LEVELS.length >= 8);
  B.LEVELS.forEach((rows, i) => {
    assert.ok(rows.length >= 4 && rows.length <= B.BROWS, "level " + i);
    rows.forEach((r) => assert.match(r, /^[.123]{12}$/, "level " + i + " row " + r));
    const b = B.levelBricks(i);
    assert.equal(b.length, B.BROWS * B.BCOLS);
    assert.ok(B.bricksLeft(b) >= 20, "level " + i + " has bricks");
    assert.equal(J(B.levelBricks(i + B.LEVELS.length)), J(b), "repeats");
  });
  // the bricks sit inside the field, above the paddle
  assert.equal(B.BLEFT * 2 + B.BCOLS * B.BW, B.W);
  assert.ok(B.BTOP + B.BROWS * B.BH < B.PADDLE_Y - 150);
  for (let l = 1; l < 8; l++) assert.ok(B.levelSpeed(l) > B.levelSpeed(l - 1));
  for (let l = 0; l < 8; l++) assert.ok(B.levelSpeed(l + 8) > B.levelSpeed(l));
  for (let l = 0; l < 200; l++) assert.ok(B.levelSpeed(l) <= B.MAX_V);
});

test("breakout: the ball waits on the paddle, follows it and launches upward", () => {
  const R = seeded(1);
  let g = B.freshGame(true);
  assert.ok(g.ball.stuck);
  g = run(g, 60, R, { dir: 1, target: null, launch: false }).g;
  assert.ok(g.px > B.W / 2 && Math.abs(g.ball.x - g.px) < 1e-9 && g.ball.stuck);
  // the paddle stops at the wall
  g = run(g, 400, R, { dir: 1, target: null, launch: false }).g;
  assert.equal(g.px, B.W - B.PADDLE_W / 2);
  // pointer target: the paddle goes there
  g = run(g, 60, R, { dir: 0, target: 100, launch: false }).g;
  assert.equal(g.px, 100);
  const r = B.step(g, { dir: 0, target: null, launch: true }, R);
  assert.ok(!r.g.ball.stuck && r.g.ball.dy < -0.9 && r.g.ball.y < g.ball.y);
  for (let k = 0; k < 500; k++) {
    const d = B.launchDir(Math.random);
    const deg = Math.abs(Math.asin(d.dx)) * 180 / Math.PI;
    assert.ok(deg >= 10 - 1e-9 && deg <= 25 + 1e-9 && d.dy < 0);
  }
});

test("breakout: paddle angle depends on where the ball lands", () => {
  const R = seeded(2);
  for (const [rel, sign] of [[0, 0], [0.5, 1], [-0.5, -1], [1, 1], [-1, -1]]) {
    const pw = B.PADDLE_W;
    const g = G({ x: B.W / 2 + rel * (pw / 2 + B.R), y: B.PADDLE_Y - B.R - 4, dx: 0, dy: 1 }, { px: B.W / 2 });
    const out = run(g, 4, R);
    assert.ok(out.evs.some((e) => e.paddle), "bounced at " + rel);
    const b = out.g.ball;
    assert.ok(b.dy < 0);
    assert.equal(Math.sign(Math.round(b.dx * 1000)), sign, "rel " + rel);
    const ang = Math.asin(Math.abs(b.dx));
    assert.ok(Math.abs(ang - Math.abs(rel) * B.MAX_ANGLE) < 0.03, "angle " + ang);
  }
  assert.ok(Math.abs(B.paddleBounce(5).dx - Math.sin(B.MAX_ANGLE)) < 1e-12, "clamped at 60°");
  // a ball going up through the paddle zone is not bounced
  const up = G({ x: B.W / 2, y: B.PADDLE_Y + 4, dx: 0, dy: -1 }, { px: B.W / 2 });
  assert.ok(!run(up, 3, R).evs.some((e) => e.paddle));
});

test("breakout: walls reflect and keep the ball inside", () => {
  const R = seeded(3);
  let g = G({ x: 20, y: 300, dx: -Math.sin(0.5), dy: -Math.cos(0.5) }, { bricks: emptyBricks() });
  g.bricks[0] = 1;                                     // keep the level from clearing
  const out = run(g, 30, R);
  assert.ok(out.evs.some((e) => e.wall));
  assert.ok(out.g.ball.dx > 0 && out.g.ball.x >= B.R);
  // the top wall
  let t = G({ x: 240, y: 20, dx: 0.3, dy: -Math.sqrt(1 - 0.09) }, { bricks: emptyBricks() });
  t.bricks[B.BCOLS * B.BROWS - 1] = 1;
  t = run(t, 10, R).g;
  assert.ok(t.ball.dy > 0 && t.ball.y >= B.R);
});

test("breakout: no tunnelling at top speed, from any angle", () => {
  const R = seeded(4);
  for (let k = 0; k < 600; k++) {
    const bricks = emptyBricks();
    const row = 2 + Math.floor(R() * 7), col = Math.floor(R() * B.BCOLS);
    bricks[row * B.BCOLS + col] = 1;
    const bx = B.BLEFT + col * B.BW, by = B.BTOP + row * B.BH;
    // aim at a random point of the brick from below, at a random angle up to 60°
    const a = (R() * 2 - 1) * B.MAX_ANGLE, tx = bx + R() * B.BW, ty = by + R() * B.BH;
    const dist = 120 + R() * 200;
    const dx = Math.sin(a), dy = -Math.cos(a);
    const sx = tx - dx * dist, sy = ty - dy * dist;
    if (sx < B.R + 1 || sx > B.W - B.R - 1) continue;
    let g = G({ x: sx, y: sy, dx, dy }, { bricks, speed: B.MAX_V });
    // the brick is not touched yet at the start
    if (B.brickAt(bricks, sx, sy) >= 0) continue;
    let hit = false;
    for (let s = 0; s < 400 && !hit; s++) {
      const r = B.step(g, NONE, R);
      g = r.g;
      if (r.ev.hits) hit = true;
      else {
        // the ball box never got past the brick without a hit
        assert.ok(!(g.ball.x > bx - B.R && g.ball.x < bx + B.BW + B.R && g.ball.y + B.R < by && g.ball.dy < 0 && Math.abs(g.ball.x - tx) < 3),
          "tunnelled through brick " + J({ k, a, sx, sy, tx, ty }));
      }
      assert.equal(B.brickAt(g.bricks, g.ball.x, g.ball.y), -1, "ball inside a brick");
    }
    assert.ok(hit, "hit the brick (case " + k + ")");
  }
});

test("breakout: bricks take 1–3 hits, 10 points a hit", () => {
  const R = seeded(5);
  const bricks = emptyBricks();
  bricks[5 * B.BCOLS + 6] = 3;
  bricks[0] = 1;                                       // another brick so the level goes on
  let g = G({ x: B.BLEFT + 6.5 * B.BW, y: B.BTOP + 9 * B.BH, dx: 0, dy: -1 }, { bricks, pow: false });
  let hits = 0, broke = 0;
  for (let s = 0; s < 3000 && broke === 0; s++) {
    const r = B.step(g, { dir: 0, target: g.ball.x, launch: false }, R);   // the paddle follows the ball
    g = r.g; hits += r.ev.hits; broke += r.ev.broke;
    if (r.ev.hits && !r.ev.broke) assert.ok(g.bricks[5 * B.BCOLS + 6] > 0);
  }
  assert.equal(hits, 3);
  assert.equal(broke, 1);
  assert.equal(g.bricks[5 * B.BCOLS + 6], 0);
  assert.equal(g.score, 30);
  assert.equal(bricks[5 * B.BCOLS + 6], 3, "input untouched");
});

test("breakout: clearing the last brick starts the next level", () => {
  const R = seeded(6);
  const bricks = emptyBricks();
  bricks[3 * B.BCOLS + 2] = 1;
  const g = G({ x: B.BLEFT + 2.5 * B.BW, y: B.BTOP + 3 * B.BH + 40, dx: 0, dy: -1 }, { bricks, score: 50, level: 0, wideT: 5, caps: [{ x: 10, y: 10, k: "w" }] });
  const out = run(g, 200, R);
  const ev = out.evs.find((e) => e.cleared);
  assert.ok(ev, "cleared");
  const n = out.g;
  assert.equal(n.level, 1);
  assert.equal(J(n.bricks), J(B.levelBricks(1)));
  assert.equal(n.score, 50 + 10 + 100);
  assert.ok(n.ball.stuck && n.caps.length === 0 && n.wideT === 0);
  assert.equal(n.speed, B.levelSpeed(1));
  // level 8 → 9 repeats level 1's bricks, faster
  const g8 = G({ x: B.BLEFT + 2.5 * B.BW, y: B.BTOP + 3 * B.BH + 40, dx: 0, dy: -1 }, { bricks, level: 7 });
  const n8 = run(g8, 200, R).g;
  assert.equal(n8.level, 8);
  assert.equal(J(n8.bricks), J(B.levelBricks(0)));
  assert.ok(n8.speed > B.levelSpeed(0));
});

test("breakout: a missed ball costs a life; the last one ends the game", () => {
  const R = seeded(7);
  const g = G({ x: 30, y: B.PADDLE_Y + 30, dx: 0, dy: 1 }, { px: B.W - 60, lives: 3, slowT: 4 });
  const out = run(g, 200, R);
  const lost = out.evs.filter((e) => e.lost);
  assert.equal(lost.length, 1);
  assert.equal(out.g.lives, 2);
  assert.ok(out.g.ball.stuck && !out.g.over && out.g.slowT === 0);
  const last = run(G({ x: 30, y: B.PADDLE_Y + 30, dx: 0, dy: 1 }, { px: B.W - 60, lives: 1 }), 200, R);
  assert.ok(last.g.over && last.evs.some((e) => e.over));
  assert.equal(last.g.lives, 0);
  // a finished game does not move any more
  const r = B.step(last.g, { dir: 1, target: null, launch: true }, R);
  assert.equal(r.g, last.g);
});

test("breakout: power-ups widen the paddle, slow the ball, add a life (max 5)", () => {
  const R = seeded(8);
  const cap = (k, extra) => G({ x: 240, y: 200, dx: 0, dy: -1 }, Object.assign({ px: 240, caps: [{ x: 240, y: B.PADDLE_Y - 30, k }] }, extra || {}));
  let out = run(cap("w"), 40, R);
  assert.ok(out.evs.some((e) => e.caught === "w") && out.g.wideT > 0);
  // wide lasts 15 s
  const wide = run(out.g, Math.ceil(16 / B.DT), R, { dir: 0, target: out.g.ball.x, launch: false });
  assert.equal(wide.g.wideT, 0, "wide paddle ends after 15 s");
  out = run(cap("s"), 40, R);
  assert.ok(out.g.slowT > 0);
  const y0 = out.g.ball.y, y1 = B.step(out.g, NONE, R).g.ball.y;
  assert.ok(Math.abs(Math.abs(y1 - y0) - out.g.speed * B.SLOW_F * B.DT) < 1e-6, "slow ball");
  out = run(cap("l", { lives: 3 }), 40, R);
  assert.equal(out.g.lives, 4);
  out = run(cap("l", { lives: 5 }), 40, R);
  assert.equal(out.g.lives, B.MAX_LIVES);
  // missed capsules fall off the bottom
  out = run(Object.assign(cap("w"), { px: 40 }), 400, R, { dir: 0, target: 40, launch: false });
  assert.equal(out.g.caps.length, 0);
  assert.equal(out.g.wideT, 0);
});

test("breakout: long games keep the ball sane; no power-ups when they are off", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const R = seeded(seed);
    let g = B.freshGame(seed % 2 === 0), caps = 0, levels = 0;
    for (let s = 0; s < 40000 && !g.over; s++) {
      // a bot that follows the ball (a little off-centre) and launches at once
      const r = B.step(g, { dir: 0, target: g.ball.x + 10 * Math.sin(s / 300), launch: true }, R);
      g = r.g;
      if (r.ev.cleared) levels++;
      caps += g.caps.length;
      const b = g.ball;
      assert.ok(Math.abs(b.dx * b.dx + b.dy * b.dy - 1) < 1e-9);
      assert.ok(b.x >= B.R - 1e-9 && b.x <= B.W - B.R + 1e-9);
      assert.ok(Math.abs(b.dy) >= 0.49 || b.stuck, "never a flat ball");
      assert.ok(g.speed <= B.MAX_V);
      assert.equal(B.brickAt(g.bricks, b.x, b.y), -1);
    }
    if (seed % 2) assert.equal(caps, 0, "no capsules with power-ups off");
    assert.ok(g.score > 0);
  }
});

test("breakout: records merge is a join and a reset drops older rows", () => {
  const M = B.mergeBreakout, keys = ["p1", "p0"];
  const st = () => {
    const rows = {};
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      keys.forEach((k) => { if (rnd(2) === 0) s[k] = { n: rnd(5) * 100, ts: rnd(3) * 1000, v: 1 + rnd(9), g: 1 + rnd(9) }; });
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
  const x = { rows: { d: { b: 0, s: { p1: { n: 900, ts: 500, v: 3, g: 3 } } } } };
  const y = { rows: { d: { b: 0, s: { p1: { n: 900, ts: 300, v: 2, g: 5 }, p0: { n: 10, ts: 1, v: 1, g: 1 } } } } };
  assert.equal(J(M(x, y).rows.d.s), J({ p1: { n: 900, ts: 300, v: 3, g: 5 }, p0: { n: 10, ts: 1, v: 1, g: 1 } }));
  assert.equal(J(M(x, { br: 5, rows: {} }).rows), "{}");
  for (const bad of [{ n: 1, ts: 1, v: 0, g: 1 }, { n: 1, ts: 1, v: 1, g: 0 }, { n: -1, ts: 1, v: 1, g: 1 }, { n: 1, ts: 1, g: 1 }]) {
    assert.equal(J(M({ rows: { d: { b: 0, s: { p1: bad } } } }, null).rows), "{}", J(bad));
  }
  assert.equal(J(M({ rows: { d: { b: 0, s: { px: { n: 1, ts: 1, v: 1, g: 1 } } } } }, null).rows), "{}");
});
