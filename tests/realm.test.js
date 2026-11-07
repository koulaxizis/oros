// Realm: the rules engine (realm/engine.js, a module) and the records
// merge (cut out of the app IIFE by name, like tests/reversi.test.js).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const E = require("../realm/engine.js");
const O = E.O;

const SRC = fs.readFileSync(path.join(__dirname, "..", "realm/realm.js"), "utf8");
const R = (() => {
  const parts = ["var DATA_VER = 1; var LEVELS = ['e','m','h']; var SIZES = ['s','m','l'];",
    "var REC_KEYS = []; LEVELS.forEach(function (lv) { SIZES.forEach(function (sz) { REC_KEYS.push(lv + ':' + sz); }); });",
    "var MAX_DAY = 100000; var MAX_ROUNDS = 9999;"];
  ["cmpStr", "isInt", "normRow", "joinRows", "normDay", "dayKeyOk", "dayBetter", "mergeRealm"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    const one = SRC.indexOf("\n", i);
    const line = SRC.slice(i, one);
    parts.push(/\}\s*$/.test(line) ? line : SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function(parts.join("\n") + "\nreturn { mergeRealm };")();
})();

const J = JSON.stringify;
const sides = (...lv) => lv.map((l) => (l === "p" ? { k: "h", lv: "m" } : { k: "c", lv: l }));

// A small hand-made board: every cell land, nobody owns anything.
function blank(n = 2) {
  const st = E.makeMap({ size: "s", seed: "blank", sides: sides(...new Array(n).fill("m")) });
  for (let i = 0; i < st.land.length; i++) { st.land[i] = 1; st.own[i] = -1; st.obj[i] = 0; st.gold[i] = 0; st.done[i] = 0; }
  st.sides.forEach((s) => { s.out = false; });
  st.turn = 0; st.round = 1; st.over = -1; st.acts = 0;
  return st;
}
const at = (st, r, c) => r * st.W + c;
function give(st, side, cells, hall, gold) {
  cells.forEach((i) => { st.own[i] = side; });
  if (hall !== undefined) { st.obj[hall] = O.HALL; st.gold[hall] = gold || 0; }
}
// The cells of a filled hex disc of radius 1 around i (i first).
const disc = (st, i) => [i].concat(E.neighbours(st, i));

test("realm: the island maker is deterministic and the island connected", () => {
  for (const size of ["s", "m", "l"]) {
    for (let k = 0; k < 6; k++) {
      const sd = sides(...["m", "h", "e", "m", "m", "e"].slice(0, 2 + (k % 5)));
      const a = E.makeMap({ size, seed: "x" + k, sides: sd });
      const b = E.makeMap({ size, seed: "x" + k, sides: sd });
      assert.equal(J(a), J(b), "same seed, same island");
      assert.ok(E.valid(a), "valid state");
      assert.equal(E.landCount(a), E.SIZES[size].land, "land count " + size);
      // connected: a walk from one land cell reaches all of them
      const first = a.land.indexOf(1), seen = new Set([first]), q = [first];
      while (q.length) for (const x of E.neighbours(a, q.shift())) if (a.land[x] && !seen.has(x)) { seen.add(x); q.push(x); }
      assert.equal(seen.size, E.landCount(a), "one island");
      // every side starts with one region of 2+ cells, a Hall and its gold
      a.sides.forEach((s, side) => {
        const regs = E.regions(a, side);
        assert.equal(regs.length, 1, "one start region");
        assert.ok(regs[0].length >= 4, "start region size");
        assert.ok(E.hallOf(a, regs[0]) >= 0, "a Hall");
      });
    }
  }
  assert.notEqual(J(E.makeMap({ size: "s", seed: "a", sides: sides("m", "m") }).land),
                  J(E.makeMap({ size: "s", seed: "b", sides: sides("m", "m") }).land));
});

test("realm: income, upkeep and desertion", () => {
  const st = blank();
  const c = at(st, 5, 5), reg = disc(st, c);
  give(st, 0, reg, c, 0);
  st.obj[reg[1]] = O.MILL;
  st.obj[reg[2]] = O.THICKET;
  st.obj[reg[3]] = O.U2;          // upkeep 5
  give(st, 1, disc(st, at(st, 1, 1)), at(st, 1, 1), 0);
  const info = E.regionInfo(st, c);
  assert.equal(info.income, 7 - 1 + 4, "7 cells, one overgrown, a Mill");
  assert.equal(info.upkeep, 5);
  E.beginTurn(st);
  assert.equal(st.gold[c], 5);
  // a Champion (22) cannot be kept: everyone deserts, gold 0
  st.obj[reg[4]] = O.U4;
  E.beginTurn(st);
  assert.equal(st.gold[c], 0);
  assert.equal(st.obj[reg[3]], O.RUIN);
  assert.equal(st.obj[reg[4]], O.RUIN);
  assert.equal(st.obj[reg[1]], O.MILL, "buildings stay");
});

test("realm: defence and who may take a cell", () => {
  const st = blank();
  const c = at(st, 5, 5), reg = disc(st, c);
  give(st, 1, reg, c, 0);
  const edge = reg[1];
  assert.equal(E.defence(st, edge), 1, "next to the Hall");
  st.obj[reg[2]] = O.TOWER;
  assert.equal(E.defence(st, c), 2, "the Watchtower guards the Hall");
  st.obj[reg[3]] = O.U3;
  assert.equal(E.defence(st, c), 3);
  st.obj[c] = O.FORT;           // replace the Hall for this check
  assert.equal(E.defence(st, c), 3);
  st.obj[reg[4]] = O.U4;
  assert.equal(E.defence(st, c), 4, "a Champion next door");
  assert.equal(E.defence(st, at(st, 0, 0)), 0, "free land");
  // An attacker needs more: a tier-4 unit next to a cell guarded by 4 cannot take it.
  const s2 = blank();
  const h = at(s2, 2, 2);
  give(s2, 0, disc(s2, h), h, 100);
  const far = at(s2, 2, 5), fr = disc(s2, far);
  give(s2, 1, fr, far, 0);
  s2.obj[fr[1]] = O.U4;
  const enemyCell = fr.find((x) => E.neighbours(s2, x).some((y) => s2.own[y] === 0));
  if (enemyCell !== undefined) {
    const own = E.neighbours(s2, enemyCell).find((y) => s2.own[y] === 0);
    assert.equal(E.canBuy(s2, own, "u4", enemyCell) === null, E.defence(s2, enemyCell) >= 4);
  }
});

test("realm: walking, merging, taking, one action per unit", () => {
  const st = blank();
  const h = at(st, 5, 3), reg = disc(st, h);
  give(st, 0, reg, h, 50);
  give(st, 1, disc(st, at(st, 1, 10)), at(st, 1, 10), 0);
  const a = reg[1], b = reg[2];
  st.obj[a] = O.U1; st.obj[b] = O.U1;
  const tg = E.targets(st, a);
  assert.ok(tg.walk.includes(b), "may merge with the other Militia");
  assert.ok(tg.take.length > 0, "may take free land next to the region");
  assert.ok(E.move(st, a, b));
  assert.equal(st.obj[b], O.U2, "two Militia make a Pikeman");
  assert.equal(st.obj[a], O.EMPTY);
  assert.equal(st.done[b], 1, "the merge was its action");
  assert.equal(E.targets(st, b).take.length, 0, "no second action");
  // a fresh unit takes free land; the region grows
  st.obj[reg[3]] = O.U1;
  const y = E.targets(st, reg[3]).take[0];
  const before = E.regionOf(st, h).length;
  assert.ok(E.move(st, reg[3], y));
  assert.equal(st.own[y], 0);
  assert.equal(E.regionOf(st, h).length, before + 1);
  assert.ok(!E.move(st, y, reg[4]), "a unit that acted cannot move again");
  // a unit of the side not to move cannot act
  const e = at(st, 1, 10);
  st.obj[E.neighbours(st, e)[0]] = O.U1;
  assert.equal(E.targets(st, E.neighbours(st, e)[0]).take.length, 0);
});

test("realm: buying, prices and where things go", () => {
  const st = blank();
  const h = at(st, 5, 5), reg = disc(st, h);
  give(st, 0, reg, h, 100);
  give(st, 1, disc(st, at(st, 1, 1)), at(st, 1, 1), 0);
  assert.equal(E.costOf("mill", E.regionInfo(st, h)), 12);
  const mills = E.buyCells(st, h, "mill");
  assert.ok(mills.length && mills.every((x) => E.neighbours(st, x).includes(h)), "Mills touch the Hall");
  assert.ok(E.buy(st, h, "mill", mills[0]));
  assert.equal(st.gold[h], 88);
  assert.equal(E.costOf("mill", E.regionInfo(st, h)), 15, "each Mill costs 3 more");
  const tower = E.buyCells(st, h, "tower")[0];
  assert.ok(E.buy(st, h, "tower", tower));
  assert.ok(E.canBuy(st, h, "fort", tower), "a Fort may replace a Watchtower");
  assert.equal(E.canBuy(st, h, "tower", tower), null, "not on a building");
  // a unit bought straight onto free land next to the region takes it
  const out = E.buyCells(st, h, "u1").find((x) => st.own[x] !== 0);
  assert.ok(E.buy(st, h, "u1", out));
  assert.equal(st.own[out], 0);
  assert.equal(st.done[out], 1);
  // a unit bought inside the region may still act
  const inside = E.buyCells(st, h, "u1").find((x) => st.own[x] === 0 && st.obj[x] === O.EMPTY);
  assert.ok(E.buy(st, h, "u1", inside));
  assert.equal(st.done[inside], 0);
  // not enough gold
  st.gold[h] = 5;
  assert.equal(E.canBuy(st, h, "u1", inside), null);
  assert.equal(E.buyCells(st, h, "u1").length, 0);
});

test("realm: cutting a region shares its gold; taking the Hall loses it", () => {
  const st = blank();
  // a straight line of cells in one row: h at its left end
  const row = [0, 1, 2, 3, 4, 5, 6].map((c) => at(st, 6, 2 + c));
  give(st, 1, row, row[0], 60);
  give(st, 0, disc(st, at(st, 2, 6)), at(st, 2, 6), 0);
  // side 0 cuts row[3] with a Rider placed by hand next to it
  const att = E.neighbours(st, row[3]).find((x) => st.own[x] < 0);
  st.own[att] = 0; st.obj[att] = O.U3; st.done[att] = 0;
  // join att to side 0's region with a path of cells so it can act
  let cur = att;
  const goal = E.regionOf(st, at(st, 2, 6));
  for (let k = 0; k < 20 && !E.neighbours(st, cur).some((x) => goal.includes(x)); k++) {
    const nxt = E.neighbours(st, cur).filter((x) => st.own[x] < 0).sort((p, q) => Math.abs(Math.floor(p / st.W) - 2) - Math.abs(Math.floor(q / st.W) - 2))[0];
    st.own[nxt] = 0; cur = nxt;
  }
  E.settle(st, -1);
  assert.ok(E.targets(st, att).take.includes(row[3]), "the Rider can take the middle");
  E.move(st, att, row[3]);
  const left = E.regionOf(st, row[0]), right = E.regionOf(st, row[6]);
  assert.equal(left.length, 3);
  assert.equal(right.length, 3);
  const hl = E.hallOf(st, left), hr = E.hallOf(st, right);
  assert.equal(hl, row[0], "the old Hall stays");
  assert.ok(hr >= 0, "the cut-off part gets a Hall");
  assert.equal(st.gold[hl] + st.gold[hr], 60, "gold is shared, none lost");
  assert.equal(st.gold[hr], 30);
  // taking a Hall loses that region's gold
  const s2 = blank();
  const c6 = at(s2, 6, 6), reg = disc(s2, c6), h = reg[1];
  give(s2, 1, reg, h, 40);
  give(s2, 0, disc(s2, at(s2, 2, 2)), at(s2, 2, 2), 100);
  s2.turn = 0;
  // a Champion of side 0 right next to the Hall (the Hall is on the edge)
  const spot = E.neighbours(s2, h).find((x) => s2.own[x] < 0);
  s2.own[spot] = 0; s2.obj[spot] = O.U4;
  assert.ok(E.move(s2, spot, h));
  assert.equal(s2.own[h], 0);
  const rest = E.regions(s2, 1).filter((r) => r.length >= 2);
  rest.forEach((r) => assert.equal(s2.gold[E.hallOf(s2, r)], 0, "the treasury is gone"));
});

test("realm: Thicket grows the same way every time, and Ruins turn into it", () => {
  const a = blank(), b = blank();
  [a, b].forEach((st) => { st.obj[at(st, 5, 5)] = O.THICKET; st.obj[at(st, 8, 8)] = O.RUIN; st.rng = 42; });
  for (let r = 0; r < 12; r++) { E.nature(a); E.nature(b); }
  assert.equal(J(a.obj), J(b.obj));
  assert.equal(a.obj[at(a, 8, 8)], O.THICKET, "a Ruin becomes Thicket");
  assert.ok(a.obj.filter((o) => o === O.THICKET).length > 2, "it spreads");
  assert.ok(a.obj.every((o) => o === O.EMPTY || o === O.THICKET));
});

test("realm: a side without a region is out; the last side wins; surrender", () => {
  const st = blank();
  const h0 = at(st, 5, 5);
  give(st, 0, disc(st, h0), h0, 0);
  const h1 = at(st, 1, 1);
  st.own[h1] = 1;                        // a lone cell
  st.obj[E.neighbours(st, h1)[0]] = 0;
  E.checkOut(st);
  assert.equal(st.sides[1].out, true);
  assert.equal(st.over, 0);
  assert.equal(st.own[h1], -1, "its land goes to nobody");
  // surrender offer: one person, 75% of the land
  const s2 = blank(3);
  s2.sides[0].k = "h";
  const all = s2.land.map((_, i) => i);
  const cut = Math.ceil(all.length * 0.76);
  give(s2, 0, all.slice(0, cut), 0, 0);
  give(s2, 1, all.slice(cut, cut + 4), all[cut], 0);
  give(s2, 2, all.slice(cut + 10, cut + 14), all[cut + 10], 0);
  E.settle(s2, -1);
  assert.equal(E.surrenderOffer(s2), 0);
  s2.nos = 1;
  assert.equal(E.surrenderOffer(s2), -1, "declined once, not asked again");
});

test("realm: computer games keep the rules and end", () => {
  let rounds = 0;
  for (let g = 0; g < 60; g++) {
    const lvs = [["h", "m"], ["m", "e"], ["m", "e", "e"], ["h", "m", "e", "m"], ["m", "m", "h", "e", "h", "m"]][g % 5];
    const size = ["s", "m", "l"][g % 3];
    const st = E.makeMap({ size, seed: "sim" + g, sides: sides(...lvs) });
    let n = 0;
    for (; n < 4000 && st.over < 0; n++) {
      const side = st.turn;
      const plan = E.planTurn(st, st.sides[side].lv);
      for (const act of plan) {
        if (act.a === "move") assert.ok(E.targets(st, act.i).walk.concat(E.targets(st, act.i).take).includes(act.y), "a legal move");
        else assert.ok(E.canBuy(st, act.at, act.kind, act.y), "a legal buy");
        assert.ok(E.apply(st, act));
        assert.equal(st.turn, side, "a plan never ends the turn");
      }
      E.endTurn(st);
      assert.ok(E.valid(st), "a valid state after every turn");
      // invariants: one Hall per region of 2+, gold only on Halls, never below 0
      for (let s = 0; s < st.sides.length; s++) {
        E.regions(st, s).forEach((reg) => {
          const halls = reg.filter((x) => st.obj[x] === O.HALL).length;
          assert.equal(halls, reg.length >= 2 ? 1 : 0, "Halls per region");
        });
      }
      st.gold.forEach((gd, i) => { assert.ok(gd >= 0); if (gd) assert.equal(st.obj[i], O.HALL); });
    }
    assert.ok(st.over >= 0, "game " + g + " ends");
    rounds += st.round;
  }
  assert.ok(rounds / 60 < 80, "games end in a sensible number of rounds");
});

test("realm: the computer's plan is the same on every run (no clock, no Math.random)", () => {
  const st = E.makeMap({ size: "m", seed: "det", sides: sides("h", "m", "e") });
  for (let r = 0; r < 9; r++) {
    const a = E.planTurn(st, st.sides[st.turn].lv), b = E.planTurn(E.clone(st), st.sides[st.turn].lv);
    assert.equal(J(a), J(b));
    a.forEach((x) => E.apply(st, x));
    E.endTurn(st);
  }
  assert.ok(!/Math\.random|Date\.now|performance\.now/.test(fs.readFileSync(path.join(__dirname, "..", "realm/engine.js"), "utf8")));
});

test("realm: Hard beats Medium more often than not", () => {
  let hard = 0, n = 24;
  for (let g = 0; g < n; g++) {
    const lv = g % 2 ? ["h", "m"] : ["m", "h"];
    const st = E.makeMap({ size: "s", seed: "duel" + g, sides: sides(...lv) });
    for (let k = 0; k < 3000 && st.over < 0; k++) { E.planTurn(st, st.sides[st.turn].lv).forEach((x) => E.apply(st, x)); E.endTurn(st); }
    if (st.over >= 0 && st.sides[st.over].lv === "h") hard++;
  }
  assert.ok(hard > n / 2, "hard won " + hard + " of " + n);
});

test("realm: a stored state is checked before it is used", () => {
  const st = E.makeMap({ size: "s", seed: "v", sides: sides("p", "m") });
  assert.ok(E.valid(st));
  const bad = [
    (s) => { s.v = 2; }, (s) => { s.size = "x"; }, (s) => { s.land.pop(); }, (s) => { s.own[0] = 9; },
    (s) => { s.obj[3] = 99; }, (s) => { s.gold[5] = -1; }, (s) => { s.turn = 7; }, (s) => { s.sides = []; },
    (s) => { s.sides[0].k = "x"; }, (s) => { s.seed = "x".repeat(65); }, (s) => { s.own[s.land.indexOf(0)] = 0; }
  ];
  bad.forEach((f, k) => { const c = E.clone(st); f(c); assert.equal(E.valid(c), false, "case " + k); });
  assert.equal(E.valid(null), false);
});

test("realm: records merge is a join and a reset drops older rows", () => {
  const M = R.mergeRealm;
  const rnd = (n) => Math.floor(Math.random() * n);
  const keys = ["e:s", "m:m", "h:l", "h:s"];
  const mk = () => {
    const rows = {};
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      keys.forEach((k) => { if (rnd(2)) s[k] = [rnd(5), rnd(5)]; });
      rows["d" + rnd(4)] = { b: rnd(3) * 100, s };
    }
    return { ver: 1, br: rnd(4) ? 0 : rnd(3) * 100, rows };
  };
  for (let i = 0; i < 4000; i++) {
    const a = mk(), b = mk(), c = mk(), sa = J(a), sb = J(b);
    assert.equal(J(M(a, b)), J(M(b, a)));
    const m = M(a, b);
    assert.equal(J(M(m, m)), J(m));
    assert.equal(J(M(M(a, b), c)), J(M(a, M(b, c))));
    assert.equal(J(a), sa);
    assert.equal(J(b), sb);
  }
  assert.equal(J(M({ br: 0, rows: { x: { b: 0, s: { "e:s": [3, 0] } } } }, { br: 50, rows: {} }).rows), "{}");
  for (const bad of [{ b: -1, s: { "e:s": [1, 0] } }, { b: 0, s: { "e:s": [1] } }, { b: 0, s: { "e:s": [1, -1] } },
                     { b: 0, s: { "x:s": [1, 0] } }, null, "row"]) {
    assert.equal(J(M({ rows: { d: bad } }, null).rows), "{}", J(bad));
  }
});

test("realm: Daily island results merge as a join; a reset drops them; bad days drop", () => {
  const M = R.mergeRealm;
  const rnd = (n) => Math.floor(Math.random() * n);
  const mk = () => {
    const days = {};
    for (let i = 0; i < rnd(5); i++) days[String(300 + rnd(4))] = { b: rnd(3) * 100, w: rnd(2), r: 1 + rnd(30), p: rnd(101) };
    return { ver: 1, br: rnd(4) ? 0 : rnd(3) * 100, rows: {}, days };
  };
  for (let i = 0; i < 4000; i++) {
    const a = mk(), b = mk(), c = mk(), sa = J(a);
    assert.equal(J(M(a, b)), J(M(b, a)));
    const m = M(a, b);
    assert.equal(J(M(m, m)), J(m));
    assert.equal(J(M(M(a, b), c)), J(M(a, M(b, c))));
    assert.equal(J(a), sa);
  }
  const win = { b: 0, w: 1, r: 20, p: 80 }, loss = { b: 0, w: 0, r: 9, p: 30 };
  assert.deepEqual(M({ rows: {}, days: { 310: loss } }, { rows: {}, days: { 310: win } }).days[310], win, "a win beats a loss");
  assert.deepEqual(M({ rows: {}, days: { 310: win } }, { rows: {}, days: { 310: { b: 0, w: 1, r: 12, p: 80 } } }).days[310].r, 12,
    "equal land: fewer rounds");
  assert.deepEqual(M({ rows: {}, days: { 310: win } }, { rows: {}, days: { 310: { b: 5, w: 0, r: 3, p: 1 } } }).days[310].b, 5,
    "a newer epoch wins");
  assert.equal(J(M({ br: 0, rows: {}, days: { 310: win } }, { br: 50, rows: {}, days: {} }).days), "{}", "a reset drops older days");
  for (const bad of [{ b: 0, w: 2, r: 1, p: 1 }, { b: 0, w: 1, r: 0, p: 1 }, { b: 0, w: 1, r: 1, p: 101 }, { b: -1, w: 1, r: 1, p: 1 },
                     { b: 0, w: 1, r: 1.5, p: 1 }, null, "x"]) {
    assert.equal(J(M({ rows: {}, days: { 310: bad } }, null).days), "{}", J(bad));
  }
  assert.equal(J(M({ rows: {}, days: { "-1": win, "x": win, "100001": win } }, null).days), "{}", "bad day keys drop");
  assert.equal(J(M({ rows: {} }, null).days), "{}", "data from before W2 has no days");
});

test("realm: the Daily island is the same for everyone on a day, and differs between days", () => {
  const D = require("../gamekit/daily.js");
  const seed = (day) => D.seedOf("realm", day).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
  const sides = [{ k: "h", lv: "m" }, { k: "c", lv: "m" }, { k: "c", lv: "m" }, { k: "c", lv: "m" }];
  const a = E.makeMap({ size: "m", seed: seed(310), sides }), b = E.makeMap({ size: "m", seed: seed(310), sides });
  assert.equal(J(a), J(b));
  assert.ok(E.valid(a));
  assert.notEqual(J(E.makeMap({ size: "m", seed: seed(311), sides }).land), J(a.land));
  // the computers answer the same moves the same way
  const x = E.clone(a), y = E.clone(a);
  E.endTurn(x); E.endTurn(y);
  for (let k = 0; k < 3; k++) {
    const px = E.planTurn(x, "m"), py = E.planTurn(y, "m");
    assert.equal(J(px), J(py));
    px.forEach((act) => E.apply(x, act)); py.forEach((act) => E.apply(y, act));
    E.endTurn(x); E.endTurn(y);
  }
  assert.equal(J(x), J(y));
});
