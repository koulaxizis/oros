// Caravan: the rules engine (caravan/engine.js, a module): the routes,
// the plan (hire, order, upgrade, sell), fork signs and splitting, no
// overtaking, aiming, the tricks, the mender, trips and the end of a
// route, the session copy and the sync merge.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../caravan/engine.js");

const J = JSON.stringify;

function roll(g, max) {
  for (let n = 0; g.ph === "go" && g.over < 0 && n < (max || 60 * 600); n++) { E.step(g); g.ev.length = 0; }
  return g;
}
// Every way the signs can be set (goat track only when open).
function combos(g) {
  const rt = E.ROUTE[g.rt];
  let out = [{}];
  rt.forks.forEach((f) => {
    const nx = [];
    out.forEach((o) => rt.out[f].forEach((e, j) => { if (g.goat || !rt.E[e].goat) nx.push(Object.assign({}, o, { [f]: j })); }));
    out = nx;
  });
  return out;
}
// A plain player: mules and ponies in turn with all its coins, level 2,
// and before each trip the signs that bring the most crates home.
function player(g) {
  for (let i = 0; i < 20; i++) {
    const k = g.cv.filter((c) => c.k === "mule").length <= g.cv.filter((c) => c.k === "pony").length ? "mule" : "pony";
    if (!E.hire(g, k) && !E.hire(g, "pony")) break;
  }
  g.cv.forEach((c) => { if (c.l === 1) E.upgrade(g, c.id, ""); });
  let best = null, bv = -1;
  combos(g).forEach((s) => {
    const c = E.clone(g);
    Object.keys(s).forEach((n) => E.setSign(c, n, s[n]));
    E.setOff(c); roll(c);
    if (c.tg > bv) { bv = c.tg; best = s; }
  });
  Object.keys(best).forEach((n) => E.setSign(g, n, best[n]));
}
function play(rt, diff, plan) {
  const g = E.newRun(rt, diff);
  while (g.over < 0) {
    plan(g);
    if (!E.setOff(g)) return g;
    roll(g);
  }
  return g;
}

test("caravan: four routes of the Salt road and four of the Spice road, each a road from the gate to a market", () => {
  assert.deepEqual(E.ROUTES.map((r) => r.id), ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"]);
  E.ROUTES.forEach((rt) => {
    assert.ok(rt.P.S && rt.P.M, rt.id);
    assert.equal(rt.two, rt.idx >= 4, rt.id + " two markets on the Spice road");
    // every way from the gate reaches a market, no loops
    const walk = (n, seen) => {
      if (E.isEnd(n)) return 1;
      assert.ok(rt.out[n].length, rt.id + " dead end at " + n);
      return rt.out[n].reduce((s, e) => { assert.ok(!seen.has(rt.E[e].b), rt.id + " loop"); return s + walk(rt.E[e].b, new Set([...seen, n])); }, 0);
    };
    assert.ok(walk("S", new Set()) >= 2, rt.id + " has a choice");
    rt.E.forEach((e) => e.pts.forEach((p) => assert.ok(p.x > 0 && p.x < E.COLS && p.y > 0 && p.y < E.ROWS)));
    rt.M.forEach((m) => assert.ok(E.MACHINES[m.k] && m.t >= 1 && m.t <= E.TRIPS));
    assert.ok(rt.M.some((m) => m.t === 1) && rt.M.some((m) => m.t === 2) && rt.M.some((m) => m.t === 3), rt.id + " machines on every trip");
  });
  assert.ok(E.ROUTE.r2.hasGoat && E.ROUTE.r4.hasGoat && !E.ROUTE.r1.hasGoat);
  // no machine stands on the road, and each spice route reaches both markets
  E.ROUTES.forEach((rt) => {
    const road = new Set();
    rt.E.forEach((e) => {
      for (let k = 1; k < e.pts.length; k++) {
        const a = e.pts[k - 1], b = e.pts[k], n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 4);
        for (let i = 0; i <= n; i++) road.add(Math.floor(a.x + (b.x - a.x) * i / n) + "," + Math.floor(a.y + (b.y - a.y) * i / n));
      }
    });
    rt.M.forEach((m) => assert.ok(!road.has(Math.floor(m.x) + "," + Math.floor(m.y)), rt.id + " machine on the road at " + m.x + "," + m.y));
    if (rt.two) assert.deepEqual([...new Set(rt.E.map((e) => e.b).filter(E.isEnd))].sort(), ["M", "N"], rt.id);
  });
});

test("caravan: the Spice road: the spice market pays three coins a crate, both markets count", () => {
  const g = E.newRun("r5", "n");
  assert.equal(g.u, 5);
  assert.equal(E.whyNot(g, "smith"), "");
  E.hire(g, "mule"); E.hire(g, "pony");
  const coins = g.coins;
  // A → C → N: both carts go to the spice market
  E.setSign(g, "A", 1);
  assert.equal(E.ROUTE.r5.E[E.wayNow(g).slice(-1)[0]].b, "N");
  E.setOff(g);
  const ends = [];
  for (let n = 0; g.ph === "go" && n < 60 * 600; n++) { E.step(g); g.ev.forEach((x) => { if (x.e === "home") ends.push(x.at); }); g.ev.length = 0; }
  assert.deepEqual(ends, ["N", "N"]);
  assert.ok(g.got > 0);
  assert.equal(g.coins, coins + g.got * E.PAY_N + E.TRIP_PAY);
  assert.equal(E.newRun("r4", "n").u, 4);
  assert.equal(E.whyNot(E.newRun("r4", "n"), "smith"), "locked");
});

test("caravan: the smith jams the nearest working machine it passes, then rests", () => {
  const rt = E.ROUTE.r5;
  const g = E.newRun("r5", "n");
  g.coins = 999;
  const sm = E.hire(g, "smith"), mu = E.hire(g, "mule");
  E.setSign(g, "A", 0);                   // A → B: past the arm at (4, 6)
  E.setOff(g);
  let jam = null;
  for (let n = 0; g.ph === "go" && n < 60 * 120 && !jam; n++) { E.step(g); jam = g.ev.find((x) => x.e === "jam"); g.ev.length = 0; }
  assert.ok(jam, "the smith jammed a machine");
  assert.equal(jam.c, sm.id);
  assert.equal(rt.M[jam.m].k, "arm");
  assert.ok(g.mc[jam.m].st >= E.CARTS.smith.st[1].jt - 1 && g.mc[jam.m].st <= E.CARTS.smith.st[1].jt);
  assert.equal(E.working(g, jam.m), false);
  assert.equal(sm.j, E.CARTS.smith.st[1].rest);
  // a jammed machine does not swing while it is stopped
  for (let n = 0; n < 60 * 3; n++) { E.step(g); assert.ok(!g.ev.some((x) => x.e === "swing" && x.m === jam.m)); g.ev.length = 0; }
  assert.ok(g.mc[jam.m].st > 0);
  // a jammed lookout does not help, a jammed mud wheel does not slow
  const h = E.newRun("r6", "n");
  h.trip = 3;
  const R6 = E.ROUTE.r6;
  let li = -1, near = -1;
  R6.M.forEach((m, i) => { if (m.k !== "look" || near >= 0) return; R6.M.forEach((o, j) => { if (near < 0 && j !== i && Math.hypot(m.x - o.x, m.y - o.y) <= 2) { li = i; near = j; } }); });
  assert.ok(near >= 0, "a machine near a lookout on r6");
  assert.equal(E.looked(h, R6, near), true);
  h.mc[li].st = 10;
  assert.equal(E.looked(h, R6, near), false);
  assert.ok(mu);
});

test("caravan: plan: hire, order, upgrade, branches, sell back in full before setting off", () => {
  const g = E.newRun("r1", "n");
  assert.equal(g.coins, 100);
  assert.equal(E.whyNot(g, "mender"), "locked");
  const a = E.hire(g, "mule"), b = E.hire(g, "pony");
  assert.equal(g.coins, 45);
  assert.deepEqual(g.cv.map((c) => c.k), ["mule", "pony"]);
  assert.ok(E.moveCart(g, b.id, -1));
  assert.deepEqual(g.cv.map((c) => c.k), ["pony", "mule"]);
  assert.equal(E.moveCart(g, b.id, -1), false, "already in front");
  assert.ok(E.upgrade(g, a.id, ""));
  assert.equal(a.l, 2); assert.equal(a.hp, 13);
  assert.equal(E.upgrade(g, a.id, ""), false, "level 3 needs a branch");
  g.coins = 100;
  assert.ok(E.upgrade(g, a.id, "a"));
  assert.equal(E.stats(a).cap, 18);
  assert.equal(E.sellValue(a), 30 + 18 + 30, "all of it before setting off");
  E.setOff(g);
  assert.equal(E.hire(g, "pony"), null, "no hiring on the road");
  assert.equal(E.whyNot(g, "pony"), "phase");
  const full = E.newRun("r1", "m");
  full.coins = 999;
  for (let i = 0; i < 9; i++) E.hire(full, "pony");
  assert.equal(full.cv.length, E.MAX_CARTS);
  assert.equal(E.whyNot(full, "pony"), "full");
});

test("caravan: nothing hired, nothing goes; an empty plan loses the route", () => {
  const g = E.newRun("r1", "n");
  assert.equal(E.canSetOff(g), false);
  assert.equal(E.setOff(g), false);
  const lost = play("r1", "n", (x) => { if (!x.cv.length) E.hire(x, "pony"); });
  assert.equal(lost.over, 0, "one pony is not enough");
  assert.ok(lost.got < lost.goal);
});

test("caravan: carts follow the sign as it is when they reach the fork, so the caravan splits", () => {
  const g = E.newRun("r1", "n");
  g.coins = 999;
  for (let i = 0; i < 4; i++) E.hire(g, "mule");
  E.setSign(g, "A", 0);
  E.setOff(g);
  const rt = E.ROUTE.r1, left = rt.out.A[0], right = rt.out.A[2];
  const seen = {};
  let flipped = false;
  for (let n = 0; n < 60 * 120 && g.ph === "go"; n++) {
    E.step(g); g.ev.length = 0;
    g.cv.forEach((c) => { if (c.st === "r" && (c.e === left || c.e === right)) seen[c.id] = seen[c.id] || c.e; });
    if (!flipped && Object.keys(seen).length === 2) { E.setSign(g, "A", 2); flipped = true; }
  }
  const ways = g.cv.map((c) => seen[c.id]);
  assert.deepEqual(ways, [left, left, right, right]);
});

test("caravan: carts never overtake: a pony behind a mule stays at least one tile behind", () => {
  const g = E.newRun("r1", "n");
  g.coins = 999;
  const mule = E.hire(g, "mule"), pony = E.hire(g, "pony");
  E.setSign(g, "A", 1);
  E.setOff(g);
  let minGap = Infinity;
  for (let n = 0; n < 60 * 60 && g.ph === "go"; n++) {
    E.step(g); g.ev.length = 0;
    if (mule.st === "r" && pony.st === "r") {
      assert.ok(pony.tr <= mule.tr + 1e-9, "never in front");
      if (mule.e === pony.e) minGap = Math.min(minGap, mule.d - pony.d);
    }
  }
  assert.ok(minGap >= E.GAP - 1e-6, "gap " + minGap);
  assert.ok(g.trip === 2 || pony.st === "d", "both reached the market");
});

test("caravan: machines aim at a straw cart first, else the cart that has come furthest", () => {
  const g = E.newRun("r3", "n");
  g.coins = 999;
  const m1 = E.hire(g, "mule"), s = E.hire(g, "straw"), m2 = E.hire(g, "mule");
  E.setSign(g, "A", 1);           // A → B, past the arm at (10, 9)
  E.setOff(g);
  const hits = {};
  for (let n = 0; n < 60 * 90 && g.ph === "go"; n++) {
    E.step(g);
    g.ev.forEach((x) => { if (x.e === "hit") hits[x.c] = (hits[x.c] || 0) + 1; });
    g.ev.length = 0;
  }
  assert.ok(hits[s.id] > 0, "the straw was hit");
  assert.ok((hits[m2.id] || 0) <= (hits[m1.id] || 0) + hits[s.id], "the rear mule hides behind the straw");
  // aiming at the furthest: two mules side by side past one arm
  const h = E.newRun("r1", "n");
  h.coins = 999;
  const f = E.hire(h, "mule"), r = E.hire(h, "mule");
  E.setSign(h, "A", 1);
  E.setOff(h);
  let first = null;
  for (let n = 0; n < 60 * 60 && !first; n++) { E.step(h); h.ev.forEach((x) => { if (x.e === "hit" && !first) first = x.c; }); h.ev.length = 0; }
  assert.equal(first, f.id);
  assert.ok(r);
});

test("caravan: smoke stops the machines in it, the shield takes every knock, the goat track opens once a trip", () => {
  const base = E.newRun("r1", "n");
  base.coins = 999;
  E.hire(base, "mule"); E.hire(base, "mule");
  E.setSign(base, "A", 1);
  E.setOff(base);
  const plain = roll(E.clone(base));
  const smoky = E.clone(base);
  const rt = E.ROUTE.r1;
  // smoke over the arm at (7, 6), when the first cart is close
  for (let n = 0; n < 60 * 60 && smoky.ph === "go"; n++) {
    if (smoky.tk.s && smoky.cv[0].st === "r" && smoky.cv[0].y > 4) assert.ok(E.smoke(smoky, rt.M[0].x, rt.M[0].y));
    E.step(smoky); smoky.ev.length = 0;
  }
  assert.ok(smoky.tg > plain.tg, "smoke saves crates " + smoky.tg + " > " + plain.tg);
  assert.equal(E.smoke(smoky, 1, 1), false, "none left / not on the road");
  const sh = E.clone(base);
  E.step(sh);
  assert.ok(E.shield(sh, sh.cv[0].id));
  assert.equal(E.shield(sh, sh.cv[0].id), false, "only one");
  const hp = [];
  for (let n = 0; n < 300; n++) { E.step(sh); hp.push(sh.cv[0].hp); sh.ev.length = 0; }
  assert.ok(hp.every((v) => v === sh.cv[0].hp || v === 10), "no crate lost while shielded");
  // the goat track on route 2
  const gt = E.newRun("r2", "n");
  const goatIdx = E.ROUTE.r2.out.A.findIndex((e) => E.ROUTE.r2.E[e].goat);
  assert.equal(E.setSign(gt, "A", goatIdx), false, "closed");
  assert.equal(E.flip(gt, "A") && gt.sg.A === goatIdx, false, "flipping skips it");
  assert.ok(E.shortcut(gt));
  assert.equal(gt.sg.A, goatIdx, "the sign turns to it");
  assert.equal(E.shortcut(gt), false);
  assert.deepEqual(E.wayNow(gt).map((e) => E.ROUTE.r2.E[e].goat), [false, true]);
  E.hire(gt, "pony");
  E.setOff(gt); roll(gt);
  assert.equal(gt.trip, 2);
  assert.equal(gt.goat, 0, "closed again on the next trip");
  assert.notEqual(gt.sg.A, goatIdx);
  assert.equal(gt.tk.c, 1, "one shortcut back");
});

test("caravan: the mender ties fallen crates back on the carts near it", () => {
  const run = (withMender) => {
    const g = E.newRun("r2", "n");
    g.coins = 999;
    E.hire(g, "mule");
    if (withMender) E.hire(g, "mender"); else E.hire(g, "pony");
    E.setSign(g, "A", 1);
    E.setOff(g);
    let mule = 0;
    for (let n = 0; g.ph === "go" && n < 60 * 600; n++) {
      E.step(g);
      g.ev.forEach((x) => { if (x.e === "home" && x.c === g.cv[0].id) mule = x.n; });
      g.ev.length = 0;
      assert.ok(g.cv[0].hp <= E.stats(g.cv[0]).cap + 1e-9);
    }
    return mule;
  };
  const a = run(false), b = run(true);
  assert.ok(b > a, "the mule brings more crates home " + b + " > " + a);
});

test("caravan: a trip pays the crates, brings back emptied carts loaded and adds the next machines", () => {
  const g = E.newRun("r1", "n");
  E.hire(g, "mule"); E.hire(g, "pony");
  const coins = g.coins;
  E.setSign(g, "A", 0);
  E.setOff(g);
  assert.equal(g.load, 15);
  assert.deepEqual(E.newMachines(g), [0, 1, 2]);
  roll(g);
  assert.equal(g.trip, 2); assert.equal(g.ph, "plan");
  assert.equal(g.coins, coins + g.got * E.PAY + E.TRIP_PAY);
  assert.ok(g.cv.every((c) => c.st === "q" && c.hp === E.stats(c).cap));
  assert.deepEqual(E.newMachines(g), [3, 4]);
  assert.equal(E.activeMachines(g).length, 5);
});

test("caravan: the route ends after three trips: won with the goal reached, stars by the share delivered", () => {
  const g = E.newRun("r1", "n");
  g.coins = 999;
  for (let i = 0; i < 8; i++) E.hire(g, "mule");
  for (let t = 1; t <= 3; t++) { E.setSign(g, "A", 2); if (t === 3) E.setSign(g, "A", 0); E.setOff(g); roll(g); }
  assert.equal(g.over, 1);
  assert.ok(g.got >= g.goal);
  const r = g.got / g.load;
  assert.equal(E.stars(g), r >= 0.85 ? 3 : r >= 0.65 ? 2 : 1);
  assert.equal(E.setOff(g), false);
});

test("caravan: the same choices replay exactly (no randomness)", () => {
  const a = play("r2", "h", player), b = play("r2", "h", player);
  assert.equal(J(E.saveable(a)), J(E.saveable(b)));
});

test("caravan: a plain caravan clears route 1 on Mild and Normal", () => {
  ["m", "n"].forEach((d) => {
    const g = play("r1", d, player);
    assert.equal(g.over, 1, d + ": " + g.got + "/" + g.goal);
  });
});

test("caravan: the session copy round-trips, also on the road, and rejects broken ones", () => {
  const g = E.newRun("r4", "n");
  g.coins = 999;
  E.hire(g, "mule"); E.hire(g, "pony"); E.hire(g, "straw");
  E.shortcut(g);
  E.setOff(g);
  for (let n = 0; n < 60 * 8; n++) E.step(g);
  E.smoke(g, 6, 6);
  g.ev.length = 0;
  const copy = E.normalizeRun(JSON.parse(J(E.saveable(g))));
  assert.ok(copy);
  assert.equal(J(E.saveable(copy)), J(E.saveable(g)));
  // the copy goes on exactly like the original
  roll(g); roll(copy);
  assert.equal(J(E.saveable(copy)), J(E.saveable(g)));
  const bad = (f) => { const x = JSON.parse(J(E.saveable(g))); f(x); return E.normalizeRun(x); };
  assert.equal(bad((x) => { x.v = 2; }), null);
  assert.equal(bad((x) => { x.rt = "zz"; }), null);
  assert.equal(bad((x) => { x.goal = 1; }), null);
  assert.equal(bad((x) => { x.cv[0].k = "dragon"; }), null);
  assert.equal(bad((x) => { x.cv[0].hp = 99; }), null);
  assert.equal(bad((x) => { x.sg.A = 7; }), null);
  assert.equal(bad((x) => { x.cv.push(x.cv[0]); }), null, "the same cart twice");
  assert.equal(bad((x) => { x.tk.c = 1; x.rt = "r1"; x.goal = 50; }), null);
  assert.equal(bad((x) => { x.cv[0].j = -1; }), null);
  assert.equal(E.normalizeRun(null), null);
  // a session saved by v1.0.0 (no tc, no j) still opens
  const old = JSON.parse(J(E.saveable(g)));
  delete old.tc; old.cv.forEach((c) => { delete c.j; });
  const o = E.normalizeRun(old);
  assert.ok(o);
  assert.equal(o.tc, old.tg * E.PAY);
  assert.ok(o.cv.every((c) => c.j === 0));
});

test("caravan: progress merge is a join: symmetric, idempotent, reset stamp drops older rows", () => {
  const a = { ver: 1, br: 0, maps: { r1: { b: 0, s: 3, e: 0 }, r2: { b: 0, s: 1, e: 0 }, zz: { b: 0, s: 3, e: 0 } },
              rows: { deva000001: { b: 0, s: { n: [4, 2] }, f: 210 } } };
  const b = { ver: 1, br: 0, maps: { r1: { b: 0, s: 2, e: 0 }, r2: { b: 0, s: 2, e: 0 } },
              rows: { deva000001: { b: 0, s: { n: [3, 2] }, f: 180 }, devb000002: { b: 0, s: { m: [2, 2] }, f: 95 } } };
  const ab = E.merge(a, b), ba = E.merge(b, a);
  assert.equal(J(ab), J(ba));
  assert.equal(J(E.merge(ab, ab)), J(ab));
  assert.deepEqual(ab.maps, { r1: { b: 0, s: 3, e: 0 }, r2: { b: 0, s: 2, e: 0 } });
  assert.deepEqual(ab.rows.deva000001, { b: 0, s: { n: [4, 2] }, f: 210 });
  const reset = E.merge({ ver: 1, br: 5, maps: {}, rows: {} }, ab);
  assert.deepEqual(reset.maps, {}); assert.deepEqual(reset.rows, {});
  assert.ok(E.isOpen(ab, "r3") === true && E.isOpen(reset, "r2") === false && E.isOpen(reset, "r1"));
  // record: one route on this device
  const g = play("r1", "m", player);
  const d = E.record(E.defaultData(), "devc000003", g, 1000);
  assert.deepEqual(d.rows.devc000003.s.m, [1, 1]);
  assert.equal(d.rows.devc000003.f, g.got);
  assert.equal(d.maps.r1.s, E.stars(g));
  assert.equal(E.starsOf(d, "r1"), E.stars(g));
});

test("caravan: Endless: every machine from trip 1, a growing quota, the score is the trips that brought it", () => {
  const rt = E.ROUTE.r1;
  const g = E.newRun("r1", "n", 1);
  assert.equal(g.en, 1); assert.equal(g.nt, 0);
  assert.equal(g.coins, E.DIFF.n.coins + E.EN_COINS);
  assert.equal(g.q, E.quota(rt, 1));
  assert.ok(E.quota(rt, 2) > E.quota(rt, 1) && E.quota(rt, 5) > E.quota(rt, 4));
  assert.equal(E.activeMachines(g).length, rt.M.length);
  assert.deepEqual(E.newMachines(g), []);
  // a trip that brings its quota goes on, one that falls short ends it
  g.coins = 999;
  for (let i = 0; i < 8; i++) E.hire(g, "mule");
  E.setSign(g, "A", 2);
  E.setOff(g); roll(g);
  assert.ok(g.tg >= E.quota(rt, 1), g.tg + " >= " + E.quota(rt, 1));
  assert.equal(g.over, -1); assert.equal(g.trip, 2); assert.equal(g.q, E.quota(rt, 2));
  g.cv.splice(1);                         // one mule cannot bring the quota
  E.setOff(g); roll(g);
  assert.equal(g.over, 1);
  assert.equal(E.score(g), 1);
  assert.equal(E.stars(g), 0);
  // the record keeps the best score only, never stars or routes played
  let d = E.record(E.defaultData(), "dev123", play("r1", "n", player), 5);
  assert.equal(E.endlessOpen(d, "r1"), true);
  const before = J(d.rows.dev123.s);
  d = E.record(d, "dev123", g, 6);
  assert.equal(E.bestEndless(d, "r1"), 1);
  assert.equal(J(d.rows.dev123.s), before);
  d = E.record(d, "dev123", Object.assign(E.clone(g), { trip: 1, tg: 0 }), 7);
  assert.equal(E.bestEndless(d, "r1"), 1, "a lower score keeps the best");
  // the session copy round-trips and checks the quota
  const h = E.newRun("r5", "h", 1);
  E.hire(h, "smith"); E.hire(h, "mule"); E.setOff(h);
  for (let n = 0; n < 60 * 5; n++) E.step(h);
  h.ev.length = 0;
  const c = E.normalizeRun(JSON.parse(J(E.saveable(h))));
  assert.equal(J(E.saveable(c)), J(E.saveable(h)));
  const x = JSON.parse(J(E.saveable(h))); x.q = 1;
  assert.equal(E.normalizeRun(x), null);
  const y = JSON.parse(J(E.saveable(h))); y.nt = 3;
  assert.equal(E.normalizeRun(y), null);
});
