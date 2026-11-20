// Clockwork Workshop: the rules engine (clockwork/engine.js, a module):
// the bench, gear meshing and jams, power, the flow of goods, prices,
// the away rule, the new workshop and the pattern book, the sync merge.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../clockwork/engine.js");

const J = JSON.stringify;
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const T0 = Date.UTC(2026, 10, 20, 8, 0, 0);

function fresh(seed = "test") { return E.newGame(seed, T0, 0); }
function near(a, b, rel = 1e-9) { assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b)), a + " ≈ " + b); }
function at(s, x, y) { return y * E.size(s) + x; }
// Lay parts [x, y, code] straight on the bench (no prices), for tests.
function lay(s, parts) { for (const [x, y, c] of parts) s.bd[at(s, x, y)] = c; return s; }
function rich(s) { s.co = 1e12; return s; }

// The stages a player goes through on the first bench (5 × 5): a
// furnace to the crate, a gear press, a spring coiler, a clock bench,
// an automaton loft. Each one works and is jam-free.
const STAGES = [
  [[1, 2, "f0"], [2, 2, "b0"], [3, 2, "b0"]],
  [[1, 2, "f0"], [2, 2, "p0"], [3, 2, "b0"], [1, 3, "g"]],
  [[1, 2, "f0"], [2, 2, "p0"], [3, 2, "b0"], [2, 1, "f0"], [3, 1, "c1"], [1, 1, "g"], [2, 0, "g"], [1, 3, "g"]],
  [[1, 2, "f0"], [2, 2, "p0"], [3, 2, "k0"], [2, 1, "f0"], [3, 1, "c1"], [1, 1, "g"], [2, 0, "g"], [1, 3, "g"], [2, 3, "g"]],
  [[1, 2, "f0"], [2, 2, "p0"], [3, 2, "k1"], [2, 1, "f0"], [3, 1, "c1"], [1, 1, "g"], [2, 0, "g"], [1, 3, "g"], [2, 3, "g"], [3, 3, "a0"], [4, 3, "b3"]]
];
// Rebuild the bench to a stage by actions (paid); false when the coins
// do not reach (nothing changes then).
function build(s, parts) {
  const z = E.size(s), want = Array(z * z).fill("");
  for (const [x, y, c] of parts) want[y * z + x] = c;
  const t = E.clone(s);
  for (let i = 0; i < t.bd.length; i++) if (t.bd[i] && t.bd[i] !== want[i]) assert.equal(E.act(t, { t: "take", i }), "");
  for (let i = 0; i < t.bd.length; i++) if (want[i] && !t.bd[i]) if (E.act(t, { t: "put", i, p: want[i] })) return false;
  Object.assign(s, t);
  return true;
}

test("clockwork: a new workshop is canonical and normalize is idempotent", () => {
  const s = fresh();
  assert.equal(J(E.normalize(s)), J(s));
  assert.equal(J(E.normalize(E.normalize(s))), J(s));
  assert.equal(E.size(s), 5);
  assert.equal(s.bd.length, 25);
  assert.equal(s.co, E.START_CO);
  assert.equal(E.fixedAt(s, at(s, 0, 2)), "W");
  assert.equal(E.fixedAt(s, at(s, 4, 2)), "X");
  assert.equal(E.solve(s).inc, 0);
});

test("clockwork: the bench grows by one with every new workshop, up to 7 × 7; the wheel and crate stay in the middle row", () => {
  assert.deepEqual([0, 1, 2, 3, 9].map(E.sizeOf), [5, 6, 7, 7, 7]);
  assert.equal(E.wheelCell(5), 10); assert.equal(E.crateCell(5), 14);
  assert.equal(E.wheelCell(6), 18); assert.equal(E.crateCell(6), 23);
  assert.equal(E.wheelCell(7), 21); assert.equal(E.crateCell(7), 27);
  assert.equal(E.doorCell(7), 6);
});

test("clockwork: gears mesh on all eight sides and turn the other way; a ring of three jams the train", () => {
  const s = fresh("mesh");
  lay(s, [[1, 1, "g"], [2, 0, "g"], [1, 3, "g"]]);
  let r = E.solve(s);
  assert.equal(r.jam, false);
  assert.equal(r.spin[at(s, 0, 2)], 1);
  assert.equal(r.spin[at(s, 1, 1)], -1);
  assert.equal(r.spin[at(s, 2, 0)], 1);
  assert.equal(r.spin[at(s, 1, 3)], -1);
  assert.equal(r.train, 3);
  // a straight line of gears never jams
  const line = lay(fresh("line"), [[1, 2, "g"], [2, 2, "g"], [3, 2, "g"]]);
  assert.equal(E.solve(line).jam, false);
  assert.equal(E.solve(line).train, 3);
  // the wheel, (0,1) and (1,1) all touch: a ring of three
  lay(s, [[0, 1, "g"]]);
  r = E.solve(s);
  assert.equal(r.jam, true);
  assert.ok(r.bad[at(s, 0, 1)] && r.bad[at(s, 1, 1)]);
  assert.equal(r.train, 0);
  // a 2 × 2 block of gears jams on its own once it turns
  const block = lay(fresh("block"), [[1, 2, "g"], [2, 2, "g"], [1, 3, "g"], [2, 3, "g"]]);
  assert.equal(E.solve(block).jam, true);
  // gears that do not touch the train do not turn and do not jam it
  const far = lay(fresh("far"), [[3, 0, "g"], [4, 0, "g"], [3, 1, "g"], [4, 1, "g"]]);
  assert.equal(E.solve(far).jam, false);
  assert.equal(E.solve(far).train, 0);
});

test("clockwork: a machine runs next to the wheel or a turning gear; power is shared", () => {
  const s = fresh("pow");
  lay(s, [[1, 2, "f0"], [2, 2, "b0"], [3, 2, "b0"]]);
  let r = E.solve(s);
  const f = r.ms[at(s, 1, 2)];
  assert.equal(f.st, "run");
  near(f.rate, 6);
  near(r.inc, 12, 1e-9);
  // a furnace two cells from the wheel is idle
  const s2 = lay(fresh("idle"), [[2, 2, "f0"], [3, 2, "b0"]]);
  assert.equal(E.solve(s2).ms[at(s2, 2, 2)].st, "idle");
  assert.equal(E.solve(s2).inc, 0);
  // five running machines on a wheel of 4: everyone at 4/5
  const s3 = lay(fresh("share"), [[0, 1, "f2"], [1, 1, "f3"], [1, 2, "f0"], [1, 3, "f1"], [0, 3, "f2"]]);
  r = E.solve(s3);
  assert.equal(r.need, 5); assert.equal(r.P, 4);
  near(r.share, 0.8);
  near(r.ms[at(s3, 1, 2)].sp, 6 * 0.8);
  s3.lv.wheel = 1;
  assert.equal(E.solve(s3).share, 1);
  // a jam stops every machine
  lay(s, [[0, 1, "g"], [1, 1, "g"]]);
  r = E.solve(s);
  assert.equal(r.jam, true);
  assert.equal(r.ms[at(s, 1, 2)].st, "jam");
  assert.equal(r.inc, 0);
});

test("clockwork: goods: belts carry them, a machine takes only what it needs, the crate sells; full and circling", () => {
  const s = fresh("flow");
  // a furnace facing a gear has nowhere to put its brass
  lay(s, [[1, 2, "f0"], [2, 2, "g"]]);
  assert.equal(E.solve(s).ms[at(s, 1, 2)].st, "full");
  // a furnace facing a clock bench: the bench does not take brass
  const s2 = lay(fresh("no"), [[1, 2, "f0"], [2, 2, "k0"]]);
  assert.equal(E.solve(s2).ms[at(s2, 1, 2)].st, "full");
  // off the bench
  const s3 = lay(fresh("off"), [[1, 1, "f3"], [1, 0, "b3"]]);
  assert.equal(E.solve(s3).ms[at(s3, 1, 1)].st, "full");
  // belts in a ring: circling
  const s4 = lay(fresh("ring"), [[1, 2, "f3"], [1, 1, "b0"], [2, 1, "b1"], [2, 2, "b2"]]);
  // (2,2) points west back into the furnace: that is a machine that takes no brass
  assert.equal(E.solve(s4).ms[at(s4, 1, 2)].st, "full");
  const s5 = lay(fresh("ring2"), [[1, 1, "f3"], [1, 0, "b0"], [2, 0, "b1"], [2, 1, "b2"], [1, 1, "f3"]]);
  s5.bd[at(s5, 2, 1)] = "b3";   // (1,0) → (2,0) → (2,1) → (2,0) …
  s5.bd[at(s5, 2, 0)] = "b1";
  assert.equal(E.solve(s5).ms[at(s5, 1, 1)].st, "loop");
  // the path of a good is the cells it passes, to the crate
  const s6 = lay(fresh("path"), [[1, 2, "f0"], [2, 2, "b0"], [3, 2, "b0"]]);
  assert.deepEqual(E.solve(s6).ms[at(s6, 1, 2)].path, [11, 12, 13, 14]);
});

test("clockwork: the five stages: each works, every machine runs, the income grows", () => {
  const incs = STAGES.map((st) => {
    const s = lay(fresh("st"), st);
    s.lv.wheel = 1;
    const r = E.solve(s);
    assert.equal(r.jam, false);
    Object.keys(r.ms).forEach((i) => assert.equal(r.ms[i].st, "run", "stage machine " + i));
    return r.inc;
  });
  assert.deepEqual(incs.map((x) => Math.round(x)), [12, 27, 54, 90, 260]);
  // the loft: 0.5 a minute from 1.5 clocks a minute
  const s = lay(fresh("loft"), STAGES[4]);
  s.lv.wheel = 1;
  const r = E.solve(s);
  near(r.ship[4], 0.5);
  near(r.make[3], 1.5);
  near(r.make[1], 3); near(r.make[2], 3);
});

test("clockwork: a machine waits for its inputs; the flow is limited by the slowest input", () => {
  // a clock bench with gears but no springs makes nothing
  const s = lay(fresh("wait"), STAGES[3]);
  s.lv.wheel = 1;
  s.bd[at(s, 3, 1)] = "";          // no coiler
  const r = E.solve(s);
  assert.equal(r.ms[at(s, 3, 2)].st, "wait");
  assert.equal(r.ms[at(s, 3, 2)].rate, 0);
});

test("clockwork: prices: every copy 15% more, half back when taken, upgrades lift speed, power and prices", () => {
  const s = rich(fresh("price"));
  near(E.partCost(s, "f"), 20);
  assert.equal(E.act(s, { t: "put", i: at(s, 1, 2), p: "f0" }), "");
  near(E.partCost(s, "f"), 20 * 1.15);
  near(E.refundOf(s, "f"), 10);
  const co = s.co;
  assert.equal(E.act(s, { t: "take", i: at(s, 1, 2) }), "");
  near(s.co, co + 10);
  assert.equal(E.act(s, { t: "put", i: at(s, 0, 2), p: "g" }), "full", "not on the wheel");
  assert.equal(E.act(s, { t: "put", i: at(s, 4, 2), p: "g" }), "full", "not on the crate");
  assert.equal(E.act(s, { t: "put", i: 3, p: "x0" }), "bad");
  assert.equal(E.act(s, { t: "put", i: 99, p: "g" }), "bad");
  lay(s, [[1, 2, "f0"], [2, 2, "b0"], [3, 2, "b0"]]);
  // turning a belt or a machine; a gear does not turn
  assert.equal(E.act(s, { t: "turn", i: at(s, 2, 2) }), "");
  assert.equal(s.bd[at(s, 2, 2)], "b1");
  assert.equal(E.act(s, { t: "turn", i: at(s, 2, 2), back: true }), "");
  assert.equal(s.bd[at(s, 2, 2)], "b0");
  s.bd[at(s, 3, 3)] = "g";
  assert.equal(E.act(s, { t: "turn", i: at(s, 3, 3) }), "bad");
  // polish needs the machine; it doubles it
  assert.equal(E.upInfo(s, "pp").need, false);
  assert.equal(E.act(s, { t: "buy", u: "pp" }), "need");
  assert.equal(E.act(s, { t: "buy", u: "pf" }), "");
  near(E.solve(s).inc, 24);
  assert.equal(E.act(s, { t: "buy", u: "pf" }), "max");
  assert.equal(E.act(s, { t: "buy", u: "oil" }), "");
  near(E.solve(s).inc, 24 * 1.2);
  assert.equal(E.act(s, { t: "buy", u: "wheel" }), "");
  assert.equal(E.power(s), 6);
  // the back door: a second crate in the top right corner, only when that cell is free
  s.bd[E.doorCell(5)] = "g";
  assert.equal(E.act(s, { t: "buy", u: "door" }), "door");
  s.bd[E.doorCell(5)] = "";
  assert.equal(E.act(s, { t: "buy", u: "door" }), "");
  assert.equal(E.fixedAt(s, E.doorCell(5)), "X");
  const poor = fresh("poor");
  assert.equal(E.act(poor, { t: "put", i: at(poor, 1, 2), p: "k0" }), "co");
  assert.equal(E.act(poor, { t: "buy", u: "oil" }), "co");
});

test("clockwork: coins come in every minute; long and short steps agree", () => {
  const a = lay(fresh("time"), STAGES[4]), b = E.clone(a);
  a.lv.wheel = 1; b.lv.wheel = 1;
  E.advance(a, 6 * HOUR);
  for (let i = 0; i < 360; i++) E.advance(b, MIN);
  near(a.co, b.co, 1e-9);
  near(a.co, E.START_CO + 260 * 360, 1e-9);
  near(a.life, 260 * 360, 1e-9);
  near(a.sh[4], 0.5 * 360, 1e-9);
  near(a.ws[4], a.sh[4]);
  assert.equal(a.at, T0 + 6 * HOUR);
});

test("clockwork: away, the first 7 days count in full, the rest at half; patient keeps it full longer; a clock that went back counts nothing", () => {
  const s = lay(fresh("away"), STAGES[0]);
  const out = E.catchUp(s, T0 + 10 * DAY);
  near(out.co, 12 * (7 * 1440 + 0.5 * 3 * 1440));
  assert.equal(out.slowed, true);
  assert.equal(s.at, T0 + 10 * DAY);
  const p = lay(fresh("pat"), STAGES[0]);
  p.tr = ["patient"];
  near(E.catchUp(p, T0 + 10 * DAY).co, 12 * 10 * 1440);
  const back = lay(fresh("back"), STAGES[0]);
  const o2 = E.catchUp(back, T0 - HOUR);
  assert.equal(o2.co, 0);
  assert.equal(back.at, T0 - HOUR);
  assert.equal(back.co, E.START_CO);
  const far = lay(fresh("far"), STAGES[0]);
  const o3 = E.catchUp(far, T0 + 1000 * DAY);
  near(o3.co, 12 * (7 * 1440 + 0.5 * 393 * 1440));
});

test("clockwork: a new workshop needs an automaton shipped and the coins; a bigger bench, a mark, the pattern book", () => {
  const s = rich(lay(fresh("new"), STAGES[4]));
  s.lv.wheel = 1;
  assert.equal(E.canNew(s), false);
  assert.equal(E.act(s, { t: "new", tr: E.offer(s)[0] }), "nonew");
  s.we = E.NEW_E;
  assert.equal(E.canNew(s), false, "an automaton first");
  E.advance(s, 3 * MIN);
  assert.equal(E.canNew(s), true);
  const off = E.offer(s);
  assert.equal(off.length, 3);
  assert.equal(new Set(off).size, 3);
  assert.equal(J(E.offer(s)), J(off), "seeded");
  assert.equal(E.act(s, { t: "new", tr: "nope" }), "bad");
  const before = E.clone(s);
  assert.equal(E.act(s, { t: "new", tr: off[1] }), "");
  assert.equal(s.wn, 1);
  assert.equal(E.size(s), 6);
  assert.equal(s.bd.length, 36);
  assert.ok(s.bd.every((c) => c === ""));
  assert.equal(s.co, E.START_CO);
  assert.equal(s.we, 0);
  assert.deepEqual(s.ws, [0, 0, 0, 0, 0]);
  assert.deepEqual(s.tr, [off[1]]);
  assert.equal(s.lv.wheel, 0);
  assert.equal(s.pb.length, 1);
  assert.equal(s.pb[0].z, 5);
  assert.equal(J(s.pb[0].bd), J(before.bd));
  near(s.life, before.life);
  assert.deepEqual(s.sh, before.sh);
  assert.ok(E.bit(s, "first"));
  near(E.priceF(s), (1 + E.PB_F) * (off[1] === "fine" ? 1.1 : 1));
  assert.equal(J(E.normalize(s)), J(s));
});

test("clockwork: the pattern book lays an old bench again, its wheel row on this one's, for its parts' price", () => {
  const s = rich(lay(fresh("pb"), STAGES[4]));
  s.lv.wheel = 1;
  s.we = E.NEW_E; E.advance(s, 3 * MIN);
  E.act(s, { t: "new", tr: E.offer(s)[0] });
  const cells = E.patternCells(s, 0);
  assert.equal(cells.length, STAGES[4].length);
  // one row down: the furnace from (1,2) lies at (1,3)
  assert.ok(cells.some(([i, c]) => i === at(s, 1, 3) && c === "f0"));
  const pc = E.patternCost(s, 0);
  assert.ok(pc.cost > 25000);
  s.co = pc.cost - 1;
  assert.equal(E.act(s, { t: "pattern", k: 0 }), "co");
  assert.ok(s.bd.every((c) => c === ""), "nothing changes when the coins do not reach");
  s.co = pc.cost + 5;
  assert.equal(E.act(s, { t: "pattern", k: 0 }), "");
  near(s.co, 5, 1e-6);
  assert.equal(s.bd[at(s, 1, 3)], "f0");
  // the crate moved one cell right: the loft's belt now ends on an empty cell
  assert.equal(E.solve(s).ms[at(s, 3, 4)].st, "full");
  s.bd[at(s, 4, 3)] = "b0";
  s.lv.wheel = 1;
  assert.equal(E.solve(s).ms[at(s, 3, 4)].st, "run");
  assert.equal(E.act(s, { t: "pattern", k: 5 }), "bad");
  // laying a pattern gives half the parts on the bench back first
  s.co = 1e9;
  const pc2 = E.patternCost(s, 0);
  assert.ok(pc2.back > 0);
});

test("clockwork: a mark of every kind does what it says", () => {
  const base = lay(fresh("marks"), STAGES[0]);
  const inc0 = E.solve(base).inc;
  const q = E.clone(base); q.tr = ["quick"]; near(E.solve(q).inc, inc0 * 1.15);
  const f = E.clone(base); f.tr = ["fine"]; near(E.solve(f).inc, inc0 * 1.1);
  const r = E.clone(base); r.tr = ["river"]; assert.equal(E.power(r), 6);
  const t = E.clone(base); t.tr = ["thrifty"]; near(E.partCost(t, "g"), 15 * 0.85);
  const k = fresh("keen"); k.tr = ["keen"];
  assert.equal(E.partCost(k, "p"), 0);
  assert.equal(E.partCost(k, "c"), 0);
  k.bd[3] = "p0";
  near(E.partCost(k, "p"), 120 * 1.15);
  const p = E.clone(base); p.tr = ["patient", "patient"]; assert.equal(E.fullMs(p), 21 * DAY);
  const w = E.clone(base); w.wn = 3; near(E.priceF(w), 1.06);
});

test("clockwork: normalize drops unknown parts and parts on fixed cells, clamps numbers, keeps the book small", () => {
  const s = fresh("norm");
  const x = E.clone(s);
  x.bd[0] = "<img>"; x.bd[1] = "g"; x.bd[E.wheelCell(5)] = "g"; x.bd[E.crateCell(5)] = "f0"; x.bd[2] = "b9";
  x.co = -5; x.life = "lots"; x.acts = 2.7; x.tr = ["quick", "evil", "fine"]; x.mi = 1e9;
  x.lv.wheel = 99; x.lv.bogus = 3;
  x.pb = [];
  for (let i = 0; i < 50; i++) x.pb.push({ n: i + 1, z: 5, bd: Array(25).fill("g"), e: 10 });
  x.pb.push({ n: 1, z: 6, bd: ["g"], e: 1 });
  x.pb.push("junk");
  const n = E.normalize(x);
  assert.equal(n.bd[0], ""); assert.equal(n.bd[1], "g"); assert.equal(n.bd[2], "");
  assert.equal(n.bd[E.wheelCell(5)], ""); assert.equal(n.bd[E.crateCell(5)], "");
  assert.equal(n.co, 0); assert.equal(n.life, 0); assert.equal(n.acts, 2);
  assert.deepEqual(n.tr, ["quick", "fine"]);
  assert.equal(n.mi, (1 << E.MILES.length) - 1);
  assert.equal(n.lv.wheel, 6); assert.equal(n.lv.bogus, undefined);
  assert.equal(n.pb.length, E.PB_MAX);
  assert.equal(n.pb[0].bd[E.wheelCell(5)], "");
  assert.equal(J(E.normalize(n)), J(n));
  // a bench of the wrong size is emptied
  const y = E.clone(s); y.bd = ["g"];
  assert.equal(E.normalize(y).bd.length, 25);
  assert.equal(E.normalize({ v: 2, lv: {} }), null);
  assert.equal(E.normalize("x"), null);
  // a bench that grew with wn: the right size
  const w = E.clone(s); w.wn = 2; w.bd = Array(49).fill(""); w.bd[0] = "g";
  assert.equal(E.normalize(w).bd.length, 49);
  assert.equal(E.normalize(w).bd[0], "g");
});

test("clockwork: merge is symmetric: the reset stamp, then the further-ahead workshop", () => {
  const a = lay(fresh("m"), STAGES[0]), b = lay(fresh("m"), STAGES[0]);
  E.advance(a, 3 * HOUR);
  assert.equal(J(E.merge(a, b)), J(E.normalize(a)));
  assert.equal(J(E.merge(b, a)), J(E.normalize(a)));
  const c = E.newGame("other", T0 + HOUR, T0 + HOUR);
  assert.equal(J(E.merge(a, c)), J(c), "a reset wins");
  assert.equal(J(E.merge(c, a)), J(c));
  assert.equal(J(E.merge(a, a)), J(E.normalize(a)));
  assert.equal(J(E.merge(null, a)), J(E.normalize(a)));
  assert.equal(J(E.merge(a, "junk")), J(E.normalize(a)));
  const d = E.clone(a); d.at += 1;
  assert.equal(J(E.merge(a, d)), J(d), "same life: the later one");
});

test("clockwork: milestones", () => {
  const s = lay(fresh("miles"), STAGES[4]);
  s.lv.wheel = 1;
  assert.equal(s.mi, 0);
  E.advance(s, MIN);
  assert.ok(E.bit(s, "clock"));
  assert.ok(!E.bit(s, "auto"));
  E.advance(s, 2 * MIN);
  assert.ok(E.bit(s, "auto"));
  s.life = 2e6; E.advance(s, MIN);
  assert.ok(E.bit(s, "million"));
  // a long train on a 7 × 7 bench: three rows of gears joined at the
  // right end by gears one step off the corner, so no three touch
  const tr = fresh("train");
  tr.wn = 2; tr.bd = Array(49).fill("");
  for (let x = 1; x < 6; x++) for (const y of [1, 3, 5]) tr.bd[at(tr, x, y)] = "g";
  tr.bd[at(tr, 6, 2)] = "g"; tr.bd[at(tr, 6, 4)] = "g";
  const r = E.solve(tr);
  assert.equal(r.jam, false);
  assert.equal(r.train, 17);
  E.advance(tr, MIN);
  assert.ok(E.bit(tr, "train"));
  assert.ok(E.bit(tr, "big"), "a 7 × 7 bench");
  assert.ok(!E.bit(s, "first"));
});

test("clockwork: undo-friendly: act never changes the state on an error", () => {
  const s = lay(fresh("err"), STAGES[1]);
  const j = J(s);
  for (const a of [null, {}, { t: "x" }, { t: "put", i: -1, p: "g" }, { t: "take", i: 0 }, { t: "turn", i: 0 },
    { t: "buy", u: "nope" }, { t: "buy", u: "pa" }, { t: "pattern", k: 0 }, { t: "new", tr: "quick" },
    { t: "put", i: at(s, 1, 2), p: "g" }]) {
    assert.notEqual(E.act(s, a), "");
    assert.equal(J(s), j);
  }
});

test("clockwork: balance: the first new workshop after 3-7 days for a player who visits four times a day", () => {
  const s = fresh("bal");
  let k = 0, day = -1;
  for (let d = 0; d < 12 && day < 0; d++) {
    for (const h of [8, 12, 18, 22]) {
      const t = Date.UTC(2026, 10, 20 + d, h);
      E.catchUp(s, t);
      for (let g = 0; g < 100; g++) {
        if (k < STAGES.length) {
          const next = E.clone(s); next.co = 1e30; build(next, STAGES[k]);
          const sol = E.solve(next);
          if (sol.need > sol.P && E.upInfo(s, "wheel").ok) { E.act(s, { t: "buy", u: "wheel" }); continue; }
          if (build(s, STAGES[k])) { k++; continue; }
          break;
        }
        const ups = E.UPS.map((u) => E.upInfo(s, u.id)).filter((i) => i.ok && i.id !== "door" && i.id !== "wheel").sort((a, b) => a.c - b.c);
        if (!ups.length) break;
        E.act(s, { t: "buy", u: ups[0].id });
      }
      if (E.canNew(s)) { day = (t - T0) / DAY; break; }
    }
  }
  assert.ok(day >= 3 && day <= 7, "first new workshop after " + day + " days");
});
